// Mobs: boxy vanilla-proportioned models built from atlas skin tiles, walk
// animations, wander/gaze/flee/chase AI, light-based spawn rules, melee
// zombies that burn in sunlight, creepers with a fuse and a real explosion,
// knockback combat, drops and death poofs.

import * as THREE from 'three';
import { Block, BLOCKS, isSolid, Tile } from './blocks';
import type { ItemEntities } from './itementity';
import { ItemStack } from './items';
import type { Particles } from './particles';
import type { Player } from './player';
import type { Atlas } from './textures';
import type { World } from './world';

// VOXELON: hostile mobs only — passive animals were removed.
export type MobType = 'zombie' | 'creeper';

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
};

const ZOMBIE_DAMAGE = 3;
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
  soundTimer = 3 + Math.random() * 9;
  walkPhase = 0;
  brightness = 1;
  removed = false;
  readonly model: MobModel;
  readonly material: THREE.MeshBasicMaterial;

  constructor(type: MobType, x: number, y: number, z: number, atlas: Atlas) {
    this.type = type;
    this.def = MOB_DEFS[type];
    this.health = this.def.health;
    this.pos = new THREE.Vector3(x, y, z);
    this.material = new THREE.MeshBasicMaterial({
      map: atlas.texture, vertexColors: true,
    });
    this.model = buildModel(type, atlas, this.material);
  }
}

// --- mob manager ---------------------------------------------------------------

const HOSTILE_CAP = 10;
const DESPAWN_DIST = 44;

export class Mobs {
  readonly list: Mob[] = [];
  /** Natural spawning toggle (off = peaceful-style; also used by tests). */
  spawningEnabled = true;
  /** Sound cues: 'zombie' groan, 'hiss', 'mobHurt', 'explosion', 'poof'. */
  onSound?: (name: string, pos: THREE.Vector3) => void;

  private readonly scene: THREE.Scene;
  private readonly world: World;
  private readonly atlas: Atlas;
  private readonly items: ItemEntities;
  private readonly particles: Particles;
  private spawnTimer = 0;
  private lightTimer = 0;

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

  /** Living hostile mob count (public so the arena can top up its bots). */
  hostileCount(): number {
    return this.list.filter((m) => m.def.hostile).length;
  }

  /** Remove every mob (used when leaving the offline arena). */
  clearAll(): void {
    for (const m of [...this.list]) this.remove(m);
  }

  private trySpawns(player: Player, sun: number): void {
    if (this.hostileCount() >= HOSTILE_CAP) return;
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
      // Creepers removed from the spawn pool — only zombies spawn now. (The
      // explosion helper they shared still powers rocket blasts.)
      this.spawnAt('zombie', x + 0.5, y, z + 0.5);
    }
  }

  /** Ray vs mob AABBs; used for attacks and to suppress mining. */
  rayHit(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number): Mob | null {
    let best: Mob | null = null;
    let bestT = maxDist;
    for (const mob of this.list) {
      const { halfW, height } = mob.def;
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
    const away = new THREE.Vector3(
      mob.pos.x - player.pos.x, 0, mob.pos.z - player.pos.z
    ).normalize();
    mob.vel.x += away.x * 7;
    mob.vel.z += away.z * 7;
    mob.vel.y += 4.5;
    if (!mob.def.hostile) {
      mob.state = 'flee';
      mob.stateTime = 4;
    }
    this.onSound?.('mobHurt', mob.pos);
    if (mob.health <= 0) this.kill(mob);
    return true;
  }

  /** First mob whose AABB contains the point (projectile point-collision). */
  private mobAtPoint(p: THREE.Vector3): Mob | null {
    for (const mob of this.list) {
      const { halfW, height } = mob.def;
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
    mob.vel.x += dir.x * 5;
    mob.vel.z += dir.z * 5;
    mob.vel.y += 3;
    if (!mob.def.hostile) { mob.state = 'flee'; mob.stateTime = 4; }
    this.onSound?.('mobHurt', mob.pos);
    if (mob.health <= 0) this.kill(mob);
    return true;
  }

  private kill(mob: Mob): void {
    for (const drop of mob.def.drops(Math.random)) {
      this.items.spawn(
        mob.pos.x, mob.pos.y + 0.4, mob.pos.z, drop.id, drop.count
      );
    }
    this.particles.poof(mob.pos.x, mob.pos.y + mob.def.height / 2, mob.pos.z);
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

    if (mob.state === 'flee') {
      mob.stateTime -= dt;
      mob.yaw = Math.atan2(-toPlayer.x, -toPlayer.z);
      moving = true;
      speedMul = 1.5;
      if (mob.stateTime <= 0) mob.state = 'idle';
    } else if (def.hostile && !player.dead && dist < 16) {
      mob.state = 'chase';
      mob.yaw = Math.atan2(toPlayer.x, toPlayer.z);
      speedMul = 1;
      if (mob.type === 'zombie') {
        moving = true;
        if (distXZ < def.halfW + 1.0 && Math.abs(toPlayer.y) < 2.5 &&
          mob.attackCooldown <= 0) {
          mob.attackCooldown = 1.2;
          player.damage(ZOMBIE_DAMAGE);
          const kick = toPlayer.clone().setY(0).normalize().multiplyScalar(7);
          player.vel.add(kick);
          player.vel.y += 3;
        }
        mob.soundTimer -= dt;
        if (mob.soundTimer <= 0) {
          mob.soundTimer = 3 + Math.random() * 4;
          this.onSound?.('zombie', mob.pos);
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

    // --- physics ------------------------------------------------------------
    const speed = moving ? def.speed * speedMul : 0;
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
    else if (mob.type === 'creeper' && mob.fuse > 0) {
      const w = 0.5 + 0.5 * Math.sin(mob.fuse * 25);
      mob.material.color.setRGB(b + (1 - b) * w, b + (1 - b) * w, b + (1 - b) * w);
    } else mob.material.color.setScalar(b);
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
    const { halfW, height } = mob.def;
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
