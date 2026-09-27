// The title screen's landscape: a lake valley ringed by snow-capped peaks,
// meadows of flowers and tall grass, oak and birch groves on the shore, cherry
// trees at the water's edge and spruce climbing the slopes. It is scenery only
// (nothing is ever played here), so it is free to be as pretty as it likes.
//
// Pure: no DOM, no THREE. Deterministic per seed, centred on the origin.

import { Block } from './blocks';
import { Chunk, CHUNK_X, CHUNK_Z } from './chunk';
import { Noise2D, hash2 } from './noise';
import type { ColumnTints, Tint } from './tints';
import type { WorldBounds, WorldGenerator } from './multiverse';

export const TITLE_SEA = 62;
const HALF = 148;
const MIN_Y = 40;
const SNOW_LINE = 99;
const ROCK_LINE = 86;

type Species = 'oak' | 'birch' | 'spruce' | 'cherry' | 'bigoak';
interface Tree { x: number; z: number; y: number; species: Species; trunk: number; seed: number }

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}
function tint(hex: number): Tint {
  return [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255];
}

/** Trees sit on a jittered grid: one candidate per CELL x CELL square. */
const CELL = 5;
/** Widest canopy reach from a trunk, so neighbouring chunks stamp it too. */
const REACH = 4;

export class TitleTerrain implements WorldGenerator {
  // Scenery rides the 'parkour' kind: nothing reads a title world's kind, and
  // it keeps the multiverse's kind union about real match worlds.
  readonly kind = 'parkour' as const;
  readonly bounds: WorldBounds = { minX: -HALF, maxX: HALF, minZ: -HALF, maxZ: HALF };
  readonly minY = MIN_Y;
  readonly maxY = 200;
  private readonly base: Noise2D;
  private readonly detail: Noise2D;
  private readonly ridge: Noise2D;
  private readonly shore: Noise2D;
  private readonly meadow: Noise2D;
  private readonly forest: Noise2D;
  private readonly heights = new Map<number, number>();
  private readonly tintCache: ColumnTints;

  constructor(readonly seed: number) {
    this.base = new Noise2D(seed ^ 0x51a7);
    this.detail = new Noise2D(seed ^ 0x2bd1);
    this.ridge = new Noise2D(seed ^ 0x7e11);
    this.shore = new Noise2D(seed ^ 0x3c05);
    this.meadow = new Noise2D(seed ^ 0x6f2a);
    this.forest = new Noise2D(seed ^ 0x1d88);
    this.tintCache = { grass: tint(0x6bb54a), foliage: tint(0x4fa532), water: tint(0x3a88d8) };
  }

  /** How strongly the lake basin carves this column (0 dry, 1 open water). */
  private lakeness(x: number, z: number): number {
    const r = Math.hypot(x, z * 1.2);
    const lobe = this.shore.fbm(x / 26, z / 26, 2) * 7;
    return smoothstep(26 + lobe, 13 + lobe, r);
  }

  /** Terrain surface height (the y of the top solid block). */
  height(x: number, z: number): number {
    const key = (x + 1024) * 4096 + (z + 1024);
    const cached = this.heights.get(key);
    if (cached !== undefined) return cached;
    const r = Math.hypot(x, z * 1.1);
    // Rolling meadow floor.
    let h = 67 + this.base.fbm(x / 80, z / 80, 3) * 6 + this.detail.noise(x / 18, z / 18) * 1.6;
    // Hills rise toward the rim of the valley...
    h += smoothstep(24, 60, r) * (7 + this.base.fbm(x / 40 + 9, z / 40, 2) * 6);
    // ...then the peaks: a ridged multifractal, eroded into shoulders.
    // Broad massifs with sharp crests: a ridged field for the spine, a soft
    // one for the shoulders, so every peak does not come out a cone.
    const rn = 1 - Math.abs(this.ridge.fbm(x / 62, z / 62, 4));
    const mass = .5 + .5 * this.base.fbm(x / 90 - 17, z / 90 + 5, 2);
    const peaks = smoothstep(48, 108, r);
    h += peaks * (8 + mass * 18 + rn * rn * 36 + this.ridge.noise(x / 11, z / 11) * 2.5);
    // The lake: dug below sea level, shallow at the rim.
    const lake = this.lakeness(x, z);
    h = h * (1 - lake) + (TITLE_SEA - 6 + this.detail.noise(x / 9, z / 9) * 2) * lake;
    const y = Math.max(MIN_Y + 2, Math.round(h));
    if (this.heights.size > 120_000) this.heights.clear();
    this.heights.set(key, y);
    return y;
  }

