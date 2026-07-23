// LIFESTEAL hearts (Milestone A): every player's max health is a currency of
// HEARTS (1 heart = 2 HP). PvP kills steal a heart; hitting 0 hearts
// ELIMINATES the player for 24h (server/accounts enforce that — this module is
// the pure math). PURE + transport-agnostic (no THREE/DOM/Node) so the
// authoritative server, the offline client and the smoke tests share one rule
// set — same discipline as machines.ts/claims.ts/teams.ts.

/** Fresh accounts start here (10 hearts = today's 20 HP). */
export const START_HEARTS = 10;
/** Hearts can never exceed this (40 HP) — a kill at the cap wastes the steal. */
export const MAX_HEARTS = 20;
/** Hearts floor; AT 0 the player is eliminated. */
export const MIN_HEARTS = 0;
/** Hearts you come back with after an elimination (timer or revival) — a
 *  comeback penalty, not a wipe. */
export const COMEBACK_HEARTS = 3;
/** You can't withdraw (bottle) a heart if it would leave you below this. */
export const WITHDRAW_FLOOR = 2;
/** Seconds after a direct player hit in which a death still credits them. */
export const KILL_CREDIT_WINDOW = 10;
/** Elimination lockout: real wall-clock ms (24 h). */
export const ELIMINATION_MS = 24 * 60 * 60 * 1000;
/** A PERMANENT elimination: stored as an `eliminatedUntil` so far out that it
 *  never expires. Used when a player's faction holds no flag — the flag is the
 *  only thing that buys a comeback (see flags.ts). */
export const PERMANENT_UNTIL = 8.64e15; // max safe Date value

/** Is this lockout a permanent (flagless) elimination rather than a 24h one? */
export function isPermanentElimination(until: unknown): boolean {
  return typeof until === 'number' && Number.isFinite(until) &&
    until >= PERMANENT_UNTIL - 1;
}
/** HP per heart. */
export const HP_PER_HEART = 2;

/** Clamp a raw hearts value into [MIN_HEARTS, MAX_HEARTS] (integers only;
 *  non-finite/junk falls back to START_HEARTS — fail-safe, never NaN). */
export function clampHearts(n: unknown): number {
  if (typeof n !== 'number' || !Number.isFinite(n)) return START_HEARTS;
  return Math.max(MIN_HEARTS, Math.min(MAX_HEARTS, Math.floor(n)));
}

/** A player's max HP for a hearts count. */
export function maxHealthFor(hearts: number): number {
  return clampHearts(hearts) * HP_PER_HEART;
}

/** A PvP kill moves one heart from victim to killer, respecting both clamps:
 *  a killer at the cap WASTES the steal (victim still loses), a victim at the
 *  floor stays at 0 (elimination). Returns the new pair. */
export function transferHeart(
  killer: number, victim: number
): { killer: number; victim: number } {
  const k = clampHearts(killer), v = clampHearts(victim);
  return {
    killer: Math.min(MAX_HEARTS, k + 1),
    victim: Math.max(MIN_HEARTS, v - 1),
  };
}

/** May a heart be bottled into an item right now? (Keeps you at/above the
 *  withdrawal floor — you can withdraw DOWN TO 2 hearts, never below.) */
export function canWithdraw(hearts: number): boolean {
  return clampHearts(hearts) - 1 >= WITHDRAW_FLOOR;
}

/** May a Heart item be consumed right now? (Blocked at the cap.) */
export function canConsume(hearts: number): boolean {
  return clampHearts(hearts) < MAX_HEARTS;
}

/** Remaining elimination lockout in ms (0 = free to play). Fail-safe on junk. */
export function eliminationRemaining(until: unknown, now: number): number {
  if (typeof until !== 'number' || !Number.isFinite(until)) return 0;
  return Math.max(0, until - now);
}

/** Kid-friendly "17h 22m" countdown for the login screen / console. A
 *  permanent elimination has no countdown to show. */
export function formatRemaining(ms: number): string {
  // Anything past a century of lockout is the permanent sentinel, not a wait.
  if (ms > 100 * 365 * 24 * 60 * 60 * 1000) return 'never';
  const totalMin = Math.max(1, Math.ceil(ms / 60_000));
  const h = Math.floor(totalMin / 60), m = totalMin % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}
