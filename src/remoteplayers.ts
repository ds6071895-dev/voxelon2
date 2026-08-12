// Renders other players as boxy, Minecraft-style humanoid avatars with
// customisable cosmetics (character.ts) and floating name tags.
//
// Motion is SNAPSHOT INTERPOLATION (interp.ts): each avatar is drawn at the
// position its owner actually occupied INTERP_DELAY ago, reconstructed by
// lerping between the two buffered snapshots that bracket that instant. That
// costs a fixed sliver of latency and buys constant-velocity movement, so a
// strafing enemy tracks predictably instead of easing toward each packet.
// The PvP hit tests below deliberately run against these same rendered
// positions — what you shoot at is what you hit.
//
// Also exports the avatar-body builder so the Character screen can show a live
// preview of the same model.

import * as THREE from 'three';
import { INTERP_DELAY, netNow } from './interp';
import { AvatarSurface, avatarTexture } from './avatartex';
import type { NetClient, Remote } from './net/client';
import { factionColor, isFaction } from './teams';
import { itemGeometry } from './itementity';
import { ITEMS, Item, ARMOR_SLOT_INDEX } from './items';
import type { Atlas } from './textures';
import { createGunModel, isGunItem, poseGunModel } from './gunmodels';
import {
  GliderRig, RIG_HARNESS_Y, buildGliderRig, disposeGliderRig, glidePose,
  poseGliderRig,
} from './glidermodels';
import {
  CAPE_COLORS, Cosmetics, EYE_COLORS, HAIR_COLORS, HAT_COLORS, PANTS_COLORS,
  SHIRT_COLORS, SKIN_TONES, defaultCosmetics, sanitizeCosmetics,
} from './character';

// Per-face shading (right/left/top/bottom/front/back) — mimics Minecraft's
// directional lighting so the model reads as 3D even without real lights.
const FACE_SHADE = [0.75, 0.6, 1.0, 0.45, 0.85, 0.7];
// Fallback max HP for a remote whose hearts we don't know (lifesteal makes
// max HP per-player: hearts * 2).
const REMOTE_MAX_HEALTH = 20;

/** Shared skin texture, used by the avatar and the first-person hand. */
export function avatarSurfaceTexture(): THREE.Texture | null {
  return avatarTexture('skin');
}

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

// ─── face builder ─────────────────────────────────────────────────────────

/**
 * Paints a flat, friendly blocky face onto the front of the head: chunky
 * two-tone pixel eyes (white + a coloured pupil on the inner edge), soft flat
 * brows in the hair colour, a smile with upturned corners, and faint rosy
 * cheeks — plus the chosen face accessory (glasses/mask/…). Everything sits
 * a hair proud of the face cube so it doesn't z-fight.
 */
function buildFace(
  parent: THREE.Group,
  mat: THREE.Material,
  accessoryMat: THREE.Material,
  skin: THREE.Color,
  hair: THREE.Color,
  eye: THREE.Color,
  headY: number,  // local Y of the centre of the head
  accessory: number
): void {
  const white = new THREE.Color(0xf5f7f9);
  const mouth = new THREE.Color(skin).multiplyScalar(0.55);
  const blush = new THREE.Color(skin).lerp(new THREE.Color(0xe86a55), 0.3);
  // Flat front-face shading (features read straight-on, not directionally lit).
  const flat = [1, 1, 1, 1, 1, 1];
  const addBox = (
    w: number, h: number, d: number, color: THREE.Color,
    x: number, y: number, z: number
  ): THREE.Mesh => addBoxTo(parent, mat, w, h, d, color, x, y, z, flat);

  const fz = -0.252; // just proud of the front face of the 0.5-deep head

  for (const side of [-1, 1]) {
    const ex = side * 0.125;
    // Chunky two-pixel eye: white outer half, coloured pupil on the inner half.
    addBox(0.14, 0.11, 0.02, white, ex, headY + 0.04, fz);
    // Keep the pupil fully proud of the white instead of intersecting it. Both
    // use detailMat, so overlapping them can z-fight as the preview rotates.
    addBox(0.07, 0.11, 0.025, eye, ex - side * 0.035, headY + 0.04, fz - 0.026);
    // Flat relaxed brow in the hair colour.
    addBox(0.14, 0.03, 0.02, hair, ex, headY + 0.125, fz);
    // Rosy cheek dot just outside each eye.
    addBox(0.05, 0.04, 0.02, blush, side * 0.185, headY - 0.05, fz);
  }
  // Smile: a short bar with raised corner nubs.
  addBox(0.14, 0.035, 0.02, mouth, 0, headY - 0.145, fz);
  addBox(0.035, 0.035, 0.02, mouth, -0.085, headY - 0.115, fz);
  addBox(0.035, 0.035, 0.02, mouth, 0.085, headY - 0.115, fz);

  // Face accessory (FACE_ACCESSORIES order: None, Glasses, Sunglasses,
  // Eyepatch, Mask, Moustache, Monocle).
  const dark = new THREE.Color(0x22242a);
  const az = fz - 0.02; // accessories float just proud of the face features
  const addAccessory = (
    w: number, h: number, d: number, color: THREE.Color,
    x: number, y: number, z: number
  ): THREE.Mesh => addBoxTo(parent, accessoryMat, w, h, d, color, x, y, z, flat);
  switch (accessory) {
    case 1: { // Glasses: two thin frames + a bridge
      for (const side of [-1, 1]) {
        addAccessory(0.17, 0.15, 0.02, dark, side * 0.125, headY + 0.04, az);
        addAccessory(0.12, 0.1, 0.025, new THREE.Color(0xbfd8e8),
          side * 0.125, headY + 0.04, az - 0.012);
      }
      addAccessory(0.08, 0.03, 0.02, dark, 0, headY + 0.06, az);
      break;
    }
    case 2: { // Sunglasses: one solid dark band
      addAccessory(0.44, 0.13, 0.02, dark, 0, headY + 0.04, az);
      break;
    }
    case 3: { // Eyepatch: a patch over the left eye + a strap
      addAccessory(0.16, 0.14, 0.02, dark, -0.125, headY + 0.04, az);
      addAccessory(0.5, 0.035, 0.02, dark, 0, headY + 0.1, az + 0.005);
      break;
    }
    case 4: { // Mask: covers the mouth/nose area
      addAccessory(0.4, 0.18, 0.02, new THREE.Color(0x5a6470),
        0, headY - 0.12, az);
      break;
    }
    case 5: { // Moustache: a proud bar above the smile
      addAccessory(0.2, 0.05, 0.02, hair, 0, headY - 0.1, az);
      break;
    }
    case 6: { // Monocle: one round-ish frame + a hanging chain hint
      addAccessory(0.15, 0.15, 0.02, new THREE.Color(0xd8b32a),
        0.125, headY + 0.04, az);
      addAccessory(0.1, 0.1, 0.025, new THREE.Color(0xbfd8e8),
        0.125, headY + 0.04, az - 0.012);
      addAccessory(0.02, 0.14, 0.02, new THREE.Color(0xd8b32a),
        0.2, headY - 0.08, az);
      break;
    }
  }
}

