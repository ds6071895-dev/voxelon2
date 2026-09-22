// Detailed, textured industrial rigs. Static hardware is merged by material;
// only the actual mechanism, status lamps and buffer gauge remain separate.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { currentRate, MachineType, machineTier, storageCap, totalStored, WellPhase } from './machines';
import type { Machines, YieldContext } from './machines';

type Surface = 'metal' | 'paint' | 'hazard' | 'vent' | 'panel' | 'rubber';
const surfaces = new Map<Surface, THREE.MeshBasicMaterial>();
const STEEL = 0x9fb4c4, DARK = 0x344858, TEAL = 0x258d94, ORANGE = 0xcd6e35;
const LIGHT = 0xdae4e6, GOLD = 0xffc26d;

/** Seeded 128px industrial surfaces: grain, seams, exposed edges, bolt heads,
 * scratches, oil stains, warning chevrons and instrument readouts. No downloads
 * or per-rig texture allocations; the same assets also work in visual tests. */
function material(kind: Surface): THREE.MeshBasicMaterial {
  const cached = surfaces.get(kind); if (cached) return cached;
  const size = 128, data = new Uint8Array(size * size * 4);
  let seed = 48271;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) | 0; return (seed >>> 0) / 4294967296; };
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let value = 205 + random() * 24;
    if (kind === 'metal') value = 187 + random() * 35 + (y % 3 === 0 ? 16 : 0);
    if (kind === 'rubber') value = 90 + random() * 18 + (y % 12 < 3 ? 45 : 0);
    if (kind === 'hazard') value = (x + y) % 40 < 20 ? 232 : 42;
    if (kind === 'vent') value = y % 16 < 9 && x > 12 && x < 116 ? 39 : 186;
    if (kind === 'panel') {
      value = 28;
      if (x > 10 && x < 118 && y > 12 && y < 62) value = 65;
      if (x > 18 && x < 106 && y > 22 && y < 49 && (x + y * 2) % 25 < 5) value = 238;
      if (y > 79 && y < 87 && x > 14 && x < 82) value = 190;
      if (y > 99 && y < 108 && x > 14 && x < 60) value = 120;
      if ((x - 101) ** 2 + (y - 96) ** 2 < 65) value = 245;
    }
    if (kind === 'paint' || kind === 'metal' || kind === 'hazard') {
      if (x < 3 || y < 3 || x > 124 || y > 124) value *= .52;
      if (x === 4 || y === 4) value = 246;
      // Scuffed lower edge and small deterministic scratches.
      if (y > 109 && random() > .64) value *= .67;
      if ((x * 7 + y * 29) % 311 === 0) value = 250;
      for (const bx of [10, 117]) for (const by of [10, 117]) {
        const d = (x - bx) ** 2 + (y - by) ** 2;
        if (d < 18) value = d < 7 ? 91 : 238;
      }
    }
    const i = (y * size + x) * 4;
    data[i] = data[i + 1] = data[i + 2] = Math.min(255, value); data[i + 3] = 255;
  }
  const texture = new THREE.DataTexture(data, size, size);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  const mat = new THREE.MeshBasicMaterial({ map: texture, vertexColors: true });
  surfaces.set(kind, mat); return mat;
}

function mesh(parent: THREE.Object3D, geo: THREE.BufferGeometry, color: number, surface: Surface = 'metal'): THREE.Mesh {
  const normal = geo.getAttribute('normal'), colors = new Float32Array(normal.count * 3);
  const c = new THREE.Color(color);
  for (let i = 0; i < normal.count; i++) {
    const shade = .73 + normal.getY(i) * .17 + normal.getZ(i) * .07 + normal.getX(i) * .03;
    colors[i * 3] = c.r * shade; colors[i * 3 + 1] = c.g * shade; colors[i * 3 + 2] = c.b * shade;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const m = new THREE.Mesh(geo, material(surface)); parent.add(m); return m;
}
function box(p: THREE.Object3D, c: number, w: number, h: number, d: number, x: number, y: number, z: number, surface: Surface = 'metal') {
  const m = mesh(p, new THREE.BoxGeometry(w, h, d), c, surface); m.position.set(x, y, z); return m;
}
function cylinder(p: THREE.Object3D, c: number, r: number, h: number, x: number, y: number, z: number, surface: Surface = 'metal') {
  const m = mesh(p, new THREE.CylinderGeometry(r, r, h, 12), c, surface); m.position.set(x, y, z); return m;
}
function strut(p: THREE.Object3D, c: number, a: number[], b: number[], width = .04) {
  const start = new THREE.Vector3(...a), end = new THREE.Vector3(...b), delta = end.clone().sub(start);
  const m = box(p, c, width, delta.length(), width, 0, 0, 0);
  m.position.copy(start.add(end).multiplyScalar(.5));
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.normalize()); return m;
}
function pipe(p: THREE.Object3D, c: number, points: number[][], radius = .025, surface: Surface = 'metal') {
  return mesh(p, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points.map(v => new THREE.Vector3(...v))), 20, radius, 6, false), c, surface);
}
function wheel(p: THREE.Object3D, c: number, r: number, x: number, y: number, z: number) {
  const g = new THREE.Group(); g.position.set(x, y, z); p.add(g);
  mesh(g, new THREE.TorusGeometry(r, .024, 6, 16), c);
  for (let i = 0; i < 4; i++) { const spoke = box(g, c, r * 1.8, .022, .025, 0, 0, 0); spoke.rotation.z = i * Math.PI / 4; }
  return g;
}

