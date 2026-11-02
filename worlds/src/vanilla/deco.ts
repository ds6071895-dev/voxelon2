// The plugin's arena building kit (party/build/Deco.java), ported method for
// method so CityBuilder and the party arenas build the same blocks from the
// same seed (it uses java.util.Random through JavaRandom). Writes into a
// 16-bit Canvas; `finishShapes` then connects fences, panes and walls like the
// plugin's Shapes pass.

import { Block } from '../blocks';
import { VMETA } from './blocks';
import { connMask } from './block_states';
import { stateId } from './blocks';
import { JavaRandom } from './java_random';
import { mc } from './mc_materials';
import type { Canvas } from './stamp';

export const N = 'north', E = 'east', S = 'south', W = 'west';
const SIDES = [N, E, S, W];
const STEP: [number, number, number][] = [[0, 0, -1], [1, 0, 0], [0, 0, 1], [-1, 0, 0]];
export function step(side: string): [number, number, number] { const i = SIDES.indexOf(side); return i < 0 ? [0, 0, 0] : STEP[i]; }
export function opposite(side: string): string { return side === N ? S : side === S ? N : side === E ? W : E; }
export function clockwise(side: string): string { return side === N ? E : side === E ? S : side === S ? W : N; }

/** Material names are Minecraft's, lower-case ("stone_bricks"). */
export class Deco {
  readonly random: JavaRandom;
  constructor(readonly sink: Canvas, readonly ox = 0, readonly oy = 0, readonly oz = 0, seed: number | bigint = 0) {
    this.random = new JavaRandom(seed);
  }

  set(x: number, y: number, z: number, material: string): void { this.sink.set(this.ox + x, this.oy + y, this.oz + z, mc(material)); }
  data(x: number, y: number, z: number, data: string): void { this.sink.set(this.ox + x, this.oy + y, this.oz + z, mc(data)); }
  air(x: number, y: number, z: number): void { this.sink.set(this.ox + x, this.oy + y, this.oz + z, Block.Air); }
  getId(x: number, y: number, z: number): number { return this.sink.get(this.ox + x, this.oy + y, this.oz + z); }
  empty(x: number, y: number, z: number): boolean { return this.getId(x, y, z) === Block.Air; }

  fill(x1: number, y1: number, z1: number, x2: number, y2: number, z2: number, material: string): void {
    for (let x = Math.min(x1, x2); x <= Math.max(x1, x2); x++)
      for (let y = Math.min(y1, y2); y <= Math.max(y1, y2); y++)
        for (let z = Math.min(z1, z2); z <= Math.max(z1, z2); z++) this.set(x, y, z, material);
  }
  fillData(x1: number, y1: number, z1: number, x2: number, y2: number, z2: number, data: string): void { this.fill(x1, y1, z1, x2, y2, z2, data); }
  walls(x1: number, y1: number, z1: number, x2: number, y2: number, z2: number, material: string): void {
    const ax = Math.min(x1, x2), bx = Math.max(x1, x2), az = Math.min(z1, z2), bz = Math.max(z1, z2);
    for (let y = Math.min(y1, y2); y <= Math.max(y1, y2); y++) {
      for (let x = ax; x <= bx; x++) { this.set(x, y, az, material); this.set(x, y, bz, material); }
      for (let z = az; z <= bz; z++) { this.set(ax, y, z, material); this.set(bx, y, z, material); }
    }
  }
  disc(cx: number, y: number, cz: number, r: number, material: string): void {
    const R = Math.ceil(r);
    for (let x = -R; x <= R; x++) for (let z = -R; z <= R; z++) if (x * x + z * z <= (r + .5) * (r + .5)) this.set(cx + x, y, cz + z, material);
  }
  ring(cx: number, y: number, cz: number, inner: number, outer: number, material: string): void {
    const R = Math.ceil(outer);
    for (let x = -R; x <= R; x++) for (let z = -R; z <= R; z++) {
      const d = Math.sqrt(x * x + z * z);
      if (d <= outer + .5 && d > inner - .5) this.set(cx + x, y, cz + z, material);
    }
  }
  static inDisc(x: number, z: number, r: number): boolean { return x * x + z * z <= (r + .5) * (r + .5); }

