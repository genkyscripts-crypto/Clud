/*
 * The only code that changes chip balances.
 *
 *  - Loose chips belong to the active run (wallet). Shops and wagers spend them.
 *  - Banked chips belong to the account. Casino upgrades spend them.
 *  - Spin charge is a combat meter and never touches this module.
 *
 * Every credit carries an economic origin. Only 'natural' combat income gets
 * the carried-winnings multiplier or can trigger income perks; transfers and
 * returned stakes are never counted as newly earned.
 */
(function (root) {
  'use strict';
  const HE = root.HE;
  const D = HE.data;
  const E = D.TUNING.economy;

  const ORIGINS = ['natural', 'room_bonus', 'facility', 'refund', 'wager_return', 'bank_transfer', 'recovery', 'debug'];

  function createWallet() {
    return {
      loose: 0,
      escrow: 0,
      multiplier: 1,
      heat: 0,
      frac: 0,
      earned: { natural: 0, room_bonus: 0, wager_return: 0, refund: 0, debug: 0 },
      naturalBase: 0,
      spent: 0,
      wagers: [],
      pressed: 0,
    };
  }

  /**
   * Credits loose chips. Natural income is multiplied by the carried-winnings
   * multiplier; fractions accumulate so small drops are never lost.
   * Returns the whole chips actually credited.
   */
  function earn(w, amount, origin) {
    if (!(amount > 0)) return 0;
    if (!ORIGINS.includes(origin)) throw new Error('unknown economic origin ' + origin);
    let value = amount;
    if (origin === 'natural') value = amount * w.multiplier;
    const total = value + w.frac;
    const whole = Math.floor(total + 1e-9);
    w.frac = total - whole;
    w.loose += whole;
    if (w.earned[origin] != null) w.earned[origin] += whole;
    if (origin === 'natural') w.naturalBase += amount;
    return whole;
  }

  /** Chips gained from the carried-winnings multiplier so far. */
  function multiplierBonus(w) {
    return Math.max(0, w.earned.natural - Math.floor(w.naturalBase));
  }

  /** All-or-nothing spend of loose chips. */
  function spend(w, amount) {
    amount = Math.floor(amount);
    if (!(amount > 0) || w.loose < amount) return false;
    w.loose -= amount;
    w.spent += amount;
    return true;
  }

  function stakeOptions(w) {
    const out = [];
    for (const s of D.WAGER_STAKES) if (s <= w.loose) out.push(s);
    if (!out.length && w.loose >= 5) out.push(Math.floor(w.loose));
    return out;
  }

  /** Terms shown to the player before accepting. */
  function wagerTerms(stake) {
    return { stake, payout: stake * 2, profit: stake, lossOnFail: stake };
  }

  /**
   * Escrows a stake. Only one ordinary wager can be active at a time.
   * Returns the wager record, or null if it cannot be placed.
   */
  function placeWager(w, defId, stake, uid) {
    const def = D.wagerById[defId];
    if (!def) return null;
    stake = Math.floor(stake);
    if (!(stake > 0) || w.loose < stake) return null;
    if (w.wagers.some((x) => !x.settled)) return null;
    w.loose -= stake;
    w.escrow += stake;
    const terms = wagerTerms(stake);
    const rec = { uid, defId, stake, payout: terms.payout, status: 'active', settled: false, progress: 0 };
    w.wagers.push(rec);
    return rec;
  }

  /**
   * Settles a wager exactly once. Success returns stake + profit as a
   * 'wager_return' credit; failure consumes only the escrowed stake.
   */
  function settleWager(w, rec, success) {
    if (!rec || rec.settled) return 0;
    rec.settled = true;
    rec.status = success ? 'won' : 'lost';
    w.escrow = Math.max(0, w.escrow - rec.stake);
    if (success) return earn(w, rec.payout, 'wager_return');
    return 0;
  }

  function activeWager(w) {
    for (const x of w.wagers) if (!x.settled) return x;
    return null;
  }

  /** Fails any unsettled wager (death, abandon, load recovery). */
  function failOpenWagers(w) {
    let lost = 0;
    for (const x of w.wagers) {
      if (!x.settled) {
        lost += x.stake;
        settleWager(w, x, false);
      }
    }
    return lost;
  }

  /** Moves all loose chips to the account. Resets multiplier and heat. */
  function bank(w, account) {
    const amount = Math.floor(w.loose);
    w.loose = 0;
    w.frac = 0;
    account.banked += amount;
    account.lifetimeBanked += amount;
    w.multiplier = 1;
    w.heat = 0;
    w.pressed = 0;
    return amount;
  }

  /** PRESS ON: carry chips forward; the next floor pays more and runs hotter. */
  function pressOn(w) {
    w.pressed += 1;
    w.multiplier = Math.min(E.pressCap, 1 + E.pressStep * w.pressed);
    w.heat += 1;
    return { multiplier: w.multiplier, heat: w.heat };
  }

  /** Preview of both terminal choices, shown before the player picks. */
  function terminalPreview(w) {
    const nextPressed = w.pressed + 1;
    return {
      loose: w.loose,
      bank: { banked: w.loose, nextMultiplier: 1, nextHeat: 0 },
      press: { carried: w.loose, nextMultiplier: Math.min(E.pressCap, 1 + E.pressStep * nextPressed), nextHeat: w.heat + 1 },
    };
  }

  /**
   * Defeat: recover a share of loose, unstaked chips into the bank. Escrowed
   * stakes are consumed by their failed wagers first.
   */
  function defeatRecovery(w, account, rate) {
    failOpenWagers(w);
    const r = rate == null ? E.deathRecovery : rate;
    const loose = Math.floor(w.loose);
    const recovered = Math.floor(loose * r);
    w.loose = 0;
    w.frac = 0;
    account.banked += recovered;
    account.lifetimeBanked += recovered;
    return { loose, rate: r, recovered, lost: loose - recovered };
  }

  /** All-or-nothing spend of banked chips. */
  function spendBanked(account, amount) {
    amount = Math.floor(amount);
    if (!(amount > 0) || account.banked < amount) return false;
    account.banked -= amount;
    return true;
  }

  HE.Economy = {
    ORIGINS,
    createWallet,
    earn,
    multiplierBonus,
    spend,
    stakeOptions,
    wagerTerms,
    placeWager,
    settleWager,
    activeWager,
    failOpenWagers,
    bank,
    pressOn,
    terminalPreview,
    defeatRecovery,
    spendBanked,
  };
})(typeof window !== 'undefined' ? window : globalThis);
