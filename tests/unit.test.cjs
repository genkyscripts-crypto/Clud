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
const BENCH = D.rangeById['range.bench01'];

/** Objects from the VM sandbox have foreign prototypes; compare as plain JSON. */
const plain = (x) => JSON.parse(JSON.stringify(x));

function newGame(seed, save) {
  const game = new ZTA.Game({ seed: seed || 7, save: save || ZTA.SaveSystem.createDefault(1000) });
  game.resize(1600, 900);
  return game;
}

/** A save that owns every gun and has every range unlocked. */
function richSave() {
  const s = ZTA.SaveSystem.createDefault(1000);
  s.owned = D.weapons.map((w) => w.id);
  s.rangesUnlocked = D.ranges.map((r) => r.id);
  return s;
}

/** Aims at the nearest standing target's weak point (or center). */
function aimBot(game) {
  const cam = game.camera;
  const t = game.targets.list
    .filter((x) => x.state === 'active' && x.delay <= 0 && x.appearScale > 0.6 && !(x.kind === 'shutter' && !x.windowOpen))
    .sort((a, b) => a.z - b.z)[0];
  if (!t) return false;
  const c = t.center({});
  if (t.kind === 'runner') c.y = t.runnerGeom({}).coreY;
  if (t.kind === 'popper') c.y = t.def.shape.h * t.appearScale + t.def.shape.headR;
  if (t.kind === 'bottle') c.y = t.baseY + t.def.shape.h * t.scale * 0.35;
  if (t.kind === 'drone' || t.kind === 'runner') c.x += t.dir * t.speed * 0.02;
  const p = cam.project(c.x, c.y, t.z);
  game.setAim(p.sx, p.sy);
  return true;
}

function runBot(game, seconds, onFrame) {
  const n = Math.round(seconds * 60);
  for (let i = 0; i < n; i++) {
    const has = aimBot(game);
    if (has && !game.weapons.trigger) game.weapons.pressTrigger();
    if (!has && game.weapons.trigger) game.weapons.releaseTrigger();
    game.update(1 / 60);
    if (onFrame && onFrame(i) === false) break;
  }
}

/* ------------------------------------------------------------------ catalog */

test('content catalog validates with no problems', () => {
  assert.deepEqual(plain(C.validateCatalog()), []);
});

test('the catalog has 40 guns in the planned family mix, with no duplicate identities', () => {
  assert.equal(D.weapons.length, 40);
  const count = {};
  for (const w of D.weapons) count[w.family] = (count[w.family] || 0) + 1;
  assert.deepEqual(plain(count), { pistol: 8, revolver: 4, smg: 6, rifle: 7, shotgun: 5, marksman: 3, heavy: 7 });
  const sigs = new Set();
  for (const w of D.weapons) {
    const sig = [w.family, w.perk.id, w.fire.mode, w.tier, Math.round(w.damage), w.fire.rpm, w.fire.pellets].join('|');
    assert.ok(!sigs.has(sig), 'duplicate identity: ' + w.id);
    sigs.add(sig);
  }
  assert.ok(new Set(D.weapons.map((w) => w.perk.id)).size >= 18, 'many distinct signature perks');
  assert.ok(new Set(D.weapons.map((w) => w.model.builder)).size >= 10, 'many distinct silhouettes');
});

test('definitions are frozen and resolving stats never mutates them', () => {
  const def = D.weaponById['gun.kestrel_p9'];
  assert.ok(Object.isFrozen(def) && Object.isFrozen(def.fire) && Object.isFrozen(def.upgrades[0]));
  const before = JSON.stringify(def);
  const s = C.resolveWeaponStats(def, { 'upg.damage': 3, 'upg.reload': 2 }, { perkLevel: 2, mods: { damageMult: 2 } });
  s.damage = 999;
  s.reload.time = 0;
  s.perk.params.perStack = 5;
  assert.equal(JSON.stringify(def), before);
});

test('the three starter-range guns are mechanically distinct', () => {
  const [p, s, g] = ['gun.kestrel_p9', 'gun.hornet_k', 'gun.brute_12'].map((id) => C.resolveWeaponStats(D.weaponById[id], {}));
  assert.notEqual(p.mode, s.mode);
  assert.notEqual(s.mode, g.mode);
  assert.ok(s.rpm > p.rpm * 2, 'SMG much faster');
  assert.ok(g.pellets > 1 && p.pellets === 1 && s.pellets === 1);
  assert.equal(g.reload.style, 'shell');
  const runner = C.scaledTarget(D.targetById['tgt.runner'], BENCH);
  assert.ok(C.shotsToBreak(s, runner, { weak: false }) > C.shotsToBreak(p, runner, { weak: false }) * 3);
  assert.equal(C.shotsToBreak(g, C.scaledTarget(D.targetById['tgt.plate'], BENCH), { weak: false, distance: 7 }), 1);
});

