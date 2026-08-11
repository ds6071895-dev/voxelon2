// VEHICLES — the generic server-owned vehicle + seat foundation, and the
// helicopter built on top of it.
//
// Same contract as strategic.ts: PURE, transport-agnostic, fixed-step, and the
// single source of truth for movement, seats, fuel, bombs and damage. Clients
// send INPUT (a small normalized intent), never positions; they render the
// snapshot they get back and predict nothing that matters.

import {
  HelicopterStats, blastDamage, clampTier, helicopterStats,
} from './warfare';

const MAX_OWNER_LEN = 24;

/** Gravity applied to a released bomb (blocks/s²). */
export const BOMB_GRAVITY = 22;
/** Oil burned per second of powered flight. */
export const HELI_FUEL_BURN = 0.11;
/** Occupants may only step off this close to solid ground. */
export const DISMOUNT_CLEARANCE = 3.5;
/** Damage each occupant takes when the airframe bursts under them. */
export const EJECT_DAMAGE = 8;
/** Seconds of dying rotor-down before the wreck is removed. */
export const WRECK_SECONDS = 2.4;
/** Blocks/s the airframe sinks on its own after the pilot disconnects. */
export const AUTOLAND_DESCENT = 3.5;
/** A passenger may only fire within this half-arc off the airframe's nose. */
export const PASSENGER_ARC = Math.PI * 0.62;

export type SeatKind = 'pilot' | 'passenger';

/** Player/camera yaw faces -Z at zero; the authored airframe faces +Z. */
export function viewYawToHeliYaw(yaw: number): number {
  return Math.atan2(Math.sin(yaw + Math.PI), Math.cos(yaw + Math.PI));
}

export interface Vec3 { x: number; y: number; z: number }

export interface HelicopterState {
  id: number;
  owner: string;
  faction: number;
  position: Vec3;
  /** yaw = heading, pitch = nose attitude, roll = bank. */
  rotation: Vec3;
  velocity: Vec3;
  hp: number;
  maxHp: number;
  fuel: number;
  bombs: number;
  tier: number;
  pilotId: number | null;
  passengerId: number | null;
  /** Seconds until the next bomb may be released. */
  bombCooldown: number;
  /** Rotor phase (radians) — server-driven so every viewer agrees. */
  rotor: number;
  /** Seconds of wreck animation left; > 0 means it is falling out of the sky. */
  dying: number;
  /** Seconds the airframe has been pilotless (drives the controlled descent). */
  unpiloted: number;
  /** The helipad this airframe was spawned from (refuel/repair/upgrade anchor). */
  padX: number; padY: number; padZ: number;
}

/** One frame of pilot intent. Every field is clamped — a forged input can only
 *  ever ask for full deflection, never for teleportation. */
export interface HeliInput {
  /** −1..1 forward/back along the nose. */
  forward: number;
  /** −1..1 strafe. */
  strafe: number;
  /** −1..1 climb/descend. */
  lift: number;
  /** Absolute heading the pilot is steering to (radians). */
  yaw: number;
  /** Sequence number — an out-of-order or replayed input is dropped. */
  seq: number;
}

export function sanitizeHeliInput(raw: unknown): HeliInput | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const num = (v: unknown, lo: number, hi: number): number => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : 0;
  };
  const seq = Number(r.seq);
  if (!Number.isSafeInteger(seq) || seq < 0) return null;
  const yaw = Number(r.yaw);
  return {
    forward: num(r.forward, -1, 1),
    strafe: num(r.strafe, -1, 1),
    lift: num(r.lift, -1, 1),
    yaw: Number.isFinite(yaw) ? yaw : 0,
    seq,
  };
}

export interface BombState {
  id: number;
  heliId: number;
  faction: number;
  owner: string;
  position: Vec3;
  velocity: Vec3;
  radius: number;
  playerDamage: number;
  hardwareDamage: number;
  /** Seconds alive, so a bomb dropped over a void still expires. */
  age: number;
}

export interface BombSnapshot {
  id: number; x: number; y: number; z: number;
  vx: number; vy: number; vz: number; faction: number;
}

export interface HelicopterSnapshot {
  id: number; faction: number; owner: string;
  x: number; y: number; z: number;
  yaw: number; pitch: number; roll: number;
  hp: number; maxHp: number; fuel: number; maxFuel: number;
  bombs: number; maxBombs: number; tier: number;
  pilot: number; passenger: number;
  rotor: number; dying: number;
}

