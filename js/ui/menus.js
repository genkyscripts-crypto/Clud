/*
 * Overlay flow: title, pause, settings, armory, ranges & challenges, round
 * results, prestige (new branch), offline earnings and the unlock reveal.
 * The simulation is live only when the run has started, no overlay is open
 * and the tab is visible. Every overlay change goes through `sync()`.
 */
(function (root) {
  'use strict';
  const ZTA = root.ZTA;
  const D = ZTA.data;
  const F = ZTA.fmt;

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const TK = '<b class="tk-icon" aria-label="Blueprint Tokens"></b>';

  const SIMPLE = ['pause', 'settings', 'reveal', 'results', 'branch', 'offline'];

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
        results: $('results'),
        branch: $('branch'),
        offline: $('offline'),
        pauseStats: $('pause-stats'),
        saveLine: $('save-line'),
        start: $('btn-start'),
        reset: $('btn-reset'),
      };
      this.stack = [];
      this.hidden = false;
      this.revealId = null;
      this.lastResult = null;
      this.pendingOffline = null;
      this.charterPick = null;
      this._bindTitle();
      this._bindPause();
      this._bindSettings();
      this._bindReveal();
      this._bindResults();
      this._bindBranch();
      this._bindOffline();
      $('btn-armory').addEventListener('click', () => this.toggleArmory());
      $('btn-map').addEventListener('click', () => this.toggleMap());
      $('btn-menu').addEventListener('click', () => this.open('pause'));
      $('btn-lanes').addEventListener('click', () => {
        if (this.game.progression.collectLanes() > 0) this.audio.play('lanes');
        else this.audio.play('ui_deny');
      });
      $('ch-quit').addEventListener('click', () => {
        if (this.game.run) {
          this.game.endChallenge();
          this.audio.play('ui_click');
        }
      });
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
      for (const id of SIMPLE) this.el[id].hidden = !this.isOpen(id);
      if (this.isOpen('armory')) {
        if (!this.app.armory.isOpen) this.app.armory.open();
      } else if (this.app.armory.isOpen) this.app.armory.close();
      if (this.isOpen('map')) {
        if (!this.app.map.isOpen) this.app.map.open(this.mapRange);
      } else if (this.app.map.isOpen) this.app.map.close();
    }

    open(id) {
      if (!this.started || this.isOpen(id)) return;
      if (id === 'pause') this._fillPause();
      if (id === 'settings') this._fillSettings();
      this.stack.push(id);
      if (id === 'armory') this.app.hud.onArmoryOpened();
      if (id === 'map') this.app.hud.onMapOpened();
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

    /** Opens one full-screen view in place of whatever is open. */
    only(id) {
      this.stack.length = 0;
      this.open(id);
    }

    toggleArmory(tab) {
      if (!this.started || this.isOpen('reveal') || this.isOpen('results')) return;
      if (this.isOpen('armory')) this.closeAll();
      else {
        if (tab) this.app.armory.tab = tab;
        this.only('armory');
      }
    }

    toggleMap(rangeId) {
      if (!this.started || this.isOpen('reveal') || this.isOpen('branch')) return;
      if (this.isOpen('map') && !rangeId) this.closeAll();
      else {
        this.mapRange = rangeId || null;
        if (this.isOpen('map')) this.app.map.open(rangeId);
        else this.only('map');
      }
    }

    /** Escape walks back one step; from live play it opens the pause menu. */
    back() {
      const t = this.top();
      if (!this.started) return;
      if (!t) return this.open('pause');
      if (t === 'reveal') return this.close('reveal');
      if (t === 'settings') return this.close('settings');
      if (t === 'armory' || t === 'map') return this.closeAll();
      if (t === 'pause') return this.close('pause');
      if (t === 'branch') return this.close('branch');
      if (t === 'offline') return this._collectOffline();
      if (t === 'results') return this._leaveResults('practice');
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
      $('title-eyebrow').textContent = this.game.range.short + ' · ' + (save.prestige.branch ? 'Branch ' + (save.prestige.branch + 1) : 'Practice range');
      if (save.lifetimeCash > 0 || save.stats.shots > 0) {
        this.el.start.textContent = 'Continue';
        this.el.saveLine.textContent = F.cash(save.cash) + ' · ' + owned + ' / ' + D.weapons.length + ' guns · ' + this.game.progression.totalStars() + ' stars · ' + F.duration(save.stats.playTime) + ' on the range';
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
      if (this.pendingOffline) this.showOffline(this.pendingOffline);
    }

    /* ---------------------------------------------------------------- pause */

    _bindPause() {
      this.el.pause.addEventListener('click', (e) => {
        const b = e.target.closest('[data-action]');
        if (!b) return;
        const a = b.dataset.action;
        if (a === 'resume') this.close('pause');
        else if (a === 'armory') this.only('armory');
        else if (a === 'map') this.only('map');
        else if (a === 'branch') this.showBranch();
        else if (a === 'settings') this.open('settings');
      });
    }

    _fillPause() {
      const save = this.game.save;
      const s = save.stats;
      const p = this.game.progression;
      const acc = s.shots > 0 ? Math.round((s.hits / s.shots) * 100) + '%' : '—';
      $('pause-branch').hidden = !p.prestigeAvailable() || !!this.game.run;
      this.el.pauseStats.innerHTML =
        '<dt>Range</dt><dd>' + esc(this.game.range.name) + '</dd>' +
        '<dt>Stars</dt><dd>' + p.totalStars() + ' / ' + D.challenges.length * 3 + '</dd>' +
        '<dt>Targets broken</dt><dd>' + F.int(s.breaks) + '</dd>' +
        '<dt>Accuracy</dt><dd>' + acc + '</dd>' +
        '<dt>Best combo</dt><dd>' + F.mult(s.bestCombo) + '</dd>' +
        '<dt>Guns collected</dt><dd>' + save.owned.length + ' / ' + D.weapons.length + '</dd>' +
        (save.prestige.branch ? '<dt>Branch</dt><dd>' + (save.prestige.branch + 1) + '</dd>' : '');
    }

    /* ------------------------------------------------------------- settings */

    _bindSettings() {
      const set = this.game.save.settings;
      const keys = ['shake', 'flashes', 'damageNumbers', 'hitMarkers', 'intenseFx', 'grain', 'muted'];
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
      for (const k of ['shake', 'flashes', 'damageNumbers', 'hitMarkers', 'intenseFx', 'grain', 'muted']) $('set-' + k).checked = !!set[k];
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
      const n = this.game.save.owned.length;
      $('reveal-eyebrow').textContent = 'New in the armory · ' + n + ' / ' + D.weapons.length;
      $('reveal-maker').textContent = def.manufacturer + ' · ' + D.families[def.family].label + ' · ' + def.caliber;
      $('reveal-name').textContent = def.name;
      const perk = ZTA.perks[def.perk.id];
      $('reveal-perk').textContent = perk.name + ': ' + perk.describe(def.perk.params);
      for (const el of [c, $('reveal-name')]) {
        el.style.animation = 'none';
        void el.offsetWidth;
        el.style.animation = '';
      }
      this.audio.play('unlock');
      if (!this.isOpen('reveal')) this.stack.push('reveal');
      this.sync();
    }

    /* -------------------------------------------------------------- results */

    _bindResults() {
      this.el.results.addEventListener('click', (e) => {
        const b = e.target.closest('[data-action]');
        if (b) this._leaveResults(b.dataset.action);
      });
    }

    _leaveResults(action) {
      const game = this.game;
      const rangeId = game.range.id;
      this.close('results');
      if (action === 'retry' && game.run) {
        game.retryChallenge();
        this.sync();
        return;
      }
      game.endChallenge();
      if (action === 'map') {
        this.mapRange = rangeId;
        this.only('map');
      }
    }

    showResults(e) {
      const def = e.def;
      const s = e.summary;
      const range = D.rangeById[def.range];
      this.lastResult = e;
      $('results-eyebrow').textContent = range.name + (e.mod ? ' · ' + e.mod.name : '') + ' · ' + (e.completed ? 'Round complete' : def.metric === 'bossTime' ? 'Time ran out' : e.livesLeft === 0 ? 'Out of lives' : 'Round over');
      $('results-heading').textContent = def.name;
      let stars = '';
      for (let i = 0; i < 3; i++) stars += '<span class="rstar ' + (i < s.stars ? 'on' : '') + (i >= s.prevStars && i < s.stars ? ' new' : '') + '" style="animation-delay:' + (0.25 + i * 0.28) + 's"></span>';
      $('results-stars').innerHTML = stars;
      const label = ZTA.UI.Hud.METRIC_LABEL[def.metric] || def.metric;
      let val;
      if (def.metric === 'bossTime') val = e.completed ? F.dec(e.value, 1) + ' s' : 'Not finished';
      else val = F.int(e.value) + ' ' + label;
      const next = s.stars < 3 ? (def.metric === 'bossTime' ? 'Next star: finish within ' + def.stars[s.stars] + ' s' : 'Next star at ' + def.stars[s.stars] + ' ' + label) : 'All three stars';
      $('results-value').innerHTML = '<b>' + val + '</b>' + (s.newBest && (def.metric === 'bossTime' ? e.completed : e.value > 0) ? '<span class="newbest">New best</span>' : '') + '<span class="next">' + next + '</span>';
      let rewards = '';
      if (s.cash > 0) rewards += '<span class="rw cash">+' + F.cash(s.cash) + '</span>';
      if (s.blueprints > 0) rewards += '<span class="rw tk">+' + s.blueprints + TK + '</span>';
      if (!rewards) rewards = '<span class="rw none">Earn a star to get paid.</span>';
      $('results-rewards').innerHTML = rewards;
      const m = e.metrics;
      const acc = m.shots > 0 ? Math.round(((m.shots - m.misses) / m.shots) * 100) + '%' : '—';
      $('results-stats').innerHTML =
        '<dt>Breaks</dt><dd>' + F.int(m.breaks) + '</dd>' +
        '<dt>Weak-point breaks</dt><dd>' + F.int(m.weakBreaks) + '</dd>' +
        '<dt>Accuracy</dt><dd>' + acc + '</dd>' +
        (m.escapes ? '<dt>Escaped</dt><dd>' + m.escapes + '</dd>' : '') +
        '<dt>Best</dt><dd>' + (s.best == null ? '—' : def.metric === 'bossTime' ? F.dec(s.best, 1) + ' s' : F.int(s.best)) + '</dd>';
      // Stars chime one after another.
      for (let i = 0; i < s.stars; i++) setTimeout(() => this.audio.play('star', { n: i }), 250 + i * 280);
      if (!s.stars) this.audio.play('fail');
      if (def.boss && e.completed) this.audio.play('boss_down');
      this.stack.length = 0;
      this.stack.push('results');
      this.sync();
    }

    /* --------------------------------------------------------------- branch */

    _bindBranch() {
      this.el.branch.addEventListener('click', (e) => {
        const b = e.target.closest('[data-action]');
        if (!b) return;
        const a = b.dataset.action;
        if (a === 'pick') {
          this.charterPick = b.dataset.id;
          this.audio.play('ui_click');
          this._fillBranch();
        } else if (a === 'cancel') this.close('branch');
        else if (a === 'confirm') {
          if (!this.charterPick) return this.audio.play('ui_deny');
          if (this.game.run) this.game.endChallenge();
          const r = this.game.progression.openBranch(this.charterPick, Date.now());
          if (!r.ok) return this.audio.play('ui_deny');
          this.game.setRange(D.START_RANGE);
          this.game.events.emit('range:changed', { rangeId: D.START_RANGE });
          this.game.weapons.onStatsChanged();
          this.charterPick = null;
          this.audio.play('unlock');
          this.closeAll();
          this.app.hud.toast('<strong>Branch ' + (r.branch + 1) + ' open</strong>A fresh start with a permanent bonus.', 'reward', 4200);
        }
      });
    }

    showBranch() {
      if (!this.game.progression.prestigeAvailable()) return;
      this.charterPick = null;
      this._fillBranch();
      this.stack.length = 0;
      this.stack.push('branch');
      this.audio.play('ui_click');
      this.sync();
    }

    _fillBranch() {
      const pv = this.game.progression.prestigePreview();
      let charters = '';
      for (const c of pv.charters) {
        charters +=
          '<button type="button" class="charter" data-action="pick" data-id="' + c.id + '" aria-pressed="' + (this.charterPick === c.id) + '">' +
          '<b>' + esc(c.name) + '</b><span>' + esc(c.desc) + '</span></button>';
      }
      $('branch-body').innerHTML =
        '<p class="eyebrow accent">Prestige</p><h2 id="branch-heading" class="panel-title">Open a new branch</h2>' +
        '<p class="lede">Sell this shop and open Branch ' + (pv.branch + 1) + '. You start again at Bench Lane with everything below kept, a permanent <b>+' + Math.round(pv.cashBonus * 100) + '% cash</b> bonus, and one charter of your choice.</p>' +
        '<div class="branch-cols"><div><span class="section-label">Resets</span><ul class="resets">' + pv.resets.map((x) => '<li>' + esc(x) + '</li>').join('') + '</ul>' +
        '<p class="note">You give up ' + F.cash(pv.lostCash) + ' in cash.</p></div>' +
        '<div><span class="section-label">Keeps</span><ul class="keeps">' + pv.keeps.map((x) => '<li>' + esc(x) + '</li>').join('') + '</ul></div></div>' +
        (pv.modifier ? '<p class="note">Also unlocks the challenge modifier <b>' + esc(pv.modifier.name) + '</b>: ' + esc(pv.modifier.desc) + ' Double cash and a token for each clear.</p>' : '') +
        '<span class="section-label">Choose a charter (permanent)</span><div class="charters">' + charters + '</div>' +
        '<div class="stack row"><button type="button" class="btn accent" data-action="confirm"' + (this.charterPick ? '' : ' aria-disabled="true"') + '>Open Branch ' + (pv.branch + 1) + '</button>' +
        '<button type="button" class="btn" data-action="cancel">Not yet</button></div>';
    }

    /* -------------------------------------------------------------- offline */

    _bindOffline() {
      this.el.offline.addEventListener('click', (e) => {
        const b = e.target.closest('[data-action]');
        if (b && b.dataset.action === 'collect') this._collectOffline();
      });
    }

    _collectOffline() {
      const got = this.game.progression.collectLanes();
      if (got > 0) this.audio.play('lanes');
      this.pendingOffline = null;
      this.close('offline');
    }

    /** r: { gained, elapsed, capped } from tickLanes on boot. */
    showOffline(r) {
      if (!this.started) {
        this.pendingOffline = r;
        return;
      }
      const p = this.game.progression;
      $('offline-amt').textContent = '+' + F.cash(Math.floor(this.game.save.lanes.stored));
      $('offline-note').textContent =
        'Your training lanes worked for ' + F.duration(r.elapsed) + '.' + (r.capped ? ' They filled up; the Workshop can make them hold more (' + F.int(p.globals().offlineHours) + ' h now).' : '');
      this.pendingOffline = null;
      if (!this.isOpen('offline')) this.stack.push('offline');
      this.sync();
    }
  }

  ZTA.UI.Menus = Menus;
})(typeof window !== 'undefined' ? window : globalThis);
