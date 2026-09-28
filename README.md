# ZERO TO ARMORY

A first-person shooting-range incremental game in plain HTML5 Canvas and JavaScript. You stand at a fixed bench with a cheap pistol. Breaking targets earns cash, cash buys upgrades and new guns, and each gun plays differently.

**Shoot → break targets → earn → upgrade → unlock guns → expand your armory.**

This is **Phase 1**, which proves the core loop: one range, three guns, three target types, upgrades and saves.

## Play it

- Open `index.html` in a desktop browser (Chrome, Edge, Firefox or Safari). It works straight from disk with no server and no install.
- Or run `npm start` and open http://localhost:5173.
- `npm run build` writes a single self-contained file to `dist/zero-to-armory.html` that you can share or host anywhere.

Progress saves automatically in the browser's local storage.

### Controls

| Input | Action |
|---|---|
| Mouse | Aim |
| Hold left mouse | Fire (semi-automatic guns repeat at their capped rate) |
| R | Reload early (reloads are automatic when empty) |
| 1 / 2 / 3, mouse wheel | Switch between the three equipped guns |
| Tab | Armory and upgrades |
| Esc | Pause / back |

On touch screens, hold a finger on the range to fire. On-screen Reload and Switch buttons appear.

## Phase 1 report

### What is playable
- **An endless practice range** built from authored wave patterns with constrained randomization. There's no timer. New mechanics arrive one at a time:
  - plates (wave 1)
  - depth rows (wave 2)
  - bottle clusters on crates (wave 3)
  - armored moving runners (wave 5)
  - then a weighted mix, never repeating the same pattern twice in a row
- **Three guns** that differ in cadence, recoil, reload style, audio and perk:

| Gun | Role | Signature perk | Weakness |
|---|---|---|---|
| **P9 Standard** (Kestrel Arms, striker pistol) | Precision | *Center Streak*: consecutive weak-point hits stack +12% damage | Armor soaks body hits |
| **Hornet K** (Vespa Defense, compact SMG, $500) | 780 rpm, builds combo fast | *Hot Hands*: combo gain ×1.5 | Armor cuts it to a quarter; spread blooms on long bursts |
| **Brute 12** (Halden & Rook, pump shotgun, $1,500) | Clears clusters with 8 pellets | *Cluster Bounty*: extra breaks from one shell pay +50% | Slow pump, shell-by-shell reload you can interrupt by firing, weak past 10 m |

- **Three target types:**
  - **Steel plates:** hang on chains, swing where you hit them, chip their paint and get knocked flat. The center ring is a weak point.
  - **Glass bottles:** shatter with shards and ink splatter.
  - **Rail runners:** flip-up armored silhouettes on a moving trolley. The glowing core ignores armor.
- **Gun feel:**
  - Shots fire inside the input handler, so there's no one-frame delay.
  - View kick that recovers smoothly, and a spring-driven viewmodel.
  - Slide lock on an empty pistol, bolt and pump cycling, and magazine/shell reload animations.
  - Inked muzzle flash, brass ejection, material-specific sparks, shards and debris, bullet-hole decals.
  - Hit markers and underlined crit numbers, plus a restrained brass wave-clear toast.
- **Economy and rewards:**
  - A capped combo up to ×2.5. Weak points count double, misses subtract two steps, and the meter is frozen between waves.
  - Wave bonuses, doubled for a clean wave with no misses.
- **Upgrades:**
  - Four tracks per gun, one of them unique to that gun.
  - Four range upgrades: Target Bounty, Quick Reset, Weak-Point Bounty, Extra Stands.
  - Every purchase shows its exact cost, the before/after value, and any shots-to-break breakpoint it crosses (for example "Plate: 3 → 2 shots").
- **The armory:**
  - A pegboard wall that fills in as you collect.
  - A spec sheet with stat bars compared against the gun in hand, a shots-to-break table, equip-to-slot, and Test Gun.
  - An unlock reveal with an immediate Test Gun button.
- **Onboarding without a tutorial wall:** contextual hints appear once each, when relevant (fire, weak points, upgrade ready, reload, switching). A "Next gun" goal bar shows what you're working toward.
- **Settings:** screen shake, flashes, damage numbers, hit markers, intense effects, volume and mute.
- **Saves:** versioned, checksummed local saves with a rolling backup, automatic recovery and sanitizing. The game saves immediately after purchases, unlocks, equips and settings changes, every 12 s while playing, and when the tab is hidden.

### How to test it
Automated:
```bash
npm test          # 26 logic tests: economy, saves, weapons, rewards, combo, waves (Node 18+)
npm run test:e2e  # 32 browser checks through the real UI (needs Playwright + Chromium)
npm run pacing    # pacing estimate with a simulated human shooter
```
The e2e run covers:
- first-shot latency
- pause blocking fire
- unaffordable purchases doing nothing
- an exact-cost upgrade
- the unlock → reveal → Test Gun flow
- number-key switching
- persistence across a page reload
- a 6-minute fast-forwarded session checking pool bounds
- HUD and armory layout at 1280×720, 1366×768, 1920×1080 and 2560×1440

Screenshots are written to `tests/output/`.

