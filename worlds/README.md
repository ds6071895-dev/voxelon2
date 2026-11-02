# Worlds

A minigames-only rebuild of VOXELON: **Duels**, **The Bridge**,
**Parkour (Dragon Chase)**, **Rat and Seek**, **Lucky Pillars**, **Disaster City**
and **Party Games**.
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
`http://localhost:5174/trailer.html` to preview its fourteen-shot, 60-second edit of the classic games.
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
  seeker; private parties can choose a human seeker. The vanilla modes support
  parties of up to four players.
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

## Tests

```sh
npm test            # names, codes, isolation, parties, bots, Dragon Chase
                     # (every jump of every sampled course flown with real physics, builds included)
npm run typecheck   # separate browser-source and Node/test/tool no-emit scopes
npm run test:tooling # capture flags, real logo, gallery fixtures and browser-failure cleanup
npm run test:transport # generated HTTP/WebSocket/account-persistence fixtures
npm run stress      # 300 initial worlds, four classic modes, actual manor hunting, isolation and teardown
npm run bot-sim     # report-only: Dragon Chase make-it rates, Bridge outcomes and adaptation
```

Stress uses public pairs for Duels/Bridge/Parkour,
explicit rat groups with an AI seeker, and bot-only exhibitions. It separately
reports setup and active hunting tick costs (average, p95 and peak). The average
budget defaults to 50 ms; `STRESS_BUDGET_MS` selects a machine budget,
`STRESS_WORLDS` the initial world count and `STRESS_HUNT_TICKS` the required
hunting sample per manor (100 by default). Legitimate completed matches are
observed through results before destruction. Last-human cleanup and terminal
exhibition cleanup are separate assertions. Controlled-GC heap figures compare
against a warmed-cache baseline and are informational; they do not prove that
shared caches have been reclaimed.

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
node test/mobile.mjs  # Node 22+ global WebSocket; all four classic modes, real touch events
npm run test:ui      # computed cascade, nested sheets, editor, wardrobe and OS comfort
npm run test:offline # seven cards twice, all fourteen trailer rigs, non-window resize
```

Browser artifact defaults are Worlds-local `node_modules/.tmp/browser-check/`;
`ARTIFACTS` must point inside Worlds. The dev client's socket port is fixed at
8090; `WS_URL` configures socket peers ; use `?ws=<port>` to reroute the dev browser client.
General E2E defaults to reproducible low graphics for software rendering;
`TEST_GRAPHICS=low|medium|high|ultra|max` selects another preset without changing
event/focus/gameplay behavior. Mobile defaults to low graphics. `MODES` selects
distinct mobile modes and rejects unknown/empty selections.

The general suite captures full-size title/party/account flows, then releases
the idle peer renderer and uses 640×480 gameplay viewports. This keeps
shared software-renderer load from starving the real ready barrier. Phone and
short-window layouts have their own captures. Run browser suites serially on
software graphics; use an in-scope source snapshot during concurrent editing
so Vite reloads do not invalidate a match halfway through validation.
It uses a 0.5 device scale for the full CSS viewports, limiting software-GPU
fill rate without changing layout or input coordinates.

`cardart.html` is the separate five-scene card-art stage, served by Vite for capture.
`npm run cards -- --only=minigames,duels --output=node_modules/.tmp/card-review`
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
