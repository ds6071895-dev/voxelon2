// The twelve disasters, ported from the plugin's Disaster subclasses: same
// cadences, damage, areas, block changes and visuals (as Worlds effects).
// Every one runs on the match's 20 Hz tick through DisasterHost.

import { BLOCKS, Block } from './blocks';
import { VB, VMETA, stateId } from './vanilla/blocks';
import type { Edit } from './net/mode_engine';
import {
  BUILDINGS, CITY, MAST_TOP, bcx, bcz, buildingAt, crackEvery, fireStarts, gasLeaks, inCity, isRoad, lightningEvery, manholes,
  meteorEvery, overSubway, sinkholeEvery, zombieCount, type Building, type DisasterKind,
} from './disaster_rules';
import type { Entity } from './vanilla/entity';
import type { FxEvent } from './vanilla/messages';

/** What a disaster can reach in the match. */
export interface DisasterHost {
  get(x: number, y: number, z: number): number;
  set(x: number, y: number, z: number, block: number): void;
  setMany(edits: Edit[]): void;
  /** Fill a box with a mask; returns changed cells (for floods that drain). */
  fill(min: [number, number, number], max: [number, number, number], block: number, replace: number[], supported: boolean): Edit[];
  rng(): number;
  alive(): { id: number; x: number; y: number; z: number; onGround: boolean; eyeY: number }[];
  aliveCount(): number;
  intensity(): number;
  exposed(id: number): boolean;
  hurt(id: number, amount: number, kind: DisasterKind): void;
  blame(id: number, kind: DisasterKind): void;
  blameNear(x: number, y: number, z: number, r: number, kind: DisasterKind): void;
  /** Set (or add to) a player's velocity, blocks/tick. */
  velocity(id: number, vx: number, vy: number, vz: number, add?: boolean): void;
  debris(x: number, y: number, z: number, vx: number, vy: number, vz: number, kind: DisasterKind): void;
  explode(x: number, y: number, z: number, power: number, kind: DisasterKind): void;
  lightning(x: number, y: number, z: number): void;
  fx(f: FxEvent): void;
  display(variant: string, x: number, y: number, z: number, data?: Record<string, unknown>): Entity;
  removeDisplay(e: Entity): void;
  spawnMob(kind: 'zombie' | 'husk', x: number, y: number, z: number, baby: boolean): Entity;
  removeMob(e: Entity): void;
  giveCrowbars(): void;
  takeCrowbars(): void;
  freeze(id: number, add: number, cap: number): number;
  warm(id: number): boolean;
  inBoat(id: number): boolean;
  bar(text: string, color: string): void;
}

const isAir = (id: number) => id === Block.Air;
const solid = (id: number) => !!BLOCKS[id]?.solid;
const fam = (id: number) => VMETA[id]?.family ?? '';

export abstract class Disaster {
  age = 0;
  stopping = false;
  constructor(readonly kind: DisasterKind, readonly h: DisasterHost, readonly duration: number) {}
  start(): void {}
  abstract tick(): void;
  stop(): void {}
  wind(): void {}
  finished(): boolean { return true; }
  cleanup(): void {}
  protected r(): number { return this.h.rng(); }
  protected int(n: number): number { return Math.floor(this.r() * n); }
  protected every(t: number): boolean { return t <= 1 || this.age % t === 0; }
  /** Top non-air block of a column (BASE_BOTTOM - 1 over a hole). */
  protected top(x: number, z: number): number {
    for (let y = CITY.BUILD_MAX_Y; y >= CITY.BASE_BOTTOM; y--) if (!isAir(this.h.get(x, y, z))) return y;
    return CITY.BASE_BOTTOM - 1;
  }
  protected randomX(): number { return CITY.MIN + 2 + this.int(CITY.MAX - CITY.MIN - 3); }
  protected somePlayer() { const a = this.h.alive(); return a.length ? a[this.int(a.length)] : null; }
  /** Remove solid blocks in a ball, keeping the slab bottom unless throughFloor. */
  protected crater(cx: number, cy: number, cz: number, radius: number, throughFloor: boolean, lining: number | null): void {
    const r = Math.ceil(radius), floor = throughFloor ? CITY.BASE_BOTTOM : CITY.GROUND - 1;
    const edits: Edit[] = [];
    for (let x = -r; x <= r; x++) for (let y = -r; y <= r; y++) for (let z = -r; z <= r; z++) {
      const d = Math.sqrt(x * x + y * y * 1.4 + z * z), by = cy + y;
      if (d > radius || by < floor || !inCity(cx + x, cz + z)) continue;
      if (!throughFloor && overSubway(cx + x, cz + z) && by < CITY.GROUND) continue;
      const id = this.h.get(cx + x, by, cz + z);
      if (isAir(id) || BLOCKS[id]?.hardness === -1 && fam(id) === 'bedrock') continue;
      const edge = d > radius - 1.1;
      if (edge && lining !== null && this.int(3) === 0 && solid(id)) edits.push({ x: cx + x, y: by, z: cz + z, block: lining });
      else if (!edge || this.r() < .5) edits.push({ x: cx + x, y: by, z: cz + z, block: Block.Air });
    }
    this.h.setMany(edits);
  }
  protected scorch(x0: number, y0: number, z0: number, radius: number, fires: number): void {
    for (let i = 0; i < fires; i++) {
      const x = x0 + this.int(radius * 2 + 1) - radius, z = z0 + this.int(radius * 2 + 1) - radius;
      for (let y = y0 + 2; y >= y0 - 3; y--) {
        if (isAir(this.h.get(x, y, z)) && solid(this.h.get(x, y - 1, z))) { this.h.set(x, y, z, VB.fire); break; }
      }
    }
  }
}
function flat(x: number, z: number, len: number, rng: () => number): [number, number] {
  const d = Math.hypot(x, z);
  if (d < 1e-6) { const a = rng() * Math.PI * 2; return [Math.cos(a) * len, Math.sin(a) * len]; }
  return [x / d * len, z / d * len];
}

