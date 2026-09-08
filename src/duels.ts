// Pure, shared Duels domain model. This file deliberately has no DOM or Node
// dependencies so the browser, authoritative server, and smoke tests all use
// the same clocks, score ordering, arena geometry, and lobby rules.

import { Block } from './blocks';
import {
  DuelProgressChange, DuelPublicProfile, duelProfileOf, newDuelProgress,
  sanitizeDuelProgress,
} from './duels_progression';
export { duelRankAt, duelRankProgress } from './duels_progression';

export type DuelPhase = 'lobby' | 'countdown' | 'running' | 'sudden_death' | 'results';
export type DuelFinishReason = 'time' | 'score' | 'sudden_death' | 'forfeit' | 'cancelled';

/** Announcer beats. The server derives these from the authoritative kill feed
 * so every client shows the same call at the same moment. */
export type DuelEventKind =
  | 'first_blood' | 'double_kill' | 'triple_kill' | 'quad_kill'
  | 'spree' | 'rampage' | 'unstoppable' | 'godlike'
  | 'shutdown' | 'revenge' | 'match_point';

export interface DuelEvent {
  /** Monotonic per-lobby id. Clients play each beat exactly once. */
  seq: number;
  kind: DuelEventKind;
  actor: number;
  actorName: string;
  victim: number;
  victimName: string;
  /** Streak length or multi-kill size, whichever the beat is about. */
  count: number;
  at: number;
}

/** Consecutive kills land as one multi-kill while they stay inside this gap. */
export const DUEL_MULTI_KILL_MS = 8_000;
/** Killing spree thresholds, in kills without dying. */
export const DUEL_SPREE_STEPS: readonly { at: number; kind: DuelEventKind }[] = [
  { at: 3, kind: 'spree' }, { at: 5, kind: 'rampage' },
  { at: 7, kind: 'unstoppable' }, { at: 10, kind: 'godlike' },
];
/** Reaching this many kills wins the round outright, before the clock. */
export const DUEL_SCORE_LIMIT = 15;
/** How many announcer beats a snapshot carries back. */
export const DUEL_FEED_LENGTH = 6;

const DUEL_EVENT_COPY: Record<DuelEventKind, { title: string; sub: (e: DuelEvent) => string }> = {
  first_blood: { title: 'FIRST BLOOD', sub: (e) => `${e.actorName} drew it` },
  double_kill: { title: 'DOUBLE KILL', sub: (e) => `${e.actorName} \u00d72` },
  triple_kill: { title: 'TRIPLE KILL', sub: (e) => `${e.actorName} \u00d73` },
  quad_kill: { title: 'QUAD KILL', sub: (e) => `${e.actorName} \u00d74` },
  spree: { title: 'KILLING SPREE', sub: (e) => `${e.actorName} on ${e.count}` },
  rampage: { title: 'RAMPAGE', sub: (e) => `${e.actorName} on ${e.count}` },
  unstoppable: { title: 'UNSTOPPABLE', sub: (e) => `${e.actorName} on ${e.count}` },
  godlike: { title: 'GODLIKE', sub: (e) => `${e.actorName} on ${e.count}` },
  shutdown: { title: 'SHUTDOWN', sub: (e) => `${e.actorName} ended ${e.victimName}` },
  revenge: { title: 'REVENGE', sub: (e) => `${e.actorName} paid ${e.victimName} back` },
  match_point: { title: 'MATCH POINT', sub: (e) => `${e.actorName} needs one more` },
};

/** Presentation text for an announcer beat. Pure so the banner, the kill feed
 * and the smoke tests never drift apart. */
export function duelEventCopy(event: DuelEvent): { title: string; sub: string } {
  const copy = DUEL_EVENT_COPY[event.kind];
  return { title: copy.title, sub: copy.sub(event) };
}

/** Which announcer beats a single kill produces, most important last (the
 * client banners the last one and files the rest into the feed). */
export function duelKillEvents(state: {
  firstKillOfMatch: boolean;
  /** Killer's kills-without-dying AFTER this kill. */
  killerSpree: number;
  /** Victim's kills-without-dying BEFORE they died. */
  victimSpree: number;
  /** Kills the killer has landed inside the multi-kill window, this one included. */
  multi: number;
  /** The victim was the killer's most recent killer. */
  revenge: boolean;
  /** Killer's total kills AFTER this kill. */
  killerScore: number;
}): DuelEventKind[] {
  const beats: DuelEventKind[] = [];
  if (state.firstKillOfMatch) beats.push('first_blood');
  if (state.revenge) beats.push('revenge');
  if (state.victimSpree >= DUEL_SPREE_STEPS[0].at) beats.push('shutdown');
  const spree = [...DUEL_SPREE_STEPS].reverse().find((step) => step.at === state.killerSpree);
  if (spree) beats.push(spree.kind);
  if (state.multi === 2) beats.push('double_kill');
  else if (state.multi === 3) beats.push('triple_kill');
  else if (state.multi >= 4) beats.push('quad_kill');
  if (state.killerScore === DUEL_SCORE_LIMIT - 1) beats.push('match_point');
  return beats;
}

export const DUEL_MIN_PLAYERS = 2;
export const DUEL_CAPACITY = 4;
export const DUEL_COUNTDOWN_MS = 3_000;
export const DUEL_ARENA_LOAD_TIMEOUT_MS = 30_000;
export const DUEL_ROUND_MS = 5 * 60_000;
export const DUEL_RESPAWN_MS = 3_000;
export const DUEL_SPAWN_SHIELD_MS = 1_250;
// The results screen plays a rank-reveal animation before the vote buttons are
// worth reading. Fifteen seconds meant the window could close while the RP was
// still counting up, so "Run it back" regularly expired unanswered.
export const DUEL_REMATCH_MS = 30_000;
export const DUEL_ARENA_BASE_X = 12_288;
export const DUEL_ARENA_SLOT_SPACING = 512;
export const DUEL_ARENA_SIZE = 44;
export const DUEL_ARENA_INTERIOR = 40;
export const DUEL_ARENA_FLOOR_Y = 96;
/** Rows of colosseum wall above the floor before the invisible barrier takes
 * over. The interior itself stays open to the sky. */
