// Shared geometry and authoritative round state for The Bridge and Parkour.
// All gameplay clocks are server milliseconds. Snapshots contain everything
// needed to recover the presentation; clients never choose spawns or winners.
//
// The two modes share one match engine and one isolated session transport
// (the `pg*` message family); they differ only in the venue they stamp and in
// what `evaluate` counts as progress. Every match is its own world (see
// multiverse.ts): a venue is authored at that world's origin, so there are no
// arena slots and no cap on simultaneous matches.
import { Block } from './blocks';
import { meleeSwing, type SwingInput, type SwingResult } from './melee';
import { PARKOUR_THEMES } from './parkour_themes';
import { encodeParkourSeed, parkourCourse, parkourStandSpot, type SetPieceId } from './parkour_course';
import {
  DRAGON_GRACE_MS, DRAGON_IMMUNE_MS, DRAGON_LAIR_FRONT, DRAGON_LIVES, DRAGON_RESPAWN_LEAD, DRAGON_SURGE,
  DRAGON_SURGE_GAP, dragonBaseSpeed,
} from './parkour_mechanics';
import { parkourVenue, type ParkourVenue } from './parkour_setpieces';

import { PARKOUR_VENUE_X, PARKOUR_VENUE_Z, PARTY_FLOOR_Y, PARTY_STAMP_MAX_Y, PARTY_STAMP_MIN_Y } from './venue_dims';

export { PARTY_FLOOR_Y, PARTY_STAMP_MAX_Y, PARTY_STAMP_MIN_Y };
export const PARTY_VOID_Y = 118;
export const PARTY_CEILING_Y = 190;
export const PARTY_MAX_HEALTH = 20;
export const PARTY_AMBIENT_LIGHT = 0.8;
/** The Bridge is strictly 1v1: a duel over a one-block span, where a second
 *  body on your own side has nowhere to stand and nothing to do. */
const BRIDGE_CAPACITY = 2;
/** Parkour from matchmaking is two runners; a party can bring up to four. */
const PARKOUR_QUEUE_CAPACITY = 2;
const PARKOUR_PARTY_CAPACITY = 4;
const PARTY_MIN_PLAYERS = 2;
/** Most racers/fighters one match of `mode` can hold. */
export function partyModeCapacity(mode: PartyMode, fromParty: boolean): number {
  return mode === 'bridge' ? BRIDGE_CAPACITY : fromParty ? PARKOUR_PARTY_CAPACITY : PARKOUR_QUEUE_CAPACITY;
}
export const PARTY_COUNTDOWN_MS = 3000;
const PARTY_ARENA_LOAD_TIMEOUT_MS = 30000;
const PARTY_RESULT_MS = 20000;
/** Goals that take a game of The Bridge. */
export const BRIDGE_GOAL_LIMIT = 5;
/** A goal restarts the round: both players are shut back into their own drop
 *  cage and held there for this long, counted down on the HUD, before the
 *  hatches open again. Deliberately the same three seconds as the opening
 *  countdown — a restart should feel like the round starting over. */
export const BRIDGE_GOAL_RESET_MS = 3000;
/** Bridge attacks have fixed strength. Short action intervals bound packet
 * spam; waiting never earns extra damage or knockback. */
const BRIDGE_RESPAWN_SHIELD_MS = 1800;
/** Dead in The Bridge: this long as a flying spectator before you respawn. */
const BRIDGE_RESPAWN_DELAY_MS = 3000;
export const BRIDGE_MELEE_TIER = { damage: 5, cooldownMs: 280, kbBonus: 0.02 } as const;
/** How early (ms) a swing may ARRIVE against the cooldown and still count.
 *  The client paces the axe at exactly `cooldownMs`, but packets bunch up on
 *  the way: judged to the millisecond, a held button dropped roughly one hit
 *  in five as "spam", and those were the swings that felt like they went
 *  straight through somebody. Small enough that no client can gain a real
 *  extra swing from it. */
export const BRIDGE_SWING_JITTER_MS = 60;
const BRIDGE_KILL_CREDIT_MS = 10_000;
/** One arrow every five seconds: the bow is a finisher, not a spray. */
export const BRIDGE_BOW_COOLDOWN_MS = 5000;
export const BRIDGE_ARROW_SPEED = 62;
export const BRIDGE_ARROW_GRAVITY = 19;
export const BRIDGE_ARROW_LIFE_MS = 5000;
const BRIDGE_ARROW_DAMAGE = 7;
const BRIDGE_ARROW_KB = 0.55;
export const BRIDGE_ARROW_KB_VERT = 0.3;