export function helicopterSnapshot(h: HelicopterState): HelicopterSnapshot {
  const stats = helicopterStats(h.tier);
  return {
    id: h.id, faction: h.faction, owner: h.owner,
    x: r2(h.position.x), y: r2(h.position.y), z: r2(h.position.z),
    yaw: r3(h.rotation.y), pitch: r3(h.rotation.x), roll: r3(h.rotation.z),
    hp: Math.round(h.hp), maxHp: h.maxHp, fuel: r2(h.fuel), maxFuel: stats.fuel,
    bombs: h.bombs, maxBombs: stats.bombs, tier: h.tier,
    pilot: h.pilotId ?? 0, passenger: h.passengerId ?? 0,
    rotor: r3(h.rotor), dying: r2(h.dying),
  };
}

export function bombSnapshot(b: BombState): BombSnapshot {
  return {
    id: b.id, x: r2(b.position.x), y: r2(b.position.y), z: r2(b.position.z),
    vx: r2(b.velocity.x), vy: r2(b.velocity.y), vz: r2(b.velocity.z),
    faction: b.faction,
  };
}

function r2(n: number): number { return Math.round(n * 100) / 100; }
function r3(n: number): number { return Math.round(n * 1000) / 1000; }

export type VehicleEvent =
  | { kind: 'bombRelease'; bomb: BombSnapshot; heliId: number }
  | { kind: 'bombImpact'; id: number; faction: number; owner: string;
      x: number; y: number; z: number; radius: number;
      playerDamage: number; hardwareDamage: number }
  | { kind: 'heliDown'; id: number; x: number; y: number; z: number; faction: number }
  | { kind: 'eject'; heliId: number; playerId: number; x: number; y: number; z: number;
      damage: number }
  | { kind: 'heliRemoved'; id: number };

export interface VehicleEnv {
  /** Is this world position inside a solid block? */
  solid: (x: number, y: number, z: number) => boolean;
  /** Terrain/edit surface height under a column. */
  groundY: (x: number, z: number) => number;
  worldHalf: number;
  /** True when this column sits inside a sealed vault arena (no-fly). */
  vaultArena: (x: number, y: number, z: number) => boolean;
}

/** Seat offsets in the airframe's local space (right-handed, +Z forward). */
export const SEAT_OFFSETS: Record<SeatKind, Vec3> = {
  pilot: { x: -0.42, y: -0.22, z: 0.55 },
  passenger: { x: 0.42, y: -0.22, z: -0.35 },
};

/** World-space position of a seat, given the airframe's pose. */
export function seatPosition(h: HelicopterState, seat: SeatKind): Vec3 {
  const o = SEAT_OFFSETS[seat];
  const c = Math.cos(h.rotation.y), s = Math.sin(h.rotation.y);
  return {
    x: h.position.x + o.x * c + o.z * s,
    y: h.position.y + o.y,
    z: h.position.z - o.x * s + o.z * c,
  };
}

export class VehicleSim {
  readonly helicopters = new Map<number, HelicopterState>();
  readonly bombs = new Map<number, BombState>();
  private readonly inputs = new Map<number, HeliInput>();
  private readonly lastSeq = new Map<number, number>();
  private nextId = 1;

  constructor(private readonly env: VehicleEnv) {}

  seedIds(highest: number): void {
    if (Number.isFinite(highest)) this.nextId = Math.max(this.nextId, Math.floor(highest) + 1);
  }
  allocId(): number { return this.nextId++; }
  /** The id the NEXT allocation would use, without consuming it (serialization
   *  must never have a side effect). */
  peekNextId(): number { return this.nextId; }

  spawn(
    owner: string, faction: number, pad: Vec3, tier = 1,
  ): HelicopterState {
    const stats = helicopterStats(tier);
    const h: HelicopterState = {
      id: this.allocId(),
      owner: (owner ?? '').slice(0, MAX_OWNER_LEN), faction,
      position: { x: pad.x + 0.5, y: pad.y + 1.6, z: pad.z + 0.5 },
      rotation: { x: 0, y: 0, z: 0 },
      velocity: { x: 0, y: 0, z: 0 },
      hp: stats.hp, maxHp: stats.hp, fuel: 0, bombs: 0, tier: clampTier(tier),
      pilotId: null, passengerId: null, bombCooldown: 0, rotor: 0, dying: 0,
      unpiloted: 0, padX: pad.x, padY: pad.y, padZ: pad.z,
    };
    this.helicopters.set(h.id, h);
    return h;
  }

