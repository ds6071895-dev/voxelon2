// The Bedwars map's deterministic voxel stamp. No renderer or world state.
import { Block } from './blocks';

export const BW_Y = 96;
export const BW_MIN_Y = 55;
export const BW_MAX_Y = 125;
export const BW_VOID_Y = 40;
export const BW_BOUNDS = Object.freeze({ minX: -92, maxX: 92, minZ: -65, maxZ: 65 });

const W = BW_BOUNDS.maxX - BW_BOUNDS.minX + 1;
const D = BW_BOUNDS.maxZ - BW_BOUNDS.minZ + 1;
const H = BW_MAX_Y - BW_MIN_Y + 1;
const limestone = Block.LuminousLimestone, trim = Block.PearlTile;
const timber = Block.ManorBeam, paving = Block.ManorPaving;
const hash = (x: number, z: number, salt = 0): number => {
  let n = Math.imul(x + 193, 374761393) ^ Math.imul(z + 557, 668265263) ^ salt;
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return (n ^ (n >>> 16)) >>> 0;
};

/** Compressed, private column data: callers can query but cannot mutate it. */
export interface BedwarsStamp { get(x: number, y: number, z: number): number }

class Mason {
  private cells = new Uint8Array(W * D * H);
  private index(x: number, y: number, z: number): number {
    return ((z - BW_BOUNDS.minZ) * W + x - BW_BOUNDS.minX) * H + y - BW_MIN_Y;
  }
  private inside(x: number, y: number, z: number): boolean {
    return x >= BW_BOUNDS.minX && x <= BW_BOUNDS.maxX && z >= BW_BOUNDS.minZ && z <= BW_BOUNDS.maxZ
      && y >= BW_MIN_Y && y <= BW_MAX_Y;
  }
  put(x: number, y: number, z: number, b: number): void {
    if (this.inside(x, y, z)) this.cells[this.index(x, y, z)] = b;
  }
  get(x: number, y: number, z: number): number {
    return this.inside(x, y, z) ? this.cells[this.index(x, y, z)] : Block.Air;
  }
  add(x: number, y: number, z: number, b: number): void {
    if (!this.get(x, y, z)) this.put(x, y, z, b);
  }
  fill(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, b: number): void {
    for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++)
      for (let z = Math.min(z0, z1); z <= Math.max(z0, z1); z++)
        for (let y = y0; y <= y1; y++) this.put(x, y, z, b);
  }
  pave(x: number, z: number, b = paving): void {
    if (this.get(x, BW_Y, z)) this.put(x, BW_Y, z, b);
  }
  pack(): BedwarsStamp {
    const starts = new Uint32Array(W * D + 1), runs: number[] = [];
    for (let c = 0; c < W * D; c++) {
      starts[c] = runs.length;
      for (let y = 0; y < H;) {
        const b = this.cells[c * H + y];
        if (!b) { y++; continue; }
        let end = y + 1;
        while (end < H && this.cells[c * H + end] === b) end++;
        runs.push(y, end, b);
        y = end;
      }
    }
    starts[W * D] = runs.length;
    const data = new Uint8Array(runs);
    return Object.freeze({ get(x: number, y: number, z: number): number {
      if (!Number.isInteger(x) || !Number.isInteger(y) || !Number.isInteger(z)
        || x < BW_BOUNDS.minX || x > BW_BOUNDS.maxX || z < BW_BOUNDS.minZ || z > BW_BOUNDS.maxZ
        || y < BW_MIN_Y || y > BW_MAX_Y) return Block.Air;
      const c = (z - BW_BOUNDS.minZ) * W + x - BW_BOUNDS.minX, ry = y - BW_MIN_Y;
      for (let i = starts[c]; i < starts[c + 1]; i += 3) {
        if (ry < data[i]) break;
        if (ry < data[i + 1]) return data[i + 2];
      }
      return Block.Air;
    } });
  }
}

/** Mirroring the writer, rather than its random seed, preserves every detail. */
type Put = (u: number, y: number, z: number, block: number) => void;