/** Keep movement crits, directional sprint knockback and earned combos, with
 * full-strength contact on every accepted swing, including the first one. */
export function bridgeSwing(input: Omit<SwingInput, 'tier' | 'sinceLastSwingMs' | 'critFallVy'>): SwingResult {
  // About 0.9 m/s downward: past the apex of an ordinary 1.25-block jump.
  return meleeSwing({ ...input, tier: BRIDGE_MELEE_TIER, critFallVy: -.015,
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
type PartyPhase = 'lobby' | 'countdown' | 'running' | 'results';
type PartyFinishReason = 'complete' | 'forfeit' | 'cancelled';
type PartyJoinFailure = 'invalid' | 'full' | 'match_in_progress' | 'already_in_lobby';
type PartyStartFailure = 'not_host' | 'too_few_players' | 'too_many_players' | 'not_everyone_ready' | 'not_in_lobby';

export interface PartyVec3 { x: number; y: number; z: number }

/** A venue's footprint in its own world. Always at the origin. */
export interface PartyArenaBounds {
  seed: number;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  floor: number;
  ceiling: number;
}
export interface PartySubBounds extends PartyArenaBounds {
  game: PartyGameId;
}

/** A mode's venue footprint, in blocks from its world's origin. */
interface PartyVenue { sizeX: number; sizeZ: number }

interface PartyGameDef extends PartyVenue {
  id: PartyGameId;
  title: string;
  rule: string;
  durationMs: number;
}

const PARTY_GAME_DEFS: readonly PartyGameDef[] = [
  {
    id: 'bridge', title: 'THE BRIDGE',
    rule: `Iron axe, bow and wool. Sprint-hit rivals off the span, then dive into the enemy portal. First to ${BRIDGE_GOAL_LIMIT} goals.`,
    durationMs: 480_000, sizeX: 24, sizeZ: 80,
  },
  {
    id: 'parkour', title: 'DRAGON CHASE',
    rule: 'Outrun the dragon to the end. Three lives. Everyone who makes it wins.',
    // No clock on the HUD: the dragon only ever speeds up, so every run ends.
    // This is a failsafe, never a rule anybody plays against.
    durationMs: 1_200_000, sizeX: PARKOUR_VENUE_X, sizeZ: PARKOUR_VENUE_Z,
  },
];
export function partyGame(id: PartyGameId): PartyGameDef {
  return PARTY_GAME_DEFS.find((g) => g.id === id) ?? PARTY_GAME_DEFS[0];
}

export function partyHash(seed: number, n: number): number {
  let h = (seed ^ Math.imul(n + 1, 0x9e3779b9)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x21f0aaad);
  h = Math.imul(h ^ (h >>> 15), 0x735a2d97);
  return (h ^ (h >>> 15)) >>> 0;
}

/** A mode's venue in its own world, carrying the course seed. */
function partyArenaBounds(game: PartyGameId, seed: number): PartyArenaBounds {
  const def = partyGame(game);
  return {
    seed, minX: 0, maxX: def.sizeX, minZ: 0, maxZ: def.sizeZ,
    floor: PARTY_FLOOR_Y, ceiling: PARTY_CEILING_Y,
  };
}
function partySubBounds(game: PartyGameId, seed: number): PartySubBounds {
  const def = partyGame(game);
  return { ...partyArenaBounds(game, seed), game: def.id };
}
export function clampToPartySub(p: PartyVec3, sub: PartySubBounds): PartyVec3 {
  return {
    x: Math.max(sub.minX + .3, Math.min(sub.maxX - .3, p.x)),
    y: Math.max(PARTY_VOID_Y - 2, Math.min(sub.ceiling - 1.8, p.y)),
    z: Math.max(sub.minZ + .3, Math.min(sub.maxZ - .3, p.z)),
  };
}

// ── Venue stamps ───────────────────────────────────────────────────────────
// Both venues are authored into a sparse block map keyed by venue-local
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

const BRIDGE_SIZE_X = 24;
const BRIDGE_SIZE_Z = 80;
/** Reflection axis. `BRIDGE_SIZE_Z - 1 - lz` maps crimson to cobalt in BLOCKS;
 *  a continuous z mirrors as `BRIDGE_SIZE_Z - z`, which is the same axis. */
const BRIDGE_MIRROR = BRIDGE_SIZE_Z - 1;
/** Team wool, indexed by team. Placeable, and the only block players may add. */
export const BRIDGE_TEAM_BLOCK = [Block.TeamWoolA, Block.TeamWoolB] as const;
export const BRIDGE_TEAM_NAME = ['CRIMSON', 'COBALT'] as const;
/** The crimson base's footprint, venue-local and inclusive. */
const BASE_X0 = 4, BASE_X1 = 20, BASE_Z0 = 2, BASE_Z1 = 18;
/** Scoring portal footprints, in venue-local blocks. Half-open on max. */
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

/** Where seat `seat` of `team` stands, in venue-local blocks. Seat 0 is dead
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
/** Every block of hatch under both cages, in venue-local coordinates. The
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

/** Which portal, if any, contains this venue-local point below the deck lip. */
function bridgeGoalAt(lx: number, y: number, lz: number): number | null {
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
// The route — every pad — is generated in parkour_course.ts, the builds round
// it in parkour_setpieces.ts, and the moving parts (the dragon among them) in
// parkour_mechanics.ts. This file stamps the venue and keeps the score.

export {
  parkourCourse, parkourNext, parkourLength, parkourVariant,
  type ParkourCourse, type ParkourPlatform, type ParkourJump,
} from './parkour_course';

const parkourStampCache = new Map<number, ParkourVenue>();
function parkourStamp(seed: number): ParkourVenue {
  const cached = parkourStampCache.get(seed);
  if (cached) return cached;
  const s = parkourVenue(seed);
  if (parkourStampCache.size > 24) parkourStampCache.delete(parkourStampCache.keys().next().value!);
  parkourStampCache.set(seed, s);
  return s;
}
/** `partyVenueBlockAt` bound to one venue: the stamp is resolved once, so a
 *  world's generator never goes back through the shared course cache. */
export function partyVenueLookup(game: PartyGameId, seed: number): (x: number, y: number, z: number) => number {
  const stamp = game === 'bridge' ? bridgeStamp() : parkourStamp(seed);
  return (x, y, z) => stamp.get(Math.floor(x), Math.floor(y), Math.floor(z));
}
/** Forget a finished course's stamp (the server calls this when a world ends). */
function releaseParkourStamp(seed: number): void { parkourStampCache.delete(seed); }

/** Spawn positions, in participant order. */
export function partySpawns(sub: PartySubBounds, members: readonly { team: number }[]): PartyVec3[] {
  if (sub.game === 'parkour') {
    // Side by side across the 5x5 start pad: two racers stand either side of
    // the centre line, a party of four spreads out so nobody spawns inside
    // anybody else.
    const course = parkourCourse(sub.seed), p = course.start;
    const lanes = members.length <= 2 ? [-.7, .7] : [-1.6, -.55, .55, 1.6];
    return members.map((_, i) => {
      const x = p.x + (lanes[i % lanes.length] ?? 0);
      // Only ever onto open floor: a lane that meets anything solid moves to
      // the nearest clear spot on the pad.
      const cell = Math.floor(x), clear = parkourStandSpot(course, p, { x: cell + .5, z: p.z });
      const free = Math.floor(clear.x) === cell && Math.floor(clear.z) === Math.floor(p.z);
      return free ? { x: sub.minX + x, y: p.y + .01, z: sub.minZ + p.z }
        : { x: sub.minX + clear.x, y: clear.y + .01, z: sub.minZ + clear.z };
    });
  }
  // The Bridge always opens inside the cages: the first thing either player
  // does is watch the hatch drop out from under them.
  const seats = [0, 0];
  return members.map((m) => bridgeCageSpawn(sub, m.team, seats[m.team]++));
}

// ── Lobby engine ───────────────────────────────────────────────────────────

interface PartyIdentity { id: number; username: string; bot?: boolean }

export interface PartyParticipant extends PartyIdentity {
  ready: boolean;
  connected: boolean;
  joinOrder: number;
  /** 0 or 1 on the Bridge; always 0 in Parkour. */
  team: number;
  /** Goals scored (Bridge) or furthest platform reached (Parkour). */
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
  /** Parkour: lives left. */
  lives: number;
  /** Parkour: when this runner lost their last life (or left mid-run). */
  outAt?: number;
  finishedAt?: number;
  /** Parkour: 1 for the first runner to make it, 2 for the next… */
  place?: number;
  /** Parkour: how the last life was lost, for the HUD. */
  lastLife?: { at: number; cause: ParkourHurt };
  /** Parkour: a life the server has taken and not yet applied. */
  hurtCause?: ParkourHurt;
  immuneUntil: number;
  /** Server-owned respawn request: a goal reset, or a fall into the void. */
  pendingSpawn: boolean;
  /** Bridge: dead and spectating until this time. */
  respawnAt?: number;
}

/** How a Parkour runner can lose a life. */
export type ParkourHurt = 'fall' | 'dragon' | 'fire' | 'left';

/** The dragon: which course order it has reached, as of server time `at`. */
export interface PartyDragon { front: number; speed: number; at: number }

/** One runner's line on a Dragon Chase result. */
export interface ParkourRunnerResult {
  id: number;
  username: string;
  made: boolean;
  /** 1st, 2nd… to make it. */
  place?: number;
  /** Start to finish, ms. */
  timeMs?: number;
  livesLeft: number;
  /** 1 = the first to fall out of the run. */
  fellOrder?: number;
  /** Furthest pad reached. */
  reached: number;
  left: boolean;
}

interface PartyRoundState {
  game: PartyGameId;
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
  /** Parkour: who made it, and who fell (in the order they fell). */
  runners?: ParkourRunnerResult[];
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
  /** Parkour: the dragon. */
  dragon?: PartyDragon;
}

interface PartyLobby extends Omit<PartyLobbySnapshot, 'participants' | 'serverNow' | 'sub'> {
  token: string;
  participants: Map<number, PartyParticipant>;
  arenaReady: Set<number>;
  resultDeadline?: number;
  startedAt?: number;
}

/** Round order: whoever made it, first finisher first, then whoever lasted
 *  longest, then score, then whoever got there with fewer falls. */
function orderPartyRound(ps: Iterable<PartyParticipant>): PartyParticipant[] {
  return [...ps].sort((a, b) =>
    (a.finishedAt ?? Infinity) - (b.finishedAt ?? Infinity) ||
    (b.outAt ?? Infinity) - (a.outAt ?? Infinity) ||
    b.score - a.score || a.falls - b.falls || a.joinOrder - b.joinOrder);
}
/** Scoreboard order for The Bridge: winning side first, top scorer first. */
function orderPartyTeams(ps: Iterable<PartyParticipant>, teamScores: readonly number[]): PartyParticipant[] {
  return [...ps].sort((a, b) =>
    (teamScores[b.team] ?? 0) - (teamScores[a.team] ?? 0) || a.team - b.team ||
    b.score - a.score || a.joinOrder - b.joinOrder);
}

interface PartyCreateResult { token: string; snapshot: PartyLobbySnapshot }
type PartyJoinResult =
  | { ok: true; snapshot: PartyLobbySnapshot }
  | { ok: false; reason: PartyJoinFailure };

export class PartyGamesEngine {
  private readonly lobbies = new Map<string, PartyLobby>();
  private readonly lobbyByPlayer = new Map<number, PartyLobby>();
  private nextId = 1;
  private seedCounter = 0;
  /** What each player ran last, so the next course is somewhere else and
   *  built from other set pieces. */
  private readonly lastParkour = new Map<number, { theme: number; pieces: SetPieceId[] }>();
  private themeBag: number[] = [];
  constructor(private readonly tokenFactory: () => string) { }

  private static blank(identity: PartyIdentity, joinOrder: number): PartyParticipant {
    return {
      ...identity, ready: false, connected: true, joinOrder, team: 0, score: 0,
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

  /** `capacity` defaults to the 1v1 matchmaking size; a party passes the
   *  larger `partyModeCapacity(mode, true)`. */
  create(identity: PartyIdentity, now: number, mode: PartyMode = 'bridge',
    capacity = partyModeCapacity(mode, false)):
    PartyCreateResult | { reason: 'already_in_lobby' } {
    if (this.lobbyByPlayer.has(identity.id)) return { reason: 'already_in_lobby' };
    const token = this.tokenFactory();
    const p = PartyGamesEngine.blank(identity, 0);
    const lobby: PartyLobby = {
      id: `P${this.nextId++}`, token, mode, revision: 0, phase: 'lobby',
      capacity: Math.max(PARTY_MIN_PLAYERS, Math.min(partyModeCapacity(mode, true), capacity)),
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
    const p = PartyGamesEngine.blank(identity, joinOrder);
    for (const v of l.participants.values()) v.ready = false;
    l.participants.set(p.id, p);
    this.lobbyByPlayer.set(p.id, l);
    this.assignTeams(l);
    return { ok: true, snapshot: this.snapshotLobby(l, now) };
  }

  /** Take a player out of their lobby. Returns the lobby as it now stands, or
   *  undefined when there was none or it emptied and was deleted. */
  leave(id: number, now: number): PartyLobbySnapshot | undefined {
    const l = this.lobbyByPlayer.get(id);
    if (!l) return undefined;
    this.lobbyByPlayer.delete(id);
    const p = l.participants.get(id)!;
    p.connected = false;
    if (p.bot) this.lastParkour.delete(id);
    p.ready = false;
    if (l.phase === 'lobby') l.participants.delete(id);
    const remaining = [...l.participants.values()].filter((v) => v.connected);
    if (!remaining.length) {
      this.release(l);
      this.lobbies.delete(l.token);
      return undefined;
    }
    l.host = remaining[0].id;
    if (l.phase === 'lobby') for (const v of l.participants.values()) v.ready = false;
    if (l.phase === 'lobby') this.assignTeams(l);
    if (l.mode === 'parkour' && (l.phase === 'running' || l.phase === 'countdown')) {
      // Nobody forfeits a Dragon Chase: a runner who walks away mid-run is
      // simply out of it, and one who already made it stays made it.
      if (p.finishedAt === undefined && p.outAt === undefined) {
        p.outAt = now;
        p.lastLife = { at: now, cause: 'left' };
      }
      if (l.phase === 'running') this.checkParkourEnd(l, now);
      else this.arm(l, now);
    } else if (remaining.length < 2 && l.phase !== 'lobby' && l.phase !== 'results')
      // The side still standing takes it. (The Bridge reads its winner by team.)
      this.finish(l, now, remaining[0].id, 'forfeit', l.mode === 'bridge' ? remaining[0].team : null);
    else if (l.phase === 'countdown') this.arm(l, now);
    return this.snapshotLobby(l, now);
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
    if (l.participants.size > l.capacity) return { ok: false, reason: 'too_many_players' };
    if ([...l.participants.values()].some((p) => !p.ready)) return { ok: false, reason: 'not_everyone_ready' };
    // Random secret token + monotonic counter produces a fresh course on every replay.
    let seed = ++this.seedCounter;
    for (const c of this.tokenFactory()) seed = partyHash(seed, c.charCodeAt(0));
    if (l.mode === 'parkour') {
      const last = [...l.participants.keys()].map((v) => this.lastParkour.get(v));
      const recent = new Set(last.flatMap((v) => v?.pieces ?? []));
      /** Shuffle-bag draw: every option comes round before any repeats, and
       *  nothing either racer just played is drawn while anything else is left. */
      const drawFrom = <T>(bag: T[], all: readonly T[], excluded: Set<T | undefined>): T => {
        if (!bag.length) bag.push(...[...all].sort((a, b) =>
          partyHash(seed, all.indexOf(a) + 31) - partyHash(seed, all.indexOf(b) + 31)));
        const next = bag.findIndex((t) => !excluded.has(t));
        return next >= 0 ? bag.splice(next, 1)[0] : all.find((t) => !excluded.has(t)) ?? bag.splice(0, 1)[0];
      };
      const theme = drawFrom(this.themeBag, PARKOUR_THEMES.map((_, i) => i), new Set(last.map((v) => v?.theme)));
      // Of a few candidate courses, the one sharing fewest set pieces with
      // what these runners just ran.
      let best = encodeParkourSeed(seed, theme), overlap = Infinity;
      for (let k = 0; k < 4 && overlap > 0 && recent.size; k++) {
        const candidate = encodeParkourSeed(partyHash(seed, 0x51ce + k), theme);
        const n = parkourCourse(candidate).variant.pieces.filter((v) => recent.has(v)).length;
        if (n < overlap) { overlap = n; best = candidate; }
      }
      seed = best;
      const pieces = parkourCourse(seed).variant.pieces;
      for (const v of l.participants.keys()) this.lastParkour.set(v, { theme, pieces });
    }
    l.arena = partyArenaBounds(l.mode, seed);
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
    l.round = { game: game.id, startedAt: 0, endsAt: 0, revision: l.revision };
    const lives = l.mode === 'parkour' ? DRAGON_LIVES : 0;
    l.dragon = l.mode === 'parkour' ? { front: DRAGON_LAIR_FRONT, speed: 0, at: now } : undefined;
    for (const p of l.participants.values())
      Object.assign(p, {
        score: 0, kills: 0, deaths: 0, lastHitBy: undefined, lastHitAt: 0,
        progress: 0, checkpoint: 0, falls: 0, lives, outAt: undefined,
        finishedAt: undefined, immuneUntil: 0, pendingSpawn: false, respawnAt: undefined,
        place: undefined, lastLife: undefined, hurtCause: undefined,
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
      } else if (l.phase === 'running' && l.dragon) {
        this.flyDragon(l, now);
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
      !a.pendingSpawn && !b.pendingSpawn && a.respawnAt === undefined && b.respawnAt === undefined &&
      now >= b.immuneUntil;
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
    victim.respawnAt = now + BRIDGE_RESPAWN_DELAY_MS;
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
  evaluate(id: number, pos: PartyVec3, now: number): { spawn?: PartyVec3; changed: boolean; killedBy?: number } {
    const l = this.lobbyByPlayer.get(id), p = l?.participants.get(id);
    if (l?.mode === 'parkour' && l.arena && p?.finishedAt !== undefined && p.place !== undefined && l.phase === 'running') {
      // Made it, and wandered off the podium: back up onto your step.
      const course = parkourCourse(l.arena.seed), spot = course.podium[Math.min(course.podium.length - 1, p.place - 1)];
      const sub = this.subFor(id)!;
      if (pos.y < course.finish.y - 6) return { spawn: { x: sub.minX + spot.x, y: spot.y + .01, z: sub.minZ + spot.z }, changed: false };
      return { changed: false };
    }
    if (!l || !p || l.phase !== 'running' || !l.round || !l.arena || !p.connected ||
      p.finishedAt !== undefined || p.outAt !== undefined || now >= l.round.endsAt) return { changed: false };
    const sub = this.subFor(id)!;
    return sub.game === 'bridge' ? this.evaluateBridge(l, p, sub, pos, now)
      : this.evaluateParkour(l, p, sub, pos, now);
  }

  private evaluateBridge(l: PartyLobby, p: PartyParticipant, sub: PartySubBounds, pos: PartyVec3, now: number):
    { spawn?: PartyVec3; changed: boolean; killedBy?: number } {
    const seat = [...l.participants.values()].filter((v) => v.team === p.team && v.joinOrder < p.joinOrder).length;
    // A goal puts everybody back in a cage; an ordinary void death just puts
    // you back on your own deck, with no pause in the game for anyone else.
    const home = (): { spawn: PartyVec3; changed: boolean } => {
      const caged = l.goalResetAt !== undefined && now < l.goalResetAt;
      p.pendingSpawn = false;
      p.respawnAt = undefined;
      // A caged player's shield starts when the hatch does, so nobody lands
      // out of one straight into a waiting axe.
      p.immuneUntil = (caged ? l.goalResetAt! : now) + BRIDGE_RESPAWN_SHIELD_MS;
      return {
        spawn: caged ? bridgeCageSpawn(sub, p.team, seat) : bridgeSpawn(sub, p.team, seat),
        changed: true,
      };
    };
    if (p.pendingSpawn) return home();
    // Dead: spectate until the timer runs out. No goals, no void, no fights.
    if (p.respawnAt !== undefined) return now >= p.respawnAt ? home() : { changed: false };
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
      p.respawnAt = now + BRIDGE_RESPAWN_DELAY_MS;
      return { changed: true, killedBy: killer && killer.team !== p.team ? killer.id : undefined };
    }
    return { changed: false };
  }

  private evaluateParkour(l: PartyLobby, p: PartyParticipant, sub: PartySubBounds, pos: PartyVec3, now: number):
    { spawn?: PartyVec3; changed: boolean } {
    const course = parkourCourse(sub.seed), last = course.steps.length - 1;
    const at = (order: number): PartyVec3 => {
      const spot = parkourStandSpot(course, course.steps[Math.max(0, Math.min(order, last))][0]);
      return { x: sub.minX + spot.x, y: spot.y + .01, z: sub.minZ + spot.z };
    };
    /** A life gone: out of the run on the last one, otherwise back on the
     *  course — at your checkpoint, or clear ahead of the dragon if it has
     *  already passed that. */
    const lose = (cause: ParkourHurt): { spawn?: PartyVec3; changed: boolean } => {
      p.falls++;
      p.pendingSpawn = false;
      p.hurtCause = undefined;
      p.lastLife = { at: now, cause };
      if (--p.lives <= 0) {
        p.lives = 0;
        p.outAt = now;
        this.checkParkourEnd(l, now);
        return { changed: true };
      }
      let back = p.checkpoint;
      const safe = Math.ceil(l.dragon?.front ?? DRAGON_LAIR_FRONT) + DRAGON_RESPAWN_LEAD;
      if (safe > back) {
        back = safe;
        for (let o = safe; o <= Math.min(last - 1, safe + 4); o++)
          if (course.steps[o]?.[0]?.checkpoint) { back = o; break; }
      }
      back = Math.max(0, Math.min(back, last - 1));
      p.progress = p.checkpoint = back;
      p.score = Math.max(p.score, p.progress);
      p.immuneUntil = now + DRAGON_IMMUNE_MS;
      return { spawn: at(back), changed: true };
    };
    if (p.pendingSpawn) return lose(p.hurtCause ?? 'fall');
    const here = course.steps[p.progress]?.[0], ahead = course.steps[p.progress + 1]?.[0];
    // Credit the surface actually reached. A runner can jump past a pad or
    // build around it; requiring every intermediate order would leave later
    // checkpoints inert for the rest of that run.
    const landed = course.platforms.find(pad => pad.order > p.progress &&
      Math.abs(pos.x - sub.minX - pad.x) < pad.width / 2 + .35 &&
      Math.abs(pos.z - sub.minZ - pad.z) < pad.depth / 2 + .35 &&
      Math.abs(pos.y - pad.y) < .35 &&
      (pad.order < last || pad.order === p.progress + 1));
    // Every jump lands on its pad, so anything well below the lower of the
    // pad you left and the pad you are heading for is off the course — the
    // street, the moat, a lap further down the tree.
    const floor = Math.min(here?.y ?? Infinity, ahead?.y ?? Infinity) - 2.5;
    if (pos.y < PARTY_VOID_Y || (pos.y < floor && !landed)) return lose('fall');
    if (landed) {
      p.progress = landed.order;
      p.score = Math.max(p.score, p.progress);
      if (landed.checkpoint) p.checkpoint = p.progress;
      if (p.progress === last) {
        // Made it: up onto the podium, safe from everything.
        p.finishedAt = now;
        p.place = [...l.participants.values()].filter((v) => v.finishedAt !== undefined).length;
        p.immuneUntil = Infinity;
        const spot = course.podium[Math.min(course.podium.length - 1, p.place - 1)];
        this.checkParkourEnd(l, now);
        return { spawn: { x: sub.minX + spot.x, y: spot.y + .01, z: sub.minZ + spot.z }, changed: true };
      }
      return { changed: true };
    }
    return { changed: false };
  }

  /** Take a life off a Parkour runner (the dragon's jaws or its fire). The
   *  next evaluation applies it. False when they cannot be hurt right now. */
  hurt(id: number, cause: ParkourHurt, now: number): boolean {
    const l = this.lobbyByPlayer.get(id), p = l?.participants.get(id);
    if (!l || !p || l.mode !== 'parkour' || l.phase !== 'running' || !p.connected || p.pendingSpawn ||
      p.finishedAt !== undefined || p.outAt !== undefined || now < p.immuneUntil) return false;
    p.pendingSpawn = true;
    p.hurtCause = cause;
    return true;
  }

  /** The dragon flies on: slowly out of the lair, a little faster every
   *  second, and faster still while everyone is well clear of it. Anybody it
   *  has overtaken on the course is caught. */
  private flyDragon(l: PartyLobby, now: number): void {
    const d = l.dragon!, course = parkourCourse(l.arena!.seed), last = course.steps.length - 1;
    const t = now - l.round!.startedAt - DRAGON_GRACE_MS;
    const dt = Math.max(0, Math.min(.5, (now - d.at) / 1000));
    d.at = now;
    if (t < 0) { d.front = DRAGON_LAIR_FRONT; d.speed = 0; return; }
    let rear = Infinity;
    for (const p of l.participants.values())
      if (p.connected && p.outAt === undefined && p.finishedAt === undefined) rear = Math.min(rear, p.progress);
    const base = dragonBaseSpeed(t / 1000);
    d.speed = Number.isFinite(rear) && rear - d.front > DRAGON_SURGE_GAP ? base * DRAGON_SURGE : base;
    // It never follows anybody into the sanctuary.
    d.front = Math.min(last - .6, d.front + d.speed * dt);
    for (const p of l.participants.values()) {
      if (!p.connected || p.outAt !== undefined || p.finishedAt !== undefined || p.pendingSpawn || now < p.immuneUntil) continue;
      if (d.front >= p.progress + .6) { p.pendingSpawn = true; p.hurtCause = 'dragon'; }
    }
  }

  /** A Dragon Chase ends when nobody is left running. */
  private checkParkourEnd(l: PartyLobby, now: number): void {
    if (l.phase !== 'running') return;
    const running = [...l.participants.values()].some((v) => v.connected && v.outAt === undefined && v.finishedAt === undefined);
    if (!running) this.endMatch(l, now);
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
    // Nobody wins a Dragon Chase: you made it, or you did not.
    this.finish(l, now, null, 'complete');
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
      finishReason: reason,
      runners: l.mode === 'parkour' ? this.parkourRunners(l) : undefined,
    };
  }

  private parkourRunners(l: PartyLobby): ParkourRunnerResult[] {
    const ps = [...l.participants.values()];
    const fell = ps.filter((p) => p.finishedAt === undefined).sort((a, b) =>
      (a.outAt ?? Infinity) - (b.outAt ?? Infinity) || a.score - b.score || a.joinOrder - b.joinOrder);
    const made = ps.filter((p) => p.finishedAt !== undefined).sort((a, b) => a.finishedAt! - b.finishedAt!);
    const started = l.round?.startedAt ?? 0;
    return [
      ...made.map((p, i): ParkourRunnerResult => ({
        id: p.id, username: p.username, made: true, place: i + 1, timeMs: p.finishedAt! - started,
        livesLeft: p.lives, reached: p.score, left: !p.connected,
      })),
      ...fell.map((p, i): ParkourRunnerResult => ({
        id: p.id, username: p.username, made: false, fellOrder: i + 1, livesLeft: 0,
        reached: p.score, left: p.lastLife?.cause === 'left',
      })),
    ];
  }

  private release(l: PartyLobby): void {
    if (l.arena && l.mode === 'parkour') releaseParkourStamp(l.arena.seed);
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
      sub: l.arena && l.round ? partySubBounds(l.mode, l.arena.seed) : undefined,
      result: l.result, dragon: l.dragon ? { ...l.dragon } : undefined,
    };
  }

  /** snapshotLobby minus the defensive copies: the participants, round and
   *  scores are the live objects. Only for the server's per-tick paths that
   *  READ a match (never mutate it, keep it, or put it on the wire) — copying
   *  every match once per tick, and again per bot, was a quarter of the tick. */
  private viewLobby(l: PartyLobby, now: number): PartyLobbySnapshot {
    return {
      id: l.id, mode: l.mode, revision: l.revision, phase: l.phase, capacity: l.capacity,
      participants: [...l.participants.values()], host: l.host, serverNow: now,
      countdownEndsAt: l.countdownEndsAt, arenaLoadDeadline: l.arenaLoadDeadline,
      teamScores: l.teamScores, goalResetAt: l.goalResetAt,
      lastGoal: l.lastGoal, lastKill: l.lastKill,
      round: l.round, arena: l.arena,
      sub: l.arena && l.round ? partySubBounds(l.mode, l.arena.seed) : undefined,
      result: l.result, dragon: l.dragon,
    };
  }

  snapshotFor(id: number, now: number): PartyLobbySnapshot | null {
    const l = this.lobbyByPlayer.get(id);
    return l ? this.snapshotLobby(l, now) : null;
  }
  snapshots(now: number): PartyLobbySnapshot[] { return [...this.lobbies.values()].map((l) => this.snapshotLobby(l, now)); }
  /** Read-only live views (see viewLobby). */
  viewFor(id: number, now: number): Readonly<PartyLobbySnapshot> | null {
    const l = this.lobbyByPlayer.get(id);
    return l ? this.viewLobby(l, now) : null;
  }
  views(now: number): Readonly<PartyLobbySnapshot>[] { return [...this.lobbies.values()].map((l) => this.viewLobby(l, now)); }
  phaseFor(id: number): PartyPhase | null { return this.lobbyByPlayer.get(id)?.phase ?? null; }
  subFor(id: number): PartySubBounds | null {
    const l = this.lobbyByPlayer.get(id);
    return l?.arena && l.round ? partySubBounds(l.mode, l.arena.seed) : null;
  }
  roundFor(id: number): PartyRoundState | null { return this.lobbyByPlayer.get(id)?.round ?? null; }
  dragonFor(id: number): Readonly<PartyDragon> | null { return this.lobbyByPlayer.get(id)?.dragon ?? null; }
  participantFor(id: number): PartyParticipant | null { return this.lobbyByPlayer.get(id)?.participants.get(id) ?? null; }
  membersOf(id: number): number[] {
    return [...(this.lobbyByPlayer.get(id)?.participants.values() ?? [])].filter((p) => p.connected).map((p) => p.id);
  }
}
