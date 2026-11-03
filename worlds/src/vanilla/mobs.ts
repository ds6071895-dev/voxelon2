// Mob behaviour (Java Edition): zombies and husks chase and swing, skeletons
// keep their distance and shoot, creepers swell for 30 ticks within 3 blocks
// and blow up (power 3), silverfish nibble, tamed wolves guard their owner,
// sheep and chickens wander. Paths come from a small budgeted A* over
// standable cells (step up 1, drop up to 3); without a path mobs steer
// straight at their target.

import { BLOCKS } from '../blocks';
import { VMETA } from './blocks';
import { KINDS, moveBox, type Entity, type EntityWorld } from './entity';
import { ENT_FLAG } from './messages';

type BlockAt = (x: number, y: number, z: number) => number;
export interface Target { id: number; x: number; y: number; z: number; alive: boolean; ent?: boolean }

export interface MobCtx {
  get: BlockAt;
  ents: EntityWorld;
  tick: number;
  rng: () => number;
  /** Living players (and, for wolves, hostile mobs) a mob may target. */
  players(): Target[];
  /** A mob's melee or projectile hit on a player or entity. */
  hit(mob: Entity, target: Target, damage: number, extra?: { hungerTicks?: number }): void;
  shoot(mob: Entity, tx: number, ty: number, tz: number): void;
  explode(mob: Entity, power: number): void;
  /** Follow range override (Disaster City sets 64). */
  followRange?: number;
  leashHolder?(id:number):Target|undefined;
  speedMult?: number;
  damageOverride?: number;
}

const passable = (id: number) => { const b = BLOCKS[id]; return !b || !b.solid || b.fluid !== undefined; };
const harmful = (id: number) => { const f = BLOCKS[id]?.fluid?.kind; return f === 'lava' || VMETA[id]?.family === 'fire' || VMETA[id]?.family === 'magma_block'; };

const isLadder = (id: number) => VMETA[id]?.move === 'ladder';
function standable(get: BlockAt, x: number, y: number, z: number, h: number, ladders = false): boolean {
  if (!passable(get(x, y, z)) || harmful(get(x, y, z))) return false;
  if (h > 1 && !passable(get(x, y + 1, z))) return false;
  if (ladders && isLadder(get(x, y, z))) return true;
  const below = get(x, y - 1, z);
  return !!BLOCKS[below]?.solid && !harmful(below);
}

/** Budgeted A* (binary heap, numeric keys); returns cell centres from start
 *  (exclusive) to goal, or the best partial path. Mobs can't climb ladders;
 *  players (bots) pass `ladders` to go straight up and down them. */
