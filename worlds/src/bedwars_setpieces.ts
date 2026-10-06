// The Bedwars maps' deterministic voxel stamps. No renderer or world state.
// Two themes share one layout: four rotated island bases, four diamond
// islands on the diagonals and a middle island with four emerald wells.
import { Block } from './blocks';

export const BW_Y = 96;
export const BW_MIN_Y = 55;
export const BW_MAX_Y = 125;
export const BW_VOID_Y = 40;
export const BW_BOUNDS = Object.freeze({ minX: -96, maxX: 96, minZ: -96, maxZ: 96 });
export type BwTheme = 'garden' | 'frost';
/** Team wool, also used for each base's roof and banners. */
export const BW_TEAM_WOOL = [Block.TeamWoolA, Block.TeamWoolB, Block.TeamWoolC, Block.TeamWoolD] as const;

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


/** A write in some local frame. */
type Put = (u: number, y: number, w: number, block: number) => void;
type Get = (u: number, y: number, w: number) => number;
const INWARD = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;
/** World cell of a base's local cell (u toward the middle, w across). The
 *  same formula drives the map metadata, so blocks and spawns always agree. */
export function baseCell(team: number, distance: number, u: number, w: number): { x: number; z: number } {
  const [ix, iz] = INWARD[team];
  return { x: -ix * distance + ix * u - iz * w, z: -iz * distance + iz * u + ix * w };
}
function frame(m: Mason, team: number, distance: number): { put: Put; get: Get; add: Put } {
  const at = (u: number, w: number) => baseCell(team, distance, u, w);
  return {
    put: (u, y, w, b) => { const c = at(u, w); m.put(c.x, y, c.z, b); },
    add: (u, y, w, b) => { const c = at(u, w); m.add(c.x, y, c.z, b); },
    get: (u, y, w) => { const c = at(u, w); return m.get(c.x, y, c.z); },
  };
}
/** A mirrored frame around (cx, cz): local quadrant writes land in all four,
 *  or in one (sx, sz) quadrant. */
function mirrored(m: Mason, cx: number, cz: number, sx: number, sz: number): { put: Put; get: Get; add: Put } {
  return {
    put: (u, y, w, b) => m.put(cx + sx * u, y, cz + sz * w, b),
    add: (u, y, w, b) => m.add(cx + sx * u, y, cz + sz * w, b),
    get: (u, y, w) => m.get(cx + sx * u, y, cz + sz * w),
  };
}

interface IslandStyle {
  top: number; soil: number; rock: number; deep: number; band: number; speck: number;
  /** Hanging from the rim (vines, icicles). */
  drape: number;
  /** Crystal clusters under the island. */
  crystal: number; crystalTip: number;
}
const GARDEN_ISLAND: IslandStyle = {
  top: Block.Grass, soil: Block.Dirt, rock: Block.Stone, deep: Block.Basalt, band: Block.ManorStoneBrick, speck: Block.MossyVaultBrick,
  drape: Block.ParkourVine, crystal: Block.ParkourCrystalBlock, crystalTip: Block.ParkourCrystal,
};
const FROST_ISLAND: IslandStyle = {
  top: Block.SnowyGrass, soil: Block.Dirt, rock: Block.Stone, deep: Block.OpalBrick, band: Block.Cobblestone, speck: Block.PackedSnow,
  drape: Block.RuneGlass, crystal: Block.RuneGlass, crystalTip: Block.PrismLamp,
};

/** A floating island in a local frame: a rounded-square top with terraced
 *  rims, an underside that tapers into hanging spires, strata bands, roots
 *  and a crystal seam. Everything is keyed to local coords, so rotated
 *  copies are identical. */
