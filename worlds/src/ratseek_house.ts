// Rat and Seek: the Crooked Manor. A block-for-block port of the AutoBox
// plugin's deterministic manor blueprint — four floors of sixteen furnished
// rooms, two stairways, four rat-only service tunnels, the hedge garden,
// greenhouse, waiting booth and the rescue cage — laid out in the same
// coordinates (a Worlds venue can sit anywhere, so nothing is shifted).
//
// Pure: no DOM, no THREE. The client meshes it, the server collides against
// it, and the seeker bots' navigation grid is built from it.

import { Block, MANOR_RUGS } from './blocks';

export const RS_CELLAR = 74, RS_GROUND = 80, RS_UPSTAIRS = 86, RS_ATTIC = 92;

export interface RsPos { x: number; y: number; z: number }
export interface RsRoom { name: string; x1: number; x2: number; y1: number; y2: number; z1: number; z2: number }
export interface RsPassage { name: string; x: number; y: number; z1: number; z2: number; exitA: RsPos; exitB: RsPos }
export interface RsHide { name: string; pos: RsPos }

/** Block positions of the blueprint (the plugin's `Pos`). Feet positions
 *  used for teleports add 0.5 to x and z. */
export const RS_RELEASE: RsPos = { x: 0, y: 81, z: 19 };
export const RS_WAITING: RsPos = { x: 0, y: 81, z: 29 };
export const RS_CAGE: RsPos = { x: 29, y: 81, z: 0 };
/** Where the villager stood in the plugin; the Cheese Exchange stands here. */
export const RS_KEEPER: RsPos = { x: 24, y: 81, z: 0 };

/** Bounds of everything the manor contains, barrier ring included. */
export const RS_BOUNDS = { minX: -26, maxX: 36, minZ: -22, maxZ: 36 };
export const RS_MIN_Y = 70, RS_MAX_Y = 121;
/** Where the round's top three stand at the end (feet): first on the gilt
 *  step, second and third either side. They face the crowd at -z. */
export const RS_PODIUM: readonly RsPos[] = [
  { x: 13.5, y: 83, z: 26 }, { x: 10.5, y: 82, z: 26 }, { x: 16.5, y: 82, z: 26 },
];
/** Everyone else lines up here, between the hedge row and the podium. */
export const RS_PODIUM_CROWD = { x: 13.5, y: 81, z: 23.5 } as const;

const SX = RS_BOUNDS.maxX - RS_BOUNDS.minX, SY = RS_MAX_Y - RS_MIN_Y + 1, SZ = RS_BOUNDS.maxZ - RS_BOUNDS.minZ;

/** The ten-odd Minecraft materials the blueprint named, as manor blocks. */
const M = {
  AIR: Block.Air, GRASS: Block.Grass, SLATE: Block.ManorSlate, BOARDS: Block.ManorBoards,
  STONE_BRICK: Block.ManorStoneBrick, PLASTER: Block.ManorPlaster, BEAM: Block.ManorBeam,
  WINDOW: Block.ManorWindow, PANEL: Block.ManorPanel, RIDGE: Block.ManorRidge, CHIMNEY: Block.ManorChimney,
  PAVING: Block.ManorPaving, LANTERN: Block.ManorLantern, LAMP: Block.ManorCeilingLamp, RUNNER: Block.ManorRunner,
  LEVER: Block.ManorLeverOff, POST: Block.ManorTableLeg, CASK: Block.ManorCask, BOOKS: Block.ManorBookshelf,
  CURIOS: Block.ManorCuriosShelf, MARBLE: Block.ManorMarble, MARBLE_SLAB: Block.ManorMarbleSlab,
  STOVE: Block.ManorStove, POT: Block.ManorFlowerPot, LINEN: Block.ManorLinen, TUB: Block.ManorWashtub,
  PEWTER: Block.ManorPewter, COPPER: Block.ManorCopperTank, FURNACE: Block.ManorFurnace, HAY: Block.ManorHayBale,
  PIANO: Block.ManorPiano, GRAMOPHONE: Block.ManorGramophone, MUSIC_BOX: Block.ManorMusicBox,
  VERDIGRIS: Block.ManorVerdigris, HEDGE: Block.ManorHedge, MOSSY: Block.ManorMossyPaving, GLASS: Block.ManorGlass,
  MOSS: Block.ManorMoss, GARDEN_POST: Block.ManorGardenPost, GILT: Block.ManorGilt, BRONZE: Block.ManorBronzeTile,
  BARS: Block.ManorCageBars,
} as const;

