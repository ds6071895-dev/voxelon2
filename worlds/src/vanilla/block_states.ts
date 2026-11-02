// Which state a placed block takes, and how neighbours react (fence/pane
// connections, double slabs, snow layers, two-high doors). Pure: the server
// runs it authoritatively and the client predicts with the same code.

import { BLOCKS, Block } from '../blocks';
import { type Facing, VB, VMETA, stateId, withState } from './blocks';

export type BlockGet = (x: number, y: number, z: number) => number;
export interface PlaceCtx {
  /** Normal of the face that was clicked (points from the clicked block to the new cell). */
  nx: number; ny: number; nz: number;
  /** Player yaw (forward = (-sin, -cos)). */
  yaw: number;
  /** Height of the hit point inside the clicked face, 0..1 (slabs, stairs, trapdoors). */
  hitY: number;
}
export interface Placement { x: number; y: number; z: number; block: number }

/** Horizontal direction the player looks. */
export function lookFacing(yaw: number): Facing {
  const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
  return Math.abs(fx) > Math.abs(fz) ? (fx > 0 ? 'e' : 'w') : (fz > 0 ? 's' : 'n');
}
const OPPOSITE: Record<Facing, Facing> = { n: 's', s: 'n', e: 'w', w: 'e' };
function normalFacing(nx: number, nz: number): Facing | null {
  if (nx > 0) return 'e'; if (nx < 0) return 'w'; if (nz > 0) return 's'; if (nz < 0) return 'n'; return null;
}
const DIRS: [Facing, number, number][] = [['n', 0, -1], ['s', 0, 1], ['e', 1, 0], ['w', -1, 0]];
const BIT: Record<Facing, number> = { n: 1, s: 2, e: 4, w: 8 };

/** Upper half of the placed face? Clicking a ceiling counts as upper. */
function upperHalf(c: PlaceCtx): boolean { return c.ny < 0 || (c.ny === 0 && c.hitY > .5); }

const CONNECT_FAMILIES = /(_fence|_wall|glass_pane|iron_bars)$/;
/** Does a connecting block at a cell link toward a neighbour id? */
function linksTo(family: string, other: number): boolean {
  if (other === Block.Air) return false;
  const m = VMETA[other];
  if (m && CONNECT_FAMILIES.test(m.family)) {
    // Fences join fences, walls join walls, panes and bars join each other.
    const kind = (f: string) => f.endsWith('_fence') ? 'fence' : f.endsWith('_wall') ? 'wall' : 'pane';
    return kind(m.family) === kind(family);
  }
  const info = BLOCKS[other];
  return !!info && info.solid && info.opaque;
}
/** The connection mask a connecting block should have at (x, y, z). */
export function connMask(family: string, get: BlockGet, x: number, y: number, z: number): number {
  let conn = 0;
  for (const [f, dx, dz] of DIRS) if (linksTo(family, get(x + dx, y, z + dz))) conn |= BIT[f];
  return conn;
}

/**
 * Blocks to write when `itemBlock` (a family's default id) is placed into the
 * empty cell (x, y, z). Returns null when the placement is not possible
 * (ladder on a floor, door without headroom...). `existing` is what occupies
 * the target cell now (replaceables, a slab to double, snow to stack).
 */
export function placeBlock(itemBlock: number, get: BlockGet, x: number, y: number, z: number, c: PlaceCtx): Placement[] | null {
  const m = VMETA[itemBlock];
  if (!m) return [{ x, y, z, block: itemBlock }];
  const fam = m.family;
  const look = lookFacing(c.yaw);
  const one = (block: number | undefined): Placement[] | null => block === undefined ? null : [{ x, y, z, block }];

  if ('axis' in m.state && fam !== 'anvil') {
    return one(stateId(fam, { axis: c.nx !== 0 ? 'x' : c.nz !== 0 ? 'z' : 'y' }));
  }
  if (fam.endsWith('_stairs')) return one(stateId(fam, { facing: look, half: upperHalf(c) ? 'top' : 'bottom' }));
  if (fam.endsWith('_slab')) return one(stateId(fam, { type: c.ny > 0 ? 'bottom' : c.ny < 0 ? 'top' : c.hitY > .5 ? 'top' : 'bottom' }));
  if (CONNECT_FAMILIES.test(fam)) return one(stateId(fam, { conn: connMask(fam, get, x, y, z) }));
  switch (fam) {
    case 'ladder': {
      const f = normalFacing(c.nx, c.nz);
      return f ? one(stateId(fam, { facing: f })) : null;
    }
    case 'furnace': case 'smoker': return one(stateId(fam, { facing: OPPOSITE[look], lit: false }));
    case 'chest': case 'loom': return one(stateId(fam, { facing: OPPOSITE[look] }));
    case 'anvil': return one(stateId(fam, { axis: look === 'n' || look === 's' ? 'z' : 'x' }));
    case 'lantern': return one(stateId(fam, { hanging: c.ny < 0 }));
    case 'oak_trapdoor': case 'iron_trapdoor':
      return one(stateId(fam, { facing: OPPOSITE[look], half: upperHalf(c) ? 'top' : 'bottom', open: false }));
    case 'oak_door': {
      const above = get(x, y + 1, z);
      if (above !== Block.Air && !BLOCKS[above]?.replaceable) return null;
      if (!VMETA[get(x, y - 1, z)]?.sturdy && !BLOCKS[get(x, y - 1, z)]?.opaque) return null;
      return [
        { x, y, z, block: stateId(fam, { half: 'lower', facing: look, open: false })! },
        { x, y: y + 1, z, block: stateId(fam, { half: 'upper', facing: look, open: false })! },
      ];
    }
    case 'snow': return one(stateId(fam, { layers: 1 }));
  }
  return one(itemBlock);
}

