/*
 * HOUSE EDGE — core namespace, math helpers, seedable RNG streams and the
 * event bus.
 *
 * Every script attaches to the single global `HE` object. Classic scripts
 * (not ES modules) are used on purpose so the game runs from file:// with a
 * double-click, without a local server, and so the simulation can be loaded
 * headless into a Node VM for tests.
 */
(function (root) {
  'use strict';

  const HE = root.HE || (root.HE = {});

  const TAU = Math.PI * 2;

  const util = {
    TAU,
    clamp(v, min, max) {
      return v < min ? min : v > max ? max : v;
    },
    lerp(a, b, t) {
      return a + (b - a) * t;
    },
    /** Frame-rate independent exponential smoothing toward a target. */
    damp(current, target, lambda, dt) {
      return target + (current - target) * Math.exp(-lambda * dt);
    },
    approach(current, target, maxDelta) {
      if (current < target) return Math.min(current + maxDelta, target);
      return Math.max(current - maxDelta, target);
    },
    dist2(ax, ay, bx, by) {
      const dx = ax - bx;
      const dy = ay - by;
      return dx * dx + dy * dy;
    },
    /** Smallest signed difference between two angles, in (-PI, PI]. */
    angleDiff(a, b) {
      let d = (b - a) % TAU;
      if (d > Math.PI) d -= TAU;
      if (d <= -Math.PI) d += TAU;
      return d;
    },
    easeOutCubic(t) {
      const u = 1 - t;
      return 1 - u * u * u;
    },
    easeOutBack(t) {
      const c1 = 1.70158;
      const c3 = c1 + 1;
      const u = t - 1;
      return 1 + c3 * u * u * u + c1 * u * u;
    },
    /** Distance from point P to segment AB, squared. */
    segDist2(px, py, ax, ay, bx, by) {
      const abx = bx - ax;
      const aby = by - ay;
      const len2 = abx * abx + aby * aby;
      let t = len2 > 0 ? ((px - ax) * abx + (py - ay) * aby) / len2 : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const cx = ax + abx * t - px;
      const cy = ay + aby * t - py;
      return cx * cx + cy * cy;
    },
    /** FNV-1a 32-bit hash, used for save checksums and stable seeds. */
    hash32(str) {
      let h = 0x811c9dc5;
      for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
      }
      return h >>> 0;
    },
    deepFreeze(obj) {
      if (obj && typeof obj === 'object' && !Object.isFrozen(obj)) {
        Object.freeze(obj);
        for (const key of Object.keys(obj)) util.deepFreeze(obj[key]);
      }
      return obj;
    },
    isNum(v) {
      return typeof v === 'number' && Number.isFinite(v);
    },
  };

  /**
   * Seedable PRNG (mulberry32). Its whole state is one uint32, so a stream can
   * be saved in a checkpoint and resumed exactly. The game keeps separate
   * streams for encounters, loot/drafts and reels; cosmetic effects use
   * Math.random so particles can never change the next slot outcome.
   */
  function createRng(seed) {
    let s = seed >>> 0;
    const next = function () {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    return {
      next,
      range(min, max) {
        return min + (max - min) * next();
      },
      int(min, maxInclusive) {
        return min + Math.floor(next() * (maxInclusive - min + 1));
      },
      pick(arr) {
        return arr[Math.floor(next() * arr.length)];
      },
      chance(p) {
        return next() < p;
      },
      shuffle(arr) {
        for (let i = arr.length - 1; i > 0; i--) {
          const j = Math.floor(next() * (i + 1));
          const t = arr[i];
          arr[i] = arr[j];
          arr[j] = t;
        }
        return arr;
      },
      getState() {
        return s;
      },
      setState(v) {
        s = v >>> 0;
      },
    };
  }

  /** Derives a stable sub-seed for a named stream ("reels", "loot:2:1"…). */
  function subSeed(seed, label) {
    return (util.hash32(String(seed) + '|' + label) ^ 0x9e3779b9) >>> 0;
  }

  /**
   * Minimal synchronous event bus. A throwing listener is logged and skipped
   * so one broken UI widget can never stall the simulation or block a reward.
   */
  class Emitter {
    constructor() {
      this._map = new Map();
    }
    on(type, fn) {
      if (!this._map.has(type)) this._map.set(type, new Set());
      this._map.get(type).add(fn);
      return () => this.off(type, fn);
    }
    off(type, fn) {
      const set = this._map.get(type);
      if (set) set.delete(fn);
    }
    emit(type, payload) {
      const set = this._map.get(type);
      if (!set) return;
      for (const fn of set) {
        try {
          fn(payload);
        } catch (err) {
          if (typeof console !== 'undefined') console.error('[HE] listener for "' + type + '" failed', err);
        }
      }
    }
    clear() {
      this._map.clear();
    }
  }

  const fmt = {
    int(n) {
      return Math.floor(n).toLocaleString('en-US');
    },
    chips(n) {
      return Math.floor(n).toLocaleString('en-US');
    },
    pct(p, digits) {
      const d = digits == null ? 2 : digits;
      return (p * 100).toFixed(d) + '%';
    },
    /** "1 in 216" style odds for small probabilities. */
    odds(p) {
      if (p <= 0) return 'impossible';
      if (p >= 1) return 'certain';
      const n = 1 / p;
      return '1 in ' + (n >= 100 ? Math.round(n) : n.toFixed(1).replace(/\.0$/, ''));
    },
    duration(sec) {
      sec = Math.max(0, Math.floor(sec));
      const h = Math.floor(sec / 3600);
      const m = Math.floor((sec % 3600) / 60);
      const s = sec % 60;
      if (h > 0) return h + 'h ' + String(m).padStart(2, '0') + 'm';
      if (m > 0) return m + 'm ' + String(s).padStart(2, '0') + 's';
      return s + 's';
    },
    clock(sec) {
      sec = Math.max(0, Math.floor(sec));
      return Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0');
    },
  };

  HE.util = util;
  HE.createRng = createRng;
  HE.subSeed = subSeed;
  HE.Emitter = Emitter;
  HE.fmt = fmt;
  HE.data = HE.data || {};
  HE.UI = HE.UI || {};
})(typeof window !== 'undefined' ? window : globalThis);
