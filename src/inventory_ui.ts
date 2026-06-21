// Container UI: one panel with three modes — personal inventory (2x2 craft),
// crafting table (3x3), and furnace (input/fuel/output with progress bars).
// Click semantics delegate to the pure Inventory class; furnace slots talk
// to the FurnaceState directly through the shared cursor.

import { craftResult, consumeCraft } from './crafting';
import { COOK_TIME, FUEL, SMELT, FurnaceState } from './furnace';
import { renderItemIcon } from './icons';
import type { Inventory } from './inventory';
import {
  HOTBAR_SIZE, INV_SIZE, CRAFT_START, CHEST_START, CHEST_SIZE,
  ARMOR_START, ARMOR_SIZE,
} from './inventory';
import { ArmorSlot, ITEMS, ItemStack } from './items';

export type ContainerMode = 'inventory' | 'table' | 'furnace' | 'chest';

interface SlotView {
  el: HTMLDivElement;
  icon: HTMLCanvasElement;
  count: HTMLSpanElement;
  dur: HTMLDivElement;
}

function maxStack(id: number): number {
  return ITEMS[id]?.maxStack ?? 64;
}

export class InventoryUI {
  open = false;
  mode: ContainerMode = 'inventory';
  /** Crafted/stashed items that did not fit anywhere (main spills them). */
  onOverflow?: (stacks: ItemStack[]) => void;
  /** Fired when the panel closes (main persists/syncs an open chest here). */
  onClose?: () => void;
  private chestCells: number[] = [];
  private armorCells: number[] = [];

  private readonly inventory: Inventory;
  private readonly atlasCanvas: HTMLCanvasElement;
  private readonly panel: HTMLDivElement;
  private readonly titleEl: HTMLDivElement;
  private readonly topEl: HTMLDivElement;
  private readonly invSlots = new Map<number, SlotView>();
  private craftCells: { index: number; view: SlotView }[] = [];
  private resultView: SlotView | null = null;
  private furnace: FurnaceState | null = null;
  private furnaceViews: {
    input: SlotView; fuel: SlotView; output: SlotView;
    flame: HTMLDivElement; arrow: HTMLDivElement;
  } | null = null;
  private readonly cursorEl: HTMLDivElement;
  private readonly cursorIcon: HTMLCanvasElement;
  private readonly cursorCount: HTMLSpanElement;
  private readonly tooltip: HTMLDivElement;
  private renderedVersion = -1;

  constructor(inventory: Inventory, atlasCanvas: HTMLCanvasElement) {
    this.inventory = inventory;
    this.atlasCanvas = atlasCanvas;
    const app = document.getElementById('app')!;

    this.panel = document.createElement('div');
    this.panel.id = 'inventory';
    this.titleEl = document.createElement('div');
    this.titleEl.className = 'mc-font inv-title';
    this.panel.appendChild(this.titleEl);

    this.topEl = document.createElement('div');
    this.topEl.className = 'inv-top';
    this.panel.appendChild(this.topEl);

    const main = document.createElement('div');
    main.className = 'inv-grid';
    for (let i = HOTBAR_SIZE; i < INV_SIZE; i++) {
      main.appendChild(this.makeIndexedSlot(i).el);
    }
    this.panel.appendChild(main);

    const hotbarRow = document.createElement('div');
    hotbarRow.className = 'inv-grid inv-hotbar';
    for (let i = 0; i < HOTBAR_SIZE; i++) {
      hotbarRow.appendChild(this.makeIndexedSlot(i).el);
    }
    this.panel.appendChild(hotbarRow);

    this.panel.addEventListener('contextmenu', (e) => e.preventDefault());
    app.appendChild(this.panel);

    this.cursorEl = document.createElement('div');
    this.cursorEl.id = 'cursor-stack';
    this.cursorIcon = document.createElement('canvas');
    this.cursorIcon.width = 32;
    this.cursorIcon.height = 32;
    this.cursorCount = document.createElement('span');
    this.cursorCount.className = 'count mc-font';
    this.cursorEl.appendChild(this.cursorIcon);
    this.cursorEl.appendChild(this.cursorCount);
    app.appendChild(this.cursorEl);

    this.tooltip = document.createElement('div');
    this.tooltip.id = 'tooltip';
    this.tooltip.className = 'mc-font';
    app.appendChild(this.tooltip);

    document.addEventListener('mousemove', (e) => {
      if (!this.open) return;
      this.cursorEl.style.left = `${e.clientX - 16}px`;
      this.cursorEl.style.top = `${e.clientY - 16}px`;
      this.tooltip.style.left = `${e.clientX + 14}px`;
      this.tooltip.style.top = `${e.clientY - 6}px`;
    });
  }

