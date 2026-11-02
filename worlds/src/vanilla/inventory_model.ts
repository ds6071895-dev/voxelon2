// The Minecraft inventory, as one pure click function shared by the server
// (authoritative) and the client (prediction).
//
// Player slots: 0-8 hotbar, 9-35 main, 36-39 armour (head, chest, legs,
// feet), 40 offhand, 41-44 the 2×2 crafting grid, 45 its result.
// A container window puts its own slots first (crafting: 0-8 grid + 9
// result; furnace: 0 input, 1 fuel, 2 output; chest: 0-26), followed by the
// player's 36 storage slots in window order (main 9-35, then hotbar 0-8).

import { canStack, cloneStack, type VStack } from './stack';
import { VITEM, maxStackOf } from './items';
import { craftResult, fuelTicks } from './crafting';
import type { ClickMode } from './messages';
import type { ArmorSlot } from './items';

export const HOTBAR = 9;
export const ARMOR0 = 36;
export const OFFHAND = 40;
export const GRID0 = 41;
export const RESULT = 45;
export const PLAYER_SLOTS = 46;
const ARMOR_ORDER: ArmorSlot[] = ['head', 'chest', 'legs', 'feet'];

export type WinKind = 'inventory' | 'crafting' | 'furnace' | 'smoker' | 'chest' | 'barrel';
export interface Win { kind: WinKind; slots: (VStack | null)[] }
export interface InvState { slots: (VStack | null)[]; cursor: VStack | null }
/** Items that would not fit anywhere and must be dropped into the world. */
export type Spill = VStack[];

export function emptyInventory(): InvState { return { slots: new Array(PLAYER_SLOTS).fill(null), cursor: null }; }
export function containerSize(kind: WinKind): number {
  return kind === 'crafting' ? 10 : kind === 'furnace' || kind === 'smoker' ? 3 : kind === 'chest' || kind === 'barrel' ? 27 : 0;
}
export function newWindow(kind: WinKind): Win { return { kind, slots: new Array(containerSize(kind)).fill(null) }; }

/** Which armour slot an item goes in (elytra wears as a chestplate). */
export function armorSlotOf(id: number): ArmorSlot | null { return VITEM[id]?.armor?.slot ?? null; }

interface Ref { get(): VStack | null; set(v: VStack | null): void; role: 'any' | 'armor' | 'result' | 'fuel' | 'output'; armor?: ArmorSlot }

/** Resolve a window slot index to a cell. */
function ref(inv: InvState, win: Win | null, slot: number): Ref | null {
  const n = win ? win.slots.length : 0;
  if (win && slot < n) {
    const role: Ref['role'] = win.kind === 'crafting' ? (slot === 9 ? 'result' : 'any')
      : win.kind === 'furnace' || win.kind === 'smoker' ? (slot === 2 ? 'output' : slot === 1 ? 'fuel' : 'any') : 'any';
    return { get: () => win.slots[slot], set: (v) => { win.slots[slot] = v; }, role };
  }
  let ps = win ? slot - n : slot;
  if (win) {
    if (ps < 0 || ps >= 36) return null;
    ps = ps < 27 ? ps + 9 : ps - 27; // main first, then hotbar
  }
  if (ps < 0 || ps >= PLAYER_SLOTS) return null;
  const role: Ref['role'] = ps === RESULT ? 'result' : ps >= ARMOR0 && ps < OFFHAND ? 'armor' : 'any';
  return { get: () => inv.slots[ps], set: (v) => { inv.slots[ps] = v; }, role, armor: role === 'armor' ? ARMOR_ORDER[ps - ARMOR0] : undefined };
}

function fits(r: Ref, s: VStack): boolean {
  if (r.role === 'result' || r.role === 'output') return false;
  if (r.role === 'armor') return armorSlotOf(s.id) === r.armor;
  if (r.role === 'fuel') return fuelTicks(s.id) > 0;
  return true;
}
function cap(r: Ref, s: VStack): number { return r.role === 'armor' ? 1 : maxStackOf(s.id); }

