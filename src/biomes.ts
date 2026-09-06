// Biomes: temperature + humidity + a "variant" field select the biome; the
// grass/foliage/water tints come from a CONTINUOUS climate colormap rather
// than from the discrete biome, so colour blends smoothly across every border
// for free while still landing on the hue each biome is meant to read as.
//
// v0.45 "Living World": the climate grid was widened from 9 biomes to 27 and
// every cell of it is a *common* cell — the third (variant) field splits each
// climate cell into sibling biomes, so travelling in any direction crosses new
// country instead of the same three fields. Regions are also ~2x smaller than
// before, so you meet them at walking pace.

import type { BiomeSound } from './audio';
import { inCore } from './net/protocol';
import { Noise2D } from './noise';

export enum Biome {
  Ocean = 0,
  Beach = 1,
  Plains = 2,
  Forest = 3,
  BirchForest = 4,
  Desert = 5,
  Snowy = 6,
  Mountains = 7,
  SnowyMountains = 8,
  // Terrain overhaul (M21): two signature biomes that change the silhouette.
  Mesa = 9,       // banded badlands cliffs (red sand + terracotta)
  Ashlands = 10,  // volcanic basalt flats with surface lava
  // Discovery biomes (Milestone C).
  Jungle = 11,        // hot + soaked: tall two-canopy trees, dense grass
  Swamp = 12,         // flattened near-water lowlands, mud + pools
  CherryGrove = 13,   // gentle pink-canopied hills
  Crystalfields = 14, // WILDS-ONLY: pale ground + glowing crystal spikes
  // v0.45 "Living World": twelve everyday biomes that fill in the climate grid.
  Savanna = 15,         // hot dry gold grassland, flat-crowned acacias
  Taiga = 16,           // cold conifer forest, deep blue-green floor
  SnowyTaiga = 17,      // the same under snow
  AutumnForest = 18,    // cool broadleaf woods in permanent autumn colour
  Meadow = 19,          // alpine flower meadow — drifts of colour, few trees
  SunflowerPlains = 20, // bright yellow-flower plains
  IceSpikes = 21,       // frozen barrens studded with tall snow spires
  Highlands = 22,       // green alpine shoulders below the rock line
  RedwoodForest = 23,   // old-growth giant conifers over podzol
  TropicalCoast = 24,   // white sand + turquoise shallows
  Steppe = 25,          // dry short-grass plain between desert and prairie
  Heath = 26,           // cool purple-flowered moorland over rocky ground
}

export const BIOME_NAMES: Record<Biome, string> = {
  [Biome.Ocean]: 'Ocean',
  [Biome.Beach]: 'Beach',
  [Biome.Plains]: 'Plains',
  [Biome.Forest]: 'Forest',
  [Biome.BirchForest]: 'Birch Forest',
  [Biome.Desert]: 'Desert',
  [Biome.Snowy]: 'Snowy Plains',
  [Biome.Mountains]: 'Mountains',
  [Biome.SnowyMountains]: 'Snowy Mountains',
  [Biome.Mesa]: 'Mesa',
  [Biome.Ashlands]: 'Ashlands',
  [Biome.Jungle]: 'Jungle',
  [Biome.Swamp]: 'Swamp',
  [Biome.CherryGrove]: 'Cherry Grove',
  [Biome.Crystalfields]: 'Crystalfields',
  [Biome.Savanna]: 'Savanna',
  [Biome.Taiga]: 'Taiga',
  [Biome.SnowyTaiga]: 'Snowy Taiga',
  [Biome.AutumnForest]: 'Autumn Forest',
  [Biome.Meadow]: 'Meadow',
  [Biome.SunflowerPlains]: 'Sunflower Plains',
  [Biome.IceSpikes]: 'Ice Spikes',
  [Biome.Highlands]: 'Highlands',
  [Biome.RedwoodForest]: 'Redwood Forest',
  [Biome.TropicalCoast]: 'Tropical Coast',
  [Biome.Steppe]: 'Steppe',
  [Biome.Heath]: 'Heath',
};

