// Copycat Builder (source games/CopycatBuilder): copy the little model in
// your showcase onto your plot, block for block, stairs facing the right way
// and slabs on the right half. Three models (easy, medium, hard); finishing a
// model sooner than the others scores more. Left-click a block in your plot
// to remove it. Blocks never run out.

import { S } from '../vanilla/deco';
import { mc } from '../vanilla/mc_materials';
import { VMETA } from '../vanilla/blocks';
import { vi } from '../vanilla/items';
import type { Edit } from '../net/mode_engine';
import { ordinal, fmt } from '../minigames_rules';
import { Minigame, type Spot } from './game';
import { noise } from './buildings';
import { BASE_Y, type ArenaDef } from './arena';

export const PLOTS = 10, SIZE = 4, HEIGHT = 3;
/**
 * Models: three layers (bottom first) of four rows (north to south) of four
 * characters. W white wool, R red wool, B blue wool, Y yellow wool, P oak
 * planks, S stone bricks, L oak log, G glass, h oak slab (bottom), H oak slab
 * (top), ^ > v < oak stairs facing N/E/S/W, '.' air.
 */
export const MODELS: string[][][] = [
  [['RRRR', 'R..R', 'R..R', 'RRRR'], ['W..W', '....', '....', 'W..W'], ['....', '....', '....', '....']],
  [['BWWB', 'WBBW', 'WBBW', 'BWWB'], ['.B..', '....', '....', '..B.'], ['....', '....', '....', '....']],
  [['YYYY', 'YRRY', 'YRRY', 'YYYY'], ['....', '.RR.', '.RR.', '....'], ['....', '....', '....', '....']],
  [['PPPP', 'PGGP', 'PGGP', 'PPPP'], ['L..L', '....', '....', 'L..L'], ['hhhh', 'h..h', 'h..h', 'hhhh']],
  [['SSSS', 'S..S', 'S..S', 'SSSS'], ['S.GS', '....', '....', 'SG.S'], ['HHHH', 'HHHH', 'HHHH', 'HHHH']],
  [['L..L', '.PP.', '.PP.', 'L..L'], ['L..L', '.GG.', '.GG.', 'L..L'], ['PPPP', 'P..P', 'P..P', 'PPPP']],
  [['^^^^', 'PPPP', 'PPPP', 'vvvv'], ['....', '^^^^', 'vvvv', '....'], ['....', '....', '....', '....']],
  [['<SS>', '<SS>', '<SS>', '<SS>'], ['.<>.', '.<>.', '.<>.', '.<>.'], ['....', '.hh.', '.hh.', '....']],
  [['PPPP', 'P..P', 'P..P', 'PPPP'], ['^^^^', '<..>', '<..>', 'vvvv'], ['....', '.HH.', '.HH.', '....']],
];

export function blockFor(c: string): string | null {
  switch (c) {
    case 'W': return 'white_wool';
    case 'R': return 'red_wool';
    case 'B': return 'blue_wool';
    case 'Y': return 'yellow_wool';
    case 'P': return 'oak_planks';
    case 'S': return 'stone_bricks';
    case 'L': return 'oak_log[axis=y]';
    case 'G': return 'glass';
    case 'h': return 'oak_slab[type=bottom]';
    case 'H': return 'oak_slab[type=top]';
    case '^': return 'oak_stairs[facing=north,half=bottom]';
    case '>': return 'oak_stairs[facing=east,half=bottom]';
    case 'v': return 'oak_stairs[facing=south,half=bottom]';
    case '<': return 'oak_stairs[facing=west,half=bottom]';
    default: return null;
  }
}
export function itemFor(c: string): string | null {
  switch (c) {
    case 'W': return 'white_wool';
    case 'R': return 'red_wool';
    case 'B': return 'blue_wool';
    case 'Y': return 'yellow_wool';
    case 'P': return 'oak_planks';
    case 'S': return 'stone_bricks';
    case 'L': return 'oak_log';
    case 'G': return 'glass';
    case 'h': case 'H': return 'oak_slab';
    case '^': case '>': case 'v': case '<': return 'oak_stairs';
    default: return null;
  }
}
export const plotX = (i: number) => -35 + i * 7;
/** The plot player `i` of `players` builds on: the middle ones. */
export function plotFor(i: number, players: number): number {
  const n = Math.max(1, Math.min(players, PLOTS));
  return Math.floor((PLOTS - n) / 2) + i % PLOTS;
}
/** Points for finishing a model in place `rank`: 5 down to 1 over the field. */
export function placePoints(rank: number, players: number): number {
  const n = Math.max(1, players);
  return Math.max(1, Math.ceil(5 * (n - rank + 1) / n));
}

