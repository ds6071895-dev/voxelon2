// Server-simulated entities for the vanilla modes: dropped items,
// projectiles, primed TNT, falling blocks, mobs, end crystals and lingering
// clouds. One tick = one Minecraft tick (the engines step at a fixed 20 Hz),
// so the per-tick gravity and drag constants are the wiki's own.

import { BLOCKS, collisionBoxes } from '../blocks';
import { VMETA } from './blocks';
import type { EntityView, MoveProfile } from './messages';
import type { VStack } from './stack';

export type EntityKind =
  | 'item' | 'arrow' | 'spectral_arrow' | 'trident' | 'snowball' | 'egg' | 'ender_pearl' | 'wind_charge'
  | 'potion' | 'fireball' | 'firework' | 'bobber' | 'tnt' | 'falling_block' | 'end_crystal' | 'cloud'
  | 'zombie' | 'husk' | 'skeleton' | 'creeper' | 'silverfish' | 'wolf' | 'sheep' | 'chicken'
  | 'boat' | 'minecart' | 'display';

interface KindInfo { w: number; h: number; gravity: number; drag: number; mob?: boolean; hp?: number; speed?: number; projectile?: boolean }
/** Dimensions (blocks), gravity and drag (per tick), health and walk speed (blocks/tick). */
export const KINDS: Record<EntityKind, KindInfo> = {
  item: { w: .25, h: .25, gravity: .04, drag: .98 },
  arrow: { w: .5, h: .5, gravity: .05, drag: .99, projectile: true },
  spectral_arrow: { w: .5, h: .5, gravity: .05, drag: .99, projectile: true },
  trident: { w: .5, h: .5, gravity: .05, drag: .99, projectile: true },
  snowball: { w: .25, h: .25, gravity: .03, drag: .99, projectile: true },
  egg: { w: .25, h: .25, gravity: .03, drag: .99, projectile: true },
  ender_pearl: { w: .25, h: .25, gravity: .03, drag: .99, projectile: true },
  wind_charge: { w: .3125, h: .3125, gravity: 0, drag: 1, projectile: true },
  potion: { w: .25, h: .25, gravity: .05, drag: .99, projectile: true },
  fireball: { w: 1, h: 1, gravity: 0, drag: 1, projectile: true },
  firework: { w: .25, h: .25, gravity: 0, drag: 1, projectile: true },
  bobber: { w: .25, h: .25, gravity: .03, drag: .92, projectile: true },
  tnt: { w: .98, h: .98, gravity: .04, drag: .98 },
  falling_block: { w: .98, h: .98, gravity: .04, drag: .98 },
  end_crystal: { w: 2, h: 2, gravity: 0, drag: 1, hp: 1 },
  cloud: { w: 6, h: .5, gravity: 0, drag: 1 },
  zombie: { w: .6, h: 1.95, gravity: .08, drag: .98, mob: true, hp: 20, speed: .23 },
  husk: { w: .6, h: 1.95, gravity: .08, drag: .98, mob: true, hp: 20, speed: .23 },
  skeleton: { w: .6, h: 1.99, gravity: .08, drag: .98, mob: true, hp: 20, speed: .25 },
  creeper: { w: .6, h: 1.7, gravity: .08, drag: .98, mob: true, hp: 20, speed: .25 },
  silverfish: { w: .4, h: .3, gravity: .08, drag: .98, mob: true, hp: 8, speed: .25 },
  wolf: { w: .6, h: .85, gravity: .08, drag: .98, mob: true, hp: 8, speed: .3 },
  sheep: { w: .9, h: 1.3, gravity: .08, drag: .98, mob: true, hp: 8, speed: .23 },
  chicken: { w: .4, h: .7, gravity: .08, drag: .98, mob: true, hp: 4, speed: .25 },
  boat: { w: 1.375, h: .5625, gravity: .04, drag: .9 },
  minecart: { w: .98, h: .7, gravity: .04, drag: .95 },
  display: { w: 1, h: 1, gravity: 0, drag: 1 },
};
export const UNDEAD: ReadonlySet<EntityKind> = new Set(['zombie', 'husk', 'skeleton']);
export const ARTHROPOD: ReadonlySet<EntityKind> = new Set(['silverfish']);

export interface Entity {
  id: number; kind: EntityKind;
  x: number; y: number; z: number; vx: number; vy: number; vz: number;
  yaw: number; pitch: number;
  w: number; h: number;
  onGround: boolean; inWater: boolean;
  age: number;
  hp: number; maxHp: number;
  /** ENT_FLAG bits shown to clients. */
  flags: number;
  owner?: number;
  item?: VStack;
  block?: number;
  /** Ticks left (TNT fuse, item pickup delay, cloud life...). */
  timer: number;
  /** Projectile stuck in a block / stopped. */
  stuck?: boolean;
  /** Free per-kind data (AI state, potion, enchants...). */
  data: Record<string, unknown>;
  dead: boolean;
  hurtTime: number;
  fire: number;
  baby?: boolean;
  scale: number;
  /** Fall distance for mobs (fall damage) and falling anvils. */
  fall: number;
}

