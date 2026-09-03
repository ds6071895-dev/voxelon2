// THE FACTION TREASURY — where the tax goes, and what the enemy comes for.
//
// Each faction owns one strongbox standing beside its flag pad. It fills with
// the LEVY: a slice of everything the faction's citizens pull out of the ground,
// at whatever rate their elected president has set (politics.ts). The president
// is the only one who can spend it, and the only thing it buys is starter kits
// for recruits — so a treasury is a faction investing in its own newcomers, not
// a personal wallet.
//
// It is also a target. While a WAR window is open the enemy can walk up to it
// and haul stacks out. Outside a war it is sealed, so the strongbox is a reason
// to defend the flag pad during a war rather than a permanent grief button.
//
// PURE + transport-agnostic (no THREE/DOM/Node): the server runs these rules to
// decide, the offline client runs them to simulate, and the smoke tests run them
// headless — same discipline as flags.ts / politics.ts.

import { flagHome } from './flags';
import { ITEMS, type ItemStack } from './items';
import { Item } from './items';
import { Block } from './blocks';
import { FACTIONS, isFaction } from './teams';

/** A chest's worth of room. A treasury that fills up simply stops accepting the
 *  levy — which is a visible signal to spend it, not a silent item sink. */
export const TREASURY_SLOTS = 27;
/** How close you must stand to open or raid one (blocks). Matches FLAG_REACH's
 *  spirit: close enough that you are standing at the pad, in the open. */
export const TREASURY_REACH = 4;
/** Blocks from the flag pole, so the strongbox and the banner read as one site. */
export const TREASURY_OFFSET_X = 3;
export const TREASURY_OFFSET_Z = 0;
/** Stacks one raid can carry off. A raid is a dent, not an emptying — the point
 *  is repeated pressure across a war window, not a single fatal visit. */
export const RAID_STACKS = 6;
/** Seconds one raider must wait between raids on the same treasury. */
export const RAID_COOLDOWN = 30;

/** What a funded recruit kit contains. Deliberately a leg-up, not an endgame
 *  loadout: enough to mine, build, light a hole and defend yourself. */
export const STARTER_KIT: readonly ItemStack[] = [
  { id: Item.StonePickaxe, count: 1 },
  { id: Item.StoneAxe, count: 1 },
  { id: Block.OakPlanks, count: 32 },
  { id: Block.Torch, count: 8 },
  { id: Item.Pistol, count: 1 },
  { id: Item.Bullet, count: 32 },
];

export interface Treasury {
  faction: number;
  slots: (ItemStack | null)[];
  /** Lifetime items taken in as tax (for the ledger on the panel). */
  taken: number;
  /** Wall-clock ms of the last successful enemy raid (0 = never). */
  lastRaidAt: number;
  lastRaidBy?: string;
}

export function newTreasury(faction: number): Treasury {
  return {
    faction,
    slots: new Array(TREASURY_SLOTS).fill(null),
    taken: 0,
    lastRaidAt: 0,
  };
}

/** Where a faction's strongbox stands. Derived from flagHome(), exactly like the
 *  flag pads themselves — deterministic, so nothing has to be synced. */
export function treasuryLocation(faction: number): { x: number; z: number } {
  const home = flagHome(faction);
  return { x: home.x + TREASURY_OFFSET_X, z: home.z + TREASURY_OFFSET_Z };
}

/** The faction whose treasury a player at (x, z) is standing at, or null.
 *  Measured to the BLOCK CENTRE, which is where the model actually stands — the
 *  server and the client's prompt both call this, so they cannot disagree about
 *  the edge of the radius. */
export function treasuryInReach(x: number, z: number): number | null {
  for (const f of FACTIONS) {
    const loc = treasuryLocation(f.id);
    const dx = loc.x + 0.5 - x, dz = loc.z + 0.5 - z;
    if (dx * dx + dz * dz <= TREASURY_REACH * TREASURY_REACH) return f.id;
  }
  return null;
}

/** Total items held (the number the pledge screen advertises). */
export function treasuryCount(t: Treasury): number {
  let n = 0;
  for (const s of t.slots) if (s) n += s.count;
  return n;
}

/** How many of `id` the treasury holds. */
export function countOf(t: Treasury, id: number): number {
  let n = 0;
  for (const s of t.slots) if (s && s.id === id) n += s.count;
  return n;
}

/**
 * The tax on a harvest of `count` items at `rate`.
 *
 * The fractional remainder is settled by a coin flip against `roll` (0..1)
 * rather than rounded away, or a 5% tax on the single items that most of mining
 * produces would round to zero every time and the treasury would never fill.
 * Over many pickups the expected take is exactly `count * rate`. The levy is
 * always at least 0 and never the whole stack — a citizen always keeps
 * something, whatever rate a president sets.
 */
export function levy(count: number, rate: number, roll: number): number {
  if (!Number.isFinite(count) || count <= 0) return 0;
  if (!Number.isFinite(rate) || rate <= 0) return 0;
  const exact = count * Math.min(1, rate);
  const whole = Math.floor(exact);
  const bonus = (Number.isFinite(roll) ? roll : 1) < exact - whole ? 1 : 0;
  return Math.max(0, Math.min(Math.floor(count) - 1, whole + bonus));
}

/**
 * Put items in, honouring per-item stack limits. Returns whatever did NOT fit,
 * so the caller can hand the remainder back to the player rather than deleting
 * it — a full treasury must never eat somebody's ore.
 */
