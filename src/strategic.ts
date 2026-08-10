// STRATEGIC LAYER — server-owned silos, tactical missiles, interceptor
// batteries and their physical interceptors.
//
// Modelled on VaultEncounter rather than the client-owned Projectiles class:
// ONE authority ticks the whole thing at a fixed rate, emits events, and hands
// the caller a list of things that happened. The caller (server_core online,
// main.ts offline) is the only code that touches the world — this module never
// imports THREE, the DOM or Node, so both ends run the identical numbers.
//
// Missile flight is a deterministic parametric arc from launch point to target,
// so a client can draw a missile smoothly between snapshots without ever
// disagreeing with the server about where it is.

import {
  BatteryStats, INTERCEPTOR_SPEED, MIN_MISSILE_FLIGHT, MISSILE_HULL_HP,
  MAX_MISSILES_IN_FLIGHT, FACTION_LAUNCH_SPACING, MAX_SILOS_PER_FACTION,
  MIN_SILO_SPACING, MAX_BATTERIES_PER_FACTION, MIN_BATTERY_SPACING,
  PROTECTED_RADIUS, SiloStats, batteryStats, blastDamage, clampTier,
  missileFlightTime, siloStats,
} from './warfare';

const MAX_OWNER_LEN = 24;

// --- Entity state -------------------------------------------------------------

export interface SiloState {
  id: number;
  x: number; y: number; z: number;
  owner: string;
  faction: number;
  /** Installed hardware tier (1..6) — NOT the operator's blueprint level. */
  tier: number;
  hp: number;
  maxHp: number;
  /** Loaded Tactical Missiles. */
  ammo: number;
  /** Seconds until this silo may fire again. */
  cooldown: number;
  /** Hatch animation state 0..1 (server-driven so every client agrees). */
  hatch: number;
}

export interface BatteryState {
  id: number;
  x: number; y: number; z: number;
  owner: string;
  faction: number;
  tier: number;
  hp: number;
  maxHp: number;
  /** Loaded Interceptor Missiles. */
  ammo: number;
  /** Seconds until the next interceptor can leave the rail. */
  reload: number;
  /** Seconds of lock accumulated on `target` (resets when the track is lost). */
  lock: number;
  /** Missile id currently claimed by this battery (0 = idle). */
  target: number;
  /** Radar dish heading + rack elevation, for the model. */
  yaw: number;
  pitch: number;
}

export type MissileKind = 'strike' | 'interceptor';

export interface MissileState {
  id: number;
  kind: MissileKind;
  faction: number;
  owner: string;
  /** Launch point. */
  sx: number; sy: number; sz: number;
  /** Aim point (for an interceptor this is refreshed toward its quarry). */
  tx: number; ty: number; tz: number;
  /** Seconds flown / total planned flight time. */
  t: number;
  flight: number;
  /** Live position, recomputed every tick from the arc. */
  x: number; y: number; z: number;
  /** Facing, derived from the trajectory so the model pitches correctly. */
  yaw: number;
  pitch: number;
  /** Hull integrity — accurate gunfire can shoot a strike missile down. */
  hp: number;
  /** Warhead profile, snapshotted from the silo at launch. */
  radius: number;
  playerDamage: number;
  hardwareDamage: number;
  blocks: number;
  /** Interceptors only: the strike missile being chased. */
  chasing: number;
  /** Battery that owns this interceptor (so its claim can be released). */
  batteryId: number;
}

/** Wire-sized missile view — everything a client needs to draw the model. */
export interface MissileSnapshot {
  id: number; kind: MissileKind; faction: number;
  x: number; y: number; z: number; yaw: number; pitch: number;
  tx: number; tz: number; eta: number; radius: number; hp: number;
}

export function missileSnapshot(m: MissileState): MissileSnapshot {
  return {
    id: m.id, kind: m.kind, faction: m.faction,
    x: round2(m.x), y: round2(m.y), z: round2(m.z),
    yaw: round3(m.yaw), pitch: round3(m.pitch),
    tx: round2(m.tx), tz: round2(m.tz),
    eta: round2(Math.max(0, m.flight - m.t)), radius: m.radius, hp: m.hp,
  };
}

function round2(n: number): number { return Math.round(n * 100) / 100; }
function round3(n: number): number { return Math.round(n * 1000) / 1000; }