function island(f: { put: Put; get: Get; add: Put }, rx: number, rz: number, depth: number, s: IslandStyle): void {
  for (let u = -rx; u <= rx; u++) for (let w = -rz; w <= rz; w++) {
    const ax = Math.abs(u) / rx, az = Math.abs(w) / rz;
    const d = (ax ** 4 + az ** 4) ** .25;
    const notch = (hash(Math.abs(u), Math.abs(w), 17) % 11) === 0 ? .07 : 0;
    if (d > 1 - notch) continue;
    const terrace = d > .94 ? 2 : d > .86 ? 1 : 0;
    const top = BW_Y - terrace;
    // A lumpy, spiky underside: some columns hang much lower than others.
    const spike = hash(u, w, 5) % 9 === 0 ? 6 + hash(u, w, 6) % 7 : 0;
    const bottom = BW_Y - Math.max(4, Math.round(depth * (1 - d ** 1.65)) + 4 + Math.round(spike * (1 - d)));
    for (let y = bottom; y <= top; y++) {
      const band = BW_Y - y;
      const stone = band > depth * .69 ? s.deep
        : band % 7 === 0 ? s.band
          : hash(u, w, y) % 13 === 0 ? s.speck : s.rock;
      f.put(u, y, w, y === top ? s.top : y >= top - 2 ? s.soil : stone);
    }
    if (d > .82 && hash(u, w, 29) % 9 === 0) {
      for (let y = top - 1; y >= top - 5 - hash(u, w) % 6; y--) f.add(u + Math.sign(u), y, w, s.drape);
    }
  }
  // Roots through the rock, and a mineral seam that breaks out underneath.
  for (const [u, w] of [[-3, -2], [3, 3], [-2, 4]]) {
    const low = BW_Y - depth + 1;
    for (let y = BW_Y - 5; y >= low; y--) {
      const bend = Math.floor((BW_Y - y) / 7) % 2;
      f.put(u + bend, y, w, Block.OakLog);
    }
    f.add(u, low - 1, w, s.drape);
  }
  for (const [u, w] of [[-Math.floor(rx * .63), 1], [Math.floor(rx * .57), -Math.floor(rz * .48)], [Math.floor(rx * .2), Math.floor(rz * .55)]]) {
    let low = BW_Y;
    while (low > BW_MIN_Y && f.get(u, low - 1, w)) low--;
    for (let y = low; y >= low - 4; y--) f.put(u, y, w, s.crystal);
    f.put(u, low - 5, w, s.crystalTip);
  }
}

function tree(put: Put, u: number, w: number, kind: 'cherry' | 'birch' | 'spruce', height = 6): void {
  if (kind === 'spruce') {
    for (let y = 97; y < 97 + height; y++) put(u, y, w, Block.SpruceLog);
    // Stacked rings that narrow toward a snowy tip.
    for (let ring = 0; ring < height - 1; ring++) {
      const y = 99 + ring, r = Math.max(1, Math.round((height - 1 - ring) * .55));
      for (let x = -r; x <= r; x++) for (let z = -r; z <= r; z++)
        if (Math.abs(x) + Math.abs(z) <= r + (ring % 2) && !(x === 0 && z === 0)) put(u + x, y, w + z, Block.SpruceLeaves);
    }
    put(u, 97 + height, w, Block.SpruceLeaves); put(u, 98 + height, w, Block.PackedSnow);
    return;
  }
  const leaf = kind === 'cherry' ? Block.CherryLeaves : Block.BirchLeaves;
  for (let y = 97; y < 97 + height; y++) put(u, y, w, kind === 'cherry' ? Block.CherryLog : Block.BirchLog);
  for (const s of [-1, 1]) { put(u + s, 99 + height - 4, w, Block.OakLog); put(u + s, 100 + height - 4, w, Block.OakLog); }
  for (let dy = -2; dy <= 2; dy++) {
    const r = dy === 2 ? 1 : dy === -2 ? 2 : 3;
    for (let x = -r; x <= r; x++) for (let z = -r; z <= r; z++)
      if (Math.abs(x) + Math.abs(z) <= r + 1 && !(x === 0 && z === 0 && dy < 0)) put(u + x, 96 + height + dy, w + z, leaf);
  }
}

function lantern(put: Put, u: number, w: number, light: number = Block.ManorLantern): void {
  put(u, 97, w, Block.ManorStoneBrick);
  put(u, 98, w, Block.ManorGardenPost);
  put(u, 99, w, Block.ManorGardenPost);
  put(u, 100, w, light);
}

