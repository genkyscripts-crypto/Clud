/*
 * Authored wave patterns. The director plays the intro list in order (it
 * introduces one mechanic at a time), then draws from the pool by weight,
 * never repeating the previous pattern. Randomization is constrained to the
 * ranges written here: counts, slot choice and small position jitter.
 *
 * spawn.slot  — slot id, or an array of slot ids to pick one from.
 * spawn.count — number, or [min, max] inclusive.
 *
 * Target health never scales with wave number. Variety comes from layout,
 * mixes of target types, and new behaviors introduced over time.
 */
(function (root) {
  'use strict';
  const ZTA = root.ZTA;

  const intro = [
    { id: 'wave.intro_plates', spawns: [{ type: 'tgt.plate', slot: 'row_near', count: 3 }] },
    {
      id: 'wave.intro_depth',
      spawns: [
        { type: 'tgt.plate', slot: 'row_near', count: 2 },
        { type: 'tgt.plate', slot: 'row_mid', count: 2 },
      ],
    },
    {
      id: 'wave.intro_bottles',
      spawns: [
        { type: 'tgt.bottle', slot: 'crate_left', count: 4 },
        { type: 'tgt.plate', slot: 'row_mid', count: 2 },
      ],
    },
    {
      id: 'wave.intro_stagger',
      spawns: [
        { type: 'tgt.plate', slot: 'row_near', count: 2 },
        { type: 'tgt.plate', slot: 'row_mid', count: 2 },
        { type: 'tgt.plate', slot: 'row_far', count: 1 },
        { type: 'tgt.bottle', slot: 'crate_right', count: 3 },
      ],
    },
    {
      id: 'wave.intro_runner',
      spawns: [
        { type: 'tgt.runner', slot: 'rail_mid', count: 1 },
        { type: 'tgt.plate', slot: 'row_far', count: 2 },
      ],
    },
  ];

  const pool = [
    {
      id: 'wave.plate_line',
      weight: 3,
      spawns: [{ type: 'tgt.plate', slot: ['row_near', 'row_mid'], count: [3, 5] }],
    },
    {
      id: 'wave.stagger',
      weight: 3,
      spawns: [
        { type: 'tgt.plate', slot: 'row_near', count: [1, 2] },
        { type: 'tgt.plate', slot: 'row_mid', count: [1, 2] },
        { type: 'tgt.plate', slot: 'row_far', count: [1, 2] },
      ],
    },
    {
      id: 'wave.crates',
      weight: 2,
      spawns: [
        { type: 'tgt.bottle', slot: 'crate_left', count: [3, 5] },
        { type: 'tgt.bottle', slot: 'crate_right', count: [3, 5] },
        { type: 'tgt.plate', slot: 'row_far', count: [0, 2] },
      ],
    },
    {
      id: 'wave.shelf',
      weight: 2,
      spawns: [
        { type: 'tgt.bottle', slot: 'shelf_far', count: [4, 7] },
        { type: 'tgt.plate', slot: 'row_near', count: [1, 2] },
      ],
    },
    {
      id: 'wave.runner_pair',
      weight: 2,
      minWave: 7,
      spawns: [
        { type: 'tgt.runner', slot: 'rail_mid', count: 1 },
        { type: 'tgt.runner', slot: 'rail_far', count: 1 },
        { type: 'tgt.plate', slot: 'row_near', count: [1, 2] },
      ],
    },
    {
      id: 'wave.mixed',
      weight: 3,
      spawns: [
        { type: 'tgt.bottle', slot: ['crate_left', 'crate_right', 'crate_center'], count: [3, 4] },
        { type: 'tgt.runner', slot: ['rail_mid', 'rail_far'], count: 1 },
        { type: 'tgt.plate', slot: 'row_mid', count: [1, 2] },
      ],
    },
    {
      id: 'wave.far_precision',
      weight: 1,
      minWave: 8,
      spawns: [
        { type: 'tgt.plate', slot: 'row_far', count: [3, 4] },
        { type: 'tgt.bottle', slot: 'shelf_far', count: [2, 3] },
      ],
    },
  ];

  /** One-line captions shown the first time a target type appears. */
  const introCaptions = {
    'tgt.bottle': { title: 'Bottles', text: 'Fragile and cheap, packed in clusters.' },
    'tgt.runner': { title: 'Rail Runner', text: 'Armored and moving. Shoot the glowing core.' },
  };

  ZTA.data.waves = ZTA.util.deepFreeze({ intro, pool, introCaptions });
})(typeof window !== 'undefined' ? window : globalThis);
