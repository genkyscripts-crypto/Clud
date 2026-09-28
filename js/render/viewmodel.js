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

  /** Spring stiffness / damping and screen anchor per builder. */
  const POSES = {
    pistol: { k: 380, c: 26, x: 0.74, y: 0.95 },
    revolver: { k: 300, c: 22, x: 0.74, y: 0.95 },
    smg: { k: 700, c: 36, x: 0.75, y: 0.94 },
    rifle: { k: 520, c: 30, x: 0.76, y: 0.98, long: true },
    shotgun: { k: 260, c: 21, x: 0.79, y: 0.96, long: true },
    marksman: { k: 220, c: 18, x: 0.77, y: 0.98, long: true },
    lmg: { k: 600, c: 34, x: 0.78, y: 0.98, long: true },
    minigun: { k: 900, c: 44, x: 0.78, y: 0.94, long: true },
    launcher: { k: 200, c: 18, x: 0.78, y: 0.96, long: true },
    arc: { k: 420, c: 26, x: 0.77, y: 0.97, long: true },
    needle: { k: 800, c: 40, x: 0.77, y: 0.97, long: true },
    rail: { k: 180, c: 16, x: 0.77, y: 0.97, long: true },
  };

  /** How a gun cycles, what it ejects and what its muzzle does. */
  function mechFor(def) {
    const b = def.model.builder;
    const pr = def.model.params || {};
    const m = { casing: null, cycle: 'none', flash: 'star', flashSize: 1, flashLife: 0.05, spin: false, energy: false, cylinder: false, charge: false };
    switch (b) {
      case 'pistol':
        Object.assign(m, { casing: 'pistol', cycle: 'slide', flash: pr.comp ? 'comp' : 'star', flashSize: pr.heavy ? 1.4 : 1 });
        break;
      case 'revolver':
        Object.assign(m, { cycle: 'cylinder', cylinder: true, flashSize: pr.shotgun ? 1.6 : 1.3, flashLife: 0.06 });
        break;
      case 'smg':
        Object.assign(m, { casing: 'small', cycle: 'bolt', flashSize: 0.8, flashLife: 0.035 });
        break;
      case 'rifle':
        Object.assign(m, { casing: 'rifle', cycle: 'bolt', flashSize: 1.15, flashLife: 0.045 });
        break;
      case 'shotgun':
        Object.assign(m, { casing: pr.style === 'double' ? null : 'shell', cycle: pr.style === 'pump' ? 'pump' : pr.style === 'double' ? 'none' : 'bolt', flashSize: 1.8, flashLife: 0.075 });
        break;
      case 'marksman':
        Object.assign(m, {
          casing: 'rifle',
          cycle: pr.style === 'bolt' || pr.style === 'antimat' ? 'boltAction' : 'bolt',
          flash: pr.brake ? 'brake' : 'star',
          flashSize: pr.style === 'antimat' ? 2.1 : 1.5,
          flashLife: 0.07,
        });
        break;
      case 'lmg':
        Object.assign(m, { casing: 'rifle', cycle: 'bolt', flashSize: 1.25, flashLife: 0.045 });
        break;
      case 'minigun':
        Object.assign(m, { casing: 'rifle', spin: true, flashSize: 1.1, flashLife: 0.03 });
        break;
      case 'launcher':
        Object.assign(m, { cycle: 'cylinder', cylinder: !!pr.drum, flash: 'puff', flashSize: 2, flashLife: 0.09 });
        break;
      case 'arc':
        Object.assign(m, { energy: true, flash: 'arc', flashSize: 1.3, flashLife: 0.08 });
        break;
      case 'needle':
        Object.assign(m, { energy: true, spin: true, flash: 'energy', flashSize: 0.8, flashLife: 0.035 });
        break;
      case 'rail':
        Object.assign(m, { energy: true, charge: true, flash: 'rail', flashSize: 2.2, flashLife: 0.12 });
        break;
      default:
    }
    return m;
  }

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
      this.boltT = 9;
      this.boltQueued = false;
      this.slideLocked = false;
      this.cyl = 0;
      this.cylTarget = 0;
      this.spin = 0;
      this.spinVel = 0;
      this.glow = 0;
      this.swayX = 0;
      this.swayY = 0;
      this.t = 0;
      this.flash = { age: 9, life: 0.05, size: 1, seed: 0, kind: 'star' };
      this.reload = null;
      this.tilt = 0;
      this.tiltStyle = 'magazine';
      this.shellAnim = 9;
      this.affine = new Affine();
      this.muzzle = { x: 0, y: 0 };
      this.eject = { x: 0, y: 0 };
      this.finish = null;
      this.setWeapon(game.weapons.activeId);
      fx.muzzleAt = () => this.muzzle;

      const ev = game.events;
      ev.on('weapon:fired', (e) => this._onFired(e));
      ev.on('weapon:reloadStart', (e) => this._onReloadStart(e));
      ev.on('weapon:reloadShell', () => {
        this.shellAnim = 0;
        this.audio.play('shellIn');
      });
      ev.on('weapon:reloadEnd', () => this._onReloadEnd());
      ev.on('weapon:reloadCancel', () => {
        if (this.reload && this.reload.style === 'vent') this.glow = Math.max(this.glow, 0.3);
        this.reload = null;
      });
      ev.on('weapon:switched', (e) => {
        this.setWeapon(e.weaponId);
        this.audio.play('switch');
      });
      ev.on('finish:changed', (e) => {
        if (e.weaponId === this.weaponId) this.finish = e.finish;
      });
    }

    setWeapon(id) {
      this.weaponId = id;
      this.def = ZTA.data.weaponById[id];
      this.model = ZTA.GunArt.modelFor(this.def);
      this.builder = this.def.model.builder;
      this.pose = POSES[this.builder] || POSES.pistol;
      this.mech = mechFor(this.def);
      this.rec = 0;
      this.recVel = 0;
      this.reload = null;
      this.pumpT = 9;
      this.pumpQueued = false;
      this.boltT = 9;
      this.boltQueued = false;
      this.spinVel = 0;
      this.glow = this.mech.energy ? 1 : 0;
      this.sinceShot = 9;
      this.slideLocked = this.game.weapons.runtime(id).ammo <= 0;
      const prog = this.game.progression;
      this.finish = prog && prog.finishOf ? prog.finishOf(id) : null;
    }

    _onFired(e) {
      const st = e.stats;
      const m = this.mech;
      this.recVel += 34 * st.recoil.gunKick;
      this.sinceShot = 0;
      const f = this.flash;
      f.age = 0;
      f.life = m.flashLife;
      f.size = m.flashSize;
      f.kind = m.flash;
      f.seed = Math.random() * 1000;
      switch (m.cycle) {
        case 'pump':
          this.pumpT = 0;
          this.pumpQueued = true;
          break;
        case 'boltAction':
          if (e.ammo > 0) {
            this.boltT = 0;
            this.boltQueued = true;
          } else this._ejectCasing(m.casing);
          break;
        case 'cylinder':
          this.cylTarget += 0.25;
          break;
        default:
          if (m.casing) this._ejectCasing(m.casing);
      }
      if (m.spin) this.spinVel = Math.max(this.spinVel, this.builder === 'minigun' ? 1400 : 900);
      if (m.energy) this.glow = m.charge ? 0 : 1;
      if (this.builder === 'pistol' && e.ammo <= 0) this.slideLocked = true;
      this.fx.muzzleSmoke(this.muzzle.x, this.muzzle.y, m.flash === 'puff' ? 2.2 : m.energy ? 0.4 : f.size);
      if (m.charge) this.fx.muzzleSmoke(this.eject.x, this.eject.y, 1.2);
    }

    _ejectCasing(kind) {
      if (!kind) return;
      const big = kind === 'shell' || kind === 'rifle';
      this.fx.casing(this.eject.x, this.eject.y, (big ? 170 : 140) + Math.random() * 90, -(260 + Math.random() * 120), kind);
    }

    _onReloadStart(e) {
      this.reload = { style: e.style, duration: e.duration, t: 0, magOut: false, magIn: false, racked: false, opened: false, dumped: false, closed: false, vented: false, emptyStart: this.game.weapons.active.ammo <= 0 };
    }

    _onReloadEnd() {
      const r = this.reload;
      if (r && r.style === 'shell' && r.emptyStart && this.mech.cycle === 'pump') {
        this.pumpT = 0;
        this.pumpQueued = false;
      }
      if (r && (r.style === 'magazine' || r.style === 'box') && this.slideLocked && !r.racked) this.audio.play('rack');
      if (r && r.style === 'vent') this.glow = 1;
      this.slideLocked = false;
      this.reload = null;
    }

    update(dt) {
      if (dt <= 0) return;
      this.t += dt;
      const sp = this.pose;
      const acc = -sp.k * this.rec - sp.c * this.recVel;
      this.recVel += acc * dt;
      this.rec += this.recVel * dt;
      this.sinceShot += dt;
      this.flash.age += dt;
      this.shellAnim += dt;
      this.cyl = U.damp(this.cyl, this.cylTarget, 22, dt);
      if (this.mech.spin) {
        this.spin += this.spinVel * dt;
        if (this.sinceShot > 0.08) this.spinVel *= Math.exp(-2.2 * dt);
      }
      if (this.mech.energy && !this.reload) {
        if (this.mech.charge) this.glow = Math.min(1, this.glow + dt / 0.9);
        else this.glow = U.damp(this.glow, 0.65 + 0.12 * Math.sin(this.t * 7), 6, dt);
      }

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
      // Bolt-action cycle: lift, pull (eject), push, lower.
      if (this.boltT < 9) {
        const prev = this.boltT;
        this.boltT += dt;
        if (prev < 0.08 && this.boltT >= 0.08) this.audio.play('boltUp');
        if (prev < 0.26 && this.boltT >= 0.26 && this.boltQueued) {
          this._ejectCasing('rifle');
          this.boltQueued = false;
        }
        if (prev < 0.4 && this.boltT >= 0.4) this.audio.play('boltDown');
        if (this.boltT > 0.6) this.boltT = 9;
      }

      const r = this.reload;
      let tiltTarget = 0;
      if (r) {
        r.t += dt;
        this.tiltStyle = r.style;
        const p = this.game.weapons.progress;
        if (r.style === 'shell') tiltTarget = 1;
        else tiltTarget = smoothstep(0, 0.12, p) * (1 - smoothstep(0.82, 1, p));
        this._reloadEvents(r, p);
      }
      this.tilt = U.damp(this.tilt, tiltTarget, 16, dt);

      const g = this.game;
      const W = g.camera.W;
      const H = g.camera.H;
      const tx = ((g.aim.x - W / 2) / W) * 70;
      const ty = ((g.aim.y - H * 0.5) / H) * 44;
      this.swayX = U.damp(this.swayX, tx, 9, dt);
      this.swayY = U.damp(this.swayY, ty, 9, dt);
    }

    /** Sounds and ejections at fixed points of each reload style. */
    _reloadEvents(r, p) {
      switch (r.style) {
        case 'magazine':
        case 'box':
          if (!r.magOut && p >= 0.04) {
            r.magOut = true;
            this.audio.play(r.style === 'box' ? 'boxOpen' : 'magOut');
          }
          if (!r.magIn && p >= 0.58) {
            r.magIn = true;
            this.audio.play('magIn');
          }
          if (!r.racked && p >= 0.84 && (this.slideLocked || r.style === 'box')) {
            r.racked = true;
            this.slideLocked = false;
            this.audio.play('rack');
          }
          break;
        case 'cylinder':
          if (!r.opened && p >= 0.06) {
            r.opened = true;
            this.audio.play('cylOut');
          }
          if (!r.dumped && p >= 0.2) {
            r.dumped = true;
            if (this.builder === 'revolver') for (let i = 0; i < 5; i++) this.fx.casing(this.eject.x + (Math.random() - 0.5) * 20, this.eject.y + 20, (Math.random() - 0.5) * 80, 60 + Math.random() * 120, 'pistol');
          }
          if (!r.magIn && p >= 0.55) {
            r.magIn = true;
            this.audio.play('shellIn');
          }
          if (!r.closed && p >= 0.84) {
            r.closed = true;
            this.cylTarget += 0.5;
            this.audio.play('cylIn');
          }
          break;
        case 'break':
          if (!r.opened && p >= 0.08) {
            r.opened = true;
            this.audio.play('breakOpen');
          }
          if (!r.dumped && p >= 0.24) {
            r.dumped = true;
            for (let i = 0; i < 2; i++) this.fx.casing(this.eject.x, this.eject.y, -40 + i * 30, -(180 + Math.random() * 60), 'shell');
          }
          if (!r.magIn && p >= 0.55) {
            r.magIn = true;
            this.audio.play('shellIn');
          }
          if (!r.closed && p >= 0.84) {
            r.closed = true;
            this.audio.play('breakClose');
          }
          break;
        case 'vent':
          if (!r.vented && p >= 0.08) {
            r.vented = true;
            this.audio.play('vent');
            for (let i = 0; i < 3; i++) this.fx.muzzleSmoke(this.eject.x, this.eject.y, 1.6);
          }
          if (!r.magIn && p >= 0.6) {
            r.magIn = true;
            this.audio.play('charge');
          }
          this.glow = p < 0.3 ? Math.max(0, 1 - p / 0.2) : smoothstep(0.55, 0.95, p);
          break;
        default:
      }
    }

    _anim() {
      const m = this.model;
      const mech = this.mech;
      const a = { slide: 0, pump: 0, bolt: 0, mag: 0, magAlpha: 1, magHidden: false, boltHandle: 0, cylinder: this.cyl, cylOut: 0, barrels: 0, spin: this.spin, glow: this.glow };
      const tr = m.travel || {};
      if (tr.slide) {
        const t = this.sinceShot;
        const pulse = t < 0.028 ? t / 0.028 : Math.max(0, 1 - (t - 0.028) / 0.06);
        a.slide = this.slideLocked ? tr.slide : tr.slide * pulse;
      }
      if (tr.bolt && mech.cycle === 'bolt') {
        const t = this.sinceShot;
        a.bolt = tr.bolt * (t < 0.02 ? t / 0.02 : Math.max(0, 1 - (t - 0.02) / 0.035));
      }
      if (tr.pump && this.pumpT < 9) {
        const t = this.pumpT;
        a.pump = tr.pump * smoothstep(0.1, 0.2, t) * (1 - smoothstep(0.26, 0.36, t));
      }
      if (mech.cycle === 'boltAction' && this.boltT < 9) {
        const t = this.boltT;
        a.boltHandle = smoothstep(0.04, 0.26, t) * (1 - smoothstep(0.3, 0.52, t));
      }
      const r = this.reload;
      if (r) {
        const p = this.game.weapons.progress;
        if ((r.style === 'magazine' || r.style === 'box' || r.style === 'vent') && m.magDrop) {
          const drop = r.style === 'vent' ? Math.min(m.magDrop, 40) : m.magDrop;
          if (p < 0.3) {
            a.mag = U.easeInCubic(p / 0.3) * drop;
            a.magAlpha = r.style === 'vent' ? 1 : 1 - smoothstep(0.2, 0.3, p);
          } else if (p < 0.55) {
            a.mag = U.lerp(drop, r.style === 'vent' ? drop * 0.6 : 16, U.easeOutCubic((p - 0.3) / 0.25));
          } else if (p < 0.62) {
            a.mag = U.lerp(r.style === 'vent' ? drop * 0.6 : 16, 0, (p - 0.55) / 0.07);
          }
        }
        if (r.style === 'cylinder') {
          const out = smoothstep(0.04, 0.16, p) * (1 - smoothstep(0.8, 0.9, p));
          a.cylOut = out * (this.builder === 'launcher' ? 26 : 34);
          if (m.anchors.loadPort == null && p > 0.3 && p < 0.8) a.cylinder = this.cyl + Math.floor((p - 0.3) * 12) * 0.25;
        }
        if (r.style === 'break') a.barrels = 0.42 * smoothstep(0.05, 0.18, p) * (1 - smoothstep(0.78, 0.9, p));
        if (r.style === 'magazine' && this.model.clip && p > 0.04 && p < 0.25) a.bolt = (tr.bolt || 16) * 1.5;
      }
      return a;
    }

    /** Computes the screen transform. */
    _pose() {
      const g = this.game;
      const W = g.camera.W;
      const H = g.camera.H;
      const sp = this.pose;
      // Long guns are drawn larger and held flatter, stock off the bottom edge.
      const s = (H / 1080) * (this.model.scale || 1.2) * (sp.long ? 1.3 : 1);
      const wState = g.weapons.state;
      let drawOff = 0;
      let drawRot = 0;
      if (wState === 'drawing') {
        const p = U.easeOutCubic(g.weapons.progress);
        drawOff = (1 - p) * H * 0.5;
        drawRot = (1 - p) * 0.5;
      }
      const style = this.tiltStyle;
      const rot = style === 'shell' ? 0.28 : style === 'cylinder' ? 0.55 : style === 'break' ? -0.22 : style === 'vent' ? 0.22 : style === 'box' ? 0.3 : 0.42;
      const reloadRot = this.tilt * rot;
      const reloadDrop = this.tilt * H * (style === 'break' ? 0.02 : 0.05);
      const bob = Math.sin(this.t * 1.7) * 3 * s;
      // Heavy guns shudder while the barrels spin.
      const shudder = this.mech.spin && this.spinVel > 200 ? Math.sin(this.t * 90) * Math.min(1, this.spinVel / 1400) * 2 * s : 0;
      const px = W * sp.x + this.swayX;
      const py = H * sp.y + this.swayY + drawOff + reloadDrop + bob + shudder;
      const dx = g.aim.x - px;
      const dy = g.aim.y - py;
      const full = Math.atan2(-dy, -dx);
      const aimT = sp.long ? U.clamp(U.lerp(0.2, full, 0.3), 0.02, 0.48) : U.clamp(U.lerp(0.12, full, 0.42), -0.15, 0.62);
      const theta = aimT + drawRot + reloadRot;
      return { px, py, s, theta };
    }

    draw(ctx, dpr) {
      const pose = this._pose();
      const m = this.model;
      const anim = this._anim();
      const rec = this.rec;
      const hand = m.anchors.hand;
      const kickX = rec * (this.builder === 'marksman' || this.builder === 'rail' || this.builder === 'launcher' ? 22 : 16);

      // Keep anchor positions for FX (muzzle smoke, casings, tracers) in sync.
      const A = this.affine.reset();
      A.translate(pose.px, pose.py).rotate(pose.theta).scale(-pose.s, pose.s).translate(-kickX, rec * 2).rotate(-rec * 0.11).translate(-hand.x, -hand.y);
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
      ctx.translate(-kickX, rec * 2);
      ctx.rotate(-rec * 0.11);
      ctx.translate(-hand.x, -hand.y);

      this._drawArm(ctx, m, dpr);
      if (m.anchors.support) this._drawSupport(ctx, m, anim, 'arm');
      ZTA.GunArt.draw(ctx, m, anim, 'ink', dpr, this.finish);
      this._drawShell(ctx, m);
      this._drawHand(ctx, m);
      if (m.anchors.support) this._drawSupport(ctx, m, anim, 'thumb');
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

    /** Support hand: arm and palm under the fore-end, thumb wrapped over it. */
    _drawSupport(ctx, m, anim, layer) {
      const s = m.anchors.support;
      const x = s.x - (anim.pump || 0);
      ctx.save();
      ctx.lineJoin = 'round';
      if (layer === 'arm') {
        const arm = new Path2D();
        arm.moveTo(x - 34, s.y + 4);
        arm.lineTo(x + 30, s.y + 6);
        arm.lineTo(x + 10, s.y + 420);
        arm.lineTo(x - 150, s.y + 420);
        arm.closePath();
        ctx.strokeStyle = P.paper;
        ctx.lineWidth = 6;
        ctx.stroke(arm);
        ctx.fillStyle = P.charcoal;
        ctx.fill(arm);
        const palm = new Path2D();
        palm.ellipse(x - 2, s.y + 6, 42, 24, 0, 0, Math.PI * 2);
        ctx.stroke(palm);
        ctx.fillStyle = P.ink2;
        ctx.fill(palm);
        ctx.strokeStyle = ZTA.paint.rgba(P.paper, 0.35);
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(x - 30, s.y + 16);
        ctx.quadraticCurveTo(x - 4, s.y + 26, x + 24, s.y + 14);
        ctx.stroke();
      } else {
        // Thumb along the near side of the handguard.
        const thumb = new Path2D();
        const a0 = x - 36;
        const a1 = x + 30;
        const y = s.y - 10;
        thumb.moveTo(a0, y - 8);
        thumb.lineTo(a1, y - 6);
        thumb.arc(a1, y + 1, 7, -Math.PI / 2, Math.PI / 2);
        thumb.lineTo(a0, y + 12);
        thumb.closePath();
        ctx.strokeStyle = P.paper;
        ctx.lineWidth = 4;
        ctx.stroke(thumb);
        ctx.fillStyle = P.ink2;
        ctx.fill(thumb);
        ctx.strokeStyle = ZTA.paint.rgba(P.paper, 0.4);
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(a1 - 12, y - 5);
        ctx.lineTo(a1 - 12, y + 7);
        ctx.stroke();
      }
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
      let seed = f.seed;
      const rnd = () => {
        seed = (seed * 9301 + 49297) % 233280;
        return seed / 233280;
      };
      const ink = (path, fill, width) => {
        ctx.strokeStyle = P.ink;
        ctx.lineWidth = width || 3;
        ctx.lineJoin = 'round';
        ctx.stroke(path);
        ctx.fillStyle = fill;
        ctx.fill(path);
      };
      const star = (cx, spikes, lenFwd, lenBack, height) => {
        const p = new Path2D();
        for (let i = 0; i <= spikes * 2; i++) {
          const a = (i / (spikes * 2)) * Math.PI * 2;
          const r = i % 2 === 0 ? size * (0.6 + rnd() * 0.6) : size * 0.28;
          const x = Math.cos(a) * r * (Math.cos(a) > 0 ? lenFwd : lenBack);
          const y = Math.sin(a) * r * height;
          if (i === 0) p.moveTo(x + cx, y);
          else p.lineTo(x + cx, y);
        }
        p.closePath();
        return p;
      };
      ctx.save();
      ctx.translate(mz.x, mz.y);
      switch (f.kind) {
        case 'arc': {
          // Crackling bolts that fork off the emitter.
          for (const [c, w] of [
            [P.ink, 6],
            [P.paperHi, 2.4],
          ]) {
            ctx.strokeStyle = c;
            ctx.lineWidth = w;
            ctx.lineCap = 'round';
            let s2 = f.seed;
            const r2 = () => {
              s2 = (s2 * 9301 + 49297) % 233280;
              return s2 / 233280;
            };
            ctx.beginPath();
            for (let b = 0; b < 4; b++) {
              let x = 0;
              let y = 0;
              ctx.moveTo(x, y);
              const dir = (r2() - 0.5) * 1.6;
              for (let j = 0; j < 5; j++) {
                x += size * (0.35 + r2() * 0.3);
                y += Math.sin(dir) * size * 0.3 + (r2() - 0.5) * size * 0.5;
                ctx.lineTo(x, y);
              }
            }
            ctx.stroke();
          }
          const core = new Path2D();
          core.arc(0, 0, size * 0.3, 0, Math.PI * 2);
          ink(core, P.paperHi, 3);
          break;
        }
        case 'energy': {
          const ring = new Path2D();
          ring.ellipse(size * 0.2, 0, size * 0.35, size * 0.55, 0, 0, Math.PI * 2);
          ctx.strokeStyle = P.ink;
          ctx.lineWidth = 6;
          ctx.stroke(ring);
          ctx.strokeStyle = P.paperHi;
          ctx.lineWidth = 3;
          ctx.stroke(ring);
          const dot = new Path2D();
          dot.arc(size * 0.2, 0, size * 0.18, 0, Math.PI * 2);
          ink(dot, P.paperHi, 2);
          break;
        }
        case 'rail': {
          for (let i = 0; i < 3; i++) {
            const ring = new Path2D();
            const x = size * (0.3 + i * 0.55) * (1.4 - k * 0.4);
            ring.ellipse(x, 0, size * 0.18, size * (0.75 - i * 0.15), 0, 0, Math.PI * 2);
            ctx.strokeStyle = P.ink;
            ctx.lineWidth = 7;
            ctx.stroke(ring);
            ctx.strokeStyle = P.paperHi;
            ctx.lineWidth = 3;
            ctx.stroke(ring);
          }
          ink(star(size * 0.3, 11, 2.2, 0.6, 0.7), P.paperHi, 3);
          const core = new Path2D();
          core.arc(size * 0.3, 0, size * 0.3, 0, Math.PI * 2);
          ctx.fillStyle = '#ffffff';
          ctx.fill(core);
          break;
        }
        case 'puff': {
          const cloud = new Path2D();
          for (let i = 0; i < 5; i++) {
            const a = (i / 5) * Math.PI * 2 + f.seed;
            cloud.moveTo(size * 0.5 + Math.cos(a) * size * 0.5 + size * 0.45, Math.sin(a) * size * 0.45);
            cloud.arc(size * 0.5 + Math.cos(a) * size * 0.5, Math.sin(a) * size * 0.45, size * 0.45, 0, Math.PI * 2);
          }
          ctx.fillStyle = ZTA.paint.rgba(P.smoke, 0.8);
          ctx.fill(cloud);
          ink(star(size * 0.35, 9, 1.4, 0.7, 0.85), P.paperHi, 3);
          break;
        }
        default: {
          ink(star(size * 0.35, 9, 1.9, 0.7, 0.85), P.paperHi, 3);
          if (f.kind === 'comp' || f.kind === 'brake') {
            // Ported gas: jets up (compensator) or both sides (muzzle brake).
            const sides = f.kind === 'comp' ? [-1] : [-1, 1];
            for (const sd of sides) {
              const jet = new Path2D();
              const bx = f.kind === 'comp' ? -size * 0.2 : -size * 0.1;
              jet.moveTo(bx - size * 0.15, 0);
              jet.lineTo(bx - size * 0.35, sd * size * (1.1 + rnd() * 0.4));
              jet.lineTo(bx + size * 0.05, sd * size * (0.9 + rnd() * 0.3));
              jet.lineTo(bx + size * 0.15, 0);
              jet.closePath();
              ink(jet, P.paperHi, 3);
            }
          }
          const core = new Path2D();
          core.arc(size * 0.25, 0, size * 0.22, 0, Math.PI * 2);
          ctx.fillStyle = '#ffffff';
          ctx.fill(core);
        }
      }
      ctx.restore();
    }
  }

  ZTA.Viewmodel = Viewmodel;
})(typeof window !== 'undefined' ? window : globalThis);
