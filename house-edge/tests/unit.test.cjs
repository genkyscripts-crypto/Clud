/*
 * Logic tests for the DOM-free layers (core, data, systems, game).
 * Run: npm test   (node --test)
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadHE, MemoryStorage } = require('./load.cjs');
const { playRun, botStep, seedBot } = require('./bot.cjs');

const HE = loadHE();
const D = HE.data;
const plain = (x) => JSON.parse(JSON.stringify(x));
const close = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= (eps || 1e-12), (msg || '') + ' expected ' + b + ' got ' + a);

function world(now0) {
  const clock = { now: now0 || 1.7e12 };
  const storage = new MemoryStorage();
  const ss = new HE.SaveSystem(storage, () => clock.now);
  const save = ss.load();
  const g = new HE.Game({ save, saveSystem: ss, now: () => clock.now });
  return { g, ss, storage, clock };
}

function step(g, n, fn) {
  for (let i = 0; i < n; i++) {
    if (fn) fn(i);
    g.update(1 / 60);
  }
}

/** Advances a run through safe screens until `pred` or a step limit. */
function advanceUntil(g, pred, limit, opts) {
  opts = opts || {};
  for (let i = 0; i < (limit || 60 * 60 * 10); i++) {
    if (pred(g)) return true;
    const st = g.run.state;
    if (st === 'wager') g.declineWager();
    else if (st === 'draft') g.chooseDraft(0);
    else if (st === 'doors') g.chooseDoor(0);
    else if (st === 'shop') g.leaveShop();
    else if (st === 'terminal') {
      if (opts.stopAtTerminal) return pred(g);
      g.floor().final ? g.terminalVault() : g.terminalBank();
    } else if (st === 'terminal_banked') g.terminalContinue();
    else if (st === 'results') return pred(g);
    else {
      botStep(g, 0.9);
      g.update(1 / 60);
    }
  }
  return pred(g);
}

/* ================================================================ catalog */

test('catalog validates and counts are honest', () => {
  assert.deepEqual(plain(HE.catalogErrors), []);
  assert.equal(D.weapons.length, 1);
  assert.equal(D.perks.length, 8);
  assert.equal(D.recipes.length, 8);
  assert.equal(D.enemies.length, 6);
  assert.equal(D.symbols.length, 6);
  for (const r of D.recipes) for (const i of r.ingredients) assert.ok(D.perkById[i], r.id + ' ingredient ' + i);
  assert.ok(Object.isFrozen(D.perks[0]), 'catalog is frozen');
});

/* ================================================================== slots */

test('classify: mixed, pairs in every position, triples, jackpot', () => {
  const c = HE.Slots.classify;
  assert.equal(c(['bullet', 'bolt', 'bell']).kind, 'mixed');
  assert.deepEqual(plain(c(['bolt', 'bolt', 'bell'])), { kind: 'pair', symbol: 'bolt', other: 'bell' });
  assert.deepEqual(plain(c(['bolt', 'bell', 'bolt'])), { kind: 'pair', symbol: 'bolt', other: 'bell' });
  assert.deepEqual(plain(c(['bell', 'bolt', 'bolt'])), { kind: 'pair', symbol: 'bolt', other: 'bell' });
  assert.equal(c(['skull', 'skull', 'skull']).kind, 'triple');
  assert.equal(c(['seven', 'seven', 'seven']).kind, 'jackpot');
});

test('displayed odds are exact: 1/216 unmodified, 1/36 with a held Seven, weighted reels', () => {
  const m = new HE.Slots.SlotMachine(HE.createRng(1));
  let o = m.odds();
  close(o.jackpot, 1 / 216);
  close(o.jackpot + o.triple + o.pair + o.mixed, 1, 1e-9);
  close(o.triple + o.jackpot, 6 / 216);
  close(o.pair, 90 / 216, 1e-9);
  m.last = ['seven', 'bell', 'bolt'];
  assert.equal(m.setHold(0, true), true);
  assert.equal(m.cost(), 125);
  close(m.odds().jackpot, 1 / 36);
  m.freeHolds = 1;
  assert.equal(m.cost(), 100, 'hold token removes the extra charge');
  m.clearHolds();
  m.setReelWeights(2, { seven: 1.5 });
  close(m.odds().jackpot, (1 / 6) * (1 / 6) * (1.5 / 6.5));
});

