// Trapcraft — the trap system as PURE, transport-agnostic block-entities (like
// machines.ts). The authoritative server runs one TrapField over its edit log
// and every connected player; offline single-player runs the identical field
// over the local world and the local player. Clients never self-report trap
// hits any more: a trap fires because the simulation saw you in it.
//
// The pieces:
//  • OWNERSHIP — every trap remembers who placed it and their faction. Your own
//    traps (and your allies') never fire on you. Legacy ownerless traps (placed
//    before this system) stay hostile to everyone, as they always were.
//  • ARMING — a freshly placed trap takes a moment to arm (so you can walk off).
//  • CHANNELS — triggers (Pressure Plate, Tripwire Laser, Motion Sensor, Timer,
//    Lever) broadcast on one of 16 coloured channels; every same-owner receiver
//    on that channel within SIGNAL_RADIUS fires. Levers LATCH their channel.
//  • RECEIVERS — Fall/Wall traps, pop-up Spikes, Landmines (remote det),
//    Claymores, Flame Jets, Dart and Net launchers, Alarm Bells.
//  • EFFECTS — hits carry status effects (bleed, slow, stun, pinned, netted,
//    burning) that effects.ts applies to the victim.

import { Block, isSolid } from './blocks';
import { sameFaction } from './teams';

/** Legacy export kept for the old radius-flip smoke checks: the channel reach
 *  replaced it (SIGNAL_RADIUS), but a lever still reaches at least this far. */
export const LEVER_RADIUS = 8;
/** A trigger reaches same-owner receivers on its channel within this radius. */
export const SIGNAL_RADIUS = 24;
export const CHANNELS = 16;
/** Longest a tripwire laser reaches (cells) before it needs another emitter. */
export const TRIP_RANGE = 8;
/** Seconds a freshly placed trap waits before it arms. */
export const ARM_SECONDS = 2.5;

export const enum TrapKind {
  Spike = 0,
  Landmine = 1,
  BearTrap = 2,
  ShockPlate = 3,
  PressurePlate = 4,
  Tripwire = 5,
  MotionSensor = 6,
  Timer = 7,
  Lever = 8,
  FallTrap = 9,
  WallTrap = 10,
  Claymore = 11,
  FlameJet = 12,
  DartLauncher = 13,
  NetLauncher = 14,
  AlarmBell = 15,
}

export const TRAP_NAMES: Readonly<Record<number, string>> = {
  [TrapKind.Spike]: 'Spike Trap', [TrapKind.Landmine]: 'Landmine',
  [TrapKind.BearTrap]: 'Bear Trap', [TrapKind.ShockPlate]: 'Shock Plate',
  [TrapKind.PressurePlate]: 'Pressure Plate', [TrapKind.Tripwire]: 'Tripwire Laser',
  [TrapKind.MotionSensor]: 'Motion Sensor', [TrapKind.Timer]: 'Trap Timer',
  [TrapKind.Lever]: 'Lever', [TrapKind.FallTrap]: 'Fall Trap', [TrapKind.WallTrap]: 'Wall Trap',
  [TrapKind.Claymore]: 'Claymore', [TrapKind.FlameJet]: 'Flame Jet',
  [TrapKind.DartLauncher]: 'Dart Launcher', [TrapKind.NetLauncher]: 'Net Launcher',
  [TrapKind.AlarmBell]: 'Alarm Bell',
};

/** Kill-feed verbs ("X was shredded by Y's Claymore"). */
export const TRAP_VERBS: Readonly<Record<number, string>> = {
  [TrapKind.Spike]: 'impaled', [TrapKind.Landmine]: 'blown up',
  [TrapKind.BearTrap]: 'mauled', [TrapKind.ShockPlate]: 'electrocuted',
  [TrapKind.Claymore]: 'shredded', [TrapKind.FlameJet]: 'torched',
  [TrapKind.DartLauncher]: 'poisoned', [TrapKind.NetLauncher]: 'netted',
};

/** Channel colours (UI swatches + trap model accents). */
export const CHANNEL_COLORS = [
  '#e53935', '#fb8c00', '#fdd835', '#7cb342', '#00897b', '#00acc1', '#1e88e5', '#3949ab',
  '#8e24aa', '#d81b60', '#6d4c41', '#757575', '#eceff1', '#212121', '#c0ca33', '#26c6da',
] as const;
export const CHANNEL_NAMES = [
  'Red', 'Orange', 'Yellow', 'Lime', 'Teal', 'Cyan', 'Blue', 'Indigo',
  'Purple', 'Pink', 'Brown', 'Grey', 'White', 'Black', 'Olive', 'Aqua',
] as const;

export type EffectKind = 'bleed' | 'slow' | 'stun' | 'pinned' | 'netted' | 'burning';
export interface EffectApply { kind: EffectKind; seconds: number }

