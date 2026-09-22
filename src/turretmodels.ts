// Animated models for placed TURRETS, in the same seeded industrial skin as
// machinemodels.ts. The block cell is an armoured mount (the mesher skips the
// cube); a twin-barrel gun head sits on top of it, yawing and pitching to track
// its target. Shots come from the server (`turretFire`): the head snaps onto
// the target, one barrel recoils, the muzzle flashes and a glowing shell flies
// out to the hit point. Between shots an armed turret sweeps the area, an empty
// one droops, and a sabotaged one sparks and smokes.

import * as THREE from 'three';
import {
  TURRET_MUZZLE_Y, turretArmed, turretDisabled, turretRange,
  type TurretState,
} from './turrets';
import { factionColor } from './teams';
import { industrialBox, industrialCylinder, industrialMesh, mergeStatic } from './machinemodels';
import type { Particles } from './particles';

const STEEL = 0x9aa7b3, DARK = 0x323a44, GUN = 0x262b31, OLIVE = 0x5d6b45;
const BRASS = 0xd9a441, LIGHT = 0xdae4e6;

const HEAD_Y = 1.0;                 // head turntable sits on top of the block
const CRADLE_Y = TURRET_MUZZLE_Y - HEAD_Y;
const BARREL_X = 0.1;
const MUZZLE_Z = -0.74;
const SHELL_SPEED = 70;             // blocks/s (cosmetic; the hit is server-side)
const IDLE_AFTER = 2.5;             // seconds without a shot before it starts sweeping

const LAMP_ARMED = 0x5dff8a, LAMP_HOT = 0xff3b30, LAMP_EMPTY = 0xffb347, LAMP_OFF = 0x3a3f45;

interface Barrel { group: THREE.Group; flash: THREE.Mesh; recoil: number; }

interface Entry {
  group: THREE.Group;
  head: THREE.Group;     // yaws
  cradle: THREE.Group;   // pitches
  barrels: [Barrel, Barrel];
  lamp: THREE.MeshBasicMaterial;
  eyeMat: THREE.MeshBasicMaterial;
  stripe: THREE.MeshBasicMaterial;
  flashMat: THREE.MeshBasicMaterial;
  faction: number;
  yaw: number; pitch: number;          // rendered
  aimYaw: number; aimPitch: number;    // wanted
  sinceShot: number;
  nextBarrel: 0 | 1;
  phase: number;
  fxTimer: number;
}

interface Shell {
  mesh: THREE.Mesh; trail: THREE.Line;
  pos: THREE.Vector3; dir: THREE.Vector3; left: number;
}

const tmp = new THREE.Vector3();

/** Rendered yaw for a world heading atan2(dx, dz): barrels model local -Z, and
 *  rotation.y = h + PI turns -Z onto (sin h, 0, cos h). */
function headYaw(heading: number): number { return heading + Math.PI; }