  remove(id: number): void {
    this.helicopters.delete(id);
    this.inputs.delete(id);
    this.lastSeq.delete(id);
  }

  seatOf(playerId: number): { heli: HelicopterState; seat: SeatKind } | null {
    for (const h of this.helicopters.values()) {
      if (h.pilotId === playerId) return { heli: h, seat: 'pilot' };
      if (h.passengerId === playerId) return { heli: h, seat: 'passenger' };
    }
    return null;
  }

  /** Take a seat. Returns the seat taken, or a refusal reason. */
  mount(
    id: number, playerId: number, faction: number, from: Vec3, want?: SeatKind,
  ): { ok: true; seat: SeatKind } | { ok: false; reason: string } {
    const h = this.helicopters.get(id);
    if (!h) return { ok: false, reason: 'That helicopter is gone.' };
    if (h.dying > 0) return { ok: false, reason: 'That airframe is going down.' };
    if (h.faction !== faction) return { ok: false, reason: 'Only your faction can board it.' };
    if (this.seatOf(playerId)) return { ok: false, reason: 'You are already aboard.' };
    const d = Math.hypot(from.x - h.position.x, from.y - h.position.y, from.z - h.position.z);
    if (d > 4.5) return { ok: false, reason: 'Move closer to board.' };
    const free: SeatKind[] = [];
    if (h.pilotId === null) free.push('pilot');
    if (h.passengerId === null) free.push('passenger');
    if (!free.length) return { ok: false, reason: 'Both seats are taken.' };
    const seat = want && free.includes(want) ? want : free[0];
    if (seat === 'pilot') h.pilotId = playerId; else h.passengerId = playerId;
    if (seat === 'pilot') { h.unpiloted = 0; this.lastSeq.delete(h.id); }
    return { ok: true, seat };
  }

  /** Step off. This is always available; leaving at altitude means falling. */
  dismount(playerId: number, _force = false): { ok: boolean; reason?: string; at?: Vec3 } {
    const found = this.seatOf(playerId);
    if (!found) return { ok: false, reason: 'You are not aboard anything.' };
    const { heli: h, seat } = found;
    if (seat === 'pilot') { h.pilotId = null; this.inputs.delete(h.id); }
    else h.passengerId = null;
    return { ok: true, at: seatPosition(h, seat) };
  }

  /** Queue a pilot input frame. Out-of-order/replayed frames are dropped. */
  setInput(playerId: number, raw: unknown): boolean {
    const found = this.seatOf(playerId);
    if (!found || found.seat !== 'pilot') return false;
    const input = sanitizeHeliInput(raw);
    if (!input) return false;
    const last = this.lastSeq.get(found.heli.id) ?? -1;
    if (input.seq <= last) return false;
    this.lastSeq.set(found.heli.id, input.seq);
    this.inputs.set(found.heli.id, input);
    return true;
  }

  /** Can this player's gun fire from where they are sitting? Passengers get a
   *  side arc; a pilot flying the thing does not shoot. */
  passengerCanFire(playerId: number, aimYaw: number): boolean {
    const found = this.seatOf(playerId);
    if (!found || found.seat !== 'passenger') return true; // not our business
    const heliAim = viewYawToHeliYaw(aimYaw);
    const rel = Math.atan2(Math.sin(heliAim - found.heli.rotation.y),
      Math.cos(heliAim - found.heli.rotation.y));
    return Math.abs(rel) <= PASSENGER_ARC;
  }

  /** Release one bomb from the pilot's airframe. */
  dropBomb(playerId: number): VehicleEvent[] {
    const found = this.seatOf(playerId);
    if (!found || found.seat !== 'pilot') return [];
    const h = found.heli;
    if (h.dying > 0 || h.bombs < 1 || h.bombCooldown > 0) return [];
    const stats = helicopterStats(h.tier);
    h.bombs -= 1;
    h.bombCooldown = stats.bombCooldown;
    const bomb: BombState = {
      id: this.allocId(), heliId: h.id, faction: h.faction, owner: h.owner,
      position: { x: h.position.x, y: h.position.y - 0.9, z: h.position.z },
      velocity: { x: h.velocity.x, y: Math.min(0, h.velocity.y), z: h.velocity.z },
      radius: stats.bombRadius, playerDamage: stats.bombPlayerDamage,
      hardwareDamage: stats.bombHardwareDamage, age: 0,
    };
    this.bombs.set(bomb.id, bomb);
    return [{ kind: 'bombRelease', bomb: bombSnapshot(bomb), heliId: h.id }];
  }