/** Facing: 0 = -z, 1 = +x, 2 = +z, 3 = -x (the stairs convention), 4 = up. */
export const FACING_DIRS: readonly (readonly [number, number, number])[] = [
  [0, 0, -1], [1, 0, 0], [0, 0, 1], [-1, 0, 0], [0, 1, 0],
];

export interface TrapState {
  kind: TrapKind;
  /** Placer's username ('' = legacy/ownerless: hostile to everyone). */
  owner: string;
  faction: number;
  channel: number;
  facing: number;
  /** Seconds until armed. */
  arm: number;
  /** Seconds until it can fire again. */
  cooldown: number;
  /** Receiver: seconds it stays active (fall/wall/spikes). */
  hold: number;
  /** Lever latched / receiver active / spikes up / jaws shut. */
  on: boolean;
  /** Landmine: seconds left on a primed fuse (0 = not primed). */
  fuse: number;
  /** Flame jet: bursts of oil left. */
  fuel: number;
  /** Timer period (s). */
  interval: number;
  /** Timer accumulator / flame burn remaining. */
  timer: number;
}

/** Something a trap can catch: a player (server id / local) or a mob. */
export interface TrapTarget {
  id: string;
  name: string;
  faction: number;
  x: number;
  /** Feet height. */
  y: number;
  z: number;
}

export interface TrapHit {
  target: string;
  damage: number;
  effects: EffectApply[];
  kx: number; ky: number; kz: number;
  owner: string;
  kind: TrapKind;
  x: number; y: number; z: number;
}

export type TrapFxWhat = 'fire' | 'arm' | 'prime' | 'ring' | 'reset' | 'trip';
export interface TrapFx {
  x: number; y: number; z: number;
  kind: TrapKind;
  what: TrapFxWhat;
  /** Optional aim point (dart/net victim, tripwire break). */
  tx?: number; ty?: number; tz?: number;
}

export interface TrapBlast {
  x: number; y: number; z: number;
  radius: number; damage: number; crater: number;
  owner: string; faction: number; kind: TrapKind;
}

export interface TrapAlarm { owner: string; faction: number; x: number; y: number; z: number; name: string }

export interface TrapTickResult {
  hits: TrapHit[];
  fx: TrapFx[];
  writes: { x: number; y: number; z: number; block: number }[];
  blasts: TrapBlast[];
  alarms: TrapAlarm[];
  /** Keys whose state changed in a way viewers must see (sync). */
  changed: string[];
  /** Keys removed (consumed traps: landmines, claymores). */
  removed: string[];
}

function emptyResult(): TrapTickResult {
  return { hits: [], fx: [], writes: [], blasts: [], alarms: [], changed: [], removed: [] };
}

// --- Block <-> kind -------------------------------------------------------------

export function trapKindForBlock(id: number): TrapKind | null {
  switch (id) {
    case Block.SpikeTrap: return TrapKind.Spike;
    case Block.Landmine: return TrapKind.Landmine;
    case Block.BearTrap: return TrapKind.BearTrap;
    case Block.ShockPlate: return TrapKind.ShockPlate;
    case Block.PressurePlate: return TrapKind.PressurePlate;
    case Block.TripwireHook: return TrapKind.Tripwire;
    case Block.MotionSensor: return TrapKind.MotionSensor;
    case Block.TrapTimer: return TrapKind.Timer;
    case Block.Lever: case Block.LeverOn: return TrapKind.Lever;
    case Block.FallTrap: case Block.FallTrapOpen: return TrapKind.FallTrap;
    case Block.WallTrap: case Block.WallTrapUp: return TrapKind.WallTrap;
    case Block.Claymore: return TrapKind.Claymore;
    case Block.FlameJet: return TrapKind.FlameJet;
    case Block.DartLauncher: return TrapKind.DartLauncher;
    case Block.NetLauncher: return TrapKind.NetLauncher;
    case Block.AlarmBell: return TrapKind.AlarmBell;
    default: return null;
  }
}

export function isTrapBlock(id: number): boolean {
  return trapKindForBlock(id) !== null;
}

export function isLeverBlock(id: number): boolean {
  return id === Block.Lever || id === Block.LeverOn;
}

/** The flipped state of a lever/trap block, or -1 if `id` doesn't flip. */
export function flippedTrap(id: number): number {
  switch (id) {
    case Block.Lever: return Block.LeverOn;
    case Block.LeverOn: return Block.Lever;
    case Block.FallTrap: return Block.FallTrapOpen;
    case Block.FallTrapOpen: return Block.FallTrap;
    case Block.WallTrap: return Block.WallTrapUp;
    case Block.WallTrapUp: return Block.WallTrap;
    default: return -1;
  }
}

/** Block id a state-changing trap should show. */
function blockFor(kind: TrapKind, on: boolean): number {
  switch (kind) {
    case TrapKind.Lever: return on ? Block.LeverOn : Block.Lever;
    case TrapKind.FallTrap: return on ? Block.FallTrapOpen : Block.FallTrap;
    case TrapKind.WallTrap: return on ? Block.WallTrapUp : Block.WallTrap;
    default: return -1;
  }
}

