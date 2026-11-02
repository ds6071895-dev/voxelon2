// Shared Party Games set pieces (source party/games/Buildings.java): timber
// houses and a well, ported method for method onto the Deco kit.

import { Deco, E, N, S, W, clockwise, step } from '../vanilla/deco';
import { mc } from '../vanilla/mc_materials';

export interface HouseStyle { frame: string; wall: string; roofStairs: string; roofTop: string; door: string; base: string }
export const STYLE = {
  TUDOR: { frame: 'dark_oak_log', wall: 'white_terracotta', roofStairs: 'dark_oak_stairs', roofTop: 'dark_oak_planks', door: 'dark_oak_door', base: 'cobblestone' },
  SPRUCE: { frame: 'spruce_log', wall: 'spruce_planks', roofStairs: 'deepslate_tile_stairs', roofTop: 'deepslate_tiles', door: 'spruce_door', base: 'stone_bricks' },
  BRICK: { frame: 'stripped_oak_log', wall: 'bricks', roofStairs: 'spruce_stairs', roofTop: 'spruce_planks', door: 'oak_door', base: 'stone_bricks' },
  SAND: { frame: 'stripped_birch_log', wall: 'smooth_sandstone', roofStairs: 'cut_sandstone_slab', roofTop: 'cut_sandstone', door: 'birch_door', base: 'sandstone' },
  BARN: { frame: 'stripped_dark_oak_log', wall: 'red_terracotta', roofStairs: 'dark_oak_stairs', roofTop: 'dark_oak_planks', door: 'spruce_door', base: 'cobblestone' },
} satisfies Record<string, HouseStyle>;

/** A house with its floor at y; (x0, z0) is the minimum corner, w by dd outside. */
export function house(d: Deco, x0: number, y: number, z0: number, w: number, dd: number, height: number, front: string, s: HouseStyle): void {
  const x1 = x0 + w - 1, z1 = z0 + dd - 1;
  d.fill(x0, y, z0, x1, y, z1, s.base);
  const top = y + height;
  for (let yy = y + 1; yy <= top; yy++) for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) {
    const edgeX = x === x0 || x === x1, edgeZ = z === z0 || z === z1;
    if (!edgeX && !edgeZ) continue;
    const corner = edgeX && edgeZ;
    const post = corner || (edgeZ && (x - x0) % 3 === 0) || (edgeX && (z - z0) % 3 === 0);
    if (post) d.log(x, yy, z, s.frame, 'y');
    else if (yy === top) d.log(x, yy, z, s.frame, edgeZ ? 'x' : 'z');
    else if ((yy === y + 2 || yy === y + 3) && height >= 4) d.set(x, yy, z, 'glass_pane');
    else d.set(x, yy, z, s.wall);
  }
  const dx = Math.trunc((x0 + x1) / 2), dz = Math.trunc((z0 + z1) / 2);
  const doorX = front === E ? x1 : front === W ? x0 : dx;
  const doorZ = front === S ? z1 : front === N ? z0 : dz;
  d.door(doorX, y + 1, doorZ, s.door, front, false, false);
  if (height >= 4) d.set(doorX, y + 3, doorZ, s.wall);
  const f = step(front), side = step(clockwise(front));
  const lx = doorX + side[0] + f[0], lz = doorZ + side[2] + f[2];
  d.data(lx, y + 3, lz, s.frame === 'dark_oak_log' ? 'dark_oak_fence' : 'spruce_fence');
  d.lantern(lx, y + 2, lz, true);
  if (d.getId(doorX + side[0], y + 3, doorZ + side[2]) === mc('glass_pane')) d.set(doorX + side[0], y + 3, doorZ + side[2], s.wall);
  const alongX = w >= dd;
  if (s.roofStairs.endsWith('_slab')) {
    d.fill(x0, top + 1, z0, x1, top + 1, z1, s.roofTop);
    for (let x = x0; x <= x1; x++) { d.slab(x, top + 2, z0, s.roofStairs, false); d.slab(x, top + 2, z1, s.roofStairs, false); }
    for (let z = z0 + 1; z < z1; z++) { d.slab(x0, top + 2, z, s.roofStairs, false); d.slab(x1, top + 2, z, s.roofStairs, false); }
    return;
  }
  d.gableRoof(x0 - 1, z0 - 1, x1 + 1, z1 + 1, top, s.roofStairs, s.roofTop, s.wall, alongX);
  const cx = alongX ? x1 - 1 : (front === E ? x0 + 1 : x1 - 1);
  const cz = alongX ? (front === S ? z0 + 1 : z1 - 1) : z1 - 1;
  const across = alongX ? dd + 2 : w + 2;
  const peak = top + Math.trunc(across / 2) + 2;
  for (let yy = top + 1; yy <= peak; yy++) d.set(cx, yy, cz, 'bricks');
  d.campfire(cx, peak + 1, cz);
}

/** A stone well with a little roof on fence posts. */
export function well(d: Deco, cx: number, y: number, cz: number): void {
  for (let x = -2; x <= 2; x++) for (let z = -2; z <= 2; z++) {
    const rim = Math.abs(x) === 2 || Math.abs(z) === 2;
    d.set(cx + x, y, cz + z, 'cobblestone');
    if (rim) d.set(cx + x, y + 1, cz + z, 'mossy_cobblestone');
    else { d.data(cx + x, y + 1, cz + z, 'water[level=0]'); d.set(cx + x, y, cz + z, 'stone_bricks'); }
  }
  for (const [x, z] of [[-2, -2], [2, -2], [-2, 2], [2, 2]]) d.column(cx + x, y + 2, cz + z, 3, 'spruce_fence');
  d.hipRoof(cx - 3, cz - 3, cx + 3, cz + 3, y + 4, 'spruce_stairs', 'spruce_planks');
  d.set(cx, y + 6, cz, 'spruce_planks');
  d.hangingLantern(cx, y + 5, y + 5, cz, false);
}

/** Deco.noise (source build/Deco): a stable 0..1 hash of a column. */
export function noise(x: number, z: number): number {
  const M = (1n << 64n) - 1n;
  let h = (BigInt.asIntN(64, BigInt(x) * 73856093n) ^ BigInt.asIntN(64, BigInt(z) * 19349663n) ^ 0x9E3779B97F4A7C15n) & M;
  h ^= h >> 29n;
  h = (h * 0xBF58476D1CE4E5B9n) & M;
  h ^= h >> 32n;
  return Number(h >> 11n) * 2 ** -53;
}
