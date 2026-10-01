# WORLDS: migration plan

A new, standalone, **minigames-only** game built in `worlds/`, reusing VOXELON's
engine and textures. The original project (`src/`, `server/`, `index.html`,
`scripts/`, the save files) is **not modified at all**. Both games can run side by
side on different ports.

## Decisions (confirmed by the user)

- **Title layout:** wordmark top-left, three minigame cards stacked beneath it with a
  small Controls link under them; the dressing room fills the right side.
- **Party play:** a party leader's click launches a **private** match of just the
  party (Duels 2–4 FFA, Bridge exactly 2, Parkour 2–4). A party of one uses the
  public queue.
- **Accounts:** fresh start — Worlds has its own `worlds-accounts.json`.

---

## 0. What exists today (survey findings)

| Area | Today in VOXELON | Problem for Worlds |
|---|---|---|
| Minigame placement | Every arena is stamped into the **open world's coordinate space** far past the border (`arena.ts`: Duels band at x=12 288, Bridge/Parkour band at x=262 144), isolated by a shader crop and by message filtering. | Fixed slot counts (`DUEL_ARENA_SLOTS = 96`, `PARTY_ARENA_SLOTS = 96`), so there is a hard cap on simultaneous matches, and isolation depends on a crop. |
| Client world | `World` hard-wires `new Terrain(seed)` and calls `terrain.fill(chunk)` + `terrain.tints()`. | Only needs those 2 calls, so a pluggable generator is a small, clean change. |
| Server bots | Bots already run physics against a **shim** `World` (`edits.get(key) ?? arenaBlockAt(...)`, `server_core.ts:3144/3556`). | This is already a per-world voxel sampler in disguise, and it generalises directly. |
| Server core | One 6 173-line `GameServer`; minigame code is ~1 800 lines woven through open-world code (arena bodies saved and restored, world-scope broadcasts). | The minigame part gets rewritten as a lean server that only runs minigames. |
| Client | `main.ts` is 12 305 lines; ~1 200 of them are minigame-related. | Worlds gets a new, modular client and does not carry the open world. |
| Accounts | Mandatory login before anything; accounts carry faction, warfare, lifesteal and Duels RP. | Worlds is anonymous-first and has no progression. |
| Bots | Bots **announce themselves** (`"Piper [Bot]"`), join after 20 s, and adapt within a narrow band. | Diagnosis is in §6. |

---

## 1. Project layout

```
worlds/
  package.json          own deps (three, ws, vite, typescript), own scripts
  tsconfig.json, vite.config.ts
  index.html            new title screen + in-game HUD markup/CSS
  public/               minigame card art (duels/the-bridge/parkour.webp), icons
  server/server.ts      ws transport shell (sessions, accounts file, tick loop)
  src/
    engine/             rendering + physics copied from VOXELON
                        (blocks, chunk, light, mesher, TEXTURES (byte-identical),
                         noise, shapes, sky, shadows, postfx, player, input,
                         interact, held, remoteplayers, avatartex, character,
                         capes, wardrobe_ui, audio, particles, icons, hud, items…)
                        open-world hooks (traps, machines, vaults, boss music,
                        vehicles, factions) are cut out of the copies
    multiverse/         the new world system (§2)
    games/              duels, bridge, parkour (+ course/scenery/themes), bots
    net/                protocol, client, server core, accounts, parties, queue
    ui/                 title screen, party panel, account dialog, HUD, results
    main.ts             game loop: title ⇄ in-world
  test/                 headless tests + bot simulation harness (worlds-only)
```

- Ports: client `5174`, server `8090`, save file `worlds-accounts.json`. None of
  them collide with VOXELON's `5173` / `8080` / `voxelon-accounts.json`.
- **Textures stay the same.** `textures.ts` (the procedural atlas) and the
  avatar/cape painters are copied verbatim, and the card art is the existing
  `public/minigames/*.webp`.

---

## 2. Multiverse: one world per match

Modelled on PaperMC + Multiverse: every match gets its own **world instance**,
and all of them share one renderer and one texture atlas.

**Shared definitions (`multiverse/`)**
- `WorldGenerator { kind; fill(chunk); tints(x,z); blockAt(x,y,z); bounds; voidY; lighting; sky }`
- Generators: `duelWorld()`, `bridgeWorld()`, `parkourWorld(seed, mode, layout)`,
  plus a decorative `titleWorld()` for the menu backdrop.
- **Every world is authored at the local origin.** No bands, no slots, no
  `minX` offsets, no render crop. Two matches can both be at (0, 140, 0)
  because they are different worlds.

**Server (`WorldManager`)**
- `Map<worldId, MatchWorld>`. Each `MatchWorld` owns:
  - its edit overlay
  - its member set and its game-engine state
  - its bots
  - a voxel sampler (generator + edits), which movement validation and bot
    physics use
