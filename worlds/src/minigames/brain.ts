// Brain Rush (source games/BrainRush): a quiz-show studio with four coloured
// answer platforms. Ten quick questions (mental arithmetic, sequences,
// missing numbers, "which is biggest", percentages) getting harder. Stand on
// your answer when time runs out: right is a point, and the first to settle
// on it gets a bonus. Wrong platforms drop you into the honey pit. The
// question and the four answers show on the Worlds board (the source's signs).

import { E, N, S, W, step } from '../vanilla/deco';
import { Minigame, type Spot } from './game';
import { BASE_Y, type ArenaDef } from './arena';

export const LETTERS = ['A', 'B', 'C', 'D'];
export const COLORS = ['#d0342c', '#2f4fc4', '#62b733', '#e6b81e'];
const FLOORS = ['red_concrete', 'blue_concrete', 'lime_concrete', 'yellow_concrete'];
const GLASS = ['red_stained_glass', 'blue_stained_glass', 'lime_stained_glass', 'yellow_stained_glass'];
const BANNERS = ['red', 'blue', 'lime', 'yellow'];
/** Platform centres: A north, B east, C south, D west. */
export const CENTRES = [[0, -7], [7, 0], [0, 7], [-7, 0]] as const;
export const QUESTIONS = 10, THINK = 180, REVEAL = 60;

export interface Question { prompt: string; options: string[]; answer: number }

export function platformAt(x: number, z: number): number {
  for (let i = 0; i < 4; i++) if (Math.abs(x - CENTRES[i][0] - .5) <= 3.5 && Math.abs(z - CENTRES[i][1] - .5) <= 3.5) return i;
  return -1;
}

export const BRAIN_ARENA: ArenaDef = {
  id: 'brain',
  build(d) {
    const R = 22;
    d.fill(-R, -8, -R, R, -8, R, 'black_concrete');
    for (let x = -R; x <= R; x++) for (let z = -R; z <= R; z++) {
      if (!(Math.abs(x) <= 11 && Math.abs(z) <= 11)) d.set(x, 0, z, ((x + z) & 1) === 0 ? 'black_concrete' : 'gray_concrete');
    }
    for (let x = -11; x <= 11; x++) for (let z = -11; z <= 11; z++) d.set(x, -6, z, 'honey_block');
    d.walls(-12, -7, -12, 12, -1, 12, 'polished_blackstone_bricks');
    for (let i = -10; i <= 10; i += 4) {
      d.set(i, -3, -12, 'sea_lantern'); d.set(i, -3, 12, 'sea_lantern');
      d.set(-12, -3, i, 'sea_lantern'); d.set(12, -3, i, 'sea_lantern');
    }
    for (let x = -3; x <= 3; x++) for (let z = -3; z <= 3; z++) {
      d.set(x, 0, z, Math.abs(x) === 3 || Math.abs(z) === 3 ? 'quartz_bricks' : 'white_concrete');
      d.set(x, -1, z, 'quartz_bricks');
    }
    for (let i = 0; i < 4; i++) {
      const cx = CENTRES[i][0], cz = CENTRES[i][1];
      const out = [Math.sign(cx), Math.sign(cz)];
      const facing = out[0] > 0 ? W : out[0] < 0 ? E : out[1] > 0 ? N : S;
      const wx = cx + out[0] * 5, wz = cz + out[1] * 5;
      for (let a = -4; a <= 4; a++) for (let y = 1; y <= 9; y++) {
        const x = wx + (out[0] === 0 ? a : 0), z = wz + (out[1] === 0 ? a : 0);
        const edge = Math.abs(a) === 4 || y === 1 || y === 9;
        d.data(x, y, z, edge ? 'polished_blackstone_bricks' : y >= 3 && y <= 7 ? 'black_concrete' : GLASS[i]);
      }
      const f = step(facing);
      // The source's sign: a coloured letter panel here (the text is on the board).
      d.set(wx + f[0], 5, wz + f[2], FLOORS[i]);
      for (const side of [-2, 2]) d.wallBanner(wx + f[0] + (out[0] === 0 ? side : 0), 7, wz + f[2] + (out[1] === 0 ? side : 0), BANNERS[i], facing);
    }
    d.walls(-R, 1, -R, R, 12, R, 'black_concrete');
    for (let i = -R + 2; i <= R - 2; i += 4) for (let y = 3; y <= 10; y += 7) {
      d.set(i, y, -R, 'sea_lantern'); d.set(i, y, R, 'sea_lantern'); d.set(-R, y, i, 'sea_lantern'); d.set(R, y, i, 'sea_lantern');
    }
    const fm = (a: number) => ((a % 5) + 5) % 5;
    for (let x = -R; x <= R; x++) for (let z = -R; z <= R; z++) d.set(x, 13, z, fm(x) === 0 && fm(z) === 0 ? 'shroomlight' : 'black_concrete');
    for (const [cx, cz] of [[-17, -17], [17, -17], [-17, 17], [17, 17]]) {
      d.column(cx, 1, cz, 2, 'iron_bars');
      d.set(cx, 3, cz, 'black_concrete');
      d.set(cx - Math.sign(cx), 3, cz, 'gray_concrete');
      d.data(cx - 2 * Math.sign(cx), 3, cz, 'tinted_glass');
    }
    d.bleachers(N, 14, -10, 10, 1, 5, 'red_nether_brick_stairs', 'red_nether_bricks');
    for (let x = -3; x <= 3; x++) { d.set(x, 1, -16, 'quartz_bricks'); d.slab(x, 2, -16, 'smooth_quartz_slab', true); }
    d.data(0, 3, -16, 'lantern[hanging=false]');
    d.set(0, 1, -18, 'gold_block');
    d.set(0, 2, -18, 'gold_block');
    d.underside(0, -8, 0, 24, 6, 'blackstone', 'deepslate');
  },
  layer(d) { for (let i = 0; i < 4; i++) platform((x, z, m) => m ? d.set(x, 0, z, m) : d.air(x, 0, z), i, true); },
};

