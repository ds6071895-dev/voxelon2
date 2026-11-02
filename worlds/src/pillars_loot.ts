// The Lucky Pillars loot table, entry for entry from the plugin's LuckyLoot:
// name, rarity, weight, starter flag and contents. Weight scales with
// boost^exponent (Common 0, Uncommon 0.5, Rare/Epic/Legendary 1).

import { POTIONS } from './vanilla/effects';
import { VI, vi } from './vanilla/items';
import type { EnchantId, VStack } from './vanilla/stack';

export type Rarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';
export const RARITY: Record<Rarity, { label: string; color: string; exp: number; pitch: number }> = {
  common: { label: 'Common', color: '#ffffff', exp: 0, pitch: 1 },
  uncommon: { label: 'Uncommon', color: '#55ff55', exp: .5, pitch: 1.2 },
  rare: { label: 'Rare', color: '#55ffff', exp: 1, pitch: 1.5 },
  epic: { label: 'Epic', color: '#ff55ff', exp: 1, pitch: 1.9 },
  legendary: { label: 'Legendary', color: '#ffaa00', exp: 1, pitch: 1.9 },
};

export interface LootEntry { name: string; rarity: Rarity; weight: number; starter: boolean; make: (rng: () => number) => VStack[] }
export const LOOT: LootEntry[] = [];

const WOOL = ['white', 'orange', 'magenta', 'light_blue', 'yellow', 'lime', 'pink', 'cyan', 'purple', 'blue', 'red'];
const one = (key: string, count: number) => (): VStack[] => [{ id: vi(key), count }];
const ench = (s: VStack, e: EnchantId, lvl: number): VStack => ({ ...s, ench: [...(s.ench ?? []), [e, lvl]] });
const named = (s: VStack, name: string): VStack => ({ ...s, name });
const potion = (key: 'potion' | 'splash_potion' | 'lingering_potion', type: keyof typeof POTIONS, count = 1): VStack => {
  const p = POTIONS[type];
  return { id: vi(key), count, potion: { effects: p.effects.map(([e, a, t]) => [e, a, t]), color: p.color, label: p.label } };
};
function add(name: string, rarity: Rarity, weight: number, starter: boolean, make: LootEntry['make']): void {
  LOOT.push({ name, rarity, weight, starter, make });
}

// Common: blocks
add('Cobblestone', 'common', 40, true, one('cobblestone', 16));
add('Oak Planks', 'common', 35, true, one('oak_planks', 16));
add('Wool', 'common', 35, true, (rng) => [{ id: vi(`${WOOL[Math.floor(rng() * WOOL.length)]}_wool`), count: 16 }]);
add('Sandstone', 'common', 20, true, one('sandstone', 12));
add('End Stone', 'common', 15, true, one('end_stone', 10));
add('Glass', 'common', 12, false, one('glass', 10));
add('Ladders', 'common', 12, false, one('ladder', 6));
add('Scaffolding', 'common', 12, false, one('scaffolding', 6));
add('Sand', 'common', 10, false, one('sand', 6));
add('Hay Bales', 'common', 8, false, one('hay_block', 6));
// Common: food
add('Steak', 'common', 20, false, one('cooked_beef', 3));
add('Bread', 'common', 15, false, one('bread', 4));
add('Golden Carrots', 'common', 12, false, one('golden_carrot', 3));
add('Apples', 'common', 10, false, one('apple', 4));
add('Baked Potatoes', 'common', 10, false, one('baked_potato', 4));
add('Pumpkin Pie', 'common', 8, false, one('pumpkin_pie', 2));
// Common: gear
add('Wooden Sword', 'common', 12, false, one('wooden_sword', 1));
add('Stone Sword', 'common', 18, false, one('stone_sword', 1));
add('Stone Axe', 'common', 10, false, one('stone_axe', 1));
add('Stone Pickaxe', 'common', 12, false, one('stone_pickaxe', 1));
add('Shears', 'common', 6, false, one('shears', 1));
add('Snowballs', 'common', 22, false, one('snowball', 8));
add('Eggs', 'common', 14, false, one('egg', 8));
add('Arrows', 'common', 18, false, one('arrow', 8));
add('Leather Cap', 'common', 8, false, one('leather_helmet', 1));
add('Leather Tunic', 'common', 8, false, one('leather_chestplate', 1));
add('Leather Pants', 'common', 8, false, one('leather_leggings', 1));
add('Leather Boots', 'common', 8, false, one('leather_boots', 1));
add('Fishing Rod', 'common', 12, false, one('fishing_rod', 1));

