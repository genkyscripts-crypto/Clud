/*
 * PROCEDURAL AUDIO — every sound and all music is synthesized with WebAudio
 * at runtime. There are no audio files.
 *
 * Mixing: three buses (music, effects, UI) under a master compressor. Each
 * sound has a priority, a per-name throttle and a per-name voice cap, and a
 * global voice cap drops the lowest-priority requests first, so a powerful
 * build never turns into harsh noise.
 */
(function (root) {
  'use strict';
  const HE = root.HE;

  const MAX_VOICES = 30;

  /** name → [bus, priority (higher wins), throttle ms, max concurrent] */
  const META = {
    shot: ['sfx', 3, 25, 4],
    shot_heavy: ['sfx', 5, 40, 2],
    shot_gold: ['sfx', 4, 30, 4],
    reload: ['sfx', 3, 80, 1],
    ricochet: ['sfx', 1, 45, 3],
    enemy_death: ['sfx', 2, 30, 4],
    elite_death: ['sfx', 6, 60, 2],
    boss_death: ['sfx', 9, 500, 1],
    enemy_fire: ['sfx', 2, 60, 3],
    ring: ['sfx', 4, 90, 2],
    snipe: ['sfx', 6, 80, 2],
    graze: ['sfx', 2, 35, 3],
    chip: ['sfx', 1, 28, 3],
    chip_stack: ['ui', 4, 100, 1],
    dash: ['sfx', 5, 60, 2],
    spin: ['sfx', 7, 200, 1],
    spin_stop: ['sfx', 6, 100, 1],
    pair: ['sfx', 7, 150, 1],
    triple: ['sfx', 8, 200, 1],
    jackpot: ['sfx', 10, 250, 1],
    bell: ['sfx', 6, 120, 1],
    shock: ['sfx', 2, 50, 3],
    freeze: ['sfx', 3, 60, 2],
    explosion: ['sfx', 5, 45, 3],
    storm: ['sfx', 2, 60, 2],
    hurt: ['sfx', 9, 80, 1],
    shield_block: ['sfx', 8, 80, 1],
    death: ['sfx', 10, 500, 1],
    boss_phase: ['sfx', 9, 400, 1],
    boss_slam: ['sfx', 8, 300, 1],
    wheel: ['sfx', 8, 400, 1],
    stagger: ['sfx', 7, 300, 1],
    room_clear: ['ui', 7, 400, 1],
    perk: ['ui', 6, 100, 1],
    recipe: ['ui', 8, 200, 1],
    bank: ['ui', 8, 300, 1],
    press_on: ['ui', 8, 300, 1],
    purchase: ['ui', 7, 120, 1],
    deny: ['ui', 3, 150, 1],
    wager_win: ['ui', 8, 300, 1],
    wager_lose: ['ui', 7, 300, 1],
    ui_click: ['ui', 3, 40, 2],
    ui_hover: ['ui', 1, 40, 1],
    ui_shuffle: ['ui', 4, 100, 1],
    heal: ['ui', 5, 150, 1],
    block: ['sfx', 2, 50, 2],
  };

  class Audio {
    constructor() {
      this.ctx = null;
      this.ok = false;
      this.voices = [];
      this.last = {};
      this.musicMode = 'none';
      this.step = 0;
      this.nextTime = 0;
      this.timer = null;
      this.levels = { music: 0.55, sfx: 0.8, ui: 0.7 };
    }

    /** Must be called from a user gesture. Safe to call repeatedly. */
    unlock() {
      if (this.ctx) {
        if (this.ctx.state === 'suspended') this.ctx.resume();
        return;
      }
      const AC = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
      if (!AC) return;
      try {
        this.ctx = new AC();
      } catch (e) {
        return;
      }
      const c = this.ctx;
      this.master = c.createDynamicsCompressor();
      this.master.threshold.value = -14;
      this.master.ratio.value = 4;
      this.master.connect(c.destination);
      this.bus = {};
      for (const k of ['music', 'sfx', 'ui']) {
        const g = c.createGain();
        g.gain.value = this.levels[k];
        g.connect(this.master);
        this.bus[k] = g;
      }
      const len = c.sampleRate * 1;
      this.noise = c.createBuffer(1, len, c.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this.ok = true;
      this.timer = setInterval(() => this._schedule(), 25);
    }

    setLevels(settings) {
      this.levels = { music: settings.music, sfx: settings.sfx, ui: settings.ui };
      if (!this.ok) return;
      for (const k of Object.keys(this.bus)) this.bus[k].gain.setTargetAtTime(this.levels[k], this.ctx.currentTime, 0.05);
    }

    /* ------------------------------------------------------ primitives */

    _voice(bus, pri, dur) {
      const now = this.ctx.currentTime;
      this.voices = this.voices.filter((v) => v.end > now);
      if (this.voices.length >= MAX_VOICES) {
        let low = null;
        for (const v of this.voices) if (!low || v.pri < low.pri) low = v;
        if (!low || low.pri >= pri) return null;
        try {
          low.gain.gain.cancelScheduledValues(now);
          low.gain.gain.setValueAtTime(0, now);
        } catch (e) {
          /* ignore */
        }
        this.voices.splice(this.voices.indexOf(low), 1);
      }
      const g = this.ctx.createGain();
      g.connect(this.bus[bus]);
      const v = { gain: g, end: now + dur, pri };
      this.voices.push(v);
      return g;
    }

    _osc(out, type, f0, f1, t0, dur, gain, attack) {
      const c = this.ctx;
      const o = c.createOscillator();
      const g = c.createGain();
      o.type = type;
      o.frequency.setValueAtTime(f0, t0);
      if (f1 && f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + dur);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(gain, t0 + (attack || 0.004));
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.connect(g);
      g.connect(out);
      o.start(t0);
      o.stop(t0 + dur + 0.02);
    }

    _noise(out, filterType, f0, f1, q, t0, dur, gain) {
      const c = this.ctx;
      const s = c.createBufferSource();
      s.buffer = this.noise;
      s.loop = true;
      const f = c.createBiquadFilter();
      f.type = filterType;
      f.Q.value = q || 0.8;
      f.frequency.setValueAtTime(f0, t0);
      if (f1 && f1 !== f0) f.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t0 + dur);
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(gain, t0 + 0.003);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      s.connect(f);
      f.connect(g);
      g.connect(out);
      s.start(t0, Math.random() * 0.5);
      s.stop(t0 + dur + 0.02);
    }

    _bell(out, f, t0, dur, gain) {
      this._osc(out, 'sine', f, f, t0, dur, gain);
      this._osc(out, 'sine', f * 2.76, f * 2.76, t0, dur * 0.6, gain * 0.35);
      this._osc(out, 'sine', f * 5.4, f * 5.4, t0, dur * 0.35, gain * 0.15);
    }

    /* ----------------------------------------------------------- sfx */

    play(name, pan) {
      if (!this.ok) return;
      const meta = META[name];
      if (!meta) return;
      const nowMs = performance.now();
      if (this.last[name] && nowMs - this.last[name] < meta[2]) return;
      const now = this.ctx.currentTime;
      const active = this.voices.filter((v) => v.name === name && v.end > now).length;
      if (active >= meta[3]) return;
      this.last[name] = nowMs;
      const dur = 0.9;
      let out = this._voice(meta[0], meta[1], dur);
      if (!out) return;
      this.voices[this.voices.length - 1].name = name;
      if (pan != null && this.ctx.createStereoPanner) {
        const p = this.ctx.createStereoPanner();
        p.pan.value = Math.max(-0.8, Math.min(0.8, pan));
        p.connect(out);
        out = p;
      }
      const t = now + 0.001;
      const j = 1 + (Math.random() - 0.5) * 0.06;
      switch (name) {
        case 'shot':
          this._noise(out, 'bandpass', 2200 * j, 700, 0.9, t, 0.07, 0.5);
          this._osc(out, 'triangle', 170 * j, 55, t, 0.09, 0.55);
          break;
        case 'shot_heavy':
          this._noise(out, 'bandpass', 1500, 300, 0.7, t, 0.2, 0.8);
          this._osc(out, 'sine', 120, 38, t, 0.22, 0.9);
          this._noise(out, 'lowpass', 900, 200, 0.5, t + 0.02, 0.35, 0.25);
          break;
        case 'shot_gold':
          this._noise(out, 'bandpass', 3000 * j, 1200, 1, t, 0.05, 0.35);
          this._osc(out, 'triangle', 1320 * j, 880, t, 0.08, 0.18);
          this._osc(out, 'sine', 150, 60, t, 0.07, 0.4);
          break;
        case 'reload':
          this._noise(out, 'highpass', 2500, 2500, 1, t, 0.03, 0.35);
          this._noise(out, 'highpass', 1800, 1800, 1, t + 0.12, 0.04, 0.4);
          this._osc(out, 'square', 420, 380, t + 0.12, 0.03, 0.05);
          break;
        case 'ricochet':
          this._osc(out, 'sine', 2600 * j, 900, t, 0.13, 0.08);
          break;
        case 'enemy_death':
          this._noise(out, 'bandpass', 1400 * j, 300, 1.2, t, 0.12, 0.35);
          this._osc(out, 'triangle', 1500 * j, 1500, t + 0.03, 0.05, 0.1);
          this._osc(out, 'triangle', 2000 * j, 2000, t + 0.07, 0.05, 0.08);
          break;
        case 'elite_death':
          this._noise(out, 'lowpass', 1200, 120, 0.8, t, 0.4, 0.6);
          this._osc(out, 'sine', 140, 40, t, 0.35, 0.7);
          for (let i = 0; i < 5; i++) this._osc(out, 'triangle', 1400 + i * 260, 1400 + i * 260, t + 0.05 + i * 0.04, 0.05, 0.08);
          break;
        case 'boss_death':
          this._noise(out, 'lowpass', 1500, 60, 0.6, t, 0.85, 0.9);
          this._osc(out, 'sine', 90, 25, t, 0.85, 0.9);
          [523, 659, 784, 1047].forEach((f, i) => this._bell(out, f, t + 0.1 + i * 0.09, 0.6, 0.12));
          break;
        case 'enemy_fire':
          this._osc(out, 'square', 520 * j, 380, t, 0.05, 0.04);
          break;
        case 'ring':
          this._osc(out, 'sine', 330 * j, 300, t, 0.3, 0.1, 0.02);
          this._osc(out, 'sine', 495 * j, 450, t, 0.3, 0.07, 0.02);
          break;
        case 'snipe':
          this._noise(out, 'highpass', 3500, 3500, 0.8, t, 0.06, 0.4);
          this._osc(out, 'sawtooth', 900, 180, t, 0.16, 0.1);
          break;
        case 'graze':
          this._osc(out, 'sine', 3400 * j, 3000, t, 0.035, 0.05);
          break;
        case 'chip':
          this._osc(out, 'triangle', 1800 * j, 2300, t, 0.05, 0.08);
          break;
        case 'chip_stack':
          for (let i = 0; i < 4; i++) this._noise(out, 'bandpass', 3000 + i * 300, 3000, 4, t + i * 0.035, 0.03, 0.3);
          break;
        case 'dash':
          this._noise(out, 'bandpass', 600, 2600, 0.7, t, 0.16, 0.3);
          break;
        case 'spin':
          for (let i = 0; i < 10; i++) this._noise(out, 'bandpass', 2400, 2400, 5, t + i * 0.055, 0.02, 0.25);
          break;
        case 'spin_stop':
          this._osc(out, 'triangle', 300, 160, t, 0.1, 0.35);
          this._noise(out, 'bandpass', 1500, 1500, 3, t, 0.04, 0.3);
          break;
        case 'pair':
          this._bell(out, 1319, t, 0.35, 0.16);
          this._bell(out, 1976, t + 0.08, 0.4, 0.14);
          break;
        case 'triple':
          [784, 988, 1175, 1568].forEach((f, i) => this._bell(out, f, t + i * 0.07, 0.45, 0.14));
          this._noise(out, 'highpass', 6000, 6000, 1, t, 0.4, 0.08);
          break;
        case 'jackpot':
          [523, 659, 784, 1047, 1319, 1568, 2093].forEach((f, i) => this._bell(out, f, t + i * 0.06, 0.6, 0.14));
          this._noise(out, 'highpass', 5000, 9000, 1, t, 0.8, 0.12);
          this._osc(out, 'sine', 110, 55, t, 0.5, 0.6);
          break;
        case 'bell':
          this._bell(out, 880, t, 0.6, 0.2);
          break;
        case 'shock':
          this._osc(out, 'square', 95 * j, 70, t, 0.11, 0.08);
          this._noise(out, 'highpass', 4000, 4000, 1, t, 0.07, 0.12);
          break;
        case 'freeze':
          this._osc(out, 'sine', 2600, 3200, t, 0.18, 0.06);
          this._osc(out, 'sine', 3900, 4200, t + 0.03, 0.14, 0.04);
          break;
        case 'explosion':
          this._noise(out, 'lowpass', 1000 * j, 90, 0.7, t, 0.45, 0.8);
          this._osc(out, 'sine', 95, 30, t, 0.35, 0.7);
          break;
        case 'storm':
          this._noise(out, 'bandpass', 2200, 1200, 1, t, 0.05, 0.2);
          break;
        case 'hurt':
          this._osc(out, 'square', 220, 90, t, 0.16, 0.2);
          this._noise(out, 'lowpass', 1200, 300, 0.7, t, 0.15, 0.4);
          break;
        case 'shield_block':
          this._bell(out, 1760, t, 0.3, 0.18);
          this._noise(out, 'highpass', 5000, 5000, 1, t, 0.05, 0.2);
          break;
        case 'death':
          [392, 330, 262, 196].forEach((f, i) => this._osc(out, 'triangle', f, f * 0.97, t + i * 0.13, 0.3, 0.2));
          this._noise(out, 'lowpass', 600, 80, 0.7, t, 0.8, 0.4);
          break;
        case 'boss_phase':
          this._osc(out, 'sawtooth', 110, 104, t, 0.7, 0.12, 0.02);
          this._osc(out, 'sawtooth', 165, 156, t, 0.7, 0.09, 0.02);
          this._osc(out, 'sine', 55, 40, t, 0.7, 0.4);
          break;
        case 'boss_slam':
          this._noise(out, 'lowpass', 700, 80, 0.7, t, 0.5, 0.7);
          this._osc(out, 'sine', 70, 30, t, 0.5, 0.8);
          break;
        case 'wheel':
          for (let i = 0; i < 14; i++) this._noise(out, 'bandpass', 3200, 3200, 6, t + Math.pow(i / 14, 1.6) * 0.85, 0.018, 0.3);
          break;
        case 'stagger':
          this._osc(out, 'triangle', 600, 150, t, 0.35, 0.15);
          break;
        case 'room_clear':
          [523, 659, 784].forEach((f) => this._osc(out, 'triangle', f, f, t, 0.5, 0.08, 0.01));
          this._bell(out, 1568, t + 0.05, 0.5, 0.08);
          break;
        case 'perk':
          this._bell(out, 1047, t, 0.4, 0.14);
          this._bell(out, 1568, t + 0.06, 0.4, 0.1);
          break;
        case 'recipe':
          [784, 1047, 1319, 1568, 2093].forEach((f, i) => this._bell(out, f, t + i * 0.05, 0.5, 0.11));
          break;
        case 'bank':
          for (let i = 0; i < 12; i++) this._osc(out, 'triangle', 1600 + Math.random() * 900, 1800, t + i * 0.035, 0.05, 0.07);
          [392, 494, 587, 784].forEach((f) => this._osc(out, 'triangle', f, f, t + 0.3, 0.55, 0.06, 0.02));
          break;
        case 'press_on':
          this._osc(out, 'sawtooth', 110, 440, t, 0.5, 0.08, 0.05);
          this._noise(out, 'bandpass', 400, 3000, 1, t, 0.5, 0.15);
          break;
        case 'purchase':
          this._bell(out, 1319, t, 0.3, 0.15);
          this._bell(out, 1760, t + 0.07, 0.45, 0.14);
          break;
        case 'deny':
          this._osc(out, 'square', 140, 120, t, 0.14, 0.08);
          break;
        case 'wager_win':
          [659, 784, 988, 1319].forEach((f, i) => this._bell(out, f, t + i * 0.07, 0.4, 0.13));
          break;
        case 'wager_lose':
          [330, 262].forEach((f, i) => this._osc(out, 'triangle', f, f * 0.95, t + i * 0.14, 0.3, 0.14));
          break;
        case 'ui_click':
          this._noise(out, 'bandpass', 2800, 2800, 3, t, 0.02, 0.2);
          break;
        case 'ui_hover':
          this._osc(out, 'sine', 1800, 1800, t, 0.02, 0.025);
          break;
        case 'ui_shuffle':
          for (let i = 0; i < 6; i++) this._noise(out, 'bandpass', 2000, 2000, 2, t + i * 0.03, 0.025, 0.2);
          break;
        case 'heal':
          this._osc(out, 'sine', 523, 1047, t, 0.35, 0.1, 0.03);
          break;
        case 'block':
          this._osc(out, 'square', 900, 700, t, 0.04, 0.05);
          this._noise(out, 'highpass', 3000, 3000, 2, t, 0.03, 0.15);
          break;
      }
    }

    /* ---------------------------------------------------------- music */

    setMusic(mode) {
      if (mode === this.musicMode) return;
      this.musicMode = mode;
      this.step = 0;
      if (this.ok) this.nextTime = this.ctx.currentTime + 0.05;
    }

    _schedule() {
      if (!this.ok || this.musicMode === 'none') return;
      const c = this.ctx;
      if (this.nextTime < c.currentTime) this.nextTime = c.currentTime + 0.02;
      const MODES = {
        hub: { bpm: 92, root: 43, scale: [0, 3, 5, 7, 10], swing: 0.12 },
        calm: { bpm: 84, root: 45, scale: [0, 3, 7, 10], swing: 0.1 },
        combat: { bpm: 118, root: 40, scale: [0, 3, 5, 7, 10], swing: 0.04 },
        boss: { bpm: 128, root: 38, scale: [0, 1, 5, 7, 8], swing: 0 },
        jackpot: { bpm: 140, root: 45, scale: [0, 4, 7, 9, 12], swing: 0 },
      };
      const m = MODES[this.musicMode] || MODES.calm;
      const stepDur = 60 / m.bpm / 4;
      while (this.nextTime < c.currentTime + 0.14) {
        this._musicStep(m, this.step, this.nextTime, stepDur);
        this.step = (this.step + 1) % 64;
        this.nextTime += stepDur * (this.step % 2 ? 1 + m.swing : 1 - m.swing);
      }
    }

    _musicStep(m, step, t, sd) {
      const out = this.bus.music;
      const hz = (n) => 440 * Math.pow(2, (n - 69) / 12);
      const s16 = step % 16;
      const bar = Math.floor(step / 16);
      const prog = [0, 0, 3, 4][bar];
      const deg = (i) => m.scale[((i % m.scale.length) + m.scale.length) % m.scale.length] + 12 * Math.floor(i / m.scale.length);
      const mode = this.musicMode;
      // Bass.
      if (mode === 'hub' || mode === 'calm') {
        if (s16 % 4 === 0) this._osc(out, 'triangle', hz(m.root + deg(prog + (s16 / 4) * (mode === 'hub' ? 1 : 0))), 0, t, sd * 3.5, 0.16, 0.01);
      } else {
        const pat = mode === 'jackpot' ? [1, 0, 1, 1, 0, 1, 1, 0, 1, 0, 1, 1, 0, 1, 1, 1] : mode === 'boss' ? [1, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 0] : [1, 0, 0, 0, 1, 0, 1, 0, 1, 0, 0, 0, 1, 0, 1, 1];
        if (pat[s16]) this._osc(out, 'sawtooth', hz(m.root + deg(prog) - 12), 0, t, sd * 0.9, 0.09, 0.005);
      }
      // Drums.
      if (mode === 'combat' || mode === 'boss' || mode === 'jackpot') {
        if (s16 % 4 === 0) this._osc(out, 'sine', 120, 40, t, 0.16, mode === 'boss' ? 0.5 : 0.35);
        if (s16 % 8 === 4) this._noise(out, 'bandpass', 1800, 900, 0.8, t, 0.12, 0.18);
        if (s16 % 2 === 1 || mode === 'jackpot') this._noise(out, 'highpass', 7000, 7000, 1, t, 0.03, mode === 'jackpot' ? 0.09 : 0.06);
      } else if (s16 % 4 === 2) {
        this._noise(out, 'highpass', 8000, 8000, 1, t, 0.05, 0.035);
      }
      // Chords / arps.
      if (mode === 'jackpot') {
        this._osc(out, 'square', hz(m.root + 24 + deg(prog + s16)), 0, t, sd * 0.8, 0.028, 0.004);
        if (s16 === 0) this._bell(out, hz(m.root + 36 + deg(prog)), t, 0.6, 0.06);
      } else if (s16 === 0 || (mode !== 'calm' && s16 === 10)) {
        for (const k of [0, 2, 4]) this._osc(out, mode === 'hub' ? 'triangle' : 'sawtooth', hz(m.root + 12 + deg(prog + k)), 0, t, sd * (mode === 'hub' ? 6 : 2), mode === 'hub' ? 0.035 : 0.018, 0.02);
      }
      if ((mode === 'combat' || mode === 'boss') && s16 % 3 === 0 && bar % 2 === 1) this._osc(out, 'square', hz(m.root + 24 + deg(prog + s16)), 0, t, sd * 0.6, 0.012, 0.004);
    }
  }

  HE.Audio = Audio;
})(typeof window !== 'undefined' ? window : globalThis);