/** Merge only direct, static meshes. Mechanism groups keep their transforms. */
function batch(group: THREE.Group): void {
  const buckets = new Map<THREE.Material, THREE.BufferGeometry[]>();
  for (const child of [...group.children]) {
    if (!(child instanceof THREE.Mesh)) continue;
    child.updateMatrix();
    const geo = child.geometry.index ? child.geometry.toNonIndexed() : child.geometry.clone();
    geo.applyMatrix4(child.matrix);
    const mat = child.material as THREE.Material;
    const list = buckets.get(mat) ?? []; list.push(geo); buckets.set(mat, list);
    child.geometry.dispose(); group.remove(child);
  }
  for (const [mat, geometries] of buckets) {
    const geo = mergeGeometries(geometries);
    geometries.forEach(g => g.dispose());
    if (geo) group.add(new THREE.Mesh(geo, mat));
  }
}

export interface MachineModel {
  group: THREE.Group;
  type: MachineType;
  tier: number;
  phase: number;
  context?: YieldContext;
  drill?: THREE.Group;
  gear?: THREE.Group;
  beam?: THREE.Group;
  rod?: THREE.Object3D;
  crank?: THREE.Group;
  linkage?: THREE.Object3D;
  lamp: THREE.MeshBasicMaterial;
  gauge: THREE.Mesh;
  /** Autominer exhaust stack: glows from soot-black to white-hot with heat. */
  heat?: THREE.MeshBasicMaterial;
  /** Derrick: black oil column while an uncapped gusher blows. */
  gusher?: THREE.Group;
  /** Derrick: well-fire flames. */
  fire?: THREE.Group;
  /** Derrick: flare-stack flame (lit while the well has good pressure). */
  flare?: THREE.Object3D;
  /** Seconds since the last exhaust puff / spark. */
  puff: number;
}

/** Flickering additive flame material (shared by fires and the flare). */
function flameMaterial(color: number, opacity = .85): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending,
  });
}

