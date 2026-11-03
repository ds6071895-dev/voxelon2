// The Party Games practice opponent (PartyPlayBot). One body with the same
// Player physics as a human and one skill value; each mini-game has a brain
// that reads only what a player could see (the moles, the targets, the wall
// picture, the question, the model, the hot/cold reading) and acts through
// the same gate as a human: movement, look, clicks, bow draws, placing.
//
// Skill (0.2..1.35) sets reaction time, aim error, memory and decision
// quality. Between mini-games it eases toward a close points race against
// the humans, and the server remembers it.

import { BLOCKS, isSolid } from './blocks';
import { Player } from './player';
import { FROZEN_INPUT, type PlayerInput } from './input';
import { findPath } from './vanilla/mobs';
import { VMETA } from './vanilla/blocks';
import { VI } from './vanilla/items';
import type { MAction } from './vanilla/messages';
import type { MinigamesMatch } from './minigames';
import { BASE_Y } from './minigames/arena';
import { WhackAMole, holeX, holeZ } from './minigames/whack';
import { CarnivalShootout, WALL_Z as SHOOT_WALL, DUCK_Z } from './minigames/shootout';
import { MemoryMosaic, PAD, padX, padZ, SIZES } from './minigames/memory';
import { BrainRush, CENTRES } from './minigames/brain';
import { KingOfTheHill } from './minigames/hill';
import { SheepHerd,penCentre,towardCentre } from './minigames/sheep';
import { step } from './vanilla/deco';
import { RooftopTag } from './minigames/rooftop';
import { CoinCanopy } from './minigames/canopy';
import { BoatRush } from './minigames/boat';
import { ElytraRally } from './minigames/glide';
import { RedLight } from './minigames/red_light';
import { ParkourRace } from './minigames/parkour_race';
import { Pad, JumpModel } from './minigames/parkour';
import { NeonBlink, neonState } from './minigames/neon';
import { LunarLeap } from './minigames/lunar';
import { LavaClimb } from './minigames/lava';
import { HedgeMaze, mazeCell } from './minigames/maze';
import { GlacierSpleef } from './minigames/spleef';
import { DiscoDash } from './minigames/disco';
import { AnvilPanic } from './minigames/anvil';
import { TntRun } from './minigames/tnt_run';
import { BowSpleef } from './minigames/bow_spleef';
import { MusicalMinecarts } from './minigames/minecarts';
import { TreasureCove, HALF, DEPTH } from './minigames/treasure';

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * clamp(t, 0, 1);
const angleTo = (a: number, b: number) => { let d = b - a; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return d; };

export class MgBot {
  skill: number;
  private readonly baseline: number;
  readonly body: Player;
  private input: PlayerInput = { ...FROZEN_INPUT };
  private pitch = 0;
  private time = 0;
  private actAt = 0;
  private stuckAt = 0; private stuckPos = { x: 0, z: 0 };
  /** Per-round memory (each brain keeps what it needs here). */
  private mem: Record<string, unknown> = {};
  private readonly offset: { x: number; z: number };
  /** walkTo stopped at a hole. */
  private blocked = false;

  constructor(readonly match: MinigamesMatch, readonly id: number, learned: number | undefined, private readonly rng: () => number) {
    this.baseline = clamp(learned ?? .55, .2, 1.35);
    this.skill = this.baseline;
    const at = match.host.body(id);
    this.body = new Player(at ? { x: at.x, y: at.y, z: at.z } : { x: 0, y: BASE_Y + 1, z: 0 });
    this.body.energyDrainMult = 0;
    this.body.damageSink = () => {};
    this.body.moveKindAt = (x, y, z) => VMETA[match.host.getBlock(Math.floor(x), Math.floor(y), Math.floor(z))]?.move;
    const a = rng() * Math.PI * 2;
    this.offset = { x: Math.cos(a) * 1.4, z: Math.sin(a) * 1.4 };
  }
  get rating(): number { return clamp(this.baseline * .35 + this.skill * .65, .2, 1.35); }
  knockback(x:number,y:number,z:number):void {this.body.applyKnockback(x,y,z);}
  setVelocity(x:number,y:number,z:number,add=false):void {if(add)this.body.vel.set(this.body.vel.x+x,this.body.vel.y+y,this.body.vel.z+z);else this.body.vel.set(x,y,z);this.body.onGround=false;this.body.momentumTime=Math.max(this.body.momentumTime,.6);}
  private get s(): number { return Math.min(1, this.skill); }
  private act(a: MAction): void { this.match.handle(this.id, a); }

  /** A new mini-game: forget the last one. */
  onRound(): void { this.body.leaveBoat();this.body.gliding=false;this.mem = {}; this.actAt = this.time + 1; }

  /** After each mini-game: ease toward a close race with the best human. */
  adapt(): void {
    const m = this.match;
    const humans = [...m.roster.keys()].filter((id) => !m.host.body(id)?.bot);
    if (!humans.length) return;
    const best = Math.max(...humans.map((h) => m.totals.get(h) ?? 0));
    const mine = m.totals.get(this.id) ?? 0;
    const lead = mine - best;
    if (lead > 6) this.skill -= .08;
    else if (lead > 0) this.skill -= .03;
    else if (lead < -10) this.skill += .06;
    else if (lead < 0) this.skill += .02;
    this.skill = clamp(this.skill, .2, 1.35);
  }

