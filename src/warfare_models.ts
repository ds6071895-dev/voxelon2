// Procedural 3D models for the WARFARE COMMAND strategic layer: tactical
// silos, interceptor batteries, and the missiles themselves.
//
// Same rules as machinemodels.ts/turretmodels.ts — everything is generated in
// code (no external assets), and every mesh is UNLIT with baked per-face /
// per-vertex shading, because the world has no light sources. The extra work
// here is in the shading helpers: boxes get the classic six-face ramp, and
// round parts get an axial gradient plus a fake rim highlight, so a missile
// body reads as a cylinder rather than a flat grey pill.
//
// Everything is CACHED by (kind, tier): a silo model is expensive to build and
// there can be a lot of them, so geometry is created once per configuration and
// cloned per instance.

import * as THREE from 'three';
import type { BatteryState, MissileSnapshot, SiloState } from './strategic';
import { arcAt } from './strategic';
import { batteryStats, siloStats } from './warfare';

// --- Shading toolkit ----------------------------------------------------------

/** Per-face shading ramp (right/left/top/bottom/front/back), matching the
 *  machine + avatar models so the whole world reads as one lighting model. */
const FACE_SHADE = [0.80, 0.62, 1.0, 0.46, 0.90, 0.70];

export const WARFARE_MAT = new THREE.MeshBasicMaterial({ vertexColors: true });
/** Additive material for flames, glows and running lights. */
export const GLOW_MAT = new THREE.MeshBasicMaterial({
  vertexColors: true, transparent: true, opacity: 0.9,
  blending: THREE.AdditiveBlending, depthWrite: false,
});

const STEEL = 0x8e96a4;
const STEEL_DARK = 0x454a55;
const STEEL_LIGHT = 0xc4ccd8;
const HULL = 0xb9c2ce;
const HULL_DARK = 0x6c7684;
const WARHEAD_RED = 0xc9483c;
const CYAN = 0x5ce2ec;
const CYAN_DIM = 0x2a8896;
const AMBER = 0xe6a83a;
const NEAR_BLACK = 0x22262e;

/** How far a `flash` shell expands over its life. Callers quote the radius they
 *  want it to REACH, and the geometry is seeded at radius/FLASH_PEAK. */
const FLASH_PEAK = 2.1;

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

/**
 * Shade a round mesh from its own vertex positions: brighter on the +X/+Y side
 * (a fixed key light up and to the right), plus a soft rim term so silhouettes
 * do not go flat. This is what makes an unlit cylinder still look round.
 */
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
    const rim = Math.pow(1 - Math.abs(n.y), 3) * 0.18;
    const s = Math.min(1.35, 0.42 + lambert * 0.72 + rim + boost);
    colors[i * 3] = color.r * s;
    colors[i * 3 + 1] = color.g * s;
    colors[i * 3 + 2] = color.b * s;
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  return geo;
}

function box(
  parent: THREE.Object3D, hex: number, w: number, h: number, d: number,
  x: number, y: number, z: number, mat: THREE.Material = WARFARE_MAT,
): THREE.Mesh {
  const mesh = new THREE.Mesh(paintFaces(new THREE.BoxGeometry(w, h, d), hex), mat);
  mesh.position.set(x, y, z);
  parent.add(mesh);
  return mesh;
}

function round(
  parent: THREE.Object3D, geo: THREE.BufferGeometry, hex: number,
  x: number, y: number, z: number, mat: THREE.Material = WARFARE_MAT, boost = 0,
): THREE.Mesh {
  const mesh = new THREE.Mesh(paintRound(geo, hex, boost), mat);
  mesh.position.set(x, y, z);
  parent.add(mesh);
  return mesh;
}

/** Faction tint for stripes and markings (falls back to a neutral steel). */
export function factionTint(css: string | undefined): number {
  if (!css) return 0xa8b2c0;
  const c = new THREE.Color();
  try { c.set(css); } catch { return 0xa8b2c0; }
  return c.getHex();
}

// --- The missile ---------------------------------------------------------------

export interface MissileModel {
  group: THREE.Group;
  /** The airframe, pitched along the trajectory. */
  body: THREE.Group;
  flame: THREE.Mesh;
  flameCore: THREE.Mesh;
  stripe: THREE.Mesh;
}