export function findPath(get: BlockAt, sx: number, sy: number, sz: number, gx: number, gy: number, gz: number, h: number, budget = 400, ladders = false): [number, number, number][] | null {
  const key = (x: number, y: number, z: number) => ((y + 64) * 4096 + (z + 2048)) * 4096 + (x + 2048);
  const unkey = (k: number): [number, number, number] => [k % 4096 - 2048, Math.floor(k / 16777216) - 64, Math.floor(k / 4096) % 4096 - 2048];
  const heap: number[] = [], f = new Map<number, number>();
  const push = (k: number, fv: number) => {
    f.set(k, fv); heap.push(k);
    let i = heap.length - 1;
    while (i > 0) { const pi = (i - 1) >> 1; if (f.get(heap[pi])! <= fv) break; heap[i] = heap[pi]; heap[pi] = k; i = pi; }
  };
  const pop = (): number => {
    const top = heap[0], last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let m = i;
        if (l < heap.length && f.get(heap[l])! < f.get(heap[m])!) m = l;
        if (r < heap.length && f.get(heap[r])! < f.get(heap[m])!) m = r;
        if (m === i) break;
        [heap[i], heap[m]] = [heap[m], heap[i]]; i = m;
      }
    }
    return top;
  };
  const start = key(sx, sy, sz);
  const came = new Map<number, number>(), gs = new Map<number, number>([[start, 0]]), closed = new Set<number>();
  push(start, 0);
  let best = start, bestD = Infinity, n = 0;
  while (heap.length && n++ < budget) {
    const ck = pop();
    if (closed.has(ck)) continue;
    closed.add(ck);
    const [cx, cy, cz] = unkey(ck);
    const d = Math.abs(cx - gx) + Math.abs(cy - gy) + Math.abs(cz - gz);
    if (d < bestD) { bestD = d; best = ck; }
    if (d <= 1) break;
    const cg = gs.get(ck)!;
    // Ladders: straight up (out at the top onto the roof is the usual step-up) or down.
    if (ladders && isLadder(get(cx, cy, cz))) for (const dy of [1, -1]) {
      const ny = cy + dy;
      if (!isLadder(get(cx, ny, cz)) && !(dy < 0 && standable(get, cx, ny, cz, h))) continue;
      if (dy > 0 && !passable(get(cx, ny + h - 1, cz))) continue;
      const nk = key(cx, ny, cz);
      if (closed.has(nk)) continue;
      const g = cg + 1.2;
      if (g < (gs.get(nk) ?? Infinity)) { gs.set(nk, g); came.set(nk, ck); push(nk, g + Math.hypot(cx - gx, ny - gy, cz - gz)); }
    }
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      if (!dx && !dz) continue;
      if (dx && dz && (!passable(get(cx + dx, cy, cz)) || !passable(get(cx, cy, cz + dz)))) continue;
      for (const dy of [0, 1, -1, -2, -3]) {
        const nx = cx + dx, ny = cy + dy, nz = cz + dz;
        if (dy === 1 && !passable(get(cx, cy + h, cz))) continue;
        if (!standable(get, nx, ny, nz, h, ladders)) continue;
        // Walking off an edge: the body passes at full height before it falls.
        if (dy < 0) { let clear = true; for (let k = h - 1; k > dy; k--) if (!passable(get(nx, cy + k, nz))) clear = false; if (!clear) continue; }
        const nk = key(nx, ny, nz);
        if (closed.has(nk)) break;
        const g = cg + (dx && dz ? 1.414 : 1) + (dy > 0 ? .5 : 0);
        if (g < (gs.get(nk) ?? Infinity)) {
          gs.set(nk, g); came.set(nk, ck);
          push(nk, g + Math.hypot(nx - gx, ny - gy, nz - gz));
        }
        break;
      }
    }
  }
  if (best === start) return null;
  const path: [number, number, number][] = [];
  for (let k: number | undefined = best; k !== undefined && k !== start; k = came.get(k)) {
    const [x, y, z] = unkey(k);
    path.push([x + .5, y, z + .5]);
  }
  return path.reverse();
}

interface Brain { path?: [number, number, number][]; pathAt?: number; target?: number; attackAt?: number; wander?: [number, number]; fuse?: number; shotAt?: number; strafe?: number }

