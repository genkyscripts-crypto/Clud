/*
 * Signature perks: small reusable behaviors referenced by id from weapon data.
 * A new gun reuses an existing perk with different params, or registers a new
 * one here. No per-gun scripts.
 *
 * Hooks (all optional):
 *   damageMult(state, params)                → multiplier for the next shot
 *   comboGainMult(params)                    → multiplier on combo gain per hit
 *   onShotResolved(state, params, result)    → update runtime state after a shot
 *   rewardMult(state, params, ctx)           → cash multiplier for a break; ctx = { breakIndex, breakCount }
 *   hudText(state, params)                   → short status string for the HUD, or ''
 *
 * `state` is per-weapon runtime data owned by the WeaponController. It is
 * never saved and never stored on the shared definition.
 */
(function (root) {
  'use strict';
  const ZTA = root.ZTA;

  const perks = {
    'perk.center_streak': {
      id: 'perk.center_streak',
      name: 'Center Streak',
      describe(p) {
        return (
          'Each consecutive weak-point hit adds +' +
          Math.round(p.perStack * 100) +
          '% damage, up to +' +
          Math.round(p.perStack * p.maxStacks * 100) +
          '%. A body hit or a miss resets it.'
        );
      },
      initState() {
        return { stacks: 0 };
      },
      damageMult(state, p) {
        return 1 + p.perStack * state.stacks;
      },
      onShotResolved(state, p, result) {
        if (result.weakHits > 0 && result.bodyHits === 0) state.stacks = Math.min(p.maxStacks, state.stacks + 1);
        else state.stacks = 0;
      },
      hudText(state, p) {
        return state.stacks > 0 ? 'STREAK ' + state.stacks + '/' + p.maxStacks : '';
      },
    },

    'perk.hot_hands': {
      id: 'perk.hot_hands',
      name: 'Hot Hands',
      describe(p) {
        return 'Hits build the combo meter ' + p.comboGain + '× faster.';
      },
      initState() {
        return {};
      },
      comboGainMult(p) {
        return p.comboGain;
      },
    },

    'perk.multi_break': {
      id: 'perk.multi_break',
      name: 'Cluster Bounty',
      describe(p) {
        return 'Every extra target broken by the same shell pays +' + Math.round(p.bonusPerExtra * 100) + '% cash.';
      },
      initState() {
        return {};
      },
      rewardMult(state, p, ctx) {
        return ctx.breakIndex > 0 ? 1 + p.bonusPerExtra : 1;
      },
    },
  };

  ZTA.perks = perks;
})(typeof window !== 'undefined' ? window : globalThis);
