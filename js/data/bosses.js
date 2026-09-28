/*
 * Mechanical bosses: a moving frame carrying several breakable sections.
 * Each section is its own pooled target (so it pays exactly once). The core
 * sits just behind the chest plate, so it can only be hit once the plate is
 * gone (or by penetrating rounds). Breaking the core ends the fight.
 *
 * Section fields are at Bench Lane scale; the range's hpMult and valueMult
 * apply. Offsets are meters from the boss origin (center, on the floor).
 *   shape: 'rect' (w, h) or 'circle' (r)
 *   timed: weak window cycles open/closed (sensor)
 *   behind: the core sits behind this section
 */
(function (root) {
  'use strict';
  const ZTA = root.ZTA;

  const panel = (id, x, y, w, h, hp, armor, value) => ({ id, type: 'tgt.boss.panel', shape: 'rect', x, y, w, h, hp, armor, value });
  const chest = (x, y, w, h, hp, armor, value) => ({ id: 'chest', type: 'tgt.boss.plate', shape: 'rect', x, y, w, h, hp, armor, value });
  const core = (x, y, r, hp, value) => ({ id: 'core', type: 'tgt.boss.core', shape: 'circle', x, y, r, hp, armor: 0, value, behind: 'chest', final: true });
  const sensor = (x, y, r, hp, value) => ({ id: 'sensor', type: 'tgt.boss.sensor', shape: 'circle', x, y, r, hp, armor: 0, value, timed: true });

  const bosses = [
    {
      id: 'boss.rig',
      name: 'Target Rig Mk I',
      style: 'rig',
      body: { w: 1.25, h: 1.75, base: 0.42 },
      speed: 0.7,
      enrage: { after: 2, speed: 1.35 },
      parts: [
        panel('armL', -0.74, 1.12, 0.34, 0.62, 150, 3, 12),
        panel('armR', 0.74, 1.12, 0.34, 0.62, 150, 3, 12),
        chest(0, 1.1, 0.62, 0.56, 260, 4, 20),
        core(0, 1.1, 0.14, 220, 80),
        sensor(0, 1.88, 0.11, 60, 25),
      ],
    },
    {
      id: 'boss.sentry',
      name: 'Skylight Sentry',
      style: 'sentry',
      body: { w: 1.1, h: 2.3, base: 0.5 },
      speed: 0.9,
      enrage: { after: 2, speed: 1.6 },
      parts: [
        panel('shieldL', -0.66, 1.2, 0.32, 0.8, 170, 4, 14),
        panel('shieldR', 0.66, 1.2, 0.32, 0.8, 170, 4, 14),
        chest(0, 1.25, 0.6, 0.6, 300, 5, 22),
        core(0, 1.25, 0.14, 240, 90),
        sensor(0, 2.3, 0.15, 70, 30),
      ],
    },
    {
      id: 'boss.crusher',
      name: 'Scrap Crusher',
      style: 'crusher',
      body: { w: 1.7, h: 1.7, base: 0.5 },
      speed: 0.6,
      enrage: { after: 2, speed: 1.2 },
      parts: [
        panel('clawL', -1.05, 0.95, 0.42, 0.7, 220, 8, 16),
        panel('clawR', 1.05, 0.95, 0.42, 0.7, 220, 8, 16),
        panel('exhaust', 0.5, 1.72, 0.3, 0.34, 120, 2, 12),
        chest(0, 1.12, 0.74, 0.6, 360, 9, 26),
        core(0, 1.12, 0.15, 280, 100),
        sensor(-0.35, 1.72, 0.12, 80, 30),
      ],
    },
    {
      id: 'boss.gantry',
      name: 'Gantry',
      style: 'gantry',
      body: { w: 1.6, h: 1.5, base: 1.0 },
      speed: 1.0,
      enrage: { after: 3, speed: 1.7 },
      parts: [
        panel('panelL1', -0.95, 1.9, 0.3, 0.45, 150, 6, 12),
        panel('panelR1', 0.95, 1.9, 0.3, 0.45, 150, 6, 12),
        panel('panelL2', -0.95, 1.35, 0.3, 0.45, 150, 6, 12),
        panel('panelR2', 0.95, 1.35, 0.3, 0.45, 150, 6, 12),
        chest(0, 1.62, 0.66, 0.6, 360, 10, 26),
        core(0, 1.62, 0.15, 300, 110),
        sensor(0, 1.06, 0.12, 80, 30),
      ],
    },
    {
      id: 'boss.overseer',
      name: 'The Overseer',
      style: 'overseer',
      body: { w: 1.8, h: 2.3, base: 0.55 },
      speed: 0.8,
      enrage: { after: 3, speed: 1.5 },
      parts: [
        panel('shoulderL', -0.95, 1.95, 0.4, 0.36, 180, 8, 14),
        panel('shoulderR', 0.95, 1.95, 0.4, 0.36, 180, 8, 14),
        panel('armL', -1.0, 1.25, 0.34, 0.66, 200, 8, 14),
        panel('armR', 1.0, 1.25, 0.34, 0.66, 200, 8, 14),
        chest(0, 1.4, 0.76, 0.72, 420, 11, 30),
        core(0, 1.4, 0.16, 360, 130),
        sensor(0, 2.32, 0.14, 90, 35),
      ],
    },
  ];

  const byId = {};
  for (const b of bosses) byId[b.id] = b;

  ZTA.data.bosses = ZTA.util.deepFreeze(bosses);
  ZTA.data.bossById = ZTA.util.deepFreeze(byId);
})(typeof window !== 'undefined' ? window : globalThis);
