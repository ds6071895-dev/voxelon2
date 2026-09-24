// The rowing boat — one model for your own boat and everyone else's, so what
// you ride is exactly what other players see you riding.
//
// The old boat was five brown boxes (a floor, two rails, a bow plank and a
// stern plank). This is a small clinker-built rowing boat:
//
//   - a real hull, lofted from stations: a pointed bow that rises (sheer),
//     a flat transom at the stern, a rockered keel, and four overlapping
//     strakes a side, each its own tone so the planking reads;
//   - a lighter inner skin with ribs, floorboards, two thwarts (the rower sits
//     on the aft one), a gunwale cap, a stem post, a keel strip and a painted
//     sheer stripe;
//   - two oars in bronze oarlocks that ROW — the stroke is driven by how fast
//     the boat is actually moving, so a remote boat rows exactly when it moves;
//   - a gentle bob, a pitch with speed and a roll into turns.
//
// Everything is baked into vertex colours with a directional key light (like
// the gun models) and merged into a handful of meshes. Geometry is cached and
// shared: never dispose it; detach the group instead.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** How far a seated rider's body drops so their hips sit on the thwart. */
export const BOAT_SIT_SINK = 0.44;

const MATERIAL = new THREE.MeshBasicMaterial({ vertexColors: true });

const LIGHT = new THREE.Vector3(0.35, 0.85, 0.4).normalize();
const AMBIENT = 0.62, DIRECT = 0.42, SHADOW = 0.18;

const WOOD = {
  strake: [0x8a5a32, 0x9b6a3c, 0x87572f, 0x9e6c3f],
  inner: 0xb88a57, innerDark: 0x9c7147,
  rib: 0x6e4526, floor: 0xa87a4a, floorDark: 0x8c6139,
  gunwale: 0x5a371d, keel: 0x3f2714, thwart: 0xc39461,
  stripe: 0x2f6f8f, stripeHi: 0xe8e0c8,
  oar: 0xd2ab74, oarDark: 0xa27b48, blade: 0xe6e0d0, bladeTip: 0x2f6f8f,
  bronze: 0xb07d3a, rope: 0xcdb98a,
};

/** Bake per-face shading into a colour attribute. Non-indexed geometry only. */
function shadeGeometry(geo: THREE.BufferGeometry, color: number): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo;
  g.deleteAttribute('uv');
  g.computeVertexNormals();
  const n = g.attributes.normal;
  const c = new THREE.Color(color);
  const out = new Float32Array(n.count * 3);
  for (let i = 0; i < n.count; i++) {
    const d = n.getX(i) * LIGHT.x + n.getY(i) * LIGHT.y + n.getZ(i) * LIGHT.z;
    const f = AMBIENT + DIRECT * Math.max(0, d) - SHADOW * Math.max(0, -d);
    out[i * 3] = c.r * f; out[i * 3 + 1] = c.g * f; out[i * 3 + 2] = c.b * f;
  }
  g.setAttribute('color', new THREE.BufferAttribute(out, 3));
  return g;
}

/** Collects shaded primitives and merges them to one geometry. */
class Builder {
  readonly geos: THREE.BufferGeometry[] = [];

  box(size: [number, number, number], pos: [number, number, number], color: number,
    rot: [number, number, number] = [0, 0, 0]): this {
    const g = new THREE.BoxGeometry(...size);
    g.applyMatrix4(new THREE.Matrix4().compose(
      new THREE.Vector3(...pos),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(...rot)),
      new THREE.Vector3(1, 1, 1)));
    this.geos.push(shadeGeometry(g, color));
    return this;
  }

  cyl(r0: number, r1: number, len: number, pos: [number, number, number], color: number,
    rot: [number, number, number] = [0, 0, 0], seg = 6): this {
    const g = new THREE.CylinderGeometry(r0, r1, len, seg);
    g.applyMatrix4(new THREE.Matrix4().compose(
      new THREE.Vector3(...pos),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(...rot)),
      new THREE.Vector3(1, 1, 1)));
    this.geos.push(shadeGeometry(g, color));
    return this;
  }

  /** Flat quad strip / triangle list given as world points. */
  tris(points: THREE.Vector3[], color: number): this {
    const g = new THREE.BufferGeometry();
    const arr = new Float32Array(points.length * 3);
    points.forEach((p, i) => { arr[i * 3] = p.x; arr[i * 3 + 1] = p.y; arr[i * 3 + 2] = p.z; });
    g.setAttribute('position', new THREE.BufferAttribute(arr, 3));
    this.geos.push(shadeGeometry(g, color));
    return this;
  }

  build(): THREE.BufferGeometry {
    return mergeGeometries(this.geos, false)!;
  }
}