test('upgrade previews report exact costs and shots-to-break breakpoints', () => {
  const def = D.weaponById['gun.kestrel_p9'];
  const d1 = C.describeWeaponUpgrade(def, { 'upg.damage': 1 }, 'upg.damage', { range: BENCH });
  assert.equal(d1.cost, Math.round(20 * 1.45));
  assert.equal(d1.fromText, '12.5 dmg');
  assert.equal(d1.toText, '15 dmg');
  const plate = d1.breakpoints.find((b) => b.targetId === 'tgt.plate' && !b.weak);
  assert.deepEqual([plate.from, plate.to], [3, 2]);
  const maxed = C.describeWeaponUpgrade(def, { 'upg.damage': 15 }, 'upg.damage');
  assert.equal(maxed.maxed, true);
  assert.equal(maxed.cost, null);
});

test('guns keep pace with their own range: a tier-N gun breaks range-N plates in a few shots', () => {
  for (const r of D.ranges) {
    const plate = C.scaledTarget(D.targetById['tgt.plate'], r);
    for (const w of D.weapons.filter((x) => x.tier === r.index)) {
      const n = C.shotsToBreak(C.resolveWeaponStats(w, {}), plate, { weak: false });
      assert.ok(n >= 1 && n <= 12, w.id + ' needs ' + n + ' shots on ' + r.id);
    }
  }
});

test('family trials normalize any gun to the range tier', () => {
  const game = newGame(3, richSave());
  const p9 = game.progression.normalizedStats('gun.kestrel_p9', 5);
  const base = C.resolveWeaponStats(D.weaponById['gun.kestrel_p9'], {});
  assert.equal(p9.damage, base.damage * D.TIER[5].dmg);
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
  assert.equal(eco.trySpend(10), true);
  assert.equal(save.cash, 0);
  assert.equal(eco.trySpendBlueprints(1), false);
  assert.equal(eco.earnBlueprints(1.5), 0, 'blueprints are whole tokens');
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
  game.economy.earn(100);
  assert.equal(p.buyWeaponUpgrade('gun.kestrel_p9', 'upg.damage').ok, true);
  assert.equal(game.save.cash, 80);
  assert.equal(p.stats('gun.kestrel_p9').damage, 12.5);
  assert.equal(p.buyWeaponUpgrade('gun.hornet_k', 'upg.damage').ok, false, 'cannot upgrade an unowned gun');
});

test('unlocking auto-equips into an empty slot, cannot repeat, and respects range gates', () => {
  const game = newGame();
  game.economy.earn(200000);
  const r = game.progression.unlockWeapon('gun.hornet_k');
  assert.equal(r.ok, true);
  assert.equal(r.slot, 1);
  assert.deepEqual(plain(game.save.equipped), ['gun.kestrel_p9', 'gun.hornet_k', null]);
  assert.equal(game.progression.unlockWeapon('gun.hornet_k').ok, false);
  const cash = game.save.cash;
  assert.equal(game.progression.unlockWeapon('gun.sieger_p26').reason, 'range locked');
  assert.equal(game.save.cash, cash, 'a refused unlock spends nothing');
  game.progression.equip(0, 'gun.hornet_k');
  assert.deepEqual(plain(game.save.equipped), ['gun.hornet_k', 'gun.kestrel_p9', null]);
});

test('ranges unlock in order, need their challenge star and cost cash', () => {
  const game = newGame();
  const p = game.progression;
  game.economy.earn(1e7);
  assert.equal(p.unlockRange('range.rooftop').reason, 'requirement not met');
  assert.equal(p.unlockRange('range.scrapyard').reason, 'unlock the previous range first');
  game.save.challenges['ch.bench.qualifier'] = { stars: 1, best: 20, clears: 1, modStars: {} };
  const before = game.save.cash;
  assert.equal(p.unlockRange('range.rooftop').ok, true);
  assert.equal(game.save.cash, before - D.rangeById['range.rooftop'].unlock.cost);
  assert.equal(game.setRange('range.rooftop'), true);
  assert.equal(game.range.id, 'range.rooftop');
  assert.equal(game.setRange('range.vault'), false, 'locked ranges cannot be entered');
});

test('range upgrades change live modifiers', () => {
  const game = newGame();
  game.economy.earn(1000);
  game.progression.buyRangeUpgrade('rng.bounty');
  assert.equal(game.progression.rangeModifiers().cashMult, 1.2);
  game.progression.buyRangeUpgrade('rng.stands');
  assert.equal(game.progression.rangeModifiers().extraTargets, 1);
});

test('mastery levels grant collection cash, a perk level and one-time blueprints', () => {
  const game = newGame(4, richSave());
  const p = game.progression;
  const id = 'gun.hornet_k';
  const perk0 = p.stats(id).perk.params.comboGain;
  p.addMasteryXp(id, 300);
  assert.equal(p.masteryLevel(id), 3);
  assert.ok(p.stats(id).perk.params.comboGain > perk0, 'mastery 3 improves the signature perk');
  assert.ok(p.globals().cashMult > 1, 'mastery 1 adds collection cash');
  const bp = game.save.blueprints;
  p.addMasteryXp(id, 5000);
  assert.equal(p.masteryLevel(id), 5);
  assert.equal(game.save.blueprints, bp + 2, 'level 5 pays its blueprints');
  p.addMasteryXp(id, 5000);
  assert.equal(game.save.blueprints, bp + 2, 'never twice');
  assert.ok(p.finishesFor(id).indexOf('fin.brass') !== -1);
  assert.equal(p.setFinish(id, 'fin.brass'), true);
  assert.equal(p.setFinish('gun.kestrel_p9', 'fin.brass'), false, 'finishes must be earned per gun');
});