// ─── hair + hat + cape builders ────────────────────────────────────────────

const HEAD = 0.5;

/** Hair styles (HAIR_STYLES order: Classic, Long, Mohawk, Buns, Ponytail,
 *  Bowl, Bald). Built onto the head group so it pitches with look-dir. */
function buildHair(
  head: THREE.Group, mat: THREE.Material, hair: THREE.Color,
  headY: number, style: number
): void {
  if (style === 6) return; // Bald

  const cap = (): void => {
    addBoxTo(head, mat, HEAD + 0.04, 0.13, HEAD + 0.04, hair,
      0, headY + HEAD / 2 - 0.025, 0);
  };
  const fringe = (h = 0.07): void => {
    addBoxTo(head, mat, HEAD + 0.02, h, 0.035, hair,
      0, headY + 0.18, -HEAD / 2 - 0.005);
  };
  const sides = (h = 0.2): void => {
    for (const side of [-1, 1]) {
      addBoxTo(head, mat, 0.035, h, HEAD + 0.02, hair,
        side * (HEAD / 2 + 0.005), headY + HEAD / 2 - h / 2 - 0.08, 0);
    }
  };
  const back = (h = 0.3): void => {
    addBoxTo(head, mat, HEAD + 0.02, h, 0.045, hair,
      0, headY + HEAD / 2 - h / 2 - 0.05, HEAD / 2 - 0.01);
  };

  switch (style) {
    case 0: // Classic: cap + fringe + side panels + fuller back
      cap(); fringe(); sides(); back();
      break;
    case 1: // Long: flows past the shoulders on the sides + back
      cap(); fringe(); sides(0.55);
      addBoxTo(head, mat, HEAD + 0.02, 0.72, 0.05, hair,
        0, headY - 0.1, HEAD / 2 + 0.005);
      break;
    case 2: { // Mohawk: a tall centre strip, shaved sides
      for (let i = 0; i < 4; i++) {
        addBoxTo(head, mat, 0.09, 0.14, 0.14, hair,
          0, headY + HEAD / 2 + 0.055, -0.18 + i * 0.12);
      }
      break;
    }
    case 3: // Buns: neat cap + two buns on top
      cap(); fringe();
      for (const side of [-1, 1]) {
        addBoxTo(head, mat, 0.14, 0.12, 0.14, hair,
          side * 0.16, headY + HEAD / 2 + 0.05, 0.08);
      }
      break;
    case 4: // Ponytail: cap + a tail hanging down the back
      cap(); fringe(); sides();
      addBoxTo(head, mat, 0.12, 0.16, 0.12, hair,
        0, headY + 0.12, HEAD / 2 + 0.05);
      addBoxTo(head, mat, 0.09, 0.42, 0.09, hair,
        0, headY - 0.12, HEAD / 2 + 0.06);
      break;
    case 5: // Bowl: a deep all-around cut
      addBoxTo(head, mat, HEAD + 0.05, 0.2, HEAD + 0.05, hair,
        0, headY + HEAD / 2 - 0.06, 0);
      fringe(0.1); sides(0.16); back(0.2);
      break;
  }
}

/** Hats (HATS order: None, Cap, Beanie, Top Hat, Crown, Halo, Horns, Cowboy,
 *  Wizard, Headband). Built onto the head group, above the hair. */
