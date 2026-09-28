# ZERO TO ARMORY

A first-person shooting-range incremental game in plain HTML5 Canvas and JavaScript. You start at a basement bench with a cheap pistol. Breaking targets earns cash, cash buys upgrades, guns and new ranges, and every gun plays differently.

**Shoot → break targets → earn → upgrade → unlock guns → beat challenges → open new ranges → expand the armory.**

## Play it

- Open `index.html` in a desktop browser (Chrome, Edge, Firefox or Safari). It runs straight from disk with no server and no install.
- Or run `npm start` and open http://localhost:5173.
- `npm run build` writes one self-contained file to `dist/zero-to-armory.html` that you can share or host anywhere.

Progress saves automatically in the browser's local storage.

### Controls

| Input | Action |
|---|---|
| Mouse | Aim |
| Hold left mouse | Fire (semi-automatic guns repeat at their capped rate) |
| R | Reload early (reloads are automatic when empty) |
| 1 / 2 / 3, mouse wheel | Switch between the three equipped guns |
| Tab | Armory: weapons, range upgrades, Workshop, training lanes |
| M | Ranges & challenges |
| Esc | Pause / back |

On touch screens, hold a finger on the range to fire. On-screen Reload and Switch buttons appear.

## What's in the game

### Five ranges
Each range has its own procedural art, lighting, ambient animation and targets. Targets on later ranges are tougher and pay much more, and every range adds new behaviors so progress is never just the same plate with more HP.

| # | Range | Look | New targets | Target HP / pay | Opens with |
|---|---|---|---|---|---|
| 1 | **Bench Lane** | lit basement, paper walls, fluorescent tubes | plates, bottles, rail runners | ×1 / ×1 | — |
| 2 | **Rooftop 9** | night skyline, floodlights, moon, water-tower beacon, passing plane | drones (bonus cash, they escape), poppers (up for a few seconds) | ×3 / ×8 | ★ on Qualifier + $5,000 |
| 3 | **Scrap Yard** | overcast yard, car stacks, dead crane, circling birds | explosive barrels (chain reactions), heavy armored plates | ×9 / ×60 | ★ on Rooftop Qualifier + $1.2M |
| 4 | **Freight Dock** | container canyon, light shafts, open harbor door, swinging hook | aligned plate racks (penetration), shutter boxes (timed weak point) | ×27 / ×450 | ★ on Scrap Qualifier + $30M |
| 5 | **The Vault** | arched proving tunnel, vault door, sweeping lamp | everything, faster and tougher | ×80 / ×3,500 | ★ on Dock Qualifier + $2.5B |

The **Ranges** screen (M) shows every map with a live preview, its requirements, targets and challenge board.

### Forty guns in seven families
Pistols, revolvers, SMGs, rifles and carbines, shotguns, marksman rifles, and heavy/experimental: LMGs, a minigun, a drum grenade launcher, an arc caster, a needle rig and a rail driver. Guns are sold by tier; each range stocks the next tier. Every gun has its own cadence, recoil, reload style, sound and one of **20 signature perks** (for example: Center Streak, Final Chamber, Ricochet, Through-and-Through, Armor Breaker, Shockwave, Chain Arc, Needle Stack, Spin-Up).

Twelve parametric model builders draw every gun in first person and on the wall, including:
- slides, bolts and pump cycling
- bolt-action handles
- swing-out cylinders
- break-open barrels
- spinning barrels
- energy weapons that glow, charge and vent

Reload styles are magazine, shell-by-shell, cylinder, break-open, box and vent.

### Challenges and bosses
- **24 challenges**, 45–90 s each:
  - clear, precision, combo scoring, drone hunting
  - endurance with lives, chain reactions, armor, penetration
  - **family trials** that put every gun of a family on equal footing
- **Stars** are shown before you start. Each new star pays **Blueprint Tokens**, and every starred run also pays cash.
- **Five mechanical bosses**, one per range: Target Rig, Skylight Sentry, Scrap Crusher, Gantry and The Overseer.
  - Each boss has breakable armor panels, a chest plate hiding its core, and a sensor that only opens now and then.
  - Bosses enrage after losing sections.
  - Stars depend on how fast you win.

### Long-term progression
- **Two currencies only:** Cash, and Blueprint Tokens. Tokens come from stars, mastery, objectives and collection milestones — never from waiting.
- **Mastery** per gun: five levels earned by using it.
  - Level rewards are a collection cash bonus, a finish, a perk improvement, then a brass finish and tokens.
  - Each gun also has one optional **objective** matched to its perk.
- **Cosmetic finishes:** Factory, Brushed Steel, Halftone, Tiger Stripe and Brass Inlay. They never change stats.
- **Perk improvements** (Mk II / Mk III) are bought per gun with tokens.
- **Workshop:** ten permanent token upgrades:
  - damage, cash, reload speed, starting combo and mastery XP
  - lane output and offline hours
  - a Range Assistant that auto-collects lane cash
  - a fifth lane
  - a higher perk cap
- **Training lanes (automation):**
  - Put owned guns in up to five lanes. They earn capped passive cash while you play and while you're away.
  - Offline accrual is clock-safe: a clock moved backwards pays nothing, and gaps are capped.
  - Lanes never pay tokens, and active shooting is always far faster.
