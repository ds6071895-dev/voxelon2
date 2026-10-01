// Parkour's moving parts, as pure functions of the course and the round
// clock. The server uses them to decide what happens, the client uses the
// very same functions to draw it (the dragon's flight, the flicker before a
// blink stone goes), and the tests use them to fly the throw pads with real
// physics.
import { Block } from './blocks';
import type { ParkourCell, ParkourCourse, ParkourPlatform } from './parkour_course';

// ── Blink stones ───────────────────────────────────────────────────────────
// Two groups swap on one shared clock. Each is solid for 60% of the period
// and the solid windows OVERLAP by a tenth of it either way, so there is
// always a moment when both are up — the moment to jump from one to the other.

const BLINK_PERIOD_MS = 3200;
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

// ── The dragon ─────────────────────────────────────────────────────────────
// The dragon's place on the course is a float course ORDER, `front`: it has
// reached the pad at that order. It sleeps in its lair through the grace
// period, then flies the course a little faster every second — and faster
// still when every runner has pulled well clear of it, so it is never far
// behind anybody for long. Because it only ever speeds up, every run ends.

export const DRAGON_LIVES = 3;
/** After GO, before the dragon leaves its lair. */
export const DRAGON_GRACE_MS = 7000;
/** Where the dragon starts: this many orders behind the start pad. */
export const DRAGON_LAIR_FRONT = -4;
/** A runner who loses a life comes back at least this far ahead of it. */
export const DRAGON_RESPAWN_LEAD = 4;
/** Protection after a respawn: the dragon neither catches nor targets you. */
export const DRAGON_IMMUNE_MS = 3000;
/** The dragon's head catches anybody this close to it. */
export const DRAGON_CATCH_RADIUS = 3.2;
/** Orders a second, `t` seconds after it set off. */
export function dragonBaseSpeed(t: number): number {
  return Math.min(1.35, 0.40 + 0.0042 * Math.max(0, t));
}
/** Surge when the rearmost live runner is further ahead than this. */
export const DRAGON_SURGE_GAP = 11;
export const DRAGON_SURGE = 2.2;

/** Fire breath: a lobbed fireball at the rearmost runner in range. */
export const FIREBALL_WINDUP_MS = 450;
export const FIREBALL_FLIGHT_MS = 1150;
export const FIREBALL_RADIUS = 1.9;
export const FIREBALL_RANGE = 38;
/** Milliseconds between breaths, `t` seconds after it set off. */
export function fireballInterval(t: number): number {
  return Math.max(3200, 6500 - t * 20);
}
/** How far ahead of a moving target the dragon aims, at most. */
export const FIREBALL_MAX_LEAD = 3.5;

/** A point on the dragon's flight line at course order `front`. */
export function dragonPoint(course: ParkourCourse, front: number): { x: number; y: number; z: number } {
  const path = course.dragonPath, lair = course.lair;
  if (front <= 0) {
    const t = Math.max(0, Math.min(1, (front - DRAGON_LAIR_FRONT) / -DRAGON_LAIR_FRONT));
    const a = lair, b = path[0];
    // Out of the cave mouth low, then up.
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t * t, z: a.z + (b.z - a.z) * t };
  }
  const i = Math.min(path.length - 1, Math.floor(front)), j = Math.min(path.length - 1, i + 1), f = front - i;
  const a = path[i], b = path[j];
  return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, z: a.z + (b.z - a.z) * f };
}
/** The dragon's head at `front`, with its heading (radians, three.js yaw
 *  convention: 0 faces -z). */
export function dragonPose(course: ParkourCourse, front: number): { x: number; y: number; z: number; yaw: number } {
  const p = dragonPoint(course, front), q = dragonPoint(course, front + .35);
  const dx = q.x - p.x, dz = q.z - p.z;
  const yaw = Math.hypot(dx, dz) > 1e-4 ? Math.atan2(-dx, -dz) : Math.PI;
  return { ...p, yaw };
}
/** Where a fireball is, `f` (0..1) of the way along its lob. */
export function fireballAt(from: { x: number; y: number; z: number }, to: { x: number; y: number; z: number }, f: number):
  { x: number; y: number; z: number } {
  const arc = Math.max(3, Math.hypot(to.x - from.x, to.z - from.z) * .18);
  return {
    x: from.x + (to.x - from.x) * f,
    y: from.y + (to.y - from.y) * f + Math.sin(Math.PI * f) * arc,
    z: from.z + (to.z - from.z) * f,
  };
}

// ── Throw pads ─────────────────────────────────────────────────────────────

interface PadImpulse { vx: number; vy: number; vz: number; momentum: number }
const DIRS: readonly (readonly [number, number])[] = [[0, 1], [1, 0], [0, -1], [-1, 0]];

/** The velocity a throw pad sets. A launch pad goes almost straight up — to
 *  a ledge four blocks higher and one block on. A boost pad goes long and
 *  flat, and hands the flight a momentum window so ordinary air control does
 *  not drag it back to running pace. */
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
}
const indexes = new WeakMap<ParkourCourse, CellIndex>();
function index(course: ParkourCourse): CellIndex {
  let ix = indexes.get(course);
  if (ix) return ix;
  ix = { byPlatform: new Map(), blink: [[], []] };
  for (const c of course.cells) {
    if (c.block === Block.Air) continue;
    let list = ix.byPlatform.get(c.platform);
    if (!list) ix.byPlatform.set(c.platform, list = []);
    list.push(c);
    const p = course.platforms[c.platform];
    if (p.kind === 'blink' && c.block === Block.PartyTileD) ix.blink[p.group].push(c);
  }
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
