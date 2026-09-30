/*
 * Ordinary enemy roles. Each role is a small state machine with a visible
 * tell before every attack. Enemies never fire during their spawn telegraph
 * or their post-spawn grace (`attackDelay`), and never fire while frozen.
 *
 * Hostile bullet speed is scaled by heat (+8% per heat level), stated on the
 * terminal screen before the player chooses.
 */
(function (root) {
  'use strict';
  const HE = root.HE;
  const U = HE.util;

  function toPlayer(g, e) {
    return Math.atan2(g.player.y - e.y, g.player.x - e.x);
  }

  function distPlayer(g, e) {
    return Math.hypot(g.player.x - e.x, g.player.y - e.y);
  }

  function steer(e, angle, speed, dt, accel) {
    const tx = Math.cos(angle) * speed;
    const ty = Math.sin(angle) * speed;
    const k = 1 - Math.exp(-(accel || 6) * dt);
    e.vx += (tx - e.vx) * k;
    e.vy += (ty - e.vy) * k;
  }

  function canAttack(e) {
    return e.attackDelay <= 0;
  }

  const AI = {
    rusher(g, e, dt, sm) {
      const d = e.def;
      const weave = Math.sin(g.t * 3.2 + e.uid * 1.7) * 0.55;
      steer(e, toPlayer(g, e) + weave, d.speed * sm * g.floorSpeed, dt, 5);
    },

    dealer(g, e, dt, sm) {
      const d = e.def;
      const dist = distPlayer(g, e);
      const a = toPlayer(g, e);
      e.t -= dt;
      if (e.t <= 0) {
        e.t = 1.6 + g.combatRoll() * 1.6;
        e.dir = -e.dir || 1;
      }
      let move;
      if (dist < d.preferRange - 70) move = a + Math.PI;
      else if (dist > d.preferRange + 70) move = a;
      else move = a + (Math.PI / 2) * e.dir;
      steer(e, move, d.speed * sm, dt, 4);
      e.facing = a;
      if (!canAttack(e)) return;
      e.fireT -= dt;
      if (e.fireT <= d.tell && e.tellT <= 0 && e.fireT > 0) e.tellT = d.tell;
      if (e.fireT <= 0) {
        e.fireT = d.fireEvery * (0.9 + g.combatRoll() * 0.25);
        e.tellT = 0;
        for (let i = 0; i < d.fan; i++) {
          const t = i / (d.fan - 1) - 0.5;
          g.fireBullet(e.x, e.y, a + t * d.spread, d.bulletSpeed, { shape: 'card', r: 6, dmg: 12 });
        }
        g.sfx('enemy_fire', e.x);
      }
    },

    ringcaster(g, e, dt, sm) {
      const d = e.def;
      if (U.dist2(e.x, e.y, e.wanderX, e.wanderY) < 30 * 30 || e.t <= 0) {
        e.wanderX = g.arenaRand(160, 'x');
        e.wanderY = g.arenaRand(140, 'y');
        e.t = 4;
      }
      e.t -= dt;
      steer(e, Math.atan2(e.wanderY - e.y, e.wanderX - e.x), d.speed * sm, dt, 2);
      if (!canAttack(e)) return;
      e.fireT -= dt;
      if (e.fireT <= d.tell && e.tellT <= 0 && e.fireT > 0) {
        e.tellT = d.tell;
        // The gap is placed off the player's line so standing still is not enough.
        const side = g.combatRoll() < 0.5 ? -1 : 1;
        e.gapAngle = toPlayer(g, e) + side * (0.9 + g.combatRoll() * 0.9);
      }
      if (e.fireT <= 0) {
        e.fireT = d.fireEvery * (0.9 + g.combatRoll() * 0.2);
        e.tellT = 0;
        const step = U.TAU / d.count;
        for (let i = 0; i < d.count; i++) {
          const ang = e.gapAngle + (i + 0.5) * step;
          // Leave `gap` consecutive slots empty around gapAngle.
          const off = Math.abs(U.angleDiff(ang, e.gapAngle));
          if (off < (d.gap / 2) * step) continue;
          g.fireBullet(e.x, e.y, ang, d.bulletSpeed, { shape: 'orb', r: 7, dmg: 12 });
        }
        g.sfx('ring', e.x);
      }
    },

    sniper(g, e, dt, sm) {
      const d = e.def;
      const dist = distPlayer(g, e);
      const a = toPlayer(g, e);
      if (e.state !== 'aim' && e.state !== 'lock') {
        let move = a + (Math.PI / 2) * (e.dir || 1);
        if (dist < d.preferRange - 80) move = a + Math.PI;
        steer(e, move, d.speed * sm, dt, 3);
      } else {
        steer(e, 0, 0, dt, 8);
      }
      if (!canAttack(e)) return;
      if (!e.state || e.state === 'idle') {
        e.fireT -= dt;
        if (e.fireT <= 0) {
          e.state = 'aim';
          e.t = d.aimTime;
          e.aim = a;
        }
        return;
      }
      if (e.state === 'aim') {
        e.aim += U.clamp(U.angleDiff(e.aim, a), -2.4 * dt, 2.4 * dt);
        e.t -= dt;
        if (e.t <= 0) {
          e.state = 'lock';
          e.t = d.lockTime;
        }
      } else if (e.state === 'lock') {
        e.t -= dt;
        if (e.t <= 0) {
          g.fireBullet(e.x, e.y, e.aim, d.bulletSpeed, { shape: 'needle', r: 5, dmg: d.bulletDamage });
          g.fireBullet(e.x, e.y, e.aim - 0.28, 250, { shape: 'orb', r: 6, dmg: 12 });
          g.fireBullet(e.x, e.y, e.aim + 0.28, 250, { shape: 'orb', r: 6, dmg: 12 });
          g.sfx('snipe', e.x);
          e.state = 'idle';
          e.fireT = d.cooldown * (0.9 + g.combatRoll() * 0.3);
          e.dir = g.combatRoll() < 0.5 ? -1 : 1;
        }
      }
    },

    usher(g, e, dt, sm) {
      const d = e.def;
      const a = toPlayer(g, e);
      e.facing += U.clamp(U.angleDiff(e.facing, a), -d.turnRate * dt, d.turnRate * dt);
      const dist = distPlayer(g, e);
      steer(e, dist > 220 ? e.facing : e.facing + Math.PI / 2, d.speed * sm * (dist > 220 ? 1 : 0.5), dt, 3);
      if (!canAttack(e)) return;
      if (e.burstLeft > 0) {
        e.burstT -= dt;
        if (e.burstT <= 0) {
          e.burstT = 0.13;
          e.burstLeft--;
          g.fireBullet(e.x + Math.cos(e.facing) * e.r, e.y + Math.sin(e.facing) * e.r, a, d.bulletSpeed, { shape: 'diamond', r: 6, dmg: 12 });
          g.sfx('enemy_fire', e.x);
        }
        return;
      }
      e.fireT -= dt;
      if (e.fireT <= d.tell && e.tellT <= 0 && e.fireT > 0) e.tellT = d.tell;
      if (e.fireT <= 0) {
        e.tellT = 0;
        e.fireT = d.burstEvery * (0.9 + g.combatRoll() * 0.2);
        e.burstLeft = d.burst;
        e.burstT = 0;
      }
    },

    turret(g, e, dt) {
      const d = e.def;
      e.vx = 0;
      e.vy = 0;
      if (!canAttack(e)) return;
      if (!e.state || e.state === 'rest') {
        e.state = 'rest';
        e.t -= dt;
        if (e.t <= 0) {
          e.state = 'tell';
          e.t = d.tell;
          e.tellT = d.tell;
        }
      } else if (e.state === 'tell') {
        e.t -= dt;
        e.spinAngle += dt * 4;
        if (e.t <= 0) {
          e.state = 'spin';
          e.t = d.spinTime;
          e.tellT = 0;
          e.fireT = 0;
        }
      } else if (e.state === 'spin') {
        e.t -= dt;
        e.spinAngle += d.turnRate * dt * e.dir;
        e.fireT -= dt;
        if (e.fireT <= 0) {
          e.fireT = d.emitEvery;
          for (let i = 0; i < d.arms; i++) {
            g.fireBullet(e.x, e.y, e.spinAngle + (i / d.arms) * U.TAU, d.bulletSpeed, { shape: 'orb', r: 6, dmg: 12 });
          }
        }
        if (e.t <= 0) {
          e.state = 'rest';
          e.t = d.restTime;
          e.dir = -e.dir || 1;
        }
      }
    },
  };

  /** True if a friendly projectile arriving from (px, py) hits the usher's shield. */
  function shieldBlocks(e, px, py) {
    if (e.kind !== 'usher' || e.frozenT > 0) return false;
    const a = Math.atan2(py - e.y, px - e.x);
    return Math.abs(U.angleDiff(e.facing, a)) < e.def.shieldArc;
  }

  HE.EnemyAI = AI;
  HE.Enemies = { shieldBlocks, toPlayer };
})(typeof window !== 'undefined' ? window : globalThis);