- Every broadcast (transforms, edits, hits, events, snapshots) is scoped to a
  world's members. Nothing is global except the title-screen/party channel.
- A world is created on match start and **destroyed** (edits, bots and timers
  freed) when the results screen closes or the last human leaves. IDs are
  monotonic, so there is **no cap** on simultaneous matches.
- Per-tick cost is O(live worlds × members). Heavy work (course generation,
  bot jump planning) is cached per seed.

**Client**
- `World` takes a `WorldGenerator` instead of `Terrain`. When a player enters a
  match, the client disposes the current world's chunks, builds the new world,
  streams chunks around the spawn and reports `worldReady`. The server's
  existing "wait for everyone to load, then count down" barrier is kept.
- Leaving a match swaps back to the title world. Materials, atlas and shaders
  are reused, so a swap costs a chunk rebuild, not a reload.

**Proof of "unlimited, no issues":** a headless stress test runs **300
concurrent bot-vs-bot worlds** (all three modes) and checks:
- every tick stays under budget
- no cross-world leakage of messages or blocks
- memory returns to baseline once the worlds end

---

## 3. Games (ported, not reinvented)

Everything a player can do today in Duels, The Bridge and Parkour keeps working:
- Duels: weapons, medkits, building, respawns, sudden death, kill events
- The Bridge: cages, hatch, Void Cleaver and bow, goals, void-kill credit
- Parkour: replaced on 2026-09-30 by the single Dragon Chase mode (§11).
  Themes, crumble, blink, launch and boost pads and wool bail-outs remain;
  R-to-retry and catch-up checkpoints are gone.

Changes:
- **No ranked, no RP, no ladder, no leaderboard, no flair, and no
  "ranked/unranked" wording anywhere.** `duels_progression.ts` is not ported.
- **Capacities:**
  - Duels: 2 from the queue, up to 4 as a party (unchanged)
  - The Bridge: 2 maximum
  - Parkour: 2 from the queue, **up to 4** as a party (spawn lanes and HUD
    standings extended to 4)
- Bedwars is not carried over. It isn't one of the three cards.

---

## 4. Accounts & names

- On connect the server hands out a **temporary anonymous name** (`WordWordNN`,
  same generator as today). It is unique against every online player **and**
  every registered account.
- The top-right **account chip** shows the current name and a **Log in** button.
  The dialog has two modes:
  - **Sign in** to an existing account
  - **Create account**: keep the current temporary name or roll a new one (still
    no custom usernames), then set a passphrase
- Sessions resume automatically (token in localStorage).
- Name uniqueness is enforced server-side in a single place (the `NameRegistry`):
  - reserved = registered accounts ∪ names in use by live sessions and bots
  - rolls retry until free
  - registering is check-and-claim in one step
- An account stores the name and dressing-room cosmetics. There are no stats
  and no ranks.
- Logging in while in a party updates the name in the party live.

---

## 5. Parties

- The **Party** button (top right, next to the account chip) opens a panel with:
  - **Create party**, which gives a 6-character code from an unambiguous
    alphabet
  - **Join with code**
  - the member list (max **4**) with a leader crown
  - Leave, plus Kick and Promote for the leader
- **Codes never overlap:**
  - a code is drawn from the set of free codes, checked against all live
    parties and re-rolled on collision
  - it is released when the party disbands, and not reissued for 10 minutes so
    a stale code can't land someone in a stranger's party
- Temporary (anonymous) names can create and join parties.
- This replaces "Invite friends". When the **leader** clicks a game card, the
  whole party goes into the match together. The card enforces the size rules:
  The Bridge is disabled with "2 players max" if the party has more than 2.
- The party survives matches: everyone returns to the title screen still
  grouped. A disconnect gets a 30 s grace period before the player is removed.

---

## 6. Matchmaking & bots

**Queue**
- Solo player: click a card to join the public queue, and you are matched
  instantly if someone is waiting.
- After **15 s** with no human, a bot fills the seat. The UI never mentions
  bots or the timer. It only shows "Finding players…" and then "Match found".

