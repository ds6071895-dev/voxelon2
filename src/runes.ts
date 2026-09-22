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
import { ARMOR_POINT_CAP, TOUGHNESS_CAP } from './net/protocol';

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
  /** Reload-time reduction (0.1 = −10%). Focus carries this so it still pays
   *  on the guns that have no spread at all (only the Shotgun and SMG do). */
  reload?: number;
  /** Chance a mining swing costs the tool no durability (0.1 = 10%). Fortune
   *  carries this so it still pays once diamond tools make mining instant. */
  wear?: number;
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
    desc: 'Socket into worn armor: +1 armor point. On armor already at the cap, every 2 extra points become 1 toughness.',
    bonus: { armor: 1 },
  },
  [Item.RuneOfSwiftness]: {
    item: Item.RuneOfSwiftness, name: 'Rune of Swiftness',
    desc: 'Socket into worn armor: +3% move speed.',
    bonus: { speed: 0.03 },
  },
  [Item.RuneOfFortune]: {
    item: Item.RuneOfFortune, name: 'Rune of Fortune',
    desc: 'Socket into worn armor: +20% mining speed, 8% chance a swing costs no tool durability.',
    bonus: { mine: 0.2, wear: 0.08 },
  },
  // Spread alone was a dead stat on every gun but the Shotgun and SMG, and
  // near-zero spread turned the Shotgun into a 21-damage precision burst. So
  // Focus is now a smaller spread cut (a full base set = −40%) plus faster
  // reloads, which every gun uses.
  [Item.RuneOfFocus]: {
    item: Item.RuneOfFocus, name: 'Rune of Focus',
    desc: 'Socket into worn armor: −10% gun spread, −5% reload time.',
    bonus: { spread: 0.1, reload: 0.05 },
  },
  // Greater Runes: crafted (never looted) from a matching vault boss's relics
  // — a real endgame use for what used to be pure decoration. Each one is a
  // straight ~1.5-2.5x upgrade over the base rune it's forged from, or (Power)
  // a hybrid touching every stat but toughness.
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
    desc: 'Forged from Mire Queen relics. Socket into worn armor: +6% move speed.',
    bonus: { speed: 0.06 },
  },
  [Item.GreaterRuneOfFortune]: {
    item: Item.GreaterRuneOfFortune, name: 'Greater Rune of Fortune',
    desc: 'Forged from Ember Colossus relics. Socket into worn armor: +50% mining speed, 15% chance a swing costs no tool durability.',
    bonus: { mine: 0.5, wear: 0.15 },
  },
  [Item.GreaterRuneOfFocus]: {
    item: Item.GreaterRuneOfFocus, name: 'Greater Rune of Focus',
    desc: 'Forged from Crystal Seer relics. Socket into worn armor: −15% gun spread, −10% reload time.',
    bonus: { spread: 0.15, reload: 0.1 },
  },
  [Item.GreaterRuneOfPower]: {
    item: Item.GreaterRuneOfPower, name: 'Greater Rune of Power',
    desc: 'Forged from Gilded Artificer relics. Socket into worn armor: +1 armor, +3% speed, +15% mining speed, −5% gun spread, −5% reload time.',
    bonus: { armor: 1, speed: 0.03, mine: 0.15, spread: 0.05, reload: 0.05 },
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
  reloadMult: number; wearSave: number;
} {
  let armor = 0, toughness = 0, speed = 0, mine = 0, spread = 0, reload = 0, wear = 0;
  for (const s of worn) {
    if (!s || s.rune === undefined || !ITEMS[s.id]?.armor) continue;
    const def = RUNES[s.rune];
    if (!def) continue;
    armor += def.bonus.armor ?? 0;
    toughness += def.bonus.toughness ?? 0;
    speed += def.bonus.speed ?? 0;
    mine += def.bonus.mine ?? 0;
    spread += def.bonus.spread ?? 0;
    reload += def.bonus.reload ?? 0;
    wear += def.bonus.wear ?? 0;
  }
  return {
    armor,
    toughness: Math.min(TOUGHNESS_CAP, toughness),      // 4x Greater Iron
    speedMult: 1 + Math.min(0.24, speed),               // 4x Greater Swiftness
    mineMult: 1 + Math.min(2, mine),                    // 4x Greater Fortune
    spreadMult: 1 - Math.min(0.6, spread),              // 4x Greater Focus
    reloadMult: 1 - Math.min(0.4, reload),              // 4x Greater Focus
    wearSave: Math.min(0.6, wear),                      // 4x Greater Fortune
  };
}

/** Worn defense with runes applied. Percentage armor stops at ARMOR_POINT_CAP,
 *  and a levelled iron-or-better set reaches it on its own, so +armor from
 *  runes used to be literally nothing for most players. Rune armor that lands
 *  PAST the cap now converts to toughness at half rate (2 points -> 1), so a
 *  base Rune of Iron still does something on a maxed set while Greater Iron
 *  stays the stronger path. Only RUNE points convert: armor levels alone never
 *  grant toughness. */
export function runeDefense(baseArmor: number, worn: (ItemStack | null)[]): {
  armorPoints: number; toughness: number;
} {
  const r = runeBonuses(worn);
  const overflow = Math.max(0, Math.min(r.armor, baseArmor + r.armor - ARMOR_POINT_CAP));
  return {
    armorPoints: baseArmor + r.armor,
    toughness: Math.min(TOUGHNESS_CAP, r.toughness + Math.floor(overflow / 2)),
  };
}