/**
 * A finned low-poly missile: ogive nose, ribbed body, a faction-coloured
 * guidance stripe, four swept tail fins, and a two-layer additive exhaust
 * flame (wide orange plume + a hot white core) that flickers.
 *
 * Interceptors are built from the same code at 0.6 scale with a cyan stripe,
 * so a defender's shot is instantly readable as "one of ours".
 */
export function buildMissileModel(stripeHex: number, interceptor = false): MissileModel {
  const group = new THREE.Group();
  const body = new THREE.Group();
  group.add(body);
  const s = interceptor ? 0.6 : 1;

  // Nose cone (ogive-ish: a cone stacked on a short taper).
  round(body, new THREE.ConeGeometry(0.22 * s, 0.62 * s, 12), HULL_DARK, 0, 1.5 * s, 0, WARFARE_MAT, 0.1)
    .rotation.x = 0;
  round(body, new THREE.CylinderGeometry(0.22 * s, 0.26 * s, 0.3 * s, 12), HULL, 0, 1.06 * s, 0);
  // Main body.
  round(body, new THREE.CylinderGeometry(0.26 * s, 0.26 * s, 1.7 * s, 14), HULL, 0, 0.06 * s, 0);
  // Structural ribs — three thin darker bands break up the tube.
  for (const y of [0.62, 0.06, -0.5]) {
    round(body, new THREE.CylinderGeometry(0.275 * s, 0.275 * s, 0.07 * s, 14), HULL_DARK, 0, y * s, 0);
  }
  // Faction guidance stripe.
  const stripe = round(body,
    new THREE.CylinderGeometry(0.278 * s, 0.278 * s, 0.26 * s, 14), stripeHex, 0, 0.34 * s, 0,
    WARFARE_MAT, 0.16);
  // Warhead band (strike only — an interceptor carries no warhead).
  if (!interceptor) {
    round(body, new THREE.CylinderGeometry(0.268 * s, 0.268 * s, 0.18 * s, 14), WARHEAD_RED, 0, 0.86 * s, 0,
      WARFARE_MAT, 0.12);
  }
  // Motor bell.
  round(body, new THREE.CylinderGeometry(0.2 * s, 0.28 * s, 0.24 * s, 12), NEAR_BLACK, 0, -0.93 * s, 0);

  // Four swept tail fins.
  for (let i = 0; i < 4; i++) {
    const fin = new THREE.Group();
    fin.rotation.y = (i / 4) * Math.PI * 2;
    const blade = box(fin, STEEL, 0.045 * s, 0.5 * s, 0.34 * s, 0, -0.66 * s, 0.34 * s);
    blade.rotation.x = -0.22;
    // A canard up front makes it read as guided rather than a dumb rocket.
    box(fin, STEEL_DARK, 0.04 * s, 0.22 * s, 0.16 * s, 0, 0.82 * s, 0.28 * s);
    body.add(fin);
  }

  // Exhaust: a wide plume and a hot core, both additive.
  const flame = new THREE.Mesh(
    paintRound(new THREE.ConeGeometry(0.24 * s, 1.5 * s, 10), 0xff8a2c, 0.5), GLOW_MAT);
  flame.position.y = -1.85 * s;
  flame.rotation.x = Math.PI;   // point the cone DOWN the tail
  body.add(flame);
  const flameCore = new THREE.Mesh(
    paintRound(new THREE.ConeGeometry(0.12 * s, 0.85 * s, 8), 0xfff0c0, 0.9), GLOW_MAT);
  flameCore.position.y = -1.5 * s;
  flameCore.rotation.x = Math.PI;
  body.add(flameCore);

  return { group, body, flame, flameCore, stripe };
}

// --- The tactical silo ----------------------------------------------------------

export interface SiloModel {
  group: THREE.Group;
  /** Two hatch leaves that swing open on launch. */
  hatchA: THREE.Object3D;
  hatchB: THREE.Object3D;
  /** The loaded missile that rides up out of the tube. */
  loaded: THREE.Object3D;
  /** Targeting antenna — spins slowly while the silo is armed. */
  antenna: THREE.Object3D;
  /** Status lamps (green when loaded, amber while cycling). */
  lamps: THREE.Mesh[];
}

