// THE FACTION TREASURY — where the tax goes, and what the enemy comes for.
//
// Each faction's hoard stands at its flag pad, IN THE OPEN: a strongbox beside
// the pole and a ring of pedestals around it, one per slice of what is banked
// (treasury_models.ts draws them). It fills with the LEVY: a slice of everything
// the faction's citizens pull out of the ground, at whatever rate their elected
// president has set (politics.ts). The president is the only one who can spend
// it, and the only thing it buys is starter kits for recruits — so a treasury is
// a faction investing in its own newcomers, not a personal wallet.
//
// IT IS MEANT TO BE SEEN. A hoard you can count from the ridgeline is a raid
// somebody plans; a number in a menu is not. While a WAR window is open the
// enemy can walk into the ring and haul stacks off it. Outside a war it is
// sealed, so the hoard is a reason to defend the flag pad during a war rather
// than a permanent grief button.
//
// PURE + transport-agnostic (no THREE/DOM/Node): the server runs these rules to
// decide, the offline client runs them to simulate, and the smoke tests run them
// headless — same discipline as flags.ts / politics.ts.

import { flagHome } from './flags';
import { ARMOR_SLOT_INDEX, ITEMS, type ItemStack } from './items';
import { Item } from './items';
import { Block } from './blocks';
import { FACTIONS, isFaction } from './teams';

/** A chest's worth of room. A treasury that fills up simply stops accepting the
 *  levy — which is a visible signal to spend it, not a silent item sink. */
export const TREASURY_SLOTS = 27;
/** How close you must stand to open or raid one (blocks). Measured from the
 *  FLAG POLE, not from the strongbox, because the hoard is not one box any more:
 *  the levy stands out in the open on a ring of pedestals around the banner
 *  (treasury_models.ts), and every one of them is part of the same site. The
 *  radius covers that whole ring with a step to spare. */
export const TREASURY_REACH = 5;
/** Radius of the ring of hoard pedestals around the flag pole, in blocks. Kept
 *  here rather than in the model so the reach test above and the thing you can
 *  actually walk up to are derived from ONE number. */
export const TREASURY_RING_RADIUS = 3.4;
/** How many pedestals stand in that ring — one per visible slice of the hoard. */
export const TREASURY_PEDESTALS = 8;
/** Blocks from the flag pole, so the strongbox and the banner read as one site. */
export const TREASURY_OFFSET_X = 3;
export const TREASURY_OFFSET_Z = 0;
/** Stacks one raid can carry off. A raid is a dent, not an emptying — the point
 *  is repeated pressure across a war window, not a single fatal visit. */
export const RAID_STACKS = 6;
/** Seconds one raider must wait between raids on the same treasury. */
export const RAID_COOLDOWN = 30;

/** What a funded recruit kit contains OUT OF THE BOX. Deliberately a leg-up,
 *  not an endgame loadout: enough to mine, build, light a hole and defend
 *  yourself. A president can rewrite it (see `newKit` below) — this is only
 *  where every faction starts. */
export const STARTER_KIT: readonly ItemStack[] = [
  { id: Item.StonePickaxe, count: 1 },
  { id: Item.StoneAxe, count: 1 },
  { id: Block.OakPlanks, count: 32 },
  { id: Block.Torch, count: 8 },
  { id: Item.Pistol, count: 1 },
  { id: Item.Bullet, count: 32 },
];

// --- The kit LOADOUT ---------------------------------------------------------
// A recruit kit is not a fixed list any more: it is a loadout its president
// lays out slot by slot, shaped exactly like the thing a recruit will be
// looking at ten seconds later — four armor slots and a hotbar. The layout IS
// the contract: index 0..3 are helmet/chestplate/leggings/boots in Inventory's
// own ARMOR_SLOT_INDEX order, and 4.. are the hotbar left to right.
//
// Why a layout instead of a bag: a kit that arrives as an unordered pile makes
// a new player stop and sort it. A kit laid out by a president arrives WORN and
// in the right hand, and the panel that builds it looks like the inventory it
// will become.

/** Armor slots on a kit: helmet, chestplate, leggings, boots. */
export const KIT_ARMOR_SLOTS = 4;
/** Hotbar slots on a kit — the same nine the player actually carries. */
export const KIT_HOTBAR_SLOTS = 9;
export const KIT_SLOTS = KIT_ARMOR_SLOTS + KIT_HOTBAR_SLOTS;
/** Ceiling on one kit line. A kit is a leg-up, not a warehouse transfer, and
 *  this is also what stops a president writing a bill nobody could ever pay. */
