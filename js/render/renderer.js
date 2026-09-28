/*
 * Frame composition. Order, back to front:
 *   cached range → decals → props + targets (far to near) → particles →
 *   shooting bench → damage numbers / cash → crosshair + hit marker →
 *   viewmodel → casings / smoke → scene flash → vignette.
 * Screen shake translates everything together, so aim is never affected by it.
 */
(function (root) {
  'use strict';
  const ZTA = root.ZTA;
  const U = ZTA.util;
  const P = ZTA.palette;
  const paint = ZTA.paint;

  class Renderer {
    constructor(canvas, game, fx, viewmodel) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d', { alpha: false });
      this.game = game;
      this.fx = fx;
      this.viewmodel = viewmodel;
      this.bg = new ZTA.Background();
      this.time = 0;
      this.items = [];
      this.resize();
    }

    resize() {
      const W = Math.max(320, Math.floor(this.canvas.clientWidth || window.innerWidth));
      const H = Math.max(240, Math.floor(this.canvas.clientHeight || window.innerHeight));
      const dpr = Math.min(window.devicePixelRatio || 1, 1.75);
      this.W = W;
      this.H = H;
      this.dpr = dpr;
      this.canvas.width = Math.round(W * dpr);
      this.canvas.height = Math.round(H * dpr);
      this.game.resize(W, H);
      this.bg.build(this.game.camera, W, H, Math.min(dpr, 1.5));
      const g = this.ctx.createRadialGradient(W / 2, H * 0.45, Math.min(W, H) * 0.35, W / 2, H * 0.45, Math.hypot(W, H) * 0.62);
      g.addColorStop(0, paint.rgba(P.ink, 0));
      g.addColorStop(1, paint.rgba(P.ink, 0.38));
      this.vignette = g;
    }

    render(dt) {
      this.time += dt;
      const ctx = this.ctx;
      const game = this.game;
      const cam = game.camera;
      const fx = this.fx;
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

      ctx.save();
      ctx.translate(fx.shakeX, fx.shakeY);
      this.bg.draw(ctx, cam.offX, cam.offY);
      fx.drawDecals(ctx);

      const items = this.items;
      items.length = 0;
      for (const p of game.targets.props) items.push(p);
      for (const t of game.targets.list) items.push(t);
      items.sort((a, b) => b.z - a.z);
      for (const it of items) {
        if (it instanceof ZTA.Prop) ZTA.TargetArt.drawProp(ctx, it, cam, this.dpr);
        else ZTA.TargetArt.drawTarget(ctx, it, cam, this.time, this.dpr);
      }

      fx.drawParticles(ctx);
      this._drawBench(ctx, cam);
      fx.drawLabels(ctx);
      if (game.live) {
        this._drawCrosshair(ctx);
        fx.drawHitmarker(ctx, game.aim.x, game.aim.y);
      }
      this.viewmodel.draw(ctx, this.dpr);
      fx.drawScreenParticles(ctx);
      ctx.restore();

      if (fx.sceneFlash > 0) {
        ctx.fillStyle = paint.rgba(P.paperHi, fx.sceneFlash);
        ctx.fillRect(0, 0, this.W, this.H);
      }
      ctx.fillStyle = this.vignette;
      ctx.fillRect(0, 0, this.W, this.H);
    }

    _drawBench(ctx, cam) {
      const r = cam.range;
      const b = r.bench;
      const hw = r.halfWidth;
      const fl = cam.project(-hw, b.y, b.zFar, {});
      const fr = cam.project(hw, b.y, b.zFar, {});
      const nl = cam.project(-hw, b.y, b.zNear, {});
      const nr = cam.project(hw, b.y, b.zNear, {});
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(fl.sx, fl.sy);
      ctx.lineTo(fr.sx, fr.sy);
      ctx.lineTo(nr.sx, Math.max(nr.sy, this.H + 60));
      ctx.lineTo(nl.sx, Math.max(nl.sy, this.H + 60));
      ctx.closePath();
      ctx.fillStyle = P.charcoal;
      ctx.fill();
      ctx.save();
      ctx.clip();
      ctx.fillStyle = paint.pattern(ctx, 5, 1.2, paint.rgba(P.ink, 0.6), this.dpr);
      ctx.fillRect(0, fl.sy, this.W, this.H - fl.sy + 80);
      // Stenciled lane marking on the bench top.
      const lab = cam.project(-0.95, b.y, (b.zFar + b.zNear) / 2, {});
      ctx.fillStyle = paint.rgba(P.paper, 0.32);
      ctx.font = '800 ' + Math.round(0.07 * lab.s) + "px 'Big Shoulders Stencil Display', Impact, sans-serif";
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('LANE 01', lab.sx, lab.sy);
      ctx.restore();
      // Lit front edge.
      ctx.strokeStyle = P.ink;
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.moveTo(fl.sx, fl.sy + 2);
      ctx.lineTo(fr.sx, fr.sy + 2);
      ctx.stroke();
      ctx.strokeStyle = P.paperDim;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(fl.sx, fl.sy);
      ctx.lineTo(fr.sx, fr.sy);
      ctx.stroke();
      ctx.restore();
    }

    _drawCrosshair(ctx) {
      const game = this.game;
      const w = game.weapons;
      const st = w.stats;
      const rt = w.active;
      const x = game.aim.x;
      const y = game.aim.y;
      const spreadPx = Math.tan(U.deg2rad(st.spread + rt.bloom)) * game.camera.f;
      const pulse = this.fx.crossPulse;
      const busy = w.state !== 'ready' || rt.ammo <= 0;
      ctx.save();
      ctx.translate(x, y);
      ctx.globalAlpha = busy ? 0.55 : 1;
      ctx.lineCap = 'butt';
      const passes = [
        [P.ink, 4],
        [P.paperHi, 2],
      ];
      if (st.pellets > 1) {
        for (const [c, lw] of passes) {
          ctx.strokeStyle = c;
          ctx.lineWidth = lw;
          ctx.beginPath();
          ctx.arc(0, 0, spreadPx + pulse * 4, 0, Math.PI * 2);
          ctx.stroke();
        }
      } else {
        const gap = Math.max(5, spreadPx + 4) + pulse * 5;
        const len = 9;
        for (const [c, lw] of passes) {
          ctx.strokeStyle = c;
          ctx.lineWidth = lw;
          ctx.beginPath();
          ctx.moveTo(gap, 0);
          ctx.lineTo(gap + len, 0);
          ctx.moveTo(-gap, 0);
          ctx.lineTo(-gap - len, 0);
          ctx.moveTo(0, gap);
          ctx.lineTo(0, gap + len);
          ctx.moveTo(0, -gap);
          ctx.lineTo(0, -gap - len);
          ctx.stroke();
        }
      }
      ctx.fillStyle = P.ink;
      ctx.fillRect(-2.5, -2.5, 5, 5);
      ctx.fillStyle = P.paperHi;
      ctx.fillRect(-1.25, -1.25, 2.5, 2.5);
      // Reload / draw progress ring.
      if (w.state === 'reloading') {
        ctx.globalAlpha = 1;
        const rr = (st.pellets > 1 ? spreadPx : Math.max(5, spreadPx + 4) + 9) + 9;
        const p = w.progress;
        for (const [c, lw] of passes) {
          ctx.strokeStyle = c;
          ctx.lineWidth = lw;
          ctx.beginPath();
          ctx.arc(0, 0, rr, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * p);
          ctx.stroke();
        }
      }
      ctx.restore();
    }
  }

  ZTA.Renderer = Renderer;
})(typeof window !== 'undefined' ? window : globalThis);
