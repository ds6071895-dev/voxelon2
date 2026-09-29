// Renders other players as boxy, Minecraft-style humanoid avatars with
// customisable cosmetics (character.ts) and floating name tags.
//
// Motion is SNAPSHOT INTERPOLATION (interp.ts): each avatar is drawn at the
// position its owner actually occupied a moment ago (one send interval plus
// that link's measured jitter), reconstructed by lerping between the two
// buffered snapshots that bracket that instant. That costs a small sliver of
// latency and buys constant-velocity movement, so a
// strafing enemy tracks predictably instead of easing toward each packet.
// The PvP hit tests below deliberately run against these same rendered
// positions — what you shoot at is what you hit.
//
// Also exports the avatar-body builder so the Character screen can show a live
// preview of the same model.

import { createPersonGlow, createRatModel, type RatModel } from './ratseek_models';
import * as THREE from 'three';
import { SNAP_DISTANCE, netNow } from './interp';
import { AvatarSurface, avatarTexture } from './avatartex';
import type { NetClient, Remote } from './net/client';
import { itemGeometry } from './item_geometry';
import { ITEMS, Item } from './items';
import type { Atlas } from './textures';
import { createGunModel, isGunItem, poseGunModel } from './gunmodels';
import { createGadgetModel, isModeledGadget, poseGadgetModel } from './gadgetmodels';
import { createBowModel, poseBowModel } from './bowmodel';
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
 * picked out in shadow, and a flat mouth line. No smile, no blush — these are
 * soldiers. Then the chosen face accessory.
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
    case 1: { // Shooting glasses: one wrap-around amber lens
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
    case 4: { // Face wrap: a shemagh over the nose, mouth and jaw
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
    case 7: { // War paint: two black bars under the eyes and one down the nose
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

/** Headgear (HATS order: None, Patrol Cap, Watch Cap, Beret, Boonie, Combat
 *  Helmet, Bandana, Officer Cap, Comms Headset, Headband, NVG Helmet). */
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
    case 1: // Patrol cap: flat-topped crown and a short stiff brim
      addBoxTo(head, mat, HEAD + 0.05, 0.13, HEAD + 0.05, color, 0, topY + 0.035, 0);
      addBoxTo(head, mat, HEAD + 0.07, 0.03, HEAD + 0.07, dark, 0, topY - 0.02, 0);
      addBoxTo(head, mat, 0.36, 0.028, 0.14, dark, 0, topY - 0.015, -HEAD / 2 - 0.07);
      break;
    case 2: // Watch cap: snug knit with a rolled band
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
    case 4: // Boonie: floppy wide brim and a banded crown
      addBoxTo(head, mat, HEAD + 0.26, 0.03, HEAD + 0.26, color, 0, topY - 0.01, 0);
      addBoxTo(head, mat, HEAD + 0.04, 0.13, HEAD + 0.04, color, 0, topY + 0.06, 0);
      addBoxTo(head, mat, HEAD + 0.06, 0.035, HEAD + 0.06, dark, 0, topY + 0.02, 0);
      break;
    case 5: // Combat helmet
      helmet();
      break;
    case 6: // Bandana: tied over the crown, knot behind
      addBoxTo(head, mat, HEAD + 0.035, 0.1, HEAD + 0.035, color, 0, topY - 0.03, 0);
      addBoxTo(head, mat, 0.1, 0.08, 0.06, dark, 0, topY - 0.07, HEAD / 2 + 0.04);
      addBoxTo(head, mat, 0.06, 0.14, 0.03, dark, 0.03, topY - 0.16, HEAD / 2 + 0.05);
      break;
    case 7: // Officer cap: a raised crown, black visor, brass badge
      addBoxTo(head, mat, HEAD + 0.16, 0.1, HEAD + 0.16, color, 0, topY + 0.1, -0.01);
      addBoxTo(head, mat, HEAD + 0.05, 0.1, HEAD + 0.05, dark, 0, topY + 0.02, 0);
      addBoxTo(head, mat, 0.38, 0.025, 0.14, black, 0, topY - 0.025, -HEAD / 2 - 0.07);
      addBoxTo(head, mat, 0.07, 0.06, 0.02, BRASS, 0, topY + 0.04, -HEAD / 2 - 0.04);
      break;
    case 8: // Comms headset: band, ear cups and a boom mic
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
    case 10: // Helmet with night-vision mount
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
    arm.rotation.y = 0;
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

  return { group, head: headGroup, parts: [ll, rl, la, ra], materials };
}

/** Dispose every geometry and layered material owned by an avatar body. */
export function disposeAvatarBody(body: AvatarBody): void {
  body.group.traverse((o) => {
    if ((o as THREE.Sprite).isSprite) return;
    const m = o as THREE.Mesh;
    if (m.geometry) m.geometry.dispose();
  });
  for (const mat of body.materials) mat.dispose();
}

// ─── name/health tag helpers ───────────────────────────────────────────────

function drawHealthBar(canvas: HTMLCanvasElement, frac: number): void {
  const ctx = canvas.getContext('2d')!;
  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  // Pill-shaped background
  ctx.fillStyle = 'rgba(0,0,0,0.65)';
  const r = h / 2;
  ctx.beginPath();
  ctx.roundRect(0, 0, w, h, r);
  ctx.fill();

  // Empty track
  ctx.fillStyle = '#2a0a0a';
  ctx.beginPath();
  ctx.roundRect(3, 3, w - 6, h - 6, r - 2);
  ctx.fill();

  const f = Math.max(0, Math.min(1, frac));
  if (f > 0) {
    // Filled portion — colour shifts green→yellow→red
    ctx.fillStyle = f > 0.5 ? '#3fd63a' : f > 0.25 ? '#e8c43a' : '#e84040';
    ctx.beginPath();
    ctx.roundRect(3, 3, Math.round((w - 6) * f), h - 6, r - 2);
    ctx.fill();
  }
}

function makeNameTag(name: string): { tex: THREE.CanvasTexture; sprite: THREE.Sprite } {
  const canvas = document.createElement('canvas');
  canvas.width = 320; canvas.height = 72;
  const ctx = canvas.getContext('2d')!;
  ctx.font = 'bold 25px "Segoe UI", Arial, sans-serif';
  const width = Math.min(316, Math.ceil(ctx.measureText(name).width) + 34);
  // Rounded dark pill, just wide enough for the name.
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.beginPath();
  ctx.roundRect(160 - width / 2, 22, width, 40, 10);
  ctx.fill();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(0,0,0,0.7)';
  ctx.fillText(name, 162, 44);  // shadow
  ctx.fillStyle = '#ffffff';
  ctx.fillText(name, 160, 42);  // main

  const tex = new THREE.CanvasTexture(canvas);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: tex, transparent: true, depthTest: false,
  }));
  sprite.scale.set(1.8, 0.4, 1);
  sprite.renderOrder = 50;
  return { tex, sprite };
}

