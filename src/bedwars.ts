// Pure, shared Bedwars domain model. Like `duels.ts`, this file has no DOM,
// THREE or Node dependency and takes every clock as a `now: number`, so the
// browser, the authoritative server and the smoke tests run identical geometry,
// combat math and state transitions.
//
// UNRANKED BY CONSTRUCTION: this module deliberately does not import
// `duels_progression`. Bedwars awards no rank points and never touches the
// Duels ladder. If ranking is ever wanted it needs its own ladder, not the RP
// pool — see the note in the state machine's `finish`.

import { Block } from './blocks';
import { Item } from './items';

// ── Geometry ───────────────────────────────────────────────────────────────

export const BEDWARS_BASE_X = 65_536;
export const BEDWARS_SLOT_SPACING = 1024;
export const BEDWARS_ARENA_SIZE = 96;
/** Island top surface. Everything authored sits on or below this row. */
export const BEDWARS_FLOOR_Y = 140;
/** Below this y is a death, not a clamp. The whole mode is the void. */
export const BEDWARS_VOID_Y = 118;
/** Build limit. No infinite sky-basing. */
export const BEDWARS_CEILING_Y = 200;
/** Matches Duels, so the existing pvp_feedback tuning carries over unchanged. */
export const BEDWARS_MAX_HEALTH = 40;
export const BEDWARS_HP_PER_HEART = 4;
/** A duskier ambient floor than Duels' 0.8 — sky islands at last light. */
export const BEDWARS_AMBIENT_LIGHT = 0.55;
/** Terrain stamps only this band. Nothing at all exists below 128, so falling
 *  off is a genuine 22-block drop to the kill plane rather than a trapdoor. */
export const BEDWARS_STAMP_MIN_Y = 128;
export const BEDWARS_STAMP_MAX_Y = 200;

export interface BwVec3 { x: number; y: number; z: number }

export interface BwFixture {
  /** Local footprint coordinates, 0..BEDWARS_ARENA_SIZE. */
  x: number;
  z: number;
  /** Owning team index, or -1 for a contested/neutral fixture. */
  team: number;
}

export interface BwIsland {
  x: number;
  z: number;
  /** Octagon radius in cells. */
  radius: number;
  /** Rows of body below the top surface. */
  thickness: number;
  /** Owning team, or -1 for mid/side islands. */
  team: number;
  kind: 'base' | 'mid' | 'side';
}

export interface BwMapDef {
  id: string;
  label: string;
  teams: number;
  teamSize: number;
  islands: readonly BwIsland[];
  beds: readonly (BwFixture & { axis: 'x' | 'z' })[];
  teamGens: readonly BwFixture[];
  diamondGens: readonly BwFixture[];
  shops: readonly BwFixture[];
  spawns: readonly (BwFixture & { yaw: number })[];
}

export interface BwArenaBounds {
  slot: number;
  mapId: string;
  teams: number;
  originX: number;
  originZ: number;
  minX: number; maxX: number;
  minY: number; maxY: number;
  minZ: number; maxZ: number;
  floor: number;
  ceiling: number;
  voidY: number;
  /** World-space spawn per team index. */
  spawns: (BwVec3 & { yaw: number; team: number })[];
}

/**
 * 180-degree rotation about the arena's symmetry axis.
 *
 * The axis is the CELL-48 column, i.e. world `origin + 48.5`, not `SIZE / 2`.
 * That is what lets an island with an integer centre (mid, at 48) map to
 * itself: `96 - 48 = 48`. The cost is that column 0 has no partner, which is
 * fine — it is empty void in every authored map.
 */
export const BEDWARS_CENTER = BEDWARS_ARENA_SIZE / 2 + 0.5; // 48.5

function rot(x: number, z: number): [number, number] {
  return [BEDWARS_ARENA_SIZE - x, BEDWARS_ARENA_SIZE - z];
}
function mirrorFixture<T extends BwFixture>(f: T, team: number): T {
  const [x, z] = rot(f.x, f.z);
  return { ...f, x, z, team };
}
/**
 * A bed is TWO cells, anchored at one of them and extending +1 along its axis.
 * Rotating the anchor alone would extend the mirrored bed the same way and put
 * its far cell one block off parity, so the mirror anchors on the rotation of
 * the FAR cell instead. (This is exactly the bug the symmetry smoke check
 * exists to catch.)
 */
function mirrorBed(
  bed: BwFixture & { axis: 'x' | 'z' }, team: number,
): BwFixture & { axis: 'x' | 'z' } {
  const farX = bed.axis === 'x' ? bed.x + 1 : bed.x;
  const farZ = bed.axis === 'z' ? bed.z + 1 : bed.z;
  const [x, z] = rot(farX, farZ);
  return { ...bed, x, z, team };
}

const SKYFORGE_BASE_A = { x: 19, z: 48 };
const SKYFORGE_MID = { x: 48, z: 48 };

const bedA: BwFixture & { axis: 'x' | 'z' } = { x: 15, z: 48, team: 0, axis: 'z' };
const genA: BwFixture = { x: 22, z: 48, team: 0 };
const shopA: BwFixture = { x: 19, z: 44, team: 0 };
const spawnA: BwFixture & { yaw: number } = { x: 17, z: 48, team: 0, yaw: -Math.PI / 2 };

/**
 * Skyforge — the 1v1 map.
 *
 * Two team islands on the x axis, one contested mid island between them, and
 * two small side islands giving a diagonal flank. Base edge to mid edge is
 * FOURTEEN blocks of open void: long enough that being knocked off it is a
 * disaster, short enough that an early rush is a real option.
 *
 * A 4-team map is one more entry in BEDWARS_MAPS with `teams: 4`. No geometry
 * code changes, because the layout is data.
 */
const SKYFORGE_1V1: BwMapDef = {
  id: 'skyforge_1v1',
  label: 'Skyforge',
  teams: 2,
  teamSize: 1,
  islands: [
    { ...SKYFORGE_BASE_A, radius: 7, thickness: 4, team: 0, kind: 'base' },
    { x: rot(SKYFORGE_BASE_A.x, SKYFORGE_BASE_A.z)[0], z: rot(SKYFORGE_BASE_A.x, SKYFORGE_BASE_A.z)[1],
      radius: 7, thickness: 4, team: 1, kind: 'base' },
    { ...SKYFORGE_MID, radius: 7, thickness: 5, team: -1, kind: 'mid' },
    { x: 48, z: 30, radius: 3, thickness: 3, team: -1, kind: 'side' },
    { x: 48, z: 66, radius: 3, thickness: 3, team: -1, kind: 'side' },
  ],
  beds: [bedA, mirrorBed(bedA, 1)],
  teamGens: [genA, mirrorFixture(genA, 1)],
  // Two diamond generators at mid, each the other's rotation. Contesting the
  // middle is the point, so they sit apart rather than stacked on the centre.
  diamondGens: [{ x: 48, z: 44, team: -1 }, { x: 48, z: 52, team: -1 }],
  shops: [shopA, mirrorFixture(shopA, 1)],
  spawns: [spawnA, { ...mirrorFixture(spawnA, 1), yaw: Math.PI / 2 }],
};

export const BEDWARS_MAPS: Record<string, BwMapDef> = {
  [SKYFORGE_1V1.id]: SKYFORGE_1V1,
};
export const BEDWARS_DEFAULT_MAP = SKYFORGE_1V1.id;

