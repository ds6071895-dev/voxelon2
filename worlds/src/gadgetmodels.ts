// Shared low-poly models for the mobility gadgets and the throwables. Like the gun models,
// these bake directional shading into vertex colors so they keep their volume
// in the game's unlit first-person and world rendering paths.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Item } from './items';
import { Block } from './blocks';

export type GadgetModelContext = 'firstPerson' | 'avatar' | 'drop';

const MATERIAL = new THREE.MeshBasicMaterial({ vertexColors: true });
/** Flames and embers: never fogged, never dimmed by the held-item light tint. */
const GLOW_MATERIAL = new THREE.MeshBasicMaterial({ vertexColors: true, fog: false, toneMapped: false });
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

  torus(
    radius: number, tube: number, position: V3, color: number, rotation: V3,
    scale: V3 = [1, 1, 1], segments = 8,
  ): this {
    const geometry = new THREE.TorusGeometry(radius, tube, 4, segments);
    geometry.scale(...scale);
    bake(geometry, position, rotation, color);
    this.parts.get(this.current)!.geometry.push(geometry);
    return this;
  }

  /** Low-poly ellipsoid. Stays indexed so it merges with the boxes. */
  sphere(radius: number, position: V3, color: number, scale: V3 = [1, 1, 1], w = 10, h = 7): this {
    const geometry = new THREE.SphereGeometry(radius, w, h);
    geometry.scale(...scale);
    geometry.computeVertexNormals();
    bake(geometry, position, [0, 0, 0], color);
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
    if (merged) {
      const glow = name === 'flame';
      const mesh = new THREE.Mesh(merged, glow ? GLOW_MATERIAL : MATERIAL);
      mesh.userData.glow = glow;
      group.add(mesh);
    }
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

// ── Throwables ──────────────────────────────────────────────────────────────
// Built around the palm: the body's centre sits at the origin, the fuse head
// on top (+y) and the spoon lever down the right flank, so the same model
// works in the hand, in a slot icon, on the ground and tumbling in flight.

/** Shared fuse assembly: neck, fuse head, spoon lever, pull ring and pin. */
function fuse(r: Rig, top: number, flank: number): void {
  const steel = 0x6f797f, spoon = 0xaab3b8, ring = 0xd0d5d8, dark = 0x2c3236;
  r.cylinder(0.07, 0.08, 0.07, [0, top + 0.03, 0], dark, 8);
  r.box([0.15, 0.085, 0.13], [0, top + 0.1, 0], steel);
  r.box([0.1, 0.03, 0.1], [0, top + 0.155, 0], dark);
  // Spoon: from the fuse head down the right flank.
  const x0 = 0.08, y0 = top + 0.1, x1 = flank, y1 = top - 0.28;
  const len = Math.hypot(x1 - x0, y1 - y0);
  r.box([0.035, len, 0.07], [(x0 + x1) / 2, (y0 + y1) / 2, 0], spoon,
    [0, 0, Math.atan2(x1 - x0, y0 - y1)]);
  r.box([0.09, 0.035, 0.075], [0.06, top + 0.14, 0], spoon);
  // Pin through the head and the pull ring hanging off the left.
  r.cylinder(0.012, 0.012, 0.2, [-0.06, top + 0.1, 0], ring, 5, [0, 0, Math.PI / 2]);
  r.torus(0.06, 0.013, [-0.2, top + 0.08, 0], ring, [0, 0.35, 0.2], [1, 1, 1], 10);
}

function fragGrenade(): THREE.Group {
  const r = new Rig();
  const olive = 0x5a6a3f, oliveDark = 0x3b4729, band = 0xd8b23a;
  // Pineapple body: a faceted egg with raised segment ribs.
  r.sphere(0.2, [0, 0, 0], olive, [1, 1.16, 1], 10, 8);
  for (const y of [-0.12, 0, 0.12]) {
    const rr = 0.2 * Math.sqrt(1 - (y / 0.235) ** 2) + 0.004;
    r.torus(rr, 0.016, [0, y, 0], oliveDark, [Math.PI / 2, 0, 0], [1, 1, 1], 12);
  }
  for (const a of [0, Math.PI / 3, (2 * Math.PI) / 3]) {
    r.torus(0.203, 0.015, [0, 0, 0], oliveDark, [0, a, 0], [1, 1.16, 1], 12);
  }
  // Yellow HE band under the neck.
  r.cylinder(0.105, 0.13, 0.04, [0, 0.19, 0], band, 10);
  fuse(r, 0.22, 0.22);
  const g = finish(r);
  g.userData.throwable = true;
  return g;
}

function smokeGrenade(): THREE.Group {
  const r = new Rig();
  const body = 0x8a939a, bodyDark = 0x5d666d, band = 0xe9e4d4, mark = 0x3f8f7a, hole = 0x1c2124;
  r.cylinder(0.15, 0.15, 0.38, [0, 0, 0], body, 12);
  r.cylinder(0.157, 0.157, 0.035, [0, 0.175, 0], bodyDark, 12);
  r.cylinder(0.157, 0.157, 0.035, [0, -0.175, 0], bodyDark, 12);
  // Identification band + a coloured stripe.
  r.cylinder(0.153, 0.153, 0.08, [0, 0.03, 0], band, 12);
  r.cylinder(0.154, 0.154, 0.022, [0, 0.03, 0], mark, 12);
  // Emission ports around the top.
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    r.box([0.04, 0.03, 0.04], [Math.cos(a) * 0.1, 0.195, Math.sin(a) * 0.1], hole);
  }
  fuse(r, 0.2, 0.158);
  const g = finish(r);
  g.userData.throwable = true;
  return g;
}

