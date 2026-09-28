/*
 * End-to-end check in headless Chromium through the real page and UI.
 * Run: npm run test:e2e   (needs Playwright; see README)
 * Screenshots land in tests/output/ (ignored by git).
 */
'use strict';
const path = require('path');
const fs = require('fs');

function loadPlaywright() {
  const candidates = ['playwright', '/opt/node22/lib/node_modules/playwright', '@playwright/test'];
  for (const c of candidates) {
    try {
      return require(c);
    } catch (e) {
      /* try next */
    }
  }
  console.error('Playwright is not installed. Run: npm i -D playwright && npx playwright install chromium');
  process.exit(2);
}

const { chromium } = loadPlaywright();
const ROOT = path.join(__dirname, '..');
const URL = 'file://' + path.join(ROOT, 'index.html');
const OUT = path.join(__dirname, 'output');
fs.mkdirSync(OUT, { recursive: true });

let failures = 0;
function check(cond, label) {
  console.log((cond ? '  ok   ' : '  FAIL ') + label);
  if (!cond) failures++;
}

async function launch() {
  const opts = {};
  if (process.env.PLAYWRIGHT_CHROMIUM_PATH) opts.executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH;
  return chromium.launch(opts);
}

async function targetPoint(page) {
  return page.evaluate(() => {
    const g = ZTA.app.game;
    const t = g.targets.list.find((x) => x.state === 'active' && x.delay <= 0 && x.appear > 0.8);
    if (!t) return null;
    const c = ZTA.TargetArt.center(t, g.camera, {});
    return { x: c.sx, y: c.sy };
  });
}