/**
 * A 2×2 launch pad. Tiers are visually legible, not just numerically bigger:
 *
 *   Mk I–II  bare reinforced base + tube + a small antenna
 *   Mk III+  bolted armour plates around the collar and a magazine housing
 *   Mk V+    a second magazine drum and stronger radar lighting
 *   Mk VI    full armour skirt, four masts, and a bright command beacon
 */
export function buildSiloModel(tier: number, stripeHex: number): SiloModel {
  const group = new THREE.Group();
  const stats = siloStats(tier);
  const lamps: THREE.Mesh[] = [];

  // --- Base slab covering the 2×2 footprint (local origin at its centre) ---
  box(group, STEEL_DARK, 2.0, 0.24, 2.0, 0, 0.12, 0);
  box(group, STEEL, 1.86, 0.1, 1.86, 0, 0.29, 0);
  // Corner blast deflectors.
  for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const wedge = box(group, STEEL_DARK, 0.34, 0.42, 0.34, dx * 0.78, 0.42, dz * 0.78);
    wedge.rotation.y = Math.PI / 4;
  }
  // Hazard chevrons on the deck.
  for (let i = -2; i <= 2; i++) {
    box(group, i % 2 ? AMBER : NEAR_BLACK, 0.3, 0.02, 1.6, i * 0.32, 0.35, 0);
  }

  // --- The tube ---
  round(group, new THREE.CylinderGeometry(0.52, 0.58, 1.1, 14), STEEL_DARK, 0, 0.85, 0);
  round(group, new THREE.CylinderGeometry(0.44, 0.44, 0.9, 14), NEAR_BLACK, 0, 1.3, 0);
  // Collar.
  round(group, new THREE.CylinderGeometry(0.62, 0.62, 0.14, 14), STEEL, 0, 1.42, 0);

  // --- Armour plates (Mk III+) ---
  if (tier >= 3) {
    for (let i = 0; i < 6; i++) {
      const plate = new THREE.Group();
      plate.rotation.y = (i / 6) * Math.PI * 2;
      box(plate, STEEL_LIGHT, 0.34, 0.8, 0.1, 0, 0.9, 0.62);
      box(plate, STEEL_DARK, 0.06, 0.8, 0.06, 0.17, 0.9, 0.64);
      box(plate, STEEL_DARK, 0.06, 0.8, 0.06, -0.17, 0.9, 0.64);
      group.add(plate);
    }
  }
  // --- Magazine housing (Mk III+ = one drum, Mk V+ = two) ---
  const drums = tier >= 5 ? 2 : tier >= 3 ? 1 : 0;
  for (let d = 0; d < drums; d++) {
    const side = d === 0 ? -1 : 1;
    round(group, new THREE.CylinderGeometry(0.3, 0.3, 0.78, 12), STEEL, side * 0.84, 0.75, -0.62);
    round(group, new THREE.CylinderGeometry(0.32, 0.32, 0.08, 12), STEEL_DARK, side * 0.84, 1.14, -0.62);
    // Visible spare rounds in the drum.
    for (let r = 0; r < 3; r++) {
      const a = (r / 3) * Math.PI * 2;
      round(group, new THREE.CylinderGeometry(0.07, 0.07, 0.62, 8), HULL,
        side * 0.84 + Math.cos(a) * 0.16, 0.75, -0.62 + Math.sin(a) * 0.16);
    }
  }
  // --- Armour skirt (Mk VI) ---
  if (tier >= 6) {
    for (let i = 0; i < 8; i++) {
      const skirt = new THREE.Group();
      skirt.rotation.y = (i / 8) * Math.PI * 2;
      const p = box(skirt, STEEL_LIGHT, 0.44, 0.5, 0.08, 0, 0.5, 0.95);
      p.rotation.x = 0.28;
      group.add(skirt);
    }
  }

  // --- Hatch: two leaves hinged on opposite sides ---
  const hatchA = new THREE.Group();
  hatchA.position.set(0, 1.5, 0.02);
  box(hatchA, STEEL_LIGHT, 1.0, 0.09, 0.5, 0, 0, 0.26);
  box(hatchA, AMBER, 0.9, 0.03, 0.08, 0, 0.06, 0.26);
  group.add(hatchA);
  const hatchB = new THREE.Group();
  hatchB.position.set(0, 1.5, -0.02);
  box(hatchB, STEEL_LIGHT, 1.0, 0.09, 0.5, 0, 0, -0.26);
  box(hatchB, AMBER, 0.9, 0.03, 0.08, 0, 0.06, -0.26);
  group.add(hatchB);

  // --- The loaded missile, visible inside the tube ---
  const loaded = new THREE.Group();
  const inner = buildMissileModel(stripeHex);
  inner.flame.visible = false;
  inner.flameCore.visible = false;
  inner.group.scale.setScalar(0.62);
  loaded.add(inner.group);
  loaded.position.y = 0.95;
  group.add(loaded);

  // --- Targeting antenna ---
  const antenna = new THREE.Group();
  antenna.position.set(0.72, 1.5, 0.72);
  round(antenna, new THREE.CylinderGeometry(0.05, 0.07, 0.7, 8), STEEL, 0, 0.35, 0);
  const dish = round(antenna, new THREE.CylinderGeometry(0.02, 0.26, 0.16, 12), STEEL_LIGHT, 0, 0.76, 0);
  dish.rotation.x = -0.5;
  const beacon = round(antenna, new THREE.SphereGeometry(0.07, 8, 6),
    tier >= 4 ? CYAN : CYAN_DIM, 0, 0.9, 0, GLOW_MAT, 0.6);
  lamps.push(beacon);
  group.add(antenna);

  // Extra masts at the top tiers — "stronger radar lighting".
  if (tier >= 4) {
    for (const [mx, mz] of [[-0.72, 0.72], [0.72, -0.72], [-0.72, -0.72]] as [number, number][]) {
      const mast = new THREE.Group();
      mast.position.set(mx, 1.5, mz);
      round(mast, new THREE.CylinderGeometry(0.035, 0.05, 0.5 + (tier >= 6 ? 0.3 : 0), 6), STEEL, 0, 0.3, 0);
      const lamp = round(mast, new THREE.SphereGeometry(0.055, 8, 6), CYAN, 0, 0.62, 0, GLOW_MAT, 0.6);
      lamps.push(lamp);
      group.add(mast);
    }
  }

  // Magazine readout: one lamp per loaded round the silo CAN hold.
  for (let i = 0; i < stats.magazine; i++) {
    const l = round(group, new THREE.BoxGeometry(0.08, 0.05, 0.08), 0x39d16a,
      -0.28 + i * 0.28, 0.42, 0.9, GLOW_MAT, 0.5);
    lamps.push(l);
  }

  return { group, hatchA, hatchB, loaded, antenna, lamps };
}

