import * as THREE from 'three';
import { BLOCKS } from './blocks';

export const CHUNK_X = 16;
const CHUNK_Y = 256;
export const CHUNK_Z = 16;

export class Chunk {
  readonly cx: number;
  readonly cz: number;
  readonly data: Uint8Array;
  /** Light emitters: packed local index -> emission level. */
  readonly lights = new Map<number, number>();
  /** Highest non-air block + 1; lets the mesher skip empty sky. */
  maxY = 0;
  /** Lowest non-air block (256 while empty); bounds the light solve below. */
  minY = 256;
  /** Number of non-air cells in each horizontal layer. */
  private readonly layerCounts = new Uint16Array(CHUNK_Y);
  /** True after meshing, including an empty or water-only chunk. */
  meshed = false;
  /** The mesh is out of date (geometry only; see `relight`). */
  dirty = false;
  /** `light` no longer matches the blocks around it: re-solve before meshing. */
  relight = true;
  /** Light the mesh was built from, over this chunk plus a one-cell border
   *  (18 x 18 columns, y in [lightLo, lightHi)), packed sky << 4 | block.
   *  World patches it in place when an edit nearby changes some of it. */
  light: Uint8Array | null = null;
  lightLo = 0;
  lightHi = 0;
  opaqueMesh: THREE.Mesh | null = null;
  cutoutMesh: THREE.Mesh | null = null;
  waterMesh: THREE.Mesh | null = null;

  constructor(cx: number, cz: number) {
    this.cx = cx;
    this.cz = cz;
    this.data = new Uint8Array(CHUNK_X * CHUNK_Y * CHUNK_Z);
  }

  static key(cx: number, cz: number): string {
    return cx + ',' + cz;
  }

  /** Local coords: x,z in [0,16), y in [0,256). */
  get(x: number, y: number, z: number): number {
    if (y < 0 || y >= CHUNK_Y) return 0;
    return this.data[(((x << 4) | z) << 8) | y];
  }

  set(x: number, y: number, z: number, id: number): void {
    if (y < 0 || y >= CHUNK_Y) return;
    const idx = (((x << 4) | z) << 8) | y;
    const old = this.data[idx];
    if (old === id) return;
    this.data[idx] = id;
    if (old !== 0) this.layerCounts[y]--;
    if (id !== 0) this.layerCounts[y]++;
    if (id !== 0) {
      if (y + 1 > this.maxY) this.maxY = y + 1;
      if (y < this.minY) this.minY = y;
    } else if (old !== 0) {
      if (y + 1 === this.maxY) {
        while (this.maxY > 0 && this.layerCounts[this.maxY - 1] === 0) this.maxY--;
      }
      if (y === this.minY) {
        while (this.minY < CHUNK_Y && this.layerCounts[this.minY] === 0) this.minY++;
      }
    }
    const emission = id !== 0 ? (BLOCKS[id]?.emission ?? 0) : 0;
    if (emission > 0) this.lights.set(idx, emission);
    else if (this.lights.size > 0) this.lights.delete(idx);
  }
}
