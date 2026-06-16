// Voxel terrain: layered-noise heightmap, biome surfaces (incl. mountains),
// sea level 63, beaches, three tree species, plants/cacti, spaghetti caves,
// ravines, ore veins, bedrock floor.

import { Biome, Biomes, ColumnTints } from './biomes';
import { Block } from './blocks';
import { Chunk, CHUNK_X, CHUNK_Z } from './chunk';
import { Noise2D, Noise3D, hash2, mulberry32 } from './noise';

export const SEA_LEVEL = 63;
const TREE_MARGIN = 3; // trees up to 3 blocks outside a chunk can reach into it
const ROCK_LINE = 96;  // mountains expose bare stone above this altitude
const SNOW_LINE = 120; // mountains get snow caps above this
const MAX_HEIGHT = 235;

type Species = 'oak' | 'birch' | 'spruce';
interface Tree {
  species: Species;
  trunk: number;
}

// Vanilla-ish vein settings: [attempts/chunk, minY, maxY, veinMin, veinMax].
const ORES: [Block, number, number, number, number, number][] = [
  [Block.CoalOre, 14, 6, 124, 5, 9],
  [Block.IronOre, 10, 4, 72, 4, 8],
  [Block.GoldOre, 4, 4, 32, 4, 6],
  [Block.RedstoneOre, 6, 4, 16, 4, 8],
  [Block.DiamondOre, 2, 4, 16, 4, 7],
];

export class Terrain {
  readonly biomes: Biomes;
  private readonly seed: number;
  private readonly continental: Noise2D;
  private readonly hills: Noise2D;
  private readonly ravine: Noise2D;
  private readonly caves1: Noise3D;
  private readonly caves2: Noise3D;

  constructor(seed: number) {
    this.seed = seed;
    this.biomes = new Biomes(seed);
    this.continental = new Noise2D(seed);
    this.hills = new Noise2D(seed ^ 0x51ab);
    this.ravine = new Noise2D(seed ^ 0xaa11);
    this.caves1 = new Noise3D(seed ^ 0xcafe);
    this.caves2 = new Noise3D(seed ^ 0xbeef);
  }

  /** Surface height at world (x, z). Pure function, safe across chunks. */
  height(x: number, z: number): number {
    const base = this.continental.fbm(x * 0.004, z * 0.004, 4) * 24;
    const detail = this.hills.fbm(x * 0.02, z * 0.02, 2) * 5;
    let h = 63 + base + detail;
    // Mountains rise smoothly via the (smooth) mountain factor, so there are
    // no cliffs at biome borders. A ridged term makes the peaks jagged.
    const m = this.biomes.mountainFactor(x, z);
    if (m > 0) {
      const ridge = 1 - Math.abs(this.hills.fbm(x * 0.01, z * 0.01, 3));
      h += m * (50 + 90 * m) * (0.55 + 0.45 * ridge);
    }
    return Math.min(MAX_HEIGHT, Math.max(12, Math.round(h)));
  }

  tints(x: number, z: number): ColumnTints {
    return this.biomes.tints(x, z);
  }

  /** Biome including Ocean/Beach/Mountains, which depend on terrain height. */
  biomeWithWater(x: number, z: number, h: number): Biome {
    if (h < SEA_LEVEL - 1) return Biome.Ocean;
    if (h <= SEA_LEVEL + 1) return Biome.Beach;
    if (this.biomes.mountainFactor(x, z) > 0.45 || h >= ROCK_LINE) {
      const [t] = this.biomes.climate(x, z);
      return t < 0.45 || h >= SNOW_LINE
        ? Biome.SnowyMountains : Biome.Mountains;
    }
    return this.biomes.biomeAt(x, z);
  }

  /** Ravine carve depth below the surface at this column (0 = no ravine). */
  private ravineDepth(x: number, z: number): number {
    const rv = this.ravine.noise(x * 0.006, z * 0.006);
    const band = 0.018;
    if (Math.abs(rv) >= band) return 0;
    const f = 1 - Math.abs(rv) / band;
    return Math.floor(12 + f * 28);
  }