/** Same block as the model wants: material, stair facing/half, slab type, log axis. */
export function sameBlock(have: number, want: string | null): boolean {
  if (want === null) return have === 0;
  const t = mc(want);
  if (have === t) return true;
  const a = VMETA[have], b = VMETA[t];
  if (!a || !b || a.family !== b.family) return false;
  for (const k of ['facing', 'half', 'type', 'axis']) if (k in b.state && a.state[k] !== b.state[k]) return false;
  return true;
}

export const COPYCAT_ARENA: ArenaDef = {
  id: 'copycat',
  build(d) {
    const x1 = -40, x2 = 40, z1 = -12, z2 = 14;
    for (let x = x1 - 4; x <= x2 + 4; x++) for (let z = z1 - 4; z <= z2 + 4; z++) {
      d.set(x, -1, z, 'stone');
      d.set(x, 0, z, noise(x, z) < .05 ? 'coarse_dirt' : 'grass_block');
    }
    d.underside(0, -1, 1, 44, 8, 'dirt', 'stone');
    for (let x = x1; x <= x2; x++) for (let z = z1; z <= z2; z++) d.set(x, 0, z, ((x + z) & 1) === 0 ? 'spruce_planks' : 'oak_planks');
    const fm = (a: number, b: number) => ((a % b) + b) % b;
    for (let y = 1; y <= 8; y++) {
      for (let x = x1; x <= x2; x++) {
        const post = fm(x - x1, 8) === 0;
        const win = !post && y >= 3 && y <= 6 && fm(x - x1, 8) >= 2 && fm(x - x1, 8) <= 6;
        for (const z of [z1, z2]) {
          if (post) d.log(x, y, z, 'stripped_spruce_log', 'y');
          else if (y === 8 || y === 1) d.log(x, y, z, 'stripped_spruce_log', 'x');
          else d.set(x, y, z, win ? 'glass_pane' : 'white_terracotta');
        }
      }
      for (let z = z1; z <= z2; z++) for (const x of [x1, x2]) {
        const post = z === z1 || z === z2 || fm(z - z1, 6) === 0;
        if (post) d.log(x, y, z, 'stripped_spruce_log', 'y');
        else if (y === 8 || y === 1) d.log(x, y, z, 'stripped_spruce_log', 'z');
        else d.set(x, y, z, y >= 3 && y <= 6 ? 'glass_pane' : 'white_terracotta');
      }
    }
    d.doubleDoor(0, 1, z2, 'spruce_door', S);
    d.set(0, 3, z2, 'white_terracotta');
    d.set(1, 3, z2, 'white_terracotta');
    d.gableRoof(x1 - 1, z1 - 1, x2 + 1, z2 + 1, 8, 'spruce_stairs', 'spruce_planks', 'white_terracotta', true);
    for (let x = x1 + 8; x < x2; x += 8) {
      for (let z = z1 + 1; z < z2; z++) d.log(x, 8, z, 'stripped_spruce_log', 'z');
      d.hangingLantern(x, 7, 7, 4, false);
      d.hangingLantern(x, 7, 7, -6, false);
    }
    for (let i = 0; i < PLOTS; i++) {
      const px = plotX(i);
      for (let x = px - 1; x <= px + SIZE; x++) {
        for (let z = -1; z <= SIZE; z++) {
          const rim = x === px - 1 || x === px + SIZE || z === -1 || z === SIZE;
          d.set(x, 0, z, rim ? 'polished_andesite' : 'smooth_stone');
        }
        for (let z = -7; z <= -2; z++) {
          const rim = x === px - 1 || x === px + SIZE || z === -7 || z === -2;
          d.set(x, 0, z, rim ? 'chiseled_quartz_block' : 'quartz_block');
        }
      }
      d.set(px + 1, 0, SIZE + 1, 'light_blue_concrete');
      d.set(px + 2, 0, SIZE + 1, 'light_blue_concrete');
    }
    const benches = ['crafting_table', 'smithing_table', 'fletching_table', 'cartography_table', 'barrel[facing=up,open=false]', 'loom[facing=south]'];
    for (let x = x1 + 2; x <= x2 - 2; x += 3) {
      d.data(x, 1, z1 + 1, benches[fm(x, benches.length)]);
      if (fm(x, 2) === 0) d.log(x, 2, z1 + 1, 'stripped_oak_log', 'x');
    }
    for (const [px, pz] of [[x1 + 2, z2 - 2], [x2 - 4, z2 - 2]]) {
      for (let dx = 0; dx < 3; dx++) { d.log(px + dx, 1, pz, 'stripped_spruce_log', 'z'); d.log(px + dx, 1, pz - 1, 'stripped_spruce_log', 'z'); }
      d.log(px + 1, 2, pz, 'stripped_spruce_log', 'z');
    }
    d.tree(x1 - 2, 1, z2 + 3, 4, 2.4, 'oak_log', 'oak_leaves');
    d.tree(x2 + 2, 1, z1 - 3, 4, 2.4, 'oak_log', 'oak_leaves');
  },
};