function foundation(group: THREE.Group, accent: number, tier: number) {
  box(group, DARK, .96, .14, .96, 0, -.41, 0, 'paint');
  box(group, STEEL, .86, .035, .84, 0, -.32, 0, 'vent');
  for (const x of [-.38, .38]) for (const z of [-.38, .38]) {
    box(group, DARK, .19, .1, .19, x, -.46, z, 'rubber');
    cylinder(group, LIGHT, .036, .025, x, -.3, z);
  }
  box(group, GOLD, .88, .075, .022, 0, -.4, .487, 'hazard');
  for (let i = 0; i <= tier; i++) box(group, accent, .08, .04, .027, -.15 + i * .1, -.27, .43, 'paint');
}
function indicators(group: THREE.Group, accent: number, oil = false) {
  box(group, DARK, .12, .42, .055, .39, .13, .4, 'paint');
  const lamp = new THREE.MeshBasicMaterial({ color: accent });
  const led = new THREE.Mesh(new THREE.BoxGeometry(.12, .035, .018), lamp);
  led.position.set(oil ? -.21 : -.27, oil ? .56 : 1.31, oil ? .31 : .34);
  box(group, DARK, .15, .055, .06, led.position.x, led.position.y - .028, led.position.z - .025);
  group.add(led);
  const gauge = new THREE.Mesh(new THREE.BoxGeometry(.055, .32, .012), lamp);
  gauge.position.set(.39, .1, .432); group.add(gauge);
  return { lamp, gauge };
}
function drillFlight(): THREE.BufferGeometry {
  const positions: number[] = [], uvs: number[] = [], indices: number[] = [];
  for (let i = 0; i <= 100; i++) {
    const t = i / 100, a = t * Math.PI * 7;
    for (const r of [.065, .21]) {
      positions.push(Math.cos(a) * r, .76 - t * .87, Math.sin(a) * r); uvs.push(r === .065 ? 0 : 1, t * 3);
    }
    if (i < 100) { const n = i * 2; indices.push(n, n + 1, n + 2, n + 1, n + 3, n + 2); }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  // Both sides of the steel flight are visible without globally double-sided materials.
  geo.setIndex(indices); geo.computeVertexNormals();
  indices.push(...indices.slice().reverse()); geo.setIndex(indices); return geo;
}

function autominer(tier: number): MachineModel {
  const group = new THREE.Group(), accent = tier === 3 ? GOLD : TEAL;
  foundation(group, accent, tier);
  for (const x of [-.37, .37]) for (const z of [-.32, .32]) {
    box(group, DARK, .09, 1.52, .09, x, .47, z);
    box(group, LIGHT, .035, .85, .03, x, .35, z + .048);
    box(group, GOLD, .115, .15, .115, x, -.18, z, 'hazard');
  }
  for (const z of [-.33, .33]) box(group, STEEL, .88, .09, .12, 0, 1.22, z);
  box(group, accent, .65, .36, .64, 0, 1.01, 0, 'paint');
  box(group, DARK, .43, .23, .016, 0, 1.015, .327, 'vent');
  box(group, GOLD, .65, .045, .66, 0, .81, 0, 'hazard');
  box(group, DARK, .48, .05, .45, 0, 1.22, 0);
  box(group, accent, .3, .28, .12, -.17, .53, .35, 'paint');
  box(group, 0xa5fff1, .25, .21, .015, -.17, .53, .418, 'panel');
  cylinder(group, STEEL, .11, .56, -.31, .3, -.13);
  for (const y of [.09, .52]) cylinder(group, DARK, .13, .05, -.31, y, -.13);
  pipe(group, DARK, [[-.3, .6, -.13], [-.36, .77, -.2], [-.28, .87, -.25]], .03, 'rubber');
  pipe(group, GOLD, [[.27, 1, -.2], [.42, .85, -.2], [.42, .15, -.22], [.25, -.2, -.22]], .023);
  // Rear cross-brace and side cooling fins are real geometry.
  strut(group, STEEL, [-.34, -.23, -.33], [.34, .76, -.33]);
  strut(group, STEEL, [.34, -.23, -.33], [-.34, .76, -.33]);
  for (let i = 0; i < 5 + tier * 2; i++) box(group, STEEL, .055, .2, .025, .35, 1.0, -.22 + i * .05);
  const drill = new THREE.Group(); group.add(drill);
  cylinder(drill, STEEL, .062, 1.06, 0, .3, 0);
  mesh(drill, drillFlight(), LIGHT);
  const bit = mesh(drill, new THREE.ConeGeometry(.14, .19, 8), DARK);
  bit.rotation.z = Math.PI; bit.position.y = -.22;
  const gear = new THREE.Group(); gear.position.y = 1.29; group.add(gear);
  cylinder(gear, DARK, .2, .07, 0, 0, 0);
  for (let i = 0; i < 8; i++) {
    const a = i * Math.PI / 4;
    const tooth = box(gear, STEEL, .065, .07, .08, Math.sin(a) * .21, 0, Math.cos(a) * .21); tooth.rotation.y = a;
  }
  if (tier >= 1) for (const x of [-.22, .22]) cylinder(group, accent, .075, .18, x, 1.34, -.2);
  if (tier >= 2) {
    box(group, accent, .55, .18, .13, 0, .4, -.37, 'vent');
    pipe(group, 0x64d9cd, [[-.26, .5, -.36], [-.3, .74, -.38], [.28, .74, -.38], [.28, .5, -.36]], .022);
  }
  batch(group); batch(drill); batch(gear);
  // Exhaust stack: its tip colour is the rig's temperature gauge.
  const heat = new THREE.MeshBasicMaterial({ color: 0x2c3036 });
  const stack = new THREE.Mesh(new THREE.CylinderGeometry(.06, .075, .34, 8), heat);
  stack.position.set(.24, 1.5, -.2); group.add(stack);
  const signals = indicators(group, 0x77edce);
  return { group, type: MachineType.Autominer, tier, phase: 0, drill, gear, heat, puff: 0, ...signals };
}
function derrick(tier: number): MachineModel {
  const group = new THREE.Group(), accent = tier === 3 ? GOLD : ORANGE;
  foundation(group, accent, tier);
  for (const z of [-.27, .27]) {
    strut(group, accent, [-.34, -.28, z], [-.06, 1.78, z * .4], .07);
    strut(group, accent, [.25, -.28, z], [-.06, 1.78, z * .4], .07);
    for (let i = 0; i < 4; i++) {
      const y = -.2 + i * .45, w = .29 - i * .052;
      strut(group, STEEL, [-w, y, z * (1 - i * .15)], [w - .08, y + .43, z * (1 - (i + 1) * .15)], .027);
      strut(group, DARK, [w - .08, y, z * (1 - i * .15)], [-w + .05, y + .43, z * (1 - (i + 1) * .15)], .027);
    }
  }
  box(group, DARK, .39, .09, .42, -.06, 1.75, 0);
  // Ladder, with rungs and crown handrails.
  for (const z of [-.11, .11]) strut(group, LIGHT, [-.39, -.22, z], [-.15, 1.73, z], .025);
  for (let i = 0; i < 10; i++) box(group, STEEL, .03, .025, .25, -.38 + i * .024, -.15 + i * .195, 0);
  box(group, accent, .37, .31, .32, -.23, -.12, 0, 'paint');
  box(group, STEEL, .3, .16, .017, -.23, -.12, .168, 'vent');
  cylinder(group, accent, .16, .54, .23, .02, -.24, 'paint');
  for (const y of [-.2, .2]) cylinder(group, DARK, .168, .038, .23, y, -.24);
  cylinder(group, STEEL, .07, .4, .34, -.02, .14);
  for (const y of [-.19, .13]) cylinder(group, DARK, .1, .035, .34, y, .14);
  pipe(group, STEEL, [[.34, -.04, .14], [.42, -.1, 0], [.42, -.1, -.24], [.23, .05, -.24]], .026);
  wheel(group, 0xc4473c, .09, .34, .2, .2);
  box(group, 0xa5fff1, .21, .16, .035, -.21, .44, .29, 'panel');
  const beam = new THREE.Group(); beam.position.set(-.06, 1.89, 0); group.add(beam);
  box(beam, accent, .77, .09, .13, 0, 0, 0, 'paint');
  box(beam, STEEL, .79, .027, .16, 0, .055, 0);
  box(beam, DARK, .15, .2, .21, -.32, -.045, 0);
  const tailPin = cylinder(beam, STEEL, .028, .28, -.32, 0, .14);
  tailPin.rotation.x = Math.PI / 2;
  const head = box(beam, accent, .14, .29, .28, .36, -.06, 0, 'hazard'); head.rotation.z = -.18;
  const pivot = cylinder(group, STEEL, .1, .23, -.06, 1.89, 0); pivot.rotation.x = Math.PI / 2;
  const rod = cylinder(group, LIGHT, .018, 1.55, .3, 1.0, .14);
  const crank = new THREE.Group(); crank.position.set(-.23, .15, .24); group.add(crank);
  wheel(crank, DARK, .18, 0, 0, 0);
  box(crank, accent, .2, .1, .07, -.09, 0, .03, 'paint');
  cylinder(crank, STEEL, .035, .08, .12, 0, .04).rotation.x = Math.PI / 2;
  if (tier >= 1) box(group, GOLD, .32, .055, .34, -.06, 1.69, 0, 'hazard');
  if (tier >= 2) {
    cylinder(group, accent, .09, .42, -.3, .62, -.25, 'paint');
    pipe(group, GOLD, [[-.3, .85, -.25], [-.27, 1.05, -.27], [-.12, 1.05, -.27]], .022);
  }
  if (tier === 3) for (const z of [-.2, .2]) {
    strut(group, GOLD, [-.23, 1.78, z], [-.23, 2.04, z], .02);
    strut(group, GOLD, [-.23, 2.04, z], [.09, 2.04, z], .02);
  }
  // Keep rod out of the static batch; it must follow the rocking horsehead.
  group.remove(rod); batch(group); group.add(rod); batch(beam); batch(crank);
  const signals = indicators(group, 0x77edce, true);
  const linkage = box(group, STEEL, .028, 1, .035, -.245, 1.02, .28);
  linkage.scale.y = Math.hypot(.27, 1.74);
  linkage.rotation.z = Math.atan2(.27, 1.74);
  // Gusher: a tall column of crude blowing out of the wellhead, with a spray cap.
  const gusher = new THREE.Group(); gusher.visible = false; group.add(gusher);
  const crude = new THREE.MeshBasicMaterial({ color: 0x14100c });
  const column = new THREE.Mesh(new THREE.CylinderGeometry(.12, .2, 7, 10, 1, true), crude);
  column.position.set(.3, 3.4, .14); gusher.add(column);
  const spray = new THREE.Mesh(new THREE.SphereGeometry(.7, 10, 6), crude);
  spray.scale.set(1, .45, 1); spray.position.set(.3, 6.9, .14); gusher.add(spray);
  // Well fire: layered flame cones roaring off the wellhead.
  const fire = new THREE.Group(); fire.visible = false; group.add(fire);
  const cones: [number, number, number, number][] = [[.55, 3.2, 0xff5a14, .8], [.38, 4.4, 0xffa230, .7], [.2, 5.2, 0xfff0a0, .6]];
  for (const [r, h, c, o] of cones) {
    const cone = new THREE.Mesh(new THREE.ConeGeometry(r, h, 9, 1, true), flameMaterial(c, o));
    cone.position.set(.3, h / 2 - .2, .14); fire.add(cone);
  }
  // Flare stack: a thin pipe with a pilot flame, lit while the well has pressure.
  cylinder(group, STEEL, .025, .9, .44, 2.05, -.34);
  const flare = new THREE.Mesh(new THREE.ConeGeometry(.07, .3, 7, 1, true), flameMaterial(0xffa53a));
  flare.position.set(.44, 2.65, -.34); flare.visible = false; group.add(flare);
  return { group, type: MachineType.OilDerrick, tier, phase: 0, beam, rod, crank, linkage,
    gusher, fire, flare, puff: 0, ...signals };
}

export function createMachineModel(type: MachineType, level = 1): MachineModel {
  return type === MachineType.Autominer ? autominer(machineTier(level)) : derrick(machineTier(level));
}
export function disposeMachineModel(model: MachineModel): void {
  model.group.traverse(o => { if (o instanceof THREE.Mesh) o.geometry.dispose(); });
  model.lamp.dispose(); // Shared surface materials/textures live for the session.
}

export type MachinePuff = 'smoke' | 'dust' | 'spark' | 'oil' | 'ember';

export class MachineModels {
  private readonly models = new Map<string, MachineModel>();
  private clock = 0;
  /** Host particle hook (exhaust smoke, drill dust, jam sparks, gusher spray). */
  onPuff?: (kind: MachinePuff, x: number, y: number, z: number) => void;
  constructor(private readonly scene: THREE.Scene, private readonly machines: Machines) {}

  update(dt: number): void {
    this.clock += Math.max(0, Math.min(.1, dt));
    const seen = new Set<string>();
    for (const m of this.machines.list()) {
      const key = `${m.x},${m.y},${m.z}`; seen.add(key);
      let e = this.models.get(key);
      if (!e || e.type !== m.state.type || e.tier !== machineTier(m.state.level)) {
        if (e) { this.scene.remove(e.group); disposeMachineModel(e); }
        e = createMachineModel(m.state.type, m.state.level);
        e.group.position.set(m.x + .5, m.y + .5, m.z + .5);
        // Stagger neighboring machinery without changing deterministic production.
        e.phase = (m.x * .7 + m.z * 1.3) % (Math.PI * 2);
        this.scene.add(e.group); this.models.set(key, e);
      }
      const s = m.state;
      const full = totalStored(s) >= storageCap(s);
      const ctx = e.context ??= this.machines.context(m.x, m.z, s.type);
      const drilling = s.type === MachineType.OilDerrick && s.phase === WellPhase.Drilling && (ctx.oil ?? 0) > 0;
      const running = (!full && currentRate(s, ctx) > 0) || drilling;
      const over = s.type === MachineType.Autominer && s.overdrive && running;
      const step = Math.min(.1, Math.max(0, dt));
      if (running) e.phase += step * (1.5 + s.level * .16) * (over ? 2.2 : 1);
      const blink = Math.sin(this.clock * 12) > 0;
      const alarm = s.jam > 0 || s.fire > 0;
      e.lamp.color.setHex(alarm ? (blink ? 0xff3322 : 0x220806) : full ? 0xffbb55 : running ? 0x77edce : 0xf16c5e);
      // Overdrive rattles the whole rig on its mounts.
      e.group.position.set(m.x + .5 + (over ? (Math.random() - .5) * .02 : 0), m.y + .5,
        m.z + .5 + (over ? (Math.random() - .5) * .02 : 0));
      if (e.heat) {
        const t = Math.max(0, Math.min(1, (s.heat - 25) / 75));
        e.heat.color.setRGB(.17 + .83 * t, .19 + .5 * t * t, .21 + .1 * t * t * t);
      }
      if (e.gusher) {
        e.gusher.visible = s.uncapped && s.fire <= 0;
        if (e.gusher.visible) e.gusher.scale.set(1 + Math.sin(this.clock * 17) * .06, 1 + Math.sin(this.clock * 5) * .04, 1);
      }
      if (e.fire) {
        e.fire.visible = s.fire > 0;
        if (e.fire.visible) e.fire.children.forEach((c, i) => {
          c.scale.set(1 + Math.sin(this.clock * (9 + i * 4)) * .12, 1 + Math.sin(this.clock * (7 + i * 3) + i) * .18, 1);
        });
      }
      if (e.flare) {
        e.flare.visible = s.type === MachineType.OilDerrick && s.phase === WellPhase.Pumping &&
          s.reserves > .35 && !s.uncapped && s.fire <= 0;
        if (e.flare.visible) e.flare.scale.y = .8 + Math.abs(Math.sin(this.clock * 11)) * .5;
      }
      // Particles: exhaust + dust while working, sparks while jammed, spray/embers.
      e.puff += step;
      const wx = m.x + .5, wy = m.y + .5, wz = m.z + .5;
      if (this.onPuff) {
        if (s.jam > 0 && e.puff > .18) { e.puff = 0; this.onPuff('spark', wx, wy + .9, wz); }
        else if (s.fire > 0 && e.puff > .12) { e.puff = 0; this.onPuff('ember', wx + .3, wy + 1 + Math.random() * 3, wz + .14); }
        else if (s.uncapped && e.puff > .15) { e.puff = 0; this.onPuff('oil', wx + .3, wy + 6.4, wz + .14); }
        else if (running && e.puff > (over ? .22 : .7)) {
          e.puff = 0;
          if (s.type === MachineType.Autominer) {
            this.onPuff(s.heat > 70 ? 'spark' : 'smoke', wx + .24, wy + 1.75, wz - .2);
            this.onPuff('dust', wx, wy - .35, wz);
          } else this.onPuff('smoke', wx - .23, wy + .1, wz);
        }
      }
      e.gauge.scale.y = Math.max(.025, totalStored(m.state) / storageCap(m.state));
      e.gauge.position.y = -.06 + .16 * e.gauge.scale.y;
      if (e.drill) { e.drill.rotation.y = e.phase * 3; e.drill.position.y = Math.sin(e.phase * 2) * .022; }
      if (e.gear) e.gear.rotation.y = -e.phase * 1.5;
      // While drilling a well the walking beam is locked level; the drill
      // string spins down the tower instead.
      const angle = drilling ? 0 : Math.sin(e.phase) * .24;
      if (drilling && e.rod) e.rod.rotation.y = e.phase * 4;
      if (e.beam) e.beam.rotation.z = angle;
      if (e.rod) { e.rod.position.y = 1.02 + Math.sin(angle) * .36; e.rod.position.x = -.06 + Math.cos(angle) * .36; }
      if (e.crank) e.crank.rotation.z = e.phase;
      if (e.linkage) {
        const bottomX = -.23 + Math.cos(e.phase) * .12;
        const bottomY = .15 + Math.sin(e.phase) * .12;
        const topX = -.06 - Math.cos(angle) * .32;
        const topY = 1.89 - Math.sin(angle) * .32;
        const dx = topX - bottomX, dy = topY - bottomY;
        e.linkage.position.set((bottomX + topX) / 2, (bottomY + topY) / 2, .28);
        e.linkage.scale.y = Math.hypot(dx, dy);
        e.linkage.rotation.z = -Math.atan2(dx, dy);
      }
    }
    for (const [key, e] of this.models) if (!seen.has(key)) {
      this.scene.remove(e.group); disposeMachineModel(e); this.models.delete(key);
    }
  }
}

// Shared with turretmodels.ts so turrets wear the same seeded industrial skin.
export { mesh as industrialMesh, box as industrialBox, cylinder as industrialCylinder, batch as mergeStatic };
export type { Surface as IndustrialSurface };
