// Trapcraft renderer: animated models for traps, per viewer. The chunk mesher
// skips the concealable trap blocks (see TRAP_MODEL_BLOCKS) so that THIS layer
// alone decides whether a hostile hidden trap is drawn — camouflage and reveal
// are then just a visibility flag, with no chunk rebuilds.
//
// Everything else a trap does visually lives here too: spikes that spring up,
// bear-trap jaws that snap, tripwire lasers, claymore aim lines, flame jets,
// motion-sensor sweeps, dart tracers, alarm rings and a channel-colour pip on
// every trap you own.

import * as THREE from 'three';
import { Block } from './blocks';
import {
  CHANNEL_COLORS, FACING_DIRS, TrapField, TrapKind, TrapState, TrapFxWhat,
  trapConcealed, trapFriendly, tripwireCells,
} from './traps';

/** Blocks drawn ONLY by TrapModels (the mesher skips them). */
export const TRAP_MODEL_BLOCKS: ReadonlySet<number> = new Set([
  Block.SpikeTrap, Block.Landmine, Block.BearTrap, Block.ShockPlate,
  Block.PressurePlate, Block.TripwireHook, Block.Claymore,
]);

export interface TrapViewer {
  name: string;
  faction: number;
  x: number; y: number; z: number;
  /** Radius within which hostile hidden traps are revealed (0 = none). */
  reveal: number;
}

const VIEW_RANGE = 48;

const mats = new Map<string, THREE.MeshBasicMaterial>();
function mat(color: number, opts: { glow?: boolean; opacity?: number } = {}): THREE.MeshBasicMaterial {
  const key = `${color}:${opts.glow ? 1 : 0}:${opts.opacity ?? 1}`;
  let m = mats.get(key);
  if (!m) {
    m = new THREE.MeshBasicMaterial({
      color,
      transparent: !!opts.glow || (opts.opacity ?? 1) < 1,
      opacity: opts.opacity ?? 1,
      depthWrite: !opts.glow,
      blending: opts.glow ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    mats.set(key, m);
  }
  return m;
}

function box(p: THREE.Object3D, color: number, w: number, h: number, d: number, x: number, y: number, z: number,
  opts?: { glow?: boolean; opacity?: number }): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color, opts));
  m.position.set(x, y, z); p.add(m); return m;
}

const STEEL = 0x8c96a2, DARK = 0x2a2f36, OLIVE = 0x5f6a3e, RED = 0xe0392f, HOT = 0xff4a36;

interface TrapModel {
  kind: TrapKind;
  group: THREE.Group;
  /** Moving part (spikes / jaws / plate / barrel …). */
  part?: THREE.Object3D;
  part2?: THREE.Object3D;
  /** Laser / flame / sweep overlay. */
  beam?: THREE.Mesh;
  beam2?: THREE.Mesh;
  pip?: THREE.Mesh;
  /** Red "revealed" halo for hostile hidden traps. */
  halo: THREE.Mesh;
  /** 0..1 animated extension (spikes up, jaws shut, flame lit). */
  anim: number;
  /** Seconds of one-shot flash left (fire FX). */
  flash: number;
  /** Tripwire geometry refresh timer. */
  recalc: number;
  facing: number;
}

function faceGroup(g: THREE.Object3D, facing: number): void {
  // Local +z is "forward"; rotate to the trap's facing (FACING_DIRS).
  const d = FACING_DIRS[facing] ?? FACING_DIRS[0];
  if (d[1] > 0) { g.rotation.x = -Math.PI / 2; return; }
  g.rotation.y = Math.atan2(d[0], d[2]);
}

