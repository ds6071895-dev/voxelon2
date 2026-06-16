// Biomes: temperature + humidity noise select the biome; grass/foliage tints
// come from a continuous vanilla-style temp/rainfall colormap, so tint blends
// smoothly across biome borders for free.

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
};

export type Tint = readonly [number, number, number];
export interface ColumnTints {
  grass: Tint;
  foliage: Tint;
}

function hex(h: number): [number, number, number] {
  return [((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255];
}
function lerp3(
  a: readonly number[], b: readonly number[], t: number
): [number, number, number] {
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ];
}

// Colormap anchors (approximating vanilla grass.png corners).
const COLD = hex(0x80b497);
const HOT_DRY = hex(0xbfb755);
const LUSH = hex(0x55c93f);

// Larger than the previous 0.0022 so biomes read as real regions (~700-1000
// blocks across) while several octaves keep enough variety that no single
// biome takes over the world.
const CLIMATE_SCALE = 0.0013;
const MOUNTAIN_SCALE = 0.0016; // mountain ranges ~600 blocks across

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

export class Biomes {
  private readonly temp: Noise2D;
  private readonly humid: Noise2D;
  private readonly relief: Noise2D;

  constructor(seed: number) {
    this.temp = new Noise2D(seed ^ 0x7e47);
    this.humid = new Noise2D(seed ^ 0x40d1);
    this.relief = new Noise2D(seed ^ 0x3033);
  }

  /** Temperature and humidity in [0, 1]. */
  climate(x: number, z: number): [number, number] {
    const t = this.temp.fbm(x * CLIMATE_SCALE, z * CLIMATE_SCALE, 3);
    const m = this.humid.fbm(x * CLIMATE_SCALE * 1.31, z * CLIMATE_SCALE * 1.31, 3);
    return [
      Math.min(1, Math.max(0, 0.5 + t * 0.95)),
      Math.min(1, Math.max(0, 0.5 + m * 0.95)),
    ];
  }

  /**
   * Mountainousness in [0, 1], smooth (no cliffs at borders). Zero across
   * most of the world; ramps up only in the high tail of the relief field,
   * so mountains form bounded ranges rather than covering everything.
   */
  mountainFactor(x: number, z: number): number {
    const n = this.relief.fbm(x * MOUNTAIN_SCALE, z * MOUNTAIN_SCALE, 4);
    return smoothstep(0.58, 0.82, 0.5 + 0.5 * n);
  }

  /** Flat-land biome at a column (Ocean/Beach/Mountains decided in terrain). */
  biomeAt(x: number, z: number): Biome {
    const [t, m] = this.climate(x, z);
    if (t < 0.32) return Biome.Snowy;
    if (t > 0.68 && m < 0.5) return Biome.Desert;
    if (m > 0.7) return Biome.BirchForest;
    if (m > 0.52) return Biome.Forest;
    return Biome.Plains;
  }

  /** Grass + foliage tint for a column, continuous across biome borders. */
  tints(x: number, z: number): ColumnTints {
    const [t, m] = this.climate(x, z);
    const s = t * t * (3 - 2 * t); // smoothstep on temperature
    const warm = lerp3(HOT_DRY, LUSH, m);
    const grass = lerp3(COLD, warm, s);
    // Foliage: darker and greener than grass, like vanilla foliage.png.
    const foliage: Tint = [grass[0] * 0.74, grass[1] * 0.9, grass[2] * 0.62];
    return { grass, foliage };
  }
}