(async () => {
  const browser = await launch();
  const context = await browser.newContext({ viewport: { width: 1600, height: 900 }, ignoreHTTPSErrors: true });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text());
  });

  console.log('Boot');
  await page.goto(URL);
  await page.waitForFunction(() => window.ZTA && ZTA.app);
  check(await page.isVisible('#title'), 'title screen visible on first launch');
  check(await page.isHidden('#hud'), 'HUD hidden until the run starts');
  await page.click('#btn-start');
  await page.waitForTimeout(700);
  check(await page.evaluate(() => ZTA.app.game.live), 'game is live after Start');

  console.log('Shooting');
  let tg = null;
  for (let i = 0; i < 20 && !tg; i++) {
    tg = await targetPoint(page);
    if (!tg) await page.waitForTimeout(100);
  }
  await page.mouse.move(tg.x, tg.y);
  const before = await page.evaluate(() => ZTA.app.game.save.stats.shots);
  await page.mouse.down();
  const after = await page.evaluate(() => ZTA.app.game.save.stats.shots);
  await page.mouse.up();
  check(after === before + 1, 'first shot fires in the input handler (no frame delay)');
  for (let i = 0; i < 30; i++) {
    const p = await targetPoint(page);
    if (!p) {
      await page.waitForTimeout(120);
      continue;
    }
    await page.mouse.move(p.x, p.y);
    await page.mouse.down();
    await page.waitForTimeout(180);
    await page.mouse.up();
  }
  const earned = await page.evaluate(() => ZTA.app.game.save.cash);
  check(earned > 0, 'breaking targets earned cash ($' + earned + ')');
  await page.screenshot({ path: path.join(OUT, 'play-1600x900.png') });

  console.log('Pause');
  await page.keyboard.press('Escape');
  check(await page.isVisible('#pause'), 'Escape opens the pause menu');
  const shotsPaused = await page.evaluate(() => ZTA.app.game.save.stats.shots);
  await page.mouse.move(120, 820); // on the dimmed backdrop, clear of the pause panel
  await page.mouse.down();
  await page.waitForTimeout(400);
  await page.mouse.up();
  check((await page.evaluate(() => ZTA.app.game.save.stats.shots)) === shotsPaused, 'no shots fire while paused');
  await page.click('#pause [data-action="resume"]');
  await page.waitForTimeout(200);
  check(await page.evaluate(() => ZTA.app.game.live), 'Resume returns to live play');

  console.log('Armory purchases');
  await page.evaluate(() => {
    const e = ZTA.app.game.economy;
    const s = ZTA.app.game.save;
    e.trySpend(s.cash); // start from exactly $0
  });
  await page.keyboard.press('Tab');
  await page.waitForTimeout(250);
  check(await page.isVisible('#armory'), 'Tab opens the armory');
  await page.click('.wall-item[data-id="gun.kestrel_p9"]');
  // Unaffordable buttons are aria-disabled but still clickable (they answer with a denial).
  await page.click('.upg[data-row="upg.damage"] .buy', { force: true });
  let s = await page.evaluate(() => ({ cash: ZTA.app.game.save.cash, lv: (ZTA.app.game.save.weaponLevels['gun.kestrel_p9'] || {})['upg.damage'] || 0 }));
  check(s.cash === 0 && s.lv === 0, 'unaffordable purchase does nothing and cash stays at $0');
  await page.evaluate(() => ZTA.app.game.economy.earn(3000, 'test'));
  const cost = await page.evaluate(() => ZTA.content.describeWeaponUpgrade(ZTA.data.weaponById['gun.kestrel_p9'], {}, 'upg.damage').cost);
  await page.click('.upg[data-row="upg.damage"] .buy');
  s = await page.evaluate(() => ({ cash: ZTA.app.game.save.cash, lv: ZTA.app.game.save.weaponLevels['gun.kestrel_p9']['upg.damage'] }));
  check(s.lv === 1 && s.cash === 3000 - cost, 'upgrade bought once for its exact cost ($' + cost + ')');
  check((await page.textContent('.upg[data-row="upg.damage"] .eff')).includes('12.5 dmg'), 'upgrade row shows the new value');
  await page.click('.wall-item[data-id="gun.hornet_k"]');
  await page.click('[data-action="unlock"]');
  await page.waitForTimeout(300);
  check(await page.isVisible('#reveal'), 'unlock shows the reveal');
  await page.screenshot({ path: path.join(OUT, 'reveal.png') });
  await page.click('#reveal [data-action="test"]');
  await page.waitForTimeout(400);
  s = await page.evaluate(() => ({ active: ZTA.app.game.weapons.activeId, live: ZTA.app.game.live, eq: ZTA.app.game.save.equipped }));
  check(s.active === 'gun.hornet_k' && s.live, 'Test gun equips the new gun and returns to the range');
  await page.keyboard.press('1');
  await page.waitForTimeout(100);
  check((await page.evaluate(() => ZTA.app.game.weapons.activeId)) === 'gun.kestrel_p9', 'number keys switch guns');
  await page.evaluate(() => ZTA.app.game.progression.buyRangeUpgrade('rng.bounty'));

  console.log('Persistence');
  const snapshot = await page.evaluate(() => {
    const s = ZTA.app.game.save;
    return JSON.stringify({ cash: s.cash, owned: s.owned, equipped: s.equipped, activeSlot: s.activeSlot, wl: s.weaponLevels, rl: s.rangeLevels });
  });
  await page.reload();
  await page.waitForFunction(() => window.ZTA && ZTA.app);
  const restored = await page.evaluate(() => {
    const s = ZTA.app.game.save;
    return JSON.stringify({ cash: s.cash, owned: s.owned, equipped: s.equipped, activeSlot: s.activeSlot, wl: s.weaponLevels, rl: s.rangeLevels });
  });
  check(snapshot === restored, 'reload preserves cash, ownership, loadout and upgrades');
  check((await page.textContent('#btn-start')).trim() === 'Continue', 'title offers Continue for an existing save');

  console.log('Extended play (fast-forwarded)');
  await page.click('#btn-start');
  await page.waitForTimeout(300);
  const long = await page.evaluate(() => {
    const app = ZTA.app;
    const g = app.game;
    g.economy.earn(5000, 'test');
    g.progression.unlockWeapon('gun.brute_12');
    let maxP = 0;
    let maxT = 0;
    let maxDecals = 0;
    const dt = 1 / 60;
    for (let i = 0; i < 60 * 60 * 6; i++) {
      const t = g.targets.list.find((x) => x.state === 'active' && x.delay <= 0 && x.appear > 0.6);
      if (t) {
        const c = ZTA.TargetArt.center(t, g.camera, {});
        g.setAim(c.sx, c.sy);
        if (!g.weapons.trigger) g.weapons.pressTrigger();
      } else if (g.weapons.trigger) g.weapons.releaseTrigger();
      if (i % 2400 === 0) g.weapons.cycle(1);
      g.update(dt);
      app.viewmodel.update(dt);
      app.fx.update(dt);
      if (i % 6 === 0) app.renderer.render(dt);
      const c = app.fx.counts();
      maxP = Math.max(maxP, c.particles);
      maxDecals = Math.max(maxDecals, c.decals);
      maxT = Math.max(maxT, g.targets.list.length);
    }
    g.weapons.releaseTrigger();
    return { maxP, maxT, maxDecals, limits: app.fx.counts().limits, waves: g.save.stats.wavesCleared, cash: g.save.cash, breaks: g.save.stats.breaks, rewards: g.rewardsGranted };
  });
  check(long.maxP <= long.limits.particles, 'particles bounded (' + long.maxP + ' / ' + long.limits.particles + ')');
  check(long.maxDecals <= long.limits.decals, 'decals bounded (' + long.maxDecals + ' / ' + long.limits.decals + ')');
  check(long.maxT <= 20, 'targets bounded (' + long.maxT + ')');
  check(long.waves > 50, 'many waves played (' + long.waves + ')');
  check(long.cash >= 0, 'cash never negative');

  console.log('Ranges and challenges');
  await page.keyboard.press('m');
  await page.waitForTimeout(250);
  check(await page.isVisible('#map'), 'M opens the ranges screen');
  check((await page.$$('.route-card')).length === 5, 'five ranges on the route');
  check((await page.$$('#map .ch-card')).length === 5, 'Bench Lane shows its five challenges');
  await page.click('#map [data-action="start"][data-id="ch.bench.qualifier"]');
  await page.waitForTimeout(300);
  let run = await page.evaluate(() => ({ live: ZTA.app.game.live, state: ZTA.app.game.run && ZTA.app.game.run.state, panel: !document.getElementById('hud-challenge').hidden }));
  check(run.live && run.state === 'countdown' && run.panel, 'challenge starts with a countdown and the round panel');
  const shotsCd = await page.evaluate(() => ZTA.app.game.save.stats.shots);
  await page.mouse.move(800, 380);
  await page.mouse.down();
  await page.waitForTimeout(250);
  await page.mouse.up();
  check((await page.evaluate(() => ZTA.app.game.save.stats.shots)) === shotsCd, 'no firing during the countdown');
  const round = await page.evaluate(() => {
    const app = ZTA.app;
    const g = app.game;
    const dt = 1 / 60;
    const bp0 = g.save.blueprints;
    for (let i = 0; i < 60 * 70 && g.run && g.run.state !== 'done'; i++) {
      const t = g.targets.list.find((x) => x.hittable && x.appear > 0.6);
      if (t) {
        const c = ZTA.TargetArt.center(t, g.camera, {});
        g.setAim(c.sx, c.sy);
        if (!g.weapons.trigger) g.weapons.pressTrigger();
      } else if (g.weapons.trigger) g.weapons.releaseTrigger();
      g.update(dt);
      app.viewmodel.update(dt);
      app.fx.update(dt);
    }
    g.weapons.releaseTrigger();
    const rec = g.save.challenges['ch.bench.qualifier'];
    return { state: g.run && g.run.state, stars: rec ? rec.stars : 0, best: rec ? rec.best : null, bp: g.save.blueprints - bp0 };
  });
  check(round.state === 'done' && round.best > 0, 'round runs to the end and records a best (' + round.best + ' breaks, ' + round.stars + ' stars)');
  check(round.bp >= round.stars, 'each new star paid Blueprint Tokens (+' + round.bp + ')');
  await page.waitForTimeout(1000);
  check(await page.isVisible('#results'), 'results screen appears');
  await page.screenshot({ path: path.join(OUT, 'results.png') });
  await page.click('#results [data-action="practice"]');
  await page.waitForTimeout(250);
  run = await page.evaluate(() => ({ run: !!ZTA.app.game.run, mode: ZTA.app.game.mode, live: ZTA.app.game.live }));
  check(!run.run && run.mode === 'practice' && run.live, 'Back to practice leaves the round');

  console.log('Range unlock and travel');
  await page.evaluate(() => {
    const g = ZTA.app.game;
    g.save.challenges['ch.bench.qualifier'] = Object.assign({ best: 30, clears: 1, modStars: {} }, g.save.challenges['ch.bench.qualifier'], { stars: Math.max(1, (g.save.challenges['ch.bench.qualifier'] || {}).stars || 0) });
    g.economy.earn(20000, 'test');
  });
  await page.keyboard.press('m');
  await page.waitForTimeout(200);
  await page.click('.route-card[data-id="range.rooftop"]');
  await page.click('#map [data-action="unlock-range"]');
  await page.waitForTimeout(150);
  check(await page.evaluate(() => ZTA.app.game.progression.isRangeUnlocked('range.rooftop')), 'Rooftop 9 opened from the ranges screen');
  await page.click('#map [data-action="travel"]');
  await page.waitForTimeout(700);
  check(await page.evaluate(() => ZTA.app.game.range.id === 'range.rooftop' && ZTA.app.renderer.bg.key.startsWith('range.rooftop')), 'travel switches range and repaints the map');
  await page.screenshot({ path: path.join(OUT, 'rooftop.png') });

  console.log('Boss fight (fast-forwarded)');
  const boss = await page.evaluate(() => {
    const app = ZTA.app;
    const g = app.game;
    for (const id of ['ch.roof.qualifier', 'ch.roof.drones']) g.save.challenges[id] = { stars: 1, best: 10, clears: 1, modStars: {} };
    g.economy.earn(1e7, 'test');
    g.progression.unlockWeapon('gun.brennan_357');
    g.progression.equip(0, 'gun.brennan_357');
    for (let i = 0; i < 12; i++) g.progression.buyWeaponUpgrade('gun.brennan_357', 'upg.damage');
    const r = g.startChallenge('ch.roof.boss');
    app.menus.closeAll();
    let defeated = false;
    g.events.on('boss:defeated', () => (defeated = true));
    const dt = 1 / 60;
    let sawBoss = false;
    for (let i = 0; i < 60 * 95 && g.run && g.run.state !== 'done'; i++) {
      const b = g.targets.boss;
      if (b) sawBoss = true;
      const parts = b ? b.parts.filter((t) => t.hittable) : [];
      const t = parts.find((x) => !x.part.final && x.def.id !== 'tgt.boss.sensor') || parts.find((x) => x.part.final) || parts[0] || g.targets.list.find((x) => x.hittable);
      if (t) {
        const c = ZTA.TargetArt.center(t, g.camera, {});
        g.setAim(c.sx, c.sy);
        if (!g.weapons.trigger) g.weapons.pressTrigger();
      } else if (g.weapons.trigger) g.weapons.releaseTrigger();
      g.update(dt);
      app.viewmodel.update(dt);
      app.fx.update(dt);
      if (i % 10 === 0) app.renderer.render(dt);
    }
    g.weapons.releaseTrigger();
    return { ok: r.ok, sawBoss, defeated, stars: g.progression.challengeStars('ch.roof.boss') };
  });
  check(boss.ok && boss.sawBoss, 'boss challenge spawns the Skylight Sentry');
  check(boss.defeated && boss.stars > 0, 'boss can be beaten (' + boss.stars + ' stars)');
  await page.waitForTimeout(2000);
  await page.click('#results [data-action="practice"]');
  await page.waitForTimeout(200);

  console.log('Workshop and lanes');
  await page.evaluate(() => ZTA.app.game.economy.earnBlueprints(3, 'test'));
  await page.keyboard.press('Tab');
  await page.waitForTimeout(150);
  await page.click('.tab[data-tab="workshop"]');
  const tk0 = await page.evaluate(() => ZTA.app.game.save.blueprints);
  await page.click('.upg[data-row="ws.cash"] .buy');
  const ws = await page.evaluate(() => ({ lv: ZTA.app.game.save.workshop['ws.cash'], tk: ZTA.app.game.save.blueprints }));
  check(ws.lv === 1 && ws.tk === tk0 - 1, 'Workshop node bought with a Blueprint Token');
  await page.click('.tab[data-tab="lanes"]');
  await page.click('[data-action="lane-unlock"]');
  await page.selectOption('select[data-lane="0"]', 'gun.brennan_357');
  const lanes = await page.evaluate(() => {
    const p = ZTA.app.game.progression;
    const L = ZTA.app.game.save.lanes;
    const now = Date.now();
    L.lastTick = now - 3600 * 1000;
    const a = p.tickLanes(now);
    const back = p.tickLanes(now - 5000); // clock moved backwards: pays nothing
    L.lastTick = now - 400 * 86400 * 1000;
    const huge = p.tickLanes(now);
    return { rate: p.laneRate(), gained: a.gained, back: back.gained, stored: L.stored, cap: p.laneCap(), tk: ZTA.app.game.save.blueprints };
  });
  check(lanes.rate > 0 && lanes.gained > 0, 'a lane earns while away (' + Math.round(lanes.gained) + ')');
  check(lanes.back === 0 && lanes.stored <= lanes.cap + 1e-6, 'lanes are clock-safe and capped');
  await page.click('[data-action="collect"]');
  check((await page.evaluate(() => ZTA.app.game.save.lanes.stored)) < 1, 'collect empties the lane store into cash');
  await page.screenshot({ path: path.join(OUT, 'lanes.png') });
  await page.keyboard.press('Tab');

  console.log('Offline popup');
  await page.evaluate(() => {
    ZTA.app.game.save.lanes.lastTick = Date.now() - 2 * 3600 * 1000;
    ZTA.app.requestSave('test');
  });
  await page.reload();
  await page.waitForFunction(() => window.ZTA && ZTA.app);
  await page.click('#btn-start');
  await page.waitForTimeout(300);
  check(await page.isVisible('#offline'), 'offline earnings are shown after time away');
  await page.screenshot({ path: path.join(OUT, 'offline.png') });
  await page.click('#offline [data-action="collect"]');
  await page.waitForTimeout(150);

  console.log('Prestige');
  const pre = await page.evaluate(() => {
    const g = ZTA.app.game;
    g.save.challenges['ch.scrap.boss'] = { stars: 1, best: 80, clears: 1, modStars: {} };
    return { owned: g.save.owned.length, tk: g.save.blueprints, stars: g.progression.totalStars() };
  });
  await page.keyboard.press('Escape');
  await page.click('#pause [data-action="branch"]');
  await page.waitForTimeout(200);
  check(await page.isVisible('#branch'), 'pause menu offers Open a new branch once unlocked');
  await page.click('#branch .charter');
  await page.click('#branch [data-action="confirm"]');
  await page.waitForTimeout(300);
  const post = await page.evaluate(() => {
    const g = ZTA.app.game;
    return { branch: g.save.prestige.branch, owned: g.save.owned.length, tk: g.save.blueprints, stars: g.progression.totalStars(), range: g.range.id, rooftop: g.progression.isRangeUnlocked('range.rooftop') || g.save.prestige.charters.indexOf('cht.headstart') !== -1 ? 'ok' : 'locked', live: g.live };
  });
  check(post.branch === 1 && post.owned === pre.owned && post.tk === pre.tk && post.stars === pre.stars, 'new branch keeps guns, tokens and stars');
  check(post.range === 'range.bench01' && post.live, 'new branch starts back at Bench Lane');

  console.log('Layout at common resolutions');
  for (const [w, h] of [
    [1280, 720],
    [1366, 768],
    [1920, 1080],
    [2560, 1440],
  ]) {
    await page.setViewportSize({ width: w, height: h });
    await page.waitForTimeout(250);
    const overlap = await page.evaluate(() => {
      const ids = ['hud-cash', 'hud-goal', 'hud-wave', 'btn-map', 'btn-armory', 'hud-slots', 'hud-combo', 'ammo-cur', 'hud-wname'];
      const rects = ids.map((id) => [id, document.getElementById(id).getBoundingClientRect()]);
      const hits = [];
      for (let i = 0; i < rects.length; i++)
        for (let j = i + 1; j < rects.length; j++) {
          const a = rects[i][1];
          const b = rects[j][1];
          if (a.width && b.width && a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom) hits.push(rects[i][0] + '/' + rects[j][0]);
        }
      const off = rects.filter(([, r]) => r.width && (r.left < 0 || r.top < 0 || r.right > innerWidth || r.bottom > innerHeight)).map(([id]) => id);
      return { hits, off };
    });
    check(overlap.hits.length === 0 && overlap.off.length === 0, w + '×' + h + ' HUD fits without overlaps ' + JSON.stringify(overlap));
    await page.screenshot({ path: path.join(OUT, 'hud-' + w + 'x' + h + '.png') });
    await page.keyboard.press('Tab');
    await page.waitForTimeout(200);
    const scroll = await page.evaluate(() => document.getElementById('armory-body').scrollWidth <= document.getElementById('armory-body').clientWidth + 1);
    check(scroll, w + '×' + h + ' armory has no horizontal overflow');
    await page.screenshot({ path: path.join(OUT, 'armory-' + w + 'x' + h + '.png') });
    await page.keyboard.press('Tab');
    await page.waitForTimeout(150);
  }

  check(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
  await browser.close();
  console.log(failures ? '\n' + failures + ' check(s) failed' : '\nAll end-to-end checks passed');
  process.exit(failures ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
