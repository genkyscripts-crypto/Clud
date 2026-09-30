/*
 * Authored content definitions. Every entry has a stable ID; save data refers
 * to content only by these IDs. All numbers are first-pass tuning values.
 *
 * Only content that is actually implemented lives here. The full-release
 * catalog (24 weapons, 64 perks, 128 recipes…) is tracked in README.md; it is
 * deliberately not stubbed in as names without behavior.
 */
(function (root) {
  'use strict';
  const HE = root.HE;
  const D = HE.data;

  /* ------------------------------------------------------------ tuning */

  D.TUNING = {
    view: { w: 1360, h: 820 },
    arena: { x: 40, y: 66, w: 1280, h: 680 },
    player: {
      maxHp: 100,
      speed: 270,
      precisionMult: 0.45,
      hitRadius: 5,
      bodyRadius: 14,
      dashCharges: 2,
      dashRecharge: 3.0,
      dashTime: 0.17,
      dashSpeed: 900,
      dashIframes: 0.18,
      hurtProtect: 0.6,
      grazeRadius: 22,
      pickupRadius: 34,
      magnetRadius: 110,
    },
    slots: {
      baseCost: 100,
      holdCost: 25,
      maxHolds: 1,
      animTime: 0.6,
      chargePerPrimaryDamage: 0.1,
      chargePerKill: 3,
      chargePerEliteKill: 10,
      chargePerGraze: 2,
      grazeChargePerSecondCap: 12,
      jackpotDuration: 10,
      jackpotRefresh: 5,
      jackpotMaxContinuous: 20,
      jackpotCooldown: 8,
    },
    procs: {
      /** Chance/intensity multiplier for effects triggered by secondary hits. */
      secondaryCoef: 0.25,
      /** Maximum additional chain depth below an originating attack. */
      maxDepth: 2,
      /** Emitted secondary effects per originating attack. */
      budget: 24,
      jackpotBudget: 64,
    },
    economy: {
      deathRecovery: 0.25,
      pressStep: 0.25,
      pressCap: 3,
      roomClearBonusPerFloor: 8,
    },
    status: {
      freezeTime: 1.2,
      eliteFreezeTime: 0.6,
      eliteFreezeImmunity: 3,
      chillDecayPerSecond: 12,
      maxChillSlow: 0.45,
      burnTick: 0.25,
    },
    boss: {
      staggerMax: 100,
      staggerTime: 1.6,
      staggerImmunity: 6,
      staggerDamageTaken: 1.25,
    },
  };

  /* ------------------------------------------------------- slot symbols */

  D.symbols = [
    {
      id: 'bullet',
      name: 'Bullet',
      color: '#f1ece0',
      single: 'Directed burst of 6 rounds toward your aim.',
      pair: 'Burst of 12 rounds that pierce 3 targets.',
      triple: 'BULLET STORM — 3 s of rotating radial volleys.',
    },
    {
      id: 'bolt',
      name: 'Bolt',
      color: '#35e38a',
      single: 'Chain strike hits the 3 nearest enemies.',
      pair: 'Chain strike hits the 6 nearest enemies, twice.',
      triple: 'THUNDERHEAD — 2.5 s of strikes across the arena.',
    },
    {
      id: 'bell',
      name: 'Bell',
      color: '#9fd8ff',
      single: 'Protective pulse clears hostile bullets near you.',
      pair: 'Wider pulse and a one-hit shield.',
      triple: 'BELL DOME — 3 s bullet-clearing aura and a one-hit shield.',
    },
    {
      id: 'crown',
      name: 'Crown',
      color: '#f2c14e',
      single: 'Precision window: primary hits deal +50% for 4 s.',
      pair: 'Precision window: +80% for 6 s.',
      triple: "KING'S RANSOM — 6 s: +100% and every primary shot pierces 2.",
    },
    {
      id: 'skull',
      name: 'Skull',
      color: '#e8424c',
      single: 'Explosion at your aim point.',
      pair: 'Three explosions marching along your aim.',
      triple: "DEAD MAN'S HAND — 9 explosions carpet the aim area.",
    },
    {
      id: 'seven',
      name: 'Seven',
      color: '#ff5a3d',
      single: 'Overdrive: +50% fire rate for 3 s.',
      pair: 'Overdrive: +80% fire rate and instant reloads for 5 s.',
      triple: 'JACKPOT — 10 s gold weapon transformation.',
    },
  ];
  D.symbolIds = D.symbols.map((s) => s.id);
  D.symbolById = {};
  for (const s of D.symbols) D.symbolById[s.id] = s;

  /* ------------------------------------------------------------ weapons */

  D.weapons = [
    {
      id: 'W01',
      name: 'Rusted Ace',
      category: 'weapon',
      rarity: 'starter',
      unlock: 'default',
      tags: ['revolver', 'precision', 'projectile'],
      description: 'Accurate six-shot revolver. The sixth round is a heavy weak-point shot.',
      params: {
        damage: 11,
        fireInterval: 0.2,
        magazine: 6,
        reloadTime: 1.05,
        speed: 1150,
        range: 900,
        radius: 5,
        spread: 0.025,
        finalRoundMult: 2.4,
        finalRoundRadius: 8,
      },
      assets: { sprite: 'procedural:revolver', sound: 'shot.revolver' },
      mastery: 'Not in this build.',
    },
  ];
  D.weaponById = {};
  for (const w of D.weapons) D.weaponById[w.id] = w;

  /* -------------------------------------------------------------- perks */

  /**
   * Each rank lists its full parameter set (not deltas) so rank behavior is
   * explicit and machine-readable.
   */
  D.perks = [
    {
      id: 'P01',
      name: 'Ricochet',
      category: 'perk',
      family: 'ballistics',
      rarity: 'common',
      unlock: 'default',
      tags: ['projectile', 'wall', 'behavior'],
      trigger: 'primary projectile touches a wall or pillar',
      procCoef: 1,
      maxRank: 3,
      ranks: [{ bounces: 2, bounceBonus: 0 }, { bounces: 3, bounceBonus: 0 }, { bounces: 3, bounceBonus: 0.15 }],
      desc: [
        'Primary shots bounce off walls and pillars twice.',
        'Primary shots bounce 3 times.',
        'Bounce 3 times; each bounce adds +15% damage.',
      ],
      assets: { icon: 'ricochet' },
    },
    {
      id: 'P02',
      name: 'Split Shot',
      category: 'perk',
      family: 'ballistics',
      rarity: 'common',
      unlock: 'default',
      tags: ['projectile', 'on-hit', 'behavior'],
      trigger: 'first enemy hit of a primary projectile',
      procCoef: 1,
      maxRank: 3,
      ranks: [
        { fragments: 2, frac: 0.4, angle: 0.5 },
        { fragments: 2, frac: 0.55, angle: 0.5 },
        { fragments: 3, frac: 0.5, angle: 0.55 },
      ],
      desc: [
        'On its first hit, a primary shot splits into 2 fragments (40% damage).',
        'Fragments deal 55% damage.',
        'Split into 3 fragments (50% damage).',
      ],
      assets: { icon: 'split' },
    },
    {
      id: 'P04',
      name: 'Orbitals',
      category: 'perk',
      family: 'orbital',
      rarity: 'common',
      unlock: 'default',
      tags: ['orbital', 'contact', 'secondary'],
      trigger: 'orbital touches an enemy (per-enemy cooldown 0.35 s)',
      procCoef: 0.25,
      maxRank: 3,
      ranks: [
        { count: 3, damage: 7, radius: 54, speed: 3.2 },
        { count: 4, damage: 8, radius: 58, speed: 3.4 },
        { count: 5, damage: 10, radius: 62, speed: 3.6 },
      ],
      desc: ['Three small allied projectiles circle you (7 damage on contact).', 'Four orbitals, 8 damage.', 'Five orbitals, 10 damage.'],
      assets: { icon: 'orbitals' },
    },
    {
      id: 'P05',
      name: 'Returnshot',
      category: 'perk',
      family: 'ballistics',
      rarity: 'common',
      unlock: 'default',
      tags: ['projectile', 'return', 'behavior'],
      trigger: 'primary projectile reaches its travel limit',
      procCoef: 1,
      maxRank: 3,
      ranks: [
        { returnMult: 1, travel: 440, pierceOnReturn: 0 },
        { returnMult: 1.3, travel: 440, pierceOnReturn: 0 },
        { returnMult: 1.3, travel: 440, pierceOnReturn: 3 },
      ],
      desc: [
        'Primary shots return to you after reaching their travel limit and can hit again.',
        'Returning shots deal +30% damage.',
        'Returning shots also pierce 3 targets.',
      ],
      assets: { icon: 'return' },
    },
    {
      id: 'P09',
      name: 'Fire',
      category: 'perk',
      family: 'elemental',
      rarity: 'common',
      unlock: 'default',
      tags: ['elemental', 'fire', 'on-hit', 'dot'],
      trigger: 'qualifying hit (primary always; secondary at proc coefficient)',
      procCoef: 1,
      maxRank: 3,
      ranks: [
        { dps: 4, duration: 3, cap: 3 },
        { dps: 4, duration: 3, cap: 5 },
        { dps: 6, duration: 3.5, cap: 5 },
      ],
      desc: [
        'Hits apply a burn stack: 4 damage per second for 3 s, up to 3 stacks.',
        'Burn caps at 5 stacks.',
        'Burns deal 6 per second per stack for 3.5 s.',
      ],
      assets: { icon: 'fire' },
    },
    {
      id: 'P10',
      name: 'Frost',
      category: 'perk',
      family: 'elemental',
      rarity: 'common',
      unlock: 'default',
      tags: ['elemental', 'frost', 'on-hit', 'control'],
      trigger: 'qualifying hit (primary always; secondary at proc coefficient)',
      procCoef: 1,
      maxRank: 3,
      ranks: [
        { chill: 22, frozenBonus: 0 },
        { chill: 30, frozenBonus: 0 },
        { chill: 30, frozenBonus: 0.25 },
      ],
      desc: [
        'Hits build chill (22). Chill slows; 100 chill freezes ordinary enemies. Elites resist; bosses stagger instead.',
        'Hits build 30 chill.',
        'Frozen enemies take +25% damage.',
      ],
      assets: { icon: 'frost' },
    },
    {
      id: 'P11',
      name: 'Shock',
      category: 'perk',
      family: 'elemental',
      rarity: 'common',
      unlock: 'default',
      tags: ['elemental', 'shock', 'on-hit', 'chain'],
      trigger: 'qualifying hit (chance × proc coefficient)',
      procCoef: 1,
      maxRank: 3,
      ranks: [
        { chance: 0.3, targets: 2, frac: 0.5, range: 160 },
        { chance: 0.45, targets: 2, frac: 0.5, range: 160 },
        { chance: 0.45, targets: 3, frac: 0.6, range: 180 },
      ],
      desc: [
        '30% chance on hit to arc to 2 nearby enemies for 50% damage.',
        '45% chance to arc.',
        'Arcs reach 3 enemies for 60% damage.',
      ],
      assets: { icon: 'shock' },
    },
    {
      id: 'P41',
      name: 'Dash Spark',
      category: 'perk',
      family: 'movement',
      rarity: 'common',
      unlock: 'default',
      tags: ['dash', 'zone', 'shock'],
      trigger: 'dash',
      procCoef: 0.25,
      maxRank: 3,
      ranks: [
        { life: 1.2, dps: 18 },
        { life: 2.0, dps: 18 },
        { life: 2.0, dps: 28 },
      ],
      desc: [
        'Dashing leaves an electrical trail for 1.2 s (18 damage per second).',
        'The trail lasts 2 s.',
        'The trail deals 28 damage per second.',
      ],
      assets: { icon: 'spark' },
    },
  ];
  D.perkById = {};
  for (const p of D.perks) D.perkById[p.id] = p;

  /* ------------------------------------------------------------ recipes */

  /**
   * Synergies activate when all ingredients are owned. They never take a slot.
   * Each one adds a behavior; the original hit is never re-counted.
   */
  D.recipes = [
    {
      id: 'S003',
      name: 'Burning Bank Shot',
      ingredients: ['P01', 'P09'],
      trigger: 'primary projectile bounces (Ricochet)',
      transformation: 'Adds a flame strip at the bounce point that burns enemies crossing it.',
      description: 'Wall bounces leave short flame strips that burn approaching enemies. Each original shot places at most two strips.',
      params: { maxStripsPerShot: 2, stripLength: 70, life: 2.5, burnEvery: 0.5 },
      cooldown: 0,
      procCoef: 0.25,
      stacking: 'Strips refresh burn stacks; they never add more than one stack per 0.5 s per enemy.',
      conflicts: [],
      verification: 'Own P01+P09. Fire at a wall with one enemy walking along it: two strips appear at most per shot; the enemy gains burn stacks.',
    },
    {
      id: 'S005',
      name: 'Boomerang Bloom',
      ingredients: ['P02', 'P05'],
      trigger: 'returning projectile comes within 140 px of the player',
      transformation: 'Replaces the returning shot with two curved petals thrown toward the aim.',
      description: 'A returning shot splits into two curved petals near you. Petals expire without returning again.',
      params: { triggerRange: 140, petalFrac: 0.6, petalLife: 0.75, curve: 3.2 },
      cooldown: 0,
      procCoef: 1,
      stacking: 'Once per returning projectile. Petals are fragments: they never split, return or bloom.',
      conflicts: ['S007'],
      verification: 'Own P02+P05. Fire into empty space: each returning shot blooms once into two petals; petals do not return.',
    },
    {
      id: 'S007',
      name: "Saturn's Wager",
      ingredients: ['P04', 'P05'],
      trigger: 'returning projectile reaches the player',
      transformation: 'The shot joins the orbital ring, then discharges toward your aim.',
      description: 'Returning shots temporarily join the orbital ring, then discharge toward the aim direction every 0.45 s.',
      params: { maxExtra: 6, life: 6, dischargeEvery: 0.45, catchRange: 30 },
      cooldown: 0.45,
      procCoef: 1,
      stacking: 'At most 6 captured shots. A discharged shot cannot be captured again.',
      conflicts: [],
      verification: 'Own P04+P05. Fire into empty space: returning shots enter the ring (max 6) and discharge one at a time.',
    },
    {
      id: 'S017',
      name: 'Steam Table',
      ingredients: ['P09', 'P10'],
      trigger: 'chill applied to a burning enemy',
      transformation: 'Consumes one burn stack and 30 chill to create a steam field.',
      description: 'Chilling a burning enemy consumes part of both effects and creates a short steam field that damages and slows enemies.',
      params: { radius: 72, life: 2.5, dps: 10, slow: 0.35, perEnemyCooldown: 1.5, chillCost: 30 },
      cooldown: 1.5,
      procCoef: 0.25,
      stacking: 'Per-enemy cooldown 1.5 s. Overlapping fields do not stack their slow.',
      conflicts: [],
      verification: 'Own P09+P10. Shoot one enemy repeatedly: after it burns, a steam field appears at most every 1.5 s.',
    },
    {
      id: 'S018',
      name: 'Plasma Payout',
      ingredients: ['P09', 'P11'],
      trigger: 'shock arc strikes a burning enemy',
      transformation: 'Adds one plasma branch from that enemy to its next neighbor, scorching the line.',
      description: 'Shock striking a burning target produces one plasma branch that scorches the line to its next target.',
      params: { frac: 0.6, range: 170, burnStacks: 1 },
      cooldown: 0,
      procCoef: 0.25,
      stacking: 'One branch per arc. Plasma branches never create further arcs or branches.',
      conflicts: [],
      verification: 'Own P09+P11. Burn a cluster, then hit it: arcs onto burning enemies spawn one extra plasma line each.',
    },
    {
      id: 'S021',
      name: 'Brittle Circuit',
      ingredients: ['P10', 'P11'],
      trigger: 'shock arc strikes an enemy with at least 60 chill',
      transformation: 'Sheds three ice splinters toward nearby enemies; bosses take stagger instead.',
      description: 'Shock striking a sufficiently chilled enemy sheds ice splinters toward nearby enemies. Bosses use a stagger threshold.',
      params: { chillThreshold: 60, splinters: 3, damage: 9, chillCost: 40, bossStagger: 14 },
      cooldown: 0,
      procCoef: 0.25,
      stacking: 'Consumes 40 chill, so a target cannot shed twice from one arc volley.',
      conflicts: [],
      verification: 'Own P10+P11. Chill a group above 60 then trigger arcs: struck enemies shed 3 splinters each.',
    },
    {
      id: 'S081',
      name: 'Skid Row',
      ingredients: ['P10', 'P41'],
      trigger: 'dash trail spark phase ends',
      transformation: 'The trail lingers as a frost skid that builds chill.',
      description: 'Electrical dash trails leave a narrow frost skid that builds chill after the initial shock.',
      params: { extraLife: 1.3, chillPerTick: 8 },
      cooldown: 0,
      procCoef: 0.25,
      stacking: 'Chill from overlapping skids is applied once per 0.2 s tick per enemy.',
      conflicts: [],
      verification: 'Own P10+P41. Dash through a group: after the spark fades, the blue skid keeps chilling enemies for 1.3 s.',
    },
    {
      id: 'S089',
      name: 'Live Wire',
      ingredients: ['P11', 'P41'],
      trigger: 'dash ends',
      transformation: 'The trail connects to up to two recently shocked enemies and strikes along the line.',
      description: 'A dash trail connects to a recently shocked enemy and emits one line strike along the connection.',
      params: { window: 2.5, range: 320, targets: 2, damage: 26 },
      cooldown: 0,
      procCoef: 0.25,
      stacking: 'Once per dash. Line strikes cannot trigger shock arcs.',
      conflicts: [],
      verification: 'Own P11+P41. Shock an enemy, then dash nearby: one line strike hits it when the dash ends.',
    },
  ];
  D.recipeById = {};
  for (const r of D.recipes) D.recipeById[r.id] = r;

  /* ------------------------------------------------------------ enemies */

  D.enemies = [
    {
      id: 'rusher',
      name: 'Chip Rusher',
      role: 'chipswarm rusher',
      hp: 18,
      speed: 150,
      radius: 12,
      contact: 10,
      chips: 1,
      threat: 1,
      pack: [3, 5],
      desc: 'Fast stacks of chips that swarm you. Low health, contact damage.',
    },
    {
      id: 'dealer',
      name: 'Card Dealer',
      role: 'fan-shot dealer',
      hp: 42,
      speed: 85,
      radius: 15,
      contact: 8,
      chips: 3,
      threat: 3,
      fireEvery: 2.5,
      tell: 0.55,
      fan: 5,
      spread: 0.75,
      bulletSpeed: 185,
      preferRange: 300,
      desc: 'Keeps its distance and throws fans of five cards.',
    },
    {
      id: 'ringcaster',
      name: 'Ring Caster',
      role: 'ring caster',
      hp: 58,
      speed: 38,
      radius: 16,
      contact: 8,
      chips: 4,
      threat: 4,
      fireEvery: 3.6,
      tell: 0.75,
      count: 22,
      gap: 4,
      bulletSpeed: 135,
      desc: 'Releases expanding rings. Each ring has a visible gap: step into it.',
    },
    {
      id: 'sniper',
      name: 'Marked Sniper',
      role: 'marked-line sniper',
      hp: 34,
      speed: 70,
      radius: 13,
      contact: 8,
      chips: 3,
      threat: 3,
      aimTime: 1.15,
      lockTime: 0.32,
      cooldown: 2.5,
      bulletSpeed: 640,
      bulletDamage: 16,
      preferRange: 460,
      desc: 'Paints a red line, locks it, then fires a fast needle down it.',
    },
    {
      id: 'usher',
      name: 'Shield Usher',
      role: 'shield usher',
      hp: 90,
      speed: 55,
      radius: 17,
      contact: 12,
      chips: 5,
      threat: 4,
      shieldArc: 1.05,
      burstEvery: 2.9,
      tell: 0.45,
      burst: 3,
      bulletSpeed: 230,
      turnRate: 1.6,
      desc: 'A velvet-rope shield absorbs 80% of damage from the front. Flank it or bounce shots around it.',
    },
    {
      id: 'turret',
      name: 'Slot Turret',
      role: 'stationary slot turret',
      hp: 100,
      speed: 0,
      radius: 19,
      contact: 10,
      chips: 5,
      threat: 5,
      spinTime: 2.6,
      restTime: 2.2,
      tell: 0.8,
      emitEvery: 0.14,
      arms: 3,
      bulletSpeed: 150,
      turnRate: 2.1,
      desc: 'Bolted to the floor. Spins up, then sprays a slow spiral.',
    },
  ];
  D.enemyById = {};
  for (const e of D.enemies) D.enemyById[e.id] = e;

  D.ELITE = { hpMult: 2.3, radiusMult: 1.2, chipMult: 5, damageMult: 1 };

  D.bosses = [
    {
      id: 'ladyzero_mini',
      name: 'Lady Zero',
      title: 'Table Minimum',
      hp: 760,
      radius: 40,
      chips: 60,
      phases: [
        { at: 1, patterns: ['rings', 'aimed'] },
        { at: 0.5, patterns: ['rings', 'spokes'] },
      ],
      desc: 'The Rotunda croupier running a practice table. Numbered rings with readable safe sectors.',
    },
    {
      id: 'ladyzero',
      name: 'Lady Zero',
      title: 'House Wheel',
      hp: 1700,
      radius: 44,
      chips: 160,
      phases: [
        { at: 1, patterns: ['rings', 'aimed'] },
        { at: 0.66, patterns: ['rings', 'spokes', 'ball'] },
        { at: 0.33, patterns: ['wheel', 'rings', 'aimed'] },
      ],
      desc: 'Lady Zero at full stakes. In her last phase the wheel spins and half the floor goes live.',
    },
  ];
  D.bossById = {};
  for (const b of D.bosses) D.bossById[b.id] = b;

  /* ------------------------------------------------------------- wagers */

  D.wagers = [
    { id: 'no_dash', name: 'Feet on the Felt', objective: 'Clear this room without dashing.', failOn: 'dash' },
    { id: 'no_damage', name: 'Clean Hands', objective: 'Clear this room without taking health damage.', failOn: 'health_damage' },
    { id: 'graze15', name: 'Close Shave', objective: 'Graze 15 distinct bullets before the room is cleared.', target: 15 },
    { id: 'speed75', name: 'Shot Clock', objective: 'Clear this room within 75 seconds.', timeLimit: 75 },
  ];
  D.wagerById = {};
  for (const w of D.wagers) D.wagerById[w.id] = w;
  /** Stake options offered, clipped to what the player can afford. */
  D.WAGER_STAKES = [10, 25, 50];

  /* ---------------------------------------------------- shop (cashier) */

  D.shop = [
    { id: 'cherry', name: 'Cherry', desc: 'Restore 35% of maximum health.', cost: 30 },
    { id: 'reroll', name: 'Reroll Token', desc: 'One extra draft reroll this run.', cost: 25 },
    { id: 'charge', name: 'Reel Grease', desc: '+60 spin charge now.', cost: 20 },
    { id: 'perk', name: 'Sealed Envelope', desc: 'A draft of three perks, right now.', cost: 60 },
  ];

  /* ------------------------------------------------ account progression */

  D.facilities = [
    {
      id: 'slot_alley',
      name: 'Slot Alley',
      desc: 'Produces banked chips over time, even while you are away (up to 8 hours).',
      baseCost: 60,
      costGrowth: 1.35,
      baseRate: 72 / 3600,
      rateGrowth: 1.18,
      maxLevel: 10,
      offlineCapHours: 8,
      /** Level milestones: rate multipliers and gameplay unlocks. */
      milestones: [
        { level: 1, unlock: 'warm_reels', text: 'Warm Reels: every run starts with 50 spin charge.' },
        { level: 2, unlock: 'hold_token', text: 'Hold Token: your first reel hold each floor costs no extra charge.' },
        { level: 3, rateMult: 1.5, unlock: 'neon_cabinet', text: 'Neon cabinets: rate ×1.5 and neon reel trim.' },
        { level: 5, unlock: 'loaded_seven', text: 'Reel preset "Loaded Seven": reel 3 weights Seven at 1.5 (toggle in the hub).' },
        { level: 8, rateMult: 2, unlock: 'gold_cabinet', text: 'Gold cabinets: rate ×2 and gold reel trim.' },
      ],
    },
  ];
  D.facilityById = {};
  for (const f of D.facilities) D.facilityById[f.id] = f;

  /** Deliberately small, capped permanent combat improvements. */
  D.accountUpgrades = [
    { id: 'vitality', name: 'House Tab', desc: '+5% maximum health per rank (cap +25%).', perRank: 0.05, costs: [40, 80, 140, 220, 320] },
    { id: 'caliber', name: 'Loaded Chambers', desc: '+3% base damage per rank (cap +15%).', perRank: 0.03, costs: [50, 100, 170, 260, 380] },
  ];
  D.accountUpgradeById = {};
  for (const u of D.accountUpgrades) D.accountUpgradeById[u.id] = u;

  /* ------------------------------------------------ floors and rooms */

  D.roomTypes = {
    tutorial: { name: 'The Entrance', desc: 'A quiet way in.', draft: true },
    combat: { name: 'Gaming Floor', desc: 'Standard encounter.', draft: true },
    highroller: { name: 'High Roller Room', desc: 'Adds an elite to every wave. Chips ×1.5.', draft: true, chipMult: 1.5, extraElite: 1 },
    cashier: { name: 'Cashier Cage', desc: 'No fight. Spend loose chips.', draft: false },
    boss: { name: 'The Table', desc: 'Boss.', draft: false },
  };

  D.layouts = {
    open: { pillars: [] },
    pillars4: {
      pillars: [
        { x: 380, y: 230, r: 38 },
        { x: 900, y: 230, r: 38 },
        { x: 380, y: 450, r: 38 },
        { x: 900, y: 450, r: 38 },
      ],
    },
    center: { pillars: [{ x: 640, y: 300, r: 56 }] },
    flank: {
      pillars: [
        { x: 260, y: 340, r: 44 },
        { x: 1020, y: 340, r: 44 },
      ],
    },
  };

  /**
   * Floor plans. Slot 0 is fixed; middle slots let the player pick a door;
   * the last slot is the boss. `wagerSlots` always offer a wager.
   */
  D.floors = [
    {
      id: 'F1',
      name: 'Penny Arcade',
      subtitle: 'The Entrance',
      rolePool: ['rusher', 'dealer', 'ringcaster', 'sniper'],
      difficulty: 1,
      slots: [{ fixed: 'start' }, { choices: ['combat', 'highroller'] }, { choices: ['combat', 'highroller'], wager: true }, { fixed: 'boss' }],
      boss: 'ladyzero_mini',
      waves: 3,
      theme: 'arcade',
    },
    {
      id: 'F2',
      name: 'Roulette Rotunda',
      subtitle: 'Where the wheel lives',
      rolePool: ['rusher', 'dealer', 'ringcaster', 'sniper', 'usher', 'turret'],
      difficulty: 1.4,
      slots: [
        { fixed: 'combat' },
        { choices: ['combat', 'highroller', 'cashier'], wager: 'sometimes' },
        { choices: ['combat', 'highroller', 'cashier'], wager: 'sometimes' },
        { fixed: 'boss' },
      ],
      boss: 'ladyzero',
      waves: 3,
      theme: 'rotunda',
      final: true,
    },
  ];

  /** Heat modifiers, stated exactly on the terminal screen. */
  D.HEAT = {
    extraElitesPerRoom: 1,
    bulletSpeedPerHeat: 0.08,
    describe(h) {
      if (h <= 0) return 'No heat.';
      return 'Heat ' + h + ': +' + h + ' elite per room, hostile bullets +' + Math.round(h * 8) + '% speed.';
    },
  };

  /** Ordered tutorial steps for the Entrance. */
  D.tutorialSteps = [
    { id: 'move', text: 'WASD to move.', done: 'moved' },
    { id: 'shoot', text: 'Aim with the mouse. Hold left click to fire.', done: 'killed_intro' },
    { id: 'precision', text: 'Hold SHIFT for precision: you slow down and your true hitbox appears.', done: 'precision' },
    { id: 'spin', text: 'Your reels are charged. Press Q to spin. (Tutorial demo: this first result is fixed.)', done: 'spun' },
    { id: 'ring', text: 'A Ring Caster. Every ring has a gap: move into it.', done: 'ring_cleared' },
    { id: 'dash', text: 'SPACE to dash. Brief invulnerability, two charges.', done: 'dashed' },
    { id: 'graze', text: 'Brush past bullets without touching them to graze. Grazes charge the reels.', done: 'grazed' },
    { id: 'finish', text: 'Clear the room.', done: 'room_clear' },
  ];
})(typeof window !== 'undefined' ? window : globalThis);
