// RUNES — exploration-only armor upgrades. Runes are never craftable: they are
// found in structure chests and vault treasure out in the world. Right-click a
// held rune to SOCKET it into a worn armor piece (one rune per piece); while
// that piece is worn, its rune's modest bonus applies. PURE + transport-
// agnostic: the registry + the bonus aggregation live here so the client,
// server persistence and the smoke tests agree.

import { Item, ItemStack, ITEMS } from './items';

export interface RuneBonus {
  /** Extra armor points while worn. */
  armor?: number;
  /** Move-speed multiplier bonus (0.03 = +3%). */
  speed?: number;
  /** Mining-speed multiplier bonus (0.2 = +20%). */
  mine?: number;
  /** Gun-spread reduction (0.25 = −25% cone). */
  spread?: number;
}

export interface RuneDef {
  item: number;
  name: string;
  /** One line for tooltips + the crafting guide. */
  desc: string;
  bonus: RuneBonus;
}

export const RUNES: Record<number, RuneDef> = {
  [Item.RuneOfIron]: {
    item: Item.RuneOfIron, name: 'Rune of Iron',
    desc: 'Socket into worn armor: +1 armor point.',
    bonus: { armor: 1 },
  },
  [Item.RuneOfSwiftness]: {
    item: Item.RuneOfSwiftness, name: 'Rune of Swiftness',
    desc: 'Socket into worn armor: +3% move speed.',
    bonus: { speed: 0.03 },
  },
  [Item.RuneOfFortune]: {
    item: Item.RuneOfFortune, name: 'Rune of Fortune',
    desc: 'Socket into worn armor: +20% mining speed.',
    bonus: { mine: 0.2 },
  },
  [Item.RuneOfFocus]: {
    item: Item.RuneOfFocus, name: 'Rune of Focus',
    desc: 'Socket into worn armor: −25% gun spread.',
    bonus: { spread: 0.25 },
  },
};

export function isRune(id: number): boolean { return RUNES[id] !== undefined; }
export function runeOf(id: number): RuneDef | undefined { return RUNES[id]; }

/** Combined rune effects across a set of WORN armor stacks. Multipliers are
 *  clamped so stacked runes stay a shave, never a superpower. */
export function runeBonuses(worn: (ItemStack | null)[]): {
  armor: number; speedMult: number; mineMult: number; spreadMult: number;
} {
  let armor = 0, speed = 0, mine = 0, spread = 0;
  for (const s of worn) {
    if (!s || s.rune === undefined || !ITEMS[s.id]?.armor) continue;
    const def = RUNES[s.rune];
    if (!def) continue;
    armor += def.bonus.armor ?? 0;
    speed += def.bonus.speed ?? 0;
    mine += def.bonus.mine ?? 0;
    spread += def.bonus.spread ?? 0;
  }
  return {
    armor,
    speedMult: 1 + Math.min(0.12, speed),
    mineMult: 1 + Math.min(0.8, mine),
    spreadMult: Math.max(0.25, 1 - Math.min(0.75, spread)),
  };
}
