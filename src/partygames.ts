// Shared geometry and authoritative round state for The Bridge and Parkour.
// All gameplay clocks are server milliseconds. Snapshots contain everything
// needed to recover the presentation; clients never choose spawns or winners.
//
// The two modes share one arena band, one lobby engine and one isolated
// session transport (the `party*` message family); they differ only in the
// venue they stamp and in what `evaluate` counts as progress.
import { Block } from './blocks';
import { Item } from './items';
import { bedwarsSwing, type BwSwingInput, type BwSwingResult } from './bedwars';
import { PARKOUR_THEMES } from './parkour_themes';
import {
  PARKOUR_MODES, PARKOUR_MODE_LAYOUTS, encodeParkourSeed, parkourCourse,
  type ParkourLayout, type ParkourMode,
} from './parkour_course';
import {
  COLLAPSE_LIVES, COLLAPSE_RESPAWN_LEAD, parkourCollapseFront, parkourVoidY,
} from './parkour_mechanics';

export const PARTY_BASE_X = 262144;
export const PARTY_SLOT_SPACING = 1024;
/** Concurrent Bridge/Parkour matches the band has room for. Slots are freed on
 *  match end, so this caps simultaneous matches and — more importantly — stops
 *  a runaway allocator from stamping a venue outside the party band. */
export const PARTY_ARENA_SLOTS = 96;
export const PARTY_ARENA_SIZE_X = 64;
export const PARTY_ARENA_SIZE_Z = 640;
export const PARTY_FLOOR_Y = 140;
export const PARTY_VOID_Y = 118;
export const PARTY_CEILING_Y = 190;
export const PARTY_STAMP_MIN_Y = 120;
export const PARTY_STAMP_MAX_Y = 190;
export const PARTY_MAX_HEALTH = 20;
export const PARTY_AMBIENT_LIGHT = 0.8;
/** Both modes are strictly 1v1 — private lobbies included. The Bridge is a
 *  duel over a one-block span; a second body on your own side has nowhere to
 *  stand and nothing to do. */
export const PARTY_CAPACITY = 2;
export const PARTY_MIN_PLAYERS = 2;
export const PARTY_COUNTDOWN_MS = 3000;
export const PARTY_ARENA_LOAD_TIMEOUT_MS = 30000;
export const PARTY_RESULT_MS = 20000;
/** Goals that take a game of The Bridge. */
export const BRIDGE_GOAL_LIMIT = 5;
/** A goal restarts the round: both players are shut back into their own drop
 *  cage and held there for this long, counted down on the HUD, before the
 *  hatches open again. Deliberately the same three seconds as the opening
 *  countdown — a restart should feel like the round starting over. */
export const BRIDGE_GOAL_RESET_MS = 3000;
/** Bridge attacks have fixed strength. Short action intervals bound packet
 * spam; waiting never earns extra damage or knockback. */
export const BRIDGE_RESPAWN_SHIELD_MS = 1800;
export const BRIDGE_MELEE_TIER = { item: Item.IronAxe, damage: 5, cooldownMs: 280, kbBonus: 0.02 } as const;
export const BRIDGE_KILL_CREDIT_MS = 10_000;
/** One arrow every five seconds: the bow is a finisher, not a spray. */
export const BRIDGE_BOW_COOLDOWN_MS = 5000;
export const BRIDGE_ARROW_SPEED = 62;
export const BRIDGE_ARROW_GRAVITY = 19;
export const BRIDGE_ARROW_LIFE_MS = 5000;
export const BRIDGE_ARROW_DAMAGE = 7;
export const BRIDGE_ARROW_KB = 0.55;
export const BRIDGE_ARROW_KB_VERT = 0.3;

/** Keep movement crits, directional sprint knockback and earned combos, with
 * full-strength contact on every accepted swing, including the first one. */
export function bridgeSwing(input: Omit<BwSwingInput, 'tier' | 'sinceLastSwingMs' | 'critFallVy'>): BwSwingResult {
  // About 0.9 m/s downward: past the apex of an ordinary 1.25-block jump.
  return bedwarsSwing({ ...input, tier: BRIDGE_MELEE_TIER, critFallVy: -.015,
    sinceLastSwingMs: BRIDGE_MELEE_TIER.cooldownMs });
}

/** Instant arrows reward leading a moving target and controlling the arc. */
export function bridgeArrowShot(): {
  speed: number; damage: number; crit: boolean; knockback: number;
} {
  return { speed: BRIDGE_ARROW_SPEED, damage: BRIDGE_ARROW_DAMAGE,
    crit: false, knockback: BRIDGE_ARROW_KB };
}

export type PartyMode = 'bridge' | 'parkour';
export type PartyGameId = 'bridge' | 'parkour';
export type PartyPhase = 'lobby' | 'countdown' | 'running' | 'results';
export type PartyFinishReason = 'complete' | 'forfeit' | 'cancelled';
export type PartyJoinFailure = 'invalid' | 'full' | 'match_in_progress' | 'already_in_lobby';
export type PartyStartFailure = 'not_host' | 'too_few_players' | 'too_many_players' | 'not_everyone_ready' | 'not_in_lobby' | 'no_arena';

export interface PartyVec3 { x: number; y: number; z: number }

export interface PartyArenaBounds {
  slot: number;
  seed: number;
  originX: number;
  originZ: number;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
  floor: number;
  ceiling: number;
  voidY: number;
}
export interface PartySubBounds extends PartyArenaBounds {
  index: number;
  game: PartyGameId;
}

/** Where one mode's venue sits inside its arena slot, in slot-local blocks. */
interface PartyVenue { insetX: number; sizeX: number; originZ: number; sizeZ: number }

export interface PartyGameDef extends PartyVenue {
  id: PartyGameId;
  index: number;
  title: string;
  rule: string;
  durationMs: number;
}

// The two venues never overlap in z, so one slot holds both and a lobby can be
// re-armed for either mode without moving the player to a new arena band.
export const PARTY_GAME_DEFS: readonly PartyGameDef[] = [
  {
    id: 'bridge', index: 0, title: 'THE BRIDGE',
    rule: `Iron axe, bow and wool. Sprint-hit rivals off the span, then dive into the enemy portal. First to ${BRIDGE_GOAL_LIMIT} goals.`,
    durationMs: 480_000, insetX: 20, sizeX: 24, originZ: 0, sizeZ: 80,
  },
  {
    id: 'parkour', index: 1, title: 'PARKOUR DUEL',
    rule: 'One straight line of jumps, walls, tunnels and gaps. Checkpoints are rare. Sprint, jump, do not look down.',
    durationMs: 420_000, insetX: 16, sizeX: 32, originZ: 192, sizeZ: 448,
  },
];
export function partyGame(id: PartyGameId): PartyGameDef {
  return PARTY_GAME_DEFS.find((g) => g.id === id) ?? PARTY_GAME_DEFS[0];
}
function gameAtIndex(index: number): PartyGameDef {
  return PARTY_GAME_DEFS.find((g) => g.index === index) ?? PARTY_GAME_DEFS[0];
}

export function partyHash(seed: number, n: number): number {
  let h = (seed ^ Math.imul(n + 1, 0x9e3779b9)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x21f0aaad);
  h = Math.imul(h ^ (h >>> 15), 0x735a2d97);
  return (h ^ (h >>> 15)) >>> 0;
}

// A seed travels in arena/sub snapshots, and is installed before terrain loads.
// Slots may be reused; the client explicitly invalidates their old chunk cache.
const arenaSeeds = new Map<number, number>();
export function registerPartyArena(arena: PartyArenaBounds): void { arenaSeeds.set(arena.slot, arena.seed); }