class MeteorShower extends Disaster {
  private meteors: { tx: number; ty: number; tz: number; x: number; y: number; z: number; sx: number; sy: number; sz: number; size: number; e: Entity }[] = [];
  tick(): void {
    if (this.age < this.duration - 35 && this.every(meteorEvery(this.h.aliveCount(), this.h.intensity()))) this.spawn();
    this.fly();
  }
  wind(): void { this.fly(); }
  finished(): boolean { return this.meteors.length === 0; }
  cleanup(): void { for (const m of this.meteors) this.h.removeDisplay(m.e); this.meteors = []; }
  private spawn(): void {
    let x: number, z: number;
    const aim = this.int(10) < 6 ? this.somePlayer() : null;
    if (aim) { x = Math.floor(aim.x) + this.int(7) - 3; z = Math.floor(aim.z) + this.int(7) - 3; }
    else { x = this.randomX(); z = this.randomX(); }
    if (!inCity(x, z)) return;
    const y = this.top(x, z);
    if (y < CITY.BASE_BOTTOM) return;
    const size = 1.4 + this.r() * 1.6;
    const fx = this.r() * 30 - 15, fy = 48, fz = this.r() * 30 - 15, len = Math.hypot(fx, fy, fz);
    const tx = x + .5, ty = y + 1, tz = z + .5;
    const m = { tx, ty, tz, x: tx + fx, y: ty + fy, z: tz + fz, sx: -fx / len * 1.6, sy: -fy / len * 1.6, sz: -fz / len * 1.6, size, e: null as unknown as Entity };
    m.e = this.h.display('meteor', m.x, m.y, m.z, { size });
    // Where it will land, as the ring of flame shows everyone (bots read it).
    m.e.data.tx = tx; m.e.data.tz = tz; m.e.data.ty = ty; m.e.data.r = 1.6 + size * .9;
    this.meteors.push(m);
  }
  private fly(): void {
    this.meteors = this.meteors.filter((m) => {
      m.x += m.sx; m.y += m.sy; m.z += m.sz;
      m.e.x = m.x; m.e.y = m.y; m.e.z = m.z;
      if (this.age % 4 === 0) this.h.fx({ f: 'burst', kind: 'ring_flame', x: m.tx, y: m.ty, z: m.tz, n: 10 });
      const blocked = solid(this.h.get(Math.floor(m.x), Math.floor(m.y), Math.floor(m.z))) && inCity(Math.floor(m.x), Math.floor(m.z));
      if (!blocked && m.y > m.ty) return true;
      const ax = blocked ? m.x : m.tx, ay = blocked ? m.y : m.ty, az = blocked ? m.z : m.tz;
      const radius = 1.6 + m.size * .9;
      this.h.blameNear(ax, ay, az, radius + 3, 'meteors');
      this.h.explode(ax, ay, az, 2.4 + m.size * 1.2, 'meteors');
      this.crater(Math.floor(ax), Math.floor(ay), Math.floor(az), radius, false, VB.magma_block);
      this.scorch(Math.floor(ax), Math.floor(ay), Math.floor(az), Math.trunc(radius) + 1, 3);
      this.h.fx({ f: 'burst', kind: 'lava', x: ax, y: ay, z: az, n: 12 });
      this.h.removeDisplay(m.e);
      return false;
    });
  }
}

