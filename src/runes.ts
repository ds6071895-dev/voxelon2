// RUNES — armor upgrades. Base runes are exploration-only (never craftable:
// found in structure chests and vault treasure out in the world). GREATER
// runes are the opposite — never looted, only crafted (crafting.ts) from a
// matching vault boss's relics + the base rune they upgrade, so getting one
// means farming that specific boss more than once. Right-click a held rune
// to SOCKET it into a worn armor piece (one rune per piece); while that
// piece is worn, its rune's bonus applies. PURE + transport-agnostic: the
// registry + the bonus aggregation live here so the client, server
// persistence and the smoke tests agree.

import { Item, ItemStack, ITEMS } from './items';
import { TOUGHNESS_CAP } from './net/protocol';

export interface RuneBonus {
  /** Extra armor points while worn. */
  armor?: number;
  /** Flat damage soaked AFTER percentage armor mitigation. Percentage armor
   *  saturates at full titanium (20 points = the cap), so this is the only
   *  defensive stat an endgame set can still grow. */
  toughness?: number;
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
  // 0.18, not 0.25: four of these sum to 1.0, i.e. they used to erase gun
  // spread ENTIRELY, and the clamp merely hid it — which also meant a full set
  // of base runes tied a full set of Greater ones, leaving no reason to
  // upgrade. At 0.18 a full base set reduces 72% and the ceiling stays
  // Greater-only territory.
  [Item.RuneOfFocus]: {
    item: Item.RuneOfFocus, name: 'Rune of Focus',
    desc: 'Socket into worn armor: −18% gun spread.',
    bonus: { spread: 0.18 },
  },
  // Greater Runes: crafted (never looted) from a matching vault boss's relics
  // — a real endgame use for what used to be pure decoration. Each one is a
  // straight ~2.5-3x upgrade over the base rune it's forged from, or (Power)
  // a hybrid spread across three stats.
  // Deliberately NOT "+3 armor": a full titanium set is already 20 points =
  // ARMOR_POINT_CAP, so a bigger percentage rune would be literally zero for
  // the exact players who can farm a Tier III Warden. Toughness soaks flat
  // damage after the percentage, so it always does something.
  [Item.GreaterRuneOfIron]: {
    item: Item.GreaterRuneOfIron, name: 'Greater Rune of Iron',
    desc: 'Forged from Bone Warden relics. Socket into worn armor: +1 armor point and −1 damage from every hit.',
    bonus: { armor: 1, toughness: 1 },
  },
  [Item.GreaterRuneOfSwiftness]: {
    item: Item.GreaterRuneOfSwiftness, name: 'Greater Rune of Swiftness',
    desc: 'Forged from Mire Queen relics. Socket into worn armor: +8% move speed.',
    bonus: { speed: 0.08 },
  },
  [Item.GreaterRuneOfFortune]: {
    item: Item.GreaterRuneOfFortune, name: 'Greater Rune of Fortune',
    desc: 'Forged from Ember Colossus relics. Socket into worn armor: +50% mining speed.',
    bonus: { mine: 0.5 },
  },
  [Item.GreaterRuneOfFocus]: {
    item: Item.GreaterRuneOfFocus, name: 'Greater Rune of Focus',
    desc: 'Forged from Crystal Seer relics. Socket into worn armor: −55% gun spread.',
    bonus: { spread: 0.55 },
  },
  [Item.GreaterRuneOfPower]: {
    item: Item.GreaterRuneOfPower, name: 'Greater Rune of Power',
    desc: 'Forged from Gilded Artificer relics. Socket into worn armor: +1 armor, +3% speed, −15% gun spread.',
    bonus: { armor: 1, speed: 0.03, spread: 0.15 },
  },
};

export function isRune(id: number): boolean { return RUNES[id] !== undefined; }
export function runeOf(id: number): RuneDef | undefined { return RUNES[id]; }

/** Combined rune effects across a set of WORN armor stacks. Multipliers are
 *  clamped so stacked runes stay a shave, never a superpower.
 *
 *  The caps are sized so a full set of four GREATER runes lands on (or just
 *  under) the ceiling. They used to be sized for four BASE runes, which meant
 *  a Greater Rune would have been silently swallowed — you would farm a boss
 *  eight times for a rune that did nothing past the second slot. Base runes
 *  now reach roughly half the ceiling, which is the intended power gap. */
export function runeBonuses(worn: (ItemStack | null)[]): {
  armor: number; toughness: number; speedMult: number; mineMult: number; spreadMult: number;
} {
  let armor = 0, toughness = 0, speed = 0, mine = 0, spread = 0;
  for (const s of worn) {
    if (!s || s.rune === undefined || !ITEMS[s.id]?.armor) continue;
    const def = RUNES[s.rune];
    if (!def) continue;
    armor += def.bonus.armor ?? 0;
    toughness += def.bonus.toughness ?? 0;
    speed += def.bonus.speed ?? 0;
    mine += def.bonus.mine ?? 0;
    spread += def.bonus.spread ?? 0;
  }
  return {
    armor,
    toughness: Math.min(TOUGHNESS_CAP, toughness),      // 4x Greater Iron
    speedMult: 1 + Math.min(0.24, speed),               // 3x Greater Swiftness
    mineMult: 1 + Math.min(2, mine),                    // 4x Greater Fortune
    spreadMult: Math.max(0.15, 1 - Math.min(0.85, spread)),
  };
}