test('the spin algorithm matches the displayed odds (empirical)', () => {
  const m = new HE.Slots.SlotMachine(HE.createRng(99));
  m.setReelWeights(2, { seven: 1.5 });
  const N = 120000;
  let jack = 0;
  let pairs = 0;
  for (let i = 0; i < N; i++) {
    m.charge = 100;
    const r = m.spin();
    if (r.kind === 'jackpot') jack++;
    if (r.kind === 'pair') pairs++;
  }
  const o = m.odds();
  const sd = Math.sqrt((o.jackpot * (1 - o.jackpot)) / N);
  assert.ok(Math.abs(jack / N - o.jackpot) < 5 * sd, 'jackpot freq ' + jack / N + ' vs ' + o.jackpot);
  const sdp = Math.sqrt((o.pair * (1 - o.pair)) / N);
  assert.ok(Math.abs(pairs / N - o.pair) < 5 * sdp, 'pair freq');
});

test('holds: need a previous result, max one, keep the symbol, expire after one spin', () => {
  const m = new HE.Slots.SlotMachine(HE.createRng(5));
  assert.equal(m.setHold(0, true), false, 'no previous result');
  m.charge = 100;
  const first = m.spin();
  assert.equal(m.setHold(1, true), true);
  assert.equal(m.setHold(2, true), false, 'only one hold');
  assert.equal(m.canSpin(), false, 'hold raises cost above current charge');
  m.charge = 125;
  const second = m.spin();
  assert.equal(second.symbols[1], first.symbols[1]);
  assert.equal(second.cost, 125);
  assert.deepEqual(plain(m.holds), [false, false, false]);
  assert.equal(m.spin(), null, 'no charge, no spin');
});

test('tutorial demo spins are labeled and do not consume the reel stream', () => {
  const a = new HE.Slots.SlotMachine(HE.createRng(42));
  const b = new HE.Slots.SlotMachine(HE.createRng(42));
  a.demoQueue.push(['bullet', 'bullet', 'bullet']);
  a.charge = 200;
  const d = a.spin();
  assert.equal(d.demo, true);
  assert.equal(d.kind, 'triple');
  a.charge = 100;
  b.charge = 100;
  assert.deepEqual(plain(a.spin().symbols), plain(b.spin().symbols));
});

test('reel state restores exactly: reloading cannot reroll a spin', () => {
  const m = new HE.Slots.SlotMachine(HE.createRng(7));
  m.charge = 100;
  m.spin();
  m.charge = 150;
  const snap = plain(m.serialize());
  const next = m.spin();
  const m2 = new HE.Slots.SlotMachine(HE.createRng(1));
  m2.restore(snap);
  assert.deepEqual(plain(m2.spin().symbols), plain(next.symbols));
});

/* ================================================================ economy */

test('earnings: only natural income is multiplied; fractions are kept', () => {
  const w = HE.Economy.createWallet();
  w.multiplier = 1.5;
  assert.equal(HE.Economy.earn(w, 10, 'natural'), 15);
  assert.equal(HE.Economy.earn(w, 10, 'room_bonus'), 10);
  HE.Economy.earn(w, 0.5, 'natural');
  HE.Economy.earn(w, 0.5, 'natural');
  assert.equal(w.loose, 26);
  assert.equal(HE.Economy.multiplierBonus(w), 5);
  assert.throws(() => HE.Economy.earn(w, 1, 'bogus'));
  assert.equal(HE.Economy.spend(w, 100), false, 'all-or-nothing');
  assert.equal(w.loose, 26);
});

test('wagers escrow, allow one at a time, and settle exactly once', () => {
  const E = HE.Economy;
  const w = E.createWallet();
  E.earn(w, 60, 'room_bonus');
  const rec = E.placeWager(w, 'no_dash', 25, 'a');
  assert.ok(rec);
  assert.equal(w.loose, 35);
  assert.equal(w.escrow, 25);
  assert.equal(E.placeWager(w, 'no_damage', 10, 'b'), null, 'one active wager');
  assert.equal(E.settleWager(w, rec, true), 50);
  assert.equal(E.settleWager(w, rec, true), 0, 'second settle pays nothing');
  assert.equal(w.loose, 85);
  assert.equal(w.escrow, 0);
  assert.equal(w.earned.natural, 0, 'returned stakes are not natural income');
  const lost = E.placeWager(w, 'graze15', 50, 'c');
  E.settleWager(w, lost, false);
  E.settleWager(w, lost, true);
  assert.equal(w.loose, 35, 'failure consumes only the stake, once');
  assert.equal(E.placeWager(w, 'graze15', 999, 'd'), null, 'cannot stake more than loose');
});