export function partyArenaBounds(slot: number, seed = arenaSeeds.get(slot) ?? 1): PartyArenaBounds {
  const originX = PARTY_BASE_X + slot * PARTY_SLOT_SPACING;
  return {
    slot, seed, originX, originZ: 0, minX: originX, maxX: originX + PARTY_ARENA_SIZE_X,
    minZ: 0, maxZ: PARTY_ARENA_SIZE_Z, minY: PARTY_VOID_Y, maxY: PARTY_CEILING_Y,
    floor: PARTY_FLOOR_Y, ceiling: PARTY_CEILING_Y, voidY: PARTY_VOID_Y,
  };
}
export function partySubBounds(slot: number, index: number, seed = arenaSeeds.get(slot) ?? 1): PartySubBounds {
  const a = partyArenaBounds(slot, seed), game = gameAtIndex(index);
  return {
    ...a, index: game.index, game: game.id,
    minX: a.originX + game.insetX, maxX: a.originX + game.insetX + game.sizeX,
    minZ: game.originZ, maxZ: game.originZ + game.sizeZ,
  };
}
export function partyArenaAt(x: number, z: number): PartyArenaBounds | null {
  if (!Number.isFinite(x) || !Number.isFinite(z) || x < PARTY_BASE_X || z < 0 || z >= PARTY_ARENA_SIZE_Z)
    return null;
  const slot = Math.floor((x - PARTY_BASE_X) / PARTY_SLOT_SPACING), a = partyArenaBounds(slot);
  return x < a.maxX ? a : null;
}
export function clampToPartySub(p: PartyVec3, sub: PartySubBounds): PartyVec3 {
  return {
    x: Math.max(sub.minX + .3, Math.min(sub.maxX - .3, p.x)),
    y: Math.max(PARTY_VOID_Y - 2, Math.min(sub.ceiling - 1.8, p.y)),
    z: Math.max(sub.minZ + .3, Math.min(sub.maxZ - .3, p.z)),
  };
}

// ── Venue stamps ───────────────────────────────────────────────────────────
// Both venues are authored into a sparse block map keyed by slot-local
// (x, y, z). Sparse rather than a dense column array because both venues are
// mostly open air, and the server walks this map for every collision segment.

class VenueStamp {
  readonly blocks = new Map<number, number>();
  constructor(readonly sizeX: number, readonly sizeZ: number) { }
  key(lx: number, y: number, lz: number): number {
    return ((y - PARTY_STAMP_MIN_Y) * this.sizeZ + lz) * this.sizeX + lx;
  }
  inside(lx: number, y: number, lz: number): boolean {
    return lx >= 0 && lx < this.sizeX && lz >= 0 && lz < this.sizeZ &&
      y >= PARTY_STAMP_MIN_Y && y <= PARTY_STAMP_MAX_Y;
  }
  set(lx: number, y: number, lz: number, block: number): void {
    if (this.inside(lx, y, lz)) this.blocks.set(this.key(lx, y, lz), block);
  }
  clear(lx: number, y: number, lz: number): void {
    if (this.inside(lx, y, lz)) this.blocks.delete(this.key(lx, y, lz));
  }
  get(lx: number, y: number, lz: number): number {
    if (!this.inside(lx, y, lz)) return Block.Air;
    return this.blocks.get(this.key(lx, y, lz)) ?? Block.Air;
  }
  /** Inclusive box fill. */
  fill(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, block: number): void {
    for (let y = y0; y <= y1; y++)
      for (let z = z0; z <= z1; z++)
        for (let x = x0; x <= x1; x++) this.set(x, y, z, block);
  }
  /** Inclusive box erase. */
  carve(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number): void {
    for (let y = y0; y <= y1; y++)
      for (let z = z0; z <= z1; z++)
        for (let x = x0; x <= x1; x++) this.clear(x, y, z);
  }
}

// ── The Bridge ─────────────────────────────────────────────────────────────
// One 24 x 80 island chain, perfectly mirror-symmetric about z = 40. Only the
// crimson half is authored; the cobalt half is that half reflected with the
// team wool swapped, so neither side can ever have a geometric advantage.
//
// The venue is deliberately COMPACT — roughly half the span and half the width
// it used to be — because a duel over one block of walkway is decided by how
// long the crossing takes, not by how far apart the two ends are. What the
// smaller footprint buys is spent back on the base itself: at this size every
// block of it is on screen at once, so it is built out of small pieces —
// courses, slits, machicolations, obelisks, a keep and a drop cage — rather
// than large flat plates.

export const BRIDGE_SIZE_X = 24;
export const BRIDGE_SIZE_Z = 80;
/** Reflection axis. `BRIDGE_SIZE_Z - 1 - lz` maps crimson to cobalt in BLOCKS;
 *  a continuous z mirrors as `BRIDGE_SIZE_Z - z`, which is the same axis. */
const BRIDGE_MIRROR = BRIDGE_SIZE_Z - 1;
/** Team wool, indexed by team. Placeable, and the only block players may add. */
export const BRIDGE_TEAM_BLOCK = [Block.TeamWoolA, Block.TeamWoolB] as const;
export const BRIDGE_TEAM_NAME = ['CRIMSON', 'COBALT'] as const;
/** The crimson base's footprint, slot-local and inclusive. */
const BASE_X0 = 4, BASE_X1 = 20, BASE_Z0 = 2, BASE_Z1 = 18;
/** Scoring portal footprints, in slot-local blocks. Half-open on max. */
export const BRIDGE_GOALS: readonly { team: number; minX: number; maxX: number; minZ: number; maxZ: number }[] = [
  { team: 0, minX: 11, maxX: 14, minZ: 6, maxZ: 9 },
  { team: 1, minX: 11, maxX: 14, minZ: BRIDGE_MIRROR - 8, maxZ: BRIDGE_MIRROR - 5 },
];
/** No player-placed block may enter this pad around a portal mouth. */
const GOAL_GUARD = 2;
/** The centre line. One span, one block wide, runs the whole length on it. */
export const BRIDGE_LANE_X = 12;
/** Spawn pad centre, crimson side. */
const BRIDGE_SPAWN_Z = 13.5;

// ── The drop cage ──────────────────────────────────────────────────────────
// Every round, and every restart after a goal, begins with both players shut
// inside a glass pod over their own spawn pad. The pod is ordinary authored
// geometry — it is always there — but its hatch is the one part of either
// venue the server opens and closes at runtime, so the start of play is a real
// three-block fall onto your own deck rather than a teleport.
/** Cage footprint, inclusive. The hatch is the interior of it. */
const CAGE_X0 = BRIDGE_LANE_X - 2, CAGE_X1 = BRIDGE_LANE_X + 2;
const CAGE_Z0 = 11, CAGE_Z1 = 15;
/** Hatch height and standing height, both relative to the deck. Three blocks:
 *  short enough that the drop never costs a single point of fall damage. */
export const BRIDGE_CAGE_FLOOR = 3;
export const BRIDGE_CAGE_ROOF = 7;

function bridgeSwapTeam(block: number): number {
  return block === Block.TeamWoolA ? Block.TeamWoolB : block === Block.TeamWoolB ? Block.TeamWoolA : block;
}
/** `lz` reflected onto the other side of the arena. */
function bridgeMirrorZ(lz: number): number { return BRIDGE_MIRROR - lz; }

