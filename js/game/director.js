/*
 * Wave director for the untimed practice range, plus the placement rules that
 * challenge streams reuse.
 *
 *   cleared ──(reset delay)──▶ active ──(nothing left standing)──▶ cleared
 *
 * A range's intro waves play in authored order the first time you visit it,
 * introducing one mechanic at a time. After that, patterns are drawn by weight
 * from the range's pool (never the same one twice in a row) and randomized only
 * within the ranges the data allows. The wave bonus is paid exactly once.
 */
(function (root) {
  'use strict';
  const ZTA = root.ZTA;
  const D = ZTA.data;

  const CLEAN_MULT = 2;
  const SPAWN_STAGGER = 0.07;

  /** How many live targets each slot kind can hold at once (streams). */
  const SLOT_CAPACITY = { row: 6, crate: 6, shelf: 8, rail: 1, air: 3, popup: 3, barrels: 5, stand: 4, shutter: 3, rack: 2 };

  class RangeDirector {
    constructor(game) {
      this.game = game;
      this.events = game.events;
      this.waveIndex = 0;
      this.state = 'idle';
      this.timer = 0;
      this.lastPatternId = null;
      this.wave = null;
      this._p = {};
      this._q = {};
    }

    get range() {
      return this.game.range;
    }

    reset() {
      this.waveIndex = 0;
      this.state = 'idle';
      this.wave = null;
      this.lastPatternId = null;
    }

    start(delay) {
      this.state = 'cleared';
      this.timer = delay == null ? 0.5 : delay;
    }

    stop() {
      this.state = 'idle';
      this.wave = null;
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
      const r = this.range;
      const introDone = this.game.save.flags.rangeIntro[r.id];
      if (!introDone && this.waveIndex <= r.intro.length) return r.intro[this.waveIndex - 1];
      const rng = this.game.rng;
      let options = r.pool.filter((p) => (p.minWave || 0) <= this.waveIndex && p.id !== this.lastPatternId);
      if (!options.length) options = r.pool.slice();
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
      for (const g of groups) g.count = Math.min(g.count, SLOT_CAPACITY[this.range.slots[g.slotId].kind] || 6);
      return groups;
    }

    zOfSlot(slotId) {
      const r = this.range;
      const s = r.slots[slotId];
      if (s.kind === 'row') return r.rows[s.row].z;
      if (s.kind === 'rail') return r.rails[s.rail].z;
      if (s.kind === 'air') return (s.z[0] + s.z[1]) / 2;
      return s.z;
    }

    /** Screen-space overlap of a new target with ones already placed nearer. */
    _occluded(x, y, z, r, placed) {
      const cam = this.game.camera;
      const a = cam.project(x, y, z, this._p, true);
      for (const o of placed) {
        if (o.z >= z - 0.01) continue;
        const b = cam.project(o.x, o.y, o.z, this._q, true);
        if (Math.hypot(a.sx - b.sx, a.sy - b.sy) < o.r * b.s + r * a.s * 0.55) return true;
      }
      return false;
    }

    startWave() {
      const game = this.game;
      const r = this.range;
      this.waveIndex += 1;
      const pattern = this.choosePattern();
      this.lastPatternId = pattern.id;
      if (this.waveIndex >= r.intro.length) game.save.flags.rangeIntro[r.id] = true;
      const groups = this.expand(pattern);
      groups.sort((a, b) => this.zOfSlot(a.slotId) - this.zOfSlot(b.slotId));

      game.targets.setProps(groups.map((g) => g.slotId).filter((id) => ['crate', 'shelf'].indexOf(r.slots[id].kind) !== -1));

      const placed = [];
      const spawned = [];
      let delay = 0.12;
      const newTypes = [];
      const seen = game.save.flags.seenTargets;
      let popIndex = 0;

      for (const g of groups) {
        const slot = r.slots[g.slotId];
        const def = D.targetById[g.type];
        for (const sp of this.positions(slot, g.slotId, g.count, def, placed)) {
          if (spawned.length >= r.maxTargets) break;
          if (slot.kind === 'popup') {
            // Poppers alternate near and far on their own rhythm.
            sp.delay = 0.3 + popIndex * 0.85 + (g.slotId.indexOf('far') !== -1 ? 0.42 : 0);
            popIndex++;
          } else if (slot.kind === 'air') {
            sp.delay = delay + spawned.length * 0.5;
          } else {
            sp.delay = delay;
            delay += SPAWN_STAGGER;
          }
          sp.slotId = g.slotId;
          const t = game.targets.spawn(g.type, sp);
          if (t) spawned.push(t);
        }
        if (!seen[g.type] && newTypes.indexOf(g.type) === -1) newTypes.push(g.type);
      }
      for (const id of newTypes) seen[id] = true;

      this.wave = { index: this.waveIndex, patternId: pattern.id, earned: 0, shots: 0, misses: 0, bonusPaid: false, count: spawned.length };
      this.state = 'active';
      game.combo.touch(game.progression.globals().startCombo);
      this.events.emit('wave:start', { index: this.waveIndex, patternId: pattern.id, count: spawned.length, newTypes });
    }

    /**
     * Concrete spawn positions for `n` targets of `def` in a slot.
     * `placed` collects screen footprints so later rows can dodge earlier ones.
     */
    positions(slot, slotId, n, def, placed) {
      const r = this.range;
      const rng = this.game.rng;
      const out = [];
      const spread = (xMin, xMax, i, count, jitter) => {
        const spacing = (xMax - xMin) / count;
        return xMin + spacing * (i + 0.5) + rng.range(-jitter, jitter) * spacing;
      };
      switch (slot.kind) {
        case 'row': {
          const row = r.rows[slot.row];
          for (let i = 0; i < n; i++) {
            const scale = rng.range(0.9, 1.1);
            const rad = def.shape.r * scale;
            const y = r.carrierY - ZTA.TARGET_CHAIN - rad;
            let x = spread(slot.xMin, slot.xMax, i, n, 0.18);
            for (let tries = 0; tries < 6 && this._occluded(x, y, row.z, rad, placed); tries++) x = rng.range(slot.xMin, slot.xMax);
            placed.push({ x, y, z: row.z, r: rad });
            out.push({ x, z: row.z, baseY: r.carrierY, scale });
          }
          break;
        }
        case 'rack': {
          for (let i = 0; i < n; i++) {
            const x = spread(slot.xMin, slot.xMax, i, n, 0.15);
            for (const dz of slot.depth) {
              out.push({ x, z: slot.z + dz, baseY: 0, scale: 0.95, mount: 'post' });
              placed.push({ x, y: ZTA.TARGET_POST + 0.3, z: slot.z + dz, r: 0.3 });
            }
          }
          break;
        }
        case 'crate':
        case 'shelf': {
          const usable = slot.w * (slot.kind === 'crate' ? 0.86 : 0.92);
          for (let i = 0; i < n; i++) {
            const x = slot.x - usable / 2 + (usable / n) * (i + 0.5) + rng.range(-0.12, 0.12) * (usable / n);
            out.push({ x, z: slot.z, baseY: slot.h, scale: rng.range(0.88, 1.12) });
            placed.push({ x, y: slot.h + 0.15, z: slot.z, r: 0.08 });
          }
          break;
        }
        case 'rail': {
          const rail = r.rails[slot.rail];
          const fromLeft = rng.chance(0.5);
          out.push({ x: fromLeft ? rail.xMin + 0.6 : rail.xMax - 0.6, z: rail.z, baseY: 0, dir: fromLeft ? 1 : -1, speed: rng.range(def.speed[0], def.speed[1]), xMin: rail.xMin, xMax: rail.xMax });
          break;
        }
        case 'air': {
          for (let i = 0; i < n; i++) {
            const fromLeft = rng.chance(0.5);
            const alt = rng.range(slot.y[0], slot.y[1]);
            out.push({
              x: fromLeft ? slot.xMin : slot.xMax,
              z: rng.range(slot.z[0], slot.z[1]),
              baseY: alt,
              altitude: alt,
              dir: fromLeft ? 1 : -1,
              speed: rng.range(def.speed[0], def.speed[1]),
              xMin: slot.xMin - 0.2,
              xMax: slot.xMax + 0.2,
            });
          }
          break;
        }
        case 'popup':
          for (let i = 0; i < n; i++) out.push({ x: spread(slot.xMin, slot.xMax, i, n, 0.3), z: slot.z, baseY: 0, uptime: rng.range(def.uptime[0], def.uptime[1]) });
          break;
        case 'barrels':
        case 'stand':
        case 'shutter':
          for (let i = 0; i < n; i++) {
            const x = spread(slot.xMin, slot.xMax, i, n, 0.2);
            out.push({ x, z: slot.z + rng.range(-0.3, 0.3), baseY: 0 });
            placed.push({ x, y: 1, z: slot.z, r: 0.35 });
          }
          break;
        default:
          break;
      }
      return out;
    }

    /**
     * Spawns a single target into a slot for challenge streams, respecting
     * slot capacity and keeping it clear of targets already in the slot.
     */
    spawnOne(type, slotId, extra) {
      const game = this.game;
      const r = this.range;
      const slot = r.slots[slotId];
      if (!slot) return null;
      const cap = SLOT_CAPACITY[slot.kind] || 4;
      const live = game.targets.countIn(slotId);
      if (slot.kind === 'rack' ? live >= cap * slot.depth.length : live >= cap) return null;
      const def = D.targetById[type];
      const rng = game.rng;
      const existing = game.targets.list.filter((t) => t.state === 'active' && t.slotId === slotId);
      const minGap = slot.kind === 'crate' || slot.kind === 'shelf' ? 0.13 : slot.kind === 'row' ? 0.75 : 0.9;
      let sps = null;
      for (let tries = 0; tries < 8 && !sps; tries++) {
        const cands = this.positions(slot, slotId, slot.kind === 'crate' || slot.kind === 'shelf' ? 1 : 1, def, []);
        const c = cands[0];
        if (!c) return null;
        if (slot.kind === 'crate' || slot.kind === 'shelf') {
          const usable = slot.w * (slot.kind === 'crate' ? 0.86 : 0.92);
          c.x = slot.x + rng.range(-usable / 2, usable / 2);
        } else if (slot.kind === 'row' || slot.kind === 'popup' || slot.kind === 'barrels' || slot.kind === 'stand' || slot.kind === 'shutter') {
          c.x = rng.range(slot.xMin, slot.xMax);
        } else if (slot.kind === 'rack') {
          const x = rng.range(slot.xMin, slot.xMax);
          for (const cc of cands) cc.x = x;
        }
        if (slot.kind === 'air' || slot.kind === 'rail') {
          sps = cands;
          break;
        }
        if (existing.every((t) => Math.abs(t.x - c.x) >= minGap)) sps = cands;
      }
      if (!sps) return null;
      const out = [];
      for (const sp of sps) {
        sp.slotId = slotId;
        sp.delay = 0.05;
        Object.assign(sp, extra || {});
        const t = game.targets.spawn(type, sp);
        if (t) out.push(t);
      }
      return out.length ? out : null;
    }

    clearWave() {
      const w = this.wave;
      this.state = 'cleared';
      const mods = this.game.progression.rangeModifiers();
      this.timer = mods.waveDelay;
      if (!w || w.bonusPaid) return;
      w.bonusPaid = true;
      const clean = w.shots > 0 && w.misses === 0;
      const bonus = Math.max(1, Math.round(w.earned * mods.waveBonus * (clean ? CLEAN_MULT : 1)));
      const granted = this.game.economy.earn(bonus, 'wave', { wave: w.index });
      this.game.save.stats.wavesCleared += 1;
      this.events.emit('wave:clear', { index: w.index, bonus: granted, clean, delay: mods.waveDelay });
    }

    /** Called by the game for every resolved trigger pull. */
    onShot(result) {
      if (!this.wave || this.state !== 'active') return;
      this.wave.shots += 1;
      if (!result.anyHit) this.wave.misses += 1;
    }

    onReward(amount) {
      if (this.wave && this.state === 'active') this.wave.earned += amount;
    }
  }

  RangeDirector.SLOT_CAPACITY = SLOT_CAPACITY;
  ZTA.RangeDirector = RangeDirector;
})(typeof window !== 'undefined' ? window : globalThis);