export const DUEL_WALL_ROWS = 11;
/** The arena is open to the sky. The numeric ceiling is only the world limit. */
export const DUEL_ARENA_HEIGHT = 256 - DUEL_ARENA_FLOOR_Y;
export const DUEL_MIN_LIGHT = 12;
export const DUEL_MAX_HEALTH = 40;
export const DUEL_MAX_PILLAR_HEIGHT = 7;

// ── The Prism Colosseum ────────────────────────────────────────────────────
// The arena is hand-sculpted rather than noise-generated, and every feature is
// stamped with four-fold rotational symmetry so all four spawn corners are
// exactly equivalent. It is authored once into a heightmap + a role map: the
// heightmap is the single source of truth for solidity, build limits, spawn
// heights and pathing on both the client and the server, and the role map only
// decides which block is stamped where.

/** What a column is, which decides its palette (never its collision). */
const enum DuelCell {
  Field, Inlay, Step, Dais, Rim, Obelisk,
  PadA, PadB, PadC, PadD,
  BeaconA, BeaconB, BeaconC, BeaconD,
  Bunker, Pylon,
}

interface DuelArenaMap { height: Uint8Array; role: Uint8Array }

let arenaMapCache: DuelArenaMap | null = null;

/** Deterministic sculpt of the 40x40 interior. Built once, then shared. */
function buildDuelArenaMap(): DuelArenaMap {
  const n = DUEL_ARENA_INTERIOR;
  const height = new Uint8Array(n * n);
  const role = new Uint8Array(n * n).fill(DuelCell.Field);
  const at = (x: number, z: number) => z * n + x;
  const inside = (x: number, z: number) => x >= 0 && x < n && z >= 0 && z < n;

  /** Stamp a cell and its three 90-degree rotations about the arena centre.
   * The four rotations of a corner feature land on the four spawn corners,
   * which is what makes the map provably fair. */
  const stamp = (x: number, z: number, h: number, cell: DuelCell, rotateRole = true) => {
    let px = x, pz = z;
    for (let turn = 0; turn < 4; turn++) {
      if (inside(px, pz)) {
        const i = at(px, pz);
        height[i] = h;
        // Corner-coded features advance their palette with the rotation so the
        // four spawns read as four different colours at a glance.
        role[i] = rotateRole ? cell + turn : cell;
      }
      const nx = n - 1 - pz, nz = px;
      px = nx; pz = nz;
    }
  };

  const centre = (n - 1) / 2;

  // 1. The central ziggurat: a three-step dais crowned with a glowing rim.
  //    Every step is exactly one block, so it is climbable from any bearing.
  for (let z = 0; z < n; z++) for (let x = 0; x < n; x++) {
    const rad = Math.hypot(x - centre, z - centre);
    const i = at(x, z);
    if (rad <= 4.2) { height[i] = 3; role[i] = DuelCell.Dais; }
    else if (rad <= 5.4) { height[i] = 3; role[i] = DuelCell.Rim; }
    else if (rad <= 7.0) { height[i] = 2; role[i] = DuelCell.Step; }
    else if (rad <= 8.6) { height[i] = 1; role[i] = DuelCell.Step; }
    else {
      // Decorative floor inlay: diagonal approach lanes and an outer ring.
      const ax = Math.abs(x - centre), az = Math.abs(z - centre);
      const onDiagonal = Math.abs(ax - az) <= 1.2;
      const onRing = Math.abs(rad - 13.5) <= 0.7;
      role[i] = onDiagonal || onRing ? DuelCell.Inlay : DuelCell.Field;
    }
  }

  // 2. The Altar: a 2x2 pedestal one block above the crown. Standing on it is
  //    the highest natural ground in the arena, and four ivory spires around
  //    it break the centre into a fight you circle instead of one long lane.
  for (const [x, z] of [[19, 19], [20, 19], [19, 20], [20, 20]]) {
    const i = at(x, z); height[i] = 4; role[i] = DuelCell.Obelisk;
  }
  stamp(16, 16, 6, DuelCell.Pylon, false);

  // 3. Four colour-coded spawn platforms, one per corner.
  for (let dz = -3; dz <= 3; dz++) for (let dx = -3; dx <= 3; dx++) {
    const reach = Math.max(Math.abs(dx), Math.abs(dz));
    stamp(8 + dx, 8 + dz, reach <= 2 ? 2 : 1, DuelCell.PadA);
  }
  // A beacon spire on the outer corner of each pad: a landmark you can find
  // from anywhere in the arena, and hard cover the moment you respawn.
  stamp(6, 6, 6, DuelCell.BeaconA);

  // 4. Mid-edge bunkers: a grate wall with a central doorway, plus a low
  //    step in front of it to slide behind.
  for (let x = 14; x <= 25; x++) {
    if (x === 19 || x === 20) continue;
    stamp(x, 6, 3, DuelCell.Bunker, false);
    stamp(x, 5, 1, DuelCell.Bunker, false);
  }

  // 5. Cover pylons: on each spawn-to-centre diagonal, and flanking each of
  //    the four dais approaches.
  for (const [dx, dz] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
    stamp(13 + dx, 13 + dz, 4, DuelCell.Pylon, false);
  }
  stamp(19, 11, 3, DuelCell.Pylon, false);
  stamp(20, 11, 3, DuelCell.Pylon, false);

  return { height, role };
}

function duelArenaMap(): DuelArenaMap {
  return (arenaMapCache ??= buildDuelArenaMap());
}

/** Height of the sculpted column at an interior cell: the surface sits at
 * `floor + duelTerrainElevation(lx, lz)`. Everything from the floor up to and
 * including that block is solid. */
