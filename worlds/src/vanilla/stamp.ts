// A 16-bit block canvas for authoring the vanilla venues (pillars, the city,
// party arenas), packed into per-column runs once built. Same model as the
// Bedwars Mason, with ids up to BLOCK_ID_LIMIT and caller-chosen bounds.

import { Block } from '../blocks';

export interface StampBounds { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number }
/** Packed, read-only venue: what a VenueGenerator stamps from. */
export interface VenueStamp { readonly bounds: StampBounds; get(x: number, y: number, z: number): number }

export class Canvas {
  readonly W: number; readonly D: number; readonly H: number;
  private readonly cells: Uint16Array;
  constructor(readonly b: StampBounds) {
    this.W = b.maxX - b.minX + 1; this.D = b.maxZ - b.minZ + 1; this.H = b.maxY - b.minY + 1;
    this.cells = new Uint16Array(this.W * this.D * this.H);
  }
  inside(x: number, y: number, z: number): boolean {
    const b = this.b;
    return x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ && y >= b.minY && y <= b.maxY;
  }
  private index(x: number, y: number, z: number): number {
    return ((z - this.b.minZ) * this.W + x - this.b.minX) * this.H + y - this.b.minY;
  }
  set(x: number, y: number, z: number, block: number): void {
    if (this.inside(x, y, z)) this.cells[this.index(x, y, z)] = block;
  }
  get(x: number, y: number, z: number): number {
    return this.inside(x, y, z) ? this.cells[this.index(x, y, z)] : Block.Air;
  }
  /** Write only into air. */
  add(x: number, y: number, z: number, block: number): void {
    if (this.get(x, y, z) === Block.Air) this.set(x, y, z, block);
  }
  /** Inclusive box, corners in any order. */
  fill(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, block: number): void {
    for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++)
      for (let z = Math.min(z0, z1); z <= Math.max(z0, z1); z++)
        for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) this.set(x, y, z, block);
  }
  /** Freeze into column runs [y0, y1, block]. */
  pack(): VenueStamp {
    const { W, D, H } = this, cols = W * D;
    const starts = new Uint32Array(cols + 1), runs: number[] = [];
    for (let c = 0; c < cols; c++) {
      starts[c] = runs.length;
      for (let y = 0; y < H;) {
        const v = this.cells[c * H + y];
        if (!v) { y++; continue; }
        let end = y + 1;
        while (end < H && this.cells[c * H + end] === v) end++;
        runs.push(y, end, v);
        y = end;
      }
    }
    starts[cols] = runs.length;
    const data = new Uint16Array(runs), b = { ...this.b };
    return Object.freeze({
      bounds: b,
      get(x: number, y: number, z: number): number {
        if (x < b.minX || x > b.maxX || z < b.minZ || z > b.maxZ || y < b.minY || y > b.maxY) return Block.Air;
        const c = (z - b.minZ) * W + x - b.minX, ry = y - b.minY;
        for (let i = starts[c]; i < starts[c + 1]; i += 3) {
          if (ry < data[i]) break;
          if (ry < data[i + 1]) return data[i + 2];
        }
        return Block.Air;
      },
    });
  }
}
