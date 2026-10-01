import { Block } from './blocks';

/** The blocks a theme builds its set pieces from. Every slot is an ordinary
 *  block, so a castle in Sugarspun Skies is the same castle as one in the
 *  Emberforge Isles — only its materials change. */
export interface ParkourPalette {
  /** Main masonry: walls, piers, towers. */
  stone: number;
  /** Second masonry: courses, bands, broken tops. */
  brick: number;
  /** Quoins, lintels, caps and columns. */
  trim: number;
  wood: number;
  /** Posts, masts, trunks and beams. */
  log: number;
  roof: number;
  roof2: number;
  leaves: number;
  /** The rock islands every build stands on. */
  rock: number;
  /** What grows on top of that rock. */
  soil: number;
  glass: number;
  /** Banners, sails and awnings. */
  cloth: number;
  cloth2: number;
  /** A lamp that hangs or stands. */
  lamp: number;
  /** A glowing accent block. */
  glow: number;
  /** Grates, gears and fittings. */
  metal: number;
  /** Pools, channels and falls. */
  liquid: number;
}

export interface ParkourTheme {
  id: 'garden' | 'clockwork' | 'lunar' | 'coral' | 'candy' | 'neon' | 'frost' | 'forge';
  title: string;
  /** Plain pad surfaces, when a set piece does not pick its own. */
  platforms: readonly number[];
  palette: ParkourPalette;
  /** Grass and leaf tint. */
  foliage: number;
  /** Time of day (sky.ts: .25 is noon). Always daytime: every run is bright. */
  time: number;
  /** The dragon's scales, belly and wing membrane. */
  dragon: { body: number; belly: number; wing: number; eye: number };
}

/** One of the manor carpets (MANOR_RUGS order), as cloth. */
const rug = (i: number): number => Block.ManorRug0 + i;
const CRIMSON = rug(6), INDIGO = rug(8), ROSE = rug(9), VIOLET = rug(10), COCOA = rug(12), TEAL = rug(13),
  MAGENTA = rug(15), FOREST = rug(4);

/** Materials are full, ordinary solid blocks: a theme never changes friction,
 *  collision, jump height, or the reachability of the generated route. */