// Uncommon
add('Iron Sword', 'uncommon', 14, false, one('iron_sword', 1));
add('Iron Axe', 'uncommon', 8, false, one('iron_axe', 1));
add('Iron Pickaxe', 'uncommon', 6, false, one('iron_pickaxe', 1));
add('Bow', 'uncommon', 14, false, () => [{ id: VI.bow, count: 1 }, { id: VI.arrow, count: 6 }]);
add('Crossbow', 'uncommon', 8, false, () => [{ id: VI.crossbow, count: 1 }, { id: VI.arrow, count: 6 }]);
add('Chainmail Chestplate', 'uncommon', 7, false, one('chainmail_chestplate', 1));
add('Chainmail Helmet', 'uncommon', 6, false, one('chainmail_helmet', 1));
add('Iron Helmet', 'uncommon', 6, false, one('iron_helmet', 1));
add('Iron Boots', 'uncommon', 6, false, one('iron_boots', 1));
add('Iron Leggings', 'uncommon', 5, false, one('iron_leggings', 1));
add('Ender Pearl', 'uncommon', 12, false, one('ender_pearl', 1));
add('Golden Apple', 'uncommon', 12, false, one('golden_apple', 1));
add('Water Bucket', 'uncommon', 10, false, one('water_bucket', 1));
add('Lava Bucket', 'uncommon', 8, false, one('lava_bucket', 1));
add('TNT', 'uncommon', 10, false, () => [{ id: VI.tnt, count: 2, name: 'Instant TNT', tag: 'instant_tnt' }]);
add('Wind Charges', 'uncommon', 10, false, one('wind_charge', 4));
add('Cobwebs', 'uncommon', 8, false, one('cobweb', 3));
add('Slime Blocks', 'uncommon', 6, false, one('slime_block', 4));
add('Honey Blocks', 'uncommon', 4, false, one('honey_block', 4));
add('Knockback Stick', 'uncommon', 10, false, () => [ench(named({ id: VI.stick, count: 1 }, 'Knockback Stick'), 'knockback', 2)]);
add('Splash Harming', 'uncommon', 6, false, () => [potion('splash_potion', 'harming')]);
add('Splash Poison', 'uncommon', 5, false, () => [potion('splash_potion', 'poison')]);
add('Splash Slowness', 'uncommon', 5, false, () => [potion('splash_potion', 'slowness')]);
add('Splash Healing', 'uncommon', 6, false, () => [potion('splash_potion', 'healing')]);
add('Swiftness Potion', 'uncommon', 5, false, () => [potion('potion', 'swiftness')]);
add('Leaping Potion', 'uncommon', 4, false, () => [potion('potion', 'leaping')]);
add('Fire Charges', 'uncommon', 5, false, one('fire_charge', 3));
add('Flint and Steel', 'uncommon', 5, false, one('flint_and_steel', 1));
add('Anvil', 'uncommon', 4, false, () => [named({ id: VI.anvil, count: 1 }, 'Anvil')]);
add('Chorus Fruit', 'uncommon', 6, false, () => [named({ id: VI.chorus_fruit, count: 3 }, 'Chorus Fruit')]);
add('Shield', 'uncommon', 6, false, one('shield', 1));
add('Spectral Arrows', 'uncommon', 5, false, one('spectral_arrow', 8));
add('Milk Bucket', 'uncommon', 3, false, one('milk_bucket', 1));
add('Zombie Egg', 'uncommon', 4, false, one('zombie_spawn_egg', 1));
add('Silverfish Eggs', 'uncommon', 4, false, one('silverfish_spawn_egg', 2));
add('Powder Snow', 'uncommon', 4, false, one('powder_snow_bucket', 1));

