/*
 * Cosmetic effect state: particles, rings, lightning lines, floating text.
 *
 * Pure data, no canvas. Uses Math.random only, never a content RNG stream, so
 * spawning more or fewer particles (effect density setting) can never change
 * a slot result, a draft or an encounter. Capacity is fixed; when full, new
 * cosmetic effects are dropped — hostile telegraphs are not drawn from here.
 */
(function (root) {
  'use strict';
  const HE = root.HE;

  class FX {
    constructor() {
      this.density = 1;
      this.particles = new HE.DensePool(1400, () => ({ x: 0, y: 0, vx: 0, vy: 0, life: 0, max: 1, size: 2, color: '#fff', drag: 0, kind: 0 }));
      this.rings = new HE.DensePool(160, () => ({ x: 0, y: 0, r0: 0, r1: 0, life: 0, max: 1, color: '#fff', width: 2 }));
      this.lines = new HE.DensePool(200, () => ({ x1: 0, y1: 0, x2: 0, y2: 0, life: 0, max: 1, color: '#fff', width: 2, seed: 0, jag: 1 }));
      this.texts = new HE.DensePool(90, () => ({ x: 0, y: 0, vy: 0, text: '', life: 0, max: 1, color: '#fff', size: 14 }));
    }

    clear() {
      this.particles.clear();
      this.rings.clear();
      this.lines.clear();
      this.texts.clear();
    }

    burst(x, y, count, color, speed, life, size) {
      const n = Math.max(1, Math.round(count * this.density));
      for (let i = 0; i < n; i++) {
        const p = this.particles.spawn();
        if (!p) return;
        const a = Math.random() * Math.PI * 2;
        const s = (speed || 160) * (0.35 + Math.random() * 0.8);
        p.x = x;
        p.y = y;
        p.vx = Math.cos(a) * s;
        p.vy = Math.sin(a) * s;
        p.max = p.life = (life || 0.45) * (0.6 + Math.random() * 0.6);
        p.size = (size || 2.2) * (0.6 + Math.random() * 0.8);
        p.color = color;
        p.drag = 4;
        p.kind = 0;
      }
    }

    spray(x, y, angle, spread, count, color, speed, life) {
      const n = Math.max(1, Math.round(count * this.density));
      for (let i = 0; i < n; i++) {
        const p = this.particles.spawn();
        if (!p) return;
        const a = angle + (Math.random() - 0.5) * spread;
        const s = speed * (0.5 + Math.random() * 0.7);
        p.x = x;
        p.y = y;
        p.vx = Math.cos(a) * s;
        p.vy = Math.sin(a) * s;
        p.max = p.life = life * (0.6 + Math.random() * 0.5);
        p.size = 1.6 + Math.random() * 1.6;
        p.color = color;
        p.drag = 6;
        p.kind = 1;
      }
    }

    ring(x, y, r0, r1, life, color, width) {
      const r = this.rings.spawn();
      if (!r) return;
      r.x = x;
      r.y = y;
      r.r0 = r0;
      r.r1 = r1;
      r.max = r.life = life;
      r.color = color;
      r.width = width || 2;
    }

    bolt(x1, y1, x2, y2, color, life, width) {
      const l = this.lines.spawn();
      if (!l) return;
      l.x1 = x1;
      l.y1 = y1;
      l.x2 = x2;
      l.y2 = y2;
      l.color = color;
      l.max = l.life = life || 0.18;
      l.width = width || 2;
      l.seed = Math.random() * 1000;
      l.jag = 1;
    }

    beam(x1, y1, x2, y2, color, life, width) {
      this.bolt(x1, y1, x2, y2, color, life, width);
      const l = this.lines.items[this.lines.n - 1];
      if (l) l.jag = 0;
    }

    text(x, y, str, color, size, life) {
      const t = this.texts.spawn();
      if (!t) return;
      t.x = x + (Math.random() - 0.5) * 10;
      t.y = y;
      t.vy = -46;
      t.text = str;
      t.color = color;
      t.size = size || 14;
      t.max = t.life = life || 0.7;
    }

    update(dt) {
      const P = this.particles;
      for (let i = P.n - 1; i >= 0; i--) {
        const p = P.items[i];
        p.life -= dt;
        if (p.life <= 0) {
          P.kill(i);
          continue;
        }
        const k = Math.exp(-p.drag * dt);
        p.vx *= k;
        p.vy *= k;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
      }
      for (const pool of [this.rings, this.lines]) {
        for (let i = pool.n - 1; i >= 0; i--) {
          const r = pool.items[i];
          r.life -= dt;
          if (r.life <= 0) pool.kill(i);
        }
      }
      const T = this.texts;
      for (let i = T.n - 1; i >= 0; i--) {
        const t = T.items[i];
        t.life -= dt;
        if (t.life <= 0) {
          T.kill(i);
          continue;
        }
        t.y += t.vy * dt;
        t.vy *= Math.exp(-3 * dt);
      }
    }
  }

  HE.FX = FX;
})(typeof window !== 'undefined' ? window : globalThis);
