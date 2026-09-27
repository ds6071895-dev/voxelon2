// Column colour tints (grass, foliage, water) the mesher applies. Split out of
// VOXELON's biome module: Worlds' venues have no biomes, only a palette each.

/** Linear RGB multiplier, 0..1 per channel. */
export type Tint = readonly [number, number, number];

export interface ColumnTints {
  grass: Tint;
  foliage: Tint;
  /** Water surface tint. */
  water: Tint;
}