class Tornado extends Disaster {
  private x = 0; private z = 0; private heading = 0;
  private caught = new Map<number, number>();
  private e: Entity | null = null;
  start(): void {
    const a = this.r() * Math.PI * 2;
    this.x = Math.cos(a) * 40; this.z = Math.sin(a) * 40;
    this.heading = a + Math.PI + (this.r() - .5);
    this.e = this.h.display('tornado', this.x, CITY.GROUND + 1, this.z);
  }
  tick(): void {
    this.move();
    if (this.e) { this.e.x = this.x; this.e.z = this.z; }
    const tries = 4 + Math.trunc(this.h.intensity() * 2);
    for (let i = 0; i < tries; i++) {
      const bx = Math.floor(this.x + this.r() * 14 - 7), bz = Math.floor(this.z + this.r() * 14 - 7);
      if (!inCity(bx, bz)) continue;
      const by = this.top(bx, bz);
      if (by <= CITY.GROUND || by > CITY.GROUND + 34) continue;
      if (fam(this.h.get(bx, by, bz)) === 'lightning_rod') continue;
      const [ox, oz] = flat(bx - this.x, bz - this.z, .5, () => this.r());
      this.h.debris(bx, by, bz, ox, .9 + this.r() * .5, oz, 'tornado');
    }
    for (const p of this.h.alive()) this.pull(p);
  }
  stop(): void { if (this.e) this.h.removeDisplay(this.e); this.e = null; }
  cleanup(): void { this.stop(); }
  private move(): void {
    this.heading += (this.r() - .5) * .12;
    const speed = .34 * Math.min(1.6, this.h.intensity());
    const nx = this.x + Math.cos(this.heading) * speed, nz = this.z + Math.sin(this.heading) * speed;
    if (Math.abs(nx) > CITY.MAX - 4 || Math.abs(nz) > CITY.MAX - 4) { this.heading = Math.atan2(-this.z, -this.x) + (this.r() - .5); return; }
    this.x = nx; this.z = nz;
  }
  private pull(p: { id: number; x: number; y: number; z: number }): void {
    const dx = p.x - this.x, dz = p.z - this.z, d = Math.hypot(dx, dz);
    const inside = p.y < CITY.GROUND + 34 && (d < 3.5 || (d < 7 && this.h.exposed(p.id)));
    if (!inside) { this.caught.delete(p.id); return; }
    const held = (this.caught.get(p.id) ?? 0) + 1;
    this.caught.set(p.id, held);
    this.h.blame(p.id, 'tornado');
    if (held > 35) {
      const [fx, fz] = flat(dx, dz, 1.6, () => this.r());
      this.h.velocity(p.id, fx, .9, fz);
      this.caught.set(p.id, -40);
      return;
    }
    if (held < 0) return;
    const [tx, tz] = flat(-dx, -dz, .25, () => this.r());
    const [sx, sz] = flat(-dz, dx, .45, () => this.r());
    this.h.velocity(p.id, tx + sx, .35, tz + sz);
    if (held % 15 === 0) this.h.hurt(p.id, 3 * Math.min(1.5, this.h.intensity()), 'tornado');
  }
}

class Flood extends Disaster {
  private level = 0;
  private drift: [number, number] = [.12, 0];
  private layers: Edit[][] = [];
  private draining: Edit[] | null = null;
  private poured = true;
  start(): void {
    this.level = CITY.SUBWAY_FLOOR + 1;
    const a = this.r() * Math.PI * 2;
    this.drift = [Math.cos(a) * .12, Math.sin(a) * .12];
    this.pour();
  }
  tick(): void {
    if (this.age % 16 === 0 && this.level < CITY.FLOOD_TOP) {
      this.level = this.level === CITY.SUBWAY_TOP ? CITY.GROUND + 1 : this.level + 1;
      this.pour();
      this.h.fx({ f: 'sound', s: 'water', x: 0, y: this.level, z: 0 });
    }
    if (this.age % 20 === 0) for (const p of this.h.alive()) {
      const feet = this.h.get(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z));
      if (BLOCKS[feet]?.fluid?.kind === 'water' && !this.h.inBoat(p.id)) {
        this.h.hurt(p.id, 2, 'flood');
        this.h.velocity(p.id, this.drift[0], 0, this.drift[1], true);
        this.h.fx({ f: 'burst', kind: 'bubble', x: p.x, y: p.y + 1, z: p.z, n: 6 });
      }
    }
  }
  /** One whole layer, as one fill: water only into air, fire or snow. */
  private pour(): void {
    const subway = this.level <= CITY.SUBWAY_TOP;
    const x1 = subway ? CITY.SUBWAY_X1 - 1 : CITY.MIN + 1, x2 = subway ? CITY.SUBWAY_X2 + 1 : CITY.MAX - 1;
    const z1 = subway ? CITY.SUBWAY_Z1 - 1 : CITY.MIN + 1, z2 = subway ? CITY.STAIR_TOP_Z + 1 : CITY.MAX - 1;
    const replace = [Block.Air, VB.fire, ...[1, 2, 3, 4, 5, 6, 7].map((l) => stateId('snow', { layers: l })!)];
    this.layers.push(this.h.fill([x1, this.level, z1], [x2, this.level, z2], Block.Water, replace, this.level <= CITY.GROUND + 1));
    this.poured = true;
  }
  wind(): void {
    if (!this.draining || !this.draining.length) { this.draining = this.layers.pop() ?? null; if (!this.draining) return; }
    const batch = this.draining.splice(Math.max(0, this.draining.length - 450));
    this.h.setMany(batch.filter((e) => this.h.get(e.x, e.y, e.z) === Block.Water).map((e) => ({ ...e, block: Block.Air })));
  }
  finished(): boolean { return !this.layers.length && (!this.draining || !this.draining.length); }
  stop(): void { void this.poured; }
}

