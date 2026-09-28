/*
 * Logic tests for the DOM-free layers (core, data, systems, game).
 * Run: npm test   (node --test)
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadZTA, MemoryStorage } = require('./load.cjs');

const ZTA = loadZTA();
const D = ZTA.data;
const C = ZTA.content;

/** Objects from the VM sandbox have foreign prototypes; compare as plain JSON. */
const plain = (x) => JSON.parse(JSON.stringify(x));

function newGame(seed, save) {
  const game = new ZTA.Game({ seed: seed || 7, save: save || ZTA.SaveSystem.createDefault(1000) });
  game.resize(1600, 900);
  return game;
}

/** Aims at the nearest standing target's weak point (or center). */
function aimBot(game) {
  const cam = game.camera;
  const t = game.targets.list.find((x) => x.state === 'active' && x.delay <= 0 && x.appear > 0.6);
  if (!t) return false;
  let p;
  if (t.kind === 'plate') {
    const c = t.plateCenter({});
    p = cam.project(c.x, c.y, t.z);
  } else if (t.kind === 'bottle') {
    p = cam.project(t.x, t.baseY + t.def.shape.h * t.scale * 0.35, t.z);
  } else {
    const g = t.runnerGeom({});
    p = cam.project(t.x, g.coreY, t.z);
  }
  game.setAim(p.sx, p.sy);
  return true;
}

function runBot(game, seconds, dt) {
  const step = dt || 1 / 60;
  const n = Math.round(seconds / step);
  for (let i = 0; i < n; i++) {
    const has = aimBot(game);
    if (has && !game.weapons.trigger) game.weapons.pressTrigger();
    if (!has && game.weapons.trigger) game.weapons.releaseTrigger();
    game.update(step);
  }
}

/* ------------------------------------------------------------------ catalog */

test('content catalog validates with no problems', () => {
  assert.deepEqual(plain(C.validateCatalog()), []);
});

test('definitions are frozen and resolving stats never mutates them', () => {
  const def = D.weaponById['gun.kestrel_p9'];
  assert.ok(Object.isFrozen(def) && Object.isFrozen(def.fire) && Object.isFrozen(def.upgrades[0]));
  const before = JSON.stringify(def);
  const s = C.resolveWeaponStats(def, { 'upg.damage': 3, 'upg.reload': 2 });
  s.damage = 999;
  s.reload.time = 0;
  assert.equal(JSON.stringify(def), before);
});

test('the three Phase 1 guns are mechanically distinct', () => {
  const [p, s, g] = ['gun.kestrel_p9', 'gun.hornet_k', 'gun.brute_12'].map((id) => C.resolveWeaponStats(D.weaponById[id], {}));
  assert.notEqual(p.mode, s.mode);
  assert.notEqual(s.mode, g.mode);
  assert.ok(s.rpm > p.rpm * 2, 'SMG much faster');
  assert.ok(g.pellets > 1 && p.pellets === 1 && s.pellets === 1, 'only the shotgun fires pellets');
  assert.equal(g.reload.style, 'shell');
  assert.equal(p.reload.style, 'magazine');
  assert.notEqual(p.perk.id, s.perk.id);
  assert.notEqual(s.perk.id, g.perk.id);
  // SMG struggles against armor: many more body shots on a runner than the pistol.
  const runner = D.targetById['tgt.runner'];
  assert.ok(C.shotsToBreak(s, runner, { weak: false }) > C.shotsToBreak(p, runner, { weak: false }) * 3);
  // Shotgun one-shots a near plate when every pellet lands.
  assert.equal(C.shotsToBreak(g, D.targetById['tgt.plate'], { weak: false, distance: 7 }), 1);
});

test('upgrade previews report exact costs and shots-to-break breakpoints', () => {
  const def = D.weaponById['gun.kestrel_p9'];
  const d1 = C.describeWeaponUpgrade(def, { 'upg.damage': 1 }, 'upg.damage');
  assert.equal(d1.cost, Math.round(20 * 1.55));
  assert.equal(d1.fromText, '12.5 dmg');
  assert.equal(d1.toText, '15 dmg');
  const plate = d1.breakpoints.find((b) => b.targetId === 'tgt.plate' && !b.weak);
  assert.deepEqual([plate.from, plate.to], [3, 2]);
  const maxed = C.describeWeaponUpgrade(def, { 'upg.damage': 10 }, 'upg.damage');
  assert.equal(maxed.maxed, true);
  assert.equal(maxed.cost, null);
});

