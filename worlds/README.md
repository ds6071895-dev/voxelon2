# Worlds

A minigames-only rebuild of VOXELON: **Bedwars**, **Duels**, **The Bridge**,
**Parkour (Dragon Chase)** and **Rat and Seek**.
It uses the same blocks, textures and renderer, but every match runs in its own
separate world (Multiverse-style) instead of an arena stamped into an open
world. VOXELON itself (the parent folder) is untouched and runs on its own
ports.

| | Worlds | VOXELON |
|---|---|---|
| client (Vite) | 5174 | 5173 |
| game server (ws) | 8090 | 8080 |
| accounts file | `worlds-accounts.json` | its own |

## Running

```sh
npm install
npm run server      # game server on :8090 (also serves dist/ when built)
npm run dev         # client on http://localhost:5174
# or, one process for production:
npm run host        # build, then serve client + server from :8090
```

In the server console you can type `status`, `save` or `stop`.

## November 2026 release trailer

`trailer.html` is a standalone cinematic stage using the game's real worlds,
models and title-screen logo. With the dev server running, open
`http://localhost:5174/trailer.html` to preview its nineteen-shot, 80-second edit that shows how each of the five games plays.
It does not need the multiplayer server.

- `npm run trailer:music` composes **Worlds Awaken**, the original epic score.
- `npm run trailer:check` checks camera positions against the authored scenery.
- `npm run trailer` captures the trailer, fourteen screenshots, hero images and
  a thumbnail. Playwright/Chromium and FFmpeg are required for capture.
- `npm run trailer:verify` validates the exported files.

See [`scripts/TRAILER.md`](scripts/TRAILER.md) for setup and capture options.
Current local and full Modal capture defaults use `release-media/revised/`,
with a deliverable-aware gallery at `release-media/revised/index.html`.
The original `release-media/` outputs are historical. The end card says
**November 2026** and has no URL.

