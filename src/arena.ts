// Shared minigame-arena layer. Pure: no DOM, no THREE, no Node.
//
// Every minigame (Duels, Parkour, The Bridge) lives in the SAME coordinate
// space as the open world, stamped far beyond the world border and hidden by a
// render crop. There is no dimension system and none is needed — what isolates
// an arena is (a) its x band being unreachable by ordinary movement, (b) the
// shader crop, and (c) the server dropping every world-facing message from a
// player whose real body is held aside in `arenaSaved`.
//
// This module owns the one thing all three modes must agree on: which x band
// belongs to which mode, and how to stamp a column inside it. `terrain.ts`
// consults the registry instead of hard-coding Duels.

import { DUEL_ARENA_BASE_X, DUEL_ARENA_SLOT_SPACING, DUEL_ARENA_SIZE, duelArenaBlockAt } from './duels';

import {
  PARTY_BASE_X, PARTY_SLOT_SPACING, PARTY_ARENA_SIZE_X, PARTY_ARENA_SIZE_Z,
  PARTY_STAMP_MIN_Y, PARTY_STAMP_MAX_Y, partyArenaBlockAt,
} from './partygames';

export type ArenaKind = 'duel' | 'party';

/** An axis-aligned arena footprint. Half-open on max, like every other bounds
 *  box in the codebase. */
export interface ArenaAABB {
  minX: number; minY: number; minZ: number;
  maxX: number; maxY: number; maxZ: number;
}

/** No arena band starts below this x. Terrain checks it first so the open
 *  world pays a single compare, not a registry walk, per chunk. */
export const ARENA_BAND_MIN_X = DUEL_ARENA_BASE_X; // 12_288

export interface ArenaBand {
  kind: ArenaKind;
  /** x of slot 0's origin. */
  baseX: number;
  /** x stride between consecutive slots. */
  spacing: number;
  /** Footprint of ONE slot. */
  sizeX: number;
  sizeZ: number;
  /** Inclusive y range terrain has to stamp. Narrower is cheaper. */
  stampMinY: number;
  stampMaxY: number;
  /** Authored geometry for one world column, or null for "not my cell". */
  blockAt(x: number, y: number, z: number): number | null;
}

const DUEL_BAND: ArenaBand = {
  kind: 'duel',
  baseX: DUEL_ARENA_BASE_X,
  spacing: DUEL_ARENA_SLOT_SPACING,
  sizeX: DUEL_ARENA_SIZE,
  sizeZ: DUEL_ARENA_SIZE,
  stampMinY: 95,
  stampMaxY: 255,
  blockAt: duelArenaBlockAt,
};

/** Registered bands, ascending by `baseX`. Bands never overlap: each one owns
 *  `[baseX, nextBaseX)` outright, so a chunk belongs to at most one mode.
 *
 *  Duels and the shared Bridge/Parkour band have separate slot allocators.
 *  `Chunk.key` is a plain string, so large x costs nothing. */
const PARTY_BAND: ArenaBand = {
  kind: 'party',
  baseX: PARTY_BASE_X,
  spacing: PARTY_SLOT_SPACING,
  // The Bridge and a Parkour lane share a slot, side by side in z. Arena
  // snapshots install the course seed before streaming; every match waits for
  // every client to have it loaded.
  sizeX: PARTY_ARENA_SIZE_X,
  sizeZ: PARTY_ARENA_SIZE_Z,
  stampMinY: PARTY_STAMP_MIN_Y,
  stampMaxY: PARTY_STAMP_MAX_Y,
  blockAt: partyArenaBlockAt,
};

export const ARENA_BANDS: readonly ArenaBand[] = [
  DUEL_BAND,
  PARTY_BAND,
];

/**
 * Which band owns a chunk-origin x, or null.
 *
 * Bands are few and sorted, so this is a reverse linear scan — O(bands), which
 * is O(1) in practice and stays branch-predictable. Callers must have already
 * checked `ox >= ARENA_BAND_MIN_X`.
 */
export function arenaBandForX(ox: number): ArenaBand | null {
  if (!Number.isFinite(ox)) return null;
  for (let i = ARENA_BANDS.length - 1; i >= 0; i--) {
    if (ox >= ARENA_BANDS[i].baseX) return ARENA_BANDS[i];
  }
  return null;
}

export function arenaBandFor(kind: ArenaKind): ArenaBand | null {
  return ARENA_BANDS.find((band) => band.kind === kind) ?? null;
}

/**
 * Smoke hook: no two bands' slot footprints can ever collide, for the first
 * `slots` slots of each band.
 *
 * A band's slots occupy `[baseX + s*spacing, +sizeX)`. Two bands are disjoint
 * when the lower one's LAST slot ends before the upper one's base — which is
 * the property that a growing Duels slot counter must never violate.
 */
export function arenaBandsDisjoint(slots: number): boolean {
  const n = Math.max(1, Math.floor(slots));
  for (let i = 0; i < ARENA_BANDS.length; i++) {
    const a = ARENA_BANDS[i];
    if (a.spacing < a.sizeX) return false; // a band must not overlap itself
    const aEnd = a.baseX + (n - 1) * a.spacing + a.sizeX;
    for (let j = i + 1; j < ARENA_BANDS.length; j++) {
      const b = ARENA_BANDS[j];
      if (aEnd > b.baseX) return false;
    }
  }
  return true;
}
