// Minecraft material names and block-state strings → Worlds block ids, so the
// plugin's builders (CityBuilder, the party arenas' Deco calls) port line for
// line. "oak_stairs[facing=north,half=bottom]" resolves through the vanilla
// state tables; unknown properties are ignored.

import { Block } from '../blocks';
import { VB, stateId } from './blocks';

const LEGACY: Record<string, number> = {
  air: Block.Air, cave_air: Block.Air, void_air: Block.Air,
  grass_block: Block.Grass, dirt: Block.Dirt, stone: Block.Stone, cobblestone: Block.Cobblestone, sand: Block.Sand,
  oak_planks: Block.OakPlanks, oak_leaves: Block.Leaves, birch_leaves: Block.BirchLeaves, spruce_leaves: Block.SpruceLeaves,
  water: Block.Water, sandstone: Block.Sandstone, short_grass: Block.TallGrass, grass: Block.TallGrass,
  dandelion: Block.Dandelion, poppy: Block.Poppy, terracotta: Block.Terracotta, basalt: Block.Basalt,
  snow_block: VB.snow_block,
};
/** Names that differ between Minecraft and the vanilla families. */
const ALIAS: Record<string, string> = {
  stone_brick_stairs: 'stone_brick_stairs', stone_brick_slab: 'stone_brick_slab', brick_stairs: 'brick_stairs',
  smooth_stone_slab: 'smooth_stone_slab', quartz_stairs: 'quartz_stairs', lightning_rod: 'lightning_rod',
  oak_wall_sign: 'oak_planks', chain: 'iron_bars', iron_chain: 'iron_bars', soul_lantern: 'lantern',
  dirt_path: 'dirt_path', grass_path: 'dirt_path',
};
const FACE: Record<string, string> = { north: 'n', south: 's', east: 'e', west: 'w' };

function parse(spec: string): { name: string; props: Record<string, string> } {
  const i = spec.indexOf('[');
  const name = (i < 0 ? spec : spec.slice(0, i)).replace(/^minecraft:/, '').toLowerCase();
  const props: Record<string, string> = {};
  if (i >= 0) for (const kv of spec.slice(i + 1, spec.lastIndexOf(']')).split(',')) {
    const [k, v] = kv.split('=');
    if (k && v !== undefined) props[k.trim()] = v.trim();
  }
  return { name, props };
}

const cache = new Map<string, number>();
const warned = new Set<string>();

/** Block id for a material name or state string. */
export function mc(spec: string): number {
  const hit = cache.get(spec);
  if (hit !== undefined) return hit;
  const { name, props } = parse(spec);
  let id: number | undefined;
  if (name in LEGACY && !Object.keys(props).length) id = LEGACY[name];
  else {
    const family = ALIAS[name] ?? name;
    const base = family === 'water' ? undefined : VB[family];
    if (base !== undefined || family === 'water') {
      const want: Record<string, string | number | boolean> = {};
      if (props.facing && FACE[props.facing]) want.facing = FACE[props.facing];
      if (props.half) want.half = props.half;
      if (props.type) want.type = props.type;
      if (props.axis) want.axis = props.axis;
      if (props.open !== undefined) want.open = props.open === 'true';
      if (props.hanging !== undefined) want.hanging = props.hanging === 'true';
      if (props.level !== undefined) want.level = Number(props.level);
      if (props.layers !== undefined) want.layers = Number(props.layers);
      if (family === 'water') id = Number(props.level ?? 0) === 0 ? Block.Water : stateId('water', { level: Number(props.level) });
      else {
        // Keep the family's defaults for properties the string leaves out.
        const all = { ...defaults(family), ...want };
        id = stateId(family, all) ?? stateId(family, want) ?? base;
      }
    } else if (name in LEGACY) id = LEGACY[name];
  }
  if (id === undefined) {
    if (!warned.has(name)) { warned.add(name); console.warn(`mc(): no block for ${name}`); }
    id = Block.Stone;
  }
  cache.set(spec, id);
  return id;
}

function defaults(family: string): Record<string, string | number | boolean> {
  const id = VB[family];
  const m = id !== undefined ? STATE_OF.get(id) : undefined;
  return m ?? {};
}
const STATE_OF = new Map<number, Record<string, string | number | boolean>>();
import { VMETA } from './blocks';
for (const [, id] of Object.entries(VB)) if (VMETA[id]) STATE_OF.set(id, VMETA[id]!.state);
