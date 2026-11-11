// Atlas cells for the vanilla blocks and items (Lucky Pillars, Disaster City,
// Party Games). Data only: each cell has a style and a palette, which the
// client turns into a painter (tile_art_vanilla.ts). The server only needs
// the ids. Cells are allocated in declaration order from VANILLA_TILE_BASE,
// so APPEND new entries; reordering moves every later cell.
//
// All art is Worlds' own (house palettes, shape-built detail), not Minecraft's.

export const VANILLA_TILE_BASE = 448;

/** How a cell is painted. Palettes run dark to light. */
export type TileStyle =
  | { s: 'noise'; pal: number[]; grain?: number }
  | { s: 'smooth'; pal: number[] }
  | { s: 'planks'; pal: number[] }
  | { s: 'bricks'; pal: number[]; mortar: number; w?: number; h?: number }
  | { s: 'tiles'; pal: number[]; mortar: number; size: number }
  | { s: 'wool'; pal: number[] }
  | { s: 'glass'; frame: number; tint: number; alpha: number }
  | { s: 'bark'; pal: number[] }
  | { s: 'banded'; pal: number[]; mark: number }
  | { s: 'logtop'; bark: number[]; wood: number[] }
  | { s: 'leaves'; pal: number[] }
  | { s: 'ore'; pal: number[]; ore: number[] }
  | { s: 'metal'; pal: number[] }
  | { s: 'gem'; pal: number[] }
  | { s: 'framed'; pal: number[]; frame: number[] }
  | { s: 'special'; name: string; pal: number[] }
  | { s: 'sprite'; shape: string; pal: number[] };

// ── Shared palettes ─────────────────────────────────────────────────────────

const STONE = [0x61646c, 0x72757d, 0x81848c, 0x8e9199, 0x9b9ea6, 0xa9acb3];
const SMOOTH = [0x8d9096, 0x9a9da3, 0xa6a9ae, 0xb1b4b9, 0xbcbfc3];
const ANDESITE = [0x6f716f, 0x7f817e, 0x8d8f8c, 0x9b9d99, 0xa9aba7];
const DIORITE = [0xa9a9a6, 0xbdbdba, 0xcdcdca, 0xdcdcd9, 0xe9e9e6];
const BLACKSTONE = [0x1d1a20, 0x26222a, 0x302b34, 0x3a343f, 0x453e4a];
const IRON = [0x9da3a8, 0xb3b9bd, 0xc6cbce, 0xd6dadc, 0xe5e8ea, 0xf3f5f6];
const GOLD = [0x9c6a17, 0xc28a24, 0xe0a932, 0xf3c653, 0xffe08a];
const DIAMOND = [0x1f8f8a, 0x2fb0a8, 0x4fd0c5, 0x7ae6dc, 0xb6f6ef];
const EMERALD = [0x0d7a3a, 0x16994a, 0x25b65c, 0x4ad078, 0x8ee8a8];
const NETHERITE = [0x2e2a2c, 0x3b3638, 0x4a4446, 0x5a5355, 0x6b6466];
const LEATHER = [0x6b3d21, 0x834c2a, 0x9a5c34, 0xb06d40, 0xc4804e];
const CHAIN = [0x4d5257, 0x60656a, 0x767b80, 0x8c9196, 0xa3a8ad];
const WOOD_HANDLE = [0x4a3216, 0x5f411e, 0x765229, 0x8b6334];
const OAK = [0x6f4f2a, 0x87633a, 0x9c7445, 0xae8551, 0xc0965e, 0xcfa56b];
const SPRUCE = [0x4a3420, 0x5a4027, 0x6a4c2e, 0x7a5835, 0x8a653d, 0x987146];
const BIRCH = [0xa58f5c, 0xb8a06a, 0xc8b07a, 0xd6bf89, 0xe2cc98, 0xecd8a8];
const DARK_OAK = [0x2c1d0f, 0x372514, 0x432e19, 0x4f371f, 0x5c4126, 0x684b2d];

