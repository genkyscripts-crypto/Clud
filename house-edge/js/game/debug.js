/*
 * Developer-only tools (enabled with ?dev=1). Everything here either runs in
 * a debug run — which uses a throwaway copy of the account and never saves —
 * or labels its results (forced reel results carry `debug: true`).
 */
(function (root) {
  'use strict';
  const HE = root.HE;
  const D = HE.data;
  const P = HE.Game.prototype;

  /** Ends the guided Entrance and turns it into an ordinary first room. */
  P.skipTutorial = function () {
    if (!this.tutorial || !this.run) return false;
    this.tutorial = null;
    this.slots.demoQueue.length = 0;
    for (let i = 0; i < this.enemies.n; i++) {
      const e = this.enemies.items[i];
      e.noReward = true;
      e.dead = true;
    }
    this.run.room.type = 'combat';
    this.director = new HE.Director(this, HE.planRoom(this.floor(), 'combat', 0, this.run.wallet.heat, this.rngCombat));
    if (!this.run.debug) {
      this.save.tutorialDone = true;
      this.persist();
    }
    this.toast('Tutorial skipped. Reach the cash-out terminal.', 'info');
    return true;
  };

  P.debugEnsureRun = function (seed) {
    if (!this.run || !this.run.debug || this.run.settled) {
      this.startRun({ debug: true, seed: seed == null ? 1234 : seed });
      this._clearArena();
      this.run.room.type = 'combat';
      this.director = null;
      this.setState('combat');
    }
    return this.run;
  };

  P.debugGivePerk = function (id) {
    this.debugEnsureRun();
    const newly = this.perks.add(id);
    for (const r of newly) this.toast('RECIPE — ' + D.recipeById[r].name, 'recipe');
    return newly;
  };

  P.debugForceReels = function (symbols) {
    this.slots.debugForce = symbols.slice();
    this.toast('DEBUG: next spin forced to ' + symbols.join(' '), 'info');
  };

  P.debugCharge = function (n) {
    this.slots.addCharge(n);
  };

  /** Spawns a stationary dummy (no attacks, no rewards) for recipe checks. */
  P.debugDummy = function (role, x, y, hpMult) {
    const e = this.spawnEnemy(role || 'rusher', x, y, false, { slow: 0, hpMult: hpMult || 6, noReward: true, tag: 'dummy' });
    if (e) {
      e.spawnT = 0;
      e.attackDelay = 99999;
    }
    return e;
  };

  /** Reproducible setup for a recipe's verification scenario. */
  P.debugRecipeScenario = function (rid) {
    const r = D.recipeById[rid];
    if (!r) return false;
    this.startRun({ debug: true, seed: 777 });
    this._clearArena();
    this.run.room.type = 'combat';
    this.director = null;
    this.setState('combat');
    for (const ing of r.ingredients) if (D.perkById[ing]) this.perks.add(ing);
    const A = this.A;
    this.player.x = A.w / 2;
    this.player.y = A.h - 120;
    // A cluster in front of the player plus two near the side walls.
    for (let i = 0; i < 5; i++) this.debugDummy('rusher', A.w / 2 - 120 + i * 60, 260 + (i % 2) * 40, 8);
    this.debugDummy('dealer', 40, 200, 8);
    this.debugDummy('dealer', A.w - 40, 200, 8);
    this.debug.godMode = true;
    this.toast('SCENARIO ' + rid + ' — ' + r.name + ': ' + r.verification, 'recipe');
    return true;
  };

  /**
   * Stress scene: ~150 active enemies, ~1,500 hostile bullets and ~2,000
   * friendly projectiles kept topped up each frame. Invulnerable.
   */
  P.debugStress = function (on) {
    if (!on) {
      this.stress = null;
      this.debug.godMode = false;
      return;
    }
    this.startRun({ debug: true, seed: 99 });
    this._clearArena();
    this.run.room.type = 'combat';
    this.director = null;
    this.setState('combat');
    this.perks.add('P01');
    this.perks.add('P01');
    this.debug.godMode = true;
    this.stress = { enemies: 150, bullets: 1500, shots: 2000 };
  };

  P.debugStressTick = function () {
    const s = this.stress;
    if (!s || !this.run || this.run.state !== 'combat') return;
    const roles = ['rusher', 'dealer', 'ringcaster', 'sniper', 'usher'];
    let guard = 0;
    while (this.enemies.n < s.enemies && guard++ < 200) {
      const e = this.spawnEnemy(roles[this.enemies.n % roles.length], null, null, false, { hpMult: 400, noReward: true });
      if (!e) break;
      e.spawnT = 0;
    }
    const A = this.A;
    guard = 0;
    while (this.bullets.n < s.bullets && guard++ < 400) {
      const b = this.fireBullet(Math.random() * A.w, Math.random() * A.h, Math.random() * Math.PI * 2, 40 + Math.random() * 80, { life: 6 });
      if (!b) break;
    }
    guard = 0;
    while (this.shots.n < s.shots && guard++ < 400) {
      const sh = this.spawnShot(Math.random() * A.w, Math.random() * A.h, Math.random() * Math.PI * 2, 300 + Math.random() * 300, 0.01, 'frag', { life: 4, pierce: 999, procCoef: 0 });
      if (!sh) break;
      sh.bounces = 99;
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
