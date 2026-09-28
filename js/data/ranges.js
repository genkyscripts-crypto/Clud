/*
 * Ranges (maps). Each range is a self-contained place: geometry in meters, a
 * visual theme, how tough and how valuable its targets are, how it unlocks,
 * and the authored wave patterns used in practice.
 *
 * Target health and value are authored once at Bench Lane scale (targets.js)
 * and multiplied here. Health grows much slower than value, and every range
 * also adds new behaviors, so progress never becomes "the same plate, more HP".
 *
 * Slot kinds (where patterns may place things):
 *   row      plates hanging from an overhead carrier at a fixed distance
 *   crate    bottles on a crate (the crate blocks shots)
 *   shelf    bottles on a plank stand
 *   rail     runners patrolling a floor track
 *   air      drones crossing in a height band (they escape if ignored)
 *   popup    poppers that spring up briefly, then drop (alternate near/far)
 *   barrels  explosive barrels standing on the ground
 *   stand    free-standing heavy plates on posts
 *   rack     plates aligned in depth, for penetrating rounds
 *   shutter  armored boxes whose weak point opens and closes
 *   boss     the pad a boss patrols
 */
(function (root) {
  'use strict';
  const ZTA = root.ZTA;

  const bench = {
    id: 'range.bench01',
    index: 1,
    name: 'Bench Lane',
    short: 'Bench Lane 01',
    theme: 'basement',
    tone: 'ink',
    blurb: 'A basement range under a closed pawn shop. Painted steel, cheap bottles and one squeaky rail.',
    unlock: { cost: 0, requires: null },
    hpMult: 1,
    valueMult: 1,
    eyeHeight: 1.5,
    halfWidth: 3.6,
    ceiling: 3.0,
    wallHeight: 3.0,
    backHeight: 3.0,
    backZ: 18,
    bench: { zNear: 0.9, zFar: 1.32, y: 1.02 },
    carrierY: 2.08,
    maxTargets: 16,
    rows: { near: { z: 7, label: '7 M' }, mid: { z: 10, label: '10 M' }, far: { z: 14, label: '14 M' } },
    rails: { mid: { z: 9, xMin: -3.0, xMax: 3.0 }, far: { z: 12.5, xMin: -3.1, xMax: 3.1 } },
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
      boss_pad: { kind: 'boss', z: 10.5, xMin: -2.2, xMax: 2.2 },
    },
    intro: [
      { id: 'wave.b.intro_plates', spawns: [{ type: 'tgt.plate', slot: 'row_near', count: 3 }] },
      { id: 'wave.b.intro_depth', spawns: [{ type: 'tgt.plate', slot: 'row_near', count: 2 }, { type: 'tgt.plate', slot: 'row_mid', count: 2 }] },
      { id: 'wave.b.intro_bottles', spawns: [{ type: 'tgt.bottle', slot: 'crate_left', count: 4 }, { type: 'tgt.plate', slot: 'row_mid', count: 2 }] },
      {
        id: 'wave.b.intro_stagger',
        spawns: [
          { type: 'tgt.plate', slot: 'row_near', count: 2 },
          { type: 'tgt.plate', slot: 'row_mid', count: 2 },
          { type: 'tgt.plate', slot: 'row_far', count: 1 },
          { type: 'tgt.bottle', slot: 'crate_right', count: 3 },
        ],
      },
      { id: 'wave.b.intro_runner', spawns: [{ type: 'tgt.runner', slot: 'rail_mid', count: 1 }, { type: 'tgt.plate', slot: 'row_far', count: 2 }] },
    ],
    pool: [
      { id: 'wave.b.plate_line', weight: 3, spawns: [{ type: 'tgt.plate', slot: ['row_near', 'row_mid'], count: [3, 5] }] },
      {
        id: 'wave.b.stagger',
        weight: 3,
        spawns: [
          { type: 'tgt.plate', slot: 'row_near', count: [1, 2] },
          { type: 'tgt.plate', slot: 'row_mid', count: [1, 2] },
          { type: 'tgt.plate', slot: 'row_far', count: [1, 2] },
        ],
      },
      {
        id: 'wave.b.crates',
        weight: 2,
        spawns: [
          { type: 'tgt.bottle', slot: 'crate_left', count: [3, 5] },
          { type: 'tgt.bottle', slot: 'crate_right', count: [3, 5] },
          { type: 'tgt.plate', slot: 'row_far', count: [0, 2] },
        ],
      },
      { id: 'wave.b.shelf', weight: 2, spawns: [{ type: 'tgt.bottle', slot: 'shelf_far', count: [4, 7] }, { type: 'tgt.plate', slot: 'row_near', count: [1, 2] }] },
      {
        id: 'wave.b.runner_pair',
        weight: 2,
        minWave: 7,
        spawns: [
          { type: 'tgt.runner', slot: 'rail_mid', count: 1 },
          { type: 'tgt.runner', slot: 'rail_far', count: 1 },
          { type: 'tgt.plate', slot: 'row_near', count: [1, 2] },
        ],
      },
      {
        id: 'wave.b.mixed',
        weight: 3,
        spawns: [
          { type: 'tgt.bottle', slot: ['crate_left', 'crate_right', 'crate_center'], count: [3, 4] },
          { type: 'tgt.runner', slot: ['rail_mid', 'rail_far'], count: 1 },
          { type: 'tgt.plate', slot: 'row_mid', count: [1, 2] },
        ],
      },
      { id: 'wave.b.far_precision', weight: 1, minWave: 8, spawns: [{ type: 'tgt.plate', slot: 'row_far', count: [3, 4] }, { type: 'tgt.bottle', slot: 'shelf_far', count: [2, 3] }] },
    ],
  };

  const rooftop = {
    id: 'range.rooftop',
    index: 2,
    name: 'Rooftop 9',
    short: 'Rooftop 9',
    theme: 'rooftop',
    tone: 'paper',
    blurb: 'Nine floors up, after dark. Floodlit steel, drones buzzing the skyline and poppers that do not wait.',
    unlock: { cost: 5000, requires: { challenge: 'ch.bench.qualifier', stars: 1 } },
    hpMult: 3,
    valueMult: 8,
    eyeHeight: 1.5,
    halfWidth: 5,
    ceiling: null,
    wallHeight: 1.1,
    backHeight: 3.4,
    backZ: 24,
    bench: { zNear: 0.9, zFar: 1.35, y: 1.05 },
    carrierY: 2.2,
    maxTargets: 16,
    rows: { near: { z: 8, label: '8 M' }, mid: { z: 12, label: '12 M' }, far: { z: 17, label: '17 M' } },
    rails: { mid: { z: 10.5, xMin: -4.2, xMax: 4.2 }, far: { z: 15, xMin: -4.4, xMax: 4.4 } },
    slots: {
      row_near: { kind: 'row', row: 'near', xMin: -3.4, xMax: 3.4 },
      row_mid: { kind: 'row', row: 'mid', xMin: -3.8, xMax: 3.8 },
      row_far: { kind: 'row', row: 'far', xMin: -4.0, xMax: 4.0 },
      ac_left: { kind: 'crate', x: -3.1, z: 7.2, w: 1.2, h: 0.85, d: 0.8, look: 'ac' },
      ac_right: { kind: 'crate', x: 3.1, z: 7.2, w: 1.2, h: 0.85, d: 0.8, look: 'ac' },
      ledge_far: { kind: 'shelf', x: 0, z: 13.5, w: 3.4, h: 1.15, d: 0.3 },
      rail_mid: { kind: 'rail', rail: 'mid' },
      rail_far: { kind: 'rail', rail: 'far' },
      air_mid: { kind: 'air', z: [9, 13], y: [1.9, 2.7], xMin: -6.5, xMax: 6.5 },
      air_far: { kind: 'air', z: [14, 19], y: [2.2, 3.4], xMin: -7.5, xMax: 7.5 },
      pop_near: { kind: 'popup', z: 7.5, xMin: -3.6, xMax: 3.6 },
      pop_far: { kind: 'popup', z: 16, xMin: -4.2, xMax: 4.2 },
      boss_pad: { kind: 'boss', z: 12.5, xMin: -3.2, xMax: 3.2 },
    },
    intro: [
      { id: 'wave.r.intro_plates', spawns: [{ type: 'tgt.plate', slot: 'row_near', count: 3 }, { type: 'tgt.plate', slot: 'row_mid', count: 2 }] },
      { id: 'wave.r.intro_drones', spawns: [{ type: 'tgt.drone', slot: 'air_mid', count: 2 }, { type: 'tgt.plate', slot: 'row_mid', count: 2 }] },
      { id: 'wave.r.intro_poppers', spawns: [{ type: 'tgt.popper', slot: 'pop_near', count: 2 }, { type: 'tgt.popper', slot: 'pop_far', count: 2 }] },
    ],
    pool: [
      {
        id: 'wave.r.skyline',
        weight: 3,
        spawns: [
          { type: 'tgt.plate', slot: ['row_near', 'row_mid'], count: [2, 4] },
          { type: 'tgt.drone', slot: ['air_mid', 'air_far'], count: [1, 2] },
        ],
      },
      {
        id: 'wave.r.alternating',
        weight: 3,
        spawns: [
          { type: 'tgt.popper', slot: 'pop_near', count: [2, 3] },
          { type: 'tgt.popper', slot: 'pop_far', count: [2, 3] },
        ],
      },
      {
        id: 'wave.r.ac_bottles',
        weight: 2,
        spawns: [
          { type: 'tgt.bottle', slot: 'ac_left', count: [4, 6] },
          { type: 'tgt.bottle', slot: 'ac_right', count: [4, 6] },
          { type: 'tgt.drone', slot: 'air_far', count: [0, 1] },
        ],
      },
      {
        id: 'wave.r.runners',
        weight: 2,
        spawns: [
          { type: 'tgt.runner', slot: 'rail_mid', count: 1 },
          { type: 'tgt.runner', slot: 'rail_far', count: 1 },
          { type: 'tgt.plate', slot: 'row_far', count: [1, 3] },
        ],
      },
      { id: 'wave.r.ledge', weight: 2, spawns: [{ type: 'tgt.bottle', slot: 'ledge_far', count: [5, 8] }, { type: 'tgt.popper', slot: 'pop_near', count: [1, 2] }] },
      { id: 'wave.r.swarm', weight: 1, minWave: 6, spawns: [{ type: 'tgt.drone', slot: 'air_mid', count: [2, 3] }, { type: 'tgt.drone', slot: 'air_far', count: [1, 2] }] },
    ],
  };

  const scrapyard = {
    id: 'range.scrapyard',
    index: 3,
    name: 'Scrap Yard',
    short: 'Scrap Yard',
    theme: 'scrapyard',
    tone: 'ink',
    blurb: 'Crushed cars, a dead crane and barrels nobody labeled. Heavy steel that shrugs off light rounds.',
    unlock: { cost: 1200000, requires: { challenge: 'ch.roof.qualifier', stars: 1 } },
    hpMult: 9,
    valueMult: 60,
    eyeHeight: 1.55,
    halfWidth: 5.5,
    ceiling: null,
    wallHeight: 0,
    backHeight: 3.6,
    backZ: 28,
    bench: { zNear: 0.9, zFar: 1.4, y: 1.05 },
    carrierY: 2.3,
    maxTargets: 18,
    rows: { near: { z: 8, label: '8 M' }, mid: { z: 12.5, label: '12 M' }, far: { z: 18, label: '18 M' } },
    rails: { mid: { z: 11, xMin: -4.5, xMax: 4.5 }, far: { z: 16, xMin: -4.8, xMax: 4.8 } },
    slots: {
      row_near: { kind: 'row', row: 'near', xMin: -3.6, xMax: 3.6 },
      row_mid: { kind: 'row', row: 'mid', xMin: -4.0, xMax: 4.0 },
      row_far: { kind: 'row', row: 'far', xMin: -4.4, xMax: 4.4 },
      pallet_left: { kind: 'crate', x: -3.4, z: 7.5, w: 1.1, h: 0.55, d: 0.9, look: 'pallet' },
      pallet_right: { kind: 'crate', x: 3.4, z: 7.5, w: 1.1, h: 0.55, d: 0.9, look: 'pallet' },
      hood_far: { kind: 'shelf', x: 0, z: 15, w: 3.2, h: 0.95, d: 0.4, look: 'hood' },
      rail_mid: { kind: 'rail', rail: 'mid' },
      rail_far: { kind: 'rail', rail: 'far' },
      barrels_near: { kind: 'barrels', z: 9.5, xMin: -3.8, xMax: 3.8 },
      barrels_far: { kind: 'barrels', z: 15.5, xMin: -4.2, xMax: 4.2 },
      stand_mid: { kind: 'stand', z: 11.5, xMin: -3.6, xMax: 3.6 },
      air_mid: { kind: 'air', z: [10, 15], y: [2.0, 3.0], xMin: -7.5, xMax: 7.5 },
      boss_pad: { kind: 'boss', z: 13.5, xMin: -3.4, xMax: 3.4 },
    },
    intro: [
      { id: 'wave.s.intro_barrels', spawns: [{ type: 'tgt.barrel', slot: 'barrels_near', count: 3 }, { type: 'tgt.plate', slot: 'row_mid', count: 3 }] },
      { id: 'wave.s.intro_heavy', spawns: [{ type: 'tgt.heavy', slot: 'stand_mid', count: 2 }, { type: 'tgt.plate', slot: 'row_near', count: 2 }] },
    ],
    pool: [
      {
        id: 'wave.s.chain',
        weight: 3,
        spawns: [
          { type: 'tgt.barrel', slot: 'barrels_near', count: [2, 4] },
          { type: 'tgt.plate', slot: 'row_near', count: [2, 3] },
          { type: 'tgt.bottle', slot: ['pallet_left', 'pallet_right'], count: [3, 5] },
        ],
      },
      { id: 'wave.s.armor', weight: 3, spawns: [{ type: 'tgt.heavy', slot: 'stand_mid', count: [2, 4] }, { type: 'tgt.runner', slot: 'rail_far', count: 1 }] },
      {
        id: 'wave.s.yard',
        weight: 2,
        spawns: [
          { type: 'tgt.plate', slot: 'row_mid', count: [2, 4] },
          { type: 'tgt.barrel', slot: 'barrels_far', count: [2, 3] },
          { type: 'tgt.drone', slot: 'air_mid', count: [0, 1] },
        ],
      },
      { id: 'wave.s.hood', weight: 2, spawns: [{ type: 'tgt.bottle', slot: 'hood_far', count: [5, 8] }, { type: 'tgt.heavy', slot: 'stand_mid', count: [1, 2] }] },
      { id: 'wave.s.runners', weight: 2, spawns: [{ type: 'tgt.runner', slot: 'rail_mid', count: 1 }, { type: 'tgt.runner', slot: 'rail_far', count: 1 }, { type: 'tgt.barrel', slot: 'barrels_near', count: [1, 2] }] },
    ],
  };

  const dock = {
    id: 'range.dock',
    index: 4,
    name: 'Freight Dock',
    short: 'Freight Dock',
    theme: 'dock',
    tone: 'ink',
    blurb: 'A bonded warehouse at the harbor. Racks of aligned plates, shuttered targets and a gantry that fights back.',
    unlock: { cost: 30000000, requires: { challenge: 'ch.scrap.qualifier', stars: 1 } },
    hpMult: 27,
    valueMult: 450,
    eyeHeight: 1.5,
    halfWidth: 4.6,
    ceiling: 6.5,
    wallHeight: 6.5,
    backHeight: 6.5,
    backZ: 25,
    bench: { zNear: 0.9, zFar: 1.35, y: 1.05 },
    carrierY: 2.3,
    maxTargets: 18,
    rows: { near: { z: 7.5, label: '7 M' }, mid: { z: 11.5, label: '11 M' }, far: { z: 16, label: '16 M' } },
    rails: { mid: { z: 10, xMin: -3.8, xMax: 3.8 }, far: { z: 14.5, xMin: -4.0, xMax: 4.0 } },
    slots: {
      row_near: { kind: 'row', row: 'near', xMin: -3.3, xMax: 3.3 },
      row_mid: { kind: 'row', row: 'mid', xMin: -3.6, xMax: 3.6 },
      row_far: { kind: 'row', row: 'far', xMin: -3.8, xMax: 3.8 },
      crate_left: { kind: 'crate', x: -3.0, z: 7, w: 1.0, h: 0.8, d: 0.7 },
      crate_right: { kind: 'crate', x: 3.0, z: 7, w: 1.0, h: 0.8, d: 0.7 },
      rail_mid: { kind: 'rail', rail: 'mid' },
      rail_far: { kind: 'rail', rail: 'far' },
      rack_mid: { kind: 'rack', z: 9, depth: [0, 1.5, 3.0], xMin: -3.0, xMax: 3.0 },
      shutter_mid: { kind: 'shutter', z: 12.5, xMin: -3.4, xMax: 3.4 },
      barrels_near: { kind: 'barrels', z: 9.5, xMin: -3.4, xMax: 3.4 },
      stand_far: { kind: 'stand', z: 15, xMin: -3.4, xMax: 3.4 },
      air_mid: { kind: 'air', z: [9, 15], y: [2.2, 3.6], xMin: -6, xMax: 6 },
      boss_pad: { kind: 'boss', z: 13, xMin: -2.8, xMax: 2.8 },
    },
    intro: [
      { id: 'wave.d.intro_rack', spawns: [{ type: 'tgt.plate', slot: 'rack_mid', count: 2 }, { type: 'tgt.plate', slot: 'row_near', count: 2 }] },
      { id: 'wave.d.intro_shutter', spawns: [{ type: 'tgt.shutter', slot: 'shutter_mid', count: 2 }, { type: 'tgt.plate', slot: 'row_mid', count: 2 }] },
    ],
    pool: [
      { id: 'wave.d.racks', weight: 3, spawns: [{ type: 'tgt.plate', slot: 'rack_mid', count: [2, 3] }, { type: 'tgt.drone', slot: 'air_mid', count: [0, 1] }] },
      { id: 'wave.d.shutters', weight: 3, spawns: [{ type: 'tgt.shutter', slot: 'shutter_mid', count: [2, 3] }, { type: 'tgt.plate', slot: 'row_near', count: [1, 3] }] },
      {
        id: 'wave.d.freight',
        weight: 2,
        spawns: [
          { type: 'tgt.bottle', slot: ['crate_left', 'crate_right'], count: [4, 6] },
          { type: 'tgt.barrel', slot: 'barrels_near', count: [2, 3] },
          { type: 'tgt.heavy', slot: 'stand_far', count: [1, 2] },
        ],
      },
      { id: 'wave.d.patrol', weight: 2, spawns: [{ type: 'tgt.runner', slot: 'rail_mid', count: 1 }, { type: 'tgt.runner', slot: 'rail_far', count: 1 }, { type: 'tgt.plate', slot: 'row_far', count: [2, 3] }] },
      { id: 'wave.d.mixed', weight: 2, spawns: [{ type: 'tgt.plate', slot: 'rack_mid', count: 1 }, { type: 'tgt.shutter', slot: 'shutter_mid', count: 1 }, { type: 'tgt.heavy', slot: 'stand_far', count: [1, 2] }] },
    ],
  };

  const vault = {
    id: 'range.vault',
    index: 5,
    name: 'The Vault',
    short: 'The Vault',
    theme: 'vault',
    tone: 'paper',
    blurb: 'A proving tunnel under the old federal reserve. Everything you have faced, together, and the Overseer at the end.',
    unlock: { cost: 2500000000, requires: { challenge: 'ch.dock.qualifier', stars: 1 } },
    hpMult: 80,
    valueMult: 3500,
    eyeHeight: 1.5,
    halfWidth: 3.9,
    ceiling: 4.2,
    wallHeight: 4.2,
    backHeight: 4.2,
    backZ: 23,
    bench: { zNear: 0.9, zFar: 1.35, y: 1.05 },
    carrierY: 2.25,
    maxTargets: 18,
    rows: { near: { z: 7, label: '7 M' }, mid: { z: 10.5, label: '10 M' }, far: { z: 15, label: '15 M' } },
    rails: { mid: { z: 9, xMin: -3.3, xMax: 3.3 }, far: { z: 13.5, xMin: -3.4, xMax: 3.4 } },
    slots: {
      row_near: { kind: 'row', row: 'near', xMin: -2.9, xMax: 2.9 },
      row_mid: { kind: 'row', row: 'mid', xMin: -3.1, xMax: 3.1 },
      row_far: { kind: 'row', row: 'far', xMin: -3.2, xMax: 3.2 },
      rail_mid: { kind: 'rail', rail: 'mid' },
      rail_far: { kind: 'rail', rail: 'far' },
      rack_mid: { kind: 'rack', z: 8.5, depth: [0, 1.4, 2.8], xMin: -2.6, xMax: 2.6 },
      shutter_far: { kind: 'shutter', z: 14, xMin: -3.0, xMax: 3.0 },
      stand_mid: { kind: 'stand', z: 11, xMin: -3.0, xMax: 3.0 },
      barrels_near: { kind: 'barrels', z: 8, xMin: -3.0, xMax: 3.0 },
      pop_near: { kind: 'popup', z: 6.5, xMin: -2.8, xMax: 2.8 },
      pop_far: { kind: 'popup', z: 15.5, xMin: -3.1, xMax: 3.1 },
      air_mid: { kind: 'air', z: [9, 14], y: [2.0, 3.3], xMin: -5.5, xMax: 5.5 },
      boss_pad: { kind: 'boss', z: 12.5, xMin: -2.4, xMax: 2.4 },
    },
    intro: [
      {
        id: 'wave.v.intro_mix',
        spawns: [
          { type: 'tgt.plate', slot: 'row_near', count: 2 },
          { type: 'tgt.heavy', slot: 'stand_mid', count: 1 },
          { type: 'tgt.shutter', slot: 'shutter_far', count: 1 },
        ],
      },
    ],
    pool: [
      {
        id: 'wave.v.gauntlet',
        weight: 3,
        spawns: [
          { type: 'tgt.popper', slot: 'pop_near', count: [1, 2] },
          { type: 'tgt.popper', slot: 'pop_far', count: [1, 2] },
          { type: 'tgt.heavy', slot: 'stand_mid', count: [1, 2] },
        ],
      },
      { id: 'wave.v.rack', weight: 2, spawns: [{ type: 'tgt.plate', slot: 'rack_mid', count: [2, 3] }, { type: 'tgt.shutter', slot: 'shutter_far', count: 1 }] },
      { id: 'wave.v.boom', weight: 2, spawns: [{ type: 'tgt.barrel', slot: 'barrels_near', count: [2, 3] }, { type: 'tgt.plate', slot: 'row_mid', count: [2, 4] }] },
      { id: 'wave.v.hunt', weight: 2, spawns: [{ type: 'tgt.drone', slot: 'air_mid', count: [2, 3] }, { type: 'tgt.runner', slot: 'rail_far', count: 1 }] },
      { id: 'wave.v.steel', weight: 2, spawns: [{ type: 'tgt.plate', slot: ['row_near', 'row_mid', 'row_far'], count: [3, 5] }, { type: 'tgt.runner', slot: 'rail_mid', count: 1 }] },
    ],
  };

  const list = [bench, rooftop, scrapyard, dock, vault];
  const byId = {};
  for (const r of list) byId[r.id] = r;

  /** One-line captions shown the first time a target type appears. */
  const introCaptions = {
    'tgt.bottle': { title: 'Bottles', text: 'Fragile and cheap, packed in clusters.' },
    'tgt.runner': { title: 'Rail Runner', text: 'Armored and moving. Shoot the glowing core.' },
    'tgt.drone': { title: 'Drones', text: 'Bonus cash. They fly off if you ignore them.' },
    'tgt.popper': { title: 'Poppers', text: 'Up for a few seconds only, near then far.' },
    'tgt.barrel': { title: 'Barrels', text: 'Explode and break everything close by.' },
    'tgt.heavy': { title: 'Heavy Plate', text: 'Thick armor. Use hard-hitting or armor-piercing guns.' },
    'tgt.shutter': { title: 'Shutter', text: 'Armored until the window opens. Time your shot.' },
  };

  ZTA.data.ranges = ZTA.util.deepFreeze(list);
  ZTA.data.rangeById = ZTA.util.deepFreeze(byId);
  ZTA.data.introCaptions = ZTA.util.deepFreeze(introCaptions);
  ZTA.data.START_RANGE = 'range.bench01';
})(typeof window !== 'undefined' ? window : globalThis);
