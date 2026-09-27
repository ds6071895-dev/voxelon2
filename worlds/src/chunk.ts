import * as THREE from 'three';
import { BLOCKS } from './blocks';

export const CHUNK_X = 16;
export const CHUNK_Y = 256;
export const CHUNK_Z = 16;

export class Chunk {
  readonly cx: number;
  readonly cz: number;
  readonly data: Uint8Array;
  /** Light emitters: packed local index -> emission level. */
  readonly lights = new Map<number, number>();
  /** Highest non-air block + 1; lets the mesher skip empty sky. */
  maxY = 0;
  dirty = false;
  opaqueMesh: THREE.Mesh | null = null;
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
    this.data[idx] = id;
    if (id !== 0 && y + 1 > this.maxY) this.maxY = y + 1;
    const emission = id !== 0 ? (BLOCKS[id]?.emission ?? 0) : 0;
    if (emission > 0) this.lights.set(idx, emission);
    else if (this.lights.size > 0) this.lights.delete(idx);
  }
}