const FRAGILE = (id: number): boolean => {
  const f = fam(id);
  return /glass$|glass_pane$|leaves$|_fence$|_wool$|_carpet$/.test(f) || f === 'lantern' || f === 'oak_trapdoor' || f === 'fire';
};
class Tsunami extends Disaster {
  private wall: Entity | null = null;
  private hit = new Set<number>();
  private alongX = false; private sign = 1; private front = 0; private lastColumn = -1e9; private rolling = false;
  tick(): void {
    if (!this.rolling && this.age % 170 === 10 && this.age + 150 < this.duration) this.launch();
    if (this.rolling) this.roll();
  }
  wind(): void { if (this.rolling) this.roll(); }
  finished(): boolean { return !this.rolling; }
  cleanup(): void { if (this.wall) this.h.removeDisplay(this.wall); this.wall = null; this.rolling = false; }
  private launch(): void {
    this.alongX = this.r() < .5; this.sign = this.r() < .5 ? 1 : -1;
    this.front = -this.sign * (CITY.MAX + 12);
    this.hit.clear(); this.lastColumn = -1e9; this.rolling = true;
    const from = this.alongX ? (this.sign > 0 ? 'west' : 'east') : (this.sign > 0 ? 'north' : 'south');
    this.h.bar(`A wave is coming from the ${from}!`, '#00aaaa');
    this.h.fx({ f: 'sound', s: 'wave' });
    const heading = Math.atan2(this.alongX ? this.sign : 0, this.alongX ? 0 : this.sign);
    this.wall = this.h.display('tsunami', this.px(), CITY.GROUND + 1, this.pz(), { heading, height: CITY.WAVE_TOP - CITY.GROUND - 1 });
    // The wave faces the way it travels.
    this.wall.yaw = Math.atan2(-(this.alongX ? this.sign : 0), -(this.alongX ? 0 : this.sign));
  }
  private px(): number { return this.alongX ? this.front : 0; }
  private pz(): number { return this.alongX ? 0 : this.front; }
  private roll(): void {
    this.front += this.sign * .85;
    if (this.wall) { this.wall.x = this.px(); this.wall.z = this.pz(); }
    const column = Math.floor(this.front);
    if (column !== this.lastColumn) { this.lastColumn = column; this.smash(column); }
    for (const p of this.h.alive()) {
      const mine = this.alongX ? p.x : p.z;
      if (Math.abs(mine - this.front) < 2 && p.y < CITY.WAVE_TOP && !this.hit.has(p.id)) {
        this.hit.add(p.id);
        this.h.velocity(p.id, this.alongX ? this.sign * 2 : 0, .7, this.alongX ? 0 : this.sign * 2);
        this.h.hurt(p.id, 10, 'tsunami');
      }
    }
    if (this.sign * this.front > CITY.MAX + 12) { this.cleanup(); }
  }
  private smash(column: number): void {
    if (Math.abs(column) > CITY.MAX) return;
    const edits: Edit[] = [];
    for (let along = CITY.MIN + 1; along < CITY.MAX; along++) for (let y = CITY.GROUND + 1; y <= CITY.GROUND + 4; y++) {
      const x = this.alongX ? column : along, z = this.alongX ? along : column;
      if (FRAGILE(this.h.get(x, y, z))) edits.push({ x, y, z, block: Block.Air });
    }
    this.h.setMany(edits);
  }
}

class AcidRain extends Disaster {
  tick(): void {
    for (const p of this.h.alive()) {
      if (this.age % 20 === 0 && this.h.exposed(p.id)) {
        this.h.hurt(p.id, 3 * Math.min(1.5, this.h.intensity()), 'acid_rain');
        this.h.fx({ f: 'burst', kind: 'acid', x: p.x, y: p.y + 1, z: p.z, n: 8 });
      }
    }
    this.corrode(); this.corrode();
  }
  private corrode(): void {
    for (let t = 0; t < 3; t++) {
      const x = this.randomX(), z = this.randomX(), y = this.top(x, z);
      if (y <= CITY.GROUND) continue;
      const id = this.h.get(x, y, z), next = eaten(id);
      if (next !== null) { this.h.set(x, y, z, next); this.h.fx({ f: 'burst', kind: 'acid', x: x + .5, y: y + 1, z: z + .5, n: 6 }); return; }
    }
  }
}
function eaten(id: number): number | null {
  const f = fam(id);
  if (/glass$|leaves$|_wool$|_carpet$|_planks$|_slab$/.test(f) || (/_stairs$/.test(f) && !f.includes('stone'))) return Block.Air;
  if (id === Block.Grass) return VB.coarse_dirt;
  if (/_concrete$|terracotta$/.test(f) || f === 'smooth_stone' || f === 'stone_bricks' || f === 'quartz_block') return VB.mossy_cobblestone;
  return null;
}