  // --- slot construction -----------------------------------------------------

  private makeSlotView(): SlotView {
    const el = document.createElement('div');
    el.className = 'slot inv-slot';
    const icon = document.createElement('canvas');
    icon.width = 32;
    icon.height = 32;
    const count = document.createElement('span');
    count.className = 'count mc-font';
    const dur = document.createElement('div');
    dur.className = 'durbar';
    el.appendChild(icon);
    el.appendChild(count);
    el.appendChild(dur);
    return { el, icon, count, dur };
  }

  private hookTooltip(view: SlotView, getStack: () => ItemStack | null): void {
    view.el.addEventListener('mousemove', (e) => {
      const stack = getStack();
      if (stack && !this.inventory.cursor) {
        this.tooltip.textContent = ITEMS[stack.id]?.name ?? '';
        this.tooltip.style.display = 'block';
        this.tooltip.style.left = `${e.clientX + 14}px`;
        this.tooltip.style.top = `${e.clientY - 6}px`;
      } else {
        this.tooltip.style.display = 'none';
      }
    });
    view.el.addEventListener('mouseleave', () => {
      this.tooltip.style.display = 'none';
    });
  }

  private makeIndexedSlot(index: number): SlotView {
    const view = this.makeSlotView();
    view.el.addEventListener('mousedown', (e) => {
      e.preventDefault();
      if (e.button === 0 && e.shiftKey) this.inventory.shiftClick(index);
      else if (e.button === 0) this.inventory.leftClick(index);
      else if (e.button === 2) {
        // Right-click an armor item (empty cursor) to auto-equip it; otherwise
        // the usual take-half/place-one split.
        const s = this.inventory.slots[index];
        if (!this.inventory.cursor && s && ITEMS[s.id]?.armor && index < ARMOR_START) {
          this.inventory.tryEquipArmor(index);
        } else {
          this.inventory.rightClick(index);
        }
      }
    });
    this.hookTooltip(view, () => this.inventory.slots[index]);
    this.invSlots.set(index, view);
    return view;
  }

  private drawSlot(view: SlotView, stack: ItemStack | null): void {
    if (stack) {
      renderItemIcon(view.icon, this.atlasCanvas, stack.id);
      view.count.textContent = stack.count > 1 ? String(stack.count) : '';
      const tool = ITEMS[stack.id]?.tool;
      if (tool && stack.damage) {
        const frac = 1 - stack.damage / tool.durability;
        view.dur.style.display = 'block';
        view.dur.style.width = `${Math.max(2, Math.round(frac * 32))}px`;
        view.dur.style.background = frac > 0.5 ? '#5fe552' : frac > 0.25 ? '#e5c452' : '#e55252';
      } else {
        view.dur.style.display = 'none';
      }
    } else {
      view.icon.getContext('2d')!.clearRect(0, 0, 32, 32);
      view.count.textContent = '';
      view.dur.style.display = 'none';
    }
  }

  // --- mode layouts ----------------------------------------------------------

