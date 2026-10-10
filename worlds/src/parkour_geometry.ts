// Parkour venue cache and clear start-pad spawns.
import { parkourCourse, parkourStandSpot } from './parkour_course';
import { parkourVenue, type ParkourVenue } from './parkour_setpieces';
import type { PartySubBounds } from './partygames';
import type { PartyVec3 } from './party_math';

const parkourStampCache = new Map<number, ParkourVenue>();
const STAMP_CACHE_MAX = 24;
export function parkourStamp(seed: number): ParkourVenue {
  seed >>>= 0;
  const cached = parkourStampCache.get(seed);
  if (cached) return cached;
  const s = parkourVenue(seed);
  if (parkourStampCache.size >= STAMP_CACHE_MAX) parkourStampCache.delete(parkourStampCache.keys().next().value!);
  parkourStampCache.set(seed, s);
  return s;
}
/** Forget a finished course's stamp (the server calls this when a world ends). */
export function releaseParkourStamp(seed: number): void { parkourStampCache.delete(seed >>> 0); }

export function parkourSpawns(sub: PartySubBounds, members: readonly { team: number }[]): PartyVec3[] {
  // Side by side across the 5x5 start pad: two racers stand either side of
  // the centre line, a party of four spreads out so nobody spawns inside
  // anybody else.
  const course = parkourCourse(sub.seed), p = course.start;
  const lanes = members.length <= 2 ? [-.7, .7] : [-1.6, -.55, .55, 1.6];
  return members.map((_, i) => {
    const x = p.x + (lanes[i % lanes.length] ?? 0);
    // Only ever onto open floor: a lane that meets anything solid moves to
    // the nearest clear spot on the pad.
    const cell = Math.floor(x), clear = parkourStandSpot(course, p, { x: cell + .5, z: p.z });
    const free = Math.floor(clear.x) === cell && Math.floor(clear.z) === Math.floor(p.z);
    return free ? { x: sub.minX + x, y: p.y + .01, z: sub.minZ + p.z }
      : { x: sub.minX + clear.x, y: clear.y + .01, z: sub.minZ + clear.z };
  });
}