/** Traps that hide (camouflage) from enemies until revealed. */
export function trapConcealed(kind: TrapKind): boolean {
  return kind === TrapKind.Spike || kind === TrapKind.Landmine || kind === TrapKind.BearTrap ||
    kind === TrapKind.ShockPlate || kind === TrapKind.PressurePlate || kind === TrapKind.Tripwire;
}

/** Directional traps (facing chosen at placement). */
export function trapDirectional(kind: TrapKind): boolean {
  return kind === TrapKind.Claymore || kind === TrapKind.FlameJet ||
    kind === TrapKind.DartLauncher || kind === TrapKind.NetLauncher || kind === TrapKind.Tripwire;
}

/** Facing for a new trap: away from the face it was stuck to, or the placer's
 *  look direction when set down on a floor (flame jets on floors point up). */
export function facingForPlacement(kind: TrapKind, nx: number, ny: number, nz: number, yaw: number): number {
  if (ny > 0 && kind === TrapKind.FlameJet) return 4;
  if (ny === 0 && (nx !== 0 || nz !== 0)) {
    if (nx > 0) return 1; if (nx < 0) return 3; if (nz > 0) return 2; return 0;
  }
  const dx = -Math.sin(yaw), dz = -Math.cos(yaw);
  return Math.abs(dx) > Math.abs(dz) ? (dx > 0 ? 1 : 3) : (dz > 0 ? 2 : 0);
}

// --- State ------------------------------------------------------------------------

export const FLAME_FUEL_CAP = 60;
/** Bursts a flame jet gets per oil barrel. */
export const FLAME_BURSTS_PER_BARREL = 6;
export const TIMER_INTERVALS = [2, 4, 8, 15] as const;

export function newTrap(kind: TrapKind, owner = '', faction = -1, facing = 0): TrapState {
  return {
    kind,
    owner: owner.slice(0, 24),
    faction: Number.isFinite(faction) ? Math.floor(faction) : -1,
    channel: 0,
    facing: facing >= 0 && facing <= 4 ? Math.floor(facing) : 0,
    // Legacy/ownerless traps are armed from the start (they always were).
    arm: owner ? ARM_SECONDS : 0,
    cooldown: 0,
    hold: 0,
    on: false,
    fuse: 0,
    fuel: kind === TrapKind.FlameJet ? 3 : 0,
    interval: 4,
    timer: 0,
  };
}

/** Would something owned by (owner, faction) hurt this target? */
export function ownerHostile(owner: string, faction: number, t: { name: string; faction: number }): boolean {
  if (!owner) return true;
  if (t.name === owner) return false;
  return !sameFaction(faction, t.faction);
}

/** Would this trap fire on this target? */
export function trapHostile(s: TrapState, t: { name: string; faction: number }): boolean {
  return ownerHostile(s.owner, s.faction, t);
}

/** Owner or ally: may configure, refuel and pick up without defusing. */
export function trapFriendly(s: TrapState, name: string, faction: number): boolean {
  if (!s.owner) return true;
  return s.owner === name || sameFaction(s.faction, faction);
}

function num(v: unknown, lo: number, hi: number, dflt: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : dflt;
}

/** Validate a trap state from the wire or a save. */
export function sanitizeTrap(raw: unknown): TrapState | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const kind = r.kind;
  if (typeof kind !== 'number' || !Number.isInteger(kind) || kind < 0 || kind > TrapKind.AlarmBell) return null;
  const s = newTrap(kind as TrapKind,
    typeof r.owner === 'string' ? r.owner : '',
    Math.floor(num(r.faction, -1, 64, -1)),
    Math.floor(num(r.facing, 0, 4, 0)));
  s.channel = Math.floor(num(r.channel, 0, CHANNELS - 1, 0));
  s.arm = num(r.arm, 0, ARM_SECONDS, 0);
  s.cooldown = num(r.cooldown, 0, 60, 0);
  s.hold = num(r.hold, 0, 60, 0);
  s.on = r.on === true;
  s.fuse = num(r.fuse, 0, 2, 0);
  s.fuel = Math.floor(num(r.fuel, 0, FLAME_FUEL_CAP, s.fuel));
  s.interval = (TIMER_INTERVALS as readonly number[]).includes(r.interval as number) ? r.interval as number : 4;
  s.timer = num(r.timer, 0, 60, 0);
  return s;
}

// --- Geometry ---------------------------------------------------------------------

type SolidFn = (x: number, y: number, z: number) => boolean;

/** Is the target standing on / in this cell? */
export function standingOn(t: TrapTarget, x: number, y: number, z: number): boolean {
  if (Math.floor(t.x) !== x || Math.floor(t.z) !== z) return false;
  return Math.floor(t.y - 0.05) === y || Math.floor(t.y + 0.1) === y;
}

