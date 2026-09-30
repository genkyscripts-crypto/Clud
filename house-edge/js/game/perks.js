/*
 * Perk ranks, recipe activation and every perk/recipe behavior.
 *
 * Proc rules (shared, see D.TUNING.procs):
 *  - Primary hits apply on-hit effects at coefficient 1. Secondary hits
 *    (fragments, arcs, orbitals, zones, spin attacks) use their proc
 *    coefficient (default 0.25) as a chance or intensity multiplier.
 *  - Each originating attack owns a chain record. Secondary effects may go at
 *    most `maxDepth` levels deep and emit at most `budget` effects; excess
 *    effects are aggregated into a plain damage event instead of vanishing.
 *  - Shock arcs never arc again. Plasma branches never branch. Fragments and
 *    petals never split, return or bloom. Discharged orbitals are never
 *    captured again.
 */
(function (root) {
  'use strict';
  const HE = root.HE;
  const D = HE.data;
  const U = HE.util;
  const PR = D.TUNING.procs;

  class PerkSystem {
    constructor(game) {
      this.game = game;
      this.ranks = {};
      this.recipes = new Set();
      this.orbitAngle = 0;
      this.extras = [];
      this.dischargeT = 0;
      this.trail = null;
    }

    reset() {
      this.ranks = {};
      this.recipes.clear();
      this.extras.length = 0;
      this.trail = null;
    }

    rank(id) {
      return this.ranks[id] || 0;
    }
    has(id) {
      return this.rank(id) > 0;
    }
    /** Parameters of the current rank, or null if not owned. */
    p(id) {
      const r = this.rank(id);
      return r ? D.perkById[id].ranks[r - 1] : null;
    }
    recipe(id) {
      return this.recipes.has(id);
    }
    ownedIds() {
      return Object.keys(this.ranks).filter((k) => this.ranks[k] > 0);
    }

    /** Adds a rank. Returns recipes newly activated by it. */
    add(id) {
      const def = D.perkById[id];
      if (!def) return [];
      const cur = this.rank(id);
      if (cur >= def.maxRank) return [];
      this.ranks[id] = cur + 1;
      return this.recompute();
    }

    setRanks(ranks) {
      this.ranks = {};
      for (const k of Object.keys(ranks || {})) {
        const def = D.perkById[k];
        if (def) this.ranks[k] = U.clamp(ranks[k] | 0, 0, def.maxRank);
      }
      this.recompute();
    }

    recompute() {
      const newly = [];
      for (const r of D.recipes) {
        const ok = r.ingredients.every((i) => this.has(i) || (D.weaponById[i] && this.game.weaponId === i));
        if (ok && !this.recipes.has(r.id)) {
          this.recipes.add(r.id);
          newly.push(r.id);
        } else if (!ok) this.recipes.delete(r.id);
      }
      return newly;
    }

    /* --------------------------------------------------- primary shots */

    /** Configures a freshly fired primary projectile. */
    onPrimaryShot(s) {
      const rc = this.p('P01');
      if (rc) {
        s.bounces = rc.bounces;
        s.bounceBonus = rc.bounceBonus;
      }
      if (this.has('P02')) s.canSplit = true;
      const rt = this.p('P05');
      if (rt) {
        s.canReturn = true;
        s.maxTravel = rt.travel;
      }
    }

    /** Called when a primary projectile bounces. */
    onBounce(s, x, y, nx, ny) {
      if (!this.recipe('S003') || !s.primary) return;
      const rp = D.recipeById.S003.params;
      if (s.strips >= rp.maxStripsPerShot) return;
      s.strips++;
      const tx = -ny * rp.stripLength * 0.5;
      const ty = nx * rp.stripLength * 0.5;
      const ox = x + nx * 10;
      const oy = y + ny * 10;
      this.game.addZone('flame', { x: ox - tx, y: oy - ty, x2: ox + tx, y2: oy + ty, life: rp.life, width: 16, chain: s.chain });
      this.game.noteRecipe('S003');
    }

    /** Travel limit reached. Returns true if the shot continues (returning). */
    onTravelEnd(s) {
      const rt = this.p('P05');
      if (!rt || !s.canReturn || s.returning) return false;
      s.returning = true;
      s.hitN = 0;
      s.dmg *= rt.returnMult;
      s.pierce += rt.pierceOnReturn;
      s.bounces = 0;
      s.life = 1.8;
      return true;
    }

    /** Per-frame check for returning shots near the player. Returns true if consumed. */
    onReturning(s, distToPlayer) {
      const g = this.game;
      if (this.recipe('S007')) {
        const sp = D.recipeById.S007.params;
        if (distToPlayer < sp.catchRange && this.extras.length < sp.maxExtra) {
          this.extras.push({ angle: Math.atan2(s.y - g.player.y, s.x - g.player.x), life: sp.life, dmg: s.dmg, age: 0 });
          g.fx.ring(g.player.x, g.player.y, 10, 30, 0.2, '#35e38a', 2);
          g.noteRecipe('S007');
          return true;
        }
        // Rule with Boomerang Bloom: the ring catches while it has room.
        if (this.extras.length < sp.maxExtra && this.recipe('S005')) return false;
      }
      if (this.recipe('S005') && !s.bloomed) {
        const bp = D.recipeById.S005.params;
        if (distToPlayer < bp.triggerRange) {
          s.bloomed = true;
          const a = g.player.aim;
          for (const side of [-1, 1]) {
            const p = g.spawnShot(s.x, s.y, a - side * 0.45, 820, s.dmg * bp.petalFrac, 'petal', {
              chain: s.chain,
              depth: 1,
              life: bp.petalLife,
              curve: side * bp.curve,
              procCoef: PR.secondaryCoef,
            });
            if (p) p.color = '#ffd6e8';
          }
          g.fx.burst(s.x, s.y, 6, '#ffd6e8', 120, 0.3);
          g.noteRecipe('S005');
          return true;
        }
      }
      return false;
    }

    /* ------------------------------------------------------- on hit */

    /** Split Shot: first enemy hit of an eligible primary shot. */
    onFirstHit(s, e) {
      const sp = this.p('P02');
      if (!sp || !s.canSplit || s.didSplit) return;
      s.didSplit = true;
      const g = this.game;
      const base = Math.atan2(s.vy, s.vx);
      const speed = Math.hypot(s.vx, s.vy);
      const n = sp.fragments;
      for (let i = 0; i < n; i++) {
        const t = n === 1 ? 0 : i / (n - 1) - 0.5;
        const f = g.spawnShot(s.x, s.y, base + t * sp.angle * 2, speed * 0.85, s.baseDmg * sp.frac, 'frag', {
          chain: s.chain,
          depth: 1,
          life: 0.5,
          procCoef: PR.secondaryCoef,
        });
        if (f) {
          f.hits[0] = e.uid;
          f.hitN = 1;
        }
      }
    }

    /**
     * Applies elemental on-hit effects. `coef` is 1 for primary hits and the
     * proc coefficient for secondary hits. `allowShock` is false for arcs and
     * line strikes so shock never recurses.
     */
    applyOnHit(e, dmg, coef, chain, depth, allowShock) {
      const g = this.game;
      if (e.dead) return;
      const fire = this.p('P09');
      if (fire && (coef >= 1 || g.combatRoll() < coef)) g.addBurn(e, 1);
      const frost = this.p('P10');
      if (frost) g.addChill(e, frost.chill * coef, chain, depth);
      const shock = this.p('P11');
      if (shock && allowShock && depth < PR.maxDepth && g.combatRoll() < shock.chance * coef) {
        this.shockArc(e, dmg, shock, chain, depth);
      }
    }

    shockArc(src, dmg, sp, chain, depth) {
      const g = this.game;
      src.shockedAt = g.t;
      // The shocked enemy itself counts as struck for Brittle Circuit.
      if (this.recipe('S021') && src.chill >= D.recipeById.S021.params.chillThreshold && g.chainAllow(chain, depth + 1)) this.brittle(src, chain, depth + 1);
      const targets = g.nearestEnemies(src.x, src.y, sp.targets, sp.range, src);
      for (const t of targets) {
        const amount = dmg * sp.frac;
        if (!g.chainAllow(chain, depth + 1)) {
          g.hit(t, amount, { kind: 'aggregate', depth: depth + 1, chain, noProc: true, noFx: true });
          continue;
        }
        g.fx.bolt(src.x, src.y, t.x, t.y, '#35e38a', 0.16, 2);
        const wasBurning = t.burnStacks > 0;
        const chill = t.chill;
        g.hit(t, amount, { kind: 'arc', depth: depth + 1, chain, procCoef: PR.secondaryCoef, allowShock: false });
        t.shockedAt = g.t;
        if (t.dead && !wasBurning && chill < 60) continue;
        if (wasBurning && this.recipe('S018')) this.plasmaBranch(src, t, amount, chain, depth + 1);
        if (chill >= D.recipeById.S021.params.chillThreshold && this.recipe('S021')) this.brittle(t, chain, depth + 1);
      }
      g.sfx('shock', src.x);
    }

    plasmaBranch(from, t, amount, chain, depth) {
      const g = this.game;
      const rp = D.recipeById.S018.params;
      const next = g.nearestEnemies(t.x, t.y, 1, rp.range, t, from)[0];
      if (!next) return;
      if (!g.chainAllow(chain, Math.min(depth + 1, PR.maxDepth))) {
        g.hit(next, amount * rp.frac, { kind: 'aggregate', depth: depth + 1, chain, noProc: true, noFx: true });
        return;
      }
      g.fx.bolt(t.x, t.y, next.x, next.y, '#ff7a3d', 0.22, 3);
      g.hit(next, amount * rp.frac, { kind: 'plasma', depth: depth + 1, chain, noProc: true });
      if (!next.dead) g.addBurn(next, rp.burnStacks);
      g.noteRecipe('S018');
    }

    brittle(t, chain, depth) {
      const g = this.game;
      const rp = D.recipeById.S021.params;
      if (t.boss) {
        g.addStagger(t, rp.bossStagger);
        g.noteRecipe('S021');
        return;
      }
      t.chill = Math.max(0, t.chill - rp.chillCost);
      const near = g.nearestEnemies(t.x, t.y, rp.splinters, 260, t);
      for (let i = 0; i < rp.splinters; i++) {
        const target = near[i % Math.max(1, near.length)];
        const a = target ? Math.atan2(target.y - t.y, target.x - t.x) : (i / rp.splinters) * U.TAU;
        const s = g.spawnShot(t.x, t.y, a, 700, rp.damage, 'splinter', { chain, depth: Math.min(depth + 1, PR.maxDepth), life: 0.5, procCoef: 0 });
        if (s) {
          s.hits[0] = t.uid;
          s.hitN = 1;
        }
      }
      g.fx.burst(t.x, t.y, 8, '#bfe8ff', 160, 0.35);
      g.noteRecipe('S021');
    }

    /** Steam Table: chill landing on a burning enemy. Called by game.addChill. */
    onChill(e) {
      if (!this.recipe('S017') || e.burnStacks <= 0 || e.steamCd > 0) return;
      const g = this.game;
      const rp = D.recipeById.S017.params;
      e.steamCd = rp.perEnemyCooldown;
      e.burnStacks -= 1;
      e.chill = Math.max(0, e.chill - rp.chillCost);
      g.addZone('steam', { x: e.x, y: e.y, r: rp.radius, life: rp.life, chain: g.newChain('S017') });
      g.noteRecipe('S017');
    }

    /* ------------------------------------------------------------ dash */

    onDashStart(x, y) {
      if (!this.has('P41')) return;
      this.trail = { lastX: x, lastY: y, sx: x, sy: y, t: 0, chain: this.game.newChain('P41') };
    }

    onDashMove(x, y, dt) {
      const tr = this.trail;
      if (!tr) return;
      tr.t += dt;
      if (U.dist2(x, y, tr.lastX, tr.lastY) < 18 * 18) return;
      const sp = this.p('P41');
      this.game.addZone('spark', {
        x: tr.lastX,
        y: tr.lastY,
        x2: x,
        y2: y,
        life: sp.life,
        width: 14,
        dps: sp.dps,
        chain: tr.chain,
        skid: this.recipe('S081'),
      });
      tr.lastX = x;
      tr.lastY = y;
    }

    onDashEnd(x, y) {
      const tr = this.trail;
      this.trail = null;
      if (!tr) return;
      this.onDashMove(x, y, 0);
      if (!this.recipe('S089')) return;
      const g = this.game;
      const rp = D.recipeById.S089.params;
      const cands = [];
      for (const e of g.liveEnemies()) {
        if (g.t - e.shockedAt > rp.window) continue;
        const d2 = U.segDist2(e.x, e.y, tr.sx, tr.sy, x, y);
        if (d2 <= rp.range * rp.range) cands.push({ e, d2 });
      }
      cands.sort((a, b) => a.d2 - b.d2);
      for (let i = 0; i < Math.min(rp.targets, cands.length); i++) {
        const e = cands[i].e;
        // Nearest point on the trail segment to the target.
        const abx = x - tr.sx;
        const aby = y - tr.sy;
        const len2 = abx * abx + aby * aby || 1;
        const tt = U.clamp(((e.x - tr.sx) * abx + (e.y - tr.sy) * aby) / len2, 0, 1);
        const px = tr.sx + abx * tt;
        const py = tr.sy + aby * tt;
        g.fx.bolt(px, py, e.x, e.y, '#9ffff0', 0.26, 3);
        g.hit(e, rp.damage * g.damageScale(), { kind: 'linestrike', depth: 1, chain: tr.chain, procCoef: PR.secondaryCoef, allowShock: false });
      }
      if (cands.length) {
        g.noteRecipe('S089');
        g.sfx('shock', x);
      }
    }

    /* ------------------------------------------------------- per frame */

    update(dt) {
      const g = this.game;
      const op = this.p('P04');
      if (op) this.orbitAngle += op.speed * dt;
      if (op) {
        for (let i = 0; i < op.count; i++) {
          const a = this.orbitAngle + (i / op.count) * U.TAU;
          const x = g.player.x + Math.cos(a) * op.radius;
          const y = g.player.y + Math.sin(a) * op.radius;
          const list = g.queryEnemies(x, y, 9);
          for (const e of list) {
            if (e.orbitCd > 0) continue;
            e.orbitCd = 0.35;
            const chain = g.newChain('P04');
            g.hit(e, op.damage * g.damageScale(), { kind: 'orbital', depth: 1, chain, procCoef: PR.secondaryCoef, allowShock: true, x, y });
            g.fx.burst(x, y, 3, '#35e38a', 90, 0.2);
          }
        }
      }
      // Saturn's Wager: captured shots orbit, then discharge one at a time.
      if (this.extras.length) {
        const sp = D.recipeById.S007.params;
        const radius = (op ? op.radius : 54) + 16;
        for (let i = this.extras.length - 1; i >= 0; i--) {
          const x = this.extras[i];
          x.angle += 4.2 * dt;
          x.life -= dt;
          x.age += dt;
          if (x.life <= 0) this.extras.splice(i, 1);
        }
        this.dischargeT -= dt;
        if (this.dischargeT <= 0 && this.extras.length) {
          this.dischargeT = sp.dischargeEvery;
          const x = this.extras.shift();
          const px = g.player.x + Math.cos(x.angle) * radius;
          const py = g.player.y + Math.sin(x.angle) * radius;
          g.spawnShot(px, py, g.player.aim, 980, x.dmg, 'discharge', { chain: g.newChain('S007'), depth: 1, life: 0.8, procCoef: 1, pierce: 1 });
          g.fx.ring(px, py, 4, 16, 0.18, '#35e38a', 2);
        }
      }
    }

    orbitalPositions(out) {
      out.length = 0;
      const g = this.game;
      const op = this.p('P04');
      if (op) {
        for (let i = 0; i < op.count; i++) {
          const a = this.orbitAngle + (i / op.count) * U.TAU;
          out.push({ x: g.player.x + Math.cos(a) * op.radius, y: g.player.y + Math.sin(a) * op.radius, extra: false });
        }
      }
      const radius = (op ? op.radius : 54) + 16;
      for (const x of this.extras) out.push({ x: g.player.x + Math.cos(x.angle) * radius, y: g.player.y + Math.sin(x.angle) * radius, extra: true });
      return out;
    }
  }

  HE.PerkSystem = PerkSystem;
})(typeof window !== 'undefined' ? window : globalThis);