// ── Hull loft ────────────────────────────────────────────────────────────────

const STERN_Z = 1.18, BOW_Z = -1.42;
const BEAM = 0.62;          // half-beam at the widest station
const STATIONS = 12, STRAKES = 4;

/** 0 at the transom … 1 at the stem. */
function stationZ(t: number): number { return STERN_Z + (BOW_Z - STERN_Z) * t; }
/** Half-beam: full amidships, 70% at the transom, 0 at the stem. */
function halfBeam(t: number): number {
  const widest = 0.38;
  if (t <= widest) return BEAM * (0.72 + 0.28 * Math.sin((t / widest) * Math.PI / 2));
  const u = (t - widest) / (1 - widest);
  return BEAM * Math.sqrt(Math.max(0, 1 - u * u)) * (1 - 0.08 * u);
}
/** Sheer (gunwale top) — sweeps up toward the bow. */
function sheerY(t: number): number { return 0.44 + 0.2 * t * t * t + 0.04 * (1 - t) * (1 - t); }
/** Keel bottom — rockered, lifting at both ends. */
function keelY(t: number): number { return -0.2 + 0.28 * Math.pow(Math.abs(t - 0.45) / 0.55, 2.4); }

/** Point s∈[0,1] around the half-section (keel → sheer) on side `side`. */
function sectionPoint(t: number, s: number, side: number, inset: number, out: THREE.Vector3): THREE.Vector3 {
  const b = Math.max(0, halfBeam(t) - inset);
  const k = keelY(t) + inset, h = sheerY(t);
  const a = s * Math.PI / 2;
  // Slightly flared, round-bilged section.
  const x = b * Math.pow(Math.sin(a), 0.75);
  const y = k + (h - k) * (1 - Math.cos(a));
  return out.set(side * x, y, stationZ(t));
}

