/*
 * Signature perks: small reusable behaviors referenced by id from weapon data.
 * A new gun reuses a perk with different params, or registers a new one here.
 *
 * Hooks (all optional). `s` is per-weapon runtime state (never saved, never on
 * the shared definition); `p` is the gun's params after perk improvements.
 *   initState()                              → fresh runtime state
 *   statMods(stats, p, def)                  → adjust resolved stats (e.g. armor pierce)
 *   onFire(s, p, ctx)                        → before a shot. ctx: { ammoBefore, magazine, sinceLastShot, heldTime, burstIndex, burstSize, time }
 *   shotDamageMult(s, p)                     → multiplier for the whole shot
 *   spreadMult(s, p) / critBonus(s, p)       → accuracy and extra crit multiplier for this shot
 *   hitMult(s, p, hit)                       → per target hit. hit: { weak, armored, moving, fresh, drone }
 *   onHit(s, p, ctx)                         → after a primary hit lands (secondary effects)
 *   onShotResolved(s, p, result, track)      → after the shot; track(metric) feeds mastery objectives
 *   onBreak(s, p, ctx, track)                → a target broke to this gun
 *   breakMetric(s, p, ctx)                   → objective metric name for a break, or null
 *   rewardMult(s, p, ctx)                    → cash multiplier. ctx: { breakIndex, pierceIndex, drone }
 *   comboGainMult(p) / fireRateMult(s, p, ctx) / splashMult(s, p, count)
 *   onRelease(s) / onReload(s) / onSwitchIn(s)
 *   hudText(s, p, rt, time)                  → short HUD status, or ''
 *
 * `improve` lists which params grow with perk level and how:
 *   'scale' → v * (1 + k·L)    'bonus' → 1 + (v − 1) * (1 + k·L)    'down' → v / (1 + k·L)
 */
