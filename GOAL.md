You are continuing development of VOXELON, a browser multiplayer voxel PvP game
(Three.js + TypeScript + Vite). A decorative building set (per-wood planks +
slabs + stairs, "M15") already shipped, but slabs/stairs currently **collide as
full 1×1×1 cubes** — they render as half/stepped shapes yet the player stands at
full height and can't walk onto them. Your job: implement **true partial
(shape-aware) collision** for the player, add an **auto-step** so half-blocks and
stairs are walkable, and add **top slabs** (placed in the upper half of a cell) in
addition to the existing bottom slabs. Keep the build green at every step.

## 0. Orient first (the chat starts cold)
- Read `MEMORY.md` in the project memory dir and the `voxelon-warfare-direction`
  memory — they summarize the architecture and the M15 building set.
- Read these files before changing anything: `src/blocks.ts`, `src/mesher.ts`,
  `src/shipmodels.ts`, `src/player.ts`, `src/interact.ts`, `src/items.ts`,
  `src/world.ts`, `src/ships.ts`, `scripts/smoke.ts`.
- Verify the baseline is green: `npx tsc --noEmit`, `npm run smoke`,
  `npm run build`, and that `npm run server` boots.

## 1. Hard constraints (do not violate)
- Stack: Three.js + TS + Vite only. No new deps. All textures stay procedural in
  `src/textures.ts`. Block ids must stay ≤255 (chunk data is a `Uint8Array`).
- Multiplayer is "authoritative-lite": the server (`src/net/server_core.ts`) owns
  edits but collision is **client-side player physics** — this whole task is
  client-side and needs NO protocol changes. The server stores block ids as-is.
- MUST stay green after every stage: `npx tsc --noEmit`, `npm run smoke` (currently
  ~280 checks), `npm run build`, and `npm run server` must still boot. Add smoke
  tests for every new behavior.
- Match the surrounding code style and comment density.

## 2. Current state you're building on (ground truth)
`src/blocks.ts`:
- `BlockShape = 'cube' | 'cross' | 'torch' | 'slab' | 'stairs'`.
- `BlockInfo.facing: number` — stairs facing: `0=N(-Z) 1=E(+X) 2=S(+Z) 3=W(-X)`,
  the tall step is on that side.
- Block ids in use up to 63: `OakSlab=49, BirchSlab=50, SpruceSlab=51` (all
  **bottom** slabs), `OakStairsN=52..OakStairsW=55, BirchStairsN=56..W=59,
  SpruceStairsN=60..W=63`. Helpers: `stairsBaseOf(id)`, `orientStairsForYaw(base,yaw)`.
- `woodSet(name, tile, slabId, stairsBase)` builds the slab + 4 stairs defs;
  slabs/stairs are `solid:true, opaque:false, occludes:false`.

`src/mesher.ts`:
- `SLAB_BOX: Box = [[0,0,0],[1,0.5,1]]` and `stairBoxes(facing): Box[]` return the
  render sub-boxes (bottom slab + top quarter) in **cell-local [0,1] space**, where
  `Box = [[minx,miny,minz],[maxx,maxy,maxz]]`.
- `GeoBuffer.subBox(...)` + exported `subFaceUV(...)` render a partial box with
  per-face tile sub-rect UVs. The per-block loop renders slab/stairs via these
  (no neighbor culling). `src/shipmodels.ts` mirrors this for ship hulls.

