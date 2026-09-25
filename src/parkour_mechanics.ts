// Parkour's moving parts, as pure functions of the course and the round
// clock. The server uses them to decide what happens, the client uses the
// very same functions to draw it (the rising void, the collapse front, the
// flicker before a blink stone goes), and the smoke uses them to fly the
// throw pads with real physics. Nothing here needs a message of its own.
import { Block } from './blocks';
import type { ParkourCell, ParkourCourse, ParkourPlatform } from './parkour_course';

// ── Blink stones ───────────────────────────────────────────────────────────
// Two groups swap on one shared clock. Each is solid for 60% of the period
// and the solid windows OVERLAP by a tenth of it either way, so there is
// always a moment when both are up — the moment to jump from one to the other.

export const BLINK_PERIOD_MS = 3200;
/** How long before a blink stone goes that it starts to flicker. */
export const BLINK_WARN_MS = 450;
export function blinkSolid(group: 0 | 1, tMs: number): boolean {
  if (tMs < 0) return true;
  const phase = (tMs % BLINK_PERIOD_MS) / BLINK_PERIOD_MS;
  return group === 0 ? phase < .6 : phase >= .5 || phase < .1;
}
/** Solid now, gone within the warning window. */
export function blinkWarning(group: 0 | 1, tMs: number): boolean {
  return blinkSolid(group, tMs) && !blinkSolid(group, tMs + BLINK_WARN_MS);
}

// ── Crumble tiles ──────────────────────────────────────────────────────────
// Stand on one and the whole pad cracks at once; it drops out a moment later
// and grows back a few seconds after that, so a racer who fell can try again.

export const CRUMBLE_FALL_MS = 700;
export const CRUMBLE_BACK_MS = 4500;
/** The cracked look, between the step and the fall. */
export const CRUMBLE_CRACKED = Block.Terracotta;

// ── Rising Void ────────────────────────────────────────────────────────────
// Ten seconds of grace, then a kill plane that climbs a little faster every
// second. A clean climb stays well ahead of it; a run with falls in it does
// not, and a fall with no saved pad left above the void is the end.

export const VOID_GRACE_MS = 10_000;
export function parkourVoidY(course: ParkourCourse, tMs: number): number {
  const t = Math.max(0, tMs - VOID_GRACE_MS) / 1000;
  return course.lowY - 5 + t * (.1 + .0012 * t);
}

// ── Collapse Chase ─────────────────────────────────────────────────────────
// The front is measured in course ORDERS: every pad (and everything built on
// it) whose order is below the front is gone. It starts slow and speeds up.

export const COLLAPSE_GRACE_MS = 8000;
export const COLLAPSE_LIVES = 3;
/** A racer who falls comes back this many pads ahead of the front. */
export const COLLAPSE_RESPAWN_LEAD = 2;
export function parkourCollapseFront(tMs: number): number {
  const t = Math.max(0, tMs - COLLAPSE_GRACE_MS) / 1000;
  return t * (.2 + .0016 * t);
}

// ── Throw pads ─────────────────────────────────────────────────────────────

export interface PadImpulse { vx: number; vy: number; vz: number; momentum: number }
const DIRS: readonly (readonly [number, number])[] = [[0, 1], [1, 0], [0, -1], [-1, 0]];

/** The velocity a throw pad sets. A launch pad goes almost straight up — to
 *  a ledge four blocks higher and one block on. A boost pad goes long and
 *  flat, and hands the flight the grapple's momentum window so ordinary air
 *  control does not drag it back to running pace. */
export function parkourPadImpulse(p: ParkourPlatform): PadImpulse {
  const [dx, dz] = DIRS[p.heading];
  if (p.kind === 'launch') return { vx: dx * 4.8, vy: 18, vz: dz * 4.8, momentum: 0 };
  return { vx: dx * 12, vy: 8, vz: dz * 12, momentum: .7 };
}
/** The throw pad under a body standing at venue-local (lx, feetY, lz). */
export function parkourPadUnder(course: ParkourCourse, lx: number, feetY: number, lz: number): ParkourPlatform | null {
  for (const p of course.platforms) {
    if (p.kind !== 'launch' && p.kind !== 'boost') continue;
    if (Math.abs(feetY - p.y) > .05) continue;
    if (Math.abs(lx - p.x) < p.width / 2 + .3 && Math.abs(lz - p.z) < p.depth / 2 + .3) return p;
  }
  return null;
}
/** A throw pad this body could have just been thrown by: close beside it,
 *  and anywhere from its surface to the top of its throw. The server opens
 *  its launch window on this, so a pad's flight is never "corrected". */
