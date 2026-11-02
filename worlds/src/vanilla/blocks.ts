// Vanilla blocks for Lucky Pillars, Disaster City and Party Games.
//
// One id per block STATE (the 1.13 model): an oak stair facing north, bottom
// half, is its own id, so collision, meshing and the wire never carry extra
// state. Each state also has a VBlockMeta row: vanilla hardness and blast
// resistance, harvest tool, drops, flammability and movement behaviour, with
// numbers from the Minecraft wiki. Families group the states of one block
// (`oak_stairs`) so placement can pick the right one (block_states.ts).
//
// Legacy Worlds blocks that already match a vanilla block (stone, sand, oak
// log, water...) are reused and given meta rows, not duplicated.

import { BLOCKS, BLOCK_ID_LIMIT, Block, type Box, type BlockInfo, def, Tile } from '../blocks';
import { VANILLA_BLOCK_BASE, VANILLA_BLOCK_END } from './ids';
import { DYES, vt } from './tiles';

export type VTool = 'pickaxe' | 'axe' | 'shovel' | 'hoe' | 'sword' | 'shears';
export type MoveKind = 'ladder' | 'scaffold' | 'cobweb' | 'slime' | 'honey' | 'powderSnow' | 'hay' | 'ice' | 'packedIce' | 'blueIce' | 'soulSand';
export type Facing = 'n' | 's' | 'e' | 'w';
export type Axis = 'x' | 'y' | 'z';

export interface VBlockMeta {
  /** Family key, e.g. `oak_stairs`; also the key of the item it drops by default. */
  family: string;
  name: string;
  /** Vanilla hardness; -1 = unbreakable. */
  hardness: number;
  /** Vanilla blast resistance. */
  blast: number;
  tool?: VTool;
  /** Drops nothing unless mined with `tool` of at least this tier
   *  (wood 0, stone 1, iron 2, diamond 3, netherite 4). */
  needsTier?: number;
  /** Item key dropped instead of the family's own item; '' = nothing. */
  drop?: string;
  /** Count dropped (fixed, or [min, max]). */
  dropCount?: number | [number, number];
  /** Rare extra drops: [itemKey, chance]. */
  extra?: [string, number][];
  flammable?: boolean;
  gravity?: boolean;
  move?: MoveKind;
  /** Block state properties (facing, half, axis, open, level, conn...). */
  state: Record<string, string | number | boolean>;
  /** Only obtainable by placement through its family (door halves etc.). */
  noItem?: boolean;
  /** Solid enough to stand a torch/ladder against and to support gravity blocks. */
  sturdy?: boolean;
}

export const VMETA: (VBlockMeta | undefined)[] = new Array(BLOCK_ID_LIMIT);
/** Family → default state id (the block an item of that family places). */
export const VB: Record<string, number> = {};
/** Family → every state id, in registration order. */
export const VFAMILY: Record<string, number[]> = {};

let next = VANILLA_BLOCK_BASE;
function stateKey(state: Record<string, string | number | boolean>): string {
  return Object.keys(state).sort().map((k) => `${k}=${state[k]}`).join(',');
}
const STATE_INDEX = new Map<string, number>();

function add(family: string, info: BlockInfo, meta: Omit<VBlockMeta, 'family' | 'name' | 'state'> & { state?: VBlockMeta['state'] }, id?: number): number {
  const bid = id ?? next++;
  if (bid >= VANILLA_BLOCK_END) throw new Error('vanilla block ids exhausted');
  if (id === undefined) BLOCKS[bid] = info;
  const state = meta.state ?? {};
  VMETA[bid] = { family, name: info.name, ...meta, state, sturdy: meta.sturdy ?? (info.solid && info.opaque) };
  (VFAMILY[family] ??= []).push(bid);
  VB[family] ??= bid;
  STATE_INDEX.set(`${family}|${stateKey(state)}`, bid);
  return bid;
}
/** The id of a family in a given state (undefined if it has no such state). */
export function stateId(family: string, state: Record<string, string | number | boolean>): number | undefined {
  return STATE_INDEX.get(`${family}|${stateKey(state)}`);
}
/** Same family, some properties changed. */
export function withState(id: number, patch: Record<string, string | number | boolean>): number {
  const m = VMETA[id];
  if (!m) return id;
  return stateId(m.family, { ...m.state, ...patch }) ?? id;
}

// ── Shape helpers ───────────────────────────────────────────────────────────

const px = (n: number) => n / 16;
/** Rotate a north-facing box (cell-local) to `f` about the cell centre. */
function rotBox(b: Box, f: Facing): Box {
  const [[x0, y0, z0], [x1, y1, z1]] = b;
  switch (f) {
    case 'n': return b;
    case 's': return [[1 - x1, y0, 1 - z1], [1 - x0, y1, 1 - z0]];
    case 'e': return [[1 - z1, y0, x0], [1 - z0, y1, x1]];
    case 'w': return [[z0, y0, 1 - x1], [z1, y1, 1 - x0]];
  }
}
const FACINGS: Facing[] = ['n', 's', 'e', 'w'];
/** FACES order (west, east, bottom, top, north, south) index of a facing. */
const FACE_INDEX: Record<Facing, number> = { w: 0, e: 1, n: 4, s: 5 };

interface Base { name: string; hardness: number; blast: number; tool?: VTool; needsTier?: number; flammable?: boolean; top: Tile; side?: Tile; bottom?: Tile }

function cube(family: string, b: Base & { opaque?: boolean; drop?: string; dropCount?: VBlockMeta['dropCount']; extra?: VBlockMeta['extra']; gravity?: boolean; emission?: number; move?: MoveKind; solid?: boolean; faces?: Tile[]; lightAtt?: number }): number {
  return add(family, def({
    name: b.name, hardness: b.hardness, top: b.top, side: b.side, bottom: b.bottom,
    opaque: b.opaque ?? true, occludes: b.opaque ?? true, solid: b.solid ?? true, emission: b.emission, faces: b.faces, lightAtt: b.lightAtt,
  }), {
    hardness: b.hardness, blast: b.blast, tool: b.tool, needsTier: b.needsTier, flammable: b.flammable,
    drop: b.drop, dropCount: b.dropCount, extra: b.extra, gravity: b.gravity, move: b.move,
  });
}
/** Reuse a legacy block as a vanilla family. */
function legacy(family: string, id: number, m: Omit<VBlockMeta, 'family' | 'name' | 'state'> & { state?: VBlockMeta['state'] }): number {
  return add(family, BLOCKS[id], m, id);
}
function pillar(family: string, b: Base & { endTile: Tile; legacyY?: number }): void {
  for (const axis of ['y', 'x', 'z'] as Axis[]) {
    const m = { hardness: b.hardness, blast: b.blast, tool: b.tool, flammable: b.flammable, state: { axis } };
    if (axis === 'y' && b.legacyY !== undefined) { legacy(family, b.legacyY, m); continue; }
    const s = b.top, e = b.endTile;
    // FACES: west, east, bottom, top, north, south.
    const faces = axis === 'y' ? [s, s, e, e, s, s] : axis === 'x' ? [e, e, s, s, s, s] : [s, s, s, s, e, e];
    add(family, def({ name: b.name, hardness: b.hardness, top: e, side: s, faces }), m);
  }
}
const STAIR_BOTTOM: Box[] = [[[0, 0, 0], [1, .5, 1]], [[0, .5, 0], [1, 1, .5]]];
const STAIR_TOP: Box[] = [[[0, .5, 0], [1, 1, 1]], [[0, 0, 0], [1, .5, .5]]];
function stairs(family: string, b: Base): void {
  for (const half of ['bottom', 'top']) for (const facing of FACINGS) {
    const boxes = (half === 'bottom' ? STAIR_BOTTOM : STAIR_TOP).map((x) => rotBox(x, facing));
    add(family, def({ name: b.name, hardness: b.hardness, top: b.top, side: b.side, bottom: b.bottom, shape: 'box', boxes, opaque: false, occludes: true }),
      { hardness: b.hardness, blast: b.blast, tool: b.tool, needsTier: b.needsTier, flammable: b.flammable, state: { facing, half }, sturdy: false });
  }
}
function slab(family: string, b: Base & { full: number }): void {
  for (const type of ['bottom', 'top', 'double']) {
    const m = { hardness: b.hardness, blast: b.blast, tool: b.tool, needsTier: b.needsTier, flammable: b.flammable, state: { type } };
    if (type === 'double') { add(family, def({ name: b.name, hardness: b.hardness, top: b.top, side: b.side, bottom: b.bottom }), { ...m, dropCount: 2 }); continue; }
    const boxes: Box[] = [type === 'bottom' ? [[0, 0, 0], [1, .5, 1]] : [[0, .5, 0], [1, 1, 1]]];
    add(family, def({ name: b.name, hardness: b.hardness, top: b.top, side: b.side, bottom: b.bottom, shape: 'box', boxes, opaque: false, occludes: false }), { ...m, sturdy: false });
  }
}
/** Four-way connecting blocks: fences, walls, panes, bars. `conn` is a NSEW
 *  bitmask (n 1, s 2, e 4, w 8). */
