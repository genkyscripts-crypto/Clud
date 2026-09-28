/*
 * Upgrade tracks. Weapon upgrade *definitions* live here; each weapon lists the
 * tracks it offers with its own step / max / cost tuning (see weapons.js).
 *
 * op:
 *   'basePct'   stat = base * (1 + step * level)
 *   'add'       stat = base + step * level
 *   'mulDown'   stat = base * (1 - step) ^ level      (reload time, bloom)
 *
 * Costs: cost * growth ^ level, rounded. Levels are integers in [0, max].
 */
(function (root) {
  'use strict';
  const ZTA = root.ZTA;

  const weaponUpgrades = {
    'upg.damage': {
      id: 'upg.damage',
      name: 'Damage',
      desc: 'More damage per pellet.',
      stat: 'damage',
      op: 'basePct',
      show: 'dmg',
      breakpoints: true,
    },
    'upg.magazine': {
      id: 'upg.magazine',
      name: 'Magazine',
      desc: 'More rounds before reloading.',
      stat: 'magazine',
      op: 'add',
      show: 'rounds',
      breakpoints: false,
    },
    'upg.reload': {
      id: 'upg.reload',
      name: 'Reload Speed',
      desc: 'Faster reloads.',
      stat: 'reload',
      op: 'mulDown',
      show: 'reload',
      breakpoints: false,
    },
    'upg.crit': {
      id: 'upg.crit',
      name: 'Center Punch',
      desc: 'Stronger weak-point hits.',
      stat: 'critMult',
      op: 'add',
      show: 'mult',
      breakpoints: true,
    },
    'upg.stability': {
      id: 'upg.stability',
      name: 'Stability',
      desc: 'Less spread bloom and muzzle climb during bursts.',
      stat: 'stability',
      op: 'mulDown',
      show: 'bloom',
      breakpoints: false,
    },
    'upg.pellets': {
      id: 'upg.pellets',
      name: 'Heavy Load',
      desc: 'More pellets per shell.',
      stat: 'pellets',
      op: 'add',
      show: 'pellets',
      breakpoints: true,
    },
  };

  /*
   * Range upgrades change the range itself, for every gun.
   * effect.key is read by Progression.rangeModifiers().
   */
  const rangeUpgrades = [
    {
      id: 'rng.bounty',
      name: 'Target Bounty',
      desc: 'Every target pays more cash.',
      max: 10,
      cost: 50,
      growth: 1.7,
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
      max: 5,
      cost: 90,
      growth: 1.75,
      effect: { key: 'weakBreakBonus', base: 0, step: 0.25 },
      show: 'bonus',
    },
    {
      id: 'rng.stands',
      name: 'Extra Stands',
      desc: 'One more target in every wave.',
      max: 4,
      cost: 160,
      growth: 2.2,
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