test('defeat recovers 25% of loose, unstaked chips; open wagers fail first', () => {
  const E = HE.Economy;
  const w = E.createWallet();
  const acct = { banked: 10, lifetimeBanked: 10 };
  E.earn(w, 130, 'room_bonus');
  E.placeWager(w, 'no_dash', 30, 'x');
  const r = E.defeatRecovery(w, acct);
  assert.deepEqual(plain(r), { loose: 100, rate: 0.25, recovered: 25, lost: 75 });
  assert.equal(acct.banked, 35);
  assert.equal(w.escrow, 0);
  assert.equal(w.wagers[0].status, 'lost');
});

test('bank resets multiplier and heat; press on steps by 0.25 to a 3x cap', () => {
  const E = HE.Economy;
  const w = E.createWallet();
  for (let i = 0; i < 10; i++) E.pressOn(w);
  assert.equal(w.multiplier, 3);
  assert.equal(w.heat, 10);
  E.earn(w, 40, 'room_bonus');
  const acct = { banked: 0, lifetimeBanked: 0 };
  assert.equal(E.bank(w, acct), 40);
  assert.equal(w.multiplier, 1);
  assert.equal(w.heat, 0);
  assert.equal(acct.banked, 40);
  const w2 = E.createWallet();
  const pv = E.terminalPreview(w2);
  assert.equal(pv.press.nextMultiplier, 1.25);
  assert.equal(pv.press.nextHeat, 1);
});

/* ============================================================= facilities */

test('Slot Alley: curves, 8 h cap, clock rollback, single collection', () => {
  const F = HE.Facilities;
  const def = D.facilityById.slot_alley;
  assert.equal(F.cost(def, 0), 60);
  assert.equal(F.cost(def, 1), Math.round(60 * 1.35));
  assert.equal(F.rate(def, 0), 0);
  close(F.rate(def, 2), def.baseRate * 1.18, 1e-12);
  close(F.rate(def, 3), def.baseRate * 1.18 * 1.18 * 1.5, 1e-12, 'L3 milestone x1.5');
  const t0 = 1e12;
  const st = F.createState(t0);
  const acct = { banked: 200, lifetimeBanked: 200 };
  assert.equal(F.buyLevel(st, def, acct, t0).ok, true);
  assert.equal(acct.banked, 140);
  const rep = F.tick(st, def, t0 + 24 * 3600 * 1000);
  assert.equal(rep.capped, true);
  close(st.stored, F.cap(def, 1), 1e-6);
  const back = F.tick(st, def, t0);
  assert.equal(back.rolledBack, true);
  assert.equal(back.gain, 0);
  const got = F.collect(st, acct);
  assert.equal(got, Math.floor(F.cap(def, 1)));
  assert.equal(F.collect(st, acct), 0, 'nothing left to collect twice');
  const broke = { banked: 0, lifetimeBanked: 0 };
  assert.equal(F.buyLevel(st, def, broke, t0).ok, false);
  assert.deepEqual(plain(F.unlocks(def, 2)), ['warm_reels', 'hold_token']);
});

/* =================================================================== save */

