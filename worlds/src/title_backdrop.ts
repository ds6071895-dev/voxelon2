// The living backdrop behind the title screen: a slow glide around a lake
// valley ringed by snowy peaks (title_terrain.ts), built by the same mesher
// and sky the matches use. Its own scene and its own World, so nothing it
// streams ever touches the world a match is played in.

import * as THREE from 'three';
import { Sky } from './sky';
import type { Atlas } from './textures';
import { World } from './world';
import { TITLE_SEA, TitleTerrain } from './title_terrain';

/** The atlas/sky seed VOXELON always used, so every texture is identical. */
export const TEXTURE_SEED = 1337;
/** Chunks streamed around the valley's centre: enough for the far peaks. */
const STREAM_RADIUS = 8;
/** Landscapes that were checked by eye; one is picked per visit. */
const SEEDS = [0x5ca1ab1e, 0x0b5e55ed, 0x7a11ce5];
/** A soft morning sun, low enough for long light across the water. */
const TIME_OF_DAY = 0.11;
/** Orbit: radius around the lake and height over the water. */
const ORBIT = 30;
const LIFT = 17;

export class TitleBackdrop {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(64, 1, 0.08, 2000);
  private readonly world: World;
  private readonly sky: Sky;
  private yaw: number;
  private clock = 0;

  constructor(atlas: Atlas, aspect = 1, rng: () => number = Math.random) {
    const seed = SEEDS[Math.floor(rng() * SEEDS.length) % SEEDS.length];
    this.yaw = rng() * Math.PI * 2;
    this.scene.background = new THREE.Color(0x9cc3ec);
    // Aerial perspective: the peaks across the valley fade into the sky.
    this.scene.fog = new THREE.Fog(0xb7d3ee, 62, STREAM_RADIUS * 16 + 22);
    this.world = new World(this.scene, atlas, new TitleTerrain(seed));
    this.world.renderDistance = STREAM_RADIUS;
    this.sky = new Sky(this.scene, TEXTURE_SEED);
    this.sky.snapTo(TIME_OF_DAY);
    this.camera.rotation.order = 'YXZ';
    this.resize(aspect);
  }

  resize(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  update(dt: number): void {
    this.world.update(0, 0, 8, STREAM_RADIUS);
    this.clock += dt;
    this.yaw += dt * 0.03;
    // Circle the shore, gazing across the water at the far side of the
    // valley; a gentle bob keeps it feeling like flight, not a turntable.
    const x = Math.sin(this.yaw) * ORBIT, z = Math.cos(this.yaw) * ORBIT;
    const y = TITLE_SEA + LIFT + Math.sin(this.clock * 0.21) * 1.2;
    this.camera.position.set(x, y, z);
    const across = this.yaw + Math.PI + 0.35;
    this.camera.lookAt(Math.sin(across) * 60, TITLE_SEA + 12, Math.cos(across) * 60);
    this.sky.update(dt, this.camera, TIME_OF_DAY, false);
    this.world.applySky(this.sky);
    this.world.timeUniform.value += dt;
    (this.scene.background as THREE.Color).copy(this.sky.skyColor);
    (this.scene.fog as THREE.Fog).color.copy(this.sky.skyColor);
  }

  render(renderer: THREE.WebGLRenderer): void {
    renderer.render(this.scene, this.camera);
  }
}
