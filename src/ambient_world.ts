// Ambient life and weather for the open world. Deliberately visual only:
// terrain stays deterministic and server-shared, while everything in here is a
// cheap local presentation layer that gives each biome its own AIR.
//
// v0.45: this used to be 26 butterfly sprites over grassland. It is now a
// biome-driven atmosphere — cherry petals, autumn leaves, alpine snow, desert
// dust, volcanic embers, jungle spores, crystal sparkles, meadow pollen and
// fireflies — running as exactly TWO draw calls. Every mote lives in one of two
// THREE.Points clouds (one normally blended, one additive); a 2x2 sprite atlas
// and per-point colour/size/alpha attributes do the rest. Adding a new effect
// costs a table entry, not a draw call.

import * as THREE from 'three';
import { Biome } from './biomes';
import type { World } from './world';

/** Sprite tiles in the 2x2 atlas. */
const enum Tile { Glow = 0, Wing = 1, Petal = 2, Fleck = 3 }

type Kind =
  | 'butterfly' | 'firefly' | 'petal' | 'leaf' | 'pollen' | 'spore'
  | 'snow' | 'dust' | 'ember' | 'sparkle' | 'mist' | 'seed';

interface KindDef {
  tile: Tile;
  /** Additive motes are the glowing ones and live in the second cloud. */
  additive: boolean;
  colors: number[];
  /** Point size in world-ish units (scaled by distance in the shader). */
  size: [number, number];
  /** Vertical drift, blocks/s. Negative falls. */
  rise: number;
  /** How far the mote wanders sideways as it lives. */
  wander: number;
  life: [number, number];
  /** Spawn height above the ground column. */
  height: [number, number];
  /** Daylight window: [min, max] sun intensity in which this appears. */
  light: [number, number];
  alpha: number;
  /** Multiplies the per-frame flicker. 0 = steady, 1 = strong pulse. */
  flicker: number;
}