// ─── avatar state ─────────────────────────────────────────────────────────

interface Avatar {
  body: AvatarBody;
  group: THREE.Group;
  head: THREE.Group;    // separate group so we can pitch it with look-dir
  /** [leftLeg, rightLeg, leftArm, rightArm] — each pivots at its hip/shoulder. */
  parts: THREE.Group[];
  nameTex: THREE.CanvasTexture;
  sprite: THREE.Sprite;
  healthCanvas: HTMLCanvasElement;
  healthTex: THREE.CanvasTexture;
  healthSprite: THREE.Sprite;
  lastHealth: number;
  /** Rendered transform: the interpolated playback of the network history, and
   *  the ONLY position the hit tests use — what you shoot is what you see. */
  dx: number; dy: number; dz: number; dyaw: number; dpitch: number;
  walkPhase: number;
  lastX: number; lastZ: number;
  /** Low-passed ground speed that drives the legs: raw per-frame speed dips
   *  to zero on a late packet and spikes on the catch-up, which read as the
   *  legs stalling and flailing mid-stride. */
  strideSpeed: number;
  /** Visual error being bled off after a correction (catch-up after a late
   *  packet): the body glides the last few centimetres instead of popping. */
  ex: number; ey: number; ez: number;
  /** Playback speed (blocks/s) over the previous frame, before error terms. */
  rawSpeed: number;
  /** Held item currently built (rebuilt when the synced state changes). */
  heldId: number;
  heldMesh: THREE.Object3D | null;
  lastSwing: number;
  swingT: number;
  sneakT: number;
  aimT: number;
  reloadT: number;
  /** Muzzle flash quad parented to the held gun's muzzle anchor (null when the
   *  avatar isn't holding a gun), and its 1→0 burn-down. */
  flash: THREE.Mesh | null;
  flashT: number;
  /** 0..1 HIT FLASH: the whole avatar tints red for a moment when one of our
   *  rounds lands on them. Every avatar material is a per-body instance, so
   *  writing `material.color` here tints exactly one player. */
  hurtT: number;
  /** How hard the flash hit (0..1) — a killing blow burns brighter and longer
   *  than a graze, so a finishing shot is unmistakable at a glance. */
  hurtPeak: number;
  /** Rat and Seek: the rat drawn in place of the person, and what it hid. */
  rat: RatModel | null;
  hiddenParts: THREE.Object3D[];
  personGlow: THREE.Group | null;
}