  private slope(x: number, z: number): number {
    const h = this.height(x, z);
    return Math.max(
      Math.abs(this.height(x + 1, z) - h), Math.abs(this.height(x - 1, z) - h),
      Math.abs(this.height(x, z + 1) - h), Math.abs(this.height(x, z - 1) - h),
    );
  }

  /** Surface block for a column, before any plant goes on top. */
  private surface(x: number, z: number, h: number): number {
    const slope = this.slope(x, z);
    if (h <= TITLE_SEA + 1 && this.lakeness(x, z) > .02) return Block.Sand;
    const jitter = (hash2(this.seed, x, z) - .5) * 6;
    if (h >= SNOW_LINE + jitter) return slope > 3 ? Block.Stone : Block.PackedSnow;
    if (h >= SNOW_LINE - 6 + jitter && slope <= 2) return Block.SnowyGrass;
    // Bare rock on anything steep, and more of it the higher the ground.
    const steep = h > 80 ? 2 : 3;
    if (slope >= steep || h >= ROCK_LINE + jitter) {
      return hash2(this.seed ^ 5, x, z) < .25 ? Block.Cobblestone : Block.Stone;
    }
    return Block.Grass;
  }

  private columnBlock(x: number, y: number, z: number, h: number, top: number): number {
    if (y > h) return y <= TITLE_SEA ? Block.Water : Block.Air;
    if (y === h) return top;
    if (top === Block.Sand) return y > h - 3 ? Block.Sand : Block.Stone;
    if (top === Block.Grass || top === Block.SnowyGrass) return y > h - 4 ? Block.Dirt : Block.Stone;
    return Block.Stone;
  }

  /** The tree rooted in grid cell (gx, gz), if one grows there. */
  private treeIn(gx: number, gz: number): Tree | null {
    const r = hash2(this.seed ^ 0x77, gx, gz);
    const x = gx * CELL + Math.floor(hash2(this.seed ^ 0x13, gx, gz) * CELL);
    const z = gz * CELL + Math.floor(hash2(this.seed ^ 0x29, gx, gz) * CELL);
    if (Math.abs(x) > HALF - REACH - 1 || Math.abs(z) > HALF - REACH - 1) return null;
    const h = this.height(x, z);
    if (h <= TITLE_SEA + 1 || this.surface(x, z, h) !== Block.Grass || this.slope(x, z) > 2) return null;
    const woods = this.forest.fbm(x / 34, z / 34, 2);
    const shore = this.lakeness(x, z) > 0 || Math.hypot(x, z * 1.2) < 34;
    if (h > ROCK_LINE - 4) return null;
    const density = h > 80 ? .5 + woods * .4 : shore ? .16 + woods * .25 : .1 + woods * .75;
    if (r > density) return null;
    const pick = hash2(this.seed ^ 0x91, gx, gz);
    let species: Species;
    if (h > 80) species = 'spruce';
    else if (shore && pick < .4) species = 'cherry';
    else if (h > 78 && pick < .6) species = 'spruce';
    else species = pick < .12 ? 'bigoak' : pick < .5 ? 'birch' : 'oak';
    const t = hash2(this.seed ^ 0x45, gx, gz);
    const trunk = species === 'spruce' ? 7 + Math.floor(t * 5) : species === 'birch' ? 5 + Math.floor(t * 3)
      : species === 'bigoak' ? 7 + Math.floor(t * 2) : 4 + Math.floor(t * 2);
    return { x, z, y: h + 1, species, trunk, seed: Math.floor(t * 1e6) };
  }

