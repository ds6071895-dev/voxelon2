// Vanilla items for the new modes, with Java Edition numbers from the
// Minecraft wiki: attack damage and speed, durability, armour points,
// toughness and knockback resistance, food and saturation, fuel time, and the
// furnace result. Pure items get ids from VANILLA_ITEM_BASE; block items use
// their family's default block id (vanilla/blocks.ts). Everything is also
// registered into ITEMS so the hotbar, icons and held models know it.

import { BLOCKS, Block, Tile, type ToolKind } from '../blocks';
import { ITEMS } from '../items';
import { VANILLA_ITEM_BASE, VANILLA_ITEM_END } from './ids';
import { VB, VFAMILY, VMETA } from './blocks';
import { vt } from './tiles';

export type VToolKind = 'pickaxe' | 'axe' | 'shovel' | 'hoe' | 'sword' | 'shears';
export type ArmorSlot = 'head' | 'chest' | 'legs' | 'feet';
export type UseKind =
  | 'bow' | 'crossbow' | 'trident' | 'shield' | 'food' | 'drink' | 'splash' | 'lingering'
  | 'throw' | 'bucket' | 'flint' | 'fire_charge' | 'spawn_egg' | 'rod' | 'firework' | 'crystal'
  | 'mace' | 'menu' | 'compass' | 'lead' | 'boat' | 'minecart';

export interface VItemData {
  key: string;
  name: string;
  maxStack: number;
  durability?: number;
  tool?: { kind: VToolKind; tier: number; speed: number };
  /** Attack damage (total, fist = 1) and attacks per second (fist = 4). */
  attack?: { damage: number; speed: number };
  armor?: { slot: ArmorSlot; points: number; toughness: number; kb: number };
  food?: { nutrition: number; saturation: number; always?: boolean; ticks?: number; effects?: [string, number, number][] };
  use?: UseKind;
  /** Spawn egg mob kind, thrown projectile kind, bucket contents. */
  variant?: string;
  fuel?: number;
  smelt?: string;
  enchantable?: boolean;
  block?: number;
}

export const VITEM: Record<number, VItemData> = {};
/** Item key → id (block items: the family's default block id). */
export const VI: Record<string, number> = {};

let next = VANILLA_ITEM_BASE;
const LEGACY_TOOL: Record<VToolKind, ToolKind> = { pickaxe: 'pickaxe', axe: 'axe', shovel: 'shovel', hoe: 'shovel', sword: 'sword', shears: 'sword' };

function item(key: string, d: Omit<VItemData, 'key' | 'maxStack'> & { maxStack?: number; tile?: string }): number {
  if (VI[key] !== undefined) throw new Error(`duplicate vanilla item ${key}`);
  const id = next++;
  if (id >= VANILLA_ITEM_END) throw new Error('vanilla item ids exhausted');
  const maxStack = d.maxStack ?? (d.durability ? 1 : 64);
  VITEM[id] = { key, ...d, maxStack };
  VI[key] = id;
  ITEMS[id] = {
    name: d.name, kind: 'item', sprite: vt(d.tile ?? key) as Tile, maxStack,
    tool: d.tool ? { type: LEGACY_TOOL[d.tool.kind], tier: d.tool.tier, speed: d.tool.speed } : undefined,
  };
  return id;
}

// ── Tools and weapons ───────────────────────────────────────────────────────

