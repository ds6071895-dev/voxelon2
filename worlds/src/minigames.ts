// Party Games: the match engine, ported from the plugin's PartyGamesGame. A
// free-for-all of short mini-games (3 by default) ending on a podium. Each
// mini-game reports placements; placements become points (10, 8, 6, 5, 4, 3,
// 2, 1 stretched to the field), the last game is worth double, and the most
// points wins. Every mini-game is its own arena world: the match swaps
// worlds between games. Nobody ever takes health damage.

import { registerMode, type EngineSetup, type ModeEngine, type ModeHost } from './net/mode_engine';
import { Sim, type SimRules } from './vanilla/sim';
import { VITEM } from './vanilla/items';
import { ARMOR0 } from './vanilla/inventory_model';
import type { MAction } from './vanilla/messages';
import { mulberry32 } from './noise';
import {
  MG, MG_CATEGORIES, MG_PODIUM_INDEX, award, fmt, mgGame, mgIndex, mgPlayable, mgPool, ordinal, pick, remember,
  type MgCategory, type MinigamesSetup,
} from './minigames_rules';
import type { MgBoard, MgPhase, MgResultRow, MgStanding, MinigamesState } from './minigames_state';
import { createGame, worldSeed, unseed } from './minigames/arenas';
import { PODIUM_TIME, PODIUM_VIEW, podiumCrowd, podiumStep } from './minigames/podium';
import type { MgCtx, Minigame, Spot } from './minigames/game';
import { ARENA_BOX, BASE_Y } from './minigames/arena';
import { MgBot } from './minigames_bot';

const STEP = 0.05;
const REACH = 6;
/** Every host's recently played games (source PartySettings.recent), per party leader or the queue. */
const RECENT = new Map<string, string[]>();
/** Lineups decided by `world()` before the engine exists, by match seed. */
const PLANNED = new Map<number, string[]>();

/** Which games a match plays: the host's playlist in order, or a random mix from the selection bag. */
export function planLineup(setup: EngineSetup, recentKey: string): string[] {
  const o = setup.options as MinigamesSetup | undefined;
  if (o?.playlist?.games.length) {
    const ids = o.playlist.games.filter(mgPlayable);
    if (ids.length) return ids;
  }
  const rng = mulberry32(setup.seed ^ 0x6a17);
  const pool = mgPool().map((g) => ({ id: g.id, category: g.category }));
  const recent = RECENT.get(recentKey) ?? [];
  const length = o?.length ?? 3;
  let picked = pick(pool, length, recent, new Set(o?.banned ?? []), rng);
  // Every game switched off: play a random mix rather than nothing.
  if (!picked.length) picked = pick(pool, length, recent, new Set(), rng);
  remember(recent, picked);
  RECENT.set(recentKey, recent);
  return picked.map((e) => e.id);
}
function lineupFor(setup: EngineSetup): string[] {
  let l = PLANNED.get(setup.seed);
  if (!l) { l = planLineup(setup, setup.leader === null ? 'queue' : `leader:${setup.leader}`); PLANNED.set(setup.seed, l); }
  return l;
}

export class MinigamesMatch implements ModeEngine {
  readonly mode = 'minigames' as const;
  world: { kind: 'minigames'; seed: number };
  readonly sim: Sim;
  readonly rng: () => number;
  phase: MgPhase = 'brief';
  private phaseTicks = 0;
  private roundLimit = 0;
  ticks = 0;
  readonly roster = new Map<number, string>();
  readonly totals = new Map<number, number>();
  readonly roundWins = new Map<number, number>();
  private readonly lastPlace = new Map<number, number>();
  private readonly categoryPoints = new Map<number, Partial<Record<MgCategory, number>>>();
  private readonly tieSeed: number;
  readonly lineup: string[];
  index = 0;
  completedRounds = 0;
  current: Minigame | null = null;
  private roundStarted = false;
  private spawns = new Map<number, Spot>();
  private results: MinigamesState['results'] = null;
  private podium: MinigamesState['podium'] = null;
  private board: MgBoard | null = null;
  private over = false;
  private acc = 0;
  private timers: { at: number; fn: () => void }[] = [];
  /** Per player: the block their left button is on, and whether the game took the click. */
  private digKey = new Map<number, string>();
  private digTaken = new Map<number, boolean>();
  readonly bots: MgBot[] = [];
  readonly leader: number | null;
  readonly matchSeed: number;
  readonly ctx: MgCtx;