function oilBomb(): THREE.Group {
  const r = new Rig();
  const shell = 0x2b2933, shellHi = 0x7e7c94, oil = 0x9a7420, cap = 0x676c77, rope = 0x8d6a3a;
  r.sphere(0.22, [0, 0, 0], shell, [1, 1, 1], 12, 9);
  // Gloss highlight and an amber oil sheen band.
  r.sphere(0.05, [-0.09, 0.1, 0.17], shellHi, [1, 0.8, 0.45], 6, 4);
  r.torus(0.215, 0.022, [0, -0.04, 0], oil, [Math.PI / 2 + 0.25, 0, 0.15], [1, 1, 1], 14);
  // Riveted collar + cap.
  r.cylinder(0.085, 0.1, 0.06, [0, 0.21, 0], cap, 10);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    r.box([0.025, 0.025, 0.025], [Math.cos(a) * 0.095, 0.21, Math.sin(a) * 0.095], 0xa4aab4);
  }
  r.cylinder(0.05, 0.05, 0.05, [0, 0.26, 0], cap, 8);
  // Rope fuse curling up and a lit spark.
  const pts: V3[] = [[0, 0.3, 0], [0.03, 0.34, 0], [0.07, 0.37, 0], [0.11, 0.38, 0]];
  for (const pt of pts) r.box([0.035, 0.035, 0.035], pt, rope);
  r.box([0.05, 0.05, 0.05], [0.14, 0.395, 0], 0xffc34d, [0.4, 0.4, 0.4]);
  r.box([0.03, 0.03, 0.03], [0.17, 0.42, 0.01], 0xff7a2a, [0.2, 0.6, 0]);
  const g = finish(r);
  g.userData.throwable = true;
  return g;
}

// ── Torch ───────────────────────────────────────────────────────────────────
// A proper hand torch rather than the flat sprite: a squared hardwood haft
// with a leather grip, an iron collar holding a pitch-soaked wrap, glowing
// embers and a layered flame (orange shell, yellow core, white tip) that
// flickers. The origin is the grip, so it sits in the fist.

