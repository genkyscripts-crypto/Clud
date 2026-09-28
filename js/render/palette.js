/*
 * Ink palette and halftone helpers. One accent (brass) is reserved for
 * rewards: wave bonuses, unlocks, big payouts and affordable goals.
 */
(function (root) {
  'use strict';
  const ZTA = root.ZTA;

  const P = {
    ink: '#141413',
    ink2: '#1c1c1a',
    charcoal: '#282725',
    graphite: '#55524c',
    smoke: '#8f8a80',
    paperDim: '#cfc9bc',
    paper: '#ebe6da',
    paperHi: '#f8f5ee',
    brass: '#d6a23e',
    brassHi: '#f0c469',
  };

  function rgba(hex, a) {
    const n = parseInt(hex.slice(1), 16);
    return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
  }

  /**
   * Draws a halftone field of dots into the current path region.
   * density(x, y) returns 0..1 (0 = no dot, 1 = full coverage).
   * Dots are batched into one path per call, so this is fast enough for cached layers.
   */
  function dots(ctx, x0, y0, x1, y1, spacing, density, color) {
    ctx.fillStyle = color;
    ctx.beginPath();
    const half = spacing / 2;
    let row = 0;
    for (let y = y0; y <= y1 + spacing; y += spacing * 0.866, row++) {
      const off = row % 2 ? half : 0;
      for (let x = x0 - off; x <= x1 + spacing; x += spacing) {
        const d = density(x, y);
        if (d <= 0.02) continue;
        const r = half * Math.sqrt(Math.min(1, d)) * 1.08;
        ctx.moveTo(x + r, y);
        ctx.arc(x, y, r, 0, Math.PI * 2);
      }
    }
    ctx.fill();
  }

  const patternCache = new Map();

  /** Repeating dot pattern for filling dynamic shapes (targets, gun shading). */
  function pattern(ctx, spacing, radius, color, dpr) {
    const k = spacing + '|' + radius + '|' + color + '|' + dpr;
    let pat = patternCache.get(k);
    if (pat) return pat;
    const scale = dpr || 1;
    const size = Math.max(2, Math.round(spacing * scale));
    const c = document.createElement('canvas');
    c.width = size;
    c.height = size;
    const g = c.getContext('2d');
    g.fillStyle = color;
    g.beginPath();
    const r = radius * scale;
    // Center dot plus the four corners gives a staggered grid when tiled.
    const centers = [
      [size / 2, size / 2],
      [0, 0],
      [size, 0],
      [0, size],
      [size, size],
    ];
    for (const [cx, cy] of centers) {
      g.moveTo(cx + r, cy);
      g.arc(cx, cy, r, 0, Math.PI * 2);
    }
    g.fill();
    pat = ctx.createPattern(c, 'repeat');
    if (pat && pat.setTransform && typeof DOMMatrix !== 'undefined') pat.setTransform(new DOMMatrix().scale(1 / scale).rotate(0, 0, 45));
    patternCache.set(k, pat);
    return pat;
  }

  ZTA.palette = P;
  ZTA.paint = { rgba, dots, pattern };
})(typeof window !== 'undefined' ? window : globalThis);