  tick(dt: number): void {
    this.time += dt;
    const m = this.match, hb = m.host.body(this.id), p = m.sim.players.get(this.id);
    if (!hb || !p) return;
    const b = this.body;
    if (Math.hypot(hb.x - b.pos.x, hb.y - b.pos.y, hb.z - b.pos.z) > .8) { b.pos.set(hb.x, hb.y, hb.z); b.vel.set(0, 0, 0); b.yaw = hb.yaw; }
    const prof = m.sim.profileOf(p);
    b.vanilla = { gravity: prof.gravity, slowFall: prof.slowFall, levitation: prof.levitation, frozen: prof.frozen, canSprint: prof.canSprint };
    b.speedMult = prof.speed;
    b.jumpBoost = prof.jump;
    b.gliding = p.gliding;
    const mount=p.riding===null?null:m.sim.ents.all.get(p.riding);
    if(mount?.kind==='boat'&&!b.boat)b.mountBoat(mount.x,mount.y,mount.z,mount.yaw);
    else if(!mount&&b.boat)b.leaveBoat();
    this.input = { ...FROZEN_INPUT };
    const actions: (() => void)[] = [];
    const g = m.current;
    if (m.phase === 'round' && g && g.alive.has(this.id) && !p.spectator) {
      if (g instanceof WhackAMole) this.whack(g, actions);
      else if (g instanceof CarnivalShootout) this.shootout(g, actions);
      else if (g instanceof MemoryMosaic) this.memory(g, actions);
      else if (g instanceof BrainRush) this.brain(g);
      else if (g instanceof TreasureCove) this.treasure(g, actions);
      else if (g instanceof KingOfTheHill) this.hill(g,actions);
      else if (g instanceof SheepHerd) this.sheep(g,actions);
      else if (g instanceof RooftopTag) this.rooftop(g,actions);
      else if (g instanceof CoinCanopy) this.canopy(g);
      else if (g instanceof BoatRush) this.boatRace(g);
      else if (g instanceof ElytraRally) this.glideRace(g,actions);
      else if (g instanceof RedLight) this.redLight(g);
      else if (g instanceof ParkourRace) this.parkour(g);
      else if (g instanceof HedgeMaze) this.maze(g,actions);
      else if (g instanceof LavaClimb) this.lava(g);
      else if (g instanceof MusicalMinecarts) this.musical(g, actions);
      else if (g instanceof DiscoDash) this.disco(g);
      else if (g instanceof AnvilPanic || g instanceof TntRun || g instanceof GlacierSpleef || g instanceof BowSpleef) this.survive(g, actions);
    }
    b.pitch=this.pitch;
    b.update(dt, this.input, { getBlock: (x, y, z) => m.host.getBlock(x, y, z), isLoaded: () => true });
    m.host.drive(this.id, { x: b.pos.x, y: b.pos.y, z: b.pos.z, yaw: b.yaw, pitch: this.pitch, held: p.inv.slots[p.selected]?.id ?? 0, sneaking: b.sneaking, swing: actions.length > 0 });
    for (const a of actions) a();
  }

  /** Seconds before the bot reacts to something new. */
  private react(base = 1): number { return base * lerp(.85, .22, this.s) * (.75 + this.rng() * .5); }
  private ready(): boolean { return this.time >= this.actAt; }
  private wait(sec: number): void { this.actAt = this.time + sec; }

  // ── Movement and look ──────────────────────────────────────────────────

  private walkTo(x: number, z: number, near = .35, avoidHoles = false): boolean {
    const b = this.body, pos = b.pos;
    const dx = x - pos.x, dz = z - pos.z, d = Math.hypot(dx, dz);
    if (d < near) return true;
    const yaw = Math.atan2(-dx, -dz);
    this.turn(yaw, this.pitch, lerp(7, 16, this.s));
    this.input.forward = Math.abs(angleTo(b.yaw, yaw)) < .8;
    this.input.sprintKey = this.input.forward && d > 4 && this.s > .3;
    const fx = pos.x - Math.sin(b.yaw) * .6, fz = pos.z - Math.cos(b.yaw) * .6;
    const get = (a: number, c: number, e: number) => this.match.host.getBlock(a, c, e);
    if (b.onGround && isSolid(get(Math.floor(fx), Math.floor(pos.y + .1), Math.floor(fz))) && !isSolid(get(Math.floor(fx), Math.floor(pos.y + 1.1), Math.floor(fz)))) this.input.jump = true;
    this.blocked = false;
    if (avoidHoles && this.input.forward && b.onGround && !BLOCKS[get(Math.floor(fx), Math.floor(pos.y - .5), Math.floor(fz))]?.solid) { this.input.forward = false; this.input.sprintKey = false; this.blocked = true; return false; }
    if (Math.hypot(pos.x - this.stuckPos.x, pos.z - this.stuckPos.z) > .4) { this.stuckAt = this.time; this.stuckPos = { x: pos.x, z: pos.z }; }
    else if (this.time - this.stuckAt > 1.2) { this.input.jump = true; this.stuckAt = this.time; }
    return false;
  }
  private face(x: number, y: number, z: number, rate = lerp(6, 16, this.s)): boolean {
    const b = this.body;
    const yaw = Math.atan2(-(x - b.pos.x), -(z - b.pos.z));
    const pitch = Math.atan2(y - (b.pos.y + 1.62), Math.hypot(x - b.pos.x, z - b.pos.z));
    this.turn(yaw, pitch, rate);
    return Math.abs(angleTo(b.yaw, yaw)) < .12 && Math.abs(pitch - this.pitch) < .12;
  }
  private turn(yaw: number, pitch: number, rate: number): void {
    const step = rate * .05;
    this.body.yaw += clamp(angleTo(this.body.yaw, yaw), -step, step);
    this.pitch += clamp(pitch - this.pitch, -step, step);
  }
  private eyeDist(x: number, y: number, z: number): number {
    const b = this.body.pos;
    return Math.hypot(x - b.x, y - (b.y + 1.62), z - b.z);
  }
  private select(slot: number, actions: (() => void)[]): void {
    const p = this.match.sim.players.get(this.id);
    if (p && p.selected !== slot) actions.push(() => this.act({ k: 'select', slot }));
  }
  private click(x: number, y: number, z: number, actions: (() => void)[]): void {
    actions.push(() => { this.act({ k: 'dig', x, y, z }); this.act({ k: 'digStop' }); });
  }
  private useOn(x: number, y: number, z: number, nx: number, ny: number, nz: number, hitY: number, yaw: number, actions: (() => void)[]): void {
    const p = this.match.sim.players.get(this.id)!;
    actions.push(() => this.act({ k: 'use', slot: p.selected, block: { x, y, z, nx, ny, nz, hitY }, yaw, pitch: this.pitch }));
  }

  // ── Whack-a-Mole ────────────────────────────────────────────────────────

