import './machine_ui.css';
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
import { ArmorSlot, creativePaletteIds, Item, ITEMS, ItemStack } from './items';
import {
  MachineState, MachineType, UpgradeAxis, MachineAct, MAX_LEVEL, MAX_STORAGE_LEVEL,
  allowedFilterMask, machineMaxHp, storageCap, totalStored, upgradeCost,
  machineRank, productionRate, focusMultiplier, YieldContext,
  MAX_DEPTH, ORE_DEPTH, maxDepth, rankDepth, BIT_NAMES, BIT_DEPTH, BIT_DURABILITY,
  FUEL_CAP, JAM_HEAT, fuelRoom, bitTier, veinFactor, WellPhase, WELL_DEPTH,
  REFINE_NAMES, gusherChance, OIL_THRESHOLD, actCost, FUEL_LINK_RADIUS,
  machineFriendly, VENT_HULL_FRACTION,
} from './machines';
import {
  TurretState, TurretAxis, TURRET_MAX_LEVEL, TURRET_AMMO_CAP, TURRET_FUEL_CAP,
  turretDamage, turretInterval, turretRange, turretUpgradeCost, turretDisabled,
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
  /** Unowned, ours/our faction's, or an enemy turret knocked offline (hack). */
  canClaim(): boolean;
  /** Deposit as much of a held item (Cannonball or OilBarrel) as fits. */
  load(item: number): void;
  canLoad(item: number): boolean;
  /** Arm relocation: close the panel and let the player carry it elsewhere. */
  move(): void;
  canMove(): boolean;
  myName(): string;
}

/** Callbacks the host (main.ts) wires so the machine panel can route actions to
 *  the local sim (offline) or the server (multiplayer). */
