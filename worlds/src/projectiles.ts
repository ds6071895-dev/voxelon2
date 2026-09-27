// Gun projectiles (the Duels Burst Rifle). The projectile is simulated
// client-side; it sub-steps along its path each frame so fast rounds can't
// tunnel through blocks or players. Player hits are reported to the server,
// which validates them against its own history and applies the damage.
//
// GHOST rounds are the same simulation with the teeth pulled: they are spawned
// from another player's broadcast `shot` so their gunfire is visible and
// audible instead of arriving as damage out of nowhere. A ghost deals no
// damage and reports nothing — it only flies, stops at whatever it hits, and
// sparks. All damage still flows through the shooter's own authoritative path.

import * as THREE from 'three';
import { isSolid } from './blocks';
import type { GunInfo } from './items';
import type { NetClient } from './net/client';
import type { Particles } from './particles';
import type { Player } from './player';
import type { RemotePlayers } from './remoteplayers';
import type { World } from './world';

const STEP = 0.2;          // collision sub-step (blocks)
/** Start of the current sub-step, so player collision can sweep it. */
const SWEEP_FROM = new THREE.Vector3();
const SPAWN_OFFSET = 0.6;  // start ahead of the eye so it can't hit the shooter
// Tracer length in blocks per (block/second) of muzzle velocity: a 100 b/s
// round draws a ~1.2-block streak. Without this a bullet is a 7cm dot crossing
// the screen in a couple of frames — literally invisible, so incoming fire read
// as damage from nowhere.
const TRACER_PER_SPEED = 0.012;
const TRACER_MIN = 0.5;
const TRACER_MAX = 2.4;

interface Projectile {
  mesh: THREE.Mesh;
  pos: THREE.Vector3;
  dir: THREE.Vector3; // normalized
  gun: GunInfo;
  traveled: number;
  alive: boolean;
  /** Cosmetic round replaying someone else's shot: never damages or reports. */
  ghost: boolean;
}

export class Projectiles {
  private readonly list: Projectile[] = [];
  // A unit-length bar stretched per-round to the gun's tracer length.
  private readonly bulletGeo = new THREE.BoxGeometry(0.055, 0.055, 1);
  private readonly rocketGeo = new THREE.BoxGeometry(0.16, 0.16, 0.42);
  private readonly bulletMat = new THREE.MeshBasicMaterial({
    color: 0xffe9a0, blending: THREE.AdditiveBlending,
    transparent: true, depthWrite: false,
  });
  // Enemy fire is tinted hot orange so a glance tells you whose rounds are
  // whose in a crossfire.
  private readonly ghostMat = new THREE.MeshBasicMaterial({
    color: 0xff9440, blending: THREE.AdditiveBlending,
    transparent: true, depthWrite: false,
  });
  private readonly rocketMat = new THREE.MeshBasicMaterial({ color: 0xcc4434 });

  constructor(
    private readonly scene: THREE.Scene,
    private readonly world: World,
    private readonly remotePlayers: RemotePlayers,
    private readonly net: NetClient,
    private readonly player: Player,
    private readonly particles: Particles,
  ) {}

  fire(origin: THREE.Vector3, dir: THREE.Vector3, gun: GunInfo, ghost = false): void {
    const d = dir.clone().normalize();
    const rocket = gun.rocket === true;
    const mesh = new THREE.Mesh(
      rocket ? this.rocketGeo : this.bulletGeo,
      rocket ? this.rocketMat : (ghost ? this.ghostMat : this.bulletMat),
    );
    const pos = origin.clone().addScaledVector(d, SPAWN_OFFSET);
    mesh.position.copy(pos);
    // Both shapes run along their local +Z, so aim that axis down the flight
    // path — for the tracer this is what turns the round into a streak.
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), d);
    if (!rocket) {
      mesh.scale.z = Math.max(
        TRACER_MIN, Math.min(TRACER_MAX, gun.speed * TRACER_PER_SPEED));
    }
    this.scene.add(mesh);
    this.list.push({ mesh, pos, dir: d, gun, traveled: 0, alive: true, ghost });
  }

  /** Replay another player's shot: visuals + audio only, no damage anywhere. */
  fireGhost(origin: THREE.Vector3, dir: THREE.Vector3, gun: GunInfo): void {
    this.fire(origin, dir, gun, true);
  }

  update(dt: number): void {
    for (const p of this.list) {
      if (!p.alive) continue;
      let remaining = p.gun.speed * dt;
      while (remaining > 0 && p.alive) {
        const step = Math.min(STEP, remaining);
        SWEEP_FROM.copy(p.pos);
        p.pos.addScaledVector(p.dir, step);
        p.traveled += step;
        remaining -= step;
        this.collideAt(p, SWEEP_FROM);
        if (p.alive && p.traveled >= p.gun.range) {
          this.despawn(p, p.gun.rocket === true); // rockets airburst at max range
        }
      }
      if (p.alive) p.mesh.position.copy(p.pos);
    }
    for (let i = this.list.length - 1; i >= 0; i--) {
      if (!this.list[i].alive) this.list.splice(i, 1);
    }
  }

  /** Test this sub-step against players, mobs, then blocks. Players are swept
   *  over the whole `from`->`p.pos` segment; the rest test the end point. */
  private collideAt(p: Projectile, from: THREE.Vector3): void {
    // A ghost round only needs to know WHERE to stop, so it tests geometry and
    // nothing else: no damage, no hit report, no encounter/mob interaction.
    if (p.ghost) {
      if (this.remotePlayers.avatarAtSegment(from, p.pos) >= 0 || this.hitsLocalPlayer(p.pos) ||
          isSolid(this.world.getBlock(
            Math.floor(p.pos.x), Math.floor(p.pos.y), Math.floor(p.pos.z)))) {
        this.despawn(p, true);
      }
      return;
    }
    // Remote player (PvP): the server validates + applies the damage.
    const pid = this.remotePlayers.avatarAtSegment(from, p.pos);
    if (pid >= 0) {
      if (p.gun.rocket !== true) this.net.sendRangedAttack(pid, p.gun.damage);
      this.despawn(p, true);
      return;
    }
    // Block.
    if (isSolid(this.world.getBlock(
      Math.floor(p.pos.x), Math.floor(p.pos.y), Math.floor(p.pos.z)
    ))) {
      this.despawn(p, true);
    }
  }

  /** Does this point sit inside the local player's body? Ghost rounds stop on
   *  it so incoming fire visibly terminates at you rather than passing through
   *  (the damage itself is the server's `hurt`, never this). */
  private hitsLocalPlayer(point: THREE.Vector3): boolean {
    const o = this.player.pos;
    return point.x >= o.x - 0.35 && point.x <= o.x + 0.35 &&
           point.y >= o.y - 0.1  && point.y <= o.y + 1.9 &&
           point.z >= o.z - 0.35 && point.z <= o.z + 0.35;
  }

  private despawn(p: Projectile, impact: boolean): void {
    if (!p.alive) return;
    p.alive = false;
    this.scene.remove(p.mesh);
    if (!impact) return;
    this.particles.poof(p.pos.x, p.pos.y, p.pos.z);
  }

  /** Drop every round in flight (moving to another world). */
  clear(): void {
    for (const p of this.list) this.scene.remove(p.mesh);
    this.list.length = 0;
  }
}