let bridgeStampCache: VenueStamp | null = null;
function bridgeStamp(): VenueStamp {
  if (bridgeStampCache) return bridgeStampCache;
  const s = new VenueStamp(BRIDGE_SIZE_X, BRIDGE_SIZE_Z);
  const F = PARTY_FLOOR_Y, cx = BRIDGE_LANE_X;
  const TEAM = Block.TeamWoolA, STONE = Block.OpalBrick, DECK = Block.SpectralMarble;
  const TRIM = Block.PearlTile, CORE = Block.Basalt, GLOW = Block.RuneGlass;
  const GOLD = Block.GildedVaultBrick, COLUMN = Block.IvoryColumn, PRISM = Block.PrismBrick;
  const CARVED = Block.CarvedVaultBrick, JADE = Block.JadeMosaic, MOSAIC = Block.VaultMosaic;
  const LIME = Block.LuminousLimestone, GRATE = Block.ClockworkGrate, LAMP = Block.GildedLamp;
  const g = BRIDGE_GOALS[0];

  // 1. The island the base stands on. Each course steps in as it falls, so the
  //    base reads as a rock hanging in the void rather than a slab on stilts.
  //    The last course is lit and sits directly under the portal: it IS the
  //    floor a scoring dive lands on.
  const island: readonly [number, number, number, number, number, number][] = [
    [BASE_X0, BASE_X1, F - 1, BASE_Z0, BASE_Z1, CORE],
    [BASE_X0 + 1, BASE_X1 - 1, F - 2, BASE_Z0 + 1, BASE_Z1 - 1, CORE],
    [BASE_X0 + 2, BASE_X1 - 2, F - 3, BASE_Z0 + 2, BASE_Z1 - 2, LIME],
    [BASE_X0 + 3, BASE_X1 - 3, F - 4, BASE_Z0 + 2, BASE_Z1 - 4, STONE],
    [BASE_X0 + 4, BASE_X1 - 4, F - 5, BASE_Z0 + 2, BASE_Z1 - 6, PRISM],
    [BASE_X0 + 5, BASE_X1 - 5, F - 6, BASE_Z0 + 3, BASE_Z1 - 7, PRISM],
    [BASE_X0 + 6, BASE_X1 - 6, F - 7, BASE_Z0 + 3, BASE_Z1 - 8, PRISM],
    [BASE_X0 + 6, BASE_X1 - 6, F - 8, BASE_Z0 + 3, BASE_Z1 - 8, GLOW],
  ];
  for (const [x0, x1, y, z0, z1, block] of island) s.fill(x0, x1, y, y, z0, z1, block);
  // Ribs down the flanks, and a hanging pylon under each corner tipped with a
  // team lamp — the underside is the first thing you see from the far base.
  for (const lz of [4, 8, 12, 16])
    for (const lx of [BASE_X0, BASE_X1]) {
      s.fill(lx, lx, F - 4, F - 2, lz, lz, CARVED);
      s.set(lx, F - 5, lz, GLOW);
    }
  for (const [px, pz] of [[BASE_X0 + 1, BASE_Z0 + 1], [BASE_X1 - 1, BASE_Z0 + 1],
    [BASE_X0 + 1, BASE_Z1 - 1], [BASE_X1 - 1, BASE_Z1 - 1]]) {
    s.fill(px, px, F - 12, F - 3, pz, pz, CORE);
    s.set(px, F - 7, pz, TEAM);
    s.set(px, F - 13, pz, GLOW);
  }

  // 2. The deck. A gilded runway leaves the portal and runs out through the
  //    sally port, so the one route out of the base is drawn on the floor.
  for (let lz = BASE_Z0; lz <= BASE_Z1; lz++)
    for (let lx = BASE_X0; lx <= BASE_X1; lx++) {
      const dx = Math.abs(lx - cx), edge = lx === BASE_X0 || lx === BASE_X1 || lz === BASE_Z0 || lz === BASE_Z1;
      const rim = lx === BASE_X0 + 1 || lx === BASE_X1 - 1 || lz === BASE_Z0 + 1 || lz === BASE_Z1 - 1;
      const runway = dx <= 1 && lz >= g.maxZ;
      s.set(lx, F, lz, edge ? TRIM : rim ? CARVED
        : runway ? (dx === 0 ? GOLD : PRISM)
          : (lz + dx) % 6 < 2 ? TEAM
            : (lx % 4 === 0 || lz % 4 === 0) ? JADE : DECK);
    }

  // 3. The rampart. Four courses, arrow slits every third block, crenellated —
  //    and one sally port, dead centre, lined up with the span and with the
  //    portal at the far end of it: there is exactly one way out.
  for (let y = F + 1; y <= F + 4; y++)
    for (let lz = BASE_Z0; lz <= BASE_Z1; lz++)
      for (let lx = BASE_X0; lx <= BASE_X1; lx++) {
        if (!(lx === BASE_X0 || lx === BASE_X1 || lz === BASE_Z0 || lz === BASE_Z1)) continue;
        if (lz === BASE_Z1 && lx >= g.minX && lx < g.maxX) continue;
        if (y === F + 4 && (lx + lz) % 2 !== 0) continue; // crenellations
        const slit = y === F + 2 && (lx + lz) % 3 === 0;
        s.set(lx, y, lz, slit ? GLOW : y === F + 3 ? TEAM : y === F + 1 ? STONE : CARVED);
      }

  // 4. Corner turrets: a banded shaft, a machicolated ring on grates, a wool
  //    crown and a gilded finial.
  for (const [tx, tz] of [[BASE_X0 + 1, BASE_Z0 + 1], [BASE_X1 - 1, BASE_Z0 + 1],
    [BASE_X0 + 1, BASE_Z1 - 1], [BASE_X1 - 1, BASE_Z1 - 1]]) {
    for (let y = F + 1; y <= F + 9; y++)
      for (let dz = -1; dz <= 1; dz++)
        for (let dx = -1; dx <= 1; dx++) {
          const corner = dx !== 0 && dz !== 0;
          s.set(tx + dx, y, tz + dz, corner ? COLUMN
            : y === F + 4 || y === F + 8 ? TEAM : y % 3 === 0 ? CARVED : STONE);
        }
    for (const [dx, dz] of [[2, 0], [-2, 0], [0, 2], [0, -2]]) {
      s.set(tx + dx, F + 9, tz + dz, GRATE);
      s.set(tx + dx, F + 8, tz + dz, LAMP);
    }
    s.fill(tx - 2, tx + 2, F + 10, F + 10, tz - 2, tz + 2, STONE);
    for (let dz = -2; dz <= 2; dz++)
      for (let dx = -2; dx <= 2; dx++)
        if (Math.abs(dx) === 2 || Math.abs(dz) === 2) s.set(tx + dx, F + 11, tz + dz, TEAM);
    s.fill(tx, tx, F + 11, F + 13, tz, tz, GLOW);
    s.set(tx, F + 14, tz, GOLD);
  }

  // 5. The gate over the sally port: jambs, a carved lintel, a wool banner and
  //    a lamp either side, so the one way out is also the loudest thing on the
  //    wall from the enemy's deck.
  for (const jx of [g.minX - 1, g.maxX]) {
    s.fill(jx, jx, F + 1, F + 3, BASE_Z1, BASE_Z1, COLUMN);
    s.set(jx, F + 6, BASE_Z1, LAMP);
  }
  s.fill(g.minX - 1, g.maxX, F + 4, F + 4, BASE_Z1, BASE_Z1, CARVED);
  s.fill(g.minX, g.maxX - 1, F + 5, F + 5, BASE_Z1, BASE_Z1, TEAM);
  s.fill(g.minX - 1, g.maxX, F + 6, F + 6, BASE_Z1, BASE_Z1, GOLD);
  s.set(cx, F + 7, BASE_Z1, GLOW);

  // 6. The keep, behind the portal: a two-step dais, four lit columns, a
  //    slab roof and a gilded ridge.
  s.fill(BASE_X0 + 2, BASE_X1 - 2, F + 1, F + 1, BASE_Z0 + 1, BASE_Z0 + 3, TRIM);
  s.fill(BASE_X0 + 4, BASE_X1 - 4, F + 2, F + 2, BASE_Z0 + 1, BASE_Z0 + 2, MOSAIC);
  for (const px of [BASE_X0 + 4, BASE_X1 - 4])
    for (const pz of [BASE_Z0 + 1, BASE_Z0 + 3]) {
      s.fill(px, px, F + 2, F + 5, pz, pz, COLUMN);
      s.set(px, F + 6, pz, LAMP);
    }
  s.fill(BASE_X0 + 3, BASE_X1 - 3, F + 7, F + 7, BASE_Z0, BASE_Z0 + 4, STONE);
  s.fill(BASE_X0 + 5, BASE_X1 - 5, F + 8, F + 8, BASE_Z0 + 1, BASE_Z0 + 3, TEAM);
  s.fill(cx - 1, cx + 1, F + 9, F + 9, BASE_Z0 + 1, BASE_Z0 + 3, GOLD);
  s.set(cx, F + 10, BASE_Z0 + 2, GLOW);

  // 7. The portal: a gilded collar on the deck, a prism-lined shaft, four
  //    banded obelisks and a floating cross over the mouth.
  s.fill(g.minX - 1, g.maxX, F, F, g.minZ - 1, g.maxZ, GOLD);
  s.fill(g.minX - 1, g.maxX, F - 7, F - 1, g.minZ - 1, g.maxZ, PRISM);
  for (const ox of [g.minX - 1, g.maxX])
    for (const oz of [g.minZ - 1, g.maxZ]) {
      for (let y = F + 1; y <= F + 4; y++) s.set(ox, y, oz, y % 2 ? CARVED : TEAM);
      s.set(ox, F + 5, oz, GLOW);
      s.set(ox, F + 6, oz, GOLD);
    }
  const gz = (g.minZ + g.maxZ - 1) / 2;
  s.fill(g.minX - 1, g.maxX, F + 7, F + 7, gz, gz, GOLD);
  s.fill(cx, cx, F + 7, F + 7, g.minZ - 1, g.maxZ, GOLD);
  s.set(cx, F + 8, gz, GLOW);

  // 8. The spawn pad, a wool-and-mosaic square you cannot mistake for the
  //    deck, and the drop cage standing over it on four legs.
  for (let lz = CAGE_Z0; lz <= CAGE_Z1; lz++)
    for (let lx = CAGE_X0 - 2; lx <= CAGE_X1 + 2; lx++) {
      const border = lz === CAGE_Z0 || lz === CAGE_Z1 || lx === CAGE_X0 - 2 || lx === CAGE_X1 + 2;
      s.set(lx, F, lz, border ? GOLD : (lx + lz) % 2 ? TEAM : MOSAIC);
    }
  for (let lz = CAGE_Z0; lz <= CAGE_Z1; lz++)
    for (let lx = CAGE_X0; lx <= CAGE_X1; lx++) {
      const rim = lx === CAGE_X0 || lx === CAGE_X1 || lz === CAGE_Z0 || lz === CAGE_Z1;
      const corner = (lx === CAGE_X0 || lx === CAGE_X1) && (lz === CAGE_Z0 || lz === CAGE_Z1);
      // The hatch is the interior; the lip it swings out of stays put.
      s.set(lx, F + BRIDGE_CAGE_FLOOR, lz, rim ? GOLD : PRISM);
      s.set(lx, F + BRIDGE_CAGE_ROOF, lz, corner ? GOLD : rim ? CARVED : GLOW);
      if (corner) {
        s.fill(lx, lx, F + 1, F + BRIDGE_CAGE_FLOOR - 1, lz, lz, COLUMN);
        s.fill(lx, lx, F + BRIDGE_CAGE_FLOOR + 1, F + BRIDGE_CAGE_ROOF - 1, lz, lz, COLUMN);
      } else if (rim) {
        s.fill(lx, lx, F + BRIDGE_CAGE_FLOOR + 1, F + BRIDGE_CAGE_ROOF - 1, lz, lz, GLOW);
      }
    }
  s.set(cx, F + BRIDGE_CAGE_ROOF + 1, (CAGE_Z0 + CAGE_Z1) / 2, LAMP);

  // 9. The span. ONE lane, ONE block wide, straight down the centre line and
  //    unbroken from the sally port to the middle island — and, once the
  //    mirror pass below completes it, from one base to the other. There is no
  //    second route, no rail, and nothing at all to stand on either side of
  //    it: every crossing is a tightrope with somebody at the far end. The
  //    wool is for repairing the span and for climbing back onto it.
  for (let lz = BASE_Z1 + 1; lz <= 35; lz++) {
    s.set(cx, F, lz, lz % 4 === 0 ? TEAM : DECK);
    // Lanterns hang a clear block underneath: they light the span and give the
    // drop a scale, and that gap keeps them off the walking surface until
    // somebody knocks the deck out from over them.
    if (lz % 5 === 1) {
      s.set(cx, F - 2, lz, GLOW);
      s.set(cx, F - 3, lz, CORE);
    }
  }
  // Buttress arms where the span leaves the base, so it reads as built rather
  // than floating. They sit BELOW the walkway and are never a second footing.
  for (const lz of [BASE_Z1 + 1, BASE_Z1 + 2]) {
    s.set(cx - 1, F - 1, lz, CORE);
    s.set(cx + 1, F - 1, lz, CORE);
    s.set(cx, F - 1, lz, STONE);
  }

  // 10. The middle island: a small contested node ON the line rather than a
  //     plaza beside it — eleven blocks across, so the span still reads as one
  //     continuous route from base to base. Only the near half is authored;
  //     the mirror pass completes it rather than duplicating it. The shrine on
  //     it is an arch you RUN under: nothing here is ever a step to clear.
  for (let lz = 36; lz <= 39; lz++)
    for (let lx = cx - 5; lx <= cx + 5; lx++) {
      const edge = lx === cx - 5 || lx === cx + 5 || lz === 36;
      s.set(lx, F, lz, edge ? TRIM : ((lx >> 1) + (lz >> 1)) % 2 ? DECK : JADE);
    }
  s.fill(cx - 4, cx + 4, F - 1, F - 1, 36, 39, CORE);
  s.fill(cx - 3, cx + 3, F - 2, F - 2, 36, 39, CORE);
  s.fill(cx - 2, cx + 2, F - 4, F - 3, 37, 39, STONE);
  s.fill(cx - 1, cx + 1, F - 9, F - 5, 38, 39, PRISM);
  s.fill(cx, cx, F - 10, F - 10, 38, 39, GLOW);
  for (const ox of [cx - 3, cx + 3]) {
    s.fill(ox, ox, F + 1, F + 4, 37, 37, COLUMN);
    s.set(ox, F + 3, 37, TEAM);
    s.set(ox, F + 5, 37, LAMP);
  }
  s.fill(cx - 3, cx + 3, F + 5, F + 5, 39, 39, GOLD);
  for (const ox of [cx - 3, cx + 3]) s.fill(ox, ox, F + 1, F + 4, 39, 39, COLUMN);
  s.fill(cx - 1, cx + 1, F + 6, F + 6, 39, 39, GLOW);

  // 11. Carve the portal shaft before mirroring, so both sides lose the same
  //     columns and the lit keel becomes the landing pad.
  s.carve(g.minX, g.maxX - 1, F - 7, F, g.minZ, g.maxZ - 1);

  // 12. Reflect the crimson half onto the cobalt half.
  for (const [key, block] of [...s.blocks]) {
    const lx = key % BRIDGE_SIZE_X;
    const rest = (key - lx) / BRIDGE_SIZE_X;
    const lz = rest % BRIDGE_SIZE_Z;
    const y = (rest - lz) / BRIDGE_SIZE_Z + PARTY_STAMP_MIN_Y;
    if (lz > BRIDGE_MIRROR / 2) continue;
    s.set(lx, y, bridgeMirrorZ(lz), bridgeSwapTeam(block));
  }
  bridgeStampCache = s;
  return s;
}