const TIER: Record<string, { label: string; tier: number; speed: number; dur: number; fuel?: number }> = {
  wooden: { label: 'Wooden', tier: 0, speed: 2, dur: 59, fuel: 200 },
  stone: { label: 'Stone', tier: 1, speed: 4, dur: 131 },
  iron: { label: 'Iron', tier: 2, speed: 6, dur: 250 },
  golden: { label: 'Golden', tier: 0, speed: 12, dur: 32 },
  diamond: { label: 'Diamond', tier: 3, speed: 8, dur: 1561 },
  netherite: { label: 'Netherite', tier: 4, speed: 9, dur: 2031 },
};
const WEAPON: Record<string, Record<string, [number, number]>> = {
  sword: { wooden: [4, 1.6], stone: [5, 1.6], iron: [6, 1.6], golden: [4, 1.6], diamond: [7, 1.6], netherite: [8, 1.6] },
  axe: { wooden: [7, .8], stone: [9, .8], iron: [9, .9], golden: [7, 1], diamond: [9, 1], netherite: [10, 1] },
  pickaxe: { wooden: [2, 1.2], stone: [3, 1.2], iron: [4, 1.2], golden: [2, 1.2], diamond: [5, 1.2], netherite: [6, 1.2] },
  shovel: { wooden: [2.5, 1], stone: [3.5, 1], iron: [4.5, 1], golden: [2.5, 1], diamond: [5.5, 1], netherite: [6.5, 1] },
  hoe: { wooden: [1, 1], stone: [1, 2], iron: [1, 3], golden: [1, 1], diamond: [1, 4], netherite: [1, 4] },
};
const TOOL_LABEL: Record<string, string> = { sword: 'Sword', axe: 'Axe', pickaxe: 'Pickaxe', shovel: 'Shovel', hoe: 'Hoe' };
for (const [tier, t] of Object.entries(TIER)) {
  for (const kind of ['sword', 'pickaxe', 'axe', 'shovel', 'hoe'] as const) {
    const [damage, speed] = WEAPON[kind][tier];
    item(`${tier}_${kind}`, {
      name: `${t.label} ${TOOL_LABEL[kind]}`, durability: t.dur, enchantable: true, fuel: t.fuel,
      tool: { kind, tier: t.tier, speed: kind === 'sword' ? 1.5 : t.speed }, attack: { damage, speed },
    });
  }
}
item('shears', { name: 'Shears', tile: 'shears_vanilla', durability: 238, tool: { kind: 'shears', tier: 0, speed: 1.5 }, enchantable: true });
item('bow', { name: 'Bow', durability: 384, use: 'bow', enchantable: true, fuel: 300 });
item('crossbow', { name: 'Crossbow', durability: 465, use: 'crossbow', enchantable: true, fuel: 300 });
item('trident', { name: 'Trident', durability: 250, use: 'trident', attack: { damage: 9, speed: 1.1 }, enchantable: true });
item('mace', { name: 'Mace', durability: 500, use: 'mace', attack: { damage: 6, speed: .6 }, enchantable: true });
item('shield', { name: 'Shield', durability: 336, use: 'shield', fuel: 300 });
item('fishing_rod', { name: 'Fishing Rod', durability: 64, use: 'rod', enchantable: true, fuel: 300 });
item('flint_and_steel', { name: 'Flint and Steel', durability: 64, use: 'flint' });
item('elytra', { name: 'Elytra', durability: 432, armor: { slot: 'chest', points: 0, toughness: 0, kb: 0 } });
item('totem_of_undying', { name: 'Totem of Undying', maxStack: 1 });

// ── Armour ──────────────────────────────────────────────────────────────────

const ARMOR: [string, string, number[], number[], number, number][] = [
  // key, label, points (head..feet), durability, toughness, knockback resistance
  ['leather', 'Leather', [1, 3, 2, 1], [55, 80, 75, 65], 0, 0],
  ['chainmail', 'Chainmail', [2, 5, 4, 1], [165, 240, 225, 195], 0, 0],
  ['iron', 'Iron', [2, 6, 5, 2], [165, 240, 225, 195], 0, 0],
  ['golden', 'Golden', [2, 5, 3, 1], [77, 112, 105, 91], 0, 0],
  ['diamond', 'Diamond', [3, 8, 6, 3], [363, 528, 495, 429], 2, 0],
  ['netherite', 'Netherite', [3, 8, 6, 3], [407, 592, 555, 481], 3, .1],
];
const PIECES: [string, string, ArmorSlot][] = [['helmet', 'Helmet', 'head'], ['chestplate', 'Chestplate', 'chest'], ['leggings', 'Leggings', 'legs'], ['boots', 'Boots', 'feet']];
const LEATHER_NAMES = ['Leather Cap', 'Leather Tunic', 'Leather Pants', 'Leather Boots'];
for (const [mat, label, points, dur, toughness, kb] of ARMOR) {
  PIECES.forEach(([piece, pl, slot], i) => item(`${mat}_${piece}`, {
    name: mat === 'leather' ? LEATHER_NAMES[i] : `${label} ${pl}`, durability: dur[i], enchantable: true,
    armor: { slot, points: points[i], toughness, kb },
  }));
}

