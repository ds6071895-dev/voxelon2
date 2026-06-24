# VOXELON — Factions, Land Claims, Oil-Powered Raiding + Terrain Overhaul

You are continuing development of **VOXELON**, a browser multiplayer voxel PvP
game (Three.js + TypeScript + Vite, authoritative-lite Node+ws server). The
automation + warfare toys already exist (autominers, oil derricks, ships,
cannons, turrets, an oil-node "territory" King-of-the-Hill) but they do **not
form a loop** — territory has no material reward, oil has no real sink, and
there's no reason to attack or defend anything. This epic wires it all into one
connected war economy: **factions → land claims protected by an oil-powered
shield → raiding that steals resources → oil-node territory that fuels and
starves shields.** Plus a terrain pass so the world is worth fighting over.

Build in the milestone order below. **The build MUST stay green after every
milestone** (`npx tsc --noEmit`, `npm run smoke`, `npm run build`, and
`npm run server` boots) and **every new behavior gets smoke tests**.

---

## 0. Orient first (the chat starts cold)
- Read `MEMORY.md` in the project memory dir and the `voxelon-warfare-direction`
  memory (the shipped-feature history + architecture).
- Read before changing anything: `src/net/server_core.ts` (the authority — owns
  edits, machines, ships, turrets, territory, chests; ticks at 1 Hz via
  `server.ts`), `src/net/protocol.ts` (message types + range consts),
  `src/machines.ts` + `src/ships.ts` + `src/turrets.ts` + `src/territory.ts`
  (the PURE server-authoritative modules to mirror in style), `src/world.ts`
  (the `editOverlay` persistent edit record + `getEditedBlock`), `src/terrain.ts`
  (height/biome/caves/ravines/oil-richness), `src/interact.ts`, `src/main.ts`
  (client wiring + HUD), `src/inventory_ui.ts` (machine/turret panels),
  `src/blocks.ts`, `scripts/smoke.ts`.
- Verify the baseline is green before starting.

## 1. Hard constraints (do not violate)
- Stack: Three.js + TS + Vite only. **No new deps.** Textures stay procedural in
  `src/textures.ts`. Block ids ≤255 (chunk data is `Uint8Array`).
- **Authoritative-lite, mirrored offline:** the server (`server_core.ts`) owns
  all team/claim/shield/raid/territory state and validates every action
  (range + liveness + ownership + faction). Put the *rules* in PURE modules
  (no THREE/DOM/Node) — like `machines.ts`/`ships.ts`/`turrets.ts` — so offline
  single-player runs the identical sim. Follow that discipline exactly: a state
  shape, a `tick*(dt)`, `sanitize*` for wire input (fail-closed), a manager class.
- Protocol changes are additive; bump nothing that breaks old messages. Add new
  `t:` variants + include new state in the `welcome` snapshot.
- MUST stay green after every milestone; add smoke tests for every new behavior.
  Match surrounding code style + comment density.

## 2. The design (read this so the pieces cohere)
The loop, in one breath: **derricks make oil → oil powers your Core's shield →
the shield protects your faction's claimed land → enemies raid by out-gunning
the shield's oil-fueled regen (or by seizing the oil-node territory that fuels
it) → a successful raid steals a capped share of your stockpile → you spend oil
+ loot to expand, upgrade, and raid back.** Territory control = map-wide oil
dominance = the win condition that finally means something.

Locked decisions (from design chat):
- **Factions:** a small fixed set of preset teams (start with **3**), auto-
  balanced on join. Friendly-fire OFF within a faction. Machines/turrets/ships/
  claims are **faction-owned** (not per-player).
- **Shield is HP + oil-fueled regen, NOT binary invulnerability.** Fueled =
  tanky (high regen, needs a coordinated assault to crack); unfueled/offline =
  no regen, cracks fast. This is the crux that prevents BOTH offline-immunity
  AND 24/7-invincibility.
- **Raid reward = steal a capped %** of stored resources; the Core is NOT
  destroyed (claims persist), and a **grace period** shields fresh claims.
- Seizing oil-node **territory starves enemy shields** (cuts their fuel income),
  tying the old King-of-the-Hill into the raid loop.