export function duelTerrainElevation(lx: number, lz: number): number {
  const x = Math.floor(lx), z = Math.floor(lz);
  if (x < 0 || x >= DUEL_ARENA_INTERIOR || z < 0 || z >= DUEL_ARENA_INTERIOR) return 0;
  return duelArenaMap().height[z * DUEL_ARENA_INTERIOR + x];
}

/** Tallest sculpted column in the arena, used to bound pathing/mesh scans. */
export const DUEL_MAX_ELEVATION = 6;

interface DuelPalette { top: number; body: number }

const DUEL_PALETTES: Record<number, DuelPalette> = {
  [DuelCell.Field]: { top: Block.SpectralMarble, body: Block.CarvedVaultBrick },
  [DuelCell.Inlay]: { top: Block.PearlTile, body: Block.CarvedVaultBrick },
  [DuelCell.Step]: { top: Block.LuminousLimestone, body: Block.LuminousLimestone },
  [DuelCell.Dais]: { top: Block.VaultMosaic, body: Block.LuminousLimestone },
  [DuelCell.Rim]: { top: Block.RuneGlass, body: Block.LuminousLimestone },
  [DuelCell.Obelisk]: { top: Block.RuneGlass, body: Block.IvoryColumn },
  [DuelCell.PadA]: { top: Block.EmberBrick, body: Block.EmberBrick },
  [DuelCell.PadB]: { top: Block.PrismBrick, body: Block.PrismBrick },
  [DuelCell.PadC]: { top: Block.GildedVaultBrick, body: Block.GildedVaultBrick },
  [DuelCell.PadD]: { top: Block.CarvedVaultBrick, body: Block.CarvedVaultBrick },
  [DuelCell.BeaconA]: { top: Block.EmberBrazier, body: Block.EmberBrick },
  [DuelCell.BeaconB]: { top: Block.PrismLamp, body: Block.PrismBrick },
  [DuelCell.BeaconC]: { top: Block.GildedLamp, body: Block.GildedVaultBrick },
  [DuelCell.BeaconD]: { top: Block.SoulLantern, body: Block.CarvedVaultBrick },
  [DuelCell.Bunker]: { top: Block.ClockworkGrate, body: Block.ClockworkGrate },
  [DuelCell.Pylon]: { top: Block.RuneGlass, body: Block.OpalBrick },
};

export interface DuelVec3 { x: number; y: number; z: number }

export interface DuelParticipant {
  id: number;
  username: string;
  skin: number;
  profile: DuelPublicProfile;
  host: boolean;
  ready: boolean;
  connected: boolean;
  kills: number;
  deaths: number;
  alive: boolean;
  spectating: boolean;
  rematchVote: boolean;
  /** Stable lobby order, used as the final scoreboard tie-break. */
  joinOrder: number;
  respawnAt?: number;
  shieldUntil?: number;
  /** Kills since last death; the number the announcer shouts about. */
  spree: number;
  /** Best spree this round, kept on the final scoreboard. */
  bestSpree: number;
  /** Kills inside the live multi-kill window, and when it closes. */
  multi: number;
  multiUntil: number;
  /** Who killed this player last, so a payback reads as Revenge. */
  lastKilledBy: number;
}

export interface DuelArenaBounds {
  slot: number;
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
  spawns: DuelVec3[];
}

export interface DuelResult {
  winner: number | null;
  scoreboard: DuelParticipant[];
  /** Everything the announcer called this round, for the result recap. */
  feed: DuelEvent[];
  finishReason: DuelFinishReason;
  durationMs: number;
  rematchDeadline: number;
  progressChanges: DuelProgressChange[];
}

export interface DuelLobbySnapshot {
  /** Public display id. Invite tokens are never included in snapshots/logs. */
  id: string;
  phase: DuelPhase;
  capacity: number;
  participants: DuelParticipant[];
  host: number;
  serverNow: number;
  countdownEndsAt?: number;
  arenaLoadDeadline?: number;
  startedAt?: number;
  endsAt?: number;
  arena?: DuelArenaBounds;
  arenaReady?: Set<number>;
  /** Announcer beats, oldest first. Clients replay anything above the last
   * `seq` they have seen, so a dropped frame never loses a call. */
  feed: DuelEvent[];
  result?: DuelResult;
}

export type DuelJoinFailure = 'invalid' | 'full' | 'match_in_progress' | 'already_in_lobby';
export type DuelStartFailure = 'not_host' | 'too_few_players' | 'too_many_players' | 'not_everyone_ready' | 'not_in_lobby';

export function duelArenaBounds(slot: number): DuelArenaBounds {
  const safeSlot = Math.max(0, Math.floor(slot));
  const originX = DUEL_ARENA_BASE_X + safeSlot * DUEL_ARENA_SLOT_SPACING;
  const originZ = 0;
  const minX = originX + 2;
  const minZ = originZ + 2;
  const maxX = minX + DUEL_ARENA_INTERIOR;
  const maxZ = minZ + DUEL_ARENA_INTERIOR;
  const floor = DUEL_ARENA_FLOOR_Y;
  const ceiling = floor + DUEL_ARENA_HEIGHT;
  // The four spawn platforms are the four rotations of one authored corner, so
  // every seat in the arena is geometrically identical.
  const insets: [number, number][] = [
    [8, 8],
    [DUEL_ARENA_INTERIOR - 9, 8],
    [DUEL_ARENA_INTERIOR - 9, DUEL_ARENA_INTERIOR - 9],
    [8, DUEL_ARENA_INTERIOR - 9],
  ];
  return {
    slot: safeSlot, originX, originZ, minX, maxX, minY: floor + 1,
    maxY: ceiling - 1, minZ, maxZ, floor, ceiling,
    spawns: insets.map(([lx, lz]) => ({
      x: minX + lx + 0.5,
      y: floor + duelTerrainElevation(lx, lz) + 1.01,
      z: minZ + lz + 0.5,
    })),
  };
}

/** Resolve the deterministic arena slot whose footprint contains a
 * world column. Normal world columns return null. */
