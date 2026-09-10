// Procedural 3D models for VEHICLES — currently the two-seat helicopter and
// the bombs it drops.
//
// Built entirely in code like the rest of the project's art, unlit with baked
// shading like the rest of the project. The model
// is authored so that everything the server simulates is VISIBLE: the rotors
// spin, the airframe banks with the flight state, both seats are real positions
// with avatars in them, the bomb rack empties as bombs are released, damage
// smoke thickens as the hull drops, and at zero HP the rotor visibly winds down
// while the wreck spins into the ground.

import * as THREE from 'three';
import type { BombSnapshot, HelicopterSnapshot } from './vehicles';
import { SEAT_OFFSETS, WRECK_SECONDS } from './vehicles';
import { helicopterStats } from './warfare';

const FACE_SHADE = [0.80, 0.62, 1.0, 0.46, 0.90, 0.70];

const VEHICLE_MAT = new THREE.MeshBasicMaterial({ vertexColors: true });
const GLASS_MAT = new THREE.MeshBasicMaterial({
  vertexColors: true, transparent: true, opacity: 0.55,
  side: THREE.DoubleSide,
});
const GLOW_MAT = new THREE.MeshBasicMaterial({
  vertexColors: true, transparent: true, opacity: 0.9,
  blending: THREE.AdditiveBlending, depthWrite: false,
});
const ROTOR_MAT = new THREE.MeshBasicMaterial({
  vertexColors: true, transparent: true, opacity: 0.72,
  side: THREE.DoubleSide, depthWrite: false,
});

const OLIVE = 0x4d6350;
const OLIVE_DARK = 0x33453a;
const OLIVE_LIGHT = 0x6f8a72;
const STEEL = 0x8e96a4;
const STEEL_DARK = 0x454a55;
const GLASS = 0x9fd8e8;
const NEAR_BLACK = 0x23272e;
const AMBER = 0xe6a83a;
/**
 * The airframe is authored directly in WORLD units — one unit is one block —
 * so the cabin you can see is the cabin the simulation collides with and the
 * seat anchors are the seat positions. (It used to be drawn small and scaled up
 * at the group, which made every offset a division and hid the fact that the
 * cabin was too short to actually contain a person.)
 */
const HELICOPTER_MODEL_SCALE = 1;
/** Seat-pan → eye height for someone strapped into a seat. Sitting a little
 *  taller clears the nose line, which is what you are really aiming over. */
const SEAT_EYE = 1.02;
/** …and a little further forward, so the eye sits AT the windscreen instead of
 *  a seat-back's length behind it. The nose stays in view either way. */
const COCKPIT_EYE_FWD = 0.34;

