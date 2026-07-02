// Animated cosmetic models for placed machines, rendered on top of their
// (block) footprint: a gantry-framed spinning drill under each Autominer and a
// rust-red lattice pumpjack on each Oil Derrick. Purely visual — driven by the
// client-side Machines manager, like a lightweight mob/remote-player renderer.
//
// All meshes use per-face vertex shading (like the player avatars) so the
// models read as solid 3D even though the material is unlit.

import * as THREE from 'three';
import { MachineType } from './machines';
import type { Machines } from './machines';

// Per-face shading (right/left/top/bottom/front/back).
const FACE_SHADE = [0.8, 0.62, 1.0, 0.48, 0.9, 0.7];

// Shared unlit vertex-colour material for every machine mesh.
const MACHINE_MAT = new THREE.MeshBasicMaterial({ vertexColors: true });

const STEEL = 0x9aa0aa;
const STEEL_DARK = 0x4a4d55;
const STEEL_LIGHT = 0xc8ccd2;
const HAZARD = 0xdcb62c;
const RUST = 0x94452c;
const RUST_DARK = 0x5e2c1e;
const RED = 0xb44440;
const GLOW_AMBER = 0xf6903a;

function shadedBoxGeo(w: number, h: number, d: number, hex: number): THREE.BufferGeometry {
  const geo = new THREE.BoxGeometry(w, h, d);
  const color = new THREE.Color(hex);
  const pos = geo.getAttribute('position');
  const colors = new Float32Array(pos.count * 3);
  for (let f = 0; f < 6; f++) {
    const s = FACE_SHADE[f];
    for (let v = 0; v < 4; v++) {
      const k = f * 4 + v;
      colors[k * 3] = color.r * s;
      colors[k * 3 + 1] = color.g * s;
      colors[k * 3 + 2] = color.b * s;
    }
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  return geo;
}

/** Add a shaded box to `parent` at (x, y, z); returns the mesh. */
function box(
  parent: THREE.Object3D, hex: number,
  w: number, h: number, d: number,
  x: number, y: number, z: number
): THREE.Mesh {
  const mesh = new THREE.Mesh(shadedBoxGeo(w, h, d, hex), MACHINE_MAT);
  mesh.position.set(x, y, z);
  parent.add(mesh);
  return mesh;
}

/** A cone/cylinder mesh tinted to a flat colour via vertex colours. */
function tinted(geo: THREE.BufferGeometry, hex: number, brightness = 0.85): THREE.Mesh {
  const color = new THREE.Color(hex).multiplyScalar(brightness);
  const pos = geo.getAttribute('position');
  const colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    colors[i * 3] = color.r; colors[i * 3 + 1] = color.g; colors[i * 3 + 2] = color.b;
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  return new THREE.Mesh(geo, MACHINE_MAT);
}

interface ModelEntry {
  group: THREE.Group;
  type: MachineType;
  drill?: THREE.Object3D;   // autominer: spins
  gear?: THREE.Object3D;    // autominer: counter-spins
  beacon?: THREE.Object3D;  // autominer: pulsing warning light
  beam?: THREE.Object3D;    // derrick: rocks
  rod?: THREE.Object3D;     // derrick: bobs
  crank?: THREE.Object3D;   // derrick: spinning drive wheel
}

function buildAutominer(): ModelEntry {
  const group = new THREE.Group();

  // Gantry: four corner posts with top rails and hazard-striped feet.
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      box(group, STEEL_DARK, 0.12, 1.5, 0.12, sx * 0.42, 0.25, sz * 0.42);
      box(group, HAZARD, 0.14, 0.16, 0.14, sx * 0.42, -0.42, sz * 0.42);
    }
  }
  box(group, STEEL_DARK, 0.96, 0.1, 0.12, 0, 1.02, -0.42);
  box(group, STEEL_DARK, 0.96, 0.1, 0.12, 0, 1.02, 0.42);
  box(group, STEEL_DARK, 0.12, 0.1, 0.96, -0.42, 1.02, 0);
  box(group, STEEL_DARK, 0.12, 0.1, 0.96, 0.42, 1.02, 0);

  // Motor housing sitting in the gantry with an exhaust stack.
  box(group, STEEL, 0.62, 0.4, 0.62, 0, 0.9, 0);
  box(group, STEEL_DARK, 0.14, 0.34, 0.14, 0.24, 1.25, 0.24); // exhaust
  const beacon = box(group, GLOW_AMBER, 0.1, 0.1, 0.1, -0.24, 1.16, -0.24);

  // Spinning drill string: shaft, two helical flights, carbide bit.
  const drill = new THREE.Group();
  const shaft = tinted(new THREE.CylinderGeometry(0.09, 0.09, 1.5, 8), STEEL, 0.95);
  shaft.position.y = -0.75;
  drill.add(shaft);
  for (let i = 0; i < 3; i++) {
    const flight = tinted(new THREE.ConeGeometry(0.24 - i * 0.03, 0.16, 8), STEEL_LIGHT, 0.8 + i * 0.06);
    flight.position.y = -0.55 - i * 0.34;
    flight.rotation.x = Math.PI; // flights face down the hole
    drill.add(flight);
  }
  const bit = tinted(new THREE.ConeGeometry(0.16, 0.42, 6), STEEL_LIGHT, 1.0);
  bit.position.y = -1.6;
  bit.rotation.x = Math.PI;
  drill.add(bit);
  group.add(drill);

  // Drive gear on the housing.
  const gear = tinted(new THREE.CylinderGeometry(0.3, 0.3, 0.12, 8), STEEL_DARK, 1.0);
  gear.position.y = 1.16;
  group.add(gear);

  return { group, type: MachineType.Autominer, drill, gear, beacon };
}