test('save: round trip, corrupted main falls back to backup, migration, sanitize', () => {
  const storage = new MemoryStorage();
  const ss = new HE.SaveSystem(storage, () => 5);
  const s = ss.load();
  s.account.banked = 77;
  assert.equal(ss.write(s), true);
  s.account.banked = 88;
  ss.write(s);
  assert.equal(new HE.SaveSystem(storage, () => 6).load().account.banked, 88);
  storage.setItem(HE.Save.KEY, storage.getItem(HE.Save.KEY).replace('88', '99'));
  const ss2 = new HE.SaveSystem(storage, () => 6);
  assert.equal(ss2.load().account.banked, 77, 'checksum mismatch → backup');
  assert.equal(ss2.lastSource, 'backup');
  // v0 → v1 migration.
  const v0 = HE.Save.migrate({ version: 0, chips: 123.7, createdAt: 1 });
  assert.equal(v0.version, 1);
  assert.equal(v0.account.banked, 123);
  // Sanitize nonsense.
  const bad = HE.Save.sanitize({ account: { banked: -5 }, upgrades: { vitality: 99 }, facilities: { slot_alley: { level: 500, stored: 1e12, lastTick: 1 } }, discovered: { recipes: ['S003', 'NOPE'] }, settings: { shake: 9, music: 'loud' } }, 1);
  assert.equal(bad.account.banked, 0);
  assert.equal(bad.upgrades.vitality, 5);
  assert.equal(bad.facilities.slot_alley.level, 10);
  close(bad.facilities.slot_alley.stored, HE.Facilities.cap(D.facilityById.slot_alley, 10), 1e-6);
  assert.deepEqual(plain(bad.discovered.recipes), ['S003']);
  assert.equal(bad.settings.shake, 1);
  assert.equal(bad.settings.music, 0.55);
  // Failed writes report instead of throwing.
  storage.failWrites = true;
  assert.equal(ss.write(s), false);
});

test('a checkpoint for an already-settled run is discarded on load', () => {
  const s = HE.Save.createDefault(1);
  s.checkpoint = { runId: 'r1' };
  s.settledRuns = ['r1'];
  assert.equal(HE.Save.sanitize(s, 1).checkpoint, null);
});

/* ================================================================== game */

test('full seeded run: tutorial → floors → Vault; settles once; bank matches results', () => {
  const { g, ss } = world();
  seedBot(3);
  g.startRun({ tutorial: true, seed: 42 });
  const res = playRun(g, { skill: 0.9 });
  assert.ok(res, 'run finished');
  assert.equal(res.outcome, 'victory');
  assert.equal(res.floorsCleared, 2);
  assert.equal(g.save.account.banked, res.bankedTotal);
  const again = g.settleRun('victory');
  assert.equal(g.save.account.banked, res.bankedTotal, 'second settlement pays nothing');
  assert.equal(again, res);
  assert.equal(g.save.checkpoint, null);
  assert.ok(g.save.settledRuns.includes(g.run.id));
  assert.equal(g.save.tutorialDone, true);
  assert.equal(ss.load().account.banked, res.bankedTotal, 'persisted');
  assert.ok(res.stats.spins >= 3, 'spins happened');
});

test('same seed and inputs reproduce the same run; effect density cannot change outcomes', () => {
  const runOnce = (density) => {
    const { g } = world();
    g.fx.density = density;
    seedBot(9);
    g.startRun({ tutorial: false, seed: 777 });
    const spins = [];
    g.on('spin_resolved', (e) => spins.push(e.result.symbols.join('')));
    const res = playRun(g, { skill: 0.8 });
    return { res: plain(res), spins };
  };
  const a = runOnce(1);
  const b = runOnce(0.25);
  assert.deepEqual(a.spins, b.spins);
  assert.equal(a.res.bankedTotal, b.res.bankedTotal);
  assert.equal(a.res.time, b.res.time);
});

test('defeat: exact 25% recovery into the bank, once', () => {
  const { g } = world();
  g.startRun({ tutorial: false, seed: 5 });
  advanceUntil(g, (g) => g.run.state === 'combat' && g.run.wallet.loose >= 20);
  const loose = g.run.wallet.loose;
  const before = g.save.account.banked;
  g.player.hp = 5;
  g.player.iframes = 0;
  g.player.protect = 0;
  g.hurtPlayer(50, 'test');
  assert.equal(g.run.state, 'dying');
  step(g, 200);
  assert.equal(g.run.state, 'results');
  const r = g.run.results;
  assert.equal(r.outcome, 'defeat');
  assert.ok(r.recovery.loose >= loose);
  assert.equal(r.recovery.recovered, Math.floor(r.recovery.loose * 0.25));
  assert.equal(g.save.account.banked, before + r.recovery.recovered);
  g.abandonRun();
  assert.equal(g.save.account.banked, before + r.recovery.recovered);
});

