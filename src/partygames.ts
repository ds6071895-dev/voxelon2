// Pure, shared Party Games domain model. No DOM, THREE or Node; every clock is
// passed in as `now: number`.
//
// UNRANKED BY CONSTRUCTION, like Bedwars: this module does not import
// `duels_progression`, so a Party match cannot award RP or touch the Duels
// ladder. The Crown is the only prize.
//
// ── The one non-obvious constraint ────────────────────────────────────────
// Terrain is CACHED PER CHUNK and stamped from a pure function of (x, y, z),
// so a microgame arena cannot be re-stamped between rounds. Duels gets away
// with a single arena because it never changes shape; a four-microgame
// playlist would need four different shapes in one place.
//
// The fix, and the reason the footprint is 64 x 256 rather than square: all
// four microgame arenas are stamped SIDE BY SIDE, permanently, in the same
// slot. Sub-arena k occupies local z in [k * PARTY_SUB_STRIDE, + PARTY_SUB_SIZE).
// A round transition teleports players to the next sub-arena and re-crops the
// render bounds; the client streams only the ~48-block bubble it stands in, so
// the extra geometry is free at runtime.
//
// That constraint is baked into the signatures below — `blockAt` takes LOCAL
// sub-arena coordinates and the sub-arena index is fixed at table-definition
// time — so it cannot be got wrong later by someone who has not read this.

import { Block } from './blocks';
import { Item } from './items';

/**
 * Base x of the Party band.
 *
 * NOT the 98_304 that first suggested itself: that leaves only
 * (98304 - 65536) / 1024 = 32 Bedwars slots before the two bands collide, and
 * `arenaBandsDisjoint` refuses it. 262_144 gives Bedwars 192 slots of headroom
 * on top of Duels' 104, which is far beyond any plausible concurrent load.
 * `Chunk.key` is a plain string, so a large x costs nothing.
 */
export const PARTY_BASE_X = 262_144;
export const PARTY_SLOT_SPACING = 1024;
/** Playable extent of one microgame arena. */
export const PARTY_SUB_SIZE = 48;
/** z distance between consecutive sub-arenas. The 16-block remainder is void,
 *  so no microgame can ever see or fall into its neighbour. */
export const PARTY_SUB_STRIDE = 64;
export const PARTY_ARENA_SIZE_X = 64;
export const PARTY_ARENA_SIZE_Z = 256;
export const PARTY_FLOOR_Y = 140;
export const PARTY_VOID_Y = 118;
export const PARTY_CEILING_Y = 176;
export const PARTY_STAMP_MIN_Y = 132;
export const PARTY_STAMP_MAX_Y = 176;
export const PARTY_MAX_HEALTH = 20;
export const PARTY_AMBIENT_LIGHT = 0.8;

export const PARTY_CAPACITY = 8;
export const PARTY_MIN_PLAYERS = 3;
export const PARTY_COUNTDOWN_MS = 5_000;
export const PARTY_INTERMISSION_MS = 8_000;
export const PARTY_ARENA_LOAD_TIMEOUT_MS = 30_000;
export const PARTY_RESULT_MS = 20_000;
/** Placement points, best first. Index 0 is the winner of one microgame. */
export const PARTY_PLACEMENT_POINTS = [10, 7, 5, 4, 3, 2, 1, 0] as const;

export interface PartyVec3 { x: number; y: number; z: number }

export type PartyGameId = 'spleef' | 'colors' | 'lava' | 'knockback';

/** What a microgame lets players do to the floor. */
export type PartyEditable = 'none' | 'break_floor';
export type PartyLoadout = 'shovel' | 'stick' | 'none';

// ── Sub-arena addressing ───────────────────────────────────────────────────

export interface PartyArenaBounds {
  slot: number;
  originX: number;
  originZ: number;
  minX: number; maxX: number;
  minY: number; maxY: number;
  minZ: number; maxZ: number;
  floor: number;
  ceiling: number;
  voidY: number;
}

/** The crop + containment box for ONE sub-arena. */
export interface PartySubBounds extends PartyArenaBounds {
  index: number;
  game: PartyGameId;
}

export function partyArenaBounds(slot: number): PartyArenaBounds {
  const safeSlot = Math.max(0, Math.floor(slot));
  const originX = PARTY_BASE_X + safeSlot * PARTY_SLOT_SPACING;
  return {
    slot: safeSlot, originX, originZ: 0,
    minX: originX, maxX: originX + PARTY_ARENA_SIZE_X,
    minZ: 0, maxZ: PARTY_ARENA_SIZE_Z,
    minY: PARTY_VOID_Y, maxY: PARTY_CEILING_Y,
    floor: PARTY_FLOOR_Y, ceiling: PARTY_CEILING_Y, voidY: PARTY_VOID_Y,
  };
}

