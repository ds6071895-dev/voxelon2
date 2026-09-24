// First-person held item in the bottom-right: mini-block or sprite parented
// to the camera, with a swing animation while mining/placing, and — for guns —
// a full weapon-feel layer: spring recoil, a cycling action (slide, bolt, pump,
// warhead), sight-aligned aim-down-sights, look-lag sway, walk bob, a draw
// animation, choreographed reloads, muzzle flash, smoke and flying brass.

import * as THREE from 'three';
import { itemGeometry } from './itementity';
import { Item, ITEMS } from './items';
import { avatarTexture } from './avatartex';
import { skinColorFor } from './remoteplayers';

/** The avatar's glove colour (see buildAvatarBody), lifted a touch so the fist
 *  still reads against a dark screen edge. */
const HELD_GLOVE = new THREE.Color(0x3a3b3e);
import { Cosmetics, SHIRT_COLORS, defaultCosmetics } from './character';
import type { Atlas } from './textures';
import { createGunModel, poseGunModel, gunFeel, GunFeel } from './gunmodels';
import { createGadgetModel, isModeledGadget, poseGadgetModel } from './gadgetmodels';
import { HEAL_BEAT } from './healuse';
import { createBowModel, poseBowModel, poseBowDraw } from './bowmodel';

/** 0..1 ease with flat ends, clamped outside the range. */
function smoothstep(x: number): number {
  const t = Math.max(0, Math.min(1, x));
  return t * t * (3 - 2 * t);
}

// Rest pose of the held item in camera space. At the game's 70° FOV, y=-0.42
// put the hand ~86% of the way down the screen — so low it read as falling off
// the bottom edge. -0.30 sits it around two-thirds down, where the eye expects
// a held weapon to be.
const BASE_X = 0.42, BASE_Y = -0.3, BASE_Z = -0.7;

// Recoil spring. Stiff enough to snap back inside a fast gun's cooldown, damped
// enough that it never wobbles: this is the difference between "the gun jumped"
// and "the gun is oscillating".
const KICK_STIFF = 150, KICK_DAMP = 17;
// How much of the weapon's kick the camera inherits. main applies this AFTER
// the shot direction is computed, so it is purely visual and never spoils aim.
const CAMERA_KICK = 0.2;
// How far the weapon sits from the eye while aiming. Only x/y decide whether
// the sights are centred (a point at (0,0,z) is on the camera axis at ANY
// depth), so this is purely about how much gun you want in frame — pulling it
// to the sight's own eye relief would bury the camera inside the receiver.
const ADS_Z = -0.66;
// A scoped weapon is the exception: the eye goes right behind the eyepiece, so
// the tube frames the whole sight picture the way a scope is supposed to.
const EYE_RELIEF = 0.13;

const FLASH_CORE = 0xfff2c4, FLASH_FRINGE = 0xff9c38;
const MAX_SHELLS = 10, MAX_SMOKE = 14;

interface Shell {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  vel: THREE.Vector3;
  spin: THREE.Vector3;
  life: number;
}

interface Puff {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  vel: THREE.Vector3;
  life: number;
  maxLife: number;
  size: number;
}

/** Mechanical noises the view asks for, so audio stays in main. */
export type GunSound = 'cycle' | 'magOut' | 'magIn' | 'shellDrop';

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
function easeOut(t: number): number {
  const k = 1 - clamp(t, 0, 1);
  return 1 - k * k * k;
}
/** 0 → 1 → 0 with a fast leading edge: the shape of a reciprocating action. */
function stroke(u: number, back = 0.4): number {
  if (u <= 0 || u >= 1) return 0;
  return u < back ? easeOut(u / back) : 1 - smoothstep((u - back) / (1 - back));
}

export class HeldItemView {
  private readonly camera: THREE.Camera;
  private readonly pivot: THREE.Group;
  /** Camera-space effects (brass, smoke) that must NOT ride the gun's motion. */
  private readonly fx: THREE.Group;
  private readonly material: THREE.MeshBasicMaterial;
  private mesh: THREE.Object3D | null = null;
  private currentItem: number | null = null;
  private swingT = 1; // 0..1, animating while < 1
  /** The current swing is a full-charge axe release (a wider, heavier arc). */
  private heavySwing = false;
  /** Fires once whenever a new hand/tool swing begins. */
  onSwing?: () => void;
  /** Fires when the weapon's action makes a noise worth hearing. */
  onGunSound?: (kind: GunSound) => void;
  private healClock = 0; // seconds into the current heal-item application
  private aimT = 0;
  private isGun = false;
  private bowPower = 0;
  private bowReleaseT = 1;
  private isGadgetModel = false;
  /** A placeable block: shown as a bare mini-cube, with no fist behind it. */
  private isBlockItem = false;
  private feel: GunFeel = gunFeel(-1);
  private readonly atlas: Atlas;

  // Per-gun scene-graph handles, refreshed on every item change.
  private modelMats: THREE.MeshBasicMaterial[] = [];
  private partCycle: THREE.Object3D | null = null;
  private partMag: THREE.Object3D | null = null;
  private partBipod: THREE.Object3D | null = null;
  private partStock: THREE.Object3D | null = null;
  private anchorMuzzle: THREE.Object3D | null = null;
  private anchorEject: THREE.Object3D | null = null;
  private anchorSight: THREE.Object3D | null = null;
  private anchorGrip2: THREE.Object3D | null = null;
  private partSpool: THREE.Object3D | null = null;
  private partPad: THREE.Object3D | null = null;
  private partSpring: THREE.Object3D | null = null;

  // Animation state.
  private equipT = 1;          // 0..1 draw animation
  private cycleT = -1;         // seconds into the action's cycle (-1 = idle)
  private cycleDelay = 0;      // wait before a hand-worked action starts
  private ejected = false;     // one case per cycle
  private pendingShot = false; // spawn flash/brass on the next update
  private chambered = true;    // a fired single-shot tube stays empty until reloaded
  private recoilPulse = 0;     // 0..1 decaying, for the third-person body
  private kickZ = 0;
  private kickY = 0;
  private kickPitch = 0;
  private kickYaw = 0;
  private kickRoll = 0;
  private kickVZ = 0;
  private kickVY = 0;
  private kickVPitch = 0;
  private kickVYaw = 0;
  private kickVRoll = 0;
  private swayX = 0;
  private swayY = 0;
  private bobPhase = 0;
  private bobWeight = 0;
  private idleT = 0;
  private lastYaw = 0;
  private lastPitch = 0;
  private reloadStage = -1;    // last reload progress seen, for one-shot cues
  private gadgetBeat: 'grappleFire' | 'grappleRelease' | 'bounce' | null = null;
  private gadgetBeatT = 0;
  private gadgetSpin = 0;
  private spoolAngle = 0;
  private grappleReeling = false;

