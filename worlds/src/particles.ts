// Tiny particle system: death poofs, explosion smoke, generic puffs.

import * as THREE from 'three';

interface Particle {
  batch: Batch;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  color: THREE.Color;
  scale: number;
  life: number;
  maxLife: number;
  /** Downward pull (blocks/s²). Negative floats the particle upward. */
  gravity: number;
}

const MAX_PARTICLES = 250;

/** Every particle with the same texture and blend mode is one instance of one
 *  draw call (each used to be its own mesh and material: up to 250 sorted
 *  transparent draws, and a material compiled and thrown away per mote).
 *  Per-instance colour rides on instanceColor; the fade on `instanceAlpha`. */
class Batch {
  readonly mesh: THREE.InstancedMesh;
  readonly alpha: THREE.InstancedBufferAttribute;
  constructor(geo: THREE.PlaneGeometry, map: THREE.Texture | null, additive: boolean, scene: THREE.Scene) {
    const geometry = geo.clone();
    this.alpha = new THREE.InstancedBufferAttribute(new Float32Array(MAX_PARTICLES), 1);
    this.alpha.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('instanceAlpha', this.alpha);
    const material = new THREE.MeshBasicMaterial({
      transparent: true, depthWrite: false, side: THREE.DoubleSide, map,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    material.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float instanceAlpha;\nvarying float vInstanceAlpha;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvInstanceAlpha = instanceAlpha;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vInstanceAlpha;')
        .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.a *= vInstanceAlpha;');
    };
    material.customProgramCacheKey = () => 'particle-instanced';
    this.mesh = new THREE.InstancedMesh(geometry, material, MAX_PARTICLES);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.setColorAt(0, new THREE.Color());
    this.mesh.instanceColor!.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0;
    // Instances roam the whole arena; the plane's own bounds would cull them.
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
  }
}

const _matrix = new THREE.Matrix4();
const _scale = new THREE.Vector3();

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
  private readonly batches = new Map<string, Batch>();
  /** Live-particle cap: the graphics preset lowers it on weak devices. */
  limit = MAX_PARTICLES;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  setLimit(limit: number): void { this.limit = Math.max(0, Math.min(MAX_PARTICLES, Math.floor(limit))); }

  private get full(): boolean { return this.list.length >= this.limit; }

  private spawn(color: number, map: THREE.Texture | null | undefined, additive: boolean, scale: number,
    x: number, y: number, z: number, vel: THREE.Vector3, maxLife: number, gravity: number): void {
    const key = `${map?.uuid ?? 'none'}:${additive ? 'add' : 'mix'}`;
    let batch = this.batches.get(key);
    if (!batch) this.batches.set(key, batch = new Batch(this.geo, map ?? null, additive, this.scene));
    this.list.push({ batch, pos: new THREE.Vector3(x, y, z), vel, color: new THREE.Color(color),
      scale, life: 0, maxLife, gravity });
  }

  burst(
    x: number, y: number, z: number,
    count: number, color: number, speed: number, life = 0.6,
    opts: { gravity?: number; spread?: number; scale?: number; map?: THREE.Texture;
      additive?: boolean } = {}
  ): void {
    const spread = opts.spread ?? 0.6;
    for (let i = 0; i < count; i++) {
      if (this.full) return;
      this.spawn(color, opts.map, !!opts.additive, opts.scale ?? 1,
        x + (Math.random() - 0.5) * spread,
        y + (Math.random() - 0.5) * spread,
        z + (Math.random() - 0.5) * spread,
        new THREE.Vector3(
          (Math.random() - 0.5) * speed,
          Math.random() * speed * 0.8,
          (Math.random() - 0.5) * speed
        ),
        life * (0.6 + Math.random() * 0.8),
        opts.gravity ?? 4);
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
      if (this.full) return;
      const a = phase + k * Math.PI;
      this.spawn(k ? 0x7dffb0 : 0xc8ffe0, map, true, 1.1,
        x + Math.cos(a) * 0.75, y, z + Math.sin(a) * 0.75,
        new THREE.Vector3(-Math.sin(a) * 0.9, 1.2, Math.cos(a) * 0.9), 1.1, -1.2);
    }
  }