// ── Garden ───────────────────────────────────────────────────────────────
function gardenBase(m: Mason, team: number, D: number): void {
  const f = frame(m, team, D), { put, get } = f;
  const fill = (u0: number, u1: number, y0: number, y1: number, w0: number, w1: number, b: number): void => {
    for (let u = Math.min(u0, u1); u <= Math.max(u0, u1); u++) for (let w = Math.min(w0, w1); w <= Math.max(w0, w1); w++)
      for (let y = y0; y <= y1; y++) put(u, y, w, b);
  };
  const roof = BW_TEAM_WOOL[team];
  island(f, 14, 16, 29, GARDEN_ISLAND);
  // Reinforced promenade; clipped corners keep the organic island edge.
  for (let u = -12; u <= 12; u++) for (let w = -13; w <= 13; w++) {
    if (Math.abs(w) > 11 && (u < -9 || u > 9)) continue;
    if (!get(u, 95, w)) continue;
    put(u, 95, w, limestone);
    const path = u <= -2 || Math.abs(w) <= 3 || (u >= 2 && u <= 5) || Math.abs(w) === 10;
    put(u, 96, w, path ? ((Math.abs(u) + Math.abs(w)) % 7 === 0 ? Block.ManorMossyPaving : paving) : Block.Grass);
  }
  // Inset courtyard medallion: a generous, flat defense apron around the bed.
  fill(2, 10, 96, 96, -5, 5, trim);
  for (let u = 2; u <= 10; u++) for (const w of [-5, 5]) put(u, 96, w, Block.ManorBronzeTile);
  for (let w = -5; w <= 5; w++) for (const u of [2, 10]) put(u, 96, w, Block.ManorBronzeTile);
  // A team-coloured runner leads from the hall to the bed.
  for (let u = 3; u <= 9; u++) put(u, 96, 0, roof);
  // The hall: three open arcades; every service faces them.
  fill(-11, -2, 96, 96, -11, 11, Block.ManorBoards);
  fill(-11, -11, 97, 102, -11, 11, limestone);
  for (const w of [-11, 11]) fill(-11, -2, 97, 102, w, w, limestone);
  for (const u of [-11, -2]) for (const w of [-11, -4, 4, 11]) {
    put(u, 97, w, Block.ManorStoneBrick);
    fill(u, u, 98, 101, w, w, timber);
    put(u, 102, w, trim);
  }
  for (const w of [-8, -7, -6, 6, 7, 8]) {
    put(-11, 99, w, Block.ManorWindow); put(-11, 100, w, Block.ManorWindow);
    put(-10, 98, w, Block.ManorMarbleSlab);
  }
  for (const w of [-9, -5, -2, 2, 5, 9]) fill(-10, -10, 99, 100, w, w, Block.ManorPanel);
  for (const w of [-11, 11]) for (const u of [-8, -7, -6]) { put(u, 99, w, Block.ManorWindow); put(u, 100, w, Block.ManorWindow); }
  fill(-11, -2, 102, 102, -11, 11, timber);
  fill(-10, -3, 102, 102, -10, 10, Block.ManorBoards);
  for (const w of [-10, -5, -3, 3, 5, 10]) put(-2, 101, w, limestone);
  // Layered hip roof in the team's colour with ivory eaves and a gilded ridge.
  fill(-12, -1, 103, 103, -12, 12, trim);
  for (let tier = 0; tier < 5; tier++) fill(-12 + tier, -1 - tier, 104 + tier, 104 + tier, -12 + tier, 12 - tier, roof);
  fill(-7, -6, 109, 109, -8, 8, Block.ManorRidge);
  for (const w of [-8, 8]) { put(-7, 110, w, Block.ManorGilt); put(-6, 110, w, Block.ManorGilt); }
  // The forge on the centre line: hearth, chimney and a floor grate the
  // resources pop out of, with brick cheeks on both sides.
  fill(-10, -9, 98, 111, -1, 1, Block.ManorChimney);
  fill(-11, -8, 112, 112, -2, 2, Block.ManorStoneBrick);
  fill(-10, -9, 113, 113, -1, 1, Block.ManorChimney);
  put(-9, 97, 0, Block.ManorFurnace);
  for (const w of [-1, 1]) { put(-9, 97, w, Block.EmberBrick); put(-9, 98, w, Block.ManorStoneBrick); }
  for (let u = -8; u <= -6; u++) for (let w = -1; w <= 1; w++) put(u, 96, w, Block.ClockworkGrate);
  for (const w of [-2, 2]) { put(-8, 97, w, Block.ManorStoneBrick); put(-8, 98, w, Block.ManorLantern); }
  // Furnished kiosks either side. Counters stay behind the interaction spots.
  for (const w of [-7, 7]) {
    fill(-9, -9, 97, 99, w - 2, w + 2, w < 0 ? Block.ManorBookshelf : Block.ManorCuriosShelf);
    fill(-7, -7, 97, 97, w - 1, w + 1, Block.ManorPanel);
    for (const ww of [w - 2, w + 2]) { fill(-7, -7, 97, 100, ww, ww, Block.ManorGardenPost); put(-6, 100, ww, Block.ManorLantern); }
    fill(-9, -6, 101, 101, w - 2, w + 2, roof);
    for (const ww of [w - 1, w + 1]) put(-6, 101, ww, Block.ManorLinen);
  }
  // Garden wings: the bed keeps open sightlines to the middle.
  for (const w of [-10, 10]) {
    for (let u = 4; u <= 8; u++) { put(u, 97, w, Block.ManorStoneBrick); put(u, 98, w, u % 2 ? Block.ManorFlowerPot : Block.ManorHedge); }
    tree(put, 9, w, 'cherry', 6);
    lantern(put, 1, w);
    for (const u of [2, 3, 5]) put(u, 97, w + Math.sign(w) * 2, u % 2 ? Block.Poppy : Block.Dandelion);
  }
  // Low balustrades and crowned piers break at the approaches.
  for (const w of [-13, 13]) for (let u = -8; u <= 8; u++) {
    if (u >= 1 && u <= 5) continue;
    if (u % 4 === 0) { put(u, 97, w, limestone); put(u, 98, w, Block.ManorLantern); }
    else put(u, 97, w, Block.ManorMarbleSlab);
  }
  // Team banners flank the courtyard gate.
  for (const w of [-4, 4]) { put(11, 97, w, limestone); for (let y = 98; y <= 101; y++) put(11, y, w, Block.ManorGardenPost); put(11, 102, w, Block.ManorGilt); put(11, 101, w - Math.sign(w), roof); put(11, 100, w - Math.sign(w), roof); }
  for (let u = 11; u <= 14; u++) for (let w = -2; w <= 2; w++) { put(u, 95, w, Block.ManorStoneBrick); put(u, 96, w, paving); }
  // The bed's physical proxy: two half-height cells along the centre line,
  // hidden by the bed model.
  put(6, 97, 0, Block.ManorMarbleSlab);
  put(7, 97, 0, Block.ManorMarbleSlab);
}