export function bedwarsMap(mapId?: string): BwMapDef {
  return BEDWARS_MAPS[mapId ?? BEDWARS_DEFAULT_MAP] ?? BEDWARS_MAPS[BEDWARS_DEFAULT_MAP];
}

// ── Authored role map ──────────────────────────────────────────────────────
// Rasterised once per map, exactly like `buildDuelArenaMap`. Two flat arrays
// over the footprint: column thickness (0 = void) and column role. Everything
// downstream — the terrain stamp, collision, the client's build rules — reads
// these, so there is one source of truth for "what is here".

const enum BwCell {
  Void, BaseTop, BaseBody, MidTop, MidBody, SideTop, SideBody, Rim,
}

/** Fixtures sit one row ABOVE the surface, so they are separate from the
 *  column map and can be looked up without disturbing it. */
const enum BwFix {
  None, BedA, BedB, GenA, GenB, GenDiamond, ShopA, ShopB,
}

interface BwArenaMap {
  /** Rows of solid below and including the surface. 0 = open void. */
  thickness: Uint8Array;
  role: Uint8Array;
  fixture: Uint8Array;
}

const arenaMapCache = new Map<string, BwArenaMap>();

/** Octagon test: a square with its corners cut, which reads as a round island
 *  without a circle's ragged single-cell fringe. */
function inOctagon(dx: number, dz: number, radius: number): boolean {
  const ax = Math.abs(dx), az = Math.abs(dz);
  return ax <= radius && az <= radius && ax + az <= Math.ceil(radius * 1.45);
}

function buildArenaMap(def: BwMapDef): BwArenaMap {
  const n = BEDWARS_ARENA_SIZE;
  const thickness = new Uint8Array(n * n);
  const role = new Uint8Array(n * n);
  const fixture = new Uint8Array(n * n);

  for (const island of def.islands) {
    const top = island.kind === 'base' ? BwCell.BaseTop
      : island.kind === 'mid' ? BwCell.MidTop : BwCell.SideTop;
    const body = island.kind === 'base' ? BwCell.BaseBody
      : island.kind === 'mid' ? BwCell.MidBody : BwCell.SideBody;
    for (let lz = 0; lz < n; lz++) {
      for (let lx = 0; lx < n; lx++) {
        const dx = lx - island.x, dz = lz - island.z;
        if (!inOctagon(dx, dz, island.radius)) continue;
        const cell = lz * n + lx;
        // Islands never overlap in an authored map, but if one ever did, the
        // THICKER column wins so a base cannot be hollowed by a later entry.
        if (thickness[cell] >= island.thickness) continue;
        thickness[cell] = island.thickness;
        // The outermost ring is the glowing Void Rim, so the edge of a sky
        // island is legible from across the map and from above.
        role[cell] = inOctagon(dx, dz, island.radius - 1) ? top : BwCell.Rim;
        // Body role is implied by the top role; store it for the y lookup.
        if (role[cell] !== BwCell.Rim) role[cell] = top;
        void body;
      }
    }
  }

  const put = (f: BwFixture, kind: BwFix): void => {
    const lx = Math.floor(f.x), lz = Math.floor(f.z);
    if (lx < 0 || lx >= n || lz < 0 || lz >= n) return;
    fixture[lz * n + lx] = kind;
  };
  for (const bed of def.beds) {
    const kind = bed.team === 0 ? BwFix.BedA : BwFix.BedB;
    put(bed, kind);
    // A bed is two cells. Both carry the same id; breaking either destroys both.
    put({ ...bed, x: bed.axis === 'x' ? bed.x + 1 : bed.x, z: bed.axis === 'z' ? bed.z + 1 : bed.z }, kind);
  }
  for (const gen of def.teamGens) put(gen, gen.team === 0 ? BwFix.GenA : BwFix.GenB);
  for (const gen of def.diamondGens) put(gen, BwFix.GenDiamond);
  for (const shop of def.shops) put(shop, shop.team === 0 ? BwFix.ShopA : BwFix.ShopB);

  return { thickness, role, fixture };
}

function arenaMap(mapId: string): BwArenaMap {
  let cached = arenaMapCache.get(mapId);
  if (!cached) {
    cached = buildArenaMap(bedwarsMap(mapId));
    arenaMapCache.set(mapId, cached);
  }
  return cached;
}

const TOP_BLOCK: Record<number, number> = {
  [BwCell.BaseTop]: Block.SpectralMarble,
  [BwCell.MidTop]: Block.PearlTile,
  [BwCell.SideTop]: Block.LuminousLimestone,
  [BwCell.Rim]: Block.ArenaRim,
};
const BODY_BLOCK: Record<number, number> = {
  [BwCell.BaseTop]: Block.IvoryColumn,
  [BwCell.MidTop]: Block.CarvedVaultBrick,
  [BwCell.SideTop]: Block.CarvedVaultBrick,
  [BwCell.Rim]: Block.CarvedVaultBrick,
};
const FIXTURE_BLOCK: Record<number, number> = {
  [BwFix.BedA]: Block.BwBedA,
  [BwFix.BedB]: Block.BwBedB,
  [BwFix.GenA]: Block.BwGenerator,
  [BwFix.GenB]: Block.BwGenerator,
  [BwFix.GenDiamond]: Block.BwGenerator,
  [BwFix.ShopA]: Block.BwShop,
  [BwFix.ShopB]: Block.BwShop,
};

// ── Arena addressing ───────────────────────────────────────────────────────

export function bedwarsArenaBounds(slot: number, mapId?: string): BwArenaBounds {
  const safeSlot = Math.max(0, Math.floor(slot));
  const def = bedwarsMap(mapId);
  const originX = BEDWARS_BASE_X + safeSlot * BEDWARS_SLOT_SPACING;
  const originZ = 0;
  return {
    slot: safeSlot, mapId: def.id, teams: def.teams,
    originX, originZ,
    minX: originX, maxX: originX + BEDWARS_ARENA_SIZE,
    minZ: originZ, maxZ: originZ + BEDWARS_ARENA_SIZE,
    minY: BEDWARS_VOID_Y, maxY: BEDWARS_CEILING_Y,
    floor: BEDWARS_FLOOR_Y, ceiling: BEDWARS_CEILING_Y, voidY: BEDWARS_VOID_Y,
    spawns: def.spawns.map((s) => ({
      x: originX + s.x + 0.5,
      y: BEDWARS_FLOOR_Y + 1.01,
      z: originZ + s.z + 0.5,
      yaw: s.yaw, team: s.team,
    })),
  };
}

/** Resolve the arena whose footprint contains a world column, or null. */
export function bedwarsArenaAt(x: number, z: number): BwArenaBounds | null {
  if (!Number.isFinite(x) || !Number.isFinite(z)) return null;
  if (x < BEDWARS_BASE_X || z < 0 || z >= BEDWARS_ARENA_SIZE) return null;
  const slot = Math.floor((x - BEDWARS_BASE_X) / BEDWARS_SLOT_SPACING);
  const arena = bedwarsArenaBounds(slot);
  return x >= arena.originX && x < arena.originX + BEDWARS_ARENA_SIZE ? arena : null;
}

/**
 * The authored stamp. Terrain calls this for every column in the band.
 *
 * NOTHING is returned below BEDWARS_STAMP_MIN_Y — the space under the islands
 * is genuinely empty all the way down, which is what makes a fall read as a
 * fall rather than as a hole in the floor.
 */