/** The sixteen dye colours, each as a 5-step ramp (Worlds' own picks). */
export const DYES: [string, string, number[]][] = [
  ['white', 'White', [0xc9cdd1, 0xd8dbde, 0xe5e7e9, 0xf0f1f2, 0xfafafa]],
  ['orange', 'Orange', [0xb8561a, 0xd0681f, 0xe37b28, 0xf08f38, 0xf8a650]],
  ['magenta', 'Magenta', [0x8f2f8a, 0xa63ba0, 0xbb4bb4, 0xcd60c6, 0xdc7ad5]],
  ['light_blue', 'Light Blue', [0x2f86b8, 0x3b9bcd, 0x4daedd, 0x65c0e8, 0x82d0f0]],
  ['yellow', 'Yellow', [0xc79a13, 0xdcae1c, 0xecc12a, 0xf6d23f, 0xfce05e]],
  ['lime', 'Lime', [0x4f9a1c, 0x5fb024, 0x70c42f, 0x84d43f, 0x9be056]],
  ['pink', 'Pink', [0xc1658a, 0xd47a9c, 0xe38fae, 0xeea4bf, 0xf6bad0]],
  ['gray', 'Gray', [0x3b3f45, 0x474c52, 0x545960, 0x61666d, 0x6f747b]],
  ['light_gray', 'Light Gray', [0x80848a, 0x8f9399, 0x9da1a6, 0xabafb3, 0xb9bcc0]],
  ['cyan', 'Cyan', [0x12707a, 0x18848e, 0x2097a1, 0x2daab3, 0x40bcc4]],
  ['purple', 'Purple', [0x5a258e, 0x6a2ea3, 0x7a39b6, 0x8b48c6, 0x9d5bd4]],
  ['blue', 'Blue', [0x2a3a8f, 0x3346a3, 0x3e53b5, 0x4c62c5, 0x5d74d2]],
  ['brown', 'Brown', [0x5a3a20, 0x6a4527, 0x7a512e, 0x8a5d36, 0x9a6a3f]],
  ['green', 'Green', [0x3c5a1c, 0x476a22, 0x537a29, 0x608a31, 0x6e9a3a]],
  ['red', 'Red', [0x8f2020, 0xa62828, 0xbb3232, 0xcd3f3f, 0xdc5050]],
  ['black', 'Black', [0x16171b, 0x1d1e23, 0x25272c, 0x2e3036, 0x383a41]],
];
/** Terracotta is the same sixteen, dusty. */
function dusty(pal: number[]): number[] {
  return pal.map((c) => {
    const r = (c >> 16) & 255, g = (c >> 8) & 255, b = c & 255;
    const m = (r + g + b) / 3;
    const k = (v: number) => Math.round(v * .55 + m * .25 + 0xa0 * .2 * .5);
    return (k(r) << 16) | (k(g) << 8) | k(b);
  });
}

// ── Cells (APPEND ONLY) ─────────────────────────────────────────────────────