  // Muzzle flash: a stretched additive burst plus a two-quad star.
  private readonly flash: THREE.Group;
  private readonly flashMat: THREE.MeshBasicMaterial;
  private readonly flashStarMat: THREE.MeshBasicMaterial;
  private flashT = 1;
  private flashScale = 1;

  private readonly shells: Shell[] = [];
  private readonly puffs: Puff[] = [];
  private readonly shellGeo = new THREE.BoxGeometry(0.03, 0.03, 0.07);
  private readonly puffGeo = new THREE.BoxGeometry(1, 1, 1);

  // First-person arms: a skin-colored forearm + fist coming in from the
  // bottom-right, parented to the pivot so it swings/recoils with the item,
  // plus a support hand that rides the foregrip of any two-handed weapon.
  private readonly armMat: THREE.MeshBasicMaterial;
  private readonly sleeveMat: THREE.MeshBasicMaterial;
  private readonly gloveMat: THREE.MeshBasicMaterial;
  private readonly arm: THREE.Group;
  private readonly offArm: THREE.Group;
  private readonly baseSkin = new THREE.Color(0xc89a6a);
  private readonly baseSleeve = new THREE.Color(0x3f6f9c);

  private readonly scratch = new THREE.Vector3();
  private readonly scratchB = new THREE.Vector3();
  private readonly euler = new THREE.Euler(0, 0, 0, 'YXZ');

  constructor(camera: THREE.Camera, atlas: Atlas) {
    this.camera = camera;
    this.atlas = atlas;
    // depthTest must stay ON: without a depth buffer the cube's own faces
    // paint in submission order and the back faces cover the front, making it
    // look inside-out. The item sits very close to the camera so it still
    // reads as "in hand" without disabling depth.
    this.material = new THREE.MeshBasicMaterial({
      map: atlas.texture,
      alphaTest: 0.4,
      vertexColors: true,
      side: THREE.FrontSide,
    });
    this.pivot = new THREE.Group();
    this.pivot.position.set(BASE_X, BASE_Y, BASE_Z);
    this.pivot.renderOrder = 100;
    this.pivot.visible = false;
    camera.add(this.pivot);

    this.fx = new THREE.Group();
    this.fx.renderOrder = 102;
    camera.add(this.fx);

    // Muzzle flash. The burst is an octahedron stretched down the bore (a
    // chunky flame that suits the low-poly guns better than a soft sprite);
    // the star is two crossed quads that sell the initial pop.
    this.flash = new THREE.Group();
    this.flashMat = new THREE.MeshBasicMaterial({
      color: FLASH_CORE, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false,
      fog: false, toneMapped: false,
    });
    this.flashStarMat = new THREE.MeshBasicMaterial({
      color: FLASH_FRINGE, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false,
      side: THREE.DoubleSide, fog: false, toneMapped: false,
    });
    const burst = new THREE.Mesh(new THREE.OctahedronGeometry(0.11, 0), this.flashMat);
    burst.scale.set(1, 1, 2.4);
    this.flash.add(burst);
    for (let i = 0; i < 2; i++) {
      const star = new THREE.Mesh(new THREE.PlaneGeometry(0.44, 0.1), this.flashStarMat);
      star.rotation.z = i * Math.PI / 2;
      star.position.z = -0.06;
      this.flash.add(star);
    }
    this.flash.renderOrder = 103;
    this.flash.visible = false;
    this.pivot.add(this.flash);

    // First-person arms, textured like the avatar everyone else sees. The main
    // hand remains visible with an empty hotbar, like Minecraft's bare hand.
    this.armMat = new THREE.MeshBasicMaterial({
      color: this.baseSkin.clone(), map: avatarTexture('skin'),
    });
    this.sleeveMat = new THREE.MeshBasicMaterial({
      color: this.baseSleeve.clone(), map: avatarTexture('camo'),
    });
    // Tactical gloves, like the avatar's: the fist you see is gloved.
    this.gloveMat = new THREE.MeshBasicMaterial({
      color: HELD_GLOVE.clone(), map: avatarTexture('leather'),
    });
    this.arm = this.buildArm(1, 0.42);
    this.arm.position.set(0.05, -0.16, 0.06);
    this.arm.rotation.set(0.5, -0.32, 0.32);
    this.pivot.add(this.arm);
    // Support hand: a slimmer forearm reaching up from the lower left, so it
    // braces UNDER whatever foregrip the weapon exposes instead of crossing
    // over the receiver and hiding it. Forearm is extended so it stretches
    // down past the bottom edge of the screen even on forward-gripped guns.
    this.offArm = this.buildArm(0.82, 1.1);
    this.offArm.rotation.set(0.72, -0.62, 0.24);
    this.offArm.visible = false;
    this.pivot.add(this.offArm);
  }

  private buildArm(scale: number, forearmLength = 0.42): THREE.Group {
    const arm = new THREE.Group();
    const forearm = new THREE.Mesh(
      new THREE.BoxGeometry(0.17 * scale, 0.17 * scale, forearmLength), this.sleeveMat);
    // Stop before the camera near plane on the main arm; start just behind wrist and stretch down.
    forearm.position.set(0, 0, 0.01 + forearmLength * 0.5);
    arm.add(forearm);
    const wrist = new THREE.Mesh(
      new THREE.BoxGeometry(0.185 * scale, 0.185 * scale, 0.1), this.armMat);
    wrist.position.set(0, 0, 0.09); // bare skin between the cuff and the grip
    arm.add(wrist);
    arm.add(new THREE.Mesh( // gloved fist, at the item's own position
      new THREE.BoxGeometry(0.21 * scale, 0.21 * scale, 0.2 * scale), this.gloveMat));
    arm.renderOrder = 99; // just behind the item
    return arm;
  }