function paintFaces(geo: THREE.BufferGeometry, hex: number): THREE.BufferGeometry {
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

function paintRound(geo: THREE.BufferGeometry, hex: number, boost = 0): THREE.BufferGeometry {
  const color = new THREE.Color(hex);
  geo.computeVertexNormals();
  const nrm = geo.getAttribute('normal');
  const colors = new Float32Array(nrm.count * 3);
  const key = new THREE.Vector3(0.45, 0.82, 0.35).normalize();
  const n = new THREE.Vector3();
  for (let i = 0; i < nrm.count; i++) {
    n.set(nrm.getX(i), nrm.getY(i), nrm.getZ(i));
    const lambert = 0.5 + 0.5 * n.dot(key);
    const rim = Math.pow(1 - Math.abs(n.y), 3) * 0.16;
    const s = Math.min(1.35, 0.44 + lambert * 0.7 + rim + boost);
    colors[i * 3] = color.r * s;
    colors[i * 3 + 1] = color.g * s;
    colors[i * 3 + 2] = color.b * s;
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  return geo;
}

function box(
  parent: THREE.Object3D, hex: number, w: number, h: number, d: number,
  x: number, y: number, z: number, mat: THREE.Material = VEHICLE_MAT,
): THREE.Mesh {
  const mesh = new THREE.Mesh(paintFaces(new THREE.BoxGeometry(w, h, d), hex), mat);
  mesh.position.set(x, y, z);
  parent.add(mesh);
  return mesh;
}

function round(
  parent: THREE.Object3D, geo: THREE.BufferGeometry, hex: number,
  x: number, y: number, z: number, mat: THREE.Material = VEHICLE_MAT, boost = 0,
): THREE.Mesh {
  const mesh = new THREE.Mesh(paintRound(geo, hex, boost), mat);
  mesh.position.set(x, y, z);
  parent.add(mesh);
  return mesh;
}

export interface HelicopterModel {
  group: THREE.Group;
  /** Airframe, which the server's roll/pitch is applied to. */
  hull: THREE.Group;
  mainRotor: THREE.Object3D;
  tailRotor: THREE.Object3D;
  /** Seat anchors — an avatar is parented here. */
  seats: { pilot: THREE.Object3D; passenger: THREE.Object3D };
  /** One mesh per bomb the rack can carry (hidden as they are dropped). */
  bombs: THREE.Object3D[];
  /** Navigation + anti-collision lights. */
  lights: THREE.Mesh[];
  /** Glazing. Hidden for whoever is sitting inside in first person, so the
   *  pilot flies through open apertures instead of through tinted panels. */
  glazing: THREE.Object3D[];
  /**
   * Everything that only ever gets in the way of the person strapped INSIDE:
   * roof, pillars, waist panels, floor, bulkhead, engine deck and the whole
   * instrument shelf. Hidden alongside the glazing for the rider's own airframe
   * in first person, which turns a cramped box with letterbox apertures into an
   * open gunship seat — you can look straight down at what you are bombing and
   * straight up at the rotor. Everyone else still sees a complete helicopter.
   */
  interior: THREE.Object3D[];
  /** Optional field modules, driven directly from authoritative snapshots. */
  winch: THREE.Object3D;
  /** The spinning drum inside the winch housing, so paying rope out LOOKS like
   *  paying rope out rather than a line appearing from nowhere. */
  winchDrum: THREE.Object3D;
  fuelTanks: THREE.Object3D[];
  rope: RopeRig;
  tier: number;
}

/**
 * The fast rope, as a rig rather than a stick.
 *
 * It hangs from a PIVOT at the winch head — outside the hull group, so the line
 * stays plumb however hard the airframe banks — and everything that sells the
 * descent hangs off that pivot: the line itself, evenly spaced rungs that give
 * your eye something to measure speed against on the way down, and a weighted
 * end that swings. The pivot is what sways, so a rider parented to a point on
 * the line sways with it.
 */
export interface RopeRig {
  pivot: THREE.Group;
  line: THREE.Mesh;
  rungs: THREE.Mesh[];
  weight: THREE.Object3D;
}

/** Blocks between the rungs woven into the line. */
const ROPE_RUNG_SPACING = 3.2;
const ROPE_RUNGS = Math.ceil(48 / ROPE_RUNG_SPACING);

/**
 * The airframe. +Z is the nose, and because Y is up that means the model's own
 * STARBOARD side is local −X (right = forward × up) — the one fact the whole
 * cockpit layout hangs off.
 *
 * The cabin is a real cavity, not a solid block with seats stuck to it: floor,
 * waist-high side panels, a rear bulkhead, a roof on pillars, and glazing that
 * fills the gaps. Two seats sit side by side at the front with the whole
 * windscreen in front of them, so a pilot in first person looks OUT rather than
 * into the back of the fuselage, and a rider's head is inside the cabin instead
 * of poking through the roof.
 *
 * Marks are visually distinct, not just numerically better:
 *   Mk I    slim cabin, skid gear, two hardpoints, a single mast light
 *   Mk II   longer nose, stub wings carrying the extra bombs, engine intakes
 *   Mk III  armoured cheeks, chin sensor turret, five hardpoints, twin exhausts
 */
export function buildHelicopterModel(tier: number, markingHex: number): HelicopterModel {
  const stats = helicopterStats(tier);
  const mark = stats.mark;
  const group = new THREE.Group();
  const hull = new THREE.Group();
  group.add(hull);
  group.scale.setScalar(HELICOPTER_MODEL_SCALE);
  const lights: THREE.Mesh[] = [];
  const glazing: THREE.Object3D[] = [];
  const interior: THREE.Object3D[] = [];
  /** Tag a part as cabin furniture — invisible to the person sitting in it. */
  const inner = <T extends THREE.Object3D>(o: T): T => { interior.push(o); return o; };

  // Cabin envelope. Everything else is positioned off these six numbers so the
  // interior stays a coherent, person-sized room.
  const CAB = {
    halfW: 0.88,    // interior half-width
    floorY: -0.78,  // interior floor
    roofY: 0.98,    // interior ceiling
    backZ: -0.78,   // rear bulkhead
    frontZ: 1.52,   // windscreen base
  };
  const wallY = (CAB.floorY + -0.16) / 2;          // waist panel centre
  const cabLen = CAB.frontZ - CAB.backZ;
  const cabMidZ = (CAB.frontZ + CAB.backZ) / 2;

  // --- Cabin shell ---
  // The floor goes in the interior list too: a bombing run is flown looking
  // STRAIGHT DOWN, and a deck plate between the pilot and the target is the
  // most obstructive panel on the whole airframe.
  inner(box(hull, OLIVE_DARK, CAB.halfW * 2 + 0.16, 0.14, cabLen + 0.2,
    0, CAB.floorY - 0.07, cabMidZ));
  inner(box(hull, OLIVE, CAB.halfW * 2 + 0.06, 0.06, cabLen,
    0, CAB.floorY + 0.02, cabMidZ)); // deck plate
  // Waist panels down each side (the door is the aperture ABOVE them).
  for (const side of [-1, 1]) {
    inner(box(hull, OLIVE, 0.12, -0.16 - CAB.floorY, cabLen,
      side * (CAB.halfW + 0.06), wallY, cabMidZ));
    inner(box(hull, OLIVE_LIGHT, 0.14, 0.07, cabLen,
      side * (CAB.halfW + 0.06), -0.13, cabMidZ)); // sill rail
    // Corner pillars only — the middle of each doorway stays wide open.
    inner(box(hull, OLIVE_DARK, 0.11, CAB.roofY + 0.2, 0.12,
      side * (CAB.halfW + 0.04), (CAB.roofY - 0.16) / 2, CAB.backZ + 0.1));
    inner(box(hull, OLIVE_DARK, 0.10, CAB.roofY + 0.2, 0.11,
      side * (CAB.halfW + 0.02), (CAB.roofY - 0.16) / 2, CAB.frontZ - 0.06));
    inner(box(hull, OLIVE_DARK, 0.11, 0.11, cabLen,
      side * (CAB.halfW + 0.02), CAB.roofY + 0.02, cabMidZ));
  }
  // Roof + rear bulkhead close the box off.
  inner(box(hull, OLIVE, CAB.halfW * 2 + 0.2, 0.13, cabLen - 0.5, 0, CAB.roofY + 0.07, cabMidZ - 0.16));
  inner(box(hull, OLIVE_LIGHT, CAB.halfW * 2 + 0.1, 0.05, cabLen - 0.8, 0, CAB.roofY + 0.15, cabMidZ - 0.2));
  inner(box(hull, OLIVE, CAB.halfW * 2 + 0.16, CAB.roofY - CAB.floorY + 0.2, 0.14,
    0, (CAB.roofY + CAB.floorY) / 2, CAB.backZ - 0.06));

  // --- Glazing: door windows + a wide one-piece windscreen ---
  for (const side of [-1, 1]) {
    glazing.push(box(hull, GLASS, 0.05, 0.92, cabLen - 0.35,
      side * (CAB.halfW + 0.05), 0.36, cabMidZ, GLASS_MAT));
  }
  const screen = box(hull, GLASS, CAB.halfW * 2 + 0.02, 1.72, 0.05, 0, 0.16, CAB.frontZ + 0.28,
    GLASS_MAT);
  screen.rotation.x = -0.46;   // rakes down and forward, out of the eyeline
  glazing.push(screen);
  // Thin A-pillars at the outer edges of the screen — deliberately NOT down the
  // middle, which is exactly where a pilot needs to be able to see.
  for (const side of [-1, 1]) {
    const pillar = inner(box(hull, OLIVE_DARK, 0.09, 1.78, 0.09,
      side * (CAB.halfW + 0.01), 0.16, CAB.frontZ + 0.28));
    pillar.rotation.x = -0.46;
  }

  // --- Nose + chin, all of it BELOW the windscreen line ---
  const noseLen = mark === 1 ? 0.6 : mark === 2 ? 0.9 : 1.05;
  box(hull, OLIVE, CAB.halfW * 1.9, 0.5, 0.7, 0, -0.52, CAB.frontZ + 0.3);
  const nose = round(hull, new THREE.CylinderGeometry(0.22, 0.72, noseLen, 10), OLIVE,
    0, -0.5, CAB.frontZ + 0.62 + noseLen / 2);
  nose.rotation.x = Math.PI / 2;
  box(hull, OLIVE_DARK, CAB.halfW * 1.8, 0.12, 0.6, 0, -0.76, CAB.frontZ + 0.3);

  // --- Cockpit furniture (low enough to frame the view, never fill it) ---
  inner(box(hull, OLIVE_DARK, CAB.halfW * 1.9, 0.13, 0.42, 0, -0.18, CAB.frontZ - 0.18)); // coaming
  const cluster = inner(box(hull, NEAR_BLACK, 1.24, 0.30, 0.05, 0, -0.05, CAB.frontZ - 0.34));
  cluster.rotation.x = 0.55;
  for (const dx of [-0.4, -0.14, 0.14, 0.4]) {
    const dial = inner(round(hull, new THREE.CylinderGeometry(0.055, 0.055, 0.02, 10), 0x6ff0c0,
      dx, -0.02, CAB.frontZ - 0.37, GLOW_MAT, 0.6));
    dial.rotation.x = Math.PI / 2 + 0.55;
  }
  // Collective/cyclic sticks between the seats, so the cabin reads as flown.
  for (const side of [-1, 1]) {
    inner(round(hull, new THREE.CylinderGeometry(0.035, 0.045, 0.5, 6), NEAR_BLACK,
      side * 0.46, CAB.floorY + 0.3, CAB.frontZ - 0.62));
  }

  // --- Armoured cheeks + chin turret (Mk III) ---
  if (mark >= 3) {
    for (const side of [-1, 1]) {
      inner(box(hull, STEEL_DARK, 0.2, 0.62, 1.0,
        side * (CAB.halfW + 0.16), -0.42, CAB.frontZ - 0.2));
    }
    const chin = round(hull, new THREE.SphereGeometry(0.26, 10, 8), STEEL_DARK,
      0, -0.82, CAB.frontZ + 0.5);
    round(chin, new THREE.CylinderGeometry(0.05, 0.05, 0.38, 8), NEAR_BLACK, 0, -0.02, 0.22)
      .rotation.x = Math.PI / 2;
  }

  // --- Engine deck + intakes, sitting on top of the cabin roof ---
  // Hidden with the roof: with the roof gone it would be the new ceiling.
  inner(box(hull, OLIVE_DARK, 1.15, 0.42, 1.3, 0, CAB.roofY + 0.32, cabMidZ - 0.55));
  if (mark >= 2) {
    for (const side of [-1, 1]) {
      inner(round(hull, new THREE.CylinderGeometry(0.16, 0.16, 0.46, 8), NEAR_BLACK,
        side * 0.42, CAB.roofY + 0.4, cabMidZ - 0.05)).rotation.x = Math.PI / 2;
    }
  }
  for (const ex of mark >= 3 ? [-0.34, 0.34] : [0]) {
    const pipe = round(hull, new THREE.CylinderGeometry(0.13, 0.17, 0.46, 8), STEEL_DARK,
      ex, CAB.roofY + 0.26, CAB.backZ - 0.1);
    pipe.rotation.x = Math.PI / 2 - 0.25;
  }

  // --- Tail boom + fins ---
  const boom = round(hull, new THREE.CylinderGeometry(0.14, 0.26, 2.3, 8), OLIVE,
    0, 0.24, CAB.backZ - 1.2);
  boom.rotation.x = Math.PI / 2;
  box(hull, OLIVE_DARK, 0.1, 0.86, 0.5, 0, 0.62, CAB.backZ - 2.2);       // vertical fin
  box(hull, OLIVE_LIGHT, 0.86, 0.07, 0.36, 0, 0.18, CAB.backZ - 1.9);    // stabiliser

  // --- Skid landing gear (clear of the bomb rack, inboard of the rotor) ---
  for (const side of [-1, 1]) {
    box(hull, STEEL_DARK, 0.1, 0.1, 1.9, side * 0.82, -1.16, cabMidZ + 0.15);
    box(hull, STEEL_DARK, 0.09, 0.44, 0.09, side * 0.78, -0.96, cabMidZ + 0.75);
    box(hull, STEEL_DARK, 0.09, 0.44, 0.09, side * 0.78, -0.96, cabMidZ - 0.45);
  }

  // --- Stub wings + bomb rack, slung under the belly ---
  const bombs: THREE.Object3D[] = [];
  const hardpoints = stats.bombs;
  if (mark >= 2) box(hull, OLIVE_DARK, 2.1, 0.11, 0.55, 0, -0.9, cabMidZ);
  for (let i = 0; i < hardpoints; i++) {
    // Alternate left/right walking outward, so a rack of 5 stays symmetric.
    const pair = Math.floor(i / 2);
    const side = i % 2 === 0 ? -1 : 1;
    const bx = hardpoints === 1 ? 0 : side * (0.26 + pair * 0.24);
    const bomb = new THREE.Group();
    bomb.position.set(bx, -1.0, cabMidZ + (i === hardpoints - 1 && hardpoints % 2 ? 0.3 : 0));
    round(bomb, new THREE.CylinderGeometry(0.1, 0.1, 0.5, 8), STEEL_DARK, 0, 0, 0)
      .rotation.x = Math.PI / 2;
    round(bomb, new THREE.ConeGeometry(0.1, 0.2, 8), STEEL, 0, 0, 0.34).rotation.x = Math.PI / 2;
    box(bomb, AMBER, 0.21, 0.02, 0.06, 0, 0, 0.02);
    for (const f of [0, 1, 2, 3]) {
      const fin = box(bomb, STEEL_DARK, 0.02, 0.15, 0.13, 0, 0, -0.27);
      fin.rotation.z = (f / 4) * Math.PI * 2;
    }
    hull.add(bomb);
    bombs.push(bomb);
  }

  // --- Faction markings: a band on the tail and a roundel on each flank ---
  box(hull, markingHex, 0.11, 0.46, 0.18, 0, 0.62, CAB.backZ - 2.2);
  for (const side of [-1, 1]) {
    const roundel = round(hull, new THREE.CylinderGeometry(0.2, 0.2, 0.02, 12), markingHex,
      side * (CAB.halfW + 0.13), -0.44, cabMidZ, VEHICLE_MAT, 0.15);
    roundel.rotation.z = Math.PI / 2;
  }

  // --- Rotors ---
  round(hull, new THREE.CylinderGeometry(0.1, 0.13, 0.5, 8), STEEL_DARK,
    0, CAB.roofY + 0.72, cabMidZ - 0.55);
  const mainRotor = new THREE.Group();
  mainRotor.position.set(0, CAB.roofY + 1.0, cabMidZ - 0.55);
  round(mainRotor, new THREE.CylinderGeometry(0.17, 0.17, 0.16, 10), STEEL, 0, 0, 0);
  const blades = mark >= 3 ? 5 : 4;
  for (let i = 0; i < blades; i++) {
    const blade = new THREE.Group();
    blade.rotation.y = (i / blades) * Math.PI * 2;
    const b = box(blade, 0x2f3238, 0.2, 0.04, 4.4, 0, 0, 2.2, ROTOR_MAT);
    b.rotation.x = 0.06;   // a touch of pitch, so it reads as an aerofoil
    box(blade, STEEL_DARK, 0.12, 0.06, 0.36, 0, 0, 0.28);   // blade root
    mainRotor.add(blade);
  }
  hull.add(mainRotor);

  const tailRotor = new THREE.Group();
  tailRotor.position.set(0.22, 0.62, CAB.backZ - 2.2);
  round(tailRotor, new THREE.CylinderGeometry(0.07, 0.07, 0.12, 8), STEEL, 0, 0, 0)
    .rotation.z = Math.PI / 2;
  for (let i = 0; i < 3; i++) {
    const blade = new THREE.Group();
    blade.rotation.x = (i / 3) * Math.PI * 2;
    box(blade, 0x2f3238, 0.035, 1.05, 0.12, 0, 0.52, 0, ROTOR_MAT);
    tailRotor.add(blade);
  }
  hull.add(tailRotor);

  // --- Running lights: red port, green starboard, white tail, red beacon ---
  // Port is local +X on a +Z-forward model, so the red light goes on +X.
  lights.push(round(hull, new THREE.SphereGeometry(0.07, 8, 6), 0xff4a3a,
    CAB.halfW + 0.14, -0.4, CAB.frontZ - 0.1, GLOW_MAT, 0.8));
  lights.push(round(hull, new THREE.SphereGeometry(0.07, 8, 6), 0x46e06a,
    -(CAB.halfW + 0.14), -0.4, CAB.frontZ - 0.1, GLOW_MAT, 0.8));
  lights.push(round(hull, new THREE.SphereGeometry(0.06, 8, 6), 0xffffff,
    0, 0.3, CAB.backZ - 2.42, GLOW_MAT, 0.9));
  lights.push(round(hull, new THREE.SphereGeometry(0.08, 8, 6), 0xff3a2a,
    0, -0.86, cabMidZ - 0.6, GLOW_MAT, 0.9));

  // --- Seats ---
  const seats = { pilot: new THREE.Group(), passenger: new THREE.Group() };
  for (const key of ['pilot', 'passenger'] as const) {
    const o = SEAT_OFFSETS[key];
    const seat = seats[key];
    seat.position.set(o.x, o.y, o.z);
    // The seat furniture itself, so an empty cockpit still looks like a cockpit.
    box(seat, OLIVE_DARK, 0.5, 0.11, 0.5, 0, 0, 0);              // pan
    box(seat, OLIVE_DARK, 0.5, 0.86, 0.11, 0, 0.44, -0.28);      // back
    box(seat, NEAR_BLACK, 0.44, 0.06, 0.42, 0, 0.06, 0.02);      // cushion
    box(seat, markingHex, 0.34, 0.05, 0.06, 0, 0.3, -0.21);      // harness strap
    hull.add(seat);
  }

  // Field modules are authored on every model and hidden until installed. This
  // avoids rebuilding the airframe when a mechanic bolts one on.
  const winch = new THREE.Group();
  box(winch, STEEL_DARK, 0.48, 0.34, 0.44, 0, -0.68, -0.15);
  // The drum is a separate object so it can SPIN while the rope pays out.
  const winchDrum = new THREE.Group();
  winchDrum.position.set(0, -0.68, -0.15);
  const drum = round(winchDrum, new THREE.CylinderGeometry(0.16, 0.16, 0.42, 8), STEEL, 0, 0, 0);
  drum.rotation.z = Math.PI / 2;
  // Two crossed spokes standing proud of the drum face: a bare cylinder spinning
  // on its own axis is invisible, and the spinning drum is the tell that the
  // rope is running out.
  for (const a of [0, Math.PI / 2]) {
    const spoke = box(winchDrum, AMBER, 0.46, 0.3, 0.05, 0, 0, 0);
    spoke.rotation.x = a;
  }
  winch.add(winchDrum);
  hull.add(winch);
  winch.visible = false;
  const fuelTanks = [
    round(hull, new THREE.CylinderGeometry(0.24, 0.24, 1.7, 8), OLIVE_DARK,
      1.18, -0.38, -0.1),
    round(hull, new THREE.CylinderGeometry(0.24, 0.24, 1.7, 8), OLIVE_DARK,
      -1.18, -0.38, -0.1),
  ];
  for (const tank of fuelTanks) { tank.rotation.x = Math.PI / 2; tank.visible = false; }
  // --- Fast rope -------------------------------------------------------------
  // A visibly BRAIDED line: a fatter core than the old hairline cylinder, plus
  // rungs and a weighted end. Sliding past a rung every third of a second is
  // what turns "my altitude number is changing" into "I am moving".
  const ropePivot = new THREE.Group();
  ropePivot.position.set(0, -0.75, -0.15);
  const ropeMat = new THREE.MeshBasicMaterial({ color: 0x8e6535 });
  const ropeLine = new THREE.Mesh(
    new THREE.CylinderGeometry(0.075, 0.075, 1, 7), ropeMat,
  );
  // Unit cylinder is centred; anchor it at the top so scale.y IS the length.
  ropeLine.position.y = -0.5;
  ropePivot.add(ropeLine);
  const rungs: THREE.Mesh[] = [];
  for (let i = 0; i < ROPE_RUNGS; i++) {
    const rung = new THREE.Mesh(
      new THREE.CylinderGeometry(0.115, 0.115, 0.1, 7),
      new THREE.MeshBasicMaterial({ color: i % 2 ? 0x6a4a26 : 0xc4a05c }),
    );
    ropePivot.add(rung);
    rungs.push(rung);
  }
  const weight = new THREE.Group();
  box(weight, 0x4b3a22, 0.3, 0.34, 0.3, 0, -0.17, 0);
  box(weight, NEAR_BLACK, 0.34, 0.06, 0.34, 0, -0.34, 0);
  round(weight, new THREE.TorusGeometry(0.1, 0.03, 5, 8), STEEL, 0, 0.02, 0)
    .rotation.x = Math.PI / 2;
  ropePivot.add(weight);
  ropePivot.visible = false;
  group.add(ropePivot);
  const rope: RopeRig = { pivot: ropePivot, line: ropeLine, rungs, weight };

  return {
    group, hull, mainRotor, tailRotor, seats, bombs, lights, glazing, interior,
    winch, winchDrum, fuelTanks, rope, tier,
  };
}


/** A falling bomb (the same silhouette as the ones on the rack). */
export function buildBombModel(): THREE.Group {
  const g = new THREE.Group();
  round(g, new THREE.CylinderGeometry(0.11, 0.11, 0.5, 8), STEEL_DARK, 0, 0, 0);
  round(g, new THREE.ConeGeometry(0.11, 0.22, 8), STEEL, 0, 0.34, 0);
  box(g, AMBER, 0.23, 0.04, 0.23, 0, 0.06, 0);
  for (let i = 0; i < 4; i++) {
    const fin = box(g, STEEL_DARK, 0.02, 0.16, 0.16, 0, -0.28, 0);
    fin.rotation.y = (i / 4) * Math.PI * 2;
    fin.position.set(Math.sin((i / 4) * Math.PI * 2) * 0.08, -0.28,
      Math.cos((i / 4) * Math.PI * 2) * 0.08);
  }
  return g;
}

// --- Manager --------------------------------------------------------------------

function disposeTree(root: THREE.Object3D): void {
  root.traverse((o) => {
    // Sprites share ONE module-level geometry inside three.js — disposing it
    // here would pull the buffers out from under every other sprite in the
    // scene. Their own canvas texture + material are released by the caller.
    if ((o as THREE.Sprite).isSprite) return;
    const m = o as THREE.Mesh;
    if (m.geometry) m.geometry.dispose();
  });
}

/**
 * The overhead hull bar.
 *
 * A helicopter is the one thing in the world you fight from the ground with no
 * idea whether you are achieving anything: it is far away, it is moving, and
 * the only feedback used to be the smoke that starts at 55% hull. So every
 * airframe now carries its own bar, drawn on a canvas sprite exactly like the
 * player nameplates, with three things a shooter actually needs — how much hull
 * is left, how much the last burst took off (the white ghost that drains a beat
 * behind the fill), and whose it is.
 */
interface HeliBar {
  canvas: HTMLCanvasElement;
  tex: THREE.CanvasTexture;
  sprite: THREE.Sprite;
  /** Fraction currently drawn, and the ghost tail left by the last hit. */
  shown: number;
  ghost: number;
  ghostHold: number;
  /** Seconds of hit-flash left on the bar frame. */
  flash: number;
  lastKey: string;
}

const BAR_W = 256;
const BAR_H = 68;
/** Bars fade out past this range; beyond `BAR_FAR` they are not drawn at all. */
const BAR_FADE = 110;
const BAR_FAR = 170;

function drawHeliBar(
  bar: HeliBar, snap: HelicopterSnapshot, tint: string, mark: string,
): void {
  const frac = snap.maxHp > 0 ? Math.max(0, Math.min(1, snap.hp / snap.maxHp)) : 0;
  const key = `${Math.round(bar.shown * 400)}|${Math.round(bar.ghost * 400)}|` +
    `${snap.hp}|${snap.maxHp}|${bar.flash > 0 ? 1 : 0}|${snap.owner}|${mark}`;
  if (key === bar.lastKey) return;
  bar.lastKey = key;
  const ctx = bar.canvas.getContext('2d')!;
  ctx.clearRect(0, 0, BAR_W, BAR_H);

  // Caption: mark + owner, so a contact reads as "whose Mk III is that".
  ctx.font = '600 19px system-ui, sans-serif';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = tint;
  ctx.fillText(mark, 6, 14);
  const markW = ctx.measureText(mark).width;
  if (snap.owner) {
    ctx.fillStyle = 'rgba(214,226,242,0.85)';
    ctx.fillText(snap.owner.slice(0, 14), 12 + markW, 14);
  }
  ctx.fillStyle = 'rgba(214,226,242,0.9)';
  ctx.textAlign = 'right';
  ctx.fillText(`${Math.ceil(snap.hp)}`, BAR_W - 6, 14);
  ctx.textAlign = 'left';

  // Track.
  const y = 28, h = 26, r = 7;
  ctx.fillStyle = 'rgba(4,8,14,0.82)';
  ctx.beginPath();
  ctx.roundRect(0, y, BAR_W, h, r);
  ctx.fill();
  ctx.strokeStyle = bar.flash > 0 ? 'rgba(255,255,255,0.95)' : 'rgba(140,170,205,0.45)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(1, y + 1, BAR_W - 2, h - 2, r - 1);
  ctx.stroke();

  const inner = BAR_W - 8;
  // Ghost first: the chunk the last burst took, draining a beat behind.
  if (bar.ghost > frac) {
    ctx.fillStyle = 'rgba(255,236,180,0.85)';
    ctx.beginPath();
    ctx.roundRect(4, y + 4, Math.max(2, inner * bar.ghost), h - 8, 4);
    ctx.fill();
  }
  if (bar.shown > 0) {
    ctx.fillStyle = frac > 0.5 ? '#4ad9a0' : frac > 0.25 ? '#ffd24a' : '#ff5c4d';
    ctx.beginPath();
    ctx.roundRect(4, y + 4, Math.max(2, inner * bar.shown), h - 8, 4);
    ctx.fill();
  }
  // Quarter ticks, so "one more burst" is readable without doing arithmetic.
  ctx.fillStyle = 'rgba(4,8,14,0.55)';
  for (let i = 1; i < 4; i++) ctx.fillRect(4 + inner * (i / 4), y + 4, 2, h - 8);
  bar.tex.needsUpdate = true;
}

function makeHeliBar(): HeliBar {
  const canvas = document.createElement('canvas');
  canvas.width = BAR_W; canvas.height = BAR_H;
  const tex = new THREE.CanvasTexture(canvas);
  tex.magFilter = THREE.LinearFilter;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: tex, transparent: true, depthTest: true, depthWrite: false,
  }));
  sprite.scale.set(3.2, 0.85, 1);
  sprite.position.set(0, 2.6, 0);
  sprite.renderOrder = 3;
  return { canvas, tex, sprite, shown: 1, ghost: 1, ghostHold: 0, flash: 0, lastKey: '' };
}