function connecting(family: string, b: Base & { post: Box; arm: Box; drawOpaque?: boolean; dropNothing?: boolean }): void {
  for (let conn = 0; conn < 16; conn++) {
    const boxes: Box[] = [b.post];
    FACINGS.forEach((f, i) => { if (conn & (1 << i)) boxes.push(rotBox(b.arm, f)); });
    add(family, def({ name: b.name, hardness: b.hardness, top: b.top, side: b.side ?? b.top, shape: 'box', boxes, opaque: false, occludes: false }),
      { hardness: b.hardness, blast: b.blast, tool: b.tool, needsTier: b.needsTier, flammable: b.flammable, state: { conn }, drop: b.dropNothing ? '' : undefined, sturdy: false });
  }
}
function facingBlock(family: string, b: Base & { front: Tile; box?: Box; emission?: number; lit?: Tile; extraState?: Record<string, string | boolean> }): void {
  const lits = b.lit !== undefined ? [false, true] : [false];
  for (const lit of lits) for (const facing of FACINGS) {
    const faces = [b.side!, b.side!, b.bottom ?? b.top, b.top, b.side!, b.side!];
    faces[FACE_INDEX[facing]] = lit ? b.lit! : b.front;
    const boxes = b.box ? [rotBox(b.box, facing)] : undefined;
    add(family, def({
      name: b.name, hardness: b.hardness, top: b.top, side: b.side, bottom: b.bottom, faces,
      shape: boxes ? 'box' : 'cube', boxes, opaque: !boxes, occludes: !boxes, emission: lit ? (b.emission ?? 13) : 0,
    }), { hardness: b.hardness, blast: b.blast, tool: b.tool, needsTier: b.needsTier, flammable: b.flammable, state: b.lit !== undefined ? { facing, lit } : { facing } });
  }
}

// ── Legacy blocks reused ────────────────────────────────────────────────────

const PICK = 'pickaxe' as const;
legacy('grass_block', Block.Grass, { hardness: .6, blast: .6, tool: 'shovel', drop: 'dirt' });
legacy('dirt', Block.Dirt, { hardness: .5, blast: .5, tool: 'shovel' });
legacy('stone', Block.Stone, { hardness: 1.5, blast: 6, tool: PICK, needsTier: 0, drop: 'cobblestone' });
legacy('cobblestone', Block.Cobblestone, { hardness: 2, blast: 6, tool: PICK, needsTier: 0 });
legacy('sand', Block.Sand, { hardness: .5, blast: .5, tool: 'shovel', gravity: true });
legacy('oak_planks', Block.OakPlanks, { hardness: 2, blast: 3, tool: 'axe', flammable: true });
legacy('oak_leaves', Block.Leaves, { hardness: .2, blast: .2, tool: 'hoe', flammable: true, drop: '', extra: [['stick', .02], ['apple', .005]] });
legacy('birch_leaves', Block.BirchLeaves, { hardness: .2, blast: .2, tool: 'hoe', flammable: true, drop: '', extra: [['stick', .02]] });
legacy('spruce_leaves', Block.SpruceLeaves, { hardness: .2, blast: .2, tool: 'hoe', flammable: true, drop: '', extra: [['stick', .02]] });
legacy('water', Block.Water, { hardness: 100, blast: 100, drop: '', state: { level: 0 }, noItem: true });
legacy('sandstone', Block.Sandstone, { hardness: .8, blast: .8, tool: PICK, needsTier: 0 });
legacy('short_grass', Block.TallGrass, { hardness: 0, blast: 0, drop: '', flammable: true });
legacy('dandelion', Block.Dandelion, { hardness: 0, blast: 0 });
legacy('poppy', Block.Poppy, { hardness: 0, blast: 0 });
legacy('terracotta', Block.Terracotta, { hardness: 1.25, blast: 4.2, tool: PICK, needsTier: 0 });
legacy('basalt', Block.Basalt, { hardness: 1.25, blast: 4.2, tool: PICK, needsTier: 0 });
legacy('packed_snow', Block.PackedSnow, { hardness: .2, blast: .2, tool: 'shovel', drop: 'snowball', dropCount: 4 });
legacy('barrier', Block.Barrier, { hardness: -1, blast: 3600000, noItem: true });

// ── Stone and earth ─────────────────────────────────────────────────────────

