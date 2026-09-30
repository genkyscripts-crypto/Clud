/*
 * Vector glyphs for the six reel symbols, drawn with canvas paths so they
 * scale to any size. Each symbol has a distinct silhouette as well as color.
 */
(function (root) {
  'use strict';
  const HE = root.HE;

  function drawSymbol(ctx, id, x, y, s, opts) {
    opts = opts || {};
    const ink = opts.ink || '#0d0d0f';
    const def = HE.data.symbolById[id];
    const col = opts.mono ? '#efe9dc' : def ? def.color : '#fff';
    ctx.save();
    ctx.translate(x, y);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.lineWidth = Math.max(1.5, s * 0.07);
    ctx.strokeStyle = ink;
    ctx.fillStyle = col;
    const u = s / 2;
    ctx.beginPath();
    switch (id) {
      case 'bullet':
        // Cartridge: rounded tip over a casing.
        ctx.moveTo(-u * 0.32, u * 0.8);
        ctx.lineTo(-u * 0.32, -u * 0.15);
        ctx.quadraticCurveTo(-u * 0.32, -u * 0.85, 0, -u * 0.92);
        ctx.quadraticCurveTo(u * 0.32, -u * 0.85, u * 0.32, -u * 0.15);
        ctx.lineTo(u * 0.32, u * 0.8);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(-u * 0.32, -u * 0.1);
        ctx.lineTo(u * 0.32, -u * 0.1);
        ctx.moveTo(-u * 0.4, u * 0.8);
        ctx.lineTo(u * 0.4, u * 0.8);
        ctx.stroke();
        break;
      case 'bolt':
        ctx.moveTo(u * 0.2, -u * 0.95);
        ctx.lineTo(-u * 0.5, u * 0.1);
        ctx.lineTo(-u * 0.02, u * 0.1);
        ctx.lineTo(-u * 0.25, u * 0.95);
        ctx.lineTo(u * 0.55, -u * 0.18);
        ctx.lineTo(u * 0.06, -u * 0.18);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        break;
      case 'bell':
        ctx.moveTo(-u * 0.7, u * 0.55);
        ctx.quadraticCurveTo(-u * 0.55, u * 0.3, -u * 0.5, -u * 0.2);
        ctx.quadraticCurveTo(-u * 0.45, -u * 0.8, 0, -u * 0.82);
        ctx.quadraticCurveTo(u * 0.45, -u * 0.8, u * 0.5, -u * 0.2);
        ctx.quadraticCurveTo(u * 0.55, u * 0.3, u * 0.7, u * 0.55);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(0, u * 0.7, u * 0.16, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        break;
      case 'crown':
        ctx.moveTo(-u * 0.8, u * 0.6);
        ctx.lineTo(-u * 0.8, -u * 0.45);
        ctx.lineTo(-u * 0.4, u * 0.05);
        ctx.lineTo(0, -u * 0.7);
        ctx.lineTo(u * 0.4, u * 0.05);
        ctx.lineTo(u * 0.8, -u * 0.45);
        ctx.lineTo(u * 0.8, u * 0.6);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        break;
      case 'skull':
        ctx.arc(0, -u * 0.12, u * 0.66, Math.PI * 0.9, Math.PI * 2.1);
        ctx.lineTo(u * 0.42, u * 0.52);
        ctx.lineTo(u * 0.42, u * 0.8);
        ctx.lineTo(-u * 0.42, u * 0.8);
        ctx.lineTo(-u * 0.42, u * 0.52);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = ink;
        ctx.beginPath();
        ctx.arc(-u * 0.26, -u * 0.08, u * 0.17, 0, Math.PI * 2);
        ctx.arc(u * 0.26, -u * 0.08, u * 0.17, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(0, u * 0.12);
        ctx.lineTo(-u * 0.08, u * 0.3);
        ctx.lineTo(u * 0.08, u * 0.3);
        ctx.fill();
        break;
      case 'seven':
        ctx.moveTo(-u * 0.62, -u * 0.8);
        ctx.lineTo(u * 0.66, -u * 0.8);
        ctx.lineTo(u * 0.66, -u * 0.52);
        ctx.quadraticCurveTo(u * 0.05, u * 0.05, -u * 0.05, u * 0.88);
        ctx.lineTo(-u * 0.45, u * 0.88);
        ctx.quadraticCurveTo(-u * 0.35, u * 0.0, u * 0.22, -u * 0.46);
        ctx.lineTo(-u * 0.62, -u * 0.46);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        break;
    }
    ctx.restore();
  }

  /** Inline SVG versions for DOM screens (hold picker, ledger, odds). */
  const SVG = {
    bullet: '<path d="M9 21V11Q9 4 12 3Q15 4 15 11V21Z M9 11.5H15 M8 21H16" />',
    bolt: '<path d="M14 2L6 13H11.5L9 22L18 10H12.5Z" />',
    bell: '<path d="M4 17Q6 15 6 10Q6 4 12 4Q18 4 18 10Q18 15 20 17Z" /><circle cx="12" cy="19.4" r="1.8" />',
    crown: '<path d="M3 18V6L8 12L12 4L16 12L21 6V18Z" />',
    skull: '<path d="M5 13Q4 3 12 3Q20 3 19 13L16 15V20H8V15Z" /><circle cx="9" cy="11" r="1.9" fill="#0d0d0f" stroke="none"/><circle cx="15" cy="11" r="1.9" fill="#0d0d0f" stroke="none"/>',
    seven: '<path d="M5 3H19V6.5Q13 12 12.4 21H8Q8.6 13 14.5 7H5Z" />',
  };

  function symbolSVG(id, size) {
    const def = HE.data.symbolById[id];
    const s = size || 22;
    return (
      '<svg class="sym sym-' + id + '" width="' + s + '" height="' + s + '" viewBox="0 0 24 24" aria-label="' + (def ? def.name : id) + '" role="img">' +
      '<g fill="' + (def ? def.color : '#fff') + '" stroke="#0d0d0f" stroke-width="1.4" stroke-linejoin="round">' + (SVG[id] || '') + '</g></svg>'
    );
  }

  HE.drawSymbol = drawSymbol;
  HE.symbolSVG = symbolSVG;
})(typeof window !== 'undefined' ? window : globalThis);