export function bedwarsBlockAt(x: number, y: number, z: number): number | null {
  const arena = bedwarsArenaAt(x, z);
  if (!arena) return null;
  const by = Math.floor(y);
  if (by < BEDWARS_STAMP_MIN_Y || by > BEDWARS_STAMP_MAX_Y) return null;
  const lx = Math.floor(x) - arena.originX, lz = Math.floor(z) - arena.originZ;
  if (lx < 0 || lx >= BEDWARS_ARENA_SIZE || lz < 0 || lz >= BEDWARS_ARENA_SIZE) return null;
  const map = arenaMap(arena.mapId);
  const cell = lz * BEDWARS_ARENA_SIZE + lx;

  if (by === BEDWARS_FLOOR_Y + 1) {
    const fix = map.fixture[cell];
    return fix === BwFix.None ? null : FIXTURE_BLOCK[fix];
  }
  const thickness = map.thickness[cell];
  if (thickness === 0) return null;
  if (by > BEDWARS_FLOOR_Y || by <= BEDWARS_FLOOR_Y - thickness) return null;
  const role = map.role[cell];
  return by === BEDWARS_FLOOR_Y ? TOP_BLOCK[role] : BODY_BLOCK[role];
}

/** Authored-geometry occupancy, matching `bedwarsBlockAt` exactly. Player
 *  edits are the caller's business — this is the immutable island. */
export function bedwarsSolidAt(x: number, y: number, z: number, arena: BwArenaBounds): boolean {
  const bx = Math.floor(x), by = Math.floor(y), bz = Math.floor(z);
  if (bx < arena.minX || bx >= arena.maxX || bz < arena.minZ || bz >= arena.maxZ) return false;
  const block = bedwarsBlockAt(bx, by, bz);
  return block !== null && block !== Block.Air;
}

/** Which team's bed cell sits here, or -1. Used by the bed-break branch, which
 *  is the ONLY thing that may destroy one. */
export function bedwarsBedTeamAt(x: number, y: number, z: number, arena: BwArenaBounds): number {
  if (Math.floor(y) !== BEDWARS_FLOOR_Y + 1) return -1;
  const lx = Math.floor(x) - arena.originX, lz = Math.floor(z) - arena.originZ;
  if (lx < 0 || lx >= BEDWARS_ARENA_SIZE || lz < 0 || lz >= BEDWARS_ARENA_SIZE) return -1;
  const fix = arenaMap(arena.mapId).fixture[lz * BEDWARS_ARENA_SIZE + lx];
  return fix === BwFix.BedA ? 0 : fix === BwFix.BedB ? 1 : -1;
}

/** Every world cell of one team's bed (both halves). */
export function bedwarsBedCells(arena: BwArenaBounds, team: number): BwVec3[] {
  const def = bedwarsMap(arena.mapId);
  const out: BwVec3[] = [];
  for (const bed of def.beds) {
    if (bed.team !== team) continue;
    out.push({ x: arena.originX + bed.x, y: BEDWARS_FLOOR_Y + 1, z: arena.originZ + bed.z });
    out.push({
      x: arena.originX + (bed.axis === 'x' ? bed.x + 1 : bed.x),
      y: BEDWARS_FLOOR_Y + 1,
      z: arena.originZ + (bed.axis === 'z' ? bed.z + 1 : bed.z),
    });
  }
  return out;
}

/** Shop cells belonging to a team, in world coordinates. */
export function bedwarsShopCells(arena: BwArenaBounds, team: number): BwVec3[] {
  return bedwarsMap(arena.mapId).shops
    .filter((s) => s.team === team)
    .map((s) => ({ x: arena.originX + s.x, y: BEDWARS_FLOOR_Y + 1, z: arena.originZ + s.z }));
}

export function bedwarsGenCells(
  arena: BwArenaBounds,
): { x: number; y: number; z: number; team: number; diamond: boolean }[] {
  const def = bedwarsMap(arena.mapId);
  return [
    ...def.teamGens.map((g) => ({
      x: arena.originX + g.x + 0.5, y: BEDWARS_FLOOR_Y + 1, z: arena.originZ + g.z + 0.5,
      team: g.team, diamond: false,
    })),
    ...def.diamondGens.map((g) => ({
      x: arena.originX + g.x + 0.5, y: BEDWARS_FLOOR_Y + 1, z: arena.originZ + g.z + 0.5,
      team: -1, diamond: true,
    })),
  ];
}

/** The arena's true symmetry centre, in world coordinates. Note this is
 *  `origin + 48.5`, not `origin + SIZE / 2` — see BEDWARS_CENTER. */
export function bedwarsArenaCenter(arena: BwArenaBounds): { x: number; z: number } {
  return { x: arena.originX + BEDWARS_CENTER, z: arena.originZ + BEDWARS_CENTER };
}

/**
 * Containment.
 *
 * x/z are clamped to the footprint so a runaway bridge cannot leave the render
 * crop, and y is capped at the ceiling so nobody sky-bases out of reach. y is
 * deliberately NOT floored: falling below `voidY` is a DEATH, handled by the
 * transform handler, and clamping it here would silently delete the mode's
 * signature kill.
 */
export function clampToBedwarsArena(p: BwVec3, arena: BwArenaBounds): BwVec3 {
  return {
    x: Math.max(arena.minX + 0.15, Math.min(arena.maxX - 0.15, p.x)),
    y: Math.min(arena.ceiling - 0.85, p.y),
    z: Math.max(arena.minZ + 0.15, Math.min(arena.maxZ - 0.15, p.z)),
  };
}

/** Collapse the containment box toward mid. Used by the stalemate ladder to
 *  drag stragglers together rather than letting a 1v1 hide forever. */
export function collapsedBedwarsArena(arena: BwArenaBounds, radius: number): BwArenaBounds {
  const { x: cx, z: cz } = bedwarsArenaCenter(arena);
  return {
    ...arena,
    minX: Math.max(arena.minX, cx - radius), maxX: Math.min(arena.maxX, cx + radius),
    minZ: Math.max(arena.minZ, cz - radius), maxZ: Math.min(arena.maxZ, cz + radius),
  };
}

// ── Resources ──────────────────────────────────────────────────────────────
// Server-side COUNTERS, not item entities. `itemspawn`/`itemsmove` are
// world-broadcast and gated only by `receivesWorldBroadcast`; arena-scoping
// them would need a per-entity visibility system that does not exist. Counters
// sidestep that entirely and make the shop trivially server-authoritative.

export const BW_GEN_IRON_MS = 1_500;
export const BW_GEN_GOLD_MS = 8_000;
export const BW_GEN_DIAMOND_MS = 25_000;
export const BW_CAP_IRON = 64;
export const BW_CAP_GOLD = 16;
export const BW_CAP_DIAMOND = 8;
/** Everyone within this radius of the diamond generator is credited on a tick,
 *  so holding mid is worth standing on. */
export const BW_PICKUP_RADIUS = 4.0;

/** The mid generator accelerates, so a stalled match still escalates. */
export const BW_DIAMOND_RAMP: readonly { atMs: number; periodMs: number }[] = [
  { atMs: 0, periodMs: 25_000 },
  { atMs: 120_000, periodMs: 18_000 },
  { atMs: 240_000, periodMs: 12_000 },
];

export function bedwarsDiamondPeriod(elapsedMs: number): number {
  let period = BW_DIAMOND_RAMP[0].periodMs;
  for (const step of BW_DIAMOND_RAMP) if (elapsedMs >= step.atMs) period = step.periodMs;
  return period;
}