const KINDS: Record<Kind, KindDef> = {
  butterfly: {
    tile: Tile.Wing, additive: false,
    colors: [0xffd84f, 0xff78b7, 0x8ddcff, 0xffa84f, 0xff5f6d],
    size: [0.30, 0.44], rise: 0.05, wander: 1.1, life: [7, 15],
    height: [0.9, 2.4], light: [0.62, 1.01], alpha: 0.95, flicker: 0,
  },
  firefly: {
    tile: Tile.Glow, additive: true,
    colors: [0xd8ff67, 0x9dff8a, 0x70ffd4],
    size: [0.22, 0.34], rise: 0.12, wander: 0.9, life: [6, 13],
    height: [0.7, 3.4], light: [0, 0.5], alpha: 0.85, flicker: 1,
  },
  petal: {
    tile: Tile.Petal, additive: false,
    colors: [0xffb7d8, 0xffd0e4, 0xff92c2, 0xffe3ef],
    size: [0.26, 0.4], rise: -0.75, wander: 1.5, life: [7, 12],
    height: [4, 11], light: [0.3, 1.01], alpha: 0.95, flicker: 0,
  },
  leaf: {
    tile: Tile.Petal, additive: false,
    colors: [0xff8a1f, 0xe04b16, 0xffb32e, 0xc76a1a],
    size: [0.3, 0.46], rise: -0.85, wander: 1.7, life: [7, 12],
    height: [4, 12], light: [0.3, 1.01], alpha: 0.95, flicker: 0,
  },
  pollen: {
    tile: Tile.Glow, additive: true,
    colors: [0xffe98a, 0xfff4bf, 0xffd35c],
    size: [0.16, 0.26], rise: 0.22, wander: 1.0, life: [6, 12],
    height: [0.5, 3.2], light: [0.6, 1.01], alpha: 0.5, flicker: 0.4,
  },
  spore: {
    tile: Tile.Glow, additive: true,
    colors: [0x8fffa8, 0x5ce8b4, 0xcfff8a],
    size: [0.18, 0.3], rise: 0.16, wander: 0.8, life: [7, 14],
    height: [0.6, 4.5], light: [0, 1.01], alpha: 0.42, flicker: 0.6,
  },
  snow: {
    tile: Tile.Fleck, additive: false,
    colors: [0xffffff, 0xeaf4ff, 0xd8ecff],
    size: [0.16, 0.28], rise: -1.5, wander: 1.2, life: [5, 9],
    height: [6, 16], light: [0, 1.01], alpha: 0.9, flicker: 0,
  },
  dust: {
    tile: Tile.Fleck, additive: false,
    colors: [0xe8d5a4, 0xd6bd86, 0xf0e2bd],
    size: [0.14, 0.26], rise: 0.05, wander: 2.6, life: [4, 8],
    height: [0.4, 4], light: [0.4, 1.01], alpha: 0.5, flicker: 0,
  },
  ember: {
    tile: Tile.Glow, additive: true,
    colors: [0xff7a1f, 0xffb54a, 0xff3d18],
    size: [0.16, 0.3], rise: 1.5, wander: 0.7, life: [4, 8],
    height: [0.2, 2.5], light: [0, 1.01], alpha: 0.9, flicker: 0.8,
  },
  sparkle: {
    tile: Tile.Glow, additive: true,
    colors: [0x9ad8ff, 0xd8b4ff, 0x8affe8],
    size: [0.18, 0.34], rise: 0.3, wander: 0.5, life: [4, 9],
    height: [0.3, 4], light: [0, 1.01], alpha: 0.85, flicker: 1,
  },
  mist: {
    tile: Tile.Glow, additive: false,
    colors: [0xbfd4c8, 0xd6e2da, 0xa8bfb2],
    size: [1.6, 3.2], rise: 0.02, wander: 0.6, life: [10, 18],
    height: [0.2, 1.6], light: [0, 0.72], alpha: 0.16, flicker: 0,
  },
  seed: {
    tile: Tile.Fleck, additive: false,
    colors: [0xf2f7dd, 0xe4eec2, 0xffffff],
    size: [0.14, 0.24], rise: -0.15, wander: 1.9, life: [8, 15],
    height: [1, 5], light: [0.5, 1.01], alpha: 0.7, flicker: 0,
  },
};

/** Which motes belong in which biome. Order is preference, not weight — a
 *  column picks uniformly from its list, so listing a kind twice doubles it. */
const BIOME_AIR: Partial<Record<Biome, Kind[]>> = {
  [Biome.Plains]: ['butterfly', 'pollen', 'seed', 'firefly'],
  [Biome.SunflowerPlains]: ['butterfly', 'pollen', 'pollen', 'seed'],
  [Biome.Meadow]: ['butterfly', 'butterfly', 'pollen', 'pollen', 'seed', 'firefly'],
  [Biome.Heath]: ['butterfly', 'seed', 'pollen'],
  [Biome.Forest]: ['butterfly', 'firefly', 'firefly', 'seed', 'spore'],
  [Biome.BirchForest]: ['butterfly', 'firefly', 'seed'],
  [Biome.AutumnForest]: ['leaf', 'leaf', 'leaf', 'butterfly', 'firefly'],
  [Biome.CherryGrove]: ['petal', 'petal', 'petal', 'butterfly', 'firefly'],
  [Biome.Jungle]: ['spore', 'spore', 'butterfly', 'firefly', 'firefly', 'pollen'],
  [Biome.RedwoodForest]: ['spore', 'mist', 'firefly', 'seed'],
  [Biome.Taiga]: ['seed', 'spore', 'firefly'],
  [Biome.SnowyTaiga]: ['snow', 'snow', 'spore'],
  [Biome.Snowy]: ['snow', 'snow', 'snow'],
  [Biome.IceSpikes]: ['snow', 'snow', 'sparkle'],
  [Biome.SnowyMountains]: ['snow', 'snow'],
  [Biome.Mountains]: ['dust', 'seed'],
  [Biome.Highlands]: ['butterfly', 'pollen', 'seed', 'snow'],
  [Biome.Swamp]: ['mist', 'mist', 'firefly', 'firefly', 'spore'],
  [Biome.Desert]: ['dust', 'dust', 'dust'],
  [Biome.Mesa]: ['dust', 'dust'],
  [Biome.Steppe]: ['dust', 'seed', 'butterfly'],
  [Biome.Savanna]: ['dust', 'seed', 'butterfly', 'pollen'],
  [Biome.Ashlands]: ['ember', 'ember', 'ember', 'dust'],
  [Biome.Crystalfields]: ['sparkle', 'sparkle', 'sparkle', 'spore'],
  [Biome.TropicalCoast]: ['butterfly', 'seed', 'dust'],
  [Biome.Beach]: ['seed', 'dust'],
};

