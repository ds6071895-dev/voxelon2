// Biomes: temperature + humidity noise select the biome; grass/foliage tints
// come from a continuous vanilla-style temp/rainfall colormap, so tint blends
// smoothly across biome borders for free.

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
  CherryGrove = 13,   // gentle pink-canopied hills (the screenshot biome)
  Crystalfields = 14, // WILDS-ONLY: pale ground + glowing crystal spikes
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
// Colormap anchors, pushed richer than the classic muted set so grass reads as
// vivid as the modern game's (the tiles themselves are grayscale — all of the
// grass/leaf color comes from here).
const COLD = hex(0x74c8a0);
const HOT_DRY = hex(0xcfc44a);
const LUSH = hex(0x48d92f);

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
  private readonly ashField: Noise2D;
  private readonly swampField: Noise2D;
  private readonly crystalField: Noise2D;

  constructor(seed: number) {
    this.temp = new Noise2D(seed ^ 0x7e47);
    this.humid = new Noise2D(seed ^ 0x40d1);
    this.relief = new Noise2D(seed ^ 0x3033);
    this.ashField = new Noise2D(seed ^ 0x1a57); // volcanic-zone mask
    this.swampField = new Noise2D(seed ^ 0x50a3);   // bounded swamp lowlands
    this.crystalField = new Noise2D(seed ^ 0xc757); // Wilds crystal zones
  }

  /** Swamp-zone strength in [0,1] (bounded lowland regions). */
  swampMask(x: number, z: number): number {
    return 0.5 + 0.5 * this.swampField.fbm(x * 0.0021, z * 0.0021, 3);
  }

  /** Continuous swamp FLATTENING factor in [0,1]: terrain.height() pulls the
   *  surface toward sea level by this much, so swamps really are lowlands.
   *  Purely mask-driven (no climate gates) so the surface stays continuous. */
  swampFlat(x: number, z: number): number {
    return smoothstep(0.72, 0.8, this.swampMask(x, z));
  }

  /** Crystalfields-zone strength in [0,1] (rare bounded zones, Wilds-gated in
   *  biomeAt so the exclusive biome only exists outside the Heartland core). */
  crystalMask(x: number, z: number): number {
    return 0.5 + 0.5 * this.crystalField.fbm(x * 0.0017, z * 0.0017, 3);
  }

  /** Volcanic-zone strength in [0,1] (bounded ashlands regions). */
  ashFactor(x: number, z: number): number {
    return 0.5 + 0.5 * this.ashField.fbm(x * 0.0015, z * 0.0015, 3);
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
    // Volcanic ashlands form rare, bounded zones (a dedicated mask), overriding
    // the climate biome on hot-enough ground so they read as a distinct region.
    const [t, m] = this.climate(x, z);
    if (t > 0.4 && this.ashFactor(x, z) > 0.74) return Biome.Ashlands;
    // Crystalfields: rare bounded zones with an EXCLUSIVE rule — only in the
    // Wilds (outside the Heartland core), so the far world has its own draw.
    if (!inCore(x, z) && this.crystalMask(x, z) > 0.78) return Biome.Crystalfields;
    // Swamps: bounded lowland zones on mild, wet-enough ground (the terrain
    // flattens to near sea level over the same mask — see swampFlat).
    if (this.swampFlat(x, z) > 0.5 && t >= 0.32 && t <= 0.72 && m > 0.4) return Biome.Swamp;
    if (t < 0.32) return Biome.Snowy;
    // Mesa/badlands: the very hottest, driest land (a slice drier than desert).
    if (t > 0.7 && m < 0.24) return Biome.Mesa;
    if (t > 0.68 && m < 0.5) return Biome.Desert;
    // Jungle: the hottest, wettest slice (carved off the old birch-forest band).
    if (t > 0.55 && m > 0.7) return Biome.Jungle;
    // Cherry grove: cool-but-not-snowy, moist gentle hills.
    if (t < 0.48 && m > 0.6) return Biome.CherryGrove;
    if (m > 0.7) return Biome.BirchForest;
    if (m > 0.52) return Biome.Forest;
    return Biome.Plains;
  }

  /** Grass + foliage tint for a column, continuous across biome borders. */
  tints(x: number, z: number): ColumnTints {
    const [t, m] = this.climate(x, z);
    const s = t * t * (3 - 2 * t); // smoothstep on temperature
    const warm = lerp3(HOT_DRY, LUSH, m);
    let grass = lerp3(COLD, warm, s);
    // Swamps darken the grass toward a murky olive (continuous via the mask).
    const sw = this.swampFlat(x, z);
    if (sw > 0) grass = lerp3(grass, [grass[0] * 0.62, grass[1] * 0.72, grass[2] * 0.5], sw);
    // Foliage: darker and greener than grass, like vanilla foliage.png.
    const foliage: Tint = [grass[0] * 0.8, grass[1] * 0.97, grass[2] * 0.6];
    return { grass, foliage };
  }
}
