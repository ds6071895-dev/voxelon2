// Treasure Cove (source games/TreasureCove): dig up a pirate beach for buried
// gems (emerald 1, gold 2, diamond 3). TNT traps launch you and cost a point.
// The field is split into four quarters holding the same loot, and the
// hot/cold reading tells you how close the nearest treasure is.

import { Deco, E, W } from '../vanilla/deco';
import { vi } from '../vanilla/items';
import { mc } from '../vanilla/mc_materials';
import { scaleInt, fmt } from '../minigames_rules';
import { Minigame, type Spot } from './game';
import { noise } from './buildings';
import { BASE_Y, type ArenaDef } from './arena';

export const HALF = 10, DEPTH = 3;
type Loot = 'EMERALD' | 'GOLD' | 'DIAMOND' | 'TRAP';
const LOOT: Record<Loot, { points: number; block: string; color: string; label: string }> = {
  EMERALD: { points: 1, block: 'emerald_block', color: '#1f9d5b', label: 'Emerald' },
  GOLD: { points: 2, block: 'gold_block', color: '#d99a00', label: 'Gold' },
  DIAMOND: { points: 3, block: 'diamond_block', color: '#1fa7c9', label: 'Diamond' },
  TRAP: { points: -1, block: 'tnt', color: '#e5484d', label: 'Trap' },
};
const pack = (x: number, y: number, z: number) => ((x + 64) * 128 + (z + 64)) * 16 + (y + 8);
const unpack = (k: number) => ({ y: (k % 16) - 8, z: (Math.floor(k / 16) % 128) - 64, x: Math.floor(k / 2048) - 64 });

function palm(d: Deco, x: number, z: number, height: number): void {
  for (let y = 1; y <= height; y++) d.log(x, y, z, 'jungle_log', 'y');
  const top = height + 1;
  d.leaves(x, top, z, 'jungle_leaves');
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) for (let i = 1; i <= 3; i++) d.leaves(x + dx * i, top - (i === 3 ? 1 : 0), z + dz * i, 'jungle_leaves');
  for (const [dx, dz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) d.leaves(x + dx, top, z + dz, 'jungle_leaves');
}
function shipwreck(d: Deco, x0: number, z0: number): void {
  for (let i = 0; i < 14; i++) {
    const width = i < 2 || i > 11 ? 1 : 2;
    for (let w = -width; w <= width; w++) {
      d.set(x0 + i, 0, z0 + w, 'dark_oak_planks');
      if (Math.abs(w) === width) {
        d.set(x0 + i, 1, z0 + w, 'dark_oak_planks');
        if (i % 4 !== 1) d.set(x0 + i, 2, z0 + w, 'dark_oak_planks');
      }
    }
  }
  d.stairs(x0 - 1, 1, z0, 'dark_oak_stairs', E, false);
  d.stairs(x0 + 14, 1, z0, 'dark_oak_stairs', W, false);
  for (let y = 1; y <= 9; y++) d.log(x0 + 6, y, z0, 'stripped_dark_oak_log', 'y');
  for (let z = -3; z <= 3; z++) d.log(x0 + 6, 8, z0 + z, 'stripped_dark_oak_log', 'z');
  for (let z = -3; z <= 2; z++) for (let y = 4; y <= 7; y++) if (z + y < 8) d.data(x0 + 7, y, z0 + z, 'white_wool');
  d.data(x0 + 3, 1, z0, 'chest[facing=north,type=single]');
  d.barrel(x0 + 10, 1, z0, E);
  d.lantern(x0 + 6, 10, z0, false);
}
function lighthouse(d: Deco, x: number, z: number): void {
  for (let y = 1; y <= 20; y++) {
    const r = 3.2 - y * .06;
    for (let dx = -4; dx <= 4; dx++) for (let dz = -4; dz <= 4; dz++) {
      const dist = Math.hypot(dx, dz);
      if (dist <= r + .5) d.set(x + dx, y, z + dz, dist > r - .6 ? (Math.floor(y / 3) % 2 === 0 ? 'red_concrete' : 'white_concrete') : 'air');
    }
  }
  d.disc(x, 21, z, 3.5, 'smooth_stone');
  for (let y = 22; y <= 24; y++) for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) {
    const edge = Math.abs(dx) === 2 || Math.abs(dz) === 2;
    if (edge && Math.abs(dx) === 2 && Math.abs(dz) === 2) d.set(x + dx, y, z + dz, 'iron_block');
    else if (edge) d.set(x + dx, y, z + dz, 'glass_pane');
  }
  d.set(x, 22, z, 'sea_lantern');
  d.set(x, 23, z, 'glowstone');
  d.hipRoof(x - 3, z - 3, x + 3, z + 3, 25, 'red_nether_brick_stairs', 'red_nether_bricks');
  d.door(x - 3, 1, z, 'spruce_door', W, false, false);
}