test('wager placed mid-room is recorded as lost in the checkpoint; resume cannot recover it', () => {
  const { g, storage, clock } = world();
  g.startRun({ tutorial: false, seed: 11 });
  assert.ok(advanceUntil(g, (g) => g.run.state === 'wager'));
  const cpLooseBefore = g.save.checkpoint.wallet.loose;
  const stake = g.run.wagerOffer.stakes[0];
  g.placeWager(stake);
  assert.equal(g.run.wallet.escrow, stake);
  assert.equal(g.save.checkpoint.wallet.loose, cpLooseBefore - stake);
  // "Close the tab" and load again.
  const ss2 = new HE.SaveSystem(storage, () => clock.now);
  const g2 = new HE.Game({ save: ss2.load(), saveSystem: ss2, now: () => clock.now });
  assert.equal(g2.hasCheckpoint(), true);
  g2.resumeRun();
  assert.equal(g2.run.state, 'doors');
  assert.equal(g2.run.wallet.loose, cpLooseBefore - stake);
  assert.equal(g2.run.wallet.escrow, 0);
  assert.ok(g2.run.wallet.wagers.every((w) => w.settled));
  assert.deepEqual(plain(g2.run.doors), plain(g2.save.checkpoint.doors));
});

test('no-dash wager fails the moment you dash and pays nothing later', () => {
  const { g } = world();
  g.startRun({ tutorial: false, seed: 11 });
  advanceUntil(g, (g) => g.run.state === 'wager');
  g.run.wagerOffer.defId = 'no_dash';
  const loose = g.run.wallet.loose;
  const stake = g.run.wagerOffer.stakes[0];
  g.placeWager(stake);
  step(g, 30);
  g.input.dashPressed = true;
  step(g, 2);
  const rec = g.run.room.wager;
  assert.equal(rec.status, 'lost');
  advanceUntil(g, (g) => g.run.state === 'draft');
  assert.equal(rec.status, 'lost');
  assert.equal(g.run.wallet.earned.wager_return, 0);
  assert.ok(g.run.wallet.loose >= loose - stake);
});

test('terminal: bank once, preview matches, press-on raises multiplier and heat', () => {
  const { g } = world();
  g.startRun({ tutorial: false, seed: 21 });
  assert.ok(advanceUntil(g, (g) => g.run.state === 'terminal', null, { stopAtTerminal: true }));
  const loose = g.run.wallet.loose;
  const before = g.save.account.banked;
  assert.equal(g.terminalBank(), loose);
  assert.equal(g.terminalBank(), 0, 'cannot bank twice');
  assert.equal(g.save.account.banked, before + loose);
  assert.equal(g.save.checkpoint.state, 'terminal_banked');
  const { g: h } = world();
  h.startRun({ tutorial: false, seed: 21 });
  advanceUntil(h, (h) => h.run.state === 'terminal', null, { stopAtTerminal: true });
  h.terminalPress();
  assert.equal(h.run.wallet.multiplier, 1.25);
  assert.equal(h.run.wallet.heat, 1);
  assert.equal(h.run.floorIndex, 1);
  close(h.heatBulletMult, 1.08, 1e-9);
});

test('safe screens freeze the arena; enemies cannot act behind menus', () => {
  const { g } = world();
  g.startRun({ tutorial: false, seed: 3 });
  advanceUntil(g, (g) => g.run.state === 'combat' && g.bullets.n > 3);
  g.setState('draft');
  g.run.draft = [];
  const snap = g.bullets.items.slice(0, g.bullets.n).map((b) => b.x + ',' + b.y);
  const hp = g.player.hp;
  step(g, 120);
  assert.deepEqual(g.bullets.items.slice(0, g.bullets.n).map((b) => b.x + ',' + b.y), snap);
  assert.equal(g.player.hp, hp);
  g.setState('combat');
  g.paused = true;
  step(g, 60);
  assert.deepEqual(g.bullets.items.slice(0, g.bullets.n).map((b) => b.x + ',' + b.y), snap);
});

test('graze pays once per bullet and is capped per second; hits are not grazes', () => {
  const { g } = world();
  g.startRun({ tutorial: false, seed: 3 });
  g._clearArena();
  g.director = null;
  g.setState('combat');
  const p = g.player;
  p.x = 640;
  p.y = 400;
  const c0 = g.slots.charge;
  g.fireBullet(560, p.y + 20, 0, 300, {});
  step(g, 60);
  assert.equal(g.stats.grazes, 1);
  close(g.slots.charge - c0, D.TUNING.slots.chargePerGraze, 1e-9);
  // Twenty grazes in one second → capped.
  const c1 = g.slots.charge;
  g.grazeWindow = { t: 0, charge: 0 };
  for (let i = 0; i < 20; i++) g.fireBullet(600, p.y + 18 + (i % 3), 0, 1, { life: 0.2 });
  step(g, 5);
  assert.ok(g.slots.charge - c1 <= D.TUNING.slots.grazeChargePerSecondCap + 1e-9);
});

