/*
 * Content rules shared by gameplay and UI:
 *  - resolving a weapon's live stats from its definition, upgrade levels,
 *    perk level and global modifiers (Workshop, milestones, prestige),
 *  - the damage model (armor, falloff, crits) at a given range's scale,
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

  const REFERENCE_DISTANCE = 8;

  /** Which slot kinds each target type may be placed in. */
  const TYPE_SLOTS = {
    'tgt.plate': ['row', 'rack'],
    'tgt.bottle': ['crate', 'shelf'],
    'tgt.runner': ['rail'],
    'tgt.drone': ['air'],
    'tgt.popper': ['popup'],
    'tgt.barrel': ['barrels'],
    'tgt.heavy': ['stand'],
    'tgt.shutter': ['shutter'],
  };

  function trackOf(def, upgId) {
    const t = def.upgrades.find((u) => u.id === upgId);
    if (!t) return null;
    return Object.assign({}, t, { def: D.weaponUpgrades[upgId] });
  }

  function upgradeCost(tr, level, discount) {
    return Math.max(1, Math.round(tr.cost * Math.pow(tr.growth, level) * (1 - (discount || 0))));
  }

  function levelOf(levels, id, max) {
    const raw = levels && levels[id];
    if (!Number.isInteger(raw) || raw < 0) return 0;
    return Math.min(raw, max);
  }

  /**
   * Live stats for a weapon. Returns a new plain object.
   * opts: { perkLevel, mods: { damageMult, reloadMult }, normalizeTo: rangeIndex }
   */
  function resolveWeaponStats(def, levels, opts) {
    const o = opts || {};
    const f = def.fire;
    const s = {
      id: def.id,
      tier: def.tier,
      family: def.family,
      mode: f.mode,
      rpm: f.rpm,
      interval: 60 / f.rpm,
      burst: f.burst || 1,
      burstRpm: f.burstRpm || f.rpm,
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
      pitch: def.pitch || 1,
      projectile: def.projectile ? Object.assign({}, def.projectile) : null,
      chainBonus: 0,
      perk: null,
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
          } else s.reload.time *= k;
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
          s.pellets = f.pellets + Math.round(t.step * lvl);
          break;
        case 'upg.firerate':
          s.rpm = f.rpm * (1 + t.step * lvl);
          break;
        case 'upg.pierce':
          s.armorPierce = def.armorPierce + t.step * lvl;
          break;
        case 'upg.penetration':
          s.penetration = def.penetration + Math.round(t.step * lvl);
          break;
        case 'upg.splash':
          if (s.projectile) s.projectile.radius = def.projectile.radius * (1 + t.step * lvl);
          break;
        case 'upg.chain':
          s.chainBonus = Math.round(t.step * lvl);
          break;
        default:
          break;
      }
    }

    // Family trials: scale the gun to the range's tier, so any gun can compete.
    if (o.normalizeTo) {
      const k = D.TIER[o.normalizeTo].dmg / D.TIER[def.tier].dmg;
      s.damage *= k;
      s.armorPierce *= k;
    }

    const mods = o.mods || {};
    if (mods.damageMult) s.damage *= mods.damageMult;
    if (mods.reloadMult) {
      if (s.reload.style === 'shell') {
        s.reload.start *= mods.reloadMult;
        s.reload.perShell *= mods.reloadMult;
        s.reload.end *= mods.reloadMult;
      } else s.reload.time *= mods.reloadMult;
    }
    s.interval = 60 / s.rpm;

    const perk = ZTA.perks[def.perk.id];
    const step = D.meta ? D.meta.perkUpgrade.stepPerLevel : 0.3;
    s.perk = { id: def.perk.id, level: o.perkLevel || 0, params: ZTA.improvePerkParams(perk, def.perk.params, o.perkLevel || 0, step) };
    if (perk && perk.statMods) perk.statMods(s, s.perk.params, def);
    return s;
  }

  /** A target definition scaled to a range: { hp, armor, value, weak, def }. */
  function scaledTarget(def, range) {
    const r = range || D.rangeById[D.START_RANGE];
    return { id: def.id, def, hp: def.hp * r.hpMult, armor: def.armor * r.hpMult, value: def.value * r.valueMult, weak: def.weak };
  }

  function falloffMult(falloff, distance) {
    if (!falloff || distance <= falloff.start) return 1;
    if (distance >= falloff.end) return falloff.min;
    const t = (distance - falloff.start) / (falloff.end - falloff.start);
    return 1 + (falloff.min - 1) * t;
  }

  /**
   * Damage of one pellet against one target.
   * tgt: { armor, weak }. opts: { weak, distance, mult, penScale, critBonus }
   */
  function pelletDamage(stats, tgt, opts) {
    const o = opts || {};
    const d = stats.damage * (o.mult || 1) * (o.penScale || 1) * falloffMult(stats.falloff, o.distance || 0);
    if (o.weak && tgt.weak) return { damage: d * (stats.critMult + (o.critBonus || 0)), armored: false };
    const armor = Math.max(0, (tgt.armor || 0) - stats.armorPierce);
    if (armor <= 0) return { damage: d, armored: false };
    return { damage: Math.max(d * D.ARMOR_FLOOR, d - armor), armored: true };
  }

  /** Shots to break assuming every pellet lands. Infinity if it cannot. */
  function shotsToBreak(stats, tgt, opts) {
    const o = Object.assign({ distance: REFERENCE_DISTANCE }, opts);
    const perShot = pelletDamage(stats, tgt, o).damage * stats.pellets;
    if (!(perShot > 0)) return Infinity;
    return Math.max(1, Math.ceil(tgt.hp / perShot - 1e-9));
  }

  function breakTable(stats, range) {
    return D.tableTargets.map((def) => {
      const t = scaledTarget(def, range);
      return { targetId: def.id, name: def.short, armor: t.armor, body: shotsToBreak(stats, t, { weak: false }), weak: def.weak ? shotsToBreak(stats, t, { weak: true }) : null };
    });
  }

  /** Sustained damage per second including reload downtime. */
  function dps(stats) {
    const perShot = stats.damage * stats.pellets;
    const rate = stats.burst > 1 ? (stats.burst * stats.rpm) / 60 : stats.rpm / 60;
    const magTime = stats.magazine / rate;
    const reload = stats.reload.style === 'shell' ? stats.reload.start + stats.reload.perShell * stats.magazine + stats.reload.end : stats.reload.time;
    const splash = stats.projectile ? 1.8 : 1;
    return ((perShot * rate * magTime) / (magTime + reload)) * splash;
  }

  function showValue(show, s) {
    const F = ZTA.fmt;
    switch (show) {
      case 'dmg':
        return (s.damage < 100 ? F.dec(s.damage, 1) : F.num(Math.round(s.damage))) + ' dmg';
      case 'rounds':
        return s.magazine + ' rds';
      case 'reload':
        return s.reload.style === 'shell' ? F.dec(s.reload.perShell, 2) + ' s/shell' : F.dec(s.reload.time, 2) + ' s';
      case 'mult':
        return F.mult(s.critMult);
      case 'bloom':
        return F.dec(s.bloomPerShot, 3) + '°/shot';
      case 'pellets':
        return s.pellets + ' pellets';
      case 'rpm':
        return Math.round(s.rpm) + ' rpm';
      case 'ap':
        return F.num(Math.round(s.armorPierce)) + ' armor pierce';
      case 'pen':
        return 'passes ' + s.penetration + ' target' + (s.penetration === 1 ? '' : 's');
      case 'radius':
        return s.projectile ? F.dec(s.projectile.radius, 2) + ' m blast' : '';
      case 'chain':
        return '+' + s.chainBonus + ' arc target' + (s.chainBonus === 1 ? '' : 's');
      default:
        return '';
    }
  }

  /**
   * Everything the UI needs before buying a weapon upgrade.
   * ctx: { range, perkLevel, mods, discount }
   */
  function describeWeaponUpgrade(def, levels, upgId, ctx) {
    const c = ctx || {};
    const tr = trackOf(def, upgId);
    if (!tr) return null;
    const level = levelOf(levels, upgId, tr.max);
    const maxed = level >= tr.max;
    const ropts = { perkLevel: c.perkLevel, mods: c.mods };
    const before = resolveWeaponStats(def, levels, ropts);
    const out = {
      id: upgId,
      name: tr.def.name,
      desc: tr.def.desc,
      level,
      max: tr.max,
      maxed,
      cost: maxed ? null : upgradeCost(tr, level, c.discount),
      fromText: showValue(tr.def.show, before),
      toText: null,
      breakpoints: [],
    };
    if (maxed) return out;
    const after = resolveWeaponStats(def, Object.assign({}, levels, { [upgId]: level + 1 }), ropts);
    out.toText = showValue(tr.def.show, after);
    if (tr.def.breakpoints) {
      for (const tdef of D.tableTargets) {
        const t = scaledTarget(tdef, c.range);
        for (const weak of tdef.weak ? [false, true] : [false]) {
          const a = shotsToBreak(before, t, { weak });
          const b = shotsToBreak(after, t, { weak });
          if (a !== b && a <= 60) out.breakpoints.push({ targetId: tdef.id, name: tdef.short, weak, from: a, to: b });
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
      case 'share':
        return Math.round(v * 100) + '% of wave cash';
      case 'targets':
        return '+' + v + ' per wave';
      default:
        return String(v);
    }
  }

  function describeRangeUpgrade(upg, levels, range) {
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
      const r = range || D.rangeById[D.START_RANGE];
      const plate = D.targetById['tgt.plate'].value * r.valueMult;
      out.detail =
        'Plates on ' + r.name + ' pay ' + ZTA.fmt.cash(Math.max(1, Math.round(plate * rangeValue(upg, level)))) + ' → ' + ZTA.fmt.cash(Math.max(1, Math.round(plate * rangeValue(upg, level + 1)))) + ' before combo';
    }
    return out;
  }

  function rangeModifiers(levels) {
    const m = { cashMult: 1, waveDelay: 1.6, weakBreakBonus: 0, waveBonus: 0.25, extraTargets: 0 };
    for (const upg of D.rangeUpgrades) m[upg.effect.key] = rangeValue(upg, levelOf(levels, upg.id, upg.max));
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
    const unique = (id) => {
      need(!ids.has(id), 'duplicate id ' + id);
      ids.add(id);
    };
    const builders = ZTA.GunArt ? ZTA.GunArt.builders : null;

    for (const w of D.weapons) {
      unique(w.id);
      need(w.id.startsWith('gun.'), 'weapon id must start with "gun.": ' + w.id);
      need(!!D.families[w.family], w.id + ': unknown family ' + w.family);
      need(w.fire && w.fire.rpm > 0 && w.fire.pellets >= 1, w.id + ': invalid fire block');
      need(['semi', 'auto', 'burst', 'pump', 'bolt'].indexOf(w.fire.mode) !== -1, w.id + ': unknown fire mode ' + w.fire.mode);
      need(w.fire.mode !== 'burst' || (w.fire.burst > 1 && w.fire.burstRpm > 0), w.id + ': burst needs burst and burstRpm');
      need(w.damage > 0 && w.magazine >= 1 && w.critMult >= 1, w.id + ': invalid damage / magazine / crit');
      need(w.unlockCost >= 0, w.id + ': unlockCost must be >= 0');
      need(!!D.rangeById[w.requiresRange], w.id + ': unknown requiresRange');
      need(w.reload && (w.reload.style === 'shell' ? w.reload.perShell > 0 : w.reload.time > 0), w.id + ': invalid reload');
      need(!!ZTA.perks[w.perk.id], w.id + ': unknown perk ' + w.perk.id);
      need(!!(w.model && w.model.builder) && (!builders || !!builders[w.model.builder]), w.id + ': unknown model builder ' + (w.model && w.model.builder));
      for (const t of w.upgrades) {
        need(!!D.weaponUpgrades[t.id], w.id + ': unknown upgrade ' + t.id);
        need(t.max >= 1 && t.cost > 0 && t.growth > 1, w.id + ': bad tuning on ' + t.id);
      }
    }
    const starter = D.weaponById[D.STARTER_WEAPON];
    need(!!starter && starter.unlockCost === 0, 'starter weapon must exist and be free');

    for (const t of D.targets) {
      unique(t.id);
      need(t.hp > 0 && t.value > 0 && t.armor >= 0, t.id + ': invalid hp/value/armor');
    }
    for (const u of D.rangeUpgrades) unique(u.id);

    for (const r of D.ranges) {
      unique(r.id);
      need(r.hpMult > 0 && r.valueMult > 0, r.id + ': invalid multipliers');
      if (r.unlock.requires) need(!!D.challengeById[r.unlock.requires.challenge], r.id + ': unlock requires unknown challenge');
      const checkWave = (wave) => {
        unique(wave.id);
        for (const sp of wave.spawns) {
          need(!!D.targetById[sp.type], wave.id + ': unknown target ' + sp.type);
          for (const sid of Array.isArray(sp.slot) ? sp.slot : [sp.slot]) {
            const slot = r.slots[sid];
            need(!!slot, wave.id + ': unknown slot ' + sid + ' on ' + r.id);
            if (slot) need((TYPE_SLOTS[sp.type] || []).indexOf(slot.kind) !== -1, wave.id + ': ' + sp.type + ' cannot use a ' + slot.kind + ' slot');
          }
        }
      };
      r.intro.forEach(checkWave);
      r.pool.forEach(checkWave);
      // Feasibility: the guns available by this range can break every target type there.
      const arsenal = D.weapons.filter((w) => w.tier <= r.index).map((w) => resolveWeaponStats(w, {}));
      for (const tdef of D.tableTargets) {
        const t = scaledTarget(tdef, r);
        const best = Math.min.apply(null, arsenal.map((s) => shotsToBreak(s, t, { weak: false, distance: 15 })));
        need(best <= 40, r.id + ': no available gun breaks ' + tdef.id + ' in under 40 shots (' + best + ')');
      }
    }

    for (const c of D.challenges) {
      unique(c.id);
      const r = D.rangeById[c.range];
      need(!!r, c.id + ': unknown range');
      need(['breaks', 'weakBreaks', 'droneBreaks', 'armorBreaks', 'score', 'bossTime'].indexOf(c.metric) !== -1, c.id + ': unknown metric');
      need(c.stars.length === 3 && c.duration >= 30 && c.duration <= 120, c.id + ': needs 3 stars and a 30–120 s duration');
      if (c.boss) need(!!D.bossById[c.boss], c.id + ': unknown boss ' + c.boss);
      if (c.families) for (const f of c.families) need(!!D.families[f] && D.weapons.some((w) => w.family === f), c.id + ': family ' + f + ' has no guns');
      if (r && c.stream) {
        for (const e of c.stream.pool) {
          need(!!D.targetById[e.type], c.id + ': unknown target ' + e.type);
          for (const sid of e.slots) {
            const slot = r.slots[sid];
            need(!!slot, c.id + ': unknown slot ' + sid);
            if (slot) need((TYPE_SLOTS[e.type] || []).indexOf(slot.kind) !== -1, c.id + ': ' + e.type + ' cannot use a ' + slot.kind + ' slot');
          }
        }
      }
      if (r && c.boss) need(!!r.slots.boss_pad, c.id + ': range has no boss_pad');
    }
    for (const b of D.bosses) {
      unique(b.id);
      need(b.parts.filter((p) => p.final).length === 1, b.id + ': needs exactly one final part');
      for (const p of b.parts) need(!!D.targetById[p.type] && p.hp > 0, b.id + ': bad part ' + p.id);
    }
    return errors;
  }

  ZTA.content = {
    REFERENCE_DISTANCE,
    TYPE_SLOTS,
    trackOf,
    upgradeCost,
    levelOf,
    resolveWeaponStats,
    scaledTarget,
    falloffMult,
    pelletDamage,
    shotsToBreak,
    breakTable,
    dps,
    describeWeaponUpgrade,
    describeRangeUpgrade,
    rangeModifiers,
    validateCatalog,
  };
})(typeof window !== 'undefined' ? window : globalThis);
