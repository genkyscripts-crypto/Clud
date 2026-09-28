/*
 * Target and prop drawing. Uses the same world geometry as Target.hitTest so
 * the silhouette you see is exactly the area you can hit.
 *
 * Ink targets on paper walls: plates are ink discs with a painted paper center
 * ring; hits chip the paint to bright metal. Bottles are dark glass with paper
 * highlights. Runners are ink silhouettes with hatched armor and a pulsing core.
 */
(function (root) {
  'use strict';
  const ZTA = root.ZTA;
  const U = ZTA.util;
  const P = ZTA.palette;
  const paint = ZTA.paint;

  const tmp = {};
  const pa = {};
  const pb = {};

  /** Screen-space center of a target (for popups and effects). */
  function center(t, cam, out) {
    const o = out || {};
    if (t.kind === 'plate') {
      const c = t.plateCenter(tmp);
      cam.project(c.x, c.y, t.z, o);
    } else if (t.kind === 'bottle') {
      cam.project(t.x, t.baseY + t.def.shape.h * t.scale * 0.45, t.z, o);
    } else {
      const g = t.runnerGeom(tmp);
      cam.project(t.x, g.torsoMid, t.z, o);
    }
    return o;
  }

  function hpBar(ctx, t, x, y, w) {
    if (t.state !== 'active' || t.lastHitAge > 1.4 || t.hp >= t.maxHp) return;
    const alpha = 1 - U.clamp((t.lastHitAge - 1.0) / 0.4, 0, 1);
    const h = Math.max(3, Math.round(w * 0.06));
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = P.ink;
    ctx.fillRect(x - w / 2 - 2, y - 2, w + 4, h + 4);
    ctx.fillStyle = P.paper;
    ctx.fillRect(x - w / 2, y, w * U.clamp(t.hpShown, 0, 1), h);
    ctx.restore();
  }

  const ps = {};

  function floorShadow(ctx, cam, x, z, rw, alpha, dpr) {
    const p = cam.project(x, 0, z, ps);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = paint.pattern(ctx, 4, 1.25, P.ink, dpr);
    ctx.beginPath();
    ctx.ellipse(p.sx, p.sy, rw * p.s, rw * p.s * 0.16, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawPlate(ctx, t, cam, dpr) {
    const r0 = t.radius;
    const a = t.state === 'active' ? t.appearScale : 1;
    const c = t.plateCenter(tmp);
    const p = cam.project(c.x, c.y, t.z, pa);
    const r = r0 * a * p.s;
    const breaking = t.state === 'breaking';
    const fade = breaking ? 1 - U.clamp((t.breakAge - 0.75) / 0.35, 0, 1) : 1;

    if (!breaking) floorShadow(ctx, cam, c.x, t.z, r0 * 0.9, 0.35 * a, dpr);

    ctx.save();
    ctx.globalAlpha = fade;
    // Chains from the carrier.
    if (!breaking) {
      const hingeY = t.baseY;
      const topY = c.y + Math.cos(t.swing) * r0 * a;
      ctx.strokeStyle = P.ink;
      ctx.lineWidth = Math.max(1, 0.012 * p.s);
      ctx.setLineDash([Math.max(2, 0.025 * p.s), Math.max(1.5, 0.012 * p.s)]);
      for (const side of [-1, 1]) {
        const hx = t.x + side * r0 * 0.45;
        const ax = c.x + side * r0 * 0.45 * Math.cos(t.swing) - Math.sin(t.swing) * 0;
        cam.project(hx, hingeY, t.z, pb);
        const q = cam.project(ax, topY - 0.02, t.z, {});
        ctx.beginPath();
        ctx.moveTo(pb.sx, pb.sy);
        ctx.lineTo(q.sx, q.sy);
        ctx.stroke();
      }
      ctx.setLineDash([]);
    }

    ctx.translate(p.sx, p.sy);
    ctx.rotate(-t.swing + t.fallRot);
    const squash = Math.max(0.35, Math.cos(t.tilt));
    ctx.scale(1, squash);

    // Plate body with a paper rim so it reads on dark and light backdrops.
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fillStyle = P.ink;
    ctx.fill();
    ctx.lineWidth = Math.max(1.5, r * 0.06);
    ctx.strokeStyle = P.ink;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.9, 0, Math.PI * 2);
    ctx.strokeStyle = paint.rgba(P.paper, 0.28);
    ctx.lineWidth = Math.max(1, r * 0.03);
    ctx.stroke();
    // Halftone light on the upper left.
    ctx.save();
    ctx.beginPath();
    ctx.arc(-r * 0.25, -r * 0.3, r * 0.75, 0, Math.PI * 2);
    ctx.clip();
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = paint.pattern(ctx, 4, 0.9, paint.rgba(P.paper, 0.5), dpr);
    ctx.fillRect(-r, -r, r * 2, r * 2);
    ctx.restore();
    // Painted weak-point ring.
    const wr = r * t.def.weak.r;
    ctx.beginPath();
    ctx.arc(0, 0, wr, 0, Math.PI * 2);
    ctx.strokeStyle = P.paper;
    ctx.lineWidth = Math.max(1.5, r * 0.07);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 0, Math.max(1.5, wr * 0.28), 0, Math.PI * 2);
    ctx.fillStyle = P.paper;
    ctx.fill();
    // Hits chip the paint to bright metal.
    for (const d of t.dents) {
      const dx = d.x * r;
      const dy = -d.y * r;
      const s = Math.max(1.5, r * 0.07 * d.s * (d.weak ? 1.3 : 1));
      ctx.fillStyle = P.paperHi;
      ctx.beginPath();
      ctx.arc(dx, dy, s, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = paint.rgba(P.paperHi, 0.7);
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let k = 0; k < 3; k++) {
        const ang = d.s * 9 + k * 2.1;
        ctx.moveTo(dx, dy);
        ctx.lineTo(dx + Math.cos(ang) * s * 2.2, dy + Math.sin(ang) * s * 2.2);
      }
      ctx.stroke();
    }
    // Hit flash.
    if (t.flash > 0) {
      ctx.globalAlpha = fade * t.flash * 0.75;
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.fillStyle = P.paperHi;
      ctx.fill();
    }
    ctx.restore();

    if (!breaking) hpBar(ctx, t, p.sx, p.sy + r * squash + 6, r * 1.6);
  }

  function bottlePath(ctx, w, h) {
    const bw = w / 2;
    const nw = w * 0.18;
    ctx.beginPath();
    ctx.moveTo(-bw, 0);
    ctx.lineTo(-bw, -h * 0.6);
    ctx.quadraticCurveTo(-bw, -h * 0.72, -nw, -h * 0.76);
    ctx.lineTo(-nw, -h * 0.95);
    ctx.lineTo(-nw * 1.3, -h * 0.96);
    ctx.lineTo(-nw * 1.3, -h);
    ctx.lineTo(nw * 1.3, -h);
    ctx.lineTo(nw * 1.3, -h * 0.96);
    ctx.lineTo(nw, -h * 0.95);
    ctx.lineTo(nw, -h * 0.76);
    ctx.quadraticCurveTo(bw, -h * 0.72, bw, -h * 0.6);
    ctx.lineTo(bw, 0);
    ctx.closePath();
  }

  function drawBottle(ctx, t, cam) {
    if (t.state !== 'active') return;
    const a = t.appearScale;
    const p = cam.project(t.x, t.baseY, t.z, pa);
    const w = t.def.shape.w * t.scale * p.s;
    const h = t.def.shape.h * t.scale * p.s * Math.min(1, a);
    if (h < 1) return;
    ctx.save();
    ctx.translate(p.sx, p.sy);
    bottlePath(ctx, w, h);
    ctx.fillStyle = paint.rgba(P.ink, 0.92);
    ctx.fill();
    ctx.lineWidth = Math.max(1, w * 0.07);
    ctx.strokeStyle = P.ink;
    ctx.stroke();
    // Label band.
    ctx.fillStyle = P.paper;
    ctx.fillRect(-w / 2, -h * 0.42, w, h * 0.18);
    ctx.fillStyle = P.ink;
    ctx.fillRect(-w * 0.28, -h * 0.35, w * 0.56, Math.max(1, h * 0.03));
    // Glass highlight.
    ctx.fillStyle = paint.rgba(P.paperHi, 0.75);
    ctx.fillRect(-w * 0.34, -h * 0.58, Math.max(1, w * 0.1), h * 0.12);
    ctx.fillRect(-w * 0.34, -h * 0.2, Math.max(1, w * 0.1), h * 0.14);
    if (t.flash > 0) {
      ctx.globalAlpha = t.flash;
      bottlePath(ctx, w, h);
      ctx.fillStyle = P.paperHi;
      ctx.fill();
    }
    ctx.restore();
  }

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
    // Trolley.
    const tw = g.trolleyW * s;
    const th = g.pivotY * s;
    ctx.fillStyle = P.ink;
    ctx.fillRect(base.sx - tw / 2, base.sy - th, tw, th * 0.8);
    ctx.strokeStyle = paint.rgba(P.paper, 0.5);
    ctx.lineWidth = 1;
    ctx.strokeRect(base.sx - tw / 2 + 2, base.sy - th + 2, tw - 4, th * 0.8 - 4);
    for (const side of [-0.32, 0.32]) {
      ctx.beginPath();
      ctx.arc(base.sx + side * tw, base.sy - th * 0.14, th * 0.2, 0, Math.PI * 2);
      ctx.fillStyle = P.ink;
      ctx.fill();
      ctx.strokeStyle = P.paper;
      ctx.lineWidth = Math.max(1, s * 0.012);
      ctx.stroke();
    }
    ctx.restore();
    if (breaking) return;

    // Silhouette, flipped up about the pivot.
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
    // Post from trolley to torso.
    ctx.fillStyle = P.ink;
    ctx.fillRect(-0.03 * s, -tb, 0.06 * s, tb);
    ctx.fill(body);
    // Hatched armor.
    ctx.save();
    ctx.clip(body);
    ctx.strokeStyle = paint.rgba(P.paper, 0.22);
    ctx.lineWidth = Math.max(1, s * 0.01);
    ctx.beginPath();
    for (let k = -hw * 3; k < hw * 3; k += Math.max(4, s * 0.05)) {
      ctx.moveTo(k, -tb);
      ctx.lineTo(k + (tt - tb), -tt);
    }
    ctx.stroke();
    // Damage cracks at 66% and 33%.
    const hpf = t.hp / t.maxHp;
    ctx.strokeStyle = P.paperHi;
    ctx.lineWidth = Math.max(1, s * 0.012);
    if (hpf < 0.67) {
      ctx.beginPath();
      ctx.moveTo(-hw * 0.8, -tb - (tt - tb) * 0.7);
      ctx.lineTo(-hw * 0.4, -tb - (tt - tb) * 0.55);
      ctx.lineTo(-hw * 0.5, -tb - (tt - tb) * 0.35);
      ctx.stroke();
    }
    if (hpf < 0.34) {
      ctx.beginPath();
      ctx.moveTo(hw * 0.9, -tb - (tt - tb) * 0.2);
      ctx.lineTo(hw * 0.45, -tb - (tt - tb) * 0.38);
      ctx.lineTo(hw * 0.6, -tb - (tt - tb) * 0.6);
      ctx.lineTo(hw * 0.3, -tb - (tt - tb) * 0.75);
      ctx.stroke();
    }
    ctx.restore();
    ctx.lineWidth = Math.max(1, s * 0.012);
    ctx.strokeStyle = paint.rgba(P.paper, 0.55);
    ctx.stroke(body);

    // Pulsing core: the weak point.
    const cy = -(g.coreY - g.pivotY) * s;
    const cr = g.coreR * s;
    const pulse = 1.35 + 0.18 * Math.sin(time * 6 + t.phase);
    ctx.beginPath();
    ctx.arc(0, cy, cr * pulse, 0, Math.PI * 2);
    ctx.strokeStyle = paint.rgba(P.paperHi, 0.55);
    ctx.lineWidth = Math.max(1, cr * 0.18);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, cy, cr, 0, Math.PI * 2);
    ctx.fillStyle = P.paperHi;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(0, cy, cr * 0.45, 0, Math.PI * 2);
    ctx.fillStyle = P.ink;
    ctx.fill();

    if (t.flash > 0) {
      ctx.globalAlpha = t.flash * 0.7;
      ctx.fillStyle = P.paperHi;
      ctx.fill(body);
    }
    ctx.restore();
    const top = cam.project(x, g.headY + g.headR, t.z, {});
    hpBar(ctx, t, top.sx, top.sy - 12, g.torsoW * s);
  }

  function drawTarget(ctx, t, cam, time, dpr) {
    if (!t.visible) return;
    if (t.kind === 'plate') drawPlate(ctx, t, cam, dpr);
    else if (t.kind === 'bottle') drawBottle(ctx, t, cam);
    else if (t.kind === 'runner') drawRunner(ctx, t, cam, time, dpr);
  }

  function drawProp(ctx, p, cam, dpr) {
    if (p.appear <= 0) return;
    const k = U.easeOutCubic(p.appear);
    const h = p.h * k;
    const hw = p.w / 2;
    const zf = p.zFront;
    const zb = p.z + p.d / 2;
    ctx.save();
    ctx.globalAlpha = Math.min(1, p.appear * 1.5);
    if (p.kind === 'crate') {
      floorShadow(ctx, cam, p.x, p.z, hw * 1.1, 0.35, dpr);
      const fl = cam.project(p.x - hw, 0, zf, {});
      const fr = cam.project(p.x + hw, h, zf, {});
      const bl = cam.project(p.x - hw, h, zb, {});
      const br = cam.project(p.x + hw, h, zb, {});
      // Top face.
      ctx.beginPath();
      ctx.moveTo(fl.sx, fr.sy);
      ctx.lineTo(fr.sx, fr.sy);
      ctx.lineTo(br.sx, br.sy);
      ctx.lineTo(bl.sx, bl.sy);
      ctx.closePath();
      ctx.fillStyle = P.paper;
      ctx.fill();
      ctx.strokeStyle = P.ink;
      ctx.lineWidth = 2;
      ctx.stroke();
      // Side face toward the center of the view.
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
      ctx.fillStyle = P.paperDim;
      ctx.fill();
      ctx.stroke();
      // Front face.
      const fw = fr.sx - fl.sx;
      const fh = fl.sy - fr.sy;
      ctx.fillStyle = P.paperDim;
      ctx.fillRect(fl.sx, fr.sy, fw, fh);
      ctx.save();
      ctx.beginPath();
      ctx.rect(fl.sx, fr.sy, fw, fh);
      ctx.clip();
      ctx.fillStyle = paint.pattern(ctx, 4, 1, paint.rgba(P.ink, 0.35), dpr);
      ctx.fillRect(fl.sx, fr.sy + fh * 0.55, fw, fh * 0.45);
      ctx.restore();
      ctx.strokeStyle = P.ink;
      ctx.lineWidth = 2;
      ctx.strokeRect(fl.sx, fr.sy, fw, fh);
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      for (let i = 1; i < 3; i++) {
        ctx.moveTo(fl.sx, fr.sy + (fh * i) / 3);
        ctx.lineTo(fr.sx, fr.sy + (fh * i) / 3);
      }
      ctx.moveTo(fl.sx, fr.sy);
      ctx.lineTo(fr.sx, fl.sy);
      ctx.stroke();
      if (fh > 24) {
        ctx.font = '800 ' + Math.round(fh * 0.14) + "px 'Big Shoulders Stencil Display', Impact, sans-serif";
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = P.paperDim;
        ctx.fillRect(fl.sx + fw * 0.28, fr.sy + fh * 0.42, fw * 0.44, fh * 0.18);
        ctx.fillStyle = P.ink;
        ctx.fillText('GLASS', fl.sx + fw / 2, fr.sy + fh * 0.515);
      }
    } else if (p.kind === 'shelf') {
      const legX = hw - 0.12;
      ctx.fillStyle = P.ink;
      for (const lx of [-legX, legX]) {
        const a = cam.project(p.x + lx - 0.035, h, zf, {});
        const b = cam.project(p.x + lx + 0.035, 0, zf, {});
        ctx.fillRect(a.sx, a.sy, b.sx - a.sx, b.sy - a.sy);
      }
      const a = cam.project(p.x - hw, h, zf, {});
      const b = cam.project(p.x + hw, h - 0.07, zf, {});
      ctx.fillRect(a.sx, a.sy, b.sx - a.sx, b.sy - a.sy);
      ctx.fillStyle = paint.rgba(P.paper, 0.6);
      ctx.fillRect(a.sx, a.sy, b.sx - a.sx, 1);
    }
    ctx.restore();
  }

  ZTA.TargetArt = { drawTarget, drawProp, center };
})(typeof window !== 'undefined' ? window : globalThis);
