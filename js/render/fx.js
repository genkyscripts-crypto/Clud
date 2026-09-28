/*
 * Pooled feedback effects: sparks, glass shards, ink droplets, debris, dust,
 * rings, casings, muzzle smoke, bullet-hole decals, damage numbers, cash
 * popups, hit markers, screen shake and flashes. Plus the loud ones:
 * explosions (blast, embers, smoke billows, scorch), tracers, rail beams,
 * arc lightning, ricochet streaks and the boss-down sequence.
 *
 * Every effect lives in a fixed RingPool, so long sessions can never grow
 * memory or draw cost. World effects are stored without the recoil offset and
 * re-offset when drawn, so they stay glued to the range while the view kicks.
 */
(function (root) {
  'use strict';
  const ZTA = root.ZTA;
  const U = ZTA.util;
  const P = ZTA.palette;
  const paint = ZTA.paint;

  const LIMITS = { particles: 520, screen: 90, decals: 48, labels: 36, links: 32 };

  /** Visible round per audio profile; the rest (pistols, SMGs, shotguns) stay invisible. */
  const TRACERS = { rifle: 'tracer', battle: 'tracer', lmg: 'tracer', minigun: 'tracer', marksman: 'heavy', rail: 'beam', arc: 'arc', needle: 'needle' };

  class FX {
    constructor(game) {
      this.game = game;
      this.particles = new ZTA.RingPool(LIMITS.particles, () => ({}));
      this.screen = new ZTA.RingPool(LIMITS.screen, () => ({}));
      this.decals = new ZTA.RingPool(LIMITS.decals, () => ({}));
      this.labels = new ZTA.RingPool(LIMITS.labels, () => ({}));
      this.links = new ZTA.RingPool(LIMITS.links, () => ({}));
      this.pending = [];
      /** Set by the viewmodel: () => { x, y } muzzle position on screen. */
      this.muzzleAt = null;
      this.hit = { age: 9, kind: 'hit' };
      this.trauma = 0;
      this.shakeX = 0;
      this.shakeY = 0;
      this.sceneFlash = 0;
      this.crossPulse = 0;
      this.t = 0;
      this._c = {};
      this._bind(game.events);
    }

    get settings() {
      return this.game.save.settings;
    }
    get density() {
      return this.settings.intenseFx ? 1 : 0.45;
    }

    _bind(ev) {
      ev.on('weapon:fired', (e) => {
        if (this.settings.shake) this.trauma = Math.min(1, this.trauma + e.stats.recoil.shake);
        if (this.settings.flashes) this.sceneFlash = Math.max(this.sceneFlash, e.stats.family === 'shotgun' ? 0.1 : 0.045);
      });
      ev.on('shot:resolved', (e) => this._impacts(e));
      ev.on('target:hit', (e) => this._targetHit(e));
      ev.on('target:broken', (e) => this._targetBroken(e));
      ev.on('target:landed', (e) => {
        const c = ZTA.TargetArt.center(e.target, this.game.camera, this._c);
        const drop = e.target.kind === 'plate' ? e.target.radius : 0.1;
        this._dust(c.sx, c.sy + drop * c.s, c.s * 0.25, e.target.kind === 'plate' ? 5 : 7);
      });
      ev.on('combo:changed', (e) => {
        if (e.tierUp) this.crossPulse = 1;
      });
      ev.on('explosion', (e) => this._explosion(e));
      ev.on('fx:link', (e) => this._worldLink(e.from, e.to, e.kind));
      ev.on('boss:defeated', (e) => this._bossDown(e.boss));
      ev.on('target:escaped', (e) => {
        if (e.target.kind !== 'drone') return;
        const c = ZTA.TargetArt.center(e.target, this.game.camera, this._c);
        this._label(U.clamp(c.sx, 60, this.game.camera.W - 60), c.sy, 'ESCAPED', 'miss', 0.9);
      });
      ev.on('range:changed', () => this.clear());
      ev.on('challenge:start', () => this.clear());
    }

    /* ------------------------------------------------------------- spawners */

    _world(type, x, y, o) {
      const cam = this.game.camera;
      const p = this.particles.spawn();
      p.type = type;
      p.x = x - cam.offX;
      p.y = y - cam.offY;
      p.vx = o.vx || 0;
      p.vy = o.vy || 0;
      p.g = o.g == null ? 1200 : o.g;
      p.drag = o.drag || 0;
      p.age = 0;
      p.life = o.life || 0.5;
      p.size = o.size || 4;
      p.rot = o.rot || Math.random() * Math.PI * 2;
      p.vr = o.vr || 0;
      p.tone = o.tone || 'ink';
      p.seed = Math.random();
      return p;
    }

    _count(n) {
      return Math.max(1, Math.round(n * this.density));
    }

    _sparks(x, y, s, n, speed) {
      for (let i = 0; i < this._count(n); i++) {
        const a = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.6;
        const v = (speed || 1) * (220 + Math.random() * 420) * U.clamp(s / 120, 0.5, 1.6);
        this._world('spark', x, y, { vx: Math.cos(a) * v, vy: Math.sin(a) * v, g: 900, life: 0.14 + Math.random() * 0.16, size: 1 });
      }
    }

    _dust(x, y, s, n) {
      for (let i = 0; i < this._count(n); i++) {
        this._world('dust', x + (Math.random() - 0.5) * s * 0.4, y, {
          vx: (Math.random() - 0.5) * 60,
          vy: -20 - Math.random() * 50,
          g: -10,
          life: 0.45 + Math.random() * 0.35,
          size: Math.max(4, s * (0.12 + Math.random() * 0.12)),
        });
      }
    }

    _ring(x, y, size, tone) {
      this._world('ring', x, y, { g: 0, life: 0.22, size, tone });
    }

    casing(x, y, vx, vy, kind) {
      const p = this.screen.spawn();
      p.type = 'casing';
      p.kind = kind;
      p.x = x;
      p.y = y;
      p.vx = vx;
      p.vy = vy;
      p.g = 2100;
      p.age = 0;
      p.life = 1.1;
      p.rot = Math.random() * 6;
      p.vr = (Math.random() < 0.5 ? -1 : 1) * (14 + Math.random() * 10);
      const H = this.game.camera.H;
      p.size = (H / 1080) * (kind === 'shell' ? 1.6 : kind === 'small' ? 0.9 : kind === 'rifle' ? 1.15 : 1);
    }

    muzzleSmoke(x, y, size) {
      const n = this._count(2);
      for (let i = 0; i < n; i++) {
        const p = this.screen.spawn();
        p.type = 'smoke';
        p.x = x + (Math.random() - 0.5) * 10;
        p.y = y + (Math.random() - 0.5) * 6;
        p.vx = -30 - Math.random() * 40;
        p.vy = -30 - Math.random() * 30;
        p.g = -20;
        p.age = 0;
        p.life = 0.5 + Math.random() * 0.4;
        p.size = (8 + Math.random() * 8) * size * (this.game.camera.H / 1080);
        p.rot = 0;
        p.vr = 0;
      }
    }

    _decal(world, kind, size) {
      const d = this.decals.spawn();
      d.x = world.x;
      d.y = world.y;
      d.z = world.z;
      d.surface = world.surface;
      d.kind = kind;
      d.size = size;
      d.seed = Math.random() * 1000;
      d.age = 0;
    }

    _label(x, y, text, kind, scale) {
      const cam = this.game.camera;
      const l = this.labels.spawn();
      l.x = x - cam.offX + (Math.random() - 0.5) * 10;
      l.y = y - cam.offY;
      l.text = text;
      l.kind = kind;
      l.age = 0;
      l.life = kind === 'cash' || kind === 'bonus' || kind === 'callout' ? 0.95 : 0.6;
      l.scale = scale || 1;
    }

    /* ------------------------------------------------------------- handlers */

    _impacts(shot) {
      this._tracer(shot);
      const many = shot.impacts.length > 2;
      for (const im of shot.impacts) {
        const s = this.game.camera.f / im.z;
        if (im.kind === 'target') {
          if (im.material === 'steel') {
            this._sparks(im.x, im.y, s, many ? 2 : 5);
            if (!many) this._ring(im.x, im.y, s * 0.08, 'paper');
          } else if (im.material === 'mech') {
            this._sparks(im.x, im.y, s, im.armored ? (many ? 2 : 4) : many ? 2 : 6, im.armored ? 0.7 : 1.1);
            if (im.weak) this._ring(im.x, im.y, s * 0.1, 'paper');
          }
        } else if (im.kind === 'prop') {
          for (let i = 0; i < this._count(many ? 2 : 4); i++) {
            const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.2;
            const v = 120 + Math.random() * 200;
            this._world('chunk', im.x, im.y, { vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0.5, size: Math.max(2, s * 0.02), vr: 10, tone: 'paperDim' });
          }
          this._dust(im.x, im.y, s, 2);
        } else {
          const w = im.world;
          if (w.surface === 'sky') continue;
          this._dust(im.x, im.y, s, many ? 1 : 3);
          this._decal(w, 'hole', 0.022);
        }
      }
    }

    _targetHit(e) {
      const set = this.settings;
      if (set.hitMarkers) {
        this.hit.age = 0;
        this.hit.kind = e.broken ? 'kill' : e.weak ? 'crit' : 'hit';
      }
      if (set.damageNumbers) {
        const dmg = Math.max(1, Math.round(e.damage));
        const kind = e.weak ? 'crit' : e.armored ? 'armor' : 'dmg';
        this._label(e.x, e.y - 14, String(dmg), kind, 1);
      }
      if (e.target.def.material === 'glass' && !e.broken) this._sparks(e.x, e.y, 80, 2);
    }

    _targetBroken(e) {
      const t = e.target;
      const cam = this.game.camera;
      const c = ZTA.TargetArt.center(t, cam, this._c);
      const s = c.s;
      const x = c.sx;
      const y = c.sy;
      const mat = t.def.material;
      if (mat === 'steel') {
        const rad = t.kind === 'plate' ? t.radius : t.kind === 'barrel' ? 0.3 : 0.28;
        this._sparks(x, y - rad * s, s, 8, 1.2);
        this._ring(x, y, rad * s * 1.3, 'paper');
      } else if (mat === 'glass') {
        const h = (t.def.shape.h || 0.25) * (t.scale || 1) * s;
        for (let i = 0; i < this._count(14); i++) {
          const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.6;
          const v = 160 + Math.random() * 380;
          this._world('shard', x + (Math.random() - 0.5) * h * 0.3, y + (Math.random() - 0.5) * h * 0.6, {
            vx: Math.cos(a) * v,
            vy: Math.sin(a) * v - 80,
            g: 1500,
            life: 0.6 + Math.random() * 0.5,
            size: Math.max(2.5, h * (0.08 + Math.random() * 0.1)),
            vr: (Math.random() - 0.5) * 24,
          });
        }
        for (let i = 0; i < this._count(8); i++) {
          const a = -Math.PI / 2 + (Math.random() - 0.5) * 2;
          const v = 90 + Math.random() * 260;
          this._world('drop', x, y, { vx: Math.cos(a) * v, vy: Math.sin(a) * v, g: 1300, life: 0.5 + Math.random() * 0.3, size: Math.max(1.5, s * 0.012 + Math.random() * 2) });
        }
        // A restrained ink splat on the backstop behind the bottle.
        const w = cam.backdropHit(x, y);
        this._decal(w, 'splat', 0.1 + Math.random() * 0.06);
      } else if (mat === 'mech') {
        for (let i = 0; i < this._count(7); i++) {
          const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.4;
          const v = 180 + Math.random() * 300;
          this._world('chunk', x, y, { vx: Math.cos(a) * v, vy: Math.sin(a) * v - 60, g: 1500, life: 0.9, size: Math.max(3, s * (0.05 + Math.random() * 0.05)), vr: (Math.random() - 0.5) * 16 });
        }
        this._sparks(x, y, s, 10, 1.3);
        this._dust(x, y + s * 0.5, s, 4);
        this._ring(x, y, s * 0.35, 'paper');
      }
      const big = e.amount >= 20 || e.multi > 1;
      this._label(x, y - s * 0.25, '+' + ZTA.fmt.cash(e.amount), big ? 'bonus' : 'cash', 1);
      if (e.multi > 1) this._label(x, y - s * 0.25 - 26, 'MULTI ×' + e.multi, 'callout', 1);
    }

    /* ------------------------------------------------------ rounds and links */

    _tracer(shot) {
      if (!this.muzzleAt || shot.projectile) return;
      const w = ZTA.data.weaponById[shot.weaponId];
      const kind = w && TRACERS[w.audio];
      if (!kind) return;
      const m = this.muzzleAt();
      if (!m) return;
      const cam = this.game.camera;
      let far = null;
      for (const im of shot.impacts) if (!far || im.z > far.z) far = im;
      const end = far || { x: shot.aimX, y: shot.aimY };
      if (kind === 'beam' || kind === 'arc') {
        this._link(kind, m.x - cam.offX, m.y - cam.offY, end.x - cam.offX, end.y - cam.offY, kind === 'beam' ? 0.32 : 0.16);
        if (kind === 'beam') this.sceneFlash = Math.max(this.sceneFlash, this.settings.flashes ? 0.16 : 0);
        return;
      }
      const list = shot.impacts.length ? shot.impacts.slice(0, 3) : [end];
      for (const im of list) this._link(kind, m.x - cam.offX, m.y - cam.offY, im.x - cam.offX, im.y - cam.offY, kind === 'heavy' ? 0.11 : 0.06);
    }

    _link(type, x0, y0, x1, y1, life) {
      const l = this.links.spawn();
      l.type = type;
      l.x0 = x0;
      l.y0 = y0;
      l.x1 = x1;
      l.y1 = y1;
      l.age = 0;
      l.life = life;
      l.seed = Math.random() * 1000;
    }

    _worldLink(from, to, kind) {
      const cam = this.game.camera;
      const a = cam.project(from.x, from.y, from.z, {});
      const b = cam.project(to.x, to.y, to.z, {});
      const type = kind === 'arc' ? 'arc' : kind === 'ricochet' ? 'ricochet' : 'tracer';
      this._link(type, a.sx - cam.offX, a.sy - cam.offY, b.sx - cam.offX, b.sy - cam.offY, type === 'arc' ? 0.2 : 0.12);
      if (type === 'ricochet') this._sparks(b.sx, b.sy, b.s, 3, 0.8);
      if (type === 'arc') this._ring(b.sx, b.sy, b.s * 0.18, 'paper');
    }

    /* ------------------------------------------------------------- explosions */

    _explosion(e) {
      const set = this.settings;
      const s = e.s;
      const R = e.radius * s;
      const big = e.kind !== 'grenade';
      if (set.shake) this.trauma = Math.min(1, this.trauma + (big ? 0.55 : 0.4));
      if (set.flashes) this.sceneFlash = Math.max(this.sceneFlash, big ? 0.3 : 0.22);
      this._world('blast', e.sx, e.sy, { g: 0, life: 0.34, size: R * 0.75 });
      this._world('shock', e.sx, e.sy, { g: 0, life: 0.42, size: R * 1.1 });
      for (let i = 0; i < this._count(16); i++) {
        const a = Math.random() * Math.PI * 2;
        const v = (240 + Math.random() * 520) * U.clamp(s / 90, 0.5, 1.6);
        this._world('ember', e.sx, e.sy, { vx: Math.cos(a) * v, vy: Math.sin(a) * v - 200, g: 1400, drag: 1.5, life: 0.45 + Math.random() * 0.4, size: 1 });
      }
      for (let i = 0; i < this._count(big ? 7 : 5); i++) {
        this._world('billow', e.sx + (Math.random() - 0.5) * R * 0.7, e.sy - Math.random() * R * 0.3, {
          vx: (Math.random() - 0.5) * 50,
          vy: -40 - Math.random() * 70,
          g: -15,
          drag: 0.8,
          life: 1.1 + Math.random() * 0.8,
          size: R * (0.25 + Math.random() * 0.2),
        });
      }
      if (big) {
        for (let i = 0; i < this._count(8); i++) {
          const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.6;
          const v = 260 + Math.random() * 420;
          this._world('chunk', e.sx, e.sy, { vx: Math.cos(a) * v, vy: Math.sin(a) * v - 100, g: 1500, life: 0.9, size: Math.max(3, s * (0.04 + Math.random() * 0.05)), vr: (Math.random() - 0.5) * 18 });
        }
      }
      this._decal({ x: e.x, y: 0.002, z: e.z, surface: 'floor' }, 'scorch', e.radius * 0.45);
    }

    _bossDown(boss) {
      if (!boss) return;
      const cam = this.game.camera;
      const n = 5;
      for (let i = 0; i < n; i++) {
        const x = boss.x + (Math.random() - 0.5) * boss.def.body.w;
        const y = 0.6 + Math.random() * (boss.def.body.h + boss.def.body.base - 0.6);
        this.pending.push({ at: this.t + 0.12 + i * 0.22, fn: () => {
          const p = cam.project(x, y, boss.z, {});
          this._explosion({ x, y, z: boss.z, radius: 1.1 + Math.random() * 0.5, kind: 'boss', sx: p.sx, sy: p.sy, s: p.s });
        } });
      }
      const p = cam.project(boss.x, boss.def.body.base + boss.def.body.h * 0.6, boss.z, {});
      this.pending.push({ at: this.t + 0.3, fn: () => this._label(p.sx, p.sy - 30, 'BOSS DOWN', 'bonus', 1.8) });
    }

    clear() {
      this.particles.clear();
      this.screen.clear();
      this.decals.clear();
      this.labels.clear();
      this.links.clear();
      this.pending.length = 0;
    }

    /* --------------------------------------------------------------- update */

    update(dt) {
      if (dt <= 0) return;
      this.t += dt;
      const step = (p) => {
        p.age += dt;
        if (p.age >= p.life) {
          p.alive = false;
          return;
        }
        p.vy += p.g * dt;
        if (p.drag) {
          p.vx *= Math.exp(-p.drag * dt);
          p.vy *= Math.exp(-p.drag * dt);
        }
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.rot += p.vr * dt;
      };
      this.particles.forEachAlive(step);
      this.screen.forEachAlive(step);
      this.labels.forEachAlive((l) => {
        l.age += dt;
        if (l.age >= l.life) l.alive = false;
      });
      this.decals.forEachAlive((d) => {
        d.age += dt;
      });
      this.links.forEachAlive((l) => {
        l.age += dt;
        if (l.age >= l.life) l.alive = false;
      });
      if (this.pending.length) {
        const due = this.pending.filter((q) => q.at <= this.t);
        if (due.length) {
          this.pending = this.pending.filter((q) => q.at > this.t);
          for (const q of due) q.fn();
        }
      }
      this.hit.age += dt;
      this.crossPulse = Math.max(0, this.crossPulse - dt * 3);
      this.sceneFlash = Math.max(0, this.sceneFlash - dt * 9);
      this.trauma = Math.max(0, this.trauma - dt * 1.9);
      const tr = this.settings.shake ? this.trauma * this.trauma : 0;
      const H = this.game.camera.H;
      const amp = 14 * (H / 1080) * tr;
      this.shakeX = amp * (Math.sin(this.t * 71.3) + Math.sin(this.t * 37.9) * 0.5) * 0.67;
      this.shakeY = amp * (Math.sin(this.t * 63.1 + 1.3) + Math.sin(this.t * 29.3) * 0.5) * 0.67;
    }

    /* ----------------------------------------------------------------- draw */

    drawDecals(ctx) {
      const cam = this.game.camera;
      const q = this._c;
      const dark = cam.range.tone === 'paper';
      this.decals.forEachAlive((d) => {
        cam.project(d.x, d.y, d.z, q);
        const r = d.size * q.s;
        const fade = 1 - U.clamp((d.age - 40) / 10, 0, 1);
        if (fade <= 0) {
          d.alive = false;
          return;
        }
        ctx.save();
        ctx.globalAlpha = fade;
        ctx.translate(q.sx, q.sy);
        if (d.surface === 'floor') ctx.scale(1, 0.35);
        ctx.fillStyle = P.ink;
        if (d.kind === 'scorch') {
          ctx.globalAlpha = fade * 0.8;
          ctx.fillStyle = paint.pattern(ctx, 3, 1.2, dark ? paint.rgba(P.ink, 0.9) : P.ink, 1);
          ctx.beginPath();
          const n = 11;
          for (let k = 0; k <= n; k++) {
            const a = (k / n) * Math.PI * 2;
            const rr = r * (0.75 + 0.3 * Math.sin(d.seed + k * 2.3));
            if (k === 0) ctx.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
            else ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
          }
          ctx.closePath();
          ctx.fill();
          ctx.fillStyle = paint.rgba(P.ink, 0.55);
          ctx.beginPath();
          ctx.arc(0, 0, r * 0.45, 0, Math.PI * 2);
          ctx.fill();
        } else if (d.kind === 'hole') {
          if (dark) {
            ctx.beginPath();
            ctx.arc(0, 0, Math.max(1.8, r * 1.6), 0, Math.PI * 2);
            ctx.fillStyle = paint.rgba(P.paper, 0.35);
            ctx.fill();
            ctx.fillStyle = P.ink;
          }
          ctx.beginPath();
          ctx.arc(0, 0, Math.max(1.2, r), 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = dark ? paint.rgba(P.paper, 0.4) : paint.rgba(P.ink, 0.5);
          ctx.lineWidth = 1;
          ctx.beginPath();
          for (let k = 0; k < 3; k++) {
            const a = d.seed + k * 2.2;
            ctx.moveTo(0, 0);
            ctx.lineTo(Math.cos(a) * r * 2.6, Math.sin(a) * r * 2.6);
          }
          ctx.stroke();
        } else {
          // Ink splat: a blob with a few satellite droplets.
          ctx.beginPath();
          const n = 9;
          for (let k = 0; k <= n; k++) {
            const a = (k / n) * Math.PI * 2;
            const rr = r * (0.7 + 0.35 * Math.sin(d.seed + k * 1.7));
            if (k === 0) ctx.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
            else ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
          }
          ctx.closePath();
          ctx.fillStyle = dark ? paint.rgba(P.paper, 0.4) : paint.rgba(P.ink, 0.78);
          ctx.fill();
          for (let k = 0; k < 5; k++) {
            const a = d.seed * 3 + k * 1.3;
            const dist = r * (1.3 + (k % 3) * 0.35);
            ctx.beginPath();
            ctx.arc(Math.cos(a) * dist, Math.sin(a) * dist, r * (0.08 + (k % 2) * 0.06), 0, Math.PI * 2);
            ctx.fill();
          }
        }
        ctx.restore();
      });
    }

    drawParticles(ctx) {
      const cam = this.game.camera;
      const ox = cam.offX;
      const oy = cam.offY;
      this.particles.forEachAlive((p) => {
        const k = p.age / p.life;
        const x = p.x + ox;
        const y = p.y + oy;
        switch (p.type) {
          case 'spark': {
            const len = 0.022;
            ctx.lineCap = 'round';
            ctx.strokeStyle = P.ink;
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.moveTo(x, y);
            ctx.lineTo(x - p.vx * len, y - p.vy * len);
            ctx.stroke();
            ctx.strokeStyle = P.paperHi;
            ctx.lineWidth = 1.4;
            ctx.stroke();
            break;
          }
          case 'shard': {
            const a = 1 - U.clamp((k - 0.7) / 0.3, 0, 1);
            ctx.save();
            ctx.globalAlpha = a;
            ctx.translate(x, y);
            ctx.rotate(p.rot);
            ctx.beginPath();
            ctx.moveTo(-p.size * 0.5, p.size * 0.4);
            ctx.lineTo(p.size * 0.6, p.size * 0.2 * (p.seed - 0.5));
            ctx.lineTo(-p.size * 0.1, -p.size * 0.7);
            ctx.closePath();
            ctx.fillStyle = P.ink;
            ctx.fill();
            ctx.strokeStyle = P.paper;
            ctx.lineWidth = 1;
            ctx.stroke();
            ctx.restore();
            break;
          }
          case 'drop': {
            ctx.globalAlpha = 1 - k * 0.6;
            ctx.fillStyle = P.ink;
            ctx.beginPath();
            ctx.arc(x, y, p.size, 0, Math.PI * 2);
            ctx.fill();
            ctx.globalAlpha = 1;
            break;
          }
          case 'chunk': {
            const a = 1 - U.clamp((k - 0.75) / 0.25, 0, 1);
            ctx.save();
            ctx.globalAlpha = a;
            ctx.translate(x, y);
            ctx.rotate(p.rot);
            ctx.fillStyle = p.tone === 'paperDim' ? P.paperDim : P.ink;
            ctx.strokeStyle = p.tone === 'paperDim' ? P.ink : P.paper;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(-p.size, -p.size * 0.6);
            ctx.lineTo(p.size * 0.9, -p.size * 0.8);
            ctx.lineTo(p.size * 0.7, p.size * 0.7);
            ctx.lineTo(-p.size * 0.6, p.size * 0.9);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
            ctx.restore();
            break;
          }
          case 'dust': {
            const r = p.size * (0.6 + k * 1.2);
            ctx.save();
            ctx.globalAlpha = 0.55 * (1 - k);
            ctx.fillStyle = paint.pattern(ctx, 3, 0.9, P.graphite, 1);
            ctx.beginPath();
            ctx.arc(x, y, r, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
            break;
          }
          case 'blast': {
            // Starburst: grows fast, then collapses.
            const g = k < 0.25 ? U.easeOutCubic(k / 0.25) : 1 - U.clamp((k - 0.25) / 0.75, 0, 1) * 0.6;
            const R = p.size * g;
            ctx.save();
            ctx.globalAlpha = 1 - U.clamp((k - 0.5) / 0.5, 0, 1);
            ctx.translate(x, y);
            ctx.rotate(p.seed * 6);
            ctx.beginPath();
            const n = 12;
            for (let i = 0; i <= n * 2; i++) {
              const a = (i / (n * 2)) * Math.PI * 2;
              const rr = i % 2 ? R * (0.45 + 0.1 * Math.sin(p.seed * 50 + i)) : R * (0.85 + 0.25 * Math.sin(p.seed * 30 + i));
              if (i === 0) ctx.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
              else ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
            }
            ctx.closePath();
            ctx.fillStyle = P.paperHi;
            ctx.fill();
            ctx.lineWidth = Math.max(2, R * 0.06);
            ctx.strokeStyle = P.ink;
            ctx.stroke();
            ctx.beginPath();
            ctx.arc(0, 0, R * 0.42, 0, Math.PI * 2);
            ctx.fillStyle = paint.pattern(ctx, 4, 1.4, P.ink, 1);
            ctx.globalAlpha *= U.clamp(k * 3, 0, 1);
            ctx.fill();
            ctx.restore();
            break;
          }
          case 'shock': {
            const r = p.size * (0.3 + U.easeOutCubic(k) * 1.1);
            ctx.save();
            ctx.globalAlpha = (1 - k) * 0.9;
            ctx.strokeStyle = P.ink;
            ctx.lineWidth = Math.max(2, 10 * (1 - k));
            ctx.beginPath();
            ctx.ellipse(x, y, r, r * 0.8, 0, 0, Math.PI * 2);
            ctx.stroke();
            ctx.strokeStyle = P.paperHi;
            ctx.lineWidth = Math.max(1, 4 * (1 - k));
            ctx.stroke();
            ctx.restore();
            break;
          }
          case 'ember': {
            const len = 0.03;
            ctx.lineCap = 'round';
            ctx.globalAlpha = 1 - k;
            ctx.strokeStyle = P.ink;
            ctx.lineWidth = 3.5;
            ctx.beginPath();
            ctx.moveTo(x, y);
            ctx.lineTo(x - p.vx * len, y - p.vy * len);
            ctx.stroke();
            ctx.strokeStyle = k < 0.4 ? P.paperHi : P.smoke;
            ctx.lineWidth = 1.6;
            ctx.stroke();
            ctx.globalAlpha = 1;
            break;
          }
          case 'billow': {
            const r = p.size * (0.7 + k * 1.1);
            ctx.save();
            ctx.globalAlpha = 0.75 * (1 - k);
            ctx.fillStyle = paint.pattern(ctx, 4, 1.5, k < 0.2 ? P.graphite : P.ink2, 1);
            ctx.beginPath();
            ctx.arc(x, y, r, 0, Math.PI * 2);
            ctx.arc(x + r * 0.6, y + r * 0.2, r * 0.7, 0, Math.PI * 2);
            ctx.arc(x - r * 0.55, y + r * 0.25, r * 0.6, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
            break;
          }
          case 'ring': {
            const r = p.size * (0.4 + U.easeOutCubic(k) * 0.9);
            ctx.save();
            ctx.globalAlpha = 1 - k;
            ctx.strokeStyle = P.ink;
            ctx.lineWidth = 4;
            ctx.beginPath();
            ctx.arc(x, y, r, 0, Math.PI * 2);
            ctx.stroke();
            ctx.strokeStyle = P.paperHi;
            ctx.lineWidth = 2;
            ctx.stroke();
            ctx.restore();
            break;
          }
          default:
            break;
        }
      });
    }

    drawScreenParticles(ctx) {
      this.screen.forEachAlive((p) => {
        const k = p.age / p.life;
        if (p.type === 'casing') {
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(p.rot);
          ctx.scale(p.size, p.size);
          if (p.kind === 'shell') {
            ctx.fillStyle = P.ink;
            ctx.strokeStyle = P.paper;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.rect(-14, -5, 28, 10);
            ctx.fill();
            ctx.stroke();
            ctx.fillStyle = P.paper;
            ctx.fillRect(7, -5, 7, 10);
          } else if (p.kind === 'rifle') {
            // Bottlenecked rifle brass.
            ctx.fillStyle = P.paperDim;
            ctx.strokeStyle = P.ink;
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(-11, -3.5);
            ctx.lineTo(5, -3.5);
            ctx.lineTo(8, -2);
            ctx.lineTo(12, -2);
            ctx.lineTo(12, 2);
            ctx.lineTo(8, 2);
            ctx.lineTo(5, 3.5);
            ctx.lineTo(-11, 3.5);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
          } else {
            ctx.fillStyle = P.paperDim;
            ctx.strokeStyle = P.ink;
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.rect(-7, -3, 14, 6);
            ctx.fill();
            ctx.stroke();
          }
          ctx.restore();
        } else if (p.type === 'smoke') {
          ctx.save();
          ctx.globalAlpha = 0.35 * (1 - k);
          ctx.fillStyle = paint.pattern(ctx, 3, 0.8, P.smoke, 1);
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size * (0.6 + k), 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }
      });
    }

    drawLabels(ctx) {
      const cam = this.game.camera;
      const ox = cam.offX;
      const oy = cam.offY;
      const H = cam.H;
      const base = Math.max(14, Math.round(H / 1080 * 22));
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineJoin = 'round';
      this.labels.forEachAlive((l) => {
        const k = l.age / l.life;
        const rise = U.easeOutCubic(k) * (l.kind === 'cash' || l.kind === 'bonus' ? 46 : 30);
        const pop = k < 0.12 ? 0.7 + (k / 0.12) * 0.45 : 1.15 - Math.min(0.15, (k - 0.12) * 0.5);
        const alpha = 1 - U.clamp((k - 0.7) / 0.3, 0, 1);
        let size = base;
        let fill = P.paperHi;
        let stroke = P.ink;
        if (l.kind === 'crit') {
          size = base * 1.35;
        } else if (l.kind === 'armor' || l.kind === 'miss') {
          size = base * (l.kind === 'miss' ? 0.9 : 0.8);
          fill = P.smoke;
        } else if (l.kind === 'cash') {
          size = base * 1.05;
        } else if (l.kind === 'bonus' || l.kind === 'callout') {
          size = base * 1.15;
          fill = P.brass;
        }
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.translate(l.x + ox, l.y + oy - rise);
        ctx.scale(pop * l.scale, pop * l.scale);
        ctx.font = '800 ' + Math.round(size) + "px 'Big Shoulders Display', 'Arial Narrow', Impact, sans-serif";
        ctx.lineWidth = Math.max(3, size * 0.22);
        ctx.strokeStyle = stroke;
        ctx.strokeText(l.text, 0, 0);
        ctx.fillStyle = fill;
        ctx.fillText(l.text, 0, 0);
        if (l.kind === 'crit') {
          ctx.strokeStyle = P.ink;
          ctx.lineWidth = 3;
          const w = ctx.measureText(l.text).width / 2 + 6;
          ctx.beginPath();
          ctx.moveTo(-w, size * 0.55);
          ctx.lineTo(w, size * 0.55);
          ctx.stroke();
          ctx.strokeStyle = P.paperHi;
          ctx.lineWidth = 1.5;
          ctx.stroke();
        }
        ctx.restore();
      });
    }

    /** Tracers, beams, arcs and ricochet streaks. */
    drawLinks(ctx) {
      const cam = this.game.camera;
      const ox = cam.offX;
      const oy = cam.offY;
      ctx.save();
      ctx.lineCap = 'round';
      this.links.forEachAlive((l) => {
        const k = l.age / l.life;
        const x0 = l.x0 + ox;
        const y0 = l.y0 + oy;
        const x1 = l.x1 + ox;
        const y1 = l.y1 + oy;
        if (l.type === 'tracer' || l.type === 'heavy' || l.type === 'needle' || l.type === 'ricochet') {
          // A short bright dash that travels from start to end.
          const span = l.type === 'needle' ? 0.12 : l.type === 'heavy' ? 0.5 : 0.28;
          const t1 = U.clamp(k * 1.6, 0, 1);
          const t0 = Math.max(0, t1 - span);
          const ax = x0 + (x1 - x0) * t0;
          const ay = y0 + (y1 - y0) * t0;
          const bx = x0 + (x1 - x0) * t1;
          const by = y0 + (y1 - y0) * t1;
          const w = l.type === 'heavy' ? 4.5 : l.type === 'needle' ? 2 : 3;
          ctx.globalAlpha = 1 - k * 0.5;
          ctx.strokeStyle = P.ink;
          ctx.lineWidth = w + 2.5;
          ctx.beginPath();
          ctx.moveTo(ax, ay);
          ctx.lineTo(bx, by);
          ctx.stroke();
          ctx.strokeStyle = P.paperHi;
          ctx.lineWidth = w;
          ctx.stroke();
        } else if (l.type === 'beam') {
          const w = 16 * (1 - k) + 2;
          ctx.globalAlpha = 1 - k;
          ctx.strokeStyle = P.ink;
          ctx.lineWidth = w + 6;
          ctx.beginPath();
          ctx.moveTo(x0, y0);
          ctx.lineTo(x1, y1);
          ctx.stroke();
          ctx.strokeStyle = P.paperHi;
          ctx.lineWidth = w;
          ctx.stroke();
          // Spiral coil wrapped around the beam.
          const dx = x1 - x0;
          const dy = y1 - y0;
          const len = Math.hypot(dx, dy) || 1;
          const nx = -dy / len;
          const ny = dx / len;
          ctx.strokeStyle = P.ink;
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          const turns = 18;
          for (let i = 0; i <= 120; i++) {
            const t = i / 120;
            const amp = (w * 0.9 + 6) * (1 - t * 0.7);
            const off = Math.sin(t * turns * Math.PI * 2 + l.seed + k * 20) * amp;
            const px = x0 + dx * t + nx * off;
            const py = y0 + dy * t + ny * off;
            if (i === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
          }
          ctx.stroke();
        } else if (l.type === 'arc') {
          // Jagged lightning, re-rolled every few frames.
          const dx = x1 - x0;
          const dy = y1 - y0;
          const len = Math.hypot(dx, dy) || 1;
          const nx = -dy / len;
          const ny = dx / len;
          const seg = Math.max(6, Math.round(len / 22));
          const roll = Math.floor(l.age * 40) + l.seed;
          ctx.globalAlpha = 1 - k * 0.6;
          for (const [c, w] of [
            [P.ink, 6],
            [P.paperHi, 2.4],
          ]) {
            ctx.strokeStyle = c;
            ctx.lineWidth = w;
            ctx.beginPath();
            ctx.moveTo(x0, y0);
            for (let i = 1; i < seg; i++) {
              const t = i / seg;
              const j = Math.sin(roll * 12.9898 + i * 78.233) * 43758.5453;
              const off = (j - Math.floor(j) - 0.5) * Math.min(40, len * 0.18);
              ctx.lineTo(x0 + dx * t + nx * off, y0 + dy * t + ny * off);
            }
            ctx.lineTo(x1, y1);
            ctx.stroke();
          }
        }
      });
      ctx.restore();
    }

    /** Hit marker around the crosshair: subtle for hits, bolder for crits and kills. */
    drawHitmarker(ctx, x, y) {
      const h = this.hit;
      const life = h.kind === 'kill' ? 0.26 : 0.16;
      if (h.age > life) return;
      const k = h.age / life;
      const inner = h.kind === 'crit' ? 9 : 8;
      const outer = h.kind === 'kill' ? 20 : h.kind === 'crit' ? 18 : 14;
      const grow = 1 + k * 0.3;
      ctx.save();
      ctx.translate(x, y);
      ctx.globalAlpha = 1 - k * k;
      ctx.lineCap = 'round';
      for (const pass of [0, 1]) {
        ctx.strokeStyle = pass ? P.paperHi : P.ink;
        ctx.lineWidth = pass ? (h.kind === 'hit' ? 1.6 : 2.4) : h.kind === 'hit' ? 4 : 5.5;
        ctx.beginPath();
        for (let i = 0; i < 4; i++) {
          const a = Math.PI / 4 + (i * Math.PI) / 2;
          ctx.moveTo(Math.cos(a) * inner * grow, Math.sin(a) * inner * grow);
          ctx.lineTo(Math.cos(a) * outer * grow, Math.sin(a) * outer * grow);
        }
        ctx.stroke();
      }
      if (h.kind === 'kill') {
        ctx.strokeStyle = P.ink;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(0, 0, outer * grow + 5, 0, Math.PI * 2);
        ctx.stroke();
        ctx.strokeStyle = P.paperHi;
        ctx.lineWidth = 1.2;
        ctx.stroke();
      }
      ctx.restore();
    }

    counts() {
      return {
        particles: this.particles.countAlive(),
        screen: this.screen.countAlive(),
        decals: this.decals.countAlive(),
        labels: this.labels.countAlive(),
        links: this.links.countAlive(),
        limits: LIMITS,
      };
    }
  }

  FX.LIMITS = LIMITS;
  ZTA.FX = FX;
})(typeof window !== 'undefined' ? window : globalThis);