// --- Events -------------------------------------------------------------------

export type StrategicEvent =
  | { kind: 'launch'; missile: MissileSnapshot; siloId: number }
  | { kind: 'warning'; faction: number; x: number; z: number; eta: number; radius: number }
  | { kind: 'interceptorLaunch'; missile: MissileSnapshot; batteryId: number }
  /** A strike missile stopped existing. `x/y/z` is where. */
  | { kind: 'impact'; id: number; faction: number; owner: string;
      x: number; y: number; z: number; radius: number;
      playerDamage: number; hardwareDamage: number; blocks: number }
  | { kind: 'intercepted'; id: number; byBattery: number; x: number; y: number; z: number }
  | { kind: 'shotDown'; id: number; x: number; y: number; z: number }
  | { kind: 'expired'; id: number };

// --- Protected areas -----------------------------------------------------------

export type ProtectedKind = 'vault' | 'spawn' | 'core' | 'shield' | 'border';

export interface ProtectedArea {
  kind: ProtectedKind;
  x: number; z: number;
  radius: number;
  /** Faction that owns it (cores/shields); -1 for neutral world features. */
  faction: number;
  label: string;
}

export function protectedArea(
  kind: ProtectedKind, x: number, z: number, label: string,
  radius = PROTECTED_RADIUS, faction = -1,
): ProtectedArea {
  return { kind, x, z, radius, faction, label };
}

// --- Launch validation ---------------------------------------------------------

export type LaunchReject =
  | 'unknown-silo' | 'not-yours' | 'no-ammo' | 'cooldown' | 'out-of-range'
  | 'protected' | 'in-flight-cap' | 'faction-spacing' | 'bad-target' | 'destroyed';

export const LAUNCH_REJECT_TEXT: Record<LaunchReject, string> = {
  'unknown-silo': 'That silo no longer exists.',
  'not-yours': 'This silo belongs to another faction.',
  'no-ammo': 'Silo magazine is empty — load a Tactical Missile.',
  'cooldown': 'Silo is still cycling.',
  'out-of-range': 'Target is beyond this silo\'s reach.',
  'protected': 'Target sits inside a protected zone.',
  'in-flight-cap': 'Your faction already has the maximum missiles in flight.',
  'faction-spacing': 'Another silo in your faction fired moments ago.',
  'bad-target': 'Invalid target coordinates.',
  'destroyed': 'This silo has been destroyed.',
};

export interface LaunchRequest {
  siloId: number;
  faction: number;
  /** Ground target. */
  tx: number;
  tz: number;
}

// --- The simulation ------------------------------------------------------------

export interface StrategicEnv {
  /** Ground height at a column (used for the impact point + arc apex). */
  groundY: (x: number, z: number) => number;
  /** Half-extent of the square play area. */
  worldHalf: number;
  /** Areas a strike may never be aimed into. */
  protectedAreas: () => readonly ProtectedArea[];
}

export class StrategicSim {
  readonly silos = new Map<number, SiloState>();
  readonly batteries = new Map<number, BatteryState>();
  readonly missiles = new Map<number, MissileState>();
  /** Last launch time per faction, for the 30s faction-wide spacing. */
  private readonly lastLaunch = new Map<number, number>();
  private nextId = 1;
  now = 0;

  constructor(private readonly env: StrategicEnv) {}

  /** Restore the id counter after a world load. */
  seedIds(highest: number): void {
    if (Number.isFinite(highest)) this.nextId = Math.max(this.nextId, Math.floor(highest) + 1);
  }
  allocId(): number { return this.nextId++; }
  /** The id the NEXT allocation would use, without consuming it (serialization
   *  must never have a side effect). */
  peekNextId(): number { return this.nextId; }

  // --- placement -------------------------------------------------------------

  /** Why a silo may not be placed here (null = fine). */
  siloPlacementError(faction: number, x: number, y: number, z: number): string | null {
    let count = 0;
    for (const s of this.silos.values()) {
      if (s.faction !== faction) continue;
      count++;
      if (dist2d(s.x, s.z, x, z) < MIN_SILO_SPACING) {
        return `Silos must stand ${MIN_SILO_SPACING} blocks apart.`;
      }
    }
    if (count >= MAX_SILOS_PER_FACTION) {
      return `Your faction already fields ${MAX_SILOS_PER_FACTION} silos.`;
    }
    void y;
    return null;
  }

