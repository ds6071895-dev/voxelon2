import { Block } from './blocks';
import { Item } from './items';
import type { BwResource, BwTeam, BwUpgrades } from './bedwars_rules';

export type BwCategory = 'blocks' | 'combat' | 'tools' | 'extras' | 'upgrades';
export const BW_CATEGORIES: { id: BwCategory; label: string }[] = [
  { id: 'blocks', label: 'Blocks' }, { id: 'combat', label: 'Combat' }, { id: 'tools', label: 'Tools' },
  { id: 'extras', label: 'Extras' }, { id: 'upgrades', label: 'Upgrades' },
];
export interface BwCatalogEntry {
  sku: string; name: string; description: string; category: BwCategory;
  cost: number; resource: BwResource; item: number; count: number;
  type: 'block' | 'sword' | 'armor' | 'tool' | 'bow' | 'arrow' | 'tnt' | 'pearl' | 'heal' | 'upgrade';
  tier?: number; toolKind?: 'pickaxe' | 'axe' | 'shears'; upgrade?: keyof BwUpgrades; max?: number;
  /** Quick-buy key shown in the shop, 1-9. */
  key?: number;
}
export const BW_CATALOG: readonly BwCatalogEntry[] = [
  { sku: 'wool', name: 'Wool', description: '16 blocks. Fast to place, fast to break.', category: 'blocks', cost: 4, resource: 'iron', item: Block.TeamWoolA, count: 16, type: 'block', key: 1 },
  { sku: 'wood', name: 'Planks', description: '16 sturdy blocks. Best broken with an axe.', category: 'blocks', cost: 4, resource: 'gold', item: Block.OakPlanks, count: 16, type: 'block' },
  { sku: 'sandstone', name: 'Sandstone', description: '12 tough blocks. Use a pickaxe.', category: 'blocks', cost: 24, resource: 'iron', item: Block.Sandstone, count: 12, type: 'block' },
  { sku: 'glass', name: 'Glass', description: '4 blocks that survive TNT.', category: 'blocks', cost: 12, resource: 'iron', item: Block.ManorGlass, count: 4, type: 'block' },
  { sku: 'stone_sword', name: 'Stone Sword', description: '5 damage. Lost on death.', category: 'combat', cost: 10, resource: 'iron', item: Item.StoneSword, count: 1, type: 'sword', tier: 1, key: 2 },
  { sku: 'iron_sword', name: 'Iron Sword', description: '6 damage. Lost on death.', category: 'combat', cost: 7, resource: 'gold', item: Item.IronSword, count: 1, type: 'sword', tier: 2 },
  { sku: 'diamond_sword', name: 'Diamond Sword', description: '8 damage. Lost on death.', category: 'combat', cost: 4, resource: 'emerald', item: Item.DiamondSword, count: 1, type: 'sword', tier: 3 },
  { sku: 'chain_armor', name: 'Chain Armor', description: 'Take 15% less damage, permanently.', category: 'combat', cost: 30, resource: 'iron', item: Item.ChainArmor, count: 1, type: 'armor', tier: 1 },
  { sku: 'iron_armor', name: 'Iron Armor', description: 'Take 30% less damage, permanently.', category: 'combat', cost: 12, resource: 'gold', item: Item.IronArmor, count: 1, type: 'armor', tier: 2, key: 3 },
  { sku: 'diamond_armor', name: 'Diamond Armor', description: 'Take 45% less damage, permanently.', category: 'combat', cost: 6, resource: 'emerald', item: Item.DiamondArmor, count: 1, type: 'armor', tier: 3 },
  { sku: 'bow', name: 'Bow', description: 'Hold to charge, release to shoot.', category: 'combat', cost: 12, resource: 'gold', item: Item.BridgeBow, count: 1, type: 'bow' },
  { sku: 'arrows', name: 'Arrows', description: '8 arrows.', category: 'combat', cost: 2, resource: 'gold', item: Item.BridgeArrow, count: 8, type: 'arrow' },
  { sku: 'tools', name: 'Wooden Pickaxe', description: 'Mines sandstone 3x faster. Kept on death.', category: 'tools', cost: 10, resource: 'iron', item: Item.WoodPickaxe, count: 1, type: 'tool', toolKind: 'pickaxe', tier: 1, key: 4 },
  { sku: 'iron_tools', name: 'Iron Pickaxe', description: 'Mines sandstone 6x faster. Kept on death.', category: 'tools', cost: 6, resource: 'gold', item: Item.IronPickaxe, count: 1, type: 'tool', toolKind: 'pickaxe', tier: 2 },
  { sku: 'wood_axe', name: 'Wooden Axe', description: 'Breaks planks 3x faster. Kept on death.', category: 'tools', cost: 10, resource: 'iron', item: Item.WoodAxe, count: 1, type: 'tool', toolKind: 'axe', tier: 1 },
  { sku: 'iron_axe', name: 'Iron Axe', description: 'Breaks planks 6x faster. Kept on death.', category: 'tools', cost: 6, resource: 'gold', item: Item.IronAxe, count: 1, type: 'tool', toolKind: 'axe', tier: 2 },
  { sku: 'shears', name: 'Shears', description: 'Breaks wool 8x faster. Kept on death.', category: 'tools', cost: 20, resource: 'iron', item: Item.Shears, count: 1, type: 'tool', toolKind: 'shears', tier: 3 },
  { sku: 'tnt', name: 'TNT', description: 'Thrown, 3 second fuse. Breaks blocks, never beds.', category: 'extras', cost: 4, resource: 'gold', item: Item.BedwarsTNT, count: 1, type: 'tnt', key: 5 },
  { sku: 'pearl', name: 'Ender Pearl', description: 'Throw to teleport where it lands.', category: 'extras', cost: 4, resource: 'emerald', item: Item.TeleportPearl, count: 1, type: 'pearl' },
  { sku: 'heal', name: 'Golden Apple', description: 'Restores 8 health over 4 seconds.', category: 'extras', cost: 3, resource: 'gold', item: Item.HealingApple, count: 1, type: 'heal' },
  { sku: 'sharpness', name: 'Sharpness', description: 'Whole team deals +1 damage per level.', category: 'upgrades', cost: 4, resource: 'diamond', item: Item.DiamondSword, count: 1, type: 'upgrade', upgrade: 'sharpness', max: 2 },
  { sku: 'protection', name: 'Protection', description: 'Whole team takes 8% less damage per level.', category: 'upgrades', cost: 2, resource: 'diamond', item: Item.IronArmor, count: 1, type: 'upgrade', upgrade: 'protection', max: 4 },
  { sku: 'forge', name: 'Forge', description: 'Your base makes iron and gold faster.', category: 'upgrades', cost: 2, resource: 'diamond', item: Item.IronIngot, count: 1, type: 'upgrade', upgrade: 'forge', max: 3 },
  { sku: 'haste', name: 'Haste', description: 'Whole team mines 25% faster per level.', category: 'upgrades', cost: 2, resource: 'diamond', item: Item.IronPickaxe, count: 1, type: 'upgrade', upgrade: 'haste', max: 2 },
  { sku: 'heal_pool', name: 'Heal Pool', description: 'Regenerate health near your base.', category: 'upgrades', cost: 1, resource: 'diamond', item: Item.HealingApple, count: 1, type: 'upgrade', upgrade: 'heal', max: 1 },
  { sku: 'trap', name: 'Trap', description: 'Alerts you and slows the next intruder.', category: 'upgrades', cost: 1, resource: 'diamond', item: Item.Mousetrap, count: 1, type: 'upgrade', upgrade: 'trap', max: 1 },
];
export const BW_STARTER = { sku: 'wood_sword', name: 'Wooden Sword', id: Item.WoodSword, count: 1 };

const bySku = new Map(BW_CATALOG.map(e => [e.sku, e]));
const byItem = new Map<number, BwCatalogEntry>();
for (const e of BW_CATALOG) if (e.type !== 'upgrade' && !byItem.has(e.item)) byItem.set(e.item, e);
byItem.set(Block.TeamWoolB, bySku.get('wool')!);

export function bwCatalog(sku: string): BwCatalogEntry | undefined { return bySku.get(sku); }
/** The shop entry an inventory item belongs to (wool of either team is 'wool'). */
export function bwEntryOf(item: number): BwCatalogEntry | undefined { return byItem.get(item); }
export function bwSkuOf(item: number): string { return item === Item.WoodSword ? 'wood_sword' : byItem.get(item)?.sku ?? ''; }
export function bwItem(entry: BwCatalogEntry, team: BwTeam): number { return entry.sku === 'wool' && team === 1 ? Block.TeamWoolB : entry.item; }
export function bwPrice(entry: BwCatalogEntry, upgrades: BwUpgrades): number { return entry.cost * (entry.upgrade ? 2 ** upgrades[entry.upgrade] : 1); }
