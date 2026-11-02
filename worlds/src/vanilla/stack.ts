// Item stacks for the vanilla modes: the legacy ItemStack plus the data a
// Minecraft stack carries (damage, enchantments, potion, custom name, dye).

import type { ItemStack } from '../items';

export type EnchantId =
  | 'sharpness' | 'smite' | 'bane' | 'knockback' | 'fire_aspect' | 'sweeping' | 'looting'
  | 'power' | 'punch' | 'flame' | 'infinity' | 'multishot' | 'quick_charge' | 'piercing'
  | 'loyalty' | 'riptide' | 'impaling' | 'efficiency' | 'unbreaking' | 'silk_touch' | 'fortune'
  | 'protection' | 'fire_protection' | 'blast_protection' | 'projectile_protection'
  | 'feather_falling' | 'respiration' | 'thorns' | 'density' | 'breach' | 'wind_burst';

export interface PotionData {
  /** Effects applied on drink/splash: [effect, amplifier, ticks]. */
  effects: [string, number, number][];
  /** Display colour. */
  color: number;
  label: string;
}

/** Custom stack tags games attach (Instant TNT, Survival Crafting book...). */
export type StackTag = string;

export interface VStack extends ItemStack {
  /** Durability used (0 = new). */
  dmg?: number;
  ench?: [EnchantId, number][];
  potion?: PotionData;
  /** Custom display name (source items like "Excalibur"). */
  name?: string;
  /** Leather dye colour. */
  color?: number;
  /** Crossbow: loaded projectile item id (arrow or firework). */
  charged?: number;
  /** Game tag (e.g. 'instant_tnt', 'crowbar', 'survival_book'). */
  tag?: StackTag;
  /** Firework flight duration (1-3). */
  flight?: number;
}

export function enchLevel(s: VStack | null | undefined, id: EnchantId): number {
  if (!s?.ench) return 0;
  for (const [e, l] of s.ench) if (e === id) return l;
  return 0;
}

/** Same item and the same data: may share one slot. */
export function canStack(a: VStack, b: VStack): boolean {
  return a.id === b.id && (a.dmg ?? 0) === (b.dmg ?? 0) && a.name === b.name && a.tag === b.tag &&
    a.color === b.color && a.charged === b.charged && a.flight === b.flight &&
    JSON.stringify(a.ench ?? null) === JSON.stringify(b.ench ?? null) &&
    JSON.stringify(a.potion ?? null) === JSON.stringify(b.potion ?? null);
}

export function cloneStack<T extends VStack | null>(s: T): T {
  if (!s) return s;
  const c: VStack = { ...s };
  if (s.ench) c.ench = s.ench.map(([e, l]) => [e, l]);
  if (s.potion) c.potion = { ...s.potion, effects: s.potion.effects.map((e) => [...e] as [string, number, number]) };
  return c as T;
}
