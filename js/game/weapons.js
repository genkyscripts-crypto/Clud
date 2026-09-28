/*
 * Weapon controller: trigger, cadence, ammo, reloads and switching for the
 * three equipped guns.
 *
 * Invariants
 *  - A shot requires: game live, state 'ready', ammo > 0, cadence elapsed.
 *    Ammo is decremented in the same step that fires, so nothing can fire twice.
 *  - Magazine reloads SET ammo to capacity; shell reloads add one shell at a
 *    time up to capacity. Neither can overfill or duplicate.
 *  - Switching cancels an in-progress reload and starts a draw; each gun keeps
 *    its own ammo, so switching never refills anything.
 *  - Pausing releases the trigger; the player must press again after resuming.
 */
(function (root) {
  'use strict';
  const ZTA = root.ZTA;

  const TAP_BUFFER = 0.14; // a click this close to the next allowed shot still fires
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
      this.reloadManual = false;
      this.trigger = false;
      this.tapBuffer = 0;
      this.nextFire = 0;
      this.lastActiveId = this.activeId;
    }

    get slot() {
      return this.game.save.activeSlot;
    }
    get activeId() {
      return this.game.save.equipped[this.game.save.activeSlot];
    }
    get stats() {
      return this.game.progression.stats(this.activeId);
    }

    runtime(id) {
      let rt = this.runtimes.get(id);
      if (!rt) {
        const st = this.game.progression.stats(id);
        const perk = ZTA.perks[st.perk.id];
        rt = { id, ammo: st.magazine, bloom: 0, lastShot: -99, perkState: perk && perk.initState ? perk.initState() : {} };
        this.runtimes.set(id, rt);
      }
      return rt;
    }
    get active() {
      return this.runtime(this.activeId);
    }

    /* ---------------------------------------------------------------- input */

    pressTrigger() {
      this.trigger = true;
      this.tapBuffer = TAP_BUFFER;
      this._fireLoop();
    }
    releaseTrigger() {
      this.trigger = false;
    }
    /** Called on pause/blur: drop any held or buffered input. */
    cancelInput() {
      this.trigger = false;
      this.tapBuffer = 0;
    }

    requestReload() {
      return this.startReload(true);
    }

    switchTo(slot) {
      const eq = this.game.save.equipped;
      if (!(slot >= 0 && slot <= 2) || !eq[slot] || slot === this.slot) return false;
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
        if (eq[s]) return this.switchTo(s);
      }
      return false;
    }

    /** Loadout edited in the armory: follow the active slot if its gun changed. */
    onLoadoutChanged() {
      const save = this.game.save;
      if (!save.equipped[save.activeSlot]) save.activeSlot = save.equipped.findIndex(Boolean);
      if (this.activeId !== this.lastActiveId) {
        this._cancelReload();
        this._beginDraw();
        this.events.emit('weapon:switched', { slot: save.activeSlot, weaponId: this.activeId });
      }
    }

    /** Upgrades may raise magazine size; never lower or overfill current ammo. */
    onStatsChanged(weaponId) {
      const rt = this.runtimes.get(weaponId);
      if (!rt) return;
      const st = this.game.progression.stats(weaponId);
      if (rt.ammo > st.magazine) rt.ammo = st.magazine;
      this._emitAmmo();
    }

    /* --------------------------------------------------------------- update */

    update(dt) {
      this.time += dt;
      const st = this.stats;
      const rt = this.active;

      if (this.time - rt.lastShot > st.bloomDelay) rt.bloom = Math.max(0, rt.bloom - st.bloomRecovery * dt);
      this.tapBuffer = Math.max(0, this.tapBuffer - dt);

      if (this.state === 'drawing') {
        this.stateT += dt;
        if (this.stateT >= st.drawTime) this.state = 'ready';
      } else if (this.state === 'reloading') {
        this._updateReload(dt, st, rt);
      }

      if (this.state === 'ready' && rt.ammo <= 0 && this.time - rt.lastShot >= AUTO_RELOAD_DELAY) this.startReload(false);

      if (this.trigger || this.tapBuffer > 0) this._fireLoop();
    }

    _updateReload(dt, st, rt) {
      const r = st.reload;
      this.stateT += dt;
      if (r.style === 'magazine') {
        if (this.stateT >= r.time) {
          rt.ammo = st.magazine;
          this._finishReload();
        }
        return;
      }
      // Shell-by-shell: start → one shell per interval → end.
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
      if (this.reloadPhase === 'end' && this.phaseT >= r.end) this._finishReload();
    }

    startReload(manual) {
      const st = this.stats;
      const rt = this.active;
      if (this.state !== 'ready' || rt.ammo >= st.magazine) return false;
      this.state = 'reloading';
      this.stateT = 0;
      this.phaseT = 0;
      this.reloadPhase = st.reload.style === 'shell' ? 'start' : null;
      this.reloadManual = !!manual;
      const duration =
        st.reload.style === 'shell' ? st.reload.start + st.reload.perShell * (st.magazine - rt.ammo) + st.reload.end : st.reload.time;
      this.events.emit('weapon:reloadStart', { weaponId: rt.id, manual: !!manual, style: st.reload.style, duration });
      return true;
    }

    _finishReload() {
      this.state = 'ready';
      this.reloadPhase = null;
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
      this.lastActiveId = this.activeId;
      this.game.camera.resetKick();
      this._emitAmmo();
    }

    /** Progress 0..1 of the current reload or draw, for the HUD and viewmodel. */
    get progress() {
      const st = this.stats;
      if (this.state === 'drawing') return Math.min(1, this.stateT / st.drawTime);
      if (this.state === 'reloading') {
        if (st.reload.style === 'magazine') return Math.min(1, this.stateT / st.reload.time);
        const rt = this.active;
        return Math.min(1, rt.ammo / st.magazine);
      }
      return 1;
    }

    /* --------------------------------------------------------------- firing */

    _canFire(st, rt) {
      if (!this.game.live) return false;
      if (rt.ammo <= 0) return false;
      if (this.state === 'reloading') {
        // Shell reloads can be interrupted by firing once a shell is loaded.
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
      while (guard++ < 4 && (this.trigger || this.tapBuffer > 0) && this._canFire(st, rt)) this._fireOne(st, rt);
    }

    _fireOne(st, rt) {
      rt.ammo -= 1;
      this.tapBuffer = 0;
      // Keep exact cadence while held; after idling, the next shot is one interval from now.
      this.nextFire = this.time - this.nextFire > st.interval ? this.time + st.interval : this.nextFire + st.interval;
      rt.lastShot = this.time;

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
      const perk = ZTA.perks[st.perk.id];
      return perk && perk.hudText ? perk.hudText(this.active.perkState, st.perk.params) : '';
    }
  }

  ZTA.WeaponController = WeaponController;
})(typeof window !== 'undefined' ? window : globalThis);
