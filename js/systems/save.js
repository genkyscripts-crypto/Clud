/*
 * Versioned local saves with a checksum, a rolling backup and recovery.
 *
 *  main   — "zta.save"      the latest good save
 *  backup — "zta.save.bak"  the previous good save, copied before each write
 *
 * Load order: main → backup → fresh game. Every loaded save is migrated to the
 * current version and sanitized against the live catalog, so unknown ids,
 * impossible levels, negative cash or broken loadouts can never reach the game.
 * Player progress only ever lives in this data, never on the shared definitions.
 */
(function (root) {
  'use strict';
  const ZTA = root.ZTA;
  const D = ZTA.data;
  const U = ZTA.util;

  const VERSION = 2;
  const KEY = 'zta.save';
  const BACKUP_KEY = 'zta.save.bak';
  const FUTURE_KEY = 'zta.save.future';
  const FORMAT = 'zta-save';

  function defaultSettings() {
    return { shake: true, flashes: true, damageNumbers: true, hitMarkers: true, intenseFx: true, grain: true, volume: 0.7, muted: false };
  }

  function createDefault(now) {
    const t = now == null ? Date.now() : now;
    return {
      version: VERSION,
      createdAt: t,
      savedAt: t,
      cash: 0,
      lifetimeCash: 0,
      branchCash: 0,
      blueprints: 0,
      lifetimeBlueprints: 0,
      owned: [D.STARTER_WEAPON],
      equipped: [D.STARTER_WEAPON, null, null],
      activeSlot: 0,
      weaponLevels: {},
      rangeLevels: {},
      rangeId: D.START_RANGE,
      rangesUnlocked: [D.START_RANGE],
      challenges: {},
      mastery: {},
      workshop: {},
      lanes: { unlocked: 0, guns: [null, null, null, null, null], stored: 0, lastTick: t },
      prestige: { branch: 0, charters: [] },
      milestones: {},
      favorites: [],
      settings: defaultSettings(),
      stats: { shots: 0, hits: 0, weakHits: 0, breaks: 0, wavesCleared: 0, playTime: 0, bestCombo: 1, bossKills: 0, challengeRuns: 0 },
      perGun: {},
      flags: { hints: {}, seenTargets: {}, rangeIntro: {} },
    };
  }

  /** Migrations keyed by the version they upgrade *from*. */
  const migrations = {
    0(d) {
      d.version = 1;
      return d;
    },
    1(d) {
      // v2 adds ranges, challenges, mastery, workshop, lanes and prestige.
      // Mastery starts from the breaks already made with each gun.
      d.mastery = {};
      if (d.perGun && typeof d.perGun === 'object') {
        for (const id of Object.keys(d.perGun)) {
          const g = d.perGun[id];
          if (g && U.isFiniteNumber(g.breaks)) d.mastery[id] = { xp: Math.floor(g.breaks) };
        }
      }
      d.branchCash = d.lifetimeCash || 0;
      d.version = 2;
      return d;
    },
  };

  function migrate(data) {
    let d = data;
    let guard = 0;
    while (typeof d.version !== 'number' || d.version < VERSION) {
      const from = typeof d.version === 'number' ? d.version : 0;
      const step = migrations[from];
      if (!step || guard++ > 50) throw new Error('No migration from save version ' + from);
      d = step(d);
    }
    return d;
  }

  const nonNeg = (v, fallback) => (U.isFiniteNumber(v) && v >= 0 ? v : fallback);
  const int = (v, fallback, max) => (Number.isInteger(v) && v >= 0 ? Math.min(v, max == null ? v : max) : fallback);
  const bool = (v, fallback) => (typeof v === 'boolean' ? v : fallback);
  const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});

  function cleanLevels(src, tracks) {
    const out = {};
    const s = obj(src);
    for (const t of tracks) {
      const v = s[t.id];
      if (Number.isInteger(v) && v > 0) out[t.id] = Math.min(v, t.max);
    }
    return out;
  }

  function cleanFlags(src) {
    const out = {};
    const s = obj(src);
    for (const k of Object.keys(s)) if (s[k] === true) out[k] = true;
    return out;
  }

  /** Returns a new, fully valid save object built from untrusted data. */
  function sanitize(raw, now) {
    const d = createDefault(now);
    if (!raw || typeof raw !== 'object') return d;

    d.createdAt = nonNeg(raw.createdAt, d.createdAt);
    d.savedAt = nonNeg(raw.savedAt, d.savedAt);
    d.cash = nonNeg(raw.cash, 0);
    d.lifetimeCash = Math.max(nonNeg(raw.lifetimeCash, 0), d.cash);
    d.branchCash = Math.min(Math.max(nonNeg(raw.branchCash, 0), d.cash), d.lifetimeCash);
    d.blueprints = Math.floor(nonNeg(raw.blueprints, 0));
    d.lifetimeBlueprints = Math.max(Math.floor(nonNeg(raw.lifetimeBlueprints, 0)), d.blueprints);

    const owned = new Set([D.STARTER_WEAPON]);
    if (Array.isArray(raw.owned)) for (const id of raw.owned) if (typeof id === 'string' && D.weaponById[id]) owned.add(id);
    d.owned = Array.from(owned);

    const eq = [null, null, null];
    const used = new Set();
    if (Array.isArray(raw.equipped)) {
      for (let i = 0; i < 3; i++) {
        const id = raw.equipped[i];
        if (typeof id === 'string' && owned.has(id) && !used.has(id)) {
          eq[i] = id;
          used.add(id);
        }
      }
    }
    if (!eq.some(Boolean)) eq[0] = D.STARTER_WEAPON;
    d.equipped = eq;
    let slot = Number.isInteger(raw.activeSlot) ? raw.activeSlot : 0;
    if (slot < 0 || slot > 2 || !eq[slot]) slot = eq.findIndex(Boolean);
    d.activeSlot = slot;

    const wl = obj(raw.weaponLevels);
    for (const w of D.weapons) {
      const lv = cleanLevels(wl[w.id], w.upgrades);
      if (Object.keys(lv).length) d.weaponLevels[w.id] = lv;
    }
    d.rangeLevels = cleanLevels(raw.rangeLevels, D.rangeUpgrades);

    const unlocked = new Set([D.START_RANGE]);
    if (Array.isArray(raw.rangesUnlocked)) for (const id of raw.rangesUnlocked) if (D.rangeById[id]) unlocked.add(id);
    d.rangesUnlocked = D.ranges.filter((r) => unlocked.has(r.id)).map((r) => r.id);
    d.rangeId = typeof raw.rangeId === 'string' && unlocked.has(raw.rangeId) ? raw.rangeId : D.START_RANGE;

    const ch = obj(raw.challenges);
    for (const c of D.challenges) {
      const e = obj(ch[c.id]);
      const stars = int(e.stars, 0, 3);
      const best = U.isFiniteNumber(e.best) && e.best >= 0 ? e.best : null;
      const clears = int(e.clears, 0);
      const modStars = cleanFlags(e.modStars);
      for (const k of Object.keys(modStars)) if (!D.meta.modifiers.some((m) => m.id === k)) delete modStars[k];
      if (stars || best != null || clears || Object.keys(modStars).length) d.challenges[c.id] = { stars, best, clears, modStars };
    }

    const ms = obj(raw.mastery);
    const finishIds = new Set(D.meta.finishes.map((f) => f.id));
    for (const w of D.weapons) {
      const e = obj(ms[w.id]);
      const m = {
        xp: Math.floor(nonNeg(e.xp, 0)),
        claimed: int(e.claimed, 0, D.meta.mastery.levels.length),
        obj: Math.floor(nonNeg(e.obj, 0)),
        objDone: e.objDone === true,
        finish: typeof e.finish === 'string' && finishIds.has(e.finish) ? e.finish : 'fin.factory',
        perkBought: int(e.perkBought, 0, D.meta.perkUpgrade.costs.length),
      };
      if (m.xp || m.claimed || m.obj || m.objDone || m.finish !== 'fin.factory' || m.perkBought) d.mastery[w.id] = m;
    }

    const wsRaw = obj(raw.workshop);
    for (const n of D.meta.workshop) {
      const v = int(wsRaw[n.id], 0, n.max);
      if (v) d.workshop[n.id] = v;
    }

    const ln = obj(raw.lanes);
    d.lanes.unlocked = int(ln.unlocked, 0, D.meta.lanes.unlockCosts.length);
    const laneGuns = Array.isArray(ln.guns) ? ln.guns : [];
    const laneUsed = new Set();
    for (let i = 0; i < 5; i++) {
      const id = laneGuns[i];
      if (typeof id === 'string' && owned.has(id) && !laneUsed.has(id)) {
        d.lanes.guns[i] = id;
        laneUsed.add(id);
      }
    }
    d.lanes.stored = nonNeg(ln.stored, 0);
    d.lanes.lastTick = nonNeg(ln.lastTick, d.lanes.lastTick);

    const pr = obj(raw.prestige);
    d.prestige.branch = int(pr.branch, 0, 1000);
    if (Array.isArray(pr.charters)) d.prestige.charters = pr.charters.filter((id) => D.meta.prestige.charters.some((c) => c.id === id));

    const mst = obj(raw.milestones);
    for (const m of D.meta.milestones) if (mst[m.id] === true) d.milestones[m.id] = true;

    if (Array.isArray(raw.favorites)) d.favorites = Array.from(new Set(raw.favorites.filter((id) => typeof id === 'string' && D.weaponById[id])));

    const s = obj(raw.settings);
    const ds = d.settings;
    for (const k of ['shake', 'flashes', 'damageNumbers', 'hitMarkers', 'intenseFx', 'grain', 'muted']) ds[k] = bool(s[k], ds[k]);
    ds.volume = U.isFiniteNumber(s.volume) ? U.clamp(s.volume, 0, 1) : ds.volume;

    const st = obj(raw.stats);
    for (const k of Object.keys(d.stats)) d.stats[k] = nonNeg(st[k], d.stats[k]);
    d.stats.bestCombo = Math.max(1, d.stats.bestCombo);

    const pg = obj(raw.perGun);
    for (const w of D.weapons) {
      const g = pg[w.id];
      if (g && typeof g === 'object') d.perGun[w.id] = { shots: nonNeg(g.shots, 0), hits: nonNeg(g.hits, 0), breaks: nonNeg(g.breaks, 0) };
    }

    const f = obj(raw.flags);
    d.flags.hints = cleanFlags(f.hints);
    d.flags.seenTargets = cleanFlags(f.seenTargets);
    d.flags.rangeIntro = cleanFlags(f.rangeIntro);
    return d;
  }

  function serialize(data) {
    const body = JSON.stringify(data);
    return JSON.stringify({ format: FORMAT, version: VERSION, checksum: U.hash32(body), body });
  }

  /** Parses an envelope. Returns the raw save object or throws with a reason. */
  function deserialize(str) {
    if (typeof str !== 'string' || !str.length) throw new Error('empty');
    const env = JSON.parse(str);
    if (!env || env.format !== FORMAT || typeof env.body !== 'string') throw new Error('not a save');
    if (U.hash32(env.body) !== env.checksum) throw new Error('checksum mismatch');
    const data = JSON.parse(env.body);
    if (!data || typeof data !== 'object') throw new Error('bad body');
    return data;
  }

  function defaultStorage() {
    try {
      return root.localStorage || null;
    } catch (e) {
      return null;
    }
  }

  function readRaw(storage, key) {
    try {
      return storage ? storage.getItem(key) : null;
    } catch (e) {
      return null;
    }
  }

  /**
   * Loads the best available save.
   * Returns { data, source: 'main' | 'backup' | 'new', warnings: string[] }.
   */
  function load(storage, now) {
    const store = storage === undefined ? defaultStorage() : storage;
    const warnings = [];
    for (const [source, key] of [
      ['main', KEY],
      ['backup', BACKUP_KEY],
    ]) {
      const raw = readRaw(store, key);
      if (raw == null) continue;
      try {
        let data = deserialize(raw);
        if (typeof data.version === 'number' && data.version > VERSION) {
          warnings.push('Save came from a newer version; a copy was kept.');
          try {
            store.setItem(FUTURE_KEY, raw);
          } catch (e) {
            /* storage full: keep going with what we have */
          }
        } else {
          data = migrate(data);
        }
        return { data: sanitize(data, now), source, warnings };
      } catch (err) {
        warnings.push(source + ' save unreadable (' + err.message + ')');
      }
    }
    return { data: createDefault(now), source: 'new', warnings };
  }

  /** Writes the save, rotating the previous good save into the backup slot. */
  function save(storage, data, now) {
    const store = storage === undefined ? defaultStorage() : storage;
    if (!store) return { ok: false, error: 'storage unavailable' };
    try {
      data.savedAt = now == null ? Date.now() : now;
      const next = serialize(data);
      const prev = readRaw(store, KEY);
      if (prev) {
        try {
          deserialize(prev);
          store.setItem(BACKUP_KEY, prev);
        } catch (e) {
          /* never rotate a corrupt save into the backup slot */
        }
      }
      store.setItem(KEY, next);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err && err.message ? err.message : String(err) };
    }
  }

  function wipe(storage) {
    const store = storage === undefined ? defaultStorage() : storage;
    try {
      if (store) {
        store.removeItem(KEY);
        store.removeItem(BACKUP_KEY);
      }
      return true;
    } catch (e) {
      return false;
    }
  }

  ZTA.SaveSystem = { VERSION, KEY, BACKUP_KEY, createDefault, defaultSettings, migrate, sanitize, serialize, deserialize, load, save, wipe };
})(typeof window !== 'undefined' ? window : globalThis);
