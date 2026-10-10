// Hotbar rules. Every item, resources included, is an ordinary stack in one of
// nine slots; the same functions run for humans, bots and shop purchases.
import { ITEMS, Item } from './items';
import { BW, bwToolOf, type BwSlot, type BwTeam, type BwTools } from './bedwars_rules';
import { bwItem, bwEntryOf, type BwCatalogEntry } from './bedwars_catalog';

export type BwSlots = (BwSlot | null)[];
export const bwMaxStack = (item: number): number => ITEMS[item]?.maxStack ?? 64;
export const bwCloneSlots = (slots: BwSlots): BwSlots => slots.map(s => s ? { ...s } : null);

export function bwKit(tools: BwTools = { pickaxe: 0, axe: 0, shears: 0 }): BwSlots {
  const slots: BwSlots = Array.from({ length: BW.SLOT_COUNT }, () => null);
  slots[0] = { id: Item.WoodSword, count: 1 };
  const keep = [
    tools.pickaxe ? (tools.pickaxe === 2 ? Item.IronPickaxe : Item.WoodPickaxe) : 0,
    tools.axe ? (tools.axe === 2 ? Item.IronAxe : Item.WoodAxe) : 0,
    tools.shears ? Item.Shears : 0,
  ];
  for (const id of keep) if (id) bwAdd(slots, id, 1);
  return slots;
}

export function bwCount(slots: BwSlots, item: number): number {
  let n = 0;
  for (const s of slots) if (s && s.id === item) n += s.count;
  return n;
}
/** How many more of this item the hotbar could take. */
export function bwRoom(slots: BwSlots, item: number): number {
  const max = bwMaxStack(item);
  let room = 0;
  for (const s of slots) room += !s ? max : s.id === item ? max - s.count : 0;
  return room;
}
/** Adds as many as fit (top up existing stacks first) and returns how many went in. */
export function bwAdd(slots: BwSlots, item: number, count: number): number {
  const max = bwMaxStack(item);
  let left = count;
  for (const s of slots) {
    if (!left) break;
    if (s && s.id === item && s.count < max) { const n = Math.min(left, max - s.count); s.count += n; left -= n; }
  }
  for (let i = 0; i < slots.length && left; i++) {
    if (slots[i]) continue;
    const n = Math.min(left, max);
    slots[i] = { id: item, count: n }; left -= n;
  }
  return count - left;
}
/** Removes up to `count` of an item across stacks; returns how many were taken. */
export function bwTake(slots: BwSlots, item: number, count: number): number {
  let left = count;
  for (let i = slots.length - 1; i >= 0 && left; i--) {
    const s = slots[i];
    if (!s || s.id !== item) continue;
    const n = Math.min(left, s.count);
    s.count -= n; left -= n;
    if (!s.count) slots[i] = null;
  }
  return count - left;
}
export function bwConsume(slots: BwSlots, slot: number, count = 1): boolean {
  const s = slots[slot];
  if (!s || s.count < count) return false;
  s.count -= count;
  if (!s.count) slots[slot] = null;
  return true;
}
/** Gives a purchase. Swords and tools replace the lower tier in place; only
 *  mutates after confirming it fits, so a failed purchase is atomic. */
export function bwGive(slots: BwSlots, entry: BwCatalogEntry, team: BwTeam): boolean {
  const item = bwItem(entry, team);
  if (entry.type === 'sword') { slots[0] = { id: item, count: 1 }; return true; }
  if (entry.type === 'tool') {
    const existing = slots.findIndex(s => s && bwToolOf(s.id)?.kind === entry.toolKind);
    if (existing >= 0) { slots[existing] = { id: item, count: 1 }; return true; }
  }
  if (entry.type === 'bow' && slots.some(s => s?.id === item)) return false;
  if (bwRoom(slots, item) < entry.count) return false;
  bwAdd(slots, item, entry.count);
  return true;
}
export const bwHas = (slots: BwSlots, sku: string): boolean => slots.some(s => s && bwEntryOf(s.id)?.sku === sku);
