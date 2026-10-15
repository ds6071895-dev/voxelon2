// Vanilla-style voxel lighting: 0-15 levels, two channels.
// - Skylight: full 15 above the surface, attenuated downward by water/leaves,
//   then BFS flood into overhangs and cave mouths (decay 1 per block).
// - Block light: BFS flood from emitters (torches = 14), decay 1 per block.
// Region-based: a cell's light is exact when the window reaches 15 blocks past
// it on every side (no light travels further), which a 3x3-chunk window does
// for one chunk plus its one-cell border.

import { Block, BLOCKS, isOpaque } from './blocks';
import { Chunk, CHUNK_X, CHUNK_Z } from './chunk';

export interface LightField {
  sky(wx: number, wy: number, wz: number): number;
  block(wx: number, wy: number, wz: number): number;
}

/** Per-cell attenuation code: 255 stops light, otherwise the extra opacity on
 *  top of the decay of 1 (water 2, leaves 1). */
const OPAQUE = 255;
let attenuation: Uint8Array | null = null;
function attenuationTable(): Uint8Array {
  if (attenuation) return attenuation;
  const t = new Uint8Array(256);
  for (let id = 0; id < 256; id++) {
    t[id] = isOpaque(id) ? OPAQUE
      : id === Block.Water ? 2
      : id === Block.Leaves || id === Block.BirchLeaves || id === Block.SpruceLeaves ? 1
      : 0;
  }
  return (attenuation = t);
}
// BLOCKS is a static registry; touch it so a bad import order fails loudly.
void BLOCKS;

/**
 * A solved window. Arrays are padded by one cell on every side (an opaque
 * shell, so the flood needs no bounds checks): cell (x, y, z) of the window,
 * x in [0, sizeX), y in [y0, y1), lives at ((x + 1) * PZ + z + 1) * PH + y - y0 + 1.
 * Cells at or above y1 are open sky (15, no block light); nothing below y0 holds
 * a block. The arrays are shared scratch: read them before the next solve.
 */
export interface LightWindow {
  readonly minX: number; readonly minZ: number;
  readonly sizeX: number; readonly sizeZ: number;
  readonly y0: number; readonly y1: number;
  readonly PZ: number; readonly PH: number;
  readonly sky: Uint8Array; readonly blk: Uint8Array;
}

let scratchAtt = new Uint8Array(0);
let scratchSky = new Uint8Array(0);
let scratchBlk = new Uint8Array(0);
let scratchClear = new Int16Array(0);
/** Bucket queue by light level: a cell is final when its bucket is drained, so
 *  each one is expanded at most once (a FIFO from mixed seeds re-expands). */
const buckets: number[][] = Array.from({ length: 16 }, () => []);
const scratchEmitters: number[] = [];

/** Vertical extent worth solving over a set of chunks: from the layer under the
 *  lowest block (every layer below is identical open air, so cutting there is
 *  exact) to 4 above the highest. */
export function lightYRange(chunks: (Chunk | undefined)[]): [number, number] {
  let lo = 256, hi = 0;
  for (const c of chunks) {
    if (!c || c.maxY === 0) continue;
    lo = Math.min(lo, c.minY);
    hi = Math.max(hi, c.maxY);
  }
  if (hi === 0) return [0, 1];
  return [Math.max(0, lo - 1), Math.min(256, hi + 4)];
}

/** Solve sky and block light over [minX, minX+sizeX) x [y0, y1) x [minZ, minZ+sizeZ).
 *  Missing chunks read as air. */