/** A mode's say over how one body is drawn (Rat and Seek: rats, glow, ghosts). */
export interface BodyStyle {
  rat: boolean;
  caged: boolean;
  glow: boolean;
  /** Not drawn at all (a ghosting rat). */
  hidden: boolean;
  /** Show the floating name tag. */
  tag: boolean;
}

// ─── main class ───────────────────────────────────────────────────────────

export class RemotePlayers {
  private readonly scene: THREE.Scene;
  private readonly net: NetClient;
  private readonly avatars = new Map<number, Avatar>();
  private hovered = -1;
  /** Full health in the current mode, for the hover health bar. */
  maxHealth = 20;
  /** The current mode's per-body style, or null for plain people. */
  styleOf: ((id: number) => BodyStyle | null) | null = null;
  private readonly atlas: Atlas;
  /** Shared material for held-item meshes. */
  private readonly itemMat: THREE.MeshBasicMaterial;
  /** Shared muzzle-flash burst, instanced per armed avatar. */
  private readonly flashGeo = new THREE.OctahedronGeometry(0.13, 0);
  private readonly flashMat: THREE.MeshBasicMaterial;

  constructor(scene: THREE.Scene, net: NetClient, atlas: Atlas) {
    this.scene = scene;
    this.net = net;
    this.atlas = atlas;
    this.itemMat = new THREE.MeshBasicMaterial({
      map: atlas.texture, alphaTest: 0.4, vertexColors: true,
      side: THREE.DoubleSide,
    });
    this.flashMat = new THREE.MeshBasicMaterial({
      color: 0xffd27a, blending: THREE.AdditiveBlending,
      transparent: true, depthWrite: false,
    });
  }

  /** Where this remote's body is actually drawn (interpolated), or null. Use
   *  this, not the raw network target, for anything attached to the body. */
  renderedPos(id: number): THREE.Vector3 | null {
    return this.avatars.get(id)?.group.position ?? null;
  }

  /** Visible body centre for touch aim assistance (never hidden avatars). */
  aimPoint(id: number): THREE.Vector3 | null {
    const av = this.avatars.get(id);
    if (!av?.group.visible || this.net.remotes.get(id)?.dead) return null;
    const [, height] = this.dims(id);
    return new THREE.Vector3(av.dx, av.dy + height * .55, av.dz);
  }

  /** Mark which avatar the local crosshair is over (-1 = none). */
  setHovered(id: number): void { this.hovered = id; }

  /** Light up a remote player's muzzle — driven by their broadcast gunshot, so
   *  you can spot a shooter by the blink even at tracer-blurring range. */
  muzzleFlash(id: number): void {
    const av = this.avatars.get(id);
    if (av?.flash) av.flashT = 1;
  }

  /**
   * One of our rounds landed on this player: tint them red for a beat.
   *
   * A hitmarker answers "did that land?" on OUR screen; this answers it on
   * THEIRS, in the world, where the eye already is. `strength` runs 0..1 —
   * a soaked hit barely blushes, a kill goes full crimson.
   */
  hurtFlash(id: number, strength = 1): void {
    const av = this.avatars.get(id);
    if (!av) return;
    av.hurtPeak = Math.max(av.hurtPeak * av.hurtT, Math.max(0.25, Math.min(1, strength)));
    av.hurtT = 1;
  }

