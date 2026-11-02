// Memory Mosaic (source games/MemoryMosaic): a picture appears on the gallery
// wall, then vanishes; rebuild it on your own floor pad by clicking tiles to
// cycle their colour, and press the green tile to hand it in. Three pictures:
// 3x3 in two colours, 4x4 in three, 5x5 in four. Accuracy scores up to 10 a
// picture, with a speed bonus for a perfect copy. Your pad is only shown to you.

import { E, W } from '../vanilla/deco';
import { mc } from '../vanilla/mc_materials';
import type { BlockHit } from '../vanilla/messages';
import { fmt } from '../minigames_rules';
import { Minigame, yawToward, type Spot } from './game';
import { BASE_Y, type ArenaDef } from './arena';

export const PAD = 5, WALL_Z = -21;
export const PALETTE = ['red_concrete', 'blue_concrete', 'yellow_concrete', 'lime_concrete'];
export const PALETTE_HEX = ['#d0342c', '#2f4fc4', '#f2c230', '#62b733'];
const BLANK = 'white_concrete';
export const SIZES = [3, 4, 5], SHOW = [90, 110, 130];
export const ANSWER = 500, REVEAL = 70;
export const PAD_ORDER = [2, 3, 1, 4, 0, 7, 8, 6, 9, 5];
export const padX = (i: number) => -27 + (i % 5) * 11;
export const padZ = (i: number) => i < 5 ? -9 : 3;
const fm = (a: number, b: number) => ((a % b) + b) % b;

export const MEMORY_ARENA: ArenaDef = {
  id: 'memory',
  version: 2,
  build(d) {
    const x1 = -33, x2 = 33, z1 = WALL_Z - 1, z2 = 15;
    d.fill(x1, -1, z1, x2, -1, z2, 'stone');
    for (let x = x1; x <= x2; x++) for (let z = z1; z <= z2; z++) {
      const border = x === x1 + 1 || x === x2 - 1 || z === z1 + 1 || z === z2 - 1;
      d.set(x, 0, z, border ? 'polished_deepslate' : ((x + z) & 1) === 0 ? 'dark_oak_planks' : 'spruce_planks');
    }
    d.underside(0, -1, -3, 40, 8, 'stone', 'deepslate');
    for (let y = 1; y <= 13; y++) {
      for (let x = x1; x <= x2; x++) {
        d.set(x, y, z1, 'quartz_bricks');
        const win = y >= 4 && y <= 10 && fm(x, 8) >= 2 && fm(x, 8) <= 5;
        d.set(x, y, z2, win ? 'glass_pane' : 'quartz_bricks');
      }
      for (let z = z1; z <= z2; z++) {
        const win = y >= 4 && y <= 10 && fm(z, 8) >= 2 && fm(z, 8) <= 5;
        d.set(x1, y, z, win ? 'glass_pane' : 'quartz_bricks');
        d.set(x2, y, z, win ? 'glass_pane' : 'quartz_bricks');
      }
    }
    for (let x = x1; x <= x2; x += 8) { d.column(x, 1, z1 + 1, 13, 'quartz_pillar'); d.column(x, 1, z2 - 1, 13, 'quartz_pillar'); }
    for (let x = x1; x <= x2; x++) for (let z = z1; z <= z2; z++) {
      const beam = fm(x, 8) === 0 || z === z1 || z === z2 || x === x1 || x === x2 || fm(z, 9) === 0;
      d.set(x, 14, z, beam ? 'smooth_quartz' : 'glass');
    }
    for (let x = x1 + 4; x < x2; x += 8) d.hangingLantern(x, 13, 12, -3, false);
    for (let x = -6; x <= 5; x++) for (let y = 2; y <= 13; y++) {
      const frame = x === -6 || x === 5 || y === 2 || y === 13;
      d.set(x, y, WALL_Z, frame ? 'stripped_dark_oak_wood' : 'light_gray_concrete');
    }
    d.set(-1, 14, WALL_Z, 'gold_block');
    d.set(0, 14, WALL_Z, 'gold_block');
    const arts = ['orange', 'cyan', 'magenta', 'lime'];
    for (let z = z1 + 4; z <= z2 - 4; z += 8) for (const side of [-1, 1]) {
      const x = side < 0 ? x1 + 1 : x2 - 1;
      for (let dz = -1; dz <= 1; dz++) for (let y = 4; y <= 6; y++) {
        const edge = Math.abs(dz) === 1 || y === 4 || y === 6;
        d.data(x, y, z + dz, edge ? 'stripped_spruce_wood' : `${arts[fm(z + side, 4)]}_glazed_terracotta`);
      }
    }
    for (let i = 0; i < 4; i++) {
      const x = padX(i) + PAD + 2;
      for (const z of [-7, 5]) { d.set(x + 1, 1, z, 'chiseled_quartz_block'); d.data(x + 1, 2, z, 'decorated_pot[facing=south]'); }
    }
    for (const side of [-1, 1]) for (let z = -16; z <= 12; z += 7) {
      d.stairs(side * 31, 1, z, 'dark_oak_stairs', side < 0 ? W : E, false);
      d.stairs(side * 31, 1, z + 1, 'dark_oak_stairs', side < 0 ? W : E, false);
    }
    for (let x = -30; x <= 30; x++) d.data(x, 1, -2, 'red_carpet');
  },
  layer(d) {
    for (let i = 0; i < 10; i++) {
      for (let x = 0; x < PAD; x++) for (let z = 0; z < PAD; z++) d.set(padX(i) + x, 0, padZ(i) + z, BLANK);
      d.set(padX(i) + 2, 0, padZ(i) + PAD, 'lime_concrete');
      d.set(padX(i) + 1, 0, padZ(i) + PAD, 'quartz_block');
      d.set(padX(i) + 3, 0, padZ(i) + PAD, 'quartz_block');
    }
  },
};

