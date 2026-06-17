// Item registry. Placeable blocks share their Block id; pure items start at
// 100. Includes the vanilla drop table used when blocks break.

import { Block, BLOCKS, BlockInfo, Tile, ToolKind } from './blocks';

export const enum Item {
  // Blocks are items with id === Block id (wall torch variants are not items).
  Stick = 100,
  Coal = 101,
  IronIngot = 102,
  Redstone = 108,
  Diamond = 109,
  // M5: tools (vanilla stats) + smelting products. (No swords in VOXELON.)
  WoodenPickaxe = 110,
  WoodenAxe = 111,
  WoodenShovel = 112,
  StonePickaxe = 114,
  StoneAxe = 115,
  StoneShovel = 116,
  IronPickaxe = 118,
  IronAxe = 119,
  IronShovel = 120,
  Charcoal = 122,
  GoldIngot = 123,
}

export interface ToolInfo {
  type: ToolKind;
  /** Harvest tier: wood 0, stone 1, iron 2. */
  tier: number;
  /** Mining speed multiplier on effective blocks (wood 2, stone 4, iron 6). */
  speed: number;
  durability: number;
  /** Melee damage dealt to mobs. */
  damage: number;
}

export interface ItemInfo {
  name: string;
  kind: 'block' | 'item';
  /** Block placed by this item (block items only). */
  block?: Block;
  /** Sprite tile for pure items. */
  sprite?: Tile;
  maxStack: number;
  tool?: ToolInfo;
}

export interface ItemStack {
  id: number;
  count: number;
  /** Accumulated tool damage (tools only). */
  damage?: number;
}

function blockItem(block: Block): ItemInfo {
  return { name: BLOCKS[block].name, kind: 'block', block, maxStack: 64 };
}
function pureItem(name: string, sprite: Tile): ItemInfo {
  return { name, kind: 'item', sprite, maxStack: 64 };
}

const TOOL_TIERS = [
  { prefix: 'Wooden', tier: 0, speed: 2, durability: 59 },
  { prefix: 'Stone', tier: 1, speed: 4, durability: 131 },
  { prefix: 'Iron', tier: 2, speed: 6, durability: 250 },
];

function toolItem(tierIdx: number, type: ToolKind, sprite: Tile): ItemInfo {
  const t = TOOL_TIERS[tierIdx];
  // Axes hit hardest, then pickaxes/shovels; all scale a little with tier.
  const baseDamage = type === 'axe' ? 3 : 2;
  return {
    name: `${t.prefix} ${type[0].toUpperCase()}${type.slice(1)}`,
    kind: 'item', sprite, maxStack: 1,
    tool: { type, tier: t.tier, speed: t.speed, durability: t.durability,
      damage: baseDamage + t.tier },
  };
}

