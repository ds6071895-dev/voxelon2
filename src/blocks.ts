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
  // Automation layer (M13)
  CobaltOre = 39,    // deep, rare ore -> cobalt ingot (oil-derrick crafting)
  OilShale = 40,     // visual oil-field seep block
  Autominer = 41,    // block-entity: drills the column beneath it
  OilDerrick = 42,   // block-entity: pumps oil from the local oil field
  MachinePart = 43,  // structural cell of a machine's multi-block footprint
  // Warfare layer (M14): ships + turrets
  ShipHelm = 44,     // control block; interact to capture/launch a hull
  Cannon = 45,       // ship weapon block (fires cannonballs while sailing)
  Turret = 46,       // auto-targeting defensive block-entity (sabotage to raid)
  // Decorative building set (M15): per-wood planks + slabs + stairs (stairs use
  // 4 consecutive ids for N/E/S/W facing, like wall torches).
  BirchPlanks = 47,
  SprucePlanks = 48,
  OakSlab = 49,
  BirchSlab = 50,
  SpruceSlab = 51,
  OakStairsN = 52, OakStairsE = 53, OakStairsS = 54, OakStairsW = 55,
  BirchStairsN = 56, BirchStairsE = 57, BirchStairsS = 58, BirchStairsW = 59,
  SpruceStairsN = 60, SpruceStairsE = 61, SpruceStairsS = 62, SpruceStairsW = 63,
  // Top slabs (placed in a cell's UPPER half). The ITEM is always the bottom
  // slab id; the top variant is chosen at placement time, like wall torches.
  OakSlabTop = 64, BirchSlabTop = 65, SpruceSlabTop = 66,
  // Factions layer (M18): the claim Core. Placing one claims a 3×3-chunk
  // footprint for the placer's faction and raises an oil-fuelled shield.
  Core = 67,
  // Terrain overhaul (M21): mesa/badlands + volcanic ashlands signature blocks.
  RedSand = 68,
  Terracotta = 69,   // banded badlands rock
  Basalt = 70,       // volcanic ashlands ground
  Lava = 71,         // surface lava (liquid hazard, like water but burns)
  // Respawn Beacon: a cheap personal spawn block. Mined normally (easily broken,
  // not a tanky block-entity); RIGHT-CLICK to set your respawn point here.
  RespawnBeacon = 72,
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
  // Automation layer (M13)
  CobaltOre = 104,
  CobaltIngot = 105,
  OilBarrel = 106,
  OilShale = 107,
  AutominerSide = 108,
  AutominerTop = 109,
  OilDerrickSide = 110,
  OilDerrickTop = 111,
  MachinePart = 112,
  // Warfare layer (M14)
  ShipHelmSide = 113,
  ShipHelmTop = 114,
  CannonSide = 115,
  CannonTop = 116,
  TurretSide = 117,
  TurretTop = 118,
  Cannonball = 119,
  // Building set (M15)
  BirchPlanks = 120,
  SprucePlanks = 121,
  // Factions layer (M18): claim Core
  CoreSide = 122,
  CoreTop = 123,
  // Terrain overhaul (M21)
  RedSand = 124,
  Terracotta = 125,
  Basalt = 126,
  Lava = 127,

  // Arcade guns (M-guns)
  Shotgun = 128,
  SMG = 129,
  Sniper = 130,
  BurstRifle = 131,
  // Glider (early-game chestplate-slot wings)
  Glider = 132,
  // Gadgets (Phase 8): nine war toys.
  Grenade = 133,
  C4 = 134,
  GrapplingHook = 135,
  DeployCover = 136,
  SentryKit = 137,
  SmokeGrenade = 138,
  WarHorn = 139,
  OilBomb = 140,
  SpyDisguise = 141,
  JumpBoost = 142,
  // Respawn Beacon (personal spawn point block)
  RespawnBeaconSide = 143,
  RespawnBeaconTop = 144,
}

export type ToolKind = 'pickaxe' | 'axe' | 'shovel';

export type BlockShape = 'cube' | 'cross' | 'torch' | 'slab' | 'stairs';
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
  /** Stairs facing (0=N/-Z, 1=E/+X, 2=S/+Z, 3=W/-X); the tall step is on that side. */
  facing: number;
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
  facing?: number;
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
    facing: p.facing ?? 0,
  };
}

/** Slab (bottom + top variants) + 4 stairs (N/E/S/W) for one wood, keyed at the
 *  given ids (bottom slabId, stairsBase..stairsBase+3, topSlabId). Slabs/stairs
 *  collide via their true partial shape (see shapes.ts) and render partial +
 *  don't fully occlude. */
