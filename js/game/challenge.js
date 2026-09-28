/*
 * One challenge round.
 *
 *   countdown (3 s, no firing) ──▶ running ──▶ done
 *
 * Streams keep the range stocked from the challenge's weighted pool. The
 * round ends when time runs out, lives run out (endurance) or the boss core
 * breaks. Rewards go through Progression.recordChallenge, which pays each star
 * once. Nothing here grants cash per target beyond the normal break payout.
 */
(function (root) {
  'use strict';
  const ZTA = root.ZTA;
  const D = ZTA.data;

  const COUNTDOWN = 3;

  class ChallengeRun {
    constructor(game, def, modId) {
      this.game = game;
      this.def = def;
      this.mod = modId ? D.meta.modifiers.find((m) => m.id === modId) || null : null;
      this.duration = def.duration * (this.mod && this.mod.timeMult ? this.mod.timeMult : 1);
      this.state = 'countdown';
      this.countdown = COUNTDOWN;
      this.elapsed = 0;
      this.spawnT = 0;
      this.metrics = { breaks: 0, weakBreaks: 0, droneBreaks: 0, armorBreaks: 0, score: 0, misses: 0, escapes: 0, shots: 0 };
      this.livesLeft = def.lives || null;
      this.hpMult = this.mod && this.mod.hpMult ? this.mod.hpMult : 1;
      this.bossDefeated = false;
      this.bossTime = null;
      this.usedGuns = new Set();
      this.summary = null;
    }

    get timeLeft() {
      return Math.max(0, this.duration - this.elapsed);
    }
    get running() {
      return this.state === 'running';
    }
    /** Current value of the scored metric. */
    get value() {
      if (this.def.metric === 'bossTime') return this.bossTime != null ? this.bossTime : this.elapsed;
      return this.metrics[this.def.metric] || 0;
    }
    /** Stars the current value would earn right now (for the live HUD). */
    get liveStars() {
      return this.game.progression.starsFor(this.def, this.value, this.def.metric !== 'bossTime' || this.bossDefeated);
    }

    start() {
      const r = this.game.range;
      const slots = new Set();
      for (const e of this.def.stream ? this.def.stream.pool : []) for (const s of e.slots) if (['crate', 'shelf'].indexOf(r.slots[s].kind) !== -1) slots.add(s);
      this.game.targets.setProps(Array.from(slots));
    }

    update(dt) {
      if (this.state === 'countdown') {
        const before = Math.ceil(this.countdown);
        this.countdown -= dt;
        const after = Math.ceil(this.countdown);
        if (after !== before && after > 0) this.game.events.emit('challenge:tick', { n: after });
        if (this.countdown <= 0) {
          this.state = 'running';
          if (this.def.boss) this.game.targets.spawnBoss(this.def.boss, this.hpMult);
          this.game.events.emit('challenge:go', { def: this.def });
        }
        return;
      }
      if (this.state !== 'running') return;
      this.elapsed += dt;
      this._stream(dt);
      if (this.bossDefeated) this.finish(true);
      else if (this.livesLeft != null && this.livesLeft <= 0) this.finish(false);
      else if (this.elapsed >= this.duration) this.finish(this.def.metric !== 'bossTime');
    }

    _stream(dt) {
      const s = this.def.stream;
      if (!s) return;
      this.spawnT -= dt;
      if (this.spawnT > 0) return;
      const game = this.game;
      let alive = 0;
      for (const t of game.targets.list) if (t.state === 'active' && !t.part) alive++;
      if (alive >= s.maxAlive) {
        this.spawnT = 0.1;
        return;
      }
      const rng = game.rng;
      let total = 0;
      for (const e of s.pool) total += e.weight;
      let roll = rng.next() * total;
      let entry = s.pool[s.pool.length - 1];
      for (const e of s.pool) {
        roll -= e.weight;
        if (roll <= 0) {
          entry = e;
          break;
        }
      }
      const slot = rng.pick(entry.slots);
      const made = game.director.spawnOne(entry.type, slot, { hpMult: this.hpMult, sway: !!(this.mod && this.mod.sway) });
      this.spawnT = made ? s.interval : 0.15;
    }

    onShot(result, weaponId) {
      if (this.state !== 'running') return;
      this.metrics.shots++;
      this.usedGuns.add(weaponId);
      if (!result.anyHit) {
        this.metrics.misses++;
        if (this.mod && this.mod.missPenalty) this.elapsed += this.mod.missPenalty;
      }
    }

    onBreak(target, ctx) {
      if (this.state !== 'running') return;
      const m = this.metrics;
      m.breaks++;
      if (ctx.weak) m.weakBreaks++;
      if (target.kind === 'drone') m.droneBreaks++;
      if (target.armor > 0 && target.kind !== 'bosspart') m.armorBreaks++;
      m.score += Math.round(target.def.value * this.game.combo.mult);
      if (target.part && target.part.final) {
        this.bossDefeated = true;
        this.bossTime = Math.round(this.elapsed * 10) / 10;
      }
    }

    onEscape() {
      if (this.state !== 'running') return;
      this.metrics.escapes++;
      if (this.livesLeft != null) this.livesLeft = Math.max(0, this.livesLeft - 1);
    }

    finish(completed) {
      if (this.state === 'done') return;
      this.state = 'done';
      const game = this.game;
      game.targets.retireAll();
      const value = this.value;
      const summary = game.progression.recordChallenge(this.def.id, value, completed, this.mod ? this.mod.id : null);
      const xp = D.meta.mastery.xp.challenge * Math.max(1, summary.stars);
      for (const id of this.usedGuns) game.progression.addMasteryXp(id, xp);
      this.summary = summary;
      game.events.emit('challenge:end', { def: this.def, summary, metrics: Object.assign({}, this.metrics), value, completed, mod: this.mod, livesLeft: this.livesLeft });
    }
  }

  ChallengeRun.COUNTDOWN = COUNTDOWN;
  ZTA.ChallengeRun = ChallengeRun;
})(typeof window !== 'undefined' ? window : globalThis);