function platform(set: (x: number, z: number, m: string | null) => void, i: number, present: boolean): void {
  const cx = CENTRES[i][0], cz = CENTRES[i][1];
  for (let x = cx - 3; x <= cx + 3; x++) for (let z = cz - 3; z <= cz + 3; z++) {
    if (Math.abs(x) <= 3 && Math.abs(z) <= 3) continue;
    set(x, z, !present ? null : Math.abs(x - cx) === 3 || Math.abs(z - cz) === 3 ? 'smooth_quartz' : FLOORS[i]);
  }
}

const ri = (r: () => number, n: number) => Math.floor(r() * n);
function shuffle<T>(a: T[], r: () => number): void { for (let i = a.length - 1; i > 0; i--) { const j = ri(r, i + 1); [a[i], a[j]] = [a[j], a[i]]; } }

/** A question of rising difficulty (level 0 easy .. 3 hard), with three plausible wrong answers. */
export function generate(r: () => number, level: number): Question {
  const kind = ri(r, level === 0 ? 3 : 5);
  let prompt: string, answer: string;
  const wrong: string[] = [];
  if (kind === 1) {
    const type = ri(r, level >= 2 ? 4 : 2);
    const seq = new Array(5).fill(0);
    if (type === 0) { const start = 2 + ri(r, 20), st = 3 + ri(r, 6 + level * 3); for (let i = 0; i < 5; i++) seq[i] = start + st * i; }
    else if (type === 1) { const start = 1 + ri(r, 4), factor = 2 + ri(r, 2); seq[0] = start; for (let i = 1; i < 5; i++) seq[i] = seq[i - 1] * factor; }
    else if (type === 2) { const offset = ri(r, 4); for (let i = 0; i < 5; i++) seq[i] = (i + 2 + offset) * (i + 2 + offset); }
    else { seq[0] = 1 + ri(r, 3); for (let i = 1; i < 5; i++) seq[i] = seq[i - 1] * 2 + 1; }
    prompt = `${seq[0]}, ${seq[1]}, ${seq[2]}, ${seq[3]}, ?`;
    answer = String(seq[4]);
    const a = seq[4], diff = seq[4] - seq[3];
    for (const c of [a + 1, a - 1, a + diff, a - 2, a + 2, seq[3] + Math.trunc(diff / 2) + 1]) wrong.push(String(c));
  } else if (kind === 2) {
    const a = 3 + ri(r, 7 + level * 2), b = 3 + ri(r, 9);
    prompt = `? × ${b} = ${a * b}`;
    answer = String(a);
    for (const c of [a + 1, a - 1, a + 2, b, a - 2]) wrong.push(String(c));
  } else if (kind === 3) {
    const exprs: [number, number][] = [];
    const base = 30 + ri(r, 40 + level * 20);
    for (let i = 0; i < 4; i++) exprs.push([base + ri(r, 9) - 4, 3 + ri(r, 7)]);
    const seen = new Set<number>();
    for (const e of exprs) { while (seen.has(e[0])) e[0]++; seen.add(e[0]); }
    let best = 0;
    const labels: string[] = [];
    for (let i = 0; i < 4; i++) {
      const [value, a] = exprs[i];
      labels.push(value % a === 0 ? `${a}×${value / a}` : `${(value - value % a) / a}×${a}+${value % a}`);
      if (value > exprs[best][0]) best = i;
    }
    prompt = 'Which is biggest?';
    answer = labels[best];
    for (let i = 0; i < 4; i++) if (i !== best) wrong.push(labels[i]);
  } else if (kind === 4) {
    const whole = (4 + ri(r, 12)) * 20;
    const pct = [15, 25, 35, 45, 60, 75][ri(r, 6)];
    prompt = `${pct}% of ${whole} = ?`;
    const a = Math.trunc(whole * pct / 100);
    answer = String(a);
    for (const c of [a + 5, a - 5, a + 10, Math.trunc(whole * (pct + 10) / 100), a - 10]) wrong.push(String(c));
  } else {
    const a = 6 + ri(r, 8 + level * 4), b = 3 + ri(r, 7 + level), c = 4 + ri(r, 30 + level * 15);
    const plus = r() < .5;
    prompt = `${a} × ${b} ${plus ? '+' : '−'} ${c} = ?`;
    const value = a * b + (plus ? c : -c);
    answer = String(value);
    for (const w of [value + 10, value - 10, value + b, value - b, value + 1, a * (b + 1) + (plus ? c : -c)]) wrong.push(String(w));
  }
  const options: string[] = [answer];
  shuffle(wrong, r);
  for (const w of wrong) if (options.length < 4 && w !== answer && !options.includes(w)) options.push(w);
  let filler = 1;
  while (options.length < 4) options.push(`${answer}+${filler++}`);
  shuffle(options, r);
  return { prompt, options, answer: options.indexOf(answer) };
}

