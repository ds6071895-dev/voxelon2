// Container UI: one panel with three modes — personal inventory (2x2 craft),
// crafting table (3x3), and furnace (input/fuel/output with progress bars).
// Click semantics delegate to the pure Inventory class; furnace slots talk
// to the FurnaceState directly through the shared cursor.

import { BLOCKS } from './blocks';
import { craftResult, consumeCraft } from './crafting';
import { COOK_TIME, FUEL, SMELT, FurnaceState } from './furnace';
import { renderItemIcon } from './icons';
import { iconSvg, setIconText } from './emoji_icons';
import type { Inventory } from './inventory';
import {
  HOTBAR_SIZE, INV_SIZE, CRAFT_START, CHEST_START, CHEST_SIZE,
  ARMOR_START, ARMOR_SIZE,
} from './inventory';
import { ArmorSlot, Item, ITEMS, ItemStack } from './items';
import {
  MachineState, MachineType, UpgradeAxis, MAX_LEVEL, MAX_STORAGE_LEVEL,
  allowedFilterMask, machineMaxHp, storageCap, totalStored, upgradeCost,
} from './machines';
import {
  TurretState, TurretAxis, TURRET_MAX_LEVEL, TURRET_AMMO_CAP, TURRET_FUEL_CAP,
  turretDamage, turretInterval, turretRange, turretUpgradeCost,
} from './turrets';
import { AUTOMINER_ORES } from './terrain';

export type ContainerMode =
  | 'inventory' | 'table' | 'furnace' | 'chest' | 'machine' | 'turret';

/** Callbacks for the turret panel (upgrade / claim / load ammo + fuel). */
export interface TurretUIContext {
  state(): TurretState | null;
  upgrade(axis: TurretAxis): void;
  canAfford(axis: TurretAxis): boolean;
  claim(): void;
  /** Deposit as much of a held item (Cannonball or OilBarrel) as fits. */
  load(item: number): void;
  canLoad(item: number): boolean;
  myName(): string;
}

/** Callbacks the host (main.ts) wires so the machine panel can route actions to
 *  the local sim (offline) or the server (multiplayer). */
export interface MachineUIContext {
  /** Live, authoritative-ish state to render (predicted in MP). */
  state(): MachineState | null;
  /** Current production rate in items/sec, for the readout. */
  rate(): number;
  toggleFilter(index: number): void;
  upgrade(axis: UpgradeAxis): void;
  collect(): void;
  canAfford(axis: UpgradeAxis): boolean;
  /** Claim ownership of the machine (sets owner to the local player). */
  claim(): void;
  /** Arm "move mode": close the panel and let the player right-click a new spot
   *  to relocate the machine (it can't be broken, only moved). */
  move(): void;
  /** The local player's display name (to compare against the owner). */
  myName(): string;
}

interface SlotView {
  el: HTMLDivElement;
  icon: HTMLCanvasElement;
  count: HTMLSpanElement;
  dur: HTMLDivElement;
}

function maxStack(id: number): number {
  return ITEMS[id]?.maxStack ?? 64;
}

/** Short ore name for a filter chip (e.g. "Cobblestone"->"Stone" left as-is). */
function oreLabel(block: number): string {
  return (BLOCKS[block]?.name ?? '?').replace(' Ore', '').replace(' Block', '');
}

export class InventoryUI {
  open = false;
  mode: ContainerMode = 'inventory';
  /** Creative gamemode: the inventory screen shows an all-items palette. */
  creative = false;
  /** Crafted/stashed items that did not fit anywhere (main spills them). */
  onOverflow?: (stacks: ItemStack[]) => void;
  /** Fired when the panel closes (main persists/syncs an open chest here). */
  onClose?: () => void;
  /** Veto a craft result BEFORE it's taken (e.g. a Heart withdrawal at the
   *  2-heart floor). Return false to block; show your own notice. */
  canCraft?: (result: ItemStack) => boolean;
  /** Fired once per successful craft of `result` (e.g. a Heart withdrawal
   *  tells the server to deduct the bottled heart). */
  onCrafted?: (result: ItemStack) => void;
  private chestCells: number[] = [];
  private armorCells: number[] = [];