const MOTE_COUNT = 260;
const SPAWN_RADIUS = 38;
const CULL_RADIUS = 52;

interface Mote {
  kind: Kind;
  active: boolean;
  x: number; y: number; z: number;
  vx: number; vz: number;
  phase: number;
  age: number;
  life: number;
  size: number;
  color: THREE.Color;
}

/** 2x2 sprite atlas: soft glow, butterfly wings, a petal, a fleck. */
function moteAtlas(): THREE.CanvasTexture {
  const S = 32;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = S * 2;
  const ctx = canvas.getContext('2d')!;

  // (0,0) soft radial glow.
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.55)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);

  // (1,0) two-wing butterfly silhouette, drawn chunky to match the voxel art.
  ctx.fillStyle = '#fff';
  ctx.globalAlpha = 0.25;
  ctx.fillRect(S + 7, 7, 18, 18);
  ctx.globalAlpha = 1;
  ctx.fillRect(S + 4, 10, 10, 12);
  ctx.fillRect(S + 18, 10, 10, 12);
  ctx.fillRect(S + 14, 12, 4, 11);

  // (0,1) petal / leaf: an angled lozenge.
  ctx.beginPath();
  ctx.ellipse(S / 2, S + S / 2, S * 0.36, S * 0.17, -0.6, 0, Math.PI * 2);
  ctx.fill();

  // (1,1) fleck: a small soft square, for snow and dust.
  const f = ctx.createRadialGradient(S + S / 2, S + S / 2, 0, S + S / 2, S + S / 2, S * 0.4);
  f.addColorStop(0, 'rgba(255,255,255,1)');
  f.addColorStop(0.6, 'rgba(255,255,255,0.85)');
  f.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = f;
  ctx.fillRect(S, S, S, S);

  const tex = new THREE.CanvasTexture(canvas);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  return tex;
}

const VERT = `
  attribute float aSize;
  attribute float aAlpha;
  attribute float aTile;
  varying vec3 vColor;
  varying float vAlpha;
  varying vec2 vTileOffset;
  void main() {
    vColor = color;
    vAlpha = aAlpha;
    // aTile 0..3 -> the corner of the 2x2 atlas this point samples. The row is
    // inverted because the canvas is uploaded with flipY, so canvas row 0 (the
    // top) ends up as the UPPER half of UV space, not the lower.
    vTileOffset = vec2(mod(aTile, 2.0), 1.0 - floor(aTile / 2.0)) * 0.5;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * 320.0 / max(-mv.z, 0.1);
    gl_Position = projectionMatrix * mv;
  }
`;

const FRAG = `
  uniform sampler2D uMap;
  varying vec3 vColor;
  varying float vAlpha;
  varying vec2 vTileOffset;
  void main() {
    if (vAlpha <= 0.001) discard;
    vec2 uv = vTileOffset + gl_PointCoord * 0.5;
    vec4 tex = texture2D(uMap, uv);
    gl_FragColor = vec4(vColor * tex.rgb, tex.a * vAlpha);
    if (gl_FragColor.a < 0.004) discard;
  }
`;

