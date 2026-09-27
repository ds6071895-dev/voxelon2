// Shared first/third-person flight rig: a swept, faceted stormwing with
// luminous edges, articulated tips and a suspended control frame.
// The wing and pilot have independent attitudes so banking feels airborne.

import * as THREE from 'three';

const FACE_SHADE = [0.80, 0.62, 1.0, 0.46, 0.90, 0.70];

// Shared, never disposed (the same handful of materials for every rig in the
// world); rigs own only their geometry.
const FRAME_MAT = new THREE.MeshBasicMaterial({ vertexColors: true });
const SAIL_MAT = new THREE.MeshBasicMaterial({
  vertexColors: true, side: THREE.DoubleSide,
});

const SPAR = 0xb6d1da;
const SPAR_DARK = 0x162a3c;
const SAIL_A = 0x123749;
const SAIL_B = 0x217d91;
const ACCENT = 0x6df5ee;
const GOLD = 0xffc775;
const GLOW_MAT = new THREE.MeshBasicMaterial({ color: ACCENT, toneMapped: false });
const TRAIL_MAT = new THREE.MeshBasicMaterial({
  color: ACCENT, side: THREE.DoubleSide, transparent: true, opacity: 0.22,
  depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
});

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

/** A spar joining two authored points, so the frame really follows the sail. */
function beam(parent: THREE.Object3D, hex: number, width: number,
  a: THREE.Vector3, b: THREE.Vector3, glow = false): void {
  const mesh = box(parent, glow ? GLOW_MAT : FRAME_MAT, hex,
    width, a.distanceTo(b), width, 0, 0, 0);
  mesh.position.copy(a).add(b).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
}