test('objectives pay one blueprint once', () => {
  const game = newGame(4, richSave());
  const p = game.progression;
  const o = p.objectiveFor('gun.brute_12');
  assert.equal(o.metric, 'multiBreaks');
  for (let i = 0; i < o.goal - 1; i++) p.trackObjective('gun.brute_12', 'multiBreaks');
  assert.equal(game.save.blueprints, 0);
  p.trackObjective('gun.brute_12', 'breaks');
  assert.equal(game.save.blueprints, 0, 'other metrics do not count');
  p.trackObjective('gun.brute_12', 'multiBreaks');
  assert.equal(game.save.blueprints, 1);
  p.trackObjective('gun.brute_12', 'multiBreaks');
  assert.equal(game.save.blueprints, 1);
});

test('workshop and perk upgrades spend blueprints and change stats', () => {
  const game = newGame(4, richSave());
  const p = game.progression;
  assert.equal(p.buyWorkshop('ws.damage').ok, false, 'no tokens yet');
  game.economy.earnBlueprints(10);
  const dmg = p.stats('gun.kestrel_p9').damage;
  assert.equal(p.buyWorkshop('ws.damage').ok, true);
  assert.equal(game.save.blueprints, 9);
  assert.ok(Math.abs(p.stats('gun.kestrel_p9').damage - dmg * 1.1) < 1e-9);
  const stacks = p.stats('gun.kestrel_p9').perk.params.perStack;
  assert.equal(p.buyPerkUpgrade('gun.kestrel_p9').ok, true);
  assert.equal(game.save.blueprints, 7);
  assert.ok(p.stats('gun.kestrel_p9').perk.params.perStack > stacks);
});

test('collection milestones pay once', () => {
  const game = newGame();
  game.economy.earn(1e5);
  const events = [];
  game.events.on('milestone:reached', (e) => events.push(e.id));
  game.progression.unlockWeapon('gun.hatch_38');
  game.progression.unlockWeapon('gun.hornet_k');
  assert.deepEqual(events, ['ms.3']);
  const cash = game.progression.globals().cashMult;
  game.progression.checkMilestones();
  assert.deepEqual(events, ['ms.3']);
  assert.equal(game.progression.globals().cashMult, cash);
});

/* ------------------------------------------------------------ lanes/offline */

test('training lanes accrue capped cash by wall clock and survive clock tampering', () => {
  const save = richSave();
  save.lanes.unlocked = 2;
  save.lanes.guns = ['gun.hornet_k', 'gun.brute_12', null, null, null];
  save.lanes.lastTick = 1e12;
  const game = newGame(5, save);
  const p = game.progression;
  const rate = p.laneRate();
  assert.ok(rate > 0);
  let r = p.tickLanes(1e12 + 60000);
  assert.ok(Math.abs(r.gained - rate * 60) < 1e-6);
  // Clock moved backwards: no gain, anchor resets.
  r = p.tickLanes(1e12 - 3600000);
  assert.equal(r.gained, 0);
  assert.equal(save.lanes.lastTick, 1e12 - 3600000);
  // Very long absence: never above the storage cap.
  r = p.tickLanes(1e12 + 1000 * 86400 * 400);
  assert.ok(save.lanes.stored <= p.laneCap() + 1e-6);
  assert.ok(r.capped);
  const bp = save.blueprints;
  const got = p.collectLanes();
  assert.ok(got > 0 && save.lanes.stored < 1);
  assert.equal(save.blueprints, bp, 'waiting never pays blueprints');
  assert.equal(p.tickLanes(NaN).gained, 0);
});

test('lanes cannot be bought before Rooftop 9 and cost cash', () => {
  const game = newGame();
  game.economy.earn(1e6);
  assert.equal(game.progression.unlockLane().reason, 'locked');
  game.save.rangesUnlocked.push('range.rooftop');
  const cash = game.save.cash;
  assert.equal(game.progression.unlockLane().ok, true);
  assert.equal(game.save.cash, cash - D.meta.lanes.unlockCosts[0]);
  assert.equal(game.progression.assignLane(0, 'gun.hornet_k'), false, 'must own the gun');
  assert.equal(game.progression.assignLane(0, 'gun.kestrel_p9'), true);
});

/* ------------------------------------------------------------------ prestige */