  private whack(g: WhackAMole, actions: (() => void)[]): void {
    const pos = this.body.pos;
    const seen = (this.mem.seen ??= new Map<number, number>()) as Map<number, number>;
    // Each mole is noticed a reaction time after it pops.
    for (const hole of g.moles.keys()) if (!seen.has(hole)) seen.set(hole, this.time + this.react(1.05));
    for (const hole of [...seen.keys()]) if (!g.moles.has(hole)) seen.delete(hole);
    let best: number | null = null, bestScore = -Infinity;
    for (const [hole, mole] of g.moles) {
      if ((seen.get(hole) ?? Infinity) > this.time) continue;
      // A weaker bot sometimes mistakes a bomb for a mole (decided once per mole).
      if (mole.kind === 'BOMB') {
        const fooled = (this.mem.fooled ??= new Map<number, boolean>()) as Map<number, boolean>;
        if (!fooled.has(hole)) fooled.set(hole, this.rng() < (1 - this.s) * .3);
        if (!fooled.get(hole)) continue;
      }
      const d = Math.hypot(holeX(hole) + .5 - pos.x, holeZ(hole) + .5 - pos.z);
      const left = (mole.hides - g.t) / 20;
      const value = (mole.kind === 'GOLD' ? 3 : 1) * 4 - d - (d / 4.3 > left ? 20 : 0);
      if (value > bestScore) { bestScore = value; best = hole; }
    }
    if (best === null) {
      const k = (this.mem.home ??= { x: this.offset.x * 2 + .5, z: this.offset.z * 2 + .5 }) as { x: number; z: number };
      this.walkTo(k.x, k.z, 1);
      return;
    }
    const tx = holeX(best) + .5, tz = holeZ(best) + .5;
    const d = Math.hypot(tx - pos.x, tz - pos.z);
    if (d > 2.6) this.walkTo(tx + this.offset.x * .8, tz + this.offset.z * .8, 1.5);
    const aimed = this.face(tx, BASE_Y + 2.5, tz, lerp(8, 22, this.s));
    if (aimed && this.eyeDist(tx, BASE_Y + 2.5, tz) < 4.4 && this.ready()) {
      this.click(holeX(best), BASE_Y + 2, holeZ(best), actions);
      this.wait(lerp(.6, .2, this.s));
    }
  }

  // ── Carnival Shootout ───────────────────────────────────────────────────

  /** Pitch that lands an arrow `dist` away and `rise` higher, fully drawn (3 b/tick). */
  private bowPitch(dist: number, rise: number): { pitch: number; ticks: number } {
    let best = { pitch: 0, ticks: 0, err: Infinity };
    for (let deg = -10; deg <= 25; deg += .25) {
      const a = deg * Math.PI / 180;
      let x = 0, y = -.1, vx = Math.cos(a) * 3, vy = Math.sin(a) * 3;
      x += Math.cos(a) * .3; y += Math.sin(a) * .3;
      let t = 0;
      while (x < dist && t < 60) { x += vx; y += vy; vx *= .99; vy *= .99; vy -= .05; t++; }
      const err = Math.abs(y - rise);
      if (err < best.err) best = { pitch: a, ticks: t, err };
    }
    return best;
  }
  private shootout(g: CarnivalShootout, actions: (() => void)[]): void {
    const p = this.match.sim.players.get(this.id)!;
    const b = this.body.pos;
    this.select(0, actions);
    type Aim = { x: number; y: number; z: number; key: string };
    let aim = this.mem.aim as Aim | undefined;
    const drawing = p.using !== null;
    const stillThere = (a: Aim) => a.key.startsWith('d') || g.targets.has(Number(a.key));
    if (!aim || !stillThere(aim)) {
      // Pick: gold first, never TNT on purpose, nearest to where we look.
      let bestScore = -Infinity, choice: Aim | undefined;
      for (const [k, tg] of g.targets) {
        if (tg.type === 'tnt' && this.rng() > (1 - this.s) * .05) continue;
        if ((tg.expires - g.t) / 20 < 1.6) continue;
        // A weaker bot takes whatever is near its aim; a stronger one hunts gold.
        const sc = (tg.type === 'gold_block' ? 3 : 1) * 3 * this.s - Math.abs(tg.x - b.x) * .15 + this.rng() * 3;
        if (sc > bestScore) { bestScore = sc; choice = { x: tg.x + .5, y: BASE_Y + tg.y + .5, z: SHOOT_WALL + 1, key: String(k) }; }
      }
      for (const d of g.ducks) {
        if (d[2] < 0 || this.s < .6) continue;
        const sc = (d[2] === 1 ? 5 : 2) * 2.4 * (this.s - .3) + this.rng() * 3 - 3;
        if (sc > bestScore) { bestScore = sc; choice = { x: d[0] + .5, y: BASE_Y + 2.5, z: DUCK_Z + .5, key: `d${d[0]}@${d[1]}` }; }
      }
      aim = choice;
      this.mem.aim = aim;
      this.mem.err = { yaw: (this.rng() - .5) * lerp(.17, .02, this.s), pitch: (this.rng() - .5) * lerp(.13, .016, this.s) };
      if (!aim) return;
    }
    // Ducks move a block every 5 ticks: lead by the flight time.
    let ax = aim.x;
    if (aim.key.startsWith('d')) {
      const [xs, dir] = aim.key.slice(1).split('@').map(Number);
      const duck = g.ducks.find((d) => d[2] >= 0 && d[1] === dir && Math.abs(d[0] - xs) <= 6);
      if (!duck) { this.mem.aim = undefined; return; }
      const dist = Math.hypot(duck[0] + .5 - b.x, DUCK_Z + .5 - b.z);
      ax = duck[0] + .5 + duck[1] * (dist / 3 + 4) / 5;
    }
    const dist = Math.hypot(ax - b.x, aim.z - b.z);
    const sol = this.bowPitch(dist, aim.y - (b.y + 1.62));
    const err = this.mem.err as { yaw: number; pitch: number };
    const yaw = Math.atan2(-(ax - b.x), -(aim.z - b.z)) + err.yaw;
    this.turn(yaw, sol.pitch + err.pitch, lerp(5, 14, this.s));
    const aimed = Math.abs(angleTo(this.body.yaw, yaw)) < .02 && Math.abs(this.pitch - sol.pitch - err.pitch) < .02;
    if (!drawing && this.ready()) {
      actions.push(() => this.act({ k: 'use', slot: 0, yaw: this.body.yaw, pitch: this.pitch }));
      this.mem.drawAt = this.time;
    } else if (drawing && aimed && this.time - ((this.mem.drawAt as number) ?? 0) >= 1.05) {
      actions.push(() => this.act({ k: 'useEnd', slot: 0, yaw: this.body.yaw, pitch: this.pitch }));
      this.mem.aim = undefined;
      this.wait(this.react(.6));
    }
  }