export function duelArenaAt(x: number, z: number): DuelArenaBounds | null {
  if (!Number.isFinite(x) || !Number.isFinite(z) || x < DUEL_ARENA_BASE_X ||
      z < 0 || z >= DUEL_ARENA_SIZE) return null;
  const slot = Math.floor((x - DUEL_ARENA_BASE_X) / DUEL_ARENA_SLOT_SPACING);
  const arena = duelArenaBounds(slot);
  return x >= arena.originX && x < arena.originX + DUEL_ARENA_SIZE ? arena : null;
}

/** One row of the colosseum wall. Ivory pilasters every five blocks carry two
 * bands of glowing rune glass; the crenellated top is capped with lamps and
 * open (invisible-barrier) embrasures between them. */
function duelWallBlock(outerLx: number, by: number, outerLz: number, floor: number): number {
  const relY = by - floor;
  const isCorner = (outerLx <= 1 || outerLx >= DUEL_ARENA_SIZE - 2) &&
    (outerLz <= 1 || outerLz >= DUEL_ARENA_SIZE - 2);
  const edge = outerLx < 2 || outerLx >= DUEL_ARENA_SIZE - 2 ? outerLz : outerLx;
  const isPillar = isCorner || edge % 5 === 0;

  switch (relY) {
    case 0: return Block.CarvedVaultBrick;                         // plinth
    case 1: case 2: return isPillar ? Block.IvoryColumn : Block.SpectralMarble;
    case 3: return isPillar ? Block.IvoryColumn : Block.RuneGlass;  // lower glow band
    case 4: return isPillar ? Block.IvoryColumn : Block.PearlTile;
    case 5: return isPillar ? Block.IvoryColumn : Block.LuminousLimestone;
    case 6: return isPillar ? Block.IvoryColumn : Block.PearlTile;
    case 7: return isPillar ? Block.IvoryColumn : Block.RuneGlass;  // upper glow band
    case 8: return isPillar ? Block.IvoryColumn : Block.SpectralMarble;
    case 9: return Block.LuminousLimestone;                         // cornice
    case 10:
      // Crenellations. The embrasures between the merlons are sealed with the
      // invisible Barrier, so the silhouette reads open without being open.
      if (isCorner) return Block.PrismLamp;
      if (isPillar) return Block.GildedLamp;
      return (edge & 1) === 0 ? Block.VaultMosaic : Block.Barrier;
    default: return Block.Barrier;
  }
}

/** Material stamp corresponding exactly to duelArenaSolidAt. This is called by
 * Terrain.fill on both client and server; no arena cell enters the edit log. */
export function duelArenaBlockAt(x: number, y: number, z: number): number | null {
  const arena = duelArenaAt(x, z);
  if (!arena) return null;
  const bx = Math.floor(x), by = Math.floor(y), bz = Math.floor(z);
  const inShellY = by >= arena.floor - 1 && by < arena.ceiling;
  if (!inShellY) return null;

  const lx = bx - arena.minX, lz = bz - arena.minZ;
  const outerLx = bx - arena.originX, outerLz = bz - arena.originZ;
  const boundary = outerLx < 2 || outerLx >= DUEL_ARENA_SIZE - 2 || outerLz < 2 || outerLz >= DUEL_ARENA_SIZE - 2;

  // Underside foundation
  if (by === arena.floor - 1) return Block.CarvedVaultBrick;

  // The colosseum wall, topped by an invisible barrier column that reaches the
  // world limit. The interior deliberately remains open sky.
  if (boundary) {
    if (by < arena.floor + DUEL_WALL_ROWS) return duelWallBlock(outerLx, by, outerLz, arena.floor);
    return Block.Barrier;
  }

  // The sculpted 40x40 interior: one palette per column role, stamped from the
  // same heightmap that drives collision, pathing and build limits.
  if (lx >= 0 && lx < DUEL_ARENA_INTERIOR && lz >= 0 && lz < DUEL_ARENA_INTERIOR) {
    const map = duelArenaMap();
    const cell = lz * DUEL_ARENA_INTERIOR + lx;
    const groundY = arena.floor + map.height[cell];
    if (by > groundY) return Block.Air;
    const palette = DUEL_PALETTES[map.role[cell]] ?? DUEL_PALETTES[DuelCell.Field];
    return by === groundY ? palette.top : palette.body;
  }

  return null;
}

export function clampToDuelArena(p: DuelVec3, arena: DuelArenaBounds): DuelVec3 {
  return {
    x: Math.max(arena.minX + 0.15, Math.min(arena.maxX - 0.15, p.x)),
    // `y` is the feet position; keep the full body inside the world's vertical
    // range. The arena itself has no horizontal roof.
    y: Math.max(arena.minY, Math.min(arena.maxY - 0.85, p.y)),
    z: Math.max(arena.minZ + 0.15, Math.min(arena.maxZ - 0.15, p.z)),
  };
}

/** Arena shell/cover occupancy. 40x40 terrain with world-height perimeter barriers. */
export function duelArenaSolidAt(x: number, y: number, z: number, arena: DuelArenaBounds): boolean {
  const bx = Math.floor(x), by = Math.floor(y), bz = Math.floor(z);
  const outerMinX = arena.originX, outerMaxX = arena.originX + DUEL_ARENA_SIZE - 1;
  const outerMinZ = arena.originZ, outerMaxZ = arena.originZ + DUEL_ARENA_SIZE - 1;
  if (bx < outerMinX || bx > outerMaxX || bz < outerMinZ || bz > outerMaxZ) return false;
  if (by < arena.floor - 1 || by >= arena.ceiling) return false;
  if (by === arena.floor - 1) return true;

  // Boundary walls and barrier columns
  if (bx < arena.minX || bx >= arena.maxX || bz < arena.minZ || bz >= arena.maxZ) return true;

  const lx = bx - arena.minX, lz = bz - arena.minZ;
  const groundY = arena.floor + duelTerrainElevation(lx, lz);
  if (by <= groundY) return true;

  return false;
}