  damage(id: number, amount: number): VehicleEvent[] {
    const h = this.helicopters.get(id);
    if (!h || h.dying > 0 || !Number.isFinite(amount) || amount <= 0) return [];
    h.hp = Math.max(0, h.hp - amount);
    if (h.hp > 0) return [];
    return this.destroy(h);
  }

  private destroy(h: HelicopterState): VehicleEvent[] {
    const out: VehicleEvent[] = [{
      kind: 'heliDown', id: h.id, faction: h.faction,
      x: h.position.x, y: h.position.y, z: h.position.z,
    }];
    for (const seat of ['pilot', 'passenger'] as SeatKind[]) {
      const pid = seat === 'pilot' ? h.pilotId : h.passengerId;
      if (pid === null) continue;
      const at = seatPosition(h, seat);
      out.push({ kind: 'eject', heliId: h.id, playerId: pid,
        x: at.x, y: at.y, z: at.z, damage: EJECT_DAMAGE });
    }
    h.pilotId = null;
    h.passengerId = null;
    h.dying = WRECK_SECONDS;
    this.inputs.delete(h.id);
    return out;
  }

  /** Refuel / rearm / repair at a helipad. Returns what was actually consumed. */
  service(
    h: HelicopterState, oil: number, bombs: number, repair: number,
  ): { oil: number; bombs: number; repair: number } {
    const stats = helicopterStats(h.tier);
    // Fuel burns fractionally, so the deficit is almost never a whole number.
    // Rounding DOWN here while the client debits the rounded-up count destroys
    // a barrel on essentially every refuel — take the ceiling instead, and let
    // the tank cap the result.
    const takeOil = Math.max(0, Math.min(Math.floor(oil), Math.ceil(stats.fuel - h.fuel)));
    h.fuel = Math.min(stats.fuel, h.fuel + takeOil);
    const takeBombs = Math.max(0, Math.min(Math.floor(bombs), stats.bombs - h.bombs));
    h.bombs += takeBombs;
    // One repair kit restores a quarter of the bar.
    const perKit = Math.ceil(h.maxHp * 0.25);
    const kits = Math.max(0, Math.min(Math.floor(repair), Math.ceil((h.maxHp - h.hp) / perKit)));
    h.hp = Math.min(h.maxHp, h.hp + kits * perKit);
    return { oil: takeOil, bombs: takeBombs, repair: kits };
  }

  retrofit(h: HelicopterState, tier: number): boolean {
    const next = clampTier(tier);
    if (next <= h.tier) return false;
    const before = h.maxHp;
    h.tier = next;
    const stats = helicopterStats(next);
    h.maxHp = stats.hp;
    h.hp = Math.min(h.maxHp, h.hp + Math.max(0, h.maxHp - before));
    h.fuel = Math.min(h.fuel, stats.fuel);
    h.bombs = Math.min(h.bombs, stats.bombs);
    return true;
  }

  /** True when the airframe is parked on the pad it belongs to (services and
   *  retrofits are pad-only, so a gunship can never be repaired mid-raid). */
  atPad(h: HelicopterState): boolean {
    return Math.hypot(h.position.x - (h.padX + 0.5), h.position.z - (h.padZ + 0.5)) <= 4 &&
      Math.abs(h.position.y - (h.padY + 1.6)) <= 3;
  }

  // --- the tick ---------------------------------------------------------------

  tick(dt: number): VehicleEvent[] {
    if (!Number.isFinite(dt) || dt <= 0) return [];
    dt = Math.min(dt, 0.25);
    const out: VehicleEvent[] = [];
    for (const h of [...this.helicopters.values()]) this.stepHeli(h, dt, out);
    for (const b of [...this.bombs.values()]) this.stepBomb(b, dt, out);
    return out;
  }