function buildHull(): THREE.BufferGeometry {
  const b = new Builder();
  const p = (t: number, s: number, side: number, inset = 0): THREE.Vector3 =>
    sectionPoint(t, s, side, inset, new THREE.Vector3());
  const INSET = 0.05;

  for (const side of [-1, 1]) {
    for (let k = 0; k < STRAKES; k++) {
      const s0 = k / STRAKES, s1 = (k + 1) / STRAKES;
      const outer: THREE.Vector3[] = [], inner: THREE.Vector3[] = [];
      for (let i = 0; i < STATIONS; i++) {
        const t0 = i / STATIONS, t1 = (i + 1) / STATIONS;
        // Clinker lap: each strake's lower edge sits a hair outboard.
        const lap = 0.012 * (k > 0 ? 1 : 0);
        const a = p(t0, s0, side, -lap), bb = p(t1, s0, side, -lap);
        const c = p(t1, s1, side), d = p(t0, s1, side);
        // Winding so the outside faces out on both sides.
        if (side > 0) outer.push(a, bb, c, a, c, d);
        else outer.push(a, c, bb, a, d, c);
        const ai = p(t0, s0, side, INSET), bi = p(t1, s0, side, INSET);
        const ci = p(t1, s1, side, INSET), di = p(t0, s1, side, INSET);
        if (side > 0) inner.push(ai, ci, bi, ai, di, ci);
        else inner.push(ai, bi, ci, ai, ci, di);
      }
      b.tris(outer, WOOD.strake[k]);
      b.tris(inner, k % 2 ? WOOD.inner : WOOD.innerDark);
    }
    // Gunwale cap between outer and inner sheer.
    const cap: THREE.Vector3[] = [];
    for (let i = 0; i < STATIONS; i++) {
      const t0 = i / STATIONS, t1 = (i + 1) / STATIONS;
      const a = p(t0, 1, side), bb = p(t1, 1, side);
      const c = p(t1, 1, side, INSET), d = p(t0, 1, side, INSET);
      a.y += 0.02; bb.y += 0.02; c.y += 0.02; d.y += 0.02;
      if (side > 0) cap.push(a, bb, c, a, c, d); else cap.push(a, c, bb, a, d, c);
    }
    b.tris(cap, WOOD.gunwale);
    // Painted sheer stripe just under the gunwale, outside.
    const stripe: THREE.Vector3[] = [];
    for (let i = 0; i < STATIONS - 1; i++) {
      const t0 = i / STATIONS, t1 = (i + 1) / STATIONS;
      const a = p(t0, 0.9, side, -0.016), bb = p(t1, 0.9, side, -0.016);
      const c = p(t1, 0.99, side, -0.016), d = p(t0, 0.99, side, -0.016);
      if (side > 0) stripe.push(a, bb, c, a, c, d); else stripe.push(a, c, bb, a, d, c);
    }
    b.tris(stripe, WOOD.stripe);
  }

  // Transom: a flat stern panel (outer face + inner face).
  const tr: THREE.Vector3[] = [], trIn: THREE.Vector3[] = [];
  const N = 8;
  const centre = new THREE.Vector3(0, (keelY(0) + sheerY(0)) / 2, STERN_Z);
  for (const side of [-1, 1]) {
    for (let k = 0; k < N; k++) {
      const a = p(0, k / N, side), c = p(0, (k + 1) / N, side);
      if (side > 0) tr.push(centre, a, c); else tr.push(centre, c, a);
      const ai = a.clone(), ci = c.clone(), ce = centre.clone();
      ai.z -= 0.05; ci.z -= 0.05; ce.z -= 0.05;
      if (side > 0) trIn.push(ce, ci, ai); else trIn.push(ce, ai, ci);
    }
  }
  b.tris(tr, WOOD.strake[1]);
  b.tris(trIn, WOOD.inner);
  // Transom cap + a painted name board.
  b.box([halfBeam(0) * 2 + 0.04, 0.05, 0.08], [0, sheerY(0) + 0.02, STERN_Z - 0.02], WOOD.gunwale);
  b.box([0.5, 0.1, 0.012], [0, sheerY(0) - 0.1, STERN_Z + 0.008], WOOD.stripeHi);
  b.box([0.34, 0.03, 0.014], [0, sheerY(0) - 0.1, STERN_Z + 0.012], WOOD.stripe);

  // Stem post rising at the bow, and the keel strip underneath.
  const bowTop = sheerY(1);
  b.box([0.07, bowTop - keelY(1) + 0.12, 0.08], [0, (bowTop + keelY(1)) / 2 + 0.05, BOW_Z - 0.01], WOOD.keel, [0.12, 0, 0]);
  for (let i = 0; i < STATIONS; i++) {
    const t0 = i / STATIONS, t1 = (i + 1) / STATIONS;
    const z0 = stationZ(t0), z1 = stationZ(t1);
    const y0 = keelY(t0), y1 = keelY(t1);
    const len = Math.hypot(z1 - z0, y1 - y0);
    b.box([0.07, 0.06, len + 0.02], [0, (y0 + y1) / 2 - 0.025, (z0 + z1) / 2], WOOD.keel,
      [Math.atan2(y1 - y0, z0 - z1), 0, 0]);
  }

  // Ribs: frames following the inner skin every other station.
  for (let i = 1; i < STATIONS - 1; i += 1) {
    const t = i / STATIONS;
    for (const side of [-1, 1]) {
      for (let k = 0; k < 4; k++) {
        const a = p(t, k / 4, side, 0.06), c = p(t, (k + 1) / 4, side, 0.06);
        const mid = a.clone().add(c).multiplyScalar(0.5);
        const len = a.distanceTo(c);
        const ang = Math.atan2(c.y - a.y, c.x - a.x);
        b.box([len + 0.02, 0.035, 0.045], [mid.x, mid.y, mid.z], WOOD.rib, [0, 0, ang]);
      }
    }
  }

  // Floorboards (bottom boards) laid fore-and-aft.
  const floorY = keelY(0.45) + 0.12;
  for (let j = -2; j <= 2; j++) {
    b.box([0.1, 0.03, 1.6 - Math.abs(j) * 0.18], [j * 0.115, floorY, 0.02], j % 2 ? WOOD.floorDark : WOOD.floor);
  }

  // Thwarts: the rower's seat (aft) and a forward one, with knees.
  const thwarts: [number, number][] = [[0.05, 0.25], [-0.98, 0.34]];
  for (const [z, y] of thwarts) {
    const t = (STERN_Z - z) / (STERN_Z - BOW_Z);
    const w = (halfBeam(t) - 0.05) * 2 * 0.98;
    b.box([w, 0.045, 0.24], [0, y, z], WOOD.thwart);
    b.box([w, 0.02, 0.03], [0, y - 0.03, z - 0.1], WOOD.innerDark);
    for (const side of [-1, 1]) b.box([0.05, 0.12, 0.12], [side * (w / 2 - 0.03), y + 0.05, z], WOOD.rib);
  }
  // Stern sheets: a bench across the transom.
  b.box([halfBeam(0.06) * 2 - 0.14, 0.04, 0.26], [0, 0.26, STERN_Z - 0.2], WOOD.thwart);
  // Bow painter: a coil of rope on the forward deck + a cleat.
  b.box([0.2, 0.03, 0.22], [0, sheerY(0.88) - 0.04, stationZ(0.88)], WOOD.gunwale);
  b.cyl(0.07, 0.07, 0.035, [0, sheerY(0.88) - 0.005, stationZ(0.88)], WOOD.rope, [0, 0, 0], 8);
  b.box([0.14, 0.03, 0.04], [0, sheerY(0.88) + 0.03, stationZ(0.88) + 0.08], WOOD.bronze);
  return b.build();
}

