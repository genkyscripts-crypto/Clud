/*
 * Runtime targets and range props.
 *
 * A Target is a pooled instance that points at a shared, read-only definition.
 * Its lifecycle is a one-way state machine:
 *
 *   active ──(hp ≤ 0)──▶ breaking ──(animation done)──▶ dead ──▶ back to pool
 *
 * Damage is only accepted while `active`, and the break transition happens
 * exactly once, which is what makes rewards impossible to grant twice.
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
  const APPEAR_TIME = 0.28;
  let nextUid = 1;

  class Target {
    constructor() {
      this.dents = [];
      this.alive = false;
      this.state = 'dead';
    }

    init(def, sp) {
      this.uid = nextUid++;
      this.def = def;
      this.kind = def.shape.type;
      this.hp = def.hp;
      this.maxHp = def.hp;
      this.state = 'active';
      this.rewarded = false;
      this.x = sp.x;
      this.z = sp.z;
      this.baseY = sp.baseY || 0;
      this.scale = sp.scale || 1;
      this.delay = sp.delay || 0;
      this.appear = 0;
      this.swing = 0;
      this.swingVel = 0;
      this.tilt = 0;
      this.tiltVel = 0;
      this.flash = 0;
      this.jolt = 0;
      this.lastHitAge = 99;
      this.hpShown = 1;
      this.dents.length = 0;
      this.dir = sp.dir || 1;
      this.speed = sp.speed || 0;
      this.xMin = sp.xMin == null ? -3 : sp.xMin;
      this.xMax = sp.xMax == null ? 3 : sp.xMax;
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
      this.hitCount = 0;
      this.slotId = sp.slotId || '';
      return this;
    }

    get radius() {
      return this.def.shape.r * this.scale;
    }
    get appearScale() {
      if (this.delay > 0) return 0;
      return U.easeOutBack(U.clamp(this.appear, 0, 1));
    }
    get visible() {
      return this.state !== 'dead' && this.delay <= 0;
    }

    /** Plate center in world space (including swing and break fall). */
    plateCenter(out) {
      const o = out || {};
      const L = CHAIN + this.radius;
      o.x = this.x + Math.sin(this.swing) * L + this.fallX;
      o.y = this.baseY - Math.cos(this.swing) * L + this.fallY;
      return o;
    }

    /** Runner geometry: returns key heights in world meters. */
    runnerGeom(out) {
      const o = out || {};
      const sh = this.def.shape;
      const a = this.state === 'active' ? this.appearScale : 1;
      o.a = Math.max(0.001, a);
      o.pivotY = sh.base;
      o.torsoW = sh.w;
      o.torsoH = sh.h;
      o.headR = sh.headR;
      // Silhouette stands up from the trolley (flip-up target); heights scale by `a`.
      o.torsoBottom = sh.base + 0.04;
      o.torsoTop = o.torsoBottom + sh.h;
      o.torsoMid = (o.torsoBottom + o.torsoTop) / 2;
      o.headY = o.torsoTop + sh.headR + 0.015;
      o.coreY = o.torsoMid + this.def.weak.oy;
      o.coreR = this.def.weak.r;
      o.trolleyW = sh.w * 1.35;
      return o;
    }

    /**
     * Hit test in world coordinates on this target's depth plane.
     * Returns null or { weak } — weak means a critical / weak-point hit.
     */
    hitTest(wx, wy) {
      if (this.state !== 'active' || this.delay > 0) return null;
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
          const wr = r * this.def.weak.r;
          return { weak: d2 <= wr * wr };
        }
        case 'bottle': {
          const w = this.def.shape.w * this.scale;
          const h = this.def.shape.h * this.scale * Math.min(1, a);
          const lx = Math.abs(wx - this.x);
          const ly = wy - this.baseY;
          const margin = 1.15; // small targets get a little generosity
          if (ly < 0 || ly > h) return null;
          if (ly <= h * 0.68) return lx <= (w / 2) * margin ? { weak: false } : null;
          return lx <= w * 0.2 * margin + 0.008 ? { weak: false } : null;
        }
        case 'runner': {
          const g = this.runnerGeom(TMP);
          const lx = wx - this.x;
          if (wy < 0) return null;
          if (wy <= g.pivotY) return Math.abs(lx) <= g.trolleyW / 2 ? { weak: false } : null;
          // Undo the flip-up squash about the pivot.
          const ly = g.pivotY + (wy - g.pivotY) / g.a;
          const cdx = lx;
          const cdy = ly - g.coreY;
          if (cdx * cdx + cdy * cdy <= g.coreR * g.coreR * 1.1) return { weak: true };
          const hdy = ly - g.headY;
          if (cdx * cdx + hdy * hdy <= g.headR * g.headR) return { weak: false };
          if (ly >= g.torsoBottom && ly <= g.torsoTop) {
            // Torso tapers slightly toward the shoulders.
            const t = (ly - g.torsoBottom) / (g.torsoTop - g.torsoBottom);
            const halfW = (g.torsoW / 2) * (1 - 0.18 * t);
            if (Math.abs(lx) <= halfW) return { weak: false };
          }
          return null;
        }
        default:
          return null;
      }
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

      if (this.kind === 'plate') {
        const c = this.plateCenter(TMP);
        const lx = U.clamp((info.wx - c.x) / this.radius, -1, 1);
        const ly = U.clamp((info.wy - c.y) / this.radius, -1, 1);
        this.swingVel += lx * (1.2 + strength * 5);
        this.tiltVel += 3 + strength * 10;
        if (this.dents.length >= 9) this.dents.shift();
        // Store dents in plate-local space so they rotate with the swing.
        this.dents.push({ x: lx, y: ly, s: 0.5 + Math.random() * 0.5, weak: info.weakHits > 0 });
      } else if (this.kind === 'runner') {
        this.jolt = 1;
      }

      if (this.hp <= 0) {
        this.hp = 0;
        this.state = 'breaking';
        this.breakAge = 0;
        this.breakWeak = info.weakHits > 0;
        this.fallVy = 0.6 + Math.random() * 0.6;
        this.fallVx = (Math.random() - 0.5) * 0.8;
        this.fallRotV = (Math.random() - 0.5) * 6;
        this.tiltVel += 8;
        return { broken: true };
      }
      return { broken: false };
    }

    update(dt, events) {
      if (this.delay > 0) {
        this.delay -= dt;
        if (this.delay > 0) return;
        this.delay = 0;
        if (events) events.emit('target:appeared', { target: this });
      }
      this.appear = Math.min(1, this.appear + dt / APPEAR_TIME);
      this.flash = Math.max(0, this.flash - dt * 7);
      this.jolt = Math.max(0, this.jolt - dt * 6);
      this.lastHitAge += dt;
      this.hpShown = U.damp(this.hpShown, this.hp / this.maxHp, 14, dt);

      if (this.kind === 'plate') {
        const L = CHAIN + this.radius;
        this.swingVel += (-GRAVITY / L) * Math.sin(this.swing) * dt;
        this.swingVel *= Math.exp(-1.4 * dt);
        this.swing = U.clamp(this.swing + this.swingVel * dt, -0.7, 0.7);
        if (this.state === 'breaking') {
          // Knocked flat: ease toward lying on its back.
          this.tilt = U.damp(this.tilt, 1.32, 7, dt);
        } else {
          this.tiltVel += -60 * this.tilt * dt;
          this.tiltVel *= Math.exp(-7 * dt);
          this.tilt = U.clamp(this.tilt + this.tiltVel * dt, -0.3, 1.2);
        }
      } else if (this.kind === 'runner') {
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

      if (this.state === 'breaking') {
        this.breakAge += dt;
        if (this.kind === 'plate') {
          this.fallVy -= GRAVITY * 1.2 * dt;
          this.fallY += this.fallVy * dt;
          this.fallX += this.fallVx * dt;
          this.fallRot += this.fallRotV * dt;
          const c = this.plateCenter(TMP);
          if (c.y - this.radius <= 0 && this.fallVy < 0) {
            this.fallY += this.radius - c.y;
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
        } else if (this.kind === 'bottle') {
          if (this.breakAge > 0.02) this.state = 'dead';
        } else if (this.breakAge > 0.75) {
          this.state = 'dead';
        }
      }
    }
  }

  const TMP = {};

  /** Crates and shelves: static range furniture that stops shots but takes no damage. */
  class Prop {
    init(slotId, slot) {
      this.slotId = slotId;
      this.kind = slot.kind;
      this.x = slot.x;
      this.z = slot.z;
      this.w = slot.w;
      this.h = slot.h;
      this.d = slot.d;
      this.zFront = slot.z - slot.d / 2;
      this.appear = 0;
      this.leaving = false;
      this.material = 'wood';
      return this;
    }
    get solid() {
      return !this.leaving && this.appear > 0.5;
    }
    contains(wx, wy) {
      const half = this.w / 2;
      if (this.kind === 'crate') return Math.abs(wx - this.x) <= half && wy >= 0 && wy <= this.h * this.appear;
      if (this.kind === 'shelf') {
        const plankTop = this.h * this.appear;
        if (Math.abs(wx - this.x) <= half && wy <= plankTop && wy >= plankTop - 0.07) return true;
        const legX = half - 0.12;
        return wy >= 0 && wy <= plankTop && (Math.abs(wx - (this.x - legX)) <= 0.035 || Math.abs(wx - (this.x + legX)) <= 0.035);
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
      this.range = range;
      this.pool = new ZTA.CappedPool(range.maxTargets + 4, () => new Target());
      this.props = [];
      this._w = {};
    }

    get list() {
      return this.pool.active;
    }

    spawn(defId, sp) {
      const def = D.targetById[defId];
      if (!def) return null;
      if (this.activeCount() >= this.range.maxTargets) return null;
      const t = this.pool.acquire();
      if (!t) return null;
      return t.init(def, sp);
    }

    /** Targets still standing (breaking ones no longer count). */
    activeCount() {
      let n = 0;
      for (const t of this.pool.active) if (t.state === 'active') n++;
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
      const list = this.pool.active;
      for (let i = list.length - 1; i >= 0; i--) {
        const t = list[i];
        t.update(dt, this.events);
        if (t.state === 'dead') {
          this.events.emit('target:removed', { target: t });
          this.pool.release(t);
        }
      }
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
        if (t.state !== 'active' || t.delay > 0) continue;
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

    clear() {
      this.pool.releaseAll();
      for (const t of this.pool.free) t.state = 'dead';
      this.props.length = 0;
    }
  }

  ZTA.Target = Target;
  ZTA.Prop = Prop;
  ZTA.TargetManager = TargetManager;
  ZTA.TARGET_CHAIN = CHAIN;
})(typeof window !== 'undefined' ? window : globalThis);
