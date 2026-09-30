/*
 * Run-structure helpers: upgrade drafts, door choices and the scripted
 * Entrance tutorial. Drafts and doors draw from the loot stream only.
 */
(function (root) {
  'use strict';
  const HE = root.HE;
  const D = HE.data;

  const PERK_SLOTS = 8;

  const FALLBACKS = [
    { type: 'heal', amount: 0.3, name: 'Complimentary Cherry', desc: 'Restore 30% of maximum health.' },
    { type: 'chips', amount: 40, name: 'Comped Stack', desc: '+40 loose chips (room bonus, not natural income).' },
    { type: 'charge', amount: 60, name: 'Reel Oil', desc: '+60 spin charge.' },
  ];

  /** Would taking `id` complete a recipe that is not active yet? */
  function completesRecipe(perks, id) {
    for (const r of D.recipes) {
      if (perks.recipe(r.id) || !r.ingredients.includes(id)) continue;
      if (r.ingredients.every((i) => i === id || perks.has(i))) return r.id;
    }
    return null;
  }

  /**
   * Three options. One slot favors a relevant choice (recipe completion or a
   * rank-up) when one exists; the others stay open for pivots. Unusable
   * options are never offered; when perks run out, useful fallbacks fill in.
   */
  function draftOptions(perks, rng, opts) {
    opts = opts || {};
    const banned = opts.banned || [];
    const owned = perks.ownedIds();
    const slotsFull = owned.length >= PERK_SLOTS;
    const cands = [];
    for (const p of D.perks) {
      if (banned.includes(p.id)) continue;
      const r = perks.rank(p.id);
      if (r >= p.maxRank) continue;
      if (r === 0 && slotsFull) continue;
      cands.push({ type: 'perk', id: p.id, rank: r + 1, recipe: completesRecipe(perks, p.id), rankUp: r > 0 });
    }
    const out = [];
    const take = (c) => {
      out.push(c);
      cands.splice(cands.indexOf(c), 1);
    };
    if (opts.first) {
      const beh = cands.filter((c) => D.perkById[c.id].tags.includes('behavior'));
      if (beh.length) take(rng.pick(beh));
    }
    const recipeC = cands.filter((c) => c.recipe);
    const rankC = cands.filter((c) => c.rankUp);
    if (recipeC.length && rng.chance(0.75)) take(rng.pick(recipeC));
    else if (rankC.length && rng.chance(0.4)) take(rng.pick(rankC));
    while (out.length < 3 && cands.length) {
      let total = 0;
      for (const c of cands) total += c.rankUp ? 0.8 : 1;
      let x = rng.next() * total;
      let chosen = cands[cands.length - 1];
      for (const c of cands) {
        x -= c.rankUp ? 0.8 : 1;
        if (x < 0) {
          chosen = c;
          break;
        }
      }
      take(chosen);
    }
    let fi = 0;
    while (out.length < 3 && fi < FALLBACKS.length) out.push(Object.assign({}, FALLBACKS[fi++]));
    return out;
  }

  /** Door options for a floor slot. */
  function doorOptions(floor, slotIndex, rng, usedCashier) {
    const slot = floor.slots[slotIndex];
    if (!slot) return [];
    const mk = (type) => {
      let wager = false;
      if (type !== 'cashier' && type !== 'boss') {
        if (slot.wager === true) wager = true;
        else if (slot.wager === 'sometimes') wager = type === 'highroller' || rng.chance(0.4);
      }
      return { type, wager, name: D.roomTypes[type].name, desc: D.roomTypes[type].desc };
    };
    if (slot.fixed) {
      const type = slot.fixed === 'start' ? 'combat' : slot.fixed;
      return [mk(type)];
    }
    let choices = slot.choices.filter((c) => !(c === 'cashier' && usedCashier));
    choices = rng.shuffle(choices.slice()).slice(0, 2);
    return choices.map(mk);
  }

  /**
   * The Entrance, scripted. Each step waits for the player to actually do the
   * thing; the prompt disappears once done. Skippable at any time.
   */
  class Tutorial {
    constructor(game) {
      this.game = game;
      this.step = 0;
      this.flags = {};
      this.moved = 0;
      this.precisionT = 0;
      this.grazes = 0;
      this.t = 0;
      this.stepT = 0;
      this.spawnedFinal = false;
      this.active = true;
      this.enter(0);
    }

    get current() {
      return D.tutorialSteps[this.step] || null;
    }

    enter(i) {
      const g = this.game;
      this.step = i;
      this.stepT = 0;
      const s = this.current;
      if (!s) return;
      g.emit('tutorial_step', { step: s });
      if (s.id === 'shoot') {
        for (let k = 0; k < 3; k++) g.spawnEnemy('rusher', 640 + (k - 1) * 170, 150, false, { slow: 0.35, tag: 'intro' });
      } else if (s.id === 'spin') {
        g.slots.addCharge(Math.max(0, g.slots.cost() - g.slots.charge));
        g.slots.demoQueue.push(['bullet', 'bullet', 'bullet']);
        for (let k = 0; k < 5; k++) g.spawnEnemy('rusher', 300 + k * 170, 110, false, { slow: 0.4, tag: 'spin' });
      } else if (s.id === 'ring') {
        g.spawnEnemy('ringcaster', 640, 170, false, { hpMult: 0.7, tag: 'ring' });
      } else if (s.id === 'graze') {
        g.spawnEnemy('dealer', 360, 150, false, { hpMult: 1.4, tag: 'graze' });
        g.spawnEnemy('dealer', 920, 150, false, { hpMult: 1.4, tag: 'graze' });
      }
    }

    advance() {
      this.enter(this.step + 1);
    }

    update(dt) {
      const g = this.game;
      const s = this.current;
      if (!s) return;
      this.t += dt;
      this.stepT += dt;
      switch (s.id) {
        case 'move':
          if (this.moved > 180 || this.stepT > 8) this.advance();
          break;
        case 'shoot':
          if (!g.countTagged('intro')) this.advance();
          break;
        case 'precision':
          if (g.input.precision) this.precisionT += dt;
          if (this.precisionT > 0.8 || this.stepT > 9) this.advance();
          break;
        case 'spin':
          if (this.flags.spun && !g.countTagged('spin')) this.advance();
          else if (this.flags.spun && this.stepT > 12) this.advance();
          break;
        case 'ring':
          if (!g.countTagged('ring')) this.advance();
          break;
        case 'dash':
          if (this.flags.dashed || this.stepT > 10) this.advance();
          break;
        case 'graze':
          if (this.grazes >= 5 || this.stepT > 16) this.advance();
          break;
        case 'finish':
          if (!this.spawnedFinal) {
            this.spawnedFinal = true;
            g.spawnPack('rusher', 4, false);
            g.spawnEnemy('sniper', 1080, 140, false, { hpMult: 0.8 });
          }
          break;
      }
    }

    onEvent(type, ev) {
      if (type === 'spin') this.flags.spun = true;
      if (type === 'dash') this.flags.dashed = true;
      if (type === 'graze') this.grazes++;
    }

    /** The room is done when the last step's spawns are cleared. */
    finished() {
      const s = this.current;
      return s && s.id === 'finish' && this.spawnedFinal && this.game.liveEnemies().length === 0;
    }
  }

  HE.Run = { draftOptions, doorOptions, completesRecipe, PERK_SLOTS, FALLBACKS };
  HE.Tutorial = Tutorial;
})(typeof window !== 'undefined' ? window : globalThis);