/** The z offset of sub-arena `index` inside the slot footprint. */
export function partySubOriginZ(index: number): number {
  return Math.max(0, Math.floor(index)) * PARTY_SUB_STRIDE;
}

export function partySubBounds(slot: number, index: number): PartySubBounds {
  const arena = partyArenaBounds(slot);
  const i = Math.max(0, Math.min(PARTY_GAMES.length - 1, Math.floor(index)));
  const oz = partySubOriginZ(i);
  // The playable disc is centred in the 64-wide x footprint.
  const ox = arena.originX + (PARTY_ARENA_SIZE_X - PARTY_SUB_SIZE) / 2;
  return {
    ...arena,
    index: i, game: PARTY_GAMES[i].id,
    minX: ox, maxX: ox + PARTY_SUB_SIZE,
    minZ: oz, maxZ: oz + PARTY_SUB_SIZE,
  };
}

export function partyArenaAt(x: number, z: number): PartyArenaBounds | null {
  if (!Number.isFinite(x) || !Number.isFinite(z)) return null;
  if (x < PARTY_BASE_X || z < 0 || z >= PARTY_ARENA_SIZE_Z) return null;
  const slot = Math.floor((x - PARTY_BASE_X) / PARTY_SLOT_SPACING);
  const arena = partyArenaBounds(slot);
  return x >= arena.originX && x < arena.originX + PARTY_ARENA_SIZE_X ? arena : null;
}

export function clampToPartySub(p: PartyVec3, sub: PartySubBounds): PartyVec3 {
  return {
    x: Math.max(sub.minX + 0.15, Math.min(sub.maxX - 0.15, p.x)),
    // As in Bedwars, y is capped but NOT floored: falling below `voidY` is an
    // elimination, and clamping it would delete the mechanic.
    y: Math.min(sub.ceiling - 0.85, p.y),
    z: Math.max(sub.minZ + 0.15, Math.min(sub.maxZ - 0.15, p.z)),
  };
}

// ── Microgame definitions ──────────────────────────────────────────────────

export interface PartyGameDef {
  id: PartyGameId;
  /** Its permanent sub-arena slot. Asserted to equal its array index. */
  index: number;
  title: string;
  rule: string;
  durationMs: number;
  editable: PartyEditable;
  loadout: PartyLoadout;
  /** Authored geometry, in LOCAL sub-arena coordinates (0..PARTY_SUB_SIZE). */
  blockAt(lx: number, y: number, lz: number, floor: number): number | null;
  /** n spawn points on solid ground, in local coordinates. */
  spawns(n: number, floor: number): PartyVec3[];
}

/** Local centre of a sub-arena, in cell coordinates. */
const C = PARTY_SUB_SIZE / 2; // 24

function ring(n: number, radius: number, floor: number): PartyVec3[] {
  const out: PartyVec3[] = [];
  const count = Math.max(1, Math.floor(n));
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2;
    out.push({
      x: C + Math.cos(a) * radius + 0.5,
      y: floor + 1.01,
      z: C + Math.sin(a) * radius + 0.5,
    });
  }
  return out;
}

function disc(lx: number, lz: number, radius: number): boolean {
  const dx = lx - C + 0.5, dz = lz - C + 0.5;
  return dx * dx + dz * dz <= radius * radius;
}

/** HALF-OPEN, deliberately: `Math.abs(lx - C) < half` is symmetric and so
 *  excludes the lower edge, leaving a 35-wide field where a 36-wide one was
 *  intended — and the missing row lands under a spawn ring. */
function square(lx: number, lz: number, half: number): boolean {
  return lx - C >= -half && lx - C < half && lz - C >= -half && lz - C < half;
}

// 1. SPLEEF ────────────────────────────────────────────────────────────────
// A 25-diameter snow disc one row thick, with a 1-block Void Rim lip so nobody
// can ride the edge. Break the floor out from under people. The whole rule is
// enforced by one predicate: Air, onto a cell whose authored block is snow.
export const SPLEEF_RADIUS = 12.5;

const SPLEEF: PartyGameDef = {
  id: 'spleef', index: 0,
  title: 'SPLEEF', rule: 'Dig the floor out from under them. Last one standing wins.',
  durationMs: 75_000, editable: 'break_floor', loadout: 'shovel',
  blockAt(lx, y, lz, floor) {
    if (y !== floor) return null;
    if (disc(lx, lz, SPLEEF_RADIUS - 1)) return Block.PackedSnow;
    if (disc(lx, lz, SPLEEF_RADIUS)) return Block.ArenaRim;
    return null;
  },
  spawns(n, floor) { return ring(n, SPLEEF_RADIUS - 3, floor); },
};

