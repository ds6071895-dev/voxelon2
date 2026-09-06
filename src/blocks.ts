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
  // Warfare layer (M14): turrets
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
  // Waypoint Totem (B4): fast travel across the 5000-block world. Place it,
  // RIGHT-CLICK to attune (max 4 per player), teleport to it from the map.
  WaypointTotem = 73,
  // Discovery biomes (Milestone C): jungle + cherry wood sets, swamp mud, and
  // the Wilds-only glowing crystal.
  JungleLog = 74,
  JungleLeaves = 75,
  JunglePlanks = 76,
  CherryLog = 77,
  CherryLeaves = 78,
  CherryPlanks = 79,
  Mud = 80,          // swamp ground — slows walking slightly
  CrystalBlock = 81, // emissive crystal spike (mineable -> Crystal Shard)
  // Dungeons (Milestone D): vault walls (iron-pick tier, very hard — fight
  // through the door, not the wall) + the per-player boss-room loot chest.
  VaultBrick = 82,
  VaultChest = 83,
  // Traps: a low slab of iron spikes that pricks anyone standing on it, and a
  // camouflaged blast plate that detonates when stepped on (even by its owner).
  SpikeTrap = 84,
  Landmine = 85,
  // Vault guard spawner: a caged dark heart at the centre of each guarded
  // vault room — guards pour out while it stands; break it to silence the room.
  MobSpawner = 86,
  // Lever-triggered traps: pulling a Lever flips every linked trap within
  // LEVER_RADIUS blocks (traps.ts). FallTrap = a solid floor hatch that swings
  // OPEN (non-solid — victims drop through) when triggered; WallTrap = a flat
  // floor plate whose block POPS UP into a solid wall. The ITEM is always the
  // off/closed/down variant, like wall torches and top slabs.
  Lever = 87,
  LeverOn = 88,
  FallTrap = 89,
  FallTrapOpen = 90,
  WallTrap = 91,
  WallTrapUp = 92,
  // Solid gold: vault-treasury decor, a compact way to bank ingots.
  GoldBlock = 93,
  // --- Trapping kit (the "you are NOT getting out of this" set) -------------
  // BearTrap: snaps shut and PINS you in place for a few seconds — you break
  // out by mashing jump, so it's escapable but never instant.
  BearTrap = 94,
  // Tar: a sticky black pool. Wading through it is slow and you can't jump out
  // of it — the classic way to hold raiders in a kill zone.
  Tar = 95,
  // BarbedWire: cheap, ugly, effective — walk through and you're slowed AND
  // bleeding. Stack it in front of a wall.
  BarbedWire = 96,
  // --- Defensive kit (what a flag base is made of) --------------------------
  // Barricade: fast to place, cheap, and a real pain to chew through.
  Barricade = 97,
  // ReinforcedStone: the wall you build around a flag — very slow to break.
  ReinforcedStone = 98,
  // Floodlight: throws bright light so night raids can't sneak the last 20m.
  Floodlight = 99,
  // Cinematic vault families. IDs are appended (the 100–182 numeric range is
  // occupied by non-block inventory items, so these continue after it).
  CarvedVaultBrick = 183,
  MossyVaultBrick = 184,
  EmberBrick = 185,
  PrismBrick = 186,
  GildedVaultBrick = 187,
  SoulLantern = 188,
  GlowFungus = 189,
  EmberBrazier = 190,
  PrismLamp = 191,
  GildedLamp = 192,
  // Bright-vault architecture set. Appended for save compatibility.
  LuminousLimestone = 203,
  PearlTile = 204,
  RuneGlass = 205,
  IvoryColumn = 206,
  SpectralMarble = 207,
  JadeMosaic = 208,
  FurnaceCeramic = 209,
  OpalBrick = 210,
  ClockworkGrate = 211,
  VaultMosaic = 212,
  // --- Warfare Command: aviation hardware (block-entities) ------------------
  // 213-215 are retired strategic-missile ids and are deliberately not reused.
  Helipad = 216,
  Barrier = 217,
  // Packed snow: the frozen barrens' own building block. Ice spikes used to be
  // stacked out of SnowyGrass, whose sides are DIRT — a spire read as a tower
  // of grass blocks someone had left standing. This is snow on every face.
  // (Ids skip the crowded 218-230 stretch, which the Item enum shares.)
  PackedSnow = 231,
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
  // Lifesteal (Milestone A): the Heart consumable + the Revival Beacon totem.
  Heart = 145,
  RevivalBeacon = 146,
  // Waypoint Totem (B4)
  WaypointTotemSide = 147,
  WaypointTotemTop = 148,
  // Discovery biomes (Milestone C)
  JungleLogSide = 149,
  JungleLogTop = 150,
  JungleLeaves = 151,
  JunglePlanks = 152,
  CherryLogSide = 153,
  CherryLogTop = 154,
  CherryLeaves = 155,
  CherryPlanks = 156,
  Mud = 157,
  CrystalBlock = 158,
  CrystalShard = 159,
  // New mobs (Milestone C)
  SpitterSkin = 160,
  SpitterFace = 161,
  SkitterSkin = 162,
  SkitterFace = 163,
  // Dungeons (Milestone D)
  VaultBrick = 164,
  VaultChestSide = 165,
  VaultChestTop = 166,
  BruteSkin = 167,
  BruteFace = 168,
  // Healing consumables
  BandageSprite = 169,
  MedkitSprite = 170,
  // Runes (armor socketables)
  RuneIron = 171,
  RuneSwift = 172,
  RuneFortune = 173,
  RuneFocus = 174,
  // Traps
  SpikeTrapTop = 175,
  SpikeTrapSide = 176,
  LandmineTop = 177,
  LandmineSide = 178,
  // Boat (item sprite)
  Boat = 179,
  // Vault guard spawner (cage block)
  MobSpawner = 180,
  // Vault compasses (item sprites, one per tier)
  VaultCompass1 = 181,
  VaultCompass2 = 182,
  VaultCompass3 = 183,
  // Early-game armor (wood + stone starter sets)
  ArmorHelmetWood = 184,
  ArmorChestWood = 185,
  ArmorLegsWood = 186,
  ArmorBootsWood = 187,
  ArmorHelmetStone = 188,
  ArmorChestStone = 189,
  ArmorLegsStone = 190,
  ArmorBootsStone = 191,
  // Lever-triggered traps
  Lever = 192,
  LeverOn = 193,
  FallTrap = 194,
  FallTrapOpen = 195,
  WallTrapTop = 196,
  WallTrapSide = 197,
  // Solid gold block (vault treasuries + ingot banking).
  GoldBlock = 198,
  // The Diamond Shovel: the top-tier digging tool (instant on soft ground).
  DiamondShovel = 199,
  // Traps + defenses (flag-war kit)
  BearTrap = 200,
  Tar = 201,
  BarbedWire = 202,
  Barricade = 203,
  ReinforcedStone = 204,
  FloodlightTop = 205,
  FloodlightSide = 206,
  CarvedVaultBrick = 207,
  MossyVaultBrick = 208,
  EmberBrick = 209,
  PrismBrick = 210,
  GildedVaultBrick = 211,
  SoulLantern = 212,
  GlowFungus = 213,
  EmberBrazier = 214,
  PrismLamp = 215,
  GildedLamp = 216,
  WardenSigil = 217,
  MireBloom = 218,
  EmberCore = 219,
  SeerPrism = 220,
  ArtificerGear = 221,
  LuminousLimestone = 222,
  PearlTile = 223,
  RuneGlass = 224,
  IvoryColumn = 225,
  SpectralMarble = 226,
  JadeMosaic = 227,
  FurnaceCeramic = 228,
  OpalBrick = 229,
  ClockworkGrate = 230,
  VaultMosaic = 231,
  GreaterRuneIron = 232,
  GreaterRuneSwift = 233,
  GreaterRuneFortune = 234,
  GreaterRuneFocus = 235,
  GreaterRuneOfPower = 236,
  // --- Warfare Command ---
  // 237-241 are retired strategic-missile tiles and are not reused.
  HelipadTop = 242,
  HelipadSide = 243,
  ReinforcedFrame = 244,
  GuidanceUnit = 245,
  // 246 is a retired strategic-missile sprite and is not reused.
  RotorAssembly = 247,
  FuelTank = 248,
  BombCasingSprite = 249,
  // 250-251 are retired strategic-missile sprites and are not reused.
  AerialBombSprite = 252,
  RepairKitSprite = 253,
  HelicopterKitSprite = 254,
}