  private treeAt(x: number, z: number): Tree | null {
    const h = this.height(x, z);
    if (h <= SEA_LEVEL + 1 || h > 118) return null;
    // No trees on bare mountain rock. Surfaces render as bare Stone for any
    // mountain column at/above ROCK_LINE, so guard on h alone to match the
    // surface logic (lower grassy slopes below ROCK_LINE still get trees).
    if (h >= ROCK_LINE) return null;
    const biome = this.biomes.biomeAt(x, z);

    let p: number;
    let species: Species;
    switch (biome) {
      case Biome.Forest:
        p = 0.025;
        species = hash2(this.seed ^ 0x5b, x, z) < 0.85 ? 'oak' : 'birch';
        break;
      case Biome.BirchForest:
        p = 0.02;
        species = 'birch';
        break;
      case Biome.Snowy:
        p = 0.012;
        species = 'spruce';
        break;
      case Biome.Plains:
        p = 0.0015;
        species = 'oak';
        break;
      default:
        return null; // desert/beach/ocean: no trees
    }

    const r = hash2(this.seed ^ 0x7ee5, x, z);
    if (r > p) return null;
    // keep trees from spawning adjacent to each other
    for (let dx = -2; dx <= 2; dx++) {
      for (let dz = -2; dz <= 2; dz++) {
        if (dx === 0 && dz === 0) continue;
        const r2 = hash2(this.seed ^ 0x7ee5, x + dx, z + dz);
        if (r2 < r || (r2 === r && (dx < 0 || (dx === 0 && dz < 0)))) return null;
      }
    }
    const v = hash2(this.seed ^ 0x33, x, z);
    const trunk = species === 'spruce' ? 6 + Math.floor(v * 3)
      : species === 'birch' ? 5 + Math.floor(v * 2)
      : 4 + Math.floor(v * 3);
    return { species, trunk };
  }

  fill(chunk: Chunk): void {
    const ox = chunk.cx * CHUNK_X;
    const oz = chunk.cz * CHUNK_Z;

    for (let lx = 0; lx < CHUNK_X; lx++) {
      for (let lz = 0; lz < CHUNK_Z; lz++) {
        const wx = ox + lx, wz = oz + lz;
        const h = this.height(wx, wz);
        const biome = this.biomeWithWater(wx, wz, h);
        const sandy = biome === Biome.Beach || biome === Biome.Ocean ||
          biome === Biome.Desert;
        const mountain = biome === Biome.Mountains ||
          biome === Biome.SnowyMountains;
        const snowy = biome === Biome.Snowy || biome === Biome.SnowyMountains;
        const bareRock = mountain && h >= ROCK_LINE && h < SNOW_LINE;

        // Ravines cut open canyons on dry land.
        const rd = h > SEA_LEVEL + 2 ? this.ravineDepth(wx, wz) : 0;
        const ravineFloor = rd > 0 ? Math.max(10, h - rd) : 256;

        for (let y = 0; y <= h; y++) {
          let id: number;
          if (y === 0 || (y < 3 && hash2(this.seed ^ 0xbed, wx * 256 + y, wz) < 0.5)) {
            id = Block.Bedrock;
          } else if (y === h) {
            id = sandy ? Block.Sand
              : h >= SNOW_LINE ? Block.SnowyGrass    // snow cap
              : bareRock ? Block.Stone               // exposed rock
              : snowy ? Block.SnowyGrass
              : Block.Grass;
          } else if (y >= h - 3) {
            id = sandy ? Block.Sand
              : bareRock || h >= SNOW_LINE ? Block.Stone // rocky mountainside
              : Block.Dirt;
          } else if (biome === Biome.Desert && y >= h - 7) {
            id = Block.Sandstone;
          } else {
            id = Block.Stone;
          }

          if (id !== Block.Bedrock && y >= ravineFloor) continue; // ravine

          if (id !== Block.Bedrock && y > 4 && y < h - 3) {
            // Spaghetti caves: intersection of two 3D noise tubes.
            const n1 = this.caves1.noise(wx * 0.045, y * 0.07, wz * 0.045);
            const n2 = this.caves2.noise(wx * 0.045, y * 0.07, wz * 0.045);
            if (Math.abs(n1) < 0.09 && Math.abs(n2) < 0.09) continue;
          }

          chunk.set(lx, y, lz, id);
        }

        // Ocean / lake water up to sea level.
        for (let y = h + 1; y <= SEA_LEVEL; y++) {
          chunk.set(lx, y, lz, Block.Water);
        }

        this.decorate(chunk, lx, lz, wx, wz, h, biome);
      }
    }

    this.placeOres(chunk);
    this.plantTrees(chunk, ox, oz);
  }

