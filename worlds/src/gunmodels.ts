// Shared low-poly firearm models. Every model is built around the right-hand
// grip at the origin and points down local -Z, matching cameras and avatars.
//
// Two things make these read as "low poly but nice" rather than "a pile of
// boxes": every primitive is baked with per-face directional shading into a
// vertex-colour attribute (so a flat, unlit MeshBasicMaterial still shows
// volume), and everything that does not move is merged into ONE mesh per part.
// The parts that DO move — bolt, magazine, stock — stay as their own named
// groups with a sensible pivot so the first-person view can cycle them, and
// named anchor objects mark the muzzle, ejection port, sight line and
// support-hand grip so animation code never hard-codes offsets.
//
// Worlds has one gun, the Duels Burst Rifle.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { ITEMS } from './items';

/** Flat-shaded material for all gun geometry; volume comes from vertex colors.
 *  The first-person view clones this so it can tint with the world light. */
const GUN_MATERIAL = new THREE.MeshBasicMaterial({ vertexColors: true });
/** Lenses, dots and glowing trim: never fogged, never dimmed. */
const GUN_GLOW_MATERIAL = new THREE.MeshBasicMaterial({
  vertexColors: true, fog: false, toneMapped: false,
});

let cachedRifle: THREE.Group | null = null;

// Palette. Kept deliberately desaturated so the baked shading (not the hue)
// carries the form.
const C = {
  black: 0x121519, gunmetal: 0x232a31, dark: 0x2f373f,
  steel: 0x4c5761, steelLight: 0x6d7883, chrome: 0x97a3ac,
  polymer: 0x333940, rubber: 0x1a1e23,
  cobalt: 0x2c5069, cobaltLight: 0x3f7392, cobaltTrim: 0x59a2c1,
};
const GLOW = { lens: 0x8fe8ff, dot: 0xff5340, amber: 0xffb347 };

// Key light for the bake. Slightly right-of-front and high, which is where a
// held weapon reads best: tops catch, right flanks half-catch, bottoms go dark.
const LIGHT = new THREE.Vector3(0.34, 0.86, 0.38).normalize();
const AMBIENT = 0.6, DIRECT = 0.4, SHADOW = 0.16;

/** Fold a primitive's transform + colour into a merge-ready geometry. Normals
 *  are transformed first so the shading is computed in model space. */
function bake(
  geo: THREE.BufferGeometry, matrix: THREE.Matrix4, color: number, glow: boolean
): THREE.BufferGeometry {
  geo.applyMatrix4(matrix);
  geo.deleteAttribute('uv'); // merged parts must share one attribute set
  const c = new THREE.Color(color);
  const normal = geo.attributes.normal;
  const out = new Float32Array(normal.count * 3);
  for (let i = 0; i < normal.count; i++) {
    let f = 1;
    if (!glow) {
      const d = normal.getX(i) * LIGHT.x + normal.getY(i) * LIGHT.y +
        normal.getZ(i) * LIGHT.z;
      f = AMBIENT + DIRECT * Math.max(0, d) - SHADOW * Math.max(0, -d);
    }
    out[i * 3] = c.r * f;
    out[i * 3 + 1] = c.g * f;
    out[i * 3 + 2] = c.b * f;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(out, 3));
  return geo;
}

interface RigPart {
  pivot: THREE.Vector3;
  solid: THREE.BufferGeometry[];
  glow: THREE.BufferGeometry[];
}

type V3 = [number, number, number];

const SCRATCH_POS = new THREE.Vector3();
const SCRATCH_QUAT = new THREE.Quaternion();
const SCRATCH_EULER = new THREE.Euler();
const SCRATCH_SCALE = new THREE.Vector3(1, 1, 1);

/** Accumulates primitives into named parts, then merges each part down to a
 *  single mesh. `part()` switches which part subsequent primitives land in. */
class Rig {
  readonly parts = new Map<string, RigPart>();
  readonly anchors: { name: string; part: string; pos: THREE.Vector3 }[] = [];
  private cur = 'body';

  constructor() {
    this.part('body');
  }

  /** Start adding to `name`. `pivot` is the point it rotates/slides about. */
  part(name: string, pivot: V3 = [0, 0, 0]): this {
    this.cur = name;
    if (!this.parts.has(name)) {
      this.parts.set(name, {
        pivot: new THREE.Vector3(...pivot), solid: [], glow: [],
      });
    }
    return this;
  }

  private push(geo: THREE.BufferGeometry, pos: V3, rot: V3, color: number, glow: boolean): void {
    const m = new THREE.Matrix4().compose(
      SCRATCH_POS.set(...pos),
      SCRATCH_QUAT.setFromEuler(SCRATCH_EULER.set(...rot)),
      SCRATCH_SCALE);
    const p = this.parts.get(this.cur)!;
    (glow ? p.glow : p.solid).push(bake(geo, m, color, glow));
  }

  box(size: V3, pos: V3, color: number, rot: V3 = [0, 0, 0]): this {
    this.push(new THREE.BoxGeometry(...size), pos, rot, color, false);
    return this;
  }