export interface MemoryView { phase: number; stage: number; target: number[][] | null; pad: number | undefined; answer: number[][] | undefined; submitted: boolean; phaseEnds: number }

export class MemoryMosaic extends Minigame {
  readonly id = 'memory';
  readonly arena = MEMORY_ARENA;
  stage = -1;
  /** 0 show, 1 answer, 2 reveal, 3 done. */
  phase = 3;
  phaseEnds = 0;
  target: number[][] = [];
  readonly answers = new Map<number, number[][]>();
  readonly padOf = new Map<number, number>();
  readonly submitted = new Set<number>();
  private readonly submittedAt = new Map<number, number>();

  padSpot(pad: number): Spot {
    const sx = padX(pad) + 2.5, sz = padZ(pad) + 2.5;
    return this.at(sx, 1, sz, yawToward(sx, sz, 0, WALL_Z));
  }
  spawns(count: number): Spot[] {
    const out: Spot[] = [];
    for (let i = 0; i < Math.max(1, count); i++) out.push(this.padSpot(PAD_ORDER[i % PAD_ORDER.length]));
    return out;
  }
  spectate(): Spot { return this.at(.5, 10, 14.5, 0); }

  setup(players: number[]): void {
    this.padOf.clear(); this.answers.clear();
    players.forEach((id, i) => this.padOf.set(id, PAD_ORDER[i % PAD_ORDER.length]));
    this.stage = -1; this.phase = 3; this.phaseEnds = 0;
  }
  begin(): void { this.nextStage(); }

  private nextStage(): void {
    this.stage++;
    if (this.stage >= SIZES.length) { this.phase = 3; this.m.setBoard(null); return; }
    const size = SIZES[this.stage], colours = this.stage + 2;
    this.target = [];
    for (let x = 0; x < size; x++) { this.target.push([]); for (let z = 0; z < size; z++) this.target[x].push(Math.floor(this.random() * colours)); }
    this.submitted.clear(); this.submittedAt.clear();
    for (const id of this.participants) this.answers.set(id, Array.from({ length: size }, () => new Array(size).fill(-1)));
    this.showTarget(true);
    this.phase = 0;
    this.phaseEnds = this.t + SHOW[this.stage];
    this.m.title(null, `Picture ${this.stage + 1}`, `Memorise the wall (${size}×${size})`, '#b45ad6', 1500);
    this.m.sound('pling', undefined, 1.2);
    for (const id of this.players()) {
      const pad = this.padOf.get(id);
      if (pad !== undefined) { const s = this.padSpot(pad); this.m.host.teleport(id, s.x, s.y, s.z, s.yaw); }
      this.sendPad(id);
    }
    this.board();
  }