  /** Column-local features: cacti, dead bushes, tall grass, flowers. */
  private decorate(
    chunk: Chunk, lx: number, lz: number, wx: number, wz: number,
    h: number, biome: Biome
  ): void {
    if (h <= SEA_LEVEL + 1 || chunk.get(lx, h, lz) === Block.Air) return;
    const r = hash2(this.seed ^ 0xdec0, wx, wz);

    if (biome === Biome.Desert) {
      if (r < 0.004) {
        const tall = 1 + Math.floor(hash2(this.seed ^ 0xcac, wx, wz) * 3);
        for (let i = 1; i <= tall; i++) chunk.set(lx, h + i, lz, Block.Cactus);
      } else if (r < 0.012) {
        chunk.set(lx, h + 1, lz, Block.DeadBush);
      }
      return;
    }

    const grassy = biome === Biome.Plains || biome === Biome.Forest ||
      biome === Biome.BirchForest;
    if (!grassy) return;
    const pGrass = biome === Biome.Plains ? 0.06 : 0.035;
    if (r < pGrass) {
      chunk.set(lx, h + 1, lz, Block.TallGrass);
    } else if (r < pGrass + 0.006) {
      chunk.set(lx, h + 1, lz,
        hash2(this.seed ^ 0xf1, wx, wz) < 0.6 ? Block.Dandelion : Block.Poppy);
    }
  }

  private placeOres(chunk: Chunk): void {
    const rng = mulberry32(
      (this.seed ^ Math.imul(chunk.cx, 0x9e3779b1) ^ Math.imul(chunk.cz, 0x85ebca77)) >>> 0
    );
    for (const [block, attempts, minY, maxY, veinMin, veinMax] of ORES) {
      for (let a = 0; a < attempts; a++) {
        let x = Math.floor(rng() * 16);
        let z = Math.floor(rng() * 16);
        let y = minY + Math.floor(rng() * (maxY - minY + 1));
        const size = veinMin + Math.floor(rng() * (veinMax - veinMin + 1));
        for (let i = 0; i < size; i++) {
          if (chunk.get(x, y, z) === Block.Stone) chunk.set(x, y, z, block);
          // random-walk one axis, clamped to the chunk and the depth range
          const axis = rng();
          if (axis < 0.34) x = Math.min(15, Math.max(0, x + (rng() < 0.5 ? 1 : -1)));
          else if (axis < 0.67) z = Math.min(15, Math.max(0, z + (rng() < 0.5 ? 1 : -1)));
          else y = Math.min(maxY, Math.max(minY, y + (rng() < 0.5 ? 1 : -1)));
        }
      }
    }
  }