function island(m: Mason, cx: number, cz: number, rx: number, rz: number, depth: number,
  mirror = 1, mirrorZ = 1, quadrants = false): void {
  const put: Put = (u, y, z, b) => {
    if (quadrants) for (const sx of [-1, 1]) for (const sz of [-1, 1]) m.put(cx + sx * u, y, cz + sz * z, b);
    else m.put(cx + mirror * u, y, cz + mirrorZ * z, b);
  };
  for (let u = quadrants ? 0 : -rx + 1; u <= rx - (quadrants ? 1 : 0); u++)
    for (let z = quadrants ? 0 : -rz + 1; z <= rz - (quadrants ? 1 : 0); z++) {
    const ax = Math.abs(u - (quadrants ? 0 : .5)) / rx, az = Math.abs(z - (quadrants ? 0 : .5)) / rz;
    const d = (ax ** 4 + az ** 4) ** .25;
    const notch = ((hash(Math.abs(u), Math.abs(z), 17) % 11) === 0 ? .07 : 0);
    if (d > 1 - notch) continue;
    const terrace = d > .94 ? 2 : d > .86 ? 1 : 0;
    const top = BW_Y - terrace;
    const bottom = BW_Y - Math.max(4, Math.round(depth * (1 - d ** 1.65)) + 4);
    for (let y = bottom; y <= top; y++) {
      const band = BW_Y - y;
      const stone = band > depth * .69 ? Block.Basalt
        : band % 7 === 0 ? Block.ManorStoneBrick
          : hash(u, z, y) % 13 === 0 ? Block.MossyVaultBrick : Block.Stone;
      put(u, y, z, y === top ? Block.Grass : y >= top - 2 ? Block.Dirt : stone);
    }
    if (d > .82 && hash(u, z, 29) % 13 === 0) {
      for (let y = top - 1; y >= top - 5 - hash(u, z) % 5; y--) {
        if (quadrants) for (const sx of [-1, 1]) for (const sz of [-1, 1])
          m.add(cx + sx * (u + Math.sign(u)), y, cz + sz * z, Block.ParkourVine);
        else m.add(cx + mirror * (u + Math.sign(u)), y, cz + mirrorZ * z, Block.ParkourVine);
      }
    }
  }
  // Strata shelves, roots and mineral seams all attach to the rock above.
  for (const [u, z] of [[-3, -2], [3, 3], [-2, 4]]) {
    const low = BW_Y - depth + 1;
    for (let y = BW_Y - 5; y >= low; y--) {
      const bend = Math.floor((BW_Y - y) / 7) % 2;
      put(u + bend, y, z, Block.OakLog);
      if (y % 7 === 0) put(u + bend + 1, y, z, Block.OakLog);
    }
    put(u + (Math.floor((BW_Y - low) / 7) % 2), low - 1, z, Block.ParkourVine);
  }
  for (const [u, z] of [[-Math.floor(rx * .63), 1], [Math.floor(rx * .57), -Math.floor(rz * .48)]]) {
    let low = BW_Y;
    while (low > BW_MIN_Y && m.get(cx + mirror * u, low - 1, cz + mirrorZ * z)) low--;
    for (let y = low; y >= low - 4; y--) put(u, y, z, Block.ParkourCrystalBlock);
    put(u, low - 5, z, Block.ParkourCrystal);
    put(u + 1, low, z, Block.PrismBrick);
  }
}

function tree(put: Put, u: number, z: number, blossom = false, height = 6): void {
  const leaf = blossom ? Block.CherryLeaves : Block.BirchLeaves;
  for (let y = 97; y < 97 + height; y++) put(u, y, z, blossom ? Block.CherryLog : Block.OakLog);
  for (const s of [-1, 1]) {
    put(u + s, 99 + height - 4, z, Block.OakLog);
    put(u + s, 100 + height - 4, z, Block.OakLog);
  }
  for (let dy = -2; dy <= 2; dy++) {
    const r = dy === 2 ? 1 : dy === -2 ? 2 : 3;
    for (let x = -r; x <= r; x++) for (let zz = -r; zz <= r; zz++)
      if (Math.abs(x) + Math.abs(zz) <= r + 1 && !(x === 0 && zz === 0 && dy < 0))
        put(u + x, 96 + height + dy, z + zz, leaf);
  }
}

function lantern(put: Put, u: number, z: number): void {
  put(u, 97, z, Block.ManorStoneBrick);
  put(u, 98, z, Block.ManorGardenPost);
  put(u, 99, z, Block.ManorGardenPost);
  put(u, 100, z, Block.ManorLantern);
}

