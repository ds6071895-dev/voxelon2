// The GLIDER, as an actual aircraft you hang under.
//
// Before this, a deployed glider was invisible: the wearer got a small box on
// their back and a fixed backward body tilt, so other players saw someone
// reclining through the air with a rucksack. This module builds the thing you
// are actually riding — a swept delta wing on a spar frame, with an A-frame
// control bar the pilot grips — and the matching prone pilot pose.
//
// The rig is deliberately NOT a child of the avatar body. The pilot hangs from
// the wing, so the wing follows the FLIGHT PATH (pitch of the look direction,
// roll of the turn) while the body hangs beneath it in a prone pose; parenting
// one to the other would force them to share an attitude they do not share.
// Built in code with baked face shading like the rest of the project's art.

import * as THREE from 'three';

const FACE_SHADE = [0.80, 0.62, 1.0, 0.46, 0.90, 0.70];

// Shared, never disposed (the same handful of materials for every rig in the
// world); rigs own only their geometry.
const FRAME_MAT = new THREE.MeshBasicMaterial({ vertexColors: true });
const SAIL_MAT = new THREE.MeshBasicMaterial({
  vertexColors: true, side: THREE.DoubleSide,
});

const SPAR = 0x6b4f2a;       // varnished wood spars
const SPAR_DARK = 0x4a371d;
const SAIL_A = 0xe4884a;     // sunset orange panels
const SAIL_B = 0xf2e3c8;     // bleached canvas panels
const SKIN = 0xc89a6a;       // grip fists (first-person only)

/** Height of the keel above the rig origin (the pilot's harness point). */
const KEEL_Y = 0.95;
/** Harness height above the pilot's FEET position — the rig hangs from here,
 *  which puts the keel about a head above eye level in first person. */
export const RIG_HARNESS_Y = 1.35;
/** Where the control bar hangs: forward of the harness, at arm's length. */
const BAR_Z = -0.95;
const BAR_X = 0.45;
/** Wing tips ride slightly above the keel even in level flight. */
const DIHEDRAL = 0.1;
/** How far the panels fold up when the wing is stowed/unfurling. */
const FOLD = 1.25;

function paint(geo: THREE.BufferGeometry, hex: number): THREE.BufferGeometry {
  const color = new THREE.Color(hex);
  const pos = geo.getAttribute('position');
  const colors = new Float32Array(pos.count * 3);
  for (let f = 0; f < 6; f++) {
    const s = FACE_SHADE[f];
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

function box(
  parent: THREE.Object3D, mat: THREE.Material, hex: number,
  w: number, h: number, d: number, x: number, y: number, z: number, yaw = 0
): THREE.Mesh {
  const mesh = new THREE.Mesh(paint(new THREE.BoxGeometry(w, h, d), hex), mat);
  mesh.position.set(x, y, z);
  mesh.rotation.y = yaw;
  parent.add(mesh);
  return mesh;
}

export interface GliderRig {
  /** Add to the scene. Position at the pilot's harness point, rotate to the
   *  flight attitude (YXZ: pitch of the flight path, yaw, bank). */
  group: THREE.Group;
  /** Canopy + spars: unfurls on deploy and flexes in flight. */
  wing: THREE.Group;
  /** [left, right] wing halves — they fold up when stowed and flutter in air. */
  panels: THREE.Group[];
  /** Gloved fists on the control bar. Shown only when the body is hidden
   *  (first person), where they read as your own hands. */
  hands: THREE.Group;
  /** Wingtip anchors, for vapour trails at speed. */
  tips: THREE.Object3D[];
}

/** Build one hang-glider rig: swept delta canopy, spar frame, control bar. */
export function buildGliderRig(): GliderRig {
  const group = new THREE.Group();
  group.rotation.order = 'YXZ'; // bank first, then flight-path pitch, then yaw

  // ── Canopy ───────────────────────────────────────────────────────────────
  const wing = new THREE.Group();
  wing.position.y = KEEL_Y;
  group.add(wing);

  box(wing, FRAME_MAT, SPAR, 0.08, 0.08, 3.1, 0, 0, -0.35);        // keel spar
  box(wing, FRAME_MAT, SPAR_DARK, 0.18, 0.13, 0.22, 0, 0, -1.95);  // nose block
  box(wing, FRAME_MAT, SPAR, 3.6, 0.07, 0.1, 0, -0.05, 0.3);       // cross spar

  const panels: THREE.Group[] = [];
  const tips: THREE.Object3D[] = [];
  for (const side of [-1, 1]) {
    const panel = new THREE.Group();
    wing.add(panel);
    panels.push(panel);
    // Three slabs of shrinking chord fake a swept delta half-wing; alternating
    // sail colours give it stripes that stay readable at distance.
    box(panel, SAIL_MAT, SAIL_A, 0.78, 0.05, 1.95, side * 0.44, 0.02, -0.4);
    box(panel, SAIL_MAT, SAIL_B, 0.72, 0.05, 1.45, side * 1.13, 0.04, 0.0);
    box(panel, SAIL_MAT, SAIL_A, 0.64, 0.05, 0.9, side * 1.74, 0.06, 0.35);
    // Leading edge: one spar from the nose out to the tip.
    box(panel, FRAME_MAT, SPAR, 0.07, 0.07, 3.25,
      side * 1.0, 0.05, -0.5, side * 0.67);

    const tip = new THREE.Object3D();
    tip.position.set(side * 2.05, 0.06, 0.7);
    panel.add(tip);
    tips.push(tip);
  }

  // ── Control frame: the A-frame the pilot steers with ────────────────────
  for (const side of [-1, 1]) {
    box(group, FRAME_MAT, SPAR_DARK, 0.06, KEEL_Y, 0.06,
      side * BAR_X, KEEL_Y / 2, BAR_Z);                            // downtube
    box(group, FRAME_MAT, SPAR_DARK, 0.05, KEEL_Y - 0.08, 0.05,
      side * 0.17, (KEEL_Y - 0.08) / 2 + 0.05, 0.14);              // harness strap
  }
  box(group, FRAME_MAT, SPAR, 1.02, 0.07, 0.07, 0, 0.02, BAR_Z);   // control bar

  const hands = new THREE.Group();
  group.add(hands);
  for (const side of [-1, 1]) {
    box(hands, FRAME_MAT, SKIN, 0.17, 0.16, 0.19, side * BAR_X, 0.06, BAR_Z);
  }
  hands.visible = false;

  return { group, wing, panels, hands, tips };
}

export interface GliderRigPose {
  /** 0 = stowed, 1 = fully open. Eases the unfurl and the pop-out scale. */
  deploy: number;
  /** Bank angle in radians (the caller also rolls the group by this). */
  bank: number;
  /** 0..1 speed, for how hard the sail flutters. */
  speed01: number;
  /** Seconds, for the flutter clock. */
  time: number;
}

/** Animate a rig: unfurl on deploy, flex the sail, let the wing lead the roll. */
export function poseGliderRig(rig: GliderRig, p: GliderRigPose): void {
  const t = Math.max(0, Math.min(1, p.deploy));
  const d = t * t * (3 - 2 * t); // smoothstep — the wings snap open, not linearly
  rig.group.visible = t > 0.02;
  rig.group.scale.setScalar(0.82 + 0.18 * d);
  for (let i = 0; i < rig.panels.length; i++) {
    const side = i === 0 ? -1 : 1;
    const flutter = Math.sin(p.time * 6.5 + i * 1.3) *
      (0.02 + 0.045 * Math.max(0, Math.min(1, p.speed01)));
    rig.panels[i].rotation.z = side * (DIHEDRAL + FOLD * (1 - d) + flutter);
  }
  rig.wing.rotation.z = -p.bank * 0.12;
}

/** Free a rig's geometry (its materials are shared and outlive it). */
export function disposeGliderRig(rig: GliderRig): void {
  rig.group.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.geometry) m.geometry.dispose();
  });
  rig.group.parent?.remove(rig.group);
}

