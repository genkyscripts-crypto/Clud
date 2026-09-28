/*
 * Fixed first-person pinhole camera. Projects world meters to screen pixels
 * and back. Recoil "kick" pitches/yaws the view so shots fired during recoil
 * really land higher; it recovers smoothly at the active weapon's rate.
 *
 * Screen shake is NOT applied here: it moves the whole canvas (world,
 * crosshair and gun together), so it never changes where a shot lands.
 */
(function (root) {
  'use strict';
  const ZTA = root.ZTA;
  const U = ZTA.util;

  const MAX_PITCH = 4.5; // degrees; the background cache margin covers this

  class Camera {
    constructor(range) {
      this.range = range;
      this.eyeH = range.eyeHeight;
      this.kickPitch = 0;
      this.kickYaw = 0;
      this.resize(1280, 720);
    }
    resize(W, H) {
      this.W = W;
      this.H = H;
      this.f = Math.max(240, Math.min(H * 1.25, W * 0.85));
      this.cx = W / 2;
      this.cy = H * 0.42;
    }
    addKick(pitchDeg, yawDeg) {
      this.kickPitch = U.clamp(this.kickPitch + pitchDeg, -MAX_PITCH, MAX_PITCH);
      this.kickYaw = U.clamp(this.kickYaw + yawDeg, -MAX_PITCH, MAX_PITCH);
    }
    update(dt, recovery) {
      const r = recovery || 10;
      this.kickPitch = U.damp(this.kickPitch, 0, r, dt);
      this.kickYaw = U.damp(this.kickYaw, 0, r, dt);
    }
    resetKick() {
      this.kickPitch = 0;
      this.kickYaw = 0;
    }
    get offX() {
      return -Math.tan(U.deg2rad(this.kickYaw)) * this.f;
    }
    get offY() {
      return Math.tan(U.deg2rad(this.kickPitch)) * this.f;
    }
    /** World → screen. `still` ignores recoil (used for static layout checks). */
    project(x, y, z, out, still) {
      const o = out || {};
      const s = this.f / z;
      o.sx = this.cx + x * s + (still ? 0 : this.offX);
      o.sy = this.cy - (y - this.eyeH) * s + (still ? 0 : this.offY);
      o.s = s;
      return o;
    }
    /** Screen point → world point on the plane at depth z. */
    worldAtZ(px, py, z, out) {
      const o = out || {};
      o.x = ((px - this.cx - this.offX) / this.f) * z;
      o.y = this.eyeH - ((py - this.cy - this.offY) / this.f) * z;
      return o;
    }
    /** First static surface (floor, walls, ceiling, back berm) hit by the ray through a screen point. */
    backdropHit(px, py) {
      const r = this.range;
      const dx = (px - this.cx - this.offX) / this.f;
      const dy = -(py - this.cy - this.offY) / this.f;
      let z = r.backZ;
      let surface = 'back';
      if (dy < 0) {
        const zf = this.eyeH / -dy;
        if (zf < z) {
          z = zf;
          surface = 'floor';
        }
      } else if (dy > 0) {
        const zc = (r.ceiling - this.eyeH) / dy;
        if (zc < z) {
          z = zc;
          surface = 'ceiling';
        }
      }
      if (dx !== 0) {
        const zw = r.halfWidth / Math.abs(dx);
        if (zw < z) {
          z = zw;
          surface = 'wall';
        }
      }
      return { x: dx * z, y: this.eyeH + dy * z, z, surface };
    }
  }

  ZTA.Camera = Camera;
})(typeof window !== 'undefined' ? window : globalThis);