// --- The interceptor battery ------------------------------------------------------

export interface BatteryModel {
  group: THREE.Group;
  /** Continuously rotating radar dish. */
  dish: THREE.Object3D;
  /** The launch rack, which elevates toward its track. */
  rack: THREE.Object3D;
  /** One visible interceptor per loaded round. */
  rounds: THREE.Object3D[];
  lamps: THREE.Mesh[];
}

export function buildBatteryModel(tier: number, stripeHex: number): BatteryModel {
  const group = new THREE.Group();
  const stats = batteryStats(tier);
  const lamps: THREE.Mesh[] = [];

  // Base + turntable.
  box(group, STEEL_DARK, 1.1, 0.2, 1.1, 0, 0.1, 0);
  round(group, new THREE.CylinderGeometry(0.42, 0.5, 0.24, 12), STEEL, 0, 0.32, 0);
  // Outriggers give it a planted, emplaced look.
  for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const leg = box(group, STEEL_DARK, 0.16, 0.12, 0.5, dx * 0.42, 0.1, dz * 0.42);
    leg.rotation.y = dx * dz > 0 ? Math.PI / 4 : -Math.PI / 4;
  }

  // --- Rotating radar dish on its own mast ---
  const dish = new THREE.Group();
  dish.position.set(-0.36, 0.72, 0);
  round(dish, new THREE.CylinderGeometry(0.05, 0.06, 0.42, 8), STEEL, 0, 0.21, 0);
  const bowl = round(dish, new THREE.CylinderGeometry(0.04, 0.34, 0.2, 16), STEEL_LIGHT, 0, 0.5, 0);
  bowl.rotation.x = -0.62;
  // Cross-brace across the bowl face and the feed horn.
  box(dish, STEEL_DARK, 0.62, 0.03, 0.03, 0, 0.56, 0.1);
  round(dish, new THREE.SphereGeometry(0.05, 8, 6), CYAN, 0, 0.62, 0.2, GLOW_MAT, 0.7);
  group.add(dish);

  // --- Elevating launch rack ---
  const rack = new THREE.Group();
  rack.position.set(0.16, 0.5, 0);
  box(rack, STEEL_DARK, 0.5, 0.16, 0.5, 0, 0, 0);
  // Tube bank: columns × rows sized to the battery's capacity.
  const cols = stats.capacity >= 7 ? 4 : 2;
  const rows = Math.ceil(stats.capacity / cols);
  const rounds: THREE.Object3D[] = [];
  for (let i = 0; i < stats.capacity; i++) {
    const cx = (i % cols - (cols - 1) / 2) * 0.19;
    const cy = Math.floor(i / cols) * 0.2;
    const tube = new THREE.Group();
    tube.position.set(cx, 0.1 + cy, 0);
    round(tube, new THREE.CylinderGeometry(0.075, 0.075, 0.86, 8), NEAR_BLACK, 0, 0.36, 0);
    // The visible interceptor inside the tube.
    const shot = new THREE.Group();
    round(shot, new THREE.CylinderGeometry(0.05, 0.05, 0.58, 8), HULL, 0, 0.3, 0);
    round(shot, new THREE.ConeGeometry(0.05, 0.18, 8), stripeHex, 0, 0.68, 0, WARFARE_MAT, 0.2);
    tube.add(shot);
    rounds.push(shot);
    tube.rotation.x = -0.34;  // the whole bank leans back
    rack.add(tube);
  }
  void rows;
  group.add(rack);

  // Networked tiers get a linking antenna + brighter lamps.
  if (stats.networked) {
    round(group, new THREE.CylinderGeometry(0.03, 0.04, 0.9, 6), STEEL, 0.44, 0.75, -0.34);
    lamps.push(round(group, new THREE.SphereGeometry(0.06, 8, 6), CYAN, 0.44, 1.22, -0.34, GLOW_MAT, 0.8));
  }
  lamps.push(round(group, new THREE.BoxGeometry(0.1, 0.06, 0.06), 0x39d16a, -0.36, 0.28, 0.5, GLOW_MAT, 0.5));

  return { group, dish, rack, rounds, lamps };
}