  constructor(readonly host: ModeHost, setup: EngineSetup) {
    this.matchSeed = setup.seed;
    this.rng = mulberry32(setup.seed ^ 0x9a27);
    this.leader = setup.leader;
    this.tieSeed = Math.floor(this.rng() * 0x7fffffff);
    this.lineup = lineupFor(setup);
    PLANNED.delete(setup.seed);
    this.host = { ...host,
      impulse: (id,x,y,z,by,hp) => {this.bots.find(b=>b.id===id)?.knockback(x,y,z);host.impulse(id,x,y,z,by,hp);},
      launch: (id,x,y,z,add) => {this.bots.find(b=>b.id===id)?.setVelocity(x,y,z,add);host.launch(id,x,y,z,add);},
    };
    this.sim = new Sim(this.host, this.rules(), this.rng);
    this.ctx = this.makeCtx();
    for (const pl of setup.players) {
      this.roster.set(pl.id, host.name(pl.id));
      this.totals.set(pl.id, 0);
      this.roundWins.set(pl.id, 0);
      const vp = this.sim.addPlayer(pl.id, pl.bot);
      vp.godmode = true;
      vp.hunger.food = 20; vp.hunger.saturation = 20;
      if (pl.bot) this.bots.push(new MgBot(this, pl.id, pl.skill, mulberry32(setup.seed ^ pl.id ^ 0x5b0)));
    }
    this.world = { kind: 'minigames', seed: roundSeed(setup.seed,0,this.lineup[0]) };
    this.current = createGame(this.lineup[0],unseed(this.world.seed).course);
    this.placeSpawns();
    this.beginBrief();
  }

  private rules(): SimRules {
    const g = () => (this.phase === 'round' ? this.current : null);
    return {
      pvp: false, hunger: false, naturalRegen: false, fallDamage: false, blockDrops: false, explosionsBreak: false, fluidsFlow: false,
      canBreak: (id, x, y, z, block) => !!g()?.alive.has(id) && g()!.canBreak(id, x, y, z, block),
      canPlace: (id, x, y, z, block) => id >= 0 && !!g()?.alive.has(id) && g()!.canPlace(id, x, y, z, block),
      blockedUse: (_item, stack, id) => id === undefined || !(g()?.alive.has(id) && g()!.canUse(id, stack)),
      onLethal: () => { /* nobody takes damage in Party Games */ },
      isTargetable: () => false,
      doubleJumps: (id) => g()?.doubleJumps(id) ?? 0,
      onProjectile: (e, target) => { const handled = g()?.onProjectile(e, target) ?? false; g()?.flush(); return handled; },
      onArrowBlock: (e, x, y, z) => { const r = g()?.onArrowBlock(e, x, y, z) ?? true; g()?.flush(); return r; },
      onBroken: (id, x, y, z, block) => { g()?.onBroken(id, x, y, z, block); g()?.flush(); },
      onPlaced: (id, slot, edits) => { g()?.onPlaced(id, slot, edits); g()?.flush(); },
    };
  }

  private makeCtx(): MgCtx {
    const m = this;
    return {
      host: m.host, sim: m.sim, rng: m.rng,
      name: (id) => m.roster.get(id) ?? m.host.name(id),
      isBot: (id) => !!m.host.body(id)?.bot,
      later: (ticks, fn) => m.timers.push({ at: m.ticks + ticks, fn }),
      bar: (id, text, color) => m.host.send(id, { k: 'bar', text, color }),
      title: (id, title, sub, color, ms = 1500) => {
        const d = { k: 'title' as const, title, sub, color, ms };
        if (id === null) m.host.broadcast(d); else m.host.send(id, d);
      },
      feed: (text, tone) => m.host.broadcast({ k: 'feed', text, tone }),
      sound: (s, at, pitch) => m.sim.sound(s, at?.x, at?.y, at?.z, pitch),
      setBoard: (b) => { m.board = b; m.publish(); },
      raceGrace: () => m.raceGrace(),
    };
  }

