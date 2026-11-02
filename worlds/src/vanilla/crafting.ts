// Crafting (2×2 inventory grid and 3×3 table) and furnace smelting, Java
// Edition recipes. Shaped recipes match anywhere in the grid and mirrored;
// `#tags` accept any member (any planks, any log, any wool, coal/charcoal).
// The set is the main general recipes plus everything the modes need.

import { DYE_KEYS } from './blocks';
import { VI, VITEM } from './items';
import type { VStack } from './stack';

const PLANKS = ['oak_planks', 'spruce_planks', 'birch_planks', 'dark_oak_planks'];
const LOGS = ['oak_log', 'birch_log', 'spruce_log', 'dark_oak_log', 'stripped_spruce_log'];
const TAGS: Record<string, string[]> = {
  '#planks': PLANKS,
  '#logs': LOGS,
  '#wool': DYE_KEYS.map((k) => `${k}_wool`),
  '#coals': ['coal', 'charcoal'],
  '#stone_tool': ['cobblestone', 'blackstone'],
};

interface Recipe {
  out: string; count: number;
  /** Shaped rows ('' = shapeless). */
  rows?: string[];
  key?: Record<string, string>;
  /** Shapeless ingredients. */
  items?: string[];
}
const R: Recipe[] = [];
const shaped = (out: string, count: number, rows: string[], key: Record<string, string>) => R.push({ out, count, rows, key });
const shapeless = (out: string, count: number, items: string[]) => R.push({ out, count, items });

// Wood
const PLANK_OF: Record<string, string> = { oak_log: 'oak_planks', birch_log: 'birch_planks', spruce_log: 'spruce_planks', dark_oak_log: 'dark_oak_planks', stripped_spruce_log: 'spruce_planks' };
for (const [log, plank] of Object.entries(PLANK_OF)) shapeless(plank, 4, [log]);
shaped('stick', 4, ['P', 'P'], { P: '#planks' });
shaped('crafting_table', 1, ['PP', 'PP'], { P: '#planks' });
shaped('chest', 1, ['PPP', 'P P', 'PPP'], { P: '#planks' });
shaped('barrel', 1, ['PSP', 'P P', 'PSP'], { P: '#planks', S: 'oak_slab' });
shaped('furnace', 1, ['CCC', 'C C', 'CCC'], { C: '#stone_tool' });
shaped('torch', 4, ['C', 'S'], { C: '#coals', S: 'stick' });
shaped('ladder', 3, ['S S', 'SSS', 'S S'], { S: 'stick' });
shaped('bowl', 4, ['P P', ' P '], { P: '#planks' });
shaped('oak_boat', 1, ['P P', 'PPP'], { P: 'oak_planks' });
shaped('oak_door', 3, ['PP', 'PP', 'PP'], { P: 'oak_planks' });
shaped('oak_trapdoor', 2, ['PPP', 'PPP'], { P: 'oak_planks' });
shaped('oak_fence', 3, ['PSP', 'PSP'], { P: 'oak_planks', S: 'stick' });
shaped('spruce_fence', 3, ['PSP', 'PSP'], { P: 'spruce_planks', S: 'stick' });
shaped('scaffolding', 6, ['SLS', 'S S', 'S S'], { S: 'stick', L: 'string' });
// Tools and weapons
const TOOL_MAT: [string, string][] = [['wooden', '#planks'], ['stone', '#stone_tool'], ['iron', 'iron_ingot'], ['golden', 'gold_ingot'], ['diamond', 'diamond']];
for (const [tier, mat] of TOOL_MAT) {
  shaped(`${tier}_pickaxe`, 1, ['MMM', ' S ', ' S '], { M: mat, S: 'stick' });
  shaped(`${tier}_axe`, 1, ['MM', 'MS', ' S'], { M: mat, S: 'stick' });
  shaped(`${tier}_shovel`, 1, ['M', 'S', 'S'], { M: mat, S: 'stick' });
  shaped(`${tier}_sword`, 1, ['M', 'M', 'S'], { M: mat, S: 'stick' });
  shaped(`${tier}_hoe`, 1, ['MM', ' S', ' S'], { M: mat, S: 'stick' });
}
const ARMOR_MAT: [string, string][] = [['leather', 'leather'], ['iron', 'iron_ingot'], ['golden', 'gold_ingot'], ['diamond', 'diamond']];
for (const [m, mat] of ARMOR_MAT) {
  shaped(`${m}_helmet`, 1, ['MMM', 'M M'], { M: mat });
  shaped(`${m}_chestplate`, 1, ['M M', 'MMM', 'MMM'], { M: mat });
  shaped(`${m}_leggings`, 1, ['MMM', 'M M', 'M M'], { M: mat });
  shaped(`${m}_boots`, 1, ['M M', 'M M'], { M: mat });
}
shaped('shield', 1, ['WIW', 'WWW', ' W '], { W: '#planks', I: 'iron_ingot' });
shaped('bow', 1, [' ST', 'S T', ' ST'], { S: 'stick', T: 'string' });
shaped('arrow', 4, ['F', 'S', 'E'], { F: 'flint', S: 'stick', E: 'feather' });
shaped('fishing_rod', 1, ['  S', ' ST', 'S T'], { S: 'stick', T: 'string' });
shaped('bucket', 1, ['I I', ' I '], { I: 'iron_ingot' });
shaped('shears', 1, [' I', 'I '], { I: 'iron_ingot' });
shapeless('flint_and_steel', 1, ['iron_ingot', 'flint']);
// Building
const SLAB_STAIR: [string, string][] = [
  ['oak', 'oak_planks'], ['spruce', 'spruce_planks'], ['birch', 'birch_planks'], ['dark_oak', 'dark_oak_planks'],
  ['cobblestone', 'cobblestone'], ['stone', 'stone'], ['stone_brick', 'stone_bricks'], ['sandstone', 'sandstone'],
  ['quartz', 'quartz_block'], ['brick', 'bricks'], ['polished_andesite', 'polished_andesite'], ['blackstone', 'blackstone'],
];
for (const [k, mat] of SLAB_STAIR) {
  shaped(`${k}_slab`, 6, ['MMM'], { M: mat });
  shaped(`${k}_stairs`, 4, ['M  ', 'MM ', 'MMM'], { M: mat });
}
shaped('smooth_stone_slab', 6, ['MMM'], { M: 'smooth_stone' });
shaped('stone_brick_wall', 6, ['MMM', 'MMM'], { M: 'stone_bricks' });
shaped('cobblestone_wall', 6, ['MMM', 'MMM'], { M: 'cobblestone' });
shaped('andesite_wall', 6, ['MMM', 'MMM'], { M: 'andesite' });
shaped('stone_bricks', 4, ['SS', 'SS'], { S: 'stone' });
shaped('polished_andesite', 4, ['SS', 'SS'], { S: 'andesite' });
shaped('polished_diorite', 4, ['SS', 'SS'], { S: 'diorite' });
shaped('glass_pane', 16, ['GGG', 'GGG'], { G: 'glass' });
shaped('iron_bars', 16, ['III', 'III'], { I: 'iron_ingot' });
shaped('iron_trapdoor', 1, ['II', 'II'], { I: 'iron_ingot' });
shaped('snow_block', 1, ['SS', 'SS'], { S: 'snowball' });
shaped('white_wool', 1, ['SS', 'SS'], { S: 'string' });
for (const d of DYE_KEYS) shaped(`${d}_carpet`, 3, ['WW'], { W: `${d}_wool` });
shapeless('book', 1, ['paper', 'paper', 'paper', 'leather']);
// Storage blocks
for (const [block, unit] of [['iron_block', 'iron_ingot'], ['gold_block', 'gold_ingot'], ['diamond_block', 'diamond'], ['emerald_block', 'emerald']] as const) {
  shaped(block, 1, ['UUU', 'UUU', 'UUU'], { U: unit });
  shapeless(unit, 9, [block]);
}
// Food
shaped('bread', 1, ['WWW'], { W: 'wheat' });
shaped('golden_apple', 1, ['GGG', 'GAG', 'GGG'], { G: 'gold_ingot', A: 'apple' });