type BlockAt = (x: number, y: number, z: number) => number;

/** Sweep an AABB through blocks one axis at a time (y first). Mobs step up 0.6. */
export function moveBox(get: BlockAt, e: { x: number; y: number; z: number; w: number; h: number }, dx: number, dy: number, dz: number, step = 0):
  { dx: number; dy: number; dz: number; hitX: boolean; hitY: boolean; hitZ: boolean; ground: boolean } {
  const hw = e.w / 2;
  const collide = (x: number, y: number, z: number): boolean => {
    for (let bx = Math.floor(x - hw); bx <= Math.floor(x + hw - 1e-6); bx++)
      for (let by = Math.floor(y); by <= Math.floor(y + e.h - 1e-6); by++)
        for (let bz = Math.floor(z - hw); bz <= Math.floor(z + hw - 1e-6); bz++) {
          const boxes = collisionBoxes(get(bx, by, bz));
          if (!boxes) continue;
          for (const [mn, mx] of boxes) {
            if (x + hw > bx + mn[0] && x - hw < bx + mx[0] && y + e.h > by + mn[1] && y < by + mx[1] && z + hw > bz + mn[2] && z - hw < bz + mx[2]) return true;
          }
        }
    return false;
  };
  const sweep = (ax: number, ay: number, az: number, d: number): number => {
    if (d === 0) return 0;
    const n = Math.max(1, Math.ceil(Math.abs(d) / .2));
    let done = 0;
    for (let i = 1; i <= n; i++) {
      const t = d * i / n;
      if (collide(e.x + (ax ? t : 0) + (ax ? 0 : 0), e.y + (ay ? t : 0), e.z + (az ? t : 0))) {
        // Binary-refine the contact.
        let lo = done, hi = t;
        for (let k = 0; k < 6; k++) { const mid = (lo + hi) / 2; if (collide(e.x + (ax ? mid : 0), e.y + (ay ? mid : 0), e.z + (az ? mid : 0))) hi = mid; else lo = mid; }
        return lo;
      }
      done = t;
    }
    return d;
  };
  const ry = sweep(0, 1, 0, dy); e.y += ry;
  const hitY = Math.abs(ry - dy) > 1e-7;
  const ground = hitY && dy < 0;
  let rx = sweep(1, 0, 0, dx); e.x += rx;
  let rz = sweep(0, 0, 1, dz); e.z += rz;
  let hitX = Math.abs(rx - dx) > 1e-7, hitZ = Math.abs(rz - dz) > 1e-7;
  if (step > 0 && (hitX || hitZ) && (ground || dy <= 0)) {
    // Try stepping up onto a ledge.
    const sy = e.y;
    const up = sweep(0, 1, 0, step);
    e.y += up;
    const ex = sweep(1, 0, 0, dx - rx); e.x += ex;
    const ez = sweep(0, 0, 1, dz - rz); e.z += ez;
    if (Math.abs(ex) + Math.abs(ez) > 1e-4) {
      const down = sweep(0, 1, 0, -up); e.y += down;
      rx += ex; rz += ez;
      hitX = Math.abs(rx - dx) > 1e-7; hitZ = Math.abs(rz - dz) > 1e-7;
    } else { e.x -= ex; e.z -= ez; e.y = sy; }
  }
  return { dx: rx, dy: ry, dz: rz, hitX, hitY, hitZ, ground };
}

/** Does a segment hit a solid block box? Returns the hit point and face normal. */
export function rayBlocks(get: BlockAt, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number):
  { x: number; y: number; z: number; bx: number; by: number; bz: number; nx: number; ny: number; nz: number; t: number } | null {
  const len = Math.hypot(x1 - x0, y1 - y0, z1 - z0);
  const steps = Math.max(1, Math.ceil(len / .05));
  let px = x0, py = y0, pz = z0;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const x = x0 + (x1 - x0) * t, y = y0 + (y1 - y0) * t, z = z0 + (z1 - z0) * t;
    const bx = Math.floor(x), by = Math.floor(y), bz = Math.floor(z);
    const boxes = collisionBoxes(get(bx, by, bz));
    if (boxes) for (const [mn, mx] of boxes) {
      if (x >= bx + mn[0] && x <= bx + mx[0] && y >= by + mn[1] && y <= by + mx[1] && z >= bz + mn[2] && z <= bz + mx[2]) {
        const fx = Math.floor(px), fy = Math.floor(py), fz = Math.floor(pz);
        return { x: px, y: py, z: pz, bx, by, bz, nx: Math.sign(fx - bx), ny: Math.sign(fy - by), nz: Math.sign(fz - bz), t };
      }
    }
    px = x; py = y; pz = z;
  }
  return null;
}

/** Does a segment pass through an AABB (centre-bottom x/y/z, half width, height)? Returns t or null. */
export function segmentHitsBox(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number,
  bx: number, by: number, bz: number, hw: number, h: number, inflate = 0): number | null {
  const min = [bx - hw - inflate, by - inflate, bz - hw - inflate], max = [bx + hw + inflate, by + h + inflate, bz + hw + inflate];
  const o = [x0, y0, z0], d = [x1 - x0, y1 - y0, z1 - z0];
  let tmin = 0, tmax = 1;
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-9) { if (o[i] < min[i] || o[i] > max[i]) return null; continue; }
    let t1 = (min[i] - o[i]) / d[i], t2 = (max[i] - o[i]) / d[i];
    if (t1 > t2) [t1, t2] = [t2, t1];
    tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
    if (tmin > tmax) return null;
  }
  return tmin;
}