function gardenDiamond(m: Mason, cx: number, cz: number, sx: number, sz: number): void {
  const f = mirrored(m, cx, cz, sx, sz), { put } = f;
  island(f, 6, 7, 17, GARDEN_ISLAND);
  for (let u = -4; u <= 4; u++) for (let w = -5; w <= 5; w++) {
    put(u, 95, w, limestone);
    put(u, 96, w, Math.abs(u) === 4 || Math.abs(w) === 5 ? trim : paving);
  }
  for (let u = -1; u <= 1; u++) for (let w = -1; w <= 1; w++) put(u, 96, w, Block.PrismBrick);
  put(0, 96, 0, Block.JadeMosaic);
  // An open four-pier pavilion with wide routes through every side.
  for (const u of [-3, 3]) for (const w of [-4, 4]) {
    put(u, 97, w, Block.ManorStoneBrick);
    for (let y = 98; y <= 101; y++) put(u, y, w, Block.IvoryColumn);
    put(u, 102, w, Block.ManorGilt);
  }
  for (let u = -4; u <= 4; u++) for (const w of [-4, 4]) put(u, 103, w, trim);
  for (let w = -4; w <= 4; w++) for (const u of [-3, 3]) put(u, 103, w, trim);
  for (let w = -4; w <= 4; w += 2) for (let u = -4; u <= 4; u++) put(u, 104, w, timber);
  for (const u of [-4, 4]) for (const w of [-4, 4]) {
    put(u, 104, w, Block.BirchLeaves);
    put(u, 103, w + Math.sign(w), Block.ParkourVine);
    put(u, 98, w, Block.ManorLantern);
  }
}