  // ── ModeEngine ───────────────────────────────────────────────────────────

  spawnOf(id: number) { return this.spawns.get(id) ?? { x: .5, y: BASE_Y + 1, z: .5, yaw: 0 }; }
  bounds() {
    const b = this.current?.arena.bounds ?? ARENA_BOX;
    return { minX: b.minX, maxX: b.maxX + 1, minY: BASE_Y + b.minY - 30, maxY: BASE_Y + b.maxY + 20, minZ: b.minZ, maxZ: b.maxZ + 1 };
  }
  ready(id: number): void {
    const p = this.sim.players.get(id);
    if (p) { p.invDirty = true; p.selfKey = ''; }
    this.sim.entitySnapshot(id);
    this.publish();
    if (this.current && this.phase === 'round') this.current.flush();
  }
  leave(id: number): void {
    if (!this.roster.has(id)) return;
    if (this.current && this.phase !== 'podium' && this.roundStarted) this.current.quit(id);
    this.roster.delete(id);
    this.totals.delete(id);
    this.sim.players.delete(id);
    const i = this.bots.findIndex((b) => b.id === id);
    if (i >= 0) this.bots.splice(i, 1);
    if (this.over) return;
    this.host.broadcast({ k: 'feed', text: `${this.host.name(id)} left Party Games.`, tone: 'info' });
    const humans = [...this.roster.keys()].filter((p) => !this.host.body(p)?.bot);
    if (!humans.length || this.roster.size < MG.MIN_PLAYERS) {
      if (this.phase !== 'podium') this.goPodium();
    }
  }
  handle(id: number, a: MAction): void {
    if (!a || typeof a !== 'object') return;
    if (a.k === 'select' || a.k === 'click' || a.k === 'closeWin' || a.k === 'swapHands' || a.k === 'openInv') { this.sim.handle(id, a); return; }
    const game = this.current;
    if (this.phase !== 'round' || !game || !game.alive.has(id)) return;
    const p = this.sim.players.get(id), b = this.host.body(id);
    if (!p || !b) return;
    if (game.onAction(id, a)) { game.flush(); return; }
    switch (a.k) {
      case 'attack': {
        if (a.target === undefined || !game.alive.has(a.target) || p.attackTicks < 10) return;
        const victim = this.host.body(a.target);
        if (!victim || Math.hypot(b.x - victim.x, b.y - victim.y, b.z - victim.z) > 3.8) return;
        if (!game.melee(id,a.target)) return;
        p.attackTicks = 0;
        this.sim.knock(a.target, b.x, b.z, game.id==='koth'?2:0, id);
        return;
      }
      case 'dig': {
        const x = a.x | 0, y = a.y | 0, z = a.z | 0;
        const key = `${x},${y},${z}`;
        if (this.digKey.get(id) !== key) {
          this.digKey.set(id, key);
          const reach = Math.hypot(x + .5 - b.x, y + .5 - (b.y + 1.62), z + .5 - b.z) <= REACH;
          this.digTaken.set(id, !reach || game.onLeftClick(id, x, y, z));
          game.flush();
        }
        if (this.digTaken.get(id)) return;
        this.sim.handle(id, a);
        return;
      }
      case 'digStop': this.digKey.delete(id); this.digTaken.delete(id); this.sim.handle(id, a); return;
      case 'use': {
        if (a.block) {
          const h = a.block;
          const reach = Math.hypot(h.x + .5 - b.x, h.y + .5 - (b.y + 1.62), h.z + .5 - b.z) <= REACH;
          if (reach && game.onRightClick(id, h)) { game.flush(); return; }
          // Decoration never opens or toggles: only a held block uses the clicked face.
          const held = p.inv.slots[a.offhand ? 40 : a.slot];
          if (!held || VITEM[held.id]?.block === undefined) { this.sim.handle(id, { ...a, block: undefined }); return; }
        }
        this.sim.handle(id, a);
        return;
      }
      default: this.sim.handle(id, a);
    }
  }
  canMove(id: number): boolean { return (!(this.phase === 'brief' || this.phase === 'countdown') || !this.roster.has(id)) && (this.current?.canWalk(id) ?? true); }
  hidden(id: number): boolean {
    const g = this.current;
    return this.phase === 'round' && !!g && g.participants.has(id) && !g.alive.has(id);
  }
  isOver(): boolean { return this.over; }
  lingerSeconds(): number { return MG.PODIUM_TICKS / 20 + 6; }
  botRating(botId: number) {
    const b = this.bots.find((x) => x.id === botId);
    return b ? { rating: b.rating, against: [...this.roster.keys()].filter((id) => !this.host.body(id)?.bot) } : null;
  }
  dispose(): void {
    this.closeRound();
    this.timers.length = 0;
    this.bots.length = 0;
  }
  tick(dt: number): void {
    this.acc = Math.min(this.acc + dt, .5);
    while (this.acc >= STEP) { this.acc -= STEP; this.step(); }
  }