  /** Tint the first-person hand to the local player's skin tone — cosmetics-
   *  aware (so your own hand matches the avatar everyone else sees). */
  setSkin(seed: number, cosmetics?: Cosmetics): void {
    this.baseSkin.copy(skinColorFor(seed, cosmetics));
    const c = cosmetics ?? defaultCosmetics(seed);
    this.baseSleeve.setHex(SHIRT_COLORS[c.shirt]?.hex ?? SHIRT_COLORS[0].hex);
  }

  /** Show only in active first-person gameplay; item state is tracked separately. */
  setActive(active: boolean): void {
    this.pivot.visible = active;
    this.fx.visible = active;
  }

  setItem(id: number | null): void {
    // Keep the final consumed pad in view long enough to finish its spring snap.
    if (id === null && this.currentItem === Item.JumpBoost && this.gadgetBeat === 'bounce') return;
    if (id === this.currentItem) return;
    this.currentItem = id;
    this.bowPower = 0;
    this.bowReleaseT = 1;
    this.isGun = id !== null && !!ITEMS[id]?.gun;
    this.isGadgetModel = id !== null && isModeledGadget(id);
    // A modelled block item (the torch) is held in the fist, not floated.
    this.isBlockItem = id !== null && ITEMS[id]?.kind === 'block' && !this.isGadgetModel;
    this.feel = gunFeel(id ?? -1);
    if (this.mesh) {
      this.pivot.remove(this.mesh);
      this.mesh = null;
    }
    for (const m of this.modelMats) m.dispose();
    this.modelMats = [];
    this.partCycle = this.partMag = this.partBipod = this.partStock = null;
    this.anchorMuzzle = this.anchorEject = this.anchorSight = this.anchorGrip2 = null;
    this.partSpool = this.partPad = this.partSpring = null;
    this.gadgetBeat = null;
    this.gadgetSpin = 0;
    this.grappleReeling = false;
    this.cycleT = -1;
    this.flashT = 1;
    this.flash.visible = false;
    if (id !== null) {
      if (this.isGun) {
        const model = createGunModel(id);
        poseGunModel(model, 'firstPerson');
        // Guns share cached geometry AND materials with every other copy in the
        // world, so the first-person one needs its own material instances
        // before it can be tinted by the light where the player is standing.
        model.traverse((o) => {
          const m = o as THREE.Mesh;
          if (!m.isMesh || m.userData.glow) return;
          const mat = (m.material as THREE.MeshBasicMaterial).clone();
          this.modelMats.push(mat);
          m.material = mat;
        });
        this.mesh = model;
        this.partCycle = model.getObjectByName(this.feel.cyclePart) ?? null;
        this.partMag = model.getObjectByName('mag') ?? null;
        this.partBipod = model.getObjectByName('bipod') ?? null;
        this.partStock = model.getObjectByName('stock') ?? null;
        this.anchorMuzzle = model.getObjectByName('muzzle') ?? null;
        this.anchorEject = model.getObjectByName('eject') ?? null;
        this.anchorSight = model.getObjectByName('sight') ?? null;
        this.anchorGrip2 = model.getObjectByName('grip2') ?? null;
      } else if (id === Item.BridgeBow) {
        this.mesh = createBowModel();
        poseBowModel(this.mesh, 'firstPerson');
        this.mesh.traverse(o => {
          if (!(o instanceof THREE.Mesh)) return;
          const mat = (o.material as THREE.MeshBasicMaterial).clone();
          mat.userData.bowColor = mat.color.getHex();
          this.modelMats.push(mat);
          o.material = mat;
        });
      } else if (this.isGadgetModel) {
        const model = createGadgetModel(id);
        poseGadgetModel(model, 'firstPerson');
        model.traverse((o) => {
          const mesh = o as THREE.Mesh;
          if (!mesh.isMesh || mesh.userData.glow) return; // flames stay lit
          const mat = (mesh.material as THREE.MeshBasicMaterial).clone();
          this.modelMats.push(mat);
          mesh.material = mat;
        });
        this.mesh = model;
        this.partSpool = model.getObjectByName('spool') ?? null;
        this.partPad = model.getObjectByName('pad') ?? null;
        this.partSpring = model.getObjectByName('spring') ?? null;
      } else {
        const mesh = new THREE.Mesh(itemGeometry(this.atlas, id), this.material);
        mesh.scale.setScalar(1.4);
        mesh.rotation.set(0.1, -0.6, 0);
        this.mesh = mesh;
      }
      this.mesh.renderOrder = 100;
      this.pivot.add(this.mesh);
      this.equipT = 0; // draw it: a swap should look like a swap
    }
    this.offArm.visible = !!this.anchorGrip2;
    this.offArm.scale.setScalar(1);
    this.arm.position.set(0.05, -0.16, 0.06);
    this.offArm.rotation.set(0.72, -0.62, 0.24);
    // Hands are sized for an empty fist; a gun is a smaller, finer object, so
    // the grip hand shrinks a little rather than eclipsing the weapon.
    this.arm.scale.setScalar(this.isGun || this.isGadgetModel ? 0.86 : 1);
    // A held block is drawn as a floating mini-cube: the fist reads as a second
    // block stuck to the first, so the arm steps aside and the cube stands
    // alone. The arm stays visible with no item at all (the bare fist) and for
    // every sprite/model item; setActive controls POV visibility.
    this.arm.visible = !this.isBlockItem;
  }

  /** Set the bow pose; ordinary tools never enter it. */
  setBowDraw(power: number): void { this.bowPower = clamp(power, 0, 1); }

  releaseBow(power: number): void {
    this.bowPower = 0;
    this.bowReleaseT = 0;
    this.onSwing?.();
    this.kickVZ += .7 + power * 1.2;
    this.kickVPitch += .3 + power * .5;
    this.kickVRoll -= .4 * power;
  }

  /** Only called on a server-confirmed minigame melee hit. */
  meleeImpact(crit: boolean): void {
    this.kickVZ += crit ? 1.5 : .9;
    this.kickVRoll += crit ? 1.0 : .5;
  }

  /** Generic mining/placing swing (tools, blocks). */
  swing(): void {
    if (this.swingT >= 1) {
      this.swingT = 0;
      this.onSwing?.();
    }
  }

