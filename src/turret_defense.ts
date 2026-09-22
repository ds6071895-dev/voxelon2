// Turrets vs HOSTILE MOBS. Mobs are client-side, so the server's targeting scan
// never sees them: each client aims the friendly turrets around it at its own
// hostiles. Offline this is the whole sim (local ammo/cooldown); online the
// client asks the server to spend the shot (`turretMobShot`) and the server's
// `turretFire` echo draws it for everyone, while the hit lands on the local mob
// straight away. Bosses are left to the players.

import * as THREE from 'three';
import type { Mob, Mobs } from './mobs';
import {
  TURRET_MUZZLE_Y, turretArmed, turretConsumeShot, turretDamage, turretFriendly,
  turretHasLineOfSight, turretInterval, turretRange, type TurretState,
} from './turrets';

const SCAN_EVERY = 0.1;     // seconds between target scans
const ACTIVE_RADIUS = 72;   // only turrets this close to us can have our mobs in range
/** Extra client-side cooldown online, so a shot in flight to the server isn't
 *  re-sent before the server's own cooldown has started. */
const NET_SLACK = 0.08;

export interface TurretDefenseHooks {
  online(): boolean;
  me(): { name: string; faction: number };
  /** World query for line of sight (solid block at this point?). */
  solid(x: number, y: number, z: number): boolean;
  /** Offline: draw the shot locally. */
  fireLocal(x: number, y: number, z: number, tx: number, ty: number, tz: number): void;
  /** Online: ask the server to fire this turret at the point. */
  fireNet(x: number, y: number, z: number, tx: number, ty: number, tz: number): void;
}

export class TurretDefense {
  private readonly cooldown = new Map<string, number>();
  private scan = 0;
  private readonly aim = new THREE.Vector3();
  private readonly dir = new THREE.Vector3();

  constructor(
    private readonly turrets: Map<string, TurretState>,
    private readonly mobs: Mobs,
    private readonly hooks: TurretDefenseHooks,
  ) {}

  update(dt: number, px: number, pz: number): void {
    const online = this.hooks.online();
    for (const [key, t] of this.cooldown) {
      const left = t - dt;
      if (left <= 0 || !this.turrets.has(key)) this.cooldown.delete(key);
      else this.cooldown.set(key, left);
    }
    // Offline the local state IS the turret, so its cooldown ticks here.
    if (!online) for (const s of this.turrets.values()) s.cooldown = Math.max(0, s.cooldown - dt);
    this.scan -= dt;
    if (this.scan > 0) return;
    this.scan = SCAN_EVERY;
    if (this.mobs.list.length === 0) return;
    const me = this.hooks.me();
    for (const [key, s] of this.turrets) {
      if (this.cooldown.has(key)) continue;
      // Online the state's cooldown isn't synced; the local map above gates us.
      if (!turretArmed(online ? { ...s, cooldown: 0 } : s)) continue;
      if (!turretFriendly(s, me.name, me.faction)) continue;
      const [x, y, z] = key.split(',').map(Number);
      if (Math.hypot(x + 0.5 - px, z + 0.5 - pz) > ACTIVE_RADIUS) continue;
      const mob = this.pickTarget(s, x, y, z);
      if (!mob) continue;
      const { x: tx, y: ty, z: tz } = this.aim;
      this.cooldown.set(key, turretInterval(s.level) + (online ? NET_SLACK : 0));
      if (online) {
        this.hooks.fireNet(x, y, z, tx, ty, tz);
        s.ammo = Math.max(0, s.ammo - 1); // predict the panel's count; the echo corrects it
      } else {
        turretConsumeShot(s);
        s.facingYaw = Math.atan2(tx - x - 0.5, tz - z - 0.5);
        this.hooks.fireLocal(x, y, z, tx, ty, tz);
      }
      this.dir.set(tx - x - 0.5, 0, tz - z - 0.5).normalize();
      this.mobs.shootPoint(this.aim, Math.round(turretDamage(s.level)), this.dir);
    }
  }

  /** Nearest hostile, non-boss mob in range with a clear shot; leaves its aim
   *  point (upper body) in `this.aim`. */
  private pickTarget(s: TurretState, x: number, y: number, z: number): Mob | null {
    const range = turretRange(s.level);
    const ox = x + 0.5, oy = y + TURRET_MUZZLE_Y, oz = z + 0.5;
    let best: Mob | null = null;
    let bestD2 = range * range;
    let ax = 0, ay = 0, az = 0;
    for (const mob of this.mobs.list) {
      if (mob.removed || !mob.def.hostile || mob.bossKind !== null || mob.health <= 0) continue;
      const mx = mob.pos.x, my = mob.pos.y + mob.height * 0.6, mz = mob.pos.z;
      const d2 = (mx - ox) ** 2 + (my - oy) ** 2 + (mz - oz) ** 2;
      if (d2 > bestD2) continue;
      if (!turretHasLineOfSight(x, y, z, mx, my, mz, this.hooks.solid)) continue;
      best = mob; bestD2 = d2; ax = mx; ay = my; az = mz;
    }
    if (best) this.aim.set(ax, ay, az);
    return best;
  }
}
