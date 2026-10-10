// Shared wire contract. No renderer, server or Node dependencies.
import { Block } from './blocks';
import { Item, type ItemStack } from './items';

/** 0 Red, 1 Blue, 2 Green, 3 Yellow. */
export type BwTeam = number;
export type BwResource = 'iron' | 'gold' | 'diamond' | 'emerald';
/** Only the team chest holds a resource record; players carry real items. */
export type BwWallet = Record<BwResource, number>;
export type BwPhase = 'loading' | 'countdown' | 'playing' | 'suddenDeath' | 'results';
export interface BwPos { x: number; y: number; z: number }
export type BwAction =
  | { kind: 'buy'; sku: string; request: number }
  | { kind: 'place'; x: number; y: number; z: number; slot: number; prediction?: number }
  /** Re-send every 100-200ms while held; the server owns elapsed mining time. */
  | { kind: 'break'; x: number; y: number; z: number; slot: number }
  | { kind: 'stopBreak' }
  | { kind: 'melee'; target: number; slot: number }
  | { kind: 'shoot'; dx: number; dy: number; dz: number; power: number; slot: number }
  | { kind: 'use'; slot: number; dx: number; dy: number; dz: number }
  | { kind: 'bank'; resource: BwResource; amount: number; direction: 'deposit' | 'withdraw' }
  | { kind: 'select'; slot: number };
export interface BwUpgrades { sharpness: number; protection: number; forge: number; haste: number; heal: number; trap: number }
export interface BwTools { pickaxe: number; axe: number; shears: number }
export interface BwPlayerView {
  id: number; name: string; team: BwTeam; bot: boolean;
  alive: boolean; eliminated: boolean; health: number; respawnIn: number;
  kills: number; finals: number; deaths: number; beds: number;
  armor: number; sword: number; tools: BwTools; connected: boolean;
}
interface BwTeamView { team: BwTeam; bed: boolean; alive: number; upgrades: BwUpgrades; chest: BwWallet }
export interface BwProjectileView extends BwPos { id: number; kind: 'arrow' | 'pearl' | 'tnt'; owner: number; fuse?: number }
/** A world item. Both sides step it with `stepDrop`, so only spawns, merges and
 *  pickups travel over the wire. */
export interface BwDropView extends BwPos { id: number; item: number; count: number; vx: number; vy: number; vz: number }
export interface BwSafeZone { active: boolean; x: number; z: number; radius: number; startsIn: number }
/** A middle (diamond/emerald) generator: its tier and seconds to the next drop. */
export interface BwGeneratorView { id: number; tier: number; next: number }
/** The next scheduled event, for the sidebar. */
interface BwNextEvent { label: string; in: number }
export interface BwBreakView { id: number; x: number; y: number; z: number; progress: number; duration: number }
export interface BwResult {
  winner: BwTeam | null; reason: string; duration: number;
  players: BwPlayerView[];
}
export interface BwSnapshot {
  world: number; phase: BwPhase; time: number; remaining: number; countdown: number;
  bedsIn: number; players: BwPlayerView[]; teams: BwTeamView[]; safeZone: BwSafeZone;
  breaks: BwBreakView[];
  gens: BwGeneratorView[];
  /** How many teams this match has (2 to 4); team ids are 0..teams-1. */
  teamCount: number;
  next: BwNextEvent | null;
  result: BwResult | null;
}
export const BW = {
  HEALTH: 20, COUNTDOWN: 5, RESPAWN: 5, SPAWN_PROTECTION: 2,
  /** Eye to the target's hitbox. The server allows a little more than the client
   *  aims for, so a hit the client believes in is never thrown away. */
  REACH: 5.5, MELEE_REACH: 3.2, MELEE_REACH_SERVER: 3.7, SHOP_REACH: 5, CHEST_REACH: 4,
  /** Beds go, the zone starts closing (deathmatch), the match ends. */
  BED_GONE_AT: 10 * 60, ZONE_AT: 12 * 60, END_AT: 15 * 60,
  DISCONNECT_GRACE: 30, DROP_LIFETIME: 90,
  BREAK_HEARTBEAT: 0.45,
  /** Clicks are not throttled beyond a sanity floor; damage is gated by the
   *  victim's half-second of invulnerability, as in Minecraft. */
  MELEE_GAP: 0.05, INVULNERABLE: 0.45,
  /** Sustained placement rate (one per PLACE_COOLDOWN s) with a small burst, so
   *  packets that bunch up on the way never cost a block. The client places as
   *  soon as its aim reaches a new spot, but never faster than PLACE_REPEAT_MS. */
  PLACE_COOLDOWN: 0.06, PLACE_BURST: 4, PLACE_REPEAT_MS: 60,
  REWIND: 0.3,
  SLOT_COUNT: 9, CHEST_CAP: 4096, PICKUP_RADIUS: 1.3,
} as const;
export const BW_RESOURCES: BwResource[] = ['iron', 'gold', 'diamond', 'emerald'];
export const BW_RESOURCE_ITEM: Record<BwResource, number> = {
  iron: Item.IronIngot, gold: Item.GoldIngot, diamond: Item.DiamondGem, emerald: Item.EmeraldGem,
};
export const BW_RESOURCE_NAME: Record<BwResource, string> = { iron: 'Iron', gold: 'Gold', diamond: 'Diamond', emerald: 'Emerald' };
export const BW_TEAM_NAMES = ['Red', 'Blue', 'Green', 'Yellow'] as const;
export const BW_TEAM_COLORS = ['#e5484d', '#3b82f6', '#2fb24f', '#e2a514'] as const;
export type BedwarsService = 'shop' | 'upgrades' | 'chest';
export const BW_SERVICE_NAMES: Record<BedwarsService, string> = { shop: 'Item Shop', upgrades: 'Team Upgrades', chest: 'Team Chest' };
export function bwZoneRadius(time: number): number { return Math.max(8, 90 - Math.max(0, time - BW.ZONE_AT) / (BW.END_AT - BW.ZONE_AT) * 82); }