  private readonly inventory: Inventory;
  private readonly atlasCanvas: HTMLCanvasElement;
  private readonly panel: HTMLDivElement;
  private readonly headerEl: HTMLDivElement;
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
  private machineCtx: MachineUIContext | null = null;
  private machineViews: {
    levels: HTMLDivElement;
    owner: HTMLDivElement;
    hpBar: HTMLDivElement;
    hpText: HTMLSpanElement;
    fillBar: HTMLDivElement;
    fillText: HTMLSpanElement;
    rate: HTMLDivElement;
    filters: { index: number; el: HTMLDivElement }[];
    prodBtn: HTMLButtonElement;
    storageBtn: HTMLButtonElement;
    collectBtn: HTMLButtonElement;
    claimBtn: HTMLButtonElement;
    moveBtn: HTMLButtonElement;
  } | null = null;
  private turretCtx: TurretUIContext | null = null;
  private turretViews: {
    info: HTMLDivElement; owner: HTMLDivElement; hpBar: HTMLDivElement; hpText: HTMLSpanElement;
    ammo: HTMLDivElement;
    rangeBtn: HTMLButtonElement; damageBtn: HTMLButtonElement; rateBtn: HTMLButtonElement;
    loadAmmoBtn: HTMLButtonElement; loadFuelBtn: HTMLButtonElement; claimBtn: HTMLButtonElement;
  } | null = null;
  private readonly cursorEl: HTMLDivElement;
  private readonly cursorIcon: HTMLCanvasElement;
  private readonly cursorCount: HTMLSpanElement;
  private readonly tooltip: HTMLDivElement;
  private renderedVersion = -1;
  private shiftTransferDragging = false;
  private readonly shiftedThisDrag = new Set<number>();
  /** A right-drag deposits one item into each newly crossed ordinary slot. */
  private rightPlaceDragging = false;
  private readonly rightPlacedThisDrag = new Set<number>();
  private hoveredHotbarAction: ((hotbar: number) => boolean) | null = null;