**Bots are indistinguishable**
- They get names from the same `WordWordNN` generator (reserved in the
  `NameRegistry`, so they can't collide with real users) and random wardrobe
  cosmetics.
- No `[Bot]` tag. The `bot` flag is stripped from every message the client
  receives.

**Why current bots never beat a strong player**
- Parkour:
  - `PartyBot.parkour` pauses on **every pad** (30–700 ms "think")
  - it walks to a textbook take-off point with 7.5 cm precision, sneaking
    near it, and stops dead before each jump
  - a strong human chains sprint-jumps without stopping, so the bot loses
    time on every pad even at `skill = 1`
- The Bridge:
  - it thinks every 90 ms at best
  - it swings on only 50–95 % of openings
  - its bow cooldown is 5 s+
  - it doesn't use jump-crits or sprint resets
- Adaptation in both modes: it moves at most ±0.14 per 2 s and the long-term
  anchor moves only 12 % per step, so a dominant player runs away with it.

**New adaptive design**
- The hidden skill range is `0.2 – 1.35`:
  - 1.0 is a strong human
  - above 1.0 is "flow": near-frame-perfect execution
- Bots always obey the **same physics, speed, reach and cooldowns** as players,
  so they win on execution and never on speed hacks.
- Parkour:
  - a racing line precomputed per course (every take-off simulated with the
    real `Player` physics)
  - **chained landings→take-offs** with no stop at high skill
  - skill controls hesitation, take-off error and misses on hard jumps
- The Bridge:
  - sprint-reset/W-tap timing, jump-crits, strafing
  - bows at a rival who is bridging, and blocks the lane
  - clutch-blocks, and dives for the goal when the rival is dead or far
  - defends when the rival crosses
  - reaction latency scales with skill
- **Rubber-banding on the outcome, not a notch:**
  - Parkour uses time-to-finish gap in seconds.
  - The Bridge uses goal and kill differential.
  - A continuous controller pulls skill toward "keep it close", so a very good
    player can still lose.
- A **hidden per-player rating** per mode (account, or anonymous session)
  sets where the next bot starts. It is never shown.
- Duels bot: same idea, with its baseline taken from the hidden rating instead
  of RP.
- **Verified by simulation:** a headless harness pits bots against scripted
  expert players (an optimal-line parkour runner, a strong scripted Bridge
  fighter) and against weak ones. Target: the bot wins **35–55 %** at every
  level, instead of 0 % against experts.

---

## 7. Title screen

- The wordmark changes from **VOXELON** to **Worlds**. No season, war or faction
  copy.
- Top-right bar: the **Party** button and the **Account** chip (temporary
  name + Log in).
- Layout: wordmark top-left, the cards stacked under it, Controls under them;
  dressing room on the right. Stacks to one column on phones.
- **Three stacked minigame cards** (Duels, The Bridge, Parkour), each with its
  image, name and a one-line pitch:
  - Clicking a card queues. Clicking it again cancels ("Finding players…").
  - No player counts, no Invite Friends, no ranked text.
- A small **Controls** text link below the cards opens the controls sheet.
- The **dressing room** stays (live character preview, wardrobe, capes),
  reworded from "soldier/kit" to just your look.
- **Player-online counters are removed** everywhere.
- Backdrop: a slow orbit over one of the minigame worlds, rendered by the same
  engine.
- Checked with headless screenshots at 1440×900, 1280×620 and 420×820.

---

## 8. Dropped entirely

Open world and terrain generation, survival, crafting, mobs, factions, war,
seasons, lifesteal, vaults and bosses, machines, traps, turrets, warfare tree,
vehicles, flags, world map, chat commands for those, ranked/RP/ladder/
leaderboard, online counters, invite-link lobbies, Bedwars.

---

## 9. Build order

1. **Scaffold.** Set up `worlds/` package, configs and ports, copy the engine
   and assets, and trim the open-world imports. Target: `tsc` clean and a blank
   world rendering.
2. **Multiverse core.** Pluggable `WorldGenerator`, client world swap, server
   `WorldManager`, new lean protocol.
3. **Games.** Port Duels, The Bridge and Parkour onto per-match worlds, remove
   ranks, apply the new capacities.
4. **Accounts.** Anonymous names, login/register dialog, `NameRegistry`.
5. **Parties.** Codes, panel, leader-launches-match, size rules.
6. **Queue + bots.** 15 s silent fill, disguised identities.
7. **Adaptive bots.** Rewrite, plus the simulation harness and win-rate targets.
8. **Title screen.** Wordmark, cards, Controls link, dressing room, top-right
   bar.
9. **Verification:**
   - `tsc`
   - worlds' own headless tests (isolation, name/code uniqueness, capacities,
     bot win rates, 300-world stress)
   - a real two-browser-client run of each mode, solo and as a party
   - screenshots

VOXELON's own build/smoke suites are **not** run (standing rule). Only `worlds/`
tests are run.

---

## 10. Rat and Seek (added 2026-09-28)

A port of the AutoBox plugin's Rat and Seek (`autobox-plugin-src-2026-09-27.zip`),
the minigame only — no lobby, no host settings. It plays the plugin's Normal
rules: 30 s hide, 4 min hunt, rescues at 3 cheese, all seven twists.

