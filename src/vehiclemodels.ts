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
  tier: number;
}

/**
 * The airframe. +Z is the nose.
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
  const lights: THREE.Mesh[] = [];

  // --- Fuselage ---
  box(hull, OLIVE, 1.25, 0.9, 2.1, 0, 0, 0);
  box(hull, OLIVE_LIGHT, 1.28, 0.16, 2.0, 0, 0.42, 0);       // spine highlight
  box(hull, OLIVE_DARK, 1.18, 0.2, 1.9, 0, -0.44, 0);        // belly
  // Nose — longer and more pointed at higher marks.
  const noseLen = mark === 1 ? 0.5 : mark === 2 ? 0.75 : 0.9;
  const nose = round(hull, new THREE.CylinderGeometry(0.18, 0.58, noseLen, 10), OLIVE,
    0, -0.02, 1.05 + noseLen / 2);
  nose.rotation.x = Math.PI / 2;
  // Canopy: two angled glass panels.
  const canopy = box(hull, GLASS, 1.0, 0.5, 0.85, 0, 0.22, 0.72, GLASS_MAT);
  canopy.rotation.x = -0.22;
  box(hull, OLIVE_DARK, 1.04, 0.05, 0.05, 0, 0.46, 0.34);    // canopy frame
  // Side doors (open — you can see the occupants).
  box(hull, OLIVE_DARK, 0.06, 0.62, 0.8, 0.63, -0.02, -0.1);
  box(hull, OLIVE_DARK, 0.06, 0.62, 0.8, -0.63, -0.02, -0.1);

  // --- Armoured cheeks + chin turret (Mk III) ---
  if (mark >= 3) {
    box(hull, STEEL_DARK, 0.2, 0.5, 0.9, 0.68, -0.05, 0.5);
    box(hull, STEEL_DARK, 0.2, 0.5, 0.9, -0.68, -0.05, 0.5);
    const chin = round(hull, new THREE.SphereGeometry(0.22, 10, 8), STEEL_DARK, 0, -0.42, 1.15);
    round(chin, new THREE.CylinderGeometry(0.05, 0.05, 0.34, 8), NEAR_BLACK, 0, -0.02, 0.2)
      .rotation.x = Math.PI / 2;
  }

  // --- Engine deck + intakes ---
  box(hull, OLIVE_DARK, 0.85, 0.34, 0.9, 0, 0.55, -0.25);
  if (mark >= 2) {
    round(hull, new THREE.CylinderGeometry(0.14, 0.14, 0.4, 8), NEAR_BLACK, 0.34, 0.6, 0.24)
      .rotation.x = Math.PI / 2;
    round(hull, new THREE.CylinderGeometry(0.14, 0.14, 0.4, 8), NEAR_BLACK, -0.34, 0.6, 0.24)
      .rotation.x = Math.PI / 2;
  }
  // Exhausts (one at Mk I/II, twin at Mk III), canted out and back.
  const exhausts = mark >= 3 ? [-0.3, 0.3] : [0];
  for (const ex of exhausts) {
    const pipe = round(hull, new THREE.CylinderGeometry(0.12, 0.15, 0.42, 8), STEEL_DARK,
      ex, 0.5, -0.78);
    pipe.rotation.x = Math.PI / 2 - 0.25;
  }

  // --- Tail boom + fins ---
  const boom = round(hull, new THREE.CylinderGeometry(0.11, 0.2, 2.0, 8), OLIVE, 0, 0.16, -1.6);
  boom.rotation.x = Math.PI / 2;
  box(hull, OLIVE_DARK, 0.08, 0.72, 0.42, 0, 0.5, -2.42);       // vertical fin
  box(hull, OLIVE_LIGHT, 0.72, 0.06, 0.3, 0, 0.1, -2.2);        // horizontal stabiliser

  // --- Skid landing gear ---
  for (const side of [-1, 1]) {
    box(hull, STEEL_DARK, 0.08, 0.08, 1.5, side * 0.52, -0.86, 0.05);
    box(hull, STEEL_DARK, 0.07, 0.42, 0.07, side * 0.5, -0.66, 0.5);
    box(hull, STEEL_DARK, 0.07, 0.42, 0.07, side * 0.5, -0.66, -0.42);
  }

  // --- Stub wings + bomb rack ---
  const bombs: THREE.Object3D[] = [];
  const hardpoints = stats.bombs;
  if (mark >= 2) {
    box(hull, OLIVE_DARK, 1.9, 0.1, 0.5, 0, -0.24, -0.05);      // stub wing
  }
  for (let i = 0; i < hardpoints; i++) {
    // Alternate left/right, walking outward, so a rack of 5 stays symmetric.
    const pair = Math.floor(i / 2);
    const side = i % 2 === 0 ? -1 : 1;
    const bx = hardpoints === 1 ? 0 : side * (0.42 + pair * 0.34);
    const bomb = new THREE.Group();
    bomb.position.set(bx, -0.58, -0.05 + (i === hardpoints - 1 && hardpoints % 2 ? 0.25 : 0));
    round(bomb, new THREE.CylinderGeometry(0.09, 0.09, 0.44, 8), STEEL_DARK, 0, 0, 0)
      .rotation.x = Math.PI / 2;
    round(bomb, new THREE.ConeGeometry(0.09, 0.18, 8), STEEL, 0, 0, 0.3).rotation.x = Math.PI / 2;
    box(bomb, AMBER, 0.19, 0.02, 0.05, 0, 0, 0.02);
    for (const f of [0, 1, 2, 3]) {
      const fin = box(bomb, STEEL_DARK, 0.02, 0.14, 0.12, 0, 0, -0.24);
      fin.rotation.z = (f / 4) * Math.PI * 2;
    }
    hull.add(bomb);
    bombs.push(bomb);
  }

  // --- Faction markings: a band on the tail and a roundel on the nose ---
  box(hull, markingHex, 0.09, 0.4, 0.16, 0, 0.5, -2.42);
  const roundel = round(hull, new THREE.CylinderGeometry(0.16, 0.16, 0.02, 12), markingHex,
    0.63, 0.05, 0.2, VEHICLE_MAT, 0.15);
  roundel.rotation.z = Math.PI / 2;
  const roundel2 = round(hull, new THREE.CylinderGeometry(0.16, 0.16, 0.02, 12), markingHex,
    -0.63, 0.05, 0.2, VEHICLE_MAT, 0.15);
  roundel2.rotation.z = Math.PI / 2;

  // --- Rotors ---
  const mast = round(hull, new THREE.CylinderGeometry(0.08, 0.1, 0.4, 8), STEEL_DARK, 0, 0.86, -0.2);
  void mast;
  const mainRotor = new THREE.Group();
  mainRotor.position.set(0, 1.06, -0.2);
  round(mainRotor, new THREE.CylinderGeometry(0.14, 0.14, 0.14, 10), STEEL, 0, 0, 0);
  const blades = mark >= 3 ? 5 : 4;
  for (let i = 0; i < blades; i++) {
    const blade = new THREE.Group();
    blade.rotation.y = (i / blades) * Math.PI * 2;
    const b = box(blade, 0x2f3238, 0.16, 0.035, 3.5, 0, 0, 1.72, ROTOR_MAT);
    b.rotation.x = 0.06;   // a touch of pitch, so it reads as an aerofoil
    box(blade, STEEL_DARK, 0.1, 0.05, 0.3, 0, 0, 0.22);   // blade root
    mainRotor.add(blade);
  }
  hull.add(mainRotor);

  const tailRotor = new THREE.Group();
  tailRotor.position.set(0.18, 0.5, -2.42);
  round(tailRotor, new THREE.CylinderGeometry(0.06, 0.06, 0.1, 8), STEEL, 0, 0, 0)
    .rotation.z = Math.PI / 2;
  for (let i = 0; i < 3; i++) {
    const blade = new THREE.Group();
    blade.rotation.x = (i / 3) * Math.PI * 2;
    box(blade, 0x2f3238, 0.03, 0.9, 0.1, 0, 0.45, 0, ROTOR_MAT);
    tailRotor.add(blade);
  }
  hull.add(tailRotor);

  // --- Running lights: red port, green starboard, white tail, red beacon ---
  lights.push(round(hull, new THREE.SphereGeometry(0.06, 8, 6), 0xff4a3a, -0.66, 0.05, 0.55, GLOW_MAT, 0.8));
  lights.push(round(hull, new THREE.SphereGeometry(0.06, 8, 6), 0x46e06a, 0.66, 0.05, 0.55, GLOW_MAT, 0.8));
  lights.push(round(hull, new THREE.SphereGeometry(0.05, 8, 6), 0xffffff, 0, 0.2, -2.6, GLOW_MAT, 0.9));
  lights.push(round(hull, new THREE.SphereGeometry(0.06, 8, 6), 0xff3a2a, 0, -0.56, -0.6, GLOW_MAT, 0.9));

  // --- Seats ---
  const seats = { pilot: new THREE.Group(), passenger: new THREE.Group() };
  for (const key of ['pilot', 'passenger'] as const) {
    const o = SEAT_OFFSETS[key];
    const seat = seats[key];
    seat.position.set(o.x, o.y - 0.18, o.z);
    // The seat furniture itself, so an empty seat still looks like a cockpit.
    box(seat, OLIVE_DARK, 0.42, 0.1, 0.42, 0, -0.2, 0);
    box(seat, OLIVE_DARK, 0.42, 0.5, 0.1, 0, 0.05, -0.2);
    hull.add(seat);
  }

  return { group, hull, mainRotor, tailRotor, seats, bombs, lights, tier };
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

interface HeliEntry {
  model: HelicopterModel;
  snap: HelicopterSnapshot;
  from: THREE.Vector3;
  to: THREE.Vector3;
  blend: number;
  rotorPhase: number;
  smokeAccum: number;
  /** Avatars currently parented into the seats, so they can be detached. */
  riders: { pilot: THREE.Object3D | null; passenger: THREE.Object3D | null };
}

interface Smoke { mesh: THREE.Mesh; ttl: number; life: number; drift: THREE.Vector3 }

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
          from: new THREE.Vector3(snap.x, snap.y, snap.z),
          to: new THREE.Vector3(snap.x, snap.y, snap.z),
          blend: 1, rotorPhase: 0, smokeAccum: 0,
          riders: { pilot: null, passenger: null },
        };
        this.helis.set(snap.id, e);
      }
      e.from.copy(e.model.group.position);
      e.to.set(snap.x, snap.y, snap.z);
      e.blend = 0;
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
      e.blend = Math.min(1, e.blend + dt * 10);
      model.group.position.lerpVectors(e.from, e.to, e.blend);
      // Attitude comes straight from the server flight state.
      model.hull.rotation.order = 'YXZ';
      model.hull.rotation.y = snap.yaw;
      model.hull.rotation.x = snap.pitch;
      model.hull.rotation.z = snap.roll;

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
