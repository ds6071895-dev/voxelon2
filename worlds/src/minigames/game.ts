// One Party Games mini-game (source Minigame). Subclasses describe their
// arena and play a round through the hooks below; this base keeps the round's
// bookkeeping (who is in, the order people dropped out or finished, scores)
// and turns it into placements. Coordinates are arena-local, as in the
// source: local (x, y, z) is world (x, BASE_Y + y, z).

import type { ModeHost, Edit } from '../net/mode_engine';
import type { Sim } from '../vanilla/sim';
import type { MAction, BlockHit } from '../vanilla/messages';
import type { VStack } from '../vanilla/stack';
import type { Entity } from '../vanilla/entity';
import { mc } from '../vanilla/mc_materials';
import { fmt, clock, ordinal, rankByScore, mgGame, type MgCategory, type MgGameInfo } from '../minigames_rules';
import type { MgBoard } from '../minigames_state';
import { BASE_Y, type ArenaDef } from './arena';

export interface Spot { x: number; y: number; z: number; yaw: number }

/** What the match gives a game. */
export interface MgCtx {
  readonly host: ModeHost;
  readonly sim: Sim;
  readonly rng: () => number;
  name(id: number): string;
  isBot(id: number): boolean;
  later(ticks: number, fn: () => void): void;
  /** Action-bar text for one player. */
  bar(id: number, text: string, color?: string): void;
  title(id: number | null, title: string, sub: string, color: string, ms?: number): void;
  feed(text: string, tone?: string): void;
  sound(s: string, at?: { x: number; y: number; z: number }, pitch?: number): void;
  setBoard(b: MgBoard | null): void;
  /** The first racer home starts the short clock for the rest. */
  raceGrace(): void;
  /** A bot asks its game for knowledge a human would read off the screen. */
}

/** Minecraft yaw in degrees (0 = south, 90 = west) to Worlds yaw (0 = north, forward = (-sin, -cos)). */
export const mcYaw = (deg: number): number => Math.PI - deg * Math.PI / 180;
/** Worlds yaw that looks from (x, z) toward (tx, tz). */
export const yawToward = (x: number, z: number, tx: number, tz: number): number => Math.atan2(-(tx - x), -(tz - z));

export abstract class Minigame {
  abstract readonly id: string;
  abstract readonly arena: ArenaDef;
  m!: MgCtx;
  get info(): MgGameInfo { return mgGame(this.id)!; }
  get category(): MgCategory { return this.info.category; }
  get seconds(): number { return this.info.seconds; }
  get random(): () => number { return this.m.rng; }

  readonly participants = new Set<number>();
  readonly alive = new Set<number>();
  readonly outOrder: Set<number>[] = [];
  private lastOutTick = -1;
  readonly finishOrder: Set<number>[] = [];
  private lastFinishTick = -1;
  readonly score = new Map<number, number>();
  readonly scoreTick = new Map<number, number>();
  readonly progress = new Map<number, number>();
  private readonly startSpots = new Map<number, Spot>();
  readonly finishTimes = new Map<number, number>();
  readonly outTimes = new Map<number, number>();
  /** Round ticks since the start whistle. */
  t = 0;
  /** Block writes this tick, flushed as one batch. */
  private pending = new Map<number, Edit>();

  // ── Description ─────────────────────────────────────────────────────────

  /** Start positions, at least `count`, in world coordinates (use `at`). */
  abstract spawns(count: number): Spot[];
  /** Where eliminated players watch from. */
  abstract spectate(): Spot;
  /** Players below this local Y have fallen out. */
  fallY(): number { return -12; }
  graceSeconds(): number { return this.info.grace; }
  guidance(_id: number): { x:number; y:number; z:number; nx:number; ny:number; nz:number } | null { return null; }
  collidable(): boolean { return this.category !== 'RACE'; }

  // ── Round hooks ─────────────────────────────────────────────────────────

