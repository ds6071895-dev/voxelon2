// FACTIONS — the foundation of the war economy (M17). A small fixed set of
// preset teams that players are auto-balanced into on join. Everything
// territorial (machines/turrets/ships/claims) is FACTION-owned, and friendly
// fire is off within a faction. PURE + transport-agnostic (no THREE/DOM/Node)
// so the authoritative server and the offline/predicting client agree on the
// rules — same discipline as machines.ts/ships.ts/turrets.ts.

export interface Faction {
  id: number;
  name: string;
  /** Hex color for avatars / nameplates / HUD / shields / beacons. */
  color: number;
}

/** Sentinel for "no faction" (offline neutral / unassigned). */
export const NO_FACTION = -1;

/** Three preset teams with distinct, readable colors. */
export const FACTIONS: Faction[] = [
  { id: 0, name: 'Crimson', color: 0xe23b3b },
  { id: 1, name: 'Azure', color: 0x3b78e2 },
  { id: 2, name: 'Verdant', color: 0x3bb24a },
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