// 2. COLOR CHAOS ───────────────────────────────────────────────────────────
// A 36x36 floor of 3x3 tiles in four colours. A colour is called; every OTHER
// colour vanishes for two seconds, then returns.
export const COLORS_FIELD = 36;
export const COLORS_TILE = 3;
export const COLORS_PALETTE = [
  Block.TeamWoolA, Block.TeamWoolB, Block.PartyTileC, Block.PartyTileD,
] as const;
export const COLORS_CALLS = 8;
export const COLORS_WARN_MS = 3_000;
export const COLORS_VANISH_MS = 2_000;
export const COLORS_START_INTERVAL_MS = 5_000;
export const COLORS_END_INTERVAL_MS = 3_200;

/** Which colour index a tile carries. A deterministic hash, so the stamp stays
 *  a pure function of position and the same floor appears on every client. */
export function colorsTileIndex(tx: number, tz: number): number {
  // Every step stays UNSIGNED. `a ^ b` in JS produces a SIGNED int32, so the
  // final `%` without a `>>> 0` returns a NEGATIVE index for roughly half of
  // all tiles — which reads downstream as "no tile here" and punches holes in
  // the floor, including under a spawn point. The smoke test caught exactly
  // that; the `>>> 0` on the last line is the whole fix.
  let h = (Math.imul(tx, 0x27d4eb2d) ^ Math.imul(tz, 0x165667b1)) >>> 0;
  h = (h ^ (h >>> 15)) >>> 0;
  h = Math.imul(h, 0x2545f491) >>> 0;
  return ((h ^ (h >>> 13)) >>> 0) % COLORS_PALETTE.length;
}

/** The colour of the tile containing a local cell, or -1 if off the field. */
export function colorsColorAt(lx: number, lz: number): number {
  const half = COLORS_FIELD / 2;
  if (!square(lx, lz, half)) return -1;
  const tx = Math.floor((lx - (C - half)) / COLORS_TILE);
  const tz = Math.floor((lz - (C - half)) / COLORS_TILE);
  return colorsTileIndex(tx, tz);
}

const COLORS: PartyGameDef = {
  id: 'colors', index: 1,
  title: 'COLOR CHAOS', rule: 'Stand on the called colour before the rest of the floor drops.',
  durationMs: 70_000, editable: 'none', loadout: 'none',
  blockAt(lx, y, lz, floor) {
    if (y !== floor) return null;
    const colour = colorsColorAt(lx, lz);
    return colour < 0 ? null : COLORS_PALETTE[colour];
  },
  spawns(n, floor) { return ring(n, COLORS_FIELD / 2 - 4, floor); },
};

/** Interval between calls, tightening across the round. */
export function colorsInterval(call: number): number {
  const t = Math.max(0, Math.min(1, call / Math.max(1, COLORS_CALLS - 1)));
  return Math.round(COLORS_START_INTERVAL_MS +
    (COLORS_END_INTERVAL_MS - COLORS_START_INTERVAL_MS) * t);
}

// 3. RISING SLUDGE ─────────────────────────────────────────────────────────
// A stepped pyramid the players climb as the floor fills from below.
//
// Originally "Rising Lava". Lava in a context-free arena drags in contact
// damage, client lava fog, and the non-opaque mesher path — three systems that
// all assume open-world context. The PRE-DECIDED fallback was Block.Tar as an
// opaque "rising sludge" with a pure y-threshold elimination and no fluid
// semantics at all, and that is what this is. It costs one comparison per tick
// and behaves identically on client and server.
export const SLUDGE_TIERS = 7;
export const SLUDGE_INSET = 3;
export const SLUDGE_BASE_HALF = 10;      // 21x21 footprint
export const SLUDGE_STEP_MS = 4_000;
/** Bounded BY CONSTRUCTION: seven rows at four seconds is at most 28s of
 *  climbing, so the microgame cannot outrun its own time limit. */
export const SLUDGE_MAX_MS = SLUDGE_TIERS * SLUDGE_STEP_MS;

/** Top surface y of the pyramid at a local cell, or -1 for open air. */
export function sludgeHeightAt(lx: number, lz: number, floor: number): number {
  const d = Math.max(Math.abs(lx - C), Math.abs(lz - C));
  if (d > SLUDGE_BASE_HALF) return -1;
  const tier = Math.min(SLUDGE_TIERS - 1, Math.floor((SLUDGE_BASE_HALF - d) / SLUDGE_INSET));
  return floor + 1 + tier;
}

/** The sludge surface y after `elapsed` ms. Rises one row per step. */
export function sludgeLevel(elapsedMs: number, floor: number): number {
  const rows = Math.min(SLUDGE_TIERS, Math.floor(Math.max(0, elapsedMs) / SLUDGE_STEP_MS));
  return floor + rows;
}