/** One AI tick + physics for a mob. */
export function tickMob(e: Entity, c: MobCtx): void {
  const k = KINDS[e.kind];
  if(e.data.noAI){e.vx=e.vz=0;const res=moveBox(c.get,e,0,e.vy,0);e.vy=res.ground?0:(e.vy-.08)*.98;e.onGround=res.ground;return;}
  if(typeof e.data.leash==='number'){
    const holder=c.leashHolder?.(e.data.leash);
    const d=holder?Math.hypot(holder.x-e.x,holder.y-e.y,holder.z-e.z):Infinity;
    if(!holder||!holder.alive||d>10){delete e.data.leash;}
    else {
      const dx=holder.x-e.x,dz=holder.z-e.z,len=Math.hypot(dx,dz)||1;
      if(d>6){e.vx+=Math.sign(dx)*(dx/d)**2*.4;e.vy+=Math.sign(holder.y-e.y)*((holder.y-e.y)/d)**2*.4;e.vz+=Math.sign(dz)*(dz/d)**2*.4;}
      else{const speed=d>2?.23:0;e.vx+=(dx/len*speed-e.vx)*.5;e.vz+=(dz/len*speed-e.vz)*.5;}
      e.yaw=Math.atan2(-dx,-dz);e.vy=(e.vy-.08)*.98;
      const res=moveBox(c.get,e,e.vx,e.vy,e.vz,.6);e.onGround=res.ground;if(res.hitY)e.vy=0;if((res.hitX||res.hitZ)&&e.onGround)e.vy=.42;
      return;
    }
  }
  const b = (e.data.brain ??= {}) as Brain;
  const speed = (k.speed ?? .23) * (e.baby ? 1.5 : 1) * (c.speedMult ?? 1);
  let wantX = 0, wantZ = 0, jump = false;
  const hostile = e.kind === 'zombie' || e.kind === 'husk' || e.kind === 'skeleton' || e.kind === 'creeper' || e.kind === 'silverfish';
  const range = c.followRange ?? (e.kind === 'zombie' || e.kind === 'husk' ? 35 : 16);

  let target: Target | undefined;
  if (hostile) {
    if (c.tick % 20 === e.id % 20 || b.target === undefined) {
      let best: Target | undefined, bd = range;
      for (const p of c.players()) {
        if (!p.alive || p.ent) continue;
        const d = Math.hypot(p.x - e.x, p.y - e.y, p.z - e.z);
        if (d < bd) { bd = d; best = p; }
      }
      b.target = best?.id;
    }
    target = c.players().find((p) => p.id === b.target && p.alive);
  } else if (e.kind === 'wolf') {
    const owner = e.owner === undefined ? undefined : c.players().find((p) => p.id === e.owner);
    // A foe is whoever hurt the wolf, attacked its owner or was attacked by its owner: a player or a mob.
    let foe = b.target !== undefined ? c.players().find((p) => p.id === b.target && p.alive && p.id !== e.owner) : undefined;
    if (!foe && b.target !== undefined) {
      const m = c.ents.all.get(b.target);
      if (m && !m.dead && KINDS[m.kind].mob && m !== e && m.owner !== e.owner && Math.hypot(m.x - e.x, m.z - e.z) < 24) foe = { id: m.id, x: m.x, y: m.y, z: m.z, alive: true, ent: true };
      else b.target = undefined;
    }
    if (foe) { target = foe; e.flags |= ENT_FLAG.angry; }
    else {
      e.flags &= ~ENT_FLAG.angry;
      if (owner && owner.alive) {
        const d = Math.hypot(owner.x - e.x, owner.z - e.z);
        if (d > 12) { e.x = owner.x; e.y = owner.y; e.z = owner.z; e.vx = e.vz = 0; }
        else if (d > 2.5) { wantX = owner.x - e.x; wantZ = owner.z - e.z; }
      }
    }
  }

  if (target) {
    const dx = target.x - e.x, dz = target.z - e.z, dist = Math.hypot(dx, dz), dy = target.y - e.y;
    e.yaw = Math.atan2(-dx, -dz);
    if (e.kind === 'skeleton') {
      if (dist > 10) { wantX = dx; wantZ = dz; } else if (dist < 4) { wantX = -dx; wantZ = -dz; }
      else { b.strafe ??= c.rng() < .5 ? 1 : -1; if (c.rng() < .02) b.strafe = -b.strafe; wantX = -dz * b.strafe; wantZ = dx * b.strafe; }
      if (dist < 15 && c.tick - (b.shotAt ?? -100) >= 40) { b.shotAt = b.attackAt = c.tick; e.flags |= ENT_FLAG.swing; c.shoot(e, target.x, target.y + 1.1, target.z); }
    } else if (e.kind === 'creeper') {
      if (dist < 3 && Math.abs(dy) < 2.5) b.fuse = (b.fuse ?? 0) + 1;
      else if (dist > 7) b.fuse = 0;
      else if (b.fuse) b.fuse = Math.max(0, b.fuse - 1);
      if (b.fuse) e.flags |= ENT_FLAG.fuse; else e.flags &= ~ENT_FLAG.fuse;
      if ((b.fuse ?? 0) >= 30) { c.explode(e, e.data.charged ? 6 : 3); return; }
      if (!b.fuse) { wantX = dx; wantZ = dz; }
    } else {
      wantX = dx; wantZ = dz;
      const reach = (e.w + .6) / 2 + (e.kind === 'silverfish' ? .4 : .9);
      if (dist < reach && Math.abs(dy) < 1.6 && c.tick - (b.attackAt ?? -100) >= 20) {
        b.attackAt = c.tick;
        e.flags |= ENT_FLAG.swing;
        const dmg = c.damageOverride ?? (e.kind === 'silverfish' ? 1 : e.kind === 'wolf' ? 4 : 3);
        c.hit(e, target, dmg, e.kind === 'husk' ? { hungerTicks: 140 } : undefined);
      }
    }
    // Path around obstacles when the straight line is blocked.
    if (dist > 2 && (wantX || wantZ) && e.kind !== 'skeleton') {
      if (!b.path || c.tick - (b.pathAt ?? 0) > 20) {
        b.pathAt = c.tick;
        b.path = findPath(c.get, Math.floor(e.x), Math.floor(e.y + .01), Math.floor(e.z), Math.floor(target.x), Math.floor(target.y + .01), Math.floor(target.z), Math.ceil(e.h)) ?? undefined;
      }
      while (b.path?.length && Math.hypot(b.path[0][0] - e.x, b.path[0][2] - e.z) < .4) b.path.shift();
      const nextNode = b.path?.[0];
      if (nextNode) { wantX = nextNode[0] - e.x; wantZ = nextNode[2] - e.z; if (nextNode[1] > e.y + .5) jump = true; }
    }
  } else if (!wantX && !wantZ) {
    // Lost its target: a lit creeper calms down instead of hissing forever.
    if (b.fuse) { b.fuse = Math.max(0, b.fuse - 1); if (!b.fuse) e.flags &= ~ENT_FLAG.fuse; }
    // Wander.
    if (!b.wander || c.rng() < .01) b.wander = c.rng() < .3 ? [e.x + (c.rng() - .5) * 10, e.z + (c.rng() - .5) * 10] : [e.x, e.z];
    wantX = b.wander[0] - e.x; wantZ = b.wander[1] - e.z;
    if (Math.hypot(wantX, wantZ) < .5) wantX = wantZ = 0;
  }
  if (e.flags & ENT_FLAG.swing && c.tick - (b.attackAt ?? -100) > 6) e.flags &= ~ENT_FLAG.swing;

  const len = Math.hypot(wantX, wantZ);
  const s = target || e.kind === 'wolf' ? speed : speed * .5;
  // Skeletons strafe and back off while keeping their bow on the target.
  if (len > .01 && !(target && e.kind === 'skeleton')) { e.yaw = Math.atan2(-wantX, -wantZ); }
  const ax = len > .01 ? wantX / len * s : 0, az = len > .01 ? wantZ / len * s : 0;
  // Ground control blends toward the wished velocity; air keeps momentum.
  const ctrl = e.onGround ? .5 : .05;
  e.vx += (ax - e.vx) * ctrl; e.vz += (az - e.vz) * ctrl;
  e.inWater = !!BLOCKS[c.get(Math.floor(e.x), Math.floor(e.y + .2), Math.floor(e.z))]?.fluid;
  if (e.inWater) e.vy = Math.min(e.vy + .1, .1);
  else e.vy -= k.gravity;
  const res = moveBox(c.get, e, e.vx, e.vy, e.vz, .6);
  if ((res.hitX || res.hitZ) && e.onGround) jump = true;
  if (res.hitY) { if (e.vy < 0) { e.fall = 0; } e.vy = 0; }
  else if (e.vy < 0) e.fall -= e.vy;
  e.onGround = res.ground;
  if (jump && e.onGround) e.vy = .42;
  e.vy *= .98;
  if (e.hurtTime > 0) e.hurtTime--;
}