  private build(remote: Remote): Avatar {
    const cosmetics = sanitizeCosmetics(remote.info.cosmetics, remote.info.skin);
    const body = buildAvatarBody(cosmetics);
    const { group } = body;

    // ── Name tag ───────────────────────────────────────────────────────────
    const { tex, sprite } = makeNameTag(remote.info.username);
    sprite.position.y = 2.34;
    group.add(sprite);

    // ── Health bar ─────────────────────────────────────────────────────────
    const healthCanvas = document.createElement('canvas');
    healthCanvas.width = 160; healthCanvas.height = 20;
    const healthTex = new THREE.CanvasTexture(healthCanvas);
    const healthSprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: healthTex, transparent: true, depthTest: false,
    }));
    healthSprite.scale.set(1.2, 0.15, 1);
    healthSprite.position.y = 2.62;
    healthSprite.renderOrder = 51;
    healthSprite.visible = false;
    group.add(healthSprite);

    this.scene.add(group);
    return {
      body, group, head: body.head, parts: body.parts,
      nameTex: tex, sprite,
      healthCanvas, healthTex, healthSprite, lastHealth: -1,
      dx: remote.tx, dy: remote.ty, dz: remote.tz, dyaw: remote.tyaw,
      dpitch: remote.tpitch,
      walkPhase: 0, lastX: remote.tx, lastZ: remote.tz,
      strideSpeed: 0, ex: 0, ey: 0, ez: 0, rawSpeed: 0,
      heldId: 0, heldMesh: null,
      lastSwing: remote.swing | 0, swingT: 1, sneakT: 0, aimT: 0, reloadT: 0,
      flash: null, flashT: 0, hurtT: 0, hurtPeak: 0,
      rat: null, hiddenParts: [], personGlow: null,
    };
  }

  /** Keep the avatar's held item in step with the synced state. */
  private syncEquip(av: Avatar, r: Remote): void {
    const held = r.held | 0;
    if (held !== av.heldId) {
      av.heldId = held;
      if (av.heldMesh) {
        // Shared cached geometry — detach only, never dispose.
        av.heldMesh.parent?.remove(av.heldMesh);
        av.heldMesh = null;
        av.flash = null; // went with the gun it was parented to
        av.flashT = 0;
      }
      if (held > 0 && ITEMS[held]) {
        const mesh = isGunItem(held)
          ? createGunModel()
          : isModeledGadget(held)
            ? createGadgetModel()
            : held === Item.BridgeBow ? createBowModel()
            : new THREE.Mesh(itemGeometry(this.atlas, held), this.itemMat);
        if (isGunItem(held)) {
          poseGunModel(mesh, 'avatar');
        } else if (isModeledGadget(held)) {
          poseGadgetModel(mesh, 'avatar');
        } else if (held === Item.BridgeBow) {
          poseBowModel(mesh, 'avatar');
        } else {
          mesh.position.set(0, -LIMB_H + 0.06, -0.2);
          mesh.rotation.set(-0.5, 0, 0);
          mesh.scale.setScalar(ITEMS[held].kind === 'block' ? 1.5 : 1.1);
        }
        // Guns ride the body two-handed (poseGunHold); anything else swings
        // with the right arm.
        (isGunItem(held) ? av.body.group : av.parts[3]).add(mesh);
        av.heldMesh = mesh;
        // Hang a muzzle flash off the gun's own muzzle anchor so a distant
        // shooter reads as a muzzle blink even before the tracer resolves.
        if (isGunItem(held)) {
          const flash = new THREE.Mesh(this.flashGeo, this.flashMat);
          flash.visible = false;
          flash.renderOrder = 60;
          (mesh.getObjectByName('muzzle') ?? mesh).add(flash);
          av.flash = flash;
        }
      }
    }
  }

  /** Reconcile avatars with the net roster and interpolate, once per frame. */
  update(dt: number): void {
    // Remove avatars whose players left.
    for (const [id, av] of this.avatars) {
      if (!this.net.remotes.has(id)) {
        this.dispose(av);
        this.avatars.delete(id);
      }
    }
    // Replay every avatar at the same instant, INTERP_DELAY behind now (each
    // remote's own jitter buffer is already baked into its sample times). One
    // clock read for the whole loop keeps them consistent with each other.
    const renderTime = netNow() - this.net.renderDelay(dt);
    this.net.applyRemotePoses(renderTime);
    const fallback = Math.min(1, 14 * dt);
    for (const [id, r] of this.net.remotes) {
      let av = this.avatars.get(id);
      if (!av) { av = this.build(r); this.avatars.set(id, av); }

      const s = r.buf.sample(renderTime);
      if (s) {
        // A playback step far beyond the pace the body was just moving at is
        // the buffer catching up after a late packet (it froze, now it leaps):
        // absorb it into the error term and bleed that off, instead of drawing
        // the jump. Steady fast travel (a pad launch) matches its own pace and
        // is untouched; a real teleport (past SNAP_DISTANCE) snaps.
        const jump = Math.hypot(s.x - (av.dx - av.ex), s.y - (av.dy - av.ey), s.z - (av.dz - av.ez));
        const expected = av.rawSpeed * dt;
        av.rawSpeed = jump / Math.max(dt, 1e-4);
        if (jump - expected > 0.3 && jump < SNAP_DISTANCE) {
          av.ex = av.dx - s.x; av.ey = av.dy - s.y; av.ez = av.dz - s.z;
        } else if (jump >= SNAP_DISTANCE) {
          av.ex = av.ey = av.ez = 0;
        }
        const bleed = Math.exp(-dt * 14);
        av.ex *= bleed; av.ey *= bleed; av.ez *= bleed;
        av.dx = s.x + av.ex; av.dy = s.y + av.ey; av.dz = s.z + av.ez;
        av.dyaw = s.yaw; av.dpitch = s.pitch;
      } else {
        // No history yet (a join whose first snapshot hasn't landed): ease
        // toward the raw target rather than popping.
        av.dx += (r.tx - av.dx) * fallback;
        av.dy += (r.ty - av.dy) * fallback;
        av.dz += (r.tz - av.dz) * fallback;
        av.dyaw += wrap(r.tyaw - av.dyaw) * fallback;
        av.dpitch += (r.tpitch - av.dpitch) * fallback;
      }
      av.group.position.set(av.dx, av.dy, av.dz);
      av.group.rotation.y = av.dyaw;
      av.group.visible = !r.dead;
      const style = this.styleOf?.(id) ?? null;
      this.applyStyle(av, style);
      if (style?.hidden) av.group.visible = false;

      this.syncEquip(av, r); // the held item follows the synced state
      if (av.hurtT > 0) {
        // A heavier hit holds the tint longer, so sustained fire on one target
        // keeps them visibly lit instead of flickering back to normal.
        av.hurtT = Math.max(0, av.hurtT - dt / (0.12 + av.hurtPeak * 0.16));
        const tint = av.hurtT * av.hurtPeak;
        for (const mat of av.body.materials) {
          // The materials are pure white multipliers at rest (the avatar's real
          // colours live in vertex colours), so pulling green/blue down is a
          // clean red tint that survives every cosmetic palette.
          mat.color.setRGB(1, 1 - tint * 0.78, 1 - tint * 0.8);
        }
        if (av.hurtT <= 0) av.hurtPeak = 0;
      }
      if (av.flash) {
        // ~70ms burn-down: long enough to catch out of the corner of an eye,
        // short enough that automatic fire strobes rather than glows.
        av.flashT = Math.max(0, av.flashT - dt / 0.07);
        av.flash.visible = av.flashT > 0;
        if (av.flashT > 0) av.flash.scale.setScalar(0.6 + av.flashT * 0.8);
      }
      if ((r.swing | 0) !== av.lastSwing) {
        av.lastSwing = r.swing | 0;
        av.swingT = 0;
      }
      if (av.swingT < 1) av.swingT = Math.min(1, av.swingT + dt / 0.25);
      const attackSwing = av.swingT < 1 ? Math.sin(av.swingT * Math.PI) : 0;
      const gunHeld = isGunItem(av.heldId);
      // The Bounce Pad is carried in both hands.
      const gadgetHeld = isModeledGadget(av.heldId);
      av.aimT += ((gunHeld && r.aiming ? 1 : 0) - av.aimT) * Math.min(1, dt * 12);
      av.reloadT = r.reloading ? (av.reloadT + dt / 1.1) % 1 : 0;
      const sneakTarget = r.sneaking ? 1 : 0;
      av.sneakT += (sneakTarget - av.sneakT) * Math.min(1, 12 * dt);

      // How fast they are actually travelling — drives the walk cycle.
      const hspeed = Math.hypot(av.dx - av.lastX, av.dz - av.lastZ) / Math.max(dt, 1e-4);
      av.lastX = av.dx; av.lastZ = av.dz;
      av.strideSpeed += (Math.min(hspeed, 9) - av.strideSpeed) * Math.min(1, dt * 9);

      // Health bar
      const showHealth = id === this.hovered && av.group.visible;
      av.healthSprite.visible = showHealth;
      if (showHealth && av.lastHealth !== r.health) {
        drawHealthBar(av.healthCanvas, Math.min(1, r.health / Math.max(1, this.maxHealth)));
        av.healthTex.needsUpdate = true;
        av.lastHealth = r.health;
      }

      // ── Pose / animation ──── parts = [leftLeg, rightLeg, leftArm, rightArm] ─
      releaseGunHold(av.body);
      applyAvatarSneak(av.body, av.sneakT);
      av.head.rotation.x = THREE.MathUtils.clamp(av.dpitch, -1.15, 1.15) + av.sneakT * 0.12;

      // Walk/idle animation based on horizontal movement speed.
      av.walkPhase += Math.min(av.strideSpeed, 7) * dt * 2.4;
      if (av.rat) { av.rat.pose(av.strideSpeed, av.walkPhase, performance.now() / 1000); continue; }

      const pose = stridePose(
        av.walkPhase, av.strideSpeed, av.sneakT, av.heldId > 0, attackSwing);
      av.parts[0].rotation.x = pose.legs[0];
      av.parts[1].rotation.x = pose.legs[1];
      av.parts[2].rotation.x = pose.arms[0];
      av.parts[2].rotation.z = 0;
      av.parts[3].rotation.x = pose.arms[1];
      av.parts[3].rotation.z = pose.rightArmRoll;
      if (gunHeld && av.heldMesh) {
        const reloadDip = r.reloading ? Math.sin(av.reloadT * Math.PI) : 0;
        poseGunHold(av.body, av.heldMesh, {
          pitch: av.dpitch, aim: av.aimT, reload: reloadDip, kick: attackSwing,
        });
      } else if (gadgetHeld) {
        av.parts[2].rotation.x = 0.45 + attackSwing * 0.18;
        av.parts[3].rotation.x = 0.62 + attackSwing * 0.48;
        av.parts[2].rotation.z = -0.18;
        av.parts[3].rotation.z = 0.08;
      }
    }
  }

  /** Swap a person for a rat (and back), and show glow and name tags as the mode says. */
  private applyStyle(av: Avatar, st: BodyStyle | null): void {
    const rat = !!st?.rat;
    if (rat && !av.rat) {
      av.rat = createRatModel(!!st?.caged);
      for (const c of av.group.children) {
        if (c === av.sprite || c === av.healthSprite || !c.visible) continue;
        c.visible = false;
        av.hiddenParts.push(c);
      }
      av.group.add(av.rat.group);
    } else if (!rat && av.rat) {
      av.group.remove(av.rat.group);
      av.rat.dispose();
      av.rat = null;
      for (const c of av.hiddenParts) c.visible = true;
      av.hiddenParts = [];
    }
    if (av.rat) {
      av.rat.setCaged(!!st?.caged);
      av.rat.setGlow(!!st?.glow);
      if (av.heldMesh) av.heldMesh.visible = false;
    } else if (st?.glow || av.personGlow) {
      if (!av.personGlow) { av.personGlow = createPersonGlow(); av.group.add(av.personGlow); }
      av.personGlow.visible = !!st?.glow;
    }
    av.sprite.visible = st ? st.tag : true;
  }

  /** Hit box half-width and height of a body (rats are small). */
  private dims(id: number): [number, number] {
    return this.avatars.get(id)?.rat ? [0.24, 0.6] : [0.35, 2.0];
  }

  /** Id of a living avatar whose body contains the point, else -1. */
  avatarAtPoint(p: THREE.Vector3): number {
    for (const [id, av] of this.avatars) {
      const r = this.net.remotes.get(id);
      if (!r || r.dead) continue;
      const [hw, h] = this.dims(id);
      if (p.x >= av.dx - hw && p.x <= av.dx + hw &&
          p.y >= av.dy         && p.y <= av.dy + h &&
          p.z >= av.dz - hw && p.z <= av.dz + hw) return id;
    }
    return -1;
  }

  /** Nearest living avatar crossed by the segment `from`->`to`, else -1.
   *
   *  A projectile advances in fixed sub-steps and used to test only the point
   *  it landed on. A body is 0.7 blocks wide, so a round clipping a shoulder
   *  could step straight over it and fly on — the shot that visibly went
   *  through someone and did nothing. Sweeping the segment cannot miss. */
  avatarAtSegment(from: THREE.Vector3, to: THREE.Vector3): number {
    SEG_DIR.subVectors(to, from);
    const length = SEG_DIR.length();
    if (length < 1e-9) return this.avatarAtPoint(to);
    SEG_DIR.multiplyScalar(1 / length);
    let best = -1, bestT = length;
    for (const [id, av] of this.avatars) {
      const r = this.net.remotes.get(id);
      if (!r || r.dead) continue;
      const [hw, h] = this.dims(id);
      SEG_MIN.set(av.dx - hw, av.dy, av.dz - hw);
      SEG_MAX.set(av.dx + hw, av.dy + h, av.dz + hw);
      const tHit = rayBox(from, SEG_DIR, SEG_MIN, SEG_MAX);
      if (tHit !== null && tHit <= bestT) { bestT = tHit; best = id; }
    }
    return best;
  }

  /** Nearest living avatar hit by the ray within maxDist, else -1. */
  rayHit(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number): number {
    let best = -1, bestT = maxDist;
    for (const [id, av] of this.avatars) {
      const r = this.net.remotes.get(id);
      if (!r || r.dead) continue;
      if (!av.group.visible) continue;
      const [hw, h] = this.dims(id);
      const min = new THREE.Vector3(av.dx - hw, av.dy,     av.dz - hw);
      const max = new THREE.Vector3(av.dx + hw, av.dy + h, av.dz + hw);
      const tHit = rayBox(origin, dir, min, max);
      if (tHit !== null && tHit < bestT) { bestT = tHit; best = id; }
    }
    return best;
  }

  /** Force one avatar to rebuild (e.g. spy disguise or cosmetics changed). */
  invalidate(id: number): void {
    const av = this.avatars.get(id);
    if (av) { this.dispose(av); this.avatars.delete(id); }
  }

  private dispose(av: Avatar): void {
    this.scene.remove(av.group);
    av.rat?.dispose();
    // The held item's geometry is the shared itemGeometry cache — detach it
    // BEFORE the body traverse below would dispose it for everyone.
    if (av.heldMesh) { av.heldMesh.parent?.remove(av.heldMesh); av.heldMesh = null; }
    disposeAvatarBody(av.body);
    av.nameTex.dispose();
    (av.sprite.material as THREE.SpriteMaterial).dispose();
    av.healthTex.dispose();
    (av.healthSprite.material as THREE.SpriteMaterial).dispose();
  }
}

// ─── utility ──────────────────────────────────────────────────────────────

function wrap(a: number): number {
  while (a >  Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

// Scratch vectors for avatarAtSegment — it runs once per projectile sub-step.
const SEG_DIR = new THREE.Vector3();
const SEG_MIN = new THREE.Vector3();
const SEG_MAX = new THREE.Vector3();

function rayBox(
  origin: THREE.Vector3, dir: THREE.Vector3,
  min: THREE.Vector3,   max: THREE.Vector3
): number | null {
  let tmin = 0, tmax = Infinity;
  for (const k of ['x', 'y', 'z'] as const) {
    const d = dir[k];
    if (Math.abs(d) < 1e-9) {
      if (origin[k] < min[k] || origin[k] > max[k]) return null;
      continue;
    }
    let t1 = (min[k] - origin[k]) / d, t2 = (max[k] - origin[k]) / d;
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
    tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
    if (tmin > tmax) return null;
  }
  return tmin;
}
