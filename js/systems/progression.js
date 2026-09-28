/*
 * Progression service: ownership, upgrades, loadout, ranges, challenges,
 * mastery, the Workshop, training lanes, collection milestones and prestige.
 *
 * Reads definitions, writes only to the save object, spends only through the
 * Economy and requests an immediate autosave after anything the player bought
 * or earned for good.
 */
(function (root) {
  'use strict';
  const ZTA = root.ZTA;
  const D = ZTA.data;
  const C = ZTA.content;
  const M = () => D.meta;

  const DAY = 86400;

  class Progression {
    constructor(save, economy, events) {
      this.save = save;
      this.economy = economy;
      this.events = events;
      this._statsCache = new Map();
      this._rangeCache = null;
      this._globals = null;
    }

    invalidate() {
      this._statsCache.clear();
      this._rangeCache = null;
      this._globals = null;
    }

    _saveNow(reason) {
      this.events.emit('save:request', { reason });
    }

    /* =========================================================== globals */

    /** Every permanent bonus combined: mastery, milestones, Workshop, charters, branches. */
    globals() {
      if (this._globals) return this._globals;
      const s = this.save;
      const g = {
        cashPct: 0,
        damagePct: 0,
        wsDamage: 0,
        reloadMult: 1,
        masteryPct: 0,
        lanePct: 0,
        offlineHours: M().lanes.baseOfflineHours,
        autoCollect: false,
        laneSlots: 0,
        perkCap: M().perkUpgrade.baseCap,
        startCombo: 0,
        comboSteps: 0,
        upgradeDiscount: 0,
        challengeCashPct: 0,
      };
      // Mastery collection bonuses.
      for (const id of Object.keys(s.mastery)) {
        const lvl = this.masteryLevel(id);
        for (let i = 0; i < lvl; i++) g.cashPct += M().mastery.levels[i].reward.cashPct || 0;
      }
      // Milestones.
      for (const m of M().milestones) {
        if (!s.milestones[m.id]) continue;
        g.cashPct += m.reward.cashPct || 0;
        g.damagePct += m.reward.damagePct || 0;
      }
      // Workshop.
      for (const n of M().workshop) {
        const lv = s.workshop[n.id] || 0;
        if (!lv) continue;
        const v = n.effect.step * lv;
        switch (n.effect.key) {
          case 'damageMult':
            g.wsDamage += v;
            break;
          case 'cashPct':
            g.cashPct += v;
            break;
          case 'reloadMult':
            g.reloadMult += v;
            break;
          case 'startCombo':
            g.startCombo += v;
            break;
          case 'masteryMult':
            g.masteryPct += v;
            break;
          case 'lanePct':
            g.lanePct += v;
            break;
          case 'offlineHours':
            g.offlineHours += v;
            break;
          case 'autoCollect':
            g.autoCollect = true;
            break;
          case 'laneSlots':
            g.laneSlots += v;
            break;
          case 'perkCap':
            g.perkCap += v;
            break;
          default:
            break;
        }
      }
      // Prestige.
      g.cashPct += M().prestige.cashPerBranch * s.prestige.branch;
      for (const id of s.prestige.charters) {
        const c = M().prestige.charters.find((x) => x.id === id);
        if (!c) continue;
        const e = c.effect;
        g.cashPct += e.cashPct || 0;
        g.damagePct += e.damagePct || 0;
        g.lanePct += e.lanePct || 0;
        g.masteryPct += e.masteryPct || 0;
        g.comboSteps += e.comboSteps || 0;
        g.challengeCashPct += e.challengeCashPct || 0;
        g.upgradeDiscount = Math.min(0.6, g.upgradeDiscount + (e.upgradeDiscount || 0));
      }
      g.cashMult = 1 + g.cashPct;
      g.damageMult = (1 + g.wsDamage) * (1 + g.damagePct);
      g.masteryMult = 1 + g.masteryPct;
      g.laneMult = 1 + g.lanePct;
      g.reloadMult = Math.max(0.5, g.reloadMult);
      this._globals = g;
      return g;
    }

    /* =========================================================== weapons */

    isOwned(id) {
      return this.save.owned.indexOf(id) !== -1;
    }
    levelsFor(id) {
      return this.save.weaponLevels[id] || {};
    }
    perkLevel(id) {
      const m = this.save.mastery[id];
      const fromMastery = this.masteryLevel(id) >= 3 ? 1 : 0;
      return fromMastery + (m ? m.perkBought : 0);
    }
    statOpts(id) {
      const g = this.globals();
      return { perkLevel: this.perkLevel(id), mods: { damageMult: g.damageMult, reloadMult: g.reloadMult } };
    }
    stats(id) {
      let s = this._statsCache.get(id);
      if (!s) {
        s = C.resolveWeaponStats(D.weaponById[id], this.levelsFor(id), this.statOpts(id));
        this._statsCache.set(id, s);
      }
      return s;
    }
    /** Family-trial stats: tier-normalized, no upgrade levels, mastery perk levels kept. */
    normalizedStats(id, rangeIndex) {
      const o = this.statOpts(id);
      return C.resolveWeaponStats(D.weaponById[id], {}, { perkLevel: o.perkLevel, normalizeTo: rangeIndex });
    }

    weaponStatus(id) {
      const def = D.weaponById[id];
      if (!def) return { ok: false, reason: 'Unknown gun' };
      if (this.isOwned(id)) return { ok: false, reason: 'Owned', owned: true };
      if (!this.isRangeUnlocked(def.requiresRange)) return { ok: false, reason: 'Requires ' + D.rangeById[def.requiresRange].name, range: def.requiresRange };
      if (this.save.cash < def.unlockCost) return { ok: false, reason: 'Not enough cash', cash: true };
      return { ok: true };
    }

    unlockWeapon(id) {
      const def = D.weaponById[id];
      if (!def) return { ok: false, reason: 'unknown weapon' };
      if (this.isOwned(id)) return { ok: false, reason: 'already owned' };
      if (!this.isRangeUnlocked(def.requiresRange)) return { ok: false, reason: 'range locked' };
      if (!this.economy.trySpend(def.unlockCost, 'unlock:' + id)) return { ok: false, reason: 'not enough cash' };
      this.save.owned.push(id);
      let slot = this.save.equipped.indexOf(null);
      if (slot !== -1) this.save.equipped[slot] = id;
      this.events.emit('weapon:unlocked', { weaponId: id, slot });
      if (slot !== -1) this.events.emit('loadout:changed', { equipped: this.save.equipped.slice(), activeSlot: this.save.activeSlot });
      this.checkMilestones();
      this._saveNow('unlock');
      return { ok: true, slot };
    }

    upgradeDiscount() {
      return this.globals().upgradeDiscount;
    }

    buyWeaponUpgrade(weaponId, upgId) {
      const def = D.weaponById[weaponId];
      if (!def || !this.isOwned(weaponId)) return { ok: false, reason: 'not owned' };
      const tr = C.trackOf(def, upgId);
      if (!tr) return { ok: false, reason: 'unknown upgrade' };
      const levels = this.save.weaponLevels[weaponId] || (this.save.weaponLevels[weaponId] = {});
      const level = C.levelOf(levels, upgId, tr.max);
      if (level >= tr.max) return { ok: false, reason: 'maxed' };
      const cost = C.upgradeCost(tr, level, this.upgradeDiscount());
      if (!this.economy.trySpend(cost, 'upgrade:' + weaponId + ':' + upgId)) return { ok: false, reason: 'not enough cash' };
      levels[upgId] = level + 1;
      this._statsCache.delete(weaponId);
      this.events.emit('upgrade:bought', { kind: 'weapon', weaponId, upgradeId: upgId, level: level + 1 });
      this._saveNow('upgrade');
      return { ok: true, level: level + 1 };
    }

    describeUpgrade(weaponId, upgId, range) {
      const o = this.statOpts(weaponId);
      return C.describeWeaponUpgrade(D.weaponById[weaponId], this.levelsFor(weaponId), upgId, { range, perkLevel: o.perkLevel, mods: o.mods, discount: this.upgradeDiscount() });
    }

    rangeModifiers() {
      if (!this._rangeCache) this._rangeCache = C.rangeModifiers(this.save.rangeLevels);
      return this._rangeCache;
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
      this._saveNow('range-upgrade');
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
      this._saveNow('equip');
      return true;
    }

    toggleFavorite(id) {
      const f = this.save.favorites;
      const i = f.indexOf(id);
      if (i === -1) f.push(id);
      else f.splice(i, 1);
      this._saveNow('favorite');
      return i === -1;
    }

    /** The next weapon to work toward: cheapest one not owned whose range is open. */
    nextGoal() {
      let best = null;
      for (const w of D.weapons) {
        if (this.isOwned(w.id) || !this.isRangeUnlocked(w.requiresRange)) continue;
        if (!best || w.unlockCost < best.unlockCost) best = w;
      }
      if (best) return { kind: 'gun', id: best.id, name: best.name, cost: best.unlockCost, progress: Math.min(1, this.save.cash / Math.max(1, best.unlockCost)) };
      const r = this.nextRange();
      if (r) {
        const st = this.rangeStatus(r.id);
        return { kind: 'range', id: r.id, name: r.name, cost: r.unlock.cost, progress: Math.min(1, this.save.cash / r.unlock.cost), blocked: !st.requirementMet };
      }
      return null;
    }

    /** Cheapest purchase currently possible (for hints). */
    cheapestPurchase(range) {
      let min = Infinity;
      for (const id of this.save.owned) {
        for (const t of D.weaponById[id].upgrades) {
          const d = this.describeUpgrade(id, t.id, range);
          if (d && !d.maxed) min = Math.min(min, d.cost);
        }
      }
      for (const u of D.rangeUpgrades) {
        const d = C.describeRangeUpgrade(u, this.save.rangeLevels);
        if (!d.maxed) min = Math.min(min, d.cost);
      }
      const goal = this.nextGoal();
      if (goal && !goal.blocked) min = Math.min(min, goal.cost);
      return min;
    }

    /* ============================================================ ranges */

    isRangeUnlocked(id) {
      return this.save.rangesUnlocked.indexOf(id) !== -1;
    }
    highestRange() {
      let best = D.ranges[0];
      for (const r of D.ranges) if (this.isRangeUnlocked(r.id) && r.index > best.index) best = r;
      return best;
    }
    nextRange() {
      return D.ranges.find((r) => !this.isRangeUnlocked(r.id)) || null;
    }
    rangeStatus(id) {
      const r = D.rangeById[id];
      const req = r.unlock.requires;
      const reqMet = !req || this.challengeStars(req.challenge) >= req.stars;
      return {
        unlocked: this.isRangeUnlocked(id),
        cost: r.unlock.cost,
        requirement: req ? { challenge: req.challenge, name: D.challengeById[req.challenge].name, stars: req.stars } : null,
        requirementMet: reqMet,
        affordable: this.save.cash >= r.unlock.cost,
        previousUnlocked: r.index === 1 || this.isRangeUnlocked(D.ranges[r.index - 2].id),
      };
    }
    unlockRange(id) {
      const r = D.rangeById[id];
      if (!r) return { ok: false, reason: 'unknown range' };
      const st = this.rangeStatus(id);
      if (st.unlocked) return { ok: false, reason: 'already unlocked' };
      if (!st.previousUnlocked) return { ok: false, reason: 'unlock the previous range first' };
      if (!st.requirementMet) return { ok: false, reason: 'requirement not met' };
      if (!this.economy.trySpend(r.unlock.cost, 'range-unlock:' + id)) return { ok: false, reason: 'not enough cash' };
      this.save.rangesUnlocked.push(id);
      this.save.rangesUnlocked = D.ranges.filter((x) => this.isRangeUnlocked(x.id)).map((x) => x.id);
      this.events.emit('range:unlocked', { rangeId: id });
      this._saveNow('range-unlock');
      return { ok: true };
    }

    /* ======================================================== challenges */

    challengeStars(id) {
      const r = this.save.challenges[id];
      return r ? r.stars : 0;
    }
    totalStars() {
      let n = 0;
      for (const id of Object.keys(this.save.challenges)) n += this.save.challenges[id].stars;
      return n;
    }
    challengeStatus(id) {
      const c = D.challengeById[id];
      if (!c) return { ok: false, reason: 'Unknown challenge' };
      const r = D.rangeById[c.range];
      if (!this.isRangeUnlocked(c.range)) return { ok: false, reason: 'Unlock ' + r.name + ' first' };
      if (c.needs) {
        const done = D.challenges.filter((x) => x.range === c.range && !x.boss && this.challengeStars(x.id) > 0).length;
        if (done < c.needs) return { ok: false, reason: 'Earn a star on ' + c.needs + ' challenges here to call it (' + done + '/' + c.needs + ')' };
      }
      if (c.families && !this.save.owned.some((w) => c.families.indexOf(D.weaponById[w].family) !== -1)) {
        return { ok: false, reason: 'Needs a ' + c.families.map((f) => D.families[f].label.toLowerCase()).join(' or ') };
      }
      return { ok: true };
    }
    modifiersUnlocked() {
      return M().modifiers.filter((m) => m.branch <= this.save.prestige.branch);
    }

    /** Stars earned for a metric value. */
    starsFor(c, value, completed) {
      if (c.metric === 'bossTime') {
        if (!completed) return 0;
        return c.stars.filter((t) => value <= t).length;
      }
      return c.stars.filter((t) => value >= t).length;
    }

    /**
     * Records a finished run and pays its rewards. Blueprint Tokens are paid
     * once per newly earned star (and once per modifier cleared).
     */
    recordChallenge(id, value, completed, modId) {
      const c = D.challengeById[id];
      const range = D.rangeById[c.range];
      const stars = this.starsFor(c, value, completed);
      const rec = this.save.challenges[id] || (this.save.challenges[id] = { stars: 0, best: null, clears: 0, modStars: {} });
      const prevStars = rec.stars;
      let blueprints = 0;
      for (let i = prevStars; i < stars; i++) blueprints += c.reward.blueprints[i];
      const mod = modId ? M().modifiers.find((m) => m.id === modId) : null;
      let modStar = false;
      if (mod && stars > 0 && !rec.modStars[mod.id]) {
        rec.modStars[mod.id] = true;
        blueprints += 1;
        modStar = true;
      }
      const lower = c.metric === 'bossTime';
      let newBest = false;
      if (completed || !lower) {
        if (rec.best == null || (lower ? value < rec.best : value > rec.best)) {
          rec.best = value;
          newBest = true;
        }
      }
      rec.stars = Math.max(prevStars, stars);
      let cash = 0;
      if (stars > 0) {
        const first = rec.clears === 0;
        rec.clears++;
        const g = this.globals();
        cash = c.reward.cash * range.valueMult * stars * (first ? 1 : 0.5) * (1 + g.challengeCashPct) * (mod ? mod.rewardMult : 1) * g.cashMult;
        cash = this.economy.earn(cash, 'challenge', { challengeId: id });
      }
      if (blueprints) this.economy.earnBlueprints(blueprints, 'challenge:' + id);
      this.save.stats.challengeRuns += 1;
      const summary = { challengeId: id, value, completed, stars, prevStars, newStars: Math.max(0, stars - prevStars), blueprints, cash, newBest, best: rec.best, modStar };
      this.events.emit('challenge:recorded', summary);
      this._saveNow('challenge');
      return summary;
    }

    /* =========================================================== mastery */

    masteryEntry(id) {
      return this.save.mastery[id] || (this.save.mastery[id] = { xp: 0, claimed: 0, obj: 0, objDone: false, finish: 'fin.factory', perkBought: 0 });
    }
    masteryLevel(id) {
      const m = this.save.mastery[id];
      if (!m) return 0;
      let lvl = 0;
      for (const L of M().mastery.levels) if (m.xp >= L.xp) lvl++;
      return lvl;
    }
    masteryInfo(id) {
      const m = this.save.mastery[id] || { xp: 0 };
      const levels = M().mastery.levels;
      const lvl = this.masteryLevel(id);
      const prev = lvl > 0 ? levels[lvl - 1].xp : 0;
      const next = lvl < levels.length ? levels[lvl].xp : null;
      return { level: lvl, max: levels.length, xp: m.xp, prev, next, progress: next == null ? 1 : (m.xp - prev) / (next - prev), levels };
    }
    addMasteryXp(id, amount) {
      if (!D.weaponById[id] || !(amount > 0)) return 0;
      const m = this.masteryEntry(id);
      const before = this.masteryLevel(id);
      const add = amount * this.globals().masteryMult;
      m.xp += add;
      const after = this.masteryLevel(id);
      if (after > before) {
        const levels = M().mastery.levels;
        for (let i = m.claimed; i < after; i++) {
          const bp = levels[i].reward.blueprints || 0;
          if (bp) this.economy.earnBlueprints(bp, 'mastery:' + id);
        }
        m.claimed = Math.max(m.claimed, after);
        this.invalidate();
        for (let l = before + 1; l <= after; l++) this.events.emit('mastery:level', { weaponId: id, level: l, label: M().mastery.levels[l - 1].label });
        this._saveNow('mastery');
      }
      return add;
    }
    objectiveFor(id) {
      const def = D.weaponById[id];
      const o = M().objectives[def.perk.id] || M().objectives.default;
      const m = this.save.mastery[id];
      return { metric: o.metric, goal: o.goal, text: o.text, progress: m ? Math.min(o.goal, m.obj) : 0, done: !!(m && m.objDone) };
    }
    trackObjective(id, metric, amount) {
      const o = this.objectiveFor(id);
      if (o.done || o.metric !== metric) return;
      const m = this.masteryEntry(id);
      m.obj += amount || 1;
      if (m.obj >= o.goal) {
        m.obj = o.goal;
        m.objDone = true;
        this.economy.earnBlueprints(1, 'objective:' + id);
        this.addMasteryXp(id, 100);
        this.events.emit('objective:done', { weaponId: id, text: o.text });
        this._saveNow('objective');
      }
    }
    finishesFor(id) {
      const lvl = this.masteryLevel(id);
      const out = ['fin.factory'];
      if (lvl >= 2) out.push('fin.brushed');
      if (lvl >= 4) out.push('fin.halftone');
      if (this.save.milestones['ms.10']) out.push('fin.tiger');
      if (lvl >= 5) out.push('fin.brass');
      return out;
    }
    setFinish(id, finishId) {
      if (!this.isOwned(id) || this.finishesFor(id).indexOf(finishId) === -1) return false;
      this.masteryEntry(id).finish = finishId;
      this.events.emit('finish:changed', { weaponId: id, finish: finishId });
      this._saveNow('finish');
      return true;
    }
    finishOf(id) {
      const m = this.save.mastery[id];
      const f = m ? m.finish : 'fin.factory';
      return this.finishesFor(id).indexOf(f) !== -1 ? f : 'fin.factory';
    }
    perkUpgradeInfo(id) {
      const m = this.save.mastery[id];
      const bought = m ? m.perkBought : 0;
      const cap = this.globals().perkCap;
      const costs = M().perkUpgrade.costs;
      return { bought, cap, level: this.perkLevel(id), cost: bought < Math.min(cap, costs.length) ? costs[bought] : null };
    }
    buyPerkUpgrade(id) {
      if (!this.isOwned(id)) return { ok: false, reason: 'not owned' };
      const info = this.perkUpgradeInfo(id);
      if (info.cost == null) return { ok: false, reason: 'maxed' };
      if (!this.economy.trySpendBlueprints(info.cost, 'perk:' + id)) return { ok: false, reason: 'not enough blueprints' };
      this.masteryEntry(id).perkBought += 1;
      this._statsCache.delete(id);
      this.events.emit('upgrade:bought', { kind: 'perk', weaponId: id, level: this.perkLevel(id) });
      this._saveNow('perk');
      return { ok: true };
    }

    /* ========================================================== workshop */

    workshopInfo(nodeId) {
      const n = M().workshop.find((x) => x.id === nodeId);
      const lv = this.save.workshop[nodeId] || 0;
      return { node: n, level: lv, maxed: lv >= n.max, cost: lv < n.max ? n.costs[lv] : null };
    }
    buyWorkshop(nodeId) {
      const info = this.workshopInfo(nodeId);
      if (!info.node) return { ok: false, reason: 'unknown' };
      if (info.maxed) return { ok: false, reason: 'maxed' };
      if (!this.economy.trySpendBlueprints(info.cost, 'workshop:' + nodeId)) return { ok: false, reason: 'not enough blueprints' };
      this.save.workshop[nodeId] = info.level + 1;
      this.invalidate();
      this.events.emit('upgrade:bought', { kind: 'workshop', upgradeId: nodeId, level: info.level + 1 });
      this._saveNow('workshop');
      return { ok: true };
    }

    /* ============================================================= lanes */

    lanesAvailable() {
      return this.isRangeUnlocked(M().lanes.requiresRange);
    }
    laneCount() {
      return this.save.lanes.unlocked + (this.save.lanes.unlocked > 0 ? this.globals().laneSlots : 0);
    }
    nextLaneCost() {
      const costs = M().lanes.unlockCosts;
      return this.save.lanes.unlocked < costs.length ? costs[this.save.lanes.unlocked] : null;
    }
    unlockLane() {
      if (!this.lanesAvailable()) return { ok: false, reason: 'locked' };
      const cost = this.nextLaneCost();
      if (cost == null) return { ok: false, reason: 'maxed' };
      if (!this.economy.trySpend(cost, 'lane')) return { ok: false, reason: 'not enough cash' };
      this.save.lanes.unlocked += 1;
      this.events.emit('lanes:changed', {});
      this._saveNow('lane');
      return { ok: true };
    }
    assignLane(i, gunId) {
      if (i < 0 || i >= this.laneCount()) return false;
      if (gunId != null && !this.isOwned(gunId)) return false;
      const guns = this.save.lanes.guns;
      if (gunId != null) {
        const j = guns.indexOf(gunId);
        if (j !== -1) guns[j] = null;
      }
      guns[i] = gunId;
      this.events.emit('lanes:changed', {});
      this._saveNow('lane');
      return true;
    }
    /** Cash per second one gun earns in a lane. */
    laneGunRate(gunId) {
      const r = this.highestRange();
      const plate = D.targetById['tgt.plate'];
      const breaksPerSec = Math.min(2.5, C.dps(this.stats(gunId)) / (plate.hp * r.hpMult));
      const g = this.globals();
      return breaksPerSec * plate.value * r.valueMult * M().lanes.efficiency * g.laneMult * g.cashMult;
    }
    laneRate() {
      let total = 0;
      const n = this.laneCount();
      for (let i = 0; i < n; i++) {
        const id = this.save.lanes.guns[i];
        if (id && this.isOwned(id)) total += this.laneGunRate(id);
      }
      return total;
    }
    laneCap() {
      return this.laneRate() * this.globals().offlineHours * 3600;
    }
    /**
     * Accrues lane cash for the wall-clock time since the last tick.
     * Conservative: whole seconds only; a clock that moved backwards or a
     * non-number resets the anchor and pays nothing; gaps are capped at
     * maxOfflineDays and storage never exceeds the lane cap. Never pays
     * Blueprint Tokens.
     */
    tickLanes(now) {
      const L = this.save.lanes;
      if (!(L.lastTick > 0)) {
        L.lastTick = now;
        return { gained: 0, elapsed: 0 };
      }
      let elapsed = Math.floor((now - L.lastTick) / 1000);
      if (!(elapsed > 0)) {
        if (!(now >= L.lastTick)) L.lastTick = now;
        return { gained: 0, elapsed: 0 };
      }
      elapsed = Math.min(elapsed, M().lanes.maxOfflineDays * DAY);
      L.lastTick += elapsed * 1000;
      if (L.lastTick > now || now - L.lastTick > DAY) L.lastTick = now;
      const rate = this.laneRate();
      if (!(rate > 0)) return { gained: 0, elapsed };
      const room = Math.max(0, this.laneCap() - L.stored);
      const gained = Math.min(room, rate * elapsed);
      L.stored += gained;
      if (gained > 0) this.events.emit('lanes:tick', { stored: L.stored, gained });
      return { gained, elapsed, capped: gained < rate * elapsed };
    }
    collectLanes() {
      const L = this.save.lanes;
      if (!(L.stored >= 1)) return 0;
      const amount = Math.floor(L.stored);
      L.stored -= amount;
      const got = this.economy.earn(amount, 'lanes');
      this.events.emit('lanes:collected', { amount: got });
      return got;
    }

    /* ======================================================== milestones */

    checkMilestones() {
      const n = this.save.owned.length;
      for (const m of M().milestones) {
        if (this.save.milestones[m.id] || n < m.count) continue;
        this.save.milestones[m.id] = true;
        if (m.reward.blueprints) this.economy.earnBlueprints(m.reward.blueprints, 'milestone:' + m.id);
        this.invalidate();
        this.events.emit('milestone:reached', { id: m.id, count: m.count, label: m.label });
      }
    }

    /* ========================================================== prestige */

    prestigeAvailable() {
      const u = M().prestige.unlock;
      return this.challengeStars(u.challenge) >= u.stars;
    }
    /** Three charter choices for the next branch, stable for a given branch number. */
    charterOptions() {
      const all = M().prestige.charters.slice();
      const rng = ZTA.createRng(7919 * (this.save.prestige.branch + 1) + this.save.prestige.charters.length);
      const out = [];
      while (out.length < 3 && all.length) out.push(all.splice(Math.floor(rng.next() * all.length), 1)[0]);
      return out;
    }
    prestigePreview() {
      const next = this.save.prestige.branch + 1;
      const mod = M().modifiers.find((m) => m.branch === next);
      return {
        branch: next,
        cashBonus: M().prestige.cashPerBranch * next,
        resets: M().prestige.resets,
        keeps: M().prestige.keeps,
        modifier: mod || null,
        charters: this.charterOptions(),
        lostCash: this.save.cash,
      };
    }
    openBranch(charterId, now) {
      if (!this.prestigeAvailable()) return { ok: false, reason: 'locked' };
      const options = this.charterOptions();
      const charter = options.find((c) => c.id === charterId);
      if (!charter) return { ok: false, reason: 'choose a charter' };
      const s = this.save;
      s.prestige.branch += 1;
      s.prestige.charters.push(charter.id);
      let startCash = 0;
      let startRange = null;
      for (const id of s.prestige.charters) {
        const c = M().prestige.charters.find((x) => x.id === id);
        if (c && c.effect.startCash) startCash = Math.max(startCash, c.effect.startCash);
        if (c && c.effect.startRange) startRange = c.effect.startRange;
      }
      s.cash = 0;
      s.branchCash = 0;
      s.rangeLevels = {};
      s.weaponLevels = {};
      s.rangesUnlocked = [D.START_RANGE];
      if (startRange) s.rangesUnlocked.push(startRange);
      s.rangeId = D.START_RANGE;
      s.lanes = { unlocked: 0, guns: [null, null, null, null, null], stored: 0, lastTick: now == null ? Date.now() : now };
      s.flags.rangeIntro = {};
      this.invalidate();
      if (startCash) this.economy.earn(startCash, 'charter');
      this.events.emit('prestige:opened', { branch: s.prestige.branch, charter: charter.id });
      this._saveNow('prestige');
      return { ok: true, branch: s.prestige.branch };
    }
  }

  ZTA.Progression = Progression;
})(typeof window !== 'undefined' ? window : globalThis);
