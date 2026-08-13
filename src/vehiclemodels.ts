// Procedural 3D models for VEHICLES — currently the two-seat helicopter and
// the bombs it drops.
//
// Built entirely in code like the rest of the project's art, unlit with baked
// shading (see warfare_models.ts for the shading toolkit rationale). The model
// is authored so that everything the server simulates is VISIBLE: the rotors
// spin, the airframe banks with the flight state, both seats are real positions
// with avatars in them, the bomb rack empties as bombs are released, damage
// smoke thickens as the hull drops, and at zero HP the rotor visibly winds down
// while the wreck spins into the ground.

import * as THREE from 'three';
import type { BombSnapshot, HelicopterSnapshot } from './vehicles';
import { SEAT_OFFSETS } from './vehicles';
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
  tier: number;
}

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

  return { group, hull, mainRotor, tailRotor, seats, bombs, lights, glazing, interior, tier };
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
    const m = o as THREE.Mesh;
    if (m.geometry) m.geometry.dispose();
  });
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

interface Smoke { mesh: THREE.Mesh; ttl: number; life: number; drift: THREE.Vector3 }

/** Scratch vectors — sync/update run every frame for every airframe. */
const _tmp = new THREE.Vector3();
const _predict = new THREE.Vector3();

export class VehicleModels {
  private readonly helis = new Map<number, HeliEntry>();
  private readonly bombs = new Map<number, { mesh: THREE.Group; snap: BombSnapshot }>();
  private readonly smoke: Smoke[] = [];
  private clock = 0;

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
        e = {
          model, snap,
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

  remove(id: number): void {
    const e = this.helis.get(id);
    if (!e) return;
    // Never dispose a rider's avatar — it belongs to the player renderer.
    for (const seat of ['pilot', 'passenger'] as const) {
      const r = e.riders[seat];
      if (r) e.model.seats[seat].remove(r);
    }
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
  }

  private puff(
    x: number, y: number, z: number, size: number, hex: number, life: number,
    drift: THREE.Vector3, opacity = 0.5,
  ): void {
    const mesh = new THREE.Mesh(
      paintRound(new THREE.SphereGeometry(size, 6, 5), hex, 0.1),
      new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity, depthWrite: false }));
    mesh.position.set(x, y, z);
    this.scene.add(mesh);
    this.smoke.push({ mesh, ttl: life, life, drift });
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

  update(dt: number): void {
    this.clock += dt;
    for (const e of this.helis.values()) {
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
      const spin = dying ? 4 + snap.dying * 8 : snap.pilot ? 34 : 6;
      e.rotorPhase += dt * spin;
      model.mainRotor.rotation.y = e.rotorPhase;
      model.tailRotor.rotation.x = -e.rotorPhase * 2.4;
      // The disc fades out as it spools up, so a fast rotor reads as a blur and
      // a stopped one reads as four solid blades.
      const blur = Math.min(1, spin / 30);
      ROTOR_MAT.opacity = 0.35 + (1 - blur) * 0.5;

      // Empty the visible rack as bombs are released.
      for (let i = 0; i < model.bombs.length; i++) model.bombs[i].visible = i < snap.bombs;

      // Running lights: a slow strobe on the belly beacon, steady nav lights.
      const strobe = (Math.sin(this.clock * 6) > 0.7) ? 1.5 : 0.7;
      model.lights[3].scale.setScalar(strobe);

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
        }
      }
    }
    for (let i = this.smoke.length - 1; i >= 0; i--) {
      const s = this.smoke[i];
      s.ttl -= dt;
      const k = Math.max(0, s.ttl / s.life);
      s.mesh.position.addScaledVector(s.drift, dt);
      s.mesh.scale.setScalar(0.6 + (1 - k) * 1.6);
      (s.mesh.material as THREE.MeshBasicMaterial).opacity = 0.5 * k;
      if (s.ttl <= 0) {
        this.scene.remove(s.mesh);
        s.mesh.geometry.dispose();
        (s.mesh.material as THREE.Material).dispose();
        this.smoke.splice(i, 1);
      }
    }
  }
}