/** Where seat `seat` of `team` stands, in slot-local blocks. Seat 0 is dead
 *  centre on the lane; a 1v1 never uses another. */
function bridgeLane(seat: number): number {
  return BRIDGE_LANE_X + (seat === 0 ? 0 : (seat % 2 ? 2 : -2) * Math.ceil(seat / 2));
}
/** Spawn pad for one seat on one team, in world coordinates. */
export function bridgeSpawn(sub: PartySubBounds, team: number, seat: number): PartyVec3 {
  const lz = team === 0 ? BRIDGE_SPAWN_Z : BRIDGE_SIZE_Z - BRIDGE_SPAWN_Z;
  return { x: sub.minX + bridgeLane(seat) + .5, y: PARTY_FLOOR_Y + 1.01, z: sub.minZ + lz };
}
/** Inside the drop cage over that same pad: where a round, and every restart
 *  after a goal, actually begins. */
export function bridgeCageSpawn(sub: PartySubBounds, team: number, seat: number): PartyVec3 {
  const spawn = bridgeSpawn(sub, team, seat);
  return { ...spawn, y: PARTY_FLOOR_Y + BRIDGE_CAGE_FLOOR + 1.01 };
}
/** Every block of hatch under both cages, in slot-local coordinates. The
 *  server is the only caller: it deletes these to drop both players onto their
 *  decks together, and puts them back the moment a goal restarts the round. */
