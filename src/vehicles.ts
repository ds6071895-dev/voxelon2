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
/**
 * Oil burned per second just keeping the rotors lit with a pilot in the seat.
 * A helicopter is deliberately the most fuel-hungry thing in the game: the
 * turbine is running whether or not you are going anywhere, so simply hovering
 * drains the tank and every sortie has to be planned around the return leg.
 */
export const HELI_FUEL_IDLE = 0.40;
/** Extra oil per second at full control deflection (on top of the idle burn). */
export const HELI_FUEL_BURN = 1.00;
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

/**
 * Half-extents of the airframe's collision box in HULL-LOCAL space (+Z nose).
 * The old sim tested a single point at the hub, so a cabin-sized helicopter
 * could sit two thirds of the way inside a cliff without ever registering a
 * touch. The whole box is sampled now, so the thing you can see is the thing
 * that collides. The rotor disc is deliberately NOT included — clipping blade
 * tips is far less annoying than an aircraft that cannot fit through a valley.
 */
export const HELI_HALF: Vec3 = { x: 1.05, y: 0.95, z: 2.2 };
/** Hub height above the terrain when the skids are down. */
export const HELI_GROUND_CLEARANCE = 1.25;
/** Impact speed (blocks/s) at or below which a nudge into a wall costs nothing. */
export const HELI_CRASH_FLOOR = 4;
/** Descent speed you may set down at before the skids start costing hull.
 *  Terrain gets a far bigger grace than a wall: landing firmly is landing. */
export const HELI_LAND_FLOOR = 9;
/** Hull damage per block/s of impact speed above the floor. */
export const HELI_CRASH_DAMAGE = 14;
/** Extra occupant damage per block/s of impact speed when the hull bursts. */
export const CRASH_EJECT_DAMAGE = 1.6;
/** An ejected occupant is thrown clear at this multiple of the airframe's
 *  velocity, plus a hard upward kick, so a crash physically launches you. */
export const EJECT_LAUNCH = 1.25;
export const EJECT_LAUNCH_UP = 9;
/** Landed + this slow counts as parked, which is where servicing is allowed. */
export const LANDED_SPEED = 1.2;

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

/** Why an airframe stopped flying — drives the effect and the message. */
export type HeliLossReason = 'shot' | 'crash' | 'flameout';

export type VehicleEvent =
  | { kind: 'bombRelease'; bomb: BombSnapshot; heliId: number }
  | { kind: 'bombImpact'; id: number; faction: number; owner: string;
      x: number; y: number; z: number; radius: number;
      playerDamage: number; hardwareDamage: number }
  | { kind: 'heliDown'; id: number; x: number; y: number; z: number; faction: number;
      reason: HeliLossReason }
  /** An occupant is thrown clear. `v*` is the impulse to give their body. */
  | { kind: 'eject'; heliId: number; playerId: number; x: number; y: number; z: number;
      vx: number; vy: number; vz: number; damage: number; reason: HeliLossReason }
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

/**
 * Seat PAN offsets in the airframe's local space (right-handed, +Z forward).
 *
 * On a +Z-forward model with Y up the aircraft's own starboard side is local
 * −X, so the pilot (port seat) sits at +X. Both seats are side by side at the
 * front of the cabin: the gunner needs the windscreen as much as the pilot
 * does, and a back seat could only ever see the bulkhead in front of it.
 */