export const MAX_KIT_STACK = 64;

/** A kit slot laid out for editing: 4 armor + 9 hotbar, nulls for empty. */
export type KitLoadout = (ItemStack | null)[];

/** The default loadout: the classic STARTER_KIT dropped into the hotbar. */
export function newKit(): KitLoadout {
  const kit: KitLoadout = new Array(KIT_SLOTS).fill(null);
  STARTER_KIT.forEach((line, i) => {
    if (i < KIT_HOTBAR_SLOTS) kit[KIT_ARMOR_SLOTS + i] = { ...line };
  });
  return kit;
}

/** Is `index` one of the four armor slots? */
export function isKitArmorSlot(index: number): boolean {
  return index >= 0 && index < KIT_ARMOR_SLOTS;
}

/**
 * May `id` go in kit slot `index`? Armor slots take only the armor piece that
 * belongs there (a helmet cannot be worn as boots), and the hotbar takes
 * anything. Enforced on BOTH sides: the panel greys the slot out, the server
 * refuses the message.
 */
export function kitSlotAccepts(index: number, id: number): boolean {
  const info = ITEMS[id];
  if (!info) return false;
  if (!isKitArmorSlot(index)) return index >= 0 && index < KIT_SLOTS;
  const armor = info.armor;
  return !!armor && ARMOR_SLOT_INDEX[armor.slot] === index;
}

/** The non-empty lines of a loadout — what a claim actually hands over. */
export function kitStacks(kit: KitLoadout): ItemStack[] {
  return kit.filter((s): s is ItemStack => !!s && !!ITEMS[s.id] && s.count > 0);
}

/** Total items in one kit (the number the editor shows per recruit). */
export function kitItemCount(kit: KitLoadout): number {
  return kitStacks(kit).reduce((n, s) => n + s.count, 0);
}

/** Fail-closed load of a loadout off the wire or the disk. Anything malformed
 *  becomes an empty slot; anything in the wrong armor slot is dropped rather
 *  than relocated, because silently moving a president's layout is worse than
 *  showing them the gap they left. */
export function sanitizeKit(raw: unknown): KitLoadout {
  const kit: KitLoadout = new Array(KIT_SLOTS).fill(null);
  if (!Array.isArray(raw)) return newKit();
  for (let i = 0; i < Math.min(raw.length, KIT_SLOTS); i++) {
    const s = raw[i] as Partial<ItemStack> | null;
    if (!s || !Number.isInteger(s.id) || !ITEMS[s.id as number]) continue;
    if (!Number.isFinite(s.count) || (s.count as number) <= 0) continue;
    if (!kitSlotAccepts(i, s.id as number)) continue;
    const max = Math.min(MAX_KIT_STACK, Math.max(1, ITEMS[s.id as number].maxStack));
    kit[i] = { id: s.id as number, count: Math.min(max, Math.floor(s.count as number)) };
  }
  return kit;
}

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

/**
 * Where the `i`th hoard pedestal stands: evenly spaced around the flag pole and
 * offset by HALF a step, so no pedestal ever lands on the +X axis where the
 * strongbox stands — with an even count and no offset, one of them would be
 * built straight through the box. Deterministic like everything else here, so
 * the raid test, the models and the panel that draws the ring cannot drift.
 */
export function pedestalLocation(
  faction: number, i: number, n: number = TREASURY_PEDESTALS
): { x: number; z: number } {
  const home = flagHome(faction);
  const a = (Math.PI * 2 * (i + 0.5)) / Math.max(1, n);
  return {
    x: home.x + Math.cos(a) * TREASURY_RING_RADIUS,
    z: home.z + Math.sin(a) * TREASURY_RING_RADIUS,
  };
}

/** The faction whose treasury a player at (x, z) is standing at, or null.
 *
 *  Measured from the FLAG POLE's block centre, which is the centre of the whole
 *  hoard site — the strongbox and every pedestal in the ring sit inside this
 *  radius, so walking up to any part of the hoard counts as being at it. The
 *  server and the client's prompt both call this, so they cannot disagree about
 *  the edge of the radius. */
export function treasuryInReach(x: number, z: number): number | null {
  for (const f of FACTIONS) {
    const home = flagHome(f.id);
    const dx = home.x + 0.5 - x, dz = home.z + 0.5 - z;
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
