# VOXELON — LIFESTEAL WORLD (4 milestones)

Build, in order, four milestones that turn VOXELON into a kid-friendly (7–13)
lifesteal faction game: **(A) Lifesteal + elimination + revival**, **(B) 5000×5000
world with a claimable 1000×1000 core**, **(C) new biomes + surface loot
structures**, **(D) enterable dungeons**. Each milestone must ship playable and
green on its own before the next begins.

---

## Cross-cutting rules (apply to EVERY milestone)

- **Server-authoritative, offline parity.** Every gameplay rule lives in a pure
  module (like `gadgets.ts` / `machines.ts` / `claims.ts`) shared by
  `src/net/server_core.ts` (authoritative online) and the offline client. The
  client only *predicts*; the server's echo wins. Offline single-player must
  keep working for every feature where it makes sense (elimination is
  online-only; hearts HUD, loot, structures, dungeons all work offline).
- **Fail-closed validation.** Every new client→server message gets range checks
  (`fin()`, `nearMachine`-style reach gates), clamping, and dup-safety, in the
  style of existing handlers in `server_core.ts`. Assume a hacked client.
- **Persistence round-trips.** Anything with state must survive
  `GameServer.serialize()/restore()` (world save → `voxelon-world.json`) and,
  for per-player state, `capturePlayerState()` → account `data` blob →
  re-login. Add a smoke check for each round-trip.
- **Smoke tests.** `npm run smoke` (scripts/smoke.ts) currently ~391 checks —
  every new mechanic adds checks (happy path + at least one abuse/rejection
  path). `npx tsc --noEmit` and `npm run build` stay clean.