function buildDerrick(): ModelEntry {
  const group = new THREE.Group();

  // Four rust-red lattice legs sloping in toward the crown.
  const legLen = 2.3;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const leg = box(group, RUST, 0.11, legLen, 0.11, sx * 0.3, 0.55, sz * 0.3);
      leg.rotation.z = -sx * 0.24;
      leg.rotation.x = sz * 0.24;
    }
  }
  // Cross-brace rings low and mid, and a crown platform on top.
  box(group, RUST_DARK, 0.98, 0.07, 0.07, 0, -0.05, -0.48);
  box(group, RUST_DARK, 0.98, 0.07, 0.07, 0, -0.05, 0.48);
  box(group, RUST_DARK, 0.07, 0.07, 0.98, -0.48, -0.05, 0);
  box(group, RUST_DARK, 0.07, 0.07, 0.98, 0.48, -0.05, 0);
  box(group, RUST_DARK, 0.62, 0.07, 0.07, 0, 0.8, -0.29);
  box(group, RUST_DARK, 0.62, 0.07, 0.07, 0, 0.8, 0.29);
  box(group, RUST_DARK, 0.07, 0.07, 0.62, -0.29, 0.8, 0);
  box(group, RUST_DARK, 0.07, 0.07, 0.62, 0.29, 0.8, 0);
  box(group, STEEL_DARK, 0.5, 0.09, 0.5, 0, 1.62, 0);

  // Rocking walking beam with a horsehead nose and a counterweight tail.
  const pivot = new THREE.Group();
  pivot.position.y = 1.78;
  box(pivot, STEEL, 1.7, 0.13, 0.16, 0, 0, 0);
  const nose = box(pivot, STEEL_LIGHT, 0.22, 0.3, 0.2, 0.82, -0.08, 0);
  nose.rotation.z = 0.3; // curved horsehead face
  box(pivot, RED, 0.34, 0.34, 0.28, -0.8, 0.02, 0);
  group.add(pivot);

  // Pump rod dropping from the horsehead into the wellhead.
  const rod = box(group, STEEL_DARK, 0.09, 1.0, 0.09, 0.78, 1.2, 0);

  // Drive: a spinning crank wheel beside the base + engine block. The wheel
  // lives inside a group so animating the group's Z spins it on its face axis,
  // and an offset crank pin makes the rotation visible.
  box(group, STEEL_DARK, 0.34, 0.26, 0.3, -0.62, -0.32, 0);
  const crank = new THREE.Group();
  crank.position.set(-0.62, -0.32, 0.2);
  const wheel = tinted(new THREE.CylinderGeometry(0.22, 0.22, 0.08, 10), RED, 0.9);
  wheel.rotation.x = Math.PI / 2;
  crank.add(wheel);
  box(crank, STEEL_LIGHT, 0.07, 0.07, 0.1, 0.13, 0, 0.05); // crank pin
  group.add(crank);

  // Wellhead stack with the red valve wheel.
  box(group, STEEL, 0.2, 0.5, 0.2, 0.78, 0.3, 0);
  const valve = tinted(new THREE.TorusGeometry(0.17, 0.05, 6, 12), RED, 1.0);
  valve.position.set(0.78, 0.62, 0);
  valve.rotation.x = Math.PI / 2;
  group.add(valve);

  return { group, type: MachineType.OilDerrick, beam: pivot, rod, crank };
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
    return type === MachineType.Autominer ? buildAutominer() : buildDerrick();
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
        if (e.beacon) {
          const pulse = 0.75 + Math.sin(this.t * 5) * 0.45;
          e.beacon.scale.setScalar(Math.max(0.3, pulse));
        }
      } else {
        const swing = Math.sin(this.t * 2);
        if (e.beam) e.beam.rotation.z = swing * 0.22;
        if (e.rod) e.rod.position.y = 1.2 + swing * 0.17;
        if (e.crank) e.crank.rotation.z = this.t * 2;
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
