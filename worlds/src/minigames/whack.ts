// Whack-a-Mole (source games/WhackAMole): moles pop out of a 7x7 field of
// holes in a farm garden. Punch them before they duck back down: brown moles
// 1 point, golden moles 3; bomb moles cost 3 and slow you down. Moles pop up
// faster and hide sooner as the round goes on.

import { Deco, S } from '../vanilla/deco';
import { scale } from '../minigames_rules';
import { Minigame, type Spot } from './game';
import { house, noise, STYLE } from './buildings';
import type { ArenaDef } from './arena';

export const GRID = 7, SPACING = 3;
type Kind = 'NORMAL' | 'GOLD' | 'BOMB';
export const holeX = (i: number) => (i % GRID - Math.floor(GRID / 2)) * SPACING;
export const holeZ = (i: number) => (Math.floor(i / GRID) - Math.floor(GRID / 2)) * SPACING;

function windmill(d: Deco, x: number, z: number): void {
  for (let y = 1; y <= 12; y++) {
    const r = 2.6 - y * .1;
    for (let dx = -3; dx <= 3; dx++) for (let dz = -3; dz <= 3; dz++) {
      const dist = Math.hypot(dx, dz);
      if (dist <= r + .5 && dist > r - .7) d.set(x + dx, y, z + dz, y % 4 === 0 ? 'stripped_spruce_log' : 'white_terracotta');
    }
  }
  d.hipRoof(x - 2, z - 2, x + 2, z + 2, 13, 'spruce_stairs', 'spruce_planks');
  d.door(x, 1, z + 2, 'spruce_door', S, false, false);
  const hx = x - 3, hy = 10;
  d.set(hx, hy, z, 'spruce_planks');
  for (let i = 1; i <= 5; i++) {
    d.set(hx, hy + i, z, 'spruce_fence'); d.set(hx, hy - i, z, 'spruce_fence');
    d.set(hx, hy, z + i, 'spruce_fence'); d.set(hx, hy, z - i, 'spruce_fence');
    if (i >= 2) {
      d.data(hx, hy + i, z + 1, 'white_wool'); d.data(hx, hy - i, z - 1, 'white_wool');
      d.data(hx, hy - 1, z + i, 'white_wool'); d.data(hx, hy + 1, z - i, 'white_wool');
    }
  }
}
function scarecrow(d: Deco, x: number, z: number): void {
  d.column(x, 1, z, 3, 'spruce_fence');
  d.log(x, 4, z, 'hay_block', 'y');
  d.data(x, 5, z, 'carved_pumpkin[facing=east]');
  d.set(x, 4, z - 1, 'spruce_fence');
  d.set(x, 4, z + 1, 'spruce_fence');
}

