// Item registry: the loadout items Worlds hands out. Placeable blocks share
// their Block id; pure items start at 100.

import { Block, BLOCKS, BlockInfo, Tile, ToolKind } from './blocks';

export const enum Item {
  IronAxe = 119,
  Bullet = 140,
  BurstRifle = 148,
  /** The Bounce Pad gadget. */
  JumpBoost = 159,
  Medkit = 164,
  BridgeBow = 249,
  BridgeArrow = 250,
  // Rat and Seek. Ids above every block id.
  RatCatcher = 300,
  SeekerCompass = 301,
  ScentPulse = 302,
  Flashlight = 303,
  Mousetrap = 304,
  CheeseBait = 305,
  SqueakTaunt = 306,
  Scamper = 307,
  CageRattle = 308,
  EscapeCard = 309,
  ClassPicker = 310,
  WhiskerSense = 311,
  CheeseMagnet = 312,
  DecoyRat = 313,
  Disarm = 314,
  Cheese = 315,
  ClassScout = 316,
  ClassThief = 317,
  ClassTrickster = 318,
  ClassTinkerer = 319,
  SeekerPicker = 320,
}

interface ToolInfo {
  type: ToolKind;
  /** Harvest tier: wood 0, stone 1, iron 2. */
  tier: number;
  /** Mining speed multiplier on effective blocks. */
  speed: number;
}

/** A healing consumable (right-click): applies an accelerated-regen buff that
 *  bypasses the post-damage regen delay, so you can patch up mid-fight. */
interface HealInfo {
  /** Seconds the fast-regen buff lasts. */
  duration: number;
  /** Seconds between +1 HP while the buff is active. */
  interval: number;
}

export interface GunInfo {
  /** Damage per projectile hit. */
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
  /** Rounds auto-fired in a quick burst per trigger pull. Default 1. */
  burst?: number;
  /** Aim-down-sights magnification when right-click is held (FOV divides by this). */
  zoom?: number;
}

interface ItemInfo {
  name: string;
  kind: 'block' | 'item';
  /** Block placed by this item (block items only). */
  block?: Block;
  /** Sprite tile for pure items. */
  sprite?: Tile;
  maxStack: number;
  tool?: ToolInfo;
  gun?: GunInfo;
  heal?: HealInfo;
}

export interface ItemStack {
  id: number;
  count: number;
  /** Rounds currently in a gun's magazine (guns only; undefined = full). */
  loaded?: number;
}

function blockItem(block: Block): ItemInfo {
  return { name: BLOCKS[block].name, kind: 'block', block, maxStack: 64 };
}

