/*
 * Object pools. Everything spawned often (targets, particles, decals, damage
 * numbers) lives in a fixed-capacity pool so memory and draw cost stay bounded
 * during long sessions.
 */
(function (root) {
  'use strict';
  const ZTA = root.ZTA;

  /**
   * Fixed-capacity pool that never grows. When full, `spawn()` recycles the
   * slot at the cursor (roughly the oldest effect), so bursts degrade
   * gracefully instead of allocating.
   */
  class RingPool {
    constructor(capacity, factory) {
      this.capacity = capacity;
      this.items = new Array(capacity);
      for (let i = 0; i < capacity; i++) {
        const item = factory();
        item.alive = false;
        this.items[i] = item;
      }
      this.cursor = 0;
    }
    spawn() {
      const n = this.capacity;
      for (let i = 0; i < n; i++) {
        const idx = (this.cursor + i) % n;
        const item = this.items[idx];
        if (!item.alive) {
          this.cursor = (idx + 1) % n;
          item.alive = true;
          return item;
        }
      }
      const item = this.items[this.cursor];
      this.cursor = (this.cursor + 1) % n;
      item.alive = true;
      return item;
    }
    forEachAlive(fn) {
      const items = this.items;
      for (let i = 0; i < items.length; i++) if (items[i].alive) fn(items[i]);
    }
    countAlive() {
      let c = 0;
      for (let i = 0; i < this.items.length; i++) if (this.items[i].alive) c++;
      return c;
    }
    clear() {
      for (let i = 0; i < this.items.length; i++) this.items[i].alive = false;
    }
  }

  /**
   * Free-list pool with a hard cap. `acquire()` returns null when the cap is
   * reached; callers must handle that (the wave director simply spawns fewer).
   */
  class CappedPool {
    constructor(capacity, factory) {
      this.capacity = capacity;
      this.free = [];
      this.active = [];
      for (let i = 0; i < capacity; i++) this.free.push(factory());
    }
    acquire() {
      const item = this.free.pop();
      if (!item) return null;
      this.active.push(item);
      return item;
    }
    release(item) {
      const idx = this.active.indexOf(item);
      if (idx === -1) return false;
      this.active.splice(idx, 1);
      this.free.push(item);
      return true;
    }
    releaseAll() {
      while (this.active.length) this.free.push(this.active.pop());
    }
  }

  ZTA.RingPool = RingPool;
  ZTA.CappedPool = CappedPool;
})(typeof window !== 'undefined' ? window : globalThis);
