// First-person held item in the bottom-right: mini-block or sprite parented
// to the camera, with a swing animation while mining/placing and a punchy
// recoil + muzzle flash when a gun fires.

import * as THREE from 'three';
import { itemGeometry } from './itementity';
import { ITEMS } from './items';
import { skinColorFor } from './remoteplayers';
import type { Cosmetics } from './character';
import type { Atlas } from './textures';

const BASE_X = 0.42, BASE_Y = -0.42, BASE_Z = -0.7;

export class HeldItemView {
  private readonly pivot: THREE.Group;
  private readonly material: THREE.MeshBasicMaterial;
  private mesh: THREE.Mesh | null = null;
  private currentItem: number | null = null;
  private swingT = 1; // 0..1, animating while < 1
  private recoilT = 1; // 0..1, animating while < 1 (gun kick)
  private isGun = false;
  private readonly atlas: Atlas;
  private readonly flash: THREE.Mesh;
  private readonly flashMat: THREE.MeshBasicMaterial;
  // First-person arm: a skin-colored forearm + fist coming in from the
  // bottom-right, parented to the pivot so it swings/recoils with the item.
  private readonly armMat: THREE.MeshBasicMaterial;
  private readonly arm: THREE.Group;
  private readonly baseSkin = new THREE.Color(0xc89a6a);

  constructor(camera: THREE.Camera, atlas: Atlas) {
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
    camera.add(this.pivot);

    // Muzzle flash: a small additive quad in front of the gun, flicked on for
    // a couple of frames each shot (drawn over the gun via depthTest off).
    this.flashMat = new THREE.MeshBasicMaterial({
      color: 0xffe7a0, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false,
      side: THREE.DoubleSide, fog: false,
    });
    this.flash = new THREE.Mesh(new THREE.PlaneGeometry(0.55, 0.55), this.flashMat);
    this.flash.position.set(-0.05, 0.02, -0.6);
    this.flash.renderOrder = 101;
    this.flash.visible = false;
    this.pivot.add(this.flash);

    // First-person arm: a blocky forearm + fist angled in from the bottom-right
    // so the held item reads as actually held. Hidden while the hand is empty —
    // an empty POV shows nothing at all.
    this.armMat = new THREE.MeshBasicMaterial({ color: this.baseSkin.clone() });
    const arm = new THREE.Group();
    const forearm = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.17, 0.55), this.armMat);
    forearm.position.set(0, 0, 0.3); // extends back toward the screen corner
    arm.add(forearm);
    const fist = new THREE.Mesh(new THREE.BoxGeometry(0.21, 0.21, 0.2), this.armMat);
    arm.add(fist); // the grip, at the item's position
    arm.position.set(0.05, -0.16, 0.06);
    arm.rotation.set(0.5, -0.32, 0.32);
    arm.renderOrder = 99; // just behind the item
    arm.visible = false;  // nothing held yet
    this.pivot.add(arm);
    this.arm = arm;
  }

  /** Tint the first-person hand to the local player's skin tone — cosmetics-
   *  aware (so your own hand matches the avatar everyone else sees). */
  setSkin(seed: number, cosmetics?: Cosmetics): void {
    this.baseSkin.copy(skinColorFor(seed, cosmetics));
  }

  setItem(id: number | null): void {
    if (id === this.currentItem) return;
    this.currentItem = id;
    this.isGun = id !== null && !!ITEMS[id]?.gun;
    if (this.mesh) {
      this.pivot.remove(this.mesh);
      this.mesh = null;
    }
    if (id !== null) {
      this.mesh = new THREE.Mesh(itemGeometry(this.atlas, id), this.material);
      this.mesh.renderOrder = 100;
      this.mesh.scale.setScalar(1.4);
      this.mesh.rotation.set(0.1, -0.6, 0);
      this.pivot.add(this.mesh);
    }
    // The arm only shows while something is actually held.
    this.arm.visible = id !== null;
  }

  /** Generic mining/placing swing (tools, blocks). */
  swing(): void {
    if (this.swingT >= 1) this.swingT = 0;
  }

  /** Gun fired: kick the weapon back + up and pop the muzzle flash. */
  recoil(): void {
    this.recoilT = 0;
  }

  update(dt: number, mining: boolean, sunlight: number): void {
    const shade = 0.55 + 0.45 * sunlight;
    this.material.color.setScalar(shade);
    this.armMat.color.copy(this.baseSkin).multiplyScalar(shade);
    // Mining a block swings the hand — but guns animate via recoil(), so a held
    // gun never swings (its left-click fires instead of mining).
    if (mining && !this.isGun) this.swing();

    if (this.swingT < 1) this.swingT = Math.min(1, this.swingT + dt / 0.25);
    if (this.recoilT < 1) this.recoilT = Math.min(1, this.recoilT + dt / 0.16);

    let px = BASE_X, py = BASE_Y, pz = BASE_Z, rx = 0;
    if (this.swingT < 1) {
      const s = Math.sin(this.swingT * Math.PI);
      rx = -s * 0.9;
      py = BASE_Y - s * 0.15;
      pz = BASE_Z - s * 0.12;
    }
    if (this.recoilT < 1) {
      // Sharp onset, quick settle: kick straight back toward the camera + up.
      const k = 1 - this.recoilT;
      const e = k * k;
      pz += e * 0.2;
      py += e * 0.05;
      rx += e * 0.55;
    }
    this.pivot.position.set(px, py, pz);
    this.pivot.rotation.x = rx;

    // Muzzle flash: brief (first ~1/3 of the recoil), gun-only, gently spinning.
    const fa = this.isGun ? Math.max(0, 1 - this.recoilT * 3) : 0;
    this.flashMat.opacity = fa * 0.9;
    this.flash.visible = fa > 0.02;
    if (this.flash.visible) this.flash.rotation.z += dt * 24;
  }
}