/** One THREE.Points cloud: geometry, attributes and the slot bookkeeping. */
class MoteCloud {
  readonly points: THREE.Points;
  readonly positions: Float32Array;
  readonly colors: Float32Array;
  readonly sizes: Float32Array;
  readonly alphas: Float32Array;
  readonly tiles: Float32Array;
  private readonly geo: THREE.BufferGeometry;

  constructor(scene: THREE.Scene, map: THREE.Texture, count: number, additive: boolean) {
    this.positions = new Float32Array(count * 3);
    this.colors = new Float32Array(count * 3);
    this.sizes = new Float32Array(count);
    this.alphas = new Float32Array(count);
    this.tiles = new Float32Array(count);
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.geo.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));
    this.geo.setAttribute('aSize', new THREE.BufferAttribute(this.sizes, 1));
    this.geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alphas, 1));
    this.geo.setAttribute('aTile', new THREE.BufferAttribute(this.tiles, 1));
    // The cloud follows the player, so a bounding sphere computed once from
    // startup positions would cull it the moment they walked away from spawn.
    this.geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    const mat = new THREE.ShaderMaterial({
      uniforms: { uMap: { value: map } },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      vertexColors: true,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      fog: false,
    });
    this.points = new THREE.Points(this.geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    scene.add(this.points);
  }

  flush(): void {
    for (const name of ['position', 'color', 'aSize', 'aAlpha', 'aTile']) {
      (this.geo.getAttribute(name) as THREE.BufferAttribute).needsUpdate = true;
    }
  }
}

export class AmbientWorld {
  private readonly world: World;
  private readonly motes: Mote[] = [];
  private readonly plain: MoteCloud;
  private readonly glow: MoteCloud;
  private respawnBudget = 0;
  private time = 0;
  /** Slow wind heading, so dust, petals and snow all lean the same way. */
  private windAngle = Math.random() * Math.PI * 2;

  constructor(scene: THREE.Scene, world: World) {
    this.world = world;
    const atlas = moteAtlas();
    this.plain = new MoteCloud(scene, atlas, MOTE_COUNT, false);
    this.glow = new MoteCloud(scene, atlas, MOTE_COUNT, true);
    for (let i = 0; i < MOTE_COUNT; i++) {
      this.motes.push({
        kind: 'butterfly', active: false, x: 0, y: 0, z: 0, vx: 0, vz: 0,
        phase: Math.random() * Math.PI * 2, age: 0, life: 0, size: 0.3,
        color: new THREE.Color(),
      });
    }
  }

  /** Find a home for one mote: pick a nearby column, read its biome, and take
   *  a kind that biome actually supports at the current time of day. */
  private place(mote: Mote, focus: THREE.Vector3, sunlight: number): boolean {
    for (let attempt = 0; attempt < 6; attempt++) {
      const a = Math.random() * Math.PI * 2;
      const r = 6 + Math.sqrt(Math.random()) * SPAWN_RADIUS;
      const x = focus.x + Math.cos(a) * r;
      const z = focus.z + Math.sin(a) * r;
      const ground = this.world.terrain.height(x, z);
      const biome = this.world.terrain.biomeWithWater(x, z, ground);
      const menu = BIOME_AIR[biome];
      if (!menu) continue;
      const kind = menu[(Math.random() * menu.length) | 0];
      const def = KINDS[kind];
      if (sunlight < def.light[0] || sunlight > def.light[1]) continue;

      mote.kind = kind;
      mote.active = true;
      mote.x = x;
      mote.z = z;
      mote.y = ground + def.height[0] +
        Math.random() * (def.height[1] - def.height[0]);
      mote.age = 0;
      mote.life = def.life[0] + Math.random() * (def.life[1] - def.life[0]);
      mote.phase = Math.random() * Math.PI * 2;
      mote.size = def.size[0] + Math.random() * (def.size[1] - def.size[0]);
      mote.color.setHex(def.colors[(Math.random() * def.colors.length) | 0]);
      // Wind pushes everything the same way, with a little per-mote scatter.
      const spread = this.windAngle + (Math.random() - 0.5) * 1.1;
      const speed = def.wander * (0.35 + Math.random() * 0.5);
      mote.vx = Math.cos(spread) * speed;
      mote.vz = Math.sin(spread) * speed;
      return true;
    }
    return false;
  }

