// Bedwars maps: shared, deterministic metadata. Safe in browser and server bundles.
//
// Every map has four island bases, one per compass side, each an exact 90°
// rotation of the same layout, so no team ever gets a better spot. A base is
// authored in a local frame: `u` points from the island toward the middle of
// the map and `w` runs across it. `bwMap(id)` turns that into world cells.
// The world spec's seed is the map id; the map's name is never shown.
import { baseCell, buildBedwarsMap, type BedwarsStamp, type BwTheme, BW_Y } from './bedwars_setpieces';
export { BW_Y, BW_BOUNDS, BW_MIN_Y, BW_MAX_Y, BW_VOID_Y, BW_TEAM_WOOL } from './bedwars_setpieces';

export interface Pos { x: number; y: number; z: number }
export interface BedwarsBase {
  team: number;
  center: Pos;
  spawns: Pos[];
  /** The bed's two cells: the pillow end, then the foot. */
  bed: Pos;
  bedFoot: Pos;
  shop: Pos;
  upgrades: Pos;
  /** Iron and gold both spawn here, on the island's centre line. */
  forge: Pos;
  chest: Pos;
  /** Facing the middle of the map. */
  yaw: number;
  /** Unit vector from this island toward the middle. */
  inward: { x: number; z: number };
}
interface BedwarsGenerator {
  id: number;
  kind: 'iron' | 'gold' | 'diamond' | 'emerald';
  /** Standing height, centred over the supporting floor cell. */
  pos: Pos;
  team?: number;
}
export interface BedwarsMap {
  id: number;
  theme: BwTheme;
  bases: readonly BedwarsBase[];
  generators: readonly BedwarsGenerator[];
  blockAt(x: number, y: number, z: number): number;
  /** Which team's bed a cell belongs to, or null. */
  bedAt(x: number, y: number, z: number): number | null;
  /** Spawn and service cells that nobody can build in. */
  isProtected(x: number, y: number, z: number): boolean;
}

/** Red west, Blue east, Green north, Yellow south: inward unit vectors. */
const INWARD = [{ x: 1, z: 0 }, { x: -1, z: 0 }, { x: 0, z: 1 }, { x: 0, z: -1 }] as const;

interface Layout {
  theme: BwTheme;
  /** Distance from the middle to each base's centre cell. */
  baseDistance: number;
  /** Diamond islands sit on the diagonals at (±d, ±d). */
  diamond: number;
  /** Emerald wells on the middle island, at this distance along each axis. */
  emerald: number;
}
const LAYOUTS: Layout[] = [
  { theme: 'garden', baseDistance: 62, diamond: 33, emerald: 10 },
  { theme: 'frost', baseDistance: 60, diamond: 31, emerald: 9 },
];
export const BW_MAP_COUNT = LAYOUTS.length;

const key = (x: number, y: number, z: number): number => ((x + 128) * 512 + y) * 512 + (z + 128);

function makeMap(id: number, layout: Layout): BedwarsMap {
  const D = layout.baseDistance, Y = BW_Y + 1;
  const bases: BedwarsBase[] = INWARD.map((inward, team) => {
    const cell = (u: number, w: number): Pos => { const c = baseCell(team, D, u, w); return { x: c.x + .5, y: Y, z: c.z + .5 }; };
    const bed = cell(6, 0), foot = cell(7, 0);
    return {
      team, inward,
      center: cell(0, 0),
      spawns: [cell(-1, -2), cell(-1, 0), cell(-1, 2), cell(0, 0)],
      bed: { x: bed.x - .5, y: Y, z: bed.z - .5 }, bedFoot: { x: foot.x - .5, y: Y, z: foot.z - .5 },
      shop: cell(-5, -7), upgrades: cell(-5, 7), forge: cell(-7, 0), chest: cell(-4, 9),
      yaw: Math.atan2(-inward.x, -inward.z),
    };
  });
  const generators: BedwarsGenerator[] = [
    ...bases.flatMap(b => [
      { id: b.team * 2, kind: 'iron' as const, pos: { ...b.forge }, team: b.team },
      { id: b.team * 2 + 1, kind: 'gold' as const, pos: { ...b.forge }, team: b.team },
    ]),
    ...[[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sz], i) => ({
      id: 8 + i, kind: 'diamond' as const, pos: { x: sx * layout.diamond + .5, y: Y, z: sz * layout.diamond + .5 },
    })),
    ...[[-1, 0], [1, 0], [0, -1], [0, 1]].map(([sx, sz], i) => ({
      id: 12 + i, kind: 'emerald' as const, pos: { x: sx * layout.emerald + .5, y: Y, z: sz * layout.emerald + .5 },
    })),
  ];
  for (const b of bases) {
    for (const p of [b.center, b.bed, b.bedFoot, b.shop, b.upgrades, b.forge, b.chest, ...b.spawns]) Object.freeze(p);
    Object.freeze(b.spawns); Object.freeze(b);
  }
  for (const g of generators) { Object.freeze(g.pos); Object.freeze(g); }
  const beds = new Map<number, number>();
  for (const b of bases) { beds.set(key(b.bed.x, b.bed.y, b.bed.z), b.team); beds.set(key(b.bedFoot.x, b.bedFoot.y, b.bedFoot.z), b.team); }
  // Protection: one cell around each spawn, two around each service, one
  // around each middle generator. Precomputed: it is asked on every placement.
  const shielded = new Set<number>();
  const shield = (p: Pos, r: number): void => {
    for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) for (let y = BW_Y - 1; y <= BW_Y + 5; y++)
      shielded.add(key(Math.floor(p.x) + dx, y, Math.floor(p.z) + dz));
  };
  for (const b of bases) {
    for (const s of b.spawns) shield(s, 1);
    for (const s of [b.shop, b.upgrades, b.forge, b.chest]) shield(s, 2);
  }
  for (const g of generators) if (g.team === undefined) shield(g.pos, 1);
  let stamp: BedwarsStamp | undefined;
  return Object.freeze({
    id, theme: layout.theme, bases: Object.freeze(bases), generators: Object.freeze(generators),
    blockAt: (x: number, y: number, z: number) => (stamp ??= buildBedwarsMap(layout.theme, D, layout.diamond, layout.emerald)).get(x, y, z),
    bedAt: (x: number, y: number, z: number) => beds.get(key(x, y, z)) ?? null,
    isProtected: (x: number, y: number, z: number) => shielded.has(key(x, y, z)),
  });
}

const MAPS = LAYOUTS.map((l, i) => makeMap(i, l));
/** The map for a world seed (any integer maps onto one of them). */
export function bwMap(id: number): BedwarsMap { return MAPS[((Math.floor(id) % MAPS.length) + MAPS.length) % MAPS.length]; }
