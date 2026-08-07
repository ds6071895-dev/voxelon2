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
const PANO_DIST = 9;            // chunk render radius (enough that fog hides the edge)
// Fog tuned to the render edge so distant chunks fade into the sky instead of
// popping out of existence at the cutoff.
const PANO_FOG_NEAR = PANO_DIST * 16 - 70;
const PANO_FOG_FAR = PANO_DIST * 16 - 12;

export class Panorama {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(70, 1, 0.08, 2000);
  private readonly world: World;
  private readonly sky: Sky;
  private readonly cx: number;
  private readonly cz: number;
  private readonly cy: number;
  private yaw = 0;

  constructor(atlas: Atlas, aspect = 1) {
    // A sky-blue background + matching fog so the horizon reads as a real sky
    // (without this the scene clears to black behind the distant chunks).
    this.scene.background = new THREE.Color(0x78a7ff);
    this.scene.fog = new THREE.Fog(0x9fc4e8, PANO_FOG_NEAR, PANO_FOG_FAR);
    this.world = new World(this.scene, atlas, PANO_SEED);
    this.sky = new Sky(this.scene, PANO_SEED);
    this.camera.rotation.order = 'YXZ';
    // A deterministic scenic spot (fixed seed -> same every time).
    const s = this.world.terrain.randomDrySpawn(mulberry32(PANO_SEED), 200);
    this.cx = s.x; this.cz = s.z; this.cy = s.y + 14;
    this.resize(aspect); // match the viewport up front so it isn't stretched
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
    // Tilted down enough that the landscape — not empty sky — fills the frame
    // behind the (light, mostly translucent) title screen.
    this.camera.rotation.set(-0.26, this.yaw, 0);
    this.sky.update(dt, this.camera);
    this.world.sunUniform.value = this.sky.sunIntensity;
    // Track the live sky colour so the background + fog blend into the horizon.
    (this.scene.background as THREE.Color).copy(this.sky.skyColor);
    (this.scene.fog as THREE.Fog).color.copy(this.sky.skyColor);
  }

  render(renderer: THREE.WebGLRenderer): void {
    renderer.render(this.scene, this.camera);
  }
}