class Earthquake extends Disaster {
  private cracks: { x: number; z: number; heading: number; left: number }[] = [];
  tick(): void {
    if (this.age % 4 === 0) for (const p of this.h.alive()) {
      if (p.onGround) { const s = .16 * this.h.intensity(); this.h.velocity(p.id, (this.r() - .5) * s, .04, (this.r() - .5) * s, true); }
      this.h.fx({ f: 'burst', kind: 'dust', x: p.x, y: p.y, z: p.z, n: 4, color: 0x8a8a8a });
      if (this.age % 40 === 0) this.h.fx({ f: 'sound', s: 'rumble', x: p.x, y: p.y, z: p.z });
    }
    if (this.every(crackEvery(this.h.aliveCount(), this.h.intensity()))) this.newCrack();
    if (this.age % 3 === 0) this.grow();
    if (this.age % 2 === 0) this.crumble();
  }
  private newCrack(): void {
    const near = this.int(10) < 7 ? this.somePlayer() : null;
    const c = { x: 0, z: 0, heading: 0, left: 0 };
    if (near && near.y < CITY.GROUND + 3) { c.x = near.x + this.int(7) - 3; c.z = near.z + this.int(7) - 3; }
    else { c.x = this.randomX(); c.z = this.randomX(); }
    c.heading = this.r() * Math.PI * 2;
    c.left = 12 + this.int(12);
    this.cracks.push(c);
    this.h.fx({ f: 'sound', s: 'explode', x: c.x, y: CITY.GROUND, z: c.z });
  }
  private grow(): void {
    this.cracks = this.cracks.filter((c) => {
      c.heading += (this.r() - .5) * .7;
      c.x += Math.cos(c.heading); c.z += Math.sin(c.heading);
      const x = Math.floor(c.x), z = Math.floor(c.z);
      if (--c.left <= 0 || !inCity(x, z) || Math.abs(x) >= CITY.MAX || Math.abs(z) >= CITY.MAX) return false;
      if (buildingAt(x, z) || overSubway(x, z)) return true;
      this.h.blameNear(x + .5, CITY.GROUND + 1, z + .5, 2.5, 'earthquake');
      const edits: Edit[] = [];
      for (let y = CITY.GROUND + 2; y >= CITY.BASE_BOTTOM; y--) if (!isAir(this.h.get(x, y, z))) edits.push({ x, y, z, block: Block.Air });
      this.h.setMany(edits);
      this.h.fx({ f: 'burst', kind: 'dust', x: x + .5, y: CITY.GROUND + 1, z: z + .5, n: 20, color: 0x8a8a8a });
      return true;
    });
  }
  private crumble(): void {
    const tall = BUILDINGS.filter((b) => b.tall);
    const b = tall[this.int(tall.length)];
    for (let t = 0; t < 4; t++) {
      const x = b.x1 + this.int(b.x2 - b.x1 + 1), z = b.z1 + this.int(b.z2 - b.z1 + 1), y = this.top(x, z);
      if (y < b.roof - 8) continue;
      const f = fam(this.h.get(x, y, z));
      if (f === 'ladder' || f === 'lightning_rod') continue;
      const [ox, oz] = flat(x - bcx(b), z - bcz(b), .25, () => this.r());
      this.h.debris(x, y, z, ox, .1, oz, 'earthquake');
      return;
    }
  }
}

class Sinkholes extends Disaster {
  private holes: { x: number; z: number; radius: number; opensAt: number }[] = [];
  tick(): void {
    if (this.age < this.duration - 25 && this.every(sinkholeEvery(this.h.aliveCount()))) this.plan();
    this.holes = this.holes.filter((h) => {
      if (this.age < h.opensAt) {
        if (this.age % 3 === 0) this.h.fx({ f: 'burst', kind: 'dust', x: h.x + .5, y: CITY.GROUND + 1.1, z: h.z + .5, n: 10, color: 0x6b4a2f });
        if (this.age % 10 === 0) this.h.fx({ f: 'sound', s: 'gravel', x: h.x + .5, y: CITY.GROUND + 1, z: h.z + .5 });
        return true;
      }
      this.open(h);
      return false;
    });
  }
  wind(): void { this.tick(); }
  finished(): boolean { return !this.holes.length; }
  private plan(): void {
    const t = this.somePlayer();
    let x: number, z: number;
    if (t && t.y < CITY.GROUND + 4 && this.int(10) < 9) { x = Math.floor(t.x) + this.int(5) - 2; z = Math.floor(t.z) + this.int(5) - 2; }
    else { x = this.randomX(); z = this.randomX(); }
    if (!inCity(x, z) || overSubway(x, z) || buildingAt(x, z)) return;
    this.holes.push({ x, z, radius: 2.2 + this.r() * 1.8 * Math.min(1.6, this.h.intensity()), opensAt: this.age + 25 });
  }
  private open(h: { x: number; z: number; radius: number }): void {
    const r = Math.ceil(h.radius);
    this.h.blameNear(h.x + .5, CITY.GROUND + 1, h.z + .5, h.radius + 2, 'sinkholes');
    const edits: Edit[] = [];
    for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
      const x = h.x + dx, z = h.z + dz;
      if (dx * dx + dz * dz > h.radius * h.radius || !inCity(x, z) || overSubway(x, z) || buildingAt(x, z)) continue;
      for (let y = CITY.GROUND + 3; y >= CITY.BASE_BOTTOM; y--) if (!isAir(this.h.get(x, y, z))) edits.push({ x, y, z, block: Block.Air });
    }
    this.h.setMany(edits);
    this.h.fx({ f: 'explode', x: h.x + .5, y: CITY.GROUND + 1, z: h.z + .5, power: 1 });
  }
}