export function parkourPadNear(course: ParkourCourse, lx: number, y: number, lz: number): ParkourPlatform | null {
  for (const p of course.platforms) {
    if (p.kind !== 'launch' && p.kind !== 'boost') continue;
    if (y < p.y - .5 || y > p.y + 7) continue;
    if (Math.abs(lx - p.x) < p.width / 2 + 1 && Math.abs(lz - p.z) < p.depth / 2 + 1) return p;
  }
  return null;
}

// ── Cell lookups ───────────────────────────────────────────────────────────

interface CellIndex {
  byPlatform: Map<number, ParkourCell[]>;
  blink: [ParkourCell[], ParkourCell[]];
  /** Solid cells sorted by order, for the collapse front. */
  byOrder: ParkourCell[];
}
const indexes = new WeakMap<ParkourCourse, CellIndex>();
function index(course: ParkourCourse): CellIndex {
  let ix = indexes.get(course);
  if (ix) return ix;
  ix = { byPlatform: new Map(), blink: [[], []], byOrder: [] };
  for (const c of course.cells) {
    if (c.block === Block.Air) continue;
    let list = ix.byPlatform.get(c.platform);
    if (!list) ix.byPlatform.set(c.platform, list = []);
    list.push(c);
    const p = course.platforms[c.platform];
    if (p.kind === 'blink' && c.block === Block.PartyTileD) ix.blink[p.group].push(c);
    ix.byOrder.push(c);
  }
  ix.byOrder.sort((a, b) => a.order - b.order);
  indexes.set(course, ix);
  return ix;
}
/** The live surface of a crumble pad (the tiles themselves, not its dressing). */
export function parkourCrumbleCells(course: ParkourCourse, platform: number): ParkourCell[] {
  return (index(course).byPlatform.get(platform) ?? []).filter(c => c.block === Block.PartyTileC);
}
export function parkourBlinkCells(course: ParkourCourse, group: 0 | 1): readonly ParkourCell[] {
  return index(course).blink[group];
}
/** Every solid cell whose order is in [from, to). */
export function parkourCollapseCells(course: ParkourCourse, from: number, to: number): ParkourCell[] {
  return index(course).byOrder.filter(c => c.order >= from && c.order < to);
}
/** The crumble pad a body at venue-local (lx, feetY, lz) is standing on. */
export function parkourCrumbleUnder(course: ParkourCourse, lx: number, feetY: number, lz: number): ParkourPlatform | null {
  for (const p of course.platforms) {
    if (p.kind !== 'crumble' || Math.abs(feetY - p.y) > .35) continue;
    if (Math.abs(lx - p.x) < p.width / 2 + .3 && Math.abs(lz - p.z) < p.depth / 2 + .3) return p;
  }
  return null;
}
/** Nobody may wall off a checkpoint or fill in, prop up or cover a live pad
 *  with wool — the whole point of a blink stone is the gap it leaves. */
export function parkourBuildBlocked(course: ParkourCourse, lx: number, y: number, lz: number): boolean {
  return course.platforms.some(c => {
    const live = c.kind === 'launch' || c.kind === 'boost' || c.kind === 'blink' || c.kind === 'crumble';
    if (!live && !c.checkpoint) return false;
    const reach = live ? 1 : 0;
    const x0 = Math.floor(c.x - c.width / 2) - reach, z0 = Math.floor(c.z - c.depth / 2) - reach;
    return lx >= x0 && lx < x0 + c.width + 2 * reach && lz >= z0 && lz < z0 + c.depth + 2 * reach &&
      y >= (live ? c.y - 2 : c.y) && y < c.y + 4;
  });
}