export interface BwResources { iron: number; gold: number; diamond: number }

// ── The shop ───────────────────────────────────────────────────────────────

export interface BwShopEntry {
  /** Stable index. The client sends this; the server never trusts anything else. */
  entry: number;
  label: string;
  cost: Partial<BwResources>;
  /** Stacks granted. `teamBlock` resolves to the buyer's own wool colour. */
  grants?: { id: number; count: number }[];
  teamBlock?: number;
  /** Axe purchases REPLACE rather than stack, so the loadout is always exactly
   *  one axe and the damage math never has to ask the client what it holds. */
  axe?: number;
}

export const BEDWARS_SHOP: readonly BwShopEntry[] = [
  { entry: 1, label: 'Team Wool x16', cost: { iron: 4 }, teamBlock: 16 },
  { entry: 2, label: 'Oak Planks x8', cost: { iron: 12 }, grants: [{ id: Block.OakPlanks, count: 8 }] },
  // Glass ignores knockback-assisted bed rushes: the anti-explosion box.
  { entry: 3, label: 'Glass x6', cost: { iron: 14 }, grants: [{ id: Block.Glass, count: 6 }] },
  { entry: 4, label: 'Stone Axe', cost: { iron: 10 }, axe: Item.StoneAxe },
  { entry: 5, label: 'Bounce Pad x2', cost: { iron: 8 }, grants: [{ id: Item.JumpBoost, count: 2 }] },
  { entry: 6, label: 'Iron Axe', cost: { gold: 3 }, axe: Item.IronAxe },
  { entry: 7, label: 'Bandage x2', cost: { gold: 5 }, grants: [{ id: Item.Bandage, count: 2 }] },
  { entry: 8, label: 'Void Cleaver', cost: { diamond: 4 }, axe: Item.VoidCleaver },
];

export function bedwarsShopEntry(entry: number): BwShopEntry | null {
  return BEDWARS_SHOP.find((e) => e.entry === entry) ?? null;
}

export function bedwarsTeamWool(team: number): number {
  return team === 0 ? Block.TeamWoolA : Block.TeamWoolB;
}

export function bedwarsCanAfford(have: BwResources, cost: Partial<BwResources>): boolean {
  return (have.iron >= (cost.iron ?? 0)) &&
    (have.gold >= (cost.gold ?? 0)) &&
    (have.diamond >= (cost.diamond ?? 0));
}

// ── Axe melee ──────────────────────────────────────────────────────────────
// Entirely server-computed. The client sends a target id and nothing else.

export const BW_AXE_TIERS = [
  { item: Item.WoodenAxe, damage: 6, cooldownMs: 800, kbBonus: 0.00 },
  { item: Item.StoneAxe, damage: 8, cooldownMs: 720, kbBonus: 0.06 },
  { item: Item.IronAxe, damage: 10, cooldownMs: 640, kbBonus: 0.12 },
  { item: Item.VoidCleaver, damage: 13, cooldownMs: 560, kbBonus: 0.18 },
] as const;

export type BwAxeTier = typeof BW_AXE_TIERS[number];

export function bedwarsAxeTier(item: number): BwAxeTier {
  return BW_AXE_TIERS.find((t) => t.item === item) ?? BW_AXE_TIERS[0];
}
/** Rank of an axe in the ladder, for "is this an upgrade" checks. */
export function bedwarsAxeRank(item: number): number {
  const i = BW_AXE_TIERS.findIndex((t) => t.item === item);
  return i < 0 ? 0 : i;
}

/** A swing faster than this fraction of the cooldown is DROPPED, not scaled.
 *  The anti-macro wall: spam does not merely lose damage, it does nothing. */
export const BW_SWING_FLOOR = 0.55;
export const BW_COMBO_WINDOW_MS = 1_600;
export const BW_COMBO_STEP = 0.10;
export const BW_COMBO_MAX = 3;
export const BW_CRIT_MULT = 1.5;
/** Falling at least this fast counts as a jump-crit / fall-crit. */
export const BW_CRIT_FALL_VY = -0.15;
export const BW_SPRINT_SPEED = 5.2;
export const BW_SPRINT_KB_MULT = 1.85;
export const BW_KB_BASE = 0.62;
export const BW_KB_VERT = 0.42;
/** How much of the knockback direction comes from where the attacker is LOOKING
 *  rather than from the line between the bodies. This is the most important
 *  number in the mode: it is what turns "line him up with the edge, then swing"
 *  into a learnable skill instead of an accident of where you happened to stand. */
export const BW_LOOK_BLEND = 0.30;
export const BW_MELEE_RANGE = 4.2;
export const BW_MELEE_FACING_DOT = 0.55;
/** Lag-compensation window. Deliberately 0.25s, not the 1.2s DUEL_TRACK_WINDOW:
 *  melee has no travel time, so a wider window would let a laggy client hit
 *  someone who has already sprinted four metres clear. */
export const BW_MELEE_REWIND_S = 0.25;

export interface BwSwingInput {
  tier: BwAxeTier;
  /** Milliseconds since this attacker's last LANDED swing. */
  sinceLastSwingMs: number;
  /** Consecutive prior hits on this same target inside the combo window. */
  combo: number;
  onGround: boolean;
  /** Attacker's vertical velocity, blocks/tick. */
  vy: number;
  /** Attacker's horizontal speed, blocks/second. */
  speed: number;
  /** Unit vector from attacker to target, horizontal. */
  toTargetX: number;
  toTargetZ: number;
  /** Attacker's horizontal look direction, unit. */
  lookX: number;
  lookZ: number;
}

export interface BwSwingResult {
  damage: number;
  /** 0..1 charge actually achieved. */
  charge: number;
  crit: boolean;
  sprint: boolean;
  /** Combo multiplier step applied (0..BW_COMBO_MAX). */
  combo: number;
  /** Knockback impulse, in the same units the `hurt` arm already delivers. */
  kx: number;
  ky: number;
  kz: number;
}

/**
 * The whole feel of the mode, in one pure function.
 *
 * Charge is QUADRATIC, and that exponent is the design. Linear charge gives 62%
 * damage at half cooldown, which makes spamming roughly break-even;
 * `0.25 + 0.75c^2` gives 44%, which makes it a strict loss. You wait, then you
 * land. The combo counter then adds pressure on top of patience — three
 * consecutive full-charge hits on one target inside 1.6s, broken by a miss, a
 * target switch, or by being hit yourself.
 */
export function bedwarsSwing(input: BwSwingInput): BwSwingResult {
  const cooldown = Math.max(1, input.tier.cooldownMs);
  const c = Math.max(0, Math.min(1, input.sinceLastSwingMs / cooldown));
  const charged = 0.25 + 0.75 * c * c;
  const comboSteps = Math.max(0, Math.min(BW_COMBO_MAX, Math.floor(input.combo)));
  const comboMult = 1 + BW_COMBO_STEP * comboSteps;
  const crit = !input.onGround && input.vy < BW_CRIT_FALL_VY;
  const sprint = input.speed >= BW_SPRINT_SPEED;
  const damage = Math.round(
    input.tier.damage * charged * comboMult * (crit ? BW_CRIT_MULT : 1),
  );

  // Direction: mostly the line between the bodies, blended toward the
  // attacker's aim. Horizontal only — vertical lift is a separate constant.
  let dx = (1 - BW_LOOK_BLEND) * input.toTargetX + BW_LOOK_BLEND * input.lookX;
  let dz = (1 - BW_LOOK_BLEND) * input.toTargetZ + BW_LOOK_BLEND * input.lookZ;
  const len = Math.hypot(dx, dz);
  if (len > 1e-6) { dx /= len; dz /= len; } else { dx = input.toTargetX; dz = input.toTargetZ; }

  const kh = (BW_KB_BASE + input.tier.kbBonus) * (0.55 + 0.45 * c) *
    (sprint ? BW_SPRINT_KB_MULT : 1) * (crit ? 1.15 : 1);
  const ky = BW_KB_VERT + (crit ? 0.10 : 0);

  return {
    damage: Math.max(1, damage),
    charge: c, crit, sprint, combo: comboSteps,
    kx: dx * kh, ky, kz: dz * kh,
  };
}