test('every gun can break every target (no impossible encounters)', () => {
  for (const w of D.weapons) {
    const s = C.resolveWeaponStats(w, {});
    for (const t of D.targets) {
      const n = C.shotsToBreak(s, t, { weak: false, distance: 18 });
      assert.ok(Number.isFinite(n) && n < 150, w.id + ' vs ' + t.id + ' = ' + n);
    }
  }
});

/* ------------------------------------------------------------------ numbers */

test('currency formatting is consistent across magnitudes', () => {
  const f = ZTA.fmt.cash;
  assert.equal(f(0), '$0');
  assert.equal(f(7.9), '$7');
  assert.equal(f(999999), '$999,999');
  assert.equal(f(1234567), '$1.23M');
  assert.equal(f(12345678), '$12.3M');
  assert.equal(f(4.56e12), '$4.56T');
  assert.equal(f(1e40), '$1.00e40');
  assert.equal(f(Infinity), '$∞');
});

/* ------------------------------------------------------------------ economy */

test('economy rejects invalid amounts and never goes negative', () => {
  const save = ZTA.SaveSystem.createDefault(0);
  const eco = new ZTA.Economy(save, new ZTA.Emitter());
  assert.equal(eco.earn(NaN), 0);
  assert.equal(eco.earn(-5), 0);
  assert.equal(eco.earn(Infinity), 0);
  assert.equal(eco.earn(10), 10);
  assert.equal(eco.trySpend(11), false);
  assert.equal(save.cash, 10);
  assert.equal(eco.trySpend(-1), false);
  assert.equal(eco.trySpend(NaN), false);
  assert.equal(eco.trySpend(10), true);
  assert.equal(save.cash, 0);
  const rng = ZTA.createRng(99);
  for (let i = 0; i < 5000; i++) {
    if (rng.chance(0.5)) eco.earn(rng.range(0, 50));
    else eco.trySpend(Math.round(rng.range(0, 80)));
    assert.ok(save.cash >= 0);
  }
});

/* -------------------------------------------------------------- progression */

test('buying an upgrade deducts the exact cost once and raises the level', () => {
  const game = newGame();
  const p = game.progression;
  assert.equal(p.buyWeaponUpgrade('gun.kestrel_p9', 'upg.damage').ok, false, 'cannot afford at $0');
  assert.equal(game.save.cash, 0);
  game.economy.earn(100);
  const r = p.buyWeaponUpgrade('gun.kestrel_p9', 'upg.damage');
  assert.equal(r.ok, true);
  assert.equal(game.save.cash, 80);
  assert.equal(game.save.weaponLevels['gun.kestrel_p9']['upg.damage'], 1);
  assert.equal(p.stats('gun.kestrel_p9').damage, 12.5);
  assert.equal(p.buyWeaponUpgrade('gun.hornet_k', 'upg.damage').ok, false, 'cannot upgrade an unowned gun');
});

test('unlocking auto-equips into an empty slot and cannot repeat', () => {
  const game = newGame();
  game.economy.earn(2000);
  const r = game.progression.unlockWeapon('gun.hornet_k');
  assert.equal(r.ok, true);
  assert.equal(r.slot, 1);
  assert.deepEqual(plain(game.save.equipped), ['gun.kestrel_p9', 'gun.hornet_k', null]);
  assert.equal(game.save.cash, 2000 - D.weaponById['gun.hornet_k'].unlockCost);
  assert.equal(game.progression.unlockWeapon('gun.hornet_k').ok, false);
  assert.equal(game.save.cash, 2000 - D.weaponById['gun.hornet_k'].unlockCost);
  // Equipping a gun already in another slot swaps them.
  game.progression.equip(0, 'gun.hornet_k');
  assert.deepEqual(plain(game.save.equipped), ['gun.hornet_k', 'gun.kestrel_p9', null]);
});

test('range upgrades change live modifiers', () => {
  const game = newGame();
  game.economy.earn(1000);
  assert.equal(game.progression.rangeModifiers().cashMult, 1);
  game.progression.buyRangeUpgrade('rng.bounty');
  assert.equal(game.progression.rangeModifiers().cashMult, 1.2);
  game.progression.buyRangeUpgrade('rng.stands');
  assert.equal(game.progression.rangeModifiers().extraTargets, 1);
});

/* --------------------------------------------------------------------- save */

