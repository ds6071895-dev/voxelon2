// Carnival Shootout (source games/CarnivalShootout): a striped-tent shooting
// gallery. Targets pop up on the painted back wall and ducks ride a rail
// across the middle: plain targets 1 point, gold 3, TNT -2, ducks 2 (gold 5).
// Every target counts only for the first arrow to hit it.

import { E, N, W } from '../vanilla/deco';
import { vi } from '../vanilla/items';
import type { Entity } from '../vanilla/entity';
import { scale, scaleInt } from '../minigames_rules';
import { Minigame, type Spot } from './game';
import { noise } from './buildings';
import { BASE_Y, type ArenaDef } from './arena';

export const WALL_Z = -14, DUCK_Z = -6, DECK_Z = 8;
type TargetType = 'gold_block' | 'tnt' | 'target';

export const SHOOTOUT_ARENA: ArenaDef = {
  id: 'shootout',
  version: 2,
  build(d) {
    const R = 36;
    for (let x = -R; x <= R; x++) for (let z = -R; z <= R; z++) {
      if (x * x + z * z > (R + .5) * (R + .5)) continue;
      d.set(x, -1, z, 'dirt');
      d.set(x, 0, z, noise(x, z) < .05 ? 'coarse_dirt' : 'grass_block');
    }
    d.underside(0, -1, 0, R, 9, 'dirt', 'stone');
    for (let x = -15; x <= 15; x++) for (let z = WALL_Z; z <= DECK_Z - 2; z++) d.set(x, 0, z, 'sand');
    for (let x = -16; x <= 16; x++) {
      for (let y = 1; y <= 12; y++) {
        const hill = 3 + 1.6 * Math.sin(x * .35) + Math.cos(x * .21);
        let m = y <= hill ? 'lime_terracotta' : y <= hill + 1 ? 'green_terracotta' : 'light_blue_terracotta';
        if (y >= 9 && y <= 10 && (((x + 4) % 9) + 9) % 9 < 4) m = 'white_terracotta';
        if (Math.hypot(x - 10, y - 9.5) < 1.8) m = 'yellow_concrete';
        d.set(x, y, WALL_Z - 1, m);
        d.set(x, y, WALL_Z - 2, 'spruce_planks');
      }
      d.set(x, 13, WALL_Z - 1, 'glowstone');
    }
    const prizes = ['red_wool', 'pink_wool', 'light_blue_wool', 'yellow_wool', 'cake', 'decorated_pot', 'lime_wool'];
    for (const side of [-1, 1]) {
      const x = side * 16;
      for (let z = WALL_Z - 1; z <= DECK_Z + 4; z++) for (let y = 1; y <= 9; y++) d.set(x, y, z, (z + y) % 7 === 0 ? 'red_wool' : 'white_wool');
      for (let z = DECK_Z - 2; z <= DECK_Z + 4; z++) for (const y of [3, 6]) {
        d.slab(x - side, y, z, 'spruce_slab', true);
        d.data(x - side, y + 1, z, prizes[(((z * 3 + y + side) % prizes.length) + prizes.length) % prizes.length]);
      }
    }
    for (let x = -15; x <= 15; x++) d.set(x, 1, DUCK_Z, 'dark_oak_planks');
    for (let x = -15; x <= 15; x++) {
      d.slab(x, 1, DECK_Z - 1, 'spruce_slab', false);
      for (let z = DECK_Z; z <= DECK_Z + 4; z++) d.set(x, 0, z, 'spruce_planks');
    }
    const stripe = (x: number) => (((x % 4) + 4) % 4 < 2 ? 'red' : 'white') + '_wool';
    for (let x = -16; x <= 16; x++) {
      for (let z = DECK_Z - 2; z <= DECK_Z + 5; z++) d.data(x, 8, z, stripe(x));
      d.data(x, 7, DECK_Z - 2, stripe(x));
    }
    for (let x = -15; x <= 15; x += 6) { d.column(x, 1, DECK_Z + 5, 7, 'spruce_fence'); d.hangingLantern(x, 7, 7, DECK_Z + 2, false); }
    d.column(15, 1, DECK_Z + 5, 7, 'spruce_fence');
    for (let x = -16; x <= 16; x++) d.set(x, 9, WALL_Z - 1, 'white_terracotta');
    for (let x = -16; x <= 16; x++) d.set(x, 1, DECK_Z + 5, 'spruce_planks');
    d.stall(-24, 1, 12, E, 'blue', 'white', 'spruce_fence');
    d.stall(24, 1, 12, W, 'yellow', 'white', 'spruce_fence');
    d.stall(0, 1, 24, N, 'pink', 'white', 'spruce_fence');
    for (const [px, pz] of [[-22, -6], [22, -6], [-12, 20], [12, 20], [-26, 2], [26, 2]]) d.lampPost(px, 1, pz, 3, 'dark_oak_fence', false);
    d.tree(-26, 1, -20, 5, 3, 'oak_log', 'oak_leaves');
    d.tree(26, 1, -20, 5, 3, 'oak_log', 'oak_leaves');
    d.tree(-20, 1, 26, 4, 2.6, 'birch_log', 'birch_leaves');
    d.tree(20, 1, 26, 4, 2.6, 'birch_log', 'birch_leaves');
  },
};

export interface ShootoutView {
  targets: { x: number; y: number; type: TargetType; expires: number }[];
  /** Ducks: x, step direction (blocks per 5 ticks), gold. */
  ducks: { x: number; dir: number; gold: boolean }[];
}

const pack = (x: number, y: number) => (x + 64) * 128 + y;

