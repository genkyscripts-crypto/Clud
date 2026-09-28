/*
 * Target definitions at Bench Lane scale. Ranges multiply hp and armor by
 * range.hpMult and value by range.valueMult when a target spawns. Runtime HP
 * and damage state live on pooled Target instances, never here.
 *
 *   hp      hit points.
 *   armor   flat damage removed from each body hit (weak-point hits ignore it).
 *           Damage never drops below ARMOR_FLOOR of the incoming hit, so every
 *           gun can always finish every target.
 *   value   base cash paid once when the target breaks.
 *   weak    weak-point geometry; hits there are criticals.
 */
(function (root) {
  'use strict';
  const ZTA = root.ZTA;

  ZTA.data.ARMOR_FLOOR = 0.2;

  const targets = [
    {
      id: 'tgt.plate',
      name: 'Steel Plate',
      short: 'Plate',
      material: 'steel',
      hp: 30,
      armor: 0,
      value: 3,
      shape: { type: 'plate', r: 0.3 },
      weak: { type: 'ring', r: 0.34 }, // fraction of the plate radius
      desc: 'Painted steel. The center ring is a weak point.',
    },
    {
      id: 'tgt.bottle',
      name: 'Glass Bottle',
      short: 'Bottle',
      material: 'glass',
      hp: 4,
      armor: 0,
      value: 1,
      shape: { type: 'bottle', w: 0.1, h: 0.32 },
      weak: null,
      desc: 'Fragile and cheap. Comes packed in clusters.',
    },
    {
      id: 'tgt.runner',
      name: 'Rail Runner',
      short: 'Runner',
      material: 'mech',
      hp: 60,
      armor: 4,
      value: 10,
      shape: { type: 'runner', w: 0.46, h: 0.62, headR: 0.13, base: 0.34 },
      weak: { type: 'core', r: 0.085, oy: 0.06 },
      speed: [1.2, 2.1],
      moving: true,
      desc: 'Armored trolley silhouette. The glowing core ignores armor.',
    },
    {
      id: 'tgt.drone',
      name: 'Drone',
      short: 'Drone',
      material: 'mech',
      hp: 14,
      armor: 0,
      value: 14,
      shape: { type: 'drone', w: 0.56, h: 0.15 },
      weak: { type: 'light', r: 0.075 },
      speed: [2.0, 3.0],
      moving: true,
      bonus: true,
      desc: 'Bonus cash. Crosses the range and escapes if ignored.',
    },
    {
      id: 'tgt.popper',
      name: 'Popper',
      short: 'Popper',
      material: 'steel',
      hp: 24,
      armor: 0,
      value: 7,
      shape: { type: 'popper', w: 0.3, h: 0.78, headR: 0.13 },
      weak: { type: 'head' },
      uptime: [2.4, 3.2],
      desc: 'Springs up for a few seconds, then drops out of reach.',
    },
    {
      id: 'tgt.barrel',
      name: 'Fuel Barrel',
      short: 'Barrel',
      material: 'steel',
      hp: 16,
      armor: 0,
      value: 4,
      shape: { type: 'barrel', w: 0.5, h: 0.84 },
      weak: null,
      explosive: { radius: 1.8, damage: 80 },
      desc: 'Explodes when broken and damages everything nearby. Chains into other barrels.',
    },
    {
      id: 'tgt.heavy',
      name: 'Heavy Plate',
      short: 'Heavy',
      material: 'steel',
      hp: 90,
      armor: 8,
      value: 18,
      shape: { type: 'heavy', w: 0.52, h: 0.62, post: 0.85 },
      weak: null,
      desc: 'Thick armor with no weak point. Needs heavy hits or armor-piercing rounds.',
    },
    {
      id: 'tgt.shutter',
      name: 'Shutter Box',
      short: 'Shutter',
      material: 'mech',
      hp: 80,
      armor: 10,
      value: 22,
      shape: { type: 'shutter', w: 0.62, h: 0.56, post: 0.85 },
      weak: { type: 'window', r: 0.12, open: 1.3, closed: 1.7 },
      desc: 'Armored box. Its core is exposed only while the shutter is open.',
    },
    // Boss parts. Their hp / armor / value come from the boss definition.
    { id: 'tgt.boss.panel', name: 'Armor Panel', short: 'Panel', material: 'mech', hp: 1, armor: 0, value: 1, shape: { type: 'bosspart' }, weak: null, boss: true },
    { id: 'tgt.boss.plate', name: 'Chest Plate', short: 'Chest', material: 'steel', hp: 1, armor: 0, value: 1, shape: { type: 'bosspart' }, weak: null, boss: true },
    { id: 'tgt.boss.sensor', name: 'Sensor', short: 'Sensor', material: 'glass', hp: 1, armor: 0, value: 1, shape: { type: 'bosspart' }, weak: { type: 'window', open: 1.6, closed: 2.2 }, boss: true },
    { id: 'tgt.boss.core', name: 'Core', short: 'Core', material: 'mech', hp: 1, armor: 0, value: 1, shape: { type: 'bosspart' }, weak: { type: 'core' }, boss: true },
  ];

  const byId = {};
  for (const t of targets) byId[t.id] = t;

  ZTA.data.targets = ZTA.util.deepFreeze(targets);
  ZTA.data.targetById = ZTA.util.deepFreeze(byId);
  /** Targets shown in shots-to-break tables (bosses excluded). */
  ZTA.data.tableTargets = ZTA.util.deepFreeze(targets.filter((t) => !t.boss));
})(typeof window !== 'undefined' ? window : globalThis);
