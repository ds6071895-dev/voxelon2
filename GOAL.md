# VOXELON — Faction War & Politics: full build

You're working in the VOXELON repo: a browser multiplayer voxel war game.
Stack: Three.js + TypeScript + Vite client; an authoritative-lite Node + `ws`
server. Core pattern: PURE, transport-agnostic logic modules that the server
runs authoritatively AND the client mirrors offline (so single-player matches
multiplayer). No Mojang/external assets — all textures/sounds are procedural.

BEFORE STARTING: read the project memory (MEMORY.md in the Claude project memory
dir) and CLAUDE.md, then skim these files to ground yourself and VERIFY current
names/APIs (they may have shifted): src/teams.ts, src/territory.ts, src/claims.ts,
src/machines.ts, src/terrain.ts, src/net/protocol.ts, src/net/server_core.ts,
src/net/client.ts, src/main.ts, src/inventory.ts, src/items.ts, src/blocks.ts,
src/turrets.ts, src/projectiles.ts, src/mobs.ts, scripts/smoke.ts, server/server.ts.

WORKING AGREEMENT (apply to EVERY phase):
- Build PHASE BY PHASE in the order below. Do not start a phase until the
  previous one is green.
- After each phase: `npx tsc --noEmit` clean, ` smoke
  tests for new pure logic), `npm run build` su
  noUnusedLocals — unused imports are hard errors. Source has multibyte chars, so
  grep with `-a`.
- Everything game-affecting must be SERVER-AUTHORITATIVE with an OFFLINE-parity
  path on the client (follow the existing claim).
- The protocol is additive; extend ClientMsg/Se
- Keep it LOUD and VISUAL (this is for kids): bners
  on big events.
- If a real ambiguity appears, make the sensiblall.

## LOCKED DESIGN

### Factions (2)
- Cut from 3 factions to 2; reuse the two stron
  (e.g. Red + Blue) and remove the 3rd everywhe
- Player PICKS their faction on first login (a title-screen choice), UNLESS one
  side outnumbers the other by >20% — then they
- Faction is LOCKED for the season except via switching (below).
- Friendly fire stays OFF within a faction.

### Map — 50/50 frontline
- Divide the fixed-seed world into a 6×6 grid oregion
  bounds from world coords; put consts/helpers ver
  share them: regionOf(x,z), regionBounds(i), region center, etc.).
- Each region is owned by A, B, or Neutral. SeaA,
  right 3 = B, the middle border contested.
- Each faction has ONE home CAPITAL region (far

### Capturing land — adjacency
- A faction may only capture a region 4-CONNECTED to one it already owns
  (no leapfrogging).
- Each region has a CONTROL POINT at its center. Standing on it fills a capture
  meter; enemy presence contests (tug-of-war / emy
  flips the region. REUSE the territory presencbut
  keyed to regions instead of oil nodes.
- CONNECTIVITY: an owned region only counts/pro that
  faction's capital through owned regions; discutral
  over time.
- The CAPITAL is capturable only once ALL its c
  capturing it = INSTANT season win.
- DEFENDER ADVANTAGE near a capital (slower cap
  regions are hardest and the front stabilizes
- War HUD: a map overlay showing region ownersh
  meters, region counts per faction, and the Commander's rally target. Make it
  pop (faction colors, banner on a capture: "WE

### Bases & shields (remove free claims)
- REMOVE claim-anywhere. A base = a Core block on
  your faction owns, protected by an oil-powereds:
  Claims, MAX_SHIELD_HP, feedOil, damageShield, shieldUp, claimProtected).
- Shield drains oil; feed Oil Barrels to sustai.
- Enemies must own the region OR breach the shield to raid the base.

### Oil economy (remove nodes)
- REMOVE oil control nodes / territory oil inco
- Oil comes only from Oil Derricks (existing ma
- Oil powers: base shields, the faction treasur

### Seasons (1 real month)
- Server-side season timer = 1 month. Season WIthe
  deadline, OR instant win when a faction takes
- RESET on season end: map back to 50/50, all b
  cleared, factions re-pickable, fresh war.
- KEEP across seasons: each player's inventory (DO NOT wipe), account, and a
  permanent "Seasons Won" rank/badge. Persist a

### Politics — the Commander (kid-safe, war-foc
- Each faction elects a COMMANDER WEEKLY. Candidates self-nominate (optional
  PARTY name/banner — cosmetic flavor), one vot
- Commander powers (only over SHARED faction rems):
  - Set the RALLY TARGET: mark a region; teammaombat
    buff while fighting there.
  - Spend the FACTION TREASURY: fund a base shir crate
    at the front), or buy a temporary faction-wide buff.
  - Appoint 1–2 OFFICERS (can also set rally po
- TREASURY fills from a Commander-set 0–25% cut of oil PRODUCTION only (never
  existing stockpiles); players may also donate. This is the only "tax" lever.
- ANTI-GRIEF (hard rules): Commander can't kickmage
  teammates. A RECALL vote (supermajority of thmander
  early. All treasury spends are logged/visible

### Faction switching — secret betrayals
- Switching is SECRET — NO public announcement.ng,
  hidden alliances (this group loves it).
- MAX 2 switches per season, and switching is Lf the
  season.
- On switch you FORFEIT faction perks (treasuryole),
  and you do NOT earn that season's "Won" badgey
  stays meaningful).

### Toys — gadget system + first batch (do LAST
- Build a reusable GADGET system first (equip sowns,
  ammo/crafting), then add these 9:
  1. Frag grenade  2. C4 / breaching charge  3. Grappling hook
  4. Deployable cover  5. Sentry gun (reuse tur
  7. War horn (Commander rally buff)  8. Oil bomb (spends oil)
  9. Spy disguise (look like the enemy faction al
     playstyle).
- Keep all gadgets cosmetic-neutral in power tiseason.

## BUILD ORDER (each phase independently shippa
0. Cut to 2 factions (teams + join/balance logic + remove 3rd everywhere).
1. Region grid + 50/50 init + capitals + factiod-only
   ownership first).
2. Control points + capture meters + adjacency tant-win
   (server-authoritative + offline parity + smo
3. Bases & shields rework (remove free claims; ).
4. Oil cleanup (remove nodes; derricks-only).
5. Seasons (timer, win check, reset, inventory-sistence).
6. Politics (weekly election, Commander powers, treasury + 0–25% oil tax, officers,
   recall).
7. Faction switching / betrayals (secret, max 2 forfeit).
8. Gadget system + the 9 toys.

Confirm the plan, then start at Phase 0. Reportr each
phase and pause if a design question genuinely