export const ITEMS: Record<number, ItemInfo> = {
  [Block.Grass]: blockItem(Block.Grass),
  [Block.Dirt]: blockItem(Block.Dirt),
  [Block.Stone]: blockItem(Block.Stone),
  [Block.Cobblestone]: blockItem(Block.Cobblestone),
  [Block.Sand]: blockItem(Block.Sand),
  [Block.OakLog]: blockItem(Block.OakLog),
  [Block.OakPlanks]: blockItem(Block.OakPlanks),
  [Block.Leaves]: blockItem(Block.Leaves),
  [Block.Glass]: blockItem(Block.Glass),
  [Block.Sandstone]: blockItem(Block.Sandstone),
  [Block.BirchLog]: blockItem(Block.BirchLog),
  [Block.BirchLeaves]: blockItem(Block.BirchLeaves),
  [Block.SpruceLog]: blockItem(Block.SpruceLog),
  [Block.SpruceLeaves]: blockItem(Block.SpruceLeaves),
  [Block.Cactus]: blockItem(Block.Cactus),
  [Block.Dandelion]: blockItem(Block.Dandelion),
  [Block.Poppy]: blockItem(Block.Poppy),
  [Block.CoalOre]: blockItem(Block.CoalOre),
  [Block.IronOre]: blockItem(Block.IronOre),
  [Block.GoldOre]: blockItem(Block.GoldOre),
  [Block.Torch]: blockItem(Block.Torch),
  [Block.CraftingTable]: blockItem(Block.CraftingTable),
  [Block.Furnace]: blockItem(Block.Furnace),

  [Item.Stick]: pureItem('Stick', Tile.Stick),
  [Item.Coal]: pureItem('Coal', Tile.CoalItem),
  [Item.IronIngot]: pureItem('Iron Ingot', Tile.IronIngot),
  [Item.Redstone]: pureItem('Redstone Dust', Tile.RedstoneDust),
  [Item.Diamond]: pureItem('Diamond', Tile.Diamond),

  [Item.WoodenPickaxe]: toolItem(0, 'pickaxe', Tile.WoodPickaxe),
  [Item.WoodenAxe]: toolItem(0, 'axe', Tile.WoodAxe),
  [Item.WoodenShovel]: toolItem(0, 'shovel', Tile.WoodShovel),
  [Item.StonePickaxe]: toolItem(1, 'pickaxe', Tile.StonePickaxe),
  [Item.StoneAxe]: toolItem(1, 'axe', Tile.StoneAxe),
  [Item.StoneShovel]: toolItem(1, 'shovel', Tile.StoneShovel),
  [Item.IronPickaxe]: toolItem(2, 'pickaxe', Tile.IronPickaxe),
  [Item.IronAxe]: toolItem(2, 'axe', Tile.IronAxe),
  [Item.IronShovel]: toolItem(2, 'shovel', Tile.IronShovel),
  [Item.Charcoal]: pureItem('Charcoal', Tile.Charcoal),
  [Item.GoldIngot]: pureItem('Gold Ingot', Tile.GoldIngot),
};

/**
 * Vanilla mining: effective tools divide `hardness * 1.5` by their speed;
 * blocks that require a tool you can't harvest with take `hardness * 5`
 * (and drop nothing).
 */
export function miningStats(
  info: BlockInfo, held: ItemStack | null
): { time: number; harvest: boolean } {
  const tool = held ? ITEMS[held.id]?.tool : undefined;
  const effective = !!tool && tool.type === info.tool;
  const harvest =
    !info.requiresTool || (effective && tool!.tier >= info.minTier);
  if (info.hardness <= 0) return { time: 0, harvest };
  const speed = effective && harvest ? tool!.speed : 1;
  const time = harvest ? (info.hardness * 1.5) / speed : info.hardness * 5;
  return { time, harvest };
}

/**
 * Vanilla drop table. `rng` in [0,1) drives probabilistic drops;
 * `harvested` is false when mined without the required tool (no drop).
 */
export function dropFor(
  block: number, rng: number, harvested = true
): ItemStack | null {
  if (!harvested && BLOCKS[block]?.requiresTool) return null;
  switch (block) {
    case Block.FurnaceLit:
      return { id: Block.Furnace, count: 1 };
    case Block.Grass:
    case Block.SnowyGrass:
      return { id: Block.Dirt, count: 1 };
    case Block.Stone:
      return { id: Block.Cobblestone, count: 1 };
    case Block.Leaves:
      // occasional sticks
      if (rng < 0.025) return { id: Item.Stick, count: 1 };
      return null;
    case Block.BirchLeaves:
    case Block.SpruceLeaves:
      if (rng < 0.02) return { id: Item.Stick, count: 1 };
      return null;
    case Block.Glass:
    case Block.TallGrass:
      return null; // vanilla: nothing without shears/silk touch
    case Block.DeadBush:
      return rng < 0.5 ? { id: Item.Stick, count: 1 } : null;
    case Block.CoalOre:
      return { id: Item.Coal, count: 1 };
    case Block.RedstoneOre:
      return { id: Item.Redstone, count: 4 + (rng < 0.5 ? 0 : 1) };
    case Block.DiamondOre:
      return { id: Item.Diamond, count: 1 };
    case Block.Torch:
    case Block.TorchPX:
    case Block.TorchNX:
    case Block.TorchPZ:
    case Block.TorchNZ:
      return { id: Block.Torch, count: 1 };
    case Block.Bedrock:
    case Block.Water:
    case Block.Air:
      return null;
    default:
      // Everything else drops itself if it is registered as an item.
      return ITEMS[block] ? { id: block, count: 1 } : null;
  }
}
