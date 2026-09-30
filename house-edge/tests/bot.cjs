/*
 * A simple autopilot used by tests and the pacing tool: dodges the nearest
 * threatening bullets, keeps distance from enemies, aims at the nearest enemy
 * and spins whenever it can. It is intentionally mediocre, not optimal.
 */
'use strict';

let botSeed = 12345;
function botRand() {
  botSeed = (botSeed * 1664525 + 1013904223) >>> 0;
  return botSeed / 4294967296;
}

/**
 * skill 0..1 scales bullet avoidance; `aimError` (radians) adds aim wobble so
 * weaker simulated players miss. Deterministic for a given seed.
 */
function botStep(g, skill, aimError) {
  skill = skill == null ? 0.7 : skill;
  aimError = aimError || 0;
  const p = g.player;
  const inp = g.input;
  const live = g.liveEnemies();
  let tx = 0;
  let ty = 0;
  // Bullet avoidance: push away from bullets heading toward us.
  const B = g.bullets;
  for (let i = 0; i < B.n; i++) {
    const b = B.items[i];
    const dx = p.x - b.x;
    const dy = p.y - b.y;
    const d2 = dx * dx + dy * dy;
    if (d2 > 140 * 140) continue;
    const approach = (b.vx * dx + b.vy * dy) > 0;
    if (!approach && d2 > 40 * 40) continue;
    const d = Math.sqrt(d2) || 1;
    // Sidestep perpendicular to the bullet's velocity.
    const vl = Math.hypot(b.vx, b.vy) || 1;
    let px = -b.vy / vl;
    let py = b.vx / vl;
    if (px * dx + py * dy < 0) {
      px = -px;
      py = -py;
    }
    const w = (140 - d) / 140;
    tx += (px * 1.4 + dx / d * 0.6) * w * skill * 3;
    ty += (py * 1.4 + dy / d * 0.6) * w * skill * 3;
  }
  let target = null;
  let best = Infinity;
  for (const e of live) {
    const d2 = (e.x - p.x) ** 2 + (e.y - p.y) ** 2;
    if (d2 < best) {
      best = d2;
      target = e;
    }
    const d = Math.sqrt(d2) || 1;
    if (d < 170) {
      tx -= ((e.x - p.x) / d) * (170 - d) / 170 * 1.5;
      ty -= ((e.y - p.y) / d) * (170 - d) / 170 * 1.5;
    }
  }
  // Close the distance on far targets.
  if (target && best > 520 * 520) {
    const d = Math.sqrt(best);
    tx += ((target.x - p.x) / d) * 1.2;
    ty += ((target.y - p.y) / d) * 1.2;
  }
  // No line of sight through a pillar: sidestep around it.
  if (target) {
    for (const pl of g.layout.pillars) {
      const abx = target.x - p.x;
      const aby = target.y - p.y;
      const len2 = abx * abx + aby * aby || 1;
      const t = Math.max(0, Math.min(1, ((pl.x - p.x) * abx + (pl.y - p.y) * aby) / len2));
      const cx = p.x + abx * t - pl.x;
      const cy = p.y + aby * t - pl.y;
      if (cx * cx + cy * cy < (pl.r + 8) * (pl.r + 8)) {
        const l = Math.sqrt(len2);
        let px = -aby / l;
        let py = abx / l;
        if (px * cx + py * cy < 0) {
          px = -px;
          py = -py;
        }
        tx += px * 2.2;
        ty += py * 2.2;
      }
    }
  }
  // Circle shield ushers instead of shooting into the rope.
  if (target && target.kind === 'usher') {
    const a = Math.atan2(p.y - target.y, p.x - target.x);
    const off = Math.abs(((a - target.facing + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
    if (off < 1.3) {
      tx += Math.cos(a + Math.PI / 2) * 1.2;
      ty += Math.sin(a + Math.PI / 2) * 1.2;
    }
  }
  // Drift toward the arena center when idle.
  tx += (g.A.w / 2 - p.x) / g.A.w * 0.8;
  ty += (g.A.h * 0.6 - p.y) / g.A.h * 0.8;
  const l = Math.hypot(tx, ty);
  inp.moveX = l > 0.15 ? tx / l : 0;
  inp.moveY = l > 0.15 ? ty / l : 0;
  if (target) {
    const tx0 = target.x + target.vx * 0.12;
    const ty0 = target.y + target.vy * 0.12;
    if (aimError) {
      if (g.frame % 12 === 0) botStep.wob = (botRand() - 0.5) * 2 * aimError;
      const a = Math.atan2(ty0 - p.y, tx0 - p.x) + (botStep.wob || 0);
      const d = Math.hypot(tx0 - p.x, ty0 - p.y);
      inp.aimX = p.x + Math.cos(a) * d;
      inp.aimY = p.y + Math.sin(a) * d;
    } else {
      inp.aimX = tx0;
      inp.aimY = ty0;
    }
    inp.fire = true;
  } else {
    inp.fire = false;
  }
  inp.precision = false;
  if (g.slots.canSpin() && live.length >= 2) inp.spinPressed = true;
  if (p.hp < p.maxHp * 0.5 && p.dashCharges > 0 && g.bullets.n > 20 && g.frame % 50 === 0) inp.dashPressed = true;
}

/** Plays a run to completion with fixed choices; returns the results. */
function playRun(g, opts) {
  opts = opts || {};
  const maxSteps = opts.maxSteps || 60 * 60 * 25;
  const pressOn = !!opts.pressOn;
  for (let i = 0; i < maxSteps; i++) {
    const run = g.run;
    if (!run) return null;
    const st = run.state;
    if (st === 'results') return run.results;
    if (st === 'wager') {
      if (opts.takeWager && run.wagerOffer) g.placeWager(run.wagerOffer.stakes[0]);
      else g.declineWager();
      continue;
    }
    if (st === 'draft') {
      g.chooseDraft(opts.draftPick ? opts.draftPick(run.draft) : 0);
      continue;
    }
    if (st === 'doors') {
      g.chooseDoor(0);
      continue;
    }
    if (st === 'shop') {
      g.leaveShop();
      continue;
    }
    if (st === 'terminal') {
      if (g.floor().final) g.terminalVault();
      else if (pressOn) g.terminalPress();
      else g.terminalBank();
      continue;
    }
    if (st === 'terminal_banked') {
      if (opts.finishAfterBank) g.terminalFinish();
      else g.terminalContinue();
      continue;
    }
    botStep(g, opts.skill, opts.aimError);
    if (opts.onFrame) opts.onFrame(g, i);
    g.update(1 / 60);
  }
  return g.run ? g.run.results : null;
}

function seedBot(n) {
  botSeed = n >>> 0;
}

module.exports = { botStep, playRun, seedBot };