  batteryPlacementError(faction: number, x: number, y: number, z: number): string | null {
    let count = 0;
    for (const b of this.batteries.values()) {
      if (b.faction !== faction) continue;
      count++;
      if (dist2d(b.x, b.z, x, z) < MIN_BATTERY_SPACING) {
        return `Interceptor batteries must stand ${MIN_BATTERY_SPACING} blocks apart.`;
      }
    }
    if (count >= MAX_BATTERIES_PER_FACTION) {
      return `Your faction already fields ${MAX_BATTERIES_PER_FACTION} batteries.`;
    }
    void y;
    return null;
  }

  addSilo(owner: string, faction: number, x: number, y: number, z: number, tier = 1): SiloState {
    const stats = siloStats(tier);
    const s: SiloState = {
      id: this.allocId(), x, y, z,
      owner: (owner ?? '').slice(0, MAX_OWNER_LEN), faction, tier: clampTier(tier),
      hp: stats.hp, maxHp: stats.hp, ammo: 0, cooldown: 0, hatch: 0,
    };
    this.silos.set(s.id, s);
    return s;
  }

  addBattery(owner: string, faction: number, x: number, y: number, z: number, tier = 1): BatteryState {
    const stats = batteryStats(tier);
    const b: BatteryState = {
      id: this.allocId(), x, y, z,
      owner: (owner ?? '').slice(0, MAX_OWNER_LEN), faction, tier: clampTier(tier),
      hp: stats.hp, maxHp: stats.hp, ammo: 0, reload: 0, lock: 0, target: 0,
      yaw: 0, pitch: 0.35,
    };
    this.batteries.set(b.id, b);
    return b;
  }

  siloAt(x: number, y: number, z: number): SiloState | undefined {
    for (const s of this.silos.values()) if (s.x === x && s.y === y && s.z === z) return s;
    return undefined;
  }
  batteryAt(x: number, y: number, z: number): BatteryState | undefined {
    for (const b of this.batteries.values()) if (b.x === x && b.y === y && b.z === z) return b;
    return undefined;
  }

  removeSilo(id: number): void {
    this.silos.delete(id);
  }
  removeBattery(id: number): void {
    const b = this.batteries.get(id);
    if (b) {
      // Release the claim so a surviving battery can pick the track back up.
      for (const m of this.missiles.values()) if (m.batteryId === id) m.batteryId = 0;
    }
    this.batteries.delete(id);
  }

  // --- upgrades / loading ----------------------------------------------------

  /** Retrofit hardware to `tier`. Blueprint ownership is checked by the caller
   *  (it knows who is asking); this enforces the monotonic tier ladder. */
  retrofitSilo(s: SiloState, tier: number): boolean {
    const next = clampTier(tier);
    if (next <= s.tier) return false;
    const before = s.maxHp;
    s.tier = next;
    s.maxHp = siloStats(next).hp;
    // A retrofit repairs by the plating it adds, never by the whole bar.
    s.hp = Math.min(s.maxHp, s.hp + Math.max(0, s.maxHp - before));
    s.ammo = Math.min(s.ammo, siloStats(next).magazine);
    return true;
  }

  retrofitBattery(b: BatteryState, tier: number): boolean {
    const next = clampTier(tier);
    if (next <= b.tier) return false;
    const before = b.maxHp;
    b.tier = next;
    b.maxHp = batteryStats(next).hp;
    b.hp = Math.min(b.maxHp, b.hp + Math.max(0, b.maxHp - before));
    b.ammo = Math.min(b.ammo, batteryStats(next).capacity);
    return true;
  }

  /** Load missiles into a silo; returns how many actually fit. */
  loadSilo(s: SiloState, count: number): number {
    if (!Number.isFinite(count) || count <= 0) return 0;
    const room = siloStats(s.tier).magazine - s.ammo;
    const add = Math.max(0, Math.min(room, Math.floor(count)));
    s.ammo += add;
    return add;
  }

  loadBattery(b: BatteryState, count: number): number {
    if (!Number.isFinite(count) || count <= 0) return 0;
    const room = batteryStats(b.tier).capacity - b.ammo;
    const add = Math.max(0, Math.min(room, Math.floor(count)));
    b.ammo += add;
    return add;
  }