function base(m: Mason, team: 0 | 1): void {
  const side = team === 0 ? -1 : 1, cx = side * 62;
  const X = (u: number): number => cx - side * u;
  const put: Put = (u, y, z, b) => m.put(X(u), y, z, b);
  const fill = (u0: number, u1: number, y0: number, y1: number, z0: number, z1: number, b: number): void =>
    m.fill(X(u0), X(u1), y0, y1, z0, z1, b);
  const roof = team === 0 ? Block.ParkourRoofRed : Block.TeamWoolB;
  island(m, cx, 0, 14, 16, 29, -side);
  // Reinforced promenade; clipped corners retain the organic island edge.
  for (let u = -12; u <= 12; u++) for (let z = -13; z <= 13; z++) {
    if (Math.abs(z) > 11 && (u < -9 || u > 9)) continue;
    if (!m.get(X(u), 95, z)) continue;
    put(u, 95, z, limestone);
    const path = u <= -2 || Math.abs(z) <= 3 || (u >= 2 && u <= 5) || Math.abs(z) === 10;
    put(u, 96, z, path ? ((u + z) % 7 === 0 ? Block.ManorMossyPaving : paving) : Block.Grass);
  }
  // Inset courtyard medallion: a generous, flat 9 x 11 defense apron.
  fill(2, 10, 96, 96, -5, 5, trim);
  for (let u = 2; u <= 10; u++) for (const z of [-5, 5]) put(u, 96, z, Block.ManorBronzeTile);
  for (let z = -5; z <= 5; z++) for (const u of [2, 10]) put(u, 96, z, Block.ManorBronzeTile);
  // The three arcades are 3, 5 and 3 blocks wide; all services face them.
  fill(-11, -2, 96, 96, -11, 11, Block.ManorBoards);
  fill(-11, -11, 97, 102, -11, 11, limestone);
  for (const z of [-11, 11]) fill(-11, -2, 97, 102, z, z, limestone);
  for (const u of [-11, -2]) for (const z of [-11, -4, 4, 11]) {
    put(u, 97, z, Block.ManorStoneBrick);
    fill(u, u, 98, 101, z, z, timber);
    put(u, 102, z, trim);
  }
  for (const z of [-8, -7, -6, -1, 0, 1, 6, 7, 8]) {
    put(-11, 99, z, Block.ManorWindow);
    put(-11, 100, z, Block.ManorWindow);
    put(-10, 98, z, Block.ManorMarbleSlab);
  }
  for (const z of [-9, -5, -2, 2, 5, 9]) fill(-10, -10, 99, 100, z, z, Block.ManorPanel);
  for (const z of [-11, 11]) for (const u of [-8, -7, -6]) {
    put(u, 99, z, Block.ManorWindow); put(u, 100, z, Block.ManorWindow);
  }
  fill(-11, -2, 102, 102, -11, 11, timber);
  fill(-10, -3, 102, 102, -10, 10, Block.ManorBoards);
  for (const z of [-10, -5, -3, 3, 5, 10]) put(-2, 101, z, limestone);
  // Layered hip roof with warm ivory eaves and a narrow gilded ridge.
  fill(-12, -1, 103, 103, -12, 12, trim);
  for (let tier = 0; tier < 5; tier++) {
    fill(-12 + tier, -1 - tier, 104 + tier, 104 + tier, -12 + tier, 12 - tier, roof);
  }
  fill(-7, -6, 109, 109, -8, 8, Block.ManorRidge);
  for (const z of [-8, 8]) { put(-7, 110, z, Block.ManorGilt); put(-6, 110, z, Block.ManorGilt); }
  // Capped hearth chimney and real floor-level forge, not a raised marker.
  fill(-10, -9, 98, 110, -2, -1, Block.ManorChimney);
  fill(-11, -8, 111, 111, -3, 0, Block.ManorStoneBrick);
  fill(-10, -9, 112, 112, -2, -1, Block.ManorChimney);
  put(-9, 97, 0, Block.ManorFurnace);
  for (let u = -8; u <= -6; u++) for (let z = -1; z <= 1; z++) put(u, 96, z, Block.ClockworkGrate);
  // Furnished kiosks. Counters stay behind the accessible interaction spots.
  for (const z of [-7, 7]) {
    fill(-9, -9, 97, 99, z - 2, z + 2, z < 0 ? Block.ManorBookshelf : Block.ManorCuriosShelf);
    fill(-7, -7, 97, 97, z - 1, z + 1, Block.ManorPanel);
    for (const zz of [z - 2, z + 2]) {
      fill(-7, -7, 97, 100, zz, zz, Block.ManorGardenPost);
      put(-6, 100, zz, Block.ManorLantern);
    }
    fill(-9, -6, 101, 101, z - 2, z + 2, roof);
    for (const zz of [z - 1, z + 1]) put(-6, 101, zz, Block.ManorLinen);
  }
  // Garden wings: beds have completely open sightlines to the center.
  for (const z of [-10, 10]) {
    for (let u = 4; u <= 8; u++) {
      put(u, 97, z, Block.ManorStoneBrick);
      put(u, 98, z, u % 2 ? Block.ManorFlowerPot : Block.ManorHedge);
    }
    tree(put, 9, z, true, 6);
    lantern(put, 1, z);
    for (const u of [2, 3, 5]) put(u, 97, z + Math.sign(z) * 2, u % 2 ? Block.Poppy : Block.Dandelion);
  }
  // Low balustrades and crowned piers break at the diamond approaches.
  for (const z of [-13, 13]) for (let u = -8; u <= 8; u++) {
    if (u >= 1 && u <= 5) continue;
    if (u % 4 === 0) { put(u, 97, z, limestone); put(u, 98, z, Block.ManorLantern); }
    else put(u, 97, z, Block.ManorMarbleSlab);
  }
  for (let u = 11; u <= 14; u++) for (let z = -2; z <= 2; z++) {
    put(u, 95, z, Block.ManorStoneBrick); put(u, 96, z, paving);
  }
  // Thin physical bed proxy, entirely enclosed by the model's cabinet frame.
  put(6, 97, -1, Block.ManorMarbleSlab);
  put(6, 97, 0, Block.ManorMarbleSlab);
}