  /** A full-charge axe release. Reuses the same `swingT` spring as `swing()`
   *  — it is the ARC that differs, not the machinery — so a heavy hit reads as
   *  a bigger, slower commitment without a second animation system. */
  swingHeavy(): void {
    if (this.swingT >= 1) {
      this.swingT = 0;
      this.heavySwing = true;
      this.onSwing?.();
    }
  }

  /** 0 at rest, 1 at the middle of the current swing. */
  swingAmount(): number {
    if (this.swingT >= 1) return 0;
    // The heavy arc overshoots and lingers: same phase, wider reach.
    return Math.sin(this.swingT * Math.PI) * (this.heavySwing ? 1.45 : 1);
  }

  /** Gun fired: punch the recoil springs, pop the flash, work the action. */
  recoil(): void {
    const f = this.feel.kick;
    const braced = 1 - this.aimT * 0.3; // shouldered = less throw
    this.kickVZ += 1.6 * f * braced;
    this.kickVY += 0.55 * f * braced;
    this.kickVPitch += 2.4 * f * braced;
    this.kickVYaw += (Math.random() - 0.5) * 1.1 * f;
    this.kickVRoll += (Math.random() - 0.5) * 1.7 * f;
    this.recoilPulse = 1;
    this.flashT = 0;
    this.flashScale = this.feel.flash * (0.85 + Math.random() * 0.3);
    this.flash.rotation.z = Math.random() * Math.PI * 2;
    this.pendingShot = true;
    // Self-loading actions cycle instantly; a pump or a bolt is worked by hand
    // a beat after the shot, which is exactly what makes those guns feel heavy.
    this.cycleT = 0;
    this.ejected = false;
    this.chambered = false;
    this.cycleDelay = this.feel.action === 'pump' ? 0.12
      : this.feel.action === 'bolt' ? 0.22 : 0;
  }

  /** Mobility gadget fired: mechanical motion and a tailored view impulse,
   * without pretending the gadget has a muzzle flash or firearm action. */
  gadgetAction(kind: 'grappleFire' | 'grappleRelease' | 'bounce'): void {
    this.gadgetBeat = kind;
    this.gadgetBeatT = 0;
    this.recoilPulse = 1;
    if (kind === 'grappleFire') {
      this.gadgetSpin = -30;
      this.kickVZ += 1.5;
      this.kickVPitch += 1.5;
      this.kickVRoll -= 0.55;
    } else if (kind === 'grappleRelease') {
      this.gadgetSpin = 22;
      this.kickVZ += 0.75;
      this.kickVPitch -= 0.8;
    } else {
      this.kickVZ += 1.2;
      this.kickVY += 1.8;
      this.kickVPitch += 3.2;
      this.kickVRoll += (Math.random() - 0.5) * 0.8;
    }
  }

  setGrappleReeling(active: boolean): void {
    this.grappleReeling = active;
  }

  /** 0 at rest, 1 immediately after a shot; used by the local third-person body. */
  recoilAmount(): number {
    return this.recoilPulse;
  }

  /** Visual-only view punch from the last shot, in radians. main applies this
   *  after firing so it can never bend the bullet it just sent. */
  viewKick(out: { pitch: number; yaw: number; roll: number }): void {
    out.pitch = this.kickPitch * CAMERA_KICK;
    out.yaw = this.kickYaw * CAMERA_KICK;
    out.roll = this.kickRoll * CAMERA_KICK * 0.6;
  }