const LIST: [string, TileStyle][] = [
  // Stone family
  ['smooth_stone', { s: 'smooth', pal: SMOOTH }],
  ['stone_bricks', { s: 'bricks', pal: STONE, mortar: 0x55585e, w: 8, h: 4 }],
  ['chiseled_stone_bricks', { s: 'special', name: 'chiseled', pal: STONE }],
  ['mossy_cobblestone', { s: 'special', name: 'mossy_cobble', pal: STONE }],
  ['andesite', { s: 'noise', pal: ANDESITE }],
  ['polished_andesite', { s: 'smooth', pal: ANDESITE }],
  ['diorite', { s: 'noise', pal: DIORITE }],
  ['polished_diorite', { s: 'smooth', pal: DIORITE }],
  ['blackstone', { s: 'noise', pal: BLACKSTONE }],
  ['bedrock', { s: 'noise', pal: [0x4a4846, 0x625f5c, 0x7a7773, 0x93908b, 0xb0ada7], grain: 1.4 }],
  ['end_stone', { s: 'noise', pal: [0xc9c48a, 0xd6d297, 0xe0dca4, 0xe9e5b1, 0xf1eebe] }],
  ['bricks', { s: 'bricks', pal: [0x7a3424, 0x8f3f2c, 0xa24b34, 0xb2583e, 0xc06849], mortar: 0xb6aa98, w: 6, h: 4 }],
  ['quartz_side', { s: 'smooth', pal: [0xd8d2c8, 0xe2ddd4, 0xebe7df, 0xf3f0ea, 0xfbf9f5] }],
  ['quartz_top', { s: 'framed', pal: [0xd8d2c8, 0xe2ddd4, 0xebe7df, 0xf3f0ea, 0xfbf9f5], frame: [0xc6bfb3] }],
  ['coarse_dirt', { s: 'special', name: 'coarse_dirt', pal: [0x4f3421, 0x5d3e27, 0x6b4a2f, 0x795536, 0x86613f] }],
  ['gravel', { s: 'special', name: 'gravel', pal: [0x6a6462, 0x7b7471, 0x8b8481, 0x9b9491, 0xaba5a2] }],
  ['red_sand', { s: 'noise', pal: [0x9c4b1c, 0xae5822, 0xbe652a, 0xcc7334, 0xd8823f] }],
  ['magma', { s: 'special', name: 'magma', pal: [0x3a1208, 0x6b1f0a, 0xa8360c, 0xe0621a, 0xffa23a] }],
  // Metal and gem blocks
  ['iron_block', { s: 'metal', pal: IRON }],
  ['gold_block', { s: 'metal', pal: GOLD }],
  ['diamond_block', { s: 'metal', pal: DIAMOND }],
  ['emerald_block', { s: 'metal', pal: EMERALD }],
  ['iron_ore', { s: 'ore', pal: STONE, ore: [0xa8836a, 0xc49c80, 0xdcb598] }],
  ['coal_ore', { s: 'ore', pal: STONE, ore: [0x1a1a1c, 0x2a2a2e, 0x3a3a40] }],
  ['gold_ore', { s: 'ore', pal: STONE, ore: [0xc28a24, 0xe0a932, 0xffe08a] }],
  ['diamond_ore', { s: 'ore', pal: STONE, ore: [0x2fb0a8, 0x4fd0c5, 0xb6f6ef] }],
  // Wood
  ['spruce_planks', { s: 'planks', pal: SPRUCE }],
  ['birch_planks', { s: 'planks', pal: BIRCH }],
  ['dark_oak_planks', { s: 'planks', pal: DARK_OAK }],
  ['dark_oak_log', { s: 'bark', pal: [0x1e150b, 0x281c10, 0x322315, 0x3c2a1a, 0x46311f] }],
  ['dark_oak_log_top', { s: 'logtop', bark: [0x1e150b, 0x281c10, 0x322315, 0x3c2a1a], wood: DARK_OAK.slice(1) }],
  ['stripped_spruce_log', { s: 'smooth', pal: [0x7a5834, 0x8a653d, 0x987146, 0xa57d50, 0xb2895a] }],
  ['stripped_spruce_top', { s: 'logtop', bark: [0x7a5834, 0x8a653d, 0x987146], wood: SPRUCE.slice(2) }],
  ['oak_leaves_vanilla', { s: 'leaves', pal: [0x2f6a1f, 0x3d7d27, 0x4c9031, 0x5ca33c, 0x6eb548, 0x80c556] }],
  // Utility blocks
  ['crafting_table_top', { s: 'special', name: 'craft_top', pal: OAK }],
  ['crafting_table_side', { s: 'special', name: 'craft_side', pal: OAK }],
  ['crafting_table_front', { s: 'special', name: 'craft_front', pal: OAK }],
  ['furnace_side', { s: 'special', name: 'furnace_side', pal: STONE }],
  ['furnace_front', { s: 'special', name: 'furnace_front', pal: STONE }],
  ['furnace_front_lit', { s: 'special', name: 'furnace_lit', pal: STONE }],
  ['furnace_top', { s: 'smooth', pal: STONE }],
  ['chest_side', { s: 'special', name: 'chest_side', pal: OAK }],
  ['chest_front', { s: 'special', name: 'chest_front', pal: OAK }],
  ['chest_top', { s: 'special', name: 'chest_top', pal: OAK }],
  ['bookshelf', { s: 'special', name: 'bookshelf', pal: OAK }],
  ['barrel_side', { s: 'special', name: 'barrel_side', pal: SPRUCE }],
  ['barrel_top', { s: 'special', name: 'barrel_top', pal: SPRUCE }],
  ['loom_side', { s: 'special', name: 'loom', pal: BIRCH }],
  ['smoker_front', { s: 'special', name: 'smoker', pal: STONE }],
  ['tnt_side', { s: 'special', name: 'tnt_side', pal: [0x8f1f1f, 0xb32a2a, 0xd23b3b] }],
  ['tnt_top', { s: 'special', name: 'tnt_top', pal: [0x8f1f1f, 0xb32a2a, 0xd23b3b] }],
  ['tnt_bottom', { s: 'special', name: 'tnt_bottom', pal: [0x8f1f1f, 0xb32a2a, 0xd23b3b] }],
  ['ladder', { s: 'special', name: 'ladder', pal: OAK }],
  ['scaffolding', { s: 'special', name: 'scaffolding', pal: [0x9a7a3a, 0xb38f47, 0xc9a356, 0xdab565] }],
  ['cobweb', { s: 'special', name: 'cobweb', pal: [0xd8dde2, 0xeef1f4] }],
  ['slime', { s: 'special', name: 'slime', pal: [0x4f9a3a, 0x67b54d, 0x80cc62, 0x9cdd7b] }],
  ['honey', { s: 'special', name: 'honey', pal: [0xc7801a, 0xdb9524, 0xeaa830, 0xf5bd48] }],
  ['hay_side', { s: 'special', name: 'hay_side', pal: [0x9c7f1c, 0xb59526, 0xcbab33, 0xdcbf45, 0xead25c] }],
  ['hay_top', { s: 'special', name: 'hay_top', pal: [0x9c7f1c, 0xb59526, 0xcbab33, 0xdcbf45] }],
  ['powder_snow', { s: 'noise', pal: [0xd6e2ee, 0xe2ebf4, 0xedf3f9, 0xf6f9fc, 0xffffff] }],
  ['snow_block', { s: 'noise', pal: [0xd3dfec, 0xe0e9f3, 0xebf1f8, 0xf4f8fc, 0xffffff] }],
  ['ice', { s: 'glass', frame: 0x9cc4f0, tint: 0x8ab8ec, alpha: 190 }],
  ['packed_ice', { s: 'special', name: 'packed_ice', pal: [0x7ea7dc, 0x8fb5e4, 0xa0c3ec, 0xb2d0f2, 0xc5ddf7] }],
  ['blue_ice', { s: 'special', name: 'packed_ice', pal: [0x4f7fd0, 0x6090da, 0x72a1e3, 0x86b2ea, 0x9bc3f0] }],
  ['lava', { s: 'special', name: 'lava', pal: [0x8a1e04, 0xc23a06, 0xe8620c, 0xffa020, 0xffd060] }],
  ['fire', { s: 'special', name: 'fire', pal: [0xc23a06, 0xe8620c, 0xffa020, 0xffd060, 0xfff0b0] }],
  ['anvil_top', { s: 'special', name: 'anvil_top', pal: [0x3b3e42, 0x4a4e53, 0x5a5e64, 0x6b7076] }],
  ['anvil_side', { s: 'smooth', pal: [0x3b3e42, 0x4a4e53, 0x5a5e64, 0x6b7076, 0x7c8187] }],
  ['iron_bars', { s: 'special', name: 'iron_bars', pal: [0x5d6267, 0x7d8287, 0x9ca1a6] }],
  ['iron_trapdoor', { s: 'special', name: 'iron_trapdoor', pal: IRON }],
  ['oak_trapdoor', { s: 'special', name: 'oak_trapdoor', pal: OAK }],
  ['oak_door_lower', { s: 'special', name: 'door_lower', pal: OAK }],
  ['oak_door_upper', { s: 'special', name: 'door_upper', pal: OAK }],
  ['lantern', { s: 'special', name: 'lantern', pal: [0x2e3236, 0x464b50, 0xffc860, 0xfff0b8] }],
  ['torch', { s: 'special', name: 'torch', pal: [0x5f411e, 0x8b6334, 0xffb030, 0xfff0a0] }],
  ['sea_lantern', { s: 'special', name: 'sea_lantern', pal: [0x9cc8c0, 0xb8dcd5, 0xd4ece7, 0xf0fbf8] }],
  ['redstone_lamp', { s: 'special', name: 'lamp', pal: [0x6a3a20, 0x8a5428, 0xffc070, 0xffe8b0] }],
  ['lightning_rod', { s: 'smooth', pal: [0xa65627, 0xbf6a33, 0xd5824a, 0xe69d68, 0xf0b88a] }],
  ['bell', { s: 'metal', pal: GOLD }],
  ['cake_top', { s: 'special', name: 'cake_top', pal: [0xe8e2d8, 0xf4efe6, 0xffffff, 0xc23030] }],
  ['cake_side', { s: 'special', name: 'cake_side', pal: [0x8a5a30, 0xa86e3c, 0xf4efe6, 0xffffff] }],
  ['target_side', { s: 'special', name: 'target', pal: [0xc23030, 0xe8e2d8, 0xd8c890] }],
  ['grass_path', { s: 'noise', pal: [0x7a6a3a, 0x8a7944, 0x9a874e, 0xa99558] }],
  ['soul_sand', { s: 'noise', pal: [0x3a2a1e, 0x4a3626, 0x5a422e, 0x6a4e36] }],
  ['netherrack', { s: 'noise', pal: [0x5a1a1a, 0x6e2222, 0x822b2b, 0x963535, 0xa84040] }],
  ['nether_bricks', { s: 'bricks', pal: [0x2a1214, 0x34171a, 0x3f1c20, 0x4a2226], mortar: 0x180a0c, w: 8, h: 4 }],
  ['glowstone', { s: 'special', name: 'glowstone', pal: [0x9a6a20, 0xd09a30, 0xf0c050, 0xffe090] }],
  ['obsidian', { s: 'noise', pal: [0x0f0a18, 0x170f24, 0x201530, 0x2a1c3e, 0x36264e] }],
  ['crying_obsidian', { s: 'noise', pal: [0x0f0a18, 0x2a1050, 0x4a1a8a, 0x7a30c8, 0xa860f0] }],
  ['spawner', { s: 'special', name: 'iron_bars', pal: [0x1d2a33, 0x2b3c47, 0x3d5361] }],
];
for (const [key, , pal] of DYES) {
  LIST.push([`${key}_wool`, { s: 'wool', pal }]);
  LIST.push([`${key}_concrete`, { s: 'smooth', pal: pal.map((c) => c) }]);
  LIST.push([`${key}_terracotta`, { s: 'noise', pal: dusty(pal), grain: .5 }]);
  LIST.push([`${key}_stained_glass`, { s: 'glass', frame: pal[1], tint: pal[3], alpha: 150 }]);
}
LIST.push(['terracotta_plain', { s: 'noise', pal: [0x8a5240, 0x985c48, 0xa56650, 0xb07058], grain: .5 }]);

