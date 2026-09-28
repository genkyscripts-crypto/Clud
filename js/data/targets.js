/*
 * Target definitions. Shared, read-only data: runtime HP and damage state live
 * on pooled Target instances, never here.
 *
 *   hp      — hit points.
 *   armor   — flat damage removed from each body hit (weak-point hits ignore it).
 *             Damage never drops below ARMOR_FLOOR of the incoming hit, so every
 *             gun can always finish every target.
 *   value   — base cash paid once when the target breaks.
 *   weak    — weak-point geometry; hits there are criticals.
 */
(function (root) {
  'use strict';
  const ZTA = root.ZTA;

  ZTA.data.ARMOR_FLOOR = 0.25;

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
      introWave: 1,
      desc: 'Painted steel on chains. The center ring is a weak point.',
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
      introWave: 3,
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
      weak: { type: 'core', r: 0.085, oy: 0.06 }, // offset from torso center, meters
      speed: [1.2, 2.1],
      introWave: 5,
      desc: 'Armored trolley silhouette. The glowing core ignores armor.',
    },
  ];

  const byId = {};
  for (const t of targets) byId[t.id] = t;

  ZTA.data.targets = ZTA.util.deepFreeze(targets);
  ZTA.data.targetById = ZTA.util.deepFreeze(byId);
})(typeof window !== 'undefined' ? window : globalThis);
