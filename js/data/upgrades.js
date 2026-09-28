/*
 * Upgrade tracks. Weapon upgrade *definitions* live here; each weapon lists
 * the tracks it offers with its own step / max / cost tuning (see weapons.js).
 * Costs: cost * growth ^ level, rounded. Levels are integers in [0, max].
 *
 * Range upgrades apply to every range and every gun. They count as ordinary
 * progression, so opening a new branch (prestige) resets them.
 */
(function (root) {
  'use strict';
  const ZTA = root.ZTA;

  const weaponUpgrades = {
    'upg.damage': { id: 'upg.damage', name: 'Damage', desc: 'More damage per pellet.', show: 'dmg', breakpoints: true },
    'upg.magazine': { id: 'upg.magazine', name: 'Magazine', desc: 'More rounds before reloading.', show: 'rounds', breakpoints: false },
    'upg.reload': { id: 'upg.reload', name: 'Reload Speed', desc: 'Faster reloads.', show: 'reload', breakpoints: false },
    'upg.crit': { id: 'upg.crit', name: 'Center Punch', desc: 'Stronger weak-point hits.', show: 'mult', breakpoints: true },
    'upg.stability': { id: 'upg.stability', name: 'Stability', desc: 'Less spread bloom and muzzle climb during bursts.', show: 'bloom', breakpoints: false },
    'upg.pellets': { id: 'upg.pellets', name: 'Heavy Load', desc: 'More pellets per shell.', show: 'pellets', breakpoints: true },
    'upg.firerate': { id: 'upg.firerate', name: 'Tuned Action', desc: 'Faster cadence.', show: 'rpm', breakpoints: false },
    'upg.pierce': { id: 'upg.pierce', name: 'Hardened Tips', desc: 'Ignore more armor on body hits.', show: 'ap', breakpoints: true },
    'upg.penetration': { id: 'upg.penetration', name: 'Overpressure', desc: 'Each round passes through one more target.', show: 'pen', breakpoints: false },
    'upg.splash': { id: 'upg.splash', name: 'Bigger Charge', desc: 'Wider blast radius.', show: 'radius', breakpoints: false },
    'upg.chain': { id: 'upg.chain', name: 'Extra Coil', desc: 'Arcs jump to one more target.', show: 'chain', breakpoints: false },
  };

  const rangeUpgrades = [
    {
      id: 'rng.bounty',
      name: 'Target Bounty',
      desc: 'Every target pays more cash.',
      max: 30,
      cost: 50,
      growth: 1.62,
      effect: { key: 'cashMult', base: 1, step: 0.2 },
      show: 'mult',
    },
    {
      id: 'rng.reset',
      name: 'Quick Reset',
      desc: 'Shorter pause between waves.',
      max: 4,
      cost: 60,
      growth: 1.9,
      effect: { key: 'waveDelay', base: 1.6, step: -0.25 },
      show: 'secs',
    },
    {
      id: 'rng.weakpoint',
      name: 'Weak-Point Bounty',
      desc: 'Targets finished with a weak-point hit pay extra.',
      max: 10,
      cost: 90,
      growth: 1.9,
      effect: { key: 'weakBreakBonus', base: 0, step: 0.25 },
      show: 'bonus',
    },
    {
      id: 'rng.wavebonus',
      name: 'Clean Sheet',
      desc: 'Bigger wave-clear bonus.',
      max: 8,
      cost: 120,
      growth: 2.1,
      effect: { key: 'waveBonus', base: 0.25, step: 0.1 },
      show: 'share',
    },
    {
      id: 'rng.stands',
      name: 'Extra Stands',
      desc: 'One more target in every practice wave.',
      max: 4,
      cost: 160,
      growth: 2.6,
      effect: { key: 'extraTargets', base: 0, step: 1 },
      show: 'targets',
    },
  ];

  const rangeById = {};
  for (const u of rangeUpgrades) rangeById[u.id] = u;

  ZTA.data.weaponUpgrades = ZTA.util.deepFreeze(weaponUpgrades);
  ZTA.data.rangeUpgrades = ZTA.util.deepFreeze(rangeUpgrades);
  ZTA.data.rangeUpgradeById = ZTA.util.deepFreeze(rangeById);
})(typeof window !== 'undefined' ? window : globalThis);