export interface BrainView { phase: number; question: Question | null; number: number; phaseEnds: number }

export class BrainRush extends Minigame {
  readonly id = 'brain';
  readonly arena = BRAIN_ARENA;
  current: Question | null = null;
  number = 0;
  /** 0 thinking, 1 reveal, 2 done. */
  phase = 2;
  phaseEnds = 0;
  private readonly standing = new Map<number, number>();
  private readonly settledAt = new Map<number, number>();
  private readonly fallen = new Set<number>();

  spawns(count: number): Spot[] { return this.ring(count, Math.min(3.2, 1.5 + .2 * count), 1, this.random() * Math.PI * 2); }
  spectate(): Spot { return this.at(.5, 12, 18.5, 0); }

  setup(): void { this.number = 0; this.phase = 2; this.standing.clear(); this.settledAt.clear(); this.fallen.clear(); }
  begin(): void { this.ask(); }

  private setPlatform(i: number, present: boolean): void {
    platform((x, z, m) => this.put(x, 0, z, m ?? 'air'), i, present);
  }

  private ask(): void {
    this.number++;
    if (this.number > QUESTIONS) { this.phase = 2; this.current = null; this.m.setBoard(null); return; }
    this.current = generate(this.random, Math.min(3, Math.floor((this.number - 1) / 3)));
    this.phase = 0;
    this.phaseEnds = this.t + THINK;
    this.settledAt.clear(); this.standing.clear();
    for (let i = 0; i < 4; i++) this.setPlatform(i, true);
    this.board(false);
    this.m.feed(`Q${this.number}: ${this.current.prompt}   ${this.current.options.map((o, i) => `${LETTERS[i]}: ${o}`).join('   ')}`, 'info');
    this.m.sound('pling', undefined, 1 + this.number * .05);
  }
  private board(reveal: boolean): void {
    const q = this.current!;
    this.m.setBoard({
      title: q.prompt, sub: `Question ${this.number} of ${QUESTIONS}`,
      options: q.options.map((text, i) => ({ label: LETTERS[i], text, color: COLORS[i], right: reveal ? i === q.answer : undefined })),
    });
  }