  private buildCraftingTop(size: 2 | 3, parent: HTMLElement = this.topEl): void {
    this.craftCells = [];
    const wrap = document.createElement('div');
    wrap.className = 'craft-row';
    const grid = document.createElement('div');
    grid.style.display = 'grid';
    grid.style.gridTemplateColumns = `repeat(${size}, 48px)`;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const index = CRAFT_START + y * 3 + x; // 2x2 uses the 3x3's corner
        const view = this.makeIndexedSlot(index);
        this.craftCells.push({ index, view });
        grid.appendChild(view.el);
      }
    }
    wrap.appendChild(grid);
    wrap.appendChild(this.makeArrow('craft-arrow'));

    const result = this.makeSlotView();
    result.el.classList.add('result-slot');
    result.el.addEventListener('mousedown', (e) => {
      e.preventDefault();
      if (e.button === 0 && e.shiftKey) this.craftAll();
      else if (e.button === 0) this.craftOnce();
    });
    this.hookTooltip(result, () => craftResult(this.inventory));
    this.resultView = result;
    wrap.appendChild(result.el);
    parent.appendChild(wrap);
  }

  /** Inventory mode: a 4-slot armor column beside the 2x2 crafting grid. */
  private buildInventoryTop(): void {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:44px;align-items:center;';
    const col = document.createElement('div');
    col.style.cssText = 'display:flex;flex-direction:column;gap:4px;';
    const SLOTS: ArmorSlot[] = ['helmet', 'chestplate', 'leggings', 'boots'];
    for (let i = 0; i < ARMOR_SIZE; i++) {
      const index = ARMOR_START + i;
      col.appendChild(this.makeArmorSlot(SLOTS[i], index).el);
      this.armorCells.push(index);
    }
    row.appendChild(col);
    this.buildCraftingTop(2, row);
    this.topEl.appendChild(row);
  }

  /** Armor slot: holds only the matching piece; click to equip/unequip. */
  private makeArmorSlot(slot: ArmorSlot, index: number): SlotView {
    const view = this.makeSlotView();
    view.el.classList.add('armor-slot');
    view.el.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const inv = this.inventory;
      if (e.button === 0 && e.shiftKey) { inv.shiftClick(index); return; }
      if (e.button !== 0) return;
      const cur = inv.cursor;
      if (!cur) {
        if (inv.slots[index]) { inv.cursor = inv.slots[index]; inv.slots[index] = null; inv.version++; }
      } else if (ITEMS[cur.id]?.armor?.slot === slot) {
        const prev = inv.slots[index];
        inv.slots[index] = cur;
        inv.cursor = prev; // swap out whatever was worn (null if empty)
        inv.version++;
      }
    });
    this.hookTooltip(view, () => this.inventory.slots[index]);
    this.invSlots.set(index, view);
    return view;
  }

  private buildFurnaceTop(state: FurnaceState): void {
    const wrap = document.createElement('div');
    wrap.className = 'craft-row';

    const left = document.createElement('div');
    left.style.display = 'flex';
    left.style.flexDirection = 'column';
    left.style.alignItems = 'center';
    left.style.gap = '4px';
    const input = this.makeFurnaceSlot(
      () => state.input, (s) => { state.input = s; },
      (id) => SMELT[id] !== undefined
    );
    const flame = document.createElement('div');
    flame.className = 'flame';
    const flameFill = document.createElement('div');
    flame.appendChild(flameFill);
    const fuel = this.makeFurnaceSlot(
      () => state.fuel, (s) => { state.fuel = s; },
      (id) => FUEL[id] !== undefined
    );
    left.appendChild(input.el);
    left.appendChild(flame);
    left.appendChild(fuel.el);
    wrap.appendChild(left);

    const arrow = this.makeArrow('craft-arrow');
    wrap.appendChild(arrow);

    const output = this.makeFurnaceOutputSlot(state);
    output.el.classList.add('result-slot');
    wrap.appendChild(output.el);

    this.furnaceViews = {
      input, fuel, output,
      flame: flameFill, arrow: arrow.firstChild as HTMLDivElement,
    };
    this.topEl.appendChild(wrap);
  }

  private makeArrow(cls: string): HTMLDivElement {
    const arrow = document.createElement('div');
    arrow.className = cls;
    const fill = document.createElement('div');
    arrow.appendChild(fill);
    return arrow;
  }

  /** Cursor <-> furnace input/fuel slot with vanilla click semantics. */
  private makeFurnaceSlot(
    get: () => ItemStack | null,
    set: (s: ItemStack | null) => void,
    accepts: (id: number) => boolean
  ): SlotView {
    const view = this.makeSlotView();
    view.el.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const inv = this.inventory;
      const slot = get();
      if (e.button === 0 && e.shiftKey) {
        if (slot) {
          const left = inv.add(slot.id, slot.count);
          set(left > 0 ? { ...slot, count: left } : null);
        }
      } else if (e.button === 0) {
        if (!inv.cursor) {
          set(null);
          inv.cursor = slot;
        } else if (!accepts(inv.cursor.id)) {
          return;
        } else if (!slot) {
          set(inv.cursor);
          inv.cursor = null;
        } else if (slot.id === inv.cursor.id) {
          const take = Math.min(inv.cursor.count, maxStack(slot.id) - slot.count);
          slot.count += take;
          inv.cursor.count -= take;
          if (inv.cursor.count <= 0) inv.cursor = null;
        } else {
          set(inv.cursor);
          inv.cursor = slot;
        }
      } else if (e.button === 2 && inv.cursor && accepts(inv.cursor.id)) {
        if (!slot) set({ id: inv.cursor.id, count: 1 });
        else if (slot.id === inv.cursor.id && slot.count < maxStack(slot.id)) slot.count += 1;
        else return;
        inv.cursor.count -= 1;
        if (inv.cursor.count <= 0) inv.cursor = null;
      }
      inv.version++;
    });
    this.hookTooltip(view, get);
    return view;
  }

  /** Output slot: take-only. */
  private makeFurnaceOutputSlot(state: FurnaceState): SlotView {
    const view = this.makeSlotView();
    view.el.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const inv = this.inventory;
      const out = state.output;
      if (!out) return;
      if (e.button === 0 && e.shiftKey) {
        const left = inv.add(out.id, out.count);
        state.output = left > 0 ? { ...out, count: left } : null;
      } else if (e.button === 0) {
        if (!inv.cursor) {
          inv.cursor = out;
          state.output = null;
        } else if (
          inv.cursor.id === out.id &&
          inv.cursor.count + out.count <= maxStack(out.id)
        ) {
          inv.cursor.count += out.count;
          state.output = null;
        }
      }
      inv.version++;
    });
    this.hookTooltip(view, () => state.output);
    return view;
  }

  // --- crafting result -------------------------------------------------------

  private craftOnce(): void {
    const inv = this.inventory;
    const r = craftResult(inv);
    if (!r) return;
    if (!inv.cursor) {
      inv.cursor = r;
    } else if (inv.cursor.id === r.id && inv.cursor.count + r.count <= maxStack(r.id)) {
      inv.cursor.count += r.count;
    } else {
      return;
    }
    consumeCraft(inv);
  }

  private craftAll(): void {
    const inv = this.inventory;
    const overflow: ItemStack[] = [];
    for (let guard = 0; guard < 256; guard++) {
      const r = craftResult(inv);
      if (!r) break;
      consumeCraft(inv);
      const left = inv.add(r.id, r.count);
      if (left > 0) {
        overflow.push({ id: r.id, count: left });
        break;
      }
    }
    if (overflow.length) this.onOverflow?.(overflow);
  }

  // --- open/close/update -----------------------------------------------------

  show(mode: ContainerMode, furnace?: FurnaceState): void {
    // Rebuild the top section for the requested mode.
    for (const { index } of this.craftCells) this.invSlots.delete(index);
    for (const idx of this.chestCells) this.invSlots.delete(idx);
    for (const idx of this.armorCells) this.invSlots.delete(idx);
    this.craftCells = [];
    this.chestCells = [];
    this.armorCells = [];
    this.resultView = null;
    this.furnaceViews = null;
    this.furnace = furnace ?? null;
    this.topEl.innerHTML = '';
    this.mode = mode;
    if (mode === 'furnace' && furnace) {
      this.titleEl.textContent = 'Furnace';
      this.buildFurnaceTop(furnace);
    } else if (mode === 'chest') {
      this.titleEl.textContent = 'Chest';
      this.buildChestTop();
    } else if (mode === 'table') {
      this.titleEl.textContent = 'Crafting';
      this.buildCraftingTop(3);
    } else {
      this.titleEl.textContent = 'Inventory';
      this.buildInventoryTop();
    }
    this.open = true;
    this.panel.style.display = 'flex';
    this.renderedVersion = -1;
  }

  private buildChestTop(): void {
    const grid = document.createElement('div');
    grid.className = 'inv-grid';
    for (let i = 0; i < CHEST_SIZE; i++) {
      const index = CHEST_START + i;
      grid.appendChild(this.makeIndexedSlot(index).el);
      this.chestCells.push(index);
    }
    this.topEl.appendChild(grid);
  }

  hide(): void {
    if (!this.open) return;
    this.open = false;
    const overflow = this.inventory.stashOpenSlots();
    if (overflow.length) this.onOverflow?.(overflow);
    this.panel.style.display = 'none';
    this.cursorEl.style.display = 'none';
    this.tooltip.style.display = 'none';
    this.onClose?.();
  }

  /** Redraw on inventory changes; furnace bars refresh every frame. */
  update(): void {
    if (!this.open) return;

    if (this.mode === 'furnace' && this.furnace) {
      const s = this.furnace;
      this.drawSlot(this.furnaceViews!.input, s.input);
      this.drawSlot(this.furnaceViews!.fuel, s.fuel);
      this.drawSlot(this.furnaceViews!.output, s.output);
      const burn = s.burnTotal > 0 ? s.burnTime / s.burnTotal : 0;
      this.furnaceViews!.flame.style.height = `${Math.round(burn * 100)}%`;
      this.furnaceViews!.arrow.style.width =
        `${Math.round((s.cookTime / COOK_TIME) * 100)}%`;
    }

    if (this.inventory.version === this.renderedVersion) return;
    this.renderedVersion = this.inventory.version;

    for (const [index, view] of this.invSlots) {
      this.drawSlot(view, this.inventory.slots[index]);
    }
    if (this.resultView) this.drawSlot(this.resultView, craftResult(this.inventory));

    const cur = this.inventory.cursor;
    if (cur) {
      renderItemIcon(this.cursorIcon, this.atlasCanvas, cur.id);
      this.cursorCount.textContent = cur.count > 1 ? String(cur.count) : '';
      this.cursorEl.style.display = 'block';
    } else {
      this.cursorEl.style.display = 'none';
    }
  }
}
