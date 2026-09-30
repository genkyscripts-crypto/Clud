/*
 * Catalog validation. Runs at boot and in tests; a broken reference is a
 * build error, not a silent runtime surprise. The catalog is deep-frozen
 * afterwards so no system can mutate a shared definition.
 */
(function (root) {
  'use strict';
  const HE = root.HE;
  const D = HE.data;

  function validateCatalog() {
    const errors = [];
    const seen = new Set();
    const need = (cond, msg) => {
      if (!cond) errors.push(msg);
    };
    const unique = (id, where) => {
      need(typeof id === 'string' && id.length > 0, where + ': missing id');
      need(!seen.has(id), where + ': duplicate id ' + id);
      seen.add(id);
    };

    for (const w of D.weapons) {
      unique(w.id, 'weapon');
      for (const k of ['name', 'description', 'category', 'unlock', 'rarity', 'tags', 'params', 'assets']) need(w[k] != null, 'weapon ' + w.id + ': missing ' + k);
    }
    for (const p of D.perks) {
      unique(p.id, 'perk');
      for (const k of ['name', 'category', 'family', 'rarity', 'unlock', 'tags', 'trigger', 'procCoef', 'assets']) need(p[k] != null, 'perk ' + p.id + ': missing ' + k);
      need(p.maxRank >= 1 && p.maxRank <= 3, 'perk ' + p.id + ': maxRank must be 1-3');
      need(Array.isArray(p.ranks) && p.ranks.length === p.maxRank, 'perk ' + p.id + ': ranks length must equal maxRank');
      need(Array.isArray(p.desc) && p.desc.length === p.maxRank, 'perk ' + p.id + ': desc per rank required');
    }
    for (const r of D.recipes) {
      unique(r.id, 'recipe');
      for (const k of ['name', 'ingredients', 'trigger', 'transformation', 'description', 'params', 'cooldown', 'procCoef', 'stacking', 'conflicts', 'verification']) {
        need(r[k] != null, 'recipe ' + r.id + ': missing ' + k);
      }
      need(Array.isArray(r.ingredients) && r.ingredients.length >= 2, 'recipe ' + r.id + ': needs 2+ ingredients');
      for (const ing of r.ingredients || []) need(D.perkById[ing] || D.weaponById[ing], 'recipe ' + r.id + ': unknown ingredient ' + ing);
      for (const c of r.conflicts || []) need(D.recipeById[c], 'recipe ' + r.id + ': unknown conflict ' + c);
    }
    // Two recipes with identical ingredient sets would double-count content.
    const sets = new Set();
    for (const r of D.recipes) {
      const key = r.ingredients.slice().sort().join('+');
      need(!sets.has(key), 'recipe ' + r.id + ': duplicate ingredient set ' + key);
      sets.add(key);
    }
    for (const e of D.enemies) {
      unique(e.id, 'enemy');
      need(e.hp > 0 && e.radius > 0 && e.threat > 0, 'enemy ' + e.id + ': bad stats');
    }
    for (const b of D.bosses) {
      unique(b.id, 'boss');
      need(b.phases && b.phases.length >= 1 && b.phases[0].at === 1, 'boss ' + b.id + ': first phase must start at 1');
    }
    for (const f of D.floors) {
      unique(f.id, 'floor');
      need(D.bossById[f.boss], 'floor ' + f.id + ': unknown boss');
      for (const role of f.rolePool) need(D.enemyById[role], 'floor ' + f.id + ': unknown role ' + role);
      need(f.slots[f.slots.length - 1].fixed === 'boss', 'floor ' + f.id + ': last slot must be the boss');
    }
    for (const w of D.wagers) unique(w.id, 'wager');
    for (const f of D.facilities) unique(f.id, 'facility');
    for (const u of D.accountUpgrades) unique(u.id, 'upgrade');
    need(D.symbols.length === 6, 'slots: exactly six symbols expected');
    return errors;
  }

  HE.validateCatalog = validateCatalog;

  const errs = validateCatalog();
  if (errs.length && typeof console !== 'undefined') console.error('[HE] catalog errors:\n' + errs.join('\n'));
  HE.catalogErrors = errs;
  HE.util.deepFreeze(D.TUNING);
  for (const k of ['symbols', 'weapons', 'perks', 'recipes', 'enemies', 'bosses', 'wagers', 'facilities', 'accountUpgrades', 'floors', 'layouts', 'roomTypes', 'shop']) {
    HE.util.deepFreeze(D[k]);
  }
})(typeof window !== 'undefined' ? window : globalThis);
