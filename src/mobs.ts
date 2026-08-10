// Mobs: boxy vanilla-proportioned models built from atlas skin tiles, walk
// animations, wander/gaze/flee/chase AI, light-based spawn rules, melee
// zombies that burn in sunlight, creepers with a fuse and a real explosion,
// knockback combat, drops and death poofs.

import * as THREE from 'three';
import { Block, BLOCKS, isSolid, isVaultMasonry, Tile } from './blocks';
import type { ItemEntities } from './itementity';
import { Item, ItemStack } from './items';
import { inCore } from './net/protocol';
import { VAULT_BOSS_HITBOX, VAULT_RECHARGE, VaultBossKind, VaultStamp } from './vaults';
import type { Particles } from './particles';
import type { Player } from './player';
import type { Atlas } from './textures';
import type { World } from './world';

// VOXELON: hostile mobs only — passive animals were removed. Milestone C adds
// the SPITTER (ranged lobber, keeps its distance) and the SKITTER (fast, low-HP
// lunger — panic fun, dies to one good hit; Wilds + dungeons). Milestone D adds
// the vault-boss BRUTE (huge, slow, telegraphed lunge — server-side HP online).
export type MobType = 'zombie' | 'creeper' | 'spitter' | 'skitter' | 'brute';

const GRAVITY = 32;
const JUMP_V = 8.4;
const FACE_SHADE = [0.6, 0.6, 1.0, 0.5, 0.8, 0.8]; // box faces +x -x +y -y +z -z

interface MobDef {
  health: number;
  speed: number;
  hostile: boolean;
  halfW: number;
  height: number;
  drops(rng: () => number): ItemStack[];
}

export const MOB_DEFS: Record<MobType, MobDef> = {
  zombie: {
    health: 20, speed: 2.3, hostile: true, halfW: 0.3, height: 1.9,
    drops: () => [],
  },
  creeper: {
    health: 20, speed: 2.0, hostile: true, halfW: 0.3, height: 1.7,
    drops: () => [],
  },
  // Ranged bog-lobber: fragile, keeps its distance, spits slow gobs.
  spitter: {
    health: 10, speed: 2.1, hostile: true, halfW: 0.3, height: 1.6,
    drops: (rng) => (rng() < 0.5 ? [{ id: Item.Bullet, count: 2 }] : []),
  },
  // Fast low chitin lunger: one good sword hit kills it.
  skitter: {
    health: 6, speed: 4.3, hostile: true, halfW: 0.35, height: 0.9,
    drops: (rng) => (rng() < 0.3 ? [{ id: Item.Stick, count: 1 }] : []),
  },
  // Vault Brute (Milestone D): a 2×-scale slow boss zombie guarding the vault
  // loot room. Online its HP is SERVER-side (this local value mirrors it); the
  // chest is the reward, so it drops nothing itself.
  brute: {
    health: 130, speed: 1.7, hostile: true, halfW: 0.55, height: 3.5,
    drops: () => [],
  },
};

const ZOMBIE_DAMAGE = 3;
const SKITTER_DAMAGE = 2;
const BRUTE_DAMAGE = 6;

/** Vault-boss movement and collision profiles. Server HP stays tier-based;
 * these tune each procedural client rig's scale, movement and melee damage. */
export const BOSS_VARIANTS: Record<VaultBossKind, {
  scale: number; speed: number; damage: number;
  tint: [number, number, number] | null;
}> = {
  bone_warden:       { scale: 1.85, speed: 0.95, damage: BRUTE_DAMAGE, tint: null },
  mire_queen:        { scale: 1.8, speed: 1.15, damage: 5, tint: null },
  ember_colossus:    { scale: 1.9, speed: 0.72, damage: 10, tint: null },
  crystal_seer:      { scale: 1.75, speed: 1.35, damage: 6, tint: null },
  gilded_artificer:  { scale: 1.8, speed: 1.25, damage: 7, tint: null },
};
const SPIT_DAMAGE = 3;
const SPIT_COOLDOWN = 2.4;
const CREEPER_FUSE = 1.5;
const EXPLOSION_RADIUS = 3;

// --- model building ----------------------------------------------------------

interface MobModel {
  group: THREE.Group;
  head: THREE.Object3D | null;
  legs: THREE.Object3D[];
}

function boxGeometry(
  atlas: Atlas, w: number, h: number, d: number, skin: Tile, front?: Tile
): THREE.BufferGeometry {
  const geo = new THREE.BoxGeometry(w, h, d);
  const uv = geo.getAttribute('uv') as THREE.BufferAttribute;
  const colors = new Float32Array(uv.count * 3);
  for (let f = 0; f < 6; f++) {
    const tile = f === 4 && front !== undefined ? front : skin;
    const [u0, v0, u1, v1] = atlas.uvRect(tile);
    for (let v = 0; v < 4; v++) {
      const k = f * 4 + v;
      uv.setXY(k, u0 + (u1 - u0) * uv.getX(k), v0 + (v1 - v0) * uv.getY(k));
      colors[k * 3] = colors[k * 3 + 1] = colors[k * 3 + 2] = FACE_SHADE[f];
    }
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  return geo;
}

/** Box part whose pivot sits at the TOP of the box (legs/arms swing). */
function hung(
  atlas: Atlas, mat: THREE.Material,
  w: number, h: number, d: number, skin: Tile,
  x: number, y: number, z: number
): THREE.Group {
  const g = new THREE.Group();
  const mesh = new THREE.Mesh(boxGeometry(atlas, w, h, d, skin), mat);
  mesh.position.y = -h / 2;
  g.add(mesh);
  g.position.set(x, y, z);
  return g;
}

function fixed(
  atlas: Atlas, mat: THREE.Material,
  w: number, h: number, d: number, skin: Tile,
  x: number, y: number, z: number, front?: Tile
): THREE.Mesh {
  const mesh = new THREE.Mesh(boxGeometry(atlas, w, h, d, skin, front), mat);
  mesh.position.set(x, y, z);
  return mesh;
}

function buildModel(type: MobType, atlas: Atlas, mat: THREE.Material): MobModel {
  const group = new THREE.Group();
  let head: THREE.Object3D | null = null;
  const legs: THREE.Object3D[] = [];

  switch (type) {
    case 'zombie': {
      group.add(fixed(atlas, mat, 0.5, 0.72, 0.26, Tile.ZombieShirt, 0, 1.14, 0));
      const hg = new THREE.Group();
      hg.position.set(0, 1.5, 0);
      hg.add(fixed(atlas, mat, 0.5, 0.5, 0.5, Tile.ZombieSkin, 0, 0.25, 0, Tile.ZombieFace));
      group.add(hg);
      head = hg;
      for (const sx of [-1, 1]) {
        const arm = hung(atlas, mat, 0.2, 0.7, 0.2, Tile.ZombieSkin, sx * 0.36, 1.46, 0);
        arm.rotation.x = -Math.PI / 2; // classic outstretched arms
        group.add(arm);
        const leg = hung(atlas, mat, 0.22, 0.76, 0.22, Tile.ZombiePants, sx * 0.13, 0.78, 0);
        legs.push(leg);
        group.add(leg);
      }
      break;
    }
    case 'spitter': {
      // A hunched bog-thing: squat body, oversized head with a wide maw.
      group.add(fixed(atlas, mat, 0.5, 0.6, 0.32, Tile.SpitterSkin, 0, 0.84, 0));
      const hg = new THREE.Group();
      hg.position.set(0, 1.1, 0);
      hg.add(fixed(atlas, mat, 0.56, 0.5, 0.52, Tile.SpitterSkin, 0, 0.25, 0.04, Tile.SpitterFace));
      group.add(hg);
      head = hg;
      for (const sx of [-1, 1]) {
        const leg = hung(atlas, mat, 0.2, 0.56, 0.2, Tile.SpitterSkin, sx * 0.14, 0.56, 0);
        legs.push(leg);
        group.add(leg);
      }
      break;
    }
    case 'skitter': {
      // A low, wide chitin scuttler on four stubby legs (spider-like silhouette).
      group.add(fixed(atlas, mat, 0.62, 0.34, 0.72, Tile.SkitterSkin, 0, 0.46, 0));
      const hg = new THREE.Group();
      hg.position.set(0, 0.52, -0.42);
      hg.add(fixed(atlas, mat, 0.4, 0.32, 0.34, Tile.SkitterSkin, 0, 0, 0, Tile.SkitterFace));
      group.add(hg);
      head = hg;
      for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        const leg = hung(atlas, mat, 0.14, 0.32, 0.14, Tile.SkitterSkin, sx * 0.34, 0.32, sz * 0.24);
        legs.push(leg);
        group.add(leg);
      }
      break;
    }
    case 'brute': {
      // A hulking zombie silhouette at ~1.9× scale (uniform group scale keeps
      // the walk/gaze animation code identical).
      group.add(fixed(atlas, mat, 0.56, 0.76, 0.3, Tile.BruteSkin, 0, 1.16, 0));
      const hg = new THREE.Group();
      hg.position.set(0, 1.54, 0);
      hg.add(fixed(atlas, mat, 0.56, 0.56, 0.56, Tile.BruteSkin, 0, 0.28, 0, Tile.BruteFace));
      group.add(hg);
      head = hg;
      for (const sx of [-1, 1]) {
        const arm = hung(atlas, mat, 0.26, 0.8, 0.26, Tile.BruteSkin, sx * 0.44, 1.5, 0);
        arm.rotation.x = -Math.PI / 2;
        group.add(arm);
        const leg = hung(atlas, mat, 0.26, 0.8, 0.26, Tile.BruteSkin, sx * 0.15, 0.8, 0);
        legs.push(leg);
        group.add(leg);
      }
      group.scale.setScalar(1.9);
      break;
    }
    case 'creeper': {
      group.add(fixed(atlas, mat, 0.45, 0.8, 0.3, Tile.CreeperSkin, 0, 0.78, 0));
      const hg = new THREE.Group();
      hg.position.set(0, 1.18, 0);
      hg.add(fixed(atlas, mat, 0.5, 0.5, 0.5, Tile.CreeperSkin, 0, 0.27, 0, Tile.CreeperFace));
      group.add(hg);
      head = hg;
      for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        const leg = hung(atlas, mat, 0.22, 0.38, 0.22, Tile.CreeperSkin, sx * 0.13, 0.38, sz * 0.18);
        legs.push(leg);
        group.add(leg);
      }
      break;
    }
  }
  return { group, head, legs };
}