function diamond(m: Mason, sx: -1 | 1, sz: -1 | 1): void {
  const cx = sx * 28, cz = sz * 33;
  const put: Put = (u, y, z, b) => m.put(cx + sx * u, y, cz + sz * z, b);
  island(m, cx, cz, 6, 7, 17, sx, sz);
  for (let u = -4; u <= 4; u++) for (let z = -5; z <= 5; z++) {
    put(u, 95, z, limestone);
    put(u, 96, z, Math.abs(u) === 4 || Math.abs(z) === 5 ? trim : paving);
  }
  for (let u = -1; u <= 1; u++) for (let z = -1; z <= 1; z++) put(u, 96, z, Block.PrismBrick);
  put(0, 96, 0, Block.JadeMosaic);
  // Open four-pier garden pavilion, with 5-wide routes through every side.
  for (const u of [-3, 3]) for (const z of [-4, 4]) {
    put(u, 97, z, Block.ManorStoneBrick);
    for (let y = 98; y <= 101; y++) put(u, y, z, Block.IvoryColumn);
    put(u, 102, z, Block.ManorGilt);
  }
  for (let u = -4; u <= 4; u++) for (const z of [-4, 4]) put(u, 103, z, trim);
  for (let z = -4; z <= 4; z++) for (const u of [-3, 3]) put(u, 103, z, trim);
  for (let z = -4; z <= 4; z += 2) for (let u = -4; u <= 4; u++) put(u, 104, z, timber);
  for (const u of [-4, 4]) for (const z of [-4, 4]) {
    put(u, 104, z, Block.BirchLeaves);
    put(u, 103, z + Math.sign(z), Block.ParkourVine);
    put(u, 98, z, Block.ManorLantern);
  }
  for (let z = -1; z <= 1; z++) for (const u of [-5, 5]) {
    put(u, 95, z, limestone); put(u, 96, z, paving);
  }
}

