// Auto-targeting defensive TURRETS as block-entities, following the machines.ts
// pattern exactly: a single anchor block, server-owned state, sabotaged (HP) not
// mined, ownable/claimable, with geometric upgrade costs paid client-side and
// capped server-side. PURE + transport-agnostic so server + client agree.
//
// A turret tracks the nearest non-owner player in range with clear line of
// sight, consumes a Cannonball + a little oil per shot, and applies a
// server-validated ranged hit (reusing the ranged-damage path). The targeting
// scan itself runs in server_core (it owns the player list); this module owns
// the pure numbers (range/damage/interval/HP), state lifecycle, and validation.
// Hostile mobs are client-side, so each client aims friendly turrets at its own
// mobs and asks the server to spend the shot (turretMobShotOk gates that).

import { Block } from './blocks';
import { Item } from './items';
import { sameFaction } from './teams';

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

/** Height of the gun head's pivot above the block's floor. The mount is a full
 *  block, so the head sits just above it — shots start here, and a block
 *  placed on top of the turret buries the head and silences it. */
export const TURRET_MUZZLE_Y = 1.28;
/** At or below this HP fraction an enemy turret is knocked offline: it stops
 *  firing and can be hacked (claimed) by the raider standing over it. */
export const TURRET_DISABLED_FRAC = 0.25;
/** Most HP one sabotage swing may remove (fists + the best tool, with slack). */
export const TURRET_MAX_HIT = 30;

export type TurretAxis = 'range' | 'damage' | 'rate';

export interface TurretState {
  owner: string;
  /** Owning faction id (teams.ts); the turret never targets its own faction. */
  faction: number;
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

export function newTurret(owner = '', faction = -1): TurretState {
  const level = { range: 1, damage: 1, rate: 1 };
  const maxHp = turretMaxHp(level);
  return {
    owner: owner.slice(0, MAX_OWNER_LEN), faction,
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

export function claimTurret(state: TurretState, owner: string, faction = -1): void {
  state.owner = (owner ?? '').slice(0, MAX_OWNER_LEN);
  state.faction = faction;
}

/** Knocked offline by sabotage (low HP): silent, and open to a hack-claim. */
export function turretDisabled(state: TurretState): boolean {
  return state.hp <= state.maxHp * TURRET_DISABLED_FRAC;
}

/** May `name` (in `faction`) claim this turret? Unowned turrets are free, an
 *  owner or their faction-mates may re-claim, and an ENEMY turret can only be
 *  hacked once sabotage has knocked it offline — never stolen off the shelf. */
export function turretCanClaim(state: TurretState, name: string, faction = -1): boolean {
  if (!state.owner) return true;
  if (state.owner === name) return true;
  if (sameFaction(state.faction, faction)) return true;
  return turretDisabled(state);
}

/** Friendly to this player: they own it, or share its faction. */
export function turretFriendly(state: TurretState, name: string, faction = -1): boolean {
  return (!!state.owner && state.owner === name) || sameFaction(state.faction, faction);
}

/** Can the turret fire right now (claimed + healthy + loaded + fuelled +
 *  off cooldown)? */
export function turretArmed(state: TurretState): boolean {
  return !!state.owner && !turretDisabled(state) &&
    state.cooldown <= 0 && state.ammo >= 1 && state.fuel >= FUEL_PER_SHOT;
}

/** Clear shot from the turret at block (bx,by,bz) to a world point? Marches
 *  the segment from the muzzle in quarter-block steps; the turret's own cell
 *  and the target's own cell are ignored. `solid` is the caller's world query
 *  (server edits+terrain, or the client's loaded chunks). */
export function turretHasLineOfSight(
  bx: number, by: number, bz: number, tx: number, ty: number, tz: number,
  solid: (x: number, y: number, z: number) => boolean,
): boolean {
  const ox = bx + 0.5, oy = by + TURRET_MUZZLE_Y, oz = bz + 0.5;
  const dx = tx - ox, dy = ty - oy, dz = tz - oz;
  const len = Math.hypot(dx, dy, dz);
  if (!Number.isFinite(len)) return false;
  const steps = Math.ceil(len / 0.25);
  const ex = Math.floor(tx), ey = Math.floor(ty), ez = Math.floor(tz);
  for (let i = 0; i <= steps; i++) {
    const f = steps === 0 ? 0 : i / steps;
    const x = Math.floor(ox + dx * f), y = Math.floor(oy + dy * f), z = Math.floor(oz + dz * f);
    if (x === bx && y === by && z === bz) continue;
    if (x === ex && y === ey && z === ez) break;
    if (solid(x + 0.5, y + 0.5, z + 0.5)) return false;
  }
  return true;
}

/** Validate a client's request to fire a friendly turret at one of its own
 *  (client-side) hostile mobs: the shooter must be friendly, the turret armed,
 *  and the aim point inside the turret's range (a little slack for mob drift
 *  between the client's frame and the server's tick). */
export function turretMobShotOk(
  state: TurretState, bx: number, by: number, bz: number,
  tx: number, ty: number, tz: number, name: string, faction = -1,
): boolean {
  if (![tx, ty, tz].every(Number.isFinite)) return false;
  if (!turretFriendly(state, name, faction) || !turretArmed(state)) return false;
  const r = turretRange(state.level) + 1.5;
  const dx = tx - (bx + 0.5), dy = ty - (by + TURRET_MUZZLE_Y), dz = tz - (bz + 0.5);
  return dx * dx + dy * dy + dz * dz <= r * r;
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
    faction: Number.isFinite(r.faction) ? Math.floor(Number(r.faction)) : -1,
    hp, maxHp, level, ammo, fuel,
    cooldown: 0,
    facingYaw: Number.isFinite(r.facingYaw) ? Number(r.facingYaw) : 0,
  };
}
