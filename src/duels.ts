// Pure, shared Duels domain model. This file deliberately has no DOM or Node
// dependencies so the browser, authoritative server, and smoke tests all use
// the same clocks, score ordering, arena geometry, and lobby rules.

import { Block } from './blocks';
import { Noise2D } from './noise';

export type DuelPhase = 'lobby' | 'countdown' | 'running' | 'sudden_death' | 'results';
export type DuelFinishReason = 'time' | 'sudden_death' | 'forfeit' | 'cancelled';

export const DUEL_MIN_PLAYERS = 2;
export const DUEL_CAPACITY = 4;
export const DUEL_COUNTDOWN_MS = 3_000;
export const DUEL_ARENA_LOAD_TIMEOUT_MS = 30_000;
export const DUEL_ROUND_MS = 5 * 60_000;
export const DUEL_RESPAWN_MS = 3_000;
export const DUEL_SPAWN_SHIELD_MS = 1_250;
export const DUEL_REMATCH_MS = 15_000;
export const DUEL_ARENA_BASE_X = 12_288;
export const DUEL_ARENA_SLOT_SPACING = 512;
export const DUEL_ARENA_SIZE = 44;
export const DUEL_ARENA_INTERIOR = 40;
export const DUEL_ARENA_FLOOR_Y = 96;
export const DUEL_ARENA_HEIGHT = 16;
export const DUEL_MIN_LIGHT = 12;
export const DUEL_MAX_HEALTH = 40;
export const DUEL_MAX_PILLAR_HEIGHT = 5;

const duelNoise = new Noise2D(0x4475656c);

/** Deterministic 5-level elevation noise (levels 0..4, representing y = floor + 0..4). */
export function duelTerrainElevation(lx: number, lz: number): number {
  if (lx < 0 || lx >= DUEL_ARENA_INTERIOR || lz < 0 || lz >= DUEL_ARENA_INTERIOR) return 0;
  const n = duelNoise.fbm(lx * 0.08, lz * 0.08, 2);
  return Math.min(4, Math.max(0, Math.floor((n + 1) * 2.5)));
}

export interface DuelVec3 { x: number; y: number; z: number }

