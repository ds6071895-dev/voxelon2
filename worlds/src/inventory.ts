// Inventory: 36 slots (0-8 hotbar, 9-35 main), a cursor stack for the UI,
// vanilla click semantics. Pure logic — the DOM lives in inventory_ui.ts.

import { ITEMS, ItemStack } from './items';

export const HOTBAR_SIZE = 9;
export const INV_SIZE = 36;
export const CRAFT_SIZE = 9;
export const CHEST_SIZE = 27;
/** Slots 72-75 are the worn armor: helmet, chestplate, leggings, boots. */
export const ARMOR_START = 72;
export const ARMOR_SIZE = 4;

function maxStack(id: number): number {
  return ITEMS[id]?.maxStack ?? 64;
}

export class Inventory {
  readonly slots: (ItemStack | null)[] =
    new Array(INV_SIZE + CRAFT_SIZE + CHEST_SIZE + ARMOR_SIZE).fill(null);
  /** Selected hotbar slot 0-8. */
  selected = 0;
  /** Bumped on every mutation; UIs redraw when it changes. */
  version = 0;

  get selectedStack(): ItemStack | null {
    return this.slots[this.selected];
  }

  select(slot: number): void {
    this.selected = ((slot % HOTBAR_SIZE) + HOTBAR_SIZE) % HOTBAR_SIZE;
    this.version++;
  }

  /** Remove n items from the selected hotbar stack. */
  consumeSelected(n = 1): void {
    const s = this.slots[this.selected];
    if (!s) return;
    s.count -= n;
    if (s.count <= 0) this.slots[this.selected] = null;
    this.version++;
  }

  /** Total count of an item id across storage slots (hotbar + main). */
  countItem(id: number): number {
    let n = 0;
    for (let i = 0; i < INV_SIZE; i++) {
      const s = this.slots[i];
      if (s && s.id === id) n += s.count;
    }
    return n;
  }

  /** Replace the carried items + worn armor from a saved blob. Fail-closed per
   *  slot (a malformed entry becomes empty), so a corrupt save can't crash or
   *  inject impossible items. */
  restore(data: unknown): void {
    if (!data || typeof data !== 'object') return;
    const d = data as { slots?: unknown; armor?: unknown; selected?: unknown };
    if (Array.isArray(d.slots)) {
      for (let i = 0; i < INV_SIZE; i++) this.slots[i] = sanitizeStack(d.slots[i]);
    }
    if (Array.isArray(d.armor)) {
      for (let i = 0; i < ARMOR_SIZE; i++) this.slots[ARMOR_START + i] = sanitizeStack(d.armor[i]);
    }
    if (Number.isInteger(d.selected)) {
      this.selected = ((d.selected as number % HOTBAR_SIZE) + HOTBAR_SIZE) % HOTBAR_SIZE;
    }
    this.version++;
  }
}

/** Validate one saved slot into a real ItemStack (or null). */
function sanitizeStack(raw: unknown): ItemStack | null {
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as Partial<ItemStack>;
  if (!Number.isInteger(s.id) || !ITEMS[s.id as number]) return null;
  if (!Number.isFinite(s.count) || (s.count as number) <= 0) return null;
  const stack: ItemStack = {
    id: s.id as number,
    count: Math.min(Math.floor(s.count as number), maxStack(s.id as number)),
  };
  if (Number.isFinite(s.loaded)) stack.loaded = Math.max(0, Math.floor(s.loaded as number));
  if (Number.isFinite(s.damage)) stack.damage = Math.max(0, s.damage as number);
  if (Number.isFinite(s.xp)) stack.xp = Math.max(0, s.xp as number);
  if (Number.isInteger(s.rune) && ITEMS[s.rune as number]) stack.rune = s.rune as number;
  return stack;
}