export const TREASURE_ARENA: ArenaDef = {
  id: 'treasure',
  build(d) {
    const R = 40;
    for (let x = -R; x <= R; x++) for (let z = -R; z <= R; z++) {
      const r = Math.sqrt(x * x + z * z);
      if (r > R + .5) continue;
      const shore = 24 + 3 * Math.sin(Math.atan2(z, x) * 3);
      d.set(x, -4, z, 'sandstone');
      if (r < shore) {
        for (let y = -3; y <= 0; y++) d.set(x, y, z, y === 0 ? (noise(x, z) < .05 ? 'suspicious_sand' : 'sand') : 'sandstone');
        if (noise(x, z) < .05) d.set(x, 0, z, 'sand');
      } else {
        d.set(x, -3, z, 'sand');
        d.fillData(x, -2, z, x, 0, z, 'water[level=0]');
      }
    }
    d.underside(0, -4, 0, R, 8, 'sandstone', 'stone');
    for (let i = -HALF - 1; i <= HALF; i++) for (const [px, pz] of [[i, -HALF - 1], [i, HALF], [-HALF - 1, i], [HALF, i]]) {
      d.log(px, 0, pz, 'stripped_oak_log', px === -HALF - 1 || px === HALF ? 'z' : 'x');
    }
    shipwreck(d, -20, -14);
    lighthouse(d, 26, 6);
    for (const [px, pz] of [[-14, 14], [14, 16], [16, -14], [-4, -20], [6, 21], [-20, 6]]) palm(d, px, pz, 6);
    for (let z = 22; z <= 32; z++) {
      d.slab(-2, 0, z, 'spruce_slab', true); d.slab(-1, 0, z, 'spruce_slab', true); d.slab(0, 0, z, 'spruce_slab', true);
      if (z % 3 === 0) {
        d.set(-3, 0, z, 'spruce_fence'); d.set(1, 0, z, 'spruce_fence'); d.set(-3, 1, z, 'spruce_fence'); d.set(1, 1, z, 'spruce_fence');
        for (let y = -3; y < 0; y++) { d.set(-3, y, z, 'spruce_log'); d.set(1, y, z, 'spruce_log'); }
      }
    }
    d.lantern(-3, 2, 30, false);
    d.lantern(1, 2, 30, false);
    d.data(-14, 1, -4, 'chest[facing=east,type=single]');
    d.data(13, 1, 8, 'chest[facing=west,type=single]');
    d.barrel(-13, 1, -5, 'up');
    d.barrel(14, 1, 9, 'up');
    d.campfire(10, 1, -14);
    for (const [px, pz] of [[9, -15], [11, -13], [9, -13]]) d.log(px, 1, pz, 'stripped_oak_log', 'x');
  },
  layer(d) {
    for (let x = -HALF; x < HALF; x++) for (let z = -HALF; z < HALF; z++) {
      for (let y = -DEPTH + 1; y <= 0; y++) d.set(x, y, z, y === 0 ? 'sand' : ((x + y + z) & 3) === 0 ? 'gravel' : 'sand');
      d.set(x, -DEPTH, z, 'sandstone');
    }
  },
};

export class TreasureCove extends Minigame {
  readonly id = 'treasure';
  readonly arena = TREASURE_ARENA;
  readonly buried = new Map<number, Loot>();

  spawns(count: number): Spot[] { return this.ring(count, HALF + 3, 1, this.random() * Math.PI * 2); }
  spectate(): Spot { return this.at(.5, 16, 22.5, 0); }