export type ToolKind = 'pickaxe' | 'axe' | 'shovel' | 'sword';

export type BlockShape = 'cube' | 'cross' | 'torch' | 'slab' | 'stairs';
export type TintKind = 'grass' | 'foliage' | 'water' | null;

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
  // Single-variant slab-shaped blocks (traps) always sit in the lower half.
  const top = slabTopId(bottomId);
  if (top < 0) return bottomId;
  const useTop = ny > 0 ? false : ny < 0 ? true : hitFracY >= 0.5;
  return useTop ? top : bottomId;
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
    // Water takes a biome tint too: polar blue in the north, turquoise in the
    // tropics, murky green in swamps. One flat blue read as a placeholder.
    name: 'Water', hardness: -1, top: Tile.Water, tint: 'water',
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
  [Block.PackedSnow]: def({ name: 'Packed Snow', hardness: 0.5, top: Tile.Snow }),
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
  // Turret is a block-entity (like a machine): placed as a normal edit but
  // sabotaged (HP), not mined, and tracked server-side. Single block footprint.
  [Block.Turret]: def({
    name: 'Turret', hardness: 4.0,
    top: Tile.TurretTop, bottom: Tile.AutominerTop, side: Tile.TurretSide,
  }),

  // Solid gold: treasury decor + ingot banking. Softly glows; breaks fast
  // enough for a raid (fists work) but not instantly.
  [Block.GoldBlock]: def({ name: 'Gold Block', hardness: 2.0, emission: 5, top: Tile.GoldBlock }),

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
  // Waypoint Totem (B4): a glowing gold travel anchor. Mined normally (easily
  // raided — a totem in the Wilds is a commitment, not a fortress).
  [Block.WaypointTotem]: def({
    name: 'Waypoint Totem', hardness: 1.2, emission: 10,
    top: Tile.WaypointTotemTop, bottom: Tile.AutominerTop, side: Tile.WaypointTotemSide,
  }),

  // --- Discovery biomes (Milestone C) ---
  [Block.JungleLog]: def({
    name: 'Jungle Log', hardness: 2.0, top: Tile.JungleLogTop, side: Tile.JungleLogSide,
  }),
  [Block.JungleLeaves]: def({
    name: 'Jungle Leaves', hardness: 0.2, top: Tile.JungleLeaves,
    opaque: false, tint: 'foliage',
  }),
  [Block.JunglePlanks]: def({ name: 'Jungle Planks', hardness: 2.0, top: Tile.JunglePlanks }),
  [Block.CherryLog]: def({
    name: 'Cherry Log', hardness: 2.0, top: Tile.CherryLogTop, side: Tile.CherryLogSide,
  }),
  // Cherry leaves are PINK — painted directly, no biome foliage tint.
  [Block.CherryLeaves]: def({
    name: 'Cherry Leaves', hardness: 0.2, top: Tile.CherryLeaves, opaque: false,
  }),
  [Block.CherryPlanks]: def({ name: 'Cherry Planks', hardness: 2.0, top: Tile.CherryPlanks }),
  [Block.Mud]: def({ name: 'Mud', hardness: 0.5, top: Tile.Mud }),
  // Crystalfields spike: glows like a torch, drops Crystal Shards.
  [Block.CrystalBlock]: def({
    name: 'Crystal', hardness: 1.5, emission: 11, top: Tile.CrystalBlock,
    opaque: false,
  }),

  // --- Dungeons (Milestone D) ---
  // Vault walls: VERY hard (iron-pick tier, long break) so raiders fight
  // through the door, not the wall — but NOT unbreakable.
  [Block.VaultBrick]: def({ name: 'Vault Brick', hardness: 18, top: Tile.VaultBrick }),
  // The boss-room treasure chest is protected progression: defeat the boss and
  // right-click it. It cannot be broken or replaced.
  [Block.VaultChest]: def({
    name: 'Vault Chest', hardness: -1, emission: 8,
    top: Tile.VaultChestTop, bottom: Tile.VaultChestTop, side: Tile.VaultChestSide,
  }),
  [Block.CarvedVaultBrick]: def({
    name: 'Carved Vault Brick', hardness: 18, top: Tile.CarvedVaultBrick,
  }),
  [Block.MossyVaultBrick]: def({
    name: 'Mossy Vault Brick', hardness: 16, top: Tile.MossyVaultBrick,
  }),
  [Block.EmberBrick]: def({
    name: 'Ember Brick', hardness: 20, emission: 2, top: Tile.EmberBrick,
  }),
  [Block.PrismBrick]: def({
    name: 'Prism Brick', hardness: 18, emission: 4, top: Tile.PrismBrick,
  }),
  [Block.GildedVaultBrick]: def({
    name: 'Gilded Vault Brick', hardness: 20, emission: 2, top: Tile.GildedVaultBrick,
  }),
  [Block.SoulLantern]: def({
    name: 'Soul Lantern', hardness: 1.5, emission: 13, top: Tile.SoulLantern,
    opaque: false, occludes: false,
  }),
  [Block.GlowFungus]: def({
    name: 'Glow Fungus', hardness: 0.2, emission: 11, top: Tile.GlowFungus,
    solid: false, opaque: false, occludes: false, shape: 'cross',
  }),
  [Block.EmberBrazier]: def({
    name: 'Ember Brazier', hardness: 2, emission: 15, top: Tile.EmberBrazier,
    opaque: false, occludes: false,
  }),
  [Block.PrismLamp]: def({
    name: 'Prism Lamp', hardness: 1.5, emission: 14, top: Tile.PrismLamp,
    opaque: false, occludes: false,
  }),
  [Block.GildedLamp]: def({
    name: 'Gilded Lamp', hardness: 1.5, emission: 14, top: Tile.GildedLamp,
    opaque: false, occludes: false,
  }),
  [Block.LuminousLimestone]: def({
    name: 'Luminous Limestone', hardness: 18, emission: 3, top: Tile.LuminousLimestone,
  }),
  [Block.PearlTile]: def({ name: 'Pearl Tile', hardness: 18, emission: 2, top: Tile.PearlTile }),
  [Block.RuneGlass]: def({
    name: 'Rune Glass', hardness: 12, emission: 8, top: Tile.RuneGlass,
    opaque: false, occludes: false,
  }),
  [Block.IvoryColumn]: def({ name: 'Ivory Column', hardness: 20, top: Tile.IvoryColumn }),
  [Block.SpectralMarble]: def({
    name: 'Spectral Marble', hardness: 18, emission: 4, top: Tile.SpectralMarble,
  }),
  [Block.JadeMosaic]: def({ name: 'Jade Mosaic', hardness: 17, emission: 3, top: Tile.JadeMosaic }),
  [Block.FurnaceCeramic]: def({
    name: 'Furnace Ceramic', hardness: 20, emission: 3, top: Tile.FurnaceCeramic,
  }),
  [Block.OpalBrick]: def({ name: 'Opal Brick', hardness: 18, emission: 5, top: Tile.OpalBrick }),
  [Block.ClockworkGrate]: def({
    name: 'Clockwork Grate', hardness: 20, emission: 2, top: Tile.ClockworkGrate,
    opaque: false,
  }),
  [Block.VaultMosaic]: def({ name: 'Vault Mosaic', hardness: 18, emission: 2, top: Tile.VaultMosaic }),

  // --- Traps ---
  // Spike Trap: a low slab of iron spikes. Anyone STANDING on it takes steady
  // damage (players + mobs) — line moats, walls and vault doors with them.
  [Block.SpikeTrap]: def({
    name: 'Spike Trap', hardness: 1.2, shape: 'slab',
    top: Tile.SpikeTrapTop, bottom: Tile.SpikeTrapSide, side: Tile.SpikeTrapSide,
    opaque: false, occludes: false,
  }),
  // Landmine: a thin camouflaged blast plate. Arms the moment it's placed and
  // DETONATES when any player steps on it (even the owner — watch your feet).
  [Block.Landmine]: def({
    name: 'Landmine', hardness: 0.6, shape: 'slab',
    top: Tile.LandmineTop, bottom: Tile.LandmineSide, side: Tile.LandmineSide,
    opaque: false, occludes: false,
  }),

  // Bear Trap: a sprung steel jaw. Standing on it PINS you for TRAP_PIN_SECONDS
  // (main.ts) — mash jump to prise it open. Non-solid so you walk right into it.
  [Block.BearTrap]: def({
    name: 'Bear Trap', hardness: 1.0, shape: 'slab',
    top: Tile.BearTrap, bottom: Tile.BearTrap, side: Tile.BearTrap,
    opaque: false, occludes: false,
  }),
  // Tar: a sticky pool you wade through at a crawl and cannot jump out of.
  [Block.Tar]: def({
    name: 'Tar', hardness: 0.4, shape: 'slab', top: Tile.Tar,
    solid: false, opaque: false, occludes: false,
  }),
  // Barbed Wire: slows AND cuts anyone moving through it.
  [Block.BarbedWire]: def({
    name: 'Barbed Wire', hardness: 0.6, top: Tile.BarbedWire,
    solid: false, opaque: false, occludes: false, shape: 'cross',
  }),

  // --- Defenses (flag-base building blocks) ---
  // Barricade: cheap wooden wall that still takes real effort to break.
  [Block.Barricade]: def({
    name: 'Barricade', hardness: 6.0, top: Tile.Barricade,
  }),
  // Reinforced Stone: the serious wall. Iron-tier and very slow — a raid has to
  // commit to it (or go around, which is what the traps are for).
  [Block.ReinforcedStone]: def({
    name: 'Reinforced Stone', hardness: 22.0, top: Tile.ReinforcedStone,
  }),
  // Floodlight: max-brightness lamp; kills the "sneak in at night" strategy.
  [Block.Floodlight]: def({
    name: 'Floodlight', hardness: 1.2, emission: 15,
    top: Tile.FloodlightTop, bottom: Tile.FloodlightSide, side: Tile.FloodlightSide,
  }),

  // --- Lever-triggered traps ---
  // Lever: a small pull-handle (cross billboard, like a plant — pops if its
  // support breaks). Right-click flips it + every linked trap in LEVER_RADIUS.
  [Block.Lever]: def({
    name: 'Lever', hardness: 0.5, top: Tile.Lever,
    solid: false, opaque: false, occludes: false, shape: 'cross',
  }),
  [Block.LeverOn]: def({
    name: 'Lever', hardness: 0.5, top: Tile.LeverOn,
    solid: false, opaque: false, occludes: false, shape: 'cross',
  }),
  // Fall Trap: reads as an ordinary wooden hatch while closed (a solid cube);
  // a linked lever swings it OPEN — non-solid, and whoever stood on it drops.
  [Block.FallTrap]: def({ name: 'Fall Trap', hardness: 1.0, top: Tile.FallTrap }),
  [Block.FallTrapOpen]: def({
    name: 'Fall Trap', hardness: 1.0, top: Tile.FallTrapOpen,
    solid: false, opaque: false, occludes: false, shape: 'cross',
  }),
  // Wall Trap: a flat plate underfoot until a linked lever springs it UP into
  // a full solid block — box raiders in, seal doorways behind visitors.
  [Block.WallTrap]: def({
    name: 'Wall Trap', hardness: 1.2, shape: 'slab',
    top: Tile.WallTrapTop, bottom: Tile.WallTrapSide, side: Tile.WallTrapSide,
    opaque: false, occludes: false,
  }),
  [Block.WallTrapUp]: def({
    name: 'Wall Trap', hardness: 1.2,
    top: Tile.WallTrapTop, bottom: Tile.WallTrapSide, side: Tile.WallTrapSide,
  }),

  // Protected room anchor. Its finite wave goes dormant after combat, so the
  // player never needs to mine a progression object.
  [Block.MobSpawner]: def({
    name: 'Mob Spawner', hardness: -1, emission: 5,
    top: Tile.MobSpawner, opaque: false, occludes: false,
  }),

  // --- Building set (M15): per-wood planks + slabs + stairs ---
  [Block.BirchPlanks]: def({ name: 'Birch Planks', hardness: 2.0, top: Tile.BirchPlanks }),
  [Block.SprucePlanks]: def({ name: 'Spruce Planks', hardness: 2.0, top: Tile.SprucePlanks }),
  ...woodSet('Oak', Tile.Planks, Block.OakSlab, Block.OakStairsN, Block.OakSlabTop),
  ...woodSet('Birch', Tile.BirchPlanks, Block.BirchSlab, Block.BirchStairsN, Block.BirchSlabTop),
  ...woodSet('Spruce', Tile.SprucePlanks, Block.SpruceSlab, Block.SpruceStairsN, Block.SpruceSlabTop),

  // --- Warfare Command (strategic hardware) ---------------------------------
  // The Helipad is a block-entity: placed as a normal edit and taken down by
  // SHOOTING it (HP), never by mining. The hardness value only matters for the
  // visual break animation.
  // The Helipad is a flat, walkable landing plate — a slab so a helicopter can
  // sit on it and a pilot can stand next to it without jumping.
  [Block.Helipad]: def({
    name: 'Helipad', hardness: 3.5, emission: 6, shape: 'slab',
    solid: true, opaque: false, occludes: false,
    top: Tile.HelipadTop, side: Tile.HelipadSide,
  }),
  [Block.Barrier]: def({
    name: 'Barrier', hardness: -1,
    solid: true, opaque: false, occludes: false,
    top: Tile.Glass,
  }),
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
  [Block.Turret, 1], // metal war machines need a stone+ pick
  [Block.Helipad, 1],
  [Block.Core, 1], // the claim Core is pickaxe-mineable (owner-only, server-gated)
  [Block.VaultBrick, 2], [Block.VaultChest, 2], // dungeon walls need an iron pick
  [Block.CarvedVaultBrick, 2], [Block.MossyVaultBrick, 2],
  [Block.LuminousLimestone, 2], [Block.PearlTile, 2], [Block.RuneGlass, 2],
  [Block.IvoryColumn, 2], [Block.SpectralMarble, 2], [Block.JadeMosaic, 2],
  [Block.FurnaceCeramic, 2], [Block.OpalBrick, 2], [Block.ClockworkGrate, 2],
  [Block.VaultMosaic, 2],
  [Block.EmberBrick, 2], [Block.PrismBrick, 2], [Block.GildedVaultBrick, 2],
  [Block.SoulLantern, 1], [Block.EmberBrazier, 1],
  [Block.PrismLamp, 1], [Block.GildedLamp, 1],
];
for (const [b, tier] of PICKAXE_TIERS) {
  BLOCKS[b].tool = 'pickaxe';
  BLOCKS[b].requiresTool = true;
  BLOCKS[b].minTier = tier;
}
for (const b of [
  Block.OakLog, Block.BirchLog, Block.SpruceLog, Block.OakPlanks,
  Block.BirchPlanks, Block.SprucePlanks,
  Block.CraftingTable, Block.Chest,
]) BLOCKS[b].tool = 'axe';
// All slabs (bottom + top) + stairs are wood: axe-mineable like planks.
for (let b = Block.OakSlab; b <= Block.SpruceSlabTop; b++) BLOCKS[b].tool = 'axe';
for (const b of [
  Block.Dirt, Block.Grass, Block.SnowyGrass, Block.PackedSnow,
  Block.Sand, Block.RedSand,
]) BLOCKS[b].tool = 'shovel';
for (const b of [Block.Terracotta, Block.Basalt]) BLOCKS[b].tool = 'pickaxe';
// Defenses: Reinforced Stone needs an IRON pick (a wooden-tool raider simply
// cannot get through a proper flag wall); Barricade is axe work.
BLOCKS[Block.ReinforcedStone].tool = 'pickaxe';
BLOCKS[Block.ReinforcedStone].requiresTool = true;
BLOCKS[Block.ReinforcedStone].minTier = 2;
BLOCKS[Block.Barricade].tool = 'axe';

