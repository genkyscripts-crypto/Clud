/*
 * Combo multiplier.
 *  - Each hitting shot adds a step (weak-point hits add two).
 *  - A shot that hits nothing removes two steps (gradual, never a full reset).
 *  - After a grace period without hits the meter drains slowly.
 *  - Between waves the meter is frozen, so reset downtime never costs combo.
 * The multiplier moves in clean 0.1 increments and caps at ×2.5.
 */
(function (root) {
  'use strict';
  const ZTA = root.ZTA;

  const CONFIG = {
    perStep: 0.1,
    maxSteps: 15,
    weakSteps: 2,
    missPenalty: 2,
    graceTime: 2.5,
    drainPerSecond: 2,
    tiers: [5, 10, 15, 20],
  };

  class Combo {
    constructor(events) {
      this.events = events;
      this.cfg = CONFIG;
      this.steps = 0;
      this.sinceHit = 0;
      this.extraSteps = 0;
    }
    /** Cap in steps: ×2.5 by default, raised by the Showman charter. */
    get maxSteps() {
      return this.cfg.maxSteps + this.extraSteps;
    }
    get atCap() {
      return this.whole >= this.maxSteps;
    }
    get whole() {
      return Math.floor(this.steps + 1e-9);
    }
    get mult() {
      return 1 + this.cfg.perStep * this.whole;
    }
    get tier() {
      let t = 0;
      for (const th of this.cfg.tiers) if (this.whole >= th) t++;
      return t;
    }
    _emit(prevWhole, prevTier, reason) {
      if (this.whole === prevWhole) return;
      const tier = this.tier;
      this.events.emit('combo:changed', { mult: this.mult, steps: this.steps, tier, tierUp: tier > prevTier, reason });
    }
    registerHit(anyWeak, gainMult) {
      const pw = this.whole;
      const pt = this.tier;
      const gain = (anyWeak ? this.cfg.weakSteps : 1) * (gainMult || 1);
      this.steps = Math.min(this.maxSteps, this.steps + gain);
      this.sinceHit = 0;
      this._emit(pw, pt, 'hit');
    }
    registerMiss() {
      const pw = this.whole;
      const pt = this.tier;
      this.steps = Math.max(0, this.steps - this.cfg.missPenalty);
      this._emit(pw, pt, 'miss');
    }
    /** `active` is false between waves: the meter is frozen. */
    update(dt, active) {
      if (!active || this.steps <= 0) return;
      this.sinceHit += dt;
      if (this.sinceHit <= this.cfg.graceTime) return;
      const pw = this.whole;
      const pt = this.tier;
      this.steps = Math.max(0, this.steps - this.cfg.drainPerSecond * dt);
      this._emit(pw, pt, 'drain');
    }
    /** Called at the start of a wave or round: restarts the grace timer and applies any head start. */
    touch(minSteps) {
      this.sinceHit = 0;
      if (minSteps > this.steps) {
        const pw = this.whole;
        const pt = this.tier;
        this.steps = Math.min(this.maxSteps, minSteps);
        this._emit(pw, pt, 'start');
      }
    }
    reset() {
      const pw = this.whole;
      const pt = this.tier;
      this.steps = 0;
      this.sinceHit = 0;
      this._emit(pw, pt, 'reset');
    }
  }

  ZTA.Combo = Combo;
})(typeof window !== 'undefined' ? window : globalThis);
