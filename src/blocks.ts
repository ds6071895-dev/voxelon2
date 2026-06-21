// Block definitions: ids, atlas tiles, hardness (vanilla values), flags.

export const enum Block {
  Air = 0,
  Grass = 1,
  Dirt = 2,
  Stone = 3,
  Cobblestone = 4,
  Sand = 5,
  OakLog = 6,
  OakPlanks = 7,
  Leaves = 8,
  Glass = 9,
  Water = 10,
  Bedrock = 11,
  // M1: biomes
  Sandstone = 12,
  SnowyGrass = 13,
  BirchLog = 14,
  BirchLeaves = 15,
  SpruceLog = 16,
  SpruceLeaves = 17,
  Cactus = 18,
  TallGrass = 19,
  DeadBush = 20,
  Dandelion = 21,
  Poppy = 22,
  // M2: ores
  CoalOre = 23,
  IronOre = 24,
  GoldOre = 25,
  RedstoneOre = 26,
  DiamondOre = 27,
  // M3: torches (floor + 4 wall orientations; the item is always Torch)
  Torch = 28,
  TorchPX = 29,
  TorchNX = 30,
  TorchPZ = 31,
  TorchNZ = 32,
  // M5: crafting
  CraftingTable = 33,
  Furnace = 34,
  FurnaceLit = 35,
  // M7: mob drops
  Wool = 36,
  // Storage
  Chest = 37,
  // Armor material ore (deep in mountains)
  TitaniumOre = 38,
}

export const enum Tile {
  GrassTop = 0,
  GrassSide = 1,
  Dirt = 2,
  Stone = 3,
  Cobblestone = 4,
  Sand = 5,
  LogSide = 6,
  LogTop = 7,
  Planks = 8,
  Leaves = 9,
  Glass = 10,
  Water = 11,
  Bedrock = 12,
  Sandstone = 13,
  SandstoneTop = 14,
  Snow = 15,
  SnowySide = 16,
  BirchLogSide = 17,
  BirchLogTop = 18,
  SpruceLogSide = 19,
  SpruceLogTop = 20,
  BirchLeaves = 21,
  SpruceLeaves = 22,
  CactusSide = 23,
  CactusTop = 24,
  TallGrass = 25,
  DeadBush = 26,
  Dandelion = 27,
  Poppy = 28,
  CoalOre = 29,
  IronOre = 30,
  GoldOre = 31,
  RedstoneOre = 32,
  DiamondOre = 33,
  Torch = 34,
  // item sprites (M4)
  Stick = 35,
  CoalItem = 36,
  IronIngot = 37,
  Apple = 38,
  PorkchopRaw = 39,
  PorkchopCooked = 40,
  BeefRaw = 41,
  BeefCooked = 42,
  RedstoneDust = 43,
  Diamond = 44,
  // M5
  CraftingTableTop = 45,
  CraftingTableSide = 46,
  FurnaceFront = 47,
  FurnaceFrontLit = 48,
  FurnaceSide = 49,
  WoodPickaxe = 50,
  WoodAxe = 51,
  WoodShovel = 52,
  WoodSword = 53,
  StonePickaxe = 54,
  StoneAxe = 55,
  StoneShovel = 56,
  StoneSword = 57,
  IronPickaxe = 58,
  IronAxe = 59,
  IronShovel = 60,
  IronSword = 61,
  Charcoal = 62,
  GoldIngot = 63,
  // M7
  ChickenRaw = 64,
  ChickenCooked = 65,
  Feather = 66,
  Wool = 67,
  PigSkin = 68,
  PigFace = 69,
  CowSkin = 70,
  CowFace = 71,
  SheepSkin = 72,
  SheepFace = 73,
  ChickenSkin = 74,
  ChickenFace = 75,
  ZombieSkin = 76,
  ZombieFace = 77,
  ZombieShirt = 78,
  ZombiePants = 79,
  CreeperSkin = 80,
  CreeperFace = 81,
  ChestTop = 82,
  ChestSide = 83,
  ChestFront = 84,
  // Armor + guns (parked features)
  TitaniumOre = 85,
  TitaniumIngot = 86,
  ArmorHelmetIron = 87,
  ArmorChestIron = 88,
  ArmorLegsIron = 89,
  ArmorBootsIron = 90,
  ArmorHelmetDiamond = 91,
  ArmorChestDiamond = 92,
  ArmorLegsDiamond = 93,
  ArmorBootsDiamond = 94,
  ArmorHelmetTitanium = 95,
  ArmorChestTitanium = 96,
  ArmorLegsTitanium = 97,
  ArmorBootsTitanium = 98,
  Pistol = 99,
  Rifle = 100,
  RocketLauncher = 101,
  Bullet = 102,
  Rocket = 103,
}

export type ToolKind = 'pickaxe' | 'axe' | 'shovel';

export type BlockShape = 'cube' | 'cross' | 'torch';
export type TintKind = 'grass' | 'foliage' | null;