  update(
    dt: number, mining: boolean, sunlight: number,
    aiming = false, reloadProgress = -1, healProgress = -1,
    moveSpeed = 0, grounded = true
  ): void {
    const shade = 0.55 + 0.45 * sunlight;
    this.material.color.setScalar(shade);
    this.armMat.color.copy(this.baseSkin).multiplyScalar(shade);
    this.sleeveMat.color.copy(this.baseSleeve).multiplyScalar(shade);
    this.gloveMat.color.copy(HELD_GLOVE).multiplyScalar(shade);
    // A real block-breaking attempt swings the whole hand/item pivot regardless
    // of what is held. Gunfire still uses recoil because main only passes true
    // here when Interaction is actually working a block target.
    if (mining) this.swing();

    if (this.swingT < 1) {
      // A heavy swing takes longer to come round, which is what makes it read
      // as a commitment rather than a flick.
      this.swingT = Math.min(1, this.swingT + dt / (this.heavySwing ? 0.32 : 0.25));
      if (this.swingT >= 1) this.heavySwing = false;
    }
    if (this.equipT < 1) this.equipT = Math.min(1, this.equipT + dt / 0.34);
    this.recoilPulse = Math.max(0, this.recoilPulse - dt * 5);
    this.idleT += dt;
    const aimTarget = this.currentItem === Item.BridgeBow ? this.bowPower
      : this.isGun && aiming && reloadProgress < 0 ? 1 : 0;
    this.aimT += (aimTarget - this.aimT) * Math.min(1, dt * 14);
    const aim = smoothstep(this.aimT);

    this.stepSprings(dt);
    this.stepSway(dt, aim);
    this.stepBob(dt, moveSpeed, grounded);
    if (this.cycleT >= 0) this.stepCycle(dt);
    this.stepGadgetAction(dt);
    this.stepReloadCues(this.isGun ? reloadProgress : -1);
    if (this.flashT < 1) this.flashT = Math.min(1, this.flashT + dt / 0.075);

    let px = BASE_X, py = BASE_Y, pz = BASE_Z, rx = 0, ry = 0, rz = 0;
    if (this.currentItem === Item.BridgeBow && this.mesh) {
      this.bowReleaseT = Math.min(1, this.bowReleaseT + dt / .3);
      // A snap shot visibly plucks and settles the string after firing.
      // This animation never delays the arrow or changes its strength.
      const visualDraw = Math.max(this.bowPower, Math.pow(1 - this.bowReleaseT, 3));
      poseBowDraw(this.mesh, visualDraw, 1 - this.bowReleaseT, this.idleT);
      px -= aim * .16;
      py += .10 + aim * .07;
      pz -= aim * .06;
      rz += aim * .12;
      this.arm.position.set(0, -.025, .06);
      this.arm.scale.setScalar(.65);
      this.offArm.visible = visualDraw > .02;
      this.offArm.scale.setScalar(.55);
      const nock = this.mesh.getObjectByName('nock')!;
      this.offArm.position.copy(this.pointInPivot(nock, this.scratch));
      this.offArm.position.x += .045;
      this.offArm.position.y -= .035;
      this.offArm.rotation.set(.15, -.7, 0);
      for (const mat of this.modelMats)
        mat.color.setHex(mat.userData.bowColor).multiplyScalar(shade);
    }
    if (this.isGun && this.mesh) {
      // Aiming squares the weapon up with the view; hip fire keeps the relaxed
      // canted pose the model ships with.
      this.mesh.rotation.set(0.02 * (1 - aim), 0.02 * (1 - aim), 0);
      if (aim > 0.001 && this.anchorSight) {
        // Put the gun's OWN sight on the camera axis rather than guessing an
        // offset per weapon: every model carries a 'sight' anchor, so red dots,
        // scopes and iron sights all centre themselves with no per-gun tuning.
        const s = this.pointInPivot(this.anchorSight, this.scratch);
        const z = this.feel.scoped ? -EYE_RELIEF - s.z : ADS_Z;
        px = THREE.MathUtils.lerp(BASE_X, -s.x, aim);
        py = THREE.MathUtils.lerp(BASE_Y, -s.y, aim);
        pz = THREE.MathUtils.lerp(BASE_Z, z, aim);
      }
    }

    // Sway, bob and breathing ride on top of whichever base pose we chose.
    px += this.swayX; py += this.swayY;
    ry += this.swayX * 1.6; rz += -this.swayX * 1.1; rx += this.swayY * 1.5;
    const bobAmp = this.bobWeight * 0.022 * (1 - aim * 0.75);
    px += Math.sin(this.bobPhase) * bobAmp;
    py += -Math.abs(Math.cos(this.bobPhase)) * bobAmp * 0.85;
    rz += Math.sin(this.bobPhase) * bobAmp * 1.6;
    const breath = 1 - aim * 0.7;
    px += Math.sin(this.idleT * 0.9) * 0.004 * breath;
    py += Math.sin(this.idleT * 1.35) * 0.005 * breath;

    if (this.equipT < 1) {
      // Drawn from below with a short settle at the top.
      const k = 1 - easeOut(this.equipT);
      py -= k * 0.42;
      pz += k * 0.1;
      rx += k * 0.95;
      rz += k * 0.5;
    }
    if (this.swingT < 1) {
      // A real strike is two moves, not one symmetric wobble: a short wind-up
      // that lifts the fist back toward the camera, then a longer drive that
      // throws it FORWARD (-z) and down through the target. A single sine both
      // ways is what made the hand look like it travelled backwards on a hit.
      const t = this.swingT;
      const WIND = 0.26;
      const draw = t < WIND
        ? Math.sin((t / WIND) * Math.PI * 0.5)   // 0 → 1, ease-out cock-back
        : 1 - (t - WIND) / (1 - WIND);           // 1 → 0, released into the strike
      const strike = t < WIND
        ? 0
        : Math.sin(((t - WIND) / (1 - WIND)) * Math.PI);
      const weight = this.heavySwing ? 1.35 : 1;
      px += draw * 0.05 - strike * 0.10 * weight;
      py += draw * 0.09 - strike * 0.15 * weight;
      pz += draw * 0.13 - strike * 0.27;
      // Negative pitch drops the item's nose (it points at -z), so the wind-up
      // raises it and the strike chops down through the swing.
      rx += draw * 0.42 - strike * 1.05;
      rz += -strike * 0.2 * weight; // rolls slightly inward as it lands
    }
    if (this.gadgetBeat) {
      const duration = this.gadgetBeat === 'bounce' ? 0.42 : 0.28;
      const u = clamp(this.gadgetBeatT / duration, 0, 1);
      const pulse = Math.sin(u * Math.PI);
      if (this.gadgetBeat === 'bounce') {
        py -= pulse * 0.12;
        pz += pulse * 0.08;
        rx += pulse * 0.36;
      } else {
        pz += pulse * 0.11;
        rx += pulse * (this.gadgetBeat === 'grappleFire' ? 0.22 : -0.13);
        rz -= pulse * 0.08;
      }
    }
    // Spring recoil: straight back into the shoulder, with the muzzle climbing.
    // Both are capped so the heaviest weapons throw the gun hard without ever
    // folding it back through the camera.
    pz += Math.min(0.3, this.kickZ);
    py += this.kickY;
    rx += Math.min(0.34, this.kickPitch);
    ry += this.kickYaw;
    rz += this.kickRoll;

    if (healProgress >= 0 && this.currentItem === Item.Medkit) {
      // THE MEDKIT is a procedure, not a wrap: the case swings up and turns
      // face-on (latches toward you), each beat is a firm two-handed PRESS that
      // drives it forward and kicks back, the last third winds up — and it
      // finishes with a slam into the chest (the stim going in) before it drops
      // out of frame. Every phase is visible from first person, so a medkit
      // reads as a heavy, deliberate commitment next to a bandage's quick wrap.
      this.healClock += dt;
      const t = Math.min(1, healProgress);
      const lift = smoothstep(t / 0.2);
      const wind = smoothstep((t - 0.72) / 0.14);          // pull back for the slam
      const slam = smoothstep((t - 0.86) / 0.06);          // drive into the chest
      const drop = smoothstep((t - 0.93) / 0.07);          // and away
      const hold = lift * (1 - drop);
      const beat = (this.healClock / HEAL_BEAT) % 1;
      // A sharp attack and a slower release reads as a latch clicking home.
      const press = hold * (1 - wind) * (beat < 0.18 ? beat / 0.18 : Math.max(0, 1 - (beat - 0.18) / 0.5));
      const shake = hold * (1 - wind) * Math.sin(this.healClock * 47) * 0.004;
      px += (0.02 - px) * hold - press * 0.02 + shake;
      py += (-0.16 - py) * hold - press * 0.035 + wind * 0.06 - slam * 0.1;
      pz += (-0.42 - pz) * hold - press * 0.07 + wind * 0.1 + slam * 0.2;
      rx += hold * -0.2 + press * 0.28 - wind * 0.35 + slam * 0.6 + drop * 0.8;
      ry += hold * -0.35;
      rz += hold * 0.1 - press * 0.08 + drop * 0.9;
      px += drop * 0.12;
      py -= drop * 0.42;
      this.pivot.scale.setScalar(1 + hold * (0.24 + press * 0.05 + slam * 0.08));
    } else if (healProgress >= 0) {
      // Applying a bandage/medkit: bring the item up in front of the face,
      // work it in with a few rhythmic presses (in step with the audio beats),
      // then flick the spent wrapper away as the channel completes.
      this.healClock += dt;
      const t = Math.min(1, healProgress);
      const lift = smoothstep(t / 0.18);              // raise into view
      const away = smoothstep((t - 0.86) / 0.14);     // toss it aside at the end
      const hold = lift * (1 - away);
      // Two-sided press: eases in, holds, eases back — reads as pressure, not
      // a vibration. Phase matches HEAL_BEAT so the tick sound lands on it.
      const press = hold *
        Math.max(0, Math.sin((this.healClock / HEAL_BEAT) * Math.PI * 2)) ** 2;
      px += (0.12 - px) * hold - press * 0.03;
      py += (-0.13 - py) * hold + press * 0.02;
      pz += (-0.44 - pz) * hold - press * 0.05;
      rx += hold * -0.55 + press * 0.35 + away * 0.9;
      rz += hold * 0.75 - press * 0.22 + away * 1.6;
      px += away * 0.28;
      py -= away * 0.34;
      this.pivot.scale.setScalar(1 + hold * 0.16);
    } else {
      this.healClock = 0;
      this.pivot.scale.setScalar(1);
    }
    if (this.isGun && reloadProgress >= 0) {
      this.poseReload(clamp(reloadProgress, 0, 1),
        (dx, dy, dz, drx, dry, drz) => {
          px += dx; py += dy; pz += dz; rx += drx; ry += dry; rz += drz;
        });
    }
    this.pivot.position.set(px, py, pz);
    this.pivot.rotation.set(rx, ry, rz);

    if (this.isGun) {
      this.poseParts(reloadProgress, aim);
      this.placeHands(aim);
      if (this.pendingShot) {
        this.pendingShot = false;
        this.spawnShotFx();
      }
      const flash = 1 - this.flashT;
      this.poseFlash(flash);
      // The gun lights itself up for the instant the muzzle is burning.
      const glow = shade * (1 + flash * 0.7);
      for (const m of this.modelMats) m.color.setScalar(glow);
    } else if (this.isGadgetModel) {
      for (const m of this.modelMats) m.color.setScalar(shade);
    } else if (this.flash.visible) {
      this.flash.visible = false;
    }
    this.stepFx(dt);
  }