function rug(index: number): number { return Block.ManorRug0 + Math.max(0, Math.min(MANOR_RUGS.length - 1, index)); }

class House {
  readonly cells = new Uint8Array(SX * SY * SZ);
  readonly rooms: RsRoom[] = [];
  readonly passages: RsPassage[] = [];
  readonly hides: RsHide[] = [];
  readonly spawns: RsPos[] = [];
  readonly cheese: RsPos[] = [];
  readonly chandelierLevers: RsPos[] = [];
  readonly chandeliers: RsPos[] = [];

  constructor() {
    this.shell();
    this.interiors();
    this.stairs();
    this.ducts();
    this.garden();
    this.cage();
    this.exchange();
    this.barrier();
  }

  private idx(x: number, y: number, z: number): number {
    return ((y - RS_MIN_Y) * SZ + (z - RS_BOUNDS.minZ)) * SX + (x - RS_BOUNDS.minX);
  }
  inside(x: number, y: number, z: number): boolean {
    return x >= RS_BOUNDS.minX && x < RS_BOUNDS.maxX && z >= RS_BOUNDS.minZ && z < RS_BOUNDS.maxZ &&
      y >= RS_MIN_Y && y <= RS_MAX_Y;
  }
  at(x: number, y: number, z: number): number {
    return this.inside(x, y, z) ? this.cells[this.idx(x, y, z)] : Block.Air;
  }
  private block(x: number, y: number, z: number, b: number): void {
    if (this.inside(x, y, z)) this.cells[this.idx(x, y, z)] = b;
  }
  private fill(x1: number, y1: number, z1: number, x2: number, y2: number, z2: number, b: number): void {
    for (let x = x1; x <= x2; x++) for (let y = y1; y <= y2; y++) for (let z = z1; z <= z2; z++) this.block(x, y, z, b);
  }

  private shell(): void {
    this.fill(-25, RS_GROUND - 1, -21, 34, RS_GROUND, 34, M.GRASS);
    this.fill(-20, RS_CELLAR, -16, 20, RS_ATTIC + 2, 16, M.AIR);
    for (const y of [RS_CELLAR, RS_GROUND, RS_UPSTAIRS, RS_ATTIC]) {
      this.fill(-20, y, -16, 20, y, 16, y === RS_CELLAR ? M.SLATE : M.BOARDS);
      const wall = y === RS_CELLAR ? M.STONE_BRICK : M.PLASTER;
      this.fill(-20, y + 1, -16, 20, y + 5, -16, wall);
      this.fill(-20, y + 1, 16, 20, y + 5, 16, wall);
      this.fill(-20, y + 1, -15, -20, y + 5, 15, wall);
      this.fill(20, y + 1, -15, 20, y + 5, 15, wall);
      for (let x = -20; x <= 20; x += 8) for (const z of [-16, 16]) this.fill(x, y + 1, z, x, y + 5, z, M.BEAM);
      for (let z = -16; z <= 16; z += 8) for (const x of [-20, 20]) this.fill(x, y + 1, z, x, y + 5, z, M.BEAM);
      if (y !== RS_CELLAR) {
        for (const x of [-16, -8, 6, 14]) for (const z of [-16, 16]) {
          this.fill(x, y + 2, z, x + 2, y + 3, z, M.WINDOW);
          this.fill(x, y + 1, z, x + 2, y + 1, z, M.PANEL);
        }
        for (const z of [-10, 6]) for (const x of [-20, 20]) this.fill(x, y + 2, z, x, y + 3, z + 3, M.WINDOW);
      }
      for (const z of [-16, 16]) this.fill(-20, y, z, 20, y, z, M.PANEL);
    }
    // Steep slate roof, closed gables, a contrasting ridge and paired chimneys.
    for (let rise = 0; rise <= 8; rise++) {
      const edge = 17 - rise * 2, y = 98 + rise;
      this.fill(-21, y, -edge, 21, y, -edge + 1, M.SLATE);
      this.fill(-21, y, edge - 1, 21, y, edge, M.SLATE);
      if (edge > 1) {
        this.fill(-20, y, -edge + 2, -20, y, edge - 2, M.PLASTER);
        this.fill(20, y, -edge + 2, 20, y, edge - 2, M.PLASTER);
      }
    }
    this.fill(-21, 107, 0, 21, 107, 0, M.RIDGE);
    for (const x of [-14, 14]) {
      this.fill(x, 99, -7, x + 1, 108, -6, M.CHIMNEY);
      this.fill(x - 1, 109, -8, x + 2, 109, -5, M.PAVING);
    }
    // The porch and service door join the same circulation loop.
    this.fill(-3, 81, 16, 3, 84, 16, M.AIR);
    this.fill(20, 81, -2, 20, 83, 2, M.AIR);
    this.fill(-4, 80, 17, 4, 80, 21, M.STONE_BRICK);
    this.fill(-4, 85, 16, 4, 85, 21, M.PANEL);
    for (const x of [-4, 4]) {
      this.fill(x, 81, 21, x, 84, 21, M.BEAM);
      this.block(x, 84, 20, M.LANTERN);
    }
  }

