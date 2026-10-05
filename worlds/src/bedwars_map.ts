// Shared deterministic Bedwars map metadata. Safe in browser and server bundles.
import { Block } from './blocks';
import { buildBedwarsMap, type BedwarsStamp, BW_Y } from './bedwars_setpieces';
export { BW_Y, BW_BOUNDS, BW_MIN_Y, BW_MAX_Y, BW_VOID_Y } from './bedwars_setpieces';

export interface Pos { x: number; y: number; z: number }
export interface BedwarsBase {
  team: 0 | 1;
  center: Pos;
  spawns: Pos[];
  /** Integer voxel address of the head. Foot is at z + 1. */
  bed: Pos;
  shop: Pos;
  upgrades: Pos;
  forge: Pos;
  chest: Pos;
  yaw: number;
}
export interface BedwarsGenerator {
  id: number;
  kind: 'iron' | 'gold' | 'diamond' | 'emerald';
  /** Standing height, centered over the supporting floor cell. */
  pos: Pos;
  team?: 0 | 1;
}

/** Physical proxy: two half-height marble cells, hidden by the bed model. */
export const BW_BED_BLOCK: number = Block.ManorMarbleSlab;

export const BW_BASES: BedwarsBase[] = ([0, 1] as const).map(team => {
  const side = team === 0 ? -1 : 1;
  const pos = (u: number, z: number): Pos => ({ x: side * (62 - u) + .5, y: BW_Y + 1, z: z + .5 });
  return {
    team,
    center: { x: side * 62, y: BW_Y + 1, z: 0 },
    spawns: [pos(-1, -2), pos(-1, 0), pos(-1, 2), pos(0, 0)],
    bed: { x: side * 56, y: BW_Y + 1, z: -1 },
    shop: pos(-5, -7), upgrades: pos(-5, 7), forge: pos(-7, 0), chest: pos(-4, 9),
    yaw: team === 0 ? -Math.PI / 2 : Math.PI / 2,
  };
});

export const BW_GENERATORS: BedwarsGenerator[] = [
  ...BW_BASES.flatMap(base => [
    { id: base.team * 2, kind: 'iron' as const, pos: { ...base.forge }, team: base.team },
    { id: base.team * 2 + 1, kind: 'gold' as const, pos: { ...base.forge, z: base.forge.z + 1 }, team: base.team },
  ]),
  ...([-1, 1] as const).flatMap((sx, ix) => ([-1, 1] as const).map((sz, iz) => ({
    id: 4 + ix * 2 + iz, kind: 'diamond' as const, pos: { x: sx * 28 + .5, y: BW_Y + 1, z: sz * 33 + .5 },
  }))),
  { id: 8, kind: 'emerald', pos: { x: -9.5, y: BW_Y + 1, z: .5 } },
  { id: 9, kind: 'emerald', pos: { x: 10.5, y: BW_Y + 1, z: .5 } },
];
export const BW_SPAWNS: Pos[] = BW_BASES.flatMap(base => base.spawns);

// Metadata is shared across rounds; accidental client mutation cannot move a map.
for (const base of BW_BASES) {
  for (const pos of [base.center, base.bed, base.shop, base.upgrades, base.forge, base.chest, ...base.spawns]) Object.freeze(pos);
  Object.freeze(base.spawns); Object.freeze(base);
}
for (const gen of BW_GENERATORS) { Object.freeze(gen.pos); Object.freeze(gen); }
Object.freeze(BW_BASES); Object.freeze(BW_GENERATORS); Object.freeze(BW_SPAWNS);

let stamp: BedwarsStamp | undefined;
export function bwBlockAt(x: number, y: number, z: number): number {
  return (stamp ??= buildBedwarsMap()).get(x, y, z);
}

/** Both bed cells target the same team; no bed protection is implied. */
export function bwBedAt(x: number, y: number, z: number): 0 | 1 | null {
  for (const { team, bed } of BW_BASES)
    if (x === bed.x && y === bed.y && (z === bed.z || z === bed.z + 1)) return team;
  return null;
}

/** Local service/spawn protection only; the entire defense apron is buildable. */
export function bwProtected(x: number, y: number, z: number): boolean {
  if (y < BW_Y - 1 || y > BW_Y + 5) return false;
  for (const base of BW_BASES) {
    const side = base.team === 0 ? -1 : 1, u = 62 - side * x;
    // Do not let the spawn halo spill into the courtyard at u >= 2.
    if (u >= 2) continue;
    if (base.spawns.some(p => Math.abs(x + .5 - p.x) <= 1 && Math.abs(z + .5 - p.z) <= 1)) return true;
    if ([base.shop, base.upgrades, base.forge, base.chest].some(p =>
      Math.abs(x + .5 - p.x) <= 2 && Math.abs(z + .5 - p.z) <= 2)) return true;
  }
  for (const gen of BW_GENERATORS) if (gen.team === undefined
    && Math.abs(x + .5 - gen.pos.x) <= 1 && Math.abs(z + .5 - gen.pos.z) <= 1) return true;
  return false;
}