export function bridgeCageHatch(): readonly { lx: number; y: number; lz: number }[] {
  const cells: { lx: number; y: number; lz: number }[] = [];
  for (let lz = CAGE_Z0 + 1; lz < CAGE_Z1; lz++)
    for (let lx = CAGE_X0 + 1; lx < CAGE_X1; lx++) {
      cells.push({ lx, y: PARTY_FLOOR_Y + BRIDGE_CAGE_FLOOR, lz });
      cells.push({ lx, y: PARTY_FLOOR_Y + BRIDGE_CAGE_FLOOR, lz: bridgeMirrorZ(lz) });
    }
  return cells;
}

/** Which portal, if any, contains this slot-local point below the deck lip. */
export function bridgeGoalAt(lx: number, y: number, lz: number): number | null {
  if (y >= PARTY_FLOOR_Y - .5) return null;
  for (const g of BRIDGE_GOALS)
    if (lx >= g.minX && lx < g.maxX && lz >= g.minZ && lz < g.maxZ) return g.team;
  return null;
}

/** True where no player-placed block is allowed: the mouth of either portal. */
export function bridgeGoalGuard(lx: number, lz: number): boolean {
  return BRIDGE_GOALS.some((g) =>
    lx >= g.minX - GOAL_GUARD && lx < g.maxX + GOAL_GUARD &&
    lz >= g.minZ - GOAL_GUARD && lz < g.maxZ + GOAL_GUARD);
}

// ── Parkour ────────────────────────────────────────────────────────────────
// The course itself — mode, layout, deck, and every pad — is generated in
// parkour_course.ts; its moving parts live in parkour_mechanics.ts. This file
// only stamps it into the venue and keeps score.

export {
  parkourCourse, parkourNext, parkourLength, parkourVariant,
  type ParkourCourse, type ParkourPlatform, type ParkourJump, type ParkourMode,
} from './parkour_course';

export const PARKOUR_SIZE_X = 32;
export const PARKOUR_SIZE_Z = 448;
/** Rubber band for a runaway lead. A racer this many platforms behind the
 *  leader saves progress on EVERY pad they land, so a fall costs one jump, not
 *  a whole leg. Nobody is moved forward for free — every jump is still theirs
 *  to make — and it switches off the moment the gap closes. */
export const PARKOUR_CATCHUP_GAP = 8;

/** True while `p` is far enough behind the field to get catch-up checkpoints. */
export function parkourCatchUp(p: { progress: number }, field: Iterable<{ progress: number; connected: boolean }>): boolean {
  let lead = 0;
  for (const o of field) if (o.connected && o.progress > lead) lead = o.progress;
  return lead - p.progress >= PARKOUR_CATCHUP_GAP;
}

const parkourStampCache = new Map<number, VenueStamp>();
function parkourStamp(seed: number): VenueStamp {
  const cached = parkourStampCache.get(seed);
  if (cached) return cached;
  const s = new VenueStamp(PARKOUR_SIZE_X, PARKOUR_SIZE_Z);
  for (const c of parkourCourse(seed).cells)
    if (c.block === Block.Air) s.clear(c.x, c.y, c.z);
    else s.set(c.x, c.y, c.z, c.block);
  if (parkourStampCache.size > 24) parkourStampCache.delete(parkourStampCache.keys().next().value!);
  parkourStampCache.set(seed, s);
  return s;
}

// ── World queries ──────────────────────────────────────────────────────────

export function partyArenaBlockAt(x: number, y: number, z: number): number | null {
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z) ||
    x < PARTY_BASE_X || z < 0 || z >= PARTY_ARENA_SIZE_Z) return null;
  const slot = Math.floor((x - PARTY_BASE_X) / PARTY_SLOT_SPACING);
  const originX = PARTY_BASE_X + slot * PARTY_SLOT_SPACING;
  const bx = Math.floor(x), by = Math.floor(y), bz = Math.floor(z);
  if (by < PARTY_STAMP_MIN_Y || by > PARTY_STAMP_MAX_Y) return null;
  for (const game of PARTY_GAME_DEFS) {
    const lx = bx - (originX + game.insetX), lz = bz - game.originZ;
    if (lx < 0 || lx >= game.sizeX || lz < 0 || lz >= game.sizeZ) continue;
    const stamp = game.id === 'bridge' ? bridgeStamp() : parkourStamp(arenaSeeds.get(slot) ?? 1);
    return stamp.get(lx, by, lz);
  }
  return null;
}
export function partySolidAt(x: number, y: number, z: number): boolean {
  const b = partyArenaBlockAt(x, y, z);
  return b !== null && b !== Block.Air;
}

/** Spawn positions, in participant order. */
export function partySpawns(sub: PartySubBounds, members: readonly { team: number }[]): PartyVec3[] {
  if (sub.game === 'parkour') {
    const p = parkourCourse(sub.seed).start;
    return members.map((_, i) => ({
      x: sub.minX + p.x + (i % 2 ? .7 : -.7), y: p.y + .01, z: sub.minZ + p.z,
    }));
  }
  // The Bridge always opens inside the cages: the first thing either player
  // does is watch the hatch drop out from under them.
  const seats = [0, 0];
  return members.map((m) => bridgeCageSpawn(sub, m.team, seats[m.team]++));
}

// ── Lobby engine ───────────────────────────────────────────────────────────

export interface PartyIdentity { id: number; username: string; skin: number }

export interface PartyParticipant extends PartyIdentity {
  host: boolean;
  ready: boolean;
  connected: boolean;
  joinOrder: number;
  /** 0 or 1 on the Bridge; always 0 in Parkour. */
  team: number;
  /** Goals scored (Bridge) or platforms reached (Parkour). */
  score: number;
  /** Bridge PvP. A kill is not a goal — it is what buys you the crossing. */
  kills: number;
  deaths: number;
  /** Who last landed a hit, and when, for void-kill credit. */
  lastHitBy?: number;
  lastHitAt: number;
  checkpoint: number;
  progress: number;
  falls: number;
  /** Collapse Chase: falls left before you are out. */
  lives: number;
  /** Rising Void / Collapse Chase: when this racer was knocked out. */
  outAt?: number;
  finishedAt?: number;
  immuneUntil: number;
  /** Server-owned respawn request: a goal reset, or a fall into the void. */
  pendingSpawn: boolean;
}

export interface PartyRoundState {
  game: PartyGameId;
  index: number;
  startedAt: number;
  endsAt: number;
  revision: number;
}

export interface PartyResult {
  winner: number | null;
  /** Bridge only: which side took it. */
  winnerTeam: number | null;
  teamScores: [number, number];
  scoreboard: PartyParticipant[];
  finishReason: PartyFinishReason;
  durationMs: number;
  ranked: false;
}

export interface PartyLobbySnapshot {
  id: string;
  mode: PartyMode;
  revision: number;
  phase: PartyPhase;
  capacity: number;
  participants: PartyParticipant[];
  host: number;
  serverNow: number;
  countdownEndsAt?: number;
  arenaLoadDeadline?: number;
  /** Bridge only. Index is the team. */
  teamScores: [number, number];
  /** Wall clock until which a goal celebration holds everyone at their base. */
  goalResetAt?: number;
  /** Who scored the goal being celebrated, for the banner. */
  lastGoal?: { id: number; username: string; team: number; at: number };
  /** The most recent kill on the span, for the banner and the feed. */
  lastKill?: {
    id: number; username: string; victim: string; team: number; at: number;
    cause: 'melee' | 'bow' | 'void';
  };
  round?: PartyRoundState;
  arena?: PartyArenaBounds;
  sub?: PartySubBounds;
  result?: PartyResult;
  ranked: false;
}

interface PartyLobby extends Omit<PartyLobbySnapshot, 'participants' | 'serverNow' | 'ranked' | 'sub'> {
  token: string;
  participants: Map<number, PartyParticipant>;
  arenaReady: Set<number>;
  resultDeadline?: number;
  startedAt?: number;
}

/** Round order: a finisher first, then whoever lasted longest, then score,
 *  then whoever got there with fewer falls. */