  // --- damage ----------------------------------------------------------------

  /** Returns true when the hardware was destroyed. */
  damageSilo(s: SiloState, amount: number): boolean {
    if (Number.isFinite(amount) && amount > 0) s.hp = Math.max(0, s.hp - amount);
    return s.hp <= 0;
  }
  damageBattery(b: BatteryState, amount: number): boolean {
    if (Number.isFinite(amount) && amount > 0) b.hp = Math.max(0, b.hp - amount);
    return b.hp <= 0;
  }

  /** Gunfire against a missile hull. Returns the shootDown event if it burst. */
  damageMissile(id: number, amount: number): StrategicEvent | null {
    const m = this.missiles.get(id);
    if (!m || m.kind !== 'strike') return null;
    if (!Number.isFinite(amount) || amount <= 0) return null;
    m.hp -= amount;
    if (m.hp > 0) return null;
    this.missiles.delete(id);
    return { kind: 'shotDown', id, x: m.x, y: m.y, z: m.z };
  }

  // --- launching -------------------------------------------------------------

  missilesInFlight(faction: number): number {
    let n = 0;
    for (const m of this.missiles.values()) {
      if (m.kind === 'strike' && m.faction === faction) n++;
    }
    return n;
  }

  /** Seconds a faction must still wait before ANY of its silos may fire. */
  launchSpacingLeft(faction: number): number {
    const last = this.lastLaunch.get(faction);
    if (last === undefined) return 0;
    return Math.max(0, FACTION_LAUNCH_SPACING - (this.now - last));
  }

  /** Full authoritative revalidation of a launch. Never consumes anything. */
  validateLaunch(req: LaunchRequest): { ok: true; silo: SiloState; stats: SiloStats; distance: number }
    | { ok: false; reason: LaunchReject } {
    const silo = this.silos.get(req.siloId);
    if (!silo) return { ok: false, reason: 'unknown-silo' };
    if (silo.hp <= 0) return { ok: false, reason: 'destroyed' };
    if (silo.faction !== req.faction) return { ok: false, reason: 'not-yours' };
    if (![req.tx, req.tz].every(Number.isFinite)) return { ok: false, reason: 'bad-target' };
    const half = this.env.worldHalf;
    if (Math.abs(req.tx) > half || Math.abs(req.tz) > half) {
      return { ok: false, reason: 'protected' };
    }
    if (silo.ammo < 1) return { ok: false, reason: 'no-ammo' };
    if (silo.cooldown > 0) return { ok: false, reason: 'cooldown' };
    const stats = siloStats(silo.tier);
    const distance = dist2d(silo.x, silo.z, req.tx, req.tz);
    if (distance > stats.range) return { ok: false, reason: 'out-of-range' };
    for (const area of this.env.protectedAreas()) {
      if (dist2d(area.x, area.z, req.tx, req.tz) <= area.radius + stats.blastRadius) {
        return { ok: false, reason: 'protected' };
      }
    }
    if (this.missilesInFlight(req.faction) >= MAX_MISSILES_IN_FLIGHT) {
      return { ok: false, reason: 'in-flight-cap' };
    }
    if (this.launchSpacingLeft(req.faction) > 0) return { ok: false, reason: 'faction-spacing' };
    return { ok: true, silo, stats, distance };
  }

  /** Consume ammo + cooldown and put a missile in the air. Only ever called
   *  after `validateLaunch` returned ok, so it cannot half-succeed. */
  launch(req: LaunchRequest): StrategicEvent[] {
    const check = this.validateLaunch(req);
    if (!check.ok) return [];
    const { silo, stats, distance } = check;
    silo.ammo -= 1;
    silo.cooldown = stats.cooldown;
    silo.hatch = 1;
    this.lastLaunch.set(req.faction, this.now);
    const ty = this.env.groundY(req.tx, req.tz);
    const m: MissileState = {
      id: this.allocId(), kind: 'strike', faction: req.faction, owner: silo.owner,
      sx: silo.x + 0.5, sy: silo.y + 2, sz: silo.z + 0.5,
      tx: req.tx, ty, tz: req.tz,
      t: 0, flight: missileFlightTime(distance, stats.speed),
      x: silo.x + 0.5, y: silo.y + 2, z: silo.z + 0.5,
      yaw: Math.atan2(req.tx - silo.x, req.tz - silo.z), pitch: -Math.PI / 2,
      hp: MISSILE_HULL_HP,
      radius: stats.blastRadius, playerDamage: stats.playerDamage,
      hardwareDamage: stats.hardwareDamage, blocks: stats.blocks,
      chasing: 0, batteryId: 0,
    };
    this.missiles.set(m.id, m);
    const snap = missileSnapshot(m);
    return [
      { kind: 'launch', missile: snap, siloId: silo.id },
      { kind: 'warning', faction: req.faction, x: req.tx, z: req.tz,
        eta: m.flight, radius: stats.blastRadius },
    ];
  }

