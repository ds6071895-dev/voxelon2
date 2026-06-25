// Title-screen panorama: a small, self-contained "fake" world rendered behind
// the menu. It uses its OWN fixed seed + scene (independent of the gameplay
// world and the player's random spawn), so the background looks the same every
// launch. Kept cheap with a small render radius + fog; updated only while the
// title is showing, then frozen.

import * as THREE from 'three';
import { mulberry32 } from './noise';
import { Sky } from './sky';
import type { Atlas } from './textures';
import { World } from './world';

const PANO_SEED = 0x5ca1ab1e;   // fixed -> identical panorama every launch
const PANO_DIST = 4;            // chunk render radius (small: it's just scenery)

export class Panorama {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(70, 1, 0.08, 2000);
  private readonly world: World;
  private readonly sky: Sky;
  private readonly cx: number;
  private readonly cz: number;
  private readonly cy: number;
  private yaw = 0;

  constructor(atlas: Atlas) {
    this.scene.fog = new THREE.Fog(0x9fc4e8, 40, 150);
    this.world = new World(this.scene, atlas, PANO_SEED);
    this.sky = new Sky(this.scene, PANO_SEED);
    this.camera.rotation.order = 'YXZ';
    // A deterministic scenic spot (fixed seed -> same every time).
    const s = this.world.terrain.randomDrySpawn(mulberry32(PANO_SEED), 200);
    this.cx = s.x; this.cz = s.z; this.cy = s.y + 14;
  }

  resize(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  /** Stream the local scenery + slowly orbit. Call each frame while on title. */
  update(dt: number): void {
    this.world.update(this.cx, this.cz, 6, PANO_DIST);
    this.yaw += dt * 0.05;
    this.camera.position.set(this.cx, this.cy, this.cz);
    this.camera.rotation.set(-0.14, this.yaw, 0);
    this.sky.update(dt, this.camera);
  }

  render(renderer: THREE.WebGLRenderer): void {
    renderer.render(this.scene, this.camera);
  }
}