  private stepHeli(h: HelicopterState, dt: number, out: VehicleEvent[]): void {
    const stats: HelicopterStats = helicopterStats(h.tier);
    h.bombCooldown = Math.max(0, h.bombCooldown - dt);

    if (h.dying > 0) {
      // Emergency rotor slowdown, nose over, and drop.
      h.dying = Math.max(0, h.dying - dt);
      h.rotor += dt * 6 * (h.dying / WRECK_SECONDS);
      h.rotation.z += dt * 1.6;
      h.rotation.x = Math.max(-0.9, h.rotation.x - dt * 0.7);
      h.velocity.y -= 18 * dt;
      this.integrate(h, dt);
      if (h.dying === 0) {
        this.remove(h.id);
        out.push({ kind: 'heliRemoved', id: h.id });
      }
      return;
    }

    const input = h.pilotId !== null ? this.inputs.get(h.id) : undefined;
    const powered = !!input && h.fuel > 0;
    h.rotor += dt * (powered ? 34 : h.pilotId !== null ? 20 : 8);

    // A seated pilot who has not sent an input frame yet (the gap between
    // boarding and their first `heliInput`) flies exactly like a pilotless
    // airframe: rotors idling, holding station. Anything else would dereference
    // an input that does not exist yet.
    if (h.pilotId === null || !input) {
      // Pilot disconnect / step-off: a controlled hover that settles, never a
      // permanently parked airframe in the sky. A pilot who is aboard but has
      // not steered yet only holds station — they are not "gone".
      const abandoned = h.pilotId === null;
      if (abandoned) h.unpiloted += dt;
      h.velocity.x *= Math.pow(0.06, dt);
      h.velocity.z *= Math.pow(0.06, dt);
      const ground = this.env.groundY(h.position.x, h.position.z);
      h.velocity.y = abandoned && h.position.y - ground > 1.6 ? -AUTOLAND_DESCENT : 0;
      h.rotation.z *= Math.pow(0.2, dt);
      h.rotation.x *= Math.pow(0.2, dt);
      this.integrate(h, dt);
      return;
    }
    h.unpiloted = 0;

    if (powered) h.fuel = Math.max(0, h.fuel - HELI_FUEL_BURN * dt);

    // Heading follows the pilot's steering, smoothed so the model turns rather
    // than snapping to the mouse.
    const dy = Math.atan2(Math.sin(input.yaw - h.rotation.y), Math.cos(input.yaw - h.rotation.y));
    const turn = Math.max(-2.6 * dt, Math.min(2.6 * dt, dy));
    h.rotation.y += turn;

    const thrust = powered ? 1 : 0.15; // dead engine = a gliding autorotation
    const c = Math.cos(h.rotation.y), s = Math.sin(h.rotation.y);
    const fwd = input.forward * stats.speed * thrust;
    const side = input.strafe * stats.speed * 0.6 * thrust;
    const wantX = fwd * s + side * c;
    const wantZ = fwd * c - side * s;
    const accel = 3.2;
    h.velocity.x += (wantX - h.velocity.x) * Math.min(1, accel * dt);
    h.velocity.z += (wantZ - h.velocity.z) * Math.min(1, accel * dt);

    const ceiling = this.env.groundY(h.position.x, h.position.z) + stats.altitude;
    let wantY = input.lift * stats.climb * thrust;
    if (!powered) wantY = Math.min(wantY, -stats.climb * 0.55);
    if (h.position.y > ceiling && wantY > 0) wantY = 0;
    h.velocity.y += (wantY - h.velocity.y) * Math.min(1, 4 * dt);

    // Bank into the turn and pitch into the run — presentation the server owns
    // so every viewer sees the same attitude.
    const bank = -input.strafe * 0.42 - turn / Math.max(dt, 1e-3) * 0.10;
    h.rotation.z += (Math.max(-0.7, Math.min(0.7, bank)) - h.rotation.z) * Math.min(1, 5 * dt);
    h.rotation.x += (-input.forward * 0.26 - h.rotation.x) * Math.min(1, 5 * dt);

    this.integrate(h, dt);
  }

  /** Move + collide + clamp. Collisions cost hull, so flying into a mountain
   *  is a real mistake rather than a free stop. */
  private integrate(h: HelicopterState, dt: number): void {
    const half = this.env.worldHalf;
    const next = {
      x: h.position.x + h.velocity.x * dt,
      y: h.position.y + h.velocity.y * dt,
      z: h.position.z + h.velocity.z * dt,
    };
    next.x = Math.max(-half, Math.min(half, next.x));
    next.z = Math.max(-half, Math.min(half, next.z));
    const speed = Math.hypot(h.velocity.x, h.velocity.y, h.velocity.z);
    const blocked = this.env.solid(next.x, next.y, next.z) ||
      this.env.vaultArena(next.x, next.y, next.z);
    if (blocked) {
      const impact = Math.max(0, speed - 6);
      h.velocity.x = 0; h.velocity.z = 0;
      h.velocity.y = Math.max(0, h.velocity.y);
      if (impact > 0 && h.dying <= 0) h.hp = Math.max(0, h.hp - impact * 1.4);
      // Nudge back out along the shortest axis so it never wedges inside a wall.
      next.x = h.position.x; next.z = h.position.z;
      if (this.env.solid(next.x, next.y, next.z)) next.y = h.position.y;
    }
    const floor = this.env.groundY(next.x, next.z) + 1.1;
    if (next.y < floor) {
      const drop = Math.max(0, -h.velocity.y - 9);
      if (drop > 0 && h.dying <= 0) h.hp = Math.max(0, h.hp - drop * 1.6);
      next.y = floor;
      h.velocity.y = Math.max(0, h.velocity.y);
    }
    h.position = next;
  }