// ── Match state ────────────────────────────────────────────────────────────

export const BEDWARS_MIN_PLAYERS = 2;
export const BEDWARS_CAPACITY = 2;
export const BEDWARS_COUNTDOWN_MS = 5_000;
export const BEDWARS_ARENA_LOAD_TIMEOUT_MS = 30_000;
export const BEDWARS_ROUND_MS = 8 * 60_000;
export const BEDWARS_RESPAWN_MS = 5_000;
export const BEDWARS_SPAWN_SHIELD_MS = 3_000;
export const BEDWARS_RESULT_MS = 20_000;
/** How long after a hit a void death still counts as that attacker's kill.
 *  This window IS the signature kill; a one-line bug here silently deletes it
 *  from the scoreboard, which is why it gets its own smoke check on both
 *  sides of the boundary. */
export const BEDWARS_VOID_CREDIT_MS = 10_000;
/** The stalemate ladder. Every rung is time-driven inside `running`, which
 *  keeps the state machine smaller than a sudden-death phase would. */
export const BEDWARS_BED_DECAY_MS = 5 * 60_000;
export const BEDWARS_CLAMP_MID_MS = 7 * 60_000;
export const BEDWARS_CLAMP_RADIUS = 6;

export type BwPhase = 'lobby' | 'countdown' | 'running' | 'results';
export type BwFinishReason = 'final_kill' | 'time' | 'forfeit' | 'cancelled';
export type BwStage = 'normal' | 'no_respawn' | 'collapse';
export type BwJoinFailure = 'invalid' | 'full' | 'match_in_progress' | 'already_in_lobby';
export type BwStartFailure =
  | 'not_host' | 'too_few_players' | 'too_many_players' | 'not_everyone_ready' | 'not_in_lobby';

export interface BwIdentity { id: number; username: string; skin: number }

export interface BwParticipant extends BwIdentity {
  team: number;
  host: boolean;
  ready: boolean;
  connected: boolean;
  joinOrder: number;
  kills: number;
  deaths: number;
  /** Beds this player personally broke. */
  bedsBroken: number;
  /** Void kills, tracked separately because it is the mode's signature. */
  voidKills: number;
  alive: boolean;
  spectating: boolean;
  respawnAt?: number;
  shieldUntil?: number;
  /** Purchased axe tier item id. Reset to this on every respawn, so a Void
   *  Cleaver is not lost on death — which is what makes it worth 4 diamonds. */
  axe: number;
  resources: BwResources;
  /** Who hit this player last, and when, for void-death attribution. */
  lastHitBy: number;
  lastHitAt: number;
}

export interface BwTeamState {
  team: number;
  bedAlive: boolean;
  /** Who broke it, 0 if it decayed on the stalemate ladder. */
  bedBrokenBy: number;
  bedBrokenAt: number;
  /** Beds conceded, i.e. this team's beds destroyed by an enemy. */
  bedsConceded: number;
}

export interface BwResult {
  winner: number | null;
  winnerTeam: number | null;
  scoreboard: BwParticipant[];
  finishReason: BwFinishReason;
  durationMs: number;
  /** Explicit, so no client ever renders an RP delta for an unranked mode. */
  ranked: false;
}

export interface BwLobbySnapshot {
  id: string;
  phase: BwPhase;
  mapId: string;
  capacity: number;
  participants: BwParticipant[];
  teams: BwTeamState[];
  host: number;
  serverNow: number;
  countdownEndsAt?: number;
  arenaLoadDeadline?: number;
  startedAt?: number;
  endsAt?: number;
  stage: BwStage;
  arena?: BwArenaBounds;
  arenaReady?: Set<number>;
  result?: BwResult;
  /** Always false. Bedwars is unranked; the client reads this rather than
   *  hard-coding the assumption. */
  ranked: false;
}

interface BwLobby {
  id: string;
  token: string;
  phase: BwPhase;
  mapId: string;
  participants: Map<number, BwParticipant>;
  teams: Map<number, BwTeamState>;
  host: number;
  nextJoinOrder: number;
  countdownEndsAt?: number;
  arenaLoadDeadline?: number;
  arenaReady?: Set<number>;
  startedAt?: number;
  endsAt?: number;
  arena?: BwArenaBounds;
  result?: BwResult;
  resultDeadline?: number;
  /** Ladder rungs already applied, so each fires exactly once. */
  decayed: boolean;
  collapsed: boolean;
}

/**
 * Ordering for the final board.
 *
 * Fewest deaths, then beds still standing, then fewest beds conceded, then
 * join order. Pure and total, so the smoke test can assert it is a real
 * ordering rather than a sort that happens to be stable today.
 */
export function orderBedwarsScore(
  participants: Iterable<BwParticipant>,
  teams: Map<number, BwTeamState> | ReadonlyMap<number, BwTeamState>,
): BwParticipant[] {
  const bedAlive = (p: BwParticipant): number => (teams.get(p.team)?.bedAlive ? 1 : 0);
  const conceded = (p: BwParticipant): number => teams.get(p.team)?.bedsConceded ?? 0;
  return [...participants].sort((a, b) =>
    a.deaths - b.deaths ||
    bedAlive(b) - bedAlive(a) ||
    conceded(a) - conceded(b) ||
    b.kills - a.kills ||
    a.joinOrder - b.joinOrder);
}

export interface BwCreateResult { token: string; snapshot: BwLobbySnapshot }
export type BwJoinResult =
  | { ok: true; snapshot: BwLobbySnapshot }
  | { ok: false; reason: BwJoinFailure };

export class Bedwars {
  private readonly lobbies = new Map<string, BwLobby>();
  private readonly lobbyByPlayer = new Map<number, BwLobby>();
  private readonly usedSlots = new Set<number>();
  private nextLobbyId = 1;

  constructor(private readonly tokenFactory: () => string) {}

  create(identity: BwIdentity, now: number): BwCreateResult | { reason: 'already_in_lobby' } {
    if (this.lobbyByPlayer.has(identity.id)) return { reason: 'already_in_lobby' };
    let token = '';
    do token = this.tokenFactory(); while (!token || token.length < 24 || this.lobbies.has(token));
    const def = bedwarsMap(BEDWARS_DEFAULT_MAP);
    const p = this.newParticipant(identity, true, 0, 0);
    const lobby: BwLobby = {
      id: `B${this.nextLobbyId++}`, token, phase: 'lobby', mapId: def.id,
      participants: new Map([[p.id, p]]),
      teams: new Map(Array.from({ length: def.teams }, (_, t) => [t, {
        team: t, bedAlive: true, bedBrokenBy: 0, bedBrokenAt: 0, bedsConceded: 0,
      }])),
      host: p.id, nextJoinOrder: 1, decayed: false, collapsed: false,
    };
    this.lobbies.set(token, lobby);
    this.lobbyByPlayer.set(p.id, lobby);
    return { token, snapshot: this.snapshotLobby(lobby, now) };
  }

