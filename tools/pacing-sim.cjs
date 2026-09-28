/*
 * Pacing simulator: plays the real simulation with a human-like shooter, a
 * simple shopping habit and a challenge habit, then reports when key
 * milestones happen. Use it to sanity-check balance after changing costs,
 * rewards or star thresholds. It is an estimate, not a replacement for
 * playtesting.
 *
 *   node tools/pacing-sim.cjs [runs=3] [minutes=60] [skill=average|casual|sharp]
 */
'use strict';
const { loadZTA } = require('../tests/load.cjs');

const ZTA = loadZTA();
const D = ZTA.data;
const C = ZTA.content;

const SKILLS = {
  casual: { acquire: 0.7, sigma: 0.15, lead: 0.5, correct: 0.35 },
  average: { acquire: 0.5, sigma: 0.11, lead: 0.7, correct: 0.45 },
  sharp: { acquire: 0.32, sigma: 0.065, lead: 0.9, correct: 0.6 },
};

function gauss(rng) {
  const u = Math.max(1e-9, rng.next());
  const v = rng.next();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** Which target a player would shoot next. Bosses: armor first, the core last. */
function pickTarget(game) {
  const boss = game.targets.boss;
  if (boss && !boss.defeated) {
    const parts = boss.parts.filter((t) => t.hittable);
    const order = (t) => (t.part.final ? 3 : t.def.id === 'tgt.boss.sensor' ? (t.windowOpen ? 0 : 2) : 1);
    parts.sort((a, b) => order(a) - order(b));
    if (parts.length) return parts[0];
  }
  let best = null;
  let bestScore = Infinity;
  for (const t of game.targets.list) {
    if (!t.hittable || t.appear < 0.5 || t.part) continue;
    // Drones and poppers first (they leave), then nearest.
    const urgency = t.kind === 'drone' || t.kind === 'popper' ? -20 : t.kind === 'barrel' ? -5 : 0;
    const score = t.z + urgency;
    if (score < bestScore) {
      best = t;
      bestScore = score;
    }
  }
  return best;
}

/** World point the player aims at: the weak point where there is one. */
function aimPoint(t, sk) {
  const c = t.center({});
  if (t.kind === 'runner') {
    const g = t.runnerGeom({});
    c.y = g.coreY;
    c.x = t.x - t.dir * t.speed * 0.12 * (1 - sk.lead);
  } else if (t.kind === 'drone') {
    c.x = t.x - t.dir * t.speed * 0.1 * (1 - sk.lead);
  } else if (t.kind === 'popper') {
    const sh = t.def.shape;
    c.y = sh.h * t.appearScale + sh.headR;
  }
  return c;
}

function bestLoadout(p, save) {
  const ranked = save.owned.slice().sort((a, b) => C.dps(p.stats(b)) - C.dps(p.stats(a)));
  ranked.slice(0, 3).forEach((id, i) => p.equip(i, id));
}

function runOnce(seed, minutes, skill) {
  const save = ZTA.SaveSystem.createDefault(0);
  const game = new ZTA.Game({ seed, save });
  game.resize(1600, 900);
  game.begin();
  game.setLive(true);
  const p = game.progression;
  const rng = ZTA.createRng(seed * 31 + 7);
  const sk = SKILLS[skill];
  const ms = {};
  const mark = (k) => {
    if (ms[k] == null) ms[k] = game.time;
  };
  game.events.on('upgrade:bought', () => mark('firstUpgrade'));
  game.events.on('weapon:unlocked', () => {
    const n = save.owned.length;
    mark('gun' + n);
    bestLoadout(p, save);
  });
  game.events.on('range:unlocked', (e) => mark(e.rangeId));
  game.events.on('boss:defeated', () => mark('boss' + save.stats.bossKills));
  game.events.on('challenge:recorded', (e) => {
    if (e.stars > 0) mark('firstStar');
    if (process.env.DEBUG) console.log('  ' + (game.time / 60).toFixed(1) + 'm ' + e.challengeId + ' value=' + e.value + ' stars=' + e.stars + ' cash=' + Math.round(save.cash));
  });

  let current = null;
  let acquireLeft = 0;
  let err = { x: 0, y: 0 };
  let shopT = 0;
  let practiceT = 0;
  const cooldown = {};
  const dt = 1 / 60;
  const steps = Math.round((minutes * 60) / dt);
  for (let i = 0; i < steps; i++) {
    if (!current || !current.hittable || (current.boss && i % 30 === 0)) {
      current = pickTarget(game);
      acquireLeft = sk.acquire * (0.7 + rng.next() * 0.6);
      err = { x: gauss(rng) * sk.sigma, y: gauss(rng) * sk.sigma };
      game.weapons.releaseTrigger();
    }
    if (current) {
      acquireLeft -= dt;
      const a = aimPoint(current, sk);
      // A real hand drifts, then corrects toward the target between shots.
      if (i % 10 === 0) err = { x: err.x * (1 - sk.correct) + gauss(rng) * sk.sigma * 0.5, y: err.y * (1 - sk.correct) + gauss(rng) * sk.sigma * 0.5 };
      const pt = game.camera.project(a.x + err.x, a.y + err.y, current.z);
      game.setAim(pt.sx, pt.sy);
      if (acquireLeft <= 0 && !game.weapons.trigger && game.canFire()) game.weapons.pressTrigger();
    }
    game.update(dt);

    if (game.run) {
      if (game.run.state === 'done') {
        game.endChallenge();
        current = null;
      }
      continue;
    }
    practiceT += dt;

    // Shopping habit, every 15 s.
    shopT += dt;
    if (shopT >= 15) {
      shopT = 0;
      const next = p.nextRange();
      if (next) {
        const st = p.rangeStatus(next.id);
        if (st.previousUnlocked && st.requirementMet && st.affordable) {
          p.unlockRange(next.id);
          game.setRange(next.id);
          current = null;
        }
      }
      const goal = p.nextGoal();
      if (goal && goal.kind === 'gun' && save.cash >= goal.cost) p.unlockWeapon(goal.id);
      else {
        const limit = goal ? goal.cost / 3 : Infinity;
        const offers = [];
        for (const id of save.equipped.filter(Boolean)) {
          for (const t of D.weaponById[id].upgrades) {
            const d = p.describeUpgrade(id, t.id, game.range);
            if (d && !d.maxed) offers.push({ cost: d.cost, buy: () => p.buyWeaponUpgrade(id, t.id) });
          }
        }
        for (const u of D.rangeUpgrades) {
          const d = C.describeRangeUpgrade(u, save.rangeLevels, game.range);
          if (!d.maxed) offers.push({ cost: d.cost, buy: () => p.buyRangeUpgrade(u.id) });
        }
        offers.sort((a, b) => a.cost - b.cost);
        for (const o of offers) {
          if (o.cost > limit || o.cost > save.cash) break;
          o.buy();
        }
      }
      // Workshop: spend tokens on damage and cash first.
      for (const id of ['ws.damage', 'ws.cash', 'ws.reload', 'ws.combo']) if (p.buyWorkshop(id).ok) break;
    }

    // Challenge habit: after a couple of minutes of practice, try an unstarred
    // challenge on the highest open range (not the same one twice in a row).
    if (practiceT > 120) {
      const open = D.challenges.filter((c) => p.challengeStatus(c.id).ok && p.challengeStars(c.id) < 1 && !(cooldown[c.id] > game.time));
      open.sort((a, b) => D.rangeById[b.range].index - D.rangeById[a.range].index || (a.boss ? 1 : 0) - (b.boss ? 1 : 0));
      const c = open[0];
      if (c) {
        cooldown[c.id] = game.time + 300;
        game.startChallenge(c.id);
        current = null;
      }
      practiceT = 0;
    }
  }
  return {
    ms,
    cash: save.cash,
    lifetime: save.lifetimeCash,
    acc: save.stats.hits / Math.max(1, save.stats.shots),
    guns: save.owned.length,
    stars: p.totalStars(),
    tokens: save.lifetimeBlueprints,
    range: p.highestRange().name,
  };
}

const runs = Number(process.argv[2] || 3);
const minutes = Number(process.argv[3] || 60);
const skill = process.argv[4] || 'average';
const fmtT = (t) => {
  if (t == null) return '—';
  const s = Math.round(t);
  return Math.floor(s / 60) + 'm' + String(s % 60).padStart(2, '0') + 's';
};
const results = [];
for (let r = 0; r < runs; r++) results.push(runOnce(1000 + r, minutes, skill));
console.log('Pacing — ' + runs + ' runs × ' + minutes + ' min, skill: ' + skill);
const cols = [
  ['1st upg', (r) => fmtT(r.ms.firstUpgrade)],
  ['gun 2', (r) => fmtT(r.ms.gun2)],
  ['gun 5', (r) => fmtT(r.ms.gun5)],
  ['1st star', (r) => fmtT(r.ms.firstStar)],
  ['Rooftop', (r) => fmtT(r.ms['range.rooftop'])],
  ['1st boss', (r) => fmtT(r.ms.boss1)],
  ['Scrap', (r) => fmtT(r.ms['range.scrapyard'])],
  ['Dock', (r) => fmtT(r.ms['range.dock'])],
  ['acc', (r) => Math.round(r.acc * 100) + '%'],
  ['guns', (r) => String(r.guns)],
  ['stars', (r) => String(r.stars)],
  ['tokens', (r) => String(r.tokens)],
  ['lifetime', (r) => ZTA.fmt.cash(r.lifetime)],
];
console.log('run  ' + cols.map(([h]) => h.padEnd(9)).join(''));
results.forEach((r, i) => console.log(String(i + 1).padEnd(5) + cols.map(([, f]) => f(r).padEnd(9)).join('')));
