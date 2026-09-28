/*
 * Armory: the collection wall plus a spec sheet for the selected gun.
 * Every purchase shows its exact cost and effect first, including any
 * shots-to-break threshold it crosses. Unaffordable buttons stay clickable so
 * the player gets a clear "not enough cash" response instead of silence.
 */
(function (root) {
  'use strict';
  const ZTA = root.ZTA;
  const D = ZTA.data;
  const C = ZTA.content;
  const F = ZTA.fmt;

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const MODE_LABEL = { semi: 'Semi-auto', auto: 'Full-auto', pump: 'Pump-action' };

  function reloadSeconds(s) {
    return s.reload.style === 'shell' ? s.reload.start + s.reload.perShell * s.magazine + s.reload.end : s.reload.time;
  }

  const STAT_ROWS = [
    { key: 'Damage', val: (s) => s.damage * s.pellets, max: 60, better: 1, text: (s) => (s.pellets > 1 ? F.dec(s.damage, 1) + ' × ' + s.pellets : F.dec(s.damage, 1)) },
    { key: 'Fire rate', val: (s) => s.rpm, max: 900, better: 1, text: (s) => s.rpm + ' rpm' },
    { key: 'Magazine', val: (s) => s.magazine, max: 72, better: 1, text: (s) => s.magazine + ' rds' },
    {
      key: 'Reload',
      val: reloadSeconds,
      max: 4,
      better: -1,
      text: (s) => (s.reload.style === 'shell' ? F.dec(s.reload.perShell, 2) + ' s/shell' : F.dec(s.reload.time, 2) + ' s'),
    },
    { key: 'Spread', val: (s) => s.spread, max: 4, better: -1, text: (s) => F.dec(s.spread, 2) + '°' },
    {
      key: 'Recoil',
      val: (s) => s.recoil.kick,
      max: 2.5,
      better: -1,
      text: (s) => (s.recoil.kick < 0.3 ? 'Light' : s.recoil.kick < 1 ? 'Medium' : 'Heavy'),
    },
    { key: 'Weak point', val: (s) => s.critMult, max: 3.5, better: 1, text: (s) => F.mult(s.critMult) },
  ];

  class Armory {
    constructor(game, audio, hooks) {
      this.game = game;
      this.audio = audio;
      this.hooks = hooks;
      this.el = document.getElementById('armory');
      this.body = document.getElementById('armory-body');
      this.cashEl = document.getElementById('armory-cash');
      this.tab = 'weapons';
      this.selected = game.weapons.activeId;
      this.arrival = null;
      this.flashRow = null;
      this.thumbs = new Map();

      this.el.addEventListener('click', (e) => this._click(e));
      game.events.on('cash:changed', () => {
        if (this.isOpen) this.render();
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
      this.cashEl.textContent = F.cash(this.game.save.cash);
      for (const b of this.el.querySelectorAll('.tab')) b.setAttribute('aria-selected', String(b.dataset.tab === this.tab));
      this.body.classList.toggle('range-view', this.tab === 'range');
      this.body.innerHTML = this.tab === 'range' ? this._rangeHtml() : this._wallHtml() + this._sheetHtml();
      if (this.tab === 'weapons') this._paintThumbs();
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
      const list = D.weapons.slice().sort((a, b) => a.unlockCost - b.unlockCost);
      const owned = list.filter((w) => p.isOwned(w.id)).length;
      let items = '';
      for (const w of list) {
        const own = p.isOwned(w.id);
        const slot = save.equipped.indexOf(w.id);
        const afford = !own && save.cash >= w.unlockCost;
        const cls = ['wall-item', w.id === this.selected ? 'selected' : '', afford ? 'affordable' : '', w.id === this.arrival ? 'new-arrival' : ''].join(' ');
        items +=
          '<button type="button" class="' + cls + '" data-action="select" data-id="' + w.id + '" aria-pressed="' + (w.id === this.selected) + '">' +
          '<canvas width="300" height="128" data-thumb="' + w.id + '" data-style="' + (own ? 'paper' : 'ghost') + '"></canvas>' +
          '<span class="nm">' + esc(w.name) + '</span>' +
          '<span class="sub"><span>' + esc(D.families[w.family].label) + ' · ' + esc(w.caliber) + '</span>' +
          '<span class="price">' + (own ? (slot >= 0 ? 'Slot ' + (slot + 1) : 'Owned') : F.cash(w.unlockCost)) + '</span></span>' +
          (slot >= 0 ? '<span class="badge">' + (slot + 1) + '</span>' : '') +
          '</button>';
      }
      return (
        '<section class="wall" aria-label="Collection wall">' +
        '<div class="wall-head"><span>The wall</span><span>' + owned + ' / ' + list.length + ' collected</span></div>' +
        '<div class="wall-grid">' + items + '</div>' +
        '<p class="wall-foot">Guns you unlock stay on the wall for good. Pick any three for your loadout.</p>' +
        '</section>'
      );
    }

    _sheetHtml() {
      const game = this.game;
      const p = game.progression;
      const def = D.weaponById[this.selected];
      const own = p.isOwned(def.id);
      const stats = own ? p.stats(def.id) : C.resolveWeaponStats(def, {});
      const activeId = game.weapons.activeId;
      const cmp = activeId !== def.id ? p.stats(activeId) : null;
      const perk = ZTA.perks[def.perk.id];

      let html = '<article class="sheet" aria-label="' + esc(def.name) + ' details">';
      html +=
        '<div><p class="maker">' + esc(def.manufacturer) + ' · ' + esc(def.inspiration) + '</p>' +
        '<h3>' + esc(def.name) + '</h3>' +
        '<div class="tags"><span class="tag solid">' + esc(D.families[def.family].label) + '</span>' +
        '<span class="tag">' + esc(def.caliber) + '</span><span class="tag">' + MODE_LABEL[def.fire.mode] + '</span>' +
        '<span class="tag">Tier ' + def.tier + '</span></div></div>';
      html += '<p class="blurb">' + esc(def.blurb) + '</p>';
      html +=
        '<div class="traits"><div class="trait"><b>Strength</b>' + esc(def.strength) + '</div>' +
        '<div class="trait"><b>Tradeoff</b>' + esc(def.tradeoff) + '</div></div>';
      html += '<div class="perk-box"><span class="pl">Signature perk</span><span class="pn">' + esc(perk.name) + '</span><span class="pd">' + esc(perk.describe(def.perk.params)) + '</span></div>';

      // Stats with comparison against the gun in hand.
      html += '<div><span class="section-label">Stats' + (own ? ' with upgrades' : '') + '</span><div class="stats">';
      for (const row of STAT_ROWS) {
        const v = row.val(stats);
        const w = Math.min(100, (v / row.max) * 100);
        let marker = '';
        let delta = '';
        if (cmp) {
          const cv = row.val(cmp);
          marker = '<u style="left:' + Math.min(100, (cv / row.max) * 100).toFixed(1) + '%"></u>';
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

      // Shots to break.
      html +=
        '<div><span class="section-label">Shots to break' + (stats.pellets > 1 ? ' · every pellet on target at 7 m' : '') + '</span>' +
        '<table class="breaks"><thead><tr><th>Target</th><th>Body</th><th>Weak point</th><th>Notes</th></tr></thead><tbody>';
      for (const r of C.breakTable(stats)) {
        const t = D.targetById[r.targetId];
        const note = t.armor > 0 ? 'Armor −' + t.armor + ' per body hit' : t.weak ? '' : 'No weak point';
        html +=
          '<tr><td>' + esc(t.name) + '</td><td class="n">' + r.body + '</td><td class="n">' + (r.weak == null ? '—' : r.weak) + '</td><td>' + note + '</td></tr>';
      }
      html += '</tbody></table></div>';

      if (own) html += this._upgradesHtml(def);
      else html += this._unlockHtml(def);
      if (own) html += this._equipHtml(def);
      html += '</article>';
      return html;
    }

    _upgradeRow(d, action, extra) {
      const cash = this.game.save.cash;
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
          for (const bp of d.breakpoints) {
            eff += '<span class="bp">' + esc(bp.name) + (bp.weak ? ' weak point' : '') + ': ' + bp.from + ' → ' + bp.to + ' shots</span>';
          }
        }
      }
      let btn;
      if (d.maxed) btn = '<span class="maxed">MAX</span>';
      else {
        const afford = cash >= d.cost;
        btn =
          '<button type="button" class="buy" data-action="' + action + '" data-upg="' + d.id + '" aria-disabled="' + !afford + '">' + F.cash(d.cost) +
          (afford ? '' : '<span class="need">need ' + F.cash(d.cost - cash) + '</span>') +
          '</button>';
      }
      return (
        '<div class="upg" data-row="' + d.id + '"><div><div class="un">' + esc(d.name) + '</div><div class="lv" aria-label="Level ' + d.level + ' of ' + d.max + '">' + pips + '</div></div>' +
        '<div class="eff">' + eff + (extra || '') + '</div>' + btn + '</div>'
      );
    }

    _upgradesHtml(def) {
      const levels = this.game.progression.levelsFor(def.id);
      let html = '<div><span class="section-label">Upgrades</span><div class="upgrades">';
      for (const t of def.upgrades) html += this._upgradeRow(C.describeWeaponUpgrade(def, levels, t.id), 'buy');
      return html + '</div></div>';
    }

    _unlockHtml(def) {
      const cash = this.game.save.cash;
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
        html +=
          '<button type="button" class="slot-btn ' + (eq[i] === def.id ? 'current' : '') + '" data-action="equip" data-slot="' + i + '">' +
          (i + 1) + ' · ' + esc(occ) + '</button>';
      }
      html += '<button type="button" class="btn ink" data-action="test">Test gun</button></div>';
      return html;
    }

    _rangeHtml() {
      const save = this.game.save;
      const s = save.stats;
      let rows = '';
      for (const u of D.rangeUpgrades) rows += this._upgradeRow(C.describeRangeUpgrade(u, save.rangeLevels), 'buy-range');
      const acc = s.shots > 0 ? Math.round((s.hits / s.shots) * 100) + '%' : '—';
      return (
        '<article class="sheet range-list">' +
        '<div class="range-intro"><p class="maker">' + esc(D.range.name) + '</p><h3>Range upgrades</h3>' +
        '<p>These change the range itself and help every gun you own.</p></div>' +
        '<div class="upgrades">' + rows + '</div>' +
        '<div><span class="section-label">Range record</span><dl class="statlist">' +
        '<dt>Waves cleared</dt><dd>' + F.int(s.wavesCleared) + '</dd>' +
        '<dt>Targets broken</dt><dd>' + F.int(s.breaks) + '</dd>' +
        '<dt>Accuracy</dt><dd>' + acc + '</dd>' +
        '<dt>Best combo</dt><dd>' + F.mult(s.bestCombo) + '</dd>' +
        '<dt>Cash earned</dt><dd>' + F.cash(save.lifetimeCash) + '</dd>' +
        '<dt>Time on the range</dt><dd>' + F.duration(s.playTime) + '</dd>' +
        '</dl></div></article>'
      );
    }

    _paintThumbs() {
      for (const c of this.body.querySelectorAll('canvas[data-thumb]')) {
        const id = c.dataset.thumb;
        const style = c.dataset.style;
        const key = id + '|' + style;
        let img = this.thumbs.get(key);
        if (!img) {
          img = document.createElement('canvas');
          img.width = c.width;
          img.height = c.height;
          ZTA.GunArt.drawFit(img.getContext('2d'), ZTA.GunArt.modelFor(D.weaponById[id]), img.width, img.height, style, 14, 1);
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

    _click(e) {
      const btn = e.target.closest('[data-action], [data-tab]');
      if (!btn || !this.el.contains(btn)) return;
      if (btn.dataset.tab) {
        this.tab = btn.dataset.tab;
        this.audio.play('ui_click');
        this.render();
        return;
      }
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
        case 'buy': {
          const r = p.buyWeaponUpgrade(this.selected, btn.dataset.upg);
          if (r.ok) {
            this.audio.play('ui_buy');
            this.flashRow = btn.dataset.upg;
            this.render();
          } else this._deny(btn);
          break;
        }
        case 'buy-range': {
          const r = p.buyRangeUpgrade(btn.dataset.upg);
          if (r.ok) {
            this.audio.play('ui_buy');
            this.flashRow = btn.dataset.upg;
            this.render();
          } else this._deny(btn);
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