  constructor(inventory: Inventory, atlasCanvas: HTMLCanvasElement) {
    this.inventory = inventory;
    this.atlasCanvas = atlasCanvas;
    const app = document.getElementById('app')!;

    this.panel = document.createElement('div');
    this.panel.id = 'inventory';
    this.headerEl = document.createElement('div');
    this.headerEl.className = 'inv-header';
    this.titleEl = document.createElement('div');
    this.titleEl.className = 'mc-font inv-title';
    this.headerEl.appendChild(this.titleEl);
    this.panel.appendChild(this.headerEl);

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
    document.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.endShiftTransferDrag();
      if (e.button === 2) this.endRightPlaceDrag();
    });
    window.addEventListener('blur', () => {
      this.endShiftTransferDrag();
      this.endRightPlaceDrag();
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
        const runeName = stack.rune !== undefined ? ITEMS[stack.rune]?.name : undefined;
        this.tooltip.innerHTML =
          (ITEMS[stack.id]?.name ?? '') + (runeName ? ` ${iconSvg('sparkle')} ${runeName}` : '');
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

  private hookHotbarAction(view: SlotView, action: (hotbar: number) => boolean): void {
    view.el.addEventListener('mouseenter', () => { this.hoveredHotbarAction = action; });
    view.el.addEventListener('mouseleave', () => {
      if (this.hoveredHotbarAction === action) this.hoveredHotbarAction = null;
    });
  }

  /** Minecraft-style number-key exchange with the hovered slot. */
  hotbarSwap(hotbar: number): boolean {
    if (!this.open || hotbar < 0 || hotbar >= HOTBAR_SIZE) return false;
    return this.hoveredHotbarAction?.(hotbar) ?? false;
  }

  private makeIndexedSlot(index: number): SlotView {
    const view = this.makeSlotView();
    view.el.addEventListener('mousedown', (e) => {
      e.preventDefault();
      if (e.button === 0 && e.shiftKey && this.isChestTransferSlot(index)) {
        this.shiftTransferDragging = true;
        this.shiftedThisDrag.clear();
        this.transferHoveredSlot(index, view);
      }
      else if (e.button === 0 && e.shiftKey) this.inventory.shiftClick(index);
      else if (e.button === 0 && e.detail === 2 && this.inventory.cursor) {
        this.inventory.collectMatching(this.invSlots.keys());
      }
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
        if (this.inventory.cursor) {
          this.rightPlaceDragging = true;
          this.rightPlacedThisDrag.clear();
          this.rightPlacedThisDrag.add(index);
        }
      }
    });
    view.el.addEventListener('mouseenter', (e) => {
      if (this.shiftTransferDragging && e.shiftKey && (e.buttons & 1)) {
        this.transferHoveredSlot(index, view);
      }
      if (this.rightPlaceDragging && (e.buttons & 2)) this.placeOneOnDrag(index);
    });
    this.hookTooltip(view, () => this.inventory.slots[index]);
    this.hookHotbarAction(view, (hotbar) => this.inventory.swapWithHotbar(index, hotbar));
    this.invSlots.set(index, view);
    return view;
  }

  private isChestTransferSlot(index: number): boolean {
    return this.mode === 'chest' && (
      (index >= 0 && index < INV_SIZE) ||
      (index >= CHEST_START && index < CHEST_START + CHEST_SIZE)
    );
  }

  private endShiftTransferDrag(): void {
    this.shiftTransferDragging = false;
    this.shiftedThisDrag.clear();
  }

  private endRightPlaceDrag(): void {
    this.rightPlaceDragging = false;
    this.rightPlacedThisDrag.clear();
  }

  /** One item per slot crossed, covering inventory, chest, and crafting cells. */
  private placeOneOnDrag(index: number): void {
    if (this.rightPlacedThisDrag.has(index) || !this.inventory.cursor) return;
    this.rightPlacedThisDrag.add(index);
    this.inventory.rightClick(index);
    if (!this.inventory.cursor) this.endRightPlaceDrag();
  }

  /** Transfer a newly hovered stack and animate it toward the first slot that
   *  received items. Each slot fires at most once during a drag gesture. */
  private transferHoveredSlot(index: number, source: SlotView): void {
    if (!this.isChestTransferSlot(index) || this.shiftedThisDrag.has(index)) return;
    this.shiftedThisDrag.add(index);
    const stack = this.inventory.slots[index];
    if (!stack) return;
    const itemId = stack.id;
    const destination = index >= CHEST_START
      ? [0, INV_SIZE] as const
      : [CHEST_START, CHEST_START + CHEST_SIZE] as const;
    const before = this.inventory.slots.map((s) => s?.count ?? 0);
    this.inventory.shiftClick(index);
    let target: SlotView | undefined;
    for (let i = destination[0]; i < destination[1]; i++) {
      const now = this.inventory.slots[i];
      if (now?.id === itemId && now.count > before[i]) {
        target = this.invSlots.get(i);
        if (target) break;
      }
    }
    if (target) this.animateTransfer(itemId, source.el, target.el);
  }

  private animateTransfer(itemId: number, from: HTMLElement, to: HTMLElement, delay = 0): void {
    const a = from.getBoundingClientRect();
    const b = to.getBoundingClientRect();
    const icon = document.createElement('canvas');
    icon.width = 32;
    icon.height = 32;
    icon.className = 'inv-transfer-item';
    icon.style.left = `${a.left + (a.width - 32) / 2}px`;
    icon.style.top = `${a.top + (a.height - 32) / 2}px`;
    renderItemIcon(icon, this.atlasCanvas, itemId);
    document.body.appendChild(icon);
    const dx = b.left + (b.width - 32) / 2 - (a.left + (a.width - 32) / 2);
    const dy = b.top + (b.height - 32) / 2 - (a.top + (a.height - 32) / 2);
    const animation = icon.animate([
      { transform: 'translate(0, 0) scale(1)', opacity: 1 },
      { transform: `translate(${dx}px, ${dy}px) scale(.82)`, opacity: .25 },
    ], { duration: 300, delay, easing: 'cubic-bezier(.2,.8,.25,1)' });
    animation.finished.then(() => icon.remove(), () => icon.remove());
  }

  private drawSlot(view: SlotView, stack: ItemStack | null): void {
    if (stack) {
      renderItemIcon(view.icon, this.atlasCanvas, stack.id);
      view.count.textContent = stack.count > 1 ? String(stack.count) : '';
      // Tools and gliders show a durability bar as they wear down.
      const durMax = ITEMS[stack.id]?.tool?.durability ?? ITEMS[stack.id]?.glider?.durability;
      if (durMax && stack.damage) {
        const frac = 1 - stack.damage / durMax;
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
    this.hookHotbarAction(result, (hotbar) => this.craftIntoHotbar(hotbar));
    this.resultView = result;
    wrap.appendChild(result.el);
    parent.appendChild(wrap);
  }

  private craftIntoHotbar(hotbar: number): boolean {
    const result = craftResult(this.inventory);
    if (!result || (this.canCraft && !this.canCraft(result))) return false;
    const target = this.inventory.slots[hotbar];
    if (target && (target.id !== result.id || target.count + result.count > maxStack(result.id))) {
      return false;
    }
    if (target) target.count += result.count;
    else this.inventory.slots[hotbar] = { ...result };
    consumeCraft(this.inventory);
    this.onCrafted?.(result);
    return true;
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

  /** Crafting-table-only workbench. Personal inventory keeps its compact 2x2. */
  private buildTableTop(): void {
    const station = document.createElement('div');
    station.className = 'table-station';
    station.style.cssText = 'display:flex;justify-content:center;';
    const bench = document.createElement('section');
    bench.style.cssText =
      'display:flex;flex-direction:column;align-items:center;justify-content:center;gap:9px;' +
      'padding:14px;border:1px solid #59677d;background:linear-gradient(145deg,#182131,#0e1420);' +
      'box-shadow:inset 0 0 0 1px #0a0e16,0 8px 24px #0007;';
    const label = document.createElement('div');
    label.className = 'mc-font';
    label.style.cssText = 'align-self:stretch;color:#8eddf0;font-size:11px;letter-spacing:1px;text-shadow:none;';
    label.textContent = 'ASSEMBLY GRID  /  3 × 3';
    bench.appendChild(label);
    this.buildCraftingTop(3, bench);

    station.appendChild(bench);
    this.topEl.appendChild(station);
  }

  /** Creative mode: a scrollable palette of every item — click to grab a full
   *  stack (Shift-click for a single). Replaces the crafting grid in creative. */
  private buildCreativeTop(): void {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex;flex-direction:column;gap:5px;align-items:center;';
    const label = document.createElement('div');
    label.className = 'mc-font';
    label.style.cssText = 'font-size:12px;color:#cfe0ff;text-shadow:none;';
    label.textContent = 'Creative — click any item for a stack (Shift = one)';
    // Handing out infinite items needs a way to get rid of them again: the bin
    // destroys whatever you drop on it (a whole stack, or one on right-click),
    // and Shift-clicking it empties the inventory outright.
    const binRow = document.createElement('div');
    binRow.style.cssText = 'display:flex;gap:8px;align-items:center;align-self:flex-end;';
    const binHint = document.createElement('div');
    binHint.className = 'mc-font';
    binHint.style.cssText = 'font-size:11px;color:#9fb2d8;text-shadow:none;text-align:right;';
    binHint.textContent = 'Trash: drop a stack here\nright-click = one · Shift = empty all';
    binHint.style.whiteSpace = 'pre-line';
    binRow.append(binHint, this.makeTrashSlot().el);
    const grid = document.createElement('div');
    grid.style.cssText =
      'display:flex;flex-wrap:wrap;gap:2px;width:536px;max-height:256px;' +
      'overflow-y:auto;padding:5px;background:#0d111b;' +
      'border:2px solid;border-color:#2a3550 #4a5775 #4a5775 #2a3550;';
    const ids = Object.keys(ITEMS).map(Number).filter((id) => ITEMS[id]).sort((a, b) => a - b);
    for (const id of ids) {
      const view = this.makeSlotView();
      renderItemIcon(view.icon, this.atlasCanvas, id);
      this.hookTooltip(view, () => ({ id, count: 1 }));
      view.el.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return; // left-click only
        this.inventory.add(id, e.shiftKey ? 1 : (ITEMS[id].maxStack ?? 64));
        this.inventory.version++;
      });
      grid.appendChild(view.el);
    }
    wrap.appendChild(label);
    wrap.appendChild(grid);
    wrap.appendChild(binRow);
    this.topEl.appendChild(wrap);
  }

  /**
   * The creative trash slot. Left-click destroys the whole held stack,
   * right-click one item off it, and Shift-click (with nothing held) wipes the
   * hotbar + backpack. Nothing here can be recovered, so the sweep asks first.
   */
  private makeTrashSlot(): SlotView {
    const view = this.makeSlotView();
    view.el.classList.add('result-slot');
    view.el.style.position = 'relative';
    view.el.title = 'Trash';
    const glyph = document.createElement('div');
    glyph.className = 'mc-font';
    glyph.style.cssText =
      'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;' +
      'font-size:20px;pointer-events:none;text-shadow:none;';
    glyph.innerHTML = iconSvg('trash');
    view.el.appendChild(glyph);
    view.el.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const inv = this.inventory;
      if (e.button === 0 && e.shiftKey) {
        if (!inv.cursor && !confirm('Destroy every item in your inventory?')) return;
        for (let i = 0; i < INV_SIZE; i++) inv.slots[i] = null;
        inv.cursor = null;
        inv.version++;
        return;
      }
      const held = inv.cursor;
      if (!held) return;
      if (e.button === 0) {
        inv.cursor = null;                                  // the whole stack
      } else if (e.button === 2) {
        held.count--;                                       // one off the top
        if (held.count <= 0) inv.cursor = null;
      } else {
        return;                                             // middle click: no-op
      }
      inv.version++;
    });
    return view;
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
    this.hookHotbarAction(view, (hotbar) => {
      const incoming = this.inventory.slots[hotbar];
      if (incoming && ITEMS[incoming.id]?.armor?.slot !== slot) return false;
      return this.inventory.swapWithHotbar(index, hotbar);
    });
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
    this.hookHotbarAction(view, (hotbar) => {
      const incoming = this.inventory.slots[hotbar];
      if (incoming && !accepts(incoming.id)) return false;
      const previous = get();
      set(incoming);
      this.inventory.slots[hotbar] = previous;
      this.inventory.version++;
      return true;
    });
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
    this.hookHotbarAction(view, (hotbar) => {
      const out = state.output;
      if (!out) return false;
      const target = this.inventory.slots[hotbar];
      if (!target) {
        this.inventory.slots[hotbar] = out;
        state.output = null;
      } else if (target.id === out.id && target.count < maxStack(out.id)) {
        const moved = Math.min(out.count, maxStack(out.id) - target.count);
        target.count += moved;
        out.count -= moved;
        if (out.count <= 0) state.output = null;
      } else return false;
      this.inventory.version++;
      return true;
    });
    return view;
  }

  // --- machine panel ---------------------------------------------------------

  private buildMachineTop(ctx: MachineUIContext): void {
    const state = ctx.state();
    const wrap = document.createElement('div');
    wrap.style.cssText =
      'display:flex;flex-direction:column;gap:8px;width:340px;align-items:stretch;';

    const levels = document.createElement('div');
    levels.className = 'mc-font';
    levels.style.cssText = 'font-size:13px;text-align:center;';
    wrap.appendChild(levels);

    const owner = document.createElement('div');
    owner.className = 'mc-font';
    owner.style.cssText = 'font-size:11px;text-align:center;color:#d8c;';
    wrap.appendChild(owner);

    // Health bar (sabotage/raid).
    const hpOuter = document.createElement('div');
    hpOuter.style.cssText =
      'position:relative;height:14px;background:#1c1c1c;border:2px solid #000;';
    const hpBar = document.createElement('div');
    hpBar.style.cssText = 'height:100%;width:100%;background:#cc4444;';
    const hpText = document.createElement('span');
    hpText.className = 'mc-font';
    hpText.style.cssText =
      'position:absolute;inset:0;display:flex;align-items:center;' +
      'justify-content:center;font-size:10px;text-shadow:none;';
    hpOuter.appendChild(hpBar);
    hpOuter.appendChild(hpText);
    wrap.appendChild(hpOuter);

    // Storage fill bar.
    const barOuter = document.createElement('div');
    barOuter.style.cssText =
      'position:relative;height:18px;background:#1c1c1c;border:2px solid #000;';
    const fillBar = document.createElement('div');
    fillBar.style.cssText = 'height:100%;width:0;background:#4ea3e0;transition:width .1s;';
    const fillText = document.createElement('span');
    fillText.className = 'mc-font';
    fillText.style.cssText =
      'position:absolute;inset:0;display:flex;align-items:center;' +
      'justify-content:center;font-size:11px;text-shadow:none;';
    barOuter.appendChild(fillBar);
    barOuter.appendChild(fillText);
    wrap.appendChild(barOuter);

    const rate = document.createElement('div');
    rate.className = 'mc-font';
    rate.style.cssText = 'font-size:12px;text-align:center;color:#bdf;';
    wrap.appendChild(rate);

    // Ore filter checklist (autominer only).
    const filters: { index: number; el: HTMLDivElement }[] = [];
    if (state && state.type === MachineType.Autominer) {
      const grid = document.createElement('div');
      grid.style.cssText =
        'display:grid;grid-template-columns:repeat(4,1fr);gap:3px;';
      for (let i = 0; i < AUTOMINER_ORES.length; i++) {
        const chip = document.createElement('div');
        chip.className = 'mc-font';
        chip.style.cssText =
          'font-size:10px;text-align:center;padding:3px 2px;border:1px solid #000;' +
          'cursor:pointer;user-select:none;';
        chip.textContent = oreLabel(AUTOMINER_ORES[i]);
        chip.addEventListener('mousedown', (e) => {
          e.preventDefault();
          ctx.toggleFilter(i);
        });
        grid.appendChild(chip);
        filters.push({ index: i, el: chip });
      }
      wrap.appendChild(grid);
    }

    // Upgrade + collect buttons.
    const btnRow = document.createElement('div');
    btnRow.style.cssText = 'display:flex;gap:6px;';
    const mkBtn = (): HTMLButtonElement => {
      const b = document.createElement('button');
      b.className = 'mc-font';
      b.style.cssText =
        'flex:1;font-size:10px;padding:5px 3px;cursor:pointer;border:2px solid #000;' +
        'background:#6a6a6a;color:#fff;';
      b.addEventListener('contextmenu', (e) => e.preventDefault());
      return b;
    };
    const prodBtn = mkBtn();
    prodBtn.addEventListener('mousedown', (e) => { e.preventDefault(); ctx.upgrade('production'); });
    const storageBtn = mkBtn();
    storageBtn.addEventListener('mousedown', (e) => { e.preventDefault(); ctx.upgrade('storage'); });
    btnRow.appendChild(prodBtn);
    btnRow.appendChild(storageBtn);
    wrap.appendChild(btnRow);

    const bottomRow = document.createElement('div');
    bottomRow.style.cssText = 'display:flex;gap:6px;';
    const collectBtn = mkBtn();
    collectBtn.style.background = '#3b7a3b';
    collectBtn.textContent = 'Collect';
    collectBtn.addEventListener('mousedown', (e) => { e.preventDefault(); ctx.collect(); });
    const claimBtn = mkBtn();
    claimBtn.style.background = '#3b5a7a';
    claimBtn.textContent = 'Claim';
    claimBtn.addEventListener('mousedown', (e) => { e.preventDefault(); ctx.claim(); });
    bottomRow.appendChild(collectBtn);
    bottomRow.appendChild(claimBtn);
    wrap.appendChild(bottomRow);

    // Move: machines can't be broken — only relocated. Arms a right-click to
    // re-place the whole rig (keeping its level/storage/filter/stored).
    const moveBtn = mkBtn();
    moveBtn.style.background = '#7a5a3b';
    moveBtn.innerHTML = `${iconSvg('hand')} Move (right-click a new spot)`;
    moveBtn.addEventListener('mousedown', (e) => { e.preventDefault(); ctx.move(); });
    wrap.appendChild(moveBtn);

    this.machineViews = {
      levels, owner, hpBar, hpText, fillBar, fillText, rate, filters,
      prodBtn, storageBtn, collectBtn, claimBtn, moveBtn,
    };
    this.topEl.appendChild(wrap);
  }

  private refreshMachine(): void {
    const ctx = this.machineCtx;
    const v = this.machineViews;
    if (!ctx || !v) return;
    const state = ctx.state();
    if (!state) return;

    v.levels.textContent =
      `${state.type === MachineType.Autominer ? 'Autominer' : 'Oil Derrick'}` +
      `  ·  Prod Lv ${state.level}/${MAX_LEVEL}  ·  Storage Lv ${state.storageLevel}/${MAX_STORAGE_LEVEL}`;

    const mine = state.owner && state.owner === ctx.myName();
    v.owner.textContent = state.owner ? `Owner: ${state.owner}${mine ? ' (you)' : ''}` : 'Unclaimed';
    v.claimBtn.disabled = !!mine;
    v.claimBtn.style.opacity = mine ? '0.5' : '1';
    v.claimBtn.textContent = mine ? 'Owned' : 'Claim';

    const maxHp = machineMaxHp(state);
    const hpFrac = maxHp > 0 ? Math.max(0, Math.min(1, state.hp / maxHp)) : 0;
    v.hpBar.style.width = `${Math.round(hpFrac * 100)}%`;
    v.hpBar.style.background = hpFrac > 0.5 ? '#4caf50' : hpFrac > 0.25 ? '#e0a14e' : '#cc4444';
    v.hpText.textContent = `HP ${Math.ceil(state.hp)} / ${maxHp}`;

    const cap = storageCap(state);
    const stored = totalStored(state);
    const frac = cap > 0 ? Math.min(1, stored / cap) : 0;
    v.fillBar.style.width = `${Math.round(frac * 100)}%`;
    v.fillBar.style.background = frac > 0.92 ? '#e0a14e' : '#4ea3e0';
    v.fillText.textContent = `${stored} / ${cap}`;
    v.rate.textContent = `Rate: ${ctx.rate().toFixed(2)} /s`;

    const mask = allowedFilterMask(state.level);
    for (const { index, el } of v.filters) {
      const gated = !(mask & (1 << index));
      const on = !!(state.filter & (1 << index));
      el.style.opacity = gated ? '0.35' : '1';
      el.style.cursor = gated ? 'not-allowed' : 'pointer';
      el.style.background = gated ? '#333' : on ? '#3b7a3b' : '#555';
      el.style.color = on && !gated ? '#fff' : '#ccc';
    }

    this.setUpgradeBtn(v.prodBtn, ctx, state, 'production',
      state.level >= MAX_LEVEL);
    this.setUpgradeBtn(v.storageBtn, ctx, state, 'storage',
      state.storageLevel >= MAX_STORAGE_LEVEL);
    v.collectBtn.disabled = stored <= 0;
    v.collectBtn.style.opacity = stored <= 0 ? '0.5' : '1';
  }

  private setUpgradeBtn(
    btn: HTMLButtonElement, ctx: MachineUIContext, state: MachineState,
    axis: UpgradeAxis, maxed: boolean
  ): void {
    const label = axis === 'production' ? 'Production' : 'Storage';
    if (maxed) {
      btn.textContent = `${label}: MAX`;
      btn.disabled = true;
      btn.style.opacity = '0.5';
      return;
    }
    const cost = upgradeCost(state, axis);
    const costStr = cost
      ? Object.entries(cost).map(([id, n]) => `${n} ${ITEMS[Number(id)]?.name ?? '?'}`).join(', ')
      : '';
    setIconText(btn, `▲ ${label}\n${costStr}`);
    btn.style.whiteSpace = 'pre-line';
    const afford = ctx.canAfford(axis);
    btn.disabled = !afford;
    btn.style.opacity = afford ? '1' : '0.5';
  }

  // --- turret panel ----------------------------------------------------------

  private warBtn(): HTMLButtonElement {
    const b = document.createElement('button');
    b.className = 'mc-font war-btn';
    b.addEventListener('contextmenu', (e) => e.preventDefault());
    return b;
  }

  private buildTurretTop(ctx: TurretUIContext): void {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex;flex-direction:column;gap:8px;width:340px;';
    const info = document.createElement('div');
    info.className = 'mc-font';
    info.style.cssText = 'font-size:12px;text-align:center;';
    const owner = document.createElement('div');
    owner.className = 'mc-font';
    owner.style.cssText = 'font-size:11px;text-align:center;color:#d8c;';
    wrap.append(info, owner);

    const hpOuter = document.createElement('div');
    hpOuter.style.cssText = 'position:relative;height:14px;background:#1c1c1c;border:2px solid #000;';
    const hpBar = document.createElement('div');
    hpBar.style.cssText = 'height:100%;width:100%;background:#cc4444;';
    const hpText = document.createElement('span');
    hpText.className = 'mc-font';
    hpText.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;' +
      'justify-content:center;font-size:10px;text-shadow:none;';
    hpOuter.appendChild(hpBar); hpOuter.appendChild(hpText);
    wrap.appendChild(hpOuter);

    const ammo = document.createElement('div');
    ammo.className = 'mc-font';
    ammo.style.cssText = 'font-size:11px;text-align:center;color:#bdf;';
    wrap.appendChild(ammo);

    const upRow = document.createElement('div');
    upRow.style.cssText = 'display:flex;gap:6px;';
    const rangeBtn = this.warBtn();
    rangeBtn.addEventListener('mousedown', (e) => { e.preventDefault(); ctx.upgrade('range'); });
    const damageBtn = this.warBtn();
    damageBtn.addEventListener('mousedown', (e) => { e.preventDefault(); ctx.upgrade('damage'); });
    const rateBtn = this.warBtn();
    rateBtn.addEventListener('mousedown', (e) => { e.preventDefault(); ctx.upgrade('rate'); });
    upRow.append(rangeBtn, damageBtn, rateBtn);
    wrap.appendChild(upRow);

    const loadRow = document.createElement('div');
    loadRow.style.cssText = 'display:flex;gap:6px;';
    const loadAmmoBtn = this.warBtn();
    loadAmmoBtn.style.background = '#3b7a3b';
    loadAmmoBtn.addEventListener('mousedown', (e) => { e.preventDefault(); ctx.load(Item.Cannonball); });
    const loadFuelBtn = this.warBtn();
    loadFuelBtn.style.background = '#7a6a3b';
    loadFuelBtn.addEventListener('mousedown', (e) => { e.preventDefault(); ctx.load(Item.OilBarrel); });
    const claimBtn = this.warBtn();
    claimBtn.style.background = '#3b5a7a';
    claimBtn.addEventListener('mousedown', (e) => { e.preventDefault(); ctx.claim(); });
    loadRow.append(loadAmmoBtn, loadFuelBtn, claimBtn);
    wrap.appendChild(loadRow);

    this.turretViews = {
      info, owner, hpBar, hpText, ammo,
      rangeBtn, damageBtn, rateBtn, loadAmmoBtn, loadFuelBtn, claimBtn,
    };
    this.topEl.appendChild(wrap);
  }

  private refreshTurret(): void {
    const ctx = this.turretCtx, v = this.turretViews;
    if (!ctx || !v) return;
    const s = ctx.state();
    if (!s) return;
    v.info.textContent =
      `Turret  ·  Rng ${turretRange(s.level).toFixed(0)}  ·  ` +
      `Dmg ${turretDamage(s.level).toFixed(0)}  ·  ${(1 / turretInterval(s.level)).toFixed(1)}/s`;
    const mine = s.owner && s.owner === ctx.myName();
    v.owner.textContent = s.owner ? `Owner: ${s.owner}${mine ? ' (you)' : ''}` : 'Unclaimed (inert)';
    v.claimBtn.disabled = !!mine;
    v.claimBtn.style.opacity = mine ? '0.5' : '1';
    v.claimBtn.textContent = mine ? 'Owned' : 'Claim';
    const frac = s.maxHp > 0 ? Math.max(0, Math.min(1, s.hp / s.maxHp)) : 0;
    v.hpBar.style.width = `${Math.round(frac * 100)}%`;
    v.hpBar.style.background = frac > 0.5 ? '#4caf50' : frac > 0.25 ? '#e0a14e' : '#cc4444';
    v.hpText.textContent = `HP ${Math.ceil(s.hp)} / ${s.maxHp}`;
    v.ammo.textContent = `Ammo ${s.ammo} / ${TURRET_AMMO_CAP}   ·   Oil ${s.fuel.toFixed(1)} / ${TURRET_FUEL_CAP}`;
    this.setTurretBtn(v.rangeBtn, ctx, s, 'range', 'Range');
    this.setTurretBtn(v.damageBtn, ctx, s, 'damage', 'Damage');
    this.setTurretBtn(v.rateBtn, ctx, s, 'rate', 'Rate');
    const canA = ctx.canLoad(Item.Cannonball);
    v.loadAmmoBtn.textContent = 'Load Ammo';
    v.loadAmmoBtn.disabled = !canA; v.loadAmmoBtn.style.opacity = canA ? '1' : '0.5';
    const canF = ctx.canLoad(Item.OilBarrel);
    v.loadFuelBtn.textContent = 'Load Oil';
    v.loadFuelBtn.disabled = !canF; v.loadFuelBtn.style.opacity = canF ? '1' : '0.5';
  }

  private setTurretBtn(
    btn: HTMLButtonElement, ctx: TurretUIContext, s: TurretState, axis: TurretAxis, label: string
  ): void {
    if (s.level[axis] >= TURRET_MAX_LEVEL) {
      btn.textContent = `${label}: MAX`; btn.disabled = true; btn.style.opacity = '0.5'; return;
    }
    const cost = turretUpgradeCost(s, axis);
    const costStr = cost
      ? Object.entries(cost).map(([id, n]) => `${n} ${ITEMS[Number(id)]?.name ?? '?'}`).join(', ') : '';
    setIconText(btn, `▲ ${label} ${s.level[axis]}\n${costStr}`);
    btn.style.whiteSpace = 'pre-line';
    const afford = ctx.canAfford(axis);
    btn.disabled = !afford; btn.style.opacity = afford ? '1' : '0.5';
  }

  // --- crafting result -------------------------------------------------------

  private craftOnce(): void {
    const inv = this.inventory;
    const r = craftResult(inv);
    if (!r) return;
    if (this.canCraft && !this.canCraft(r)) return;
    if (!inv.cursor) {
      inv.cursor = r;
    } else if (inv.cursor.id === r.id && inv.cursor.count + r.count <= maxStack(r.id)) {
      inv.cursor.count += r.count;
    } else {
      return;
    }
    consumeCraft(inv);
    this.onCrafted?.(r);
  }

  private craftAll(): void {
    const inv = this.inventory;
    const overflow: ItemStack[] = [];
    for (let guard = 0; guard < 256; guard++) {
      const r = craftResult(inv);
      if (!r) break;
      if (this.canCraft && !this.canCraft(r)) break;
      consumeCraft(inv);
      this.onCrafted?.(r);
      const left = inv.add(r.id, r.count);
      if (left > 0) {
        overflow.push({ id: r.id, count: left });
        break;
      }
    }
    if (overflow.length) this.onOverflow?.(overflow);
  }

  // --- open/close/update -----------------------------------------------------

  show(
    mode: ContainerMode, furnace?: FurnaceState, machineCtx?: MachineUIContext,
    turretCtx?: TurretUIContext,
  ): void {
    // Rebuild the top section for the requested mode.
    this.hoveredHotbarAction = null;
    for (const { index } of this.craftCells) this.invSlots.delete(index);
    for (const idx of this.chestCells) this.invSlots.delete(idx);
    for (const idx of this.armorCells) this.invSlots.delete(idx);
    this.craftCells = [];
    this.chestCells = [];
    this.armorCells = [];
    this.resultView = null;
    this.furnaceViews = null;
    this.furnace = furnace ?? null;
    this.machineViews = null;
    this.machineCtx = machineCtx ?? null;
    this.turretViews = null;
    this.turretCtx = turretCtx ?? null;
    this.topEl.innerHTML = '';
    while (this.headerEl.lastElementChild !== this.titleEl) {
      this.headerEl.lastElementChild?.remove();
    }
    this.mode = mode;
    if (mode === 'turret' && turretCtx) {
      this.titleEl.textContent = 'Turret';
      this.buildTurretTop(turretCtx);
    } else if (mode === 'machine' && machineCtx) {
      const s = machineCtx.state();
      this.titleEl.textContent =
        s && s.type === MachineType.OilDerrick ? 'Oil Derrick' : 'Autominer';
      this.buildMachineTop(machineCtx);
    } else if (mode === 'furnace' && furnace) {
      this.titleEl.textContent = 'Furnace';
      this.buildFurnaceTop(furnace);
    } else if (mode === 'chest') {
      this.titleEl.textContent = 'Chest';
      this.buildChestTop();
    } else if (mode === 'table') {
      this.titleEl.textContent = 'Crafting Workbench';
      this.buildTableTop();
    } else if (this.creative) {
      this.titleEl.textContent = 'Creative Inventory';
      this.buildCreativeTop();
    } else {
      this.titleEl.textContent = 'Inventory';
      this.buildInventoryTop();
    }
    this.open = true;
    this.panel.style.display = 'flex';
    this.renderedVersion = -1;
  }

  private buildChestTop(): void {
    const wrap = document.createElement('div');
    wrap.className = 'chest-layout';
    const sort = document.createElement('button');
    sort.type = 'button';
    sort.className = 'war-btn chest-sort-btn mc-font';
    sort.textContent = 'Sort Items';
    sort.addEventListener('click', () => {
      const before = this.inventory.readChest();
      this.inventory.sortChest();
      this.animateChestSort(before);
    });
    this.headerEl.appendChild(sort);
    const grid = document.createElement('div');
    grid.className = 'inv-grid';
    for (let i = 0; i < CHEST_SIZE; i++) {
      const index = CHEST_START + i;
      grid.appendChild(this.makeIndexedSlot(index).el);
      this.chestCells.push(index);
    }
    wrap.appendChild(grid);
    this.topEl.appendChild(wrap);
  }

  /** Animate source stacks into their compacted, alphabetized chest slots. */
  private animateChestSort(before: (ItemStack | null)[]): void {
    type Portion = { index: number; count: number };
    const sources = new Map<string, Portion[]>();
    const keyOf = (stack: ItemStack) => JSON.stringify({ ...stack, count: 0 });
    before.forEach((stack, index) => {
      if (!stack) return;
      const key = keyOf(stack);
      const list = sources.get(key) ?? [];
      list.push({ index, count: stack.count });
      sources.set(key, list);
    });
    for (let target = 0; target < CHEST_SIZE; target++) {
      const stack = this.inventory.slots[CHEST_START + target];
      if (!stack) continue;
      let remaining = stack.count;
      const list = sources.get(keyOf(stack)) ?? [];
      while (remaining > 0 && list.length) {
        const source = list[0];
        const moved = Math.min(remaining, source.count);
        source.count -= moved;
        remaining -= moved;
        if (source.index !== target) {
          const from = this.invSlots.get(CHEST_START + source.index);
          const to = this.invSlots.get(CHEST_START + target);
          if (from && to) this.animateTransfer(stack.id, from.el, to.el, 80 + target * 18);
        }
        if (source.count === 0) list.shift();
      }
    }
  }

  hide(): void {
    if (!this.open) return;
    this.endShiftTransferDrag();
    this.endRightPlaceDrag();
    this.hoveredHotbarAction = null;
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

    // Machine panel refreshes every frame (live fill bar + rate, like furnace).
    if (this.mode === 'machine') this.refreshMachine();
    if (this.mode === 'turret') this.refreshTurret();

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
