// Animated cosmetic models for placed machines, rendered on top of their
// (block) footprint: a spinning drill under each Autominer and a rocking
// pumpjack beam on each Oil Derrick. Purely visual — driven by the client-side
// Machines manager, like a lightweight mob/remote-player renderer.

import * as THREE from 'three';
import { MachineType } from './machines';
import type { Machines } from './machines';

const STEEL = 0x9aa0aa;
const DARK = 0x4a4d55;
const BIT = 0xc8ccd2;
const RED = 0xb44440;

function mat(color: number): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({ color });
}

interface ModelEntry {
  group: THREE.Group;
  type: MachineType;
  drill?: THREE.Object3D;  // autominer: spins
  gear?: THREE.Object3D;   // autominer: spins
  beam?: THREE.Object3D;   // derrick: rocks
  rod?: THREE.Object3D;    // derrick: bobs
}

export class MachineModels {
  private readonly scene: THREE.Scene;
  private readonly machines: Machines;
  private readonly models = new Map<string, ModelEntry>();
  private t = 0;

  constructor(scene: THREE.Scene, machines: Machines) {
    this.scene = scene;
    this.machines = machines;
  }

  private build(type: MachineType): ModelEntry {
    const group = new THREE.Group();
    if (type === MachineType.Autominer) {
      const drill = new THREE.Group();
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 1.1, 8), mat(STEEL));
      shaft.position.y = -0.55;
      const bit = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.45, 8), mat(BIT));
      bit.position.y = -1.18;
      bit.rotation.x = Math.PI; // point the cone downward (drilling)
      drill.add(shaft, bit);
      const gear = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.12, 8), mat(DARK));
      gear.position.y = 1.05;
      group.add(drill, gear);
      return { group, type, drill, gear };
    }
    // Oil derrick: a pumpjack beam that rocks on top of the tower + a pump rod.
    const pivot = new THREE.Group();
    pivot.position.y = 1.7;
    const beam = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.14, 0.18), mat(STEEL));
    const weight = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.36, 0.3), mat(DARK));
    weight.position.x = -0.75;
    pivot.add(beam, weight);
    const rod = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.95, 0.1), mat(DARK));
    rod.position.set(0.68, 1.2, 0);
    const valve = new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.05, 6, 12), mat(RED));
    valve.position.y = 0.55;
    valve.rotation.x = Math.PI / 2;
    group.add(pivot, rod, valve);
    return { group, type, beam: pivot, rod };
  }

  /** Sync models to the current machine set and animate them. */
  update(dt: number): void {
    this.t += dt;
    const seen = new Set<string>();
    for (const m of this.machines.list()) {
      const key = `${m.x},${m.y},${m.z}`;
      seen.add(key);
      let e = this.models.get(key);
      if (!e || e.type !== m.state.type) {
        if (e) { this.scene.remove(e.group); this.dispose(e); }
        e = this.build(m.state.type);
        e.group.position.set(m.x + 0.5, m.y + 0.5, m.z + 0.5);
        this.scene.add(e.group);
        this.models.set(key, e);
      }
      if (e.type === MachineType.Autominer) {
        if (e.drill) e.drill.rotation.y = this.t * 8;
        if (e.gear) e.gear.rotation.y = -this.t * 3;
      } else {
        const swing = Math.sin(this.t * 2);
        if (e.beam) e.beam.rotation.z = swing * 0.25;
        if (e.rod) e.rod.position.y = 1.2 + swing * 0.18;
      }
    }
    for (const [key, e] of this.models) {
      if (!seen.has(key)) {
        this.scene.remove(e.group);
        this.dispose(e);
        this.models.delete(key);
      }
    }
  }

  private dispose(e: ModelEntry): void {
    e.group.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
    });
  }
}