// --- Instance managers ------------------------------------------------------------

function disposeTree(root: THREE.Object3D): void {
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.geometry) m.geometry.dispose();
  });
}

interface SiloEntry { model: SiloModel; tier: number; state: SiloState }
interface BatteryEntry { model: BatteryModel; tier: number; state: BatteryState }

/** Renders every silo + interceptor battery the client knows about. */
export class StrategicModels {
  private readonly silos = new Map<number, SiloEntry>();
  private readonly batteries = new Map<number, BatteryEntry>();
  private clock = 0;

  constructor(
    private readonly scene: THREE.Scene,
    /** Faction id -> CSS colour, for the guidance stripes and markings. */
    private readonly tintOf: (faction: number) => string,
  ) {}

  setSilo(state: SiloState): void {
    let e = this.silos.get(state.id);
    if (e && e.tier !== state.tier) { this.removeSilo(state.id); e = undefined; }
    if (!e) {
      const model = buildSiloModel(state.tier, factionTint(this.tintOf(state.faction)));
      // The 2×2 anchor sits at (x,z); centre the pad on the four cells.
      model.group.position.set(state.x + 1, state.y, state.z + 1);
      this.scene.add(model.group);
      e = { model, tier: state.tier, state };
      this.silos.set(state.id, e);
    }
    e.state = state;
  }

  removeSilo(id: number): void {
    const e = this.silos.get(id);
    if (!e) return;
    this.scene.remove(e.model.group);
    disposeTree(e.model.group);
    this.silos.delete(id);
  }

  setBattery(state: BatteryState): void {
    let e = this.batteries.get(state.id);
    if (e && e.tier !== state.tier) { this.removeBattery(state.id); e = undefined; }
    if (!e) {
      const model = buildBatteryModel(state.tier, factionTint(this.tintOf(state.faction)));
      model.group.position.set(state.x + 0.5, state.y + 1, state.z + 0.5);
      this.scene.add(model.group);
      e = { model, tier: state.tier, state };
      this.batteries.set(state.id, e);
    }
    e.state = state;
  }

