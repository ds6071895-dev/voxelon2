// Shared low-poly models for the two mobility gadgets. Like the gun models,
// these bake directional shading into vertex colors so they keep their volume
// in the game's unlit first-person and world rendering paths.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Item } from './items';

export type GadgetModelContext = 'firstPerson' | 'avatar' | 'drop';

const MATERIAL = new THREE.MeshBasicMaterial({ vertexColors: true });
const models = new Map<number, THREE.Group>();
const LIGHT = new THREE.Vector3(0.34, 0.86, 0.38).normalize();
const scratchPos = new THREE.Vector3();
const scratchQuat = new THREE.Quaternion();
const scratchEuler = new THREE.Euler();
const scratchScale = new THREE.Vector3(1, 1, 1);
type V3 = [number, number, number];

interface Part {
  pivot: THREE.Vector3;
  geometry: THREE.BufferGeometry[];
}

function bake(geometry: THREE.BufferGeometry, position: V3, rotation: V3, color: number): void {
  geometry.applyMatrix4(new THREE.Matrix4().compose(
    scratchPos.set(...position),
    scratchQuat.setFromEuler(scratchEuler.set(...rotation)),
    scratchScale,
  ));
  geometry.deleteAttribute('uv');
  const base = new THREE.Color(color);
  const normal = geometry.attributes.normal;
  const colors = new Float32Array(normal.count * 3);
  for (let i = 0; i < normal.count; i++) {
    const dot = normal.getX(i) * LIGHT.x + normal.getY(i) * LIGHT.y + normal.getZ(i) * LIGHT.z;
    const shade = 0.58 + 0.4 * Math.max(0, dot) - 0.14 * Math.max(0, -dot);
    colors[i * 3] = base.r * shade;
    colors[i * 3 + 1] = base.g * shade;
    colors[i * 3 + 2] = base.b * shade;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
}

class Rig {
  readonly parts = new Map<string, Part>();
  private current = 'body';

  constructor() { this.part('body'); }

  part(name: string, pivot: V3 = [0, 0, 0]): this {
    this.current = name;
    if (!this.parts.has(name)) {
      this.parts.set(name, { pivot: new THREE.Vector3(...pivot), geometry: [] });
    }
    return this;
  }

  box(size: V3, position: V3, color: number, rotation: V3 = [0, 0, 0]): this {
    const geometry = new THREE.BoxGeometry(...size);
    bake(geometry, position, rotation, color);
    this.parts.get(this.current)!.geometry.push(geometry);
    return this;
  }

  cylinder(
    radiusTop: number, radiusBottom: number, length: number, position: V3,
    color: number, sides = 8, rotation: V3 = [0, 0, 0], open = false,
  ): this {
    const geometry = new THREE.CylinderGeometry(
      radiusTop, radiusBottom, length, sides, 1, open,
    );
    bake(geometry, position, rotation, color);
    this.parts.get(this.current)!.geometry.push(geometry);
    return this;
  }

  torus(radius: number, tube: number, position: V3, color: number, rotation: V3): this {
    const geometry = new THREE.TorusGeometry(radius, tube, 4, 8);
    bake(geometry, position, rotation, color);
    this.parts.get(this.current)!.geometry.push(geometry);
    return this;
  }
}

function finish(rig: Rig): THREE.Group {
  const root = new THREE.Group();
  root.userData.gadgetModel = true;
  for (const [name, part] of rig.parts) {
    const group = new THREE.Group();
    group.name = name;
    group.position.copy(part.pivot);
    const offset = new THREE.Matrix4().makeTranslation(
      -part.pivot.x, -part.pivot.y, -part.pivot.z,
    );
    const merged = mergeGeometries(part.geometry.map((geometry) =>
      geometry.applyMatrix4(offset)), false);
    if (merged) group.add(new THREE.Mesh(merged, MATERIAL));
    root.add(group);
  }
  return root;
}

function grapplingHook(): THREE.Group {
  const r = new Rig();
  const dark = 0x18242c, metal = 0x3d5866, edge = 0x11181d;
  const cyan = 0x49a7bd, steel = 0xa8bac3, rope = 0xd7c79b;

  // Compact powered winch body, with a loaded hook visibly seated at the nose.
  r.box([0.38, 0.34, 0.58], [0, 0.08, -0.08], dark);
  r.box([0.32, 0.1, 0.54], [0, 0.27, -0.1], metal);
  r.box([0.4, 0.045, 0.34], [0, 0.32, -0.16], cyan);
  r.box([0.18, 0.37, 0.18], [0, -0.22, 0.02], edge, [-0.18, 0, 0]);
  r.box([0.13, 0.22, 0.13], [0, -0.24, 0.015], metal, [-0.18, 0, 0]);
  r.box([0.035, 0.12, 0.035], [0, -0.05, -0.21], steel, [0.3, 0, 0]);
  r.cylinder(0.105, 0.105, 0.34, [0, 0.11, -0.53], metal, 8, [Math.PI / 2, 0, 0]);
  r.cylinder(0.065, 0.065, 0.04, [0, 0.11, -0.72], edge, 8, [Math.PI / 2, 0, 0]);
  r.cylinder(0.032, 0.032, 0.34, [0, 0.11, -0.88], steel, 6, [Math.PI / 2, 0, 0]);
  r.cylinder(0.12, 0.045, 0.24, [0, 0.11, -1.12], steel, 6, [Math.PI / 2, 0, 0]);
  for (const side of [-1, 1]) {
    r.box([0.035, 0.23, 0.04], [side * 0.095, 0.15, -1.18], steel,
      [0, 0, side * 0.62]);
  }
  r.box([0.22, 0.035, 0.04], [0, 0.235, -1.18], steel, [0, 0, 0.18]);
  r.box([0.06, 0.055, 0.15], [0, 0.38, -0.25], edge);
  r.box([0.025, 0.09, 0.025], [0, 0.43, -0.38], cyan);

  // The exposed spool is a named moving part used by the first-person action.
  r.part('spool', [0, 0.11, 0.09]);
  r.cylinder(0.19, 0.19, 0.3, [0, 0.11, 0.09], edge, 10, [0, 0, Math.PI / 2]);
  for (let i = -2; i <= 2; i++) {
    r.cylinder(0.155, 0.155, 0.045, [i * 0.05, 0.11, 0.09], rope, 10,
      [0, 0, Math.PI / 2]);
  }
  for (const x of [-0.18, 0.18]) {
    r.cylinder(0.23, 0.23, 0.04, [x, 0.11, 0.09], metal, 10,
      [0, 0, Math.PI / 2]);
  }
  return finish(r);
}

function bouncePad(): THREE.Group {
  const r = new Rig();
  const edge = 0x16211e, base = 0x344842, steel = 0x82938d;
  const green = 0x48d879, lime = 0xa6ff78, yellow = 0xffdc63;

  r.box([0.84, 0.13, 0.72], [0, 0.05, 0], edge);
  r.box([0.76, 0.08, 0.64], [0, 0.13, 0], base);
  for (const x of [-0.34, 0.34]) {
    for (const z of [-0.28, 0.28]) {
      r.cylinder(0.055, 0.065, 0.12, [x, -0.035, z], steel, 6);
    }
  }
  r.box([0.6, 0.035, 0.06], [0, 0.19, 0.27], yellow);
  r.box([0.6, 0.035, 0.06], [0, 0.19, -0.27], yellow);

  // Four chunky coils scale from the base when the pad fires.
  r.part('spring', [0, 0.16, 0]);
  for (const x of [-0.24, 0.24]) {
    for (const z of [-0.2, 0.2]) {
      for (let i = 0; i < 4; i++) {
        r.torus(0.09, 0.026, [x, 0.21 + i * 0.085, z], steel,
          [Math.PI / 2, 0, i * 0.42]);
      }
    }
  }
  r.box([0.055, 0.42, 0.055], [-0.22, 0.36, 0], green, [0, 0, -0.42]);
  r.box([0.055, 0.42, 0.055], [0.22, 0.36, 0], green, [0, 0, 0.42]);

  r.part('pad', [0, 0.55, 0]);
  r.box([0.76, 0.11, 0.64], [0, 0.55, 0], green);
  r.box([0.64, 0.045, 0.52], [0, 0.63, 0], lime);
  // Raised chevrons make the launch direction readable from every context.
  for (const z of [-0.15, 0.02, 0.19]) {
    r.box([0.27, 0.035, 0.07], [-0.12, 0.665, z], edge, [0, 0.48, 0]);
    r.box([0.27, 0.035, 0.07], [0.12, 0.665, z], edge, [0, -0.48, 0]);
  }
  return finish(r);
}

export function isModeledGadget(id: number): boolean {
  return id === Item.GrapplingHook || id === Item.JumpBoost;
}

export function createGadgetModel(id: number): THREE.Group {
  let cached = models.get(id);
  if (!cached) {
    cached = id === Item.JumpBoost ? bouncePad() : grapplingHook();
    models.set(id, cached);
  }
  return cached.clone(true);
}

export function poseGadgetModel(model: THREE.Object3D, context: GadgetModelContext): void {
  if (context === 'firstPerson') {
    model.position.set(-0.03, -0.02, -0.08);
    model.rotation.set(0.05, 0.04, 0);
    model.scale.setScalar(0.56);
  } else if (context === 'avatar') {
    model.position.set(0, -0.66, -0.18);
    model.rotation.set(-0.52, 0, 0);
    model.scale.setScalar(0.42);
  } else {
    model.rotation.set(0.12, 0.45, 0);
    model.scale.setScalar(0.38);
  }
}
