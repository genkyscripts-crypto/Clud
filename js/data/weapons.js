/*
 * Weapon catalog. Each entry is pure data; behavior differences come from the
 * numbers, the reload style, the audio profile, the parametric model and one
 * signature perk (a reusable behavior looked up by id in systems/perks.js).
 *
 * IDs are permanent save keys: never rename or reuse one. Display names,
 * manufacturers and blurbs can change freely.
 *
 * Field reference
 *   fire.mode        'semi' | 'auto' | 'pump'. Holding the trigger repeats at rpm for all modes.
 *   fire.rpm         cadence cap in rounds per minute.
 *   fire.pellets     projectiles per shot (hitscan rays).
 *   fire.spread      base cone radius in degrees.
 *   fire.bloom*      extra spread per shot, its cap, recovery (deg/s) and the delay before recovery.
 *   damage           per pellet, before armor / falloff / crits.
 *   critMult         multiplier on weak-point hits.
 *   penetration      extra targets a ray may pass through (penetrationFalloff per target).
 *   armorPierce      armor points ignored on body hits.
 *   falloff          { start, end, min } meters → damage multiplier (null = none).
 *   reload           { style: 'magazine', time } or { style: 'shell', start, perShell, end }.
 *   recoil           kick = view pitch (deg) per shot, kickX = random yaw (deg), recovery = return rate,
 *                    gunKick / gunRot = viewmodel motion, shake = screen-shake trauma per shot.
 *   upgrades         which upgrade tracks this gun offers and their per-gun tuning.
 */