/** Cells a tripwire laser crosses (stops at the first solid block). */
export function tripwireCells(x: number, y: number, z: number, facing: number, solid: SolidFn): [number, number, number][] {
  const d = FACING_DIRS[facing] ?? FACING_DIRS[0];
  const out: [number, number, number][] = [];
  for (let i = 1; i <= TRIP_RANGE; i++) {
    const cx = x + d[0] * i, cy = y + d[1] * i, cz = z + d[2] * i;
    if (solid(cx, cy, cz)) break;
    out.push([cx, cy, cz]);
  }
  return out;
}

/** Does a target's body (1.8 tall) cross this cell? */
function bodyInCell(t: TrapTarget, x: number, y: number, z: number): boolean {
  if (Math.floor(t.x) !== x || Math.floor(t.z) !== z) return false;
  return t.y <= y + 0.9 && t.y + 1.8 >= y + 0.1;
}

/** Straight-line visibility along the trap's facing (coarse stepping). */
function clearLine(solid: SolidFn, ax: number, ay: number, az: number, bx: number, by: number, bz: number): boolean {
  const dist = Math.hypot(bx - ax, by - ay, bz - az);
  const steps = Math.ceil(dist / 0.4);
  for (let i = 1; i < steps; i++) {
    const f = i / steps;
    if (solid(Math.floor(ax + (bx - ax) * f), Math.floor(ay + (by - ay) * f), Math.floor(az + (bz - az) * f))) {
      return false;
    }
  }
  return true;
}

/** The first hostile target in a directional trap's line of fire. */
function inLine(
  s: TrapState, x: number, y: number, z: number, range: number, lateral: number,
  targets: TrapTarget[], solid: SolidFn,
): TrapTarget | null {
  const d = FACING_DIRS[s.facing] ?? FACING_DIRS[0];
  const ox = x + 0.5, oy = y + 0.5, oz = z + 0.5;
  let best: TrapTarget | null = null;
  let bestAlong = range + 1;
  for (const t of targets) {
    if (!trapHostile(s, t)) continue;
    const cx = t.x - ox, cy = t.y + 0.9 - oy, cz = t.z - oz;
    const along = cx * d[0] + cy * d[1] + cz * d[2];
    if (along < 0.2 || along > range) continue;
    const px = cx - d[0] * along, py = cy - d[1] * along, pz = cz - d[2] * along;
    // Vertical slack covers a whole body when firing horizontally.
    const latH = Math.hypot(px, d[1] ? py : 0, pz);
    if (latH > lateral || (!d[1] && Math.abs(py) > 1.2)) continue;
    if (!clearLine(solid, ox, oy, oz, t.x, t.y + 0.9, t.z)) continue;
    if (along < bestAlong) { bestAlong = along; best = t; }
  }
  return best;
}

// --- The field ----------------------------------------------------------------------

export interface TrapEntry { key: string; x: number; y: number; z: number; state: TrapState }

export class TrapField {
  private readonly states = new Map<string, TrapState>();

  private key(x: number, y: number, z: number): string { return `${x},${y},${z}`; }

  get size(): number { return this.states.size; }
  get(x: number, y: number, z: number): TrapState | undefined { return this.states.get(this.key(x, y, z)); }
  has(x: number, y: number, z: number): boolean { return this.states.has(this.key(x, y, z)); }
  set(x: number, y: number, z: number, s: TrapState): void { this.states.set(this.key(x, y, z), s); }
  remove(x: number, y: number, z: number): TrapState | undefined {
    const k = this.key(x, y, z);
    const s = this.states.get(k);
    this.states.delete(k);
    return s;
  }
  clear(): void { this.states.clear(); }

  /** Create state for a placed trap block (replacing a different kind). */
  place(x: number, y: number, z: number, block: number, owner = '', faction = -1, facing = 0): TrapState | null {
    const kind = trapKindForBlock(block);
    if (kind === null) return null;
    const existing = this.get(x, y, z);
    if (existing && existing.kind === kind) return existing;
    const s = newTrap(kind, owner, faction, facing);
    this.set(x, y, z, s);
    return s;
  }

  entries(): TrapEntry[] {
    const out: TrapEntry[] = [];
    for (const [key, state] of this.states) {
      const p = key.split(',');
      out.push({ key, x: Number(p[0]), y: Number(p[1]), z: Number(p[2]), state });
    }
    return out;
  }

  /** Every [key, state] pair (welcome / save payload). */
  serialize(): [string, TrapState][] {
    return [...this.states.entries()];
  }