test('save/load round-trips money, ownership, equipment, upgrades and settings', () => {
  const store = new MemoryStorage();
  const game = newGame();
  game.economy.earn(5000);
  game.progression.unlockWeapon('gun.hornet_k');
  game.progression.buyWeaponUpgrade('gun.hornet_k', 'upg.magazine');
  game.progression.buyRangeUpgrade('rng.bounty');
  game.progression.equip(2, 'gun.kestrel_p9');
  game.save.activeSlot = 2;
  game.save.settings.shake = false;
  game.save.settings.volume = 0.25;
  assert.equal(ZTA.SaveSystem.save(store, game.save, 5000).ok, true);

  const loaded = ZTA.SaveSystem.load(store, 6000);
  assert.equal(loaded.source, 'main');
  const d = loaded.data;
  assert.equal(d.cash, game.save.cash);
  assert.deepEqual(plain(d.owned), plain(game.save.owned));
  assert.deepEqual(plain(d.equipped), plain(game.save.equipped));
  assert.equal(d.activeSlot, 2);
  assert.deepEqual(plain(d.weaponLevels), plain(game.save.weaponLevels));
  assert.deepEqual(plain(d.rangeLevels), plain(game.save.rangeLevels));
  assert.equal(d.settings.shake, false);
  assert.equal(d.settings.volume, 0.25);
});

test('a corrupted main save falls back to the backup; both corrupted starts fresh', () => {
  const store = new MemoryStorage();
  const s = ZTA.SaveSystem.createDefault(1);
  s.cash = 111;
  ZTA.SaveSystem.save(store, s, 2);
  s.cash = 222;
  ZTA.SaveSystem.save(store, s, 3); // backup now holds the 111 save
  store.setItem(ZTA.SaveSystem.KEY, store.getItem(ZTA.SaveSystem.KEY).replace('222', '999')); // checksum no longer matches
  const r1 = ZTA.SaveSystem.load(store, 4);
  assert.equal(r1.source, 'backup');
  assert.equal(r1.data.cash, 111);
  assert.ok(r1.warnings.some((w) => /checksum/.test(w)));

  store.setItem(ZTA.SaveSystem.BACKUP_KEY, '{not json');
  const r2 = ZTA.SaveSystem.load(store, 5);
  assert.equal(r2.source, 'new');
  assert.equal(r2.data.cash, 0);
});

test('a corrupt save is never rotated into the backup slot', () => {
  const store = new MemoryStorage();
  const s = ZTA.SaveSystem.createDefault(1);
  s.cash = 50;
  ZTA.SaveSystem.save(store, s, 2);
  ZTA.SaveSystem.save(store, s, 3);
  const goodBackup = store.getItem(ZTA.SaveSystem.BACKUP_KEY);
  store.setItem(ZTA.SaveSystem.KEY, 'garbage');
  ZTA.SaveSystem.save(store, s, 4);
  assert.equal(store.getItem(ZTA.SaveSystem.BACKUP_KEY), goodBackup);
});

test('sanitize repairs hostile or outdated data', () => {
  const d = ZTA.SaveSystem.sanitize({
    cash: -50,
    blueprints: 2.7,
    owned: ['gun.hornet_k', 'gun.deleted_gun', 42],
    equipped: ['gun.brute_12', 'gun.hornet_k', 'gun.hornet_k'],
    activeSlot: 7,
    weaponLevels: { 'gun.kestrel_p9': { 'upg.damage': 99, 'upg.bogus': 3, 'upg.reload': -2 }, 'gun.deleted_gun': { 'upg.damage': 1 } },
    rangeLevels: { 'rng.bounty': 1.5, 'rng.stands': 2 },
    settings: { volume: 9, shake: 'yes' },
    stats: { shots: -1, hits: 'x' },
  });
  assert.equal(d.cash, 0);
  assert.equal(d.blueprints, 2);
  assert.deepEqual(plain(d.owned), ['gun.kestrel_p9', 'gun.hornet_k']);
  assert.deepEqual(plain(d.equipped), [null, 'gun.hornet_k', null], 'unowned and duplicate entries removed');
  assert.equal(d.activeSlot, 1);
  assert.deepEqual(plain(d.weaponLevels), { 'gun.kestrel_p9': { 'upg.damage': 10 } });
  assert.deepEqual(plain(d.rangeLevels), { 'rng.stands': 2 });
  assert.equal(d.settings.volume, 1);
  assert.equal(d.settings.shake, true);
  assert.equal(d.stats.shots, 0);
});

test('saving survives storage that throws or is missing', () => {
  const store = new MemoryStorage();
  store.failWrites = true;
  const r = ZTA.SaveSystem.save(store, ZTA.SaveSystem.createDefault(1), 2);
  assert.equal(r.ok, false);
  assert.equal(ZTA.SaveSystem.save(null, ZTA.SaveSystem.createDefault(1), 2).ok, false);
  assert.equal(ZTA.SaveSystem.load(null, 3).source, 'new');
});

