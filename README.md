# VOXELON (Three.js + TypeScript)

A from-scratch, browser-based **multiplayer** voxel arena built on Three.js —
no game engine, no voxel libraries, no Mojang assets (every texture, mob and
avatar is drawn procedurally). Minecraft-style sandbox with a stamina/energy
system instead of hunger, hostile mobs, and server-authoritative PvP.

## Run it

Single-player works with no server. For multiplayer, run the server and the
client side by side:

```bash
npm install
npm run server   # terminal 1 — VOXELON server on ws://localhost:8080
npm run dev      # terminal 2 — client on http://localhost:5173
```

Open the printed URL in a desktop browser and press **Play**. With the server
running you join the shared world (you'll get an auto-assigned `WordWordNN`
username and a skin); open a second tab to see another player. **If no server
is reachable the client falls back to offline single-player** after a short
timeout — so the game always runs. Append `?seed=12345` for a different
offline world (multiplayer uses a fixed shared seed).

To play over the internet, host `npm run server` on a reachable machine
(VPS / Fly.io / Render, etc.) and point the client's host at it.

Other scripts: `npm run build` (typecheck + production bundle),
`npm run smoke` (headless engine tests: terrain, meshing, raycast, physics,
energy, mobs, armor/guns, and authoritative server-core logic — 151 checks).

## Controls

