/*
 * The static range, pre-rendered once per resize (or range change) into an
 * offscreen canvas with a margin, then blitted each frame at the recoil
 * offset. The actual painting lives in themes.js, one painter per map.
 */
(function (root) {
  'use strict';
  const ZTA = root.ZTA;
  const U = ZTA.util;

  class Background {
    constructor() {
      this.canvas = document.createElement('canvas');
      this.M = 0;
      this.dpr = 1;
      this.key = '';
    }

    theme(camera) {
      return ZTA.Themes[camera.range.theme] || ZTA.Themes.basement;
    }

    build(camera, W, H, dpr) {
      const M = Math.ceil(Math.tan(U.deg2rad(4.6)) * camera.f) + 24;
      this.M = M;
      this.dpr = dpr;
      this.key = camera.range.id + '|' + W + 'x' + H + '@' + dpr;
      const c = this.canvas;
      c.width = Math.ceil((W + 2 * M) * dpr);
      c.height = Math.ceil((H + 2 * M) * dpr);
      const g = c.getContext('2d');
      g.setTransform(dpr, 0, 0, dpr, M * dpr, M * dpr);
      g.lineCap = 'butt';
      const env = ZTA.Themes.makeEnv(g, camera, W, H, M, dpr);
      g.save();
      this.theme(camera).paint(env);
      g.restore();
    }

    draw(ctx, offX, offY) {
      const c = this.canvas;
      ctx.drawImage(c, -this.M + offX, -this.M + offY, c.width / this.dpr, c.height / this.dpr);
    }
  }

  ZTA.Background = Background;
})(typeof window !== 'undefined' ? window : globalThis);
