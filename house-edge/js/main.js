/*
 * Boot and main loop. Fixed 60 Hz simulation steps with an accumulator;
 * rendering runs once per animation frame.
 */
(function (root) {
  'use strict';
  const HE = root.HE;

  function safeStorage() {
    try {
      const k = '__he_probe';
      window.localStorage.setItem(k, '1');
      window.localStorage.removeItem(k);
      return window.localStorage;
    } catch (e) {
      return null;
    }
  }

  function boot() {
    const params = new URLSearchParams(location.search);
    const dev = params.get('dev') === '1';
    const storage = safeStorage();
    const saveSystem = new HE.SaveSystem(storage);
    const save = saveSystem.load();
    const game = new HE.Game({ save, saveSystem, debug: dev });
    const canvas = document.getElementById('stage');
    const renderer = new HE.Renderer(canvas);
    const input = new HE.Input(canvas, () => game.save.bindings);
    const audio = new HE.Audio();
    audio.setLevels(save.settings);
    game.fx.density = save.settings.effectDensity;
    const ui = new HE.UI(game, { renderer, input, audio, dev });
    const app = { game, renderer, input, audio, ui, saveSystem, dev };
    HE.app = app;

    if (HE.catalogErrors.length) ui.toast('Content errors: ' + HE.catalogErrors.length + ' (see console)', 'loss');
    if (!storage) ui.toast('Browser storage is unavailable: progress will not be saved.', 'loss');
    if (saveSystem.lastSource === 'backup' || saveSystem.lastSource === 'staged') ui.toast('Main save was damaged; restored from ' + saveSystem.lastSource + '.', 'info');

    // Offline production.
    const rep = game.tickFacilities().slot_alley;
    game.persist();
    if (rep && rep.gain >= 1 && rep.elapsed > 60) ui.openOverlay('offline', rep);
    else if (rep && rep.rolledBack) ui.toast('Your clock moved backwards; Slot Alley paid nothing for that gap.', 'info');

    game.on('sfx', (e) => {
      const pan = e.x != null ? (e.x / HE.data.TUNING.arena.w) * 2 - 1 : 0;
      audio.play(e.name, pan * 0.6);
    });
    game.on('music', (e) => audio.setMusic(e.mode));
    game.on('toast', (e) => ui.toast(e.text, e.kind));
    game.on('rumble', (e) => {
      if (!game.settings.vibration || !navigator.getGamepads) return;
      for (const p of navigator.getGamepads()) {
        if (p && p.vibrationActuator && p.vibrationActuator.playEffect) {
          p.vibrationActuator.playEffect('dual-rumble', { duration: e.ms, strongMagnitude: e.strong, weakMagnitude: e.weak }).catch(() => {});
        }
      }
    });
    audio.setMusic('hub');

    const unlock = () => audio.unlock();
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    const placeToasts = () => {
      const pt = renderer.arenaToScreen(14, 14);
      const el = document.getElementById('toasts');
      el.style.left = Math.round(pt.x) + 'px';
      el.style.top = Math.round(pt.y) + 'px';
    };
    placeToasts();
    window.addEventListener('resize', () => {
      renderer.resize();
      placeToasts();
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) pauseIfPlaying();
    });

    function inArena() {
      return game.run && HE.Game.SIM_STATES[game.run.state];
    }

    function pauseIfPlaying() {
      if (inArena() && !game.paused && game.run.state !== 'dying') {
        game.paused = true;
        ui.key = '';
      }
    }

    // Frame timing (for the dev panel).
    // `times` = CPU work per frame (sim + render); `gaps` = time between frames.
    const times = new Float32Array(600);
    const gaps = new Float32Array(600);
    let tIdx = 0;
    let tCount = 0;
    const summary = (src) => {
      const arr = Array.from(src.slice(0, tCount)).sort((a, b) => a - b);
      if (!arr.length) return null;
      const q = (p) => +arr[Math.min(arr.length - 1, Math.floor(p * arr.length))].toFixed(2);
      return { p50: q(0.5), p95: q(0.95), p99: q(0.99), worst: +arr[arr.length - 1].toFixed(2), n: arr.length };
    };
    ui.frameStats = () => {
      const w = summary(times);
      const g = summary(gaps);
      if (!w) return 'no samples';
      return 'work ms   p50 ' + w.p50 + '  p95 ' + w.p95 + '  p99 ' + w.p99 + '  worst ' + w.worst + '\nframe gap p50 ' + g.p50 + '  p95 ' + g.p95 + '  p99 ' + g.p99 + '  worst ' + g.worst + '  (' + w.n + ' frames)';
    };
    app.frameSummary = () => ({ work: summary(times), gap: summary(gaps) });
    app.resetFrameStats = () => {
      tIdx = 0;
      tCount = 0;
    };

    let last = performance.now();
    let acc = 0;
    let facT = 0;
    const STEP = 1 / 60;

    function handleEdges() {
      const run = game.run;
      if (input.take('blur')) pauseIfPlaying();
      if (input.take('debug') && dev) {
        if (ui.overlay === 'debug') ui.closeOverlay();
        else ui.openOverlay('debug');
      }
      if (input.take('pause')) {
        if (ui.overlay) ui.closeOverlay();
        else if (inArena() && run.state !== 'dying') {
          game.paused = !game.paused;
          ui.key = '';
        }
      }
      if (input.take('ledger')) {
        if (ui.overlay === 'ledger') ui.closeOverlay();
        else if (!ui.overlay) ui.openOverlay('ledger', { back: game.paused ? 'pause' : null });
      }
      const blocking = ui.blocking();
      if (!blocking && inArena() && !game.paused) {
        if (input.take('dash')) game.input.dashPressed = true;
        if (input.take('spin')) game.input.spinPressed = true;
        if (input.down.has('KeyK') && game.tutorial) game.skipTutorial();
      } else {
        input.take('dash');
        input.take('spin');
        for (let n = 0; n < 3; n++) if (input.down.has('Digit' + (n + 1)) && !input['_d' + n]) ui.key1to3(n);
      }
      for (let n = 0; n < 3; n++) input['_d' + n] = input.down.has('Digit' + (n + 1));
      if (input.take('interact') && blocking) {
        const f = document.activeElement && document.activeElement.closest ? document.activeElement.closest('#ui button') : null;
        const target = f || document.querySelector('#ui [data-autofocus]');
        if (target && !target.disabled) target.click();
      }
    }

    function frame(now) {
      const rawGap = now - last;
      const dt = Math.min(0.1, rawGap / 1000);
      last = now;
      handleEdges();
      if (inArena() && !game.paused && !ui.blocking()) {
        input.apply(game, renderer);
        if (game.stress) game.debugStressTick();
        acc += dt;
        let steps = 0;
        while (acc >= STEP && steps < 4) {
          game.update(STEP);
          acc -= STEP;
          steps++;
        }
        if (steps === 4) acc = 0;
      } else {
        acc = 0;
        game.update(dt);
      }
      facT += dt;
      if (facT >= 1) {
        facT = 0;
        game.tickFacilities();
        if (!game.run && Math.floor(now / 1000) % 30 === 0) game.persist();
      }
      renderer.draw(game, dt);
      ui.frame();
      times[tIdx] = performance.now() - now;
      gaps[tIdx] = rawGap;
      tIdx = (tIdx + 1) % times.length;
      tCount = Math.min(times.length, tCount + 1);
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
    document.body.classList.add('ready');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(typeof window !== 'undefined' ? window : globalThis);