// ── Item sprites ────────────────────────────────────────────────────────────
// Shapes are drawn from templates in tile_art_vanilla.ts, recoloured by `pal`.

const TIERS: [string, number[]][] = [
  ['wooden', OAK.slice(1)], ['stone', STONE.slice(1)], ['iron', IRON.slice(1)],
  ['golden', GOLD], ['diamond', DIAMOND], ['netherite', NETHERITE],
];
for (const [tier, pal] of TIERS) {
  for (const tool of ['sword', 'pickaxe', 'axe', 'shovel', 'hoe']) LIST.push([`${tier}_${tool}`, { s: 'sprite', shape: tool, pal }]);
}
const ARMORS: [string, number[]][] = [
  ['leather', LEATHER], ['chainmail', CHAIN], ['iron', IRON.slice(1)], ['golden', GOLD], ['diamond', DIAMOND], ['netherite', NETHERITE],
];
for (const [mat, pal] of ARMORS) {
  for (const piece of ['helmet', 'chestplate', 'leggings', 'boots']) LIST.push([`${mat}_${piece}`, { s: 'sprite', shape: piece, pal }]);
}
const SPRITES: [string, string, number[]][] = [
  ['stick', 'stick', WOOD_HANDLE],
  ['iron_ingot', 'ingot', IRON.slice(1)],
  ['gold_ingot', 'ingot', GOLD],
  ['diamond', 'gem', DIAMOND],
  ['emerald', 'gem', EMERALD],
  ['coal', 'lump', [0x141416, 0x222226, 0x323238, 0x46464e]],
  ['charcoal', 'lump', [0x1e1712, 0x2c221a, 0x3c2f24, 0x50402f]],
  ['string', 'string', [0xc8ccd0, 0xe0e3e6, 0xf6f7f8]],
  ['feather', 'feather', [0xb8bcc2, 0xd2d6da, 0xeceef0, 0xffffff]],
  ['flint', 'lump', [0x2a2a2e, 0x3c3c42, 0x52525a, 0x6a6a74]],
  ['leather', 'hide', LEATHER],
  ['paper', 'paper', [0xd8d4c8, 0xe8e5dc, 0xf6f4ee, 0xffffff]],
  ['book', 'book', [0x6a2a1e, 0x8a3a28, 0xa84a34, 0xe8e2d0]],
  ['bow', 'bow', WOOD_HANDLE],
  ['crossbow', 'crossbow', WOOD_HANDLE],
  ['arrow', 'arrow', [0x5f411e, 0x8b6334, 0x9ca1a6, 0xe8ecef]],
  ['spectral_arrow', 'arrow', [0x8a6a20, 0xc89a30, 0xf0c050, 0xfff0a0]],
  ['shield', 'shield', [0x5f411e, 0x8b6334, 0xa6abb0, 0xc8ccd0]],
  ['bucket', 'bucket', IRON.slice(1)],
  ['water_bucket', 'bucket_water', IRON.slice(1)],
  ['lava_bucket', 'bucket_lava', IRON.slice(1)],
  ['milk_bucket', 'bucket_milk', IRON.slice(1)],
  ['powder_snow_bucket', 'bucket_snow', IRON.slice(1)],
  ['flint_and_steel', 'flint_steel', [0x3c3c42, 0x6a6a74, 0x9ca1a6, 0xd0d4d8]],
  ['fire_charge', 'ball', [0x3a1208, 0x8a2a0a, 0xe0621a, 0xffb040]],
  ['fishing_rod', 'rod', WOOD_HANDLE],
  ['shears_vanilla', 'shears', IRON.slice(1)],
  ['snowball', 'ball', [0xc6d4e2, 0xdde7f0, 0xf0f5fa, 0xffffff]],
  ['egg', 'egg', [0xc8b89a, 0xdccdb0, 0xece0c8, 0xfaf3e4]],
  ['ender_pearl', 'pearl', [0x0e3a36, 0x165a52, 0x2a8a7a, 0x60c8b0]],
  ['wind_charge', 'wind', [0x7a9ab8, 0xa0bcd4, 0xc8dceb, 0xeef6fb]],
  ['trident', 'trident', [0x2a6a6a, 0x3a8a88, 0x5ab0aa, 0x8ad8cf]],
  ['mace', 'mace', [0x4a4e53, 0x6b7076, 0x9ca1a6, 0xc8a050]],
  ['elytra', 'elytra', [0x5a5a7a, 0x74749a, 0x9090b8, 0xb0b0d4]],
  ['firework_rocket', 'rocket', [0x8a2020, 0xc23030, 0xe8e2d8, 0x5f411e]],
  ['totem_of_undying', 'totem', [0x8a6a20, 0xc89a30, 0xf0c050, 0x3a9a50]],
  ['end_crystal', 'crystal', [0x8a30a0, 0xc060d0, 0xf0b0f8, 0xffffff]],
  ['chorus_fruit', 'fruit', [0x5a2a6a, 0x7a3a8a, 0x9a54aa, 0xc080d0]],
  ['blaze_rod', 'stick', [0xa8600c, 0xd88a18, 0xffb830, 0xffe080]],
  ['knockback_stick', 'stick', WOOD_HANDLE],
  ['cooked_beef', 'steak', [0x5a2a14, 0x7a3a1e, 0x9a5028, 0xc07040]],
  ['beef', 'steak', [0x8a1e1e, 0xb02a2a, 0xd04848, 0xf08080]],
  ['bread', 'bread', [0x8a5a20, 0xa8702c, 0xc8903c, 0xe0b060]],
  ['golden_carrot', 'carrot', GOLD],
  ['apple', 'apple', [0x7a1010, 0xa81c1c, 0xd03030, 0xf06060]],
  ['golden_apple', 'apple', GOLD],
  ['enchanted_golden_apple', 'apple', [0xc28a24, 0xf3c653, 0xffe08a, 0xffb0ff]],
  ['baked_potato', 'potato', [0x8a6020, 0xa87a30, 0xc89a48, 0xe0b868]],
  ['pumpkin_pie', 'pie', [0x8a4a14, 0xc06a20, 0xe08a30, 0xf0c070]],
  ['potion', 'potion', [0x3a3e44, 0x8a8e94, 0xc8ccd0, 0xffffff]],
  ['splash_potion', 'splash', [0x3a3e44, 0x8a8e94, 0xc8ccd0, 0xffffff]],
  ['lingering_potion', 'lingering', [0x3a3e44, 0x8a8e94, 0xc8ccd0, 0xffffff]],
  ['spawn_egg', 'spawn_egg', [0x3a5a2a, 0x5a8a3a, 0x8ac060, 0xd0f0a0]],
  ['compass', 'compass', [0x3a3e44, 0x8a8e94, 0xc23030, 0xe8ecef]],
  ['clock', 'compass', [0x8a6a20, 0xc89a30, 0x3a3e44, 0xf0f0e0]],
  ['lead', 'string', [0x6a4a20, 0x9a7034, 0xc89a50]],
  ['oak_boat', 'boat', OAK.slice(1)],
  ['minecart', 'boat', [0x3a3e44, 0x5a5e64, 0x7a7e84, 0x9a9ea4]],
  ['lime_dye', 'dye', [0x4f9a1c, 0x70c42f, 0x9be056, 0xc8f090]],
  ['ghast_tear', 'tear', [0x9cc8d8, 0xc0e0ec, 0xe0f2f8, 0xffffff]],
  ['magma_cream', 'ball', [0x6a3a10, 0xc06a20, 0xf0a030, 0xffe070]],
  ['heart_of_the_sea', 'gem', [0x1a3a8a, 0x2a5ab0, 0x4a8ad8, 0x90c8f8]],
  ['bandage', 'paper', [0xc8c0b0, 0xe0d8c8, 0xf6f0e4, 0xd04040]],
  ['ghost_tricks', 'tear', [0x8a8ec0, 0xb0b4e0, 0xd4d6f4, 0xffffff]],
  ['raw_iron', 'lump', [0x8a6a50, 0xa88468, 0xc49c80, 0xdcb598]],
  ['raw_gold', 'lump', [0x9c6a17, 0xc28a24, 0xe0a932, 0xf3c653]],
  ['sugar', 'lump', [0xd8d8dc, 0xe8e8ec, 0xf6f6f8, 0xffffff]],
  ['wheat', 'stick', [0x9c7f1c, 0xcbab33, 0xdcbf45, 0xead25c]],
  ['bowl', 'bowl', OAK.slice(1)],
  ['host_menu', 'book', [0x2a4a8a, 0x3a5ab0, 0x5a7ad0, 0xf0f0f0]],
];
for (const [key, shape, pal] of SPRITES) LIST.push([key, { s: 'sprite', shape, pal }]);

