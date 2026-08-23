// Lightweight ambient life for the open world. This is deliberately visual
// only: terrain remains deterministic/server-shared, while butterflies,
// fireflies and colourful, untargetable birds are a cheap local presentation
// layer.

import * as THREE from 'three';
import { Biome } from './biomes';
import { isSolid } from './blocks';
import type { World } from './world';

interface Mote {
  sprite: THREE.Sprite;
  x: number;
  y: number;
  z: number;
  phase: number;
  age: number;
  life: number;
  nocturnal: boolean;
}

interface Bird {
  group: THREE.Group;
  left: THREE.Group;
  right: THREE.Group;
  materials: THREE.MeshBasicMaterial[];
  angle: number;
  radius: number;
  speed: number;
  height: number;
  phase: number;
  groundY: number;
  sampleTimer: number;
  spawned: boolean;
}

interface BirdPalette {
  body: number;
  breast: number;
  head: number;
  wing: number;
  tail: number;
  beak: number;
}

const MOTE_COUNT = 26;
const BIRD_COUNT = 7;
const DAY_COLORS = [0xffd84f, 0xff78b7, 0x8ddcff, 0xffa84f];
const NIGHT_COLORS = [0xd8ff67, 0x70ffd4, 0x8ec8ff];
const BIRD_PALETTES: readonly BirdPalette[] = [
  { body: 0x3979b8, breast: 0xf5a45d, head: 0x285b91, wing: 0x84b9df, tail: 0x214a78, beak: 0xf2c05a },
  { body: 0x936449, breast: 0xe45c46, head: 0x6f4535, wing: 0xc18b63, tail: 0x5b392f, beak: 0xe3b76a },
  { body: 0xe7bd37, breast: 0xffe68a, head: 0x3d4542, wing: 0x5d685e, tail: 0x353e3a, beak: 0xe4a94c },
  { body: 0x36a89b, breast: 0xe9f2cf, head: 0x247c82, wing: 0x70cfc1, tail: 0x1d6970, beak: 0xf0b754 },
  { body: 0xa45e9b, breast: 0xf2a6bd, head: 0x754675, wing: 0xd58abf, tail: 0x613a68, beak: 0xe9bd69 },
  { body: 0xd46b38, breast: 0xf4cc81, head: 0x99492f, wing: 0xe49b55, tail: 0x793b2c, beak: 0xf0ba56 },
  { body: 0x77964b, breast: 0xd6dc86, head: 0x526f3c, wing: 0xa9bd68, tail: 0x435e37, beak: 0xe7ad4c },
];

const BODY_GEOMETRY = new THREE.SphereGeometry(0.42, 8, 6);
const BREAST_GEOMETRY = new THREE.SphereGeometry(0.3, 8, 6);
const HEAD_GEOMETRY = new THREE.SphereGeometry(0.31, 8, 6);
const EYE_GEOMETRY = new THREE.SphereGeometry(0.045, 6, 4);
const BEAK_GEOMETRY = new THREE.ConeGeometry(0.12, 0.34, 4);
const FEATHER_GEOMETRY = new THREE.BoxGeometry(0.5, 0.055, 0.2);
const TAIL_GEOMETRY = new THREE.BoxGeometry(0.17, 0.07, 0.56);
const EYE_MATERIAL = new THREE.MeshBasicMaterial({ color: 0x17202b });
const BIRD_COLLISION_SAMPLES: readonly [number, number, number][] = [
  [0, 0, 0], [0, 0.2, 0.85], [0, 0, -0.95],
  [-0.65, 0.05, -0.1], [0.65, 0.05, -0.1],
  [-1.3, 0.05, -0.25], [1.3, 0.05, -0.25],
  [0, 0.4, 0], [0, -0.35, 0],
];

function lifeTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 16;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  // A crisp two-wing silhouette with a soft centre. It reads as a butterfly in
  // daylight and as a tiny glow halo once additive blending takes over at dusk.
  ctx.fillStyle = 'rgba(255,255,255,.22)';
  ctx.fillRect(3, 3, 10, 10);
  ctx.fillStyle = '#fff';
  ctx.fillRect(2, 5, 5, 5);
  ctx.fillRect(9, 5, 5, 5);
  ctx.fillRect(7, 6, 2, 5);
  const texture = new THREE.CanvasTexture(canvas);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  return texture;
}