function buildHat(
  head: THREE.Group, mat: THREE.Material, color: THREE.Color,
  headY: number, hat: number
): void {
  const topY = headY + HEAD / 2;
  const dark = new THREE.Color(color).multiplyScalar(0.7);
  switch (hat) {
    case 1: // Cap: crown + a front brim
      addBoxTo(head, mat, HEAD + 0.08, 0.14, HEAD + 0.08, color, 0, topY + 0.05, 0);
      addBoxTo(head, mat, 0.4, 0.035, 0.22, dark, 0, topY + 0.01, -HEAD / 2 - 0.13);
      break;
    case 2: // Beanie: a snug dome + fold band
      addBoxTo(head, mat, HEAD + 0.07, 0.16, HEAD + 0.07, color, 0, topY + 0.06, 0);
      addBoxTo(head, mat, HEAD + 0.1, 0.07, HEAD + 0.1, dark, 0, topY - 0.01, 0);
      addBoxTo(head, mat, 0.12, 0.09, 0.12, dark, 0, topY + 0.18, 0);
      break;
    case 3: // Top Hat: wide brim + a tall stack
      addBoxTo(head, mat, HEAD + 0.24, 0.04, HEAD + 0.24, color, 0, topY + 0.02, 0);
      addBoxTo(head, mat, HEAD - 0.06, 0.36, HEAD - 0.06, color, 0, topY + 0.22, 0);
      addBoxTo(head, mat, HEAD - 0.04, 0.06, HEAD - 0.04, dark, 0, topY + 0.08, 0);
      break;
    case 4: { // Crown: a golden band + spikes (hat colour = gem accents)
      const gold = new THREE.Color(0xd8b32a);
      addBoxTo(head, mat, HEAD + 0.06, 0.09, HEAD + 0.06, gold, 0, topY + 0.045, 0);
      for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
        addBoxTo(head, mat, 0.06, 0.12, 0.06, gold,
          sx * 0.2, topY + 0.14, sz * 0.2);
      }
      addBoxTo(head, mat, 0.07, 0.07, 0.03, color, 0, topY + 0.045, -HEAD / 2 - 0.045);
      break;
    }
    case 5: { // Halo: a glowing ring floating above (always light gold)
      const glow = new THREE.Color(0xf5e28a);
      const flat = [1, 1, 1, 1, 1, 1];
      const r = 0.19, t = 0.05;
      addBoxTo(head, mat, r * 2, 0.03, t, glow, 0, topY + 0.22, -r, flat);
      addBoxTo(head, mat, r * 2, 0.03, t, glow, 0, topY + 0.22, r, flat);
      addBoxTo(head, mat, t, 0.03, r * 2, glow, -r, topY + 0.22, 0, flat);
      addBoxTo(head, mat, t, 0.03, r * 2, glow, r, topY + 0.22, 0, flat);
      break;
    }
    case 6: // Horns: two stubby devil horns
      for (const side of [-1, 1]) {
        addBoxTo(head, mat, 0.08, 0.14, 0.08, color, side * 0.17, topY + 0.06, -0.05);
        addBoxTo(head, mat, 0.055, 0.1, 0.055, color, side * 0.19, topY + 0.16, -0.05);
      }
      break;
    case 7: // Cowboy: a wide brim + a rounded crown with a band
      addBoxTo(head, mat, HEAD + 0.3, 0.045, HEAD + 0.22, color, 0, topY + 0.02, 0);
      addBoxTo(head, mat, HEAD - 0.08, 0.17, HEAD - 0.1, color, 0, topY + 0.12, 0);
      addBoxTo(head, mat, HEAD - 0.06, 0.05, HEAD - 0.08, dark, 0, topY + 0.06, 0);
      break;
    case 8: // Wizard: a brim + a tapering point
      addBoxTo(head, mat, HEAD + 0.18, 0.045, HEAD + 0.18, color, 0, topY + 0.02, 0);
      addBoxTo(head, mat, 0.34, 0.16, 0.34, color, 0, topY + 0.12, 0);
      addBoxTo(head, mat, 0.22, 0.15, 0.22, color, 0, topY + 0.27, 0.02);
      addBoxTo(head, mat, 0.11, 0.15, 0.11, color, 0, topY + 0.4, 0.045);
      break;
    case 9: // Headband: a thin band around the forehead
      addBoxTo(head, mat, HEAD + 0.05, 0.055, HEAD + 0.05, color, 0, headY + 0.16, 0);
      break;
  }
}

/** Capes (CAPES order: None, Plain, Trimmed, Two-Tone, Royal, Tattered).
 *  Returns the cape group (pivot at the shoulders) for sway animation. */
function buildCape(
  parent: THREE.Group, mat: THREE.Material, color: THREE.Color, style: number,
  shoulderY: number
): THREE.Group | null {
  if (style === 0) return null;
  const g = new THREE.Group();
  const dark = new THREE.Color(color).multiplyScalar(0.72);
  const trim = style === 4 ? new THREE.Color(0xd8b32a) : dark;
  const W = 0.52, T = 0.05, L = 0.92;
  // Main sheet hangs from the pivot (top edge at the shoulders).
  const sheet = (w: number, l: number, c: THREE.Color, x: number, drop: number): void => {
    addBoxTo(g, mat, w, l, T, c, x, -l / 2 - drop, 0);
  };
  switch (style) {
    case 1: // Plain
      sheet(W, L, color, 0, 0);
      break;
    case 2: // Trimmed: darker border strip at the bottom
      sheet(W, L - 0.14, color, 0, 0);
      sheet(W, 0.14, trim, 0, L - 0.14);
      break;
    case 3: // Two-Tone: split down the middle
      sheet(W / 2, L, color, -W / 4, 0);
      sheet(W / 2, L, dark, W / 4, 0);
      break;
    case 4: // Royal: gold trim down both edges + the hem
      sheet(W - 0.16, L, color, 0, 0);
      sheet(0.08, L, trim, -(W / 2 - 0.04), 0);
      sheet(0.08, L, trim, W / 2 - 0.04, 0);
      break;
    case 5: // Tattered: ragged bottom (three uneven tails)
      sheet(W, L - 0.26, color, 0, 0);
      sheet(0.14, 0.26, color, -0.17, L - 0.26);
      sheet(0.12, 0.16, color, 0.02, L - 0.26);
      sheet(0.13, 0.22, color, 0.19, L - 0.26);
      break;
  }
  g.position.set(0, shoulderY + 0.04, 0.17);
  g.rotation.x = -0.12; // resting drape angle away from the back
  parent.add(g);
  return g;
}

// ─── full body builder (shared with the Character screen preview) ─────────

export interface AvatarBody {
  group: THREE.Group;
  head: THREE.Group;
  /** [leftLeg, rightLeg, leftArm, rightArm] — each pivots at its hip/shoulder. */
  parts: THREE.Group[];
  /** Cape group (pivot at the shoulders) for sway animation, if worn. */
  cape: THREE.Group | null;
  /** Wood-grained base material for solid avatar-adjacent props (the boat). */
  material: THREE.MeshBasicMaterial;
  /** Strongest depth-biased layer (brushed plate), used by worn armor. */
  armorMaterial: THREE.MeshBasicMaterial;
  /** Every owned material, disposed together with the body. */
  materials: readonly THREE.MeshBasicMaterial[];
}

/** Apply the positional part of the Minecraft-style sneak pose. Rotations stay
 * with the caller because walking, boating, gliding, and attacking compose them. */
export function applyAvatarSneak(body: AvatarBody, amount: number): void {
  const a = Math.max(0, Math.min(1, amount));
  body.head.position.y = 1.5 - a * 0.16;
  body.head.position.z = -a * 0.08;
  for (const arm of [body.parts[2], body.parts[3]]) {
    arm.position.y = 1.46 - a * 0.14;
    arm.position.z = -a * 0.08;
  }
  for (const leg of [body.parts[0], body.parts[1]]) {
    leg.position.y = 0.75;
    leg.position.z = a * 0.04;
  }
}