function gardenCenter(m: Mason, emerald: number): void {
  const all = mirrored(m, 0, 0, 1, 1);
  // The middle is symmetric about its own centre cell in all four quadrants.
  const q: { put: Put; get: Get; add: Put } = {
    put: (u, y, w, b) => { for (const sx of [-1, 1]) for (const sz of [-1, 1]) m.put(sx * u, y, sz * w, b); },
    add: (u, y, w, b) => { for (const sx of [-1, 1]) for (const sz of [-1, 1]) m.add(sx * u, y, sz * w, b); },
    get: (u, y, w) => all.get(u, y, w),
  };
  island(q, 17, 17, 36, GARDEN_ISLAND);
  for (let x = -15; x <= 15; x++) for (let z = -15; z <= 15; z++) {
    const r = Math.hypot(x, z);
    if (!m.get(x, 95, z)) continue;
    m.put(x, 95, z, limestone);
    const path = Math.abs(x) <= 3 || Math.abs(z) <= 3 || (r >= 8 && r <= 11) || r <= 6;
    m.put(x, 96, z, path ? (r > 8 && r < 9.5 ? Block.ManorBronzeTile : paving) : Block.Grass);
  }
  for (let x = -5; x <= 5; x++) for (let z = -5; z <= 5; z++)
    if (Math.abs(x) + Math.abs(z) <= 7) m.put(x, 96, z, (x + z) % 2 ? Block.PearlTile : Block.JadeMosaic);
  // Eight buttressed supports form an open octagonal arcade.
  const pillars = [[-6, -3], [-6, 3], [6, -3], [6, 3], [-3, -6], [3, -6], [-3, 6], [3, 6]];
  for (const [x, z] of pillars) {
    m.put(x, 97, z, Block.ManorStoneBrick);
    m.fill(x, x, 98, 104, z, z, Block.IvoryColumn);
    m.put(x, 105, z, Block.ManorGilt);
    m.put(x, 106, z, trim);
  }
  for (let x = -7; x <= 7; x++) for (let z = -7; z <= 7; z++) {
    const r = Math.hypot(x, z);
    if (r >= 5.5 && r <= 7.6) { m.put(x, 106, z, limestone); m.put(x, 107, z, trim); if ((Math.abs(x) + Math.abs(z)) % 3 === 0) m.put(x, 108, z, Block.ManorBronzeTile); }
  }
  // Copper ribs rise to a lantern cupola; the airy dome keeps sky visible.
  for (let level = 0; level <= 7; level++) {
    const r = Math.round(6 * Math.sqrt(1 - (level / 8) ** 2));
    for (const s of [-1, 1]) for (const [x, z] of [[s * r, 0], [0, s * r]]) {
      m.put(x, 108 + level, z, Block.ManorVerdigris);
      if (level % 2 === 0) m.put(x, 109 + level, z, Block.ManorVerdigris);
    }
    const qd = Math.round(r * .707);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) m.put(sx * qd, 108 + level, sz * qd, Block.ManorBronzeTile);
  }
  for (let x = -2; x <= 2; x++) for (let z = -2; z <= 2; z++) if (Math.abs(x) + Math.abs(z) <= 3) m.put(x, 116, z, Block.ManorVerdigris);
  m.fill(-1, 1, 117, 117, -1, 1, Block.ManorGilt);
  for (const x of [-1, 1]) for (const z of [-1, 1]) m.fill(x, x, 118, 120, z, z, Block.IvoryColumn);
  m.put(0, 119, 0, Block.PrismLamp);
  m.fill(-1, 1, 121, 121, -1, 1, Block.ManorVerdigris);
  m.put(0, 122, 0, Block.ManorGilt); m.put(0, 123, 0, Block.ManorGardenPost); m.put(0, 124, 0, Block.ParkourCrystal);
  // Four emerald wells inset in the four promenades.
  for (const [x, z] of [[emerald, 0], [-emerald, 0], [0, emerald], [0, -emerald]]) {
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) m.put(x + dx, 96, z + dz, Block.JadeMosaic);
    m.put(x, 96, z, Block.PrismLamp);
  }
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const put: Put = (u, y, w, b) => m.put(sx * u, y, sz * w, b);
    tree(put, 12, 12, 'cherry', 7);
    lantern(put, 5, 13); lantern(put, 13, 5);
    for (let i = 7; i <= 10; i++) {
      put(i, 97, 14, Block.ManorStoneBrick); put(i, 98, 14, Block.ManorHedge);
      put(14, 97, i, Block.ManorStoneBrick); put(14, 98, i, Block.ManorHedge);
    }
    for (const [x, z] of [[6, 10], [9, 12], [12, 9]]) put(x, 97, z, Block.Dandelion);
  }
  for (let a = -2; a <= 2; a++) for (let d = 14; d <= 18; d++) for (const s of [-1, 1]) {
    m.put(s * d, 95, a, limestone); m.put(s * d, 96, a, paving);
    m.put(a, 95, s * d, limestone); m.put(a, 96, s * d, paving);
  }
}

