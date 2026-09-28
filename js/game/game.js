/*
 * Game: owns the simulation (no DOM, no canvas) so it can run headless in
 * tests. Rendering, audio and UI subscribe to its events.
 *
 * Modes: 'practice' (endless waves on the current range) and 'challenge'
 * (a timed ChallengeRun). The simulation only advances while `live` is true
 * (playing, no overlay), so pausing freezes timers, cadence, reloads, waves,
 * rounds, projectiles and combo alike.
 */
(function (root) {
  'use strict';
  const ZTA = root.ZTA;
  const D = ZTA.data;

  const EXPLOSION_CHAIN_DELAY = 0.09;

  class Game {
    constructor(opts) {
      const o = opts || {};
      this.events = o.events || new ZTA.Emitter();
      this.save = o.save || ZTA.SaveSystem.createDefault();
      this.rng = ZTA.createRng(o.seed == null ? (Date.now() ^ 0x5eed) >>> 0 : o.seed);
      this.economy = new ZTA.Economy(this.save, this.events);
      this.progression = new ZTA.Progression(this.save, this.economy, this.events);
      this.range = D.rangeById[this.save.rangeId] || D.rangeById[D.START_RANGE];
      this.camera = new ZTA.Camera(this.range);
      this.combo = new ZTA.Combo(this.events);
      this.targets = new ZTA.TargetManager(this.events, this.range);
      this.director = new ZTA.RangeDirector(this);
      this.mode = 'practice';
      this.run = null;
      this.allowedFamilies = null;
      this._norm = new Map();
      this.weapons = new ZTA.WeaponController(this);
      this.projectiles = new ZTA.RingPool(24, () => ({}));
      this.explosions = [];
      this.aim = { x: this.camera.cx, y: this.camera.cy };
      this.time = 0;
      this.live = false;
      this.started = false;
      this.rewardsGranted = 0;
      this._c = {};
      this._applyGlobals();

      const ev = this.events;
      ev.on('loadout:changed', () => this.weapons.onLoadoutChanged());
      ev.on('upgrade:bought', (e) => {
        if (e.kind === 'weapon' || e.kind === 'perk') this.weapons.onStatsChanged(e.weaponId);
        if (e.kind === 'workshop') {
          this._applyGlobals();
          this.weapons.onStatsChanged();
        }
      });
      ev.on('mastery:level', () => this.weapons.onStatsChanged());
      ev.on('milestone:reached', () => this.weapons.onStatsChanged());
      ev.on('prestige:opened', () => this._applyGlobals());
      ev.on('target:escaped', (e) => {
        if (this.run) this.run.onEscape(e.target);
      });
      ev.on('combo:changed', (e) => {
        if (e.reason === 'hit' && this.combo.atCap) this.trackObjective(this.weapons.activeId, 'comboMax');
      });
    }

    _applyGlobals() {
      const g = this.progression.globals();
      this.combo.extraSteps = g.comboSteps;
    }

    begin() {
      if (this.started) return;
      this.started = true;
      this.director.start(0.45);
    }

    setLive(v) {
      if (this.live === v) return;
      this.live = v;
      this.weapons.cancelInput();
      this.events.emit('game:live', { live: v });
    }

    setAim(x, y) {
      this.aim.x = x;
      this.aim.y = y;
    }

    resize(w, h) {
      this.camera.resize(w, h);
    }

    /** Firing is blocked during a round's countdown and after it ends. */
    canFire() {
      return !this.run || this.run.state === 'running';
    }

    statsFor(id) {
      if (this.run && this.run.def.normalized) {
        let s = this._norm.get(id);
        if (!s) {
          s = this.progression.normalizedStats(id, this.range.index);
          this._norm.set(id, s);
        }
        return s;
      }
      return this.progression.stats(id);
    }

    /* ------------------------------------------------------------ ranges */

    _enterRange(range) {
      this.range = range;
      this.save.rangeId = range.id;
      this.camera.setRange(range);
      this.targets.setRange(range);
      this.projectiles.clear();
      this.explosions.length = 0;
      this.director.reset();
    }

    setRange(id) {
      const r = D.rangeById[id];
      if (!r || !this.progression.isRangeUnlocked(id) || this.run) return false;
      if (r === this.range) return true;
      this._enterRange(r);
      this.combo.reset();
      if (this.started) this.director.start(0.8);
      this.events.emit('range:changed', { rangeId: id });
      this.events.emit('save:request', { reason: 'range' });
      return true;
    }

    /* -------------------------------------------------------- challenges */

    startChallenge(id, modId) {
      const def = D.challengeById[id];
      const st = this.progression.challengeStatus(id);
      if (!def || !st.ok) return { ok: false, reason: st.reason };
      if (modId && !this.progression.modifiersUnlocked().some((m) => m.id === modId)) return { ok: false, reason: 'modifier locked' };
      if (this.run) this.run.state = 'done';
      const range = D.rangeById[def.range];
      if (range !== this.range) {
        this._enterRange(range);
        this.events.emit('range:changed', { rangeId: range.id });
      } else {
        this.targets.clear();
        this.projectiles.clear();
        this.explosions.length = 0;
      }
      this.director.stop();
      this.mode = 'challenge';
      this.allowedFamilies = def.families ? def.families.slice() : null;
      this._norm.clear();
      let autoEquipped = null;
      if (this.allowedFamilies && !this.save.equipped.some((w) => w && this.weapons.allowed(w))) {
        const best = this.save.owned
          .filter((w) => this.weapons.allowed(w))
          .sort((a, b) => ZTA.content.dps(this.statsFor(b)) - ZTA.content.dps(this.statsFor(a)))[0];
        if (best) {
          this.progression.equip(this.save.activeSlot, best);
          autoEquipped = best;
        }
      }
      this.run = new ZTA.ChallengeRun(this, def, modId);
      this.weapons.onLoadoutChanged();
      this.weapons.onStatsChanged();
      this.weapons.refillAll();
      this.combo.reset();
      this.combo.touch(this.progression.globals().startCombo);
      this.camera.resetKick();
      this.run.start();
      this.events.emit('challenge:start', { def, mod: this.run.mod, autoEquipped });
      return { ok: true, autoEquipped };
    }

    retryChallenge() {
      if (!this.run) return { ok: false };
      return this.startChallenge(this.run.def.id, this.run.mod ? this.run.mod.id : null);
    }

    endChallenge() {
      if (!this.run) return;
      if (this.run.state !== 'done') this.run.state = 'done';
      this.run = null;
      this.mode = 'practice';
      this.allowedFamilies = null;
      this._norm.clear();
      this.targets.clear();
      this.projectiles.clear();
      this.explosions.length = 0;
      this.weapons.onStatsChanged();
      this.weapons.onLoadoutChanged();
      this.combo.reset();
      this.director.reset();
      if (this.started) this.director.start(0.8);
      this.events.emit('challenge:exit', {});
    }

    /* ------------------------------------------------------------ update */

    update(dt) {
      if (!this.live) return;
      this.time += dt;
      this.save.stats.playTime += dt;
      this.camera.update(dt, this.weapons.stats.recoil.recovery);
      this.targets.update(dt);
      this.weapons.update(dt);
      this._updateProjectiles(dt);
      this._updateExplosions();
      if (this.run) this.run.update(dt);
      else this.director.update(dt);
      const active = this.run ? this.run.state === 'running' : this.director.isActive();
      this.combo.update(dt, active);
      if (this.combo.mult > this.save.stats.bestCombo) this.save.stats.bestCombo = this.combo.mult;
    }

    /* ----------------------------------------------------------- rewards */

    /**
     * Pays for a broken target. Guarded so each target pays exactly once.
     * ctx: { weak, fresh, pierceIndex, drone, breakIndex, breakCount, perkMult, metric, weaponId, explosion }
     */
    rewardBreak(target, ctx) {
      if (target.rewarded || target.state === 'active') return 0;
      target.rewarded = true;
      const c = ctx || {};
      const mods = this.progression.rangeModifiers();
      const g = this.progression.globals();
      let amount = target.value * mods.cashMult * g.cashMult * this.combo.mult;
      if (c.weak) amount *= 1 + mods.weakBreakBonus;
      amount *= c.perkMult || 1;
      const granted = this.economy.earn(amount, 'target', { targetId: target.def.id, weaponId: c.weaponId });
      this.rewardsGranted += 1;
      this.save.stats.breaks += 1;

      const wid = c.weaponId;
      if (wid && D.weaponById[wid]) {
        this._gunStats(wid).breaks += 1;
        const X = D.meta.mastery.xp;
        this.progression.addMasteryXp(wid, X.break + (c.weak ? X.weakBreak : 0) + (target.part ? X.bossPart : 0));
        this.trackObjective(wid, 'breaks');
        if (c.weak) this.trackObjective(wid, 'weakBreaks');
        if (target.moving) this.trackObjective(wid, 'movingBreaks');
        if (target.kind === 'drone') this.trackObjective(wid, 'droneBreaks');
        if (target.armor > 0) this.trackObjective(wid, 'armorBreaks');
        if (c.metric) this.trackObjective(wid, c.metric);
        const rt = this.weapons.runtimes.get(wid);
        const st = this.statsFor(wid);
        const perk = ZTA.perks[st.perk.id];
        if (rt && perk && perk.onBreak) perk.onBreak(rt.perkState, st.perk.params, { time: this.weapons.time }, (m) => this.trackObjective(wid, m));
      }

      if (this.run) this.run.onBreak(target, c);
      else this.director.onReward(granted);

      this.events.emit('target:broken', {
        target,
        amount: granted,
        weak: !!c.weak,
        multi: c.breakCount > 1 ? c.breakIndex + 1 : 0,
        perkBonus: (c.perkMult || 1) > 1,
        explosion: !!c.explosion,
      });

      if (target.def.explosive) {
        const ctr = target.center(this._c);
        this.explosions.push({
          at: this.time + EXPLOSION_CHAIN_DELAY,
          x: ctr.x,
          y: ctr.y,
          z: target.z,
          radius: target.def.explosive.radius,
          damage: target.def.explosive.damage * this.range.hpMult,
          weaponId: wid,
          kind: 'barrel',
          exclude: target,
        });
      }
      if (target.part && target.part.final && target.boss) {
        const boss = target.boss;
        boss.defeated = true;
        boss.retireParts();
        this.save.stats.bossKills += 1;
        this.events.emit('boss:defeated', { boss });
      }
      return granted;
    }

    recordShot(weaponId, result) {
      const s = this.save.stats;
      const g = this._gunStats(weaponId);
      s.shots += 1;
      g.shots += 1;
      if (result.pending) return;
      if (result.anyHit) {
        s.hits += 1;
        g.hits += 1;
      }
      if (result.weakHits > 0) s.weakHits += 1;
      if (this.run) this.run.onShot(result, weaponId);
      else this.director.onShot(result);
    }

    trackObjective(weaponId, metric) {
      if (weaponId && D.weaponById[weaponId]) this.progression.trackObjective(weaponId, metric);
    }

    _gunStats(id) {
      return this.save.perGun[id] || (this.save.perGun[id] = { shots: 0, hits: 0, breaks: 0 });
    }

    /* -------------------------------------------------------- explosions */

    _updateExplosions() {
      if (!this.explosions.length) return;
      const due = this.explosions.filter((e) => e.at <= this.time);
      if (!due.length) return;
      this.explosions = this.explosions.filter((e) => e.at > this.time);
      for (const e of due) this.explode(e);
    }

    /**
     * Splash damage around a world point. Broken barrels queue their own
     * explosion, so chains ripple outward one short beat at a time.
     */
    explode(o) {
      const hits = this.targets.near(o.x, o.y, o.z, o.radius, o.exclude);
      let mult = o.mult || 1;
      if (o.kind === 'grenade' && o.weaponId) {
        const st = this.statsFor(o.weaponId);
        const perk = ZTA.perks[st.perk.id];
        const rt = this.weapons.runtimes.get(o.weaponId);
        if (perk && perk.splashMult && rt) mult *= perk.splashMult(rt.perkState, st.perk.params, hits.length);
      }
      const p = this.camera.project(o.x, o.y, o.z, {});
      this.events.emit('explosion', { x: o.x, y: o.y, z: o.z, radius: o.radius, kind: o.kind, sx: p.sx, sy: p.sy, s: p.s });
      const broken = [];
      for (const h of hits) {
        const t = h.target;
        let dmg = o.damage * mult * (1 - 0.5 * (h.d / o.radius));
        dmg = Math.max(dmg * D.ARMOR_FLOOR, dmg - t.armor * 0.5);
        const ctr = t.center(this._c);
        const r = t.applyDamage(dmg, { wx: ctr.x, wy: ctr.y, weakHits: 0 });
        if (!r) continue;
        const sp = this.camera.project(ctr.x, ctr.y, t.z, {});
        this.events.emit('target:hit', { target: t, damage: dmg, weak: false, armored: false, pellets: 0, x: sp.sx, y: sp.sy, broken: r.broken, splash: true });
        if (r.broken) broken.push(t);
      }
      broken.forEach((t, i) => this.rewardBreak(t, { weaponId: o.weaponId, weak: false, breakIndex: i, breakCount: broken.length, perkMult: 1, explosion: true }));
      if (broken.length >= 2) this.trackObjective(o.weaponId, 'multiBreaks');
      return { hits: hits.length, broken: broken.length };
    }

    /* ------------------------------------------------------- projectiles */

    launchProjectile(weaponId, st, sx, sy, shotMult) {
      const cam = this.camera;
      let dx = (sx - cam.cx - cam.offX) / cam.f;
      let dy = -(sy - cam.cy - cam.offY) / cam.f;
      let dz = 1;
      const len = Math.hypot(dx, dy, dz);
      dx /= len;
      dy /= len;
      dz /= len;
      const pr = st.projectile;
      const p = this.projectiles.spawn();
      p.x = 0.18;
      p.y = cam.eyeH - 0.2;
      p.z = 0.7;
      p.vx = dx * pr.speed;
      p.vy = dy * pr.speed + pr.gravity * 0.12;
      p.vz = dz * pr.speed;
      p.g = pr.gravity;
      p.radius = pr.radius;
      p.damage = st.damage * (shotMult || 1);
      p.weaponId = weaponId;
      p.age = 0;
      this.events.emit('projectile:launched', { weaponId });
      return p;
    }

    _updateProjectiles(dt) {
      const steps = 3;
      const h = dt / steps;
      this.projectiles.forEachAlive((p) => {
        for (let i = 0; i < steps && p.alive; i++) {
          p.age += h;
          p.vy -= p.g * h;
          p.x += p.vx * h;
          p.y += p.vy * h;
          p.z += p.vz * h;
          let hit = p.y <= 0 || p.z >= this.range.backZ || Math.abs(p.x) >= this.range.halfWidth + 1;
          if (!hit) {
            for (const t of this.targets.list) {
              if (!t.hittable || Math.abs(t.z - p.z) > Math.abs(p.vz * h) * 0.6 + 0.2) continue;
              if (t.hitTest(p.x, p.y)) {
                hit = true;
                break;
              }
            }
          }
          if (hit || p.age > 4) {
            p.alive = false;
            const res = hit ? this.explode({ x: p.x, y: Math.max(0.1, p.y), z: Math.min(p.z, this.range.backZ), radius: p.radius, damage: p.damage, weaponId: p.weaponId, kind: 'grenade' }) : { hits: 0 };
            this._resolveProjectileShot(p.weaponId, res.hits > 0);
          }
        }
      });
    }

    _resolveProjectileShot(weaponId, anyHit) {
      const result = { anyHit, weakHits: 0, bodyHits: anyHit ? 1 : 0 };
      if (anyHit) {
        this.save.stats.hits += 1;
        this._gunStats(weaponId).hits += 1;
        this.combo.registerHit(false, 1);
      } else this.combo.registerMiss();
      if (this.run) this.run.onShot(result, weaponId);
      else this.director.onShot(result);
    }

    /* ---------------------------------------------------- secondary hits */

    /**
     * Damage that is not a direct ray hit: ricochets and arcs jump from one
     * target to its nearest neighbors; needle bursts hit the target itself.
     */
    secondaryHit(o) {
      let list;
      const from = o.from ? o.from.center({}) : null;
      if (from) from.z = o.from.z;
      if (o.target) list = [o.target];
      else if (from) list = this.targets.near(from.x, from.y, from.z, o.radius, o.from).slice(0, o.count || 1).map((h) => h.target);
      else return 0;
      let n = 0;
      for (const t of list) {
        if (!t.hittable) continue;
        const dmg = Math.max(o.amount * D.ARMOR_FLOOR, o.amount - t.armor);
        const r = t.applyDamage(dmg, null);
        if (!r) continue;
        n++;
        const to = t.center({});
        to.z = t.z;
        if (from) this.events.emit('fx:link', { from, to, kind: o.kind });
        const sp = this.camera.project(to.x, to.y, t.z, {});
        this.events.emit('target:hit', { target: t, damage: dmg, weak: false, armored: false, pellets: 0, x: sp.sx, y: sp.sy, broken: r.broken, secondary: o.kind });
        if (r.broken) {
          const metric = o.kind === 'ricochet' ? 'ricochetBreaks' : o.kind === 'arc' ? 'arcBreaks' : null;
          this.rewardBreak(t, { weaponId: o.weaponId, weak: false, breakIndex: 0, breakCount: 1, perkMult: 1, metric });
        }
      }
      return n;
    }
  }

  ZTA.Game = Game;
})(typeof window !== 'undefined' ? window : globalThis);