const stoneLike = (name: string, top: Tile, hardness = 1.5, blast = 6): Base => ({ name, hardness, blast, tool: PICK, needsTier: 0, top });
cube('smooth_stone', { ...stoneLike('Smooth Stone', vt('smooth_stone') as Tile, 2) });
cube('stone_bricks', { ...stoneLike('Stone Bricks', vt('stone_bricks') as Tile) });
cube('chiseled_stone_bricks', { ...stoneLike('Chiseled Stone Bricks', vt('chiseled_stone_bricks') as Tile) });
cube('mossy_cobblestone', { ...stoneLike('Mossy Cobblestone', vt('mossy_cobblestone') as Tile, 2) });
cube('andesite', { ...stoneLike('Andesite', vt('andesite') as Tile) });
cube('polished_andesite', { ...stoneLike('Polished Andesite', vt('polished_andesite') as Tile) });
cube('diorite', { ...stoneLike('Diorite', vt('diorite') as Tile) });
cube('polished_diorite', { ...stoneLike('Polished Diorite', vt('polished_diorite') as Tile) });
cube('blackstone', { ...stoneLike('Blackstone', vt('blackstone') as Tile) });
cube('bedrock', { name: 'Bedrock', hardness: -1, blast: 3600000, top: vt('bedrock') as Tile });
cube('end_stone', { ...stoneLike('End Stone', vt('end_stone') as Tile, 3, 9) });
cube('bricks', { ...stoneLike('Bricks', vt('bricks') as Tile, 2) });
cube('quartz_block', { ...stoneLike('Block of Quartz', vt('quartz_top') as Tile, .8, .8), side: vt('quartz_side') as Tile });
cube('smooth_quartz', { ...stoneLike('Smooth Quartz Block', vt('quartz_top') as Tile, 2) });
cube('coarse_dirt', { name: 'Coarse Dirt', hardness: .5, blast: .5, tool: 'shovel', top: vt('coarse_dirt') as Tile });
cube('gravel', { name: 'Gravel', hardness: .6, blast: .6, tool: 'shovel', top: vt('gravel') as Tile, gravity: true, extra: [['flint', .1]] });
cube('red_sand', { name: 'Red Sand', hardness: .5, blast: .5, tool: 'shovel', top: vt('red_sand') as Tile, gravity: true });
cube('magma_block', { ...stoneLike('Magma Block', vt('magma') as Tile, .5, .5), emission: 3 });
cube('netherrack', { ...stoneLike('Netherrack', vt('netherrack') as Tile, .4, .4) });
cube('nether_bricks', { ...stoneLike('Nether Bricks', vt('nether_bricks') as Tile, 2) });
cube('soul_sand', { name: 'Soul Sand', hardness: .5, blast: .5, tool: 'shovel', top: vt('soul_sand') as Tile, move: 'soulSand' });
cube('glowstone', { name: 'Glowstone', hardness: .3, blast: .3, top: vt('glowstone') as Tile, emission: 15, drop: '' });
cube('obsidian', { ...stoneLike('Obsidian', vt('obsidian') as Tile, 50, 1200), needsTier: 3 });
cube('crying_obsidian', { ...stoneLike('Crying Obsidian', vt('crying_obsidian') as Tile, 50, 1200), needsTier: 3, emission: 10 });
cube('dirt_path', { name: 'Dirt Path', hardness: .65, blast: .65, tool: 'shovel', top: vt('grass_path') as Tile, side: Tile.Dirt, bottom: Tile.Dirt, drop: 'dirt' });

// Ores and storage blocks
cube('iron_ore', { ...stoneLike('Iron Ore', vt('iron_ore') as Tile, 3, 3), needsTier: 1, drop: 'raw_iron' });
cube('coal_ore', { ...stoneLike('Coal Ore', vt('coal_ore') as Tile, 3, 3), drop: 'coal' });
cube('gold_ore', { ...stoneLike('Gold Ore', vt('gold_ore') as Tile, 3, 3), needsTier: 2, drop: 'raw_gold' });
cube('diamond_ore', { ...stoneLike('Diamond Ore', vt('diamond_ore') as Tile, 3, 3), needsTier: 2, drop: 'diamond' });
cube('iron_block', { ...stoneLike('Block of Iron', vt('iron_block') as Tile, 5, 6), needsTier: 1 });
cube('gold_block', { ...stoneLike('Block of Gold', vt('gold_block') as Tile, 3, 6), needsTier: 2 });
cube('diamond_block', { ...stoneLike('Block of Diamond', vt('diamond_block') as Tile, 5, 6), needsTier: 2 });
cube('emerald_block', { ...stoneLike('Block of Emerald', vt('emerald_block') as Tile, 5, 6), needsTier: 2 });

// ── Wood ────────────────────────────────────────────────────────────────────

const woodBase = (name: string, top: Tile): Base => ({ name, hardness: 2, blast: 3, tool: 'axe', flammable: true, top });
pillar('oak_log', { ...woodBase('Oak Log', Tile.LogSide), blast: 2, endTile: Tile.LogTop, legacyY: Block.OakLog });
pillar('birch_log', { ...woodBase('Birch Log', Tile.BirchLogSide), blast: 2, endTile: Tile.BirchLogTop, legacyY: Block.BirchLog });
pillar('spruce_log', { ...woodBase('Spruce Log', Tile.SpruceLogSide), blast: 2, endTile: Tile.SpruceLogTop, legacyY: Block.SpruceLog });
pillar('dark_oak_log', { ...woodBase('Dark Oak Log', vt('dark_oak_log') as Tile), blast: 2, endTile: vt('dark_oak_log_top') as Tile });
pillar('stripped_spruce_log', { ...woodBase('Stripped Spruce Log', vt('stripped_spruce_log') as Tile), blast: 2, endTile: vt('stripped_spruce_top') as Tile });
cube('spruce_planks', woodBase('Spruce Planks', vt('spruce_planks') as Tile));
cube('birch_planks', woodBase('Birch Planks', vt('birch_planks') as Tile));
cube('dark_oak_planks', woodBase('Dark Oak Planks', vt('dark_oak_planks') as Tile));

// ── Stairs, slabs, fences, walls, panes ─────────────────────────────────────

const STAIR_SET: [string, string, Base][] = [
  ['oak', 'Oak', woodBase('Oak', Tile.Planks)],
  ['spruce', 'Spruce', woodBase('Spruce', vt('spruce_planks') as Tile)],
  ['birch', 'Birch', woodBase('Birch', vt('birch_planks') as Tile)],
  ['dark_oak', 'Dark Oak', woodBase('Dark Oak', vt('dark_oak_planks') as Tile)],
  ['cobblestone', 'Cobblestone', { ...stoneLike('Cobblestone', Tile.Cobblestone, 2) }],
  ['stone', 'Stone', { ...stoneLike('Stone', Tile.Stone) }],
  ['stone_brick', 'Stone Brick', { ...stoneLike('Stone Brick', vt('stone_bricks') as Tile) }],
  ['sandstone', 'Sandstone', { ...stoneLike('Sandstone', Tile.Sandstone, .8, .8), top: Tile.SandstoneTop, side: Tile.Sandstone, bottom: Tile.SandstoneTop }],
  ['quartz', 'Quartz', { ...stoneLike('Quartz', vt('quartz_top') as Tile, .8, .8), side: vt('quartz_side') as Tile }],
  ['brick', 'Brick', { ...stoneLike('Brick', vt('bricks') as Tile, 2) }],
  ['polished_andesite', 'Polished Andesite', { ...stoneLike('Polished Andesite', vt('polished_andesite') as Tile) }],
  ['blackstone', 'Blackstone', { ...stoneLike('Blackstone', vt('blackstone') as Tile) }],
];
const FULL_OF: Record<string, () => number> = {
  oak: () => Block.OakPlanks, spruce: () => VB.spruce_planks, birch: () => VB.birch_planks, dark_oak: () => VB.dark_oak_planks,
  cobblestone: () => Block.Cobblestone, stone: () => Block.Stone, stone_brick: () => VB.stone_bricks, sandstone: () => Block.Sandstone,
  quartz: () => VB.quartz_block, brick: () => VB.bricks, polished_andesite: () => VB.polished_andesite, blackstone: () => VB.blackstone,
};
for (const [key, label, base] of STAIR_SET) {
  stairs(`${key}_stairs`, { ...base, name: `${label} Stairs` });
  slab(`${key}_slab`, { ...base, name: `${label} Slab`, full: FULL_OF[key]() });
}
slab('smooth_stone_slab', { ...stoneLike('Smooth Stone Slab', vt('smooth_stone') as Tile, 2), full: VB.smooth_stone });
/** The full block a double slab of this family stands for (for recipes/drops). */
export function slabFull(family: string): number | undefined {
  const k = family.replace(/_slab$/, '');
  return k === 'smooth_stone' ? VB.smooth_stone : FULL_OF[k]?.();
}

