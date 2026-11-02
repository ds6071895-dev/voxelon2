// Java Edition 1.9+ combat and damage maths, from the Minecraft wiki
// ("Damage", "Armor", "Attack cooldown", "Enchanting", "Explosion", "Mace").
// Pure functions: the simulation (sim.ts) feeds them state and applies results.

import type { VStack } from './stack';
import { enchLevel } from './stack';
import { VITEM } from './items';
import type { EffectSet } from './effects';

export type DamageKind =
  | 'melee' | 'projectile' | 'explosion' | 'fall' | 'fire' | 'lava' | 'burning' | 'magic' | 'poison'
  | 'drown' | 'freeze' | 'starve' | 'void' | 'lightning' | 'anvil' | 'border' | 'generic' | 'thorns';

export interface DamageSource {
  kind: DamageKind;
  amount: number;
  /** Attacker player/entity id for kill credit (and shields' facing check). */
  by?: number;
  byEntity?: boolean;
  /** Direction the hit came from, for shields and knockback. */
  from?: { x: number; z: number };
  /** Armour Breach levels on the weapon (mace). */
  breach?: number;
  /** Axe hits disable a raised shield for 5 s. */
  axe?: boolean;
  label?: string;
}

/** Damage that ignores armour (but not Resistance or Protection, except the last few). */
const BYPASS_ARMOR: ReadonlySet<DamageKind> = new Set(['fall', 'fire', 'burning', 'magic', 'poison', 'drown', 'freeze', 'starve', 'void', 'border']);
/** Damage nothing reduces. */
const BYPASS_ALL: ReadonlySet<DamageKind> = new Set(['void', 'starve', 'border']);

export function attackStats(held: VStack | null): { damage: number; speed: number } {
  const a = held ? VITEM[held.id]?.attack : undefined;
  return a ?? { damage: 1, speed: 4 };
}

/** 0..1 charge of the attack cooldown after `ticksSince` ticks. */
export function cooldownScale(ticksSince: number, attackSpeed: number): number {
  const period = 20 / attackSpeed;
  return Math.max(0, Math.min(1, (ticksSince + .5) / period));
}

export interface MeleeInput {
  held: VStack | null;
  ticksSinceAttack: number;
  effects: EffectSet;
  falling: boolean;   // fallDistance > 0 and moving down
  onGround: boolean;
  inWater: boolean;
  climbing: boolean;
  sprinting: boolean;
  /** Mace: blocks fallen. */
  fallDistance: number;
  targetUndead: boolean;
  targetArthropod: boolean;
  /** Attack speed override for the whole mode (Lucky Pillars: base 4 → items' own speeds). */
}
export interface MeleeResult {
  damage: number; crit: boolean; sweep: boolean; knockback: number; fireTicks: number; scale: number;
  smash: boolean; breach: number; axe: boolean;
}

/** One melee swing's outcome before the target's defences. */
export function meleeHit(i: MeleeInput): MeleeResult {
  const { damage: base, speed } = attackStats(i.held);
  const scale = cooldownScale(i.ticksSinceAttack, speed);
  let dmg = base + 3 * i.effects.level('strength') - 4 * i.effects.level('weakness');
  dmg = Math.max(0, dmg);
  // Enchantment bonus scales linearly with the cooldown; base damage by 0.2 + 0.8 s².
  let ench = 0;
  const sharp = enchLevel(i.held, 'sharpness');
  if (sharp > 0) ench += .5 * sharp + .5;
  if (i.targetUndead) ench += 2.5 * enchLevel(i.held, 'smite');
  if (i.targetArthropod) ench += 2.5 * enchLevel(i.held, 'bane');
  dmg *= .2 + scale * scale * .8;
  ench *= scale;
  const charged = scale > .9;
  const crit = charged && i.falling && !i.onGround && !i.climbing && !i.inWater && !i.sprinting;
  if (crit) dmg *= 1.5;
  // Mace smash: +4/block for the first 3, +2/block for the next 5, +1 after; Density +0.5/block/level.
  const isMace = !!i.held && VITEM[i.held.id]?.key === 'mace';
  let smash = false;
  if (isMace && i.fallDistance > 1.5) {
    const f = i.fallDistance;
    const bonus = 4 * Math.min(f, 3) + 2 * Math.min(Math.max(f - 3, 0), 5) + Math.max(f - 8, 0);
    dmg += bonus + .5 * enchLevel(i.held, 'density') * f;
    smash = true;
  }
  let knockback = enchLevel(i.held, 'knockback');
  if (i.sprinting && charged) knockback += 1;
  const isSword = !!i.held && VITEM[i.held.id]?.tool?.kind === 'sword';
  const sweep = isSword && charged && i.onGround && !i.sprinting && !crit;
  const fire = enchLevel(i.held, 'fire_aspect');
  return {
    damage: dmg + ench, crit, sweep, knockback, fireTicks: fire > 0 ? fire * 80 : 0, scale, smash,
    breach: enchLevel(i.held, 'breach'), axe: !!i.held && VITEM[i.held.id]?.tool?.kind === 'axe',
  };
}

