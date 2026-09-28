/*
 * HUD. Updates from events (cash, tokens, ammo, loadout, combo, waves,
 * challenge rounds, lanes); only the reload bar, the cash count-up tween and
 * the challenge clock run per frame. Also owns the contextual hints that
 * replace a tutorial: each appears once, when relevant, and is remembered.
 */
(function (root) {
  'use strict';
  const ZTA = root.ZTA;
  const D = ZTA.data;
  const F = ZTA.fmt;

  const $ = (id) => document.getElementById(id);

  const HINTS = {
    fire: 'Hold <kbd>Left mouse</kbd> to fire. Break targets for cash.',
    weak: 'Painted center rings are weak points: bigger damage and faster combo.',
    upgrade: 'You can afford an upgrade. Press <kbd>Tab</kbd> to open the armory.',
    reload: 'Reloads are automatic. Press <kbd>R</kbd> to reload early.',
    switch: 'Press <kbd>1</kbd> <kbd>2</kbd> <kbd>3</kbd> or scroll to switch guns.',
    challenge: 'Challenges earn <b>Blueprint Tokens</b> and unlock new ranges. Press <kbd>M</kbd>.',
  };

  const METRIC_LABEL = {
    breaks: 'breaks',
    weakBreaks: 'weak-point breaks',
    droneBreaks: 'drones',
    armorBreaks: 'armored breaks',
    score: 'points',
    bossTime: 'seconds',
  };

  class Hud {
    constructor(game, audio) {
      this.game = game;
      this.audio = audio;
      this.el = {
        root: $('hud'),
        cash: $('hud-cash'),
        bp: $('hud-bp'),
        bpN: $('hud-bp-n'),
        goal: $('hud-goal'),
        goalLabel: $('goal-label'),
        goalName: $('goal-name'),
        goalCost: $('goal-cost'),
        goalFill: $('goal-fill'),
        practice: $('hud-practice'),
        range: $('hud-range'),
        wave: $('hud-wave'),
        pips: $('hud-pips'),
        challenge: $('hud-challenge'),
        chName: $('ch-name'),
        chTime: $('ch-time'),
        chValue: $('ch-value'),
        chMetric: $('ch-metric'),
        chStars: $('ch-stars'),
        chLives: $('ch-lives'),
        countdown: $('countdown'),
        slots: $('hud-slots'),
        combo: $('hud-combo'),
        comboMult: $('combo-mult'),
        comboFill: $('combo-fill'),
        hint: $('hud-hint'),
        ammoCur: $('ammo-cur'),
        ammoMax: $('ammo-max'),
        wname: $('hud-wname'),
        perk: $('hud-perk'),
        reloadFill: $('reload-fill'),
        toasts: $('toasts'),
        btnArmory: $('btn-armory'),
        btnMap: $('btn-map'),
        lanes: $('btn-lanes'),
        lanesAmt: $('lanes-amt'),
      };
      this.shownCash = game.save.cash;
      this.hintKey = null;
      this.hintTimer = 0;
      this.pipsDone = 0;
      this.lastPerk = null;
      this.bodyHitsNoWeak = 0;
      this.lastValue = null;
      this.lastStars = -1;
      this.countT = 0;
      this._buildSlots();
      this._bind(game.events);
      this.refreshAll();
    }

    get flags() {
      return this.game.save.flags.hints;
    }

    _bind(ev) {
      ev.on('cash:changed', (e) => {
        if (e.delta > 0) {
          this.el.cash.classList.add('bump');
          clearTimeout(this._bumpT);
          this._bumpT = setTimeout(() => this.el.cash.classList.remove('bump'), 140);
        } else {
          // Spending snaps the display; only earnings count up.
          this.shownCash = e.cash;
          this.el.cash.textContent = F.cash(e.cash);
        }
        this._goal();
        this._maybeUpgradeHint();
      });
      ev.on('blueprints:changed', (e) => {
        this._tokens();
        if (e.delta > 0) {
          this.el.bp.classList.remove('gain');
          void this.el.bp.offsetWidth;
          this.el.bp.classList.add('gain');
        }
      });
      ev.on('weapon:ammo', (e) => this._ammo(e.ammo, e.magazine));
      ev.on('weapon:switched', () => {
        this._slots();
        this._weapon();
        this._clearHint('switch');
      });
      ev.on('loadout:changed', () => {
        this._slots();
        this._weapon();
        this._maybeSwitchHint();
      });
      ev.on('weapon:unlocked', () => {
        this._goal();
        this._slots();
        this._maybeSwitchHint();
      });
      ev.on('upgrade:bought', () => {
        this._goal();
        this._weapon();
      });
      ev.on('combo:changed', (e) => this._combo(e));
      ev.on('wave:start', (e) => this._waveStart(e));
      ev.on('target:broken', () => this._pipDone());
      ev.on('wave:clear', (e) => {
        const clean = e.clean ? ' <span class="amt">· Clean ×2</span>' : '';
        this.toast('<strong>Wave ' + String(e.index).padStart(2, '0') + ' clear</strong><span class="amt">+' + F.cash(e.bonus) + '</span>' + clean, 'reward', 1800);
        if (e.index >= 4 && !this.flags.challenge && this.game.progression.totalStars() === 0) this.showHint('challenge', 9);
      });
      ev.on('target:hit', (e) => {
        this._clearHint('fire');
        if (e.weak) this._clearHint('weak');
        else if (e.target.def.weak && !e.target.part) this.bodyHitsNoWeak++;
        if (this.bodyHitsNoWeak >= 12 && !this.flags.weak) this.showHint('weak', 7);
      });
      ev.on('weapon:reloadStart', (e) => {
        if (!e.manual && !this.flags.reload) this.showHint('reload', 5);
        if (e.manual) this._clearHint('reload');
      });
      ev.on('range:changed', () => {
        this._rangeLabel();
        this.el.pips.innerHTML = '';
        this.el.wave.textContent = 'Warming up';
      });
      ev.on('range:unlocked', (e) => {
        const r = D.rangeById[e.rangeId];
        this.toast('<strong>Range open · ' + r.name + '</strong>Travel there from the Ranges screen.', 'reward', 4200);
        this._goal();
      });

      // Challenge rounds.
      ev.on('challenge:start', (e) => this._challengeStart(e));
      ev.on('challenge:tick', (e) => this._count(String(e.n)));
      ev.on('challenge:go', () => this._count('GO', true));
      ev.on('challenge:end', () => {
        this.el.countdown.hidden = true;
      });
      ev.on('challenge:exit', () => this._challengeExit());
      ev.on('boss:defeated', () => this.toast('<strong>Boss down</strong>The core is broken.', 'reward', 2600));

      // Long-term progression.
      ev.on('mastery:level', (e) => {
        const def = D.weaponById[e.weaponId];
        this.toast('<strong>Mastery ' + e.level + ' · ' + def.name + '</strong>' + e.label, 'reward', 3600);
      });
      ev.on('objective:done', (e) => {
        const def = D.weaponById[e.weaponId];
        this.toast('<strong>Objective · ' + def.name + '</strong>' + e.text + ' <span class="amt">+1 token</span>', 'reward', 4200);
      });
      ev.on('milestone:reached', (e) => this.toast('<strong>Collection · ' + e.count + ' guns</strong>' + e.label, 'reward', 4600));
      ev.on('lanes:tick', () => this._lanes());
      ev.on('lanes:changed', () => this._lanes());
      ev.on('lanes:collected', (e) => {
        this._lanes();
        if (e.amount > 0) this.toast('<strong>Lanes collected</strong><span class="amt">+' + F.cash(e.amount) + '</span>', 'reward', 1600);
      });
      ev.on('prestige:opened', () => {
        this.refreshAll();
        this.el.pips.innerHTML = '';
      });
    }

    refreshAll() {
      this.el.cash.textContent = F.cash(this.game.save.cash);
      this.shownCash = this.game.save.cash;
      this._tokens();
      this._goal();
      this._slots();
      this._weapon();
      this._rangeLabel();
      this._lanes();
      const rt = this.game.weapons.active;
      this._ammo(rt.ammo, this.game.weapons.stats.magazine);
      this._combo({ mult: this.game.combo.mult, steps: this.game.combo.steps, tierUp: false });
    }

    /* ---------------------------------------------------------------- parts */

    _tokens() {
      this.el.bpN.textContent = F.int(this.game.save.blueprints);
      this.el.bp.hidden = this.game.save.lifetimeBlueprints <= 0;
    }

    _rangeLabel() {
      this.el.range.textContent = this.game.range.name;
    }

    _goal() {
      const g = this.game.progression.nextGoal();
      if (!g) {
        this.el.goal.hidden = true;
        return;
      }
      this.el.goal.hidden = false;
      this.el.goalLabel.textContent = g.kind === 'range' ? 'Next range' : 'Next gun';
      this.el.goalName.textContent = g.name;
      this.el.goalCost.textContent = F.cash(g.cost);
      this.el.goalFill.style.width = Math.round(g.progress * 100) + '%';
      this.el.goal.classList.toggle('affordable', g.progress >= 1 && !g.blocked);
      this.el.goal.classList.toggle('blocked', !!g.blocked);
    }

    _lanes() {
      const p = this.game.progression;
      const show = p.lanesAvailable() && p.laneCount() > 0;
      this.el.lanes.hidden = !show;
      if (!show) return;
      const L = this.game.save.lanes;
      this.el.lanesAmt.textContent = F.cash(Math.floor(L.stored));
      const cap = p.laneCap();
      this.el.lanes.classList.toggle('full', cap > 0 && L.stored >= cap - 1);
      this.el.lanes.classList.toggle('ready', L.stored >= 1);
      this.el.lanes.title = 'Training lanes: ' + F.cash(p.laneRate()) + '/s · holds ' + F.cash(cap) + '. Click to collect.';
    }

    _buildSlots() {
      this.slotEls = [];
      this.el.slots.innerHTML = '';
      for (let i = 0; i < 3; i++) {
        const s = document.createElement('div');
        s.className = 'slot';
        s.innerHTML = '<span class="num">' + (i + 1) + '</span><canvas width="176" height="84"></canvas><span class="lbl"></span>';
        this.el.slots.appendChild(s);
        this.slotEls.push({ el: s, canvas: s.querySelector('canvas'), lbl: s.querySelector('.lbl'), key: undefined });
      }
    }

    _slots() {
      const save = this.game.save;
      const w = this.game.weapons;
      for (let i = 0; i < 3; i++) {
        const s = this.slotEls[i];
        const id = save.equipped[i];
        s.el.classList.toggle('active', i === save.activeSlot);
        s.el.classList.toggle('empty', !id);
        s.el.classList.toggle('barred', !!id && !w.allowed(id));
        const key = id ? id + '|' + this.game.progression.finishOf(id) : null;
        if (s.key === key) continue;
        s.key = key;
        const ctx = s.canvas.getContext('2d');
        ctx.clearRect(0, 0, s.canvas.width, s.canvas.height);
        if (id) {
          const def = D.weaponById[id];
          ZTA.GunArt.drawFit(ctx, ZTA.GunArt.modelFor(def), s.canvas.width, s.canvas.height, 'paper', 8, 1);
          s.lbl.textContent = def.name;
        } else {
          s.lbl.textContent = 'Empty';
        }
      }
    }

    _weapon() {
      const def = D.weaponById[this.game.weapons.activeId];
      this.el.wname.textContent = def.name;
      const st = this.game.weapons.stats;
      this._ammo(this.game.weapons.active.ammo, st.magazine);
    }

    _ammo(ammo, mag) {
      this.el.ammoCur.textContent = String(ammo);
      this.el.ammoMax.textContent = '/ ' + mag;
      this.el.ammoCur.classList.toggle('low', ammo > 0 && ammo <= Math.max(1, Math.floor(mag * 0.2)));
    }

    _combo(e) {
      const on = e.mult > 1.001;
      this.el.combo.classList.toggle('on', on);
      this.el.comboMult.textContent = '×' + e.mult.toFixed(1);
      const c = this.game.combo;
      const max = c.maxSteps || c.cfg.maxSteps;
      this.el.comboFill.style.width = Math.round((Math.min(e.steps, max) / max) * 100) + '%';
      if (e.tierUp) {
        this.el.combo.classList.add('tier-up');
        clearTimeout(this._tierT);
        this._tierT = setTimeout(() => this.el.combo.classList.remove('tier-up'), 180);
      }
    }

    _waveStart(e) {
      this.el.wave.textContent = 'Wave ' + String(e.index).padStart(2, '0');
      this.el.pips.innerHTML = '';
      for (let i = 0; i < e.count; i++) this.el.pips.appendChild(document.createElement('i'));
      this.pipsDone = 0;
      for (const type of e.newTypes || []) {
        const cap = D.introCaptions[type];
        if (cap) this.toast('<strong>New · ' + cap.title + '</strong>' + cap.text, 'new', 4200);
      }
      if (e.index === 1 && !this.flags.fire) this.showHint('fire', 0);
    }

    _pipDone() {
      if (this.game.run) return;
      const pip = this.el.pips.children[this.pipsDone];
      if (pip) pip.classList.add('done');
      this.pipsDone++;
    }

    /* ------------------------------------------------------------ challenges */

    _challengeStart(e) {
      const def = e.def;
      this.el.practice.hidden = true;
      this.el.challenge.hidden = false;
      this.el.chName.textContent = def.name + (e.mod ? ' · ' + e.mod.name : '');
      this.el.chMetric.textContent = METRIC_LABEL[def.metric] || def.metric;
      this.lastValue = null;
      this.lastStars = -1;
      let stars = '';
      for (let i = 0; i < 3; i++) {
        const need = def.stars[i];
        stars += '<span class="st" data-i="' + i + '"><i></i><em>' + (def.metric === 'bossTime' ? '≤' + need + 's' : need) + '</em></span>';
      }
      this.el.chStars.innerHTML = stars;
      this.el.chLives.hidden = !def.lives;
      this._count(String(ZTA.ChallengeRun.COUNTDOWN));
      if (e.autoEquipped) this.toast('<strong>Loadout</strong>' + D.weaponById[e.autoEquipped].name + ' equipped for this trial.', 'new', 3000);
      this._slots();
      this._rangeLabel();
    }

    _challengeExit() {
      this.el.practice.hidden = false;
      this.el.challenge.hidden = true;
      this.el.countdown.hidden = true;
      this.el.pips.innerHTML = '';
      this.el.wave.textContent = 'Warming up';
      this._slots();
    }

    _count(text, go) {
      const c = this.el.countdown;
      c.textContent = text;
      c.hidden = false;
      c.classList.toggle('go', !!go);
      c.style.animation = 'none';
      void c.offsetWidth;
      c.style.animation = '';
      this.countT = go ? 0.7 : 1.2;
    }

    _challengeFrame(dt) {
      const run = this.game.run;
      if (!run) return;
      const def = run.def;
      const t = def.metric === 'bossTime' ? run.elapsed : run.timeLeft;
      this.el.chTime.textContent = t.toFixed(1);
      this.el.chTime.classList.toggle('low', def.metric !== 'bossTime' && run.state === 'running' && run.timeLeft < 10);
      const v = def.metric === 'bossTime' ? (run.bossDefeated ? run.bossTime : null) : run.value;
      if (v !== this.lastValue) {
        this.lastValue = v;
        this.el.chValue.textContent = v == null ? '—' : String(v);
      }
      const stars = run.liveStars;
      if (stars !== this.lastStars) {
        const gained = stars > this.lastStars && this.lastStars >= 0;
        this.lastStars = stars;
        for (const s of this.el.chStars.children) {
          const on = Number(s.dataset.i) < stars;
          s.classList.toggle('on', on);
        }
        if (gained && def.metric !== 'bossTime') this.audio.play('star', { n: stars });
      }
      if (def.metric === 'bossTime') {
        // Stars drop as the clock passes each threshold.
        for (const s of this.el.chStars.children) s.classList.toggle('lost', run.elapsed > def.stars[Number(s.dataset.i)]);
      }
      if (def.lives) {
        let h = '';
        for (let i = 0; i < def.lives; i++) h += '<i class="' + (i < run.livesLeft ? 'on' : '') + '"></i>';
        if (this._livesHtml !== h) {
          this._livesHtml = h;
          this.el.chLives.innerHTML = h;
        }
      }
      if (this.countT > 0) {
        this.countT -= dt;
        if (this.countT <= 0 && run.state === 'running') this.el.countdown.hidden = true;
      }
    }

    /* ---------------------------------------------------------------- hints */

    showHint(key, seconds) {
      if (this.flags[key]) return;
      this.hintKey = key;
      this.hintTimer = seconds || 0;
      this.el.hint.innerHTML = HINTS[key];
      this.el.hint.hidden = false;
      if (key === 'upgrade') this.el.btnArmory.classList.add('ready');
      if (key === 'challenge') this.el.btnMap.classList.add('ready');
    }

    /** Marks a hint as learned and hides it if it is on screen. */
    _clearHint(key) {
      this.flags[key] = true;
      if (this.hintKey === key) {
        this.hintKey = null;
        this.el.hint.hidden = true;
      }
      if (key === 'upgrade') this.el.btnArmory.classList.remove('ready');
      if (key === 'challenge') this.el.btnMap.classList.remove('ready');
    }

    onArmoryOpened() {
      this._clearHint('upgrade');
      this.el.btnArmory.classList.remove('ready');
    }

    onMapOpened() {
      this._clearHint('challenge');
    }

    _maybeUpgradeHint() {
      if (this.flags.upgrade) return;
      const p = this.game.progression;
      if (this.game.save.cash >= p.cheapestPurchase(this.game.range)) {
        if (this.hintKey === null || this.hintKey === 'fire') this.showHint('upgrade', 0);
        else this.el.btnArmory.classList.add('ready');
      }
    }

    _maybeSwitchHint() {
      const filled = this.game.save.equipped.filter(Boolean).length;
      if (filled >= 2 && !this.flags.switch) this.showHint('switch', 8);
    }

    toast(html, kind, ms) {
      const t = document.createElement('div');
      t.className = 'toast ' + (kind || '');
      t.innerHTML = html;
      this.el.toasts.appendChild(t);
      while (this.el.toasts.children.length > 3) this.el.toasts.firstElementChild.remove();
      setTimeout(() => {
        t.classList.add('leaving');
        setTimeout(() => t.remove(), 280);
      }, ms || 2000);
    }

    /* ---------------------------------------------------------------- frame */

    frame(dt, live) {
      const cash = this.game.save.cash;
      if (this.shownCash !== cash) {
        const diff = cash - this.shownCash;
        const step = Math.max(1, Math.abs(diff) * Math.min(1, dt * 12));
        this.shownCash = Math.abs(diff) <= step ? cash : this.shownCash + Math.sign(diff) * step;
        this.el.cash.textContent = F.cash(Math.round(this.shownCash));
      }
      const w = this.game.weapons;
      const busy = w.state === 'reloading' || w.state === 'drawing';
      const p = busy ? w.progress : w.active.ammo / w.stats.magazine;
      this.el.reloadFill.style.transform = 'scaleX(' + p.toFixed(3) + ')';
      this.el.reloadFill.style.opacity = busy ? '1' : '0.45';

      const perk = w.perkText();
      if (perk !== this.lastPerk) {
        this.lastPerk = perk;
        this.el.perk.hidden = !perk;
        this.el.perk.textContent = perk;
      }
      if (this.game.run) this._challengeFrame(live ? dt : 0);
      if (live && this.hintKey && this.hintTimer > 0) {
        this.hintTimer -= dt;
        if (this.hintTimer <= 0) this._clearHint(this.hintKey);
      }
    }
  }

  Hud.METRIC_LABEL = METRIC_LABEL;
  ZTA.UI.Hud = Hud;
})(typeof window !== 'undefined' ? window : globalThis);