  /** A flat ring of glowing motes racing outward at waist height — the
   *  shockwave when a medkit's stim goes in. */
  healRing(x: number, y: number, z: number, count = 28): void {
    const map = healCrossTexture();
    for (let i = 0; i < count; i++) {
      if (this.full) return;
      const a = (i / count) * Math.PI * 2;
      this.spawn(i % 3 ? 0x8dffb8 : 0xffffff, map, true, 1.3,
        x + Math.cos(a) * 0.3, y, z + Math.sin(a) * 0.3,
        new THREE.Vector3(Math.cos(a) * 7, 0.4, Math.sin(a) * 7), 0.75, -2.5);
    }
  }

  /** A flat ring of glowing motes racing outward, in any colour. */
  ring(x: number, y: number, z: number, color: number, count = 24, speed = 6, life = 0.7): void {
    for (let i = 0; i < count; i++) {
      if (this.full) return;
      const a = (i / count) * Math.PI * 2;
      this.spawn(i % 3 ? color : 0xffffff, null, true, 0.9,
        x + Math.cos(a) * 0.25, y, z + Math.sin(a) * 0.25,
        new THREE.Vector3(Math.cos(a) * speed, 0.3, Math.sin(a) * speed), life, -1);
    }
  }

  /** Motes standing in a column that all drift upward — or, with `inward`,
   *  start wide and spiral into the centre line as they rise. */
  column(x: number, y: number, z: number, color: number, count: number, opts: { radius?: number; rise?: number;
    life?: number; inward?: boolean; map?: THREE.Texture } = {}): void {
    const radius = opts.radius ?? 0.6, rise = opts.rise ?? 4, life = opts.life ?? 0.9;
    for (let i = 0; i < count; i++) {
      if (this.full) return;
      const a = Math.random() * Math.PI * 2, r = radius * (0.4 + Math.random() * 0.6);
      const pull = opts.inward ? -r * 1.6 : 0;
      this.spawn(i % 4 ? color : 0xffffff, opts.map, true, opts.map ? 1.1 : 0.7,
        x + Math.cos(a) * r, y + Math.random() * 1.6, z + Math.sin(a) * r,
        new THREE.Vector3(Math.cos(a) * pull - Math.sin(a) * (opts.inward ? 2.4 : 0.6),
          rise * (0.6 + Math.random() * 0.6), Math.sin(a) * pull + Math.cos(a) * (opts.inward ? 2.4 : 0.6)),
        life * (0.7 + Math.random() * 0.6), -0.5);
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

  /** Chips of a broken block, in the block's own colour, thrown out and down. */
  debris(x: number, y: number, z: number, color: number, count = 9): void {
    this.burst(x, y, z, count, color, 4.2, 0.7, { gravity: 16, spread: 0.7, scale: 0.42 });
  }

  /** Gray puff where a round hits something. */
  poof(x: number, y: number, z: number): void {
    this.burst(x, y, z, 10, 0xdddddd, 2, 0.5);
  }

  update(dt: number, camera: THREE.Camera): void {
    for (const batch of this.batches.values()) batch.mesh.count = 0;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i];
      p.life += dt;
      if (p.life >= p.maxLife) {
        // Swap-remove: order inside a batch does not matter.
        this.list[i] = this.list[this.list.length - 1];
        this.list.pop();
        continue;
      }
      p.vel.y -= p.gravity * dt;
      p.vel.multiplyScalar(Math.max(0, 1 - 2 * dt));
      p.pos.addScaledVector(p.vel, dt);
      const b = p.batch, n = b.mesh.count++;
      // Billboard: every mote faces the camera.
      _matrix.compose(p.pos, camera.quaternion, _scale.setScalar(p.scale));
      b.mesh.setMatrixAt(n, _matrix);
      b.mesh.setColorAt(n, p.color);
      b.alpha.setX(n, 1 - p.life / p.maxLife);
    }
    for (const batch of this.batches.values()) {
      if (!batch.mesh.count) continue;
      batch.mesh.instanceMatrix.needsUpdate = true;
      batch.mesh.instanceColor!.needsUpdate = true;
      batch.alpha.needsUpdate = true;
    }
  }
}
