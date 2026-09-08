// Shared geometry and authoritative round state for The Bridge and Parkour.
// All gameplay clocks are server milliseconds. Snapshots contain everything
// needed to recover the presentation; clients never choose spawns or winners.
//
// The two modes share one arena band, one lobby engine and one isolated
// session transport (the `party*` message family); they differ only in the
// venue they stamp and in what `evaluate` counts as progress.
import { Block } from './blocks';
import { parkourTheme, PARKOUR_THEMES } from './parkour_themes';

export const PARTY_BASE_X = 262144;
export const PARTY_SLOT_SPACING = 1024;
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
/** Everyone is returned to their own base for this long after a goal. */
export const BRIDGE_GOAL_RESET_MS = 1600;
/** Fighting on the span. Melee is the Bedwars swing model (charge, combo,
 *  crit, knockback) driven by the Void Cleaver's tier; the bow is a charged
 *  shot the server times itself. Both live here so the client can predict the
 *  feel and the server can be the only thing that decides the damage. */
export const BRIDGE_RESPAWN_SHIELD_MS = 1800;
/** How long after a hit a void death still counts as that attacker's kill —
 *  knocking somebody off the span IS the mode's signature kill. */
export const BRIDGE_KILL_CREDIT_MS = 10_000;
/** A full draw takes this long; anything shorter is a weaker, slower arrow. */
export const BRIDGE_BOW_DRAW_MS = 900;
/** Below this draw the string is not released at all. */
export const BRIDGE_BOW_MIN_POWER = 0.2;
/** Floor on the gap between two released arrows, on top of the draw itself. */
export const BRIDGE_BOW_COOLDOWN_MS = 220;
/** Arrow muzzle speed, blocks/second, from minimum to full draw. */
export const BRIDGE_ARROW_SPEED = [26, 62] as const;
/** Blocks/second². Gentler than the player's 32 so the arc stays readable. */
export const BRIDGE_ARROW_GRAVITY = 19;
/** Arrows expire after this long in the air. */
export const BRIDGE_ARROW_LIFE_MS = 5000;
/** Damage from minimum to full draw, before the full-draw crit bonus. */
export const BRIDGE_ARROW_DAMAGE = [3, 11] as const;
/** A shot released at (essentially) full draw hits this much harder. */
export const BRIDGE_ARROW_CRIT_DRAW = 0.97;
export const BRIDGE_ARROW_CRIT_MULT = 1.45;
/** Knockback an arrow delivers along its own flight line, at full draw. */
export const BRIDGE_ARROW_KB = 0.55;
export const BRIDGE_ARROW_KB_VERT = 0.3;

/** Draw fraction (0..1) for a bow held for `heldMs`. */
export function bridgeBowPower(heldMs: number): number {
  return Math.max(0, Math.min(1, heldMs / BRIDGE_BOW_DRAW_MS));
}
/** Everything one released arrow is worth, from its draw alone. Pure, shared,
 *  and the only place these curves exist: the client draws the charge meter
 *  from it and the server damages with it. */
export function bridgeArrowShot(power: number): {
  speed: number; damage: number; crit: boolean; knockback: number;
} {
  const p = Math.max(0, Math.min(1, power));
  const crit = p >= BRIDGE_ARROW_CRIT_DRAW;
  // Quadratic in the draw, like the axe's charge curve: a flicked shot is a
  // strict loss rather than a break-even one, so patience is the skill.
  const curve = p * p;
  return {
    speed: BRIDGE_ARROW_SPEED[0] + (BRIDGE_ARROW_SPEED[1] - BRIDGE_ARROW_SPEED[0]) * p,
    damage: Math.max(1, Math.round(
      (BRIDGE_ARROW_DAMAGE[0] + (BRIDGE_ARROW_DAMAGE[1] - BRIDGE_ARROW_DAMAGE[0]) * curve) *
      (crit ? BRIDGE_ARROW_CRIT_MULT : 1))),
    crit,
    knockback: BRIDGE_ARROW_KB * (0.5 + 0.5 * p),
  };
}

export type PartyMode = 'bridge' | 'parkour';
export type PartyGameId = 'bridge' | 'parkour';
export type PartyPhase = 'lobby' | 'countdown' | 'running' | 'results';
export type PartyFinishReason = 'complete' | 'forfeit' | 'cancelled';
export type PartyJoinFailure = 'invalid' | 'full' | 'match_in_progress' | 'already_in_lobby';
export type PartyStartFailure = 'not_host' | 'too_few_players' | 'too_many_players' | 'not_everyone_ready' | 'not_in_lobby';

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
    rule: `One span, one block wide. Cleaver, bow and wool — dive into the enemy portal, first to ${BRIDGE_GOAL_LIMIT} goals.`,
    durationMs: 480_000, insetX: 8, sizeX: 48, originZ: 0, sizeZ: 176,
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
// One 48 x 176 island chain, perfectly mirror-symmetric about z = 87.5. Only
// the crimson half is authored; the cobalt half is that half reflected with the
// team wool swapped, so neither side can ever have a geometric advantage.

