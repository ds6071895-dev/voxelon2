// Status effects, with Java Edition behaviour from the wiki. Durations and
// cadences are in ticks (1/20 s); amplifier 0 is level I.

export type EffectId =
  | 'speed' | 'slowness' | 'haste' | 'strength' | 'weakness' | 'instant_health' | 'instant_damage'
  | 'jump_boost' | 'regeneration' | 'resistance' | 'fire_resistance' | 'water_breathing'
  | 'invisibility' | 'poison' | 'absorption' | 'glowing' | 'levitation' | 'slow_falling' | 'hunger';

export const EFFECT_LABEL: Record<EffectId, string> = {
  speed: 'Speed', slowness: 'Slowness', haste: 'Haste', strength: 'Strength', weakness: 'Weakness',
  instant_health: 'Instant Health', instant_damage: 'Instant Damage', jump_boost: 'Jump Boost',
  regeneration: 'Regeneration', resistance: 'Resistance', fire_resistance: 'Fire Resistance',
  water_breathing: 'Water Breathing', invisibility: 'Invisibility', poison: 'Poison', absorption: 'Absorption',
  glowing: 'Glowing', levitation: 'Levitation', slow_falling: 'Slow Falling', hunger: 'Hunger',
};
export const EFFECT_COLOR: Record<EffectId, number> = {
  speed: 0x33ebff, slowness: 0x8bafe0, haste: 0xd9c043, strength: 0xffc700, weakness: 0x484d48,
  instant_health: 0xf82423, instant_damage: 0xa9656a, jump_boost: 0xfdff84, regeneration: 0xcd5cab,
  resistance: 0x9146f0, fire_resistance: 0xff9900, water_breathing: 0x98dac0, invisibility: 0xf6f6f6,
  poison: 0x87a363, absorption: 0x2552a5, glowing: 0x94a061, levitation: 0xceffff, slow_falling: 0xf3cfb9, hunger: 0x587653,
};
export const INSTANT: ReadonlySet<EffectId> = new Set(['instant_health', 'instant_damage']);
export const HARMFUL: ReadonlySet<EffectId> = new Set(['slowness', 'weakness', 'instant_damage', 'poison', 'levitation', 'hunger', 'glowing']);

export function isEffectId(v: unknown): v is EffectId { return typeof v === 'string' && v in EFFECT_LABEL; }

export interface Effect { amp: number; ticks: number }

/** The effects on one living thing. */
export class EffectSet {
  readonly map = new Map<EffectId, Effect>();

  has(id: EffectId): boolean { return this.map.has(id); }
  amp(id: EffectId): number { return this.map.get(id)?.amp ?? -1; }
  /** Level (amplifier + 1), 0 when absent. */
  level(id: EffectId): number { return (this.map.get(id)?.amp ?? -1) + 1; }

  /** Vanilla stacking: a stronger effect replaces; an equal one only extends. */
  add(id: EffectId, amp: number, ticks: number): boolean {
    const cur = this.map.get(id);
    if (cur && (cur.amp > amp || (cur.amp === amp && cur.ticks >= ticks))) return false;
    this.map.set(id, { amp, ticks });
    return true;
  }
  remove(id: EffectId): void { this.map.delete(id); }
  clear(): void { this.map.clear(); }

  /** Advance one tick. Returns periodic events for this tick. */
  tick(): { heal: number; poison: number; hunger: number; expired: EffectId[] } {
    let heal = 0, poison = 0, hunger = 0;
    const expired: EffectId[] = [];
    for (const [id, e] of this.map) {
      if (id === 'regeneration') { const every = Math.max(1, 50 >> e.amp); if (e.ticks % every === 0) heal += 1; }
      if (id === 'poison') { const every = Math.max(1, 25 >> e.amp); if (e.ticks % every === 0) poison += 1; }
      if (id === 'hunger') hunger += .005 * (e.amp + 1);
      if (--e.ticks <= 0) { this.map.delete(id); expired.push(id); }
    }
    return { heal, poison, hunger, expired };
  }

  /** Movement multiplier: Speed +20% per level, Slowness -15% per level. */
  speedMult(): number {
    return Math.max(0, 1 + .2 * this.level('speed') - .15 * this.level('slowness'));
  }
  /** Mining speed multiplier from Haste. */
  hasteMult(): number { return 1 + .2 * this.level('haste'); }
  view(): { id: string; amp: number; ticks: number }[] {
    return [...this.map].map(([id, e]) => ({ id, amp: e.amp, ticks: e.ticks }));
  }
}

/** Instant health heals 4·2^amp; instant damage hurts 6·2^amp (magic). */
export function instantAmount(id: 'instant_health' | 'instant_damage', amp: number): number {
  return (id === 'instant_health' ? 4 : 6) * (1 << amp);
}

/** Potions the loot tables use (Java base potion types). [effect, amp, ticks]. */
export const POTIONS: Record<string, { label: string; color: number; effects: [EffectId, number, number][] }> = {
  harming: { label: 'Harming', color: 0xa9656a, effects: [['instant_damage', 0, 1]] },
  strong_harming: { label: 'Harming', color: 0xa9656a, effects: [['instant_damage', 1, 1]] },
  poison: { label: 'Poison', color: 0x87a363, effects: [['poison', 0, 900]] },
  strong_poison: { label: 'Poison', color: 0x87a363, effects: [['poison', 1, 432]] },
  slowness: { label: 'Slowness', color: 0x8bafe0, effects: [['slowness', 0, 1800]] },
  healing: { label: 'Healing', color: 0xf82423, effects: [['instant_health', 0, 1]] },
  swiftness: { label: 'Swiftness', color: 0x33ebff, effects: [['speed', 0, 3600]] },
  leaping: { label: 'Leaping', color: 0xfdff84, effects: [['jump_boost', 0, 3600]] },
  strength: { label: 'Strength', color: 0xffc700, effects: [['strength', 0, 3600]] },
  invisibility: { label: 'Invisibility', color: 0xf6f6f6, effects: [['invisibility', 0, 3600]] },
  fire_resistance: { label: 'Fire Resistance', color: 0xff9900, effects: [['fire_resistance', 0, 3600]] },
  water_breathing: { label: 'Water Breathing', color: 0x98dac0, effects: [['water_breathing', 0, 3600]] },
};
