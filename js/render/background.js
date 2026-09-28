/*
 * The static range, pre-rendered once per resize into an offscreen canvas with
 * a margin, then blitted each frame at the recoil offset. Paper walls with
 * halftone light falloff, a concrete floor, an overhead carrier for the
 * plates, runner rails, and distance plaques at each firing row.
 */
(function (root) {
  'use strict';
  const ZTA = root.ZTA;
  const P = ZTA.palette;
  const paint = ZTA.paint;
  const U = ZTA.util;

  const LIGHTS_Z = [4, 8, 12, 16];

  class Background {
    constructor() {
      this.canvas = document.createElement('canvas');
      this.M = 0;
    }

    build(camera, W, H, dpr) {
      const range = camera.range;
      const M = Math.ceil(Math.tan(U.deg2rad(4.6)) * camera.f) + 24;
      this.M = M;
      this.dpr = dpr;
      const c = this.canvas;
      c.width = Math.ceil((W + 2 * M) * dpr);
      c.height = Math.ceil((H + 2 * M) * dpr);
      const g = c.getContext('2d');
      g.setTransform(dpr, 0, 0, dpr, M * dpr, M * dpr);

      const hw = range.halfWidth;
      const top = range.ceiling;
      const back = range.backZ;
      const zn = 0.6;
      const pr = (x, y, z) => camera.project(x, y, z, {}, true);
      const poly = (pts) => {
        g.beginPath();
        pts.forEach((p, i) => (i ? g.lineTo(p.sx, p.sy) : g.moveTo(p.sx, p.sy)));
        g.closePath();
      };
      const x0 = -M;
      const y0 = -M;
      const x1 = W + M;
      const y1 = H + M;
      const f = camera.f;
      const cx = camera.cx;
      const cy = camera.cy;
      const eye = camera.eyeH;

      // Ceiling void.
      g.fillStyle = P.ink2;
      g.fillRect(x0, y0, x1 - x0, y1 - y0);

      // Back wall: paper with a dark rubber berm along the bottom.
      const bw = [pr(-hw, 0, back), pr(hw, 0, back), pr(hw, top, back), pr(-hw, top, back)];
      poly(bw);
      g.fillStyle = P.paper;
      g.fill();
      g.save();
      poly(bw);
      g.clip();
      const bermTop = pr(0, 0.72, back).sy;
      paint.dots(g, bw[0].sx, bw[2].sy, bw[1].sx, bw[0].sy, 4, (x, y) => {
        if (y > bermTop) return 0.62;
        const t = (y - bw[2].sy) / (bermTop - bw[2].sy);
        const edge = Math.abs(x - cx) / ((bw[1].sx - bw[0].sx) / 2);
        return 0.05 + 0.18 * Math.pow(edge, 3) + 0.12 * Math.pow(1 - t, 4);
      }, P.graphite);
      g.strokeStyle = P.ink;
      g.lineWidth = 1.5;
      g.beginPath();
      g.moveTo(bw[0].sx, bermTop);
      g.lineTo(bw[1].sx, bermTop);
      g.stroke();
      // Faint baffle seams on the backstop.
      g.globalAlpha = 0.18;
      for (let x = -hw + 1.2; x < hw; x += 1.2) {
        const a = pr(x, 0.72, back);
        const b = pr(x, top, back);
        g.beginPath();
        g.moveTo(a.sx, a.sy);
        g.lineTo(b.sx, b.sy);
        g.stroke();
      }
      g.globalAlpha = 1;
      // Stenciled range name.
      const label = pr(0, 2.2, back);
      g.fillStyle = paint.rgba(P.ink, 0.13);
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.font = '800 ' + Math.round(0.62 * label.s) + "px 'Big Shoulders Stencil Display', 'Arial Narrow', Impact, sans-serif";
      g.fillText('RANGE 01', label.sx, label.sy);
      g.restore();

      // Side walls.
      for (const side of [-1, 1]) {
        const x = side * hw;
        const wall = [pr(x, 0, zn), pr(x, top, zn), pr(x, top, back), pr(x, 0, back)];
        poly(wall);
        g.fillStyle = P.paper;
        g.fill();
        g.save();
        poly(wall);
        g.clip();
        const xa = side < 0 ? x0 : wall[3].sx;
        const xb = side < 0 ? wall[3].sx : x1;
        paint.dots(g, xa, y0, xb, y1, 5, (sx, sy) => {
          const dx = sx - cx;
          if (dx === 0) return 0;
          const z = (x * f) / dx;
          if (z <= 0) return 0;
          const y = eye - ((sy - cy) * z) / f;
          const near = U.clamp(1 - (z - 1) / 7, 0, 1);
          const floor = U.clamp(1 - y / 0.7, 0, 1);
          const ceil = U.clamp((y - 2.5) / 0.5, 0, 1);
          return 0.06 + 0.42 * near * near + 0.3 * floor * floor + 0.25 * ceil;
        }, P.graphite);
        // Acoustic panel seams and a baseboard.
        g.strokeStyle = paint.rgba(P.ink, 0.22);
        g.lineWidth = 1;
        for (let z = 2; z < back; z += 1.5) {
          const a = pr(x, 0, z);
          const b = pr(x, top, z);
          g.beginPath();
          g.moveTo(a.sx, a.sy);
          g.lineTo(b.sx, b.sy);
          g.stroke();
        }
        const b0 = pr(x, 0.28, zn);
        const b1 = pr(x, 0.28, back);
        g.strokeStyle = paint.rgba(P.ink, 0.5);
        g.lineWidth = 1.5;
        g.beginPath();
        g.moveTo(b0.sx, b0.sy);
        g.lineTo(b1.sx, b1.sy);
        g.stroke();
        g.restore();
        // Distance plaques at each firing row.
        for (const key of Object.keys(range.rows)) {
          const row = range.rows[key];
          const p = pr(x, 2.45, row.z);
          const s = p.s;
          const w = 0.4 * s;
          const h = 0.2 * s;
          const px = p.sx - (side < 0 ? 0 : w);
          g.fillStyle = P.ink;
          g.fillRect(px, p.sy - h / 2, w, h);
          g.fillStyle = P.paper;
          g.font = '800 ' + Math.max(8, Math.round(0.15 * s)) + "px 'Big Shoulders Display', 'Arial Narrow', Impact, sans-serif";
          g.textAlign = 'center';
          g.textBaseline = 'middle';
          g.fillText(row.label, px + w / 2, p.sy + 1);
        }
      }

      // Floor: concrete with light pools under the fixtures.
      const fl = [pr(-hw, 0, zn), pr(hw, 0, zn), pr(hw, 0, back), pr(-hw, 0, back)];
      poly(fl);
      g.fillStyle = P.paperDim;
      g.fill();
      g.save();
      poly(fl);
      g.clip();
      paint.dots(g, x0, fl[2].sy, x1, y1, 5, (sx, sy) => {
        const dy = sy - cy;
        if (dy <= 0) return 0;
        const z = (eye * f) / dy;
        const x = ((sx - cx) * z) / f;
        let light = 0;
        for (const lz of LIGHTS_Z) {
          const d2 = (z - lz) * (z - lz) * 0.35 + x * x * 0.5;
          light = Math.max(light, Math.exp(-d2));
        }
        const far = U.clamp((z - 6) / 12, 0, 1);
        const wall = U.clamp((Math.abs(x) - 2.4) / 1.2, 0, 1);
        return 0.22 + 0.25 * far + 0.3 * wall * wall - 0.2 * light;
      }, P.graphite);
      // Lane lines.
      g.strokeStyle = paint.rgba(P.ink, 0.28);
      g.lineWidth = 1.5;
      for (const lx of [-2.4, -1.2, 0, 1.2, 2.4]) {
        const a = pr(lx, 0, zn);
        const b = pr(lx, 0, back);
        g.beginPath();
        g.moveTo(a.sx, a.sy);
        g.lineTo(b.sx, b.sy);
        g.stroke();
      }
      // Row lines with painted distances.
      for (const key of Object.keys(range.rows)) {
        const row = range.rows[key];
        const a = pr(-hw, 0, row.z);
        const b = pr(hw, 0, row.z);
        g.strokeStyle = paint.rgba(P.ink, 0.45);
        g.lineWidth = Math.max(1, 0.05 * a.s);
        g.beginPath();
        g.moveTo(a.sx, a.sy);
        g.lineTo(b.sx, b.sy);
        g.stroke();
      }
      // Runner rails.
      for (const key of Object.keys(range.rails)) {
        const rail = range.rails[key];
        for (const dz of [-0.07, 0.07]) {
          const a = pr(rail.xMin - 0.2, 0, rail.z + dz);
          const b = pr(rail.xMax + 0.2, 0, rail.z + dz);
          g.strokeStyle = P.ink;
          g.lineWidth = Math.max(1.5, 0.035 * a.s);
          g.beginPath();
          g.moveTo(a.sx, a.sy);
          g.lineTo(b.sx, b.sy);
          g.stroke();
        }
        for (const ex of [rail.xMin - 0.25, rail.xMax + 0.25]) {
          const p = pr(ex, 0, rail.z);
          g.fillStyle = P.ink;
          g.fillRect(p.sx - 0.07 * p.s, p.sy - 0.12 * p.s, 0.14 * p.s, 0.14 * p.s);
        }
      }
      g.restore();

      // Overhead plate carriers.
      for (const key of Object.keys(range.rows)) {
        const row = range.rows[key];
        const a = pr(-hw, range.carrierY + 0.035, row.z);
        const b = pr(hw, range.carrierY - 0.035, row.z);
        g.fillStyle = P.ink;
        g.fillRect(a.sx, a.sy, b.sx - a.sx, Math.max(2, b.sy - a.sy));
        g.fillStyle = paint.rgba(P.paperHi, 0.55);
        g.fillRect(a.sx, a.sy, b.sx - a.sx, 1);
      }

      // Ceiling baffles and light bars (far to near).
      for (let z = back - 1.5; z >= 1.5; z -= 2) {
        const a = pr(-hw, top, z);
        const b = pr(hw, top - 0.26, z);
        g.fillStyle = P.charcoal;
        g.fillRect(a.sx, a.sy, b.sx - a.sx, b.sy - a.sy);
        g.fillStyle = paint.rgba(P.paper, 0.2);
        g.fillRect(a.sx, b.sy - 1, b.sx - a.sx, 1);
      }
      for (const lz of LIGHTS_Z) {
        const q = [pr(-0.7, top - 0.02, lz - 0.2), pr(0.7, top - 0.02, lz - 0.2), pr(0.7, top - 0.02, lz + 0.2), pr(-0.7, top - 0.02, lz + 0.2)];
        const center = pr(0, top - 0.05, lz);
        const glow = g.createRadialGradient(center.sx, center.sy, 0, center.sx, center.sy, 1.4 * center.s);
        glow.addColorStop(0, paint.rgba(P.paperHi, 0.28));
        glow.addColorStop(1, paint.rgba(P.paperHi, 0));
        g.fillStyle = glow;
        g.fillRect(center.sx - 1.4 * center.s, center.sy - 1.4 * center.s, 2.8 * center.s, 2.8 * center.s);
        poly(q);
        g.fillStyle = P.paperHi;
        g.fill();
      }
    }

    draw(ctx, offX, offY) {
      const c = this.canvas;
      ctx.drawImage(c, -this.M + offX, -this.M + offY, c.width / this.dpr, c.height / this.dpr);
    }
  }

  ZTA.Background = Background;
})(typeof window !== 'undefined' ? window : globalThis);