// ── Frost ────────────────────────────────────────────────────────────────
function frostBase(m: Mason, team: number, D: number): void {
  const f = frame(m, team, D), { put, get } = f;
  const fill = (u0: number, u1: number, y0: number, y1: number, w0: number, w1: number, b: number): void => {
    for (let u = Math.min(u0, u1); u <= Math.max(u0, u1); u++) for (let w = Math.min(w0, w1); w <= Math.max(w0, w1); w++)
      for (let y = y0; y <= y1; y++) put(u, y, w, b);
  };
  const wool = BW_TEAM_WOOL[team], wall = Block.Cobblestone, dressed = Block.ManorStoneBrick;
  island(f, 15, 16, 30, FROST_ISLAND);
  // Swept courtyard: stone flags where people walk, snow elsewhere.
  for (let u = -13; u <= 13; u++) for (let w = -14; w <= 14; w++) {
    if (!get(u, 95, w)) continue;
    const path = u <= -2 || Math.abs(w) <= 2 || Math.abs(w) === 9 || (u >= 2 && u <= 10 && Math.abs(w) <= 5);
    put(u, 96, w, path ? ((u * 3 + w * 5) % 11 === 0 ? Block.Cobblestone : Block.ManorPaving) : Block.SnowyGrass);
  }
  for (let u = 2; u <= 10; u++) for (let w = -5; w <= 5; w++) if (Math.abs(w) === 5 || u === 2 || u === 10) put(u, 96, w, Block.OpalBrick);
  for (let u = 3; u <= 9; u++) put(u, 96, 0, wool);
  // The keep: thick stone walls, slit windows, a crenellated parapet and two
  // corner towers with pointed team-coloured caps.
  fill(-12, -2, 96, 96, -11, 11, Block.ManorBoards);
  fill(-12, -12, 97, 103, -11, 11, wall);
  for (const w of [-11, 11]) fill(-12, -2, 97, 103, w, w, wall);
  for (let u = -12; u <= -2; u++) for (const w of [-11, 11]) if ((u + 12) % 3 === 1) put(u, 99, w, Block.RuneGlass);
  for (let w = -10; w <= 10; w++) if (w % 3 === 0) put(-12, 99, w, Block.RuneGlass);
  for (const w of [-11, -4, 4, 11]) fill(-2, -2, 97, 103, w, w, dressed);
  fill(-12, -2, 104, 104, -11, 11, dressed);
  fill(-11, -3, 104, 104, -10, 10, Block.SpruceLog);
  for (let u = -12; u <= -2; u++) for (const w of [-11, 11]) if (u % 2 === 0) put(u, 105, w, dressed);
  for (let w = -11; w <= 11; w++) if (w % 2 === 0) { put(-12, 105, w, dressed); put(-2, 105, w, dressed); }
  // Pitched team roof over the hall.
  for (let tier = 0; tier < 4; tier++) fill(-11 + tier, -3 - tier, 105 + tier, 105 + tier, -10, 10, tier === 3 ? Block.PackedSnow : wool);
  for (const w of [-11, 11]) {
    fill(-13, -11, 97, 108, w - 1 * Math.sign(w), w + Math.sign(w), dressed);
    for (let u = -13; u <= -11; u++) for (const ww of [w - Math.sign(w), w + Math.sign(w)]) if ((u + ww) % 2 === 0) put(u, 109, ww, dressed);
    for (let lvl = 0; lvl < 4; lvl++) {
      const r = 2 - Math.floor(lvl / 2);
      for (let u = -12 - r; u <= -12 + r; u++) for (let ww = w - r; ww <= w + r; ww++) put(u, 110 + lvl, ww, lvl === 3 ? Block.ManorGilt : wool);
    }
    put(-12, 99, w + Math.sign(w), Block.SoulLantern);
  }
  // The forge on the centre line: a stone hearth with a chimney and a grate.
  fill(-11, -10, 97, 112, -1, 1, dressed);
  put(-10, 97, 0, Block.ManorFurnace);
  fill(-10, -10, 98, 98, -1, 1, Block.EmberBrick);
  for (let u = -8; u <= -6; u++) for (let w = -1; w <= 1; w++) put(u, 96, w, Block.ClockworkGrate);
  for (const w of [-2, 2]) { put(-9, 97, w, dressed); put(-9, 98, w, Block.EmberBrazier); }
  // Stalls either side, under spruce awnings.
  for (const w of [-7, 7]) {
    fill(-10, -10, 97, 99, w - 2, w + 2, w < 0 ? Block.ManorBookshelf : Block.ManorCuriosShelf);
    fill(-7, -7, 97, 97, w - 1, w + 1, Block.SpruceLog);
    for (const ww of [w - 2, w + 2]) { fill(-7, -7, 97, 100, ww, ww, Block.SpruceLog); put(-6, 100, ww, Block.SoulLantern); }
    fill(-10, -6, 101, 101, w - 2, w + 2, wool);
  }
  // Snowy pines, rocks and lamp posts in the yard.
  for (const w of [-11, 11]) { tree(put, 8, w, 'spruce', 7); tree(put, 3, w + Math.sign(w), 'spruce', 5); }
  for (const w of [-9, 9]) { put(12, 97, w, Block.Cobblestone); put(12, 98, w, Block.ManorGardenPost); put(12, 99, w, Block.ManorGardenPost); put(12, 100, w, Block.SoulLantern); }
  for (const [u, w] of [[5, -12], [-1, 13], [10, 7], [10, -7]]) { put(u, 97, w, Block.Cobblestone); put(u, 98, w, Block.PackedSnow); }
  // Team banners at the gate.
  for (const w of [-3, 3]) { fill(12, 12, 97, 101, w, w, Block.SpruceLog); put(12, 101, w - Math.sign(w), wool); put(12, 100, w - Math.sign(w), wool); put(12, 99, w - Math.sign(w), wool); }
  for (let u = 13; u <= 16; u++) for (let w = -2; w <= 2; w++) { put(u, 95, w, Block.Cobblestone); put(u, 96, w, Block.ManorPaving); }
  put(6, 97, 0, Block.ManorMarbleSlab);
  put(7, 97, 0, Block.ManorMarbleSlab);
}