const FENCE_POST: Box = [[px(6), 0, px(6)], [px(10), 1, px(10)]];
const FENCE_ARM: Box = [[px(7), px(6), 0], [px(9), px(15), px(6)]];
connecting('oak_fence', { ...woodBase('Oak Fence', Tile.Planks), post: FENCE_POST, arm: FENCE_ARM });
connecting('spruce_fence', { ...woodBase('Spruce Fence', vt('spruce_planks') as Tile), post: FENCE_POST, arm: FENCE_ARM });
const WALL_POST: Box = [[px(4), 0, px(4)], [px(12), 1, px(12)]];
const WALL_ARM: Box = [[px(5), 0, 0], [px(11), px(14), px(4)]];
connecting('stone_brick_wall', { ...stoneLike('Stone Brick Wall', vt('stone_bricks') as Tile), post: WALL_POST, arm: WALL_ARM });
connecting('andesite_wall', { ...stoneLike('Andesite Wall', vt('andesite') as Tile), post: WALL_POST, arm: WALL_ARM });
connecting('cobblestone_wall', { ...stoneLike('Cobblestone Wall', Tile.Cobblestone, 2), post: WALL_POST, arm: WALL_ARM });
const PANE_POST: Box = [[px(7), 0, px(7)], [px(9), 1, px(9)]];
const PANE_ARM: Box = [[px(7), 0, 0], [px(9), 1, px(7)]];
connecting('glass_pane', { name: 'Glass Pane', hardness: .3, blast: .3, top: Tile.Glass, post: PANE_POST, arm: PANE_ARM, dropNothing: true });
connecting('iron_bars', { ...stoneLike('Iron Bars', vt('iron_bars') as Tile, 5, 6), post: PANE_POST, arm: PANE_ARM });

// ── Colours: wool, concrete, terracotta, stained glass, carpet ──────────────

export const DYE_KEYS = DYES.map(([k]) => k);
for (const [key, label] of DYES) {
  cube(`${key}_wool`, { name: `${label} Wool`, hardness: .8, blast: .8, tool: 'shears', flammable: true, top: vt(`${key}_wool`) as Tile });
  cube(`${key}_concrete`, { ...stoneLike(`${label} Concrete`, vt(`${key}_concrete`) as Tile, 1.8, 1.8) });
  cube(`${key}_terracotta`, { ...stoneLike(`${label} Terracotta`, vt(`${key}_terracotta`) as Tile, 1.25, 4.2) });
  cube(`${key}_stained_glass`, { name: `${label} Stained Glass`, hardness: .3, blast: .3, top: vt(`${key}_stained_glass`) as Tile, opaque: false, drop: '' });
  add(`${key}_carpet`, def({
    name: `${label} Carpet`, hardness: .1, top: vt(`${key}_wool`) as Tile, shape: 'box', boxes: [[[0, 0, 0], [1, px(1), 1]]], opaque: false, occludes: false,
  }), { hardness: .1, blast: .1, flammable: true, sturdy: false });
}
cube('glass', { name: 'Glass', hardness: .3, blast: .3, top: Tile.Glass, opaque: false, drop: '' });

// ── Utility blocks ──────────────────────────────────────────────────────────

const OAKT = Tile.Planks;
cube('crafting_table', {
  ...woodBase('Crafting Table', vt('crafting_table_top') as Tile), hardness: 2.5, blast: 2.5,
  faces: [vt('crafting_table_side'), vt('crafting_table_side'), OAKT, vt('crafting_table_top'), vt('crafting_table_front'), vt('crafting_table_front')] as Tile[],
});
facingBlock('furnace', { ...stoneLike('Furnace', vt('furnace_top') as Tile, 3.5, 3.5), side: vt('furnace_side') as Tile, front: vt('furnace_front') as Tile, lit: vt('furnace_front_lit') as Tile });
facingBlock('smoker', { ...stoneLike('Smoker', vt('furnace_top') as Tile, 3.5, 3.5), side: vt('furnace_side') as Tile, front: vt('smoker_front') as Tile, lit: vt('furnace_front_lit') as Tile });
facingBlock('chest', {
  ...woodBase('Chest', vt('chest_top') as Tile), hardness: 2.5, blast: 2.5, side: vt('chest_side') as Tile, front: vt('chest_front') as Tile,
  box: [[px(1), 0, px(1)], [px(15), px(14), px(15)]],
});
facingBlock('loom', { ...woodBase('Loom', vt('loom_side') as Tile), hardness: 2.5, blast: 2.5, side: vt('loom_side') as Tile, front: vt('loom_side') as Tile });
cube('barrel', { ...woodBase('Barrel', vt('barrel_top') as Tile), hardness: 2.5, blast: 2.5, side: vt('barrel_side') as Tile, bottom: vt('barrel_top') as Tile });
cube('bookshelf', { ...woodBase('Bookshelf', OAKT), hardness: 1.5, blast: 1.5, side: vt('bookshelf') as Tile, drop: 'book', dropCount: 3 });
cube('tnt', { name: 'TNT', hardness: 0, blast: 0, top: vt('tnt_top') as Tile, side: vt('tnt_side') as Tile, bottom: vt('tnt_bottom') as Tile, flammable: true });
cube('slime_block', { name: 'Slime Block', hardness: 0, blast: 0, top: vt('slime') as Tile, opaque: false, move: 'slime' });
add('honey_block', def({
  name: 'Honey Block', hardness: 0, top: vt('honey') as Tile, shape: 'box', boxes: [[[px(1), 0, px(1)], [px(15), px(15), px(15)]]], opaque: false, occludes: false,
}), { hardness: 0, blast: 0, move: 'honey', sturdy: false });
pillar('hay_block', { name: 'Hay Bale', hardness: .5, blast: .5, tool: 'hoe', flammable: true, top: vt('hay_side') as Tile, endTile: vt('hay_top') as Tile });
for (const id of VFAMILY.hay_block) VMETA[id]!.move = 'hay';
cube('powder_snow', { name: 'Powder Snow', hardness: .25, blast: .25, top: vt('powder_snow') as Tile, solid: false, move: 'powderSnow', drop: '' });
cube('snow_block', { name: 'Snow Block', hardness: .2, blast: .2, tool: 'shovel', top: vt('snow_block') as Tile, drop: 'snowball', dropCount: 4 });
cube('ice', { name: 'Ice', hardness: .5, blast: .5, tool: PICK, top: vt('ice') as Tile, opaque: false, drop: '', move: 'ice', lightAtt: 1 });
cube('packed_ice', { name: 'Packed Ice', hardness: .5, blast: .5, tool: PICK, top: vt('packed_ice') as Tile, drop: '', move: 'packedIce' });
cube('blue_ice', { name: 'Blue Ice', hardness: 2.8, blast: 2.8, tool: PICK, top: vt('blue_ice') as Tile, drop: '', move: 'blueIce' });
add('cobweb', def({ name: 'Cobweb', hardness: 4, top: vt('cobweb') as Tile, shape: 'cross', solid: false, opaque: false, occludes: false }),
  { hardness: 4, blast: 4, tool: 'sword', move: 'cobweb', drop: 'string', sturdy: false });