  join(token: string, identity: BwIdentity, now: number): BwJoinResult {
    if (this.lobbyByPlayer.has(identity.id)) return { ok: false, reason: 'already_in_lobby' };
    const lobby = this.lobbies.get(token);
    if (!lobby) return { ok: false, reason: 'invalid' };
    if (lobby.phase !== 'lobby') return { ok: false, reason: 'match_in_progress' };
    const def = bedwarsMap(lobby.mapId);
    const capacity = def.teams * def.teamSize;
    if (lobby.participants.size >= capacity) return { ok: false, reason: 'full' };
    this.resetReady(lobby);
    const team = this.nextFreeTeam(lobby, def);
    const p = this.newParticipant(identity, false, lobby.nextJoinOrder++, team);
    lobby.participants.set(p.id, p);
    this.lobbyByPlayer.set(p.id, lobby);
    return { ok: true, snapshot: this.snapshotLobby(lobby, now) };
  }

  leave(playerId: number, now: number): { snapshot?: BwLobbySnapshot; deleted: boolean; token?: string } {
    const lobby = this.lobbyByPlayer.get(playerId);
    if (!lobby) return { deleted: false };
    const live = lobby.phase === 'running';
    const leaving = lobby.participants.get(playerId);
    this.lobbyByPlayer.delete(playerId);
    if (live && leaving) {
      // Keep a disconnected combatant on the board so leaving cannot erase a loss.
      leaving.connected = false; leaving.alive = false; leaving.spectating = true;
      leaving.respawnAt = undefined;
    } else {
      lobby.participants.delete(playerId);
    }
    lobby.arenaReady?.delete(playerId);
    if (lobby.participants.size === 0) {
      this.releaseArena(lobby);
      this.lobbies.delete(lobby.token);
      return { deleted: true, token: lobby.token };
    }
    if (lobby.host === playerId) {
      const next = [...lobby.participants.values()].filter((p) => p.connected)
        .sort((a, b) => a.joinOrder - b.joinOrder)[0];
      if (next) {
        lobby.host = next.id;
        for (const p of lobby.participants.values()) p.host = p.id === next.id;
      }
    }
    if (lobby.phase === 'lobby') this.resetReady(lobby);
    else if (lobby.phase === 'running' || lobby.phase === 'countdown') {
      const connected = [...lobby.participants.values()].filter((p) => p.connected);
      if (connected.length <= 1) {
        this.finish(lobby, now, connected[0]?.id ?? null, 'forfeit');
      } else if (lobby.phase === 'countdown') {
        this.tryArmCountdown(lobby, now);
      }
    } else if (lobby.phase === 'results') {
      this.returnToLobby(lobby);
    }
    // `returnToLobby` drops members who are on the board only because they
    // disconnected mid-match, which can empty a room that was non-empty a
    // moment ago. Without this second check the lobby — and its arena slot —
    // would leak for the lifetime of the server.
    if (lobby.participants.size === 0) {
      this.releaseArena(lobby);
      this.lobbies.delete(lobby.token);
      return { deleted: true, token: lobby.token };
    }
    return { snapshot: this.snapshotLobby(lobby, now), deleted: false };
  }

  setReady(playerId: number, ready: boolean, now: number): BwLobbySnapshot | null {
    const lobby = this.lobbyByPlayer.get(playerId);
    const p = lobby?.participants.get(playerId);
    if (!lobby || !p || lobby.phase !== 'lobby') return null;
    p.ready = ready;
    return this.snapshotLobby(lobby, now);
  }

  start(playerId: number, now: number):
  { ok: true; snapshot: BwLobbySnapshot } | { ok: false; reason: BwStartFailure } {
    const lobby = this.lobbyByPlayer.get(playerId);
    if (!lobby || lobby.phase !== 'lobby') return { ok: false, reason: 'not_in_lobby' };
    if (lobby.host !== playerId) return { ok: false, reason: 'not_host' };
    const def = bedwarsMap(lobby.mapId);
    if (lobby.participants.size < BEDWARS_MIN_PLAYERS) return { ok: false, reason: 'too_few_players' };
    if (lobby.participants.size > def.teams * def.teamSize) {
      return { ok: false, reason: 'too_many_players' };
    }
    if ([...lobby.participants.values()].some((p) => !p.connected || !p.ready)) {
      return { ok: false, reason: 'not_everyone_ready' };
    }
    this.beginCountdown(lobby, now);
    return { ok: true, snapshot: this.snapshotLobby(lobby, now) };
  }

  markArenaReady(playerId: number, now: number): BwLobbySnapshot | null {
    const lobby = this.lobbyByPlayer.get(playerId);
    if (!lobby || lobby.phase !== 'countdown' || lobby.countdownEndsAt !== undefined) return null;
    lobby.arenaReady?.add(playerId);
    this.tryArmCountdown(lobby, now);
    return this.snapshotLobby(lobby, now);
  }

  /** Record that `attacker` damaged `victim`, for void-death attribution. */
  recordHit(victimId: number, attackerId: number, now: number): void {
    const lobby = this.lobbyByPlayer.get(victimId);
    if (!lobby || lobby.phase !== 'running') return;
    const victim = lobby.participants.get(victimId);
    if (!victim || !lobby.participants.has(attackerId)) return;
    victim.lastHitBy = attackerId;
    victim.lastHitAt = now;
  }

  /**
   * A death. `killerId` of 0 means nobody was credited directly — for a void
   * death the caller passes 0 and this resolves the last-hit window itself, so
   * the attribution rule lives in exactly one place.
   */
  recordDeath(
    victimId: number, killerId: number, now: number, cause: 'melee' | 'void',
  ): { snapshot: BwLobbySnapshot; killer: number | null; finalKill: boolean } | null {
    const lobby = this.lobbyByPlayer.get(victimId);
    if (!lobby || lobby.phase !== 'running') return null;
    const victim = lobby.participants.get(victimId);
    if (!victim || !victim.alive) return null;

    let credited: BwParticipant | null = null;
    if (cause === 'void') {
      const within = now - victim.lastHitAt <= BEDWARS_VOID_CREDIT_MS;
      const last = within ? lobby.participants.get(victim.lastHitBy) : undefined;
      if (last && last.id !== victim.id && last.team !== victim.team) credited = last;
    } else {
      const k = lobby.participants.get(killerId);
      if (k && k.id !== victim.id && k.team !== victim.team) credited = k;
    }

    victim.deaths++;
    victim.alive = false;
    victim.spectating = true;
    victim.shieldUntil = undefined;
    victim.lastHitBy = 0; victim.lastHitAt = -Infinity;
    if (credited) {
      credited.kills++;
      if (cause === 'void') credited.voidKills++;
    }

    const bedAlive = lobby.teams.get(victim.team)?.bedAlive ?? false;
    const finalKill = !bedAlive;
    victim.respawnAt = finalKill ? undefined : now + BEDWARS_RESPAWN_MS;

    if (finalKill) {
      const survivors = [...lobby.participants.values()]
        .filter((p) => p.connected && (p.alive || p.respawnAt !== undefined));
      const teamsLeft = new Set(survivors.map((p) => p.team));
      if (teamsLeft.size <= 1) {
        this.finish(lobby, now, credited?.id ?? survivors[0]?.id ?? null, 'final_kill');
      }
    }
    return { snapshot: this.snapshotLobby(lobby, now), killer: credited?.id ?? null, finalKill };
  }

