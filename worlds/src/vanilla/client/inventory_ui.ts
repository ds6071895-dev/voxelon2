// The vanilla inventory screen and its container variants (crafting table,
// furnace, chest), as a light Worlds dialog. Clicks are predicted with the
// same inventory_model.click the server runs, sent as `click` actions, and
// replaced by the server's reply.
//
// Mouse: left picks/places a stack, right splits or places one, shift moves,
// double-click gathers. Keys while hovering: 1-9 swap with the hotbar, F with
// the offhand. Dropping: click outside the card while holding a stack, or use
// the Drop slot. (Q stays sprint.) Touch: tap picks/places; Split, Move and
// Drop buttons act on the next tapped slot.

import { bwButton, bwEl } from '../../bedwars_ui';
import { renderItemIcon, clearItemIcon } from '../../icons';
import { ITEMS } from '../../items';
import { click, refreshCrafting, emptyInventory, type InvState, type Win } from '../inventory_model';
import { VITEM, itemName } from '../items';
import { cloneStack, type VStack } from '../stack';
import type { ClickMode, InvView, WindowView } from '../messages';
import { EFFECT_LABEL } from '../effects';

interface Deps {
  app: HTMLElement;
  atlas: HTMLCanvasElement;
  send(win: number, slot: number, button: 0 | 1, mode: ClickMode, rev: number, hotbar?: number): void;
  close(win: number): void;
  onOpenChange(open: boolean): void;
}

const ENCH_LABEL: Record<string, string> = {
  sharpness: 'Sharpness', knockback: 'Knockback', fire_aspect: 'Fire Aspect', power: 'Power', punch: 'Punch', flame: 'Flame',
  infinity: 'Infinity', multishot: 'Multishot', loyalty: 'Loyalty', protection: 'Protection', density: 'Density',
  wind_burst: 'Wind Burst', efficiency: 'Efficiency', unbreaking: 'Unbreaking', breach: 'Breach', quick_charge: 'Quick Charge',
};
const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V'];

export class InventoryUI {
  private scrim: HTMLElement | null = null;
  private card: HTMLElement | null = null;
  private cursorEl: HTMLElement | null = null;
  private tip: HTMLElement | null = null;
  private slotEls: { el: HTMLElement; canvas: HTMLCanvasElement; count: HTMLElement; dur: HTMLElement; index: number }[] = [];
  private inv: InvState = emptyInventory();
  private win: (Win & { id: number; kind: WindowView['kind']; cook?: number; burn?: number }) | null = null;
  private rev = 0;
  private hover = -1;
  private touchMode: ClickMode | 'split' | null = null;
  private lastClick = { slot: -1, at: 0 };
  private progress: HTMLElement | null = null;
  private flame: HTMLElement | null = null;
  open = false;

  constructor(private readonly d: Deps) {
    window.addEventListener('keydown', (e) => {
      if (!this.open || e.repeat) return;
      if (e.code === 'Escape' || e.code === 'KeyE') { e.preventDefault(); this.requestClose(); return; }
      if (this.hover < 0) return;
      const n = Number(e.key);
      if (n >= 1 && n <= 9) { e.preventDefault(); this.act(this.hover, 0, 'swap', n - 1); }
      if (e.code === 'KeyF') { e.preventDefault(); this.act(this.hover, 0, 'offhand'); }
    });
    window.addEventListener('mousemove', (e) => {
      if (!this.cursorEl) return;
      this.cursorEl.style.transform = `translate(${e.clientX - 20}px, ${e.clientY - 20}px)`;
      if (this.tip) this.tip.style.transform = `translate(${e.clientX + 16}px, ${e.clientY + 12}px)`;
    });
  }

  /** Server state. */
  setInventory(v: InvView): void {
    this.inv = { slots: v.slots.map((s) => s ? cloneStack(s) : null), cursor: v.cursor ? cloneStack(v.cursor) : null };
    this.rev = v.rev;
    if (this.open) this.render();
  }
  setWindow(v: WindowView | null): void {
    if (!v) { if (this.open) this.hide(); this.win = null; return; }
    this.win = v.kind === 'inventory' ? null : { kind: v.kind, slots: v.slots.map((s) => s ? cloneStack(s) : null), id: v.id, cook: v.cook, burn: v.burn };
    if (!this.open || this.card?.dataset.kind !== v.kind) this.show(v.kind);
    else this.render();
  }
  get winId(): number { return this.win?.id ?? 0; }