  private stepBomb(b: BombState, dt: number, out: VehicleEvent[]): void {
    b.age += dt;
    b.velocity.y -= BOMB_GRAVITY * dt;
    b.position.x += b.velocity.x * dt;
    b.position.y += b.velocity.y * dt;
    b.position.z += b.velocity.z * dt;
    const ground = this.env.groundY(b.position.x, b.position.z);
    const hit = b.position.y <= ground ||
      this.env.solid(b.position.x, b.position.y, b.position.z);
    if (!hit && b.age < 20) return;
    this.bombs.delete(b.id);
    out.push({
      kind: 'bombImpact', id: b.id, faction: b.faction, owner: b.owner,
      x: b.position.x, y: Math.max(ground, b.position.y), z: b.position.z,
      radius: b.radius, playerDamage: b.playerDamage, hardwareDamage: b.hardwareDamage,
    });
  }

  snapshot(): HelicopterSnapshot[] {
    return [...this.helicopters.values()].map(helicopterSnapshot);
  }
  bombSnapshots(): BombSnapshot[] {
    return [...this.bombs.values()].map(bombSnapshot);
  }

  /** Clear every occupant (restart / disconnect sweep). */
  clearOccupants(): void {
    for (const h of this.helicopters.values()) {
      h.pilotId = null;
      h.passengerId = null;
      h.unpiloted = 0;
    }
    this.inputs.clear();
    this.lastSeq.clear();
  }
}

/** Blast damage helper shared with the missile layer (linear falloff, once). */
export function bombBlast(
  centre: Vec3, target: Vec3, radius: number, centreDamage: number,
): number {
  return blastDamage(centreDamage,
    Math.hypot(centre.x - target.x, centre.y - target.y, centre.z - target.z), radius);
}

// --- Serialization -------------------------------------------------------------

export function sanitizeHelicopter(raw: unknown): HelicopterState | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const pos = r.position as Record<string, unknown> | undefined;
  if (!pos || ![pos.x, pos.y, pos.z].every((v) => Number.isFinite(v))) return null;
  const tier = clampTier(Number(r.tier));
  const stats = helicopterStats(tier);
  const rot = (r.rotation ?? {}) as Record<string, unknown>;
  const num = (v: unknown, d = 0): number => (Number.isFinite(v) ? Number(v) : d);
  // A record with no usable id is DROPPED, never collapsed onto id 1 — two
  // corrupted rows would otherwise overwrite each other (and a legitimate
  // entity that really is id 1).
  if (!Number.isFinite(r.id) || Math.floor(Number(r.id)) < 1) return null;
  return {
    id: Math.floor(Number(r.id)),
    owner: typeof r.owner === 'string' ? r.owner.slice(0, MAX_OWNER_LEN) : '',
    faction: Number.isFinite(r.faction) ? Math.floor(Number(r.faction)) : -1,
    position: { x: num(pos.x), y: num(pos.y), z: num(pos.z) },
    rotation: { x: num(rot.x), y: num(rot.y), z: 0 },
    velocity: { x: 0, y: 0, z: 0 },
    tier, maxHp: stats.hp,
    hp: Number.isFinite(r.hp) ? Math.max(1, Math.min(stats.hp, Math.round(Number(r.hp)))) : stats.hp,
    fuel: Number.isFinite(r.fuel) ? Math.max(0, Math.min(stats.fuel, Number(r.fuel))) : 0,
    bombs: Number.isFinite(r.bombs) ? Math.max(0, Math.min(stats.bombs, Math.floor(Number(r.bombs)))) : 0,
    // Occupants are ALWAYS cleared on restart — never restore a seated ghost.
    pilotId: null, passengerId: null,
    bombCooldown: 0, rotor: 0, dying: 0, unpiloted: 0,
    padX: Math.floor(num(r.padX)), padY: Math.floor(num(r.padY)), padZ: Math.floor(num(r.padZ)),
  };
}