  // --- Motion layers ---------------------------------------------------------

  private stepSprings(dt: number): void {
    const decay = (x: number, v: number): number =>
      v + (-KICK_STIFF * x - KICK_DAMP * v) * dt;
    this.kickVZ = decay(this.kickZ, this.kickVZ);
    this.kickVY = decay(this.kickY, this.kickVY);
    this.kickVPitch = decay(this.kickPitch, this.kickVPitch);
    this.kickVYaw = decay(this.kickYaw, this.kickVYaw);
    this.kickVRoll = decay(this.kickRoll, this.kickVRoll);
    this.kickZ += this.kickVZ * dt;
    this.kickY += this.kickVY * dt;
    this.kickPitch += this.kickVPitch * dt;
    this.kickYaw += this.kickVYaw * dt;
    this.kickRoll += this.kickVRoll * dt;
  }

  /** The weapon trails the view and catches up: the single biggest cue that it
   *  has weight rather than being welded to the camera. */
  private stepSway(dt: number, aim: number): void {
    this.euler.setFromQuaternion(this.camera.quaternion, 'YXZ');
    let dYaw = this.euler.y - this.lastYaw;
    if (dYaw > Math.PI) dYaw -= Math.PI * 2;
    else if (dYaw < -Math.PI) dYaw += Math.PI * 2;
    const dPitch = this.euler.x - this.lastPitch;
    this.lastYaw = this.euler.y;
    this.lastPitch = this.euler.x;
    const gain = (this.isGun || this.isGadgetModel ? 0.09 : 0.055) * (1 - aim * 0.7);
    this.swayX = clamp(this.swayX + dYaw * gain, -0.055, 0.055);
    this.swayY = clamp(this.swayY - dPitch * gain, -0.055, 0.055);
    const back = Math.min(1, dt * 9);
    this.swayX -= this.swayX * back;
    this.swayY -= this.swayY * back;
  }

  private stepBob(dt: number, moveSpeed: number, grounded: boolean): void {
    const moving = grounded && moveSpeed > 0.7;
    const want = moving ? Math.min(1, moveSpeed / 5.5) : 0;
    this.bobWeight += (want - this.bobWeight) * Math.min(1, dt * 8);
    if (this.bobWeight > 0.002) {
      this.bobPhase += dt * (3.2 + Math.min(9, moveSpeed * 1.5));
    }
  }

  private stepGadgetAction(dt: number): void {
    this.gadgetSpin += ((this.grappleReeling ? -12 : 0) - this.gadgetSpin) *
      Math.min(1, dt * (this.grappleReeling ? 8 : 5));
    this.spoolAngle += this.gadgetSpin * dt;
    if (this.partSpool) this.partSpool.rotation.x = this.spoolAngle;

    if (!this.gadgetBeat) return;
    this.gadgetBeatT += dt;
    const duration = this.gadgetBeat === 'bounce' ? 0.42 : 0.28;
    const u = clamp(this.gadgetBeatT / duration, 0, 1);
    if (this.gadgetBeat === 'bounce') {
      const compression = u < 0.2
        ? 1 - smoothstep(u / 0.2) * 0.52
        : 0.48 + easeOut((u - 0.2) / 0.8) * 0.52;
      if (this.partSpring) this.partSpring.scale.y = compression;
      if (this.partPad) this.partPad.position.y = 0.16 + 0.39 * compression;
    }
    if (u >= 1) {
      if (this.partSpring) this.partSpring.scale.y = 1;
      if (this.partPad) this.partPad.position.y = 0.55;
      this.gadgetBeat = null;
    }
  }