Manual checklist (about 10 minutes):
1. Start. Without reading anything else, the hint tells you to hold the mouse and break targets.
2. Within about a minute the Armory chip glows and a hint says an upgrade is affordable. Buy Damage twice on the P9: plates now break in 2 body shots instead of 3.
3. Keep playing until the Next-gun bar turns brass. Unlock the Hornet K, press Test gun, and feel the difference against the runner's armor.
4. Press 1/2 or scroll mid-reload. Ammo is never refilled or duplicated by switching.
5. Press Esc while holding fire. Nothing fires until you press again after resuming.
6. Reload the page and choose Continue. Cash, guns, loadout and upgrades are all intact.

### Pacing (simulated, 4 runs each; treat as playtest targets)
| Simulated skill | First upgrade | 2nd gun (Hornet K) | 3rd gun (Brute 12) |
|---|---|---|---|
| Casual (~59% accuracy) | 0:15 | 4:30–5:30 | 12:45–14:15 |
| Average (~72%) | 0:15 | 3:00–3:30 | 8:15–9:00 |
| Sharp (~84%) | 0:15 | 2:00–2:15 | 5:15–5:45 |

"First upgrade 0:15" is the simulator's first shopping check; the first $20 upgrade is affordable after the first wave or two.

### What is placeholder
- **All audio** is procedural WebAudio synthesis, labelled as placeholder in Settings. `ZTA.Audio.registerSample(name, url)` swaps in recorded samples. A missing or failing sample silently falls back to the synth.
- **All art** is procedural canvas drawing: parametric gun silhouettes, targets and the range. There are no image assets.
- Manufacturer and model names are fictional and live in data (`js/data/weapons.js`).

### Known limitations
- Phase 1 has **no timed challenge rounds, mastery, Blueprint Tokens, automation, offline income or prestige**. The save format already reserves `blueprints`, per-gun usage stats and favorites for those.
- Fonts come from Google Fonts. Offline, the UI falls back to system fonts (Impact / Arial Narrow).
- Local storage is per browser and per origin. In a private window or with storage blocked, the game still runs but shows a "Not saved" notice.
- After unlocking all three guns, Phase 1 content runs out after roughly 15–25 minutes of upgrades. That's expected for this phase.
- Mouse aim uses the absolute cursor rather than pointer lock, which fits a fixed-bench gallery and needs no permission prompt.

### Next milestone: Phase 2 vertical slice
1. Grow the catalog to **12 guns** using the existing builders and perks, adding a revolver, carbine, AK-pattern rifle and marksman rifle with new perks: final-chamber bonus, aligned-plate penetration, weak-point breaker.
2. **Challenge rounds** (45–90 s, fast restart): precision, rapid clear, armor break and family trials. Show requirements before starting, let players change loadout freely, and pay Blueprint Tokens on first clear.
3. A **mechanical boss** with multiple breakable sections.
4. **Mastery tracks** per gun: usage XP, one optional objective, a collection bonus, a cosmetic finish and a perk improvement.
5. Armory **filters, sorting and favorites** once the wall has enough guns to need them.

## Architecture

Classic scripts under one global `ZTA` namespace (no build step, works from `file://`). Load order is in `index.html`. The simulation layers have no DOM or canvas dependencies, so they run headless in Node tests.

| Area | Files | Notes |
|---|---|---|
| Core | `js/core/` | math helpers, seedable RNG, event bus, number formatting, fixed-size pools |
| Content data | `js/data/` | range geometry, targets, weapons, upgrades, waves. Deep-frozen at load, so nothing can store progress on a definition |
| Systems | `js/systems/` | `content` (stat resolution, damage model, breakpoints, validation), `save`, `economy` (the only code that changes balances), `progression`, `combo`, `perks`, `audio` |
| Simulation | `js/game/` | `camera` (projection and recoil kick), `targets` (pooled state machine and props), `weapons` (trigger, cadence, reloads, switching), `ballistics` (hitscan pellets, armor, penetration, rewards), `director` (waves), `game` |
| Rendering | `js/render/` | cached halftone range, parametric gun art, viewmodel, target art, pooled FX, frame composition |
| UI | `js/ui/` | event-driven HUD and hints, armory, menus |

Invariants you can rely on:
- Rewards come only from a target's one-way `active → breaking` transition, and `Game.rewardBreak` refuses a second payment.
- `Economy.trySpend` either spends the whole amount or nothing, and never goes below zero.
- Shots require live play, a ready gun, ammo and cadence. Ammo is decremented in the same step that fires.
- Effects, decals, labels and targets live in fixed pools.

### Adding a gun
Append an entry to `js/data/weapons.js` with a new permanent `id`. Reuse a model builder (`pistol`, `smg`, `shotgun`) with different `params`, reuse or add a perk in `js/systems/perks.js`, and list its upgrade tracks. `ZTA.content.validateCatalog()` runs at boot and in `npm test`. It rejects duplicate ids, unknown perks or upgrades, and any gun that can't reasonably break every target.

### Saves
`localStorage["zta.save"]` holds `{format, version, checksum, body}`, and the previous good save rotates into `zta.save.bak` before each write. Loading tries main, then backup, then a fresh game. Every loaded save is migrated and sanitized against the current catalog, so unknown ids are dropped, levels clamped and loadouts repaired. Numbers are JS doubles (exact to 9×10¹⁵, representable to about 10³⁰⁸). All currency text goes through `ZTA.fmt.cash`.