export interface MachineUIContext {
  /** Live, authoritative-ish state to render (predicted in MP). */
  state(): MachineState | null;
  /** Current production rate in items/sec, for the readout. */
  rate(): number;
  context(): YieldContext;
  configureFilter(mask: number): void;
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
  /** The local player's faction (allies may operate a claimed rig). */
  myFaction(): number;
  /** Hands-on operation (fuel, bit, overdrive, coolant, vent, cap, smother,
   *  inject, refine). The host pays any item cost and routes it. */
  act(act: MachineAct, n: number, item: number): void;
  /** 9×9 prospecting grid (row-major, centre = this rig), each 0..1. */
  survey(): number[];
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

interface MachineViews {
  levels: HTMLDivElement; owner: HTMLDivElement; status: HTMLDivElement;
  ranks: HTMLDivElement[];
  hpBar: HTMLDivElement; hpText: HTMLSpanElement;
  fillBar: HTMLDivElement; fillText: HTMLSpanElement; rate: HTMLDivElement;
  hint: HTMLDivElement; output: HTMLDivElement; outputKey: string;
  filters: { index: number; el: HTMLButtonElement }[];
  prodBtn: HTMLButtonElement; storageBtn: HTMLButtonElement;
  collectBtn: HTMLButtonElement; claimBtn: HTMLButtonElement; moveBtn: HTMLButtonElement;
  /** Bore / well column: head marker + readout. */
  shaftHead: HTMLDivElement; shaftFill: HTMLDivElement; shaftText: HTMLDivElement;
  gauges: { bar: HTMLDivElement; text: HTMLSpanElement; box: HTMLDivElement }[];
  ops: { el: HTMLButtonElement; update: (s: MachineState) => void }[];
  refine: HTMLButtonElement[];
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
  /**
   * Set before `show('chest')` to open the chest panel on something that is not
   * a chest: a different title, and — for a container deeper than one grid —
   * a page strip across the header.
   *
   * The panel never holds more than one page: `onPage` hands the page change
   * back to the owner, which flushes what is on screen and re-opens on the page
   * asked for. That keeps this class ignorant of what it is paging through and
   * keeps a write scoped to one page. (Nothing pages today: its only user was
   * the removed faction hoard.)
   */
  chestPager: {
    title: string; pages: number; page: number; onPage: (page: number) => void;
  } | null = null;
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
  private machineViews: MachineViews | null = null;
  private turretCtx: TurretUIContext | null = null;
  private turretViews: {
    info: HTMLDivElement; owner: HTMLDivElement; hpBar: HTMLDivElement; hpText: HTMLSpanElement;
    ammo: HTMLDivElement;
    rangeBtn: HTMLButtonElement; damageBtn: HTMLButtonElement; rateBtn: HTMLButtonElement;
    loadAmmoBtn: HTMLButtonElement; loadFuelBtn: HTMLButtonElement; claimBtn: HTMLButtonElement;
    moveBtn: HTMLButtonElement;
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
    const ids = creativePaletteIds();
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
    const oil = ctx.state()?.type === MachineType.OilDerrick;
    const wrap = document.createElement('div');
    wrap.className = `machine-console ${oil ? 'machine-oil' : ''}`;
    const node = (parent: HTMLElement, className: string, text = '') => {
      const el = document.createElement('div');
      el.className = className; el.textContent = text; parent.appendChild(el); return el;
    };
    const button = (parent: HTMLElement, label: string, action: () => void, className = '') => {
      const el = document.createElement('button');
      el.type = 'button'; el.className = `machine-button ${className}`;
      el.textContent = label; el.addEventListener('click', action); parent.appendChild(el); return el;
    };
    const hero = node(wrap, 'machine-hero');
    const title = node(hero, 'machine-identity');
    node(title, 'machine-eyebrow', oil ? 'WILDCAT WELL / PETROLEUM' : 'DEEP BORE / MINERAL EXTRACTION');
    const levels = node(title, 'machine-rank');
    const owner = node(title, 'machine-owner');
    const status = node(hero, 'machine-status');
    status.setAttribute('role', 'status');
    const rankTrack = node(wrap, 'machine-ranks');
    const ranks = Array.from({ length: MAX_LEVEL }, (_, i) => {
      const el = node(rankTrack, 'machine-rank-step', String(i + 1));
      el.title = `${machineRank(i + 1)} · Rank ${i + 1}`;
      return el;
    });

    // --- The shaft: bore depth (autominer) or well depth → pressure (derrick).
    const deck = node(wrap, 'machine-deck');
    const shaft = node(deck, 'machine-shaft');
    const shaftFill = node(shaft, 'machine-shaft-fill');
    if (!oil) {
      // Ore bands, drawn to scale down the bore.
      for (const ore of AUTOMINER_ORES) {
        const d = ORE_DEPTH[ore] ?? 0;
        if (d <= 0) continue;
        const band = node(shaft, 'machine-shaft-band');
        band.style.top = `${(d / MAX_DEPTH) * 100}%`;
        band.dataset.ore = oreLabel(ore);
        band.title = `${oreLabel(ore)} from ${d} m`;
      }
    }
    const shaftHead = node(shaft, 'machine-shaft-head');
    const side = node(deck, 'machine-deck-side');
    const shaftText = node(side, 'machine-shaft-text');
    const gaugeGrid = node(side, 'machine-gauges');
    const gauges = (oil
      ? ['Well pressure', 'Field strength', 'Hull']
      : ['Heat', 'Fuel', 'Vein', 'Drill bit']
    ).map((label) => {
      const box = node(gaugeGrid, 'machine-gauge');
      const text = document.createElement('span'); box.appendChild(text);
      text.textContent = label;
      const outer = node(box, 'machine-meter');
      const bar = node(outer, 'machine-fill');
      return { bar, text, box };
    });

    const metrics = node(wrap, 'machine-metrics');
    const rate = node(metrics, 'machine-rate');
    const buffer = node(metrics, 'machine-buffer');
    const fillText = document.createElement('span'); buffer.appendChild(fillText);
    const barOuter = node(buffer, 'machine-meter');
    barOuter.setAttribute('aria-label', 'Output buffer');
    const fillBar = node(barOuter, 'machine-fill');
    const hint = node(wrap, 'machine-hint');
    const output = node(wrap, 'machine-output');

    // --- Operations: the hands-on part of running a rig.
    node(wrap, 'machine-section-heading', oil ? 'WELLHEAD / OPERATIONS' : 'RIG / OPERATIONS');
    const opsGrid = node(wrap, 'machine-ops');
    const ops: MachineViews['ops'] = [];
    const op = (label: string, onClick: () => void, update: (el: HTMLButtonElement, s: MachineState) => void, cls = '') => {
      const el = button(opsGrid, label, onClick, `machine-op ${cls}`);
      ops.push({ el, update: (s) => update(el, s) });
    };
    const costText = (cost: Record<number, number>) => Object.entries(cost)
      .map(([id, n]) => `${n} ${ITEMS[Number(id)]?.name ?? '?'}`).join(' + ');
    const canPay = (cost: Record<number, number>) =>
      Object.entries(cost).every(([id, n]) => this.inventory.countItem(Number(id)) >= n);
    const refine: HTMLButtonElement[] = [];
    if (!oil) {
      op('', () => { const s = ctx.state(); if (s) ctx.act('overdrive', s.overdrive ? 0 : 1, 0); }, (el, s) => {
        el.textContent = s.overdrive ? 'OVERDRIVE ON\nclick to throttle back' : 'Overdrive\n×2 output · builds heat';
        el.classList.toggle('is-hot', s.overdrive);
        el.disabled = s.jam > 0 || (!s.overdrive && s.fuel <= 0);
        el.title = s.fuel <= 0 ? 'Needs fuel in the tank' : s.jam > 0 ? 'Rig is jammed' : 'Double output while fuelled; heat climbs until the rig jams.';
      }, 'machine-op-wide');
      const fuelOp = (item: number, label: string) => op('', () => {
        const s = ctx.state(); if (!s) return;
        const n = Math.min(fuelRoom(s, item), this.inventory.countItem(item));
        if (n > 0) ctx.act('fuel', n, item);
      }, (el, s) => {
        const have = this.inventory.countItem(item), room = fuelRoom(s, item);
        el.textContent = `Load ${label}\n${have} carried · room ${room}`;
        el.disabled = !have || !room;
      });
      fuelOp(Item.Coal, 'Coal');
      fuelOp(Item.OilBarrel, 'Oil');
      op('', () => {
        const best = [Item.DrillBitTitanium, Item.DrillBitDiamond, Item.DrillBitIron]
          .find(id => this.inventory.countItem(id) > 0);
        if (best !== undefined) ctx.act('bit', 1, best);
      }, (el, s) => {
        const best = [Item.DrillBitTitanium, Item.DrillBitDiamond, Item.DrillBitIron]
          .find(id => this.inventory.countItem(id) > 0);
        el.textContent = best !== undefined
          ? `Fit ${BIT_NAMES[bitTier(best)]} bit\n→ bores to ${BIT_DEPTH[bitTier(best)]} m`
          : `Fit drill bit\ncraft one to bore past ${BIT_DEPTH[s.bit]} m`;
        el.disabled = best === undefined;
      });
      op('', () => ctx.act('coolant', 0, 0), (el, s) => {
        const cost = actCost('coolant')!;
        el.textContent = `Coolant\n${costText(cost)}`;
        el.disabled = !canPay(cost) || (s.heat <= 0 && s.jam <= 0);
      });
      op('', () => ctx.act('vent', 0, 0), (el, s) => {
        el.textContent = `Emergency vent\nclears jam · −${Math.round(VENT_HULL_FRACTION * 100)}% hull`;
        el.disabled = s.jam <= 0;
      }, 'machine-op-danger');
    } else {
      const refineRow = node(wrap, 'machine-refine');
      for (let m = 0; m < REFINE_NAMES.length; m++) {
        const b = button(refineRow, REFINE_NAMES[m], () => ctx.act('refine', m, 0), 'machine-filter');
        refine.push(b);
      }
      opsGrid.before(refineRow);
      op('', () => ctx.act('cap', 0, 0), (el, s) => {
        const cost = actCost('cap')!;
        el.textContent = `Cap wellhead\n${costText(cost)}`;
        el.disabled = !s.uncapped || s.fire > 0 || !canPay(cost);
        el.classList.toggle('is-hot', s.uncapped && s.fire <= 0);
      });
      op('', () => ctx.act('smother', 0, 0), (el, s) => {
        const cost = actCost('smother')!;
        el.textContent = `Smother fire\n${costText(cost)}`;
        el.disabled = s.fire <= 0 || !canPay(cost);
        el.classList.toggle('is-hot', s.fire > 0);
      }, 'machine-op-danger');
      op('', () => ctx.act('inject', 0, 0), (el, s) => {
        const cost = actCost('inject')!;
        el.textContent = `Frac-sand injection\n+25% pressure · ${costText(cost)}`;
        el.disabled = s.phase !== WellPhase.Pumping || s.reserves >= 1 || !canPay(cost);
      });
    }

    const filters: { index: number; el: HTMLButtonElement }[] = [];
    if (!oil) {
      const heading = node(wrap, 'machine-section-heading', 'EXTRACTION TARGETS');
      button(heading, 'All reached', () => {
        const s = ctx.state(); if (s) ctx.configureFilter(allowedFilterMask(s));
      }, 'machine-link');
      const grid = node(wrap, 'machine-filters');
      for (let i = 0; i < AUTOMINER_ORES.length; i++) {
        const chip = button(grid, oreLabel(AUTOMINER_ORES[i]), () => ctx.toggleFilter(i), 'machine-filter');
        filters.push({ index: i, el: chip });
      }
    }

    // --- Seismic survey: where would this rig do better? (static per open)
    const survey = ctx.survey();
    if (survey.length === 81) {
      const heading = node(wrap, 'machine-section-heading', oil ? 'SEISMIC SURVEY / OIL' : 'SEISMIC SURVEY / ORE');
      const grid = node(wrap, 'machine-survey');
      let best = 0;
      for (let i = 0; i < 81; i++) if (survey[i] > survey[best]) best = i;
      survey.forEach((v, i) => {
        const cell = node(grid, 'machine-survey-cell');
        cell.style.setProperty('--v', v.toFixed(3));
        if (i === 40) cell.classList.add('is-here');
        if (i === best && best !== 40) cell.classList.add('is-best');
        cell.title = `${Math.round(v * 100)}%`;
      });
      const bx = (best % 9) - 4, bz = Math.floor(best / 9) - 4;
      const dir = best === 40 ? 'You are on the best ground nearby.'
        : `Richest ground ≈ ${Math.round(Math.hypot(bx, bz) * 4)} blocks ${bz < 0 ? 'north' : bz > 0 ? 'south' : ''}${bx && bz ? '-' : ''}${bx > 0 ? 'east' : bx < 0 ? 'west' : ''}. Relocate to chase it.`;
      node(heading, 'machine-survey-note', dir);
    }

    node(wrap, 'machine-section-heading', 'ENGINEERING / NEXT UPGRADE');
    const upgrades = node(wrap, 'machine-upgrades');
    const prodBtn = button(upgrades, '', () => ctx.upgrade('production'), 'machine-upgrade');
    const storageBtn = button(upgrades, '', () => ctx.upgrade('storage'), 'machine-upgrade');
    const controls = node(wrap, 'machine-controls');
    const collectBtn = button(controls, 'Collect output', () => ctx.collect(), 'machine-collect');
    const claimBtn = button(controls, 'Claim', () => ctx.claim());
    const moveBtn = button(controls, 'Relocate', () => ctx.move());
    moveBtn.title = oil
      ? 'Move the rig, keeping upgrades and stored output. The new site must be drilled from scratch.'
      : 'Move the rig, keeping upgrades and stored output. The bore restarts at the surface on fresh ground.';
    const integrity = node(wrap, 'machine-integrity');
    const hpOuter = node(integrity, 'machine-meter');
    const hpBar = node(hpOuter, 'machine-fill');
    const hpText = document.createElement('span'); integrity.appendChild(hpText);
    this.machineViews = {
      levels, owner, hpBar, hpText, fillBar, fillText, rate, filters,
      prodBtn, storageBtn, collectBtn, claimBtn, moveBtn, status, output, hint, ranks, outputKey: '',
      shaftHead, shaftFill, shaftText, gauges, ops, refine,
    };
    this.topEl.appendChild(wrap);
    this.refreshMachine();
  }