function centerIsland(m: Mason): void {
  island(m, 0, 0, 17, 17, 36, 1, 1, true);
  // Rotationally symmetric star garden and four wide entry promenades.
  for (let x = -15; x <= 15; x++) for (let z = -15; z <= 15; z++) {
    const r = Math.hypot(x, z);
    if (r > 17 && Math.abs(x) > 3 && Math.abs(z) > 3) continue;
    if (!m.get(x, 95, z)) continue;
    m.put(x, 95, z, limestone);
    const path = Math.abs(x) <= 3 || Math.abs(z) <= 3 || (r >= 8 && r <= 11) || r <= 6;
    m.put(x, 96, z, path ? (r > 8 && r < 9.5 ? Block.ManorBronzeTile : paving) : Block.Grass);
  }
  for (let x = -5; x <= 5; x++) for (let z = -5; z <= 5; z++) {
    if (Math.abs(x) + Math.abs(z) <= 7) m.put(x, 96, z, (x + z) % 2 ? Block.PearlTile : Block.JadeMosaic);
  }
  // Eight buttressed supports form an open octagonal arcade, never a box.
  const pillars = [[-6, -3], [-6, 3], [6, -3], [6, 3], [-3, -6], [3, -6], [-3, 6], [3, 6]];
  for (const [x, z] of pillars) {
    m.put(x, 97, z, Block.ManorStoneBrick);
    m.fill(x, x, 98, 104, z, z, Block.IvoryColumn);
    m.put(x, 105, z, Block.ManorGilt);
    m.put(x, 106, z, trim);
    const ox = Math.abs(x) > Math.abs(z) ? Math.sign(x) : 0;
    const oz = ox ? 0 : Math.sign(z);
    m.put(x + ox, 97, z + oz, limestone);
    m.put(x + ox, 98, z + oz, Block.ManorMarbleSlab);
    m.put(x + ox, 102, z + oz, Block.ManorLantern);
  }
  // Ring entablature leaves an oculus underneath the astronomical crown.
  for (let x = -7; x <= 7; x++) for (let z = -7; z <= 7; z++) {
    const r = Math.hypot(x, z);
    if (r >= 5.5 && r <= 7.6) {
      m.put(x, 106, z, limestone); m.put(x, 107, z, trim);
      if ((Math.abs(x) + Math.abs(z)) % 3 === 0) m.put(x, 108, z, Block.ManorBronzeTile);
    }
  }
  // Copper ribs rise to a lantern cupola. The airy dome keeps sky visible.
  for (let level = 0; level <= 7; level++) {
    const r = Math.round(6 * Math.sqrt(1 - (level / 8) ** 2));
    for (const s of [-1, 1]) for (const [x, z] of [[s * r, 0], [0, s * r]]) {
      m.put(x, 108 + level, z, Block.ManorVerdigris);
      if (level % 2 === 0) m.put(x, 109 + level, z, Block.ManorVerdigris);
    }
    const q = Math.round(r * .707);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) m.put(sx * q, 108 + level, sz * q, Block.ManorBronzeTile);
  }
  for (let x = -2; x <= 2; x++) for (let z = -2; z <= 2; z++)
    if (Math.abs(x) + Math.abs(z) <= 3) m.put(x, 116, z, Block.ManorVerdigris);
  m.fill(-1, 1, 117, 117, -1, 1, Block.ManorGilt);
  for (const x of [-1, 1]) for (const z of [-1, 1]) m.fill(x, x, 118, 120, z, z, Block.IvoryColumn);
  m.put(0, 119, 0, Block.PrismLamp);
  m.fill(-1, 1, 121, 121, -1, 1, Block.ManorVerdigris);
  m.put(0, 122, 0, Block.ManorGilt); m.put(0, 123, 0, Block.ManorGardenPost);
  m.put(0, 124, 0, Block.ParkourCrystal);
  // Emerald wells are inset into the floor, with clear approach from outside.
  for (const x of [-10, 10]) {
    for (let dx = -1; dx <= 1; dx++) for (let z = -1; z <= 1; z++) m.put(x + dx, 96, z, Block.JadeMosaic);
    m.put(x, 96, 0, Block.PrismLamp);
  }
  const put: Put = (x, y, z, b) => m.put(x, y, z, b);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    tree(put, sx * 11, sz * 11, true, 7);
    lantern(put, sx * 5, sz * 12);
    lantern(put, sx * 12, sz * 5);
    for (let i = 7; i <= 10; i++) {
      m.put(sx * i, 97, sz * 13, Block.ManorStoneBrick);
      m.put(sx * i, 98, sz * 13, Block.ManorHedge);
      m.put(sx * 13, 97, sz * i, Block.ManorStoneBrick);
      m.put(sx * 13, 98, sz * i, Block.ManorHedge);
    }
    for (const [x, z] of [[6, 10], [9, 12], [12, 9]]) m.put(sx * x, 97, sz * z, Block.Dandelion);
  }
  for (let a = -2; a <= 2; a++) for (let d = 14; d <= 17; d++) for (const s of [-1, 1]) {
    m.put(s * d, 95, a, limestone); m.put(s * d, 96, a, paving);
    m.put(a, 95, s * d, limestone); m.put(a, 96, s * d, paving);
  }
}

/** Called once by bedwars_map. The dense construction buffer is discarded. */
export function buildBedwarsMap(): BedwarsStamp {
  const mason = new Mason();
  base(mason, 0); base(mason, 1);
  for (const sx of [-1, 1] as const) for (const sz of [-1, 1] as const) diamond(mason, sx, sz);
  centerIsland(mason);
  return mason.pack();
}