/** Fraction of rays from a blast centre that reach a body unobstructed (vanilla exposure). */
export function exposure(get: BlockAt, cx: number, cy: number, cz: number, e: { x: number; y: number; z: number; w: number; h: number }): number {
  const hw = e.w / 2;
  let hit = 0, total = 0;
  for (let i = 0; i <= 2; i++) for (let j = 0; j <= 2; j++) for (let k = 0; k <= 2; k++) {
    const px = e.x - hw + e.w * i / 2, py = e.y + e.h * j / 2, pz = e.z - hw + e.w * k / 2;
    total++;
    if (!rayBlocks(get, px, py, pz, cx, cy, cz)) hit++;
  }
  return hit / total;
}

export function inFluid(get: BlockAt, x: number, y: number, z: number, kind?: 'water' | 'lava'): boolean {
  const f = BLOCKS[get(Math.floor(x), Math.floor(y), Math.floor(z))]?.fluid;
  return !!f && (!kind || f.kind === kind);
}
export function moveKindAt(get: BlockAt, x: number, y: number, z: number) {
  return VMETA[get(Math.floor(x), Math.floor(y), Math.floor(z))]?.move;
}

export class EntityWorld {
  readonly all = new Map<number, Entity>();
  private nextId = 1_000_000;
  /** Spawned since the last sync. */
  readonly spawned: Entity[] = [];
  readonly removed: number[] = [];
  /** Mobs killed since the last sync (a subset of `removed`): clients play the death fall. */
  readonly died: number[] = [];

  spawn(kind: EntityKind, x: number, y: number, z: number, init: Partial<Entity> = {}): Entity {
    const k = KINDS[kind];
    const e: Entity = {
      id: this.nextId++, kind, x, y, z, vx: 0, vy: 0, vz: 0, yaw: 0, pitch: 0, w: k.w, h: k.h,
      onGround: false, inWater: false, age: 0, hp: k.hp ?? 1, maxHp: k.hp ?? 1, flags: 0, timer: 0, data: {},
      dead: false, hurtTime: 0, fire: 0, scale: 1, fall: 0, ...init,
    };
    if (e.baby) { e.w *= .5; e.h *= .5; e.flags |= 2; /* ENT_FLAG.baby */ }
    this.all.set(e.id, e);
    this.spawned.push(e);
    return e;
  }
  remove(e: Entity): void {
    if (e.dead) return;
    e.dead = true;
    this.all.delete(e.id);
    this.removed.push(e.id);
  }
  near(x: number, y: number, z: number, r: number, pred?: (e: Entity) => boolean): Entity[] {
    const out: Entity[] = [];
    for (const e of this.all.values()) {
      if (Math.abs(e.x - x) > r || Math.abs(e.y - y) > r + 2 || Math.abs(e.z - z) > r) continue;
      if (Math.hypot(e.x - x, e.y + e.h / 2 - y, e.z - z) <= r && (!pred || pred(e))) out.push(e);
    }
    return out;
  }
  view(e: Entity): EntityView {
    return {
      id: e.id, kind: e.kind, x: r2(e.x), y: r2(e.y), z: r2(e.z), yaw: r2(e.yaw), pitch: r2(e.pitch),
      vx: r2(e.vx * 20), vy: r2(e.vy * 20), vz: r2(e.vz * 20), flags: e.flags, item: e.item, block: e.block,
      owner: e.owner, variant: e.data.variant as string | undefined, color: e.data.color as number | undefined,
      size: e.scale !== 1 ? e.scale : (e.data.size as number | undefined), hp: KINDS[e.kind].mob ? e.hp : undefined,
    };
  }
}
const r2 = (n: number) => Math.round(n * 100) / 100;

/** Gravity + drag + block collision for a non-mob body. */
export function stepPhysics(get: BlockAt, e: Entity): ReturnType<typeof moveBox> {
  const k = KINDS[e.kind];
  e.inWater = inFluid(get, e.x, e.y + e.h * .5, e.z, 'water');
  e.vy -= k.gravity;
  const res = moveBox(get, e, e.vx, e.vy, e.vz);
  if (res.hitX) e.vx = 0;
  if (res.hitZ) e.vz = 0;
  if (res.hitY) e.vy = 0;
  e.onGround = res.ground;
  const drag = e.inWater ? .8 : k.drag;
  e.vx *= drag; e.vy *= drag; e.vz *= drag;
  if (e.onGround) { e.vx *= .6; e.vz *= .6; }
  return res;
}

export const NO_MOVE: MoveProfile = { speed: 1, jump: 0, gravity: 1, slowFall: false, levitation: 0, scale: 1, canSprint: true, safeFall: 0, frozen: true, elytra: false };