export function orderPartyRound(ps: Iterable<PartyParticipant>): PartyParticipant[] {
  return [...ps].sort((a, b) =>
    Number(b.connected) - Number(a.connected) ||
    (a.finishedAt ?? Infinity) - (b.finishedAt ?? Infinity) ||
    (b.outAt ?? Infinity) - (a.outAt ?? Infinity) ||
    b.score - a.score || a.falls - b.falls || a.joinOrder - b.joinOrder);
}
/** Scoreboard order for The Bridge: winning side first, top scorer first. */
export function orderPartyTeams(ps: Iterable<PartyParticipant>, teamScores: readonly number[]): PartyParticipant[] {
  return [...ps].sort((a, b) =>
    (teamScores[b.team] ?? 0) - (teamScores[a.team] ?? 0) || a.team - b.team ||
    b.score - a.score || a.joinOrder - b.joinOrder);
}

export interface PartyCreateResult { token: string; snapshot: PartyLobbySnapshot }
export type PartyJoinResult =
  | { ok: true; snapshot: PartyLobbySnapshot }
  | { ok: false; reason: PartyJoinFailure };

export class PartyGamesEngine {
  private readonly lobbies = new Map<string, PartyLobby>();
  private readonly lobbyByPlayer = new Map<number, PartyLobby>();
  private readonly usedSlots = new Set<number>();
  private nextId = 1;
  private seedCounter = 0;
  /** What each player raced last, so the next match is never the same kind
   *  of match: not the same mode, not the same layout, not the same world. */
  private readonly lastParkour = new Map<number, { theme: number; mode: ParkourMode; layout: ParkourLayout }>();
  private themeBag: number[] = [];
  private modeBag: ParkourMode[] = [];
  private readonly layoutBags = new Map<ParkourMode, ParkourLayout[]>();
  constructor(private readonly tokenFactory: () => string) { }

  private static blank(identity: PartyIdentity, host: boolean, joinOrder: number): PartyParticipant {
    return {
      ...identity, host, ready: false, connected: true, joinOrder, team: 0, score: 0,
      kills: 0, deaths: 0, lastHitBy: undefined, lastHitAt: 0,
      checkpoint: 0, progress: 0, falls: 0, lives: 0, immuneUntil: 0, pendingSpawn: false,
    };
  }

  /** Even sides, stable under joins and leaves. Parkour has no teams. */
  private assignTeams(l: PartyLobby): void {
    const ordered = [...l.participants.values()].sort((a, b) => a.joinOrder - b.joinOrder);
    ordered.forEach((p, i) => { p.team = l.mode === 'bridge' ? i % 2 : 0; });
  }

  private teamScores(l: PartyLobby): [number, number] {
    const scores: [number, number] = [0, 0];
    for (const p of l.participants.values()) scores[p.team] += p.score;
    return scores;
  }

  create(identity: PartyIdentity, now: number, mode: PartyMode = 'bridge'):
    PartyCreateResult | { reason: 'already_in_lobby' } {
    if (this.lobbyByPlayer.has(identity.id)) return { reason: 'already_in_lobby' };
    const token = this.tokenFactory();
    const p = PartyGamesEngine.blank(identity, true, 0);
    const lobby: PartyLobby = {
      id: `P${this.nextId++}`, token, mode, revision: 0, phase: 'lobby',
      capacity: PARTY_CAPACITY,
      participants: new Map([[p.id, p]]), host: p.id, teamScores: [0, 0],
      arenaReady: new Set(),
    };
    this.lobbies.set(token, lobby);
    this.lobbyByPlayer.set(p.id, lobby);
    this.assignTeams(lobby);
    return { token, snapshot: this.snapshotLobby(lobby, now) };
  }

  join(token: string, identity: PartyIdentity, now: number): PartyJoinResult {
    if (this.lobbyByPlayer.has(identity.id)) return { ok: false, reason: 'already_in_lobby' };
    const l = this.lobbies.get(token);
    if (!l) return { ok: false, reason: 'invalid' };
    if (l.phase !== 'lobby') return { ok: false, reason: 'match_in_progress' };
    if (l.participants.size >= l.capacity) return { ok: false, reason: 'full' };
    const joinOrder = Math.max(...[...l.participants.values()].map((v) => v.joinOrder)) + 1;
    const p = PartyGamesEngine.blank(identity, false, joinOrder);
    for (const v of l.participants.values()) v.ready = false;
    l.participants.set(p.id, p);
    this.lobbyByPlayer.set(p.id, l);
    this.assignTeams(l);
    return { ok: true, snapshot: this.snapshotLobby(l, now) };
  }

  leave(id: number, now: number): { snapshot?: PartyLobbySnapshot; deleted: boolean; token?: string } {
    const l = this.lobbyByPlayer.get(id);
    if (!l) return { deleted: false };
    this.lobbyByPlayer.delete(id);
    const p = l.participants.get(id)!;
    p.connected = false;
    p.ready = false;
    if (l.phase === 'lobby') l.participants.delete(id);
    const remaining = [...l.participants.values()].filter((v) => v.connected);
    if (!remaining.length) {
      this.release(l);
      this.lobbies.delete(l.token);
      return { deleted: true, token: l.token };
    }
    l.host = remaining[0].id;
    for (const v of l.participants.values()) {
      v.host = v.id === l.host;
      if (l.phase === 'lobby') v.ready = false;
    }
    if (l.phase === 'lobby') this.assignTeams(l);
    if (remaining.length < 2 && l.phase !== 'lobby' && l.phase !== 'results')
      this.finish(l, now, remaining[0].id, 'forfeit');
    else if (l.phase === 'countdown') this.arm(l, now);
    return { deleted: false, snapshot: this.snapshotLobby(l, now) };
  }

  setReady(id: number, ready: boolean, now: number): PartyLobbySnapshot | null {
    const l = this.lobbyByPlayer.get(id);
    if (!l || l.phase !== 'lobby') return null;
    l.participants.get(id)!.ready = ready;
    return this.snapshotLobby(l, now);
  }

  start(id: number, now: number): { ok: true; snapshot: PartyLobbySnapshot } | { ok: false; reason: PartyStartFailure } {
    const l = this.lobbyByPlayer.get(id);
    if (!l || l.phase !== 'lobby') return { ok: false, reason: 'not_in_lobby' };
    if (l.host !== id) return { ok: false, reason: 'not_host' };
    if (l.participants.size < PARTY_MIN_PLAYERS) return { ok: false, reason: 'too_few_players' };
    if ([...l.participants.values()].some((p) => !p.ready)) return { ok: false, reason: 'not_everyone_ready' };
    let slot = 0;
    while (this.usedSlots.has(slot)) slot++;
    if (slot >= PARTY_ARENA_SLOTS) return { ok: false, reason: 'no_arena' };
    this.usedSlots.add(slot);
    // Random secret token + monotonic counter produces a fresh course on every replay.
    let seed = ++this.seedCounter;
    for (const c of this.tokenFactory()) seed = partyHash(seed, c.charCodeAt(0));
    if (l.mode === 'parkour') {
      const last = [...l.participants.keys()].map((v) => this.lastParkour.get(v));
      /** Shuffle-bag draw: every option comes round before any repeats, and
       *  nothing either racer just played is drawn while anything else is left. */
      const drawFrom = <T>(bag: T[], all: readonly T[], excluded: Set<T | undefined>): T => {
        if (!bag.length) bag.push(...[...all].sort((a, b) =>
          partyHash(seed, all.indexOf(a) + 31) - partyHash(seed, all.indexOf(b) + 31)));
        const next = bag.findIndex((t) => !excluded.has(t));
        return next >= 0 ? bag.splice(next, 1)[0] : all.find((t) => !excluded.has(t)) ?? bag.splice(0, 1)[0];
      };
      const theme = drawFrom(this.themeBag, PARKOUR_THEMES.map((_, i) => i), new Set(last.map((v) => v?.theme)));
      const mode = drawFrom(this.modeBag, PARKOUR_MODES, new Set(last.map((v) => v?.mode)));
      let layouts = this.layoutBags.get(mode);
      if (!layouts) this.layoutBags.set(mode, layouts = []);
      const layout = drawFrom(layouts, PARKOUR_MODE_LAYOUTS[mode], new Set(last.map((v) => v?.layout)));
      seed = encodeParkourSeed(seed, theme, mode, layout);
      for (const v of l.participants.keys()) this.lastParkour.set(v, { theme, mode, layout });
    }
    l.arena = partyArenaBounds(slot, seed);
    registerPartyArena(l.arena);
    l.result = undefined;
    l.startedAt = now;
    this.assignTeams(l);
    this.prepare(l, now);
    return { ok: true, snapshot: this.snapshotLobby(l, now) };
  }

