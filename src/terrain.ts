// Voxel terrain: layered-noise heightmap, biome surfaces (incl. mountains),
// sea level 63, beaches, three tree species, plants/cacti, spaghetti caves,
// ravines, ore veins, bedrock floor.

import { Biome, Biomes, ColumnTints } from './biomes';
import { Block } from './blocks';
import { Chunk, CHUNK_X, CHUNK_Z } from './chunk';
import { flagHome } from './flags';
import { Noise2D, Noise3D, hash2, mulberry32 } from './noise';
import {
  PLAZA_BLEND, PLAZA_EDGE, PLAZA_FLAT, PLAZA_FOUNDATION, plazaAt, plazaSurface,
} from './plaza';
import { structureSite, structureStamp, StructureStamp } from './structures';
import { Caves } from './caves';
import { VAULT_REACH, VaultStamp, vaultStamp } from './vaults';
import { ARENA_BAND_MIN_X, ARENA_VOID_MIN_X, arenaBandForX } from './arena';

export const SEA_LEVEL = 63;
// Redwoods reach ~26 blocks over their stump, so the tree margin has to cover
// the widest canopy any species can throw across a chunk border.
const TREE_MARGIN = 4;
// Rock and snow lines are climate-driven now (see rockLine / snowLine): a range
// in the tropics keeps its forest and its bare granite far higher than one in
// the north, which is what makes two ranges on opposite sides of the map read
// as different places instead of two copies of the same mountain.
// Peaks now build most of the way to the chunk ceiling (256). The extra ~13
// blocks of headroom leave room for snow, spires and structures on a summit.
const MAX_HEIGHT = 243;
// Above this the height curve compresses instead of clipping, so the tallest
// summits taper to points rather than all shearing off at one flat altitude.
const SOFT_CEILING = 196;

type Species = 'oak' | 'birch' | 'spruce' | 'jungle' | 'cherry'
  | 'acacia' | 'redwood';
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

// Direct-mapped memo for height(). Generating one chunk asks for the same
// column from three separate places (surface build, tree test, tree stamp), and
// the streamer re-asks for every neighbour when it meshes the chunk next door.
// height() is pure, so caching it changes nothing about the world and is by far
// the biggest lever on generation time — which matters more now that a column
// costs a ridged multifractal and an erosion field.
const HEIGHT_CACHE = 1 << 14;

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** Filter ores an Autominer can be configured to drill (matches its UI). */
export const AUTOMINER_ORES: Block[] = [
  Block.Stone, Block.CoalOre, Block.IronOre, Block.GoldOre,
  Block.RedstoneOre, Block.DiamondOre,
];

export class Terrain {
  readonly biomes: Biomes;
  private readonly seed: number;
  private readonly continental: Noise2D;
  private readonly hills: Noise2D;
  private readonly ravine: Noise2D;
  /** Broad "how eroded is this range" field: high = worn plateaus and shoulders,
   *  low = raw spires. It is what stops every mountain being the same cone. */
  private readonly erosion: Noise2D;
  /** Fine surface field for scree patches, snow drifts and podzol. */
  private readonly surfaceField: Noise2D;
  private readonly caves1: Noise3D;
  private readonly caves2: Noise3D;
  private readonly caverns: Noise3D;
  readonly caveLandscape: Caves;
  private readonly structureStampCache = new Map<string, StructureStamp | null>();
  private readonly oreField: Noise2D;
  private readonly oilField: Noise2D;
  /** Vault stamps cached per anchor chunk (see vaultStampCached). */
  private readonly vaultStampCache = new Map<string, VaultStamp | null>();
  /** One levelled pad height per faction monument, solved on first use from the
   *  NATURAL surface around that flag (see padHeight). */
  private readonly padHeights = new Map<number, number>();
  // Open-addressed, no eviction policy beyond "last writer wins" — a generation
  // pass works over a contiguous patch of columns, so collisions are rare and a
  // miss just recomputes. hv 0 is the empty sentinel (height is always >= 12).
  private readonly hx = new Int32Array(HEIGHT_CACHE);
  private readonly hz = new Int32Array(HEIGHT_CACHE);
  private readonly hv = new Int16Array(HEIGHT_CACHE);

