// First-person held item in the bottom-right: mini-block or sprite parented
// to the camera, with a swing animation while mining/placing.

import * as THREE from 'three';
import { itemGeometry } from './itementity';
import type { Atlas } from './textures';

export class HeldItemView {
  private readonly pivot: THREE.Group;
  private readonly material: THREE.MeshBasicMaterial;
  private mesh: THREE.Mesh | null = null;
  private currentItem: number | null = null;
  private swingT = 1; // 0..1, animating while < 1
  private readonly atlas: Atlas;

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
    this.pivot.position.set(0.42, -0.42, -0.7);
    this.pivot.renderOrder = 100;
    camera.add(this.pivot);
  }

  setItem(id: number | null): void {
    if (id === this.currentItem) return;
    this.currentItem = id;
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
  }

  swing(): void {
    if (this.swingT >= 1) this.swingT = 0;
  }

  update(dt: number, mining: boolean, sunlight: number): void {
    this.material.color.setScalar(0.55 + 0.45 * sunlight);
    if (mining) this.swing();
    if (this.swingT < 1) {
      this.swingT = Math.min(1, this.swingT + dt / 0.25);
      const s = Math.sin(this.swingT * Math.PI);
      this.pivot.rotation.x = -s * 0.9;
      this.pivot.position.y = -0.42 - s * 0.15;
      this.pivot.position.z = -0.7 - s * 0.12;
    } else {
      this.pivot.rotation.x = 0;
      this.pivot.position.set(0.42, -0.42, -0.7);
    }
  }
}