  /** Break an enemy bed. Refuses your own team's bed, and refuses a bed that
   *  is already gone, so the ladder's auto-decay cannot be double-counted. */
  breakBed(breakerId: number, team: number, now: number):
  { snapshot: BwLobbySnapshot; team: number } | null {
    const lobby = this.lobbyByPlayer.get(breakerId);
    if (!lobby || lobby.phase !== 'running') return null;
    const breaker = lobby.participants.get(breakerId);
    const state = lobby.teams.get(team);
    if (!breaker || !breaker.alive || !state || !state.bedAlive) return null;
    if (breaker.team === team) return null; // never your own
    state.bedAlive = false;
    state.bedBrokenBy = breakerId;
    state.bedBrokenAt = now;
    state.bedsConceded++;
    breaker.bedsBroken++;
    return { snapshot: this.snapshotLobby(lobby, now), team };
  }

  grantResources(playerId: number, delta: Partial<BwResources>): void {
    const p = this.lobbyByPlayer.get(playerId)?.participants.get(playerId);
    if (!p) return;
    p.resources.iron = Math.min(BW_CAP_IRON, p.resources.iron + (delta.iron ?? 0));
    p.resources.gold = Math.min(BW_CAP_GOLD, p.resources.gold + (delta.gold ?? 0));
    p.resources.diamond = Math.min(BW_CAP_DIAMOND, p.resources.diamond + (delta.diamond ?? 0));
  }

  /** Spend for a purchase. Returns false and changes nothing if unaffordable. */
  spendResources(playerId: number, cost: Partial<BwResources>): boolean {
    const p = this.lobbyByPlayer.get(playerId)?.participants.get(playerId);
    if (!p || !bedwarsCanAfford(p.resources, cost)) return false;
    p.resources.iron -= cost.iron ?? 0;
    p.resources.gold -= cost.gold ?? 0;
    p.resources.diamond -= cost.diamond ?? 0;
    return true;
  }

  setAxe(playerId: number, item: number): void {
    const p = this.lobbyByPlayer.get(playerId)?.participants.get(playerId);
    // Only ever an upgrade: a stale or replayed purchase cannot downgrade you.
    if (p && bedwarsAxeRank(item) > bedwarsAxeRank(p.axe)) p.axe = item;
  }

  removeSpawnShield(playerId: number): void {
    const p = this.lobbyByPlayer.get(playerId)?.participants.get(playerId);
    if (p) p.shieldUntil = undefined;
  }

  tick(now: number): BwLobbySnapshot[] {
    const changed: BwLobbySnapshot[] = [];
    for (const lobby of this.lobbies.values()) {
      let dirty = false;
      if (lobby.phase === 'countdown' && lobby.countdownEndsAt === undefined &&
          now >= (lobby.arenaLoadDeadline ?? Infinity)) {
        this.returnToLobby(lobby); dirty = true;
      }
      if (lobby.phase === 'countdown' && now >= (lobby.countdownEndsAt ?? Infinity)) {
        lobby.phase = 'running';
        lobby.startedAt = lobby.countdownEndsAt;
        lobby.endsAt = (lobby.startedAt ?? now) + BEDWARS_ROUND_MS;
        dirty = true;
      }
      if (lobby.phase === 'running') {
        const elapsed = now - (lobby.startedAt ?? now);
        // Rung 1 — the beds crumble. No more respawns for anyone.
        if (!lobby.decayed && elapsed >= BEDWARS_BED_DECAY_MS) {
          lobby.decayed = true;
          for (const state of lobby.teams.values()) {
            if (!state.bedAlive) continue;
            state.bedAlive = false; state.bedBrokenBy = 0; state.bedBrokenAt = now;
          }
          dirty = true;
        }
        // Rung 2 — the containment box collapses to mid and drags stragglers in.
        if (!lobby.collapsed && elapsed >= BEDWARS_CLAMP_MID_MS) {
          lobby.collapsed = true; dirty = true;
        }
        // Respawns.
        for (const p of lobby.participants.values()) {
          if (!p.alive && p.respawnAt !== undefined && now >= p.respawnAt) {
            const bedAlive = lobby.teams.get(p.team)?.bedAlive ?? false;
            if (!bedAlive) {
              // The bed died while they were waiting: the pending respawn is
              // revoked rather than honoured. Otherwise the ladder's decay
              // would hand out one last free life.
              p.respawnAt = undefined; dirty = true;
              continue;
            }
            p.alive = true; p.spectating = false; p.respawnAt = undefined;
            p.shieldUntil = now + BEDWARS_SPAWN_SHIELD_MS;
            dirty = true;
          }
        }
        // Rung 3 — hard cap. Somebody wins on the comparator.
        if (now >= (lobby.endsAt ?? Infinity)) {
          const board = orderBedwarsScore(lobby.participants.values(), lobby.teams);
          this.finish(lobby, now, board[0]?.id ?? null, 'time');
          dirty = true;
        } else {
          // Everybody eliminated (all beds gone, nobody left alive or pending).
          const live = [...lobby.participants.values()]
            .filter((p) => p.connected && (p.alive || p.respawnAt !== undefined));
          const teamsLeft = new Set(live.map((p) => p.team));
          if (teamsLeft.size <= 1 && lobby.participants.size > 1) {
            this.finish(lobby, now, live[0]?.id ?? null, 'final_kill');
            dirty = true;
          }
        }
      }
      if (lobby.phase === 'results' && now >= (lobby.resultDeadline ?? Infinity)) {
        this.returnToLobby(lobby); dirty = true;
      }
      if (dirty) changed.push(this.snapshotLobby(lobby, now));
    }
    return changed;
  }

  snapshotFor(playerId: number, now: number): BwLobbySnapshot | null {
    const lobby = this.lobbyByPlayer.get(playerId);
    return lobby ? this.snapshotLobby(lobby, now) : null;
  }
  snapshots(now: number): BwLobbySnapshot[] {
    return [...this.lobbies.values()].map((lobby) => this.snapshotLobby(lobby, now));
  }
  tokenFor(playerId: number): string | null { return this.lobbyByPlayer.get(playerId)?.token ?? null; }
  inviteInfo(token: string): { host: string; lobbyId: string } | null {
    const lobby = this.lobbies.get(token);
    const host = lobby?.participants.get(lobby.host);
    return lobby && host ? { host: host.username, lobbyId: lobby.id } : null;
  }
  arenaFor(playerId: number): BwArenaBounds | null {
    return this.lobbyByPlayer.get(playerId)?.arena ?? null;
  }
  phaseFor(playerId: number): BwPhase | null {
    return this.lobbyByPlayer.get(playerId)?.phase ?? null;
  }
  stageFor(playerId: number): BwStage {
    const lobby = this.lobbyByPlayer.get(playerId);
    return lobby ? this.stageOf(lobby) : 'normal';
  }
  participantFor(playerId: number): BwParticipant | null {
    return this.lobbyByPlayer.get(playerId)?.participants.get(playerId) ?? null;
  }
  teamOf(playerId: number): number {
    return this.lobbyByPlayer.get(playerId)?.participants.get(playerId)?.team ?? -1;
  }
  teamStateOf(playerId: number, team: number): BwTeamState | null {
    return this.lobbyByPlayer.get(playerId)?.teams.get(team) ?? null;
  }
  membersOf(playerId: number): number[] {
    return [...(this.lobbyByPlayer.get(playerId)?.participants.keys() ?? [])];
  }
  /** Both ids are in ONE live Bedwars match. Every melee validation starts here
   *  and it is false unless the match is actually running, so the handler is
   *  fail-closed by construction. */
  sameMatch(a: number, b: number): boolean {
    const lobby = this.lobbyByPlayer.get(a);
    return !!lobby && lobby === this.lobbyByPlayer.get(b) && lobby.phase === 'running';
  }