  // ── The match loop ──────────────────────────────────────────────────────

  private step(): void {
    this.ticks++;
    this.phaseTicks++;
    for (let i = this.timers.length - 1; i >= 0; i--) {
      const t = this.timers[i];
      if (t.at <= this.ticks) { this.timers.splice(i, 1); try { t.fn(); } catch (e) { console.warn('Party Games timer failed', e); } }
    }
    this.current?.flush();
    for (const b of this.bots) b.tick(STEP);
    switch (this.phase) {
      case 'brief': if (this.phaseTicks >= MG.BRIEF_TICKS) { this.phase = 'countdown'; this.phaseTicks = 0; } break;
      case 'countdown': this.tickCountdown(); break;
      case 'round': this.tickRound(); break;
      case 'results': if (this.phaseTicks >= MG.RESULTS_TICKS) this.afterResults(); break;
      case 'podium': break;
    }
    this.sim.tick();
    if (this.phase === 'round' && this.ticks % 10 === 0 && this.current) {
      for (const id of this.current.players()) {
        const text = this.current.bar(id);
        if (text) this.host.send(id, { k: 'bar', text, color: '#3b3f45' });
      }
    }
    if (this.ticks % 5 === 0) this.publish();
  }

  private doubled(): boolean { return this.lineup.length > 1 && this.index === this.lineup.length - 1; }

  /** Spawns for the current game (shuffled order, as the source shuffles the roster). */
  private placeSpawns(): void {
    const g = this.current!;
    const ids = [...this.roster.keys()];
    for (let i = ids.length - 1; i > 0; i--) { const j = Math.floor(this.rng() * (i + 1)); [ids[i], ids[j]] = [ids[j], ids[i]]; }
    g.attach(this.ctx);
    const spots = g.spawns(ids.length);
    this.spawns = new Map(ids.map((id, i) => [id, spots[i % spots.length]]));
    this.order = ids;
  }
  private order: number[] = [];

  private beginBrief(): void {
    const g = this.current!;
    for (const id of this.roster.keys()) this.prepare(id, true);
    this.phase = 'brief';
    this.phaseTicks = 0;
    this.roundStarted = true;
    this.board = null;
    g.startRound(this.order, this.order.map((id) => this.spawns.get(id)!));
    const info = g.info, doubled = this.doubled();
    const round = this.lineup.length > 1 ? `Game ${this.index + 1} of ${this.lineup.length}` : 'Party Games';
    this.host.broadcast({ k: 'title', title: info.name, sub: doubled ? 'Double points' : `${round} · ${MG_CATEGORIES[info.category].label}`, color: doubled ? '#d99a00' : MG_CATEGORIES[info.category].color, ms: 4000 });
    this.sim.sound('pling', undefined, undefined, undefined, 1.2);
    for (const b of this.bots) b.onRound();
  }

  private tickCountdown(): void {
    const left = MG.COUNTDOWN_TICKS - this.phaseTicks;
    if (left > 0 && left % 20 === 0) {
      const s = left / 20;
      this.host.broadcast({ k: 'title', title: String(s), sub: '', color: '#d99a00', ms: 900 });
      this.sim.sound('pling', undefined, undefined, undefined, .8 + (3 - s) * .2);
    }
    if (left <= 0) {
      this.host.broadcast({ k: 'title', title: 'Go', sub: '', color: '#1f9d5b', ms: 700 });
      this.sim.sound('go');
      this.phase = 'round';
      this.phaseTicks = 0;
      this.roundLimit = this.current!.seconds * 20;
      for (const id of this.roster.keys()) { const p = this.sim.players.get(id); if (p) p.frozen = false; }
      this.current!.begin();
      this.current!.flush();
    }
  }