export const BRIDGE_SIZE_X = 48;
export const BRIDGE_SIZE_Z = 176;
/** Reflection axis. `BRIDGE_SIZE_Z - 1 - lz` maps crimson to cobalt. */
const BRIDGE_MIRROR = BRIDGE_SIZE_Z - 1;
/** Team wool, indexed by team. Placeable, and the only block players may add. */
export const BRIDGE_TEAM_BLOCK = [Block.TeamWoolA, Block.TeamWoolB] as const;
export const BRIDGE_TEAM_NAME = ['CRIMSON', 'COBALT'] as const;
/** Scoring portal footprints, in slot-local blocks. Half-open on max. */
export const BRIDGE_GOALS: readonly { team: number; minX: number; maxX: number; minZ: number; maxZ: number }[] = [
  { team: 0, minX: 23, maxX: 26, minZ: 11, maxZ: 14 },
  { team: 1, minX: 23, maxX: 26, minZ: BRIDGE_MIRROR - 13, maxZ: BRIDGE_MIRROR - 10 },
];
/** No player-placed block may enter this pad around a portal mouth. */
const GOAL_GUARD = 2;
/** The centre line. One span, one block wide, runs the whole length on it. */
export const BRIDGE_LANE_X = 24;
/** Spawn pad centre, crimson side. */
const BRIDGE_SPAWN_Z = 21.5;

function bridgeSwapTeam(block: number): number {
  return block === Block.TeamWoolA ? Block.TeamWoolB : block === Block.TeamWoolB ? Block.TeamWoolA : block;
}

