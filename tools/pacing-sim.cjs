/*
 * Pacing simulator: plays the real simulation with a human-like shooter and a
 * simple shopping habit, then reports when key milestones happen. Use it to
 * sanity-check balance after changing costs or rewards. It is an estimate,
 * not a replacement for playtesting.
 *
 *   node tools/pacing-sim.cjs [runs=5] [minutes=15] [skill=average|casual|sharp]
 */
'use strict';
const { loadZTA } = require('../tests/load.cjs');

const ZTA = loadZTA();
const D = ZTA.data;
const C = ZTA.content;

const SKILLS = {
  casual: { acquire: 0.65, sigma: 0.16, lead: 0.5 },
  average: { acquire: 0.45, sigma: 0.11, lead: 0.7 },
  sharp: { acquire: 0.3, sigma: 0.07, lead: 0.9 },
};

function gauss(rng) {
  const u = Math.max(1e-9, rng.next());
  const v = rng.next();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function runOnce(seed, minutes, skill) {
  const save = ZTA.SaveSystem.createDefault(0);
  const game = new ZTA.Game({ seed, save });
  game.resize(1600, 900);
  game.begin();
  game.setLive(true);
  const rng = ZTA.createRng(seed * 31 + 7);
  const sk = SKILLS[skill];
  const ms = {};
  const mark = (k) => {
    if (ms[k] == null) ms[k] = game.time;
  };
  game.events.on('upgrade:bought', () => mark('firstUpgrade'));
  game.events.on('weapon:unlocked', (e) => mark(e.weaponId));

  let current = null;
  let acquireLeft = 0;
  let err = { x: 0, y: 0 };
  let shopT = 0;
  const dt = 1 / 60;
  const steps = Math.round((minutes * 60) / dt);
  for (let i = 0; i < steps; i++) {
    // Pick a target (nearest-first habit) and spend time acquiring it.
    if (!current || current.state !== 'active') {
      current = game.targets.list.find((t) => t.state === 'active' && t.delay <= 0 && t.appear > 0.5) || null;
      acquireLeft = sk.acquire * (0.7 + rng.next() * 0.6);
      err = { x: gauss(rng) * sk.sigma, y: gauss(rng) * sk.sigma };
      game.weapons.releaseTrigger();
    }
    if (current) {
      acquireLeft -= dt;
      let wx;
      let wy;
      if (current.kind === 'plate') {
        const c = current.plateCenter({});
        wx = c.x;
        wy = c.y;
      } else if (current.kind === 'bottle') {
        wx = current.x;
        wy = current.baseY + current.def.shape.h * 0.35;
      } else {
        const g = current.runnerGeom({});
        // Imperfect lead on moving targets.
        wx = current.x - current.dir * current.speed * 0.12 * (1 - sk.lead);
        wy = g.torsoMid;
      }
      // Re-jitter aim a little every shot interval, like a real hand.
      if (i % 12 === 0) err = { x: err.x * 0.6 + gauss(rng) * sk.sigma * 0.5, y: err.y * 0.6 + gauss(rng) * sk.sigma * 0.5 };
      const p = game.camera.project(wx + err.x, wy + err.y, current.z);
      game.setAim(p.sx, p.sy);
      if (acquireLeft <= 0 && !game.weapons.trigger) game.weapons.pressTrigger();
    }
    game.update(dt);

    // Shopping habit: every 15 s, unlock the next gun if affordable, otherwise
    // buy the cheapest upgrade that costs under a third of that gun.
    shopT += dt;
    if (shopT >= 15) {
      shopT = 0;
      const p = game.progression;
      const goal = p.nextGoal();
      if (goal && save.cash >= goal.cost) p.unlockWeapon(goal.weaponId);
      else {
        const limit = goal ? goal.cost / 3 : Infinity;
        const offers = [];
        for (const id of save.owned) {
          const def = D.weaponById[id];
          for (const t of def.upgrades) {
            const d = C.describeWeaponUpgrade(def, p.levelsFor(id), t.id);
            if (!d.maxed) offers.push({ cost: d.cost, buy: () => p.buyWeaponUpgrade(id, t.id) });
          }
        }
        for (const u of D.rangeUpgrades) {
          const d = C.describeRangeUpgrade(u, save.rangeLevels);
          if (!d.maxed) offers.push({ cost: d.cost, buy: () => p.buyRangeUpgrade(u.id) });
        }
        offers.sort((a, b) => a.cost - b.cost);
        for (const o of offers) {
          if (o.cost > limit || o.cost > save.cash) break;
          o.buy();
        }
      }
    }
  }
  return { ms, cash: save.cash, lifetime: save.lifetimeCash, acc: save.stats.hits / Math.max(1, save.stats.shots), waves: save.stats.wavesCleared };
}

const runs = Number(process.argv[2] || 5);
const minutes = Number(process.argv[3] || 15);
const skill = process.argv[4] || 'average';
const fmtT = (t) => {
  if (t == null) return '—';
  const s = Math.round(t);
  return Math.floor(s / 60) + 'm' + String(s % 60).padStart(2, '0') + 's';
};
const results = [];
for (let r = 0; r < runs; r++) results.push(runOnce(1000 + r, minutes, skill));
console.log('Pacing — ' + runs + ' runs × ' + minutes + ' min, skill: ' + skill);
console.log('run  1st upgrade  Hornet K  Brute 12  accuracy  waves  lifetime cash');
results.forEach((r, i) =>
  console.log(
    String(i + 1).padEnd(5) +
      fmtT(r.ms.firstUpgrade).padEnd(13) +
      fmtT(r.ms['gun.hornet_k']).padEnd(10) +
      fmtT(r.ms['gun.brute_12']).padEnd(10) +
      (Math.round(r.acc * 100) + '%').padEnd(10) +
      String(r.waves).padEnd(7) +
      ZTA.fmt.cash(r.lifetime)
  )
);