  private tickRound(): void {
    const g = this.current!;
    try { g.runTick(); } catch (e) {
      console.warn(`Party Games: ${g.id} failed mid-round`, e);
      this.host.broadcast({ k: 'feed', text: `Something broke in ${g.info.name}. Ending the round.`, tone: 'warn' });
      this.endRound();
      return;
    }
    if (this.phase !== 'round') return;
    if (g.over() || g.t >= this.roundLimit) this.endRound();
  }

  /** The first racer home starts a short clock for everyone else. */
  raceGrace(): void {
    const g = this.current;
    if (!g || this.phase !== 'round') return;
    const grace = g.graceSeconds(), limit = g.t + grace * 20;
    if (limit < this.roundLimit) {
      this.roundLimit = limit;
      this.host.broadcast({ k: 'feed', text: `${grace} seconds left to finish.`, tone: 'warn' });
    }
  }
  roundEndsInTicks(): number { return this.current ? Math.max(0, this.roundLimit - this.current.t) : 0; }

  private endRound(): void {
    if (this.phase !== 'round') return;
    const g = this.current!;
    try { g.finish(); } catch (e) { console.warn(`Party Games: finish() failed in ${g.id}`, e); }
    g.flush();
    this.phase = 'results';
    this.phaseTicks = 0;
    this.completedRounds++;
    const groups: number[][] = [];
    const seen = new Set<number>();
    for (const group of g.placements()) {
      const copy = group.filter((id) => this.roster.has(id) && !seen.has(id));
      copy.forEach((id) => seen.add(id));
      if (copy.length) groups.push(copy);
    }
    const missing = [...this.roster.keys()].filter((id) => !seen.has(id) && g.participants.has(id));
    if (missing.length) groups.push(missing);
    const doubled = this.doubled();
    const earned = award(groups, doubled);
    let place = 0;
    const rows: MgResultRow[] = [];
    for (const group of groups) {
      for (const id of group) {
        this.lastPlace.set(id, place);
        if (place === 0) this.roundWins.set(id, (this.roundWins.get(id) ?? 0) + 1);
        rows.push({ id, name: this.roster.get(id)!, place: place + 1, earned: earned.get(id) ?? 0, detail: g.detail(id) });
      }
      place += group.length;
    }
    for (const [id, pts] of earned) {
      this.totals.set(id, (this.totals.get(id) ?? 0) + pts);
      const cp = this.categoryPoints.get(id) ?? {};
      cp[g.category] = (cp[g.category] ?? 0) + pts;
      this.categoryPoints.set(id, cp);
    }
    this.results = { game: g.id, rows };
    if (groups.length) {
      const winners = groups[0].map((id) => this.roster.get(id)).join(' & ');
      this.host.broadcast({ k: 'title', title: winners, sub: `wins ${g.info.name}`, color: '#d99a00', ms: 3000 });
      this.sim.sound('toast');
    }
    // Everyone can stand around and look; nobody is out any more.
    for (const id of this.roster.keys()) {
      const p = this.sim.players.get(id);
      if (!p) continue;
      const wasOut = p.spectator;
      this.prepare(id, false);
      if (wasOut) { const s = this.spawns.get(id); if (s) this.host.teleport(id, s.x, s.y, s.z, s.yaw); }
    }
    for (const b of this.bots) b.adapt();
    this.publish();
  }

  /** Final ranking: points, then mini-game wins, then the better place in the last game, then a seeded coin. */
  ranking(): number[] {
    const tie = (id: number) => (Math.imul(id ^ this.tieSeed, 0x9e3779b1) >>> 0);
    return [...this.roster.keys()].sort((a, b) =>
      (this.totals.get(b) ?? 0) - (this.totals.get(a) ?? 0)
      || (this.roundWins.get(b) ?? 0) - (this.roundWins.get(a) ?? 0)
      || (this.lastPlace.get(a) ?? 99) - (this.lastPlace.get(b) ?? 99)
      || tie(a) - tie(b));
  }