function build(kind: TrapKind, facing: number): TrapModel {
  const group = new THREE.Group();
  const halo = new THREE.Mesh(new THREE.RingGeometry(.42, .5, 20), mat(HOT, { glow: true, opacity: .8 }));
  halo.rotation.x = -Math.PI / 2; halo.position.y = -.44; halo.visible = false; group.add(halo);
  const m: TrapModel = { kind, group, halo, anim: 0, flash: 0, recalc: 0, facing };
  switch (kind) {
    case TrapKind.Spike: {
      box(group, DARK, .92, .1, .92, 0, -.45, 0);
      const spikes = new THREE.Group(); group.add(spikes);
      const cone = new THREE.ConeGeometry(.07, .5, 6);
      for (const sx of [-.3, 0, .3]) for (const sz of [-.3, 0, .3]) {
        const c = new THREE.Mesh(cone, mat(0xd8dee6)); c.position.set(sx, 0, sz); spikes.add(c);
      }
      m.part = spikes;
      break;
    }
    case TrapKind.Landmine: {
      const disc = new THREE.Mesh(new THREE.CylinderGeometry(.36, .4, .08, 14), mat(OLIVE));
      disc.position.y = -.46; group.add(disc);
      m.part = box(group, RED, .1, .04, .1, 0, -.4, 0);
      break;
    }
    case TrapKind.BearTrap: {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(.34, .03, 5, 18), mat(STEEL));
      ring.rotation.x = Math.PI / 2; ring.position.y = -.47; group.add(ring);
      box(group, DARK, .16, .05, .16, 0, -.46, 0);
      const jaw = (side: number) => {
        const pivot = new THREE.Group(); pivot.position.set(0, -.46, 0); group.add(pivot);
        const arm = new THREE.Group(); arm.position.z = side * .02; pivot.add(arm);
        box(arm, STEEL, .66, .04, .03, 0, 0, side * .3);
        for (let i = -3; i <= 3; i++) {
          const t = box(arm, 0xe8ecf0, .04, .09, .03, i * .09, .05, side * .28);
          t.rotation.z = Math.PI / 4;
        }
        return pivot;
      };
      m.part = jaw(1); m.part2 = jaw(-1);
      break;
    }
    case TrapKind.ShockPlate:
    case TrapKind.PressurePlate: {
      const shock = kind === TrapKind.ShockPlate;
      m.part = box(group, shock ? 0x3c4250 : 0x767e88, .86, .06, .86, 0, -.46, 0);
      if (shock) {
        for (const z of [-.22, 0, .22]) box(m.part, 0x8fd3ff, .7, .012, .02, 0, .035, z, { glow: true, opacity: .7 });
      } else box(m.part, RED, .16, .012, .16, 0, .035, 0);
      break;
    }
    case TrapKind.Tripwire: {
      const g = new THREE.Group(); group.add(g); faceGroup(g, facing);
      box(g, STEEL, .06, .5, .06, 0, -.25, -.4);
      box(g, DARK, .18, .14, .12, 0, 0, -.38);
      box(g, HOT, .08, .08, .02, 0, 0, -.31, { glow: true });
      const beam = new THREE.Mesh(new THREE.BoxGeometry(.018, .018, 1), mat(0xff2a1a, { glow: true, opacity: .85 }));
      group.add(beam); m.beam = beam;
      break;
    }
    case TrapKind.Claymore: {
      const g = new THREE.Group(); group.add(g); faceGroup(g, facing);
      const body = box(g, OLIVE, .5, .28, .09, 0, -.26, 0);
      body.rotation.x = -.12;
      box(g, 0xd9cf95, .36, .03, .092, 0, -.2, .005);
      for (const x of [-.18, .18]) box(g, DARK, .03, .16, .03, x, -.44, -.04);
      // Twin aim lasers splaying out in front.
      const laserGeo = new THREE.BoxGeometry(.012, .012, 4.2);
      for (const side of [-1, 1]) {
        const l = new THREE.Mesh(laserGeo, mat(0xff2a1a, { glow: true, opacity: .45 }));
        const a = side * .55;
        l.position.set(Math.sin(a) * 2.1, -.2, Math.cos(a) * 2.1); l.rotation.y = a;
        g.add(l);
        if (side < 0) m.beam = l; else m.beam2 = l;
      }
      break;
    }
    case TrapKind.FlameJet: {
      const g = new THREE.Group(); group.add(g); faceGroup(g, facing);
      box(g, DARK, .22, .22, .1, 0, 0, .52);
      const flame = new THREE.Group(); g.add(flame);
      for (const [r, len, c] of [[.45, 4.2, 0xff5a14], [.28, 3.2, 0xffb030], [.14, 2.2, 0xfff3b0]] as const) {
        const cone = new THREE.Mesh(new THREE.ConeGeometry(r, len, 9, 1, true), mat(c, { glow: true, opacity: .75 }));
        cone.rotation.x = Math.PI * 1.5; // tip at the nozzle, flaring outward
        cone.position.z = .55 + len / 2;
        flame.add(cone);
      }
      flame.visible = false; m.part = flame;
      break;
    }
    case TrapKind.DartLauncher:
    case TrapKind.NetLauncher: {
      const g = new THREE.Group(); group.add(g); faceGroup(g, facing);
      const dart = kind === TrapKind.DartLauncher;
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(dart ? .05 : .14, dart ? .06 : .16, .16, 10), mat(DARK));
      barrel.rotation.x = Math.PI / 2; barrel.position.z = .56; g.add(barrel);
      m.part = barrel;
      const tracer = new THREE.Mesh(new THREE.BoxGeometry(dart ? .025 : .5, dart ? .025 : .5, 1),
        mat(dart ? 0x9dff7a : 0xe6dcc0, { glow: dart, opacity: dart ? .9 : .7 }));
      tracer.visible = false; group.add(tracer); m.beam = tracer;
      break;
    }
    case TrapKind.MotionSensor: {
      const sweep = new THREE.Mesh(new THREE.CircleGeometry(5, 18, 0, .5), mat(0x6dff9a, { glow: true, opacity: .09 }));
      sweep.rotation.x = -Math.PI / 2; sweep.position.y = -.2; group.add(sweep); m.part = sweep;
      break;
    }
    case TrapKind.AlarmBell: {
      const ring = new THREE.Mesh(new THREE.RingGeometry(.4, .48, 24), mat(0xffd35a, { glow: true, opacity: .8 }));
      ring.rotation.x = -Math.PI / 2; ring.visible = false; group.add(ring); m.part = ring;
      break;
    }
    default:
      break;
  }
  // Channel pip: a small coloured stud only the owner and allies see.
  const pip = box(group, 0xffffff, .09, .05, .09, .36, kind === TrapKind.FallTrap || kind === TrapKind.WallTrap ||
    kind === TrapKind.Timer || kind === TrapKind.FlameJet || kind === TrapKind.DartLauncher ||
    kind === TrapKind.NetLauncher ? .53 : -.38, .36);
  m.pip = pip;
  return m;
}

