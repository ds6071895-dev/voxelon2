// Neutral avatar body, cosmetics and poses shared by gameplay and previews.
// No roster, network, DOM labels or mode-specific body substitutions.
import * as THREE from 'three';
import { AvatarSurface, avatarTexture } from './avatartex';
import {
  Cosmetics, EYE_COLORS, HAIR_COLORS, HAT_COLORS, PANTS_COLORS,
  SHIRT_COLORS, SKIN_TONES, defaultCosmetics, sanitizeCosmetics,
} from './character';

// Per-face shading (right/left/top/bottom/front/back) — mimics Minecraft's
// directional lighting so the model reads as 3D even without real lights.
const FACE_SHADE = [0.75, 0.6, 1.0, 0.45, 0.85, 0.7];

/** The skin tone a given player renders with — cosmetics-aware, falling back
 *  to the seed-derived default. Shared so the local first-person hand matches
 *  the avatar other players see. */
export function skinColorFor(seed: number, cosmetics?: Cosmetics): THREE.Color {
  const c = cosmetics ?? defaultCosmetics(seed);
  return new THREE.Color(SKIN_TONES[c.skin]?.hex ?? SKIN_TONES[0].hex);
}

// ─── geometry helpers ──────────────────────────────────────────────────────

/**
 * Avatar parts are deliberately built from overlapping boxes. At long range,
 * the depth buffer cannot reliably distinguish the very small gaps between
 * skin, cuffs, facial pixels, cosmetics and armor, which causes z-fighting.
 * Give each visual layer a progressively stronger camera-facing depth bias.
 * The meshes remain opaque and keep writing depth, so avatars still occlude
 * themselves and the world normally.
 */
function layeredAvatarMaterial(
  layer: number, surface: AvatarSurface
): THREE.MeshBasicMaterial {
  const mat = new THREE.MeshBasicMaterial({
    vertexColors: true,
    map: avatarTexture(surface),
  });
  // Recorded so callers (and the smoke suite) can reason about the bias order
  // without depending on the position of a material inside `body.materials`.
  mat.userData.avatarLayer = layer;
  mat.userData.avatarSurface = surface;
  if (layer > 0) {
    mat.polygonOffset = true;
    mat.polygonOffsetFactor = -1;
    mat.polygonOffsetUnits = -layer;
  }
  return mat;
}

