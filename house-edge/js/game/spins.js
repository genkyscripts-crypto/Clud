/*
 * Turns a resolved slot result into combat effects (resolution step 7).
 *
 *  mixed  → each of the three symbols fires its single effect
 *  pair   → the pair symbol fires its upgraded effect + the odd one its single
 *  triple → the themed super attack
 *  777    → JACKPOT: a 10 s gold weapon transformation
 *
 * Spin attacks are secondary: they never generate spin charge and never
 * count as primary shots. A repeated jackpot refreshes a bounded part of the
 * timer and emits one pulse; continuous jackpot time is capped at 20 s, then
 * a visible cooldown begins.
 */
(function (root) {
  'use strict';
  const HE = root.HE;
  const D = HE.data;
  const U = HE.util;
  const T = D.TUNING.slots;
  const PR = D.TUNING.procs;

  class SpinEffects {
    constructor(game) {
      this.game = game;
      this.reset();
    }

    reset() {
      this.pending = null;
      this.animT = 0;
      this.timers = [];
      this.crownT = 0;
      this.crownMult = 1;
      this.crownPierce = 0;
      this.overdriveT = 0;
      this.overdriveMult = 1;
      this.instantReload = false;
      this.jackpotT = 0;
      this.jackpotElapsed = 0;
      this.jackpotCooldown = 0;
      this.domeT = 0;
      this.lastResult = null;
    }

    busy() {
      return !!this.pending;
    }

    /** Called when the player spins; effects resolve when the reels stop. */
    begin(result) {
      this.pending = result;
      this.animT = T.animTime;
      this.lastResult = result;
    }

    update(dt) {
      const g = this.game;
      if (this.pending) {
        this.animT -= dt;
        if (this.animT <= 0) {
          const r = this.pending;
          this.pending = null;
          this.resolve(r);
        }
      }
      for (let i = this.timers.length - 1; i >= 0; i--) {
        const t = this.timers[i];
        t.t -= dt;
        if (t.t <= 0) {
          this.timers.splice(i, 1);
          t.fn();
        }
      }
      if (this.crownT > 0) this.crownT = Math.max(0, this.crownT - dt);
      if (this.overdriveT > 0) {
        this.overdriveT = Math.max(0, this.overdriveT - dt);
        if (this.overdriveT === 0) this.instantReload = false;
      }
      if (this.domeT > 0) {
        this.domeT = Math.max(0, this.domeT - dt);
        g.clearBullets(g.player.x, g.player.y, 150, true);
      }
      if (this.jackpotT > 0) {
        this.jackpotT -= dt;
        this.jackpotElapsed += dt;
        if (this.jackpotT <= 0 || this.jackpotElapsed >= T.jackpotMaxContinuous) {
          this.jackpotT = 0;
          this.jackpotCooldown = T.jackpotCooldown;
          g.emit('jackpot_ended', {});
          g.setMusic(g.isBossRoom() ? 'boss' : 'combat');
        }
      } else if (this.jackpotCooldown > 0) {
        this.jackpotCooldown = Math.max(0, this.jackpotCooldown - dt);
      }
    }

    after(t, fn) {
      this.timers.push({ t, fn });
    }

    resolve(r) {
      const g = this.game;
      g.emit('spin_resolved', { result: r, flags: { demo: r.demo, debug: r.debug } });
      if (r.kind === 'jackpot') {
        this.jackpot();
      } else if (r.kind === 'triple') {
        this.triple(r.symbol);
        g.sfx('triple');
      } else if (r.kind === 'pair') {
        this.pair(r.symbol);
        this.single(r.other);
        g.sfx('pair');
      } else {
        for (const s of r.symbols) this.single(s);
        g.sfx('spin_stop');
      }
      g.stats.spins++;
      if (r.kind === 'pair') g.stats.pairs++;
      if (r.kind === 'triple') g.stats.triples++;
    }

    chain(label) {
      return this.game.newChain(label, this.jackpotT > 0 ? PR.jackpotBudget : PR.budget);
    }

    fan(n, spread, dmg, pierce, speed) {
      const g = this.game;
      const p = g.player;
      const ch = this.chain('spin:bullet');
      for (let i = 0; i < n; i++) {
        const t = n === 1 ? 0 : i / (n - 1) - 0.5;
        g.spawnShot(p.x, p.y, p.aim + t * spread, speed || 900, dmg * g.damageScale(), 'spin', { chain: ch, depth: 1, pierce: pierce || 0, life: 0.9, procCoef: PR.secondaryCoef });
      }
      g.fx.spray(p.x, p.y, p.aim, spread, 10, '#f1ece0', 300, 0.3);
    }

    bolts(count, dmg) {
      const g = this.game;
      const p = g.player;
      const ch = this.chain('spin:bolt');
      const targets = g.nearestEnemies(p.x, p.y, count, 2000, null);
      let px = p.x;
      let py = p.y;
      for (const t of targets) {
        g.fx.bolt(px, py, t.x, t.y, '#35e38a', 0.22, 3);
        g.hit(t, dmg * g.damageScale(), { kind: 'spin', depth: 1, chain: ch, procCoef: PR.secondaryCoef, allowShock: false });
        px = t.x;
        py = t.y;
      }
      if (targets.length) g.sfx('shock', p.x);
    }

    explosion(x, y, radius, dmg) {
      const g = this.game;
      const ch = this.chain('spin:skull');
      g.explode(x, y, radius, dmg * g.damageScale(), { kind: 'spin', depth: 1, chain: ch, procCoef: PR.secondaryCoef, allowShock: false });
    }

    aimPoint(maxDist) {
      const p = this.game.player;
      const dx = p.aimX - p.x;
      const dy = p.aimY - p.y;
      const d = Math.hypot(dx, dy);
      const k = d > maxDist ? maxDist / d : 1;
      return { x: p.x + dx * k, y: p.y + dy * k };
    }

    single(sym) {
      const g = this.game;
      switch (sym) {
        case 'bullet':
          this.fan(6, 0.7, 14, 0);
          break;
        case 'bolt':
          this.bolts(3, 28);
          break;
        case 'bell':
          g.clearBullets(g.player.x, g.player.y, 130, false);
          g.player.protect = Math.max(g.player.protect, 0.4);
          g.fx.ring(g.player.x, g.player.y, 20, 130, 0.35, '#9fd8ff', 3);
          g.sfx('bell');
          break;
        case 'crown':
          this.crownMult = Math.max(this.crownT > 0 ? this.crownMult : 1, 1.5);
          if (this.crownT <= 0) this.crownPierce = 0;
          this.crownT = Math.max(this.crownT, 4);
          break;
        case 'skull': {
          const a = this.aimPoint(460);
          this.explosion(a.x, a.y, 90, 45);
          break;
        }
        case 'seven':
          this.overdriveMult = Math.max(this.overdriveT > 0 ? this.overdriveMult : 1, 1.5);
          this.overdriveT = Math.max(this.overdriveT, 3);
          break;
      }
    }

    pair(sym) {
      const g = this.game;
      const p = g.player;
      switch (sym) {
        case 'bullet':
          this.fan(12, 1.0, 14, 3);
          break;
        case 'bolt':
          this.bolts(6, 28);
          this.after(0.25, () => this.bolts(6, 28));
          break;
        case 'bell':
          g.clearBullets(p.x, p.y, 200, false);
          p.shield = Math.max(p.shield, 1);
          p.protect = Math.max(p.protect, 0.4);
          g.fx.ring(p.x, p.y, 20, 200, 0.4, '#9fd8ff', 4);
          g.sfx('bell');
          break;
        case 'crown':
          this.crownMult = Math.max(this.crownT > 0 ? this.crownMult : 1, 1.8);
          if (this.crownT <= 0) this.crownPierce = 0;
          this.crownT = Math.max(this.crownT, 6);
          break;
        case 'skull': {
          const dirx = Math.cos(p.aim);
          const diry = Math.sin(p.aim);
          [140, 260, 380].forEach((d, i) => this.after(i * 0.12, () => this.explosion(p.x + dirx * d, p.y + diry * d, 80, 40)));
          break;
        }
        case 'seven':
          this.overdriveMult = Math.max(this.overdriveT > 0 ? this.overdriveMult : 1, 1.8);
          this.overdriveT = Math.max(this.overdriveT, 5);
          this.instantReload = true;
          g.weapon.finishReload();
          break;
      }
    }

    triple(sym) {
      const g = this.game;
      const p = g.player;
      g.flashScreen(0.25, D.symbolById[sym].color);
      g.toast(D.symbolById[sym].triple, 'triple');
      switch (sym) {
        case 'bullet': {
          const ch = this.chain('spin:storm');
          for (let k = 0; k < 12; k++) {
            this.after(k * 0.25, () => {
              const off = k * 0.19;
              for (let i = 0; i < 16; i++) {
                g.spawnShot(p.x, p.y, off + (i / 16) * U.TAU, 820, 12 * g.damageScale(), 'spin', { chain: ch, depth: 1, life: 0.9, procCoef: PR.secondaryCoef });
              }
              g.sfx('storm', p.x);
            });
          }
          break;
        }
        case 'bolt': {
          const ch = this.chain('spin:thunder');
          for (let k = 0; k < 14; k++) {
            this.after(k * 0.18, () => {
              const list = g.liveEnemies();
              if (!list.length) return;
              const t = list[Math.floor(g.combatRoll() * list.length)];
              g.fx.bolt(t.x, t.y - 400, t.x, t.y, '#35e38a', 0.25, 4);
              g.explode(t.x, t.y, 60, 12 * g.damageScale(), { kind: 'spin', depth: 1, chain: ch, noProc: true, silent: true, color: '#35e38a' });
              g.hit(t, 30 * g.damageScale(), { kind: 'spin', depth: 1, chain: ch, procCoef: PR.secondaryCoef, allowShock: false });
              g.sfx('shock', t.x);
            });
          }
          break;
        }
        case 'bell':
          this.domeT = 3;
          p.shield = Math.max(p.shield, 1);
          g.sfx('bell');
          break;
        case 'crown':
          this.crownMult = 2;
          this.crownPierce = 2;
          this.crownT = Math.max(this.crownT, 6);
          break;
        case 'skull': {
          const a = this.aimPoint(420);
          let k = 0;
          for (let gy = -1; gy <= 1; gy++) {
            for (let gx = -1; gx <= 1; gx++) {
              const x = a.x + gx * 110;
              const y = a.y + gy * 110;
              this.after(k++ * 0.1, () => this.explosion(x, y, 85, 50));
            }
          }
          break;
        }
      }
    }

    jackpot() {
      const g = this.game;
      const p = g.player;
      g.stats.jackpots++;
      if (this.jackpotCooldown > 0) {
        // Cooldown: a 777 still pays one big pulse, but no new transformation.
        this.goldPulse();
        g.toast('777 — jackpot on cooldown: gold pulse', 'jackpot');
        return;
      }
      if (this.jackpotT > 0) {
        const room = T.jackpotMaxContinuous - this.jackpotElapsed;
        this.jackpotT = Math.min(this.jackpotT + T.jackpotRefresh, room);
        this.goldPulse();
        g.toast('777 again — jackpot extended', 'jackpot');
        return;
      }
      this.jackpotT = T.jackpotDuration;
      this.jackpotElapsed = 0;
      p.iframes = Math.max(p.iframes, 1.0);
      this.goldPulse();
      g.hitStopFor(0.12);
      g.flashScreen(0.5, '#f2c14e');
      g.toast('JACKPOT — the Rusted Ace turns gold', 'jackpot');
      g.emit('jackpot_started', {});
      g.setMusic('jackpot');
      g.weapon.finishReload();
    }

    goldPulse() {
      const g = this.game;
      const p = g.player;
      g.clearBullets(p.x, p.y, 240, false);
      g.explode(p.x, p.y, 220, 60 * g.damageScale(), { kind: 'spin', depth: 1, chain: this.chain('spin:jackpot'), noProc: true, color: '#f2c14e', noSelfShake: false });
      g.fx.ring(p.x, p.y, 30, 260, 0.6, '#f2c14e', 6);
      g.sfx('jackpot');
    }

    serialize() {
      return null;
    }
  }

  HE.SpinEffects = SpinEffects;
})(typeof window !== 'undefined' ? window : globalThis);