function torch(): THREE.Group {
  const r = new Rig();
  const wood = 0x8a5a2e, woodDark = 0x6a4322, grip = 0x3e2a1a, iron = 0x4a4f55, ironHi = 0x7c838a;
  const wrap = 0x2e2118, wrapHi = 0x5a3b22;
  r.box([0.1, 0.66, 0.1], [0, -0.02, 0], wood);
  for (const y of [-0.26, -0.06, 0.14]) r.box([0.104, 0.03, 0.104], [0, y, 0], woodDark);
  r.box([0.12, 0.16, 0.12], [0, -0.08, 0], grip);
  r.box([0.125, 0.025, 0.125], [0, 0.0, 0], wrapHi);
  r.box([0.125, 0.025, 0.125], [0, -0.16, 0], wrapHi);
  r.box([0.09, 0.05, 0.09], [0, -0.36, 0], woodDark); // pommel
  // Iron collar + prongs holding the wrap.
  r.box([0.15, 0.05, 0.15], [0, 0.3, 0], iron);
  for (const [x, z] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    r.box([0.03, 0.14, 0.03], [x * 0.075, 0.38, z * 0.075], ironHi);
  }
  r.box([0.16, 0.16, 0.16], [0, 0.4, 0], wrap);
  r.box([0.17, 0.035, 0.17], [0, 0.36, 0], wrapHi);
  r.box([0.17, 0.035, 0.17], [0, 0.43, 0], wrapHi);
  r.part('flame', [0, 0.48, 0]);
  // Embers on top of the wrap.
  r.box([0.15, 0.03, 0.15], [0, 0.485, 0], 0xff5a1a);
  r.box([0.05, 0.035, 0.05], [0.04, 0.5, -0.03], 0xffd060);
  r.box([0.04, 0.035, 0.04], [-0.05, 0.5, 0.04], 0xffb040);
  // Layered flame, turned 45° so the silhouette is a diamond, not a slab.
  r.box([0.14, 0.1, 0.14], [0, 0.535, 0], 0xff6a14, [0, Math.PI / 4, 0]);
  r.box([0.11, 0.1, 0.11], [0, 0.61, 0], 0xff8c22, [0, Math.PI / 4 + 0.2, 0]);
  r.box([0.08, 0.2, 0.08], [0, 0.6, 0], 0xffd24a, [0, Math.PI / 4, 0]);
  r.box([0.06, 0.08, 0.06], [0, 0.69, 0], 0xffb238, [0, 0.4, 0]);
  r.box([0.035, 0.08, 0.035], [0, 0.76, 0], 0xfff2b0, [0, Math.PI / 4, 0]);
  r.box([0.03, 0.05, 0.03], [0.05, 0.68, 0.03], 0xffc040, [0.3, 0.5, 0.2]);
  const g = finish(r);
  g.userData.torch = true;
  return g;
}

/** Make a torch model's flame flicker whenever it is drawn. */
function flicker(model: THREE.Object3D): void {
  const flame = model.getObjectByName('flame');
  const mesh = flame?.children[0];
  if (!flame || !mesh) return;
  const seed = Math.random() * 100;
  mesh.onBeforeRender = () => {
    const t = performance.now() * 0.001 + seed;
    const f = 1 + Math.sin(t * 17) * 0.06 + Math.sin(t * 29.3) * 0.05;
    flame.scale.set(1 + Math.sin(t * 11.7) * 0.05, f, 1 + Math.cos(t * 13.1) * 0.05);
    flame.rotation.y = Math.sin(t * 3.1) * 0.25;
  };
}

/** Items modelled for a single fist (throwables, the torch): no two-hand pose. */
export function isOneHandModel(id: number): boolean {
  return isThrowableModel(id) || id === Block.Torch;
}

/** Thrown gadgets with a real model (frag, smoke, oil bomb). */
export function isThrowableModel(id: number): boolean {
  return id === Item.Grenade || id === Item.SmokeGrenade || id === Item.OilBomb;
}

export function isModeledGadget(id: number): boolean {
  return id === Item.GrapplingHook || id === Item.JumpBoost || isThrowableModel(id) || id === Block.Torch;
}

export function createGadgetModel(id: number): THREE.Group {
  let cached = models.get(id);
  if (!cached) {
    cached = id === Item.JumpBoost ? bouncePad()
      : id === Item.Grenade ? fragGrenade()
      : id === Item.SmokeGrenade ? smokeGrenade()
      : id === Item.OilBomb ? oilBomb()
      : id === Block.Torch ? torch()
      : grapplingHook();
    models.set(id, cached);
  }
  const model = cached.clone(true);
  if (model.userData.torch) flicker(model);
  return model;
}

export function poseGadgetModel(model: THREE.Object3D, context: GadgetModelContext): void {
  if (model.userData.torch) {
    // Upright in the fist, leaning away a touch, flame on top.
    if (context === 'firstPerson') {
      model.position.set(0.0, -0.04, 0.0);
      model.rotation.set(0.1, -0.6, 0.12);
      model.scale.setScalar(0.5);
    } else if (context === 'avatar') {
      model.position.set(0, -0.7, -0.1);
      model.rotation.set(-1.2, 0, 0);
      model.scale.setScalar(0.52);
    } else {
      model.rotation.set(0, 0.45, 0.35);
      model.scale.setScalar(0.5);
    }
    return;
  }
  if (model.userData.throwable) {
    // Palm-sized: held up in the fist, fuse on top, spoon under the fingers.
    if (context === 'firstPerson') {
      model.position.set(0.0, 0.06, -0.04);
      model.rotation.set(0.1, -0.5, 0.08);
      model.scale.setScalar(0.62);
    } else if (context === 'avatar') {
      model.position.set(0, -0.76, -0.04);
      model.rotation.set(0, 0, 0);
      model.scale.setScalar(0.5);
    } else {
      model.rotation.set(0.2, 0.45, 0);
      model.scale.setScalar(0.6);
    }
    return;
  }
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