  show(kind: WindowView['kind'] = 'inventory'): void {
    this.hideDom();
    this.open = true;
    this.d.onOpenChange(true);
    const scrim = this.scrim = bwEl('div', 'w-scrim open v-inv-scrim', this.d.app);
    scrim.addEventListener('mousedown', (e) => {
      if (e.target !== scrim) return;
      // Clicking outside the card drops what you hold.
      if (this.inv.cursor) this.act(-999, e.button === 2 ? 1 : 0, 'drop');
      else this.requestClose();
    });
    scrim.addEventListener('contextmenu', (e) => e.preventDefault());
    const card = this.card = bwEl('div', 'w-dialog v-inv', scrim);
    card.dataset.kind = kind;
    const head = bwEl('div', 'v-inv-head', card);
    bwEl('b', '', head, kind === 'inventory' ? 'Inventory' : kind === 'crafting' ? 'Crafting' : kind === 'furnace' ? 'Furnace' : kind === 'smoker' ? 'Smoker' : kind === 'barrel' ? 'Barrel' : 'Chest');
    bwButton(head, 'Done', () => this.requestClose(), 'w-btn v-inv-done');
    this.slotEls = [];
    const top = bwEl('div', 'v-inv-top', card);
    const n = this.win ? this.win.slots.length : 0;
    if (kind === 'inventory') {
      const armor = bwEl('div', 'v-inv-armor', top);
      for (let i = 0; i < 4; i++) this.slot(armor, 36 + i, ['head', 'chest', 'legs', 'feet'][i]);
      this.slot(armor, 40, 'offhand');
      const craft = bwEl('div', 'v-inv-craft', top);
      bwEl('small', 'v-inv-label', craft, 'Crafting');
      const grid = bwEl('div', 'v-grid v-grid-2', craft);
      for (let i = 0; i < 4; i++) this.slot(grid, 41 + i);
      bwEl('i', 'v-arrow', craft, '→');
      this.slot(craft, 45, 'result');
    } else if (kind === 'crafting') {
      const craft = bwEl('div', 'v-inv-craft', top);
      const grid = bwEl('div', 'v-grid v-grid-3', craft);
      for (let i = 0; i < 9; i++) this.slot(grid, i);
      bwEl('i', 'v-arrow', craft, '→');
      this.slot(craft, 9, 'result');
    } else if (kind === 'furnace' || kind === 'smoker') {
      const f = bwEl('div', 'v-furnace', top);
      const col = bwEl('div', 'v-furnace-col', f);
      this.slot(col, 0, 'input');
      this.flame = bwEl('div', 'v-flame', col);
      this.slot(col, 1, 'fuel');
      const arrow = bwEl('div', 'v-cook', f);
      this.progress = bwEl('div', 'v-cook-fill', arrow);
      this.slot(f, 2, 'result');
    } else {
      const grid = bwEl('div', 'v-grid v-grid-9', top);
      for (let i = 0; i < n; i++) this.slot(grid, i);
    }
    bwEl('small', 'v-inv-label', card, 'Inventory');
    const main = bwEl('div', 'v-grid v-grid-9', card);
    const base = kind === 'inventory' ? 0 : n;
    for (let i = 9; i < 36; i++) this.slot(main, kind === 'inventory' ? i : base + (i - 9));
    const bar = bwEl('div', 'v-grid v-grid-9 v-hotbar', card);
    for (let i = 0; i < 9; i++) this.slot(bar, kind === 'inventory' ? i : base + 27 + i);
    const tools = bwEl('div', 'v-inv-tools', card);
    const drop = bwEl('div', 'v-drop', tools, 'Drop');
    drop.addEventListener('mousedown', (e) => { e.preventDefault(); if (this.inv.cursor) this.act(-999, e.button === 2 ? 1 : 0, 'drop'); });
    if (document.documentElement.classList.contains('touch-ui')) {
      for (const [label, mode] of [['Split', 'split'], ['Move', 'quick'], ['Drop', 'drop']] as const) {
        bwButton(tools, label, () => { this.touchMode = this.touchMode === mode ? null : mode; this.render(); }, 'w-btn v-touch-mode');
      }
    } else bwEl('small', 'v-inv-hint', tools, 'Shift-click moves · Right-click splits · 1-9 / F swap · click outside to drop');
    this.cursorEl = bwEl('div', 'v-cursor', this.d.app);
    this.cursorEl.appendChild(document.createElement('canvas'));
    bwEl('span', '', this.cursorEl);
    this.tip = bwEl('div', 'v-tip', this.d.app);
    this.tip.hidden = true;
    this.render();
  }

  private slot(parent: HTMLElement, index: number, role?: string): void {
    const el = bwEl('div', 'v-slot', parent);
    if (role) el.dataset.role = role;
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 32;
    el.appendChild(canvas);
    const count = bwEl('span', 'v-count', el);
    const dur = bwEl('i', 'v-dur', el);
    el.addEventListener('mousedown', (e) => {
      e.preventDefault(); e.stopPropagation();
      const button = e.button === 2 ? 1 : 0;
      if (this.touchMode) {
        const m = this.touchMode; this.touchMode = null;
        if (m === 'split') this.act(index, 1, 'pick'); else this.act(index, 0, m);
        return;
      }
      const now = performance.now();
      if (button === 0 && !e.shiftKey && this.lastClick.slot === index && now - this.lastClick.at < 300 && this.inv.cursor) { this.act(index, 0, 'collect'); this.lastClick.slot = -1; return; }
      this.lastClick = { slot: index, at: now };
      this.act(index, button, e.shiftKey ? 'quick' : 'pick');
    });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('mouseenter', () => { this.hover = index; this.showTip(index); });
    el.addEventListener('mouseleave', () => { if (this.hover === index) this.hover = -1; if (this.tip) this.tip.hidden = true; });
    this.slotEls.push({ el, canvas, count, dur, index });
  }

