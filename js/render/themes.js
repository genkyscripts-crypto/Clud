/*
 * Range themes: one procedural painter per map, plus a foreground (the bench)
 * and light ambient animation. Painters draw into the cached background once
 * per resize; ambient layers draw every frame and stay cheap.
 *
 *   basement   Bench Lane: a lit basement range, paper walls, ink steel.
 *   rooftop    Rooftop 9: night skyline, floodlights, paper targets.
 *   scrapyard  Scrap Yard: overcast yard, car stacks, a dead crane.
 *   dock       Freight Dock: warehouse trusses, light shafts, open harbor door.
 *   vault      The Vault: arched tunnel, vault door, sweeping warning lamp.
 */
(function (root) {
  'use strict';
  const ZTA = root.ZTA;
  const P = ZTA.palette;
  const paint = ZTA.paint;
  const U = ZTA.util;
  const rgba = paint.rgba;

  /* ---------------------------------------------------------------- helpers */

  function makeEnv(g, cam, W, H, M, dpr) {
    const r = cam.range;
    const env = {
      g,
      cam,
      r,
      W,
      H,
      M,
      dpr,
      x0: -M,
      y0: -M,
      x1: W + M,
      y1: H + M,
      f: cam.f,
      cx: cam.cx,
      cy: cam.cy,
      eye: cam.eyeH,
      rng: ZTA.createRng(parseInt(ZTA.util.hash32(r.id), 16) ^ (r.index * 131)),
      pr: (x, y, z) => cam.project(x, y, Math.max(0.05, z), {}, true),
    };
    env.path = (pts) => {
      g.beginPath();
      pts.forEach((p, i) => (i ? g.lineTo(p.sx, p.sy) : g.moveTo(p.sx, p.sy)));
      g.closePath();
    };
    env.fill = (pts, color) => {
      env.path(pts);
      g.fillStyle = color;
      g.fill();
    };
    env.line = (a, b, color, width) => {
      g.strokeStyle = color;
      g.lineWidth = width;
      g.beginPath();
      g.moveTo(a.sx, a.sy);
      g.lineTo(b.sx, b.sy);
      g.stroke();
    };
    /** World (x, z) on the floor under a screen point, or null above the horizon. */
    env.floorAt = (sx, sy) => {
      const dy = sy - env.cy;
      if (dy <= 0) return null;
      const z = (env.eye * env.f) / dy;
      return { z, x: ((sx - env.cx) * z) / env.f };
    };
    /** World (z, y) on a side wall plane x = wx under a screen point. */
    env.wallAt = (wx, sx, sy) => {
      const dx = sx - env.cx;
      if (dx === 0) return null;
      const z = (wx * env.f) / dx;
      if (z <= 0) return null;
      return { z, y: env.eye - ((sy - env.cy) * z) / env.f };
    };
    env.text = (label, p, size, color, font) => {
      g.fillStyle = color;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.font = '800 ' + Math.max(8, Math.round(size)) + "px '" + (font || 'Big Shoulders Stencil Display') + "', 'Arial Narrow', Impact, sans-serif";
      g.fillText(label, p.sx, p.sy);
    };
    return env;
  }

  /** Floor quad, lane lines, row lines and runner rails shared by most maps. */
  function floorMarkings(env, lineColor, railColor, zNear, halfW) {
    const { g, r, pr } = env;
    const hw = halfW || r.halfWidth;
    g.save();
    g.strokeStyle = lineColor;
    g.lineWidth = 1.5;
    for (const lx of [-2.4, -1.2, 0, 1.2, 2.4]) {
      const a = pr(lx, 0, zNear);
      const b = pr(lx, 0, r.backZ);
      g.beginPath();
      g.moveTo(a.sx, a.sy);
      g.lineTo(b.sx, b.sy);
      g.stroke();
    }
    for (const key of Object.keys(r.rows)) {
      const row = r.rows[key];
      const a = pr(-hw, 0, row.z);
      const b = pr(hw, 0, row.z);
      g.lineWidth = Math.max(1, 0.05 * a.s);
      g.beginPath();
      g.moveTo(a.sx, a.sy);
      g.lineTo(b.sx, b.sy);
      g.stroke();
    }
    for (const key of Object.keys(r.rails)) {
      const rail = r.rails[key];
      for (const dz of [-0.07, 0.07]) {
        const a = pr(rail.xMin - 0.2, 0, rail.z + dz);
        const b = pr(rail.xMax + 0.2, 0, rail.z + dz);
        g.strokeStyle = railColor;
        g.lineWidth = Math.max(1.5, 0.035 * a.s);
        g.beginPath();
        g.moveTo(a.sx, a.sy);
        g.lineTo(b.sx, b.sy);
        g.stroke();
      }
      for (const ex of [rail.xMin - 0.25, rail.xMax + 0.25]) {
        const p = pr(ex, 0, rail.z);
        g.fillStyle = railColor;
        g.fillRect(p.sx - 0.07 * p.s, p.sy - 0.12 * p.s, 0.14 * p.s, 0.14 * p.s);
      }
    }
    g.restore();
  }

  /** Overhead carrier bars for the hanging plate rows. */
  function carriers(env, color, hiColor, posts) {
    const { g, r, pr } = env;
    const hw = r.halfWidth;
    for (const key of Object.keys(r.rows)) {
      const row = r.rows[key];
      const a = pr(-hw, r.carrierY + 0.035, row.z);
      const b = pr(hw, r.carrierY - 0.035, row.z);
      g.fillStyle = color;
      g.fillRect(a.sx, a.sy, b.sx - a.sx, Math.max(2, b.sy - a.sy));
      g.fillStyle = hiColor;
      g.fillRect(a.sx, a.sy, b.sx - a.sx, 1);
      if (posts) {
        for (const x of [-hw + 0.1, hw - 0.1]) {
          const t = pr(x - 0.04, r.carrierY, row.z);
          const f = pr(x + 0.04, 0, row.z);
          g.fillStyle = color;
          g.fillRect(t.sx, t.sy, Math.max(2, f.sx - t.sx), f.sy - t.sy);
        }
      }
    }
  }

  function plaques(env, x, color, textColor) {
    const { g, r, pr } = env;
    for (const key of Object.keys(r.rows)) {
      const row = r.rows[key];
      const p = pr(x, Math.min(2.45, (r.wallHeight || 2.6) - 0.3), row.z);
      const s = p.s;
      const w = 0.4 * s;
      const h = 0.2 * s;
      const px = p.sx - (x < 0 ? 0 : w);
      g.fillStyle = color;
      g.fillRect(px, p.sy - h / 2, w, h);
      g.fillStyle = textColor;
      g.font = '800 ' + Math.max(8, Math.round(0.15 * s)) + "px 'Big Shoulders Display', 'Arial Narrow', Impact, sans-serif";
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(row.label, px + w / 2, p.sy + 1);
    }
  }

  /** Halftone light pools on the floor under given (x, z) lights. */
  function floorDots(env, zNear, base, lights, color, extra) {
    const { g, x0, x1, y1, pr, r } = env;
    const far = pr(0, 0, r.backZ).sy;
    paint.dots(g, x0, far, x1, y1, 5, (sx, sy) => {
      const w = env.floorAt(sx, sy);
      if (!w || w.z < zNear) return 0;
      let light = 0;
      for (const L of lights) {
        const d2 = (w.z - L.z) * (w.z - L.z) * (L.kz || 0.35) + (w.x - L.x) * (w.x - L.x) * (L.kx || 0.5);
        light = Math.max(light, Math.exp(-d2));
      }
      return base(w) - (extra == null ? 0.2 : extra) * light;
    }, color);
  }

  /* ================================================================ basement */

  const basement = {
    tone: 'ink',
    fg: { top: P.charcoal, dots: rgba(P.ink, 0.6), edge: P.paperDim, label: rgba(P.paper, 0.32), text: 'LANE 01' },
    paint(env) {
      const { g, r, pr, x0, y0, x1, y1, cx } = env;
      const hw = r.halfWidth;
      const top = r.ceiling;
      const back = r.backZ;
      const zn = 0.6;
      g.fillStyle = P.ink2;
      g.fillRect(x0, y0, x1 - x0, y1 - y0);

      const bw = [pr(-hw, 0, back), pr(hw, 0, back), pr(hw, top, back), pr(-hw, top, back)];
      env.fill(bw, P.paper);
      g.save();
      env.path(bw);
      g.clip();
      const bermTop = pr(0, 0.72, back).sy;
      paint.dots(g, bw[0].sx, bw[2].sy, bw[1].sx, bw[0].sy, 4, (x, y) => {
        if (y > bermTop) return 0.62;
        const t = (y - bw[2].sy) / (bermTop - bw[2].sy);
        const edge = Math.abs(x - cx) / ((bw[1].sx - bw[0].sx) / 2);
        return 0.05 + 0.18 * Math.pow(edge, 3) + 0.12 * Math.pow(1 - t, 4);
      }, P.graphite);
      env.line({ sx: bw[0].sx, sy: bermTop }, { sx: bw[1].sx, sy: bermTop }, P.ink, 1.5);
      g.globalAlpha = 0.18;
      for (let x = -hw + 1.2; x < hw; x += 1.2) env.line(pr(x, 0.72, back), pr(x, top, back), P.ink, 1.5);
      g.globalAlpha = 1;
      env.text('RANGE 01', pr(0, 2.2, back), 0.62 * pr(0, 2.2, back).s, rgba(P.ink, 0.13));
      g.restore();

      for (const side of [-1, 1]) {
        const x = side * hw;
        const wall = [pr(x, 0, zn), pr(x, top, zn), pr(x, top, back), pr(x, 0, back)];
        env.fill(wall, P.paper);
        g.save();
        env.path(wall);
        g.clip();
        const xa = side < 0 ? x0 : wall[3].sx;
        const xb = side < 0 ? wall[3].sx : x1;
        paint.dots(g, xa, y0, xb, y1, 5, (sx, sy) => {
          const w = env.wallAt(x, sx, sy);
          if (!w) return 0;
          const near = U.clamp(1 - (w.z - 1) / 7, 0, 1);
          const floor = U.clamp(1 - w.y / 0.7, 0, 1);
          const ceil = U.clamp((w.y - 2.5) / 0.5, 0, 1);
          return 0.06 + 0.42 * near * near + 0.3 * floor * floor + 0.25 * ceil;
        }, P.graphite);
        g.globalAlpha = 0.22;
        for (let z = 2; z < back; z += 1.5) env.line(pr(x, 0, z), pr(x, top, z), P.ink, 1);
        g.globalAlpha = 1;
        env.line(pr(x, 0.28, zn), pr(x, 0.28, back), rgba(P.ink, 0.5), 1.5);
        g.restore();
        plaques(env, x, P.ink, P.paper);
      }

      const fl = [pr(-hw, 0, zn), pr(hw, 0, zn), pr(hw, 0, back), pr(-hw, 0, back)];
      env.fill(fl, P.paperDim);
      g.save();
      env.path(fl);
      g.clip();
      floorDots(env, 0.5, (w) => 0.22 + 0.25 * U.clamp((w.z - 6) / 12, 0, 1) + 0.3 * Math.pow(U.clamp((Math.abs(w.x) - 2.4) / 1.2, 0, 1), 2), [4, 8, 12, 16].map((z) => ({ x: 0, z })), P.graphite);
      floorMarkings(env, rgba(P.ink, 0.35), P.ink, zn);
      g.restore();

      carriers(env, P.ink, rgba(P.paperHi, 0.55));

      for (let z = back - 1.5; z >= 1.5; z -= 2) {
        const a = pr(-hw, top, z);
        const b = pr(hw, top - 0.26, z);
        g.fillStyle = P.charcoal;
        g.fillRect(a.sx, a.sy, b.sx - a.sx, b.sy - a.sy);
        g.fillStyle = rgba(P.paper, 0.2);
        g.fillRect(a.sx, b.sy - 1, b.sx - a.sx, 1);
      }
      for (const lz of [4, 8, 12, 16]) {
        const q = [pr(-0.7, top - 0.02, lz - 0.2), pr(0.7, top - 0.02, lz - 0.2), pr(0.7, top - 0.02, lz + 0.2), pr(-0.7, top - 0.02, lz + 0.2)];
        const c = pr(0, top - 0.05, lz);
        const glow = g.createRadialGradient(c.sx, c.sy, 0, c.sx, c.sy, 1.4 * c.s);
        glow.addColorStop(0, rgba(P.paperHi, 0.28));
        glow.addColorStop(1, rgba(P.paperHi, 0));
        g.fillStyle = glow;
        g.fillRect(c.sx - 1.4 * c.s, c.sy - 1.4 * c.s, 2.8 * c.s, 2.8 * c.s);
        env.fill(q, P.paperHi);
      }
    },
    ambient: {
      draw(ctx, cam, t) {
        // A tired fluorescent tube flickers now and then.
        const flick = Math.sin(t * 13) > 0.97 || (Math.sin(t * 0.7) > 0.995 && Math.sin(t * 40) > 0);
        if (!flick) return;
        const c = cam.project(0, cam.range.ceiling - 0.05, 12);
        ctx.fillStyle = rgba(P.ink, 0.5);
        ctx.fillRect(c.sx - 0.7 * c.s, c.sy - 0.2 * c.s, 1.4 * c.s, 0.4 * c.s);
      },
    },
  };

  /* ================================================================= rooftop */

  const rooftop = {
    tone: 'paper',
    fg: { top: '#1f1e1c', dots: rgba(P.paper, 0.07), edge: P.paperDim, label: rgba(P.paper, 0.3), text: 'ROOF 09' },
    paint(env) {
      const { g, r, pr, x0, y0, x1, y1, W, H, cy, rng } = env;
      const hw = r.halfWidth;
      const back = r.backZ;
      // Night sky.
      const sky = g.createLinearGradient(0, y0, 0, cy + 20);
      sky.addColorStop(0, '#0d0d0c');
      sky.addColorStop(1, '#2a2926');
      g.fillStyle = sky;
      g.fillRect(x0, y0, x1 - x0, y1 - y0);
      g.fillStyle = rgba(P.paperHi, 0.7);
      for (let i = 0; i < 140; i++) {
        const sx = x0 + rng.next() * (x1 - x0);
        const sy = y0 + rng.next() * (cy - y0 - 60);
        const rr = rng.next() < 0.1 ? 1.4 : 0.7;
        g.beginPath();
        g.arc(sx, sy, rr, 0, Math.PI * 2);
        g.fill();
      }
      // Moon with halftone shading.
      const mx = W * 0.78;
      const my = H * 0.12;
      const mr = H * 0.05;
      g.fillStyle = P.paper;
      g.beginPath();
      g.arc(mx, my, mr, 0, Math.PI * 2);
      g.fill();
      g.save();
      g.beginPath();
      g.arc(mx, my, mr, 0, Math.PI * 2);
      g.clip();
      paint.dots(g, mx - mr, my - mr, mx + mr, my + mr, 3, (sx, sy) => U.clamp((sx - mx + mr * 0.2) / mr, 0, 1) * 0.8, P.graphite);
      g.restore();
      // Skyline: three layers, far to near.
      const layers = [
        { z: 380, hMin: 8, hMax: 70, color: '#34322f', win: 0.25, wMin: 14, wMax: 40 },
        { z: 200, hMin: 4, hMax: 55, color: '#262522', win: 0.45, wMin: 12, wMax: 34 },
        { z: 110, hMin: -2, hMax: 30, color: '#1a1a18', win: 0.6, wMin: 10, wMax: 26 },
      ];
      for (const L of layers) {
        let x = -L.z * 1.4;
        while (x < L.z * 1.4) {
          const w = rng.range(L.wMin, L.wMax);
          const h = rng.range(L.hMin, L.hMax);
          const a = pr(x, h, L.z);
          const b = pr(x + w, -30, L.z);
          g.fillStyle = L.color;
          g.fillRect(a.sx, a.sy, b.sx - a.sx, b.sy - a.sy);
          // Lit windows.
          const cols = Math.max(1, Math.floor(w / 4));
          const rows = Math.max(1, Math.floor((h + 30) / 3.5));
          const ww = Math.max(1, ((b.sx - a.sx) / cols) * 0.35);
          const wh = Math.max(1, ((b.sy - a.sy) / rows) * 0.35);
          for (let c = 0; c < cols; c++) {
            for (let rr = 0; rr < rows; rr++) {
              if (rng.next() > L.win * 0.35) continue;
              g.fillStyle = rgba(P.paperHi, 0.35 + rng.next() * 0.5);
              g.fillRect(a.sx + ((b.sx - a.sx) / cols) * (c + 0.3), a.sy + ((b.sy - a.sy) / rows) * (rr + 0.3), ww, wh);
            }
          }
          if (rng.next() < 0.15) env.line(pr(x + w / 2, h, L.z), pr(x + w / 2, h + 12, L.z), L.color, 2);
          x += w + rng.range(2, 12);
        }
      }
      // Water tower on the next roof.
      const wt = { x: -14, z: 34, base: 1.5 };
      for (const lx of [-1.4, 1.4]) env.line(pr(wt.x + lx, wt.base, wt.z), pr(wt.x + lx * 0.6, wt.base + 5, wt.z), '#141413', 3);
      const tank = [pr(wt.x - 2, wt.base + 5, wt.z), pr(wt.x + 2, wt.base + 5, wt.z), pr(wt.x + 2, wt.base + 9, wt.z), pr(wt.x - 2, wt.base + 9, wt.z)];
      env.fill(tank, '#141413');
      env.fill([pr(wt.x - 2.2, wt.base + 9, wt.z), pr(wt.x + 2.2, wt.base + 9, wt.z), pr(wt.x, wt.base + 11, wt.z)], '#141413');
      // Tar roof.
      const zn = 0.6;
      const fl = [pr(-hw - 0.3, 0, zn), pr(hw + 0.3, 0, zn), pr(hw + 0.3, 0, back), pr(-hw - 0.3, 0, back)];
      env.fill(fl, '#2b2a27');
      g.save();
      env.path(fl);
      g.clip();
      floorDots(env, 0.5, (w) => 0.1 + 0.2 * U.clamp((w.z - 8) / 16, 0, 1), [
        { x: -3.5, z: 7, kx: 0.25, kz: 0.15 },
        { x: 3.5, z: 7, kx: 0.25, kz: 0.15 },
        { x: -3.5, z: 16, kx: 0.25, kz: 0.12 },
        { x: 3.5, z: 16, kx: 0.25, kz: 0.12 },
      ], rgba(P.paper, 0.9), -0.28);
      floorMarkings(env, rgba(P.paper, 0.22), P.paperDim, zn);
      g.restore();
      // Parapet walls.
      for (const side of [-1, 1]) {
        const x = side * (hw + 0.3);
        const face = [pr(x, 0, zn), pr(x, r.wallHeight, zn), pr(x, r.wallHeight, back), pr(x, 0, back)];
        env.fill(face, '#4a4843');
        g.save();
        env.path(face);
        g.clip();
        g.globalAlpha = 0.35;
        for (let z = 1; z < back; z += 0.6) env.line(pr(x, 0, z), pr(x, r.wallHeight, z), P.ink, 1);
        g.restore();
        env.line(pr(x, r.wallHeight, zn), pr(x, r.wallHeight, back), P.paperDim, 3);
        plaques(env, x, P.paper, P.ink);
      }
      // Billboard backstop with its lattice.
      const bb = [pr(-hw, 0.7, back), pr(hw, 0.7, back), pr(hw, r.backHeight, back), pr(-hw, r.backHeight, back)];
      for (let x = -hw + 0.4; x <= hw; x += 1.6) env.line(pr(x, 0, back + 0.1), pr(x, 0.7, back + 0.1), '#141413', 3);
      env.fill(bb, P.paperDim);
      g.save();
      env.path(bb);
      g.clip();
      const bc = pr(hw * 0.45, 2.05, back);
      g.strokeStyle = rgba(P.ink, 0.25);
      for (let i = 1; i <= 4; i++) {
        g.lineWidth = 0.08 * bc.s;
        g.beginPath();
        g.arc(bc.sx, bc.sy, i * 0.26 * bc.s, 0, Math.PI * 2);
        g.stroke();
      }
      env.text('RANGE 09', pr(-hw * 0.35, 2.05, back), 0.8 * bc.s, rgba(P.ink, 0.3));
      paint.dots(g, bb[0].sx, bb[2].sy, bb[1].sx, bb[0].sy, 4, (sx, sy) => 0.08 + 0.3 * U.clamp((sy - bb[2].sy) / (bb[0].sy - bb[2].sy), 0, 1), P.graphite);
      g.restore();
      env.path(bb);
      g.strokeStyle = '#141413';
      g.lineWidth = 3;
      g.stroke();
      // Floodlight poles and light cones.
      for (const [x, z] of [
        [-hw - 0.1, 5],
        [hw + 0.1, 5],
        [-hw - 0.1, 14],
        [hw + 0.1, 14],
      ]) {
        const topP = pr(x, 4.4, z);
        env.line(pr(x, 0, z), topP, '#141413', Math.max(2, 0.06 * topP.s));
        const cone = [pr(x - Math.sign(x) * 0.2, 4.3, z), pr(x * 0.2, 0, z + 3.5), pr(x * 0.2, 0, z - 1)];
        env.fill(cone, rgba(P.paperHi, 0.05));
        g.fillStyle = P.paperHi;
        g.beginPath();
        g.arc(topP.sx, topP.sy, Math.max(3, 0.18 * topP.s), 0, Math.PI * 2);
        g.fill();
      }
      carriers(env, '#6d6a63', rgba(P.paperHi, 0.5), true);
    },
    ambient: {
      draw(ctx, cam, t) {
        // Beacon on the water tower and a plane crossing the sky.
        const b = cam.project(-14, 12.6, 34);
        const on = Math.sin(t * 3.2) > 0.2;
        if (on) {
          ctx.fillStyle = P.paperHi;
          ctx.beginPath();
          ctx.arc(b.sx, b.sy, 3, 0, Math.PI * 2);
          ctx.fill();
          const glow = ctx.createRadialGradient(b.sx, b.sy, 0, b.sx, b.sy, 22);
          glow.addColorStop(0, rgba(P.paperHi, 0.35));
          glow.addColorStop(1, rgba(P.paperHi, 0));
          ctx.fillStyle = glow;
          ctx.fillRect(b.sx - 22, b.sy - 22, 44, 44);
        }
        const period = 38;
        const k = (t % period) / period;
        const px = cam.W * (1.1 - k * 1.2);
        const py = cam.H * (0.07 + k * 0.04);
        if (Math.sin(t * 9) > 0) {
          ctx.fillStyle = rgba(P.paperHi, 0.9);
          ctx.fillRect(px, py, 2, 2);
        }
      },
    },
  };

  /* =============================================================== scrapyard */

  const scrapyard = {
    tone: 'ink',
    fg: { top: '#8f7e66', dots: rgba(P.ink, 0.35), edge: P.paper, label: rgba(P.ink, 0.35), text: 'YARD 3', grain: true },
    paint(env) {
      const { g, r, pr, x0, y0, x1, y1, cy, rng } = env;
      const hw = r.halfWidth;
      const back = r.backZ;
      // Overcast sky with halftone cloud masses.
      g.fillStyle = P.paper;
      g.fillRect(x0, y0, x1 - x0, y1 - y0);
      const blobs = [];
      for (let i = 0; i < 9; i++) blobs.push({ x: x0 + rng.next() * (x1 - x0), y: y0 + rng.next() * (cy - y0) * 0.8, r: 120 + rng.next() * 260 });
      paint.dots(g, x0, y0, x1, cy + 10, 6, (sx, sy) => {
        let d = 0.06 + 0.14 * U.clamp((sy - y0) / (cy - y0), 0, 1);
        for (const b of blobs) {
          const k = 1 - Math.hypot((sx - b.x) / 1.6, sy - b.y) / b.r;
          if (k > 0) d += 0.22 * k;
        }
        return d;
      }, P.smoke);
      // Distant hills.
      g.fillStyle = '#b4ad9f';
      g.beginPath();
      g.moveTo(x0, cy + 4);
      for (let x = x0; x <= x1; x += 40) g.lineTo(x, cy - 10 - 26 * Math.abs(Math.sin(x * 0.004)) - 12 * Math.sin(x * 0.013));
      g.lineTo(x1, cy + 4);
      g.closePath();
      g.fill();
      // Dead crane.
      const c0 = pr(16, 0, 70);
      const cTop = pr(16, 26, 70);
      const cArm = pr(-10, 24, 70);
      g.strokeStyle = '#3d3a35';
      g.lineWidth = Math.max(2, 0.3 * c0.s);
      g.beginPath();
      g.moveTo(c0.sx, c0.sy);
      g.lineTo(cTop.sx, cTop.sy);
      g.lineTo(cArm.sx, cArm.sy);
      g.stroke();
      g.lineWidth = 1;
      for (let i = 0; i <= 12; i++) {
        const a = pr(16 - i * 2.1, 24 + (i % 2) * 1.6, 70);
        const b = pr(16 - (i + 1) * 2.1, 24 + ((i + 1) % 2) * 1.6, 70);
        env.line(a, b, '#3d3a35', 1);
      }
      env.line(pr(-6, 24, 70), pr(-6, 12, 70), '#3d3a35', 1);
      // Power line poles.
      for (let i = 0; i < 6; i++) {
        const z = 40 + i * 25;
        const p = pr(-26, 0, z);
        const t = pr(-26, 11, z);
        env.line(p, t, '#4a4640', Math.max(1, 0.25 * t.s));
        env.line(pr(-27.5, 10.5, z), pr(-24.5, 10.5, z), '#4a4640', Math.max(1, 0.15 * t.s));
      }
      // Dirt yard.
      const zn = 0.6;
      const fl = [pr(-hw - 3, 0, zn), pr(hw + 3, 0, zn), pr(hw + 3, 0, back + 4), pr(-hw - 3, 0, back + 4)];
      env.fill(fl, '#c7bda9');
      g.save();
      env.path(fl);
      g.clip();
      floorDots(env, 0.5, (w) => {
        const track = Math.exp(-Math.pow(w.x - 1.6 - Math.sin(w.z * 0.2) * 0.6, 2) * 8) + Math.exp(-Math.pow(w.x + 1.8 - Math.sin(w.z * 0.2) * 0.6, 2) * 8);
        return 0.2 + 0.18 * track + 0.1 * Math.sin(w.x * 3.1 + w.z * 1.7) * Math.sin(w.z * 0.9);
      }, [{ x: 0, z: 10, kx: 0.02, kz: 0.01 }], '#5a5247', 0.05);
      for (let i = 0; i < 6; i++) {
        const px = rng.range(-hw, hw);
        const pz = rng.range(5, back - 2);
        const p = pr(px, 0, pz);
        g.fillStyle = rgba(P.paperHi, 0.7);
        g.beginPath();
        g.ellipse(p.sx, p.sy, rng.range(0.3, 0.8) * p.s, 0.06 * p.s, 0, 0, Math.PI * 2);
        g.fill();
      }
      floorMarkings(env, rgba(P.ink, 0.12), '#26241f', zn);
      g.restore();
      // Corrugated fence backstop.
      const fence = [pr(-hw - 2, 0, back), pr(hw + 2, 0, back), pr(hw + 2, r.backHeight, back), pr(-hw - 2, r.backHeight, back)];
      env.fill(fence, '#a39a8a');
      g.save();
      env.path(fence);
      g.clip();
      g.globalAlpha = 0.5;
      for (let x = -hw - 2; x < hw + 2; x += 0.18) env.line(pr(x, 0, back), pr(x, r.backHeight, back), '#5c554a', 1);
      g.globalAlpha = 1;
      paint.dots(g, fence[0].sx, fence[2].sy, fence[1].sx, fence[0].sy, 4, (sx, sy) => 0.25 * U.clamp((sy - fence[2].sy) / (fence[0].sy - fence[2].sy), 0, 1), '#3b362f');
      const sign = [pr(-1.1, 2.2, back - 0.05), pr(1.1, 2.2, back - 0.05), pr(1.1, 2.9, back - 0.05), pr(-1.1, 2.9, back - 0.05)];
      env.fill(sign, P.ink);
      env.text('YARD 3 · KEEP OUT', pr(0, 2.55, back - 0.05), 0.34 * pr(0, 2.55, back).s, P.paper);
      g.restore();
      // Car stacks along both sides.
      for (const side of [-1, 1]) {
        let z = 4;
        while (z < back) {
          const len = rng.range(3.4, 4.4);
          const stack = rng.int(1, 3);
          const x = side * (hw + 0.6);
          for (let k = 0; k < stack; k++) {
            const yb = k * 0.72;
            const face = [pr(x, yb, z), pr(x, yb + 0.68, z), pr(x, yb + 0.68, z + len), pr(x, yb, z + len)];
            env.fill(face, k % 2 ? '#2a2723' : '#3a352e');
            const win = [pr(x, yb + 0.4, z + len * 0.25), pr(x, yb + 0.62, z + len * 0.3), pr(x, yb + 0.62, z + len * 0.65), pr(x, yb + 0.4, z + len * 0.7)];
            env.fill(win, rgba(P.paper, 0.35));
            env.line(face[1], face[2], rgba(P.paper, 0.35), 1);
          }
          z += len + rng.range(0.2, 1.2);
        }
        // Tire stacks near the bench.
        const tp = pr(side * (hw - 0.3), 0, 4);
        g.strokeStyle = P.ink;
        g.lineWidth = Math.max(2, 0.08 * tp.s);
        for (let k = 0; k < 3; k++) {
          g.beginPath();
          g.ellipse(tp.sx, tp.sy - k * 0.18 * tp.s, 0.32 * tp.s, 0.1 * tp.s, 0, 0, Math.PI * 2);
          g.stroke();
        }
      }
      // I-beam gantry carriers on A-frame posts.
      carriers(env, P.ink, rgba(P.paperHi, 0.5), true);
    },
    ambient: {
      draw(ctx, cam, t) {
        // A few birds wheel over the yard.
        ctx.strokeStyle = rgba(P.ink, 0.7);
        ctx.lineWidth = 1.5;
        for (let i = 0; i < 3; i++) {
          const period = 26 + i * 7;
          const k = ((t + i * 9) % period) / period;
          const x = cam.W * (-0.1 + k * 1.2);
          const y = cam.H * (0.14 + 0.05 * i) + Math.sin(t * 1.3 + i) * 10;
          const flap = Math.sin(t * 8 + i) * 4;
          ctx.beginPath();
          ctx.moveTo(x - 7, y - flap);
          ctx.lineTo(x, y);
          ctx.lineTo(x + 7, y - flap);
          ctx.stroke();
        }
      },
    },
  };

  /* ==================================================================== dock */

  const dock = {
    tone: 'ink',
    fg: { top: '#3a3935', dots: rgba(P.paper, 0.08), edge: P.paperDim, label: rgba(P.paper, 0.3), text: 'BAY 4', rivets: true },
    paint(env) {
      const { g, r, pr, x0, y0, x1, y1, rng } = env;
      const hw = r.halfWidth;
      const top = r.ceiling;
      const back = r.backZ;
      const zn = 0.6;
      g.fillStyle = '#1d1d1b';
      g.fillRect(x0, y0, x1 - x0, y1 - y0);
      // Back wall with the open harbor door.
      const bw = [pr(-hw, 0, back), pr(hw, 0, back), pr(hw, top, back), pr(-hw, top, back)];
      env.fill(bw, '#9c968b');
      g.save();
      env.path(bw);
      g.clip();
      g.globalAlpha = 0.35;
      for (let x = -hw; x < hw; x += 0.2) env.line(pr(x, 0, back), pr(x, top, back), '#4c4841', 1);
      g.globalAlpha = 1;
      const door = [pr(-2.3, 0, back), pr(2.3, 0, back), pr(2.3, 4.4, back), pr(-2.3, 4.4, back)];
      env.fill(door, P.paperHi);
      g.save();
      env.path(door);
      g.clip();
      const seaY = pr(0, 0.9, back).sy;
      g.fillStyle = '#6e6a62';
      g.fillRect(door[0].sx, seaY, door[1].sx - door[0].sx, door[0].sy - seaY);
      paint.dots(g, door[0].sx, seaY, door[1].sx, door[0].sy, 4, (sx, sy) => 0.3 + 0.2 * Math.sin(sy * 0.9 + sx * 0.05), P.ink);
      const ship = [pr(-1.6, 0.9, back), pr(0.4, 0.9, back), pr(0.7, 1.3, back), pr(-1.8, 1.3, back)];
      env.fill(ship, '#3e3b36');
      env.fill([pr(-1.1, 1.3, back), pr(-0.6, 1.3, back), pr(-0.6, 1.8, back), pr(-1.1, 1.8, back)], '#3e3b36');
      env.line(pr(1.4, 0.9, back), pr(1.4, 3.6, back), '#4a4640', 3);
      env.line(pr(1.4, 3.6, back), pr(-0.2, 3.3, back), '#4a4640', 2);
      g.restore();
      env.path(door);
      g.strokeStyle = P.ink;
      g.lineWidth = 4;
      g.stroke();
      const hz = [pr(-2.3, 4.4, back), pr(2.3, 4.4, back), pr(2.3, 4.8, back), pr(-2.3, 4.8, back)];
      env.fill(hz, P.ink);
      g.save();
      env.path(hz);
      g.clip();
      g.strokeStyle = P.paperDim;
      g.lineWidth = 0.12 * pr(0, 4.6, back).s;
      for (let x = -2.6; x < 2.6; x += 0.4) env.line(pr(x, 4.4, back), pr(x + 0.3, 4.8, back), P.paperDim, 0.1 * pr(0, 4.6, back).s);
      g.restore();
      env.text('BONDED · BAY 4', pr(-3.3, 5.6, back), 0.36 * pr(0, 5.6, back).s, rgba(P.ink, 0.5));
      g.restore();
      // Container stacks on both sides.
      for (const side of [-1, 1]) {
        const x = side * hw;
        let z = 1;
        let k = 0;
        while (z < back) {
          const len = 6.1;
          for (let lvl = 0; lvl < 2; lvl++) {
            const yb = lvl * 2.6;
            const face = [pr(x, yb, z), pr(x, yb + 2.55, z), pr(x, yb + 2.55, z + len), pr(x, yb, z + len)];
            const tone = (k + lvl) % 3 === 0 ? '#bdb6a8' : (k + lvl) % 3 === 1 ? '#4e4a43' : '#7b766c';
            env.fill(face, tone);
            g.save();
            env.path(face);
            g.clip();
            g.globalAlpha = 0.35;
            for (let zz = z; zz < z + len; zz += 0.25) env.line(pr(x, yb, zz), pr(x, yb + 2.55, zz), tone === '#4e4a43' ? P.paperDim : P.ink, 1);
            g.globalAlpha = 1;
            const lp = pr(x, yb + 1.7, z + 1.4);
            env.text('ZTA ' + String(rng.int(1000, 9999)), lp, 0.3 * lp.s, tone === '#4e4a43' ? rgba(P.paper, 0.6) : rgba(P.ink, 0.6), 'Big Shoulders Display');
            g.restore();
            env.line(face[0], face[1], P.ink, 2);
          }
          z += len + 0.15;
          k++;
        }
        plaques(env, x, P.ink, P.paper);
      }
      // Concrete floor with joints and hatched safety zones.
      const fl = [pr(-hw, 0, zn), pr(hw, 0, zn), pr(hw, 0, back), pr(-hw, 0, back)];
      env.fill(fl, '#b9b3a7');
      g.save();
      env.path(fl);
      g.clip();
      floorDots(env, 0.5, (w) => 0.15 + 0.3 * U.clamp((Math.abs(w.x) - 3.2) / 1.4, 0, 1), [4, 8, 12, 16, 20].map((z) => ({ x: (z % 8) - 2, z, kx: 0.4, kz: 0.6 })), '#4a463f', 0.18);
      g.globalAlpha = 0.25;
      for (let z = 2; z < back; z += 2) env.line(pr(-hw, 0, z), pr(hw, 0, z), P.ink, 1);
      for (let x = -hw; x <= hw; x += 1.5) env.line(pr(x, 0, zn), pr(x, 0, back), P.ink, 1);
      g.globalAlpha = 1;
      for (const key of Object.keys(r.rails)) {
        const rail = r.rails[key];
        for (let x = rail.xMin; x < rail.xMax; x += 0.5) env.fill([pr(x, 0, rail.z - 0.3), pr(x + 0.25, 0, rail.z - 0.3), pr(x + 0.45, 0, rail.z + 0.3), pr(x + 0.2, 0, rail.z + 0.3)], rgba(P.ink, 0.22));
      }
      floorMarkings(env, rgba(P.ink, 0.35), P.ink, zn);
      g.restore();
      // Roof trusses and skylights.
      for (let z = back - 1; z >= 2; z -= 3.5) {
        const a = pr(-hw, top, z);
        const b = pr(hw, top, z);
        const m = pr(0, top - 0.9, z);
        g.strokeStyle = '#3b3934';
        g.lineWidth = Math.max(2, 0.08 * a.s);
        g.beginPath();
        g.moveTo(a.sx, a.sy);
        g.lineTo(m.sx, m.sy);
        g.lineTo(b.sx, b.sy);
        g.stroke();
        g.lineWidth = Math.max(1, 0.03 * a.s);
        for (let i = 1; i < 6; i++) {
          const x = -hw + (i * 2 * hw) / 6;
          env.line(pr(x, top, z), pr(x, top - 0.9 * (1 - Math.abs(x) / hw), z), '#3b3934', Math.max(1, 0.03 * a.s));
        }
        const sk = [pr(-0.8, top, z - 1.6), pr(0.8, top, z - 1.6), pr(0.8, top, z - 0.6), pr(-0.8, top, z - 0.6)];
        env.fill(sk, P.paperHi);
        // Light shaft.
        env.fill([pr(-0.8, top, z - 1.6), pr(0.8, top, z - 1.6), pr(1.6, 0, z + 1.4), pr(0, 0, z + 1.4)], rgba(P.paperHi, 0.06));
      }
      carriers(env, P.ink, rgba(P.paperHi, 0.5));
    },
    ambient: {
      init() {
        const rng = ZTA.createRng(4242);
        this.motes = [];
        for (let i = 0; i < 40; i++) this.motes.push({ x: rng.range(-2, 2), y: rng.range(0.5, 5.5), z: rng.range(4, 22), v: rng.range(0.05, 0.15), p: rng.next() * 6 });
      },
      draw(ctx, cam, t) {
        if (!this.motes) this.init();
        ctx.fillStyle = rgba(P.paperHi, 0.55);
        for (const m of this.motes) {
          const y = ((m.y + t * m.v) % 5.5) + 0.3;
          const p = cam.project(m.x + Math.sin(t * 0.5 + m.p) * 0.3, y, m.z);
          const s = Math.max(1, p.s * 0.012);
          ctx.fillRect(p.sx, p.sy, s, s);
        }
        // A hook swinging on its chain.
        const hx = -1.8 + Math.sin(t * 0.8) * 0.35;
        const a = cam.project(-1.8, cam.range.ceiling, 13);
        const b = cam.project(hx, 3.4, 13);
        ctx.strokeStyle = P.ink;
        ctx.lineWidth = Math.max(1.5, b.s * 0.02);
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        ctx.moveTo(a.sx + cam.offX, a.sy + cam.offY);
        ctx.lineTo(b.sx, b.sy);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.lineWidth = Math.max(2, b.s * 0.04);
        ctx.beginPath();
        ctx.arc(b.sx, b.sy + b.s * 0.12, b.s * 0.1, -0.5, Math.PI);
        ctx.stroke();
      },
    },
  };

  /* =================================================================== vault */

  const vault = {
    tone: 'paper',
    fg: { top: '#1b1b1a', dots: rgba(P.paper, 0.06), edge: P.paper, label: rgba(P.paper, 0.35), text: 'PROVING 05', lights: true },
    paint(env) {
      const { g, r, pr, x0, y0, x1, y1, cx } = env;
      const hw = r.halfWidth;
      const top = r.ceiling;
      const back = r.backZ;
      const zn = 0.6;
      g.fillStyle = '#131312';
      g.fillRect(x0, y0, x1 - x0, y1 - y0);
      // Tunnel shell: walls and a vaulted ceiling built from arch ribs.
      const archPts = (z, inset) => {
        const pts = [];
        for (let i = 0; i <= 16; i++) {
          const a = Math.PI - (i / 16) * Math.PI;
          const x = Math.cos(a) * (hw - inset);
          const y = 2.3 + Math.sin(a) * (top - 2.3 - inset * 0.3);
          pts.push(pr(x, y, z));
        }
        return pts;
      };
      for (let z = back; z >= 1.5; z -= 3) {
        const pts = archPts(z, 0);
        g.strokeStyle = '#2a2927';
        g.lineWidth = Math.max(4, 0.28 * pts[8].s);
        g.beginPath();
        g.moveTo(pr(-hw, 0, z).sx, pr(-hw, 0, z).sy);
        pts.forEach((p) => g.lineTo(p.sx, p.sy));
        g.lineTo(pr(hw, 0, z).sx, pr(hw, 0, z).sy);
        g.stroke();
        g.strokeStyle = rgba(P.paper, 0.18);
        g.lineWidth = 1;
        g.stroke();
      }
      // Walls (flat part) with halftone and light strips.
      for (const side of [-1, 1]) {
        const x = side * hw;
        const wall = [pr(x, 0, zn), pr(x, 2.3, zn), pr(x, 2.3, back), pr(x, 0, back)];
        env.fill(wall, '#252422');
        g.save();
        env.path(wall);
        g.clip();
        const xa = side < 0 ? x0 : wall[3].sx;
        const xb = side < 0 ? wall[3].sx : x1;
        paint.dots(g, xa, y0, xb, y1, 5, (sx, sy) => {
          const w = env.wallAt(x, sx, sy);
          if (!w) return 0;
          return 0.08 + 0.15 * Math.abs(Math.sin(w.z * 0.8));
        }, rgba(P.paper, 0.5));
        g.restore();
        env.line(pr(x, 1.9, zn), pr(x, 1.9, back), P.paperHi, 2.5);
        env.line(pr(x, 1.9, zn), pr(x, 1.9, back), rgba(P.paperHi, 0.25), 9);
        plaques(env, x, P.paper, P.ink);
      }
      // Vault door.
      const d = pr(0, 2.1, back);
      const R = 1.9 * d.s;
      g.fillStyle = '#3a3935';
      g.beginPath();
      g.arc(d.sx, d.sy, R * 1.12, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#8a857b';
      g.beginPath();
      g.arc(d.sx, d.sy, R, 0, Math.PI * 2);
      g.fill();
      g.save();
      g.beginPath();
      g.arc(d.sx, d.sy, R, 0, Math.PI * 2);
      g.clip();
      paint.dots(g, d.sx - R, d.sy - R, d.sx + R, d.sy + R, 4, (sx, sy) => 0.15 + 0.35 * U.clamp((sx - d.sx + (sy - d.sy)) / (2 * R) + 0.5, 0, 1), P.ink);
      g.restore();
      g.strokeStyle = P.ink;
      g.lineWidth = Math.max(2, 0.05 * d.s);
      for (const rr of [0.95, 0.62, 0.22]) {
        g.beginPath();
        g.arc(d.sx, d.sy, R * rr, 0, Math.PI * 2);
        g.stroke();
      }
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        g.beginPath();
        g.moveTo(d.sx + Math.cos(a) * R * 0.22, d.sy + Math.sin(a) * R * 0.22);
        g.lineTo(d.sx + Math.cos(a) * R * 0.62, d.sy + Math.sin(a) * R * 0.62);
        g.stroke();
        g.fillStyle = P.paperDim;
        g.beginPath();
        g.arc(d.sx + Math.cos(a) * R * 0.8, d.sy + Math.sin(a) * R * 0.8, R * 0.05, 0, Math.PI * 2);
        g.fill();
      }
      // Grated steel floor with edge lights.
      const fl = [pr(-hw, 0, zn), pr(hw, 0, zn), pr(hw, 0, back), pr(-hw, 0, back)];
      env.fill(fl, '#232220');
      g.save();
      env.path(fl);
      g.clip();
      g.globalAlpha = 0.22;
      for (let z = 1; z < back; z += 0.5) env.line(pr(-hw, 0, z), pr(hw, 0, z), P.paperDim, 1);
      for (let x = -hw; x <= hw; x += 0.5) env.line(pr(x, 0, zn), pr(x, 0, back), P.paperDim, 1);
      g.globalAlpha = 1;
      floorMarkings(env, rgba(P.paper, 0.2), P.paperDim, zn);
      g.restore();
      for (const side of [-1, 1]) {
        for (let z = 2; z < back; z += 1.5) {
          const p = pr(side * (hw - 0.1), 0.05, z);
          g.fillStyle = P.paperHi;
          g.beginPath();
          g.arc(p.sx, p.sy, Math.max(1.5, 0.03 * p.s), 0, Math.PI * 2);
          g.fill();
        }
      }
      void cx;
      carriers(env, '#77736b', rgba(P.paperHi, 0.6));
    },
    ambient: {
      draw(ctx, cam, t) {
        // A warning lamp above the vault door sweeps its beam.
        const r = cam.range;
        const lamp = cam.project(0, 4.05, r.backZ - 0.2);
        const a = t * 2.4;
        const len = cam.H * 0.9;
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        const grad = ctx.createRadialGradient(lamp.sx, lamp.sy, 0, lamp.sx, lamp.sy, len);
        grad.addColorStop(0, rgba(P.paperHi, 0.16));
        grad.addColorStop(1, rgba(P.paperHi, 0));
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.moveTo(lamp.sx, lamp.sy);
        ctx.arc(lamp.sx, lamp.sy, len, a - 0.18, a + 0.18);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
        ctx.fillStyle = Math.sin(a * 2) > 0 ? P.paperHi : P.paperDim;
        ctx.beginPath();
        ctx.arc(lamp.sx, lamp.sy, Math.max(3, lamp.s * 0.1), 0, Math.PI * 2);
        ctx.fill();
      },
    },
  };

  ZTA.Themes = { basement, rooftop, scrapyard, dock, vault, makeEnv };
})(typeof window !== 'undefined' ? window : globalThis);
