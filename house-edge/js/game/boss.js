/*
 * Lady Zero, the Roulette Rotunda croupier.
 *
 * Patterns (each with a tell and an escape):
 *  rings  — expanding ring of 36 with a 5-bullet safe sector, shown as a green
 *           wedge 0.65 s before it fires.
 *  aimed  — three-round aimed volley.
 *  spokes — six rotating spokes in 3 s bursts with 1.6 s rests.
 *  ball   — the roulette ball circles a drawn track near the arena edge.
 *  wheel  — the wheel spins: four of eight floor sectors are hatched for
 *           1.6 s, then go live for 2 s. The other four are always safe.
 *
 * Phase changes clear hostile bullets and give a 1.8 s recovery beat. Crowd
 * control becomes a bounded stagger meter with an immunity window; the boss
 * can never be frozen.
 */
(function (root) {
  'use strict';
  const HE = root.HE;
  const D = HE.data;
  const U = HE.util;
  const B = D.TUNING.boss;

  function initBoss(e, def) {
    e.bossDef = def;
    e.phase = 0;
    e.transitionT = 1.2;
    e.stagger = 0;
    e.staggerT = 0;
    e.staggerImmune = 0;
    e.pat = { rings: 1.2, aimed: 2.2, spokes: 0, spokesOn: 0, spokeAngle: 0, spokeDir: 1, wheel: 3.5, wheelState: 'idle', wheelT: 0, wheelParity: 0, ringTell: 0, ringGap: 0, adds: 8 };
    e.orbitA = 0;
    e.homeX = e.x;
    e.homeY = e.y;
    e.ball = null;
    e.sectors = null;
  }

  function patterns(e) {
    return e.bossDef.phases[e.phase].patterns;
  }

  function updateBoss(g, e, dt) {
    const def = e.bossDef;
    // Phase transitions.
    const next = def.phases[e.phase + 1];
    if (next && e.hp / e.maxHp <= next.at) {
      e.phase++;
      e.transitionT = 1.8;
      e.ball = null;
      e.sectors = null;
      e.pat.wheelState = 'idle';
      e.pat.wheel = 2.5;
      e.pat.ringTell = 0;
      g.clearBullets(0, 0, 99999, false);
      g.hitStopFor(0.1);
      g.flashScreen(0.3, '#e8424c');
      g.toast(def.name + ' — phase ' + (e.phase + 1), 'boss');
      g.sfx('boss_phase');
      if (patterns(e).includes('ball')) e.ball = { a: 0, bullet: null };
    }
    if (e.staggerImmune > 0) e.staggerImmune -= dt;
    if (e.transitionT > 0) {
      e.transitionT -= dt;
      return;
    }
    if (e.staggerT > 0) {
      e.staggerT -= dt;
      e.vx *= 0.8;
      e.vy *= 0.8;
      return;
    }
    // Slow orbit around home.
    e.orbitA += dt * 0.35;
    const tx = e.homeX + Math.cos(e.orbitA) * 110;
    const ty = e.homeY + Math.sin(e.orbitA * 1.3) * 50;
    e.vx = (tx - e.x) * 2;
    e.vy = (ty - e.y) * 2;

    const pats = patterns(e);
    const P = e.pat;
    const wheelLive = P.wheelState !== 'idle';
    const heavy = pats.includes('spokes') || pats.includes('wheel');

    if (pats.includes('rings') && !wheelLive) {
      P.rings -= dt;
      if (P.rings <= 0.65 && P.ringTell <= 0 && P.rings > 0) {
        P.ringTell = 0.65;
        P.ringGap = Math.atan2(g.player.y - e.y, g.player.x - e.x) + (g.combatRoll() < 0.5 ? -1 : 1) * (0.6 + g.combatRoll() * 1.4);
      }
      if (P.ringTell > 0) P.ringTell -= dt;
      if (P.rings <= 0) {
        P.rings = heavy ? 3.3 : 2.3;
        P.ringTell = 0;
        const n = 36;
        const gap = 5;
        const step = U.TAU / n;
        const speed = e.phase % 2 ? 125 : 150;
        for (let i = 0; i < n; i++) {
          const a = P.ringGap + (i + 0.5) * step;
          if (Math.abs(U.angleDiff(a, P.ringGap)) < (gap / 2) * step) continue;
          g.fireBullet(e.x, e.y, a, speed, { shape: 'orb', r: 8, dmg: 14 });
        }
        g.sfx('ring', e.x);
      }
    }
    if (pats.includes('aimed')) {
      P.aimed -= dt;
      if (P.aimed <= 0) {
        P.aimed = wheelLive ? 2.4 : 1.7;
        const a = Math.atan2(g.player.y - e.y, g.player.x - e.x);
        for (let i = -1; i <= 1; i++) g.fireBullet(e.x, e.y, a + i * 0.16, 240, { shape: 'diamond', r: 7, dmg: 14 });
        g.sfx('enemy_fire', e.x);
      }
    }
    if (pats.includes('spokes')) {
      if (P.spokesOn > 0) {
        P.spokesOn -= dt;
        P.spokeAngle += dt * 0.9 * P.spokeDir;
        P.spokes -= dt;
        if (P.spokes <= 0) {
          P.spokes = 0.17;
          for (let i = 0; i < 6; i++) g.fireBullet(e.x, e.y, P.spokeAngle + (i / 6) * U.TAU, 170, { shape: 'orb', r: 6, dmg: 12 });
        }
        if (P.spokesOn <= 0) P.spokesRest = 1.6;
      } else {
        P.spokesRest = (P.spokesRest || 0) - dt;
        if (P.spokesRest <= 0) {
          P.spokesOn = 3;
          P.spokeDir = -P.spokeDir;
        }
      }
    }
    if (pats.includes('ball') && e.ball) {
      e.ball.a += dt * 0.75;
      const A = D.TUNING.arena;
      const bx = A.w / 2 + Math.cos(e.ball.a) * (A.w / 2 - 70);
      const by = A.h / 2 + Math.sin(e.ball.a) * (A.h / 2 - 60);
      if (!e.ball.bullet || !e.ball.bullet.alive || e.ball.bullet.uid !== e.ball.uid) {
        const b = g.fireBullet(bx, by, 0, 0, { shape: 'ball', r: 16, dmg: 18, life: 9999 });
        if (b) {
          e.ball.bullet = b;
          e.ball.uid = b.uid;
        }
      }
      if (e.ball.bullet && e.ball.bullet.uid === e.ball.uid) {
        e.ball.bullet.x = bx;
        e.ball.bullet.y = by;
      }
    }
    if (pats.includes('wheel')) updateWheel(g, e, dt);
    if (pats.includes('spokes') && def.id === 'ladyzero') {
      P.adds -= dt;
      if (P.adds <= 0) {
        P.adds = 11;
        g.spawnPack('rusher', 3, false);
      }
    }
  }

  function updateWheel(g, e, dt) {
    const P = e.pat;
    if (P.wheelState === 'idle') {
      P.wheel -= dt;
      if (P.wheel <= 0) {
        P.wheelState = 'tell';
        P.wheelT = 1.6;
        P.wheelParity = g.combatRoll() < 0.5 ? 0 : 1;
        e.sectors = { cx: e.x, cy: e.y, parity: P.wheelParity, live: false, rot: g.combatRoll() * U.TAU };
        g.sfx('wheel', e.x);
      }
    } else if (P.wheelState === 'tell') {
      P.wheelT -= dt;
      if (P.wheelT <= 0) {
        P.wheelState = 'live';
        P.wheelT = 2.0;
        e.sectors.live = true;
        g.sfx('boss_slam', e.x);
      }
    } else if (P.wheelState === 'live') {
      P.wheelT -= dt;
      if (sectorHot(e.sectors, g.player.x, g.player.y)) g.hurtPlayer(14, 'wheel');
      if (P.wheelT <= 0) {
        P.wheelState = 'idle';
        P.wheel = 6.5;
        e.sectors = null;
      }
    }
  }

  /** Eight sectors around the wheel center; hot ones alternate by parity. */
  function sectorHot(s, x, y) {
    if (!s) return false;
    const dx = x - s.cx;
    const dy = y - s.cy;
    if (dx * dx + dy * dy < 70 * 70) return false;
    let a = Math.atan2(dy, dx) - s.rot;
    a = ((a % U.TAU) + U.TAU) % U.TAU;
    const idx = Math.floor(a / (U.TAU / 8));
    return idx % 2 === s.parity;
  }

  function addStagger(g, e, amount) {
    if (!e.boss || e.staggerImmune > 0 || e.staggerT > 0 || e.transitionT > 0) return;
    e.stagger += amount;
    if (e.stagger >= B.staggerMax) {
      e.stagger = 0;
      e.staggerT = B.staggerTime;
      e.staggerImmune = B.staggerTime + B.staggerImmunity;
      g.toast('STAGGERED', 'boss');
      g.fx.ring(e.x, e.y, e.r, e.r + 60, 0.4, '#9fd8ff', 4);
      g.sfx('stagger', e.x);
    }
  }

  HE.Boss = { initBoss, updateBoss, addStagger, sectorHot };
})(typeof window !== 'undefined' ? window : globalThis);