  // ── Memory Mosaic ───────────────────────────────────────────────────────

  private memory(g: MemoryMosaic, actions: (() => void)[]): void {
    const pad = g.padOf.get(this.id);
    if (pad === undefined || g.stage < 0 || g.stage >= SIZES.length) return;
    const size = SIZES[g.stage], colours = g.stage + 2;
    const key = `stage${g.stage}`;
    if (g.phase === 0 && !this.mem[key]) {
      // Memorise: a weaker memory muddles more cells, and bigger pictures are harder.
      const err = lerp(.32, .02, this.s) * (1 + g.stage * .45);
      this.mem[key] = g.target.map((row) => row.map((v) => this.rng() < err ? Math.floor(this.rng() * colours) : v));
      this.wait(this.react(1));
    }
    const plan = this.mem[key] as number[][] | undefined;
    const cx = padX(pad) + 2.5, cz = padZ(pad) + 2.5;
    this.walkTo(cx, cz, .6);
    if (g.phase !== 1 || !plan || g.submitted.has(this.id) || !this.ready()) return;
    const answer = g.answers.get(this.id)!;
    for (let x = 0; x < size; x++) for (let z = 0; z < size; z++) {
      const want = plan[x][z], have = answer[x][z];
      if (want === have) continue;
      const wx = padX(pad) + x, wz = padZ(pad) + z;
      if (!this.face(wx + .5, BASE_Y + 1, wz + .5, lerp(10, 26, this.s))) return;
      // Forward (right-click) or back (left-click), whichever is fewer clicks.
      const fwd = ((want - have) % (colours + 1) + colours + 1) % (colours + 1);
      if (fwd <= colours + 1 - fwd) this.useOn(wx, BASE_Y, wz, 0, 1, 0, 1, this.body.yaw, actions);
      else this.click(wx, BASE_Y, wz, actions);
      this.wait(lerp(.55, .16, this.s) * (.8 + this.rng() * .4));
      return;
    }
    const sx = padX(pad) + 2, sz = padZ(pad) + PAD;
    if (!this.face(sx + .5, BASE_Y + 1, sz + .5, lerp(10, 26, this.s))) return;
    this.click(sx, BASE_Y, sz, actions);
    this.wait(1);
  }

  // ── Brain Rush ──────────────────────────────────────────────────────────

  private brain(g: BrainRush): void {
    if (!g.current) return;
    const key = `q${g.number}`;
    let choice = this.mem[key] as number | undefined;
    const level = Math.min(3, Math.floor((g.number - 1) / 3));
    if (g.phase === 0 && choice === undefined) {
      if (!this.mem[`${key}t`]) this.mem[`${key}t`] = this.time + lerp(4.2, 1.1, this.s) * (1 + level * .25) * (.7 + this.rng() * .6);
      if (this.time >= (this.mem[`${key}t`] as number)) {
        const right = this.rng() < clamp(lerp(.42, .97, this.s) - level * .06, .3, .98);
        choice = right ? g.current.answer : [0, 1, 2, 3].filter((i) => i !== g.current!.answer)[Math.floor(this.rng() * 3)];
        this.mem[key] = choice;
      }
    }
    if (choice === undefined || g.phase !== 0) return;
    const [cx, cz] = CENTRES[choice];
    this.walkTo(cx + .5 + this.offset.x, cz + .5 + this.offset.z, .5);
  }


