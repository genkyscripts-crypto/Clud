# HOUSE EDGE

*Dodge the odds. Rig the reels. Break the bank.*

A top-down incremental bullet-hell roguelite set in a casino run by monsters. You start with a battered revolver and one stolen chip. You survive rooms, rig a three-reel combat slot machine, draft perks that combine into named recipes, and decide at each cash-out terminal whether to **bank** your winnings or **press on** for a bigger multiplier. What you bank buys casino facilities, and those change your next run.

Plain HTML5 Canvas and JavaScript, with no build step and no dependencies. It uses the same stack and conventions as the other game in this repository.

**Status: Milestone 1 (complete small run) is implemented and verified.** The rest of the design brief is tracked in [Checkpoint](#checkpoint--what-is-done-and-what-remains) below. The later milestones are not stubbed in.

## Play it

- Open `house-edge/index.html` in a desktop browser. It runs straight from disk.
- Or run `npm start` inside `house-edge/` and open http://localhost:5174.
- `npm run build` writes one self-contained file to `dist/house-edge.html`.
- Add `?dev=1` to the URL to get developer tools (press `` ` `` or use the hub button). Debug runs are clearly marked and never save.

Progress saves automatically in the browser's local storage, with a rolling backup.

### Controls

| Input | Action |
|---|---|
| WASD | Move (diagonals are normalized) |
| Mouse | Aim |
| Left mouse | Fire |
| Space | Dash (2 charges, ~0.18 s invulnerability, 3 s recharge each) |
| Q | Spin the reels when charged |
| Hold Shift | Precision mode: slower movement, true hitbox and graze ring shown |
| E / Enter | Confirm the focused button on menus |
| 1 / 2 / 3 | Pick a draft card or a door |
| Tab | Build ledger (pauses) |
| Esc | Pause |
| K | Skip the tutorial |

- **Controller:** left stick moves, right stick aims, RT fires, A or LB dashes, Y spins, LT is precision, Start pauses and Back opens the ledger. Vibration is optional.
- **Remapping:** every keyboard action can be rebound in Settings.
- **Assists:** auto-fire and mouse aim assist are optional. Aim assist is always on for controllers.

## The loop in this build

1. **The Entrance (guided, skippable).** It walks you through the controls one step at a time, and each prompt disappears once you've done it:
   - Move, then shoot slow chip rushers.
   - Hold precision mode to see your hitbox.
   - Take one spin. It's a **fixed, labelled tutorial demo** result.
   - A Ring Caster fires a ring with a visible gap you step into.
   - Dash, then graze bullets.
2. **Room loop.**
   - A room plays in 2–3 telegraphed waves.
   - After it, you choose one of three upgrades. You get finite rerolls and bans.
   - Then you choose the next door: a normal room, a High Roller room (an elite in every wave, ×1.5 chips) or the Cashier.
   - Your progress is checkpointed at every door.
3. **Wagers.** An optional wager can appear before a room.
   - You see the exact stake, objective and payout first.
   - The stake is held in escrow. A win returns double the stake; a loss costs only the stake.
   - Every wager settles exactly once, including on death, quitting and reloading.
4. **Floor 1: Penny Arcade.** It ends with **Lady Zero (Table Minimum)**, a 2-phase roulette miniboss.
5. **Cash-out terminal: BANK or PRESS ON.** Both options show exactly what they mean before you choose.
   - **BANK** moves every loose chip to your account and resets the multiplier and heat.
   - **PRESS ON** carries the chips forward. The next floor pays ×1.25 on natural drops (+0.25 per press, capped at ×3) and adds **Heat 1**: +1 elite per room and hostile bullets +8% speed.
6. **Floor 2: Roulette Rotunda.** It adds Shield Ushers and Slot Turrets, and ends with **Lady Zero (House Wheel)**, a 3-phase boss:
   - rings with green safe sectors,
   - rotating spokes,
   - a roulette ball circling a drawn track,
   - a final "wheel spin" that hatches four of eight floor sectors before they go live.
7. **The Vault.** It banks everything and ends the run in victory. The results screen shows:
   - every chip source and loss,
   - what survived the run,
   - the cheapest next purchase, and whether you can afford it now.
8. **Defeat** recovers 25% of loose, unstaked chips, and shows the calculation.
9. **The hub** is a casino lobby. Its broken slot cabinets light up as you invest in them.
   - **Slot Alley** makes banked chips over time, even while you're away (capped at 8 h, and safe if your clock rolls back). Its level milestones change play:
     - Warm Reels: runs start with 50 charge.
     - Hold Token: your first hold each floor is free.
     - Neon and gold cabinet trims.
     - A **Loaded Seven** reel preset. It really changes the odds, and the displayed odds with them.
   - **Two capped table upgrades:** +25% max health total and +15% damage total.

A first cleared floor banks about 280 chips (simulated). That buys Slot Alley (60) plus both first table ranks, and the next run starts visibly different.

## The combat slot machine

- Three reels with six equally weighted symbols: Bullet, Bolt, Bell, Crown, Skull, Seven.
- **Charge** comes from primary damage, kills, elite kills and grazes. Each bullet can be grazed once, and graze charge is capped per second. A spin costs 100.
- **Results:**
  - Mixed: fires all three single effects.
  - Pair: fires the paired symbol's upgraded effect plus the odd symbol's single effect.
  - Triple: fires that symbol's themed super attack.
  - **777:** a 10 s golden-revolver jackpot with its own music. A repeat 777 adds up to +5 s and one gold pulse. Continuous jackpot time is capped at 20 s, followed by a visible cooldown.
- **Holds:** on a safe screen you can hold one reel for the next spin (+25 charge, or free with a Hold Token).
- **Odds:** the HUD and the reel panel always show the **exact** 777 chance, computed from the same weights and holds the draw uses. Unmodified it is 1 in 216; with a held Seven it is 1 in 36. A test checks the displayed odds against 120,000 real spins.
- **Resolution order:** loadout weights → held results → draw unheld reels → announced guarantee (hook) → wildcard (hook) → classify → effects.
- **Integrity:**
  - The reel RNG is its own stream and is saved in the checkpoint, so reloading cannot reroll a result.
  - Spin attacks never generate charge.

## Content in this build (honest count)

| Category | Implemented | Full-release target |
|---|---|---|
| Weapons | 1: W01 Rusted Ace (six-shot revolver; the 6th round is a heavy ×2.4 shot) | 24 |
| Core perks | 8, 3 ranks each: P01 Ricochet, P02 Split Shot, P04 Orbitals, P05 Returnshot, P09 Fire, P10 Frost, P11 Shock, P41 Dash Spark | 64 |
| Named recipes | 8, each with a scripted test: S003 Burning Bank Shot, S005 Boomerang Bloom, S007 Saturn's Wager, S017 Steam Table, S018 Plasma Payout, S021 Brittle Circuit, S081 Skid Row, S089 Live Wire | 128 |
| Enemy roles | 6: Chip Rusher, Card Dealer, Ring Caster, Marked Sniper, Shield Usher, Slot Turret, plus elite variants | 24+ |
| Bosses | 1 boss (Lady Zero) in two forms: the 2-phase miniboss and the 3-phase full fight | 8 + final + 4 alternates |
| Districts | 2 (Penny Arcade, Roulette Rotunda) + the Vault | 8 |
| Facilities | 1 (Slot Alley) + 2 capped table upgrades | 6 |
| Wagers | 4 objectives (no dash, no damage, 15 grazes, 75 s clock) | more via the Bookmaker |
| Relics, pickups, characters, prestige | not in this build | 16 / 16 / 8 / BUY THE HOUSE |

Recipes activate the moment you own their ingredients and never take a slot. The ledger (Tab) has three tabs:

- **Build:** your slots, ranks and triggers.
- **Recipes:** discovered recipes, ingredient tracking, search, tag filter and a reveal-all toggle.
- **Odds:** the reel tables, and what every symbol does in single, pair and triple form.

## Rules the engine enforces

- **Safe screens:** the arena only simulates during intro, combat, room-clear and the death animation. No enemy can act behind a menu, and the game auto-pauses when it loses focus.
- **Damage order:** base → flat → additive (Loaded Chambers, Ricochet rank 3) → multiplicative (Crown window, frozen bonus, boss stagger) → critical (none yet) → resistance (the Usher's shield is resolved first and absorbs 80% from the front) → cap 999.
- **Proc limits:**
  - Primary hits apply on-hit effects at coefficient 1. Secondary hits (fragments, arcs, orbitals, zones, spin attacks) use 0.25.
  - Chains go at most 2 levels deep and emit at most 24 effects per originating attack (64 during a jackpot). Effects past the budget become plain damage instead of disappearing.
  - Arcs never arc. Plasma branches never branch. Fragments and petals never split or return.
- **Paid once:**
  - A kill pays chips once and a bullet can be grazed once.
  - Wagers settle once.
  - A run's settlement is recorded by run ID in the same save write that changes balances, so a reloaded or duplicated checkpoint cannot pay twice.
- **Economic origins:** `natural`, `room_bonus`, `facility`, `wager_return`, `bank_transfer` and `recovery` are tracked separately. Only natural income gets the multiplier.
- **Bosses:** bosses cannot be frozen. Crowd control fills a bounded stagger meter (1.6 s stagger, then 6 s immunity), and phase changes clear bullets and give a recovery beat.
- **Encounter director:**
  - It spends a threat budget with at most two ranged pattern roles and one turret per wave.
  - It waits for 70% of the wave to die, then allows a 1.4 s recovery beat.
  - It spawns enemies at least 280 px from you, behind 0.8 s markers, with a further 0.7 s before they can attack.
  - Every ring has a visible gap, placed off your current line so you have to move.
- **Separate RNG streams:** run layout, loot/drafts, reels, per-room combat, and cosmetics (`Math.random`, which never affects outcomes). A seeded run replays identically, and a test checks that changing effect density leaves outcomes unchanged.
- **Accessibility settings:** shake, flashes, hit stop, damage numbers, effect density and vibration. These never hide hostile bullets or telegraphs, which are always drawn on top as white cores with red rims in five silhouettes.

## Testing

```bash
npm test          # 39 logic tests (Node 18+)
npm run test:e2e  # ~40 browser checks through the real UI (Playwright + Chromium)
npm run pacing    # balance and pacing estimate with a simulated player
```

**Unit tests** cover:

- the catalog;
- slot odds (exact values and empirical frequencies), holds, demo spins and restore-can't-reroll;
- earning origins and multipliers, wager escrow and single settlement, and defeat recovery;
- bank and press-on;
- facility curves, the offline cap, clock rollback and single collection;
- saves: checksum, backup fallback, v0→v1 migration and sanitizing;
- a full seeded run that settles once;
- determinism, including with effect density changed;
- defeat accounting, and a mid-room wager counted as lost after a reload;
- terminal double-bank protection;
- the frozen arena on safe screens;
- graze-once and its cap, kill-pays-once, and no charge from spin kills;
- jackpot caps and cooldown, proc depth and budget, and boss freeze/stagger/phase immunity;
- director composition rules and draft rules;
- the tutorial demo and tutorial skip;
- account modifiers, and debug runs never saving;
- one verification scenario per recipe;
- the stress scene staying inside its pools.

**E2E checks** (screenshots go to `tests/output/`):

- first-visit objective, movement and firing;
- pause and ledger;
- tutorial skip, then a draft picked through the UI;
- the doors checkpoint and resume after a page reload;
- wager escrow;
- the terminal: bank the exact amount, then finish, results and next goal;
- buying Slot Alley at its exact cost, surviving a reload, and the next run's Warm Reels;
- a real Q spin;
- key rebinding, settings toggles and abandon;
- layout at 1280×720, 1920×1080, 1024×768 and 2560×1080;
- the stress-scene frame timing.

### Pacing (simulated player, 8 seeded runs per row, bank at the first terminal)

| Profile | Vault reached | Run time | Median room | Median time between spins | First bank |
|---|---|---|---|---|---|
| Casual (poor dodging, wide aim wobble) | 5/8 | 6.6 min | 48 s | 43 s | ~280 |
| Average | 7/8 | 5.2 min | 38 s | 31 s | ~283 |
| Sharp | 8/8 | 4.6 min | 30 s | 25 s | ~283 |

The bot never dashes deliberately, never grazes on purpose and spends no time in menus, so real runs will be longer. All balance values are first-pass hypotheses that still need human playtesting. The pacing target for this introductory route is "shorter than a full 18–25 minute run", which it meets.

### Performance (measured, and the misses reported)

**Reference setup:** 4-vCPU Intel Xeon @ 2.1 GHz cloud container, headless Chromium 141 with **CPU (software) rasterization, no GPU**, 1920×1080 at DPR 1. The stress scene (`?dev=1` → Start stress scene) holds 150 active enemies, about 1,500 hostile bullets and about 2,000 friendly projectiles.

| What | Result |
|---|---|
| Simulation, one 60 Hz step in Node | ~3.5–4 ms (shots 2.2 ms, enemies 0.9 ms) |
| JS work per browser frame (sim + draw calls) | p50 ≈ 21 ms, p95 ≈ 35 ms. This includes catch-up sim steps, up to 4 per frame |
| Frame gap in headless Chromium | p50 ≈ 83 ms, p95 ≈ 117 ms (~12 FPS) |
| Raster cost per stress frame | ~66–92 ms: shots ~22, enemies ~25, bullets ~13, floor ~8 |

**This does not meet the 60 FPS target on this machine.** Almost all of the frame is software rasterization, which this container forces because it has no GPU. Hostile bullets and enemy bodies are cached device-resolution sprites, and friendly shots are batched into one path per color, which took raster time down from ~112 ms. A GPU-accelerated desktop browser should do much better, but that is **unmeasured here**. Normal combat has far fewer objects: typically fewer than 30 enemies and a few hundred bullets.

Next steps if a real device misses the target: an offscreen bullet atlas, a WebGL path for bullets and shots, and aggregating friendly shots.

## Architecture

The simulation has no DOM or canvas dependencies, so the whole game (including the tutorial, bosses and settlement) runs headless in Node tests. All scripts attach to one global `HE` namespace, and the load order is in `index.html`.

| Area | Files | Notes |
|---|---|---|
| Core | `js/core/` | math, seedable RNG streams with saved state, event bus, dense pools, spatial grid |
| Content | `js/data/content.js` | tuning, symbols, weapon, perks (per-rank params), recipes (ingredients, trigger, transformation, cooldown, proc coefficient, stacking, conflicts, verification scenario), enemies, bosses, wagers, shop, facility, upgrades, floors, layouts, heat |
| Systems | `js/systems/` | `slots` (pure reel logic and exact odds), `economy` (the only code that changes balances), `facilities`, `save` (versioned, checksummed, staged write + backup, migrations, sanitizing), `catalog` (validation + deep freeze), `input`, `audio` |
| Simulation | `js/game/` | `game` (run state machine, player, weapon, projectiles, collisions, damage pipeline, pickups, zones, checkpoint, settlement), `perks` (all perk and recipe behavior, proc rules), `spins` (reel effects and jackpot), `enemies`, `boss`, `director`, `run` (drafts, doors, tutorial), `fx` (cosmetic data), `debug` |
| Rendering | `js/render/` | vector reel symbols (canvas and SVG); the renderer draws the arena, telegraphs, HUD and hub lobby |
| UI | `js/ui/ui.js` | the DOM safe screens: hub, wager, draft, doors, cashier, terminal, results, pause, ledger, settings, offline popup, dev tools |

The event pipeline covers: `primary_shot`, `kill`, `elite_kill`, `health_damage`, `shield_block`, `graze`, `dash`, `spin`, `spin_resolved`, `jackpot_started`, `chips_earned`, `chips_banked`, `wager_settled`, `room_cleared`, `recipe_activated` and more. Every event carries the run ID, source ID, chain ID, origin, depth and flags.

**Saves** live in `localStorage` under `he.save`, `he.save.bak` and `he.save.tmp`.

- Each write goes to the staged key first, then the main save rotates into the backup, then the new main save is written.
- Loading tries main → backup → staged → fresh.
- There is one resumable checkpoint, written at every door and terminal. A wager placed mid-room is written into the checkpoint as already lost.

### Adding content

- **A perk:** add it to `D.perks` with per-rank params, then hook its behavior in `js/game/perks.js`.
- **A recipe:** add it to `D.recipes`, then implement it at its trigger point in `perks.js` (and call `noteRecipe`).
- **Tests:** add a verification scenario test for each new perk or recipe.
- `HE.validateCatalog()` runs at boot and in `npm test`. It rejects unknown ingredients, duplicate IDs and duplicate ingredient sets.

## Placeholders and limits

- **Art:** all procedural canvas drawing in a black-and-white ink style with red, green and gold accents. There are no image files.
- **Audio:** all procedural WebAudio, with separate music, effects and interface buses, voice caps and priorities. Music has hub, calm, combat, boss and jackpot modes.
- **Fonts:** loaded from Google Fonts, with system fallbacks when offline.
- **Mobile:** touch twin-stick controls are not implemented. Mobile was not a stated target.
- **Ownership marks:** first clears are recorded, but marks and prestige don't exist yet. They arrive with BUY THE HOUSE in Milestone 3.

## Checkpoint — what is done and what remains

**Milestone 1 — complete small run: done.** It includes:

- movement, aiming and dash;
- one weapon, six enemy roles and one boss (two forms);
- real spin outcomes and 8 perks with 8 recipes;
- the bank/press-on decision;
- one facility with offline production;
- save/load with checkpoint and resume;
- procedural sound;
- the results screen.

It also delivers several Milestone 2 items early:

- held reels;
- wagers;
- drafts that favour recipe completion, with rerolls and bans;
- the Cashier;
- a second district;
- heat;
- remapping;
- controller support;
- the ledger;
- dev tools and the stress scene.

**Milestone 2 — remaining:**

- 5 more weapons, with an auxiliary slot;
- 16 more perks, to reach 24;
- 4 relics with two relic slots;
- 16 more verified recipes, to reach 24;
- a second boss;
- tuning the first hour of progression against human playtests.

**Milestone 3:**

- the rest of the catalog: 24 weapons, 64 perks, 16 relics, 16 pickups, 8 characters, 8 districts, all bosses and alternate forms, and all 128 recipes;
- the other five facilities;
- ownership marks and BUY THE HOUSE.

**Milestone 4:**

- a device-measured performance pass (GPU desktop and a low-end laptop);
- a WebGL fallback if needed;
- tutorial tightening from playtests;
- balance passes;
- an accessibility audit.