  /** Cylinder lying along local Z (the barrel axis) unless rotated. Open tubes
   *  have no end caps, so a sight line can pass straight down the bore. */
  tube(
    radius: number, length: number, pos: V3, color: number, sides = 8,
    rot: V3 = [0, 0, 0], open = false
  ): this {
    const geo = new THREE.CylinderGeometry(radius, radius, length, sides, 1, open);
    geo.rotateX(Math.PI / 2);
    this.push(geo, pos, rot, color, false);
    return this;
  }

  glowBox(size: V3, pos: V3, color: number, rot: V3 = [0, 0, 0]): this {
    this.push(new THREE.BoxGeometry(...size), pos, rot, color, true);
    return this;
  }

  /** A named point animation code can look up (muzzle, sight, eject, grip2). */
  anchor(name: string, pos: V3, part = 'body'): this {
    this.anchors.push({ name, part, pos: new THREE.Vector3(...pos) });
    return this;
  }

  // --- Shared furniture ------------------------------------------------------

  /** Pistol grip with finger grooves and a checkered side panel. */
  grip(z: number, color = C.polymer, panel = C.dark, tilt = -0.22): this {
    this.box([0.14, 0.32, 0.155], [0, -0.16, z], color, [tilt, 0, 0]);
    for (const side of [-1, 1]) {
      this.box([0.012, 0.22, 0.11], [side * 0.073, -0.16, z], panel, [tilt, 0, 0]);
    }
    for (let i = 0; i < 3; i++) {
      this.box([0.148, 0.03, 0.03], [0, -0.08 - i * 0.08, z - 0.075 + i * 0.017],
        C.black, [tilt, 0, 0]);
    }
    this.box([0.135, 0.03, 0.14], [0, -0.315, z + 0.02], C.black, [tilt, 0, 0]);
    return this;
  }

  /** Trigger guard + trigger, drawn as a squared-off loop. */
  guard(z: number, color = C.black): this {
    this.box([0.028, 0.13, 0.028], [-0.068, -0.055, z], color);
    this.box([0.028, 0.13, 0.028], [0.068, -0.055, z], color);
    this.box([0.165, 0.028, 0.028], [0, -0.115, z], color);
    this.box([0.028, 0.028, 0.1], [-0.068, -0.115, z + 0.06], color);
    this.box([0.028, 0.028, 0.1], [0.068, -0.115, z + 0.06], color);
    this.box([0.028, 0.075, 0.026], [0, -0.05, z - 0.012], C.chrome, [0.3, 0, 0]);
    return this;
  }

  /** Slotted muzzle device: a collar with cuts, plus the dark bore. */
  brake(z: number, radius: number, color = C.gunmetal, length = 0.13): this {
    this.tube(radius, length, [0, 0.11, z], color);
    for (let i = 0; i < 3; i++) {
      this.box([radius * 2.1, 0.02, 0.022], [0, 0.11, z - length / 2 + 0.03 + i * 0.035], C.black);
    }
    this.tube(radius * 0.62, 0.01, [0, 0.11, z - length / 2 - 0.004], C.black);
    return this;
  }

  /** Butt pad with a lighter comb: reads as a stock end from any angle. */
  buttPad(z: number, w = 0.2, h = 0.22, y = 0.04): this {
    this.box([w, h, 0.05], [0, y, z], C.rubber);
    for (let i = 0; i < 3; i++) {
      this.box([w * 0.94, 0.02, 0.026], [0, y - 0.06 + i * 0.06, z + 0.012], C.black);
    }
    return this;
  }
}

/** Merge each rig part into one mesh and hang the anchors off their groups. */
function buildRig(rig: Rig): THREE.Group {
  const root = new THREE.Group();
  root.userData.gunModel = true;
  for (const [name, p] of rig.parts) {
    const group = new THREE.Group();
    group.name = name;
    group.position.copy(p.pivot);
    const off = new THREE.Matrix4().makeTranslation(-p.pivot.x, -p.pivot.y, -p.pivot.z);
    for (const [geos, mat, glow] of [
      [p.solid, GUN_MATERIAL, false] as const, [p.glow, GUN_GLOW_MATERIAL, true] as const,
    ]) {
      if (!geos.length) continue;
      const merged = mergeGeometries(geos.map((g) => g.applyMatrix4(off)), false);
      if (!merged) continue;
      const mesh = new THREE.Mesh(merged, mat);
      mesh.name = glow ? `${name}:glow` : `${name}:mesh`;
      mesh.userData.glow = glow;
      group.add(mesh);
    }
    root.add(group);
  }
  for (const a of rig.anchors) {
    const parent = root.getObjectByName(a.part) as THREE.Group | undefined;
    const holder = parent ?? root;
    const marker = new THREE.Object3D();
    marker.name = a.name;
    marker.position.copy(a.pos).sub(holder.position);
    holder.add(marker);
  }
  return root;
}

// --- Per-gun feel ------------------------------------------------------------

/** How the gun behaves in the hands: how its bolt cycles after a shot, how hard
 *  it kicks, and what it throws out. Read by the first-person view. */