// --- mob instance ------------------------------------------------------------

type MobState = 'idle' | 'walk' | 'flee' | 'chase';

export class Mob {
  readonly type: MobType;
  readonly def: MobDef;
  readonly pos: THREE.Vector3;
  readonly vel = new THREE.Vector3();
  yaw = Math.random() * Math.PI * 2;
  health: number;
  onGround = false;
  state: MobState = 'idle';
  stateTime = 1 + Math.random() * 3;
  hurtTime = 0;
  fuse = 0;
  fuseStarted = false;
  attackCooldown = 0;
  despawnTime = 0;
  burnAccum = 0;
  /** Damage-tick accumulator while standing on a Spike Trap. */
  spikeAccum = 0;
  soundTimer = 3 + Math.random() * 9;
  walkPhase = 0;
  brightness = 1;
  removed = false;
  /** Vault-guard tag: "cx,cz:roomIndex" of the spawn anchor that owns this mob. */
  room: string | null = null;
  /** Armored elite guard variant: more HP + a rusty tint. */
  armored = false;
  /** Per-instance collision size (boss variants rescale it). */
  halfW: number;
  height: number;
  /** Boss-variant modifiers (vault bosses only; 1/null = the plain mob). */
  speedFactor = 1;
  meleeDmg: number | null = null;
  tint: [number, number, number] | null = null;
  bossKind: VaultBossKind | null = null;
  bossBaseScale = 1;
  bossAnimTime = 0;
  bossCast = '';
  bossPhase: 1 | 2 | 3 = 1;
  bossDefeated = false;
  readonly bossParts: THREE.Object3D[] = [];
  readonly bossMaterials: THREE.Material[] = [];
  readonly model: MobModel;
  readonly material: THREE.MeshBasicMaterial;

  constructor(type: MobType, x: number, y: number, z: number, atlas: Atlas) {
    this.type = type;
    this.def = MOB_DEFS[type];
    this.health = this.def.health;
    this.halfW = this.def.halfW;
    this.height = this.def.height;
    this.pos = new THREE.Vector3(x, y, z);
    this.material = new THREE.MeshBasicMaterial({
      map: atlas.texture, vertexColors: true,
    });
    this.model = buildModel(type, atlas, this.material);
  }
}

/** Replace the generic brute mesh with a family-specific rig. The returned
 * model still uses the normal mob root, head and leg pivots, and every shape is
 * built above y=0 so encounter snapshot positions remain feet positions. */