const FLAMMABLE = (id: number): boolean => {
  const f = fam(id);
  if (/_planks$|_log$|leaves$|_wool$|_carpet$|_fence$/.test(f)) return true;
  if (f === 'bookshelf' || f === 'barrel' || f === 'crafting_table' || f === 'loom' || f === 'oak_door') return true;
  if ((/_stairs$|_slab$/.test(f)) && !f.includes('stone') && !f.includes('brick') && !f.includes('quartz')) return true;
  return id === Block.Leaves || id === Block.BirchLeaves || id === Block.SpruceLeaves || id === Block.OakLog || id === Block.OakPlanks;
};
class Wildfire extends Disaster {
  private burning = new Map<string, number>();
  start(): void {
    const wooden = BUILDINGS.filter((b) => b.wooden);
    for (let i = wooden.length - 1; i > 0; i--) { const j = this.int(i + 1); [wooden[i], wooden[j]] = [wooden[j], wooden[i]]; }
    const starts = fireStarts(this.h.aliveCount());
    for (let i = 0; i < Math.min(starts, wooden.length); i++) {
      const b = wooden[i];
      for (let t = 0; t < 30; t++) {
        const x = b.x1 + 1 + this.int(Math.max(1, b.x2 - b.x1 - 1)), z = b.z1 + 1 + this.int(Math.max(1, b.z2 - b.z1 - 1));
        const y = CITY.GROUND + this.int(Math.max(1, b.roof - CITY.GROUND));
        if (this.ignite(x, y, z)) break;
      }
    }
    for (let t = 0; t < 60; t++) {
      const x = this.randomX(), z = this.randomX(), y = this.top(x, z);
      if (/leaves$/.test(fam(this.h.get(x, y, z))) && this.ignite(x, y, z)) break;
    }
  }
  tick(): void {
    if (this.age % 5 === 0) { this.spread(); this.burnOut(); }
    if (this.age % 6 === 0 && this.burning.size) {
      const keys = [...this.burning.keys()];
      for (let i = 0; i < Math.min(6, keys.length); i++) {
        const [x, y, z] = keys[this.int(keys.length)].split(',').map(Number);
        this.h.fx({ f: 'burst', kind: 'smoke', x: x + .5, y: y + 1, z: z + .5, n: 2 });
      }
    }
    if (this.age % 10 === 0) for (const p of this.h.alive()) {
      if (VMETA[this.h.get(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z))]?.family === 'fire') this.h.blame(p.id, 'wildfire');
    }
  }
  stop(): void {
    const edits: Edit[] = [];
    for (const k of this.burning.keys()) { const [x, y, z] = k.split(',').map(Number); if (fam(this.h.get(x, y, z)) === 'fire') edits.push({ x, y, z, block: Block.Air }); }
    this.h.setMany(edits);
    this.burning.clear();
  }
  cleanup(): void { this.burning.clear(); }
  private ignite(x: number, y: number, z: number): boolean {
    const key = `${x},${y},${z}`;
    if (this.burning.size >= 400 || this.burning.has(key) || !inCity(x, z)) return false;
    const id = this.h.get(x, y, z);
    if (!FLAMMABLE(id) && !(isAir(id) && this.touchesFuel(x, y, z))) return false;
    this.h.set(x, y, z, VB.fire);
    this.burning.set(key, this.age + 60 + this.int(80));
    return true;
  }
  private touchesFuel(x: number, y: number, z: number): boolean {
    for (const [dx, dy, dz] of [[0, -1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]]) if (FLAMMABLE(this.h.get(x + dx, y + dy, z + dz))) return true;
    return false;
  }
  private spread(): void {
    const fires = [...this.burning.keys()];
    for (let i = fires.length - 1; i > 0; i--) { const j = this.int(i + 1); [fires[i], fires[j]] = [fires[j], fires[i]]; }
    let budget = 48;
    for (const k of fires) {
      if (budget <= 0) break;
      const [x, y, z] = k.split(',').map(Number);
      for (let i = 0; i < 3 && budget > 0; i++) {
        const nx = x + this.int(3) - 1, ny = y + this.int(3) - 1, nz = z + this.int(3) - 1;
        if (this.int(100) < 60 && this.ignite(nx, ny, nz)) budget--;
      }
    }
  }
  private burnOut(): void {
    const edits: Edit[] = [];
    for (const [k, until] of this.burning) {
      if (until > this.age) continue;
      const [x, y, z] = k.split(',').map(Number);
      if (fam(this.h.get(x, y, z)) === 'fire') edits.push({ x, y, z, block: Block.Air });
      this.burning.delete(k);
    }
    this.h.setMany(edits);
  }
}