// ── Materials ───────────────────────────────────────────────────────────────

item('stick', { name: 'Stick', fuel: 100 });
item('iron_ingot', { name: 'Iron Ingot' });
item('gold_ingot', { name: 'Gold Ingot' });
item('diamond', { name: 'Diamond' });
item('emerald', { name: 'Emerald' });
item('coal', { name: 'Coal', fuel: 1600 });
item('charcoal', { name: 'Charcoal', fuel: 1600 });
item('raw_iron', { name: 'Raw Iron', smelt: 'iron_ingot' });
item('raw_gold', { name: 'Raw Gold', smelt: 'gold_ingot' });
item('string', { name: 'String' });
item('feather', { name: 'Feather' });
item('flint', { name: 'Flint' });
item('leather', { name: 'Leather' });
item('paper', { name: 'Paper' });
item('book', { name: 'Book' });
item('sugar', { name: 'Sugar' });
item('wheat', { name: 'Wheat' });
item('bowl', { name: 'Bowl', fuel: 100 });
item('blaze_rod', { name: 'Blaze Rod', fuel: 2400 });
item('magma_cream', { name: 'Magma Cream' });
item('heart_of_the_sea', { name: 'Heart of the Sea' });
item('lime_dye', { name: 'Lime Dye' });
item('ghast_tear', { name: 'Ghast Tear' });

// ── Ammunition, throwables, buckets ─────────────────────────────────────────

item('arrow', { name: 'Arrow' });
item('spectral_arrow', { name: 'Spectral Arrow' });
item('snowball', { name: 'Snowball', maxStack: 16, use: 'throw', variant: 'snowball' });
item('egg', { name: 'Egg', maxStack: 16, use: 'throw', variant: 'egg' });
item('ender_pearl', { name: 'Ender Pearl', maxStack: 16, use: 'throw', variant: 'ender_pearl' });
item('wind_charge', { name: 'Wind Charge', use: 'throw', variant: 'wind_charge' });
item('fire_charge', { name: 'Fire Charge', use: 'fire_charge' });
item('firework_rocket', { name: 'Firework Rocket', use: 'firework' });
item('end_crystal', { name: 'End Crystal', use: 'crystal' });
item('bucket', { name: 'Bucket', maxStack: 16, use: 'bucket', variant: 'empty' });
item('water_bucket', { name: 'Water Bucket', maxStack: 1, use: 'bucket', variant: 'water' });
item('lava_bucket', { name: 'Lava Bucket', maxStack: 1, use: 'bucket', variant: 'lava', fuel: 20000 });
item('milk_bucket', { name: 'Milk Bucket', maxStack: 1, use: 'drink', variant: 'milk' });
item('powder_snow_bucket', { name: 'Powder Snow Bucket', maxStack: 1, use: 'bucket', variant: 'powder_snow' });
item('potion', { name: 'Potion', maxStack: 1, use: 'drink' });
item('splash_potion', { name: 'Splash Potion', maxStack: 1, use: 'splash' });
item('lingering_potion', { name: 'Lingering Potion', maxStack: 1, use: 'lingering' });
for (const mob of ['zombie', 'husk', 'skeleton', 'creeper', 'silverfish', 'wolf', 'sheep', 'chicken']) {
  item(`${mob}_spawn_egg`, { name: `${mob[0].toUpperCase()}${mob.slice(1)} Spawn Egg`, tile: 'spawn_egg', use: 'spawn_egg', variant: mob });
}
item('compass', { name: 'Compass', use: 'compass' });
item('clock', { name: 'Clock' });
item('lead', { name: 'Lead', use: 'lead' });
item('oak_boat', { name: 'Oak Boat', maxStack: 1, use: 'boat', fuel: 1200 });
item('minecart', { name: 'Minecart', maxStack: 1, use: 'minecart' });

// ── Food (nutrition, saturation; effects as [id, amplifier, ticks]) ─────────

