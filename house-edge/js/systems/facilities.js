/*
 * Account facilities (Milestone 1 ships Slot Alley).
 *
 * Production runs while the game is open and while it is closed, capped at
 * `offlineCapHours` of output held in storage. Clock rollback is handled
 * conservatively: time moving backwards pays nothing and simply re-anchors
 * the clock. Collection moves the whole stored amount in one step, so it can
 * never be collected twice.
 */
(function (root) {
  'use strict';
  const HE = root.HE;
  const D = HE.data;

  function createState(now) {
    return { level: 0, stored: 0, lastTick: now };
  }

  function rateMult(def, level) {
    let m = 1;
    for (const ms of def.milestones) if (ms.rateMult && level >= ms.level) m *= ms.rateMult;
    return m;
  }

  /** Chips per second at a level. Level 0 produces nothing. */
  function rate(def, level) {
    if (level <= 0) return 0;
    return def.baseRate * Math.pow(def.rateGrowth, level - 1) * rateMult(def, level);
  }

  /** Cost to buy the level after `level`. */
  function cost(def, level) {
    return Math.round(def.baseCost * Math.pow(def.costGrowth, level));
  }

  function cap(def, level) {
    return rate(def, level) * def.offlineCapHours * 3600;
  }

  function unlocks(def, level) {
    const out = [];
    for (const ms of def.milestones) if (ms.unlock && level >= ms.level) out.push(ms.unlock);
    return out;
  }

  /**
   * Advances production to `now` (ms). Returns a report used by the offline
   * popup: elapsed seconds counted, gain, whether the cap was hit, and whether
   * the clock was found to have moved backwards.
   */
  function tick(state, def, now) {
    const report = { elapsed: 0, gain: 0, capped: false, rolledBack: false, rate: rate(def, state.level), cap: cap(def, state.level) };
    if (!HE.util.isNum(state.lastTick)) {
      state.lastTick = now;
      return report;
    }
    const dtMs = now - state.lastTick;
    if (dtMs < 0) {
      report.rolledBack = true;
      state.lastTick = now;
      return report;
    }
    const maxSec = def.offlineCapHours * 3600;
    const sec = Math.min(dtMs / 1000, maxSec);
    report.elapsed = sec;
    state.lastTick = now;
    if (report.rate <= 0) return report;
    const room = Math.max(0, report.cap - state.stored);
    const gain = Math.min(room, report.rate * sec);
    state.stored += gain;
    report.gain = gain;
    report.capped = state.stored >= report.cap - 1e-6;
    return report;
  }

  /** Moves whole stored chips to the bank. Returns the amount collected. */
  function collect(state, account) {
    const amount = Math.floor(state.stored);
    if (amount <= 0) return 0;
    state.stored -= amount;
    account.banked += amount;
    account.lifetimeBanked += amount;
    account.lifetimeFacility = (account.lifetimeFacility || 0) + amount;
    return amount;
  }

  /** Buys the next level. Production is ticked first so the old rate applies to past time. */
  function buyLevel(state, def, account, now) {
    if (state.level >= def.maxLevel) return { ok: false, reason: 'max' };
    const c = cost(def, state.level);
    tick(state, def, now);
    if (!HE.Economy.spendBanked(account, c)) return { ok: false, reason: 'funds', cost: c };
    state.level += 1;
    const newly = def.milestones.filter((m) => m.level === state.level);
    return { ok: true, cost: c, level: state.level, milestones: newly };
  }

  HE.Facilities = { createState, rate, cost, cap, unlocks, tick, collect, buyLevel };
})(typeof window !== 'undefined' ? window : globalThis);
