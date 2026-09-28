/*
 * Parametric gun silhouettes. A weapon's `model: { builder, params }` picks a
 * builder and tunes its proportions, so new guns reuse builders instead of
 * needing new art code. The same model draws the first-person viewmodel, the
 * armory wall, the HUD slots and the unlock reveal.
 *
 * Model space: x points toward the muzzle, y points down, origin = firing-hand
 * grip. Units are pixels at a 1080p viewmodel scale of 1.
 *
 * A model is { parts, anchors, highlights, bounds, travel, magDrop }. Parts
 * carry a Path2D, a tone ('ink' body, 'metal', 'wood', 'glow') and an optional
 * move channel animated by the viewmodel:
 *   slide, bolt, pump, mag, boltHandle, cylinder, barrels (break-open), spin, glow
 */
(function (root) {
  'use strict';
  const ZTA = root.ZTA;
  const P = ZTA.palette;

  /* ---------------------------------------------------------------- builder */

  class MB {
    constructor() {
      this.parts = [];
      this.highlights = [];
      this.b = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
    }
    _grow(x, y) {
      const b = this.b;
      if (x < b.minX) b.minX = x;
      if (x > b.maxX) b.maxX = x;
      if (y < b.minY) b.minY = y;
      if (y > b.maxY) b.maxY = y;
    }
    _add(name, path, o) {
      const part = Object.assign({ name, path, tone: 'ink' }, o || {});
      this.parts.push(part);
      return part;
    }
    poly(name, pts, o) {
      const p = new Path2D();
      let x0 = Infinity;
      let y0 = Infinity;
      let x1 = -Infinity;
      let y1 = -Infinity;
      pts.forEach((pt, i) => {
        this._grow(pt[0], pt[1]);
        x0 = Math.min(x0, pt[0]);
        y0 = Math.min(y0, pt[1]);
        x1 = Math.max(x1, pt[0]);
        y1 = Math.max(y1, pt[1]);
        if (i) p.lineTo(pt[0], pt[1]);
        else p.moveTo(pt[0], pt[1]);
      });
      p.closePath();
      const part = this._add(name, p, o);
      part.box = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
      return part;
    }
    rect(name, x, y, w, h, o) {
      return this.poly(name, [[x, y], [x + w, y], [x + w, y + h], [x, y + h]], o);
    }
    rrect(name, x, y, w, h, r, o) {
      this._grow(x, y);
      this._grow(x + w, y + h);
      const p = new Path2D();
      const rr = Math.min(r, w / 2, h / 2);
      p.moveTo(x + rr, y);
      p.arcTo(x + w, y, x + w, y + h, rr);
      p.arcTo(x + w, y + h, x, y + h, rr);
      p.arcTo(x, y + h, x, y, rr);
      p.arcTo(x, y, x + w, y, rr);
      p.closePath();
      const part = this._add(name, p, o);
      part.box = { x, y, w, h };
      return part;
    }
    circle(name, cx, cy, r, o) {
      this._grow(cx - r, cy - r);
      this._grow(cx + r, cy + r);
      const p = new Path2D();
      p.arc(cx, cy, r, 0, Math.PI * 2);
      const part = this._add(name, p, o);
      part.box = { x: cx - r, y: cy - r, w: r * 2, h: r * 2 };
      return part;
    }
    guard(name, pts, width, o) {
      for (const pt of pts) this._grow(pt[0], pt[1]);
      return this._add(name, null, Object.assign({ guard: { stroke: pts, width } }, o || {}));
    }
    hi(x1, y1, x2, y2, move) {
      this.highlights.push([x1, y1, x2, y2, move || null]);
    }
    build(anchors, extra) {
      const b = this.b;
      return Object.assign({ parts: this.parts, anchors, highlights: this.highlights, bounds: { minX: b.minX - 4, maxX: b.maxX + 4, minY: b.minY - 4, maxY: b.maxY + 4 }, travel: {}, magDrop: 0 }, extra || {});
    }
  }

  /** A pistol grip below a receiver, raked back. Returns the grip bottom y. */
  function grip(mb, x, top, len, rake, o) {
    const gx = Math.tan(rake) * len;
    mb.poly('grip', [[x - 22, top], [x + 26, top], [x + 22 - gx, top + len], [x + 16 - gx, top + len + 10], [x - 26 - gx, top + len + 10], [x - 30 - gx, top + len - 6]], Object.assign({ texture: true }, o || {}));
    return top + len + 10;
  }

  function stockAR(mb, back, top, bottom) {
    mb.rect('bufferTube', back - 70, top + 8, 72, 16);
    mb.poly('stock', [[back - 150, top + 2], [back - 70, top + 2], [back - 70, bottom + 14], [back - 110, bottom + 30], [back - 156, bottom + 34], [back - 160, top + 8]], { texture: true });
  }

  /* --------------------------------------------------------------- builders */

  const builders = {
    pistol(pr) {
      const mb = new MB();
      const L = 188 * (pr.slideLen || 1);
      const H = 30 * (pr.slideH || 1);
      const back = -40;
      const front = back + L;
      const top = -64 - (H - 30);
      const bottom = top + H;
      const magLen = 96 + 40 * (pr.magExt || 0);
      mb.poly('mag', [[-44, 6], [-8, 6], [-14, magLen], [-52, magLen - 2]], { move: 'mag', tone: 'metal' });
      const gx = Math.tan(0.2) * 80;
      mb.poly(
        'frame',
        [[back + 4, bottom], [front - 16, bottom], [front - 16, bottom + 14], [52, bottom + 16], [12, bottom + 20], [16 - gx, 72], [8 - gx, 84], [-44 - gx, 84], [-50 - gx, 74], [-44, bottom + 20], [-52, bottom + 8], [back - 6, bottom + 2]],
        { texture: true, tone: pr.grip === 'wood' ? 'wood' : 'ink' }
      );
      if (pr.beavertail) mb.poly('beavertail', [[-52, bottom + 4], [-72, bottom + 10], [-66, bottom + 16], [-48, bottom + 14]]);
      if (pr.magExt) mb.rect('magBase', -54 - gx, 84, 46, 10 + 30 * pr.magExt, { tone: 'metal', move: 'mag' });
      mb.guard('guard', [[14, bottom + 18], [14, bottom + 44], [pr.guard === 'round' ? 44 : 50, bottom + 44], [56, bottom + 20]], 6);
      if (pr.rail) mb.rect('rail', front - 70, bottom + 14, 50, 8);
      if (pr.foregrip) mb.poly('foregrip', [[front - 60, bottom + 14], [front - 34, bottom + 14], [front - 38, bottom + 64], [front - 56, bottom + 64]]);
      if (pr.heavy) mb.poly('barrelBlock', [[front - 50, bottom], [front + 8, bottom], [front + 8, bottom + 18], [front - 50, bottom + 12]], { tone: 'metal' });
      mb.poly('slide', [[back, top + 3], [back + 3, top], [front - 10, top], [front, top + 7], [front, bottom], [back, bottom]], {
        move: 'slide',
        tone: pr.twoTone ? 'metal' : 'ink',
        serrations: { x: back + 8, y0: top + 5, y1: bottom - 4, n: pr.serrations || 5 },
        eject: [30, top + 2, 30, 8],
      });
      mb.rect('rearSight', back + 6, top - 6, 12, 7, { move: 'slide' });
      mb.rect('frontSight', front - 18, top - 5, 6, 6, { move: 'slide', trim: true });
      if (pr.hammer) mb.poly('hammer', [[back - 4, top + 10], [back - 18, top + 2], [back - 12, top + 16]], { trim: true });
      if (pr.dot) {
        mb.rect('dotBase', back + 26, top - 8, 44, 8, { move: 'slide' });
        mb.poly('dot', [[back + 30, top - 8], [back + 30, top - 30], [back + 68, top - 30], [back + 70, top - 8]], { move: 'slide', lens: true });
      }
      let muzzleX = front;
      if (pr.comp) {
        mb.rect('comp', front, top + 2, 26, H - 2, { tone: 'metal', ports: true });
        muzzleX = front + 26;
      }
      mb.hi(back + 3, top + 1, front - 10, top + 1, 'slide');
      return mb.build(
        { muzzle: { x: muzzleX + 2, y: top + H * 0.45 }, eject: { x: 40, y: top + 4 }, hand: { x: -18, y: 34 }, trigger: { x: 30, y: bottom + 28 } },
        { travel: { slide: 26 }, magDrop: 130 + 30 * (pr.magExt || 0), scale: 1.45 }
      );
    },

    revolver(pr) {
      const mb = new MB();
      const big = pr.frame === 'large';
      const cylR = pr.shotgun ? 23 : big ? 21 : 18;
      const cylL = pr.shotgun ? 70 : big ? 54 : 46;
      const barrelL = 150 * (pr.barrelLen || 1);
      const bh = big ? 18 : 15;
      const top = -62;
      const cx0 = -28;
      const cy = top + cylR + 2;
      const fx = cx0 + cylL + 8;
      // Raked grip hanging behind the frame.
      mb.poly('grip', [[-50, cy + 8], [-14, cy + 14], [-12, cy + 30], [-28, 74], [-44, 84], [-66, 76], [-62, cy + 30]], { tone: pr.grip === 'wood' ? 'wood' : 'ink', texture: pr.grip !== 'wood' });
      mb.poly('frame', [[-56, top + 10], [-44, top - 2], [fx, top - 2], [fx + 6, top + 6], [fx + 6, cy + cylR + 2], [16, cy + cylR + 6], [-12, cy + cylR + 14], [-46, cy + 14], [-60, top + 22]], { tone: 'metal' });
      mb.rrect('cylinder', cx0, cy - cylR, cylL, cylR * 2, 8, { move: 'cylinder', flutes: { x: cx0, y: cy - cylR, w: cylL, h: cylR * 2, n: 4 } });
      mb.rect('barrel', fx + 6, top + 2, barrelL, bh, { tone: 'metal' });
      if (pr.shroud) mb.rect('underlug', fx + 6, top + 2 + bh, barrelL, big ? 12 : 9);
      mb.rect('ejectorRod', fx + 6, top + 2 + bh + (pr.shroud ? 12 : 0), Math.min(barrelL * 0.6, 70), 5, { tone: 'metal' });
      mb.rect('rib', fx + 6, top - 3, barrelL, 5);
      mb.rect('frontSight', fx + barrelL - 8, top - 10, 7, 8, { trim: true });
      mb.poly('hammer', [[-50, top + 6], [-72, top - 8], [-66, top + 2], [-48, top + 18]], { trim: true });
      mb.guard('guard', [[2, cy + cylR + 8], [2, cy + cylR + 32], [30, cy + cylR + 32], [38, cy + cylR + 10]], 6);
      if (pr.scope) {
        mb.rect('scopeRing1', fx + 16, top - 16, 8, 14);
        mb.rect('scopeRing2', fx + barrelL - 44, top - 16, 8, 14);
        mb.rrect('scope', fx - 16, top - 38, barrelL - 6, 22, 10, { lens: true });
      }
      mb.hi(-44, top - 1, fx, top - 1);
      mb.hi(fx + 6, top - 2, fx + 6 + barrelL, top - 2);
      return mb.build(
        { muzzle: { x: fx + 8 + barrelL, y: top + 2 + bh / 2 }, eject: { x: cx0 + cylL / 2, y: cy }, hand: { x: -36, y: 44 }, trigger: { x: 16, y: cy + cylR + 18 }, cylinder: { x: cx0 + cylL / 2, y: cy } },
        { magDrop: 0, scale: 1.4 }
      );
    },

    smg(pr) {
      const mb = new MB();
      const bodyL = 200 * (pr.bodyLen || 1);
      const back = -86;
      const front = back + bodyL;
      const top = -74;
      const bottom = -28;
      const barrelL = 64 * (pr.barrelLen || 1);
      const ms = pr.magStyle || 'grip';
      if (ms === 'grip') mb.poly('mag', [[-30, 30], [4, 30], [8, 150], [-24, 152]], { move: 'mag', tone: 'metal' });
      else if (ms === 'straight') mb.poly('mag', [[40, bottom], [72, bottom], [78, 120], [46, 122]], { move: 'mag', tone: 'metal' });
      else if (ms === 'curved') mb.poly('mag', [[44, bottom], [76, bottom], [96, 60], [104, 108], [74, 116], [62, 66]], { move: 'mag', tone: 'metal' });
      else if (ms === 'drum') mb.circle('mag', 64, bottom + 52, 50, { move: 'mag', tone: 'metal', drum: true });
      if (pr.vector) mb.poly('lower', [[-30, bottom], [front - 20, bottom], [front - 40, bottom + 40], [20, bottom + 50]], { tone: 'metal' });
      grip(mb, -12, bottom, 72, 0.18, { tone: pr.stock === 'wood' ? 'wood' : 'ink' });
      mb.guard('guard', [[16, bottom + 2], [16, bottom + 30], [52, bottom + 30], [60, bottom + 4]], 6);
      if (pr.stock === 'stub') mb.poly('stock', [[back, top + 12], [back - 58, top + 16], [back - 64, bottom + 6], [back - 50, bottom + 12], [back, bottom - 2]]);
      else if (pr.stock === 'folded') mb.rect('stock', back - 10, bottom - 8, 110, 10);
      else if (pr.stock === 'fixed') mb.poly('stock', [[back, top + 10], [back - 120, top + 18], [back - 128, bottom + 30], [back - 104, bottom + 32], [back - 92, bottom + 6], [back, bottom]], { hollow: true });
      else if (pr.stock === 'wood') mb.poly('stock', [[back, top + 8], [back - 170, top + 30], [back - 176, bottom + 44], [back - 150, bottom + 50], [back, bottom + 4]], { tone: 'wood' });
      else if (pr.stock === 'bullpup') mb.poly('stock', [[back, top + 4], [back - 110, top + 4], [back - 118, bottom + 34], [back - 60, bottom + 34], [back, bottom + 10]], { tone: 'metal' });
      mb.poly('receiver', [[back, top + 6], [back + 8, top], [front - 6, top], [front, top + 8], [front, bottom], [back, bottom]], { tone: 'metal', eject: [10, top + 4, 34, 9] });
      if (ms === 'top') mb.rrect('mag', back - 60, top - 22, bodyL + 20, 20, 8, { move: 'mag', tone: 'glow' });
      if (pr.shroud) mb.rect('shroud', front, top + 10, 46, 32, { holes: { x: front + 11, y: top + 26, n: 3 } });
      const bStart = front + (pr.shroud ? 46 : 0);
      mb.rect('barrel', bStart, top + 20, barrelL, 12, { tone: 'metal' });
      if (pr.finned) for (let i = 0; i < 6; i++) mb.rect('fin' + i, bStart + 8 + i * (barrelL / 7), top + 14, 4, 24);
      mb.rect('bolt', back + 22, top - 9, 26, 10, { move: 'bolt' });
      mb.rect('rail', back + 60, top - 7, 90, 7);
      if (pr.foregrip) mb.poly('foregrip', [[front - 40, bottom], [front - 10, bottom], [front - 14, bottom + 60], [front - 36, bottom + 60]], { tone: pr.stock === 'wood' ? 'wood' : 'ink' });
      mb.hi(back + 8, top + 1, front - 6, top + 1);
      const muzzleX = bStart + barrelL;
      const support = pr.foregrip ? { x: front - 24, y: bottom + 34 } : ms === 'curved' || ms === 'straight' ? null : null;
      return mb.build(
        { muzzle: { x: muzzleX + 2, y: top + 26 }, eject: { x: 24, y: top + 4 }, hand: { x: -12, y: 36 }, trigger: { x: 34, y: bottom + 16 }, support },
        { travel: { bolt: 16 }, magDrop: ms === 'top' ? 60 : 170, scale: 1.3 }
      );
    },

    rifle(pr) {
      const mb = new MB();
      const style = pr.style || 'ar';
      const wood = pr.furniture === 'wood' || style === 'garand';
      const top = -70;
      const bottom = -30;
      const recvBack = style === 'bullpup' ? -150 : -70;
      const recvFront = style === 'bullpup' ? 90 : 90;
      const hgLen = style === 'garand' ? 200 : style === 'bullpup' ? 110 : 150;
      const barrelL = (style === 'garand' ? 110 : 90) * (pr.barrelLen || 1);
      const ms = pr.magStyle || 'straight';
      // Magazine.
      const magX = style === 'bullpup' ? -110 : 36;
      if (ms === 'straight') mb.poly('mag', [[magX, bottom], [magX + 34, bottom], [magX + 40, 96], [magX + 6, 98]], { move: 'mag', tone: 'metal' });
      else if (ms === 'curved') mb.poly('mag', [[magX, bottom], [magX + 34, bottom], [magX + 58, 50], [magX + 70, 96], [magX + 38, 106], [magX + 22, 56]], { move: 'mag', tone: 'metal' });
      else if (ms === 'box') mb.poly('mag', [[magX, bottom], [magX + 40, bottom], [magX + 42, 70], [magX + 2, 72]], { move: 'mag', tone: 'metal' });
      // Stock.
      if (style === 'ar' || style === 'battle' || style === 'g36') stockAR(mb, recvBack, top, bottom);
      else if (style === 'ak') mb.poly('stock', [[recvBack, top + 8], [recvBack - 180, top + 26], [recvBack - 184, bottom + 50], [recvBack - 160, bottom + 56], [recvBack, bottom + 8]], { tone: 'wood' });
      else if (style === 'garand') mb.poly('stock', [[recvBack, top + 6], [recvBack - 200, top + 24], [recvBack - 206, bottom + 58], [recvBack - 176, bottom + 62], [recvBack - 40, bottom + 30], [recvBack, bottom + 14]], { tone: 'wood' });
      else if (style === 'bullpup') mb.poly('butt', [[recvBack - 20, top + 6], [recvBack, top + 6], [recvBack, bottom + 34], [recvBack - 26, bottom + 36]], { tone: 'metal' });
      grip(mb, style === 'bullpup' ? 0 : -10, bottom, 70, 0.2, { tone: wood && style !== 'garand' ? 'wood' : 'ink' });
      mb.guard('guard', [[14, bottom + 2], [14, bottom + 30], [48, bottom + 30], [56, bottom + 4]], 6);
      // Receiver.
      mb.poly('receiver', [[recvBack, top + 8], [recvBack + 10, top], [recvFront, top], [recvFront, bottom], [recvBack, bottom + 4]], { tone: 'metal', eject: [style === 'bullpup' ? -80 : 0, top + 8, 40, 12] });
      if (style === 'ak') for (let i = 0; i < 4; i++) mb.rect('rib' + i, recvBack + 30 + i * 30, top + 4, 3, 16);
      // Handguard.
      const hgTone = wood ? 'wood' : 'ink';
      mb.rrect('handguard', recvFront, top + 6, hgLen, bottom - top - 2, 6, { tone: hgTone, vents: !wood ? { x: recvFront + 12, y: top + 16, w: hgLen - 24, n: 6 } : null });
      if (style === 'ak') mb.rect('gasTube', recvFront, top - 2, hgLen + 10, 10, { tone: 'metal' });
      const bx = recvFront + hgLen;
      mb.rect('barrel', bx, top + 16, barrelL, 12, { tone: 'metal' });
      const fs = style === 'garand' || style === 'ak' ? bx + barrelL - 16 : bx + 4;
      mb.poly('frontSight', [[fs, top + 16], [fs + 12, top + 16], [fs + 8, top - 10], [fs + 4, top - 10]], { trim: true });
      mb.rect('flash', bx + barrelL, top + 13, 20, 18, { tone: 'ink', ports: true });
      if (style === 'ar' || style === 'battle' || style === 'g36') mb.rect('charging', recvBack + 4, top - 8, 24, 8, { move: 'bolt' });
      else mb.rect('boltKnob', recvFront - 50, top + 12, 16, 10, { move: 'bolt' });
      // Optics.
      if (pr.optic === 'dot') {
        mb.rect('mount', recvBack + 50, top - 8, 60, 8);
        mb.rrect('dot', recvBack + 52, top - 38, 56, 30, 6, { lens: true });
      } else if (pr.optic === 'carry') {
        mb.poly('carry', [[recvBack + 30, top], [recvBack + 40, top - 34], [recvFront - 10, top - 34], [recvFront, top]], { hollow: true });
      } else if (pr.optic === 'scope') {
        mb.rect('mount', recvBack + 40, top - 10, 90, 10);
        mb.rrect('scope', recvBack + 10, top - 42, 170, 28, 12, { lens: true });
      }
      mb.hi(recvBack + 10, top + 1, recvFront, top + 1);
      mb.hi(bx, top + 17, bx + barrelL, top + 17);
      return mb.build(
        {
          muzzle: { x: bx + barrelL + 22, y: top + 22 },
          eject: { x: style === 'bullpup' ? -60 : 20, y: top + 10 },
          hand: { x: style === 'bullpup' ? 2 : -8, y: 34 },
          trigger: { x: style === 'bullpup' ? 34 : 30, y: bottom + 16 },
          support: { x: recvFront + hgLen * 0.55, y: bottom + 6 },
        },
        { travel: { bolt: 18 }, magDrop: ms === 'none' ? 0 : 160, scale: 1.12, clip: style === 'garand' }
      );
    },

    shotgun(pr) {
      const mb = new MB();
      const style = pr.style || 'pump';
      const top = -66;
      const bottom = -22;
      const recvBack = -62;
      const recvFront = style === 'drum' ? 110 : 70;
      const barrelL = 300 * (pr.barrelLen || 1);
      const tubeL = 250 * (pr.tubeLen || 1);
      mb.poly('stock', [[recvBack, top + 6], [-270, top + 22], [-282, 16], [-262, 24], [-120, 0], [-58, 50], [-30, 52], [-20, bottom + 4], [recvBack, bottom]], { texture: true, tone: style === 'double' ? 'wood' : 'ink' });
      mb.guard('guard', [[-10, bottom + 2], [-10, bottom + 26], [24, bottom + 26], [34, bottom + 4]], 6);
      if (style === 'double') {
        mb.rect('barrelTop', recvFront, top + 2, barrelL, 16, { tone: 'metal', move: 'barrels' });
        mb.rect('barrelBot', recvFront, top + 18, barrelL, 16, { tone: 'metal', move: 'barrels' });
        mb.rrect('forend', recvFront + 10, top + 30, 110, 18, 6, { tone: 'wood', move: 'barrels' });
        mb.rect('bead', recvFront + barrelL - 8, top - 3, 5, 5, { trim: true, move: 'barrels' });
      } else {
        mb.rect('barrel', recvFront, top + 4, barrelL, 14, { tone: 'metal' });
        if (style === 'pump') mb.rect('tube', recvFront, top + 20, tubeL, 14);
        mb.rect('bead', recvFront + barrelL - 8, top - 1, 5, 5, { trim: true });
      }
      if (style === 'semi') mb.poly('mag', [[0, bottom], [44, bottom], [48, 44], [4, 46]], { move: 'mag', tone: 'metal' });
      if (style === 'drum') mb.circle('mag', 50, bottom + 40, 44, { move: 'mag', tone: 'metal', drum: true });
      mb.poly('receiver', [[recvBack, top + 6], [recvBack + 10, top], [recvFront, top], [recvFront, bottom], [recvBack, bottom]], { tone: 'metal', eject: [4, top + 8, 40, 12] });
      if (style === 'drum') mb.poly('carry', [[recvBack + 20, top], [recvBack + 30, top - 26], [recvFront - 20, top - 26], [recvFront - 10, top]], { hollow: true });
      if (pr.slug) {
        mb.rect('rearSight', recvFront - 20, top - 8, 14, 8);
        mb.rect('rifleSight', recvFront + barrelL - 30, top - 10, 8, 10, { trim: true });
      }
      const pumpX = recvFront + 58;
      const pumpL = 104 * (pr.pumpLen || 1);
      if (style === 'pump') mb.rrect('pump', pumpX, top + 14, pumpL, 36, 8, { move: 'pump', ribs: { x: pumpX + 10, y: top + 18, w: pumpL - 20, h: 28, n: 6 } });
      else if (style !== 'double') mb.rrect('forend', recvFront + 20, top + 14, 120, 30, 8, { ribs: { x: recvFront + 30, y: top + 18, w: 100, h: 22, n: 5 } });
      mb.hi(recvBack + 10, top + 1, recvFront, top + 1);
      mb.hi(recvFront, top + 5, recvFront + barrelL - 2, top + 5, style === 'double' ? 'barrels' : null);
      const supportX = style === 'pump' ? pumpX + pumpL * 0.5 : style === 'double' ? recvFront + 64 : recvFront + 80;
      return mb.build(
        {
          muzzle: { x: recvFront + barrelL + 2, y: top + 11 },
          eject: { x: 22, y: top + 10 },
          hand: { x: -34, y: 26 },
          support: { x: supportX, y: top + 44 },
          trigger: { x: 10, y: bottom + 14 },
          loadPort: { x: 20, y: bottom + 4 },
          hinge: { x: recvFront, y: top + 20 },
        },
        { travel: { pump: style === 'pump' ? 46 : 0 }, magDrop: style === 'semi' || style === 'drum' ? 120 : 0, scale: 1.2 }
      );
    },

    marksman(pr) {
      const mb = new MB();
      const style = pr.style || 'bolt';
      const big = style === 'antimat';
      const top = big ? -80 : -68;
      const bottom = big ? -24 : -28;
      const recvBack = -70;
      const recvFront = big ? 120 : 90;
      const barrelL = (big ? 330 : 260) * (pr.barrelLen || 1);
      if (style === 'dmr') stockAR(mb, recvBack, top, bottom);
      else mb.poly('stock', [[recvBack, top + 8], [recvBack - 190, top + 18], [recvBack - 196, bottom + 56], [recvBack - 150, bottom + 60], [recvBack - 60, bottom + 30], [recvBack, bottom + 12]], { tone: big ? 'metal' : 'wood', hollow: big });
      grip(mb, -10, bottom, 66, 0.25);
      mb.guard('guard', [[14, bottom + 2], [14, bottom + 28], [46, bottom + 28], [54, bottom + 4]], 6);
      mb.poly('mag', [[40, bottom], [80, bottom], [82, big ? 58 : 44], [42, big ? 60 : 46]], { move: 'mag', tone: 'metal' });
      mb.poly('receiver', [[recvBack, top + 8], [recvBack + 10, top], [recvFront, top], [recvFront, bottom], [recvBack, bottom + 4]], { tone: 'metal', eject: [0, top + 8, 40, 12] });
      mb.rect('barrel', recvFront, top + (big ? 10 : 12), barrelL, big ? 20 : 14, { tone: 'metal' });
      if (style !== 'dmr') mb.rrect('forend', recvFront, top + 12, big ? 160 : 180, bottom - top - 6, 6, { tone: big ? 'ink' : 'wood' });
      else mb.rrect('handguard', recvFront, top + 6, 170, bottom - top - 2, 6, { vents: { x: recvFront + 12, y: top + 16, w: 146, n: 7 } });
      if (pr.brake) mb.rect('brake', recvFront + barrelL, top + 4, 46, 32, { ports: true });
      if (pr.bipod) {
        mb.rect('bipodL', recvFront + 120, bottom + 2, 8, 70);
        mb.rect('bipodR', recvFront + 140, bottom + 2, 8, 70);
      }
      if (style === 'bolt' || style === 'antimat') mb.poly('boltHandle', [[-8, top + 12], [16, top + 12], [22, top + 34], [30, top + 40], [18, top + 44], [10, top + 26]], { move: 'boltHandle', trim: true });
      else mb.rect('charging', recvBack + 4, top - 8, 24, 8, { move: 'bolt' });
      const sL = 190 * (pr.scopeLen || 1);
      mb.rect('ring1', recvBack + 30, top - 14, 10, 14);
      mb.rect('ring2', recvBack + 30 + sL - 70, top - 14, 10, 14);
      mb.poly('scope', [[recvBack - 10, top - 50], [recvBack + 20, top - 42], [recvBack + sL - 30, top - 42], [recvBack + sL, top - 54], [recvBack + sL, top - 14], [recvBack + sL - 30, top - 24], [recvBack + 20, top - 24], [recvBack - 10, top - 16]], { lens: true });
      mb.hi(recvBack + 10, top + 1, recvFront, top + 1);
      mb.hi(recvFront, top + 13, recvFront + barrelL, top + 13);
      const mx = recvFront + barrelL + (pr.brake ? 46 : 0);
      return mb.build(
        { muzzle: { x: mx + 2, y: top + (big ? 20 : 19) }, eject: { x: 20, y: top + 10 }, hand: { x: -8, y: 34 }, trigger: { x: 30, y: bottom + 16 }, support: { x: recvFront + 90, y: bottom + 6 } },
        { travel: { bolt: 16, boltHandle: 1 }, magDrop: 120, scale: big ? 0.95 : 1.02 }
      );
    },

    lmg(pr) {
      const mb = new MB();
      const top = -72;
      const bottom = -26;
      const recvBack = -80;
      const recvFront = 120;
      const barrelL = 220 * (pr.barrelLen || 1);
      if (pr.furniture === 'wood') mb.poly('stock', [[recvBack, top + 8], [recvBack - 170, top + 24], [recvBack - 176, bottom + 48], [recvBack - 150, bottom + 54], [recvBack, bottom + 8]], { tone: 'wood' });
      else stockAR(mb, recvBack, top, bottom);
      grip(mb, -10, bottom, 70, 0.22);
      mb.guard('guard', [[14, bottom + 2], [14, bottom + 30], [48, bottom + 30], [56, bottom + 4]], 6);
      if (pr.box) mb.rrect('mag', 40, bottom + 4, 84, 92, 8, { move: 'mag', tone: 'metal', belt: true });
      mb.poly('receiver', [[recvBack, top + 10], [recvBack + 10, top], [recvFront, top], [recvFront, bottom], [recvBack, bottom + 4]], { tone: 'metal', eject: [10, top + 30, 44, 12] });
      mb.rect('topCover', recvBack + 20, top - 12, 150, 14, { move: 'bolt' });
      mb.rect('heatShield', recvFront, top + 4, barrelL * 0.6, 26, { holes: { x: recvFront + 14, y: top + 17, n: 6 } });
      mb.rect('barrel', recvFront, top + 10, barrelL, pr.heavy ? 18 : 14, { tone: 'metal' });
      mb.poly('carry', [[recvFront + 30, top + 4], [recvFront + 36, top - 24], [recvFront + 90, top - 24], [recvFront + 96, top + 4]], { hollow: true });
      if (pr.bipod) {
        mb.rect('bipodL', recvFront + barrelL - 60, top + 26, 7, 80);
        mb.rect('bipodR', recvFront + barrelL - 44, top + 26, 7, 80);
      }
      mb.rect('flash', recvFront + barrelL, top + 6, 26, 24, { ports: true });
      mb.hi(recvBack + 10, top + 1, recvFront, top + 1);
      return mb.build(
        { muzzle: { x: recvFront + barrelL + 28, y: top + 18 }, eject: { x: 30, y: top + 36 }, hand: { x: -8, y: 34 }, trigger: { x: 30, y: bottom + 16 }, support: { x: recvFront + 70, y: top + 36 } },
        { travel: { bolt: 12 }, magDrop: 150, scale: 0.98 }
      );
    },

    minigun() {
      const mb = new MB();
      const top = -60;
      mb.rrect('motor', -120, top - 20, 150, 80, 14, { tone: 'metal' });
      mb.poly('grip', [[-40, top + 60], [0, top + 60], [-6, top + 130], [-44, top + 130]], { texture: true });
      mb.poly('chute', [[-60, top + 60], [-20, top + 60], [-50, top + 170], [-110, top + 170]], { tone: 'metal', belt: true });
      for (let i = 0; i < 3; i++) mb.rect('barrel' + i, 30, top - 12 + i * 20, 330, 12, { tone: 'metal', move: 'spin' });
      mb.rect('clampA', 60, top - 18, 14, 66);
      mb.rect('clampB', 220, top - 18, 14, 66);
      mb.rect('clampC', 346, top - 18, 16, 66);
      mb.poly('handle', [[-100, top - 20], [-90, top - 50], [0, top - 50], [10, top - 20]], { hollow: true });
      mb.hi(-110, top - 19, 20, top - 19);
      return mb.build(
        { muzzle: { x: 366, y: top + 14 }, eject: { x: -20, y: top + 50 }, hand: { x: -20, y: top + 90 }, trigger: { x: 10, y: top + 70 }, support: { x: 140, y: top + 50 } },
        { magDrop: 0, scale: 0.92 }
      );
    },

    launcher(pr) {
      const mb = new MB();
      const top = -84;
      mb.poly('stock', [[-80, top + 30], [-220, top + 44], [-226, top + 104], [-200, top + 108], [-80, top + 70]], { hollow: true });
      grip(mb, -10, top + 70, 64, 0.2);
      mb.guard('guard', [[14, top + 72], [14, top + 98], [44, top + 98], [52, top + 74]], 6);
      mb.rrect('frame', -90, top + 22, 180, 50, 8, { tone: 'metal' });
      if (pr.drum) mb.rrect('drum', -20, top + 4, 120, 90, 24, { move: 'cylinder', tone: 'ink', chambers: { x: -20, y: top + 4, w: 120, h: 90 } });
      mb.rrect('tube', 100, top + 18, 180, 58, 12, { tone: 'metal' });
      mb.rect('muzzleRing', 270, top + 12, 16, 70);
      mb.poly('foregrip', [[150, top + 76], [178, top + 76], [172, top + 136], [152, top + 136]]);
      mb.poly('ladder', [[150, top + 18], [156, top - 16], [176, top - 16], [180, top + 18]], { hollow: true });
      mb.hi(100, top + 19, 280, top + 19);
      return mb.build(
        { muzzle: { x: 290, y: top + 47 }, eject: { x: 40, y: top + 20 }, hand: { x: -8, y: top + 100 }, trigger: { x: 30, y: top + 84 }, support: { x: 164, y: top + 110 } },
        { magDrop: 0, scale: 1.05 }
      );
    },

    arc() {
      const mb = new MB();
      const top = -70;
      mb.poly('stock', [[-70, top + 14], [-190, top + 30], [-196, top + 90], [-170, top + 94], [-70, top + 56]], { tone: 'metal', hollow: true });
      grip(mb, -10, top + 50, 66, 0.2);
      mb.guard('guard', [[14, top + 52], [14, top + 78], [44, top + 78], [52, top + 54]], 6);
      mb.rrect('capacitor', -60, top + 56, 70, 40, 12, { tone: 'glow', move: 'mag' });
      mb.rrect('body', -80, top, 190, 56, 14, { tone: 'metal' });
      for (let i = 0; i < 5; i++) mb.rrect('coil' + i, 110 + i * 30, top - 6 + i * 2, 18, 68 - i * 4, 8, { tone: 'glow', move: 'glow' });
      mb.rect('spine', 110, top + 22, 170, 12, { tone: 'metal' });
      mb.poly('prongTop', [[270, top + 10], [330, top + 4], [336, top + 14], [276, top + 22]]);
      mb.poly('prongBot', [[270, top + 34], [330, top + 40], [336, top + 30], [276, top + 24]]);
      mb.hi(-70, top + 1, 110, top + 1);
      return mb.build(
        { muzzle: { x: 334, y: top + 22 }, eject: { x: 0, y: top + 10 }, hand: { x: -10, y: top + 84 }, trigger: { x: 30, y: top + 64 }, support: { x: 180, y: top + 70 } },
        { magDrop: 70, scale: 1.08 }
      );
    },

    needle() {
      const mb = new MB();
      const top = -64;
      mb.poly('stock', [[-70, top + 10], [-160, top + 22], [-166, top + 76], [-140, top + 80], [-70, top + 52]], { tone: 'metal' });
      grip(mb, -10, top + 48, 66, 0.2);
      mb.guard('guard', [[14, top + 50], [14, top + 76], [44, top + 76], [52, top + 52]], 6);
      mb.rrect('canister', -40, top - 44, 150, 40, 18, { tone: 'glow', move: 'mag' });
      mb.poly('body', [[-80, top + 4], [-70, top - 4], [150, top - 4], [170, top + 20], [150, top + 48], [-80, top + 48]], { tone: 'metal' });
      for (let i = 0; i < 4; i++) mb.rect('needle' + i, 160, top + 4 + i * 11, 150 - i * 12, 5, { tone: 'metal', move: 'spin' });
      mb.hi(-70, top - 3, 150, top - 3);
      return mb.build(
        { muzzle: { x: 312, y: top + 20 }, eject: { x: 30, y: top }, hand: { x: -10, y: top + 82 }, trigger: { x: 30, y: top + 62 }, support: { x: 120, y: top + 60 } },
        { magDrop: 60, scale: 1.08 }
      );
    },

    rail() {
      const mb = new MB();
      const top = -70;
      mb.poly('stock', [[-70, top + 12], [-200, top + 26], [-206, top + 86], [-180, top + 90], [-70, top + 58]], { tone: 'metal' });
      grip(mb, -10, top + 54, 66, 0.22);
      mb.guard('guard', [[14, top + 56], [14, top + 82], [44, top + 82], [52, top + 58]], 6);
      mb.rrect('cell', -50, top + 58, 80, 34, 8, { tone: 'glow', move: 'mag' });
      mb.rrect('body', -80, top, 170, 58, 10, { tone: 'metal' });
      mb.rect('railTop', 80, top + 2, 330, 16, { tone: 'metal' });
      mb.rect('railBot', 80, top + 38, 330, 16, { tone: 'metal' });
      mb.rect('railGap', 90, top + 20, 312, 16, { tone: 'glow', move: 'glow' });
      mb.rect('scopeMount', -30, top - 10, 80, 10);
      mb.rrect('scope', -60, top - 38, 150, 26, 10, { lens: true });
      mb.hi(80, top + 3, 410, top + 3);
      return mb.build(
        { muzzle: { x: 412, y: top + 28 }, eject: { x: 0, y: top + 10 }, hand: { x: -10, y: top + 88 }, trigger: { x: 30, y: top + 68 }, support: { x: 190, y: top + 70 } },
        { magDrop: 60, scale: 0.95 }
      );
    },
  };

  const cache = new Map();

  /** Returns the cached model for a weapon definition. */
  function modelFor(def) {
    let m = cache.get(def.id);
    if (!m) {
      const b = builders[def.model.builder];
      m = b ? b(def.model.params || {}) : builders.pistol({});
      cache.set(def.id, m);
    }
    return m;
  }

  /* ------------------------------------------------------------------ draw */

  /**
   * Draws a model into the current transform.
   * anim: { slide, pump, bolt, mag, magAlpha, magHidden, boltHandle (0..1), cylinder (turns), cylOut (px),
   *         barrels (radians, break-open), spin (px), glow (0..1) }
   * style: 'ink' (viewmodel), 'paper' (armory: paper body, ink rim), 'ghost' (locked).
   * finish: cosmetic id ('fin.factory' | 'fin.brushed' | 'fin.halftone' | 'fin.tiger' | 'fin.brass').
   */
  function draw(ctx, model, anim, style, dpr, finish) {
    const a = anim || {};
    const st = style || 'ink';
    const paper = st === 'paper';
    const brass = finish === 'fin.brass';
    const body = paper ? P.paper : P.ink;
    const metal = paper ? P.paperHi : P.charcoal;
    const wood = paper ? P.paperDim : '#3a332b';
    const rim = paper ? P.ink : P.paper;
    const glowC = paper ? P.paperHi : P.paper;
    const hinge = model.anchors.hinge;

    const withPart = (part, fn) => {
      if (part.move === 'mag' && a.magHidden) return;
      ctx.save();
      switch (part.move) {
        case 'slide':
          ctx.translate(-(a.slide || 0), 0);
          break;
        case 'pump':
          ctx.translate(-(a.pump || 0), 0);
          break;
        case 'bolt':
          ctx.translate(-(a.bolt || 0), 0);
          break;
        case 'mag':
          ctx.translate(0, a.mag || 0);
          if (a.magAlpha != null) ctx.globalAlpha *= a.magAlpha;
          break;
        case 'boltHandle': {
          const k = a.boltHandle || 0;
          const lift = Math.min(1, k * 2);
          const pull = Math.max(0, Math.min(1, k * 2 - 0.5)) * 40;
          ctx.translate(-pull, -lift * 14);
          break;
        }
        case 'cylinder':
          // Swung-out cylinder / drum during a reload.
          if (a.cylOut) ctx.translate(-a.cylOut * 0.25, a.cylOut);
          break;
        case 'barrels':
          if (hinge && a.barrels) {
            ctx.translate(hinge.x, hinge.y);
            ctx.rotate(a.barrels);
            ctx.translate(-hinge.x, -hinge.y);
          }
          break;
        default:
          break;
      }
      fn(part);
      ctx.restore();
    };

    const strokeGuard = (part, width, color) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.beginPath();
      part.guard.stroke.forEach((pt, i) => (i ? ctx.lineTo(pt[0], pt[1]) : ctx.moveTo(pt[0], pt[1])));
      ctx.stroke();
    };

    if (st === 'ghost') {
      const ghost = ZTA.paint.rgba(P.paperDim, 0.55);
      ctx.setLineDash([7, 5]);
      for (const part of model.parts) {
        withPart(part, (pt) => {
          if (pt.guard) return strokeGuard(pt, 2.5, ghost);
          ctx.strokeStyle = ghost;
          ctx.lineWidth = 2.5;
          ctx.stroke(pt.path);
        });
      }
      ctx.setLineDash([]);
      return;
    }

    // Rim pass: a thick contrasting outline so the silhouette reads on any backdrop.
    for (const part of model.parts) {
      withPart(part, (pt) => {
        if (pt.guard) return strokeGuard(pt, pt.guard.width + 6, rim);
        ctx.strokeStyle = rim;
        ctx.lineWidth = 6;
        ctx.lineJoin = 'round';
        ctx.stroke(pt.path);
      });
    }

    // Body pass.
    const detail = paper ? ZTA.paint.rgba(P.ink, 0.7) : ZTA.paint.rgba(P.paper, 0.55);
    for (const part of model.parts) {
      withPart(part, (pt) => {
        if (pt.guard) return strokeGuard(pt, pt.guard.width, brass && !paper ? P.brass : body);
        let fill = pt.tone === 'metal' ? metal : pt.tone === 'wood' ? wood : body;
        if (pt.tone === 'glow') fill = paper ? P.paperHi : ZTA.paint.rgba(P.paper, 0.2 + 0.6 * (a.glow || 0));
        if (pt.trim && brass) fill = P.brass;
        if (pt.hollow) {
          ctx.lineWidth = 8;
          ctx.strokeStyle = fill;
          ctx.stroke(pt.path);
        } else {
          ctx.fillStyle = fill;
          ctx.fill(pt.path);
        }
        if (paper) {
          ctx.strokeStyle = P.ink;
          ctx.lineWidth = 1.5;
          ctx.stroke(pt.path);
        }
        if (pt.tone === 'wood' && !paper) {
          ctx.save();
          ctx.clip(pt.path);
          ctx.strokeStyle = ZTA.paint.rgba(P.paper, 0.14);
          ctx.lineWidth = 1;
          ctx.beginPath();
          for (let y = -300; y < 300; y += 7) {
            ctx.moveTo(-400, y);
            ctx.bezierCurveTo(-200, y + 6, 0, y - 6, 400, y + 4);
          }
          ctx.stroke();
          ctx.restore();
        }
        if (pt.texture && !paper) {
          ctx.save();
          ctx.clip(pt.path);
          ctx.fillStyle = ZTA.paint.pattern(ctx, 5, 1.1, ZTA.paint.rgba(P.paper, 0.22), dpr);
          ctx.fillRect(-500, -300, 1200, 700);
          ctx.restore();
        }
        if (!paper && finish && finish !== 'fin.factory' && pt.tone !== 'glow') drawFinish(ctx, pt, finish, dpr);
        if (pt.tone === 'glow' && !paper && a.glow > 0.05) {
          ctx.save();
          ctx.shadowColor = P.paperHi;
          ctx.shadowBlur = 18 * a.glow;
          ctx.strokeStyle = ZTA.paint.rgba(P.paperHi, 0.8 * a.glow);
          ctx.lineWidth = 2;
          ctx.stroke(pt.path);
          ctx.restore();
        }
        ctx.strokeStyle = detail;
        ctx.lineWidth = 1.2;
        if (pt.serrations) {
          const sr = pt.serrations;
          ctx.beginPath();
          for (let i = 0; i < sr.n; i++) {
            ctx.moveTo(sr.x + i * 4, sr.y0);
            ctx.lineTo(sr.x + i * 4, sr.y1);
          }
          ctx.stroke();
        }
        if (pt.eject) ctx.strokeRect(pt.eject[0], pt.eject[1], pt.eject[2], pt.eject[3]);
        if (pt.ribs) {
          const r = pt.ribs;
          ctx.beginPath();
          for (let i = 0; i < r.n; i++) {
            const x = r.x + (r.w / (r.n - 1)) * i;
            ctx.moveTo(x, r.y);
            ctx.lineTo(x, r.y + r.h);
          }
          ctx.stroke();
        }
        if (pt.vents) {
          const v = pt.vents;
          ctx.beginPath();
          for (let i = 0; i < v.n; i++) {
            const x = v.x + (v.w / v.n) * i;
            ctx.rect(x, v.y, v.w / v.n - 8, 8);
          }
          ctx.stroke();
        }
        if (pt.holes) {
          const ho = pt.holes;
          ctx.fillStyle = detail;
          ctx.beginPath();
          for (let i = 0; i < ho.n; i++) {
            ctx.moveTo(ho.x + i * 12 + 3, ho.y);
            ctx.arc(ho.x + i * 12, ho.y, 3, 0, Math.PI * 2);
          }
          ctx.fill();
        }
        if (pt.ports) {
          ctx.beginPath();
          const bb = pt.box;
          if (bb) for (let i = 0; i < 3; i++) ctx.rect(bb.x + 4 + i * ((bb.w - 8) / 3), bb.y + 3, (bb.w - 8) / 3 - 3, 4);
          ctx.stroke();
        }
        if (pt.flutes) {
          const f = pt.flutes;
          const off = ((a.cylinder || 0) * f.w) % (f.w / f.n);
          ctx.save();
          ctx.clip(pt.path);
          ctx.beginPath();
          for (let i = -1; i <= f.n; i++) {
            const x = f.x + (f.w / f.n) * i + off;
            ctx.moveTo(x, f.y + 6);
            ctx.lineTo(x, f.y + f.h - 6);
          }
          ctx.stroke();
          ctx.restore();
        }
        if (pt.chambers) {
          const c = pt.chambers;
          ctx.beginPath();
          for (let i = 0; i < 3; i++) {
            const cx = c.x + c.w * (0.2 + 0.3 * i);
            ctx.moveTo(cx + 12, c.y + c.h / 2);
            ctx.arc(cx, c.y + c.h / 2, 12, 0, Math.PI * 2);
          }
          ctx.stroke();
        }
        if (pt.drum) {
          const bb = pt.box;
          if (bb) {
            ctx.beginPath();
            ctx.arc(bb.x + bb.w / 2, bb.y + bb.h / 2, bb.w * 0.28, 0, Math.PI * 2);
            ctx.stroke();
          }
        }
        if (pt.belt) {
          ctx.beginPath();
          const bb = pt.box;
          if (bb) for (let y = bb.y + 10; y < bb.y + bb.h - 6; y += 10) {
            ctx.moveTo(bb.x + 8, y);
            ctx.lineTo(bb.x + bb.w - 8, y);
          }
          ctx.stroke();
        }
        if (pt.lens) {
          const bb = pt.box;
          if (bb) {
            ctx.fillStyle = paper ? P.ink : ZTA.paint.rgba(P.paperHi, 0.8);
            ctx.fillRect(bb.x + bb.w - 6, bb.y + 4, 4, bb.h - 8);
          }
        }
        if (pt.move === 'spin' && a.spin) {
          const bb = pt.box;
          if (bb) {
            ctx.save();
            ctx.clip(pt.path);
            ctx.strokeStyle = ZTA.paint.rgba(P.paper, 0.35);
            ctx.lineWidth = 2;
            ctx.beginPath();
            for (let x = bb.x + (a.spin % 24); x < bb.x + bb.w; x += 24) {
              ctx.moveTo(x, bb.y);
              ctx.lineTo(x - 6, bb.y + bb.h);
            }
            ctx.stroke();
            ctx.restore();
          }
        }
      });
    }

    // Highlights along the top edges.
    ctx.strokeStyle = paper ? ZTA.paint.rgba(P.ink, 0.35) : brass ? P.brassHi : ZTA.paint.rgba(P.paperHi, 0.85);
    ctx.lineWidth = 1.6;
    for (const h of model.highlights) {
      ctx.save();
      if (h[4] === 'slide') ctx.translate(-(a.slide || 0), 0);
      if (h[4] === 'barrels' && hinge && a.barrels) {
        ctx.translate(hinge.x, hinge.y);
        ctx.rotate(a.barrels);
        ctx.translate(-hinge.x, -hinge.y);
      }
      ctx.beginPath();
      ctx.moveTo(h[0], h[1]);
      ctx.lineTo(h[2], h[3]);
      ctx.stroke();
      ctx.restore();
    }
  }

  function drawFinish(ctx, part, finish, dpr) {
    if (!part.path) return;
    ctx.save();
    ctx.clip(part.path);
    if (finish === 'fin.brushed') {
      ctx.strokeStyle = ZTA.paint.rgba(P.paper, 0.13);
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let y = -300; y < 300; y += 3) {
        ctx.moveTo(-500, y);
        ctx.lineTo(700, y + 1);
      }
      ctx.stroke();
    } else if (finish === 'fin.halftone') {
      ctx.fillStyle = ZTA.paint.pattern(ctx, 6, 1.8, ZTA.paint.rgba(P.paper, 0.3), dpr);
      ctx.fillRect(-500, -300, 1200, 700);
    } else if (finish === 'fin.tiger') {
      ctx.fillStyle = ZTA.paint.rgba(P.paper, 0.3);
      for (let x = -500; x < 700; x += 38) {
        ctx.beginPath();
        ctx.moveTo(x, -300);
        ctx.quadraticCurveTo(x + 30, 0, x + 8, 300);
        ctx.lineTo(x + 20, 300);
        ctx.quadraticCurveTo(x + 44, 0, x + 14, -300);
        ctx.closePath();
        ctx.fill();
      }
    } else if (finish === 'fin.brass' && (part.tone === 'metal' || part.name === 'slide' || part.name === 'receiver')) {
      ctx.strokeStyle = ZTA.paint.rgba(P.brass, 0.6);
      ctx.lineWidth = 3;
      ctx.stroke(part.path);
    }
    ctx.restore();
  }

  /** Draws a model centered and scaled to fit a w×h box (armory thumbnails). */
  function drawFit(ctx, model, w, h, style, pad, dpr, finish) {
    const b = model.bounds;
    const mw = b.maxX - b.minX;
    const mh = b.maxY - b.minY;
    const p = pad == null ? 12 : pad;
    const s = Math.min((w - p * 2) / mw, (h - p * 2) / mh);
    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.scale(s, s);
    ctx.translate(-(b.minX + mw / 2), -(b.minY + mh / 2));
    draw(ctx, model, null, style, dpr, finish);
    ctx.restore();
  }

  ZTA.GunArt = { builders, modelFor, draw, drawFit };
})(typeof window !== 'undefined' ? window : globalThis);