export function buildBossModel(mob: Mob, kind: VaultBossKind, atlas: Atlas): void {
  const root = mob.model.group;
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
  });
  root.clear();
  mob.model.head = null;
  mob.model.legs.length = 0;
  mob.bossParts.length = 0;
  root.userData.bossKind = kind;

  const primary = kind === 'bone_warden' ? 0x2b2138
    : kind === 'mire_queen' ? 0x173c30
    : kind === 'ember_colossus' ? 0x241b1a
    : kind === 'crystal_seer' ? 0x17334a : 0x302819;
  const accentColor = kind === 'bone_warden' ? 0xd9cfad
    : kind === 'mire_queen' ? 0x6f8b45
    : kind === 'ember_colossus' ? 0x5d514b
    : kind === 'crystal_seer' ? 0x56a6d6 : 0xb78c32;
  const secondary = kind === 'bone_warden' ? 0xb984ff
    : kind === 'mire_queen' ? 0x7cffc6
    : kind === 'ember_colossus' ? 0xff7a2f
    : kind === 'crystal_seer' ? 0xbdefff : 0xffdf72;
  const armor = new THREE.MeshBasicMaterial({ color: primary });
  const accent = new THREE.MeshBasicMaterial({ color: accentColor });
  const glow = new THREE.MeshBasicMaterial({
    color: secondary, transparent: true, opacity: 0.9,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  armor.userData.baseColor = new THREE.Color(primary);
  accent.userData.baseColor = new THREE.Color(accentColor);
  glow.userData.baseColor = new THREE.Color(secondary);
  glow.userData.glow = true;
  mob.bossMaterials.push(armor, accent, glow);

  const add = <T extends THREE.Object3D>(
    object: T, x: number, y: number, z: number, animate = false,
  ): T => {
    object.position.set(x, y, z);
    root.add(object);
    if (animate) mob.bossParts.push(object);
    return object;
  };
  const box = (
    w: number, h: number, d: number, x: number, y: number, z: number,
    material: THREE.Material = armor, animate = false,
  ): THREE.Mesh => add(new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material),
    x, y, z, animate);
  const sphere = (
    radius: number, x: number, y: number, z: number,
    material: THREE.Material = armor, animate = false,
  ): THREE.Mesh => add(new THREE.Mesh(new THREE.SphereGeometry(radius, 8, 6), material),
    x, y, z, animate);
  const cylinder = (
    top: number, bottom: number, height: number, x: number, y: number, z: number,
    material: THREE.Material = armor, animate = false, sides = 8,
  ): THREE.Mesh => add(new THREE.Mesh(
    new THREE.CylinderGeometry(top, bottom, height, sides), material), x, y, z, animate);
  const octa = (
    radius: number, x: number, y: number, z: number,
    material: THREE.Material = armor, animate = false,
  ): THREE.Mesh => add(new THREE.Mesh(new THREE.OctahedronGeometry(radius, 0), material),
    x, y, z, animate);
  const tag = <T extends THREE.Object3D>(object: T, role: string, index = 0): T => {
    object.userData.role = role;
    object.userData.index = index;
    object.userData.baseX = object.position.x;
    object.userData.baseY = object.position.y;
    object.userData.baseZ = object.position.z;
    object.userData.baseRotX = object.rotation.x;
    object.userData.baseRotY = object.rotation.y;
    object.userData.baseRotZ = object.rotation.z;
    return object;
  };

  if (kind === 'bone_warden') {
    // Funeral bell suspended inside a walking ossuary cage.
    for (const sx of [-1, 1]) {
      box(0.22, 0.82, 0.24, sx * 0.28, 0.41, 0, accent);
      const upright = box(0.14, 1.28, 0.16, sx * 0.54, 1.45, 0, accent);
      upright.rotation.z = sx * -0.08;
      const chain = new THREE.Group();
      for (let i = 0; i < 4; i++) {
        const link = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.18, 0.13),
          i === 3 ? glow : accent);
        link.position.set(sx * i * 0.07, -i * 0.22, 0);
        link.rotation.z = i * Math.PI / 4;
        chain.add(link);
      }
      tag(add(chain, sx * 0.76, 1.5, 0, true), 'chain', sx);
    }
    box(1.26, 0.16, 0.22, 0, 2.08, 0, accent);
    box(1.02, 0.15, 0.2, 0, 1.15, 0, accent);
    for (const sx of [-1, 1]) {
      const arch = box(0.15, 0.78, 0.16, sx * 0.42, 2.37, 0, accent);
      arch.rotation.z = sx * -0.28;
    }
    tag(cylinder(0.27, 0.42, 0.62, 0, 1.55, 0, glow, true), 'bell');
    box(0.1, 0.42, 0.1, 0, 1.1, 0, glow);
    const head = new THREE.Group();
    head.add(new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.58, 0.3), armor));
    for (const sx of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.12, 0.05), glow);
      eye.position.set(sx * 0.14, 0.08, 0.17);
      head.add(eye);
    }
    tag(add(head, 0, 2.78, -0.02, true), 'lantern');
    mob.model.head = head;
  } else if (kind === 'mire_queen') {
    // Long lotus-crocodile serpent with a readable jaw, throat and tail.
    for (let i = 0; i < 4; i++) {
      const body = sphere(0.5 - i * 0.045, 0, 0.72 - i * 0.04, -i * 0.52,
        accent, i > 0);
      body.scale.set(1.25 - i * 0.08, 0.65, 1.2);
      if (i > 0) tag(body, 'tail', i);
    }
    const head = new THREE.Group();
    head.add(new THREE.Mesh(new THREE.BoxGeometry(0.92, 0.42, 0.76), armor));
    const jaw = new THREE.Mesh(new THREE.BoxGeometry(0.82, 0.16, 0.7), accent);
    jaw.position.set(0, -0.25, -0.05);
    head.add(jaw);
    for (const sx of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.09, 6, 4), glow);
      eye.position.set(sx * 0.3, 0.1, 0.37);
      head.add(eye);
    }
    tag(add(head, 0, 0.98, 0.72, true), 'maw');
    mob.model.head = head;
    const throat = sphere(0.27, 0, 0.58, 0.72, glow, true);
    throat.scale.set(1.2, 0.7, 1);
    tag(throat, 'throat');
    for (const sx of [-1, 1]) {
      for (let i = 0; i < 3; i++) {
        const fin = box(0.58, 0.1, 0.28, sx * 0.67, 0.73, 0.2 - i * 0.5,
          i === 1 ? armor : accent, true);
        fin.rotation.z = sx * -0.36;
        tag(fin, 'fin', i + (sx > 0 ? 3 : 0));
      }
    }
    for (let i = 0; i < 5; i++) {
      const petal = cylinder(0, 0.15, 0.72 + (i % 2) * 0.18,
        (i - 2) * 0.18, 1.54, 0.45, i === 2 ? glow : armor, true, 5);
      petal.rotation.z = (i - 2) * 0.24;
      tag(petal, 'crown', i);
    }
  } else if (kind === 'ember_colossus') {
    // Four-legged volcanic beast with a crater shell and molten tail.
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as [number, number][]) {
      const leg = box(0.38, 0.74, 0.42, sx * 0.62, 0.37, sz * 0.56, accent, true);
      tag(leg, 'caldera_leg', sx + sz * 2);
    }
    const body = sphere(0.76, 0, 1.08, 0.1, armor);
    body.scale.set(1.35, 0.78, 1.45);
    for (const sx of [-1, 1]) {
      const plate = box(0.5, 0.18, 1.15, sx * 0.67, 1.38, 0.1, accent);
      plate.rotation.z = sx * -0.16;
    }
    const crater = new THREE.Mesh(new THREE.TorusGeometry(0.48, 0.13, 6, 16), accent);
    crater.rotation.x = Math.PI / 2;
    tag(add(crater, 0, 1.72, 0.22, true), 'crater');
    tag(cylinder(0, 0.23, 0.72, 0, 2.02, 0.22, glow, true, 6), 'flame');
    const head = new THREE.Group();
    head.add(new THREE.Mesh(new THREE.BoxGeometry(0.78, 0.5, 0.64), accent));
    const jaw = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.18, 0.58), armor);
    jaw.position.set(0, -0.3, -0.08);
    head.add(jaw);
    const eye = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.13, 0.06), glow);
    eye.position.set(0, 0.08, 0.34);
    head.add(eye);
    tag(add(head, 0, 1.14, 1.02, true), 'caldera_head');
    mob.model.head = head;
    for (let i = 0; i < 3; i++) {
      const tail = box(0.42 - i * 0.08, 0.32 - i * 0.04, 0.58,
        0, 0.88 - i * 0.12, -1.05 - i * 0.46, i === 2 ? glow : accent, true);
      tag(tail, 'tail', i);
    }
  } else if (kind === 'crystal_seer') {
    // Broad prism moth with articulated wings and a hanging crystal tail.
    const core = octa(0.62, 0, 1.28, 0, armor);
    core.scale.set(0.68, 1.25, 0.62);
    for (const sx of [-1, 1]) {
      const wing = new THREE.Group();
      for (let i = 0; i < 3; i++) {
        const panel = new THREE.Mesh(new THREE.OctahedronGeometry(0.48 - i * 0.07, 0),
          i === 1 ? glow : accent);
        panel.scale.set(1.45, 0.58, 0.2);
        panel.position.set(sx * (0.38 + i * 0.48), (1 - i) * 0.28, 0.08 + i * 0.05);
        wing.add(panel);
      }
      tag(add(wing, sx * 0.36, 1.42, 0.08, true), 'wing', sx);
    }
    const head = new THREE.Group();
    const mask = new THREE.Mesh(new THREE.OctahedronGeometry(0.42, 0), accent);
    mask.scale.set(0.82, 1.08, 0.48);
    head.add(mask);
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.2, 10, 6), glow);
    eye.scale.set(0.5, 1.5, 0.38);
    eye.position.z = 0.36;
    head.add(eye);
    tag(add(head, 0, 1.74, 0.32, true), 'seer_head');
    mob.model.head = head;
    for (let i = 0; i < 4; i++) {
      const tail = octa(0.28 - i * 0.035, 0, 0.72 - i * 0.34, 0.08 + i * 0.06,
        i % 2 ? glow : accent, true);
      tail.scale.set(0.72, 1.25, 0.55);
      tag(tail, 'prism_tail', i);
    }
  } else {
    // Tall tripod crane automaton with clock-face head and three tools.
    for (let i = 0; i < 3; i++) {
      const a = -Math.PI / 2 + i * Math.PI * 2 / 3;
      const leg = box(0.22, 1.25, 0.24, Math.cos(a) * 0.62, 0.62,
        Math.sin(a) * 0.62, accent, true);
      leg.rotation.z = Math.cos(a) * -0.24;
      leg.rotation.x = Math.sin(a) * 0.24;
      tag(leg, 'tripod', i);
    }
    cylinder(0.62, 0.76, 0.5, 0, 1.2, 0, armor);
    tag(octa(0.32, 0, 1.02, 0, glow, true), 'core');
    box(0.24, 0.9, 0.24, 0, 1.72, 0, accent);
    const head = new THREE.Group();
    const clock = new THREE.Mesh(new THREE.SphereGeometry(0.56, 10, 7), armor);
    clock.scale.set(1, 1, 0.28);
    head.add(clock);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.51, 0.07, 6, 20), accent);
    rim.position.z = 0.17;
    head.add(rim);
    for (let i = 0; i < 8; i++) {
      const mark = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.14, 0.04), glow);
      const a = i * Math.PI / 4;
      mark.position.set(Math.sin(a) * 0.38, Math.cos(a) * 0.38, 0.22);
      mark.rotation.z = -a;
      head.add(mark);
    }
    const hand = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.48, 0.05), glow);
    hand.position.set(0, 0.16, 0.24);
    head.add(hand);
    tag(add(head, 0, 2.38, -0.02, true), 'clock');
    mob.model.head = head;
    for (let i = 0; i < 3; i++) {
      const a = i * Math.PI * 2 / 3;
      const arm = new THREE.Group();
      const beam = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 1.15), accent);
      beam.position.z = -0.52;
      arm.add(beam);
      const tool = new THREE.Mesh(i === 0
        ? new THREE.ConeGeometry(0.22, 0.5, 6)
        : i === 1 ? new THREE.BoxGeometry(0.5, 0.18, 0.35)
          : new THREE.OctahedronGeometry(0.25, 0), i === 2 ? glow : armor);
      tool.position.set(0, 0, -1.05);
      tool.rotation.x = i === 0 ? Math.PI / 2 : 0;
      arm.add(tool);
      arm.rotation.y = a;
      tag(add(arm, 0, 1.82, 0, true), 'tool', i);
    }
  }
}