---

## M17 — Factions (the foundation)
Create PURE `src/teams.ts`:
- `export const FACTIONS` = 3 presets `{ id, name, color }` (e.g. Red/Blue/Green
  with distinct hex colors for avatars/HUD/beacons).
- Server (`server_core.ts`) assigns each joining player a faction by **lowest
  population** (auto-balance); store `faction` on the player record; include it
  in `welcome` + `join` so clients can color remote players + nameplates.
- New protocol: player `faction` field everywhere a player is described.
- **Friendly-fire off:** in EVERY server damage path (melee `attack`, ranged
  `rangedAttack`, ship `shipHit`, turret targeting, creeper/explosion PvP) skip
  damage when attacker and victim share a faction. Turret auto-target already
  picks "nearest non-owner"; change to **nearest non-faction** living player.
- Client: tint remote-player skins + nameplates by faction color; small faction
  badge in the HUD.
- Offline SP: single local faction (no friendly targets) — everything still ticks.
- **Tests:** auto-balance spreads N joins across 3 factions; same-faction melee/
  ranged/ship/turret damage is rejected; cross-faction still applies.

## M18 — Land claims + oil-powered shield
New `Block.Core` (next free id; ≤255) + PURE `src/claims.ts`:
- A faction member places a **Core**; it claims the Core's chunk + the 8 adjacent
  chunks (3×3 chunk footprint) for that faction. One Core per claim; reject
  overlapping claims and claiming chunks already owned by another faction.
- `ClaimState { id, faction, cx, cz (core chunk), coreX/Y/Z, oil, shieldHp,
  maxShieldHp, createdAt }`. `maxShieldHp` scales with… keep it simple v1
  (constant + an upgrade axis later).
- **Shield model (the core mechanic):**
  - `shieldHp` regenerates toward `maxShieldHp` **only while `oil > 0`**;
    regen consumes oil per second (`OIL_PER_REGEN`). No oil → no regen.
  - Feed oil into the Core (interact UI) to refill its `oil` buffer (sink for
    `Item.OilBarrel`). Territory income (M20) also tops it up.
  - `shieldUp(claim) = shieldHp > 0`.
- **Protection:** server rejects any enemy `edit` / machine-sabotage / chest-open
  inside a claimed chunk **while that claim's shield is up** (and during the
  fresh-claim **grace period**). Faction members always edit freely. Wire this
  into the existing `edit`/`chestOpen`/`machineHit`/`turretHit` validators.
- `tickClaims(dt)`: regen vs oil drain; expose `shieldHp`/`oil` for HUD.
- Client: shield dome shader/wireframe around an up claim (faction-colored,
  flickers low when near-empty); Core UI ('claim' mode in `inventory_ui.ts`,
  styled to match the new look) — shield bar, oil bar, "feed oil" slot.
- **Tests:** placing a Core claims 3×3 chunks; enemy edit inside an up shield is
  rejected, faction edit allowed; shield regens only while oil>0 and drains oil;
  shield with no oil decays to raidable; grace period blocks early raids.

## M19 — Raiding + stealing (capped %)
- **Breaching:** weapons damage `shieldHp` when they hit inside a claim — extend
  `shipHit` (cannonballs), rocket/`rangedAttack` impacts, and turret-vs-claim so
  enemy fire drains the shield. Damage must out-pace the oil-fueled regen, so a
  fueled base needs a sustained, multi-source assault (this is the anti-24/7
  guarantee). Sabotage (left-click) chips the shield too when it's an enemy claim.
- **Once `shieldHp <= 0`:** enemies can edit/break inside the claim. Breaking a
  faction's **chest or machine** inside a downed claim makes the server spill a
  **capped fraction** (`RAID_STEAL_FRAC`, e.g. 0.5) of the *real stored contents*
  to the raider via the dup-safe `itemspawn`/`gotitem` path; the rest stays.
  The **Core is not destroyed** — the claim persists, so they can re-fuel and
  recover.
- Killfeed/HUD: "RED breached BLUE's claim" events; shield-down warning to the
  owning faction.
