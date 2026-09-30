/*
 * Allocation-free containers for things spawned every frame: projectiles,
 * hostile bullets, enemies, pickups, zones and cosmetic particles.
 *
 * DensePool keeps live objects packed at the front of a preallocated array.
 * Iterate backwards (i = n-1 … 0) and call kill(i) freely: the last live item
 * is swapped into the hole, so nothing is skipped and nothing is allocated.
 */
(function (root) {
  'use strict';
  const HE = root.HE;

  class DensePool {
    constructor(capacity, factory) {
      this.capacity = capacity;
      this.items = new Array(capacity);
      for (let i = 0; i < capacity; i++) this.items[i] = factory();
      this.n = 0;
      /** How many spawns were refused because the pool was full. */
      this.refused = 0;
    }
    /** Returns a recycled object, or null when full (callers must handle it). */
    spawn() {
      if (this.n >= this.capacity) {
        this.refused++;
        return null;
      }
      return this.items[this.n++];
    }
    kill(i) {
      const last = --this.n;
      if (i !== last) {
        const tmp = this.items[i];
        this.items[i] = this.items[last];
        this.items[last] = tmp;
      }
    }
    clear() {
      this.n = 0;
    }
    get count() {
      return this.n;
    }
  }

  /**
   * Uniform grid over the arena, rebuilt every frame from the enemy pool.
   * Each enemy is filed under the cell holding its center; queries widen the
   * search by the largest enemy radius so edge overlaps are never missed.
   */
  class SpatialGrid {
    constructor(width, height, cell) {
      this.cell = cell;
      this.cols = Math.ceil(width / cell) + 1;
      this.rows = Math.ceil(height / cell) + 1;
      this.cells = new Array(this.cols * this.rows);
      for (let i = 0; i < this.cells.length; i++) this.cells[i] = [];
      this.maxRadius = 0;
    }
    clear() {
      for (let i = 0; i < this.cells.length; i++) this.cells[i].length = 0;
      this.maxRadius = 0;
    }
    _index(x, y) {
      let cx = Math.floor(x / this.cell);
      let cy = Math.floor(y / this.cell);
      if (cx < 0) cx = 0;
      else if (cx >= this.cols) cx = this.cols - 1;
      if (cy < 0) cy = 0;
      else if (cy >= this.rows) cy = this.rows - 1;
      return cy * this.cols + cx;
    }
    insert(obj) {
      this.cells[this._index(obj.x, obj.y)].push(obj);
      if (obj.r > this.maxRadius) this.maxRadius = obj.r;
    }
    /** Pushes every object whose cell overlaps the query circle into `out`. */
    query(x, y, radius, out) {
      out.length = 0;
      const r = radius + this.maxRadius;
      let x0 = Math.floor((x - r) / this.cell);
      let x1 = Math.floor((x + r) / this.cell);
      let y0 = Math.floor((y - r) / this.cell);
      let y1 = Math.floor((y + r) / this.cell);
      if (x0 < 0) x0 = 0;
      if (y0 < 0) y0 = 0;
      if (x1 >= this.cols) x1 = this.cols - 1;
      if (y1 >= this.rows) y1 = this.rows - 1;
      for (let cy = y0; cy <= y1; cy++) {
        for (let cx = x0; cx <= x1; cx++) {
          const cell = this.cells[cy * this.cols + cx];
          for (let i = 0; i < cell.length; i++) out.push(cell[i]);
        }
      }
      return out;
    }
  }

  HE.DensePool = DensePool;
  HE.SpatialGrid = SpatialGrid;
})(typeof window !== 'undefined' ? window : globalThis);