export function deposit(t: Treasury, id: number, count: number): number {
  const info = ITEMS[id];
  if (!info || !Number.isFinite(count)) return 0;
  let left = Math.floor(count);
  if (left <= 0) return 0;
  const max = Math.max(1, info.maxStack);
  // Top up partial stacks first so the box packs densely.
  for (const slot of t.slots) {
    if (left <= 0) break;
    if (!slot || slot.id !== id || slot.count >= max) continue;
    const room = max - slot.count;
    const move = Math.min(room, left);
    slot.count += move;
    left -= move;
  }
  for (let i = 0; i < t.slots.length && left > 0; i++) {
    if (t.slots[i]) continue;
    const move = Math.min(max, left);
    t.slots[i] = { id, count: move };
    left -= move;
  }
  return left;
}

/** Take `count` of `id` back out (kit funding). Returns how many were removed —
 *  all-or-nothing is the caller's job via `countOf` first. */
export function withdraw(t: Treasury, id: number, count: number): number {
  let left = Math.floor(Math.max(0, count));
  let taken = 0;
  for (let i = t.slots.length - 1; i >= 0 && left > 0; i--) {
    const slot = t.slots[i];
    if (!slot || slot.id !== id) continue;
    const move = Math.min(slot.count, left);
    slot.count -= move;
    left -= move;
    taken += move;
    if (slot.count <= 0) t.slots[i] = null;
  }
  return taken;
}

/** What one recruit kit costs the treasury (its contents, as a bill). */
export function kitCost(kit: readonly ItemStack[] = STARTER_KIT): ItemStack[] {
  const bill = new Map<number, number>();
  for (const s of kit) bill.set(s.id, (bill.get(s.id) ?? 0) + s.count);
  return [...bill].map(([id, count]) => ({ id, count }));
}

/** Can the treasury afford `n` kits right now? */
export function canFundKits(t: Treasury, n: number, kit: readonly ItemStack[] = STARTER_KIT): boolean {
  if (!Number.isFinite(n) || n <= 0) return false;
  return kitCost(kit).every((line) => countOf(t, line.id) >= line.count * n);
}

/** Pay for `n` kits. Returns false and changes NOTHING if it cannot afford them
 *  — a partial withdrawal would leave the treasury robbed and the stock unfunded. */
export function fundKits(t: Treasury, n: number, kit: readonly ItemStack[] = STARTER_KIT): boolean {
  if (!canFundKits(t, n, kit)) return false;
  for (const line of kitCost(kit)) withdraw(t, line.id, line.count * n);
  return true;
}

/**
 * Haul stacks out of an enemy treasury. Takes from the BACK, so the raider gets
 * whatever was banked most recently rather than being able to fish for the good
 * stuff. Returns what was taken (possibly empty).
 *
 * The war-window check is the CALLER's: this module has no opinion about the
 * war clock, and the server holds it.
 */
export function raid(t: Treasury, by: string, now: number, stacks = RAID_STACKS): ItemStack[] {
  const out: ItemStack[] = [];
  for (let i = t.slots.length - 1; i >= 0 && out.length < stacks; i--) {
    const slot = t.slots[i];
    if (!slot) continue;
    out.push({ id: slot.id, count: slot.count });
    t.slots[i] = null;
  }
  if (out.length) {
    t.lastRaidAt = now;
    t.lastRaidBy = by;
  }
  return out;
}

/** Fail-closed load of a persisted treasury (mirrors the chest sanitizer's
 *  discipline: a malformed slot becomes null, never a crash). */
export function sanitizeTreasury(raw: unknown, faction: number): Treasury {
  const t = newTreasury(faction);
  if (!raw || typeof raw !== 'object') return t;
  const r = raw as Record<string, unknown>;
  if (Array.isArray(r.slots)) {
    for (let i = 0; i < Math.min(r.slots.length, TREASURY_SLOTS); i++) {
      const s = r.slots[i] as Partial<ItemStack> | null;
      if (!s || !Number.isInteger(s.id) || !ITEMS[s.id as number]) continue;
      if (!Number.isFinite(s.count) || (s.count as number) <= 0) continue;
      const stack: ItemStack = { id: s.id as number, count: Math.floor(s.count as number) };
      if (Number.isInteger(s.rune) && ITEMS[s.rune as number]) stack.rune = s.rune as number;
      t.slots[i] = stack;
    }
  }
  t.taken = Number.isFinite(r.taken) ? Math.max(0, Math.floor(r.taken as number)) : 0;
  t.lastRaidAt = Number.isFinite(r.lastRaidAt) ? Math.max(0, r.lastRaidAt as number) : 0;
  if (typeof r.lastRaidBy === 'string') t.lastRaidBy = r.lastRaidBy;
  return t;
}

/** Every faction's treasury, fresh. */
export function newTreasuries(): Map<number, Treasury> {
  const m = new Map<number, Treasury>();
  for (const f of FACTIONS) m.set(f.id, newTreasury(f.id));
  return m;
}

/** Item count per faction — the public number, safe to show a non-member. */
export function treasuryCounts(m: Map<number, Treasury>): Record<number, number> {
  const out: Record<number, number> = {};
  for (const f of FACTIONS) out[f.id] = treasuryCount(m.get(f.id) ?? newTreasury(f.id));
  return out;
}

/** Guard for a faction id used as a treasury key. */
export function validTreasuryFaction(faction: unknown): faction is number {
  return typeof faction === 'number' && isFaction(faction);
}
