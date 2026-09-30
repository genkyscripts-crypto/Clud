/*
 * Pacing and balance estimate with the simulated player in tests/bot.cjs.
 *
 *   node tools/pacing.cjs [runs=6] [profile=all]
 *
 * Profiles differ in dodging skill and aim wobble. The bot never uses dash
 * well, never grazes on purpose and never rearranges its build, so treat
 * the numbers as a rough floor for a real player's power and a rough
 * ceiling for their consistency.
 */
'use strict';
const path = require('path');
const { loadHE, MemoryStorage } = require(path.join(__dirname, '..', 'tests', 'load.cjs'));
const { playRun, seedBot } = require(path.join(__dirname, '..', 'tests', 'bot.cjs'));

const PROFILES = {
  casual: { skill: 0.35, aimError: 0.22 },
  average: { skill: 0.6, aimError: 0.12 },
  sharp: { skill: 0.9, aimError: 0.04 },
};

const runs = parseInt(process.argv[2] || '6', 10);
const which = process.argv[3] || 'all';
const HE = loadHE();

function one(seed, prof, pressOn) {
  let now = 1.7e12;
  const storage = new MemoryStorage();
  const ss = new HE.SaveSystem(storage, () => now);
  const save = ss.load();
  const g = new HE.Game({ save, saveSystem: ss, now: () => now });
  seedBot(seed * 7 + 1);
  g.startRun({ tutorial: false, seed });
  const spinTimes = [];
  g.on('spin', () => spinTimes.push(g.run.time));
  const roomTimes = [];
  let roomStart = 0;
  g.on('room_entered', () => (roomStart = g.run.time));
  g.on('room_cleared', () => roomTimes.push(g.run.time - roomStart));
  const res = playRun(g, Object.assign({ pressOn, takeWager: true }, prof));
  const gaps = [];
  for (let i = 1; i < spinTimes.length; i++) gaps.push(spinTimes[i] - spinTimes[i - 1]);
  return { res, gaps, roomTimes };
}

const avg = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
const med = (a) => {
  if (!a.length) return 0;
  const b = a.slice().sort((x, y) => x - y);
  return b[Math.floor(b.length / 2)];
};

for (const name of Object.keys(PROFILES)) {
  if (which !== 'all' && which !== name) continue;
  for (const pressOn of [false, true]) {
    const out = [];
    for (let i = 0; i < runs; i++) out.push(one(1000 + i, PROFILES[name], pressOn));
    const wins = out.filter((o) => o.res && o.res.outcome === 'victory').length;
    const floorsCleared = avg(out.map((o) => o.res.floorsCleared));
    const time = avg(out.map((o) => o.res.time));
    const banked = avg(out.map((o) => o.res.bankedTotal));
    const dmg = avg(out.map((o) => o.res.stats.damageTaken));
    const spinGap = med(out.flatMap((o) => o.gaps));
    const room = med(out.flatMap((o) => o.roomTimes));
    const firstBank = avg(out.map((o) => (o.res.bankedLog[0] ? o.res.bankedLog[0].amount : o.res.recovery ? o.res.recovery.recovered : 0)));
    console.log(
      name.padEnd(8) + (pressOn ? ' press ' : ' bank  ') +
        ' wins ' + wins + '/' + runs +
        '  floors ' + floorsCleared.toFixed(1) +
        '  time ' + (time / 60).toFixed(1) + 'm' +
        '  room(med) ' + room.toFixed(0) + 's' +
        '  spin gap(med) ' + spinGap.toFixed(0) + 's' +
        '  dmg taken ' + dmg.toFixed(0) +
        '  first bank ' + firstBank.toFixed(0) +
        '  banked ' + banked.toFixed(0)
    );
  }
}