export function solveLight(
  chunkAt: (cx: number, cz: number) => Chunk | undefined,
  minX: number, minZ: number, sizeX: number, sizeZ: number, y0: number, y1: number,
): LightWindow {
  const ATT = attenuationTable();
  const H = Math.max(1, y1 - y0);
  y1 = y0 + H;
  const PZ = sizeZ + 2, PH = H + 2, SX = PZ * PH;
  const cells = (sizeX + 2) * SX;
  if (scratchAtt.length < cells) {
    scratchAtt = new Uint8Array(cells);
    scratchSky = new Uint8Array(cells);
    scratchBlk = new Uint8Array(cells);
  }
  if (scratchClear.length < sizeX * sizeZ) scratchClear = new Int16Array(sizeX * sizeZ);
  const att = scratchAtt, sky = scratchSky, blk = scratchBlk, clear = scratchClear;
  att.fill(OPAQUE, 0, cells);
  sky.fill(0, 0, cells);
  blk.fill(0, 0, cells);

  // --- Gather attenuation, column by column, one chunk at a time ------------
  const bq = buckets;
  const emitters = scratchEmitters;
  emitters.length = 0;
  const cx0 = minX >> 4, cx1 = (minX + sizeX - 1) >> 4;
  const cz0 = minZ >> 4, cz1 = (minZ + sizeZ - 1) >> 4;
  for (let cx = cx0; cx <= cx1; cx++) {
    const xa = Math.max(minX, cx * CHUNK_X), xb = Math.min(minX + sizeX, cx * CHUNK_X + CHUNK_X);
    for (let cz = cz0; cz <= cz1; cz++) {
      const za = Math.max(minZ, cz * CHUNK_Z), zb = Math.min(minZ + sizeZ, cz * CHUNK_Z + CHUNK_Z);
      const chunk = chunkAt(cx, cz);
      const data = chunk?.data;
      const top = chunk ? Math.min(y1, chunk.maxY) : y0;
      for (let wx = xa; wx < xb; wx++) {
        for (let wz = za; wz < zb; wz++) {
          const base = ((wx - minX + 1) * PZ + (wz - minZ + 1)) * PH + 1 - y0;
          // Air above the chunk's tallest block needs no table lookup.
          att.fill(0, base + y0, base + y1);
          if (!data) continue;
          const src = (((wx & 15) << 4) | (wz & 15)) << 8;
          for (let y = y0; y < top; y++) att[base + y] = ATT[data[src + y]];
        }
      }
      // Emitters seed the block-light flood.
      if (chunk && chunk.lights.size) {
        for (const [idx, level] of chunk.lights) {
          const wx = cx * CHUNK_X + ((idx >> 12) & 15), wz = cz * CHUNK_Z + ((idx >> 8) & 15), y = idx & 255;
          if (wx < xa || wx >= xb || wz < za || wz >= zb || y < y0 || y >= y1) continue;
          const i = ((wx - minX + 1) * PZ + (wz - minZ + 1)) * PH + 1 + y - y0;
          if (level > blk[i]) { blk[i] = Math.min(15, level); emitters.push(i); }
        }
      }
    }
  }

  // --- Skylight: vertical fill per column -----------------------------------
  // `clear[col]` = lowest y from which the column is open up to the sky. Above
  // the highest `clear` of a column and its four neighbours nothing can seed
  // the spread, so the seed scan skips it — over open sky or void (Bedwars)
  // that is most of the window.
  for (let x = 0; x < sizeX; x++) {
    for (let z = 0; z < sizeZ; z++) {
      const base = ((x + 1) * PZ + z + 1) * PH + 1 - y0;
      let level = 15, c = y0;
      for (let y = y1 - 1; y >= y0; y--) {
        const a = att[base + y];
        if (a !== 0) {
          // The solve only ever sees attenuation, so a block that lets light
          // through untouched (glass, plants) is air to it, exactly.
          if (c === y0) c = y + 1;
          if (a === OPAQUE) break; // everything below stays 0
          // Water also costs its own decay of 1 on the way down.
          level = Math.max(0, level - a - (a === 2 ? 1 : 0));
          if (level === 0) break;
        }
        sky[base + y] = level;
      }
      clear[x * sizeZ + z] = c;
    }
  }

  // Seed the horizontal spread: lit cells bordering darker non-opaque cells.
  for (let x = 0; x < sizeX; x++) {
    for (let z = 0; z < sizeZ; z++) {
      const col = x * sizeZ + z;
      let top = clear[col];
      if (x > 0 && clear[col - sizeZ] > top) top = clear[col - sizeZ];
      if (x < sizeX - 1 && clear[col + sizeZ] > top) top = clear[col + sizeZ];
      if (z > 0 && clear[col - 1] > top) top = clear[col - 1];
      if (z < sizeZ - 1 && clear[col + 1] > top) top = clear[col + 1];
      const base = ((x + 1) * PZ + z + 1) * PH + 1 - y0;
      for (let y = y0, end = Math.min(y1, top + 1); y < end; y++) {
        const i = base + y, l = sky[i];
        if (l <= 1) continue;
        const d = l - 1;
        if ((sky[i - SX] < d && att[i - SX] !== OPAQUE) || (sky[i + SX] < d && att[i + SX] !== OPAQUE) ||
            (sky[i - PH] < d && att[i - PH] !== OPAQUE) || (sky[i + PH] < d && att[i + PH] !== OPAQUE) ||
            (sky[i - 1] < d && att[i - 1] !== OPAQUE)) bq[l].push(i);
      }
    }
  }
  flood(sky, att, SX, PH);

  // --- Block light: BFS from the emitters found while gathering -------------
  for (const i of emitters) if (blk[i] > 1) bq[blk[i]].push(i);
  flood(blk, att, SX, PH);

  return { minX, minZ, sizeX, sizeZ, y0, y1, PZ, PH, sky, blk };
}

/** Bucketed BFS: decay 1 + extra opacity per step; opaque cells stop it. */
function flood(light: Uint8Array, att: Uint8Array, SX: number, PH: number): void {
  for (let L = 15; L >= 2; L--) {
    const b = buckets[L];
    const c = L - 1;
    for (let k = 0; k < b.length; k++) {
      const i = b[k];
      if (light[i] !== L) continue; // raised again after it was queued
      let n = i - SX, a = att[n], v: number;
      if (a !== OPAQUE && (v = c - a) > light[n]) { light[n] = v; if (v > 1) buckets[v].push(n); }
      n = i + SX; a = att[n];
      if (a !== OPAQUE && (v = c - a) > light[n]) { light[n] = v; if (v > 1) buckets[v].push(n); }
      n = i - PH; a = att[n];
      if (a !== OPAQUE && (v = c - a) > light[n]) { light[n] = v; if (v > 1) buckets[v].push(n); }
      n = i + PH; a = att[n];
      if (a !== OPAQUE && (v = c - a) > light[n]) { light[n] = v; if (v > 1) buckets[v].push(n); }
      n = i - 1; a = att[n];
      if (a !== OPAQUE && (v = c - a) > light[n]) { light[n] = v; if (v > 1) buckets[v].push(n); }
      n = i + 1; a = att[n];
      if (a !== OPAQUE && (v = c - a) > light[n]) { light[n] = v; if (v > 1) buckets[v].push(n); }
    }
    b.length = 0;
  }
  buckets[0].length = buckets[1].length = 0;
}