add('scaffolding', def({
  name: 'Scaffolding', hardness: 0, top: vt('scaffolding') as Tile, opaque: false, occludes: false,
  collide: [[[0, px(14), 0], [1, 1, 1]]],
}), { hardness: 0, blast: 0, move: 'scaffold', flammable: true, sturdy: false });
for (const facing of FACINGS) {
  const box = rotBox([[0, 0, px(13)], [1, 1, 1]], facing);
  add('ladder', def({ name: 'Ladder', hardness: .4, top: vt('ladder') as Tile, shape: 'box', boxes: [box], opaque: false, occludes: false }),
    { hardness: .4, blast: .4, tool: 'axe', move: 'ladder', state: { facing }, sturdy: false });
}
add('torch', def({
  name: 'Torch', hardness: 0, top: vt('torch') as Tile, shape: 'cross', solid: false, opaque: false, occludes: false, emission: 14,
}), { hardness: 0, blast: 0, sturdy: false });
for (const hanging of [false, true]) {
  const box: Box = hanging ? [[px(5), px(1), px(5)], [px(11), px(10), px(11)]] : [[px(5), 0, px(5)], [px(11), px(9), px(11)]];
  add('lantern', def({ name: 'Lantern', hardness: 3.5, top: vt('lantern') as Tile, shape: 'box', boxes: [box], opaque: false, occludes: false, emission: 15 }),
    { hardness: 3.5, blast: 3.5, tool: PICK, needsTier: 0, state: { hanging }, sturdy: false });
}
cube('sea_lantern', { name: 'Sea Lantern', hardness: .3, blast: .3, top: vt('sea_lantern') as Tile, emission: 15, drop: '' });
cube('redstone_lamp', { name: 'Redstone Lamp', hardness: .3, blast: .3, top: vt('redstone_lamp') as Tile, emission: 15 });
add('lightning_rod', def({ name: 'Lightning Rod', hardness: 3, top: vt('lightning_rod') as Tile, shape: 'box', boxes: [[[px(6), 0, px(6)], [px(10), 1, px(10)]]], opaque: false, occludes: false }),
  { hardness: 3, blast: 6, tool: PICK, needsTier: 0, sturdy: false });
add('bell', def({ name: 'Bell', hardness: 5, top: vt('bell') as Tile, shape: 'box', boxes: [[[px(4), px(4), px(4)], [px(12), px(13), px(12)]], [[px(7), px(13), px(7)], [px(9), 1, px(9)]]], opaque: false, occludes: false }),
  { hardness: 5, blast: 5, tool: PICK, sturdy: false });
add('cake', def({ name: 'Cake', hardness: .5, top: vt('cake_top') as Tile, side: vt('cake_side') as Tile, bottom: vt('cake_side') as Tile, shape: 'box', boxes: [[[px(1), 0, px(1)], [px(15), px(8), px(15)]]], opaque: false, occludes: false }),
  { hardness: .5, blast: .5, drop: '', sturdy: false });
cube('target', { name: 'Target', hardness: .5, blast: .5, tool: 'hoe', top: vt('target_side') as Tile });
cube('spawner', { ...stoneLike('Spawner', vt('spawner') as Tile, 5, 5), opaque: false, drop: '' });
for (const axis of ['x', 'z'] as Axis[]) {
  const f: Facing = axis === 'x' ? 'n' : 'e';
  const boxes: Box[] = [
    [[px(2), 0, px(2)], [px(14), px(4), px(14)]], [[px(4), px(4), px(3)], [px(12), px(5), px(13)]],
    [[px(6), px(5), px(4)], [px(10), px(10), px(12)]], [[0, px(10), px(3)], [1, 1, px(13)]],
  ].map((b) => rotBox(b as Box, f));
  add('anvil', def({ name: 'Anvil', hardness: 5, top: vt('anvil_top') as Tile, side: vt('anvil_side') as Tile, shape: 'box', boxes, opaque: false, occludes: false }),
    { hardness: 5, blast: 1200, tool: PICK, needsTier: 0, gravity: true, state: { axis }, sturdy: false });
}

// Doors and trapdoors
for (const half of ['lower', 'upper']) for (const facing of FACINGS) for (const open of [false, true]) {
  const local: Box = open ? [[0, 0, 0], [px(3), 1, 1]] : [[0, 0, px(13)], [1, 1, 1]];
  const tile = vt(half === 'lower' ? 'oak_door_lower' : 'oak_door_upper') as Tile;
  add('oak_door', def({ name: 'Oak Door', hardness: 3, top: tile, shape: 'box', boxes: [rotBox(local, facing)], opaque: false, occludes: false }),
    { hardness: 3, blast: 3, tool: 'axe', flammable: true, state: { half, facing, open }, drop: half === 'upper' ? '' : undefined, sturdy: false });
}
for (const [family, label, tile, hardness, tool] of [
  ['oak_trapdoor', 'Oak Trapdoor', 'oak_trapdoor', 3, 'axe'], ['iron_trapdoor', 'Iron Trapdoor', 'iron_trapdoor', 5, PICK],
] as const) {
  for (const half of ['bottom', 'top']) for (const facing of FACINGS) for (const open of [false, true]) {
    const local: Box = open ? [[0, 0, px(13)], [1, 1, 1]] : half === 'bottom' ? [[0, 0, 0], [1, px(3), 1]] : [[0, px(13), 0], [1, 1, 1]];
    add(family, def({ name: label, hardness, top: vt(tile) as Tile, shape: 'box', boxes: [rotBox(local, facing)], opaque: false, occludes: false }),
      { hardness, blast: hardness, tool, needsTier: tool === PICK ? 0 : undefined, flammable: tool === 'axe', state: { half, facing, open }, sturdy: false });
  }
}

// Snow layers 1..8 (layer 1 has no collision in vanilla; n layers collide at n-1).
for (let layers = 1; layers <= 8; layers++) {
  add('snow', def({
    name: 'Snow', hardness: .1, top: vt('snow_block') as Tile, shape: layers === 8 ? 'cube' : 'box',
    boxes: layers === 8 ? undefined : [[[0, 0, 0], [1, layers / 8, 1]]], opaque: layers === 8, occludes: layers === 8,
    collide: layers === 1 ? [] : layers === 8 ? undefined : [[[0, 0, 0], [1, (layers - 1) / 8, 1]]],
  }), { hardness: .1, blast: .1, tool: 'shovel', drop: 'snowball', dropCount: layers, state: { layers }, sturdy: layers === 8 });
}

// Fluids: legacy Water is the water source; flowing levels 1..8 and lava 0..8.
for (let level = 1; level <= 8; level++) {
  add('water', def({
    name: 'Water', hardness: -1, top: Tile.Water, tint: 'water', solid: false, opaque: false, occludes: false,
    fluid: { kind: 'water', level }, lightAtt: 2,
  }), { hardness: 100, blast: 100, drop: '', state: { level }, noItem: true, sturdy: false });
}
for (let level = 0; level <= 8; level++) {
  add('lava', def({
    name: 'Lava', hardness: -1, top: vt('lava') as Tile, solid: false, opaque: false, occludes: false, emission: 15,
    fluid: { kind: 'lava', level },
  }), { hardness: 100, blast: 100, drop: '', state: { level }, noItem: true, sturdy: false });
}
add('fire', def({ name: 'Fire', hardness: 0, top: vt('fire') as Tile, shape: 'cross', solid: false, opaque: false, occludes: false, emission: 15, replaceable: true }),
  { hardness: 0, blast: 0, drop: '', noItem: true, sturdy: false });
BLOCKS[VB.short_grass].replaceable = true;

