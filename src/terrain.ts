// Voxel terrain: layered-noise heightmap, biome surfaces (incl. mountains),
// sea level 63, beaches, three tree species, plants/cacti, spaghetti caves,
// ravines, ore veins, bedrock floor.

import { Biome, Biomes, ColumnTints } from './biomes';
import { Block } from './blocks';
import { Chunk, CHUNK_X, CHUNK_Z } from './chunk';
import { Noise2D, Noise3D, hash2, mulberry32 } from './noise';
import { structureStamp } from './structures';
import { VAULT_REACH, VaultStamp, vaultStamp } from './vaults';

export const SEA_LEVEL = 63;
const TREE_MARGIN = 3; // trees up to 3 blocks outside a chunk can reach into it
const ROCK_LINE = 96;  // mountains expose bare stone above this altitude
const SNOW_LINE = 120; // mountains get snow caps above this
const MAX_HEIGHT = 235;

type Species = 'oak' | 'birch' | 'spruce' | 'jungle' | 'cherry';
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
  // Cobalt: a deep, rare ore (rarer than iron — fewer, smaller veins) in its
  // own low Y band, feeding the oil-derrick crafting chain.
  [Block.CobaltOre, 3, 4, 30, 3, 6],
];

/** Filter ores an Autominer can be configured to drill (matches its UI). */
export const AUTOMINER_ORES: Block[] = [
  Block.Stone, Block.CoalOre, Block.IronOre, Block.GoldOre,
  Block.RedstoneOre, Block.DiamondOre, Block.TitaniumOre,
];

export class Terrain {
  readonly biomes: Biomes;
  private readonly seed: number;
  private readonly continental: Noise2D;
  private readonly hills: Noise2D;
  private readonly ravine: Noise2D;
  private readonly caves1: Noise3D;
  private readonly caves2: Noise3D;
  private readonly caverns: Noise3D;
  private readonly oreField: Noise2D;
  private readonly oilField: Noise2D;
  /** Vault stamps cached per anchor chunk (see vaultStampCached). */
  private readonly vaultStampCache = new Map<string, VaultStamp | null>();

  constructor(seed: number) {
    this.seed = seed;
    this.biomes = new Biomes(seed);
    this.continental = new Noise2D(seed);
    this.hills = new Noise2D(seed ^ 0x51ab);
    this.ravine = new Noise2D(seed ^ 0xaa11);
    this.caves1 = new Noise3D(seed ^ 0xcafe);
    this.caves2 = new Noise3D(seed ^ 0xbeef);
    this.caverns = new Noise3D(seed ^ 0x0caf);
    this.oreField = new Noise2D(seed ^ 0x0fe0);
    this.oilField = new Noise2D(seed ^ 0x011a);
  }

  /**
   * Per-column ore richness in [0,1] for each Autominer-filterable ore. A pure
   * function of position (no chunk needed), so machine yield is deterministic,
   * unit-testable, and works even where nothing is loaded. Stone is everywhere;
   * rarer ores have lower bases; titanium only appears under mountains (mirroring
   * generation). The spatial noise makes *where* you place a machine matter.
   */
  oreRichness(x: number, z: number): Record<number, number> {
    const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
    const n1 = 0.5 + 0.5 * this.oreField.fbm(x * 0.010, z * 0.010, 3);
    const n2 = 0.5 + 0.5 * this.oreField.fbm(x * 0.013 + 50, z * 0.013 - 50, 3);
    const m = this.biomes.mountainFactor(x, z);
    return {
      [Block.Stone]: 1,
      [Block.CoalOre]: clamp01(0.45 + 0.45 * n1),
      [Block.IronOre]: clamp01(0.32 + 0.45 * n2),
      [Block.GoldOre]: clamp01(0.10 + 0.40 * n1 * n2),
      [Block.RedstoneOre]: clamp01(0.14 + 0.40 * n2),
      [Block.DiamondOre]: clamp01(0.04 + 0.30 * n1 * n1),
      [Block.TitaniumOre]: m > 0 ? clamp01(0.08 + 0.55 * m) : 0,
    };
  }

