// Vanilla-style voxel lighting: 0-15 levels, two channels.
// - Skylight: full 15 above the surface, attenuated downward by water/leaves,
//   then BFS flood into overhangs and cave mouths (decay 1 per block).
// - Block light: BFS flood from emitters (torches = 14), decay 1 per block.
// Pure and region-based so it is exactly correct for a chunk when computed
// over a 3x3-chunk window (max propagation distance is 15 < 16 blocks).

import { Block, isOpaque } from './blocks';

export interface LightRegion {
  minX: number;
  minZ: number;
  sizeX: number;
  sizeZ: number;
  /** Cells at y >= height are open sky. */
  height: number;
  getBlock(wx: number, wy: number, wz: number): number;
  /** [wx, wy, wz, level] light emitters inside the region. */
  emitters: [number, number, number, number][];
}

export interface LightField {
  sky(wx: number, wy: number, wz: number): number;
  block(wx: number, wy: number, wz: number): number;
}

/** Extra attenuation per block, on top of the BFS decay of 1. */
function extraOpacity(id: number): number {
  if (id === Block.Water) return 2;
  if (
    id === Block.Leaves || id === Block.BirchLeaves || id === Block.SpruceLeaves
  ) return 1;
  return 0;
}

// Shared scratch buffers (one light computation at a time).
const MAX_CELLS = 48 * 48 * 256;
const scratchSky = new Uint8Array(MAX_CELLS);
const scratchBlock = new Uint8Array(MAX_CELLS);

export function computeLight(region: LightRegion): LightField {
  const { minX, minZ, sizeX, sizeZ, getBlock } = region;
  const H = Math.min(256, Math.max(1, region.height));
  const cells = sizeX * sizeZ * H;
  const sky = scratchSky.subarray(0, cells).fill(0);
  const blk = scratchBlock.subarray(0, cells).fill(0);
  const idx = (x: number, z: number, y: number) => (x * sizeZ + z) * H + y;

  // --- Skylight: vertical fill per column -----------------------------------
  for (let x = 0; x < sizeX; x++) {
    for (let z = 0; z < sizeZ; z++) {
      const wx = minX + x, wz = minZ + z;
      let level = 15;
      for (let y = H - 1; y >= 0; y--) {
        const id = getBlock(wx, y, wz);
        if (id !== Block.Air) {
          if (isOpaque(id)) break; // everything below stays 0
          level = Math.max(0, level - extraOpacity(id) - (id === Block.Water ? 1 : 0));
          if (level === 0) break;
        }
        sky[idx(x, z, y)] = level;
      }
    }
  }

  const queue: number[] = [];

  // Seed the horizontal spread: lit cells bordering darker non-opaque cells.
  for (let x = 0; x < sizeX; x++) {
    for (let z = 0; z < sizeZ; z++) {
      for (let y = 0; y < H; y++) {
        const i = idx(x, z, y);
        const l = sky[i];
        if (l <= 1) continue;
        if (
          (x > 0 && sky[idx(x - 1, z, y)] < l - 1) ||
          (x < sizeX - 1 && sky[idx(x + 1, z, y)] < l - 1) ||
          (z > 0 && sky[idx(x, z - 1, y)] < l - 1) ||
          (z < sizeZ - 1 && sky[idx(x, z + 1, y)] < l - 1) ||
          (y > 0 && sky[idx(x, z, y - 1)] < l - 1)
        ) {
          queue.push(i);
        }
      }
    }
  }
  flood(sky, queue, sizeX, sizeZ, H, minX, minZ, getBlock);

  // --- Block light: BFS from emitters ---------------------------------------
  for (const [ex, ey, ez, level] of region.emitters) {
    const x = ex - minX, z = ez - minZ;
    if (x < 0 || x >= sizeX || z < 0 || z >= sizeZ || ey < 0 || ey >= H) continue;
    const i = idx(x, z, ey);
    if (level > blk[i]) {
      blk[i] = level;
      queue.push(i);
    }
  }
  flood(blk, queue, sizeX, sizeZ, H, minX, minZ, getBlock);

  return {
    sky(wx, wy, wz) {
      const x = wx - minX, z = wz - minZ;
      if (x < 0 || x >= sizeX || z < 0 || z >= sizeZ || wy < 0) return 15;
      if (wy >= H) return 15;
      return sky[idx(x, z, wy)];
    },
    block(wx, wy, wz) {
      const x = wx - minX, z = wz - minZ;
      if (x < 0 || x >= sizeX || z < 0 || z >= sizeZ || wy < 0 || wy >= H) return 0;
      return blk[idx(x, z, wy)];
    },
  };
}

/** BFS flood with decay 1 + per-block extra opacity; opaque blocks stop it. */
function flood(
  light: Uint8Array, queue: number[],
  sizeX: number, sizeZ: number, H: number,
  minX: number, minZ: number,
  getBlock: (wx: number, wy: number, wz: number) => number
): void {
  // index packing: i = (x*sizeZ + z)*H + y
  let head = 0;
  while (head < queue.length) {
    const i = queue[head++];
    const level = light[i];
    if (level <= 1) continue;
    const y = i % H;
    const xz = (i - y) / H;
    const z = xz % sizeZ;
    const x = (xz - z) / sizeZ;

    for (let d = 0; d < 6; d++) {
      const nx = d === 0 ? x - 1 : d === 1 ? x + 1 : x;
      const nz = d === 2 ? z - 1 : d === 3 ? z + 1 : z;
      const ny = d === 4 ? y - 1 : d === 5 ? y + 1 : y;
      if (nx < 0 || nx >= sizeX || nz < 0 || nz >= sizeZ || ny < 0 || ny >= H) {
        continue;
      }
      const ni = (nx * sizeZ + nz) * H + ny;
      const cand = level - 1 - extraOpacity(getBlock(minX + nx, ny, minZ + nz));
      if (cand <= light[ni]) continue;
      if (isOpaque(getBlock(minX + nx, ny, minZ + nz))) continue;
      light[ni] = cand;
      if (cand > 1) queue.push(ni);
    }
  }
  queue.length = 0;
}
