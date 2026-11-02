// Lucky Pillars: the match engine, ported from the AutoBox plugin's
// LuckyPillarsGame. Everyone stands on a bedrock pillar and gets a random item
// every 3 seconds; bridge over, knock people into the void, last one standing
// wins. A random twist changes every match. 5 minutes, then a 2 minute
// deathmatch while the border closes on the golden crown.

import { registerMode, type EngineSetup, type ModeEngine, type ModeHost } from './net/mode_engine';
import {
  LP, LP_TWISTS, borderSize, lavaLevel, lootBoost, lootInterval, lpSeed, lpTwist, outerRadius, pickLayout, pickTwist,
  shuffleShift, tntRainInterval, voidY, type LpLayout, type LpPhase, type LpTwist, type PillarsResult, type PillarsState,
} from './pillars_rules';
import { CROWN_Y, LP_BOUNDS, LP_MAX_Y, LP_MIN_Y, lpArenaPillars } from './pillars_geometry';
import { RARITY, rollLoot, rollStarter, type LootEntry } from './pillars_loot';
import { Sim, type SimRules } from './vanilla/sim';
import { VB, lavaAt } from './vanilla/blocks';
import { VI } from './vanilla/items';
import { ARMOR0 } from './vanilla/inventory_model';
import type { DamageSource } from './vanilla/combat';
import type { MAction, MenuView } from './vanilla/messages';
import { mulberry32 } from './noise';
import { PillarsBot } from './pillars_bot';

const STEP = 0.05;
const RECENT_TWISTS: LpTwist[] = [];
let lastLayout: LpLayout | null = null;
const PENDING = new Map<number, { layout: LpLayout; twist: LpTwist; angleStep: number; players: number }>();

/** How a death reads in the feed (source deathText). */
function deathText(cause: string, hasKiller: boolean): string {
  const c = cause;
  if (hasKiller) {
    if (c === 'void') return 'was knocked into the void by';
    if (c === 'fall') return 'was knocked off a pillar by';
    if (c === 'projectile' || c === 'arrow' || c === 'spectral_arrow' || c === 'trident') return 'was shot by';
    if (c === 'explosion' || c === 'firework') return 'was blown up by';
    if (c === 'lava' || c === 'fire' || c === 'burning') return 'was burned to a crisp thanks to';
    return 'was slain by';
  }
  if (c === 'void') return 'fell into the void';
  if (c === 'fall') return 'hit the ground too hard';
  if (c === 'lava') return 'tried to swim in lava';
  if (c === 'fire' || c === 'burning') return 'burned to a crisp';
  if (c === 'explosion' || c === 'fireball') return 'blew up';
  if (c === 'lightning') return 'was struck by lightning';
  return 'died';
}

export class PillarsMatch implements ModeEngine {
  readonly mode = 'pillars' as const;
  readonly world: { kind: 'pillars'; seed: number };
  readonly sim: Sim;
  readonly rng: () => number;
  phase: LpPhase = 'countdown';
  private phaseTicks: number = LP.COUNTDOWN_TICKS;
  ticks = 0;
  mainElapsed = 0;
  private dmElapsed = 0;
  readonly twist: LpTwist;
  readonly layout: LpLayout;
  readonly playerCount: number;
  private readonly spawns = new Map<number, { x: number; y: number; z: number; yaw: number }>();
  readonly roster = new Map<number, string>();
  readonly alive = new Set<number>();
  readonly deathOrder: number[] = [];
  readonly kills = new Map<number, number>();
  private readonly legendaries = new Map<number, number>();
  private readonly rolled = new Map<number, number>();
  private readonly nextLoot = new Map<number, number>();
  private readonly lootSpan = new Map<number, number>();
  private mirrorNext = 0;
  lavaY = -1;
  private lavaQueue: number[] = [];
  private pendingStrike: { x: number; y: number; z: number } | null = null;
  private strikeAt = 0;
  border: number;
  private borderFrom = 0; private borderTo = 0; private borderStart = 0; private borderTicks = 0;
  private readonly ghostAt = new Map<number, number>();
  private readonly ghostNext = new Map<number, number>();
  private readonly ghostShield = new Map<number, number>();
  winner: number | null = null;
  private over = false;
  private result: PillarsResult | undefined;
  private acc = 0;
  private readonly protectedCells = new Set<string>();
  readonly bots: PillarsBot[] = [];
  private readonly readyIds = new Set<number>();
  private thunder = false;