`src/player.ts` (the file you'll change most):
- `pos` = feet center; box `0.6×1.8` (`HALF_WIDTH=0.3`, `HEIGHT=1.8`), eye `1.62`/`1.27`.
- `moveAxis(world, axis, amount)` integrates ONE axis, scans the cells overlapping
  the AABB, and **treats every `isSolid` block as a full cube** — it clamps `pos`
  to the cube boundary and `return`s on the first hit. Sets `onGround` when
  `axis===1 && amount<0` hits a floor.
- `moveAxisSneakAware`, `hasSupport`, `ledgeAhead`, `intersectsBlock(bx,by,bz)`
  (full-cube AABB test, used by placement). No auto-step exists today.

`src/interact.ts`:
- `updatePlacing(dt, input, origin, dir)`. Stairs orient via `orientStairsForYaw`.
  Slabs currently just place the bottom-slab block id. `RayHit` (from
  `raycastBlocks`) has `{x,y,z,nx,ny,nz}` — the hit **cell + face normal**, but NOT
  the precise hit point.

## 3. Feature A — a shared, pure "collision/shape boxes" module
Create `src/shapes.ts` (PURE: no THREE, no DOM, no Node) as the single source of
truth for block shapes, so the mesher, ship mesher, AND player physics agree:
- `export type Box = [[number,number,number],[number,number,number]];` (cell-local).
- `export const FULL_BOX: Box = [[0,0,0],[1,1,1]];`
- `export const SLAB_BOTTOM: Box = [[0,0,0],[1,0.5,1]];`
- `export const SLAB_TOP: Box = [[0,0.5,0],[1,1,1]];`
- `export function stairBoxes(facing: number): Box[]` (move it here from `mesher.ts`).
- `export function collisionBoxes(id: number): Box[]` — returns the world-collision
  boxes for a block id in cell-local space:
  - non-solid (`!isSolid(id)`) → `[]`
  - `shape==='slab'` → `[isTopSlab(id) ? SLAB_TOP : SLAB_BOTTOM]`
  - `shape==='stairs'` → `stairBoxes(BLOCKS[id].facing)`
  - everything else solid → `[FULL_BOX]`
- `export function renderBoxes(id): Box[]` (same as collision boxes for these
  shapes) so the mesher uses one definition. Update `src/mesher.ts` and
  `src/shipmodels.ts` to import `SLAB_*`/`stairBoxes`/`renderBoxes` from here
  instead of defining their own. Keep `subFaceUV` where it is (or move it too).
- Re-export the bits `mesher.ts` still needs, or just update imports. Avoid a
  cycle: `shapes.ts` may import from `blocks.ts` only.

## 4. Feature B — top slabs
Add a **top** slab variant per wood (placed in the upper half of a cell):
- `src/blocks.ts`: add `OakSlabTop=64, BirchSlabTop=65, SpruceSlabTop=66`. Extend
  `woodSet` (or add a small helper) to register the top-slab def (same tile, shape
  `'slab'`, solid, non-opaque). Add helpers:
  - `isSlab(id)`, `isTopSlab(id)` (true for the *Top ids), `slabBottomId(id)` /
    `slabTopId(id)` to pair bottom↔top per wood (e.g. via fixed offsets or a table).
- The **item** stays one slab per wood (the existing bottom id, e.g. `OakSlab`);
  top slabs are NOT separate items. `dropFor` for a top slab returns the bottom
  item (mirror how stairs map to their N id). Middle-click pick-block on a top slab
  → bottom slab item (mirror the stairs case in `interact.ts`).
- **Placement (vanilla-like):** in `interact.updatePlacing`, when the held item is
  a slab, choose top vs bottom from where you aimed:
  - Extend `raycastBlocks`/`RayHit` to also return the **hit point** (compute the
    world hit Y from the DDA `t` at the crossing; add `hx,hy,hz` or at least the
    fractional Y within the target face). This is needed to pick top/bottom on a
    SIDE face.
  - Rule: placing on a block's **top face** (`ny>0`) → bottom slab; **bottom face**
    (`ny<0`) → top slab; **side face** → bottom if the hit Y is in the lower half of
    the cell, else top. Pick the matching block id before committing.
  - (OPTIONAL, only if time: clicking a bottom slab with another slab of the same
    wood fuses them into the full planks block. State this is optional and skip if
    it complicates the slice.)
- Render: the slab shape branch in `mesher.ts` and `shipmodels.ts` must pick
  `SLAB_TOP` vs `SLAB_BOTTOM` via `isTopSlab(id)` (use `collisionBoxes`/`renderBoxes`).

## 5. Feature C — shape-aware player collision + auto-step (the core)
Rewrite `src/player.ts` collision to use `collisionBoxes(id)` instead of assuming
full cubes. Keep the existing one-axis-at-a-time integration (y, then x, then z).
- **`moveAxis(world, axis, amount)`**: after moving along the axis, compute the
  player AABB; for every overlapping cell, for every box in `collisionBoxes(id)`
  (translate the cell-local box to world by adding the cell origin), test AABB
  overlap on the OTHER two axes and resolve along `axis` to the box's near face —
  tracking the strongest correction across all boxes/cells (don't early-`return` on
  the first; stairs have 2 boxes and multiple cells can bind). Re-derive `onGround`
  (`axis===1`, moving down, and a box top supported the feet). Standing on a bottom
  slab must settle the feet at `cellY + 0.5`; on a top slab/full block at `cellY+1`.
- **Auto-step** (so slabs/stairs are walkable): add `STEP_HEIGHT = 0.6`. In the
  horizontal move path (`moveAxisSneakAware` or a wrapper), if a horizontal move is
  blocked by a box whose top is within `STEP_HEIGHT` above the feet AND there is
  clear headroom for the full player height at the stepped position, raise `pos.y`
  onto that step and complete the horizontal move (vanilla-style step assist).
  Preserve the existing sneak "don't walk off edges" behavior (`hasSupport`).
- **`intersectsBlock(bx,by,bz)`**: make it shape-aware too (test the player AABB
  against `collisionBoxes` of that cell), so placing a bottom slab at your feet when
  your head is clear is allowed, and machine-footprint/torch checks still behave.
- Re-check `ledgeAhead`/`hasSupport` use `collisionBoxes` (or `isSolid`+box top) so
  swimming-out-onto-a-slab and sneak-edge logic stay correct.
- Performance: `collisionBoxes` is hot — keep it allocation-light (return cached
  constant arrays for the common cases; only stairs build a 2-element array).

## 6. Feature D — keep everything else consistent
- **Ships** (`src/ships.ts`): `deckHeightAt` currently returns `ship.y+topDy+0.5`
  (full-block top). Make it return the **actual top surface** of the top block in a
  column using its collision boxes (a bottom slab deck → top at `ship.y+topDy`,
  i.e. half a block lower). This keeps riders standing at the right height on
  slab/stairs decks. `blockAtWorld` can stay (point test) but consider the box for
  the standing surface only.
- **Mobs** (`src/mobs.ts`): check whether mob ground/step logic assumes full cubes;
  if mobs visibly clip on slabs, apply the same `collisionBoxes` ground test. If
  mob physics is simple enough that it's cosmetic only, note the limitation and move
  on (player correctness is the priority).
- Leave the world mesher's face-culling (`isOpaque`) and AO (`occludesAO`) as-is —
  slabs/stairs are already `opaque:false, occludes:false`.

## 7. Tests (add to `scripts/smoke.ts`)
Add a section covering:
- `collisionBoxes`: full cube → 1 full box; bottom/top slab → the right half box;
  stairs → 2 boxes; non-solid (water/plant/torch) → `[]`.
- Player physics (drive `Player.update` headlessly like the existing energy/regen
  tests): a player falling onto a **bottom slab** rests at `y = cellTop = base+0.5`;
  onto a **top slab**/full block at `base+1`. Walking horizontally into a slab/stair
  **auto-steps up** onto it (final `pos.y` rises by ~0.5 and `onGround` is true).
  Walking into a full 1-block wall (no step room above) is still blocked.
- Top-slab placement mapping: side-face upper-half → top id, lower-half/top-face →
  bottom id; `dropFor(topSlab)` and pick-block map to the bottom item.
- `deckHeightAt` returns the half-lower surface for a bottom-slab-topped ship column.
Keep the existing tests passing (update any that assumed full-cube slab collision).

## 8. Acceptance
- `npx tsc --noEmit` clean; `npm run smoke` all green (incl. new tests);
  `npm run build` succeeds; `npm run server` boots.
- In-game (describe how to verify, you can't run the browser): with the starter kit
  you can place bottom/top slabs and stairs, **walk up** a slab/stair staircase
  without jumping, stand at the correct height on each, and build slab/stair decks
  on a ship that you stand on flush.
- End with a short self-review for: tunneling at high speed (sub-step if needed),
  getting stuck when a slab is placed at your feet, auto-step firing through full
  walls (must not), and slab/stairs collision matching their rendered shape.
- Update the `voxelon-warfare-direction` memory with a brief "M16: partial collision
  + top slabs" note.

Work in small stages (shapes module → top slabs → player collision+step → ships/mobs
→ tests), running `tsc`/`smoke` after each. TEST AT EVERY STEP.