function supportsLife(biome: Biome, nocturnal: boolean): boolean {
  if (nocturnal) {
    return biome === Biome.Forest || biome === Biome.BirchForest ||
      biome === Biome.Jungle || biome === Biome.Swamp ||
      biome === Biome.CherryGrove;
  }
  return biome === Biome.Plains || biome === Biome.Forest ||
    biome === Biome.BirchForest || biome === Biome.Jungle ||
    biome === Biome.CherryGrove;
}

function birdMaterial(color: number): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({ color, transparent: true, fog: true });
}

function mesh(
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  position: [number, number, number],
  scale?: [number, number, number],
): THREE.Mesh {
  const part = new THREE.Mesh(geometry, material);
  part.position.set(...position);
  if (scale) part.scale.set(...scale);
  return part;
}

/** A layered wing whose root is the flap pivot beside the bird's body. */
function makeWing(side: -1 | 1, material: THREE.Material): THREE.Group {
  const wing = new THREE.Group();
  for (let i = 0; i < 3; i++) {
    const feather = mesh(FEATHER_GEOMETRY, material,
      [side * (0.22 + i * 0.29), -i * 0.015, -0.04 - i * 0.12],
      [1.15 - i * 0.1, 1, 1 - i * 0.08]);
    feather.rotation.y = side * (0.1 + i * 0.07);
    wing.add(feather);
  }
  wing.position.set(side * 0.26, 0.08, 0.02);
  return wing;
}

function makeBird(palette: BirdPalette): Pick<Bird, 'group' | 'left' | 'right' | 'materials'> {
  const materials = [
    birdMaterial(palette.body), birdMaterial(palette.breast),
    birdMaterial(palette.head), birdMaterial(palette.wing),
    birdMaterial(palette.tail), birdMaterial(palette.beak),
  ];
  const [bodyMat, breastMat, headMat, wingMat, tailMat, beakMat] = materials;
  const group = new THREE.Group();

  group.add(mesh(BODY_GEOMETRY, bodyMat, [0, 0, 0], [1, 0.88, 1.45]));
  group.add(mesh(BREAST_GEOMETRY, breastMat, [0, -0.16, 0.35], [0.9, 0.8, 1.05]));
  group.add(mesh(HEAD_GEOMETRY, headMat, [0, 0.14, 0.58]));

  const beak = mesh(BEAK_GEOMETRY, beakMat, [0, 0.1, 0.93]);
  beak.rotation.x = Math.PI / 2;
  group.add(beak);
  for (const side of [-1, 1] as const) {
    group.add(mesh(EYE_GEOMETRY, EYE_MATERIAL, [side * 0.255, 0.23, 0.72]));
  }

  const left = makeWing(-1, wingMat);
  const right = makeWing(1, wingMat);
  group.add(left, right);

  for (let i = -1; i <= 1; i++) {
    const tail = mesh(TAIL_GEOMETRY, tailMat, [i * 0.13, -0.02, -0.83]);
    tail.rotation.y = -i * 0.18;
    group.add(tail);
  }
  group.scale.setScalar(1.15);
  return { group, left, right, materials };
}

export class AmbientWorld {
  private readonly world: World;
  private readonly motes: Mote[] = [];
  private readonly birds: Bird[] = [];
  private respawnTimer = 0;