  private interiors(): void {
    const names = [
      ['wine cellar', 'boiler workshop', 'root pantry', 'storage vault'],
      ['grand library', 'country kitchen', 'drawing room', 'banquet room'],
      ['master bedroom', 'toy room', 'guest bedroom', 'bath and laundry'],
      ['trunk loft', 'artist studio', 'clockwork attic', 'music room'],
    ];
    for (let level = 0; level < 4; level++) {
      const floor = RS_CELLAR + level * 6;
      for (const wallX of [-4, 4]) {
        this.fill(wallX, floor + 1, -15, wallX, floor + 5, 15, M.PANEL);
        // Two doors per room let the seeker cut a chase off.
        for (const z of [-13, -6, 4, 11]) this.fill(wallX, floor + 1, z, wallX, floor + 3, z + 1, M.AIR);
        for (const z of [-9, 8]) this.mousehole(wallX, floor + 1, z);
      }
      for (const side of [-1, 1]) {
        const left = side < 0 ? -19 : 5, right = side < 0 ? -5 : 19;
        this.fill(left, floor + 1, 0, right, floor + 5, 0, M.PANEL);
        for (const dx of [3, 10]) this.fill(left + dx, floor + 1, 0, left + dx + 1, floor + 3, 0, M.AIR);
        this.mousehole(left + 1, floor + 1, 0);
        this.mousehole(right - 1, floor + 1, 0);
        for (let half = 0; half < 2; half++) {
          const z = half === 0 ? -15 : 1;
          const index = half * 2 + (side > 0 ? 1 : 0);
          const name = names[level][index];
          this.rooms.push({ name, x1: left, x2: right, y1: floor + 1, y2: floor + 6, z1: z, z2: z + 14 });
          this.furnish(left, floor, z, rug(level * 4 + index), level, index, name);
        }
      }
      this.rooms.push({ name: ['cellar passage', 'entrance hall', 'upper gallery', 'attic landing'][level],
        x1: -3, x2: 3, y1: floor + 1, y2: floor + 6, z1: -15, z2: 15 });
      // Inlaid runners never reduce clearance in the one-block rat openings.
      this.fill(-3, floor, -15, -3, floor, 15, M.RUNNER);
      this.fill(3, floor, -15, 3, floor, 15, M.RUNNER);
      for (const z of [-14, -3, 3, 14]) this.block(0, floor + 5, z, M.LAMP);
      // The rope lever against the hall wall, clear of both stairways.
      this.block(3, floor + 1, 0, M.LEVER);
      this.chandelierLevers.push({ x: 3, y: floor + 1, z: 0 });
      this.chandeliers.push({ x: 0, y: floor + 5, z: 0 });
    }
  }

