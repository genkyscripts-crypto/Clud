/*
 * Range geometry, in meters. The camera sits at x = 0, z = 0 looking down +z.
 * y is height above the floor. Everything spawned in the range uses a named
 * slot so wave patterns can be authored without raw coordinates.
 */
(function (root) {
  'use strict';
  const ZTA = root.ZTA;

  ZTA.data.range = ZTA.util.deepFreeze({
    id: 'range.bench01',
    name: 'Bench Lane 01',
    eyeHeight: 1.5,
    halfWidth: 3.6,
    ceiling: 3.0,
    backZ: 18,
    bench: { zNear: 0.9, zFar: 1.32, y: 1.02 },
    carrierY: 2.08,
    maxTargets: 16,

    rows: {
      near: { z: 7, label: '7 M' },
      mid: { z: 10, label: '10 M' },
      far: { z: 14, label: '14 M' },
    },

    rails: {
      mid: { z: 9, xMin: -3.0, xMax: 3.0 },
      far: { z: 12.5, xMin: -3.1, xMax: 3.1 },
    },

    /*
     * Slots describe where a pattern may place a target.
     *  row   — plates hanging from the overhead carrier at a fixed distance.
     *  crate — bottles standing on a wooden crate (the crate blocks shots).
     *  shelf — bottles on a long plank stand.
     *  rail  — runners patrolling a floor track.
     */
    slots: {
      row_near: { kind: 'row', row: 'near', xMin: -2.7, xMax: 2.7 },
      row_mid: { kind: 'row', row: 'mid', xMin: -2.8, xMax: 2.8 },
      row_far: { kind: 'row', row: 'far', xMin: -2.9, xMax: 2.9 },
      crate_left: { kind: 'crate', x: -1.9, z: 6.3, w: 0.85, h: 0.66, d: 0.55 },
      crate_right: { kind: 'crate', x: 1.9, z: 6.3, w: 0.85, h: 0.66, d: 0.55 },
      crate_center: { kind: 'crate', x: 0, z: 8.2, w: 0.85, h: 0.66, d: 0.55 },
      shelf_far: { kind: 'shelf', x: 0, z: 11.5, w: 2.6, h: 1.05, d: 0.35 },
      rail_mid: { kind: 'rail', rail: 'mid' },
      rail_far: { kind: 'rail', rail: 'far' },
    },
  });
})(typeof window !== 'undefined' ? window : globalThis);