export class CopycatBuilder extends Minigame {
  readonly id = 'copycat';
  readonly arena = COPYCAT_ARENA;
  readonly plotOf = new Map<number, number>();
  readonly stageOf = new Map<number, number>();
  private readonly finishedCount = [0, 0, 0];
  readonly picks = [0, 0, 0];

  spawns(count: number): Spot[] {
    const out: Spot[] = [];
    for (let i = 0; i < Math.max(1, count); i++) out.push(this.at(plotX(plotFor(i, count)) + 2, 1, 6.5, 0));
    return out;
  }
  spectate(): Spot { return this.at(.5, 10, 16.5, 0); }

  setup(players: number[]): void {
    this.plotOf.clear(); this.stageOf.clear(); this.finishedCount.fill(0);
    for (let tier = 0; tier < 3; tier++) this.picks[tier] = tier * 3 + Math.floor(this.random() * 3);
    const items: string[] = [];
    for (let tier = 0; tier < 3; tier++) for (const layer of MODELS[this.picks[tier]]) for (const row of layer) for (const c of row) {
      const m = itemFor(c);
      if (m && !items.includes(m)) items.push(m);
    }
    items.push('light_blue_wool', 'birch_planks');
    players.forEach((id, i) => {
      const plot = plotFor(i, players.length);
      this.plotOf.set(id, plot);
      this.stageOf.set(id, 0);
      items.forEach((m, slot) => { if (slot < 36) this.setSlot(id, slot, { id: vi(m), count: 64 }); });
      this.clearPlot(plot);
      this.showModel(plot, 0);
    });
  }

  private clearPlot(plot: number): void {
    const px = plotX(plot);
    for (let x = 0; x < SIZE; x++) for (let y = 1; y <= HEIGHT; y++) for (let z = 0; z < SIZE; z++) this.put(px + x, y, z, 'air');
  }
  /** Model `stage` (0-2) in the plot's showcase, or cleared after the last. */
  private showModel(plot: number, stage: number): void {
    const px = plotX(plot);
    const model = stage < 3 ? MODELS[this.picks[stage]] : null;
    for (let y = 0; y < HEIGHT; y++) for (let z = 0; z < SIZE; z++) for (let x = 0; x < SIZE; x++) {
      const data = model ? blockFor(model[y][z][x]) : null;
      this.put(px + x, y + 1, -6 + z, data ?? 'air');
    }
  }
  inPlot(plot: number, x: number, wy: number, z: number): boolean {
    const lx = x - plotX(plot), y = wy - BASE_Y;
    return lx >= 0 && lx < SIZE && z >= 0 && z < SIZE && y >= 1 && y <= HEIGHT;
  }