  private furnish(x: number, floor: number, z: number, accent: number, level: number, index: number, name: string): void {
    const y = floor + 1;
    this.fill(x + 3, floor, z + 3, x + 11, floor, z + 11, accent);
    // Four shallow, open-sided hides per room; none blocks a doorway.
    this.canopy(`${name} table`, x + 4, y, z + 4, accent);
    this.canopy(`${name} bench`, x + 9, y, z + 9, M.BOARDS);
    // Wardrobe: a full-height side exit, an open front and a dark back.
    this.fill(x, y, z + 4, x + 1, y + 3, z + 7, M.PANEL);
    this.fill(x + 1, y, z + 5, x + 1, y + 1, z + 6, M.AIR);
    this.hides.push({ name: `${name} wardrobe`, pos: { x: x + 1, y, z: z + 5 } });
    // Shelf island with a one-block channel behind it, open at both ends.
    this.fill(x + 5, y, z + 12, x + 9, y + 2, z + 12, level === 0 ? M.CASK : level === 3 ? M.CURIOS : M.BOOKS);
    this.hides.push({ name: `${name} shelf recess`, pos: { x: x + 7, y, z: z + 13 } });
    this.block(x + 5, y + 3, z + 12, M.LANTERN);
    // Room-specific silhouettes and props above the crawlable furniture.
    if (level === 1 && index === 1) {
      this.fill(x + 10, y, z + 1, x + 13, y + 2, z + 1, M.MARBLE);
      this.block(x + 11, y + 1, z + 2, M.STOVE);
      this.block(x + 12, y + 3, z + 1, M.POT);
    } else if (level === 2 && index !== 3) {
      this.fill(x + 4, y + 2, z + 4, x + 4, y + 2, z + 6, M.LINEN);
      this.fill(x + 3, y + 1, z + 4, x + 3, y + 3, z + 6, M.BEAM);
      this.block(x + 2, y, z + 3, M.CASK);
    } else if (level === 2) {
      this.fill(x + 10, y, z + 1, x + 13, y + 1, z + 2, M.MARBLE);
      this.block(x + 10, y + 2, z + 1, M.TUB);
      this.block(x + 12, y + 2, z + 1, M.PEWTER);
    } else if (level === 0 && index === 1) {
      this.fill(x + 11, y, z + 1, x + 12, y + 3, z + 2, M.COPPER);
      this.block(x + 10, y, z + 1, M.FURNACE);
    } else if (level === 0) {
      for (const dx of [3, 6, 10]) {
        this.block(x + dx, y, z + 1, M.CASK);
        this.block(x + dx, y + 1, z + 1, index === 2 ? M.HAY : M.CASK);
      }
    } else if (level === 3 && index === 3) {
      this.fill(x + 3, y, z + 1, x + 6, y + 1, z + 2, M.PIANO);
      this.fill(x + 3, y + 1, z + 3, x + 6, y + 1, z + 3, M.MARBLE_SLAB);
      this.block(x + 10, y, z + 1, M.GRAMOPHONE);
    } else if (level === 3) {
      for (const dx of [3, 7, 11]) {
        this.block(x + dx, y, z + 1, M.CASK);
        this.block(x + dx, y + 1, z + 1, index === 1 ? M.LINEN : M.MUSIC_BOX);
      }
    } else {
      this.fill(x + 3, y, z + 1, x + 8, y + 3, z + 1, M.BOOKS);
      this.block(x + 10, y, z + 2, M.POT);
    }
    this.block(x + 7, floor + 5, z + 7, M.LAMP);
    this.spawns.push({ x: x + 7, y, z: z + 7 });
    this.cheese.push({ x: x + 2, y, z: z + 9 });
    this.cheese.push({ x: x + 11, y, z: z + 5 });
  }

  private canopy(name: string, x: number, y: number, z: number, top: number): void {
    this.fill(x, y + 1, z, x + 3, y + 1, z + 2, top);
    for (const dx of [0, 3]) for (const dz of [0, 2]) this.block(x + dx, y, z + dz, M.POST);
    this.hides.push({ name, pos: { x: x + 1, y, z: z + 1 } });
  }