  update(
    dt: number,
    focus: THREE.Vector3,
    sunlight: number,
    enabled: boolean,
    reducedMotion = false,
  ): void {
    this.time += dt;
    // The wind swings slowly. Everything airborne leans with it, which is what
    // makes falling petals and blowing dust read as one weather rather than as
    // several independent particle systems.
    this.windAngle += Math.sin(this.time * 0.037) * dt * 0.28;

    // Respawn is rate-limited: placing a mote costs a terrain height+biome
    // lookup, and doing 260 of them in the frame you walk into a new biome is
    // exactly the kind of spike a player feels.
    this.respawnBudget = Math.min(8, this.respawnBudget + dt * 45);

    let plainN = 0;
    let glowN = 0;
    const motion = reducedMotion ? 0 : 1;

    for (const mote of this.motes) {
      if (mote.active) {
        mote.age += dt;
        const far = Math.hypot(mote.x - focus.x, mote.z - focus.z) > CULL_RADIUS;
        if (mote.age >= mote.life || far) mote.active = false;
      }
      if (!mote.active) {
        if (!enabled || this.respawnBudget < 1) continue;
        this.respawnBudget -= 1;
        if (!this.place(mote, focus, sunlight)) continue;
      }

      const def = KINDS[mote.kind];
      // Integrate. Falling motes (petals, leaves, snow) also swing sideways as
      // they go, which is the whole difference between drifting and dropping.
      const t = this.time * 1.4 + mote.phase;
      mote.x += mote.vx * dt * motion;
      mote.z += mote.vz * dt * motion;
      mote.y += def.rise * dt * motion;
      const swingX = Math.sin(t * 0.8) * def.wander * 0.45 * motion;
      const swingZ = Math.cos(t * 0.61) * def.wander * 0.45 * motion;
      const bob = def.rise >= 0 ? Math.sin(t * 1.7) * 0.22 * motion : 0;

      // Fade in and out rather than popping, and let the glowing kinds pulse.
      const fade = Math.min(1, mote.age * 1.6, (mote.life - mote.age) * 1.6);
      const flick = def.flicker > 0
        ? 1 - def.flicker * 0.45 * (0.5 + 0.5 * Math.sin(t * 2.6 + mote.phase))
        : 1;
      // Everything dims toward the horizon of its own draw radius, so nothing
      // ever winks out at the cull edge.
      const dist = Math.hypot(mote.x - focus.x, mote.z - focus.z);
      const near = 1 - Math.min(1, Math.max(0, (dist - (CULL_RADIUS - 14)) / 14));
      const alpha = def.alpha * fade * flick * near * (enabled ? 1 : 0);

      const cloud = def.additive ? this.glow : this.plain;
      const i = def.additive ? glowN++ : plainN++;
      cloud.positions[i * 3] = mote.x + swingX;
      cloud.positions[i * 3 + 1] = mote.y + bob;
      cloud.positions[i * 3 + 2] = mote.z + swingZ;
      cloud.colors[i * 3] = mote.color.r;
      cloud.colors[i * 3 + 1] = mote.color.g;
      cloud.colors[i * 3 + 2] = mote.color.b;
      cloud.sizes[i] = mote.size;
      cloud.alphas[i] = alpha;
      cloud.tiles[i] = def.tile;
    }

    this.plain.points.geometry.setDrawRange(0, plainN);
    this.glow.points.geometry.setDrawRange(0, glowN);
    this.plain.points.visible = enabled && plainN > 0;
    this.glow.points.visible = enabled && glowN > 0;
    this.plain.flush();
    this.glow.flush();
  }
}
