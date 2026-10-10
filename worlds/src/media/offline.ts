import * as THREE from 'three';
import { isSolid } from '../blocks';
import type { WorldGenerator } from '../multiverse';
import type { World } from '../world';
import type { PostFX } from '../postfx';
import type { SunShadow } from '../shadows';
import { stridePose, type AvatarBody } from '../avatar';

/** Preserve each stage's chosen look, sizing effects to its canvas, not the page. */
export function configureCaptureQuality(renderer: THREE.WebGLRenderer, postfx: PostFX, shadows: SunShadow,
  shaders: boolean, shadowEnabled: boolean, postTier: number, shadowTier: number): void {
  postfx.setTier(postTier);
  postfx.setEnabled(shaders);
  shadows.setTier(shadowTier);
  shadows.setEnabled(shadowEnabled);
  const size = renderer.getSize(new THREE.Vector2());
  postfx.setSize(size.x, size.y);
}

export function sizeCapture(renderer: THREE.WebGLRenderer, postfx: PostFX, camera: THREE.PerspectiveCamera,
  width: number, height: number, below = 0): void {
  if (![width, height, below].every(Number.isInteger) || width <= 0 || height <= 0 || below < 0 || below >= height) {
    throw new Error(`Invalid capture viewport ${width}x${height} (+${below} below).`);
  }
  renderer.setSize(width, height, false);
  postfx.setSize(width, height);
  camera.aspect = width / (height - below);
  if (below > 0) camera.setViewOffset(width, height - below, 0, 0, width, height);
  else camera.clearViewOffset();
  camera.updateProjectionMatrix();
}

export async function loadCaptureChunks(world: World, x: number, z: number, radius: number, budget: number, label: string): Promise<void> {
  world.renderDistance = radius;
  const deadline = performance.now() + 180000;
  while (!world.update(x, z, budget, radius)) {
    if (performance.now() > deadline) throw new Error(`Chunk loading timed out for ${label}`);
    await new Promise(resolve => setTimeout(resolve, 0));
  }
}

export function captureGround(gen: WorldGenerator, x: number, z: number, top: number, bottom: number, offset = 0, fallback = bottom): number {
  for (let y = top; y >= bottom; y--) {
    if (isSolid(gen.blockAt(Math.floor(x), y, Math.floor(z)))) return y + 1 + offset;
  }
  return fallback;
}

export function poseCaptureStride(body: AvatarBody, phase: number, speed: number, holding: boolean, attack = 0): void {
  const pose = stridePose(phase, speed, 0, holding, attack);
  body.parts[0].rotation.x = pose.legs[0];
  body.parts[1].rotation.x = pose.legs[1];
  body.parts[2].rotation.set(pose.arms[0], 0, 0);
  body.parts[3].rotation.set(pose.arms[1], 0, pose.rightArmRoll);
}