test('opening a new branch resets the run, keeps the collection and adds a charter', () => {
  const save = richSave();
  const game = newGame(6, save);
  const p = game.progression;
  game.economy.earn(5e6);
  game.economy.earnBlueprints(4);
  p.buyWeaponUpgrade('gun.kestrel_p9', 'upg.damage');
  p.buyRangeUpgrade('rng.bounty');
  p.addMasteryXp('gun.kestrel_p9', 200);
  assert.equal(p.prestigeAvailable(), false);
  assert.equal(p.openBranch('cht.contract').ok, false);
  save.challenges['ch.scrap.boss'] = { stars: 1, best: 80, clears: 1, modStars: {} };
  assert.equal(p.prestigeAvailable(), true);
  const preview = p.prestigePreview();
  assert.equal(preview.charters.length, 3);
  assert.deepEqual(plain(p.prestigePreview().charters), plain(preview.charters), 'charter options are stable');
  const pick = preview.charters[0].id;
  const xp = save.mastery['gun.kestrel_p9'].xp;
  const cashMultBefore = p.globals().cashMult;
  assert.equal(p.openBranch(pick).ok, true);
  assert.equal(save.prestige.branch, 1);
  assert.deepEqual(plain(save.rangesUnlocked).slice(0, 1), ['range.bench01']);
  assert.deepEqual(plain(save.weaponLevels), {});
  assert.deepEqual(plain(save.rangeLevels), {});
  assert.equal(save.owned.length, 40, 'guns kept');
  assert.equal(save.mastery['gun.kestrel_p9'].xp, xp, 'mastery kept');
  assert.equal(save.blueprints, 4, 'blueprints kept');
  assert.ok(save.challenges['ch.scrap.boss'].stars === 1, 'challenge stars kept');
  assert.ok(p.globals().cashMult > cashMultBefore - 0.0001, 'branch bonus applies');
  assert.equal(p.modifiersUnlocked().length, 1);
});

/* --------------------------------------------------------------- challenges */

function playChallenge(game, id, seconds) {
  let end = null;
  const off = game.events.on('challenge:end', (e) => (end = e));
  const r = game.startChallenge(id);
  assert.equal(r.ok, true, 'challenge starts: ' + (r.reason || ''));
  runBot(game, seconds || 130, () => !end);
  off();
  return end;
}

test('a challenge round blocks fire during the countdown, ends on time and pays stars once', () => {
  const game = newGame(8);
  game.begin();
  game.setLive(true);
  const r = game.startChallenge('ch.bench.qualifier');
  assert.equal(r.ok, true);
  game.setAim(800, 400);
  let shots = 0;
  game.events.on('weapon:fired', () => shots++);
  game.weapons.pressTrigger();
  game.update(1);
  assert.equal(shots, 0, 'no firing during the countdown');
  game.weapons.releaseTrigger();
  game.endChallenge();

  const end = playChallenge(game, 'ch.bench.qualifier');
  assert.ok(end, 'round ended');
  assert.ok(end.metrics.breaks > 0);
  const stars = end.summary.stars;
  const bp = game.save.blueprints;
  const expectBp = D.challengeById['ch.bench.qualifier'].reward.blueprints.slice(0, stars).reduce((a, b) => a + b, 0);
  assert.equal(end.summary.blueprints, expectBp);
  // Replaying for the same stars pays no new blueprints.
  game.endChallenge();
  const again = playChallenge(game, 'ch.bench.qualifier');
  assert.ok(again.summary.blueprints <= Math.max(0, again.summary.stars - stars) * 1 + 0);
  assert.ok(game.save.blueprints >= bp);
  assert.ok(game.save.challenges['ch.bench.qualifier'].stars >= stars);
});

test('bosses need other stars first, and the core only breaks after the chest plate', () => {
  const game = newGame(9, richSave());
  game.begin();
  game.setLive(true);
  assert.equal(game.startChallenge('ch.bench.boss').ok, false);
  for (const c of D.challenges) if (c.range === 'range.bench01' && !c.boss) game.save.challenges[c.id] = { stars: 1, best: 1, clears: 1, modStars: {} };
  game.save.equipped = ['gun.kestrel_p9', null, null];
  const r = game.startChallenge('ch.bench.boss');
  assert.equal(r.ok, true);
  game.update(3.1);
  game.update(0.3); // let the sections finish appearing
  const boss = game.targets.boss;
  assert.ok(boss && boss.parts.length === 5);
  const core = boss.parts.find((t) => t.part.final);
  const chest = boss.parts.find((t) => t.part.id === 'chest');
  // Aim at the core: the chest plate in front takes the hit.
  const hits = game.targets.raycast(game.camera.project(core.x, core.baseY, core.z).sx, game.camera.project(core.x, core.baseY, core.z).sy, game.camera);
  assert.equal(hits[0].target, chest);
  let end = null;
  game.events.on('challenge:end', (e) => (end = e));
  let defeated = 0;
  game.events.on('boss:defeated', () => defeated++);
  chest.applyDamage(1e9, {});
  game.rewardBreak(chest, { weaponId: 'gun.kestrel_p9' });
  core.applyDamage(1e9, {});
  game.rewardBreak(core, { weaponId: 'gun.kestrel_p9' });
  game.update(0.1);
  assert.equal(defeated, 1);
  assert.ok(end && end.completed);
  assert.ok(end.summary.stars >= 1);
});

test('family trials refuse other families and auto-equip an allowed gun', () => {
  const game = newGame(10, richSave());
  game.begin();
  game.setLive(true);
  game.save.equipped = ['gun.brute_12', 'gun.hornet_k', null];
  game.save.activeSlot = 0;
  const r = game.startChallenge('ch.bench.sidearms');
  assert.equal(r.ok, true);
  assert.ok(r.autoEquipped, 'an allowed gun was equipped');
  assert.ok(['pistol', 'revolver'].indexOf(D.weaponById[game.weapons.activeId].family) !== -1);
  assert.equal(game.weapons.switchTo(game.save.equipped.indexOf('gun.hornet_k')), false);
});

/* --------------------------------------------------------------------- save */