/** Which ambience family a biome sounds like. Kept beside the biome table so a
 *  new biome cannot be added without deciding what it sounds like. */
export const BIOME_SOUND: Record<Biome, BiomeSound> = {
  [Biome.Ocean]: 'ocean',
  [Biome.Beach]: 'ocean',
  [Biome.TropicalCoast]: 'ocean',
  [Biome.Plains]: 'plains',
  [Biome.SunflowerPlains]: 'plains',
  [Biome.Meadow]: 'plains',
  [Biome.Heath]: 'plains',
  [Biome.Steppe]: 'plains',
  [Biome.Savanna]: 'plains',
  [Biome.Forest]: 'forest',
  [Biome.BirchForest]: 'forest',
  [Biome.AutumnForest]: 'forest',
  [Biome.CherryGrove]: 'forest',
  [Biome.Taiga]: 'forest',
  [Biome.RedwoodForest]: 'forest',
  [Biome.Jungle]: 'jungle',
  [Biome.Swamp]: 'swamp',
  [Biome.Desert]: 'desert',
  [Biome.Mesa]: 'desert',
  [Biome.Snowy]: 'snow',
  [Biome.SnowyTaiga]: 'snow',
  [Biome.IceSpikes]: 'snow',
  [Biome.Mountains]: 'mountain',
  [Biome.SnowyMountains]: 'mountain',
  [Biome.Highlands]: 'mountain',
  [Biome.Ashlands]: 'ashlands',
  [Biome.Crystalfields]: 'crystal',
};

export type Tint = readonly [number, number, number];
export interface ColumnTints {
  grass: Tint;
  foliage: Tint;
  /** Water surface tint: polar blue -> ocean blue -> tropical turquoise, and
   *  murky green in swamps. Water used to be one flat colour everywhere. */
  water: Tint;
}