class ZombieHorde extends Disaster {
  private horde: Entity[] = [];
  private toSpawn = 0;
  start(): void { this.toSpawn = zombieCount(this.h.aliveCount()); this.h.giveCrowbars(); }
  tick(): void {
    if (this.toSpawn > 0 && this.age % 5 === 0) { this.spawn(); this.spawn(); }
    if (this.age % 20 === 0) this.horde = this.horde.filter((m) => !m.dead);
  }
  private spawn(): void {
    const holes = manholes();
    const [hx, hz] = holes[this.int(holes.length)];
    const x = hx + .5, y = CITY.GROUND + 1, z = hz + .5;
    if (!isAir(this.h.get(hx, y, hz)) || isAir(this.h.get(hx, y - 1, hz))) return;
    this.toSpawn--;
    const husk = this.int(3) === 0;
    this.horde.push(this.h.spawnMob(husk ? 'husk' : 'zombie', x, y, z, this.int(6) === 0));
    this.h.fx({ f: 'burst', kind: 'dust', x, y, z, n: 15, color: 0xc6cbce });
  }
  stop(): void { this.cleanup(); this.h.takeCrowbars(); }
  cleanup(): void {
    for (const m of this.horde) if (!m.dead) { this.h.fx({ f: 'burst', kind: 'poof', x: m.x, y: m.y + 1, z: m.z, n: 8 }); this.h.removeMob(m); }
    this.horde = []; this.toSpawn = 0;
  }
}

class LightningStorm extends Disaster {
  private strikes: { x: number; y: number; z: number; hitsAt: number }[] = [];
  tick(): void {
    if (this.age < this.duration - 15 && this.every(lightningEvery(this.h.aliveCount(), this.h.intensity()))) {
      const t = this.pick();
      if (t) this.strikes.push({ ...t, hitsAt: this.age + 15 });
    }
    this.strikes = this.strikes.filter((s) => {
      if (this.age < s.hitsAt) { if (this.age % 2 === 0) this.h.fx({ f: 'burst', kind: 'spark', x: s.x, y: s.y + .5, z: s.z, n: 8 }); return true; }
      this.bolt(s.x, s.y, s.z);
      return false;
    });
  }
  wind(): void { this.tick(); }
  finished(): boolean { return !this.strikes.length; }
  private pick(): { x: number; y: number; z: number } | null {
    const roll = this.int(100);
    const p = this.somePlayer();
    if (p && roll < 70) {
      const high = p.y > CITY.GROUND + 6;
      if (this.h.exposed(p.id) && (high || roll < 55)) return { x: p.x + this.int(3) - 1, y: p.y, z: p.z + this.int(3) - 1 };
    }
    if (roll < 78) return roll < 74 ? { x: CITY.MAST_X + .5, y: MAST_TOP + 1, z: CITY.MAST_Z + .5 } : { x: CITY.TOWER_X + .5, y: CITY.TOWER_ROOF + 1, z: CITY.TOWER_Z + .5 };
    if (roll < 85) {
      const b: Building = BUILDINGS[this.int(BUILDINGS.length)];
      const x = b.x1 + this.int(b.x2 - b.x1 + 1), z = b.z1 + this.int(b.z2 - b.z1 + 1);
      return { x: x + .5, y: this.top(x, z) + 1, z: z + .5 };
    }
    const x = this.randomX(), z = this.randomX();
    return { x: x + .5, y: this.top(x, z) + 1, z: z + .5 };
  }
  private bolt(x: number, y: number, z: number): void {
    this.h.lightning(x, y, z);
    for (const p of this.h.alive()) {
      const d = Math.hypot(p.x - x, p.y - y, p.z - z);
      if (d < 4 && (this.h.exposed(p.id) || d < 1.5)) {
        this.h.hurt(p.id, 14 - d * 2, 'lightning');
        const [fx, fz] = flat(p.x - x, p.z - z, .6, () => this.r());
        this.h.velocity(p.id, fx, .5, fz);
      } else if (d < 3.2) this.h.blame(p.id, 'lightning');
    }
    const bx = Math.floor(x), by = Math.floor(y), bz = Math.floor(z);
    const hit = this.h.get(bx, by - 1, bz);
    if (solid(hit) && fam(hit) !== 'lightning_rod' && this.int(3) === 0) this.h.set(bx, by - 1, bz, VB.blackstone);
    if (isAir(this.h.get(bx, by, bz)) && solid(hit) && this.r() < .5) this.h.set(bx, by, bz, VB.fire);
  }
}

