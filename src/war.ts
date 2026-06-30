// WAR WINDOWS — region capture (gaining land on the war map) is only allowed
// during a scheduled WAR. An admin schedules wars from the server console; in
// between it's PEACETIME and the frontline is frozen. Times are in the server's
// worldTime clock (seconds since boot). PURE + transport-agnostic (no DOM/Node),
// so the server owns it authoritatively and the smoke tests can drive it.

/** Default war length when an admin doesn't specify one (seconds). */
export const DEFAULT_WAR_DURATION = 30 * 60; // 30 minutes

/** A scheduled war window: [start, end) in worldTime seconds. start===end===0
 *  (or end<=start) means "no war scheduled" — perpetual peacetime. */
export interface WarState { start: number; end: number; }

/** The compact, CLOCK-RELATIVE view sent to clients (so they needn't sync the
 *  server's absolute worldTime — they just count the remaining seconds down). */
export interface WarSnapshot { active: boolean; timeLeft: number; nextIn: number; }

export function newWar(): WarState { return { start: 0, end: 0 }; }

function fin(...n: number[]): boolean { return n.every(Number.isFinite); }

/** A war is on right now. */
export function warActive(w: WarState, now: number): boolean {
  return w.end > w.start && now >= w.start && now < w.end;
}

/** A war is scheduled but hasn't started yet (peacetime, counting down). */
export function warPending(w: WarState, now: number): boolean {
  return w.end > w.start && w.start > now;
}

/** Seconds until the active war ends (0 if no war is active). */
export function warTimeLeft(w: WarState, now: number): number {
  return warActive(w, now) ? Math.max(0, w.end - now) : 0;
}

/** Seconds until the next scheduled war begins (0 if none pending). */
export function warStartsIn(w: WarState, now: number): number {
  return warPending(w, now) ? Math.max(0, w.start - now) : 0;
}

/** Build a war window starting `delay` seconds from `now`, lasting `duration`. */
export function scheduleWar(delay: number, duration: number, now: number): WarState {
  const d = fin(delay) ? Math.max(0, delay) : 0;
  const len = fin(duration) && duration > 0 ? duration : DEFAULT_WAR_DURATION;
  const start = (fin(now) ? now : 0) + d;
  return { start, end: start + len };
}

/** Clock-relative snapshot for the wire/HUD. */
export function warSnapshot(w: WarState, now: number): WarSnapshot {
  return {
    active: warActive(w, now),
    timeLeft: warTimeLeft(w, now),
    nextIn: warStartsIn(w, now),
  };
}

/** Fail-closed validation of a WarState off the wire/disk. */
export function sanitizeWar(raw: unknown): WarState {
  if (!raw || typeof raw !== 'object') return newWar();
  const r = raw as Record<string, unknown>;
  const start = Number(r.start), end = Number(r.end);
  if (!fin(start, end) || start < 0 || end < 0) return newWar();
  return { start, end };
}
