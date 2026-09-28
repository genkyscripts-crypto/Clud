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
  await page.mouse.move(800, 450);
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
      const ids = ['hud-cash', 'hud-goal', 'hud-wave', 'btn-armory', 'hud-slots', 'hud-combo', 'ammo-cur', 'hud-wname'];
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