  /** Every block a tree adds, as (dx, dy, dz, block) relative to its root. */
  private treeBlocks(t: Tree, put: (x: number, y: number, z: number, b: number) => void): void {
    const leafHash = (dx: number, dy: number, dz: number) => hash2(t.seed + dy * 31, dx + 7, dz + 13);
    const log = t.species === 'birch' ? Block.BirchLog : t.species === 'spruce' ? Block.SpruceLog
      : t.species === 'cherry' ? Block.CherryLog : Block.OakLog;
    const leaves = t.species === 'birch' ? Block.BirchLeaves : t.species === 'spruce' ? Block.SpruceLeaves
      : t.species === 'cherry' ? Block.CherryLeaves : Block.Leaves;
    const top = t.trunk;
    if (t.species === 'spruce') {
      // A cone of rings, each a little narrower, with a spike on top.
      for (let dy = 2; dy <= top + 1; dy++) {
        const fromTop = top + 1 - dy;
        const radius = fromTop === 0 ? 0 : Math.min(3, 1 + Math.floor(fromTop / 2) - (fromTop % 2 === 0 ? 1 : 0));
        for (let dx = -radius; dx <= radius; dx++)
          for (let dz = -radius; dz <= radius; dz++) {
            if (Math.abs(dx) + Math.abs(dz) > radius + (radius > 1 ? 1 : 0)) continue;
            put(dx, dy, dz, leaves);
          }
      }
      put(0, top + 2, 0, leaves);
    } else if (t.species === 'cherry' || t.species === 'bigoak') {
      // A wide, flattened crown on a trunk that forks into two boughs.
      const wide = t.species === 'cherry' ? 3 : 3.4;
      for (let dy = top - 2; dy <= top + 1; dy++) {
        const layer = dy - top;
        const radius = layer === 1 ? wide - 1.4 : layer === -2 ? wide - .8 : wide;
        const r = Math.ceil(radius);
        for (let dx = -r; dx <= r; dx++)
          for (let dz = -r; dz <= r; dz++) {
            const d = Math.hypot(dx, dz);
            if (d > radius + .2 || (d > radius - .8 && leafHash(dx, dy, dz) < .45)) continue;
            put(dx, dy, dz, leaves);
          }
      }
      if (t.species === 'cherry') {
        // Petals drift down around the trunk.
        for (let i = 0; i < 3; i++) {
          const a = leafHash(i, 0, 1) * Math.PI * 2, d = 1.5 + leafHash(i, 1, 0) * 2;
          const dx = Math.round(Math.cos(a) * d), dz = Math.round(Math.sin(a) * d);
          put(dx, top - 3, dz, leaves);
        }
      }
      put(1, top - 1, 0, log); put(-1, top - 1, 1, log);
    } else {
      // Oak / birch: the classic two wide layers and two narrow ones.
      for (let dy = top - 2; dy <= top + 1; dy++) {
        const r = dy <= top - 1 ? 2 : 1;
        for (let dx = -r; dx <= r; dx++)
          for (let dz = -r; dz <= r; dz++) {
            const corner = Math.abs(dx) === r && Math.abs(dz) === r;
            if (corner && (dy === top + 1 || leafHash(dx, dy, dz) < .55)) continue;
            put(dx, dy, dz, leaves);
          }
      }
    }
    for (let dy = 0; dy < top; dy++) put(0, dy, 0, log);
  }

  /** Grass, flowers and the odd boulder standing on a column, if any. */
  private plantOn(x: number, z: number, h: number, top: number): number {
    if (top !== Block.Grass || h <= TITLE_SEA) return Block.Air;
    const r = hash2(this.seed ^ 0xabc, x, z);
    const bloom = this.meadow.fbm(x / 16, z / 16, 2);
    if (bloom > .22 && r < .32) return bloom > .38 && r < .16 ? Block.Poppy : Block.Dandelion;
    if (r < .3) return Block.TallGrass;
    if (bloom < -.35 && r > .985) return Block.Poppy;
    return Block.Air;
  }

