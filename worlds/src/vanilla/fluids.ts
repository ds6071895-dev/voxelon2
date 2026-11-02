// Flowing water and lava from buckets (Java Edition): water updates every 5
// ticks and spreads 7 blocks; lava every 30 ticks and spreads 3 (a level step
// of 2). Fluid falls straight down as a falling column (level 8). Two water
// sources beside each other over solid ground make a new source. Lava meeting
// water: a lava source becomes obsidian, flowing lava cobblestone, and water
// flowing onto lava from above makes stone.

import { BLOCKS, Block } from '../blocks';
import { VB, lavaAt, waterAt } from './blocks';

type Get = (x: number, y: number, z: number) => number;
export interface FluidEdit { x: number; y: number; z: number; block: number }

const HORIZ: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];

function fluidOf(id: number): { kind: 'water' | 'lava'; level: number } | null { return BLOCKS[id]?.fluid ?? null; }
function canFlowInto(id: number): boolean {
  if (id === Block.Air) return true;
  const b = BLOCKS[id];
  return !!b && (b.replaceable || (!b.solid && !b.fluid && b.shape === 'cross'));
}
const at = (kind: 'water' | 'lava', level: number) => kind === 'water' ? waterAt(level) : lavaAt(level);

export class Fluids {
  private queue = new Map<string, number>();
  /** Max cell updates per tick, so a flood can never stall the server. */
  constructor(private readonly budget = 96, private readonly allow: (x: number, y: number, z: number) => boolean = () => true) {}

  private key(x: number, y: number, z: number): string { return `${x},${y},${z}`; }
  schedule(x: number, y: number, z: number, tick: number, kind: 'water' | 'lava'): void {
    const k = this.key(x, y, z);
    const due = tick + (kind === 'water' ? 5 : 30);
    const cur = this.queue.get(k);
    if (cur === undefined || due < cur) this.queue.set(k, due);
  }
  /** A cell changed: wake it and its neighbours. */
  touch(get: Get, x: number, y: number, z: number, tick: number): void {
    for (const [dx, dy, dz] of [[0, 0, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0], [0, -1, 0]]) {
      const f = fluidOf(get(x + dx, y + dy, z + dz));
      if (f) this.schedule(x + dx, y + dy, z + dz, tick, f.kind);
    }
  }
  get pending(): number { return this.queue.size; }

  tick(get: Get, tick: number): FluidEdit[] {
    const edits: FluidEdit[] = [];
    const overlay = new Map<string, number>();
    const g: Get = (x, y, z) => overlay.get(this.key(x, y, z)) ?? get(x, y, z);
    const set = (x: number, y: number, z: number, b: number) => {
      if (!this.allow(x, y, z)) return;
      overlay.set(this.key(x, y, z), b); edits.push({ x, y, z, block: b });
    };
    let n = 0;
    for (const [k, due] of this.queue) {
      if (due > tick) continue;
      if (n++ >= this.budget) break;
      this.queue.delete(k);
      const [x, y, z] = k.split(',').map(Number);
      const id = g(x, y, z), f = fluidOf(id);
      if (!f) continue;
      const step = f.kind === 'water' ? 1 : 2;
      // Recompute a flowing cell's level from what feeds it.
      if (f.level !== 0) {
        let want = -1;
        const above = fluidOf(g(x, y + 1, z));
        if (above?.kind === f.kind) want = 8;
        else {
          let best = 99, sources = 0;
          for (const [dx, dz] of HORIZ) {
            const nf = fluidOf(g(x + dx, y, z + dz));
            if (nf?.kind !== f.kind) continue;
            if (nf.level === 0) sources++;
            const lvl = nf.level >= 8 ? 0 : nf.level;
            if (lvl < best) best = lvl;
          }
          const belowSolid = BLOCKS[g(x, y - 1, z)]?.solid || fluidOf(g(x, y - 1, z))?.level === 0;
          if (f.kind === 'water' && sources >= 2 && belowSolid) want = 0;
          else if (best + step <= 7) want = best + step;
        }
        if (want !== f.level) {
          if (want < 0) set(x, y, z, Block.Air);
          else set(x, y, z, at(f.kind, want));
          this.touch(g, x, y, z, tick);
          if (want < 0) continue;
        }
      }
      const cur = fluidOf(g(x, y, z));
      if (!cur) continue;
      // Interactions with the other fluid.
      for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0]]) {
        const nf = fluidOf(g(x + dx, y + dy, z + dz));
        if (!nf || nf.kind === cur.kind) continue;
        if (cur.kind === 'lava') { set(x, y, z, cur.level === 0 ? VB.obsidian : Block.Cobblestone); break; }
      }
      const now = fluidOf(g(x, y, z));
      if (!now) continue;
      // Fall first; spread sideways only from a cell that cannot fall.
      const below = g(x, y - 1, z), bf = fluidOf(below);
      if (canFlowInto(below)) { set(x, y - 1, z, at(now.kind, 8)); this.schedule(x, y - 1, z, tick, now.kind); continue; }
      if (bf && bf.kind !== now.kind) { set(x, y - 1, z, now.kind === 'water' ? Block.Stone : Block.Cobblestone); continue; }
      if (bf && bf.kind === now.kind) continue;
      const base = now.level >= 8 ? 0 : now.level;
      const next = base + step;
      if (next > 7) continue;
      for (const [dx, dz] of HORIZ) {
        const nid = g(x + dx, y, z + dz), nf = fluidOf(nid);
        if (canFlowInto(nid) || (nf?.kind === now.kind && nf.level !== 0 && nf.level < 8 && nf.level > next)) {
          set(x + dx, y, z + dz, at(now.kind, next));
          this.schedule(x + dx, y, z + dz, tick, now.kind);
        }
      }
    }
    // Keep only the last write per cell.
    const last = new Map<string, FluidEdit>();
    for (const e of edits) last.set(this.key(e.x, e.y, e.z), e);
    return [...last.values()];
  }
}