  private treasure(g: TreasureCove, actions: (() => void)[]): void {
    const b = this.body.pos;
    this.select(0, actions);
    const fx = Math.floor(b.x), fz = Math.floor(b.z), fy = Math.floor(b.y + .01) - BASE_Y;
    const get = (x: number, y: number, z: number) => this.match.host.getBlock(x, BASE_Y + y, z);
    // In a hole: dig a step out toward the middle of the field.
    if (fy < 1 && this.body.onGround) {
      const dir = Math.abs(b.x) > Math.abs(b.z) ? [-Math.sign(b.x) || 1, 0] : [0, -Math.sign(b.z) || 1];
      const sx = fx + dir[0], sz = fz + dir[1];
      for (const yy of [fy + 1, fy + 2]) if (yy <= 0 && get(sx, yy, sz) !== 0) {
        if (!this.face(sx + .5, BASE_Y + yy + .5, sz + .5, 30)) return;
        actions.push(() => this.act({ k: 'dig', x: sx, y: BASE_Y + yy, z: sz }));
        return;
      }
      this.turn(Math.atan2(-dir[0], -dir[1]), 0, 30);
      this.input.forward = true; this.input.jump = true;
      return;
    }
    // Dig the column we picked, top down, from wherever it is in reach.
    let col = this.mem.col as { x: number; z: number; at: number } | undefined;
    // What a player reads in the action bar: Scorching / Hot / Warm / Cold.
    const reading = g.nearest(b.x, b.y, b.z);
    const band = reading < 2 ? 0 : reading < 3.5 ? 1 : reading < 6 ? 2 : 3;
    if (col && (get(col.x, -DEPTH + 1, col.z) === 0 || this.time - col.at > 6)) col = undefined;
    if (!col && this.ready()) {
      // Hot: search right here. Cold: move on, away from where it was cold.
      const radius = [1, 2, 3, 6][band] + (1 - this.s) * 1.5;
      const memo = (this.mem.cold ??= []) as { x: number; z: number }[];
      if (band === 3) { memo.push({ x: b.x, z: b.z }); if (memo.length > 6) memo.shift(); }
      let best: { x: number; z: number } | null = null, bestScore = Infinity;
      for (let i = 0; i < 16; i++) {
        const x = clamp(fx + Math.round((this.rng() - .5) * 2 * radius), -HALF, HALF - 1);
        const z = clamp(fz + Math.round((this.rng() - .5) * 2 * radius), -HALF, HALF - 1);
        if ((x === fx && z === fz) || get(x, -DEPTH + 1, z) === 0) continue;
        // A better bot keeps clear of places that read cold and of dug-out ground.
        let score = this.rng() * 2 + Math.hypot(x - b.x, z - b.z) * .15;
        if (this.s > .4) for (const c of memo) score += Math.max(0, 5 - Math.hypot(x - c.x, z - c.z)) * this.s * .6;
        if (get(x, 0, z) === 0) score += 1;
        if (score < bestScore) { bestScore = score; best = { x, z }; }
      }
      if (best) { col = { ...best, at: this.time }; this.mem.col = col; }
      this.wait(this.react(.45));
    }
    if (!col) return;
    const cx = col.x + .5, cz = col.z + .5;
    let target: number | null = null;
    for (let y = 0; y > -DEPTH; y--) if (get(col.x, y, col.z) !== 0) { target = y; break; }
    if (target === null) { this.mem.col = undefined; return; }
    if (this.eyeDist(cx, BASE_Y + target + .5, cz) > 4.6 || (Math.floor(b.x) === col.x && Math.floor(b.z) === col.z)) {
      const away = Math.hypot(b.x - cx, b.z - cz) || 1;
      if (!this.walkTo(cx + (b.x - cx) / away * 1.4, cz + (b.z - cz) / away * 1.4, .5, true) && this.blocked) this.mem.col = undefined;
      return;
    }
    if (!this.face(cx, BASE_Y + target + .5, cz, lerp(10, 24, this.s)) || !this.ready()) return;
    const ty = target;
    actions.push(() => this.act({ k: 'dig', x: col!.x, y: BASE_Y + ty, z: col!.z }));
    this.wait(lerp(.35, .12, this.s));
  }
  private musical(g: MusicalMinecarts, actions: (()=>void)[]): void {
    if(g.seats.has(this.id)) return;
    if(g.stage!=='scramble') {
      const a=this.time*.28+this.id*1.7;this.walkTo(Math.cos(a)*10+.5,Math.sin(a)*10+.5,1);return;
    }
    if(this.mem.round!==g.round) {this.mem.round=g.round;this.mem.notice=this.time+this.react(1.3);}
    if(this.time<(this.mem.notice as number)) return;
    const p=this.body.pos;
    const carts=g.carts.filter(c=>c.data.rider===undefined).sort((a,b)=>Math.hypot(a.x-p.x,a.z-p.z)-Math.hypot(b.x-p.x,b.z-p.z));
    const c=carts[0];if(!c)return;
    this.walkTo(c.x,c.z,1.2);
    if(Math.hypot(c.x-p.x,c.z-p.z)<3.2&&this.ready()) {actions.push(()=>this.act({k:'use',slot:0,ent:c.id,yaw:this.body.yaw,pitch:0}));this.wait(this.react(.5));}
  }
  private disco(g: DiscoDash): void {
    if(this.mem.call!==g.call){this.mem.call=g.call;this.mem.notice=this.time+this.react(1);this.mem.tile=undefined;}
    if(this.time<(this.mem.notice as number))return;
    const p=this.body.pos;
    let tile=this.mem.tile as {x:number;z:number}|undefined;
    if(!tile){let best=Infinity;for(let x=0;x<12;x++)for(let z=0;z<12;z++)if(g.safe.has(g.grid[x][z])) {
      const tx=-12+x*2+1,tz=-12+z*2+1,d=Math.hypot(tx-p.x,tz-p.z)+this.rng()*(1-this.s)*4;
      if(d<best){best=d;tile={x:tx,z:tz};}
    }this.mem.tile=tile;}
    if(tile)this.walkTo(tile.x,tile.z,.25);
  }
  private survive(g: AnvilPanic|TntRun|GlacierSpleef|BowSpleef, actions: (()=>void)[]): void {
    const p=this.body.pos, y=Math.floor(p.y-.1)-BASE_Y;
    let goal=this.mem.goal as {x:number;z:number}|undefined;
    const danger=(x:number,z:number)=>g instanceof AnvilPanic && (g.strikes.some(s=>Math.abs(s.x+.5-x)<1&&Math.abs(s.z+.5-z)<1)||g.falling.some(e=>Math.abs(e.x-x)<1&&Math.abs(e.z-z)<1));
    const safe=(x:number,z:number)=>!!BLOCKS[g.get(Math.floor(x),y,Math.floor(z))]?.solid&&!danger(x,z);
    if(this.time>Number(this.mem.replan??0)||!goal||!safe(goal.x,goal.z)||Math.hypot(goal.x-p.x,goal.z-p.z)<.7){
      this.mem.replan=this.time+this.react(.8);let best=-Infinity;
      const radius=g instanceof AnvilPanic?10:g instanceof BowSpleef?g.burnRadius-1:g instanceof GlacierSpleef?g.thawRadius-1:g.collapseRadius-1;
      for(let i=0;i<40;i++){
        const a=this.rng()*Math.PI*2,r=this.rng()*Math.max(1,radius),x=Math.cos(a)*r+.5,z=Math.sin(a)*r+.5;
        if(!safe(x,z))continue;
        // Reject paths over holes, rather than seeing only the destination.
        let clear=true;const d=Math.hypot(x-p.x,z-p.z),steps=Math.ceil(d*2);
        for(let j=1;j<=steps;j++){const t=j/steps;if(!safe(p.x+(x-p.x)*t,p.z+(z-p.z)*t)){clear=false;break;}}
        const score=(clear?12:0)-d*.7+this.rng()*(1-this.s)*4-(g instanceof TntRun?0:Math.hypot(x,z)*.15);
        if(score>best){best=score;goal={x,z};}
      }
      this.mem.goal=goal;
    }
    if(goal){this.walkTo(goal.x,goal.z,.25,true);if(this.blocked&&g instanceof TntRun)this.input.jump=this.body.onGround;}
    if(g instanceof TntRun){
      this.input.sprintKey=false;
      if(this.body.vel.y< -3&&g.doubleJumps(this.id)>0&&this.ready()){actions.push(()=>this.act({k:'jump2'}));this.wait(.7);}
    }
    const enemy=g.players().filter(id=>id!==this.id).map(id=>this.match.host.body(id)!).filter(b=>Math.abs(b.y-p.y)<2).sort((a,b)=>Math.hypot(a.x-p.x,a.z-p.z)-Math.hypot(b.x-p.x,b.z-p.z))[0];
    if(g instanceof GlacierSpleef&&enemy&&this.ready()){
      const x=Math.floor(enemy.x),z=Math.floor(enemy.z),fy=Math.floor(enemy.y-.05)-BASE_Y;
      if(g.isFloor(x,fy,z)&&this.eyeDist(x+.5,BASE_Y+fy+.5,z+.5)<5.4){this.face(x+.5,BASE_Y+fy+.5,z+.5);this.click(x,BASE_Y+fy,z,actions);this.wait(lerp(.8,.2,this.s));}
    }
    if(g instanceof BowSpleef&&enemy){
      const vp=this.match.sim.players.get(this.id)!;
      this.face(enemy.x,enemy.y-.5,enemy.z);
      if(!vp.using&&this.ready()){actions.push(()=>this.act({k:'use',slot:0,yaw:this.body.yaw,pitch:this.pitch}));this.mem.drawAt=this.time;}
      else if(vp.using&&this.time-Number(this.mem.drawAt??0)>.65){actions.push(()=>this.act({k:'useEnd',slot:0,yaw:this.body.yaw,pitch:this.pitch}));this.wait(lerp(1.2,.3,this.s));}
    }
  }