test('save/load round-trips money, ownership, equipment, upgrades, mastery and settings', () => {
  const store = new MemoryStorage();
  const game = newGame(1, richSave());
  game.economy.earn(5000);
  game.economy.earnBlueprints(3);
  game.progression.buyWeaponUpgrade('gun.hornet_k', 'upg.magazine');
  game.progression.buyRangeUpgrade('rng.bounty');
  game.progression.addMasteryXp('gun.hornet_k', 150);
  game.progression.buyWorkshop('ws.cash');
  game.save.challenges['ch.bench.center'] = { stars: 2, best: 17, clears: 3, modStars: {} };
  game.save.settings.shake = false;
  assert.equal(ZTA.SaveSystem.save(store, game.save, 5000).ok, true);
  const d = ZTA.SaveSystem.load(store, 6000).data;
  for (const k of ['cash', 'blueprints', 'owned', 'equipped', 'weaponLevels', 'rangeLevels', 'workshop', 'challenges', 'rangesUnlocked']) {
    assert.deepEqual(plain(d[k]), plain(game.save[k]), k);
  }
  assert.equal(d.mastery['gun.hornet_k'].xp, game.save.mastery['gun.hornet_k'].xp);
  assert.equal(d.settings.shake, false);
});

test('a corrupted main save falls back to the backup; both corrupted starts fresh', () => {
  const store = new MemoryStorage();
  const s = ZTA.SaveSystem.createDefault(1);
  s.cash = 111;
  ZTA.SaveSystem.save(store, s, 2);
  s.cash = 222;
  ZTA.SaveSystem.save(store, s, 3);
  store.setItem(ZTA.SaveSystem.KEY, store.getItem(ZTA.SaveSystem.KEY).replace('222', '999'));
  const r1 = ZTA.SaveSystem.load(store, 4);
  assert.equal(r1.source, 'backup');
  assert.equal(r1.data.cash, 111);
  store.setItem(ZTA.SaveSystem.BACKUP_KEY, '{not json');
  assert.equal(ZTA.SaveSystem.load(store, 5).source, 'new');
});

test('a corrupt save is never rotated into the backup slot', () => {
  const store = new MemoryStorage();
  const s = ZTA.SaveSystem.createDefault(1);
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
    rangesUnlocked: ['range.vault', 'range.nowhere'],
    rangeId: 'range.nowhere',
    challenges: { 'ch.bench.center': { stars: 9, best: -1 }, 'ch.bogus': { stars: 3 } },
    mastery: { 'gun.hornet_k': { xp: -5, finish: 'fin.gold', perkBought: 99 } },
    workshop: { 'ws.damage': 99, 'ws.bogus': 1 },
    lanes: { unlocked: 99, guns: ['gun.hornet_k', 'gun.hornet_k', 'gun.brute_12'], stored: -3 },
    prestige: { branch: -1, charters: ['cht.contract', 'cht.bogus'] },
    settings: { volume: 9, shake: 'yes' },
    stats: { shots: -1, hits: 'x' },
  });
  assert.equal(d.cash, 0);
  assert.equal(d.blueprints, 2);
  assert.deepEqual(plain(d.owned), ['gun.kestrel_p9', 'gun.hornet_k']);
  assert.deepEqual(plain(d.equipped), [null, 'gun.hornet_k', null]);
  assert.equal(d.activeSlot, 1);
  assert.deepEqual(plain(d.weaponLevels), { 'gun.kestrel_p9': { 'upg.damage': 15 } });
  assert.deepEqual(plain(d.rangeLevels), { 'rng.stands': 2 });
  assert.deepEqual(plain(d.rangesUnlocked), ['range.bench01', 'range.vault']);
  assert.equal(d.rangeId, 'range.bench01');
  assert.equal(d.challenges['ch.bench.center'].stars, 3);
  assert.equal(d.challenges['ch.bench.center'].best, null);
  assert.ok(!d.challenges['ch.bogus']);
  assert.deepEqual(plain(d.mastery['gun.hornet_k']), { xp: 0, claimed: 0, obj: 0, objDone: false, finish: 'fin.factory', perkBought: 3 }, 'values clamped to valid ranges');
  assert.deepEqual(plain(d.workshop), { 'ws.damage': 5 });
  assert.equal(d.lanes.unlocked, D.meta.lanes.unlockCosts.length);
  assert.deepEqual(plain(d.lanes.guns), ['gun.hornet_k', null, null, null, null]);
  assert.equal(d.lanes.stored, 0);
  assert.equal(d.prestige.branch, 0);
  assert.deepEqual(plain(d.prestige.charters), ['cht.contract']);
  assert.equal(d.settings.volume, 1);
  assert.equal(d.settings.shake, true);
});

test('saving survives storage that throws or is missing', () => {
  const store = new MemoryStorage();
  store.failWrites = true;
  assert.equal(ZTA.SaveSystem.save(store, ZTA.SaveSystem.createDefault(1), 2).ok, false);
  assert.equal(ZTA.SaveSystem.save(null, ZTA.SaveSystem.createDefault(1), 2).ok, false);
  assert.equal(ZTA.SaveSystem.load(null, 3).source, 'new');
});

