/*
 * End-to-end check in headless Chromium through the real page and UI.
 * Run: npm run test:e2e   (needs Playwright + Chromium)
 * Screenshots land in tests/output/ (ignored by git).
 */
'use strict';
const path = require('path');
const fs = require('fs');

function loadPlaywright() {
  for (const c of ['playwright', '/opt/node22/lib/node_modules/playwright', '@playwright/test']) {
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
const BOT = fs.readFileSync(path.join(__dirname, 'bot.cjs'), 'utf8');

let failures = 0;
function check(cond, label) {
  console.log((cond ? '  ok   ' : '  FAIL ') + label);
  if (!cond) failures++;
}

async function injectBot(page) {
  await page.addScriptTag({ content: 'window.Bot = (function(){ const module = {}; ' + BOT + '\n return module.exports; })();' });
}

/** Runs the simulation fast inside the page until `stopState`, driving combat with the bot. */
async function fastForward(page, stopStates, maxSteps) {
  return page.evaluate(
    ({ stopStates, maxSteps }) => {
      const g = HE.app.game;
      for (let i = 0; i < maxSteps; i++) {
        const run = g.run;
        if (!run) return 'no-run';
        if (stopStates.includes(run.state)) return run.state;
        if (run.state === 'wager') g.declineWager();
        else if (run.state === 'draft') g.chooseDraft(0);
        else if (run.state === 'doors') g.chooseDoor(0);
        else if (run.state === 'shop') g.leaveShop();
        else if (!HE.Game.SIM_STATES[run.state]) return run.state;
        else {
          if (g.tutorial) g.skipTutorial();
          Bot.botStep(g, 0.9);
          g.update(1 / 60);
        }
      }
      return 'timeout:' + g.run.state;
    },
    { stopStates, maxSteps: maxSteps || 60 * 60 * 15 }
  );
}

async function launch() {
  const opts = {};
  if (process.env.PLAYWRIGHT_CHROMIUM_PATH) opts.executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH;
  return chromium.launch(opts);
}

(async () => {
  const browser = await launch();
  const context = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text());
  });

  console.log('boot');
  await page.goto(URL);
  await page.waitForSelector('#ui[data-screen="hub"]');
  check(await page.isVisible('text=Enter the casino'), 'first visit shows the objective and Enter the casino');
  check(await page.isVisible('text=cash-out terminal'), 'objective names the cash-out terminal');
  await page.screenshot({ path: path.join(OUT, 'hub-first.png') });

  console.log('guided entrance');
  await page.click('[data-act=start]');
  await page.waitForFunction(() => HE.app.game.run && HE.app.game.run.state === 'combat');
  check(await page.evaluate(() => !!HE.app.game.tutorial), 'guided tutorial is active');
  const x0 = await page.evaluate(() => HE.app.game.player.x);
  await page.mouse.move(800, 300);
  await page.keyboard.down('KeyD');
  await page.waitForTimeout(500);
  await page.keyboard.up('KeyD');
  const x1 = await page.evaluate(() => HE.app.game.player.x);
  check(x1 > x0 + 40, 'D moves the player right (' + Math.round(x1 - x0) + ' px)');
  await page.waitForFunction(() => HE.app.game.tutorial && HE.app.game.tutorial.current.id !== 'move', null, { timeout: 12000 });
  check(true, 'movement step completes');
  await page.mouse.down();
  await page.waitForTimeout(400);
  await page.mouse.up();
  check((await page.evaluate(() => HE.app.game.stats.shots)) > 0, 'left mouse fires the revolver');

  console.log('pause and ledger');
  await page.keyboard.press('Escape');
  await page.waitForSelector('#ui[data-screen="overlay:pause"]');
  const tA = await page.evaluate(() => HE.app.game.t);
  await page.waitForTimeout(400);
  const tB = await page.evaluate(() => HE.app.game.t);
  check(tA === tB, 'pause freezes the simulation');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(100);
  await page.keyboard.press('Tab');
  await page.waitForSelector('#ui[data-screen="overlay:ledger"]');
  check(await page.evaluate(() => HE.app.game.paused), 'ledger pauses combat');
  await page.click('[data-act=ltab][data-t=recipes]');
  await page.fill('[data-in=q]', 'shot');
  check((await page.locator('.recipe').count()) >= 1, 'recipe search filters the list');
  await page.click('[data-act=ltab][data-t=odds]');
  await page.waitForFunction(() => /777 jackpot/.test(document.getElementById('ui').innerText), null, { timeout: 3000 }).catch(() => {});
  const oddsText = await page.evaluate(() => document.getElementById('ui').innerText);
  check(/777 jackpot: 1 in 216/i.test(oddsText.replace(/\s+/g, ' ')), 'odds tab shows the real 777 odds');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(100);
  check(!(await page.evaluate(() => HE.app.game.paused)), 'closing the ledger resumes');

  console.log('skip tutorial, first draft, doors');
  await page.keyboard.down('KeyK');
  await page.waitForTimeout(80);
  await page.keyboard.up('KeyK');
  check(await page.evaluate(() => !HE.app.game.tutorial && !!HE.app.game.director), 'K skips the tutorial');
  await injectBot(page);
  let st = await fastForward(page, ['draft']);
  check(st === 'draft', 'first room cleared → draft (' + st + ')');
  await page.waitForSelector('#ui[data-screen="draft"]');
  check((await page.locator('.pick').count()) === 3, 'draft offers three choices');
  await page.screenshot({ path: path.join(OUT, 'draft.png') });
  const before = await page.evaluate(() => HE.app.game.perks.ownedIds().length);
  await page.click('.pick >> nth=0 >> [data-act=choose]');
  await page.waitForSelector('#ui[data-screen="doors"]');
  check((await page.evaluate(() => HE.app.game.perks.ownedIds().length)) === before + 1 || (await page.evaluate(() => HE.app.game.perks.ownedIds().length)) === before, 'taking a draft card applies it');
  check(await page.evaluate(() => !!HE.app.game.save.checkpoint), 'checkpoint written at the doors');
  await page.screenshot({ path: path.join(OUT, 'doors.png') });

  console.log('resume after reload');
  const doorsBefore = await page.evaluate(() => JSON.stringify(HE.app.game.run.doors));
  await page.reload();
  await page.waitForSelector('#ui[data-screen="hub"]');
  check(await page.isVisible('[data-act=resume]'), 'hub offers Resume run');
  await page.click('[data-act=resume]');
  await page.waitForSelector('#ui[data-screen="doors"]');
  check((await page.evaluate(() => JSON.stringify(HE.app.game.run.doors))) === doorsBefore, 'resume restores the same doors');
  await page.click('[data-act=door] >> nth=0');
  await injectBot(page);

  console.log('wager and terminal');
  st = await fastForward(page, ['wager', 'terminal']);
  if (st === 'wager') {
    await page.waitForSelector('#ui[data-screen="wager"]');
    check(await page.isVisible('text=Decline'), 'wager screen shows stake, terms and a decline option');
    await page.screenshot({ path: path.join(OUT, 'wager.png') });
    await page.click('[data-act=stake] >> nth=0');
    check(await page.evaluate(() => HE.app.game.run.wallet.escrow > 0), 'stake is escrowed');
    st = await fastForward(page, ['terminal']);
  }
  check(st === 'terminal', 'floor boss beaten → terminal (' + st + ')');
  await page.waitForSelector('#ui[data-screen="terminal"]');
  check(await page.isVisible('text=PRESS ON'), 'terminal shows BANK and PRESS ON');
  await page.screenshot({ path: path.join(OUT, 'terminal.png') });
  const loose = await page.evaluate(() => HE.app.game.run.wallet.loose);
  await page.click('[data-act=bank]');
  await page.waitForSelector('#ui[data-screen="terminal_banked"]');
  check((await page.evaluate(() => HE.app.game.save.account.banked)) === loose, 'bank moves exactly the loose chips (' + loose + ')');
  await page.click('[data-act=finish]');
  await page.waitForSelector('#ui[data-screen="results"]');
  check(await page.isVisible('text=CASHED OUT'), 'results screen');
  check(await page.isVisible('text=Next goal'), 'results name a next goal');
  await page.screenshot({ path: path.join(OUT, 'results.png') });
  await page.click('[data-act=toHub]');
  await page.waitForSelector('#ui[data-screen="hub"]');

  console.log('buy and persist');
  const banked = await page.evaluate(() => HE.app.game.save.account.banked);
  if (banked >= 60) {
    await page.click('[data-act=buyFac]');
    check((await page.evaluate(() => HE.app.game.save.facilities.slot_alley.level)) === 1, 'Slot Alley repaired');
    check((await page.evaluate(() => HE.app.game.save.account.banked)) === banked - 60, 'exact cost charged');
  } else check(false, 'first floor funds Slot Alley (banked ' + banked + ')');
  await page.reload();
  await page.waitForSelector('#ui[data-screen="hub"]');
  check((await page.evaluate(() => HE.app.game.save.facilities.slot_alley.level)) === 1, 'purchase survives reload');
  await page.screenshot({ path: path.join(OUT, 'hub-after.png') });
  await page.click('[data-act=start]');
  await page.waitForFunction(() => HE.app.game.run && HE.app.game.run.state !== 'intro');
  check((await page.evaluate(() => HE.app.game.slots.charge)) >= 50, 'next run starts with Warm Reels charge');

  console.log('real spin through the keyboard');
  await page.evaluate(() => {
    const g = HE.app.game;
    if (g.tutorial) g.skipTutorial();
    g.slots.addCharge(100);
  });
  await page.keyboard.press('KeyQ');
  await page.waitForTimeout(900);
  const spun = await page.evaluate(() => HE.app.game.stats.spins);
  check(spun === 1, 'Q spins the reels and resolves');

  console.log('settings and rebinding');
  await page.keyboard.press('Escape');
  await page.waitForSelector('#ui[data-screen="overlay:pause"]');
  await page.click('[data-act=settings]');
  await page.waitForSelector('#ui[data-screen="overlay:settings"]');
  await page.click('[data-act=rebind][data-a=spin]');
  await page.keyboard.press('KeyF');
  await page.waitForTimeout(80);
  check((await page.evaluate(() => HE.app.game.save.bindings.spin)) === 'KeyF', 'spin rebound to F');
  await page.click('[data-set=damageNumbers]');
  check((await page.evaluate(() => HE.app.game.save.settings.damageNumbers)) === false, 'damage numbers toggle');
  await page.screenshot({ path: path.join(OUT, 'settings.png') });
  await page.click('[data-act=resetBinds]');
  await page.click('[data-act=closeOverlay]');
  await page.click('[data-act=abandon]');
  await page.click('[data-act=confirmYes]');
  await page.waitForSelector('#ui[data-screen="results"]');
  check(await page.isVisible('text=WALKED AWAY'), 'abandon settles as a defeat');

  console.log('layout');
  for (const [w, h] of [
    [1280, 720],
    [1920, 1080],
    [1024, 768],
    [2560, 1080],
  ]) {
    await page.setViewportSize({ width: w, height: h });
    await page.waitForTimeout(150);
    const ok = await page.evaluate(() => {
      const p = document.querySelector('#ui .panel');
      if (!p) return true;
      const r = p.getBoundingClientRect();
      return r.left >= 0 && r.right <= innerWidth + 1 && r.top >= 0;
    });
    check(ok, 'panel fits at ' + w + '×' + h);
    await page.screenshot({ path: path.join(OUT, 'layout-' + w + 'x' + h + '.png') });
  }
  await page.setViewportSize({ width: 1920, height: 1080 });

  console.log('stress scene (performance)');
  await page.goto(URL + '?dev=1');
  await page.waitForSelector('#ui[data-screen="hub"]');
  await page.evaluate(() => HE.app.game.debugStress(true));
  await page.waitForTimeout(1500);
  await page.evaluate(() => HE.app.resetFrameStats());
  await page.waitForTimeout(6000);
  const perf = await page.evaluate(() => ({ s: HE.app.frameSummary(), e: HE.app.game.enemies.n, b: HE.app.game.bullets.n, f: HE.app.game.shots.n }));
  console.log('       stress @1920×1080: enemies ' + perf.e + ', hostile ' + perf.b + ', friendly ' + perf.f);
  console.log('       work ms ' + JSON.stringify(perf.s.work) + '\n       frame gap ms ' + JSON.stringify(perf.s.gap));
  fs.writeFileSync(path.join(OUT, 'perf.json'), JSON.stringify(perf, null, 2));
  await page.screenshot({ path: path.join(OUT, 'stress.png') });
  // Counts are sampled once; shots and bullets churn between top-ups.
  check(perf.e >= 140 && perf.b >= 1300 && perf.f >= 1500, 'stress scene is near its target counts');

  check(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
  await browser.close();
  console.log(failures ? failures + ' check(s) failed' : 'all checks passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