// ── Party Games arenas (appended so earlier ids stay put) ────────────────

cube('quartz_bricks', { ...stoneLike('Quartz Bricks', vt('quartz_bricks') as Tile, .8, .8) });
pillar('quartz_pillar', { ...stoneLike('Quartz Pillar', vt('quartz_pillar_side') as Tile, .8, .8), endTile: vt('quartz_pillar_top') as Tile });
cube('chiseled_quartz_block', { ...stoneLike('Chiseled Quartz Block', vt('chiseled_quartz') as Tile, .8, .8) });
cube('deepslate', { ...stoneLike('Deepslate', vt('deepslate') as Tile, 3, 6) });
cube('polished_deepslate', { ...stoneLike('Polished Deepslate', vt('polished_deepslate') as Tile, 3.5, 6) });
cube('polished_blackstone_bricks', { ...stoneLike('Polished Blackstone Bricks', vt('polished_blackstone_bricks') as Tile) });
cube('red_nether_bricks', { ...stoneLike('Red Nether Bricks', vt('red_nether_bricks') as Tile, 2) });
stairs('red_nether_brick_stairs', { ...stoneLike('Red Nether Brick Stairs', vt('red_nether_bricks') as Tile, 2) });
slab('smooth_quartz_slab', { ...stoneLike('Smooth Quartz Slab', vt('quartz_top') as Tile, 2), full: VB.smooth_quartz });
pillar('jungle_log', { ...woodBase('Jungle Log', vt('jungle_log') as Tile), blast: 2, endTile: vt('jungle_log_top') as Tile });
add('jungle_leaves', def({ name: 'Jungle Leaves', hardness: .2, top: vt('jungle_leaves') as Tile, opaque: false, lightAtt: 1 }),
  { hardness: .2, blast: .2, tool: 'hoe', flammable: true, drop: '', extra: [['stick', .02]] });
pillar('cherry_log', { ...woodBase('Cherry Log', Tile.CherryLogSide), blast: 2, endTile: Tile.CherryLogTop, legacyY: Block.CherryLog });
legacy('cherry_leaves', Block.CherryLeaves, { hardness: .2, blast: .2, tool: 'hoe', flammable: true, drop: '' });
pillar('stripped_oak_log', { ...woodBase('Stripped Oak Log', vt('stripped_oak_log') as Tile), blast: 2, endTile: vt('stripped_oak_top') as Tile });
pillar('stripped_dark_oak_log', { ...woodBase('Stripped Dark Oak Log', vt('stripped_dark_oak_log') as Tile), blast: 2, endTile: vt('stripped_dark_oak_top') as Tile });
cube('stripped_spruce_wood', woodBase('Stripped Spruce Wood', vt('stripped_spruce_log') as Tile));
cube('stripped_dark_oak_wood', woodBase('Stripped Dark Oak Wood', vt('stripped_dark_oak_log') as Tile));
cube('mud', { name: 'Mud', hardness: .5, blast: .5, tool: 'shovel', top: vt('mud') as Tile });
cube('moss_block', { name: 'Moss Block', hardness: .1, blast: .1, tool: 'hoe', top: vt('moss_block') as Tile });
cube('shroomlight', { name: 'Shroomlight', hardness: 1, blast: 1, tool: 'hoe', top: vt('shroomlight') as Tile, emission: 15 });
cube('suspicious_sand', { name: 'Suspicious Sand', hardness: .25, blast: .25, tool: 'shovel', top: vt('suspicious_sand') as Tile, drop: '' });
cube('tinted_glass', { name: 'Tinted Glass', hardness: .3, blast: .3, top: vt('tinted_glass') as Tile, opaque: false });
cube('waxed_copper_block', { ...stoneLike('Waxed Block of Copper', vt('waxed_copper') as Tile, 3, 6) });
facingBlock('carved_pumpkin', { name: 'Carved Pumpkin', hardness: 1, blast: 1, tool: 'axe', top: vt('pumpkin_top') as Tile, side: vt('pumpkin_side') as Tile, front: vt('carved_pumpkin') as Tile });
cube('smithing_table', { ...woodBase('Smithing Table', vt('smithing_top') as Tile), hardness: 2.5, blast: 2.5, side: vt('smithing_side') as Tile, bottom: Tile.Planks });
cube('fletching_table', { ...woodBase('Fletching Table', vt('birch_planks') as Tile), hardness: 2.5, blast: 2.5, side: vt('crafting_table_side') as Tile });
cube('cartography_table', { ...woodBase('Cartography Table', vt('dark_oak_planks') as Tile), hardness: 2.5, blast: 2.5, side: vt('crafting_table_side') as Tile });
for (const facing of FACINGS) {
  add('decorated_pot', def({ name: 'Decorated Pot', hardness: 0, top: vt('decorated_pot') as Tile, shape: 'box', boxes: [[[px(1), 0, px(1)], [px(15), 1, px(15)]]], opaque: false, occludes: false }),
    { hardness: 0, blast: 0, state: { facing }, sturdy: false });
}
for (const color of ['orange', 'cyan', 'magenta', 'lime']) {
  facingBlock(`${color}_glazed_terracotta`, { ...stoneLike(`Glazed Terracotta`, vt(`${color}_glazed`) as Tile, 1.4, 1.4), side: vt(`${color}_glazed`) as Tile, front: vt(`${color}_glazed`) as Tile });
}
connecting('birch_fence', { ...woodBase('Birch Fence', vt('birch_planks') as Tile), post: FENCE_POST, arm: FENCE_ARM });
connecting('dark_oak_fence', { ...woodBase('Dark Oak Fence', vt('dark_oak_planks') as Tile), post: FENCE_POST, arm: FENCE_ARM });
for (const [key, label] of DYES) {
  connecting(`${key}_stained_glass_pane`, { name: `${label} Stained Glass Pane`, hardness: .3, blast: .3, top: vt(`${key}_stained_glass`) as Tile, post: PANE_POST, arm: PANE_ARM, dropNothing: true });
}
for (const half of ['lower', 'upper']) for (const facing of FACINGS) for (const open of [false, true]) {
  const local: Box = open ? [[0, 0, 0], [px(3), 1, 1]] : [[0, 0, px(13)], [1, 1, 1]];
  const tile = vt(half === 'lower' ? 'spruce_door_lower' : 'spruce_door_upper') as Tile;
  add('spruce_door', def({ name: 'Spruce Door', hardness: 3, top: tile, shape: 'box', boxes: [rotBox(local, facing)], opaque: false, occludes: false }),
    { hardness: 3, blast: 3, tool: 'axe', flammable: true, state: { half, facing, open }, drop: half === 'upper' ? '' : undefined, sturdy: false });
}
for (const half of ['bottom', 'top']) for (const facing of FACINGS) for (const open of [false, true]) {
  const local: Box = open ? [[0, 0, px(13)], [1, 1, 1]] : half === 'bottom' ? [[0, 0, 0], [1, px(3), 1]] : [[0, px(13), 0], [1, 1, 1]];
  add('spruce_trapdoor', def({ name: 'Spruce Trapdoor', hardness: 3, top: vt('spruce_trapdoor') as Tile, shape: 'box', boxes: [rotBox(local, facing)], opaque: false, occludes: false }),
    { hardness: 3, blast: 3, tool: 'axe', flammable: true, state: { half, facing, open }, sturdy: false });
}
cube('raw_gold_block', { ...stoneLike('Block of Raw Gold', vt('raw_gold_block') as Tile, 5, 6), needsTier: 2 });
cube('brown_mushroom_block', { name: 'Brown Mushroom Block', hardness: .2, blast: .2, tool: 'axe', top: vt('mushroom_cap') as Tile, drop: '' });