  constructor(seed: number) {
    this.seed = seed;
    this.biomes = new Biomes(seed);
    this.continental = new Noise2D(seed);
    this.hills = new Noise2D(seed ^ 0x51ab);
    this.ravine = new Noise2D(seed ^ 0xaa11);
    this.erosion = new Noise2D(seed ^ 0xe705);
    this.surfaceField = new Noise2D(seed ^ 0x5a4f);
    this.caves1 = new Noise3D(seed ^ 0xcafe);
    this.caves2 = new Noise3D(seed ^ 0xbeef);
    this.caverns = new Noise3D(seed ^ 0x0caf);
    this.caveLandscape = new Caves(seed, this);
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

  /**
   * Ridged multifractal in [0,1]: the crest-shaped cousin of fbm. Each octave
   * is 1-|noise| (so its maximum lies along a LINE, not at a point), squared to
   * sharpen it, and weighted by the octave above it — which is why detail only
   * accumulates on ground that is already high. That single property is the
   * difference between a mountain with knife-edge arêtes running off its summit
   * and the smooth dome a plain fbm gives you.
   */
  private ridged(x: number, z: number): number {
    let sum = 0, norm = 0, amp = 1, freq = 0.0055, weight = 1;
    for (let i = 0; i < 5; i++) {
      let n = 1 - Math.abs(this.hills.noise(x * freq + i * 37.1, z * freq - i * 19.7));
      n *= n;
      n *= weight;
      weight = Math.min(1, n * 2.1);
      sum += n * amp;
      norm += amp;
      amp *= 0.52;
      freq *= 2.07;
    }
    return sum / norm;
  }

  /** Altitude at which mountains shed their soil for bare rock. Warm ranges
   *  keep their green far higher than cold ones. */
  rockLine(t: number): number {
    return 78 + t * 34;
  }

  /** Altitude of permanent snow. Same idea, wider swing: a polar range is white
   *  from its shoulders up, an equatorial one only at the very summit. */
  snowLine(t: number): number {
    return 96 + t * 74;
  }

  /** Surface height at world (x, z). Pure function, safe across chunks. */
  height(x: number, z: number): number {
    // Only whole columns are memoised; that is every call generation makes.
    // (Ambient effects sample fractional positions and simply skip the cache.)
    const xi = x | 0, zi = z | 0;
    if (xi !== x || zi !== z) return this.computeHeight(x, z);
    const slot =
      (Math.imul(xi, 0x9e3779b1) ^ Math.imul(zi, 0x85ebca77)) & (HEIGHT_CACHE - 1);
    if (this.hv[slot] !== 0 && this.hx[slot] === xi && this.hz[slot] === zi) {
      return this.hv[slot];
    }
    const h = this.computeHeight(x, z);
    this.hx[slot] = xi;
    this.hz[slot] = zi;
    this.hv[slot] = h;
    return h;
  }

  /**
   * Surface height with the faction monuments levelled in: inside a flag plaza
   * the ground IS the pad, outside the rim it is the natural landscape, and
   * across the rim it ramps smoothly between the two. Doing this in the
   * heightmap rather than as a stamp is what makes every consumer agree — the
   * surface fill, trees, structures, spawn searches and the client's model
   * ground probes all end up on the same level (see plaza.ts).
   */
  private computeHeight(x: number, z: number): number {
    const natural = this.naturalHeight(x, z);
    const plaza = plazaAt(x, z);
    if (!plaza || plaza.d > PLAZA_EDGE) return natural;
    const pad = this.padHeight(plaza.faction);
    if (plaza.d <= PLAZA_FLAT) return pad;
    // Smoothstep rather than a straight lerp: the rim leaves the court level
    // and meets the hillside at its own slope, so there is no visible seam at
    // either end of the ramp.
    const t = smoothstep(PLAZA_FLAT, PLAZA_FLAT + PLAZA_BLEND, plaza.d);
    return Math.round(pad + (natural - pad) * t);
  }

  /**
   * The level one faction's monument stands on: the mean NATURAL surface over
   * its court, never below the waterline (a flag pad is dry land even when the
   * pole happens to sit on a lake shore). Pure in the seed, so the server and
   * every client solve the same number; memoised because it costs ~50 columns.
   */
  private padHeight(faction: number): number {
    const cached = this.padHeights.get(faction);
    if (cached !== undefined) return cached;
    const home = flagHome(faction);
    let sum = 0, n = 0;
    for (let dz = -PLAZA_FLAT; dz <= PLAZA_FLAT; dz += 4) {
      for (let dx = -PLAZA_FLAT; dx <= PLAZA_FLAT; dx += 4) {
        sum += this.naturalHeight(home.x + dx, home.z + dz);
        n++;
      }
    }
    const y = Math.max(SEA_LEVEL + 2, Math.round(sum / n));
    this.padHeights.set(faction, y);
    return y;
  }

  private naturalHeight(x: number, z: number): number {
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
    // no cliffs at biome borders.
    let m = this.biomes.mountainFactor(x, z);
    // Ranges grow out of LAND. Fading the lift away over deep water keeps the
    // ocean basins oceanic (nothing shoulders up out of the abyss) while still
    // letting a range climb straight off a shoreline into a coastal wall.
    m *= smoothstep(SEA_LEVEL - 30, SEA_LEVEL - 6, h);
    if (m > 0) {
      const ridge = this.ridged(x, z);
      // Erosion decides the *character* of a range: worn ranges get broad
      // shoulders and shelves, young ones get raw spires off the same field.
      const erosion = 0.5 + 0.5 * this.erosion.fbm(x * 0.0034, z * 0.0034, 3);
      const spiky = 1 - erosion;
      // Cubed in m, so the tallest ground gets disproportionately taller —
      // ranges have real summits instead of one uniform plateau altitude.
      let lift = m * (74 + 212 * m * m) * (0.3 + 0.7 * ridge);
      lift *= 0.72 + 0.5 * spiky;
      // Worn ranges terrace: rounding the upper part of the lift to 6-block
      // steps carves the cliff bands and shelves you get on real massifs.
      const terrace = smoothstep(0.55, 0.9, erosion) * smoothstep(30, 70, lift);
      if (terrace > 0) {
        const stepped = Math.round(lift / 6) * 6;
        lift += (stepped - lift) * terrace * 0.8;
      }
      h += lift;
    }
    // Swamps flatten toward just-above-sea-level lowlands (mask-driven +
    // continuous; damped where mountains dominate so ranges stay ranges).
    const sf = this.biomes.swampFlat(x, z) * (1 - m);
    if (sf > 0 && h > SEA_LEVEL) {
      h += (SEA_LEVEL + 1.4 - h) * sf;
    }
    // Soft ceiling instead of a hard clamp: without it every peak tall enough to
    // reach the limit would be sheared off at exactly the same altitude, and a
    // skyline of identical flat tops is the one thing that instantly reads as
    // generated. This compresses asymptotically, so summits stay pointed.
    if (h > SOFT_CEILING) {
      const span = MAX_HEIGHT - SOFT_CEILING;
      h = SOFT_CEILING + span * (1 - Math.exp(-(h - SOFT_CEILING) / span));
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
    const [t, m] = this.biomes.climate(x, z);
    if (h <= SEA_LEVEL + 1) {
      // Warm, humid shorelines are white sand over turquoise shallows rather
      // than the same grey-tan beach the poles get.
      return t > 0.6 && m > 0.34 ? Biome.TropicalCoast : Biome.Beach;
    }
    const rock = this.rockLine(t);
    const snow = this.snowLine(t);
    if (this.biomes.mountainFactor(x, z) > 0.46 || h >= rock) {
      // Below the rock line a mountain is still green: HIGHLANDS, the alpine
      // shoulder where the meadows and the last stunted conifers live. The old
      // code jumped straight from grassland to grey rock at a fixed altitude.
      if (h < rock - 4 && t >= 0.34) return Biome.Highlands;
      return t < 0.26 || h >= snow ? Biome.SnowyMountains : Biome.Mountains;
    }
    return this.biomes.biomeAt(x, z);
  }

  /** Ravine carve depth below the surface at this column (0 = no ravine).
   *  Ravines are rare showpieces: the trigger band is ~3× tighter than before
   *  AND gated on a low-freq mask, so canyons appear only in occasional regions
   *  rather than threading the whole world. Public so determinism/rarity is
   *  unit-testable. */
  ravineDepth(x: number, z: number): number {
    if (plazaAt(x, z)) return 0; // a canyon never opens under a flag plaza
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
    if (h <= SEA_LEVEL + 1) return null;
    if (plazaAt(x, z)) return null; // monument grounds are kept clear
    const [t] = this.biomes.climate(x, z);
    // The treeline is the rock line: nothing roots in bare granite, and where
    // that sits now depends on how warm the range is.
    if (h >= this.rockLine(t)) return null;
    const biome = this.biomeWithWater(x, z, h);

    let p: number;
    let species: Species;
    switch (biome) {
      case Biome.Forest:
        p = 0.06;
        species = hash2(this.seed ^ 0x5b, x, z) < 0.85 ? 'oak' : 'birch';
        break;
      case Biome.BirchForest:
        p = 0.055;
        species = 'birch';
        break;
      case Biome.AutumnForest:
        p = 0.06;
        species = hash2(this.seed ^ 0x5b, x, z) < 0.6 ? 'oak' : 'birch';
        break;
      case Biome.Taiga:
        p = 0.055;
        species = 'spruce';
        break;
      case Biome.SnowyTaiga:
        p = 0.045;
        species = 'spruce';
        break;
      case Biome.RedwoodForest:
        // Fewer stems, but each one is a landmark you can see over the canopy.
        p = 0.03;
        species = 'redwood';
        break;
      case Biome.Snowy:
        p = 0.02;
        species = 'spruce';
        break;
      case Biome.Highlands:
        p = 0.018;
        species = 'spruce';
        break;
      case Biome.Plains:
        p = 0.005;
        species = 'oak';
        break;
      case Biome.SunflowerPlains:
        p = 0.004;
        species = 'oak';
        break;
      case Biome.Meadow:
        p = 0.006;
        species = 'oak';
        break;
      case Biome.Heath:
        p = 0.006;
        species = 'birch';
        break;
      case Biome.Savanna:
        p = 0.009;
        species = 'acacia';
        break;
      case Biome.Steppe:
        p = 0.002;
        species = 'acacia';
        break;
      case Biome.Swamp:
        p = 0.012;
        species = 'oak';
        break;
      case Biome.Jungle:
        p = 0.07;
        species = 'jungle';
        break;
      case Biome.CherryGrove:
        p = 0.055;
        species = 'cherry';
        break;
      default:
        return null; // desert/mesa/beach/ocean/ashlands/crystalfields: no trees
    }

    const r = hash2(this.seed ^ 0x7ee5, x, z);
    if (r > p) return null;
    if (this.caveEntranceAt(x, z)) return null;
    // keep trees from spawning adjacent to each other
    for (let dx = -2; dx <= 2; dx++) {
      for (let dz = -2; dz <= 2; dz++) {
        if (dx === 0 && dz === 0) continue;
        const r2 = hash2(this.seed ^ 0x7ee5, x + dx, z + dz);
        if (r2 < r || (r2 === r && (dx < 0 || (dx === 0 && dz < 0)))) return null;
      }
    }
    const v = hash2(this.seed ^ 0x33, x, z);
    const trunk = species === 'redwood' ? 15 + Math.floor(v * 10)
      : species === 'jungle' ? 9 + Math.floor(v * 5)
      : species === 'spruce' ? 6 + Math.floor(v * 4)
      : species === 'birch' ? 5 + Math.floor(v * 3)
      : species === 'acacia' ? 4 + Math.floor(v * 3)
      : species === 'cherry' ? 4 + Math.floor(v * 3)
      : 4 + Math.floor(v * 3);
    return { species, trunk };
  }

  fill(chunk: Chunk): void {
    const ox = chunk.cx * CHUNK_X;
    const oz = chunk.cz * CHUNK_Z;

    // Ephemeral minigame arenas are deterministic structures far beyond the
    // normal border. Fast-path generation by directly stamping authored blocks,
    // bypassing all open-world 3D cave noise, biome calculation, ores, and
    // structure searches. Which mode owns this band is arena.ts's business; the
    // per-band y range keeps the sky-island modes cheaper than Duels.
    if (ox >= ARENA_VOID_MIN_X) {
      // Past the border there is arena geometry or there is NOTHING. Falling
      // through to the open-world generator here used to grow real hills,
      // caves and ore in the gaps between arenas — world terrain a competitor
      // could see over an arena wall, in a place the world is not supposed to
      // reach. An unclaimed column beyond the border is now honest air.
      const band = ox >= ARENA_BAND_MIN_X ? arenaBandForX(ox) : null;
      if (!band) return;
      for (let lx = 0; lx < CHUNK_X; lx++) {
        for (let lz = 0; lz < CHUNK_Z; lz++) {
          const wx = ox + lx, wz = oz + lz;
          for (let y = band.stampMinY; y <= band.stampMaxY; y++) {
            const block = band.blockAt(wx, y, wz);
            if (block !== null && block !== Block.Air) {
              chunk.set(lx, y, lz, block);
            }
          }
        }
      }
      return;
    }

    for (let lx = 0; lx < CHUNK_X; lx++) {
      for (let lz = 0; lz < CHUNK_Z; lz++) {
        const wx = ox + lx, wz = oz + lz;
        const h = this.height(wx, wz);
        const biome = this.biomeWithWater(wx, wz, h);
        const [temp] = this.biomes.climate(wx, wz);
        const rockLine = this.rockLine(temp);
        const snowLine = this.snowLine(temp);
        const sandy = biome === Biome.Beach || biome === Biome.Ocean ||
          biome === Biome.Desert || biome === Biome.TropicalCoast;
        const mountain = biome === Biome.Mountains ||
          biome === Biome.SnowyMountains || biome === Biome.Highlands;
        const snowy = biome === Biome.Snowy || biome === Biome.SnowyMountains ||
          biome === Biome.SnowyTaiga || biome === Biome.IceSpikes;
        // Snow does not begin on a ruled line. Over the 12 blocks below the
        // snow line it DITHERS in — drifts catching in the lee of the rock —
        // so a peak wears a broken frost collar instead of a painted stripe.
        const snowDither = h >= snowLine ? 1
          : h > snowLine - 12
            ? (h - (snowLine - 12)) / 12 > hash2(this.seed ^ 0x5017, wx, wz) ? 1 : 0
            : 0;
        const capped = (mountain || snowy) && snowDither === 1;
        const bareRock = mountain && h >= rockLine && !capped;
        // Scree: patches of loose broken rock across the bare faces, so a
        // mountainside is two materials rather than one flat grey.
        const scree = bareRock &&
          this.surfaceField.fbm(wx * 0.055, wz * 0.055, 2) > 0.24;
        // Podzol: bare needle-litter under old conifers. Cheap, and it is what
        // makes a redwood stand read as a forest floor instead of a lawn.
        const podzol = (biome === Biome.RedwoodForest || biome === Biome.Taiga) &&
          this.surfaceField.fbm(wx * 0.07 + 40, wz * 0.07 - 40, 2) > 0.12;
        // Steppe dries out into sand scrapes; heath breaks through to stone.
        const scrape = biome === Biome.Steppe &&
          this.surfaceField.fbm(wx * 0.06 - 80, wz * 0.06 + 80, 2) > 0.34;
        const outcrop = biome === Biome.Heath &&
          this.surfaceField.fbm(wx * 0.08 + 15, wz * 0.08 + 15, 2) > 0.42;
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

        // Flag plaza: the court is PAVED, over a stone foundation deep enough
        // that its kerb reads as a platform where the rim cuts into a slope.
        const plaza = plazaAt(wx, wz);
        const paving = plaza && plaza.d <= PLAZA_FLAT
          ? plazaSurface(this.seed, wx, wz, plaza.d) : 0;
        const caveSlices = this.caveLandscape.column(wx, wz);

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
              : capped ? Block.SnowyGrass            // dithered snow cap
              : bareRock ? (scree ? Block.Cobblestone : Block.Stone)
              : snowy ? Block.SnowyGrass
              : podzol ? Block.Dirt                  // conifer needle litter
              : scrape ? Block.Sand                  // dry steppe scrape
              : outcrop ? Block.Stone                // heath outcrop
              : Block.Grass;
          } else if (y >= h - 3) {
            id = swampPool || (swamp && y >= h - 1) ? Block.Mud // muddy swamp bed
              : crystal ? Block.Sandstone
              : ashen ? Block.Basalt
              : mesa ? Block.Terracotta
              : sandy ? Block.Sand
              : bareRock || capped ? Block.Stone // rocky mountainside
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

          if (paving !== 0 && y > h - PLAZA_FOUNDATION) {
            id = y === h ? paving : Block.Stone; // paving + its footing
          }

          if (id !== Block.Bedrock && y >= ravineFloor) continue; // ravine

          if (y > 4 && caveSlices.some(s => y > s.floor && y <= s.ceiling)) continue;

          // Nothing hollows out the ground under a monument: a cave mouth in
          // the plaza floor would put the flag pole over a hole.
          if (id !== Block.Bedrock && y > 4 && y < h - 5 &&
              !caveSlices.some(s => y >= s.floor - 3 && y <= s.ceiling + 3) &&
              !(paving !== 0 && y > h - PLAZA_FOUNDATION - 4)) {
            // Layered caves: two connected worm-tunnel networks (union, so they
            // join up) PLUS occasional large CAVERNS — a low-freq 3D blob in a
            // deep band — so spelunking actually opens into rooms.
            const t1 = this.caves1.noise(wx * 0.022, y * 0.05, wz * 0.022);
            const t2 = this.caves2.noise(wx * 0.022 + 30, y * 0.05 - 30, wz * 0.022 + 30);
            if (Math.abs(t1) < 0.044 || Math.abs(t2) < 0.044) continue; // connecting galleries
            const depthFade = Math.min(1, (y - 7) / 12, (h - y - 5) / 16);
            if (y > 8 && depthFade > 0 &&
                this.caverns.noise(wx * 0.012, y * 0.023, wz * 0.012) > 0.56 + (1 - depthFade) * 0.35) continue;
          }

          chunk.set(lx, y, lz, id);
        }

        // Ocean / lake water up to sea level.
        for (let y = h + 1; y <= SEA_LEVEL; y++) {
          chunk.set(lx, y, lz, Block.Water);
        }

        this.caveLandscape.decorate(wx, wz, caveSlices,
          y => chunk.get(lx, y, lz), (y, id) => chunk.set(lx, y, lz, id));

        this.decorate(chunk, lx, lz, wx, wz, h, biome);
        this.oilSeep(chunk, lx, lz, wx, wz, h, biome);
      }
    }

    this.placeOres(chunk);
    this.placeCaveOres(chunk);
    this.plantTrees(chunk, ox, oz);
    this.placeStructures(chunk, ox, oz);
  }

  caveEntranceAt(x: number, z: number): boolean {
    return this.caveLandscape.entranceAt(x, z);
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
        const key = `${chunk.cx + dx},${chunk.cz + dz}`;
        let st = this.structureStampCache.get(key);
        if (st === undefined) {
          st = structureStamp(this.seed, chunk.cx + dx, chunk.cz + dz, this);
          if (this.structureStampCache.size >= 256) this.structureStampCache.clear();
          this.structureStampCache.set(key, st);
        }
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
    // Monument grounds stay swept: no tall grass, no boulders, and above all no
    // ice spikes — a 10-block snow-grass tower beside the flag was the single
    // ugliest thing generation could put there.
    if (plazaAt(wx, wz)) return;
    const r = hash2(this.seed ^ 0xdec0, wx, wz);

    if (biome === Biome.Desert) {
      if (r < 0.007) {
        const tall = 1 + Math.floor(hash2(this.seed ^ 0xcac, wx, wz) * 3);
        for (let i = 1; i <= tall; i++) chunk.set(lx, h + i, lz, Block.Cactus);
      } else if (r < 0.025) {
        chunk.set(lx, h + 1, lz, Block.DeadBush);
      } else if (r < 0.029) {
        // A weathered sandstone slab poking out of the dunes.
        chunk.set(lx, h + 1, lz, Block.Sandstone);
      }
      return;
    }

    // Mesa: dead bushes + occasional terracotta HOODOOS (2–5 tall pillars).
    if (biome === Biome.Mesa) {
      if (r < 0.022) {
        chunk.set(lx, h + 1, lz, Block.DeadBush);
      } else if (r < 0.026) {
        const tall = 2 + Math.floor(hash2(this.seed ^ 0x40d0, wx, wz) * 4);
        for (let i = 1; i <= tall; i++) chunk.set(lx, h + i, lz, Block.Terracotta);
      }
      return;
    }

    // Ashlands: jagged basalt spikes rising from the flats.
    if (biome === Biome.Ashlands) {
      if (r < 0.012) {
        const tall = 2 + Math.floor(hash2(this.seed ^ 0xba51, wx, wz) * 4);
        for (let i = 1; i <= tall; i++) chunk.set(lx, h + i, lz, Block.Basalt);
      }
      return;
    }

    // Crystalfields: scattered glowing crystal spikes, 1-4 blocks tall.
    if (biome === Biome.Crystalfields) {
      if (r < 0.025) {
        const tall = 1 + Math.floor(hash2(this.seed ^ 0xc59, wx, wz) * 4);
        for (let i = 1; i <= tall; i++) chunk.set(lx, h + i, lz, Block.CrystalBlock);
      }
      return;
    }
    // Swamps: dead bushes on the mud + sparse murky grass.
    if (biome === Biome.Swamp) {
      if (chunk.get(lx, h, lz) === Block.Water) return; // no plants on pools
      if (r < 0.012) chunk.set(lx, h + 1, lz, Block.GlowFungus);
      else if (r < 0.04) chunk.set(lx, h + 1, lz, Block.DeadBush);
      else if (r < 0.11) chunk.set(lx, h + 1, lz, Block.TallGrass);
      return;
    }

    // Ice spikes: tall frozen spires, the whole reason to visit the biome.
    // Built from PACKED SNOW, not snowy grass: the latter's sides are dirt, so
    // a twelve-block spire read as a tower of grass blocks rather than ice.
    if (biome === Biome.IceSpikes) {
      if (r < 0.02) {
        const tall = 4 + Math.floor(hash2(this.seed ^ 0x1ce5, wx, wz) * 8);
        for (let i = 1; i <= tall; i++) chunk.set(lx, h + i, lz, Block.PackedSnow);
        // A shoulder against the taller spires so they read as a frozen mass
        // rather than a row of fence posts. Clamped to the chunk: decorate only
        // owns this column, and a spike is not worth a cross-chunk stamp.
        if (tall > 7 && lx + 1 < CHUNK_X) {
          for (let i = 1; i <= tall - 3; i++) chunk.set(lx + 1, h + i, lz, Block.PackedSnow);
        }
      }
      return;
    }

    // Snowy plains / snowy taiga: only the odd shrub breaking the drifts.
    if (biome === Biome.Snowy) return;
    if (biome === Biome.SnowyTaiga) {
      if (r < 0.012) chunk.set(lx, h + 1, lz, Block.DeadBush);
      return;
    }

    // Bare alpine rock still gets the occasional boulder to break the slope.
    if (biome === Biome.Mountains || biome === Biome.SnowyMountains) {
      if (r < 0.004) chunk.set(lx, h + 1, lz, Block.Cobblestone);
      return;
    }

    const grassy = biome === Biome.Plains || biome === Biome.Forest ||
      biome === Biome.BirchForest || biome === Biome.Jungle ||
      biome === Biome.CherryGrove || biome === Biome.Savanna ||
      biome === Biome.Taiga || biome === Biome.AutumnForest ||
      biome === Biome.Meadow || biome === Biome.SunflowerPlains ||
      biome === Biome.Highlands || biome === Biome.RedwoodForest ||
      biome === Biome.Steppe || biome === Biome.Heath;
    if (!grassy) return;
    // How thickly the ground cover grows is a big part of a biome's identity:
    // a jungle floor you have to wade through, a steppe you can see across.
    const pGrass = biome === Biome.Jungle ? 0.3
      : biome === Biome.Meadow ? 0.26
      : biome === Biome.Savanna ? 0.22
      : biome === Biome.SunflowerPlains ? 0.2
      : biome === Biome.Heath ? 0.18
      : biome === Biome.Plains ? 0.16
      : biome === Biome.Highlands ? 0.15
      : biome === Biome.CherryGrove ? 0.14
      : biome === Biome.Taiga || biome === Biome.RedwoodForest ? 0.1
      : biome === Biome.Steppe ? 0.05
      : 0.1;
    // Flowers cluster into MEADOW PATCHES (a coarse 8×8 mask) so plains read as
    // fields with drifts of color instead of uniform speckle. Meadows and
    // sunflower plains ARE the drift, so they skip the mask entirely.
    const meadow = hash2(this.seed ^ 0xf10a, wx >> 3, wz >> 3) < 0.3;
    const pFlower = biome === Biome.Meadow ? 0.3
      : biome === Biome.SunflowerPlains ? 0.26
      : biome === Biome.Heath ? 0.16
      : biome === Biome.CherryGrove ? 0.06
      : biome === Biome.Highlands ? 0.08
      : biome === Biome.Savanna ? (meadow ? 0.04 : 0.01)
      : meadow ? 0.12
      : 0.01;
    if (r < pGrass) {
      chunk.set(lx, h + 1, lz, Block.TallGrass);
    } else if (r < pGrass + pFlower) {
      // Patches lean one color at a time (real drifts, not confetti).
      const poppyBias = biome === Biome.SunflowerPlains ? 0.05 // a yellow sea
        : biome === Biome.Heath ? 0.9   // heather moor: near-solid red-purple
        : biome === Biome.CherryGrove ? 0.85
        : biome === Biome.Meadow
          ? (hash2(this.seed ^ 0xf1f1, wx >> 3, wz >> 3) < 0.5 ? 0.8 : 0.2)
        : meadow ? (hash2(this.seed ^ 0xf1f1, wx >> 3, wz >> 3) < 0.5 ? 0.85 : 0.15)
        : 0.4;
      chunk.set(lx, h + 1, lz,
        hash2(this.seed ^ 0xf1, wx, wz) < poppyBias ? Block.Poppy : Block.Dandelion);
    } else if (biome === Biome.RedwoodForest && r < pGrass + pFlower + 0.006) {
      chunk.set(lx, h + 1, lz, Block.GlowFungus); // damp old-growth understory
    } else if (biome === Biome.Steppe && r < pGrass + pFlower + 0.02) {
      chunk.set(lx, h + 1, lz, Block.DeadBush);
    } else if (biome === Biome.Jungle && r < pGrass + pFlower + 0.008) {
      chunk.set(lx, h + 1, lz, Block.GlowFungus); // luminous jungle floor
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
  }

  /** One exposed vein per occupied 8×8×16 cave region. Sampling actual rock
   * faces avoids wasting veins in air, and stratification prevents long barren
   * stretches. Deep ores keep their depth limits and relative rarity. */
  private placeCaveOres(chunk: Chunk): void {
    const ox = chunk.cx * CHUNK_X, oz = chunk.cz * CHUNK_Z;
    const rock = (id: number) => id === Block.Stone || id === Block.Sandstone;
    const faces = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
    const heights = new Int16Array(256);
    for (let x = 0; x < 16; x++) for (let z = 0; z < 16; z++) {
      heights[x * 16 + z] = this.height(ox + x, oz + z) - 5;
    }
    for (let sx = 0; sx < 16; sx += 8) for (let sz = 0; sz < 16; sz += 8) {
      for (let sy = 4; sy < Math.min(240, chunk.maxY); sy += 16) {
        let best = Infinity;
        let seed: number[] | null = null;
        for (let x = sx; x < sx + 8; x++) for (let z = sz; z < sz + 8; z++) {
          for (let y = sy; y < Math.min(sy + 16, heights[x * 16 + z]); y++) {
            if (!rock(chunk.get(x, y, z))) continue;
            // Neighbour chunks need not exist yet. Only inspect real cells;
            // out-of-chunk reads must never masquerade as cave air.
            if (!faces.some(([dx, dy, dz]) => x + dx >= 0 && x + dx < 16 &&
              z + dz >= 0 && z + dz < 16 && chunk.get(x + dx, y + dy, z + dz) === Block.Air)) continue;
            const score = hash2(this.seed ^ 0xc0a7, (ox + x) * 256 + y, oz + z);
            if (score < best) { best = score; seed = [x, y, z]; }
          }
        }
        if (!seed) continue;
        const rng = mulberry32((hash2(this.seed ^ 0x0ae5, (ox + sx) * 256 + sy, oz + sz) * 0x100000000) >>> 0);
        // Coal continues through high mountain caves; precious ores stay deep.
        const eligible = ORES.filter(([id, , min, max]) => seed![1] >= min &&
          (id === Block.CoalOre || seed![1] <= max));
        if (!eligible.length) continue;
        let roll = rng() * eligible.reduce((sum, spec) => sum + spec[1], 0);
        const spec = eligible.find(s => (roll -= s[1]) < 0) ?? eligible[0];
        const [id, , minY, maxY] = spec;
        const pending = [seed];
        const visited = new Set<number>();
        const size = 3 + Math.floor(rng() * 4);
        let placed = 0;
        while (pending.length && placed < size) {
          const [x, y, z] = pending.splice(Math.floor(rng() * pending.length), 1)[0];
          if (x < sx || x >= sx + 8 || z < sz || z >= sz + 8 || y < sy || y >= sy + 16 ||
              y < minY || (id !== Block.CoalOre && y > maxY) || y >= heights[x * 16 + z]) continue;
          const key = x * 4096 + z * 256 + y;
          if (visited.has(key)) continue;
          visited.add(key);
          if (!rock(chunk.get(x, y, z))) continue;
          chunk.set(x, y, z, id); placed++;
          for (const [dx, dy, dz] of faces) pending.push([x + dx, y + dy, z + dz]);
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
          : tree.species === 'spruce' || tree.species === 'redwood' ? Block.SpruceLog
          : tree.species === 'jungle' ? Block.JungleLog
          : tree.species === 'cherry' ? Block.CherryLog
          : Block.OakLog;
        const leaves = tree.species === 'birch' ? Block.BirchLeaves
          : tree.species === 'spruce' || tree.species === 'redwood' ? Block.SpruceLeaves
          : tree.species === 'jungle' ? Block.JungleLeaves
          : tree.species === 'cherry' ? Block.CherryLeaves
          : Block.Leaves;

        stamp(tx, ground, tz, Block.Dirt); // grass under trunk -> dirt
        for (let y = ground + 1; y <= top; y++) stamp(tx, y, tz, log);

        if (tree.species === 'spruce') {
          this.spruceCanopy(stamp, tx, tz, top, tree.trunk, leaves);
        } else if (tree.species === 'redwood') {
          this.redwoodCanopy(stamp, tx, tz, ground, top, leaves);
        } else if (tree.species === 'acacia') {
          this.acaciaCanopy(stamp, tx, tz, top, leaves);
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

  /** Acacia: a bare trunk under one wide, FLAT crown. The silhouette is the
   *  whole point of a savanna — a plain of umbrellas against a gold horizon. */
  private acaciaCanopy(
    stamp: (x: number, y: number, z: number, id: number, keep?: boolean) => void,
    tx: number, tz: number, top: number, leaves: Block
  ): void {
    for (let layer = 0; layer < 2; layer++) {
      const y = top + layer;
      const r = layer === 0 ? 3 : 2;
      for (let dx = -r; dx <= r; dx++) {
        for (let dz = -r; dz <= r; dz++) {
          if (Math.abs(dx) + Math.abs(dz) > r + 1) continue; // rounded plate
          if (layer === 0 && dx === 0 && dz === 0) continue; // trunk pokes through
          stamp(tx + dx, y, tz + dz, leaves, true);
        }
      }
    }
  }

  /** Redwood: a very tall bare column carrying a narrow crown, with a few
   *  boughs breaking out of the shaft on the way up. Standing under one and
   *  looking for the top is the entire experience of an old-growth stand. */
  private redwoodCanopy(
    stamp: (x: number, y: number, z: number, id: number, keep?: boolean) => void,
    tx: number, tz: number, ground: number, top: number, leaves: Block
  ): void {
    // Scattered boughs over the upper half of the shaft.
    const boughStart = ground + Math.floor((top - ground) * 0.55);
    for (let y = boughStart; y < top - 3; y += 3) {
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        if (hash2(this.seed ^ 0xb041, tx + dx, tz + dz + y) < 0.45) continue;
        stamp(tx + dx, y, tz + dz, leaves, true);
        stamp(tx + dx * 2, y, tz + dz * 2, leaves, true);
      }
    }
    // The crown: three tapering rings and a cap.
    for (let i = 0; i < 4; i++) {
      const y = top - 3 + i;
      const r = i === 0 ? 3 : i === 1 ? 2 : 1;
      for (let dx = -r; dx <= r; dx++) {
        for (let dz = -r; dz <= r; dz++) {
          if (dx * dx + dz * dz > r * r + 1) continue;
          if (dx === 0 && dz === 0 && y <= top) continue;
          stamp(tx + dx, y, tz + dz, leaves, true);
        }
      }
    }
    stamp(tx, top + 1, tz, leaves, true);
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

  /** True if any tree could stamp a trunk or canopy into this column. Trees
   *  reach at most TREE_MARGIN blocks sideways — the exact window plantTrees
   *  itself scans — so testing that neighbourhood is complete by construction,
   *  and stays correct if the canopy shapes are ever retuned. */
  private underFoliage(x: number, z: number): boolean {
    for (let dx = -TREE_MARGIN; dx <= TREE_MARGIN; dx++) {
      for (let dz = -TREE_MARGIN; dz <= TREE_MARGIN; dz++) {
        if (this.treeAt(x + dx, z + dz)) return true;
      }
    }
    return false;
  }

  /** A column is safe to stand on at spawn: solid ground comfortably above sea
   *  level, NOT carved open by a ravine (which would leave you in mid-air), NOT
   *  a water/beach biome, NOT ashlands (surface lava), NOT under a tree (the
   *  ground is clear but your head is inside the canopy), and surrounded by dry
   *  land so you don't land on a lone spike at the water's edge. */
  private safeSpawnColumn(x: number, z: number): boolean {
    const h = this.height(x, z);
    if (h < SEA_LEVEL + 3) return false;            // would be at/near water
    if (this.ravineDepth(x, z) > 0) return false;   // surface carved -> air/fall
    if (this.caveEntranceAt(x, z)) return false;
    const cx = Math.floor(x / 16), cz = Math.floor(z / 16);
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      const site = structureSite(this.seed, cx + dx, cz + dz, this);
      if (site && Math.abs(x - site.x) <= 15 && Math.abs(z - site.z) <= 15) return false;
    }
    const biome = this.biomeWithWater(x, z, h);
    if (biome === Biome.Ocean || biome === Biome.Beach || biome === Biome.Ashlands) return false;
    // A canopy overhead leaves no headroom, which the server's respawn-safety
    // check rejects — so a "spawn" here would silently relocate the player.
    if (this.underFoliage(x, z)) return false;
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