function shadedBox(
  w: number, h: number, d: number, color: THREE.Color,
  shadeOverride?: number[]
): THREE.BufferGeometry {
  const geo = new THREE.BoxGeometry(w, h, d);
  const pos = geo.getAttribute('position');
  const colors = new Float32Array(pos.count * 3);
  const shade = shadeOverride ?? FACE_SHADE;
  for (let f = 0; f < 6; f++) {
    const s = shade[f];
    for (let v = 0; v < 4; v++) {
      const k = f * 4 + v;
      colors[k * 3]     = color.r * s;
      colors[k * 3 + 1] = color.g * s;
      colors[k * 3 + 2] = color.b * s;
    }
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  return geo;
}

/** A coloured box mesh offset so the pivot is at the TOP of the box. */
function pivotedBox(
  mat: THREE.Material,
  w: number, h: number, d: number,
  color: THREE.Color,
  shade?: number[]
): THREE.Mesh {
  const mesh = new THREE.Mesh(shadedBox(w, h, d, color, shade), mat);
  mesh.position.y = -h / 2; // pivot at top
  return mesh;
}

/** A limb group (pivot at top) placed at (x, y, z). */
function limb(
  mat: THREE.Material,
  w: number, h: number, d: number,
  color: THREE.Color,
  x: number, y: number, z: number,
  shade?: number[]
): THREE.Group {
  const g = new THREE.Group();
  g.add(pivotedBox(mat, w, h, d, color, shade));
  g.position.set(x, y, z);
  return g;
}

/** Add a plain shaded box to `parent` at (x, y, z). */
function addBoxTo(
  parent: THREE.Object3D, mat: THREE.Material,
  w: number, h: number, d: number, color: THREE.Color,
  x: number, y: number, z: number, shade?: number[]
): THREE.Mesh {
  const mesh = new THREE.Mesh(shadedBox(w, h, d, color, shade), mat);
  mesh.position.set(x, y, z);
  parent.add(mesh);
  return mesh;
}

// ─── proportions ────────────────────────────────────────────────────────────
//
// A person, not a mannequin: the blocky language and every pivot the
// animation, sneak and armor code depend on, dressed for a game rather than a
// war:
//
//   - the head is a little smaller than the torso is wide (0.46 on 0.52), so
//     the silhouette reads as a person rather than a bobblehead;
//   - a crew collar meets the jaw — no neck stalk;
//   - a t-shirt with a chest print and a hem, jeans with a belt, sneakers.
//
// Everything is on a pixel grid of HEAD/8, like a skin, so the face features
// line up on whole "pixels".
const HEAD = 0.46;
const PX = HEAD / 8;
/** Centre of the head above the head-group pivot (the pivot is the jaw line). */
const HEAD_Y = HEAD / 2 + 0.02;
const TORSO_W = 0.52, TORSO_H = 0.72, TORSO_D = 0.28;
const ARM_W = 0.22, ARM_D = 0.23;
const LEG_W = 0.23, LEG_D = 0.24;
/** Limb length. Arms and legs share it so held items and poses keep working. */
const LIMB_H = 0.74;
const HIP_Y = 0.75;        // top of the legs / bottom of the torso
const SHOULDER_Y = 1.46;   // arm pivot
const NECK_Y = 1.5;        // head pivot (jaw line)
const BRASS = new THREE.Color(0xc9a24a);

// ─── face builder ─────────────────────────────────────────────────────────

/**
 * A stern, level face on the HEAD/8 pixel grid: narrow eyes (a white outer
 * pixel and the iris inboard), brows that step DOWN toward the nose, a nose
 * picked out in shadow, and a flat mouth line. Then the chosen face accessory.
 */
function buildFace(
  parent: THREE.Group,
  mat: THREE.Material,
  accessoryMat: THREE.Material,
  skin: THREE.Color,
  hair: THREE.Color,
  eye: THREE.Color,
  headY: number,
  accessory: number
): void {
  const white = new THREE.Color(0xe9ecef);
  const shadow = new THREE.Color(skin).multiplyScalar(0.8);
  const lip = new THREE.Color(skin).multiplyScalar(0.58);
  const jaw = new THREE.Color(skin).multiplyScalar(0.9);
  const brow = new THREE.Color(hair).multiplyScalar(0.85);
  const flat = [1, 1, 1, 1, 1, 1];
  const top = headY + HEAD / 2;
  /** Centre y of pixel row r (0 = the top row of the face). */
  const row = (r: number): number => top - (r + 0.5) * PX;
  const fz = -HEAD / 2 - 0.004;
  const add = (
    w: number, h: number, color: THREE.Color, x: number, y: number, z = fz, d = 0.012,
  ): THREE.Mesh => addBoxTo(parent, mat, w, h, d, color, x, y, z, flat);

  // Jaw: the bottom row a shade darker, which gives the face a chin.
  add(HEAD - 0.01, PX, jaw, 0, row(7), fz + 0.002, 0.008);
  for (const side of [-1, 1]) {
    // Eyes on row 4: white outboard, iris inboard with a dark pupil core.
    add(PX, PX * 0.9, white, side * PX * 2.5, row(4));
    add(PX, PX * 0.9, eye, side * PX * 1.5, row(4), fz - 0.004);
    add(PX * 0.45, PX * 0.55, new THREE.Color(0x111418), side * PX * 1.35, row(4), fz - 0.008, 0.008);
    // Brows on row 3, the inner pixel set lower: a level, focused look.
    add(PX, PX * 0.42, brow, side * PX * 2.5, row(3) + PX * 0.12);
    add(PX, PX * 0.42, brow, side * PX * 1.5, row(3) - PX * 0.12);
  }
  // Nose: two pixels of shadow on row 5, standing a little proud.
  add(PX * 2, PX * 0.85, shadow, 0, row(5), fz - 0.006, 0.02);
  // Mouth: one flat line on row 6.
  add(PX * 2.2, PX * 0.38, lip, 0, row(6) + PX * 0.05);

  const dark = new THREE.Color(0x1d1f22);
  const az = fz - 0.024;
  const acc = (
    w: number, h: number, d: number, color: THREE.Color, x: number, y: number, z = az,
  ): THREE.Mesh => addBoxTo(parent, accessoryMat, w, h, d, color, x, y, z, flat);
  switch (accessory) {
    case 1: { // Sport glasses: one wrap-around amber lens
      acc(HEAD * 0.86, PX * 1.2, 0.02, new THREE.Color(0xd08a22), 0, row(4));
      acc(HEAD * 0.9, PX * 0.3, 0.02, dark, 0, row(4) + PX * 0.7);
      for (const side of [-1, 1]) acc(0.02, PX * 0.35, HEAD * 0.6, dark, side * (HEAD / 2 + 0.012), row(4), 0);
      break;
    }
    case 2: { // Aviators: two dark lenses on a thin gold frame
      for (const side of [-1, 1]) {
        acc(PX * 2.1, PX * 1.3, 0.02, new THREE.Color(0x26303a), side * PX * 2, row(4) - PX * 0.1);
      }
      acc(HEAD * 0.9, PX * 0.22, 0.02, BRASS, 0, row(4) + PX * 0.62);
      for (const side of [-1, 1]) acc(0.018, PX * 0.25, HEAD * 0.6, BRASS, side * (HEAD / 2 + 0.01), row(4) + PX * 0.5, 0);
      break;
    }
    case 3: { // Eyepatch: over the left eye, strap round the head
      acc(PX * 2.3, PX * 1.6, 0.02, dark, -PX * 2, row(4));
      acc(HEAD + 0.02, PX * 0.3, HEAD + 0.02, dark, 0, row(3) + PX * 0.1, 0);
      break;
    }
    case 4: { // Scarf: a cloth wrap over the nose, mouth and jaw
      const cloth = new THREE.Color(0x9c8c66);
      acc(HEAD + 0.04, PX * 3.2, HEAD + 0.04, cloth, 0, row(6) + PX * 0.1, 0);
      acc(HEAD + 0.02, PX * 0.3, 0.02, cloth.clone().multiplyScalar(0.8), 0, row(5) - PX * 0.2, -HEAD / 2 - 0.03);
      break;
    }
    case 5: { // Moustache: a heavy bar over the mouth line
      acc(PX * 3.2, PX * 0.6, 0.02, hair, 0, row(6) - PX * -0.55);
      break;
    }
    case 6: { // Full beard: jaw, chin and sideburns in the hair colour
      acc(HEAD + 0.02, PX * 2.2, 0.03, hair, 0, row(7) + PX * 0.25);
      acc(PX * 3.2, PX * 0.55, 0.03, hair, 0, row(6) + PX * 0.45);
      for (const side of [-1, 1]) acc(0.03, PX * 3.2, HEAD * 0.55, hair, side * (HEAD / 2 + 0.012), row(5) + PX * 0.4, -HEAD * 0.1);
      break;
    }
    case 7: { // Face paint: two black bars under the eyes and one down the nose
      for (const side of [-1, 1]) acc(PX * 2, PX * 0.5, 0.012, dark, side * PX * 2, row(5) + PX * 0.2, fz - 0.012);
      acc(PX * 0.6, PX * 2, 0.012, dark, 0, row(4), fz - 0.013);
      break;
    }
    case 8: { // Scar: a pale line down through the left brow and cheek
      const scar = new THREE.Color(skin).lerp(new THREE.Color(0xf2d2c8), 0.6);
      acc(PX * 0.35, PX * 3.4, 0.012, scar, -PX * 2.8, row(4.2), fz - 0.012);
      break;
    }
  }
}

// ─── hair + hat builders ───────────────────────────────────────────────────

/** Hair styles (HAIR_STYLES order: Crew Cut, Long, Mohawk, Bun, Ponytail,
 *  Side Part, Shaved). Built onto the head group so it pitches with look-dir. */
function buildHair(
  head: THREE.Group, mat: THREE.Material, hair: THREE.Color,
  headY: number, style: number
): void {
  const top = headY + HEAD / 2;
  const cap = (h = 0.07, lift = 0): void => {
    addBoxTo(head, mat, HEAD + 0.03, h, HEAD + 0.03, hair, 0, top - h / 2 + 0.02 + lift, 0);
  };
  const fringe = (rows = 1, x = 0, w = HEAD + 0.02): void => {
    addBoxTo(head, mat, w, PX * rows, 0.03, hair, x, top - PX * rows / 2, -HEAD / 2 - 0.008);
  };
  const sides = (rows = 2): void => {
    for (const side of [-1, 1]) {
      addBoxTo(head, mat, 0.03, PX * rows, HEAD + 0.02, hair,
        side * (HEAD / 2 + 0.008), top - PX * rows / 2, 0.01);
    }
  };
  const back = (rows = 4): void => {
    addBoxTo(head, mat, HEAD + 0.02, PX * rows, 0.035, hair, 0, top - PX * rows / 2, HEAD / 2 + 0.008);
  };

  switch (style) {
    case 0: // Crew cut: short all round, a single row of fringe
      cap(0.06); fringe(0.7); sides(2); back(3.5);
      break;
    case 1: // Long: past the jaw at the sides, down to the collar behind
      cap(0.08); fringe(1.2); sides(6);
      addBoxTo(head, mat, HEAD + 0.03, HEAD * 1.1, 0.05, hair, 0, top - HEAD * 0.55, HEAD / 2 + 0.012);
      break;
    case 2: // Mohawk: a tall centre strip over shaved sides
      cap(0.02);
      for (let i = 0; i < 4; i++) {
        addBoxTo(head, mat, 0.08, 0.12, 0.13, hair, 0, top + 0.06, -0.17 + i * 0.115);
      }
      break;
    case 3: // Bun: pulled back tight, a knot at the crown
      cap(0.06); fringe(0.5); sides(2.5); back(4);
      addBoxTo(head, mat, 0.16, 0.14, 0.13, hair, 0, top - 0.02, HEAD / 2 + 0.07);
      break;
    case 4: // Ponytail: tied off low at the back
      cap(0.06); fringe(0.8); sides(3); back(4);
      addBoxTo(head, mat, 0.1, 0.1, 0.1, hair, 0, headY + 0.02, HEAD / 2 + 0.05);
      addBoxTo(head, mat, 0.08, 0.36, 0.08, hair, 0, headY - 0.17, HEAD / 2 + 0.06);
      break;
    case 5: // Side part: longer on one side, swept over
      cap(0.08); sides(2.5); back(4);
      fringe(1.6, -PX * 1.2, HEAD * 0.72);
      fringe(0.7, PX * 2.6, HEAD * 0.34);
      break;
    case 6: { // Shaved: just the shadow of it
      const shade = new THREE.Color(hair).lerp(new THREE.Color(0x777777), 0.45);
      addBoxTo(head, mat, HEAD + 0.012, 0.02, HEAD + 0.012, shade, 0, top + 0.004, 0);
      break;
    }
  }
}

/** Headgear in character.ts HATS order. */
function buildHat(
  head: THREE.Group, mat: THREE.Material, color: THREE.Color,
  headY: number, hat: number
): void {
  const topY = headY + HEAD / 2;
  const dark = new THREE.Color(color).multiplyScalar(0.62);
  const black = new THREE.Color(0x1e2023);
  const helmet = (): void => {
    addBoxTo(head, mat, HEAD + 0.1, 0.2, HEAD + 0.1, color, 0, topY + 0.04, 0.005);
    addBoxTo(head, mat, HEAD + 0.13, 0.05, HEAD + 0.13, dark, 0, topY - 0.04, 0.005);
    addBoxTo(head, mat, HEAD - 0.04, 0.04, HEAD - 0.04, color, 0, topY + 0.155, 0.005);
    for (const side of [-1, 1]) {
      // Side rails and the chin strap.
      addBoxTo(head, mat, 0.03, 0.06, 0.24, dark, side * (HEAD / 2 + 0.065), topY + 0.02, 0);
      addBoxTo(head, mat, 0.02, HEAD * 0.62, 0.035, black, side * (HEAD / 2 + 0.012), headY - 0.04, -0.02);
    }
  };
  switch (hat) {
    case 1: // Cap: flat-topped crown and a short stiff brim
      addBoxTo(head, mat, HEAD + 0.05, 0.13, HEAD + 0.05, color, 0, topY + 0.035, 0);
      addBoxTo(head, mat, HEAD + 0.07, 0.03, HEAD + 0.07, dark, 0, topY - 0.02, 0);
      addBoxTo(head, mat, 0.36, 0.028, 0.14, dark, 0, topY - 0.015, -HEAD / 2 - 0.07);
      break;
    case 2: // Beanie: snug knit with a rolled band
      addBoxTo(head, mat, HEAD + 0.05, 0.17, HEAD + 0.05, color, 0, topY + 0.045, 0);
      addBoxTo(head, mat, HEAD + 0.07, 0.07, HEAD + 0.07, dark, 0, topY - 0.025, 0);
      break;
    case 3: { // Beret: pulled down over one side, badge on the other
      const beret = new THREE.Mesh(shadedBox(HEAD + 0.08, 0.07, HEAD + 0.1, color), mat);
      beret.position.set(-0.035, topY + 0.03, 0.01);
      beret.rotation.z = 0.16;
      head.add(beret);
      addBoxTo(head, mat, HEAD + 0.05, 0.035, HEAD + 0.05, dark, 0, topY - 0.01, 0);
      addBoxTo(head, mat, 0.06, 0.07, 0.02, BRASS, PX * 2.3, topY + 0.01, -HEAD / 2 - 0.035);
      break;
    }
    case 4: // Bucket hat: floppy wide brim and a banded crown
      addBoxTo(head, mat, HEAD + 0.26, 0.03, HEAD + 0.26, color, 0, topY - 0.01, 0);
      addBoxTo(head, mat, HEAD + 0.04, 0.13, HEAD + 0.04, color, 0, topY + 0.06, 0);
      addBoxTo(head, mat, HEAD + 0.06, 0.035, HEAD + 0.06, dark, 0, topY + 0.02, 0);
      break;
    case 5: // Helmet
      helmet();
      break;
    case 6: // Bandana: tied over the crown, knot behind
      addBoxTo(head, mat, HEAD + 0.035, 0.1, HEAD + 0.035, color, 0, topY - 0.03, 0);
      addBoxTo(head, mat, 0.1, 0.08, 0.06, dark, 0, topY - 0.07, HEAD / 2 + 0.04);
      addBoxTo(head, mat, 0.06, 0.14, 0.03, dark, 0.03, topY - 0.16, HEAD / 2 + 0.05);
      break;
    case 7: // Captain hat: a raised crown, black visor, brass badge
      addBoxTo(head, mat, HEAD + 0.16, 0.1, HEAD + 0.16, color, 0, topY + 0.1, -0.01);
      addBoxTo(head, mat, HEAD + 0.05, 0.1, HEAD + 0.05, dark, 0, topY + 0.02, 0);
      addBoxTo(head, mat, 0.38, 0.025, 0.14, black, 0, topY - 0.025, -HEAD / 2 - 0.07);
      addBoxTo(head, mat, 0.07, 0.06, 0.02, BRASS, 0, topY + 0.04, -HEAD / 2 - 0.04);
      break;
    case 8: // Headphones: band, ear cups and a boom mic
      addBoxTo(head, mat, 0.05, 0.04, HEAD * 0.45, black, 0, topY + 0.02, 0.02);
      for (const side of [-1, 1]) {
        addBoxTo(head, mat, 0.03, HEAD * 0.5, 0.04, black, side * (HEAD / 2 + 0.02), topY - HEAD * 0.2, 0.02);
        addBoxTo(head, mat, 0.07, 0.15, 0.14, color, side * (HEAD / 2 + 0.035), headY - 0.02, 0.02);
      }
      addBoxTo(head, mat, 0.03, 0.03, 0.2, black, -(HEAD / 2 + 0.03), headY - 0.08, -0.1);
      addBoxTo(head, mat, 0.12, 0.035, 0.035, black, -(HEAD / 2 - 0.04), headY - 0.09, -HEAD / 2 - 0.02);
      break;
    case 9: // Headband
      addBoxTo(head, mat, HEAD + 0.035, 0.055, HEAD + 0.035, color, 0, topY - PX * 1.4, 0);
      break;
    case 10: // Visor helmet with a front mount
      helmet();
      addBoxTo(head, mat, 0.12, 0.08, 0.05, black, 0, topY + 0.03, -HEAD / 2 - 0.07);
      for (const side of [-1, 1]) {
        addBoxTo(head, mat, 0.07, 0.07, 0.12, black, side * 0.05, topY + 0.02, -HEAD / 2 - 0.13);
        addBoxTo(head, mat, 0.05, 0.05, 0.02, new THREE.Color(0x4cff7a), side * 0.05, topY + 0.02, -HEAD / 2 - 0.195);
      }
      break;
  }
}

// ─── full body builder (shared with the Character screen preview) ─────────

export interface AvatarBody {
  group: THREE.Group;
  head: THREE.Group;
  /** [leftLeg, rightLeg, leftArm, rightArm] — each pivots at its hip/shoulder. */
  parts: THREE.Group[];
  /** Every owned material, disposed together with the body. */
  materials: readonly THREE.MeshBasicMaterial[];
  /** Captured at construction, before borrowed equipment/glow is attached. */
  geometries: readonly THREE.BufferGeometry[];
}

/** Apply the positional part of the Minecraft-style sneak pose. Rotations stay
 * with the caller because walking and attacking compose them. */
export function applyAvatarSneak(body: AvatarBody, amount: number): void {
  const a = Math.max(0, Math.min(1, amount));
  body.head.position.y = NECK_Y - a * 0.16;
  body.head.position.z = -a * 0.08;
  for (const arm of [body.parts[2], body.parts[3]]) {
    arm.position.y = SHOULDER_Y - a * 0.14;
    arm.position.z = -a * 0.08;
  }
  for (const leg of [body.parts[0], body.parts[1]]) {
    leg.position.y = HIP_Y;
    leg.position.z = a * 0.04;
  }
}

/** Limb rotations for the standing walk/idle/attack pose, in radians.
 *  Limbs pivot at the top and the model faces -z, so a POSITIVE rotation.x
 *  swings a limb FORWARD. Every term below is signed to match that. */
interface StridePose {
  /** rotation.x for [leftLeg, rightLeg]. */
  legs: [number, number];
  /** rotation.x for [leftArm, rightArm]. */
  arms: [number, number];
  /** rotation.z for the right arm — the strike crosses slightly inward. */
  rightArmRoll: number;
}

/**
 * The single source of truth for the standing avatar pose, shared by remote
 * avatars and the local third-person body so the two can never drift apart.
 *
 * `attackSwing` is 0 at rest and 1 at the peak of a swing; it drives the right
 * arm forward (toward -z), which is the direction the punch actually travels.
 */
export function stridePose(
  walkPhase: number,
  hspeed: number,
  sneak: number,
  holding: boolean,
  attackSwing: number
): StridePose {
  const amp = Math.sin(walkPhase) * Math.min(1, hspeed / 4.5) * 0.8;
  return {
    legs: [amp + sneak * 0.28, -amp + sneak * 0.28],
    arms: [
      -amp + sneak * 0.18,                                        // counter-swings
      // Peaks around 95° with an item raised, 72° bare-handed — a strike that
      // travels forward, not an arm thrown up past vertical.
      amp + (holding ? 0.4 : 0) + attackSwing * 1.25 + sneak * 0.18,
    ],
    rightArmRoll: -attackSwing * 0.12,
  };
}

// ─── two-handed firearm hold ───────────────────────────────────────────────
//
// The rifle is placed on the BODY — butt at the right shoulder — along the
// look pitch, and each arm is aimed at its own hand-hold on the model: the
// right hand at the pistol grip, the left at the gun's 'grip2' anchor (the
// fore grip). The single-segment arms stretch or shorten a little to land
// exactly — a shortened right arm reads as a bent elbow, which is what a real
// hold is.

/** Hand centre below the shoulder pivot (glove middle). */
const HAND_REACH = LIMB_H - 0.075;
const ARM_DOWN = new THREE.Vector3(0, -1, 0);
const _holdV = new THREE.Vector3();
const _holdR = new THREE.Vector3();
const _holdL = new THREE.Vector3();

interface GunHoldState {
  /** Look pitch, radians (+ = up). */
  pitch: number;
  /** Aim-down-sights ease, 0..1. */
  aim: number;
  /** Reload dip, 0..1 (peaks mid-reload). */
  reload: number;
  /** Recoil kick, 0..1. */
  kick: number;
}

/** Point in `gun`'s local space → the space of `gun`'s parent. */
function gunPointToParent(gun: THREE.Object3D, local: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
  out.copy(local);
  gun.updateMatrix();
  return out.applyMatrix4(gun.matrix);
}

/** Aim a limb (pivot at the top, hanging along -y) so its hand lands on
 *  `target` (in the limb's parent space). */
function reachLimb(limb: THREE.Object3D, target: THREE.Vector3, minS = 0.7, maxS = 1.2): void {
  _holdV.copy(target).sub(limb.position);
  const len = _holdV.length();
  if (len < 1e-4) return;
  limb.quaternion.setFromUnitVectors(ARM_DOWN, _holdV.divideScalar(len));
  limb.scale.y = Math.max(minS, Math.min(maxS, len / HAND_REACH));
}

/** Undo a previous gun hold: arms back to plain x/z swings at full length.
 *  Call before any pose branch that only writes rotation.x/z. */
export function releaseGunHold(body: AvatarBody): void {
  for (const arm of [body.parts[2], body.parts[3]]) {
    arm.rotation.set(0, 0, 0);
    arm.scale.y = 1;
  }
}

/** Pose a held gun two-handed on an avatar. `gun` is a createGunModel root
 *  already scaled by poseGunModel(…, 'avatar'); it is (re)parented onto the
 *  body so it stays on the look line instead of swinging with one arm. */
export function poseGunHold(body: AvatarBody, gun: THREE.Object3D, s: GunHoldState): void {
  if (gun.parent !== body.group) body.group.add(gun);
  const la = body.parts[2], ra = body.parts[3];
  const aim = Math.max(0, Math.min(1, s.aim));
  const dip = Math.max(0, Math.min(1, s.reload));
  const kick = Math.max(0, Math.min(1, s.kick));
  const grip2 = gun.getObjectByName('grip2')!;
  // Grip position relative to the right shoulder's height, before pitch: the
  // stock in the right shoulder pocket; ADS lifts the sights to the cheek.
  const gx = 0.12 - aim * 0.02;
  let gy = -0.25 + aim * 0.28, gz = -0.3 - aim * 0.02;
  gy -= dip * 0.14;            // reload: lower it and bring it in
  gz += dip * 0.08 + kick * 0.06; // recoil drives it back into the shoulder
  const pitch = THREE.MathUtils.clamp(s.pitch, -1.1, 1.1) * 0.9 + kick * 0.14 - dip * 0.35;
  const cp = Math.cos(pitch), sp = Math.sin(pitch);
  gun.position.set(gx, ra.position.y + gy * cp - gz * sp, ra.position.z + gy * sp + gz * cp);
  gun.rotation.set(pitch, 0, -dip * 0.55);

  // Right hand on the pistol grip.
  _holdV.set(0, -0.15, 0.03);
  gunPointToParent(gun, _holdV, _holdR);
  // Left hand on the fore grip.
  _holdV.copy(grip2.position);
  let o: THREE.Object3D | null = grip2.parent;
  while (o && o !== gun) { o.updateMatrix(); _holdV.applyMatrix4(o.matrix); o = o.parent; }
  _holdV.y -= 0.08; // hand wraps under the guard, not through it
  gunPointToParent(gun, _holdV, _holdL);
  // During the reload the support hand drops to the magazine well.
  if (dip > 0) {
    _holdV.set(0, -0.3, -0.12);
    gunPointToParent(gun, _holdV, _holdV);
    _holdL.lerp(_holdV, dip);
  }
  reachLimb(ra, _holdR, 0.62, 1.15);
  reachLimb(la, _holdL, 0.7, 1.3);
}

/** Build the full customised avatar body (feet at y=0, facing -z). The
 *  optional shirt override paints a team colour over the chosen top. */
export function buildAvatarBody(
  cosmetics: Cosmetics, shirtOverride?: THREE.Color
): AvatarBody {
  // Sanitize on the way in: cosmetics reach here straight off the wire on the
  // bust paths, and a blob from an older build can be missing a field.
  const c = sanitizeCosmetics(cosmetics);
  const skin  = new THREE.Color(SKIN_TONES[c.skin].hex);
  const eye   = new THREE.Color(EYE_COLORS[c.eyes].hex);
  const hair  = new THREE.Color(HAIR_COLORS[c.hair].hex);
  const shirt = shirtOverride ?? new THREE.Color(SHIRT_COLORS[c.shirt].hex);
  const pants = new THREE.Color(PANTS_COLORS[c.pants].hex);
  const collar = new THREE.Color(shirt).multiplyScalar(0.84);
  const hem = new THREE.Color(shirt).multiplyScalar(0.78);
  const print = new THREE.Color(shirt).lerp(new THREE.Color(0xffffff), 0.55);
  const shoe = new THREE.Color(0xe9ecef).lerp(shirt, 0.18);
  const sole = new THREE.Color(0xf7f7f5);

  // Stable opaque layers, each with its own depth bias, so the overlapping
  // kit never z-fights at range; each carries the texture of what it IS.
  const skinMat   = layeredAvatarMaterial(0, 'skin');     // head
  const clothMat  = layeredAvatarMaterial(0, 'cloth');    // t-shirt, sleeves
  const legMat    = layeredAvatarMaterial(0, 'denim');    // trousers
  const handMat   = layeredAvatarMaterial(1, 'skin');     // hands
  const kitMat    = layeredAvatarMaterial(1, 'cloth');    // print, hem
  const trimMat   = layeredAvatarMaterial(2, 'leather');  // belt, shoes
  const hairMat   = layeredAvatarMaterial(2, 'hair');
  const detailMat = layeredAvatarMaterial(3, 'none');     // face pixels stay crisp
  const accessoryMat = layeredAvatarMaterial(4, 'none');
  const hatMat    = layeredAvatarMaterial(4, 'cloth');
  const materials = [
    skinMat, clothMat, legMat, handMat, kitMat, trimMat,
    hairMat, detailMat, accessoryMat, hatMat,
  ];
  const group = new THREE.Group();
  group.rotation.order = 'YXZ';

  // ── Torso: t-shirt with a chest print and a hem, belt ──────────────────
  const torso = new THREE.Mesh(shadedBox(TORSO_W, TORSO_H, TORSO_D, shirt), clothMat);
  torso.position.y = HIP_Y + TORSO_H / 2;
  group.add(torso);
  // A simple square print on the chest, and a darker hem at the waist.
  addBoxTo(group, kitMat, 0.2, 0.16, 0.02, print, 0, HIP_Y + TORSO_H * 0.62, -TORSO_D / 2 - 0.008);
  addBoxTo(group, kitMat, TORSO_W + 0.012, 0.07, TORSO_D + 0.012, hem, 0, HIP_Y + 0.12, 0);
  // Belt and buckle.
  addBoxTo(group, trimMat, TORSO_W + 0.02, 0.08, TORSO_D + 0.02, new THREE.Color(0x2a2721),
    0, HIP_Y + 0.05, 0);
  addBoxTo(group, trimMat, 0.07, 0.055, 0.02, new THREE.Color(0x8a8f96), 0, HIP_Y + 0.05, -TORSO_D / 2 - 0.018);
  // Crew collar: the shirt closes on the jaw — no neck stalk.
  addBoxTo(group, clothMat, 0.32, 0.08, 0.3, collar, 0, NECK_Y - 0.02, 0);

  // ── Head ──────────────────────────────────────────────────────────────
  // Its own group, pivoting at the jaw line so it pitches with look-dir.
  const headGroup = new THREE.Group();
  const headMesh = new THREE.Mesh(shadedBox(HEAD, HEAD, HEAD, skin), skinMat);
  headMesh.position.y = HEAD_Y;
  headGroup.add(headMesh);
  buildHair(headGroup, hairMat, hair, HEAD_Y, c.hairStyle);
  buildHat(headGroup, hatMat, new THREE.Color(HAT_COLORS[c.hatColor].hex), HEAD_Y, c.hat);
  buildFace(headGroup, detailMat, accessoryMat, skin, hair, eye, HEAD_Y, c.face);
  headGroup.position.y = NECK_Y;
  group.add(headGroup);

  // ── Legs: jeans, sneakers with a white sole ───────────────────────────
  const legX = LEG_W / 2 + 0.006;
  const ll = limb(legMat, LEG_W, LIMB_H, LEG_D, pants, -legX, HIP_Y, 0);
  const rl = limb(legMat, LEG_W, LIMB_H, LEG_D, pants, legX, HIP_Y, 0);
  for (const leg of [ll, rl]) {
    addBoxTo(leg, trimMat, LEG_W + 0.02, 0.16, LEG_D + 0.05, shoe, 0, -LIMB_H + 0.08, -0.02);
    addBoxTo(leg, trimMat, LEG_W + 0.03, 0.04, LEG_D + 0.07, sole, 0, -LIMB_H + 0.02, -0.025);
  }

  // ── Arms: short sleeves, bare forearms, hands ─────────────────────────
  const armX = TORSO_W / 2 + ARM_W / 2;
  const la = limb(clothMat, ARM_W, LIMB_H - 0.14, ARM_D, shirt, -armX, SHOULDER_Y, 0);
  const ra = limb(clothMat, ARM_W, LIMB_H - 0.14, ARM_D, shirt, armX, SHOULDER_Y, 0);
  const ARM_L = LIMB_H - 0.14;
  for (const arm of [la, ra]) {
    // Bare forearm below a short sleeve, with the sleeve's cuff on top.
    addBoxTo(arm, handMat, ARM_W + 0.006, ARM_L - 0.27, ARM_D + 0.006, skin, 0, -(0.27 + ARM_L) / 2, 0);
    addBoxTo(arm, clothMat, ARM_W + 0.014, 0.05, ARM_D + 0.014, collar, 0, -0.265, 0);
  }

  group.add(ll, rl, la, ra);

  const geometries = new Set<THREE.BufferGeometry>();
  group.traverse(o => {
    if ((o as THREE.Mesh).isMesh) geometries.add((o as THREE.Mesh).geometry);
  });
  return { group, head: headGroup, parts: [ll, rl, la, ra], materials, geometries: [...geometries] };
}

const disposedBodies = new WeakSet<AvatarBody>();
/** Dispose every geometry and layered material owned by an avatar body. */
export function disposeAvatarBody(body: AvatarBody): void {
  if (disposedBodies.has(body)) return;
  disposedBodies.add(body);
  for (const geometry of body.geometries) geometry.dispose();
  for (const mat of body.materials) mat.dispose();
}
