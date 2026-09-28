// Inventory: 36 slots (0-8 hotbar, 9-35 main) holding the loadout the server
// hands out for each match. Pure logic — the hotbar DOM lives in hud.ts.

import { ITEMS, ItemStack } from './items';

export const HOTBAR_SIZE = 9;
const INV_SIZE = 36;

function maxStack(id: number): number {
  return ITEMS[id]?.maxStack ?? 64;
}

export class Inventory {
  readonly slots: (ItemStack | null)[] = new Array(INV_SIZE).fill(null);
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

  /** Replace every slot, e.g. with a match loadout. Fail-closed per slot (a
   *  malformed entry becomes empty), so a bad message can't crash or inject
   *  impossible items. */
  restore(slots: readonly unknown[], selected: number): void {
    for (let i = 0; i < INV_SIZE; i++) this.slots[i] = sanitizeStack(slots[i]);
    this.select(Number.isInteger(selected) ? selected : 0);
  }
}

/** Validate one slot into a real ItemStack (or null). */
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
  return stack;
}
