# WARZONE (Three.js + TypeScript)

A from-scratch, browser-based voxel survival game built on Three.js — no game
engine, no voxel libraries, no Mojang assets (every texture is drawn
procedurally at startup in the classic 16×16 pixel-art style). Minecraft-style
sandbox survival with a stamina/energy system instead of hunger.

## Run it

```bash
npm install
npm run dev
```

Open the printed URL (default `http://localhost:5173`) in a desktop browser
and press **Play** on the title screen (a live orbiting panorama of the
world). Append `?seed=12345` to the URL for a different world.

Other scripts: `npm run build` (typecheck + production bundle),
`npm run smoke` (headless engine tests: terrain, meshing, raycast, physics,
energy, mobs — 84 checks).

## Controls

| Input | Action |
| --- | --- |
| WASD / mouse | Move / look |
| Space | Jump / swim up; at a water's edge, hold to climb onto the ledge |
| Shift | Sneak (slower, won't fall off edges) |
| Ctrl or double-tap W | Sprint — drains the blue **energy** bar (recharges when you stop) |
| Left click (hold) | Break block (tool-aware speed) / attack mob in crosshair |
| Right click | Place block / open crafting table or furnace |
| Middle click | Select targeted block's hotbar slot |
| 1–9 / scroll | Select hotbar slot |
| E | Open/close inventory (click, right-click split, shift-click) |
| F3 | Debug overlay (FPS, coordinates, facing, target, clock) |
| Esc | Close container / pause (returns to the title menu) |

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
  WARZONE removed the large open "cheese" caverns), surface ravines, and
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
  swords in WARZONE — fists and the axe do combat damage). Vanilla tool
  stats (speed 2/4/6, durability 59/131/250). The furnace is a real block
  entity — input/fuel/output, flame + progress arrows, lit-block light —
  smelting iron/gold ingots, glass, stone, and charcoal. Harvest rules:
  stone needs a pickaxe, iron ore needs stone tier, diamond/gold/redstone
  need iron; wrong/no tool takes `hardness × 5` and drops nothing; tools
  wear out and break.
- **Survival + energy (M6, reworked for WARZONE):** 20 HP with slow passive
  regeneration that pauses for a few seconds after taking damage. Hunger is
  replaced by a blue **energy/stamina** bar that only sprinting consumes —
  a full bar lasts ~30s and refills in ~4s, and once drained you must
  recover past 25% before sprinting again. Fall damage (blocks − 3),
  drowning with a 10-bubble air bar. Vanilla HUD: hearts + energy bar over
  the hotbar, bubbles when submerged, red damage flash with camera tilt, and
  a death screen — items spill where you died, respawn at world spawn.
- **Mobs (M7) — hostile only:** WARZONE removed passive animals. Boxy
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
**WARZONE** revision then: rebranded the game; added a live title-screen
panorama with a Play button; added Mountains / Snowy Mountains with
biome-aware terrain height; removed passive animals (hostile mobs only),
swords, the large "cheese" caverns, and the hunger/food system; replaced
hunger with a sprint **energy** bar and slow passive health regen; and fixed
climbing out of water onto a ledge and the first-person held-block render.

Verified headless via `npm run smoke` (84 checks, stable across repeated
runs) plus `npx tsc` and a production `npm run build`.

Known simplifications: furnaces and the crafting table show one face on all
sides (no block-orientation metadata yet); no shift-click routing into open
furnace slots; mobs don't path around obstacles (they step/jump up one block
and otherwise push straight ahead); the held first-person item uses normal
depth testing, so pressing flush against a wall can clip it; no
saving/loading, redstone, Nether, or multiplayer.