export interface BlockInfo {
  /** Block light emitted (torch = 14). */
  emission: number;
  /** Tool that mines this block faster. */
  tool: ToolKind | null;
  /** Drops only when mined with the right tool of sufficient tier. */
  requiresTool: boolean;
  /** Minimum tool tier to harvest (wood 0, stone 1, iron 2). */
  minTier: number;
  name: string;
  /** Vanilla hardness; hand break time = hardness * 1.5s. <0 = unbreakable. */
  hardness: number;
  /** Has collision. */
  solid: boolean;
  /** Fully hides faces of neighbouring blocks. */
  opaque: boolean;
  /** Occludes light for ambient-occlusion purposes. */
  occludes: boolean;
  /** cube, or cross (billboard plant). */
  shape: BlockShape;
  /** Biome tint: grass tints only the top face of Grass, all of TallGrass. */
  tint: TintKind;
  /** Placing a block into this one replaces it (tall grass, dead bush). */
  replaceable: boolean;
  /** Atlas tile per face (cross shapes use `side`). */
  top: Tile;
  bottom: Tile;
  side: Tile;
}

interface Partial {
  name: string;
  hardness: number;
  top: Tile;
  bottom?: Tile;
  side?: Tile;
  solid?: boolean;
  opaque?: boolean;
  occludes?: boolean;
  shape?: BlockShape;
  tint?: TintKind;
  replaceable?: boolean;
  emission?: number;
}

function def(p: Partial): BlockInfo {
  return {
    emission: p.emission ?? 0,
    tool: null,
    requiresTool: false,
    minTier: 0,
    name: p.name,
    hardness: p.hardness,
    solid: p.solid ?? true,
    opaque: p.opaque ?? true,
    occludes: p.occludes ?? true,
    shape: p.shape ?? 'cube',
    tint: p.tint ?? null,
    replaceable: p.replaceable ?? false,
    top: p.top,
    bottom: p.bottom ?? p.top,
    side: p.side ?? p.top,
  };
}

function plant(name: string, tile: Tile, tint: TintKind, replaceable: boolean): BlockInfo {
  return def({
    name, hardness: 0, top: tile,
    solid: false, opaque: false, occludes: false,
    shape: 'cross', tint, replaceable,
  });
}

function torchDefs(): Record<number, BlockInfo> {
  const torch = () => def({
    name: 'Torch', hardness: 0, top: Tile.Torch,
    solid: false, opaque: false, occludes: false,
    shape: 'torch', emission: 14,
  });
  return {
    [Block.Torch]: torch(),
    [Block.TorchPX]: torch(),
    [Block.TorchNX]: torch(),
    [Block.TorchPZ]: torch(),
    [Block.TorchNZ]: torch(),
  };
}

/** Direction from a torch cell toward its supporting block. */
export function torchSupport(id: number): [number, number, number] | null {
  switch (id) {
    case Block.Torch: return [0, -1, 0];
    case Block.TorchPX: return [-1, 0, 0];
    case Block.TorchNX: return [1, 0, 0];
    case Block.TorchPZ: return [0, 0, -1];
    case Block.TorchNZ: return [0, 0, 1];
    default: return null;
  }
}

/** Oriented torch block for a placement face normal (null = can't attach). */
export function torchForFace(nx: number, ny: number, nz: number): Block | null {
  if (ny > 0) return Block.Torch;
  if (ny < 0) return null;
  if (nx > 0) return Block.TorchPX;
  if (nx < 0) return Block.TorchNX;
  if (nz > 0) return Block.TorchPZ;
  if (nz < 0) return Block.TorchNZ;
  return null;
}