test('unversioned legacy saves migrate', () => {
  const store = new MemoryStorage();
  const legacy = ZTA.SaveSystem.createDefault(1);
  delete legacy.version;
  legacy.cash = 77;
  store.setItem(ZTA.SaveSystem.KEY, ZTA.SaveSystem.serialize(legacy));
  const r = ZTA.SaveSystem.load(store, 2);
  assert.equal(r.source, 'main');
  assert.equal(r.data.cash, 77);
  assert.equal(r.data.version, ZTA.SaveSystem.VERSION);
});

/* ------------------------------------------------------------------ weapons */

test('holding the trigger fires at the capped rate, first shot immediately', () => {
  const game = newGame();
  game.begin();
  game.setLive(true);
  game.update(0.3); // finish the draw
  game.setAim(0, 0); // aim at the ceiling corner: pure misses are fine here
  let shots = 0;
  game.events.on('weapon:fired', () => shots++);
  game.weapons.pressTrigger();
  assert.equal(shots, 1, 'fires inside the input handler, before the next frame');
  for (let i = 0; i < 60; i++) game.update(1 / 60);
  // 300 rpm → one shot per 0.2 s: the immediate shot + 5 more in one second.
  assert.equal(shots, 6);
});

test('ammo never goes negative and auto-reload refills exactly to capacity', () => {
  const game = newGame();
  game.begin();
  game.setLive(true);
  game.setAim(0, 0);
  game.update(0.3);
  game.weapons.pressTrigger();
  let min = Infinity;
  let reloads = 0;
  game.events.on('weapon:reloadEnd', () => reloads++);
  for (let i = 0; i < 60 * 8; i++) {
    game.update(1 / 60);
    min = Math.min(min, game.weapons.active.ammo);
    assert.ok(game.weapons.active.ammo <= game.weapons.stats.magazine);
  }
  assert.ok(min >= 0);
  assert.ok(reloads >= 1);
});

test('pausing stops fire and requires a fresh press after resuming', () => {
  const game = newGame();
  game.begin();
  game.setLive(true);
  game.setAim(0, 0);
  game.update(0.3);
  let shots = 0;
  game.events.on('weapon:fired', () => shots++);
  game.weapons.pressTrigger();
  game.setLive(false);
  const frozen = shots;
  for (let i = 0; i < 120; i++) game.update(1 / 60);
  assert.equal(shots, frozen, 'no shots while paused');
  game.setLive(true);
  for (let i = 0; i < 60; i++) game.update(1 / 60);
  assert.equal(shots, frozen, 'held trigger was released by the pause');
});

test('switching mid-reload cancels it and never refills or duplicates ammo', () => {
  const game = newGame();
  game.economy.earn(1000);
  game.progression.unlockWeapon('gun.hornet_k');
  game.begin();
  game.setLive(true);
  game.setAim(0, 0);
  game.update(0.3);
  const w = game.weapons;
  w.active.ammo = 3;
  assert.equal(w.requestReload(), true);
  game.update(0.2);
  assert.equal(w.switchTo(1), true);
  assert.equal(w.runtime('gun.kestrel_p9').ammo, 3, 'cancelled reload did not refill');
  game.update(0.5);
  w.switchTo(0);
  game.update(0.4);
  assert.equal(w.active.ammo, 3);
  assert.equal(w.switchTo(0), false, 'switching to the active slot is a no-op');
  assert.equal(w.switchTo(2), false, 'switching to an empty slot is a no-op');
});

test('shell reloads load one shell at a time and can be interrupted by firing', () => {
  const game = newGame();
  game.economy.earn(5000);
  game.progression.unlockWeapon('gun.hornet_k');
  game.progression.unlockWeapon('gun.brute_12');
  game.begin();
  game.setLive(true);
  game.setAim(0, 0);
  game.weapons.switchTo(2);
  game.update(0.5);
  const w = game.weapons;
  w.active.ammo = 1;
  let shells = 0;
  game.events.on('weapon:reloadShell', () => shells++);
  w.requestReload();
  const st = w.stats;
  game.update(st.reload.start + st.reload.perShell * 2 + 0.01);
  assert.equal(shells, 2);
  assert.equal(w.active.ammo, 3);
  let shots = 0;
  game.events.on('weapon:fired', () => shots++);
  w.pressTrigger();
  assert.equal(shots, 1, 'firing interrupts the shell reload');
  assert.equal(w.active.ammo, 2);
  assert.equal(w.state, 'ready');
});

/* ------------------------------------------------------------------ rewards */