  /** Pull a lever: toggles its latch and pulses its channel right away. */
  pull(x: number, y: number, z: number, solid: SolidFn, targets: TrapTarget[] = []): TrapTickResult {
    const res = emptyResult();
    const k = this.key(x, y, z);
    const s = this.states.get(k);
    if (!s || s.kind !== TrapKind.Lever) return res;
    s.on = !s.on;
    res.writes.push({ x, y, z, block: blockFor(TrapKind.Lever, s.on) });
    res.changed.push(k);
    if (s.on) this.signal(s.owner, s.channel, x, y, z, 0.3, res, targets, solid);
    return res;
  }

  /** Someone hostile tried to MINE an armed trap instead of defusing it: it
   *  goes off in their face. Removes the state; the caller clears the block. */
  spring(x: number, y: number, z: number, target: TrapTarget, solid: SolidFn): TrapTickResult {
    const res = emptyResult();
    const k = this.key(x, y, z);
    const s = this.states.get(k);
    if (!s) return res;
    if (s.arm > 0 || !trapHostile(s, target)) { this.states.delete(k); res.removed.push(k); return res; }
    switch (s.kind) {
      case TrapKind.Spike: this.hit(res, s, target, x, y, z, 6, [{ kind: 'bleed', seconds: 4 }]); break;
      case TrapKind.BearTrap: this.hit(res, s, target, x, y, z, 4, [{ kind: 'pinned', seconds: 5 }]); break;
      case TrapKind.ShockPlate: this.hit(res, s, target, x, y, z, 3, [{ kind: 'stun', seconds: 1.5 }]); break;
      case TrapKind.Landmine:
        res.blasts.push({ x: x + 0.5, y: y + 0.5, z: z + 0.5, radius: 4.5, damage: 16, crater: 2,
          owner: s.owner, faction: s.faction, kind: s.kind });
        break;
      case TrapKind.Claymore:
        this.detonateClaymore(k, s, x, y, z, res, [target], solid);
        return res;
      default:
        break;
    }
    res.fx.push({ x, y, z, kind: s.kind, what: 'fire' });
    this.states.delete(k);
    res.removed.push(k);
    return res;
  }

  /** Pulse every same-owner receiver on (owner, channel) within reach. */
  private signal(
    owner: string, channel: number, x: number, y: number, z: number, hold: number,
    res: TrapTickResult, targets: TrapTarget[], solid: SolidFn,
  ): void {
    const r2 = SIGNAL_RADIUS * SIGNAL_RADIUS;
    for (const [k, s] of this.states) {
      if (s.owner !== owner || s.channel !== channel) continue;
      const p = k.split(',');
      const rx = Number(p[0]), ry = Number(p[1]), rz = Number(p[2]);
      const dx = rx - x, dy = ry - y, dz = rz - z;
      if (dx * dx + dy * dy + dz * dz > r2) continue;
      this.activate(k, s, rx, ry, rz, hold, res, targets, solid);
    }
  }

  /** A receiver got a signal. */
  private activate(
    k: string, s: TrapState, x: number, y: number, z: number, hold: number,
    res: TrapTickResult, targets: TrapTarget[], solid: SolidFn,
  ): void {
    switch (s.kind) {
      case TrapKind.FallTrap:
      case TrapKind.WallTrap: {
        const keep = Math.max(hold, s.kind === TrapKind.FallTrap ? 5 : 6);
        if (!s.on) {
          s.on = true;
          res.writes.push({ x, y, z, block: blockFor(s.kind, true) });
          res.fx.push({ x, y, z, kind: s.kind, what: 'fire' });
          res.changed.push(k);
        }
        s.hold = Math.max(s.hold, keep);
        break;
      }
      case TrapKind.Spike: {
        if (!s.on) { res.fx.push({ x, y, z, kind: s.kind, what: 'fire' }); res.changed.push(k); }
        s.on = true;
        s.hold = Math.max(s.hold, Math.max(hold, 2));
        break;
      }
      case TrapKind.Landmine:
        if (s.arm <= 0 && s.fuse <= 0) {
          s.fuse = 0.3;
          res.fx.push({ x, y, z, kind: s.kind, what: 'prime' });
        }
        break;
      case TrapKind.Claymore:
        if (s.arm <= 0) this.detonateClaymore(k, s, x, y, z, res, targets, solid);
        break;
      case TrapKind.FlameJet:
        this.startFlame(k, s, x, y, z, res);
        break;
      case TrapKind.DartLauncher:
      case TrapKind.NetLauncher:
        if (s.cooldown <= 0 && s.arm <= 0) {
          const range = s.kind === TrapKind.DartLauncher ? 9 : 6;
          this.shoot(k, s, x, y, z, inLine(s, x, y, z, range, 1.0, targets, solid), res);
        }
        break;
      case TrapKind.AlarmBell:
        this.ring(k, s, x, y, z, '', res);
        break;
      default:
        break; // triggers don't receive
    }
  }