  /**
   * Per-column oil-field richness in [0,1]: a low-frequency noise, much denser
   * under desert and ocean floors and near-zero on ordinary land — so an Oil
   * Derrick is useless on dry ground and lucrative over a field. Pure (chunk
   * independent) for the same reasons as oreRichness.
   */
  oilRichness(x: number, z: number): number {
    const base = 0.5 + 0.5 * this.oilField.fbm(x * 0.0026, z * 0.0026, 3);
    const h = this.height(x, z);
    const biome = this.biomeWithWater(x, z, h);
    const factor = biome === Biome.Ocean ? 1.0
      : biome === Biome.Desert ? 0.9
      : biome === Biome.Beach ? 0.4
      : 0.12;
    const r = base * factor;
    return r < 0 ? 0 : r > 1 ? 1 : r;
  }

  /** Surface height at world (x, z). Pure function, safe across chunks. */
  height(x: number, z: number): number {
    // Wider continental swing (×30 vs 24) so lows dip below sea level over more
    // area — bigger ocean basins with room for ships to sail and fight.
    const base = this.continental.fbm(x * 0.004, z * 0.004, 4) * 30;
    const detail = this.hills.fbm(x * 0.02, z * 0.02, 2) * 5;
    let h = 63 + base + detail;
    // Deepen sub-sea-level basins so oceans are genuinely deep (floored so they
    // don't bottom out into the bedrock band).
    if (h < SEA_LEVEL) {
      h = Math.max(SEA_LEVEL - 30, SEA_LEVEL - ((SEA_LEVEL - h) * 1.7 + 4));
    }
    // Mountains rise smoothly via the (smooth) mountain factor, so there are
    // no cliffs at biome borders. A ridged term makes the peaks jagged.
    const m = this.biomes.mountainFactor(x, z);
    if (m > 0) {
      const ridge = 1 - Math.abs(this.hills.fbm(x * 0.01, z * 0.01, 3));
      h += m * (50 + 90 * m) * (0.55 + 0.45 * ridge);
    }
    // Swamps flatten toward just-above-sea-level lowlands (mask-driven +
    // continuous; damped where mountains dominate so ranges stay ranges).
    const sf = this.biomes.swampFlat(x, z) * (1 - m);
    if (sf > 0 && h > SEA_LEVEL) {
      h += (SEA_LEVEL + 1.4 - h) * sf;
    }
    return Math.min(MAX_HEIGHT, Math.max(12, Math.round(h)));
  }

  tints(x: number, z: number): ColumnTints {
    return this.biomes.tints(x, z);
  }

  /** Biome including Ocean/Beach/Mountains, which depend on terrain height. */
  biomeWithWater(x: number, z: number, h: number): Biome {
    if (h < SEA_LEVEL - 1) return Biome.Ocean;
    // Swamps ARE the waterline — their flattened columns read as Swamp, not
    // Beach. Height-gated: a swamp-mask zone under a mountain range stays a
    // mountain (the flattening is damped there too).
    if (h >= SEA_LEVEL - 1 && h <= SEA_LEVEL + 4 && this.biomes.swampFlat(x, z) > 0.5 &&
        this.biomes.biomeAt(x, z) === Biome.Swamp) return Biome.Swamp;
    if (h <= SEA_LEVEL + 1) return Biome.Beach;
    if (this.biomes.mountainFactor(x, z) > 0.45 || h >= ROCK_LINE) {
      const [t] = this.biomes.climate(x, z);
      return t < 0.45 || h >= SNOW_LINE
        ? Biome.SnowyMountains : Biome.Mountains;
    }
    return this.biomes.biomeAt(x, z);
  }