  removeBattery(id: number): void {
    const e = this.batteries.get(id);
    if (!e) return;
    this.scene.remove(e.model.group);
    disposeTree(e.model.group);
    this.batteries.delete(id);
  }

  clear(): void {
    for (const id of [...this.silos.keys()]) this.removeSilo(id);
    for (const id of [...this.batteries.keys()]) this.removeBattery(id);
  }

  update(dt: number): void {
    this.clock += dt;
    for (const e of this.silos.values()) {
      const { model, state } = e;
      // The hatch swings open on launch and closes again as `hatch` decays.
      const open = Math.max(0, Math.min(1, state.hatch));
      model.hatchA.rotation.x = -open * 1.5;
      model.hatchB.rotation.x = open * 1.5;
      // A loaded silo shows its missile; an empty one shows an empty tube. It
      // also rides up a little as the hatch opens, so a launch reads clearly.
      model.loaded.visible = state.ammo > 0;
      model.loaded.position.y = 0.95 + open * 0.55;
      // The antenna sweeps while armed and stalls while the silo is cycling.
      const armed = state.ammo > 0 && state.cooldown <= 0;
      model.antenna.rotation.y += dt * (armed ? 1.5 : 0.25);
      const pulse = 0.55 + 0.45 * Math.sin(this.clock * (armed ? 3.4 : 1.1));
      for (const lamp of model.lamps) lamp.scale.setScalar(0.8 + pulse * 0.35);
      // Battle damage: the whole pad sags and darkens as it is chewed down.
      const health = state.maxHp > 0 ? state.hp / state.maxHp : 1;
      model.group.position.y = state.y - (1 - health) * 0.12;
    }
    for (const e of this.batteries.values()) {
      const { model, state } = e;
      // Idle batteries sweep; a battery with a track locks onto it.
      if (state.target) {
        const want = state.yaw + Math.PI;
        let d = want - model.dish.rotation.y;
        while (d > Math.PI) d -= Math.PI * 2;
        while (d < -Math.PI) d += Math.PI * 2;
        model.dish.rotation.y += d * Math.min(1, 8 * dt);
        model.rack.rotation.y += (want - model.rack.rotation.y) * 0 + d * Math.min(1, 5 * dt);
        model.rack.rotation.x = -Math.max(0, Math.min(1.1, state.pitch)) * 0.6;
      } else {
        model.dish.rotation.y += dt * 1.1;
        model.rack.rotation.x += (0 - model.rack.rotation.x) * Math.min(1, 3 * dt);
      }
      // Empty tubes visibly empty out from the top of the rack down.
      for (let i = 0; i < model.rounds.length; i++) {
        model.rounds[i].visible = i < state.ammo;
      }
      const pulse = 0.5 + 0.5 * Math.sin(this.clock * (state.target ? 8 : 2));
      for (const lamp of model.lamps) lamp.scale.setScalar(0.8 + pulse * 0.4);
    }
  }
}

// --- Missiles in flight ------------------------------------------------------------

interface FlightEntry {
  model: MissileModel;
  snap: MissileSnapshot;
  /** Interpolation targets so a 10 Hz snapshot renders at 60 fps. */
  from: THREE.Vector3;
  to: THREE.Vector3;
  blend: number;
  smokeAccum: number;
}

interface Puff { mesh: THREE.Mesh; ttl: number; life: number; drift: THREE.Vector3 }

/**
 * Draws every missile in flight, its exhaust and its smoke trail, plus the
 * one-shot launch flash and impact effects. Positions come from the server; the
 * client only smooths BETWEEN snapshots, so nothing here can disagree with the
 * authoritative arc.
 */