  private mousehole(x: number, y: number, z: number): void {
    this.block(x, y, z, M.AIR);
    this.hides.push({ name: 'mousehole', pos: { x, y, z } });
  }

  private stairs(): void {
    // Two independent three-wide stairways join EVERY floor. Each step is a
    // real stair (a half-block tread under a half-block riser), so both body
    // sizes walk up them without jumping.
    for (let floor = RS_CELLAR; floor < RS_ATTIC; floor += 6) {
      for (let step = 1; step <= 6; step++) {
        const northZ = -14 + step, southZ = 14 - step;
        this.fill(-2, floor + step, northZ, 0, floor + step + 3, northZ, M.AIR);
        this.fill(0, floor + step, southZ, 2, floor + step + 3, southZ, M.AIR);
        this.fill(-2, floor + step, northZ, 0, floor + step, northZ, Block.ManorStairS);
        this.fill(0, floor + step, southZ, 2, floor + step, southZ, Block.ManorStairN);
      }
    }
  }

  private ducts(): void {
    // Four sealed service runs, entered at floor level from inside a room.
    for (const floor of [RS_GROUND, RS_UPSTAIRS]) for (const side of [-1, 1]) {
      const x = side * 21, y = floor + 1;
      this.fill(Math.min(x, side * 22), y - 1, -13, Math.max(x, side * 22), y + 1, 13, M.VERDIGRIS);
      this.fill(x, y, -12, x, y, 12, M.AIR);
      for (const z of [-12, 12]) this.block(side * 20, y, z, M.AIR);
      this.passages.push({
        name: `${side < 0 ? 'west ' : 'east '}${floor === RS_GROUND ? 'skirting tunnel' : 'linen duct'}`,
        x, y, z1: -12, z2: 12,
        exitA: { x: side * 19, y, z: -12 }, exitB: { x: side * 19, y, z: 12 },
      });
    }
  }

  private garden(): void {
    this.rooms.push({ name: 'greenhouse', x1: -22, x2: -10, y1: 81, y2: 87, z1: 23, z2: 32 });
    this.rooms.push({ name: 'hedge garden', x1: -25, x2: 20, y1: 81, y2: 91, z1: 17, z2: 34 });
    this.rooms.push({ name: 'rescue courtyard', x1: 21, x2: 34, y1: 81, y2: 91, z1: -21, z2: 34 });
    for (const x of [-25, 34]) this.fill(x, 81, -21, x, 84, 34, M.STONE_BRICK);
    for (const z of [-21, 34]) this.fill(-25, 81, z, 34, 84, z, M.STONE_BRICK);
    this.fill(-2, 80, 17, 2, 80, 33, M.PAVING);
    this.fill(21, 80, -2, 26, 80, 2, M.PAVING);
    for (const x of [-8, 7, 15]) for (const z of [22, 29]) {
      this.fill(x, 81, z, x + 3, 82, z, M.HEDGE);
      this.hides.push({ name: 'hedge alcove', pos: { x: x + 1, y: 81, z: z + 1 } });
      this.cheese.push({ x: x + 1, y: 81, z: z + 2 });
    }
    // A walk-in greenhouse with two opposite doors and raised potting benches.
    this.fill(-22, 80, 23, -11, 80, 32, M.MOSSY);
    this.fill(-22, 81, 23, -11, 85, 23, M.GLASS);
    this.fill(-22, 81, 32, -11, 85, 32, M.GLASS);
    this.fill(-22, 81, 24, -22, 85, 31, M.GLASS);
    this.fill(-11, 81, 24, -11, 85, 31, M.GLASS);
    this.fill(-22, 86, 23, -11, 86, 32, M.VERDIGRIS);
    this.fill(-17, 81, 23, -15, 83, 23, M.AIR);
    this.fill(-11, 81, 27, -11, 83, 29, M.AIR);
    this.canopy('greenhouse potting bench', -20, 81, 25, M.MOSS);
    this.canopy('greenhouse seed bench', -16, 81, 28, M.BOARDS);
    this.block(-19, 83, 25, M.POT);
    this.block(-15, 83, 28, M.POT);
    this.block(-17, 85, 27, M.LAMP);
    this.spawns.push({ x: -15, y: 81, z: 26 });
    this.cheese.push({ x: -20, y: 81, z: 30 });
    for (const x of [-23, 5, 23, 32]) for (const z of [19, 32]) {
      this.fill(x, 81, z, x, 83, z, M.GARDEN_POST);
      this.block(x, 84, z, M.LANTERN);
    }
    // The winners' podium between the hedge rows.
    this.fill(12, 81, 25, 14, 81, 26, M.RIDGE);
    this.fill(12, 82, 25, 14, 82, 26, M.GILT);
    this.fill(9, 81, 25, 11, 81, 26, M.PEWTER);
    this.fill(15, 81, 25, 17, 81, 26, M.BRONZE);
    // Glass waiting booth: the seeker waits here while the rats hide.
    this.fill(-2, 81, 27, 2, 83, 31, M.GLASS);
    this.fill(-1, 81, 28, 1, 82, 30, M.AIR);
  }