export const PARKOUR_THEMES: readonly ParkourTheme[] = [
  {
    id: 'garden', title: 'SKYBLOOM GARDENS', platforms: [Block.CherryPlanks, Block.MossyVaultBrick, Block.JadeMosaic],
    palette: {
      stone: Block.ManorStoneBrick, brick: Block.MossyVaultBrick, trim: Block.IvoryColumn, wood: Block.CherryPlanks,
      log: Block.CherryLog, roof: Block.ParkourRoofRed, roof2: Block.ParkourRoofTeal, leaves: Block.CherryLeaves,
      rock: Block.Stone, soil: Block.Grass, glass: Block.ManorGlass, cloth: CRIMSON, cloth2: Block.ManorLinen,
      lamp: Block.GildedLamp, glow: Block.RuneGlass, metal: Block.ClockworkGrate, liquid: Block.Water,
    },
    foliage: 0x65b78a, time: .21,
    dragon: { body: 0x3f8a5a, belly: 0xe8d59a, wing: 0x8fd1a0, eye: 0xffe36b },
  },
  {
    id: 'clockwork', title: 'THE CLOCKWORK QUARTER', platforms: [Block.ClockworkGrate, Block.OakPlanks, Block.GildedVaultBrick],
    palette: {
      stone: Block.ManorStoneBrick, brick: Block.ManorChimney, trim: Block.GildedVaultBrick, wood: Block.OakPlanks,
      log: Block.ManorBeam, roof: Block.ManorSlate, roof2: Block.ManorVerdigris, leaves: Block.Leaves,
      rock: Block.Stone, soil: Block.Grass, glass: Block.ManorWindow, cloth: COCOA, cloth2: Block.ManorLinen,
      lamp: Block.ManorLantern, glow: Block.GildedLamp, metal: Block.ManorBronzeTile, liquid: Block.Water,
    },
    foliage: 0x786957, time: .3,
    dragon: { body: 0x8a4b2a, belly: 0xe0b067, wing: 0xc98a4a, eye: 0x7dfff0 },
  },
  {
    id: 'lunar', title: 'MOONGLASS SANCTUARY', platforms: [Block.SpectralMarble, Block.OpalBrick, Block.PrismBrick],
    palette: {
      stone: Block.OpalBrick, brick: Block.SpectralMarble, trim: Block.PearlTile, wood: Block.ManorBoards,
      log: Block.IvoryColumn, roof: Block.ParkourRoofTeal, roof2: Block.PrismBrick, leaves: Block.BirchLeaves,
      rock: Block.Basalt, soil: Block.Grass, glass: Block.RuneGlass, cloth: INDIGO, cloth2: VIOLET,
      lamp: Block.PrismLamp, glow: Block.ParkourCrystalBlock, metal: Block.PrismBrick, liquid: Block.Water,
    },
    foliage: 0x6d7cbd, time: .24,
    dragon: { body: 0x3b3f8f, belly: 0xb7c4ff, wing: 0x7f6be0, eye: 0xb6fff6 },
  },
  {
    id: 'coral', title: 'THE CORAL CITADEL', platforms: [Block.PearlTile, Block.JadeMosaic, Block.Sandstone],
    palette: {
      stone: Block.Sandstone, brick: Block.PearlTile, trim: Block.JadeMosaic, wood: Block.OakPlanks,
      log: Block.BirchLog, roof: Block.ParkourRoofTeal, roof2: Block.ParkourRoofRed, leaves: Block.Leaves,
      rock: Block.Sandstone, soil: Block.Sand, glass: Block.ManorGlass, cloth: TEAL, cloth2: ROSE,
      lamp: Block.PrismLamp, glow: Block.RuneGlass, metal: Block.ManorVerdigris, liquid: Block.Water,
    },
    foliage: 0xa7aadf, time: .21,
    dragon: { body: 0x2b8f93, belly: 0xffd0b5, wing: 0xf28483, eye: 0xfff27a },
  },
  {
    id: 'candy', title: 'SUGARSPUN SKIES', platforms: [Block.CherryPlanks, Block.PearlTile, Block.FurnaceCeramic],
    palette: {
      stone: Block.PearlTile, brick: Block.FurnaceCeramic, trim: Block.ManorPlaster, wood: Block.CherryPlanks,
      log: Block.BirchLog, roof: Block.ParkourRoofRed, roof2: Block.ParkourRoofTeal, leaves: Block.CherryLeaves,
      rock: Block.Sandstone, soil: Block.PackedSnow, glass: Block.ManorGlass, cloth: ROSE, cloth2: MAGENTA,
      lamp: Block.GildedLamp, glow: Block.RuneGlass, metal: Block.ManorGilt, liquid: Block.Water,
    },
    foliage: 0x9fddcc, time: .27,
    dragon: { body: 0xd45d93, belly: 0xfff0c9, wing: 0x8fd7ff, eye: 0xffffff },
  },
  {
    id: 'neon', title: 'NEON HEIGHTS', platforms: [Block.OpalBrick, Block.PrismBrick, Block.PearlTile],
    palette: {
      stone: Block.OpalBrick, brick: Block.PrismBrick, trim: Block.PearlTile, wood: Block.ManorBoards,
      log: Block.ManorBeam, roof: Block.ParkourRoofTeal, roof2: Block.ManorSlate, leaves: Block.BirchLeaves,
      rock: Block.Stone, soil: Block.Grass, glass: Block.RuneGlass, cloth: MAGENTA, cloth2: INDIGO,
      lamp: Block.PrismLamp, glow: Block.PrismBrick, metal: Block.ClockworkGrate, liquid: Block.Water,
    },
    foliage: 0x6f78cc, time: .28,
    dragon: { body: 0x4a3f8f, belly: 0xeb68c0, wing: 0x5af7ec, eye: 0xff5ad1 },
  },
  {
    id: 'frost', title: 'AURORA PALACES', platforms: [Block.PackedSnow, Block.PearlTile, Block.SpectralMarble],
    palette: {
      stone: Block.SpectralMarble, brick: Block.PearlTile, trim: Block.ManorPlaster, wood: Block.ManorBoards,
      log: Block.SpruceLog, roof: Block.ParkourRoofTeal, roof2: Block.ManorSlate, leaves: Block.SpruceLeaves,
      rock: Block.Stone, soil: Block.SnowyGrass, glass: Block.ManorGlass, cloth: TEAL, cloth2: Block.ManorLinen,
      lamp: Block.PrismLamp, glow: Block.ParkourCrystalBlock, metal: Block.ManorPewter, liquid: Block.Water,
    },
    foliage: 0x6a9fa9, time: .22,
    dragon: { body: 0xdfeefa, belly: 0x9fc6e6, wing: 0x88b3e5, eye: 0x4ff0ff },
  },
  {
    id: 'forge', title: 'EMBERFORGE ISLES', platforms: [Block.EmberBrick, Block.Terracotta, Block.Sandstone],
    palette: {
      stone: Block.Terracotta, brick: Block.EmberBrick, trim: Block.FurnaceCeramic, wood: Block.ManorBoards,
      log: Block.SpruceLog, roof: Block.ParkourRoofRed, roof2: Block.ManorSlate, leaves: Block.Leaves,
      rock: Block.Sandstone, soil: Block.Grass, glass: Block.RuneGlass, cloth: CRIMSON, cloth2: FOREST,
      lamp: Block.EmberBrazier, glow: Block.FurnaceCeramic, metal: Block.ManorPewter, liquid: Block.FurnaceCeramic,
    },
    foliage: 0x8fae4a, time: .27,
    dragon: { body: 0x8a2f24, belly: 0xee8953, wing: 0xd8643a, eye: 0xffc86c },
  },
];
export function parkourTheme(seed: number): ParkourTheme { return PARKOUR_THEMES[(seed >>> 0) % PARKOUR_THEMES.length]; }
