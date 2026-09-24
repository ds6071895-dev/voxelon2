// Shared low-poly firearm models. Every model is built around the right-hand
// grip at the origin and points down local -Z, matching cameras and avatars.
//
// Two things make these read as "low poly but nice" rather than "a pile of
// boxes": every primitive is baked with per-face directional shading into a
// vertex-colour attribute (so a flat, unlit MeshBasicMaterial still shows
// volume), and everything that does not move is merged into ONE mesh per part.
// The parts that DO move — slide, bolt, pump, magazine, warhead — stay as their
// own named groups with a sensible pivot so the first-person view can cycle
// them, and named anchor objects mark the muzzle, ejection port, sight line and
// support-hand grip so animation code never hard-codes per-gun offsets.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Item, ITEMS } from './items';

/** Flat-shaded material for all gun geometry; volume comes from vertex colors.
 *  The first-person view clones this so it can tint with the world light. */
export const GUN_MATERIAL = new THREE.MeshBasicMaterial({ vertexColors: true });
/** Lenses, dots and glowing trim: never fogged, never dimmed. */
export const GUN_GLOW_MATERIAL = new THREE.MeshBasicMaterial({
  vertexColors: true, fog: false, toneMapped: false,
});

const models = new Map<number, THREE.Group>();

// Shared palette. Kept deliberately desaturated so the baked shading (not the
// hue) carries the form, and so every gun sits in the same world.
const C = {
  black: 0x121519, gunmetal: 0x232a31, dark: 0x2f373f,
  steel: 0x4c5761, steelLight: 0x6d7883, chrome: 0x97a3ac,
  wood: 0x5d3c22, woodMid: 0x7a4f2c, woodLight: 0x9a6a3d,
  brass: 0xc19442, polymer: 0x333940, rubber: 0x1a1e23,
  cobalt: 0x2c5069, cobaltLight: 0x3f7392, cobaltTrim: 0x59a2c1,
  olive: 0x4b5a43, oliveLight: 0x6c7b5d, tan: 0x8f7449,
  optic: 0x1d2b33,
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

  /** Tapered cylinder along Z: `front` is the -Z end radius. */
  cone(front: number, back: number, length: number, pos: V3, color: number, sides = 8): this {
    const geo = new THREE.CylinderGeometry(back, front, length, sides);
    geo.rotateX(Math.PI / 2);
    this.push(geo, pos, [0, 0, 0], color, false);
    return this;
  }

  /** A tube seen from the INSIDE: the winding is flipped so its walls face the
   *  bore. An ordinary open cylinder is edge-on (and therefore invisible) when
   *  you look straight down its axis, which is exactly what a player does with
   *  a scope — this is what gives them a tunnel to look through. */
  bore(radius: number, length: number, pos: V3, color: number, sides = 10): this {
    const geo = new THREE.CylinderGeometry(radius, radius, length, sides, 1, true);
    geo.rotateX(Math.PI / 2);
    geo.scale(-1, 1, 1);
    this.push(geo, pos, [0, 0, 0], color, false);
    return this;
  }

  glowBox(size: V3, pos: V3, color: number, rot: V3 = [0, 0, 0]): this {
    this.push(new THREE.BoxGeometry(...size), pos, rot, color, true);
    return this;
  }

  glowDisc(radius: number, pos: V3, color: number, sides = 8): this {
    const geo = new THREE.CylinderGeometry(radius, radius, 0.008, sides);
    geo.rotateX(Math.PI / 2);
    this.push(geo, pos, [0, 0, 0], color, true);
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

  /** Iron sights: a hooded front post and a rear notch, both on the same rail
   *  height so the sight anchor genuinely lines up with them. */
  frontSight(z: number, y = 0.24): this {
    this.box([0.075, 0.06, 0.05], [0, y - 0.03, z], C.black);
    this.box([0.018, 0.06, 0.018], [0, y + 0.025, z], C.chrome);
    for (const side of [-1, 1]) this.box([0.016, 0.075, 0.03], [side * 0.037, y + 0.03, z], C.black);
    return this;
  }

  rearSight(z: number, y = 0.24): this {
    this.box([0.09, 0.03, 0.05], [0, y - 0.015, z], C.black);
    for (const side of [-1, 1]) this.box([0.024, 0.06, 0.045], [side * 0.037, y + 0.025, z], C.black);
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

  /** Telescope/optic with rings, turret and a glowing objective ring. The bore
   *  is deliberately OPEN end to end: the whole point of a scope is that you
   *  aim through it, and a capped cylinder would sit as a black disc over the
   *  middle of the screen the moment the player aimed. */
  scope(z: number, length: number, radius: number, y: number, tint = GLOW.lens): this {
    this.tube(radius, length, [0, y, z], C.optic, 8, [0, 0, 0], true);
    this.bore(radius * 0.94, length, [0, y, z], 0x0b0e11);
    for (const end of [-1, 1]) {
      this.tube(radius * 1.22, 0.05, [0, y, z + end * (length / 2 - 0.025)], C.black, 8,
        [0, 0, 0], true);
    }
    // Objective glow as a ring of pips around the rim, not a lens that blocks.
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      this.glowBox([0.018, 0.018, 0.01],
        [Math.cos(a) * radius, y + Math.sin(a) * radius, z - length / 2 - 0.004], tint);
    }
    this.box([0.062, 0.055, 0.062], [0, y + radius + 0.02, z - length * 0.05], C.dark);
    this.box([0.05, 0.05, 0.05], [radius + 0.02, y, z - length * 0.05], C.dark);
    for (const rz of [-length * 0.3, length * 0.28]) {
      this.box([0.05, 0.12, 0.05], [0, y - radius - 0.06, z + rz], C.black);
      this.box([0.07, 0.035, 0.06], [0, y - radius - 0.005, z + rz], C.steel);
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

export type GunAction = 'auto' | 'slide' | 'pump' | 'bolt' | 'tube';
export type ShellKind = 'none' | 'pistol' | 'rifle' | 'shell';

/** How a gun behaves in the hands: what its action does after a shot, how hard
 *  it kicks, and what it throws out. Read by the first-person view. */
export interface GunFeel {
  action: GunAction;
  /** Moving part that cycles when fired ('' = none). */
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
  shell: ShellKind;
  /** Camera shake on firing (0 = none). */
  shake: number;
  /** True for a telescope you put your eye BEHIND: aiming pulls the eyepiece
   *  right up to the camera instead of holding the weapon at arm's length. */
  scoped?: boolean;
}

const FEEL: Record<number, GunFeel> = {
  [Item.Pistol]: {
    action: 'slide', cyclePart: 'slide', travel: 0.16, cycle: 0.13,
    kick: 0.8, flash: 0.85, smoke: 1, shell: 'pistol', shake: 0.012,
  },
  [Item.SMG]: {
    action: 'auto', cyclePart: 'bolt', travel: 0.1, cycle: 0.07,
    kick: 0.6, flash: 0.8, smoke: 1, shell: 'pistol', shake: 0.009,
  },
  [Item.Rifle]: {
    action: 'auto', cyclePart: 'bolt', travel: 0.14, cycle: 0.09,
    kick: 1, flash: 1, smoke: 1, shell: 'rifle', shake: 0.016,
  },
  [Item.BurstRifle]: {
    action: 'auto', cyclePart: 'bolt', travel: 0.12, cycle: 0.08,
    kick: 0.85, flash: 0.9, smoke: 1, shell: 'rifle', shake: 0.013,
  },
  [Item.Shotgun]: {
    action: 'pump', cyclePart: 'pump', travel: 0.22, cycle: 0.5,
    kick: 1.9, flash: 1.5, smoke: 3, shell: 'shell', shake: 0.03,
  },
  [Item.Sniper]: {
    action: 'bolt', cyclePart: 'bolt', travel: 0.2, cycle: 0.8,
    kick: 2.1, flash: 1.35, smoke: 2, shell: 'rifle', shake: 0.034, scoped: true,
  },
  [Item.RocketLauncher]: {
    action: 'tube', cyclePart: 'rocket', travel: 0, cycle: 0.35,
    kick: 2.6, flash: 2.2, smoke: 6, shell: 'none', shake: 0.05,
  },
};

const DEFAULT_FEEL: GunFeel = FEEL[Item.Rifle];

export function gunFeel(id: number): GunFeel {
  return FEEL[id] ?? DEFAULT_FEEL;
}

export function isGunItem(id: number): boolean {
  return !!ITEMS[id]?.gun;
}

// --- Models ------------------------------------------------------------------

function buildPistol(): Rig {
  const r = new Rig();
  // Frame: dust cover, beavertail and an accessory rail under the barrel.
  r.box([0.165, 0.115, 0.46], [0, 0.045, -0.16], C.dark);
  r.box([0.135, 0.07, 0.22], [0, 0.0, -0.36], C.gunmetal);
  for (let i = 0; i < 3; i++) r.box([0.14, 0.022, 0.024], [0, -0.038, -0.3 - i * 0.06], C.black);
  r.box([0.15, 0.05, 0.11], [0, 0.115, 0.05], C.dark, [-0.3, 0, 0]);
  r.box([0.075, 0.06, 0.05], [0, 0.135, 0.075], C.black, [-0.3, 0, 0]); // hammer shroud
  r.grip(0.03, C.gunmetal, C.polymer);
  r.guard(-0.17);
  // Magazine: rides inside the grip, drops out on reload.
  r.part('mag', [0, -0.05, 0.02]);
  r.box([0.105, 0.3, 0.125], [0, -0.17, 0.035], C.steel, [-0.22, 0, 0]);
  r.box([0.125, 0.032, 0.15], [0, -0.325, 0.055], C.black, [-0.22, 0, 0]);
  // Slide: serrated, ported, and carrying both sights so they cycle with it.
  r.part('slide', [0, 0.16, -0.2]);
  r.box([0.185, 0.15, 0.52], [0, 0.155, -0.22], C.steel);
  r.box([0.085, 0.024, 0.44], [0, 0.235, -0.22], C.steelLight);
  r.box([0.19, 0.055, 0.1], [0, 0.19, -0.46], C.steelLight); // front bevel
  r.box([0.035, 0.08, 0.16], [0.083, 0.175, -0.05], C.black); // ejection port
  r.box([0.03, 0.05, 0.13], [0.083, 0.16, -0.05], C.gunmetal);
  for (let i = 0; i < 5; i++) r.box([0.192, 0.09, 0.016], [0, 0.17, -0.015 - i * 0.036], C.gunmetal);
  for (let i = 0; i < 3; i++) r.box([0.192, 0.07, 0.014], [0, 0.16, -0.36 - i * 0.034], C.gunmetal);
  r.tube(0.04, 0.12, [0, 0.155, -0.51], C.chrome);
  r.tube(0.026, 0.01, [0, 0.155, -0.573], C.black);
  r.box([0.02, 0.05, 0.02], [0, 0.25, -0.44], C.chrome);
  r.box([0.09, 0.03, 0.045], [0, 0.245, -0.02], C.black);
  for (const side of [-1, 1]) r.box([0.026, 0.055, 0.04], [side * 0.036, 0.26, -0.02], C.black);
  r.anchor('muzzle', [0, 0.155, -0.6]);
  r.anchor('eject', [0.12, 0.18, -0.05]);
  r.anchor('sight', [0, 0.275, -0.02]);
  return r;
}

function buildSMG(): Rig {
  const r = new Rig();
  // Stamped receiver with a full-length top rail and a vented shroud.
  r.box([0.23, 0.22, 0.6], [0, 0.09, -0.3], C.cobalt);
  r.box([0.235, 0.05, 0.52], [0, 0.215, -0.31], C.cobaltLight);
  for (let i = 0; i < 7; i++) r.box([0.24, 0.026, 0.026], [0, 0.242, -0.09 - i * 0.07], C.black);
  r.box([0.245, 0.05, 0.42], [0, -0.02, -0.32], C.dark);
  r.box([0.2, 0.19, 0.36], [0, 0.1, -0.72], C.dark);
  for (const side of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      r.box([0.022, 0.075, 0.055], [side * 0.1, 0.1, -0.63 - i * 0.09], C.black);
    }
  }
  r.box([0.09, 0.03, 0.3], [0, 0.2, -0.72], C.cobaltLight);
  r.tube(0.042, 0.3, [0, 0.1, -0.8], C.black);
  r.brake(-0.95, 0.06, C.gunmetal, 0.1);
  r.box([0.16, 0.17, 0.17], [0, -0.02, -0.3], C.dark); // magwell
  r.grip(0.05, C.polymer, C.dark);
  r.guard(-0.06);
  r.box([0.1, 0.16, 0.11], [0, -0.06, -0.66], C.polymer, [0.25, 0, 0]); // fore grip
  // Compact red dot on the rail: an open frame with the glowing dot floating
  // in the middle of it, so the aim view stays clear.
  r.box([0.105, 0.045, 0.14], [0, 0.27, -0.36], C.black);
  r.box([0.115, 0.028, 0.14], [0, 0.375, -0.36], C.black);
  r.box([0.028, 0.08, 0.14], [-0.048, 0.33, -0.36], C.black);
  r.box([0.028, 0.08, 0.14], [0.048, 0.33, -0.36], C.black);
  r.glowBox([0.018, 0.018, 0.018], [0, 0.325, -0.36], GLOW.dot);
  r.part('mag', [0, -0.03, -0.3]);
  r.box([0.125, 0.42, 0.14], [0, -0.23, -0.3], C.gunmetal);
  r.box([0.145, 0.032, 0.16], [0, -0.45, -0.3], C.black);
  for (let i = 0; i < 4; i++) r.box([0.132, 0.02, 0.145], [0, -0.11 - i * 0.09, -0.3], C.dark);
  // Charging handle on the left, riding a short bolt track.
  r.part('bolt', [0, 0.2, -0.24]);
  r.box([0.075, 0.045, 0.05], [-0.13, 0.2, -0.24], C.chrome);
  r.box([0.06, 0.04, 0.13], [-0.1, 0.2, -0.24], C.steel);
  // Folding wire stock.
  r.part('stock', [0, 0.1, 0.02]);
  for (const side of [-1, 1]) r.box([0.026, 0.026, 0.36], [side * 0.085, 0.09, 0.2], C.dark);
  r.box([0.19, 0.1, 0.05], [0, 0.09, 0.39], C.rubber);
  r.box([0.05, 0.16, 0.05], [0, 0.03, 0.39], C.rubber);
  r.anchor('muzzle', [0, 0.1, -1.02]);
  r.anchor('eject', [0.12, 0.17, -0.26]);
  r.anchor('sight', [0, 0.322, -0.36]);
  r.anchor('grip2', [0, 0.0, -0.66]);
  return r;
}

function buildShotgun(): Rig {
  const r = new Rig();
  // Pump gun: receiver, vent-ribbed barrel over a magazine tube.
  r.box([0.23, 0.23, 0.52], [0, 0.1, -0.16], C.steel);
  r.box([0.235, 0.045, 0.44], [0, 0.235, -0.16], C.chrome);
  r.box([0.04, 0.09, 0.17], [0.09, 0.11, -0.07], C.black); // ejection port
  r.box([0.03, 0.05, 0.12], [0.092, 0.1, -0.07], C.brass); // shell on the lifter
  r.tube(0.055, 0.95, [0, 0.16, -0.68], C.steel);
  r.box([0.032, 0.032, 0.9], [0, 0.225, -0.68], C.dark);
  for (let i = 0; i < 6; i++) r.box([0.03, 0.045, 0.03], [0, 0.2, -0.32 - i * 0.14], C.dark);
  r.tube(0.042, 0.78, [0, 0.062, -0.6], C.gunmetal);
  r.tube(0.05, 0.06, [0, 0.062, -0.98], C.dark);
  r.box([0.02, 0.028, 0.02], [0, 0.245, -1.1], C.brass); // bead
  r.tube(0.038, 0.012, [0, 0.16, -1.16], C.black);
  // Walnut furniture: wrist, comb and a rubber pad.
  r.box([0.19, 0.19, 0.42], [0, 0.03, 0.28], C.woodMid, [0.07, 0, 0]);
  r.box([0.165, 0.055, 0.36], [0, 0.14, 0.3], C.woodLight, [0.07, 0, 0]);
  r.box([0.17, 0.2, 0.22], [0, 0.02, 0.08], C.wood, [0.2, 0, 0]);
  r.buttPad(0.53, 0.2, 0.24, 0.05);
  r.guard(-0.02);
  r.box([0.15, 0.1, 0.2], [0, -0.06, 0.08], C.wood, [0.2, 0, 0]);
  // Forend: the part you rack. Ribbed so the stroke is legible.
  r.part('pump', [0, 0.075, -0.62]);
  r.box([0.175, 0.15, 0.34], [0, 0.075, -0.62], C.woodMid);
  for (let i = 0; i < 5; i++) r.box([0.185, 0.035, 0.03], [0, 0.07, -0.75 + i * 0.065], C.wood);
  r.box([0.15, 0.03, 0.3], [0, 0.155, -0.62], C.woodLight);
  r.anchor('muzzle', [0, 0.16, -1.18]);
  r.anchor('eject', [0.13, 0.13, -0.06]);
  r.anchor('sight', [0, 0.26, -0.2]);
  r.anchor('grip2', [0, 0.0, -0.62], 'pump');
  return r;
}

function buildRifle(): Rig {
  const r = new Rig();
  // Wood-furnished automatic rifle: gas tube over the barrel, curved magazine.
  r.box([0.24, 0.24, 0.66], [0, 0.09, -0.32], C.gunmetal);
  r.box([0.245, 0.06, 0.5], [0, 0.225, -0.33], C.steel);
  r.box([0.11, 0.03, 0.42], [0, 0.258, -0.33], C.steelLight);
  r.box([0.2, 0.17, 0.42], [0, 0.075, -0.8], C.woodMid);
  r.box([0.205, 0.045, 0.36], [0, 0.17, -0.8], C.woodLight);
  r.box([0.19, 0.11, 0.34], [0, 0.235, -0.78], C.wood);
  for (let i = 0; i < 3; i++) r.box([0.2, 0.03, 0.05], [0, 0.29, -0.68 - i * 0.1], C.black);
  r.tube(0.032, 0.42, [0, 0.235, -0.98], C.gunmetal);
  r.box([0.115, 0.15, 0.11], [0, 0.185, -1.14], C.black);
  r.tube(0.042, 0.42, [0, 0.11, -1.22], C.black);
  r.frontSight(-1.36, 0.235);
  r.brake(-1.46, 0.06);
  r.rearSight(-0.62, 0.255);
  // Stock, wrist and grip.
  r.box([0.2, 0.21, 0.5], [0, 0.03, 0.36], C.woodMid, [0.06, 0, 0]);
  r.box([0.17, 0.055, 0.4], [0, 0.15, 0.38], C.woodLight, [0.06, 0, 0]);
  r.box([0.18, 0.2, 0.22], [0, 0.03, 0.12], C.wood, [0.18, 0, 0]);
  r.buttPad(0.62, 0.21, 0.25, 0.04);
  r.grip(-0.24, C.wood, C.woodLight, -0.14);
  r.guard(-0.04);
  // Curved magazine: three stacked segments, each tilted a little further.
  r.part('mag', [0, -0.02, -0.28]);
  r.box([0.135, 0.17, 0.15], [0, -0.09, -0.28], C.steel, [-0.08, 0, 0]);
  r.box([0.13, 0.16, 0.14], [0, -0.24, -0.31], C.gunmetal, [-0.3, 0, 0]);
  r.box([0.125, 0.15, 0.135], [0, -0.37, -0.38], C.gunmetal, [-0.55, 0, 0]);
  r.box([0.14, 0.03, 0.15], [0, -0.44, -0.45], C.black, [-0.55, 0, 0]);
  // Charging handle rides on the right, cycling with the bolt carrier.
  r.part('bolt', [0, 0.2, -0.2]);
  r.box([0.06, 0.05, 0.15], [0.115, 0.2, -0.2], C.chrome);
  r.box([0.05, 0.05, 0.05], [0.145, 0.2, -0.16], C.chrome);
  r.anchor('muzzle', [0, 0.11, -1.55]);
  r.anchor('eject', [0.14, 0.19, -0.2]);
  r.anchor('sight', [0, 0.3, -0.62]);
  r.anchor('grip2', [0, -0.02, -0.8]);
  return r;
}

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

function buildSniper(): Rig {
  const r = new Rig();
  // Bolt-action: heavy fluted barrel, chassis stock, bipod, full-size optic.
  r.box([0.2, 0.21, 0.64], [0, 0.11, -0.32], C.gunmetal);
  r.box([0.205, 0.05, 0.5], [0, 0.235, -0.33], C.steel);
  r.tube(0.043, 0.92, [0, 0.12, -1.12], C.steel);
  for (let i = 0; i < 4; i++) r.tube(0.052, 0.04, [0, 0.12, -0.8 - i * 0.19], C.gunmetal);
  r.brake(-1.62, 0.066, C.gunmetal, 0.16);
  r.box([0.19, 0.14, 0.52], [0, 0.02, -0.74], C.wood);
  r.box([0.195, 0.04, 0.44], [0, 0.095, -0.74], C.woodLight);
  r.box([0.2, 0.21, 0.58], [0, 0.02, 0.32], C.woodMid, [0.05, 0, 0]);
  r.box([0.165, 0.07, 0.34], [0, 0.155, 0.3], C.woodLight, [0.05, 0, 0]);
  r.box([0.19, 0.06, 0.14], [0, 0.19, 0.16], C.dark); // cheek riser post
  r.buttPad(0.63, 0.2, 0.26, 0.02);
  r.box([0.17, 0.18, 0.24], [0, 0.0, 0.08], C.wood, [0.22, 0, 0]);
  r.grip(0.02, C.wood, C.woodLight, -0.2);
  r.guard(-0.08);
  r.scope(-0.44, 0.66, 0.065, 0.32);
  r.part('mag', [0, 0.0, -0.26]);
  r.box([0.13, 0.22, 0.19], [0, -0.09, -0.26], C.gunmetal);
  r.box([0.14, 0.03, 0.2], [0, -0.21, -0.26], C.black);
  // Bipod, folded along the fore-end until you go prone... or aim.
  r.part('bipod', [0, -0.03, -0.95]);
  for (const side of [-1, 1]) {
    r.box([0.03, 0.34, 0.03], [side * 0.1, -0.19, -0.95], C.dark, [0, 0, side * 0.3]);
    r.box([0.06, 0.03, 0.07], [side * 0.15, -0.35, -0.95], C.rubber);
  }
  r.box([0.11, 0.06, 0.09], [0, -0.04, -0.95], C.gunmetal);
  // Bolt: rotates up, then draws straight back.
  r.part('bolt', [0, 0.145, -0.06]);
  r.tube(0.032, 0.34, [0, 0.145, -0.2], C.chrome);
  r.box([0.13, 0.04, 0.045], [0.07, 0.135, -0.06], C.chrome, [0, 0, -0.35]);
  r.box([0.055, 0.055, 0.055], [0.135, 0.115, -0.06], C.steelLight);
  r.anchor('muzzle', [0, 0.12, -1.72]);
  r.anchor('eject', [0.13, 0.18, -0.1]);
  r.anchor('sight', [0, 0.32, -0.1]);
  r.anchor('grip2', [0, -0.05, -0.74]);
  return r;
}

function buildRocketLauncher(): Rig {
  const r = new Rig();
  // Shoulder-fired tube: armoured collars, rear venturi, tan heat shield.
  r.tube(0.17, 1.3, [0, 0.2, -0.46], C.olive, 10);
  for (const z of [-0.95, -0.46, 0.0]) r.tube(0.188, 0.08, [0, 0.2, z], C.dark, 10);
  r.tube(0.192, 0.11, [0, 0.2, -1.09], C.dark, 10);
  r.cone(0.19, 0.245, 0.24, [0, 0.2, 0.18], C.dark, 10);
  r.tube(0.2, 0.012, [0, 0.2, 0.301], C.black, 10);
  r.box([0.32, 0.07, 0.46], [0, 0.4, -0.5], C.tan);
  r.box([0.24, 0.04, 0.38], [0, 0.45, -0.5], C.oliveLight);
  for (const z of [-0.66, -0.5, -0.34]) r.box([0.33, 0.028, 0.028], [0, 0.435, z], C.dark);
  r.box([0.26, 0.17, 0.14], [0, 0.13, 0.3], C.rubber); // shoulder rest
  r.box([0.1, 0.24, 0.12], [0, -0.05, -0.8], C.dark, [0.2, 0, 0]); // fore grip
  r.box([0.11, 0.05, 0.13], [0, -0.17, -0.83], C.rubber, [0.2, 0, 0]);
  r.grip(-0.2, C.dark, C.tan);
  r.guard(-0.36);
  r.scope(-0.42, 0.28, 0.05, 0.56, GLOW.amber);
  // Loaded warhead, visible in the mouth of the tube until it leaves.
  r.part('rocket', [0, 0.2, -1.0]);
  r.cone(0.055, 0.115, 0.2, [0, 0.2, -1.16], C.olive, 8);
  r.tube(0.115, 0.16, [0, 0.2, -1.0], C.oliveLight, 8);
  r.box([0.03, 0.19, 0.12], [0, 0.2, -0.95], C.dark);
  r.box([0.19, 0.03, 0.12], [0, 0.2, -0.95], C.dark);
  r.glowBox([0.03, 0.03, 0.03], [0, 0.2, -1.26], GLOW.amber);
  r.anchor('muzzle', [0, 0.2, -1.32]);
  r.anchor('eject', [0, 0.2, 0.34]);
  r.anchor('sight', [0, 0.56, -0.28]);
  r.anchor('grip2', [0, -0.1, -0.82]);
  return r;
}

function rigFor(id: number): Rig {
  switch (id) {
    case Item.Pistol: return buildPistol();
    case Item.SMG: return buildSMG();
    case Item.Shotgun: return buildShotgun();
    case Item.Sniper: return buildSniper();
    case Item.BurstRifle: return buildBurstRifle();
    case Item.RocketLauncher: return buildRocketLauncher();
    default: return buildRifle();
  }
}

/** Fresh transform group with intentionally chunky geometry and a tiny polygon
 * budget. Callers may freely pose/scale the returned root, and may look up the
 * named moving parts ('slide', 'bolt', 'pump', 'mag', 'rocket', 'stock',
 * 'bipod') and anchors ('muzzle', 'eject', 'sight', 'grip2'). Geometry and
 * materials are shared between clones — never dispose them. */
export function createGunModel(id: number): THREE.Group {
  let cached = models.get(id);
  if (!cached) {
    cached = buildRig(rigFor(id));
    models.set(id, cached);
  }
  return cached.clone(true);
}

/** Consistent transforms for each place a gun is presented. */
export function poseGunModel(
  model: THREE.Object3D, context: 'firstPerson' | 'avatar' | 'drop'
): void {
  if (context === 'firstPerson') {
    model.position.set(-0.03, 0.02, -0.08);
    model.rotation.set(0.02, 0.02, 0);
    model.scale.setScalar(0.48);
  } else if (context === 'avatar') {
    // Placed per frame by poseGunHold (remoteplayers.ts); only the size is
    // fixed here — big enough to read past the soldier's gloves.
    model.position.set(0, 1.2, -0.3);
    model.rotation.set(0, 0, 0);
    model.scale.setScalar(0.52);
  } else {
    model.rotation.set(0.12, 0.45, 0);
    model.scale.setScalar(0.3);
  }
}