interface GunFeel {
  /** Moving part that cycles when fired. */
  cyclePart: string;
  /** How far that part travels back, in model units. */
  travel: number;
  /** Seconds for one full cycle of the action. */
  cycle: number;
  /** Recoil impulse scale (1 = rifle). */
  kick: number;
  /** Muzzle flash size scale. */
  flash: number;
  /** Smoke puffs per shot. */
  smoke: number;
  /** Camera shake on firing (0 = none). */
  shake: number;
}

export const GUN_FEEL: GunFeel = {
  cyclePart: 'bolt', travel: 0.12, cycle: 0.08,
  kick: 0.85, flash: 0.9, smoke: 1, shake: 0.013,
};

export function isGunItem(id: number): boolean {
  return !!ITEMS[id]?.gun;
}

// --- Models ------------------------------------------------------------------

function buildBurstRifle(): Rig {
  const r = new Rig();
  // Cobalt service carbine: polymer shell, glowing trim, holographic sight.
  r.box([0.24, 0.25, 0.66], [0, 0.09, -0.32], C.cobalt);
  r.box([0.245, 0.06, 0.6], [0, 0.225, -0.34], C.cobaltLight);
  r.box([0.1, 0.028, 0.5], [0, 0.26, -0.34], C.cobaltTrim);
  r.box([0.22, 0.2, 0.46], [0, 0.09, -0.84], C.dark);
  for (const side of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      r.box([0.024, 0.075, 0.06], [side * 0.1, 0.09, -0.72 - i * 0.11], C.black);
    }
    r.glowBox([0.008, 0.02, 0.3], [side * 0.112, 0.16, -0.84], GLOW.lens);
  }
  r.tube(0.04, 0.36, [0, 0.11, -1.2], C.black);
  r.brake(-1.4, 0.058, C.steel, 0.12);
  r.box([0.09, 0.2, 0.11], [0, -0.05, -0.9], C.polymer, [0.35, 0, 0]);
  r.grip(0, C.polymer, C.dark);
  r.guard(-0.04);
  // Carry handle with a holographic reticle hanging in the open frame.
  for (const z of [-0.62, -0.36]) r.box([0.05, 0.13, 0.05], [0, 0.315, z], C.dark);
  r.box([0.115, 0.05, 0.36], [0, 0.4, -0.49], C.dark);
  for (const side of [-1, 1]) r.box([0.022, 0.11, 0.03], [side * 0.05, 0.32, -0.55], C.black);
  r.glowBox([0.05, 0.008, 0.008], [0, 0.32, -0.55], GLOW.lens);
  r.glowBox([0.008, 0.05, 0.008], [0, 0.32, -0.55], GLOW.lens);
  r.glowBox([0.018, 0.018, 0.018], [0, 0.32, -0.45], GLOW.dot);
  r.part('mag', [0, -0.02, -0.28]);
  r.box([0.14, 0.36, 0.17], [0, -0.16, -0.28], C.dark);
  r.glowBox([0.012, 0.16, 0.02], [0.072, -0.16, -0.28], GLOW.amber);
  r.box([0.15, 0.03, 0.18], [0, -0.35, -0.28], C.black);
  r.part('bolt', [0, 0.21, -0.24]);
  r.box([0.055, 0.05, 0.14], [0.115, 0.21, -0.24], C.steelLight);
  // Telescoping stock on twin struts.
  r.part('stock', [0, 0.1, 0.02]);
  for (const side of [-1, 1]) r.box([0.032, 0.032, 0.4], [side * 0.07, 0.11, 0.24], C.gunmetal);
  r.box([0.17, 0.22, 0.12], [0, 0.07, 0.46], C.dark);
  r.box([0.1, 0.05, 0.3], [0, 0.2, 0.3], C.dark);
  r.buttPad(0.53, 0.18, 0.24, 0.07);
  r.anchor('muzzle', [0, 0.11, -1.49]);
  r.anchor('eject', [0.13, 0.2, -0.26]);
  r.anchor('sight', [0, 0.32, -0.45]);
  r.anchor('grip2', [0, -0.05, -0.9]);
  return r;
}

/** Fresh transform group with intentionally chunky geometry and a tiny polygon
 * budget. Callers may freely pose/scale the returned root, and may look up the
 * named moving parts ('bolt', 'mag', 'stock') and anchors ('muzzle', 'eject',
 * 'sight', 'grip2'). Geometry and materials are shared between clones — never
 * dispose them. */
export function createGunModel(): THREE.Group {
  cachedRifle ??= buildRig(buildBurstRifle());
  return cachedRifle.clone(true);
}

/** Consistent transforms for each place a gun is presented. */
export function poseGunModel(
  model: THREE.Object3D, context: 'firstPerson' | 'avatar'
): void {
  if (context === 'firstPerson') {
    model.position.set(-0.03, 0.02, -0.08);
    model.rotation.set(0.02, 0.02, 0);
    model.scale.setScalar(0.48);
  } else {
    // Placed per frame by poseGunHold (remoteplayers.ts); only the size is
    // fixed here — big enough to read past the soldier's gloves.
    model.position.set(0, 1.2, -0.3);
    model.rotation.set(0, 0, 0);
    model.scale.setScalar(0.52);
  }
}
