// Exact cell helpers shared by map metadata, authority and bots. These do not
// replace the distinct sight, body-support or collision algorithms.
import { isSolid } from './blocks';
import type { BwPos } from './bedwars_rules';

/** Packed cell key: integer x/z in [-128,127], y in [0,511]. */
export function bwKey(x: number, y: number, z: number): number { return ((x + 128) * 512 + y) * 512 + (z + 128); }
export function bwAttached(get: (x: number, y: number, z: number) => number, p: BwPos): boolean {
  return [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]
    .some(([dx, dy, dz]) => isSolid(get(p.x + dx, p.y + dy, p.z + dz)));
}
