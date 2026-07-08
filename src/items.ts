// Item registry. Placeable blocks share their Block id; pure items start at
// 100. Includes the vanilla drop table used when blocks break.

import {
  Block, BLOCKS, BlockInfo, isTopSlab, slabBottomId, stairsBaseOf, Tile, ToolKind,
} from './blocks';

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
  // Armor (helmet/chestplate/leggings/boots × iron/diamond/titanium).
  TitaniumIngot = 124,
  IronHelmet = 125,
  IronChestplate = 126,
  IronLeggings = 127,
  IronBoots = 128,
  DiamondHelmet = 129,
  DiamondChestplate = 130,
  DiamondLeggings = 131,
  DiamondBoots = 132,
  TitaniumHelmet = 133,
  TitaniumChestplate = 134,
  TitaniumLeggings = 135,
  TitaniumBoots = 136,
  // Guns + ammo.
  Pistol = 137,
  Rifle = 138,
  RocketLauncher = 139,
  Bullet = 140,
  Rocket = 141,
  // Automation layer (M13)
  CobaltIngot = 142,
  OilBarrel = 143,
  // Warfare layer (M14)
  Cannonball = 144, // ammo for turrets (craft: iron + coal)
  // Arcade guns (distinct roles): close-range, spray, pinpoint, burst.
  Shotgun = 145,
  SMG = 146,
  Sniper = 147,
  BurstRifle = 148,
  // Glider: an early-game chestplate-slot item for fast descent travel.
  Glider = 149,
  // Gadgets (Phase 8): nine war toys.
  Grenade = 150,
  C4 = 151,
  GrapplingHook = 152,
  DeployCover = 153,
  SentryKit = 154,
  SmokeGrenade = 155,
  WarHorn = 156,
  OilBomb = 157,
  SpyDisguise = 158,
  JumpBoost = 159,
  // Lifesteal (Milestone A): a bottled max-health heart + the teammate-revival
  // totem. Hearts are lootable/tradeable/raidable like any other item.
  Heart = 160,
  RevivalBeacon = 161,
  // Crystal Shard (Milestone C): mined from Crystalfields spikes (Wilds-only).
  CrystalShard = 162,
  // Healing consumables: right-click to trigger a burst of accelerated regen.
  Bandage = 163,
  Medkit = 164,
  // Runes: exploration-only armor socketables (never craftable — loot them).
  RuneOfIron = 165,
  RuneOfSwiftness = 166,
  RuneOfFortune = 167,
  RuneOfFocus = 168,
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

export type ArmorSlot = 'helmet' | 'chestplate' | 'leggings' | 'boots';
/** Equip-slot index per armor slot (matches Inventory's ARMOR region order). */
export const ARMOR_SLOT_INDEX: Record<ArmorSlot, number> = {
  helmet: 0, chestplate: 1, leggings: 2, boots: 3,
};

export interface ArmorInfo {
  slot: ArmorSlot;
  /** Base defense points (vanilla-ish; each point blocks 4% of damage). */
  points: number;
  /** Material tier (iron 0, diamond 1, titanium 2) for display/sorting. */
  tier: number;
  durability: number;
}

/** A glider equips into the chestplate slot (like an elytra). It has no defense;
 *  `durability` is the number of seconds of gliding before it wears out. */
export interface GliderInfo {
  durability: number;
}

/** A healing consumable (right-click): applies an accelerated-regen buff that
 *  bypasses the post-damage regen delay, so you can patch up mid-fight. */
export interface HealInfo {
  /** Seconds the fast-regen buff lasts. */
  duration: number;
  /** Seconds between +1 HP while the buff is active (normal regen is 2s). */
  interval: number;
}

