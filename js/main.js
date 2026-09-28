/*
 * Boot, input, main loop, audio wiring and autosave.
 */
(function (root) {
  'use strict';
  const ZTA = root.ZTA;

  const AUTOSAVE_SECONDS = 12;

  function boot(hotData) {
    const errors = ZTA.content.validateCatalog();
    if (errors.length) console.warn('[ZTA] content catalog problems:\n' + errors.join('\n'));

    const loaded = ZTA.SaveSystem.load();
    let save = loaded.data;
    // A live-reloaded page may hand back a newer in-memory save.
    if (hotData && hotData.save && hotData.save.savedAt > save.savedAt) save = ZTA.SaveSystem.sanitize(hotData.save);
    if (loaded.warnings.length) console.warn('[ZTA] ' + loaded.warnings.join(' | '));

    const events = new ZTA.Emitter();
    const game = new ZTA.Game({ events, save });
    const audio = ZTA.Audio;
    const canvas = document.getElementById('stage');
    const fx = new ZTA.FX(game);
    const viewmodel = new ZTA.Viewmodel(game, fx, audio);
    const renderer = new ZTA.Renderer(canvas, game, fx, viewmodel);

    const app = { game, audio, fx, viewmodel, renderer, dirty: false, saveFailedShown: false };
    app.requestSave = (reason) => writeSave(app, reason);
    app.hud = new ZTA.UI.Hud(game, audio);
    app.armory = new ZTA.UI.Armory(game, audio, {
      onClose: () => app.menus.closeAll(),
      onReveal: (id) => app.menus.showReveal(id),
      onTest: (id) => app.testGun(id),
    });
    app.menus = new ZTA.UI.Menus(app);
    app.testGun = (id) => testGun(app, id);
    app.resetProgress = () => {
      app.resetting = true;
      ZTA.SaveSystem.wipe();
      root.location.reload();
    };

    if (loaded.source === 'backup') app.hud.toast('<strong>Recovered</strong>The latest save was damaged, so the backup was loaded.', 'new', 5000);

    wireAudio(app);
    wireSaving(app);
    wireInput(app, canvas);
    startLoop(app);

    root.ZTA.app = app;
    if (root.claude && root.claude.hot && root.claude.hot.snapshot) {
      try {
        root.claude.hot.snapshot(() => ({ save: JSON.parse(JSON.stringify(game.save)) }));
      } catch (e) {
        /* optional host feature */
      }
    }
    return app;
  }

  /* ----------------------------------------------------------------- saving */

  function writeSave(app, reason) {
    if (app.resetting) return;
    const r = ZTA.SaveSystem.save(undefined, app.game.save);
    app.dirty = false;
    app.lastSave = performance.now();
    if (!r.ok && !app.saveFailedShown) {
      app.saveFailedShown = true;
      app.hud.toast('<strong>Not saved</strong>This browser is blocking storage, so progress lasts only until you close the tab.', 'new', 6000);
    }
    app.game.events.emit('save:written', { ok: r.ok, reason });
  }

  function wireSaving(app) {
    const ev = app.game.events;
    ev.on('save:request', (e) => writeSave(app, e.reason));
    ev.on('cash:changed', () => {
      app.dirty = true;
    });
    ev.on('wave:clear', () => {
      app.dirty = true;
    });
    app.lastSave = performance.now();
    setInterval(() => {
      if (app.dirty && performance.now() - app.lastSave > AUTOSAVE_SECONDS * 1000) writeSave(app, 'interval');
    }, 2000);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) writeSave(app, 'hidden');
      app.menus.setHidden(document.hidden);
    });
    root.addEventListener('pagehide', () => writeSave(app, 'pagehide'));
  }

  /* ------------------------------------------------------------------ audio */

  function wireAudio(app) {
    const ev = app.game.events;
    const audio = app.audio;
    const game = app.game;
    const pan = (x) => ((x / game.camera.W) * 2 - 1) * 0.6;
    ev.on('weapon:fired', (e) => audio.gunshot(e.stats.audio, { comboTier: game.combo.tier }));
    ev.on('target:hit', (e) => {
      if (e.broken) return;
      const kind = e.weak ? 'crit' : e.armored ? 'armor' : 'hit';
      audio.impact(e.target.def.material, kind, { pan: pan(e.x), size: e.target.scale, comboTier: game.combo.tier });
    });
    ev.on('target:broken', (e) => {
      const c = ZTA.TargetArt.center(e.target, game.camera, {});
      audio.impact(e.target.def.material, 'break', { pan: pan(c.sx), size: e.target.scale });
    });
    ev.on('shot:resolved', (e) => {
      if (e.result.anyHit) return;
      const im = e.impacts[0];
      if (im) audio.impact(im.kind === 'prop' ? 'wood' : 'backstop', 'hit', { pan: pan(im.x) });
    });
    ev.on('target:landed', () => audio.play('land'));
    ev.on('wave:clear', () => audio.play('wave_clear'));
    ev.on('combo:changed', (e) => {
      if (e.tierUp) audio.play('combo_up', { tier: e.tier });
    });
    ev.on('purchase:denied', () => audio.play('ui_deny'));
  }

  /* ------------------------------------------------------------------ input */

  function testGun(app, id) {
    const game = app.game;
    const save = game.save;
    if (!game.progression.isOwned(id)) return;
    const slot = save.equipped.indexOf(id);
    if (slot === -1) game.progression.equip(save.activeSlot, id);
    else if (slot !== save.activeSlot) game.weapons.switchTo(slot);
    app.menus.closeAll();
  }

  function wireInput(app, canvas) {
    const game = app.game;
    const menus = app.menus;
    let pointerDown = false;

    const toLocal = (e) => {
      const r = canvas.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };

    canvas.addEventListener('pointermove', (e) => {
      const p = toLocal(e);
      game.setAim(p.x, p.y);
    });
    canvas.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      const p = toLocal(e);
      game.setAim(p.x, p.y);
      if (!game.live) return;
      pointerDown = true;
      try {
        canvas.setPointerCapture(e.pointerId);
      } catch (err) {
        /* not supported everywhere */
      }
      e.preventDefault();
      game.weapons.pressTrigger();
    });
    const release = () => {
      if (!pointerDown) return;
      pointerDown = false;
      game.weapons.releaseTrigger();
    };
    canvas.addEventListener('pointerup', release);
    canvas.addEventListener('pointercancel', release);
    root.addEventListener('pointerup', release);
    root.addEventListener('blur', () => {
      release();
      menus.setHidden(true);
      menus.setHidden(false);
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener(
      'wheel',
      (e) => {
        if (!game.live) return;
        e.preventDefault();
        if (Math.abs(e.deltaY) < 4) return;
        const now = performance.now();
        if (now - (app.lastWheel || 0) < 120) return;
        app.lastWheel = now;
        game.weapons.cycle(e.deltaY > 0 ? 1 : -1);
      },
      { passive: false }
    );

    root.addEventListener('keydown', (e) => {
      if (e.key === 'Tab') {
        e.preventDefault();
        if (!e.repeat) menus.toggleArmory();
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        menus.back();
        return;
      }
      if (!menus.started && (e.key === 'Enter' || e.key === ' ') && document.activeElement === document.body) {
        e.preventDefault();
        menus.start();
        return;
      }
      if (!game.live || e.repeat) return;
      const k = e.key.toLowerCase();
      if (k === 'r') game.weapons.requestReload();
      else if (k === '1' || k === '2' || k === '3') game.weapons.switchTo(Number(k) - 1);
      else if (k === 'q') game.weapons.cycle(-1);
    });

    // Touch helpers for coarse pointers.
    if (root.matchMedia && root.matchMedia('(pointer: coarse)').matches) {
      document.getElementById('touch-controls').hidden = false;
      document.getElementById('touch-reload').addEventListener('click', () => game.live && game.weapons.requestReload());
      document.getElementById('touch-switch').addEventListener('click', () => game.live && game.weapons.cycle(1));
    }

    let resizeT = 0;
    root.addEventListener('resize', () => {
      clearTimeout(resizeT);
      resizeT = setTimeout(() => app.renderer.resize(), 80);
    });
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => app.renderer.resize());
  }

  /* ------------------------------------------------------------------- loop */

  function startLoop(app) {
    let last = performance.now();
    const frame = (now) => {
      const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
      last = now;
      const live = app.game.live;
      const simDt = live ? dt : 0;
      app.game.update(dt);
      app.viewmodel.update(simDt);
      app.fx.update(simDt);
      app.renderer.render(simDt);
      app.hud.frame(dt, live);
      root.requestAnimationFrame(frame);
    };
    root.requestAnimationFrame(frame);
  }

  function start() {
    const hot = root.claude && root.claude.hot;
    if (hot && hot.ready) hot.ready(boot);
    else boot(hot && hot.data ? hot.data : {});
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();

  ZTA.boot = boot;
})(typeof window !== 'undefined' ? window : globalThis);