  private redLight(g:RedLight):void {
    if(this.mem.red!==g.red){this.mem.red=g.red;this.mem.notice=this.time+this.react(g.red?.7:1.1);}
    if(g.red&&this.time>=Number(this.mem.notice))return;
    if(!g.red&&this.time<Number(this.mem.notice))return;
    this.walkTo(this.offset.x*2,-30,.4);this.input.sprintKey=true;
  }
  private maze(g:HedgeMaze,actions:(()=>void)[]):void {
    const b=this.body.pos,cx=clamp(Math.floor((b.x+22)/4),0,10),cz=clamp(Math.floor((b.z+22)/4),0,10),mine=g.found.get(this.id)!;
    let route=this.mem.route as number[][]|undefined;
    const targetKey=[...g.keys.keys()].find(i=>!mine.has(i))??3;
    if(!route||this.mem.targetKey!==targetKey||this.blocked){
      this.mem.targetKey=targetKey;const goal=targetKey===3?[5,5]:g.keys[targetKey],queue=[[cx,cz]],came=new Map<string,number[]|null>([[`${cx},${cz}`,null]]);
      for(let i=0;i<queue.length;i++){const c=queue[i];if(c[0]===goal[0]&&c[1]===goal[1])break;for(const n of g.neighbours(c[0],c[1]))if(!came.has(n.join(','))){came.set(n.join(','),c);queue.push(n);}}
      route=[];let at:number[]|null=goal;while(at&&at.join(',')!==`${cx},${cz}`){route.unshift(at);at=came.get(at.join(','))??null;}this.mem.route=route;
    }
    if(b.z>22){this.walkTo(.5,mazeCell(10)+.5,.4);return;}
    if(this.time-this.stuckAt>1){this.mem.route=undefined;this.walkTo(mazeCell(cx)+.5,mazeCell(cz)+.5,.25);return;}
    const target=route[0];if(target){
      const tx=mazeCell(target[0])+.5,tz=mazeCell(target[1])+.5;
      if(Math.hypot(tx-b.x,tz-b.z)<.45){route.shift();this.mem.nav=undefined;}
      else {
        const key=target.join(',');let nav=this.mem.nav as [number,number,number][]|undefined;
        if(!nav?.length||this.mem.navKey!==key){nav=findPath(this.match.host.getBlock,Math.floor(b.x),BASE_Y+1,Math.floor(b.z),Math.floor(tx),BASE_Y+1,Math.floor(tz),2,1400)??[];this.mem.nav=nav;this.mem.navKey=key;}
        while(nav.length&&Math.hypot(nav[0][0]-b.x,nav[0][2]-b.z)<.35)nav.shift();
        const point=nav[0];if(point)this.walkTo(point[0],point[2],.25);else this.walkTo(tx,tz,.3);
      }
    }
    if(this.body.inWater)this.input.jump=true;
    const mob=g.mobs.find(e=>!e.dead&&Math.hypot(e.x-b.x,e.z-b.z)<3.1);
    if(mob&&this.ready()){this.face(mob.x,mob.y+1,mob.z);actions.push(()=>this.act({k:'attack',ent:mob.id}));this.wait(lerp(1,.6,this.s));}
  }
  private parkour(g:ParkourRace):void {
    const b=this.body,p=b.pos,stop=g.reached.get(this.id)??0;
    if(stop>=g.stops.length-1)return;
    const currentStop=g.stops[stop],nextStop=g.stops[stop+1],model=g instanceof LunarLeap?JumpModel.MOON:JumpModel.NORMAL;
    const stopPad=(s:typeof currentStop)=>{const h=Math.max(0,Math.floor(s.r/Math.SQRT2-.2));return new Pad(s.x-h,s.y,s.z-h,h*2+1,h*2+1);};
    let route=this.mem.route as Pad[]|undefined;
    if(!route||this.mem.stop!==stop||Math.hypot(p.x-Number(this.mem.lastX??p.x),p.z-Number(this.mem.lastZ??p.z))>5){
      this.mem.stop=stop;
      const nodes=[stopPad(currentStop),...(g.legs[stop]??[]),stopPad(nextStop)],goal=nodes.length-1,queue=[0],came=new Map<number,number>([[0,-1]]);
      for(let q=0;q<queue.length&&!came.has(goal);q++)for(let j=1;j<nodes.length;j++)if(!came.has(j)&&model.possible(nodes[queue[q]],nodes[j],g instanceof LunarLeap?.74:.68)){came.set(j,queue[q]);queue.push(j);}
      route=[];if(came.has(goal)){let j=goal;while(j>0){route.unshift(nodes[j]);j=came.get(j)!;}}this.mem.route=route;
    }
    this.mem.lastX=p.x;this.mem.lastZ=p.z;
    let target=route[0];if(!target)return;
    if(b.onGround&&Math.abs(p.y-BASE_Y-target.y-1)<.3&&p.x>=target.x-.25&&p.x<target.x+target.w+.25&&p.z>=target.z-.25&&p.z<target.z+target.d+.25){route.shift();target=route[0];if(!target){this.walkTo(nextStop.x+.5,nextStop.z+.5,.3);return;}}
    const i=g.pads.indexOf(target);
    if(g instanceof NeonBlink&&i>=0&&neonState(g.colours[i],g.t+12)===2&&b.onGround)return;
    this.jumpToward(target,model===JumpModel.MOON);
  }
  private jumpToward(target:Pad,moon=false):void {
    const b=this.body,p=b.pos,tx=target.cx(),tz=target.cz(),d=Math.hypot(tx-p.x,tz-p.z);
    this.walkTo(tx,tz,.15);this.input.sprintKey=true;
    if(b.onGround){
      const ux=(tx-p.x)/(d||1),uz=(tz-p.z)/(d||1),get=this.match.host.getBlock;
      let edge=.2;
      while(edge<4&&BLOCKS[get(Math.floor(p.x+ux*edge),Math.floor(p.y-.1),Math.floor(p.z+uz*edge))]?.solid)edge+=.2;
      // Run up to the lip, then take off facing the landing pad.
      if(edge<.35&&Math.abs(angleTo(b.yaw,Math.atan2(-(tx-p.x),-(tz-p.z))))<.2)this.input.jump=true;
    }else if(d<(moon?1.2:.6)){
      this.input.forward=false;this.input.sprintKey=false;
      // Ordinary countersteering is needed to settle on a small landing pad.
      const forward=b.vel.x*(-Math.sin(b.yaw))+b.vel.z*(-Math.cos(b.yaw));
      if(forward>1.3)this.input.back=true;
    }
  }
  private lava(g:LavaClimb):void {
    const b=this.body,p=b.pos;
    const route=g.layout.routes[this.id%3];let i=Number(this.mem.pad??0);
    // Find the furthest pad reached physically; never award progress to a bot.
    for(let j=i;j<route.length;j++){const pad=route[j];if(Math.abs(p.y-BASE_Y-pad.y-1)<.35&&pad.covers(Math.floor(p.x),Math.floor(p.z))&&b.onGround)i=j+1;}
    this.mem.pad=i;
    const target=route[i];if(!target){this.jumpToward(new Pad(-3,44,-3,7,7));return;}
    if(i>0&&route[i-1].ladderFoot&&target.y>route[i-1].y){
      const foot=route[i-1];this.walkTo(foot.cx(),foot.cz(),.08);this.input.jump=true;this.input.forward=true;return;
    }
    this.jumpToward(target);
  }

