/*
 * Overlay flow: title, pause, settings, armory and the unlock reveal.
 * The simulation is live only when the run has started, no overlay is open
 * and the tab is visible. Every overlay change goes through `sync()`.
 */
(function (root) {
  'use strict';
  const ZTA = root.ZTA;
  const D = ZTA.data;
  const F = ZTA.fmt;

  const $ = (id) => document.getElementById(id);

  class Menus {
    constructor(app) {
      this.app = app;
      this.game = app.game;
      this.audio = app.audio;
      this.el = {
        app: $('app'),
        hud: $('hud'),
        title: $('title'),
        pause: $('pause'),
        settings: $('settings'),
        reveal: $('reveal'),
        pauseStats: $('pause-stats'),
        saveLine: $('save-line'),
        start: $('btn-start'),
        reset: $('btn-reset'),
      };
      this.stack = [];
      this.hidden = false;
      this.revealId = null;
      this._bindTitle();
      this._bindPause();
      this._bindSettings();
      this._bindReveal();
      $('btn-armory').addEventListener('click', () => this.toggleArmory());
      $('btn-menu').addEventListener('click', () => this.open('pause'));
    }

    get started() {
      return this.game.started;
    }
    top() {
      return this.stack[this.stack.length - 1] || null;
    }
    isOpen(id) {
      return this.stack.indexOf(id) !== -1;
    }

    sync() {
      const live = this.started && this.stack.length === 0 && !this.hidden;
      this.game.setLive(live);
      this.el.app.classList.toggle('live', live);
      this.el.hud.hidden = !this.started;
      for (const id of ['pause', 'settings', 'reveal']) this.el[id].hidden = !this.isOpen(id);
      if (this.isOpen('armory')) {
        if (!this.app.armory.isOpen) this.app.armory.open();
      } else if (this.app.armory.isOpen) this.app.armory.close();
    }

    open(id) {
      if (!this.started || this.isOpen(id)) return;
      if (id === 'pause') this._fillPause();
      if (id === 'settings') this._fillSettings();
      this.stack.push(id);
      if (id === 'armory') this.app.hud.onArmoryOpened();
      this.audio.play('ui_click');
      this.sync();
    }

    close(id) {
      const i = this.stack.indexOf(id);
      if (i === -1) return;
      this.stack.splice(i, 1);
      this.sync();
    }

    closeAll() {
      this.stack.length = 0;
      this.sync();
    }

    toggleArmory() {
      if (!this.started) return;
      if (this.isOpen('reveal')) return;
      if (this.isOpen('armory')) this.closeAll();
      else {
        this.stack.length = 0;
        this.open('armory');
      }
    }

    /** Escape walks back one step; from live play it opens the pause menu. */
    back() {
      const t = this.top();
      if (!this.started) return;
      if (!t) return this.open('pause');
      if (t === 'reveal') return this.close('reveal');
      if (t === 'settings') return this.close('settings');
      if (t === 'armory') return this.closeAll();
      if (t === 'pause') return this.close('pause');
    }

    setHidden(h) {
      this.hidden = h;
      if (h && this.started && this.stack.length === 0) this.open('pause');
      this.sync();
    }

    /* ---------------------------------------------------------------- title */

    _bindTitle() {
      const save = this.game.save;
      const owned = save.owned.length;
      if (save.lifetimeCash > 0 || save.stats.shots > 0) {
        this.el.start.textContent = 'Continue';
        this.el.saveLine.textContent =
          F.cash(save.cash) + ' · ' + owned + ' / ' + D.weapons.length + ' guns · ' + F.duration(save.stats.playTime) + ' on the range';
      } else {
        this.el.saveLine.textContent = 'Progress saves automatically in this browser.';
      }
      this.el.start.addEventListener('click', () => this.start());
    }

    start() {
      if (this.started) return;
      this.audio.unlock();
      this.audio.setVolume(this.game.save.settings.volume);
      this.audio.setMuted(this.game.save.settings.muted);
      this.el.title.hidden = true;
      this.game.begin();
      this.sync();
      this.app.hud.refreshAll();
    }

    /* ---------------------------------------------------------------- pause */

    _bindPause() {
      this.el.pause.addEventListener('click', (e) => {
        const b = e.target.closest('[data-action]');
        if (!b) return;
        const a = b.dataset.action;
        if (a === 'resume') this.close('pause');
        else if (a === 'armory') {
          this.stack.length = 0;
          this.open('armory');
        } else if (a === 'settings') this.open('settings');
      });
    }

    _fillPause() {
      const s = this.game.save.stats;
      const acc = s.shots > 0 ? Math.round((s.hits / s.shots) * 100) + '%' : '—';
      this.el.pauseStats.innerHTML =
        '<dt>Waves cleared</dt><dd>' + F.int(s.wavesCleared) + '</dd>' +
        '<dt>Targets broken</dt><dd>' + F.int(s.breaks) + '</dd>' +
        '<dt>Accuracy</dt><dd>' + acc + '</dd>' +
        '<dt>Best combo</dt><dd>' + F.mult(s.bestCombo) + '</dd>' +
        '<dt>Guns collected</dt><dd>' + this.game.save.owned.length + ' / ' + D.weapons.length + '</dd>';
    }

    /* ------------------------------------------------------------- settings */

    _bindSettings() {
      const set = this.game.save.settings;
      const keys = ['shake', 'flashes', 'damageNumbers', 'hitMarkers', 'intenseFx', 'muted'];
      for (const k of keys) {
        $('set-' + k).addEventListener('change', (e) => {
          set[k] = e.target.checked;
          if (k === 'muted') this.audio.setMuted(set.muted);
          this.audio.play('ui_click');
          this.app.requestSave('settings');
        });
      }
      $('set-volume').addEventListener('input', (e) => {
        set.volume = Math.max(0, Math.min(1, Number(e.target.value) / 100));
        this.audio.setVolume(set.volume);
      });
      $('set-volume').addEventListener('change', () => {
        this.audio.play('ui_click');
        this.app.requestSave('settings');
      });
      this.el.settings.addEventListener('click', (e) => {
        const b = e.target.closest('[data-action]');
        if (b && b.dataset.action === 'back') this.close('settings');
      });
      let armedUntil = 0;
      this.el.reset.addEventListener('click', () => {
        const now = Date.now();
        if (now < armedUntil) {
          this.app.resetProgress();
          return;
        }
        armedUntil = now + 4000;
        this.el.reset.classList.add('armed');
        this.el.reset.textContent = 'Click again to erase all progress';
        setTimeout(() => {
          this.el.reset.classList.remove('armed');
          this.el.reset.textContent = 'Reset progress';
        }, 4000);
      });
    }

    _fillSettings() {
      const set = this.game.save.settings;
      for (const k of ['shake', 'flashes', 'damageNumbers', 'hitMarkers', 'intenseFx', 'muted']) $('set-' + k).checked = !!set[k];
      $('set-volume').value = String(Math.round(set.volume * 100));
    }

    /* --------------------------------------------------------------- reveal */

    _bindReveal() {
      this.el.reveal.addEventListener('click', (e) => {
        const b = e.target.closest('[data-action]');
        if (!b) return;
        if (b.dataset.action === 'test') this.app.testGun(this.revealId);
        else this.close('reveal');
      });
    }

    showReveal(id) {
      const def = D.weaponById[id];
      this.revealId = id;
      const c = $('reveal-canvas');
      const ctx = c.getContext('2d');
      ctx.clearRect(0, 0, c.width, c.height);
      ZTA.GunArt.drawFit(ctx, ZTA.GunArt.modelFor(def), c.width, c.height, 'paper', 24, 1);
      $('reveal-maker').textContent = def.manufacturer + ' · ' + D.families[def.family].label + ' · ' + def.caliber;
      $('reveal-name').textContent = def.name;
      const perk = ZTA.perks[def.perk.id];
      $('reveal-perk').textContent = perk.name + ': ' + perk.describe(def.perk.params);
      // Restart the CSS entrance animations.
      for (const el of [c, $('reveal-name')]) {
        el.style.animation = 'none';
        void el.offsetWidth;
        el.style.animation = '';
      }
      this.audio.play('unlock');
      if (!this.isOpen('reveal')) this.stack.push('reveal');
      this.sync();
    }
  }

  ZTA.UI.Menus = Menus;
})(typeof window !== 'undefined' ? window : globalThis);