  private stageOf(lobby: BwLobby): BwStage {
    if (lobby.collapsed) return 'collapse';
    if (lobby.decayed) return 'no_respawn';
    return 'normal';
  }

  private nextFreeTeam(lobby: BwLobby, def: BwMapDef): number {
    const counts = new Array<number>(def.teams).fill(0);
    for (const p of lobby.participants.values()) {
      if (p.team >= 0 && p.team < def.teams) counts[p.team]++;
    }
    let best = 0;
    for (let t = 1; t < def.teams; t++) if (counts[t] < counts[best]) best = t;
    return best;
  }

  private newParticipant(
    identity: BwIdentity, host: boolean, joinOrder: number, team: number,
  ): BwParticipant {
    return {
      ...identity, team, host, ready: false, connected: true, joinOrder,
      kills: 0, deaths: 0, bedsBroken: 0, voidKills: 0,
      alive: true, spectating: false,
      axe: Item.WoodenAxe,
      resources: { iron: 0, gold: 0, diamond: 0 },
      lastHitBy: 0, lastHitAt: -Infinity,
    };
  }

  private resetReady(lobby: BwLobby): void {
    for (const p of lobby.participants.values()) p.ready = false;
  }

  private allocateSlot(): number {
    let slot = 0;
    while (this.usedSlots.has(slot)) slot++;
    this.usedSlots.add(slot);
    return slot;
  }

  private releaseArena(lobby: BwLobby): void {
    if (lobby.arena) this.usedSlots.delete(lobby.arena.slot);
    lobby.arena = undefined;
  }

  private beginCountdown(lobby: BwLobby, now: number): void {
    if (!lobby.arena) lobby.arena = bedwarsArenaBounds(this.allocateSlot(), lobby.mapId);
    lobby.phase = 'countdown';
    lobby.countdownEndsAt = undefined;
    lobby.arenaLoadDeadline = now + BEDWARS_ARENA_LOAD_TIMEOUT_MS;
    lobby.arenaReady = new Set();
    lobby.result = undefined;
    lobby.resultDeadline = undefined;
    lobby.startedAt = undefined;
    lobby.endsAt = undefined;
    lobby.decayed = false;
    lobby.collapsed = false;
    for (const state of lobby.teams.values()) {
      state.bedAlive = true; state.bedBrokenBy = 0; state.bedBrokenAt = 0; state.bedsConceded = 0;
    }
    for (const p of lobby.participants.values()) {
      p.kills = 0; p.deaths = 0; p.bedsBroken = 0; p.voidKills = 0;
      p.alive = true; p.spectating = false; p.respawnAt = undefined; p.shieldUntil = undefined;
      p.axe = Item.WoodenAxe;
      p.resources = { iron: 0, gold: 0, diamond: 0 };
      p.lastHitBy = 0; p.lastHitAt = -Infinity;
      p.ready = false;
    }
    this.tryArmCountdown(lobby, now);
  }

  private tryArmCountdown(lobby: BwLobby, now: number): void {
    if (lobby.phase !== 'countdown' || lobby.countdownEndsAt !== undefined) return;
    const waiting = [...lobby.participants.values()].filter((p) => p.connected);
    if (waiting.length === 0) return;
    if (!waiting.every((p) => lobby.arenaReady?.has(p.id))) return;
    lobby.countdownEndsAt = now + BEDWARS_COUNTDOWN_MS;
  }

  private finish(
    lobby: BwLobby, now: number, winner: number | null, reason: BwFinishReason,
  ): void {
    if (lobby.phase === 'results') return;
    const board = orderBedwarsScore(lobby.participants.values(), lobby.teams);
    const winnerP = winner !== null ? lobby.participants.get(winner) : undefined;
    lobby.phase = 'results';
    // No progression call, by design: Bedwars is UNRANKED. There is deliberately
    // no import of duels_progression in this file, so unrankedness is enforced
    // by the module graph rather than by remembering not to call something.
    lobby.result = {
      winner: winnerP?.id ?? null,
      winnerTeam: winnerP?.team ?? null,
      scoreboard: board.map((p) => ({ ...p, resources: { ...p.resources } })),
      finishReason: reason,
      durationMs: Math.max(0, now - (lobby.startedAt ?? now)),
      ranked: false,
    };
    lobby.resultDeadline = now + BEDWARS_RESULT_MS;
    for (const p of lobby.participants.values()) {
      p.alive = false; p.respawnAt = undefined; p.shieldUntil = undefined;
    }
  }

  private returnToLobby(lobby: BwLobby): void {
    lobby.phase = 'lobby';
    lobby.countdownEndsAt = undefined;
    lobby.arenaLoadDeadline = undefined;
    lobby.arenaReady = undefined;
    lobby.startedAt = undefined;
    lobby.endsAt = undefined;
    lobby.result = undefined;
    lobby.resultDeadline = undefined;
    lobby.decayed = false;
    lobby.collapsed = false;
    this.releaseArena(lobby);
    for (const [id, p] of [...lobby.participants]) {
      if (!p.connected) { lobby.participants.delete(id); continue; }
      p.ready = false; p.alive = true; p.spectating = false;
      p.respawnAt = undefined; p.shieldUntil = undefined;
      p.axe = Item.WoodenAxe;
      p.resources = { iron: 0, gold: 0, diamond: 0 };
      p.lastHitBy = 0; p.lastHitAt = -Infinity;
    }
    for (const state of lobby.teams.values()) {
      state.bedAlive = true; state.bedBrokenBy = 0; state.bedBrokenAt = 0; state.bedsConceded = 0;
    }
    if (!lobby.participants.has(lobby.host)) {
      const next = [...lobby.participants.values()].sort((a, b) => a.joinOrder - b.joinOrder)[0];
      if (next) { lobby.host = next.id; next.host = true; }
    }
  }

  private snapshotLobby(lobby: BwLobby, now: number): BwLobbySnapshot {
    const def = bedwarsMap(lobby.mapId);
    return {
      id: lobby.id,
      phase: lobby.phase,
      mapId: lobby.mapId,
      capacity: def.teams * def.teamSize,
      participants: [...lobby.participants.values()]
        .sort((a, b) => a.joinOrder - b.joinOrder)
        .map((p) => ({ ...p, resources: { ...p.resources } })),
      teams: [...lobby.teams.values()].map((t) => ({ ...t })),
      host: lobby.host,
      serverNow: now,
      countdownEndsAt: lobby.countdownEndsAt,
      arenaLoadDeadline: lobby.arenaLoadDeadline,
      startedAt: lobby.startedAt,
      endsAt: lobby.endsAt,
      stage: this.stageOf(lobby),
      arena: lobby.arena,
      arenaReady: lobby.arenaReady,
      result: lobby.result,
      ranked: false,
    };
  }
}
