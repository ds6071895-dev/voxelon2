// SEASONS (Phase 5) — the war runs in month-long seasons. A season ENDS either
// at the deadline (the faction holding the most regions wins) or instantly when
// a faction takes the enemy capital (Phase 2). On end the map resets to the
// 50/50 opening and all bases are cleared, but each player KEEPS their account +
// inventory and the winning faction's members earn a permanent "Seasons Won"
// badge. PURE + transport-agnostic, like the other rules modules — the server
// owns the live timer; the client mirrors it for the HUD.

import { FACTIONS, NO_FACTION } from './teams';

/** One season is a real month (seconds). Tunable; tests drive it with big dt. */
export const SEASON_LENGTH = 30 * 24 * 3600;

export interface SeasonState {
  /** 1-based season counter (bumps on each reset). */
  number: number;
  /** Seconds elapsed in the CURRENT season. */
  elapsed: number;
}

export function newSeason(num = 1): SeasonState {
  return { number: Math.max(1, Math.floor(num)), elapsed: 0 };
}

/** Seconds remaining before the deadline (0 once expired). */
export function seasonTimeLeft(s: SeasonState): number {
  return Math.max(0, SEASON_LENGTH - s.elapsed);
}

/** Has the season reached its deadline? */
export function seasonExpired(s: SeasonState): boolean {
  return s.elapsed >= SEASON_LENGTH;
}

/** Advance the season clock. */
export function tickSeasonClock(s: SeasonState, dt: number): void {
  if (Number.isFinite(dt) && dt > 0) s.elapsed += dt;
}

/** Begin the next season in place (bump number, reset clock). */
export function advanceSeason(s: SeasonState): void {
  s.number = Math.max(1, s.number) + 1;
  s.elapsed = 0;
}

/**
 * The DEADLINE winner: the faction holding the most regions when the clock runs
 * out. A tie (or an empty board) resolves to NO_FACTION — a stalemate, no badge.
 * `counts[id]` is the region count per faction.
 */
export function deadlineWinner(counts: Record<number, number>): number {
  let best = NO_FACTION, bestN = -1, tie = false;
  for (const f of FACTIONS) {
    const n = counts[f.id] ?? 0;
    if (n > bestN) { bestN = n; best = f.id; tie = false; }
    else if (n === bestN) tie = true;
  }
  return tie || bestN <= 0 ? NO_FACTION : best;
}

/** Fail-closed validation of a persisted/wire season blob. */
export function sanitizeSeason(raw: unknown): SeasonState {
  if (!raw || typeof raw !== 'object') return newSeason();
  const r = raw as Record<string, unknown>;
  const number = Number.isFinite(r.number) ? Math.max(1, Math.floor(r.number as number)) : 1;
  const elapsed = Number.isFinite(r.elapsed) ? Math.max(0, Math.min(SEASON_LENGTH, r.elapsed as number)) : 0;
  return { number, elapsed };
}
