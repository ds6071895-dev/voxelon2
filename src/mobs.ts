// Mobs: boxy vanilla-proportioned models built from atlas skin tiles, walk
// animations, wander/gaze/flee/chase AI, light-based spawn rules, melee
// zombies that burn in sunlight, creepers with a fuse and a real explosion,
// knockback combat, drops and death poofs.

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { bossSurface } from './boss_surface';
import { detailBoss } from './boss_detail';
import { Block, BLOCKS, isSolid, isVaultMasonry, Tile } from './blocks';
import type { ItemEntities } from './itementity';
import { Item, ItemStack } from './items';
import { inCore, SYNCED_MOB_TYPES, type MobWire } from './net/protocol';
export { SYNCED_MOB_TYPES, type MobWire };
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

/** A living player (other than us) that owner-simulated mobs may hunt. */
export interface MobTarget { id: number; pos: THREE.Vector3; dead: boolean }

/** Where a proxy mob's owner last put it, and when we heard. */
interface ProxyState {
  owner: number; nid: number;
  tx: number; ty: number; tz: number; tyaw: number;
  seen: number; sw: number; sp: number; tg: number;
}

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
 * these tune each procedural client rig's scale, movement and melee damage.
 * Every rig is authored at ONE scale so the local model extents and the shared
 * `VAULT_BOSS_HITBOX` (which the lair's ceiling clearance is derived from)
 * cannot drift apart. */
export const BOSS_SCALE = 1.8;
export const BOSS_VARIANTS: Record<VaultBossKind, {
  scale: number; speed: number; damage: number;
  tint: [number, number, number] | null;
}> = {
  bone_warden:       { scale: BOSS_SCALE, speed: 0.95, damage: BRUTE_DAMAGE, tint: null },
  mire_queen:        { scale: BOSS_SCALE, speed: 1.15, damage: 5, tint: null },
  ember_colossus:    { scale: BOSS_SCALE, speed: 0.72, damage: 10, tint: null },
  crystal_seer:      { scale: BOSS_SCALE, speed: 1.35, damage: 6, tint: null },
  gilded_artificer:  { scale: BOSS_SCALE, speed: 1.25, damage: 7, tint: null },
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
  /** Seconds a trap (bear jaws, net, shock) holds this mob in place. */
  trapFreeze = 0;
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
  /** Owner-local network id (0 until spawned through Mobs). */
  nid = 0;
  /** Set when another player's client owns this mob: we only draw it. */
  proxy: ProxyState | null = null;
  /** Hunted player id (-1 = nobody / the local player offline). */
  targetId = -1;
  swingSeq = 0;
  spitSeq = 0;
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
  const rounded = (w: number, h: number, d: number): THREE.BufferGeometry =>
    new RoundedBoxGeometry(w, h, d, 3, Math.min(w, h, d) * 0.2);
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

  const primary = kind === 'bone_warden' ? 0x71617e
    : kind === 'mire_queen' ? 0x39765c
    : kind === 'ember_colossus' ? 0x534d4c
    : kind === 'crystal_seer' ? 0x376f93 : 0x635038;
  const accentColor = kind === 'bone_warden' ? 0xd9cfad
    : kind === 'mire_queen' ? 0x6f8b45
    : kind === 'ember_colossus' ? 0x5d514b
    : kind === 'crystal_seer' ? 0x56a6d6 : 0xb78c32;
  const secondary = kind === 'bone_warden' ? 0xb984ff
    : kind === 'mire_queen' ? 0x7cffc6
    : kind === 'ember_colossus' ? 0xff7a2f
    : kind === 'crystal_seer' ? 0xbdefff : 0xffdf72;
  const armor = bossSurface(primary, false, kind);
  const accent = bossSurface(accentColor, true, kind);
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
  ): THREE.Mesh => add(new THREE.Mesh(rounded(w, h, d), material),
    x, y, z, animate);
  const sphere = (
    radius: number, x: number, y: number, z: number,
    material: THREE.Material = armor, animate = false,
  ): THREE.Mesh => add(new THREE.Mesh(new THREE.SphereGeometry(radius, 32, 20), material),
    x, y, z, animate);
  const cylinder = (
    top: number, bottom: number, height: number, x: number, y: number, z: number,
    material: THREE.Material = armor, animate = false, sides = 8,
  ): THREE.Mesh => add(new THREE.Mesh(
    new THREE.CylinderGeometry(top, bottom, height, Math.max(24, sides), 3), material), x, y, z, animate);
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

  /** An orbiting satellite: the animator drives its whole transform. It is
   *  seeded on its own ring so the rig reads correctly on the very first frame,
   *  before any animation has run. */
  const orbiting = <T extends THREE.Object3D>(object: T, index: number, role?: string): T => {
    object.userData.orbit = index;
    if (role) object.userData.role = role;
    const outer = index < 6;
    const a = index * (Math.PI * 2 / (outer ? 6 : 4));
    const r = outer ? 1 : 0.64;
    object.position.set(Math.cos(a) * r, 2.15, Math.sin(a) * r);
    root.add(object);
    mob.bossParts.push(object);
    return object;
  };

  if (kind === 'bone_warden') {
    // THE WARDEN — a gaunt three-metre gravekeeper in a heavy stone pall,
    // dragging a funeral censer on chains. Narrow, upright, unmistakable from
    // across the nave: two burning eye-slits under a crown of grave candles.
    for (const sx of [-1, 1]) {
      box(0.32, 0.26, 0.4, sx * 0.27, 0.13, 0.04, accent);           // boots
      box(0.22, 0.68, 0.24, sx * 0.27, 0.6, 0, armor);               // shins
    }
    const pall = cylinder(0.36, 0.66, 1.05, 0, 1.42, 0, armor, false, 8);
    pall.rotation.y = Math.PI / 8;
    for (let i = 0; i < 4; i++) {                                    // exposed ribs
      const rib = box(0.56 - i * 0.05, 0.07, 0.3, 0, 1.62 + i * 0.17, 0.02, accent, true);
      tag(rib, 'seam', i);
    }
    box(1.02, 0.2, 0.32, 0, 2.06, 0, accent);                        // clavicle yoke
    for (const sx of [-1, 1]) {
      box(0.3, 0.26, 0.36, sx * 0.5, 2.06, 0, armor);                // pauldrons
      const arm = new THREE.Group();
      const upper = new THREE.Mesh(rounded(0.17, 0.8, 0.19), armor);
      upper.position.y = -0.4;
      arm.add(upper);
      const fist = new THREE.Mesh(rounded(0.24, 0.24, 0.26), accent);
      fist.position.y = -0.9;
      arm.add(fist);
      arm.rotation.x = -0.25;
      tag(add(arm, sx * 0.54, 1.98, 0, true), 'fist', sx);
      const chain = new THREE.Group();                               // hanging chains
      for (let i = 0; i < 5; i++) {
        const link = new THREE.Mesh(rounded(0.15, 0.15, 0.11),
          i === 4 ? glow : accent);
        link.position.set(sx * i * 0.05, -i * 0.2, 0);
        link.rotation.z = i * Math.PI / 4;
        chain.add(link);
      }
      tag(add(chain, sx * 0.66, 2.02, -0.06, true), 'chain', sx);
    }
    // The censer: a glowing bell swinging at the Warden's waist.
    box(0.1, 0.5, 0.1, 0, 1.36, 0.3, accent);
    tag(cylinder(0.2, 0.36, 0.5, 0, 0.95, 0.3, glow, true), 'bell');
    const head = new THREE.Group();
    head.add(new THREE.Mesh(rounded(0.36, 0.42, 0.32), armor));
    const cowl = new THREE.Mesh(rounded(0.46, 0.2, 0.42), accent);
    cowl.position.y = 0.24;
    head.add(cowl);
    for (const sx of [-1, 1]) {
      const eye = new THREE.Mesh(rounded(0.1, 0.06, 0.05), glow);
      eye.position.set(sx * 0.09, 0.03, 0.16);
      head.add(eye);
    }
    tag(add(head, 0, 2.44, 0.02, true), 'lantern');
    mob.model.head = head;
    for (let i = 0; i < 5; i++) {                                    // candle crown
      const candle = cylinder(0.045, 0.06, 0.34, (i - 2) * 0.13, 2.86,
        -0.02, i === 2 ? glow : accent, true, 5);
      candle.rotation.z = (i - 2) * 0.14;
      tag(candle, 'crown', i);
    }
  } else if (kind === 'mire_queen') {
    // THE QUEEN — a broad, low, armoured serpent that fills the drowned ring
    // rather than towering over it. Read her by the lotus crown and the wake
    // of her tail: everything she does starts from the head.
    for (let i = 0; i < 3; i++) {                                    // body plates
      const seg = sphere(0.55 - i * 0.05, 0, 0.52 - i * 0.03, 0.15 - i * 0.62,
        armor, i > 0);
      seg.scale.set(1.5, 0.72, 1.35);
      if (i > 0) tag(seg, 'tail', i);
    }
    for (let i = 0; i < 3; i++) {                                    // trailing tail
      const tail = sphere(0.32 - i * 0.07, 0, 0.4 - i * 0.05, -1.62 - i * 0.5,
        i === 2 ? glow : accent, true);
      tail.scale.set(1.2, 0.7, 1.2);
      tag(tail, 'tail', i + 3);
    }
    for (const sx of [-1, 1]) {                                      // swimming fins
      for (let i = 0; i < 3; i++) {
        const fin = box(0.95, 0.11, 0.36, sx * 1.12, 0.5 - i * 0.02,
          0.5 - i * 0.6, i === 1 ? glow : accent, true);
        fin.rotation.z = sx * -0.3;
        tag(fin, 'fin', i + (sx > 0 ? 3 : 0));
      }
    }
    for (let i = 0; i < 5; i++) {                                    // dorsal fronds
      const frond = cylinder(0, 0.11, 0.42, 0, 0.92, 0.3 - i * 0.42, accent, true, 4);
      tag(frond, 'frond', i);
    }
    const head = new THREE.Group();
    head.add(new THREE.Mesh(rounded(0.88, 0.42, 0.82), armor));
    const jaw = new THREE.Mesh(rounded(0.8, 0.18, 0.76), accent);
    jaw.position.set(0, -0.28, -0.04);
    head.add(jaw);
    for (const sx of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.09, 24, 16), glow);
      eye.position.set(sx * 0.28, 0.12, 0.36);
      head.add(eye);
    }
    tag(add(head, 0, 0.82, 1.02, true), 'maw');
    mob.model.head = head;
    const throat = sphere(0.28, 0, 0.5, 0.78, glow, true);
    throat.scale.set(1.3, 0.7, 1);
    tag(throat, 'throat');
    for (let i = 0; i < 5; i++) {                                    // lotus crown
      const petal = cylinder(0, 0.17, 0.78, (i - 2) * 0.2, 1.38, 0.66,
        i === 2 ? glow : armor, true, 5);
      petal.rotation.z = (i - 2) * 0.26;
      petal.rotation.x = -0.2;
      tag(petal, 'crown', i);
    }
  } else if (kind === 'ember_colossus') {
    // THE COLOSSUS — a basalt quadruped with a live caldera on its back. Low
    // head, high shoulders, a vent of flame you can see over the whole arena.
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as [number, number][]) {
      const leg = box(0.44, 0.82, 0.48, sx * 0.76, 0.41, sz * 0.62, armor, true);
      tag(leg, 'caldera_leg', sx + sz * 2);
      box(0.5, 0.2, 0.54, sx * 0.76, 0.08, sz * 0.62, accent);        // hooves
    }
    const body = sphere(0.86, 0, 1.24, 0.05, armor);
    body.scale.set(1.45, 0.82, 1.55);
    for (let i = 0; i < 4; i++) {                                    // molten seams
      const seam = box(1.5, 0.08, 0.16, 0, 1.28, 0.75 - i * 0.5, glow, true);
      tag(seam, 'seam', i);
    }
    for (const sx of [-1, 1]) {
      const plate = box(0.42, 0.24, 1.3, sx * 0.98, 1.5, 0.05, accent);
      plate.rotation.z = sx * -0.22;
      const spike = box(0.24, 0.5, 0.26, sx * 1.16, 1.72, -0.2, accent);
      spike.rotation.z = sx * -0.5;
    }
    const crater = new THREE.Mesh(new THREE.TorusGeometry(0.56, 0.16, 16, 64), accent);
    crater.rotation.x = Math.PI / 2;
    tag(add(crater, 0, 1.94, 0.05, true), 'crater');
    tag(cylinder(0, 0.26, 0.66, 0, 2.28, 0.05, glow, true, 6), 'flame');
    for (let i = 0; i < 2; i++) {                                    // vent stacks
      const stack = cylinder(0.13, 0.17, 0.4, (i ? 1 : -1) * 0.42, 1.9, -0.62,
        accent, true, 6);
      tag(stack, 'chimney', i);
    }
    const head = new THREE.Group();
    head.add(new THREE.Mesh(rounded(0.86, 0.54, 0.72), armor));
    const jaw = new THREE.Mesh(rounded(0.8, 0.2, 0.64), accent);
    jaw.position.set(0, -0.32, -0.06);
    head.add(jaw);
    const brow = new THREE.Mesh(rounded(0.9, 0.14, 0.2), accent);
    brow.position.set(0, 0.28, 0.24);
    head.add(brow);
    const eye = new THREE.Mesh(rounded(0.5, 0.1, 0.06), glow);
    eye.position.set(0, 0.06, 0.37);
    head.add(eye);
    tag(add(head, 0, 1.02, 1.36, true), 'caldera_head');
    mob.model.head = head;
    for (let i = 0; i < 3; i++) {                                    // molten tail
      const tail = box(0.44 - i * 0.09, 0.34 - i * 0.05, 0.62,
        0, 0.94 - i * 0.14, -1.15 - i * 0.5, i === 2 ? glow : accent, true);
      tag(tail, 'tail', i);
    }
  } else if (kind === 'crystal_seer') {
    // THE SEER — no body at all: a hovering prism eye inside a halo, wearing
    // two long refracting wings and a mane of orbiting shards. Nothing about it
    // touches the floor, which is exactly why the arena is a dome.
    const core = octa(0.58, 0, 1.5, 0, armor, true);
    core.scale.set(0.82, 1.32, 0.82);
    tag(core, 'core');
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.22, 32, 20), glow);
    eye.scale.set(1.45, 0.72, 0.5);
    tag(add(eye, 0, 1.56, 0.44, true), 'eye');
    mob.model.head = eye;
    const halo = new THREE.Mesh(new THREE.TorusGeometry(0.92, 0.06, 12, 80), accent);
    halo.rotation.x = Math.PI / 2.4;
    tag(add(halo, 0, 1.5, 0, true), 'halo');
    for (const sx of [-1, 1]) {                                      // refracting wings
      const wing = new THREE.Group();
      for (let i = 0; i < 3; i++) {
        const panel = new THREE.Mesh(new THREE.OctahedronGeometry(0.48 - i * 0.08, 0),
          i === 1 ? glow : accent);
        panel.scale.set(1.3, 0.55, 0.18);
        panel.position.set(sx * (0.35 + i * 0.34), (1 - i) * 0.3, -0.06 - i * 0.05);
        wing.add(panel);
      }
      tag(add(wing, sx * 0.34, 1.58, 0.04, true), 'wing', sx);
    }
    for (let i = 0; i < 10; i++) {                                   // orbiting shards
      const shard = new THREE.Mesh(new THREE.OctahedronGeometry(i < 6 ? 0.17 : 0.12, 0),
        i < 6 ? accent : glow);
      shard.scale.set(0.7, 1.5, 0.7);
      orbiting(shard, i, 'shard');
    }
    for (let i = 0; i < 4; i++) {                                    // hanging prisms
      const tail = octa(0.26 - i * 0.04, 0, 1.06 - i * 0.28, -0.06 - i * 0.05,
        i % 2 ? glow : accent, true);
      tail.scale.set(0.7, 1.3, 0.55);
      tag(tail, 'prism_tail', i);
    }
  } else {
    // THE ARTIFICER — a foreman rig: three planted legs, a geared waist, a
    // clock-face head and three working tool arms. It reads as MACHINERY, so
    // the rhythm of its attacks looks like something you could learn.
    for (let i = 0; i < 3; i++) {
      const a = -Math.PI / 2 + i * Math.PI * 2 / 3;
      const leg = box(0.24, 1.3, 0.26, Math.cos(a) * 0.66, 0.65,
        Math.sin(a) * 0.66, accent, true);
      leg.rotation.z = Math.cos(a) * -0.22;
      leg.rotation.x = Math.sin(a) * 0.22;
      tag(leg, 'tripod', i);
      box(0.34, 0.14, 0.36, Math.cos(a) * 0.78, 0.07, Math.sin(a) * 0.78, armor);
    }
    cylinder(0.6, 0.78, 0.52, 0, 1.32, 0, armor);
    tag(octa(0.3, 0, 1.34, 0.02, glow, true), 'core');
    for (const sx of [-1, 1]) {                                      // drive gears
      const gear = new THREE.Mesh(new THREE.TorusGeometry(0.26, 0.08, 12, 40), accent);
      gear.userData.spin = sx;
      tag(add(gear, sx * 0.56, 1.5, 0.16, true), 'gear', sx);
      const piston = box(0.14, 0.42, 0.14, sx * 0.34, 1.62, -0.34, accent, true);
      tag(piston, 'piston', sx);
    }
    box(0.28, 0.86, 0.28, 0, 1.94, 0, armor);
    const head = new THREE.Group();
    const clock = new THREE.Mesh(new THREE.SphereGeometry(0.52, 32, 24), armor);
    clock.scale.set(1, 1, 0.3);
    head.add(clock);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.48, 0.07, 12, 64), accent);
    rim.position.z = 0.14;
    head.add(rim);
    for (let i = 0; i < 8; i++) {
      const mark = new THREE.Mesh(rounded(0.06, 0.13, 0.04), glow);
      const a = i * Math.PI / 4;
      mark.position.set(Math.sin(a) * 0.35, Math.cos(a) * 0.35, 0.2);
      mark.rotation.z = -a;
      head.add(mark);
    }
    const hand = new THREE.Mesh(rounded(0.07, 0.44, 0.05), glow);
    hand.position.set(0, 0.15, 0.22);
    head.add(hand);
    tag(add(head, 0, 2.5, -0.02, true), 'clock');
    mob.model.head = head;
    for (let i = 0; i < 3; i++) {                                    // tool arms
      const a = i * Math.PI * 2 / 3;
      const arm = new THREE.Group();
      const beam = new THREE.Mesh(rounded(0.15, 0.15, 1.05), accent);
      beam.position.z = -0.5;
      arm.add(beam);
      const tool = new THREE.Mesh(i === 0
        ? new THREE.ConeGeometry(0.2, 0.46, 6)
        : i === 1 ? rounded(0.46, 0.17, 0.32)
          : new THREE.OctahedronGeometry(0.23, 0), i === 2 ? glow : armor);
      tool.position.set(0, 0, -0.98);
      tool.rotation.x = i === 0 ? Math.PI / 2 : 0;
      arm.add(tool);
      arm.rotation.y = a;
      tag(add(arm, 0, 2, 0, true), 'tool', i);
    }
    for (let i = 0; i < 2; i++) {                                    // exhaust stacks
      const stack = cylinder(0.1, 0.13, 0.44, (i ? 1 : -1) * 0.3, 2.72, -0.3,
        accent, true, 6);
      tag(stack, 'chimney', i);
    }
  }
  detailBoss(root, kind, armor, accent, glow);
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
  /** We damaged a mob another player owns: forward it to them (main → net). */
  onProxyHit?: (mob: Mob, damage: number, kx: number, kz: number) => void;
  /** Our network id, so a proxy knows when its swing is aimed at us. */
  myId = -1;
  /** Other players in this world. Our mobs hunt whoever is nearest, so a
   *  zombie chasing a friend is the same zombie on both screens. */
  remoteTargets: MobTarget[] = [];
  private nextNid = 1;
  /** Our mobs that died since the last sync (receivers poof these). */
  private killedNids: number[] = [];
  private clock = 0;

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
    mob.nid = this.nextNid++;
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

  private hostileCount(near: THREE.Vector3): number {
    // Somebody else's mobs around us count toward our cap, or two players
    // standing together would each fill the night with a full population.
    return this.list.filter((m) => m.def.hostile &&
      (!m.proxy || m.pos.distanceToSquared(near) < 48 * 48)).length;
  }

  private trySpawns(player: Player, sun: number): void {
    const cap = inCore(player.pos.x, player.pos.z) ? HOSTILE_CAP : HOSTILE_CAP_WILDS;
    if (this.hostileCount(player.pos) >= cap) return;
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
    const away = new THREE.Vector3(
      mob.pos.x - player.pos.x, 0, mob.pos.z - player.pos.z
    ).normalize();
    if (this.forwardHit(mob, damage, away.x * 7, away.z * 7)) return true;
    mob.health -= damage;
    mob.hurtTime = 0.5;
    // The Brute is heavy — barely any knockback (it's a boss, not a piñata).
    const heavy = mob.type === 'brute' ? 0.15 : 1;
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
    if (this.forwardHit(mob, damage, dir.x * 5, dir.z * 5)) return true;
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

  /** Damage to a mob another player owns is theirs to apply: show the hit
   *  here (flash + yelp) and send it on. True when the mob was a proxy. */
  private forwardHit(mob: Mob, damage: number, kx: number, kz: number): boolean {
    if (!mob.proxy) return false;
    mob.hurtTime = 0.3;
    this.onSound?.('mobHurt', mob.pos);
    this.onProxyHit?.(mob, damage, kx, kz);
    return true;
  }

  /** The owner side of `forwardHit`: another player hit one of our mobs. */
  applyRemoteHit(nid: number, damage: number, kx: number, kz: number): void {
    const mob = this.list.find((m) => !m.proxy && m.nid === nid);
    if (!mob || !(damage > 0)) return;
    mob.health -= Math.min(40, damage);
    mob.hurtTime = 0.5;
    const k = Math.hypot(kx, kz), scale = k > 8 ? 8 / k : 1;
    mob.vel.x += kx * scale; mob.vel.z += kz * scale; mob.vel.y += 3.5;
    this.onSound?.('mobHurt', mob.pos);
    if (mob.health <= 0) this.kill(mob);
  }

  /** Our mobs near `near`, for other players (main sends this ~10×/s). */
  wire(near: THREE.Vector3): { mobs: MobWire[]; gone: number[] } {
    const mobs: MobWire[] = [];
    for (const m of this.list) {
      if (m.proxy || m.bossKind || m.removed) continue;
      const k = (SYNCED_MOB_TYPES as readonly MobType[]).indexOf(m.type);
      if (k < 0 || m.pos.distanceToSquared(near) > 64 * 64) continue;
      const r = (v: number) => Math.round(v * 100) / 100;
      mobs.push({
        i: m.nid, k, x: r(m.pos.x), y: r(m.pos.y), z: r(m.pos.z), yaw: r(m.yaw),
        hu: m.hurtTime > 0 ? 1 : 0, sw: m.swingSeq & 0xffff, sp: m.spitSeq & 0xffff,
        tg: m.targetId, fu: m.type === 'creeper' ? r(m.fuse / CREEPER_FUSE) : 0,
      });
      if (mobs.length >= 40) break;
    }
    const gone = this.killedNids;
    this.killedNids = [];
    return { mobs, gone };
  }

  /** A mob list from `owner`: create, steer or retire our proxies of theirs. */
  applyRemote(owner: number, list: MobWire[], gone: number[]): void {
    const seen = new Set<number>();
    for (const w of list) {
      const type = SYNCED_MOB_TYPES[w.k];
      if (!type) continue;
      seen.add(w.i);
      let mob = this.list.find((m) => m.proxy?.owner === owner && m.proxy.nid === w.i);
      if (!mob) {
        mob = new Mob(type, w.x, w.y, w.z, this.atlas);
        mob.yaw = w.yaw;
        mob.proxy = { owner, nid: w.i, tx: w.x, ty: w.y, tz: w.z, tyaw: w.yaw,
          seen: this.clock, sw: w.sw, sp: w.sp, tg: w.tg };
        this.scene.add(mob.model.group);
        this.list.push(mob);
      }
      const p = mob.proxy!;
      p.tx = w.x; p.ty = w.y; p.tz = w.z; p.tyaw = w.yaw; p.seen = this.clock;
      p.tg = w.tg;
      if (w.hu) mob.hurtTime = Math.max(mob.hurtTime, 0.15);
      mob.fuse = Math.max(0, Math.min(1, w.fu || 0)) * CREEPER_FUSE;
      if (w.sw !== p.sw) { p.sw = w.sw; this.proxySwing(mob); }
      if (w.sp !== p.sp) { p.sp = w.sp; this.proxySpit(mob); }
    }
    const died = new Set(gone);
    for (const m of [...this.list]) {
      if (m.proxy?.owner !== owner || seen.has(m.proxy.nid)) continue;
      if (died.has(m.proxy.nid)) {
        this.particles.poof(m.pos.x, m.pos.y + m.height / 2, m.pos.z);
        this.onSound?.('poof', m.pos);
      }
      this.remove(m);
    }
  }

  /** That player left or went out of range: their mobs go with them. */
  dropOwner(owner: number): void {
    for (const m of [...this.list]) if (m.proxy?.owner === owner) this.remove(m);
  }

  /** The player a proxy is hunting: us, a remote, or nobody. */
  private proxyTarget(mob: Mob, player: Player): THREE.Vector3 | null {
    const tg = mob.proxy?.tg ?? -1;
    if (tg < 0) return null;
    if (tg === this.myId) return player.dead ? null : player.pos;
    return this.remoteTargets.find((t) => t.id === tg && !t.dead)?.pos ?? null;
  }

  private player: Player | null = null;

  /** The owner swung. If it swung at US, whether it connects is ours to say
   *  (we apply our own damage, exactly as with our own mobs). */
  private proxySwing(mob: Mob): void {
    const player = this.player;
    if (!player || player.dead || mob.proxy?.tg !== this.myId) return;
    const to = new THREE.Vector3().subVectors(player.pos, mob.pos);
    // A touch more reach than the owner's check: our copy is a packet behind.
    if (Math.hypot(to.x, to.z) > mob.halfW + 1.9 || Math.abs(to.y) > 2.5) return;
    player.damage(mob.type === 'skitter' ? SKITTER_DAMAGE : ZOMBIE_DAMAGE);
    const kick = to.setY(0).normalize().multiplyScalar(7);
    player.vel.add(kick);
    player.vel.y += 3;
  }

  /** The owner's spitter spat: launch our own copy of the gob at its target.
   *  Gobs only ever hurt the local player, so every client stays the sole
   *  judge of its own damage. */
  private proxySpit(mob: Mob): void {
    const player = this.player;
    if (!player) return;
    const at = this.proxyTarget(mob, player);
    if (at) this.spitAt(mob, at);
  }

  private kill(mob: Mob): void {
    if (mob.room) {
      const wave = this.roomWaves.get(mob.room);
      if (wave) wave.defeated++;
    }
    if (mob.type === 'brute') this.onBruteDown?.(mob);
    if (!mob.proxy && mob.nid) this.killedNids.push(mob.nid);
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
        if (this.forwardHit(mob, dmg, k.x, k.z)) return;
        mob.health -= dmg;
        mob.hurtTime = 0.5;
        mob.vel.add(k);
        if (mob.health <= 0) this.kill(mob);
      });
    }
  }

  /** A trap caught this mob (offline trap sim): damage + optional hold. */
  trapHit(mob: Mob, dmg: number, freeze = 0): void {
    if (!this.list.includes(mob) || mob.proxy) return;
    mob.health -= dmg;
    mob.hurtTime = 0.4;
    if (freeze > 0) mob.trapFreeze = Math.max(mob.trapFreeze, freeze);
    if (mob.health <= 0) this.kill(mob);
  }

  update(dt: number, player: Player, sun: number): void {
    this.player = player;
    this.clock += dt;
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
      if (mob.proxy) this.updateProxy(dt, mob, player, sun, relight);
      else this.updateMob(dt, mob, player, sun, relight);
    }
    this.updateSpits(dt, player);
  }

  /** Launch a lobbed spit gob from a spitter toward the player. */
  private spitAt(mob: Mob, at: THREE.Vector3): void {
    const from = mob.pos.clone(); from.y += mob.height * 0.75;
    const target = at.clone(); target.y += 1.0;
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

  /** Draw a mob another player simulates: glide toward where its owner last
   *  put it, animate from that motion, and let it go if the owner falls silent. */
  private updateProxy(
    dt: number, mob: Mob, player: Player, sun: number, relight: boolean
  ): void {
    const p = mob.proxy!;
    if (this.clock - p.seen > 1.5 || mob.pos.distanceTo(player.pos) > 128) {
      this.remove(mob);
      return;
    }
    mob.hurtTime = Math.max(0, mob.hurtTime - dt);
    const far = Math.hypot(p.tx - mob.pos.x, p.ty - mob.pos.y, p.tz - mob.pos.z) > 6;
    const k = far ? 1 : Math.min(1, dt * 12);
    const px = mob.pos.x, pz = mob.pos.z;
    mob.pos.x += (p.tx - mob.pos.x) * k;
    mob.pos.y += (p.ty - mob.pos.y) * k;
    mob.pos.z += (p.tz - mob.pos.z) * k;
    mob.yaw += wrapAngle(p.tyaw - mob.yaw) * k;
    // Velocity from the drawn motion drives the legs, like an owned mob.
    mob.vel.set((mob.pos.x - px) / Math.max(dt, 1e-4), 0, (mob.pos.z - pz) / Math.max(dt, 1e-4));
    mob.state = p.tg >= 0 ? 'chase' : 'walk';
    const prey = this.proxyTarget(mob, player) ?? player.pos;
    this.present(dt, mob, prey, mob.pos.distanceTo(prey), sun, relight);
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

    // Hunt whichever living player is nearest — us or someone else in this
    // world. Culling and despawning stay tied to OUR distance: we own it.
    const ownDist = mob.pos.distanceTo(player.pos);
    let prey: THREE.Vector3 = player.pos, preyId = this.myId, preyDead = player.dead;
    let dist = player.dead ? Infinity : ownDist;
    if (def.hostile && !mob.bossKind) {
      for (const t of this.remoteTargets) {
        if (t.dead) continue;
        const d = mob.pos.distanceTo(t.pos);
        if (d < dist) { dist = d; prey = t.pos; preyId = t.id; preyDead = false; }
      }
    }
    if (!Number.isFinite(dist)) dist = ownDist;
    const preyIsMe = prey === player.pos;
    const toPlayer = new THREE.Vector3().subVectors(prey, mob.pos);
    const distXZ = Math.hypot(toPlayer.x, toPlayer.z);

    // Cull any mob that fell out of the world (its chunk unloaded beneath it)
    // or strayed beyond loaded terrain, so passives can't pile up or plummet
    // forever and the population stays fresh as the player roams.
    if (mob.pos.y < -8 || ownDist > 128) {
      this.remove(mob);
      return;
    }
    // Despawn far hostiles (sooner than the hard cull above).
    if (def.hostile) {
      mob.despawnTime = ownDist > DESPAWN_DIST && dist > DESPAWN_DIST ? mob.despawnTime + dt : 0;
      if (mob.despawnTime > 3) {
        this.remove(mob);
        return;
      }
    }

    // A creeper's fuse only advances while it is actively priming next to a
    // living player (handled in the chase branch). Everywhere else — player
    // escaped past chase range, player died, or it backed off — it winds back
    // down, so it can never get stuck swollen and flashing.
    const priming = mob.type === 'creeper' && !preyDead && dist < 3;
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
    } else if (def.hostile && !preyDead && dist < 16) {
      mob.state = 'chase';
      mob.targetId = preyId;
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
          mob.swingSeq++; // someone else's prey applies the hit on their side
          if (preyIsMe) {
            player.damage(dmg);
            const kick = toPlayer.clone().setY(0).normalize()
              .multiplyScalar(mob.type === 'brute' ? 11 : 7);
            player.vel.add(kick);
            player.vel.y += mob.type === 'brute' ? 4.5 : 3;
          }
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
          mob.spitSeq++;
          this.spitAt(mob, prey);
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
            this.killedNids.push(mob.nid); // everyone sees it go up
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
      mob.targetId = -1;
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

    // Held by a trap: no walking until it lets go.
    if (mob.trapFreeze > 0) {
      mob.trapFreeze = Math.max(0, mob.trapFreeze - dt);
      mob.vel.x = 0; mob.vel.z = 0;
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
    if (mob.bossKind) {
      // A lair boss is positioned by the authoritative encounter runtime, which
      // already keeps it on the arena floor and inside the walls. Running voxel
      // physics on a five-block body underneath that only ever fought it.
      mob.vel.set(0, 0, 0);
      mob.onGround = true;
    } else {
      this.moveAxis(mob, 1, mob.vel.y * dt);
      const hitX = this.moveAxis(mob, 0, mob.vel.x * dt);
      const hitZ = this.moveAxis(mob, 2, mob.vel.z * dt);
      if ((hitX || hitZ) && wasOnGround && moving) mob.vel.y = JUMP_V; // hop up
    }

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

    this.present(dt, mob, prey, dist, sun, relight);
  }

  /** Walk cycle, gaze, creeper swell and lighting — shared by owned mobs and
   *  proxies so both look identical. */
  private present(
    dt: number, mob: Mob, prey: THREE.Vector3, dist: number, sun: number, relight: boolean
  ): void {
    mob.model.group.position.copy(mob.pos);
    mob.model.group.rotation.y = mob.yaw;
    const horiz = Math.hypot(mob.vel.x, mob.vel.z);
    mob.walkPhase += horiz * dt * 3.2;
    const swing = Math.sin(mob.walkPhase) * Math.min(1, horiz / mob.def.speed) * 0.7;
    mob.model.legs.forEach((leg, i) => {
      leg.rotation.x = i % 2 === 0 ? swing : -swing;
    });

    // Gaze at the player when close (or while chasing).
    if (mob.model.head) {
      const want = (mob.state === 'chase' || dist < 5)
        ? wrapAngle(Math.atan2(prey.x - mob.pos.x, prey.z - mob.pos.z) - mob.yaw)
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
      else mat.color.copy(base).multiplyScalar(0.72 + b * 0.28);
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
    // Vertical moves may only be stopped by the cell plane they are moving
    // INTO. Scanning the whole column instead let a block anywhere along the
    // body resolve a *downward* step, which snapped the feet to the top of it —
    // harmless for a 1.7-block zombie in the open, but it is what parked a
    // 5-block vault boss inside its own lair ceiling.
    const yLo = axis === 1 ? (amount > 0 ? y1 : y0) : y0;
    const yHi = axis === 1 ? (amount > 0 ? y1 : y0) : y1;
    for (let x = x0; x <= x1; x++) {
      for (let y = yLo; y <= yHi; y++) {
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