- **Files:** `ratseek_house.ts` (the Crooked Manor, block-for-block), `ratseek_nav.ts`
  (seeker + cat navigation), `ratseek.ts` (server engine), `ratseek_bot.ts` (the
  practice seeker), `ratseek_rules.ts` (shared rules/types), `ratseek_client.ts` +
  `ratseek_models.ts` + `styles/ratseek.css` (client), `tile_art_manor.ts` (all new art).
- **Engine additions:** a `box` block shape (stairs, slabs, lanterns, levers,
  traps) drawn by the mesher and collided exactly by `Player`, so stairs are
  walked up via the normal half-block step; `Player.setBodyScale` (rats are half
  size and fit one-block holes), `speedMult`, `jumpBoost`.
- **Who plays what:** a solo queue waits 15 s like the others; everyone it matches
  (up to 4) is a rat and a practice seeker hunts them. A party leader picks one
  member to seek, or a practice seeker for the whole party.
- **Changes from the plugin:** the villager is the Cheese Exchange (a brass
  machine block); rat classes are remembered between games (localStorage +
  `play.ratClass`); the manor is morning-lit at full brightness; twists are
  weighted by how the rats stand (`ratStanding`): Spotlight much more often while
  they are winning, Ghost Rats much more often while they are losing — never
  announced; Mr. Whiskers (Lazy) is in.
- **Practice seeker:** one hidden level 0.2–1.35 drives every trait; it slides
  each second toward a close game and settles after each match (quick wins make
  it gentler next time), remembered per rat like the other modes' skills.

## 11. Parkour → Dragon Chase (2026-09-30)

The three competitive modes (Sprint Race, Rising Void, Collapse Chase) and the
layout × deck generator are gone. There is one mode: a dragon chases the
runners, everyone has **3 lives**, and it is not a race — **everyone who
reaches the end makes it**. The result lists who made it (finish order, time,
lives left) and who fell, in the order they fell.

- **Course** (`parkour_course.ts`): Dragon's Lair (start) → six set pieces from
  a pool of twelve → the Sanctuary (finish + 4-step podium), in a 96 × 512
  venue. The jump engine (physics budget, overlap and flight-path checks) is
  unchanged; each piece supplies its PATH through its place — a weave back
  and forth across the venue (rooftops, rope bridges, waterfall stones, pond
  stones, trees, clock towers, aqueduct, mine), a castle's wall-walk with
  corner towers, or a long S (galleon, cavern, foundry) — its own decks for
  crossings and links, a rise policy and pad materials. Legs that turn end on
  a broad corner landing; the route stays within 23 blocks of the middle; the
  last piece runs in to the middle so the Sanctuary fits. Every pad keeps the
  column under it clear of the rest of the route. (2026-09-30, after a
  straight-lane version felt like "one lane of boring jumps".)
- **Builds** (`parkour_setpieces.ts`): every pad is the top of something
  standing on the ground — a house under a roof, a trunk under a treetop, a
  rock under a stepping stone, wall under a wall-walk, stilts under a plank —
  driven down to the terrain AFTER all pieces' terrain and scenery are built,
  so nothing floats. Scenery round the route comes in mirrored pairs
  (`Builder.pair`) that are kept or dropped together, so the flanks match
  block for block although the route winds. Every build is filtered against
  the route's boxes (`course.spaces`): nothing solid in or beside a jump, and
  no standable top within 5 blocks of the route between 3 below it and its
  height. The venue is packed as per-column runs (`ParkourVenue`). Decor
  blocks: clay/teal roof tiles, chains (hanging, and `ParkourChainX/Z` strung
  sideways between two posts), crystal cluster, crystal, vines.
- **Dragon** (`parkour_mechanics.ts` maths, `parkour_dragon.ts` client model):
  its position is a course order that starts in the lair, leaves after 7 s,
  speeds up every second, and surges while every runner is far ahead. It
  catches anyone it reaches (or who is close to its head), and lobs fireballs
  (with a ground warning ring) at the rearmost runner in range. Sync is
  `pgDragon` at 5 Hz plus `pgFireball`; the client extrapolates.
- **Rules** (`partygames.ts`): a fall, the jaws or fire each take a life; you
  respawn at your checkpoint, or clear ahead of the dragon if it has passed
  that, with 3 s of protection. Out of lives → free-flying spectator.
  Finishing puts you on the podium. The match ends only when nobody is left
  running (a 20-minute failsafe exists but is never shown). A runner who made
  it may go back to the menu at once: no forfeit, no leave message, and a
  statue keeps them on the podium for everyone else.
- **Checks:** `npm test` flies every jump of 24 sampled courses with the real
  Player against the finished venue, checks the build rule cell by cell, that
  every pad stands on something reaching the ground, that every chain is
  attached along its run, that the flanks mirror, that the route winds, and
  covers lives/respawn/podium/leave/results. `npm run bot-sim` reports make-it
  rates by skill (roughly: casual 1 in 3, regular 3 in 4, strong always).