  /** Drive the reciprocating part: slide, bolt carrier, pump or bolt handle. */
  private stepCycle(dt: number): void {
    if (this.cycleDelay > 0) {
      this.cycleDelay = Math.max(0, this.cycleDelay - dt);
      if (this.cycleDelay === 0) this.onGunSound?.('cycle');
      return;
    }
    this.cycleT += dt;
    const u = this.cycleT / this.feel.cycle;
    // Hand-worked actions throw their case halfway through the stroke; a
    // self-loader has already thrown its own at the moment of the shot.
    if (!this.ejected && u >= 0.35) {
      this.ejected = true;
      if (this.feel.action === 'pump' || this.feel.action === 'bolt') {
        this.spawnShell();
        this.onGunSound?.('shellDrop');
      }
    }
    if (u >= 1) {
      this.cycleT = -1;
      if (this.feel.action === 'pump' || this.feel.action === 'bolt') {
        this.onGunSound?.('cycle');
      }
    }
  }

  /** One-shot audio cues at the beats of a reload. */
  private stepReloadCues(progress: number): void {
    const prev = this.reloadStage;
    this.reloadStage = progress;
    // A finished reload has put something back in the chamber.
    if (progress < 0 && prev >= 0) this.chambered = true;
    if (progress < 0 || prev < 0) return;
    if (prev < 0.2 && progress >= 0.2) this.onGunSound?.('magOut');
    if (prev < 0.72 && progress >= 0.72) this.onGunSound?.('magIn');
    if (prev < 0.88 && progress >= 0.88) this.onGunSound?.('cycle');
  }

  // --- Posing ----------------------------------------------------------------

  /** Whole-weapon movement during a reload, added to the pose. */
  private poseReload(
    t: number,
    add: (dx: number, dy: number, dz: number, rx: number, ry: number, rz: number) => void
  ): void {
    // The whole reload has to stay ON SCREEN: the rest pose already sits two
    // thirds of the way down, so these dips are small and the weapon is pulled
    // back toward the camera (+z) rather than dropped out of frame.
    const dip = Math.sin(t * Math.PI);
    if (this.feel.action === 'tube') {
      // Off the shoulder, muzzle up, then back into the firing position.
      add(dip * 0.08, -dip * 0.07, dip * 0.14, -dip * 0.45, dip * 0.3, dip * 0.2);
      return;
    }
    if (this.feel.action === 'pump') {
      // Rolled over to feed shells up through the loading port.
      add(dip * 0.04, -dip * 0.07, dip * 0.1, -dip * 0.18, -dip * 0.22, dip * 0.8);
      return;
    }
    // Magazine guns: cant the magwell into view, then snap level for the
    // charging stroke at the end.
    const seat = Math.sin(Math.max(0, (t - 0.7) / 0.3) * Math.PI);
    add(dip * 0.05, -dip * 0.09 - seat * 0.02, dip * 0.1,
      -dip * 0.38, dip * 0.1, dip * 0.65 - seat * 0.2);
  }

  /** Moving parts: the action's stroke plus any reload-specific motion. */
  private poseParts(reloadProgress: number, aim: number): void {
    const feel = this.feel;
    const reloading = reloadProgress >= 0;
    const t = clamp(reloadProgress, 0, 1);
    const cycle = this.cycleT >= 0 && this.cycleDelay === 0
      ? clamp(this.cycleT / feel.cycle, 0, 1) : 0;
    if (this.partCycle) {
      const p = this.partCycle;
      p.position.set(0, 0, 0);
      p.rotation.set(0, 0, 0);
      if (feel.action === 'tube') {
        // The warhead is simply gone until a fresh one is rammed in from behind.
        if (reloading) {
          const slide = clamp((t - 0.35) / 0.35, 0, 1);
          p.visible = t >= 0.35;
          p.position.z = (1 - easeOut(slide)) * 2.2;
        } else {
          p.visible = this.chambered;
        }
      } else if (feel.action === 'bolt') {
        const u = reloading ? this.boltReloadPhase(t) : cycle;
        // Lift the handle, draw straight back, run forward, lock down.
        const lift = u <= 0 ? 0 : u < 0.18 ? u / 0.18 : u > 0.85 ? (1 - u) / 0.15 : 1;
        p.rotation.z = -clamp(lift, 0, 1) * 0.9;
        p.position.z = stroke(clamp((u - 0.15) / 0.7, 0, 1), 0.45) * feel.travel;
      } else {
        // Self-loaders cycle on the shot; a pump racks by hand, and during a
        // magazine change the charging handle is worked at the very end.
        const u = reloading ? (t > 0.86 ? (t - 0.86) / 0.14 : 0) : cycle;
        p.position.z = stroke(u, feel.action === 'pump' ? 0.45 : 0.35) * feel.travel;
      }
    }
    if (this.partMag) {
      const m = this.partMag;
      m.position.set(0, 0, 0);
      m.visible = true;
      if (reloading && feel.action !== 'pump' && feel.action !== 'tube') {
        if (t < 0.2) {
          m.position.y = -smoothstep(t / 0.2) * 0.08;      // unseat
        } else if (t < 0.5) {
          m.position.y = -0.08 - easeOut((t - 0.2) / 0.3) * 0.9; // drop away
          m.visible = t < 0.42;
        } else if (t < 0.72) {
          m.position.y = -(1 - easeOut((t - 0.5) / 0.22)) * 0.85; // fresh one up
        } else {
          m.position.y = -(1 - clamp((t - 0.72) / 0.06, 0, 1)) * 0.02; // seated
        }
      }
    }
    // Bipod legs drop as you settle behind the scope; a collapsible stock
    // extends into the shoulder as the weapon comes up.
    if (this.partBipod) this.partBipod.rotation.x = (1 - aim) * -1.35;
    if (this.partStock) this.partStock.position.z = (1 - aim) * 0.06;
  }

  /** Where the bolt is during a bolt-action reload (open, feed, close). */
  private boltReloadPhase(t: number): number {
    if (t < 0.25) return clamp(t / 0.25, 0, 1) * 0.5; // open and hold it back
    if (t < 0.7) return 0.5;
    return 0.5 + clamp((t - 0.7) / 0.3, 0, 1) * 0.5;  // run it home
  }

