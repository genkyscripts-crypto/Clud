/*
 * Weapon controller: trigger, cadence, bursts, ammo, reloads and switching
 * for the three equipped guns.
 *
 * Invariants
 *  - A shot requires: game live, state 'ready', ammo > 0, cadence elapsed.
 *    Ammo is decremented in the same step that fires, so nothing fires twice.
 *  - Magazine-style reloads SET ammo to capacity; shell reloads add one shell
 *    at a time up to capacity. Neither can overfill or duplicate.
 *  - Switching cancels an in-progress reload and starts a draw; each gun keeps
 *    its own ammo, so switching never refills anything.
 *  - Pausing releases the trigger; the player must press again after resuming.
 *  - A started burst finishes even if the trigger is released, but never
 *    beyond the rounds left in the magazine.
 */
(function (root) {
  'use strict';
  const ZTA = root.ZTA;
  const D = ZTA.data;

  const TAP_BUFFER = 0.14;
  const AUTO_RELOAD_DELAY = 0.12;

  class WeaponController {
    constructor(game) {
      this.game = game;
      this.events = game.events;
      this.runtimes = new Map();
      this.time = 0;
      this.state = 'drawing';
      this.stateT = 0;
      this.reloadPhase = null;
      this.phaseT = 0;
      this.trigger = false;
      this.tapBuffer = 0;
      this.nextFire = 0;
      this.burstLeft = 0;
      this.burstIndex = 0;
      this.lastActiveId = this.activeId;
    }

    get slot() {
      return this.game.save.activeSlot;
    }
    get activeId() {
      return this.game.save.equipped[this.game.save.activeSlot];
    }
    get stats() {
      return this.game.statsFor(this.activeId);
    }
    perkOf(st) {
      return ZTA.perks[st.perk.id] || {};
    }

    runtime(id) {
      let rt = this.runtimes.get(id);
      if (!rt) {
        const st = this.game.statsFor(id);
        const perk = ZTA.perks[st.perk.id];
        rt = { id, ammo: st.magazine, bloom: 0, lastShot: -99, heldTime: 0, perkState: perk && perk.initState ? perk.initState() : {} };
        this.runtimes.set(id, rt);
      }
      return rt;
    }
    get active() {
      return this.runtime(this.activeId);
    }

    /** Whether a gun may be used under the current rules (family trials). */
    allowed(id) {
      const fams = this.game.allowedFamilies;
      return !fams || (!!id && fams.indexOf(D.weaponById[id].family) !== -1);
    }

    /* ---------------------------------------------------------------- input */

    pressTrigger() {
      this.trigger = true;
      this.tapBuffer = TAP_BUFFER;
      this.active.heldTime = 0;
      this._fireLoop();
    }
    releaseTrigger() {
      if (this.trigger) {
        const st = this.stats;
        const perk = this.perkOf(st);
        const rt = this.active;
        if (perk.onRelease) perk.onRelease(rt.perkState, st.perk.params);
        rt.heldTime = 0;
      }
      this.trigger = false;
    }
    /** Called on pause/blur: drop any held or buffered input. */
    cancelInput() {
      this.releaseTrigger();
      this.tapBuffer = 0;
      this.burstLeft = 0;
    }

    requestReload() {
      return this.startReload(true);
    }

    switchTo(slot) {
      const eq = this.game.save.equipped;
      if (!(slot >= 0 && slot <= 2) || !eq[slot] || slot === this.slot || !this.allowed(eq[slot])) return false;
      this.releaseTrigger();
      this._cancelReload();
      this.game.save.activeSlot = slot;
      this._beginDraw();
      this.events.emit('weapon:switched', { slot, weaponId: eq[slot] });
      return true;
    }

    cycle(dir) {
      const eq = this.game.save.equipped;
      for (let i = 1; i <= 3; i++) {
        const s = (((this.slot + dir * i) % 3) + 3) % 3;
        if (eq[s] && this.allowed(eq[s])) return this.switchTo(s);
      }
      return false;
    }

    /** Loadout edited, or rules changed: make sure an allowed gun is in hand. */
    onLoadoutChanged() {
      const save = this.game.save;
      if (!save.equipped[save.activeSlot] || !this.allowed(save.equipped[save.activeSlot])) {
        const s = save.equipped.findIndex((id) => id && this.allowed(id));
        save.activeSlot = s === -1 ? save.equipped.findIndex(Boolean) : s;
      }
      if (this.activeId !== this.lastActiveId) {
        this._cancelReload();
        this._beginDraw();
        this.events.emit('weapon:switched', { slot: save.activeSlot, weaponId: this.activeId });
      }
    }

    /** Stats changed (upgrade, normalization): clamp ammo to the new capacity. */
    onStatsChanged(weaponId) {
      for (const [id, rt] of this.runtimes) {
        if (weaponId && id !== weaponId) continue;
        const st = this.game.statsFor(id);
        if (rt.ammo > st.magazine) rt.ammo = st.magazine;
      }
      this._emitAmmo();
    }

    /** Fresh magazines for everything (start of a challenge round). */
    refillAll() {
      for (const [id, rt] of this.runtimes) {
        rt.ammo = this.game.statsFor(id).magazine;
        rt.bloom = 0;
      }
      this._cancelReload();
      this.burstLeft = 0;
      this._emitAmmo();
    }

    /* --------------------------------------------------------------- update */

    update(dt) {
      this.time += dt;
      const st = this.stats;
      const rt = this.active;
      if (this.trigger) rt.heldTime += dt;

      if (this.time - rt.lastShot > st.bloomDelay) rt.bloom = Math.max(0, rt.bloom - st.bloomRecovery * dt);
      this.tapBuffer = Math.max(0, this.tapBuffer - dt);

      if (this.state === 'drawing') {
        this.stateT += dt;
        if (this.stateT >= st.drawTime) this.state = 'ready';
      } else if (this.state === 'reloading') {
        this._updateReload(dt, st, rt);
      }

      if (this.state === 'ready' && rt.ammo <= 0 && this.time - rt.lastShot >= AUTO_RELOAD_DELAY) this.startReload(false);

      if (this.trigger || this.tapBuffer > 0 || this.burstLeft > 0) this._fireLoop();
    }

    _updateReload(dt, st, rt) {
      const r = st.reload;
      this.stateT += dt;
      if (r.style !== 'shell') {
        if (this.stateT >= r.time) {
          rt.ammo = st.magazine;
          this._finishReload(st, rt);
        }
        return;
      }
      this.phaseT += dt;
      if (this.reloadPhase === 'start' && this.phaseT >= r.start) {
        this.phaseT -= r.start;
        this.reloadPhase = 'shell';
      }
      while (this.reloadPhase === 'shell' && this.phaseT >= r.perShell) {
        this.phaseT -= r.perShell;
        if (rt.ammo < st.magazine) {
          rt.ammo += 1;
          this.events.emit('weapon:reloadShell', { weaponId: rt.id, ammo: rt.ammo, magazine: st.magazine });
          this._emitAmmo();
        }
        if (rt.ammo >= st.magazine) {
          this.reloadPhase = 'end';
          this.phaseT = 0;
        }
      }
      if (this.reloadPhase === 'end' && this.phaseT >= r.end) this._finishReload(st, rt);
    }

    startReload(manual) {
      const st = this.stats;
      const rt = this.active;
      if (this.state !== 'ready' || rt.ammo >= st.magazine) return false;
      this.burstLeft = 0;
      this.state = 'reloading';
      this.stateT = 0;
      this.phaseT = 0;
      this.reloadPhase = st.reload.style === 'shell' ? 'start' : null;
      const duration = st.reload.style === 'shell' ? st.reload.start + st.reload.perShell * (st.magazine - rt.ammo) + st.reload.end : st.reload.time;
      this.events.emit('weapon:reloadStart', { weaponId: rt.id, manual: !!manual, style: st.reload.style, duration, empty: rt.ammo <= 0 });
      return true;
    }

    _finishReload(st, rt) {
      this.state = 'ready';
      this.reloadPhase = null;
      const perk = this.perkOf(st);
      if (perk.onReload) perk.onReload(rt.perkState, st.perk.params);
      this.events.emit('weapon:reloadEnd', { weaponId: this.activeId });
      this._emitAmmo();
    }

    _cancelReload() {
      if (this.state === 'reloading') {
        this.state = 'ready';
        this.reloadPhase = null;
        this.events.emit('weapon:reloadCancel', { weaponId: this.activeId });
      }
    }

    _beginDraw() {
      this.state = 'drawing';
      this.stateT = 0;
      this.burstLeft = 0;
      this.lastActiveId = this.activeId;
      this.game.camera.resetKick();
      const st = this.stats;
      const perk = this.perkOf(st);
      if (perk.onSwitchIn) perk.onSwitchIn(this.active.perkState, st.perk.params);
      this._emitAmmo();
    }

    /** Progress 0..1 of the current reload or draw, for the HUD and viewmodel. */
    get progress() {
      const st = this.stats;
      if (this.state === 'drawing') return Math.min(1, this.stateT / st.drawTime);
      if (this.state === 'reloading') {
        if (st.reload.style !== 'shell') return Math.min(1, this.stateT / st.reload.time);
        return Math.min(1, this.active.ammo / st.magazine);
      }
      return 1;
    }

    /* --------------------------------------------------------------- firing */

    _canFire(st, rt) {
      if (!this.game.live || !this.game.canFire()) return false;
      if (rt.ammo <= 0) return false;
      if (!this.allowed(rt.id)) return false;
      if (this.state === 'reloading') {
        if (st.reload.style !== 'shell' || this.reloadPhase === 'start') return false;
        this.state = 'ready';
        this.reloadPhase = null;
        this.events.emit('weapon:reloadCancel', { weaponId: rt.id, interrupted: true });
      }
      if (this.state !== 'ready') return false;
      return this.time >= this.nextFire;
    }

    _fireLoop() {
      const st = this.stats;
      const rt = this.active;
      let guard = 0;
      while (guard++ < 6 && (this.trigger || this.tapBuffer > 0 || this.burstLeft > 0) && this._canFire(st, rt)) this._fireOne(st, rt);
    }

    _fireOne(st, rt) {
      const perk = this.perkOf(st);
      const params = st.perk.params;
      const isBurst = st.burst > 1;
      if (isBurst && this.burstLeft <= 0) {
        this.burstLeft = st.burst;
        this.burstIndex = 0;
      }
      const ammoBefore = rt.ammo;
      rt.ammo -= 1;
      this.tapBuffer = 0;

      const rateMult = perk.fireRateMult ? Math.max(0.05, perk.fireRateMult(rt.perkState, params, { heldTime: rt.heldTime, time: this.time })) : 1;
      let interval;
      if (isBurst) {
        this.burstLeft -= 1;
        interval = this.burstLeft > 0 && rt.ammo > 0 ? 60 / st.burstRpm : (60 / st.rpm) / rateMult;
        if (rt.ammo <= 0) this.burstLeft = 0;
      } else {
        interval = st.interval / rateMult;
      }
      // Keep exact cadence while held; after idling, the next shot is one interval from now.
      this.nextFire = this.time - this.nextFire > interval ? this.time + interval : this.nextFire + interval;
      const sinceLastShot = this.time - rt.lastShot;
      rt.lastShot = this.time;

      if (perk.onFire) {
        perk.onFire(rt.perkState, params, {
          ammoBefore,
          magazine: st.magazine,
          sinceLastShot,
          heldTime: rt.heldTime,
          burstIndex: isBurst ? this.burstIndex : 0,
          burstSize: isBurst ? st.burst : 1,
          time: this.time,
        });
      }
      if (isBurst) this.burstIndex++;

      const shot = ZTA.Ballistics.fire(this.game, rt, st);

      rt.bloom = Math.min(st.bloomMax, rt.bloom + st.bloomPerShot);
      const yaw = (this.game.rng.next() * 2 - 1) * st.recoil.kickX;
      this.game.camera.addKick(st.recoil.kick, yaw);

      this.events.emit('weapon:fired', { weaponId: rt.id, stats: st, ammo: rt.ammo, shot });
      this._emitAmmo();
    }

    _emitAmmo() {
      const st = this.stats;
      const rt = this.active;
      this.events.emit('weapon:ammo', { weaponId: rt.id, ammo: rt.ammo, magazine: st.magazine });
    }

    perkText() {
      const st = this.stats;
      const perk = this.perkOf(st);
      return perk.hudText ? perk.hudText(this.active.perkState, st.perk.params, this.active, this.time, st) : '';
    }
  }

  ZTA.WeaponController = WeaponController;
})(typeof window !== 'undefined' ? window : globalThis);
