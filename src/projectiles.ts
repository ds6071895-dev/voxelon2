// Gun projectiles: bullets (point-hit) and rockets (detonate on impact). The
// projectile is simulated client-side; it sub-steps along its path each frame
// so fast rounds can't tunnel through blocks/mobs/players. Mob hits are local
// (mobs are client-side); player hits are reported to the server, which
// validates and applies the (armor-mitigated) PvP damage. Rocket terrain
// destruction reuses the creeper explosion and, like it, is local-only.
//
// GHOST rounds are the same simulation with the teeth pulled: they are spawned
// from another player's broadcast `shot` so their gunfire is visible and
// audible instead of arriving as damage out of nowhere. A ghost deals no
// damage and reports nothing — it only flies, stops at whatever it hits, and
// sparks. All damage still flows through the shooter's own authoritative path.

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

  /** Report a block impact (unused hook kept for effects).
   *  shield if the round struck inside it (M19 breaching). Set by main. */
  claimSink?: (x: number, y: number, z: number, damage: number) => void;
  /** Optional dungeon encounter collision, checked before ordinary local mobs. */
  encounterSink?: (
    point: THREE.Vector3, damage: number, source: 'bullet' | 'rocket',
  ) => boolean;
  /** A round of ours hit a LOCAL target (mob/encounter actor). PvP hitmarkers
   *  come from the server instead, but a shot is a shot — the crosshair should
   *  answer "did that land?" the same way whatever you were shooting at. */
  localHitSink?: (damage: number, at: THREE.Vector3) => void;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly world: World,
    private readonly mobs: Mobs,
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
    // A ghost round only needs to know WHERE to stop, so it tests geometry and
    // nothing else: no damage, no hit report, no encounter/mob interaction.
    if (p.ghost) {
      if (this.remotePlayers.avatarAtPoint(p.pos) >= 0 || this.hitsLocalPlayer(p.pos) ||
          isSolid(this.world.getBlock(
            Math.floor(p.pos.x), Math.floor(p.pos.y), Math.floor(p.pos.z)))) {
        this.despawn(p, true);
      }
      return;
    }
    // Remote player (PvP): the server validates + applies the damage. Rockets
    // deal NO direct hit — they detonate and damage via the server-side splash
    // (sent from despawn), so a near-miss still hurts and there's no double-count.
    const pid = this.remotePlayers.avatarAtPoint(p.pos);
    if (pid >= 0) {
      if (p.gun.rocket !== true) this.net.sendRangedAttack(pid, p.gun.damage);
      this.despawn(p, true);
      return;
    }
    // Dungeon props/summons are authoritative encounter actors rather than
    // ordinary local mobs. Let the adapter validate and consume the round.
    if (this.encounterSink?.(
      p.pos, p.gun.damage, p.gun.rocket === true ? 'rocket' : 'bullet',
    )) {
      if (p.gun.rocket !== true) this.localHitSink?.(p.gun.damage, p.pos);
      this.despawn(p, true);
      return;
    }
    // Local mob.
    if (this.mobs.shootPoint(p.pos, p.gun.damage, p.dir)) {
      if (p.gun.rocket !== true) this.localHitSink?.(p.gun.damage, p.pos);
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
    if (p.gun.rocket === true) {
      if (p.ghost) {
        // The shooter's client reports the burst and the SERVER broadcasts the
        // authoritative blast (FX + crater + splash). Popping our own explosion
        // here would double it, so a ghost rocket just puffs out.
        this.particles.poof(p.pos.x, p.pos.y, p.pos.z);
        return;
      }
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
    this.ghostMat.dispose();
    this.rocketMat.dispose();
  }
}
