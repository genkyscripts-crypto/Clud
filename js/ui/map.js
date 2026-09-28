/*
 * Ranges & challenges: the five maps as a route, each with a live preview
 * painted by its own theme, its unlock requirements, and the challenge board
 * for that range. Every requirement and reward is shown before starting.
 */
(function (root) {
  'use strict';
  const ZTA = root.ZTA;
  const D = ZTA.data;
  const F = ZTA.fmt;

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const TYPE_LABEL = {
    clear: 'Clear',
    precision: 'Precision',
    family: 'Family trial',
    combo: 'Combo',
    boss: 'Boss',
    drones: 'Drones',
    endurance: 'Endurance',
    chain: 'Chain',
    armor: 'Armor',
    rack: 'Penetration',
  };

  /** Targets each range introduces (for the detail panel). */
  function rangeTargets(r) {
    const seen = new Set();
    const add = (t) => seen.add(t);
    for (const w of r.intro) for (const s of w.spawns) add(s.type);
    for (const w of r.pool) for (const s of w.spawns) add(s.type);
    return Array.from(seen).map((id) => D.targetById[id]).filter(Boolean);
  }

  class MapScreen {
    constructor(game, audio, hooks) {
      this.game = game;
      this.audio = audio;
      this.hooks = hooks;
      this.el = document.getElementById('map');
      this.body = document.getElementById('map-body');
      this.sub = document.getElementById('map-sub');
      this.cashEl = document.getElementById('map-cash');
      this.bpEl = document.getElementById('map-bp');
      this.selected = game.range.id;
      this.mods = {};
      this.previews = new Map();
      this.el.addEventListener('click', (e) => this._click(e));
      this.el.addEventListener('change', (e) => {
        const sel = e.target.closest('select[data-mod-for]');
        if (sel) this.mods[sel.dataset.modFor] = sel.value || null;
      });
      game.events.on('cash:changed', () => {
        if (this.isOpen) this.render();
      });
    }

    get isOpen() {
      return !this.el.hidden;
    }

    open(rangeId) {
      this.selected = rangeId || this.game.range.id;
      this.el.hidden = false;
      this.render();
    }

    close() {
      this.el.hidden = true;
    }

    /* ------------------------------------------------------------- previews */

    _preview(range) {
      let c = this.previews.get(range.id);
      if (c) return c;
      const W = 480;
      const H = 240;
      const cam = new ZTA.Camera(range);
      cam.resize(W, H);
      const bg = new ZTA.Background();
      bg.build(cam, W, H, 1);
      c = document.createElement('canvas');
      c.width = W;
      c.height = H;
      const g = c.getContext('2d');
      bg.draw(g, 0, 0);
      this.previews.set(range.id, c);
      return c;
    }

    _paintPreviews() {
      for (const c of this.body.querySelectorAll('canvas[data-preview]')) {
        const r = D.rangeById[c.dataset.preview];
        const img = this._preview(r);
        const g = c.getContext('2d');
        g.drawImage(img, 0, 0, c.width, c.height);
      }
    }

    /* --------------------------------------------------------------- render */

    render() {
      const game = this.game;
      const p = game.progression;
      const save = game.save;
      this.cashEl.textContent = F.cash(save.cash);
      this.bpEl.querySelector('b').textContent = F.int(save.blueprints);
      const stars = p.totalStars();
      const maxStars = D.challenges.length * 3;
      this.sub.innerHTML = '<span>' + stars + ' / ' + maxStars + ' stars</span>' + (save.prestige.branch ? '<span>Branch ' + (save.prestige.branch + 1) + '</span>' : '');
      this.body.innerHTML = this._routeHtml() + this._detailHtml();
      this._paintPreviews();
    }

    _routeHtml() {
      const p = this.game.progression;
      let html = '<nav class="route" aria-label="Ranges">';
      for (const r of D.ranges) {
        const st = p.rangeStatus(r.id);
        const list = D.challenges.filter((c) => c.range === r.id);
        const got = list.reduce((n, c) => n + p.challengeStars(c.id), 0);
        const here = r.id === this.game.range.id;
        let status;
        if (here) status = '<span class="rs here">You are here</span>';
        else if (st.unlocked) status = '<span class="rs open">Open</span>';
        else if (!st.previousUnlocked) status = '<span class="rs locked">Locked</span>';
        else if (!st.requirementMet) status = '<span class="rs locked">Needs ★' + st.requirement.stars + ' ' + esc(st.requirement.name) + '</span>';
        else status = '<span class="rs ' + (st.affordable ? 'ready' : 'locked') + '">' + F.cash(st.cost) + '</span>';
        html +=
          '<button type="button" class="route-card ' + (r.id === this.selected ? 'selected' : '') + (st.unlocked ? '' : ' is-locked') + '" data-action="select" data-id="' + r.id + '" aria-pressed="' + (r.id === this.selected) + '">' +
          '<canvas width="240" height="120" data-preview="' + r.id + '" aria-hidden="true"></canvas>' +
          '<span class="rn"><em>' + String(r.index).padStart(2, '0') + '</em>' + esc(r.name) + '</span>' +
          '<span class="rmeta"><span class="rstars">★ ' + got + ' / ' + list.length * 3 + '</span>' + status + '</span>' +
          '</button>';
      }
      return html + '</nav>';
    }

    _detailHtml() {
      const game = this.game;
      const p = game.progression;
      const r = D.rangeById[this.selected];
      const st = p.rangeStatus(r.id);
      const here = r.id === game.range.id;
      let html = '<section class="range-sheet" aria-label="' + esc(r.name) + '">';
      html +=
        '<div class="rs-head"><div><p class="maker">Range ' + String(r.index).padStart(2, '0') + ' · ' + (r.tone === 'paper' ? 'Night / low light' : 'Lit range') + '</p>' +
        '<h3>' + esc(r.name) + '</h3><p class="blurb">' + esc(r.blurb) + '</p></div>' +
        '<dl class="rs-facts"><dt>Target toughness</dt><dd>×' + F.int(r.hpMult) + '</dd><dt>Target pay</dt><dd>×' + F.int(r.valueMult) + '</dd><dt>Guns sold here</dt><dd>Tier ' + r.index + '</dd></dl></div>';
      html += '<div class="rs-targets"><span class="section-label">Targets</span><div class="tags">';
      for (const t of rangeTargets(r)) html += '<span class="tag' + (t.armor ? ' solid' : '') + '">' + esc(t.short) + (t.armor ? ' · armor ' + F.int(t.armor * r.hpMult) : '') + '</span>';
      html += '</div></div>';

      // Travel / unlock.
      html += '<div class="rs-actions">';
      if (st.unlocked) {
        if (here) html += '<span class="rs-here">You are practicing here.</span><button type="button" class="btn" data-action="close">Back to practice</button>';
        else html += '<button type="button" class="btn primary" data-action="travel" data-id="' + r.id + '">Travel here</button>';
      } else {
        const need = [];
        if (!st.previousUnlocked) need.push('Open ' + esc(D.ranges[r.index - 2].name) + ' first');
        if (st.requirement) need.push((st.requirementMet ? '✓ ' : '') + '★' + st.requirement.stars + ' on ' + esc(st.requirement.name) + ' (' + esc(D.rangeById[D.challengeById[st.requirement.challenge].range].name) + ')');
        need.push((st.affordable ? '✓ ' : '') + F.cash(st.cost));
        const ready = st.previousUnlocked && st.requirementMet;
        html +=
          '<div class="unlock-need"><span class="section-label">To open this range</span><ul>' + need.map((n) => '<li>' + n + '</li>').join('') + '</ul></div>' +
          '<button type="button" class="btn ' + (ready && st.affordable ? 'accent' : '') + '" data-action="unlock-range" data-id="' + r.id + '" aria-disabled="' + !(ready && st.affordable) + '">Open for ' + F.cash(st.cost) + '</button>';
      }
      html += '</div>';

      // Challenge board.
      html += '<div class="board"><span class="section-label">Challenges · Blueprint Tokens for each new star</span><div class="board-grid">';
      const mods = p.modifiersUnlocked();
      for (const c of D.challenges.filter((x) => x.range === r.id)) html += this._challengeCard(c, mods);
      html += '</div></div>';

      if (p.prestigeAvailable()) {
        html +=
          '<div class="branch-banner"><div><b>Open a new branch</b><span>Start over with a permanent bonus. Your guns, mastery and tokens stay.</span></div>' +
          '<button type="button" class="btn accent" data-action="branch">Open a new branch</button></div>';
      }
      return html + '</section>';
    }

    _challengeCard(c, mods) {
      const p = this.game.progression;
      const status = p.challengeStatus(c.id);
      const rec = this.game.save.challenges[c.id];
      const got = rec ? rec.stars : 0;
      const boss = c.boss ? D.bossById[c.boss] : null;
      let stars = '';
      for (let i = 0; i < 3; i++) {
        const need = c.metric === 'bossTime' ? '≤ ' + c.stars[i] + ' s' : c.stars[i] + ' ' + (ZTA.UI.Hud.METRIC_LABEL[c.metric] || c.metric);
        stars += '<li class="' + (i < got ? 'on' : '') + '"><i></i><span>' + need + '</span><em>+' + c.reward.blueprints[i] + '<b class="tk-icon" aria-label="Blueprint Tokens"></b></em></li>';
      }
      const best = rec && rec.best != null ? (c.metric === 'bossTime' ? F.dec(rec.best, 1) + ' s' : F.int(rec.best)) : '—';
      const range = D.rangeById[c.range];
      const cash = c.reward.cash * range.valueMult;
      let rules = F.int(c.duration) + ' s';
      if (c.families) rules += ' · ' + c.families.map((f) => D.families[f].plural).join(' / ') + ' only';
      if (c.normalized) rules += ' · equal footing';
      if (c.lives) rules += ' · ' + c.lives + ' lives';
      if (boss) rules += ' · ' + boss.parts.length + ' sections';
      let modSel = '';
      if (mods.length && status.ok) {
        modSel =
          '<label class="mod-pick"><span>Modifier</span><select data-mod-for="' + c.id + '"><option value="">None</option>' +
          mods.map((m) => '<option value="' + m.id + '"' + (this.mods[c.id] === m.id ? ' selected' : '') + '>' + esc(m.name) + ' — ' + esc(m.desc) + ' (×' + m.rewardMult + ' cash' + (rec && rec.modStars && rec.modStars[m.id] ? '' : ', +1 token') + ')</option>').join('') +
          '</select></label>';
      }
      return (
        '<article class="ch-card ' + (status.ok ? '' : 'locked') + (c.boss ? ' boss' : '') + '">' +
        '<header><span class="ch-type">' + (TYPE_LABEL[c.type] || c.type) + '</span><h4>' + esc(c.name) + '</h4></header>' +
        '<p class="ch-desc">' + esc(c.desc) + '</p>' +
        '<p class="ch-rules">' + rules + '</p>' +
        '<ul class="ch-stars">' + stars + '</ul>' +
        '<div class="ch-foot"><span>Best <b>' + best + '</b></span><span>Pays ' + F.cash(cash) + ' per star' + (rec && rec.clears ? ' (half on repeats)' : '') + '</span></div>' +
        modSel +
        (status.ok
          ? '<button type="button" class="btn ' + (got ? '' : 'primary') + '" data-action="start" data-id="' + c.id + '">' + (got ? 'Play again' : 'Start') + '</button>'
          : '<p class="ch-lock">' + esc(status.reason) + '</p>') +
        '</article>'
      );
    }

    /* --------------------------------------------------------------- events */

    _deny(btn) {
      this.audio.play('ui_deny');
      if (btn) {
        btn.classList.remove('shake');
        void btn.offsetWidth;
        btn.classList.add('shake');
      }
    }

    _click(e) {
      const btn = e.target.closest('[data-action]');
      if (!btn || !this.el.contains(btn)) return;
      const p = this.game.progression;
      switch (btn.dataset.action) {
        case 'close':
          this.hooks.onClose();
          break;
        case 'select':
          this.selected = btn.dataset.id;
          this.audio.play('ui_click');
          this.render();
          break;
        case 'travel':
          if (this.game.setRange(btn.dataset.id)) {
            this.audio.play('ui_click');
            this.hooks.onClose();
          } else this._deny(btn);
          break;
        case 'unlock-range': {
          const r = p.unlockRange(btn.dataset.id);
          if (r.ok) {
            this.audio.play('unlock');
            this.render();
          } else this._deny(btn);
          break;
        }
        case 'start':
          this.hooks.onStartChallenge(btn.dataset.id, this.mods[btn.dataset.id] || null);
          break;
        case 'branch':
          this.hooks.onBranch();
          break;
        default:
          break;
      }
    }
  }

  ZTA.UI.MapScreen = MapScreen;
})(typeof window !== 'undefined' ? window : globalThis);