- **Collection milestones** at 3, 6, 10, 15, 20, 25, 30 and 40 guns.
- **Prestige — "Open a New Branch":**
  - Unlocked by beating the Scrap Crusher.
  - The screen spells out exactly what resets and what stays, then you pick one of three **charters** (permanent perks such as +50% cash, +30% damage, a head start or double lane output).
  - Each branch adds +25% cash for good and unlocks an optional challenge **modifier** (Hard Steel, Short Fuse, Glass Jaw, Moving Day) that doubles rewards.

### Feel and presentation
- Black-and-white urban ink look with one brass accent, reserved for rewards.
- Screen space and recoil:
  - shots fire inside the input handler, so there's no frame delay
  - view kick recovers smoothly
  - screen shake moves the whole canvas, so it never changes where a shot lands
- Effects:
  - tracers, a coiled rail beam, arc lightning, ricochet streaks
  - explosions with shockwaves, embers, smoke and scorch decals
  - material sparks, shards and debris
- Casings: pistol brass, rifle brass and shotgun shells.
- Film grain.
- Countdowns, a live star tracker, a boss health bar and animated results.
- Procedural WebAudio for every sound:
  - ten gunshot profiles plus tonal energy weapons
  - explosions
  - bolts, cylinders and break-opens
  - boss stingers and UI

## Testing

```bash
npm test          # 46 logic tests (Node 18+): economy, saves + migration, weapons, rewards, combo,
                  # waves on every range, challenges, bosses, explosions, mastery, lanes, prestige
npm run test:e2e  # ~53 browser checks through the real UI (needs Playwright + Chromium)
npm run pacing    # pacing estimate with a simulated shooter (runs × minutes × skill)
```

The e2e run covers:
- first-shot latency and pause blocking fire
- exact-cost purchases and the unlock → reveal → Test Gun flow
- persistence across a page reload
- a challenge round from countdown to results
- range unlock and travel
- a full boss fight
- a Workshop purchase
- training lanes (earning, clock safety, cap, collect)
- the offline popup
- opening a new branch (checking what is kept)
- pool bounds over a fast-forwarded session
- HUD and armory layout at four resolutions

Screenshots are written to `tests/output/`.

### Pacing (simulated shooter, no menu time — expect people to take about 1.5× longer)

| Skill | 2nd gun | Rooftop 9 | Scrap Yard | Freight Dock |
|---|---|---|---|---|
| Casual (~66% acc.) | 2–3 min | ~29 min | ~70 min | ~3.4 h |
| Average (~75%) | 2–3 min | ~15 min | ~26 min | 1–3 h |
| Sharp (~88%) | <1 min | 6–11 min | 13–19 min | — |

The Vault and all 40 guns are a many-hour goal, and prestige branches speed up each new run.

## Architecture

Classic scripts under one global `ZTA` namespace (no build step, works from `file://`). Load order is in `index.html`. The simulation has no DOM or canvas dependencies, so it runs headless in Node tests.

| Area | Files | Notes |
|---|---|---|
| Core | `js/core/` | math helpers, seedable RNG, event bus, number formatting, fixed-size pools |
| Content data | `js/data/` | `ranges` (geometry, slots, waves), `targets`, `weapons` (tier-scaled catalog), `upgrades`, `challenges`, `bosses`, `meta` (mastery, Workshop, lanes, milestones, prestige). Deep-frozen at load |
| Systems | `js/systems/` | `content` (stat resolution, damage model, breakpoints, validation), `save` (v2 + migration), `economy` (the only code that changes balances), `progression`, `combo`, `perks`, `audio` |
| Simulation | `js/game/` | `camera`, `targets` (pooled state machine, bosses, props), `weapons`, `ballistics`, `director` (practice waves), `challenge` (timed rounds), `game` (explosions, projectiles, secondary hits) |
| Rendering | `js/render/` | `themes` (one painter per map + ambient layer), cached background, parametric `gunart`, `viewmodel`, `targetart` (two tones, bosses, props), pooled `fx`, `renderer` |
| UI | `js/ui/` | HUD, armory (wall, spec sheet, mastery, Workshop, lanes), ranges & challenges map, menus (results, prestige, offline) |

Invariants:
- Rewards come only from a target's one-way `active → breaking` transition, and `Game.rewardBreak` refuses a second payment.
- `Economy.trySpend` and `trySpendBlueprints` either spend the whole amount or nothing.
- Boss sections are pooled targets tracked by uid, so a recycled object is never mistaken for a live section.
- Effects, decals, labels, links, projectiles and targets live in fixed pools.

### Adding content
- **A gun:** append a `gun({...})` entry to `js/data/weapons.js` with a new permanent `id`, a builder plus params, a perk and upgrade tracks. The tier handles damage and cost scaling.
- **A challenge:** append to `js/data/challenges.js`.
- **A range:** add geometry, slots and waves to `js/data/ranges.js`, plus a painter in `js/render/themes.js`.

`ZTA.content.validateCatalog()` runs at boot and in `npm test`.

### Saves
`localStorage["zta.save"]` holds `{format, version, checksum, body}`. The previous good save rotates into `zta.save.bak` before each write. Loading tries main, then backup, then a fresh game. Every loaded save is migrated (v1 → v2 keeps Phase 1 progress) and sanitized against the current catalog.

## Placeholders and limits
- **All audio** is procedural WebAudio synthesis. `ZTA.Audio.registerSample(name, url)` swaps in recorded samples; a missing sample falls back to the synth.
- **All art** is procedural canvas drawing. There are no image assets.
- Manufacturer and model names are fictional.
- Fonts come from Google Fonts. Offline, the UI falls back to system fonts.
- Challenge star thresholds and late-game costs are tuned against the simulator and still need human playtesting.