/** Placing into a cell that already holds something this item merges with:
 *  a matching slab becomes double, snow gains a layer. Null = no merge. */
export function mergeInto(itemBlock: number, existing: number, c: PlaceCtx): number | null {
  const im = VMETA[itemBlock], em = VMETA[existing];
  if (!im || !em || im.family !== em.family) return null;
  if (im.family.endsWith('_slab')) {
    const t = em.state.type;
    if (t === 'bottom' && (c.ny > 0 || c.hitY > .5)) return withState(existing, { type: 'double' });
    if (t === 'top' && (c.ny < 0 || c.hitY <= .5)) return withState(existing, { type: 'double' });
    return null;
  }
  if (im.family === 'snow') {
    const n = Number(em.state.layers);
    return n < 8 ? withState(existing, { layers: n + 1 }) : null;
  }
  return null;
}

/** After an edit at (x, y, z): neighbours whose state must follow (fences,
 *  panes and walls reconnect; a door half without its partner breaks). */
export function neighbourUpdates(get: BlockGet, x: number, y: number, z: number): Placement[] {
  const out: Placement[] = [];
  for (const [, dx, dz] of [['', 0, 0], ...DIRS] as [string, number, number][]) {
    const nx = x + dx, nz = z + dz, id = get(nx, y, nz);
    const m = VMETA[id];
    if (!m || !CONNECT_FAMILIES.test(m.family)) continue;
    const want = stateId(m.family, { conn: connMask(m.family, get, nx, y, nz) });
    if (want !== undefined && want !== id) out.push({ x: nx, y, z: nz, block: want });
  }
  for (const dy of [-1, 1]) {
    const id = get(x, y + dy, z), m = VMETA[id];
    if (m?.family !== 'oak_door') continue;
    const partner = get(x, y, z);
    if (VMETA[partner]?.family !== 'oak_door') out.push({ x, y: y + dy, z, block: Block.Air });
  }
  return out;
}

/** Right-click on a block: doors and wooden trapdoors toggle. Returns the
 *  edits, or null when the block does nothing on use. */
export function useBlock(get: BlockGet, x: number, y: number, z: number): Placement[] | null {
  const id = get(x, y, z), m = VMETA[id];
  if (!m) return null;
  if (m.family === 'oak_trapdoor') return [{ x, y, z, block: withState(id, { open: !m.state.open }) }];
  if (m.family === 'oak_door') {
    const oy = m.state.half === 'lower' ? y + 1 : y - 1;
    const other = get(x, oy, z);
    const open = !m.state.open;
    const edits: Placement[] = [{ x, y, z, block: withState(id, { open }) }];
    if (VMETA[other]?.family === 'oak_door') edits.push({ x, y: oy, z, block: withState(other, { open }) });
    return edits;
  }
  return null;
}

/** Container/workstation blocks that open a window on use. */
export function stationOf(id: number): 'crafting' | 'furnace' | 'smoker' | 'chest' | 'barrel' | null {
  const f = VMETA[id]?.family;
  return f === 'crafting_table' ? 'crafting' : f === 'furnace' ? 'furnace' : f === 'smoker' ? 'smoker'
    : f === 'chest' ? 'chest' : f === 'barrel' ? 'barrel' : null;
}
export { VB };