test('a kill pays chips once; spin-attack kills never generate charge', () => {
  const { g } = world();
  g.startRun({ tutorial: false, seed: 3 });
  g._clearArena();
  g.director = null;
  g.setState('combat');
  const e = g.spawnEnemy('dealer', 640, 200, false);
  e.spawnT = 0;
  const charge = g.slots.charge;
  g.hit(e, 9999, { kind: 'spin', depth: 1, noProc: true });
  const n = g.pickups.n;
  assert.ok(n > 0);
  g._kill(e, { kind: 'shot' });
  g.hit(e, 9999, { kind: 'shot', primary: true });
  assert.equal(g.pickups.n, n, 'no second drop');
  assert.equal(g.slots.charge, charge, 'spin kill gave no charge');
});

test('jackpot: 10 s, refresh +5, 20 s continuous cap, then cooldown pulse only', () => {
  const { g } = world();
  g.startRun({ tutorial: false, seed: 3 });
  g._clearArena();
  g.director = null;
  g.setState('combat');
  const sp = g.spins;
  sp.jackpot();
  assert.equal(sp.jackpotT, 10);
  step(g, 60 * 2);
  sp.jackpot();
  close(sp.jackpotT, 13, 0.2); // hit stop briefly freezes the timer
  sp.jackpot();
  sp.jackpot();
  assert.ok(sp.jackpotElapsed + sp.jackpotT <= 20 + 1e-6);
  step(g, 60 * 19);
  assert.equal(sp.jackpotT, 0);
  assert.ok(sp.jackpotCooldown > 0);
  sp.jackpot();
  assert.equal(sp.jackpotT, 0, 'cooldown: no new transformation');
});

test('proc chains respect depth and the 24-effect budget', () => {
  const { g } = world();
  g.debugRecipeScenario('S018');
  g.perks.add('P11');
  g.perks.add('P11');
  for (let i = 0; i < 40; i++) g.debugDummy('rusher', 200 + (i % 10) * 40, 200 + Math.floor(i / 10) * 40, 20);
  step(g, 2);
  const chain = g.newChain('test');
  const target = g.liveEnemies()[0];
  for (let i = 0; i < 60; i++) g.perks.shockArc(target, 10, g.perks.p('P11'), chain, 0);
  assert.ok(chain.emitted <= chain.budget, 'emitted ' + chain.emitted);
  assert.equal(g.chainAllow(chain, 3), false, 'depth 3 refused');
});

test('boss: never frozen, stagger meter bounded with an immunity window, phase gate', () => {
  const { g } = world();
  g.startRun({ tutorial: false, seed: 3 });
  g._clearArena();
  g.director = null;
  g.setState('combat');
  const b = g.spawnBoss(D.bossById.ladyzero);
  b.spawnT = 0;
  b.transitionT = 0;
  g.perks.add('P10');
  for (let i = 0; i < 40; i++) g.addChill(b, 100);
  assert.equal(b.frozenT, 0);
  assert.ok(b.staggerT > 0);
  const immune = b.staggerImmune;
  assert.ok(immune >= D.TUNING.boss.staggerTime + D.TUNING.boss.staggerImmunity - 1e-9);
  g.addStagger(b, 500);
  assert.equal(b.stagger, 0, 'no stagger build-up while staggered/immune');
  b.staggerT = 0;
  b.transitionT = 1;
  assert.equal(g.hit(b, 100, { kind: 'shot', primary: true }), 0, 'immune during phase transition');
});