let bridgeStampCache: VenueStamp | null = null;
function bridgeStamp(): VenueStamp {
  if (bridgeStampCache) return bridgeStampCache;
  const s = new VenueStamp(BRIDGE_SIZE_X, BRIDGE_SIZE_Z);
  const F = PARTY_FLOOR_Y;
  const TEAM = Block.TeamWoolA, STONE = Block.OpalBrick, DECK = Block.SpectralMarble;
  const TRIM = Block.PearlTile, CORE = Block.Basalt, GLOW = Block.RuneGlass;
  const GOLD = Block.GildedVaultBrick, COLUMN = Block.IvoryColumn, PRISM = Block.PrismBrick;

  // 1. Base deck: a chevron of team wool sweeping toward the enemy.
  for (let lz = 2; lz <= 43; lz++)
    for (let lx = 3; lx <= 44; lx++) {
      const edge = lx === 3 || lx === 44 || lz === 2 || lz === 43;
      const chevron = (lz + Math.abs(lx - 24)) % 8 < 2;
      s.set(lx, F, lz, edge ? TRIM : chevron ? TEAM : (lx % 6 === 0 || lz % 6 === 0) ? TRIM : DECK);
    }

  // 2. The island the base stands on: a stepped underside falling into a lit
  //    keel directly beneath the portal, so the goal glows from below.
  s.fill(3, 44, F - 1, F - 1, 2, 43, CORE);
  s.fill(4, 43, F - 2, F - 2, 3, 42, CORE);
  s.fill(6, 41, F - 3, F - 3, 4, 41, STONE);
  s.fill(9, 38, F - 4, F - 4, 6, 39, STONE);
  s.fill(13, 34, F - 5, F - 5, 8, 30, PRISM);
  s.fill(17, 30, F - 6, F - 6, 8, 24, PRISM);
  s.fill(20, 27, F - 7, F - 7, 8, 18, PRISM);
  s.fill(21, 26, F - 8, F - 8, 9, 16, GLOW);
  // Hanging corner pylons, tipped with a team lamp.
  for (const [px, pz] of [[5, 4], [42, 4], [5, 41], [42, 41]]) {
    s.fill(px, px + 1, F - 16, F - 5, pz, pz + 1, CORE);
    s.fill(px, px + 1, F - 10, F - 10, pz, pz + 1, TEAM);
    s.fill(px, px + 1, F - 17, F - 17, pz, pz + 1, GLOW);
  }

  // 3. Rampart. Back and sides are closed; the front opens onto the catwalks.
  for (let y = F + 1; y <= F + 3; y++)
    for (let lz = 2; lz <= 43; lz++)
      for (let lx = 3; lx <= 44; lx++) {
        const perimeter = lx === 3 || lx === 44 || lz === 2 || lz === 43;
        if (!perimeter) continue;
        // One sally port, dead centre, lined up with the span and with the
        // portal at the far end of it: there is exactly one way out.
        if (lz === 43 && lx >= BRIDGE_LANE_X - 1 && lx <= BRIDGE_LANE_X + 1) continue;
        if (y === F + 3 && (lx + lz) % 2 !== 0) continue; // crenellations
        s.set(lx, y, lz, y === F + 2 ? TEAM : STONE);
      }

  // 4. Corner towers with a beacon crown.
  for (const [cx, cz] of [[6, 6], [41, 6], [6, 38], [41, 38]]) {
    for (let y = F + 1; y <= F + 12; y++)
      for (let dz = -1; dz <= 1; dz++)
        for (let dx = -1; dx <= 1; dx++) {
          const corner = dx !== 0 && dz !== 0;
          s.set(cx + dx, y, cz + dz, corner ? COLUMN : (y === F + 4 || y === F + 8) ? TEAM : STONE);
        }
    for (const [dx, dz] of [[2, 0], [-2, 0], [0, 2], [0, -2]]) s.set(cx + dx, F + 10, cz + dz, GLOW);
    s.fill(cx - 2, cx + 2, F + 13, F + 13, cz - 2, cz + 2, STONE);
    for (let dz = -2; dz <= 2; dz++)
      for (let dx = -2; dx <= 2; dx++)
        if (Math.abs(dx) === 2 || Math.abs(dz) === 2) s.set(cx + dx, F + 14, cz + dz, TEAM);
    s.fill(cx, cx, F + 15, F + 17, cz, cz, GLOW);
    s.set(cx, F + 18, cz, GOLD);
  }

  // 5. Gate arch over the sally port.
  for (const [x0, x1] of [[BRIDGE_LANE_X - 1, BRIDGE_LANE_X + 1]]) {
    for (const jamb of [x0 - 1, x1 + 1]) {
      s.fill(jamb, jamb, F + 1, F + 7, 43, 43, COLUMN);
      s.set(jamb, F + 6, 43, GLOW);
    }
    s.fill(x0 - 1, x1 + 1, F + 8, F + 8, 43, 43, STONE);
    s.fill(x0, x1, F + 9, F + 9, 43, 43, TEAM);
    for (const banner of [x0 + 1, x1 - 1]) s.set(banner, F + 7, 43, TEAM);
  }

  // 6. The keep, behind the portal.
  s.fill(14, 34, F + 1, F + 1, 3, 9, TRIM);
  s.fill(16, 32, F + 2, F + 2, 4, 8, DECK);
  for (const [px, pz] of [[16, 4], [32, 4], [16, 8], [32, 8]]) {
    s.fill(px, px, F + 3, F + 8, pz, pz, COLUMN);
    s.set(px, F + 7, pz, GLOW);
  }
  s.fill(15, 33, F + 9, F + 9, 3, 9, STONE);
  s.fill(17, 31, F + 10, F + 10, 4, 8, TEAM);
  s.fill(20, 28, F + 11, F + 11, 5, 7, GOLD);

  // 7. The portal: a gilded ring, four obelisks and a floating cross over a
  //    shaft that drops onto the lit keel.
  const g = BRIDGE_GOALS[0];
  s.fill(g.minX - 1, g.maxX, F, F, g.minZ - 1, g.maxZ, GOLD);
  s.fill(g.minX - 1, g.maxX, F - 7, F - 1, g.minZ - 1, g.maxZ, PRISM);
  for (const [ox, oz] of [[g.minX - 1, g.minZ - 1], [g.maxX, g.minZ - 1], [g.minX - 1, g.maxZ], [g.maxX, g.maxZ]]) {
    for (let y = F + 1; y <= F + 5; y++) s.set(ox, y, oz, y % 2 ? STONE : TEAM);
    s.set(ox, F + 6, oz, GLOW);
  }
  const gx = (g.minX + g.maxX - 1) / 2, gz = (g.minZ + g.maxZ - 1) / 2;
  s.fill(g.minX - 1, g.maxX, F + 8, F + 8, gz, gz, GOLD);
  s.fill(gx, gx, F + 8, F + 8, g.minZ - 1, g.maxZ, GOLD);
  s.set(gx, F + 9, gz, GLOW);

  // 8. Spawn pad, a wool square you cannot mistake for the deck.
  for (let lz = 19; lz <= 24; lz++)
    for (let lx = 17; lx <= 31; lx++)
      s.set(lx, F, lz, lz === 19 || lz === 24 || lx === 17 || lx === 31 ? GOLD : TEAM);

  // 9. The span. ONE lane, ONE block wide, straight down the centre line and
  //    unbroken from the sally port to the middle island — and, once the
  //    mirror pass below completes it, from one base to the other. There is no
  //    second route, no rail, and nothing at all to stand on either side of
  //    it: every crossing is a tightrope with somebody at the far end. The
  //    wool is for repairing the span and for climbing back onto it.
  for (let lz = 44; lz <= 79; lz++) {
    s.set(BRIDGE_LANE_X, F, lz, lz % 4 === 0 ? TEAM : DECK);
    // Lanterns hang a clear block underneath: they light the span and give the
    // drop a scale, and that gap keeps them off the walking surface until
    // somebody knocks the deck out from over them.
    if (lz % 6 === 2) {
      s.set(BRIDGE_LANE_X, F - 2, lz, GLOW);
      s.set(BRIDGE_LANE_X, F - 3, lz, CORE);
    }
  }
  // Buttress arms where the span leaves the base, so it reads as built rather
  // than floating. They sit BELOW the walkway and are never a second footing.
  for (const lz of [44, 45, 46]) {
    s.set(BRIDGE_LANE_X - 1, F - 1, lz, CORE);
    s.set(BRIDGE_LANE_X + 1, F - 1, lz, CORE);
    s.set(BRIDGE_LANE_X, F - 1, lz, STONE);
  }

  // 10. The middle island: a small contested node ON the line rather than a
  //     plaza beside it — fourteen blocks across, so the span still reads as
  //     one continuous route from base to base. Self-symmetric, so the mirror
  //     pass below completes it rather than duplicating it.
  for (let lz = 80; lz <= 87; lz++)
    for (let lx = 17; lx <= 30; lx++) {
      const edge = lx === 17 || lx === 30 || lz === 80;
      s.set(lx, F, lz, edge ? TRIM : ((lx >> 1) + (lz >> 1)) % 2 ? DECK : TRIM);
    }
  s.fill(18, 29, F - 1, F - 1, 80, 87, CORE);
  s.fill(19, 28, F - 2, F - 2, 80, 87, CORE);
  s.fill(20, 27, F - 3, F - 3, 80, 87, STONE);
  s.fill(21, 26, F - 4, F - 4, 80, 87, STONE);
  s.fill(22, 25, F - 12, F - 5, 84, 87, PRISM);
  s.fill(23, 24, F - 13, F - 13, 84, 87, GLOW);
  s.fill(20, 27, F + 1, F + 1, 84, 87, TRIM);
  s.fill(22, 25, F + 2, F + 2, 86, 87, GOLD);
  s.fill(23, 24, F + 3, F + 5, 86, 87, GLOW);
  s.fill(22, 25, F + 6, F + 6, 86, 87, GOLD);
  for (const ox of [18, 29]) {
    s.fill(ox, ox, F + 1, F + 6, 82, 82, STONE);
    s.set(ox, F + 7, 82, GLOW);
  }

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
    s.set(lx, y, BRIDGE_MIRROR - lz, bridgeSwapTeam(block));
  }
  bridgeStampCache = s;
  return s;
}

