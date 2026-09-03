// FACTIONS — the foundation of the war economy (M17, recut to TWO sides in the
// Faction War rework). Exactly two preset teams: players PICK their side on
// first login unless one side outnumbers the other by >20% (then they're forced
// onto the weaker side to keep the war 50/50). Everything territorial
// (regions/bases/machines/turrets/ships) is FACTION-owned, and friendly fire is
// off within a faction. PURE + transport-agnostic (no THREE/DOM/Node) so the
// authoritative server and the offline/predicting client agree on the rules —
// same discipline as machines.ts/ships.ts/turrets.ts.

export interface Faction {
  id: number;
  name: string;
  /** Hex color for avatars / nameplates / HUD / shields / beacons. */
  color: number;
}

/** Sentinel for "no faction" (offline neutral / unassigned). */
export const NO_FACTION = -1;

/** The TWO preset teams with distinct, readable colors (red vs blue). */
export const FACTIONS: Faction[] = [
  { id: 0, name: 'Crimson', color: 0xe23b3b },
  { id: 1, name: 'Azure', color: 0x3b78e2 },
];

export function factionById(id: number): Faction | undefined {
  return FACTIONS.find((f) => f.id === id);
}

/** Display name for a faction id (Neutral for NO_FACTION / unknown). */
export function factionName(id: number): string {
  return factionById(id)?.name ?? 'Neutral';
}

/** Hex color for a faction id (a neutral grey for NO_FACTION / unknown). */
export function factionColor(id: number): number {
  return factionById(id)?.color ?? 0x9a9a9a;
}

/** A valid, assigned faction id (rejects NO_FACTION / junk). */
export function isFaction(id: number): boolean {
  return Number.isFinite(id) && factionById(id) !== undefined;
}

/**
 * Two entities are FRIENDLY (no PvP, shared ownership) only if they share a
 * real, assigned faction. NO_FACTION never matches anything — including itself —
 * so neutral/offline entities are always fair game (fail-open to combat, never
 * to accidental immunity).
 */
export function sameFaction(a: number, b: number): boolean {
  return isFaction(a) && a === b;
}

/**
 * Auto-balance: pick the lowest-population faction for a joining player.
 * `counts[id]` is the current member count of faction `id`. Ties break to the
 * lowest id (deterministic), so N joins spread evenly across the presets.
 */
export function balancedFaction(counts: Record<number, number>): number {
  let best = FACTIONS[0].id;
  let bestN = Infinity;
  for (const f of FACTIONS) {
    const n = counts[f.id] ?? 0;
    if (n < bestN) { bestN = n; best = f.id; }
  }
  return best;
}

/** A side is "outnumbered" once the other has >20% more members. */
export const IMBALANCE_RATIO = 1.2;

/**
 * Faction-pick gate: returns the faction a NEW member MUST join (the smaller
 * side) when one faction already outnumbers the other by more than 20%; returns
 * `null` when the sides are close enough that the player may freely PICK. Ties
 * on the smaller side break to the lowest id (deterministic). Pure — the server
 * and the offline client both run it so a "free pick" never silently breaks
 * balance. `counts[id]` is the current member count of faction `id`.
 */
export function forcedFaction(counts: Record<number, number>): number | null {
  let smaller = FACTIONS[0].id, minN = Infinity, maxN = -Infinity;
  for (const f of FACTIONS) {
    const n = counts[f.id] ?? 0;
    if (n < minN) { minN = n; smaller = f.id; }
    if (n > maxN) maxN = n;
  }
  return maxN > minN * IMBALANCE_RATIO ? smaller : null;
}

/**
 * Resolve a joining player's faction: honour their PICK unless the teams are
 * imbalanced (then force the weaker side); fall back to the balanced default
 * when no valid pick is given. Single source of truth shared by the account
 * store and the server. `desired` is the player's requested faction (or
 * undefined for "no preference").
 */
export function resolveJoinFaction(counts: Record<number, number>, desired?: number): number {
  const forced = forcedFaction(counts);
  if (forced !== null) return forced;
  if (desired !== undefined && isFaction(desired)) return desired;
  return balancedFaction(counts);
}

// --- Secret faction switching / betrayals (Phase 7) --------------------------
export const MAX_SWITCHES_PER_SEASON = 2;
/** Switching is locked in the final week of a season (no last-minute flips). */
export const SWITCH_LOCK_SECONDS = 7 * 24 * 3600;

/** Per-account switch budget (resets each season). */
export interface SwitchState { switchesUsed: number; switchSeason: number; }

/** Switches a player has left this season (a full budget once the season ticks
 *  over to a new number). */
export function switchesRemaining(s: SwitchState, currentSeason: number): number {
  if (s.switchSeason !== currentSeason) return MAX_SWITCHES_PER_SEASON;
  return Math.max(0, MAX_SWITCHES_PER_SEASON - Math.max(0, s.switchesUsed));
}

/**
 * May a player defect to `target` right now? Must be a different real faction,
 * outside the final-week lock, with switches left this season. Pure rule shared
 * by the server and the offline client.
 */
export function canSwitchFaction(
  s: SwitchState, currentSeason: number, current: number, target: number, seasonTimeLeft: number,
): boolean {
  if (!isFaction(target) || target === current) return false;
  if (seasonTimeLeft <= SWITCH_LOCK_SECONDS) return false; // final-week lock
  return switchesRemaining(s, currentSeason) > 0;
}

/** The other faction in a two-faction war (for the "defect" button). */
export function otherFaction(faction: number): number {
  return faction === FACTIONS[0].id ? FACTIONS[1].id : FACTIONS[0].id;
}