// Rare
add('Diamond Sword', 'rare', 10, false, one('diamond_sword', 1));
add('Diamond Axe', 'rare', 6, false, one('diamond_axe', 1));
add('Diamond Chestplate', 'rare', 6, false, one('diamond_chestplate', 1));
add('Diamond Helmet', 'rare', 6, false, one('diamond_helmet', 1));
add('Diamond Leggings', 'rare', 5, false, one('diamond_leggings', 1));
add('Diamond Boots', 'rare', 6, false, one('diamond_boots', 1));
add('Power Bow', 'rare', 7, false, () => [ench({ id: VI.bow, count: 1 }, 'power', 2), { id: VI.arrow, count: 10 }]);
add('Yeet Bow', 'rare', 6, false, () => [ench(named({ id: VI.bow, count: 1 }, 'Yeet Bow'), 'punch', 2), { id: VI.arrow, count: 8 }]);
add('Ender Pearls', 'rare', 6, false, one('ender_pearl', 3));
add('Golden Apples', 'rare', 5, false, one('golden_apple', 3));
add('Creeper Eggs', 'rare', 6, false, one('creeper_spawn_egg', 2));
add('Skeleton Egg', 'rare', 4, false, one('skeleton_spawn_egg', 1));
add('Guard Dogs', 'rare', 5, false, () => [named({ id: VI.wolf_spawn_egg, count: 2 }, 'Guard Dog')]);
add('Loyal Trident', 'rare', 5, false, () => [ench({ id: VI.trident, count: 1 }, 'loyalty', 3)]);
add('Firework Crossbow', 'rare', 4, false, () => [
  ench(named({ id: VI.crossbow, count: 1 }, 'Firework Crossbow'), 'multishot', 1),
  { id: VI.firework_rocket, count: 4, flight: 1, tag: 'firework_star' },
]);
add('Strength Potion', 'rare', 5, false, () => [potion('potion', 'strength')]);
add('Invisibility Potion', 'rare', 4, false, () => [potion('potion', 'invisibility')]);
add('Splash Levitation', 'rare', 5, false, () => [{ id: VI.splash_potion, count: 1, name: 'Splash Levitation', potion: { effects: [['levitation', 2, 60]], color: 0xceffff, label: 'Levitation' } }]);
add('Splash Harming II', 'rare', 4, false, () => [potion('splash_potion', 'strong_harming', 2)]);
add('Fire Poker', 'rare', 4, false, () => [ench(ench(named({ id: VI.blaze_rod, count: 1 }, 'Fire Poker'), 'fire_aspect', 2), 'knockback', 1)]);
add('Lingering Poison', 'rare', 3, false, () => [potion('lingering_potion', 'strong_poison')]);

// Epic
add('Enchanted Golden Apple', 'epic', 6, false, one('enchanted_golden_apple', 1));
add('Totem of Undying', 'epic', 6, false, one('totem_of_undying', 1));
add('Mace', 'epic', 5, false, () => [{ id: VI.mace, count: 1 }, { id: VI.wind_charge, count: 3 }]);
add('Elytra', 'epic', 5, false, () => [{ id: VI.elytra, count: 1 }, { id: VI.firework_rocket, count: 5, flight: 1 }]);
add('Wolf Pack', 'epic', 4, false, () => [named({ id: VI.wolf_spawn_egg, count: 4 }, 'Guard Dog')]);
add('End Crystals', 'epic', 4, false, () => [named({ id: VI.end_crystal, count: 2 }, 'End Crystal')]);
add('Sharp Diamond Sword', 'epic', 5, false, () => [ench({ id: VI.diamond_sword, count: 1 }, 'sharpness', 3)]);
add('Iron Kit', 'epic', 4, false, () => ['iron_helmet', 'iron_chestplate', 'iron_leggings', 'iron_boots'].map((k) => ({ id: vi(k), count: 1 })));
add('Pearl Stash', 'epic', 3, false, one('ender_pearl', 8));

// Legendary
add('Excalibur', 'legendary', 2, false, () => [ench(ench(named({ id: VI.netherite_sword, count: 1 }, 'Excalibur'), 'sharpness', 5), 'fire_aspect', 2)]);
add("Thor's Hammer", 'legendary', 2, false, () => [ench(ench(named({ id: VI.mace, count: 1 }, "Thor's Hammer"), 'density', 5), 'wind_burst', 3), { id: VI.wind_charge, count: 6 }]);
add('Juggernaut Armor', 'legendary', 2, false, () => ['diamond_helmet', 'diamond_chestplate', 'diamond_leggings', 'diamond_boots'].map((k) => ench({ id: vi(k), count: 1 }, 'protection', 2)));
add('Ender Storm', 'legendary', 1, false, one('ender_pearl', 16));

export function entryWeight(e: LootEntry, boost: number): number {
  return e.weight * Math.pow(Math.max(1, boost), RARITY[e.rarity].exp);
}
function pick(rng: () => number, entries: LootEntry[], boost: number): LootEntry {
  let total = 0;
  for (const e of entries) total += entryWeight(e, boost);
  let roll = rng() * total;
  for (const e of entries) { roll -= entryWeight(e, boost); if (roll <= 0) return e; }
  return entries[entries.length - 1];
}
export function rollLoot(rng: () => number, boost: number): LootEntry { return pick(rng, LOOT, boost); }
export function rollStarter(rng: () => number): LootEntry { return pick(rng, LOOT.filter((e) => e.starter), 1); }
export function tierChance(r: Rarity, boost: number): number {
  let total = 0, tier = 0;
  for (const e of LOOT) { const w = entryWeight(e, boost); total += w; if (e.rarity === r) tier += w; }
  return tier / total;
}