  // --- ticking ---------------------------------------------------------------

  tick(dt: number): StrategicEvent[] {
    if (!Number.isFinite(dt) || dt <= 0) return [];
    dt = Math.min(dt, 0.5);
    this.now += dt;
    const out: StrategicEvent[] = [];
    for (const s of this.silos.values()) {
      s.cooldown = Math.max(0, s.cooldown - dt);
      // The hatch closes again a beat after the bird is away.
      s.hatch = Math.max(0, s.hatch - dt * 0.5);
    }
    this.stepMissiles(dt, out);
    this.stepBatteries(dt, out);
    return out;
  }

  private stepMissiles(dt: number, out: StrategicEvent[]): void {
    for (const m of [...this.missiles.values()]) {
      m.t += dt;
      if (m.kind === 'interceptor') {
        const quarry = this.missiles.get(m.chasing);
        if (!quarry || quarry.kind !== 'strike') {
          // Its target burst already — the interceptor self-destructs.
          this.missiles.delete(m.id);
          out.push({ kind: 'expired', id: m.id });
          continue;
        }
        // Re-aim every tick: chase the quarry's live position.
        m.tx = quarry.x; m.ty = quarry.y; m.tz = quarry.z;
        const step = INTERCEPTOR_SPEED * dt;
        const dx = quarry.x - m.x, dy = quarry.y - m.y, dz = quarry.z - m.z;
        const d = Math.hypot(dx, dy, dz);
        m.yaw = Math.atan2(dx, dz);
        m.pitch = Math.atan2(dy, Math.hypot(dx, dz));
        if (d <= step || d < 1.5) {
          // Deterministic: reaching the track IS the kill.
          this.missiles.delete(m.id);
          this.missiles.delete(quarry.id);
          const battery = this.batteries.get(m.batteryId);
          if (battery && battery.target === quarry.id) { battery.target = 0; battery.lock = 0; }
          out.push({ kind: 'intercepted', id: quarry.id, byBattery: m.batteryId,
            x: quarry.x, y: quarry.y, z: quarry.z });
          continue;
        }
        m.x += (dx / d) * step; m.y += (dy / d) * step; m.z += (dz / d) * step;
        if (m.t > 30) { this.missiles.delete(m.id); out.push({ kind: 'expired', id: m.id }); }
        continue;
      }
      // Strike missile: deterministic parametric arc.
      const p = Math.min(1, m.t / Math.max(0.001, m.flight));
      const prevY = m.y;
      const prevX = m.x, prevZ = m.z;
      const pos = arcAt(m, p);
      m.x = pos.x; m.y = pos.y; m.z = pos.z;
      const dx = m.x - prevX, dy = m.y - prevY, dz = m.z - prevZ;
      if (Math.hypot(dx, dy, dz) > 1e-4) {
        m.yaw = Math.atan2(dx, dz);
        m.pitch = Math.atan2(dy, Math.hypot(dx, dz));
      }
      if (p >= 1) {
        this.missiles.delete(m.id);
        for (const b of this.batteries.values()) {
          if (b.target === m.id) { b.target = 0; b.lock = 0; }
        }
        out.push({
          kind: 'impact', id: m.id, faction: m.faction, owner: m.owner,
          x: m.tx, y: m.ty, z: m.tz, radius: m.radius,
          playerDamage: m.playerDamage, hardwareDamage: m.hardwareDamage,
          blocks: m.blocks,
        });
      }
    }
  }