test('director: at most two ranged roles and one turret per wave; seeded', () => {
  for (let seed = 1; seed < 40; seed++) {
    for (const f of D.floors) {
      const waves = HE.planRoom(f, 'highroller', 2, 2, HE.createRng(seed));
      for (const w of waves) {
        const ranged = new Set(w.groups.map((x) => x.role).filter((r) => r !== 'rusher' && r !== 'turret'));
        assert.ok(ranged.size <= 2);
        assert.ok(w.groups.filter((x) => x.role === 'turret').length <= 1);
        for (const gr of w.groups) assert.ok(f.rolePool.includes(gr.role));
      }
    }
    assert.deepEqual(plain(HE.planRoom(D.floors[1], 'combat', 1, 0, HE.createRng(seed))), plain(HE.planRoom(D.floors[1], 'combat', 1, 0, HE.createRng(seed))));
  }
});

test('drafts: first draft offers a behavior perk; favors recipes; never offers maxed perks; fallbacks', () => {
  const { g } = world();
  g.startRun({ tutorial: false, seed: 3 });
  for (let s = 0; s < 30; s++) {
    const d = HE.Run.draftOptions(g.perks, HE.createRng(s), { first: true });
    assert.equal(d.length, 3);
    assert.ok(d.some((o) => o.type === 'perk' && D.perkById[o.id].tags.includes('behavior')));
  }
  g.perks.add('P01');
  let withRecipe = 0;
  for (let s = 0; s < 60; s++) if (HE.Run.draftOptions(g.perks, HE.createRng(s), {}).some((o) => o.recipe)) withRecipe++;
  assert.ok(withRecipe > 40, 'recipe completion usually offered: ' + withRecipe);
  for (const p of D.perks) for (let r = 0; r < 3; r++) g.perks.add(p.id);
  const d = HE.Run.draftOptions(g.perks, HE.createRng(1), {});
  assert.deepEqual(plain(d.map((o) => o.type)), ['heal', 'chips', 'charge']);
});

test('tutorial: demo spin is labeled, steps advance, skip works and marks progress', () => {
  const { g } = world();
  g.startRun({ tutorial: true, seed: 8 });
  const results = [];
  g.on('spin_resolved', (e) => results.push(e.result));
  assert.ok(advanceUntil(g, (g) => !g.tutorial || g.tutorial.current.id === 'spin', 60 * 60));
  g.input.spinPressed = true;
  step(g, 60);
  assert.equal(results[0].demo, true);
  assert.deepEqual(plain(results[0].symbols), ['bullet', 'bullet', 'bullet']);
  const { g: h } = world();
  h.startRun({ tutorial: true, seed: 8 });
  step(h, 90);
  assert.equal(h.skipTutorial(), true);
  assert.equal(h.tutorial, null);
  assert.ok(h.director);
  assert.equal(h.save.tutorialDone, true);
});

test('account modifiers: capped upgrades and Slot Alley unlocks change the next run', () => {
  const { g } = world();
  g.save.account.banked = 5000;
  for (let i = 0; i < 7; i++) g.buyUpgrade('vitality');
  assert.equal(g.save.upgrades.vitality, 5, 'capped at 5 ranks');
  for (let i = 0; i < 5; i++) g.buyFacility('slot_alley');
  g.setPreset('loaded_seven', true);
  g.startRun({ tutorial: false, seed: 1 });
  assert.equal(g.player.maxHp, 125);
  assert.equal(g.slots.charge, 50, 'Warm Reels');
  assert.equal(g.slots.freeHolds, 1, 'Hold Token');
  close(g.slots.odds().jackpot, (1 / 36) * (1.5 / 6.5), 1e-12);
});

test('debug runs never touch the saved account', () => {
  const { g, storage } = world();
  const before = storage.getItem(HE.Save.KEY);
  g.debugRecipeScenario('S003');
  HE.Economy.earn(g.run.wallet, 500, 'debug');
  g.settleRun('victory');
  assert.equal(g.save.account.banked, 0);
  assert.equal(storage.getItem(HE.Save.KEY), before);
});

/* ======================================================= recipe scenarios */

function scenario(rid, frames, perFrame) {
  const { g } = world();
  g.debugRecipeScenario(rid);
  step(g, 2);
  for (let i = 0; i < frames; i++) {
    perFrame(g, i);
    g.update(1 / 60);
  }
  return g;
}

const aimAt = (g, x, y) => {
  g.input.aimX = x;
  g.input.aimY = y;
  g.input.fire = true;
};