/** Limb rotations for the standing walk/idle/attack pose, in radians.
 *  Limbs pivot at the top and the model faces -z, so a POSITIVE rotation.x
 *  swings a limb FORWARD. Every term below is signed to match that. */
export interface StridePose {
  /** rotation.x for [leftLeg, rightLeg]. */
  legs: [number, number];
  /** rotation.x for [leftArm, rightArm]. */
  arms: [number, number];
  /** rotation.z for the right arm — the strike crosses slightly inward. */
  rightArmRoll: number;
  /** rotation.x for the cape, if worn. */
  cape: number;
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
  const billow = Math.min(1, hspeed / 5) * 0.55;
  return {
    legs: [amp + sneak * 0.28, -amp + sneak * 0.28],
    arms: [
      -amp + sneak * 0.18,                                        // counter-swings
      // Peaks around 95° with an item raised, 72° bare-handed — a strike that
      // travels forward, not an arm thrown up past vertical.
      amp + (holding ? 0.4 : 0) + attackSwing * 1.25 + sneak * 0.18,
    ],
    rightArmRoll: -attackSwing * 0.12,
    cape: -0.12 - billow - Math.sin(walkPhase * 0.5) * 0.06,
  };
}

/** Build the full customised avatar body (feet at y=0, facing -z). The
 *  optional shirt override paints faction colours over the cosmetic shirt so
 *  teams stay readable in the war. */
