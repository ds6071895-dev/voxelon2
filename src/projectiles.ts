// Gun projectiles: bullets (point-hit) and rockets (detonate on impact). The
// projectile is simulated client-side; it sub-steps along its path each frame
// so fast rounds can't tunnel through blocks/mobs/players. Mob hits are local
// (mobs are client-side); player hits are reported to the server, which
// validates and applies the (armor-mitigated) PvP damage. Rocket terrain
// destruction reuses the creeper explosion and, like it, is local-only.

import * as THREE from 'three';
import { isSolid } from './blocks';
import type { GunInfo } from './items';
import type { Mobs } from './mobs';
import type { NetClient } from './net/client';
import type { Particles } from './particles';
import type { Player } from './player';
import type { RemotePlayers } from './remoteplayers';
import type { World } from './world';

const STEP = 0.2;          // collision sub-step (blocks)
const SPAWN_OFFSET = 0.6;  // start ahead of the eye so it can't hit the shooter

interface Projectile {
  mesh: THREE.Mesh;
  pos: THREE.Vector3;
  dir: THREE.Vector3; // normalized
  gun: GunInfo;
  traveled: number;
  alive: boolean;
}

export class Projectiles {
  private readonly list: Projectile[] = [];
  private readonly bulletGeo = new THREE.SphereGeometry(0.07, 6, 4);
  private readonly rocketGeo = new THREE.BoxGeometry(0.16, 0.16, 0.42);
  private readonly bulletMat = new THREE.MeshBasicMaterial({ color: 0xffe27a });
  private readonly rocketMat = new THREE.MeshBasicMaterial({ color: 0xcc4434 });

  /** Report a block impact (unused hook kept for effects).
   *  shield if the round struck inside it (M19 breaching). Set by main. */
  claimSink?: (x: number, y: number, z: number, damage: number) => void;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly world: World,
    private readonly mobs: Mobs,
    private readonly remotePlayers: RemotePlayers,
    private readonly net: NetClient,
    private readonly player: Player,
    private readonly particles: Particles,
  ) {}

  fire(origin: THREE.Vector3, dir: THREE.Vector3, gun: GunInfo): void {
    const d = dir.clone().normalize();
    const rocket = gun.rocket === true;
    const mesh = new THREE.Mesh(
      rocket ? this.rocketGeo : this.bulletGeo,
      rocket ? this.rocketMat : this.bulletMat,
    );
    const pos = origin.clone().addScaledVector(d, SPAWN_OFFSET);
    mesh.position.copy(pos);
    if (rocket) mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), d);
    this.scene.add(mesh);
    this.list.push({ mesh, pos, dir: d, gun, traveled: 0, alive: true });
  }

  update(dt: number): void {
    for (const p of this.list) {
      if (!p.alive) continue;
      let remaining = p.gun.speed * dt;
      while (remaining > 0 && p.alive) {
        const step = Math.min(STEP, remaining);
        p.pos.addScaledVector(p.dir, step);
        p.traveled += step;
        remaining -= step;
        this.collideAt(p);
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

  /** Test the projectile's current point against players, mobs, then blocks. */
  private collideAt(p: Projectile): void {
    // Remote player (PvP): the server validates + applies the damage. Rockets
    // deal NO direct hit — they detonate and damage via the server-side splash
    // (sent from despawn), so a near-miss still hurts and there's no double-count.
    const pid = this.remotePlayers.avatarAtPoint(p.pos);
    if (pid >= 0) {
      if (p.gun.rocket !== true) this.net.sendRangedAttack(pid, p.gun.damage);
      this.despawn(p, true);
      return;
    }
    // Local mob.
    if (this.mobs.shootPoint(p.pos, p.gun.damage, p.dir)) {
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

  private despawn(p: Projectile, impact: boolean): void {
    if (!p.alive) return;
    p.alive = false;
    this.scene.remove(p.mesh);
    if (!impact) return;
    if (p.gun.rocket === true) {
      // Reuse the creeper blast locally: destroys blocks + hurts local mobs and
      // the shooter. The server applies the (capped) splash damage to enemy
      // players + broadcasts the crater so the blast syncs to everyone else.
      this.mobs.explode(p.pos.clone(), this.player);
      this.net.sendRocketBlast(p.pos.x, p.pos.y, p.pos.z);
    } else {
      this.particles.poof(p.pos.x, p.pos.y, p.pos.z);
    }
  }

  /** Free GPU buffers (shared geometry/material) on teardown. */
  dispose(): void {
    for (const p of this.list) this.scene.remove(p.mesh);
    this.list.length = 0;
    this.bulletGeo.dispose();
    this.rocketGeo.dispose();
    this.bulletMat.dispose();
    this.rocketMat.dispose();
  }
}