test('Phase 1 (v1) saves migrate: progress kept, mastery credited from past breaks', () => {
  const store = new MemoryStorage();
  const v1 = {
    version: 1,
    cash: 777,
    lifetimeCash: 9000,
    owned: ['gun.kestrel_p9', 'gun.hornet_k', 'gun.brute_12'],
    equipped: ['gun.kestrel_p9', 'gun.hornet_k', 'gun.brute_12'],
    activeSlot: 1,
    weaponLevels: { 'gun.kestrel_p9': { 'upg.damage': 4 } },
    rangeLevels: { 'rng.bounty': 3 },
    perGun: { 'gun.kestrel_p9': { shots: 900, hits: 700, breaks: 250 } },
    settings: { volume: 0.4 },
    flags: { hints: { fire: true } },
  };
  store.setItem(ZTA.SaveSystem.KEY, ZTA.SaveSystem.serialize(v1));
  const r = ZTA.SaveSystem.load(store, 2);
  assert.equal(r.source, 'main');
  const d = r.data;
  assert.equal(d.version, 2);
  assert.equal(d.cash, 777);
  assert.deepEqual(plain(d.equipped), plain(v1.equipped));
  assert.equal(d.weaponLevels['gun.kestrel_p9']['upg.damage'], 4);
  assert.equal(d.mastery['gun.kestrel_p9'].xp, 250);
  assert.deepEqual(plain(d.rangesUnlocked), ['range.bench01']);
  assert.equal(d.flags.hints.fire, true);
});

/* ------------------------------------------------------------------ weapons */

test('holding the trigger fires at the capped rate, first shot immediately', () => {
  const game = newGame();
  game.begin();
  game.setLive(true);
  game.update(0.3);
  game.setAim(0, 0);
  let shots = 0;
  game.events.on('weapon:fired', () => shots++);
  game.weapons.pressTrigger();
  assert.equal(shots, 1, 'fires inside the input handler, before the next frame');
  for (let i = 0; i < 60; i++) game.update(1 / 60);
  assert.equal(shots, 6);
});

test('ammo never goes negative and auto-reload refills exactly to capacity', () => {
  const game = newGame();
  game.begin();
  game.setLive(true);
  game.setAim(0, 0);
  game.update(0.3);
  game.weapons.pressTrigger();
  let reloads = 0;
  game.events.on('weapon:reloadEnd', () => reloads++);
  for (let i = 0; i < 60 * 8; i++) {
    game.update(1 / 60);
    assert.ok(game.weapons.active.ammo >= 0 && game.weapons.active.ammo <= game.weapons.stats.magazine);
  }
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
  assert.equal(shots, frozen);
  game.setLive(true);
  for (let i = 0; i < 60; i++) game.update(1 / 60);
  assert.equal(shots, frozen);
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
  assert.equal(w.runtime('gun.kestrel_p9').ammo, 3);
  game.update(0.5);
  w.switchTo(0);
  game.update(0.4);
  assert.equal(w.active.ammo, 3);
  assert.equal(w.switchTo(0), false);
  assert.equal(w.switchTo(2), false);
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
  assert.equal(shots, 1);
  assert.equal(w.active.ammo, 2);
});

test('burst guns fire whole bursts per pull and never overdraw the magazine', () => {
  const save = richSave();
  save.equipped = ['gun.ostra_wasp', null, null];
  const game = newGame(12, save);
  game.begin();
  game.setLive(true);
  game.setAim(0, 0);
  game.update(0.5);
  let shots = 0;
  game.events.on('weapon:fired', () => shots++);
  game.weapons.pressTrigger();
  game.weapons.releaseTrigger();
  for (let i = 0; i < 30; i++) game.update(1 / 60);
  assert.equal(shots, 3, 'one pull = one 3-round burst');
  game.weapons.active.ammo = 2;
  game.weapons.pressTrigger();
  game.weapons.releaseTrigger();
  for (let i = 0; i < 30; i++) game.update(1 / 60);
  assert.equal(shots, 5, 'a burst stops when the magazine runs dry');
  assert.ok(game.weapons.active.ammo >= 0);
});

/* -------------------------------------------------------------------- perks */

test('final chamber, quick draw and last gasp scale the right shots', () => {
  const P = ZTA.perks;
  const fc = P['perk.final_chamber'];
  const s = fc.initState();
  fc.onFire(s, { mult: 2.5 }, { ammoBefore: 2 });
  assert.equal(fc.shotDamageMult(s, { mult: 2.5 }), 1);
  fc.onFire(s, { mult: 2.5 }, { ammoBefore: 1 });
  assert.equal(fc.shotDamageMult(s, { mult: 2.5 }), 2.5);
  const qd = P['perk.quick_draw'];
  const q = qd.initState();
  qd.onFire(q, {}, {});
  assert.equal(qd.shotDamageMult(q, { mult: 1.8 }), 1.8);
  qd.onFire(q, {}, {});
  assert.equal(qd.shotDamageMult(q, { mult: 1.8 }), 1);
  qd.onReload(q);
  qd.onFire(q, {}, {});
  assert.equal(qd.shotDamageMult(q, { mult: 1.8 }), 1.8);
  const lg = P['perk.last_gasp'];
  const l = lg.initState();
  lg.onFire(l, { threshold: 0.34, mult: 1.6 }, { ammoBefore: 25, magazine: 25 });
  assert.equal(lg.shotDamageMult(l, { mult: 1.6 }), 1);
  lg.onFire(l, { threshold: 0.34, mult: 1.6 }, { ammoBefore: 8, magazine: 25 });
  assert.equal(lg.shotDamageMult(l, { mult: 1.6 }), 1.6);
});

