/*
 * Challenge rounds: short timed runs (45–90 s) on a range, scored on one
 * metric with three star thresholds. Requirements are shown before starting.
 *
 *   metric      breaks | weakBreaks | droneBreaks | armorBreaks | score | bossTime
 *   stars       thresholds for 1/2/3 stars (bossTime: finish within N seconds)
 *   families    optional loadout restriction (family trials)
 *   normalized  family trials scale every gun to the range's tier and ignore
 *               upgrades, so low-tier favorites stay competitive
 *   lives       endurance: each escaped target costs a life; out of lives ends the round
 *   stream      keeps up to maxAlive targets alive, spawning every `interval` s
 *   needs       a boss is only called after N other challenges on its range have a star
 *
 * Rewards: Blueprint Tokens the first time each star is earned, plus cash
 * (range-scaled) on every completion with at least one star (half on repeats).
 */
(function (root) {
  'use strict';
  const ZTA = root.ZTA;

  const P = (type, slots, weight) => ({ type, slots, weight: weight || 1 });

  const list = [
    /* ---------------------------------------------------------- Bench Lane */
    {
      id: 'ch.bench.qualifier', range: 'range.bench01', name: 'Qualifier', type: 'clear', duration: 60,
      desc: 'Break as many targets as you can in sixty seconds.',
      metric: 'breaks', stars: [18, 30, 42],
      stream: { maxAlive: 5, interval: 0.45, pool: [P('tgt.plate', ['row_near', 'row_mid', 'row_far'], 3), P('tgt.bottle', ['crate_left', 'crate_right', 'shelf_far'], 2)] },
      reward: { blueprints: [1, 1, 1], cash: 150 },
    },
    {
      id: 'ch.bench.center', range: 'range.bench01', name: 'Center Mass', type: 'precision', duration: 60,
      desc: 'Only breaks finished with a weak-point hit count.',
      metric: 'weakBreaks', stars: [8, 15, 22],
      stream: { maxAlive: 4, interval: 0.5, pool: [P('tgt.plate', ['row_near', 'row_mid', 'row_far'], 3), P('tgt.runner', ['rail_mid', 'rail_far'], 1)] },
      reward: { blueprints: [1, 1, 1], cash: 180 },
    },
    {
      id: 'ch.bench.sidearms', range: 'range.bench01', name: 'Sidearm Trial', type: 'family', duration: 45,
      desc: 'Pistols and revolvers only, all at equal footing.',
      metric: 'breaks', stars: [12, 22, 32], families: ['pistol', 'revolver'], normalized: true,
      stream: { maxAlive: 5, interval: 0.45, pool: [P('tgt.plate', ['row_near', 'row_mid'], 3), P('tgt.bottle', ['crate_left', 'crate_right'], 2)] },
      reward: { blueprints: [1, 1, 1], cash: 150 },
    },
    {
      id: 'ch.bench.combo', range: 'range.bench01', name: 'Showtime', type: 'combo', duration: 60,
      desc: 'Score points: every break is worth its value times your combo. Misses hurt.',
      metric: 'score', stars: [140, 260, 380],
      stream: { maxAlive: 6, interval: 0.4, pool: [P('tgt.plate', ['row_near', 'row_mid', 'row_far'], 2), P('tgt.bottle', ['crate_left', 'crate_right', 'shelf_far'], 3), P('tgt.runner', ['rail_mid'], 1)] },
      reward: { blueprints: [1, 1, 1], cash: 200 },
    },
    {
      id: 'ch.bench.boss', range: 'range.bench01', name: 'Target Rig Mk I', type: 'boss', duration: 90,
      desc: 'Strip the armor panels, crack the chest plate and break the core.',
      metric: 'bossTime', stars: [90, 55, 35], boss: 'boss.rig', needs: 2,
      stream: { maxAlive: 2, interval: 3, pool: [P('tgt.bottle', ['crate_left', 'crate_right'], 1)] },
      reward: { blueprints: [2, 1, 1], cash: 400 },
    },

    /* ----------------------------------------------------------- Rooftop 9 */
    {
      id: 'ch.roof.qualifier', range: 'range.rooftop', name: 'Rooftop Qualifier', type: 'clear', duration: 60,
      desc: 'Break as many targets as you can. Drones and poppers count too.',
      metric: 'breaks', stars: [16, 28, 40],
      stream: { maxAlive: 5, interval: 0.5, pool: [P('tgt.plate', ['row_near', 'row_mid', 'row_far'], 3), P('tgt.popper', ['pop_near', 'pop_far'], 2), P('tgt.drone', ['air_mid', 'air_far'], 1)] },
      reward: { blueprints: [1, 1, 1], cash: 150 },
    },
    {
      id: 'ch.roof.drones', range: 'range.rooftop', name: 'Drone Season', type: 'drones', duration: 60,
      desc: 'Only drones count. They will not wait for you.',
      metric: 'droneBreaks', stars: [8, 14, 20],
      stream: { maxAlive: 4, interval: 0.6, pool: [P('tgt.drone', ['air_mid', 'air_far'], 4), P('tgt.plate', ['row_mid'], 1)] },
      reward: { blueprints: [1, 1, 1], cash: 180 },
    },
    {
      id: 'ch.roof.poppers', range: 'range.rooftop', name: 'Pop Quiz', type: 'endurance', duration: 75,
      desc: 'Poppers alternate near and far. Each one that drops away costs a life.',
      metric: 'breaks', stars: [15, 26, 36], lives: 5,
      stream: { maxAlive: 3, interval: 0.8, pool: [P('tgt.popper', ['pop_near'], 1), P('tgt.popper', ['pop_far'], 1)] },
      reward: { blueprints: [1, 1, 1], cash: 200 },
    },
    {
      id: 'ch.roof.smg', range: 'range.rooftop', name: 'Spray Trial', type: 'family', duration: 60,
      desc: 'SMGs only, all at equal footing. Score with combos.',
      metric: 'score', stars: [160, 300, 440], families: ['smg'], normalized: true,
      stream: { maxAlive: 6, interval: 0.4, pool: [P('tgt.bottle', ['ac_left', 'ac_right', 'ledge_far'], 3), P('tgt.plate', ['row_near', 'row_mid'], 2), P('tgt.drone', ['air_mid'], 1)] },
      reward: { blueprints: [1, 1, 1], cash: 180 },
    },
    {
      id: 'ch.roof.boss', range: 'range.rooftop', name: 'Skylight Sentry', type: 'boss', duration: 90,
      desc: 'A floodlight sentry with shielded core. Its sensor only opens now and then.',
      metric: 'bossTime', stars: [90, 60, 40], boss: 'boss.sentry', needs: 2,
      stream: { maxAlive: 2, interval: 2.5, pool: [P('tgt.drone', ['air_mid', 'air_far'], 1)] },
      reward: { blueprints: [2, 1, 1], cash: 400 },
    },

    /* ---------------------------------------------------------- Scrap Yard */
    {
      id: 'ch.scrap.qualifier', range: 'range.scrapyard', name: 'Yard Qualifier', type: 'clear', duration: 60,
      desc: 'Break as many targets as you can. Barrels take their neighbors with them.',
      metric: 'breaks', stars: [22, 38, 54],
      stream: { maxAlive: 6, interval: 0.45, pool: [P('tgt.plate', ['row_near', 'row_mid', 'row_far'], 3), P('tgt.barrel', ['barrels_near', 'barrels_far'], 2), P('tgt.bottle', ['pallet_left', 'pallet_right'], 2)] },
      reward: { blueprints: [1, 1, 1], cash: 150 },
    },
    {
      id: 'ch.scrap.chain', range: 'range.scrapyard', name: 'Chain Reaction', type: 'chain', duration: 60,
      desc: 'Barrels everywhere. Set off chains to rack up breaks.',
      metric: 'breaks', stars: [30, 50, 70],
      stream: { maxAlive: 9, interval: 0.3, pool: [P('tgt.barrel', ['barrels_near', 'barrels_far'], 3), P('tgt.bottle', ['pallet_left', 'pallet_right', 'hood_far'], 3), P('tgt.plate', ['row_near'], 1)] },
      reward: { blueprints: [1, 1, 1], cash: 200 },
    },
    {
      id: 'ch.scrap.armor', range: 'range.scrapyard', name: 'Hard Target', type: 'armor', duration: 60,
      desc: 'Only armored targets count: heavy plates and runners.',
      metric: 'armorBreaks', stars: [6, 11, 16],
      stream: { maxAlive: 4, interval: 0.8, pool: [P('tgt.heavy', ['stand_mid'], 3), P('tgt.runner', ['rail_mid', 'rail_far'], 1)] },
      reward: { blueprints: [1, 1, 1], cash: 220 },
    },
    {
      id: 'ch.scrap.shotgun', range: 'range.scrapyard', name: 'Buckshot Trial', type: 'family', duration: 45,
      desc: 'Shotguns only, all at equal footing.',
      metric: 'breaks', stars: [20, 34, 48], families: ['shotgun'], normalized: true,
      stream: { maxAlive: 8, interval: 0.35, pool: [P('tgt.bottle', ['pallet_left', 'pallet_right', 'hood_far'], 3), P('tgt.plate', ['row_near'], 2), P('tgt.barrel', ['barrels_near'], 1)] },
      reward: { blueprints: [1, 1, 1], cash: 180 },
    },
    {
      id: 'ch.scrap.boss', range: 'range.scrapyard', name: 'Scrap Crusher', type: 'boss', duration: 90,
      desc: 'A hydraulic crusher with heavy claws. Beating it lets you open a new branch.',
      metric: 'bossTime', stars: [90, 60, 42], boss: 'boss.crusher', needs: 2,
      stream: { maxAlive: 2, interval: 2.5, pool: [P('tgt.barrel', ['barrels_near'], 1)] },
      reward: { blueprints: [2, 1, 1], cash: 400 },
    },

    /* -------------------------------------------------------- Freight Dock */
    {
      id: 'ch.dock.qualifier', range: 'range.dock', name: 'Dock Qualifier', type: 'clear', duration: 60,
      desc: 'Break as many targets as you can across the warehouse.',
      metric: 'breaks', stars: [20, 34, 48],
      stream: { maxAlive: 6, interval: 0.45, pool: [P('tgt.plate', ['row_near', 'row_mid', 'row_far', 'rack_mid'], 3), P('tgt.shutter', ['shutter_mid'], 1), P('tgt.bottle', ['crate_left', 'crate_right'], 2)] },
      reward: { blueprints: [1, 1, 1], cash: 150 },
    },
    {
      id: 'ch.dock.rack', range: 'range.dock', name: 'Line Them Up', type: 'rack', duration: 60,
      desc: 'Plates stand in lines. Penetrating rounds break whole rows.',
      metric: 'breaks', stars: [24, 42, 60],
      stream: { maxAlive: 9, interval: 0.4, pool: [P('tgt.plate', ['rack_mid'], 1)] },
      reward: { blueprints: [1, 1, 1], cash: 200 },
    },
    {
      id: 'ch.dock.shutter', range: 'range.dock', name: 'Window Work', type: 'precision', duration: 60,
      desc: 'Shutters only open briefly. Weak-point breaks count.',
      metric: 'weakBreaks', stars: [6, 11, 16],
      stream: { maxAlive: 4, interval: 0.7, pool: [P('tgt.shutter', ['shutter_mid'], 1)] },
      reward: { blueprints: [1, 1, 1], cash: 220 },
    },
    {
      id: 'ch.dock.rifles', range: 'range.dock', name: 'Rifle Trial', type: 'family', duration: 60,
      desc: 'Rifles only, all at equal footing.',
      metric: 'breaks', stars: [22, 36, 50], families: ['rifle'], normalized: true,
      stream: { maxAlive: 6, interval: 0.4, pool: [P('tgt.plate', ['row_near', 'row_mid', 'row_far', 'rack_mid'], 3), P('tgt.runner', ['rail_mid', 'rail_far'], 1)] },
      reward: { blueprints: [1, 1, 1], cash: 180 },
    },
    {
      id: 'ch.dock.boss', range: 'range.dock', name: 'Gantry', type: 'boss', duration: 90,
      desc: 'An overhead gantry rig with four panels, a chest plate and a blinking sensor.',
      metric: 'bossTime', stars: [90, 60, 42], boss: 'boss.gantry', needs: 2,
      stream: { maxAlive: 2, interval: 2.2, pool: [P('tgt.drone', ['air_mid'], 1)] },
      reward: { blueprints: [2, 1, 1], cash: 400 },
    },

    /* ----------------------------------------------------------- The Vault */
    {
      id: 'ch.vault.gauntlet', range: 'range.vault', name: 'Gauntlet', type: 'clear', duration: 75,
      desc: 'Everything you have faced, all at once.',
      metric: 'breaks', stars: [22, 38, 54],
      stream: {
        maxAlive: 6, interval: 0.45,
        pool: [P('tgt.plate', ['row_near', 'row_mid', 'rack_mid'], 2), P('tgt.heavy', ['stand_mid'], 1), P('tgt.popper', ['pop_near', 'pop_far'], 2), P('tgt.drone', ['air_mid'], 1), P('tgt.barrel', ['barrels_near'], 1)],
      },
      reward: { blueprints: [1, 1, 1], cash: 150 },
    },
    {
      id: 'ch.vault.marksman', range: 'range.vault', name: 'Long Watch', type: 'family', duration: 60,
      desc: 'Marksman rifles only, all at equal footing. Weak-point breaks count.',
      metric: 'weakBreaks', stars: [8, 14, 20], families: ['marksman'], normalized: true,
      stream: { maxAlive: 4, interval: 0.6, pool: [P('tgt.plate', ['row_far', 'row_mid'], 3), P('tgt.shutter', ['shutter_far'], 1)] },
      reward: { blueprints: [1, 1, 1], cash: 200 },
    },
    {
      id: 'ch.vault.heavy', range: 'range.vault', name: 'Heavy Trial', type: 'endurance', duration: 75,
      desc: 'Heavy weapons only. Poppers and drones that escape cost a life.',
      metric: 'breaks', stars: [24, 40, 56], families: ['heavy'], normalized: true, lives: 6,
      stream: { maxAlive: 6, interval: 0.4, pool: [P('tgt.popper', ['pop_near', 'pop_far'], 2), P('tgt.drone', ['air_mid'], 2), P('tgt.plate', ['row_near', 'row_mid'], 1)] },
      reward: { blueprints: [1, 1, 1], cash: 200 },
    },
    {
      id: 'ch.vault.boss', range: 'range.vault', name: 'The Overseer', type: 'boss', duration: 90,
      desc: 'The final machine. Six sections, a shielded core and no patience.',
      metric: 'bossTime', stars: [90, 62, 45], boss: 'boss.overseer', needs: 2,
      stream: { maxAlive: 2, interval: 2, pool: [P('tgt.popper', ['pop_near'], 1), P('tgt.drone', ['air_mid'], 1)] },
      reward: { blueprints: [3, 2, 2], cash: 400 },
    },
  ];

  const byId = {};
  for (const c of list) byId[c.id] = c;

  ZTA.data.challenges = ZTA.util.deepFreeze(list);
  ZTA.data.challengeById = ZTA.util.deepFreeze(byId);
})(typeof window !== 'undefined' ? window : globalThis);
