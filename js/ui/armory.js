/*
 * Armory: the collection wall plus a spec sheet for the selected gun, range
 * upgrades, the Workshop (Blueprint Tokens) and training lanes.
 * Every purchase shows its exact cost and effect first, including any
 * shots-to-break threshold it crosses. Unaffordable buttons stay clickable so
 * the player gets a clear "not enough" response instead of silence.
 */
(function (root) {
  'use strict';
  const ZTA = root.ZTA;
  const D = ZTA.data;
  const C = ZTA.content;
  const F = ZTA.fmt;

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const TK = '<b class="tk-icon" aria-label="Blueprint Tokens"></b>';

  function modeLabel(fire) {
    switch (fire.mode) {
      case 'semi':
        return 'Semi-auto';
      case 'auto':
        return 'Full-auto';
      case 'burst':
        return fire.burst + '-round burst';
      case 'pump':
        return 'Pump-action';
      case 'bolt':
        return 'Bolt-action';
      default:
        return fire.mode;
    }
  }

  function reloadSeconds(s) {
    return s.reload.style === 'shell' ? s.reload.start + s.reload.perShell * s.magazine + s.reload.end : s.reload.time;
  }
  const logBar = (v, max) => Math.log(1 + Math.max(0, v)) / Math.log(1 + max);

  const STAT_ROWS = [
    { key: 'Damage', val: (s) => s.damage * s.pellets, bar: (v) => logBar(v, 20000), better: 1, text: (s) => (s.pellets > 1 ? F.dec(s.damage, 1) + ' × ' + s.pellets : s.damage < 100 ? F.dec(s.damage, 1) : F.num(Math.round(s.damage))) },
    { key: 'Fire rate', val: (s) => (s.burst > 1 ? s.burstRpm || s.rpm : s.rpm), bar: (v) => Math.min(1, v / 1200), better: 1, text: (s) => Math.round(s.burst > 1 ? s.burstRpm || s.rpm : s.rpm) + ' rpm' },
    { key: 'Magazine', val: (s) => s.magazine, bar: (v) => logBar(v, 300), better: 1, text: (s) => s.magazine + ' rds' },
    { key: 'Reload', val: reloadSeconds, bar: (v) => Math.min(1, v / 5), better: -1, text: (s) => (s.reload.style === 'shell' ? F.dec(s.reload.perShell, 2) + ' s/shell' : F.dec(s.reload.time, 2) + ' s') },
    { key: 'Spread', val: (s) => s.spread, bar: (v) => Math.min(1, v / 4), better: -1, text: (s) => F.dec(s.spread, 2) + '°' },
    { key: 'Recoil', val: (s) => s.recoil.kick, bar: (v) => Math.min(1, v / 2.5), better: -1, text: (s) => (s.recoil.kick < 0.3 ? 'Light' : s.recoil.kick < 1 ? 'Medium' : 'Heavy') },
    { key: 'Weak point', val: (s) => s.critMult, bar: (v) => Math.min(1, v / 3.5), better: 1, text: (s) => F.mult(s.critMult) },
  ];

  const SORTS = {
    price: (a, b) => a.unlockCost - b.unlockCost,
    tier: (a, b) => a.tier - b.tier || D.families[a.family].order - D.families[b.family].order || a.unlockCost - b.unlockCost,
    family: (a, b) => D.families[a.family].order - D.families[b.family].order || a.unlockCost - b.unlockCost,
    name: (a, b) => a.name.localeCompare(b.name),
  };

  class Armory {
    constructor(game, audio, hooks) {
      this.game = game;
      this.audio = audio;
      this.hooks = hooks;
      this.el = document.getElementById('armory');
      this.body = document.getElementById('armory-body');
      this.cashEl = document.getElementById('armory-cash');
      this.bpEl = document.getElementById('armory-bp');
      this.tab = 'weapons';
      this.filter = 'all';
      this.sort = 'price';
      this.selected = game.weapons.activeId;
      this.arrival = null;
      this.flashRow = null;
      this.thumbs = new Map();

      this.el.addEventListener('click', (e) => this._click(e));
      this.el.addEventListener('change', (e) => this._change(e));
      const rerender = () => {
        if (this.isOpen) this.render();
      };
      game.events.on('cash:changed', rerender);
      game.events.on('blueprints:changed', rerender);
      game.events.on('lanes:tick', () => {
        if (this.isOpen && this.tab === 'lanes') this.render();
      });
      game.events.on('weapon:unlocked', (e) => {
        this.arrival = e.weaponId;
        this.selected = e.weaponId;
      });
    }

    get isOpen() {
      return !this.el.hidden;
    }

    open(tab) {
      if (tab) this.tab = tab;
      if (!this.selected || !D.weaponById[this.selected]) this.selected = this.game.weapons.activeId;
      this.el.hidden = false;
      this.render();
    }

    close() {
      this.el.hidden = true;
    }

    /* --------------------------------------------------------------- render */

    render() {
      const save = this.game.save;
      this.cashEl.textContent = F.cash(save.cash);
      this.bpEl.querySelector('b').textContent = F.int(save.blueprints);
      for (const b of this.el.querySelectorAll('.tab')) b.setAttribute('aria-selected', String(b.dataset.tab === this.tab));
      const lanesTab = this.el.querySelector('.tab[data-tab="lanes"]');
      if (lanesTab) lanesTab.hidden = !this.game.progression.lanesAvailable();
      if (this.tab === 'lanes' && !this.game.progression.lanesAvailable()) this.tab = 'weapons';
      this.body.className = 'armory-body' + (this.tab === 'weapons' ? '' : ' single');
      const scroll = this.body.scrollTop;
      if (this.tab === 'range') this.body.innerHTML = this._rangeHtml();
      else if (this.tab === 'workshop') this.body.innerHTML = this._workshopHtml();
      else if (this.tab === 'lanes') this.body.innerHTML = this._lanesHtml();
      else {
        this.body.innerHTML = this._wallHtml() + this._sheetHtml();
        this._paintThumbs();
      }
      this.body.scrollTop = scroll;
      this.arrival = null;
      if (this.flashRow) {
        const row = this.body.querySelector('[data-row="' + this.flashRow + '"]');
        if (row) row.classList.add('flash');
        this.flashRow = null;
      }
    }

    _wallHtml() {
      const save = this.game.save;
      const p = this.game.progression;
      const all = D.weapons.slice().sort(SORTS[this.sort] || SORTS.price);
      const owned = all.filter((w) => p.isOwned(w.id)).length;
      const list = all.filter((w) => {
        if (this.filter === 'all') return true;
        if (this.filter === 'owned') return p.isOwned(w.id);
        if (this.filter === 'fav') return save.favorites.indexOf(w.id) !== -1;
        return w.family === this.filter;
      });
      let chips = '';
      const filters = [['all', 'All'], ['owned', 'Owned'], ['fav', '★']].concat(Object.keys(D.families).map((f) => [f, D.families[f].label]));
      for (const [id, label] of filters) chips += '<button type="button" class="fchip" data-action="filter" data-f="' + id + '" aria-pressed="' + (this.filter === id) + '">' + label + '</button>';
      let items = '';
      for (const w of list) {
        const own = p.isOwned(w.id);
        const slot = save.equipped.indexOf(w.id);
        const rangeOpen = p.isRangeUnlocked(w.requiresRange);
        const afford = !own && rangeOpen && save.cash >= w.unlockCost;
        const fav = save.favorites.indexOf(w.id) !== -1;
        const cls = ['wall-item', w.id === this.selected ? 'selected' : '', afford ? 'affordable' : '', w.id === this.arrival ? 'new-arrival' : '', !own && !rangeOpen ? 'range-locked' : ''].join(' ');
        let price;
        if (own) price = slot >= 0 ? 'Slot ' + (slot + 1) : 'Owned';
        else if (!rangeOpen) price = '🔒 Range ' + D.rangeById[w.requiresRange].index;
        else price = F.cash(w.unlockCost);
        let mast = '';
        if (own) {
          const mi = p.masteryInfo(w.id);
          mast = '<span class="mast" title="Mastery ' + mi.level + ' / ' + mi.max + '"><i style="width:' + Math.round(((mi.level + (mi.level < mi.max ? mi.progress : 0)) / mi.max) * 100) + '%"></i></span>';
        }
        items +=
          '<button type="button" class="' + cls + '" data-action="select" data-id="' + w.id + '" aria-pressed="' + (w.id === this.selected) + '">' +
          '<canvas width="300" height="128" data-thumb="' + w.id + '" data-style="' + (own ? 'paper' : 'ghost') + '" data-finish="' + (own ? p.finishOf(w.id) : '') + '"></canvas>' +
          '<span class="nm">' + (fav ? '<span class="fav">★</span>' : '') + esc(w.name) + '</span>' +
          '<span class="sub"><span>' + esc(D.families[w.family].label) + ' · T' + w.tier + '</span>' +
          '<span class="price">' + price + '</span></span>' + mast +
          (slot >= 0 ? '<span class="badge">' + (slot + 1) + '</span>' : '') +
          '</button>';
      }
      if (!items) items = '<p class="wall-empty">Nothing here yet.</p>';
      return (
        '<section class="wall" aria-label="Collection wall">' +
        '<div class="wall-head"><span>The wall</span><span>' + owned + ' / ' + all.length + ' collected</span></div>' +
        '<div class="wall-tools"><div class="fchips">' + chips + '</div>' +
        '<label class="sort"><span>Sort</span><select data-action="sort">' +
        [['price', 'Price'], ['tier', 'Tier'], ['family', 'Family'], ['name', 'Name']].map(([k, l]) => '<option value="' + k + '"' + (this.sort === k ? ' selected' : '') + '>' + l + '</option>').join('') +
        '</select></label></div>' +
        '<div class="wall-grid">' + items + '</div>' +
        '<p class="wall-foot">Guns you unlock stay on the wall for good, even when you open a new branch. Pick any three for your loadout.</p>' +
        '</section>'
      );
    }

    _sheetHtml() {
      const game = this.game;
      const p = game.progression;
      const def = D.weaponById[this.selected];
      const own = p.isOwned(def.id);
      const stats = own ? p.stats(def.id) : C.resolveWeaponStats(def, {}, { mods: p.statOpts(def.id).mods });
      const activeId = game.weapons.activeId;
      const cmp = activeId !== def.id ? p.stats(activeId) : null;
      const perk = ZTA.perks[def.perk.id];
      const fav = game.save.favorites.indexOf(def.id) !== -1;

      let html = '<article class="sheet" aria-label="' + esc(def.name) + ' details">';
      html +=
        '<div class="sheet-head"><div><p class="maker">' + esc(def.manufacturer) + ' · ' + esc(def.inspiration) + '</p>' +
        '<h3>' + esc(def.name) + '</h3>' +
        '<div class="tags"><span class="tag solid">' + esc(D.families[def.family].label) + '</span>' +
        '<span class="tag">' + esc(def.caliber) + '</span><span class="tag">' + modeLabel(def.fire) + '</span>' +
        '<span class="tag">Tier ' + def.tier + '</span>' +
        (stats.penetration ? '<span class="tag">Penetrates ' + stats.penetration + '</span>' : '') +
        (stats.armorPierce ? '<span class="tag">AP ' + F.num(Math.round(stats.armorPierce)) + '</span>' : '') +
        (stats.projectile ? '<span class="tag">Explosive</span>' : '') +
        '</div></div>' +
        (own ? '<button type="button" class="fav-btn" data-action="fav" aria-pressed="' + fav + '" title="' + (fav ? 'Remove from favorites' : 'Add to favorites') + '">' + (fav ? '★' : '☆') + '</button>' : '') +
        '</div>';
      html += '<p class="blurb">' + esc(def.blurb) + '</p>';
      html +=
        '<div class="traits"><div class="trait"><b>Strength</b>' + esc(def.strength) + '</div>' +
        '<div class="trait"><b>Tradeoff</b>' + esc(def.tradeoff) + '</div></div>';

      // Signature perk, with its Blueprint improvement.
      const lvl = own ? p.perkLevel(def.id) : 0;
      html +=
        '<div class="perk-box"><span class="pl">Signature perk' + (lvl ? ' · Mk ' + ['I', 'II', 'III', 'IV', 'V', 'VI'][lvl] : '') + '</span><span class="pn">' + esc(perk.name) + '</span>' +
        '<span class="pd">' + esc(perk.describe(stats.perk.params)) + '</span>';
      if (own) {
        const info = p.perkUpgradeInfo(def.id);
        if (info.cost != null) {
          const afford = game.save.blueprints >= info.cost;
          html +=
            '<span class="perk-up"><span>Improve to Mk ' + ['I', 'II', 'III', 'IV', 'V', 'VI'][lvl + 1] + '</span>' +
            '<button type="button" class="buy tk" data-action="perk" aria-disabled="' + !afford + '">' + info.cost + TK + '</button></span>';
        } else if (info.bought >= info.cap) {
          html += '<span class="perk-up done">' + (info.cap < D.meta.perkUpgrade.costs.length ? 'Improved as far as the bench allows. The Workshop can raise the limit.' : 'Fully improved.') + '</span>';
        }
      }
      html += '</div>';

      // Stats with comparison against the gun in hand.
      html += '<div><span class="section-label">Stats' + (own ? ' with upgrades' : '') + '</span><div class="stats">';
      for (const row of STAT_ROWS) {
        const v = row.val(stats);
        const w = Math.min(100, row.bar(v) * 100);
        let marker = '';
        let delta = '';
        if (cmp) {
          const cv = row.val(cmp);
          marker = '<u style="left:' + Math.min(100, row.bar(cv) * 100).toFixed(1) + '%"></u>';
          const diff = v - cv;
          if (Math.abs(diff) > 1e-6) {
            const good = diff * row.better > 0;
            delta = '<span class="d ' + (good ? 'up' : 'down') + '">' + (good ? '▲' : '▼') + '</span>';
          }
        }
        html +=
          '<div class="stat"><span class="k">' + row.key + '</span><span class="bar"><i style="width:' + w.toFixed(1) + '%"></i>' + marker + '</span>' +
          '<span class="v">' + row.text(stats) + delta + '</span></div>';
      }
      html += '</div>';
      if (cmp) html += '<p class="compare-note">Tick marks and ▲▼ compare with your ' + esc(D.weaponById[activeId].name) + '.</p>';
      html += '</div>';

      // Shots to break at the current range.
      const range = game.range;
      html +=
        '<div><span class="section-label">Shots to break at ' + esc(range.name) + (stats.pellets > 1 ? ' · every pellet on target' : '') + '</span>' +
        '<table class="breaks"><thead><tr><th>Target</th><th>Body</th><th>Weak point</th><th>Notes</th></tr></thead><tbody>';
      for (const r of C.breakTable(stats, range)) {
        const t = D.targetById[r.targetId];
        const armor = r.armor > 0 ? Math.max(0, r.armor - stats.armorPierce) : 0;
        const note = t.explosive ? 'Explodes' : r.armor > 0 ? (armor > 0 ? 'Armor −' + F.num(Math.round(armor)) + ' per body hit' : 'Armor pierced') : t.weak ? '' : 'No weak point';
        const fmtN = (n) => (n == null ? '—' : n > 99 ? '99+' : n);
        html += '<tr><td>' + esc(t.name) + '</td><td class="n">' + fmtN(r.body) + '</td><td class="n">' + fmtN(r.weak) + '</td><td>' + note + '</td></tr>';
      }
      html += '</tbody></table></div>';

      if (own) {
        html += this._upgradesHtml(def);
        html += this._masteryHtml(def);
        html += this._equipHtml(def);
      } else html += this._unlockHtml(def);
      html += '</article>';
      return html;
    }

    _upgradeRow(d, action, cur) {
      const have = cur === 'tk' ? this.game.save.blueprints : this.game.save.cash;
      const price = (n) => (cur === 'tk' ? n + TK : F.cash(n));
      let pips = '';
      for (let i = 0; i < d.max; i++) pips += '<i class="' + (i < d.level ? 'on' : '') + '"></i>';
      let eff;
      if (d.maxed) {
        eff = 'Maxed at <b>' + esc(d.fromText) + '</b>';
      } else {
        eff = esc(d.fromText) + ' <span class="arrow">→</span> <b>' + esc(d.toText) + '</b>';
        if (d.detail) eff += '<br>' + esc(d.detail);
        if (d.breakpoints && d.breakpoints.length) {
          eff += '<br>';
          for (const bp of d.breakpoints.slice(0, 4)) eff += '<span class="bp">' + esc(bp.name) + (bp.weak ? ' weak point' : '') + ': ' + bp.from + ' → ' + bp.to + ' shots</span>';
        }
      }
      if (d.desc && !d.maxed) eff = '<span class="udesc">' + esc(d.desc) + '</span>' + eff;
      let btn;
      if (d.maxed) btn = '<span class="maxed">MAX</span>';
      else {
        const afford = have >= d.cost;
        btn =
          '<button type="button" class="buy' + (cur === 'tk' ? ' tk' : '') + '" data-action="' + action + '" data-upg="' + d.id + '" aria-disabled="' + !afford + '">' + price(d.cost) +
          (afford ? '' : '<span class="need">need ' + (cur === 'tk' ? d.cost - have : F.cash(d.cost - have)) + '</span>') +
          '</button>';
      }
      return (
        '<div class="upg" data-row="' + d.id + '"><div><div class="un">' + esc(d.name) + '</div><div class="lv" aria-label="Level ' + d.level + ' of ' + d.max + '">' + pips + '</div></div>' +
        '<div class="eff">' + eff + '</div>' + btn + '</div>'
      );
    }

    _upgradesHtml(def) {
      const p = this.game.progression;
      const disc = p.upgradeDiscount();
      let html = '<div><span class="section-label">Upgrades' + (disc ? ' · ' + Math.round(disc * 100) + '% off' : '') + '</span><div class="upgrades">';
      for (const t of def.upgrades) {
        const d = p.describeUpgrade(def.id, t.id, this.game.range);
        if (d) html += this._upgradeRow(Object.assign({}, d, { desc: null }), 'buy');
      }
      return html + '</div></div>';
    }

    _masteryHtml(def) {
      const p = this.game.progression;
      const mi = p.masteryInfo(def.id);
      const obj = p.objectiveFor(def.id);
      let track = '';
      mi.levels.forEach((L, i) => {
        track += '<li class="' + (i < mi.level ? 'on' : i === mi.level ? 'next' : '') + '"><b>' + (i + 1) + '</b><span>' + esc(L.label) + '</span></li>';
      });
      const pct = Math.round(mi.progress * 100);
      let html =
        '<div class="mastery"><span class="section-label">Mastery · level ' + mi.level + ' / ' + mi.max + '</span>' +
        '<div class="mxp"><i style="width:' + pct + '%"></i><span>' + (mi.next == null ? 'Mastered' : F.int(mi.xp) + ' / ' + F.int(mi.next) + ' XP') + '</span></div>' +
        '<ol class="mtrack">' + track + '</ol>' +
        '<div class="objective ' + (obj.done ? 'done' : '') + '"><span class="ol">Objective' + (obj.done ? ' · complete' : ' · +1 token') + '</span><span>' + esc(obj.text) + '</span>' +
        '<span class="op"><i style="width:' + Math.round((obj.progress / obj.goal) * 100) + '%"></i><em>' + obj.progress + ' / ' + obj.goal + '</em></span></div>';
      // Finishes.
      const avail = p.finishesFor(def.id);
      const cur = p.finishOf(def.id);
      html += '<div class="finishes"><span class="ol">Finish</span>';
      for (const f of D.meta.finishes) {
        const ok = avail.indexOf(f.id) !== -1;
        html +=
          '<button type="button" class="fin ' + f.id.replace('fin.', 'f-') + '" data-action="finish" data-fin="' + f.id + '" aria-pressed="' + (cur === f.id) + '"' + (ok ? '' : ' aria-disabled="true"') + ' title="' + esc(f.name + ' — ' + f.desc) + '">' +
          '<i></i><span>' + esc(f.name) + '</span></button>';
      }
      html += '</div></div>';
      return html;
    }

    _unlockHtml(def) {
      const p = this.game.progression;
      const cash = this.game.save.cash;
      if (!p.isRangeUnlocked(def.requiresRange)) {
        const r = D.rangeById[def.requiresRange];
        return (
          '<div class="unlock-box"><span class="section-label">Unlock</span>' +
          '<div>Sold at <b>' + esc(r.name) + '</b>. Open that range to buy it for ' + F.cash(def.unlockCost) + '.</div>' +
          '<div><button type="button" class="btn ink" data-action="to-map" data-id="' + r.id + '">See ranges</button></div></div>'
        );
      }
      const afford = cash >= def.unlockCost;
      const pct = Math.min(100, (cash / def.unlockCost) * 100);
      return (
        '<div class="unlock-box ' + (afford ? 'affordable' : '') + '">' +
        '<span class="section-label">Unlock</span>' +
        '<div>' + (afford ? 'Ready to unlock.' : 'You have ' + F.cash(cash) + '. ' + F.cash(def.unlockCost - cash) + ' to go.') + '</div>' +
        '<div class="progress"><i style="width:' + pct.toFixed(1) + '%"></i></div>' +
        '<div><button type="button" class="btn ' + (afford ? 'accent' : 'ink') + '" data-action="unlock" aria-disabled="' + !afford + '">Unlock for ' + F.cash(def.unlockCost) + '</button></div>' +
        '</div>'
      );
    }

    _equipHtml(def) {
      const eq = this.game.save.equipped;
      let html = '<div class="actions"><span class="lbl">Equip to</span>';
      for (let i = 0; i < 3; i++) {
        const occ = eq[i] ? D.weaponById[eq[i]].name : 'Empty';
        html += '<button type="button" class="slot-btn ' + (eq[i] === def.id ? 'current' : '') + '" data-action="equip" data-slot="' + i + '">' + (i + 1) + ' · ' + esc(occ) + '</button>';
      }
      html += '<button type="button" class="btn ink" data-action="test">Test gun</button></div>';
      return html;
    }

    _rangeHtml() {
      const save = this.game.save;
      const range = this.game.range;
      const s = save.stats;
      let rows = '';
      for (const u of D.rangeUpgrades) rows += this._upgradeRow(C.describeRangeUpgrade(u, save.rangeLevels, range), 'buy-range');
      const acc = s.shots > 0 ? Math.round((s.hits / s.shots) * 100) + '%' : '—';
      return (
        '<article class="sheet range-list">' +
        '<div class="range-intro"><p class="maker">Every range you own</p><h3>Range upgrades</h3>' +
        '<p>These improve the practice ranges themselves and help every gun. They reset when you open a new branch.</p></div>' +
        '<div class="upgrades">' + rows + '</div>' +
        '<div><span class="section-label">Record</span><dl class="statlist">' +
        '<dt>Waves cleared</dt><dd>' + F.int(s.wavesCleared) + '</dd>' +
        '<dt>Targets broken</dt><dd>' + F.int(s.breaks) + '</dd>' +
        '<dt>Bosses beaten</dt><dd>' + F.int(s.bossKills) + '</dd>' +
        '<dt>Challenge runs</dt><dd>' + F.int(s.challengeRuns) + '</dd>' +
        '<dt>Accuracy</dt><dd>' + acc + '</dd>' +
        '<dt>Best combo</dt><dd>' + F.mult(s.bestCombo) + '</dd>' +
        '<dt>Cash earned</dt><dd>' + F.cash(save.lifetimeCash) + '</dd>' +
        '<dt>Time on the range</dt><dd>' + F.duration(s.playTime) + '</dd>' +
        '</dl></div></article>'
      );
    }

    _workshopHtml() {
      const p = this.game.progression;
      const save = this.game.save;
      const g = p.globals();
      let rows = '';
      for (const n of D.meta.workshop) {
        const info = p.workshopInfo(n.id);
        const show = (lv) => {
          const v = n.effect.step * lv;
          switch (n.show) {
            case 'pct':
              return '+' + Math.round(v * 100) + '%';
            case 'pctDown':
              return '−' + Math.round(-v * 100) + '%';
            case 'steps':
              return '+' + v + ' combo steps';
            case 'hours':
              return '+' + v + ' h';
            case 'on':
              return lv ? 'On' : 'Off';
            case 'count':
              return '+' + v;
            default:
              return String(v);
          }
        };
        rows += this._upgradeRow({ id: n.id, name: n.name, desc: n.desc, level: info.level, max: n.max, maxed: info.maxed, cost: info.cost, fromText: show(info.level), toText: info.maxed ? null : show(info.level + 1) }, 'buy-ws', 'tk');
      }
      return (
        '<article class="sheet range-list">' +
        '<div class="range-intro"><p class="maker">Blueprint Tokens · ' + F.int(save.blueprints) + ' on hand · ' + F.int(save.lifetimeBlueprints) + ' earned</p><h3>Workshop</h3>' +
        '<p>Permanent upgrades. They stay through every new branch. Tokens come from challenge stars, mastery, objectives and collection milestones — never from waiting.</p></div>' +
        '<div class="upgrades">' + rows + '</div>' +
        '<div><span class="section-label">Permanent bonuses right now</span><dl class="statlist">' +
        '<dt>Cash from targets</dt><dd>' + F.mult(g.cashMult) + '</dd>' +
        '<dt>Damage</dt><dd>' + F.mult(g.damageMult) + '</dd>' +
        '<dt>Mastery XP</dt><dd>' + F.mult(g.masteryMult) + '</dd>' +
        '<dt>Collection</dt><dd>' + save.owned.length + ' / ' + D.weapons.length + ' guns</dd>' +
        '</dl></div></article>'
      );
    }

    _lanesHtml() {
      const p = this.game.progression;
      const save = this.game.save;
      const L = save.lanes;
      const n = p.laneCount();
      const cost = p.nextLaneCost();
      const g = p.globals();
      let lanes = '';
      for (let i = 0; i < n; i++) {
        const id = L.guns[i];
        let opts = '<option value="">Empty lane</option>';
        for (const w of save.owned.map((x) => D.weaponById[x]).sort((a, b) => p.laneGunRate(b.id) - p.laneGunRate(a.id))) {
          opts += '<option value="' + w.id + '"' + (w.id === id ? ' selected' : '') + '>' + esc(w.name) + ' — ' + F.cash(p.laneGunRate(w.id)) + '/s</option>';
        }
        lanes +=
          '<div class="lane"><span class="lane-n">' + (i + 1) + '</span><canvas width="200" height="64" data-thumb="' + (id || '') + '" data-style="paper"></canvas>' +
          '<select data-lane="' + i + '">' + opts + '</select><span class="lane-rate">' + (id ? F.cash(p.laneGunRate(id)) + '/s' : '—') + '</span></div>';
      }
      const rate = p.laneRate();
      const cap = p.laneCap();
      const fill = cap > 0 ? Math.min(1, L.stored / cap) : 0;
      return (
        '<article class="sheet range-list lanes-sheet">' +
        '<div class="range-intro"><p class="maker">Automation</p><h3>Training lanes</h3>' +
        '<p>Each lane keeps one of your guns shooting while you play or while you are away. Lanes store cash up to ' + F.int(g.offlineHours) + ' hours of output; collect it here or from the chip on the range. They never earn Blueprint Tokens, and active shooting is always far faster.</p></div>' +
        '<div class="lane-store"><div><span class="section-label">Stored</span><b>' + F.cash(Math.floor(L.stored)) + '</b><span class="cap">of ' + F.cash(cap) + ' · ' + F.cash(rate) + '/s</span></div>' +
        '<div class="progress"><i style="width:' + (fill * 100).toFixed(1) + '%"></i></div>' +
        '<button type="button" class="btn accent" data-action="collect" aria-disabled="' + !(L.stored >= 1) + '">Collect</button>' +
        (g.autoCollect ? '<p class="note">The Range Assistant collects for you every ' + D.meta.lanes.assistantInterval + ' seconds.</p>' : '') +
        '</div>' +
        '<div class="lanes">' + (lanes || '<p class="note">No lanes yet.</p>') + '</div>' +
        (cost != null ? '<div class="upg"><div><div class="un">Build lane ' + (L.unlocked + 1) + '</div></div><div class="eff">One more gun training at a time.</div><button type="button" class="buy" data-action="lane-unlock" aria-disabled="' + !(save.cash >= cost) + '">' + F.cash(cost) + '</button></div>' : '') +
        '</article>'
      );
    }

    _paintThumbs() {
      for (const c of this.body.querySelectorAll('canvas[data-thumb]')) {
        const id = c.dataset.thumb;
        if (!id) continue;
        const style = c.dataset.style;
        const finish = c.dataset.finish || '';
        const key = id + '|' + style + '|' + finish + '|' + c.width;
        let img = this.thumbs.get(key);
        if (!img) {
          img = document.createElement('canvas');
          img.width = c.width;
          img.height = c.height;
          ZTA.GunArt.drawFit(img.getContext('2d'), ZTA.GunArt.modelFor(D.weaponById[id]), img.width, img.height, style, 14, 1, finish || null);
          this.thumbs.set(key, img);
        }
        c.getContext('2d').drawImage(img, 0, 0);
      }
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

    _change(e) {
      const t = e.target;
      if (t.matches('select[data-action="sort"]')) {
        this.sort = t.value;
        this.render();
      } else if (t.matches('select[data-lane]')) {
        this.game.progression.assignLane(Number(t.dataset.lane), t.value || null);
        this.audio.play('ui_click');
        this.render();
        if (this.tab === 'lanes') this._paintThumbs();
      }
    }

    _click(e) {
      const btn = e.target.closest('[data-action], [data-tab]');
      if (!btn || !this.el.contains(btn)) return;
      if (btn.dataset.tab) {
        this.tab = btn.dataset.tab;
        this.audio.play('ui_click');
        this.render();
        if (this.tab === 'lanes') this._paintThumbs();
        return;
      }
      const p = this.game.progression;
      const ok = (row) => {
        this.audio.play('ui_buy');
        this.flashRow = row || null;
        this.render();
        if (this.tab === 'lanes') this._paintThumbs();
      };
      switch (btn.dataset.action) {
        case 'close':
          this.hooks.onClose();
          break;
        case 'select':
          this.selected = btn.dataset.id;
          this.audio.play('ui_click');
          this.render();
          break;
        case 'filter':
          this.filter = btn.dataset.f;
          this.audio.play('ui_click');
          this.render();
          break;
        case 'fav':
          p.toggleFavorite(this.selected);
          this.audio.play('ui_click');
          this.render();
          break;
        case 'buy': {
          const r = p.buyWeaponUpgrade(this.selected, btn.dataset.upg);
          if (r.ok) ok(btn.dataset.upg);
          else this._deny(btn);
          break;
        }
        case 'perk': {
          const r = p.buyPerkUpgrade(this.selected);
          if (r.ok) ok();
          else this._deny(btn);
          break;
        }
        case 'finish':
          if (btn.getAttribute('aria-disabled') === 'true') this._deny(btn);
          else if (p.setFinish(this.selected, btn.dataset.fin)) {
            this.audio.play('ui_click');
            this.render();
          }
          break;
        case 'buy-range': {
          const r = p.buyRangeUpgrade(btn.dataset.upg);
          if (r.ok) ok(btn.dataset.upg);
          else this._deny(btn);
          break;
        }
        case 'buy-ws': {
          const r = p.buyWorkshop(btn.dataset.upg);
          if (r.ok) ok(btn.dataset.upg);
          else this._deny(btn);
          break;
        }
        case 'collect':
          if (p.collectLanes() > 0) ok();
          else this._deny(btn);
          break;
        case 'lane-unlock': {
          const r = p.unlockLane();
          if (r.ok) ok();
          else this._deny(btn);
          break;
        }
        case 'unlock': {
          const r = p.unlockWeapon(this.selected);
          if (r.ok) {
            this.render();
            this.hooks.onReveal(this.selected);
          } else this._deny(btn);
          break;
        }
        case 'to-map':
          this.hooks.onMap(btn.dataset.id);
          break;
        case 'equip':
          if (p.equip(Number(btn.dataset.slot), this.selected)) {
            this.audio.play('ui_click');
            this.render();
          }
          break;
        case 'test':
          this.hooks.onTest(this.selected);
          break;
        default:
          break;
      }
    }
  }

  ZTA.UI.Armory = Armory;
})(typeof window !== 'undefined' ? window : globalThis);
