/*
 * Content rules shared by gameplay and UI:
 *  - resolving a weapon's live stats from its definition + upgrade levels,
 *  - the damage model (armor, falloff, crits),
 *  - shots-to-break math used to show upgrade breakpoints,
 *  - upgrade previews and costs,
 *  - catalog validation (run at boot and in tests).
 *
 * Nothing here mutates a definition; every function returns fresh objects.
 */
(function (root) {
  'use strict';
  const ZTA = root.ZTA;
  const D = ZTA.data;

  const REFERENCE_DISTANCE = 7; // meters, the near row; used for shots-to-break readouts

  function track(def, upgId) {
    const t = def.upgrades.find((u) => u.id === upgId);
    if (!t) return null;
    return Object.assign({}, t, { def: D.weaponUpgrades[upgId] });
  }

  function upgradeCost(tr, level) {
    return Math.round(tr.cost * Math.pow(tr.growth, level));
  }

  function levelOf(levels, id, max) {
    const raw = levels && levels[id];
    if (!Number.isInteger(raw) || raw < 0) return 0;
    return Math.min(raw, max);
  }

  /** Live stats for a weapon: definition + upgrades. Returns a new plain object. */
  function resolveWeaponStats(def, levels) {
    const f = def.fire;
    const s = {
      id: def.id,
      family: def.family,
      mode: f.mode,
      rpm: f.rpm,
      interval: 60 / f.rpm,
      pellets: f.pellets,
      spread: f.spread,
      bloomPerShot: f.bloomPerShot,
      bloomMax: f.bloomMax,
      bloomRecovery: f.bloomRecovery,
      bloomDelay: f.bloomDelay,
      damage: def.damage,
      critMult: def.critMult,
      penetration: def.penetration,
      penetrationFalloff: def.penetrationFalloff,
      armorPierce: def.armorPierce,
      falloff: def.falloff ? Object.assign({}, def.falloff) : null,
      magazine: def.magazine,
      reload: Object.assign({}, def.reload),
      drawTime: def.drawTime,
      recoil: Object.assign({}, def.recoil),
      audio: def.audio,
      perk: def.perk,
    };

    for (const t of def.upgrades) {
      const lvl = levelOf(levels, t.id, t.max);
      if (lvl === 0) continue;
      switch (t.id) {
        case 'upg.damage':
          s.damage = def.damage * (1 + t.step * lvl);
          break;
        case 'upg.magazine':
          s.magazine = def.magazine + Math.round(t.step * lvl);
          break;
        case 'upg.reload': {
          const k = Math.pow(1 - t.step, lvl);
          if (s.reload.style === 'shell') {
            s.reload.start *= k;
            s.reload.perShell *= k;
            s.reload.end *= k;
          } else {
            s.reload.time *= k;
          }
          break;
        }
        case 'upg.crit':
          s.critMult = def.critMult + t.step * lvl;
          break;
        case 'upg.stability': {
          const k = Math.pow(1 - t.step, lvl);
          s.bloomPerShot *= k;
          s.recoil.kick *= k;
          break;
        }
        case 'upg.pellets':
          s.pellets = def.fire.pellets + Math.round(t.step * lvl);
          break;
        default:
          break;
      }
    }
    return s;
  }

  function falloffMult(falloff, distance) {
    if (!falloff || distance <= falloff.start) return 1;
    if (distance >= falloff.end) return falloff.min;
    const t = (distance - falloff.start) / (falloff.end - falloff.start);
    return 1 + (falloff.min - 1) * t;
  }

  /**
   * Damage of one pellet against one target.
   * opts: { weak, distance, perkMult, penScale }
   */
  function pelletDamage(stats, targetDef, opts) {
    const o = opts || {};
    let d = stats.damage * (o.perkMult || 1) * (o.penScale || 1) * falloffMult(stats.falloff, o.distance || 0);
    if (o.weak && targetDef.weak) return { damage: d * stats.critMult, armored: false };
    const armor = Math.max(0, targetDef.armor - stats.armorPierce);
    if (armor <= 0) return { damage: d, armored: false };
    return { damage: Math.max(d * D.ARMOR_FLOOR, d - armor), armored: true };
  }

  /** Shots to break assuming every pellet lands. Infinity if it cannot. */
  function shotsToBreak(stats, targetDef, opts) {
    const o = Object.assign({ distance: REFERENCE_DISTANCE }, opts);
    const perShot = pelletDamage(stats, targetDef, o).damage * stats.pellets;
    if (!(perShot > 0)) return Infinity;
    return Math.max(1, Math.ceil(targetDef.hp / perShot - 1e-9));
  }

  function breakTable(stats) {
    const rows = [];
    for (const t of D.targets) {
      rows.push({
        targetId: t.id,
        name: t.short,
        body: shotsToBreak(stats, t, { weak: false }),
        weak: t.weak ? shotsToBreak(stats, t, { weak: true }) : null,
      });
    }
    return rows;
  }

  function showValue(show, stats) {
    const F = ZTA.fmt;
    switch (show) {
      case 'dmg':
        return F.dec(stats.damage, 1) + ' dmg';
      case 'rounds':
        return stats.magazine + ' rds';
      case 'reload':
        return stats.reload.style === 'shell' ? F.dec(stats.reload.perShell, 2) + ' s/shell' : F.dec(stats.reload.time, 2) + ' s';
      case 'mult':
        return F.mult(stats.critMult);
      case 'bloom':
        return F.dec(stats.bloomPerShot, 3) + '°/shot';
      case 'pellets':
        return stats.pellets + ' pellets';
      default:
        return '';
    }
  }

  /** Everything the UI needs to show before buying a weapon upgrade. */
  function describeWeaponUpgrade(def, levels, upgId) {
    const tr = track(def, upgId);
    if (!tr) return null;
    const level = levelOf(levels, upgId, tr.max);
    const maxed = level >= tr.max;
    const before = resolveWeaponStats(def, levels);
    const out = {
      id: upgId,
      name: tr.def.name,
      desc: tr.def.desc,
      level,
      max: tr.max,
      maxed,
      cost: maxed ? null : upgradeCost(tr, level),
      fromText: showValue(tr.def.show, before),
      toText: null,
      breakpoints: [],
    };
    if (maxed) return out;
    const nextLevels = Object.assign({}, levels, { [upgId]: level + 1 });
    const after = resolveWeaponStats(def, nextLevels);
    out.toText = showValue(tr.def.show, after);
    if (tr.def.breakpoints) {
      for (const t of D.targets) {
        const modes = t.weak ? [false, true] : [false];
        for (const weak of modes) {
          const a = shotsToBreak(before, t, { weak });
          const b = shotsToBreak(after, t, { weak });
          if (a !== b) out.breakpoints.push({ targetId: t.id, name: t.short, weak, from: a, to: b });
        }
      }
    }
    return out;
  }

  function rangeValue(upg, level) {
    return upg.effect.base + upg.effect.step * level;
  }

  function showRange(upg, v) {
    const F = ZTA.fmt;
    switch (upg.show) {
      case 'mult':
        return F.mult(v) + ' cash';
      case 'secs':
        return F.dec(v, 2) + ' s';
      case 'bonus':
        return '+' + Math.round(v * 100) + '%';
      case 'targets':
        return '+' + v + ' per wave';
      default:
        return String(v);
    }
  }

  function describeRangeUpgrade(upg, levels) {
    const level = levelOf(levels, upg.id, upg.max);
    const maxed = level >= upg.max;
    const out = {
      id: upg.id,
      name: upg.name,
      desc: upg.desc,
      level,
      max: upg.max,
      maxed,
      cost: maxed ? null : upgradeCost(upg, level),
      fromText: showRange(upg, rangeValue(upg, level)),
      toText: maxed ? null : showRange(upg, rangeValue(upg, level + 1)),
      detail: null,
    };
    if (!maxed && upg.effect.key === 'cashMult') {
      const plate = D.targetById['tgt.plate'];
      const a = Math.max(1, Math.round(plate.value * rangeValue(upg, level)));
      const b = Math.max(1, Math.round(plate.value * rangeValue(upg, level + 1)));
      out.detail = 'Plates pay ' + ZTA.fmt.cash(a) + ' → ' + ZTA.fmt.cash(b) + ' before combo';
    }
    return out;
  }

  function rangeModifiers(levels) {
    const m = { cashMult: 1, waveDelay: 1.6, weakBreakBonus: 0, extraTargets: 0 };
    for (const upg of D.rangeUpgrades) {
      m[upg.effect.key] = rangeValue(upg, levelOf(levels, upg.id, upg.max));
    }
    m.extraTargets = Math.round(m.extraTargets);
    return m;
  }

  /** Returns a list of human-readable problems. Empty list = catalog is valid. */
  function validateCatalog() {
    const errors = [];
    const ids = new Set();
    const need = (cond, msg) => {
      if (!cond) errors.push(msg);
    };

    for (const w of D.weapons) {
      need(typeof w.id === 'string' && w.id.startsWith('gun.'), 'weapon id must start with "gun.": ' + w.id);
      need(!ids.has(w.id), 'duplicate id ' + w.id);
      ids.add(w.id);
      need(!!D.families[w.family], w.id + ': unknown family ' + w.family);
      need(w.fire && w.fire.rpm > 0 && w.fire.pellets >= 1, w.id + ': invalid fire block');
      need(w.damage > 0 && w.magazine >= 1 && w.critMult >= 1, w.id + ': invalid damage / magazine / crit');
      need(w.unlockCost >= 0, w.id + ': unlockCost must be >= 0');
      need(w.reload && (w.reload.style === 'magazine' ? w.reload.time > 0 : w.reload.perShell > 0), w.id + ': invalid reload');
      need(!!(w.perk && ZTA.perks && ZTA.perks[w.perk.id]), w.id + ': unknown perk ' + (w.perk && w.perk.id));
      need(!!(w.model && w.model.builder), w.id + ': missing model builder');
      for (const t of w.upgrades) {
        need(!!D.weaponUpgrades[t.id], w.id + ': unknown upgrade ' + t.id);
        need(t.max >= 1 && t.cost > 0 && t.growth > 1, w.id + ': bad tuning on ' + t.id);
      }
      // Feasibility: every gun must be able to break every target in a sane number of shots.
      const stats = resolveWeaponStats(w, {});
      for (const t of D.targets) {
        const n = shotsToBreak(stats, t, { weak: false, distance: 18 });
        need(Number.isFinite(n) && n <= 150, w.id + ' cannot reasonably break ' + t.id + ' (' + n + ' shots)');
      }
    }
    need(!!D.weaponById[D.STARTER_WEAPON] && D.weaponById[D.STARTER_WEAPON].unlockCost === 0, 'starter weapon must exist and be free');

    for (const t of D.targets) {
      need(!ids.has(t.id), 'duplicate id ' + t.id);
      ids.add(t.id);
      need(t.hp > 0 && t.value > 0 && t.armor >= 0, t.id + ': invalid hp/value/armor');
    }
    for (const u of D.rangeUpgrades) {
      need(!ids.has(u.id), 'duplicate id ' + u.id);
      ids.add(u.id);
    }
    const checkWave = (wave) => {
      need(!ids.has(wave.id), 'duplicate id ' + wave.id);
      ids.add(wave.id);
      for (const sp of wave.spawns) {
        need(!!D.targetById[sp.type], wave.id + ': unknown target ' + sp.type);
        const slots = Array.isArray(sp.slot) ? sp.slot : [sp.slot];
        for (const s of slots) need(!!D.range.slots[s], wave.id + ': unknown slot ' + s);
      }
    };
    D.waves.intro.forEach(checkWave);
    D.waves.pool.forEach(checkWave);
    return errors;
  }

  ZTA.content = {
    REFERENCE_DISTANCE,
    track,
    upgradeCost,
    levelOf,
    resolveWeaponStats,
    falloffMult,
    pelletDamage,
    shotsToBreak,
    breakTable,
    describeWeaponUpgrade,
    describeRangeUpgrade,
    rangeModifiers,
    validateCatalog,
  };
})(typeof window !== 'undefined' ? window : globalThis);
