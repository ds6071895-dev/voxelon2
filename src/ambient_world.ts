// Lightweight ambient life for the open world. This is deliberately visual
// only: terrain remains deterministic/server-shared, while butterflies,
// fireflies and distant birds are a cheap local presentation layer.

import * as THREE from 'three';
import { Biome } from './biomes';
import type { Terrain } from './terrain';

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
  left: THREE.Mesh;
  right: THREE.Mesh;
  angle: number;
  radius: number;
  speed: number;
  height: number;
  phase: number;
  groundY: number;
  sampleTimer: number;
}

const MOTE_COUNT = 26;
const BIRD_COUNT = 7;
const DAY_COLORS = [0xffd84f, 0xff78b7, 0x8ddcff, 0xffa84f];
const NIGHT_COLORS = [0xd8ff67, 0x70ffd4, 0x8ec8ff];

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

export class AmbientWorld {
  private readonly terrain: Terrain;
  private readonly motes: Mote[] = [];
  private readonly birds: Bird[] = [];
  private readonly birdMaterial = new THREE.MeshBasicMaterial({
    color: 0x26364b, transparent: true, opacity: 0.72,
    depthWrite: false, fog: false,
  });
  private respawnTimer = 0;

  constructor(scene: THREE.Scene, terrain: Terrain) {
    this.terrain = terrain;
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

    const wingGeo = new THREE.BoxGeometry(0.62, 0.035, 0.16);
    for (let i = 0; i < BIRD_COUNT; i++) {
      const group = new THREE.Group();
      const left = new THREE.Mesh(wingGeo, this.birdMaterial);
      const right = new THREE.Mesh(wingGeo, this.birdMaterial);
      left.position.x = -0.34;
      right.position.x = 0.34;
      group.add(left, right);
      group.visible = false;
      scene.add(group);
      this.birds.push({
        group, left, right,
        angle: (i / BIRD_COUNT) * Math.PI * 2,
        radius: 30 + Math.random() * 32,
        speed: 0.035 + Math.random() * 0.025,
        height: 19 + Math.random() * 13,
        phase: Math.random() * Math.PI * 2,
        groundY: 0,
        sampleTimer: 0,
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
      const h = this.terrain.height(x, z);
      const biome = this.terrain.biomeWithWater(x, z, h);
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

    this.birdMaterial.opacity = day * 0.72;
    for (const bird of this.birds) {
      bird.group.visible = enabled && day > 0.04;
      if (!bird.group.visible) continue;
      if (!reducedMotion) bird.angle += dt * bird.speed;
      const x = focus.x + Math.cos(bird.angle) * bird.radius;
      const z = focus.z + Math.sin(bird.angle) * bird.radius;
      // Terrain noise is intentionally not sampled every frame. A staggered
      // half-second refresh keeps birds above nearby ridges without turning a
      // decorative flock into hundreds of height queries per second.
      bird.sampleTimer -= dt;
      if (bird.sampleTimer <= 0) {
        bird.groundY = this.terrain.height(x, z);
        bird.sampleTimer = 0.45 + (bird.phase % 0.4);
      }
      const targetY = Math.max(focus.y + bird.height, bird.groundY + 14);
      const y = bird.group.position.y === 0
        ? targetY
        : THREE.MathUtils.lerp(bird.group.position.y, targetY, Math.min(1, dt * 2));
      bird.group.position.set(x, y, z);
      bird.group.rotation.y = -bird.angle;
      const flap = reducedMotion ? 0.15 : Math.sin(bird.angle * 45 + bird.phase) * 0.52;
      bird.left.rotation.z = flap;
      bird.right.rotation.z = -flap;
    }
  }
}