  private stackAt(index: number): VStack | null {
    const n = this.win ? this.win.slots.length : 0;
    if (this.win && index < n) return this.win.slots[index];
    let ps = this.win ? index - n : index;
    if (this.win) ps = ps < 27 ? ps + 9 : ps - 27;
    return this.inv.slots[ps] ?? null;
  }

  private act(slot: number, button: 0 | 1, mode: ClickMode, hotbar?: number): void {
    // Predict, then tell the server (its reply replaces this).
    const winForModel = this.win && this.win.kind !== 'inventory' ? this.win : null;
    click(this.inv, winForModel, slot, button, mode, hotbar ?? 0);
    refreshCrafting(this.inv, winForModel);
    this.d.send(this.winId, slot, button, mode, this.rev, hotbar);
    this.render();
    if (this.hover >= 0) this.showTip(this.hover);
  }

  private render(): void {
    for (const s of this.slotEls) {
      const st = this.stackAt(s.index);
      s.el.classList.toggle('empty', !st);
      if (st) {
        renderItemIcon(s.canvas, this.d.atlas, st.id);
        s.count.textContent = st.count > 1 ? String(st.count) : '';
        const max = VITEM[st.id]?.durability;
        const left = max ? 1 - (st.dmg ?? 0) / max : 1;
        s.dur.hidden = !max || !st.dmg;
        s.dur.style.width = `${Math.round(left * 100)}%`;
        s.dur.style.background = `hsl(${Math.round(left * 120)},80%,45%)`;
        s.el.classList.toggle('glint', !!st.ench?.length);
      } else { clearItemIcon(s.canvas); s.count.textContent = ''; s.dur.hidden = true; s.el.classList.remove('glint'); }
    }
    if (this.cursorEl) {
      const c = this.inv.cursor;
      this.cursorEl.hidden = !c;
      const cv = this.cursorEl.querySelector('canvas')!;
      cv.width = cv.height = 32;
      if (c) renderItemIcon(cv, this.d.atlas, c.id);
      this.cursorEl.querySelector('span')!.textContent = c && c.count > 1 ? String(c.count) : '';
    }
    if (this.progress) this.progress.style.width = `${Math.round((this.win?.cook ?? 0) * 100)}%`;
    if (this.flame) this.flame.style.opacity = String(this.win?.burn ?? 0);
    this.card?.classList.toggle('touch-pending', !!this.touchMode);
  }

  private showTip(index: number): void {
    const st = this.stackAt(index);
    if (!this.tip) return;
    if (!st) { this.tip.hidden = true; return; }
    this.tip.hidden = false;
    this.tip.replaceChildren();
    bwEl('b', st.ench?.length ? 'ench' : '', this.tip, st.name ?? itemName(st.id) ?? ITEMS[st.id]?.name ?? 'Item');
    for (const [e, l] of st.ench ?? []) bwEl('span', 'line ench', this.tip, `${ENCH_LABEL[e] ?? e} ${ROMAN[l] ?? l}`);
    for (const [e, amp, t] of st.potion?.effects ?? []) bwEl('span', 'line', this.tip, `${EFFECT_LABEL[e as keyof typeof EFFECT_LABEL] ?? e}${amp ? ` ${ROMAN[amp + 1]}` : ''}${t > 1 ? ` (${Math.floor(t / 1200)}:${String(Math.floor(t / 20) % 60).padStart(2, '0')})` : ''}`);
    const d = VITEM[st.id];
    if (d?.attack) bwEl('span', 'line stat', this.tip, `${d.attack.damage} Attack Damage · ${d.attack.speed} Attack Speed`);
    if (d?.armor && d.armor.points) bwEl('span', 'line stat', this.tip, `+${d.armor.points} Armor${d.armor.toughness ? ` · +${d.armor.toughness} Toughness` : ''}`);
    if (d?.food) bwEl('span', 'line stat', this.tip, `Restores ${d.food.nutrition / 2} hunger`);
    if (d?.durability) bwEl('span', 'line mute', this.tip, `Durability ${d.durability - (st.dmg ?? 0)} / ${d.durability}`);
  }

  requestClose(): void {
    if (!this.open) return;
    this.d.close(this.winId);
    this.hide();
  }
  hide(): void { this.hideDom(); this.open = false; this.d.onOpenChange(false); }
  private hideDom(): void {
    this.scrim?.remove(); this.scrim = null; this.card = null;
    this.cursorEl?.remove(); this.cursorEl = null;
    this.tip?.remove(); this.tip = null;
    this.progress = null; this.flame = null;
    this.slotEls = [];
    this.hover = -1;
  }
  dispose(): void { this.hide(); }
}
