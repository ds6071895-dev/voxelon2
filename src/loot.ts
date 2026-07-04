// Seeded loot tables (Milestone C): what a structure chest holds. PURE — the
// contents of a chest are a deterministic function of (worldSeed, x, y, z, tier),
// generated ON FIRST OPEN (server-side online, locally offline) so they're
// identical everywhere and can't be duplicated by re-rolling.

import { Block } from './blocks';
import { Item, ItemStack } from './items';
import { CHEST_SLOTS } from './net/protocol';
import { mulberry32 } from './noise';

export type LootTier = 'common' | 'rare' | 'epic';

/** One weighted loot-table row: item, count range, relative weight. */
export interface LootEntry { id: number; min: number; max: number; w: number; }

/** Tiered pools. Weights are relative within a tier; all positive. */
export const LOOT_TABLES: Record<LootTier, LootEntry[]> = {
  // Ruined Watchtower: humble traveller supplies.
  common: [
    { id: Item.Stick, min: 2, max: 6, w: 3 },
    { id: Block.OakPlanks, min: 4, max: 10, w: 3 },
    { id: Item.Coal, min: 2, max: 5, w: 3 },
    { id: Block.Torch, min: 2, max: 6, w: 2 },
    { id: Item.Bullet, min: 4, max: 10, w: 2 },
    { id: Item.IronIngot, min: 1, max: 3, w: 2 },
    { id: Item.GoldIngot, min: 1, max: 2, w: 1 },
  ],
  // Bunker: military stores — ammo, gadgets, the occasional sidearm.
  rare: [
    { id: Item.Bullet, min: 8, max: 20, w: 3 },
    { id: Item.IronIngot, min: 3, max: 6, w: 3 },
    { id: Item.Cannonball, min: 2, max: 6, w: 2 },
    { id: Item.Grenade, min: 1, max: 2, w: 2 },
    { id: Item.SmokeGrenade, min: 1, max: 2, w: 1 },
    { id: Item.JumpBoost, min: 1, max: 2, w: 1 },
    { id: Item.GoldIngot, min: 2, max: 4, w: 2 },
    { id: Item.Diamond, min: 1, max: 2, w: 1 },
    { id: Item.Pistol, min: 1, max: 1, w: 1 },
    { id: Item.Shotgun, min: 1, max: 1, w: 0.5 },
  ],
  // Crashed Cargo Pod: the best surface loot — titanium, gadgets, RARELY a Heart.
  epic: [
    { id: Item.TitaniumIngot, min: 2, max: 4, w: 3 },
    { id: Item.Diamond, min: 2, max: 4, w: 2 },
    { id: Item.CrystalShard, min: 2, max: 5, w: 2 },
    { id: Item.Grenade, min: 2, max: 4, w: 2 },
    { id: Item.GrapplingHook, min: 1, max: 1, w: 1 },
    { id: Item.SentryKit, min: 1, max: 1, w: 1 },
    { id: Item.SMG, min: 1, max: 1, w: 0.7 },
    { id: Item.Sniper, min: 1, max: 1, w: 0.5 },
    { id: Item.BurstRifle, min: 1, max: 1, w: 0.5 },
    { id: Item.OilBarrel, min: 2, max: 5, w: 1.5 },
    { id: Item.Heart, min: 1, max: 1, w: 0.4 }, // the rare jackpot
  ],
};

/** Rolls per chest by tier (better tiers hold a little more). */
const ROLLS: Record<LootTier, [number, number]> = {
  common: [3, 5], rare: [3, 6], epic: [4, 6],
};

/** Deterministic per-chest rng seed from the world seed + chest position. */
export function lootSeed(seed: number, x: number, y: number, z: number): number {
  let h = seed ^ 0x100773;
  h = Math.imul(h ^ x, 0x27d4eb2f);
  h = Math.imul(h ^ y, 0x165667b1);
  h = Math.imul(h ^ z, 0x9e3779b1);
  return h >>> 0;
}

/** The seeded loot stacks for one structure chest. */
export function chestLoot(
  seed: number, x: number, y: number, z: number, tier: LootTier
): ItemStack[] {
  const rng = mulberry32(lootSeed(seed, x, y, z));
  const table = LOOT_TABLES[tier];
  const totalW = table.reduce((a, e) => a + e.w, 0);
  const [lo, hi] = ROLLS[tier];
  const n = lo + Math.floor(rng() * (hi - lo + 1));
  const out: ItemStack[] = [];
  for (let i = 0; i < n; i++) {
    let pick = rng() * totalW;
    let entry = table[table.length - 1];
    for (const e of table) { pick -= e.w; if (pick <= 0) { entry = e; break; } }
    out.push({ id: entry.id, count: entry.min + Math.floor(rng() * (entry.max - entry.min + 1)) });
  }
  return out;
}

/** The same loot laid out into chest slots at seeded positions (prettier than
 *  a packed top row; the layout is deterministic too). */
export function chestLootSlots(
  seed: number, x: number, y: number, z: number, tier: LootTier
): (ItemStack | null)[] {
  const rng = mulberry32(lootSeed(seed, x, y, z) ^ 0x51075);
  const slots: (ItemStack | null)[] = new Array(CHEST_SLOTS).fill(null);
  for (const stack of chestLoot(seed, x, y, z, tier)) {
    let at = Math.floor(rng() * CHEST_SLOTS);
    for (let tries = 0; slots[at] !== null && tries < CHEST_SLOTS; tries++) {
      at = (at + 1) % CHEST_SLOTS;
    }
    slots[at] = stack;
  }
  return slots;
}
