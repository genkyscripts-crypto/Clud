/*
 * ZERO TO ARMORY — core namespace, math helpers and the event bus.
 *
 * Every script attaches to the single global `ZTA` object. Classic scripts
 * (not ES modules) are used on purpose so the game runs from file:// with a
 * double-click, without a local server.
 */
(function (root) {
  'use strict';

  const ZTA = root.ZTA || (root.ZTA = {});

  const util = {
    clamp(v, min, max) {
      return v < min ? min : v > max ? max : v;
    },
    lerp(a, b, t) {
      return a + (b - a) * t;
    },
    invLerp(a, b, v) {
      return a === b ? 0 : (v - a) / (b - a);
    },
    /** Frame-rate independent exponential smoothing toward a target. */
    damp(current, target, lambda, dt) {
      return target + (current - target) * Math.exp(-lambda * dt);
    },
    approach(current, target, maxDelta) {
      if (current < target) return Math.min(current + maxDelta, target);
      return Math.max(current - maxDelta, target);
    },
    easeOutCubic(t) {
      const u = 1 - t;
      return 1 - u * u * u;
    },
    easeInCubic(t) {
      return t * t * t;
    },
    easeOutBack(t) {
      const c1 = 1.70158;
      const c3 = c1 + 1;
      const u = t - 1;
      return 1 + c3 * u * u * u + c1 * u * u;
    },
    deg2rad(d) {
      return (d * Math.PI) / 180;
    },
    /** FNV-1a 32-bit hash, used for save checksums and stable seeds. */
    hash32(str) {
      let h = 0x811c9dc5;
      for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
      }
      return (h >>> 0).toString(16).padStart(8, '0');
    },
    deepFreeze(obj) {
      if (obj && typeof obj === 'object' && !Object.isFrozen(obj)) {
        Object.freeze(obj);
        for (const key of Object.keys(obj)) util.deepFreeze(obj[key]);
      }
      return obj;
    },
    isFiniteNumber(v) {
      return typeof v === 'number' && Number.isFinite(v);
    },
  };

  /** Small seedable PRNG (mulberry32) so encounters can be reproduced in tests. */
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
      /** Uniform point in a unit disc, returned as [x, y]. */
      disc() {
        const a = next() * Math.PI * 2;
        const r = Math.sqrt(next());
        return [Math.cos(a) * r, Math.sin(a) * r];
      },
    };
  }

  /**
   * Minimal synchronous event bus. A throwing listener is logged and skipped so
   * one broken UI widget can never stall the simulation or block a reward.
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
      for (const fn of Array.from(set)) {
        try {
          fn(payload);
        } catch (err) {
          if (typeof console !== 'undefined') console.error('[ZTA] listener for "' + type + '" failed', err);
        }
      }
    }
    clear() {
      this._map.clear();
    }
  }

  ZTA.util = util;
  ZTA.createRng = createRng;
  ZTA.Emitter = Emitter;
  ZTA.data = ZTA.data || {};
  ZTA.UI = ZTA.UI || {};
})(typeof window !== 'undefined' ? window : globalThis);