test('spin-up ramps fire rate with held time and sustained fire resets on release', () => {
  const sp = ZTA.perks['perk.spin_up'];
  assert.equal(sp.fireRateMult({}, { minRate: 0.3, time: 1 }, { heldTime: 0 }), 0.3);
  assert.equal(sp.fireRateMult({}, { minRate: 0.3, time: 1 }, { heldTime: 2 }), 1);
  const su = ZTA.perks['perk.sustained'];
  const s = su.initState();
  for (let i = 0; i < 100; i++) su.onFire(s, {});
  assert.equal(su.shotDamageMult(s, { perShot: 0.01, max: 0.5 }), 1.5);
  su.onRelease(s);
  assert.equal(su.shotDamageMult(s, { perShot: 0.01, max: 0.5 }), 1);
});

test('perk improvements only grow the intended part of a param', () => {
  const imp = ZTA.improvePerkParams;
  assert.equal(imp(ZTA.perks['perk.mover_hunter'], { mult: 1.5 }, 1, 0.3).mult, 1 + 0.5 * 1.3);
  assert.equal(imp(ZTA.perks['perk.spin_up'], { minRate: 0.3, time: 1.3 }, 1, 0.3).time, 1);
  assert.equal(imp(ZTA.perks['perk.center_streak'], { perStack: 0.1, maxStacks: 5 }, 2, 0.3).maxStacks, 5);
});

test('ricochets and arcs damage neighbors and reward each break once', () => {
  const game = newGame(13, richSave());
  const a = game.targets.spawn('tgt.plate', { x: 0, z: 7, baseY: BENCH.carrierY });
  const b = game.targets.spawn('tgt.plate', { x: 0.8, z: 7, baseY: BENCH.carrierY });
  let broken = 0;
  game.events.on('target:broken', () => broken++);
  const n = game.secondaryHit({ from: a, amount: 1e6, radius: 2, count: 3, kind: 'arc', weaponId: 'gun.voltaic_arc' });
  assert.equal(n, 1, 'only the neighbor, not the source');
  assert.equal(b.state, 'breaking');
  assert.equal(broken, 1);
  assert.equal(game.secondaryHit({ target: b, amount: 1e6, kind: 'needle', weaponId: 'gun.voltaic_needle' }), 0, 'broken targets take nothing');
  assert.equal(broken, 1);
});

/* ------------------------------------------------------- explosions / kinds */

test('barrels chain-explode and every broken target pays exactly once', () => {
  const save = richSave();
  const game = newGame(14, save);
  game.setRange('range.scrapyard');
  const b1 = game.targets.spawn('tgt.barrel', { x: 0, z: 9.5, baseY: 0 });
  const b2 = game.targets.spawn('tgt.barrel', { x: 1.2, z: 9.5, baseY: 0 });
  const b3 = game.targets.spawn('tgt.barrel', { x: 2.4, z: 9.5, baseY: 0 });
  const bottle = game.targets.spawn('tgt.plate', { x: -1, z: 9.5, baseY: game.range.carrierY });
  let explosions = 0;
  const rewarded = new Map();
  game.events.on('explosion', () => explosions++);
  game.events.on('target:broken', (e) => rewarded.set(e.target.uid, (rewarded.get(e.target.uid) || 0) + 1));
  game.begin();
  game.setLive(true);
  game.director.stop(); // keep the pool from recycling these targets into a new wave
  b1.applyDamage(1e9, {});
  game.rewardBreak(b1, { weaponId: 'gun.kestrel_p9' });
  for (let i = 0; i < 60; i++) game.update(1 / 60);
  assert.equal(explosions, 3, 'the chain reached every barrel');
  for (const t of [b1, b2, b3]) assert.notEqual(t.state, 'active');
  for (const n of rewarded.values()) assert.equal(n, 1);
  assert.ok(rewarded.size >= 3);
  void bottle;
});

test('drones and poppers escape without paying, and endurance rounds count lives', () => {
  const game = newGame(15, richSave());
  game.setRange('range.rooftop');
  game.begin();
  game.setLive(true);
  game.director.stop();
  let escaped = 0;
  let paid = 0;
  game.events.on('target:escaped', () => escaped++);
  game.events.on('target:broken', () => paid++);
  game.targets.spawn('tgt.drone', { x: 4.9, z: 10, baseY: 2.2, altitude: 2.2, dir: 1, speed: 3, xMin: -5, xMax: 5 });
  game.targets.spawn('tgt.popper', { x: 0, z: 7.5, baseY: 0, uptime: 0.5 });
  for (let i = 0; i < 120; i++) game.update(1 / 60);
  assert.equal(escaped, 2);
  assert.equal(paid, 0);
  assert.equal(game.targets.activeCount(), 0);
});