/**
 * Block ids that once existed and no longer do — the retired strategic-missile
 * hardware. A world saved while a silo or battery stood in it still names these
 * ids, so every load path maps them to Air rather than handing the mesher a
 * block with no definition.
 */
const RETIRED_BLOCKS = new Set<number>([213, 214, 215]);

/** A saved block id, migrated: retired hardware becomes Air, everything else
 *  passes through unchanged. */
export function migrateBlockId(id: number): number {
  return RETIRED_BLOCKS.has(id) ? Block.Air : id;
}

export function isSolid(id: number): boolean {
  return id !== Block.Air && (BLOCKS[id]?.solid ?? false);
}
export function isVaultMasonry(id: number): boolean {
  return id === Block.VaultBrick || id === Block.CarvedVaultBrick ||
    id === Block.MossyVaultBrick || id === Block.EmberBrick ||
    id === Block.PrismBrick || id === Block.GildedVaultBrick ||
    id === Block.LuminousLimestone || id === Block.PearlTile ||
    id === Block.RuneGlass || id === Block.IvoryColumn ||
    id === Block.SpectralMarble || id === Block.JadeMosaic ||
    id === Block.FurnaceCeramic || id === Block.OpalBrick ||
    id === Block.ClockworkGrate || id === Block.VaultMosaic;
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