export const BLOCKS: Record<number, BlockInfo> = {
  [Block.Grass]: def({
    name: 'Grass Block', hardness: 0.6,
    top: Tile.GrassTop, bottom: Tile.Dirt, side: Tile.GrassSide, tint: 'grass',
  }),
  [Block.Dirt]: def({ name: 'Dirt', hardness: 0.5, top: Tile.Dirt }),
  [Block.Stone]: def({ name: 'Stone', hardness: 1.5, top: Tile.Stone }),
  [Block.Cobblestone]: def({ name: 'Cobblestone', hardness: 2.0, top: Tile.Cobblestone }),
  [Block.Sand]: def({ name: 'Sand', hardness: 0.5, top: Tile.Sand }),
  [Block.OakLog]: def({
    name: 'Oak Log', hardness: 2.0, top: Tile.LogTop, side: Tile.LogSide,
  }),
  [Block.OakPlanks]: def({ name: 'Oak Planks', hardness: 2.0, top: Tile.Planks }),
  [Block.Leaves]: def({
    name: 'Oak Leaves', hardness: 0.2, top: Tile.Leaves,
    opaque: false, tint: 'foliage',
  }),
  [Block.Glass]: def({
    name: 'Glass', hardness: 0.3, top: Tile.Glass, opaque: false, occludes: false,
  }),
  [Block.Water]: def({
    name: 'Water', hardness: -1, top: Tile.Water,
    solid: false, opaque: false, occludes: false,
  }),
  [Block.Bedrock]: def({ name: 'Bedrock', hardness: -1, top: Tile.Bedrock }),

  [Block.Sandstone]: def({
    name: 'Sandstone', hardness: 0.8,
    top: Tile.SandstoneTop, side: Tile.Sandstone,
  }),
  [Block.SnowyGrass]: def({
    name: 'Snowy Grass Block', hardness: 0.6,
    top: Tile.Snow, bottom: Tile.Dirt, side: Tile.SnowySide,
  }),
  [Block.BirchLog]: def({
    name: 'Birch Log', hardness: 2.0,
    top: Tile.BirchLogTop, side: Tile.BirchLogSide,
  }),
  [Block.BirchLeaves]: def({
    name: 'Birch Leaves', hardness: 0.2, top: Tile.BirchLeaves, opaque: false,
  }),
  [Block.SpruceLog]: def({
    name: 'Spruce Log', hardness: 2.0,
    top: Tile.SpruceLogTop, side: Tile.SpruceLogSide,
  }),
  [Block.SpruceLeaves]: def({
    name: 'Spruce Leaves', hardness: 0.2, top: Tile.SpruceLeaves, opaque: false,
  }),
  [Block.Cactus]: def({
    name: 'Cactus', hardness: 0.4,
    top: Tile.CactusTop, side: Tile.CactusSide, opaque: false,
  }),
  [Block.TallGrass]: plant('Grass', Tile.TallGrass, 'grass', true),
  [Block.DeadBush]: plant('Dead Bush', Tile.DeadBush, null, true),
  [Block.Dandelion]: plant('Dandelion', Tile.Dandelion, null, false),
  [Block.Poppy]: plant('Poppy', Tile.Poppy, null, false),

  ...torchDefs(),

  [Block.CoalOre]: def({ name: 'Coal Ore', hardness: 3.0, top: Tile.CoalOre }),
  [Block.IronOre]: def({ name: 'Iron Ore', hardness: 3.0, top: Tile.IronOre }),
  [Block.GoldOre]: def({ name: 'Gold Ore', hardness: 3.0, top: Tile.GoldOre }),
  [Block.RedstoneOre]: def({ name: 'Redstone Ore', hardness: 3.0, top: Tile.RedstoneOre }),
  [Block.DiamondOre]: def({ name: 'Diamond Ore', hardness: 3.0, top: Tile.DiamondOre }),
  [Block.TitaniumOre]: def({ name: 'Titanium Ore', hardness: 4.5, top: Tile.TitaniumOre }),

  [Block.CraftingTable]: def({
    name: 'Crafting Table', hardness: 2.5,
    top: Tile.CraftingTableTop, bottom: Tile.Planks, side: Tile.CraftingTableSide,
  }),
  [Block.Furnace]: def({
    name: 'Furnace', hardness: 3.5,
    top: Tile.FurnaceSide, side: Tile.FurnaceFront,
  }),
  [Block.FurnaceLit]: def({
    name: 'Furnace', hardness: 3.5, emission: 13,
    top: Tile.FurnaceSide, side: Tile.FurnaceFrontLit,
  }),
  [Block.Wool]: def({ name: 'Wool', hardness: 0.8, top: Tile.Wool }),
  [Block.Chest]: def({
    name: 'Chest', hardness: 2.5,
    top: Tile.ChestTop, bottom: Tile.ChestTop, side: Tile.ChestSide,
  }),
};

// Vanilla tool effectiveness and harvest tiers (wood 0, stone 1, iron 2).
const PICKAXE_TIERS: [Block, number][] = [
  [Block.Stone, 0], [Block.Cobblestone, 0], [Block.Sandstone, 0],
  [Block.CoalOre, 0], [Block.IronOre, 1], [Block.GoldOre, 2],
  [Block.RedstoneOre, 2], [Block.DiamondOre, 2], [Block.TitaniumOre, 2],
  [Block.Furnace, 0], [Block.FurnaceLit, 0],
];
for (const [b, tier] of PICKAXE_TIERS) {
  BLOCKS[b].tool = 'pickaxe';
  BLOCKS[b].requiresTool = true;
  BLOCKS[b].minTier = tier;
}
for (const b of [
  Block.OakLog, Block.BirchLog, Block.SpruceLog, Block.OakPlanks,
  Block.CraftingTable, Block.Chest,
]) BLOCKS[b].tool = 'axe';
for (const b of [
  Block.Dirt, Block.Grass, Block.SnowyGrass, Block.Sand,
]) BLOCKS[b].tool = 'shovel';

export function isSolid(id: number): boolean {
  return id !== Block.Air && (BLOCKS[id]?.solid ?? false);
}
export function isOpaque(id: number): boolean {
  return id !== Block.Air && (BLOCKS[id]?.opaque ?? false);
}
export function occludesAO(id: number): boolean {
  return id !== Block.Air && (BLOCKS[id]?.occludes ?? false);
}
export function isReplaceable(id: number): boolean {
  return id === Block.Air || id === Block.Water ||
    (BLOCKS[id]?.replaceable ?? false);
}