  blockAt(x: number, y: number, z: number): number {
    const bx = Math.floor(x), by = Math.floor(y), bz = Math.floor(z);
    if (bx < -HALF || bx >= HALF || bz < -HALF || bz >= HALF || by < MIN_Y || by > this.maxY) return Block.Air;
    const h = this.height(bx, bz), top = this.surface(bx, bz, h);
    const ground = this.columnBlock(bx, by, bz, h, top);
    if (ground !== Block.Air) return ground;
    let found: number = Block.Air;
    const g0x = Math.floor((bx - REACH) / CELL), g1x = Math.floor((bx + REACH) / CELL);
    const g0z = Math.floor((bz - REACH) / CELL), g1z = Math.floor((bz + REACH) / CELL);
    for (let gx = g0x; gx <= g1x && found === Block.Air; gx++)
      for (let gz = g0z; gz <= g1z && found === Block.Air; gz++) {
        const t = this.treeIn(gx, gz);
        if (t) this.treeBlocks(t, (dx, dy, dz, b) => {
          if (t.x + dx === bx && t.y + dy === by && t.z + dz === bz) found = b;
        });
      }
    if (found !== Block.Air) return found;
    return by === h + 1 ? this.plantOn(bx, bz, h, top) : Block.Air;
  }

  fill(chunk: Chunk): void {
    const ox = chunk.cx * CHUNK_X, oz = chunk.cz * CHUNK_Z, b = this.bounds;
    if (ox >= b.maxX || ox + CHUNK_X <= b.minX || oz >= b.maxZ || oz + CHUNK_Z <= b.minZ) return;
    for (let lx = 0; lx < CHUNK_X; lx++) {
      const wx = ox + lx;
      if (wx < b.minX || wx >= b.maxX) continue;
      for (let lz = 0; lz < CHUNK_Z; lz++) {
        const wz = oz + lz;
        if (wz < b.minZ || wz >= b.maxZ) continue;
        const h = this.height(wx, wz), top = this.surface(wx, wz, h);
        // Only as deep as a neighbouring face could ever show.
        const low = Math.min(h, this.height(wx + 1, wz), this.height(wx - 1, wz),
          this.height(wx, wz + 1), this.height(wx, wz - 1));
        for (let y = Math.max(MIN_Y, low - 2); y <= Math.max(h, TITLE_SEA); y++) {
          const block = this.columnBlock(wx, y, wz, h, top);
          if (block !== Block.Air) chunk.set(lx, y, lz, block);
        }
        const plant = this.plantOn(wx, wz, h, top);
        if (plant !== Block.Air) chunk.set(lx, h + 1, lz, plant);
      }
    }
    // Trees whose crowns reach into this chunk, stamped over the plants.
    const g0x = Math.floor((ox - REACH) / CELL), g1x = Math.floor((ox + CHUNK_X + REACH) / CELL);
    const g0z = Math.floor((oz - REACH) / CELL), g1z = Math.floor((oz + CHUNK_Z + REACH) / CELL);
    for (let gx = g0x; gx <= g1x; gx++)
      for (let gz = g0z; gz <= g1z; gz++) {
        const t = this.treeIn(gx, gz);
        if (!t) continue;
        this.treeBlocks(t, (dx, dy, dz, block) => {
          const lx = t.x + dx - ox, lz = t.z + dz - oz;
          if (lx < 0 || lx >= CHUNK_X || lz < 0 || lz >= CHUNK_Z) return;
          const y = t.y + dy, here = chunk.get(lx, y, lz);
          // Logs win over leaves; leaves never overwrite ground.
          if (here === Block.Air || here === Block.TallGrass || here === Block.Dandelion || here === Block.Poppy ||
            (block !== Block.Leaves && block !== Block.BirchLeaves && block !== Block.SpruceLeaves && block !== Block.CherryLeaves &&
              (here === Block.Leaves || here === Block.BirchLeaves || here === Block.SpruceLeaves || here === Block.CherryLeaves)))
            chunk.set(lx, y, lz, block);
        });
      }
  }

  tints(): ColumnTints { return this.tintCache; }
}