// Party Games arenas (appended after the sprites so earlier cells keep their ids).
const QUARTZ = [0xd8d2c8, 0xe2ddd4, 0xebe7df, 0xf3f0ea, 0xfbf9f5];
const DEEPSLATE = [0x2f3034, 0x3a3b40, 0x45464b, 0x505157, 0x5b5c62];
const JUNGLE = [0x8a5a34, 0x9c6a3e, 0xae7948, 0xbd8752, 0xcb945c];
const STRIP_OAK = [0x9c7445, 0xae8551, 0xc0965e, 0xcfa56b, 0xdcb378];
const STRIP_DARK = [0x4f371f, 0x5c4126, 0x684b2d, 0x755535, 0x82603d];
LIST.push(
  ['quartz_bricks', { s: 'bricks', pal: QUARTZ, mortar: 0xc6bfb3, w: 8, h: 4 }],
  ['quartz_pillar_side', { s: 'banded', pal: QUARTZ, mark: 0xc6bfb3 }],
  ['quartz_pillar_top', { s: 'framed', pal: QUARTZ, frame: [0xbdb5a8] }],
  ['chiseled_quartz', { s: 'special', name: 'chiseled', pal: QUARTZ }],
  ['deepslate', { s: 'noise', pal: DEEPSLATE }],
  ['polished_deepslate', { s: 'smooth', pal: DEEPSLATE }],
  ['polished_blackstone_bricks', { s: 'bricks', pal: [0x26222a, 0x302b34, 0x3a343f, 0x453e4a, 0x504856], mortar: 0x16131a, w: 8, h: 4 }],
  ['red_nether_bricks', { s: 'bricks', pal: [0x4a0c0e, 0x5c1114, 0x6e171a, 0x801e21, 0x922528], mortar: 0x2c0608, w: 8, h: 4 }],
  ['jungle_log', { s: 'bark', pal: [0x4a3518, 0x58401d, 0x664b23, 0x745629, 0x82612f] }],
  ['jungle_log_top', { s: 'logtop', bark: [0x4a3518, 0x58401d, 0x664b23, 0x745629], wood: JUNGLE.slice(1) }],
  ['jungle_leaves', { s: 'leaves', pal: [0x2a6a14, 0x36801a, 0x429620, 0x50aa28, 0x60bc32, 0x72cc40] }],
  ['stripped_oak_log', { s: 'smooth', pal: STRIP_OAK }],
  ['stripped_oak_top', { s: 'logtop', bark: STRIP_OAK.slice(0, 3), wood: OAK.slice(2) }],
  ['stripped_dark_oak_log', { s: 'smooth', pal: STRIP_DARK }],
  ['stripped_dark_oak_top', { s: 'logtop', bark: STRIP_DARK.slice(0, 3), wood: DARK_OAK.slice(2) }],
  ['mud', { s: 'noise', pal: [0x2e2a28, 0x37322f, 0x403a36, 0x49433e, 0x524c46], grain: .7 }],
  ['moss_block', { s: 'noise', pal: [0x3f5a22, 0x4c6c28, 0x5a7e2f, 0x688f37, 0x78a041] }],
  ['shroomlight', { s: 'noise', pal: [0xc8601e, 0xe07a28, 0xf09238, 0xf8aa50, 0xffc46c], grain: .8 }],
  ['suspicious_sand', { s: 'special', name: 'gravel', pal: [0xc2ae7c, 0xcfbb88, 0xdac795, 0xe4d3a2, 0xeedeb0] }],
  ['tinted_glass', { s: 'glass', frame: 0x2a2530, tint: 0x3a3442, alpha: 210 }],
  ['waxed_copper', { s: 'metal', pal: [0x9a4a2c, 0xb45a36, 0xc86c42, 0xd88052, 0xe69666] }],
  ['pumpkin_side', { s: 'banded', pal: [0xb8561a, 0xd0681f, 0xe37b28, 0xf08f38, 0xf8a650], mark: 0x9c4614 }],
  ['pumpkin_top', { s: 'framed', pal: [0xb8561a, 0xd0681f, 0xe37b28, 0xf08f38], frame: [0x5a7a28] }],
  ['carved_pumpkin', { s: 'special', name: 'pumpkin_face', pal: [0xb8561a, 0xd0681f, 0xe37b28, 0xf08f38, 0xf8a650] }],
  ['smithing_side', { s: 'special', name: 'craft_side', pal: [0x2a2c33, 0x34363e, 0x3f4149, 0x4a4c55, 0x565862, 0x62646e] }],
  ['smithing_top', { s: 'metal', pal: [0x2a2c33, 0x34363e, 0x3f4149, 0x4a4c55, 0x565862] }],
  ['decorated_pot', { s: 'special', name: 'pot', pal: [0x7a3e24, 0x924c2c, 0xa85c36, 0xbc6c42, 0xcc7c50] }],
  ['orange_glazed', { s: 'special', name: 'glazed', pal: [0xb8561a, 0xe37b28, 0xf8a650, 0xfff0d8] }],
  ['cyan_glazed', { s: 'special', name: 'glazed', pal: [0x146a74, 0x1f8c96, 0x3ab0b8, 0xe8fbfc] }],
  ['magenta_glazed', { s: 'special', name: 'glazed', pal: [0x8f2f8a, 0xbb4bb4, 0xdc7ad5, 0xfbe8f9] }],
  ['lime_glazed', { s: 'special', name: 'glazed', pal: [0x4f9a1c, 0x70c42f, 0x9be056, 0xf2fbe6] }],
  ['spruce_door_lower', { s: 'special', name: 'door_lower', pal: SPRUCE }],
  ['spruce_door_upper', { s: 'special', name: 'door_upper', pal: SPRUCE }],
  ['spruce_trapdoor', { s: 'special', name: 'oak_trapdoor', pal: SPRUCE }],
  ['raw_gold_block', { s: 'special', name: 'gravel', pal: [0x9c6a17, 0xc28a24, 0xe0a932, 0xf3c653, 0xffe08a] }],
  ['mushroom_cap', { s: 'special', name: 'mushroom', pal: [0x6e4a32, 0x86593c, 0x9c6a48, 0xb27c56, 0xead8c0] }],
);