/** Grid cells and width of the active crafting grid. */
function grid(inv: InvState, win: Win | null): { cells: (VStack | null)[]; width: number; write: (i: number, v: VStack | null) => void; result: Ref } {
  if (win?.kind === 'crafting') {
    return { cells: win.slots.slice(0, 9), width: 3, write: (i, v) => { win.slots[i] = v; }, result: ref(inv, win, 9)! };
  }
  return { cells: inv.slots.slice(GRID0, GRID0 + 4), width: 2, write: (i, v) => { inv.slots[GRID0 + i] = v; }, result: ref(inv, null, RESULT)! };
}
/** Recompute the crafting result slot(s). */
export function refreshCrafting(inv: InvState, win: Win | null): void {
  inv.slots[RESULT] = craftResult(inv.slots.slice(GRID0, GRID0 + 4), 2);
  if (win?.kind === 'crafting') win.slots[9] = craftResult(win.slots.slice(0, 9), 3);
}
/** Take one craft: consume one of each ingredient. Returns the result or null. */
function takeCraft(inv: InvState, win: Win | null): VStack | null {
  const g = grid(inv, win);
  const res = craftResult(g.cells, g.width);
  if (!res) return null;
  g.cells.forEach((c, i) => {
    if (!c) return;
    // Buckets in a recipe leave the empty bucket behind (none of ours need it).
    const left = c.count - 1;
    g.write(i, left > 0 ? { ...c, count: left } : null);
  });
  refreshCrafting(inv, win);
  return res;
}

/** Put a stack into player storage (hotbar first, then main); returns what is left. */
export function addToInventory(inv: InvState, stack: VStack, prefer: 'hotbar' | 'main' = 'hotbar'): VStack | null {
  let left: VStack | null = cloneStack(stack);
  const order = prefer === 'hotbar' ? [...range(0, 9), ...range(9, 36)] : [...range(9, 36), ...range(0, 9)];
  for (const i of order) {
    const s = inv.slots[i];
    if (!left) break;
    if (s && canStack(s, left)) {
      const room = maxStackOf(s.id) - s.count;
      const n = Math.min(room, left.count);
      if (n > 0) { s.count += n; left = left.count - n > 0 ? { ...left, count: left.count - n } : null; }
    }
  }
  for (const i of order) {
    if (!left) break;
    if (!inv.slots[i]) {
      const n = Math.min(maxStackOf(left.id), left.count);
      inv.slots[i] = { ...left, count: n };
      left = left.count - n > 0 ? { ...left, count: left.count - n } : null;
    }
  }
  return left;
}
function range(a: number, b: number): number[] { const r: number[] = []; for (let i = a; i < b; i++) r.push(i); return r; }

/** Count of an item in storage (hotbar + main + offhand). */
export function countOf(inv: InvState, id: number): number {
  let n = 0;
  for (let i = 0; i < 36; i++) if (inv.slots[i]?.id === id) n += inv.slots[i]!.count;
  if (inv.slots[OFFHAND]?.id === id) n += inv.slots[OFFHAND]!.count;
  return n;
}
/** Remove up to `count` of an item; returns how many were removed. */
export function takeOf(inv: InvState, pred: (s: VStack) => boolean, count: number): number {
  let need = count;
  for (const i of [OFFHAND, ...range(0, 36)]) {
    const s = inv.slots[i];
    if (!s || !pred(s) || need <= 0) continue;
    const n = Math.min(s.count, need);
    need -= n;
    inv.slots[i] = s.count - n > 0 ? { ...s, count: s.count - n } : null;
  }
  return count - need;
}

/**
 * Apply one click. `button` 0 = left/primary, 1 = right/secondary.
 * `hotbar` is the number key for 'swap'. Returns stacks to drop.
 */
