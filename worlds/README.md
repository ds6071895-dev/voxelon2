# Worlds

A minigames-only rebuild of VOXELON: **Duels**, **The Bridge** and **Parkour**.
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
`http://localhost:5174/trailer.html` to preview its seventeen-shot, 94-second edit.
It does not need the multiplayer server.

- `npm run trailer:music` composes **Worlds Awaken**, the original epic score.
- `npm run trailer:check` checks camera positions against the authored scenery.
- `npm run trailer` captures the trailer, eight screenshots, hero images and
  a thumbnail. Playwright/Chromium and FFmpeg are required for capture.
- `npm run trailer:verify` validates the exported files.

See [`scripts/TRAILER.md`](scripts/TRAILER.md) for setup and capture options.
Generated media lives in `release-media/`, with a gallery at
`release-media/index.html`. The end card says **November 2026** and has no URL.

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
  Duels 4.
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
- **Practice opponents**: if nobody else is queuing after 15 s, the server
  fills the match with an opponent. It gets a generated name like everyone
  else and nothing on the wire marks it. Its hidden level adapts during the
  match and is remembered per player and game for the next one.

## Tests

```sh
npm test            # names, codes, isolation, queue/party sizes, bots, 300 worlds, Dragon Chase
                    # (every jump of every sampled course flown with real physics, builds included)
npm run stress      # 300+ live worlds with 300 AI opponents: tick budget, isolation, teardown
npm run bot-sim     # opponent strength: Dragon Chase make-it rates, Bridge bots and adaptation
```

Browser end-to-end (needs a running client and server, plus any Playwright
install):

```sh
PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs TEST_URL=http://localhost:5174 node test/e2e.mjs
```

Diagnostics: `test/parkour_trace.ts` (every life a bot loses on a course) and
`test/bridge_ledger.ts` (who wins Bridge fights and how).
`test/bridge_scenarios.ts` plays the Bridge bot against a scripted player: walls, tunnels,
steps, a flanking bridge, a skybridge overhead and a straight rush (`SKILL=0.55 ONLY=over VERBOSE=1`). `test/legacy_party_bot.ts`
is VOXELON's original bot, kept only so the sim can compare against it.