function accepts(want: string, id: number): boolean {
  if (want.startsWith('#')) return (TAGS[want] ?? []).some((k) => VI[k] === id);
  return VI[want] === id;
}

/** Trim a W×H grid to its occupied bounding box. */
function trim(grid: (VStack | null)[], w: number): { cells: (VStack | null)[]; w: number; h: number } | null {
  const h = grid.length / w;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (grid[y * w + x]) {
    x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
  }
  if (x1 < 0) return null;
  const cw = x1 - x0 + 1, ch = y1 - y0 + 1, cells: (VStack | null)[] = [];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) cells.push(grid[y * w + x]);
  return { cells, w: cw, h: ch };
}

function matchShaped(r: Recipe, t: { cells: (VStack | null)[]; w: number; h: number }, mirror: boolean): boolean {
  const rows = r.rows!;
  const rw = Math.max(...rows.map((s) => s.length)), rh = rows.length;
  if (rw !== t.w || rh !== t.h) return false;
  for (let y = 0; y < rh; y++) for (let x = 0; x < rw; x++) {
    const ch = rows[y][mirror ? rw - 1 - x : x] ?? ' ';
    const cell = t.cells[y * rw + x];
    if (ch === ' ') { if (cell) return false; continue; }
    if (!cell || !accepts(r.key![ch], cell.id)) return false;
  }
  return true;
}
function matchShapeless(r: Recipe, t: { cells: (VStack | null)[] }): boolean {
  const have = t.cells.filter((c): c is VStack => !!c).map((c) => c.id);
  if (have.length !== r.items!.length) return false;
  const left = [...r.items!];
  for (const id of have) {
    const i = left.findIndex((want) => accepts(want, id));
    if (i < 0) return false;
    left.splice(i, 1);
  }
  return true;
}

/** The result of a crafting grid (`width` 2 or 3), or null. */
export function craftResult(grid: (VStack | null)[], width: number): VStack | null {
  const t = trim(grid, width);
  if (!t) return null;
  for (const r of R) {
    const ok = r.rows ? matchShaped(r, t, false) || matchShaped(r, t, true) : matchShapeless(r, t);
    if (!ok) continue;
    const id = VI[r.out];
    if (id === undefined) continue;
    return { id, count: r.count };
  }
  return null;
}

/** Furnace/smoker: what an input smelts into (null if nothing). Smokers only cook food. */
export function smeltResult(id: number, smoker = false): number | null {
  const d = VITEM[id];
  if (!d?.smelt) return null;
  if (smoker && !d.food) return null;
  return VI[d.smelt] ?? null;
}
export function fuelTicks(id: number): number { return VITEM[id]?.fuel ?? 0; }
export const COOK_TICKS = 200;
export const SMOKER_TICKS = 100;
/** Every recipe output key (for tests and the recipe book). */
export function recipeOutputs(): string[] { return R.map((r) => r.out); }