  private stepBatteries(dt: number, out: StrategicEvent[]): void {
    for (const b of this.batteries.values()) {
      b.reload = Math.max(0, b.reload - dt);
      if (b.hp <= 0) continue;
      const stats = batteryStats(b.tier);
      const claimed = this.claimedTargets(b.id);
      let best: MissileState | null = null;
      let bestEta = Infinity;
      for (const m of this.missiles.values()) {
        if (m.kind !== 'strike' || m.faction === b.faction) continue;
        // Only ONE battery ever claims a track — no duplicate ammo spend.
        if (claimed.has(m.id)) continue;
        if (dist2d(b.x, b.z, m.x, m.z) > stats.radius &&
            dist2d(b.x, b.z, m.tx, m.tz) > stats.radius) continue;
        const eta = Math.max(0, m.flight - m.t);
        if (eta < bestEta) { bestEta = eta; best = m; }
      }
      // Keep an existing claim if it is still the shortest-ETA track — unless
      // an interceptor is already chasing it, in which case the battery is free
      // to look for a different threat.
      const current = b.target && !claimed.has(b.target)
        ? this.missiles.get(b.target) : undefined;
      if (current && current.kind === 'strike') {
        const eta = Math.max(0, current.flight - current.t);
        if (eta <= bestEta) { best = current; bestEta = eta; }
      }
      if (!best) { b.target = 0; b.lock = 0; continue; }
      if (b.target !== best.id) { b.target = best.id; b.lock = 0; }
      b.yaw = Math.atan2(best.x - b.x, best.z - b.z);
      b.pitch = Math.atan2(Math.max(0, best.y - b.y), Math.max(1, dist2d(b.x, b.z, best.x, best.z)));
      b.lock += dt;
      if (b.lock + 1e-6 < stats.acquire || b.reload > 0 || b.ammo < 1) continue;
      b.ammo -= 1;
      b.reload = stats.reload;
      b.lock = 0;
      const interceptor: MissileState = {
        id: this.allocId(), kind: 'interceptor', faction: b.faction, owner: b.owner,
        sx: b.x + 0.5, sy: b.y + 2, sz: b.z + 0.5,
        tx: best.x, ty: best.y, tz: best.z,
        t: 0, flight: MIN_MISSILE_FLIGHT,
        x: b.x + 0.5, y: b.y + 2, z: b.z + 0.5,
        yaw: b.yaw, pitch: b.pitch, hp: MISSILE_HULL_HP,
        radius: 0, playerDamage: 0, hardwareDamage: 0, blocks: 0,
        chasing: best.id, batteryId: b.id,
      };
      this.missiles.set(interceptor.id, interceptor);
      out.push({ kind: 'interceptorLaunch', missile: missileSnapshot(interceptor), batteryId: b.id });
    }
  }

  /**
   * Strike-missile ids that are already being dealt with, from `exceptId`'s
   * point of view: any track another battery has claimed, PLUS any track that
   * already has an interceptor chasing it — including one of `exceptId`'s own.
   *
   * That last part matters: without it a battery keeps its claim after firing,
   * re-locks, and spends a second round on a missile that already has one
   * inbound. Interception is deterministic, so the second round is pure waste.
   */
  private claimedTargets(exceptId: number): Set<number> {
    const set = new Set<number>();
    for (const b of this.batteries.values()) {
      if (b.id !== exceptId && b.target) set.add(b.target);
    }
    for (const m of this.missiles.values()) {
      if (m.kind === 'interceptor' && m.chasing) set.add(m.chasing);
    }
    return set;
  }

  snapshotMissiles(): MissileSnapshot[] {
    return [...this.missiles.values()].map(missileSnapshot);
  }
}

/**
 * Where a strike missile is at progress `p` (0..1). A high, readable ballistic
 * arc: horizontal position is a straight lerp, and the vertical term is a
 * parabola whose apex scales with the distance flown. Both ends compute this
 * from the same four numbers, so no positional state is ever synced.
 */
export function arcAt(
  m: Pick<MissileState, 'sx' | 'sy' | 'sz' | 'tx' | 'ty' | 'tz'>, p: number,
): { x: number; y: number; z: number } {
  const c = Math.max(0, Math.min(1, p));
  const x = m.sx + (m.tx - m.sx) * c;
  const z = m.sz + (m.tz - m.sz) * c;
  const baseY = m.sy + (m.ty - m.sy) * c;
  const span = Math.hypot(m.tx - m.sx, m.tz - m.sz);
  const apex = Math.min(180, 24 + span * 0.22);
  return { x, y: baseY + apex * 4 * c * (1 - c), z };
}