// Survival arena materials. Appended to keep all existing state ids stable.
cube('polished_blackstone', stoneLike('Polished Blackstone', vt('blackstone') as Tile, 1.5));
cube('polished_granite', stoneLike('Polished Granite', vt('polished_andesite') as Tile, 1.5));
cube('tuff', stoneLike('Tuff', vt('andesite') as Tile, 1.5));
cube('deepslate_bricks', stoneLike('Deepslate Bricks', vt('polished_blackstone_bricks') as Tile, 3.5));
cube('deepslate_tiles', stoneLike('Deepslate Tiles', vt('deepslate') as Tile, 3.5));
cube('chiseled_nether_bricks', stoneLike('Chiseled Nether Bricks', vt('nether_bricks') as Tile, 2));
cube('chiseled_polished_blackstone', stoneLike('Chiseled Polished Blackstone', vt('blackstone') as Tile, 1.5));
cube('crimson_planks', woodBase('Crimson Planks', vt('crimson_planks') as Tile));
stairs('crimson_stairs', woodBase('Crimson Stairs', vt('crimson_planks') as Tile));
cube('warped_planks', woodBase('Warped Planks', vt('warped_planks') as Tile));
stairs('warped_stairs', woodBase('Warped Stairs', vt('warped_planks') as Tile));
stairs('deepslate_tile_stairs', stoneLike('Deepslate Tile Stairs', vt('deepslate') as Tile, 3.5));
slab('polished_blackstone_brick_slab', { ...stoneLike('Polished Blackstone Brick Slab', vt('polished_blackstone_bricks') as Tile), full: VB.polished_blackstone_bricks });
connecting('nether_brick_fence', { ...stoneLike('Nether Brick Fence', vt('nether_bricks') as Tile, 2), post: FENCE_POST, arm: FENCE_ARM });
cube('ochre_froglight', {name:'Ochre Froglight',hardness:.3,blast:.3,top:vt('sea_lantern') as Tile,emission:15});
cube('azalea_leaves',{name:'Azalea Leaves',hardness:.2,blast:.2,tool:'hoe',top:vt('oak_leaves_vanilla') as Tile,opaque:false});
cube('note_block', {...woodBase('Note Block',vt('note_block') as Tile), hardness:.8,blast:.8});
cube('jukebox', {...woodBase('Jukebox',vt('note_block') as Tile), top:vt('jukebox_top') as Tile});
add('end_rod',def({name:'End Rod',hardness:0,top:vt('quartz_side') as Tile,shape:'box',boxes:[[[.4375,0,.4375],[.5625,1,.5625]]],opaque:false,occludes:false,emission:14}),{hardness:0,blast:0,sturdy:false});
facingBlock('blast_furnace', {...stoneLike('Blast Furnace',vt('iron_block') as Tile,3.5),side:vt('furnace_side') as Tile,front:vt('furnace_front') as Tile,lit:vt('furnace_front_lit') as Tile,emission:13});
for (const facing of FACINGS) {
  add('grindstone',def({name:'Grindstone',hardness:2,top:vt('smooth_stone') as Tile,shape:'box',boxes:[[[.125,0,.25],[.875,.875,.75]]],opaque:false,occludes:false}),{hardness:2,blast:6,tool:'pickaxe',state:{facing},sturdy:false});
  add('yellow_banner',def({name:'Yellow Banner',hardness:1,top:vt('yellow_wool') as Tile,shape:'box',boxes:[[[.25,0,.4375],[.75,1,.5625]]],opaque:false,occludes:false}),{hardness:1,blast:1,tool:'axe',state:{facing},sturdy:false});
}
for(const half of ['lower','upper'])for(const facing of FACINGS)for(const open of [false,true]){
  const local:Box=open?[[0,0,0],[px(3),1,1]]:[[0,0,px(13)],[1,1,1]];
  add('dark_oak_door',def({name:'Dark Oak Door',hardness:3,top:vt('dark_oak_planks') as Tile,shape:'box',boxes:[rotBox(local,facing)],opaque:false,occludes:false}),{hardness:3,blast:3,tool:'axe',flammable:true,state:{half,facing,open},drop:half==='upper'?'':undefined,sturdy:false});
}
for(const axis of ['x','z'])add('chipped_anvil',def({name:'Chipped Anvil',hardness:5,top:vt('anvil_top') as Tile,side:vt('anvil_side') as Tile,shape:'box',boxes:[[[.125,0,.125],[.875,.25,.875]],[[.25,.25,.25],[.75,.625,.75]],[[0,.625,.1875],[1,1,.8125]]],opaque:false,occludes:false}),{hardness:5,blast:1200,tool:'pickaxe',needsTier:0,state:{axis},sturdy:false});