function wrap(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

export class TurretModels {
  private readonly models = new Map<string, Entry>();
  private readonly shells: Shell[] = [];
  private readonly shellGeo = new THREE.SphereGeometry(0.075, 8, 6);
  private readonly shellMat = new THREE.MeshBasicMaterial({ color: 0xffe08a });
  private readonly trailMat = new THREE.LineBasicMaterial({
    color: 0xffc24a, transparent: true, opacity: 0.85,
  });
  private readonly flashGeo = new THREE.PlaneGeometry(0.34, 0.34);
  private ring: { key: string; line: THREE.LineLoop; radius: number } | null = null;
  private ringKey: string | null = null;
  private clock = 0;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly turrets: Map<string, TurretState>,
    private readonly particles?: Particles,
  ) {}

  private build(faction: number): Entry {
    const group = new THREE.Group();
    // --- Mount: the block cell itself, merged into a few static meshes. ---
    industrialBox(group, DARK, 0.98, 0.16, 0.98, 0, 0.08, 0, 'paint');
    for (const x of [-0.4, 0.4]) for (const z of [-0.4, 0.4]) {
      industrialBox(group, GUN, 0.16, 0.12, 0.16, x, 0.2, z, 'rubber');
      industrialCylinder(group, LIGHT, 0.03, 0.03, x, 0.27, z);
    }
    industrialMesh(group, new THREE.CylinderGeometry(0.38, 0.46, 0.62, 8), STEEL, 'paint')
      .position.set(0, 0.47, 0);
    for (let i = 0; i < 4; i++) {
      const a = i * Math.PI / 2;
      const vent = industrialBox(group, DARK, 0.3, 0.2, 0.02,
        Math.sin(a) * 0.4, 0.45, Math.cos(a) * 0.4, 'vent');
      vent.rotation.y = a;
      const band = industrialBox(group, BRASS, 0.52, 0.06, 0.02,
        Math.sin(a) * 0.44, 0.2, Math.cos(a) * 0.44, 'hazard');
      band.rotation.y = a;
    }
    industrialMesh(group, new THREE.CylinderGeometry(0.36, 0.38, 0.12, 16), DARK, 'metal')
      .position.set(0, 0.84, 0);
    industrialCylinder(group, GUN, 0.3, 0.08, 0, 0.94, 0);
    // Ammo can + feed chute on the right flank.
    industrialBox(group, OLIVE, 0.2, 0.26, 0.3, 0.42, 0.52, 0.08, 'paint');
    industrialBox(group, BRASS, 0.06, 0.2, 0.08, 0.42, 0.74, 0.08, 'metal');
    mergeStatic(group);

    // Faction stripes: a live material so a hacked turret repaints itself.
    const stripe = new THREE.MeshBasicMaterial({ color: factionColor(faction) });
    for (let i = 0; i < 4; i++) {
      const a = i * Math.PI / 2 + Math.PI / 4;
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.08, 0.02), stripe);
      m.position.set(Math.sin(a) * 0.4, 0.66, Math.cos(a) * 0.4);
      m.rotation.y = a;
      group.add(m);
    }

    // --- Head: yaws on the turntable. ---
    const head = new THREE.Group();
    head.position.y = HEAD_Y;
    group.add(head);
    industrialCylinder(head, DARK, 0.3, 0.06, 0, 0.03, 0);
    industrialBox(head, STEEL, 0.44, 0.26, 0.5, 0, 0.2, 0.04, 'paint');
    const brow = industrialBox(head, STEEL, 0.44, 0.1, 0.22, 0, 0.3, -0.24, 'paint');
    brow.rotation.x = -0.45;
    for (const s of [-1, 1]) {
      industrialBox(head, DARK, 0.06, 0.3, 0.46, s * 0.25, 0.2, 0.02, 'metal');
    }
    // Drum magazine on the back + a whip antenna.
    const drum = industrialMesh(head, new THREE.CylinderGeometry(0.13, 0.13, 0.3, 14), OLIVE, 'paint');
    drum.rotation.z = Math.PI / 2;
    drum.position.set(0, 0.2, 0.34);
    industrialBox(head, GUN, 0.02, 0.36, 0.02, -0.17, 0.5, 0.22);
    mergeStatic(head);
    // Sensor eye: the status lamp.
    const lamp = new THREE.MeshBasicMaterial({ color: LAMP_OFF });
    const eyeMat = new THREE.MeshBasicMaterial({ color: GUN });
    const eyeHousing = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.1, 0.1), eyeMat);
    eyeHousing.position.set(0.12, 0.39, -0.12);
    const eye = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.02, 10), lamp);
    eye.rotation.x = Math.PI / 2;
    eye.position.set(0.12, 0.39, -0.175);
    head.add(eyeHousing, eye);

    // --- Cradle: pitches; carries the twin barrels. ---
    const cradle = new THREE.Group();
    cradle.position.set(0, CRADLE_Y, -0.08);
    head.add(cradle);
    const flashMat = new THREE.MeshBasicMaterial({
      color: 0xffd27a, transparent: true, opacity: 0.95,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    });
    const mkBarrel = (x: number): Barrel => {
      const g = new THREE.Group();
      g.position.x = x;
      cradle.add(g);
      const tube = industrialMesh(g, new THREE.CylinderGeometry(0.042, 0.05, 0.62, 10), GUN, 'metal');
      tube.rotation.x = Math.PI / 2;
      tube.position.z = -0.34;
      for (const z of [-0.18, -0.3, -0.42]) {
        const fin = industrialMesh(g, new THREE.CylinderGeometry(0.062, 0.062, 0.03, 10), DARK, 'metal');
        fin.rotation.x = Math.PI / 2;
        fin.position.z = z;
      }
      const brake = industrialMesh(g, new THREE.CylinderGeometry(0.066, 0.058, 0.1, 8), STEEL, 'vent');
      brake.rotation.x = Math.PI / 2;
      brake.position.z = MUZZLE_Z + 0.06;
      mergeStatic(g);
      // Crossed additive planes read as a star-shaped flash from any angle.
      const flash = new THREE.Mesh(this.flashGeo, flashMat);
      const flash2 = new THREE.Mesh(this.flashGeo, flashMat);
      flash2.rotation.y = Math.PI / 2;
      flash.add(flash2);
      flash.position.z = MUZZLE_Z - 0.1;
      flash.visible = false;
      g.add(flash);
      return { group: g, flash, recoil: 0 };
    };
    const barrels: [Barrel, Barrel] = [mkBarrel(-BARREL_X), mkBarrel(BARREL_X)];

    return {
      group, head, cradle, barrels, lamp, eyeMat, stripe, flashMat, faction,
      yaw: 0, pitch: -0.3, aimYaw: 0, aimPitch: -0.3,
      sinceShot: 99, nextBarrel: 0, phase: Math.random() * Math.PI * 2, fxTimer: 0,
    };
  }

  private entryAt(x: number, y: number, z: number): Entry | undefined {
    return this.models.get(`${x},${y},${z}`);
  }

  /** A turret at block (x,y,z) fired at world point (tx,ty,tz): snap its head
   *  onto the target, kick a barrel, flash the muzzle and launch a shell. */
  fireTracer(x: number, y: number, z: number, tx: number, ty: number, tz: number): void {
    const ox = x + 0.5, oy = y + TURRET_MUZZLE_Y, oz = z + 0.5;
    const dx = tx - ox, dy = ty - oy, dz = tz - oz;
    const horiz = Math.hypot(dx, dz);
    const yaw = headYaw(Math.atan2(dx, dz));
    const pitch = Math.max(-0.9, Math.min(1.2, Math.atan2(dy, horiz)));
    const e = this.entryAt(x, y, z);
    let from = new THREE.Vector3(ox, oy, oz);
    if (e) {
      e.aimYaw = e.yaw = yaw;
      e.aimPitch = e.pitch = pitch;
      e.head.rotation.y = yaw;
      e.cradle.rotation.x = pitch;
      e.sinceShot = 0;
      const b = e.barrels[e.nextBarrel];
      e.nextBarrel = e.nextBarrel === 0 ? 1 : 0;
      b.recoil = 1;
      b.flash.visible = true;
      b.flash.rotation.z = Math.random() * Math.PI;
      b.flash.scale.setScalar(0.8 + Math.random() * 0.6);
      e.group.updateMatrixWorld(true);
      from = b.flash.getWorldPosition(new THREE.Vector3());
    }
    this.particles?.burst(from.x, from.y, from.z, 5, 0x9a9a9a, 1.6, 0.55,
      { gravity: -0.6, spread: 0.15, scale: 0.9 });
    this.particles?.burst(from.x, from.y, from.z, 4, 0xffc24a, 5, 0.18,
      { gravity: 2, spread: 0.08, scale: 0.4 });
    // Ejected brass tumbling off the side of the head.
    if (e) {
      const side = tmp.set(Math.cos(yaw), 0, -Math.sin(yaw)).multiplyScalar(0.3);
      this.particles?.burst(ox + side.x, y + HEAD_Y + 0.25, oz + side.z, 1, BRASS, 2.5, 0.6,
        { gravity: 12, spread: 0.05, scale: 0.35 });
    }
    const to = new THREE.Vector3(tx, ty, tz);
    const dir = to.clone().sub(from);
    const len = dir.length();
    if (len < 0.01) return;
    dir.divideScalar(len);
    const mesh = new THREE.Mesh(this.shellGeo, this.shellMat);
    mesh.position.copy(from);
    const trail = new THREE.Line(new THREE.BufferGeometry().setFromPoints([from, from]), this.trailMat);
    this.scene.add(mesh, trail);
    this.shells.push({ mesh, trail, pos: from.clone(), dir, left: len });
  }

  /** Show the attack-range ring around one turret (the open panel's), or none. */
  showRange(x: number | null, y = 0, z = 0): void {
    this.ringKey = x === null ? null : `${x},${y},${z}`;
  }

  update(dt: number): void {
    this.clock += dt;
    const seen = new Set<string>();
    for (const [key, state] of this.turrets) {
      seen.add(key);
      let e = this.models.get(key);
      if (!e) {
        e = this.build(state.faction);
        const [x, y, z] = key.split(',').map(Number);
        e.group.position.set(x + 0.5, y, z + 0.5);
        e.yaw = e.aimYaw = headYaw(state.facingYaw);
        this.scene.add(e.group);
        this.models.set(key, e);
      }
      this.animate(e, state, dt);
    }
    for (const [key, e] of this.models) {
      if (!seen.has(key)) { this.scene.remove(e.group); this.dispose(e); this.models.delete(key); }
    }
    this.updateRing();
    this.updateShells(dt);
  }

  private animate(e: Entry, s: TurretState, dt: number): void {
    if (e.faction !== s.faction) { e.faction = s.faction; e.stripe.color.setHex(factionColor(s.faction)); }
    e.sinceShot += dt;
    const disabled = turretDisabled(s);
    const loaded = s.ammo >= 1 && s.fuel > 0;
    const live = !!s.owner && !disabled && loaded;
    const base = headYaw(s.facingYaw);
    if (!live) {
      // Unclaimed, dry or knocked out: barrels sag toward the ground.
      e.aimYaw = base;
      e.aimPitch = disabled ? -0.5 : -0.32;
    } else if (e.sinceShot > IDLE_AFTER) {
      // Armed and waiting: a slow sentry sweep either side of its last heading.
      const t = this.clock * 0.55 + e.phase;
      e.aimYaw = base + Math.sin(t) * 0.85;
      e.aimPitch = 0.04 + Math.sin(t * 1.7) * 0.06;
    }
    const k = Math.min(1, (live ? 6 : 2.5) * dt);
    e.yaw += wrap(e.aimYaw - e.yaw) * k;
    e.pitch += (e.aimPitch - e.pitch) * k;
    const jitter = disabled ? (Math.random() - 0.5) * 0.05 : 0;
    e.head.rotation.y = e.yaw + jitter;
    e.cradle.rotation.x = e.pitch;

    for (const b of e.barrels) {
      b.recoil = Math.max(0, b.recoil - dt * 7);
      b.group.position.z = b.recoil * b.recoil * 0.16;
      if (b.flash.visible && b.recoil < 0.62) b.flash.visible = false;
    }

    // Status eye: hot red right after firing, green when armed, amber when
    // it needs ammo/oil, dark when unclaimed, flickering red when disabled.
    let lamp = LAMP_OFF;
    if (disabled) lamp = Math.sin(this.clock * 19 + e.phase) > 0.2 ? LAMP_HOT : LAMP_OFF;
    else if (!s.owner) lamp = LAMP_OFF;
    else if (!loaded) lamp = Math.sin(this.clock * 4 + e.phase) > -0.3 ? LAMP_EMPTY : LAMP_OFF;
    else if (e.sinceShot < 1.2) lamp = LAMP_HOT;
    else lamp = turretArmed(s) || s.cooldown > 0 ? LAMP_ARMED : LAMP_EMPTY;
    e.lamp.color.setHex(lamp);

    // Battle damage: sparks below half HP, black smoke once knocked offline.
    const frac = s.maxHp > 0 ? s.hp / s.maxHp : 1;
    if (this.particles && frac < 0.5) {
      e.fxTimer -= dt;
      if (e.fxTimer <= 0) {
        const p = e.group.position;
        if (disabled) {
          e.fxTimer = 0.18;
          this.particles.burst(p.x, p.y + 1.25, p.z, 2, 0x2b2b2b, 0.8, 1.3,
            { gravity: -1.8, spread: 0.3, scale: 1.4 });
        } else {
          e.fxTimer = 0.5 + Math.random() * 1.2;
        }
        if (Math.random() < 0.6) {
          this.particles.burst(p.x, p.y + 1.1, p.z, 3, 0xffd966, 4, 0.25,
            { gravity: 9, spread: 0.4, scale: 0.35 });
        }
      }
    }
  }

  private updateRing(): void {
    const key = this.ringKey;
    const s = key ? this.turrets.get(key) : undefined;
    if (!key || !s) {
      if (this.ring) { this.scene.remove(this.ring.line); this.ring.line.geometry.dispose(); this.ring = null; }
      return;
    }
    const radius = turretRange(s.level);
    if (!this.ring || this.ring.key !== key || this.ring.radius !== radius) {
      if (this.ring) { this.scene.remove(this.ring.line); this.ring.line.geometry.dispose(); }
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i < 96; i++) {
        const a = (i / 96) * Math.PI * 2;
        pts.push(new THREE.Vector3(Math.sin(a) * radius, 0, Math.cos(a) * radius));
      }
      const line = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts),
        new THREE.LineBasicMaterial({ color: 0xff5a4a, transparent: true, opacity: 0.7, depthTest: false }));
      const [x, y, z] = key.split(',').map(Number);
      line.position.set(x + 0.5, y + 0.06, z + 0.5);
      line.renderOrder = 10;
      this.scene.add(line);
      this.ring = { key, line, radius };
    }
    const m = this.ring.line.material as THREE.LineBasicMaterial;
    m.opacity = 0.45 + 0.3 * Math.sin(this.clock * 3);
  }

  private updateShells(dt: number): void {
    for (let i = this.shells.length - 1; i >= 0; i--) {
      const sh = this.shells[i];
      const step = Math.min(sh.left, SHELL_SPEED * dt);
      sh.pos.addScaledVector(sh.dir, step);
      sh.left -= step;
      sh.mesh.position.copy(sh.pos);
      const tail = tmp.copy(sh.pos).addScaledVector(sh.dir, -1.8);
      const attr = sh.trail.geometry.getAttribute('position') as THREE.BufferAttribute;
      attr.setXYZ(0, tail.x, tail.y, tail.z);
      attr.setXYZ(1, sh.pos.x, sh.pos.y, sh.pos.z);
      attr.needsUpdate = true;
      if (sh.left <= 0) {
        this.particles?.burst(sh.pos.x, sh.pos.y, sh.pos.z, 8, 0xffb04a, 5, 0.3,
          { gravity: 6, spread: 0.2, scale: 0.5 });
        this.particles?.burst(sh.pos.x, sh.pos.y, sh.pos.z, 5, 0x6d6d6d, 1.5, 0.7,
          { gravity: -0.5, spread: 0.3, scale: 1.1 });
        this.scene.remove(sh.mesh, sh.trail);
        sh.trail.geometry.dispose();
        this.shells.splice(i, 1);
      }
    }
  }

  private dispose(e: Entry): void {
    e.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry && m.geometry !== this.flashGeo) m.geometry.dispose();
    });
    // Per-entry materials; the textured surfaces are shared for the session.
    e.lamp.dispose(); e.eyeMat.dispose(); e.stripe.dispose(); e.flashMat.dispose();
  }
}
