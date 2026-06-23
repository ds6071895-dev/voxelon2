// Auto-targeting defensive TURRETS as block-entities, following the machines.ts
// pattern exactly: a single anchor block, server-owned state, sabotaged (HP) not
// mined, ownable/claimable, with geometric upgrade costs paid client-side and
// capped server-side. PURE + transport-agnostic so server + client agree.
//
// A turret tracks the nearest non-owner player in range with rough line of
// sight, consumes a Cannonball + a little oil per shot, and applies a
// server-validated ranged hit (reusing the ranged-damage path). The targeting
// scan itself runs in server_core (it owns the player list); this module owns
// the pure numbers (range/damage/interval/HP), state lifecycle, and validation.

import { Block } from './blocks';
import { Item } from './items';

const MAX_OWNER_LEN = 24;
export const TURRET_MAX_LEVEL = 20;
const COST_GROWTH = 1.25;

const BASE_HP = 120;
const HP_PER_LEVEL = 6;
const BASE_RANGE = 18;
const RANGE_PER_LEVEL = 2;
const BASE_DAMAGE = 6;
const DAMAGE_PER_LEVEL = 1.5;
const BASE_INTERVAL = 1.4;            // seconds between shots
const INTERVAL_PER_LEVEL = 0.04;
const FUEL_PER_SHOT = 0.15;           // oil barrels consumed per shot
export const TURRET_AMMO_CAP = 256;
export const TURRET_FUEL_CAP = 64;

export type TurretAxis = 'range' | 'damage' | 'rate';

export interface TurretState {
  owner: string;
  hp: number; maxHp: number;
  level: { range: number; damage: number; rate: number };
  ammo: number;    // loaded cannonballs
  fuel: number;    // loaded oil (barrels, fractional)
  cooldown: number;
  facingYaw: number; // last aim heading (drives the model; broadcast)
}

function clampLevel(n: number): number {
  if (!Number.isFinite(n)) return 1;
  return Math.max(1, Math.min(TURRET_MAX_LEVEL, Math.floor(n)));
}

export function turretMaxHp(level: { range: number; damage: number; rate: number }): number {
  const sum = clampLevel(level.range) + clampLevel(level.damage) + clampLevel(level.rate);
  return BASE_HP + HP_PER_LEVEL * (sum - 3);
}
export function turretRange(level: { range: number }): number {
  return BASE_RANGE + RANGE_PER_LEVEL * (clampLevel(level.range) - 1);
}
export function turretDamage(level: { damage: number }): number {
  return BASE_DAMAGE + DAMAGE_PER_LEVEL * (clampLevel(level.damage) - 1);
}
export function turretInterval(level: { rate: number }): number {
  return Math.max(0.35, BASE_INTERVAL - INTERVAL_PER_LEVEL * (clampLevel(level.rate) - 1));
}
export function turretFuelPerShot(): number { return FUEL_PER_SHOT; }

export function newTurret(owner = ''): TurretState {
  const level = { range: 1, damage: 1, rate: 1 };
  const maxHp = turretMaxHp(level);
  return {
    owner: owner.slice(0, MAX_OWNER_LEN),
    hp: maxHp, maxHp, level, ammo: 0, fuel: 0, cooldown: 0, facingYaw: 0,
  };
}

export function turretTypeForBlock(block: number): boolean {
  return block === Block.Turret;
}

export function damageTurret(state: TurretState, amount: number): boolean {
  if (Number.isFinite(amount) && amount > 0) {
    state.hp = Math.max(0, Math.min(state.maxHp, state.hp) - amount);
  }
  return state.hp <= 0;
}

export function claimTurret(state: TurretState, owner: string): void {
  state.owner = (owner ?? '').slice(0, MAX_OWNER_LEN);
}

/** Can the turret fire right now (loaded + fuelled + off cooldown)? */
export function turretArmed(state: TurretState): boolean {
  return state.cooldown <= 0 && state.ammo >= 1 && state.fuel >= FUEL_PER_SHOT;
}

/** Consume one shot's resources and reset the cooldown. */
export function turretConsumeShot(state: TurretState): void {
  state.ammo = Math.max(0, state.ammo - 1);
  state.fuel = Math.max(0, state.fuel - FUEL_PER_SHOT);
  state.cooldown = turretInterval(state.level);
}

/** Load ammo/fuel into the turret (used by the deposit UI). Returns the amount
 *  actually accepted (capped), so the client only consumes what fit. */
export function turretLoad(state: TurretState, item: number, count: number): number {
  if (!Number.isFinite(count) || count <= 0) return 0;
  count = Math.floor(count);
  if (item === Item.Cannonball) {
    const room = TURRET_AMMO_CAP - state.ammo;
    const add = Math.max(0, Math.min(room, count));
    state.ammo += add;
    return add;
  }
  if (item === Item.OilBarrel) {
    const room = TURRET_FUEL_CAP - state.fuel;
    const add = Math.max(0, Math.min(room, count));
    state.fuel += add;
    return add;
  }
  return 0;
}

export function turretUpgradeCost(
  state: TurretState, axis: TurretAxis,
): Record<number, number> | null {
  if (axis !== 'range' && axis !== 'damage' && axis !== 'rate') return null;
  const L = state.level[axis];
  if (L >= TURRET_MAX_LEVEL) return null;
  const pow = (n: number) => Math.ceil(n * Math.pow(COST_GROWTH, L - 1));
  if (axis === 'range') return { [Item.IronIngot]: pow(5), [Item.CobaltIngot]: pow(1) };
  if (axis === 'damage') return { [Item.IronIngot]: pow(6), [Item.Cannonball]: pow(3) };
  return { [Item.IronIngot]: pow(4), [Item.OilBarrel]: pow(3) }; // rate
}

export function applyTurretUpgrade(state: TurretState, axis: TurretAxis): boolean {
  if (axis !== 'range' && axis !== 'damage' && axis !== 'rate') return false;
  if (state.level[axis] >= TURRET_MAX_LEVEL) return false;
  state.level[axis] += 1;
  state.maxHp = turretMaxHp(state.level);
  state.hp = Math.min(state.maxHp, state.hp); // never overheal on a non-hull axis
  return true;
}

export function sanitizeTurretState(raw: unknown): TurretState | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const lv = (r.level ?? {}) as Record<string, unknown>;
  const level = {
    range: clampLevel(Number(lv.range)),
    damage: clampLevel(Number(lv.damage)),
    rate: clampLevel(Number(lv.rate)),
  };
  const maxHp = turretMaxHp(level);
  const hp = Number.isFinite(r.hp) ? Math.max(0, Math.min(maxHp, Math.floor(Number(r.hp)))) : maxHp;
  const ammo = Number.isFinite(r.ammo) ? Math.max(0, Math.min(TURRET_AMMO_CAP, Math.floor(Number(r.ammo)))) : 0;
  const fuel = Number.isFinite(r.fuel) ? Math.max(0, Math.min(TURRET_FUEL_CAP, Number(r.fuel))) : 0;
  return {
    owner: typeof r.owner === 'string' ? r.owner.slice(0, MAX_OWNER_LEN) : '',
    hp, maxHp, level, ammo, fuel,
    cooldown: 0,
    facingYaw: Number.isFinite(r.facingYaw) ? Number(r.facingYaw) : 0,
  };
}
