/*
 * Versioned account saves with a checksum, a rolling backup and a staged
 * write, plus the single resumable run checkpoint.
 *
 *   he.save.tmp  — staged copy written first (survives a crash mid-write)
 *   he.save.bak  — the previous good save, rotated before each write
 *   he.save      — the latest good save
 *
 * Load order: main → backup → staged → fresh. Every loaded save is migrated
 * to the current version and sanitized against the live catalog. Run
 * settlement is recorded by run ID in the same write that changes balances,
 * so a reloaded or duplicated checkpoint can never pay twice.
 */
(function (root) {
  'use strict';
  const HE = root.HE;
  const D = HE.data;
  const U = HE.util;

  const VERSION = 1;
  const FORMAT = 'house-edge-save';
  const KEY = 'he.save';
  const BACKUP_KEY = 'he.save.bak';
  const TMP_KEY = 'he.save.tmp';
  const SETTLED_KEEP = 40;

  function defaultSettings() {
    return {
      shake: 1,
      flashes: true,
      hitStop: true,
      damageNumbers: true,
      effectDensity: 1,
      vibration: true,
      music: 0.55,
      sfx: 0.8,
      ui: 0.7,
      autoFire: false,
      aimAssist: false,
      alwaysShowHitbox: false,
    };
  }

  function defaultBindings() {
    return {
      up: 'KeyW',
      down: 'KeyS',
      left: 'KeyA',
      right: 'KeyD',
      dash: 'Space',
      spin: 'KeyQ',
      interact: 'KeyE',
      precision: 'ShiftLeft',
      ledger: 'Tab',
      pause: 'Escape',
    };
  }

  function createDefault(now) {
    const t = now == null ? Date.now() : now;
    const facilities = {};
    for (const f of D.facilities) facilities[f.id] = HE.Facilities.createState(t);
    const upgrades = {};
    for (const u of D.accountUpgrades) upgrades[u.id] = 0;
    return {
      version: VERSION,
      createdAt: t,
      savedAt: t,
      account: { banked: 0, lifetimeBanked: 0, lifetimeFacility: 0, runs: 0, wins: 0, defeats: 0, bestFloor: 0, firstClears: {} },
      facilities,
      upgrades,
      presets: { loaded_seven: false },
      discovered: { recipes: [], perks: [] },
      settings: defaultSettings(),
      bindings: defaultBindings(),
      tutorialDone: false,
      checkpoint: null,
      settledRuns: [],
      records: { bestRunChips: 0, bestTime: 0 },
      stats: { kills: 0, spins: 0, jackpots: 0, grazes: 0, recipesTriggered: 0 },
    };
  }

  /** Migrations keyed by the version they upgrade from. */
  const MIGRATIONS = {
    // 0 → 1: pre-release saves had a flat `chips` balance and no facilities.
    0(s) {
      const out = createDefault(s.createdAt);
      if (U.isNum(s.chips)) out.account.banked = Math.max(0, Math.floor(s.chips));
      if (s.settings) Object.assign(out.settings, s.settings);
      out.version = 1;
      return out;
    },
  };

  function migrate(s) {
    let cur = s;
    let v = U.isNum(cur.version) ? cur.version : 0;
    while (v < VERSION) {
      const m = MIGRATIONS[v];
      if (!m) throw new Error('no migration from v' + v);
      cur = m(cur);
      v = cur.version;
    }
    return cur;
  }

  const nonNegInt = (v, d) => (U.isNum(v) && v >= 0 ? Math.floor(v) : d);

  /** Clamps every field to a legal value against the live catalog. */
  function sanitize(s, now) {
    const d = createDefault(now);
    const out = d;
    const a = s.account || {};
    out.createdAt = U.isNum(s.createdAt) ? s.createdAt : d.createdAt;
    out.savedAt = U.isNum(s.savedAt) ? s.savedAt : d.savedAt;
    out.account.banked = nonNegInt(a.banked, 0);
    out.account.lifetimeBanked = Math.max(out.account.banked, nonNegInt(a.lifetimeBanked, 0));
    out.account.lifetimeFacility = nonNegInt(a.lifetimeFacility, 0);
    out.account.runs = nonNegInt(a.runs, 0);
    out.account.wins = nonNegInt(a.wins, 0);
    out.account.defeats = nonNegInt(a.defeats, 0);
    out.account.bestFloor = nonNegInt(a.bestFloor, 0);
    if (a.firstClears && typeof a.firstClears === 'object') {
      for (const k of Object.keys(a.firstClears)) if (a.firstClears[k] === true) out.account.firstClears[k] = true;
    }
    for (const f of D.facilities) {
      const src = s.facilities && s.facilities[f.id];
      if (src) {
        out.facilities[f.id].level = U.clamp(nonNegInt(src.level, 0), 0, f.maxLevel);
        out.facilities[f.id].stored = U.isNum(src.stored) && src.stored > 0 ? src.stored : 0;
        out.facilities[f.id].lastTick = U.isNum(src.lastTick) ? src.lastTick : out.facilities[f.id].lastTick;
        const cap = HE.Facilities.cap(f, out.facilities[f.id].level);
        if (out.facilities[f.id].stored > cap) out.facilities[f.id].stored = cap;
      }
    }
    for (const u of D.accountUpgrades) {
      const v = s.upgrades && s.upgrades[u.id];
      out.upgrades[u.id] = U.clamp(nonNegInt(v, 0), 0, u.costs.length);
    }
    if (s.presets) out.presets.loaded_seven = !!s.presets.loaded_seven;
    if (s.discovered) {
      out.discovered.recipes = (s.discovered.recipes || []).filter((id) => D.recipeById[id]);
      out.discovered.perks = (s.discovered.perks || []).filter((id) => D.perkById[id]);
    }
    if (s.settings) {
      const st = s.settings;
      for (const k of Object.keys(out.settings)) {
        if (typeof st[k] === typeof out.settings[k]) out.settings[k] = st[k];
      }
      out.settings.shake = U.clamp(out.settings.shake, 0, 1);
      out.settings.effectDensity = U.clamp(out.settings.effectDensity, 0.25, 1);
      for (const k of ['music', 'sfx', 'ui']) out.settings[k] = U.clamp(out.settings[k], 0, 1);
    }
    if (s.bindings) {
      for (const k of Object.keys(out.bindings)) if (typeof s.bindings[k] === 'string' && s.bindings[k]) out.bindings[k] = s.bindings[k];
    }
    out.tutorialDone = !!s.tutorialDone;
    out.checkpoint = s.checkpoint && typeof s.checkpoint === 'object' && typeof s.checkpoint.runId === 'string' ? s.checkpoint : null;
    out.settledRuns = Array.isArray(s.settledRuns) ? s.settledRuns.filter((x) => typeof x === 'string').slice(-SETTLED_KEEP) : [];
    if (out.checkpoint && out.settledRuns.includes(out.checkpoint.runId)) out.checkpoint = null;
    if (s.records) {
      out.records.bestRunChips = nonNegInt(s.records.bestRunChips, 0);
      out.records.bestTime = nonNegInt(s.records.bestTime, 0);
    }
    if (s.stats) for (const k of Object.keys(out.stats)) out.stats[k] = nonNegInt(s.stats[k], 0);
    return out;
  }

  function encode(save) {
    const body = JSON.stringify(save);
    return JSON.stringify({ format: FORMAT, version: save.version, checksum: U.hash32(body), body });
  }

  function decode(raw) {
    if (!raw) return null;
    try {
      const env = JSON.parse(raw);
      if (!env || env.format !== FORMAT || typeof env.body !== 'string') return null;
      if (env.checksum !== U.hash32(env.body)) return null;
      return JSON.parse(env.body);
    } catch (e) {
      return null;
    }
  }

  class SaveSystem {
    constructor(storage, now) {
      this.storage = storage || null;
      this.now = now || (() => Date.now());
      this.lastError = null;
      this.lastSource = 'fresh';
    }

    load() {
      const t = this.now();
      if (!this.storage) return createDefault(t);
      for (const [key, source] of [
        [KEY, 'main'],
        [BACKUP_KEY, 'backup'],
        [TMP_KEY, 'staged'],
      ]) {
        let raw = null;
        try {
          raw = this.storage.getItem(key);
        } catch (e) {
          raw = null;
        }
        const parsed = decode(raw);
        if (!parsed) continue;
        try {
          const s = sanitize(migrate(parsed), t);
          this.lastSource = source;
          return s;
        } catch (e) {
          continue;
        }
      }
      this.lastSource = 'fresh';
      return createDefault(t);
    }

    /** Staged write: tmp → rotate main into backup → main → drop tmp. */
    write(save) {
      if (!this.storage) return true;
      save.savedAt = this.now();
      const data = encode(save);
      try {
        this.storage.setItem(TMP_KEY, data);
        const prev = this.storage.getItem(KEY);
        if (prev && decode(prev)) this.storage.setItem(BACKUP_KEY, prev);
        this.storage.setItem(KEY, data);
        this.storage.removeItem(TMP_KEY);
        this.lastError = null;
        return true;
      } catch (e) {
        this.lastError = e && e.message ? e.message : String(e);
        return false;
      }
    }

    wipe() {
      if (!this.storage) return;
      for (const k of [KEY, BACKUP_KEY, TMP_KEY]) {
        try {
          this.storage.removeItem(k);
        } catch (e) {
          /* ignore */
        }
      }
    }
  }

  /** Records a run as settled; returns false if it was already settled. */
  function markSettled(save, runId) {
    if (save.settledRuns.includes(runId)) return false;
    save.settledRuns.push(runId);
    if (save.settledRuns.length > SETTLED_KEEP) save.settledRuns.splice(0, save.settledRuns.length - SETTLED_KEEP);
    return true;
  }

  HE.SaveSystem = SaveSystem;
  HE.Save = { VERSION, KEY, BACKUP_KEY, TMP_KEY, createDefault, defaultSettings, defaultBindings, sanitize, migrate, encode, decode, markSettled };
})(typeof window !== 'undefined' ? window : globalThis);