  private prepare(l: PartyLobby, now: number): void {
    l.phase = 'countdown';
    l.revision++;
    l.arenaReady.clear();
    l.countdownEndsAt = undefined;
    l.arenaLoadDeadline = now + PARTY_ARENA_LOAD_TIMEOUT_MS;
    l.goalResetAt = undefined;
    l.lastGoal = undefined;
    l.lastKill = undefined;
    l.teamScores = [0, 0];
    const game = partyGame(l.mode);
    l.round = { game: game.id, index: game.index, startedAt: 0, endsAt: 0, revision: l.revision };
    const lives = l.mode === 'parkour' && l.arena && parkourCourse(l.arena.seed).variant.mode === 'collapse'
      ? COLLAPSE_LIVES : 0;
    for (const p of l.participants.values())
      Object.assign(p, {
        score: 0, kills: 0, deaths: 0, lastHitBy: undefined, lastHitAt: 0,
        progress: 0, checkpoint: 0, falls: 0, lives, outAt: undefined,
        finishedAt: undefined, immuneUntil: 0, pendingSpawn: false,
      });
  }

  markArenaReady(id: number, now: number, revision?: number): PartyLobbySnapshot | null {
    const l = this.lobbyByPlayer.get(id);
    if (!l || l.phase !== 'countdown' || revision !== l.revision || l.countdownEndsAt !== undefined) return null;
    l.arenaReady.add(id);
    this.arm(l, now);
    return this.snapshotLobby(l, now);
  }

  private arm(l: PartyLobby, now: number): void {
    if (l.countdownEndsAt !== undefined) return;
    if ([...l.participants.values()].filter((p) => p.connected).every((p) => l.arenaReady.has(p.id)))
      l.countdownEndsAt = now + PARTY_COUNTDOWN_MS;
  }

  tick(now: number): PartyLobbySnapshot[] {
    const changed: PartyLobbySnapshot[] = [];
    for (const l of this.lobbies.values()) {
      let dirty = false;
      if (l.phase === 'countdown') {
        if (l.countdownEndsAt !== undefined && now >= l.countdownEndsAt) {
          l.phase = 'running';
          l.round!.startedAt = now;
          l.round!.endsAt = now + partyGame(l.round!.game).durationMs;
          dirty = true;
        } else if (l.countdownEndsAt === undefined && now >= l.arenaLoadDeadline!) {
          this.finish(l, now, null, 'cancelled');
          dirty = true;
        }
      } else if (l.phase === 'running' && now >= l.round!.endsAt) {
        this.endMatch(l, now);
        dirty = true;
      } else if (l.phase === 'results' && now >= l.resultDeadline!) {
        l.phase = 'lobby';
        this.release(l);
        l.round = undefined;
        l.goalResetAt = undefined;
        l.lastGoal = undefined;
        l.lastKill = undefined;
        for (const [id, p] of l.participants) {
          if (!p.connected) l.participants.delete(id);
          else p.ready = false;
        }
        this.assignTeams(l);
        dirty = true;
      }
      if (dirty) changed.push(this.snapshotLobby(l, now));
    }
    return changed;
  }

  /** Two live Bridge players on OPPOSITE sides, neither of them shielded.
   *  Every combat validation on the server starts here. */
  canFight(attackerId: number, targetId: number, now: number): boolean {
    const l = this.lobbyByPlayer.get(attackerId);
    if (!l || l !== this.lobbyByPlayer.get(targetId) || l.mode !== 'bridge' || l.phase !== 'running')
      return false;
    if (l.goalResetAt !== undefined && now < l.goalResetAt) return false;
    const a = l.participants.get(attackerId), b = l.participants.get(targetId);
    return !!a && !!b && a.connected && b.connected && a.team !== b.team &&
      !a.pendingSpawn && !b.pendingSpawn && now >= b.immuneUntil;
  }

  /** Record that `attacker` damaged `victim`, so a fall in the next ten
   *  seconds is attributed to them. Returns nothing: damage itself is the
   *  transport layer's business, not the lobby's. */
  recordHit(victimId: number, attackerId: number, now: number): void {
    const victim = this.lobbyByPlayer.get(victimId)?.participants.get(victimId);
    if (victim) { victim.lastHitBy = attackerId; victim.lastHitAt = now; }
  }

  /** A player was killed outright (not a void fall). The victim is sent home
   *  on the next evaluation, exactly like a goal reset. */
  recordDeath(victimId: number, killerId: number | null, now: number,
    cause: 'melee' | 'bow' | 'void' = 'melee'): PartyLobbySnapshot | null {
    const l = this.lobbyByPlayer.get(victimId), victim = l?.participants.get(victimId);
    if (!l || !victim) return null;
    victim.deaths++;
    victim.pendingSpawn = true;
    victim.lastHitBy = undefined;
    const killer = killerId === null ? undefined : l.participants.get(killerId);
    if (killer && killer.team !== victim.team) {
      killer.kills++;
      l.lastKill = { id: killer.id, username: killer.username, victim: victim.username, team: killer.team, at: now, cause };
    }
    return this.snapshotLobby(l, now);
  }

  /** Evaluate an accepted position, or a stationary player on the server tick.
   *  Returned spawn is an authoritative reset, never a client claim. */
  evaluate(id: number, pos: PartyVec3, now: number): { spawn?: PartyVec3; changed: boolean } {
    const l = this.lobbyByPlayer.get(id), p = l?.participants.get(id);
    if (!l || !p || l.phase !== 'running' || !l.round || !l.arena || !p.connected ||
      p.finishedAt !== undefined || p.outAt !== undefined || now >= l.round.endsAt) return { changed: false };
    const sub = this.subFor(id)!;
    return sub.game === 'bridge' ? this.evaluateBridge(l, p, sub, pos, now)
      : this.evaluateParkour(l, p, sub, pos, now);
  }

  private evaluateBridge(l: PartyLobby, p: PartyParticipant, sub: PartySubBounds, pos: PartyVec3, now: number):
    { spawn?: PartyVec3; changed: boolean } {
    const seat = [...l.participants.values()].filter((v) => v.team === p.team && v.joinOrder < p.joinOrder).length;
    // A goal puts everybody back in a cage; an ordinary void death just puts
    // you back on your own deck, with no pause in the game for anyone else.
    const home = (): { spawn: PartyVec3; changed: boolean } => {
      const caged = l.goalResetAt !== undefined && now < l.goalResetAt;
      p.pendingSpawn = false;
      // A caged player's shield starts when the hatch does, so nobody lands
      // out of one straight into a waiting axe.
      p.immuneUntil = (caged ? l.goalResetAt! : now) + BRIDGE_RESPAWN_SHIELD_MS;
      return {
        spawn: caged ? bridgeCageSpawn(sub, p.team, seat) : bridgeSpawn(sub, p.team, seat),
        changed: true,
      };
    };
    if (p.pendingSpawn) return home();
    const lx = Math.floor(pos.x - sub.minX), lz = Math.floor(pos.z - sub.minZ);
    const goal = bridgeGoalAt(lx, pos.y, lz);
    if (goal !== null) {
      // Your own portal is a hole, not a target: you get fished out of it.
      if (goal === p.team) { p.falls++; return home(); }
      p.score++;
      l.teamScores = this.teamScores(l);
      l.goalResetAt = now + BRIDGE_GOAL_RESET_MS;
      l.lastGoal = { id: p.id, username: p.username, team: p.team, at: now };
      for (const v of l.participants.values()) if (v.connected) v.pendingSpawn = true;
      if (l.teamScores[p.team] >= BRIDGE_GOAL_LIMIT) {
        this.endMatch(l, now);
        return { changed: true };
      }
      return home();
    }
    if (pos.y < PARTY_VOID_Y) {
      p.falls++;
      p.deaths++;
      // Knocking somebody off the span is the mode's signature kill, so a
      // recent hit still owns the fall that follows it.
      const killer = p.lastHitBy !== undefined && now - p.lastHitAt <= BRIDGE_KILL_CREDIT_MS
        ? l.participants.get(p.lastHitBy) : undefined;
      if (killer && killer.team !== p.team) {
        killer.kills++;
        l.lastKill = { id: killer.id, username: killer.username, victim: p.username, team: killer.team, at: now, cause: 'void' };
      }
      p.lastHitBy = undefined;
      return home();
    }
    return { changed: false };
  }

