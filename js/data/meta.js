/*
 * Long-term progression configuration: mastery, finishes, the Workshop
 * (Blueprint Token upgrades), training lanes (automation), collection
 * milestones, prestige charters and challenge modifiers.
 *
 * Two currencies only: Cash and Blueprint Tokens. Blueprint Tokens come from
 * challenge stars, mastery, objectives, milestones and modifier clears; never
 * from waiting.
 */
(function (root) {
  'use strict';
  const ZTA = root.ZTA;

  /* Mastery: a short track per gun, earned by using it. */
  const mastery = {
    levels: [
      { xp: 40, reward: { cashPct: 0.01 }, label: '+1% cash from every target, with any gun' },
      { xp: 120, reward: { finish: 'fin.brushed' }, label: 'Brushed steel finish' },
      { xp: 280, reward: { perkLevel: 1 }, label: 'Signature perk improved' },
      { xp: 560, reward: { cashPct: 0.02, finish: 'fin.halftone' }, label: '+2% cash and a halftone finish' },
      { xp: 1000, reward: { finish: 'fin.brass', blueprints: 2 }, label: 'Brass finish and 2 Blueprint Tokens' },
    ],
    xp: { break: 1, weakBreak: 1, bossPart: 5, challenge: 25 },
  };

  /*
   * Optional mastery objectives, one per gun, matched to its perk so the
   * objective always plays to the gun's strength.
   */
  const objectives = {
    'perk.center_streak': { metric: 'streakMax', goal: 12, text: 'Reach a full center streak 12 times' },
    'perk.hot_hands': { metric: 'comboMax', goal: 10, text: 'Reach the ×2.5 combo cap 10 times' },
    'perk.multi_break': { metric: 'multiBreaks', goal: 25, text: 'Break 2+ targets with one shot 25 times' },
    'perk.final_chamber': { metric: 'finalBreaks', goal: 25, text: 'Break 25 targets with the final round' },
    'perk.quick_draw': { metric: 'primedBreaks', goal: 25, text: 'Break 25 targets with a primed first shot' },
    'perk.ricochet': { metric: 'ricochetBreaks', goal: 20, text: 'Break 20 targets with ricochets' },
    'perk.mover_hunter': { metric: 'movingBreaks', goal: 40, text: 'Break 40 moving targets' },
    'perk.drone_hunter': { metric: 'droneBreaks', goal: 40, text: 'Break 40 drones' },
    'perk.last_gasp': { metric: 'gaspBreaks', goal: 40, text: 'Break 40 targets in the back third of a magazine' },
    'perk.through_through': { metric: 'pierceBreaks', goal: 30, text: 'Break 30 targets with penetrating rounds' },
    'perk.armor_breaker': { metric: 'armorBreaks', goal: 40, text: 'Break 40 armored targets' },
    'perk.steady_aim': { metric: 'weakBreaks', goal: 60, text: 'Finish 60 targets with weak-point hits' },
    'perk.execution': { metric: 'executions', goal: 30, text: 'One-shot 30 untouched targets' },
    'perk.burst_precision': { metric: 'fullBursts', goal: 60, text: 'Land 60 complete bursts' },
    'perk.tempo': { metric: 'tempoMax', goal: 15, text: 'Reach full tempo 15 times' },
    'perk.sustained': { metric: 'sustainMax', goal: 15, text: 'Reach the full sustained-fire bonus 15 times' },
    'perk.shockwave': { metric: 'multiBreaks', goal: 25, text: 'Break 2+ targets with one blast 25 times' },
    'perk.chain_arc': { metric: 'arcBreaks', goal: 30, text: 'Break 30 targets with arcs' },
    'perk.needle_stack': { metric: 'needleBursts', goal: 30, text: 'Trigger 30 needle bursts' },
    'perk.spin_up': { metric: 'breaks', goal: 300, text: 'Break 300 targets' },
    default: { metric: 'breaks', goal: 150, text: 'Break 150 targets' },
  };

  /* Cosmetic finishes (never stats). */
  const finishes = [
    { id: 'fin.factory', name: 'Factory', desc: 'As it left the line.' },
    { id: 'fin.brushed', name: 'Brushed Steel', desc: 'Fine horizontal grain. Mastery level 2.' },
    { id: 'fin.halftone', name: 'Halftone', desc: 'Printed-dot shading. Mastery level 4.' },
    { id: 'fin.tiger', name: 'Tiger Stripe', desc: 'Bold ink stripes. Collection milestone.' },
    { id: 'fin.brass', name: 'Brass Inlay', desc: 'Brass trim for a mastered gun. Mastery level 5.' },
  ];

  /* Workshop: permanent upgrades bought with Blueprint Tokens. Kept through prestige. */
  const workshop = [
    { id: 'ws.damage', name: 'Ink-Cut Tooling', desc: 'More damage for every gun.', max: 5, costs: [1, 2, 3, 4, 5], effect: { key: 'damageMult', step: 0.1 }, show: 'pct' },
    { id: 'ws.cash', name: 'Deep Pockets', desc: 'More cash from every target.', max: 5, costs: [1, 2, 3, 4, 6], effect: { key: 'cashPct', step: 0.15 }, show: 'pct' },
    { id: 'ws.reload', name: 'Speed Loaders', desc: 'Faster reloads for every gun.', max: 3, costs: [2, 3, 5], effect: { key: 'reloadMult', step: -0.06 }, show: 'pctDown' },
    { id: 'ws.combo', name: 'Warm Hands', desc: 'Every wave and round starts with combo already built.', max: 3, costs: [2, 3, 4], effect: { key: 'startCombo', step: 2 }, show: 'steps' },
    { id: 'ws.mastery', name: 'Gunsmith Notes', desc: 'More mastery XP.', max: 3, costs: [1, 2, 3], effect: { key: 'masteryMult', step: 0.25 }, show: 'pct' },
    { id: 'ws.lanes', name: 'Night Shift', desc: 'Training lanes produce more.', max: 4, costs: [2, 3, 4, 5], effect: { key: 'lanePct', step: 0.25 }, show: 'pct' },
    { id: 'ws.offline', name: 'Long Hours', desc: 'Lanes store more while you are away.', max: 3, costs: [2, 3, 4], effect: { key: 'offlineHours', step: 2 }, show: 'hours' },
    { id: 'ws.assistant', name: 'Range Assistant', desc: 'Collects lane cash for you every 30 seconds.', max: 1, costs: [3], effect: { key: 'autoCollect', step: 1 }, show: 'on' },
    { id: 'ws.lane5', name: 'Fifth Lane', desc: 'One more training lane.', max: 1, costs: [5], effect: { key: 'laneSlots', step: 1 }, show: 'count' },
    { id: 'ws.perkcap', name: 'Prototype Bench', desc: 'Signature perks can be improved one step further.', max: 1, costs: [6], effect: { key: 'perkCap', step: 1 }, show: 'count' },
  ];

  /* Signature perk improvements bought with Blueprint Tokens (per gun). */
  const perkUpgrade = { costs: [2, 4, 6], baseCap: 2, stepPerLevel: 0.3 };

  /*
   * Training lanes: automation. Each lane trains one owned gun and produces
   * capped passive cash. Active shooting stays far faster.
   */
  const lanes = {
    requiresRange: 'range.rooftop',
    unlockCosts: [15000, 90000, 900000, 12000000],
    efficiency: 0.1,
    baseOfflineHours: 4,
    assistantInterval: 30,
    maxOfflineDays: 30,
  };

  /* Collection milestones: owning N guns grants a permanent reward once. */
  const milestones = [
    { id: 'ms.3', count: 3, reward: { cashPct: 0.05 }, label: '+5% cash' },
    { id: 'ms.6', count: 6, reward: { blueprints: 1 }, label: '1 Blueprint Token' },
    { id: 'ms.10', count: 10, reward: { cashPct: 0.05, finish: 'fin.tiger' }, label: '+5% cash and Tiger Stripe for every gun' },
    { id: 'ms.15', count: 15, reward: { blueprints: 2 }, label: '2 Blueprint Tokens' },
    { id: 'ms.20', count: 20, reward: { cashPct: 0.1 }, label: '+10% cash' },
    { id: 'ms.25', count: 25, reward: { blueprints: 3 }, label: '3 Blueprint Tokens' },
    { id: 'ms.30', count: 30, reward: { cashPct: 0.1, damagePct: 0.1 }, label: '+10% cash and +10% damage' },
    { id: 'ms.40', count: 40, reward: { blueprints: 5, cashPct: 0.2 }, label: '5 Blueprint Tokens and +20% cash' },
  ];

  /*
   * Prestige: "Open a New Branch". Unlocked by beating the Scrap Crusher.
   * Each branch adds a permanent cash bonus, lets you pick one charter and
   * unlocks one optional challenge modifier.
   */
  const prestige = {
    unlock: { challenge: 'ch.scrap.boss', stars: 1 },
    cashPerBranch: 0.25,
    resets: ['Cash', 'Range unlocks (back to Bench Lane)', 'Range upgrades', 'Weapon upgrade levels', 'Training lanes and their stored cash', 'Practice wave counters'],
    keeps: ['Every gun you own', 'Mastery, finishes and perk improvements', 'Blueprint Tokens and Workshop upgrades', 'Challenge stars and best scores', 'Collection milestones', 'Settings, favorites and stats'],
    charters: [
      { id: 'cht.contract', name: 'Contract Work', desc: '+50% cash from every target.', effect: { cashPct: 0.5 } },
      { id: 'cht.forge', name: 'Forge Line', desc: '+30% damage for every gun.', effect: { damagePct: 0.3 } },
      { id: 'cht.headstart', name: 'Head Start', desc: 'Each new branch starts with $8,000 and Rooftop 9 unlocked.', effect: { startCash: 8000, startRange: 'range.rooftop' } },
      { id: 'cht.nightshift', name: 'Night Shift Crew', desc: 'Training lanes produce twice as much.', effect: { lanePct: 1 } },
      { id: 'cht.guild', name: 'Armorer Guild', desc: '+50% mastery XP.', effect: { masteryPct: 0.5 } },
      { id: 'cht.wholesale', name: 'Wholesale', desc: 'Weapon upgrades cost 25% less.', effect: { upgradeDiscount: 0.25 } },
      { id: 'cht.showman', name: 'Showman', desc: 'Combo cap rises from ×2.5 to ×3.0.', effect: { comboSteps: 5 } },
      { id: 'cht.bounty', name: 'Bounty Board', desc: 'Challenge cash rewards are doubled.', effect: { challengeCashPct: 1 } },
    ],
  };

  /* Optional challenge modifiers, unlocked one per branch. */
  const modifiers = [
    { id: 'mod.hardsteel', name: 'Hard Steel', desc: 'Targets have 60% more health.', branch: 1, rewardMult: 2, hpMult: 1.6 },
    { id: 'mod.shortfuse', name: 'Short Fuse', desc: 'A quarter less time on the clock.', branch: 2, rewardMult: 2, timeMult: 0.75 },
    { id: 'mod.glassjaw', name: 'Glass Jaw', desc: 'Every miss costs two seconds.', branch: 3, rewardMult: 2, missPenalty: 2 },
    { id: 'mod.moving', name: 'Moving Day', desc: 'Hanging plates sway side to side.', branch: 4, rewardMult: 2, sway: true },
  ];

  ZTA.data.meta = ZTA.util.deepFreeze({ mastery, objectives, finishes, workshop, perkUpgrade, lanes, milestones, prestige, modifiers });
})(typeof window !== 'undefined' ? window : globalThis);