test('a target pays exactly once, however many pellets or shots hit it', () => {
  const game = newGame();
  const events = [];
  game.events.on('target:broken', (e) => events.push(e));
  const t = game.targets.spawn('tgt.plate', { x: 0, z: 7, baseY: D.range.carrierY });
  t.appear = 1;
  assert.deepEqual(plain(t.applyDamage(100, { weakHits: 0, wx: 0, wy: 1.5 })), { broken: true });
  assert.equal(t.applyDamage(100, { weakHits: 0, wx: 0, wy: 1.5 }), null, 'no damage after breaking');
  const a = game.rewardBreak(t, { weak: false, breakIndex: 0, breakCount: 1, perkMult: 1, weaponId: 'gun.kestrel_p9' });
  const b = game.rewardBreak(t, { weak: false, breakIndex: 0, breakCount: 1, perkMult: 1, weaponId: 'gun.kestrel_p9' });
  assert.ok(a > 0);
  assert.equal(b, 0);
  assert.equal(events.length, 1);
});

test('an active target cannot be rewarded', () => {
  const game = newGame();
  const t = game.targets.spawn('tgt.bottle', { x: 0, z: 6, baseY: 0.7 });
  assert.equal(game.rewardBreak(t, { weak: false }), 0);
});

test('long bot session: one reward per break, one bonus per wave, bounded targets', () => {
  const game = newGame(1234);
  game.economy.earn(5000);
  game.progression.unlockWeapon('gun.hornet_k');
  game.progression.unlockWeapon('gun.brute_12');
  game.progression.buyRangeUpgrade('rng.stands');
  game.begin();
  game.setLive(true);
  let broken = 0;
  let waveClears = 0;
  let waveStarts = 0;
  let maxTargets = 0;
  const bonusByWave = new Map();
  game.events.on('target:broken', () => broken++);
  game.events.on('wave:start', () => waveStarts++);
  game.events.on('wave:clear', (e) => {
    waveClears++;
    bonusByWave.set(e.index, (bonusByWave.get(e.index) || 0) + 1);
  });
  let switchT = 0;
  for (let i = 0; i < 60 * 60 * 5; i++) {
    const has = aimBot(game);
    if (has && !game.weapons.trigger) game.weapons.pressTrigger();
    if (!has && game.weapons.trigger) game.weapons.releaseTrigger();
    if (++switchT % 1500 === 0) game.weapons.cycle(1);
    game.update(1 / 60);
    maxTargets = Math.max(maxTargets, game.targets.list.length);
  }
  assert.ok(waveClears > 30, 'played many waves: ' + waveClears);
  assert.equal(broken, game.rewardsGranted);
  assert.equal(broken, game.save.stats.breaks);
  for (const n of bonusByWave.values()) assert.equal(n, 1);
  assert.ok(waveStarts - waveClears <= 1);
  assert.ok(maxTargets <= D.range.maxTargets + 4, 'pool bounded: ' + maxTargets);
  assert.ok(game.save.cash >= 0);
});

/* -------------------------------------------------------------------- combo */

test('combo builds, caps, drops gradually on misses and freezes between waves', () => {
  const combo = new ZTA.Combo(new ZTA.Emitter());
  for (let i = 0; i < 50; i++) combo.registerHit(false, 1);
  assert.equal(combo.mult, 2.5);
  combo.registerMiss();
  assert.equal(combo.mult.toFixed(1), '2.3');
  combo.update(10, false);
  assert.equal(combo.mult.toFixed(1), '2.3', 'frozen between waves');
  combo.update(2, true);
  assert.equal(combo.mult.toFixed(1), '2.3', 'grace period');
  combo.update(2, true);
  assert.ok(combo.mult < 2.3, 'drains after the grace period');
  const c2 = new ZTA.Combo(new ZTA.Emitter());
  c2.registerHit(true, 1);
  assert.equal(c2.mult.toFixed(1), '1.2', 'weak-point hits count double');
});

/* ------------------------------------------------------------------- waves */

test('wave patterns respect slot caps and the global target cap', () => {
  const game = newGame(55);
  game.economy.earn(1e6);
  for (let i = 0; i < 4; i++) game.progression.buyRangeUpgrade('rng.stands');
  const d = game.director;
  for (let w = 0; w < 200; w++) {
    game.targets.clear();
    d.startWave();
    assert.ok(game.targets.activeCount() <= D.range.maxTargets);
    const perRail = {};
    for (const t of game.targets.list) if (t.kind === 'runner') perRail[t.slotId] = (perRail[t.slotId] || 0) + 1;
    for (const n of Object.values(perRail)) assert.equal(n, 1);
  }
});
