/*
 * First-person gun: recoil spring, slide / bolt / pump cycling, magazine and
 * shell-by-shell reload animation, draw-on-switch, hands, muzzle flash and
 * brass ejection. Mechanical sounds are triggered at animation moments here,
 * so they stay in sync when a reload is cancelled or the game is paused.
 */
(function (root) {
  'use strict';
  const ZTA = root.ZTA;
  const U = ZTA.util;
  const P = ZTA.palette;

  const SPRINGS = {
    pistol: { k: 380, c: 26, scale: 1.45, x: 0.74, y: 0.95 },
    smg: { k: 700, c: 36, scale: 1.3, x: 0.75, y: 0.93 },
    shotgun: { k: 260, c: 21, scale: 1.2, x: 0.8, y: 0.9 },
  };

  /** Tiny 2D affine matrix for mapping model anchors to screen space. */
  class Affine {
    constructor() {
      this.m = [1, 0, 0, 1, 0, 0];
    }
    reset() {
      this.m = [1, 0, 0, 1, 0, 0];
      return this;
    }
    translate(x, y) {
      const m = this.m;
      m[4] += m[0] * x + m[2] * y;
      m[5] += m[1] * x + m[3] * y;
      return this;
    }
    rotate(a) {
      const m = this.m;
      const c = Math.cos(a);
      const s = Math.sin(a);
      const a0 = m[0] * c + m[2] * s;
      const b0 = m[1] * c + m[3] * s;
      const c0 = m[0] * -s + m[2] * c;
      const d0 = m[1] * -s + m[3] * c;
      m[0] = a0;
      m[1] = b0;
      m[2] = c0;
      m[3] = d0;
      return this;
    }
    scale(sx, sy) {
      const m = this.m;
      m[0] *= sx;
      m[1] *= sx;
      m[2] *= sy;
      m[3] *= sy;
      return this;
    }
    apply(x, y) {
      const m = this.m;
      return { x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] };
    }
  }

  function smoothstep(a, b, x) {
    const t = U.clamp((x - a) / (b - a), 0, 1);
    return t * t * (3 - 2 * t);
  }

  class Viewmodel {
    constructor(game, fx, audio) {
      this.game = game;
      this.fx = fx;
      this.audio = audio;
      this.rec = 0;
      this.recVel = 0;
      this.sinceShot = 9;
      this.pumpT = 9;
      this.pumpQueued = false;
      this.slideLocked = false;
      this.swayX = 0;
      this.swayY = 0;
      this.t = 0;
      this.flash = { age: 9, life: 0.05, size: 1, seed: 0 };
      this.reload = null;
      this.tilt = 0;
      this.tiltStyle = 'magazine';
      this.shellAnim = 9;
      this.affine = new Affine();
      this.muzzle = { x: 0, y: 0 };
      this.eject = { x: 0, y: 0 };
      this.setWeapon(game.weapons.activeId);

      const ev = game.events;
      ev.on('weapon:fired', (e) => this._onFired(e));
      ev.on('weapon:reloadStart', (e) => this._onReloadStart(e));
      ev.on('weapon:reloadShell', () => {
        this.shellAnim = 0;
        this.audio.play('shellIn');
      });
      ev.on('weapon:reloadEnd', () => this._onReloadEnd());
      ev.on('weapon:reloadCancel', () => {
        this.reload = null;
      });
      ev.on('weapon:switched', (e) => {
        this.setWeapon(e.weaponId);
        this.audio.play('switch');
      });
    }

    setWeapon(id) {
      this.weaponId = id;
      this.def = ZTA.data.weaponById[id];
      this.model = ZTA.GunArt.modelFor(this.def);
      this.spring = SPRINGS[this.def.model.builder] || SPRINGS.pistol;
      this.rec = 0;
      this.recVel = 0;
      this.reload = null;
      this.pumpT = 9;
      this.pumpQueued = false;
      this.slideLocked = this.game.weapons.runtime(id).ammo <= 0;
    }

    _onFired(e) {
      const st = e.stats;
      this.recVel += 34 * st.recoil.gunKick;
      this.sinceShot = 0;
      const fam = this.def.model.builder;
      this.flash.age = 0;
      this.flash.life = fam === 'shotgun' ? 0.075 : fam === 'smg' ? 0.035 : 0.05;
      this.flash.size = fam === 'shotgun' ? 1.8 : fam === 'smg' ? 0.8 : 1;
      this.flash.seed = Math.random() * 1000;
      if (fam === 'shotgun') {
        this.pumpT = 0;
        this.pumpQueued = true;
      } else {
        this._ejectCasing(fam === 'smg' ? 'small' : 'pistol');
      }
      if (fam === 'pistol' && e.ammo <= 0) this.slideLocked = true;
      this.fx.muzzleSmoke(this.muzzle.x, this.muzzle.y, this.flash.size);
    }

    _ejectCasing(kind) {
      this.fx.casing(this.eject.x, this.eject.y, 140 + Math.random() * 90, -(260 + Math.random() * 120), kind);
    }

    _onReloadStart(e) {
      this.reload = { style: e.style, duration: e.duration, t: 0, magOut: false, magIn: false, racked: false, emptyStart: this.game.weapons.active.ammo <= 0 };
    }

    _onReloadEnd() {
      if (this.reload && this.reload.style === 'shell' && this.reload.emptyStart) {
        this.pumpT = 0;
        this.pumpQueued = false;
      }
      if (this.reload && this.reload.style === 'magazine' && this.slideLocked && !this.reload.racked) this.audio.play('rack');
      this.slideLocked = false;
      this.reload = null;
    }

    update(dt) {
      if (dt <= 0) return;
      this.t += dt;
      const sp = this.spring;
      const acc = -sp.k * this.rec - sp.c * this.recVel;
      this.recVel += acc * dt;
      this.rec += this.recVel * dt;
      this.sinceShot += dt;
      this.flash.age += dt;
      this.shellAnim += dt;

      // Pump cycle: back, eject, forward.
      if (this.pumpT < 9) {
        const prev = this.pumpT;
        this.pumpT += dt;
        if (prev < 0.12 && this.pumpT >= 0.12) this.audio.play('pumpBack');
        if (prev < 0.22 && this.pumpT >= 0.22 && this.pumpQueued) {
          this._ejectCasing('shell');
          this.pumpQueued = false;
        }
        if (prev < 0.31 && this.pumpT >= 0.31) this.audio.play('pumpFwd');
      }

      const r = this.reload;
      let tiltTarget = 0;
      if (r) {
        r.t += dt;
        this.tiltStyle = r.style;
        if (r.style === 'shell') tiltTarget = 1;
        else {
          const p = this.game.weapons.progress;
          tiltTarget = smoothstep(0, 0.12, p) * (1 - smoothstep(0.8, 1, p));
        }
      }
      this.tilt = U.damp(this.tilt, tiltTarget, 16, dt);
      if (r && r.style === 'magazine') {
        const p = this.game.weapons.progress;
        if (!r.magOut && p >= 0.04) {
          r.magOut = true;
          this.audio.play('magOut');
        }
        if (!r.magIn && p >= 0.58) {
          r.magIn = true;
          this.audio.play('magIn');
        }
        if (!r.racked && p >= 0.84 && this.slideLocked) {
          r.racked = true;
          this.slideLocked = false;
          this.audio.play('rack');
        }
      }

      const g = this.game;
      const W = g.camera.W;
      const H = g.camera.H;
      const tx = ((g.aim.x - W / 2) / W) * 70;
      const ty = ((g.aim.y - H * 0.5) / H) * 44;
      this.swayX = U.damp(this.swayX, tx, 9, dt);
      this.swayY = U.damp(this.swayY, ty, 9, dt);
    }

    _anim() {
      const m = this.model;
      const a = { slide: 0, pump: 0, bolt: 0, mag: 0, magAlpha: 1, magHidden: false };
      if (m.slideTravel) {
        const t = this.sinceShot;
        const pulse = t < 0.028 ? t / 0.028 : Math.max(0, 1 - (t - 0.028) / 0.06);
        a.slide = this.slideLocked ? m.slideTravel : m.slideTravel * pulse;
      }
      if (m.boltTravel) {
        const t = this.sinceShot;
        a.bolt = m.boltTravel * (t < 0.02 ? t / 0.02 : Math.max(0, 1 - (t - 0.02) / 0.035));
      }
      if (m.pumpTravel && this.pumpT < 9) {
        const t = this.pumpT;
        const back = smoothstep(0.1, 0.2, t) * (1 - smoothstep(0.26, 0.36, t));
        a.pump = m.pumpTravel * back;
      }
      const r = this.reload;
      if (r && r.style === 'magazine' && m.magDrop) {
        const p = this.game.weapons.progress;
        if (p < 0.3) {
          a.mag = U.easeInCubic(p / 0.3) * m.magDrop;
          a.magAlpha = 1 - smoothstep(0.2, 0.3, p);
        } else if (p < 0.55) {
          a.mag = U.lerp(m.magDrop, 16, U.easeOutCubic((p - 0.3) / 0.25));
        } else if (p < 0.6) {
          a.mag = U.lerp(16, 0, (p - 0.55) / 0.05);
        }
      }
      return a;
    }

    /** Computes the screen transform. Returns the base transform params. */
    _pose() {
      const g = this.game;
      const W = g.camera.W;
      const H = g.camera.H;
      const sp = this.spring;
      const s = (H / 1080) * sp.scale;
      const wState = g.weapons.state;
      let drawOff = 0;
      let drawRot = 0;
      if (wState === 'drawing') {
        const p = U.easeOutCubic(g.weapons.progress);
        drawOff = (1 - p) * H * 0.5;
        drawRot = (1 - p) * 0.5;
      }
      const reloadRot = this.tilt * (this.tiltStyle === 'shell' ? 0.28 : 0.42);
      const reloadDrop = this.tilt * H * 0.05;
      const bob = Math.sin(this.t * 1.7) * 3 * s;
      const px = W * sp.x + this.swayX;
      const py = H * sp.y + this.swayY + drawOff + reloadDrop + bob;
      const dx = g.aim.x - px;
      const dy = g.aim.y - py;
      const full = Math.atan2(-dy, -dx);
      const theta = U.clamp(U.lerp(0.12, full, 0.42), -0.15, 0.62) + drawRot + reloadRot;
      return { px, py, s, theta };
    }

    draw(ctx, dpr) {
      const pose = this._pose();
      const m = this.model;
      const anim = this._anim();
      const rec = this.rec;
      const hand = m.anchors.hand;

      // Keep anchor positions for FX (muzzle smoke, casings) in sync.
      const A = this.affine.reset();
      A.translate(pose.px, pose.py).rotate(pose.theta).scale(-pose.s, pose.s).translate(-rec * 16, rec * 2).rotate(-rec * 0.11).translate(-hand.x, -hand.y);
      const mz = A.apply(m.anchors.muzzle.x, m.anchors.muzzle.y);
      const ej = A.apply(m.anchors.eject.x, m.anchors.eject.y);
      this.muzzle.x = mz.x;
      this.muzzle.y = mz.y;
      this.eject.x = ej.x;
      this.eject.y = ej.y;

      ctx.save();
      ctx.translate(pose.px, pose.py);
      ctx.rotate(pose.theta);
      ctx.scale(-pose.s, pose.s);
      ctx.translate(-rec * 16, rec * 2);
      ctx.rotate(-rec * 0.11);
      ctx.translate(-hand.x, -hand.y);

      this._drawArm(ctx, m, dpr);
      ZTA.GunArt.draw(ctx, m, anim, 'ink', dpr);
      this._drawShell(ctx, m);
      this._drawHand(ctx, m);
      if (m.anchors.support) this._drawSupport(ctx, m, anim);
      this._drawFlash(ctx, m);
      ctx.restore();
    }

    _drawArm(ctx, m, dpr) {
      const h = m.anchors.hand;
      ctx.save();
      ctx.translate(h.x, h.y);
      const arm = new Path2D();
      arm.moveTo(-30, -22);
      arm.lineTo(10, 40);
      arm.lineTo(-300, 460);
      arm.lineTo(-520, 300);
      arm.closePath();
      ctx.strokeStyle = P.paper;
      ctx.lineWidth = 6;
      ctx.stroke(arm);
      ctx.fillStyle = P.charcoal;
      ctx.fill(arm);
      ctx.save();
      ctx.clip(arm);
      ctx.fillStyle = ZTA.paint.pattern(ctx, 6, 1.6, ZTA.paint.rgba(P.ink, 0.55), dpr);
      ctx.fillRect(-520, -40, 560, 520);
      ctx.restore();
      // Sleeve cuff.
      ctx.strokeStyle = ZTA.paint.rgba(P.paper, 0.6);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(-58, 18);
      ctx.lineTo(-18, 72);
      ctx.stroke();
      ctx.restore();
    }

    _drawHand(ctx, m) {
      const h = m.anchors.hand;
      const t = m.anchors.trigger;
      const capsule = (x1, y1, x2, y2, r) => {
        const p = new Path2D();
        const a = Math.atan2(y2 - y1, x2 - x1);
        p.arc(x1, y1, r, a + Math.PI / 2, a - Math.PI / 2);
        p.arc(x2, y2, r, a - Math.PI / 2, a + Math.PI / 2);
        p.closePath();
        return p;
      };
      const shapes = [];
      // Palm and back of the hand behind the grip.
      const palm = new Path2D();
      palm.moveTo(h.x - 40, h.y - 50);
      palm.quadraticCurveTo(h.x - 12, h.y - 60, h.x + 6, h.y - 44);
      palm.lineTo(h.x + 8, h.y + 40);
      palm.quadraticCurveTo(h.x - 6, h.y + 58, h.x - 30, h.y + 50);
      palm.quadraticCurveTo(h.x - 52, h.y + 20, h.x - 40, h.y - 50);
      palm.closePath();
      shapes.push(palm);
      // Three fingers wrapped around the front strap.
      for (let i = 0; i < 3; i++) {
        const y = h.y - 12 + i * 19;
        shapes.push(capsule(h.x - 2, y, h.x + 30 - i * 2, y + 3, 9.5));
      }
      // Thumb along the frame, trigger finger into the guard.
      shapes.push(capsule(h.x - 30, h.y - 46, h.x + 26, h.y - 52, 8));
      shapes.push(capsule(h.x + 4, h.y - 34, t.x + 2, t.y, 7));

      ctx.save();
      ctx.lineJoin = 'round';
      for (const sh of shapes) {
        ctx.strokeStyle = P.paper;
        ctx.lineWidth = 5;
        ctx.stroke(sh);
        ctx.fillStyle = P.ink2;
        ctx.fill(sh);
      }
      // Glove seams.
      ctx.strokeStyle = ZTA.paint.rgba(P.paper, 0.35);
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(h.x - 34, h.y - 30);
      ctx.quadraticCurveTo(h.x - 26, h.y + 6, h.x - 30, h.y + 36);
      ctx.stroke();
      ctx.restore();
    }

    _drawSupport(ctx, m, anim) {
      const s = m.anchors.support;
      const x = s.x - (anim.pump || 0);
      ctx.save();
      const arm = new Path2D();
      arm.moveTo(x - 30, s.y - 6);
      arm.lineTo(x + 34, s.y - 4);
      arm.lineTo(x + 10, s.y + 420);
      arm.lineTo(x - 150, s.y + 420);
      arm.closePath();
      ctx.strokeStyle = P.paper;
      ctx.lineWidth = 6;
      ctx.stroke(arm);
      ctx.fillStyle = P.charcoal;
      ctx.fill(arm);
      const hand = new Path2D();
      hand.ellipse(x, s.y - 4, 44, 26, 0, 0, Math.PI * 2);
      ctx.stroke(hand);
      ctx.fillStyle = P.ink2;
      ctx.fill(hand);
      ctx.strokeStyle = ZTA.paint.rgba(P.paper, 0.5);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (let i = -1; i <= 1; i++) {
        ctx.moveTo(x + i * 18, s.y - 22);
        ctx.lineTo(x + i * 18 + 4, s.y + 4);
      }
      ctx.stroke();
      ctx.restore();
    }

    _drawShell(ctx, m) {
      if (!m.anchors.loadPort || this.shellAnim > 0.22) return;
      const p = m.anchors.loadPort;
      const k = U.easeOutCubic(this.shellAnim / 0.22);
      const x = p.x;
      const y = p.y + (1 - k) * 60;
      ctx.save();
      ctx.globalAlpha = 1 - smoothstep(0.16, 0.22, this.shellAnim);
      ctx.fillStyle = P.ink;
      ctx.strokeStyle = P.paper;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.rect(x - 22, y - 7, 44, 14);
      ctx.stroke();
      ctx.fill();
      ctx.fillStyle = P.paper;
      ctx.fillRect(x + 10, y - 7, 10, 14);
      ctx.restore();
    }

    _drawFlash(ctx, m) {
      const f = this.flash;
      if (f.age > f.life) return;
      const settings = this.game.save.settings;
      const mz = m.anchors.muzzle;
      const k = 1 - f.age / f.life;
      const size = 34 * f.size * (settings.flashes ? 1 : 0.6) * (0.7 + 0.3 * k);
      ctx.save();
      ctx.translate(mz.x, mz.y);
      const spikes = 9;
      let seed = f.seed;
      const rnd = () => {
        seed = (seed * 9301 + 49297) % 233280;
        return seed / 233280;
      };
      ctx.beginPath();
      for (let i = 0; i <= spikes * 2; i++) {
        const a = (i / (spikes * 2)) * Math.PI * 2;
        const r = i % 2 === 0 ? size * (0.6 + rnd() * 0.6) : size * 0.28;
        const x = Math.cos(a) * r * (Math.cos(a) > 0 ? 1.9 : 0.7);
        const y = Math.sin(a) * r * 0.85;
        if (i === 0) ctx.moveTo(x + size * 0.35, y);
        else ctx.lineTo(x + size * 0.35, y);
      }
      ctx.closePath();
      ctx.fillStyle = P.paperHi;
      ctx.strokeStyle = P.ink;
      ctx.lineWidth = 3;
      ctx.lineJoin = 'round';
      ctx.stroke();
      ctx.fill();
      ctx.beginPath();
      ctx.arc(size * 0.25, 0, size * 0.22, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.restore();
    }
  }

  ZTA.Viewmodel = Viewmodel;
})(typeof window !== 'undefined' ? window : globalThis);