  stairs(x: number, y: number, z: number, stairs: string, facing: string, top: boolean): void { this.data(x, y, z, `${stairs}[facing=${facing},half=${top ? 'top' : 'bottom'}]`); }
  slab(x: number, y: number, z: number, slab: string, top: boolean): void { this.data(x, y, z, `${slab}[type=${top ? 'top' : 'bottom'}]`); }
  log(x: number, y: number, z: number, log: string, axis: string): void { this.data(x, y, z, `${log}[axis=${axis}]`); }
  column(x: number, y: number, z: number, height: number, material: string): void { for (let i = 0; i < height; i++) this.set(x, y + i, z, material); }
  lantern(x: number, y: number, z: number, hanging: boolean): void { this.data(x, y, z, `lantern[hanging=${hanging}]`); }
  soulLantern(x: number, y: number, z: number, hanging: boolean): void { this.lantern(x, y, z, hanging); }
  hangingLantern(x: number, top: number, bottom: number, z: number, soul: boolean): void {
    for (let y = top; y >= bottom; y--) this.set(x, y, z, 'iron_bars');
    if (soul) this.soulLantern(x, bottom - 1, z, true); else this.lantern(x, bottom - 1, z, true);
  }
  gate(x: number, y: number, z: number, _gate: string, _facing: string, open: boolean): void { if (!open) this.set(x, y, z, 'oak_fence'); else this.air(x, y, z); }
  door(x: number, y: number, z: number, door: string, facing: string, _hingeRight: boolean, open: boolean): void {
    this.data(x, y, z, `${door}[facing=${facing},open=${open},half=lower]`);
    this.data(x, y + 1, z, `${door}[facing=${facing},open=${open},half=upper]`);
  }
  doubleDoor(x: number, y: number, z: number, door: string, facing: string): void {
    this.door(x, y, z, door, facing, false, false);
    const r = step(clockwise(facing));
    this.door(x + r[0], y, z + r[2], door, facing, true, false);
  }
  trapdoor(x: number, y: number, z: number, trapdoor: string, facing: string, top: boolean, open: boolean): void {
    this.data(x, y, z, `${trapdoor}[facing=${facing},half=${top ? 'top' : 'bottom'},open=${open}]`);
  }
  ladder(x: number, y: number, z: number, facing: string): void { this.data(x, y, z, `ladder[facing=${facing}]`); }
  banner(x: number, y: number, z: number, color: string, _rotation: number): void { this.set(x, y, z, `${color}_wool`); }
  wallBanner(x: number, y: number, z: number, color: string, _facing: string): void { this.set(x, y, z, `${color}_carpet`); }
  candles(x: number, y: number, z: number): void { this.set(x, y, z, 'torch'); }
  campfire(x: number, y: number, z: number): void { this.set(x, y, z, 'magma_block'); }
  leaves(x: number, y: number, z: number, leaves: string): void { this.set(x, y, z, leaves); }
  tallPlant(x: number, y: number, z: number): void { this.set(x, y, z, 'short_grass'); }
  pot(x: number, y: number, z: number, plant: string | null): void { this.set(x, y, z, plant === 'red_tulip' || plant === 'poppy' ? 'poppy' : 'dandelion'); }
  barrel(x: number, y: number, z: number, _facing: string): void { this.set(x, y, z, 'barrel'); }
  bell(x: number, y: number, z: number): void { this.set(x, y, z, 'bell'); }