  setup(_players: number[]): void { }
  begin(): void { }
  tick(): void { }
  finish(): void { }
  cleanup(): void { }
  over(): boolean {
    switch (this.category) {
      case 'SURVIVAL': return this.alive.size <= 1;
      case 'RACE': return this.alive.size === 0;
      default: return false;
    }
  }
  status(): string {
    switch (this.category) {
      case 'SURVIVAL': return `Alive: ${this.alive.size}/${this.participants.size}`;
      case 'RACE': return `Finished: ${this.participants.size - this.alive.size}/${this.participants.size}`;
      default: return this.leaderLine();
    }
  }
  bar(id: number): string | null {
    return this.category === 'SCORE' || this.category === 'BRAIN' ? `Your score: ${fmt(this.scoreOf(id))}` : null;
  }
  /** A new left-click on a block (mining start). True = handled (no mining). */
  onLeftClick(_id: number, _x: number, _y: number, _z: number): boolean { return true; }
  /** Right-click on a block. True = handled (no placing/using). */
  onRightClick(_id: number, _hit: BlockHit): boolean { return false; }
  /** Bow, items, eating... False blocks the use. */
  canUse(_id: number, _stack: VStack | null): boolean { return true; }
  canBreak(_id: number, _x: number, _y: number, _z: number, _block: number): boolean { return false; }
  canPlace(_id: number, _x: number, _y: number, _z: number, _block: number): boolean { return false; }
  onBroken(_id: number, _x: number, _y: number, _z: number, _block: number): void { }
  onPlaced(_id: number, _slot: number, _edits: Edit[]): void { }
  /** An arrow stuck in a block. True removes it. */
  onArrowBlock(_e: Entity, _x: number, _y: number, _z: number): boolean { return false; }
  onQuit(_id: number): void { }
  /** Game abilities and interactions, before vanilla item handling. */
  onAction(_id: number, _action: MAction): boolean { return false; }
  onProjectile(_e: Entity, _target: { player?: number; ent?: Entity; block?: { x: number; y: number; z: number } }): boolean { return false; }
  canWalk(_id: number): boolean { return true; }
  doubleJumps(_id: number): number { return 0; }
  melee(_attacker: number, _victim: number): boolean { return false; }
  /** Below fallY: survival eliminates, everything else puts you back. */
  onFall(id: number): void {
    if (this.category === 'SURVIVAL') this.eliminate(id, 'fell out');
    else this.respawn(id);
  }
  /** A per-game hint for bots (what a human sees on screen). */
  botView(): unknown { return null; }

  // ── Plumbing (the match calls these) ───────────────────────────────────

  attach(m: MgCtx): void { this.m = m; }

  startRound(players: number[], spots: Spot[]): void {
    this.participants.clear(); this.alive.clear(); this.outOrder.length = 0; this.finishOrder.length = 0;
    this.score.clear(); this.scoreTick.clear(); this.progress.clear(); this.finishTimes.clear(); this.outTimes.clear();
    this.startSpots.clear(); this.pending.clear();
    this.lastOutTick = -1; this.lastFinishTick = -1; this.t = 0;
    players.forEach((id, i) => {
      this.participants.add(id); this.alive.add(id); this.score.set(id, 0);
      this.startSpots.set(id, spots[i % spots.length]);
    });
    this.setup(players);
    this.flush();
  }

  runTick(): void {
    this.t++;
    const limit = BASE_Y + this.fallY();
    for (const id of [...this.alive]) {
      const b = this.m.host.body(id);
      if (b && b.y < limit) this.onFall(id);
    }
    this.tick();
    this.flush();
  }

  quit(id: number): void {
    this.participants.delete(id); this.alive.delete(id);
    for (const g of this.outOrder) g.delete(id);
    for (const g of this.finishOrder) g.delete(id);
    this.score.delete(id); this.progress.delete(id); this.startSpots.delete(id);
    this.onQuit(id);
  }