export interface GunInfo {
  /** Damage per projectile hit (mobs + PvP). */
  damage: number;
  /** Item id consumed per shot (drawn from the magazine, refilled on reload). */
  ammo: number;
  /** Magazine capacity (rounds before a reload is needed). */
  mag: number;
  /** Seconds between shots. */
  cooldown: number;
  /** Held-button auto-fire (true) vs one shot per click (false). */
  auto: boolean;
  /** Projectile speed (blocks/s). */
  speed: number;
  /** Max projectile travel (blocks) before it despawns. */
  range: number;
  /** Rockets fly slower and detonate on impact instead of a point hit. */
  rocket?: boolean;
  /** Projectiles launched per trigger pull (shotgun spread). Default 1. */
  pellets?: number;
  /** Half-angle (radians) of random cone spread applied to each projectile. */
  spread?: number;
  /** Rounds auto-fired in a quick burst per trigger pull (burst rifle). Default 1. */
  burst?: number;
  /** Aim-down-sights magnification when right-click is held (FOV divides by this).
   *  Bigger = more zoom (sniper scopes most). Omitted/1 = no zoom. */
  zoom?: number;
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
  armor?: ArmorInfo;
  gun?: GunInfo;
  glider?: GliderInfo;
  heal?: HealInfo;
}

export interface ItemStack {
  id: number;
  count: number;
  /** Accumulated tool damage (tools only). */
  damage?: number;
  /** Accumulated armor XP (armor only); drives the per-piece level. */
  xp?: number;
  /** Rounds currently in a gun's magazine (guns only; undefined = full). */
  loaded?: number;
  /** Socketed rune item id (worn armor only; one rune per piece). */
  rune?: number;
}

// Per-piece armor leveling: wearing a piece through hits levels it up, adding
// a small defense bonus on top of its base points (client-trusted progression).
export const ARMOR_MAX_LEVEL = 10;
const ARMOR_XP_PER_LEVEL = 60;
const ARMOR_POINTS_PER_LEVEL = 0.3;

export function armorLevel(stack: ItemStack): number {
  return Math.min(ARMOR_MAX_LEVEL, Math.floor(Math.max(0, stack.xp ?? 0) / ARMOR_XP_PER_LEVEL));
}

/** Effective defense points for a worn piece (base + level bonus). */
export function armorPointsOf(stack: ItemStack): number {
  if (ITEMS[stack.id]?.glider) return 0; // a glider sits in the chest slot but is not armor
  const a = ITEMS[stack.id]?.armor;
  if (!a) return 0;
  return a.points + armorLevel(stack) * ARMOR_POINTS_PER_LEVEL;
}