export const ITEMS: Record<number, ItemInfo> = {
  [Block.OakPlanks]: blockItem(Block.OakPlanks),
  [Block.TeamWoolA]: blockItem(Block.TeamWoolA),
  [Block.TeamWoolB]: blockItem(Block.TeamWoolB),
  [Item.IronAxe]: {
    name: 'Iron Axe', kind: 'item', sprite: Tile.IronAxe, maxStack: 1,
    tool: { type: 'axe', tier: 2, speed: 6 },
  },
  // Burst Rifle — disciplined 3-round bursts; rewards aim with a quick clustered
  // hit then a beat of downtime. A medium marksman zoom.
  [Item.BurstRifle]: {
    name: 'Burst Rifle', kind: 'item', sprite: Tile.BurstRifle, maxStack: 1,
    gun: { damage: 5, ammo: Item.Bullet, mag: 24, cooldown: 0.5, auto: false, speed: 115, range: 58,
      burst: 3, zoom: 1.8 },
  },
  [Item.Bullet]: { name: 'Bullet', kind: 'item', sprite: Tile.Bullet, maxStack: 64 },
  // Behaviour + cooldown live in gadgets.ts.
  [Item.JumpBoost]: { name: 'Bounce Pad', kind: 'item', sprite: Tile.JumpBoost, maxStack: 8 },
  // A strong, near-full heal: right-click for a burst of fast regeneration.
  [Item.Medkit]: {
    name: 'Medkit', kind: 'item', sprite: Tile.MedkitSprite, maxStack: 16,
    heal: { duration: 8, interval: 0.3 },
  },
  /** The Bridge's bow. Deliberately NOT a `gun`: guns fire hitscan rounds the
   *  client reports, and this fires a server-simulated arrow with an arc. The
   *  registry entry exists so it renders, names and stacks like an item. */
  [Item.BridgeBow]: { name: 'Bridge Bow', kind: 'item', sprite: Tile.BridgeBow, maxStack: 1 },
  /** Ammunition. The Bridge hands out an unlimited stack, so the count on the
   *  hotbar is decoration — the server never reads it. */
  [Item.BridgeArrow]: { name: 'Arrow', kind: 'item', sprite: Tile.BridgeArrow, maxStack: 64 },
  // Rat and Seek: the seeker's kit, the rat's kit and the four class badges.
  // Every behaviour lives on the server (ratseek.ts); these only render.
  [Item.RatCatcher]: { name: 'Rat Catcher', kind: 'item', sprite: Tile.RatCatcher, maxStack: 1 },
  [Item.SeekerCompass]: { name: "Seeker's Compass", kind: 'item', sprite: Tile.SeekerCompass, maxStack: 1 },
  [Item.ScentPulse]: { name: 'Scent Pulse', kind: 'item', sprite: Tile.ScentPulse, maxStack: 1 },
  [Item.Flashlight]: { name: 'Flashlight', kind: 'item', sprite: Tile.Flashlight, maxStack: 1 },
  [Item.Mousetrap]: { name: 'Snap Mousetrap', kind: 'item', sprite: Tile.MousetrapItem, maxStack: 3 },
  [Item.CheeseBait]: { name: 'Cheese Bait', kind: 'item', sprite: Tile.CheeseBait, maxStack: 2 },
  [Item.SqueakTaunt]: { name: 'Squeak Taunt', kind: 'item', sprite: Tile.SqueakTaunt, maxStack: 1 },
  [Item.Scamper]: { name: 'Scamper', kind: 'item', sprite: Tile.Scamper, maxStack: 1 },
  [Item.CageRattle]: { name: 'Rattle the Cage', kind: 'item', sprite: Tile.CageRattle, maxStack: 1 },
  [Item.EscapeCard]: { name: 'Get Out of Jail Free', kind: 'item', sprite: Tile.EscapeCard, maxStack: 1 },
  [Item.ClassPicker]: { name: 'Choose Your Class', kind: 'item', sprite: Tile.ClassPicker, maxStack: 1 },
  [Item.WhiskerSense]: { name: 'Whisker Sense (Scout)', kind: 'item', sprite: Tile.WhiskerSense, maxStack: 1 },
  [Item.CheeseMagnet]: { name: 'Cheese Magnet (Thief)', kind: 'item', sprite: Tile.CheeseMagnet, maxStack: 1 },
  [Item.DecoyRat]: { name: 'Decoy Rat (Trickster)', kind: 'item', sprite: Tile.DecoyRat, maxStack: 1 },
  [Item.Disarm]: { name: 'Disarm (Tinkerer)', kind: 'item', sprite: Tile.Disarm, maxStack: 1 },
  [Item.Cheese]: { name: 'Stolen Cheese', kind: 'item', sprite: Tile.Cheese, maxStack: 64 },
  [Item.ClassScout]: { name: 'Scout', kind: 'item', sprite: Tile.ClassScout, maxStack: 1 },
  [Item.ClassThief]: { name: 'Thief', kind: 'item', sprite: Tile.ClassThief, maxStack: 1 },
  [Item.ClassTrickster]: { name: 'Trickster', kind: 'item', sprite: Tile.ClassTrickster, maxStack: 1 },
  [Item.ClassTinkerer]: { name: 'Tinkerer', kind: 'item', sprite: Tile.ClassTinkerer, maxStack: 1 },
  [Item.SeekerPicker]: { name: 'Who Seeks?', kind: 'item', sprite: Tile.SeekerPicker, maxStack: 1 },
};

/**
 * Vanilla mining time: effective tools divide `hardness * 1.5` by their speed;
 * blocks that require a tool you can't harvest with take `hardness * 5`.
 */
export function breakTime(info: BlockInfo, held: ItemStack | null): number {
  const tool = held ? ITEMS[held.id]?.tool : undefined;
  const effective = !!tool && tool.type === info.tool;
  const harvest =
    !info.requiresTool || (effective && tool!.tier >= info.minTier);
  if (info.hardness <= 0) return 0;
  const speed = effective && harvest ? tool!.speed : 1;
  return harvest ? (info.hardness * 1.5) / speed : info.hardness * 5;
}