- **No Mojang assets or names.** All art is procedural in `src/textures.ts`
  (16×16 painters; atlas holds 256 tiles, ~144 used — new `Tile` ids from 145,
  new `Item` ids from 160). All sounds synthesized in `src/audio.ts` (follow
  the soft lowpass-thump recipe — nothing shrill; this is a kids' game).
- **Protocol changes** go in `src/net/protocol.ts` with types on both sides;
  keep messages small and flat like existing ones.
- **Don't regress**: guns/gadgets/machines/turrets/claims/territory/seasons,
  admin console (`give/gamemode/tp/list/save/stop`), roll-username auth,
  world+inventory persistence, glider, held-torch light, panorama title.

---

## Milestone A — LIFESTEAL, ELIMINATION, REVIVAL

The identity mechanic. Pure server + HUD; no worldgen.

### A1. Hearts model (`src/hearts.ts`, new, pure)
- Every player has `hearts` (max-health currency). **Start 10, floor 0, cap 20.**
  1 heart = 2 HP: server `MAX_HEALTH` for a player becomes `hearts * 2`
  (today's MAX_HEALTH=20 ≙ 10 hearts). Health bar / damage / armor math all
  keep working — they just read the per-player max.
- **PvP kill steals a heart**: killer +1 (clamped at 20), victim −1 (clamped
  at 0). ONLY player-vs-player deaths move hearts — deaths to mobs, falls,
  lava, drowning, turrets with no recent player attacker move NOTHING (kids
  must never lose hearts to a zombie). Reuse the existing kill-attribution
  that feeds the killfeed; a "recent damager" window of 30 s decides credit.
- Pure functions: `transferHeart(killer, victim)`, `clampHearts(n)`,
  `maxHealthFor(hearts)`; all smoke-tested including the clamp edges
  (kill at 20 hearts wastes the steal; victim at 1 heart drops to 0 → A2).

### A2. Elimination (server + accounts)
- Hitting **0 hearts eliminates** the player: server records
  `eliminatedUntil = now + 24h` (real wall-clock ms) in the account `data`
  blob (survives restarts via the existing account persistence).
- While eliminated: login is REFUSED with a dedicated `authErr`-style message
  carrying the remaining time; the client login screen shows a friendly
  countdown ("💀 Eliminated — back in 17h 22m"), not a generic error.
- On elimination: broadcast a killfeed line ("☠ Bob was ELIMINATED by Alice")
  + a full-screen banner for the victim before disconnect. Their claim/faction
  membership is untouched (they come back to their stuff).
- Coming back (timer expired or revived): hearts reset to **5** (comeback
  penalty, not a reset to zero progress).
- Server console gets `revive <player>` and `sethearts <player> <n>` commands
  (in `server/server.ts` readline handler, same pattern as `gamemode`).
- Smoke: eliminate → login refused with countdown → `revive` → login OK at 5
  hearts; a mob kill at 1 heart does NOT eliminate.

### A3. Heart items + Revival Beacon (crafting economy)
- **Item.Heart (id 160, Tile 145)**: consumable. Right-click to consume:
  +1 max heart (clamped at 20; server validates + echoes). **Withdrawal**: a
  crafting recipe converts 1 of YOUR hearts into a Heart item (server-side
  check: can't withdraw below 2 hearts). Hearts thus become lootable,
  tradeable, raidable — they drop on death like other inventory.
- **Item.RevivalBeacon (id 161, Tile 146)**: expensive craft (e.g. 4 titanium
  ingots + 2 diamonds + 1 Heart). Using it opens a simple picker of eliminated
  faction-mates (server supplies the list); consuming it clears the target's
  `eliminatedUntil` immediately. Notice both sides ("You revived Bob!" /
  Bob's next login: "Alice revived you!"). Faction-mates only.
- Sprites: heart = chunky rounded pixel heart with a highlight; beacon = a
  gold/emerald totem. Follow the new hand-drawn gadget sprite style.
- Smoke: withdraw floor at 2, consume cap at 20, beacon revives + is consumed,
  beacon on a non-eliminated / non-faction target is rejected.

### A4. HUD + presentation
- Replace the health row with **heart icons** (half-heart granularity) — the
  count visibly grows past 10; above ~10 render compactly ("❤ × 14" style)
  so 20 hearts doesn't overflow the HUD.
- Kill toast for the killer: "+1 ❤ (stole from Bob)". Loss toast for the
  victim on respawn: "−1 ❤". Distinct soft sounds for steal/loss
  (audio.ts recipe: warm triangle up-chirp / down-chirp, LOW gain).
- Offline mode: hearts display and Heart items work locally (localStorage
  mirror like inventory); no elimination offline.

---

## Milestone B — 5000×5000 WORLD, CLAIMABLE CORE, TRAVEL

Foundation for C and D. The world grows; society stays concentrated.

### B1. Border constants (`src/net/protocol.ts`)
- `WORLD_BORDER 1000 → 5000` (`WORLD_HALF` 2500). New `CORE_BORDER = 1000`,
  `CORE_HALF = 500`, exported beside them.
- Physical border walls (the 4 translucent cyan meshes) move to ±2500.
  Add a **second, subtler wall/ring visual at ±500** (faction-gold tint,
  lower opacity) so the core boundary is legible in-world; label it on the
  world map ("HEARTLAND" inside, "WILDS" outside).
- Server + client movement clamps use the new WORLD_HALF (they already read
  the constant — verify nothing hardcodes 500/1000).

### B2. Core-only society rules (server-validated + client-messaged)
- **Claims** (`claims.ts` / server handlers): placing a `Block.Core` outside
  the core square is rejected server-side; client shows "Claims only work in
  the Heartland (inner 1000×1000)" BEFORE letting the player place, so kids
  aren't confused by silent failure.
- **War regions / territory / oil nodes / season scoring** stay defined over
  the core square only (`regions.ts` `regionOf`/`regionCenter` — verify their
  math still maps the core, not the whole 5000 world).
- **Spawns** (`randomDrySpawn`, respawn, starter flow) stay inside the core.
- The Wilds (outside core): no claims, no shields, no territory — pure risk.
  Machines/turrets MAY be placed there (raidable, unprotected loot piñatas —
  that's the point). Mobs spawn slightly denser in the Wilds (+50%).
- Smoke: core-edge claim accepted at x=±(500−ε), rejected at x=±(500+ε);
  spawn never lands outside the core; oil nodes all within core.

### B3. Map + minimap scaling
- `worldmap.ts` / `minimap.ts`: verify rendering at 5000 — the full map
  should show the whole world with the core square outlined; add a zoom
  toggle (full world ↔ core) if a single view gets unreadably dense.
  Terrain sampling for the map must stay off the hot path (precompute /
  cache per-region colors; do NOT sample every block of a 5000² world).

### B4. Waypoint Totems (travel — the world is now 2.5 km to the edge)
- **Block.WaypointTotem** (new block + Item id 162, Tiles 147/148 side/top):
  craftable (mid-cost: gold + planks). Place it anywhere; right-click to
  **attune** (per-player, max 4 attuned totems; server stores per-account).
- Teleport: open the world map, click an attuned totem marker → 3 s wind-up
  (interrupted by damage) → teleport, **60 s cooldown**. Server-side: the
  totem block must still exist at the target, target position streams in
  with the pendingTeleport bubble (already built — reuse `onTeleport`
  plumbing + `pendingTeleport` freeze in `main.ts`).
- Anti-abuse: no teleport while in combat (took player damage in the last
  30 s); no teleport INTO the core from the Wilds while your faction's
  claim is under attack (optional, note as TODO if fiddly).
- Smoke: attune cap 4, teleport to a broken totem rejected, cooldown
  enforced server-side, combat-tag blocks the port.

### B5. Performance / persistence sanity
- Chunk streaming is on-demand so the world size itself is free, but VERIFY:
  world save file only stores touched chunks/edits (it does — edit overlay),
  and the map screen doesn't iterate the full 5000² area anywhere.

---

## Milestone C — BIOMES + SURFACE STRUCTURES + LOOT

The discovery layer. Everything deterministic from the world seed.

### C1. Four new biomes (`src/biomes.ts` enum ids 11–14, `terrain.ts`)
Placement rule: **Jungle/Swamp/CherryGrove can appear anywhere; Crystalfields
ONLY in the Wilds** (outside the core) so the far world has an exclusive draw.
- **Jungle (11)**: tall 2-leaf-canopy trees (new `JungleLog`/`JungleLeaves`
  blocks + planks recipe wired into crafting like birch/spruce), dense tall
  grass, vines cosmetic optional. Ground: grass.
- **Swamp (12)**: near-water-level terrain with scattered shallow pools,
  darker grass tint (mesher color multiply like grass), dead bushes, mud
  block (new, slows walking slightly — `player.ts` ground-material hook).
- **CherryGrove (13)**: gentle hills, pink-leaf trees (`CherryLeaves`, pink
  colored-leaf painter + `CherryLog` white-barked), petal tall-grass variant.
  Purely pretty — this is the screenshot biome; kids build here.
- **Crystalfields (14, Wilds-only)**: pale ground, scattered glowing crystal
  spikes (new `CrystalBlock`, emissive like torches, mineable → `CrystalShard`
  item used in D loot/recipes + as the Revival Beacon's cost upgrade).
- Each biome: `materialOf()` sound mapping, minimap/worldmap color, biome
  selection woven into the existing temperature/moisture noise in
  `terrain.ts` (same style as Mesa/Ashlands), smoke checks that seeds
  produce each biome somewhere and Crystalfields never inside the core.

### C2. Structure framework (`src/structures.ts`, new, pure)
- Deterministic per-chunk placement: `structureAt(seed, cx, cz)` hashes chunk
  coords → occasional structure anchor (spacing: rough 1 per ~40×40 chunks,
  denser in the Wilds). Structures are **block stamps** applied during chunk
  terrain fill (same hook style as trees) — never post-hoc edits, never
  cross more than a 3×3 chunk footprint, always self-contained + seeded.
- The server must agree: structure placement derives ONLY from the world
  seed (server and offline client both compute it — same as terrain).

### C3. Three structure types (each with a loot chest)
- **Ruined Watchtower** (any biome): 8–12 tall cobble/plank tower, partly
  collapsed, chest at top. Common loot.
- **Bunker** (plains/desert/snow): surface hatch + 1-room interior carved
  below with machine-frame walls, chest + sometimes a dormant sentry. Better
  loot: ammo, gadget, occasional gun.
- **Crashed Cargo Pod** (Wilds-biased): scorched crater + broken pod shell,
  chest with the best surface loot: titanium, gadgets, RARELY a Heart item.
- **Loot tables** (`src/loot.ts`, new, pure): seeded rolls, tiered
  common/rare/epic pools; a chest's contents are generated ON FIRST OPEN
  (server-side online, local offline) from `hash(worldSeed, x, y, z)` so
  they're identical online/offline and not duplicable. After first open they
  are normal chests (existing chest plumbing owns them).
- Smoke: same seed → same structure positions + same first-open loot;
  structures never overlap a claim core spawn; loot table odds sum sanely.

### C4. Two new mobs (`src/mobs.ts` — the framework exists, zombies are lonely)
- **Spitter** (ranged): lobs a slow projectile (reuse projectile plumbing),
  keeps distance, low HP. Spawns at night + always in dungeons.
- **Skitter** (fast melee): low HP, high speed, lunge attack, dies to one
  good sword hit — panic fun, not frustration. Wilds + dungeons.
- Both: procedural skins in textures.ts (`paintSkin`/`paintFace` family),
  soft synthesized voices, XP/drops modest. Server-authoritative like
  existing mobs. Keep the spawn cap sane (kids' machines melt with 50 mobs).

---

## Milestone D — DUNGEONS

Enterable, guarded, per-player-lootable. Builds on C's structures + mobs + loot.

### D1. Dungeon generation (`structures.ts` extension)
- **Vaults**: underground complexes seeded like structures but rarer
  (~1 per 100×100 chunks; ~12–20 in the core, ~60+ in the Wilds). Surface
  marker: a distinct ruined entrance (stone arch + torch pair) with a
  visible shaft down.
- Layout: 4–8 carved rooms (corridor graph from the seed hash — keep it a
  simple template set, not a maze generator: entrance hall → 2–4 side rooms
  → boss room), walls of a new **`VaultBrick`** block (high hardness so kids
  fight through the door, not the wall; NOT unbreakable — diamond-pick tier).
- **Tiers by distance from origin**: T1 (core) → T3 (outer Wilds). Tier sets
  room count, guard density, and loot table.

### D2. Guards + boss
- Rooms contain **spawn anchors**: while a player is inside the vault bounds,
  anchors keep the room populated (Spitters + Skitters + zombies; T3 adds
  armored variants = same mobs with more HP + a tinted skin) up to a per-room
  cap. Anchors go dormant when the room is cleared and **recharge on a 30 min
  server clock** (the "guard respawn cooldown").
- **Boss room**: one **Vault Brute** — a big slow zombie variant (2× model
  scale, heavy HP, telegraphed lunge) guarding the loot room. Server-side HP
  like machine sabotage; all present players' hits count.

### D3. Per-player loot (the design centerpiece — no husk dungeons)
- The boss room holds a **`VaultChest`** (new block): opening it rolls loot
  from the tier's table **per player** — server tracks `openedBy` (account
  ids) per vault chest (persisted in the world save). A player can loot each
  vault ONCE; the chest visually sparkles if YOU haven't opened it yet
  (client tint from a `vaultchest` state message).
- Loot by tier: T1 iron/ammo/gadgets, T2 titanium/guns/CrystalShards,
  T3 GUARANTEED Heart item + epic pool (best guns, Revival Beacon parts).
- Anti-abuse: opening requires the boss dead within the last 10 min
  (server-checked), reach-gated, eliminated accounts can't be beacon-revived
  INTO a vault (spawn point unaffected — trivially true, just don't add it).
- Smoke: per-player once-only enforced across serialize/restore; second
  player still gets loot; boss-alive open rejected; tier tables differ.

### D4. Presentation
- Entering a vault (crossing its bounds): music sting (low synth pad),
  "☠ VAULT — Tier II" banner, minimap dims. Beating the boss: triumphant
  chirp + "VAULT CLEARED!" + killfeed line so the server sees dungeon fame.
- World map: attuned-style icon appears for vaults you've DISCOVERED
  (entered once), tier-labeled — collection pressure ("3/12 vaults found").

---

## Ship checklist (every milestone)
1. `npx tsc --noEmit` clean, `npm run build` clean, `npm run smoke` all green
   (with the new checks listed above added).
2. Verify ONLINE over a real ws pair (`npm run host` + a second client) for:
   heart steal on a real PvP kill, elimination login-refusal, totem teleport
   (with the chunk-streaming freeze), structure/loot determinism between two
   clients, vault per-player loot.
3. Verify OFFLINE parity: structures/biomes/dungeons/loot identical for the
   same seed; hearts HUD functional; no elimination.
4. Update README feature list; bump the version line in the title screen.