function blockItem(block: Block): ItemInfo {
  return { name: BLOCKS[block].name, kind: 'block', block, maxStack: 64 };
}
function pureItem(name: string, sprite: Tile): ItemInfo {
  return { name, kind: 'item', sprite, maxStack: 64 };
}
/** A gadget item (Phase 8): a pure item with a gadget-specific stack ceiling. */
function gadgetItem(name: string, sprite: Tile, maxStack: number): ItemInfo {
  return { name, kind: 'item', sprite, maxStack };
}
function armorItem(name: string, sprite: Tile, armor: ArmorInfo): ItemInfo {
  return { name, kind: 'item', sprite, maxStack: 1, armor };
}
function gunItem(name: string, sprite: Tile, gun: GunInfo): ItemInfo {
  return { name, kind: 'item', sprite, maxStack: 1, gun };
}
function healItem(name: string, sprite: Tile, heal: HealInfo): ItemInfo {
  return { name, kind: 'item', sprite, maxStack: 16, heal };
}
function gliderItem(name: string, sprite: Tile, glider: GliderInfo): ItemInfo {
  // A 0-defense "chestplate" so the existing armor-slot equip/swap plumbing
  // (inventory + UI) handles it with no special cases; `glider` drives flight.
  return {
    name, kind: 'item', sprite, maxStack: 1, glider,
    armor: { slot: 'chestplate', points: 0, tier: 0, durability: glider.durability },
  };
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
  [Block.Chest]: blockItem(Block.Chest),
  [Block.TitaniumOre]: blockItem(Block.TitaniumOre),

  // Automation (M13): machine blocks + the new resources.
  [Block.CobaltOre]: blockItem(Block.CobaltOre),
  [Block.OilShale]: blockItem(Block.OilShale),
  [Block.Autominer]: blockItem(Block.Autominer),
  [Block.OilDerrick]: blockItem(Block.OilDerrick),
  [Item.CobaltIngot]: pureItem('Cobalt Ingot', Tile.CobaltIngot),
  [Item.OilBarrel]: pureItem('Oil Barrel', Tile.OilBarrel),

  // Warfare (M14): turret block + cannonball ammo.
  [Block.Turret]: blockItem(Block.Turret),
  [Item.Cannonball]: pureItem('Cannonball', Tile.Cannonball),
  // Personal respawn point block (right-click to set spawn).
  [Block.RespawnBeacon]: blockItem(Block.RespawnBeacon),
  // Waypoint Totem (B4): fast-travel anchor (right-click to attune).
  [Block.WaypointTotem]: blockItem(Block.WaypointTotem),
  // Discovery biomes (Milestone C).
  [Block.JungleLog]: blockItem(Block.JungleLog),
  [Block.JungleLeaves]: blockItem(Block.JungleLeaves),
  [Block.JunglePlanks]: blockItem(Block.JunglePlanks),
  [Block.CherryLog]: blockItem(Block.CherryLog),
  [Block.CherryLeaves]: blockItem(Block.CherryLeaves),
  [Block.CherryPlanks]: blockItem(Block.CherryPlanks),
  [Block.Mud]: blockItem(Block.Mud),
  [Block.CrystalBlock]: blockItem(Block.CrystalBlock),
  // Dungeons (Milestone D): mined vault walls are a building trophy. The
  // VaultChest is deliberately NOT an item (breaking one drops nothing).
  [Block.VaultBrick]: blockItem(Block.VaultBrick),
  // Terrain (M21): mesa + ashlands materials (Lava is a liquid, like Water).
  [Block.RedSand]: blockItem(Block.RedSand),
  [Block.Terracotta]: blockItem(Block.Terracotta),
  [Block.Basalt]: blockItem(Block.Basalt),

  // Building set (M15): per-wood planks + slabs + stairs (only the N-facing
  // stair id is an item; placement orients it, like wall torches).
  [Block.BirchPlanks]: blockItem(Block.BirchPlanks),
  [Block.SprucePlanks]: blockItem(Block.SprucePlanks),
  [Block.OakSlab]: blockItem(Block.OakSlab),
  [Block.BirchSlab]: blockItem(Block.BirchSlab),
  [Block.SpruceSlab]: blockItem(Block.SpruceSlab),
  [Block.OakStairsN]: blockItem(Block.OakStairsN),
  [Block.BirchStairsN]: blockItem(Block.BirchStairsN),
  [Block.SpruceStairsN]: blockItem(Block.SpruceStairsN),

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
  [Item.TitaniumIngot]: pureItem('Titanium Ingot', Tile.TitaniumIngot),

  // Armor — base points roughly track vanilla (iron 15, diamond ~17, titanium
  // ~21 total), with per-piece XP leveling adding up to +3 each over time.
  [Item.IronHelmet]: armorItem('Iron Helmet', Tile.ArmorHelmetIron,
    { slot: 'helmet', points: 2, tier: 0, durability: 165 }),
  [Item.IronChestplate]: armorItem('Iron Chestplate', Tile.ArmorChestIron,
    { slot: 'chestplate', points: 6, tier: 0, durability: 240 }),
  [Item.IronLeggings]: armorItem('Iron Leggings', Tile.ArmorLegsIron,
    { slot: 'leggings', points: 5, tier: 0, durability: 225 }),
  [Item.IronBoots]: armorItem('Iron Boots', Tile.ArmorBootsIron,
    { slot: 'boots', points: 2, tier: 0, durability: 195 }),
  [Item.DiamondHelmet]: armorItem('Diamond Helmet', Tile.ArmorHelmetDiamond,
    { slot: 'helmet', points: 3, tier: 1, durability: 363 }),
  [Item.DiamondChestplate]: armorItem('Diamond Chestplate', Tile.ArmorChestDiamond,
    { slot: 'chestplate', points: 7, tier: 1, durability: 528 }),
  [Item.DiamondLeggings]: armorItem('Diamond Leggings', Tile.ArmorLegsDiamond,
    { slot: 'leggings', points: 6, tier: 1, durability: 495 }),
  [Item.DiamondBoots]: armorItem('Diamond Boots', Tile.ArmorBootsDiamond,
    { slot: 'boots', points: 3, tier: 1, durability: 429 }),
  [Item.TitaniumHelmet]: armorItem('Titanium Helmet', Tile.ArmorHelmetTitanium,
    { slot: 'helmet', points: 3, tier: 2, durability: 555 }),
  [Item.TitaniumChestplate]: armorItem('Titanium Chestplate', Tile.ArmorChestTitanium,
    { slot: 'chestplate', points: 8, tier: 2, durability: 800 }),
  [Item.TitaniumLeggings]: armorItem('Titanium Leggings', Tile.ArmorLegsTitanium,
    { slot: 'leggings', points: 6, tier: 2, durability: 750 }),
  [Item.TitaniumBoots]: armorItem('Titanium Boots', Tile.ArmorBootsTitanium,
    { slot: 'boots', points: 3, tier: 2, durability: 650 }),

  // Guns — pistol (semi), rifle (auto), rocket launcher (explosive). `zoom` is
  // the aim-down-sights magnification (hold right-click); scoped guns zoom more.
  [Item.Pistol]: gunItem('Pistol', Tile.Pistol,
    { damage: 5, ammo: Item.Bullet, mag: 12, cooldown: 0.32, auto: false, speed: 80, range: 48,
      zoom: 1.15 }),
  [Item.Rifle]: gunItem('Rifle', Tile.Rifle,
    { damage: 4, ammo: Item.Bullet, mag: 30, cooldown: 0.11, auto: true, speed: 100, range: 64,
      zoom: 1.35 }),
  [Item.RocketLauncher]: gunItem('Rocket Launcher', Tile.RocketLauncher,
    { damage: 18, ammo: Item.Rocket, mag: 1, cooldown: 1.1, auto: false, speed: 28, range: 80,
      rocket: true, zoom: 1.25 }),
  // Shotgun — point-blank bruiser: a wide pellet spray that shreds up close and
  // fizzles at range. Slow pump, small mag. No scope (it's a hip-fire brawler).
  [Item.Shotgun]: gunItem('Shotgun', Tile.Shotgun,
    { damage: 3, ammo: Item.Bullet, mag: 6, cooldown: 0.7, auto: false, speed: 70, range: 22,
      pellets: 7, spread: 0.13 }),
  // SMG — spray-and-pray: blistering auto fire, low per-hit damage, big mag,
  // a touch of bloom and short reach. A small ADS zoom to tighten sprays.
  // (0.08s cooldown keeps its DPS just ABOVE the rifle's but only up close.)
  [Item.SMG]: gunItem('SMG', Tile.SMG,
    { damage: 3, ammo: Item.Bullet, mag: 35, cooldown: 0.08, auto: true, speed: 95, range: 38,
      spread: 0.035, zoom: 1.2 }),
  // Sniper — pinpoint hitscan-feel: huge damage, dead-accurate, long reach, but
  // a long recovery between shots and a tiny mag. A big scope zoom. 18 damage =
  // NEVER a one-shot body kill on a full-health player (20 HP) — hurts, not
  // deletes.
  [Item.Sniper]: gunItem('Sniper', Tile.Sniper,
    { damage: 18, ammo: Item.Bullet, mag: 5, cooldown: 1.35, auto: false, speed: 150, range: 80,
      zoom: 4 }),
  // Burst Rifle — disciplined 3-round bursts; rewards aim with a quick clustered
  // hit then a beat of downtime. A medium marksman zoom.
  [Item.BurstRifle]: gunItem('Burst Rifle', Tile.BurstRifle,
    { damage: 5, ammo: Item.Bullet, mag: 24, cooldown: 0.5, auto: false, speed: 115, range: 58,
      burst: 3, zoom: 1.8 }),
  [Item.Bullet]: pureItem('Bullet', Tile.Bullet),
  [Item.Rocket]: pureItem('Rocket', Tile.Rocket),

  // Glider — early-game wings worn in the chestplate slot. Jump in mid-air to
  // deploy (it slows your fall and rockets you forward); easy to craft, easy to
  // break (wears out with use).
  [Item.Glider]: gliderItem('Glider', Tile.Glider, { durability: 22 }),
  // Gadgets (Phase 8): pure items; behaviour + cooldown/stack live in gadgets.ts.
  [Item.Grenade]: gadgetItem('Frag Grenade', Tile.Grenade, 16),
  [Item.C4]: gadgetItem('C4 Charge', Tile.C4, 8),
  [Item.GrapplingHook]: gadgetItem('Grappling Hook', Tile.GrapplingHook, 1),
  [Item.DeployCover]: gadgetItem('Deployable Cover', Tile.DeployCover, 8),
  [Item.SentryKit]: gadgetItem('Sentry Kit', Tile.SentryKit, 4),
  [Item.SmokeGrenade]: gadgetItem('Smoke Grenade', Tile.SmokeGrenade, 16),
  [Item.WarHorn]: gadgetItem('War Horn', Tile.WarHorn, 1),
  [Item.OilBomb]: gadgetItem('Oil Bomb', Tile.OilBomb, 8),
  [Item.SpyDisguise]: gadgetItem('Spy Disguise', Tile.SpyDisguise, 1),
  [Item.JumpBoost]: gadgetItem('Jump Boost', Tile.JumpBoost, 8),

  // Lifesteal (Milestone A). Hearts stack small (they're precious loot);
  // the Revival Beacon is a one-shot totem.
  [Item.Heart]: gadgetItem('Heart', Tile.Heart, 16),
  [Item.CrystalShard]: pureItem('Crystal Shard', Tile.CrystalShard),
  [Item.RevivalBeacon]: gadgetItem('Revival Beacon', Tile.RevivalBeacon, 1),

  // Healing consumables: right-click for a burst of fast regeneration.
  // Bandage = quick minor patch; Medkit = a strong, near-full heal.
  [Item.Bandage]: healItem('Bandage', Tile.BandageSprite, { duration: 5, interval: 0.6 }),
  [Item.Medkit]: healItem('Medkit', Tile.MedkitSprite, { duration: 8, interval: 0.3 }),

  // Runes (loot-only): right-click to socket into a worn armor piece.
  [Item.RuneOfIron]: pureItem('Rune of Iron', Tile.RuneIron),
  [Item.RuneOfSwiftness]: pureItem('Rune of Swiftness', Tile.RuneSwift),
  [Item.RuneOfFortune]: pureItem('Rune of Fortune', Tile.RuneFortune),
  [Item.RuneOfFocus]: pureItem('Rune of Focus', Tile.RuneFocus),
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
    case Block.JungleLeaves:
      if (rng < 0.02) return { id: Item.Stick, count: 1 };
      return null;
    case Block.CherryLeaves:
      // Petals are pretty but yield little.
      if (rng < 0.015) return { id: Item.Stick, count: 1 };
      return null;
    case Block.CrystalBlock:
      return { id: Item.CrystalShard, count: 1 + (rng < 0.35 ? 1 : 0) };
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
    default: {
      // Stairs drop the (N-facing) stairs item regardless of placed orientation.
      const sb = stairsBaseOf(block);
      if (sb >= 0) return { id: sb, count: 1 };
      // Top slabs aren't a separate item: they drop the bottom slab (item form).
      if (isTopSlab(block)) return { id: slabBottomId(block), count: 1 };
      // Everything else drops itself if it is registered as an item.
      return ITEMS[block] ? { id: block, count: 1 } : null;
    }
  }
}
