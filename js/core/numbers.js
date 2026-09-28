/*
 * Number formatting. All currency passes through `fmt.cash` so values read the
 * same everywhere: exact with separators below one million, then three
 * significant digits with a short suffix, then scientific notation.
 *
 * Values are JS doubles: exact integers up to 9e15, and representable (with
 * rounding) up to ~1.8e308, which covers any late-game curve we plan.
 */
(function (root) {
  'use strict';
  const ZTA = root.ZTA;

  const SUFFIXES = ['', 'K', 'M', 'B', 'T', 'Qa', 'Qi', 'Sx', 'Sp', 'Oc', 'No', 'Dc'];

  function groupInt(n) {
    const s = Math.floor(Math.abs(n)).toString();
    let out = '';
    for (let i = 0; i < s.length; i++) {
      if (i > 0 && (s.length - i) % 3 === 0) out += ',';
      out += s[i];
    }
    return (n < 0 ? '-' : '') + out;
  }

  // Truncates (never rounds up money) with a tiny epsilon so 4.56 doesn't show as 4.55.
  const EPS = 1 + 1e-9;
  function threeSig(v) {
    if (v >= 100) return Math.floor(v * EPS).toString();
    if (v >= 10) return (Math.floor(v * 10 * EPS) / 10).toFixed(1);
    return (Math.floor(v * 100 * EPS) / 100).toFixed(2);
  }

  /** Compact number: 999,999 → "999,999"; 1,234,567 → "1.23M"; 1e40 → "1.00e40". */
  function num(n) {
    if (!Number.isFinite(n)) return n > 0 ? '∞' : '—';
    const neg = n < 0;
    const a = Math.abs(n);
    let out;
    if (a < 1e6) {
      out = groupInt(Math.floor(a));
    } else {
      const tier = Math.floor(Math.log10(a) / 3);
      if (tier < SUFFIXES.length) {
        out = threeSig(a / Math.pow(1000, tier)) + SUFFIXES[tier];
      } else {
        const exp = Math.floor(Math.log10(a));
        out = (a / Math.pow(10, exp)).toFixed(2) + 'e' + exp;
      }
    }
    return (neg ? '-' : '') + out;
  }

  const fmt = {
    num,
    cash(n) {
      return '$' + num(n);
    },
    int(n) {
      return groupInt(Math.round(n));
    },
    /** Short decimals for stat readouts: 1.05 → "1.05", 12.5 → "12.5", 40 → "40". */
    dec(n, maxDigits) {
      const d = maxDigits == null ? 2 : maxDigits;
      return (+n.toFixed(d)).toString();
    },
    pct(x) {
      return Math.round(x * 100) + '%';
    },
    mult(x) {
      return '×' + (+x.toFixed(2)).toString();
    },
    secs(s) {
      return (+s.toFixed(2)).toString() + ' s';
    },
    duration(totalSeconds) {
      const s = Math.max(0, Math.floor(totalSeconds));
      const h = Math.floor(s / 3600);
      const m = Math.floor((s % 3600) / 60);
      if (h > 0) return h + 'h ' + m + 'm';
      if (m > 0) return m + 'm ' + (s % 60) + 's';
      return s + 's';
    },
  };

  ZTA.fmt = fmt;
})(typeof window !== 'undefined' ? window : globalThis);
