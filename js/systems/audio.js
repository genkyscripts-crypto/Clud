/*
 * PLACEHOLDER AUDIO — every sound here is synthesized with WebAudio at runtime.
 * There are no audio files, so nothing can fail to load. Recorded samples can
 * replace any recipe later via Audio.registerSample(name, url); if a sample
 * fails to load, the synthesized version keeps playing and no error is thrown.
 *
 * Controlled variation: every play gets a small random pitch and gain offset,
 * identical sounds are throttled, and concurrent voices are capped.
 */
(function (root) {
  'use strict';
  const ZTA = root.ZTA;

  const MAX_VOICES = 28;
  const THROTTLE_MS = 14;

  const GUNS = {
    pistol: {
      crack: { f: 3300, q: 0.7, g: 0.5, d: 0.035 },
      body: { f: 950, q: 0.9, g: 0.85, d: 0.13 },
      thump: { f0: 150, f1: 52, g: 0.85, d: 0.11 },
      tail: { f: 560, g: 0.26, d: 0.45 },
      send: 0.32,
      gain: 0.8,
    },
    smg: {
      crack: { f: 3900, q: 0.8, g: 0.42, d: 0.022 },
      body: { f: 1350, q: 1.0, g: 0.55, d: 0.065 },
      thump: { f0: 190, f1: 82, g: 0.5, d: 0.055 },
      tail: { f: 720, g: 0.14, d: 0.2 },
      send: 0.2,
      gain: 0.6,
    },
    shotgun: {
      crack: { f: 2300, q: 0.6, g: 0.6, d: 0.05 },
      body: { f: 520, q: 0.7, g: 1.0, d: 0.3 },
      thump: { f0: 115, f1: 34, g: 1.2, d: 0.26 },
      tail: { f: 340, g: 0.42, d: 0.9 },
      send: 0.42,
      gain: 0.92,
    },
  };

  class AudioEngine {
    constructor() {
      this.ctx = null;
      this.volume = 0.7;
      this.muted = false;
      this.voices = [];
      this.last = new Map();
      this.samples = new Map();
      this.available = typeof root.AudioContext !== 'undefined' || typeof root.webkitAudioContext !== 'undefined';
    }

    /** Must be called from a user gesture (click / key). Safe to call repeatedly. */
    unlock() {
      if (!this.available) return false;
      try {
        if (!this.ctx) {
          const Ctor = root.AudioContext || root.webkitAudioContext;
          this.ctx = new Ctor({ latencyHint: 'interactive' });
          this._build();
        }
        if (this.ctx.state === 'suspended') this.ctx.resume();
        return true;
      } catch (e) {
        this.available = false;
        return false;
      }
    }

    _build() {
      const c = this.ctx;
      this.master = c.createGain();
      this.comp = c.createDynamicsCompressor();
      this.comp.threshold.value = -14;
      this.comp.knee.value = 10;
      this.comp.ratio.value = 5;
      this.comp.attack.value = 0.002;
      this.comp.release.value = 0.12;
      this.master.connect(this.comp);
      this.comp.connect(c.destination);
      this._applyVolume();

      const len = Math.floor(c.sampleRate * 2);
      this.noise = c.createBuffer(1, len, c.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

      // Small indoor-range room: short, dense, dark reverb.
      const rl = Math.floor(c.sampleRate * 0.9);
      const ir = c.createBuffer(2, rl, c.sampleRate);
      for (let ch = 0; ch < 2; ch++) {
        const data = ir.getChannelData(ch);
        for (let i = 0; i < rl; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / rl, 3.2);
      }
      this.reverb = c.createConvolver();
      this.reverb.buffer = ir;
      const lp = c.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 2400;
      this.reverbIn = c.createGain();
      this.reverbIn.gain.value = 0.55;
      this.reverbIn.connect(lp);
      lp.connect(this.reverb);
      this.reverb.connect(this.master);
    }

    setVolume(v) {
      this.volume = Math.max(0, Math.min(1, v));
      this._applyVolume();
    }
    setMuted(m) {
      this.muted = !!m;
      this._applyVolume();
    }
    _applyVolume() {
      if (!this.master) return;
      const v = this.muted ? 0 : this.volume * this.volume * 0.9;
      this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.02);
    }

    get ready() {
      return !!(this.ctx && this.ctx.state === 'running' && !this.muted && this.volume > 0);
    }

    /** Optional real samples. Failures are logged once and the synth recipe stays in use. */
    registerSample(name, url) {
      if (!this.ctx || typeof fetch === 'undefined') return Promise.resolve(false);
      return fetch(url)
        .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error('HTTP ' + r.status))))
        .then((buf) => this.ctx.decodeAudioData(buf))
        .then((audio) => {
          this.samples.set(name, audio);
          return true;
        })
        .catch((err) => {
          if (root.console) console.info('[ZTA audio] sample "' + name + '" unavailable, using placeholder synth:', err.message || err);
          return false;
        });
    }

    /* ------------------------------------------------------------ voices */

    _admit(key, priority, dur) {
      if (!this.ready) return false;
      const now = this.ctx.currentTime;
      this.voices = this.voices.filter((end) => end > now);
      const prev = this.last.get(key);
      if (prev != null && (now - prev) * 1000 < THROTTLE_MS) return false;
      if (this.voices.length >= MAX_VOICES && priority < 2) return false;
      this.last.set(key, now);
      this.voices.push(now + dur);
      return true;
    }

    _out(pan, send) {
      const c = this.ctx;
      const g = c.createGain();
      let node = g;
      if (pan && c.createStereoPanner) {
        const p = c.createStereoPanner();
        p.pan.value = Math.max(-1, Math.min(1, pan));
        g.connect(p);
        node = p;
      }
      node.connect(this.master);
      if (send > 0) {
        const s = c.createGain();
        s.gain.value = send;
        node.connect(s);
        s.connect(this.reverbIn);
      }
      return g;
    }

    _env(param, t, peak, attack, decay) {
      param.setValueAtTime(0.0001, t);
      param.linearRampToValueAtTime(Math.max(0.0002, peak), t + attack);
      param.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    }

    _noise(dest, t, o) {
      const c = this.ctx;
      const src = c.createBufferSource();
      src.buffer = this.noise;
      const f = c.createBiquadFilter();
      f.type = o.type || 'bandpass';
      f.frequency.setValueAtTime(o.f, t);
      if (o.f1) f.frequency.exponentialRampToValueAtTime(o.f1, t + o.d);
      f.Q.value = o.q == null ? 0.8 : o.q;
      const g = c.createGain();
      this._env(g.gain, t, o.g, o.a || 0.0015, o.d);
      src.connect(f);
      f.connect(g);
      g.connect(dest);
      src.start(t, Math.random() * 1.5);
      src.stop(t + (o.a || 0.0015) + o.d + 0.05);
    }

    _tone(dest, t, o) {
      const c = this.ctx;
      const osc = c.createOscillator();
      osc.type = o.type || 'sine';
      osc.frequency.setValueAtTime(o.f, t);
      if (o.f1) osc.frequency.exponentialRampToValueAtTime(o.f1, t + o.d);
      const g = c.createGain();
      this._env(g.gain, t, o.g, o.a || 0.002, o.d);
      osc.connect(g);
      g.connect(dest);
      osc.start(t);
      osc.stop(t + (o.a || 0.002) + o.d + 0.05);
    }

    _sample(name, pan, gain) {
      const buf = this.samples.get(name);
      if (!buf) return false;
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      src.playbackRate.value = 1 + (Math.random() - 0.5) * 0.06;
      const out = this._out(pan, 0.2);
      out.gain.value = gain;
      src.connect(out);
      src.start();
      return true;
    }

    /* ----------------------------------------------------------- recipes */

    gunshot(profile, opts) {
      const o = opts || {};
      const p = GUNS[profile] || GUNS.pistol;
      if (!this._admit('gun', 3, p.tail.d + 0.1)) return;
      const vary = 1 + (Math.random() - 0.5) * 0.08;
      const gv = p.gain * (1 + (Math.random() - 0.5) * 0.14);
      if (this._sample('gun.' + profile, 0.08, gv)) return;
      const t = this.ctx.currentTime;
      const bright = 1 + 0.03 * (o.comboTier || 0);
      const out = this._out(0.08, p.send);
      out.gain.value = gv;
      this._noise(out, t, { type: 'highpass', f: p.crack.f * vary * bright, q: p.crack.q, g: p.crack.g, d: p.crack.d });
      this._noise(out, t, { type: 'bandpass', f: p.body.f * vary, f1: p.body.f * 0.55, q: p.body.q, g: p.body.g, d: p.body.d });
      this._tone(out, t, { f: p.thump.f0 * vary, f1: p.thump.f1, g: p.thump.g, d: p.thump.d });
      this._noise(out, t + 0.006, { type: 'lowpass', f: p.tail.f, q: 0.4, g: p.tail.g, d: p.tail.d, a: 0.01 });
    }

    /** Material impact. kind: 'hit' | 'crit' | 'armor' | 'break'. */
    impact(material, kind, opts) {
      const o = opts || {};
      const pan = o.pan || 0;
      const key = 'imp.' + material + '.' + kind;
      if (!this._admit(key, kind === 'break' ? 1 : 0, 0.8)) return;
      if (this._sample(key, pan, 0.7)) return;
      const t = this.ctx.currentTime;
      const v = 1 + (Math.random() - 0.5) * 0.07;
      const comboLift = 1 + 0.02 * (o.comboTier || 0);
      const out = this._out(pan, 0.25);
      out.gain.value = 0.9 + (Math.random() - 0.5) * 0.12;

      if (material === 'steel') {
        const f0 = (o.size ? 700 / o.size : 720) * v * comboLift;
        if (kind === 'break') {
          const fb = f0 * 0.62;
          [1, 2.76, 5.4].forEach((m, i) => this._tone(out, t, { f: fb * m, g: [0.42, 0.22, 0.1][i], d: [1.1, 0.6, 0.3][i] }));
          this._noise(out, t, { type: 'lowpass', f: 380, g: 0.5, d: 0.16 });
          return;
        }
        const g = kind === 'crit' ? 1.25 : 1;
        [1, 2.76, 5.4].forEach((m, i) => this._tone(out, t, { f: f0 * m, g: [0.4, 0.2, 0.1][i] * g, d: [0.55, 0.3, 0.16][i] }));
        this._noise(out, t, { type: 'highpass', f: 5200, g: 0.22 * g, d: 0.012 });
        if (kind === 'crit') this._tone(out, t, { f: f0 * 8.9, g: 0.1, d: 0.1 });
        return;
      }
      if (material === 'glass') {
        const n = kind === 'break' ? 12 : 5;
        for (let i = 0; i < n; i++) {
          const dt = Math.random() * (kind === 'break' ? 0.24 : 0.08);
          this._tone(out, t + dt, { f: (2400 + Math.random() * 4400) * comboLift, g: 0.05 + Math.random() * 0.07, d: 0.04 + Math.random() * 0.14 });
        }
        this._noise(out, t, { type: 'highpass', f: 2800, g: kind === 'break' ? 0.55 : 0.3, d: kind === 'break' ? 0.12 : 0.06 });
        return;
      }
      if (material === 'mech') {
        if (kind === 'break') {
          this._noise(out, t, { type: 'lowpass', f: 900, f1: 200, g: 0.85, d: 0.38 });
          this._tone(out, t, { type: 'triangle', f: 95, f1: 38, g: 0.6, d: 0.3 });
          for (let i = 0; i < 4; i++) this._tone(out, t + 0.05 + i * 0.06, { type: 'triangle', f: 260 + Math.random() * 400, g: 0.16, d: 0.1 });
          return;
        }
        if (kind === 'armor') {
          this._tone(out, t, { f: 1850 * v, f1: 1050, g: 0.22, d: 0.09 });
          this._tone(out, t, { type: 'triangle', f: 240 * v, g: 0.3, d: 0.12 });
          this._noise(out, t, { type: 'bandpass', f: 1500, q: 1.2, g: 0.25, d: 0.04 });
          return;
        }
        this._tone(out, t, { type: 'triangle', f: 280 * v, g: 0.35, d: 0.12 });
        this._noise(out, t, { type: 'bandpass', f: 1300, q: 1, g: 0.3, d: 0.05 });
        if (kind === 'crit') this._tone(out, t, { f: 900 * comboLift, f1: 1600 * comboLift, g: 0.26, d: 0.12 });
        return;
      }
      if (material === 'wood') {
        this._noise(out, t, { type: 'bandpass', f: 700 * v, q: 1.2, g: 0.5, d: 0.06 });
        this._tone(out, t, { f: 180 * v, g: 0.25, d: 0.05 });
        return;
      }
      // Backstop / floor / walls.
      this._noise(out, t, { type: 'lowpass', f: 420 * v, q: 0.6, g: 0.22, d: 0.07 });
    }

    /** Mechanical and UI one-shots. */
    play(name, opts) {
      const o = opts || {};
      if (!this._admit('fx.' + name, name.startsWith('ui') ? 2 : 1, 0.6)) return;
      if (this._sample(name, o.pan || 0, 0.7)) return;
      const t = this.ctx.currentTime + (o.delay || 0);
      const v = 1 + (Math.random() - 0.5) * 0.06;
      const out = this._out(o.pan || 0, name.startsWith('ui') ? 0 : 0.12);
      switch (name) {
        case 'dry':
          this._noise(out, t, { type: 'highpass', f: 4200, g: 0.3, d: 0.015 });
          this._tone(out, t, { f: 2200 * v, g: 0.12, d: 0.012 });
          break;
        case 'magOut':
          this._noise(out, t, { type: 'highpass', f: 3000, g: 0.28, d: 0.02 });
          this._noise(out, t + 0.02, { type: 'bandpass', f: 1800, f1: 900, q: 2, g: 0.2, d: 0.09 });
          break;
        case 'magIn':
          this._noise(out, t, { type: 'bandpass', f: 1200 * v, q: 1.5, g: 0.55, d: 0.05 });
          this._tone(out, t, { f: 320 * v, g: 0.3, d: 0.04 });
          break;
        case 'rack':
          this._noise(out, t, { type: 'bandpass', f: 2600 * v, q: 1.4, g: 0.35, d: 0.03 });
          this._noise(out, t + 0.07, { type: 'bandpass', f: 1600 * v, q: 1.2, g: 0.5, d: 0.05 });
          this._tone(out, t + 0.07, { f: 420 * v, g: 0.2, d: 0.04 });
          break;
        case 'pumpBack':
          this._noise(out, t, { type: 'bandpass', f: 900 * v, f1: 600, q: 1.4, g: 0.45, d: 0.09 });
          this._tone(out, t + 0.05, { type: 'triangle', f: 210 * v, g: 0.2, d: 0.05 });
          break;
        case 'pumpFwd':
          this._noise(out, t, { type: 'bandpass', f: 1400 * v, f1: 2000, q: 1.4, g: 0.5, d: 0.07 });
          this._tone(out, t + 0.03, { type: 'triangle', f: 260 * v, g: 0.28, d: 0.05 });
          break;
        case 'shellIn':
          this._noise(out, t, { type: 'bandpass', f: 700 * v, q: 1.2, g: 0.45, d: 0.06 });
          this._tone(out, t, { f: 200 * v, g: 0.25, d: 0.05 });
          break;
        case 'switch':
          this._noise(out, t, { type: 'bandpass', f: 600, f1: 1800, q: 0.9, g: 0.14, d: 0.18 });
          this._noise(out, t + 0.14, { type: 'highpass', f: 3000, g: 0.25, d: 0.02 });
          break;
        case 'land':
          this._noise(out, t, { type: 'lowpass', f: 300, g: 0.45, d: 0.12 });
          [1, 2.4].forEach((m, i) => this._tone(out, t, { f: 310 * m * v, g: [0.18, 0.08][i], d: 0.28 }));
          break;
        case 'ui_click':
          this._tone(out, t, { f: 1250, g: 0.1, d: 0.03 });
          break;
        case 'ui_buy':
          this._tone(out, t, { type: 'triangle', f: 660, g: 0.2, d: 0.1 });
          this._tone(out, t + 0.07, { type: 'triangle', f: 990, g: 0.2, d: 0.2 });
          break;
        case 'ui_deny':
          this._tone(out, t, { type: 'square', f: 140, g: 0.06, d: 0.12 });
          break;
        case 'unlock':
          [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => this._tone(out, t + i * 0.085, { type: 'triangle', f, g: 0.17, d: 0.45 }));
          this._noise(out, t + 0.25, { type: 'highpass', f: 6000, g: 0.05, d: 0.5 });
          break;
        case 'wave_clear':
          this._tone(out, t, { type: 'triangle', f: 587.33, g: 0.14, d: 0.2 });
          this._tone(out, t + 0.09, { type: 'triangle', f: 880, g: 0.14, d: 0.32 });
          break;
        case 'combo_up':
          this._tone(out, t, { f: 700 + (o.tier || 1) * 140, g: 0.1, d: 0.08 });
          break;
        default:
          break;
      }
    }
  }

  ZTA.Audio = new AudioEngine();
})(typeof window !== 'undefined' ? window : globalThis);
