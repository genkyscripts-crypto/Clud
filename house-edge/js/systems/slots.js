/*
 * The combat slot machine: pure logic, no rendering, no DOM.
 *
 * Resolution order for every spin (documented and tested):
 *   1. apply loadout weights           (per-reel symbol weights)
 *   2. apply held results              (a held reel keeps its last symbol)
 *   3. draw unheld results             (weighted draw from the reel stream)
 *   4. apply an announced guarantee    (hook; no M1 content announces one)
 *   5. apply an eligible wildcard      (hook; no M1 content grants one)
 *   6. classify the final result       (mixed / pair / triple / jackpot)
 *   7. emit combat effects             (done by the caller: game/spins.js)
 *
 * The displayed probabilities come from `odds()`, which enumerates exactly
 * the same weights and holds that `spin()` uses. There is no decorative
 * number anywhere.
 */
(function (root) {
  'use strict';
  const HE = root.HE;
  const D = HE.data;
  const T = D.TUNING.slots;

  const SYMS = D.symbolIds;
  const CHARGE_CAP = 200;

  function uniformWeights() {
    return SYMS.map(() => 1);
  }

  function classify(symbols) {
    const [a, b, c] = symbols;
    if (a === b && b === c) {
      return { kind: a === 'seven' ? 'jackpot' : 'triple', symbol: a, other: null };
    }
    if (a === b) return { kind: 'pair', symbol: a, other: c };
    if (a === c) return { kind: 'pair', symbol: a, other: b };
    if (b === c) return { kind: 'pair', symbol: b, other: a };
    return { kind: 'mixed', symbol: null, other: null };
  }

  class SlotMachine {
    /**
     * @param {object} rng  the dedicated reel stream (HE.createRng)
     */
    constructor(rng) {
      this.rng = rng;
      this.weights = [uniformWeights(), uniformWeights(), uniformWeights()];
      this.charge = 0;
      this.last = null;
      this.holds = [false, false, false];
      this.maxHolds = T.maxHolds;
      this.holdCost = T.holdCost;
      this.baseCost = T.baseCost;
      /** Holds that cost no extra charge (Slot Alley "Hold Token"). */
      this.freeHolds = 0;
      this.spinCount = 0;
      /** Fixed tutorial results. Each is labeled `demo` on the result. */
      this.demoQueue = [];
      /** Developer override; results are labeled `debug`. */
      this.debugForce = null;
      /** Hooks for later content (announced guarantee, wildcard). */
      this.guarantee = null;
      this.wildcard = null;
    }

    setReelWeights(reel, weightsBySymbol) {
      this.weights[reel] = SYMS.map((id) => {
        const w = weightsBySymbol && weightsBySymbol[id];
        return w == null ? 1 : Math.max(0, w);
      });
    }

    holdCount() {
      return (this.holds[0] ? 1 : 0) + (this.holds[1] ? 1 : 0) + (this.holds[2] ? 1 : 0);
    }

    /** Charge required for the next spin, including hold costs. */
    cost() {
      const paid = Math.max(0, this.holdCount() - this.freeHolds);
      return this.baseCost + this.holdCost * paid;
    }

    canSpin() {
      return this.charge >= this.cost();
    }

    addCharge(n) {
      if (!(n > 0)) return 0;
      const before = this.charge;
      this.charge = Math.min(CHARGE_CAP, this.charge + n);
      return this.charge - before;
    }

    /** Toggle a hold. Only legal with a previous result and within maxHolds. */
    setHold(i, on) {
      if (i < 0 || i > 2) return false;
      if (on) {
        if (!this.last) return false;
        if (!this.holds[i] && this.holdCount() >= this.maxHolds) return false;
        this.holds[i] = true;
        return true;
      }
      this.holds[i] = false;
      return true;
    }

    clearHolds() {
      this.holds = [false, false, false];
    }

    /** Per-reel probability tables after weights and holds (steps 1–2). */
    reelTables() {
      const tables = [];
      for (let r = 0; r < 3; r++) {
        const row = new Array(SYMS.length).fill(0);
        if (this.holds[r] && this.last) {
          row[SYMS.indexOf(this.last[r])] = 1;
        } else {
          const w = this.weights[r];
          let sum = 0;
          for (let k = 0; k < w.length; k++) sum += w[k];
          for (let k = 0; k < w.length; k++) row[k] = sum > 0 ? w[k] / sum : 1 / w.length;
        }
        tables.push(row);
      }
      return tables;
    }

    /** Exact outcome probabilities for the next real (non-demo) spin. */
    odds() {
      const t = this.reelTables();
      const out = { jackpot: 0, triple: 0, pair: 0, mixed: 0, bySymbolTriple: {} };
      for (const id of SYMS) out.bySymbolTriple[id] = 0;
      const n = SYMS.length;
      for (let a = 0; a < n; a++) {
        if (!t[0][a]) continue;
        for (let b = 0; b < n; b++) {
          if (!t[1][b]) continue;
          for (let c = 0; c < n; c++) {
            const p = t[0][a] * t[1][b] * t[2][c];
            if (!p) continue;
            const k = classify([SYMS[a], SYMS[b], SYMS[c]]);
            if (k.kind === 'jackpot') {
              out.jackpot += p;
              out.bySymbolTriple.seven += p;
            } else if (k.kind === 'triple') {
              out.triple += p;
              out.bySymbolTriple[k.symbol] += p;
            } else if (k.kind === 'pair') out.pair += p;
            else out.mixed += p;
          }
        }
      }
      return out;
    }

    _draw(reel) {
      const w = this.weights[reel];
      let sum = 0;
      for (let k = 0; k < w.length; k++) sum += w[k];
      let x = this.rng.next() * sum;
      for (let k = 0; k < w.length; k++) {
        x -= w[k];
        if (x < 0) return SYMS[k];
      }
      return SYMS[w.length - 1];
    }

    /**
     * Pays the cost and resolves one spin. Returns null if charge is short.
     * Holds always expire after the spin.
     */
    spin() {
      if (!this.canSpin()) return null;
      const cost = this.cost();
      const holdsUsed = this.holdCount();
      this.charge -= cost;
      const usedFree = Math.min(this.freeHolds, holdsUsed);
      this.freeHolds -= usedFree;

      let symbols;
      let demo = false;
      let debug = false;
      if (this.demoQueue.length) {
        symbols = this.demoQueue.shift().slice();
        demo = true;
      } else if (this.debugForce) {
        symbols = this.debugForce.slice();
        this.debugForce = null;
        debug = true;
      } else {
        symbols = [null, null, null];
        // Step 2: held results.
        for (let r = 0; r < 3; r++) if (this.holds[r] && this.last) symbols[r] = this.last[r];
        // Step 3: unheld results (step 1's weights live in _draw).
        for (let r = 0; r < 3; r++) if (symbols[r] == null) symbols[r] = this._draw(r);
        // Step 4: announced guarantee (hook).
        if (this.guarantee) symbols = this.guarantee(symbols) || symbols;
        // Step 5: eligible wildcard (hook).
        if (this.wildcard) symbols = this.wildcard(symbols) || symbols;
      }
      // Step 6: classify.
      const k = classify(symbols);
      this.last = symbols.slice();
      this.clearHolds();
      this.spinCount++;
      return {
        symbols,
        kind: k.kind,
        symbol: k.symbol,
        other: k.other,
        demo,
        debug,
        cost,
        holdsUsed,
        index: this.spinCount,
      };
    }

    serialize() {
      return {
        charge: this.charge,
        last: this.last ? this.last.slice() : null,
        holds: this.holds.slice(),
        freeHolds: this.freeHolds,
        spinCount: this.spinCount,
        rng: this.rng.getState(),
        weights: this.weights.map((w) => w.slice()),
      };
    }

    restore(s) {
      if (!s) return;
      this.charge = HE.util.clamp(+s.charge || 0, 0, CHARGE_CAP);
      this.last = Array.isArray(s.last) && s.last.length === 3 && s.last.every((x) => SYMS.includes(x)) ? s.last.slice() : null;
      this.holds = Array.isArray(s.holds) ? s.holds.map(Boolean).slice(0, 3) : [false, false, false];
      while (this.holds.length < 3) this.holds.push(false);
      if (!this.last) this.clearHolds();
      this.freeHolds = Math.max(0, s.freeHolds | 0);
      this.spinCount = Math.max(0, s.spinCount | 0);
      if (HE.util.isNum(s.rng)) this.rng.setState(s.rng);
      if (Array.isArray(s.weights) && s.weights.length === 3) {
        this.weights = s.weights.map((w) => (Array.isArray(w) && w.length === SYMS.length ? w.map((x) => Math.max(0, +x || 0)) : uniformWeights()));
      }
    }
  }

  HE.Slots = { SlotMachine, classify, CHARGE_CAP };
})(typeof window !== 'undefined' ? window : globalThis);
