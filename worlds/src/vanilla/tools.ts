// Mining and drops (Java Edition, wiki "Breaking"). Break ticks =
// ceil(1 / (speed / hardness / (harvest ? 30 : 100))); speed is the tool's
// multiplier when it suits the block (+ Efficiency level²+1), × Haste,
// ÷5 under water, ÷5 off the ground. Damage over 1 breaks instantly.

import { BLOCKS } from '../blocks';
import { VMETA, slabFull } from './blocks';
import { VITEM, VI } from './items';
import { enchLevel, type VStack } from './stack';

export interface MineCtx { haste: number; inWater: boolean; onGround: boolean }

function bestFor(block: number, held: VStack | null): { speed: number; harvest: boolean } {
  const m = VMETA[block];
  const tool = held ? VITEM[held.id]?.tool : undefined;
  const fam = m?.family ?? '';
  let speed = 1;
  let suits = false;
  if (tool) {
    if (tool.kind === 'sword') { speed = fam === 'cobweb' ? 15 : 1.5; suits = fam === 'cobweb'; }
    else if (tool.kind === 'shears') {
      speed = fam === 'cobweb' || /leaves$/.test(fam) ? 15 : /_wool$/.test(fam) ? 5 : 1;
      suits = speed > 1;
    } else if (m?.tool === tool.kind) { speed = tool.speed; suits = true; }
  }
  if (suits && held) {
    const eff = enchLevel(held, 'efficiency');
    if (eff > 0) speed += eff * eff + 1;
  }
  const needs = m?.needsTier;
  let harvest = needs === undefined;
  if (!harvest && tool && m?.tool === tool.kind && tool.tier >= needs!) harvest = true;
  if (fam === 'cobweb') harvest = !!tool && (tool.kind === 'sword' || tool.kind === 'shears');
  return { speed, harvest };
}

/** Ticks to break a block (Infinity = unbreakable, 0 = instant). */
export function breakTicks(block: number, held: VStack | null, c: MineCtx): number {
  const m = VMETA[block];
  const hardness = m?.hardness ?? BLOCKS[block]?.hardness ?? -1;
  if (hardness < 0) return Infinity;
  if (hardness === 0) return 0;
  const { speed, harvest } = bestFor(block, held);
  let s = speed * c.haste;
  if (c.inWater) s /= 5;
  if (!c.onGround) s /= 5;
  const dmg = s / hardness / (harvest ? 30 : 100);
  if (dmg > 1) return 0;
  return Math.ceil(1 / dmg);
}

/** What a broken block drops (block items by family default). */
export function dropsOf(block: number, held: VStack | null, rng: () => number, opts: { glassSelf?: boolean } = {}): VStack[] {
  const m = VMETA[block];
  if (!m) return [];
  const { harvest } = bestFor(block, held);
  const tool = held ? VITEM[held.id]?.tool : undefined;
  const fam = m.family;
  const out: VStack[] = [];
  const give = (key: string, count: number) => { const id = VI[key]; if (id !== undefined && count > 0) out.push({ id, count }); };
  if (opts.glassSelf && (fam === 'glass' || /_stained_glass$/.test(fam) || fam === 'glass_pane')) { give(fam, 1); return out; }
  if (tool?.kind === 'shears' && (fam === 'cobweb' || /leaves$/.test(fam))) { give(fam, 1); return out; }
  if (!harvest) return out;
  for (const [key, chance] of m.extra ?? []) if (rng() < chance) give(key, 1);
  if (fam === 'gravel' && out.some((s) => s.id === VI.flint)) return out;
  if (m.drop === '') return out;
  let count = typeof m.dropCount === 'number' ? m.dropCount : Array.isArray(m.dropCount)
    ? m.dropCount[0] + Math.floor(rng() * (m.dropCount[1] - m.dropCount[0] + 1)) : 1;
  if (fam.endsWith('_slab') && m.state.type === 'double') { give(fam, 2); return out; }
  void slabFull;
  if ((fam === 'snow' || fam === 'snow_block' || fam === 'packed_snow') && tool?.kind !== 'shovel') return out;
  give(m.drop ?? fam, count);
  return out;
}