/** Cambered sail bay: four baked-shaded facets meet at a raised ridge. */
function sailBay(parent: THREE.Object3D, corners: THREE.Vector3[], hex: number): void {
  const center = corners.reduce((sum, v) => sum.add(v), new THREE.Vector3()).multiplyScalar(.25);
  center.y += .12;
  const positions: number[] = [], colors: number[] = [];
  const base = new THREE.Color(hex);
  for (let i = 0; i < 4; i++) {
    for (const v of [corners[i], corners[(i + 1) % 4], center]) {
      positions.push(v.x, v.y, v.z);
      const shade = [1, .82, .65, .92][i];
      colors.push(base.r * shade, base.g * shade, base.b * shade);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  parent.add(new THREE.Mesh(geo, SAIL_MAT));
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
  /** Tapered slipstreams visible to the pilot and other players. */
  trails: THREE.Mesh[];
}

/** Build one hang-glider rig: swept delta canopy, spar frame, control bar. */
export function buildGliderRig(): GliderRig {
  const group = new THREE.Group();
  group.rotation.order = 'YXZ'; // bank first, then flight-path pitch, then yaw

  // ── Canopy ───────────────────────────────────────────────────────────────
  const wing = new THREE.Group();
  wing.position.y = KEEL_Y;
  group.add(wing);

  beam(wing, SPAR_DARK, .10, new THREE.Vector3(0, 0, -2.1), new THREE.Vector3(0, 0, .92));
  box(wing, FRAME_MAT, GOLD, .22, .12, .34, 0, .03, -1.94);
  box(wing, GLOW_MAT, ACCENT, .055, .035, 1.2, 0, .08, -.85);

  const panels: THREE.Group[] = [];
  const tips: THREE.Object3D[] = [];
  const trails: THREE.Mesh[] = [];
  for (const side of [-1, 1]) {
    const panel = new THREE.Group();
    wing.add(panel);
    panels.push(panel);
    // Span, leading edge, trailing edge, lift. Continuous swept silhouette,
    // with teal facets and a pale outer blade that reads from far away.
    const sections = [[0, -2.05, .85, 0], [.8, -1.65, .62, .06],
      [1.7, -.88, .65, .13], [2.65, .02, .98, .22], [2.95, .5, .8, .33]];
    const leading = sections.map(([x, z, , y]) => new THREE.Vector3(side * x, y, z));
    const trailing = sections.map(([x, , z, y]) => new THREE.Vector3(side * x, y, z));
    for (let i = 0; i < sections.length - 1; i++) {
      sailBay(panel, [leading[i], leading[i + 1], trailing[i + 1], trailing[i]],
        [SAIL_A, SAIL_B, SAIL_A, 0xd6edf0][i]);
      beam(panel, SPAR_DARK, .055, leading[i], leading[i + 1]);
      beam(panel, ACCENT, .028, trailing[i], trailing[i + 1], true);
      if (i > 0) beam(panel, SPAR, .022, leading[i], trailing[i]);
      // Gold slash through each bay, visible above and below the canopy.
      const stripeA = leading[i].clone().lerp(trailing[i], .22);
      const stripeB = leading[i + 1].clone().lerp(trailing[i + 1], .22);
      stripeA.y += .055; stripeB.y += .055;
      beam(panel, GOLD, .045, stripeA, stripeB);
    }
    const tip = new THREE.Object3D();
    tip.position.copy(trailing[4]);
    panel.add(tip);
    tips.push(tip);
    // Upraked blade tips finish the silhouette and carry the running lights.
    beam(panel, GOLD, .075, leading[4], new THREE.Vector3(side * 3.04, .67, .88));
    box(tip, GLOW_MAT, ACCENT, .11, .06, .2, 0, .03, 0);
    const trailGeo = new THREE.BufferGeometry();
    trailGeo.setAttribute('position', new THREE.Float32BufferAttribute([
      -.045, 0, 0, .045, 0, 0, 0, -.08, 3.8,
      0, -.035, 0, 0, .035, 0, 0, -.08, 3.8,
    ], 3));
    const trail = new THREE.Mesh(trailGeo, TRAIL_MAT);
    trail.frustumCulled = false;
    tip.add(trail);
    trails.push(trail);
  }

  // A real triangular control frame and harness, with wrapped grips in POV.
  for (const side of [-1, 1]) {
    beam(group, SPAR, .055, new THREE.Vector3(0, KEEL_Y, BAR_Z),
      new THREE.Vector3(side * BAR_X, .02, BAR_Z));
    beam(group, SPAR_DARK, .04, new THREE.Vector3(side * .12, KEEL_Y, .1),
      new THREE.Vector3(side * .17, .05, .14));
    box(group, FRAME_MAT, SPAR_DARK, .25, .10, .11, side * BAR_X, .02, BAR_Z);
    box(group, FRAME_MAT, GOLD, .035, .12, .12, side * .31, .02, BAR_Z);
  }
  box(group, FRAME_MAT, SPAR, 1.02, .065, .065, 0, .02, BAR_Z);
  // Compact luminous hub below the canopy, above the pilot's sightline.
  box(group, FRAME_MAT, SPAR_DARK, .24, .13, .12, 0, .12, BAR_Z);
  box(group, GLOW_MAT, ACCENT, .13, .035, .025, 0, .14, BAR_Z + .065);
  const hands = new THREE.Group();
  group.add(hands);
  for (const side of [-1, 1]) {
    box(hands, FRAME_MAT, SPAR_DARK, .17, .16, .19, side * BAR_X, .06, BAR_Z);
    box(hands, FRAME_MAT, GOLD, .18, .055, .075, side * BAR_X, .09, BAR_Z + .11);
    box(hands, FRAME_MAT, SAIL_B, .14, .12, .29, side * BAR_X, .035, BAR_Z + .23);
  }
  hands.visible = false;

  return { group, wing, panels, hands, tips, trails };
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
  const speed = Math.max(0, Math.min(1, p.speed01));
  for (const trail of rig.trails) {
    trail.visible = d > .8 && speed > .3;
    trail.scale.set(1, 1, .25 + speed * 1.2);
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
  };
}