  constructor(readonly host: ModeHost, setup: EngineSetup) {
    this.rng = mulberry32(setup.seed ^ 0x51ab);
    const pend = PENDING.get(setup.seed) ?? choose(setup.seed, setup.players.length);
    PENDING.delete(setup.seed);
    this.twist = pend.twist; this.layout = pend.layout; this.playerCount = pend.players;
    this.world = { kind: 'pillars', seed: lpSeed(pend.layout, pend.players, pend.angleStep, false) };
    this.border = borderSize(this.layout, this.playerCount);
    // Bots move their own Player bodies: knockback has to reach them too.
    const simHost: ModeHost = Object.assign({}, host, {
      impulse: (id: number, kx: number, ky: number, kz: number, by: number, health: number) => {
        host.impulse(id, kx, ky, kz, by, health);
        this.bots.find((b) => b.id === id)?.knockback(kx, ky, kz);
      },
    });
    this.sim = new Sim(simHost, this.rules(), this.rng);
    const pillars = lpArenaPillars(this.world.seed);
    const order = [...setup.players];
    for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(this.rng() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
    order.forEach((pl, i) => {
      const pillar = pillars[i % pillars.length];
      const x = pillar.x + .5, z = pillar.z + .5;
      this.spawns.set(pl.id, { x, y: pillar.topY + 1, z, yaw: Math.atan2(-(.5 - x), -(.5 - z)) });
      this.roster.set(pl.id, host.name(pl.id));
      this.alive.add(pl.id);
      this.kills.set(pl.id, 0);
      const vp = this.sim.addPlayer(pl.id, pl.bot);
      vp.frozen = true;
      vp.hunger.food = 20; vp.hunger.saturation = 20;
      if (pl.bot) this.bots.push(new PillarsBot(this, pl.id, pl.skill, mulberry32(setup.seed ^ pl.id)));
    });
    this.protectedCells.add(`0,${CROWN_Y},0`);
  }

  private rules(): SimRules {
    return {
      pvp: true, hunger: true, fallDamage: true, blockDrops: false, explosionsBreak: true, fluidsFlow: true, naturalRegen: true,
      canBreak: (_id, x, y, z) => !this.protectedCells.has(`${x},${y},${z}`) && this.live(),
      canPlace: (id, _x, y) => y <= LP.MAX_BUILD_Y && this.live() && (id < 0 || this.alive.has(id)),
      instantTntFuse: 50,
      onLethal: (id, src) => this.eliminate(id, src.label ?? src.kind),
      onPlayerHurt: (victim, src, dealt) => this.onHurt(victim, src, dealt),
      attributes: (id) => this.attributes(id),
      isTargetable: (id) => this.alive.has(id),
      onMenuItem: (id, stack) => { if (stack.id === VI.ghost_tricks) this.openGhostMenu(id); },
    };
  }
  private live(): boolean { return this.phase === 'main' || this.phase === 'deathmatch'; }

  /** Twist attribute modifiers (source applyTwist, ADD_NUMBER on the base). */
  private attributes(id: number) {
    if (!this.alive.has(id) || this.phase === 'countdown') return {};
    switch (this.twist) {
      case 'moon_gravity': return { gravity: (.08 - .05) / .08, safeFall: 6 };
      case 'giants': return { scale: 1.5, maxHealth: 30, reach: 1 };
      case 'tiny_town': return { scale: .5 };
      case 'bouncy_castle': return { knockback: 1.5, safeFall: 256 };
      case 'glass_cannon': return { maxHealth: 10 };
      default: return {};
    }
  }

  // ── ModeEngine ───────────────────────────────────────────────────────────

  spawnOf(id: number) { return this.spawns.get(id) ?? { x: .5, y: LP.TOP_Y + 1, z: .5, yaw: 0 }; }
  bounds() { return { minX: LP_BOUNDS.minX, maxX: LP_BOUNDS.maxX, minY: LP_MIN_Y - 40, maxY: LP_MAX_Y, minZ: LP_BOUNDS.minZ, maxZ: LP_BOUNDS.maxZ }; }
  ready(id: number): void {
    this.readyIds.add(id);
    const p = this.sim.players.get(id);
    if (p) { p.invDirty = true; p.selfKey = ''; }
    this.sim.entitySnapshot(id);
    this.publish(true);
  }
  leave(id: number): void {
    if (this.alive.has(id)) this.eliminate(id, 'void', true);
    this.roster.delete(id);
    this.sim.players.delete(id);
  }
  handle(id: number, a: MAction): void {
    if (!a || typeof a !== 'object') return;
    if (a.k === 'menu' && a.menu === 'ghost') { this.ghostTrick(id, String(a.id)); return; }
    const vp = this.sim.players.get(id);
    if (!vp) return;
    if (!this.alive.has(id)) {
      // Ghosts only open the trick menu (their inventory holds the item).
      if (a.k === 'use' && vp.inv.slots[a.slot]?.id === VI.ghost_tricks) this.openGhostMenu(id);
      if (a.k === 'select') this.sim.handle(id, a);
      return;
    }
    this.sim.handle(id, a);
  }
  canMove(id: number): boolean { return this.phase !== 'countdown' || !this.alive.has(id); }
  hidden(id: number): boolean { return this.roster.has(id) && !this.alive.has(id); }
  isOver(): boolean { return this.over; }
  lingerSeconds(): number { return 25; }
  botRating(botId: number) {
    const b = this.bots.find((x) => x.id === botId);
    if (!b) return null;
    return { rating: b.rating, against: [...this.roster.keys()].filter((id) => !this.host.body(id)?.bot) };
  }
  dispose(): void { this.bots.length = 0; }

  tick(dt: number): void {
    this.acc = Math.min(this.acc + dt, .5);
    while (this.acc >= STEP) { this.acc -= STEP; this.step(); }
  }

  // ── Flow ─────────────────────────────────────────────────────────────────

  private step(): void {
    this.ticks++;
    this.phaseTicks--;
    for (const b of this.bots) b.tick(STEP);
    if (this.phase === 'countdown') this.tickCountdown();
    else if (this.phase === 'main') {
      this.mainElapsed++;
      this.tickLive();
      if (this.phase === 'main' && this.phaseTicks <= 0) this.beginDeathmatch();
    } else if (this.phase === 'deathmatch') {
      this.dmElapsed++;
      this.tickLive();
      if (this.phase === 'deathmatch') {
        if (this.dmElapsed === LP.MID_BORDER_SECONDS * 20) {
          this.shrinkBorder(LP.FINAL_BORDER, LP.DEATHMATCH_TICKS - LP.MID_BORDER_SECONDS * 20);
          this.host.broadcast({ k: 'feed', text: 'The border is closing on the crown!', tone: 'danger' });
        }
        if (this.phaseTicks <= 0) this.timeUp();
      }
    } else if (this.phase === 'over') {
      if (this.phaseTicks % 10 === 0) {
        const w = this.winner !== null ? this.host.body(this.winner) : undefined;
        const at = w ?? { x: .5, y: LP.TOP_Y + 4, z: .5 };
        const a = this.rng() * Math.PI * 2;
        const colors = [0xffff55, 0xffaa00, 0x55ffff, 0xff55ff, 0xffffff];
        this.sim.emit({ f: 'firework', x: at.x + Math.cos(a) * 3, y: at.y + 4, z: at.z + Math.sin(a) * 3, color: colors[Math.floor(this.rng() * colors.length)] });
      }
    }
    this.tickBorder();
    this.sim.tick();
    if (this.ticks % 5 === 0) this.publish();
  }

  private tickCountdown(): void {
    const revealAt = 40;
    if (this.phaseTicks > revealAt && this.phaseTicks % 4 === 0) {
      const fake = LP_TWISTS[Math.floor(this.rng() * LP_TWISTS.length)];
      const pitch = .6 + 1.2 * (1 - (this.phaseTicks - revealAt) / (LP.COUNTDOWN_TICKS - revealAt));
      this.host.broadcast({ k: 'title', title: 'LUCKY PILLARS', sub: `Twist: ${fake.label}`, color: '#ffd23f', ms: 320 });
      this.sim.sound('hat', undefined, undefined, undefined, pitch);
    }
    if (this.phaseTicks === revealAt) this.revealTwist();
    if (this.phaseTicks < revealAt && this.phaseTicks > 0 && this.phaseTicks % 20 === 0) {
      const s = this.phaseTicks / 20;
      this.host.broadcast({ k: 'bar', text: `Starting in ${s}`, color: '#ffd23f' });
      this.sim.sound('pling', undefined, undefined, undefined, .8 + (3 - s) * .2);
    }
    if (this.phaseTicks <= 0) this.beginMain();
  }

  private revealTwist(): void {
    const t = lpTwist(this.twist);
    this.host.broadcast({ k: 'title', title: t.label, sub: t.description, color: '#ff7ce6', ms: 2700 });
    this.host.broadcast({ k: 'feed', text: `Twist: ${t.label}. ${t.description}`, tone: 'twist' });
    this.sim.sound('levelup', undefined, undefined, undefined, 1.2);
    if (this.twist === 'slime_floor') this.buildSlimeFloor();
    if (this.twist === 'thunderstorm') this.thunder = true;
    if (this.twist === 'vampires') this.sim.rules.naturalRegen = false;
  }

  private beginMain(): void {
    this.phase = 'main';
    this.phaseTicks = LP.MAIN_TICKS;
    this.mirrorNext = this.ticks + lootInterval(this.twist, false, false);
    if (this.twist === 'rising_lava') { this.lavaY = LP.BOTTOM_Y - 1; this.raiseLavaTo(lavaLevel(0, 0)); }
    for (const id of this.alive) {
      const p = this.sim.players.get(id)!;
      p.frozen = false;
      this.applyTwist(id);
      this.giveLoot(id, rollStarter(this.rng));
      this.scheduleLoot(id, lootInterval(this.twist, false, false));
      this.host.send(id, { k: 'title', title: 'GO!', sub: `Loot every ${lootInterval(this.twist, false, false) / 20}s`, color: '#55ff55', ms: 1400 });
    }
    this.sim.sound('growl', undefined, undefined, undefined, 1.4);
  }

  private applyTwist(id: number): void {
    const p = this.sim.players.get(id)!;
    switch (this.twist) {
      case 'sugar_rush': p.effects.add('speed', 1, 1e9); p.effects.add('haste', 1, 1e9); break;
      case 'giants': this.sim.setHp(p, 30); break;
      case 'sky_gliders':
        p.inv.slots[ARMOR0 + 1] = { id: VI.elytra, count: 1 };
        this.sim.give(id, [{ id: VI.firework_rocket, count: 4, flight: 1 }]); p.received--;
        break;
      case 'glass_cannon': this.sim.setHp(p, Math.min(p.hp, 10)); break;
      default: break;
    }
    p.invDirty = true;
  }

  private tickLive(): void {
    this.checkVoid();
    if (!this.live()) return;
    const dm = this.phase === 'deathmatch';
    let mirrored: LootEntry | null = null;
    if (this.twist === 'mirror_loot' && this.ticks >= this.mirrorNext) {
      mirrored = rollLoot(this.rng, lootBoost(this.twist, this.mainElapsed, dm));
      this.mirrorNext = this.ticks + lootInterval(this.twist, dm, false);
    }
    for (const id of [...this.alive]) {
      if (this.twist === 'mirror_loot') {
        if (mirrored) this.giveLoot(id, mirrored);
        this.lootBar(id, this.mirrorNext - this.ticks, lootInterval(this.twist, dm, false));
        continue;
      }
      let due = this.nextLoot.get(id) ?? this.ticks;
      if (this.ticks >= due) {
        this.giveLoot(id, rollLoot(this.rng, lootBoost(this.twist, this.mainElapsed, dm)));
        const interval = lootInterval(this.twist, dm, this.onCrown(id));
        this.scheduleLoot(id, interval);
        due = this.ticks + interval;
      }
      this.lootBar(id, due - this.ticks, this.lootSpan.get(id) ?? LP.LOOT_INTERVAL);
    }
    if (this.ticks % 10 === 0) this.sim.emit({ f: 'burst', kind: 'gold', x: .5, y: CROWN_Y + 1.3, z: .5, color: 0xffd700, n: 6 });
    this.tickTwist(dm);
    if (this.ticks % 20 === 0) {
      for (const id of this.deathOrder) {
        if (!this.roster.has(id)) continue;
        const left = this.ghostRemaining(id);
        this.host.send(id, { k: 'bar', text: left > 0 ? `Ghost trick in ${Math.ceil(left / 20)}s` : 'Ghost trick ready! Right-click the Ghost Tricks item', color: '#ff7ce6' });
      }
    }
  }
  private lootBar(id: number, remaining: number, span: number): void {
    if (this.ticks % 2 !== 0) return;
    const p = this.sim.players.get(id);
    if (!p) return;
    const left = Math.max(0, remaining);
    p.xpLevel = Math.ceil(left / 20);
    p.xpBar = Math.max(0, Math.min(.999, 1 - left / Math.max(1, span)));
  }
  private onCrown(id: number): boolean {
    const b = this.host.body(id);
    return !!b && Math.floor(b.x) === 0 && Math.floor(b.z) === 0 && b.y >= CROWN_Y + 1 && b.y < CROWN_Y + 1.6;
  }
  private scheduleLoot(id: number, interval: number): void { this.nextLoot.set(id, this.ticks + interval); this.lootSpan.set(id, interval); }

  private giveLoot(id: number, e: LootEntry): void {
    this.rolled.set(id, (this.rolled.get(id) ?? 0) + 1);
    this.sim.give(id, e.make(this.rng), true);
    const r = RARITY[e.rarity];
    this.host.send(id, { k: 'bar', text: `+ ${e.name}  ${r.label}`, color: r.color });
    const b = this.host.body(id);
    this.host.send(id, { k: 'fx', fx: [{ f: 'sound', s: 'pickup', x: b?.x, y: b?.y, z: b?.z, pitch: r.pitch }] });
    if (e.rarity === 'epic') this.host.send(id, { k: 'fx', fx: [{ f: 'sound', s: 'chime', pitch: 1.2 }] });
    if (e.rarity === 'legendary') {
      this.legendaries.set(id, (this.legendaries.get(id) ?? 0) + 1);
      this.host.broadcast({ k: 'feed', text: `${this.roster.get(id)} rolled a LEGENDARY: ${e.name}`, tone: 'legendary' });
      this.sim.sound('toast', undefined, undefined, undefined, 1.6);
      this.sim.emit({ f: 'totem', id });
    }
  }

  private tickTwist(dm: boolean): void {
    switch (this.twist) {
      case 'rising_lava': {
        this.pourLava();
        const target = lavaLevel(this.mainElapsed, this.dmElapsed);
        if (target > this.lavaY) { this.raiseLavaTo(target); this.host.broadcast({ k: 'bar', text: `The lava rises! (y ${this.lavaY})`, color: '#ffaa00' }); }
        break;
      }
      case 'tnt_rain':
        if (this.mainElapsed > 100 && this.ticks % tntRainInterval(this.alive.size) === 0) {
          const t = this.randomAlive();
          if (t) {
            const b = this.host.body(t)!;
            this.sim.primeTnt(b.x + Math.floor(this.rng() * 7) - 3, b.y + 14, b.z + Math.floor(this.rng() * 7) - 3, 60, undefined);
          }
        }
        break;
      case 'meteor_shower':
        if (this.mainElapsed > 100 && this.ticks % LP.METEOR_INTERVAL === 0) {
          const t = this.randomAlive();
          if (t) {
            const b = this.host.body(t)!;
            const aim = { x: b.x + Math.floor(this.rng() * 9) - 4, y: b.y, z: b.z + Math.floor(this.rng() * 9) - 4 };
            const from = { x: aim.x + Math.floor(this.rng() * 11) - 5, y: aim.y + 28, z: aim.z + Math.floor(this.rng() * 11) - 5 };
            const fb = this.sim.spawnProjectile('fireball', -1, from, { x: aim.x - from.x, y: aim.y - from.y, z: aim.z - from.z }, .6, { power: 1.6, fire: false });
            fb.owner = undefined; fb.timer = 400;
            this.sim.sound('ghast_shoot', from.x, from.y, from.z, .6);
          }
        }
        break;
      case 'thunderstorm': this.tickLightning(); break;
      case 'shuffle': {
        if (dm || this.mainElapsed <= 0) break;
        const into = this.mainElapsed % LP.SHUFFLE_INTERVAL;
        if (into === LP.SHUFFLE_INTERVAL - LP.SHUFFLE_WARNING) {
          this.host.broadcast({ k: 'title', title: '', sub: 'Shuffling in 3...', color: '#ff7ce6', ms: 1700 });
          this.sim.sound('portal', undefined, undefined, undefined, 1.6);
        } else if (into === 0) this.shuffle();
        break;
      }
      default: break;
    }
    // Stray fireballs never pile up under the arena.
    if (this.ticks % 40 === 0) for (const e of [...this.sim.ents.all.values()]) if (e.kind === 'fireball' && (e.y < LP_MIN_Y || e.age > 400)) this.sim.ents.remove(e);
  }
  private tickLightning(): void {
    if (this.pendingStrike && this.ticks >= this.strikeAt) {
      const s = this.pendingStrike; this.pendingStrike = null;
      this.sim.strikeLightning(s.x, s.y, s.z);
    }
    if (this.pendingStrike) {
      if (this.ticks % 3 === 0) this.sim.emit({ f: 'burst', kind: 'spark', x: this.pendingStrike.x, y: this.pendingStrike.y + 1, z: this.pendingStrike.z, n: 12 });
      return;
    }
    if (this.mainElapsed > 100 && this.ticks % LP.LIGHTNING_INTERVAL === 0) {
      const t = this.randomAlive();
      if (t) {
        const b = this.host.body(t)!;
        this.pendingStrike = { x: b.x + Math.floor(this.rng() * 5) - 2, y: b.y, z: b.z + Math.floor(this.rng() * 5) - 2 };
        this.strikeAt = this.ticks + 20;
        this.sim.sound('beacon_select', this.pendingStrike.x, this.pendingStrike.y, this.pendingStrike.z, 1.8);
      }
    }
  }
  private shuffle(): void {
    const ids = [...this.alive].filter((id) => this.host.body(id));
    if (ids.length < 2) return;
    const spots = ids.map((id) => { const b = this.host.body(id)!; return { x: b.x, y: b.y, z: b.z }; });
    const shift = shuffleShift(this.rng, ids.length);
    ids.forEach((id, i) => {
      const s = spots[(i + shift) % ids.length];
      this.host.teleport(id, s.x, s.y, s.z);
      const p = this.sim.players.get(id);
      if (p) { p.fallDist = 0; p.lastX = s.x; p.lastY = s.y; p.lastZ = s.z; }
      this.sim.sound('teleport', s.x, s.y, s.z, 1.2);
    });
    this.host.broadcast({ k: 'feed', text: 'SHUFFLE! Everyone swapped places.', tone: 'twist' });
  }

  private beginDeathmatch(): void {
    if (this.alive.size <= 1) { this.finish(this.alive.size ? [...this.alive][0] : this.lastDeath()); return; }
    this.phase = 'deathmatch';
    this.phaseTicks = LP.DEATHMATCH_TICKS;
    const r = LP.DEATHMATCH_PLATFORM_RADIUS;
    const edits: { x: number; y: number; z: number; block: number }[] = [];
    for (let x = -r; x <= r; x++) for (let z = -r; z <= r; z++) {
      if (x * x + z * z > r * r + 1) continue;
      if (this.host.getBlock(x, LP.TOP_Y, z) !== VB.bedrock) edits.push({ x, y: LP.TOP_Y, z, block: VB.bedrock });
    }
    this.sim.edits(edits);
    this.sim.sound('beacon', .5, LP.TOP_Y, .5, .8);
    this.shrinkBorder(LP.MID_BORDER, LP.MID_BORDER_SECONDS * 20);
    for (const id of this.alive) {
      this.sim.players.get(id)!.effects.add('glowing', 0, 1e9);
      this.sim.give(id, [{ id: VI.white_wool, count: 32 }]);
      const p = this.sim.players.get(id)!; p.received--;
      this.scheduleLoot(id, lootInterval(this.twist, true, false));
    }
    this.host.broadcast({ k: 'title', title: 'DEATHMATCH', sub: 'The border is closing. Get to the crown!', color: '#c0182a', ms: 3000 });
    this.host.broadcast({ k: 'feed', text: "DEATHMATCH! Everyone glows, loot comes every 2 seconds and the border shrinks to the crown. Here's 32 wool to get there.", tone: 'danger' });
    this.sim.sound('wither', undefined, undefined, undefined, 1);
  }
  private shrinkBorder(to: number, ticks: number): void {
    this.borderFrom = this.border; this.borderTo = to; this.borderStart = this.ticks; this.borderTicks = ticks;
  }
  private tickBorder(): void {
    if (this.borderTicks > 0) {
      const t = Math.min(1, (this.ticks - this.borderStart) / this.borderTicks);
      this.border = this.borderFrom + (this.borderTo - this.borderFrom) * t;
      if (t >= 1) this.borderTicks = 0;
    }
    if (!this.live() || this.ticks % 10 !== 0) return;
    // 1 damage per block outside, no buffer (vanilla border).
    const half = this.border / 2;
    for (const id of this.alive) {
      const b = this.host.body(id);
      if (!b) continue;
      const out = Math.max(Math.abs(b.x - .5) - half, Math.abs(b.z - .5) - half);
      if (out > 0) this.sim.damage(id, { kind: 'border', amount: Math.max(1, Math.floor(out)), label: 'border' });
    }
  }
  private timeUp(): void {
    let best: number | null = null, bestHp = -1;
    for (const id of this.alive) {
      const p = this.sim.players.get(id);
      if (!p) continue;
      const hp = p.hp + p.absorption;
      if (hp > bestHp || (hp === bestHp && best !== null && (this.kills.get(id) ?? 0) > (this.kills.get(best) ?? 0))) { best = id; bestHp = hp; }
    }
    this.host.broadcast({ k: 'feed', text: `Time! ${best === null ? 'Nobody' : this.roster.get(best)} wins with the most health left.`, tone: 'gold' });
    this.finish(best);
  }
  private checkVoid(): void {
    const vy = voidY(this.twist);
    for (const id of [...this.alive]) {
      const b = this.host.body(id);
      if (b && b.y < vy) { this.eliminate(id, 'void'); if (!this.live()) return; }
    }
  }
  private checkEnd(): void {
    if (this.phase === 'over') return;
    if (this.alive.size <= 1) this.finish(this.alive.size ? [...this.alive][0] : this.lastDeath());
  }
  private lastDeath(): number | null { return this.deathOrder.length ? this.deathOrder[this.deathOrder.length - 1] : null; }

  private finish(champion: number | null): void {
    if (this.phase === 'over') return;
    this.winner = champion;
    this.phase = 'over';
    this.phaseTicks = LP.OVER_TICKS;
    this.pendingStrike = null;
    this.borderTicks = 0;
    const name = champion === null ? 'Nobody' : this.roster.get(champion) ?? '?';
    this.host.broadcast({ k: 'title', title: name, sub: 'wins Lucky Pillars!', color: '#ffaa00', ms: 4500 });
    this.sim.sound('toast');
    if (champion !== null) { this.sim.emit({ f: 'totem', id: champion }); const p = this.sim.players.get(champion); if (p) p.frozen = false; }
    for (const p of this.sim.players.values()) { p.xpBar = 0; p.xpLevel = 0; }
    // Ranking: winner, survivors by health, then the eliminated, last out first.
    const ranking: number[] = [];
    if (champion !== null && this.roster.has(champion)) ranking.push(champion);
    const survivors = [...this.alive].filter((id) => id !== champion).sort((a, b) => (this.sim.players.get(b)?.hp ?? 0) - (this.sim.players.get(a)?.hp ?? 0));
    ranking.push(...survivors);
    for (let i = this.deathOrder.length - 1; i >= 0; i--) if (!ranking.includes(this.deathOrder[i]) && this.roster.has(this.deathOrder[i])) ranking.push(this.deathOrder[i]);
    this.result = {
      winner: champion,
      rows: ranking.map((id, i) => ({
        id, name: this.roster.get(id) ?? '?', place: i + 1, kills: this.kills.get(id) ?? 0, items: this.rolled.get(id) ?? 0,
        legendaries: this.legendaries.get(id) ?? 0, survived: this.alive.has(id),
      })),
    };
    this.over = true;
    // The champion can't be hurt any more.
    if (champion !== null) { const p = this.sim.players.get(champion); if (p) p.godmode = true; }
    this.publish(true);
  }

  /** Lethal damage, the void, or leaving: out of the match. */
  eliminate(id: number, cause: string, left = false): void {
    if (!this.alive.delete(id)) return;
    this.deathOrder.push(id);
    this.ghostAt.set(id, this.ticks);
    const p = this.sim.players.get(id);
    const b = this.host.body(id);
    const vy = voidY(this.twist);
    let killer: number | null = null;
    if (p && p.lastAttacker !== null && p.lastAttacker !== id && this.ticks - p.lastAttackerAt <= LP.KILL_CREDIT_TICKS && this.roster.has(p.lastAttacker)) killer = p.lastAttacker;
    if (p && b) {
      if (b.y >= vy && !left) {
        for (const s of p.inv.slots) if (s) this.sim.dropItem(b.x, b.y + .5, b.z, s, 0, 0, 0, 10, true);
        if (p.inv.cursor) this.sim.dropItem(b.x, b.y + .5, b.z, p.inv.cursor, 0, 0, 0, 10, true);
      }
      p.inv.slots.fill(null); p.inv.cursor = null;
      p.effects.clear(); p.absorption = 0; p.fire = 0; p.freeze = 0; p.using = null; p.dig = null; p.gliding = false;
      p.alive = false; p.spectator = true;
      p.hp = 20;
      p.xpBar = 0; p.xpLevel = 0;
      p.win = null;
      if (!left) {
        // A ghost keeps one item: the trick menu.
        p.inv.slots[0] = { id: VI.ghost_tricks, count: 1 };
        p.selected = 0;
      }
      p.invDirty = true;
      this.host.setHealth(id, 20, true);
      const outer = outerRadius(this.layout, Math.max(2, this.playerCount));
      if (b.y >= vy) this.host.teleport(id, b.x, b.y + 2, b.z);
      else this.host.teleport(id, .5, LP.TOP_Y + 14, -outer - 12 + .5, Math.PI);
      this.sim.emit({ f: 'lightning', x: b.x, y: b.y, z: b.z });
    }
    const place = this.alive.size + 1;
    if (!left) this.host.send(id, { k: 'title', title: 'ELIMINATED', sub: `#${place}${killer !== null ? ` · killed by ${this.roster.get(killer)}` : ''}`, color: '#ff5555', ms: 2500 });
    const how = deathText(cause, killer !== null);
    this.host.broadcast({ k: 'feed', text: `${this.roster.get(id)} ${how}${killer !== null ? ` ${this.roster.get(killer)}` : ''} (${this.alive.size} left)`, tone: 'death' });
    if (killer !== null) this.kills.set(killer, (this.kills.get(killer) ?? 0) + 1);
    if (killer !== null && this.alive.has(killer)) {
      const heal = this.twist === 'vampires' ? LP.VAMPIRE_KILL_HEAL : LP.KILL_HEAL;
      this.sim.heal(killer, heal);
      this.host.send(killer, { k: 'bar', text: `KILL! +${heal / 2} hearts and a bonus item`, color: '#ffaa00' });
      this.host.send(killer, { k: 'fx', fx: [{ f: 'sound', s: 'xp', pitch: 1.4 }] });
      this.giveLoot(killer, rollLoot(this.rng, lootBoost(this.twist, this.mainElapsed, this.phase === 'deathmatch') + .5));
    }
    this.checkEnd();
    if (this.live() && !left) this.host.send(id, { k: 'feed', text: "You're a ghost! Cheer heals half a heart; Boo gives 4s of glowing. One trick every 25s; each survivor is protected for 20s after any trick.", tone: 'ghost' });
  }

  private onHurt(victim: number, src: DamageSource, dealt: number): void {
    if (this.twist !== 'vampires' || src.kind !== 'melee' || src.by === undefined || src.byEntity || !this.alive.has(src.by)) return;
    this.sim.heal(src.by, dealt * LP.VAMPIRE_LIFESTEAL);
    const b = this.host.body(src.by);
    if (b) this.sim.emit({ f: 'burst', kind: 'heart', x: b.x, y: b.y + 1.8, z: b.z, n: 3 });
    void victim;
  }

  // ── Arena changes ────────────────────────────────────────────────────────

  private buildSlimeFloor(): void {
    const radius = outerRadius(this.layout, this.playerCount) + 5;
    const y = LP.BOTTOM_Y - 1;
    this.host.fill({ min: [-radius, y, -radius], max: [radius, y, radius], block: VB.slime_block, mask: 'all', radius: radius + .5 });
    for (let x = -radius; x <= radius; x++) for (let z = -radius; z <= radius; z++) if (x * x + z * z <= radius * radius) this.protectedCells.add(`${x},${y},${z}`);
  }
  private raiseLavaTo(target: number): void {
    while (this.lavaY < target) { this.lavaY++; this.lavaQueue.push(this.lavaY); }
    this.sim.sound('lava', .5, this.lavaY, .5, .6);
  }
  /** One queued lava layer per tick, as a single fill (the source poured 400 blocks a tick). */
  private pourLava(): void {
    const y = this.lavaQueue.shift();
    if (y === undefined) return;
    const radius = Math.floor(borderSize(this.layout, this.playerCount) / 2) + 1;
    this.host.fill({ min: [-radius, y, -radius], max: [radius, y, radius], block: lavaAt(0), mask: 'air', radius: radius + .5 });
  }
  private randomAlive(): number | null {
    const ids = [...this.alive];
    return ids.length ? ids[Math.floor(this.rng() * ids.length)] : null;
  }

  // ── Ghost tricks ─────────────────────────────────────────────────────────

  private ghostRemaining(id: number): number {
    const at = this.ghostAt.get(id);
    if (at === undefined) return -1;
    const next = this.ghostNext.get(id) ?? at + LP.GHOST_FIRST_TICKS;
    return Math.max(0, next - this.ticks);
  }
  private canGhost(id: number): boolean { return this.live() && this.roster.has(id) && !this.alive.has(id) && this.ghostAt.has(id); }
  openGhostMenu(id: number): void {
    if (!this.canGhost(id)) { this.host.send(id, { k: 'feed', text: 'Ghost Tricks are for eliminated players while the match is live.', tone: 'warn' }); return; }
    const items: MenuView['items'] = [];
    for (const t of this.alive) {
      const prot = Math.max(0, (this.ghostShield.get(t) ?? 0) - this.ticks);
      const p = this.sim.players.get(t);
      const status = prot > 0 ? `Protected for ${Math.ceil(prot / 20)}s` : 'Ready for a trick';
      const glowing = p?.effects.has('glowing') ?? false;
      items.push({ id: `cheer:${t}`, icon: VI.lime_dye, label: `Cheer ${this.roster.get(t)}`, sub: `Heal half a heart. ${status}`, disabled: prot > 0 || (p ? p.hp >= this.sim.maxHp(t) : true), tag: 'cheer' });
      items.push({ id: `boo:${t}`, icon: VI.ghast_tear, label: `Boo ${this.roster.get(t)}`, sub: glowing ? 'Already glowing — try a cheer!' : `Spooky hiss + 4 seconds of glowing. ${status}`, disabled: prot > 0 || glowing, tag: 'boo' });
    }
    const left = this.ghostRemaining(id);
    this.host.send(id, { k: 'menu', v: { menu: 'ghost', title: 'Ghost Tricks', sub: left > 0 ? `Ready in ${Math.ceil(left / 20)}s · 25s cooldown, 20s protection per survivor` : 'Trick ready! · Cheer or Boo a survivor', items } });
  }
  private ghostTrick(id: number, choice: string): void {
    if (!this.canGhost(id)) return;
    const [kind, raw] = choice.split(':');
    const target = Number(raw);
    const p = this.sim.players.get(target);
    const send = (text: string) => this.host.send(id, { k: 'feed', text, tone: 'warn' });
    if (!this.alive.has(target) || !p) { send('That player is no longer alive here. Pick another survivor.'); return; }
    const left = this.ghostRemaining(id);
    if (left > 0) { send(`Your next trick is ready in ${Math.ceil(left / 20)}s.`); return; }
    const prot = (this.ghostShield.get(target) ?? 0) - this.ticks;
    if (prot > 0) { send(`${this.roster.get(target)} is protected from all ghosts for ${Math.ceil(prot / 20)}s. Try someone else.`); return; }
    const cheer = kind === 'cheer';
    if (cheer && p.hp >= this.sim.maxHp(target)) { send(`${this.roster.get(target)} already has full health. Try a boo or another survivor.`); return; }
    if (!cheer && p.effects.has('glowing')) { send(`${this.roster.get(target)} is already glowing. Try a cheer or another survivor.`); return; }
    this.ghostNext.set(id, this.ticks + LP.GHOST_COOLDOWN_TICKS);
    this.ghostShield.set(target, this.ticks + LP.GHOST_TARGET_SHIELD_TICKS);
    const b = this.host.body(target);
    if (cheer) {
      this.sim.heal(target, LP.GHOST_CHEER_HP);
      if (b) this.sim.emit({ f: 'burst', kind: 'heart', x: b.x, y: b.y + 1.6, z: b.z, n: 4 });
      this.host.send(target, { k: 'fx', fx: [{ f: 'sound', s: 'chime', pitch: 1.6 }] });
    } else {
      p.effects.add('glowing', 0, LP.GHOST_BOO_TICKS);
      if (b) this.sim.emit({ f: 'burst', kind: 'soul', x: b.x, y: b.y + 1.3, z: b.z, n: 8 });
      this.host.send(target, { k: 'fx', fx: [{ f: 'sound', s: 'creeper_hiss', pitch: 1.4 }] });
    }
    this.host.send(target, { k: 'feed', text: cheer ? `${this.roster.get(id)}'s ghost cheered you: +½ heart!` : `Boo! ${this.roster.get(id)}'s ghost haunted you: glowing for 4s!`, tone: cheer ? 'cheer' : 'ghost' });
    this.host.send(id, { k: 'feed', text: `${cheer ? 'You cheered' : 'You booed'} ${this.roster.get(target)}! Next trick in 25s.`, tone: cheer ? 'cheer' : 'ghost' });
    this.host.send(id, { k: 'menu', v: null });
  }

  // ── State ────────────────────────────────────────────────────────────────

  private publish(force = false): void {
    void force;
    const endsAt = this.host.nowMs() + Math.max(0, this.phaseTicks) * 50;
    const s: PillarsState = {
      mode: 'pillars', serverNow: this.host.nowMs(), phase: this.phase, endsAt,
      twist: this.phase === 'countdown' && this.phaseTicks > 40 ? null : this.twist,
      layout: this.layout, lavaY: this.twist === 'rising_lava' && this.lavaY >= LP.BOTTOM_Y ? this.lavaY : null,
      border: Math.round(this.border * 100) / 100,
      thunder: this.thunder,
      players: [...this.roster].map(([id, name]) => {
        const p = this.sim.players.get(id);
        const scale = this.attributes(id).scale;
        return {
          id, name, kills: this.kills.get(id) ?? 0, alive: this.alive.has(id), hp: Math.ceil(p?.hp ?? 0),
          glow: p?.effects.has('glowing') || undefined, invis: p?.effects.has('invisibility') || undefined, scale: scale !== undefined && scale !== 1 ? scale : undefined,
        };
      }),
      result: this.result,
    };
    this.host.broadcast({ k: 'state', s });
  }
}

/** Pick twist and layout for a new match (recent memory across matches, like the source). */
function choose(seed: number, players: number): { layout: LpLayout; twist: LpTwist; angleStep: number; players: number } {
  const rng = mulberry32(seed ^ 0x77);
  const twist = pickTwist(rng, RECENT_TWISTS);
  RECENT_TWISTS.push(twist);
  while (RECENT_TWISTS.length > LP.RECENT_TWIST_MEMORY) RECENT_TWISTS.shift();
  const layout = pickLayout(rng, players, lastLayout);
  lastLayout = layout;
  return { layout, twist, angleStep: Math.floor(rng() * 1024), players };
}

registerMode({
  mode: 'pillars',
  title: 'Lucky Pillars',
  world(setup) {
    const pick = choose(setup.seed, setup.players.length);
    PENDING.set(setup.seed, pick);
    return { kind: 'pillars', seed: lpSeed(pick.layout, pick.players, pick.angleStep, false) };
  },
  create: (host, setup) => new PillarsMatch(host, setup),
});