// --- mob manager ---------------------------------------------------------------

const HOSTILE_CAP = 10;
/** The Wilds (outside the Heartland core) are +50% denser — risk out there. */
const HOSTILE_CAP_WILDS = 15;
const DESPAWN_DIST = 44;

export class Mobs {
  readonly list: Mob[] = [];
  /** Natural spawning toggle (off = peaceful-style; also used by tests). */
  spawningEnabled = true;
  /** Sound cues: 'zombie' groan, 'hiss', 'mobHurt', 'explosion', 'poof'. */
  onSound?: (name: string, pos: THREE.Vector3) => void;
  /** The player damaged the Vault Brute (main reports it to the server, which
   *  owns the shared boss HP online). Fired AFTER the local damage applies. */
  onBruteHit?: (mob: Mob, damage: number) => void;
  /** A mob died to PLAYER damage (melee or projectile) — XP progression hook. */
  onPlayerKill?: (kind: string) => void;
  /** The local Brute died (offline authority: main marks the vault cleared). */
  onBruteDown?: (mob: Mob) => void;

  private readonly scene: THREE.Scene;
  private readonly world: World;
  private readonly atlas: Atlas;
  private readonly items: ItemEntities;
  private readonly particles: Particles;
  private spawnTimer = 0;
  private lightTimer = 0;
  // --- Vault guards (Milestone D): spawner-driven per-room populations ---
  /** The vault the player is currently inside (set by main each frame). */
  private vault: VaultStamp | null = null;
  private guardTimer = 0;
  private guardClock = 0;
  private readonly roomWaves = new Map<string, {
    spawned: number; defeated: number; dormantUntil: number;
  }>();
  /** In-flight spitter gobs (simple lobbed projectiles; client-side like mobs). */
  private readonly spits: { pos: THREE.Vector3; vel: THREE.Vector3; mesh: THREE.Mesh; life: number }[] = [];
  private readonly spitGeo = new THREE.SphereGeometry(0.16, 6, 5);
  private readonly spitMat = new THREE.MeshBasicMaterial({ color: 0x9ab33a });

  constructor(
    scene: THREE.Scene, world: World, atlas: Atlas,
    items: ItemEntities, particles: Particles
  ) {
    this.scene = scene;
    this.world = world;
    this.atlas = atlas;
    this.items = items;
    this.particles = particles;
  }

  spawnAt(type: MobType, x: number, y: number, z: number): Mob {
    const mob = new Mob(type, x, y, z, this.atlas);
    this.scene.add(mob.model.group);
    this.list.push(mob);
    return mob;
  }

  /** Spawn a vault boss with a family-specific rig; the root and hitbox still
   *  follow the standard brute API used by combat and snapshot playback. */
  spawnBoss(kind: VaultBossKind, x: number, y: number, z: number): Mob {
    const mob = this.spawnAt('brute', x, y, z);
    const v = BOSS_VARIANTS[kind] ?? BOSS_VARIANTS.bone_warden;
    buildBossModel(mob, kind, this.atlas);
    mob.model.group.scale.setScalar(v.scale);
    mob.bossKind = kind;
    mob.bossBaseScale = v.scale;
    mob.halfW = VAULT_BOSS_HITBOX[kind].halfWidth;
    mob.height = VAULT_BOSS_HITBOX[kind].height;
    mob.speedFactor = v.speed;
    mob.meleeDmg = v.damage;
    mob.tint = v.tint;
    return mob;
  }

  poseBoss(mob: Mob, cast: string | null, phase: 1 | 2 | 3, defeated = false): void {
    if (!mob.bossKind) return;
    mob.bossCast = cast ?? '';
    mob.bossPhase = phase;
    mob.bossDefeated = defeated;
  }


  /** The vault the player is inside right now (null = not in a vault). Drives
   *  the per-room guard spawn anchors; main sets it every frame. */
  setVault(v: VaultStamp | null): void {
    this.vault = v;
  }

  /** Remove a mob outright (poof, no drops) — used when the SERVER declares
   *  the shared-HP Vault Brute dead before our local copy caught up. */
  slay(mob: Mob): void {
    if (mob.removed) return;
    this.particles.poof(mob.pos.x, mob.pos.y + mob.height / 2, mob.pos.z);
    this.onSound?.('poof', mob.pos);
    this.remove(mob);
  }

  /** Each intact cage releases one finite wave. Killing the wave silences the
   * room for the vault recharge period; mining is never part of progression. */
  private tickVaultGuards(player: Player): void {
    const v = this.vault;
    if (!v || player.dead) return;
    for (let i = 0; i < v.rooms.length; i++) {
      const room = v.rooms[i];
      if (room.cap <= 0) continue; // the hall + boss room have no spawner
      // The spawner is a protected visual anchor, not a destructible objective.
      const sx = Math.floor(room.x), sy = Math.floor(room.y), sz = Math.floor(room.z);
      if (this.world.getBlock(sx, sy, sz) !== Block.MobSpawner) continue;
      // Spawners activate only with a player nearby (MC-style pressure).
      const near = Math.hypot(player.pos.x - room.x, player.pos.z - room.z) < 26 &&
        Math.abs(player.pos.y - room.y) < 10;
      if (!near) continue;
      const key = `${v.cx},${v.cz}:${i}`;
      let wave = this.roomWaves.get(key);
      if (!wave) {
        wave = { spawned: 0, defeated: 0, dormantUntil: 0 };
        this.roomWaves.set(key, wave);
      }
      if (wave.dormantUntil > this.guardClock) continue;
      if (wave.dormantUntil > 0) {
        wave.spawned = 0;
        wave.defeated = 0;
        wave.dormantUntil = 0;
      }
      let count = 0;
      for (const m of this.list) if (m.room === key) count++;
      // A despawned guard is replaced; only real combat kills advance a clear.
      wave.spawned = Math.min(wave.spawned, wave.defeated + count);
      const total = room.cap + v.tier;
      if (wave.defeated >= total && count === 0) {
        wave.dormantUntil = this.guardClock + VAULT_RECHARGE;
        this.particles.poof(room.x + 0.5, room.y + 0.6, room.z + 0.5);
        continue;
      }
      if (this.guardTimer > 0 || count >= room.cap || wave.spawned >= total) continue;
      // Pour out right beside the cage (the spawner's 3×3 plinth is safe floor).
      const gx = room.x + 0.5 + (Math.random() * 2 - 1) * 1.2;
      const gz = room.z + 0.5 + (Math.random() * 2 - 1) * 1.2;
      const roll = Math.random();
      // Each room THEME breeds its own garrison: bog wings spit, groves crawl,
      // crypts hide creepers (the walls are blast-proof — the raider isn't),
      // and the treasury fields nothing but elites.
      let type: MobType;
      switch (room.kind) {
        case 'flooded': type = roll < 0.7 ? 'spitter' : 'zombie'; break;
        case 'garden': type = roll < 0.65 ? 'skitter' : 'spitter'; break;
        case 'crypt': type = roll < 0.35 ? 'creeper' : 'zombie'; break;
        case 'lava': type = roll < 0.5 ? 'skitter' : 'zombie'; break;
        case 'treasury': type = roll < 0.5 ? 'zombie' : 'spitter'; break;
        case 'pit': type = roll < 0.55 ? 'skitter' : 'zombie'; break;
        default: type = v.tier >= 2 && roll < 0.3 ? 'skitter'
          : roll < 0.65 ? 'zombie' : 'spitter';
      }
      const mob = this.spawnAt(type, gx, room.y, gz);
      mob.room = key;
      wave.spawned++;
      // Armored elites: every treasury guard, all of Tier III, some of Tier II.
      if (room.kind === 'treasury' || v.tier >= 3 ||
          (v.tier === 2 && Math.random() < 0.35)) {
        mob.armored = true;
        mob.health = Math.round(mob.health * 1.8);
      }
      this.particles.poof(room.x + 0.5, room.y + 0.6, room.z + 0.5); // cage flash
      this.guardTimer = 2.0; // at most one guard spawn per beat
    }
  }

