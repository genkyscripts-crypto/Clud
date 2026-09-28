/*
 * Game: owns the simulation (no DOM, no canvas) so it can run headless in
 * tests. Rendering, audio and UI subscribe to its events.
 *
 * The simulation only advances while `live` is true (playing, no overlay).
 * Pausing therefore freezes timers, cadence, reloads, waves and combo alike.
 */
(function (root) {
  'use strict';
  const ZTA = root.ZTA;
  const D = ZTA.data;

  class Game {
    constructor(opts) {
      const o = opts || {};
      this.events = o.events || new ZTA.Emitter();
      this.save = o.save || ZTA.SaveSystem.createDefault();
      this.rng = ZTA.createRng(o.seed == null ? (Date.now() ^ 0x5eed) >>> 0 : o.seed);
      this.economy = new ZTA.Economy(this.save, this.events);
      this.progression = new ZTA.Progression(this.save, this.economy, this.events);
      this.camera = new ZTA.Camera(D.range);
      this.combo = new ZTA.Combo(this.events);
      this.targets = new ZTA.TargetManager(this.events, D.range);
      this.director = new ZTA.RangeDirector(this);
      this.weapons = new ZTA.WeaponController(this);
      this.aim = { x: this.camera.cx, y: this.camera.cy };
      this.time = 0;
      this.live = false;
      this.started = false;
      this.rewardsGranted = 0;

      this.events.on('loadout:changed', () => this.weapons.onLoadoutChanged());
      this.events.on('upgrade:bought', (e) => {
        if (e.kind === 'weapon') this.weapons.onStatsChanged(e.weaponId);
      });
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

    update(dt) {
      if (!this.live) return;
      this.time += dt;
      this.save.stats.playTime += dt;
      this.camera.update(dt, this.weapons.stats.recoil.recovery);
      this.targets.update(dt);
      this.weapons.update(dt);
      this.director.update(dt);
      this.combo.update(dt, this.director.isActive());
      if (this.combo.mult > this.save.stats.bestCombo) this.save.stats.bestCombo = this.combo.mult;
    }

    /** Pays for a broken target. Guarded so each target pays exactly once. */
    rewardBreak(target, ctx) {
      if (target.rewarded || target.state === 'active') return 0;
      target.rewarded = true;
      const mods = this.progression.rangeModifiers();
      let amount = target.def.value * mods.cashMult * this.combo.mult;
      if (ctx.weak) amount *= 1 + mods.weakBreakBonus;
      amount *= ctx.perkMult || 1;
      const granted = this.economy.earn(amount, 'target', { targetId: target.def.id, weaponId: ctx.weaponId });
      this.rewardsGranted += 1;
      this.save.stats.breaks += 1;
      const g = this._gunStats(ctx.weaponId);
      g.breaks += 1;
      this.director.onReward(granted);
      this.events.emit('target:broken', {
        target,
        amount: granted,
        weak: !!ctx.weak,
        multi: ctx.breakCount > 1 ? ctx.breakIndex + 1 : 0,
        perkBonus: (ctx.perkMult || 1) > 1,
      });
      return granted;
    }

    recordShot(weaponId, result) {
      const s = this.save.stats;
      const g = this._gunStats(weaponId);
      s.shots += 1;
      g.shots += 1;
      if (result.anyHit) {
        s.hits += 1;
        g.hits += 1;
      }
      if (result.weakHits > 0) s.weakHits += 1;
      this.director.onShot(result);
    }

    _gunStats(id) {
      return this.save.perGun[id] || (this.save.perGun[id] = { shots: 0, hits: 0, breaks: 0 });
    }
  }

  ZTA.Game = Game;
})(typeof window !== 'undefined' ? window : globalThis);