/** Cell id by key. */
LIST.push(
 ['crimson_planks',{s:'planks',pal:[0x44202c,0x5a2a3d,0x6d344c,0x80405d,0x934e6d]}],
 ['warped_planks',{s:'planks',pal:[0x164644,0x1d5955,0x266e66,0x328477,0x42998a]}],
 ['note_block',{s:'framed',pal:[0x4a3420,0x6a4c2e,0x8a653d],frame:[0x302314]}],
 ['jukebox_top',{s:'framed',pal:[0x6a4c2e,0x8a653d,0xa57d50],frame:[0x191a20]}],
);
// Party Games course palettes (append only).
LIST.push(
 ['sandstone_cut',{s:'tiles',pal:[0xbda477,0xcdb78b,0xddc99e,0xecdcb4],mortar:0xa78c61,size:8}],
 ['granite',{s:'noise',pal:[0x76564e,0x8c685c,0xa07869,0xb68c7b,0xcaa28c]}],
 ['jungle_planks',{s:'planks',pal:[0x8a5a34,0x9c6a3e,0xae7948,0xbd8752,0xcb945c]}],
 ['mud_bricks',{s:'bricks',pal:[0x6b5144,0x7b5f50,0x8b6e5d,0x9c7e6c],mortar:0x44382f,w:8,h:4}],
 ['packed_mud',{s:'noise',pal:[0x6e5444,0x82634e,0x967359,0xaa8566]}],
 ['mushroom_stem',{s:'banded',pal:[0xb8aa90,0xcebea3,0xe0d1b7,0xf0e4cf],mark:0x968971}],
 ['red_mushroom',{s:'special',name:'mushroom',pal:[0x9c2727,0xb53530,0xcf4840,0xe65c4e,0xf6ecda]}],
 ['mycelium',{s:'noise',pal:[0x675d6b,0x7b6e7d,0x8f7f8f,0xa392a3]}],
 ['podzol',{s:'noise',pal:[0x483b20,0x5b4829,0x705632,0x85653c]}],
 ['red_sandstone',{s:'bricks',pal:[0xa24f23,0xba602b,0xcf7538,0xe08b48],mortar:0x87451f,w:16,h:8}],
 ['purpur',{s:'tiles',pal:[0x805c89,0x966d9c,0xab82b0,0xbe97c2],mortar:0x6c4c74,size:8}],
 ['cactus',{s:'banded',pal:[0x285b28,0x347034,0x40863e,0x529e4a],mark:0x153b18}],
 ['soul_soil',{s:'noise',pal:[0x33281f,0x403128,0x4e3c31,0x5d493c]}],
 ['nylium',{s:'noise',pal:[0x512028,0x6b2931,0x86333b,0xa34048]}],
 ['yellow_glazed',{s:'special',name:'glazed',pal:[0xc79a13,0xecc12a,0xfce05e,0xfff5cf]}]
);
// Item tint masks (icons only): potion liquid, spawn egg base and spots.
LIST.push(
  ['potion_overlay', { s: 'sprite', shape: 'potion_overlay', pal: [0xffffff] }],
  ['egg_base_overlay', { s: 'sprite', shape: 'egg_base_overlay', pal: [0xffffff] }],
  ['egg_spots_overlay', { s: 'sprite', shape: 'egg_spots_overlay', pal: [0xffffff] }],
);
export const VT: Record<string, number> = {};
export const VANILLA_TILE_STYLES: Record<number, TileStyle> = {};
LIST.forEach(([key, style], i) => {
  const id = VANILLA_TILE_BASE + i;
  if (VT[key] !== undefined) throw new Error(`duplicate vanilla tile ${key}`);
  VT[key] = id;
  VANILLA_TILE_STYLES[id] = style;
});
export const VANILLA_TILE_END = VANILLA_TILE_BASE + LIST.length;

/** A tile id by key; throws on a typo so a missing cell fails at load. */
export function vt(key: string): number {
  const id = VT[key];
  if (id === undefined) throw new Error(`unknown vanilla tile ${key}`);
  return id;
}