  static findsPerQuarter(players: number): number { return scaleInt(players, 3, 8); }

  setup(players: number[]): void {
    this.buried.clear();
    const per = TreasureCove.findsPerQuarter(players.length);
    const quarter: Loot[] = [];
    for (let i = 0; i < per; i++) quarter.push(i % 4 === 0 ? 'DIAMOND' : i % 2 === 0 ? 'GOLD' : 'EMERALD');
    quarter.push('TRAP');
    if (players.length > 5) quarter.push('TRAP');
    for (let qx = 0; qx < 2; qx++) for (let qz = 0; qz < 2; qz++) {
      const loot = [...quarter];
      for (let i = loot.length - 1; i > 0; i--) { const j = Math.floor(this.random() * (i + 1)); [loot[i], loot[j]] = [loot[j], loot[i]]; }
      for (const item of loot) for (let attempt = 0; attempt < 30; attempt++) {
        const x = -HALF + qx * HALF + Math.floor(this.random() * HALF), z = -HALF + qz * HALF + Math.floor(this.random() * HALF);
        const y = -Math.floor(this.random() * DEPTH);
        const k = pack(x, y, z);
        if (!this.buried.has(k)) { this.buried.set(k, item); break; }
      }
    }
    for (const id of players) this.setSlot(id, 0, { id: vi('iron_shovel'), count: 1, name: "Pirate's Spade", ench: [['efficiency', 5]] });
  }

  inField(x: number, wy: number, z: number): boolean {
    const y = wy - BASE_Y;
    return x >= -HALF && x < HALF && z >= -HALF && z < HALF && y <= 0 && y > -DEPTH;
  }
  onLeftClick(): boolean { return false; }
  canBreak(id: number, x: number, y: number, z: number): boolean { return this.alive.has(id) && this.inField(x, y, z); }
  onBroken(id: number, x: number, wy: number, z: number): void {
    const y = wy - BASE_Y;
    const loot = this.buried.get(pack(x, y, z));
    if (!loot) return;
    this.buried.delete(pack(x, y, z));
    const info = LOOT[loot];
    const at = this.at(x + .5, y + .5, z + .5);
    this.addScore(id, info.points);
    if (loot === 'TRAP') {
      this.m.sim.emit({ f: 'explode', x: at.x, y: at.y, z: at.z, power: 1 });
      this.m.sound('explode', at, 1.2);
      const b = this.m.host.body(id)!;
      let ax = b.x - at.x, az = b.z - at.z;
      if (ax * ax + az * az < .01) { ax = 1; az = 0; }
      const l = Math.hypot(ax, az);
      this.m.host.launch(id, ax / l * .8 * 20, 20, az / l * .8 * 20);
    } else {
      this.m.sim.emit({ f: 'burst', kind: 'gold', x: at.x, y: at.y, z: at.z, n: 12 });
      this.m.sound('levelup', at, 1.2 + info.points * .15);
      this.put(x, y, z, info.block);
      this.m.later(14, () => { if (this.get(x, y, z) === mc(info.block)) this.put(x, y, z, 'air'); });
    }
    this.m.title(id, '', `${info.points > 0 ? `+${info.points}` : '-1'} ${info.label}`, info.color, 1000);
  }

  /** Distance from a point to the nearest gem (depth counts). */
  nearest(x: number, y: number, z: number): number {
    let best = Infinity;
    for (const [k, loot] of this.buried) {
      if (loot === 'TRAP') continue;
      const p = unpack(k);
      best = Math.min(best, Math.hypot(x - (p.x + .5), z - (p.z + .5), y - BASE_Y - (p.y + .5)));
    }
    return best;
  }
  static reading(best: number): string {
    return best < 2 ? 'Scorching' : best < 3.5 ? 'Hot' : best < 6 ? 'Warm' : best === Infinity ? 'All dug up' : 'Cold';
  }
  bar(id: number): string {
    const b = this.m.host.body(id);
    const best = b ? this.nearest(b.x, b.y, b.z) : Infinity;
    return `${TreasureCove.reading(best)}  ·  Score ${fmt(this.scoreOf(id))}`;
  }
  over(): boolean { for (const l of this.buried.values()) if (l !== 'TRAP') return false; return true; }
}