  private navigate(x:number,y:number,z:number):void{
    const p=this.body.pos,key=`${Math.floor(x)},${Math.floor(y)},${Math.floor(z)}`;
    let path=this.mem.nav as [number,number,number][]|undefined;
    if(this.mem.navKey!==key||!path?.length||this.time>Number(this.mem.navAt??0)){
      this.mem.navKey=key;this.mem.navAt=this.time+1.5;
      path=findPath(this.match.host.getBlock,Math.floor(p.x),Math.floor(p.y+.01),Math.floor(p.z),Math.floor(x),Math.floor(y),Math.floor(z),2,1400,true)??[];this.mem.nav=path;
    }
    while(path.length&&Math.hypot(path[0][0]-p.x,path[0][2]-p.z)<.35&&Math.abs(path[0][1]-p.y)<.5)path.shift();
    const q=path[0];if(q){this.walkTo(q[0],q[2],.15);if(q[1]>p.y+.4)this.input.jump=true;}else this.walkTo(x,z,.3);
    if(this.body.inWater)this.input.jump=true;
  }
  private hill(g:KingOfTheHill,actions:(()=>void)[]):void{
    const p=this.body.pos;
    if(p.y<BASE_Y+3)this.mem.hillClimb=false;
    if(this.body.onGround&&p.y>BASE_Y+5)this.mem.hillClimb=true;
    if(this.mem.hillClimb){
      this.navigate(.5,BASE_Y+11,.5);
    }else if(p.y<BASE_Y+10&&Math.hypot(p.x,p.z)>5&&!this.mem.hillAir){
      const x=p.x<0?-14.5:14.5,z=p.z<0?-14.5:14.5;
      this.walkTo(x,z,.1);
      if(this.body.vel.y>15)this.mem.hillAir=true;
    }else{
      this.walkTo(.5,.5,.35);
      if(this.body.onGround&&p.y<BASE_Y+10)this.mem.hillAir=false;
    }
    const victim=g.players().filter(id=>id!==this.id).map(id=>({id,b:this.match.host.body(id)!})).find(v=>Math.hypot(v.b.x-p.x,v.b.y-p.y,v.b.z-p.z)<3.2);
    if(victim&&this.ready()){this.face(victim.b.x,victim.b.y+1,victim.b.z);actions.push(()=>this.act({k:'attack',target:victim.id}));this.wait(lerp(1.2,.55,this.s));}
  }
  private sheep(g:SheepHerd,actions:(()=>void)[]):void{
    const p=this.body.pos,held=g.leading(this.id),pen=g.penOf.get(this.id)!;
    if(held.length>=2||held.length&&Number(this.mem.sheepWait??0)<this.time){
      const c=penCentre(pen),f=step(towardCentre(pen)),outside={x:c[0]+f[0]*5+.5,z:c[1]+f[2]*5+.5};
      const inside=Math.abs(p.x-c[0]-.5)<2.4&&Math.abs(p.z-c[1]-.5)<2.4;
      const atGate=Math.hypot(p.x-outside.x,p.z-outside.z)<.8;
      if(!this.mem.entered&&atGate)this.mem.entered=true;
      if(this.mem.entered||inside)this.walkTo(c[0]+.5,c[1]+.5,.3);else this.walkTo(outside.x,outside.z,.4);
      this.input.sprintKey=false;
      if(held.some(e=>Math.hypot(e.x-p.x,e.z-p.z)>5.5)){this.input.forward=false;this.input.back=false;}
      return;
    }
    if(!held.length)this.mem.entered=false;
    let target=g.flock.filter(e=>!e.dead&&e.data.leash===undefined&&g.parked.get(e.id)!==pen).sort((a,b)=>Math.hypot(a.x-p.x,a.z-p.z)-(a.data.color===0xf3c653?8*this.s:0)-Math.hypot(b.x-p.x,b.z-p.z)+(b.data.color===0xf3c653?8*this.s:0))[0];
    if(!target)return;this.walkTo(target.x,target.z,2);this.input.sprintKey=held.length===0&&this.input.sprintKey;
    if(Math.hypot(target.x-p.x,target.z-p.z)<3.5&&this.ready()){const ent=target.id;actions.push(()=>this.act({k:'use',slot:0,ent,yaw:this.body.yaw,pitch:0}));this.mem.sheepWait=this.time+this.react(6);this.wait(this.react(.7));}
  }
  private rooftop(g:RooftopTag,actions:(()=>void)[]):void{
    const p=this.body.pos;
    if(g.it.has(this.id)){
      const target=g.players().filter(id=>!g.it.has(id)).map(id=>({id,b:this.match.host.body(id)!})).sort((a,b)=>Math.hypot(a.b.x-p.x,a.b.z-p.z)-Math.hypot(b.b.x-p.x,b.b.z-p.z))[0];
      if(!target)return;this.navigate(target.b.x,target.b.y,target.b.z);
      if(Math.hypot(target.b.x-p.x,target.b.y-p.y,target.b.z-p.z)<3.3&&this.ready()){actions.push(()=>this.act({k:'attack',target:target.id}));this.wait(lerp(1,.5,this.s));}
    }else{
      if(this.time>Number(this.mem.runAt??0)){this.mem.runAt=this.time+3;const tagger=[...g.it].map(id=>this.match.host.body(id)!).find(Boolean);const houses=g.town.houses.filter(h=>h.h>0);houses.sort((a,b)=>{const value=(h:typeof a)=>Math.hypot(h.cx()-(tagger?.x??0),h.cz()-(tagger?.z??0))-.3*Math.hypot(h.cx()-p.x,h.cz()-p.z);return value(b)-value(a);});this.mem.house=houses[0];}
      const h=this.mem.house as (typeof g.town.houses)[0]|undefined;if(h)this.navigate(h.cx(),BASE_Y+h.h+1,h.cz());
    }
  }
  private canopy(g:CoinCanopy):void{
    const p=this.body.pos;
    let coin=g.coins.find(c=>c.entity.id===this.mem.coin);
    if(!coin||this.time>Number(this.mem.coinAt??0)){
      this.mem.coinAt=this.time+4;
      coin=g.coins.slice().sort((a,b)=>{const value=(c:typeof a)=>c.value*6-Math.hypot(c.spot.x-p.x,c.spot.z-p.z)-Math.abs(BASE_Y+c.spot.y-p.y)*lerp(4,1,this.s);return value(b)-value(a);})[0];this.mem.coin=coin?.entity.id;
    }
    if(coin)this.navigate(coin.spot.x,BASE_Y+coin.spot.y,coin.spot.z);
  }
  private boatRace(g:BoatRush):void{
    const boat=this.body.boat;if(!boat)return;
    const nearest=g.circuit.nearest(boat.x,boat.z)[0];if(nearest<0)return;
    const speed=Math.hypot(boat.vx,boat.vz)*20,look=Math.max(5,Math.min(18,5+speed*.4)),line=g.circuit.line;
    const target=line[(nearest+Math.round(look*2))%line.length],yaw=Math.atan2(-(target[0]-boat.x),-(target[1]-boat.z)),error=angleTo(boat.yaw,yaw),spin=boat.spin;
    const control=error-spin*6;
    this.input.left=control>.025;this.input.right=control<-.025;
    const ahead=line[(nearest+50)%line.length],bend=Math.abs(angleTo(yaw,Math.atan2(-(ahead[0]-target[0]),-(ahead[1]-target[1]))));
    const desired=lerp(9,18,this.s)/(1+bend*2);
    this.input.forward=speed<desired&&Math.abs(error)<1.2;this.input.back=speed>desired+1.5;
  }
  private glideRace(g:ElytraRally,actions:(()=>void)[]):void{
    const i=g.nextRing.get(this.id)??0,r=g.course.rings[Math.min(i,g.course.rings.length-1)],p=this.body.pos;
    const dx=r.x-p.x,dy=BASE_Y+r.y+.5-p.y,dz=r.z-p.z,d=Math.hypot(dx,dz),side=(p.x-r.x)*r.nx+(p.y-BASE_Y-r.y-.9)*r.ny+(p.z-r.z)*r.nz;
    // Aim through the current ring; a missed plane must be approached again from behind.
    let tx=r.x+r.nx*8,tz=r.z+r.nz*8;
    if(side>1){tx=r.x-r.nx*12;tz=r.z-r.nz*12;}
    const yaw=Math.atan2(-(tx-p.x),-(tz-p.z)),pitch=clamp(Math.atan2(dy,d)*.7+.05,-.45,.45);
    this.turn(yaw,pitch,lerp(2.5,5,this.s));
    if(!this.body.gliding&&p.y>BASE_Y+10&&this.ready()){actions.push(()=>this.act({k:'glide',on:true}));this.wait(.4);}
    if(this.body.gliding&&this.ready()){
      const vp=this.match.sim.players.get(this.id)!,rocket=vp.inv.slots[0];
      if(rocket?.id===VI.firework_rocket&&(this.body.vel.length()<17||dy>2)&&Math.abs(angleTo(this.body.yaw,yaw))<.35){actions.push(()=>{this.act({k:'select',slot:0});this.act({k:'use',slot:0,yaw:this.body.yaw,pitch:this.pitch});this.body.boostTicks=25;});this.wait(lerp(2,1,this.s));}
    }
  }

}