export interface DuelParticipant {
  id: number;
  username: string;
  skin: number;
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
  finishReason: DuelFinishReason;
  durationMs: number;
  rematchDeadline: number;
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
  const insets: [number, number][] = [
    [4, 4],
    [DUEL_ARENA_INTERIOR - 5, 4],
    [DUEL_ARENA_INTERIOR - 5, DUEL_ARENA_INTERIOR - 5],
    [4, DUEL_ARENA_INTERIOR - 5],
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

function duelWallBlock(outerLx: number, by: number, outerLz: number, floor: number): number {
  const relY = by - floor;
  const isCorner = (outerLx <= 1 || outerLx >= DUEL_ARENA_SIZE - 2) && (outerLz <= 1 || outerLz >= DUEL_ARENA_SIZE - 2);
  const isPillar = (outerLx % 4 === 0 || outerLz % 4 === 0);

  if (relY === 8) {
    // Battlements / crenellations
    if (isCorner) return Block.GildedVaultBrick;
    if (isPillar) return Block.CarvedVaultBrick;
    return (outerLx + outerLz) % 2 === 0 ? Block.VaultBrick : Block.CarvedVaultBrick;
  }
  if (relY === 7) {
    if (isCorner) return Block.PrismLamp;
    if (isPillar) return Block.CarvedVaultBrick;
    return Block.VaultBrick;
  }
  if (relY === 6) {
    if (isCorner || isPillar) return Block.CarvedVaultBrick;
    return Block.VaultBrick;
  }
  if (relY === 5) {
    // Mid-height decorative band & lamps
    if (isPillar) return Block.PrismLamp;
    return Block.SpectralMarble;
  }
  if (relY === 4) {
    if (isCorner || isPillar) return Block.CarvedVaultBrick;
    return Block.PearlTile;
  }
  if (relY === 3) {
    if (isCorner || isPillar) return Block.CarvedVaultBrick;
    return Block.VaultMosaic;
  }
  if (relY === 2) {
    if (isCorner || isPillar) return Block.CarvedVaultBrick;
    return Block.PearlTile;
  }
  if (relY === 1) {
    if (isCorner || isPillar) return Block.CarvedVaultBrick;
    return Block.SpectralMarble;
  }
  // Plinth / base (relY <= 0)
  return Block.CarvedVaultBrick;
}

/** Material stamp corresponding exactly to duelArenaSolidAt. This is called by
 * Terrain.fill on both client and server; no arena cell enters the edit log. */
export function duelArenaBlockAt(x: number, y: number, z: number): number | null {
  const arena = duelArenaAt(x, z);
  if (!arena) return null;
  const bx = Math.floor(x), by = Math.floor(y), bz = Math.floor(z);
  const inShellY = by >= arena.floor - 1 && by <= arena.ceiling + 1;
  if (!inShellY) return null;

  const lx = bx - arena.minX, lz = bz - arena.minZ;
  const outerLx = bx - arena.originX, outerLz = bz - arena.originZ;
  const boundary = outerLx < 2 || outerLx >= DUEL_ARENA_SIZE - 2 || outerLz < 2 || outerLz >= DUEL_ARENA_SIZE - 2;

  // Underside foundation
  if (by === arena.floor - 1) return Block.CarvedVaultBrick;

  // Overhead ceiling barriers preventing escape/jumping out
  if (by >= arena.ceiling - 1) return Block.Barrier;

  // Surrounding perimeter walls topped with barriers
  if (boundary) {
    if (by <= arena.floor + 8) return duelWallBlock(outerLx, by, outerLz, arena.floor);
    return Block.Barrier;
  }

  // 40x40 Interior grass terrain with 5 discrete levels of Perlin noise
  if (lx >= 0 && lx < DUEL_ARENA_INTERIOR && lz >= 0 && lz < DUEL_ARENA_INTERIOR) {
    const groundY = arena.floor + duelTerrainElevation(lx, lz);
    if (by === groundY) return Block.Grass;
    if (by < groundY && by >= arena.floor - 3) return Block.Dirt;
    if (by < arena.floor - 3) return Block.Stone;
    return Block.Air;
  }

  return null;
}

export function clampToDuelArena(p: DuelVec3, arena: DuelArenaBounds): DuelVec3 {
  return {
    x: Math.max(arena.minX + 0.15, Math.min(arena.maxX - 0.15, p.x)),
    // `y` is the feet position; keep the full 1.8-block body below the solid
    // ceiling rather than merely keeping the feet inside the numeric bounds.
    y: Math.max(arena.minY, Math.min(arena.maxY - 0.85, p.y)),
    z: Math.max(arena.minZ + 0.15, Math.min(arena.maxZ - 0.15, p.z)),
  };
}

/** Arena shell/cover occupancy. 40x40 5-level terrain with perimeter walls & barrier ceiling. */
export function duelArenaSolidAt(x: number, y: number, z: number, arena: DuelArenaBounds): boolean {
  const bx = Math.floor(x), by = Math.floor(y), bz = Math.floor(z);
  const outerMinX = arena.originX, outerMaxX = arena.originX + DUEL_ARENA_SIZE - 1;
  const outerMinZ = arena.originZ, outerMaxZ = arena.originZ + DUEL_ARENA_SIZE - 1;
  if (bx < outerMinX || bx > outerMaxX || bz < outerMinZ || bz > outerMaxZ) return false;
  if (by < arena.floor - 1 || by > arena.ceiling + 1) return false;
  if (by === arena.floor - 1 || by >= arena.ceiling - 1) return true; // underside and barrier ceiling

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
  result?: DuelResult;
}

export interface DuelIdentity { id: number; username: string; skin: number }

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
      host: p.id, nextJoinOrder: 1,
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
    this.lobbyByPlayer.delete(playerId);
    lobby.participants.delete(playerId);
    lobby.arenaReady?.delete(playerId);
    if (lobby.participants.size === 0) {
      this.releaseArena(lobby);
      this.lobbies.delete(lobby.token);
      return { deleted: true, token: lobby.token };
    }
    if (lobby.host === playerId) {
      const next = [...lobby.participants.values()].sort((a, b) => a.joinOrder - b.joinOrder)[0];
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
    if (lobby.phase === 'sudden_death') this.finish(lobby, now, killer.id, 'sudden_death');
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
  arenaFor(playerId: number): DuelArenaBounds | null { return this.lobbyByPlayer.get(playerId)?.arena ?? null; }
  phaseFor(playerId: number): DuelPhase | null { return this.lobbyByPlayer.get(playerId)?.phase ?? null; }
  participantFor(playerId: number): DuelParticipant | null {
    return this.lobbyByPlayer.get(playerId)?.participants.get(playerId) ?? null;
  }
  membersOf(playerId: number): number[] {
    return [...(this.lobbyByPlayer.get(playerId)?.participants.keys() ?? [])];
  }
  sameMatch(a: number, b: number): boolean {
    const lobby = this.lobbyByPlayer.get(a);
    return !!lobby && lobby === this.lobbyByPlayer.get(b) &&
      (lobby.phase === 'running' || lobby.phase === 'sudden_death');
  }

  private newParticipant(identity: DuelIdentity, host: boolean, joinOrder: number): DuelParticipant {
    return { ...identity, host, ready: false, connected: true, kills: 0, deaths: 0,
      alive: true, spectating: false, rematchVote: false, joinOrder };
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
    for (const p of lobby.participants.values()) {
      p.kills = 0; p.deaths = 0; p.alive = true; p.spectating = false;
      p.rematchVote = false; p.respawnAt = undefined; p.shieldUntil = undefined;
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
    lobby.result = { winner, scoreboard: orderedDuelScoreboard(lobby.participants.values()),
      finishReason: reason, durationMs: Math.max(0, now - (lobby.startedAt ?? now)),
      rematchDeadline: now + DUEL_REMATCH_MS };
  }

  private returnToLobby(lobby: DuelLobby): void {
    lobby.phase = 'lobby'; lobby.countdownEndsAt = undefined; lobby.startedAt = undefined;
    lobby.endsAt = undefined; lobby.arenaReady = undefined; lobby.arenaLoadDeadline = undefined;
    lobby.result = undefined; this.releaseArena(lobby);
    for (const p of lobby.participants.values()) {
      p.ready = false; p.kills = 0; p.deaths = 0; p.alive = true; p.spectating = false;
      p.rematchVote = false; p.respawnAt = undefined; p.shieldUntil = undefined;
    }
  }

  private snapshotLobby(lobby: DuelLobby, now: number): DuelLobbySnapshot {
    return { id: lobby.id, phase: lobby.phase, capacity: DUEL_CAPACITY,
      participants: orderedDuelScoreboard(lobby.participants.values()), host: lobby.host,
      serverNow: now, countdownEndsAt: lobby.countdownEndsAt, startedAt: lobby.startedAt,
      endsAt: lobby.endsAt, arena: lobby.arena ? { ...lobby.arena, spawns: lobby.arena.spawns.map((s) => ({ ...s })) } : undefined,
      result: lobby.result ? { ...lobby.result,
        scoreboard: lobby.result.scoreboard.map((p) => ({ ...p })) } : undefined };
  }
}