| Input | Action |
| --- | --- |
| WASD / mouse | Move / look |
| Space | Jump / swim up; at a water's edge, hold to climb onto the ledge |
| Shift | Sneak (slower, won't fall off edges) |
| Q or double-tap W | Sprint — drains the blue **energy** bar (recharges when you stop) |
| Left click (hold) | Break block (tool-aware speed) / attack mob or player / **sabotage** a machine (HP damage); **fire** when a gun is held |
| Right click | Place block / open crafting table, furnace, chest, or a **machine** (Autominer / Oil Derrick); **equip** an armor item in the inventory |
| R | Reload the held gun (pulls ammo from your inventory into its magazine) |
| Middle click | Select targeted block's hotbar slot |
| 1–9 / scroll | Select hotbar slot |
| E | Open/close inventory (click, right-click split, shift-click; armor column at left) |
| F3 | Debug overlay (FPS, coordinates, facing, target, clock) |
| Esc | Close container / open pause menu (the world keeps running) |

The world is **never paused** — opening your inventory, a chest, or the pause
menu does not stop mobs, other players, or damage, so you stay vulnerable
while a menu is up (multiplayer-style). The orbiting panorama is only the
initial title screen; pausing in-game freezes your view over the live world.

## Vanilla fidelity

- **Physics constants from the Minecraft wiki:** walk 4.317 m/s, sprint
  5.612 m/s, sneak 1.295 m/s, gravity 32 m/s², jump apex 1.25 blocks,
  0.6×1.8 collision box, eye height 1.62 (1.27 sneaking), reach 4.5 blocks.
- **The look:** 16×16 nearest-filtered texture atlas, vanilla face shading
  (top 100% / N-S 80% / E-W 60% / bottom 50%), per-vertex corner ambient
  occlusion with AO-aware quad flipping, light-blue sky with distance fog,
  square sun, drifting blocky cloud layer at y=192.
- **The world:** 16×16×256 chunks, layered-noise hills, sea level y=63 with
  translucent lowered-surface water, sand beaches, bedrock floor.
- **Biomes (M1) + mountains:** temperature/humidity noise selects Plains,
  Forest, Birch Forest, Desert, Snowy Plains, Ocean and Beach, with a
  separate smooth "mountain factor" raising bounded **Mountains** and
  **Snowy Mountains** ranges — biome-aware terrain height pushes peaks well
  above the old cap (to y≈235), with bare-rock faces above y=96 and snow
  caps above y=120. Biomes are sized as real regions (~700-1000 blocks) but
  varied enough that no single one dominates. Desert has sand, sandstone,
  cacti and dead bushes; snowy areas have snow-topped grass and spruce;
  forests mix oak and birch. Grass/leaves/tall-grass are tinted per biome
  from a continuous colormap that blends across borders. Cross-shaped
  plants: tall grass, dandelions, poppies, dead bushes.
- **Caves and ores (M2):** spaghetti caves (intersecting 3D noise tubes —
  VOXELON removed the large open "cheese" caverns), surface ravines, and
  ore veins with vanilla depth rules — coal anywhere, iron below y=72, gold
  below y=32, **redstone and diamond below y=16** (dig down to Y≤16 to find
  diamond).
- **Lighting and day/night (M3):** the real 0-15 light model — column
  skylight attenuated by water/leaves plus BFS flood into overhangs and cave
  mouths, and BFS block light from torches (level 14, floor + wall mounted,
  popping when their support breaks). Light is baked per-face as a vertex
  attribute and combined in the shader as `max(block, sky × sunlight)`
  through vanilla's `0.8^(15-level)` brightness curve, so the whole world
  relights smoothly through the 20-minute day with zero remeshing. Sun and
  moon arc overhead, stars fade in, sky/fog colors run a day-night gradient
  with sunset orange, clouds dim at night.
- **Items and inventory (M4):** blocks drop items (stone → cobblestone,
  ores → coal/redstone/diamond, leaves drop occasional sticks) as spinning
  item entities that scatter, merge, magnet to you and stack into a 36-slot
  inventory. Vanilla inventory UI on E: click/drag stacks, right-click
  split, shift-click move, tooltips, stack counts, item name popups, and a
  first-person held item (a correctly-textured mini-cube) with a swing.
- **Crafting and tools (M5):** 2×2 personal grid, craftable 3×3 crafting
  table, shaped (offset + mirrored) and shapeless recipes: planks, sticks,
  table, torches, furnace, and wood/stone/iron pickaxe/axe/shovel (no
  swords in VOXELON — fists and the axe do combat damage). Vanilla tool
  stats (speed 2/4/6, durability 59/131/250). The furnace is a real block
  entity — input/fuel/output, flame + progress arrows, lit-block light —
  smelting iron/gold ingots, glass, stone, and charcoal. Harvest rules:
  stone needs a pickaxe, iron ore needs stone tier, diamond/gold/redstone
  need iron; wrong/no tool takes `hardness × 5` and drops nothing; tools
  wear out and break.
- **Survival + energy (M6, reworked for VOXELON):** 20 HP with slow passive
  regeneration that pauses for a few seconds after taking damage. Hunger is
  replaced by a blue **energy/stamina** bar that only sprinting consumes —
  a full bar lasts ~30s and refills in ~4s, and once drained you must
  recover past 25% before sprinting again. Fall damage (blocks − 3),
  drowning with a 10-bubble air bar. Vanilla HUD: hearts + energy bar over
  the hotbar, bubbles when submerged, red damage flash with camera tilt, and
  a death screen — items spill where you died, respawn at world spawn.
- **Mobs (M7) — hostile only:** VOXELON removed passive animals. Boxy
  zombies and creepers built from atlas skin tiles, with swinging-limb walk
  cycles and heads that gaze at you. Zombies chase within 16 blocks, melee,
  and burn in daylight; creepers stalk silently, hiss, swell, and detonate a
  real block-destroying explosion that flings you. Vanilla spawning: only
  where block light < 8 and dark/at night, population caps, distance
  despawn, fall-out culling. Knockback, death poofs, particle system;
  explosions batch their block edits into a single remesh.
- **Sound (M8):** every sound is synthesized live with WebAudio — no
  recorded files. Filtered noise bursts give per-material dig/step/place
  sounds; oscillator phrases voice zombie groans and creeper hiss; plus
  hurt, water splash, explosion booms and a cave-ambience pad. Mob and block
  sounds are positional through WebAudio panners with distance falloff.
- **UI:** plus crosshair (difference blending), 9-slot hotbar with isometric
  block icons and white selection outline, item-name popup, F3 overlay.
- **Multiplayer (authoritative-lite):** a Node + WebSocket server
  (`npm run server`) reuses the same deterministic terrain code, so clients
  generate the world locally from a fixed shared seed and only **block edits
  + player state** sync — keeping bandwidth tiny. The server owns the edit
  log, every player's health, username assignment (unique `WordWordNN`), and
  **PvP**: melee hits are validated server-side (range + facing) and damage
  is server-applied, so hits and damage can't be faked. Clients predict their
  own movement and send transforms ~20 Hz; remote players render as boxy
  humanoid avatars with per-username procedural skins, name tags, and
  interpolation. Death/respawn and a kill feed are server-driven. The client
  degrades to offline single-player if no server is reachable.
- **Networked drops + chests:** dropped items are server-owned entities —
  block breaks and **death (drop everything where you fall)** spawn items
  everyone sees, and pickup is server-validated by range (you can't pick up
  while dead, and two players can't grab the same stack). Chests are 27-slot
  storage blocks whose contents the server stores per position and syncs to
  whoever's viewing; breaking one spills its contents to everyone. (Inventory
  and chest contents are client-trusted — consistent with the client-side
  inventory — while world edits, health, PvP, and item entities are
  authoritative.)
- **Armor (M10–M11):** craft iron / diamond / **titanium** sets (helmet,
  chestplate, leggings, boots) — titanium is a new end-game ore that spawns
  only deep under mountains and smelts to titanium ingots. Four equip slots in
  the inventory (right-click an armor item to auto-equip); a vanilla-style armor
  bar over the hearts. Each point blocks 4% of incoming damage (capped at 80%),
  and every worn piece **levels up with XP as you take hits**, gaining extra
  defense over time. In multiplayer the server is authoritative: it clamps your
  synced armor value and mitigates all damage (PvP, mobs, falls) server-side, so
  armor can't be faked.
- **Guns (M12):** a **Pistol** (semi), **Rifle** (full-auto) and **Rocket
  Launcher**, all iron-and-redstone crafts firing **bullets** / **rockets** from
  a magazine you reload with R. Client-simulated projectiles sub-step their
  flight so fast rounds can't tunnel; bullets are point hits, rockets reuse the
  creeper blast on impact. Mob hits resolve locally; **PvP hits are reported to
  the server, which validates range + facing and applies armor-mitigated damage
  + knockback** (it can't verify line-of-sight, matching the authoritative-lite
  model). An ammo counter shows magazine / reserve.
- **Automation (M13):** a resource economy. **Cobalt Ore** (a deep, rare ore,
  rarer than iron, smelts to a **Cobalt Ingot**) and an **oil field** layer
  (low-frequency richness, far denser under deserts and oceans, surfaced as rare
  **Oil Shale** seeps). Two machines run under the never-pausing sim as
  **multi-block, animated structures**: the **Autominer** (a 2-tall rig with a
  spinning drill) drills the column beneath it, banking ore at a rate
  proportional to the local ore richness through a level-gated **ore filter**
  (basic stone/coal/iron → +gold/redstone at L10 → +diamond/titanium at L30);
  the **Oil Derrick** (a 3-tall lattice tower with a rocking pumpjack) pumps
  **Oil Barrels** from the oil field (useless on dry ground). Each occupies a
  real footprint (solid frame cells you can't walk through). Right-click any
  cell to open a UI with an HP bar, owner, storage fill, live rate, the
  ore-filter checklist, **~100 levels** of two upgrade axes (**production**
  rate+tiers, **storage** cap) with **geometric** costs that pull in cobalt the
  machine can't self-produce (so it can't bankroll its own grind), plus
  **Collect** and **Claim** buttons. Machines are **contested**: anyone nearby
  can collect, upgrade, claim, or **sabotage** them — left-clicking a machine
  deals HP damage instead of mining, and destroying one spills its stored loot
  *and* drops the machine block to the raider. The simulation is a pure,
  unit-tested module (`machines.ts`) fed by `Terrain.oreRichness` /
  `oilRichness`, so yields need no loaded chunk: the **server owns** every
  machine (created on the placement edit, ticked in its 1 Hz loop, spilled on
  destroy, collected via the dup-safe item-grant path, range+liveness gated) and
  **offline single-player runs the identical module locally** (the client
  predicts the fill bar and reconciles on open/collect in multiplayer). Oil
  Barrels are the intended fuel currency for a later warfare layer.

## Architecture

```
src/
  main.ts      game loop: streaming budget, camera/FOV, fog (incl. underwater),
               loading + pause overlays, FPS counting
  blocks.ts    block ids, per-face atlas tiles, hardness, shape (cube/cross),
               biome tint kind, replaceability, solidity/opacity
  biomes.ts    climate noise -> biome selection + continuous grass/foliage
               tint colormap (vanilla temp/rainfall style)
  noise.ts     seeded Perlin/value noise, fBm, hashing (zero dependencies)
  textures.ts  procedural 16×16 tile painters -> CanvasTexture atlas
               (~70 tiles: blocks, ores, items, tools, mob skins/faces),
               10 crack stages
  chunk.ts     16×16×256 Uint8Array voxel storage, maxY tracking
  terrain.ts   biome-aware heightmap (fBm + mountain factor), biome/mountain
               surfaces, water fill, three tree species, plants/cacti,
               spaghetti caves, ravines, ore veins (deterministic)
  light.ts     0-15 sky/block light: column skylight + BFS flood (pure;
               exact over a 3x3-chunk window since max travel is 15)
  mesher.ts    culled face meshing with directional shade + vertex AO,
               biome vertex tinting, cross-shape plant quads, torch boxes,
               per-face (sky, block) light attribute, water geometry
  items.ts     item registry (blocks share ids; pure items from 100) +
               vanilla drop table
  inventory.ts 36-slot inventory, stacking, cursor click semantics (pure)
  inventory_ui.ts  inventory panel DOM: drag/split/shift-click, tooltips
  itementity.ts    dropped item entities: physics, merge, magnet pickup;
                   shared mini-block/sprite geometry builder
  icons.ts     hotbar/inventory icon renderer (iso blocks, flat sprites)
  held.ts      first-person held item with swing animation
  crafting.ts  shaped (any offset, mirrored) + shapeless recipe matcher,
               recipe book, craft/consume helpers
  furnace.ts   furnace block entities: smelt/fuel tables, burn + cook
               timers, lit/unlit block swap (feeds the light engine)
  survival.ts  passive health regen (post-damage cooldown) + drowning
               (pure; energy/stamina + fall damage live on Player)
  mobs.ts      boxy zombie/creeper models, wander/gaze/chase/fuse AI, AABB
               physics, melee + knockback combat, sunlight burning,
               creeper explosion (batched edits), light-based spawning
  particles.ts billboard particle bursts: death poofs, explosion smoke
  audio.ts     WebAudio synthesis: material map + noise/oscillator sound
               generators, positional panners (no recorded assets)
  world.ts     chunk map, time-budgeted streaming (data radius = render
               radius + 1 so border AO is correct), edits + neighbor remesh
  player.ts    vanilla-constant physics, axis-separated AABB collision,
               sneak edge protection, swimming
  input.ts     keyboard/mouse/pointer-lock state, double-tap-W sprint
  interact.ts  DDA voxel raycast, hold-to-break with crack stages, placement
               (face-targeted, blocked inside the player), pick block
  sky.ts       square sun, tileable blocky cloud texture anchored to world
  hud.ts       hotbar (isometric icons drawn from the atlas), debug overlay
  net/protocol.ts    wire message types + shared constants + username/skin
  net/server_core.ts pure authoritative GameServer (players, edits, health,
                     PvP, item entities, chest storage — testable, no sockets)
  net/client.ts      browser WebSocket client + offline fallback
  remoteplayers.ts   humanoid avatars: skins, name tags, interpolation, rayHit
  netitems.ts        renders server-owned dropped items + range pickup requests
  chests.ts          chest contents (offline local / MP server-synced)
  projectiles.ts     bullet/rocket simulation: sub-stepped travel, point hits
                     vs blocks/mobs/players, rocket detonation (reuses explosion)
server/
  server.ts    ws transport shell wiring sockets to the GameServer
```

Rendering notes: AO/face shade/tint live in vertex colors; (sky, block)
light levels are a second vertex attribute combined with the day-night
`uSunLight` uniform in a small `onBeforeCompile` shader patch on the shared
`MeshBasicMaterial`s — one opaque pass + one water pass for the whole world,
and time-of-day never forces a remesh. Light is recomputed per chunk at mesh
time over its 3x3 window (exact, since light travels at most 15 blocks).
Only faces exposed to air/transparent blocks are emitted; chunks beyond
`RENDER_DISTANCE` (8) unload. Block edits remesh + relight the affected
chunk (and border neighbors) synchronously.

## Performance

Render distance 8 chunks (17×17 visible area), 60 FPS target. Measured
headless on this machine: ~4.9 ms per chunk for generate+light+mesh (under
the 6 ms/frame streaming budget), ~9 ms per interactive block edit
(remesh + relight). The stated trade-off: an edit on a chunk corner can
touch 4 chunks (~36 ms, one dropped frame); incremental light updates would
fix it and are deferred until it matters.

## Roadmap

The base game shipped eight milestones (biomes, caves/ores, lighting +
day/night, items/inventory, crafting/tools, survival, mobs, sound). The
**VOXELON** revision then: rebranded the game; added a live title-screen
panorama with a Play button; added Mountains / Snowy Mountains with
biome-aware terrain height; removed passive animals (hostile mobs only),
swords, the large "cheese" caverns, and the hunger/food system; replaced
hunger with a sprint **energy** bar and slow passive health regen; and fixed
climbing out of water onto a ledge and the first-person held-block render.

A revision added **multiplayer** (authoritative-lite server, synced block
edits, remote avatars with procedural skins + name tags, unique usernames, and
server-validated PvP with death/respawn and a kill feed), with an offline
fallback when no server is running.

The latest revision tightened the multiplayer feel: it split the title screen
from an Esc **pause menu** and made the simulation **never pause** — mobs,
other players and damage keep running while a menu is open, so you take PvP
knockback with your inventory up; added **chests** (27-slot storage whose
contents the server stores per position and syncs to viewers, spilling to
everyone when broken); made **dropped items server-owned entities** so block
breaks and **death (drop your whole inventory where you fall)** are visible to
all and pickup is server-validated by range and liveness (no picking up while
dead, no two players grabbing one stack); and locked multiplayer to a fixed
shared seed (the `?seed` override now only affects offline worlds).

The newest revision adds the parked combat content: **armor** (iron / diamond /
titanium sets with a new mountain-only titanium ore, four equip slots, a
vanilla armor bar, server-authoritative 4%-per-point mitigation, and per-piece
XP leveling) and **guns** (pistol / rifle / rocket launcher with magazines + R
reload, sub-stepped client projectiles, local mob hits, and server-validated
range + facing PvP).

The latest revision (Beta 1.6) adds the **discovery layer** (Milestone C):
four new biomes — steamy **Jungles** (tall two-canopy trees + jungle planks),
flattened **Swamps** (shallow pools, dead bushes, darker grass and a new Mud
block that slows walking), gentle pink **Cherry Groves** (white-barked cherry
wood, petal-strewn hills), and the **Crystalfields**, a Wilds-EXCLUSIVE biome
of pale ground and glowing crystal spikes that mine into **Crystal Shards**.
A new pure structure framework (`structures.ts`) stamps seeded, deterministic
**surface ruins** into chunk generation exactly like trees (never wider than
3×3 chunks, identical on the server and every client): partly-collapsed
**Watchtowers** (common loot), buried **Bunkers** with a hatch, shaft, carved
basalt room and sometimes a dormant sentry (military loot), and scorched
**Crashed Cargo Pods**, Wilds-biased with the best surface loot — titanium,
gadgets, and RARELY a Heart. Every structure holds a chest whose contents come
from tiered seeded loot tables (`loot.ts`) rolled **on first open** — server-
authoritative online, the identical pure roll offline — after which it's an
ordinary chest (a broken pristine chest still spills its roll; nothing dupes).
Two new hostile mobs join at night: the ranged **Spitter** (keeps its distance,
lobs slow gobs) and the fast, fragile **Skitter** (a lunging chitin scuttler,
Wilds-only) — both with procedural skins and soft synthesized voices.

The revision before (Beta 1.5) grew the world to **5000×5000** with a
claimable **1000×1000 HEARTLAND core** (Milestone B): claims, the war region
board, oil scoring and all spawns stay inside the core (server-validated, with
a friendly client-side message before a Wilds Core placement) while the
**WILDS** outside are pure frontier — no claims or shields, machines/turrets
placeable but unprotected, hostile mobs +50% denser. A soft gold boundary wall
marks the core in-world (the hard cyan border moves to ±2500), the world map
gains a **Heartland ↔ full-world zoom toggle** with HEARTLAND/WILDS labels
(biome bases cached per view; the minimap now caches a sliding window instead
of pre-rendering 5000² terrain), and craftable **Waypoint Totems** (2 gold +
5 planks, glowing) shrink the 2.5 km world: right-click to attune (max 4,
toggle to release, persisted per account), click one on the map to travel —
3 s wind-up interrupted by damage, 60 s cooldown and a 10 s combat tag, all
server-enforced, with a broken totem pruned on use. Full offline parity.

The revision before (Beta 1.4) added **LIFESTEAL** (Milestone A of the
lifesteal-world plan): every player's max health is a currency of **hearts**
(start 10, cap 20, 2 HP each). A **PvP kill steals a heart** (killer +1,
victim −1 — deaths to mobs/falls/lava/unattended turrets move nothing, decided
by a 10 s direct-damager credit window); hitting **0 hearts ELIMINATES** you
for 24 h real time (login refused with a friendly countdown, full-screen
banner, comeback at 5 hearts). Hearts are also an economy: craft a **Heart
item** by bottling one of your own (server-enforced floor of 2 — lootable,
tradeable, raidable), right-click one to grow your max (server-validated cap),
and craft the expensive **Revival Beacon** (titanium + diamonds + a Heart) to
bring an eliminated teammate back early (faction-mates only, server-gated).
The HUD renders max hearts with half-heart granularity (compact "x / N" past
10), with soft steal/loss chirps; the console gains `sethearts` + `revive`;
hearts persist through the account save and the offline localStorage mirror
(no elimination offline).

An earlier revision added the **automation economy** (M13): Cobalt ore, an oil
field, and the server-authoritative **Autominer** / **Oil Derrick** machines —
contested **multi-block, animated structures** with HP/sabotage, ownership/
claiming, a level-gated ore filter, and ~100 levels of geometric-cost
production/storage upgrades, all driven by a pure, unit-tested yield module
mirrored offline — the economic base for the planned warfare layer (missiles,
turrets, drones consuming stored oil/ore).

Verified headless via `npm run smoke` (522 checks incl. biome presence +
Crystalfields core-exclusion, structure/loot determinism + first-open flow,
mud slowdown, the Heartland/Wilds border rules, totem attune/teleport validation, the lifesteal heart
model/steal/elimination/revival/persistence, server-core logic for
edits, PvP, item entities, chests, armor mitigation and ranged PvP, the cobalt/
oil/machine sim, machine HP/sabotage/claim, multi-block footprint teardown, and
server↔offline machine parity, stable across repeated runs), a live two-client
socket test (join, snapshot, edit broadcast, drop/pickup, chest open/set, and
server-authoritative chest break spilling its contents to both players, leave),
`npx tsc`, and a production `npm run build`.

Known simplifications: furnaces and the crafting table show one face on all
sides (no block-orientation metadata yet); machine upgrade cost is paid
client-side (matching the inventory trust model), and machine animated models
are unlit (always full-bright); no shift-click routing into open furnace slots; mobs don't path around obstacles (they step/jump up one block
and otherwise push straight ahead); the held first-person item uses normal
depth testing, so pressing flush against a wall can clip it; inventory, chest
and armor contents are client-trusted (the server clamps your armor value,
owns edits/health/PvP/item-entities, and validates ranged hits by range +
facing but can't verify line-of-sight); rocket and creeper explosions modify
terrain locally only (not synced in multiplayer), and a rocket damages another
player only on a direct hit (no networked splash); and no world saving/loading,
redstone, or Nether.