  private hit(
    res: TrapTickResult, s: TrapState, t: TrapTarget, x: number, y: number, z: number,
    damage: number, effects: EffectApply[], knock = 0,
  ): void {
    const dx = t.x - (x + 0.5), dz = t.z - (z + 0.5);
    const h = Math.hypot(dx, dz) || 1;
    res.hits.push({
      target: t.id, damage, effects,
      kx: knock ? (dx / h) * knock : 0, ky: knock ? 0.35 : 0, kz: knock ? (dz / h) * knock : 0,
      owner: s.owner, kind: s.kind, x, y, z,
    });
  }

  private detonateClaymore(
    k: string, s: TrapState, x: number, y: number, z: number,
    res: TrapTickResult, targets: TrapTarget[], solid: SolidFn,
  ): void {
    const d = FACING_DIRS[s.facing] ?? FACING_DIRS[0];
    const ox = x + 0.5, oy = y + 0.4, oz = z + 0.5;
    for (const t of targets) {
      if (!trapHostile(s, t)) continue;
      const cx = t.x - ox, cy = t.y + 0.9 - oy, cz = t.z - oz;
      const dist = Math.hypot(cx, cy, cz);
      if (dist > 6.5 || dist < 0.01) continue;
      const cos = (cx * d[0] + cz * d[2]) / (Math.hypot(cx, cz) || 1);
      if (cos < 0.35 || Math.abs(cy) > 2.2) continue;
      if (!clearLine(solid, ox, oy, oz, t.x, t.y + 0.9, t.z)) continue;
      const dmg = Math.max(2, Math.round(18 * (1 - dist / 7)));
      this.hit(res, s, t, x, y, z, dmg, [{ kind: 'bleed', seconds: 4 }], 0.9);
    }
    res.fx.push({ x, y, z, kind: s.kind, what: 'fire' });
    res.writes.push({ x, y, z, block: Block.Air });
    this.states.delete(k);
    res.removed.push(k);
  }

  private startFlame(k: string, s: TrapState, x: number, y: number, z: number, res: TrapTickResult): void {
    if (s.timer > 0 || s.cooldown > 0 || s.arm > 0 || s.fuel <= 0) return;
    s.fuel -= 1;
    s.timer = 3;
    res.fx.push({ x, y, z, kind: s.kind, what: 'fire' });
    res.changed.push(k);
  }

  private shoot(
    k: string, s: TrapState, x: number, y: number, z: number, t: TrapTarget | null, res: TrapTickResult,
  ): void {
    const dart = s.kind === TrapKind.DartLauncher;
    s.cooldown = dart ? 2.5 : 12;
    const d = FACING_DIRS[s.facing] ?? FACING_DIRS[0];
    const range = dart ? 9 : 6;
    const tx = t ? t.x : x + 0.5 + d[0] * range;
    const ty = t ? t.y + 1.1 : y + 0.5 + d[1] * range;
    const tz = t ? t.z : z + 0.5 + d[2] * range;
    res.fx.push({ x, y, z, kind: s.kind, what: 'fire', tx, ty, tz });
    res.changed.push(k);
    if (!t) return;
    if (dart) this.hit(res, s, t, x, y, z, 3, [{ kind: 'slow', seconds: 4 }, { kind: 'bleed', seconds: 4 }]);
    else this.hit(res, s, t, x, y, z, 1, [{ kind: 'netted', seconds: 3.5 }]);
  }

  private ring(k: string, s: TrapState, x: number, y: number, z: number, name: string, res: TrapTickResult): void {
    if (s.cooldown > 0 || s.arm > 0) return;
    s.cooldown = 20;
    res.fx.push({ x, y, z, kind: s.kind, what: 'ring' });
    res.alarms.push({ owner: s.owner, faction: s.faction, x, y, z, name });
    res.changed.push(k);
  }

