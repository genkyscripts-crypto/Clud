/*
 * Parametric gun silhouettes. A weapon's `model: { builder, params }` picks a
 * builder here and tunes its proportions, so new guns reuse builders instead of
 * needing new art code. The same model draws the first-person viewmodel and
 * the armory thumbnails.
 *
 * Model space: x points toward the muzzle, y points down, origin = firing-hand
 * grip. Units are pixels at a 1080p viewmodel scale of 1.
 *
 * A model is { parts, anchors, bounds }. Each part has a Path2D, a tone and an
 * optional `move` channel ('slide', 'pump', 'bolt', 'mag') animated by the
 * viewmodel. Highlights are short paper lines along lit edges.
 */
(function (root) {
  'use strict';
  const ZTA = root.ZTA;
  const P = ZTA.palette;

  function path(points) {
    const p = new Path2D();
    points.forEach((pt, i) => (i ? p.lineTo(pt[0], pt[1]) : p.moveTo(pt[0], pt[1])));
    p.closePath();
    return p;
  }
  function rect(x, y, w, h) {
    const p = new Path2D();
    p.rect(x, y, w, h);
    return p;
  }
  function roundRect(x, y, w, h, r) {
    const p = new Path2D();
    const rr = Math.min(r, w / 2, h / 2);
    p.moveTo(x + rr, y);
    p.arcTo(x + w, y, x + w, y + h, rr);
    p.arcTo(x + w, y + h, x, y + h, rr);
    p.arcTo(x, y + h, x, y, rr);
    p.arcTo(x, y, x + w, y, rr);
    p.closePath();
    return p;
  }
  /** Thick stroked loop (trigger guards) rendered as its own path. */
  function guard(points, width) {
    return { stroke: points, width };
  }

  const builders = {
    pistol(pr) {
      const L = 188 * (pr.slideLen || 1);
      const H = 30 * (pr.slideH || 1);
      const back = -40;
      const front = back + L;
      const top = -64;
      const bottom = top + H;
      const parts = [];
      const mag = { name: 'mag', move: 'mag', tone: 'metal', path: path([[-44, 6], [-8, 6], [-14, 96], [-52, 94]]) };
      parts.push(mag);
      const gripSlant = pr.gripAngle == null ? 0.2 : pr.gripAngle;
      const gx = Math.tan(gripSlant) * 80;
      parts.push({
        name: 'frame',
        tone: 'ink',
        path: path([
          [back + 4, bottom],
          [front - 16, bottom],
          [front - 16, bottom + 14],
          [52, bottom + 16],
          [12, bottom + 20],
          [16 - gx, 72],
          [8 - gx, 84],
          [-44 - gx, 84],
          [-50 - gx, 74],
          [-44, bottom + 20],
          [-52, bottom + 8],
          [back - 6, bottom + 2],
        ]),
        texture: true,
      });
      parts.push({ name: 'guard', tone: 'ink', guard: guard([[14, bottom + 18], [14, bottom + 44], [pr.guard === 'round' ? 44 : 50, bottom + 44], [56, bottom + 20]], 6) });
      const slidePts = [
        [back, top + 3],
        [back + 3, top],
        [front - 10, top],
        [front, top + 7],
        [front, bottom],
        [back, bottom],
      ];
      parts.push({
        name: 'slide',
        move: 'slide',
        tone: 'metal',
        path: path(slidePts),
        serrations: { x: back + 8, y0: top + 5, y1: bottom - 4, n: pr.serrations || 5 },
        eject: [30, top + 2, 30, 8],
      });
      parts.push({ name: 'rearSight', move: 'slide', tone: 'ink', path: rect(back + 6, top - 6, 12, 7) });
      parts.push({ name: 'frontSight', move: 'slide', tone: 'ink', path: rect(front - 18, top - 5, 6, 6) });
      if (pr.comp) parts.push({ name: 'comp', tone: 'metal', path: rect(front, top + 2, 22, H - 2) });
      if (pr.hammer) parts.push({ name: 'hammer', tone: 'ink', path: path([[back - 4, top + 10], [back - 16, top + 2], [back - 12, top + 14]]) });
      const muzzleX = front + (pr.comp ? 22 : 0);
      return {
        parts,
        anchors: {
          muzzle: { x: muzzleX + 2, y: top + H * 0.45 },
          eject: { x: 40, y: top + 4 },
          hand: { x: -18, y: 34 },
          trigger: { x: 30, y: bottom + 28 },
        },
        highlights: [[back + 3, top + 1, front - 10, top + 1]],
        bounds: { minX: -60 - gx, maxX: muzzleX + 4, minY: top - 8, maxY: 98 },
        slideTravel: 26,
        magDrop: 130,
      };
    },

    smg(pr) {
      const bodyL = 200 * (pr.bodyLen || 1);
      const back = -86;
      const front = back + bodyL;
      const top = -74;
      const bottom = -28;
      const barrelL = 64 * (pr.barrelLen || 1);
      const parts = [];
      parts.push({ name: 'mag', move: 'mag', tone: 'metal', path: path([[-30, 30], [4, 30], [8, 150], [-24, 152]]) });
      parts.push({
        name: 'grip',
        tone: 'ink',
        path: path([[-38, bottom], [16, bottom], [10, 70], [4, 84], [-34, 84], [-44, 70]]),
        texture: true,
      });
      parts.push({ name: 'guard', tone: 'ink', guard: guard([[16, bottom + 2], [16, bottom + 30], [52, bottom + 30], [60, bottom + 4]], 6) });
      if (pr.stock === 'stub') {
        parts.push({ name: 'stock', tone: 'ink', path: path([[back, top + 12], [back - 58, top + 16], [back - 64, bottom + 6], [back - 50, bottom + 12], [back, bottom - 2]]) });
      }
      parts.push({
        name: 'receiver',
        tone: 'metal',
        path: path([[back, top + 6], [back + 8, top], [front - 6, top], [front, top + 8], [front, bottom], [back, bottom]]),
        eject: [10, top + 4, 34, 9],
      });
      if (pr.shroud) {
        parts.push({ name: 'shroud', tone: 'ink', path: rect(front, top + 10, 46, 32), holes: { x: front + 11, y: top + 26, n: 3 } });
      }
      const bStart = front + (pr.shroud ? 46 : 0);
      parts.push({ name: 'barrel', tone: 'metal', path: rect(bStart, top + 20, barrelL, 12) });
      parts.push({ name: 'bolt', move: 'bolt', tone: 'ink', path: rect(back + 22, top - 9, 26, 10) });
      parts.push({ name: 'rail', tone: 'ink', path: rect(back + 60, top - 7, 90, 7) });
      if (pr.foregrip) parts.push({ name: 'foregrip', tone: 'ink', path: path([[front - 40, bottom], [front - 10, bottom], [front - 14, bottom + 60], [front - 36, bottom + 60]]) });
      const muzzleX = bStart + barrelL;
      return {
        parts,
        anchors: {
          muzzle: { x: muzzleX + 2, y: top + 26 },
          eject: { x: 24, y: top + 4 },
          hand: { x: -12, y: 36 },
          trigger: { x: 34, y: bottom + 16 },
        },
        highlights: [[back + 8, top + 1, front - 6, top + 1]],
        bounds: { minX: back - 66, maxX: muzzleX + 4, minY: top - 12, maxY: 154 },
        boltTravel: 16,
        magDrop: 170,
      };
    },

    shotgun(pr) {
      const top = -66;
      const bottom = -22;
      const recvBack = -62;
      const recvFront = 70;
      const barrelL = 300 * (pr.barrelLen || 1);
      const tubeL = 250 * (pr.tubeLen || 1);
      const pumpL = 104 * (pr.pumpLen || 1);
      const parts = [];
      parts.push({
        name: 'stock',
        tone: 'ink',
        path: path([
          [recvBack, top + 6],
          [-270, top + 22],
          [-282, 16],
          [-262, 24],
          [-120, 0],
          [-58, 50],
          [-30, 52],
          [-20, bottom + 4],
          [recvBack, bottom],
        ]),
        texture: true,
      });
      parts.push({ name: 'guard', tone: 'ink', guard: guard([[-10, bottom + 2], [-10, bottom + 26], [24, bottom + 26], [34, bottom + 4]], 6) });
      parts.push({ name: 'barrel', tone: 'metal', path: rect(recvFront, top + 4, barrelL, 14) });
      parts.push({ name: 'tube', tone: 'ink', path: rect(recvFront, top + 20, tubeL, 14) });
      parts.push({ name: 'bead', tone: 'ink', path: rect(recvFront + barrelL - 8, top - 1, 5, 5) });
      parts.push({
        name: 'receiver',
        tone: 'metal',
        path: path([[recvBack, top + 6], [recvBack + 10, top], [recvFront, top], [recvFront, bottom], [recvBack, bottom]]),
        eject: [4, top + 8, 40, 12],
      });
      const pumpX = recvFront + 58;
      parts.push({
        name: 'pump',
        move: 'pump',
        tone: 'ink',
        path: roundRect(pumpX, top + 14, pumpL, 36, 8),
        ribs: { x: pumpX + 10, y: top + 18, w: pumpL - 20, h: 28, n: 6 },
      });
      const muzzleX = recvFront + barrelL;
      return {
        parts,
        anchors: {
          muzzle: { x: muzzleX + 2, y: top + 11 },
          eject: { x: 22, y: top + 10 },
          hand: { x: -34, y: 26 },
          support: { x: pumpX + pumpL * 0.5, y: top + 44 },
          trigger: { x: 10, y: bottom + 14 },
          loadPort: { x: 20, y: bottom + 4 },
        },
        highlights: [
          [recvBack + 10, top + 1, recvFront, top + 1],
          [recvFront, top + 5, muzzleX - 2, top + 5],
        ],
        bounds: { minX: -284, maxX: muzzleX + 4, minY: top - 4, maxY: 56 },
        pumpTravel: 46,
        magDrop: 0,
      };
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

  /**
   * Draws a model into the current transform.
   * anim: { slide, pump, bolt, mag, magAlpha } offsets in model units.
   * style: 'ink' (viewmodel: ink body, paper rim) or 'paper' (armory: paper
   * body with ink rim) or 'ghost' (locked: dashed outline only).
   */
  function draw(ctx, model, anim, style, dpr) {
    const a = anim || {};
    const st = style || 'ink';
    const body = st === 'paper' ? P.paper : P.ink;
    const metal = st === 'paper' ? P.paperHi : P.charcoal;
    const rim = st === 'paper' ? P.ink : P.paper;

    const offsetFor = (part) => {
      switch (part.move) {
        case 'slide':
          return [-(a.slide || 0), 0];
        case 'pump':
          return [-(a.pump || 0), 0];
        case 'bolt':
          return [-(a.bolt || 0), 0];
        case 'mag':
          return [0, a.mag || 0];
        default:
          return [0, 0];
      }
    };

    const eachPart = (fn) => {
      for (const part of model.parts) {
        if (part.move === 'mag' && a.magHidden) continue;
        const o = offsetFor(part);
        ctx.save();
        ctx.translate(o[0], o[1]);
        if (part.move === 'mag' && a.magAlpha != null) ctx.globalAlpha *= a.magAlpha;
        fn(part);
        ctx.restore();
      }
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
      eachPart((part) => {
        if (part.guard) return strokeGuard(part, 2.5, ghost);
        ctx.strokeStyle = ghost;
        ctx.lineWidth = 2.5;
        ctx.stroke(part.path);
      });
      ctx.setLineDash([]);
      return;
    }

    // Rim pass: a thick contrasting outline so the silhouette reads on any backdrop.
    eachPart((part) => {
      if (part.guard) return strokeGuard(part, part.guard.width + 6, rim);
      ctx.strokeStyle = rim;
      ctx.lineWidth = 6;
      ctx.lineJoin = 'round';
      ctx.stroke(part.path);
    });

    // Body pass.
    eachPart((part) => {
      if (part.guard) return strokeGuard(part, part.guard.width, body);
      ctx.fillStyle = part.tone === 'metal' ? metal : body;
      ctx.fill(part.path);
      if (st === 'paper') {
        ctx.strokeStyle = P.ink;
        ctx.lineWidth = 1.5;
        ctx.stroke(part.path);
      }
      if (part.texture && st === 'ink') {
        ctx.save();
        ctx.clip(part.path);
        ctx.fillStyle = ZTA.paint.pattern(ctx, 5, 1.1, ZTA.paint.rgba(P.paper, 0.22), dpr);
        ctx.fillRect(-400, -200, 900, 400);
        ctx.restore();
      }
      const detail = st === 'paper' ? ZTA.paint.rgba(P.ink, 0.7) : ZTA.paint.rgba(P.paper, 0.55);
      ctx.strokeStyle = detail;
      ctx.lineWidth = 1.2;
      if (part.serrations) {
        const sr = part.serrations;
        ctx.beginPath();
        for (let i = 0; i < sr.n; i++) {
          const x = sr.x + i * 4;
          ctx.moveTo(x, sr.y0);
          ctx.lineTo(x, sr.y1);
        }
        ctx.stroke();
      }
      if (part.eject) {
        const e = part.eject;
        ctx.strokeRect(e[0], e[1], e[2], e[3]);
      }
      if (part.ribs) {
        const r = part.ribs;
        ctx.beginPath();
        for (let i = 0; i < r.n; i++) {
          const x = r.x + (r.w / (r.n - 1)) * i;
          ctx.moveTo(x, r.y);
          ctx.lineTo(x, r.y + r.h);
        }
        ctx.stroke();
      }
      if (part.holes) {
        const ho = part.holes;
        ctx.fillStyle = detail;
        ctx.beginPath();
        for (let i = 0; i < ho.n; i++) {
          ctx.moveTo(ho.x + i * 12 + 3, ho.y);
          ctx.arc(ho.x + i * 12, ho.y, 3, 0, Math.PI * 2);
        }
        ctx.fill();
      }
    });

    // Highlights along the top edges.
    ctx.strokeStyle = st === 'paper' ? ZTA.paint.rgba(P.ink, 0.35) : ZTA.paint.rgba(P.paperHi, 0.85);
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    for (const h of model.highlights) {
      const moving = model.parts.find((p) => p.name === 'slide');
      const dx = moving ? -(a.slide || 0) : 0;
      ctx.moveTo(h[0] + dx, h[1]);
      ctx.lineTo(h[2] + dx, h[3]);
    }
    ctx.stroke();
  }

  /** Draws a model centered and scaled to fit a w×h box (armory thumbnails). */
  function drawFit(ctx, model, w, h, style, pad, dpr) {
    const b = model.bounds;
    const mw = b.maxX - b.minX;
    const mh = b.maxY - b.minY;
    const p = pad == null ? 12 : pad;
    const s = Math.min((w - p * 2) / mw, (h - p * 2) / mh);
    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.scale(s, s);
    ctx.translate(-(b.minX + mw / 2), -(b.minY + mh / 2));
    draw(ctx, model, null, style, dpr);
    ctx.restore();
  }

  ZTA.GunArt = { builders, modelFor, draw, drawFit };
})(typeof window !== 'undefined' ? window : globalThis);
