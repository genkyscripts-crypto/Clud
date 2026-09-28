/*
 * Wave director for the untimed practice range.
 *
 *   cleared ──(reset delay)──▶ active ──(all targets broken)──▶ cleared
 *
 * Intro waves play in authored order, introducing one target type at a time.
 * After that, patterns are drawn by weight from the pool (never the same one
 * twice in a row) and randomized only within the ranges the data allows.
 * The wave bonus is paid exactly once per wave.
 */
(function (root) {
  'use strict';
  const ZTA = root.ZTA;
  const D = ZTA.data;

  const WAVE_BONUS_SHARE = 0.25;
  const CLEAN_MULT = 2;
  const SPAWN_STAGGER = 0.07;

  class RangeDirector {
    constructor(game) {
      this.game = game;
      this.events = game.events;
      this.range = D.range;
      this.waveIndex = 0;
      this.state = 'idle';
      this.timer = 0;
      this.lastPatternId = null;
      this.wave = null;
      this._p = {};
      this._q = {};
    }

    start(delay) {
      this.state = 'cleared';
      this.timer = delay == null ? 0.5 : delay;
    }

    isActive() {
      return this.state === 'active';
    }

    update(dt) {
      if (this.state === 'cleared') {
        this.timer -= dt;
        if (this.timer <= 0) this.startWave();
      } else if (this.state === 'active') {
        if (this.game.targets.activeCount() === 0) this.clearWave();
      }
    }

    choosePattern() {
      const intro = D.waves.intro;
      if (this.waveIndex <= intro.length) return intro[this.waveIndex - 1];
      const rng = this.game.rng;
      const options = D.waves.pool.filter((p) => (p.minWave || 0) <= this.waveIndex && p.id !== this.lastPatternId);
      let total = 0;
      for (const p of options) total += p.weight || 1;
      let roll = rng.next() * total;
      for (const p of options) {
        roll -= p.weight || 1;
        if (roll <= 0) return p;
      }
      return options[options.length - 1];
    }

    /** Expands a pattern into concrete { type, slotId, count } groups. */
    expand(pattern) {
      const rng = this.game.rng;
      const groups = [];
      const add = (type, slotId, count) => {
        if (count <= 0) return;
        const g = groups.find((x) => x.type === type && x.slotId === slotId);
        if (g) g.count += count;
        else groups.push({ type, slotId, count });
      };
      for (const sp of pattern.spawns) {
        const slotId = Array.isArray(sp.slot) ? rng.pick(sp.slot) : sp.slot;
        const count = Array.isArray(sp.count) ? rng.int(sp.count[0], sp.count[1]) : sp.count;
        add(sp.type, slotId, count);
      }
      const extra = this.game.progression.rangeModifiers().extraTargets;
      for (let i = 0; i < extra; i++) add('tgt.plate', rng.pick(['row_near', 'row_mid', 'row_far']), 1);
      // Each rail carries at most one runner; rows cap at 6 plates so they stay readable.
      for (const g of groups) {
        const slot = this.range.slots[g.slotId];
        if (slot.kind === 'rail') g.count = Math.min(g.count, 1);
        if (slot.kind === 'row') g.count = Math.min(g.count, 6);
        if (slot.kind === 'crate') g.count = Math.min(g.count, 6);
        if (slot.kind === 'shelf') g.count = Math.min(g.count, 8);
      }
      return groups;
    }

    /** Screen-space overlap of a new plate with plates already placed nearer. */
    _occluded(x, y, z, r, placed) {
      const cam = this.game.camera;
      const a = cam.project(x, y, z, this._p, true);
      for (const o of placed) {
        if (o.z >= z) continue;
        const b = cam.project(o.x, o.y, o.z, this._q, true);
        const ra = r * a.s;
        const rb = o.r * b.s;
        const d = Math.hypot(a.sx - b.sx, a.sy - b.sy);
        if (d < rb + ra * 0.55) return true;
      }
      return false;
    }

    startWave() {
      const game = this.game;
      const rng = game.rng;
      this.waveIndex += 1;
      const pattern = this.choosePattern();
      this.lastPatternId = pattern.id;
      const groups = this.expand(pattern);

      // Place nearest slots first so farther rows can dodge them.
      const zOf = (slotId) => {
        const s = this.range.slots[slotId];
        if (s.kind === 'row') return this.range.rows[s.row].z;
        if (s.kind === 'rail') return this.range.rails[s.rail].z;
        return s.z;
      };
      groups.sort((a, b) => zOf(a.slotId) - zOf(b.slotId));

      const propSlots = groups.map((g) => g.slotId).filter((id) => {
        const k = this.range.slots[id].kind;
        return k === 'crate' || k === 'shelf';
      });
      game.targets.setProps(propSlots);

      const placed = [];
      const spawned = [];
      let delay = 0.12;
      const newTypes = [];
      const seen = game.save.flags.seenTargets;

      for (const g of groups) {
        const slot = this.range.slots[g.slotId];
        const def = D.targetById[g.type];
        for (const sp of this._positions(slot, g, def, placed, rng)) {
          if (spawned.length >= this.range.maxTargets) break;
          sp.delay = delay;
          sp.slotId = g.slotId;
          delay += SPAWN_STAGGER;
          const t = game.targets.spawn(g.type, sp);
          if (t) spawned.push(t);
        }
        if (!seen[g.type] && newTypes.indexOf(g.type) === -1) newTypes.push(g.type);
      }
      for (const id of newTypes) seen[id] = true;

      this.wave = { index: this.waveIndex, patternId: pattern.id, earned: 0, shots: 0, misses: 0, bonusPaid: false, count: spawned.length };
      this.state = 'active';
      game.combo.touch();
      this.events.emit('wave:start', { index: this.waveIndex, patternId: pattern.id, count: spawned.length, newTypes });
    }

    _positions(slot, g, def, placed, rng) {
      const out = [];
      const n = g.count;
      if (slot.kind === 'row') {
        const row = this.range.rows[slot.row];
        const span = slot.xMax - slot.xMin;
        const spacing = span / n;
        for (let i = 0; i < n; i++) {
          const scale = rng.range(0.9, 1.1);
          const r = def.shape.r * scale;
          const y = this.range.carrierY - ZTA.TARGET_CHAIN - r;
          let x = slot.xMin + spacing * (i + 0.5) + rng.range(-0.18, 0.18) * spacing;
          for (let tries = 0; tries < 6 && this._occluded(x, y, row.z, r, placed); tries++) {
            x = slot.xMin + rng.next() * span;
          }
          placed.push({ x, y, z: row.z, r });
          out.push({ x, z: row.z, baseY: this.range.carrierY, scale });
        }
      } else if (slot.kind === 'crate' || slot.kind === 'shelf') {
        const usable = slot.w * (slot.kind === 'crate' ? 0.86 : 0.92);
        const spacing = usable / n;
        for (let i = 0; i < n; i++) {
          const x = slot.x - usable / 2 + spacing * (i + 0.5) + rng.range(-0.12, 0.12) * spacing;
          const scale = rng.range(0.88, 1.12);
          out.push({ x, z: slot.z, baseY: slot.h, scale });
          placed.push({ x, y: slot.h + 0.15, z: slot.z, r: 0.08 });
        }
      } else if (slot.kind === 'rail') {
        const rail = this.range.rails[slot.rail];
        const fromLeft = rng.chance(0.5);
        const x = fromLeft ? rail.xMin + 0.6 : rail.xMax - 0.6;
        out.push({
          x,
          z: rail.z,
          baseY: 0,
          dir: fromLeft ? 1 : -1,
          speed: rng.range(def.speed[0], def.speed[1]),
          xMin: rail.xMin,
          xMax: rail.xMax,
        });
      }
      return out;
    }

    clearWave() {
      const w = this.wave;
      this.state = 'cleared';
      const delay = this.game.progression.rangeModifiers().waveDelay;
      this.timer = delay;
      if (!w || w.bonusPaid) return;
      w.bonusPaid = true;
      const clean = w.shots > 0 && w.misses === 0;
      const bonus = Math.max(1, Math.round(w.earned * WAVE_BONUS_SHARE * (clean ? CLEAN_MULT : 1)));
      const granted = this.game.economy.earn(bonus, 'wave', { wave: w.index });
      this.game.save.stats.wavesCleared += 1;
      this.events.emit('wave:clear', { index: w.index, bonus: granted, clean, delay });
    }

    /** Called by the game for every trigger pull. */
    onShot(result) {
      if (!this.wave || this.state !== 'active') return;
      this.wave.shots += 1;
      if (!result.anyHit) this.wave.misses += 1;
    }

    onReward(amount) {
      if (this.wave && this.state === 'active') this.wave.earned += amount;
    }
  }

  ZTA.RangeDirector = RangeDirector;
})(typeof window !== 'undefined' ? window : globalThis);
