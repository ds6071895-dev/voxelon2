// Disaster City's map: the plugin's CityBuilder, line for line, writing into
// a Deco with the same fixed seed (java.util.Random through JavaRandom), so
// every building, car, tree and paving stone matches. One fixed city; every
// match gets a fresh copy (its own world), so no repair pass is needed.

import { VenueGenerator, registerWorldKind } from './multiverse';
import { Canvas, type VenueStamp } from './vanilla/stamp';
import { Deco, E, N, S, W, finishShapes, opposite } from './vanilla/deco';
import {
  APARTMENTS, BUILDINGS, CITY, DINER, FIRE_STATION, GARAGE, GAS_STORE, HOSE_TOWER, HOUSE, MAST_TOP, OFFICE, SHOPS, SKYSCRAPER,
  bcx, bcz, buildingAt, isRoad, lotIndex, manholes, overSubway, type Building,
} from './disaster_rules';

const GROUND = CITY.GROUND;
export const CITY_SEED = 0xD15A57E2n;
export const CITY_BOUNDS = { minX: CITY.MIN - 6, maxX: CITY.MAX + 6, minY: 50, maxY: 130, minZ: CITY.MIN - 6, maxZ: CITY.MAX + 6 };

class CityBuilder {
  constructor(private readonly d: Deco) {}
  build(): void {
    this.ground(); this.roads(); this.subway(); this.plaza(); this.skyscraper(); this.office(); this.apartments(); this.shops();
    this.garage(); this.gasStation(); this.fireStation(); this.southEast(); this.greenery(); this.lamps(); this.cars(); this.edge();
    this.interiorLights();
  }
  /** Not in the plugin: its rooms were lit only through the windows, so deep
   *  floors read as caves. Hanging lanterns on a grid under every ceiling
   *  with headroom to spare. Runs last and draws no random numbers, so the
   *  seeded layout above is unchanged. */
  private interiorLights(): void {
    const d = this.d, SPACING = 6;
    const grid = (a: number, b: number): number[] => {
      const n = Math.max(1, Math.round((b - a) / SPACING));
      return Array.from({ length: n }, (_, i) => a + Math.round((i + .5) * (b - a) / n));
    };
    for (const b of BUILDINGS) {
      if (b === HOSE_TOWER) continue; // a ladder shaft, lit by its windows
      for (const x of grid(b.x1, b.x2)) for (const z of grid(b.z1, b.z2)) {
        for (let y = GROUND + 3; y < b.roof; y++) {
          if (d.empty(x, y, z) && !d.empty(x, y + 1, z) && d.empty(x, y - 1, z) && d.empty(x, y - 2, z)) d.lantern(x, y, z, true);
        }
      }
    }
  }
  private ground(): void {
    for (let x = CITY.MIN; x <= CITY.MAX; x++) for (let z = CITY.MIN; z <= CITY.MAX; z++) {
      this.d.set(x, GROUND - 2, z, 'stone');
      this.d.set(x, GROUND - 1, z, 'stone');
      this.d.set(x, GROUND, z, isRoad(x, z) ? this.asphalt() : 'smooth_stone');
    }
  }
  private asphalt(): string { return this.d.random.nextInt(9) === 0 ? 'gray_concrete' : 'black_concrete'; }
  private roads(): void {
    const d = this.d;
    for (let a = CITY.MIN; a <= CITY.MAX; a++) {
      let crossing = false;
      for (const c of CITY.ROAD_CENTRES) crossing ||= Math.abs(a - c) <= 3;
      const dash = ((a % 4) + 4) % 4 < 2;
      for (const c of CITY.ROAD_CENTRES) {
        if (!crossing && isRoad(c, a) && lotIndex(a) >= 0 && dash) d.set(c, GROUND, a, 'yellow_concrete');
        if (!crossing && isRoad(a, c) && lotIndex(a) >= 0 && dash) d.set(a, GROUND, c, 'yellow_concrete');
      }
      for (const c of [CITY.RING_LOW, CITY.RING_HIGH]) {
        if (dash && a > CITY.MIN + 4 && a < CITY.MAX - 4) { d.set(c, GROUND, a, 'white_concrete'); d.set(a, GROUND, c, 'white_concrete'); }
      }
    }
    for (const cx of CITY.ROAD_CENTRES) for (const cz of CITY.ROAD_CENTRES) for (let s = -3; s <= 3; s += 2) for (let k = 4; k <= 5; k++) {
      d.set(cx + s, GROUND, cz - k, 'white_concrete'); d.set(cx + s, GROUND, cz + k, 'white_concrete');
      d.set(cx - k, GROUND, cz + s, 'white_concrete'); d.set(cx + k, GROUND, cz + s, 'white_concrete');
    }
    for (const [x, z] of manholes()) d.trapdoor(x, GROUND, z, 'iron_trapdoor', N, true, false);
  }
  private edge(): void {
    for (let a = CITY.MIN; a <= CITY.MAX; a++) {
      this.d.set(a, GROUND + 1, CITY.MIN, 'stone_brick_wall'); this.d.set(a, GROUND + 1, CITY.MAX, 'stone_brick_wall');
      this.d.set(CITY.MIN, GROUND + 1, a, 'stone_brick_wall'); this.d.set(CITY.MAX, GROUND + 1, a, 'stone_brick_wall');
    }
  }
  private greenery(): void {
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
      if (i === 1 && j === 1) continue;
      const m = CITY.LOT_MIN[i], n = CITY.LOT_MIN[j];
      for (const [cx, cz] of [[m + 2, n + 2], [m + 21, n + 2], [m + 2, n + 21], [m + 21, n + 21]]) {
        if (this.clearAround(cx, cz, 2, 7)) {
          this.d.set(cx, GROUND, cz, 'grass_block');
          this.d.tree(cx, GROUND + 1, cz, 3, 1.8, 'birch_log', 'birch_leaves');
        }
      }
    }
  }
  private clearAround(cx: number, cz: number, r: number, height: number): boolean {
    for (let x = cx - r; x <= cx + r; x++) for (let z = cz - r; z <= cz + r; z++) {
      if (overSubway(x, z) || buildingAt(x, z)) return false;
      for (let y = GROUND + 1; y <= GROUND + height; y++) if (!this.d.empty(x, y, z)) return false;
    }
    return true;
  }
  private lamps(): void {
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
      const m = CITY.LOT_MIN[i], n = CITY.LOT_MIN[j], mid = CITY.LOT / 2 - 1;
      this.lamp(m, n + mid, W); this.lamp(m + CITY.LOT - 1, n + mid, E);
      this.lamp(m + mid, n, N); this.lamp(m + mid, n + CITY.LOT - 1, S);
    }
  }
  private lamp(x: number, z: number, arm: string): void {
    if (!this.d.empty(x, GROUND + 1, z)) return;
    this.d.streetLamp(x, GROUND + 1, z, 5, 'andesite_wall', 'iron_bars', arm);
  }
  private cars(): void {
    this.car(-18, -32, false, 'red_concrete'); this.car(13, 26, false, 'blue_concrete');
    this.car(-30, -15, true, 'yellow_concrete'); this.car(24, 16, true, 'white_concrete');
    this.car(-47 + 1, -22, false, 'lime_concrete'); this.car(30, 45, true, 'orange_concrete');
    this.car(-6, -47 + 1, true, 'light_blue_concrete'); this.car(44, 30, false, 'black_concrete');
  }
  private car(x: number, z: number, alongX: boolean, body: string): void {
    for (let a = 0; a < 4; a++) for (let b = 0; b < 2; b++) {
      const px = x + (alongX ? a : b), pz = z + (alongX ? b : a);
      this.d.set(px, GROUND + 1, pz, body);
      if (a === 1 || a === 2) this.d.set(px, GROUND + 2, pz, 'glass');
    }
  }
  private subway(): void {
    const d = this.d;
    const x1 = CITY.SUBWAY_X1, x2 = CITY.SUBWAY_X2, z1 = CITY.SUBWAY_Z1, z2 = CITY.SUBWAY_Z2, floor = CITY.SUBWAY_FLOOR, top = CITY.SUBWAY_TOP;
    d.fill(x1 - 1, floor - 1, z1 - 1, x2 + 1, top, z2 + 1, 'stone_bricks');
    d.fill(x1, floor, z1, x2, floor, z2, 'smooth_stone');
    d.fill(x1, floor + 1, z1, x2, top, z2, 'air');
    for (let x = x1; x <= x2; x++) {
      d.set(x, floor, z1 + 2, 'yellow_concrete');
      d.set(x, floor, z1, 'polished_andesite');
      if (((x % 6) + 6) % 6 === 0) d.set(x, GROUND - 2, Math.trunc((z1 + z2) / 2), 'sea_lantern');
      if (((x % 12) + 12) % 12 === 3) {
        d.set(x, floor + 1, z2, 'spruce_planks');
        d.stairs(x + 1, floor + 1, z2, 'spruce_stairs', S, false);
        d.stairs(x - 1, floor + 1, z2, 'spruce_stairs', S, false);
      }
    }
    for (let x = -12; x <= 2; x++) {
      for (let y = floor + 1; y <= floor + 3; y++) {
        const window = y === floor + 2 && ((x % 3) + 3) % 3 !== 0;
        d.set(x, y, z1, window ? 'glass' : 'iron_block');
      }
      d.set(x, floor + 4, z1, 'smooth_stone_slab');
    }
    for (const [a, b] of CITY.SUBWAY_STAIRS) this.stairwell(a, b);
  }
  private stairwell(sx1: number, sx2: number): void {
    const d = this.d, floor = CITY.SUBWAY_FLOOR, topZ = CITY.STAIR_TOP_Z;
    d.fill(sx1 - 1, floor - 1, CITY.SUBWAY_Z2 + 1, sx2 + 1, GROUND - 1, topZ + 1, 'stone_bricks');
    for (let i = 0; i <= 7; i++) {
      const z = topZ - i;
      for (let x = sx1; x <= sx2; x++) {
        if (i < 7) d.stairs(x, GROUND - 1 - i, z, 'stone_brick_stairs', S, false);
        else d.set(x, floor, z, 'smooth_stone');
        for (let y = GROUND - i; y <= GROUND; y++) d.air(x, y, z);
      }
    }
    d.fill(sx1, floor + 1, CITY.SUBWAY_Z2 + 1, sx2, floor + 4, CITY.SUBWAY_Z2 + 1, 'air');
    for (let z = CITY.SUBWAY_Z2 + 1; z <= topZ; z++) { d.set(sx1 - 1, GROUND + 1, z, 'iron_bars'); d.set(sx2 + 1, GROUND + 1, z, 'iron_bars'); }
    for (let x = sx1 - 1; x <= sx2 + 1; x++) { d.set(x, GROUND + 1, CITY.SUBWAY_Z2 + 1, 'iron_bars'); d.set(x, GROUND + 4, topZ + 1, 'green_concrete'); }
    d.column(sx1 - 1, GROUND + 1, topZ + 1, 3, 'green_concrete');
    d.column(sx2 + 1, GROUND + 1, topZ + 1, 3, 'green_concrete');
    d.set(Math.trunc((sx1 + sx2) / 2), GROUND + 5, topZ + 1, 'sea_lantern');
  }
  private plaza(): void {
    const d = this.d, m = CITY.LOT_MIN[1];
    for (let x = m; x < m + CITY.LOT; x++) for (let z = m; z < m + CITY.LOT; z++) {
      const r = Math.hypot(x - CITY.PLAZA_X, z - CITY.PLAZA_Z);
      const paving = r > 9.5 ? 'smooth_stone' : ((Math.floor(r + .5) % 3) + 3) % 3 === 0 ? 'polished_diorite' : 'polished_andesite';
      d.set(x, GROUND, z, paving);
    }
    d.fountain(CITY.PLAZA_X, GROUND + 1, CITY.PLAZA_Z, 3);
    for (const [tx, tz] of [[-9, -9], [8, -9], [-9, 8], [8, 8]]) {
      d.set(tx, GROUND, tz, 'grass_block');
      d.tree(tx, GROUND + 1, tz, 4, 2.3, 'oak_log', 'oak_leaves');
    }
    this.bench(0, 10, true, N); this.bench(0, -11, true, S); this.bench(10, 0, false, W); this.bench(-11, 0, false, E);
  }
  private bench(x: number, z: number, alongX: boolean, faceTo: string): void {
    for (let i = -1; i <= 1; i++) this.d.stairs(x + (alongX ? i : 0), GROUND + 1, z + (alongX ? 0 : i), 'spruce_stairs', opposite(faceTo), false);
  }
  private shell(b: Building, floorH: number, wall: string, frame: string, window: string, floor: string, roof: string, curtain: boolean, ...doors: string[]): void {
    const d = this.d, floors = Math.trunc((b.roof - GROUND) / floorH);
    for (let k = 0; k < floors; k++) {
      const y = GROUND + k * floorH;
      d.fill(b.x1, y, b.z1, b.x2, y, b.z2, floor);
      d.walls(b.x1, y + 1, b.z1, b.x2, y + floorH - 1, b.z2, wall);
      if (k > 0) d.walls(b.x1, y, b.z1, b.x2, y, b.z2, frame);
      const from = curtain ? y + 1 : y + 2, to = curtain ? y + floorH - 1 : y + floorH - 2;
      for (let x = b.x1 + 1; x < b.x2; x++) if (windowColumn(x - b.x1, curtain)) for (let wy = from; wy <= to; wy++) { d.set(x, wy, b.z1, window); d.set(x, wy, b.z2, window); }
      for (let z = b.z1 + 1; z < b.z2; z++) if (windowColumn(z - b.z1, curtain)) for (let wy = from; wy <= to; wy++) { d.set(b.x1, wy, z, window); d.set(b.x2, wy, z, window); }
    }
    for (const [cx, cz] of [[b.x1, b.z1], [b.x2, b.z1], [b.x1, b.z2], [b.x2, b.z2]]) d.column(cx, GROUND + 1, cz, b.roof - GROUND - 1, frame);
    d.fill(b.x1, b.roof, b.z1, b.x2, b.roof, b.z2, roof);
    d.walls(b.x1, b.roof + 1, b.z1, b.x2, b.roof + 1, b.z2, frame);
    for (const side of doors) this.doorway(b, side);
    this.ladderShaft(b, frame);
  }
  private ladderShaft(b: Building, backing: string): void {
    const lx = b.x1 + 1, lz = b.z1 + 1;
    for (let y = GROUND + 1; y <= b.roof; y++) { this.d.set(b.x1, y, lz, backing); this.d.ladder(lx, y, lz, E); }
  }
  private doorway(b: Building, side: string): void {
    const cx = bcx(b), cz = bcz(b);
    for (let i = 0; i <= 1; i++) for (let y = GROUND + 1; y <= GROUND + 3; y++) {
      if (side === N) this.d.air(cx + i, y, b.z1);
      else if (side === S) this.d.air(cx + i, y, b.z2);
      else if (side === W) this.d.air(b.x1, y, cz + i);
      else this.d.air(b.x2, y, cz + i);
    }
  }
  private furnish(b: Building, floorY: number, palette: string[], carpet: string | null): void {
    const d = this.d;
    for (let x = b.x1 + 1; x < b.x2; x++) for (let z = b.z1 + 1; z < b.z2; z++) {
      const wallSide = x === b.x1 + 1 || x === b.x2 - 1 || z === b.z1 + 1 || z === b.z2 - 1;
      if (Math.abs(x - (b.x1 + 1)) + Math.abs(z - (b.z1 + 1)) <= 3 || this.nearDoor(b, x, z)) continue;
      if (!d.empty(x, floorY + 1, z)) continue;
      if (wallSide && d.random.nextInt(3) === 0) d.set(x, floorY + 1, z, palette[d.random.nextInt(palette.length)]);
      else if (carpet !== null && !wallSide && d.random.nextInt(4) === 0) d.set(x, floorY + 1, z, `${carpet}_carpet`);
    }
  }
  private nearDoor(b: Building, x: number, z: number): boolean { return Math.abs(x - bcx(b)) <= 2 || Math.abs(z - bcz(b)) <= 2; }
  private skyscraper(): void {
    const b = SKYSCRAPER, d = this.d;
    this.shell(b, 4, 'gray_concrete', 'gray_concrete', 'light_blue_stained_glass', 'white_concrete', 'gray_concrete', true, S, E);
    for (let k = 0; k < Math.trunc((b.roof - GROUND) / 4); k++) this.furnish(b, GROUND + k * 4, ['quartz_block', 'crafting_table', 'bookshelf'], k % 2 === 0 ? 'gray' : null);
    const cx = bcx(b), cz = bcz(b), y = b.roof;
    d.ring(cx, y, cz, 5, 5.6, 'white_concrete');
    for (let z = cz - 3; z <= cz + 3; z++) { d.set(cx - 2, y, z, 'yellow_concrete'); d.set(cx + 2, y, z, 'yellow_concrete'); }
    for (let x = cx - 1; x <= cx + 1; x++) d.set(x, y, cz, 'yellow_concrete');
    for (const [x, z] of [[b.x1 + 1, b.z2 - 1], [b.x2 - 1, b.z1 + 1], [b.x2 - 1, b.z2 - 1]]) d.set(x, y, z, 'sea_lantern');
  }
  private office(): void {
    const b = OFFICE, d = this.d;
    this.shell(b, 4, 'quartz_block', 'smooth_stone', 'gray_stained_glass', 'light_gray_concrete', 'smooth_stone', false, S, N);
    for (let k = 0; k < Math.trunc((b.roof - GROUND) / 4); k++) this.furnish(b, GROUND + k * 4, ['crafting_table', 'bookshelf', 'loom'], 'light_gray');
    d.fill(CITY.MAST_X - 1, b.roof + 1, CITY.MAST_Z - 1, CITY.MAST_X + 1, b.roof + 2, CITY.MAST_Z + 1, 'iron_block');
    for (let y = b.roof + 3; y < MAST_TOP; y++) d.set(CITY.MAST_X, y, CITY.MAST_Z, y % 4 === 0 ? 'red_stained_glass' : 'iron_bars');
    d.data(CITY.MAST_X, MAST_TOP, CITY.MAST_Z, 'lightning_rod[facing=up]');
  }
  private apartments(): void {
    const b = APARTMENTS, d = this.d;
    this.shell(b, 4, 'bricks', 'stone_bricks', 'glass', 'oak_planks', 'stone_bricks', false, S, W);
    const carpets = ['red', 'blue', 'green', 'brown'];
    for (let k = 0; k < Math.trunc((b.roof - GROUND) / 4); k++) this.furnish(b, GROUND + k * 4, ['bookshelf', 'red_wool', 'barrel', 'crafting_table', 'white_wool'], carpets[k % carpets.length]);
    const y = b.roof + 1;
    d.fill(b.x2 - 4, y, b.z2 - 4, b.x2 - 2, y + 1, b.z2 - 3, 'iron_block');
    d.fill(bcx(b) - 1, y, bcz(b) - 1, bcx(b) + 1, y, bcz(b), 'light_gray_concrete');
  }
  private shops(): void {
    const b = SHOPS, d = this.d;
    this.shell(b, 5, 'bricks', 'dark_oak_planks', 'glass', 'oak_planks', 'stone_bricks', false);
    const awnings = ['red', 'green', 'blue'];
    const starts = [b.z1 + 1, b.z1 + 6, b.z1 + 10], ends = [b.z1 + 4, b.z1 + 8, b.z2 - 1];
    for (let s = 0; s < 3; s++) {
      const doorZ = Math.trunc((starts[s] + ends[s]) / 2);
      for (let z = starts[s]; z <= ends[s]; z++) {
        for (let y = GROUND + 1; y <= GROUND + 3; y++) d.set(b.x2, y, z, Math.abs(z - doorZ) <= 0 ? 'air' : 'glass');
        d.set(b.x2 + 1, GROUND + 4, z, `${awnings[s]}_wool`);
      }
      d.air(b.x2, GROUND + 1, doorZ + 1); d.air(b.x2, GROUND + 2, doorZ + 1);
      if (s < 2) {
        const wz = ends[s] + 1;
        for (let x = b.x1 + 1; x < b.x2; x++) for (let y = GROUND + 1; y <= GROUND + 4; y++) d.set(x, y, wz, x <= b.x1 + 2 && y <= GROUND + 2 ? 'air' : 'bricks');
      }
    }
    this.furnish(b, GROUND, ['barrel', 'bookshelf', 'smoker', 'cake'], null);
    this.furnish(b, GROUND + 5, ['bookshelf', 'white_wool', 'crafting_table'], 'orange');
    for (let s = 0; s < 3; s++) d.set(b.x2 - 3, GROUND + 1, starts[s], 'spruce_planks');
  }
  private garage(): void {
    const b = GARAGE, d = this.d;
    const decks = [GROUND, GROUND + 4, GROUND + 8, GROUND + 12];
    for (let i = 1; i < decks.length; i++) {
      d.fill(b.x1, decks[i], b.z1, b.x2, decks[i], b.z2, 'light_gray_concrete');
      d.walls(b.x1, decks[i] + 1, b.z1, b.x2, decks[i] + 1, b.z2, 'smooth_stone_slab');
    }
    d.fill(b.x1, GROUND, b.z1, b.x2, GROUND, b.z2, 'gray_concrete');
    for (const x of [b.x1, b.x1 + 5, b.x1 + 10, b.x1 + 15, b.x2]) for (const z of [b.z1, b.z1 + 5, b.z1 + 10, b.z1 + 15, b.z2]) d.column(x, GROUND + 1, z, 11, 'stone_bricks');
    for (let level = 0; level < 3; level++) {
      const base = decks[level];
      const za = level % 2 === 0 ? b.z1 + 1 : b.z2 - 2;
      for (let z = za; z <= za + 1; z++) {
        for (let x = b.x1 + 1; x <= b.x1 + 4; x++) { d.air(x, base + 4, z); d.air(x, base + 5, z); }
        for (let i = 0; i < 4; i++) {
          d.stairs(b.x1 + 2 + i, base + 1 + i, z, 'stone_brick_stairs', E, false);
          for (let below = base + 1; below < base + 1 + i; below++) d.set(b.x1 + 2 + i, below, z, 'stone_bricks');
        }
      }
    }
    this.car(b.x1 + 8, b.z1 + 6, true, 'purple_concrete');
    this.car(b.x1 + 12, b.z2 - 7, true, 'cyan_concrete');
    this.carOn(b.x1 + 9, decks[1], b.z1 + 2, 'green_concrete');
    this.carOn(b.x1 + 13, decks[2], b.z2 - 6, 'red_concrete');
    this.carOn(b.x1 + 7, decks[3], b.z1 + 8, 'white_concrete');
  }
  private carOn(x: number, deck: number, z: number, body: string): void {
    for (let a = 0; a < 4; a++) for (let b = 0; b < 2; b++) {
      this.d.set(x + a, deck + 1, z + b, body);
      if (a === 1 || a === 2) this.d.set(x + a, deck + 2, z + b, 'glass');
    }
  }
  private gasStation(): void {
    const d = this.d;
    const x1 = CITY.CANOPY_X1, x2 = CITY.CANOPY_X2, z1 = CITY.CANOPY_Z1, z2 = CITY.CANOPY_Z2, y = CITY.CANOPY_Y;
    d.fill(x1, y, z1, x2, y, z2, 'white_concrete');
    d.walls(x1, y, z1, x2, y, z2, 'red_concrete');
    for (const [px, pz] of [[x1 + 1, z1 + 1], [x2 - 1, z1 + 1], [x1 + 1, z2 - 1], [x2 - 1, z2 - 1]]) d.column(px, GROUND + 1, pz, y - GROUND - 1, 'smooth_quartz');
    const pz = Math.trunc((z1 + z2) / 2);
    for (const px of [x1 + 3, x2 - 3]) {
      d.fill(px - 1, GROUND + 1, pz - 2, px + 1, GROUND + 1, pz + 2, 'smooth_stone_slab');
      d.set(px, GROUND + 1, pz, 'iron_block');
      d.set(px, GROUND + 2, pz, 'red_concrete');
      d.data(px, GROUND + 3, pz, 'lantern[hanging=false]');
    }
    this.shell(GAS_STORE, 5, 'white_concrete', 'red_concrete', 'glass', 'spruce_planks', 'red_concrete', false, N);
    this.furnish(GAS_STORE, GROUND, ['barrel', 'bookshelf', 'spruce_planks'], null);
  }
  private fireStation(): void {
    const b = FIRE_STATION, d = this.d;
    this.shell(b, 5, 'red_terracotta', 'white_terracotta', 'glass', 'smooth_stone', 'white_terracotta', false, S);
    d.fill(b.x1 + 1, GROUND + 5, b.z1 + 1, b.x2 - 1, GROUND + 5, b.z2 - 1, 'oak_planks');
    d.ladder(b.x1 + 1, GROUND + 5, b.z1 + 1, E);
    this.furnish(b, GROUND + 5, ['red_wool', 'bookshelf', 'barrel'], 'red');
    for (let x = b.x1 + 3; x <= b.x1 + 8; x++) for (let y = GROUND + 1; y <= GROUND + 4; y++) d.air(x, y, b.z1);
    for (let z = b.z1 + 2; z <= b.z1 + 7; z++) {
      for (let x = b.x1 + 4; x <= b.x1 + 6; x++) {
        d.set(x, GROUND + 1, z, 'red_concrete');
        if (z <= b.z1 + 3) d.set(x, GROUND + 2, z, x === b.x1 + 5 ? 'red_concrete' : 'glass');
      }
      d.set(b.x1 + 5, GROUND + 2, z, 'red_concrete');
    }
    d.set(b.x1 + 5, GROUND + 3, b.z1 + 2, 'redstone_lamp');
    this.hoseTower();
  }
  private hoseTower(): void {
    const t = HOSE_TOWER, d = this.d;
    d.fill(t.x1, GROUND, t.z1, t.x2, GROUND, t.z2, 'smooth_stone');
    d.walls(t.x1, GROUND + 1, t.z1, t.x2, t.roof - 1, t.z2, 'red_terracotta');
    for (let y = GROUND + 4; y < t.roof; y += 4) { d.set(t.x2, y, bcz(t), 'glass'); d.set(bcx(t) + 1, y, t.z1, 'glass'); }
    d.fill(t.x1, t.roof, t.z1, t.x2, t.roof, t.z2, 'white_terracotta');
    for (let y = GROUND + 1; y <= GROUND + 3; y++) { d.air(t.x2, y, t.z1 + 1); d.air(t.x2, y, t.z1 + 2); }
    for (let y = GROUND + 1; y <= t.roof; y++) d.ladder(t.x1 + 1, y, t.z1 + 1, E);
    for (let x = t.x1; x <= t.x2; x++) { d.set(x, t.roof + 1, t.z1, 'oak_fence'); d.set(x, t.roof + 1, t.z2, 'oak_fence'); }
    for (let z = t.z1; z <= t.z2; z++) { d.set(t.x1, t.roof + 1, z, 'oak_fence'); d.set(t.x2, t.roof + 1, z, 'oak_fence'); }
    d.bell(bcx(t) + 1, t.roof + 1, bcz(t) + 1);
  }
  private southEast(): void {
    const diner = DINER, d = this.d;
    this.shell(diner, 5, 'white_concrete', 'red_concrete', 'light_blue_stained_glass', 'white_concrete', 'red_concrete', false, N);
    for (let x = diner.x1 + 1; x < diner.x2; x++) {
      for (let z = diner.z1 + 1; z < diner.z2; z++) d.set(x, GROUND, z, (((x + z) % 2) + 2) % 2 === 0 ? 'black_concrete' : 'white_concrete');
      if (x > diner.x1 + 3) d.set(x, GROUND + 1, diner.z2 - 2, 'quartz_block');
    }
    for (let x = diner.x1 + 5; x < diner.x2; x += 2) d.set(x, GROUND + 1, diner.z2 - 4, 'spruce_fence');
    this.house();
    this.waterTower();
  }
  private house(): void {
    const h = HOUSE, d = this.d;
    d.fill(h.x1, GROUND, h.z1, h.x2, GROUND, h.z2, 'spruce_planks');
    d.walls(h.x1, GROUND + 1, h.z1, h.x2, h.roof - 1, h.z2, 'oak_planks');
    for (const [cx, cz] of [[h.x1, h.z1], [h.x2, h.z1], [h.x1, h.z2], [h.x2, h.z2]]) for (let y = GROUND + 1; y < h.roof; y++) d.log(cx, y, cz, 'spruce_log', 'y');
    for (let z = h.z1 + 2; z <= h.z2 - 2; z += 3) { d.set(h.x2, GROUND + 2, z, 'glass'); d.set(h.x1, GROUND + 3, z, 'glass'); }
    d.fill(h.x1, h.roof, h.z1, h.x2, h.roof, h.z2, 'spruce_planks');
    d.gableRoof(h.x1 - 1, h.z1 - 1, h.x2 + 1, h.z2 + 1, h.roof + 1, 'dark_oak_stairs', 'dark_oak_planks', 'oak_planks', true);
    d.door(h.x1, GROUND + 1, bcz(h), 'oak_door', W, false, true);
    d.set(h.x1 + 1, GROUND + 1, h.z2 - 1, 'red_wool'); d.set(h.x1 + 2, GROUND + 1, h.z2 - 1, 'red_wool');
    d.set(h.x2 - 1, GROUND + 1, h.z1 + 1, 'bookshelf'); d.set(h.x2 - 1, GROUND + 1, h.z1 + 2, 'crafting_table');
    d.set(bcx(h), GROUND + 1, bcz(h), 'brown_carpet');
  }
  private waterTower(): void {
    const d = this.d, cx = CITY.TOWER_X, cz = CITY.TOWER_Z, floor = CITY.TOWER_FLOOR, roof = CITY.TOWER_ROOF;
    for (const [lx, lz] of [[3, 0], [-3, 0], [0, 3], [0, -3]]) for (let y = GROUND + 1; y < floor; y++) d.log(cx + lx, y, cz + lz, 'stripped_spruce_log', 'y');
    d.disc(cx, floor, cz, 3, 'spruce_planks');
    for (let y = floor + 1; y < roof; y++) d.ring(cx, y, cz, 2.6, 3, 'spruce_planks');
    d.disc(cx, roof, cz, 3, 'dark_oak_planks');
    for (let y = GROUND + 1; y <= roof; y++) d.ladder(cx + 4, y, cz, E);
  }
}
function windowColumn(offset: number, curtain: boolean): boolean { return curtain ? offset % 4 !== 0 : offset % 3 !== 0; }

let built: VenueStamp | null = null;
/** The city, built once per process. */
export function cityStamp(): VenueStamp {
  if (built) return built;
  const canvas = new Canvas(CITY_BOUNDS);
  new CityBuilder(new Deco(canvas, 0, 0, 0, CITY_SEED)).build();
  finishShapes(canvas);
  built = canvas.pack();
  return built;
}

registerWorldKind('disaster', () => {
  const s = cityStamp();
  return new VenueGenerator(0, { minX: CITY_BOUNDS.minX, maxX: CITY_BOUNDS.maxX + 1, minZ: CITY_BOUNDS.minZ, maxZ: CITY_BOUNDS.maxZ + 1 },
    CITY_BOUNDS.minY, CITY_BOUNDS.maxY, (x, y, z) => s.get(x, y, z),
    { grass: [.49, .74, .42], foliage: [.35, .68, .19], water: [.25, .46, .89] });
}, true);
