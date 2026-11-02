// Box fills shared by server and client: a flood layer, a lava rise or a
// crater is one small `editFill` message instead of thousands of edits. Both
// sides hold identical block state, so applying the same fill in the same
// order gives the same result.

import { BLOCKS, Block } from '../blocks';

export interface FillSpec {
  min: [number, number, number];
  max: [number, number, number];
  block: number;
  /** Which cells change: every cell, only air, only cells holding one of
   *  `replace`, or only fluid cells (draining). */
  mask: 'all' | 'air' | 'fluid' | 'replace';
  replace?: number[];
  /** Only where the cell below is solid or already holds `block` (pouring
   *  water onto ground rather than into a hole). Evaluated bottom-up. */
  supported?: boolean;
  /** Spherical: only cells whose centre is within this radius of the box centre. */
  radius?: number;
}

/** Cells a fill would change, in the canonical order (y, then z, then x). */
export function applyFill(f: FillSpec, get: (x: number, y: number, z: number) => number,
  set: (x: number, y: number, z: number, b: number) => void): number {
  const [x0, y0, z0] = f.min, [x1, y1, z1] = f.max;
  const cx = (x0 + x1 + 1) / 2, cy = (y0 + y1 + 1) / 2, cz = (z0 + z1 + 1) / 2;
  const replace = f.mask === 'replace' ? new Set(f.replace ?? []) : null;
  let changed = 0;
  for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
    if (f.radius !== undefined && Math.hypot(x + .5 - cx, y + .5 - cy, z + .5 - cz) > f.radius) continue;
    const cur = get(x, y, z);
    if (cur === f.block) continue;
    if (f.mask === 'air' && cur !== Block.Air) continue;
    if (f.mask === 'fluid' && !BLOCKS[cur]?.fluid) continue;
    if (replace && !replace.has(cur)) continue;
    if (f.supported) {
      const below = get(x, y - 1, z);
      if (below !== f.block && !BLOCKS[below]?.solid) continue;
    }
    set(x, y, z, f.block);
    changed++;
  }
  return changed;
}
