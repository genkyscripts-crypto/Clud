/*
 * Hitscan resolution for one trigger pull.
 *
 * Each pellet is a ray through a point jittered inside the spread cone. Rays
 * test every standing target on its own depth plane (nearest first), stop at
 * solid props, and may continue through targets when the gun penetrates.
 * Damage is accumulated per target and applied once per shot, nearest first.
 * Every broken target is rewarded exactly once via Game.rewardBreak.
 */
(function (root) {
  'use strict';
  const ZTA = root.ZTA;
  const C = ZTA.content;
  const U = ZTA.util;

  function fire(game, rt, st) {
    const cam = game.camera;
    const rng = game.rng;
    const aim = game.aim;
    const perk = ZTA.perks[st.perk.id] || {};
    const params = st.perk.params;
    const perkMult = perk.damageMult ? perk.damageMult(rt.perkState, params) : 1;

    const spreadPx = Math.tan(U.deg2rad(st.spread + rt.bloom)) * cam.f;
    const perTarget = new Map();
    const impacts = [];
    let weakHits = 0;
    let bodyHits = 0;
    let propHits = 0;

    for (let p = 0; p < st.pellets; p++) {
      let ox;
      let oy;
      if (st.pellets > 1) {
        const d = rng.disc();
        ox = d[0];
        oy = d[1];
      } else {
        // Single-projectile guns cluster toward the center of their cone.
        const a = rng.next() * Math.PI * 2;
        const r = rng.next();
        ox = Math.cos(a) * r;
        oy = Math.sin(a) * r;
      }
      const px = aim.x + ox * spreadPx;
      const py = aim.y + oy * spreadPx;
      const hits = game.targets.raycast(px, py, cam);

      let pen = st.penetration;
      let penScale = 1;
      let landed = false;
      for (const h of hits) {
        if (h.prop) {
          impacts.push({ kind: 'prop', x: px, y: py, z: h.z, material: h.prop.material });
          propHits++;
          landed = true;
          break;
        }
        const t = h.target;
        const dmg = C.pelletDamage(st, t.def, { weak: h.weak, distance: t.z, perkMult, penScale });
        let acc = perTarget.get(t);
        if (!acc) {
          acc = { damage: 0, weakHits: 0, bodyHits: 0, armoredHits: 0, wx: h.wx, wy: h.wy, x: px, y: py };
          perTarget.set(t, acc);
        }
        acc.damage += dmg.damage;
        if (h.weak) {
          acc.weakHits++;
          weakHits++;
        } else {
          acc.bodyHits++;
          bodyHits++;
        }
        if (dmg.armored) acc.armoredHits++;
        impacts.push({ kind: 'target', x: px, y: py, z: t.z, target: t, weak: h.weak, armored: dmg.armored, material: t.def.material });
        landed = true;
        if (pen <= 0) break;
        pen--;
        penScale *= st.penetrationFalloff;
      }
      if (!landed) {
        const b = cam.backdropHit(px, py);
        impacts.push({ kind: 'backdrop', x: px, y: py, z: b.z, world: b, surface: b.surface });
      }
    }

    // Apply damage nearest first; collect breaks.
    const entries = Array.from(perTarget.entries()).sort((a, b) => a[0].z - b[0].z);
    const broken = [];
    for (const [t, acc] of entries) {
      const r = t.applyDamage(acc.damage, acc);
      if (!r) continue;
      game.events.emit('target:hit', {
        target: t,
        damage: acc.damage,
        weak: acc.weakHits > 0,
        armored: acc.armoredHits > 0 && acc.weakHits === 0,
        pellets: acc.weakHits + acc.bodyHits,
        x: acc.x,
        y: acc.y,
        broken: r.broken,
      });
      if (r.broken) broken.push({ t, acc });
    }

    const anyHit = entries.length > 0;
    const result = { weakHits, bodyHits, propHits, anyHit, brokenCount: broken.length };

    if (perk.onShotResolved) perk.onShotResolved(rt.perkState, params, result);
    if (anyHit) game.combo.registerHit(weakHits > 0, perk.comboGainMult ? perk.comboGainMult(params) : 1);
    else game.combo.registerMiss();

    broken.forEach((b, i) => {
      game.rewardBreak(b.t, {
        weak: b.acc.weakHits > 0,
        breakIndex: i,
        breakCount: broken.length,
        perkMult: perk.rewardMult ? perk.rewardMult(rt.perkState, params, { breakIndex: i, breakCount: broken.length }) : 1,
        weaponId: rt.id,
      });
    });

    game.recordShot(rt.id, result);
    const shot = { weaponId: rt.id, impacts, result, spreadPx, aimX: aim.x, aimY: aim.y };
    game.events.emit('shot:resolved', shot);
    return shot;
  }

  ZTA.Ballistics = { fire };
})(typeof window !== 'undefined' ? window : globalThis);