  /** Placement groups, best first. */
  placements(): number[][] {
    const groups: number[][] = [];
    if (this.category === 'SURVIVAL') {
      if (this.alive.size) groups.push(...rankByScore(this.alive, (id) => this.scoreOf(id), null));
      for (let i = this.outOrder.length - 1; i >= 0; i--) if (this.outOrder[i].size) groups.push([...this.outOrder[i]]);
    } else if (this.category === 'RACE') {
      for (const g of this.finishOrder) if (g.size) groups.push([...g]);
      const unfinished = [...this.participants].filter((id) => !this.finishTimes.has(id));
      groups.push(...rankByScore(unfinished, (id) => this.progress.get(id) ?? 0, null));
    } else {
      groups.push(...rankByScore(this.participants, (id) => this.scoreOf(id), (id) => this.scoreTick.get(id) ?? Number.MAX_SAFE_INTEGER));
    }
    return groups.filter((g) => g.length);
  }

  /** One line about a player's round for the results card. */
  detail(id: number): string {
    switch (this.category) {
      case 'SCORE': case 'BRAIN': return `${fmt(this.scoreOf(id))} pts`;
      case 'RACE': return this.finishTimes.has(id) ? clock(this.finishTimes.get(id)!) : this.progressDetail(id);
      case 'SURVIVAL': return this.alive.has(id) ? 'survived' : this.outTimes.has(id) ? `out at ${Math.floor(this.outTimes.get(id)! / 20)}s` : '';
    }
  }
  progressDetail(_id: number): string { return 'DNF'; }

  // ── Helpers ────────────────────────────────────────────────────────────

  scoreOf(id: number): number { return this.score.get(id) ?? 0; }
  addScore(id: number, amount: number): void {
    this.score.set(id, this.scoreOf(id) + amount);
    this.scoreTick.set(id, this.t);
  }
  setScore(id: number, value: number): void {
    if (this.scoreOf(id) !== value) { this.score.set(id, value); this.scoreTick.set(id, this.t); }
  }

  eliminate(id: number, reason: string): void {
    if (!this.alive.delete(id)) return;
    if (this.t !== this.lastOutTick || !this.outOrder.length) { this.outOrder.push(new Set()); this.lastOutTick = this.t; }
    this.outOrder[this.outOrder.length - 1].add(id);
    this.outTimes.set(id, this.t);
    this.toSpectator(id);
    this.m.feed(`${this.m.name(id)} ${reason}. ${this.alive.size} left.`, 'death');
    this.m.title(id, 'Out', reason, '#e5484d', 1900);
    this.m.sound('hurt', this.m.host.body(id), .8);
  }

  finishRace(id: number): void {
    if (!this.alive.delete(id)) return;
    if (this.t !== this.lastFinishTick || !this.finishOrder.length) { this.finishOrder.push(new Set()); this.lastFinishTick = this.t; }
    this.finishOrder[this.finishOrder.length - 1].add(id);
    this.finishTimes.set(id, this.t);
    let place = 0;
    for (const g of this.finishOrder) place += g.size;
    this.m.feed(`${this.m.name(id)} finished ${ordinal(place)} in ${clock(this.t)}`, 'good');
    this.m.title(id, ordinal(place), clock(this.t), '#d99a00', 2200);
    this.m.sound('toast', this.m.host.body(id), 1.2);
    if (this.alive.size && this.finishOrder.length === 1 && this.finishOrder[0].size === 1) this.m.raceGrace();
    this.toSpectator(id);
  }

  retire(id: number, reason: string): void {
    if (!this.alive.delete(id)) return;
    this.outTimes.set(id, this.t);
    this.toSpectator(id);
    this.m.feed(`${this.m.name(id)} ${reason}.`, 'death');
    this.m.title(id, 'Caught', reason, '#e5484d', 1900);
  }