export class MissileModels {
  private readonly live = new Map<number, FlightEntry>();
  private readonly puffs: Puff[] = [];
  private readonly flashes: { mesh: THREE.Mesh; ttl: number; life: number }[] = [];
  private readonly rings: { mesh: THREE.Mesh; ttl: number; life: number }[] = [];
  private clock = 0;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly tintOf: (faction: number) => string,
  ) {}

  /** Adopt a server snapshot list (adds, updates and removes as needed). */
  sync(list: readonly MissileSnapshot[]): void {
    const seen = new Set<number>();
    for (const snap of list) {
      seen.add(snap.id);
      let e = this.live.get(snap.id);
      if (!e) e = this.spawn(snap);
      e.from.copy(e.model.group.position);
      e.to.set(snap.x, snap.y, snap.z);
      e.blend = 0;
      e.snap = snap;
    }
    for (const id of [...this.live.keys()]) if (!seen.has(id)) this.remove(id);
  }

  private spawn(snap: MissileSnapshot): FlightEntry {
    const model = buildMissileModel(
      factionTint(this.tintOf(snap.faction)), snap.kind === 'interceptor');
    model.group.position.set(snap.x, snap.y, snap.z);
    this.scene.add(model.group);
    const e: FlightEntry = {
      model, snap,
      from: new THREE.Vector3(snap.x, snap.y, snap.z),
      to: new THREE.Vector3(snap.x, snap.y, snap.z),
      blend: 1, smokeAccum: 0,
    };
    this.live.set(snap.id, e);
    return e;
  }

  launch(snap: MissileSnapshot): void {
    this.sync([...[...this.live.values()].map((e) => e.snap), snap]);
    this.flash(snap.x, snap.y, snap.z, snap.kind === 'interceptor' ? 1.4 : 2.6,
      snap.kind === 'interceptor' ? 0x9ff0ff : 0xffd9a0);
  }

  remove(id: number): void {
    const e = this.live.get(id);
    if (!e) return;
    this.scene.remove(e.model.group);
    disposeTree(e.model.group);
    this.live.delete(id);
  }

  has(id: number): boolean { return this.live.has(id); }

  /** World position of a live missile (for gunfire aim tests + HUD arrows). */
  positionOf(id: number): THREE.Vector3 | null {
    const e = this.live.get(id);
    return e ? e.model.group.position : null;
  }

  /**
   * A bright expanding shell. `radius` is the radius the shell reaches at the
   * PEAK of its animation, not the radius of the geometry — an explosion that
   * claims to be seven blocks across has to actually look seven blocks across,
   * and quoting the seed radius instead used to inflate every fireball to more
   * than three times its own blast footprint.
   */
  flash(x: number, y: number, z: number, radius: number, hex: number): void {
    const mesh = new THREE.Mesh(
      paintRound(new THREE.SphereGeometry(radius / FLASH_PEAK, 12, 8), hex, 0.9),
      GLOW_MAT.clone());
    mesh.position.set(x, y, z);
    this.scene.add(mesh);
    this.flashes.push({ mesh, ttl: 0.55, life: 0.55 });
  }

  /** A flat shockwave ring racing out along the ground to the blast rim. */
  private ring(x: number, y: number, z: number, radius: number, hex: number): void {
    const mesh = new THREE.Mesh(
      paintRound(new THREE.RingGeometry(radius * 0.82, radius, 28), hex, 0.9),
      new THREE.MeshBasicMaterial({
        vertexColors: true, transparent: true, opacity: 0.75, depthWrite: false,
        side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
      }));
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x, y, z);
    this.scene.add(mesh);
    this.rings.push({ mesh, ttl: 0.7, life: 0.7 });
  }

  /**
   * The full impact presentation, sized off the warhead's REAL blast radius:
   * a white-hot core, a fireball that reaches just past the damage rim (so the
   * thing you see is the thing that hurt you), a ground shockwave and a smoke
   * column that outlives both.
   */
  impact(x: number, y: number, z: number, radius: number): void {
    this.flash(x, y + radius * 0.3, z, radius * 0.7, 0xffe1a6);
    this.flash(x, y + radius * 0.18, z, radius * 1.12, 0xff6a20);
    this.ring(x, y + 0.35, z, radius * 1.5, 0xffb15a);
    for (let i = 0; i < 22; i++) {
      const a = (i / 22) * Math.PI * 2;
      const r = radius * (0.2 + Math.random() * 0.65);
      this.puff(
        x + Math.cos(a) * r, y + 0.4 + Math.random() * radius * 0.7, z + Math.sin(a) * r,
        radius * (0.11 + Math.random() * 0.13), 0x4a4744, 2.4,
        new THREE.Vector3(Math.cos(a) * 1.4, 1.6 + Math.random(), Math.sin(a) * 1.4));
    }
  }

  private puff(
    x: number, y: number, z: number, size: number, hex: number, life: number,
    drift: THREE.Vector3,
  ): void {
    const mesh = new THREE.Mesh(
      paintRound(new THREE.SphereGeometry(size, 6, 5), hex, 0.1),
      new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.55, depthWrite: false }));
    mesh.position.set(x, y, z);
    this.scene.add(mesh);
    this.puffs.push({ mesh, ttl: life, life, drift });
  }

  update(dt: number): void {
    this.clock += dt;
    for (const e of this.live.values()) {
      // Snapshots arrive at 10 Hz; blend across one interval so flight is smooth.
      e.blend = Math.min(1, e.blend + dt * 10);
      e.model.group.position.lerpVectors(e.from, e.to, e.blend);
      // Pitch the airframe along its ACTUAL server trajectory.
      e.model.body.rotation.order = 'YXZ';
      e.model.body.rotation.y = e.snap.yaw;
      // The model's long axis is +Y, so a level flight path means lying flat.
      e.model.body.rotation.x = -(Math.PI / 2 - e.snap.pitch);
      // Flame flicker + a spin so the fins catch the eye.
      const f = 0.82 + Math.sin(this.clock * 41 + e.snap.id) * 0.12 +
        Math.sin(this.clock * 17.3 + e.snap.id * 2) * 0.06;
      e.model.flame.scale.set(f, 0.85 + f * 0.4, f);
      e.model.flameCore.scale.set(f * 1.1, f, f * 1.1);
      e.model.body.rotation.z += dt * 0.9;
      // Smoke trail.
      e.smokeAccum += dt;
      if (e.smokeAccum > 0.045) {
        e.smokeAccum = 0;
        const p = e.model.group.position;
        this.puff(p.x + (Math.random() - 0.5) * 0.3, p.y - 0.6, p.z + (Math.random() - 0.5) * 0.3,
          e.snap.kind === 'interceptor' ? 0.22 : 0.36, 0x6f6f72, 1.5,
          new THREE.Vector3((Math.random() - 0.5) * 0.5, 0.7, (Math.random() - 0.5) * 0.5));
      }
    }
    for (let i = this.puffs.length - 1; i >= 0; i--) {
      const p = this.puffs[i];
      p.ttl -= dt;
      const k = Math.max(0, p.ttl / p.life);
      p.mesh.position.addScaledVector(p.drift, dt);
      p.mesh.scale.setScalar(0.6 + (1 - k) * 1.8);
      (p.mesh.material as THREE.MeshBasicMaterial).opacity = 0.5 * k;
      if (p.ttl <= 0) {
        this.scene.remove(p.mesh);
        p.mesh.geometry.dispose();
        (p.mesh.material as THREE.Material).dispose();
        this.puffs.splice(i, 1);
      }
    }
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.ttl -= dt;
      const k = Math.max(0, r.ttl / r.life);
      r.mesh.scale.setScalar(0.15 + (1 - k) * 0.9);
      (r.mesh.material as THREE.MeshBasicMaterial).opacity = k * 0.7;
      if (r.ttl <= 0) {
        this.scene.remove(r.mesh);
        r.mesh.geometry.dispose();
        (r.mesh.material as THREE.Material).dispose();
        this.rings.splice(i, 1);
      }
    }
    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const f = this.flashes[i];
      f.ttl -= dt;
      const k = Math.max(0, f.ttl / f.life);
      f.mesh.scale.setScalar(0.4 + (1 - k) * (FLASH_PEAK - 0.4));
      (f.mesh.material as THREE.Material as THREE.MeshBasicMaterial).opacity = k * 0.85;
      if (f.ttl <= 0) {
        this.scene.remove(f.mesh);
        f.mesh.geometry.dispose();
        (f.mesh.material as THREE.Material).dispose();
        this.flashes.splice(i, 1);
      }
    }
  }

  clear(): void {
    for (const id of [...this.live.keys()]) this.remove(id);
  }
}

/** Re-exported so the UI preview can draw a missile along its own arc. */
export { arcAt };