  private closeRound(): void {
    const g = this.current;
    if (!g || !this.roundStarted) return;
    this.roundStarted = false;
    try { if (this.phase === 'round') g.finish(); g.cleanup(); g.flush(); } catch (e) { console.warn(`Party Games: cleanup failed in ${g.id}`, e); }
    for (const e of [...this.sim.ents.all.values()]) this.sim.ents.remove(e);
  }

  private afterResults(): void {
    this.closeRound();
    this.index++;
    if (this.index >= this.lineup.length || this.roster.size < MG.MIN_PLAYERS) { this.goPodium(); return; }
    this.results = null;
    this.world = { kind: 'minigames', seed: roundSeed(this.matchSeed,this.index,this.lineup[this.index]) };
    this.current = createGame(this.lineup[this.index],unseed(this.world.seed).course);
    if (!this.current) { this.afterResults(); return; }
    this.placeSpawns();
    this.host.switchWorld('minigames', this.world.seed, this.spawns);
    this.beginBrief();
  }

  private goPodium(): void {
    this.closeRound();
    this.current = null;
    this.phase = 'podium';
    this.phaseTicks = 0;
    this.board = null;
    const order = this.ranking();
    const spawns = new Map<number, Spot>();
    const others = order.slice(3);
    order.slice(0, 3).forEach((id, i) => spawns.set(id, podiumStep(i)));
    others.forEach((id, i) => spawns.set(id, podiumCrowd(i, others.length)));
    this.spawns = spawns;
    this.world = { kind: 'minigames', seed: worldSeed(MG_PODIUM_INDEX) };
    this.host.switchWorld('minigames', this.world.seed, spawns);
    for (const id of this.roster.keys()) this.prepare(id, false);
    const standings = this.standings();
    this.podium = { order: order.map((id) => standings.find((s) => s.id === id)!).filter(Boolean), awards: this.awards() };
    if (order.length) {
      this.host.broadcast({ k: 'title', title: this.roster.get(order[0])!, sub: 'is the Party Champion', color: '#d99a00', ms: 4800 });
      this.host.broadcast({ k: 'feed', text: `Party Games final: ${order.map((id, i) => `#${i + 1} ${this.roster.get(id)} ${this.totals.get(id) ?? 0}`).join(' · ')}`, tone: 'good' });
    }
    // Fanfare and fireworks over the steps.
    [1, 1.26, 1.5, 2, 1.5, 2].forEach((pitch, i) => this.ctx.later([0, 4, 8, 12, 18, 22][i] + 1, () => this.sim.sound('pling', undefined, undefined, undefined, pitch)));
    this.ctx.later(40, () => this.sim.sound('toast'));
    const colors = [0xff55ff, 0xffff55, 0x55ffff, 0xffaa00, 0x55ff55, 0xffffff];
    for (let n = 0; n < 10; n++) {
      this.ctx.later(15 + n * 18, () => {
        const s = podiumStep(n % 3);
        this.sim.emit({ f: 'firework', x: s.x + (this.rng() - .5) * 6, y: s.y + 2 + 1.5, z: s.z + (this.rng() - .5) * 2, color: colors[n % colors.length] });
      });
    }
    this.over = true;
    this.publish();
  }

  private awards(): { title: string; name: string; detail?: string }[] {
    const lines: { title: string; name: string; detail?: string }[] = [];
    const order = this.ranking();
    if (order.length) lines.push({ title: 'Champion', name: this.roster.get(order[0])!, detail: `${this.totals.get(order[0]) ?? 0} points` });
    let mostWins: number | null = null;
    for (const id of this.roster.keys()) if (mostWins === null || (this.roundWins.get(id) ?? 0) > (this.roundWins.get(mostWins) ?? 0)) mostWins = id;
    if (mostWins !== null && (this.roundWins.get(mostWins) ?? 0) > 0 && this.lineup.length > 1) {
      lines.push({ title: 'Most Wins', name: this.roster.get(mostWins)!, detail: String(this.roundWins.get(mostWins)) });
    }
    for (const cat of Object.keys(MG_CATEGORIES) as MgCategory[]) {
      let best: number | null = null, bestPoints = 0;
      for (const id of this.roster.keys()) {
        const pts = this.categoryPoints.get(id)?.[cat] ?? 0;
        if (pts > bestPoints) { best = id; bestPoints = pts; }
      }
      if (best !== null) lines.push({ title: MG_CATEGORIES[cat].award, name: this.roster.get(best)! });
    }
    return lines;
  }

  /** Reset a body for the next phase: no items, no effects, not out. */
  private prepare(id: number, frozen: boolean): void {
    const p = this.sim.players.get(id);
    if (!p) return;
    p.inv.slots.fill(null); p.inv.cursor = null; p.invDirty = true;
    for (let i = ARMOR0; i < ARMOR0 + 4; i++) p.inv.slots[i] = null;
    p.effects.clear(); p.fire = 0; p.freeze = 0; p.absorption = 0;
    p.spectator = false; p.alive = true; p.using = null; p.dig = null; p.gliding = false;
    p.frozen = frozen; p.godmode = true; p.hp = 20; p.selected = 0;
    this.host.setHealth(id, 20, false);
    this.digKey.delete(id); this.digTaken.delete(id);
  }

  standings(): MgStanding[] {
    return this.ranking().map((id) => ({ id, name: this.roster.get(id)!, points: this.totals.get(id) ?? 0, wins: this.roundWins.get(id) ?? 0 }));
  }

  private publish(): void {
    const now = this.host.nowMs();
    const g = this.current;
    let left = 0;
    switch (this.phase) {
      case 'brief': left = MG.BRIEF_TICKS - this.phaseTicks + MG.COUNTDOWN_TICKS; break;
      case 'countdown': left = MG.COUNTDOWN_TICKS - this.phaseTicks; break;
      case 'round': left = this.roundEndsInTicks(); break;
      case 'results': left = MG.RESULTS_TICKS - this.phaseTicks; break;
      case 'podium': left = MG.PODIUM_TICKS - this.phaseTicks; break;
    }
    const s: MinigamesState = {
      mode: 'minigames', serverNow: now, phase: this.phase, endsAt: now + Math.max(0, left) * 50,
      game: this.phase === 'podium' ? null : g?.id ?? null,
      index: Math.min(this.index, this.lineup.length - 1), total: this.lineup.length, doubled: this.doubled() && this.phase !== 'podium',
      status: this.phase === 'round' && g ? g.status() : '',
      standings: this.standings(),
      results: this.phase === 'results' ? this.results : null,
      board: this.phase === 'round' || this.phase === 'results' ? this.board : null,
      out: g && this.phase === 'round' ? [...g.participants].filter((id) => !g.alive.has(id)) : [],
      glowing: this.phase === 'round' ? [...this.sim.players.values()].filter(p=>p.effects.has('glowing')).map(p=>p.id) : [],
      rings: g && this.phase === 'round' ? Object.fromEntries(g.players().map(id=>[id,g.guidance(id)]).filter(([,r])=>r)) : {},
      leashes: this.phase === 'round' ? [...this.sim.ents.all.values()].flatMap(e=>{
        const b=typeof e.data.leash==='number'?this.host.body(e.data.leash):null;
        return b?[{from:[e.x,e.y+.8,e.z] as [number,number,number],to:[b.x,b.y+1,b.z] as [number,number,number]}]:[];
      }) : [],
      podium: this.podium,
      host: this.leader,
      over: this.over,
    };
    this.host.broadcast({ k: 'state', s });
  }

  /** The time of day the arena is lit for (Minecraft ticks). */
  timeOfDay(): number { return this.phase === 'podium' ? PODIUM_TIME : this.current?.info.time ?? 6000; }
}
void fmt; void ordinal; void mgGame;

function roundSeed(seed:number,index:number,id:string):number {return worldSeed(mgIndex(id),mgGame(id)?.rerolls ? (Math.imul(seed^index,0x45d9f3b)>>>0)&0x3ffffff : 0);}

registerMode({
  mode: 'minigames',
  title: 'Party Games',
  world: (setup) => ({ kind: 'minigames', seed: roundSeed(setup.seed,0,lineupFor(setup)[0]) }),
  create: (host, setup) => new MinigamesMatch(host, setup),
});
void PODIUM_VIEW;