  /** Support hand on the foregrip — or chasing the magazine during a reload,
   *  which is what actually sells the swap. The firing hand tucks down behind
   *  the receiver as the weapon comes up: a fist is a bigger block than the gun
   *  it is holding, and dead centre of an aimed shot is the worst place for it. */
  private placeHands(aim: number): void {
    // A pistol has no stock to shoulder, so its firing hand must rise with the
    // whole ADS pose instead of tucking behind the receiver like a long gun.
    const handTuck = this.currentItem === Item.Pistol ? 0 : aim;
    this.arm.position.set(0.05, -0.16 - handTuck * 0.13, 0.06 + handTuck * 0.05);
    if (!this.offArm.visible || !this.anchorGrip2) return;
    const target = this.pointInPivot(this.anchorGrip2, this.scratch);
    if (this.partMag && this.partMag.position.y < -0.01) {
      const magPoint = this.pointInPivot(this.partMag, this.scratchB);
      const w = clamp(-this.partMag.position.y * 3, 0, 1);
      target.lerp(magPoint, w * 0.75);
    }
    // The fist is a chunky block next to a 0.48-scale gun, so it grips from
    // below-left of the anchor instead of swallowing the handguard whole.
    this.offArm.position.set(
      target.x - 0.03, target.y - 0.06 - aim * 0.04, target.z + 0.01);
  }

  private poseFlash(amount: number): void {
    if (amount <= 0.02 || !this.anchorMuzzle) {
      this.flash.visible = false;
      return;
    }
    this.flash.visible = true;
    this.flash.position.copy(this.pointInPivot(this.anchorMuzzle, this.scratch));
    // Pops to full instantly and collapses: a flash is an event, not a fade.
    const s = this.flashScale * (0.55 + amount * 0.65);
    this.flash.scale.set(s, s, s);
    this.flashMat.opacity = amount * 0.95;
    this.flashStarMat.opacity = amount * amount * 0.8;
  }

  // --- Brass and smoke -------------------------------------------------------

  private spawnShotFx(): void {
    if (this.feel.action !== 'pump' && this.feel.action !== 'bolt') this.spawnShell();
    for (let i = 0; i < this.feel.smoke; i++) this.spawnPuff();
  }

  /** Convert a point on the gun into camera space (where the fx group lives). */
  private toCamera(obj: THREE.Object3D | null, out: THREE.Vector3): THREE.Vector3 {
    if (!obj) return out.set(0, 0, 0);
    this.pointInPivot(obj, out);
    this.pivot.updateMatrix();
    return out.applyMatrix4(this.pivot.matrix);
  }

  private spawnShell(): void {
    if (this.feel.shell === 'none' || !this.anchorEject) return;
    let shell = this.shells.find((s) => s.life <= 0);
    if (!shell && this.shells.length < MAX_SHELLS) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0xc9a040, transparent: true, depthTest: false, fog: false,
      });
      const mesh = new THREE.Mesh(this.shellGeo, mat);
      mesh.renderOrder = 102;
      this.fx.add(mesh);
      shell = { mesh, mat, vel: new THREE.Vector3(), spin: new THREE.Vector3(), life: 0 };
      this.shells.push(shell);
    }
    if (!shell) return;
    const hull = this.feel.shell === 'shell'; // a shotgun hull is fat and red
    shell.mesh.scale.setScalar(hull ? 1.6 : 1);
    shell.mesh.visible = true;
    shell.mat.color.setHex(hull ? 0xb0392c : 0xc9a040);
    shell.mat.opacity = 1;
    this.toCamera(this.anchorEject, shell.mesh.position);
    shell.vel.set(
      0.7 + Math.random() * 0.5, 0.55 + Math.random() * 0.4, 0.35 + Math.random() * 0.35);
    shell.spin.set(
      (Math.random() - 0.5) * 22, (Math.random() - 0.5) * 22, (Math.random() - 0.5) * 22);
    shell.life = 0.75;
  }

  private spawnPuff(): void {
    if (!this.anchorMuzzle) return;
    let puff = this.puffs.find((p) => p.life <= 0);
    if (!puff && this.puffs.length < MAX_SMOKE) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0x9aa0a6, transparent: true, opacity: 0,
        depthTest: false, depthWrite: false, fog: false,
      });
      const mesh = new THREE.Mesh(this.puffGeo, mat);
      mesh.renderOrder = 101;
      this.fx.add(mesh);
      puff = { mesh, mat, vel: new THREE.Vector3(), life: 0, maxLife: 1, size: 0.05 };
      this.puffs.push(puff);
    }
    if (!puff) return;
    this.toCamera(this.anchorMuzzle, puff.mesh.position);
    puff.mesh.position.x += (Math.random() - 0.5) * 0.06;
    puff.mesh.position.y += (Math.random() - 0.5) * 0.06;
    puff.mesh.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
    puff.vel.set(
      (Math.random() - 0.5) * 0.25, 0.18 + Math.random() * 0.2, -0.5 - Math.random() * 0.5);
    puff.size = 0.05 + Math.random() * 0.04;
    puff.maxLife = 0.45 + Math.random() * 0.3;
    puff.life = puff.maxLife;
    puff.mesh.visible = true;
  }

  private stepFx(dt: number): void {
    for (const s of this.shells) {
      if (s.life <= 0) continue;
      s.life -= dt;
      if (s.life <= 0) { s.mesh.visible = false; continue; }
      s.vel.y -= 5.5 * dt;
      s.mesh.position.addScaledVector(s.vel, dt);
      s.mesh.rotation.x += s.spin.x * dt;
      s.mesh.rotation.y += s.spin.y * dt;
      s.mesh.rotation.z += s.spin.z * dt;
      s.mat.opacity = Math.min(1, s.life * 3);
    }
    for (const p of this.puffs) {
      if (p.life <= 0) continue;
      p.life -= dt;
      if (p.life <= 0) { p.mesh.visible = false; continue; }
      p.mesh.position.addScaledVector(p.vel, dt);
      p.vel.multiplyScalar(1 - Math.min(1, dt * 2.4));
      const age = 1 - p.life / p.maxLife;
      const s = p.size * (0.6 + age * 2.2);
      p.mesh.scale.set(s, s, s);
      p.mat.opacity = (1 - age) * 0.32;
    }
  }

  /** Position of a node on the gun expressed in the pivot's own space, without
   *  touching world matrices (which are a frame stale at this point). */
  private pointInPivot(obj: THREE.Object3D, out: THREE.Vector3): THREE.Vector3 {
    out.set(0, 0, 0);
    let node: THREE.Object3D | null = obj;
    while (node && node !== this.pivot) {
      node.updateMatrix();
      out.applyMatrix4(node.matrix);
      node = node.parent;
    }
    return out;
  }
}