The [WORLDS v1.0 release](https://github.com/ds6071895-dev/voxelon2/releases/tag/worlds-v1.0)
contains the finished 94-second trailer, promotional screenshot pack and original
score with stems. Large media is attached to the release rather than Git history.

## How it fits together

- **`src/multiverse.ts`**: a `WorldSpec {id, kind, seed}` names a world, and
  `worldGenerator(spec)` builds its blocks. Every venue sits at its world's
  origin. `WorldBlocks` layers one match's placed and broken blocks over the
  generator.
- **Client**: `World.setGenerator()` swaps worlds when you enter a match or go
  back to the menu. The title backdrop is a separate world instance.
- **Server** (`src/net/server_core.ts`, pure logic; `server/server.ts` is the
  socket layer): one `MatchWorld` per match, created on demand and freed when
  the match closes. There's no cap on how many run at once. Snapshots, edits,
  arrows and hits never cross between worlds.
- **Accounts**: you start as a guest with a generated name. The Account button
  (top right) turns that name into an account or logs into another one.
  Custom names aren't allowed. `NameRegistry` makes sure no two live or
  registered players share a name.
- **Parties**: up to 4 players, 6-character codes from an alphabet with no
  look-alike characters. A code can't be reissued while in use or for
  10 minutes after. The leader picks the game and the party plays privately.
  Size limits: The Bridge 2; Parkour 4 as a party, 2 from the queue;
  Duels 4. Rat and Seek's public queue groups up to four rats with a practice
  seeker; private parties can choose a human seeker. Bedwars has an explicit
  two/three/four-team setup.
- **Parkour is Dragon Chase**: a dragon chases the runners down a course
  that winds through six set pieces (across a village's rooftops, over a gorge
  on rope bridges, across a waterfall canyon on stepping stones, along a
  castle's walls, through great trees, clock towers, an aqueduct, a sky
  galleon, a crystal cavern, a lantern shrine, a mine scaffold, a foundry)
  between the Dragon's Lair and the Sanctuary. Every pad is the top of a real
  build standing on the ground. Everyone has three lives; a
  fall, the dragon's jaws or its fireballs take one, and you come back clear
  ahead of it. Everyone who reaches the end makes it (onto the podium, and
  free to go back to the menu at once); the result lists who made it and who
  fell, in the order they fell. The route is `src/parkour_course.ts`, the
  builds round it `src/parkour_setpieces.ts` (filtered so no build ever
  touches a jump), the dragon's maths `src/parkour_mechanics.ts` and its
  model `src/parkour_dragon.ts`.
- **Practice opponents**: if nobody else is queuing after 10 s, the server
  fills the match with an opponent. It gets a generated name like everyone
  else and nothing on the wire marks it. Its hidden level adapts during the
  match and is remembered per player and game for the next one.

## Bedwars

Protect your team's bed, buy gear at the merchants on your island, and bridge
across the floating islands. Iron and gold come from your home forge, diamonds
from the four side islands, and emeralds from the middle island. While your
bed stands you respawn; once it breaks, your team's next deaths are final.

- **Public queue:** four-island free-for-all. After the ten-second wait, practice
  opponents fill the vacant islands.
- **Private parties:** the leader opens **Bedwars · Choose teams** in the party
  panel or presses the Bedwars card. Choose two, three or four teams and assign
  members to them; unequal teams are supported. Optional opponent fill brings
  each team up to the largest team's size. Every member sees the live team sheet.
- **Resources are items.** Iron, gold, diamonds and emeralds drop from the
  generators as real items that fall, bounce and settle, merge into a pile, and
  go straight into your hotbar when you walk over them (a full hotbar leaves
  them on the ground). There is no separate wallet and no resource HUD.
- **Shopping:** stand near a merchant and press **E** (touch: **USE / SHOP**).
  The shop is a centered window with a translucent scrim, and it
  closes with **Esc**, **E** or when you are hit. The team chest accepts
  deposits and withdrawals.
- **Building:** a placed block shows up at once and a refusal takes it back.
  Hold right-click to bridge. Hold left-click to break placed blocks or an
  exposed enemy bed: a ten-stage crack plays on the block, chips fly off, and
  the block goes into your hotbar. Authored buildings are protected.
- **Fighting:** swings are judged against where the target was a moment ago, so
  a hit you saw lands. Sprinting hits knock back further, falling hits crit,
  and you get a hit marker, damage number and flash on every confirmed hit.
- **Inventory:** nine hotbar slots hold gear, blocks and resources. There is no
  manual item-drop action; generator and death drops remain real world items.
- **Persistence:** armor, tools and team upgrades survive death. Your resources
  go to whoever killed you (anything that does not fit drops where you fell);
  with no killer they drop where you fell, and are lost in the void.
- **Reconnection:** a disconnected player has a 30-second return window in the
  same browser tab. Disconnecting counts as a death.
- **Endgame:** remaining beds disappear at 10 minutes; a shrinking safe zone
  begins at 12 minutes; the match ends by 15 minutes.

The match engine is `src/bedwars.ts` (rules and wire types in
`src/bedwars_rules.ts`, the shop in `src/bedwars_catalog.ts`, hotbar rules in
`src/bedwars_inventory.ts`, item drop physics in `src/bedwars_drops.ts`). The
client is `src/bedwars_client.ts` with `bedwars_hud.ts`, `bedwars_shop.ts`,
`bedwars_results.ts` and `bedwars_world.ts` (items on the ground, projectiles);
styling is `src/styles/bedwars.css`. The map is built by `src/bedwars_setpieces.ts`
with markers in `src/bedwars_map.ts` and furnishings in `src/bedwars_models.ts`.
Item art is in `src/tile_art_bedwars.ts`.

## Tests

```sh
npm test            # Bedwars rules/movement, names, codes, isolation, parties, bots, Dragon Chase
                     # (every jump of every sampled course flown with real physics, builds included)
npm run typecheck   # separate browser-source and Node/test/tool no-emit scopes
npm run test:tooling # capture flags, real logo, gallery fixtures and browser-failure cleanup
npm run test:transport # generated HTTP/WebSocket/account-persistence fixtures
npm run stress      # 300 initial worlds, five modes, actual manor hunting, isolation and teardown
npm run bot-sim     # report-only: Dragon Chase make-it rates, Bridge outcomes and adaptation
STRESS_BEDWARS=1 npm run stress # Bedwars-only worlds and practice opponents
```

Stress uses public pairs for Duels/Bridge/Parkour, four-island Bedwars groups,
explicit rat groups with an AI seeker, and bot-only exhibitions. It separately
reports setup and active hunting tick costs (average, p95 and peak). The average
budget defaults to 50 ms; `STRESS_BUDGET_MS` selects a machine budget,
`STRESS_WORLDS` the initial world count and `STRESS_HUNT_TICKS` the required
hunting sample per manor (100 by default). Legitimate completed matches are
observed through results before destruction. Last-human cleanup and terminal
exhibition cleanup are separate assertions. Controlled-GC heap figures compare
against a warmed-cache baseline and are informational; they do not prove that
shared caches have been reclaimed.

On the cleanup validation machine, the mixed 300-world profile passed its
50-ms average budget; the Bedwars-only 300-world profile exceeded it (80 ms).
`STRESS_BEDWARS=1 STRESS_WORLDS=150 npm run stress` passed at 32 ms. These are
measured capacity profiles, not a guarantee for other machines or workloads.

Browser end-to-end requires a disposable account fixture, matching client/socket
endpoints and explicitly supplied Playwright/Chromium. From Worlds, bundle
`server/server.ts` to `node_modules/.tmp/browser-fixture-server.cjs` with esbuild
(`--bundle --platform=node --format=cjs --external:ws`), make a unique empty
directory under `node_modules/.tmp/`, and launch that bundle directly with the
fixture directory as its CWD and `PORT=8090`. Before account tests, verify that
the launched process owns port 8090 and its account-load log names the fixture's
`worlds-accounts.json`. Start `npm run dev` at Worlds on 5174. Stop both fixture
processes after testing. Production HTTP checks use built/copied `dist` within
the fixture.

```sh
export PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs
export CHROMIUM_PATH=/absolute/path/to/chrome
export TEST_URL=http://localhost:5174 WS_URL=ws://localhost:8090
node test/e2e.mjs
node test/bedwars_e2e.mjs
node test/mobile.mjs  # Node 22+ global WebSocket; all five modes, real touch events
npm run test:ui      # computed cascade, nested sheets, editor, wardrobe and OS comfort
npm run test:offline # five cards twice, all nineteen trailer rigs, non-window resize
```

Browser artifact defaults are Worlds-local `node_modules/.tmp/browser-check/`;
`ARTIFACTS` must point inside Worlds. The dev client's socket port is fixed at
8090; `WS_URL` configures socket peers and cannot reroute the dev browser client.
General E2E defaults to reproducible low graphics for software rendering;
`TEST_GRAPHICS=low|medium|high|ultra|max` selects another preset without changing
event/focus/gameplay behavior. Mobile defaults to low graphics. Its Bedwars flow
uses three ready human peers, forge resources, touch shop purchases, held mining
and cancellation, charged-bow release, server results and touch return-to-menu.
The forge/bow acquisition can take several minutes. `MODES` selects distinct
mobile modes, and rejects unknown/empty selections.

The general suite captures full-size title/party/account flows, then releases
the idle peer renderer and uses 640×480 gameplay viewports. This keeps
shared software-renderer load from starving the real ready barrier. Phone and
short-window layouts have their own captures. Run browser suites serially on
software graphics; use an in-scope source snapshot during concurrent editing
so Vite reloads do not invalidate a match halfway through validation.
It uses a 0.5 device scale for the full CSS viewports, limiting software-GPU
fill rate without changing layout or input coordinates.

`cardart.html` is the separate five-scene card-art stage, served by Vite for capture.
`npm run cards -- --only=bedwars,duels --output=node_modules/.tmp/card-review`
captures selected cards without replacing
published art; the normal cards default is `public/cards/` for intentional art
updates. Icons (`favicon.svg`, `icon-192.png`, `icon-512.png`) and OG art are live
branding assets, retained independently of game-card output. To regenerate them,
render the complete `.w-wordmark svg` from `index.html` on the current light title
background, rasterize at the icon sizes (and the OG image's existing dimensions),
then review those images and manifest/social metadata together. There is currently
no automated icon/OG generator; card capture does not generate these assets.

Diagnostics: `test/parkour_trace.ts` (every life a bot loses on a course) and
`test/bridge_ledger.ts` (who wins Bridge fights and how).
`test/bridge_scenarios.ts` plays the Bridge bot against a scripted player: walls, tunnels,
steps, a flanking bridge, a skybridge overhead and a straight rush (`SKILL=0.55 ONLY=over VERBOSE=1`). `test/legacy_party_bot.ts`
is VOXELON's original bot, kept only so the sim can compare against it.