const SLUDGE: PartyGameDef = {
  id: 'lava', index: 2,
  title: 'RISING SLUDGE', rule: 'The sludge is coming up. Climb, and be the last one dry.',
  durationMs: 90_000, editable: 'none', loadout: 'none',
  blockAt(lx, y, lz, floor) {
    const top = sludgeHeightAt(lx, lz, floor);
    if (top < 0) return null;
    if (y > top || y < floor) return null;
    // Step caps read differently from the body so the climb is legible.
    return y === top ? Block.Terracotta : Block.Basalt;
  },
  spawns(n, floor) {
    // Around the pyramid's base ring, so nobody starts already at the summit.
    return ring(n, SLUDGE_BASE_HALF - 1, floor).map((p) => ({
      ...p, y: sludgeHeightAt(Math.floor(p.x), Math.floor(p.z), floor) + 1.01,
    }));
  },
};

// 4. KNOCKBACK ARENA ───────────────────────────────────────────────────────
// A flat platform over void with a glass rim, and a stick that deals no damage
// and enormous knockback. This is `bedwarsSwing()` with one more tier-table
// entry — once Bedwars shipped, this microgame cost almost nothing.
export const KNOCKBACK_HALF = 10;        // 21x21 platform
export const KNOCKBACK_RIM_ROWS = 2;

/** The Knockback Stick's swing profile: no damage, huge launch. Fed to
 *  `bedwarsSwing` through the shared melee handler. */
export const PARTY_KNOCKBACK_TIER = {
  item: Item.KnockbackStick, damage: 0, cooldownMs: 350, kbBonus: 0.75,
} as const;

const KNOCKBACK: PartyGameDef = {
  id: 'knockback', index: 3,
  title: 'KNOCKBACK ARENA', rule: 'No damage, all launch. Stay on the platform.',
  durationMs: 60_000, editable: 'none', loadout: 'stick',
  blockAt(lx, y, lz, floor) {
    const dx = Math.abs(lx - C), dz = Math.abs(lz - C);
    const d = Math.max(dx, dz);
    if (d > KNOCKBACK_HALF) return null;
    if (y === floor) return Block.SpectralMarble;
    // A short glass rim on the OUTER ring only, so corners bounce you back in
    // rather than letting a clean diagonal launch end the round instantly.
    if (d === KNOCKBACK_HALF && y > floor && y <= floor + KNOCKBACK_RIM_ROWS) return Block.Glass;
    return null;
  },
  spawns(n, floor) { return ring(n, KNOCKBACK_HALF - 3, floor); },
};

export const PARTY_GAMES: readonly PartyGameDef[] = [SPLEEF, COLORS, SLUDGE, KNOCKBACK];
export const PARTY_PLAYLIST: readonly PartyGameId[] =
  ['spleef', 'colors', 'lava', 'knockback'];

export function partyGame(id: PartyGameId): PartyGameDef {
  return PARTY_GAMES.find((g) => g.id === id) ?? PARTY_GAMES[0];
}

/**
 * The whole slot's authored geometry, in WORLD coordinates.
 *
 * This dispatches on z to the owning sub-arena, so all four microgames are
 * stamped permanently, side by side, and nothing ever has to be re-stamped.
 */
export function partyArenaBlockAt(x: number, y: number, z: number): number | null {
  const arena = partyArenaAt(x, z);
  if (!arena) return null;
  const by = Math.floor(y);
  if (by < PARTY_STAMP_MIN_Y || by > PARTY_STAMP_MAX_Y) return null;
  const bz = Math.floor(z);
  const index = Math.floor(bz / PARTY_SUB_STRIDE);
  if (index < 0 || index >= PARTY_GAMES.length) return null;
  const lz = bz - index * PARTY_SUB_STRIDE;
  if (lz < 0 || lz >= PARTY_SUB_SIZE) return null; // the gutter between arenas
  const sub = partySubBounds(arena.slot, index);
  const lx = Math.floor(x) - sub.minX;
  if (lx < 0 || lx >= PARTY_SUB_SIZE) return null;
  return PARTY_GAMES[index].blockAt(lx, by, lz, PARTY_FLOOR_Y);
}

export function partySolidAt(x: number, y: number, z: number): boolean {
  const block = partyArenaBlockAt(x, y, z);
  return block !== null && block !== Block.Air;
}

/** World-space spawns for one sub-arena. */
export function partySpawns(sub: PartySubBounds, n: number): PartyVec3[] {
  return PARTY_GAMES[sub.index].spawns(n, PARTY_FLOOR_Y).map((p) => ({
    x: sub.minX + p.x, y: p.y, z: sub.minZ + p.z,
  }));
}

/**
 * Spleef's entire rule, as one predicate.
 *
 * The only legal edit in the whole mode: turning a cell to Air where the
 * authored block is snow. Everything else — the rim, another microgame's
 * floor, placing anything at all — falls out as false.
 */
export function partyCanBreak(
  sub: PartySubBounds, x: number, y: number, z: number, block: number,
): boolean {
  if (PARTY_GAMES[sub.index].editable !== 'break_floor') return false;
  if (block !== Block.Air) return false;
  return partyArenaBlockAt(x, y, z) === Block.PackedSnow;
}