  private refreshMachine(): void {
    const ctx = this.machineCtx, v = this.machineViews;
    if (!ctx || !v) return;
    const state = ctx.state();
    if (!state) return;
    const oil = state.type === MachineType.OilDerrick;
    v.levels.textContent = `${machineRank(state.level)} / ${String(state.level).padStart(2, '0')}`;
    v.ranks.forEach((el, i) => {
      el.classList.toggle('is-reached', i < state.level);
      el.classList.toggle('is-current', i + 1 === state.level);
    });
    const name = ctx.myName();
    const mine = !!state.owner && state.owner === name;
    const friendly = machineFriendly(state, name, ctx.myFaction());
    v.owner.textContent = state.owner
      ? `Operated by ${state.owner}${mine ? ' · You' : friendly ? ' · Ally' : ' · HOSTILE'}`
      : 'Unclaimed rig · anyone may operate it';
    v.claimBtn.disabled = mine;
    v.claimBtn.textContent = mine ? 'Claimed' : friendly ? 'Claim' : 'Hack (<25% hull)';
    const maxHp = machineMaxHp(state);
    v.hpBar.style.width = `${Math.max(0, Math.min(100, state.hp / maxHp * 100))}%`;
    v.hpText.textContent = `Hull ${Math.ceil(state.hp)} / ${maxHp} · Production upgrades repair hull`;
    const cap = storageCap(state), stored = totalStored(state), rate = ctx.rate();
    const full = stored >= cap;
    const running = rate > 0 && !full;
    const ctxOil = ctx.context().oil ?? 0;

    let status: string;
    let hint: string;
    const minutes = rate > 0 ? Math.ceil((cap - stored) / rate / 60) : 0;
    const setGauge = (i: number, frac: number, text: string, warn = false) => {
      const g = v.gauges[i]; if (!g) return;
      g.bar.style.width = `${Math.max(0, Math.min(100, frac * 100))}%`;
      if (g.text.textContent !== text) g.text.textContent = text;
      g.box.classList.toggle('is-warn', warn);
    };

    if (!oil) {
      const cap2 = maxDepth(state);
      const depthFrac = state.depth / MAX_DEPTH;
      v.shaftFill.style.height = `${depthFrac * 100}%`;
      v.shaftHead.style.top = `${depthFrac * 100}%`;
      v.shaftHead.classList.toggle('is-hot', state.heat > 60);
      const binding = cap2 < rankDepth(state.level) ? `${BIT_NAMES[state.bit]} bit` : 'rank';
      v.shaftText.textContent = `Bore ${state.depth.toFixed(1)} m · limit ${cap2} m (${binding})`;
      setGauge(0, state.heat / JAM_HEAT,
        state.jam > 0 ? `JAMMED · ${Math.ceil(state.jam)}s` : `Heat ${Math.round(state.heat)}%`, state.heat > 70 || state.jam > 0);
      setGauge(1, state.fuel / FUEL_CAP,
        state.fuel > 0 ? `Fuel ${Math.ceil(state.fuel / 60)} min${state.overdrive ? ' (×2 burn)' : ''}` : 'No fuel · trickle 25%', state.fuel <= 0);
      setGauge(2, state.reserves, `Vein ${Math.round(state.reserves * 100)}% · yield ×${veinFactor(state).toFixed(2)}`, state.reserves < 0.15);
      setGauge(3, state.bit ? state.bitWear / BIT_DURABILITY[state.bit] : 1,
        state.bit ? `${BIT_NAMES[state.bit]} bit ${Math.round(state.bitWear / BIT_DURABILITY[state.bit] * 100)}%` : 'Stock bit (≤45 m)', state.bit > 0 && state.bitWear < BIT_DURABILITY[state.bit] * 0.15);
      status = state.jam > 0 ? 'JAMMED' : full ? 'BUFFER FULL' : state.overdrive && running ? 'OVERDRIVE'
        : running ? (state.fuel > 0 ? 'EXTRACTING' : 'TRICKLE') : 'STANDBY';
      const focus = focusMultiplier(state);
      const nextBand = AUTOMINER_ORES.map(o => ORE_DEPTH[o] ?? 0).filter(d => d > state.depth).sort((a, b) => a - b)[0];
      hint = state.jam > 0 ? 'Seized solid. Wait it out, pour in coolant, or vent it at the cost of hull.'
        : full ? 'Buffer full. Collect to restart extraction, or expand your buffer.'
        : state.fuel <= 0 ? 'Running dry at 25%. Load coal or oil — or place your Oil Derrick within 12 blocks and it pipes crude in.'
        : state.reserves < 0.15 ? 'This vein is nearly worked out. Check the seismic survey and relocate.'
        : nextBand !== undefined && nextBand <= cap2 ? `Next ore band at ${nextBand} m · ${focus > 1 ? `focus +${Math.round((focus - 1) * 100)}%` : 'focus 1-2 ores for a yield bonus'} · full in ~${minutes} min`
        : nextBand !== undefined ? `Next band at ${nextBand} m is past your limit — upgrade rank or fit a better bit.`
        : `Bottom of the bore. ~${minutes} min until full.`;
      if (!full && !state.jam) hint += ' · Place a chest beside the rig and it empties itself.';
    } else {
      const drilling = state.phase === WellPhase.Drilling;
      const frac = drilling ? state.depth / WELL_DEPTH : 1;
      v.shaftFill.style.height = `${frac * 100}%`;
      v.shaftHead.style.top = `${frac * 100}%`;
      v.shaftHead.classList.toggle('is-hot', state.fire > 0 || state.uncapped);
      v.shaftText.textContent = drilling
        ? `Drilling ${state.depth.toFixed(0)} / ${WELL_DEPTH} m · gusher odds ${Math.round(gusherChance(ctxOil) * 100)}%`
        : state.fire > 0 ? `WELL FIRE · ${Math.ceil(state.fire)}s — hull burning`
        : state.uncapped ? 'GUSHER · uncapped: +50% flow, 3× pressure loss, FLAMMABLE'
        : `Pumping · ${REFINE_NAMES[state.refine]} · links crude to your rigs within ${FUEL_LINK_RADIUS} blocks`;
      setGauge(0, drilling ? 0 : state.reserves, drilling ? 'Pressure · not struck yet' : `Pressure ${Math.round(state.reserves * 100)}%`, !drilling && state.reserves < 0.2);
      setGauge(1, ctxOil, `Field ${Math.round(ctxOil * 100)}%`, ctxOil < OIL_THRESHOLD);
      setGauge(2, state.hp / maxHp, `Hull ${Math.round(state.hp / maxHp * 100)}%`, state.fire > 0);
      v.refine.forEach((b, i) => b.setAttribute('aria-pressed', String(state.refine === i)));
      status = state.fire > 0 ? 'WELL FIRE' : ctxOil < OIL_THRESHOLD ? 'DRY GROUND' : drilling ? 'DRILLING'
        : full ? 'BUFFER FULL' : state.uncapped ? 'GUSHER!' : state.reserves < 0.2 ? 'LOW PRESSURE' : 'PUMPING';
      hint = state.fire > 0 ? 'The well is ablaze! Smother it with sand before it burns the rig down.'
        : ctxOil < OIL_THRESHOLD ? 'No oil here. Relocate near oil shale in a desert or ocean field; upgrades travel with you.'
        : drilling ? `Sinking the well. On the strike, ${Math.round(gusherChance(ctxOil) * 100)}% chance of a gusher.`
        : state.uncapped ? 'A gusher! Big flow — but cap it soon: an explosion near an uncapped well sets it on fire.'
        : full ? 'Tanks full. Collect to keep pumping, or expand your buffer.'
        : state.reserves < 0.2 ? 'Reservoir pressure is low. Frac-sand injection brings it back.'
        : `${REFINE_NAMES[state.refine]} · full in ~${minutes} min`;
    }
    if (v.status.textContent !== status) v.status.textContent = status;
    v.status.dataset.running = String(running);
    v.status.dataset.alarm = String(status === 'JAMMED' || status === 'WELL FIRE' || status === 'GUSHER!');
    if (v.hint.textContent !== hint) v.hint.textContent = hint;
    v.fillBar.style.width = `${Math.min(100, stored / cap * 100)}%`;
    v.fillText.textContent = `${stored.toLocaleString()} / ${cap.toLocaleString()} buffered`;
    v.rate.textContent = `${(running ? rate * 60 : 0).toFixed(1)} ${oil ? 'units' : 'items'} / min`;

    const mask = allowedFilterMask(state);
    const richness = ctx.context().ore ?? {};
    for (const { index, el } of v.filters) {
      const ore = AUTOMINER_ORES[index];
      const gated = !(mask & (1 << index));
      const on = !!(state.filter & (1 << index));
      el.setAttribute('aria-pressed', String(on));
      el.classList.toggle('is-locked', gated);
      el.textContent = `${oreLabel(ore)}${gated ? ` · ${ORE_DEPTH[ore]} m` : ''}`;
      el.title = gated ? `Reached at ${ORE_DEPTH[ore]} m of bore depth` : `${Math.round((richness[ore] ?? 0) * 100)}% deposit strength · ${on ? 'Click to disable' : 'Click to extract'}`;
    }
    for (const o of v.ops) {
      o.update(state);
      if (!friendly) o.el.disabled = true;
    }
    if (!friendly) v.refine.forEach(b => { b.disabled = true; });
    const outputKey = JSON.stringify(state.stored);
    if (v.outputKey !== outputKey) {
      v.outputKey = outputKey;
      v.output.replaceChildren();
      const entries = Object.entries(state.stored).filter(([, n]) => n > 0);
      if (!entries.length) v.output.textContent = 'Your next haul appears here. The rig works while you explore.';
      for (const [id, n] of entries) {
        const chip = document.createElement('div'); chip.className = 'machine-loot';
        const icon = document.createElement('canvas'); icon.width = icon.height = 32;
        renderItemIcon(icon, this.atlasCanvas, Number(id));
        const label = document.createElement('span');
        label.textContent = `${n} ${ITEMS[Number(id)]?.name ?? 'items'}`;
        chip.append(icon, label); v.output.appendChild(chip);
      }
    }
    this.setUpgradeBtn(v.prodBtn, ctx, state, 'production', state.level >= MAX_LEVEL);
    this.setUpgradeBtn(v.storageBtn, ctx, state, 'storage', state.storageLevel >= MAX_STORAGE_LEVEL);
    if (!friendly) { v.prodBtn.disabled = true; v.storageBtn.disabled = true; }
    v.collectBtn.disabled = stored <= 0;
    v.collectBtn.textContent = stored <= 0 ? 'Awaiting output'
      : friendly ? `Collect ${stored.toLocaleString()} →` : 'Siphon 25% (raid)';
    v.collectBtn.title = friendly ? 'Transfer output to your inventory.'
      : 'Steal a quarter of the buffer. The owner is alerted; one siphon per rig every 90 seconds.';
  }

