/*
 * Encounter director. Plans each combat room as a few waves from a threat
 * budget, then spawns them with telegraphs and recovery beats.
 *
 * Rules that keep patterns readable:
 *  - at most two distinct ranged pattern roles per wave;
 *  - at most one stationary turret per wave;
 *  - the next wave waits until remaining threat falls to 30% of the current
 *    wave's budget, then a 1.4 s recovery beat plays before spawning;
 *  - enemies spawn at least 280 px from the player behind a 0.8 s marker and
 *    cannot attack for a further 0.7 s.
 */
(function (root) {
  'use strict';
  const HE = root.HE;
  const D = HE.data;

  const RANGED = ['dealer', 'ringcaster', 'sniper', 'usher'];

  /** Pure planning function: same inputs and seed → same waves. */
  function planRoom(floor, roomType, roomIndex, heat, rng) {
    const rt = D.roomTypes[roomType] || D.roomTypes.combat;
    const waves = [];
    const nWaves = floor.waves;
    const base = (7 + roomIndex * 2.5) * floor.difficulty;
    let elitesLeft = (rt.extraElite ? rt.extraElite * nWaves : 0) + heat * D.HEAT.extraElitesPerRoom;
    const pool = floor.rolePool;
    for (let k = 0; k < nWaves; k++) {
      const budget = Math.round(base * (0.8 + 0.28 * k));
      const ranged = RANGED.filter((r) => pool.includes(r));
      rng.shuffle(ranged);
      const pick = ranged.slice(0, k === 0 ? 1 : 2);
      const groups = [];
      let spent = 0;
      if (pool.includes('turret') && k > 0 && rng.chance(0.55)) {
        groups.push({ role: 'turret', count: 1, elite: false });
        spent += D.enemyById.turret.threat;
      }
      let guard = 0;
      while (spent < budget * 0.62 && guard++ < 20) {
        const role = rng.pick(pick);
        const def = D.enemyById[role];
        if (spent + def.threat > budget) break;
        groups.push({ role, count: 1, elite: false });
        spent += def.threat;
      }
      while (spent < budget && guard++ < 40) {
        const n = rng.int(D.enemyById.rusher.pack[0], D.enemyById.rusher.pack[1]);
        groups.push({ role: 'rusher', count: n, elite: false });
        spent += n;
      }
      // Distribute elites across waves, later waves first.
      const elitesHere = Math.ceil(elitesLeft / (nWaves - k));
      for (let i = 0; i < elitesHere && elitesLeft > 0; i++) {
        const cand = groups.filter((g) => g.role !== 'rusher' && g.role !== 'turret' && !g.elite);
        const target = cand.length ? rng.pick(cand) : null;
        if (target) target.elite = true;
        else groups.push({ role: rng.pick(pick), count: 1, elite: true });
        elitesLeft--;
      }
      waves.push({ budget: spent, groups });
    }
    return waves;
  }

  class Director {
    constructor(game, waves) {
      this.game = game;
      this.waves = waves;
      this.index = 0;
      this.startT = 0.6;
      this.recoveryT = 0;
      this.currentBudget = 0;
      this.finished = false;
    }

    spawnedAll() {
      return this.index >= this.waves.length;
    }

    update(dt) {
      const g = this.game;
      if (this.spawnedAll()) return;
      if (this.index === 0) {
        this.startT -= dt;
        if (this.startT <= 0) this.spawnWave();
        return;
      }
      const alive = g.aliveThreat();
      if (alive <= this.currentBudget * 0.3) {
        if (this.recoveryT <= 0) this.recoveryT = 1.4;
        this.recoveryT -= dt;
        if (this.recoveryT <= 0) this.spawnWave();
      }
    }

    spawnWave() {
      const g = this.game;
      const w = this.waves[this.index++];
      this.currentBudget = w.budget;
      this.recoveryT = 0;
      for (const grp of w.groups) {
        if (grp.role === 'rusher') g.spawnPack('rusher', grp.count, grp.elite);
        else g.spawnEnemy(grp.role, null, null, grp.elite);
      }
      g.emit('wave_started', { index: this.index, total: this.waves.length });
    }

    progress() {
      return { wave: Math.min(this.index, this.waves.length), total: this.waves.length };
    }
  }

  HE.Director = Director;
  HE.planRoom = planRoom;
})(typeof window !== 'undefined' ? window : globalThis);