  lampPost(x: number, y: number, z: number, height: number, fence: string, soul: boolean): void {
    for (let i = 0; i < height; i++) this.set(x, y + i, z, fence);
    if (soul) this.soulLantern(x, y + height, z, false); else this.lantern(x, y + height, z, false);
  }
  streetLamp(x: number, y: number, z: number, height: number, post: string, fence: string, arm: string): void {
    this.column(x, y, z, height, post);
    const s = step(arm);
    this.set(x + s[0], y + height - 1, z + s[2], fence);
    this.lantern(x + s[0], y + height - 2, z + s[2], true);
  }
  tree(x: number, y: number, z: number, trunk: number, r: number, log: string, leaves: string): void {
    const top = y + trunk, R = Math.ceil(r);
    for (let dx = -R; dx <= R; dx++) for (let dy = -R + 1; dy <= R; dy++) for (let dz = -R; dz <= R; dz++) {
      const d = Math.sqrt(dx * dx + dy * dy * 1.6 + dz * dz);
      const edge = d > r - .7;
      if (d <= r + .3 && !(Math.abs(dx) === R && Math.abs(dz) === R) && (!edge || this.random.nextDouble() > .12)) this.leaves(x + dx, top + dy - 1, z + dz, leaves);
    }
    for (let i = 0; i < trunk; i++) this.log(x, y + i, z, log, 'y');
  }
  spruce(x: number, y: number, z: number, height: number, log: string, leaves: string): void {
    for (let i = 0; i < height; i++) this.log(x, y + i, z, log, 'y');
    const top = y + height;
    for (let ly = y + 2; ly <= top; ly++) {
      const fromTop = top - ly;
      const r = Math.min(3.2, .6 + fromTop * .55) - (fromTop % 2 === 1 ? .9 : 0);
      const R = Math.ceil(r);
      for (let dx = -R; dx <= R; dx++) for (let dz = -R; dz <= R; dz++) if ((dx !== 0 || dz !== 0) && dx * dx + dz * dz <= r * r + .3) this.leaves(x + dx, ly, z + dz, leaves);
    }
    this.leaves(x, top, z, leaves); this.leaves(x, top + 1, z, leaves);
  }
  gableRoof(x1: number, z1: number, x2: number, z2: number, y: number, stairs: string, ridge: string, gable: string | null, alongX: boolean): void {
    const ax = Math.min(x1, x2), bx = Math.max(x1, x2), az = Math.min(z1, z2), bz = Math.max(z1, z2);
    const across = alongX ? bz - az : bx - ax, half = Math.trunc(across / 2);
    for (let i = 0; i <= half; i++) {
      const ry = y + i, centre = across % 2 === 0 && i === half;
      if (alongX) {
        for (let x = ax; x <= bx; x++) {
          if (centre) this.set(x, ry, az + i, ridge);
          else { this.stairs(x, ry, az + i, stairs, S, false); this.stairs(x, ry, bz - i, stairs, N, false); }
        }
        if (gable) for (let z = az + i + 1; z <= bz - i - 1; z++) { this.set(ax + 1, ry, z, gable); this.set(bx - 1, ry, z, gable); }
      } else {
        for (let z = az; z <= bz; z++) {
          if (centre) this.set(ax + i, ry, z, ridge);
          else { this.stairs(ax + i, ry, z, stairs, E, false); this.stairs(bx - i, ry, z, stairs, W, false); }
        }
        if (gable) for (let x = ax + i + 1; x <= bx - i - 1; x++) { this.set(x, ry, az + 1, gable); this.set(x, ry, bz - 1, gable); }
      }
    }
  }
  hipRoof(x1: number, z1: number, x2: number, z2: number, y: number, stairs: string, top: string): void {
    let ax = Math.min(x1, x2), bx = Math.max(x1, x2), az = Math.min(z1, z2), bz = Math.max(z1, z2), level = 0;
    while (ax <= bx && az <= bz) {
      const ry = y + level;
      if (ax === bx || az === bz) { this.fill(ax, ry, az, bx, ry, bz, top); break; }
      for (let x = ax; x <= bx; x++) { this.stairs(x, ry, az, stairs, S, false); this.stairs(x, ry, bz, stairs, N, false); }
      for (let z = az + 1; z < bz; z++) { this.stairs(ax, ry, z, stairs, E, false); this.stairs(bx, ry, z, stairs, W, false); }
      ax++; bx--; az++; bz--; level++;
      if (ax > bx || az > bz) break;
    }
  }
  bleachers(toward: string, front: number, from: number, to: number, y: number, rows: number, stairs: string, block: string): void {
    const back = step(opposite(toward));
    for (let row = 0; row < rows; row++) for (let a = Math.min(from, to); a <= Math.max(from, to); a++) {
      const x = back[0] !== 0 ? front + back[0] * row : a, z = back[0] !== 0 ? a : front + back[2] * row;
      for (let fy = y; fy < y + row; fy++) this.set(x, fy, z, block);
      this.stairs(x, y + row, z, stairs, opposite(toward), false);
    }
  }
  stall(x: number, y: number, z: number, front: string, colorA: string, colorB: string, fence: string): void {
    const f = step(front), side = step(clockwise(front));
    for (let a = -2; a <= 2; a += 4) for (let b = 0; b <= 2; b += 2) this.column(x + side[0] * a - f[0] * b, y, z + side[2] * a - f[2] * b, 3, fence);
    for (let a = -2; a <= 2; a++) for (let b = -1; b <= 3; b++) {
      const px = x + side[0] * a - f[0] * b, pz = z + side[2] * a - f[2] * b;
      this.data(px, y + 3, pz, `${((a % 2) + 2) % 2 === 0 ? colorA : colorB}_wool`);
    }
    for (let a = -1; a <= 1; a++) {
      const px = x + side[0] * a, pz = z + side[2] * a;
      if (a === 0) this.barrel(px, y, pz, front); else this.data(px, y, pz, 'spruce_planks');
    }
    this.pot(x + side[0], y + 1, z + side[2], this.random.nextBoolean() ? 'red_tulip' : 'cornflower');
    this.data(x - side[0], y + 1, z - side[2], 'lantern[hanging=false]');
  }
  planter(x1: number, y: number, z1: number, x2: number, z2: number, trapdoor: string): void {
    const ax = Math.min(x1, x2), bx = Math.max(x1, x2), az = Math.min(z1, z2), bz = Math.max(z1, z2);
    const flowers = ['poppy', 'dandelion', 'cornflower', 'allium', 'oxeye_daisy', 'azure_bluet', 'red_tulip', 'pink_tulip'];
    for (let x = ax; x <= bx; x++) for (let z = az; z <= bz; z++) {
      if (x === ax || x === bx || z === az || z === bz) {
        const facing = x === ax ? W : x === bx ? E : z === az ? N : S;
        this.trapdoor(x, y, z, trapdoor, facing, false, true);
        continue;
      }
      this.set(x, y - 1, z, 'grass_block');
      const fl = flowers[this.random.nextInt(flowers.length)];
      this.set(x, y, z, fl === 'poppy' || fl === 'red_tulip' || fl === 'pink_tulip' || fl === 'allium' ? 'poppy' : 'dandelion');
    }
  }
  fountain(cx: number, y: number, cz: number, r: number): void {
    for (let x = -r; x <= r; x++) for (let z = -r; z <= r; z++) {
      const d = Math.sqrt(x * x + z * z);
      if (d > r + .5) continue;
      this.set(cx + x, y - 1, cz + z, 'stone_bricks');
      if (d > r - .5) this.set(cx + x, y, cz + z, 'stone_bricks'); else this.data(cx + x, y, cz + z, 'water[level=0]');
    }
    this.set(cx, y, cz, 'chiseled_stone_bricks');
    this.set(cx, y + 1, cz, 'stone_brick_wall');
    this.set(cx, y + 2, cz, 'stone_brick_wall');
    this.set(cx, y + 3, cz, 'sea_lantern');
  }
  stringLights(x1: number, z1: number, x2: number, z2: number, y: number, fence: string, every: number): void {
    const len = Math.max(Math.abs(x2 - x1), Math.abs(z2 - z1));
    for (let i = 0; i <= len; i++) {
      const x = x1 + (x2 === x1 ? 0 : Math.sign(x2 - x1) * i), z = z1 + (z2 === z1 ? 0 : Math.sign(z2 - z1) * i);
      this.set(x, y, z, fence);
      if (i > 0 && i < len && i % every === 0) this.lantern(x, y - 1, z, true);
    }
  }
  flag(x: number, y: number, z: number, height: number, color: string, flagSide: string): void {
    this.column(x, y, z, height, 'spruce_fence');
    const s = step(flagSide);
    this.data(x + s[0], y + height - 1, z + s[2], `${color}_wool`);
    this.data(x + s[0] * 2, y + height - 1, z + s[2] * 2, `${color}_wool`);
    this.data(x + s[0], y + height - 2, z + s[2], `${color}_wool`);
    this.set(x, y + height, z, 'spruce_fence');
    this.data(x, y + height + 1, z, 'lantern[hanging=false]');
  }
  underside(cx: number, y: number, cz: number, r: number, depth: number, ...materials: string[]): void {
    for (let i = 1; i <= depth; i++) {
      const radius = r * (1 - Math.pow(i / (depth + 1), 1.4));
      if (radius < .6) break;
      const m = materials[Math.min(materials.length - 1, Math.trunc(i * materials.length / (depth + 1)))];
      const R = Math.ceil(radius);
      for (let x = -R; x <= R; x++) for (let z = -R; z <= R; z++) {
        const d = Math.sqrt(x * x + z * z) + this.random.nextDouble() * .9;
        if (d <= radius) this.set(cx + x, y - i, cz + z, m);
      }
    }
  }
  crates(x: number, y: number, z: number): void {
    this.barrel(x, y, z, this.random.nextBoolean() ? 'up' : N);
    this.barrel(x + 1, y, z, E);
    this.set(x, y, z + 1, 'spruce_planks');
    this.barrel(x, y + 1, z, 'up');
    this.data(x, y + 2, z, 'lantern[hanging=false]');
  }
}

/** Connect every fence, pane, wall and bar to its neighbours (the Shapes pass). */
export function finishShapes(c: Canvas): void {
  const b = c.b;
  const get = (x: number, y: number, z: number) => c.get(x, y, z);
  for (let x = b.minX; x <= b.maxX; x++) for (let z = b.minZ; z <= b.maxZ; z++) for (let y = b.minY; y <= b.maxY; y++) {
    const id = c.get(x, y, z);
    if (id < 1024) continue;
    const fam = VMETA[id]?.family;
    if (!fam || !/(_fence|_wall|glass_pane|iron_bars)$/.test(fam)) continue;
    const want = stateId(fam, { conn: connMask(fam, get, x, y, z) });
    if (want !== undefined && want !== id) c.set(x, y, z, want);
  }
}