  /** Ravine carve depth below the surface at this column (0 = no ravine).
   *  Ravines are rare showpieces: the trigger band is ~3× tighter than before
   *  AND gated on a low-freq mask, so canyons appear only in occasional regions
   *  rather than threading the whole world. Public so determinism/rarity is
   *  unit-testable. */
  ravineDepth(x: number, z: number): number {
    const mask = this.ravine.noise(x * 0.0012 + 500, z * 0.0012 - 500);
    if (mask < 0.25) return 0; // only inside the occasional "ravine country" regions
    const rv = this.ravine.noise(x * 0.006, z * 0.006);
    const band = 0.006;
    if (Math.abs(rv) >= band) return 0;
    const f = 1 - Math.abs(rv) / band;
    return Math.floor(14 + f * 34);
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
      case Biome.Jungle:
        p = 0.03;
        species = 'jungle';
        break;
      case Biome.CherryGrove:
        p = 0.02;
        species = 'cherry';
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
    const trunk = species === 'jungle' ? 8 + Math.floor(v * 4)
      : species === 'spruce' ? 6 + Math.floor(v * 3)
      : species === 'birch' ? 5 + Math.floor(v * 2)
      : species === 'cherry' ? 4 + Math.floor(v * 3)
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
        const mesa = biome === Biome.Mesa;
        const ashen = biome === Biome.Ashlands;
        const swamp = biome === Biome.Swamp;
        const crystal = biome === Biome.Crystalfields;
        // Swamp texture: scattered shallow pools + mud patches on the surface.
        const swampPool = swamp && h > SEA_LEVEL &&
          hash2(this.seed ^ 0x5009, wx, wz) < 0.07;
        const swampMud = swamp && hash2(this.seed ^ 0x30d9, wx, wz) < 0.3;
        // Scattered surface lava pools across the ashlands (a PvP hazard).
        const lavaPool = ashen && h > SEA_LEVEL &&
          hash2(this.seed ^ 0x1a7a, wx, wz) < 0.05;

        // Ravines cut open canyons on dry land.
        const rd = h > SEA_LEVEL + 2 ? this.ravineDepth(wx, wz) : 0;
        const ravineFloor = rd > 0 ? Math.max(10, h - rd) : 256;

        for (let y = 0; y <= h; y++) {
          let id: number;
          if (y === 0 || (y < 3 && hash2(this.seed ^ 0xbed, wx * 256 + y, wz) < 0.5)) {
            id = Block.Bedrock;
          } else if (y === h) {
            id = lavaPool ? Block.Lava
              : swampPool ? Block.Water              // shallow swamp pool
              : swamp ? (swampMud ? Block.Mud : Block.Grass)
              : crystal ? Block.Sandstone            // pale crystalfields ground
              : ashen ? Block.Basalt
              : mesa ? Block.RedSand
              : sandy ? Block.Sand
              : h >= SNOW_LINE ? Block.SnowyGrass    // snow cap
              : bareRock ? Block.Stone               // exposed rock
              : snowy ? Block.SnowyGrass
              : Block.Grass;
          } else if (y >= h - 3) {
            id = swampPool || (swamp && y >= h - 1) ? Block.Mud // muddy swamp bed
              : crystal ? Block.Sandstone
              : ashen ? Block.Basalt
              : mesa ? Block.Terracotta
              : sandy ? Block.Sand
              : bareRock || h >= SNOW_LINE ? Block.Stone // rocky mountainside
              : Block.Dirt;
          } else if (mesa && y >= h - 9) {
            // BANDED badlands rock: alternating strata read as painted cliffs.
            id = (y % 5) < 2 ? Block.RedSand : Block.Terracotta;
          } else if (ashen && y >= h - 7) {
            id = Block.Basalt;
          } else if (biome === Biome.Desert && y >= h - 7) {
            id = Block.Sandstone;
          } else {
            id = Block.Stone;
          }

          if (id !== Block.Bedrock && y >= ravineFloor) continue; // ravine

          if (id !== Block.Bedrock && y > 4 && y < h - 3) {
            // Layered caves: two connected worm-tunnel networks (union, so they
            // join up) PLUS occasional large CAVERNS — a low-freq 3D blob in a
            // deep band — so spelunking actually opens into rooms.
            const t1 = this.caves1.noise(wx * 0.022, y * 0.05, wz * 0.022);
            const t2 = this.caves2.noise(wx * 0.022 + 30, y * 0.05 - 30, wz * 0.022 + 30);
            if (Math.abs(t1) < 0.026 || Math.abs(t2) < 0.026) continue; // tunnels
            if (y > 8 && y < 40 &&
                this.caverns.noise(wx * 0.016, y * 0.03, wz * 0.016) > 0.66) continue; // caverns
          }

          chunk.set(lx, y, lz, id);
        }

        // Ocean / lake water up to sea level.
        for (let y = h + 1; y <= SEA_LEVEL; y++) {
          chunk.set(lx, y, lz, Block.Water);
        }

        this.decorate(chunk, lx, lz, wx, wz, h, biome);
        this.oilSeep(chunk, lx, lz, wx, wz, h, biome);
      }
    }

    this.placeOres(chunk);
    this.plantTrees(chunk, ox, oz);
    this.placeStructures(chunk, ox, oz);
  }

  /** Stamp any structures whose anchor chunk is this one or a neighbour
   *  (stamps never reach past 1 chunk), then any VAULTS anchored within 2
   *  chunks (a vault never reaches past 2). Applied AFTER trees so carves
   *  clear leaves; runs identically on the server and every client. */
  private placeStructures(chunk: Chunk, ox: number, oz: number): void {
    const apply = (blocks: { x: number; y: number; z: number; id: number }[]): void => {
      for (const b of blocks) {
        const lx = b.x - ox, lz = b.z - oz;
        if (lx < 0 || lx >= CHUNK_X || lz < 0 || lz >= CHUNK_Z) continue;
        if (b.y < 1 || b.y > 250) continue;
        chunk.set(lx, b.y, lz, b.id);
      }
    };
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const st = structureStamp(this.seed, chunk.cx + dx, chunk.cz + dz, this);
        if (st) apply(st.blocks);
      }
    }
    for (let dx = -VAULT_REACH; dx <= VAULT_REACH; dx++) {
      for (let dz = -VAULT_REACH; dz <= VAULT_REACH; dz++) {
        const v = this.vaultStampCached(chunk.cx + dx, chunk.cz + dz);
        if (v) apply(v.blocks);
      }
    }
  }

  /** Vault stamps are big (sprawling complexes) and every chunk in reach needs
   *  the same one — cache per anchor chunk instead of rebuilding per fill. */
  private vaultStampCached(cx: number, cz: number): VaultStamp | null {
    const key = `${cx},${cz}`;
    let st = this.vaultStampCache.get(key);
    if (st === undefined) {
      st = vaultStamp(this.seed, cx, cz, this);
      this.vaultStampCache.set(key, st);
    }
    return st;
  }

  /** Column-local features: cacti, bushes, tall grass, flowers, boulders,
   *  hoodoos, basalt spikes — each biome gets its own signature clutter so
   *  the landscapes stop looking samey. */
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
      } else if (r < 0.0135) {
        // A weathered sandstone slab poking out of the dunes.
        chunk.set(lx, h + 1, lz, Block.Sandstone);
      }
      return;
    }

    // Mesa: dead bushes + occasional terracotta HOODOOS (2–5 tall pillars).
    if (biome === Biome.Mesa) {
      if (r < 0.01) {
        chunk.set(lx, h + 1, lz, Block.DeadBush);
      } else if (r < 0.0125) {
        const tall = 2 + Math.floor(hash2(this.seed ^ 0x40d0, wx, wz) * 4);
        for (let i = 1; i <= tall; i++) chunk.set(lx, h + i, lz, Block.Terracotta);
      }
      return;
    }

    // Ashlands: jagged basalt spikes rising from the flats.
    if (biome === Biome.Ashlands) {
      if (r < 0.006) {
        const tall = 2 + Math.floor(hash2(this.seed ^ 0xba51, wx, wz) * 4);
        for (let i = 1; i <= tall; i++) chunk.set(lx, h + i, lz, Block.Basalt);
      }
      return;
    }

    // Crystalfields: scattered glowing crystal spikes, 1-4 blocks tall.
    if (biome === Biome.Crystalfields) {
      if (r < 0.012) {
        const tall = 1 + Math.floor(hash2(this.seed ^ 0xc59, wx, wz) * 4);
        for (let i = 1; i <= tall; i++) chunk.set(lx, h + i, lz, Block.CrystalBlock);
      }
      return;
    }
    // Swamps: dead bushes on the mud + sparse murky grass.
    if (biome === Biome.Swamp) {
      if (chunk.get(lx, h, lz) === Block.Water) return; // no plants on pools
      if (r < 0.02) chunk.set(lx, h + 1, lz, Block.DeadBush);
      else if (r < 0.05) chunk.set(lx, h + 1, lz, Block.TallGrass);
      return;
    }

    // Snowy plains: nothing but the snow (no stray boulders/shrubs).
    if (biome === Biome.Snowy) return;

    const grassy = biome === Biome.Plains || biome === Biome.Forest ||
      biome === Biome.BirchForest || biome === Biome.Jungle ||
      biome === Biome.CherryGrove;
    if (!grassy) return;
    // Jungle floors are DENSE with tall grass; cherry groves scatter petals
    // (poppy-heavy flowers) through lighter grass.
    const pGrass = biome === Biome.Jungle ? 0.14
      : biome === Biome.Plains ? 0.06
      : biome === Biome.CherryGrove ? 0.05
      : 0.035;
    // Flowers cluster into MEADOW PATCHES (a coarse 8×8 mask) so plains read as
    // fields with drifts of color instead of uniform speckle.
    const meadow = hash2(this.seed ^ 0xf10a, wx >> 3, wz >> 3) < 0.22;
    const pFlower = biome === Biome.CherryGrove ? 0.02
      : meadow ? 0.055
      : 0.004;
    if (r < pGrass) {
      chunk.set(lx, h + 1, lz, Block.TallGrass);
    } else if (r < pGrass + pFlower) {
      // Meadow patches lean one color per patch (real drifts, not confetti).
      const poppyBias = biome === Biome.CherryGrove ? 0.85
        : meadow ? (hash2(this.seed ^ 0xf1f1, wx >> 3, wz >> 3) < 0.5 ? 0.85 : 0.15)
        : 0.4;
      chunk.set(lx, h + 1, lz,
        hash2(this.seed ^ 0xf1, wx, wz) < poppyBias ? Block.Poppy : Block.Dandelion);
    }
    // No ground-level boulders or leaf bushes: stray cobblestone/leaf blocks on
    // the surface read as litter, not decoration, so grass + flowers are it.
  }

  /** Rare visual oil seeps: convert a few stone blocks under rich desert/ocean
   *  columns to Oil Shale, a "there's oil here" cue. Stone-only so it never
   *  disturbs surface/biome material counts. */
  private oilSeep(
    chunk: Chunk, lx: number, lz: number, wx: number, wz: number,
    h: number, biome: Biome
  ): void {
    if (biome !== Biome.Desert && biome !== Biome.Ocean) return;
    if (this.oilRichness(wx, wz) < 0.7) return;
    if (hash2(this.seed ^ 0x011a, wx, wz) > 0.06) return;
    let placed = 0;
    for (let y = h - 1; y >= 2 && placed < 3; y--) {
      if (chunk.get(lx, y, lz) === Block.Stone) {
        chunk.set(lx, y, lz, Block.OilShale);
        placed++;
      }
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

    // Titanium: the rare end-game armor ore, found deep *under mountains* only
    // (columns at or above the bare-rock line), so it's worth the climb + dig.
    for (let a = 0; a < 8; a++) {
      let x = Math.floor(rng() * 16);
      let z = Math.floor(rng() * 16);
      let y = 6 + Math.floor(rng() * 23); // y 6..28
      const size = 3 + Math.floor(rng() * 4);
      if (this.height(chunk.cx * CHUNK_X + x, chunk.cz * CHUNK_Z + z) < ROCK_LINE) continue;
      for (let i = 0; i < size; i++) {
        if (chunk.get(x, y, z) === Block.Stone) chunk.set(x, y, z, Block.TitaniumOre);
        const axis = rng();
        if (axis < 0.34) x = Math.min(15, Math.max(0, x + (rng() < 0.5 ? 1 : -1)));
        else if (axis < 0.67) z = Math.min(15, Math.max(0, z + (rng() < 0.5 ? 1 : -1)));
        else y = Math.min(28, Math.max(6, y + (rng() < 0.5 ? 1 : -1)));
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
          : tree.species === 'jungle' ? Block.JungleLog
          : tree.species === 'cherry' ? Block.CherryLog
          : Block.OakLog;
        const leaves = tree.species === 'birch' ? Block.BirchLeaves
          : tree.species === 'spruce' ? Block.SpruceLeaves
          : tree.species === 'jungle' ? Block.JungleLeaves
          : tree.species === 'cherry' ? Block.CherryLeaves
          : Block.Leaves;

        stamp(tx, ground, tz, Block.Dirt); // grass under trunk -> dirt
        for (let y = ground + 1; y <= top; y++) stamp(tx, y, tz, log);

        if (tree.species === 'spruce') {
          this.spruceCanopy(stamp, tx, tz, top, tree.trunk, leaves);
        } else if (tree.species === 'jungle') {
          // Tall jungle giants wear TWO canopies: the crown + a mid-trunk skirt.
          this.oakCanopy(stamp, tx, tz, top, leaves);
          this.oakCanopy(stamp, tx, tz, top - 4, leaves);
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

  /** A column is safe to stand on at spawn: solid ground comfortably above sea
   *  level, NOT carved open by a ravine (which would leave you in mid-air), NOT
   *  a water/beach biome, NOT ashlands (surface lava), and surrounded by dry
   *  land so you don't land on a lone spike at the water's edge. */
  private safeSpawnColumn(x: number, z: number): boolean {
    const h = this.height(x, z);
    if (h < SEA_LEVEL + 3) return false;            // would be at/near water
    if (this.ravineDepth(x, z) > 0) return false;   // surface carved -> air/fall
    const biome = this.biomeWithWater(x, z, h);
    if (biome === Biome.Ocean || biome === Biome.Beach || biome === Biome.Ashlands) return false;
    // Neighbours must also be dry land (no spawning on a 1-wide pillar in water).
    for (const [dx, dz] of [[2, 0], [-2, 0], [0, 2], [0, -2]] as [number, number][]) {
      if (this.height(x + dx, z + dz) < SEA_LEVEL + 1) return false;
    }
    return true;
  }

  /** Return the safe natural-surface spawn at a specific column, if any. */
  safeSpawnAt(x: number, z: number): { x: number; z: number; y: number } | undefined {
    x = Math.floor(x); z = Math.floor(z);
    if (!this.safeSpawnColumn(x, z)) return undefined;
    return { x: x + 0.5, z: z + 0.5, y: this.height(x, z) + 1 };
  }

  /** Exact generated block IDs for selected cells in one world column. */
  blocksAtColumn(x: number, z: number, ys: number[]): number[] {
    const cx = Math.floor(x) >> 4, cz = Math.floor(z) >> 4;
    const chunk = new Chunk(cx, cz);
    this.fill(chunk);
    const lx = ((Math.floor(x) % CHUNK_X) + CHUNK_X) % CHUNK_X;
    const lz = ((Math.floor(z) % CHUNK_Z) + CHUNK_Z) % CHUNK_Z;
    return ys.map((y) => chunk.get(lx, Math.floor(y), lz));
  }

  /** Exact generated block IDs for arbitrary cells, generating each touched
   * chunk only once. Useful for bounded server-side blast queries. */
  blocksAtCells(cells: readonly { x: number; y: number; z: number }[]): number[] {
    const chunks = new Map<string, Chunk>();
    return cells.map(({ x, y, z }) => {
      const wx = Math.floor(x), wy = Math.floor(y), wz = Math.floor(z);
      const cx = wx >> 4, cz = wz >> 4;
      const key = `${cx},${cz}`;
      let chunk = chunks.get(key);
      if (!chunk) {
        chunk = new Chunk(cx, cz);
        this.fill(chunk);
        chunks.set(key, chunk);
      }
      const lx = ((wx % CHUNK_X) + CHUNK_X) % CHUNK_X;
      const lz = ((wz % CHUNK_Z) + CHUNK_Z) % CHUNK_Z;
      return chunk.get(lx, wy, lz);
    });
  }

  /** A random spawn within ±half of origin that is guaranteed solid dry ground
   *  (never in water, never floating in air). Falls back to findSpawn if the rng
   *  is unlucky. The +1 on y places the feet exactly on top of the surface. */
  randomDrySpawn(rng: () => number, half: number): { x: number; z: number; y: number } {
    const margin = half - 24; // keep clear of the world border
    for (let i = 0; i < 512; i++) {
      const x = Math.round((rng() * 2 - 1) * margin);
      const z = Math.round((rng() * 2 - 1) * margin);
      if (this.safeSpawnColumn(x, z)) {
        return { x: x + 0.5, z: z + 0.5, y: this.height(x, z) + 1 };
      }
    }
    return this.findSpawn();
  }

  /** A dry spawn column inside a rectangular world-coord region (faction-aware
   *  spawns, Phase: you only drop in your own territory). Random tries first,
   *  then a coarse grid scan, then the global findSpawn as a last resort. */
  drySpawnInBounds(
    rng: () => number, minX: number, maxX: number, minZ: number, maxZ: number,
  ): { x: number; z: number; y: number } {
    for (let i = 0; i < 400; i++) {
      const x = Math.round(minX + rng() * (maxX - minX));
      const z = Math.round(minZ + rng() * (maxZ - minZ));
      if (this.safeSpawnColumn(x, z)) return { x: x + 0.5, z: z + 0.5, y: this.height(x, z) + 1 };
    }
    for (let x = Math.ceil(minX); x <= maxX; x += 3) {
      for (let z = Math.ceil(minZ); z <= maxZ; z += 3) {
        if (this.safeSpawnColumn(x, z)) return { x: x + 0.5, z: z + 0.5, y: this.height(x, z) + 1 };
      }
    }
    return this.findSpawn();
  }

  /** Find a dry spawn column near the origin (square-spiral search). */
  findSpawn(): { x: number; z: number; y: number } {
    const dry = (x: number, z: number) => this.safeSpawnColumn(x, z);
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