export function buildAvatarBody(
  cosmetics: Cosmetics, shirtOverride?: THREE.Color
): AvatarBody {
  const c = cosmetics;
  const skin  = new THREE.Color(SKIN_TONES[c.skin].hex);
  const eye   = new THREE.Color(EYE_COLORS[c.eyes].hex);
  const hair  = new THREE.Color(HAIR_COLORS[c.hair].hex);
  const shirt = shirtOverride ?? new THREE.Color(SHIRT_COLORS[c.shirt].hex);
  const pants = new THREE.Color(PANTS_COLORS[c.pants].hex);
  const shoe  = new THREE.Color(PANTS_COLORS[c.pants].hex).multiplyScalar(0.45);

  // Stable opaque layers replace tiny geometry-only offsets. This avoids
  // distance/animation-dependent z-fighting without disabling the depth test.
  // Each layer also carries the material texture for what it actually is, so
  // skin, cloth, denim, hair, leather and plate all read differently.
  const skinMat  = layeredAvatarMaterial(0, 'skin');    // head, neck
  const clothMat = layeredAvatarMaterial(0, 'cloth');   // torso, sleeves
  const denimMat = layeredAvatarMaterial(0, 'denim');   // legs
  const propMat  = layeredAvatarMaterial(0, 'wood');    // boat hull / props
  const handMat  = layeredAvatarMaterial(1, 'skin');    // hands
  const trimMat  = layeredAvatarMaterial(1, 'leather'); // belt, shoes
  const hairMat  = layeredAvatarMaterial(2, 'hair');
  const capeMat  = layeredAvatarMaterial(2, 'cloth');
  const detailMat = layeredAvatarMaterial(3, 'none');   // face pixels stay crisp
  const accessoryMat = layeredAvatarMaterial(4, 'none');
  const hatMat   = layeredAvatarMaterial(4, 'cloth');
  const armorMat = layeredAvatarMaterial(6, 'metal');
  const materials = [
    skinMat, clothMat, denimMat, propMat, handMat, trimMat,
    hairMat, capeMat, detailMat, accessoryMat, hatMat, armorMat,
  ];
  const group = new THREE.Group();
  group.rotation.order = 'YXZ';

  // Classic Minecraft proportions, in world blocks (feet at y=0):
  //   head 0.5³ · torso 0.5w×0.75h×0.25d · arms/legs 0.25×0.75×0.25.
  // Total height ≈ 2.0. Single-segment limbs (no forearms/shins) for the
  // crisp blocky look; hands/feet are short skin/shoe caps on each limb.
  const TORSO_W = 0.5, TORSO_H = 0.75, TORSO_D = 0.26;
  const LIMB_W = 0.24, LIMB_H = 0.74, LIMB_D = 0.24;
  const HIP_Y = 0.75;        // top of the legs / bottom of the torso
  const SHOULDER_Y = 1.46;   // arm pivot
  const NECK_Y = 1.5;        // bottom of the head / neck base

  // ── Torso ──────────────────────────────────────────────────────────────
  const torso = new THREE.Mesh(shadedBox(TORSO_W, TORSO_H, TORSO_D, shirt), clothMat);
  torso.position.y = HIP_Y + TORSO_H / 2;
  group.add(torso);
  // Belt strip (pants-colored) at the waist for a two-tone read.
  const belt = new THREE.Mesh(
    shadedBox(TORSO_W + 0.006, 0.16, TORSO_D + 0.006, pants), trimMat);
  belt.position.y = HIP_Y + 0.08;
  group.add(belt);

  // Neck
  const neck = new THREE.Mesh(shadedBox(0.2, 0.1, 0.2, skin), skinMat);
  neck.position.y = NECK_Y + 0.04;
  group.add(neck);

  // ── Head ──────────────────────────────────────────────────────────────
  // Separate group, pivot at the neck base so it can pitch with look-dir.
  const headGroup = new THREE.Group();
  const headY_local = HEAD / 2 + 0.05; // centre of the head above the pivot
  const headMesh = new THREE.Mesh(shadedBox(HEAD, HEAD, HEAD, skin), skinMat);
  headMesh.position.y = headY_local;
  headGroup.add(headMesh);

  buildHair(headGroup, hairMat, hair, headY_local, c.hairStyle);
  buildHat(headGroup, hatMat, new THREE.Color(HAT_COLORS[c.hatColor].hex),
    headY_local, c.hat);
  buildFace(headGroup, detailMat, accessoryMat, skin, hair, eye, headY_local, c.face);

  headGroup.position.y = NECK_Y;
  group.add(headGroup);

  // ── Legs (single segment, pivot at the hip) ────────────────────────────
  const ll = limb(denimMat, LIMB_W, LIMB_H, LIMB_D, pants, -0.12, HIP_Y, 0);
  const rl = limb(denimMat, LIMB_W, LIMB_H, LIMB_D, pants,  0.12, HIP_Y, 0);
  // Shoes — short caps at the foot of each leg (swing with the leg).
  for (const leg of [ll, rl]) {
    const foot = new THREE.Mesh(
      shadedBox(LIMB_W + 0.01, 0.12, LIMB_D + 0.06, shoe), trimMat);
    foot.position.set(0, -LIMB_H + 0.06, -0.02);
    leg.add(foot);
  }

  // ── Arms (single segment, pivot at the shoulder) ───────────────────────
  const armX = TORSO_W / 2 + LIMB_W / 2;
  const la = limb(clothMat, LIMB_W, LIMB_H, LIMB_D, shirt, -armX, SHOULDER_Y, 0);
  const ra = limb(clothMat, LIMB_W, LIMB_H, LIMB_D, shirt,  armX, SHOULDER_Y, 0);
  // Hands — skin-colored caps below the sleeve (swing with the arm).
  for (const arm of [la, ra]) {
    const hand = new THREE.Mesh(
      shadedBox(LIMB_W + 0.006, 0.14, LIMB_D + 0.006, skin), handMat);
    hand.position.y = -LIMB_H + 0.07;
    arm.add(hand);
  }

  group.add(ll, rl, la, ra);

  // ── Cape ───────────────────────────────────────────────────────────────
  const cape = buildCape(group, capeMat,
    new THREE.Color(CAPE_COLORS[c.capeColor].hex), c.cape, SHOULDER_Y);

  return {
    group, head: headGroup, parts: [ll, rl, la, ra], cape,
    material: propMat, armorMaterial: armorMat, materials,
  };
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

// ─── worn armor + held item (equip visuals) ────────────────────────────────

// Body dimensions mirrored from buildAvatarBody (keep in sync).
const TORSO_W = 0.5, TORSO_H = 0.75, TORSO_D = 0.26;
const LIMB_W = 0.24, LIMB_H = 0.74, LIMB_D = 0.24;
const HIP_Y = 0.75;
const HEAD_Y = HEAD / 2 + 0.05; // centre of the head above the head-group pivot

/** Plating colour per armor material (readable at a distance). */
function armorColorFor(id: number): THREE.Color {
  if (id >= Item.WoodHelmet && id <= Item.WoodBoots) return new THREE.Color(0x7a5b33);
  if (id >= Item.StoneHelmet && id <= Item.StoneBoots) return new THREE.Color(0x83878d);
  if (id >= Item.IronHelmet && id <= Item.IronBoots) return new THREE.Color(0xd8dce2);
  if (id >= Item.DiamondHelmet && id <= Item.DiamondBoots) return new THREE.Color(0x45d6c9);
  if (id >= Item.TitaniumHelmet && id <= Item.TitaniumBoots) return new THREE.Color(0xaec4e8);
  return new THREE.Color(0x9aa0a8);
}

/** Build worn-armor plating onto an avatar body. `armor` is the synced
 *  [helmet, chest, legs, boots] item ids (0 = bare). Returns every mesh added
 *  so a re-equip can strip them (their geometries die with the body's group
 *  traverse on dispose; the material is the body's owned armor layer). */
export function buildArmorOverlay(body: AvatarBody, armor: number[]): THREE.Mesh[] {
  const mat = body.armorMaterial;
  const added: THREE.Mesh[] = [];
  const [ll, rl, la, ra] = body.parts;
  const add = (
    parent: THREE.Object3D, w: number, h: number, d: number,
    color: THREE.Color, x: number, y: number, z: number
  ): void => { added.push(addBoxTo(parent, mat, w, h, d, color, x, y, z)); };

  const helmet = armor[ARMOR_SLOT_INDEX.helmet] | 0;
  const chest  = armor[ARMOR_SLOT_INDEX.chestplate] | 0;
  const legs   = armor[ARMOR_SLOT_INDEX.leggings] | 0;
  const boots  = armor[ARMOR_SLOT_INDEX.boots] | 0;

  if (helmet && ITEMS[helmet]?.armor) {
    const c = armorColorFor(helmet);
    const dark = new THREE.Color(c).multiplyScalar(0.8);
    // Open-faced dome + a brow band, so the face/eyes stay visible.
    add(body.head, HEAD + 0.1, 0.3, HEAD + 0.1, c, 0, HEAD_Y + 0.13, 0);
    add(body.head, HEAD + 0.08, 0.09, 0.05, dark, 0, HEAD_Y + 0.02, -HEAD / 2 - 0.035);
    for (const side of [-1, 1]) { // cheek guards
      add(body.head, 0.05, 0.3, HEAD + 0.06, dark, side * (HEAD / 2 + 0.035), HEAD_Y - 0.05, 0.02);
    }
  }
  if (chest && ITEMS[chest]?.glider) {
    // A worn glider is a FOLDED WING, not plating and not a rucksack: rolled
    // sailcloth across the back with the spar ends poking out, so you can tell
    // at a glance who can fly. Tagged because the deployed rig hides it — you
    // cannot be wearing the wing you are hanging underneath.
    const packY = HIP_Y + TORSO_H - 0.26, packZ = TORSO_D / 2 + 0.09;
    add(body.group, 0.46, 0.19, 0.16, new THREE.Color(0xe4884a), 0, packY, packZ);
    add(body.group, 0.5, 0.11, 0.13, new THREE.Color(0xf2e3c8), 0, packY - 0.17, packZ);
    add(body.group, 0.64, 0.06, 0.06, new THREE.Color(0x5b431f), 0, packY + 0.13, packZ);
    for (const m of added.slice(-3)) m.userData.gliderPack = true;
  } else if (chest && ITEMS[chest]?.armor) {
    const c = armorColorFor(chest);
    add(body.group, TORSO_W + 0.09, TORSO_H + 0.04, TORSO_D + 0.09, c,
      0, HIP_Y + TORSO_H / 2 + 0.02, 0);
    for (const arm of [la, ra]) { // shoulder pads swing with the arms
      add(arm, LIMB_W + 0.1, 0.26, LIMB_D + 0.1, c, 0, -0.13, 0);
    }
  }
  if (legs && ITEMS[legs]?.armor) {
    const c = armorColorFor(legs);
    for (const leg of [ll, rl]) {
      add(leg, LIMB_W + 0.06, 0.46, LIMB_D + 0.06, c, 0, -0.23, 0);
    }
  }
  if (boots && ITEMS[boots]?.armor) {
    const c = armorColorFor(boots);
    for (const leg of [ll, rl]) {
      add(leg, LIMB_W + 0.09, 0.24, LIMB_D + 0.12, c, 0, -LIMB_H + 0.12, -0.02);
    }
  }
  return added;
}

// ─── tilted-body placement (gliding) ───────────────────────────────────────

// An avatar body pivots at its FEET, so pitching it face-down for flight would
// swing the whole model a metre out of its own hitbox and sling the name tag
// along with it. Both helpers below undo that: the body is re-anchored around
// its middle, and anything that must stay overhead is placed in the tilted
// frame so it still ends up overhead in world space.
const POSE_PIVOT_Y = 1.0;
/** How far a vehicle-seated avatar drops so its HIPS land on the seat pan the
 *  simulation reports, rather than its feet. Roughly a thigh. */
export const SEAT_SINK = 0.52;
const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();

/** Position a rotated body so its mid-height point stays on the hitbox. */
export function anchorTiltedBody(
  group: THREE.Object3D, x: number, y: number, z: number
): void {
  _v.set(0, POSE_PIVOT_Y, 0).applyQuaternion(group.quaternion);
  group.position.set(x - _v.x, y + POSE_PIVOT_Y - _v.y, z - _v.z);
}

/** Place a child at a fixed world height above the body, whatever its tilt. */
function placeOverhead(
  group: THREE.Object3D, child: THREE.Object3D, worldY: number
): void {
  _q.copy(group.quaternion).invert();
  _v.set(0, worldY - POSE_PIVOT_Y, 0).applyQuaternion(_q);
  child.position.set(_v.x, _v.y + POSE_PIVOT_Y, _v.z);
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

function makeNameTag(
  name: string, team: THREE.Color, factioned: boolean
): { tex: THREE.CanvasTexture; sprite: THREE.Sprite } {
  const canvas = document.createElement('canvas');
  canvas.width = 320; canvas.height = 72;
  const ctx = canvas.getContext('2d')!;

  // Rounded dark pill background
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.beginPath();
  ctx.roundRect(0, 8, 320, 54, 10);
  ctx.fill();

  // Left faction-color accent stripe
  if (factioned) {
    const tr = team.r * 255 | 0, tg = team.g * 255 | 0, tb = team.b * 255 | 0;
    ctx.fillStyle = `rgb(${tr},${tg},${tb})`;
    ctx.beginPath();
    ctx.roundRect(0, 8, 7, 54, [10, 0, 0, 10]);
    ctx.fill();
  }

  // Shadow then name text
  ctx.font = 'bold 28px "Segoe UI", Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(0,0,0,0.7)';
  ctx.fillText(name, 162, 37);  // shadow
  ctx.fillStyle = '#ffffff';
  ctx.fillText(name, 160, 35);  // main

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
  /** Wooden boat hull, shown while the player is boating. */
  boat: THREE.Group;
  /** Hang-glider rig — a scene-level object, NOT a child of the body: the
   *  wing flies the flight path while the pilot hangs beneath it. */
  rig: GliderRig;
  /** 0..1 deploy ease, so the wings unfurl instead of popping into existence. */
  glideT: number;
  /** Smoothed bank angle (radians), driven by how hard the player is turning. */
  bank: number;
  /** Previous frame's interpolated yaw, for the turn rate behind `bank`. */
  prevYaw: number;
  /** True while the tags are being placed in the tilted frame. */
  tagTilted: boolean;
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
  /** Equip visuals currently built (rebuilt when the synced state changes). */
  heldId: number;
  heldMesh: THREE.Object3D | null;
  armorKey: string;
  armorMeshes: THREE.Mesh[];
  lastSwing: number;
  swingT: number;
  sneakT: number;
  aimT: number;
  reloadT: number;
  /** Muzzle flash quad parented to the held gun's muzzle anchor (null when the
   *  avatar isn't holding a gun), and its 1→0 burn-down. */
  flash: THREE.Mesh | null;
  flashT: number;
}

// ─── main class ───────────────────────────────────────────────────────────

export class RemotePlayers {
  private readonly scene: THREE.Scene;
  private readonly net: NetClient;
  private readonly avatars = new Map<number, Avatar>();
  private hovered = -1;
  private readonly atlas: Atlas;
  /** Shared material for held-item meshes (same look as dropped items). */
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

  /** Mark which avatar the local crosshair is over (-1 = none). */
  setHovered(id: number): void { this.hovered = id; }

  /** Light up a remote player's muzzle — driven by their broadcast gunshot, so
   *  you can spot a shooter by the blink even at tracer-blurring range. */
  muzzleFlash(id: number): void {
    const av = this.avatars.get(id);
    if (av?.flash) av.flashT = 1;
  }

  private build(remote: Remote): Avatar {
    const cosmetics = sanitizeCosmetics(remote.info.cosmetics, remote.info.skin);
    const faction = remote.info.faction;
    const team    = new THREE.Color(factionColor(faction));
    // Faction members wear their team colour so sides stay readable in a war.
    const body = buildAvatarBody(cosmetics, isFaction(faction) ? team : undefined);
    const { group } = body;
    const mat = body.material;

    // ── Boat hull (shown while boating) ────────────────────────────────────
    // Per-avatar geometry (not shared) so dispose()'s traverse stays correct.
    const boat = new THREE.Group();
    const hullC = new THREE.Color(0x8a6a3f);
    const hullD = new THREE.Color(0x6d5330);
    const floor = new THREE.Mesh(shadedBox(1.1, 0.18, 2.0, hullD), mat);
    floor.position.y = 0.09;
    const railL = new THREE.Mesh(shadedBox(0.14, 0.36, 2.0, hullC), mat);
    railL.position.set(-0.55, 0.3, 0);
    const railR = new THREE.Mesh(shadedBox(0.14, 0.36, 2.0, hullC), mat);
    railR.position.set(0.55, 0.3, 0);
    const bow = new THREE.Mesh(shadedBox(1.1, 0.42, 0.16, hullC), mat);
    bow.position.set(0, 0.34, -1.0); // model faces -z
    const stern = new THREE.Mesh(shadedBox(1.1, 0.36, 0.16, hullC), mat);
    stern.position.set(0, 0.3, 1.0);
    boat.add(floor, railL, railR, bow, stern);
    boat.visible = false;
    group.add(boat);

    // ── Glider rig (shown while gliding) ───────────────────────────────────
    const rig = buildGliderRig();
    rig.group.visible = false;
    this.scene.add(rig.group);

    // ── Name tag ───────────────────────────────────────────────────────────
    const { tex, sprite } = makeNameTag(remote.info.username, team, isFaction(faction));
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
      body, group, head: body.head, boat,
      rig, glideT: 0, bank: 0, prevYaw: remote.tyaw, tagTilted: false,
      parts: body.parts,
      nameTex: tex, sprite,
      healthCanvas, healthTex, healthSprite, lastHealth: -1,
      dx: remote.tx, dy: remote.ty, dz: remote.tz, dyaw: remote.tyaw,
      dpitch: remote.tpitch,
      walkPhase: 0, lastX: remote.tx, lastZ: remote.tz,
      heldId: 0, heldMesh: null, armorKey: '', armorMeshes: [],
      lastSwing: remote.swing | 0, swingT: 1, sneakT: 0, aimT: 0, reloadT: 0,
      flash: null, flashT: 0,
    };
  }

  /** Keep the avatar's held item + worn armor in step with the synced state. */
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
          ? createGunModel(held)
          : new THREE.Mesh(itemGeometry(this.atlas, held), this.itemMat);
        if (isGunItem(held)) {
          poseGunModel(mesh, 'avatar');
        } else {
          mesh.position.set(0, -LIMB_H + 0.06, -0.2);
          mesh.rotation.set(-0.5, 0, 0);
          mesh.scale.setScalar(ITEMS[held].kind === 'block' ? 1.5 : 1.1);
        }
        av.parts[3].add(mesh); // right arm — swings with the arm
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
    const key = (r.armor ?? []).join(',');
    if (key !== av.armorKey) {
      av.armorKey = key;
      for (const m of av.armorMeshes) {
        m.parent?.remove(m);
        m.geometry.dispose(); // per-piece geometry (material is the body's)
      }
      av.armorMeshes = buildArmorOverlay(av.body, r.armor ?? []);
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
    // Replay every avatar at the same instant, INTERP_DELAY behind now. One
    // clock read for the whole loop keeps them consistent with each other.
    const renderTime = netNow() - INTERP_DELAY;
    const fallback = Math.min(1, 14 * dt);
    for (const [id, r] of this.net.remotes) {
      let av = this.avatars.get(id);
      if (!av) { av = this.build(r); this.avatars.set(id, av); }

      const s = r.buf.sample(renderTime);
      if (s) {
        av.dx = s.x; av.dy = s.y; av.dz = s.z;
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
      av.group.visible = !r.dead && r.info.mode !== 'spectator';

      this.syncEquip(av, r); // held item + worn armor follow the synced state
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
      av.aimT += ((gunHeld && r.aiming ? 1 : 0) - av.aimT) * Math.min(1, dt * 12);
      av.reloadT = r.reloading ? (av.reloadT + dt / 1.1) % 1 : 0;
      const sneakTarget = r.sneaking && !r.boating && !r.gliding ? 1 : 0;
      av.sneakT += (sneakTarget - av.sneakT) * Math.min(1, 12 * dt);

      // How fast they are actually travelling — drives the walk cycle, the
      // sail flutter and how hard the wing banks.
      const hspeed = Math.hypot(av.dx - av.lastX, av.dz - av.lastZ) / Math.max(dt, 1e-4);
      av.lastX = av.dx; av.lastZ = av.dz;

      // Glider: ease the deploy (the wings unfurl, they do not blink open) and
      // bank into turns off the yaw rate — a turning aircraft rolls.
      av.glideT += ((r.gliding ? 1 : 0) - av.glideT) *
        Math.min(1, dt * (r.gliding ? 6 : 9));
      const turnRate = wrap(av.dyaw - av.prevYaw) / Math.max(dt, 1e-4);
      av.prevYaw = av.dyaw;
      const bankTarget = r.gliding
        ? Math.max(-0.75, Math.min(0.75, turnRate * 0.42)) : 0;
      av.bank += (bankTarget - av.bank) * Math.min(1, dt * 5);

      // Health bar
      const showHealth = id === this.hovered && av.group.visible;
      av.healthSprite.visible = showHealth;
      if (showHealth && av.lastHealth !== r.health) {
        const remoteMax = Number.isFinite(r.info.hearts) && r.info.hearts > 0
          ? r.info.hearts * 2 : REMOTE_MAX_HEALTH;
        drawHealthBar(av.healthCanvas, Math.min(1, r.health / remoteMax));
        av.healthTex.needsUpdate = true;
        av.lastHealth = r.health;
      }

      // ── Pose / animation ──── parts = [leftLeg, rightLeg, leftArm, rightArm] ─
      av.boat.visible = r.boating;
      if (av.tagTilted && av.glideT <= 0.01) {
        // Back on our feet: undo the flight anchoring.
        av.tagTilted = false;
        av.group.rotation.z = 0;
        av.sprite.position.y = 2.34;
        av.sprite.position.x = 0; av.sprite.position.z = 0;
        av.healthSprite.position.y = 2.62;
        av.healthSprite.position.x = 0; av.healthSprite.position.z = 0;
      }
      if (r.boating || r.seated) {
        // Seated: legs stretched forward, arms out to the controls. A vehicle
        // seat additionally DROPS the whole body by a thigh's length, because
        // the reported position is the seat pan and a body drawn standing on it
        // puts the rider's head straight through the cabin roof.
        applyAvatarSneak(av.body, 0);
        av.group.rotation.x = 0;
        av.head.rotation.x = 0;
        if (r.seated) av.group.position.y = av.dy - SEAT_SINK;
        av.parts[0].rotation.x = 1.35;
        av.parts[1].rotation.x = 1.35;
        av.parts[2].rotation.x = r.seated ? 0.95 : 0.55;
        av.parts[3].rotation.x = r.seated ? 0.95 : 0.55;
        av.parts[2].rotation.z = 0; av.parts[3].rotation.z = 0;
        if (av.body.cape) av.body.cape.rotation.x = -0.25;
      } else if (av.glideT > 0.01) {
        // Hanging under the wing: prone along the flight path, hands on the
        // control bar, banked into the turn.
        applyAvatarSneak(av.body, 0);
        av.walkPhase += dt * 2.2; // doubles as the flutter/scissor clock
        const pose = glidePose(av.dpitch, av.bank, av.walkPhase, av.glideT);
        av.group.rotation.x = pose.tilt;
        av.group.rotation.z = pose.roll;
        anchorTiltedBody(av.group, av.dx, av.dy, av.dz);
        av.parts[0].rotation.x = pose.legs[0];
        av.parts[1].rotation.x = pose.legs[1];
        av.parts[2].rotation.x = pose.arms[0];
        av.parts[3].rotation.x = pose.arms[1];
        av.parts[2].rotation.z = -pose.armRoll;
        av.parts[3].rotation.z = pose.armRoll;
        av.head.rotation.x = pose.head;
        if (av.body.cape) av.body.cape.rotation.x = pose.cape;
        // Name tag and health bar belong overhead, not slung out behind.
        placeOverhead(av.group, av.sprite, 2.34);
        placeOverhead(av.group, av.healthSprite, 2.62);
        av.tagTilted = true;
      } else {
        applyAvatarSneak(av.body, av.sneakT);
        av.group.rotation.x = 0;
        av.head.rotation.x = THREE.MathUtils.clamp(av.dpitch, -1.15, 1.15) + av.sneakT * 0.12;

        // Walk/idle animation based on horizontal movement speed.
        av.walkPhase += Math.min(hspeed, 7) * dt * 2.4;

        const pose = stridePose(
          av.walkPhase, hspeed, av.sneakT, av.heldId > 0, attackSwing);
        av.parts[0].rotation.x = pose.legs[0];
        av.parts[1].rotation.x = pose.legs[1];
        av.parts[2].rotation.x = pose.arms[0];
        av.parts[2].rotation.z = 0;
        av.parts[3].rotation.x = pose.arms[1];
        av.parts[3].rotation.z = pose.rightArmRoll;
        if (gunHeld) {
          // Shoulder the weapon with both hands. ADS raises it to the cheek;
          // firing kicks both arms briefly and reload rolls the receiver inward.
          const reloadDip = r.reloading ? Math.sin(av.reloadT * Math.PI) : 0;
          const raise = 0.9 + av.aimT * 0.42;
          av.parts[2].rotation.x = raise + attackSwing * 0.1 - reloadDip * 0.25;
          av.parts[3].rotation.x = raise + 0.1 + attackSwing * 0.18 - reloadDip * 0.35;
          av.parts[2].rotation.z = -0.42 + av.aimT * 0.12;
          av.parts[3].rotation.z = 0.08 + reloadDip * 0.5;
          if (av.heldMesh) {
            // Counter the raised forearm so the barrel remains on the look line.
            av.heldMesh.rotation.x = -(raise + 0.1) +
              THREE.MathUtils.clamp(av.dpitch, -1.15, 1.15);
            av.heldMesh.rotation.z = -reloadDip * 0.45;
          }
        }
        if (av.body.cape) av.body.cape.rotation.x = pose.cape;
      }

      // ── The wing ───────────────────────────────────────────────────────
      // Placed in world, not parented to the pilot: it holds the flight-path
      // attitude while the body hangs (and pitches) underneath it.
      poseGliderRig(av.rig, {
        deploy: av.glideT, bank: av.bank, time: av.walkPhase,
        speed01: Math.min(1, hspeed / 26),
      });
      if (av.rig.group.visible) {
        av.rig.group.visible = av.group.visible;
        av.rig.group.position.set(av.dx, av.dy + RIG_HARNESS_Y, av.dz);
        av.rig.group.rotation.set(
          THREE.MathUtils.clamp(av.dpitch, -1.2, 1.2) * 0.8 + 0.06,
          av.dyaw, av.bank);
      }
      // You cannot wear the wing you are hanging from: fold the back-pack away
      // once the rig is open.
      const packOut = av.glideT > 0.35;
      for (const m of av.armorMeshes) {
        if (m.userData.gliderPack) m.visible = !packOut;
      }
    }
  }

  /** Id of a living avatar whose body contains the point, else -1. */
  avatarAtPoint(p: THREE.Vector3): number {
    for (const [id, av] of this.avatars) {
      const r = this.net.remotes.get(id);
      if (!r || r.dead) continue;
      if (p.x >= av.dx - 0.35 && p.x <= av.dx + 0.35 &&
          p.y >= av.dy         && p.y <= av.dy + 2.0 &&
          p.z >= av.dz - 0.35 && p.z <= av.dz + 0.35) return id;
    }
    return -1;
  }

  /** Nearest living avatar hit by the ray within maxDist, else -1. */
  rayHit(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number): number {
    let best = -1, bestT = maxDist;
    for (const [id, av] of this.avatars) {
      const r = this.net.remotes.get(id);
      if (!r || r.dead) continue;
      const min = new THREE.Vector3(av.dx - 0.35, av.dy,        av.dz - 0.35);
      const max = new THREE.Vector3(av.dx + 0.35, av.dy + 2.0, av.dz + 0.35);
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
    // The held item's geometry is the shared itemGeometry cache — detach it
    // BEFORE the body traverse below would dispose it for everyone.
    if (av.heldMesh) { av.heldMesh.parent?.remove(av.heldMesh); av.heldMesh = null; }
    disposeGliderRig(av.rig); // scene-level: it does not ride the body's traverse
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