// Oarlock position (right side; the left mirrors it).
const OARLOCK: [number, number, number] = [0, 0, -0.18];
function oarlockPos(side: number): THREE.Vector3 {
  const t = (STERN_Z - OARLOCK[2]) / (STERN_Z - BOW_Z);
  return new THREE.Vector3(side * (halfBeam(t) - 0.01), sheerY(t) + 0.06, OARLOCK[2]);
}

function buildOarlocks(): THREE.BufferGeometry {
  const b = new Builder();
  for (const side of [-1, 1]) {
    const o = oarlockPos(side);
    b.box([0.08, 0.06, 0.12], [o.x, o.y - 0.05, o.z], WOOD.gunwale);
    b.box([0.025, 0.1, 0.025], [o.x, o.y + 0.02, o.z - 0.035], WOOD.bronze);
    b.box([0.025, 0.1, 0.025], [o.x, o.y + 0.02, o.z + 0.035], WOOD.bronze);
  }
  return b.build();
}

/** One oar lying along +x (outboard) from its pivot at the oarlock. */
function buildOar(side: number): THREE.BufferGeometry {
  const b = new Builder();
  const s = side;
  const INB = 0.36, OUTB = 1.35;
  // Handle, loom (thicker by the lock), shaft, blade.
  b.cyl(0.028, 0.028, 0.16, [-s * (INB - 0.02), 0, 0], WOOD.oarDark, [0, 0, Math.PI / 2]);
  b.cyl(0.036, 0.036, INB - 0.1, [-s * (INB - 0.14) / 2, 0, 0], WOOD.oar, [0, 0, Math.PI / 2]);
  b.cyl(0.042, 0.042, 0.12, [0, 0, 0], WOOD.rope, [0, 0, Math.PI / 2]); // leather at the lock
  b.cyl(0.03, 0.034, OUTB - 0.35, [s * (OUTB - 0.35) / 2, 0, 0], WOOD.oar, [0, 0, Math.PI / 2]);
  b.box([0.42, 0.025, 0.17], [s * (OUTB - 0.2), 0, 0], WOOD.blade);
  b.box([0.1, 0.028, 0.175], [s * (OUTB - 0.02), 0, 0], WOOD.bladeTip);
  b.box([0.18, 0.03, 0.1], [s * (OUTB - 0.46), 0, 0], WOOD.oar);
  return b.build();
}

let cache: { hull: THREE.BufferGeometry; locks: THREE.BufferGeometry; oar: [THREE.BufferGeometry, THREE.BufferGeometry] } | null = null;
function geometries(): NonNullable<typeof cache> {
  if (!cache) cache = { hull: buildHull(), locks: buildOarlocks(), oar: [buildOar(-1), buildOar(1)] };
  return cache;
}

// ── Rig ─────────────────────────────────────────────────────────────────────

