/*
 * Keyboard, mouse and gamepad input with remappable keyboard bindings.
 *
 * Edge-triggered actions (dash, spin, interact, ledger, pause) are latched on
 * key-down and consumed by the game, so a quick tap between frames is never
 * lost. Held actions (move, fire, precision) are sampled each frame.
 * Aim assist (optional) nudges the aim toward the nearest enemy inside a
 * narrow cone; it never fires for the player.
 */
(function (root) {
  'use strict';
  const HE = root.HE;

  const ACTIONS = ['up', 'down', 'left', 'right', 'dash', 'spin', 'interact', 'precision', 'ledger', 'pause'];
  const LABELS = {
    up: 'Move up',
    down: 'Move down',
    left: 'Move left',
    right: 'Move right',
    dash: 'Dash',
    spin: 'Spin reels',
    interact: 'Interact / confirm',
    precision: 'Precision mode',
    ledger: 'Build ledger',
    pause: 'Pause',
  };

  function keyLabel(code) {
    if (!code) return '—';
    if (code.startsWith('Key')) return code.slice(3);
    if (code.startsWith('Digit')) return code.slice(5);
    const map = { Space: 'Space', ShiftLeft: 'L-Shift', ShiftRight: 'R-Shift', ControlLeft: 'L-Ctrl', ControlRight: 'R-Ctrl', AltLeft: 'L-Alt', Escape: 'Esc', Tab: 'Tab', Enter: 'Enter', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Backquote: '`' };
    return map[code] || code;
  }

  class Input {
    constructor(target, getBindings) {
      this.target = target;
      this.getBindings = getBindings;
      this.down = new Set();
      this.edges = new Set();
      this.mouse = { x: 0, y: 0, left: false, inside: false };
      this.usingPad = false;
      this.pad = { lx: 0, ly: 0, rx: 0, ry: 0, fire: false, precision: false };
      this.padPrev = {};
      this.capture = null;
      this.onAnyKey = null;
      this._bind();
    }

    _bind() {
      const w = typeof window !== 'undefined' ? window : null;
      if (!w) return;
      w.addEventListener('keydown', (e) => {
        if (this.capture) {
          e.preventDefault();
          const cb = this.capture;
          this.capture = null;
          cb(e.code);
          return;
        }
        const b = this.getBindings();
        if (e.code === b.ledger || e.code === 'Tab' || e.code === 'Space') e.preventDefault();
        if (!e.repeat) {
          for (const a of ACTIONS) if (b[a] === e.code) this.edges.add(a);
          if (e.code === 'Backquote') this.edges.add('debug');
          if (e.code === 'Enter') this.edges.add('interact');
        }
        this.down.add(e.code);
        this.usingPad = false;
        if (this.onAnyKey) this.onAnyKey(e);
      });
      w.addEventListener('keyup', (e) => this.down.delete(e.code));
      w.addEventListener('blur', () => {
        this.down.clear();
        this.mouse.left = false;
        this.edges.add('blur');
      });
      const t = this.target;
      t.addEventListener('mousemove', (e) => {
        this.mouse.x = e.clientX;
        this.mouse.y = e.clientY;
        this.mouse.inside = true;
        this.usingPad = false;
      });
      t.addEventListener('mousedown', (e) => {
        if (e.button === 0) this.mouse.left = true;
        this.mouse.x = e.clientX;
        this.mouse.y = e.clientY;
        this.usingPad = false;
      });
      w.addEventListener('mouseup', (e) => {
        if (e.button === 0) this.mouse.left = false;
      });
      t.addEventListener('contextmenu', (e) => e.preventDefault());
    }

    /** Consumes a latched edge action. */
    take(action) {
      if (this.edges.has(action)) {
        this.edges.delete(action);
        return true;
      }
      return false;
    }

    clearEdges() {
      this.edges.clear();
    }

    held(action) {
      return this.down.has(this.getBindings()[action]);
    }

    pollGamepad() {
      const nav = typeof navigator !== 'undefined' ? navigator : null;
      if (!nav || !nav.getGamepads) return;
      const pads = nav.getGamepads();
      let gp = null;
      for (const p of pads) if (p && p.connected) gp = p;
      if (!gp) {
        this.pad.fire = false;
        return;
      }
      const dz = (v) => (Math.abs(v) < 0.18 ? 0 : v);
      const ax = gp.axes;
      this.pad.lx = dz(ax[0] || 0);
      this.pad.ly = dz(ax[1] || 0);
      this.pad.rx = dz(ax[2] || 0);
      this.pad.ry = dz(ax[3] || 0);
      const btn = (i) => !!(gp.buttons[i] && gp.buttons[i].pressed);
      const edge = (i, action) => {
        const now = btn(i);
        if (now && !this.padPrev[i]) this.edges.add(action);
        this.padPrev[i] = now;
      };
      edge(0, 'dash'); // A / Cross
      edge(4, 'dash'); // LB
      edge(3, 'spin'); // Y / Triangle
      edge(2, 'interact'); // X / Square
      edge(9, 'pause'); // Start
      edge(8, 'ledger'); // Back / Select
      this.pad.fire = btn(7) || Math.hypot(this.pad.rx, this.pad.ry) > 0.5;
      this.pad.precision = btn(6);
      if (this.pad.lx || this.pad.ly || this.pad.rx || this.pad.ry || this.pad.fire) this.usingPad = true;
    }

    /** Writes the current frame's input into game.input. */
    apply(game, renderer) {
      this.pollGamepad();
      const gi = game.input;
      let mx = 0;
      let my = 0;
      if (this.held('left')) mx -= 1;
      if (this.held('right')) mx += 1;
      if (this.held('up')) my -= 1;
      if (this.held('down')) my += 1;
      if (this.usingPad) {
        mx += this.pad.lx;
        my += this.pad.ly;
      }
      const l = Math.hypot(mx, my);
      gi.moveX = l > 1 ? mx / l : mx;
      gi.moveY = l > 1 ? my / l : my;
      gi.precision = this.held('precision') || this.pad.precision;
      const p = game.player;
      if (this.usingPad) {
        if (Math.hypot(this.pad.rx, this.pad.ry) > 0.3) {
          gi.aimX = p.x + this.pad.rx * 300;
          gi.aimY = p.y + this.pad.ry * 300;
        } else if (!this._padAimInit) {
          gi.aimX = p.x + Math.cos(p.aim) * 300;
          gi.aimY = p.y + Math.sin(p.aim) * 300;
        }
        gi.fire = this.pad.fire;
      } else {
        const a = renderer.screenToArena(this.mouse.x, this.mouse.y);
        gi.aimX = a.x;
        gi.aimY = a.y;
        gi.fire = this.mouse.left;
      }
      if (game.settings.aimAssist || this.usingPad) this._assist(game);
    }

    _assist(game) {
      const gi = game.input;
      const p = game.player;
      const aim = Math.atan2(gi.aimY - p.y, gi.aimX - p.x);
      let best = null;
      let bestD = Infinity;
      for (const e of game.liveEnemies()) {
        const a = Math.atan2(e.y - p.y, e.x - p.x);
        const off = Math.abs(HE.util.angleDiff(aim, a));
        if (off > 0.2) continue;
        const d = Math.hypot(e.x - p.x, e.y - p.y);
        if (d < bestD) {
          bestD = d;
          best = e;
        }
      }
      if (best) {
        const a = Math.atan2(best.y - p.y, best.x - p.x);
        const na = aim + HE.util.angleDiff(aim, a) * 0.6;
        const d = Math.hypot(gi.aimX - p.x, gi.aimY - p.y);
        gi.aimX = p.x + Math.cos(na) * d;
        gi.aimY = p.y + Math.sin(na) * d;
      }
    }

    /** Next key press is delivered to `cb` instead of the game (rebinding). */
    captureNext(cb) {
      this.capture = cb;
    }
  }

  HE.Input = Input;
  HE.InputInfo = { ACTIONS, LABELS, keyLabel };
})(typeof window !== 'undefined' ? window : globalThis);