/**
 * MOTION SMOOTHING — why this is not a plain lerp between snapshots.
 *
 * The wire carries a POSE at a fixed, fairly slow rate; frames are drawn far
 * more often than that. The old code re-based a 0→1 lerp on every snapshot and
 * advanced it at a fixed rate, so the airframe raced to the last known position
 * and then SAT STILL until the next packet — motion, stall, jump, motion,
 * stall. From the cockpit (where the camera is bolted to the aircraft) that
 * reads as the whole world juddering, which is exactly the "laggy" feel.
 *
 * Instead each airframe carries an estimated velocity, differentiated from
 * consecutive snapshots. Between packets the render target keeps MOVING along
 * that velocity, so the aircraft never stalls, and the drawn pose chases the
 * target with a frame-rate-independent exponential follow that absorbs the
 * correction whenever the estimate was wrong. Attitude gets the same treatment
 * with shortest-way-round angle wrapping, so a turn no longer snaps 10 times a
 * second.
 */
interface HeliEntry {
  model: HelicopterModel;
  snap: HelicopterSnapshot;
  /** Overhead hull bar and its animation state. */
  bar: HeliBar;
  /** Faction tint and mark caption, kept for the bar.
   *  Tiers run past three; the MARK is what the airframe is called. */
  tint: string;
  markLabel: string;
  /** Length of rope actually drawn — it pays out and reels in over time. */
  ropeDrawn: number;
  /** Pendulum state for the hanging line (radians + radians/s, per axis). */
  swayX: number;
  swayZ: number;
  swayVX: number;
  swayVZ: number;
  /** Last authoritative position + the pose drawn this frame. */
  target: THREE.Vector3;
  pos: THREE.Vector3;
  /** Blocks/second, differentiated from the last two snapshots. */
  vel: THREE.Vector3;
  /** Seconds since the last snapshot, and the smoothed gap between them. */
  sinceSnap: number;
  gap: number;
  /** Drawn attitude, chasing the snapshot's. */
  yaw: number;
  pitch: number;
  roll: number;
  /** Radians/second of yaw, so a sustained turn extrapolates too. */
  yawRate: number;
  rotorPhase: number;
  smokeAccum: number;
  /** Avatars currently parented into the seats, so they can be detached. */
  riders: { pilot: THREE.Object3D | null; passenger: THREE.Object3D | null };
}

