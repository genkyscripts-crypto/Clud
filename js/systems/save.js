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

  const VERSION = 1;
  const KEY = 'zta.save';
  const BACKUP_KEY = 'zta.save.bak';
  const FUTURE_KEY = 'zta.save.future';
  const FORMAT = 'zta-save';

  function defaultSettings() {
    return {
      shake: true,
      flashes: true,
      damageNumbers: true,
      hitMarkers: true,
      intenseFx: true,
      volume: 0.7,
      muted: false,
    };
  }

  function createDefault(now) {
    const t = now == null ? Date.now() : now;
    return {
      version: VERSION,
      createdAt: t,
      savedAt: t,
      cash: 0,
      lifetimeCash: 0,
      blueprints: 0,
      owned: [D.STARTER_WEAPON],
      equipped: [D.STARTER_WEAPON, null, null],
      activeSlot: 0,
      weaponLevels: {},
      rangeLevels: {},
      favorites: [],
      settings: defaultSettings(),
      stats: { shots: 0, hits: 0, weakHits: 0, breaks: 0, wavesCleared: 0, playTime: 0, bestCombo: 1 },
      perGun: {},
      flags: { hints: {}, seenTargets: {} },
    };
  }

  /** Migrations keyed by the version they upgrade *from*. */
  const migrations = {
    0(d) {
      // Pre-release saves had no version field; the layout matches v1.
      d.version = 1;
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
  const bool = (v, fallback) => (typeof v === 'boolean' ? v : fallback);

  function cleanLevels(src, tracks) {
    const out = {};
    if (!src || typeof src !== 'object') return out;
    for (const t of tracks) {
      const v = src[t.id];
      if (Number.isInteger(v) && v > 0) out[t.id] = Math.min(v, t.max);
    }
    return out;
  }

  function cleanFlags(src) {
    const out = {};
    if (!src || typeof src !== 'object') return out;
    for (const k of Object.keys(src)) if (src[k] === true) out[k] = true;
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
    d.blueprints = Math.floor(nonNeg(raw.blueprints, 0));

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

    if (raw.weaponLevels && typeof raw.weaponLevels === 'object') {
      for (const w of D.weapons) {
        const lv = cleanLevels(raw.weaponLevels[w.id], w.upgrades);
        if (Object.keys(lv).length) d.weaponLevels[w.id] = lv;
      }
    }
    d.rangeLevels = cleanLevels(raw.rangeLevels, D.rangeUpgrades);

    if (Array.isArray(raw.favorites)) d.favorites = raw.favorites.filter((id) => typeof id === 'string' && D.weaponById[id]);

    const s = raw.settings || {};
    const ds = d.settings;
    ds.shake = bool(s.shake, ds.shake);
    ds.flashes = bool(s.flashes, ds.flashes);
    ds.damageNumbers = bool(s.damageNumbers, ds.damageNumbers);
    ds.hitMarkers = bool(s.hitMarkers, ds.hitMarkers);
    ds.intenseFx = bool(s.intenseFx, ds.intenseFx);
    ds.muted = bool(s.muted, ds.muted);
    ds.volume = U.isFiniteNumber(s.volume) ? U.clamp(s.volume, 0, 1) : ds.volume;

    const st = raw.stats || {};
    for (const k of Object.keys(d.stats)) d.stats[k] = nonNeg(st[k], d.stats[k]);
    d.stats.bestCombo = Math.max(1, d.stats.bestCombo);

    if (raw.perGun && typeof raw.perGun === 'object') {
      for (const w of D.weapons) {
        const g = raw.perGun[w.id];
        if (g && typeof g === 'object') {
          d.perGun[w.id] = { shots: nonNeg(g.shots, 0), hits: nonNeg(g.hits, 0), breaks: nonNeg(g.breaks, 0) };
        }
      }
    }

    const f = raw.flags || {};
    d.flags.hints = cleanFlags(f.hints);
    d.flags.seenTargets = cleanFlags(f.seenTargets);
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
    const attempts = [
      ['main', KEY],
      ['backup', BACKUP_KEY],
    ];
    for (const [source, key] of attempts) {
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

  ZTA.SaveSystem = {
    VERSION,
    KEY,
    BACKUP_KEY,
    createDefault,
    defaultSettings,
    migrate,
    sanitize,
    serialize,
    deserialize,
    load,
    save,
    wipe,
  };
})(typeof window !== 'undefined' ? window : globalThis);
