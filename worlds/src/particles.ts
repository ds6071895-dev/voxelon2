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

/** A soft-edged medical cross — the healing mote. Drawn once, shared. */
let crossTex: THREE.Texture | null = null;
function healCrossTexture(): THREE.Texture {
  if (crossTex) return crossTex;
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const g = c.getContext('2d')!;
  const glow = g.createRadialGradient(16, 16, 2, 16, 16, 16);
  glow.addColorStop(0, 'rgba(255,255,255,0.55)');
  glow.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = glow;
  g.fillRect(0, 0, 32, 32);
  g.fillStyle = '#fff';
  g.fillRect(12, 5, 8, 22);
  g.fillRect(5, 12, 22, 8);
  crossTex = new THREE.CanvasTexture(c);
  crossTex.magFilter = THREE.NearestFilter;
  return crossTex;
}

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
    opts: { gravity?: number; spread?: number; scale?: number; map?: THREE.Texture;
      additive?: boolean } = {}
  ): void {
    const spread = opts.spread ?? 0.6;
    for (let i = 0; i < count; i++) {
      if (this.list.length >= MAX_PARTICLES) return;
      const mat = new THREE.MeshBasicMaterial({
        color, transparent: true, depthWrite: false, side: THREE.DoubleSide,
        map: opts.map ?? null,
        blending: opts.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
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
   *  gravity), so a bandage/medkit reads as restorative at a glance. A strong
   *  (medkit) burst is glowing medical crosses rather than plain squares. */
  heal(x: number, y: number, z: number, count = 12, strong = false): void {
    const map = strong ? healCrossTexture() : undefined;
    this.burst(x, y, z, count, strong ? 0x9dffc0 : 0x6ff0a0, 0.9, 1.1,
      { gravity: -1.4, spread: 1.3, scale: strong ? 1.6 : 0.8, map, additive: strong });
    if (strong) {
      this.burst(x, y + 0.4, z, 6, 0xffffff, 1.4, 0.7,
        { gravity: -0.8, spread: 1.0, scale: 0.55, additive: true });
    }
  }

  /** One pair of motes on a rising double helix around the player — called
   *  on a short repeat while a medkit's regen runs, so you are visibly wrapped
   *  in it. `phase` advances the helix. */
  healSpiral(x: number, y: number, z: number, phase: number): void {
    const map = healCrossTexture();
    for (let k = 0; k < 2; k++) {
      if (this.list.length >= MAX_PARTICLES) return;
      const a = phase + k * Math.PI;
      const mat = new THREE.MeshBasicMaterial({
        color: k ? 0x7dffb0 : 0xc8ffe0, map, transparent: true, depthWrite: false,
        side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
      });
      const mesh = new THREE.Mesh(this.geo, mat);
      mesh.scale.setScalar(1.1);
      mesh.position.set(x + Math.cos(a) * 0.75, y, z + Math.sin(a) * 0.75);
      this.scene.add(mesh);
      this.list.push({
        mesh, life: 0, maxLife: 1.1, gravity: -1.2,
        vel: new THREE.Vector3(-Math.sin(a) * 0.9, 1.2, Math.cos(a) * 0.9),
      });
    }
  }

  /** A flat ring of glowing motes racing outward at waist height — the
   *  shockwave when a medkit's stim goes in. */
  healRing(x: number, y: number, z: number, count = 28): void {
    const map = healCrossTexture();
    for (let i = 0; i < count; i++) {
      if (this.list.length >= MAX_PARTICLES) return;
      const a = (i / count) * Math.PI * 2;
      const mat = new THREE.MeshBasicMaterial({
        color: i % 3 ? 0x8dffb8 : 0xffffff, map, transparent: true, depthWrite: false,
        side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
      });
      const mesh = new THREE.Mesh(this.geo, mat);
      mesh.scale.setScalar(1.3);
      mesh.position.set(x + Math.cos(a) * 0.3, y, z + Math.sin(a) * 0.3);
      this.scene.add(mesh);
      this.list.push({
        mesh, life: 0, maxLife: 0.75, gravity: -2.5,
        vel: new THREE.Vector3(Math.cos(a) * 7, 0.4, Math.sin(a) * 7),
      });
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