export class CarnivalShootout extends Minigame {
  readonly id = 'shootout';
  readonly arena = SHOOTOUT_ARENA;
  readonly targets = new Map<number, { x: number; y: number; type: TargetType; expires: number }>();
  /** [x, dir, type] with type 1 gold, 0 plain, -1 hit. */
  readonly ducks: [number, number, number][] = [];
  private nextSpawn = 0;
  private nextDuck = 0;

  spawns(count: number): Spot[] { return this.line(count, -.5, 1, DECK_Z + 1, Math.min(2.4, 22 / Math.max(1, count)), 180); }
  spectate(): Spot { return this.at(.5, 9, 18.5, 0); }

  setup(players: number[]): void {
    this.targets.clear(); this.ducks.length = 0;
    this.nextSpawn = 10; this.nextDuck = 30;
    for (const id of players) {
      this.setSlot(id, 0, { id: vi('bow'), count: 1, name: 'Gallery Bow', ench: [['infinity', 1]] });
      this.setSlot(id, 9, { id: vi('arrow'), count: 1 });
    }
  }

  private roll(): TargetType {
    const r = this.random();
    return r < .20 ? 'gold_block' : r < .30 ? 'tnt' : 'target';
  }
  static targetsPerSpawn(players: number): number { return scaleInt(players, 2, 4); }
  static duckEvery(players: number): number { return scaleInt(players, 25, 12); }

  tick(): void {
    const n = Math.max(1, this.players().length);
    const progress = this.t / (this.seconds * 20);
    if (this.t >= this.nextSpawn) {
      this.nextSpawn = this.t + Math.max(4, Math.floor(scale(n, 18, 7) * (1 - .35 * progress) + .5));
      let spawned = 0;
      const wanted = CarnivalShootout.targetsPerSpawn(n);
      for (let attempt = 0; attempt < 8 * wanted && spawned < wanted; attempt++) {
        const x = -14 + Math.floor(this.random() * 29), y = 2 + Math.floor(this.random() * 9);
        const k = pack(x, y);
        if (this.targets.has(k)) continue;
        const type = this.roll();
        this.targets.set(k, { x, y, type, expires: this.t + 70 + Math.floor(this.random() * 45) - Math.trunc(15 * progress) });
        this.put(x, y, WALL_Z, type);
        spawned++;
      }
    }
    if (this.t >= this.nextDuck) {
      const every = CarnivalShootout.duckEvery(n);
      this.nextDuck = this.t + every + Math.floor(this.random() * (Math.trunc(every * 4 / 5) + 1));
      const left = this.random() < .5;
      this.ducks.push([left ? -15 : 15, left ? 1 : -1, this.random() < .25 ? 1 : 0]);
    }
    if (this.t % 5 === 0) {
      for (let i = this.ducks.length - 1; i >= 0; i--) {
        const duck = this.ducks[i];
        if (duck[2] < 0) { this.ducks.splice(i, 1); continue; }
        this.put(duck[0], 2, DUCK_Z, 'air');
        duck[0] += duck[1];
        if (Math.abs(duck[0]) > 15) { this.ducks.splice(i, 1); continue; }
        this.put(duck[0], 2, DUCK_Z, duck[2] === 1 ? 'gold_block' : 'yellow_wool');
      }
    }
    for (const [k, tg] of [...this.targets]) if (tg.expires <= this.t) { this.put(tg.x, tg.y, WALL_Z, 'air'); this.targets.delete(k); }
  }

  onArrowBlock(e: Entity, x: number, wy: number, z: number): boolean {
    const shooter = e.owner;
    if (shooter === undefined || !this.alive.has(shooter)) return true;
    const y = wy - BASE_Y;
    let points: number;
    const tg = z === WALL_Z ? this.targets.get(pack(x, y)) : undefined;
    if (tg) {
      this.targets.delete(pack(x, y));
      points = tg.type === 'gold_block' ? 3 : tg.type === 'tnt' ? -2 : 1;
    } else if (z === DUCK_Z && y === 2) {
      let duck: [number, number, number] | null = null;
      for (const each of this.ducks) if (each[0] === x && each[2] >= 0) duck = each;
      if (!duck) return true;
      points = duck[2] === 1 ? 5 : 2;
      duck[2] = -1;
    } else return true;
    this.put(x, y, z, 'air');
    this.addScore(shooter, points);
    const at = this.at(x + .5, y + .5, z + .5);
    this.m.sim.emit({ f: 'burst', kind: points < 0 ? 'smoke' : 'firework', x: at.x, y: at.y, z: at.z, n: 10, color: points >= 3 ? 0xffd34d : 0xff5fa2 });
    this.m.sound(points < 0 ? 'explode' : 'hit', at, points >= 3 ? 1.6 : 1.1);
    this.m.bar(shooter, `${points > 0 ? '+' : ''}${points}  (total ${this.scoreOf(shooter)})`, points > 0 ? '#1f9d5b' : '#e5484d');
    return true;
  }

  botView(): ShootoutView {
    return { targets: [...this.targets.values()], ducks: this.ducks.filter((d) => d[2] >= 0).map((d) => ({ x: d[0], dir: d[1], gold: d[2] === 1 })) };
  }

  cleanup(): void {
    for (const tg of this.targets.values()) this.put(tg.x, tg.y, WALL_Z, 'air');
    this.targets.clear();
    for (const d of this.ducks) this.put(d[0], 2, DUCK_Z, 'air');
    this.ducks.length = 0;
    // Arrows stuck in the wall go with the round.
    for (const e of [...this.m.sim.ents.all.values()]) if (e.kind === 'arrow') this.m.sim.ents.remove(e);
    this.flush();
  }
}