/** Arena-only ambient floor. Fixture gradients can add to this in rendering,
 * but no walkable point can fall below the competitive visibility standard. */
export function duelArenaLightAt(_x: number, _y: number, _z: number, _arena: DuelArenaBounds): number {
  return DUEL_MIN_LIGHT;
}

export function hasArenaLineOfSight(
  a: DuelVec3, b: DuelVec3, arena: DuelArenaBounds,
  isSolidExtra?: (x: number, y: number, z: number) => boolean
): boolean {
  const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
  const distance = Math.hypot(dx, dy, dz);
  const steps = Math.max(1, Math.ceil(distance * 4));
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const px = a.x + dx * t, py = a.y + dy * t, pz = a.z + dz * t;
    if (duelArenaSolidAt(px, py, pz, arena) || isSolidExtra?.(px, py, pz)) return false;
  }
  return true;
}

export function orderDuelScore(a: DuelParticipant, b: DuelParticipant): number {
  return b.kills - a.kills || a.deaths - b.deaths || a.joinOrder - b.joinOrder;
}

export function orderedDuelScoreboard(players: Iterable<DuelParticipant>): DuelParticipant[] {
  return [...players].map((p) => ({ ...p })).sort(orderDuelScore);
}

export function safestDuelSpawn(
  arena: DuelArenaBounds,
  opponents: DuelVec3[],
  previousIndex = -1,
): number {
  let best = 0, bestVisible = Infinity, bestDistance = -Infinity;
  for (let i = 0; i < arena.spawns.length; i++) {
    const spawn = arena.spawns[i];
    const visible = opponents.filter((p) => hasArenaLineOfSight(
      { x: spawn.x, y: spawn.y + 1.3, z: spawn.z }, { x: p.x, y: p.y + 1.3, z: p.z }, arena,
    )).length;
    const nearest = opponents.length
      ? Math.min(...opponents.map((p) => Math.hypot(p.x - spawn.x, p.z - spawn.z)))
      : Infinity;
    const repeatPenalty = i === previousIndex ? 8 : 0;
    if (visible < bestVisible || (visible === bestVisible && nearest - repeatPenalty > bestDistance)) {
      best = i; bestVisible = visible; bestDistance = nearest - repeatPenalty;
    }
  }
  return best;
}

interface DuelLobby {
  id: string;
  token: string;
  phase: DuelPhase;
  participants: Map<number, DuelParticipant>;
  host: number;
  nextJoinOrder: number;
  countdownEndsAt?: number;
  arenaLoadDeadline?: number;
  arenaReady?: Set<number>;
  startedAt?: number;
  endsAt?: number;
  arena?: DuelArenaBounds;
  feed: DuelEvent[];
  nextEventSeq: number;
  firstBloodTaken: boolean;
  result?: DuelResult;
}

export interface DuelIdentity { id: number; username: string; skin: number; profile?: DuelPublicProfile }

export interface DuelCreateResult { token: string; snapshot: DuelLobbySnapshot }
export type DuelJoinResult =
  | { ok: true; snapshot: DuelLobbySnapshot }
  | { ok: false; reason: DuelJoinFailure };

/** Deep-link helpers stay pure/testable so auth UI transitions cannot
 * accidentally discard unrelated query parameters or fragments. */
export function duelTokenFromUrl(href: string): string {
  try { return new URL(href).searchParams.get('duel')?.trim() ?? ''; }
  catch { return ''; }
}

export function withDuelToken(href: string, token: string | null): string {
  const url = new URL(href);
  if (token) url.searchParams.set('duel', token);
  else url.searchParams.delete('duel');
  return url.toString();
}

/** 192 bits of browser/Node WebCrypto entropy, encoded without punctuation so
 * invite links remain portable. There is intentionally no Math.random fallback. */
