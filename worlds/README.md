# Worlds

A minigames-only rebuild of VOXELON: **Bedwars**, **Duels**, **The Bridge**,
**Parkour** and **Rat and Seek**.
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

## Bedwars

Protect your team's bed, buy gear at the merchants on your island, and bridge
across the floating islands. Iron and gold come from your home forge, diamonds
from the four side islands, and emeralds from the middle island. While your
bed stands you respawn; once it breaks, your team's next deaths are final.

- **Public queue:** 1v1, with a practice opponent when the queue is quiet.
- **Private parties:** the leader opens **Bedwars · Choose teams** in the party
  panel or presses the Bedwars card. Two players play 1v1; three play a chosen
  2v1; four play 2v2. A three-player party can add an AI teammate for the solo
  side. The team sheet is a small dialog every member can see live.
- **Resources are items.** Iron, gold, diamonds and emeralds drop from the
  generators as real items that fall, bounce and settle, merge into a pile, and
  go straight into your hotbar when you walk over them (a full hotbar leaves
  them on the ground). There is no separate wallet and no resource HUD.
- **Shopping:** stand near a merchant and press **E** (touch: **USE / SHOP**).
  The shop is a narrow panel on the right edge, it does not dim the game, and it
  closes with **Esc**, **E** or when you are hit. The team chest accepts
  deposits and withdrawals.
- **Building:** a placed block shows up at once and a refusal takes it back.
  Hold right-click to bridge. Hold left-click to break placed blocks or an
  exposed enemy bed: a ten-stage crack plays on the block, chips fly off, and
  the block goes into your hotbar. Authored buildings are protected.
- **Fighting:** swings are judged against where the target was a moment ago, so
  a hit you saw lands. Sprinting hits knock back further, falling hits crit,
  and you get a hit marker, damage number and flash on every confirmed hit.
- **Dropping items:** **Q** throws one item, **Ctrl+Q** the whole stack. Your
  sword stays with you.
- **Persistence:** armor, tools and team upgrades survive death. Your resources
  go to whoever killed you (anything that does not fit drops where you fell);
  with no killer they drop where you fell, and are lost in the void.
- **Reconnection:** a disconnected player has a 30-second return window in the
  same browser tab. Disconnecting counts as a death.
- **Endgame:** remaining beds disappear at 8 minutes; a shrinking safe zone
  begins at 10 minutes; the match ends by 12 minutes.

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
npm run stress      # 300+ live worlds with 300 AI opponents: tick budget, isolation, teardown
npm run bot-sim     # opponent strength: Dragon Chase make-it rates, Bridge bots and adaptation
STRESS_BEDWARS=1 npm run stress # Bedwars-only worlds and practice opponents
```

Browser end-to-end (needs a running client and server, plus any Playwright
install):

```sh
PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs TEST_URL=http://localhost:5174 node test/e2e.mjs
PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs TEST_URL=http://localhost:5174 node test/bedwars_e2e.mjs
```

Diagnostics: `test/parkour_trace.ts` (every life a bot loses on a course) and
`test/bridge_ledger.ts` (who wins Bridge fights and how).
`test/bridge_scenarios.ts` plays the Bridge bot against a scripted player: walls, tunnels,
steps, a flanking bridge, a skybridge overhead and a straight rush (`SKILL=0.55 ONLY=over VERBOSE=1`). `test/legacy_party_bot.ts`
is VOXELON's original bot, kept only so the sim can compare against it.
