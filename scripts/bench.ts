import * as THREE from 'three';
import { World } from '../src/world';
import type { Atlas } from '../src/textures';

const fakeAtlas: Atlas = {
  texture: null as unknown as Atlas['texture'],
  canvas: null as unknown as HTMLCanvasElement,
  uvRect: () => [0, 0, 1, 1],
};
const scene = new THREE.Scene();
const world = new World(scene, fakeAtlas, 1337);
const spawn = world.terrain.findSpawn();

const t0 = performance.now();
let passes = 0;
while (!world.update(spawn.x, spawn.z, 10000) && passes++ < 50) { /* */ }
const total = performance.now() - t0;
const chunks = scene.children.length;
console.log(`full stream: ${total.toFixed(0)}ms for ~${chunks} chunk meshes`);
console.log(`per chunk (gen+light+mesh): ${(total / chunks).toFixed(2)}ms`);

// Edit remesh cost (worst interactive case: torch place = 1-chunk remesh).
const sx = Math.floor(spawn.x), sy = Math.floor(spawn.y), sz = Math.floor(spawn.z);
const t1 = performance.now();
for (let i = 0; i < 20; i++) {
  world.setBlock(sx, sy + 1, sz, i % 2 === 0 ? 28 : 0); // torch on/off
}
console.log(`per edit remesh+relight: ${((performance.now() - t1) / 20).toFixed(2)}ms`);