(function (root) {
  'use strict';
  const ZTA = root.ZTA;

  const families = {
    pistol: { id: 'pistol', label: 'Pistol', plural: 'Pistols', order: 1 },
    revolver: { id: 'revolver', label: 'Revolver', plural: 'Revolvers', order: 2 },
    smg: { id: 'smg', label: 'SMG', plural: 'SMGs', order: 3 },
    rifle: { id: 'rifle', label: 'Rifle', plural: 'Rifles & Carbines', order: 4 },
    shotgun: { id: 'shotgun', label: 'Shotgun', plural: 'Shotguns', order: 5 },
    marksman: { id: 'marksman', label: 'Marksman', plural: 'Marksman & Sniper', order: 6 },
    heavy: { id: 'heavy', label: 'Heavy', plural: 'LMGs & Experimental', order: 7 },
  };

  const weapons = [
    {
      id: 'gun.kestrel_p9',
      name: 'P9 Standard',
      manufacturer: 'Kestrel Arms',
      family: 'pistol',
      caliber: '9×19',
      tier: 1,
      unlockCost: 0,
      inspiration: 'Polymer striker-fired service pistol',
      blurb: 'A plain, honest service pistol. Keep putting rounds through the painted center and it hits harder.',
      strength: 'Pinpoint accuracy and quick recovery. Weak-point streaks stack damage.',
      tradeoff: 'Modest damage per shot. Armor soaks its body hits.',
      fire: { mode: 'semi', rpm: 300, pellets: 1, spread: 0.16, bloomPerShot: 0.12, bloomMax: 0.6, bloomRecovery: 4.5, bloomDelay: 0.12 },
      damage: 10,
      critMult: 2.0,
      penetration: 0,
      penetrationFalloff: 0.6,
      armorPierce: 0,
      falloff: null,
      magazine: 15,
      reload: { style: 'magazine', time: 1.05 },
      drawTime: 0.24,
      recoil: { kick: 0.5, kickX: 0.1, recovery: 12, gunKick: 1.0, gunRot: 0.32, shake: 0.12 },
      audio: 'pistol',
      model: {
        builder: 'pistol',
        params: { slideLen: 1.0, slideH: 1.0, gripAngle: 0.2, serrations: 6, guard: 'square', comp: false, hammer: false },
      },
      perk: { id: 'perk.center_streak', params: { perStack: 0.12, maxStacks: 5 } },
      upgrades: [
        { id: 'upg.damage', step: 0.25, max: 10, cost: 20, growth: 1.55 },
        { id: 'upg.magazine', step: 3, max: 5, cost: 24, growth: 1.6 },
        { id: 'upg.reload', step: 0.1, max: 5, cost: 26, growth: 1.6 },
        { id: 'upg.crit', step: 0.25, max: 4, cost: 70, growth: 1.8 },
      ],
    },
    {
      id: 'gun.hornet_k',
      name: 'Hornet K',
      manufacturer: 'Vespa Defense',
      family: 'smg',
      caliber: '9×19',
      tier: 1,
      unlockCost: 500,
      inspiration: 'Compact grip-fed machine pistol',
      blurb: 'A buzzing little bullet hose. Every hit feeds the combo meter faster than anything else on the bench.',
      strength: 'High cadence and fast combo gain. Clears bottles and fast movers.',
      tradeoff: 'Tiny per-hit damage: armor cuts it to a quarter. Spread blooms on long bursts.',
      fire: { mode: 'auto', rpm: 780, pellets: 1, spread: 0.7, bloomPerShot: 0.17, bloomMax: 2.6, bloomRecovery: 5.0, bloomDelay: 0.14 },
      damage: 4,
      critMult: 1.5,
      penetration: 0,
      penetrationFalloff: 0.6,
      armorPierce: 0,
      falloff: null,
      magazine: 32,
      reload: { style: 'magazine', time: 1.7 },
      drawTime: 0.28,
      recoil: { kick: 0.16, kickX: 0.14, recovery: 4.5, gunKick: 0.45, gunRot: 0.12, shake: 0.045 },
      audio: 'smg',
      model: {
        builder: 'smg',
        params: { bodyLen: 1.0, barrelLen: 0.7, magStyle: 'grip', stock: 'stub', shroud: true, foregrip: false },
      },
      perk: { id: 'perk.hot_hands', params: { comboGain: 1.5 } },
      upgrades: [
        { id: 'upg.damage', step: 0.25, max: 10, cost: 45, growth: 1.55 },
        { id: 'upg.magazine', step: 8, max: 5, cost: 40, growth: 1.6 },
        { id: 'upg.reload', step: 0.1, max: 5, cost: 40, growth: 1.6 },
        { id: 'upg.stability', step: 0.18, max: 4, cost: 90, growth: 1.8 },
      ],
    },
    {
      id: 'gun.brute_12',
      name: 'Brute 12',
      manufacturer: 'Halden & Rook',
      family: 'shotgun',
      caliber: '12 GA',
      tier: 1,
      unlockCost: 1500,
      inspiration: 'Steel-receiver pump-action shotgun',
      blurb: 'Loads one shell at a time and argues with anything close. Breaking several targets with one shell pays a bounty.',
      strength: 'Wipes out clusters. One-shots near plates. Multi-breaks pay extra.',
      tradeoff: 'Slow pump cadence, shell-by-shell reload, weak past ten meters.',
      fire: { mode: 'pump', rpm: 75, pellets: 8, spread: 3.2, bloomPerShot: 0, bloomMax: 0, bloomRecovery: 0, bloomDelay: 0 },
      damage: 5,
      critMult: 1.5,
      penetration: 0,
      penetrationFalloff: 0.6,
      armorPierce: 0,
      falloff: { start: 8, end: 18, min: 0.45 },
      magazine: 6,
      reload: { style: 'shell', start: 0.28, perShell: 0.42, end: 0.3 },
      drawTime: 0.36,
      recoil: { kick: 2.1, kickX: 0.35, recovery: 6.5, gunKick: 1.7, gunRot: 0.6, shake: 0.34 },
      audio: 'shotgun',
      model: {
        builder: 'shotgun',
        params: { barrelLen: 1.0, tubeLen: 0.85, stock: 'full', pumpLen: 1.0, heatShield: false },
      },
      perk: { id: 'perk.multi_break', params: { bonusPerExtra: 0.5 } },
      upgrades: [
        { id: 'upg.damage', step: 0.25, max: 10, cost: 120, growth: 1.55 },
        { id: 'upg.magazine', step: 1, max: 4, cost: 110, growth: 1.7 },
        { id: 'upg.reload', step: 0.1, max: 5, cost: 100, growth: 1.6 },
        { id: 'upg.pellets', step: 1, max: 4, cost: 220, growth: 1.9 },
      ],
    },
  ];

  const byId = {};
  for (const w of weapons) byId[w.id] = w;

  ZTA.data.STARTER_WEAPON = 'gun.kestrel_p9';
  ZTA.data.families = ZTA.util.deepFreeze(families);
  ZTA.data.weapons = ZTA.util.deepFreeze(weapons);
  ZTA.data.weaponById = ZTA.util.deepFreeze(byId);
})(typeof window !== 'undefined' ? window : globalThis);