// Race arena materials.
cube('mossy_stone_bricks',stoneLike('Mossy Stone Bricks',vt('stone_bricks') as Tile,1.5));
cube('cracked_stone_bricks',stoneLike('Cracked Stone Bricks',vt('stone_bricks') as Tile,1.5));
cube('smooth_basalt',stoneLike('Smooth Basalt',vt('blackstone') as Tile,1.25));
cube('end_stone_bricks',stoneLike('End Stone Bricks',vt('end_stone') as Tile,3));
cube('calcite',stoneLike('Calcite',vt('diorite') as Tile,0.75));
cube('amethyst_block',stoneLike('Amethyst Block',vt('purple_concrete') as Tile,1.5));
cube('cracked_polished_blackstone_bricks',stoneLike('Cracked Polished Blackstone Bricks',vt('polished_blackstone_bricks') as Tile,1.5));
cube('polished_basalt',stoneLike('Polished Basalt',vt('blackstone') as Tile,1.25));
cube('cracked_nether_bricks',stoneLike('Cracked Nether Bricks',vt('nether_bricks') as Tile,2));
cube('cobbled_deepslate',stoneLike('Cobbled Deepslate',vt('deepslate') as Tile,3.5));
cube('gilded_blackstone',stoneLike('Gilded Blackstone',vt('blackstone') as Tile,1.5));
pillar('purpur_pillar',{...stoneLike('Purpur Pillar',vt('purple_concrete') as Tile,1.5),endTile:vt('magenta_concrete') as Tile});
add('hanging_roots',def({name:'Hanging Roots',hardness:0,top:Tile.TallGrass,solid:false,opaque:false,occludes:false,shape:'cross'}),{hardness:0,blast:0});
cube('dark_oak_leaves',{name:'Dark Oak Leaves',hardness:.2,blast:.2,tool:'hoe',top:vt('oak_leaves_vanilla') as Tile,opaque:false});
stairs('smooth_quartz_stairs',stoneLike('Smooth Quartz Stairs',vt('quartz_top') as Tile,2));
for(const half of ['bottom','top'])for(const facing of FACINGS)for(const open of [false,true]){
const local:Box=open?[[0,0,px(13)],[1,1,1]]:half==='bottom'?[[0,0,0],[1,px(3),1]]:[[0,px(13),0],[1,1,1]];
add('birch_trapdoor',def({name:'Birch Trapdoor',hardness:3,top:vt('birch_planks') as Tile,shape:'box',boxes:[rotBox(local,facing)],opaque:false,occludes:false}),{hardness:3,blast:3,tool:'axe',flammable:true,state:{half,facing,open},sturdy:false});}
// Remaining Party Games scenery and course materials.
cube('smooth_sandstone',stoneLike('Smooth Sandstone',vt('sandstone_cut') as Tile,2));
cube('cut_sandstone',stoneLike('Cut Sandstone',vt('sandstone_cut') as Tile,0.8));
cube('chiseled_sandstone',stoneLike('Chiseled Sandstone',vt('sandstone_cut') as Tile,0.8));
cube('red_sandstone',stoneLike('Red Sandstone',vt('red_sandstone') as Tile,0.8));
cube('smooth_red_sandstone',stoneLike('Smooth Red Sandstone',vt('red_sandstone') as Tile,2));
cube('granite',stoneLike('Granite',vt('granite') as Tile,1.5));
cube('mud_bricks',stoneLike('Mud Bricks',vt('mud_bricks') as Tile,1.5));
cube('packed_mud',stoneLike('Packed Mud',vt('packed_mud') as Tile,1));
cube('purpur_block',stoneLike('Purpur Block',vt('purpur') as Tile,1.5));
cube('soul_soil',stoneLike('Soul Soil',vt('soul_soil') as Tile,0.5));
cube('crimson_nylium',stoneLike('Crimson Nylium',vt('nylium') as Tile,0.4));
cube('jungle_planks',woodBase('Jungle Planks',vt('jungle_planks') as Tile));
cube('stripped_jungle_wood',woodBase('Stripped Jungle Wood',vt('jungle_planks') as Tile));
slab('smooth_sandstone_slab',{...stoneLike('Smooth Sandstone Slab',vt('sandstone_cut') as Tile),full:VB.smooth_sandstone});
slab('andesite_slab',{...stoneLike('Andesite Slab',vt('andesite') as Tile),full:VB.andesite});
slab('granite_slab',{...stoneLike('Granite Slab',vt('granite') as Tile),full:VB.granite});
slab('cobbled_deepslate_slab',{...stoneLike('Cobbled Deepslate Slab',vt('deepslate') as Tile),full:VB.cobbled_deepslate});
slab('mud_brick_slab',{...stoneLike('Mud Brick Slab',vt('mud_bricks') as Tile),full:VB.mud_bricks});
slab('jungle_slab',{...stoneLike('Jungle Slab',vt('jungle_planks') as Tile),full:VB.jungle_planks});
connecting('cherry_fence',{...woodBase('Cherry Fence',Tile.CherryPlanks),post:FENCE_POST,arm:FENCE_ARM});
cube('podzol',{name:'Podzol',hardness:.5,blast:.5,tool:'shovel',top:vt('podzol') as Tile,side:Tile.Dirt,bottom:Tile.Dirt});
cube('mycelium',{name:'Mycelium',hardness:.6,blast:.6,tool:'shovel',top:vt('mycelium') as Tile,side:Tile.Dirt,bottom:Tile.Dirt});
cube('mushroom_stem',{name:'Mushroom Stem',hardness:.2,blast:.2,tool:'axe',top:vt('mushroom_stem') as Tile});
cube('red_mushroom_block',{name:'Red Mushroom Block',hardness:.2,blast:.2,tool:'axe',top:vt('red_mushroom') as Tile});
cube('composter',woodBase('Composter',vt('barrel_side') as Tile));
cube('farmland',{name:'Farmland',hardness:.6,blast:.6,tool:'shovel',top:vt('coarse_dirt') as Tile,side:Tile.Dirt});
add('cornflower',def({name:'Cornflower',hardness:0,top:Tile.Poppy,solid:false,opaque:false,occludes:false,shape:'cross'}),{hardness:0,blast:0});
add('oxeye_daisy',def({name:'Oxeye Daisy',hardness:0,top:Tile.Dandelion,solid:false,opaque:false,occludes:false,shape:'cross'}),{hardness:0,blast:0});
add('blue_orchid',def({name:'Blue Orchid',hardness:0,top:Tile.Poppy,solid:false,opaque:false,occludes:false,shape:'cross'}),{hardness:0,blast:0});
add('fern',def({name:'Fern',hardness:0,top:Tile.TallGrass,solid:false,opaque:false,occludes:false,shape:'cross'}),{hardness:0,blast:0});
add('wheat',def({name:'Wheat',hardness:0,top:Tile.TallGrass,solid:false,opaque:false,occludes:false,shape:'cross'}),{hardness:0,blast:0});
add('cocoa',def({name:'Cocoa',hardness:0,top:Tile.Poppy,solid:false,opaque:false,occludes:false,shape:'cross'}),{hardness:0,blast:0});
add('lily_pad',def({name:'Lily Pad',hardness:0,top:vt('lime_concrete') as Tile,shape:'box',boxes:[[[0,0,0],[1,.0625,1]]],opaque:false,occludes:false}),{hardness:0,blast:0,sturdy:false});
cube('cactus',{name:'Cactus',hardness:.4,blast:.4,top:vt('cactus') as Tile});
facingBlock('yellow_glazed_terracotta',{...stoneLike('Yellow Glazed Terracotta',vt('yellow_glazed') as Tile,1.4),side:vt('yellow_glazed') as Tile,front:vt('yellow_glazed') as Tile});
for(const family of ['birch_door','acacia_door'])for(const half of ['lower','upper'])for(const facing of FACINGS)for(const open of [false,true]){
 const local:Box=open?[[0,0,0],[px(3),1,1]]:[[0,0,px(13)],[1,1,1]];
 add(family,def({name:family==='birch_door'?'Birch Door':'Acacia Door',hardness:3,top:vt(family==='birch_door'?'birch_planks':'jungle_planks') as Tile,shape:'box',boxes:[rotBox(local,facing)],opaque:false,occludes:false}),{hardness:3,blast:3,tool:'axe',flammable:true,state:{half,facing,open},drop:half==='upper'?'':undefined,sturdy:false});
}
/** Highest id handed out (for tests and the overlap check). */
pillar('stripped_birch_log', { ...woodBase('Stripped Birch Log', vt('birch_planks') as Tile), blast: 2, endTile: vt('birch_planks') as Tile });
slab('cut_sandstone_slab', { ...stoneLike('Cut Sandstone Slab', vt('sandstone_cut') as Tile, .8), full: VB.cut_sandstone });
export const VANILLA_BLOCK_LAST = next - 1;

export function vmeta(id: number): VBlockMeta | undefined { return VMETA[id]; }
export function familyOf(id: number): string | undefined { return VMETA[id]?.family; }
export function isFluid(id: number, kind?: 'water' | 'lava'): boolean {
  const f = BLOCKS[id]?.fluid;
  return !!f && (!kind || f.kind === kind);
}
export function fluidLevel(id: number): number { return BLOCKS[id]?.fluid?.level ?? -1; }
/** Water at a level (0 = source). */
export function waterAt(level: number): number { return level === 0 ? Block.Water : stateId('water', { level })!; }
export function lavaAt(level: number): number { return stateId('lava', { level })!; }

/** Blocks you move through or climb rather than stand on (the server's
 *  movement check treats them like water). */
export function isClimbOrSoft(id: number): boolean {
  const m = VMETA[id]?.move;
  return m === 'ladder' || m === 'scaffold' || m === 'cobweb' || m === 'powderSnow' || m === 'honey' || m === 'slime';
}