  private cage(): void {
    this.fill(27, 80, -3, 32, 80, 3, M.PAVING);
    this.fill(27, 81, -3, 32, 84, -3, M.BARS);
    this.fill(27, 81, 3, 32, 84, 3, M.BARS);
    this.fill(27, 81, -2, 27, 84, 2, M.BARS);
    this.fill(32, 81, -2, 32, 84, 2, M.BARS);
    this.fill(27, 85, -3, 32, 85, 3, M.COPPER);
    this.block(28, 84, 0, M.LAMP);
    this.block(31, 84, 0, M.LAMP);
    this.fill(23, 80, -1, 25, 80, 1, M.GILT);
  }

  /** The Cheese Exchange stands where the plugin's keeper stood. */
  private exchange(): void {
    this.block(RS_KEEPER.x, RS_KEEPER.y, RS_KEEPER.z, Block.ManorExchangeBase);
    this.block(RS_KEEPER.x, RS_KEEPER.y + 1, RS_KEEPER.z, Block.ManorExchangeTop);
  }

  /** An invisible wall round the estate, so a bounce never leaves it. */
  private barrier(): void {
    const { minX, maxX, minZ, maxZ } = RS_BOUNDS;
    for (let y = 79; y <= RS_MAX_Y; y++) {
      for (let x = minX; x < maxX; x++) { this.block(x, y, minZ, Block.Barrier); this.block(x, y, maxZ - 1, Block.Barrier); }
      for (let z = minZ; z < maxZ; z++) { this.block(minX, y, z, Block.Barrier); this.block(maxX - 1, y, z, Block.Barrier); }
    }
  }
}

let house: House | null = null;
/** The blueprint is deterministic: built once, shared by every match. */
export function rsHouse(): House {
  return house ??= new House();
}
export function ratseekBlockAt(x: number, y: number, z: number): number {
  return rsHouse().at(x, y, z);
}

/** Named area containing a point (plugin `roomAt`). */
export function rsRoomAt(x: number, y: number, z: number): string {
  const bx = Math.floor(x), by = Math.floor(y), bz = Math.floor(z);
  const h = rsHouse();
  for (const p of h.passages) {
    if (bx === p.x && by === p.y && bz >= p.z1 && bz <= p.z2) return p.name;
  }
  for (const r of h.rooms) {
    if (bx >= r.x1 && bx <= r.x2 && by >= r.y1 && by <= r.y2 && bz >= r.z1 && bz <= r.z2) return r.name;
  }
  if (z >= 17) return 'front garden';
  if (x >= 21) return 'cage yard';
  return 'house exterior';
}

/** The service tunnel a point is inside, if any. */
export function rsPassageAt(x: number, y: number, z: number): RsPassage | null {
  const bx = Math.floor(x), by = Math.floor(y), bz = Math.floor(z);
  for (const p of rsHouse().passages) if (bx === p.x && by === p.y && bz >= p.z1 && bz <= p.z2) return p;
  return null;
}
