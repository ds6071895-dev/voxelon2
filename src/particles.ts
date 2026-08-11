// Tiny particle system: death poofs, explosion smoke, generic puffs.

import * as THREE from 'three';

interface Particle {
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  life: number;
  maxLife: number;
  /** Downward pull (blocks/s²). Negative floats the particle upward. */
  gravity: number;
}

const MAX_PARTICLES = 250;

export class Particles {
  private readonly scene: THREE.Scene;
  private readonly list: Particle[] = [];
  private readonly geo = new THREE.PlaneGeometry(0.18, 0.18);

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  get count(): number {
    return this.list.length;
  }

  burst(
    x: number, y: number, z: number,
    count: number, color: number, speed: number, life = 0.6,
    opts: { gravity?: number; spread?: number; scale?: number } = {}
  ): void {
    const spread = opts.spread ?? 0.6;
    for (let i = 0; i < count; i++) {
      if (this.list.length >= MAX_PARTICLES) return;
      const mat = new THREE.MeshBasicMaterial({
        color, transparent: true, depthWrite: false, side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(this.geo, mat);
      if (opts.scale) mesh.scale.setScalar(opts.scale);
      mesh.position.set(
        x + (Math.random() - 0.5) * spread,
        y + (Math.random() - 0.5) * spread,
        z + (Math.random() - 0.5) * spread
      );
      this.scene.add(mesh);
      this.list.push({
        mesh,
        vel: new THREE.Vector3(
          (Math.random() - 0.5) * speed,
          Math.random() * speed * 0.8,
          (Math.random() - 0.5) * speed
        ),
        life: 0,
        maxLife: life * (0.6 + Math.random() * 0.8),
        gravity: opts.gravity ?? 4,
      });
    }
  }

  /** Healing: soft green motes that FLOAT UP around the player (negative
   *  gravity), so a bandage/medkit reads as restorative at a glance. */
  heal(x: number, y: number, z: number, count = 12, strong = false): void {
    this.burst(x, y, z, count, strong ? 0x9dffc0 : 0x6ff0a0, 0.9, 1.1,
      { gravity: -1.4, spread: 1.3, scale: strong ? 1.15 : 0.8 });
    if (strong) {
      this.burst(x, y + 0.4, z, 6, 0xffffff, 1.4, 0.7,
        { gravity: -0.8, spread: 1.0, scale: 0.55 });
    }
  }

  /** Gray puff when a mob dies. */
  poof(x: number, y: number, z: number): void {
    this.burst(x, y, z, 10, 0xdddddd, 2, 0.5);
  }

  /** Explosion: dark smoke + a few sparks. */
  explosion(x: number, y: number, z: number): void {
    this.burst(x, y, z, 26, 0x555555, 7, 1.0);
    this.burst(x, y, z, 10, 0xffc864, 9, 0.4);
  }

  update(dt: number, camera: THREE.Camera): void {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i];
      p.life += dt;
      if (p.life >= p.maxLife) {
        this.scene.remove(p.mesh);
        (p.mesh.material as THREE.Material).dispose();
        this.list.splice(i, 1);
        continue;
      }
      p.vel.y -= p.gravity * dt;
      p.vel.multiplyScalar(Math.max(0, 1 - 2 * dt));
      p.mesh.position.addScaledVector(p.vel, dt);
      p.mesh.quaternion.copy(camera.quaternion); // billboard
      (p.mesh.material as THREE.MeshBasicMaterial).opacity =
        1 - p.life / p.maxLife;
    }
  }
}