export function click(inv: InvState, win: Win | null, slot: number, button: 0 | 1, mode: ClickMode, hotbar = 0): Spill {
  const spill: Spill = [];
  if (mode === 'drop' && slot === -999) {
    if (inv.cursor) {
      if (button === 1) { spill.push({ ...inv.cursor, count: 1 }); inv.cursor = inv.cursor.count > 1 ? { ...inv.cursor, count: inv.cursor.count - 1 } : null; }
      else { spill.push(inv.cursor); inv.cursor = null; }
    }
    return spill;
  }
  const r = ref(inv, win, slot);
  if (!r) return spill;
  const cur = r.get();

  switch (mode) {
    case 'pick': {
      if (r.role === 'result' && win?.kind !== 'furnace' && win?.kind !== 'smoker') {
        if (!cur) break;
        const c = inv.cursor;
        if (c && (!canStack(c, cur) || c.count + cur.count > maxStackOf(c.id))) break;
        const made = takeCraft(inv, win);
        if (!made) break;
        inv.cursor = c ? { ...c, count: c.count + made.count } : made;
        break;
      }
      if (r.role === 'output') {
        if (!cur) break;
        const c = inv.cursor;
        if (!c) { inv.cursor = cur; r.set(null); }
        else if (canStack(c, cur)) {
          const n = Math.min(maxStackOf(c.id) - c.count, cur.count);
          c.count += n; r.set(cur.count - n > 0 ? { ...cur, count: cur.count - n } : null);
        }
        break;
      }
      const c = inv.cursor;
      if (!c) {
        if (!cur) break;
        if (button === 0) { inv.cursor = cur; r.set(null); }
        else { const half = Math.ceil(cur.count / 2); inv.cursor = { ...cur, count: half }; r.set(cur.count - half > 0 ? { ...cur, count: cur.count - half } : null); }
        break;
      }
      if (!fits(r, c)) break;
      if (!cur) {
        const n = button === 0 ? Math.min(c.count, cap(r, c)) : 1;
        r.set({ ...c, count: n });
        inv.cursor = c.count - n > 0 ? { ...c, count: c.count - n } : null;
        break;
      }
      if (canStack(cur, c)) {
        const room = cap(r, c) - cur.count;
        const n = Math.min(room, button === 0 ? c.count : 1);
        if (n <= 0) break;
        r.set({ ...cur, count: cur.count + n });
        inv.cursor = c.count - n > 0 ? { ...c, count: c.count - n } : null;
        break;
      }
      if (c.count <= cap(r, c)) { r.set(c); inv.cursor = cur; }
      break;
    }
    case 'quick': {
      if (!cur) break;
      if (r.role === 'result' && win?.kind !== 'furnace' && win?.kind !== 'smoker') {
        // Craft as many as fit.
        for (let guard = 0; guard < 64; guard++) {
          const preview = r.get();
          if (!preview) break;
          const test: InvState = { slots: inv.slots.map((x) => x ? { ...x } : null), cursor: null };
          if (addToInventory(test, preview)) break;
          const made = takeCraft(inv, win);
          if (!made) break;
          const left = addToInventory(inv, made, 'main');
          if (left) spill.push(left);
        }
        break;
      }
      r.set(null);
      let left: VStack | null = cur;
      const n = win ? win.slots.length : 0;
      const inContainer = !!win && slot < n;
      if (inContainer) left = addToInventory(inv, cur, 'main');
      else if (win && (win.kind === 'chest' || win.kind === 'barrel' || win.kind === 'furnace' || win.kind === 'smoker' || win.kind === 'crafting')) {
        left = moveInto(win, cur);
        if (left) left = moveWithinPlayer(inv, left, slot - n);
      } else {
        // Player inventory: armour goes on, hotbar ↔ main otherwise.
        const ps = win ? slot - n : slot;
        const as = armorSlotOf(cur.id);
        const armorIndex = as ? ARMOR0 + ARMOR_ORDER.indexOf(as) : -1;
        if (as && !(ps >= ARMOR0 && ps < OFFHAND) && !inv.slots[armorIndex]) { inv.slots[armorIndex] = cur; left = null; }
        else left = moveWithinPlayer(inv, cur, ps);
      }
      if (left) r.set(left);
      break;
    }
    case 'swap': {
      if (r.role === 'result' || r.role === 'output') break;
      const h = Math.max(0, Math.min(8, hotbar));
      const hs = inv.slots[h];
      if (hs && !fits(r, hs)) break;
      inv.slots[h] = cur;
      r.set(hs);
      break;
    }
    case 'offhand': {
      if (r.role === 'result' || r.role === 'output' || r.role === 'armor') break;
      const off = inv.slots[OFFHAND];
      inv.slots[OFFHAND] = cur;
      r.set(off);
      break;
    }
    case 'drag': {
      // Right-drag: one per cell, as repeated right-clicks.
      return click(inv, win, slot, 1, 'pick');
    }
    case 'collect': {
      const c = inv.cursor;
      if (!c) break;
      const max = maxStackOf(c.id);
      const total = (win ? win.slots.length : 0) + (win ? 36 : PLAYER_SLOTS);
      for (let i = 0; i < total && c.count < max; i++) {
        const rr = ref(inv, win, i);
        const s = rr?.get();
        if (!rr || !s || rr.role === 'result' || !canStack(s, c)) continue;
        const n = Math.min(max - c.count, s.count);
        c.count += n;
        rr.set(s.count - n > 0 ? { ...s, count: s.count - n } : null);
      }
      break;
    }
    case 'drop': {
      if (!cur || r.role === 'result') break;
      if (button === 1) { spill.push(cur); r.set(null); }
      else { spill.push({ ...cur, count: 1 }); r.set(cur.count > 1 ? { ...cur, count: cur.count - 1 } : null); }
      break;
    }
  }
  refreshCrafting(inv, win);
  return spill;
}