(function (root) {
  'use strict';
  const ZTA = root.ZTA;

  const pct = (x) => Math.round(x * 100) + '%';
  const plus = (m) => '+' + Math.round((m - 1) * 100) + '%';

  const perks = {
    'perk.center_streak': {
      name: 'Center Streak',
      improve: { perStack: 'scale' },
      describe: (p) => 'Each consecutive weak-point hit adds +' + pct(p.perStack) + ' damage, up to ' + p.maxStacks + ' stacks. A body hit or a miss resets it.',
      initState: () => ({ stacks: 0 }),
      shotDamageMult: (s, p) => 1 + p.perStack * s.stacks,
      onShotResolved(s, p, r, track) {
        if (r.weakHits > 0 && r.bodyHits === 0) {
          s.stacks = Math.min(p.maxStacks, s.stacks + 1);
          if (s.stacks === p.maxStacks) track('streakMax');
        } else s.stacks = 0;
      },
      hudText: (s, p) => (s.stacks > 0 ? 'STREAK ' + s.stacks + '/' + p.maxStacks : ''),
    },

    'perk.hot_hands': {
      name: 'Hot Hands',
      improve: { comboGain: 'bonus' },
      describe: (p) => 'Hits build the combo meter ' + (+p.comboGain.toFixed(2)) + '× faster.',
      initState: () => ({}),
      comboGainMult: (p) => p.comboGain,
    },

    'perk.multi_break': {
      name: 'Cluster Bounty',
      improve: { bonusPerExtra: 'scale' },
      describe: (p) => 'Every extra target broken by the same shot pays +' + pct(p.bonusPerExtra) + ' cash.',
      initState: () => ({}),
      rewardMult: (s, p, ctx) => (ctx.breakIndex > 0 ? 1 + p.bonusPerExtra : 1),
    },

    'perk.final_chamber': {
      name: 'Final Chamber',
      improve: { mult: 'bonus' },
      describe: (p) => 'The last round in the gun deals ' + (+p.mult.toFixed(2)) + '× damage.',
      initState: () => ({ final: false }),
      onFire(s, p, ctx) {
        s.final = ctx.ammoBefore === 1;
      },
      shotDamageMult: (s, p) => (s.final ? p.mult : 1),
      breakMetric: (s) => (s.final ? 'finalBreaks' : null),
      hudText: (s, p, rt) => (rt && rt.ammo === 1 ? 'FINAL ROUND' : ''),
    },

    'perk.quick_draw': {
      name: 'Quick Draw',
      improve: { mult: 'bonus' },
      describe: (p) => 'The first shot after a reload or a switch deals ' + (+p.mult.toFixed(2)) + '× damage.',
      initState: () => ({ primed: true, shotPrimed: false }),
      onFire(s) {
        s.shotPrimed = s.primed;
        s.primed = false;
      },
      onReload(s) {
        s.primed = true;
      },
      onSwitchIn(s) {
        s.primed = true;
      },
      shotDamageMult: (s, p) => (s.shotPrimed ? p.mult : 1),
      breakMetric: (s) => (s.shotPrimed ? 'primedBreaks' : null),
      hudText: (s) => (s.primed ? 'PRIMED' : ''),
    },

    'perk.ricochet': {
      name: 'Ricochet',
      improve: { chance: 'scale', share: 'scale' },
      describe: (p) => Math.round(Math.min(0.95, p.chance) * 100) + '% of body hits on steel bounce into a nearby target for ' + pct(p.share) + ' damage.',
      initState: () => ({}),
      onHit(s, p, ctx) {
        if (ctx.weak || ctx.material !== 'steel' || ctx.game.rng.next() > Math.min(0.95, p.chance)) return;
        ctx.game.secondaryHit({ from: ctx.target, amount: ctx.damage * p.share, radius: p.radius, count: 1, kind: 'ricochet', weaponId: ctx.weaponId });
      },
    },

    'perk.mover_hunter': {
      name: 'Mover Hunter',
      improve: { mult: 'bonus' },
      describe: (p) => plus(p.mult) + ' damage against moving targets: runners, drones and poppers.',
      initState: () => ({}),
      hitMult: (s, p, hit) => (hit.moving ? p.mult : 1),
    },

    'perk.drone_hunter': {
      name: 'Drone Hunter',
      improve: { mult: 'bonus', cash: 'bonus' },
      describe: (p) => plus(p.mult) + ' damage against drones, and drones pay ' + plus(p.cash) + ' cash.',
      initState: () => ({}),
      hitMult: (s, p, hit) => (hit.drone ? p.mult : 1),
      rewardMult: (s, p, ctx) => (ctx.drone ? p.cash : 1),
    },

    'perk.last_gasp': {
      name: 'Last Gasp',
      improve: { mult: 'bonus' },
      describe: (p) => 'The last ' + pct(p.threshold) + ' of each magazine deals ' + (+p.mult.toFixed(2)) + '× damage.',
      initState: () => ({ gasp: false }),
      onFire(s, p, ctx) {
        s.gasp = ctx.ammoBefore <= Math.ceil(ctx.magazine * p.threshold);
      },
      shotDamageMult: (s, p) => (s.gasp ? p.mult : 1),
      breakMetric: (s) => (s.gasp ? 'gaspBreaks' : null),
      hudText: (s, p, rt, time, st) => (rt && st && rt.ammo <= Math.ceil(st.magazine * p.threshold) && rt.ammo > 0 ? 'LAST GASP' : ''),
    },

    'perk.through_through': {
      name: 'Through & Through',
      improve: { cashPerExtra: 'scale' },
      describe: (p) => 'Each target a round passes through pays +' + pct(p.cashPerExtra) + ' more cash than the one before it.',
      initState: () => ({}),
      rewardMult: (s, p, ctx) => 1 + p.cashPerExtra * (ctx.pierceIndex || 0),
      breakMetric: (s, p, ctx) => (ctx.pierceIndex > 0 ? 'pierceBreaks' : null),
    },

    'perk.armor_breaker': {
      name: 'Armor Breaker',
      improve: { mult: 'bonus' },
      describe: (p) => 'Ignores extra armor and deals ' + plus(p.mult) + ' damage to armored targets.',
      initState: () => ({}),
      statMods(st, p, def) {
        st.armorPierce += p.pierce * ZTA.data.TIER[def.tier].dmg;
      },
      hitMult: (s, p, hit) => (hit.armored ? p.mult : 1),
    },

    'perk.steady_aim': {
      name: 'Steady Aim',
      improve: { critBonus: 'scale' },
      describe: (p) => 'After ' + p.idle + ' s without firing, the next shot has zero spread and +' + (+p.critBonus.toFixed(2)) + '× critical damage.',
      initState: () => ({ steady: false }),
      onFire(s, p, ctx) {
        s.steady = ctx.sinceLastShot >= p.idle;
      },
      spreadMult: (s) => (s.steady ? 0 : 1),
      critBonus: (s, p) => (s.steady ? p.critBonus : 0),
      hudText: (s, p, rt, time) => (rt && time - rt.lastShot >= p.idle ? 'STEADY' : ''),
    },

    'perk.execution': {
      name: 'Execution',
      improve: { mult: 'bonus' },
      describe: (p) => 'Weak-point hits on untouched targets deal ' + (+p.mult.toFixed(2)) + '× damage.',
      initState: () => ({}),
      hitMult: (s, p, hit) => (hit.weak && hit.fresh ? p.mult : 1),
      breakMetric: (s, p, ctx) => (ctx.weak && ctx.fresh ? 'executions' : null),
    },

    'perk.burst_precision': {
      name: 'Burst Precision',
      improve: { mult: 'bonus' },
      describe: (p) => 'When every round of a burst hits, its last round deals ' + (+p.mult.toFixed(2)) + '× damage.',
      initState: () => ({ hits: 0, index: 0, size: 3 }),
      onFire(s, p, ctx) {
        s.index = ctx.burstIndex;
        s.size = ctx.burstSize;
        if (ctx.burstIndex === 0) s.hits = 0;
      },
      shotDamageMult: (s, p) => (s.size > 1 && s.index === s.size - 1 && s.hits === s.size - 1 ? p.mult : 1),
      onShotResolved(s, p, r, track) {
        if (r.anyHit) s.hits++;
        if (s.index === s.size - 1 && s.hits === s.size) track('fullBursts');
      },
    },

    'perk.tempo': {
      name: 'Tempo',
      improve: { perStack: 'scale' },
      describe: (p) => 'Each break within ' + p.window + ' s of the last adds +' + pct(p.perStack) + ' fire rate, up to ' + p.maxStacks + ' stacks.',
      initState: () => ({ stacks: 0, last: -99 }),
      onBreak(s, p, ctx, track) {
        s.stacks = ctx.time - s.last <= p.window ? Math.min(p.maxStacks, s.stacks + 1) : 1;
        s.last = ctx.time;
        if (s.stacks === p.maxStacks) track('tempoMax');
      },
      fireRateMult(s, p, ctx) {
        if (ctx.time - s.last > p.window) s.stacks = 0;
        return 1 + p.perStack * s.stacks;
      },
      hudText: (s, p, rt, time) => (s.stacks > 0 && time - s.last <= p.window ? 'TEMPO ' + s.stacks + '/' + p.maxStacks : ''),
    },

    'perk.sustained': {
      name: 'Sustained Fire',
      improve: { max: 'scale' },
      describe: (p) => 'Each round in an unbroken burst adds +' + pct(p.perShot) + ' damage, up to +' + pct(p.max) + '. Releasing the trigger resets it.',
      initState: () => ({ chain: 0, maxed: false }),
      onFire(s, p) {
        s.chain++;
      },
      shotDamageMult: (s, p) => 1 + Math.min(p.max, p.perShot * s.chain),
      onShotResolved(s, p, r, track) {
        if (!s.maxed && p.perShot * s.chain >= p.max) {
          s.maxed = true;
          track('sustainMax');
        }
      },
      onRelease(s) {
        s.chain = 0;
        s.maxed = false;
      },
      onReload(s) {
        s.chain = 0;
        s.maxed = false;
      },
      hudText: (s, p) => (s.chain > 0 ? 'SUSTAIN +' + Math.round(Math.min(p.max, p.perShot * s.chain) * 100) + '%' : ''),
    },

    'perk.spin_up': {
      name: 'Spin-Up',
      improve: { time: 'down' },
      describe: (p) => 'Starts at ' + pct(p.minRate) + ' fire rate and reaches full speed after ' + (+p.time.toFixed(2)) + ' s of holding the trigger.',
      initState: () => ({}),
      fireRateMult: (s, p, ctx) => p.minRate + (1 - p.minRate) * Math.min(1, ctx.heldTime / p.time),
      hudText: (s, p, rt) => (rt && rt.heldTime > 0 ? 'SPIN ' + Math.round(Math.min(1, rt.heldTime / p.time) * 100) + '%' : ''),
    },

    'perk.chain_arc': {
      name: 'Chain Arc',
      improve: { share: 'scale' },
      describe: (p) => 'Every hit arcs into ' + p.targets + ' nearby targets for ' + pct(p.share) + ' damage.',
      initState: () => ({}),
      onHit(s, p, ctx) {
        ctx.game.secondaryHit({ from: ctx.target, amount: ctx.damage * p.share, radius: p.radius, count: p.targets + (ctx.stats.chainBonus || 0), kind: 'arc', weaponId: ctx.weaponId });
      },
    },

    'perk.needle_stack': {
      name: 'Needle Stack',
      improve: { burst: 'scale' },
      describe: (p) => 'Needles stick. At ' + p.stacks + ' needles a target bursts for ' + (+p.burst.toFixed(1)) + '× damage.',
      initState: () => ({}),
      onHit(s, p, ctx) {
        const t = ctx.target;
        if (t.state !== 'active') return;
        t.needles = (t.needles || 0) + 1;
        if (t.needles >= p.stacks) {
          t.needles = 0;
          ctx.track('needleBursts');
          ctx.game.secondaryHit({ target: t, amount: ctx.damage * p.burst, kind: 'needle', weaponId: ctx.weaponId });
        }
      },
    },

    'perk.shockwave': {
      name: 'Shockwave',
      improve: { bonusPerTarget: 'scale' },
      describe: (p) => 'Blasts deal +' + pct(p.bonusPerTarget) + ' damage for every extra target caught.',
      initState: () => ({}),
      splashMult: (s, p, count) => 1 + p.bonusPerTarget * Math.max(0, count - 1),
    },
  };

  for (const id of Object.keys(perks)) perks[id].id = id;

  /** Applies a perk level to params, following the perk's `improve` rules. */
  function improveParams(perk, params, level, step) {
    const out = Object.assign({}, params);
    if (!level || !perk || !perk.improve) return out;
    const k = 1 + (step || 0.3) * level;
    for (const key of Object.keys(perk.improve)) {
      if (!(key in out)) continue;
      const mode = perk.improve[key];
      if (mode === 'scale') out[key] = out[key] * k;
      else if (mode === 'bonus') out[key] = 1 + (out[key] - 1) * k;
      else if (mode === 'down') out[key] = out[key] / k;
    }
    return out;
  }

  ZTA.perks = perks;
  ZTA.improvePerkParams = improveParams;
})(typeof window !== 'undefined' ? window : globalThis);
