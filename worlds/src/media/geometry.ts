import { Block, BLOCKS, collisionBoxes } from '../blocks';

export type GeometryPoint = readonly [number, number, number];
export interface GeometrySampler { blockAt(x: number, y: number, z: number): number }
export interface GeometryHit { cell: [number, number, number]; block: number }

/** Sub-box-aware volume audit; touching a floor or a wall is not penetration. */
export function captureVolumeHit(sampler: GeometrySampler, min: GeometryPoint, max: GeometryPoint): GeometryHit | null {
  for (let x = Math.floor(min[0]); x < Math.ceil(max[0]); x++) {
    for (let y = Math.floor(min[1]); y < Math.ceil(max[1]); y++) {
      for (let z = Math.floor(min[2]); z < Math.ceil(max[2]); z++) {
        const block = sampler.blockAt(x, y, z);
        if (block === Block.Barrier) continue; // invisible match boundary
        for (const [lo, hi] of collisionBoxes(block) ?? []) {
          if (max[0] > x + lo[0] + 1e-7 && min[0] < x + hi[0] - 1e-7
            && max[1] > y + lo[1] + 1e-7 && min[1] < y + hi[1] - 1e-7
            && max[2] > z + lo[2] + 1e-7 && min[2] < z + hi[2] - 1e-7) return { cell: [x, y, z], block };
        }
      }
    }
  }
  return null;
}

/** Exact ray/sub-box intersection with DDA cell traversal (not point sampling).
 * Transparent panes and invisible match barriers do not hide a subject. */
export function captureSightHit(sampler: GeometrySampler, from: GeometryPoint, to: GeometryPoint): GeometryHit | null {
  const delta = to.map((v, i) => v - from[i]);
  const cell = from.map(Math.floor);
  const step = delta.map(Math.sign);
  const stride = delta.map(v => v ? Math.abs(1 / v) : Infinity);
  const next = delta.map((v, i) => v ? ((v > 0 ? cell[i] + 1 : cell[i]) - from[i]) / v : Infinity);
  const intersects = (lo: GeometryPoint, hi: GeometryPoint): boolean => {
    let enter = 0, leave = 1;
    for (let i = 0; i < 3; i++) {
      const low = cell[i] + lo[i], high = cell[i] + hi[i];
      if (!delta[i]) { if (from[i] <= low || from[i] >= high) return false; }
      else {
        const a = (low - from[i]) / delta[i], b = (high - from[i]) / delta[i];
        enter = Math.max(enter, Math.min(a, b));
        leave = Math.min(leave, Math.max(a, b));
        if (enter >= leave - 1e-7) return false;
      }
    }
    return leave > 1e-7 && enter < 1 - 1e-7;
  };
  // A segment visits at most this many cells, including tied corner crossings.
  const budget = Math.ceil(Math.abs(delta[0]) + Math.abs(delta[1]) + Math.abs(delta[2])) + 4;
  for (let n = 0; n < budget; n++) {
    const block = sampler.blockAt(cell[0], cell[1], cell[2]);
    const info = BLOCKS[block];
    if (block !== Block.Barrier && (info?.opaque || info?.shape === 'box')) {
      for (const [lo, hi] of collisionBoxes(block) ?? []) {
        if (intersects(lo, hi)) return { cell: [cell[0], cell[1], cell[2]], block };
      }
    }
    const axis = next[0] <= next[1] && next[0] <= next[2] ? 0 : next[1] <= next[2] ? 1 : 2;
    if (next[axis] > 1 || !Number.isFinite(next[axis])) break;
    cell[axis] += step[axis];
    next[axis] += stride[axis];
  }
  return null;
}