function moveInto(win: Win, s: VStack): VStack | null {
  let left: VStack | null = s;
  const slots = win.kind === 'furnace' || win.kind === 'smoker' ? (fuelTicks(s.id) > 0 && !win.slots[0] ? [1, 0] : [0, 1])
    : win.kind === 'crafting' ? range(0, 9) : range(0, win.slots.length);
  for (const i of slots) {
    if (!left) break;
    if ((win.kind === 'furnace' || win.kind === 'smoker') && i === 1 && fuelTicks(left.id) <= 0) continue;
    const c = win.slots[i];
    if (c && canStack(c, left)) {
      const n = Math.min(maxStackOf(c.id) - c.count, left.count);
      c.count += n; left = left.count - n > 0 ? { ...left, count: left.count - n } : null;
    } else if (!c) { win.slots[i] = left; left = null; }
  }
  return left;
}
function moveWithinPlayer(inv: InvState, s: VStack, from: number): VStack | null {
  const fromHotbar = from >= 27 && from < 36; // window order: hotbar sits after main
  const plain = from >= 0 && from < HOTBAR;
  const toMain = plain || fromHotbar;
  const tmp = { slots: inv.slots, cursor: null };
  const targets = toMain ? range(9, 36) : range(0, 9);
  let left: VStack | null = s;
  for (const pass of [0, 1]) for (const i of targets) {
    if (!left) break;
    const c = tmp.slots[i];
    if (pass === 0 && c && canStack(c, left)) {
      const n = Math.min(maxStackOf(c.id) - c.count, left.count);
      c.count += n; left = left.count - n > 0 ? { ...left, count: left.count - n } : null;
    } else if (pass === 1 && !c) { tmp.slots[i] = left; left = null; }
  }
  return left;
}

/** Close a window: anything left in a crafting grid returns to the player. */
export function closeWindow(inv: InvState, win: Win | null): Spill {
  const spill: Spill = [];
  const back = (s: VStack | null) => { if (s) { const left = addToInventory(inv, s); if (left) spill.push(left); } };
  for (let i = GRID0; i < GRID0 + 4; i++) { back(inv.slots[i]); inv.slots[i] = null; }
  inv.slots[RESULT] = null;
  if (win?.kind === 'crafting') { for (let i = 0; i < 9; i++) { back(win.slots[i]); win.slots[i] = null; } win.slots[9] = null; }
  if (inv.cursor) { back(inv.cursor); inv.cursor = null; }
  return spill;
}
