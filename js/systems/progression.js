/*
 * Ownership, upgrades and loadout. Reads definitions, writes only to the save
 * object, spends only through the Economy, and requests an immediate autosave
 * after every purchase, unlock or loadout change.
 */
(function (root) {
  'use strict';
  const ZTA = root.ZTA;
  const D = ZTA.data;
  const C = ZTA.content;

  class Progression {
    constructor(save, economy, events) {
      this.save = save;
      this.economy = economy;
      this.events = events;
      this._statsCache = new Map();
      this._rangeCache = null;
    }

    isOwned(id) {
      return this.save.owned.indexOf(id) !== -1;
    }
    levelsFor(id) {
      return this.save.weaponLevels[id] || {};
    }
    stats(id) {
      let s = this._statsCache.get(id);
      if (!s) {
        s = C.resolveWeaponStats(D.weaponById[id], this.levelsFor(id));
        this._statsCache.set(id, s);
      }
      return s;
    }
    rangeModifiers() {
      if (!this._rangeCache) this._rangeCache = C.rangeModifiers(this.save.rangeLevels);
      return this._rangeCache;
    }

    unlockWeapon(id) {
      const def = D.weaponById[id];
      if (!def) return { ok: false, reason: 'unknown weapon' };
      if (this.isOwned(id)) return { ok: false, reason: 'already owned' };
      if (!this.economy.trySpend(def.unlockCost, 'unlock:' + id)) return { ok: false, reason: 'not enough cash' };
      this.save.owned.push(id);
      let slot = this.save.equipped.indexOf(null);
      if (slot !== -1) this.save.equipped[slot] = id;
      else slot = -1;
      this.events.emit('weapon:unlocked', { weaponId: id, slot });
      if (slot !== -1) this.events.emit('loadout:changed', { equipped: this.save.equipped.slice(), activeSlot: this.save.activeSlot });
      this.events.emit('save:request', { reason: 'unlock' });
      return { ok: true, slot };
    }

    buyWeaponUpgrade(weaponId, upgId) {
      const def = D.weaponById[weaponId];
      if (!def || !this.isOwned(weaponId)) return { ok: false, reason: 'not owned' };
      const tr = C.track(def, upgId);
      if (!tr) return { ok: false, reason: 'unknown upgrade' };
      const levels = this.save.weaponLevels[weaponId] || (this.save.weaponLevels[weaponId] = {});
      const level = C.levelOf(levels, upgId, tr.max);
      if (level >= tr.max) return { ok: false, reason: 'maxed' };
      const cost = C.upgradeCost(tr, level);
      if (!this.economy.trySpend(cost, 'upgrade:' + weaponId + ':' + upgId)) return { ok: false, reason: 'not enough cash' };
      levels[upgId] = level + 1;
      this._statsCache.delete(weaponId);
      this.events.emit('upgrade:bought', { kind: 'weapon', weaponId, upgradeId: upgId, level: level + 1 });
      this.events.emit('save:request', { reason: 'upgrade' });
      return { ok: true, level: level + 1 };
    }

    buyRangeUpgrade(upgId) {
      const upg = D.rangeUpgradeById[upgId];
      if (!upg) return { ok: false, reason: 'unknown upgrade' };
      const level = C.levelOf(this.save.rangeLevels, upgId, upg.max);
      if (level >= upg.max) return { ok: false, reason: 'maxed' };
      const cost = C.upgradeCost(upg, level);
      if (!this.economy.trySpend(cost, 'range:' + upgId)) return { ok: false, reason: 'not enough cash' };
      this.save.rangeLevels[upgId] = level + 1;
      this._rangeCache = null;
      this.events.emit('upgrade:bought', { kind: 'range', upgradeId: upgId, level: level + 1 });
      this.events.emit('save:request', { reason: 'range-upgrade' });
      return { ok: true, level: level + 1 };
    }

    /** Puts an owned weapon in a slot; if it sits in another slot the two swap. */
    equip(slot, id) {
      if (!(slot >= 0 && slot <= 2) || !this.isOwned(id)) return false;
      const eq = this.save.equipped;
      if (eq[slot] === id) return true;
      const from = eq.indexOf(id);
      if (from !== -1) eq[from] = eq[slot];
      eq[slot] = id;
      if (!eq[this.save.activeSlot]) this.save.activeSlot = slot;
      this.events.emit('loadout:changed', { equipped: eq.slice(), activeSlot: this.save.activeSlot });
      this.events.emit('save:request', { reason: 'equip' });
      return true;
    }

    /** The next weapon to work toward: cheapest one not yet owned. */
    nextGoal() {
      let best = null;
      for (const w of D.weapons) {
        if (this.isOwned(w.id)) continue;
        if (!best || w.unlockCost < best.unlockCost) best = w;
      }
      if (!best) return null;
      return { weaponId: best.id, name: best.name, cost: best.unlockCost, progress: Math.min(1, this.save.cash / best.unlockCost) };
    }

    /** Cheapest purchase currently available (upgrade or unlock), for hints. */
    cheapestPurchase() {
      let min = Infinity;
      for (const id of this.save.owned) {
        const def = D.weaponById[id];
        for (const t of def.upgrades) {
          const d = C.describeWeaponUpgrade(def, this.levelsFor(id), t.id);
          if (d && !d.maxed) min = Math.min(min, d.cost);
        }
      }
      for (const u of D.rangeUpgrades) {
        const d = C.describeRangeUpgrade(u, this.save.rangeLevels);
        if (!d.maxed) min = Math.min(min, d.cost);
      }
      const goal = this.nextGoal();
      if (goal) min = Math.min(min, goal.cost);
      return min;
    }
  }

  ZTA.Progression = Progression;
})(typeof window !== 'undefined' ? window : globalThis);
