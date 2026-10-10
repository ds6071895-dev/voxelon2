// Live-world contracts for respawns and restoring disappearing hazard tiles.
// All coordinates here are venue-local; transport translates them once.
import { BLOCKS } from './blocks';
import type { ParkourCell, ParkourCourse, ParkourPlatform } from './parkour_course';
import type { PartyVec3 } from './party_math';

export type ParkourBlockLookup = (x: number, y: number, z: number) => number;

/** Unlike the authored stand spot, this may fail when a hazard has vanished
 *  or a player's wool fills the pad. Never fall back to an unsafe centre. */
export function parkourLiveStandSpot(p: ParkourPlatform, blockAt: ParkourBlockLookup,
  near: { x: number; z: number } = p): PartyVec3 | null {
  const solid = (x: number, y: number, z: number) => !!BLOCKS[blockAt(x, y, z)]?.solid;
  const x0 = Math.floor(p.x - p.width / 2), z0 = Math.floor(p.z - p.depth / 2);
  let best: PartyVec3 | null = null, distance = Infinity;
  for (let x = x0; x < x0 + p.width; x++) for (let z = z0; z < z0 + p.depth; z++) {
    if (!solid(x, p.y - 1, z) || solid(x, p.y, z) || solid(x, p.y + 1, z)) continue;
    const d = Math.hypot(x + .5 - near.x, z + .5 - near.z);
    if (d < distance) { distance = d; best = { x: x + .5, y: p.y, z: z + .5 }; }
  }
  return best;
}

/** Seek forward from the chosen checkpoint/dragon lead, never behind it and
 *  never onto the finish. Caller owns progress and the authoritative teleport. */
export function parkourLiveRespawn(course: ParkourCourse, order: number, blockAt: ParkourBlockLookup):
  { order: number; spot: PartyVec3 } | null {
  for (let next = Math.max(0, Math.ceil(order)); next < course.steps.length - 1; next++) {
    const p = course.steps[next][0], spot = parkourLiveStandSpot(p, blockAt);
    if (spot) return { order: next, spot };
  }
  return null;
}

/** Occupancy uses the same .6 × 1.8 body as player collision. A tile touching
 *  the sole may restore; a tile intersecting the body must remain pending. */
export function parkourRestoreOccupied(cell: Pick<ParkourCell, 'x' | 'y' | 'z'>, bodies: Iterable<PartyVec3>): boolean {
  for (const p of bodies)
    if (p.x + .3 > cell.x && p.x - .3 < cell.x + 1 && p.z + .3 > cell.z && p.z - .3 < cell.z + 1 &&
      p.y + 1.8 > cell.y && p.y < cell.y + 1) return true;
  return false;
}

/** A skipped restore is a pending restore, not a completed hazard transition.
 *  Keep `pending` and retry it on later ticks even if the blink state is steady. */
export function parkourRestorePlan(cells: readonly ParkourCell[], occupied: (cell: ParkourCell) => boolean):
  { ready: ParkourCell[]; pending: ParkourCell[] } {
  const ready: ParkourCell[] = [], pending: ParkourCell[] = [];
  for (const cell of cells) (occupied(cell) ? pending : ready).push(cell);
  return { ready, pending };
}
