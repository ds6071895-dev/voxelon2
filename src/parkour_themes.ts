import { Block } from './blocks';
export interface ParkourTheme {
  id: 'garden' | 'clockwork' | 'lunar' | 'coral' | 'candy' | 'neon' | 'frost' | 'forge';
  title: string;
  subtitle: string;
  platforms: readonly number[];
  stone: number;
  trim: number;
  accent: number;
  light: number;
  foliage: number;
  time: number;
}
/** Materials are full, ordinary solid blocks: a theme never changes friction,
* collision, jump height, or the reachability of the generated route. */
export const PARKOUR_THEMES: readonly ParkourTheme[] = [
  { id: 'garden', title: 'SKYBLOOM GARDENS', subtitle: 'Cherry terraces above the clouds', platforms: [Block.CherryPlanks, Block.MossyVaultBrick, Block.JadeMosaic], stone: 0xc7d4ad, trim: 0x6a977b, accent: 0xf4abc9, light: 0xffe8a1, foliage: 0x65b78a, time: .21 },
  { id: 'clockwork', title: 'THE CLOCKWORK QUARTER', subtitle: 'Copper rooftops and floating observatories', platforms: [Block.ClockworkGrate, Block.OakPlanks, Block.GildedVaultBrick], stone: 0x57443c, trim: 0xc38c57, accent: 0x66b9ac, light: 0xffd785, foliage: 0x786957, time: .43 },
  { id: 'lunar', title: 'MOONGLASS SANCTUARY', subtitle: 'Ancient arches beneath a silver moon', platforms: [Block.SpectralMarble, Block.OpalBrick, Block.PrismBrick], stone: 0x667399, trim: 0xb3c4e6, accent: 0x9e8ff2, light: 0xc0efff, foliage: 0x6d7cbd, time: .75 },
  { id: 'coral', title: 'THE CORAL CITADEL', subtitle: 'Pearl temples and luminous coral gardens', platforms: [Block.PearlTile, Block.JadeMosaic, Block.Sandstone], stone: 0xbdd7cf, trim: 0x49a8b3, accent: 0xf28483, light: 0xa6ffe0, foliage: 0xa7aadf, time: .19 },
  { id: 'candy', title: 'SUGARSPUN SKIES', subtitle: 'Iced rooftops, candy canes and sprinkle islands', platforms: [Block.CherryPlanks, Block.PearlTile, Block.FurnaceCeramic], stone: 0xf4d7bc, trim: 0xf3f0df, accent: 0xef90b3, light: 0xffef9e, foliage: 0x9fddcc, time: .27 },
  { id: 'neon', title: 'MIDNIGHT METRO', subtitle: 'Neon signs, rooftop gardens and electric skylines', platforms: [Block.Basalt, Block.PrismBrick, Block.OpalBrick], stone: 0x25334e, trim: 0x516386, accent: 0xeb68c0, light: 0x5af7ec, foliage: 0x6f78cc, time: .77 },
  { id: 'frost', title: 'AURORA PALACES', subtitle: 'Snow-capped towers beneath the northern lights', platforms: [Block.PackedSnow, Block.PearlTile, Block.SpectralMarble], stone: 0xa9ccdd, trim: 0xedf7f1, accent: 0x88b3e5, light: 0x9bffe5, foliage: 0x6a9fa9, time: .71 },
  { id: 'forge', title: 'EMBERFORGE ISLES', subtitle: 'Basalt fortresses over rivers of molten gold', platforms: [Block.EmberBrick, Block.Basalt, Block.Terracotta], stone: 0x453942, trim: 0x9a6260, accent: 0xee8953, light: 0xffc86c, foliage: 0x7b414b, time: .48 },
];
export function parkourTheme(seed: number): ParkourTheme { return PARKOUR_THEMES[(seed >>> 0) % PARKOUR_THEMES.length]; }