/** Spawn pad for one seat on one team, in world coordinates. */
export function bridgeSpawn(sub: PartySubBounds, team: number, seat: number): PartyVec3 {
  const lane = 24 + ((seat % 2) * 2 - 1) * (2 + Math.floor(seat / 2) * 3);
  const lz = team === 0 ? BRIDGE_SPAWN_Z : BRIDGE_MIRROR - BRIDGE_SPAWN_Z;
  return { x: sub.minX + lane + .5, y: PARTY_FLOOR_Y + 1.01, z: sub.minZ + lz };
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
// One straight lane running the length of the venue. Every platform advances
// in +z; only the jump SHAPE varies, so the route always reads as a single
// line you can see to the end of, never a knot of blocks.

export const PARKOUR_SIZE_X = 32;
export const PARKOUR_SIZE_Z = 448;
/** Centre of the lane. Platforms stray at most three blocks either side. */
export const PARKOUR_LANE_X = 16;
export const PARKOUR_PLATFORMS = 56;
/** Saved progress every this many platforms (and always the last one).
 *  Deliberately sparse: a checkpoint on every other pad turns a course into a
 *  sequence of independent single jumps, and the run stops being a run. A
 *  fourteen-jump leg is long enough that a fall costs you something and short
 *  enough that it never costs you the match. */
export const PARKOUR_CHECKPOINT_EVERY = 14;
/** No two platforms are ever closer than this along the lane. */
const PARKOUR_MIN_STEP = 2;

export type ParkourJump =
  | 'pad' | 'wide' | 'pillar' | 'beam' | 'rail' | 'step' | 'drop' | 'hurdle' | 'gate' | 'stones'
  // Obstacle pads: the jump that REACHES them is an ordinary jump; what makes
  // them hard is getting across the pad itself to the take-off lip.
  | 'wall' | 'slalom' | 'tunnel' | 'pit' | 'teeth';

export interface ParkourPlatform extends PartyVec3 {
  /** Landing footprint, in blocks. `width` spans x, `depth` spans z. */
  width: number;
  depth: number;
  checkpoint: boolean;
  kind: ParkourJump;
}

/** Landing footprint of each jump shape. Variety lives here, not in the route:
 *  the lane always runs straight, only what you land on changes. */
interface ParkourShape {
  width: number;
  depth: number;
  /** Depth still usable for the NEXT take-off. Lower than `depth` when the
   *  platform carries an obstacle you have to launch from behind. */
  exit?: number;
}
const PARKOUR_SHAPES: Record<ParkourJump, ParkourShape> = {
  wide: { width: 5, depth: 5 },
  pad: { width: 3, depth: 3 },
  step: { width: 3, depth: 3 },
  drop: { width: 3, depth: 3 },
  gate: { width: 3, depth: 3 },
  hurdle: { width: 3, depth: 5 },
  rail: { width: 3, depth: 1 },
  beam: { width: 1, depth: 5 },
  pillar: { width: 1, depth: 1 },
  stones: { width: 1, depth: 1 },
  // Obstacle pads are seven deep on purpose: two rows to land on in front of
  // the obstacle, the obstacle itself, and four rows of run-up behind it. The
  // depth is what pays for the obstacle — it never shortens the take-off lip,
  // so `parkourSpan` still measures the jump from the far edge and no seed can
  // produce a jump the physics smoke cannot land.
  wall: { width: 5, depth: 7 },
  slalom: { width: 5, depth: 7 },
  tunnel: { width: 3, depth: 7 },
  pit: { width: 3, depth: 7 },
  teeth: { width: 5, depth: 7 },
};

/** Horizontal distance a sprint jump covers while it is at or above `rise`.
 *  From the shared player physics (jump apex 1.25 blocks, sprint 5.612 m/s,
 *  gravity 32): about 3.1 blocks flat, 2.3 up a block, more on the way down.
 *  Held a shade under the true numbers so no seed is ever a coin flip. */
function parkourTravel(rise: number): number {
  return rise >= 1 ? 2.2 : rise === 0 ? 3.0 : rise === -1 ? 3.6 : 4.0;
}

/** Furthest the centres of two consecutive platforms may sit apart. The pads
 *  themselves buy reach: you take off from the front edge of one and land on
 *  the near edge of the next, so bigger pads legitimately allow longer jumps
 *  and a one-block stepping stone forces a short one. */
function parkourSpan(from: ParkourShape, to: ParkourShape, rise: number): number {
  return Math.max(2.5, parkourTravel(rise) + (from.exit ?? from.depth) / 2 + to.depth / 2 - .6);
}

const courseCache = new Map<number, ParkourPlatform[]>();

/** The 42-jump lane for a seed. Deterministic and shared by client, server and
 *  smoke tests, so nobody disagrees about where the next pad is. */
export function parkourCourse(seed: number): readonly ParkourPlatform[] {
  const cached = courseCache.get(seed);
  if (cached) return cached;
  const course: ParkourPlatform[] = [];
  // Shapes come from a bag rather than a raw modulo so a course cannot end up
  // being nine stepping stones in a row.
  const bag: ParkourJump[] = [
    'pad', 'pillar', 'beam', 'step', 'drop', 'hurdle', 'rail', 'gate', 'stones',
    'wall', 'tunnel', 'slalom', 'pit', 'teeth', 'wall', 'tunnel',
    'pad', 'step', 'pit', 'drop', 'teeth', 'pad',
  ];
  let x = PARKOUR_LANE_X, z = 8, height = 0;
  let from = PARKOUR_SHAPES.wide;
  for (let i = 0; i < PARKOUR_PLATFORMS; i++) {
    const h = partyHash(seed, i);
    const checkpoint = i % PARKOUR_CHECKPOINT_EVERY === 0 || i === PARKOUR_PLATFORMS - 1;
    const kind: ParkourJump = checkpoint ? 'wide' : bag[h % bag.length];
    const shape = PARKOUR_SHAPES[kind];
    let rise = 0;
    if (i > 0) {
      rise = kind === 'step' ? 1 : kind === 'drop' ? -2 : (h >>> 3) % 5 === 0 ? -1 : 0;
      // Stay inside the venue's headroom and never below the start height.
      // Flattening is the only correction: turning a drop into a climb would
      // hand the player a two-block rise nobody can jump.
      if (height + rise < 0) rise = 0;
      if (height + rise > 8) rise = -1;
    }
    const span = parkourSpan(from, shape, rise);
    // Drift keeps the line readable: at most three blocks either side of the
    // lane, and only one when either end of the jump is a single block wide.
    // It is also capped by the jump budget, since every block sideways is a
    // block of forward reach spent.
    const room = Math.floor(Math.sqrt(Math.max(0, span * span - PARKOUR_MIN_STEP * PARKOUR_MIN_STEP)));
    const limit = Math.min(room, Math.min(from.width, shape.width) >= 3 ? 3 : 1);
    const drift = i === 0 ? 0 : Math.max(-limit, Math.min(limit, [0, 0, 1, -1, 2, -2, 3, -3][(h >>> 8) % 8]));
    const nx = Math.max(PARKOUR_LANE_X - 4, Math.min(PARKOUR_LANE_X + 4, x + drift));
    const dx = nx - x;
    // Whatever the drift spends of the jump budget comes out of the forward
    // distance, so a sideways jump is a shorter jump, never a longer one.
    const dz = i === 0 ? 0
      : Math.max(PARKOUR_MIN_STEP, Math.floor(Math.sqrt(Math.max(0, span * span - dx * dx))));
    x = nx; z += dz; height += rise;
    course.push({
      x: x + .5, z: z + .5, y: PARTY_FLOOR_Y + height + 1,
      width: shape.width, depth: shape.depth, checkpoint, kind,
    });
    from = shape;
  }
  if (courseCache.size > 128) courseCache.delete(courseCache.keys().next().value!);
  courseCache.set(seed, course);
  return course;
}

const parkourStampCache = new Map<number, VenueStamp>();
function parkourStamp(seed: number): VenueStamp {
  const cached = parkourStampCache.get(seed);
  if (cached) return cached;
  const s = new VenueStamp(PARKOUR_SIZE_X, PARKOUR_SIZE_Z);
  const theme = parkourTheme(seed);
  const course = parkourCourse(seed);
  course.forEach((p, i) => {
    const pad = p.checkpoint ? Block.GildedVaultBrick : theme.platforms[partyHash(seed, i) % theme.platforms.length];
    const x0 = Math.floor(p.x - p.width / 2), z0 = Math.floor(p.z - p.depth / 2);
    const y = p.y - 1;
    s.fill(x0, x0 + p.width - 1, y, y, z0, z0 + p.depth - 1, pad);
    if (p.checkpoint) {
      // A lit rim you can pick out from six jumps back.
      for (let dz = 0; dz < p.depth; dz++)
        for (let dx = 0; dx < p.width; dx++)
          if (dx === 0 || dz === 0 || dx === p.width - 1 || dz === p.depth - 1)
            s.set(x0 + dx, y, z0 + dz, Block.RuneGlass);
      // The two lit posts sit halfway down the SIDES: the landing edge and the
      // take-off lip both stay completely clear, so a drifting jump can never
      // be stopped by the marker for the pad it was aimed at.
      for (const cx of [x0, x0 + p.width - 1]) {
        s.fill(cx, cx, y + 1, y + 2, z0 + (p.depth >> 1), z0 + (p.depth >> 1), theme.platforms[0]);
        s.set(cx, y + 3, z0 + (p.depth >> 1), Block.RuneGlass);
      }
    }
    // The obstacle is stamped ON the landing pad, so the jump that reaches it
    // is unchanged and the thing you have to clear is the next problem.
    if (p.kind === 'hurdle') {
      // A bar across the middle of a long pad. You land in front of it, hop it
      // standing, and take off from the far half — so it costs a beat without
      // ever getting into the flight path of the jump that reaches the pad.
      s.fill(x0, x0 + p.width - 1, y + 1, y + 1, z0 + 2, z0 + 2, Block.PrismBrick);
    }
    if (p.kind === 'gate') {
      // The arch straddles the far edge only, so it is something you run
      // through rather than something in the flight path of the jump.
      const gz = z0 + p.depth - 1;
      for (const jx of [x0 - 1, x0 + p.width]) {
        s.fill(jx, jx, y + 1, y + 3, gz, gz, theme.platforms[1]);
        s.set(jx, y + 3, gz, Block.RuneGlass);
      }
      s.fill(x0 - 1, x0 + p.width, y + 4, y + 4, gz, gz, Block.OpalBrick);
    }
    if (p.kind === 'stones') {
      // A stepping stone gets a lamp under it — a 1x1 block is hard to read
      // against the sky otherwise.
      s.set(x0, y - 2, z0, Block.RuneGlass);
      s.set(x0, y - 1, z0, theme.platforms[2]);
    }
    if (p.kind === 'pillar') s.fill(x0, x0, y - 3, y - 1, z0, z0, theme.platforms[2]);
    if (p.kind === 'beam') s.fill(x0, x0, y - 1, y - 1, z0, z0 + p.depth - 1, theme.platforms[1]);
    if (p.kind === 'wall') {
      // A wall across the pad with ONE doorway, two blocks tall so it cannot
      // be jumped. It sits two rows in: you land in front of it at speed, then
      // have to find the gap before you can start the next run-up.
      const wz = z0 + 2, door = x0 + 1 + partyHash(seed, i + 0x117) % (p.width - 2);
      for (let dx = 0; dx < p.width; dx++)
        for (let dy = 1; dy <= 2; dy++)
          if (x0 + dx !== door) s.set(x0 + dx, y + dy, wz, theme.platforms[1]);
      // A lit lintel over the gap, so the way through reads from a jump back.
      s.set(door, y + 3, wz, Block.RuneGlass);
    }
    if (p.kind === 'slalom') {
      // Two staggered half-walls. Neither can be jumped and neither can be
      // walked straight past: the pad has to be crossed diagonally, twice.
      for (const [wz, from, to] of [[z0 + 2, 0, p.width - 3], [z0 + 4, 2, p.width - 1]])
        for (let dx = from; dx <= to; dx++)
          s.fill(x0 + dx, x0 + dx, y + 1, y + 2, wz, wz, theme.platforms[dx % 2]);
    }
    if (p.kind === 'tunnel') {
      // A covered corridor: two blocks of headroom, so it has to be RUN, not
      // jumped, and the run-up for the next jump starts on the far side of it.
      for (let dz = 2; dz <= 4; dz++) {
        for (const jx of [x0 - 1, x0 + p.width])
          s.fill(jx, jx, y + 1, y + 3, z0 + dz, z0 + dz, theme.platforms[1]);
        s.fill(x0 - 1, x0 + p.width, y + 3, y + 3, z0 + dz, z0 + dz,
          dz === 3 ? Block.RuneGlass : Block.OpalBrick);
      }
    }
    if (p.kind === 'pit') {
      // A hole straight through the middle of the landing pad. Overshoot the
      // jump that reaches this pad and you go through it.
      s.carve(x0, x0 + p.width - 1, y, y, z0 + 3, z0 + 3);
      s.set(x0 + (p.width >> 1), y - 3, z0 + 3, Block.RuneGlass);
    }
    if (p.kind === 'teeth') {
      // Two staggered rows of single blocks — hop them, or weave them, but
      // you cannot hold a straight sprint through.
      for (let dx = 0; dx < p.width; dx += 2) s.set(x0 + dx, y + 1, z0 + 2, theme.platforms[2]);
      for (let dx = 1; dx < p.width; dx += 2) s.set(x0 + dx, y + 1, z0 + 4, theme.platforms[2]);
    }
  });
  // Start terrace and finish arch: the two ends of the line are unmistakable.
  const first = course[0], last = course[course.length - 1];
  s.fill(Math.floor(first.x) - 3, Math.floor(first.x) + 3, first.y - 1, first.y - 1,
    Math.floor(first.z) - 5, Math.floor(first.z) - 1, theme.platforms[0]);
  for (const dx of [-3, 3]) {
    s.fill(Math.floor(last.x) + dx, Math.floor(last.x) + dx, last.y, last.y + 4,
      Math.floor(last.z), Math.floor(last.z), Block.GildedVaultBrick);
  }
  s.fill(Math.floor(last.x) - 3, Math.floor(last.x) + 3, last.y + 5, last.y + 5,
    Math.floor(last.z), Math.floor(last.z), Block.GildedVaultBrick);
  s.fill(Math.floor(last.x) - 1, Math.floor(last.x) + 1, last.y + 4, last.y + 4,
    Math.floor(last.z), Math.floor(last.z), Block.RuneGlass);
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
    const p = parkourCourse(sub.seed)[0];
    return members.map((_, i) => ({
      x: sub.minX + p.x + (i % 2 ? .7 : -.7), y: p.y + .01, z: sub.minZ + p.z,
    }));
  }
  const seats = [0, 0];
  return members.map((m) => bridgeSpawn(sub, m.team, seats[m.team]++));
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
    cause: 'cleaver' | 'bow' | 'void';
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

/** Round order: score first, then whoever got there with fewer falls. */
export function orderPartyRound(ps: Iterable<PartyParticipant>): PartyParticipant[] {
  return [...ps].sort((a, b) =>
    Number(b.connected) - Number(a.connected) || b.score - a.score ||
    (a.finishedAt ?? Infinity) - (b.finishedAt ?? Infinity) ||
    a.falls - b.falls || a.joinOrder - b.joinOrder);
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
  private readonly lastThemes = new Map<number, number>();
  private themeBag: number[] = [];
  constructor(private readonly tokenFactory: () => string) { }

  private static blank(identity: PartyIdentity, host: boolean, joinOrder: number): PartyParticipant {
    return {
      ...identity, host, ready: false, connected: true, joinOrder, team: 0, score: 0,
      kills: 0, deaths: 0, lastHitBy: undefined, lastHitAt: 0,
      checkpoint: 0, progress: 0, falls: 0, immuneUntil: 0, pendingSpawn: false,
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
    this.usedSlots.add(slot);
    // Random secret token + monotonic counter produces a fresh course on every replay.
    let seed = ++this.seedCounter;
    for (const c of this.tokenFactory()) seed = partyHash(seed, c.charCodeAt(0));
    if (l.mode === 'parkour') {
      const excluded = new Set([...l.participants.keys()].map((v) => this.lastThemes.get(v)));
      if (!this.themeBag.length)
        this.themeBag = PARKOUR_THEMES.map((_, i) => i).sort((a, b) => partyHash(seed, a) - partyHash(seed, b));
      const next = this.themeBag.findIndex((t) => !excluded.has(t));
      const theme = next >= 0 ? this.themeBag.splice(next, 1)[0]
        : PARKOUR_THEMES.map((_, i) => i).find((t) => !excluded.has(t))!;
      seed = ((seed & ~7) | theme) >>> 0;
      for (const v of l.participants.keys()) this.lastThemes.set(v, theme);
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
    for (const p of l.participants.values())
      Object.assign(p, {
        score: 0, kills: 0, deaths: 0, lastHitBy: undefined, lastHitAt: 0,
        progress: 0, checkpoint: 0, falls: 0,
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
    cause: 'cleaver' | 'bow' | 'void' = 'cleaver'): PartyLobbySnapshot | null {
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
      p.finishedAt !== undefined || now >= l.round.endsAt) return { changed: false };
    const sub = this.subFor(id)!;
    return sub.game === 'bridge' ? this.evaluateBridge(l, p, sub, pos, now)
      : this.evaluateParkour(l, p, sub, pos, now);
  }

  private evaluateBridge(l: PartyLobby, p: PartyParticipant, sub: PartySubBounds, pos: PartyVec3, now: number):
    { spawn?: PartyVec3; changed: boolean } {
    const seat = [...l.participants.values()].filter((v) => v.team === p.team && v.joinOrder < p.joinOrder).length;
    const home = (): { spawn: PartyVec3; changed: boolean } => {
      p.pendingSpawn = false;
      p.immuneUntil = now + BRIDGE_RESPAWN_SHIELD_MS;
      return { spawn: bridgeSpawn(sub, p.team, seat), changed: true };
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
    const course = parkourCourse(sub.seed);
    const reset = (): { spawn: PartyVec3; changed: boolean } => {
      p.falls++;
      p.immuneUntil = now + 1400;
      p.progress = p.checkpoint;
      p.pendingSpawn = false;
      const base = course[p.checkpoint];
      return { spawn: { x: sub.minX + base.x, y: base.y + .01, z: sub.minZ + base.z }, changed: true };
    };
    if (p.pendingSpawn) return reset();
    if (pos.y < PARTY_VOID_Y || pos.y < PARTY_FLOOR_Y - 4) return reset();
    const next = course[p.progress + 1];
    if (next &&
      Math.abs(pos.x - sub.minX - next.x) < next.width / 2 + .35 &&
      Math.abs(pos.z - sub.minZ - next.z) < next.depth / 2 + .35 &&
      Math.abs(pos.y - next.y) < .35) {
      p.progress++;
      p.score = Math.max(p.score, p.progress);
      if (next.checkpoint) p.checkpoint = p.progress;
      if (p.progress === course.length - 1) {
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
    const tied = board[0].score === board[1]?.score && board[0].falls === board[1]?.falls && !board[0].finishedAt;
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