  constructor(scene: THREE.Scene, world: World) {
    this.world = world;
    const texture = lifeTexture();
    for (let i = 0; i < MOTE_COUNT; i++) {
      const nocturnal = i >= Math.floor(MOTE_COUNT * 0.55);
      const palette = nocturnal ? NIGHT_COLORS : DAY_COLORS;
      const material = new THREE.SpriteMaterial({
        map: texture,
        color: palette[i % palette.length],
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: nocturnal ? THREE.AdditiveBlending : THREE.NormalBlending,
      });
      const sprite = new THREE.Sprite(material);
      sprite.scale.setScalar(nocturnal ? 0.3 : 0.42);
      sprite.visible = false;
      scene.add(sprite);
      this.motes.push({
        sprite, x: 0, y: 0, z: 0, phase: Math.random() * Math.PI * 2,
        age: 999, life: 8, nocturnal,
      });
    }

    for (let i = 0; i < BIRD_COUNT; i++) {
      const model = makeBird(BIRD_PALETTES[i % BIRD_PALETTES.length]);
      model.group.visible = false;
      scene.add(model.group);
      this.birds.push({
        ...model,
        angle: 0, radius: 0, speed: 0, height: 0,
        phase: Math.random() * Math.PI * 2,
        groundY: 0, sampleTimer: 0, spawned: false,
      });
    }
  }

  private placeMote(mote: Mote, focus: THREE.Vector3): void {
    // Try a handful of positions so desert, ocean and bare mountain columns do
    // not receive butterflies simply because a forest is visible nearby.
    for (let attempt = 0; attempt < 10; attempt++) {
      const a = Math.random() * Math.PI * 2;
      const r = 7 + Math.sqrt(Math.random()) * 34;
      const x = focus.x + Math.cos(a) * r;
      const z = focus.z + Math.sin(a) * r;
      const h = this.world.terrain.height(x, z);
      const biome = this.world.terrain.biomeWithWater(x, z, h);
      if (!supportsLife(biome, mote.nocturnal)) continue;
      mote.x = x;
      mote.z = z;
      mote.y = h + 1.2 + Math.random() * (mote.nocturnal ? 2.8 : 1.5);
      mote.phase = Math.random() * Math.PI * 2;
      mote.age = 0;
      mote.life = 7 + Math.random() * 9;
      return;
    }
    mote.age = mote.life;
    mote.sprite.visible = false;
  }

  private birdTouchesBlock(position: THREE.Vector3, yaw: number): boolean {
    // Body, head, tail, wing roots and wing tips. Rotate the samples with the
    // model so a diagonal wall is treated the same as an axis-aligned one.
    const sin = Math.sin(yaw);
    const cos = Math.cos(yaw);
    for (const [x, y, z] of BIRD_COLLISION_SAMPLES) {
      if (isSolid(this.world.getBlock(
        Math.floor(position.x + cos * x + sin * z),
        Math.floor(position.y + y),
        Math.floor(position.z - sin * x + cos * z),
      ))) return true;
    }
    return false;
  }

  private birdPathHitsBlock(from: THREE.Vector3, to: THREE.Vector3, yaw: number): boolean {
    const distance = from.distanceTo(to);
    // The focus jumped (teleport/respawn), rather than the bird flying this
    // path. Relocate it immediately instead of checking thousands of cells.
    if (distance > 8) return true;
    // A swept test prevents a low frame rate or a teleporting focus from
    // carrying a bird through a thin player-built wall.
    const steps = Math.max(1, Math.ceil(distance / 0.45));
    const point = new THREE.Vector3();
    for (let i = 1; i <= steps; i++) {
      point.lerpVectors(from, to, i / steps);
      if (this.birdTouchesBlock(point, yaw)) return true;
    }
    return false;
  }

  /** Move an ambient bird to fresh open sky. No smoke, drops or death effect. */
  private respawnBird(bird: Bird, focus: THREE.Vector3): void {
    for (let attempt = 0; attempt < 16; attempt++) {
      bird.angle = Math.random() * Math.PI * 2;
      bird.radius = 18 + Math.random() * 25;
      bird.speed = 0.07 + Math.random() * 0.055;
      bird.height = 7 + Math.random() * 9;
      const x = focus.x + Math.cos(bird.angle) * bird.radius;
      const z = focus.z + Math.sin(bird.angle) * bird.radius;
      bird.groundY = this.world.terrain.height(x, z);
      const y = Math.max(focus.y + bird.height, bird.groundY + 7);
      const candidate = new THREE.Vector3(x, y, z);
      if (this.birdTouchesBlock(candidate, -bird.angle)) continue;
      bird.group.position.copy(candidate);
      bird.group.rotation.y = -bird.angle;
      bird.sampleTimer = 0.25 + Math.random() * 0.35;
      bird.spawned = true;
      return;
    }
    // A very tall fallback remains inside the rendered area and is guaranteed
    // to be clear of ordinary terrain and builds.
    bird.group.position.set(focus.x + 24, Math.min(250, focus.y + 30), focus.z);
    bird.groundY = this.world.terrain.height(focus.x + 24, focus.z);
    bird.spawned = true;
  }