test('S003 Burning Bank Shot: bounces leave flame strips, at most two per shot', () => {
  let maxStrips = 0;
  const g = scenario('S003', 240, (g) => {
    aimAt(g, 0, g.player.y - 30);
    for (let i = 0; i < g.shots.n; i++) maxStrips = Math.max(maxStrips, g.shots.items[i].strips);
  });
  assert.ok(g.run.recipeTriggers.S003 > 0);
  assert.ok(maxStrips <= 2);
});

test('S005 Boomerang Bloom: returning shots bloom into petals that never return', () => {
  let returningPetal = false;
  const g = scenario('S005', 300, (g) => {
    aimAt(g, g.A.w, g.player.y);
    for (let i = 0; i < g.shots.n; i++) if (g.shots.items[i].kind === 'petal' && g.shots.items[i].returning) returningPetal = true;
  });
  assert.ok(g.run.recipeTriggers.S005 > 0);
  assert.equal(returningPetal, false);
});

test("S007 Saturn's Wager: captured shots join the ring (max 6) and discharge", () => {
  let maxExtra = 0;
  let discharges = 0;
  const g = scenario('S007', 360, (g) => {
    aimAt(g, g.A.w, g.player.y);
    maxExtra = Math.max(maxExtra, g.perks.extras.length);
    for (let i = 0; i < g.shots.n; i++) if (g.shots.items[i].kind === 'discharge') discharges++;
  });
  assert.ok(g.run.recipeTriggers.S007 > 0);
  assert.ok(maxExtra >= 1 && maxExtra <= 6);
  assert.ok(discharges > 0);
});

test('S017 Steam Table: chilling a burning enemy makes a steam field (per-enemy cooldown)', () => {
  const g = scenario('S017', 300, (g) => aimAt(g, g.A.w / 2, 280));
  assert.ok(g.run.recipeTriggers.S017 > 0);
  assert.ok(g.run.recipeTriggers.S017 <= 7 * Math.ceil(5 / 1.5) + 7, 'bounded by cooldown');
});

// Sweeps the aim across the dummy cluster, like a player spraying a pack.
const sweep = (g, i) => aimAt(g, g.A.w / 2 - 120 + (Math.floor(i / 12) % 5) * 60, 270);

test('S018 Plasma Payout and S021 Brittle Circuit trigger from shock arcs', () => {
  const a = scenario('S018', 480, sweep);
  assert.ok(a.run.recipeTriggers.S018 > 0);
  // Brittle Circuit rewards focus fire: chill one target high, then shock it.
  const b = scenario('S021', 480, (g) => aimAt(g, g.A.w / 2, 260));
  assert.ok(b.run.recipeTriggers.S021 > 0);
});

test('S081 Skid Row: dash trails turn into frost skids that chill', () => {
  const g = scenario('S081', 200, (g, i) => {
    g.input.fire = false;
    if (i === 0) {
      g.player.x = g.A.w / 2 - 220;
      g.player.y = 270;
    }
    if (i === 5) {
      g.input.moveX = 1;
      g.input.moveY = 0;
      g.input.dashPressed = true;
    }
    if (i === 20) g.input.moveX = 0;
  });
  assert.ok(g.run.recipeTriggers.S081 > 0);
});

test('S089 Live Wire: a dash strikes recently shocked enemies', () => {
  const g = scenario('S089', 600, (g, i) => {
    aimAt(g, g.A.w / 2, 280);
    if (i % 60 === 30) {
      g.input.moveX = i % 120 === 30 ? 1 : -1;
      g.input.dashPressed = true;
    }
    if (i % 60 === 45) g.input.moveX = 0;
  });
  assert.ok(g.run.recipeTriggers.S089 > 0);
});

/* ============================================================ performance */

test('stress scene stays inside fixed pools (timing reported, not asserted)', () => {
  const { g } = world();
  g.debugStress(true);
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < 180; i++) {
    g.debugStressTick();
    g.update(1 / 60);
  }
  const ms = Number(process.hrtime.bigint() - t0) / 1e6 / 180;
  assert.ok(g.enemies.n <= g.enemies.capacity);
  assert.ok(g.bullets.n <= g.bullets.capacity);
  assert.ok(g.shots.n <= g.shots.capacity);
  assert.ok(g.enemies.n >= 140, 'enemies ' + g.enemies.n);
  console.log('    stress sim step (Node): ' + ms.toFixed(2) + ' ms  enemies ' + g.enemies.n + ' hostile ' + g.bullets.n + ' friendly ' + g.shots.n);
});