/** The match's timeline, Hypixel style: middle generators upgrade on a
 *  schedule, then beds go, then the deathmatch zone closes in. */
export const BW_SCHEDULE: readonly { at: number; kind: 'diamond' | 'emerald' | 'beds' | 'deathmatch' | 'end'; tier?: number; label: string }[] = [
  { at: 150, kind: 'diamond', tier: 2, label: 'Diamond II' },
  { at: 270, kind: 'emerald', tier: 2, label: 'Emerald II' },
  { at: 390, kind: 'diamond', tier: 3, label: 'Diamond III' },
  { at: 480, kind: 'emerald', tier: 3, label: 'Emerald III' },
  { at: 600, kind: 'beds', label: 'Bed destruction' },
  { at: 720, kind: 'deathmatch', label: 'Deathmatch' },
  { at: 900, kind: 'end', label: 'Game end' },
];
/** Tier of the middle generators of one kind at a match time. */
export function bwGenTier(kind: 'diamond' | 'emerald', time: number): number {
  let tier = 1;
  for (const e of BW_SCHEDULE) if (e.kind === kind && time >= e.at) tier = e.tier!;
  return tier;
}
export function bwWallet(): BwWallet { return { iron: 0, gold: 0, diamond: 0, emerald: 0 }; }
export function bwUpgrades(): BwUpgrades { return { sharpness: 0, protection: 0, forge: 0, haste: 0, heal: 0, trap: 0 }; }

// ── Mining ─────────────────────────────────────────────────────────────────
/** The tool that works a block best, and how hard it is. Shared so the client's
 *  crack animation runs on exactly the clock the server enforces. */
function bwBlockProfile(block: number, bed: boolean): { hardness: number; tool: 'axe' | 'pickaxe' | 'shears' | null } {
  if (bed) return { hardness: 0.85, tool: null };
  if (block === Block.OakPlanks) return { hardness: 3, tool: 'axe' };
  if (block === Block.Sandstone) return { hardness: 4, tool: 'pickaxe' };
  if (block === Block.ManorGlass) return { hardness: 0.4, tool: null };
  return { hardness: 1.2, tool: 'shears' };
}
/** Tool kind and tier for a held item id (tier 1 wood, 2 iron; shears are 3). */
export function bwToolOf(item: number): { kind: 'axe' | 'pickaxe' | 'shears'; tier: number } | null {
  switch (item) {
    case Item.WoodPickaxe: return { kind: 'pickaxe', tier: 1 };
    case Item.IronPickaxe: return { kind: 'pickaxe', tier: 2 };
    case Item.WoodAxe: return { kind: 'axe', tier: 1 };
    case Item.IronAxe: return { kind: 'axe', tier: 2 };
    case Item.Shears: return { kind: 'shears', tier: 3 };
    default: return null;
  }
}
export function bwBreakSeconds(block: number, bed: boolean, held: number, haste: number): number {
  const { hardness, tool } = bwBlockProfile(block, bed);
  const t = bwToolOf(held);
  const speed = tool && t && t.kind === tool ? (tool === 'shears' ? 8 : t.tier === 2 ? 6 : 3) : 1;
  return Math.max(0.15, hardness / speed / (1 + haste * 0.25));
}

export type BwSlot = ItemStack;