export const WHACK_ARENA: ArenaDef = {
  id: 'whack',
  build(d) {
    const R = 34;
    for (let x = -R; x <= R; x++) for (let z = -R; z <= R; z++) {
      if (x * x + z * z > (R + .5) * (R + .5)) continue;
      d.set(x, -1, z, 'dirt');
      const lawn = Math.abs(x) <= 13 && Math.abs(z) <= 13;
      d.set(x, 0, z, lawn ? (((x + z) & 1) === 0 ? 'grass_block' : 'moss_block') : noise(x, z) < .05 ? 'coarse_dirt' : 'grass_block');
    }
    d.underside(0, -1, 0, R, 9, 'dirt', 'stone');
    for (let i = 0; i < GRID * GRID; i++) {
      const x = holeX(i), z = holeZ(i);
      for (const [ox, oz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) d.set(x + ox, 0, z + oz, 'coarse_dirt');
      d.set(x, 0, z, 'mud');
    }
    for (let i = -14; i <= 14; i++) for (const [px, pz] of [[i, -14], [i, 14], [-14, i], [14, i]]) d.set(px, 1, pz, 'birch_fence');
    for (const [cx, cz] of [[-14, -14], [14, -14], [-14, 14], [14, 14]]) { d.log(cx, 1, cz, 'hay_block', 'y'); d.lantern(cx, 2, cz, false); }
    for (let i = -12; i <= 12; i += 6) for (const [px, pz] of [[i, -14], [i, 14], [-14, i], [14, i]]) { d.set(px, 2, pz, 'birch_fence'); d.lantern(px, 3, pz, false); }
    house(d, -8, 0, -30, 16, 9, 6, S, STYLE.BARN);
    windmill(d, 24, -6);
    scarecrow(d, -22, 8);
    for (const [hx, hz] of [[-20, -14], [-21, -14], [-20, -13], [18, 18], [19, 18], [18, 19]]) d.log(hx, 1, hz, 'hay_block', 'y');
    d.log(-20, 2, -14, 'hay_block', 'x');
    for (const [px, pz] of [[-16, 20], [-18, 22], [16, -18], [20, 22]]) d.data(px, 1, pz, 'carved_pumpkin[facing=south]');
    d.planter(-6, 1, 18, 6, 21, 'spruce_trapdoor');
    d.tree(-26, 1, -10, 5, 3, 'oak_log', 'oak_leaves');
    d.tree(-24, 1, 22, 4, 2.6, 'oak_log', 'oak_leaves');
    d.tree(26, 1, 16, 4, 2.6, 'birch_log', 'birch_leaves');
    d.tree(14, 1, -26, 5, 3, 'oak_log', 'oak_leaves');
  },
};

export interface WhackView { moles: { hole: number; kind: Kind; hides: number }[] }

export class WhackAMole extends Minigame {
  readonly id = 'whack';
  readonly arena = WHACK_ARENA;
  readonly moles = new Map<number, { kind: Kind; hides: number }>();
  private nextPop = 0;

  spawns(count: number): Spot[] { return this.ring(count, 12.5, 1, this.random() * Math.PI * 2); }
  spectate(): Spot { return this.at(.5, 12, 20.5, Math.PI); }

  setup(): void { this.moles.clear(); this.nextPop = 20; }

  /** Moles at once: four or more players get two at a time. */
  static molesPerPop(players: number): number { return players >= 4 ? 2 : 1; }

  tick(): void {
    const n = Math.max(1, this.players().length);
    const progress = this.t / (this.seconds * 20);
    if (this.t >= this.nextPop) {
      this.nextPop = this.t + Math.max(3, Math.floor(scale(n, 14, 5) * (1 - .4 * progress) + .5));
      let pops = WhackAMole.molesPerPop(n);
      for (let attempt = 0; attempt < 8 * pops && pops > 0; attempt++) {
        const hole = Math.floor(this.random() * GRID * GRID);
        if (this.moles.has(hole)) continue;
        const r = this.random();
        const kind: Kind = r < .14 ? 'GOLD' : r < .30 ? 'BOMB' : 'NORMAL';
        const stay = Math.floor(36 - 18 * progress + .5) + Math.floor(this.random() * 10);
        this.moles.set(hole, { kind, hides: this.t + stay });
        this.show(hole, kind);
        this.m.sound('gravel', this.at(holeX(hole) + .5, 1, holeZ(hole) + .5), 1.4);
        pops--;
      }
    }
    for (const [hole, mole] of [...this.moles]) if (mole.hides <= this.t) { this.hide(hole); this.moles.delete(hole); }
  }

  private show(hole: number, kind: Kind): void {
    const x = holeX(hole), z = holeZ(hole);
    if (kind === 'GOLD') { this.put(x, 1, z, 'gold_block'); this.put(x, 2, z, 'raw_gold_block'); }
    else if (kind === 'BOMB') { this.put(x, 1, z, 'black_concrete'); this.put(x, 2, z, 'tnt'); }
    else { this.put(x, 1, z, 'brown_terracotta'); this.put(x, 2, z, 'brown_mushroom_block'); }
  }
  private hide(hole: number): void {
    this.put(holeX(hole), 1, holeZ(hole), 'air');
    this.put(holeX(hole), 2, holeZ(hole), 'air');
  }

  onLeftClick(id: number, x: number, wy: number, z: number): boolean {
    const y = wy - 100;
    if (y < 1 || y > 2 || ((x % SPACING) + SPACING) % SPACING !== 0 || ((z % SPACING) + SPACING) % SPACING !== 0) return true;
    const gx = x / SPACING + Math.floor(GRID / 2), gz = z / SPACING + Math.floor(GRID / 2);
    if (gx < 0 || gz < 0 || gx >= GRID || gz >= GRID) return true;
    const hole = gz * GRID + gx;
    const mole = this.moles.get(hole);
    if (!mole) return true;
    this.moles.delete(hole);
    this.hide(hole);
    const at = this.at(x + .5, 1.5, z + .5);
    const points = mole.kind === 'GOLD' ? 3 : mole.kind === 'BOMB' ? -3 : 1;
    this.addScore(id, points);
    if (mole.kind === 'BOMB') {
      this.m.sim.addEffect(id, 'slowness', 2, 50);
      this.m.sim.emit({ f: 'explode', x: at.x, y: at.y, z: at.z, power: 1 });
      this.m.sound('explode', at, 1.3);
    } else {
      this.m.sim.emit({ f: 'burst', kind: 'crit', x: at.x, y: at.y, z: at.z });
      this.m.sound('hit', at, mole.kind === 'GOLD' ? 1.6 : 1.1);
    }
    this.m.bar(id, `${points > 0 ? '+' : ''}${points}  (total ${this.scoreOf(id)})`, points > 0 ? '#1f9d5b' : '#e5484d');
    return true;
  }

  botView(): WhackView { return { moles: [...this.moles].map(([hole, m]) => ({ hole, kind: m.kind, hides: m.hides })) }; }

  cleanup(): void { for (const hole of this.moles.keys()) this.hide(hole); this.moles.clear(); this.flush(); }
}
