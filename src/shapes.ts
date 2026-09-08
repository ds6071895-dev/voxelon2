// Single source of truth for block SHAPES as cell-local axis-aligned boxes,
// shared by the world mesher, the ship mesher, AND player physics so render and
// collision always agree on where a slab/stairs actually is. PURE: imports from
// blocks.ts only (no THREE, no DOM, no Node). The hot path (player collision)
// hits collisionBoxes per overlapping cell, so the common cases return cached
// constant arrays and never allocate — only stairs build a 2-element array.

import { Block, BLOCKS, isSolid, isTopSlab } from './blocks';

/** Min/max corner of a box in cell-local [0,1] space. */
export type Box = [[number, number, number], [number, number, number]];

export const FULL_BOX: Box = [[0, 0, 0], [1, 1, 1]];
export const SLAB_BOTTOM: Box = [[0, 0, 0], [1, 0.5, 1]];
export const SLAB_TOP: Box = [[0, 0.5, 0], [1, 1, 1]];
/** The landmine's thin pressure plate (slab-shaped block, custom height). */
export const PLATE_BOX: Box = [[0, 0, 0], [1, 0.15, 1]];

// Cached single-box arrays so the common (non-stairs) cases never allocate.
const FULL: Box[] = [FULL_BOX];
const BOTTOM: Box[] = [SLAB_BOTTOM];
const TOP: Box[] = [SLAB_TOP];
const PLATE: Box[] = [PLATE_BOX];
const NONE: Box[] = [];
const BED: Box[] = [[[0, 0, 0], [1, 0.62, 1]]];

/** The sub-boxes that make up a stairs block facing dir (0=N 1=E 2=S 3=W): a
 *  bottom slab plus a top quarter on the `facing` side (the tall step). */
export function stairBoxes(facing: number): Box[] {
  const top: Box =
    facing === 1 ? [[0.5, 0.5, 0], [1, 1, 1]]      // E (+x)
    : facing === 2 ? [[0, 0.5, 0.5], [1, 1, 1]]    // S (+z)
    : facing === 3 ? [[0, 0.5, 0], [0.5, 1, 1]]    // W (-x)
    : [[0, 0.5, 0], [1, 1, 0.5]];                  // N (-z)
  return [[[0, 0, 0], [1, 0.5, 1]], top];
}

/** World-collision boxes for a block id, in cell-local [0,1] space. Empty for
 *  non-solid blocks (air/water/plants/torches). */
export function collisionBoxes(id: number): Box[] {
  if (!isSolid(id)) return NONE;
  if (id === Block.BwBedA || id === Block.BwBedB) return BED;
  const shape = BLOCKS[id].shape;
  if (shape === 'slab') {
    // Thin pressure/spring plates: the landmine and the retracted wall trap.
    if (id === Block.Landmine || id === Block.WallTrap) return PLATE;
    return isTopSlab(id) ? TOP : BOTTOM;
  }
  if (shape === 'stairs') return stairBoxes(BLOCKS[id].facing);
  return FULL; // cube (and any other solid shape) fills the cell
}

/** Render boxes match collision boxes for slabs/stairs, so the mesher and
 *  physics use one definition of the shape. */
export function renderBoxes(id: number): Box[] {
  return collisionBoxes(id);
}
