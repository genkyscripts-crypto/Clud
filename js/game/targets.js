/*
 * Runtime targets, bosses and range props.
 *
 * A Target is a pooled instance that points at a shared, read-only definition
 * and carries range-scaled hp / armor / value. Its lifecycle is one-way:
 *
 *   active ──(hp ≤ 0)──▶ breaking ──▶ dead ──▶ back to pool
 *   active ──(left the range)──▶ escaping ──▶ dead          (drones, poppers)
 *
 * Damage is only accepted while `active`, and the break transition happens
 * once, which is what makes rewards impossible to grant twice.
 *
 * Geometry is computed in world meters and shared by hit tests and rendering,
 * so what you see is what you hit.
 */
(function (root) {
  'use strict';
  const ZTA = root.ZTA;
  const U = ZTA.util;
  const D = ZTA.data;

  const GRAVITY = 9.8;
  const CHAIN = 0.3; // plate chain length, meters
  const POST = 1.0; // post height for rack plates
  const APPEAR_TIME = 0.28;
  let nextUid = 1;
  const TMP = {};

  class Target {
    constructor() {
      this.dents = [];
      this.alive = false;
      this.state = 'dead';
    }

    /**
     * sp: { x, z, baseY, scale, delay, dir, speed, xMin, xMax, mount, altitude,
     *       uptime, slotId, hp, armor, value, part, boss, hpMult }
     */
    init(def, sp, range) {
      const r = range || D.rangeById[D.START_RANGE];
      this.uid = nextUid++;
      this.def = def;
      this.kind = def.shape.type;
      const hpMult = r.hpMult * (sp.hpMult || 1);
      this.maxHp = (sp.hp != null ? sp.hp : def.hp) * hpMult;
      this.hp = this.maxHp;
      this.armor = (sp.armor != null ? sp.armor : def.armor) * r.hpMult;
      this.value = (sp.value != null ? sp.value : def.value) * r.valueMult;
      this.weak = def.weak;
      this.moving = !!def.moving || this.kind === 'popper';
      this.state = 'active';
      this.rewarded = false;
      this.x = sp.x;
      this.z = sp.z;
      this.baseY = sp.baseY || 0;
      this.scale = sp.scale || 1;
      this.delay = sp.delay || 0;
      this.appear = 0;
      this.mount = sp.mount || 'chain';
      this.swing = 0;
      this.swingVel = 0;
      this.swayAmp = sp.sway ? 0.25 : 0;
      this.tilt = 0;
      this.tiltVel = 0;
      this.flash = 0;
      this.jolt = 0;
      this.lastHitAge = 99;
      this.hpShown = 1;
      this.dents.length = 0;
      this.needles = 0;
      this.dir = sp.dir || 1;
      this.speed = sp.speed || 0;
      this.xMin = sp.xMin == null ? -3 : sp.xMin;
      this.xMax = sp.xMax == null ? 3 : sp.xMax;
      this.altitude = sp.altitude || 2;
      this.uptime = sp.uptime || 3;
      this.upAge = 0;
      this.breakAge = 0;
      this.fallX = 0;
      this.fallY = 0;
      this.fallVx = 0;
      this.fallVy = 0;
      this.fallRot = 0;
      this.fallRotV = 0;
      this.bounced = false;
      this.breakWeak = false;
      this.phase = Math.random() * Math.PI * 2;
      this.age = 0;
      this.hitCount = 0;
      this.slotId = sp.slotId || '';
      this.part = sp.part || null; // boss part definition
      this.boss = sp.boss || null;
      this.offX = 0;
      this.offY = 0;
      return this;
    }

    get radius() {
      return this.def.shape.r * this.scale;
    }
    get appearScale() {
      if (this.delay > 0) return 0;
      if (this.kind === 'popper') return U.clamp(this.appear, 0, 1);
      return U.easeOutBack(U.clamp(this.appear, 0, 1));
    }
    get visible() {
      return this.state !== 'dead' && this.delay <= 0;
    }
    get hittable() {
      return this.state === 'active' && this.delay <= 0;
    }
    /** Shutter and sensor windows: true while the weak point is exposed. */
    get windowOpen() {
      const w = this.weak;
      if (!w || w.type !== 'window') return false;
      const cycle = w.open + w.closed;
      return (this.age + this.phase) % cycle < w.open;
    }

    /* --------------------------------------------------------- geometry */

    plateCenter(out) {
      const o = out || {};
      if (this.mount === 'post') {
        o.x = this.x + this.fallX;
        o.y = POST + this.radius + this.fallY;
        return o;
      }
      const L = CHAIN + this.radius;
      o.x = this.x + Math.sin(this.swing) * L + this.fallX;
      o.y = this.baseY - Math.cos(this.swing) * L + this.fallY;
      return o;
    }

    runnerGeom(out) {
      const o = out || {};
      const sh = this.def.shape;
      const a = this.state === 'active' ? this.appearScale : 1;
      o.a = Math.max(0.001, a);
      o.pivotY = sh.base;
      o.torsoW = sh.w;
      o.torsoH = sh.h;
      o.headR = sh.headR;
      o.torsoBottom = sh.base + 0.04;
      o.torsoTop = o.torsoBottom + sh.h;
      o.torsoMid = (o.torsoBottom + o.torsoTop) / 2;
      o.headY = o.torsoTop + sh.headR + 0.015;
      o.coreY = o.torsoMid + this.weak.oy;
      o.coreR = this.weak.r;
      o.trolleyW = sh.w * 1.35;
      return o;
    }

    /** Center of the target in world space, used for effects and blast distances. */
    center(out) {
      const o = out || {};
      o.z = this.z;
      switch (this.kind) {
        case 'plate':
          return this.plateCenter(o);
        case 'bottle':
          o.x = this.x;
          o.y = this.baseY + this.def.shape.h * this.scale * 0.45;
          return o;
        case 'runner':
          o.x = this.x;
          o.y = this.runnerGeom(TMP).torsoMid;
          return o;
        case 'drone':
          o.x = this.x + this.fallX;
          o.y = this.altitude + this.fallY;
          return o;
        case 'popper': {
          const sh = this.def.shape;
          o.x = this.x;
          o.y = sh.h * 0.55 * this.appearScale;
          return o;
        }
        case 'barrel':
          o.x = this.x;
          o.y = this.def.shape.h * 0.5;
          return o;
        case 'heavy':
        case 'shutter':
          o.x = this.x + this.fallX;
          o.y = this.def.shape.post + this.def.shape.h / 2 + this.fallY;
          return o;
        case 'bosspart':
          o.x = this.x + this.fallX;
          o.y = this.baseY + this.fallY;
          return o;
        default:
          o.x = this.x;
          o.y = this.baseY;
          return o;
      }
    }

    /**
     * Hit test in world coordinates on this target's depth plane.
     * Returns null or { weak } — weak means a critical / weak-point hit.
     */
    hitTest(wx, wy) {
      if (!this.hittable) return null;
      const a = this.appearScale;
      if (a < 0.25) return null;
      switch (this.kind) {
        case 'plate': {
          const c = this.plateCenter(TMP);
          const r = this.radius * Math.min(1, a);
          const squash = Math.max(0.35, Math.cos(this.tilt));
          const dx = wx - c.x;
          const dy = (wy - c.y) / squash;
          const d2 = dx * dx + dy * dy;
          if (d2 > r * r) return null;
          const wr = r * this.weak.r;
          return { weak: d2 <= wr * wr };
        }
        case 'bottle': {
          const w = this.def.shape.w * this.scale;
          const h = this.def.shape.h * this.scale * Math.min(1, a);
          const lx = Math.abs(wx - this.x);
          const ly = wy - this.baseY;
          const margin = 1.15;
          if (ly < 0 || ly > h) return null;
          if (ly <= h * 0.68) return lx <= (w / 2) * margin ? { weak: false } : null;
          return lx <= w * 0.2 * margin + 0.008 ? { weak: false } : null;
        }
        case 'runner': {
          const g = this.runnerGeom(TMP);
          const lx = wx - this.x;
          if (wy < 0) return null;
          if (wy <= g.pivotY) return Math.abs(lx) <= g.trolleyW / 2 ? { weak: false } : null;
          const ly = g.pivotY + (wy - g.pivotY) / g.a;
          const cdy = ly - g.coreY;
          if (lx * lx + cdy * cdy <= g.coreR * g.coreR * 1.1) return { weak: true };
          const hdy = ly - g.headY;
          if (lx * lx + hdy * hdy <= g.headR * g.headR) return { weak: false };
          if (ly >= g.torsoBottom && ly <= g.torsoTop) {
            const t = (ly - g.torsoBottom) / (g.torsoTop - g.torsoBottom);
            if (Math.abs(lx) <= (g.torsoW / 2) * (1 - 0.18 * t)) return { weak: false };
          }
          return null;
        }
        case 'drone': {
          const sh = this.def.shape;
          const lx = wx - this.x;
          const ly = wy - this.altitude;
          if (lx * lx + ly * ly <= this.weak.r * this.weak.r * 1.2) return { weak: true };
          // Body plus the rotor span, a little generous for a fast target.
          if (Math.abs(lx) <= sh.w / 2 + 0.03 && Math.abs(ly) <= sh.h / 2 + 0.04) return { weak: false };
          return null;
        }
        case 'popper': {
          const sh = this.def.shape;
          const h = sh.h * a;
          const lx = Math.abs(wx - this.x);
          const ly = wy;
          if (ly < 0 || ly > h + sh.headR * 2 * a) return null;
          const headY = h + sh.headR * a;
          const hdy = ly - headY;
          if (lx * lx + hdy * hdy <= sh.headR * sh.headR * 1.15) return { weak: true };
          if (ly <= h) {
            const t = ly / h;
            if (lx <= (sh.w / 2) * (1.2 - 0.5 * t)) return { weak: false };
          }
          return null;
        }
        case 'barrel': {
          const sh = this.def.shape;
          const h = sh.h * Math.min(1, a);
          return Math.abs(wx - this.x) <= sh.w / 2 && wy >= 0 && wy <= h ? { weak: false } : null;
        }
        case 'heavy': {
          const sh = this.def.shape;
          const cy = sh.post + sh.h / 2;
          const squash = Math.max(0.35, Math.cos(this.tilt));
          return Math.abs(wx - this.x) <= (sh.w / 2) * a && Math.abs((wy - cy) / squash) <= (sh.h / 2) * a ? { weak: false } : null;
        }
        case 'shutter': {
          const sh = this.def.shape;
          const cy = sh.post + sh.h / 2;
          const lx = wx - this.x;
          const ly = wy - cy;
          if (Math.abs(lx) > (sh.w / 2) * a || Math.abs(ly) > (sh.h / 2) * a) return null;
          const inWindow = lx * lx + ly * ly <= this.weak.r * this.weak.r;
          return { weak: inWindow && this.windowOpen };
        }
        case 'bosspart': {
          const p = this.part;
          const lx = wx - this.x;
          const ly = wy - this.baseY;
          if (p.shape === 'circle') {
            if (lx * lx + ly * ly > p.r * p.r) return null;
          } else if (Math.abs(lx) > p.w / 2 || Math.abs(ly) > p.h / 2) return null;
          if (this.weak && this.weak.type === 'window') return { weak: this.windowOpen };
          return { weak: !!this.weak };
        }
        default:
          return null;
      }
    }

    /** True when a body hit on this target would be reduced by armor. */
    armoredFor(weak) {
      return this.armor > 0 && !(weak && this.weak);
    }

    /**
     * Applies accumulated damage from one shot. Returns null if the target no
     * longer accepts damage, else { broken }.
     * info: { weakHits, wx, wy } — first impact point in world meters.
     */
    applyDamage(amount, info) {
      if (this.state !== 'active') return null;
      if (!(amount > 0)) return { broken: false };
      this.hp -= amount;
      this.hitCount++;
      this.flash = 1;
      this.lastHitAge = 0;
      const strength = U.clamp(amount / this.maxHp, 0.08, 1);
      const wx = info && info.wx != null ? info.wx : this.x;
      const wy = info && info.wy != null ? info.wy : this.baseY;

      if (this.kind === 'plate' || this.kind === 'heavy') {
        const c = this.kind === 'plate' ? this.plateCenter(TMP) : this.center(TMP);
        const size = this.kind === 'plate' ? this.radius : this.def.shape.w / 2;
        const lx = U.clamp((wx - c.x) / size, -1, 1);
        const ly = U.clamp((wy - c.y) / size, -1, 1);
        if (this.mount === 'chain') this.swingVel += lx * (1.2 + strength * 5);
        this.tiltVel += (this.kind === 'heavy' ? 1.5 : 3) + strength * 10;
        if (this.dents.length >= 9) this.dents.shift();
        this.dents.push({ x: lx, y: ly, s: 0.5 + Math.random() * 0.5, weak: info && info.weakHits > 0 });
      } else {
        this.jolt = 1;
        if (this.kind === 'popper') this.tiltVel += 3 + strength * 6;
      }

      if (this.hp <= 0) {
        this.hp = 0;
        this.state = 'breaking';
        this.breakAge = 0;
        this.breakWeak = !!(info && info.weakHits > 0);
        this.fallVy = this.kind === 'drone' ? 0.5 : 0.6 + Math.random() * 0.6;
        this.fallVx = (Math.random() - 0.5) * 0.8;
        this.fallRotV = (Math.random() - 0.5) * 6;
        this.tiltVel += 8;
        return { broken: true };
      }
      return { broken: false };
    }

    /** Ends a target without reward (boss defeated, round over). */
    retire() {
      if (this.state === 'active') {
        this.rewarded = true;
        this.state = 'breaking';
        this.breakAge = 0;
        this.fallVy = 0.4;
        this.fallRotV = (Math.random() - 0.5) * 5;
      }
    }

    update(dt, events) {
      if (this.delay > 0) {
        this.delay -= dt;
        if (this.delay > 0) return;
        this.delay = 0;
        if (events) events.emit('target:appeared', { target: this });
      }
      this.age += dt;
      this.flash = Math.max(0, this.flash - dt * 7);
      this.jolt = Math.max(0, this.jolt - dt * 6);
      this.lastHitAge += dt;
      this.hpShown = U.damp(this.hpShown, this.hp / this.maxHp, 14, dt);

      if (this.kind === 'popper') {
        this._updatePopper(dt, events);
      } else {
        this.appear = Math.min(1, this.appear + dt / APPEAR_TIME);
      }

      if (this.kind === 'plate' || this.kind === 'heavy' || this.kind === 'popper') this._updateSwing(dt);
      if (this.kind === 'runner') this._updateRunner(dt);
      if (this.kind === 'drone') this._updateDrone(dt, events);

      if (this.state === 'breaking') this._updateBreaking(dt, events);
      else if (this.state === 'escaping') {
        this.breakAge += dt;
        if (this.breakAge > 0.4) this.state = 'dead';
      }
    }

    _updateSwing(dt) {
      if (this.kind === 'plate' && this.mount === 'chain') {
        const L = CHAIN + this.radius;
        let force = (-GRAVITY / L) * Math.sin(this.swing);
        if (this.swayAmp && this.state === 'active') force += Math.sin(this.age * 1.6 + this.phase) * this.swayAmp * 6;
        this.swingVel += force * dt;
        this.swingVel *= Math.exp(-1.4 * dt);
        this.swing = U.clamp(this.swing + this.swingVel * dt, -0.7, 0.7);
      }
      if (this.state === 'breaking') {
        this.tilt = U.damp(this.tilt, 1.32, 7, dt);
      } else {
        this.tiltVel += -60 * this.tilt * dt;
        this.tiltVel *= Math.exp(-7 * dt);
        this.tilt = U.clamp(this.tilt + this.tiltVel * dt, -0.3, 1.2);
      }
    }

    _updateRunner(dt) {
      const moving = this.state === 'active' ? 1 : Math.exp(-this.breakAge * 4);
      this.x += this.dir * this.speed * dt * moving * (1 - this.jolt * 0.6);
      const half = this.def.shape.w * 0.7;
      if (this.x > this.xMax - half) {
        this.x = this.xMax - half;
        this.dir = -1;
      } else if (this.x < this.xMin + half) {
        this.x = this.xMin + half;
        this.dir = 1;
      }
    }

    _updateDrone(dt, events) {
      if (this.state !== 'active') return;
      this.x += this.dir * this.speed * dt * (1 - this.jolt * 0.5);
      this.altitude = this.baseY + Math.sin(this.age * 2.1 + this.phase) * 0.18 - this.jolt * 0.06;
      if ((this.dir > 0 && this.x > this.xMax) || (this.dir < 0 && this.x < this.xMin)) this._escape(events);
    }

    _updatePopper(dt, events) {
      if (this.state === 'active') {
        this.upAge += dt;
        if (this.upAge < 0.22) this.appear = this.upAge / 0.22;
        else this.appear = 1;
        if (this.upAge > this.uptime) this._escape(events);
      } else if (this.state === 'escaping') {
        this.appear = Math.max(0, this.appear - dt / 0.22);
      }
    }

    _escape(events) {
      if (this.state !== 'active') return;
      this.state = 'escaping';
      this.breakAge = 0;
      if (events) events.emit('target:escaped', { target: this });
    }

    _updateBreaking(dt, events) {
      this.breakAge += dt;
      switch (this.kind) {
        case 'plate':
        case 'heavy':
        case 'drone':
        case 'bosspart': {
          this.fallVy -= GRAVITY * 1.2 * dt;
          this.fallY += this.fallVy * dt;
          this.fallX += this.fallVx * dt;
          this.fallRot += this.fallRotV * dt;
          const c = this.center(TMP);
          const bottom = this.kind === 'plate' ? this.radius : 0.1;
          if (c.y - bottom <= 0 && this.fallVy < 0) {
            this.fallY += bottom - c.y;
            if (!this.bounced) {
              this.bounced = true;
              this.fallVy = -this.fallVy * 0.28;
              this.fallRotV *= 0.4;
              if (events) events.emit('target:landed', { target: this });
            } else {
              this.fallVy = 0;
              this.fallVx *= 0.8;
            }
          }
          if (this.breakAge > 1.1) this.state = 'dead';
          break;
        }
        case 'popper':
          this.appear = Math.max(0, 1 - this.breakAge / 0.3);
          if (this.breakAge > 0.6) this.state = 'dead';
          break;
        case 'bottle':
        case 'barrel':
          if (this.breakAge > 0.02) this.state = 'dead';
          break;
        default:
          if (this.breakAge > 0.75) this.state = 'dead';
      }
    }
  }

  /**
   * Boss: a moving frame that positions its section targets every frame.
   * The fight ends when the final section (the core) breaks.
   */
  class Boss {
    constructor(def, pad, range, manager, hpMult) {
      this.def = def;
      this.pad = pad;
      this.range = range;
      this.x = 0;
      this.z = pad.z;
      this.dir = 1;
      this.speed = def.speed;
      this.age = 0;
      this.enraged = false;
      this.defeated = false;
      this.defeatAge = 0;
      this.bob = 0;
      // Sections are pooled targets that get recycled after they break, so
      // the boss keeps a uid-checked handle instead of trusting the object.
      this.refs = [];
      for (const p of def.parts) {
        const t = manager.spawn(p.type, { x: p.x, z: this.z + (p.behind ? 0.08 : 0), baseY: p.y, hp: p.hp, armor: p.armor, value: p.value, part: p, boss: this, hpMult }, true);
        if (t) {
          if (p.timed) t.phase = 0;
          this.refs.push({ t, uid: t.uid, part: p });
        }
      }
    }
    /** Section targets that still belong to this boss. */
    get parts() {
      return this.refs.filter((r) => r.t.uid === r.uid && r.t.boss === this).map((r) => r.t);
    }
    /** Sections (other than the core) that are no longer standing. */
    get brokenCount() {
      return this.refs.filter((r) => !r.part.final && (r.t.uid !== r.uid || r.t.state !== 'active')).length;
    }
    partState(partId) {
      const r = this.refs.find((x) => x.part.id === partId);
      if (!r || r.t.uid !== r.uid) return 'gone';
      return r.t.state;
    }
    retireParts() {
      for (const t of this.parts) t.retire();
    }
    update(dt) {
      this.age += dt;
      if (this.defeated) {
        this.defeatAge += dt;
        return;
      }
      if (!this.enraged && this.brokenCount >= this.def.enrage.after) {
        this.enraged = true;
        this.speed = this.def.enrage.speed;
      }
      this.x += this.dir * this.speed * dt;
      const half = this.def.body.w / 2;
      if (this.x > this.pad.xMax - half) {
        this.x = this.pad.xMax - half;
        this.dir = -1;
      } else if (this.x < this.pad.xMin + half) {
        this.x = this.pad.xMin + half;
        this.dir = 1;
      }
      this.bob = this.def.style === 'gantry' ? Math.sin(this.age * 1.3) * 0.12 : Math.sin(this.age * 3) * 0.015;
      for (const t of this.parts) {
        if (t.state !== 'active') continue;
        t.x = this.x + t.part.x;
        t.baseY = t.part.y + this.bob;
      }
    }
  }

  /** Crates, shelves and other range furniture: they stop shots but take no damage. */
  class Prop {
    init(slotId, slot) {
      this.slotId = slotId;
      this.kind = slot.kind;
      this.look = slot.look || (slot.kind === 'crate' ? 'crate' : 'plank');
      this.x = slot.x;
      this.z = slot.z;
      this.w = slot.w;
      this.h = slot.h;
      this.d = slot.d;
      this.zFront = slot.z - slot.d / 2;
      this.appear = 0;
      this.leaving = false;
      this.material = this.look === 'ac' || this.look === 'hood' ? 'steel' : 'wood';
      return this;
    }
    get solid() {
      return !this.leaving && this.appear > 0.5;
    }
    contains(wx, wy) {
      const half = this.w / 2;
      if (this.kind === 'crate') return Math.abs(wx - this.x) <= half && wy >= 0 && wy <= this.h * this.appear;
      if (this.kind === 'shelf') {
        const top = this.h * this.appear;
        if (Math.abs(wx - this.x) <= half && wy <= top && wy >= top - (this.look === 'hood' ? 0.25 : 0.07)) return true;
        const legX = half - 0.12;
        return wy >= 0 && wy <= top && (Math.abs(wx - (this.x - legX)) <= 0.035 || Math.abs(wx - (this.x + legX)) <= 0.035);
      }
      return false;
    }
    update(dt) {
      if (this.leaving) this.appear = Math.max(0, this.appear - dt * 5);
      else this.appear = Math.min(1, this.appear + dt * 4);
    }
  }

  class TargetManager {
    constructor(events, range) {
      this.events = events;
      this.pool = new ZTA.CappedPool(40, () => new Target());
      this.props = [];
      this.boss = null;
      this._w = {};
      this.setRange(range);
    }

    setRange(range) {
      this.range = range;
      this.clear();
    }

    get list() {
      return this.pool.active;
    }

    /** Spawns a target scaled to the current range. Boss parts bypass the per-range cap. */
    spawn(defId, sp, isBossPart) {
      const def = D.targetById[defId];
      if (!def) return null;
      if (!isBossPart && this.activeCount() >= this.range.maxTargets) return null;
      const t = this.pool.acquire();
      if (!t) return null;
      return t.init(def, sp, this.range);
    }

    spawnBoss(bossId, hpMult) {
      const def = D.bossById[bossId];
      const pad = this.range.slots.boss_pad;
      if (!def || !pad) return null;
      this.boss = new Boss(def, pad, this.range, this, hpMult);
      return this.boss;
    }

    /** Targets still standing (breaking or escaping ones no longer count). */
    activeCount() {
      let n = 0;
      for (const t of this.pool.active) if (t.state === 'active') n++;
      return n;
    }
    countIn(slotId) {
      let n = 0;
      for (const t of this.pool.active) if (t.state === 'active' && t.slotId === slotId) n++;
      return n;
    }

    setProps(slotIds) {
      const wanted = new Set(slotIds);
      for (const p of this.props) if (!wanted.has(p.slotId)) p.leaving = true;
      for (const id of wanted) {
        const existing = this.props.find((p) => p.slotId === id);
        if (existing) existing.leaving = false;
        else this.props.push(new Prop().init(id, this.range.slots[id]));
      }
    }

    update(dt) {
      if (this.boss) this.boss.update(dt);
      const list = this.pool.active;
      for (let i = list.length - 1; i >= 0; i--) {
        const t = list[i];
        t.update(dt, this.events);
        if (t.state === 'dead') {
          this.events.emit('target:removed', { target: t });
          this.pool.release(t);
        }
      }
      if (this.boss && this.boss.defeated && this.boss.defeatAge > 2) this.boss = null;
      for (let i = this.props.length - 1; i >= 0; i--) {
        const p = this.props[i];
        p.update(dt);
        if (p.leaving && p.appear <= 0) this.props.splice(i, 1);
      }
    }

    /**
     * All targets under a screen point, nearest first, cut off by the nearest
     * solid prop in front of them. Each hit: { target, weak, z, wx, wy } or
     * { prop, z, wx, wy } for the blocker.
     */
    raycast(px, py, camera) {
      const hits = [];
      const w = this._w;
      for (const t of this.pool.active) {
        if (!t.hittable) continue;
        camera.worldAtZ(px, py, t.z, w);
        const h = t.hitTest(w.x, w.y);
        if (h) hits.push({ target: t, weak: h.weak, z: t.z, wx: w.x, wy: w.y });
      }
      let blocker = null;
      for (const p of this.props) {
        if (!p.solid) continue;
        camera.worldAtZ(px, py, p.zFront, w);
        if (p.contains(w.x, w.y) && (!blocker || p.zFront < blocker.z)) blocker = { prop: p, z: p.zFront, wx: w.x, wy: w.y };
      }
      hits.sort((a, b) => a.z - b.z);
      if (blocker) {
        const kept = hits.filter((h) => h.z < blocker.z);
        kept.push(blocker);
        return kept;
      }
      return hits;
    }

    /** Active targets within `radius` meters of a world point (3D), nearest first. */
    near(x, y, z, radius, exclude) {
      const out = [];
      const c = {};
      for (const t of this.pool.active) {
        if (!t.hittable || t === exclude) continue;
        t.center(c);
        const d = Math.hypot(c.x - x, c.y - y, (c.z - z) * 0.8);
        if (d <= radius) out.push({ target: t, d });
      }
      out.sort((a, b) => a.d - b.d);
      return out;
    }

    /** Retires everything (no rewards): used when a round ends. */
    retireAll() {
      for (const t of this.pool.active) t.retire();
      if (this.boss) this.boss.defeated = true;
    }

    clear() {
      this.pool.releaseAll();
      for (const t of this.pool.free) t.state = 'dead';
      this.props.length = 0;
      this.boss = null;
    }
  }

  ZTA.Target = Target;
  ZTA.Boss = Boss;
  ZTA.Prop = Prop;
  ZTA.TargetManager = TargetManager;
  ZTA.TARGET_CHAIN = CHAIN;
  ZTA.TARGET_POST = POST;
})(typeof window !== 'undefined' ? window : globalThis);