/** The pilot's pose while hanging under the wing. Angles are radians for the
 *  avatar body, mirroring stridePose's convention: limbs pivot at the top and
 *  the model faces -z, so a POSITIVE rotation.x swings a limb FORWARD, while a
 *  positive rotation.x on the BODY (pivot at the feet) reclines it backward —
 *  hence a negative tilt for face-down flight. */
export interface GlidePose {
  /** group.rotation.x — negative: the pilot lies face down along the flight path. */
  tilt: number;
  /** group.rotation.z — rolls into the turn with the wing. */
  roll: number;
  /** head.rotation.x — cranes up out of the prone body to hold the gaze level. */
  head: number;
  /** rotation.x for [leftLeg, rightLeg] — trailing behind, with a slow scissor. */
  legs: [number, number];
  /** rotation.x for both arms — reaching up/forward onto the control bar. */
  arms: [number, number];
  /** ± rotation.z spreading the hands out to the grips (left gets the minus). */
  armRoll: number;
  /** rotation.x for the cape, streaming flat behind. */
  cape: number;
}

/**
 * `deploy` (0..1) scales EVERY term, so at 0 this is exactly the neutral
 * standing pose and the transition into (and out of) flight is a blend rather
 * than a snap.
 */
export function glidePose(
  pitch: number, bank: number, phase: number, deploy: number
): GlidePose {
  const t = Math.max(0, Math.min(1, deploy));
  const d = t * t * (3 - 2 * t);
  const dive = Math.max(0, -pitch);
  // Nose-down flight lies the pilot flatter along the path; level flight keeps
  // a little head-up attitude so the body never looks like it is falling.
  const tilt = -(0.95 + Math.min(0.45, dive * 0.35)) * d;
  const flutter = Math.sin(phase * 3) * 0.06 * d;
  return {
    tilt,
    roll: bank,
    head: Math.max(-0.55, Math.min(1.0, pitch - tilt * 0.8)) * d,
    legs: [(-0.1 + flutter) * d, (-0.1 - flutter) * d],
    arms: [2.55 * d, 2.55 * d],
    armRoll: 0.2 * d,
    cape: (-0.3 + Math.sin(phase * 2.2) * 0.1) * d,
  };
}