  tick(): void {
    if (this.phase === 2) return;
    for (const id of this.players()) {
      if (this.fallen.has(id)) continue;
      const b = this.m.host.body(id)!;
      const on = platformAt(b.x, b.z);
      const was = this.standing.get(id);
      this.standing.set(id, on);
      if (was === undefined || was !== on) this.settledAt.set(id, this.t);
    }
    if (this.phase === 0 && this.t % 20 === 0 && this.phaseEnds - this.t <= 60 && this.phaseEnds - this.t > 0) this.m.sound('hat', undefined, 1.5);
    if (this.t >= this.phaseEnds) {
      if (this.phase === 0) this.lock();
      else {
        for (const id of this.fallen) {
          const b = this.m.host.body(id);
          if (b) this.m.host.teleport(id, .5, BASE_Y + 1, .5, b.yaw);
        }
        this.fallen.clear();
        this.ask();
      }
    }
  }

  private lock(): void {
    this.phase = 1;
    this.phaseEnds = this.t + REVEAL;
    const right = this.current!.answer;
    let quickest: number[] = [];
    let bestSettle = Infinity;
    for (const id of this.players()) {
      const on = this.standing.get(id) ?? -1;
      if (on === right) {
        this.addScore(id, 1);
        const settled = this.settledAt.get(id) ?? 0;
        if (settled < bestSettle) { bestSettle = settled; quickest = []; }
        if (settled === bestSettle) quickest.push(id);
        this.m.host.send(id, { k: 'fx', fx: [{ f: 'sound', s: 'levelup', pitch: 1.6 }] });
      } else {
        this.fallen.add(id);
        this.m.host.send(id, { k: 'fx', fx: [{ f: 'sound', s: 'bass', pitch: 1 }] });
      }
    }
    if (quickest.length) {
      const winner = quickest[Math.floor(this.random() * quickest.length)];
      this.addScore(winner, 1);
      this.m.bar(winner, 'Quickest correct answer: +1 bonus', '#d99a00');
    }
    for (let i = 0; i < 4; i++) if (i !== right) this.setPlatform(i, false);
    // The centre drops too: no answer is a wrong answer.
    for (const id of [...this.fallen]) {
      if ((this.standing.get(id) ?? -1) < 0) {
        const a = this.random() * Math.PI * 2;
        this.m.host.teleport(id, .5 + Math.cos(a) * 2, BASE_Y - 4, .5 + Math.sin(a) * 2);
      }
    }
    this.board(true);
    this.m.feed(`Answer: ${LETTERS[right]} - ${this.current!.options[right]}`, 'info');
  }

  onFall(id: number): void { this.m.host.teleport(id, .5, BASE_Y + 1, .5); }
  over(): boolean { return this.phase === 2 && this.number > QUESTIONS; }
  bar(id: number): string { return `Question ${Math.min(this.number, QUESTIONS)}/${QUESTIONS}  ·  ${this.scoreOf(id)} pts`; }
  botView(): BrainView { return { phase: this.phase, question: this.current, number: this.number, phaseEnds: this.phaseEnds }; }
  cleanup(): void { for (let i = 0; i < 4; i++) this.setPlatform(i, true); this.m.setBoard(null); this.flush(); }
}