function woodSet(
  name: string, tile: Tile, slabId: number, stairsBase: number, topSlabId: number
): Record<number, BlockInfo> {
  const slab = (): BlockInfo => def({
    name: `${name} Slab`, hardness: 2.0, top: tile, shape: 'slab',
    opaque: false, occludes: false,
  });
  const out: Record<number, BlockInfo> = {
    [slabId]: slab(),
    [topSlabId]: slab(),
  };
  for (let f = 0; f < 4; f++) {
    out[stairsBase + f] = def({
      name: `${name} Stairs`, hardness: 2.0, top: tile, shape: 'stairs', facing: f,
      opaque: false, occludes: false,
    });
  }
  return out;
}

/** Stairs base id for any stairs variant (or -1). Stairs occupy 4 consecutive
 *  ids per wood: base+0=N, +1=E, +2=S, +3=W. */
export function stairsBaseOf(id: number): number {
  for (const b of [Block.OakStairsN, Block.BirchStairsN, Block.SpruceStairsN]) {
    if (id >= b && id <= b + 3) return b;
  }
  return -1;
}

/** Orient a stairs base id to face the player's cardinal look direction. */
export function orientStairsForYaw(base: number, yaw: number): number {
  const dx = -Math.sin(yaw), dz = -Math.cos(yaw);
  const f = Math.abs(dx) > Math.abs(dz) ? (dx > 0 ? 1 : 3) : (dz > 0 ? 2 : 0);
  return base + f;
}

/** True for any slab (bottom or top variant). */
export function isSlab(id: number): boolean {
  return BLOCKS[id]?.shape === 'slab';
}
/** True only for the upper-half (top) slab variants. */
export function isTopSlab(id: number): boolean {
  return id === Block.OakSlabTop || id === Block.BirchSlabTop ||
    id === Block.SpruceSlabTop;
}
/** The bottom-slab (item) id for any slab variant, or -1 if not a slab. */
export function slabBottomId(id: number): number {
  switch (id) {
    case Block.OakSlab: case Block.OakSlabTop: return Block.OakSlab;
    case Block.BirchSlab: case Block.BirchSlabTop: return Block.BirchSlab;
    case Block.SpruceSlab: case Block.SpruceSlabTop: return Block.SpruceSlab;
    default: return -1;
  }
}
/** The top-slab id paired with a bottom-slab id, or -1 if not a bottom slab. */
export function slabTopId(id: number): number {
  switch (id) {
    case Block.OakSlab: return Block.OakSlabTop;
    case Block.BirchSlab: return Block.BirchSlabTop;
    case Block.SpruceSlab: return Block.SpruceSlabTop;
    default: return -1;
  }
}

/** Vanilla-like slab placement: pick the bottom or top variant of `bottomId`
 *  from the clicked face normal `ny` and the fractional hit height in the cell
 *  (`hitFracY` in [0,1)). Top face -> bottom slab; bottom face -> top slab;
 *  side face -> bottom for the lower half, top for the upper half. */