  private setUpgradeBtn(
    btn: HTMLButtonElement, ctx: MachineUIContext, state: MachineState,
    axis: UpgradeAxis, maxed: boolean
  ): void {
    const production = axis === 'production';
    const label = production ? 'Production' : 'Buffer';
    if (maxed) {
      btn.textContent = `${label} complete
${production ? 'Masterwork achieved' : 'Maximum capacity installed'}`;
      btn.disabled = true;
      return;
    }
    const next = { ...state, level: state.level + (production ? 1 : 0), storageLevel: state.storageLevel + (production ? 0 : 1) };
    const deeper = state.type === MachineType.Autominer && rankDepth(next.level) > rankDepth(state.level)
      ? `\nRank depth ${rankDepth(state.level)} → ${rankDepth(next.level)} m` : '';
    const benefit = production
      ? `+${Math.round((productionRate(next.level) / productionRate(state.level) - 1) * 100)}% output` +
        (storageCap(next) > storageCap(state) ? ` · +${storageCap(next) - storageCap(state)} buffer` : '') + deeper
      : `${storageCap(state).toLocaleString()} → ${storageCap(next).toLocaleString()} items`;
    const cost = upgradeCost(state, axis)!;
    const costStr = Object.entries(cost).map(([id, n]) => {
      const held = this.inventory.countItem(Number(id));
      return `${n} ${ITEMS[Number(id)]?.name ?? '?'}${held < n ? ` (need ${n - held})` : ''}`;
    }).join(' · ');
    const text = `${production ? machineRank(next.level) : `Buffer ${next.storageLevel}`} ↑
${benefit}
${costStr}`;
    if (btn.textContent !== text) btn.textContent = text;
    btn.disabled = !ctx.canAfford(axis);
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
    const moveBtn = this.warBtn();
    moveBtn.textContent = 'Relocate';
    moveBtn.addEventListener('mousedown', (e) => { e.preventDefault(); ctx.move(); });
    loadRow.append(loadAmmoBtn, loadFuelBtn, claimBtn, moveBtn);
    wrap.appendChild(loadRow);

    this.turretViews = {
      info, owner, hpBar, hpText, ammo,
      rangeBtn, damageBtn, rateBtn, loadAmmoBtn, loadFuelBtn, claimBtn, moveBtn,
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
    const mine = !!s.owner && s.owner === ctx.myName();
    const claimable = !mine && ctx.canClaim();
    const hack = claimable && !!s.owner && turretDisabled(s);
    const status = turretDisabled(s) ? '  ·  OFFLINE (sabotaged)'
      : !s.owner ? '' : s.ammo < 1 ? '  ·  NO AMMO' : s.fuel < 0.15 ? '  ·  NO OIL' : '  ·  ARMED';
    v.owner.textContent = (s.owner ? `Owner: ${s.owner}${mine ? ' (you)' : ''}` : 'Unclaimed (inert)') + status;
    v.claimBtn.disabled = !claimable;
    v.claimBtn.style.opacity = claimable ? '1' : '0.5';
    v.claimBtn.style.background = hack ? '#8a2f2f' : '#3b5a7a';
    v.claimBtn.textContent = mine ? 'Owned' : hack ? 'Hack' : claimable ? 'Claim' : 'Enemy';
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
    const canM = ctx.canMove();
    v.moveBtn.disabled = !canM; v.moveBtn.style.opacity = canM ? '1' : '0.5';
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
    this.panel.classList.toggle('machine-panel', mode === 'machine');
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
      this.titleEl.textContent = this.chestPager?.title ?? 'Chest';
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
    this.panel.scrollTop = 0;
    this.tooltip.style.display = 'none';
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
    const pager = this.chestPager;
    if (pager && pager.pages > 1) {
      const strip = document.createElement('div');
      strip.className = 'chest-pages';
      for (let i = 0; i < pager.pages; i++) {
        const tab = document.createElement('button');
        tab.type = 'button';
        tab.className = 'war-btn mc-font';
        tab.textContent = String(i + 1);
        tab.disabled = i === pager.page;
        tab.title = `Page ${i + 1} of ${pager.pages}`;
        tab.addEventListener('click', () => pager.onPage(i));
        strip.appendChild(tab);
      }
      this.headerEl.appendChild(strip);
    }
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