  private hostileCount(): number {
    return this.list.filter((m) => m.def.hostile).length;
  }

  private trySpawns(player: Player, sun: number): void {
    const cap = inCore(player.pos.x, player.pos.z) ? HOSTILE_CAP : HOSTILE_CAP_WILDS;
    if (this.hostileCount() >= cap) return;
    const angle = Math.random() * Math.PI * 2;
    const dist = 20 + Math.random() * 22;
    const x = Math.floor(player.pos.x + Math.cos(angle) * dist);
    const z = Math.floor(player.pos.z + Math.sin(angle) * dist);
    const surface = this.world.terrain.height(x, z);

    // Surface at night, or anywhere dark underground.
    let y = Math.random() < 0.5
      ? surface + 1
      : 8 + Math.floor(Math.random() * Math.max(1, surface - 14));
    for (let i = 0; i < 6; i++, y--) {
      if (
        this.world.getBlock(x, y, z) === Block.Air &&
        this.world.getBlock(x, y + 1, z) === Block.Air &&
        isSolid(this.world.getBlock(x, y - 1, z))
      ) break;
      if (i === 5) y = -1;
    }
    if (y > 1 &&
      this.world.approxBlockLight(x, y, z) < 8 &&
      (sun < 0.5 || !this.world.hasSkyAccess(x, y, z))
    ) {
      // Creepers stay out of the spawn pool (their explosion helper still
      // powers rockets). Night/dark spawns: mostly zombies, some spitters —
      // and out in the WILDS the fast little skitters join the pool.
      const wilds = !inCore(player.pos.x, player.pos.z);
      const roll = Math.random();
      const type: MobType = wilds
        ? (roll < 0.5 ? 'zombie' : roll < 0.75 ? 'spitter' : 'skitter')
        : (roll < 0.72 ? 'zombie' : 'spitter');
      this.spawnAt(type, x + 0.5, y, z + 0.5);
    }
  }

  /** Ray vs mob AABBs; used for attacks and to suppress mining. */
  rayHit(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number): Mob | null {
    let best: Mob | null = null;
    let bestT = maxDist;
    for (const mob of this.list) {
      const { halfW, height } = mob;
      const min = new THREE.Vector3(mob.pos.x - halfW, mob.pos.y, mob.pos.z - halfW);
      const max = new THREE.Vector3(mob.pos.x + halfW, mob.pos.y + height, mob.pos.z + halfW);
      const t = rayBox(origin, dir, min, max);
      if (t !== null && t < bestT) {
        bestT = t;
        best = mob;
      }
    }
    return best;
  }

  /** Player melee. Returns true when a mob was hit. */
  attack(
    origin: THREE.Vector3, dir: THREE.Vector3, damage: number, player: Player
  ): boolean {
    const mob = this.rayHit(origin, dir, 3.5);
    if (!mob) return false;
    mob.health -= damage;
    mob.hurtTime = 0.5;
    // The Brute is heavy — barely any knockback (it's a boss, not a piñata).
    const heavy = mob.type === 'brute' ? 0.15 : 1;
    const away = new THREE.Vector3(
      mob.pos.x - player.pos.x, 0, mob.pos.z - player.pos.z
    ).normalize();
    mob.vel.x += away.x * 7 * heavy;
    mob.vel.z += away.z * 7 * heavy;
    mob.vel.y += 4.5 * heavy;
    if (!mob.def.hostile) {
      mob.state = 'flee';
      mob.stateTime = 4;
    }
    this.onSound?.('mobHurt', mob.pos);
    if (mob.type === 'brute') this.onBruteHit?.(mob, damage);
    if (mob.health <= 0) { this.onPlayerKill?.(mob.type); this.kill(mob); }
    return true;
  }

  /** First mob whose AABB contains the point (projectile point-collision). */
  private mobAtPoint(p: THREE.Vector3): Mob | null {
    for (const mob of this.list) {
      const { halfW, height } = mob;
      if (p.x >= mob.pos.x - halfW && p.x <= mob.pos.x + halfW &&
        p.y >= mob.pos.y && p.y <= mob.pos.y + height &&
        p.z >= mob.pos.z - halfW && p.z <= mob.pos.z + halfW) return mob;
    }
    return null;
  }

  /** Projectile hit: damage + knock the mob at `p` (knock along `dir`).
   *  Returns true when a mob was hit. */
  shootPoint(p: THREE.Vector3, damage: number, dir: THREE.Vector3): boolean {
    const mob = this.mobAtPoint(p);
    if (!mob) return false;
    mob.health -= damage;
    mob.hurtTime = 0.5;
    const heavy = mob.type === 'brute' ? 0.15 : 1; // bosses barely budge
    mob.vel.x += dir.x * 5 * heavy;
    mob.vel.z += dir.z * 5 * heavy;
    mob.vel.y += 3 * heavy;
    if (!mob.def.hostile) { mob.state = 'flee'; mob.stateTime = 4; }
    this.onSound?.('mobHurt', mob.pos);
    if (mob.type === 'brute') this.onBruteHit?.(mob, damage);
    if (mob.health <= 0) { this.onPlayerKill?.(mob.type); this.kill(mob); }
    return true;
  }

  private kill(mob: Mob): void {
    if (mob.room) {
      const wave = this.roomWaves.get(mob.room);
      if (wave) wave.defeated++;
    }
    if (mob.type === 'brute') this.onBruteDown?.(mob);
    for (const drop of mob.def.drops(Math.random)) {
      this.items.spawn(
        mob.pos.x, mob.pos.y + 0.4, mob.pos.z, drop.id, drop.count
      );
    }
    this.particles.poof(mob.pos.x, mob.pos.y + mob.height / 2, mob.pos.z);
    this.onSound?.('poof', mob.pos);
    this.remove(mob);
  }