  toSpectator(id: number): void {
    const p = this.m.sim.players.get(id);
    if (p) {
      p.inv.slots.fill(null); p.inv.cursor = null; p.invDirty = true;
      p.effects.clear(); p.fire = 0; p.spectator = true; p.using = null; p.dig = null;
    }
    const s = this.spectate();
    this.m.host.teleport(id, s.x, s.y, s.z, s.yaw);
  }

  respawn(id: number): void {
    let s = this.startSpots.get(id);
    if (!s) { const all = this.spawns(Math.max(1, this.participants.size)); s = all[Math.max(0, this.indexOf(id)) % all.length]; }
    this.m.host.teleport(id, s.x, s.y, s.z, s.yaw);
    const p = this.m.sim.players.get(id);
    if (p) { p.fire = 0; p.fallDist = 0; }
  }

  /** Participants still in the round (survival: not out; race: not finished). */
  players(): number[] { return [...this.alive].filter((id) => !!this.m.host.body(id)); }
  everyone(): number[] { return [...this.participants].filter((id) => !!this.m.host.body(id)); }
  indexOf(id: number): number { return [...this.participants].indexOf(id); }

  /** World position of a local point. */
  at(x: number, y: number, z: number, yaw = 0): Spot { return { x, y: y + BASE_Y, z, yaw }; }
  /** Local block coordinates of a world body. */
  lx(v: number): number { return Math.floor(v); }
  ly(v: number): number { return Math.floor(v) - BASE_Y; }
  dy(v: number): number { return v - BASE_Y; }

  /** The block at a local position (this tick's pending writes included). */
  get(x: number, y: number, z: number): number {
    const k = key(x, y, z);
    const p = this.pending.get(k);
    return p ? p.block : this.m.host.getBlock(x, y + BASE_Y, z);
  }
  /** Write a block (material name, state string or id) at a local position. */
  put(x: number, y: number, z: number, block: string | number): void {
    const id = typeof block === 'number' ? block : mc(block);
    this.pending.set(key(x, y, z), { x, y: y + BASE_Y, z, block: id });
  }
  flush(): void {
    if (!this.pending.size) return;
    const list = [...this.pending.values()];
    this.pending.clear();
    this.m.sim.edits(list);
  }

  /** Players spread evenly on a circle, facing the centre. */
  ring(count: number, radius: number, y: number, phase: number): Spot[] {
    const n = Math.max(1, count), out: Spot[] = [];
    for (let i = 0; i < n; i++) {
      const a = phase + Math.PI * 2 * i / n;
      const x = Math.cos(a) * radius, z = Math.sin(a) * radius;
      out.push(this.at(x + .5, y, z + .5, yawToward(x, z, 0, 0)));
    }
    return out;
  }
  /** Players in a row along X at z, facing `mcDeg`. */
  line(count: number, centreX: number, y: number, z: number, spacing: number, mcDeg: number): Spot[] {
    const out: Spot[] = [];
    for (let i = 0; i < Math.max(1, count); i++) {
      const x = centreX + (i - (count - 1) / 2) * spacing;
      out.push(this.at(x + .5, y, z + .5, mcYaw(mcDeg)));
    }
    return out;
  }

  leaderLine(): string {
    let best: number | null = null;
    for (const id of this.participants) if (best === null || this.scoreOf(id) > this.scoreOf(best)) best = id;
    if (best === null || this.scoreOf(best) <= 0) return '';
    return `Leader: ${this.m.name(best)} ${fmt(this.scoreOf(best))}`;
  }

  /** Give a stack into a hotbar/inventory slot. */
  setSlot(id: number, slot: number, s: VStack | null): void {
    const p = this.m.sim.players.get(id);
    if (!p) return;
    p.inv.slots[slot] = s; p.invDirty = true;
  }
}

const key = (x: number, y: number, z: number) => ((x + 2048) * 4096 + (z + 2048)) * 512 + (y + 256);