export interface BoatRig {
  /** Scene-level root: place at the rider's feet, yaw with the rider. */
  group: THREE.Group;
  /** Bobs, pitches and rolls inside `group`. */
  hull: THREE.Group;
  oars: [THREE.Group, THREE.Group];
  /** Stroke clock (radians). */
  phase: number;
  /** Smoothed stroke strength 0..1 (0 = oars resting). */
  stroke: number;
  roll: number;
  time: number;
  prevYaw: number;
  /** Vertical bob this frame — add it to a seated rider so they ride with it. */
  bobY: number;
  /** Sweep of the oars this frame, -1..1 (for the rower's arms). */
  sweep: number;
}

export function createBoatRig(): BoatRig {
  const g = geometries();
  const group = new THREE.Group();
  group.name = 'boat';
  const hull = new THREE.Group();
  hull.add(new THREE.Mesh(g.hull, MATERIAL), new THREE.Mesh(g.locks, MATERIAL));
  const oars: THREE.Group[] = [];
  for (const [i, side] of [[0, -1], [1, 1]] as const) {
    const pivot = new THREE.Group();
    pivot.position.copy(oarlockPos(side));
    pivot.add(new THREE.Mesh(g.oar[i], MATERIAL));
    hull.add(pivot);
    oars.push(pivot);
  }
  group.add(hull);
  group.visible = false;
  return {
    group, hull, oars: [oars[0], oars[1]], phase: 0, stroke: 0, roll: 0,
    time: Math.random() * 10, prevYaw: 0, bobY: 0, sweep: 0,
  };
}

/** Place and animate the boat. `forwardSpeed` is the boat's speed along its
 *  heading (negative when backing), which drives the rowing stroke. */
export function updateBoatRig(
  rig: BoatRig, dt: number,
  x: number, y: number, z: number, yaw: number, forwardSpeed: number
): void {
  rig.time += dt;
  rig.group.position.set(x, y, z);
  rig.group.rotation.y = yaw;
  let dYaw = yaw - rig.prevYaw;
  dYaw = Math.atan2(Math.sin(dYaw), Math.cos(dYaw));
  rig.prevYaw = yaw;
  const turnRate = dYaw / Math.max(dt, 1e-4);

  // Rowing: stroke rate rises with speed; oars settle level at rest.
  const pace = Math.min(1, Math.abs(forwardSpeed) / 6);
  rig.stroke += ((Math.abs(forwardSpeed) > 0.6 ? 1 : 0) - rig.stroke) * Math.min(1, dt * 4);
  rig.phase += dt * (3.2 + pace * 2.6) * Math.sign(forwardSpeed || 1) * (rig.stroke > 0.02 ? 1 : 0);
  const sweep = Math.cos(rig.phase) * rig.stroke;
  const inWater = Math.sin(rig.phase);
  rig.sweep = sweep;
  for (const [i, side] of [[0, -1], [1, 1]] as const) {
    const oar = rig.oars[i];
    // Sweep fore/aft about the lock; dip the blade on the drive, lift it on
    // the recovery; at rest the blades trail just above the water.
    oar.rotation.y = side * sweep * 0.55;
    const drop = 0.34 + rig.stroke * (inWater > 0 ? 0.16 : 0.12) * inWater;
    oar.rotation.z = -side * drop;
    // Feather: blade flat on the recovery, square in the water.
    oar.children[0].rotation.x = rig.stroke * (inWater > 0 ? Math.PI / 2 : 0.2);
  }

  // Bob, pitch with speed, roll into turns.
  const rollTarget = THREE.MathUtils.clamp(-turnRate * 0.05, -0.16, 0.16);
  rig.roll += (rollTarget - rig.roll) * Math.min(1, dt * 3);
  rig.bobY = Math.sin(rig.time * 1.9) * 0.025 + Math.sin(rig.time * 3.1) * 0.01 +
    rig.stroke * Math.max(0, inWater) * 0.015;
  rig.hull.position.y = rig.bobY;
  rig.hull.rotation.x = Math.sin(rig.time * 1.3) * 0.02 + pace * 0.05 * Math.sign(forwardSpeed);
  rig.hull.rotation.z = rig.roll + Math.sin(rig.time * 1.6 + 1) * 0.025;
}

/** The rower's arm swing (rotation.x) to follow the oar handles. */
export function boatArmPose(rig: BoatRig): number {
  return 0.8 - rig.sweep * 0.35;
}

/** Detach from the scene. Geometry and material are shared — never disposed. */
export function removeBoatRig(rig: BoatRig): void {
  rig.group.parent?.remove(rig.group);
}
