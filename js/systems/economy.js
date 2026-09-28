/*
 * The only code allowed to change currency balances. Every mutation is
 * validated (finite, positive), rounded to whole units, and announced on the
 * event bus. A spend either succeeds completely or does nothing, so balances
 * can never go negative.
 */
(function (root) {
  'use strict';
  const ZTA = root.ZTA;
  const U = ZTA.util;

  class Economy {
    constructor(save, events) {
      this.save = save;
      this.events = events;
    }
    get cash() {
      return this.save.cash;
    }
    get blueprints() {
      return this.save.blueprints;
    }
    canAfford(cost) {
      return U.isFiniteNumber(cost) && cost >= 0 && this.save.cash >= cost;
    }

    /** Adds cash. Returns the amount actually granted (0 if rejected). */
    earn(amount, source, meta) {
      if (!U.isFiniteNumber(amount) || amount <= 0) return 0;
      const a = Math.max(1, Math.round(amount));
      this.save.cash += a;
      this.save.lifetimeCash += a;
      this.events.emit('cash:changed', { cash: this.save.cash, delta: a, source: source || 'unknown', meta: meta || null });
      return a;
    }

    /** Removes cash if affordable. Returns true on success; never partially spends. */
    trySpend(cost, reason) {
      if (!U.isFiniteNumber(cost) || cost < 0) return false;
      if (this.save.cash < cost) {
        this.events.emit('purchase:denied', { cost, cash: this.save.cash, reason: reason || '' });
        return false;
      }
      this.save.cash -= cost;
      if (this.save.cash < 0) this.save.cash = 0; // defensive; unreachable with the check above
      this.events.emit('cash:changed', { cash: this.save.cash, delta: -cost, source: reason || 'spend', meta: null });
      return true;
    }

    earnBlueprints(amount, source) {
      if (!Number.isInteger(amount) || amount <= 0) return 0;
      this.save.blueprints += amount;
      this.events.emit('blueprints:changed', { blueprints: this.save.blueprints, delta: amount, source: source || '' });
      return amount;
    }

    trySpendBlueprints(cost, reason) {
      if (!Number.isInteger(cost) || cost < 0 || this.save.blueprints < cost) return false;
      this.save.blueprints -= cost;
      this.events.emit('blueprints:changed', { blueprints: this.save.blueprints, delta: -cost, source: reason || '' });
      return true;
    }
  }

  ZTA.Economy = Economy;
})(typeof window !== 'undefined' ? window : globalThis);