export function secureDuelToken(): string {
  const bytes = new Uint8Array(24);
  const cryptoApi = globalThis.crypto;
  if (!cryptoApi?.getRandomValues) throw new Error('Secure random source unavailable');
  cryptoApi.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export class Duels {
  private readonly lobbies = new Map<string, DuelLobby>();
  private readonly lobbyByPlayer = new Map<number, DuelLobby>();
  private readonly usedSlots = new Set<number>();
  private nextLobbyId = 1;

  constructor(private readonly tokenFactory: () => string) {}

  create(identity: DuelIdentity, now: number): DuelCreateResult | { reason: 'already_in_lobby' } {
    if (this.lobbyByPlayer.has(identity.id)) return { reason: 'already_in_lobby' };
    let token = '';
    do token = this.tokenFactory(); while (!token || token.length < 24 || this.lobbies.has(token));
    const p = this.newParticipant(identity, true, 0);
    const lobby: DuelLobby = {
      id: `D${this.nextLobbyId++}`, token, phase: 'lobby', participants: new Map([[p.id, p]]),
      host: p.id, nextJoinOrder: 1, feed: [], nextEventSeq: 1, firstBloodTaken: false,
    };
    this.lobbies.set(token, lobby);
    this.lobbyByPlayer.set(p.id, lobby);
    return { token, snapshot: this.snapshotLobby(lobby, now) };
  }

  join(token: string, identity: DuelIdentity, now: number): DuelJoinResult {
    if (this.lobbyByPlayer.has(identity.id)) return { ok: false, reason: 'already_in_lobby' };
    const lobby = this.lobbies.get(token);
    if (!lobby) return { ok: false, reason: 'invalid' };
    if (lobby.phase !== 'lobby') return { ok: false, reason: 'match_in_progress' };
    if (lobby.participants.size >= DUEL_CAPACITY) return { ok: false, reason: 'full' };
    this.resetReady(lobby);
    const p = this.newParticipant(identity, false, lobby.nextJoinOrder++);
    lobby.participants.set(p.id, p);
    this.lobbyByPlayer.set(p.id, lobby);
    return { ok: true, snapshot: this.snapshotLobby(lobby, now) };
  }

  leave(playerId: number, now: number): { snapshot?: DuelLobbySnapshot; deleted: boolean; token?: string } {
    const lobby = this.lobbyByPlayer.get(playerId);
    if (!lobby) return { deleted: false };
    const live = lobby.phase === 'running' || lobby.phase === 'sudden_death';
    const leaving = lobby.participants.get(playerId);
    this.lobbyByPlayer.delete(playerId);
    if (live && leaving) {
      // Keep a disconnected combatant on the final board so forfeiting cannot
      // dodge a rated loss. They are removed when the room returns to lobby.
      leaving.connected = false; leaving.alive = false; leaving.spectating = true;
      leaving.respawnAt = undefined;
    } else {
      lobby.participants.delete(playerId);
    }
    lobby.arenaReady?.delete(playerId);
    if (![...lobby.participants.values()].some(p => p.connected)) {
      this.releaseArena(lobby);
      this.lobbies.delete(lobby.token);
      return { deleted: true, token: lobby.token };
    }
    if (lobby.host === playerId) {
      const next = [...lobby.participants.values()].filter((p) => p.connected)
        .sort((a, b) => a.joinOrder - b.joinOrder)[0];
      if (!next) return { snapshot: this.snapshotLobby(lobby, now), deleted: false };
      lobby.host = next.id;
      for (const p of lobby.participants.values()) p.host = p.id === next.id;
    }
    if (lobby.phase === 'lobby') this.resetReady(lobby);
    else if (lobby.phase === 'running' || lobby.phase === 'sudden_death' || lobby.phase === 'countdown') {
      const connected = [...lobby.participants.values()].filter((p) => p.connected);
      if (connected.length === 1) this.finish(lobby, now, connected[0].id, 'forfeit');
      else this.tryArmCountdown(lobby, now);
    } else if (lobby.phase === 'results') {
      this.returnToLobby(lobby);
    }
    return { snapshot: this.snapshotLobby(lobby, now), deleted: false };
  }

  setReady(playerId: number, ready: boolean, now: number): DuelLobbySnapshot | null {
    const lobby = this.lobbyByPlayer.get(playerId);
    const p = lobby?.participants.get(playerId);
    if (!lobby || !p || lobby.phase !== 'lobby') return null;
    p.ready = ready;
    return this.snapshotLobby(lobby, now);
  }

  start(playerId: number, now: number): { ok: true; snapshot: DuelLobbySnapshot } | { ok: false; reason: DuelStartFailure } {
    const lobby = this.lobbyByPlayer.get(playerId);
    if (!lobby || lobby.phase !== 'lobby') return { ok: false, reason: 'not_in_lobby' };
    if (lobby.host !== playerId) return { ok: false, reason: 'not_host' };
    if (lobby.participants.size < DUEL_MIN_PLAYERS) return { ok: false, reason: 'too_few_players' };
    if (lobby.participants.size > DUEL_CAPACITY) return { ok: false, reason: 'too_many_players' };
    if ([...lobby.participants.values()].some((p) => !p.connected || !p.ready)) {
      return { ok: false, reason: 'not_everyone_ready' };
    }
    this.beginCountdown(lobby, now);
    return { ok: true, snapshot: this.snapshotLobby(lobby, now) };
  }

  /** Mark one client's deterministic arena stream complete. The visible
   * three-second countdown is armed only after every current member is ready. */
  markArenaReady(playerId: number, now: number): DuelLobbySnapshot | null {
    const lobby = this.lobbyByPlayer.get(playerId);
    if (!lobby || lobby.phase !== 'countdown' || lobby.countdownEndsAt !== undefined) return null;
    lobby.arenaReady?.add(playerId);
    this.tryArmCountdown(lobby, now);
    return this.snapshotLobby(lobby, now);
  }

  recordDeath(victimId: number, killerId: number, now: number): DuelLobbySnapshot | null {
    const lobby = this.lobbyByPlayer.get(victimId);
    if (!lobby || (lobby.phase !== 'running' && lobby.phase !== 'sudden_death')) return null;
    const victim = lobby.participants.get(victimId), killer = lobby.participants.get(killerId);
    if (!victim || !killer || victim.id === killer.id || !victim.alive || !killer.alive) return null;
    victim.deaths++;
    killer.kills++;
    victim.alive = false;
    victim.spectating = true;
    victim.respawnAt = now + DUEL_RESPAWN_MS;
    victim.shieldUntil = undefined;

    // Announcer bookkeeping. All of it lives on the authoritative participant
    // records, so a reconnecting client inherits the same streak state.
    killer.multi = now < killer.multiUntil ? killer.multi + 1 : 1;
    killer.multiUntil = now + DUEL_MULTI_KILL_MS;
    killer.spree++;
    killer.bestSpree = Math.max(killer.bestSpree, killer.spree);
    const victimSpree = victim.spree;
    victim.spree = 0; victim.multi = 0; victim.multiUntil = 0;
    const revenge = victim.lastKilledBy === killer.id && killer.lastKilledBy === victim.id;
    victim.lastKilledBy = killer.id;
    const firstKillOfMatch = !lobby.firstBloodTaken;
    lobby.firstBloodTaken = true;
    for (const kind of duelKillEvents({
      firstKillOfMatch, killerSpree: killer.spree, victimSpree,
      multi: killer.multi, revenge, killerScore: killer.kills,
    })) {
      lobby.feed.push({ seq: lobby.nextEventSeq++, kind, actor: killer.id,
        actorName: killer.username, victim: victim.id, victimName: victim.username,
        count: kind === 'double_kill' || kind === 'triple_kill' || kind === 'quad_kill'
          ? killer.multi : killer.spree,
        at: now });
    }
    if (lobby.feed.length > DUEL_FEED_LENGTH) lobby.feed.splice(0, lobby.feed.length - DUEL_FEED_LENGTH);

    if (lobby.phase === 'sudden_death') this.finish(lobby, now, killer.id, 'sudden_death');
    else if (killer.kills >= DUEL_SCORE_LIMIT) this.finish(lobby, now, killer.id, 'score');
    return this.snapshotLobby(lobby, now);
  }

  removeSpawnShield(playerId: number): void {
    const p = this.lobbyByPlayer.get(playerId)?.participants.get(playerId);
    if (p) p.shieldUntil = undefined;
  }

  voteRematch(playerId: number, vote: boolean, now: number): DuelLobbySnapshot | null {
    const lobby = this.lobbyByPlayer.get(playerId), p = lobby?.participants.get(playerId);
    if (!lobby || !p || lobby.phase !== 'results') return null;
    if (!vote) {
      this.returnToLobby(lobby);
      return this.snapshotLobby(lobby, now);
    }
    p.rematchVote = true;
    const connected = [...lobby.participants.values()].filter((v) => v.connected);
    if (connected.length >= DUEL_MIN_PLAYERS && connected.every((v) => v.rematchVote)) {
      this.beginCountdown(lobby, now);
    }
    return this.snapshotLobby(lobby, now);
  }

  requestLobby(playerId: number, now: number): DuelLobbySnapshot | null {
    const lobby = this.lobbyByPlayer.get(playerId);
    if (!lobby || lobby.phase !== 'results') return null;
    this.returnToLobby(lobby);
    return this.snapshotLobby(lobby, now);
  }

  tick(now: number): DuelLobbySnapshot[] {
    const changed: DuelLobbySnapshot[] = [];
    for (const lobby of this.lobbies.values()) {
      let dirty = false;
      if (lobby.phase === 'countdown' && lobby.countdownEndsAt === undefined &&
          now >= (lobby.arenaLoadDeadline ?? Infinity)) {
        this.returnToLobby(lobby); dirty = true;
      }
      if (lobby.phase === 'countdown' && now >= (lobby.countdownEndsAt ?? Infinity)) {
        lobby.phase = 'running';
        lobby.startedAt = lobby.countdownEndsAt;
        lobby.endsAt = (lobby.startedAt ?? now) + DUEL_ROUND_MS;
        dirty = true;
      }
      if (lobby.phase === 'running' && now >= (lobby.endsAt ?? Infinity)) {
        const board = orderedDuelScoreboard(lobby.participants.values());
        const leaders = board.filter((p) => p.kills === board[0]?.kills);
        if (leaders.length === 1) this.finish(lobby, now, leaders[0].id, 'time');
        else {
          lobby.phase = 'sudden_death';
          const ids = new Set(leaders.map((p) => p.id));
          for (const p of lobby.participants.values()) {
            if (!ids.has(p.id)) {
              p.spectating = true; p.alive = false; p.respawnAt = undefined;
            }
            // A tied leader already waiting to respawn keeps that timer. Live
            // leaders remain live; neither gets a free state change at 0:00.
          }
        }
        dirty = true;
      }
      if (lobby.phase === 'running' || lobby.phase === 'sudden_death') {
        for (const p of lobby.participants.values()) {
          if (!p.alive && p.respawnAt !== undefined && now >= p.respawnAt) {
            p.alive = true; p.spectating = false; p.respawnAt = undefined;
            p.shieldUntil = now + DUEL_SPAWN_SHIELD_MS; dirty = true;
          }
        }
      }
      if (lobby.phase === 'results' && now >= (lobby.result?.rematchDeadline ?? Infinity)) {
        this.returnToLobby(lobby); dirty = true;
      }
      if (dirty) changed.push(this.snapshotLobby(lobby, now));
    }
    return changed;
  }

  snapshotFor(playerId: number, now: number): DuelLobbySnapshot | null {
    const lobby = this.lobbyByPlayer.get(playerId);
    return lobby ? this.snapshotLobby(lobby, now) : null;
  }

  /** Safe snapshots for server fan-out. Tokens remain private and are never
   * present in this representation. */
  snapshots(now: number): DuelLobbySnapshot[] {
    return [...this.lobbies.values()].map((lobby) => this.snapshotLobby(lobby, now));
  }

  tokenFor(playerId: number): string | null { return this.lobbyByPlayer.get(playerId)?.token ?? null; }
  inviteInfo(token: string): { host: string; lobbyId: string } | null {
    const lobby = this.lobbies.get(token);
    const host = lobby?.participants.get(lobby.host);
    return lobby && host ? { host: host.username, lobbyId: lobby.id } : null;
  }
  arenaFor(playerId: number): DuelArenaBounds | null { return this.lobbyByPlayer.get(playerId)?.arena ?? null; }
  phaseFor(playerId: number): DuelPhase | null { return this.lobbyByPlayer.get(playerId)?.phase ?? null; }
  participantFor(playerId: number): DuelParticipant | null {
    return this.lobbyByPlayer.get(playerId)?.participants.get(playerId) ?? null;
  }
  updateProfile(playerId: number, profile: DuelPublicProfile): void {
    const participant = this.lobbyByPlayer.get(playerId)?.participants.get(playerId);
    if (participant) participant.profile = { ...profile, rank: { ...profile.rank } };
  }
  applyProgression(changes: DuelProgressChange[]): void {
    for (const change of changes) {
      const lobby = this.lobbyByPlayer.get(change.id) ??
        [...this.lobbies.values()].find((value) => value.participants.has(change.id));
      const participant = lobby?.participants.get(change.id);
      if (participant) participant.profile = { ...change.profile, rank: { ...change.profile.rank } };
      if (lobby?.result) {
        lobby.result.progressChanges = changes.map((value) => ({ ...value }));
        const scored = lobby.result.scoreboard.find((value) => value.id === change.id);
        if (scored) scored.profile = { ...change.profile, rank: { ...change.profile.rank } };
      }
    }
  }
  membersOf(playerId: number): number[] {
    return [...(this.lobbyByPlayer.get(playerId)?.participants.values() ?? [])].filter(p=>p.connected).map(p=>p.id);
  }
  sameMatch(a: number, b: number): boolean {
    const lobby = this.lobbyByPlayer.get(a);
    return !!lobby && lobby === this.lobbyByPlayer.get(b) &&
      (lobby.phase === 'running' || lobby.phase === 'sudden_death');
  }

  private newParticipant(identity: DuelIdentity, host: boolean, joinOrder: number): DuelParticipant {
    const profile = identity.profile ?? duelProfileOf(sanitizeDuelProgress(newDuelProgress()));
    return { ...identity, profile: { ...profile, rank: { ...profile.rank } }, host, ready: false, connected: true, kills: 0, deaths: 0,
      alive: true, spectating: false, rematchVote: false, joinOrder,
      spree: 0, bestSpree: 0, multi: 0, multiUntil: 0, lastKilledBy: 0 };
  }

  private resetReady(lobby: DuelLobby): void {
    for (const p of lobby.participants.values()) p.ready = false;
  }

  private allocateSlot(): number {
    let slot = 0;
    while (this.usedSlots.has(slot)) slot++;
    this.usedSlots.add(slot);
    return slot;
  }

  private releaseArena(lobby: DuelLobby): void {
    if (lobby.arena) this.usedSlots.delete(lobby.arena.slot);
    lobby.arena = undefined;
  }

  private beginCountdown(lobby: DuelLobby, now: number): void {
    if (!lobby.arena) lobby.arena = duelArenaBounds(this.allocateSlot());
    lobby.phase = 'countdown'; lobby.countdownEndsAt = undefined;
    lobby.arenaReady = new Set();
    lobby.arenaLoadDeadline = now + DUEL_ARENA_LOAD_TIMEOUT_MS;
    lobby.startedAt = undefined; lobby.endsAt = undefined; lobby.result = undefined;
    lobby.feed = []; lobby.firstBloodTaken = false;
    for (const p of lobby.participants.values()) {
      p.kills = 0; p.deaths = 0; p.alive = true; p.spectating = false;
      p.rematchVote = false; p.respawnAt = undefined; p.shieldUntil = undefined;
      p.spree = 0; p.bestSpree = 0; p.multi = 0; p.multiUntil = 0; p.lastKilledBy = 0;
    }
  }

  private tryArmCountdown(lobby: DuelLobby, now: number): void {
    if (lobby.phase !== 'countdown' || lobby.countdownEndsAt !== undefined ||
        !lobby.arenaReady || lobby.participants.size < DUEL_MIN_PLAYERS) return;
    if ([...lobby.participants.keys()].some((id) => !lobby.arenaReady!.has(id))) return;
    lobby.countdownEndsAt = now + DUEL_COUNTDOWN_MS;
    lobby.arenaLoadDeadline = undefined;
    for (const p of lobby.participants.values()) p.shieldUntil = lobby.countdownEndsAt;
  }

  private finish(lobby: DuelLobby, now: number, winner: number | null, reason: DuelFinishReason): void {
    lobby.phase = 'results';
    for (const p of lobby.participants.values()) { p.alive = false; p.spectating = true; p.rematchVote = false; }
    const scoreboard = orderedDuelScoreboard(lobby.participants.values());
    // Every disconnect is a forfeit placement even if the remaining players
    // continue to regulation time. The combatant stays visible on the board,
    // but can never preserve a high-kill finish by leaving early.
    scoreboard.sort((a, b) => Number(b.connected) - Number(a.connected) || orderDuelScore(a, b));
    if (winner !== null) {
      const winnerIndex = scoreboard.findIndex((p) => p.id === winner);
      if (winnerIndex > 0) scoreboard.unshift(scoreboard.splice(winnerIndex, 1)[0]);
    }
    lobby.result = { winner, scoreboard, feed: lobby.feed.map((event) => ({ ...event })),
      finishReason: reason, durationMs: Math.max(0, now - (lobby.startedAt ?? now)),
      rematchDeadline: now + DUEL_REMATCH_MS,
      progressChanges: [] };
  }

  private returnToLobby(lobby: DuelLobby): void {
    lobby.phase = 'lobby'; lobby.countdownEndsAt = undefined; lobby.startedAt = undefined;
    lobby.endsAt = undefined; lobby.arenaReady = undefined; lobby.arenaLoadDeadline = undefined;
    lobby.result = undefined; this.releaseArena(lobby);
    for (const [id, participant] of lobby.participants) {
      if (!participant.connected) lobby.participants.delete(id);
    }
    lobby.feed = []; lobby.firstBloodTaken = false;
    for (const p of lobby.participants.values()) {
      p.ready = false; p.kills = 0; p.deaths = 0; p.alive = true; p.spectating = false;
      p.rematchVote = false; p.respawnAt = undefined; p.shieldUntil = undefined;
      p.spree = 0; p.bestSpree = 0; p.multi = 0; p.multiUntil = 0; p.lastKilledBy = 0;
    }
  }

  private snapshotLobby(lobby: DuelLobby, now: number): DuelLobbySnapshot {
    return { id: lobby.id, phase: lobby.phase, capacity: DUEL_CAPACITY,
      participants: orderedDuelScoreboard(lobby.participants.values()), host: lobby.host,
      serverNow: now, feed: lobby.feed.map((event) => ({ ...event })),
      countdownEndsAt: lobby.countdownEndsAt, startedAt: lobby.startedAt,
      endsAt: lobby.endsAt, arena: lobby.arena ? { ...lobby.arena, spawns: lobby.arena.spawns.map((s) => ({ ...s })) } : undefined,
      result: lobby.result ? { ...lobby.result,
        feed: lobby.result.feed.map((event) => ({ ...event })),
        scoreboard: lobby.result.scoreboard.map((p) => ({ ...p, profile: { ...p.profile, rank: { ...p.profile.rank } } })),
        progressChanges: lobby.result.progressChanges.map((change) => ({ ...change })) } : undefined };
  }
}
