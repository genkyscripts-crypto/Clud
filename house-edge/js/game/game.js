/*
 * HOUSE EDGE simulation and run state machine. No DOM, no canvas: the whole
 * game runs headless in Node tests and the browser only adds input, audio,
 * rendering and menus on top.
 *
 * Run states
 *   intro → (wager) → combat → clear → draft → doors → intro …
 *   … boss → clear → terminal → (terminal_banked) → next floor | results
 *   combat → dying → results
 * The arena only simulates in intro / combat / clear / dying. Every other
 * state is a safe screen: nothing moves and nothing can hit the player.
 *
 * Damage order (Game.hit): base → flat additions → additive bonuses
 * (Loaded Chambers, Ricochet bounce bonus) → multiplicative groups (Crown
 * window, jackpot, frozen bonus, boss stagger) → critical (none in M1) →
 * resistance (Usher shield is resolved before the hit) → cap 999.
 */
(function (root) {
  'use strict';
  const HE = root.HE;
  const D = HE.data;
  const U = HE.util;
  const E = HE.Economy;
  const TP = D.TUNING.player;
  const TS = D.TUNING.slots;
  const PR = D.TUNING.procs;
  const ST = D.TUNING.status;

  const SIM_STATES = { intro: 1, combat: 1, clear: 1, dying: 1 };
  const SAFE_STATES = { draft: 1, doors: 1, shop: 1, terminal: 1, terminal_banked: 1, wager: 1 };

  function makeShot() {
    return {
      x: 0, y: 0, vx: 0, vy: 0, px: 0, py: 0, r: 4, dmg: 0, baseDmg: 0, life: 0, travel: 0, maxTravel: 0,
      bounces: 0, bouncesDone: 0, bounceBonus: 0, pierce: 0, primary: false, kind: 'shot', returning: false,
      canReturn: false, canSplit: false, didSplit: false, bloomed: false, strips: 0, curve: 0, chain: null,
      depth: 0, procCoef: 1, hits: new Int32Array(12), hitN: 0, color: '#fff', final: false, speed: 0,
    };
  }

  function makeBullet() {
    return { x: 0, y: 0, vx: 0, vy: 0, ax: 0, ay: 0, r: 6, life: 0, dmg: 12, shape: 'orb', grazed: false, uid: 0, alive: false, angle: 0, age: 0 };
  }

  function makeEnemy() {
    return { uid: 0, alive: false };
  }

  function makePickup() {
    return { x: 0, y: 0, vx: 0, vy: 0, value: 1, origin: 'natural', kind: 'chip', t: 0, vacuum: false };
  }

  function makeZone() {
    return { kind: 'flame', x: 0, y: 0, x2: 0, y2: 0, r: 0, width: 14, life: 0, max: 1, dps: 0, chain: null, skid: false, tickT: 0 };
  }

  class Game {
    constructor(opts) {
      opts = opts || {};
      this.save = opts.save || HE.Save.createDefault(opts.now ? opts.now() : Date.now());
      this.saveSystem = opts.saveSystem || null;
      this.now = opts.now || (() => Date.now());
      this.account = this.save.account;
      this.bus = new HE.Emitter();
      this.fx = new HE.FX();
      this.A = D.TUNING.arena;
      this.shots = new HE.DensePool(opts.shotCap || 2600, makeShot);
      this.bullets = new HE.DensePool(opts.bulletCap || 2000, makeBullet);
      this.enemies = new HE.DensePool(opts.enemyCap || 240, makeEnemy);
      this.pickups = new HE.DensePool(900, makePickup);
      this.zones = new HE.DensePool(320, makeZone);
      this.grid = new HE.SpatialGrid(this.A.w, this.A.h, 80);
      this._scratch = [];
      this.perks = new HE.PerkSystem(this);
      this.spins = new HE.SpinEffects(this);
      this.slots = new HE.Slots.SlotMachine(HE.createRng(1));
      this.rngCombat = HE.createRng(1);
      this.rngRun = HE.createRng(1);
      this.rngLoot = HE.createRng(1);
      this.weaponId = 'W01';
      this.weaponDef = D.weaponById.W01;
      this.input = { moveX: 0, moveY: 0, aimX: 640, aimY: 300, fire: false, precision: false, dashPressed: false, spinPressed: false };
      this.player = this._freshPlayer();
      this.weapon = this._freshWeapon();
      this.run = null;
      this.paused = false;
      this.t = 0;
      this.frame = 0;
      this.uidSeq = 1;
      this.chainSeq = 1;
      this.hitStop = 0;
      this.shake = 0;
      this.flash = { t: 0, max: 1, color: '#fff' };
      this.layout = D.layouts.open;
      this.boss = null;
      this.director = null;
      this.tutorial = null;
      this.floorSpeed = 1;
      this.heatBulletMult = 1;
      this.caliberBonus = 0;
      this.grazeWindow = { t: 0, charge: 0 };
      this.debug = { enabled: !!opts.debug, logDamage: false, damageLog: [], godMode: false };
      this.stats = this._freshStats();
      this.music = 'hub';
    }

    get settings() {
      return this.save.settings;
    }

    _freshPlayer() {
      return {
        x: this.A.w / 2, y: this.A.h - 90, vx: 0, vy: 0, r: TP.hitRadius, body: TP.bodyRadius,
        hp: TP.maxHp, maxHp: TP.maxHp, aim: -Math.PI / 2, aimX: this.A.w / 2, aimY: 0,
        dashCharges: TP.dashCharges, dashMax: TP.dashCharges, dashRecharge: 0, dashT: 0, dashVX: 0, dashVY: 0,
        iframes: 0, protect: 0, shield: 0, recoil: 0, hurtFlash: 0, moving: false,
      };
    }

    _freshWeapon() {
      const w = { mag: this.weaponDef.params.magazine, reloadT: 0, reloading: false, fireT: 0, flash: 0 };
      const self = this;
      w.finishReload = function () {
        w.reloading = false;
        w.reloadT = 0;
        w.mag = self.weaponDef.params.magazine;
      };
      return w;
    }

    _freshStats() {
      return { kills: 0, eliteKills: 0, grazes: 0, spins: 0, pairs: 0, triples: 0, jackpots: 0, damageTaken: 0, shots: 0, recipesTriggered: 0, bossKills: 0 };
    }

    /* ======================================================== plumbing */

    emit(type, payload) {
      const p = payload || {};
      p.type = type;
      p.runId = this.run ? this.run.id : null;
      p.t = this.t;
      if (p.sourceId === undefined) p.sourceId = null;
      if (p.chainId === undefined) p.chainId = null;
      if (p.origin === undefined) p.origin = null;
      if (p.depth === undefined) p.depth = 0;
      if (p.flags === undefined) p.flags = null;
      this.bus.emit(type, p);
      return p;
    }
    on(type, fn) {
      return this.bus.on(type, fn);
    }
    sfx(name, x) {
      this.bus.emit('sfx', { name, x: x == null ? this.A.w / 2 : x });
    }
    setMusic(mode) {
      this.music = mode;
      this.bus.emit('music', { mode });
    }
    toast(text, kind) {
      this.bus.emit('toast', { text, kind: kind || 'info' });
    }
    flashScreen(t, color) {
      if (!this.settings.flashes) return;
      this.flash.t = this.flash.max = t;
      this.flash.color = color;
    }
    hitStopFor(t) {
      if (!this.settings.hitStop) return;
      this.hitStop = Math.max(this.hitStop, t);
    }
    addShake(v) {
      this.shake = Math.min(14, this.shake + v * this.settings.shake);
    }
    persist() {
      if (this.saveSystem && !(this.run && this.run.debug)) return this.saveSystem.write(this.save);
      return true;
    }
    combatRoll() {
      return this.rngCombat.next();
    }
    damageScale() {
      return 1 + this.caliberBonus;
    }
    isBossRoom() {
      return !!(this.run && this.run.room && this.run.room.type === 'boss');
    }
    newChain(label, budget) {
      return { id: this.chainSeq++, label, budget: budget || PR.budget, emitted: 0 };
    }
    /** Secondary effect gate: depth and per-origin budget. */
    chainAllow(chain, depth) {
      if (depth > PR.maxDepth) return false;
      if (!chain) return true;
      if (chain.emitted >= chain.budget) return false;
      chain.emitted++;
      return true;
    }
    arenaRand(margin, axis) {
      const size = axis === 'x' ? this.A.w : this.A.h;
      return margin + this.combatRoll() * (size - margin * 2);
    }

    /* ======================================================= run flow */

    /**
     * Starts a run. `tutorial` plays the guided Entrance. `debug` runs use a
     * copy of the account and never persist anything.
     */
    startRun(opts) {
      opts = opts || {};
      const seed = (opts.seed == null ? Math.floor(Math.random() * 0xffffffff) : opts.seed) >>> 0;
      const debug = !!opts.debug;
      this.account = debug ? JSON.parse(JSON.stringify(this.save.account)) : this.save.account;
      this.rngRun = HE.createRng(HE.subSeed(seed, 'run'));
      this.rngLoot = HE.createRng(HE.subSeed(seed, 'loot'));
      this.slots = new HE.Slots.SlotMachine(HE.createRng(HE.subSeed(seed, 'reels')));
      this.perks.reset();
      this.spins.reset();
      this.stats = this._freshStats();
      this.player = this._freshPlayer();
      this.weapon = this._freshWeapon();
      this.run = {
        id: 'run-' + this.now().toString(36) + '-' + seed.toString(36),
        seed,
        debug,
        tutorial: !!opts.tutorial,
        floorIndex: 0,
        slotIndex: 0,
        state: 'intro',
        stateT: 0,
        wallet: E.createWallet(),
        rerolls: 2,
        bans: 1,
        banned: [],
        draft: null,
        draftReturn: null,
        doors: null,
        usedCashier: false,
        shopBought: [],
        roomsCleared: 0,
        floorsCleared: 0,
        bankedLog: [],
        bankedFloors: [],
        time: 0,
        newRecipes: [],
        recipeTriggers: {},
        room: null,
        wagerOffer: null,
        settled: false,
        results: null,
        firstDraft: true,
      };
      this.applyAccountModifiers();
      this.onFloorStart();
      this.enterRoom({ type: this.run.tutorial ? 'tutorial' : 'combat', wager: false });
      this.emit('run_started', { flags: { tutorial: this.run.tutorial, debug } });
      return this.run;
    }

    slotAlleyLevel() {
      return this.save.facilities.slot_alley ? this.save.facilities.slot_alley.level : 0;
    }

    unlocks() {
      return HE.Facilities.unlocks(D.facilityById.slot_alley, this.slotAlleyLevel());
    }

    applyAccountModifiers() {
      const up = this.save.upgrades;
      const vit = D.accountUpgradeById.vitality.perRank * (up.vitality || 0);
      this.caliberBonus = D.accountUpgradeById.caliber.perRank * (up.caliber || 0);
      this.player.maxHp = Math.round(TP.maxHp * (1 + vit));
      this.player.hp = this.player.maxHp;
      const unl = this.unlocks();
      if (unl.includes('warm_reels')) this.slots.addCharge(50);
      if (unl.includes('loaded_seven') && this.save.presets.loaded_seven) this.slots.setReelWeights(2, { seven: 1.5 });
    }

    onFloorStart() {
      const unl = this.unlocks();
      this.slots.freeHolds = unl.includes('hold_token') ? 1 : 0;
      const floor = this.floor();
      this.floorSpeed = floor.id === 'F2' ? 1.1 : 1;
      this.heatBulletMult = 1 + this.run.wallet.heat * D.HEAT.bulletSpeedPerHeat;
    }

    floor() {
      return D.floors[this.run.floorIndex];
    }

    _clearArena() {
      this.shots.clear();
      this.bullets.clear();
      for (let i = 0; i < this.enemies.n; i++) this.enemies.items[i].alive = false;
      this.enemies.clear();
      this.pickups.clear();
      this.zones.clear();
      this.fx.clear();
      this.perks.extras.length = 0;
      this.perks.trail = null;
      this.boss = null;
      this.director = null;
      this.tutorial = null;
    }

    enterRoom(door) {
      const run = this.run;
      const floor = this.floor();
      this._clearArena();
      const type = door.type;
      this.rngCombat = HE.createRng(HE.subSeed(run.seed, 'combat:' + run.floorIndex + ':' + run.slotIndex));
      let layout = 'open';
      if (type === 'combat' || type === 'highroller') layout = this.rngRun.pick(['open', 'pillars4', 'center', 'flank']);
      this.layout = D.layouts[layout];
      const p = this.player;
      p.x = this.A.w / 2;
      p.y = this.A.h - 90;
      p.vx = p.vy = 0;
      p.dashT = 0;
      p.dashCharges = p.dashMax;
      p.iframes = 0;
      p.protect = 0;
      this.weapon.finishReload();
      run.room = { type, wager: null, layout, startTime: run.time, damageTaken: 0, dashed: false, grazes: 0, chipMult: (D.roomTypes[type] && D.roomTypes[type].chipMult) || 1 };
      run.wagerOffer = null;
      if (type === 'cashier') {
        run.shopBought = [];
        this.setState('shop');
        this.setMusic('calm');
        return;
      }
      if (type === 'tutorial') this.tutorial = new HE.Tutorial(this);
      else if (type === 'boss') this._pendingBoss = floor.boss;
      else this.director = new HE.Director(this, HE.planRoom(floor, type, run.slotIndex, run.wallet.heat, this.rngCombat));
      if (door.wager) {
        const stakes = E.stakeOptions(run.wallet);
        if (stakes.length) {
          const pool = D.wagers.map((w) => w.id);
          run.wagerOffer = { defId: this.rngCombat.pick(pool), stakes };
        }
      }
      this.setState('intro', type === 'boss' ? 1.6 : 1.1);
      this.setMusic(type === 'boss' ? 'boss' : type === 'tutorial' ? 'calm' : 'combat');
      this.emit('room_entered', { flags: { type, floor: run.floorIndex, slot: run.slotIndex } });
    }

    setState(s, t) {
      this.run.state = s;
      this.run.stateT = t || 0;
      this.emit('state', { flags: { state: s } });
    }

    _beginCombat() {
      if (this._pendingBoss) {
        const def = D.bossById[this._pendingBoss];
        this._pendingBoss = null;
        this.spawnBoss(def);
      }
      this.setState('combat');
    }

    /* ---- wager ---- */

    placeWager(stake) {
      const run = this.run;
      if (!run || run.state !== 'wager' || !run.wagerOffer) return null;
      const rec = E.placeWager(run.wallet, run.wagerOffer.defId, stake, 'w' + this.uidSeq++);
      if (!rec) return null;
      run.room.wager = rec;
      run.wagerOffer = null;
      // Load recovery: a checkpoint reloaded mid-room must see this stake as lost.
      const cp = this.save.checkpoint;
      if (cp && cp.runId === run.id && !run.debug) {
        cp.wallet.loose = Math.max(0, cp.wallet.loose - rec.stake);
        cp.wallet.wagers.push({ uid: rec.uid, defId: rec.defId, stake: rec.stake, payout: rec.payout, status: 'lost', settled: true, interrupted: true });
        this.persist();
      }
      this.emit('wager_placed', { sourceId: rec.defId, flags: { stake: rec.stake } });
      this.sfx('chip_stack');
      this._beginCombat();
      return rec;
    }

    declineWager() {
      const run = this.run;
      if (!run || run.state !== 'wager') return;
      run.wagerOffer = null;
      this._beginCombat();
    }

    _settleWager(success, reason) {
      const run = this.run;
      const rec = run.room && run.room.wager;
      if (!rec || rec.settled) return;
      const paid = E.settleWager(run.wallet, rec, success);
      this.emit('wager_settled', { sourceId: rec.defId, origin: success ? 'wager_return' : null, flags: { success, paid, stake: rec.stake, reason } });
      this.toast(success ? 'Wager won: +' + paid + ' chips returned' : 'Wager lost: ' + rec.stake + ' chips' + (reason ? ' — ' + reason : ''), success ? 'win' : 'loss');
      this.sfx(success ? 'wager_win' : 'wager_lose');
    }

    _wagerEvent(type) {
      const rec = this.run && this.run.room && this.run.room.wager;
      if (!rec || rec.settled) return;
      const def = D.wagerById[rec.defId];
      if (def.failOn === type) this._settleWager(false, type === 'dash' ? 'you dashed' : 'you took damage');
      if (type === 'graze' && def.target) rec.progress = Math.min(def.target, rec.progress + 1);
    }

    /* ---- room clear ---- */

    _roomCleared() {
      const run = this.run;
      this.setState('clear', 1.3);
      for (let i = 0; i < this.pickups.n; i++) this.pickups.items[i].vacuum = true;
      this.clearBullets(0, 0, 99999, true);
      run.roomsCleared++;
      const rec = run.room.wager;
      if (rec && !rec.settled) {
        const def = D.wagerById[rec.defId];
        if (def.target) this._settleWager(rec.progress >= def.target, rec.progress >= def.target ? null : 'only ' + rec.progress + ' grazes');
        else if (def.timeLimit) this._settleWager(run.time - run.room.startTime <= def.timeLimit, 'too slow');
        else this._settleWager(true);
      }
      const bonus = D.TUNING.economy.roomClearBonusPerFloor * (run.floorIndex + 1);
      E.earn(run.wallet, bonus, 'room_bonus');
      this.emit('room_cleared', { origin: 'room_bonus', flags: { bonus, type: run.room.type } });
      this.sfx('room_clear');
      this.setMusic('calm');
    }

    _afterClear() {
      const run = this.run;
      const type = run.room.type;
      if (type === 'boss') {
        run.floorsCleared++;
        const fid = this.floor().id;
        if (!run.debug && !this.account.firstClears[fid]) this.account.firstClears[fid] = true;
        this.player.hp = Math.min(this.player.maxHp, this.player.hp + Math.round(this.player.maxHp * 0.3));
        this.setState('terminal');
        this.writeCheckpoint();
        return;
      }
      if (D.roomTypes[type].draft) this.openDraft('doors');
      else this.openDoors();
    }

    /* ---- drafts ---- */

    openDraft(returnTo) {
      const run = this.run;
      run.draft = HE.Run.draftOptions(this.perks, this.rngLoot, { banned: run.banned, first: run.firstDraft });
      run.firstDraft = false;
      run.draftReturn = returnTo;
      this.setState('draft');
    }

    rerollDraft() {
      const run = this.run;
      if (!run || run.state !== 'draft' || run.rerolls <= 0) return false;
      run.rerolls--;
      run.draft = HE.Run.draftOptions(this.perks, this.rngLoot, { banned: run.banned });
      this.sfx('ui_shuffle');
      return true;
    }

    banDraft(i) {
      const run = this.run;
      if (!run || run.state !== 'draft' || run.bans <= 0) return false;
      const opt = run.draft[i];
      if (!opt || opt.type !== 'perk') return false;
      run.bans--;
      run.banned.push(opt.id);
      const shown = run.draft.filter((o) => o.type === 'perk').map((o) => o.id);
      const fresh = HE.Run.draftOptions(this.perks, this.rngLoot, { banned: run.banned.concat(shown) });
      run.draft[i] = fresh[0];
      this.sfx('ui_shuffle');
      return true;
    }

    chooseDraft(i) {
      const run = this.run;
      if (!run || run.state !== 'draft') return false;
      const opt = run.draft[i];
      if (!opt) return false;
      if (opt.type === 'perk') {
        const newly = this.perks.add(opt.id);
        if (!this.save.discovered.perks.includes(opt.id) && !run.debug) this.save.discovered.perks.push(opt.id);
        for (const rid of newly) {
          const r = D.recipeById[rid];
          run.newRecipes.push(rid);
          const first = !this.save.discovered.recipes.includes(rid);
          if (first && !run.debug) this.save.discovered.recipes.push(rid);
          this.emit('recipe_activated', { sourceId: rid, flags: { first } });
          this.toast('RECIPE — ' + r.name + ': ' + r.description, 'recipe');
        }
        this.sfx(newly.length ? 'recipe' : 'perk');
        this.emit('perk_taken', { sourceId: opt.id, flags: { rank: this.perks.rank(opt.id) } });
      } else if (opt.type === 'heal') {
        this.player.hp = Math.min(this.player.maxHp, this.player.hp + this.player.maxHp * opt.amount);
        this.sfx('heal');
      } else if (opt.type === 'chips') {
        E.earn(run.wallet, opt.amount, 'room_bonus');
        this.sfx('chip_stack');
      } else if (opt.type === 'charge') {
        this.slots.addCharge(opt.amount);
        this.sfx('perk');
      }
      run.draft = null;
      if (run.draftReturn === 'shop') this.setState('shop');
      else this.openDoors();
      return true;
    }

    /* ---- doors ---- */

    openDoors() {
      const run = this.run;
      const floor = this.floor();
      run.doors = HE.Run.doorOptions(floor, run.slotIndex + 1, this.rngLoot, run.usedCashier);
      this.setState('doors');
      this.writeCheckpoint();
    }

    chooseDoor(i) {
      const run = this.run;
      if (!run || run.state !== 'doors') return false;
      const door = run.doors && run.doors[i];
      if (!door) return false;
      run.slotIndex++;
      if (door.type === 'cashier') run.usedCashier = true;
      run.doors = null;
      this.enterRoom(door);
      return true;
    }

    /* ---- cashier ---- */

    shopBuy(id) {
      const run = this.run;
      if (!run || run.state !== 'shop' || run.shopBought.includes(id)) return false;
      const item = D.shop.find((x) => x.id === id);
      if (!item || !E.spend(run.wallet, item.cost)) {
        this.sfx('deny');
        return false;
      }
      run.shopBought.push(id);
      this.sfx('purchase');
      if (id === 'cherry') this.player.hp = Math.min(this.player.maxHp, this.player.hp + this.player.maxHp * 0.35);
      else if (id === 'reroll') run.rerolls++;
      else if (id === 'charge') this.slots.addCharge(60);
      else if (id === 'perk') this.openDraft('shop');
      return true;
    }

    leaveShop() {
      if (!this.run || this.run.state !== 'shop') return;
      this.openDoors();
    }

    /* ---- reel holds (safe screens only) ---- */

    setHold(i, on) {
      if (!this.run || !SAFE_STATES[this.run.state]) return false;
      return this.slots.setHold(i, on);
    }

    /* ---- terminal ---- */

    terminalPreview() {
      return E.terminalPreview(this.run.wallet);
    }

    terminalBank() {
      const run = this.run;
      if (!run || run.state !== 'terminal' || this.floor().final) return 0;
      if (run.bankedFloors.includes(run.floorIndex)) return 0;
      run.bankedFloors.push(run.floorIndex);
      const amount = E.bank(run.wallet, this.account);
      run.bankedLog.push({ floor: run.floorIndex, amount });
      this.emit('chips_banked', { origin: 'bank_transfer', flags: { amount } });
      this.sfx('bank');
      this.setState('terminal_banked');
      this.writeCheckpoint();
      return amount;
    }

    terminalPress() {
      const run = this.run;
      if (!run || run.state !== 'terminal' || this.floor().final) return false;
      E.pressOn(run.wallet);
      this.sfx('press_on');
      this._nextFloor();
      return true;
    }

    terminalContinue() {
      if (!this.run || this.run.state !== 'terminal_banked') return false;
      this._nextFloor();
      return true;
    }

    terminalFinish() {
      if (!this.run || this.run.state !== 'terminal_banked') return null;
      return this.settleRun('cashed_out');
    }

    /** Final floor: the Vault banks everything and ends the run in victory. */
    terminalVault() {
      if (!this.run || this.run.state !== 'terminal' || !this.floor().final) return null;
      return this.settleRun('victory');
    }

    _nextFloor() {
      const run = this.run;
      run.floorIndex++;
      run.slotIndex = 0;
      run.usedCashier = false;
      this.onFloorStart();
      const door = HE.Run.doorOptions(this.floor(), 0, this.rngLoot, false)[0];
      this.enterRoom(door);
    }

    abandonRun() {
      if (!this.run || this.run.settled) return null;
      return this.settleRun('abandoned');
    }

    /* ---- checkpoint ---- */

    buildCheckpoint() {
      const run = this.run;
      return {
        runId: run.id,
        seed: run.seed,
        tutorial: run.tutorial,
        floorIndex: run.floorIndex,
        slotIndex: run.slotIndex,
        state: run.state,
        wallet: JSON.parse(JSON.stringify(run.wallet)),
        perks: Object.assign({}, this.perks.ranks),
        rerolls: run.rerolls,
        bans: run.bans,
        banned: run.banned.slice(),
        doors: run.doors ? JSON.parse(JSON.stringify(run.doors)) : null,
        usedCashier: run.usedCashier,
        hp: this.player.hp,
        maxHp: this.player.maxHp,
        slots: this.slots.serialize(),
        rngRun: this.rngRun.getState(),
        rngLoot: this.rngLoot.getState(),
        roomsCleared: run.roomsCleared,
        floorsCleared: run.floorsCleared,
        bankedLog: run.bankedLog.slice(),
        bankedFloors: run.bankedFloors.slice(),
        time: run.time,
        stats: Object.assign({}, this.stats),
        newRecipes: run.newRecipes.slice(),
        recipeTriggers: Object.assign({}, run.recipeTriggers),
        firstDraft: run.firstDraft,
      };
    }

    writeCheckpoint() {
      if (!this.run || this.run.debug) return;
      this.save.checkpoint = this.buildCheckpoint();
      this.persist();
    }

    hasCheckpoint() {
      const cp = this.save.checkpoint;
      return !!(cp && !this.save.settledRuns.includes(cp.runId));
    }

    /** Resumes the saved run at the safe screen it was saved on. */
    resumeRun() {
      const cp = this.save.checkpoint;
      if (!this.hasCheckpoint()) return null;
      this.account = this.save.account;
      this.rngRun = HE.createRng(1);
      this.rngRun.setState(cp.rngRun);
      this.rngLoot = HE.createRng(1);
      this.rngLoot.setState(cp.rngLoot);
      this.slots = new HE.Slots.SlotMachine(HE.createRng(HE.subSeed(cp.seed, 'reels')));
      this.slots.restore(cp.slots);
      this.perks.reset();
      this.perks.setRanks(cp.perks);
      this.spins.reset();
      this.stats = Object.assign(this._freshStats(), cp.stats || {});
      this.player = this._freshPlayer();
      this.weapon = this._freshWeapon();
      const wallet = Object.assign(E.createWallet(), cp.wallet);
      // Any wager still open in a checkpoint is resolved as lost, once.
      E.failOpenWagers(wallet);
      this.run = {
        id: cp.runId,
        seed: cp.seed,
        debug: false,
        tutorial: !!cp.tutorial,
        floorIndex: U.clamp(cp.floorIndex | 0, 0, D.floors.length - 1),
        slotIndex: cp.slotIndex | 0,
        state: 'doors',
        stateT: 0,
        wallet,
        rerolls: cp.rerolls | 0,
        bans: cp.bans | 0,
        banned: (cp.banned || []).slice(),
        draft: null,
        draftReturn: null,
        doors: cp.doors,
        usedCashier: !!cp.usedCashier,
        shopBought: [],
        roomsCleared: cp.roomsCleared | 0,
        floorsCleared: cp.floorsCleared | 0,
        bankedLog: (cp.bankedLog || []).slice(),
        bankedFloors: (cp.bankedFloors || []).slice(),
        time: +cp.time || 0,
        newRecipes: (cp.newRecipes || []).slice(),
        recipeTriggers: Object.assign({}, cp.recipeTriggers || {}),
        room: { type: 'combat', wager: null, layout: 'open', startTime: 0, damageTaken: 0, dashed: false, grazes: 0, chipMult: 1 },
        wagerOffer: null,
        settled: false,
        results: null,
        firstDraft: !!cp.firstDraft,
      };
      this.caliberBonus = D.accountUpgradeById.caliber.perRank * (this.save.upgrades.caliber || 0);
      this.player.maxHp = cp.maxHp || this.player.maxHp;
      this.player.hp = U.clamp(cp.hp, 1, this.player.maxHp);
      this.onFloorStart();
      this.slots.freeHolds = cp.slots ? cp.slots.freeHolds | 0 : this.slots.freeHolds;
      this._clearArena();
      const st = cp.state === 'terminal' || cp.state === 'terminal_banked' ? cp.state : 'doors';
      if (st === 'doors' && !this.run.doors) this.run.doors = HE.Run.doorOptions(this.floor(), this.run.slotIndex + 1, this.rngLoot, this.run.usedCashier);
      this.setState(st);
      this.setMusic('calm');
      this.emit('run_resumed', {});
      return this.run;
    }

    /* ---- settlement ---- */

    /**
     * Ends the run and applies its account consequences exactly once. The
     * run ID is recorded in the same save write as the balance change.
     */
    settleRun(outcome) {
      const run = this.run;
      if (!run) return null;
      if (run.settled) return run.results;
      run.settled = true;
      const w = run.wallet;
      const acct = this.account;
      const already = !run.debug && this.save.settledRuns.includes(run.id);
      let finalBank = 0;
      let recovery = null;
      const wagers = w.wagers.slice();
      if (!already) {
        if (outcome === 'victory') finalBank = E.bank(w, acct);
        else if (outcome === 'defeat' || outcome === 'abandoned') recovery = E.defeatRecovery(w, acct);
      }
      const bankedTotal = run.bankedLog.reduce((s, x) => s + x.amount, 0) + finalBank + (recovery ? recovery.recovered : 0);
      if (!run.debug && !already) {
        acct.runs++;
        if (outcome === 'victory') acct.wins++;
        if (outcome === 'defeat' || outcome === 'abandoned') acct.defeats++;
        acct.bestFloor = Math.max(acct.bestFloor, run.floorsCleared);
        const rec = this.save.records;
        rec.bestRunChips = Math.max(rec.bestRunChips, bankedTotal);
        if (outcome === 'victory' && (!rec.bestTime || run.time < rec.bestTime)) rec.bestTime = Math.round(run.time);
        const s = this.save.stats;
        s.kills += this.stats.kills;
        s.spins += this.stats.spins;
        s.jackpots += this.stats.jackpots;
        s.grazes += this.stats.grazes;
        s.recipesTriggered += this.stats.recipesTriggered;
        if (!this.save.tutorialDone && run.roomsCleared > 0) this.save.tutorialDone = true;
        this.save.checkpoint = null;
        HE.Save.markSettled(this.save, run.id);
        this.persist();
      }
      run.results = {
        outcome,
        debug: run.debug,
        floorsCleared: run.floorsCleared,
        roomsCleared: run.roomsCleared,
        time: run.time,
        stats: Object.assign({}, this.stats),
        chips: {
          natural: w.earned.natural,
          multiplierBonus: E.multiplierBonus(w),
          roomBonus: w.earned.room_bonus,
          wagerReturns: w.earned.wager_return,
          spent: w.spent,
          wagersWon: wagers.filter((x) => x.status === 'won').length,
          wagersLost: wagers.filter((x) => x.status === 'lost').length,
          stakesLost: wagers.filter((x) => x.status === 'lost').reduce((s, x) => s + x.stake, 0),
        },
        bankedLog: run.bankedLog.slice(),
        finalBank,
        recovery,
        bankedTotal,
        balance: acct.banked,
        perks: Object.assign({}, this.perks.ranks),
        newRecipes: run.newRecipes.slice(),
        nextGoal: this.nextGoal(),
      };
      this.setState('results');
      this.setMusic('hub');
      this.emit('run_settled', { flags: { outcome, bankedTotal } });
      return run.results;
    }

    /** Leaves the results screen. */
    endRun() {
      if (this.run && !this.run.settled) return false;
      this.run = null;
      this._clearArena();
      this.account = this.save.account;
      this.paused = false;
      this.setMusicSafe('hub');
      return true;
    }

    setMusicSafe(m) {
      this.music = m;
      this.bus.emit('music', { mode: m });
    }

    /** The cheapest hub purchase, and whether it is affordable now. */
    nextGoal() {
      const opts = [];
      const fdef = D.facilityById.slot_alley;
      const fs = this.save.facilities.slot_alley;
      if (fs.level < fdef.maxLevel) {
        const ms = fdef.milestones.find((m) => m.level === fs.level + 1);
        opts.push({ kind: 'facility', id: 'slot_alley', name: fdef.name + ' level ' + (fs.level + 1), cost: HE.Facilities.cost(fdef, fs.level), note: ms ? ms.text : 'Higher production.' });
      }
      for (const u of D.accountUpgrades) {
        const r = this.save.upgrades[u.id];
        if (r < u.costs.length) opts.push({ kind: 'upgrade', id: u.id, name: u.name + ' ' + (r + 1), cost: u.costs[r], note: u.desc });
      }
      opts.sort((a, b) => a.cost - b.cost);
      const g = opts[0] || null;
      if (g) g.affordable = this.save.account.banked >= g.cost;
      return g;
    }

    /* ==================================================== hub economy */

    tickFacilities() {
      const reports = {};
      for (const f of D.facilities) reports[f.id] = HE.Facilities.tick(this.save.facilities[f.id], f, this.now());
      return reports;
    }

    collectFacility(id) {
      const def = D.facilityById[id];
      const st = this.save.facilities[id];
      if (!def || !st) return 0;
      HE.Facilities.tick(st, def, this.now());
      const got = HE.Facilities.collect(st, this.save.account);
      if (got > 0) {
        this.persist();
        this.sfx('bank');
        this.emit('chips_collected', { origin: 'facility', sourceId: id, flags: { amount: got } });
      }
      return got;
    }

    buyFacility(id) {
      const def = D.facilityById[id];
      const st = this.save.facilities[id];
      if (!def || !st) return { ok: false };
      const res = HE.Facilities.buyLevel(st, def, this.save.account, this.now());
      if (res.ok) {
        this.persist();
        this.sfx('purchase');
        this.emit('facility_upgraded', { sourceId: id, flags: { level: res.level } });
      } else this.sfx('deny');
      return res;
    }

    buyUpgrade(id) {
      const def = D.accountUpgradeById[id];
      if (!def) return { ok: false };
      const r = this.save.upgrades[id] || 0;
      if (r >= def.costs.length) return { ok: false, reason: 'max' };
      const cost = def.costs[r];
      if (!E.spendBanked(this.save.account, cost)) {
        this.sfx('deny');
        return { ok: false, reason: 'funds', cost };
      }
      this.save.upgrades[id] = r + 1;
      this.persist();
      this.sfx('purchase');
      return { ok: true, rank: r + 1, cost };
    }

    setPreset(id, on) {
      if (id !== 'loaded_seven' || !this.unlocks().includes('loaded_seven')) return false;
      this.save.presets.loaded_seven = !!on;
      this.persist();
      return true;
    }

    /* ======================================================== update */

    update(dt) {
      if (dt > 0.05) dt = 0.05;
      const run = this.run;
      if (!run || this.paused) {
        this.fx.update(dt);
        return;
      }
      const st = run.state;
      if (!SIM_STATES[st]) {
        this.fx.update(dt);
        this.flash.t = Math.max(0, this.flash.t - dt);
        return;
      }
      if (st === 'dying') {
        this._sim(dt * 0.35, false);
        run.stateT -= dt;
        if (run.stateT <= 0) this.settleRun('defeat');
        return;
      }
      this._sim(dt, true);
      if (run.state !== st) return;
      if (st === 'intro') {
        run.stateT -= dt;
        if (run.stateT <= 0) {
          if (run.wagerOffer) this.setState('wager');
          else this._beginCombat();
        }
      } else if (st === 'combat') {
        if (this._roomDone()) this._roomCleared();
        else {
          const rec = run.room.wager;
          if (rec && !rec.settled && D.wagerById[rec.defId].timeLimit && run.time - run.room.startTime > D.wagerById[rec.defId].timeLimit) this._settleWager(false, 'time ran out');
        }
      } else if (st === 'clear') {
        run.stateT -= dt;
        if (run.stateT <= 0 && this.pickups.n === 0) this._afterClear();
        else if (run.stateT < -2) {
          this._collectAllPickups();
          this._afterClear();
        }
      }
    }

    _roomDone() {
      if (this.tutorial) return this.tutorial.finished();
      if (this.director) return this.director.spawnedAll() && this.enemies.n === 0;
      if (this.run.room.type === 'boss') return this.bossDefeated && this.enemies.n === 0;
      return false;
    }

    _sim(dt, withInput) {
      if (this.hitStop > 0) {
        this.hitStop -= dt;
        this.fx.update(dt * 0.25);
        return;
      }
      this.t += dt;
      this.frame++;
      this.run.time += dt;
      this.shake = Math.max(0, this.shake - dt * 30);
      if (this.flash.t > 0) this.flash.t = Math.max(0, this.flash.t - dt);
      this.grazeWindow.t += dt;
      if (this.grazeWindow.t >= 1) {
        this.grazeWindow.t = 0;
        this.grazeWindow.charge = 0;
      }
      this._updatePlayer(dt, withInput);
      this._updateWeapon(dt, withInput && this.run.state !== 'clear');
      this.spins.update(dt);
      this.perks.update(dt);
      if (this.run.state === 'combat') {
        if (this.tutorial) this.tutorial.update(dt);
        if (this.director) this.director.update(dt);
      }
      this._updateEnemies(dt);
      this._rebuildGrid();
      this._updateShots(dt);
      this._updateBullets(dt);
      this._updateZones(dt);
      this._updatePickups(dt);
      this.fx.update(dt);
    }

    /* ======================================================== player */

    _updatePlayer(dt, withInput) {
      const p = this.player;
      const inp = this.input;
      const A = this.A;
      if (p.iframes > 0) p.iframes -= dt;
      if (p.protect > 0) p.protect -= dt;
      if (p.hurtFlash > 0) p.hurtFlash -= dt;
      p.recoil = Math.max(0, p.recoil - dt * 8);
      if (p.dashCharges < p.dashMax) {
        p.dashRecharge += dt;
        if (p.dashRecharge >= TP.dashRecharge) {
          p.dashRecharge = 0;
          p.dashCharges++;
        }
      }
      if (withInput) {
        p.aimX = inp.aimX;
        p.aimY = inp.aimY;
        p.aim = Math.atan2(p.aimY - p.y, p.aimX - p.x);
      }
      let mx = withInput ? inp.moveX : 0;
      let my = withInput ? inp.moveY : 0;
      const ml = Math.hypot(mx, my);
      if (ml > 1) {
        mx /= ml;
        my /= ml;
      }
      if (withInput && inp.dashPressed) {
        inp.dashPressed = false;
        this._tryDash(mx, my);
      }
      if (withInput && inp.spinPressed) {
        inp.spinPressed = false;
        this.trySpin();
      }
      const ox = p.x;
      const oy = p.y;
      if (p.dashT > 0) {
        p.dashT -= dt;
        p.x += p.dashVX * dt;
        p.y += p.dashVY * dt;
        this.perks.onDashMove(p.x, p.y, dt);
        this.fx.burst(p.x, p.y, 1, '#f1ece0', 30, 0.25, 3);
        if (p.dashT <= 0) this.perks.onDashEnd(p.x, p.y);
      } else {
        const sp = TP.speed * (withInput && inp.precision ? TP.precisionMult : 1);
        p.vx = U.damp(p.vx, mx * sp, 22, dt);
        p.vy = U.damp(p.vy, my * sp, 22, dt);
        p.x += p.vx * dt;
        p.y += p.vy * dt;
      }
      p.x = U.clamp(p.x, p.body, A.w - p.body);
      p.y = U.clamp(p.y, p.body, A.h - p.body);
      for (const pl of this.layout.pillars) {
        const dx = p.x - pl.x;
        const dy = p.y - pl.y;
        const d = Math.hypot(dx, dy);
        const min = pl.r + p.body;
        if (d < min && d > 0.001) {
          p.x = pl.x + (dx / d) * min;
          p.y = pl.y + (dy / d) * min;
        }
      }
      const moved = Math.hypot(p.x - ox, p.y - oy);
      p.moving = moved > 0.3;
      if (this.tutorial) this.tutorial.moved += moved;
    }

    _tryDash(mx, my) {
      const p = this.player;
      if (p.dashT > 0 || p.dashCharges <= 0 || this.run.state === 'clear') return false;
      let dx = mx;
      let dy = my;
      if (Math.hypot(dx, dy) < 0.1) {
        dx = Math.cos(p.aim);
        dy = Math.sin(p.aim);
      }
      const l = Math.hypot(dx, dy) || 1;
      p.dashVX = (dx / l) * TP.dashSpeed;
      p.dashVY = (dy / l) * TP.dashSpeed;
      p.dashT = TP.dashTime;
      p.iframes = Math.max(p.iframes, TP.dashIframes);
      p.dashCharges--;
      if (p.dashCharges < p.dashMax && p.dashRecharge <= 0) p.dashRecharge = 0;
      this.perks.onDashStart(p.x, p.y);
      this.run.room.dashed = true;
      this.emit('dash', { sourceId: 'player' });
      this._wagerEvent('dash');
      if (this.tutorial) this.tutorial.onEvent('dash');
      this.sfx('dash', p.x);
      return true;
    }

    trySpin() {
      const run = this.run;
      if (!run || (run.state !== 'combat' && run.state !== 'intro')) return null;
      if (this.spins.busy()) return null;
      if (!this.slots.canSpin()) {
        this.sfx('deny');
        return null;
      }
      const r = this.slots.spin();
      this.spins.begin(r);
      this.emit('spin', { sourceId: 'reels', flags: { demo: r.demo, debug: r.debug, kind: r.kind } });
      if (this.tutorial) this.tutorial.onEvent('spin');
      this.sfx('spin');
      return r;
    }

    hurtPlayer(dmg, source) {
      const p = this.player;
      const run = this.run;
      if (!run || run.state !== 'combat') return false;
      if (p.iframes > 0 || p.protect > 0 || this.debug.godMode) return false;
      if (p.shield > 0) {
        p.shield--;
        p.protect = 0.35;
        this.emit('shield_block', { sourceId: source });
        this.fx.ring(p.x, p.y, 10, 44, 0.3, '#9fd8ff', 3);
        this.sfx('shield_block', p.x);
        return true;
      }
      p.hp -= dmg;
      p.protect = TP.hurtProtect;
      p.hurtFlash = 0.25;
      this.stats.damageTaken += dmg;
      run.room.damageTaken += dmg;
      this.emit('health_damage', { sourceId: source, flags: { amount: dmg } });
      this._wagerEvent('health_damage');
      this.addShake(7);
      this.flashScreen(0.18, '#e8424c');
      this.hitStopFor(0.05);
      this.sfx('hurt', p.x);
      if (this.settings.vibration) this.bus.emit('rumble', { strong: 0.6, weak: 0.4, ms: 140 });
      if (p.hp <= 0) {
        p.hp = 0;
        this._die();
      }
      return true;
    }

    _die() {
      this.setState('dying', 1.4);
      this.emit('death', {});
      this.sfx('death');
      this.setMusic('none');
      this.fx.burst(this.player.x, this.player.y, 40, '#e8424c', 260, 0.8, 3);
    }

    /* ======================================================== weapon */

    _updateWeapon(dt, withInput) {
      const w = this.weapon;
      const P = this.weaponDef.params;
      const rate = this.spins.overdriveT > 0 ? this.spins.overdriveMult : 1;
      w.fireT -= dt * rate;
      if (w.flash > 0) w.flash -= dt;
      if (w.reloading) {
        w.reloadT -= dt;
        if (w.reloadT <= 0) w.finishReload();
      }
      if (!withInput) return;
      let fire = this.input.fire;
      if (this.settings.autoFire && !fire) fire = this.liveEnemies().length > 0;
      if (!fire || w.fireT > 0) return;
      if (this.spins.jackpotT > 0) {
        this._fireGold();
        w.fireT = 0.09;
        return;
      }
      if (w.reloading || w.mag <= 0) return;
      this._fireRevolver(w.mag === 1);
      w.mag--;
      w.fireT = P.fireInterval;
      if (w.mag <= 0) {
        if (this.spins.instantReload) w.finishReload();
        else {
          w.reloading = true;
          w.reloadT = P.reloadTime;
          this.sfx('reload', this.player.x);
        }
      }
    }

    _muzzle() {
      const p = this.player;
      return { x: p.x + Math.cos(p.aim) * 20, y: p.y + Math.sin(p.aim) * 20 };
    }

    _fireRevolver(final) {
      const P = this.weaponDef.params;
      const p = this.player;
      const m = this._muzzle();
      const chain = this.newChain('W01');
      const angle = p.aim + (this.combatRoll() - 0.5) * 2 * P.spread;
      const dmg = P.damage * (final ? P.finalRoundMult : 1);
      const s = this.spawnShot(m.x, m.y, angle, P.speed, dmg, 'shot', {
        primary: true,
        chain,
        depth: 0,
        life: 2.5,
        maxTravel: P.range,
        pierce: this.spins.crownPierce * (this.spins.crownT > 0 ? 1 : 0),
        r: final ? P.finalRoundRadius : P.radius,
        procCoef: 1,
      });
      if (s) {
        s.final = final;
        this.perks.onPrimaryShot(s);
      }
      this.stats.shots++;
      p.recoil = final ? 1 : 0.6;
      this.weapon.flash = 0.06;
      this.fx.spray(m.x, m.y, angle, 0.5, final ? 8 : 4, '#f2c14e', 360, 0.14);
      this.addShake(final ? 2.4 : 0.9);
      this.sfx(final ? 'shot_heavy' : 'shot', p.x);
      this.emit('primary_shot', { sourceId: 'W01', chainId: chain.id, origin: 'player', flags: { final } });
    }

    _fireGold() {
      const P = this.weaponDef.params;
      const p = this.player;
      const m = this._muzzle();
      const chain = this.newChain('W01:gold', PR.jackpotBudget);
      for (let i = -1; i <= 1; i++) {
        const s = this.spawnShot(m.x, m.y, p.aim + i * 0.07, P.speed * 1.1, P.damage * 1.25, 'gold', {
          primary: true,
          chain,
          depth: 0,
          life: 2.5,
          maxTravel: P.range,
          pierce: 2 + (this.spins.crownT > 0 ? this.spins.crownPierce : 0),
          r: 6,
          procCoef: 1,
        });
        if (s) this.perks.onPrimaryShot(s);
      }
      this.stats.shots++;
      p.recoil = 0.5;
      this.weapon.flash = 0.05;
      this.fx.spray(m.x, m.y, p.aim, 0.6, 5, '#f2c14e', 420, 0.16);
      this.addShake(0.8);
      this.sfx('shot_gold', p.x);
      this.emit('primary_shot', { sourceId: 'W01', chainId: chain.id, origin: 'player', flags: { gold: true } });
    }

    /* ===================================================== projectiles */

    spawnShot(x, y, angle, speed, dmg, kind, o) {
      const s = this.shots.spawn();
      if (!s) return null;
      o = o || {};
      s.x = s.px = x;
      s.y = s.py = y;
      s.vx = Math.cos(angle) * speed;
      s.vy = Math.sin(angle) * speed;
      s.speed = speed;
      s.r = o.r || (kind === 'frag' || kind === 'splinter' ? 3.5 : kind === 'petal' ? 5 : 4.5);
      s.dmg = s.baseDmg = dmg;
      s.life = o.life || 1.5;
      s.travel = 0;
      s.maxTravel = o.maxTravel || 0;
      s.bounces = 0;
      s.bouncesDone = 0;
      s.bounceBonus = 0;
      s.pierce = o.pierce || 0;
      s.primary = !!o.primary;
      s.kind = kind;
      s.returning = false;
      s.canReturn = false;
      s.canSplit = false;
      s.didSplit = false;
      s.bloomed = false;
      s.strips = 0;
      s.curve = o.curve || 0;
      s.chain = o.chain || null;
      s.depth = o.depth || 0;
      s.procCoef = o.procCoef == null ? PR.secondaryCoef : o.procCoef;
      s.hitN = 0;
      s.final = false;
      s.color = kind === 'gold' ? '#f2c14e' : kind === 'spin' ? '#fff6d8' : kind === 'splinter' ? '#bfe8ff' : kind === 'discharge' ? '#35e38a' : '#f7e7b0';
      return s;
    }

    fireBullet(x, y, angle, speed, o) {
      const b = this.bullets.spawn();
      if (!b) return null;
      o = o || {};
      const sp = speed * this.heatBulletMult;
      b.x = x;
      b.y = y;
      b.vx = Math.cos(angle) * sp;
      b.vy = Math.sin(angle) * sp;
      b.ax = 0;
      b.ay = 0;
      b.r = o.r || 6;
      b.life = o.life || 9;
      b.dmg = o.dmg || 12;
      b.shape = o.shape || 'orb';
      b.grazed = false;
      b.uid = this.uidSeq++;
      b.alive = true;
      b.angle = angle;
      b.age = 0;
      return b;
    }

    _reflect(s, nx, ny) {
      const d = s.vx * nx + s.vy * ny;
      s.vx -= 2 * d * nx;
      s.vy -= 2 * d * ny;
    }

    _bounce(s, nx, ny) {
      this._reflect(s, nx, ny);
      s.bounces--;
      s.bouncesDone++;
      s.hitN = 0;
      this.perks.onBounce(s, s.x, s.y, nx, ny);
      this.fx.burst(s.x, s.y, 3, '#f7e7b0', 90, 0.2);
      this.sfx('ricochet', s.x);
    }

    _updateShots(dt) {
      const A = this.A;
      const P = this.shots;
      const p = this.player;
      const pillars = this.layout.pillars;
      const near = this._scratch;
      for (let i = P.n - 1; i >= 0; i--) {
        const s = P.items[i];
        s.life -= dt;
        if (s.life <= 0) {
          P.kill(i);
          continue;
        }
        if (s.curve) {
          const c = Math.cos(s.curve * dt);
          const sn = Math.sin(s.curve * dt);
          const vx = s.vx * c - s.vy * sn;
          s.vy = s.vx * sn + s.vy * c;
          s.vx = vx;
        }
        if (s.returning) {
          const dx = p.x - s.x;
          const dy = p.y - s.y;
          const d = Math.hypot(dx, dy) || 1;
          if (this.perks.onReturning(s, d)) {
            P.kill(i);
            continue;
          }
          if (d < 16) {
            P.kill(i);
            continue;
          }
          const k = 1 - Math.exp(-9 * dt);
          s.vx += ((dx / d) * 1000 - s.vx) * k;
          s.vy += ((dy / d) * 1000 - s.vy) * k;
        }
        s.px = s.x;
        s.py = s.y;
        s.x += s.vx * dt;
        s.y += s.vy * dt;
        if (!s.returning && s.maxTravel) {
          s.travel += Math.hypot(s.vx, s.vy) * dt;
          if (s.travel >= s.maxTravel && !this.perks.onTravelEnd(s)) {
            P.kill(i);
            continue;
          }
        }
        if (!s.returning) {
          let dead = false;
          if (s.x < s.r || s.x > A.w - s.r) {
            if (s.bounces > 0) {
              s.x = U.clamp(s.x, s.r, A.w - s.r);
              this._bounce(s, s.x <= s.r ? 1 : -1, 0);
            } else dead = true;
          }
          if (!dead && (s.y < s.r || s.y > A.h - s.r)) {
            if (s.bounces > 0) {
              s.y = U.clamp(s.y, s.r, A.h - s.r);
              this._bounce(s, 0, s.y <= s.r ? 1 : -1);
            } else dead = true;
          }
          if (!dead) {
            for (let k = 0; k < pillars.length; k++) {
              const pl = pillars[k];
              const dx = s.x - pl.x;
              const dy = s.y - pl.y;
              const d = Math.hypot(dx, dy);
              if (d < pl.r + s.r) {
                if (s.bounces > 0 && d > 0.001) {
                  s.x = pl.x + (dx / d) * (pl.r + s.r + 0.5);
                  s.y = pl.y + (dy / d) * (pl.r + s.r + 0.5);
                  this._bounce(s, dx / d, dy / d);
                } else dead = true;
                break;
              }
            }
          }
          if (dead) {
            this.fx.burst(s.x, s.y, 2, '#8d8a80', 60, 0.15);
            P.kill(i);
            continue;
          }
        }
        // Enemy collisions.
        this.grid.query(s.x, s.y, s.r, near);
        let consumed = false;
        for (let k = 0; k < near.length; k++) {
          const e = near[k];
          if (e.dead || e.spawnT > 0) continue;
          const rr = e.r + s.r;
          if (U.dist2(s.x, s.y, e.x, e.y) > rr * rr) continue;
          let seen = false;
          for (let h = 0; h < s.hitN; h++) if (s.hits[h] === e.uid) seen = true;
          if (seen) continue;
          if (s.hitN < s.hits.length) s.hits[s.hitN++] = e.uid;
          else {
            // Hit memory full: stop rather than re-hit someone already struck.
            consumed = true;
            break;
          }
          if (HE.Enemies.shieldBlocks(e, s.px, s.py)) {
            this.fx.spray(s.x, s.y, Math.atan2(s.py - e.y, s.px - e.x), 1.2, 5, '#9fd8ff', 220, 0.2);
            this.sfx('block', s.x);
            // The rope absorbs 80% from the front, so a frontal duel is slow but never stuck.
            this.hit(e, s.dmg * 0.2, { kind: 'blocked', depth: s.depth, chain: s.chain, noProc: true });
            if (s.bounces > 0) {
              const nx = (s.x - e.x) / (Math.hypot(s.x - e.x, s.y - e.y) || 1);
              const ny = (s.y - e.y) / (Math.hypot(s.x - e.x, s.y - e.y) || 1);
              this._bounce(s, nx, ny);
              continue;
            }
            consumed = true;
            break;
          }
          const first = s.primary && !s.didSplit;
          const add = s.bouncesDone * s.bounceBonus;
          this.hit(e, s.dmg, {
            kind: s.kind,
            primary: s.primary,
            depth: s.depth,
            chain: s.chain,
            procCoef: s.procCoef,
            allowShock: s.kind !== 'splinter',
            additive: add,
            x: s.x,
            y: s.y,
          });
          if (s.primary && !e.boss && !e.dead) {
            e.kx += s.vx * 0.06;
            e.ky += s.vy * 0.06;
          }
          if (first) this.perks.onFirstHit(s, e);
          if (s.pierce > 0) s.pierce--;
          else {
            consumed = true;
            break;
          }
        }
        if (consumed) P.kill(i);
      }
    }

    _updateBullets(dt) {
      const A = this.A;
      const B = this.bullets;
      const p = this.player;
      const pillars = this.layout.pillars;
      const hurtR = p.r;
      const grazeR = p.r + TP.grazeRadius;
      const canHurt = this.run.state === 'combat';
      for (let i = B.n - 1; i >= 0; i--) {
        const b = B.items[i];
        b.life -= dt;
        b.age += dt;
        b.vx += b.ax * dt;
        b.vy += b.ay * dt;
        b.x += b.vx * dt;
        b.y += b.vy * dt;
        if (b.life <= 0 || b.x < -40 || b.x > A.w + 40 || b.y < -40 || b.y > A.h + 40) {
          b.alive = false;
          B.kill(i);
          continue;
        }
        let blocked = false;
        if (b.shape !== 'ball') {
          for (let k = 0; k < pillars.length; k++) {
            const pl = pillars[k];
            if (U.dist2(b.x, b.y, pl.x, pl.y) < (pl.r + b.r) * (pl.r + b.r)) {
              blocked = true;
              break;
            }
          }
        }
        if (blocked) {
          this.fx.burst(b.x, b.y, 2, '#e8424c', 50, 0.15);
          b.alive = false;
          B.kill(i);
          continue;
        }
        if (!canHurt) continue;
        const d2 = U.dist2(b.x, b.y, p.x, p.y);
        const hr = hurtR + b.r;
        if (d2 < hr * hr) {
          if (p.iframes <= 0 && p.protect <= 0) {
            this.hurtPlayer(b.dmg, 'bullet');
            if (b.shape !== 'ball') {
              b.alive = false;
              B.kill(i);
            }
            continue;
          }
        }
        if (!b.grazed) {
          const gr = grazeR + b.r;
          if (d2 < gr * gr) {
            b.grazed = true;
            this._graze(b);
          }
        }
      }
    }

    _graze(b) {
      const T = TS;
      const room = Math.max(0, T.grazeChargePerSecondCap - this.grazeWindow.charge);
      const gain = Math.min(T.chargePerGraze, room);
      if (gain > 0) {
        this.slots.addCharge(gain);
        this.grazeWindow.charge += gain;
      }
      this.stats.grazes++;
      if (this.run.room) this.run.room.grazes++;
      this.fx.burst(b.x, b.y, 2, '#f1ece0', 70, 0.18, 1.6);
      this.sfx('graze', b.x);
      this.emit('graze', { sourceId: 'bullet:' + b.uid, flags: { charge: gain } });
      this._wagerEvent('graze');
      if (this.tutorial) this.tutorial.onEvent('graze');
    }

    clearBullets(x, y, r, silent) {
      const B = this.bullets;
      const r2 = r * r;
      let n = 0;
      for (let i = B.n - 1; i >= 0; i--) {
        const b = B.items[i];
        if (b.shape === 'ball' && r < 9999) continue;
        if (U.dist2(b.x, b.y, x, y) > r2) continue;
        if (!silent || this.fx.density > 0.5) this.fx.burst(b.x, b.y, 1, '#9fd8ff', 40, 0.2);
        b.alive = false;
        B.kill(i);
        n++;
      }
      return n;
    }

    /* ======================================================== damage */

    /**
     * The single damage entry point for enemies. `src` fields: kind,
     * primary, depth, chain, procCoef, allowShock, additive, noProc, noFx,
     * noCharge.
     */
    hit(e, amount, src) {
      if (!e || e.dead || !(amount > 0)) return 0;
      if (e.boss && e.transitionT > 0) {
        if (!src.noFx) this.fx.text(e.x, e.y - e.r, 'IMMUNE', '#8d8a80', 12, 0.4);
        return 0;
      }
      // Flat additions: none in M1. Additive group:
      let add = src.additive || 0;
      if (src.primary) add += this.caliberBonus;
      // Multiplicative groups:
      let mult = 1;
      if (src.primary && this.spins.crownT > 0) mult *= this.spins.crownMult;
      const fr = this.perks.p('P10');
      if (fr && fr.frozenBonus && e.frozenT > 0) mult *= 1 + fr.frozenBonus;
      if (e.boss && e.staggerT > 0) mult *= D.TUNING.boss.staggerDamageTaken;
      let dmg = amount * (1 + add) * mult;
      if (dmg > 999) dmg = 999;
      e.hp -= dmg;
      e.hurtT = 0.08;
      if (src.primary && !src.noCharge) this.slots.addCharge(dmg * TS.chargePerPrimaryDamage);
      if (!src.noFx && this.settings.damageNumbers && dmg >= 1 && src.kind !== 'burn') {
        const big = src.primary && (dmg > 20 || this.spins.crownT > 0);
        this.fx.text(e.x, e.y - e.r - 4, String(Math.round(dmg)), big ? '#f2c14e' : src.primary ? '#f1ece0' : '#a9a397', big ? 16 : 12, 0.55);
      }
      if (this.debug.logDamage) {
        const log = this.debug.damageLog;
        log.push({ t: +this.t.toFixed(2), target: e.kind, dmg: +dmg.toFixed(1), kind: src.kind, depth: src.depth || 0, chain: src.chain ? src.chain.id + ':' + src.chain.label : '-', primary: !!src.primary });
        if (log.length > 80) log.shift();
      }
      if (!src.noProc) {
        const coef = src.primary ? 1 : src.procCoef == null ? PR.secondaryCoef : src.procCoef;
        if (coef > 0) this.perks.applyOnHit(e, dmg, coef, src.chain, src.depth || 0, src.allowShock !== false);
      }
      if (e.hp <= 0) this._kill(e, src);
      return dmg;
    }

    explode(x, y, radius, dmg, src) {
      const list = this.liveEnemies();
      for (let i = 0; i < list.length; i++) {
        const e = list[i];
        if (e.dead) continue;
        const rr = radius + e.r;
        if (U.dist2(x, y, e.x, e.y) <= rr * rr) this.hit(e, dmg, src);
      }
      const color = src.color || '#e8424c';
      this.fx.ring(x, y, radius * 0.2, radius, 0.32, color, 4);
      this.fx.burst(x, y, 14, color, radius * 3, 0.4, 3);
      if (!src.silent) {
        this.addShake(4);
        this.sfx('explosion', x);
      }
    }

    addBurn(e, n) {
      if (e.dead) return;
      const fp = this.perks.p('P09') || D.perkById.P09.ranks[0];
      e.burnStacks = Math.min(fp.cap, e.burnStacks + n);
      e.burnT = fp.duration;
    }

    addChill(e, amount, chain, depth) {
      if (e.dead || !(amount > 0)) return;
      if (e.boss) {
        this.addStagger(e, amount * 0.35);
        return;
      }
      if (e.frozenT > 0) return;
      e.chill = Math.min(100, e.chill + amount);
      this.perks.onChill(e);
      if (e.chill >= 100 && e.freezeImmune <= 0) {
        e.frozenT = e.elite ? ST.eliteFreezeTime : ST.freezeTime;
        if (e.elite) e.freezeImmune = ST.eliteFreezeTime + ST.eliteFreezeImmunity;
        this.fx.burst(e.x, e.y, 8, '#bfe8ff', 110, 0.4);
        this.sfx('freeze', e.x);
      }
      void chain;
      void depth;
    }

    addStagger(e, amount) {
      HE.Boss.addStagger(this, e, amount);
    }

    noteRecipe(id) {
      if (!this.run) return;
      this.run.recipeTriggers[id] = (this.run.recipeTriggers[id] || 0) + 1;
      this.stats.recipesTriggered++;
      if (this.run.recipeTriggers[id] === 1) this.emit('recipe_triggered', { sourceId: id });
    }

    _kill(e, src) {
      if (e.dead) return;
      e.dead = true;
      e.hp = 0;
      const run = this.run;
      if (!e.rewarded) {
        e.rewarded = true;
        const def = e.def;
        let chips = (e.boss ? e.bossDef.chips : def.chips) * (e.elite ? D.ELITE.chipMult : 1) * (run.room ? run.room.chipMult : 1);
        if (this.spins.jackpotT > 0) chips *= 2;
        if (e.noReward) chips = 0;
        this._dropChips(e.x, e.y, chips);
        if (src.kind !== 'spin' && !src.noCharge) this.slots.addCharge(e.elite || e.boss ? TS.chargePerEliteKill : TS.chargePerKill);
        this.stats.kills++;
        if (e.elite) this.stats.eliteKills++;
        this.emit(e.elite ? 'elite_kill' : 'kill', { sourceId: e.kind, chainId: src.chain ? src.chain.id : null, depth: src.depth || 0, flags: { elite: e.elite, boss: !!e.boss } });
      }
      this.fx.burst(e.x, e.y, e.boss ? 60 : e.elite ? 22 : 12, e.boss ? '#f2c14e' : '#f1ece0', e.boss ? 380 : 200, 0.5, 2.6);
      this.fx.ring(e.x, e.y, e.r * 0.5, e.r * 2, 0.25, '#f1ece0', 2);
      this.sfx(e.boss ? 'boss_death' : e.elite ? 'elite_death' : 'enemy_death', e.x);
      if (e.elite) this.hitStopFor(0.04);
      if (e.boss) this._bossDefeated(e);
    }

    _dropChips(x, y, amount) {
      if (!(amount > 0)) return;
      const pieces = Math.min(10, Math.max(1, Math.round(amount / 3)));
      const each = amount / pieces;
      for (let i = 0; i < pieces; i++) {
        const c = this.pickups.spawn();
        if (!c) {
          // Pool full: pay directly rather than lose the reward.
          E.earn(this.run.wallet, each * (pieces - i), 'natural');
          return;
        }
        // Chip scatter affects collection timing, so it uses the combat stream.
        const a = this.combatRoll() * U.TAU;
        const sp = 60 + this.combatRoll() * 140;
        c.x = x;
        c.y = y;
        c.vx = Math.cos(a) * sp;
        c.vy = Math.sin(a) * sp;
        c.value = each;
        c.origin = 'natural';
        c.kind = 'chip';
        c.t = 0;
        c.vacuum = this.run.state === 'clear';
      }
    }

    _updatePickups(dt) {
      const P = this.pickups;
      const p = this.player;
      const mr2 = TP.magnetRadius * TP.magnetRadius;
      const cr2 = TP.pickupRadius * TP.pickupRadius;
      for (let i = P.n - 1; i >= 0; i--) {
        const c = P.items[i];
        c.t += dt;
        const d2 = U.dist2(c.x, c.y, p.x, p.y);
        if (c.t > 0.25 && d2 < cr2) {
          this._collect(c);
          P.kill(i);
          continue;
        }
        if (c.vacuum || (c.t > 0.3 && d2 < mr2)) {
          const d = Math.sqrt(d2) || 1;
          const pull = c.vacuum ? 1400 : 900;
          c.vx += ((p.x - c.x) / d) * pull * dt;
          c.vy += ((p.y - c.y) / d) * pull * dt;
          c.vx *= Math.exp(-2 * dt);
          c.vy *= Math.exp(-2 * dt);
        } else {
          c.vx *= Math.exp(-5 * dt);
          c.vy *= Math.exp(-5 * dt);
        }
        c.x = U.clamp(c.x + c.vx * dt, 6, this.A.w - 6);
        c.y = U.clamp(c.y + c.vy * dt, 6, this.A.h - 6);
      }
    }

    _collect(c) {
      const got = E.earn(this.run.wallet, c.value, c.origin);
      if (got > 0) this.emit('chips_earned', { origin: c.origin, flags: { amount: got } });
      this.sfx('chip', c.x);
    }

    _collectAllPickups() {
      const P = this.pickups;
      for (let i = P.n - 1; i >= 0; i--) {
        this._collect(P.items[i]);
        P.kill(i);
      }
    }

    /* ========================================================= zones */

    addZone(kind, o) {
      const z = this.zones.spawn();
      if (!z) return null;
      z.kind = kind;
      z.x = o.x;
      z.y = o.y;
      z.x2 = o.x2 == null ? o.x : o.x2;
      z.y2 = o.y2 == null ? o.y : o.y2;
      z.r = o.r || 0;
      z.width = o.width || 14;
      z.life = z.max = o.life || 1;
      z.dps = o.dps || 0;
      z.chain = o.chain || null;
      z.skid = !!o.skid;
      z.tickT = 0;
      return z;
    }

    _updateZones(dt) {
      const Z = this.zones;
      const list = this.liveEnemies();
      for (let i = 0; i < list.length; i++) list[i].zoneSlow = 0;
      for (let i = Z.n - 1; i >= 0; i--) {
        const z = Z.items[i];
        z.life -= dt;
        if (z.life <= 0) {
          if (z.kind === 'spark' && z.skid) {
            z.kind = 'skid';
            z.life = z.max = D.recipeById.S081.params.extraLife;
            this.noteRecipe('S081');
          } else {
            Z.kill(i);
            continue;
          }
        }
        z.tickT -= dt;
        const tick = z.tickT <= 0;
        if (tick) z.tickT = 0.2;
        for (let k = 0; k < list.length; k++) {
          const e = list[k];
          if (e.dead) continue;
          let inside;
          if (z.kind === 'steam') inside = U.dist2(e.x, e.y, z.x, z.y) < (z.r + e.r) * (z.r + e.r);
          else {
            const w = z.width + e.r;
            inside = U.segDist2(e.x, e.y, z.x, z.y, z.x2, z.y2) < w * w;
          }
          if (!inside) continue;
          if (z.kind === 'steam') {
            e.zoneSlow = Math.max(e.zoneSlow, D.recipeById.S017.params.slow);
            if (tick && e.steamTickCd <= 0) {
              e.steamTickCd = 0.2;
              this.hit(e, D.recipeById.S017.params.dps * 0.2 * this.damageScale(), { kind: 'steam', depth: 1, chain: z.chain, noProc: true, noFx: true });
            }
          } else if (z.kind === 'flame') {
            if (e.flameCd <= 0) {
              e.flameCd = D.recipeById.S003.params.burnEvery;
              this.addBurn(e, 1);
            }
          } else if (z.kind === 'spark') {
            if (e.sparkCd <= 0) {
              e.sparkCd = 0.2;
              this.hit(e, z.dps * 0.2 * this.damageScale(), { kind: 'spark', depth: 1, chain: z.chain, procCoef: PR.secondaryCoef, allowShock: true, noFx: true });
            }
          } else if (z.kind === 'skid') {
            if (e.skidCd <= 0) {
              e.skidCd = 0.2;
              this.addChill(e, D.recipeById.S081.params.chillPerTick, z.chain, 1);
            }
          }
        }
      }
    }

    /* ======================================================= enemies */

    _pickSpawn(minDist) {
      const A = this.A;
      const p = this.player;
      for (let tries = 0; tries < 30; tries++) {
        const x = 60 + this.combatRoll() * (A.w - 120);
        const y = 50 + this.combatRoll() * (A.h - 180);
        if (U.dist2(x, y, p.x, p.y) < minDist * minDist) continue;
        let ok = true;
        for (const pl of this.layout.pillars) if (U.dist2(x, y, pl.x, pl.y) < (pl.r + 40) * (pl.r + 40)) ok = false;
        if (ok) return { x, y };
      }
      return { x: A.w / 2, y: 80 };
    }

    spawnEnemy(role, x, y, elite, o) {
      const def = D.enemyById[role];
      const e = this.enemies.spawn();
      if (!e || !def) return null;
      o = o || {};
      if (x == null) {
        const pt = role === 'turret' ? this._turretSpot() : this._pickSpawn(280);
        x = pt.x;
        y = pt.y;
      }
      const hpMult = (elite ? D.ELITE.hpMult : 1) * (o.hpMult || 1) * (this.run ? D.floors[this.run.floorIndex].difficulty * 0.35 + 0.65 : 1);
      Object.assign(e, {
        uid: this.uidSeq++,
        alive: true,
        def,
        kind: role,
        boss: false,
        bossDef: null,
        x,
        y,
        vx: 0,
        vy: 0,
        kx: 0,
        ky: 0,
        r: def.radius * (elite ? D.ELITE.radiusMult : 1),
        hp: Math.round(def.hp * hpMult),
        maxHp: Math.round(def.hp * hpMult),
        elite: !!elite,
        t: 0,
        fireT: (def.fireEvery || def.burstEvery || def.cooldown || 2) * (0.5 + this.combatRoll() * 0.5),
        tellT: 0,
        state: role === 'turret' ? 'rest' : 'idle',
        aim: 0,
        facing: Math.atan2(this.player.y - y, this.player.x - x),
        dir: this.combatRoll() < 0.5 ? -1 : 1,
        spawnT: 0.8,
        attackDelay: 0.7,
        hurtT: 0,
        burnStacks: 0,
        burnT: 0,
        burnTickT: 0,
        chill: 0,
        frozenT: 0,
        freezeImmune: 0,
        shockedAt: -99,
        steamCd: 0,
        steamTickCd: 0,
        orbitCd: 0,
        sparkCd: 0,
        skidCd: 0,
        flameCd: 0,
        zoneSlow: 0,
        dead: false,
        rewarded: false,
        noReward: !!o.noReward,
        wanderX: x,
        wanderY: y,
        burstLeft: 0,
        burstT: 0,
        gapAngle: 0,
        spinAngle: 0,
        slow: o.slow == null ? 1 : o.slow,
        tag: o.tag || null,
        transitionT: 0,
        staggerT: 0,
      });
      if (role === 'turret') e.t = 1.2;
      return e;
    }

    _turretSpot() {
      const A = this.A;
      const spots = [
        { x: 150, y: 110 },
        { x: A.w - 150, y: 110 },
        { x: 150, y: A.h - 230 },
        { x: A.w - 150, y: A.h - 230 },
        { x: A.w / 2, y: 90 },
      ];
      const free = spots.filter((s) => {
        for (let i = 0; i < this.enemies.n; i++) {
          const e = this.enemies.items[i];
          if (e.kind === 'turret' && U.dist2(e.x, e.y, s.x, s.y) < 60 * 60) return false;
        }
        return U.dist2(s.x, s.y, this.player.x, this.player.y) > 250 * 250;
      });
      return free.length ? this.rngCombat.pick(free) : this._pickSpawn(280);
    }

    spawnPack(role, n, elite) {
      const c = this._pickSpawn(320);
      for (let i = 0; i < n; i++) {
        const a = (i / n) * U.TAU;
        this.spawnEnemy(role, U.clamp(c.x + Math.cos(a) * 40, 30, this.A.w - 30), U.clamp(c.y + Math.sin(a) * 40, 30, this.A.h - 30), elite && i === 0);
      }
    }

    spawnBoss(def) {
      const e = this.spawnEnemy('dealer', this.A.w / 2, 230, false, {});
      if (!e) return null;
      e.kind = def.id;
      e.boss = true;
      e.r = def.radius;
      e.hp = e.maxHp = def.hp;
      e.spawnT = 0.3;
      e.attackDelay = 0;
      HE.Boss.initBoss(e, def);
      this.boss = e;
      this.bossDefeated = false;
      this.emit('boss_started', { sourceId: def.id });
      return e;
    }

    _bossDefeated(e) {
      this.bossDefeated = true;
      this.stats.bossKills++;
      this.clearBullets(0, 0, 99999, false);
      for (let i = 0; i < this.enemies.n; i++) {
        const o = this.enemies.items[i];
        if (!o.dead && o !== e) this._kill(o, { kind: 'cleanup' });
      }
      this.hitStopFor(0.2);
      this.flashScreen(0.5, '#f2c14e');
      this.addShake(12);
      this.toast(e.bossDef.name + ' folds.', 'boss');
    }

    liveEnemies() {
      if (this._liveFrame !== this.frame) {
        const out = (this._live = this._live || []);
        out.length = 0;
        for (let i = 0; i < this.enemies.n; i++) {
          const e = this.enemies.items[i];
          if (!e.dead && e.spawnT <= 0) out.push(e);
        }
        this._liveFrame = this.frame;
      }
      return this._live;
    }

    /** Fresh array of live enemies whose body overlaps the circle. */
    queryEnemies(x, y, r) {
      const out = [];
      this.grid.query(x, y, r, this._q || (this._q = []));
      for (const e of this._q) {
        if (e.dead || e.spawnT > 0) continue;
        const rr = r + e.r;
        if (U.dist2(x, y, e.x, e.y) <= rr * rr) out.push(e);
      }
      return out;
    }

    nearestEnemies(x, y, n, range, exA, exB) {
      const list = this.liveEnemies();
      const r2 = range * range;
      const cand = [];
      for (let i = 0; i < list.length; i++) {
        const e = list[i];
        if (e.dead || e === exA || e === exB) continue;
        const d2 = U.dist2(x, y, e.x, e.y);
        if (d2 <= r2) cand.push({ e, d2 });
      }
      cand.sort((a, b) => a.d2 - b.d2);
      const out = [];
      for (let i = 0; i < Math.min(n, cand.length); i++) out.push(cand[i].e);
      return out;
    }

    aliveThreat() {
      let t = 0;
      for (let i = 0; i < this.enemies.n; i++) {
        const e = this.enemies.items[i];
        if (!e.dead) t += e.boss ? 20 : e.def.threat * (e.elite ? 2 : 1);
      }
      return t;
    }

    countTagged(tag) {
      let n = 0;
      for (let i = 0; i < this.enemies.n; i++) {
        const e = this.enemies.items[i];
        if (!e.dead && e.tag === tag) n++;
      }
      return n;
    }

    _updateEnemies(dt) {
      const P = this.enemies;
      const A = this.A;
      const p = this.player;
      const pillars = this.layout.pillars;
      const combat = this.run.state === 'combat';
      for (let i = P.n - 1; i >= 0; i--) {
        const e = P.items[i];
        if (e.dead) {
          e.alive = false;
          P.kill(i);
          continue;
        }
        if (e.spawnT > 0) {
          e.spawnT -= dt;
          continue;
        }
        if (e.attackDelay > 0) e.attackDelay -= dt;
        if (e.hurtT > 0) e.hurtT -= dt;
        if (e.orbitCd > 0) e.orbitCd -= dt;
        if (e.sparkCd > 0) e.sparkCd -= dt;
        if (e.skidCd > 0) e.skidCd -= dt;
        if (e.flameCd > 0) e.flameCd -= dt;
        if (e.steamCd > 0) e.steamCd -= dt;
        if (e.steamTickCd > 0) e.steamTickCd -= dt;
        if (e.freezeImmune > 0) e.freezeImmune -= dt;
        // Burn.
        if (e.burnStacks > 0) {
          e.burnT -= dt;
          e.burnTickT -= dt;
          if (e.burnTickT <= 0) {
            e.burnTickT = ST.burnTick;
            const fp = this.perks.p('P09') || D.perkById.P09.ranks[0];
            this.hit(e, e.burnStacks * fp.dps * ST.burnTick * this.damageScale(), { kind: 'burn', depth: 2, noProc: true, noFx: true });
            if (e.dead) continue;
          }
          if (e.burnT <= 0) e.burnStacks = 0;
        }
        // Chill / freeze.
        if (e.frozenT > 0) {
          e.frozenT -= dt;
          if (e.frozenT <= 0) e.chill = 30;
        } else if (e.chill > 0) e.chill = Math.max(0, e.chill - ST.chillDecayPerSecond * dt);
        const slow = (1 - (e.chill / 100) * ST.maxChillSlow) * (1 - e.zoneSlow) * e.slow;
        if (e.boss) {
          if (combat) HE.Boss.updateBoss(this, e, dt);
        } else if (e.frozenT > 0) {
          e.vx = 0;
          e.vy = 0;
        } else if (combat) {
          HE.EnemyAI[e.kind](this, e, dt, slow);
        }
        // Role AI already scales its steering speed by `slow`.
        e.x += (e.vx + e.kx) * dt;
        e.y += (e.vy + e.ky) * dt;
        e.kx *= Math.exp(-10 * dt);
        e.ky *= Math.exp(-10 * dt);
        e.x = U.clamp(e.x, e.r, A.w - e.r);
        e.y = U.clamp(e.y, e.r, A.h - e.r);
        for (let k = 0; k < pillars.length; k++) {
          const pl = pillars[k];
          const dx = e.x - pl.x;
          const dy = e.y - pl.y;
          const d = Math.hypot(dx, dy);
          const min = pl.r + e.r;
          if (d < min && d > 0.001) {
            e.x = pl.x + (dx / d) * min;
            e.y = pl.y + (dy / d) * min;
          }
        }
        if (combat && e.frozenT <= 0) {
          const rr = e.r + p.r + 4;
          if (U.dist2(e.x, e.y, p.x, p.y) < rr * rr) this.hurtPlayer(e.boss ? 20 : e.def.contact, e.kind);
        }
      }
      this._separate();
    }

    _separate() {
      const P = this.enemies;
      for (let i = 0; i < P.n; i++) {
        const a = P.items[i];
        if (a.dead || a.spawnT > 0 || a.boss) continue;
        for (let j = i + 1; j < P.n; j++) {
          const b = P.items[j];
          if (b.dead || b.spawnT > 0 || b.boss) continue;
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const min = a.r + b.r;
          const d2 = dx * dx + dy * dy;
          if (d2 >= min * min || d2 < 0.0001) continue;
          const d = Math.sqrt(d2);
          const push = (min - d) * 0.5;
          const nx = dx / d;
          const ny = dy / d;
          if (a.kind !== 'turret') {
            a.x -= nx * push;
            a.y -= ny * push;
          }
          if (b.kind !== 'turret') {
            b.x += nx * push;
            b.y += ny * push;
          }
        }
      }
    }

    _rebuildGrid() {
      this.grid.clear();
      const P = this.enemies;
      for (let i = 0; i < P.n; i++) {
        const e = P.items[i];
        if (!e.dead) this.grid.insert(e);
      }
    }
  }

  Game.SIM_STATES = SIM_STATES;
  Game.SAFE_STATES = SAFE_STATES;
  HE.Game = Game;
})(typeof window !== 'undefined' ? window : globalThis);
