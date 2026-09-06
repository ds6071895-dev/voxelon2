// SEASONS (Phase 5) — the war runs in seasons, and a season NO LONGER ENDS ON A
// CLOCK. The old month-long deadline is gone: the season number only ever moves
// when something deliberately ends one (`GameServer.endSeason`), so the war just
// keeps running instead of resetting on a timer nobody was watching. When one
// IS ended the map resets to the 50/50 opening and all bases are cleared, but
// each player KEEPS their account + inventory and the winning faction's members
// earn a permanent "Seasons Won" badge. PURE + transport-agnostic, like the
// other rules modules — the server owns the live clock; the client mirrors it.
//
// The deadline machinery below is kept and still exact: `SEASON_LENGTH` is the
// one number that decides whether a season has an end at all, so putting a
// finite value back is the whole of re-introducing timed seasons.

import { FACTIONS, NO_FACTION } from './teams';

/** How long a season lasts, in seconds. INFINITE: a season has no deadline at
 *  all. Set a finite number here to bring timed seasons back — everything else
 *  in this module reads it, so that one edit is the whole feature. */
export const SEASON_LENGTH = Infinity;

/** What the wire carries for "this season has no deadline". JSON has no
 *  Infinity (`JSON.stringify(Infinity)` is `null`), so the snapshot sends this
 *  sentinel and a reader tests for a negative rather than for a big number. */
export const SEASON_ENDLESS = -1;

export interface SeasonState {
  /** 1-based season counter (bumps on each reset). */
  number: number;
  /** Seconds elapsed in the CURRENT season. */
  elapsed: number;
}

export function newSeason(num = 1): SeasonState {
  return { number: Math.max(1, Math.floor(num)), elapsed: 0 };
}

/** Seconds remaining before the deadline (0 once expired), or Infinity while
 *  the season has no deadline at all. */
export function seasonTimeLeft(s: SeasonState): number {
  return Math.max(0, SEASON_LENGTH - s.elapsed);
}

/** `seasonTimeLeft` as something JSON can actually carry: the seconds left, or
 *  SEASON_ENDLESS for a season that never runs out. */
export function seasonWireTimeLeft(s: SeasonState): number {
  const left = seasonTimeLeft(s);
  return Number.isFinite(left) ? left : SEASON_ENDLESS;
}

/** Does this season have a deadline at all? */
export function seasonHasDeadline(): boolean {
  return Number.isFinite(SEASON_LENGTH);
}

/** Has the season reached its deadline? Always false while SEASON_LENGTH is
 *  infinite — an endless season is never over on the clock. */
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
 * out. Unreachable while seasons are endless, and kept exact for the day a
 * finite SEASON_LENGTH puts the deadline back. A tie (or an empty board)
 * resolves to NO_FACTION — a stalemate, no badge. `counts[id]` is the region
 * count per faction.
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
