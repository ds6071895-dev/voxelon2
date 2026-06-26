// Inventory: 36 slots (0-8 hotbar, 9-35 main), a cursor stack for the UI,
// vanilla click semantics. Pure logic — the DOM lives in inventory_ui.ts.

import { ARMOR_SLOT_INDEX, armorPointsOf, ITEMS, ItemStack } from './items';

export const HOTBAR_SIZE = 9;
export const INV_SIZE = 36;
/** Slots 36-44 are the 3x3 crafting cells (2x2 mode exposes 4 of them). */
export const CRAFT_START = 36;
export const CRAFT_SIZE = 9;
/** Slots 45-71 mirror the currently-open chest's 27 contents. */
export const CHEST_START = 45;
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
  /** True while a chest UI is open (routes shift-clicks to/from the chest). */
  chestOpen = false;
  /** Selected hotbar slot 0-8. */
  selected = 0;
  /** Stack held on the mouse cursor while the inventory UI is open. */
  cursor: ItemStack | null = null;
  /** Bumped on every mutation; UIs redraw when it changes. */
  version = 0;

  get selectedStack(): ItemStack | null {
    return this.slots[this.selected];
  }

  /** The item worn in the chestplate armor slot (chestplate or glider), if any. */
  get chestplateStack(): ItemStack | null {
    return this.slots[ARMOR_START + ARMOR_SLOT_INDEX.chestplate];
  }

  /** Remove the worn chestplate-slot item (e.g. a glider that wore out). */
  clearChestplate(): void {
    this.slots[ARMOR_START + ARMOR_SLOT_INDEX.chestplate] = null;
    this.version++;
  }

  select(slot: number): void {
    this.selected = ((slot % HOTBAR_SIZE) + HOTBAR_SIZE) % HOTBAR_SIZE;
    this.version++;
  }

  /** Insert a stack (hotbar first), returns the count that did not fit. When a
   *  `meta` template is given, its per-item fields (xp/damage/loaded) are kept
   *  on any new stack created — so re-storing a leveled armor piece, a worn
   *  tool, or a partly-loaded gun preserves that state. */
  add(id: number, count: number, meta?: ItemStack): number {
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
        this.slots[i] = meta ? { ...meta, id, count: take } : { id, count: take };
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

  /** Total count of an item id across storage slots (hotbar + main). */
  countItem(id: number): number {
    let n = 0;
    for (let i = 0; i < INV_SIZE; i++) {
      const s = this.slots[i];
      if (s && s.id === id) n += s.count;
    }
    return n;
  }

  /** Remove up to `n` of an item from storage; returns how many were removed. */
  removeItem(id: number, n: number): number {
    let need = n;
    for (let i = 0; i < INV_SIZE && need > 0; i++) {
      const s = this.slots[i];
      if (!s || s.id !== id) continue;
      const take = Math.min(need, s.count);
      s.count -= take;
      need -= take;
      if (s.count <= 0) this.slots[i] = null;
    }
    if (need < n) this.version++;
    return n - need;
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

  /** Shift-click: chest <-> inventory when a chest is open; otherwise
   *  crafting -> storage, hotbar <-> main. */
  shiftClick(i: number): void {
    const slot = this.slots[i];
    if (!slot) return;
    let to: readonly [number, number];
    if (i >= CHEST_START) to = [0, INV_SIZE];                 // chest -> inventory
    else if (this.chestOpen) to = [CHEST_START, CHEST_START + CHEST_SIZE]; // -> chest
    else if (i >= CRAFT_START) to = [0, INV_SIZE];            // crafting -> storage
    else if (i < HOTBAR_SIZE) to = [HOTBAR_SIZE, INV_SIZE];   // hotbar -> main
    else to = [0, HOTBAR_SIZE];                               // main -> hotbar
    const from = i;
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
      const left = this.add(s.id, s.count, s); // keep xp/damage/loaded metadata
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

  /** Clear carried items + worn armor + cursor (no drops) — used to swap into an
   *  arena kit and back. Leaves chest/craft mirror regions untouched. */
  clearCarried(): void {
    for (let i = 0; i < INV_SIZE; i++) this.slots[i] = null;
    for (let i = ARMOR_START; i < ARMOR_START + ARMOR_SIZE; i++) this.slots[i] = null;
    this.cursor = null;
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

  /** Mirror a chest's 27 contents into the chest slot region (opening it). */
  loadChest(contents: (ItemStack | null)[]): void {
    for (let i = 0; i < CHEST_SIZE; i++) {
      const s = contents[i];
      this.slots[CHEST_START + i] = s ? { ...s } : null;
    }
    this.chestOpen = true;
    this.version++;
  }

  /** Snapshot the chest region without clearing it (for live sync). */
  readChest(): (ItemStack | null)[] {
    const out: (ItemStack | null)[] = [];
    for (let i = 0; i < CHEST_SIZE; i++) {
      const s = this.slots[CHEST_START + i];
      out.push(s ? { ...s } : null);
    }
    return out;
  }

  /** Take the chest contents back out and close it (UI closing). */
  saveChest(): (ItemStack | null)[] {
    const out = this.readChest();
    for (let i = 0; i < CHEST_SIZE; i++) this.slots[CHEST_START + i] = null;
    this.chestOpen = false;
    this.version++;
    return out;
  }

  /** Equip the armor item at slot `i` into its matching armor slot (swapping
   *  out whatever was worn). No-op for non-armor or armor-region slots. */
  tryEquipArmor(i: number): boolean {
    const s = this.slots[i];
    const a = s ? ITEMS[s.id]?.armor : undefined;
    if (!s || !a || i >= ARMOR_START) return false;
    const dest = ARMOR_START + ARMOR_SLOT_INDEX[a.slot];
    this.slots[i] = this.slots[dest]; // the old piece (or null) goes where this was
    this.slots[dest] = s;
    this.version++;
    return true;
  }

  /** Total effective defense points from worn armor (base + per-piece level). */
  armorPoints(): number {
    let total = 0;
    for (let i = ARMOR_START; i < ARMOR_START + ARMOR_SIZE; i++) {
      const s = this.slots[i];
      if (s) total += armorPointsOf(s);
    }
    return total;
  }

  /** Grant XP to every worn piece (called when the player takes a hit). */
  addArmorXp(amount: number): void {
    let changed = false;
    for (let i = ARMOR_START; i < ARMOR_START + ARMOR_SIZE; i++) {
      const s = this.slots[i];
      if (s && ITEMS[s.id]?.armor) { s.xp = (s.xp ?? 0) + amount; changed = true; }
    }
    if (changed) this.version++;
  }

  // --- Persistence (server-stored per-account state) -------------------------
  // Only the carried items (hotbar + main), the worn armor, and the selected
  // hotbar slot persist; the crafting grid and chest-mirror slots are transient.

  serialize(): { slots: (ItemStack | null)[]; armor: (ItemStack | null)[]; selected: number } {
    return {
      slots: this.slots.slice(0, INV_SIZE),
      armor: this.slots.slice(ARMOR_START, ARMOR_START + ARMOR_SIZE),
      selected: this.selected,
    };
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
  return stack;
}