// ── Match state ────────────────────────────────────────────────────────────

export type PartyPhase = 'lobby' | 'countdown' | 'running' | 'intermission' | 'results';
export type PartyFinishReason = 'complete' | 'forfeit' | 'cancelled';
export type PartyJoinFailure = 'invalid' | 'full' | 'match_in_progress' | 'already_in_lobby';
export type PartyStartFailure =
  | 'not_host' | 'too_few_players' | 'too_many_players' | 'not_everyone_ready' | 'not_in_lobby';

export interface PartyIdentity { id: number; username: string; skin: number }

export interface PartyParticipant extends PartyIdentity {
  host: boolean;
  ready: boolean;
  connected: boolean;
  joinOrder: number;
  /** Total placement points across the playlist. */
  points: number;
  /** Placements taken, so ties break on firsts then seconds. */
  placements: number[];
  /** Alive in the CURRENT microgame. */
  alive: boolean;
  /** When they were eliminated this round; Infinity while still alive. */
  eliminatedAt: number;
}

export interface PartyResult {
  winner: number | null;
  scoreboard: PartyParticipant[];
  finishReason: PartyFinishReason;
  durationMs: number;
  /** Explicit, so no client renders an RP delta for an unranked mode. */
  ranked: false;
}

export interface PartyRoundState {
  game: PartyGameId;
  index: number;
  startedAt: number;
  endsAt: number;
}

export interface PartyLobbySnapshot {
  id: string;
  phase: PartyPhase;
  capacity: number;
  participants: PartyParticipant[];
  host: number;
  serverNow: number;
  countdownEndsAt?: number;
  arenaLoadDeadline?: number;
  intermissionEndsAt?: number;
  /** Index into PARTY_PLAYLIST, 0-based. */
  roundIndex: number;
  round?: PartyRoundState;
  /** The microgame the intermission card is counting down TO. */
  nextGame?: PartyGameId;
  arena?: PartyArenaBounds;
  sub?: PartySubBounds;
  arenaReady?: Set<number>;
  result?: PartyResult;
  ranked: false;
}

/**
 * Placement points for a finished microgame.
 *
 * Survivors at the time limit rank ahead of everyone eliminated; among the
 * eliminated, later is better. Pure and total, so the smoke test can assert it
 * is a real ordering rather than a sort that happens to be stable today.
 */
export function orderPartyRound(participants: Iterable<PartyParticipant>): PartyParticipant[] {
  return [...participants].sort((a, b) =>
    (b.alive ? 1 : 0) - (a.alive ? 1 : 0) ||
    b.eliminatedAt - a.eliminatedAt ||
    a.joinOrder - b.joinOrder);
}

/** Final standings: points, then most firsts, then most seconds, then join order. */
export function orderPartyOverall(participants: Iterable<PartyParticipant>): PartyParticipant[] {
  const countAt = (p: PartyParticipant, place: number): number =>
    p.placements.filter((v) => v === place).length;
  return [...participants].sort((a, b) =>
    b.points - a.points ||
    countAt(b, 0) - countAt(a, 0) ||
    countAt(b, 1) - countAt(a, 1) ||
    a.joinOrder - b.joinOrder);
}

export function partyPointsFor(place: number): number {
  const i = Math.max(0, Math.floor(place));
  return i < PARTY_PLACEMENT_POINTS.length ? PARTY_PLACEMENT_POINTS[i] : 0;
}

interface PartyLobby {
  id: string;
  token: string;
  phase: PartyPhase;
  participants: Map<number, PartyParticipant>;
  host: number;
  nextJoinOrder: number;
  countdownEndsAt?: number;
  arenaLoadDeadline?: number;
  arenaReady?: Set<number>;
  intermissionEndsAt?: number;
  roundIndex: number;
  round?: PartyRoundState;
  arena?: PartyArenaBounds;
  result?: PartyResult;
  resultDeadline?: number;
  startedAt?: number;
}

export interface PartyCreateResult { token: string; snapshot: PartyLobbySnapshot }
export type PartyJoinResult =
  | { ok: true; snapshot: PartyLobbySnapshot }
  | { ok: false; reason: PartyJoinFailure };

export class PartyGamesEngine {
  private readonly lobbies = new Map<string, PartyLobby>();
  private readonly lobbyByPlayer = new Map<number, PartyLobby>();
  private readonly usedSlots = new Set<number>();
  private nextLobbyId = 1;

  constructor(private readonly tokenFactory: () => string) {}

  create(identity: PartyIdentity, now: number): PartyCreateResult | { reason: 'already_in_lobby' } {
    if (this.lobbyByPlayer.has(identity.id)) return { reason: 'already_in_lobby' };
    let token = '';
    do token = this.tokenFactory(); while (!token || token.length < 24 || this.lobbies.has(token));
    const p = this.newParticipant(identity, true, 0);
    const lobby: PartyLobby = {
      id: `P${this.nextLobbyId++}`, token, phase: 'lobby',
      participants: new Map([[p.id, p]]), host: p.id, nextJoinOrder: 1, roundIndex: 0,
    };
    this.lobbies.set(token, lobby);
    this.lobbyByPlayer.set(p.id, lobby);
    return { token, snapshot: this.snapshotLobby(lobby, now) };
  }