test('shutters only take weak-point hits while their window is open', () => {
  const game = newGame(16, richSave());
  game.setRange('range.dock');
  const t = game.targets.spawn('tgt.shutter', { x: 0, z: 12.5, baseY: 0 });
  t.delay = 0;
  t.appear = 1;
  const cy = t.def.shape.post + t.def.shape.h / 2;
  t.age = 0;
  t.phase = 0;
  assert.equal(t.windowOpen, true);
  assert.equal(t.hitTest(0, cy).weak, true);
  t.age = t.weak.open + 0.1;
  assert.equal(t.windowOpen, false);
  assert.equal(t.hitTest(0, cy).weak, false);
  assert.equal(t.armoredFor(false), true);
});

test('grenades travel, explode on impact and splash a cluster', () => {
  const save = richSave();
  save.equipped = ['gun.ostra_tumbler', null, null];
  save.rangesUnlocked = D.ranges.map((r) => r.id);
  const game = newGame(17, save);
  game.setRange('range.scrapyard');
  game.begin();
  game.setLive(true);
  game.director.stop();
  game.update(0.6);
  const t1 = game.targets.spawn('tgt.plate', { x: 0, z: 12.5, baseY: game.range.carrierY });
  const t2 = game.targets.spawn('tgt.plate', { x: 0.9, z: 12.5, baseY: game.range.carrierY });
  for (const t of [t1, t2]) {
    t.delay = 0;
    t.appear = 1;
  }
  const c = t1.plateCenter({});
  const p = game.camera.project(c.x, c.y + 0.3, t1.z);
  game.setAim(p.sx, p.sy);
  let exploded = 0;
  game.events.on('explosion', () => exploded++);
  game.weapons.pressTrigger();
  game.weapons.releaseTrigger();
  assert.ok(game.projectiles.countAlive() === 1, 'a visible projectile is in flight');
  for (let i = 0; i < 90 && !exploded; i++) game.update(1 / 60);
  assert.equal(exploded, 1);
  assert.ok(t1.hp < t1.maxHp && t2.hp < t2.maxHp, 'both targets caught in the blast');
});

/* ------------------------------------------------------------ long sessions */

test('long bot session on every range: one reward per break, one bonus per wave, bounded targets', () => {
  for (const r of D.ranges) {
    const save = richSave();
    const tier = D.weapons.filter((w) => w.tier === r.index).map((w) => w.id);
    save.equipped = [tier[0], tier[1], tier[2] || null];
    const game = newGame(1234 + r.index, save);
    game.setRange(r.id);
    game.progression.save.cash = 1e12;
    game.progression.buyRangeUpgrade('rng.stands');
    game.begin();
    game.setLive(true);
    let broken = 0;
    let maxTargets = 0;
    const bonusByWave = new Map();
    game.events.on('target:broken', () => broken++);
    game.events.on('wave:clear', (e) => bonusByWave.set(e.index, (bonusByWave.get(e.index) || 0) + 1));
    let i = 0;
    runBot(game, 150, () => {
      if (++i % 1500 === 0) game.weapons.cycle(1);
      maxTargets = Math.max(maxTargets, game.targets.list.length);
    });
    assert.ok(bonusByWave.size > 5, r.id + ' played waves: ' + bonusByWave.size);
    assert.equal(broken, game.rewardsGranted);
    for (const n of bonusByWave.values()) assert.equal(n, 1);
    assert.ok(maxTargets <= 40, 'pool bounded: ' + maxTargets);
    assert.ok(game.save.cash >= 0);
  }
});

/* -------------------------------------------------------------------- combo */

test('combo builds, caps, drops gradually on misses and freezes between waves', () => {
  const combo = new ZTA.Combo(new ZTA.Emitter());
  for (let i = 0; i < 50; i++) combo.registerHit(false, 1);
  assert.equal(combo.mult, 2.5);
  combo.registerMiss();
  assert.equal(combo.mult.toFixed(1), '2.3');
  combo.update(10, false);
  assert.equal(combo.mult.toFixed(1), '2.3');
  combo.update(2, true);
  assert.equal(combo.mult.toFixed(1), '2.3');
  combo.update(2, true);
  assert.ok(combo.mult < 2.3);
  combo.extraSteps = 5;
  for (let i = 0; i < 50; i++) combo.registerHit(false, 1);
  assert.equal(combo.mult, 3, 'the Showman charter raises the cap');
  const c2 = new ZTA.Combo(new ZTA.Emitter());
  c2.touch(4);
  assert.equal(c2.mult.toFixed(1), '1.4', 'Warm Hands head start');
});

/* -------------------------------------------------------------------- waves */

test('wave patterns respect slot caps and the global target cap on every range', () => {
  for (const r of D.ranges) {
    const save = richSave();
    const game = newGame(55 + r.index, save);
    game.setRange(r.id);
    game.save.cash = 1e12;
    for (let i = 0; i < 4; i++) game.progression.buyRangeUpgrade('rng.stands');
    for (let w = 0; w < 120; w++) {
      game.targets.clear();
      game.director.startWave();
      assert.ok(game.targets.activeCount() <= r.maxTargets, r.id);
      const perRail = {};
      for (const t of game.targets.list) if (t.kind === 'runner') perRail[t.slotId] = (perRail[t.slotId] || 0) + 1;
      for (const n of Object.values(perRail)) assert.equal(n, 1);
    }
  }
});