function frostDiamond(m: Mason, cx: number, cz: number, sx: number, sz: number): void {
  const f = mirrored(m, cx, cz, sx, sz), { put } = f;
  island(f, 6, 6, 18, FROST_ISLAND);
  for (let u = -4; u <= 4; u++) for (let w = -4; w <= 4; w++) put(u, 96, w, Math.max(Math.abs(u), Math.abs(w)) === 4 ? Block.OpalBrick : Block.PackedSnow);
  for (let u = -1; u <= 1; u++) for (let w = -1; w <= 1; w++) put(u, 96, w, Block.RuneGlass);
  put(0, 96, 0, Block.PrismLamp);
  // Four ice spires lean in over the generator.
  for (const u of [-3, 3]) for (const w of [-3, 3]) {
    for (let y = 97; y <= 103; y++) put(u - Math.sign(u) * Math.floor((y - 97) / 4), y, w - Math.sign(w) * Math.floor((y - 97) / 4), y > 101 ? Block.RuneGlass : Block.OpalBrick);
    put(u - Math.sign(u), 104, w - Math.sign(w), Block.PrismLamp);
  }
  for (const [u, w] of [[-4, 0], [4, 0], [0, -4], [0, 4]]) put(u, 97, w, Block.SoulLantern);
}

function frostCenter(m: Mason, emerald: number): void {
  const q: { put: Put; get: Get; add: Put } = {
    put: (u, y, w, b) => { for (const sx of [-1, 1]) for (const sz of [-1, 1]) m.put(sx * u, y, sz * w, b); },
    add: (u, y, w, b) => { for (const sx of [-1, 1]) for (const sz of [-1, 1]) m.add(sx * u, y, sz * w, b); },
    get: (u, y, w) => m.get(u, y, w),
  };
  island(q, 16, 16, 38, FROST_ISLAND);
  for (let x = -15; x <= 15; x++) for (let z = -15; z <= 15; z++) {
    if (!m.get(x, 95, z)) continue;
    const r = Math.hypot(x, z);
    const path = Math.abs(x) <= 2 || Math.abs(z) <= 2 || (r >= 7 && r <= 9.5);
    m.put(x, 96, z, path ? (r > 7.5 && r < 8.5 ? Block.OpalBrick : Block.ManorPaving) : Block.SnowyGrass);
  }
  // A ring wall with four gates and a frozen beacon tower in the middle.
  for (let x = -13; x <= 13; x++) for (let z = -13; z <= 13; z++) {
    const r = Math.hypot(x, z);
    if (r < 12.4 || r > 13.4 || Math.abs(x) <= 3 || Math.abs(z) <= 3) continue;
    m.put(x, 97, z, Block.Cobblestone); m.put(x, 98, z, Block.ManorStoneBrick);
    if ((x + z) % 2 === 0) m.put(x, 99, z, Block.PackedSnow);
  }
  for (let y = 97; y <= 112; y++) for (let x = -2; x <= 2; x++) for (let z = -2; z <= 2; z++) {
    const edge = Math.max(Math.abs(x), Math.abs(z)) === 2;
    if (!edge) continue;
    const corner = Math.abs(x) === 2 && Math.abs(z) === 2;
    const door = y <= 99 && (x === 0 || z === 0);
    if (door) continue;
    m.put(x, y, z, corner ? Block.ManorStoneBrick : y % 4 === 1 ? Block.RuneGlass : Block.Cobblestone);
  }
  for (let x = -3; x <= 3; x++) for (let z = -3; z <= 3; z++) m.put(x, 113, z, Block.ManorStoneBrick);
  for (let lvl = 0; lvl < 5; lvl++) for (let x = -2 + Math.floor(lvl / 2); x <= 2 - Math.floor(lvl / 2); x++)
    for (let z = -2 + Math.floor(lvl / 2); z <= 2 - Math.floor(lvl / 2); z++) m.put(x, 114 + lvl, z, lvl % 2 ? Block.RuneGlass : Block.OpalBrick);
  m.put(0, 119, 0, Block.PrismLamp); m.put(0, 120, 0, Block.ParkourCrystal);
  for (const [x, z] of [[emerald, 0], [-emerald, 0], [0, emerald], [0, -emerald]]) {
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) m.put(x + dx, 96, z + dz, Block.JadeMosaic);
    m.put(x, 96, z, Block.PrismLamp);
  }
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const put: Put = (u, y, w, b) => m.put(sx * u, y, sz * w, b);
    tree(put, 6, 11, 'spruce', 6); tree(put, 11, 6, 'spruce', 6);
    put(5, 97, 5, Block.Cobblestone); put(5, 98, 5, Block.SoulLantern);
  }
  for (let a = -2; a <= 2; a++) for (let d = 14; d <= 18; d++) for (const s of [-1, 1]) {
    m.put(s * d, 95, a, Block.Cobblestone); m.put(s * d, 96, a, Block.ManorPaving);
    m.put(a, 95, s * d, Block.Cobblestone); m.put(a, 96, s * d, Block.ManorPaving);
  }
}

/** Called once per map by bedwars_map. The dense construction buffer is discarded. */
export function buildBedwarsMap(theme: BwTheme, baseDistance: number, diamond: number, emerald: number): BedwarsStamp {
  const mason = new Mason();
  for (let team = 0; team < 4; team++) (theme === 'frost' ? frostBase : gardenBase)(mason, team, baseDistance);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) (theme === 'frost' ? frostDiamond : gardenDiamond)(mason, sx * diamond, sz * diamond, sx, sz);
  (theme === 'frost' ? frostCenter : gardenCenter)(mason, emerald);
  return mason.pack();
}