  /**
   * Advance every trap by dt against the given targets. Pure apart from its own
   * state map: the host applies hits/effects, block writes, blasts and alarms.
   */
  tick(dt: number, targets: TrapTarget[], solid: SolidFn): TrapTickResult {
    const res = emptyResult();
    if (!Number.isFinite(dt) || dt <= 0) return res;
    const latched: TrapEntry[] = [];
    const triggers: { s: TrapState; x: number; y: number; z: number }[] = [];

    for (const [k, s] of [...this.states]) {
      if (!this.states.has(k)) continue; // consumed earlier this tick
      const p = k.split(',');
      const x = Number(p[0]), y = Number(p[1]), z = Number(p[2]);
      if (s.arm > 0) {
        s.arm = Math.max(0, s.arm - dt);
        if (s.arm <= 0) { res.fx.push({ x, y, z, kind: s.kind, what: 'arm' }); res.changed.push(k); }
        continue;
      }
      if (s.cooldown > 0) s.cooldown = Math.max(0, s.cooldown - dt);
      // Nothing happening and nobody within 16 blocks: skip the detection work.
      const busy = s.on || s.fuse > 0 || s.hold > 0 || s.kind === TrapKind.Timer ||
        (s.kind === TrapKind.FlameJet && s.timer > 0);
      if (!busy && !targets.some(t =>
        Math.abs(t.x - x) < 16 && Math.abs(t.y - y) < 16 && Math.abs(t.z - z) < 16)) continue;
      const hostileOn = (): TrapTarget[] =>
        targets.filter(t => trapHostile(s, t) && standingOn(t, x, y, z));

      switch (s.kind) {
        case TrapKind.Spike: {
          const on = hostileOn();
          if (on.length && !s.on) {
            s.on = true; s.hold = Math.max(s.hold, 1.2);
            res.fx.push({ x, y, z, kind: s.kind, what: 'fire' }); res.changed.push(k);
          }
          if (s.on && s.cooldown <= 0 && on.length) {
            for (const t of on) this.hit(res, s, t, x, y, z, 6, [{ kind: 'bleed', seconds: 4 }]);
            s.cooldown = 0.9;
            s.hold = Math.max(s.hold, 1.2);
          }
          if (s.on) {
            s.hold -= dt;
            if (s.hold <= 0) { s.on = false; s.hold = 0; res.fx.push({ x, y, z, kind: s.kind, what: 'reset' }); res.changed.push(k); }
          }
          break;
        }
        case TrapKind.Landmine: {
          if (s.fuse <= 0) {
            if (hostileOn().length) { s.fuse = 0.45; res.fx.push({ x, y, z, kind: s.kind, what: 'prime' }); }
            break;
          }
          s.fuse -= dt;
          if (s.fuse <= 0) {
            res.blasts.push({ x: x + 0.5, y: y + 0.5, z: z + 0.5, radius: 4.5, damage: 16, crater: 2,
              owner: s.owner, faction: s.faction, kind: s.kind });
            res.fx.push({ x, y, z, kind: s.kind, what: 'fire' });
            res.writes.push({ x, y, z, block: Block.Air });
            this.states.delete(k);
            res.removed.push(k);
          }
          break;
        }
        case TrapKind.BearTrap: {
          if (s.on) {
            s.hold -= dt;
            if (s.hold <= 0) { s.on = false; s.hold = 0; res.fx.push({ x, y, z, kind: s.kind, what: 'reset' }); res.changed.push(k); }
            break;
          }
          if (s.cooldown > 0) break;
          const on = hostileOn();
          if (!on.length) break;
          for (const t of on) this.hit(res, s, t, x, y, z, 4, [{ kind: 'pinned', seconds: 7 }]);
          s.on = true; s.hold = 8; s.cooldown = 9;
          res.fx.push({ x, y, z, kind: s.kind, what: 'fire' }); res.changed.push(k);
          break;
        }
        case TrapKind.ShockPlate: {
          if (s.cooldown > 0) break;
          const on = hostileOn();
          if (!on.length) break;
          for (const t of on) this.hit(res, s, t, x, y, z, 3, [{ kind: 'stun', seconds: 1.5 }]);
          s.cooldown = 4;
          res.fx.push({ x, y, z, kind: s.kind, what: 'fire' }); res.changed.push(k);
          break;
        }
        case TrapKind.PressurePlate: {
          if (s.cooldown > 0 || !hostileOn().length) break;
          s.cooldown = 1;
          res.fx.push({ x, y, z, kind: s.kind, what: 'trip' });
          triggers.push({ s, x, y, z });
          break;
        }
        case TrapKind.Tripwire: {
          if (s.cooldown > 0) break;
          const cells = tripwireCells(x, y, z, s.facing, solid);
          let broke: TrapTarget | null = null;
          for (const t of targets) {
            if (!trapHostile(s, t)) continue;
            if (cells.some(c => bodyInCell(t, c[0], c[1], c[2]))) { broke = t; break; }
          }
          if (!broke) break;
          s.cooldown = 1.5;
          res.fx.push({ x, y, z, kind: s.kind, what: 'trip', tx: broke.x, ty: y + 0.5, tz: broke.z });
          triggers.push({ s, x, y, z });
          break;
        }
        case TrapKind.MotionSensor: {
          if (s.cooldown > 0) break;
          const seen = targets.some(t => trapHostile(s, t) &&
            Math.hypot(t.x - x - 0.5, t.y + 0.9 - y - 0.5, t.z - z - 0.5) <= 5);
          if (!seen) break;
          s.cooldown = 3;
          res.fx.push({ x, y, z, kind: s.kind, what: 'trip' });
          triggers.push({ s, x, y, z });
          break;
        }
        case TrapKind.Timer: {
          s.timer += dt;
          if (s.timer >= s.interval) {
            s.timer = 0;
            res.fx.push({ x, y, z, kind: s.kind, what: 'trip' });
            triggers.push({ s, x, y, z });
          }
          break;
        }
        case TrapKind.Lever:
          if (s.on) latched.push({ key: k, x, y, z, state: s });
          break;
        case TrapKind.FallTrap:
        case TrapKind.WallTrap: {
          if (!s.on) break;
          s.hold -= dt;
          if (s.hold <= 0) {
            s.on = false; s.hold = 0;
            res.writes.push({ x, y, z, block: blockFor(s.kind, false) });
            res.fx.push({ x, y, z, kind: s.kind, what: 'reset' });
            res.changed.push(k);
          }
          break;
        }
        case TrapKind.Claymore: {
          const d = FACING_DIRS[s.facing] ?? FACING_DIRS[0];
          const tripped = targets.some(t => {
            if (!trapHostile(s, t)) return false;
            const cx = t.x - x - 0.5, cz = t.z - z - 0.5;
            const dist = Math.hypot(cx, cz);
            if (dist > 4.5 || Math.abs(t.y - y) > 2) return false;
            return (cx * d[0] + cz * d[2]) / (dist || 1) > 0.55;
          });
          if (tripped) this.detonateClaymore(k, s, x, y, z, res, targets, solid);
          break;
        }
        case TrapKind.FlameJet: {
          if (s.timer > 0) {
            const before = s.timer;
            s.timer = Math.max(0, s.timer - dt);
            // Scorch in quarter-second pulses while the jet is lit.
            if (Math.floor(before * 4) !== Math.floor(s.timer * 4)) {
              const d = FACING_DIRS[s.facing] ?? FACING_DIRS[0];
              for (const t of targets) {
                if (!trapHostile(s, t)) continue;
                const cx = t.x - x - 0.5, cy = t.y + 0.9 - y - 0.5, cz = t.z - z - 0.5;
                const along = cx * d[0] + cy * d[1] + cz * d[2];
                if (along < 0 || along > 4.5) continue;
                const lat = Math.hypot(cx - d[0] * along, cy - d[1] * along, cz - d[2] * along);
                if (lat > (d[1] ? 0.9 : 1.3)) continue;
                this.hit(res, s, t, x, y, z, 1.5, [{ kind: 'burning', seconds: 4 }]);
              }
            }
            if (s.timer <= 0) { s.cooldown = 4; res.fx.push({ x, y, z, kind: s.kind, what: 'reset' }); res.changed.push(k); }
            break;
          }
          if (inLine(s, x, y, z, 4.5, 1.2, targets, solid)) this.startFlame(k, s, x, y, z, res);
          break;
        }
        case TrapKind.DartLauncher:
        case TrapKind.NetLauncher: {
          if (s.cooldown > 0) break;
          const dart = s.kind === TrapKind.DartLauncher;
          const t = inLine(s, x, y, z, dart ? 9 : 6, 0.9, targets, solid);
          if (t) this.shoot(k, s, x, y, z, t, res);
          break;
        }
        case TrapKind.AlarmBell: {
          if (s.cooldown > 0) break;
          const who = targets.find(t => trapHostile(s, t) &&
            Math.hypot(t.x - x - 0.5, t.y - y, t.z - z - 0.5) <= 6);
          if (who) this.ring(k, s, x, y, z, who.name, res);
          break;
        }
      }
    }

    for (const t of triggers) this.signal(t.s.owner, t.s.channel, t.x, t.y, t.z, 0.5, res, targets, solid);
    // A latched lever holds its channel open every tick.
    for (const l of latched) this.signal(l.state.owner, l.state.channel, l.x, l.y, l.z, 0.3, res, targets, solid);
    return res;
  }
}