  private remove(mob: Mob): void {
    if (mob.removed) return; // idempotent: a mob can be killed twice in a frame
    mob.removed = true;
    this.scene.remove(mob.model.group);
    // Each mob owns ~6 unique BoxGeometries (per-mob baked UV/color); they are
    // GPU buffers that scene.remove does not free, so dispose them explicitly.
    mob.model.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
    });
    mob.material.dispose();
    for (const material of mob.bossMaterials) material.dispose();
    const i = this.list.indexOf(mob);
    if (i >= 0) this.list.splice(i, 1);
  }

  explode(center: THREE.Vector3, player: Player): void {
    this.onSound?.('explosion', center);
    this.particles.explosion(center.x, center.y, center.z);

    // Break blocks in a sphere; batched so it costs one remesh per chunk.
    this.world.dropChance = 0.3;
    this.world.beginBatch();
    const r = EXPLOSION_RADIUS;
    for (let dx = -r; dx <= r; dx++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dz = -r; dz <= r; dz++) {
          if (dx * dx + dy * dy + dz * dz > r * r + 1) continue;
          const x = Math.floor(center.x) + dx;
          const y = Math.floor(center.y) + dy;
          const z = Math.floor(center.z) + dz;
          const id = this.world.getBlock(x, y, z);
          if (id === Block.Air || id === Block.Water) continue;
          if ((BLOCKS[id]?.hardness ?? -1) < 0) continue; // bedrock
          // Vaults are blast-proof: no rocket/grenade can crack a dungeon open
          // (mirrors the server, which also skips vault blocks in its crater).
          // Spawners + gold hoards survive too — crypt creepers must not clear
          // their own room, and treasure is mined, never vaporized.
          if (isVaultMasonry(id) || id === Block.VaultChest ||
              id === Block.MobSpawner || id === Block.GoldBlock) continue;
          this.world.setBlock(x, y, z, Block.Air);
        }
      }
    }
    this.world.endBatch();
    this.world.dropChance = 1;

    // Damage + fling the player and nearby mobs (linear falloff over 6).
    const hurt = (pos: THREE.Vector3, apply: (dmg: number, k: THREE.Vector3) => void) => {
      const d = pos.distanceTo(center);
      const f = Math.max(0, 1 - d / 6);
      if (f <= 0) return;
      const kick = pos.clone().sub(center);
      kick.y += 1.5;
      kick.normalize().multiplyScalar(14 * f);
      apply(Math.round(22 * f), kick);
    };
    hurt(player.pos.clone().setY(player.pos.y + 0.9), (dmg, k) => {
      player.damage(dmg);
      player.vel.add(k);
    });
    for (const mob of [...this.list]) {
      hurt(mob.pos, (dmg, k) => {
        mob.health -= dmg;
        mob.hurtTime = 0.5;
        mob.vel.add(k);
        if (mob.health <= 0) this.kill(mob);
      });
    }
  }

  update(dt: number, player: Player, sun: number): void {
    this.guardClock += dt;
    this.guardTimer = Math.max(0, this.guardTimer - dt);
    if (this.spawningEnabled) this.tickVaultGuards(player);
    this.spawnTimer += dt;
    if (this.spawnTimer >= 1) {
      this.spawnTimer = 0;
      if (this.spawningEnabled && !player.dead) this.trySpawns(player, sun);
    }
    this.lightTimer += dt;
    const relight = this.lightTimer >= 0.3;
    if (relight) this.lightTimer = 0;

    for (const mob of [...this.list]) {
      this.updateMob(dt, mob, player, sun, relight);
    }
    this.updateSpits(dt, player);
  }

  /** Launch a lobbed spit gob from a spitter toward the player. */
  private spitAt(mob: Mob, player: Player): void {
    const from = mob.pos.clone(); from.y += mob.height * 0.75;
    const target = player.pos.clone(); target.y += 1.0;
    const d = target.clone().sub(from);
    const flat = Math.hypot(d.x, d.z) || 1;
    const speed = 11;
    const t = flat / speed;
    const vel = new THREE.Vector3(
      (d.x / flat) * speed,
      d.y / t + 0.5 * 18 * t, // lob arc that lands on the player (gravity 18)
      (d.z / flat) * speed,
    );
    const mesh = new THREE.Mesh(this.spitGeo, this.spitMat);
    mesh.position.copy(from);
    this.scene.add(mesh);
    this.spits.push({ pos: from, vel, mesh, life: 0 });
    this.onSound?.('spit', mob.pos);
  }

  /** Advance spit gobs: gravity arc, hit the player, splat on terrain. */
  private updateSpits(dt: number, player: Player): void {
    for (let i = this.spits.length - 1; i >= 0; i--) {
      const sp = this.spits[i];
      sp.life += dt;
      sp.vel.y -= 18 * dt;
      sp.pos.addScaledVector(sp.vel, dt);
      sp.mesh.position.copy(sp.pos);
      const hitPlayer = !player.dead &&
        Math.abs(sp.pos.x - player.pos.x) < 0.6 &&
        Math.abs(sp.pos.z - player.pos.z) < 0.6 &&
        sp.pos.y > player.pos.y - 0.2 && sp.pos.y < player.pos.y + 2.0;
      const inBlock = isSolid(this.world.getBlock(
        Math.floor(sp.pos.x), Math.floor(sp.pos.y), Math.floor(sp.pos.z)));
      if (hitPlayer) player.damage(SPIT_DAMAGE);
      if (hitPlayer || inBlock || sp.life > 5) {
        this.particles.poof(sp.pos.x, sp.pos.y, sp.pos.z);
        this.scene.remove(sp.mesh);
        this.spits.splice(i, 1);
      }
    }
  }

  private updateMob(
    dt: number, mob: Mob, player: Player, sun: number, relight: boolean
  ): void {
    // A creeper detonating earlier this frame can kill other mobs that are
    // still in this frame's snapshot; skip any already removed.
    if (mob.removed) return;
    const def = mob.def;
    mob.hurtTime = Math.max(0, mob.hurtTime - dt);
    mob.attackCooldown = Math.max(0, mob.attackCooldown - dt);

    const toPlayer = new THREE.Vector3().subVectors(player.pos, mob.pos);
    const distXZ = Math.hypot(toPlayer.x, toPlayer.z);
    const dist = mob.pos.distanceTo(player.pos);

    // Cull any mob that fell out of the world (its chunk unloaded beneath it)
    // or strayed beyond loaded terrain, so passives can't pile up or plummet
    // forever and the population stays fresh as the player roams.
    if (mob.pos.y < -8 || dist > 128) {
      this.remove(mob);
      return;
    }
    // Despawn far hostiles (sooner than the hard cull above).
    if (def.hostile) {
      mob.despawnTime = dist > DESPAWN_DIST ? mob.despawnTime + dt : 0;
      if (mob.despawnTime > 3) {
        this.remove(mob);
        return;
      }
    }

    // A creeper's fuse only advances while it is actively priming next to a
    // living player (handled in the chase branch). Everywhere else — player
    // escaped past chase range, player died, or it backed off — it winds back
    // down, so it can never get stuck swollen and flashing.
    const priming = mob.type === 'creeper' && !player.dead && dist < 3;
    if (mob.type === 'creeper' && !priming && mob.fuse > 0) {
      mob.fuse = Math.max(0, mob.fuse - dt * 1.5);
      if (mob.fuse === 0) mob.fuseStarted = false;
    }

    // --- AI ---------------------------------------------------------------
    let moving = false;
    let speedMul = 0.7;

    if (mob.bossKind) {
      mob.state = 'idle';
      mob.vel.x = 0;
      mob.vel.z = 0;
    } else if (mob.state === 'flee') {
      mob.stateTime -= dt;
      mob.yaw = Math.atan2(-toPlayer.x, -toPlayer.z);
      moving = true;
      speedMul = 1.5;
      if (mob.stateTime <= 0) mob.state = 'idle';
    } else if (def.hostile && !player.dead && dist < 16) {
      mob.state = 'chase';
      mob.yaw = Math.atan2(toPlayer.x, toPlayer.z);
      speedMul = 1;
      if (mob.type === 'zombie' || mob.type === 'skitter' || mob.type === 'brute') {
        moving = true;
        if (mob.type === 'skitter') {
          speedMul = 1.15;
          // Lunge: a telegraphed hop that closes the last few blocks fast.
          if (mob.onGround && dist < 5 && dist > 1.6 && mob.attackCooldown <= 0.3 &&
              Math.abs(toPlayer.y) < 2) {
            const dir = toPlayer.clone().setY(0).normalize();
            mob.vel.x = dir.x * 8; mob.vel.z = dir.z * 8; mob.vel.y = 5;
          }
        } else if (mob.type === 'brute') {
          // The Brute: slow stalk, then a big telegraphed leap that closes in.
          if (mob.onGround && dist < 7 && dist > 2.6 && mob.attackCooldown <= 0.5 &&
              Math.abs(toPlayer.y) < 3) {
            const dir = toPlayer.clone().setY(0).normalize();
            mob.vel.x = dir.x * 8.5; mob.vel.z = dir.z * 8.5; mob.vel.y = 5.5;
          }
        }
        const dmg = mob.type === 'skitter' ? SKITTER_DAMAGE
          : mob.type === 'brute' ? (mob.meleeDmg ?? BRUTE_DAMAGE) : ZOMBIE_DAMAGE;
        const cd = mob.type === 'skitter' ? 0.9 : mob.type === 'brute' ? 2.0 : 1.2;
        const reach = mob.type === 'brute' ? 1.4 : 1.0;
        if (distXZ < mob.halfW + reach && Math.abs(toPlayer.y) < 2.5 &&
          mob.attackCooldown <= 0) {
          mob.attackCooldown = cd;
          player.damage(dmg);
          const kick = toPlayer.clone().setY(0).normalize()
            .multiplyScalar(mob.type === 'brute' ? 11 : 7);
          player.vel.add(kick);
          player.vel.y += mob.type === 'brute' ? 4.5 : 3;
        }
        mob.soundTimer -= dt;
        if (mob.soundTimer <= 0) {
          mob.soundTimer = 3 + Math.random() * 4;
          this.onSound?.(mob.type === 'skitter' ? 'skitter'
            : mob.type === 'brute' ? 'brute' : 'zombie', mob.pos);
        }
      } else if (mob.type === 'spitter') {
        // Keep a ranged distance: advance when far, back off when crowded,
        // and lob a slow spit gob whenever the player is in the sweet band.
        if (dist > 9) {
          moving = true;
        } else if (dist < 5.5) {
          mob.yaw = Math.atan2(-toPlayer.x, -toPlayer.z); // back away
          moving = true;
          speedMul = 1.1;
        }
        if (dist >= 4 && dist < 15 && mob.attackCooldown <= 0) {
          mob.attackCooldown = SPIT_COOLDOWN;
          this.spitAt(mob, player);
        }
      } else { // creeper: stalk silently, fuse close in
        moving = dist > 2.2;
        if (dist < 3) {
          if (!mob.fuseStarted) {
            mob.fuseStarted = true;
            this.onSound?.('hiss', mob.pos);
          }
          mob.fuse += dt;
          if (mob.fuse >= CREEPER_FUSE) {
            const at = mob.pos.clone();
            at.y += 0.8;
            this.remove(mob);
            this.explode(at, player);
            return;
          }
        }
        // Backing off (dist 3..16) is covered by the global fuse decay above.
      }
    } else {
      // Passive wander / hostile idle wander.
      if (mob.state === 'chase') mob.state = 'idle';
      mob.stateTime -= dt;
      if (mob.stateTime <= 0) {
        if (mob.state === 'idle') {
          mob.state = 'walk';
          mob.stateTime = 2 + Math.random() * 3;
          mob.yaw = Math.random() * Math.PI * 2;
        } else {
          mob.state = 'idle';
          mob.stateTime = 1.5 + Math.random() * 3;
        }
      }
      moving = mob.state === 'walk';
      // Idle voice.
      if (!def.hostile && dist < 20) {
        mob.soundTimer -= dt;
        if (mob.soundTimer <= 0) {
          mob.soundTimer = 5 + Math.random() * 10;
          this.onSound?.(mob.type, mob.pos);
        }
      }
    }

    // Zombies burn in direct sunlight.
    if (mob.type === 'zombie' && sun > 0.55 &&
      this.world.hasSkyAccess(
        Math.floor(mob.pos.x), Math.floor(mob.pos.y + 1), Math.floor(mob.pos.z)
      )
    ) {
      mob.burnAccum += dt;
      if (mob.burnAccum >= 1) {
        mob.burnAccum = 0;
        mob.health -= 1;
        mob.hurtTime = 0.3;
        if (mob.health <= 0) {
          this.kill(mob);
          return;
        }
      }
    }

    // Spike Traps prick mobs standing on them (base defense: spikes work on
    // zombies as well as raiders).
    if (this.world.getBlock(
      Math.floor(mob.pos.x), Math.floor(mob.pos.y - 0.05), Math.floor(mob.pos.z)
    ) === Block.SpikeTrap) {
      mob.spikeAccum += dt;
      if (mob.spikeAccum >= 0.7) {
        mob.spikeAccum = 0;
        mob.health -= 2;
        mob.hurtTime = 0.3;
        if (mob.health <= 0) {
          this.kill(mob);
          return;
        }
      }
    } else {
      mob.spikeAccum = 0;
    }

    // --- physics ------------------------------------------------------------
    const speed = moving ? def.speed * mob.speedFactor * speedMul : 0;
    const dirX = Math.sin(mob.yaw), dirZ = Math.cos(mob.yaw);
    const t = Math.min(1, 8 * dt);
    mob.vel.x += (dirX * speed - mob.vel.x) * t;
    mob.vel.z += (dirZ * speed - mob.vel.z) * t;

    const feet = this.world.getBlock(
      Math.floor(mob.pos.x), Math.floor(mob.pos.y + 0.3), Math.floor(mob.pos.z)
    );
    if (feet === Block.Water) {
      mob.vel.y += 26 * dt;
      mob.vel.y = Math.min(2.5, mob.vel.y) * (1 - 2 * dt);
    } else {
      mob.vel.y -= GRAVITY * dt;
      if (mob.vel.y < -60) mob.vel.y = -60;
    }

    const wasOnGround = mob.onGround;
    mob.onGround = false;
    this.moveAxis(mob, 1, mob.vel.y * dt);
    const hitX = this.moveAxis(mob, 0, mob.vel.x * dt);
    const hitZ = this.moveAxis(mob, 2, mob.vel.z * dt);
    if ((hitX || hitZ) && wasOnGround && moving) mob.vel.y = JUMP_V; // hop up

    // --- presentation ---------------------------------------------------------
    mob.model.group.position.copy(mob.pos);
    mob.model.group.rotation.y = mob.yaw;

    if (mob.bossKind) {
      mob.bossAnimTime += dt;
      const bt = mob.bossAnimTime;
      const casting = mob.bossCast ? 1 : 0;
      const pressure = 1 + (mob.bossPhase - 1) * 0.18;
      const breathe = 1 + Math.sin(bt * 1.8) * 0.015 * pressure;
      mob.model.group.scale.setScalar(mob.bossBaseScale * breathe);
      mob.model.group.rotation.z += ((mob.bossDefeated ? -Math.PI / 2 : 0) -
        mob.model.group.rotation.z) * Math.min(1, dt * 4);
      for (let i = 0; i < mob.bossParts.length; i++) {
        const part = mob.bossParts[i];
        const role = part.userData.role as string | undefined;
        const orbit = part.userData.orbit as number | undefined;
        const index = Number(part.userData.index ?? i);
        if (role === 'chain') {
          part.rotation.x = Math.sin(bt * 1.7 + index) * 0.12 - casting * 0.65;
          part.rotation.z = Math.sin(bt * 1.1 + index) * 0.08;
        } else if (role === 'bell') {
          part.rotation.z = Math.sin(bt * (casting ? 9 : 2.2)) * (casting ? 0.22 : 0.04);
          part.scale.setScalar(1 + casting * 0.13);
        } else if (role === 'lantern') {
          part.position.y = (part.userData.baseY ?? 2.78) + Math.sin(bt * 2.1) * 0.05;
        } else if (role === 'tail') {
          part.position.x = (part.userData.baseX ?? 0) +
            Math.sin(bt * 1.5 - index * 0.65) * (0.08 + index * 0.035) * pressure;
          part.rotation.y = Math.sin(bt * 1.4 - index * 0.7) * 0.12 * pressure;
        } else if (role === 'maw' || role === 'caldera_head') {
          part.rotation.x = casting ? -0.16 - Math.sin(bt * 7) * 0.08 : Math.sin(bt) * 0.025;
        } else if (role === 'throat') {
          const pulse = 1 + Math.sin(bt * (casting ? 8 : 3)) * (casting ? 0.22 : 0.08);
          part.scale.set(1.2 * pulse, 0.7 * pulse, pulse);
        } else if (role === 'fin') {
          part.rotation.z = (part.userData.baseRotZ ?? 0) + Math.sin(bt * 2 + index) * 0.09;
        } else if (role === 'crown') {
          part.rotation.z = (part.userData.baseRotZ ?? 0) +
            Math.sin(bt * 1.7 + index) * 0.1 + casting * (index - 2) * 0.06;
        } else if (role === 'caldera_leg') {
          part.position.y = (part.userData.baseY ?? 0.37) + Math.sin(bt * 2.4 + index) * 0.035;
        } else if (role === 'crater') {
          part.rotation.z = bt * (0.35 + mob.bossPhase * 0.16);
        } else if (role === 'flame') {
          const pulse = 1 + Math.sin(bt * 7) * 0.16 + casting * 0.25;
          part.scale.set(1, pulse, 1);
        } else if (role === 'wing') {
          part.rotation.z = index * (0.08 + Math.sin(bt * 1.8) * 0.04);
          part.rotation.y = index * Math.sin(bt * (casting ? 5 : 1.6)) *
            (casting ? 0.2 : 0.06);
        } else if (role === 'seer_head') {
          part.position.y = (part.userData.baseY ?? 1.74) + Math.sin(bt * 1.5) * 0.08;
        } else if (role === 'prism_tail') {
          part.rotation.y = bt * (index % 2 ? -0.55 : 0.55);
          part.position.x = Math.sin(bt * 1.4 + index) * 0.05;
        } else if (role === 'clock') {
          part.rotation.z = Math.sin(bt * 0.8) * 0.04;
        } else if (role === 'tool') {
          part.rotation.y = index * Math.PI * 2 / 3 + bt * (casting ? 1.6 : 0.28);
          part.rotation.x = casting ? Math.sin(bt * 5 + index) * 0.2 : 0;
        } else if (role === 'tripod') {
          part.position.y = (part.userData.baseY ?? 0.62) + Math.sin(bt * 2 + index * 2) * 0.035;
        } else if (role === 'core') {
          const pulse = 1 + Math.sin(bt * (casting ? 8 : 5)) * 0.1 + casting * 0.1;
          part.scale.setScalar(pulse);
        } else if (orbit !== undefined && role === 'shard') {
          const outer = orbit < 6;
          const a = bt * (outer ? 0.72 : -1.05) + orbit * (Math.PI * 2 / (outer ? 6 : 4));
          const r = outer ? 1.0 : 0.64;
          part.position.set(Math.cos(a) * r, 2.15 + Math.sin(a * 2) * 0.22,
            Math.sin(a) * r);
          part.rotation.y = -a * 1.7;
          part.rotation.z = a * 0.8;
        } else if (orbit !== undefined) {
          const a = bt * 0.62 + orbit * Math.PI / 2;
          part.position.set(Math.cos(a) * 0.92, 2.05 + Math.sin(a * 2) * 0.18,
            Math.sin(a) * 0.92);
          part.rotation.y = -a;
        } else if (role === 'gear') {
          part.rotation.z = bt * 0.75 * (part.userData.spin ?? 1);
        } else if (role === 'halo') {
          part.rotation.z = bt * 0.55;
          part.rotation.y = Math.sin(bt * 0.6) * 0.18;
        } else if (role === 'tendril') {
          part.rotation.z = (part.userData.baseRotZ ?? 0) + Math.sin(bt * 1.9 + i) * 0.16;
          part.rotation.x = (part.userData.baseRotX ?? 0) + Math.cos(bt * 1.5 + i) * 0.12;
        } else if (role === 'frond') {
          part.rotation.z = (part.userData.baseRotZ ?? 0) + Math.sin(bt * 1.2 + i) * 0.1;
        } else if (role === 'eye' || role === 'sac' || role === 'seam') {
          const pulse = 1 + Math.sin(bt * 3.2 + i) * 0.09;
          part.scale.setScalar(pulse);
          if (role === 'eye') part.scale.set(1.45 * pulse, 0.72 * pulse, 0.5 * pulse);
        } else if (role === 'piston') {
          part.position.y = (part.userData.baseY ?? 1.3) + Math.sin(bt * 3.5 + i) * 0.14;
        } else if (role === 'chimney') {
          part.position.y = (part.userData.baseY ?? 2.92) + Math.sin(bt * 2.2 + i) * 0.04;
        } else if (role === 'fist') {
          part.rotation.x = Math.sin(bt * 1.25 + i * Math.PI) * 0.12;
        }
      }
    }

    const horiz = Math.hypot(mob.vel.x, mob.vel.z);
    mob.walkPhase += horiz * dt * 3.2;
    const swing = Math.sin(mob.walkPhase) * Math.min(1, horiz / def.speed) * 0.7;
    mob.model.legs.forEach((leg, i) => {
      leg.rotation.x = i % 2 === 0 ? swing : -swing;
    });

    // Gaze at the player when close (or while chasing).
    if (mob.model.head) {
      const want = (mob.state === 'chase' || dist < 5)
        ? wrapAngle(Math.atan2(toPlayer.x, toPlayer.z) - mob.yaw)
        : 0;
      mob.model.head.rotation.y +=
        (Math.max(-1.1, Math.min(1.1, want)) - mob.model.head.rotation.y) *
        Math.min(1, 10 * dt);
    }

    // Creeper swells while the fuse runs.
    if (mob.type === 'creeper') {
      const f = mob.fuse / CREEPER_FUSE;
      const pulse = 1 + f * 0.25 * (1 + Math.sin(mob.fuse * 30) * 0.3);
      mob.model.group.scale.setScalar(pulse);
    }

    // Lighting + hurt/burn tint.
    if (relight) {
      const bx = Math.floor(mob.pos.x), by = Math.floor(mob.pos.y + 1),
        bz = Math.floor(mob.pos.z);
      const sky = this.world.hasSkyAccess(bx, by, bz) ? sun : 0.12;
      const block = this.world.approxBlockLight(bx, by, bz) / 15;
      mob.brightness = 0.25 + 0.75 * Math.max(sky, block);
    }
    const b = mob.brightness;
    if (mob.hurtTime > 0) mob.material.color.setRGB(b, b * 0.35, b * 0.35);
    else if (mob.tint) { // family tint on the boss's textured body pieces
      mob.material.color.setRGB(
        Math.min(1, b * mob.tint[0]), Math.min(1, b * mob.tint[1]), Math.min(1, b * mob.tint[2]));
    }
    else if (mob.armored) mob.material.color.setRGB(b, b * 0.78, b * 0.6); // rusty plate tint
    else if (mob.type === 'creeper' && mob.fuse > 0) {
      const w = 0.5 + 0.5 * Math.sin(mob.fuse * 25);
      mob.material.color.setRGB(b + (1 - b) * w, b + (1 - b) * w, b + (1 - b) * w);
    } else mob.material.color.setScalar(b);
    for (const material of mob.bossMaterials) {
      const mat = material as THREE.MeshBasicMaterial;
      const base = mat.userData.baseColor as THREE.Color | undefined;
      if (!base) continue;
      if (mob.hurtTime > 0) mat.color.setRGB(1, 0.22, 0.16);
      else if (mat.userData.glow) mat.color.copy(base);
      else mat.color.setRGB(base.r * b, base.g * b, base.b * b);
    }
  }

  /**
   * Move along one axis with collision. Large moves (fast falls, explosion
   * knockback) are split into <=0.5-block sub-steps so a mob can't tunnel
   * straight through a one-block-thick floor between origin and destination.
   */
  private moveAxis(mob: Mob, axis: 0 | 1 | 2, amount: number): boolean {
    if (amount === 0) return false;
    const steps = Math.ceil(Math.abs(amount) / 0.5);
    if (steps <= 1) return this.moveAxisStep(mob, axis, amount);
    const slice = amount / steps;
    for (let i = 0; i < steps; i++) {
      if (this.moveAxisStep(mob, axis, slice)) return true; // clamped on hit
    }
    return false;
  }

  /** One unswept AABB collision step; returns true if the axis was blocked. */
  private moveAxisStep(mob: Mob, axis: 0 | 1 | 2, amount: number): boolean {
    if (amount === 0) return false;
    const p = mob.pos;
    const { halfW, height } = mob;
    if (axis === 0) p.x += amount;
    else if (axis === 1) p.y += amount;
    else p.z += amount;

    const x0 = Math.floor(p.x - halfW), x1 = Math.floor(p.x + halfW);
    const y0 = Math.floor(p.y), y1 = Math.floor(p.y + height);
    const z0 = Math.floor(p.z - halfW), z1 = Math.floor(p.z + halfW);
    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) {
        for (let z = z0; z <= z1; z++) {
          if (!isSolid(this.world.getBlock(x, y, z))) continue;
          if (axis === 0) {
            p.x = amount > 0 ? x - halfW - 0.001 : x + 1 + halfW + 0.001;
            mob.vel.x = 0;
          } else if (axis === 1) {
            if (amount > 0) p.y = y - height - 0.001;
            else {
              p.y = y + 1 + 0.001;
              mob.onGround = true;
            }
            mob.vel.y = 0;
          } else {
            p.z = amount > 0 ? z - halfW - 0.001 : z + 1 + halfW + 0.001;
            mob.vel.z = 0;
          }
          return true;
        }
      }
    }
    return false;
  }
}

function wrapAngle(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

/** Ray/AABB slab test; returns entry distance or null. */
function rayBox(
  origin: THREE.Vector3, dir: THREE.Vector3,
  min: THREE.Vector3, max: THREE.Vector3
): number | null {
  let tmin = 0, tmax = Infinity;
  for (const k of ['x', 'y', 'z'] as const) {
    const d = dir[k];
    if (Math.abs(d) < 1e-9) {
      if (origin[k] < min[k] || origin[k] > max[k]) return null;
      continue;
    }
    let t1 = (min[k] - origin[k]) / d;
    let t2 = (max[k] - origin[k]) / d;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return null;
  }
  return tmin;
}