  private board(): void {
    const size = SIZES[this.stage];
    const sub = this.phase === 0 ? 'Memorise the picture on the wall' : this.phase === 1 ? 'Click your pad’s tiles to cycle colours · green tile submits' : 'Here is the answer';
    this.m.setBoard({ title: `Picture ${this.stage + 1} of 3 · ${size}×${size}`, sub });
  }

  /** The wall picture, or (hidden) plain grey. Each cell is 2x2 blocks. */
  private showTarget(visible: boolean): void {
    const size = SIZES[this.stage];
    for (let cx = 0; cx < PAD; cx++) for (let cy = 0; cy < PAD; cy++) {
      const m = cx >= size || cy >= size ? 'gray_concrete' : visible ? PALETTE[this.target[cx][cy]] : 'light_gray_concrete';
      for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) this.put(-5 + cx * 2 + i, 12 - cy * 2 - j, WALL_Z, m);
    }
  }

  tick(): void {
    if (this.phase === 3) return;
    const allIn = this.phase === 1 && this.everyone().every((id) => this.submitted.has(id));
    if (this.t >= this.phaseEnds || allIn) {
      if (this.phase === 0) {
        this.showTarget(false);
        this.phase = 1;
        this.phaseEnds = this.t + ANSWER;
        this.m.title(null, 'Click the blocks', 'Match the picture on your pad · green submits', '#1f9d5b', 1500);
        this.m.sound('pling', undefined, 1.6);
        for (const id of this.players()) {
          const pad = this.padOf.get(id), b = this.m.host.body(id);
          if (pad !== undefined && b) {
            const px = padX(pad), pz = padZ(pad), bx = Math.floor(b.x), bz = Math.floor(b.z);
            if (bx < px - 1 || bx > px + PAD + 1 || bz < pz - 1 || bz > pz + PAD + 2) { const s = this.padSpot(pad); this.m.host.teleport(id, s.x, s.y, s.z, s.yaw); }
          }
          this.sendPad(id);
        }
        this.board();
      } else if (this.phase === 1) {
        this.judge();
        this.showTarget(true);
        this.phase = 2;
        this.phaseEnds = this.t + REVEAL;
        this.board();
      } else if (this.phase === 2) this.nextStage();
    }
    if (this.t % 20 === 0) for (const id of this.players()) this.sendPad(id);
  }

  private judge(): void {
    const size = SIZES[this.stage];
    for (const id of this.participants) {
      const answer = this.answers.get(id)!;
      let correct = 0;
      for (let x = 0; x < size; x++) for (let z = 0; z < size; z++) if (answer[x][z] === this.target[x][z]) correct++;
      let points = Math.floor(correct * 20 / (size * size) + .5) / 2;
      const perfect = correct === size * size;
      if (perfect && this.submittedAt.has(id)) {
        const speed = Math.max(0, 1 - (this.submittedAt.get(id)! - (this.phaseEnds - ANSWER)) / ANSWER);
        points += 2 + Math.floor(speed * 6 + .5) / 2;
      }
      this.score.set(id, this.scoreOf(id) + points);
      this.scoreTick.set(id, this.t);
      this.m.bar(id, `Picture ${this.stage + 1}: ${correct}/${size * size} right  +${fmt(points)}${perfect ? '  Perfect' : ''}`, perfect ? '#d99a00' : '#a77a00');
      this.m.host.send(id, { k: 'fx', fx: [{ f: 'sound', s: perfect ? 'toast' : 'bell' }] });
    }
  }

  /** Shows a player their own pad; everyone else's look blank to them. */
  sendPad(id: number): void {
    const pad = this.padOf.get(id), answer = this.answers.get(id);
    if (pad === undefined || !answer || this.stage < 0 || this.stage >= SIZES.length) return;
    const size = SIZES[this.stage];
    const edits = [];
    for (let x = 0; x < PAD; x++) for (let z = 0; z < PAD; z++) {
      const m = x >= size || z >= size ? 'light_gray_concrete' : answer[x][z] < 0 ? BLANK : PALETTE[answer[x][z]];
      edits.push({ x: padX(pad) + x, y: BASE_Y, z: padZ(pad) + z, block: mc(m) });
    }
    edits.push({ x: padX(pad) + 2, y: BASE_Y, z: padZ(pad) + PAD, block: mc(this.submitted.has(id) ? 'emerald_block' : 'lime_concrete') });
    this.m.host.sendBlocks(id, edits);
  }

  private click(id: number, bx: number, wy: number, bz: number, back: boolean): void {
    if (this.phase !== 1) return;
    const pad = this.padOf.get(id);
    if (pad === undefined || this.submitted.has(id)) { this.sendPad(id); return; }
    const by = wy - BASE_Y, px = padX(pad), pz = padZ(pad);
    const onOurPad = (bx >= px && bx < px + PAD && bz >= pz && bz < pz + PAD && by === 0) || (bx === px + 2 && bz === pz + PAD && by === 0);
    if (!onOurPad) {
      this.m.bar(id, 'Click the blocks on your own pad', '#e5484d');
      this.m.host.send(id, { k: 'fx', fx: [{ f: 'sound', s: 'bass', pitch: .6 }] });
      this.sendPad(id);
      return;
    }
    const x = bx - px, z = bz - pz, size = SIZES[this.stage];
    if (x === 2 && z === PAD) {
      this.submitted.add(id);
      this.submittedAt.set(id, this.t);
      this.m.host.send(id, { k: 'fx', fx: [{ f: 'sound', s: 'pickup', pitch: 1.4 }] });
      this.m.bar(id, 'Submitted. Waiting for the others…', '#1f9d5b');
      this.sendPad(id);
      return;
    }
    if (x < 0 || z < 0 || x >= size || z >= size) { this.sendPad(id); return; }
    const answer = this.answers.get(id)!, colours = this.stage + 2, cur = answer[x][z];
    answer[x][z] = back ? (cur <= -1 ? colours - 1 : cur - 1) : (cur + 1 >= colours ? -1 : cur + 1);
    this.m.host.send(id, { k: 'fx', fx: [{ f: 'sound', s: 'click', pitch: 1.2 + answer[x][z] * .15 }] });
    this.sendPad(id);
  }
  onLeftClick(id: number, x: number, y: number, z: number): boolean { this.click(id, x, y, z, true); return true; }
  onRightClick(id: number, hit: BlockHit): boolean { this.click(id, hit.x, hit.y, hit.z, false); return true; }

  over(): boolean { return this.phase === 3; }
  bar(id: number): string {
    const what = this.phase === 0 ? 'Memorise the picture on the wall'
      : this.phase === 1 ? (this.submitted.has(id) ? 'Submitted. Waiting for the others' : 'Click blocks to cycle colours · green submits')
        : this.phase === 2 ? 'Answer revealed' : 'Done';
    const left = Math.floor(Math.max(0, this.phaseEnds - this.t) / 20);
    return `${what}${this.phase < 2 ? ` (${left}s)` : ''}  ·  ${fmt(this.scoreOf(id))} pts`;
  }
  botView(): MemoryView { return { phase: this.phase, stage: this.stage, target: this.phase === 0 ? this.target : null, pad: undefined, answer: undefined, submitted: false, phaseEnds: this.phaseEnds }; }
  cleanup(): void {
    if (this.stage >= 0 && this.stage < SIZES.length) this.showTarget(false);
    for (let x = -5; x <= 4; x++) for (let y = 3; y <= 12; y++) this.put(x, y, WALL_Z, 'light_gray_concrete');
    this.m.setBoard(null);
    this.flush();
  }
}