item('apple', { name: 'Apple', food: { nutrition: 4, saturation: 2.4 } });
item('golden_apple', { name: 'Golden Apple', food: { nutrition: 4, saturation: 9.6, always: true, effects: [['regeneration', 1, 100], ['absorption', 0, 2400]] } });
item('enchanted_golden_apple', { name: 'Enchanted Golden Apple', food: {
  nutrition: 4, saturation: 9.6, always: true,
  effects: [['regeneration', 1, 400], ['absorption', 3, 2400], ['resistance', 0, 6000], ['fire_resistance', 0, 6000]],
} });
item('beef', { name: 'Raw Beef', food: { nutrition: 3, saturation: 1.8 }, smelt: 'cooked_beef' });
item('cooked_beef', { name: 'Steak', food: { nutrition: 8, saturation: 12.8 } });
item('bread', { name: 'Bread', food: { nutrition: 5, saturation: 6 } });
item('golden_carrot', { name: 'Golden Carrot', food: { nutrition: 6, saturation: 14.4 } });
item('baked_potato', { name: 'Baked Potato', food: { nutrition: 5, saturation: 6 } });
item('pumpkin_pie', { name: 'Pumpkin Pie', food: { nutrition: 8, saturation: 4.8 } });
item('chorus_fruit', { name: 'Chorus Fruit', food: { nutrition: 4, saturation: 2.4, always: true } });

// ── Game items (menus opened by right-click; tagged in the stack) ───────────

item('survival_book', { name: 'Survival Crafting', tile: 'book', use: 'menu', maxStack: 1 });
item('ghost_tricks', { name: 'Ghost Tricks', use: 'menu', maxStack: 1 });
item('host_menu', { name: 'Party Games Setup', use: 'menu', maxStack: 1 });
item('bandage', { name: 'Bandage', maxStack: 64, use: 'menu' });
item('gold_nugget', { name: 'Gold Nugget', tile: 'gold_ingot' });

// ── Block items ─────────────────────────────────────────────────────────────

/** Families placed by an item whose key differs from the family name. */
const SPECIAL_BLOCK_ITEMS: Record<string, string> = {};
for (const [family, ids] of Object.entries(VFAMILY)) {
  const meta = VMETA[ids[0]]!;
  if (meta.noItem) continue;
  const id = VB[family];
  VI[family] = id;
  VITEM[id] = { key: family, name: meta.name, maxStack: 64, block: id, fuel: meta.flammable ? woodFuel(family) : undefined };
  if (!ITEMS[id]) ITEMS[id] = { name: meta.name, kind: 'block', block: id as Block, maxStack: 64 };
}
void SPECIAL_BLOCK_ITEMS;
function woodFuel(family: string): number | undefined {
  if (/_slab$/.test(family)) return 150;
  if (/(planks|_log|_stairs|_fence|crafting_table|chest|barrel|bookshelf|ladder|trapdoor|loom)$/.test(family)) return 300;
  if (/_door$/.test(family)) return 200;
  if (/_wool$/.test(family)) return 100;
  if (/_carpet$/.test(family)) return 67;
  if (family === 'scaffolding') return 50;
  return undefined;
}
// Smelting results on block items.
const SMELT: Record<string, string> = {
  sand: 'glass', red_sand: 'glass', cobblestone: 'stone', stone: 'smooth_stone', iron_ore: 'iron_ingot', gold_ore: 'gold_ingot',
  oak_log: 'charcoal', birch_log: 'charcoal', spruce_log: 'charcoal', dark_oak_log: 'charcoal', stripped_spruce_log: 'charcoal',
  netherrack: 'nether_bricks', snow_block: 'snow_block',
};
for (const [k, out] of Object.entries(SMELT)) if (VI[k] !== undefined && k !== out) VITEM[VI[k]].smelt = out;

/** Item data by id (pure or block item). */
export function vitem(id: number): VItemData | undefined { return VITEM[id]; }
/** Item id by key; throws on a typo. */
export function vi(key: string): number {
  const id = VI[key];
  if (id === undefined) throw new Error(`unknown vanilla item ${key}`);
  return id;
}
export function itemName(id: number): string { return VITEM[id]?.name ?? ITEMS[id]?.name ?? BLOCKS[id]?.name ?? 'Item'; }
export function maxStackOf(id: number): number { return VITEM[id]?.maxStack ?? ITEMS[id]?.maxStack ?? 64; }