function hex(h: number): [number, number, number] {
  return [((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255];
}
function lerp3(
  a: readonly number[], b: readonly number[], t: number
): [number, number, number] {
  const k = t < 0 ? 0 : t > 1 ? 1 : t;
  return [
    a[0] + (b[0] - a[0]) * k,
    a[1] + (b[1] - a[1]) * k,
    a[2] + (b[2] - a[2]) * k,
  ];
}

/** Push a colour away from its own grey. The tile art is grayscale, so this is
 *  the only lever that decides how vivid the world reads. */
function saturate(c: readonly number[], k: number): [number, number, number] {
  const l = c[0] * 0.299 + c[1] * 0.587 + c[2] * 0.114;
  const f = (v: number) => Math.min(1, Math.max(0, l + (v - l) * k));
  return [f(c[0]), f(c[1]), f(c[2])];
}

// --- Climate colour anchors --------------------------------------------------
// Deliberately far more saturated than the classic muted colormap: the world
// brief is "vibrant", and every one of these is the *only* source of colour for
// the grayscale grass/leaf tiles it lands on.
const FRIGID = hex(0x63e0b4);   // polar mint
const ARID = hex(0xecd447);     // straw gold
const LUSH = hex(0x35e81c);     // vivid spring green
const JUNGLE_G = hex(0x14e83f); // saturated emerald
const SAVANNA_G = hex(0xe6c132);// hot gold grassland
const TAIGA_G = hex(0x3fd49a);  // cold conifer blue-green
const MEADOW_G = hex(0x8bf53a); // bright flowering meadow
const AUTUMN_G = hex(0xd9a12c); // dry autumn straw
const HEATH_G = hex(0xa8cf5e);  // pale moorland

// Foliage picks up its own pulls so canopies are not merely darker grass.
const JUNGLE_F = hex(0x0fc93a);
const TAIGA_F = hex(0x1f9e6b);
const AUTUMN_F = hex(0xff7a1f); // the whole point of Autumn Forest
const SAVANNA_F = hex(0xbfae3a);

// Water anchors. These ARE the water colour now — the tile beneath them is a
// near-neutral pale wash carrying nothing but the ripple texture.
const WATER_POLAR = hex(0x3c78c4);
const WATER_TEMPERATE = hex(0x2f8fe0);
const WATER_TROPICAL = hex(0x1fd8cc);
const WATER_SWAMP = hex(0x53743e);

// Biomes read as real regions but at HALF the old span, so a walk crosses
// several of them instead of spending ten minutes in one field.
const CLIMATE_SCALE = 0.0024;
const VARIANT_SCALE = 0.0042;  // sub-biome patchwork inside a climate cell
const MOUNTAIN_SCALE = 0.0016; // mountain ranges ~600 blocks across

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/**
 * Spread a raw fbm value (roughly Gaussian, and therefore piled up around its
 * own mean) into something far closer to uniform over [0,1].
 *
 * This is the single biggest reason biomes used to feel rare. Any threshold you
 * set out in the tail of a bell curve — "hot AND dry", "the high half of the
 * variant field" — selects a sliver of the world no matter how reasonable it
 * looks written down, because almost every column sits near the middle. Pushing
 * the field through a logistic (a stand-in for the Gaussian CDF) makes each
 * slice of the climate square cover about as much ground as it looks like it
 * should, which is what turns twelve new biomes into twelve you actually meet.
 */
function spread(n: number, gain: number): number {
  return 1 / (1 + Math.exp(-n * gain));
}

/** Bump in [0,1]: rises over [a,b], holds, falls over [c,d]. */
function bump(x: number, a: number, b: number, c: number, d: number): number {
  return smoothstep(a, b, x) * (1 - smoothstep(c, d, x));
}

// Same reasoning as terrain's height cache: climate() is asked for the same
// column by biomeAt, biomeWithWater, tints, the tree table and the surface
// picker, and each call is six noise octaves.
const CLIMATE_CACHE = 1 << 14;

export class Biomes {
  private readonly temp: Noise2D;
  private readonly humid: Noise2D;
  private readonly variantField: Noise2D;
  private readonly relief: Noise2D;
  private readonly chain: Noise2D;
  private readonly ashField: Noise2D;
  private readonly swampField: Noise2D;
  private readonly crystalField: Noise2D;

  constructor(seed: number) {
    this.temp = new Noise2D(seed ^ 0x7e47);
    this.humid = new Noise2D(seed ^ 0x40d1);
    this.variantField = new Noise2D(seed ^ 0x2b19); // sibling-biome selector
    this.relief = new Noise2D(seed ^ 0x3033);
    this.chain = new Noise2D(seed ^ 0x6c11);        // elongates ranges
    this.ashField = new Noise2D(seed ^ 0x1a57);     // volcanic-zone mask
    this.swampField = new Noise2D(seed ^ 0x50a3);   // bounded swamp lowlands
    this.crystalField = new Noise2D(seed ^ 0xc757); // Wilds crystal zones
  }

  // cv < 0 marks an empty slot (climate values are always in [0,1]).
  private readonly cx = new Int32Array(CLIMATE_CACHE);
  private readonly cz = new Int32Array(CLIMATE_CACHE);
  // Float64, not Float32: terrain must be bit-identical on every client, and a
  // Float32 store would round a cached value differently from a freshly
  // computed one — enough to flip a column across a biome threshold on one
  // machine and not another.
  private readonly ct = new Float64Array(CLIMATE_CACHE).fill(-1);
  private readonly cm = new Float64Array(CLIMATE_CACHE);
  // mountainFactor and biomeAt get the same treatment: both are pure, both are
  // asked for the same column from several call sites per generated chunk, and
  // biomeAt in particular is ~17 noise octaves once the special-zone masks are
  // counted. bv 0 marks an empty biome slot (Ocean is never returned here).
  private readonly mfx = new Int32Array(CLIMATE_CACHE);
  private readonly mfz = new Int32Array(CLIMATE_CACHE);
  private readonly mfv = new Float64Array(CLIMATE_CACHE).fill(-1);
  private readonly bx = new Int32Array(CLIMATE_CACHE);
  private readonly bz = new Int32Array(CLIMATE_CACHE);
  private readonly bv = new Uint8Array(CLIMATE_CACHE);

  /** Swamp-zone strength in [0,1] (bounded lowland regions). */
  swampMask(x: number, z: number): number {
    return 0.5 + 0.5 * this.swampField.fbm(x * 0.0026, z * 0.0026, 3);
  }

  /** Continuous swamp FLATTENING factor in [0,1]: terrain.height() pulls the
   *  surface toward sea level by this much, so swamps really are lowlands.
   *  Purely mask-driven (no climate gates) so the surface stays continuous. */
  swampFlat(x: number, z: number): number {
    return smoothstep(0.57, 0.69, this.swampMask(x, z));
  }

  /** Crystalfields-zone strength in [0,1] (Wilds-gated in biomeAt so the
   *  exclusive biome only exists outside the Heartland core). */
  crystalMask(x: number, z: number): number {
    return 0.5 + 0.5 * this.crystalField.fbm(x * 0.0022, z * 0.0022, 3);
  }

  /** Volcanic-zone strength in [0,1] (bounded ashlands regions). */
  ashFactor(x: number, z: number): number {
    return 0.5 + 0.5 * this.ashField.fbm(x * 0.0021, z * 0.0021, 3);
  }

  /** Sub-biome selector in [0,1]. Splits each climate cell into siblings, which
   *  is what turns a 9-cell grid into 27 biomes without shrinking any of them
   *  into rarities. */
  variant(x: number, z: number): number {
    return spread(this.variantField.fbm(x * VARIANT_SCALE, z * VARIANT_SCALE, 3), 8.5);
  }

  /** Temperature and humidity in [0, 1]. */
  climate(x: number, z: number): [number, number] {
    const xi = x | 0, zi = z | 0;
    let slot = -1;
    if (xi === x && zi === z) {
      slot = (Math.imul(xi, 0x9e3779b1) ^ Math.imul(zi, 0x85ebca77)) & (CLIMATE_CACHE - 1);
      if (this.ct[slot] >= 0 && this.cx[slot] === xi && this.cz[slot] === zi) {
        return [this.ct[slot], this.cm[slot]];
      }
    }
    const t = this.temp.fbm(x * CLIMATE_SCALE, z * CLIMATE_SCALE, 3);
    const m = this.humid.fbm(x * CLIMATE_SCALE * 1.31, z * CLIMATE_SCALE * 1.31, 3);
    // Spread (see above) so the hot, cold, arid and soaked corners of the
    // climate square are ordinary places rather than statistical accidents.
    const ts = spread(t, 5.2);
    const ms = spread(m, 5.2);
    if (slot >= 0) {
      this.cx[slot] = xi;
      this.cz[slot] = zi;
      this.ct[slot] = ts;
      this.cm[slot] = ms;
    }
    return [ts, ms];
  }

  /**
   * Mountainousness in [0, 1], smooth (no cliffs at borders). A ridged "chain"
   * field multiplies the blobby relief field, which is what turns round lumps
   * into long cordilleras with passes between them — ranges you can follow.
   */
  mountainFactor(x: number, z: number): number {
    const xi = x | 0, zi = z | 0;
    let slot = -1;
    if (xi === x && zi === z) {
      slot = (Math.imul(xi, 0x9e3779b1) ^ Math.imul(zi, 0x85ebca77)) & (CLIMATE_CACHE - 1);
      if (this.mfv[slot] >= 0 && this.mfx[slot] === xi && this.mfz[slot] === zi) {
        return this.mfv[slot];
      }
    }
    const v = this.computeMountainFactor(x, z);
    if (slot >= 0) {
      this.mfx[slot] = xi;
      this.mfz[slot] = zi;
      this.mfv[slot] = v;
    }
    return v;
  }

  private computeMountainFactor(x: number, z: number): number {
    const n = this.relief.fbm(x * MOUNTAIN_SCALE, z * MOUNTAIN_SCALE, 4);
    // Ranges are a common sight but not the default terrain: every column a
    // mountain takes is a column no lowland biome can be.
    const base = smoothstep(0.485, 0.795, 0.5 + 0.5 * n);
    if (base <= 0) return 0;
    const spine = 1 - Math.abs(
      this.chain.fbm(x * MOUNTAIN_SCALE * 0.55, z * MOUNTAIN_SCALE * 0.55, 2));
    return base * (0.5 + 0.5 * smoothstep(0.28, 0.94, spine));
  }

  /** Flat-land biome at a column (Ocean/Beach/Mountains decided in terrain). */
  biomeAt(x: number, z: number): Biome {
    const xi = x | 0, zi = z | 0;
    let slot = -1;
    if (xi === x && zi === z) {
      slot = (Math.imul(xi, 0x9e3779b1) ^ Math.imul(zi, 0x85ebca77)) & (CLIMATE_CACHE - 1);
      if (this.bv[slot] !== 0 && this.bx[slot] === xi && this.bz[slot] === zi) {
        return (this.bv[slot] - 1) as Biome;
      }
    }
    const b = this.computeBiomeAt(x, z);
    if (slot >= 0) {
      this.bx[slot] = xi;
      this.bz[slot] = zi;
      this.bv[slot] = b + 1;
    }
    return b;
  }

  private computeBiomeAt(x: number, z: number): Biome {
    const [t, m] = this.climate(x, z);
    const v = this.variant(x, z);

    // --- Special zones, each on its own mask so they are regions, not noise.
    // Loosened from the old thresholds: these were showpieces you could play a
    // whole session without meeting. They are landmarks now, not lottery wins.
    if (t > 0.42 && this.ashFactor(x, z) > 0.68) return Biome.Ashlands;
    if (!inCore(x, z) && this.crystalMask(x, z) > 0.72) return Biome.Crystalfields;
    if (this.swampFlat(x, z) > 0.5 && t >= 0.3 && t <= 0.74 && m > 0.38) return Biome.Swamp;

    // --- The climate grid. Every branch below is a common outcome.
    if (t < 0.22) {
      // Frigid. Dry cold cracks into ice-spike barrens; wet cold is snowy taiga.
      if (m < 0.34) return v > 0.58 ? Biome.IceSpikes : Biome.Snowy;
      if (m > 0.54) return Biome.SnowyTaiga;
      return v > 0.62 ? Biome.IceSpikes : Biome.Snowy;
    }
    if (t < 0.4) {
      // Cold. Conifers, cherry hills and heather moor.
      if (m > 0.64) return v > 0.44 ? Biome.RedwoodForest : Biome.Taiga;
      if (m > 0.44) return v > 0.44 ? Biome.CherryGrove : Biome.Taiga;
      if (m > 0.3) return v > 0.5 ? Biome.Meadow : Biome.Heath;
      return v > 0.6 ? Biome.Snowy : Biome.Heath;
    }
    if (t < 0.6) {
      // Temperate. The broadleaf belt.
      if (m > 0.66) return v > 0.48 ? Biome.BirchForest : Biome.Forest;
      if (m > 0.48) return v > 0.44 ? Biome.AutumnForest : Biome.Forest;
      if (m > 0.32) {
        // Meadow sits at the top of the variant field here and in the cold
        // band, which is where the meadow colour pull in tints() peaks — the
        // biome and its colour have to agree on which columns they mean.
        return v > 0.66 ? Biome.Meadow
          : v > 0.28 ? Biome.SunflowerPlains : Biome.Plains;
      }
      return v > 0.5 ? Biome.Steppe : Biome.Plains;
    }
    if (t < 0.79) {
      // Warm. Grassland gives way to savanna and the first jungles.
      if (m > 0.68) return Biome.Jungle;
      if (m > 0.46) return v > 0.52 ? Biome.Savanna : Biome.Forest;
      if (m > 0.26) return v > 0.4 ? Biome.Savanna : Biome.Steppe;
      return Biome.Desert;
    }
    // Hot.
    if (m > 0.62) return Biome.Jungle;
    if (m > 0.38) return Biome.Savanna;
    if (m > 0.18) return v > 0.55 ? Biome.Mesa : Biome.Desert;
    return Biome.Mesa;
  }

  /** Grass + foliage + water tint for a column, continuous across borders.
   *  Driven by the same (t, m, v) fields the biome choice reads, so the colour
   *  always lands on the biome's identity WITHOUT inheriting its hard edges. */
  tints(x: number, z: number): ColumnTints {
    const [t, m] = this.climate(x, z);
    const v = this.variant(x, z);
    const s = t * t * (3 - 2 * t); // smoothstep on temperature

    // Base climate colormap.
    let grass = lerp3(FRIGID, lerp3(ARID, LUSH, m), s);
    let foliage: readonly number[] = [grass[0] * 0.82, grass[1] * 1.0, grass[2] * 0.6];

    // Cold conifer belt -> blue-green.
    const taiga = bump(t, 0.16, 0.3, 0.44, 0.58) * smoothstep(0.36, 0.62, m);
    grass = lerp3(grass, TAIGA_G, taiga * 0.6);
    foliage = lerp3(foliage, TAIGA_F, taiga * 0.7);

    // Autumn belt: the cool broadleaf band on the high side of the variant
    // field. Grass goes straw, canopies go orange — visible for miles.
    // Windowed on all three fields to match biomeAt's AutumnForest cell
    // (temperate, m in 0.48-0.66, v > 0.44). Without the upper humidity bound
    // the pull spilled into the birch belt next door, which ended up wearing
    // more autumn colour than Autumn Forest itself.
    const autumn = bump(t, 0.36, 0.46, 0.6, 0.74) *
      bump(m, 0.42, 0.5, 0.64, 0.72) * smoothstep(0.38, 0.52, v);
    grass = lerp3(grass, AUTUMN_G, autumn * 0.7);
    foliage = lerp3(foliage, AUTUMN_F, autumn * 0.88);

    // Flowering meadow band -> brighter, yellower green.
    const meadow = bump(t, 0.28, 0.4, 0.6, 0.74) *
      bump(m, 0.24, 0.34, 0.56, 0.7) * smoothstep(0.5, 0.66, v);
    grass = lerp3(grass, MEADOW_G, meadow * 0.55);

    // Heath/moor -> pale sage.
    const heath = bump(t, 0.24, 0.34, 0.44, 0.56) * (1 - smoothstep(0.24, 0.4, m));
    grass = lerp3(grass, HEATH_G, heath * 0.5);

    // Savanna gold: hot, middling-dry.
    const savanna = smoothstep(0.56, 0.7, t) * bump(m, 0.16, 0.3, 0.5, 0.68);
    grass = lerp3(grass, SAVANNA_G, savanna * 0.85);
    foliage = lerp3(foliage, SAVANNA_F, savanna * 0.7);

    // Jungle emerald: hot and soaked.
    const jungle = smoothstep(0.52, 0.7, t) * smoothstep(0.54, 0.74, m);
    grass = lerp3(grass, JUNGLE_G, jungle * 0.75);
    foliage = lerp3(foliage, JUNGLE_F, jungle * 0.8);

    // Swamps darken the grass toward a murky olive (continuous via the mask).
    const sw = this.swampFlat(x, z);
    if (sw > 0) {
      grass = lerp3(grass, [grass[0] * 0.62, grass[1] * 0.72, grass[2] * 0.5], sw);
      foliage = lerp3(foliage, [foliage[0] * 0.6, foliage[1] * 0.7, foliage[2] * 0.48], sw);
    }

    // Water: polar -> temperate -> tropical, murked in swamps.
    let water = lerp3(WATER_POLAR, WATER_TEMPERATE, smoothstep(0.14, 0.5, t));
    water = lerp3(water, WATER_TROPICAL, smoothstep(0.56, 0.84, t) * smoothstep(0.2, 0.55, m));
    water = lerp3(water, WATER_SWAMP, sw * 0.75);

    // Final vibrance pass. The tiles are grayscale; without this the whole
    // world sits at the desaturated end no matter which anchors were picked.
    return {
      grass: saturate(grass, 1.22),
      foliage: saturate(foliage, 1.18),
      water: saturate(water, 1.15),
    };
  }
}
