// WAR WINDOWS — the war is a SHRINKING-BORDER battle royale. An admin schedules
// wars from the server console; while a war is on, the world border closes in
// from the full 5000×5000 down to a 100×100 final ring, EVERYONE GLOWS (no
// hiding), and the faction with the most kills when the clock runs out wins the
// war. In between it's PEACETIME. Times are in the server's worldTime clock
// (seconds since boot). PURE + transport-agnostic (no DOM/Node), so the server
// owns it authoritatively and the smoke tests can drive it.

/** Default war length when an admin doesn't specify one (seconds). */
export const DEFAULT_WAR_DURATION = 30 * 60; // 30 minutes

/** Final border side length the war shrinks down to (blocks). */
export const WAR_MIN_BORDER = 100;
/** The border shrinks over this leading fraction of the war, then HOLDS at the
 *  100×100 ring for the remainder (the final brawl). */
export const WAR_SHRINK_PORTION = 0.7;

/** A scheduled war window: [start, end) in worldTime seconds. start===end===0
 *  (or end<=start) means "no war scheduled" — perpetual peacetime. */
export interface WarState { start: number; end: number; }

/** The compact, CLOCK-RELATIVE view sent to clients (so they needn't sync the
 *  server's absolute worldTime — they just count the remaining seconds down).
 *  `duration` lets a client derive the live border size purely from timeLeft. */
export interface WarSnapshot { active: boolean; timeLeft: number; nextIn: number; duration: number; }

/**
 * The live border SIDE LENGTH during a war: linear shrink from `fullSize` down
 * to WAR_MIN_BORDER over the first WAR_SHRINK_PORTION of the war, then held.
 * Pure — the server clamps movement with it and every client renders the same
 * wall from its own countdown. Outside a war it's just `fullSize`.
 */
export function warBorderAt(timeLeft: number, duration: number, fullSize: number): number {
  if (!Number.isFinite(timeLeft) || !Number.isFinite(duration) || duration <= 0) return fullSize;
  const elapsed = Math.max(0, duration - Math.max(0, timeLeft));
  const shrinkTime = duration * WAR_SHRINK_PORTION;
  if (elapsed <= 0) return fullSize;
  if (elapsed >= shrinkTime) return WAR_MIN_BORDER;
  return fullSize + (WAR_MIN_BORDER - fullSize) * (elapsed / shrinkTime);
}

function fin(...n: number[]): boolean { return n.every(Number.isFinite); }

/**
 * A horizontal pull larger than this means the old Y is meaningless: the
 * position came from somewhere else entirely — a mine, a cave, a sealed vault
 * far out in the Wilds. Clamping x/z alone would leave that player embedded in
 * solid rock wherever the ring dragged them to, so anything past this distance
 * has to be re-grounded on real terrain instead.
 */
export const BORDER_RELOCATE_DISTANCE = 1.5;

export interface BorderClamp {
  x: number; z: number;
  /** Horizontal distance the clamp actually moved the position (0 = inside). */
  moved: number;
  /** The pull was far enough that the player needs a safe landing, not a nudge. */
  relocated: boolean;
}

/** Clamp a position into the (possibly war-shrunk) border, reporting how far it
 *  had to move. Shared by the server's authoritative clamp and the client's
 *  local one so the two can never disagree about what counts as a relocation. */
export function clampInsideBorder(x: number, z: number, half: number): BorderClamp {
  if (!fin(x, z, half)) return { x: 0, z: 0, moved: 0, relocated: false };
  const h = Math.max(0, half);
  const cx = Math.max(-h, Math.min(h, x));
  const cz = Math.max(-h, Math.min(h, z));
  const moved = Math.hypot(cx - x, cz - z);
  return { x: cx, z: cz, moved, relocated: moved > BORDER_RELOCATE_DISTANCE };
}

/** War duration in seconds (0 = no war scheduled). */
export function warDuration(w: WarState): number {
  return Math.max(0, w.end - w.start);
}

export function newWar(): WarState { return { start: 0, end: 0 }; }

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
    duration: warDuration(w),
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