  private plantTrees(chunk: Chunk, ox: number, oz: number): void {
    const stamp = (wx: number, y: number, wz: number, id: number, keepSolid = false) => {
      const lx = wx - ox, lz = wz - oz;
      if (lx < 0 || lx >= CHUNK_X || lz < 0 || lz >= CHUNK_Z) return;
      const existing = chunk.get(lx, y, lz);
      if (keepSolid && existing !== Block.Air) return;
      chunk.set(lx, y, lz, id);
    };

    for (let tx = ox - TREE_MARGIN; tx < ox + CHUNK_X + TREE_MARGIN; tx++) {
      for (let tz = oz - TREE_MARGIN; tz < oz + CHUNK_Z + TREE_MARGIN; tz++) {
        const tree = this.treeAt(tx, tz);
        if (!tree) continue;
        const ground = this.height(tx, tz);
        const top = ground + tree.trunk;
        const log = tree.species === 'birch' ? Block.BirchLog
          : tree.species === 'spruce' ? Block.SpruceLog
          : Block.OakLog;
        const leaves = tree.species === 'birch' ? Block.BirchLeaves
          : tree.species === 'spruce' ? Block.SpruceLeaves
          : Block.Leaves;

        stamp(tx, ground, tz, Block.Dirt); // grass under trunk -> dirt
        for (let y = ground + 1; y <= top; y++) stamp(tx, y, tz, log);

        if (tree.species === 'spruce') {
          this.spruceCanopy(stamp, tx, tz, top, tree.trunk, leaves);
        } else {
          this.oakCanopy(stamp, tx, tz, top, leaves);
        }
      }
    }
  }

  /** Classic oak/birch canopy: two 5x5 layers, a 3x3, and a plus cap. */
  private oakCanopy(
    stamp: (x: number, y: number, z: number, id: number, keep?: boolean) => void,
    tx: number, tz: number, top: number, leaves: Block
  ): void {
    for (let layer = 0; layer < 2; layer++) {
      const y = top - 2 + layer;
      for (let dx = -2; dx <= 2; dx++) {
        for (let dz = -2; dz <= 2; dz++) {
          if (dx === 0 && dz === 0) continue;
          const corner = Math.abs(dx) === 2 && Math.abs(dz) === 2;
          if (corner && hash2(this.seed ^ y, tx + dx, tz + dz) < 0.5) continue;
          stamp(tx + dx, y, tz + dz, leaves, true);
        }
      }
    }
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        if (dx !== 0 || dz !== 0) stamp(tx + dx, top, tz + dz, leaves, true);
      }
    }
    for (const [dx, dz] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
      stamp(tx + dx, top + 1, tz + dz, leaves, true);
    }
  }

  /** Conical spruce: narrow rings that widen down the trunk. */
  private spruceCanopy(
    stamp: (x: number, y: number, z: number, id: number, keep?: boolean) => void,
    tx: number, tz: number, top: number, trunk: number, leaves: Block
  ): void {
    stamp(tx, top + 1, tz, leaves, true);
    const layers = trunk - 2;
    for (let i = 0; i < layers; i++) {
      const y = top - i;
      let r = i === 0 ? 1 : Math.min(3, 1 + (i >> 1));
      if (i > 1 && i % 2 === 1) r = Math.max(1, r - 1); // tapered bands
      for (let dx = -r; dx <= r; dx++) {
        for (let dz = -r; dz <= r; dz++) {
          if (dx === 0 && dz === 0) continue;
          if (r >= 2 && Math.abs(dx) === r && Math.abs(dz) === r) continue;
          stamp(tx + dx, y, tz + dz, leaves, true);
        }
      }
    }
  }

  /** Find a dry spawn column near the origin (square-spiral search). */
  findSpawn(): { x: number; z: number; y: number } {
    const dry = (x: number, z: number) => this.height(x, z) >= SEA_LEVEL + 2;
    const at = (x: number, z: number) => ({
      x: x + 0.5, z: z + 0.5, y: this.height(x, z) + 1,
    });
    if (dry(8, 8)) return at(8, 8);
    for (let r = 8; r <= 1024; r += 8) {
      for (let i = -r; i <= r; i += 8) {
        for (const [x, z] of [
          [8 + i, 8 - r], [8 + i, 8 + r], [8 - r, 8 + i], [8 + r, 8 + i],
        ]) {
          if (dry(x, z)) return at(x, z);
        }
      }
    }
    return { x: 8.5, z: 8.5, y: SEA_LEVEL + 2 };
  }
}