export const SEAT_OFFSETS: Record<SeatKind, Vec3> = {
  pilot: { x: 0.46, y: -0.45, z: 0.6 },
  passenger: { x: -0.46, y: -0.45, z: 0.6 },
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
    // Measured from the rotor hub, so it has to clear the length of the cabin.
    if (d > 6) return { ok: false, reason: 'Move closer to board.' };
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

  /**
   * Can this player's gun fire from where they are sitting? A gunner gets a wide
   * forward arc — strapped into a seat you cannot swing a rifle through the
   * bulkhead behind you — and a pilot with both hands on the controls does not
   * shoot at all. Someone who is not aboard anything is not our business.
   */
  passengerCanFire(playerId: number, aimYaw: number): boolean {
    const found = this.seatOf(playerId);
    if (!found) return true;
    if (found.seat === 'pilot') return false;
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
      // Off the belly rack, clear of the skids, carrying the airframe's own
      // momentum so a fast run genuinely leads the target.
      position: { x: h.position.x, y: h.position.y - 1.3, z: h.position.z },
      velocity: { x: h.velocity.x, y: Math.min(0, h.velocity.y), z: h.velocity.z },
      radius: stats.bombRadius, playerDamage: stats.bombPlayerDamage,
      hardwareDamage: stats.bombHardwareDamage, age: 0,
    };
    this.bombs.set(bomb.id, bomb);
    return [{ kind: 'bombRelease', bomb: bombSnapshot(bomb), heliId: h.id }];
  }

  damage(id: number, amount: number, reason: HeliLossReason = 'shot'): VehicleEvent[] {
    const h = this.helicopters.get(id);
    if (!h || h.dying > 0 || !Number.isFinite(amount) || amount <= 0) return [];
    h.hp = Math.max(0, h.hp - amount);
    if (h.hp > 0) return [];
    return this.destroy(h, reason);
  }

  /**
   * The airframe stops being an aircraft: everyone aboard is thrown clear along
   * the airframe's own momentum (a crash genuinely launches you, and lands you
   * hurt), and the wreck spins into the ground before it is removed.
   */
  private destroy(
    h: HelicopterState, reason: HeliLossReason = 'shot', extraDamage = 0,
    impulse?: Vec3,
  ): VehicleEvent[] {
    const out: VehicleEvent[] = [{
      kind: 'heliDown', id: h.id, faction: h.faction,
      x: h.position.x, y: h.position.y, z: h.position.z, reason,
    }];
    // A crash resolves the collision before it reports it, so the caller passes
    // the velocity the airframe had on the way IN — otherwise everyone would be
    // thrown clear at exactly zero.
    const v = impulse ?? h.velocity;
    for (const seat of ['pilot', 'passenger'] as SeatKind[]) {
      const pid = seat === 'pilot' ? h.pilotId : h.passengerId;
      if (pid === null) continue;
      const at = seatPosition(h, seat);
      out.push({
        kind: 'eject', heliId: h.id, playerId: pid,
        x: at.x, y: at.y + 1.2, z: at.z,
        vx: v.x * EJECT_LAUNCH,
        vy: Math.max(0, v.y * 0.4) + EJECT_LAUNCH_UP,
        vz: v.z * EJECT_LAUNCH,
        damage: EJECT_DAMAGE + extraDamage, reason,
      });
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

  /** True when the airframe is parked on the pad it belongs to. */
  atPad(h: HelicopterState): boolean {
    return Math.hypot(h.position.x - (h.padX + 0.5), h.position.z - (h.padZ + 0.5)) <= 4 &&
      Math.abs(h.position.y - (h.padY + 1.6)) <= 3;
  }

  /**
   * True when the airframe is sitting still on the ground. Servicing keys off
   * THIS rather than off a helipad: needing to build a pad wherever you want to
   * top up made the whole airframe feel tethered, while "you must actually be
   * landed and stopped" keeps the rule that matters — a gunship can never be
   * repaired or rearmed mid-raid.
   */
  landed(h: HelicopterState): boolean {
    if (h.dying > 0) return false;
    const floor = this.env.groundY(h.position.x, h.position.z) + HELI_GROUND_CLEARANCE;
    return h.position.y <= floor + 1.2 &&
      Math.hypot(h.velocity.x, h.velocity.y, h.velocity.z) <= LANDED_SPEED;
  }

  /** Where servicing and retrofits are allowed: parked on a pad, or simply
   *  landed and stopped anywhere in the world. */
  canService(h: HelicopterState): boolean {
    return this.atPad(h) || this.landed(h);
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
      this.integrate(h, dt, out);
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
      this.integrate(h, dt, out);
      return;
    }
    h.unpiloted = 0;

    // FUEL. The turbine burns whether or not you are asking it for anything, so
    // hovering costs real oil; deflection on top of that costs a lot more.
    if (powered) {
      const demand = Math.min(1, (Math.abs(input.forward) + Math.abs(input.strafe) +
        Math.abs(input.lift)) / 2);
      h.fuel = Math.max(0, h.fuel - (HELI_FUEL_IDLE + HELI_FUEL_BURN * demand) * dt);
      if (h.fuel <= 0) {
        // Flameout: the rotor stops driving, everyone aboard is thrown clear and
        // the airframe falls. Running the tank dry over enemy ground is fatal,
        // which is the entire point of making it this thirsty.
        out.push(...this.destroy(h, 'flameout'));
        return;
      }
    }

    // Heading follows the pilot's steering, smoothed so the model turns rather
    // than snapping to the mouse.
    const dy = Math.atan2(Math.sin(input.yaw - h.rotation.y), Math.cos(input.yaw - h.rotation.y));
    const turn = Math.max(-2.6 * dt, Math.min(2.6 * dt, dy));
    h.rotation.y += turn;

    const thrust = powered ? 1 : 0.15; // dead engine = a gliding autorotation
    const c = Math.cos(h.rotation.y), s = Math.sin(h.rotation.y);
    const fwd = input.forward * stats.speed * thrust;
    // The authored airframe faces LOCAL +Z, so with Y up its own right-hand side
    // is local −X (right = forward × up). Mapping a positive `strafe` straight
    // onto +X therefore flew the aircraft to the pilot's LEFT when they pressed
    // D. Negate it once, here, so D means starboard everywhere.
    const side = -input.strafe * stats.speed * 0.6 * thrust;
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
    // so every viewer sees the same attitude. Positive roll drops the starboard
    // side, which is the way you lean when you slide right or turn right (a
    // right turn is a DECREASING heading, hence the negated turn term).
    const bank = input.strafe * 0.42 - turn / Math.max(dt, 1e-3) * 0.10;
    h.rotation.z += (Math.max(-0.7, Math.min(0.7, bank)) - h.rotation.z) * Math.min(1, 5 * dt);
    h.rotation.x += (-input.forward * 0.26 - h.rotation.x) * Math.min(1, 5 * dt);

    this.integrate(h, dt, out);
  }

  /**
   * Is any corner, edge-midpoint or face-centre of the airframe's box inside a
   * solid cell at this position? Sampling the WHOLE box is the fix for a
   * helicopter that could park two thirds of the way inside a cliff: the old
   * test asked about a single point at the rotor hub, which is empty air for
   * almost every way an aircraft can be embedded in terrain.
   */
  private blocked(h: HelicopterState, x: number, y: number, z: number): boolean {
    const c = Math.cos(h.rotation.y), s = Math.sin(h.rotation.y);
    for (let ix = -1; ix <= 1; ix++) {
      for (let iy = -1; iy <= 1; iy++) {
        for (let iz = -1; iz <= 1; iz++) {
          const lx = ix * HELI_HALF.x, lz = iz * HELI_HALF.z;
          const wx = x + lx * c + lz * s;
          const wy = y + iy * HELI_HALF.y;
          const wz = z - lx * s + lz * c;
          if (this.env.solid(wx, wy, wz) || this.env.vaultArena(wx, wy, wz)) return true;
        }
      }
    }
    return false;
  }

  /**
   * Move + collide + clamp, one axis at a time so a glancing touch slides along
   * a wall instead of stopping dead. Anything faster than a nudge costs hull,
   * and a genuine crash — cruising into a mountain — destroys the airframe
   * outright and throws the crew through the windscreen.
   */
  private integrate(h: HelicopterState, dt: number, out: VehicleEvent[]): void {
    const half = this.env.worldHalf;
    const pre: Vec3 = { x: h.velocity.x, y: h.velocity.y, z: h.velocity.z };
    let { x, y, z } = h.position;
    let hit = 0;         // worst blocked closing speed this step
    let groundHit = 0;   // vertical arrival speed at the terrain floor

    const stepX = Math.max(-half, Math.min(half, x + h.velocity.x * dt));
    if (!this.blocked(h, stepX, y, z)) x = stepX;
    else { hit = Math.max(hit, Math.abs(h.velocity.x)); h.velocity.x = 0; }

    const stepZ = Math.max(-half, Math.min(half, z + h.velocity.z * dt));
    if (!this.blocked(h, x, y, stepZ)) z = stepZ;
    else { hit = Math.max(hit, Math.abs(h.velocity.z)); h.velocity.z = 0; }

    const stepY = y + h.velocity.y * dt;
    if (!this.blocked(h, x, stepY, z)) y = stepY;
    else {
      if (h.velocity.y < 0) groundHit = Math.max(groundHit, -h.velocity.y);
      else hit = Math.max(hit, h.velocity.y);
      h.velocity.y = 0;
    }

    // If the pose we kept is STILL inside something — a chunk streamed in around
    // it, or someone built under it — push straight up until it is clear. An
    // airframe must never end a tick embedded in the world.
    for (let lift = 0; lift < 10 && this.blocked(h, x, y, z); lift++) y += 0.5;

    const floor = this.env.groundY(x, z) + HELI_GROUND_CLEARANCE;
    if (y < floor) {
      groundHit = Math.max(groundHit, -h.velocity.y);
      y = floor;
      h.velocity.y = Math.max(0, h.velocity.y);
    }
    h.position = { x, y, z };

    if (h.dying > 0) return;
    // Terrain gets a much larger grace than a wall does: setting down firmly is
    // landing, and flying into a cliff face is not.
    const impact = Math.max(
      hit - HELI_CRASH_FLOOR, groundHit - HELI_LAND_FLOOR, 0);
    if (impact <= 0) return;
    h.hp = Math.max(0, h.hp - impact * HELI_CRASH_DAMAGE);
    if (h.hp <= 0) {
      out.push(...this.destroy(h, 'crash', impact * CRASH_EJECT_DAMAGE, pre));
    }
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
