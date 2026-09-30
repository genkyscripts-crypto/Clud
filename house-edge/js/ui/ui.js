/*
 * DOM screens. Every screen here is a safe screen: the arena is frozen while
 * it is open. Screens re-render only when their content key changes.
 * Buttons use data-act attributes and one delegated click handler.
 */
(function (root) {
  'use strict';
  const HE = root.HE;
  const D = HE.data;
  const E = HE.Economy;
  const F = HE.Facilities;
  const fmt = HE.fmt;

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const chip = (n) => '<span class="chipv"><i class="chip-ico" aria-hidden="true"></i>' + fmt.chips(n) + '</span>';

  class UI {
    constructor(game, deps) {
      this.game = game;
      this.renderer = deps.renderer;
      this.input = deps.input;
      this.audio = deps.audio;
      this.dev = !!deps.dev;
      this.root = document.getElementById('ui');
      this.toastsEl = document.getElementById('toasts');
      this.overlay = null;
      this.overlayData = null;
      this.key = '';
      this.ledger = { tab: 'build', q: '', tag: '', reveal: false };
      this.guided = !game.save.tutorialDone;
      this.frameStats = null;
      this.root.addEventListener('click', (e) => this._click(e));
      this.root.addEventListener('input', (e) => this._input(e));
      this.root.addEventListener('change', (e) => this._input(e));
      this.root.addEventListener('mouseover', (e) => {
        const b = e.target.closest('button');
        if (b && b !== this._hovered) {
          this._hovered = b;
          this.game.sfx('ui_hover');
        }
      });
    }

    /* ------------------------------------------------------- routing */

    screenName() {
      if (this.overlay) return 'overlay:' + this.overlay;
      const g = this.game;
      if (!g.run) return 'hub';
      const st = g.run.state;
      if (g.paused) return 'overlay:pause';
      if (['wager', 'draft', 'doors', 'shop', 'terminal', 'terminal_banked', 'results'].includes(st)) return st;
      return 'none';
    }

    blocking() {
      const s = this.screenName();
      return s !== 'none';
    }

    openOverlay(name, data) {
      this.overlay = name;
      this.overlayData = data || null;
      this.key = '';
      if (this.game.run && HE.Game.SIM_STATES[this.game.run.state]) this.game.paused = true;
    }

    closeOverlay() {
      const prev = this.overlay;
      this.overlay = this.overlayData && this.overlayData.back ? this.overlayData.back : null;
      this.overlayData = null;
      this.key = '';
      if (!this.overlay && prev !== 'pause' && this.game.run && HE.Game.SIM_STATES[this.game.run.state]) this.game.paused = false;
      if (this.overlay === 'pause') this.game.paused = true;
    }

    frame() {
      const name = this.screenName();
      const key = name + '|' + this._contentKey(name);
      if (key !== this.key) {
        this.key = key;
        this.render(name);
      }
      if (name === 'overlay:debug') this._updateDebugStats();
    }

    _contentKey(name) {
      const g = this.game;
      const run = g.run;
      switch (name) {
        case 'hub': {
          const f = g.save.facilities.slot_alley;
          return [g.save.account.banked, f.level, Math.floor(f.stored), g.save.upgrades.vitality, g.save.upgrades.caliber, g.save.presets.loaded_seven, g.hasCheckpoint(), this.guided].join(',');
        }
        case 'draft':
          return JSON.stringify(run.draft) + run.rerolls + run.bans + this._holdKey();
        case 'doors':
          return JSON.stringify(run.doors) + this._holdKey();
        case 'shop':
          return run.wallet.loose + run.shopBought.join() + this._holdKey() + Math.round(g.player.hp);
        case 'terminal':
        case 'terminal_banked':
          return run.wallet.loose + '|' + this._holdKey();
        case 'wager':
          return JSON.stringify(run.wagerOffer);
        case 'results':
          return run.id;
        case 'overlay:ledger':
          return this.ledger.tab + this.ledger.reveal + this.ledger.tag + g.perks.ownedIds().join() + this._holdKey();
        case 'overlay:settings':
          return JSON.stringify(g.save.settings) + JSON.stringify(g.save.bindings) + (this._capturing || '');
        default:
          return '';
      }
    }

    _holdKey() {
      const s = this.game.slots;
      return (s.last || []).join() + s.holds.join() + Math.floor(s.charge) + s.freeHolds;
    }

    render(name) {
      const r = this.root;
      let html = '';
      switch (name) {
        case 'hub':
          html = this._hub();
          break;
        case 'wager':
          html = this._wager();
          break;
        case 'draft':
          html = this._draft();
          break;
        case 'doors':
          html = this._doors();
          break;
        case 'shop':
          html = this._shop();
          break;
        case 'terminal':
          html = this._terminal();
          break;
        case 'terminal_banked':
          html = this._terminalBanked();
          break;
        case 'results':
          html = this._results();
          break;
        case 'overlay:pause':
          html = this._pause();
          break;
        case 'overlay:ledger':
          html = this._ledger();
          break;
        case 'overlay:settings':
          html = this._settings();
          break;
        case 'overlay:confirm':
          html = this._confirm();
          break;
        case 'overlay:offline':
          html = this._offline();
          break;
        case 'overlay:debug':
          html = this._debug();
          break;
        default:
          html = '';
      }
      r.innerHTML = html;
      r.hidden = !html;
      r.dataset.screen = name;
      if (name === 'overlay:ledger') this._renderRecipeList();
      const first = r.querySelector('[data-autofocus]');
      if (first) first.focus({ preventScroll: true });
    }

    /* ---------------------------------------------------------- hub */

    _hub() {
      const g = this.game;
      const s = g.save;
      const a = s.account;
      const fdef = D.facilityById.slot_alley;
      const fs = s.facilities.slot_alley;
      const rate = F.rate(fdef, fs.level);
      const cap = F.cap(fdef, fs.level);
      const next = fs.level < fdef.maxLevel ? F.cost(fdef, fs.level) : null;
      const nextMs = fdef.milestones.find((m) => m.level === fs.level + 1);
      const nextRate = F.rate(fdef, fs.level + 1);
      const unl = g.unlocks();
      const first = a.runs === 0;
      let h = '<div class="panel hub" role="dialog" aria-label="Casino">';
      h += '<header class="hub-head"><div><div class="eyebrow">Banked chips</div><div class="big">' + chip(a.banked) + '</div></div>';
      h += '<div class="hub-rec"><span>Runs ' + a.runs + '</span><span>Vaults opened ' + a.wins + '</span><span>Best run ' + fmt.chips(s.records.bestRunChips) + '</span></div></header>';
      if (first) {
        h += '<div class="callout"><b>You have one stolen chip and a battered revolver.</b> Objective: fight through the Penny Arcade and reach the first <b>cash-out terminal</b>. Whatever you bank there is yours to keep.</div>';
      }
      h += '<div class="start">';
      if (g.hasCheckpoint()) {
        const cp = s.checkpoint;
        h += '<button class="btn primary" data-act="resume" data-autofocus>Resume run <small>' + esc(D.floors[cp.floorIndex].name) + ' · room ' + (cp.slotIndex + 1) + ' · ' + fmt.chips(cp.wallet.loose) + ' loose</small></button>';
        h += '<button class="btn ghost" data-act="abandonSaved">Abandon saved run (recover 25%)</button>';
      } else {
        h += '<button class="btn primary" data-act="start" data-autofocus>' + (first ? 'Enter the casino' : 'Start a run') + ' <small>Penny Arcade → Roulette Rotunda → the Vault</small></button>';
        h += '<label class="check"><input type="checkbox" data-act="guided" ' + (this.guided ? 'checked' : '') + '> Guided Entrance (tutorial)</label>';
      }
      h += '</div>';
      // Slot Alley.
      h += '<section class="card fac"><div class="card-head"><h3>Slot Alley</h3><span class="lvl">' + (fs.level ? 'Level ' + fs.level + ' / ' + fdef.maxLevel : 'Condemned') + '</span></div>';
      h += '<p class="muted">' + esc(fdef.desc) + '</p>';
      if (fs.level > 0) {
        h += '<div class="prod"><div><span class="k">Rate</span> ' + fmt.chips(rate * 3600) + ' / hour</div><div><span class="k">Stored</span> ' + fmt.chips(fs.stored) + ' / ' + fmt.chips(cap) + ' <span class="muted">(8 h cap)</span></div>';
        h += '<button class="btn" data-act="collect" ' + (fs.stored >= 1 ? '' : 'disabled') + '>Collect ' + fmt.chips(fs.stored) + '</button></div>';
      }
      if (next != null) {
        h += '<div class="buy"><button class="btn gold" data-act="buyFac" ' + (a.banked >= next ? '' : 'disabled') + '>' + (fs.level ? 'Upgrade to level ' + (fs.level + 1) : 'Repair Slot Alley') + ' — ' + chip(next) + '</button>';
        h += '<div class="muted small">→ ' + fmt.chips(nextRate * 3600) + ' / hour' + (nextMs ? ' · <b>' + esc(nextMs.text) + '</b>' : '') + '</div></div>';
      }
      h += '<ul class="ms">';
      for (const m of fdef.milestones) h += '<li class="' + (fs.level >= m.level ? 'on' : '') + '"><span>L' + m.level + '</span>' + esc(m.text) + '</li>';
      h += '</ul>';
      if (unl.includes('loaded_seven')) {
        h += '<label class="check"><input type="checkbox" data-act="preset" ' + (s.presets.loaded_seven ? 'checked' : '') + '> Reel preset: Loaded Seven (reel 3 Seven weight 1.5 → 777 odds ' + fmt.odds((1 / 6) * (1 / 6) * (1.5 / 6.5)) + ')</label>';
      }
      h += '</section>';
      // Tables.
      h += '<section class="card"><div class="card-head"><h3>Tables</h3><span class="lvl">Capped permanent upgrades</span></div><div class="ups">';
      for (const u of D.accountUpgrades) {
        const r = s.upgrades[u.id];
        const c = u.costs[r];
        h += '<div class="up"><div><b>' + esc(u.name) + '</b> <span class="muted">' + r + '/' + u.costs.length + '</span><div class="muted small">' + esc(u.desc) + '</div></div>';
        h += c != null ? '<button class="btn" data-act="buyUp" data-id="' + u.id + '" ' + (a.banked >= c ? '' : 'disabled') + '>' + chip(c) + '</button>' : '<span class="muted">MAX</span>';
        h += '</div>';
      }
      h += '</div></section>';
      h += '<footer class="row"><button class="btn ghost" data-act="ledger">Build ledger</button><button class="btn ghost" data-act="settings">Settings</button>' + (this.dev ? '<button class="btn ghost dev" data-act="debug">Dev tools</button>' : '') + '</footer>';
      h += '</div>';
      return h;
    }

    /* ----------------------------------------------------- hold panel */

    _holdPanel() {
      const s = this.game.slots;
      const odds = s.odds();
      let h = '<section class="card holds"><div class="card-head"><h3>Reels</h3><span class="lvl">' + Math.floor(s.charge) + ' charge</span></div>';
      if (!s.last) h += '<p class="muted small">Spin once to enable holds. A hold keeps that reel’s last symbol for your next spin.</p>';
      h += '<div class="reelrow">';
      for (let i = 0; i < 3; i++) {
        const sym = s.last ? s.last[i] : null;
        h += '<button class="reel ' + (s.holds[i] ? 'held' : '') + '" data-act="hold" data-i="' + i + '" ' + (sym ? '' : 'disabled') + ' aria-pressed="' + s.holds[i] + '">' + (sym ? HE.symbolSVG(sym, 34) : '<span class="muted">—</span>') + '<span>' + (s.holds[i] ? 'HELD' : 'hold') + '</span></button>';
      }
      h += '</div>';
      const extra = s.cost() - s.baseCost;
      h += '<div class="odds"><div>Next spin cost <b>' + s.cost() + '</b>' + (s.holdCount() ? (extra ? ' (hold +' + extra + ')' : ' (hold token: free)') : '') + '</div>';
      h += '<div>777 jackpot <b>' + fmt.odds(odds.jackpot) + '</b> · ' + fmt.pct(odds.jackpot, 2) + '</div>';
      h += '<div>Any triple <b>' + fmt.pct(odds.triple + odds.jackpot, 1) + '</b> · Pair <b>' + fmt.pct(odds.pair, 1) + '</b> · Mixed <b>' + fmt.pct(odds.mixed, 1) + '</b></div>';
      if (s.freeHolds) h += '<div class="gold-t">Hold token ready: next hold costs no extra charge.</div>';
      h += '<div class="muted small">One held reel max. Holds expire after one spin. Odds are computed from the exact weights and holds the machine will use.</div></div></section>';
      return h;
    }

    /* -------------------------------------------------------- wager */

    _wager() {
      const g = this.game;
      const o = g.run.wagerOffer;
      const def = D.wagerById[o.defId];
      let h = '<div class="panel modal wager" role="dialog" aria-label="Optional wager"><div class="eyebrow">Optional wager · the Bookmaker leans in</div>';
      h += '<h2>' + esc(def.name) + '</h2><p class="objective">' + esc(def.objective) + '</p>';
      h += '<p class="muted">Stakes come out of your loose chips (' + fmt.chips(g.run.wallet.loose) + ') and are held in escrow. Win: the stake comes back doubled. Lose: you lose only the stake. Death, quitting or reloading counts as a loss.</p>';
      h += '<div class="stakes">';
      o.stakes.forEach((st, i) => {
        const t = E.wagerTerms(st);
        h += '<button class="btn gold" data-act="stake" data-v="' + st + '" ' + (i === 0 ? 'data-autofocus' : '') + '>Stake ' + chip(t.stake) + '<small>Win: receive ' + t.payout + ' (+' + t.profit + ') · Fail: −' + t.lossOnFail + '</small></button>';
      });
      h += '</div><button class="btn ghost wide" data-act="decline">Decline — play the room normally</button></div>';
      return h;
    }

    /* -------------------------------------------------------- draft */

    _draft() {
      const g = this.game;
      const run = g.run;
      let h = '<div class="panel draft" role="dialog" aria-label="Choose an upgrade"><div class="eyebrow">Room cleared · choose one</div><h2>Upgrade</h2><div class="cards">';
      run.draft.forEach((o, i) => {
        if (o.type === 'perk') {
          const def = D.perkById[o.id];
          const rec = o.recipe ? D.recipeById[o.recipe] : null;
          h += '<div class="pick ' + (rec ? 'recipe' : '') + '"><div class="pick-top"><span class="fam">' + esc(def.family) + '</span><span class="rank">' + (o.rank === 1 ? 'NEW' : 'RANK ' + o.rank + ' / ' + def.maxRank) + '</span></div>';
          h += '<h3>' + esc(def.name) + '</h3><p>' + esc(def.desc[o.rank - 1]) + '</p>';
          if (o.rank > 1) h += '<p class="muted small">Now: ' + esc(def.desc[o.rank - 2]) + '</p>';
          h += '<div class="tags">' + def.tags.map((t) => '<span>' + esc(t) + '</span>').join('') + '</div>';
          if (rec) h += '<div class="rec">Completes <b>' + esc(rec.name) + '</b>: ' + esc(rec.description) + '</div>';
          else {
            const partial = D.recipes.filter((r) => r.ingredients.includes(o.id) && !g.perks.recipe(r.id));
            if (partial.length) h += '<div class="muted small">Part of: ' + partial.map((r) => esc(r.name)).join(', ') + '</div>';
          }
          h += '<div class="pick-act"><button class="btn primary" data-act="choose" data-i="' + i + '" ' + (i === 0 ? 'data-autofocus' : '') + '>Take <kbd>' + (i + 1) + '</kbd></button>';
          h += '<button class="btn ghost small" data-act="ban" data-i="' + i + '" ' + (run.bans > 0 ? '' : 'disabled') + ' title="Remove from this run’s pool">Ban</button></div></div>';
        } else {
          h += '<div class="pick alt"><div class="pick-top"><span class="fam">comp</span></div><h3>' + esc(o.name) + '</h3><p>' + esc(o.desc) + '</p><div class="pick-act"><button class="btn primary" data-act="choose" data-i="' + i + '">Take <kbd>' + (i + 1) + '</kbd></button></div></div>';
        }
      });
      h += '</div><div class="row"><button class="btn" data-act="reroll" ' + (run.rerolls > 0 ? '' : 'disabled') + '>Reroll (' + run.rerolls + ' left)</button><span class="muted small">Bans left: ' + run.bans + ' · Perk slots ' + g.perks.ownedIds().length + ' / ' + HE.Run.PERK_SLOTS + '</span></div>';
      h += this._holdPanel() + '</div>';
      return h;
    }

    /* -------------------------------------------------------- doors */

    _doors() {
      const g = this.game;
      const run = g.run;
      const floor = g.floor();
      let h = '<div class="panel doors" role="dialog" aria-label="Choose the next room"><div class="eyebrow">' + esc(floor.name) + ' · next: room ' + (run.slotIndex + 2) + ' / ' + floor.slots.length + '</div><h2>Choose a door</h2><div class="cards">';
      run.doors.forEach((d, i) => {
        const boss = d.type === 'boss';
        const bdef = boss ? D.bossById[floor.boss] : null;
        h += '<div class="pick door ' + d.type + '"><div class="pick-top"><span class="fam">' + (boss ? 'boss' : d.type === 'cashier' ? 'shop' : 'combat') + '</span>' + (d.wager ? '<span class="rank gold-t">wager offered</span>' : '') + '</div>';
        h += '<h3>' + esc(boss ? bdef.name + ' — ' + bdef.title : d.name) + '</h3><p>' + esc(boss ? bdef.desc : d.desc) + '</p>';
        h += '<div class="pick-act"><button class="btn primary" data-act="door" data-i="' + i + '" ' + (i === 0 ? 'data-autofocus' : '') + '>Enter <kbd>' + (i + 1) + '</kbd></button></div></div>';
      });
      h += '</div><div class="row muted small">Health ' + Math.ceil(g.player.hp) + ' / ' + g.player.maxHp + ' · Loose ' + fmt.chips(run.wallet.loose) + (run.wallet.multiplier > 1 ? ' · ×' + run.wallet.multiplier.toFixed(2) + ' carried' : '') + ' · Progress saved at this door.</div>';
      h += this._holdPanel() + '</div>';
      return h;
    }

    /* --------------------------------------------------------- shop */

    _shop() {
      const g = this.game;
      const run = g.run;
      let h = '<div class="panel shop" role="dialog" aria-label="Cashier cage"><div class="eyebrow">Cashier cage · loose chips ' + fmt.chips(run.wallet.loose) + '</div><h2>The Cashier</h2><div class="cards">';
      for (const it of D.shop) {
        const bought = run.shopBought.includes(it.id);
        h += '<div class="pick"><h3>' + esc(it.name) + '</h3><p>' + esc(it.desc) + '</p><div class="pick-act"><button class="btn gold" data-act="shopBuy" data-id="' + it.id + '" ' + (!bought && run.wallet.loose >= it.cost ? '' : 'disabled') + '>' + (bought ? 'Bought' : chip(it.cost)) + '</button></div></div>';
      }
      h += '</div><div class="row"><button class="btn primary" data-act="leaveShop" data-autofocus>Leave</button><span class="muted small">Health ' + Math.ceil(g.player.hp) + ' / ' + g.player.maxHp + '</span></div>' + this._holdPanel() + '</div>';
      return h;
    }

    /* ----------------------------------------------------- terminal */

    _terminal() {
      const g = this.game;
      const run = g.run;
      const floor = g.floor();
      const w = run.wallet;
      if (floor.final) {
        let h = '<div class="panel modal terminal" role="dialog" aria-label="The Vault"><div class="eyebrow">' + esc(floor.name) + ' cleared</div><h2>The Vault</h2>';
        h += '<p>The last door in this build. Opening it banks every loose chip and ends the run in victory.</p>';
        h += '<div class="bigline">' + chip(w.loose) + ' <span class="muted">→ banked</span></div>';
        h += '<button class="btn gold wide" data-act="vault" data-autofocus>Open the Vault — bank ' + fmt.chips(w.loose) + '</button></div>';
        return h;
      }
      const pv = g.terminalPreview();
      const next = D.floors[run.floorIndex + 1];
      let h = '<div class="panel modal terminal" role="dialog" aria-label="Cash-out terminal"><div class="eyebrow">' + esc(floor.name) + ' cleared · the terminal restored 30% health</div><h2>Cash-out terminal</h2>';
      h += '<div class="bigline">' + chip(w.loose) + ' <span class="muted">loose chips at risk</span></div><div class="choice2">';
      h += '<div class="opt"><h3>BANK</h3><ul><li>Move <b>' + fmt.chips(pv.bank.banked) + '</b> chips to your account now. They can never be lost.</li><li>Next floor pays <b>×1.00</b>; heat resets to 0.</li><li>Then continue to ' + esc(next.name) + ' or finish the run.</li></ul><button class="btn gold wide" data-act="bank" data-autofocus>Bank ' + fmt.chips(w.loose) + '</button></div>';
      h += '<div class="opt risk"><h3>PRESS ON</h3><ul><li>Carry <b>' + fmt.chips(pv.press.carried) + '</b> loose chips into ' + esc(next.name) + '.</li><li>Natural chip drops pay <b>×' + pv.press.nextMultiplier.toFixed(2) + '</b> (cap ×3).</li><li>' + esc(D.HEAT.describe(pv.press.nextHeat)) + '</li><li>If you fall, you recover only 25% of loose chips.</li></ul><button class="btn wide danger" data-act="press">Press on</button></div>';
      h += '</div><p class="muted small">Base difficulty rises on the next floor either way. Once the next floor starts, this terminal cannot be revisited.</p>' + this._holdPanel() + '</div>';
      return h;
    }

    _terminalBanked() {
      const g = this.game;
      const run = g.run;
      const next = D.floors[run.floorIndex + 1];
      const last = run.bankedLog[run.bankedLog.length - 1];
      let h = '<div class="panel modal terminal" role="dialog" aria-label="Banked"><div class="eyebrow">Banked</div><h2>+' + fmt.chips(last ? last.amount : 0) + ' chips secured</h2>';
      h += '<p>Account balance: ' + chip(g.account.banked) + '</p>';
      h += '<div class="choice2"><div class="opt"><h3>Continue</h3><p>Play ' + esc(next.name) + ' at ×1.00 with no heat. Base difficulty still rises.</p><button class="btn primary wide" data-act="continue" data-autofocus>Continue to ' + esc(next.name) + '</button></div>';
      h += '<div class="opt"><h3>Finish run</h3><p>Walk out with what you banked and go spend it.</p><button class="btn wide" data-act="finish">Finish run</button></div></div>' + this._holdPanel() + '</div>';
      return h;
    }

    /* ------------------------------------------------------ results */

    _results() {
      const g = this.game;
      const r = g.run.results;
      const titles = { victory: 'THE VAULT IS OPEN', cashed_out: 'CASHED OUT', defeat: 'THE HOUSE WINS', abandoned: 'WALKED AWAY' };
      const c = r.chips;
      let h = '<div class="panel results" role="dialog" aria-label="Run results"><div class="eyebrow">' + (r.debug ? 'DEBUG RUN — nothing was saved' : 'Run complete') + '</div><h2 class="' + r.outcome + '">' + titles[r.outcome] + '</h2><div class="cols"><div>';
      h += '<h3>Earned this run</h3><table class="ledger-t">';
      h += '<tr><td>Natural combat chips</td><td>' + fmt.chips(c.natural) + '</td></tr>';
      if (c.multiplierBonus) h += '<tr><td class="muted">…of which carried-winnings multiplier</td><td>+' + fmt.chips(c.multiplierBonus) + '</td></tr>';
      h += '<tr><td>Room-clear bonuses &amp; comps</td><td>' + fmt.chips(c.roomBonus) + '</td></tr>';
      if (c.wagersWon || c.wagersLost) h += '<tr><td>Wagers: ' + c.wagersWon + ' won, ' + c.wagersLost + ' lost</td><td>+' + fmt.chips(c.wagerReturns) + ' / −' + fmt.chips(c.stakesLost) + '</td></tr>';
      if (c.spent) h += '<tr><td>Spent at the Cashier</td><td>−' + fmt.chips(c.spent) + '</td></tr>';
      h += '</table><h3>Banked</h3><table class="ledger-t">';
      for (const b of r.bankedLog) h += '<tr><td>Terminal, ' + esc(D.floors[b.floor].name) + '</td><td>' + fmt.chips(b.amount) + '</td></tr>';
      if (r.finalBank) h += '<tr><td>The Vault</td><td>' + fmt.chips(r.finalBank) + '</td></tr>';
      if (r.recovery) h += '<tr><td>Recovered on ' + (r.outcome === 'defeat' ? 'defeat' : 'leaving') + ': ' + Math.round(r.recovery.rate * 100) + '% of ' + fmt.chips(r.recovery.loose) + ' loose</td><td>' + fmt.chips(r.recovery.recovered) + '</td></tr>';
      if (r.recovery && r.recovery.lost) h += '<tr class="muted"><td>Lost with the run</td><td>−' + fmt.chips(r.recovery.lost) + '</td></tr>';
      h += '<tr class="total"><td>Total banked this run</td><td>' + fmt.chips(r.bankedTotal) + '</td></tr><tr><td>Account balance</td><td>' + chip(r.balance) + '</td></tr></table>';
      h += '<p class="muted small">Survives the run: banked chips, Slot Alley, table upgrades, discovered recipes and records. Lost: perks, loose chips not banked or recovered, reel state.</p></div><div>';
      const s = r.stats;
      h += '<h3>The run</h3><table class="ledger-t"><tr><td>Time</td><td>' + fmt.clock(r.time) + '</td></tr><tr><td>Floors / rooms cleared</td><td>' + r.floorsCleared + ' / ' + r.roomsCleared + '</td></tr><tr><td>Kills (elites)</td><td>' + s.kills + ' (' + s.eliteKills + ')</td></tr><tr><td>Grazes</td><td>' + s.grazes + '</td></tr><tr><td>Spins · pairs · triples · 777</td><td>' + s.spins + ' · ' + s.pairs + ' · ' + s.triples + ' · ' + s.jackpots + '</td></tr><tr><td>Damage taken</td><td>' + Math.round(s.damageTaken) + '</td></tr></table>';
      if (r.newRecipes.length) {
        h += '<h3>Recipes this run</h3><ul class="reclist">' + r.newRecipes.map((id) => '<li><b>' + esc(D.recipeById[id].name) + '</b> — ' + esc(D.recipeById[id].description) + '</li>').join('') + '</ul>';
      }
      const ng = r.nextGoal;
      if (ng) {
        h += '<div class="callout ' + (ng.affordable ? 'good' : '') + '"><div class="eyebrow">Next goal</div><b>' + esc(ng.name) + '</b> — ' + chip(ng.cost) + (ng.affordable ? ' <span class="gold-t">you can afford this now</span>' : ' <span class="muted">(' + fmt.chips(ng.cost - r.balance) + ' to go)</span>') + '<div class="small">' + esc(ng.note) + '</div></div>';
      }
      h += '</div></div><button class="btn primary wide" data-act="toHub" data-autofocus>Return to the casino</button></div>';
      return h;
    }

    /* -------------------------------------------------------- pause */

    _pause() {
      let h = '<div class="panel modal pause" role="dialog" aria-label="Paused"><h2>Paused</h2><div class="stack">';
      h += '<button class="btn primary" data-act="resumePlay" data-autofocus>Resume</button>';
      h += '<button class="btn" data-act="ledger">Build ledger</button>';
      h += '<button class="btn" data-act="settings">Settings</button>';
      if (this.game.tutorial) h += '<button class="btn" data-act="skipTut">Skip tutorial</button>';
      h += '<button class="btn danger" data-act="abandon">Abandon run</button></div>';
      h += '<p class="muted small">Abandoning counts as a defeat: you recover 25% of loose, unstaked chips. An active wager is lost.</p></div>';
      return h;
    }

    _confirm() {
      const d = this.overlayData;
      return '<div class="panel modal confirm" role="alertdialog"><h2>' + esc(d.title) + '</h2><p>' + esc(d.text) + '</p><div class="row"><button class="btn danger" data-act="confirmYes">' + esc(d.yes || 'Yes') + '</button><button class="btn" data-act="confirmNo" data-autofocus>Cancel</button></div></div>';
    }

    _offline() {
      const d = this.overlayData;
      return '<div class="panel modal offline" role="dialog"><div class="eyebrow">While you were away</div><h2>Slot Alley kept spinning</h2><table class="ledger-t"><tr><td>Time counted</td><td>' + fmt.duration(d.elapsed) + (d.elapsed >= 8 * 3600 - 1 ? ' (8 h cap)' : '') + '</td></tr><tr><td>Rate</td><td>' + fmt.chips(d.rate * 3600) + ' / hour</td></tr><tr><td>Produced</td><td>' + fmt.chips(d.gain) + '</td></tr><tr><td>Stored (cap ' + fmt.chips(d.cap) + ')</td><td>' + fmt.chips(this.game.save.facilities.slot_alley.stored) + '</td></tr></table>' + (d.capped ? '<p class="gold-t small">Storage is full. Collect to keep producing.</p>' : '') + '<div class="row"><button class="btn gold" data-act="collectClose" data-autofocus>Collect</button><button class="btn" data-act="closeOverlay">Later</button></div></div>';
    }

    /* ------------------------------------------------------- ledger */

    _ledger() {
      const g = this.game;
      const L = this.ledger;
      const tabs = [
        ['build', 'Build'],
        ['recipes', 'Recipes'],
        ['odds', 'Odds'],
      ];
      if (this.dev) tabs.push(['log', 'Damage log']);
      let h = '<div class="panel ledger" role="dialog" aria-label="Build ledger"><div class="row between"><h2>Build ledger</h2><button class="btn ghost" data-act="closeOverlay" data-autofocus>Close <kbd>Esc</kbd></button></div><div class="tabs">';
      for (const [id, name] of tabs) h += '<button class="tab ' + (L.tab === id ? 'on' : '') + '" data-act="ltab" data-t="' + id + '">' + name + '</button>';
      h += '</div><div class="tabbody">';
      if (L.tab === 'build') {
        const owned = g.perks.ownedIds();
        h += '<h3>Weapon</h3><p><b>' + esc(g.weaponDef.name) + '</b> — ' + esc(g.weaponDef.description) + ' ' + g.weaponDef.params.damage + ' damage, ' + g.weaponDef.params.magazine + ' rounds, ' + g.weaponDef.params.reloadTime + ' s reload.</p>';
        h += '<h3>Perk slots ' + owned.length + ' / ' + HE.Run.PERK_SLOTS + '</h3><div class="slots">';
        for (let i = 0; i < HE.Run.PERK_SLOTS; i++) {
          const id = owned[i];
          if (!id) {
            h += '<div class="slot empty">empty</div>';
            continue;
          }
          const def = D.perkById[id];
          const r = g.perks.rank(id);
          h += '<div class="slot"><b>' + esc(def.name) + '</b> <span class="rank">' + r + '/' + def.maxRank + '</span><div class="small">' + esc(def.desc[r - 1]) + '</div><div class="muted small">Trigger: ' + esc(def.trigger) + ' · proc ' + def.procCoef + '</div></div>';
        }
        h += '</div>';
        if (!g.run) h += '<p class="muted">No active run. Your build appears here during a run.</p>';
        h += '<h3>Rules that matter</h3><ul class="small"><li>Secondary hits (fragments, arcs, orbitals, zones, spin attacks) apply on-hit effects at proc coefficient ' + D.TUNING.procs.secondaryCoef + '.</li><li>Chains go at most ' + D.TUNING.procs.maxDepth + ' levels deep and emit at most ' + D.TUNING.procs.budget + ' effects per attack (' + D.TUNING.procs.jackpotBudget + ' during a jackpot); extra effects become plain damage.</li><li>Damage order: base → flat → additive (Loaded Chambers, Ricochet rank 3) → multiplicative (Crown, frozen bonus, boss stagger) → cap 999.</li><li>Spin attacks never generate spin charge. Each bullet can be grazed once. Each kill pays once.</li></ul>';
      } else if (L.tab === 'recipes') {
        const tags = [...new Set(D.perks.flatMap((p) => p.tags))].sort();
        h += '<div class="row filters"><input type="search" placeholder="Search recipes or items" data-in="q" value="' + esc(L.q) + '"><select data-in="tag"><option value="">All tags</option>' + tags.map((t) => '<option ' + (L.tag === t ? 'selected' : '') + '>' + esc(t) + '</option>').join('') + '</select><label class="check"><input type="checkbox" data-in="reveal" ' + (L.reveal ? 'checked' : '') + '> Reveal all</label></div><div id="reclist"></div>';
      } else if (L.tab === 'odds') {
        const s = g.slots;
        const t = s.reelTables();
        h += '<p class="muted small">' + (g.run ? 'Current machine state' : 'Default machine (start a run to see your reels)') + '. Resolution order: loadout weights → held results → draw unheld → announced guarantee → wildcard → classify → effects.</p><table class="ledger-t odds-t"><tr><th>Symbol</th><th>Reel 1</th><th>Reel 2</th><th>Reel 3</th><th>Triple</th></tr>';
        const od = s.odds();
        D.symbols.forEach((sym, k) => {
          h += '<tr><td>' + HE.symbolSVG(sym.id, 18) + ' ' + esc(sym.name) + '</td><td>' + fmt.pct(t[0][k], 1) + '</td><td>' + fmt.pct(t[1][k], 1) + '</td><td>' + fmt.pct(t[2][k], 1) + '</td><td>' + fmt.pct(od.bySymbolTriple[sym.id], 2) + '</td></tr>';
        });
        h += '</table><p>777 jackpot: <b>' + fmt.odds(od.jackpot) + '</b> · any triple ' + fmt.pct(od.triple + od.jackpot, 2) + ' · pair ' + fmt.pct(od.pair, 2) + ' · mixed ' + fmt.pct(od.mixed, 2) + '</p><h3>What each symbol does</h3><table class="ledger-t small"><tr><th></th><th>Single</th><th>Pair</th><th>Triple</th></tr>';
        for (const sym of D.symbols) h += '<tr><td>' + HE.symbolSVG(sym.id, 20) + '</td><td>' + esc(sym.single) + '</td><td>' + esc(sym.pair) + '</td><td>' + esc(sym.triple) + '</td></tr>';
        h += '</table>';
        if (g.run) h += this._holdPanel();
      } else if (L.tab === 'log') {
        g.debug.logDamage = true;
        const log = g.debug.damageLog.slice(-40).reverse();
        h += '<p class="muted small">DEBUG — last 40 damage events (logging is on while this tab has been opened).</p><table class="ledger-t mono small"><tr><th>t</th><th>target</th><th>dmg</th><th>kind</th><th>depth</th><th>chain</th><th>primary</th></tr>' + log.map((x) => '<tr><td>' + x.t + '</td><td>' + esc(x.target) + '</td><td>' + x.dmg + '</td><td>' + esc(x.kind) + '</td><td>' + x.depth + '</td><td>' + esc(x.chain) + '</td><td>' + (x.primary ? 'yes' : '') + '</td></tr>').join('') + '</table>';
      }
      h += '</div></div>';
      return h;
    }

    _renderRecipeList() {
      const el = document.getElementById('reclist');
      if (!el) return;
      const g = this.game;
      const L = this.ledger;
      const disc = g.save.discovered.recipes;
      const q = L.q.trim().toLowerCase();
      let h = '<p class="muted small">Discovered ' + disc.length + ' / ' + D.recipes.length + ' recipes in this build. A recipe activates the moment you own all its ingredients; it never takes a slot.</p><div class="recipes">';
      for (const r of D.recipes) {
        const known = disc.includes(r.id) || L.reveal;
        const ings = r.ingredients.map((i) => D.perkById[i] || D.weaponById[i]);
        const text = (r.name + ' ' + r.description + ' ' + ings.map((x) => x.name).join(' ')).toLowerCase();
        if (q && !(known ? text : ings.map((x) => x.name).join(' ').toLowerCase()).includes(q)) continue;
        if (L.tag && !ings.some((x) => x.tags && x.tags.includes(L.tag))) continue;
        const active = g.perks.recipe(r.id);
        h += '<div class="recipe ' + (active ? 'active' : '') + (known ? '' : ' unknown') + '"><div class="row between"><b>' + (known ? esc(r.name) : '??? — undiscovered') + '</b><span class="muted small">' + r.id + (active ? ' · ACTIVE' : '') + '</span></div><div class="ings">';
        h += ings.map((x) => '<span class="' + (g.perks.has(x.id) ? 'have' : '') + '">' + esc(x.name) + '</span>').join('<i>+</i>');
        h += '</div>';
        if (known) h += '<p class="small">' + esc(r.description) + '</p><p class="muted small">Stacking: ' + esc(r.stacking) + '</p>';
        h += '</div>';
      }
      h += '</div>';
      el.innerHTML = h;
    }

    /* ----------------------------------------------------- settings */

    _settings() {
      const s = this.game.save.settings;
      const b = this.game.save.bindings;
      const tog = (k, label, note) => '<label class="set"><span>' + label + (note ? '<small>' + note + '</small>' : '') + '</span><input type="checkbox" data-set="' + k + '" ' + (s[k] ? 'checked' : '') + '></label>';
      const sl = (k, label, min, max, step, note) => '<label class="set"><span>' + label + (note ? '<small>' + note + '</small>' : '') + '</span><input type="range" min="' + min + '" max="' + max + '" step="' + step + '" value="' + s[k] + '" data-set="' + k + '"></label>';
      let h = '<div class="panel settings" role="dialog" aria-label="Settings"><div class="row between"><h2>Settings</h2><button class="btn ghost" data-act="closeOverlay" data-autofocus>Done <kbd>Esc</kbd></button></div><div class="cols"><div>';
      h += '<h3>Audio</h3>' + sl('music', 'Music', 0, 1, 0.05) + sl('sfx', 'Effects', 0, 1, 0.05) + sl('ui', 'Interface', 0, 1, 0.05);
      h += '<h3>Comfort &amp; effects</h3><p class="muted small">Reducing effects never hides an enemy attack and never lowers your damage.</p>';
      h += sl('shake', 'Screen shake', 0, 1, 0.1) + tog('flashes', 'Screen flashes') + tog('hitStop', 'Hit stop') + tog('damageNumbers', 'Damage numbers') + sl('effectDensity', 'Effect density', 0.25, 1, 0.25, 'friendly particles only') + tog('vibration', 'Controller vibration');
      h += '<h3>Assists</h3>' + tog('autoFire', 'Auto-fire', 'fires whenever an enemy is present') + tog('aimAssist', 'Aim assist (mouse)', 'always on for controllers') + tog('alwaysShowHitbox', 'Always show hitbox', 'otherwise shown in precision mode');
      h += '</div><div><h3>Keyboard</h3><p class="muted small">Click a binding, then press a key. Mouse: aim and left button to fire. Controller: left stick move, right stick aim, RT fire, A/LB dash, Y spin, LT precision, Start pause.</p><table class="ledger-t binds">';
      for (const a of HE.InputInfo.ACTIONS) {
        h += '<tr><td>' + HE.InputInfo.LABELS[a] + '</td><td><button class="btn key ' + (this._capturing === a ? 'capturing' : '') + '" data-act="rebind" data-a="' + a + '">' + (this._capturing === a ? 'press a key…' : esc(HE.InputInfo.keyLabel(b[a]))) + '</button></td></tr>';
      }
      h += '</table><button class="btn ghost" data-act="resetBinds">Reset keys</button>';
      h += '<h3>Save data</h3><p class="muted small">Saved automatically in this browser with a rolling backup.</p><button class="btn danger" data-act="wipe">Erase all progress</button></div></div></div>';
      return h;
    }

    /* -------------------------------------------------------- debug */

    _debug() {
      const g = this.game;
      let h = '<div class="panel ledger debug" role="dialog" aria-label="Developer tools"><div class="row between"><h2>DEV TOOLS <span class="red-t">DEBUG</span></h2><button class="btn ghost" data-act="closeOverlay" data-autofocus>Close</button></div>';
      h += '<p class="muted small">Every action here starts or uses a debug run: a throwaway copy of the account; nothing is saved. Forced reel results are labeled debug.</p>';
      h += '<h3>Give perk</h3><div class="row wrap">' + D.perks.map((p) => '<button class="btn small" data-act="dPerk" data-id="' + p.id + '">' + p.id + ' ' + esc(p.name) + '</button>').join('') + '</div>';
      h += '<h3>Recipe scenarios</h3><div class="row wrap">' + D.recipes.map((r) => '<button class="btn small" data-act="dRecipe" data-id="' + r.id + '">' + r.id + ' ' + esc(r.name) + '</button>').join('') + '</div>';
      h += '<h3>Force next spin</h3><div class="row wrap">';
      for (const combo of [['seven', 'seven', 'seven'], ['bullet', 'bullet', 'bullet'], ['bolt', 'bolt', 'bolt'], ['bell', 'bell', 'bell'], ['crown', 'crown', 'crown'], ['skull', 'skull', 'skull'], ['bolt', 'bolt', 'skull'], ['bullet', 'bell', 'crown']]) {
        h += '<button class="btn small" data-act="dReels" data-v="' + combo.join(',') + '">' + combo.map((c) => HE.symbolSVG(c, 16)).join('') + '</button>';
      }
      h += '<button class="btn small" data-act="dCharge">+100 charge</button></div>';
      h += '<h3>Encounters</h3><div class="row wrap"><input type="number" data-in="seed" value="' + (this._seed || 1234) + '" style="width:120px"><button class="btn small" data-act="dSeed">Start debug run with seed</button><button class="btn small" data-act="dStress">' + (g.stress ? 'Stop' : 'Start') + ' stress scene</button><button class="btn small" data-act="dGod">God mode: ' + (g.debug.godMode ? 'on' : 'off') + '</button></div>';
      h += '<h3>Frame timing</h3><pre id="dstats" class="mono small"></pre></div>';
      return h;
    }

    _updateDebugStats() {
      const el = document.getElementById('dstats');
      if (!el || !this.frameStats) return;
      const g = this.game;
      el.textContent = this.frameStats() + '\nenemies ' + g.enemies.n + '  hostile ' + g.bullets.n + '  friendly ' + g.shots.n + '  refused(shots/bullets) ' + g.shots.refused + '/' + g.bullets.refused;
    }

    /* ------------------------------------------------------- toasts */

    toast(text, kind) {
      const el = document.createElement('div');
      el.className = 'toast ' + (kind || '');
      // "TITLE: detail" toasts render as a heading plus a quieter line.
      const m = /^(RECIPE — [^:]+): (.*)$/.exec(text);
      if (m) {
        const t = document.createElement('b');
        t.textContent = m[1];
        const d = document.createElement('span');
        d.textContent = m[2];
        el.appendChild(t);
        el.appendChild(d);
      } else el.textContent = text;
      this.toastsEl.appendChild(el);
      while (this.toastsEl.children.length > 3) this.toastsEl.firstChild.remove();
      setTimeout(() => el.classList.add('out'), kind === 'recipe' ? 5200 : 3200);
      setTimeout(() => el.remove(), kind === 'recipe' ? 5800 : 3800);
    }

    /* ------------------------------------------------------ actions */

    _input(e) {
      const t = e.target;
      const g = this.game;
      if (t.dataset.set) {
        const k = t.dataset.set;
        const s = g.save.settings;
        s[k] = t.type === 'checkbox' ? t.checked : parseFloat(t.value);
        this._applySettings();
        g.persist();
        this.key = this.screenName() + '|' + this._contentKey(this.screenName());
        return;
      }
      if (t.dataset.in === 'q') {
        this.ledger.q = t.value;
        this._renderRecipeList();
      } else if (t.dataset.in === 'tag') {
        this.ledger.tag = t.value;
        this._renderRecipeList();
      } else if (t.dataset.in === 'reveal') {
        this.ledger.reveal = t.checked;
        this._renderRecipeList();
      } else if (t.dataset.in === 'seed') {
        this._seed = parseInt(t.value, 10) || 0;
      } else if (t.dataset.act === 'guided') {
        this.guided = t.checked;
      } else if (t.dataset.act === 'preset') {
        g.setPreset('loaded_seven', t.checked);
      }
    }

    _applySettings() {
      const s = this.game.save.settings;
      this.audio.setLevels(s);
      this.game.fx.density = s.effectDensity;
    }

    _click(e) {
      const b = e.target.closest('[data-act]');
      if (!b || b.disabled || b.tagName === 'INPUT') return;
      const g = this.game;
      const act = b.dataset.act;
      const i = b.dataset.i != null ? parseInt(b.dataset.i, 10) : null;
      this.audio.unlock();
      g.sfx('ui_click');
      switch (act) {
        case 'start':
          g.startRun({ tutorial: this.guided });
          break;
        case 'resume':
          g.resumeRun();
          break;
        case 'abandonSaved':
          this.openOverlay('confirm', {
            title: 'Abandon the saved run?',
            text: 'You recover 25% of its loose chips into your bank. This cannot be undone.',
            yes: 'Abandon',
            onYes: () => {
              if (g.resumeRun()) g.abandonRun();
            },
          });
          break;
        case 'collect':
          g.collectFacility('slot_alley');
          break;
        case 'collectClose':
          g.collectFacility('slot_alley');
          this.closeOverlay();
          break;
        case 'buyFac': {
          const res = g.buyFacility('slot_alley');
          if (res.ok) for (const m of res.milestones) this.toast('Unlocked — ' + m.text, 'recipe');
          break;
        }
        case 'buyUp':
          g.buyUpgrade(b.dataset.id);
          break;
        case 'ledger':
          this.openOverlay('ledger', { back: this.overlay === 'pause' || g.paused ? 'pause' : null });
          break;
        case 'settings':
          this.openOverlay('settings', { back: this.overlay === 'pause' || g.paused ? 'pause' : null });
          break;
        case 'debug':
          this.openOverlay('debug');
          break;
        case 'closeOverlay':
          this.closeOverlay();
          break;
        case 'stake':
          g.placeWager(parseInt(b.dataset.v, 10));
          break;
        case 'decline':
          g.declineWager();
          break;
        case 'choose':
          g.chooseDraft(i);
          break;
        case 'reroll':
          g.rerollDraft();
          break;
        case 'ban':
          g.banDraft(i);
          break;
        case 'door':
          g.chooseDoor(i);
          break;
        case 'hold':
          g.setHold(i, !g.slots.holds[i]);
          this.key = '';
          break;
        case 'shopBuy':
          g.shopBuy(b.dataset.id);
          break;
        case 'leaveShop':
          g.leaveShop();
          break;
        case 'bank':
          g.terminalBank();
          break;
        case 'press':
          g.terminalPress();
          break;
        case 'continue':
          g.terminalContinue();
          break;
        case 'finish':
          g.terminalFinish();
          break;
        case 'vault':
          g.terminalVault();
          break;
        case 'toHub':
          g.endRun();
          break;
        case 'resumePlay':
          this.overlay = null;
          g.paused = false;
          this.key = '';
          break;
        case 'skipTut':
          g.skipTutorial();
          this.overlay = null;
          g.paused = false;
          this.key = '';
          break;
        case 'abandon':
          this.openOverlay('confirm', {
            title: 'Abandon this run?',
            text: 'This counts as a defeat: you recover 25% of loose, unstaked chips. An active wager is lost.',
            yes: 'Abandon run',
            back: 'pause',
            onYes: () => {
              g.paused = false;
              g.abandonRun();
            },
          });
          break;
        case 'confirmYes': {
          const d = this.overlayData;
          this.overlay = null;
          this.overlayData = null;
          this.key = '';
          if (d && d.onYes) d.onYes();
          break;
        }
        case 'confirmNo':
          this.closeOverlay();
          break;
        case 'ltab':
          this.ledger.tab = b.dataset.t;
          break;
        case 'rebind': {
          const a = b.dataset.a;
          this._capturing = a;
          this.input.captureNext((code) => {
            const binds = g.save.bindings;
            if (code !== 'Escape' || a === 'pause') {
              for (const k of Object.keys(binds)) if (binds[k] === code && k !== a) binds[k] = binds[a];
              binds[a] = code;
              g.persist();
            }
            this._capturing = null;
          });
          break;
        }
        case 'resetBinds':
          g.save.bindings = HE.Save.defaultBindings();
          g.persist();
          break;
        case 'wipe':
          this.openOverlay('confirm', {
            title: 'Erase all progress?',
            text: 'Deletes the save, its backup and any saved run from this browser.',
            yes: 'Erase everything',
            onYes: () => {
              g.saveSystem.wipe();
              location.reload();
            },
          });
          break;
        case 'dPerk':
          g.debugGivePerk(b.dataset.id);
          this.closeOverlay();
          break;
        case 'dRecipe':
          g.debugRecipeScenario(b.dataset.id);
          this.overlay = null;
          g.paused = false;
          break;
        case 'dReels':
          g.debugEnsureRun();
          g.debugForceReels(b.dataset.v.split(','));
          g.debugCharge(100);
          this.overlay = null;
          g.paused = false;
          break;
        case 'dCharge':
          g.debugEnsureRun();
          g.debugCharge(100);
          break;
        case 'dSeed':
          g.startRun({ debug: true, seed: this._seed || 1234, tutorial: false });
          this.overlay = null;
          g.paused = false;
          break;
        case 'dStress':
          g.debugStress(!g.stress);
          this.overlay = null;
          g.paused = false;
          break;
        case 'dGod':
          g.debug.godMode = !g.debug.godMode;
          this.key = '';
          break;
      }
    }

    /** Keyboard shortcuts on safe screens. Returns true if consumed. */
    key1to3(n) {
      const name = this.screenName();
      if (name === 'draft') return this.game.chooseDraft(n);
      if (name === 'doors') return this.game.chooseDoor(n);
      return false;
    }
  }

  HE.UI = UI;
})(typeof window !== 'undefined' ? window : globalThis);