function dist2d(ax: number, az: number, bx: number, bz: number): number {
  return Math.hypot(ax - bx, az - bz);
}

// --- Blast application helpers -------------------------------------------------

/** Blocks a blast may consider, nearest first. The caller keeps only the ones
 *  that are player-PLACED and destructible, then stops at the missile's cap —
 *  so natural terrain is never permanently excavated. */
export function blastBlockCandidates(
  cx: number, cy: number, cz: number, radius: number,
): { x: number; y: number; z: number; d: number }[] {
  const r = Math.max(0, Math.ceil(radius));
  const out: { x: number; y: number; z: number; d: number }[] = [];
  const ox = Math.floor(cx), oy = Math.floor(cy), oz = Math.floor(cz);
  for (let dx = -r; dx <= r; dx++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dz = -r; dz <= r; dz++) {
        const d = Math.hypot(dx, dy, dz);
        if (d > radius) continue;
        out.push({ x: ox + dx, y: oy + dy, z: oz + dz, d });
      }
    }
  }
  out.sort((a, b) => a.d - b.d);
  return out;
}

/** Damage one target from a blast centre — linear falloff, applied ONCE. */
export function blastAt(
  centre: { x: number; y: number; z: number },
  target: { x: number; y: number; z: number },
  radius: number, centreDamage: number,
): number {
  const d = Math.hypot(centre.x - target.x, centre.y - target.y, centre.z - target.z);
  return blastDamage(centreDamage, d, radius);
}

// --- Serialization -------------------------------------------------------------

export interface StrategicSave {
  silos: SiloState[];
  batteries: BatteryState[];
  nextId: number;
}

export function sanitizeSilo(raw: unknown): SiloState | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (![r.x, r.y, r.z].every((v) => Number.isFinite(v))) return null;
  // A record with no usable id is DROPPED, never collapsed onto id 1 — two
  // corrupted rows would otherwise overwrite each other in the restore map.
  if (!Number.isFinite(r.id) || Math.floor(Number(r.id)) < 1) return null;
  const tier = clampTier(Number(r.tier));
  const stats = siloStats(tier);
  return {
    id: Math.floor(Number(r.id)),
    x: Math.floor(Number(r.x)), y: Math.floor(Number(r.y)), z: Math.floor(Number(r.z)),
    owner: typeof r.owner === 'string' ? r.owner.slice(0, MAX_OWNER_LEN) : '',
    faction: Number.isFinite(r.faction) ? Math.floor(Number(r.faction)) : -1,
    tier,
    maxHp: stats.hp,
    hp: Number.isFinite(r.hp) ? Math.max(1, Math.min(stats.hp, Math.floor(Number(r.hp)))) : stats.hp,
    ammo: Number.isFinite(r.ammo) ? Math.max(0, Math.min(stats.magazine, Math.floor(Number(r.ammo)))) : 0,
    cooldown: Number.isFinite(r.cooldown) ? Math.max(0, Math.min(stats.cooldown, Number(r.cooldown))) : 0,
    hatch: 0,
  };
}

export function sanitizeBattery(raw: unknown): BatteryState | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (![r.x, r.y, r.z].every((v) => Number.isFinite(v))) return null;
  if (!Number.isFinite(r.id) || Math.floor(Number(r.id)) < 1) return null;
  const tier = clampTier(Number(r.tier));
  const stats: BatteryStats = batteryStats(tier);
  return {
    id: Math.floor(Number(r.id)),
    x: Math.floor(Number(r.x)), y: Math.floor(Number(r.y)), z: Math.floor(Number(r.z)),
    owner: typeof r.owner === 'string' ? r.owner.slice(0, MAX_OWNER_LEN) : '',
    faction: Number.isFinite(r.faction) ? Math.floor(Number(r.faction)) : -1,
    tier,
    maxHp: stats.hp,
    hp: Number.isFinite(r.hp) ? Math.max(1, Math.min(stats.hp, Math.floor(Number(r.hp)))) : stats.hp,
    ammo: Number.isFinite(r.ammo) ? Math.max(0, Math.min(stats.capacity, Math.floor(Number(r.ammo)))) : 0,
    reload: 0, lock: 0, target: 0, yaw: 0, pitch: 0.35,
  };
}
