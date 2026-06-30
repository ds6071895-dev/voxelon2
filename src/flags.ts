// WAR FLAGS — the simple, readable way to take land (replaces the old presence
// tug-of-war). Kill ANY enemy during a war and your faction plants a single
// flag at the kill spot. Everyone sees it as a waypoint. If the enemy doesn't
// reach it (defuse) before the timer runs out, the WHOLE region the flag sits in
// flips to your faction. One flag per faction at a time, so you must resolve one
// push before starting the next — wars shuffle the board, and whoever holds the
// most regions when the SEASON ends wins (no single-war knockout).
//
// PURE + transport-agnostic (no THREE/DOM/Node), like regions.ts / claims.ts:
// the server owns the authoritative instance; the wire carries snapshots.

import { regionOf } from './regions';
import { isFaction } from './teams';

/** Seconds a planted flag must survive before it claims its region. */
export const FLAG_CLAIM_SECONDS = 120;
/** A living enemy within this radius (world units) of the flag defuses it. */
export const FLAG_CONTEST_RADIUS = 8;

/** An active flag (one per faction). */
export interface Flag {
  faction: number;                 // the planting (killer's) faction
  x: number; y: number; z: number; // world position (the kill spot)
  region: number;                  // region index it claims if it survives
  expiresAt: number;               // worldTime at which it claims the region
}

/** A living player's presence for defuse resolution. */
export interface FlagPresence { faction: number; x: number; z: number; dead: boolean; }

/** Outcome of one flag tick. */
export interface FlagTickResult {
  claimed: Flag[]; // survived the timer -> its region flips to flag.faction
  defused: Flag[]; // an enemy reached it -> removed, no flip
}

/** Fail-closed validation of a flag loaded from the wire/disk. */
function sanitizeFlag(raw: unknown): Flag | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Partial<Flag>;
  if (!isFaction(r.faction as number)) return null;
  if (![r.x, r.y, r.z, r.region, r.expiresAt].every((n) => Number.isFinite(n as number))) return null;
  return {
    faction: r.faction as number,
    x: r.x as number, y: r.y as number, z: r.z as number,
    region: Math.floor(r.region as number),
    expiresAt: r.expiresAt as number,
  };
}

/**
 * The authoritative flag store. The server owns the real instance; clients only
 * render snapshots. Offline solo play never plants flags (no enemies to kill).
 */
export class Flags {
  private flags = new Map<number, Flag>(); // keyed by faction (max one each)

  /**
   * Plant a flag for `faction` at a kill spot. Rejected (returns null) if the
   * faction isn't valid, already has a flag out, or the target region is already
   * theirs. `currentOwner` is the region's present owner.
   */
  plant(faction: number, x: number, y: number, z: number, currentOwner: number, now: number): Flag | null {
    if (!isFaction(faction)) return null;
    if (this.flags.has(faction)) return null;     // one flag per faction at a time
    if (currentOwner === faction) return null;    // already our land
    const flag: Flag = { faction, x, y, z, region: regionOf(x, z), expiresAt: now + FLAG_CLAIM_SECONDS };
    this.flags.set(faction, flag);
    return flag;
  }

  has(faction: number): boolean { return this.flags.has(faction); }
  list(): Flag[] { return [...this.flags.values()]; }
  remove(faction: number): void { this.flags.delete(faction); }
  clear(): void { this.flags.clear(); }

  /**
   * Advance every flag: a living ENEMY of the flag's faction within
   * FLAG_CONTEST_RADIUS defuses it (removed, no flip); otherwise once
   * `now >= expiresAt` it claims its region. Returns what happened this tick.
   */
  tick(presence: FlagPresence[], now: number): FlagTickResult {
    const res: FlagTickResult = { claimed: [], defused: [] };
    const r2 = FLAG_CONTEST_RADIUS * FLAG_CONTEST_RADIUS;
    for (const flag of [...this.flags.values()]) {
      const contested = presence.some((p) =>
        !p.dead && isFaction(p.faction) && p.faction !== flag.faction &&
        (p.x - flag.x) ** 2 + (p.z - flag.z) ** 2 <= r2);
      if (contested) { this.flags.delete(flag.faction); res.defused.push(flag); continue; }
      if (now >= flag.expiresAt) { this.flags.delete(flag.faction); res.claimed.push(flag); }
    }
    return res;
  }

  serialize(): Flag[] { return this.list(); }
  restore(raw: unknown): void {
    this.flags.clear();
    if (!Array.isArray(raw)) return;
    for (const r of raw) {
      const f = sanitizeFlag(r);
      if (f) this.flags.set(f.faction, f);
    }
  }
}