  join(token: string, identity: PartyIdentity, now: number): PartyJoinResult {
    if (this.lobbyByPlayer.has(identity.id)) return { ok: false, reason: 'already_in_lobby' };
    const lobby = this.lobbies.get(token);
    if (!lobby) return { ok: false, reason: 'invalid' };
    if (lobby.phase !== 'lobby') return { ok: false, reason: 'match_in_progress' };
    if (lobby.participants.size >= PARTY_CAPACITY) return { ok: false, reason: 'full' };
    this.resetReady(lobby);
    const p = this.newParticipant(identity, false, lobby.nextJoinOrder++);
    lobby.participants.set(p.id, p);
    this.lobbyByPlayer.set(p.id, lobby);
    return { ok: true, snapshot: this.snapshotLobby(lobby, now) };
  }

  leave(playerId: number, now: number): { snapshot?: PartyLobbySnapshot; deleted: boolean; token?: string } {
    const lobby = this.lobbyByPlayer.get(playerId);
    if (!lobby) return { deleted: false };
    const live = lobby.phase === 'running' || lobby.phase === 'intermission';
    const leaving = lobby.participants.get(playerId);
    this.lobbyByPlayer.delete(playerId);
    if (live && leaving) {
      leaving.connected = false; leaving.alive = false;
      leaving.eliminatedAt = Math.min(leaving.eliminatedAt, now);
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
    else if (live || lobby.phase === 'countdown') {
      const connected = [...lobby.participants.values()].filter((p) => p.connected);
      // An FFA needs at least two bodies to mean anything.
      if (connected.length <= 1) this.finish(lobby, now, connected[0]?.id ?? null, 'forfeit');
      else if (lobby.phase === 'countdown') this.tryArmCountdown(lobby, now);
    } else if (lobby.phase === 'results') {
      this.returnToLobby(lobby);
    }
    if (lobby.participants.size === 0) {
      this.releaseArena(lobby);
      this.lobbies.delete(lobby.token);
      return { deleted: true, token: lobby.token };
    }
    return { snapshot: this.snapshotLobby(lobby, now), deleted: false };
  }

  setReady(playerId: number, ready: boolean, now: number): PartyLobbySnapshot | null {
    const lobby = this.lobbyByPlayer.get(playerId);
    const p = lobby?.participants.get(playerId);
    if (!lobby || !p || lobby.phase !== 'lobby') return null;
    p.ready = ready;
    return this.snapshotLobby(lobby, now);
  }

  start(playerId: number, now: number):
  { ok: true; snapshot: PartyLobbySnapshot } | { ok: false; reason: PartyStartFailure } {
    const lobby = this.lobbyByPlayer.get(playerId);
    if (!lobby || lobby.phase !== 'lobby') return { ok: false, reason: 'not_in_lobby' };
    if (lobby.host !== playerId) return { ok: false, reason: 'not_host' };
    if (lobby.participants.size < PARTY_MIN_PLAYERS) return { ok: false, reason: 'too_few_players' };
    if (lobby.participants.size > PARTY_CAPACITY) return { ok: false, reason: 'too_many_players' };
    if ([...lobby.participants.values()].some((p) => !p.connected || !p.ready)) {
      return { ok: false, reason: 'not_everyone_ready' };
    }
    this.beginCountdown(lobby, now);
    return { ok: true, snapshot: this.snapshotLobby(lobby, now) };
  }

  markArenaReady(playerId: number, now: number): PartyLobbySnapshot | null {
    const lobby = this.lobbyByPlayer.get(playerId);
    if (!lobby || lobby.phase !== 'countdown' || lobby.countdownEndsAt !== undefined) return null;
    lobby.arenaReady?.add(playerId);
    this.tryArmCountdown(lobby, now);
    return this.snapshotLobby(lobby, now);
  }

  /** Knock somebody out of the current microgame. Idempotent. */
  recordElimination(playerId: number, now: number): PartyLobbySnapshot | null {
    const lobby = this.lobbyByPlayer.get(playerId);
    if (!lobby || lobby.phase !== 'running') return null;
    const p = lobby.participants.get(playerId);
    if (!p || !p.alive) return null;
    p.alive = false;
    p.eliminatedAt = now;
    // Last one standing ends the round immediately rather than making everyone
    // watch a solo victory lap.
    const alive = [...lobby.participants.values()].filter((v) => v.alive && v.connected);
    if (alive.length <= 1) this.endRound(lobby, now);
    return this.snapshotLobby(lobby, now);
  }

  tick(now: number): PartyLobbySnapshot[] {
    const changed: PartyLobbySnapshot[] = [];
    for (const lobby of this.lobbies.values()) {
      let dirty = false;
      if (lobby.phase === 'countdown' && lobby.countdownEndsAt === undefined &&
          now >= (lobby.arenaLoadDeadline ?? Infinity)) {
        this.returnToLobby(lobby); dirty = true;
      }
      if (lobby.phase === 'countdown' && now >= (lobby.countdownEndsAt ?? Infinity)) {
        this.beginRound(lobby, now); dirty = true;
      }
      if (lobby.phase === 'running' && now >= (lobby.round?.endsAt ?? Infinity)) {
        this.endRound(lobby, now); dirty = true;
      }
      if (lobby.phase === 'intermission' && now >= (lobby.intermissionEndsAt ?? Infinity)) {
        if (lobby.roundIndex >= PARTY_PLAYLIST.length) {
          const board = orderPartyOverall(lobby.participants.values());
          this.finish(lobby, now, board[0]?.id ?? null, 'complete');
        } else {
          this.beginRound(lobby, now);
        }
        dirty = true;
      }
      if (lobby.phase === 'results' && now >= (lobby.resultDeadline ?? Infinity)) {
        this.returnToLobby(lobby); dirty = true;
      }
      if (dirty) changed.push(this.snapshotLobby(lobby, now));
    }
    return changed;
  }

  snapshotFor(playerId: number, now: number): PartyLobbySnapshot | null {
    const lobby = this.lobbyByPlayer.get(playerId);
    return lobby ? this.snapshotLobby(lobby, now) : null;
  }
  snapshots(now: number): PartyLobbySnapshot[] {
    return [...this.lobbies.values()].map((lobby) => this.snapshotLobby(lobby, now));
  }
  tokenFor(playerId: number): string | null { return this.lobbyByPlayer.get(playerId)?.token ?? null; }
  arenaFor(playerId: number): PartyArenaBounds | null {
    return this.lobbyByPlayer.get(playerId)?.arena ?? null;
  }
  subFor(playerId: number): PartySubBounds | null {
    const lobby = this.lobbyByPlayer.get(playerId);
    if (!lobby?.arena || !lobby.round) return null;
    return partySubBounds(lobby.arena.slot, lobby.round.index);
  }
  phaseFor(playerId: number): PartyPhase | null {
    return this.lobbyByPlayer.get(playerId)?.phase ?? null;
  }
  roundFor(playerId: number): PartyRoundState | null {
    return this.lobbyByPlayer.get(playerId)?.round ?? null;
  }
  participantFor(playerId: number): PartyParticipant | null {
    return this.lobbyByPlayer.get(playerId)?.participants.get(playerId) ?? null;
  }
  membersOf(playerId: number): number[] {
    return [...(this.lobbyByPlayer.get(playerId)?.participants.keys() ?? [])];
  }
  /** Both ids are in ONE live Party match. The gate every in-match action
   *  starts from, and false unless a microgame is actually running. */
  sameMatch(a: number, b: number): boolean {
    const lobby = this.lobbyByPlayer.get(a);
    return !!lobby && lobby === this.lobbyByPlayer.get(b) && lobby.phase === 'running';
  }
  /** Is the CURRENT microgame the knockback one? Gates the stick's melee. */
  knockbackLive(playerId: number): boolean {
    const lobby = this.lobbyByPlayer.get(playerId);
    return lobby?.phase === 'running' && lobby.round?.game === 'knockback';
  }

  private newParticipant(
    identity: PartyIdentity, host: boolean, joinOrder: number,
  ): PartyParticipant {
    return {
      ...identity, host, ready: false, connected: true, joinOrder,
      points: 0, placements: [], alive: true, eliminatedAt: Infinity,
    };
  }

  private resetReady(lobby: PartyLobby): void {
    for (const p of lobby.participants.values()) p.ready = false;
  }

  private allocateSlot(): number {
    let slot = 0;
    while (this.usedSlots.has(slot)) slot++;
    this.usedSlots.add(slot);
    return slot;
  }

  private releaseArena(lobby: PartyLobby): void {
    if (lobby.arena) this.usedSlots.delete(lobby.arena.slot);
    lobby.arena = undefined;
  }

  private beginCountdown(lobby: PartyLobby, now: number): void {
    if (!lobby.arena) lobby.arena = partyArenaBounds(this.allocateSlot());
    lobby.phase = 'countdown';
    lobby.countdownEndsAt = undefined;
    lobby.arenaLoadDeadline = now + PARTY_ARENA_LOAD_TIMEOUT_MS;
    lobby.arenaReady = new Set();
    lobby.roundIndex = 0;
    lobby.round = undefined;
    lobby.result = undefined;
    lobby.resultDeadline = undefined;
    lobby.intermissionEndsAt = undefined;
    lobby.startedAt = undefined;
    for (const p of lobby.participants.values()) {
      p.points = 0; p.placements = []; p.alive = true; p.eliminatedAt = Infinity; p.ready = false;
    }
    this.tryArmCountdown(lobby, now);
  }

  private tryArmCountdown(lobby: PartyLobby, now: number): void {
    if (lobby.phase !== 'countdown' || lobby.countdownEndsAt !== undefined) return;
    const waiting = [...lobby.participants.values()].filter((p) => p.connected);
    if (waiting.length === 0) return;
    if (!waiting.every((p) => lobby.arenaReady?.has(p.id))) return;
    lobby.countdownEndsAt = now + PARTY_COUNTDOWN_MS;
  }

  private beginRound(lobby: PartyLobby, now: number): void {
    const id = PARTY_PLAYLIST[lobby.roundIndex];
    const def = partyGame(id);
    lobby.phase = 'running';
    lobby.startedAt ??= now;
    lobby.intermissionEndsAt = undefined;
    lobby.round = { game: id, index: def.index, startedAt: now, endsAt: now + def.durationMs };
    for (const p of lobby.participants.values()) {
      p.alive = p.connected;
      p.eliminatedAt = p.connected ? Infinity : now;
    }
  }

  /** Score the finished microgame and open the intermission. */
  private endRound(lobby: PartyLobby, now: number): void {
    if (lobby.phase !== 'running') return;
    const board = orderPartyRound(lobby.participants.values());
    board.forEach((p, place) => {
      p.points += partyPointsFor(place);
      p.placements.push(place);
    });
    lobby.roundIndex++;
    lobby.round = undefined;
    lobby.phase = 'intermission';
    lobby.intermissionEndsAt = now + PARTY_INTERMISSION_MS;
    for (const p of lobby.participants.values()) {
      p.alive = p.connected; p.eliminatedAt = Infinity;
    }
  }

  private finish(
    lobby: PartyLobby, now: number, winner: number | null, reason: PartyFinishReason,
  ): void {
    if (lobby.phase === 'results') return;
    const board = orderPartyOverall(lobby.participants.values());
    lobby.phase = 'results';
    lobby.round = undefined;
    lobby.intermissionEndsAt = undefined;
    // No progression call, by design: Party Games is UNRANKED. The Crown is
    // the prize, and this module does not import duels_progression at all.
    lobby.result = {
      winner: winner ?? board[0]?.id ?? null,
      scoreboard: board.map((p) => ({ ...p, placements: [...p.placements] })),
      finishReason: reason,
      durationMs: Math.max(0, now - (lobby.startedAt ?? now)),
      ranked: false,
    };
    lobby.resultDeadline = now + PARTY_RESULT_MS;
  }

  private returnToLobby(lobby: PartyLobby): void {
    lobby.phase = 'lobby';
    lobby.countdownEndsAt = undefined;
    lobby.arenaLoadDeadline = undefined;
    lobby.arenaReady = undefined;
    lobby.intermissionEndsAt = undefined;
    lobby.roundIndex = 0;
    lobby.round = undefined;
    lobby.result = undefined;
    lobby.resultDeadline = undefined;
    lobby.startedAt = undefined;
    this.releaseArena(lobby);
    for (const [id, p] of [...lobby.participants]) {
      if (!p.connected) { lobby.participants.delete(id); continue; }
      p.ready = false; p.points = 0; p.placements = [];
      p.alive = true; p.eliminatedAt = Infinity;
    }
    if (!lobby.participants.has(lobby.host)) {
      const next = [...lobby.participants.values()].sort((a, b) => a.joinOrder - b.joinOrder)[0];
      if (next) { lobby.host = next.id; next.host = true; }
    }
  }

  private snapshotLobby(lobby: PartyLobby, now: number): PartyLobbySnapshot {
    return {
      id: lobby.id,
      phase: lobby.phase,
      capacity: PARTY_CAPACITY,
      participants: [...lobby.participants.values()]
        .sort((a, b) => a.joinOrder - b.joinOrder)
        .map((p) => ({ ...p, placements: [...p.placements] })),
      host: lobby.host,
      serverNow: now,
      countdownEndsAt: lobby.countdownEndsAt,
      arenaLoadDeadline: lobby.arenaLoadDeadline,
      intermissionEndsAt: lobby.intermissionEndsAt,
      roundIndex: lobby.roundIndex,
      round: lobby.round ? { ...lobby.round } : undefined,
      nextGame: lobby.roundIndex < PARTY_PLAYLIST.length
        ? PARTY_PLAYLIST[lobby.roundIndex] : undefined,
      arena: lobby.arena,
      sub: lobby.arena && lobby.round
        ? partySubBounds(lobby.arena.slot, lobby.round.index) : undefined,
      arenaReady: lobby.arenaReady,
      result: lobby.result,
      ranked: false,
    };
  }
}