export function slabPlacement(bottomId: number, ny: number, hitFracY: number): number {
  const useTop = ny > 0 ? false : ny < 0 ? true : hitFracY >= 0.5;
  return useTop ? slabTopId(bottomId) : bottomId;
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
    shape: 'torch', emission: 15, // max block light (brighter, fuller reach)
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

  // --- Automation (M13) ---
  [Block.CobaltOre]: def({ name: 'Cobalt Ore', hardness: 3.5, top: Tile.CobaltOre }),
  [Block.OilShale]: def({ name: 'Oil Shale', hardness: 1.6, top: Tile.OilShale }),
  [Block.Autominer]: def({
    name: 'Autominer', hardness: 3.5,
    top: Tile.AutominerTop, bottom: Tile.AutominerTop, side: Tile.AutominerSide,
  }),
  [Block.OilDerrick]: def({
    name: 'Oil Derrick', hardness: 3.5,
    top: Tile.OilDerrickTop, bottom: Tile.AutominerTop, side: Tile.OilDerrickSide,
  }),
  // Structural footprint cell of a machine (the tower/rig body). Solid so you
  // can't walk through a machine; a lattice cutout texture so it reads as a
  // frame. Not minable/placeable on its own — it lives and dies with its anchor.
  [Block.MachinePart]: def({
    name: 'Machine Frame', hardness: 3.5,
    top: Tile.MachinePart, opaque: false, occludes: false,
  }),

  // --- Warfare (M14) ---
  // Ship blocks are ordinary placeable blocks you build a hull from, then
  // capture by interacting the helm. They mine normally before launch.
  [Block.ShipHelm]: def({
    name: 'Ship Helm', hardness: 3.0,
    top: Tile.ShipHelmTop, bottom: Tile.Planks, side: Tile.ShipHelmSide,
  }),
  [Block.Cannon]: def({
    name: 'Cannon', hardness: 3.5,
    top: Tile.CannonTop, bottom: Tile.AutominerTop, side: Tile.CannonSide,
  }),
  // Turret is a block-entity (like a machine): placed as a normal edit but
  // sabotaged (HP), not mined, and tracked server-side. Single block footprint.
  [Block.Turret]: def({
    name: 'Turret', hardness: 4.0,
    top: Tile.TurretTop, bottom: Tile.AutominerTop, side: Tile.TurretSide,
  }),

  // --- Terrain overhaul (M21): mesa + volcanic ashlands ---
  [Block.RedSand]: def({ name: 'Red Sand', hardness: 0.5, top: Tile.RedSand }),
  [Block.Terracotta]: def({ name: 'Terracotta', hardness: 1.25, top: Tile.Terracotta }),
  [Block.Basalt]: def({ name: 'Basalt', hardness: 1.25, top: Tile.Basalt }),
  [Block.Lava]: def({
    name: 'Lava', hardness: -1, top: Tile.Lava, emission: 15,
    solid: false, opaque: false, occludes: false,
  }),

  // --- Factions (M18): claim Core (block-entity, like a machine) ---
  [Block.Core]: def({
    name: 'Faction Core', hardness: 5.0, emission: 6,
    top: Tile.CoreTop, bottom: Tile.AutominerTop, side: Tile.CoreSide,
  }),

  // --- Respawn Beacon: a cheap personal spawn block. Easily broken (low
  // hardness, plain mining — NOT a tanky block-entity). Right-click sets spawn. ---
  [Block.RespawnBeacon]: def({
    name: 'Respawn Beacon', hardness: 1.0, emission: 9,
    top: Tile.RespawnBeaconTop, bottom: Tile.AutominerTop, side: Tile.RespawnBeaconSide,
  }),

  // --- Building set (M15): per-wood planks + slabs + stairs ---
  [Block.BirchPlanks]: def({ name: 'Birch Planks', hardness: 2.0, top: Tile.BirchPlanks }),
  [Block.SprucePlanks]: def({ name: 'Spruce Planks', hardness: 2.0, top: Tile.SprucePlanks }),
  ...woodSet('Oak', Tile.Planks, Block.OakSlab, Block.OakStairsN, Block.OakSlabTop),
  ...woodSet('Birch', Tile.BirchPlanks, Block.BirchSlab, Block.BirchStairsN, Block.BirchSlabTop),
  ...woodSet('Spruce', Tile.SprucePlanks, Block.SpruceSlab, Block.SpruceStairsN, Block.SpruceSlabTop),
};

// Vanilla tool effectiveness and harvest tiers (wood 0, stone 1, iron 2).
const PICKAXE_TIERS: [Block, number][] = [
  [Block.Stone, 0], [Block.Cobblestone, 0], [Block.Sandstone, 0],
  [Block.CoalOre, 0], [Block.IronOre, 1], [Block.GoldOre, 2],
  [Block.RedstoneOre, 2], [Block.DiamondOre, 2], [Block.TitaniumOre, 2],
  [Block.CobaltOre, 2], // cobalt needs an iron pickaxe, like gold/diamond
  [Block.OilShale, 0],
  [Block.Furnace, 0], [Block.FurnaceLit, 0],
  [Block.Autominer, 0], [Block.OilDerrick, 0],
  [Block.Cannon, 1], [Block.Turret, 1], // metal war machines need a stone+ pick
  [Block.Core, 1], // the claim Core is pickaxe-mineable (owner-only, server-gated)
];
for (const [b, tier] of PICKAXE_TIERS) {
  BLOCKS[b].tool = 'pickaxe';
  BLOCKS[b].requiresTool = true;
  BLOCKS[b].minTier = tier;
}
for (const b of [
  Block.OakLog, Block.BirchLog, Block.SpruceLog, Block.OakPlanks,
  Block.BirchPlanks, Block.SprucePlanks,
  Block.CraftingTable, Block.Chest, Block.ShipHelm,
]) BLOCKS[b].tool = 'axe';
// All slabs (bottom + top) + stairs are wood: axe-mineable like planks.
for (let b = Block.OakSlab; b <= Block.SpruceSlabTop; b++) BLOCKS[b].tool = 'axe';
for (const b of [
  Block.Dirt, Block.Grass, Block.SnowyGrass, Block.Sand, Block.RedSand,
]) BLOCKS[b].tool = 'shovel';
for (const b of [Block.Terracotta, Block.Basalt]) BLOCKS[b].tool = 'pickaxe';

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