/** Solid-block query helper for hosts that only have a block getter. */
export function solidFrom(getBlock: (x: number, y: number, z: number) => number): SolidFn {
  return (x, y, z) => y >= 0 && y < 256 && isSolid(getBlock(x, y, z));
}

/** Legacy radius-flip rule (pre-channel levers). Still exported for old
 *  smoke checks; the live game routes levers through TrapField.pull. */
export interface TrapFlip { x: number; y: number; z: number; block: number }
export function leverFlips(
  getBlock: (x: number, y: number, z: number) => number,
  x: number, y: number, z: number,
): TrapFlip[] {
  if (!isLeverBlock(getBlock(x, y, z))) return [];
  const out: TrapFlip[] = [];
  for (let dx = -LEVER_RADIUS; dx <= LEVER_RADIUS; dx++) {
    for (let dy = -LEVER_RADIUS; dy <= LEVER_RADIUS; dy++) {
      for (let dz = -LEVER_RADIUS; dz <= LEVER_RADIUS; dz++) {
        const bx = x + dx, by = y + dy, bz = z + dz;
        if (by < 0 || by >= 256) continue;
        const id = getBlock(bx, by, bz);
        const isPulled = bx === x && by === y && bz === z;
        if (!isPulled && isLeverBlock(id)) continue;
        const flipped = flippedTrap(id);
        if (flipped >= 0) out.push({ x: bx, y: by, z: bz, block: flipped });
      }
    }
  }
  return out;
}
