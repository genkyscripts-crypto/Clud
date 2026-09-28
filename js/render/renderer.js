/*
 * Frame composition. Order, back to front:
 *   cached range → ambient layer → decals → props, targets and boss frames
 *   (far to near) → projectiles → particles → tracers / arcs → shooting bench
 *   → damage numbers / cash → crosshair + hit marker → viewmodel → casings /
 *   smoke → scene flash → grain → vignette → boss bar.
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
      this.bossItem = { z: 0, boss: null };
      this.grain = null;
      this._pq = {};
      this._pt = {};
      this.resize();
      game.events.on('range:changed', () => this.rebuild());
    }

    get theme() {
      return ZTA.Themes[this.game.camera.range.theme] || ZTA.Themes.basement;
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
      this.rebuild();
      const g = this.ctx.createRadialGradient(W / 2, H * 0.45, Math.min(W, H) * 0.35, W / 2, H * 0.45, Math.hypot(W, H) * 0.62);
      g.addColorStop(0, paint.rgba(P.ink, 0));
      g.addColorStop(1, paint.rgba(P.ink, 0.38));
      this.vignette = g;
    }

    /** Re-paints the cached range (after a resize or a range change). */
    rebuild() {
      if (!this.W) return;
      this.bg.build(this.game.camera, this.W, this.H, Math.min(this.dpr, 1.5));
    }

    _makeGrain() {
      const c = document.createElement('canvas');
      c.width = 256;
      c.height = 256;
      const g = c.getContext('2d');
      const img = g.createImageData(256, 256);
      for (let i = 0; i < img.data.length; i += 4) {
        const r = Math.random();
        if (r < 0.08) {
          const v = r < 0.04 ? 20 : 245;
          img.data[i] = v;
          img.data[i + 1] = v;
          img.data[i + 2] = v;
          img.data[i + 3] = 255;
        }
      }
      g.putImageData(img, 0, 0);
      return this.ctx.createPattern(c, 'repeat');
    }

    render(dt) {
      this.time += dt;
      const ctx = this.ctx;
      const game = this.game;
      const cam = game.camera;
      const fx = this.fx;
      const theme = this.theme;
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      ZTA.TargetArt.setTone(cam.range.tone);

      ctx.save();
      ctx.translate(fx.shakeX, fx.shakeY);
      this.bg.draw(ctx, cam.offX, cam.offY);
      if (theme.ambient) theme.ambient.draw(ctx, cam, this.time);
      fx.drawDecals(ctx);

      const items = this.items;
      items.length = 0;
      for (const p of game.targets.props) items.push(p);
      for (const t of game.targets.list) items.push(t);
      const boss = game.targets.boss;
      if (boss) {
        this.bossItem.boss = boss;
        this.bossItem.z = boss.z + 0.15;
        items.push(this.bossItem);
      }
      items.sort((a, b) => b.z - a.z);
      for (const it of items) {
        if (it === this.bossItem) ZTA.TargetArt.drawBoss(ctx, it.boss, cam, this.time);
        else if (it instanceof ZTA.Prop) ZTA.TargetArt.drawProp(ctx, it, cam, this.dpr, this.time);
        else ZTA.TargetArt.drawTarget(ctx, it, cam, this.time, this.dpr);
      }

      this._drawProjectiles(ctx, cam);
      fx.drawParticles(ctx);
      fx.drawLinks(ctx);
      this._drawBench(ctx, cam, theme.fg || {});
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
      if (game.save.settings.grain !== false) {
        if (!this.grain) this.grain = this._makeGrain();
        if (this.grain) {
          ctx.save();
          ctx.globalAlpha = theme.fg && theme.fg.grain ? 0.16 : 0.1;
          const ox = Math.floor(Math.random() * 256);
          const oy = Math.floor(Math.random() * 256);
          ctx.translate(-ox, -oy);
          ctx.fillStyle = this.grain;
          ctx.fillRect(0, 0, this.W + ox, this.H + oy);
          ctx.restore();
        }
      }
      ctx.fillStyle = this.vignette;
      ctx.fillRect(0, 0, this.W, this.H);
      if (boss && !boss.defeated) this._drawBossBar(ctx, boss);
    }

    _drawProjectiles(ctx, cam) {
      const q = this._pq;
      const tq = this._pt;
      this.game.projectiles.forEachAlive((p) => {
        cam.project(p.x, p.y, p.z, q);
        cam.project(p.x - p.vx * 0.05, p.y - p.vy * 0.05, Math.max(0.3, p.z - p.vz * 0.05), tq);
        const r = Math.max(3, 0.05 * q.s);
        ctx.save();
        // Smoke trail behind the grenade.
        ctx.strokeStyle = paint.rgba(P.smoke, 0.6);
        ctx.lineWidth = r * 1.4;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(tq.sx, tq.sy);
        ctx.lineTo(q.sx, q.sy);
        ctx.stroke();
        ctx.translate(q.sx, q.sy);
        ctx.rotate(p.age * 18);
        ctx.beginPath();
        ctx.ellipse(0, 0, r * 1.3, r, 0, 0, Math.PI * 2);
        ctx.fillStyle = P.ink;
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = P.paperHi;
        ctx.stroke();
        ctx.fillStyle = P.paper;
        ctx.fillRect(-r * 0.3, -r, r * 0.25, r * 2);
        ctx.restore();
      });
    }

    _drawBossBar(ctx, boss) {
      const W = this.W;
      const w = Math.min(520, W * 0.5);
      const x = (W - w) / 2;
      // Sits just under the challenge panel.
      const y = 226;
      let hp = 0;
      let max = 0;
      for (const r of boss.refs) {
        const alive = r.t.uid === r.uid && r.t.boss === boss;
        max += r.part.hp;
        if (alive && r.t.state === 'active') hp += (r.t.hp / r.t.maxHp) * r.part.hp;
      }
      const f = max ? hp / max : 0;
      ctx.save();
      ctx.fillStyle = P.ink;
      ctx.fillRect(x - 4, y - 4, w + 8, 20);
      ctx.fillStyle = P.charcoal;
      ctx.fillRect(x, y, w, 12);
      ctx.fillStyle = boss.enraged && Math.sin(this.time * 12) > 0 ? P.paperHi : P.paper;
      ctx.fillRect(x, y, w * f, 12);
      // Section ticks.
      ctx.fillStyle = P.ink;
      let acc = 0;
      for (const r of boss.refs) {
        acc += r.part.hp;
        if (acc < max) ctx.fillRect(x + (w * acc) / max - 1, y, 2, 12);
      }
      ctx.font = "800 15px 'Big Shoulders Display', 'Arial Narrow', Impact, sans-serif";
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.lineWidth = 4;
      ctx.lineJoin = 'round';
      ctx.strokeStyle = P.ink;
      const label = boss.def.name.toUpperCase() + (boss.enraged ? '  ·  ENRAGED' : '');
      ctx.strokeText(label, W / 2, y - 7);
      ctx.fillStyle = P.paperHi;
      ctx.fillText(label, W / 2, y - 7);
      ctx.restore();
    }

    _drawBench(ctx, cam, fg) {
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
      ctx.fillStyle = fg.top || P.charcoal;
      ctx.fill();
      ctx.save();
      ctx.clip();
      ctx.fillStyle = paint.pattern(ctx, 5, 1.2, fg.dots || paint.rgba(P.ink, 0.6), this.dpr);
      ctx.fillRect(0, fl.sy, this.W, this.H - fl.sy + 80);
      if (fg.grain) {
        // Wood grain on the scrap-yard workbench.
        ctx.strokeStyle = paint.rgba(P.ink, 0.22);
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        for (let i = 0; i < 14; i++) {
          const y = fl.sy + ((this.H - fl.sy) * i) / 14 + 6;
          ctx.moveTo(0, y);
          ctx.bezierCurveTo(this.W * 0.3, y + 5, this.W * 0.6, y - 4, this.W, y + 3);
        }
        ctx.stroke();
      }
      if (fg.rivets) {
        // Steel deck plate.
        const seam = cam.project(0, b.y, (b.zFar + b.zNear) / 2, {});
        ctx.strokeStyle = paint.rgba(P.paper, 0.18);
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(0, seam.sy);
        ctx.lineTo(this.W, seam.sy);
        ctx.stroke();
        ctx.fillStyle = paint.rgba(P.paper, 0.35);
        ctx.beginPath();
        for (let x = 20; x < this.W; x += 60) {
          ctx.moveTo(x + 2.2, fl.sy + 8);
          ctx.arc(x, fl.sy + 8, 2.2, 0, Math.PI * 2);
          ctx.moveTo(x + 32.2, seam.sy + 7);
          ctx.arc(x + 30, seam.sy + 7, 2.2, 0, Math.PI * 2);
        }
        ctx.fill();
      }
      if (fg.lights) {
        // Recessed guide lights along the vault bench edge.
        const n = 9;
        for (let i = 0; i < n; i++) {
          const x = fl.sx + ((fr.sx - fl.sx) * (i + 0.5)) / n;
          const on = Math.sin(this.time * 2 - i * 0.7) > -0.2;
          ctx.fillStyle = on ? P.paperHi : P.graphite;
          ctx.fillRect(x - 10, fl.sy + 7, 20, 3);
        }
      }
      const lab = cam.project(-0.95, b.y, (b.zFar + b.zNear) / 2, {});
      ctx.fillStyle = fg.label || paint.rgba(P.paper, 0.32);
      ctx.font = '800 ' + Math.round(0.07 * lab.s) + "px 'Big Shoulders Stencil Display', Impact, sans-serif";
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(fg.text || 'LANE 01', lab.sx, lab.sy);
      ctx.restore();
      // Lit front edge.
      ctx.strokeStyle = P.ink;
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.moveTo(fl.sx, fl.sy + 2);
      ctx.lineTo(fr.sx, fr.sy + 2);
      ctx.stroke();
      ctx.strokeStyle = fg.edge || P.paperDim;
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
      if (st.pellets > 1 || st.projectile) {
        for (const [c, lw] of passes) {
          ctx.strokeStyle = c;
          ctx.lineWidth = lw;
          ctx.beginPath();
          ctx.arc(0, 0, Math.max(10, spreadPx) + pulse * 4, 0, Math.PI * 2);
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
        const rr = (st.pellets > 1 || st.projectile ? Math.max(10, spreadPx) : Math.max(5, spreadPx + 4) + 9) + 9;
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
