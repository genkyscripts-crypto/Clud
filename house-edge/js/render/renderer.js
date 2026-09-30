/*
 * Canvas renderer. Black-and-white ink casino with controlled accents of
 * casino red (hostile), electric green (shock / safe lanes) and jackpot gold
 * (rewards and the player's power).
 *
 * Readability rules:
 *  - hostile bullets are drawn LAST over every friendly effect, always as a
 *    white core with a red rim and a dark outline, in four silhouettes
 *    (orb, card, diamond, needle) plus the roulette ball;
 *  - friendly shots are streaks, never round, and never red;
 *  - telegraphs (spawn markers, sniper lines, ring gaps, hot sectors) are not
 *    reduced by the effect-density setting;
 *  - screen shake offsets the picture only; aim uses the unshaken transform.
 */
(function (root) {
  'use strict';
  const HE = root.HE;
  const D = HE.data;
  const U = HE.util;
  const VW = D.TUNING.view.w;
  const VH = D.TUNING.view.h;
  const A = D.TUNING.arena;

  const C = {
    ink: '#0d0d0f',
    ink2: '#17171a',
    felt: '#131315',
    paper: '#efe9dc',
    dim: '#8d8a80',
    faint: '#2a2a2e',
    red: '#e8424c',
    green: '#35e38a',
    gold: '#f2c14e',
    ice: '#9fd8ff',
    orange: '#ff7a3d',
  };

  function hashRand(seed) {
    let s = seed >>> 0;
    return () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };
  }

  class Renderer {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.dpr = 1;
      this.scale = 1;
      this.ox = 0;
      this.oy = 0;
      this.floorCache = null;
      this.floorKey = '';
      this.t = 0;
      this.shakeX = 0;
      this.shakeY = 0;
      this.frameTimes = [];
      this.tutorialText = null;
      this.resize();
    }

    resize() {
      const w = this.canvas.clientWidth || window.innerWidth;
      const h = this.canvas.clientHeight || window.innerHeight;
      this.dpr = Math.min(2, window.devicePixelRatio || 1);
      this.canvas.width = Math.round(w * this.dpr);
      this.canvas.height = Math.round(h * this.dpr);
      this.cssW = w;
      this.cssH = h;
      this.scale = Math.min(w / VW, h / VH);
      this.ox = (w - VW * this.scale) / 2;
      this.oy = (h - VH * this.scale) / 2;
      this.floorKey = '';
      if (this._sprites) this._sprites.clear();
    }

    /** Screen (CSS px) → arena coordinates, ignoring screen shake. */
    screenToArena(sx, sy) {
      const r = this.canvas.getBoundingClientRect();
      const vx = (sx - r.left - this.ox) / this.scale;
      const vy = (sy - r.top - this.oy) / this.scale;
      return { x: vx - A.x, y: vy - A.y };
    }

    /** Arena → screen CSS px (for DOM overlays). */
    arenaToScreen(x, y) {
      return { x: this.ox + (x + A.x) * this.scale, y: this.oy + (y + A.y) * this.scale };
    }

    _view() {
      const k = this.dpr * this.scale;
      this.ctx.setTransform(k, 0, 0, k, this.dpr * this.ox, this.dpr * this.oy);
    }

    draw(game, dt) {
      this.t += dt;
      const ctx = this.ctx;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = '#060607';
      ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
      this._view();
      const run = game.run;
      if (run && run.state !== 'results') this._drawRun(game);
      else this._drawLobby(game);
    }

    /* ============================================================ run */

    _drawRun(g) {
      const ctx = this.ctx;
      const s = g.shake;
      this.shakeX = s > 0.1 ? (Math.random() - 0.5) * s : 0;
      this.shakeY = s > 0.1 ? (Math.random() - 0.5) * s : 0;
      ctx.save();
      ctx.translate(A.x + this.shakeX, A.y + this.shakeY);
      ctx.beginPath();
      ctx.rect(0, 0, A.w, A.h);
      ctx.clip();
      this._drawFloor(g);
      this._drawBossFloor(g);
      this._drawZones(g);
      this._drawPickups(g);
      this._drawTelegraphs(g);
      this._drawEnemies(g);
      this._drawShots(g);
      this._drawPlayer(g);
      this._drawFx(g);
      this._drawBullets(g);
      this._drawTexts(g);
      ctx.restore();
      // Arena frame.
      ctx.strokeStyle = C.paper;
      ctx.lineWidth = 2;
      ctx.strokeRect(A.x - 3, A.y - 3, A.w + 6, A.h + 6);
      ctx.strokeStyle = C.red;
      ctx.lineWidth = 1;
      ctx.strokeRect(A.x - 7, A.y - 7, A.w + 14, A.h + 14);
      if (g.flash.t > 0) {
        ctx.globalAlpha = (g.flash.t / g.flash.max) * 0.28;
        ctx.fillStyle = g.flash.color;
        ctx.fillRect(A.x, A.y, A.w, A.h);
        ctx.globalAlpha = 1;
      }
      this._drawBanners(g);
      this._drawHUD(g);
    }

    _drawFloor(g) {
      const run = g.run;
      const theme = D.floors[run.floorIndex].theme;
      const key = theme + '|' + (run.room ? run.room.layout : '') + '|' + this.scale.toFixed(3) + '|' + this.dpr;
      if (key !== this.floorKey) {
        this.floorKey = key;
        const res = Math.min(2.5, this.scale * this.dpr);
        const cv = this.floorCache || document.createElement('canvas');
        cv.width = Math.ceil(A.w * res);
        cv.height = Math.ceil(A.h * res);
        const c = cv.getContext('2d');
        c.setTransform(res, 0, 0, res, 0, 0);
        this._paintFloor(c, theme, g.layout);
        this.floorCache = cv;
      }
      this.ctx.drawImage(this.floorCache, 0, 0, A.w, A.h);
    }

    _paintFloor(c, theme, layout) {
      const rnd = hashRand(theme === 'rotunda' ? 7 : 3);
      c.fillStyle = theme === 'rotunda' ? '#121114' : C.felt;
      c.fillRect(0, 0, A.w, A.h);
      // Ink cross-hatching.
      c.strokeStyle = 'rgba(239,233,220,0.035)';
      c.lineWidth = 1;
      for (let i = -A.h; i < A.w; i += 9) {
        c.beginPath();
        c.moveTo(i + rnd() * 3, 0);
        c.lineTo(i + A.h + rnd() * 3, A.h);
        c.stroke();
      }
      // Faded suit pattern.
      c.fillStyle = 'rgba(239,233,220,0.045)';
      c.font = '26px serif';
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      const suits = ['♠', '♥', '♦', '♣'];
      let k = 0;
      for (let y = 40; y < A.h; y += 90) {
        for (let x = 40 + ((y / 90) % 2) * 60; x < A.w; x += 120) c.fillText(suits[k++ % 4], x, y);
      }
      // Street-art grit: splatters and drips.
      for (let i = 0; i < 26; i++) {
        const x = rnd() * A.w;
        const y = rnd() * A.h;
        c.fillStyle = 'rgba(239,233,220,' + (0.008 + rnd() * 0.014) + ')';
        c.beginPath();
        c.arc(x, y, 6 + rnd() * 30, 0, U.TAU);
        c.fill();
      }
      if (theme === 'rotunda') {
        // Inlaid wheel.
        const cx = A.w / 2;
        const cy = A.h / 2;
        for (let i = 0; i < 37; i++) {
          const a0 = (i / 37) * U.TAU;
          const a1 = ((i + 1) / 37) * U.TAU;
          c.beginPath();
          c.moveTo(cx, cy);
          c.arc(cx, cy, 300, a0, a1);
          c.closePath();
          c.fillStyle = i === 0 ? 'rgba(53,227,138,0.05)' : i % 2 ? 'rgba(232,66,76,0.045)' : 'rgba(0,0,0,0.25)';
          c.fill();
        }
        c.strokeStyle = 'rgba(239,233,220,0.08)';
        c.lineWidth = 2;
        for (const r of [300, 250, 120]) {
          c.beginPath();
          c.arc(cx, cy, r, 0, U.TAU);
          c.stroke();
        }
      } else {
        // Arcade carpet stripes.
        c.strokeStyle = 'rgba(232,66,76,0.06)';
        c.lineWidth = 14;
        for (let y = 60; y < A.h; y += 160) {
          c.beginPath();
          c.moveTo(0, y);
          for (let x = 0; x <= A.w; x += 40) c.lineTo(x, y + Math.sin(x / 60) * 10);
          c.stroke();
        }
      }
      // Border rail.
      c.strokeStyle = 'rgba(239,233,220,0.12)';
      c.lineWidth = 3;
      c.strokeRect(10, 10, A.w - 20, A.h - 20);
      // Pillars.
      for (const p of layout.pillars) {
        c.fillStyle = 'rgba(0,0,0,0.5)';
        c.beginPath();
        c.ellipse(p.x + 8, p.y + 10, p.r, p.r * 0.9, 0, 0, U.TAU);
        c.fill();
        c.fillStyle = '#1d1d21';
        c.beginPath();
        c.arc(p.x, p.y, p.r, 0, U.TAU);
        c.fill();
        c.save();
        c.clip();
        c.strokeStyle = 'rgba(239,233,220,0.18)';
        c.lineWidth = 1.2;
        for (let i = -p.r; i < p.r; i += 5) {
          c.beginPath();
          c.moveTo(p.x + i, p.y - p.r);
          c.lineTo(p.x + i + p.r * 0.6, p.y + p.r);
          c.stroke();
        }
        c.restore();
        c.strokeStyle = C.paper;
        c.lineWidth = 2.5;
        c.beginPath();
        c.arc(p.x, p.y, p.r, 0, U.TAU);
        c.stroke();
        c.strokeStyle = C.red;
        c.lineWidth = 1;
        c.beginPath();
        c.arc(p.x, p.y, p.r - 6, 0, U.TAU);
        c.stroke();
      }
    }

    _drawBossFloor(g) {
      const b = g.boss;
      if (!b || b.dead) return;
      const ctx = this.ctx;
      if (b.sectors) {
        const s = b.sectors;
        const live = s.live;
        const pulse = 0.5 + 0.5 * Math.sin(this.t * 14);
        for (let i = 0; i < 8; i++) {
          if (i % 2 !== s.parity) continue;
          const a0 = s.rot + (i / 8) * U.TAU;
          const a1 = s.rot + ((i + 1) / 8) * U.TAU;
          ctx.beginPath();
          ctx.moveTo(s.cx + Math.cos(a0) * 70, s.cy + Math.sin(a0) * 70);
          ctx.arc(s.cx, s.cy, 1600, a0, a1);
          ctx.arc(s.cx, s.cy, 70, a1, a0, true);
          ctx.closePath();
          ctx.fillStyle = live ? 'rgba(232,66,76,' + (0.34 + pulse * 0.1) + ')' : 'rgba(232,66,76,' + (0.08 + pulse * 0.1) + ')';
          ctx.fill();
          ctx.save();
          ctx.clip();
          ctx.strokeStyle = live ? 'rgba(239,233,220,0.35)' : 'rgba(232,66,76,0.55)';
          ctx.lineWidth = 2;
          for (let k = -A.h; k < A.w; k += 22) {
            ctx.beginPath();
            ctx.moveTo(k, 0);
            ctx.lineTo(k + A.h, A.h);
            ctx.stroke();
          }
          ctx.restore();
        }
      }
      if (b.ball) {
        ctx.setLineDash([6, 10]);
        ctx.strokeStyle = 'rgba(239,233,220,0.28)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.ellipse(A.w / 2, A.h / 2, A.w / 2 - 70, A.h / 2 - 60, 0, 0, U.TAU);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    _drawZones(g) {
      const ctx = this.ctx;
      const Z = g.zones;
      ctx.lineCap = 'round';
      for (let i = 0; i < Z.n; i++) {
        const z = Z.items[i];
        const a = U.clamp(z.life / z.max, 0, 1);
        if (z.kind === 'steam') {
          ctx.fillStyle = 'rgba(230,240,245,' + 0.16 * a + ')';
          ctx.beginPath();
          ctx.arc(z.x, z.y, z.r, 0, U.TAU);
          ctx.fill();
          ctx.strokeStyle = 'rgba(230,240,245,' + 0.4 * a + ')';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(z.x, z.y, z.r * (0.6 + 0.1 * Math.sin(this.t * 5 + i)), this.t * 2, this.t * 2 + 4);
          ctx.stroke();
          continue;
        }
        let col;
        let w = z.width;
        if (z.kind === 'flame') col = 'rgba(255,122,61,' + (0.55 + 0.3 * Math.sin(this.t * 30 + i)) * a + ')';
        else if (z.kind === 'spark') col = 'rgba(53,227,138,' + 0.7 * a + ')';
        else if (z.kind === 'skid') {
          col = 'rgba(159,216,255,' + 0.45 * a + ')';
          w *= 0.7;
        } else col = 'rgba(255,255,255,0.3)';
        ctx.strokeStyle = col;
        ctx.lineWidth = w;
        ctx.beginPath();
        if (z.kind === 'spark') {
          const n = 3;
          ctx.moveTo(z.x, z.y);
          for (let k = 1; k <= n; k++) {
            const t = k / n;
            const j = k < n ? (Math.random() - 0.5) * 10 : 0;
            ctx.lineTo(U.lerp(z.x, z.x2, t) + j, U.lerp(z.y, z.y2, t) - j);
          }
          ctx.lineWidth = 3;
        } else {
          ctx.moveTo(z.x, z.y);
          ctx.lineTo(z.x2, z.y2);
        }
        ctx.stroke();
      }
    }

    _drawPickups(g) {
      const ctx = this.ctx;
      const P = g.pickups;
      for (let i = 0; i < P.n; i++) {
        const c = P.items[i];
        const spin = Math.abs(Math.cos(this.t * 6 + i));
        const r = 5 + Math.min(3, c.value * 0.4);
        ctx.fillStyle = C.green;
        ctx.strokeStyle = C.ink;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.ellipse(c.x, c.y, r * (0.35 + 0.65 * spin), r, 0, 0, U.TAU);
        ctx.fill();
        ctx.stroke();
        if (spin > 0.5) {
          ctx.strokeStyle = C.paper;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.ellipse(c.x, c.y, r * 0.5 * spin, r * 0.5, 0, 0, U.TAU);
          ctx.stroke();
        }
      }
    }

    _drawTelegraphs(g) {
      const ctx = this.ctx;
      const E = g.enemies;
      for (let i = 0; i < E.n; i++) {
        const e = E.items[i];
        if (e.dead) continue;
        if (e.spawnT > 0) {
          const k = e.spawnT / 0.8;
          ctx.strokeStyle = C.red;
          ctx.lineWidth = 2;
          ctx.setLineDash([4, 5]);
          ctx.beginPath();
          ctx.arc(e.x, e.y, e.r + 18 * k, 0, U.TAU);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.fillStyle = 'rgba(232,66,76,0.35)';
          ctx.font = 'bold 16px "Big Shoulders Display", Impact, sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText('!', e.x, e.y);
          continue;
        }
        if (e.frozenT > 0) continue;
        if (e.kind === 'sniper' && (e.state === 'aim' || e.state === 'lock')) {
          const lock = e.state === 'lock';
          ctx.strokeStyle = lock ? (Math.floor(this.t * 20) % 2 ? C.red : C.paper) : 'rgba(232,66,76,0.55)';
          ctx.lineWidth = lock ? 3 : 1.5;
          if (!lock) ctx.setLineDash([10, 8]);
          ctx.beginPath();
          ctx.moveTo(e.x, e.y);
          ctx.lineTo(e.x + Math.cos(e.aim) * 1600, e.y + Math.sin(e.aim) * 1600);
          ctx.stroke();
          ctx.setLineDash([]);
        }
        if (e.kind === 'ringcaster' && e.tellT > 0) {
          const prog = 1 - U.clamp(e.fireT / e.def.tell, 0, 1);
          ctx.strokeStyle = 'rgba(232,66,76,' + (0.3 + prog * 0.4) + ')';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(e.x, e.y, e.r + 8 + prog * 22, 0, U.TAU);
          ctx.stroke();
          this._gapWedge(e.x, e.y, e.gapAngle, (e.def.gap / e.def.count) * Math.PI, 220, prog);
        }
        if (e.kind === 'dealer' && e.tellT > 0) {
          const prog = 1 - U.clamp(e.fireT / e.def.tell, 0, 1);
          ctx.strokeStyle = 'rgba(232,66,76,' + (0.25 + prog * 0.5) + ')';
          ctx.lineWidth = 2;
          const a = HE.Enemies.toPlayer(g, e);
          ctx.beginPath();
          ctx.arc(e.x, e.y, 34 + prog * 12, a - e.def.spread / 2, a + e.def.spread / 2);
          ctx.stroke();
        }
        if (e.kind === 'usher' && e.tellT > 0) {
          ctx.fillStyle = 'rgba(232,66,76,0.6)';
          ctx.beginPath();
          ctx.arc(e.x + Math.cos(e.facing) * (e.r + 8), e.y + Math.sin(e.facing) * (e.r + 8), 4 + 3 * Math.sin(this.t * 30), 0, U.TAU);
          ctx.fill();
        }
        if (e.kind === 'turret' && e.state === 'tell') {
          ctx.strokeStyle = 'rgba(232,66,76,0.7)';
          ctx.lineWidth = 2;
          for (let k = 0; k < e.def.arms; k++) {
            const a = e.spinAngle + (k / e.def.arms) * U.TAU;
            ctx.beginPath();
            ctx.moveTo(e.x + Math.cos(a) * (e.r + 6), e.y + Math.sin(a) * (e.r + 6));
            ctx.lineTo(e.x + Math.cos(a) * (e.r + 40), e.y + Math.sin(a) * (e.r + 40));
            ctx.stroke();
          }
        }
        if (e.boss && e.pat && e.pat.ringTell > 0) {
          const prog = 1 - U.clamp(e.pat.ringTell / 0.65, 0, 1);
          this._gapWedge(e.x, e.y, e.pat.ringGap, (5 / 36) * Math.PI, 360, prog);
        }
      }
    }

    /** Green safe-lane wedge: where a ring's gap will be. */
    _gapWedge(x, y, angle, half, len, prog) {
      const ctx = this.ctx;
      ctx.fillStyle = 'rgba(53,227,138,' + (0.12 + prog * 0.18) + ')';
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.arc(x, y, len, angle - half, angle + half);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = 'rgba(53,227,138,' + (0.45 + prog * 0.4) + ')';
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    _drawEnemies(g) {
      const ctx = this.ctx;
      const E = g.enemies;
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.beginPath();
      for (let i = 0; i < E.n; i++) {
        const e = E.items[i];
        if (e.dead || e.spawnT > 0) continue;
        ctx.moveTo(e.x + 4 + e.r * 0.9, e.y + e.r * 0.7);
        ctx.ellipse(e.x + 4, e.y + e.r * 0.7, e.r * 0.9, e.r * 0.4, 0, 0, U.TAU);
      }
      ctx.fill();
      for (let i = 0; i < E.n; i++) {
        const e = E.items[i];
        if (e.dead || e.spawnT > 0) continue;
        if (e.boss) this._drawBoss(g, e);
        else this._drawEnemyBody(g, e);
        // Status overlays.
        if (e.elite) {
          ctx.strokeStyle = C.gold;
          ctx.lineWidth = 2;
          ctx.beginPath();
          for (let k = 0; k < 4; k++) {
            const a0 = this.t + (k / 4) * U.TAU;
            ctx.moveTo(e.x + Math.cos(a0) * (e.r + 6), e.y + Math.sin(a0) * (e.r + 6));
            ctx.arc(e.x, e.y, e.r + 6, a0, a0 + 1);
          }
          ctx.stroke();
        }
        if (e.chill > 0 && !e.boss) {
          ctx.fillStyle = 'rgba(159,216,255,' + (e.chill / 100) * 0.4 + ')';
          ctx.beginPath();
          ctx.arc(e.x, e.y, e.r, 0, U.TAU);
          ctx.fill();
        }
        if (e.frozenT > 0) {
          ctx.strokeStyle = C.ice;
          ctx.lineWidth = 2.5;
          ctx.beginPath();
          for (let k = 0; k < 6; k++) {
            const a = (k / 6) * U.TAU + 0.3;
            const px = e.x + Math.cos(a) * (e.r + 5);
            const py = e.y + Math.sin(a) * (e.r + 5);
            if (k === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
          }
          ctx.closePath();
          ctx.stroke();
        }
        if (e.burnStacks > 0) {
          ctx.fillStyle = C.orange;
          for (let k = 0; k < e.burnStacks; k++) {
            const a = this.t * 3 + (k / e.burnStacks) * U.TAU;
            const fy = -Math.abs(Math.sin(this.t * 12 + k)) * 5;
            ctx.beginPath();
            ctx.arc(e.x + Math.cos(a) * e.r * 0.8, e.y + Math.sin(a) * e.r * 0.8 + fy, 2.4, 0, U.TAU);
            ctx.fill();
          }
        }
        if (g.t - e.shockedAt < 0.3) {
          ctx.strokeStyle = C.green;
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(e.x, e.y, e.r + 3, Math.random() * 6, Math.random() * 6 + 1.5);
          ctx.stroke();
        }
        if (e.hurtT > 0) {
          ctx.fillStyle = 'rgba(255,255,255,0.55)';
          ctx.beginPath();
          ctx.arc(e.x, e.y, e.r, 0, U.TAU);
          ctx.fill();
        }
        // Health pip for damaged non-boss enemies.
        if (!e.boss && e.hp < e.maxHp) {
          const w = e.r * 2;
          ctx.fillStyle = 'rgba(0,0,0,0.7)';
          ctx.fillRect(e.x - w / 2, e.y - e.r - 9, w, 3);
          ctx.fillStyle = e.elite ? C.gold : C.paper;
          ctx.fillRect(e.x - w / 2, e.y - e.r - 9, w * U.clamp(e.hp / e.maxHp, 0, 1), 3);
        }
      }
    }

    /**
     * Enemy bodies are cached sprites (drawn once per kind and size by the
     * _e_* painters), then rotated where the silhouette turns. Live parts —
     * the usher's shield, turret arms and tells — are drawn on top.
     */
    _drawEnemyBody(g, e) {
      const pad = e.r * 1.4 + 14;
      const spr = this._sprite('enemy|' + e.kind + '|' + e.r.toFixed(1), pad * 2, pad * 2, (c, w, h) => {
        const saveCtx = this.ctx;
        const saveT = this.t;
        this.ctx = c;
        this.t = 0;
        const fake = { x: w / 2, y: h / 2, r: e.r, def: e.def, facing: 0, aim: 0, state: 'idle', spinAngle: 0, frozenT: 1, noArms: true };
        try {
          this['_e_' + e.kind](fake);
        } finally {
          this.ctx = saveCtx;
          this.t = saveT;
        }
      });
      let rot = 0;
      if (e.kind === 'dealer') rot = e.facing;
      else if (e.kind === 'sniper') rot = e.state === 'aim' || e.state === 'lock' ? e.aim : e.facing || 0;
      else if (e.kind === 'ringcaster') rot = this.t * 1.5;
      if (rot) {
        this._captureBase();
        this._blitRot(spr, e.x, e.y, rot);
        this._restoreBase();
      } else this.ctx.drawImage(spr.img, e.x - spr.w / 2, e.y - spr.h / 2, spr.w, spr.h);
      const ctx = this.ctx;
      if (e.kind === 'usher' && e.frozenT <= 0) {
        ctx.strokeStyle = C.ink;
        ctx.lineWidth = 9;
        ctx.beginPath();
        ctx.arc(e.x, e.y, e.r + 7, e.facing - e.def.shieldArc, e.facing + e.def.shieldArc);
        ctx.stroke();
        ctx.strokeStyle = C.paper;
        ctx.lineWidth = 5;
        ctx.stroke();
      } else if (e.kind === 'turret') {
        ctx.strokeStyle = C.red;
        ctx.lineWidth = 3;
        ctx.beginPath();
        for (let k = 0; k < e.def.arms; k++) {
          const a = e.spinAngle + (k / e.def.arms) * U.TAU;
          ctx.moveTo(e.x + Math.cos(a) * e.r * 0.9, e.y + Math.sin(a) * e.r * 0.9);
          ctx.lineTo(e.x + Math.cos(a) * (e.r + 7), e.y + Math.sin(a) * (e.r + 7));
        }
        ctx.stroke();
        if (e.state === 'tell' || e.state === 'spin') {
          ctx.fillStyle = 'rgba(232,66,76,0.55)';
          ctx.fillRect(e.x - e.r * 0.86, e.y - e.r * 0.4 + ((this.t * 60) % (e.r * 0.8)), e.r * 1.72, 3);
        }
      }
    }

    _ink(fill, lw) {
      const ctx = this.ctx;
      ctx.fillStyle = fill;
      ctx.strokeStyle = C.ink;
      ctx.lineWidth = lw || 2.5;
      ctx.fill();
      ctx.stroke();
    }

    _e_rusher(e) {
      const ctx = this.ctx;
      const r = e.r;
      for (let k = 2; k >= 0; k--) {
        ctx.beginPath();
        ctx.ellipse(e.x, e.y + k * 3 - 3, r, r * 0.72, 0, 0, U.TAU);
        this._ink(k === 0 ? C.red : C.paper, 2);
      }
      ctx.strokeStyle = C.paper;
      ctx.lineWidth = 2;
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * U.TAU + this.t * 4;
        ctx.beginPath();
        ctx.moveTo(e.x + Math.cos(a) * r * 0.6, e.y - 3 + Math.sin(a) * r * 0.45);
        ctx.lineTo(e.x + Math.cos(a) * r * 0.92, e.y - 3 + Math.sin(a) * r * 0.68);
        ctx.stroke();
      }
    }

    _e_dealer(e) {
      const ctx = this.ctx;
      const r = e.r;
      ctx.beginPath();
      ctx.roundRect ? ctx.roundRect(e.x - r, e.y - r * 0.75, r * 2, r * 1.6, 4) : ctx.rect(e.x - r, e.y - r * 0.75, r * 2, r * 1.6);
      this._ink(C.paper);
      ctx.beginPath();
      ctx.moveTo(e.x - r * 0.4, e.y - r * 0.75);
      ctx.lineTo(e.x, e.y + r * 0.1);
      ctx.lineTo(e.x + r * 0.4, e.y - r * 0.75);
      this._ink(C.ink, 1);
      ctx.beginPath();
      ctx.arc(e.x, e.y - r * 0.85, r * 0.5, 0, U.TAU);
      this._ink(C.paper);
      ctx.fillStyle = C.red;
      ctx.fillRect(e.x - r * 0.5, e.y - r * 1.02, r, r * 0.22);
      // Card fan in hand.
      const a = e.facing;
      for (let k = -2; k <= 2; k++) {
        ctx.save();
        ctx.translate(e.x + Math.cos(a) * r, e.y + Math.sin(a) * r);
        ctx.rotate(a + k * 0.22 + Math.PI / 2);
        ctx.fillStyle = C.paper;
        ctx.strokeStyle = C.ink;
        ctx.lineWidth = 1;
        ctx.fillRect(-3, -9, 6, 9);
        ctx.strokeRect(-3, -9, 6, 9);
        ctx.restore();
      }
    }

    _e_ringcaster(e) {
      const ctx = this.ctx;
      const r = e.r;
      ctx.beginPath();
      ctx.arc(e.x, e.y, r, 0, U.TAU);
      this._ink(C.ink2);
      const n = 12;
      for (let k = 0; k < n; k++) {
        const a0 = (k / n) * U.TAU + this.t * 1.5;
        ctx.beginPath();
        ctx.arc(e.x, e.y, r - 3, a0, a0 + U.TAU / n);
        ctx.strokeStyle = k % 2 ? C.red : C.paper;
        ctx.lineWidth = 5;
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.arc(e.x, e.y, r * 0.38, 0, U.TAU);
      this._ink(C.paper, 2);
      ctx.fillStyle = C.ink;
      ctx.beginPath();
      ctx.arc(e.x, e.y, r * 0.16, 0, U.TAU);
      ctx.fill();
    }

    _e_sniper(e) {
      const ctx = this.ctx;
      const r = e.r;
      const a = e.state === 'aim' || e.state === 'lock' ? e.aim : e.facing || 0;
      ctx.save();
      ctx.translate(e.x, e.y);
      ctx.rotate(a);
      ctx.beginPath();
      ctx.moveTo(r * 1.5, 0);
      ctx.lineTo(0, r * 0.75);
      ctx.lineTo(-r, 0);
      ctx.lineTo(0, -r * 0.75);
      ctx.closePath();
      this._ink(C.paper);
      ctx.beginPath();
      ctx.arc(r * 0.2, 0, r * 0.3, 0, U.TAU);
      this._ink(C.red, 1.5);
      ctx.restore();
    }

    _e_usher(e) {
      const ctx = this.ctx;
      const r = e.r;
      ctx.beginPath();
      ctx.arc(e.x, e.y, r, 0, U.TAU);
      this._ink('#5b1f24');
      ctx.beginPath();
      ctx.arc(e.x, e.y, r * 0.45, 0, U.TAU);
      this._ink(C.paper, 2);
      if (e.frozenT <= 0) {
        ctx.strokeStyle = C.ink;
        ctx.lineWidth = 9;
        ctx.beginPath();
        ctx.arc(e.x, e.y, r + 7, e.facing - e.def.shieldArc, e.facing + e.def.shieldArc);
        ctx.stroke();
        ctx.strokeStyle = C.paper;
        ctx.lineWidth = 5;
        ctx.stroke();
        ctx.strokeStyle = C.red;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(e.x, e.y, r + 7, e.facing - e.def.shieldArc * 0.8, e.facing + e.def.shieldArc * 0.8);
        ctx.stroke();
      }
    }

    _e_turret(e) {
      const ctx = this.ctx;
      const r = e.r;
      ctx.beginPath();
      ctx.rect(e.x - r, e.y - r, r * 2, r * 2);
      this._ink(C.ink2);
      ctx.strokeStyle = C.paper;
      ctx.lineWidth = 2;
      ctx.strokeRect(e.x - r + 3, e.y - r + 3, r * 2 - 6, r * 2 - 6);
      const syms = ['seven', 'bell', 'skull'];
      for (let k = 0; k < 3; k++) {
        const x = e.x - r * 0.6 + k * r * 0.6;
        ctx.fillStyle = C.paper;
        ctx.fillRect(x - r * 0.26, e.y - r * 0.4, r * 0.52, r * 0.8);
        if (e.state === 'tell' || e.state === 'spin') {
          ctx.fillStyle = C.red;
          ctx.fillRect(x - r * 0.26, e.y - r * 0.4 + ((this.t * 60 + k * 7) % (r * 0.8)), r * 0.52, 3);
        } else HE.drawSymbol(ctx, syms[k], x, e.y, r * 0.5);
      }
      if (e.noArms) return;
      ctx.strokeStyle = C.red;
      ctx.lineWidth = 3;
      for (let k = 0; k < e.def.arms; k++) {
        const a = e.spinAngle + (k / e.def.arms) * U.TAU;
        ctx.beginPath();
        ctx.moveTo(e.x + Math.cos(a) * r * 0.9, e.y + Math.sin(a) * r * 0.9);
        ctx.lineTo(e.x + Math.cos(a) * (r + 7), e.y + Math.sin(a) * (r + 7));
        ctx.stroke();
      }
    }

    _drawBoss(g, e) {
      const ctx = this.ctx;
      const R = e.r * 1.55;
      const spin = this.t * (e.staggerT > 0 ? 0.3 : 1.2);
      ctx.beginPath();
      ctx.arc(e.x, e.y, R, 0, U.TAU);
      this._ink(C.ink2, 3);
      for (let i = 0; i < 37; i++) {
        const a0 = spin + (i / 37) * U.TAU;
        const a1 = spin + ((i + 1) / 37) * U.TAU;
        ctx.beginPath();
        ctx.arc(e.x, e.y, R - 7, a0, a1);
        ctx.strokeStyle = i === 0 ? C.green : i % 2 ? C.red : C.paper;
        ctx.lineWidth = 10;
        ctx.stroke();
      }
      ctx.strokeStyle = C.ink;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(e.x, e.y, R - 13, 0, U.TAU);
      ctx.stroke();
      // Lady Zero herself.
      ctx.beginPath();
      ctx.arc(e.x, e.y + 6, e.r * 0.55, 0, U.TAU);
      this._ink('#3a1015');
      ctx.beginPath();
      ctx.arc(e.x, e.y - e.r * 0.25, e.r * 0.33, 0, U.TAU);
      this._ink(C.paper);
      ctx.beginPath();
      ctx.ellipse(e.x, e.y - e.r * 0.5, e.r * 0.62, e.r * 0.14, 0, 0, U.TAU);
      this._ink(C.ink, 2);
      ctx.fillStyle = C.red;
      ctx.beginPath();
      ctx.arc(e.x + e.r * 0.1, e.y - e.r * 0.22, 2.5, 0, U.TAU);
      ctx.fill();
      if (e.transitionT > 0) {
        ctx.strokeStyle = 'rgba(239,233,220,0.6)';
        ctx.lineWidth = 3;
        ctx.setLineDash([8, 6]);
        ctx.beginPath();
        ctx.arc(e.x, e.y, R + 10, -this.t, -this.t + U.TAU);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      if (e.staggerT > 0) {
        ctx.fillStyle = C.ice;
        ctx.font = 'bold 18px "Big Shoulders Display", Impact, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('STAGGERED', e.x, e.y - R - 12);
      }
    }

    /**
     * Cached device-resolution sprite. `paint(c, w, h)` draws in world units
     * centered at (w/2, h/2); the canvas is k = scale × dpr pixels per unit.
     */
    _sprite(key, w, h, paint) {
      const k = this.scale * this.dpr;
      const cache = this._sprites || (this._sprites = new Map());
      const ck = key + '@' + k.toFixed(3);
      let s = cache.get(ck);
      if (!s) {
        const cv = document.createElement('canvas');
        cv.width = Math.max(1, Math.ceil(w * k));
        cv.height = Math.max(1, Math.ceil(h * k));
        const c = cv.getContext('2d');
        c.setTransform(k, 0, 0, k, 0, 0);
        paint(c, w, h);
        s = { img: cv, w, h };
        cache.set(ck, s);
        if (cache.size > 400) cache.clear();
      }
      return s;
    }

    /** Draws a sprite at arena (x, y) rotated by `a`, reusing the frame's base matrix. */
    _blitRot(s, x, y, a) {
      const m = this._base;
      const c = Math.cos(a) * m.k;
      const sn = Math.sin(a) * m.k;
      this.ctx.setTransform(c, sn, -sn, c, m.e + m.k * x, m.f + m.k * y);
      this.ctx.drawImage(s.img, -s.w / 2, -s.h / 2, s.w, s.h);
    }

    _captureBase() {
      const t = this.ctx.getTransform();
      this._base = { k: t.a, e: t.e, f: t.f };
    }

    _restoreBase() {
      const m = this._base;
      this.ctx.setTransform(m.k, 0, 0, m.k, m.e, m.f);
    }

    /**
     * Friendly shots are streaks, batched into one path per color and width
     * (the cheapest option measured for the CPU rasterizer).
     */
    _drawShots(g) {
      const ctx = this.ctx;
      const S = g.shots;
      const buckets = this._shotBuckets || (this._shotBuckets = new Map());
      for (const b of buckets.values()) b.n = 0;
      for (let i = 0; i < S.n; i++) {
        const s = S.items[i];
        const col = s.returning ? '#b9f7d0' : s.color;
        const wid = s.final ? 7 : s.r >= 5 ? 5 : s.r >= 4 ? 4 : 3;
        const key = col + wid;
        let b = buckets.get(key);
        if (!b) {
          b = { col, wid, n: 0, idx: [] };
          buckets.set(key, b);
        }
        b.idx[b.n++] = i;
      }
      ctx.lineCap = 'butt';
      for (const b of buckets.values()) {
        if (!b.n) continue;
        for (let pass = 0; pass < 2; pass++) {
          ctx.beginPath();
          for (let k = 0; k < b.n; k++) {
            const s = S.items[b.idx[k]];
            const sp = Math.hypot(s.vx, s.vy) || 1;
            const len = (s.kind === 'petal' ? 11 : s.final ? 26 : 18) * (pass ? 0.5 : 1);
            ctx.moveTo(s.x - (s.vx / sp) * len, s.y - (s.vy / sp) * len);
            ctx.lineTo(s.x, s.y);
          }
          ctx.strokeStyle = pass ? '#fffaf0' : b.col;
          ctx.lineWidth = pass ? Math.max(1.5, b.wid * 0.45) : b.wid;
          ctx.globalAlpha = pass ? 1 : 0.6;
          ctx.stroke();
        }
      }
      ctx.globalAlpha = 1;
    }

    _drawPlayer(g) {
      const ctx = this.ctx;
      const p = g.player;
      if (g.run.state === 'dying' && g.run.stateT < 1.0) return;
      // Orbitals and captured shots.
      const orbs = g.perks.orbitalPositions(this._orbs || (this._orbs = []));
      for (const o of orbs) {
        ctx.save();
        ctx.translate(o.x, o.y);
        ctx.rotate(this.t * 4);
        ctx.beginPath();
        if (o.extra) ctx.arc(0, 0, 5, 0, U.TAU);
        else {
          ctx.moveTo(0, -7);
          ctx.lineTo(5, 0);
          ctx.lineTo(0, 7);
          ctx.lineTo(-5, 0);
          ctx.closePath();
        }
        this._ink(o.extra ? C.gold : C.green, 1.5);
        ctx.restore();
      }
      const blink = p.iframes > 0 && p.dashT <= 0 && Math.floor(this.t * 30) % 2 === 0;
      ctx.globalAlpha = blink ? 0.5 : 1;
      if (g.spins.jackpotT > 0) {
        ctx.fillStyle = 'rgba(242,193,78,' + (0.18 + 0.08 * Math.sin(this.t * 10)) + ')';
        ctx.beginPath();
        ctx.arc(p.x, p.y, 34, 0, U.TAU);
        ctx.fill();
      }
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.beginPath();
      ctx.ellipse(p.x + 3, p.y + 12, 13, 6, 0, 0, U.TAU);
      ctx.fill();
      // Revolver arm.
      const a = p.aim;
      const rec = p.recoil * 4;
      ctx.lineCap = 'round';
      ctx.strokeStyle = C.ink;
      ctx.lineWidth = 7;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x + Math.cos(a) * (22 - rec), p.y + Math.sin(a) * (22 - rec));
      ctx.stroke();
      ctx.strokeStyle = g.spins.jackpotT > 0 ? C.gold : '#a8a293';
      ctx.lineWidth = 3.5;
      ctx.stroke();
      if (g.weapon.flash > 0) {
        ctx.fillStyle = C.gold;
        ctx.beginPath();
        ctx.arc(p.x + Math.cos(a) * 26, p.y + Math.sin(a) * 26, 6 + Math.random() * 3, 0, U.TAU);
        ctx.fill();
      }
      // Coat.
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.body - 1, 0, U.TAU);
      this._ink(p.hurtFlash > 0 ? C.red : C.paper, 2.5);
      ctx.strokeStyle = C.ink;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(p.x - 5, p.y + 3);
      ctx.lineTo(p.x, p.y + 11);
      ctx.lineTo(p.x + 5, p.y + 3);
      ctx.stroke();
      // Hat.
      ctx.beginPath();
      ctx.ellipse(p.x, p.y - 2, 12, 9, a, 0, U.TAU);
      this._ink(C.ink2, 2);
      ctx.beginPath();
      ctx.arc(p.x, p.y - 2, 6, 0, U.TAU);
      this._ink('#26262b', 1.5);
      ctx.fillStyle = C.red;
      ctx.fillRect(p.x - 6, p.y - 3, 12, 2);
      ctx.globalAlpha = 1;
      if (p.shield > 0) {
        ctx.strokeStyle = C.ice;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 22, 0, U.TAU);
        ctx.stroke();
      }
      if (g.input.precision || g.settings.alwaysShowHitbox) {
        ctx.fillStyle = C.red;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r + 2.5, 0, U.TAU);
        ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, U.TAU);
        ctx.fill();
        ctx.strokeStyle = 'rgba(239,233,220,0.25)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r + D.TUNING.player.grazeRadius, 0, U.TAU);
        ctx.stroke();
      }
      // Crosshair.
      const ax = p.aimX;
      const ay = p.aimY;
      ctx.strokeStyle = g.spins.crownT > 0 ? C.gold : 'rgba(239,233,220,0.85)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(ax, ay, 9, 0, U.TAU);
      ctx.moveTo(ax - 14, ay);
      ctx.lineTo(ax - 5, ay);
      ctx.moveTo(ax + 5, ay);
      ctx.lineTo(ax + 14, ay);
      ctx.moveTo(ax, ay - 14);
      ctx.lineTo(ax, ay - 5);
      ctx.moveTo(ax, ay + 5);
      ctx.lineTo(ax, ay + 14);
      ctx.stroke();
    }

    _drawFx(g) {
      const ctx = this.ctx;
      const fx = g.fx;
      ctx.globalCompositeOperation = 'lighter';
      const P = fx.particles;
      for (let i = 0; i < P.n; i++) {
        const p = P.items[i];
        ctx.globalAlpha = U.clamp(p.life / p.max, 0, 1);
        ctx.fillStyle = p.color;
        const s = p.size;
        ctx.fillRect(p.x - s / 2, p.y - s / 2, s, s);
      }
      const R = fx.rings;
      for (let i = 0; i < R.n; i++) {
        const r = R.items[i];
        const t = 1 - r.life / r.max;
        ctx.globalAlpha = 1 - t;
        ctx.strokeStyle = r.color;
        ctx.lineWidth = r.width;
        ctx.beginPath();
        ctx.arc(r.x, r.y, U.lerp(r.r0, r.r1, U.easeOutCubic(t)), 0, U.TAU);
        ctx.stroke();
      }
      const L = fx.lines;
      ctx.lineCap = 'round';
      for (let i = 0; i < L.n; i++) {
        const l = L.items[i];
        ctx.globalAlpha = U.clamp(l.life / l.max, 0, 1);
        ctx.strokeStyle = l.color;
        ctx.lineWidth = l.width;
        ctx.beginPath();
        ctx.moveTo(l.x1, l.y1);
        if (l.jag) {
          const n = 6;
          const dx = l.x2 - l.x1;
          const dy = l.y2 - l.y1;
          const len = Math.hypot(dx, dy) || 1;
          const nx = -dy / len;
          const ny = dx / len;
          for (let k = 1; k < n; k++) {
            const j = (Math.random() - 0.5) * Math.min(26, len * 0.2);
            ctx.lineTo(l.x1 + (dx * k) / n + nx * j, l.y1 + (dy * k) / n + ny * j);
          }
        }
        ctx.lineTo(l.x2, l.y2);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }

    _drawBullets(g) {
      const ctx = this.ctx;
      const B = g.bullets;
      this._captureBase();
      const orb = (r) =>
        this._sprite('orb|' + r, r * 2 + 8, r * 2 + 8, (c, w, h) => {
          c.fillStyle = C.ink;
          c.beginPath();
          c.arc(w / 2, h / 2, r + 3, 0, U.TAU);
          c.fill();
          c.fillStyle = C.red;
          c.beginPath();
          c.arc(w / 2, h / 2, r + 1.5, 0, U.TAU);
          c.fill();
          c.fillStyle = '#fff';
          c.beginPath();
          c.arc(w / 2, h / 2, r - 1.5, 0, U.TAU);
          c.fill();
        });
      for (let i = 0; i < B.n; i++) {
        const b = B.items[i];
        if (b.shape === 'orb') {
          const s = orb(b.r);
          ctx.drawImage(s.img, b.x - s.w / 2, b.y - s.h / 2, s.w, s.h);
          continue;
        }
        const a = Math.atan2(b.vy, b.vx);
        if (b.shape === 'card') {
          const r = b.r;
          const s = this._sprite('card|' + r, r * 2.9 + 6, r * 2 + 6, (c, w, h) => {
            c.translate(w / 2, h / 2);
            c.fillStyle = C.ink;
            c.fillRect(-r * 1.45 - 2, -r - 2, r * 2.9 + 4, r * 2 + 4);
            c.fillStyle = C.red;
            c.fillRect(-r * 1.45, -r, r * 2.9, r * 2);
            c.fillStyle = '#fff';
            c.fillRect(-r * 1.45 + 2, -r + 2, r * 2.9 - 4, r * 2 - 4);
            c.fillStyle = C.red;
            c.beginPath();
            c.moveTo(-3.5, 0);
            c.lineTo(0, 3);
            c.lineTo(3.5, 0);
            c.lineTo(0, -3);
            c.fill();
          });
          this._blitRot(s, b.x, b.y, a);
        } else if (b.shape === 'diamond') {
          const r = b.r + 2;
          const s = this._sprite('diamond|' + r, r * 2 + 10, r * 1.6 + 8, (c, w, h) => {
            c.translate(w / 2, h / 2);
            c.beginPath();
            c.moveTo(r + 3, 0);
            c.lineTo(0, r * 0.8 + 2);
            c.lineTo(-r - 3, 0);
            c.lineTo(0, -r * 0.8 - 2);
            c.closePath();
            c.fillStyle = C.ink;
            c.fill();
            c.beginPath();
            c.moveTo(r, 0);
            c.lineTo(0, r * 0.8);
            c.lineTo(-r, 0);
            c.lineTo(0, -r * 0.8);
            c.closePath();
            c.fillStyle = '#fff';
            c.fill();
            c.strokeStyle = C.red;
            c.lineWidth = 2;
            c.stroke();
          });
          this._blitRot(s, b.x, b.y, a);
        } else if (b.shape === 'needle') {
          const r = b.r;
          const s = this._sprite('needle|' + r, 24 + r * 2 + 4, r * 2 + 6, (c, w, h) => {
            c.lineCap = 'round';
            const y = h / 2;
            const x0 = r + 3;
            const x1 = w - r - 3;
            for (const [col, lw] of [
              [C.ink, r * 2 + 4],
              [C.red, r * 2],
              ['#fff', r],
            ]) {
              c.strokeStyle = col;
              c.lineWidth = lw;
              c.beginPath();
              c.moveTo(x0, y);
              c.lineTo(x1, y);
              c.stroke();
            }
          });
          this._blitRot(s, b.x - Math.cos(a) * (s.w / 2 - r - 3), b.y - Math.sin(a) * (s.w / 2 - r - 3), a);
        } else if (b.shape === 'ball') {
          this._restoreBase();
          ctx.beginPath();
          ctx.arc(b.x, b.y, b.r + 3, 0, U.TAU);
          ctx.fillStyle = C.ink;
          ctx.fill();
          ctx.beginPath();
          ctx.arc(b.x, b.y, b.r, 0, U.TAU);
          ctx.fillStyle = '#fff';
          ctx.fill();
          ctx.strokeStyle = C.red;
          ctx.lineWidth = 3;
          ctx.stroke();
          ctx.fillStyle = 'rgba(0,0,0,0.18)';
          ctx.beginPath();
          ctx.arc(b.x + 4, b.y + 4, b.r * 0.7, 0, U.TAU);
          ctx.fill();
          continue;
        }
        this._restoreBase();
      }
      this._restoreBase();
    }

    _drawTexts(g) {
      const ctx = this.ctx;
      const T = g.fx.texts;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (let i = 0; i < T.n; i++) {
        const t = T.items[i];
        ctx.globalAlpha = U.clamp(t.life / t.max, 0, 1) * 1.4;
        ctx.font = '700 ' + t.size + 'px "Big Shoulders Display", Impact, sans-serif';
        ctx.lineWidth = 3;
        ctx.strokeStyle = C.ink;
        ctx.strokeText(t.text, t.x, t.y);
        ctx.fillStyle = t.color;
        ctx.fillText(t.text, t.x, t.y);
      }
      ctx.globalAlpha = 1;
    }

    /* ======================================================= banners */

    _drawBanners(g) {
      const ctx = this.ctx;
      const run = g.run;
      const floor = D.floors[run.floorIndex];
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      if (run.state === 'intro') {
        const k = U.clamp(run.stateT / 0.3, 0, 1);
        ctx.globalAlpha = k;
        ctx.fillStyle = 'rgba(13,13,15,0.72)';
        ctx.fillRect(A.x, A.y + A.h / 2 - 62, A.w, 124);
        ctx.fillStyle = C.paper;
        ctx.font = '800 58px "Big Shoulders Stencil Display", Impact, sans-serif';
        const rt = D.roomTypes[run.room.type];
        const title = run.room.type === 'boss' ? D.bossById[floor.boss].name.toUpperCase() : rt.name.toUpperCase();
        ctx.fillText(title, A.x + A.w / 2, A.y + A.h / 2 - 12);
        ctx.font = '600 18px "Barlow", sans-serif';
        ctx.fillStyle = run.room.type === 'boss' ? C.red : C.dim;
        const sub = floor.name.toUpperCase() + '  ·  ROOM ' + (run.slotIndex + 1) + ' / ' + floor.slots.length + (run.room.type === 'boss' ? '  ·  ' + D.bossById[floor.boss].title.toUpperCase() : '');
        ctx.fillText(sub, A.x + A.w / 2, A.y + A.h / 2 + 32);
        ctx.globalAlpha = 1;
      } else if (run.state === 'clear') {
        ctx.fillStyle = 'rgba(13,13,15,0.6)';
        ctx.fillRect(A.x, A.y + A.h / 2 - 40, A.w, 80);
        ctx.fillStyle = C.green;
        ctx.font = '800 46px "Big Shoulders Stencil Display", Impact, sans-serif';
        ctx.fillText(run.room.type === 'boss' ? 'TABLE CLOSED' : 'ROOM CLEARED', A.x + A.w / 2, A.y + A.h / 2);
      } else if (run.state === 'dying') {
        ctx.fillStyle = 'rgba(13,13,15,0.5)';
        ctx.fillRect(A.x, A.y + A.h / 2 - 40, A.w, 80);
        ctx.fillStyle = C.red;
        ctx.font = '800 50px "Big Shoulders Stencil Display", Impact, sans-serif';
        ctx.fillText('THE HOUSE WINS', A.x + A.w / 2, A.y + A.h / 2);
      }
      // Tutorial prompt: top of the arena, out of the central lane.
      if (g.tutorial && run.state === 'combat' && g.tutorial.current) {
        const s = g.tutorial.current;
        const txt = s.text;
        ctx.font = '600 17px "Barlow", sans-serif';
        const w = Math.min(A.w - 40, ctx.measureText(txt).width + 60);
        const x = A.x + A.w / 2;
        const y = A.y + 26;
        ctx.fillStyle = 'rgba(13,13,15,0.86)';
        ctx.fillRect(x - w / 2, y - 17, w, 34);
        ctx.strokeStyle = C.gold;
        ctx.lineWidth = 1.5;
        ctx.strokeRect(x - w / 2, y - 17, w, 34);
        ctx.fillStyle = C.paper;
        ctx.fillText(txt, x, y + 1);
        const idx = g.tutorial.step + 1;
        ctx.font = '600 11px "IBM Plex Mono", monospace';
        ctx.fillStyle = C.dim;
        ctx.fillText('ENTRANCE ' + idx + '/' + D.tutorialSteps.length + '   ·   [K] SKIP TUTORIAL', x, y + 30);
      }
      if (g.run.debug) {
        ctx.fillStyle = C.red;
        ctx.font = '700 12px "IBM Plex Mono", monospace';
        ctx.textAlign = 'left';
        ctx.fillText('DEBUG RUN — progression disabled', A.x + 8, A.y + A.h - 10);
      }
    }

    /* =========================================================== HUD */

    _drawHUD(g) {
      const ctx = this.ctx;
      const p = g.player;
      const run = g.run;
      const floor = D.floors[run.floorIndex];
      ctx.textBaseline = 'middle';
      // --- top-left: health, shield, dash.
      const hx = 40;
      ctx.textAlign = 'left';
      ctx.font = '700 12px "IBM Plex Mono", monospace';
      ctx.fillStyle = C.dim;
      ctx.fillText('HEALTH', hx, 14);
      const hw = 250;
      ctx.fillStyle = '#1b1b1f';
      ctx.fillRect(hx, 22, hw, 14);
      const hpk = U.clamp(p.hp / p.maxHp, 0, 1);
      ctx.fillStyle = hpk < 0.3 ? C.red : C.paper;
      ctx.fillRect(hx, 22, hw * hpk, 14);
      ctx.strokeStyle = C.paper;
      ctx.lineWidth = 1;
      ctx.strokeRect(hx - 0.5, 21.5, hw + 1, 15);
      ctx.font = '700 15px "Big Shoulders Display", Impact, sans-serif';
      ctx.fillStyle = C.paper;
      ctx.fillText(Math.ceil(p.hp) + ' / ' + p.maxHp, hx + hw + 10, 29);
      for (let i = 0; i < p.shield; i++) {
        ctx.strokeStyle = C.ice;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(hx + hw + 78 + i * 16, 29, 6, 0, U.TAU);
        ctx.stroke();
      }
      ctx.font = '700 12px "IBM Plex Mono", monospace';
      ctx.fillStyle = C.dim;
      ctx.fillText('DASH', hx, 52);
      for (let i = 0; i < p.dashMax; i++) {
        const x = hx + 52 + i * 22;
        ctx.strokeStyle = C.paper;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(x, 52, 7, 0, U.TAU);
        ctx.stroke();
        if (i < p.dashCharges) {
          ctx.fillStyle = C.paper;
          ctx.beginPath();
          ctx.arc(x, 52, 5, 0, U.TAU);
          ctx.fill();
        } else if (i === p.dashCharges) {
          ctx.strokeStyle = C.gold;
          ctx.beginPath();
          ctx.arc(x, 52, 4, -Math.PI / 2, -Math.PI / 2 + U.TAU * (p.dashRecharge / D.TUNING.player.dashRecharge));
          ctx.stroke();
        }
      }
      // Wager panel.
      const rec = run.room && run.room.wager;
      if (rec) {
        const def = D.wagerById[rec.defId];
        const wx = hx + 120;
        ctx.fillStyle = rec.settled ? (rec.status === 'won' ? 'rgba(53,227,138,0.15)' : 'rgba(232,66,76,0.15)') : 'rgba(242,193,78,0.1)';
        ctx.fillRect(wx, 42, 330, 20);
        ctx.strokeStyle = rec.settled ? (rec.status === 'won' ? C.green : C.red) : C.gold;
        ctx.strokeRect(wx + 0.5, 42.5, 329, 19);
        ctx.font = '600 12px "Barlow", sans-serif';
        ctx.fillStyle = C.paper;
        let txt = 'WAGER ' + rec.stake + ' → ' + rec.payout + ' · ' + def.objective;
        if (def.target) txt += ' ' + rec.progress + '/' + def.target;
        if (def.timeLimit && !rec.settled) txt += ' ' + Math.max(0, Math.ceil(def.timeLimit - (run.time - run.room.startTime))) + 's';
        if (rec.settled) txt = (rec.status === 'won' ? 'WAGER WON  +' + rec.payout : 'WAGER LOST  −' + rec.stake) + ' · ' + def.name;
        ctx.fillText(txt, wx + 8, 52.5);
      }
      // --- top-center: room progress or boss bar.
      ctx.textAlign = 'center';
      const cx = VW / 2;
      if (g.boss && !g.boss.dead && run.room.type === 'boss') {
        const b = g.boss;
        const bw = 440;
        ctx.font = '800 16px "Big Shoulders Stencil Display", Impact, sans-serif';
        ctx.fillStyle = C.red;
        ctx.fillText(b.bossDef.name.toUpperCase() + ' — ' + b.bossDef.title.toUpperCase() + '  ·  PHASE ' + (b.phase + 1) + '/' + b.bossDef.phases.length, cx, 13);
        ctx.fillStyle = '#1b1b1f';
        ctx.fillRect(cx - bw / 2, 24, bw, 12);
        ctx.fillStyle = C.red;
        ctx.fillRect(cx - bw / 2, 24, bw * U.clamp(b.hp / b.maxHp, 0, 1), 12);
        ctx.strokeStyle = C.paper;
        ctx.strokeRect(cx - bw / 2 - 0.5, 23.5, bw + 1, 13);
        for (let i = 1; i < b.bossDef.phases.length; i++) {
          const x = cx - bw / 2 + bw * b.bossDef.phases[i].at;
          ctx.fillStyle = C.paper;
          ctx.fillRect(x - 1, 21, 2, 18);
        }
        ctx.fillStyle = '#1b1b1f';
        ctx.fillRect(cx - bw / 2, 42, bw, 5);
        ctx.fillStyle = b.staggerImmune > 0 ? C.dim : C.ice;
        ctx.fillRect(cx - bw / 2, 42, bw * (b.staggerT > 0 ? 1 : U.clamp(b.stagger / 100, 0, 1)), 5);
        ctx.font = '600 10px "IBM Plex Mono", monospace';
        ctx.fillStyle = C.dim;
        ctx.fillText(b.staggerImmune > 0 && b.staggerT <= 0 ? 'STAGGER IMMUNE' : 'STAGGER', cx, 56);
      } else {
        ctx.font = '800 17px "Big Shoulders Stencil Display", Impact, sans-serif';
        ctx.fillStyle = C.paper;
        ctx.fillText(floor.name.toUpperCase() + '  ·  ROOM ' + (run.slotIndex + 1) + ' / ' + floor.slots.length, cx, 16);
        ctx.font = '600 12px "Barlow", sans-serif';
        ctx.fillStyle = C.dim;
        const rt = D.roomTypes[run.room.type];
        ctx.fillText(rt.name + (g.tutorial ? ' — guided' : ''), cx, 34);
        if (g.director) {
          const pr = g.director.progress();
          for (let i = 0; i < pr.total; i++) {
            ctx.fillStyle = i < pr.wave ? C.paper : '#2a2a2e';
            ctx.fillRect(cx - pr.total * 11 + i * 22 + 2, 46, 18, 5);
          }
        }
      }
      // --- top-right: loose chips, multiplier, heat.
      ctx.textAlign = 'right';
      const rx = VW - 40;
      ctx.font = '800 28px "Big Shoulders Display", Impact, sans-serif';
      ctx.fillStyle = C.green;
      ctx.fillText(HE.fmt.chips(run.wallet.loose), rx, 20);
      const tw = ctx.measureText(HE.fmt.chips(run.wallet.loose)).width;
      ctx.fillStyle = C.green;
      ctx.strokeStyle = C.ink;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(rx - tw - 14, 20, 8, 0, U.TAU);
      ctx.fill();
      ctx.stroke();
      ctx.strokeStyle = C.paper;
      ctx.beginPath();
      ctx.arc(rx - tw - 14, 20, 4, 0, U.TAU);
      ctx.stroke();
      ctx.font = '600 12px "IBM Plex Mono", monospace';
      ctx.fillStyle = C.dim;
      let sub = 'LOOSE CHIPS';
      if (run.wallet.escrow > 0) sub += ' · ' + run.wallet.escrow + ' STAKED';
      ctx.fillText(sub, rx, 39);
      if (run.wallet.multiplier > 1 || run.wallet.heat > 0) {
        ctx.fillStyle = C.gold;
        ctx.fillText('×' + run.wallet.multiplier.toFixed(2) + ' CARRIED' + (run.wallet.heat ? ' · HEAT ' + run.wallet.heat : ''), rx, 52);
      }
      this._drawReels(g);
      this._drawBottom(g);
    }

    _drawReels(g) {
      const ctx = this.ctx;
      const sm = g.slots;
      const sp = g.spins;
      const cx = VW / 2;
      const top = A.y + A.h + 8;
      const W = 222;
      const H = 62;
      const unl = g.unlocks();
      const trim = unl.includes('gold_cabinet') ? C.gold : unl.includes('neon_cabinet') ? C.green : C.paper;
      ctx.fillStyle = C.ink2;
      ctx.fillRect(cx - W / 2, top, W, H);
      ctx.strokeStyle = trim;
      ctx.lineWidth = 2;
      ctx.strokeRect(cx - W / 2, top, W, H);
      const pending = sp.pending;
      const stopAt = [0.36, 0.48, 0.6];
      const elapsed = D.TUNING.slots.animTime - sp.animT;
      for (let r = 0; r < 3; r++) {
        const x = cx - 66 + r * 66;
        const y = top + 25;
        ctx.fillStyle = '#e9e3d4';
        ctx.fillRect(x - 28, y - 21, 56, 42);
        let sym = sm.last ? sm.last[r] : null;
        let blur = false;
        if (pending && elapsed < stopAt[r]) {
          blur = true;
          sym = D.symbolIds[Math.floor(this.t * 22 + r * 2) % 6];
        } else if (pending) sym = pending.symbols[r];
        if (sym) {
          ctx.save();
          ctx.beginPath();
          ctx.rect(x - 28, y - 21, 56, 42);
          ctx.clip();
          if (blur) {
            ctx.globalAlpha = 0.5;
            HE.drawSymbol(ctx, sym, x, y - 10 + ((this.t * 400) % 20), 30);
            ctx.globalAlpha = 1;
          } else HE.drawSymbol(ctx, sym, x, y, 32);
          ctx.restore();
        }
        if (sm.holds[r]) {
          ctx.strokeStyle = C.gold;
          ctx.lineWidth = 3;
          ctx.strokeRect(x - 29, y - 22, 58, 44);
          ctx.fillStyle = C.gold;
          ctx.font = '700 10px "IBM Plex Mono", monospace';
          ctx.textAlign = 'center';
          ctx.fillText('HELD', x, y + 30);
        }
      }
      // Charge bar.
      const cost = sm.cost();
      const k = U.clamp(sm.charge / cost, 0, 1);
      ctx.fillStyle = '#26262b';
      ctx.fillRect(cx - W / 2 + 6, top + H - 8, W - 12, 4);
      ctx.fillStyle = sm.canSpin() ? C.gold : C.paper;
      ctx.fillRect(cx - W / 2 + 6, top + H - 8, (W - 12) * k, 4);
      if (sm.charge > cost) {
        ctx.fillStyle = C.green;
        ctx.fillRect(cx - W / 2 + 6, top + H - 8, (W - 12) * U.clamp((sm.charge - cost) / cost, 0, 1), 2);
      }
      // Left of cabinet: spin prompt, cost, odds.
      ctx.textAlign = 'right';
      const lx = cx - W / 2 - 14;
      const ready = sm.canSpin() && !pending;
      ctx.font = '800 20px "Big Shoulders Stencil Display", Impact, sans-serif';
      ctx.fillStyle = ready ? C.gold : C.dim;
      const key = HE.InputInfo ? HE.InputInfo.keyLabel(g.save.bindings.spin) : 'Q';
      ctx.fillText(ready ? 'SPIN READY [' + key + ']' : 'SPIN [' + key + ']', lx, top + 14);
      ctx.font = '600 12px "IBM Plex Mono", monospace';
      ctx.fillStyle = C.paper;
      ctx.fillText(Math.floor(sm.charge) + ' / ' + cost + ' charge' + (sm.holdCount() ? ' (hold +' + (cost - sm.baseCost) + ')' : ''), lx, top + 34);
      const odds = sm.odds();
      ctx.fillStyle = C.dim;
      ctx.fillText('777: ' + HE.fmt.odds(odds.jackpot) + ' (' + HE.fmt.pct(odds.jackpot, 2) + ')', lx, top + 50);
      // Right of cabinet: active windows.
      ctx.textAlign = 'left';
      const rx = cx + W / 2 + 14;
      let row = 0;
      const line = (label, t, max, col) => {
        const y = top + 12 + row * 16;
        ctx.font = '700 12px "IBM Plex Mono", monospace';
        ctx.fillStyle = col;
        ctx.fillText(label, rx, y);
        ctx.fillStyle = '#26262b';
        ctx.fillRect(rx + 104, y - 3, 90, 6);
        ctx.fillStyle = col;
        ctx.fillRect(rx + 104, y - 3, 90 * U.clamp(t / max, 0, 1), 6);
        row++;
      };
      if (sp.jackpotT > 0) line('JACKPOT ' + sp.jackpotT.toFixed(1), sp.jackpotT, D.TUNING.slots.jackpotDuration, C.gold);
      else if (sp.jackpotCooldown > 0) line('777 COOLDOWN', sp.jackpotCooldown, D.TUNING.slots.jackpotCooldown, C.dim);
      if (sp.crownT > 0) line('CROWN ×' + sp.crownMult.toFixed(1), sp.crownT, 6, C.gold);
      if (sp.overdriveT > 0) line('OVERDRIVE ×' + sp.overdriveMult.toFixed(1), sp.overdriveT, 5, '#ff5a3d');
      if (sp.domeT > 0) line('BELL DOME', sp.domeT, 3, C.ice);
      if (pending && pending.demo) {
        ctx.fillStyle = C.gold;
        ctx.font = '700 12px "IBM Plex Mono", monospace';
        ctx.fillText('TUTORIAL DEMO — fixed result', rx, top + 12 + row * 16);
      } else if (sp.lastResult && sp.lastResult.demo && !pending && row === 0) {
        ctx.fillStyle = C.dim;
        ctx.font = '600 11px "IBM Plex Mono", monospace';
        ctx.fillText('last spin: tutorial demo (fixed)', rx, top + 12);
      }
    }

    _drawBottom(g) {
      const ctx = this.ctx;
      const top = A.y + A.h + 8;
      // Left: build summary.
      ctx.textAlign = 'left';
      ctx.font = '700 11px "IBM Plex Mono", monospace';
      ctx.fillStyle = C.dim;
      const tabKey = HE.InputInfo ? HE.InputInfo.keyLabel(g.save.bindings.ledger) : 'Tab';
      ctx.fillText('BUILD [' + tabKey + ']', 40, top + 10);
      let x = 40;
      const owned = g.perks.ownedIds();
      ctx.font = '700 13px "Big Shoulders Display", Impact, sans-serif';
      for (const id of owned) {
        const def = D.perkById[id];
        const label = def.name.toUpperCase();
        const w = ctx.measureText(label).width + 22;
        if (x + w > 480) break;
        ctx.strokeStyle = C.paper;
        ctx.lineWidth = 1;
        ctx.strokeRect(x + 0.5, top + 20.5, w, 20);
        ctx.fillStyle = C.paper;
        ctx.fillText(label, x + 6, top + 31);
        for (let r = 0; r < g.perks.rank(id); r++) {
          ctx.fillStyle = C.gold;
          ctx.fillRect(x + w - 10, top + 24 + r * 5, 5, 3);
        }
        x += w + 6;
      }
      if (!owned.length) {
        ctx.fillStyle = '#4a4a50';
        ctx.fillText('NO PERKS YET', 40, top + 31);
      }
      const rc = g.perks.recipes.size;
      ctx.font = '700 11px "IBM Plex Mono", monospace';
      ctx.fillStyle = rc ? C.green : '#4a4a50';
      ctx.fillText(rc + ' RECIPE' + (rc === 1 ? '' : 'S') + ' ACTIVE', 40, top + 54);
      // Right: revolver cylinder.
      const w = g.weapon;
      const cx = VW - 70;
      const cy = top + 30;
      const mag = g.weaponDef.params.magazine;
      ctx.strokeStyle = g.spins.jackpotT > 0 ? C.gold : C.paper;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(cx, cy, 24, 0, U.TAU);
      ctx.stroke();
      const rot = w.reloading ? this.t * 12 : 0;
      for (let i = 0; i < mag; i++) {
        const a = -Math.PI / 2 + (i / mag) * U.TAU + rot;
        const loaded = g.spins.jackpotT > 0 || (!w.reloading && i < w.mag);
        ctx.beginPath();
        ctx.arc(cx + Math.cos(a) * 14, cy + Math.sin(a) * 14, 5.5, 0, U.TAU);
        ctx.fillStyle = loaded ? (i === 0 && w.mag === 1 && g.spins.jackpotT <= 0 ? C.red : g.spins.jackpotT > 0 ? C.gold : C.paper) : '#26262b';
        ctx.fill();
      }
      ctx.textAlign = 'right';
      ctx.font = '700 12px "IBM Plex Mono", monospace';
      ctx.fillStyle = w.reloading ? C.gold : C.dim;
      ctx.fillText(g.spins.jackpotT > 0 ? 'GOLDEN ACE' : w.reloading ? 'RELOADING' : w.mag === 1 ? 'HEAVY ROUND' : 'RUSTED ACE', cx - 34, cy);
    }

    /* ========================================================= lobby */

    /** The hub: a casino lobby that visibly repairs as you invest. */
    _drawLobby(g) {
      const ctx = this.ctx;
      const lvl = g.slotAlleyLevel();
      const unl = g.unlocks();
      ctx.fillStyle = '#0b0b0d';
      ctx.fillRect(0, 0, VW, VH);
      // Back wall hatch.
      ctx.strokeStyle = 'rgba(239,233,220,0.03)';
      ctx.lineWidth = 1;
      for (let i = -VH; i < VW; i += 10) {
        ctx.beginPath();
        ctx.moveTo(i, 0);
        ctx.lineTo(i + VH, VH);
        ctx.stroke();
      }
      // Sign.
      const flick = lvl > 0 ? 1 : Math.sin(this.t * 17) > 0.6 ? 0.25 : 0.08;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = '900 76px "Big Shoulders Stencil Display", Impact, sans-serif';
      ctx.fillStyle = 'rgba(232,66,76,' + 0.9 * flick + ')';
      ctx.fillText('HOUSE EDGE', 330, 96);
      ctx.font = '600 15px "Barlow", sans-serif';
      ctx.fillStyle = C.dim;
      ctx.fillText('Dodge the odds. Rig the reels. Break the bank.', 330, 142);
      // Slot Alley: ten cabinets, lit by level.
      const baseY = 520;
      ctx.textAlign = 'left';
      ctx.font = '700 12px "IBM Plex Mono", monospace';
      ctx.fillStyle = C.dim;
      ctx.fillText('SLOT ALLEY — ' + (lvl ? 'LEVEL ' + lvl : 'CONDEMNED'), 40, baseY - 170);
      for (let i = 0; i < 10; i++) {
        const x = 50 + i * 58;
        const lit = i < lvl;
        const trim = unl.includes('gold_cabinet') ? C.gold : unl.includes('neon_cabinet') ? C.green : C.paper;
        ctx.fillStyle = lit ? '#1f1f24' : '#141416';
        ctx.fillRect(x, baseY - 150, 46, 150);
        ctx.strokeStyle = lit ? trim : '#2c2c31';
        ctx.lineWidth = 2;
        ctx.strokeRect(x, baseY - 150, 46, 150);
        ctx.fillStyle = lit ? '#e9e3d4' : '#222226';
        ctx.fillRect(x + 6, baseY - 118, 34, 26);
        if (lit) {
          const s = D.symbolIds[(i + Math.floor(this.t * 0.7 + i * 0.37)) % 6];
          HE.drawSymbol(ctx, s, x + 23, baseY - 105, 20);
          ctx.fillStyle = 'rgba(242,193,78,' + (0.25 + 0.2 * Math.sin(this.t * 3 + i)) + ')';
          ctx.fillRect(x + 4, baseY - 146, 38, 8);
        } else {
          ctx.strokeStyle = '#3a3a40';
          ctx.beginPath();
          ctx.moveTo(x + 8, baseY - 116);
          ctx.lineTo(x + 38, baseY - 94);
          ctx.moveTo(x + 38, baseY - 116);
          ctx.lineTo(x + 20, baseY - 100);
          ctx.stroke();
        }
        ctx.fillStyle = lit ? C.red : '#2a1416';
        ctx.beginPath();
        ctx.arc(x + 44, baseY - 128, 4, 0, U.TAU);
        ctx.fill();
      }
      // Floor.
      ctx.fillStyle = '#101012';
      ctx.fillRect(0, baseY, VW, VH - baseY);
      ctx.strokeStyle = 'rgba(232,66,76,0.12)';
      ctx.lineWidth = 10;
      ctx.beginPath();
      ctx.moveTo(0, baseY + 30);
      ctx.lineTo(VW, baseY + 30);
      ctx.stroke();
      // Tables: House Tab and Loaded Chambers stacks.
      const up = g.save.upgrades;
      [
        ['HOUSE TAB', up.vitality || 0],
        ['LOADED CHAMBERS', up.caliber || 0],
      ].forEach(([name, rank], i) => {
        const x = 110 + i * 260;
        const y = baseY + 120;
        ctx.fillStyle = rank ? '#123322' : '#141416';
        ctx.strokeStyle = rank ? C.green : '#2c2c31';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.ellipse(x + 60, y, 90, 36, 0, 0, U.TAU);
        ctx.fill();
        ctx.stroke();
        for (let k = 0; k < rank; k++) {
          ctx.fillStyle = k % 2 ? C.red : C.paper;
          ctx.strokeStyle = C.ink;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.ellipse(x + 40 + k * 10, y - k * 4, 10, 5, 0, 0, U.TAU);
          ctx.fill();
          ctx.stroke();
        }
        ctx.fillStyle = rank ? C.paper : '#3a3a40';
        ctx.font = '700 12px "IBM Plex Mono", monospace';
        ctx.textAlign = 'center';
        ctx.fillText(name + ' ' + rank + '/5', x + 60, y + 54);
        ctx.textAlign = 'left';
      });
    }
  }

  Renderer.COLORS = C;
  HE.Renderer = Renderer;
})(typeof window !== 'undefined' ? window : globalThis);