export interface Defence {
  armor: number; toughness: number;
  /** Enchantment protection factor per damage kind, from worn armour. */
  epf: number;
  effects: EffectSet;
}

/** Armour points, toughness and knockback resistance of worn pieces. */
export function armorOf(worn: (VStack | null)[]): { armor: number; toughness: number; kb: number } {
  let armor = 0, toughness = 0, kb = 0;
  for (const s of worn) {
    const a = s ? VITEM[s.id]?.armor : undefined;
    if (!a) continue;
    armor += a.points; toughness += a.toughness; kb += a.kb;
  }
  return { armor, toughness, kb };
}

/** Enchantment protection factor of worn armour against a damage kind (capped 20). */
export function protectionEpf(worn: (VStack | null)[], kind: DamageKind): number {
  if (BYPASS_ALL.has(kind)) return 0;
  let epf = 0;
  for (const s of worn) {
    if (!s) continue;
    epf += enchLevel(s, 'protection');
    if (kind === 'fire' || kind === 'lava' || kind === 'burning') epf += 2 * enchLevel(s, 'fire_protection');
    if (kind === 'explosion') epf += 2 * enchLevel(s, 'blast_protection');
    if (kind === 'projectile') epf += 2 * enchLevel(s, 'projectile_protection');
    if (kind === 'fall') epf += 3 * enchLevel(s, 'feather_falling');
  }
  return Math.min(20, epf);
}

/** Damage left after armour, Resistance and Protection (before absorption). */
export function reduceDamage(src: DamageSource, d: Defence): number {
  let dmg = src.amount;
  if (BYPASS_ALL.has(src.kind)) return dmg;
  if (!BYPASS_ARMOR.has(src.kind)) {
    const armor = d.armor * (1 - .15 * (src.breach ?? 0));
    const effective = Math.min(20, Math.max(armor / 5, armor - 4 * dmg / (d.toughness + 8)));
    dmg *= 1 - effective / 25;
  }
  const res = d.effects.level('resistance');
  if (res > 0) dmg *= Math.max(0, 1 - .2 * res);
  if (d.epf > 0) dmg *= 1 - d.epf * .04;
  return Math.max(0, dmg);
}

/** Fall damage: ceil(distance − 3 − safe fall − Jump Boost); hay ×0.2, honey ×0.2. */
export function fallDamage(distance: number, safeFall: number, jumpBoost: number, landedOn: 'hay' | 'honey' | 'slime' | 'normal'): number {
  if (landedOn === 'slime') return 0;
  let d = Math.max(0, Math.ceil(distance - 3 - safeFall - jumpBoost));
  if (landedOn === 'hay' || landedOn === 'honey') d = Math.ceil(d * .2);
  return d;
}

/** Explosion damage to a body at `dist` with `exposure` (0..1) to the blast. */
export function explosionDamage(power: number, dist: number, exposure: number): { damage: number; impact: number } {
  const radius = 2 * power;
  if (dist >= radius) return { damage: 0, impact: 0 };
  const impact = (1 - dist / radius) * exposure;
  return { damage: Math.floor((impact * impact + impact) / 2 * 7 * radius + 1), impact };
}

/** Bow: pull ticks → arrow speed (blocks/tick) and whether it is a critical (full draw). */
export function bowPower(pullTicks: number): number {
  const f = pullTicks / 20;
  return Math.min(1, (f * f + f * 2) / 3);
}
/** Arrow damage at impact: ceil(speed(b/tick) × 2 × Power), critical adds up to half + 2. */
export function arrowDamage(speedPerTick: number, power: number, crit: boolean, rng: () => number): number {
  let dmg = speedPerTick * 2;
  if (power > 0) dmg *= 1 + .25 * (power + 1);
  let out = Math.ceil(dmg);
  if (crit) out += Math.floor(rng() * (out / 2 + 2));
  return out;
}

/** Totem of Undying effects (Java): Regeneration II 45 s, Absorption II 5 s, Fire Resistance I 40 s. */
export const TOTEM_EFFECTS: [string, number, number][] = [['regeneration', 1, 900], ['absorption', 1, 100], ['fire_resistance', 0, 800]];
/** Shield: blocks attacks within 90° of where you face, after 5 ticks raised; an axe disables it for 100 ticks. */
export const SHIELD_RAISE_TICKS = 5;
export const SHIELD_DISABLE_TICKS = 100;
export function shieldFaces(yaw: number, from: { x: number; z: number }, at: { x: number; z: number }): boolean {
  const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
  const dx = from.x - at.x, dz = from.z - at.z, len = Math.hypot(dx, dz) || 1;
  return (fx * dx + fz * dz) / len > 0;
}