class Blizzard extends Disaster {
  tick(): void {
    for (const p of this.h.alive()) {
      const outside = this.h.exposed(p.id);
      let freeze = this.h.freeze(p.id, 0, 200);
      if (this.h.warm(p.id)) freeze = this.h.freeze(p.id, -1000, 200);
      else if (outside) {
        freeze = this.h.freeze(p.id, 8, 140 + 60);
        if (this.age % 20 === 0 && freeze >= 140) this.h.hurt(p.id, 2.5, 'blizzard');
      }
      if (freeze > 40) this.h.blame(p.id, 'blizzard');
    }
    if (this.age % 2 === 0) this.snowfall();
  }
  private snowfall(): void {
    for (let i = 0; i < 4; i++) {
      const x = this.randomX(), z = this.randomX(), y = this.top(x, z);
      if (y < CITY.GROUND) continue;
      const id = this.h.get(x, y, z), m = VMETA[id];
      if (m?.family === 'snow') { const l = Number(m.state.layers); if (l < 3) this.h.set(x, y, z, stateId('snow', { layers: l + 1 })!); continue; }
      if (y === CITY.GROUND && isRoad(x, z) && this.int(4) === 0) { this.h.set(x, y, z, VB.packed_ice); continue; }
      if (BLOCKS[id]?.fluid?.kind === 'water') { this.h.set(x, y, z, VB.ice); continue; }
      if (isAir(this.h.get(x, y + 1, z)) && solid(id) && BLOCKS[id]?.opaque) this.h.set(x, y + 1, z, stateId('snow', { layers: 1 })!);
    }
  }
}

class GasLeak extends Disaster {
  private leaks: { x: number; y: number; z: number; radius: number; blowsAt: number }[] = [];
  private planned = 0; private total = 0;
  start(): void {
    this.total = gasLeaks(this.h.aliveCount());
    const pz = Math.trunc((CITY.CANOPY_Z1 + CITY.CANOPY_Z2) / 2);
    this.leaks.push({ x: CITY.CANOPY_X1 + 3.5, y: CITY.GROUND + 1, z: pz + .5, radius: 5.5, blowsAt: 10 + 45 });
    this.planned = 1;
  }
  tick(): void {
    const gap = Math.max(20, Math.trunc((this.duration - 45 - 20) / Math.max(1, this.total)));
    if (this.planned < this.total && this.age % gap === 0 && this.age + 45 < this.duration) {
      const b = BUILDINGS[this.int(BUILDINGS.length)];
      const x = this.r() < .5 ? b.x1 + 1 : b.x2 - 1, z = this.r() < .5 ? b.z1 + 1 : b.z2 - 1;
      this.leaks.push({ x: x + .5, y: CITY.GROUND + 1, z: z + .5, radius: 3.5 + this.r() * 2 * Math.min(1.6, this.h.intensity()), blowsAt: this.age + 45 });
      this.planned++;
    }
    this.hiss();
  }
  wind(): void { this.hiss(); }
  finished(): boolean { return !this.leaks.length; }
  private hiss(): void {
    this.leaks = this.leaks.filter((l) => {
      if (this.age < l.blowsAt) {
        if (this.age % 3 === 0) this.h.fx({ f: 'burst', kind: 'gas', x: l.x, y: l.y + .6, z: l.z, n: 10 });
        if (this.age % 15 === 0) this.h.fx({ f: 'sound', s: 'creeper_hiss', x: l.x, y: l.y, z: l.z });
        return true;
      }
      this.h.blameNear(l.x, l.y, l.z, l.radius + 4, 'gas_leak');
      this.h.explode(l.x, l.y, l.z, l.radius * .9, 'gas_leak');
      this.crater(Math.floor(l.x), Math.floor(l.y) + 1, Math.floor(l.z), l.radius, false, VB.blackstone);
      this.scorch(Math.floor(l.x), Math.floor(l.y), Math.floor(l.z), Math.trunc(l.radius) + 2, 5);
      return false;
    });
  }
}

export function createDisaster(kind: DisasterKind, h: DisasterHost, duration: number): Disaster {
  switch (kind) {
    case 'meteors': return new MeteorShower(kind, h, duration);
    case 'tornado': return new Tornado(kind, h, duration);
    case 'flood': return new Flood(kind, h, duration);
    case 'tsunami': return new Tsunami(kind, h, duration);
    case 'acid_rain': return new AcidRain(kind, h, duration);
    case 'earthquake': return new Earthquake(kind, h, duration);
    case 'sinkholes': return new Sinkholes(kind, h, duration);
    case 'wildfire': return new Wildfire(kind, h, duration);
    case 'zombies': return new ZombieHorde(kind, h, duration);
    case 'lightning': return new LightningStorm(kind, h, duration);
    case 'blizzard': return new Blizzard(kind, h, duration);
    case 'gas_leak': return new GasLeak(kind, h, duration);
  }
}