function dispose(m: TrapModel): void {
  m.group.traverse(o => { if (o instanceof THREE.Mesh) o.geometry.dispose(); });
}

export class TrapModels {
  private readonly models = new Map<string, TrapModel>();
  private clock = 0;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly field: TrapField,
    private readonly solid: (x: number, y: number, z: number) => boolean,
  ) {}

  /** A trap event from the sim/server: kick off its animation. */
  fx(x: number, y: number, z: number, what: TrapFxWhat, tx?: number, ty?: number, tz?: number): void {
    const m = this.models.get(`${x},${y},${z}`);
    if (!m) return;
    if (what === 'fire' || what === 'trip' || what === 'ring') m.flash = what === 'ring' ? 1.2 : .6;
    if (what === 'reset') m.anim = Math.min(m.anim, 1);
    if (what === 'fire' && m.beam && (m.kind === TrapKind.DartLauncher || m.kind === TrapKind.NetLauncher) &&
        tx !== undefined && ty !== undefined && tz !== undefined) {
      const from = new THREE.Vector3(x + .5, y + .5, z + .5);
      const to = new THREE.Vector3(tx, ty, tz);
      const len = from.distanceTo(to);
      m.beam.visible = true;
      m.beam.scale.z = Math.max(.1, len);
      m.beam.position.copy(from.clone().add(to).multiplyScalar(.5)).sub(m.group.position);
      m.beam.lookAt(to);
    }
  }

  update(dt: number, viewer: TrapViewer): void {
    const step = Math.max(0, Math.min(.1, dt));
    this.clock += step;
    const seen = new Set<string>();
    for (const e of this.field.entries()) {
      const s = e.state;
      if (Math.abs(e.x - viewer.x) > VIEW_RANGE || Math.abs(e.z - viewer.z) > VIEW_RANGE ||
          Math.abs(e.y - viewer.y) > VIEW_RANGE) continue;
      seen.add(e.key);
      let m = this.models.get(e.key);
      if (!m || m.kind !== s.kind || m.facing !== s.facing) {
        if (m) { this.scene.remove(m.group); dispose(m); }
        m = build(s.kind, s.facing);
        m.group.position.set(e.x + .5, e.y + .5, e.z + .5);
        this.scene.add(m.group);
        this.models.set(e.key, m);
      }
      this.animate(m, s, e.x, e.y, e.z, viewer, step);
    }
    for (const [k, m] of this.models) if (!seen.has(k)) { this.scene.remove(m.group); dispose(m); this.models.delete(k); }
  }

  private animate(m: TrapModel, s: TrapState, x: number, y: number, z: number, viewer: TrapViewer, dt: number): void {
    const friendly = !s.owner || trapFriendly(s, viewer.name, viewer.faction);
    const dist = Math.hypot(x + .5 - viewer.x, y + .5 - viewer.y, z + .5 - viewer.z);
    const revealed = dist <= viewer.reveal;
    const hidden = trapConcealed(s.kind) && !friendly && !revealed;
    // Freshly-placed (still arming) traps are visible to everyone for a beat.
    m.group.visible = !hidden || s.arm > 0;
    m.halo.visible = !friendly && revealed && trapConcealed(s.kind);
    if (m.halo.visible) (m.halo.material as THREE.MeshBasicMaterial).opacity = .45 + .4 * Math.abs(Math.sin(this.clock * 4));
    if (m.pip) {
      m.pip.visible = friendly && !!s.owner;
      m.pip.material = mat(parseInt(CHANNEL_COLORS[s.channel]?.slice(1) ?? 'ffffff', 16));
    }
    m.flash = Math.max(0, m.flash - dt);
    const target = s.on ? 1 : 0;
    m.anim += (target - m.anim) * Math.min(1, dt * (target > m.anim ? 22 : 5));

    switch (s.kind) {
      case TrapKind.Spike:
        if (m.part) { m.part.position.y = -.62 + m.anim * .42; m.part.visible = m.anim > .02 || friendly || revealed; }
        break;
      case TrapKind.Landmine:
        if (m.part) (m.part as THREE.Mesh).material = mat(s.fuse > 0 && Math.sin(this.clock * 40) > 0 ? 0xffffff
          : s.arm > 0 ? 0x3aff6a : RED);
        break;
      case TrapKind.BearTrap: {
        const a = (1 - m.anim) * 1.35;
        if (m.part) m.part.rotation.x = a;
        if (m.part2) m.part2.rotation.x = -a;
        break;
      }
      case TrapKind.ShockPlate:
      case TrapKind.PressurePlate:
        if (m.part) m.part.position.y = -.46 - (m.flash > 0 ? .03 : 0);
        if (s.kind === TrapKind.ShockPlate && m.part) m.part.scale.setScalar(m.flash > 0 ? 1 + Math.random() * .05 : 1);
        break;
      case TrapKind.Tripwire: {
        m.recalc -= dt;
        if (m.beam && m.recalc <= 0) {
          m.recalc = .5;
          const cells = tripwireCells(x, y, z, s.facing, this.solid);
          const d = FACING_DIRS[s.facing] ?? FACING_DIRS[0];
          const len = Math.max(.05, cells.length + .4);
          m.beam.scale.z = len;
          m.beam.position.set(d[0] * (len / 2 - .1), d[1] * (len / 2 - .1), d[2] * (len / 2 - .1));
          m.beam.rotation.set(0, 0, 0);
          if (d[1]) m.beam.rotation.x = Math.PI / 2; else m.beam.rotation.y = Math.atan2(d[0], d[2]);
        }
        if (m.beam) {
          m.beam.visible = friendly || revealed;
          (m.beam.material as THREE.MeshBasicMaterial).opacity = m.flash > 0 ? 1 : .55 + .25 * Math.sin(this.clock * 6);
        }
        break;
      }
      case TrapKind.Claymore:
        for (const l of [m.beam, m.beam2]) {
          if (l) (l.material as THREE.MeshBasicMaterial).opacity = s.arm > 0 ? .1 : .3 + .15 * Math.sin(this.clock * 3);
        }
        break;
      case TrapKind.FlameJet: {
        const lit = s.timer > 0 || m.flash > 0;
        if (m.part) {
          m.part.visible = lit;
          if (lit) m.part.children.forEach((c, i) => c.scale.set(
            1 + Math.sin(this.clock * (13 + i * 5)) * .15, 1 + Math.sin(this.clock * (9 + i * 3)) * .1, 1));
        }
        break;
      }
      case TrapKind.DartLauncher:
      case TrapKind.NetLauncher:
        if (m.beam && m.flash <= .45) m.beam.visible = false;
        if (m.part) m.part.position.z = .56 - (m.flash > .4 ? .06 : 0);
        break;
      case TrapKind.MotionSensor:
        if (m.part) {
          m.part.rotation.z = this.clock * 2.4;
          (m.part as THREE.Mesh).material = mat(m.flash > 0 ? 0xff5a4a : 0x6dff9a, { glow: true, opacity: m.flash > 0 ? .22 : .09 });
          m.part.visible = friendly || m.flash > 0;
        }
        break;
      case TrapKind.AlarmBell:
        if (m.part) {
          m.part.visible = m.flash > 0;
          if (m.flash > 0) { const k = 1 + (1.2 - m.flash) * 5; m.part.scale.set(k, k, k); }
        }
        break;
      default:
        break;
    }
  }
}
