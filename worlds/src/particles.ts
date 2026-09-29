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

  /** Healing: glowing medical crosses that FLOAT UP around the player
   *  (negative gravity), so the medkit reads as restorative at a glance. */
  heal(x: number, y: number, z: number, count: number): void {
    this.burst(x, y, z, count, 0x9dffc0, 0.9, 1.1,
      { gravity: -1.4, spread: 1.3, scale: 1.6, map: healCrossTexture(), additive: true });
    this.burst(x, y + 0.4, z, 6, 0xffffff, 1.4, 0.7,
      { gravity: -0.8, spread: 1.0, scale: 0.55, additive: true });
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

  /** A flat ring of glowing motes racing outward, in any colour. */
  ring(x: number, y: number, z: number, color: number, count = 24, speed = 6, life = 0.7): void {
    for (let i = 0; i < count; i++) {
      if (this.list.length >= MAX_PARTICLES) return;
      const a = (i / count) * Math.PI * 2;
      const mat = new THREE.MeshBasicMaterial({
        color: i % 3 ? color : 0xffffff, transparent: true, depthWrite: false,
        side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
      });
      const mesh = new THREE.Mesh(this.geo, mat);
      mesh.scale.setScalar(0.9);
      mesh.position.set(x + Math.cos(a) * 0.25, y, z + Math.sin(a) * 0.25);
      this.scene.add(mesh);
      this.list.push({
        mesh, life: 0, maxLife: life, gravity: -1,
        vel: new THREE.Vector3(Math.cos(a) * speed, 0.3, Math.sin(a) * speed),
      });
    }
  }

  /** Motes standing in a column that all drift upward — or, with `inward`,
   *  start wide and spiral into the centre line as they rise. */
  column(x: number, y: number, z: number, color: number, count: number, opts: { radius?: number; rise?: number;
    life?: number; inward?: boolean; map?: THREE.Texture } = {}): void {
    const radius = opts.radius ?? 0.6, rise = opts.rise ?? 4, life = opts.life ?? 0.9;
    for (let i = 0; i < count; i++) {
      if (this.list.length >= MAX_PARTICLES) return;
      const a = Math.random() * Math.PI * 2, r = radius * (0.4 + Math.random() * 0.6);
      const mat = new THREE.MeshBasicMaterial({
        color: i % 4 ? color : 0xffffff, transparent: true, depthWrite: false, map: opts.map ?? null,
        side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
      });
      const mesh = new THREE.Mesh(this.geo, mat);
      mesh.scale.setScalar(opts.map ? 1.1 : 0.7);
      mesh.position.set(x + Math.cos(a) * r, y + Math.random() * 1.6, z + Math.sin(a) * r);
      this.scene.add(mesh);
      const pull = opts.inward ? -r * 1.6 : 0;
      this.list.push({
        mesh, life: 0, maxLife: life * (0.7 + Math.random() * 0.6), gravity: -0.5,
        vel: new THREE.Vector3(Math.cos(a) * pull - Math.sin(a) * (opts.inward ? 2.4 : 0.6),
          rise * (0.6 + Math.random() * 0.6), Math.sin(a) * pull + Math.cos(a) * (opts.inward ? 2.4 : 0.6)),
      });
    }
  }

  /** Bridge death: the body shatters into shards in the team colour while a
   *  pale column of spirits lifts out of it and a ring rolls away. */
  deathBurst(x: number, y: number, z: number, color: number): void {
    this.burst(x, y + 0.9, z, 22, color, 6.5, 0.75, { gravity: 9, spread: 0.6, scale: 0.75 });
    this.burst(x, y + 0.9, z, 8, 0xffffff, 3, 0.5, { gravity: 6, spread: 0.4, scale: 0.4, additive: true });
    this.column(x, y, z, 0xd9e6ff, 16, { radius: 0.5, rise: 5, life: 1.1 });
    this.ring(x, y + 0.15, z, color, 22, 5.5, 0.6);
  }

  /** Bridge respawn: motes pour in and up, then a ring flares out from the
   *  feet — the body assembling itself out of light. */
  respawnBeam(x: number, y: number, z: number, color: number): void {
    this.column(x, y, z, color, 26, { radius: 1.3, rise: 3.6, life: 0.9, inward: true });
    this.column(x, y, z, 0xffffff, 8, { radius: 0.3, rise: 6, life: 0.7 });
    this.ring(x, y + 0.1, z, color, 26, 7, 0.65);
  }

  /** Bridge kill: a gold-green surge — crosses float up, a double ring and a
   *  helix wrap the killer as health floods back to full. */
  killHeal(x: number, y: number, z: number): void {
    this.heal(x, y + 1, z, 14);
    this.healRing(x, y + 0.9, z, 26);
    this.ring(x, y + 0.3, z, 0xffe38a, 22, 4.2, 0.8);
    for (let i = 0; i < 6; i++) this.healSpiral(x, y + 0.2 + i * 0.28, z, i * 1.05);
  }

  /** Gray puff where a round hits something. */
  poof(x: number, y: number, z: number): void {
    this.burst(x, y, z, 10, 0xdddddd, 2, 0.5);
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