  update(
    dt: number,
    focus: THREE.Vector3,
    sunlight: number,
    enabled: boolean,
    reducedMotion = false,
  ): void {
    const day = THREE.MathUtils.smoothstep(sunlight, 0.55, 0.82);
    const night = 1 - THREE.MathUtils.smoothstep(sunlight, 0.42, 0.68);
    this.respawnTimer -= dt;

    for (const mote of this.motes) {
      mote.age += dt;
      const far = Math.hypot(mote.x - focus.x, mote.z - focus.z) > 46;
      if ((mote.age >= mote.life || far) && this.respawnTimer <= 0 && enabled) {
        this.placeMote(mote, focus);
        this.respawnTimer = 0.025;
      }
      const strength = mote.nocturnal ? night : day;
      const fade = Math.min(1, mote.age * 1.5, (mote.life - mote.age) * 1.5);
      mote.sprite.visible = enabled && strength > 0.02 && mote.age < mote.life;
      if (!mote.sprite.visible) continue;
      const motion = reducedMotion ? 0 : 1;
      const t = mote.age * (mote.nocturnal ? 1.5 : 2.2) + mote.phase;
      mote.sprite.position.set(
        mote.x + Math.sin(t * 0.73) * 0.7 * motion,
        mote.y + Math.sin(t) * 0.28 * motion,
        mote.z + Math.cos(t * 0.57) * 0.7 * motion,
      );
      mote.sprite.material.rotation = Math.sin(t * 3.4) * 0.22 * motion;
      mote.sprite.material.opacity = strength * fade *
        (mote.nocturnal ? 0.55 + Math.sin(t * 2.3) * 0.3 : 0.9);
    }

    for (const bird of this.birds) {
      bird.group.visible = enabled && day > 0.04;
      for (const material of bird.materials) material.opacity = 0.25 + day * 0.75;
      if (!bird.group.visible) continue;
      if (!bird.spawned) this.respawnBird(bird, focus);

      if (!reducedMotion) bird.angle += dt * bird.speed;
      const x = focus.x + Math.cos(bird.angle) * bird.radius;
      const z = focus.z + Math.sin(bird.angle) * bird.radius;
      // Terrain noise is intentionally not sampled every frame. A staggered
      // refresh keeps birds near the canopy while block checks catch actual
      // terrain or player-built obstacles along their flight path.
      bird.sampleTimer -= dt;
      if (bird.sampleTimer <= 0) {
        bird.groundY = this.world.terrain.height(x, z);
        bird.sampleTimer = 0.35 + (bird.phase % 0.3);
      }
      const targetY = Math.max(focus.y + bird.height, bird.groundY + 7);
      const y = THREE.MathUtils.lerp(
        bird.group.position.y, targetY, Math.min(1, dt * 1.8),
      );
      const next = new THREE.Vector3(x, y, z);
      if (this.birdPathHitsBlock(bird.group.position, next, -bird.angle)) {
        // Birds are not combat entities and cannot be killed by the player.
        // Contact simply relocates one to another safe patch of sky.
        this.respawnBird(bird, focus);
        continue;
      }

      bird.group.position.copy(next);
      bird.group.rotation.y = -bird.angle;
      const flap = reducedMotion ? 0.12 : Math.sin(bird.angle * 70 + bird.phase) * 0.78;
      bird.left.rotation.z = flap;
      bird.right.rotation.z = -flap;
      bird.group.rotation.x = reducedMotion
        ? 0
        : Math.sin(bird.angle * 16 + bird.phase) * 0.035;
    }
  }
}
