// FACTION TREASURY & FLAG DEFENSE
//
// In-world Treasury located near each faction's flag pad.
// - Fed by taxation on resource mining, crafting, and vault looting
// - Enemy players can only raid/steal from the treasury during active WAR windows
// - Enemy raids sound the emergency alert horn and dispatch priority alarms to defenders
// - Pure and transport-agnostic so client and server enforce identical rules

import { flagHome } from './flags';
import { ITEMS, type ItemStack } from './items';
import { MAX_TAX_RATE } from './politics';
import { FACTIONS, isFaction } from './teams';

export const TREASURY_OFFSET_X = 3;
export const TREASURY_OFFSET_Z = 0;
export const TREASURY_INTERACTION_RADIUS = 3.5;
export const TREASURY_CAPACITY = 27; // standard chest size

export interface FactionTreasury {
  faction: number;
  slots: (ItemStack | null)[];
  totalTaxIntake: number;
  totalLooted: number;
  lastRaidAt: number;
  lastRaidBy?: string;
}

/**
 * World coordinate of the Faction Treasury (3 blocks from flag pad).
 */
export function treasuryLocation(faction: number): { x: number; z: number } {
  const home = flagHome(faction);
  return {
    x: home.x + TREASURY_OFFSET_X,
    z: home.z + TREASURY_OFFSET_Z,
  };
}

/**
 * Checks if coordinate (x, z) corresponds to a Faction Treasury.
 * Returns the faction ID if within interaction reach, or null.
 */
export function treasuryAt(x: number, z: number): number | null {
  for (const f of [0, 1]) {
    const loc = treasuryLocation(f);
    const dx = loc.x - x;
    const dz = loc.z - z;
    if (dx * dx + dz * dz <= TREASURY_INTERACTION_RADIUS * TREASURY_INTERACTION_RADIUS) {
      return f;
    }
  }
  return null;
}

export function createTreasury(faction: number): FactionTreasury {
  return {
    faction,
    slots: new Array(TREASURY_CAPACITY).fill(null),
    totalTaxIntake: 0,
    totalLooted: 0,
    lastRaidAt: 0,
  };
}

/**
 * Calculate item tax when harvesting or looting.
 * Safely handles fractional item counts using probabilistic rounding so even
 * small harvests contribute fairly.
 */
export function levyTax(
  taxRate: number,
  item: number,
  count: number,
  rng = Math.random
): { playerGets: number; treasuryGets: number } {
  if (count <= 0 || taxRate <= 0) {
    return { playerGets: Math.max(0, count), treasuryGets: 0 };
  }

  const rate = Math.max(0, Math.min(MAX_TAX_RATE, taxRate));
  const expectedTax = count * rate;
  let tax = Math.floor(expectedTax);
  const remainder = expectedTax - tax;

  if (remainder > 0 && rng() < remainder) {
    tax++;
  }

  tax = Math.min(count, Math.max(0, tax));
  return {
    playerGets: count - tax,
    treasuryGets: tax,
  };
}

/**
 * Deposit taxed or donated items into the Faction Treasury.
 */
export function depositToTreasury(
  treasury: FactionTreasury,
  item: number,
  count: number
): number {
  if (count <= 0) return 0;
  let remaining = count;

  // Stack depth comes from the item table: tools, guns and armour cap at 1, so
  // a hardcoded 64 would have merged them into impossible stacks.
  const cap = Math.max(1, ITEMS[item]?.maxStack ?? 64);

  // 1. Stack with existing matching item slots
  for (let i = 0; i < treasury.slots.length; i++) {
    const slot = treasury.slots[i];
    if (slot && slot.id === item && slot.count < cap) {
      const space = cap - slot.count;
      const add = Math.min(space, remaining);
      slot.count += add;
      remaining -= add;
      if (remaining <= 0) break;
    }
  }

  // 2. Place in empty slots
  if (remaining > 0) {
    for (let i = 0; i < treasury.slots.length; i++) {
      if (!treasury.slots[i]) {
        const add = Math.min(cap, remaining);
        treasury.slots[i] = { id: item, count: add };
        remaining -= add;
        if (remaining <= 0) break;
      }
    }
  }

  const accepted = count - remaining;
  treasury.totalTaxIntake += accepted;
  return accepted;
}

/**
 * Whether a player is permitted to steal from the target treasury.
 * Rule: Only ENEMY players during an ACTIVE WAR WINDOW can steal.
 * Peacetime locks and defends the treasury against theft.
 */
export function canStealTreasury(
  playerFaction: number,
  treasuryFaction: number,
  isWarActive: boolean
): boolean {
  if (!isWarActive) return false;
  if (!isFaction(playerFaction) || !isFaction(treasuryFaction)) return false;
  return playerFaction !== treasuryFaction;
}

/**
 * Execute a raid on the enemy treasury.
 * Extracts valuable stacks and tracks raid statistics.
 */
export function stealFromTreasury(
  treasury: FactionTreasury,
  raiderName: string,
  maxStacks = 4
): { stolen: ItemStack[]; alarm: boolean } {
  const stolen: ItemStack[] = [];

  // Take the FATTEST stacks, not simply the first ones in slot order — a raid
  // that risks crossing the enemy base should bite where it hurts, and the
  // doc contract above says "valuable".
  const byValue = treasury.slots
    .map((slot, index) => ({ slot, index }))
    .filter((e): e is { slot: ItemStack; index: number } => !!e.slot && e.slot.count > 0)
    .sort((a, b) => b.slot.count - a.slot.count)
    .slice(0, Math.max(0, maxStacks));

  for (const { slot, index } of byValue) {
    stolen.push({ ...slot });
    treasury.totalLooted += slot.count;
    treasury.slots[index] = null;
  }

  treasury.lastRaidAt = Date.now();
  treasury.lastRaidBy = raiderName;

  return {
    stolen,
    alarm: stolen.length > 0,
  };
}

/**
 * Total item count currently sitting in the treasury.
 */
export function treasuryItemCount(treasury: FactionTreasury): number {
  let sum = 0;
  for (const s of treasury.slots) {
    if (s) sum += s.count;
  }
  return sum;
}

/**
 * Rebuild the treasuries from an untrusted save blob.
 *
 * Mirrors sanitizePoliticsState: a save that predates this system, or one cut
 * short mid-write, must still yield a full, correctly shaped treasury for every
 * faction rather than a hole the raid handlers will trip over.
 */
export function sanitizeTreasuries(raw: unknown): Record<number, FactionTreasury> {
  const out: Record<number, FactionTreasury> = {};
  const src = (raw && typeof raw === 'object' ? raw : {}) as Record<number, Partial<FactionTreasury>>;

  for (const f of FACTIONS) {
    const fresh = createTreasury(f.id);
    const saved = src[f.id];
    if (saved && typeof saved === 'object') {
      if (Array.isArray(saved.slots)) {
        for (let i = 0; i < fresh.slots.length; i++) {
          const slot = saved.slots[i];
          fresh.slots[i] = slot && Number.isFinite(slot.id) && Number.isFinite(slot.count) &&
            slot.count > 0 ? { ...slot } : null;
        }
      }
      if (Number.isFinite(saved.totalTaxIntake)) fresh.totalTaxIntake = saved.totalTaxIntake as number;
      if (Number.isFinite(saved.totalLooted)) fresh.totalLooted = saved.totalLooted as number;
      if (Number.isFinite(saved.lastRaidAt)) fresh.lastRaidAt = saved.lastRaidAt as number;
      if (typeof saved.lastRaidBy === 'string') fresh.lastRaidBy = saved.lastRaidBy;
    }
    out[f.id] = fresh;
  }

  return out;
}