  private evaluateParkour(l: PartyLobby, p: PartyParticipant, sub: PartySubBounds, pos: PartyVec3, now: number):
    { spawn?: PartyVec3; changed: boolean } {
    const course = parkourCourse(sub.seed), mode = course.variant.mode;
    const t = now - l.round!.startedAt;
    const at = (order: number): PartyVec3 => {
      const base = course.steps[Math.max(0, Math.min(order, course.steps.length - 1))][0];
      return { x: sub.minX + base.x, y: base.y + .01, z: sub.minZ + base.z };
    };
    /** Knocked out: no more spawns, and the match ends once one is left. */
    const out = (): { changed: boolean } => {
      p.outAt = now;
      p.pendingSpawn = false;
      const alive = [...l.participants.values()].filter((v) => v.connected && v.outAt === undefined);
      if (alive.length <= 1) this.endMatch(l, now);
      return { changed: true };
    };
    const reset = (): { spawn?: PartyVec3; changed: boolean } => {
      p.falls++;
      p.immuneUntil = now + 1400;
      p.pendingSpawn = false;
      if (mode === 'collapse') {
        // A fall costs a life and puts you back just ahead of the front —
        // or at your own progress, if you were never caught up by it.
        if (--p.lives <= 0) return out();
        const front = Math.floor(parkourCollapseFront(t));
        const back = Math.max(p.checkpoint, front + COLLAPSE_RESPAWN_LEAD);
        if (back >= course.steps.length - 1) return out();
        p.progress = p.checkpoint = back;
        p.score = Math.max(p.score, p.progress);
        return { spawn: at(p.progress), changed: true };
      }
      if (mode === 'void') {
        // The saved pad has to still be above the void to stand on.
        const base = course.steps[p.checkpoint][0];
        if (base.y < parkourVoidY(course, t) + 1.5) return out();
      }
      p.progress = p.checkpoint;
      return { spawn: at(p.checkpoint), changed: true };
    };
    if (p.pendingSpawn) return reset();
    // A tower is tall: a fall well past the pads you were jumping between is
    // a fall, even though there is still a long way to the bottom of it.
    const here = course.steps[p.progress]?.[0], ahead = course.steps[p.progress + 1]?.[0];
    const floor = Math.min(here?.y ?? Infinity, ahead?.y ?? Infinity) - 8;
    if (pos.y < PARTY_VOID_Y || pos.y < course.lowY - 5 || pos.y < floor) return reset();
    if (mode === 'void' && pos.y < parkourVoidY(course, t)) return reset();
    for (const next of course.steps[p.progress + 1] ?? []) {
      if (Math.abs(pos.x - sub.minX - next.x) >= next.width / 2 + .35 ||
        Math.abs(pos.z - sub.minZ - next.z) >= next.depth / 2 + .35 ||
        Math.abs(pos.y - next.y) >= .35) continue;
      // Checked before the step, against the lead as it stood when they jumped.
      const trailing = parkourCatchUp(p, l.participants.values());
      p.progress++;
      p.score = Math.max(p.score, p.progress);
      if (next.checkpoint || trailing) p.checkpoint = p.progress;
      if (p.progress === course.steps.length - 1) {
        p.finishedAt = now;
        this.endMatch(l, now);
      }
      return { changed: true };
    }
    return { changed: false };
  }

  private endMatch(l: PartyLobby, now: number): void {
    if (l.mode === 'bridge') {
      const scores = this.teamScores(l);
      l.teamScores = scores;
      const team = scores[0] === scores[1] ? null : scores[0] > scores[1] ? 0 : 1;
      const best = team === null ? null
        : orderPartyRound([...l.participants.values()].filter((p) => p.team === team))[0]?.id ?? null;
      this.finish(l, now, best, 'complete', team);
      return;
    }
    const board = orderPartyRound(l.participants.values());
    const tied = board[0].score === board[1]?.score && board[0].falls === board[1]?.falls &&
      !board[0].finishedAt && board[0].outAt === board[1]?.outAt;
    this.finish(l, now, tied ? null : board[0].id, 'complete');
  }

  private finish(l: PartyLobby, now: number, winner: number | null, reason: PartyFinishReason, winnerTeam: number | null = null): void {
    l.phase = 'results';
    l.resultDeadline = now + PARTY_RESULT_MS;
    l.goalResetAt = undefined;
    const teamScores = this.teamScores(l);
    l.teamScores = teamScores;
    const board = l.mode === 'bridge'
      ? orderPartyTeams(l.participants.values(), teamScores)
      : orderPartyRound(l.participants.values());
    l.result = {
      winner, winnerTeam, teamScores,
      scoreboard: board.map((p) => ({ ...p })),
      finishReason: reason, durationMs: Math.max(0, now - (l.startedAt ?? now)), ranked: false,
    };
  }

  private release(l: PartyLobby): void {
    if (l.arena) {
      this.usedSlots.delete(l.arena.slot);
      arenaSeeds.delete(l.arena.slot);
      parkourStampCache.delete(l.arena.seed);
    }
    l.arena = undefined;
  }

  private snapshotLobby(l: PartyLobby, now: number): PartyLobbySnapshot {
    return {
      id: l.id, mode: l.mode, revision: l.revision, phase: l.phase, capacity: l.capacity,
      participants: [...l.participants.values()].map((p) => ({ ...p })), host: l.host, serverNow: now,
      countdownEndsAt: l.countdownEndsAt, arenaLoadDeadline: l.arenaLoadDeadline,
      teamScores: [...l.teamScores] as [number, number], goalResetAt: l.goalResetAt,
      lastGoal: l.lastGoal, lastKill: l.lastKill,
      round: l.round ? { ...l.round } : undefined, arena: l.arena,
      sub: l.arena && l.round ? partySubBounds(l.arena.slot, l.round.index, l.arena.seed) : undefined,
      result: l.result, ranked: false,
    };
  }

  snapshotFor(id: number, now: number): PartyLobbySnapshot | null {
    const l = this.lobbyByPlayer.get(id);
    return l ? this.snapshotLobby(l, now) : null;
  }
  snapshots(now: number): PartyLobbySnapshot[] { return [...this.lobbies.values()].map((l) => this.snapshotLobby(l, now)); }
  phaseFor(id: number): PartyPhase | null { return this.lobbyByPlayer.get(id)?.phase ?? null; }
  arenaFor(id: number): PartyArenaBounds | null { return this.lobbyByPlayer.get(id)?.arena ?? null; }
  subFor(id: number): PartySubBounds | null {
    const l = this.lobbyByPlayer.get(id);
    return l?.arena && l.round ? partySubBounds(l.arena.slot, l.round.index, l.arena.seed) : null;
  }
  roundFor(id: number): PartyRoundState | null { return this.lobbyByPlayer.get(id)?.round ?? null; }
  participantFor(id: number): PartyParticipant | null { return this.lobbyByPlayer.get(id)?.participants.get(id) ?? null; }
  tokenFor(id: number): string | null { return this.lobbyByPlayer.get(id)?.token ?? null; }
  membersOf(id: number): number[] {
    return [...(this.lobbyByPlayer.get(id)?.participants.values() ?? [])].filter((p) => p.connected).map((p) => p.id);
  }
  sameMatch(a: number, b: number): boolean {
    const l = this.lobbyByPlayer.get(a);
    return !!l && l === this.lobbyByPlayer.get(b) && l.phase === 'running';
  }
}
