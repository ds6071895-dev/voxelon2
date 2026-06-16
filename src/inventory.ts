// Inventory: 36 slots (0-8 hotbar, 9-35 main), a cursor stack for the UI,
// vanilla click semantics. Pure logic — the DOM lives in inventory_ui.ts.

import { ITEMS, ItemStack } from './items';

export const HOTBAR_SIZE = 9;
export const INV_SIZE = 36;
/** Slots 36-44 are the 3x3 crafting cells (2x2 mode exposes 4 of them). */
export const CRAFT_START = 36;
export const CRAFT_SIZE = 9;

function maxStack(id: number): number {
  return ITEMS[id]?.maxStack ?? 64;
}

export class Inventory {
  readonly slots: (ItemStack | null)[] =
    new Array(INV_SIZE + CRAFT_SIZE).fill(null);
  /** Selected hotbar slot 0-8. */
  selected = 0;
  /** Stack held on the mouse cursor while the inventory UI is open. */
  cursor: ItemStack | null = null;
  /** Bumped on every mutation; UIs redraw when it changes. */
  version = 0;

  get selectedStack(): ItemStack | null {
    return this.slots[this.selected];
  }

  select(slot: number): void {
    this.selected = ((slot % HOTBAR_SIZE) + HOTBAR_SIZE) % HOTBAR_SIZE;
    this.version++;
  }

  /** Insert a stack (hotbar first), returns the count that did not fit. */
  add(id: number, count: number): number {
    let left = count;
    // merge into existing stacks
    for (let i = 0; i < INV_SIZE && left > 0; i++) {
      const s = this.slots[i];
      if (s && s.id === id && s.count < maxStack(id)) {
        const take = Math.min(left, maxStack(id) - s.count);
        s.count += take;
        left -= take;
      }
    }
    // then empty slots
    for (let i = 0; i < INV_SIZE && left > 0; i++) {
      if (!this.slots[i]) {
        const take = Math.min(left, maxStack(id));
        this.slots[i] = { id, count: take };
        left -= take;
      }
    }
    if (left !== count) this.version++;
    return left;
  }

  /** Room for at least one item of this id (storage slots only)? */
  canAccept(id: number): boolean {
    return this.slots.slice(0, INV_SIZE).some(
      (s) => !s || (s.id === id && s.count < maxStack(id))
    );
  }

  /** Remove n items from the selected hotbar stack. */
  consumeSelected(n = 1): void {
    const s = this.slots[this.selected];
    if (!s) return;
    s.count -= n;
    if (s.count <= 0) this.slots[this.selected] = null;
    this.version++;
  }

  /** Find the hotbar slot holding an item id (-1 if none). */
  findInHotbar(id: number): number {
    for (let i = 0; i < HOTBAR_SIZE; i++) {
      if (this.slots[i]?.id === id) return i;
    }
    return -1;
  }

  /** Vanilla left click: pick up / place all / merge / swap. */
  leftClick(i: number): void {
    const slot = this.slots[i];
    if (!this.cursor) {
      if (slot) {
        this.cursor = slot;
        this.slots[i] = null;
        this.version++;
      }
      return;
    }
    if (!slot) {
      this.slots[i] = this.cursor;
      this.cursor = null;
    } else if (slot.id === this.cursor.id) {
      const take = Math.min(this.cursor.count, maxStack(slot.id) - slot.count);
      slot.count += take;
      this.cursor.count -= take;
      if (this.cursor.count <= 0) this.cursor = null;
    } else {
      const tmp = this.slots[i];
      this.slots[i] = this.cursor;
      this.cursor = tmp;
    }
    this.version++;
  }

  /** Vanilla right click: take half / place one. */
  rightClick(i: number): void {
    const slot = this.slots[i];
    if (!this.cursor) {
      if (slot) {
        const take = Math.ceil(slot.count / 2);
        this.cursor = { id: slot.id, count: take };
        slot.count -= take;
        if (slot.count <= 0) this.slots[i] = null;
        this.version++;
      }
      return;
    }
    if (!slot) {
      this.slots[i] = { id: this.cursor.id, count: 1 };
    } else if (slot.id === this.cursor.id && slot.count < maxStack(slot.id)) {
      slot.count += 1;
    } else {
      return;
    }
    this.cursor.count -= 1;
    if (this.cursor.count <= 0) this.cursor = null;
    this.version++;
  }

  /** Shift-click: hotbar <-> main; crafting cells -> anywhere. */
  shiftClick(i: number): void {
    const slot = this.slots[i];
    if (!slot) return;
    const [from, to] = i >= CRAFT_START
      ? [i, [0, INV_SIZE]] as const
      : i < HOTBAR_SIZE
        ? [i, [HOTBAR_SIZE, INV_SIZE]] as const
        : [i, [0, HOTBAR_SIZE]] as const;
    let left = slot.count;
    for (let j = to[0]; j < to[1] && left > 0; j++) {
      const t = this.slots[j];
      if (t && t.id === slot.id && t.count < maxStack(slot.id)) {
        const take = Math.min(left, maxStack(slot.id) - t.count);
        t.count += take;
        left -= take;
      }
    }
    for (let j = to[0]; j < to[1] && left > 0; j++) {
      if (!this.slots[j]) {
        this.slots[j] = { id: slot.id, count: left };
        left = 0;
      }
    }
    if (left === 0) this.slots[from] = null;
    else slot.count = left;
    this.version++;
  }

  /** Cursor + crafting cells back into storage on UI close; returns what
   *  didn't fit (caller spills it as item entities). */
  stashOpenSlots(): ItemStack[] {
    const overflow: ItemStack[] = [];
    const stash = (s: ItemStack | null) => {
      if (!s) return;
      const left = this.add(s.id, s.count);
      if (left > 0) overflow.push({ ...s, count: left });
    };
    stash(this.cursor);
    this.cursor = null;
    for (let i = CRAFT_START; i < CRAFT_START + CRAFT_SIZE; i++) {
      stash(this.slots[i]);
      this.slots[i] = null;
    }
    this.version++;
    return overflow;
  }

  /** Apply tool wear to the selected stack; the tool breaks at 0. */
  damageSelected(amount: number): void {
    const s = this.slots[this.selected];
    const tool = s ? ITEMS[s.id]?.tool : undefined;
    if (!s || !tool) return;
    s.damage = (s.damage ?? 0) + amount;
    if (s.damage >= tool.durability) this.slots[this.selected] = null;
    this.version++;
  }

  /** Take everything (death): returns all stacks and clears the inventory. */
  spillAll(): ItemStack[] {
    const out: ItemStack[] = [];
    for (let i = 0; i < this.slots.length; i++) {
      if (this.slots[i]) out.push(this.slots[i]!);
      this.slots[i] = null;
    }
    if (this.cursor) out.push(this.cursor);
    this.cursor = null;
    this.version++;
    return out;
  }
}