- **Tests:** shield blocks theft until `hp<=0`; after breach, breaking a stored
  chest spills exactly the capped fraction (and clears that fraction server-side,
  no dup); fueled shield regen out-paces a single attacker but falls to sustained
  multi-hit fire; Core survives a raid.

## M20 — Wire in oil-node territory (close the loop)
- Reframe `territory.ts` from a standalone score race into **faction oil income**:
  a faction controlling an oil node earns **oil income** that auto-distributes to
  that faction's claims (tops up Core `oil`). Controlling more nodes = tankier,
  longer-lasting shields.
- **Starving:** losing your nodes cuts income → shields eventually dry → you
  become raidable. (Now seizing territory is how you set up a raid.)
- Keep a win/dominance readout (faction holding the most nodes / first to a
  threshold) but make it reflect oil dominance, not an abstract score.
- HUD: per-faction node count + oil income; beacons tinted by controlling faction.
- **Tests:** controlling a node accrues oil to the faction's claim; losing all
  nodes drops income to zero; dominance readout tracks node control by faction.

## M21 — Terrain overhaul (worth fighting over)
Pure changes in `terrain.ts` (deterministic; keep `npm run smoke` determinism +
height-bound tests green — update expectations as needed):
- **Ravines rare:** tighten `ravineDepth`'s trigger band (currently `±0.018` at
  freq `0.006` — far too wide) by ~3× and/or gate on a second low-freq mask so
  ravines are occasional showpieces, not everywhere.
- **Real caves:** replace the thin twin-tube `caves1 ∩ caves2` with a layered
  system: wider connected tunnels + occasional **caverns** (large open rooms via
  a separate low-freq 3D blob threshold), so spelunking goes somewhere. Keep the
  air% smoke test meaningful (tune the bound).
- **Bigger, deeper oceans:** widen ocean basins + deepen them (biome weight /
  height shaping) so ships have room to sail and fight. Re-check `findSpawn`
  still lands on dry land.
- **A couple of genuinely cool biomes** (change the world's *silhouette*, not
  just grass tint). Pick 2 of: **mesa/badlands** (banded sandstone cliffs),
  **volcanic ashlands** (basalt + surface lava — doubles as a PvP hazard),
  **mushroom/fungal**. New `Block`s + procedural `Tile`s as needed (ids ≤255).
- **Tests:** ravines now rarer (sample many columns, assert a low hit rate);
  caverns exist (some large contiguous air pocket appears); oceans are bigger
  (ocean-column fraction up vs before); new biomes generate their signature blocks.

## M22 — UI polish pass (fold in as you build)
- Build the new **Core/claim** UI and any team UI to look modern from the start
  (consistent panel chrome, spacing, faction-colored accents, no chunky text
  shadows — match the cleaned-up menu style already in `index.html`).
- Restyle the existing **autominer / oil derrick / turret** panels in
  `inventory_ui.ts` to that same look (they already function — this is visual).

---

## Acceptance (whole epic)
- After EACH milestone: `npx tsc --noEmit` clean, `npm run smoke` all green
  (incl. new tests), `npm run build` succeeds, `npm run server` boots.
- The loop is demonstrable headlessly via `server_core` tests: a faction claims
  land, its shield holds vs a lone attacker while fueled, falls to sustained
  cross-faction fire or to fuel-starvation, a breach steals a capped share, and
  oil-node control refuels shields.
- Friendly-fire is off within a faction across every damage path.
- Terrain: ravines rare, caves have caverns + connectivity, oceans bigger, ≥2
  new signature biomes.

## Self-review checklist (end of epic)
- No way to be **permanently unraidable** (offline → shield dries; 24/7-fueled →
  still crackable by coordinated fire / territory starvation). Verify both.
- No **dup/loss** in raid stealing (capped fraction leaves storage exactly once).
- No griefing fresh players (grace period) and no infinite-claim spam (overlap
  rejection + oil upkeep cost).
- Offline single-player still works (local faction, all systems tick).
- Update the `voxelon-warfare-direction` memory with the shipped loop.
```
```
NOTE: This is the master spec. Tackle one milestone per focused session; keep
each one green and smoke-tested before moving on.