  canPlace(id: number, x: number, y: number, z: number): boolean {
    const plot = this.plotOf.get(id);
    return plot !== undefined && this.alive.has(id) && (this.stageOf.get(id) ?? 0) < 3 && this.inPlot(plot, x, y, z);
  }
  onPlaced(id: number, slot: number): void {
    const p = this.m.sim.players.get(id);
    if (!p) return;
    // Never runs out: the stack goes straight back to 64.
    const s = p.inv.slots[slot];
    if (s) s.count = 64;
    else if (this.lastHeld.has(id)) p.inv.slots[slot] = { id: this.lastHeld.get(id)!, count: 64 };
    p.invDirty = true;
    this.check(id);
  }
  private readonly lastHeld = new Map<number, number>();
  canUse(id: number): boolean {
    const p = this.m.sim.players.get(id);
    const s = p?.inv.slots[p.selected];
    if (s) this.lastHeld.set(id, s.id);
    return true;
  }
  onLeftClick(id: number, x: number, y: number, z: number): boolean {
    const plot = this.plotOf.get(id);
    if (plot !== undefined && this.inPlot(plot, x, y, z) && (this.stageOf.get(id) ?? 0) < 3 && this.get(x, y - BASE_Y, z) !== 0) {
      this.put(x, y - BASE_Y, z, 'air');
      this.m.sim.emit({ f: 'break', x, y, z, block: this.m.host.getBlock(x, y, z) });
      this.flush();
      this.check(id);
    }
    return true;
  }

  matches(plot: number, stage: number): boolean {
    const model = MODELS[this.picks[stage]], px = plotX(plot);
    for (let y = 0; y < HEIGHT; y++) for (let z = 0; z < SIZE; z++) for (let x = 0; x < SIZE; x++) {
      if (!sameBlock(this.get(px + x, y + 1, z), blockFor(model[y][z][x]))) return false;
    }
    return true;
  }

  private check(id: number): void {
    const plot = this.plotOf.get(id), stage = this.stageOf.get(id) ?? 0;
    if (plot === undefined || stage >= 3 || !this.alive.has(id) || !this.matches(plot, stage)) return;
    const rank = ++this.finishedCount[stage];
    const points = placePoints(rank, this.participants.size) + stage;
    this.addScore(id, points);
    this.stageOf.set(id, stage + 1);
    const c = this.at(plotX(plot) + 2, 2, 2);
    this.m.sim.emit({ f: 'burst', kind: 'heart', x: c.x, y: c.y, z: c.z, n: 12 });
    this.m.host.send(id, { k: 'fx', fx: [{ f: 'sound', s: 'toast', pitch: 1.2 }] });
    this.m.feed(`${this.m.name(id)} copied model ${stage + 1} (${ordinal(rank)}, +${points})`, 'info');
    this.clearPlot(plot);
    this.showModel(plot, stage + 1);
    if (stage + 1 >= 3) this.m.title(id, 'All done', 'Nice building', '#d99a00', 1500);
    else this.m.title(id, `Model ${stage + 2}`, stage + 1 === 2 ? 'The tricky one' : 'Getting harder', '#1fa7c9', 1500);
    this.flush();
  }

  over(): boolean {
    for (const id of this.alive) if ((this.stageOf.get(id) ?? 0) < 3) return false;
    return this.alive.size > 0;
  }
  bar(id: number): string {
    const stage = this.stageOf.get(id) ?? 0;
    return `${stage >= 3 ? 'All 3 models done' : `Model ${stage + 1}/3`}  ·  ${fmt(this.scoreOf(id))} pts`;
  }
  detail(id: number): string { return `${this.stageOf.get(id) ?? 0}/3 models · ${fmt(this.scoreOf(id))} pts`; }
  cleanup(): void { for (let i = 0; i < PLOTS; i++) { this.clearPlot(i); this.showModel(i, 3); } this.flush(); }
}
void ({} as Edit);
