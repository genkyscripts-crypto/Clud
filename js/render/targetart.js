/*
 * Target, boss and prop drawing. Uses the same world geometry as
 * Target.hitTest so the silhouette you see is exactly the area you can hit.
 *
 * Two tones, chosen by the range:
 *   ink    ink targets on light walls (Bench Lane, Scrap Yard, Freight Dock)
 *   paper  paper targets on dark scenes (Rooftop 9 at night, The Vault)
 * Brass stays reserved for rewards: the only brass on a target is the bonus
 * light on a drone.
 */
(function (root) {
  'use strict';
  const ZTA = root.ZTA;
  const U = ZTA.util;
  const P = ZTA.palette;
  const paint = ZTA.paint;
  const rgba = paint.rgba;

  const TONES = {
    ink: {
      name: 'ink',
      body: P.ink,
      body2: P.charcoal,
      rim: P.ink,
      inner: rgba(P.paper, 0.28),
      paint: P.paper,
      chip: P.paperHi,
      chipLine: rgba(P.paperHi, 0.7),
      light: rgba(P.paper, 0.5),
      shade: null,
      flash: P.paperHi,
      flashA: 0.75,
      edge: rgba(P.paper, 0.55),
      hatch: rgba(P.paper, 0.2),
      post: P.ink,
      postHi: rgba(P.paper, 0.3),
      chain: P.ink,
      glass: rgba(P.ink, 0.92),
      glassLine: P.ink,
      glassHi: rgba(P.paperHi, 0.75),
      label: P.paper,
      labelInk: P.ink,
      core: P.paperHi,
      coreInk: P.ink,
      coreRing: rgba(P.paperHi, 0.55),
      crack: P.paperHi,
      rotor: rgba(P.ink, 0.28),
    },
    paper: {
      name: 'paper',
      body: P.paper,
      body2: P.paperDim,
      rim: P.ink,
      inner: rgba(P.ink, 0.3),
      paint: P.ink,
      chip: P.graphite,
      chipLine: rgba(P.ink, 0.55),
      light: null,
      shade: rgba(P.ink, 0.42),
      flash: P.ink,
      flashA: 0.45,
      edge: P.ink,
      hatch: rgba(P.ink, 0.22),
      post: P.paperDim,
      postHi: P.paperHi,
      chain: P.paperDim,
      glass: rgba(P.paperDim, 0.95),
      glassLine: P.ink,
      glassHi: rgba(P.paperHi, 1),
      label: P.ink,
      labelInk: P.paper,
      core: P.ink,
      coreInk: P.paperHi,
      coreRing: rgba(P.paperHi, 0.7),
      crack: P.ink,
      rotor: rgba(P.paperHi, 0.3),
    },
  };
  let T = TONES.ink;

  function setTone(tone) {
    T = TONES[tone] || TONES.ink;
  }

  const tmp = {};
  const pa = {};
  const pb = {};
  const pc = {};
  const ps = {};

  /** Screen-space center of a target (for popups and effects). */
  function center(t, cam, out) {
    const o = out || {};
    const c = t.center(tmp);
    return cam.project(c.x, c.y, t.z, o);
  }

  function hpBar(ctx, t, x, y, w) {
    if (t.state !== 'active' || t.lastHitAge > 1.4 || t.hp >= t.maxHp) return;
    const alpha = 1 - U.clamp((t.lastHitAge - 1.0) / 0.4, 0, 1);
    const h = Math.max(3, Math.round(w * 0.06));
    w = Math.max(18, w);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = P.ink;
    ctx.fillRect(x - w / 2 - 2, y - 2, w + 4, h + 4);
    ctx.fillStyle = P.paper;
    ctx.fillRect(x - w / 2, y, w * U.clamp(t.hpShown, 0, 1), h);
    ctx.restore();
  }

  function floorShadow(ctx, cam, x, z, rw, alpha, dpr) {
    if (alpha <= 0.01) return;
    const p = cam.project(x, 0, z, ps);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = paint.pattern(ctx, 4, 1.25, P.ink, dpr);
    ctx.beginPath();
    ctx.ellipse(p.sx, p.sy, rw * p.s, rw * p.s * 0.16, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  /** Halftone form light: paper dots top-left on ink, ink dots bottom-right on paper. */
  function shading(ctx, path, rx, ry, dpr) {
    ctx.save();
    ctx.clip(path);
    ctx.beginPath();
    if (T.light) {
      ctx.ellipse(-rx * 0.28, -ry * 0.32, rx * 0.8, ry * 0.8, 0, 0, Math.PI * 2);
      ctx.clip();
      ctx.fillStyle = paint.pattern(ctx, 4, 0.9, T.light, dpr);
    } else {
      ctx.ellipse(rx * 0.5, ry * 0.55, rx * 0.95, ry * 0.95, 0, 0, Math.PI * 2);
      ctx.clip();
      ctx.fillStyle = paint.pattern(ctx, 4, 1.05, T.shade, dpr);
    }
    ctx.fillRect(-rx * 2, -ry * 2, rx * 4, ry * 4);
    ctx.restore();
  }

  function flashFill(ctx, path, t, fade) {
    if (t.flash <= 0) return;
    ctx.save();
    ctx.globalAlpha = (fade == null ? 1 : fade) * t.flash * T.flashA;
    ctx.fillStyle = T.flash;
    ctx.fill(path);
    ctx.restore();
  }

  function dentMarks(ctx, dents, sx, sy, r) {
    for (const d of dents) {
      const dx = d.x * sx;
      const dy = -d.y * sy;
      const s = Math.max(1.5, r * 0.07 * d.s * (d.weak ? 1.3 : 1));
      ctx.fillStyle = T.chip;
      ctx.beginPath();
      ctx.arc(dx, dy, s, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = T.chipLine;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let k = 0; k < 3; k++) {
        const ang = d.s * 9 + k * 2.1;
        ctx.moveTo(dx, dy);
        ctx.lineTo(dx + Math.cos(ang) * s * 2.2, dy + Math.sin(ang) * s * 2.2);
      }
      ctx.stroke();
    }
  }

  function cracks(ctx, hpf, w, h, lw) {
    ctx.strokeStyle = T.crack;
    ctx.lineWidth = lw;
    if (hpf < 0.67) {
      ctx.beginPath();
      ctx.moveTo(-w * 0.45, -h * 0.3);
      ctx.lineTo(-w * 0.18, -h * 0.12);
      ctx.lineTo(-w * 0.25, h * 0.1);
      ctx.stroke();
    }
    if (hpf < 0.34) {
      ctx.beginPath();
      ctx.moveTo(w * 0.48, h * 0.3);
      ctx.lineTo(w * 0.2, h * 0.12);
      ctx.lineTo(w * 0.3, -h * 0.1);
      ctx.lineTo(w * 0.12, -h * 0.32);
      ctx.stroke();
    }
  }

  function drawPost(ctx, cam, x, z, top) {
    const b = cam.project(x, 0, z, pb);
    const tp = cam.project(x, top, z, pc);
    const w = Math.max(2, 0.05 * b.s);
    ctx.fillStyle = T.post;
    ctx.fillRect(b.sx - w / 2, tp.sy, w, b.sy - tp.sy);
    ctx.fillStyle = T.postHi;
    ctx.fillRect(b.sx - w / 2, tp.sy, Math.max(1, w * 0.3), b.sy - tp.sy);
    const fw = 0.3 * b.s;
    const fh = Math.max(2, 0.045 * b.s);
    ctx.fillStyle = T.post;
    ctx.fillRect(b.sx - fw / 2, b.sy - fh, fw, fh);
    ctx.fillStyle = T.postHi;
    ctx.fillRect(b.sx - fw / 2, b.sy - fh, fw, 1);
  }

  function coreGlyph(ctx, r, time, phase, pulseAmp) {
    const pulse = 1.35 + (pulseAmp || 0.18) * Math.sin(time * 6 + phase);
    ctx.beginPath();
    ctx.arc(0, 0, r * pulse, 0, Math.PI * 2);
    ctx.strokeStyle = T.coreRing;
    ctx.lineWidth = Math.max(1, r * 0.18);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fillStyle = T.core;
    ctx.fill();
    ctx.lineWidth = Math.max(1, r * 0.12);
    ctx.strokeStyle = T.rim;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.45, 0, Math.PI * 2);
    ctx.fillStyle = T.coreInk;
    ctx.fill();
  }

  /* ------------------------------------------------------------------ plate */

  function drawPlate(ctx, t, cam, dpr) {
    const r0 = t.radius;
    const a = t.state === 'active' ? t.appearScale : 1;
    const c = t.plateCenter(tmp);
    const p = cam.project(c.x, c.y, t.z, pa);
    const r = r0 * a * p.s;
    const breaking = t.state === 'breaking';
    const fade = breaking ? 1 - U.clamp((t.breakAge - 0.75) / 0.35, 0, 1) : 1;
    const post = t.mount === 'post';

    if (!breaking) floorShadow(ctx, cam, c.x, t.z, r0 * 0.9, 0.35 * a, dpr);

    ctx.save();
    ctx.globalAlpha = fade;
    if (!breaking) {
      if (post) {
        drawPost(ctx, cam, t.x, t.z, ZTA.TARGET_POST);
      } else {
        const hingeY = t.baseY;
        const topY = c.y + Math.cos(t.swing) * r0 * a;
        ctx.strokeStyle = T.chain;
        ctx.lineWidth = Math.max(1, 0.012 * p.s);
        ctx.setLineDash([Math.max(2, 0.025 * p.s), Math.max(1.5, 0.012 * p.s)]);
        for (const side of [-1, 1]) {
          const hx = t.x + side * r0 * 0.45;
          const ax = c.x + side * r0 * 0.45 * Math.cos(t.swing);
          cam.project(hx, hingeY, t.z, pb);
          cam.project(ax, topY - 0.02, t.z, pc);
          ctx.beginPath();
          ctx.moveTo(pb.sx, pb.sy);
          ctx.lineTo(pc.sx, pc.sy);
          ctx.stroke();
        }
        ctx.setLineDash([]);
      }
    }

    ctx.translate(p.sx, p.sy);
    ctx.rotate(-t.swing + t.fallRot);
    const squash = Math.max(0.35, Math.cos(t.tilt));
    ctx.scale(1, squash);

    const body = new Path2D();
    body.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fillStyle = T.body;
    ctx.fill(body);
    ctx.lineWidth = Math.max(1.5, r * 0.06);
    ctx.strokeStyle = T.rim;
    ctx.stroke(body);
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.9, 0, Math.PI * 2);
    ctx.strokeStyle = T.inner;
    ctx.lineWidth = Math.max(1, r * 0.03);
    ctx.stroke();
    shading(ctx, body, r, r, dpr);
    // Painted weak-point ring.
    const wr = r * t.def.weak.r;
    ctx.beginPath();
    ctx.arc(0, 0, wr, 0, Math.PI * 2);
    ctx.strokeStyle = T.paint;
    ctx.lineWidth = Math.max(1.5, r * 0.07);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 0, Math.max(1.5, wr * 0.28), 0, Math.PI * 2);
    ctx.fillStyle = T.paint;
    ctx.fill();
    dentMarks(ctx, t.dents, r, r, r);
    flashFill(ctx, body, t, fade);
    ctx.restore();

    if (!breaking) hpBar(ctx, t, p.sx, p.sy + r * squash + 6, r * 1.6);
  }

  /* ----------------------------------------------------------------- bottle */

  function bottlePath(w, h) {
    const bw = w / 2;
    const nw = w * 0.18;
    const path = new Path2D();
    path.moveTo(-bw, 0);
    path.lineTo(-bw, -h * 0.6);
    path.quadraticCurveTo(-bw, -h * 0.72, -nw, -h * 0.76);
    path.lineTo(-nw, -h * 0.95);
    path.lineTo(-nw * 1.3, -h * 0.96);
    path.lineTo(-nw * 1.3, -h);
    path.lineTo(nw * 1.3, -h);
    path.lineTo(nw * 1.3, -h * 0.96);
    path.lineTo(nw, -h * 0.95);
    path.lineTo(nw, -h * 0.76);
    path.quadraticCurveTo(bw, -h * 0.72, bw, -h * 0.6);
    path.lineTo(bw, 0);
    path.closePath();
    return path;
  }

  function drawBottle(ctx, t, cam) {
    if (t.state !== 'active') return;
    const a = t.appearScale;
    const p = cam.project(t.x, t.baseY, t.z, pa);
    const w = t.def.shape.w * t.scale * p.s;
    const h = t.def.shape.h * t.scale * p.s * Math.min(1, a);
    if (h < 1) return;
    ctx.save();
    ctx.translate(p.sx + (t.jolt ? Math.sin(t.age * 90) * t.jolt * w * 0.08 : 0), p.sy);
    const path = bottlePath(w, h);
    ctx.fillStyle = T.glass;
    ctx.fill(path);
    ctx.lineWidth = Math.max(1, w * 0.07);
    ctx.strokeStyle = T.glassLine;
    ctx.stroke(path);
    ctx.fillStyle = T.label;
    ctx.fillRect(-w / 2, -h * 0.42, w, h * 0.18);
    ctx.fillStyle = T.labelInk;
    ctx.fillRect(-w * 0.28, -h * 0.35, w * 0.56, Math.max(1, h * 0.03));
    ctx.fillStyle = T.glassHi;
    ctx.fillRect(-w * 0.34, -h * 0.58, Math.max(1, w * 0.1), h * 0.12);
    ctx.fillRect(-w * 0.34, -h * 0.2, Math.max(1, w * 0.1), h * 0.14);
    flashFill(ctx, path, t, 1 / T.flashA);
    ctx.restore();
  }

  /* ----------------------------------------------------------------- runner */

  function drawRunner(ctx, t, cam, time, dpr) {
    const g = t.runnerGeom(tmp);
    const breaking = t.state === 'breaking';
    const fade = breaking ? 1 - U.clamp(t.breakAge / 0.75, 0, 1) : 1;
    const jx = t.jolt > 0 ? Math.sin(time * 90) * t.jolt * 0.02 : 0;
    const x = t.x + jx;
    const base = cam.project(x, 0, t.z, pa);
    const s = base.s;

    floorShadow(ctx, cam, x, t.z, g.trolleyW * 0.6, 0.4 * fade, dpr);

    ctx.save();
    ctx.globalAlpha = fade;
    const tw = g.trolleyW * s;
    const th = g.pivotY * s;
    ctx.fillStyle = T.body;
    ctx.fillRect(base.sx - tw / 2, base.sy - th, tw, th * 0.8);
    ctx.strokeStyle = T.edge;
    ctx.lineWidth = 1;
    ctx.strokeRect(base.sx - tw / 2 + 2, base.sy - th + 2, tw - 4, th * 0.8 - 4);
    for (const side of [-0.32, 0.32]) {
      const wx = base.sx + side * tw;
      const wy = base.sy - th * 0.14;
      ctx.beginPath();
      ctx.arc(wx, wy, th * 0.2, 0, Math.PI * 2);
      ctx.fillStyle = T.body;
      ctx.fill();
      ctx.strokeStyle = T.paint;
      ctx.lineWidth = Math.max(1, s * 0.012);
      ctx.stroke();
      // Spinning hub mark.
      const spin = (t.x / 0.07) * -1;
      ctx.beginPath();
      ctx.moveTo(wx, wy);
      ctx.lineTo(wx + Math.cos(spin) * th * 0.16, wy + Math.sin(spin) * th * 0.16);
      ctx.stroke();
    }
    ctx.restore();
    if (breaking) return;

    const pivot = cam.project(x, g.pivotY, t.z, pb);
    ctx.save();
    ctx.translate(pivot.sx, pivot.sy);
    ctx.scale(1, g.a);
    const tb = (g.torsoBottom - g.pivotY) * s;
    const tt = (g.torsoTop - g.pivotY) * s;
    const hw = (g.torsoW / 2) * s;
    const body = new Path2D();
    body.moveTo(-hw, -tb);
    body.lineTo(hw, -tb);
    body.lineTo(hw * 0.82, -tt);
    body.lineTo(hw * 0.35, -tt);
    body.lineTo(hw * 0.3, -tt - 0.02 * s);
    body.lineTo(-hw * 0.3, -tt - 0.02 * s);
    body.lineTo(-hw * 0.35, -tt);
    body.lineTo(-hw * 0.82, -tt);
    body.closePath();
    const hy = -(g.headY - g.pivotY) * s;
    body.moveTo(g.headR * s, hy);
    body.arc(0, hy, g.headR * s, 0, Math.PI * 2);
    ctx.fillStyle = T.body;
    ctx.fillRect(-0.03 * s, -tb, 0.06 * s, tb);
    ctx.fill(body);
    ctx.save();
    ctx.clip(body);
    ctx.strokeStyle = T.hatch;
    ctx.lineWidth = Math.max(1, s * 0.01);
    ctx.beginPath();
    for (let k = -hw * 3; k < hw * 3; k += Math.max(4, s * 0.05)) {
      ctx.moveTo(k, -tb);
      ctx.lineTo(k + (tt - tb), -tt);
    }
    ctx.stroke();
    ctx.translate(0, -(tb + tt) / 2);
    cracks(ctx, t.hp / t.maxHp, hw * 2, tt - tb, Math.max(1, s * 0.012));
    ctx.restore();
    ctx.lineWidth = Math.max(1, s * 0.012);
    ctx.strokeStyle = T.edge;
    ctx.stroke(body);

    ctx.save();
    ctx.translate(0, -(g.coreY - g.pivotY) * s);
    coreGlyph(ctx, g.coreR * s, time, t.phase);
    ctx.restore();

    flashFill(ctx, body, t, 0.95);
    ctx.restore();
    const top = cam.project(x, g.headY + g.headR, t.z, pc);
    hpBar(ctx, t, top.sx, top.sy - 12, g.torsoW * s);
  }

  /* ------------------------------------------------------------------ drone */

  function drawDrone(ctx, t, cam, time, dpr) {
    const breaking = t.state === 'breaking';
    const escaping = t.state === 'escaping';
    const fade = breaking ? 1 - U.clamp((t.breakAge - 0.6) / 0.45, 0, 1) : escaping ? 1 - U.clamp(t.breakAge / 0.4, 0, 1) : 1;
    const a = t.state === 'active' ? t.appearScale : 1;
    const x = t.x + t.fallX;
    const y = t.altitude + t.fallY;
    const p = cam.project(x, y, t.z, pa);
    const s = p.s * Math.max(0.01, a);
    floorShadow(ctx, cam, x, t.z, 0.22, 0.22 * fade * a, dpr);

    ctx.save();
    ctx.globalAlpha = fade;
    ctx.translate(p.sx, p.sy);
    const bank = breaking ? t.fallRot : t.dir * 0.07 + (t.jolt ? Math.sin(time * 60) * t.jolt * 0.15 : 0);
    ctx.rotate(bank);
    const lw = Math.max(1, 0.012 * s);

    // Arms and rotor hubs.
    ctx.fillStyle = T.body;
    ctx.fillRect(-0.24 * s, -0.035 * s, 0.48 * s, 0.03 * s);
    for (const side of [-1, 1]) {
      const hx = side * 0.24 * s;
      ctx.fillStyle = T.body;
      ctx.fillRect(hx - 0.018 * s, -0.07 * s, 0.036 * s, 0.05 * s);
      // Rotor: a blur disc while flying, a stopped blade while falling.
      ctx.beginPath();
      ctx.ellipse(hx, -0.075 * s, 0.075 * s, 0.014 * s + 1, 0, 0, Math.PI * 2);
      if (!breaking) {
        ctx.fillStyle = T.rotor;
        ctx.fill();
        const ang = time * 55 + side;
        ctx.strokeStyle = T.body;
        ctx.lineWidth = Math.max(1, lw * 1.4);
        ctx.beginPath();
        ctx.moveTo(hx - Math.cos(ang) * 0.075 * s, -0.075 * s);
        ctx.lineTo(hx + Math.cos(ang) * 0.075 * s, -0.075 * s);
        ctx.stroke();
      } else {
        ctx.strokeStyle = T.body;
        ctx.lineWidth = lw * 1.4;
        ctx.beginPath();
        ctx.moveTo(hx - 0.07 * s, -0.08 * s);
        ctx.lineTo(hx + 0.05 * s, -0.065 * s);
        ctx.stroke();
      }
    }
    // Pod.
    const pod = new Path2D();
    pod.ellipse(0, 0, 0.13 * s, 0.085 * s, 0, 0, Math.PI * 2);
    ctx.fillStyle = T.body;
    ctx.fill(pod);
    ctx.strokeStyle = T.rim;
    ctx.lineWidth = lw;
    ctx.stroke(pod);
    shading(ctx, pod, 0.13 * s, 0.085 * s, dpr);
    // Skids.
    ctx.strokeStyle = T.body;
    ctx.lineWidth = Math.max(1, lw * 1.2);
    ctx.beginPath();
    for (const side of [-1, 1]) {
      ctx.moveTo(side * 0.06 * s, 0.07 * s);
      ctx.lineTo(side * 0.09 * s, 0.11 * s);
    }
    ctx.moveTo(-0.13 * s, 0.11 * s);
    ctx.lineTo(0.13 * s, 0.11 * s);
    ctx.stroke();
    // Bonus light (the weak point): brass, because it is cash.
    const r = t.weak.r * s;
    const on = !breaking && Math.sin(time * 9 + t.phase) > -0.35;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fillStyle = on ? P.brass : T.body2;
    ctx.fill();
    ctx.lineWidth = Math.max(1, r * 0.2);
    ctx.strokeStyle = on ? P.brassHi : T.edge;
    ctx.stroke();
    if (on) {
      ctx.beginPath();
      ctx.arc(-r * 0.3, -r * 0.3, r * 0.28, 0, Math.PI * 2);
      ctx.fillStyle = P.paperHi;
      ctx.fill();
      ctx.globalAlpha = fade * (0.25 + 0.15 * Math.sin(time * 18));
      ctx.beginPath();
      ctx.arc(0, 0, r * 2.1, 0, Math.PI * 2);
      ctx.strokeStyle = P.brassHi;
      ctx.lineWidth = Math.max(1, r * 0.15);
      ctx.stroke();
      ctx.globalAlpha = fade;
    }
    flashFill(ctx, pod, t, fade);
    ctx.restore();
    if (!breaking) hpBar(ctx, t, p.sx, p.sy - 0.2 * s, 0.4 * s);
  }

  /* ----------------------------------------------------------------- popper */

  function drawPopper(ctx, t, cam, time, dpr) {
    const sh = t.def.shape;
    const a = t.appearScale;
    const breaking = t.state === 'breaking';
    const base = cam.project(t.x, 0, t.z, pa);
    const s = base.s;
    floorShadow(ctx, cam, t.x, t.z, 0.24, 0.35, dpr);
    // Spring hinge box, visible even while the popper is down.
    ctx.fillStyle = T.body;
    ctx.fillRect(base.sx - 0.2 * s, base.sy - 0.08 * s, 0.4 * s, 0.08 * s);
    ctx.fillStyle = T.paint;
    for (let k = -2; k <= 2; k++) ctx.fillRect(base.sx + k * 0.07 * s - 0.012 * s, base.sy - 0.065 * s, 0.024 * s, 0.05 * s);
    if (a <= 0.02) return;

    const fade = breaking ? 1 - U.clamp(t.breakAge / 0.5, 0, 1) : 1;
    const h = sh.h * a * s;
    const hr = sh.headR * a * s;
    const bw = (sh.w / 2) * 1.2 * s;
    const tw = (sh.w / 2) * 0.7 * s;
    ctx.save();
    ctx.globalAlpha = fade;
    ctx.translate(base.sx + (t.jolt ? Math.sin(time * 80) * t.jolt * 0.015 * s : 0), base.sy);
    const body = new Path2D();
    body.moveTo(-bw, 0);
    body.lineTo(bw, 0);
    body.lineTo(tw, -h);
    body.lineTo(tw * 0.45, -h - hr * 0.3);
    body.lineTo(-tw * 0.45, -h - hr * 0.3);
    body.lineTo(-tw, -h);
    body.closePath();
    body.moveTo(hr, -h - hr);
    body.arc(0, -h - hr, hr, 0, Math.PI * 2);
    ctx.fillStyle = T.body;
    ctx.fill(body);
    ctx.lineWidth = Math.max(1, 0.012 * s);
    ctx.strokeStyle = T.rim;
    ctx.stroke(body);
    ctx.save();
    ctx.translate(0, -h / 2);
    shading(ctx, body, bw, h / 2 + hr, dpr);
    ctx.restore();
    // Scoring zones: a stripe across the chest, a ring on the head.
    ctx.strokeStyle = T.inner;
    ctx.lineWidth = Math.max(1, 0.01 * s);
    ctx.beginPath();
    ctx.moveTo(-bw * 0.8, -h * 0.55);
    ctx.lineTo(bw * 0.8, -h * 0.55);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, -h - hr, hr * 0.55, 0, Math.PI * 2);
    ctx.strokeStyle = T.paint;
    ctx.lineWidth = Math.max(1.5, hr * 0.18);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, -h - hr, Math.max(1.2, hr * 0.16), 0, Math.PI * 2);
    ctx.fillStyle = T.paint;
    ctx.fill();
    // Countdown arc around the head: how long before it drops.
    if (t.state === 'active') {
      const left = U.clamp(1 - t.upAge / t.uptime, 0, 1);
      const blink = left < 0.3 && Math.sin(time * 30) < 0;
      if (!blink) {
        ctx.beginPath();
        ctx.arc(0, -h - hr, hr * 1.45, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * left);
        ctx.strokeStyle = left < 0.3 ? P.paperHi : T.name === 'ink' ? P.ink : P.paper;
        ctx.lineWidth = Math.max(2, hr * 0.22);
        ctx.stroke();
      }
    }
    flashFill(ctx, body, t, fade);
    ctx.restore();
    if (!breaking) hpBar(ctx, t, base.sx, base.sy - h - hr * 3.4, 0.36 * s);
  }

  /* ----------------------------------------------------------------- barrel */

  function drawBarrel(ctx, t, cam, time, dpr) {
    if (t.state !== 'active') return;
    const sh = t.def.shape;
    const a = Math.min(1, t.appearScale);
    const p = cam.project(t.x, 0, t.z, pa);
    const s = p.s;
    const w = sh.w * s;
    const h = sh.h * a * s;
    if (h < 2) return;
    floorShadow(ctx, cam, t.x, t.z, sh.w * 0.62, 0.4, dpr);
    const e = w * 0.1;
    ctx.save();
    ctx.translate(p.sx + (t.jolt ? Math.sin(time * 80) * t.jolt * 0.012 * s : 0), p.sy);
    const body = new Path2D();
    body.moveTo(-w / 2, -e);
    body.lineTo(-w / 2, -h + e);
    body.ellipse(0, -h + e, w / 2, e, 0, Math.PI, 0);
    body.lineTo(w / 2, -e);
    body.ellipse(0, -e, w / 2, e, 0, 0, Math.PI);
    body.closePath();
    ctx.fillStyle = T.body;
    ctx.fill(body);
    ctx.save();
    ctx.translate(0, -h / 2);
    shading(ctx, body, w / 2, h / 2, dpr);
    ctx.restore();
    // Ribs.
    ctx.strokeStyle = T.edge;
    ctx.lineWidth = Math.max(1, 0.014 * s);
    for (const f of [0.26, 0.74]) {
      ctx.beginPath();
      ctx.ellipse(0, -h * f, w / 2, e, 0, 0, Math.PI);
      ctx.stroke();
    }
    // Hazard band.
    const b0 = -h * 0.58;
    const bh = h * 0.18;
    ctx.save();
    ctx.beginPath();
    ctx.rect(-w / 2, b0, w, bh);
    ctx.clip();
    ctx.fillStyle = T.paint;
    ctx.fillRect(-w / 2, b0, w, bh);
    ctx.fillStyle = T.body;
    const step = Math.max(4, w * 0.2);
    for (let k = -w; k < w; k += step) {
      ctx.beginPath();
      ctx.moveTo(k, b0 + bh);
      ctx.lineTo(k + step * 0.5, b0 + bh);
      ctx.lineTo(k + step * 0.5 + bh, b0);
      ctx.lineTo(k + bh, b0);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
    // Flame diamond.
    const dy = -h * 0.84;
    const dr = Math.min(w * 0.16, h * 0.08);
    if (dr > 2.5) {
      ctx.beginPath();
      ctx.moveTo(0, dy - dr);
      ctx.lineTo(dr, dy);
      ctx.lineTo(0, dy + dr);
      ctx.lineTo(-dr, dy);
      ctx.closePath();
      ctx.fillStyle = T.paint;
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(0, dy - dr * 0.55);
      ctx.quadraticCurveTo(dr * 0.45, dy + dr * 0.1, 0, dy + dr * 0.5);
      ctx.quadraticCurveTo(-dr * 0.45, dy + dr * 0.1, 0, dy - dr * 0.55);
      ctx.fillStyle = T.body;
      ctx.fill();
    }
    // Lid.
    ctx.beginPath();
    ctx.ellipse(0, -h + e, w / 2, e, 0, 0, Math.PI * 2);
    ctx.fillStyle = T.body2;
    ctx.fill();
    ctx.strokeStyle = T.edge;
    ctx.lineWidth = Math.max(1, 0.01 * s);
    ctx.stroke();
    ctx.fillStyle = T.body;
    ctx.fillRect(w * 0.12, -h + e - e * 0.5, w * 0.1, e * 0.7);
    ctx.lineWidth = Math.max(1, 0.012 * s);
    ctx.strokeStyle = T.rim;
    ctx.stroke(body);
    // A damaged barrel hisses: a flickering spark at the bung.
    if (t.hp < t.maxHp * 0.6) {
      const f = 0.5 + 0.5 * Math.sin(time * 47 + t.phase);
      ctx.fillStyle = P.paperHi;
      ctx.globalAlpha = 0.5 + 0.5 * f;
      ctx.beginPath();
      ctx.arc(w * 0.17, -h + e * 0.4 - f * 0.03 * s, Math.max(1.5, 0.02 * s * (0.6 + f)), 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    flashFill(ctx, body, t, 1);
    ctx.restore();
    hpBar(ctx, t, p.sx, p.sy - h - 10, w);
  }

  /* ------------------------------------------------------ heavy and shutter */

  function chamferRect(w, h, c) {
    const path = new Path2D();
    path.moveTo(-w / 2 + c, -h / 2);
    path.lineTo(w / 2 - c, -h / 2);
    path.lineTo(w / 2, -h / 2 + c);
    path.lineTo(w / 2, h / 2 - c);
    path.lineTo(w / 2 - c, h / 2);
    path.lineTo(-w / 2 + c, h / 2);
    path.lineTo(-w / 2, h / 2 - c);
    path.lineTo(-w / 2, -h / 2 + c);
    path.closePath();
    return path;
  }

  function bolts(ctx, w, h, inset, r, color) {
    ctx.fillStyle = color;
    for (const sx of [-1, 1]) {
      for (const sy of [-1, 1]) {
        ctx.beginPath();
        ctx.arc(sx * (w / 2 - inset), sy * (h / 2 - inset), r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  function drawHeavy(ctx, t, cam, time, dpr) {
    const sh = t.def.shape;
    const breaking = t.state === 'breaking';
    const fade = breaking ? 1 - U.clamp((t.breakAge - 0.75) / 0.35, 0, 1) : 1;
    const a = t.state === 'active' ? Math.min(1.1, t.appearScale) : 1;
    if (!breaking) {
      floorShadow(ctx, cam, t.x, t.z, 0.34, 0.4, dpr);
      drawPost(ctx, cam, t.x, t.z, sh.post);
    }
    const p = cam.project(t.x + t.fallX, sh.post + sh.h / 2 + t.fallY, t.z, pa);
    const s = p.s;
    const w = sh.w * a * s;
    const h = sh.h * a * s;
    ctx.save();
    ctx.globalAlpha = fade;
    ctx.translate(p.sx, p.sy);
    ctx.rotate(t.fallRot);
    ctx.scale(1, Math.max(0.35, Math.cos(t.tilt)));
    const body = chamferRect(w, h, 0.07 * s * a);
    ctx.fillStyle = T.body;
    ctx.fill(body);
    ctx.lineWidth = Math.max(2, 0.024 * s);
    ctx.strokeStyle = T.rim;
    ctx.stroke(body);
    shading(ctx, body, w / 2, h / 2, dpr);
    const inner = chamferRect(w - 0.08 * s, h - 0.08 * s, 0.05 * s * a);
    ctx.lineWidth = Math.max(1, 0.012 * s);
    ctx.strokeStyle = T.edge;
    ctx.stroke(inner);
    // Armor slats.
    ctx.strokeStyle = T.inner;
    for (const f of [-0.18, 0.02, 0.22]) {
      ctx.beginPath();
      ctx.moveTo(-w * 0.36, h * f);
      ctx.lineTo(w * 0.36, h * f);
      ctx.stroke();
    }
    bolts(ctx, w, h, 0.07 * s, Math.max(1.2, 0.018 * s), T.paint);
    dentMarks(ctx, t.dents, (sh.w / 2) * s, (sh.w / 2) * s, w * 0.6);
    flashFill(ctx, body, t, fade);
    ctx.restore();
    if (!breaking) hpBar(ctx, t, p.sx, p.sy - h / 2 - 12, w);
  }

  /** 0..1 how far a shutter / sensor window is open, eased at both ends. */
  function openness(t) {
    const w = t.weak;
    const cycle = w.open + w.closed;
    const pos = (t.age + t.phase) % cycle;
    if (pos >= w.open) return 0;
    return U.clamp(Math.min(pos, w.open - pos) / 0.12, 0, 1);
  }
  /** Seconds until the window opens (0 while open). */
  function untilOpen(t) {
    const w = t.weak;
    const cycle = w.open + w.closed;
    const pos = (t.age + t.phase) % cycle;
    return pos < w.open ? 0 : cycle - pos;
  }

  function windowGlyph(ctx, t, r, time) {
    const o = openness(t);
    // Frame.
    ctx.beginPath();
    ctx.arc(0, 0, r * 1.22, 0, Math.PI * 2);
    ctx.fillStyle = T.body2;
    ctx.fill();
    ctx.lineWidth = Math.max(1, r * 0.12);
    ctx.strokeStyle = T.edge;
    ctx.stroke();
    ctx.save();
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.clip();
    if (o > 0) {
      ctx.fillStyle = T.coreInk === P.ink ? P.ink : P.ink2;
      ctx.fillRect(-r, -r, r * 2, r * 2);
      coreGlyph(ctx, r * 0.72, time, t.phase, 0.25);
    }
    // Blast doors slide apart.
    ctx.fillStyle = T.body;
    ctx.fillRect(-r, -r, r * (1 - o), r * 2);
    ctx.fillRect(r * o, -r, r * (1 - o), r * 2);
    ctx.strokeStyle = T.edge;
    ctx.lineWidth = Math.max(1, r * 0.08);
    ctx.beginPath();
    ctx.moveTo(-r * o, -r);
    ctx.lineTo(-r * o, r);
    ctx.moveTo(r * o, -r);
    ctx.lineTo(r * o, r);
    ctx.stroke();
    ctx.restore();
    // Indicator lamp: steady while open, blinking just before it opens.
    const soon = untilOpen(t);
    const lit = o > 0 || (soon < 0.45 && Math.sin(time * 40) > 0);
    ctx.fillStyle = lit ? P.paperHi : T.body2;
    ctx.fillRect(-r * 0.35, -r * 1.62, r * 0.7, r * 0.22);
    ctx.strokeStyle = T.rim;
    ctx.lineWidth = 1;
    ctx.strokeRect(-r * 0.35, -r * 1.62, r * 0.7, r * 0.22);
  }

  function drawShutter(ctx, t, cam, time, dpr) {
    const sh = t.def.shape;
    const breaking = t.state === 'breaking';
    const fade = breaking ? 1 - U.clamp(t.breakAge / 0.7, 0, 1) : 1;
    const a = t.state === 'active' ? Math.min(1, t.appearScale) : 1;
    floorShadow(ctx, cam, t.x, t.z, 0.4, 0.4 * fade, dpr);
    drawPost(ctx, cam, t.x, t.z, sh.post);
    const p = cam.project(t.x, sh.post + sh.h / 2 - (breaking ? t.breakAge * 0.2 : 0), t.z, pa);
    const s = p.s;
    const w = sh.w * a * s;
    const h = sh.h * a * s;
    ctx.save();
    ctx.globalAlpha = fade;
    ctx.translate(p.sx + (t.jolt ? Math.sin(time * 80) * t.jolt * 0.012 * s : 0), p.sy);
    const body = chamferRect(w, h, 0.05 * s * a);
    ctx.fillStyle = T.body;
    ctx.fill(body);
    ctx.lineWidth = Math.max(2, 0.022 * s);
    ctx.strokeStyle = T.rim;
    ctx.stroke(body);
    shading(ctx, body, w / 2, h / 2, dpr);
    // Side vents.
    ctx.strokeStyle = T.inner;
    ctx.lineWidth = Math.max(1, 0.01 * s);
    for (const side of [-1, 1]) {
      for (let k = -2; k <= 2; k++) {
        ctx.beginPath();
        ctx.moveTo(side * w * 0.33, k * h * 0.12);
        ctx.lineTo(side * w * 0.43, k * h * 0.12);
        ctx.stroke();
      }
    }
    bolts(ctx, w, h, 0.05 * s, Math.max(1, 0.014 * s), T.paint);
    ctx.save();
    ctx.translate(0, h * 0.04);
    windowGlyph(ctx, t, t.weak.r * a * s, time);
    ctx.restore();
    ctx.translate(0, 0);
    cracks(ctx, t.hp / t.maxHp, w, h, Math.max(1, 0.012 * s));
    flashFill(ctx, body, t, fade);
    ctx.restore();
    if (!breaking) hpBar(ctx, t, p.sx, p.sy - h / 2 - 12, w);
  }

  /* ------------------------------------------------------------ boss parts */

  function drawBossPart(ctx, t, cam, time, dpr) {
    const part = t.part;
    if (!part) return;
    const breaking = t.state === 'breaking';
    const fade = breaking ? 1 - U.clamp((t.breakAge - 0.6) / 0.45, 0, 1) : 1;
    const a = t.state === 'active' ? Math.min(1, t.appearScale) : 1;
    const p = cam.project(t.x + t.fallX, t.baseY + t.fallY, t.z, pa);
    const s = p.s * a;
    const id = t.def.id;
    ctx.save();
    ctx.globalAlpha = fade;
    ctx.translate(p.sx + (t.jolt ? Math.sin(time * 70) * t.jolt * 0.012 * s : 0), p.sy);
    ctx.rotate(t.fallRot);
    let path;
    if (id === 'tgt.boss.core') {
      path = new Path2D();
      path.arc(0, 0, part.r * s, 0, Math.PI * 2);
      const r = part.r * s;
      // Spokes of light around an exposed core.
      if (!breaking) {
        ctx.strokeStyle = T.coreRing;
        ctx.lineWidth = Math.max(1, r * 0.1);
        ctx.beginPath();
        for (let k = 0; k < 8; k++) {
          const ang = (k / 8) * Math.PI * 2 + time * 0.8;
          ctx.moveTo(Math.cos(ang) * r * 1.5, Math.sin(ang) * r * 1.5);
          ctx.lineTo(Math.cos(ang) * r * 2.1, Math.sin(ang) * r * 2.1);
        }
        ctx.stroke();
      }
      coreGlyph(ctx, r, time, t.phase, 0.3);
    } else if (id === 'tgt.boss.sensor') {
      const r = part.r * s;
      path = new Path2D();
      path.arc(0, 0, r * 1.22, 0, Math.PI * 2);
      windowGlyph(ctx, t, r, time);
    } else {
      const chest = id === 'tgt.boss.plate';
      const w = part.w * s;
      const h = part.h * s;
      path = chamferRect(w, h, Math.min(w, h) * 0.14);
      ctx.fillStyle = T.body;
      ctx.fill(path);
      ctx.lineWidth = Math.max(2, 0.022 * p.s);
      ctx.strokeStyle = T.rim;
      ctx.stroke(path);
      shading(ctx, path, w / 2, h / 2, dpr);
      ctx.lineWidth = Math.max(1, 0.01 * p.s);
      ctx.strokeStyle = T.edge;
      ctx.stroke(chamferRect(w - 0.06 * s, h - 0.06 * s, Math.min(w, h) * 0.1));
      ctx.save();
      ctx.clip(path);
      ctx.strokeStyle = T.hatch;
      ctx.beginPath();
      for (let k = -w; k < w; k += Math.max(4, 0.05 * s)) {
        ctx.moveTo(k, h / 2);
        ctx.lineTo(k + h * 0.4, h / 2 - h * 0.4);
      }
      ctx.stroke();
      ctx.restore();
      if (chest) {
        // The core glows through the seams of the chest plate.
        const glow = 0.35 + 0.3 * Math.sin(time * 5);
        ctx.strokeStyle = rgba(P.paperHi, glow);
        ctx.lineWidth = Math.max(1, 0.012 * p.s);
        ctx.beginPath();
        ctx.moveTo(-w * 0.3, 0);
        ctx.lineTo(w * 0.3, 0);
        ctx.moveTo(0, -h * 0.3);
        ctx.lineTo(0, h * 0.3);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(0, 0, Math.min(w, h) * 0.22, 0, Math.PI * 2);
        ctx.strokeStyle = T.paint;
        ctx.lineWidth = Math.max(1.5, 0.02 * p.s);
        ctx.stroke();
      }
      bolts(ctx, w, h, 0.045 * s, Math.max(1, 0.014 * s), T.paint);
      cracks(ctx, t.hp / t.maxHp, w, h, Math.max(1, 0.012 * p.s));
    }
    flashFill(ctx, path, t, fade);
    ctx.restore();
  }

  /* ------------------------------------------------------------ boss bodies */

  /**
   * The boss frame, drawn just behind its sections. Local coordinates are
   * meters from the boss origin with y up; sections cover the plates here.
   */
  function drawBoss(ctx, boss, cam, time) {
    const def = boss.def;
    const zb = boss.z + 0.15;
    const sink = boss.defeated ? Math.min(1, boss.defeatAge / 1.6) : 0;
    const fade = boss.defeated ? 1 - U.clamp((boss.defeatAge - 1.2) / 0.8, 0, 1) : 1;
    if (fade <= 0) return;
    const o = cam.project(boss.x, 0, zb, pa);
    const s = o.s;
    const bob = boss.bob;
    const lw = 1 / s;
    ctx.save();
    ctx.globalAlpha = fade;
    if (def.style === 'gantry') {
      // Overhead track, anchored to the range.
      const a = cam.project(boss.pad.xMin - 0.8, 2.78, zb, pb);
      const b = cam.project(boss.pad.xMax + 0.8, 2.66, zb, pc);
      ctx.fillStyle = T.body2;
      ctx.fillRect(a.sx, a.sy, b.sx - a.sx, b.sy - a.sy);
      ctx.fillStyle = T.edge;
      ctx.fillRect(a.sx, b.sy - 1, b.sx - a.sx, 1);
    }
    ctx.translate(o.sx, o.sy + sink * 0.35 * s);
    ctx.rotate(sink * 0.12 * (boss.dir || 1));
    ctx.scale(s, -s);
    const up = (y) => y + bob;
    const fill = (c) => {
      ctx.fillStyle = c;
      ctx.fill();
    };
    const stroke = (c, w) => {
      ctx.strokeStyle = c;
      ctx.lineWidth = (w || 1.5) * lw;
      ctx.stroke();
    };
    const rect = (x0, y0, x1, y1, c, edge) => {
      ctx.beginPath();
      ctx.rect(x0, y0, x1 - x0, y1 - y0);
      fill(c || T.body2);
      stroke(edge || T.rim, 1.5);
    };
    const circle = (x, y, r, c, edge) => {
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      fill(c || T.body2);
      stroke(edge || T.rim, 1.5);
    };
    const poly = (pts, c, edge) => {
      ctx.beginPath();
      pts.forEach((pt, i) => (i ? ctx.lineTo(pt[0], pt[1]) : ctx.moveTo(pt[0], pt[1])));
      ctx.closePath();
      fill(c || T.body2);
      stroke(edge || T.rim, 1.5);
    };
    // Segment widths are in meters.
    const seg = (x0, y0, x1, y1, c, w) => {
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.strokeStyle = c || T.body2;
      ctx.lineWidth = w || 0.06;
      ctx.stroke();
    };
    const wheel = (x, y, r) => {
      circle(x, y, r, T.body, T.edge);
      const spin = -boss.x / r;
      seg(x, y, x + Math.cos(spin) * r * 0.8, y + Math.sin(spin) * r * 0.8, T.edge, 0.015);
    };
    const vents = (x0, x1, y) => {
      if (!boss.enraged) return;
      const f = 0.5 + 0.5 * Math.sin(time * 25);
      ctx.fillStyle = rgba(P.paperHi, 0.4 + 0.5 * f);
      ctx.fillRect(x0, y, x1 - x0, 0.03);
      ctx.fillRect(x0, y - 0.06, x1 - x0, 0.03);
    };

    switch (def.style) {
      case 'rig': {
        rect(-0.62, 0.06, 0.62, 0.42);
        wheel(-0.42, 0.12, 0.12);
        wheel(0.42, 0.12, 0.12);
        rect(-0.06, 0.42, 0.06, up(1.9));
        rect(-0.44, up(0.74), 0.44, up(1.46));
        vents(-0.4, -0.34, up(1.0));
        vents(0.34, 0.4, up(1.0));
        rect(-0.8, up(1.38), 0.8, up(1.48));
        seg(-0.74, up(1.38), -0.74, up(1.3), T.body2, 0.05);
        seg(0.74, up(1.38), 0.74, up(1.3), T.body2, 0.05);
        circle(0, up(1.88), 0.17);
        seg(0.1, up(2.0), 0.26, up(2.28), T.body2, 0.025);
        circle(0.26, up(2.28), 0.035, T.paint);
        break;
      }
      case 'sentry': {
        poly([[-0.1, 0.55], [0.1, 0.55], [0.55, 0], [0.45, 0], [0, 0.4], [-0.45, 0], [-0.55, 0]]);
        rect(-0.22, 0.35, 0.22, 0.58);
        rect(-0.07, 0.55, 0.07, up(2.2));
        rect(-0.38, up(0.88), 0.38, up(1.62));
        vents(-0.34, 0.34, up(0.96));
        rect(-0.72, up(1.52), 0.72, up(1.6));
        seg(-0.38, up(1.3), -0.5, up(1.4), T.body2, 0.03);
        seg(0.38, up(1.3), 0.5, up(1.4), T.body2, 0.03);
        rect(-0.26, up(2.1), 0.26, up(2.5));
        rect(0.26, up(2.26), 0.5, up(2.34), T.body);
        break;
      }
      case 'crusher': {
        ctx.beginPath();
        ctx.roundRect ? ctx.roundRect(-0.85, 0, 1.7, 0.5, 0.22) : ctx.rect(-0.85, 0, 1.7, 0.5);
        fill(T.body);
        stroke(T.rim, 1.5);
        // Tread lugs creep with movement.
        ctx.save();
        ctx.beginPath();
        ctx.rect(-0.85, 0, 1.7, 0.5);
        ctx.clip();
        const off = ((boss.x % 0.14) + 0.14) % 0.14;
        ctx.fillStyle = T.edge;
        for (let x = -0.98 + off; x < 0.9; x += 0.14) {
          ctx.fillRect(x, 0.44, 0.05, 0.06);
          ctx.fillRect(x, 0, 0.05, 0.05);
        }
        ctx.restore();
        for (const x of [-0.6, -0.3, 0, 0.3, 0.6]) wheel(x, 0.25, 0.14);
        poly([[-0.68, 0.5], [0.68, 0.5], [0.52, up(1.52)], [-0.52, up(1.52)]]);
        vents(-0.45, 0.45, up(0.7));
        for (const side of [-1, 1]) {
          seg(side * 0.5, up(1.2), side * 0.92, up(1.02), T.body2, 0.07);
          seg(side * 0.5, up(1.05), side * 0.9, up(0.85), T.body, 0.03);
          // Jaws under the claw panels.
          poly([[side * 0.86, up(0.6)], [side * 1.24, up(0.6)], [side * 1.18, up(0.4)], [side * 1.08, up(0.52)], [side * 0.98, up(0.38)], [side * 0.92, up(0.52)]], T.body);
        }
        rect(0.42, up(1.45), 0.58, up(2.05));
        rect(0.38, up(2.02), 0.62, up(2.1), T.body);
        rect(-0.52, up(1.52), -0.18, up(1.92));
        // Exhaust puffs.
        for (let k = 0; k < 3; k++) {
          const ph = (time * 0.9 + k / 3) % 1;
          ctx.globalAlpha = fade * (1 - ph) * (boss.enraged ? 0.7 : 0.4);
          ctx.beginPath();
          ctx.arc(0.5 + ph * 0.25, up(2.15 + ph * 0.7), 0.07 + ph * 0.14, 0, Math.PI * 2);
          fill(T.name === 'ink' ? P.graphite : P.smoke);
        }
        ctx.globalAlpha = fade;
        break;
      }
      case 'gantry': {
        rect(-0.38, 2.6, 0.38, 2.74, T.body);
        wheel(-0.24, 2.72, 0.06);
        wheel(0.24, 2.72, 0.06);
        seg(-0.25, 2.6, -0.62, up(2.2), T.body2, 0.025);
        seg(0.25, 2.6, 0.62, up(2.2), T.body2, 0.025);
        // Truss frame.
        ctx.beginPath();
        ctx.rect(-0.78, up(1.08), 1.56, 1.12);
        ctx.strokeStyle = T.body2;
        ctx.lineWidth = 0.08;
        ctx.stroke();
        stroke(T.rim, 1.2);
        ctx.beginPath();
        ctx.moveTo(-0.78, up(1.08));
        ctx.lineTo(0.78, up(2.2));
        ctx.moveTo(0.78, up(1.08));
        ctx.lineTo(-0.78, up(2.2));
        ctx.strokeStyle = T.body2;
        ctx.lineWidth = 0.04;
        ctx.stroke();
        rect(-0.4, up(1.25), 0.4, up(2.0));
        vents(-0.36, 0.36, up(1.3));
        rect(-0.18, up(0.9), 0.18, up(1.1));
        seg(0, up(0.9), 0, up(0.7), T.body2, 0.02);
        break;
      }
      case 'overseer': {
        for (const side of [-1, 1]) {
          seg(side * 0.35, up(0.95), side * 0.5, up(0.5), T.body2, 0.16);
          seg(side * 0.5, up(0.5), side * 0.45, 0.06, T.body2, 0.14);
          circle(side * 0.5, up(0.5), 0.09, T.body, T.edge);
          rect(side * 0.45 - 0.2, 0, side * 0.45 + 0.2, 0.08, T.body);
        }
        rect(-0.46, up(0.84), 0.46, up(1.06));
        poly([[-0.6, up(1.0)], [0.6, up(1.0)], [0.78, up(2.06)], [-0.78, up(2.06)]]);
        vents(-0.55, -0.45, up(1.2));
        vents(0.45, 0.55, up(1.2));
        for (const side of [-1, 1]) {
          circle(side * 0.8, up(1.95), 0.15, T.body, T.edge);
          seg(side * 0.8, up(1.9), side * 1.0, up(1.55), T.body2, 0.09);
          rect(side * 1.0 - 0.1, up(0.6), side * 1.0 + 0.1, up(0.92));
          poly([[side * 0.92, up(0.6)], [side * 1.08, up(0.6)], [side * 1.12, up(0.44)], [side * 0.88, up(0.44)]], T.body);
        }
        rect(-0.3, up(2.08), 0.3, up(2.52));
        ctx.fillStyle = T.paint;
        ctx.fillRect(-0.24, up(2.42), 0.48, 0.03);
        break;
      }
      default:
        rect(-def.body.w / 2, def.body.base, def.body.w / 2, def.body.base + def.body.h);
    }
    ctx.restore();
  }

  /* ------------------------------------------------------------------ props */

  function drawBox(ctx, cam, p, h, faces) {
    const hw = p.w / 2;
    const zf = p.zFront;
    const zb = p.z + p.d / 2;
    const fl = cam.project(p.x - hw, 0, zf, {});
    const fr = cam.project(p.x + hw, h, zf, {});
    const bl = cam.project(p.x - hw, h, zb, {});
    const br = cam.project(p.x + hw, h, zb, {});
    ctx.lineWidth = 2;
    ctx.strokeStyle = P.ink;
    ctx.beginPath();
    ctx.moveTo(fl.sx, fr.sy);
    ctx.lineTo(fr.sx, fr.sy);
    ctx.lineTo(br.sx, br.sy);
    ctx.lineTo(bl.sx, bl.sy);
    ctx.closePath();
    ctx.fillStyle = faces.top;
    ctx.fill();
    ctx.stroke();
    const sideX = p.x < 0 ? p.x + hw : p.x - hw;
    const sf = cam.project(sideX, 0, zf, {});
    const sb = cam.project(sideX, 0, zb, {});
    const st = cam.project(sideX, h, zb, {});
    ctx.beginPath();
    ctx.moveTo(sf.sx, fl.sy);
    ctx.lineTo(sb.sx, sb.sy);
    ctx.lineTo(st.sx, st.sy);
    ctx.lineTo(sf.sx, fr.sy);
    ctx.closePath();
    ctx.fillStyle = faces.side;
    ctx.fill();
    ctx.stroke();
    const f = { x: fl.sx, y: fr.sy, w: fr.sx - fl.sx, h: fl.sy - fr.sy, s: fl.s };
    ctx.fillStyle = faces.front;
    ctx.fillRect(f.x, f.y, f.w, f.h);
    return f;
  }

  function stencil(ctx, label, x, y, size, color) {
    ctx.font = '800 ' + Math.round(size) + "px 'Big Shoulders Stencil Display', Impact, sans-serif";
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = color;
    ctx.fillText(label, x, y);
  }

  function drawCrate(ctx, cam, p, h, dpr) {
    const f = drawBox(ctx, cam, p, h, { top: P.paper, side: P.paperDim, front: P.paperDim });
    ctx.save();
    ctx.beginPath();
    ctx.rect(f.x, f.y, f.w, f.h);
    ctx.clip();
    ctx.fillStyle = paint.pattern(ctx, 4, 1, rgba(P.ink, 0.35), dpr);
    ctx.fillRect(f.x, f.y + f.h * 0.55, f.w, f.h * 0.45);
    ctx.restore();
    ctx.strokeStyle = P.ink;
    ctx.lineWidth = 2;
    ctx.strokeRect(f.x, f.y, f.w, f.h);
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    for (let i = 1; i < 3; i++) {
      ctx.moveTo(f.x, f.y + (f.h * i) / 3);
      ctx.lineTo(f.x + f.w, f.y + (f.h * i) / 3);
    }
    ctx.moveTo(f.x, f.y);
    ctx.lineTo(f.x + f.w, f.y + f.h);
    ctx.stroke();
    if (f.h > 24) {
      ctx.fillStyle = P.paperDim;
      ctx.fillRect(f.x + f.w * 0.28, f.y + f.h * 0.42, f.w * 0.44, f.h * 0.18);
      stencil(ctx, 'GLASS', f.x + f.w / 2, f.y + f.h * 0.515, f.h * 0.14, P.ink);
    }
  }

  function drawAC(ctx, cam, p, h, time) {
    const f = drawBox(ctx, cam, p, h, { top: P.paperDim, side: P.smoke, front: P.paperDim });
    ctx.strokeStyle = P.ink;
    ctx.lineWidth = 2;
    ctx.strokeRect(f.x, f.y, f.w, f.h);
    // Louvers on the left, a fan grille on the right.
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    for (let k = 1; k < 7; k++) {
      const y = f.y + (f.h * k) / 7;
      ctx.moveTo(f.x + f.w * 0.06, y);
      ctx.lineTo(f.x + f.w * 0.36, y);
    }
    ctx.stroke();
    const cx = f.x + f.w * 0.68;
    const cy = f.y + f.h * 0.5;
    const r = Math.min(f.w * 0.27, f.h * 0.4);
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = P.charcoal;
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = P.smoke;
    ctx.beginPath();
    for (let k = 0; k < 5; k++) {
      const ang = time * 3 + (k / 5) * Math.PI * 2;
      ctx.moveTo(cx, cy);
      ctx.quadraticCurveTo(cx + Math.cos(ang) * r * 0.6, cy + Math.sin(ang) * r * 0.6, cx + Math.cos(ang + 0.6) * r * 0.9, cy + Math.sin(ang + 0.6) * r * 0.9);
    }
    ctx.stroke();
    ctx.strokeStyle = rgba(P.paper, 0.6);
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.66, 0, Math.PI * 2);
    ctx.moveTo(cx - r, cy);
    ctx.lineTo(cx + r, cy);
    ctx.moveTo(cx, cy - r);
    ctx.lineTo(cx, cy + r);
    ctx.stroke();
    ctx.fillStyle = P.ink;
    ctx.beginPath();
    ctx.arc(cx, cy, Math.max(1.5, r * 0.14), 0, Math.PI * 2);
    ctx.fill();
  }

  function drawPallet(ctx, cam, p, h) {
    const f = drawBox(ctx, cam, p, h, { top: P.paper, side: P.paperDim, front: P.ink });
    const n = 3;
    const ph = f.h / n;
    for (let i = 0; i < n; i++) {
      const y = f.y + i * ph;
      ctx.fillStyle = P.paperDim;
      ctx.fillRect(f.x, y, f.w, ph * 0.28);
      ctx.fillRect(f.x, y + ph * 0.8, f.w, ph * 0.2);
      for (const bx of [0, 0.43, 0.86]) ctx.fillRect(f.x + f.w * bx, y + ph * 0.28, f.w * 0.14, ph * 0.52);
      ctx.strokeStyle = P.ink;
      ctx.lineWidth = 1;
      ctx.strokeRect(f.x, y, f.w, ph * 0.28);
    }
    ctx.strokeStyle = P.ink;
    ctx.lineWidth = 2;
    ctx.strokeRect(f.x, f.y, f.w, f.h);
  }

  function drawShelf(ctx, cam, p, h) {
    const hw = p.w / 2;
    const zf = p.zFront;
    const legX = hw - 0.12;
    const hood = p.look === 'hood';
    const legColor = T.post;
    for (const lx of [-legX, legX]) {
      const a = cam.project(p.x + lx - 0.035, h, zf, {});
      const b = cam.project(p.x + lx + 0.035, 0, zf, {});
      ctx.fillStyle = legColor;
      ctx.fillRect(a.sx, a.sy, b.sx - a.sx, b.sy - a.sy);
      if (hood) {
        // Jack stand feet.
        const w = b.sx - a.sx;
        ctx.beginPath();
        ctx.moveTo(a.sx - w * 2, b.sy);
        ctx.lineTo(a.sx + w / 2, b.sy - w * 3);
        ctx.lineTo(b.sx + w * 2, b.sy);
        ctx.closePath();
        ctx.fill();
      }
    }
    if (hood) {
      const a = cam.project(p.x - hw, h, zf, {});
      const b = cam.project(p.x + hw, h - 0.25, zf, {});
      const w = b.sx - a.sx;
      const hh = b.sy - a.sy;
      ctx.beginPath();
      ctx.moveTo(a.sx, b.sy);
      ctx.lineTo(a.sx + w * 0.04, a.sy + hh * 0.3);
      ctx.quadraticCurveTo(a.sx + w / 2, a.sy - hh * 0.15, b.sx - w * 0.04, a.sy + hh * 0.3);
      ctx.lineTo(b.sx, b.sy);
      ctx.closePath();
      ctx.fillStyle = P.paperDim;
      ctx.fill();
      ctx.strokeStyle = P.ink;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(a.sx + w * 0.15, a.sy + hh * 0.55);
      ctx.quadraticCurveTo(a.sx + w / 2, a.sy + hh * 0.2, b.sx - w * 0.15, a.sy + hh * 0.55);
      ctx.stroke();
      // Rust spots.
      ctx.fillStyle = rgba(P.ink, 0.35);
      for (const [fx, fy, fr] of [
        [0.2, 0.7, 0.05],
        [0.63, 0.62, 0.035],
        [0.8, 0.78, 0.03],
      ]) {
        ctx.beginPath();
        ctx.arc(a.sx + w * fx, a.sy + hh * fy, Math.max(1.5, w * fr * 0.3), 0, Math.PI * 2);
        ctx.fill();
      }
      return;
    }
    const a = cam.project(p.x - hw, h, zf, {});
    const b = cam.project(p.x + hw, h - 0.07, zf, {});
    ctx.fillStyle = legColor;
    ctx.fillRect(a.sx, a.sy, b.sx - a.sx, b.sy - a.sy);
    ctx.fillStyle = T.postHi;
    ctx.fillRect(a.sx, a.sy, b.sx - a.sx, 1);
  }

  function drawProp(ctx, p, cam, dpr, time) {
    if (p.appear <= 0) return;
    const k = U.easeOutCubic(p.appear);
    const h = p.h * k;
    ctx.save();
    ctx.globalAlpha = Math.min(1, p.appear * 1.5);
    if (p.kind === 'crate') {
      floorShadow(ctx, cam, p.x, p.z, (p.w / 2) * 1.1, 0.35, dpr);
      if (p.look === 'ac') drawAC(ctx, cam, p, h, time || 0);
      else if (p.look === 'pallet') drawPallet(ctx, cam, p, h);
      else drawCrate(ctx, cam, p, h, dpr);
    } else if (p.kind === 'shelf') {
      drawShelf(ctx, cam, p, h);
    }
    ctx.restore();
  }

  function drawTarget(ctx, t, cam, time, dpr) {
    if (!t.visible) return;
    switch (t.kind) {
      case 'plate':
        return drawPlate(ctx, t, cam, dpr);
      case 'bottle':
        return drawBottle(ctx, t, cam);
      case 'runner':
        return drawRunner(ctx, t, cam, time, dpr);
      case 'drone':
        return drawDrone(ctx, t, cam, time, dpr);
      case 'popper':
        return drawPopper(ctx, t, cam, time, dpr);
      case 'barrel':
        return drawBarrel(ctx, t, cam, time, dpr);
      case 'heavy':
        return drawHeavy(ctx, t, cam, time, dpr);
      case 'shutter':
        return drawShutter(ctx, t, cam, time, dpr);
      case 'bosspart':
        return drawBossPart(ctx, t, cam, time, dpr);
      default:
    }
  }

  ZTA.TargetArt = { drawTarget, drawProp, drawBoss, center, setTone, openness };
})(typeof window !== 'undefined' ? window : globalThis);
