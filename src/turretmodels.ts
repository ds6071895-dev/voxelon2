// Animated cosmetic models for placed TURRETS, like machinemodels.ts: a fixed
// base + a barrel that yaws to track its current target (state.facingYaw, set
// by the server's targeting scan and synced on each shot). A brief tracer is
// drawn from the muzzle to the hit point when the server reports a shot.

import * as THREE from 'three';
import type { TurretState } from './turrets';

const STEEL = 0x8a8f99;
const DARK = 0x44474f;
const RED = 0xb44440;

function mat(color: number): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({ color });
}

interface Entry {
  group: THREE.Group;
  turret: THREE.Object3D; // yaws to face the target
}

interface Tracer { line: THREE.Line; ttl: number; }

export class TurretModels {
  private readonly scene: THREE.Scene;
  private readonly turrets: Map<string, TurretState>;
  private readonly models = new Map<string, Entry>();
  private readonly tracers: Tracer[] = [];
  private readonly tracerMat = new THREE.LineBasicMaterial({ color: 0xffd060 });

  constructor(scene: THREE.Scene, turrets: Map<string, TurretState>) {
    this.scene = scene;
    this.turrets = turrets;
  }

  private build(): Entry {
    const group = new THREE.Group();
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.42, 0.3, 10), mat(DARK));
    base.position.y = 0.15;
    group.add(base);
    const turret = new THREE.Group();
    turret.position.y = 0.45;
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.3, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), mat(STEEL));
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.8, 8), mat(DARK));
    barrel.rotation.z = Math.PI / 2;       // lay the barrel horizontal...
    barrel.position.set(0, 0.05, -0.45);    // ...pointing forward (-Z)
    barrel.rotation.x = 0;
    const sight = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.1), mat(RED));
    sight.position.set(0, 0.22, 0);
    turret.add(dome, barrel, sight);
    group.add(turret);
    return { group, turret };
  }

  /** Spawn a short tracer line from a muzzle position to the hit point. */
  fireTracer(x: number, y: number, z: number, tx: number, ty: number, tz: number): void {
    const geo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(x + 0.5, y + 0.95, z + 0.5), new THREE.Vector3(tx, ty, tz),
    ]);
    const line = new THREE.Line(geo, this.tracerMat);
    this.scene.add(line);
    this.tracers.push({ line, ttl: 0.12 });
  }

  update(dt: number): void {
    const seen = new Set<string>();
    for (const [key, state] of this.turrets) {
      seen.add(key);
      let e = this.models.get(key);
      if (!e) {
        e = this.build();
        const [x, y, z] = key.split(',').map(Number);
        e.group.position.set(x + 0.5, y, z + 0.5);
        this.scene.add(e.group);
        this.models.set(key, e);
      }
      // Smoothly yaw the turret toward its last-known aim. facingYaw is the
      // world heading to the target; the barrel models point local -Z, and
      // THREE's rotation.y flips sign vs that heading — hence +PI.
      const target = state.facingYaw + Math.PI;
      let d = target - e.turret.rotation.y;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      e.turret.rotation.y += d * Math.min(1, 10 * dt);
    }
    for (const [key, e] of this.models) {
      if (!seen.has(key)) { this.scene.remove(e.group); this.dispose(e); this.models.delete(key); }
    }
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const t = this.tracers[i];
      t.ttl -= dt;
      if (t.ttl <= 0) {
        this.scene.remove(t.line);
        t.line.geometry.dispose();
        this.tracers.splice(i, 1);
      }
    }
  }

  private dispose(e: Entry): void {
    e.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
    });
  }
}