/** Never extrapolate further than this past the last packet (a stop or a wall
 *  would otherwise fling the airframe on into open air). */
const EXTRAPOLATE_CAP = 0.22;
/** Beyond this the pose is teleporting, not flying — jump, don't glide. */
const TELEPORT_DIST = 12;

/** Shortest signed way round from `a` to `b`. */
function angleDelta(a: number, b: number): number {
  return Math.atan2(Math.sin(b - a), Math.cos(b - a));
}

interface Smoke {
  mesh: THREE.Mesh; ttl: number; life: number; drift: THREE.Vector3;
  opacity: number; gravity?: number; floor?: number; spin?: THREE.Vector3;
  fixedSize?: boolean;
}

/** Scratch vectors — sync/update run every frame for every airframe. */
const _tmp = new THREE.Vector3();
const _predict = new THREE.Vector3();
/** Camera position for the frame, so every bar sizes itself off one read. */
const _eye = new THREE.Vector3();
/** Scratch for the hull point test (worldToLocal mutates what it is given). */
const _hit = new THREE.Vector3();

export class VehicleModels {
  private readonly helis = new Map<number, HeliEntry>();
  private readonly bombs = new Map<number, { mesh: THREE.Group; snap: BombSnapshot }>();
  private readonly smoke: Smoke[] = [];
  private clock = 0;
  /** The airframe the local player is aboard (its own bar stays hidden). */
  private localRide: number | null = null;
  private hovered: number | null = null;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly tintOf: (faction: number) => string,
  ) {}

  /** Adopt the server's helicopter + bomb lists. */
  sync(list: readonly HelicopterSnapshot[], bombs: readonly BombSnapshot[]): void {
    const seen = new Set<number>();
    for (const snap of list) {
      seen.add(snap.id);
      let e = this.helis.get(snap.id);
      if (e && e.model.tier !== snap.tier) { this.remove(snap.id); e = undefined; }
      if (!e) {
        const tint = new THREE.Color();
        try { tint.set(this.tintOf(snap.faction)); } catch { tint.set('#a8b2c0'); }
        const model = buildHelicopterModel(snap.tier, tint.getHex());
        model.group.position.set(snap.x, snap.y, snap.z);
        this.scene.add(model.group);
        const bar = makeHeliBar();
        const frac = snap.maxHp > 0 ? snap.hp / snap.maxHp : 1;
        bar.shown = frac; bar.ghost = frac;
        model.group.add(bar.sprite);
        e = {
          model, snap, bar, tint: `#${tint.getHexString()}`,
          markLabel: `MK ${'I'.repeat(helicopterStats(snap.tier).mark)}`,
          ropeDrawn: snap.ropeDeployed ? snap.ropeLength : 0,
          swayX: 0, swayZ: 0, swayVX: 0, swayVZ: 0,
          target: new THREE.Vector3(snap.x, snap.y, snap.z),
          pos: new THREE.Vector3(snap.x, snap.y, snap.z),
          vel: new THREE.Vector3(),
          sinceSnap: 0, gap: 0.1,
          yaw: snap.yaw, pitch: snap.pitch, roll: snap.roll, yawRate: 0,
          rotorPhase: 0, smokeAccum: 0,
          riders: { pilot: null, passenger: null },
        };
        e.model.hull.rotation.order = 'YXZ';
        this.helis.set(snap.id, e);
      } else if (e.sinceSnap > 1e-4) {
        // Differentiate the packet stream. The gap is measured rather than
        // assumed so this behaves identically at the server's snapshot rate and
        // in the offline sim, which "snapshots" every single frame.
        const dt = e.sinceSnap;
        e.gap += (Math.min(0.35, dt) - e.gap) * 0.35;
        const moved = e.target.distanceTo(_tmp.set(snap.x, snap.y, snap.z));
        if (moved > TELEPORT_DIST) {
          e.vel.set(0, 0, 0);
          e.pos.set(snap.x, snap.y, snap.z);
          e.yaw = snap.yaw; e.pitch = snap.pitch; e.roll = snap.roll; e.yawRate = 0;
        } else {
          // Half-weight the new estimate: rounded positions over a short gap
          // are noisy, and a jumpy velocity is worse than a slightly late one.
          _tmp.set(snap.x - e.target.x, snap.y - e.target.y, snap.z - e.target.z)
            .divideScalar(dt);
          e.vel.lerp(_tmp, 0.5);
          e.yawRate += (angleDelta(e.snap.yaw, snap.yaw) / dt - e.yawRate) * 0.5;
        }
      }
      // A hull LOSS is the loudest thing an airframe can tell a bystander, and
      // the snapshot is the one place every viewer agrees it happened — the
      // shooter, the crew being shot at and anyone watching from the ground all
      // get the same ghost tail, the same flash and the same shower of spall.
      if (snap.hp < e.snap.hp) {
        e.bar.ghost = Math.max(e.bar.ghost, e.bar.shown);
        e.bar.ghostHold = 0.45;
        e.bar.flash = 0.16;
        this.spall(e, e.snap.hp - snap.hp);
      } else if (snap.hp > e.snap.hp) {
        // Repaired on the pad: no ghost, the bar just grows back.
        e.bar.ghost = snap.maxHp > 0 ? snap.hp / snap.maxHp : 1;
      }
      e.target.set(snap.x, snap.y, snap.z);
      e.sinceSnap = 0;
      e.snap = snap;
    }
    for (const id of [...this.helis.keys()]) if (!seen.has(id)) this.remove(id);

    const seenBombs = new Set<number>();
    for (const b of bombs) {
      seenBombs.add(b.id);
      let entry = this.bombs.get(b.id);
      if (!entry) {
        const mesh = buildBombModel();
        this.scene.add(mesh);
        entry = { mesh, snap: b };
        this.bombs.set(b.id, entry);
      }
      entry.snap = b;
      entry.mesh.position.set(b.x, b.y, b.z);
      // Bombs weathercock into their own velocity as they fall.
      const speed = Math.hypot(b.vx, b.vy, b.vz);
      if (speed > 0.1) {
        entry.mesh.rotation.order = 'YXZ';
        entry.mesh.rotation.y = Math.atan2(b.vx, b.vz);
        entry.mesh.rotation.x = -(Math.PI / 2 - Math.atan2(b.vy, Math.hypot(b.vx, b.vz))) + Math.PI;
      }
    }
    for (const [id, entry] of this.bombs) {
      if (seenBombs.has(id)) continue;
      this.scene.remove(entry.mesh);
      disposeTree(entry.mesh);
      this.bombs.delete(id);
    }
  }

  /** Seat an avatar object into a helicopter. Pass null to clear the seat. */
  setRider(heliId: number, seat: 'pilot' | 'passenger', avatar: THREE.Object3D | null): void {
    const e = this.helis.get(heliId);
    if (!e) return;
    const prev = e.riders[seat];
    if (prev && prev !== avatar) e.model.seats[seat].remove(prev);
    e.riders[seat] = avatar;
    if (avatar) {
      avatar.position.set(0, 0, 0);
      avatar.rotation.set(0, 0, 0);
      e.model.seats[seat].add(avatar);
    }
  }

  /** World position of a seat, for the local camera while riding. */
  seatWorldPosition(heliId: number, seat: 'pilot' | 'passenger'): THREE.Vector3 | null {
    const e = this.helis.get(heliId);
    if (!e) return null;
    return e.model.seats[seat].getWorldPosition(new THREE.Vector3());
  }

  /** Seated eye position inside the cabin, transformed by aircraft attitude. */
  cockpitWorldPosition(heliId: number, seat: 'pilot' | 'passenger'): THREE.Vector3 | null {
    const e = this.helis.get(heliId);
    if (!e) return null;
    const anchor = e.model.seats[seat];
    anchor.updateWorldMatrix(true, false);
    return anchor.localToWorld(new THREE.Vector3(0, SEAT_EYE, COCKPIT_EYE_FWD));
  }

  /** World point one metre behind the seat along the airframe's OWN centreline
   *  (roll, pitch and yaw all included). The third-person boom hangs off this
   *  line instead of the pilot's facing, so a bank or a turn can never swing
   *  the chase camera off the fuselage and out through the canopy. */
  chaseAnchor(heliId: number, seat: 'pilot' | 'passenger'): THREE.Vector3 | null {
    const e = this.helis.get(heliId);
    if (!e) return null;
    const anchor = e.model.seats[seat];
    anchor.updateWorldMatrix(true, false);
    return anchor.localToWorld(new THREE.Vector3(0, SEAT_EYE, COCKPIT_EYE_FWD - 1));
  }

  /**
   * Hide/show an airframe's cabin for the person sitting in it. The rider's OWN
   * aircraft drops its glass AND its cabin furniture while they are looking out
   * of it in first person: tinted panels, a roof, waist panels and a deck plate
   * across the entire field of view are the reason the cockpit was hard to fly
   * from, and none of it is information the pilot needs. Everyone outside still
   * sees a complete, properly glazed helicopter.
   */
  setCockpitView(heliId: number | null): void {
    for (const [id, e] of this.helis) {
      const hide = id === heliId;
      for (const g of e.model.glazing) g.visible = !hide;
      for (const g of e.model.interior) g.visible = !hide;
    }
  }

  snapshotOf(id: number): HelicopterSnapshot | null {
    return this.helis.get(id)?.snap ?? null;
  }

  /** Every helicopter currently rendered (used to find one parked on a pad). */
  snapshots(): HelicopterSnapshot[] {
    return [...this.helis.values()].map((e) => e.snap);
  }

  positionOf(id: number): THREE.Vector3 | null {
    return this.helis.get(id)?.model.group.position ?? null;
  }

  /**
   * Render-space point along a deployed rope (0 winch, 1 free end).
   *
   * Read off the rope's OWN pivot rather than computed straight down from the
   * hub, so a rider hangs on the line that is actually drawn: the sway, the
   * trail behind the airframe's travel and the part of the rope that has
   * physically paid out all move them.
   */
  ropeWorldPosition(id: number, progress: number): THREE.Vector3 | null {
    const e = this.helis.get(id);
    if (!e || !e.snap.ropeDeployed) return null;
    const pivot = e.model.rope.pivot;
    pivot.updateWorldMatrix(true, false);
    const p = Math.max(0, Math.min(1, progress));
    return pivot.localToWorld(new THREE.Vector3(0, -p * e.ropeDrawn, 0));
  }

  /**
   * Is this point inside an airframe's skin?
   *
   * Presentation only: it is what stops a tracer ON the hull instead of letting
   * it sail through the cabin and out the other side. The damage a round does
   * was already reported when the trigger was pulled, so a miss here costs
   * nothing but a visual. Tested in the hull's OWN space, so a banking
   * helicopter is hit where it looks like it is.
   */
  pointInHull(point: THREE.Vector3): boolean {
    for (const e of this.helis.values()) {
      if (e.snap.dying > 0) continue;
      // Cheap reject first — the local test needs a matrix inverse.
      if (e.model.group.position.distanceToSquared(point) > 16) continue;
      _hit.copy(point);
      e.model.hull.worldToLocal(_hit);
      if (Math.abs(_hit.x) <= 1.15 && _hit.y >= -1.15 && _hit.y <= 1.1 &&
          Math.abs(_hit.z) <= 2.4) return true;
    }
    return false;
  }

  /** Estimated velocity of an airframe (blocks/s), for anything that wants to
   *  inherit its momentum — stepping off the rope, mostly. */
  velocityOf(id: number): THREE.Vector3 | null {
    const e = this.helis.get(id);
    return e ? e.vel.clone() : null;
  }

  /**
   * The airframe the local player is riding. Its own overhead bar is hidden —
   * the cockpit HUD already carries the hull gauge, and a nameplate floating in
   * the middle of your own windscreen is just clutter.
   */
  setLocalRide(id: number | null): void { this.localRide = id; }
  setHovered(id: number | null): void { this.hovered = id; }

  /**
   * Spall thrown off a hull that just took a hit. Called from the snapshot
   * diff for everyone, and directly by the shooter so their own feedback lands
   * on the frame they pulled the trigger instead of a round trip later.
   */
  private spall(e: HeliEntry, amount: number): void {
    const n = Math.max(2, Math.min(9, Math.round(amount / 3) + 2));
    const p = e.model.group.position;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      this.puff(
        p.x + (Math.random() - 0.5) * 1.6, p.y + (Math.random() - 0.5) * 1.2,
        p.z + (Math.random() - 0.5) * 1.6,
        0.12 + Math.random() * 0.1, i % 3 ? 0xffc864 : 0xfff0c0, 0.34,
        new THREE.Vector3(Math.cos(a) * 3.4, 1.4 + Math.random() * 2, Math.sin(a) * 3.4),
        0.85);
    }
  }

  /** Immediate local feedback for a round the shooter knows connected. */
  hitFlash(id: number, amount: number): void {
    const e = this.helis.get(id);
    if (!e) return;
    e.bar.flash = 0.16;
    this.spall(e, amount);
  }

  remove(id: number): void {
    const e = this.helis.get(id);
    if (!e) return;
    // Never dispose a rider's avatar — it belongs to the player renderer.
    for (const seat of ['pilot', 'passenger'] as const) {
      const r = e.riders[seat];
      if (r) e.model.seats[seat].remove(r);
    }
    e.model.group.remove(e.bar.sprite);
    e.bar.tex.dispose();
    (e.bar.sprite.material as THREE.SpriteMaterial).dispose();
    this.scene.remove(e.model.group);
    disposeTree(e.model.group);
    this.helis.delete(id);
  }

  clear(): void {
    for (const id of [...this.helis.keys()]) this.remove(id);
    for (const [, entry] of this.bombs) {
      this.scene.remove(entry.mesh);
      disposeTree(entry.mesh);
    }
    this.bombs.clear();
    for (const s of this.smoke) {
      this.scene.remove(s.mesh);
      s.mesh.geometry.dispose();
      (s.mesh.material as THREE.Material).dispose();
    }
    this.smoke.length = 0;
  }

  private puff(
    x: number, y: number, z: number, size: number, hex: number, life: number,
    drift: THREE.Vector3, opacity = 0.5,
  ): void {
    if (this.smoke.length >= 500) return;
    const mesh = new THREE.Mesh(
      paintRound(new THREE.SphereGeometry(size, 6, 5), hex, 0.1),
      new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity, depthWrite: false }));
    mesh.position.set(x, y, z);
    this.scene.add(mesh);
    this.smoke.push({ mesh, ttl: life, life, drift, opacity });
  }

  /** The wreck explosion when an airframe hits zero HP. */
  explode(x: number, y: number, z: number): void {
    for (let i = 0; i < 18; i++) {
      const a = (i / 18) * Math.PI * 2;
      this.puff(x + Math.cos(a) * 0.8, y + Math.random() * 1.2, z + Math.sin(a) * 0.8,
        0.5 + Math.random() * 0.7, i % 3 ? 0x3c3a38 : 0xff7a2a, 1.8,
        new THREE.Vector3(Math.cos(a) * 2, 1.8 + Math.random(), Math.sin(a) * 2), 0.7);
    }
  }

  /** Impact payoff: ripped panels and rotor blades tumble through a fireball,
   * then bounce to rest while dust spreads and a smoke plume climbs. */
  crash(id: number, x: number, y: number, z: number): void {
    this.remove(id);
    this.explode(x, y, z);
    for (let i = 0; i < 32; i++) {
      const angle = i * Math.PI * 2 / 32;
      const speed = 3 + Math.random() * 6;
      const fire = i < 12;
      this.puff(x, y - 0.6, z, fire ? 0.8 : 0.65,
        fire ? (i % 2 ? 0xffb32c : 0xff5020) : 0x827669,
        fire ? 0.7 : 2.6,
        new THREE.Vector3(Math.cos(angle) * speed, fire ? 3 : 0.4, Math.sin(angle) * speed),
        fire ? 0.95 : 0.55);
    }
    for (let i = 0; i < 12; i++) {
      this.puff(x + (Math.random() - 0.5) * 2, y + i * 0.4, z + (Math.random() - 0.5) * 2,
        1 + Math.random(), 0x302d2b, 4.5,
        new THREE.Vector3(0.4, 1.5 + Math.random(), 0.2), 0.8);
    }
    for (let i = 0; i < 18; i++) {
      const blade = i < 4;
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(blade ? 2.6 : 0.35 + Math.random() * 0.7, 0.12, blade ? 0.22 : 0.6),
        new THREE.MeshBasicMaterial({ color: blade ? STEEL_DARK : i % 2 ? OLIVE : STEEL,
          transparent: true }));
      mesh.position.set(x, y, z);
      this.scene.add(mesh);
      const angle = i * 2.4;
      const speed = 3 + Math.random() * 6;
      this.smoke.push({ mesh, ttl: 5, life: 5, opacity: 1, fixedSize: true,
        gravity: 18, floor: y - 1,
        drift: new THREE.Vector3(Math.cos(angle) * speed, 5 + Math.random() * 8, Math.sin(angle) * speed),
        spin: new THREE.Vector3(Math.random() * 7, Math.random() * 5, Math.random() * 9) });
    }
  }

  /**
   * Animate the hanging rope.
   *
   * Three things it does that a stick could not:
   *   PAYS OUT   the line falls to length instead of appearing at length, with
   *              the winch drum spinning while it runs and the weighted end
   *              leading the way down.
   *   TRAILS     the line lags behind the airframe's travel, so a rope dropped
   *              from a moving helicopter streams backwards the way one would.
   *   SWINGS     a real (if heavily damped) pendulum on both axes, kicked by
   *              the aircraft's own acceleration, so the whole line — and
   *              anyone riding it — sways instead of hanging like a plumb line.
   */
  private updateRope(e: HeliEntry, dt: number): void {
    const { model, snap } = e;
    const want = snap.ropeDeployed ? snap.ropeLength : 0;
    // Out fast (it is thrown, then falls), back in on the winch's own time.
    const rate = want > e.ropeDrawn ? 34 : 14;
    const before = e.ropeDrawn;
    e.ropeDrawn = Math.abs(want - e.ropeDrawn) < 0.05 ? want
      : e.ropeDrawn + Math.sign(want - e.ropeDrawn) * Math.min(Math.abs(want - e.ropeDrawn), rate * dt);
    const running = Math.abs(e.ropeDrawn - before) > 1e-4;
    if (snap.ropeWinch) model.winchDrum.rotation.x += running ? dt * 26 * Math.sign(e.ropeDrawn - before) : 0;

    const rope = model.rope;
    const len = e.ropeDrawn;
    rope.pivot.visible = len > 0.05;
    if (!rope.pivot.visible) { e.swayVX = e.swayVZ = e.swayX = e.swayZ = 0; return; }

    // Pendulum. The airframe's velocity is the drive (drag on the line), the
    // spring pulls back to plumb, and the damping keeps it from oscillating
    // forever. Someone is STANDING on this, so it is deliberately a restrained
    // one: the lean is capped at about 20°, which is a line that visibly
    // streams behind a moving helicopter without slinging its rider a dozen
    // blocks out into the nearest hillside.
    const drive = 0.02;
    const spring = 26 / Math.max(6, len);
    const damp = 2.6;
    // A slow idle breath from the rotor wash, so a hovering rope is never a
    // dead plumb line.
    const wash = Math.sin(this.clock * 1.7) * 0.006;
    e.swayVX += (-e.vel.z * drive + wash - e.swayX * spring - e.swayVX * damp) * dt * 6;
    e.swayVZ += (e.vel.x * drive - wash - e.swayZ * spring - e.swayVZ * damp) * dt * 6;
    e.swayX = THREE.MathUtils.clamp(e.swayX + e.swayVX * dt, -0.35, 0.35);
    e.swayZ = THREE.MathUtils.clamp(e.swayZ + e.swayVZ * dt, -0.35, 0.35);
    rope.pivot.rotation.set(e.swayX, 0, e.swayZ, 'YXZ');

    rope.line.scale.y = len;
    rope.line.position.y = -len * 0.5;
    rope.weight.position.y = -len;
    // Rungs every few blocks, only as many as the paid-out line can carry.
    for (let i = 0; i < rope.rungs.length; i++) {
      const at = (i + 1) * ROPE_RUNG_SPACING;
      const on = at < len - 0.4;
      rope.rungs[i].visible = on;
      if (on) {
        rope.rungs[i].position.y = -at;
        rope.rungs[i].rotation.y = at * 0.9;   // a visible twist down the braid
      }
    }
  }

  update(dt: number, camera?: THREE.Camera): void {
    this.clock += dt;
    if (camera) camera.getWorldPosition(_eye);
    for (const [id, e] of this.helis) {
      const { model, snap } = e;
      e.sinceSnap += dt;

      // Where the airframe should be RIGHT NOW: last packet, carried forward
      // along its own velocity (capped, so a sudden stop can only ever overshoot
      // by a fraction of a second's travel).
      const lead = Math.min(e.sinceSnap, EXTRAPOLATE_CAP);
      _predict.copy(e.target).addScaledVector(e.vel, lead);
      // Follow rate scales with the packet gap: sparse updates are eased, and
      // the offline sim — which produces a fresh pose every single frame, with
      // nothing to smooth away — is simply drawn where it says it is.
      const follow = e.gap < 0.03 ? 1
        : 1 - Math.exp(-dt * THREE.MathUtils.clamp(2 / e.gap, 10, 60));
      e.pos.lerp(_predict, follow);
      model.group.position.copy(e.pos);

      // Attitude chases the server's the same way, the short way round.
      e.yaw += angleDelta(e.yaw, snap.yaw + e.yawRate * lead) * follow;
      e.pitch += angleDelta(e.pitch, snap.pitch) * follow;
      e.roll += angleDelta(e.roll, snap.roll) * follow;
      model.hull.rotation.y = e.yaw;
      model.hull.rotation.x = e.pitch;
      model.hull.rotation.z = e.roll;
      // Seats are read back out for the rider's camera in the SAME frame, so
      // the matrices have to be current — otherwise the cockpit view lags the
      // airframe it is bolted to by one frame and jitters against the world.
      model.group.updateMatrixWorld(true);

      // Rotor speed: full while flown, winding DOWN once the wreck is falling.
      const dying = snap.dying > 0;
      const spin = dying ? 3 + 25 * Math.exp(-(WRECK_SECONDS - snap.dying) * 1.1)
        : (snap.pilot || snap.ropeDeployed) ? 34 : 6;
      e.rotorPhase += dt * spin;
      model.mainRotor.rotation.y = e.rotorPhase;
      model.tailRotor.rotation.x = -e.rotorPhase * 2.4;
      // The disc fades out as it spools up, so a fast rotor reads as a blur and
      // a stopped one reads as four solid blades.
      const blur = Math.min(1, spin / 30);
      ROTOR_MAT.opacity = 0.35 + (1 - blur) * 0.5;

      // Empty the visible rack as bombs are released.
      for (let i = 0; i < model.bombs.length; i++) model.bombs[i].visible = i < snap.bombs;
      model.winch.visible = snap.ropeWinch;
      model.fuelTanks[0].visible = snap.fuelModule >= 2;
      model.fuelTanks[1].visible = snap.fuelModule >= 3;
      this.updateRope(e, dt);

      // Running lights: a slow strobe on the belly beacon, steady nav lights.
      const strobe = (Math.sin(this.clock * 6) > 0.7) ? 1.5 : 0.7;
      model.lights[3].scale.setScalar(strobe);

      // --- Overhead hull bar ---
      const bar = e.bar;
      const frac = snap.maxHp > 0 ? Math.max(0, Math.min(1, snap.hp / snap.maxHp)) : 0;
      // The fill chases the truth quickly; the ghost holds, then drains slowly
      // behind it, which is what makes a burst read as a bite out of the bar.
      bar.shown += (frac - bar.shown) * Math.min(1, dt * 14);
      if (Math.abs(bar.shown - frac) < 0.002) bar.shown = frac;
      if (bar.ghostHold > 0) bar.ghostHold = Math.max(0, bar.ghostHold - dt);
      else if (bar.ghost > bar.shown) bar.ghost = Math.max(bar.shown, bar.ghost - dt * 0.55);
      else bar.ghost = bar.shown;
      bar.flash = Math.max(0, bar.flash - dt);
      const dist = camera ? _eye.distanceTo(model.group.position) : 0;
      const hovered = id === this.hovered;
      const visible = !dying && snap.maxHp > 0 && id !== this.localRide && dist < BAR_FAR &&
        (hovered || bar.flash > 0 || bar.ghost > frac + 0.01);
      bar.sprite.visible = visible;
      if (visible) {
        drawHeliBar(bar, snap, e.tint, e.markLabel);
        // Grow with range so the bar stays readable on a contact at altitude,
        // and fade out entirely before it becomes litter on the horizon.
        const grow = THREE.MathUtils.clamp(dist / 34, 1, 2.6);
        const punch = bar.flash > 0 ? 1.1 : 1;
        bar.sprite.scale.set(3.2 * grow * punch, 0.85 * grow * punch, 1);
        bar.sprite.position.y = 2.5 + grow * 0.35;
        const mat = bar.sprite.material as THREE.SpriteMaterial;
        mat.opacity = !hovered && dist > BAR_FADE
          ? Math.max(0, 1 - (dist - BAR_FADE) / (BAR_FAR - BAR_FADE)) : 1;
      }

      // Damage smoke: starts as a wisp below half HP and becomes a black column.
      const health = snap.maxHp > 0 ? snap.hp / snap.maxHp : 1;
      const hurt = health < 0.55 || dying;
      if (hurt) {
        e.smokeAccum += dt * (dying ? 4 : (0.55 - health) * 6);
        while (e.smokeAccum > 0.1) {
          e.smokeAccum -= 0.1;
          const p = model.group.position;
          this.puff(p.x + (Math.random() - 0.5) * 0.5, p.y + 0.2,
            p.z + (Math.random() - 0.5) * 0.5,
            dying ? 0.45 : 0.28, dying ? 0x2e2c2a : 0x6a6a6c, dying ? 2 : 1.4,
            new THREE.Vector3((Math.random() - 0.5) * 0.6, 1.1, (Math.random() - 0.5) * 0.6),
            dying ? 0.6 : 0.35);
          if (dying) this.puff(p.x, p.y - 0.1, p.z, 0.35 + Math.random() * 0.3,
            Math.random() > 0.5 ? 0xff8620 : 0xffd04a, 0.35,
            new THREE.Vector3(0, 2, 0), 0.9);
        }
      }
    }
    for (let i = this.smoke.length - 1; i >= 0; i--) {
      const s = this.smoke[i];
      s.ttl -= dt;
      const k = Math.max(0, s.ttl / s.life);
      if (s.gravity) s.drift.y -= s.gravity * dt;
      s.mesh.position.addScaledVector(s.drift, dt);
      if (s.floor !== undefined && s.mesh.position.y < s.floor) {
        s.mesh.position.y = s.floor;
        s.drift.y = Math.abs(s.drift.y) * 0.25;
        s.drift.x *= 0.65; s.drift.z *= 0.65;
        s.spin?.multiplyScalar(0.55);
      }
      if (s.spin) {
        s.mesh.rotation.x += s.spin.x * dt;
        s.mesh.rotation.y += s.spin.y * dt;
        s.mesh.rotation.z += s.spin.z * dt;
      }
      if (!s.fixedSize) s.mesh.scale.setScalar(0.6 + (1 - k) * 1.6);
      (s.mesh.material as THREE.MeshBasicMaterial).opacity = s.opacity * (s.fixedSize ? Math.min(1, s.ttl) : k);
      if (s.ttl <= 0) {
        this.scene.remove(s.mesh);
        s.mesh.geometry.dispose();
        (s.mesh.material as THREE.Material).dispose();
        this.smoke.splice(i, 1);
      }
    }
  }
}
