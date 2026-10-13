// Authoritative, fixed-step Bedwars. The host is the only world/transport port.
import { Block, collisionBoxes, isSolid } from './blocks';
import { Item } from './items';
import { BW_BOUNDS, BW_MIN_Y, BW_MAX_Y, BW_VOID_Y, bwMap, type BedwarsMap } from './bedwars_map';
import {
  BW, BW_RESOURCES, BW_RESOURCE_ITEM, BW_RESOURCE_NAME, BW_SCHEDULE, BW_TEAM_NAMES, bwBreakSeconds, bwGenTier, bwUpgrades, bwWallet, bwZoneRadius,
  type BwAction, type BwDropView, type BwPhase, type BwPos, type BwResource, type BwResult, type BwSnapshot, type BwTeam,
  type BwTools, type BwUpgrades, type BwWallet, type BwProjectileView,
} from './bedwars_rules';
import { bwCatalog, bwEntryOf, bwPrice, bwSwordTier } from './bedwars_catalog';
import { bwAttached } from './bedwars_geometry';
import { bwAdd, bwCloneSlots, bwConsume, bwCount, bwGive, bwHas, bwKit, bwMaxStack, bwRoom, bwTake, type BwSlots } from './bedwars_inventory';
import { bwDistance, bwFits, bwKey, bwLine, bwOnGround } from './bedwars_nav';
import { stepDrop, type BwDropBody } from './bedwars_drops';
import { BedwarsBot } from './bedwars_bot';

export interface BwBody extends BwPos { yaw: number; pitch: number; health: number; dead: boolean; held?: number }
export interface BwHost {
  nowMs(): number;
  body(id: number): BwBody | undefined;
  name(id: number): string;
  send(id: number, msg: any): void;
  broadcast(msg: any): void;
  teleport(id: number, x: number, y: number, z: number, yaw?: number, health?: number): void;
  setHealth(id: number, health: number, dead: boolean): void;
  impulse(id: number, kx: number, ky: number, kz: number, by: number, health: number): void;
  setBlock(x: number, y: number, z: number, block: number): void;
  getBlock(x: number, y: number, z: number): number;
  drive(id: number, pose: { x: number; y: number; z: number; yaw: number; pitch: number; held?: number; swing?: boolean; sneaking?: boolean }): void;
}
/** `skill` seeds a bot's level (0..1): what it learned about the humans it faces. */
/** `map` picks the island layout (the world seed); `teams` is 2 to 4. */
export interface BwSetup { players: { id: number; team: BwTeam; bot: boolean; skill?: number }[]; world: number; map?: number; teams?: number }
interface Mining extends BwPos { slot: number; block: number; began: number; heartbeat: number; duration: number }
interface Track { t: number; x: number; y: number; z: number }
export interface BwPlayer {
  id: number; team: BwTeam; bot: boolean; ready: boolean; alive: boolean; eliminated: boolean; connected: boolean; disconnectedAt: number;
  health: number; respawnAt: number; shieldUntil: number; slots: BwSlots;
  selected: number; armor: number; sword: number; tools: BwTools;
  kills: number; finals: number; deaths: number; beds: number;
  attackAt: number; placeTokens: number; useAt: number; hurtAt: number; healUntil: number; trapUntil: number;
  lastAttacker: number | null; lastHit: number; mining?: Mining;
  requests: Map<number, { sku: string; reply: { t: 'bwBuyResult'; request: number; ok: boolean; message: string } }>;
  retiredRequests: Set<number>;
  budget: number; track: Track[]; kitDirty: boolean; placement: number;
}
interface TeamState { bed: boolean; upgrades: BwUpgrades; chest: BwWallet }
interface Generator { id: number; kind: BwResource; pos: BwPos; team?: BwTeam; timer: number }
interface Projectile extends BwPos { id: number; kind: 'arrow' | 'pearl' | 'tnt'; owner: number; vx: number; vy: number; vz: number; age: number; damage: number }
interface Drop extends BwDropBody { id: number; item: number; count: number; src: number; born: number; lock: number }
const STEP = 0.05;
const PERIOD: Record<BwResource, number> = { iron: 1, gold: 5, diamond: 20, emerald: 35 };
/** Items one generator may have lying around before it pauses. */
const PILE: Record<BwResource, number> = { iron: 48, gold: 12, diamond: 6, emerald: 4 };
const finite = (...v: number[]) => v.every((n) => typeof n === 'number' && Number.isFinite(n));
const validSlot = (s: number) => Number.isInteger(s) && s >= 0 && s < BW.SLOT_COUNT;
/** Bedrock's sword damage (wood, stone, iron, diamond); a bare fist does 1. */
const SWORD_DAMAGE = [5, 6, 7, 8];
/** Damage taken off by armor tier: everyone starts in leather. */
const ARMOR_REDUCTION = [0.2, 0.36, 0.48, 0.6];
/** Knockback in blocks/second: a plain hit, and a sprinting one. Vertical is a
 *  little under a jump, as in vanilla. */
const KNOCK = { walk: 7.6, sprint: 12, lift: 7.2, sprintLift: 7.6 };

export class BedwarsMatch {
  readonly players = new Map<number, BwPlayer>();
  readonly map: BedwarsMap;
  readonly teamCount: number;
  readonly teams: TeamState[];
  readonly bots: BedwarsBot[] = [];
  readonly placed = new Map<number, { x: number; y: number; z: number; block: number }>();
  readonly generators: Generator[];
  phase: BwPhase = 'loading';
  time = 0;
  result: BwResult | null = null;
  private clock = 0;
  private countdown = BW.COUNTDOWN as number;
  private acc = 0;
  private steps = 0;
  private disposed = false;
  private nextEntity = 1;
  private projectiles: Projectile[] = [];
  private sentProjectiles = false;
  private drops: Drop[] = [];
  private readonly live = new Map<number, number>();
  private dropAdd: BwDropView[] = [];
  private dropGone: { id: number; by?: number; into?: number }[] = [];
  private dropCount: { id: number; count: number }[] = [];
  /** Index of the next BW_SCHEDULE entry. */
  private nextEvent = 0;
  private readonly createdAt: number;

  constructor(readonly host: BwHost, readonly setup: BwSetup) {
    this.createdAt = host.nowMs();
    this.map = bwMap(setup.map ?? 0);
    this.teamCount = Math.max(2, Math.min(4, Math.floor(setup.teams ?? 2)));
    this.teams = Array.from({ length: this.teamCount }, () => ({ bed: true, upgrades: bwUpgrades(), chest: bwWallet() }));
    this.generators = this.map.generators.filter((g) => g.team === undefined || g.team < this.teamCount)
      .map((g) => ({ ...g, pos: { ...g.pos }, timer: PERIOD[g.kind] }));
    // Islands nobody plays on have no bed.
    for (const base of this.map.bases) if (base.team >= this.teamCount) for (const c of [base.bed, base.bedFoot]) host.setBlock(c.x, c.y, c.z, Block.Air);
    for (const v of setup.players) {
      if (this.players.has(v.id) || !Number.isInteger(v.team) || v.team < 0 || v.team >= this.teamCount) continue;
      const p: BwPlayer = { ...v, ready: v.bot, alive: true, eliminated: false, connected: true, disconnectedAt: 0, health: BW.HEALTH,
        respawnAt: 0, shieldUntil: 0, slots: [], selected: 0, armor: 0, sword: 0, tools: { pickaxe: 0, axe: 0, shears: 0 },
        kills: 0, finals: 0, deaths: 0, beds: 0, attackAt: 0, placeTokens: BW.PLACE_BURST, useAt: 0, hurtAt: -10, healUntil: 0, trapUntil: 0,
        lastAttacker: null, lastHit: -100, requests: new Map(), retiredRequests: new Set(), budget: 80, track: [], kitDirty: false, placement: 0 };
      this.players.set(p.id, p);
      this.spawn(p);
      if (p.bot) this.bots.push(new BedwarsBot(this, p.id, v.skill));
    }
  }
  ready(id: number): void {
    const p = this.players.get(id);
    if (!p || this.disposed) return;
    p.ready = true;
    this.syncKit(p); this.flushKit(p);
    this.host.send(id, { t: 'bwState', s: this.snapshot() });
    if (this.drops.length) this.host.send(id, { t: 'bwDrop', reset: true, add: this.drops.map((d) => this.view(d)) });
    if (this.result) this.host.send(id, { t: 'bwResult', result: this.result });
    this.tryStart();
  }
  isOver(): boolean { return this.phase === 'results'; }
  canMove(id: number): boolean { const p = this.players.get(id); return !this.disposed && this.active() && !!p?.alive && p.connected; }
  dispose(): void { this.disposed = true; this.projectiles = []; this.drops = []; this.bots.length = 0; for (const p of this.players.values()) p.mining = undefined; }
  disconnect(id: number): void {
    const p = this.players.get(id);
    if (!p || !p.connected || this.disposed) return;
    p.connected = false; p.disconnectedAt = this.clock; p.mining = undefined;
    if (!this.isOver()) this.kill(p);
    this.publish();
  }
  reconnect(id: number): void {
    const p = this.players.get(id);
    if (!p || this.disposed) return;
    if (!p.connected && this.clock - p.disconnectedAt >= BW.DISCONNECT_GRACE) { this.leave(id); return; }
    p.connected = true; p.disconnectedAt = 0;
    this.host.setHealth(id, p.health, !p.alive);
    this.ready(id);
  }
  expireDisconnected(id: number): void {
    const p = this.players.get(id);
    if (p && !p.connected && this.clock - p.disconnectedAt >= BW.DISCONNECT_GRACE) this.leave(id);
  }
  leave(id: number): void {
    const p = this.players.get(id);
    if (!p) return;
    this.players.delete(id);
    this.event(`${this.host.name(id)} left the match.`, 'info');
    this.checkWinner(); this.tryStart();
  }
  private active(): boolean { return this.phase === 'playing' || this.phase === 'suddenDeath'; }
  private tryStart(): void {
    if (this.phase !== 'loading' || this.disposed) return;
    if ([...this.players.values()].some((p) => !p.ready) && this.clock < 30 && this.host.nowMs() - this.createdAt < 30000) return;
    this.phase = 'countdown'; this.publish();
  }
  tick(dtSeconds: number): void {
    if (this.disposed || !finite(dtSeconds) || dtSeconds <= 0) return;
    this.acc += Math.min(dtSeconds, 0.5);
    while (this.acc + 1e-8 >= STEP) { this.acc -= STEP; this.step(); }
  }
  private step(): void {
    this.clock += STEP; this.steps++;
    for (const p of this.players.values()) if (!p.connected) this.expireDisconnected(p.id);
    if (this.phase === 'loading') this.tryStart();
    else if (this.phase === 'countdown') {
      this.countdown -= STEP;
      if (this.countdown <= 0) {
        this.phase = 'playing'; this.event('Protect your bed and destroy the enemy bed!', 'good');
        for (const p of this.players.values()) if (p.connected) this.spawn(p);
        this.checkWinner();
      }
    } else if (this.active()) {
      this.time += STEP;
      this.runSchedule();
      this.tickPlayers();
      if (this.active()) {
        this.tickGenerators(); this.tickProjectiles(); this.tickDrops();
        for (const bot of this.bots) if (this.active()) bot.tick(STEP);
        this.checkWinner();
        if (this.active() && this.time >= BW.END_AT) this.finish(null, 'Time limit reached. Draw.');
      }
    }
    if (this.active()) this.record();
    this.flush();
    if (this.steps % 4 === 0) this.publish();
  }
  /** Generator upgrades, bed destruction and the deathmatch, on the clock. */
  private runSchedule(): void {
    for (const at of [BW.BED_GONE_AT, BW.ZONE_AT]) if (this.time - STEP < at - 30 && this.time >= at - 30)
      this.event(at === BW.BED_GONE_AT ? 'All beds will be destroyed in 30 seconds!' : 'Deathmatch in 30 seconds. Head to the middle.', 'danger');
    while (this.nextEvent < BW_SCHEDULE.length && this.time >= BW_SCHEDULE[this.nextEvent].at) {
      const e = BW_SCHEDULE[this.nextEvent++];
      if (e.kind === 'diamond' || e.kind === 'emerald') this.event(`${e.label}: ${e.kind === 'diamond' ? 'Diamond' : 'Emerald'} generators are faster.`, 'info');
      else if (e.kind === 'beds' && this.phase === 'playing') {
        this.phase = 'suddenDeath';
        for (let t = 0; t < this.teamCount; t++) this.destroyBed(t);
        this.event('All beds have been destroyed. No more respawns!', 'danger');
      } else if (e.kind === 'deathmatch') this.event('Deathmatch! The safe zone is closing in on the middle.', 'danger');
    }
  }
  private spawn(p: BwPlayer): void {
    const base = this.map.bases[p.team], index = [...this.players.values()].filter((v) => v.team === p.team).findIndex((v) => v.id === p.id);
    const at = base.spawns[Math.max(0, index) % base.spawns.length];
    p.alive = true; p.health = BW.HEALTH; p.respawnAt = 0; p.shieldUntil = this.time + BW.SPAWN_PROTECTION;
    p.sword = 0; p.slots = bwKit(p.tools); p.selected = 0; p.mining = undefined; p.healUntil = 0; p.trapUntil = 0; p.lastAttacker = null; p.track = [];
    this.host.teleport(p.id, at.x, at.y, at.z, base.yaw, BW.HEALTH);
    this.host.setHealth(p.id, BW.HEALTH, false); this.syncKit(p);
  }
  /** Remembers where everyone was, so a swing can be judged against what the
   *  attacker was looking at rather than where the victim is now. */
  private record(): void {
    for (const p of this.players.values()) {
      if (!p.alive) { if (p.track.length) p.track = []; continue; }
      const b = this.host.body(p.id);
      if (!b) continue;
      p.track.push({ t: this.time, x: b.x, y: b.y, z: b.z });
      while (p.track.length && this.time - p.track[0].t > 0.7) p.track.shift();
    }
  }
  private tickPlayers(): void {
    for (const p of this.players.values()) {
      p.budget = Math.min(80, p.budget + 2);
      p.placeTokens = Math.min(BW.PLACE_BURST, p.placeTokens + STEP / BW.PLACE_COOLDOWN);
      if (!p.alive) continue;
      const b = this.host.body(p.id);
      if (!b) continue;
      if (!finite(b.x, b.y, b.z) || b.y < BW_VOID_Y || Math.abs(b.x) > BW_BOUNDS.maxX + 4 || Math.abs(b.z) > BW_BOUNDS.maxZ + 4 || b.y > BW_MAX_Y + 12 || b.dead || b.health <= 0) { this.kill(p); continue; }
      // The match owns health; movement messages never get to heal a body.
      if (b.health !== p.health) this.host.setHealth(p.id, p.health, false);
      if (this.steps % 20 === 0 && this.time >= BW.ZONE_AT && Math.hypot(b.x, b.z) > this.zoneRadius()) {
        this.damage(p, 2 + 4 * (this.time - BW.ZONE_AT) / (BW.END_AT - BW.ZONE_AT), -1, b, 0, true);
        if (!p.alive) continue;
      }
      if (this.steps % 10 === 0 && p.health < BW.HEALTH && (p.healUntil > this.time ||
        (this.teams[p.team].upgrades.heal && bwDistance(b, this.map.bases[p.team].center) < 16 && this.time - p.hurtAt > 3))) {
        p.health = Math.min(BW.HEALTH, p.health + 1); this.host.setHealth(p.id, p.health, false);
      }
      for (let other = 0; other < this.teamCount; other++) {
        const enemy = this.teams[other];
        if (other === p.team || !enemy.upgrades.trap || !enemy.bed || bwDistance(b, this.map.bases[other].bed) >= 8) continue;
        enemy.upgrades.trap = 0; p.trapUntil = this.time + 4;
        this.event(`${BW_TEAM_NAMES[other]} trap: ${this.host.name(p.id)} is at the ${BW_TEAM_NAMES[other]} bed!`, 'danger');
      }
      if (p.mining) {
        const m = p.mining;
        if (this.time - m.heartbeat > BW.BREAK_HEARTBEAT || !this.breakable(p, m) || !this.reachable(p, m) || p.selected !== m.slot || this.host.getBlock(m.x, m.y, m.z) !== m.block) p.mining = undefined;
        else if (this.time - m.began + 1e-8 >= m.duration) {
          const bed = this.map.bedAt(m.x, m.y, m.z);
          if (bed !== null) { this.destroyBed(bed, p); }
          else {
            this.host.setBlock(m.x, m.y, m.z, Block.Air); this.placed.delete(bwKey(m.x, m.y, m.z));
            // Wool always comes back in the breaker's colour.
            const item = m.block === Block.TeamWoolA || m.block === Block.TeamWoolB ? (p.team === 0 ? Block.TeamWoolA : Block.TeamWoolB) : m.block;
            this.collectBlock(p, item, m);
          }
          p.mining = undefined;
        }
      }
    }
    // A respawn granted at death is kept even if the bed falls while you wait:
    // you come back one more time, and the next death is final.
    for (const p of this.players.values()) if (!p.alive && !p.eliminated && p.connected && p.respawnAt > 0 && this.time >= p.respawnAt && this.active()) this.spawn(p);
  }
  handle(id: number, action: BwAction): void {
    if (this.disposed || !action || typeof action !== 'object' || typeof action.kind !== 'string') return;
    const p = this.players.get(id);
    if (!p) return;
    // A kit carries the last processed prediction, including refusals. This
    // lets clients rebase newer local spends onto an authoritative inventory.
    if (action.kind === 'place' && Number.isSafeInteger(action.prediction) && action.prediction! > 0) {
      if (action.prediction! <= p.placement) { this.nack(p, action); return; }
      p.placement = Math.max(p.placement, action.prediction!); p.kitDirty = true;
    }
    if (p.budget < 1) { if (action.kind === 'place') this.nack(p, action); return; }
    p.budget--;
    if (action.kind === 'buy' && Number.isSafeInteger(action.request)) {
      if (p.retiredRequests.has(action.request)) {
        this.host.send(id, { t: 'bwBuyResult', request: action.request, ok: false, message: 'That purchase was already processed. Refresh the shop for your current items.' });
        return;
      }
      const cached = p.requests.get(action.request);
      if (cached) {
        this.host.send(id, cached.sku === action.sku ? cached.reply : {
          t: 'bwBuyResult', request: action.request, ok: false,
          message: 'That purchase number was already used for a different item.',
        });
        return;
      }
    }
    if (!this.active() || !p.alive || !p.connected || p.eliminated || !this.host.body(id) || this.host.body(id)!.dead) {
      if (action.kind === 'place') this.nack(p, action);
      return;
    }
    if (action.kind === 'stopBreak') { p.mining = undefined; return; }
    if (action.kind === 'buy') { this.buy(p, action.sku, action.request); return; }
    if (action.kind === 'bank') { this.bank(p, action); return; }
    if (!('slot' in action) || !validSlot(action.slot)) { if (action.kind === 'place') this.nack(p, action); return; }
    if (p.selected !== action.slot) p.mining = undefined;
    p.selected = action.slot;
    this.syncHeld(p);
    if (action.kind === 'select') return;
    if (action.kind === 'place' || action.kind === 'break') {
      if (![action.x, action.y, action.z].every(Number.isSafeInteger) || !this.inBounds(action)) { if (action.kind === 'place') this.nack(p, action); return; }
      if (action.kind === 'place') { if (!this.place(p, action)) this.nack(p, action); }
      else this.mine(p, action);
    } else if (action.kind === 'melee') this.melee(p, action.target);
    else if (action.kind === 'shoot' || action.kind === 'use') {
      if (!finite(action.dx, action.dy, action.dz) || !Number.isFinite(Math.hypot(action.dx, action.dy, action.dz)) || Math.hypot(action.dx, action.dy, action.dz) < 0.001) return;
      this.use(p, action);
    }
  }
  private nack(p: BwPlayer, v: BwPos & { prediction?: number }): void { this.host.send(p.id, { t: 'bwNack', x: v.x, y: v.y, z: v.z, prediction: v.prediction }); }
  private inBounds(v: BwPos): boolean { return v.x >= BW_BOUNDS.minX && v.x < BW_BOUNDS.maxX && v.z >= BW_BOUNDS.minZ && v.z < BW_BOUNDS.maxZ && v.y >= BW_MIN_Y && v.y < BW_MAX_Y; }
  private eye(p: BwPlayer): BwPos { const b = this.host.body(p.id)!; return { x: b.x, y: b.y + 1.62, z: b.z }; }
  private reachable(p: BwPlayer, v: BwPos): boolean {
    const eye = this.eye(p), mid = { x: v.x + 0.5, y: v.y + 0.5, z: v.z + 0.5 };
    return bwDistance(eye, mid) <= BW.REACH && bwLine(this.host.getBlock.bind(this.host), eye, mid, v);
  }
  private near(p: BwPlayer, v: BwPos, range: number): boolean {
    const b = this.host.body(p.id)!;
    return bwDistance(b, v) <= range && bwLine(this.host.getBlock.bind(this.host), this.eye(p), { x: v.x, y: v.y + 1.1, z: v.z }, { x: Math.floor(v.x), y: Math.floor(v.y + 1.1), z: Math.floor(v.z) });
  }
  private buy(p: BwPlayer, sku: string, request: number): void {
    if (typeof sku !== 'string' || sku.length > 64 || !Number.isSafeInteger(request) || request < 0) return;
    const e = bwCatalog(sku), base = this.map.bases[p.team], team = this.teams[p.team];
    let message = '', ok = false;
    if (!e) message = 'Unknown item.';
    else if (!this.near(p, e.type === 'upgrade' ? base.upgrades : base.shop, BW.SHOP_REACH)) message = 'Move closer to the shop.';
    else if (e.tier && ((e.type === 'armor' && p.armor >= e.tier) || (e.type === 'sword' && p.sword >= e.tier) || (e.type === 'tool' && p.tools[e.toolKind!] >= e.tier))) message = 'You already have this or better.';
    else if (e.upgrade && team.upgrades[e.upgrade] >= (e.max ?? 1)) message = 'Already at max level.';
    else if (e.type === 'bow' && bwHas(p.slots, 'bow')) message = 'You already have a bow.';
    else {
      const cost = bwPrice(e, team.upgrades), currency = BW_RESOURCE_ITEM[e.resource];
      const trial = bwCloneSlots(p.slots);
      if (bwCount(trial, currency) < cost) message = `Need ${cost} ${BW_RESOURCE_NAME[e.resource].toLowerCase()}.`;
      else {
        bwTake(trial, currency, cost);
        if (e.type !== 'armor' && e.type !== 'upgrade' && !bwGive(trial, e, p.team)) message = 'Your hotbar is full.';
        else {
          p.slots = trial;
          if (e.type === 'armor') p.armor = e.tier!;
          if (e.type === 'sword') p.sword = e.tier!;
          if (e.type === 'tool') p.tools[e.toolKind!] = e.tier!;
          if (e.upgrade) team.upgrades[e.upgrade]++;
          ok = true; message = `Bought ${e.name}.`; this.syncKit(p); this.flushKit(p);
          if (e.upgrade) this.event(`${BW_TEAM_NAMES[p.team]} team bought ${e.name}.`, 'info');
        }
      }
    }
    const reply = { t: 'bwBuyResult' as const, request, ok, message };
    p.requests.set(request, { sku, reply });
    if (p.requests.size > 128) {
      const oldest = p.requests.keys().next().value!;
      p.requests.delete(oldest); p.retiredRequests.add(oldest);
    }
    this.host.send(p.id, reply);
  }
  private bank(p: BwPlayer, a: Extract<BwAction, { kind: 'bank' }>): void {
    if (!BW_RESOURCES.includes(a.resource) || !Number.isSafeInteger(a.amount) || a.amount <= 0 || a.amount > BW.CHEST_CAP || !['deposit', 'withdraw'].includes(a.direction) || !this.near(p, this.map.bases[p.team].chest, BW.CHEST_REACH)) return;
    const chest = this.teams[p.team].chest, item = BW_RESOURCE_ITEM[a.resource];
    if (a.direction === 'deposit') {
      const n = Math.min(a.amount, bwCount(p.slots, item), BW.CHEST_CAP - chest[a.resource]);
      if (n > 0) { bwTake(p.slots, item, n); chest[a.resource] += n; }
    } else {
      const n = Math.min(a.amount, chest[a.resource], bwRoom(p.slots, item));
      if (n > 0) { bwAdd(p.slots, item, n); chest[a.resource] -= n; }
    }
    this.syncKit(p); this.flushKit(p);
  }
  private place(p: BwPlayer, a: Extract<BwAction, { kind: 'place' }>): boolean {
    const slot = p.slots[a.slot], e = slot && bwEntryOf(slot.id);
    if (!e || e.type !== 'block' || p.placeTokens < 1 || this.map.isProtected(a.x, a.y, a.z) || this.map.bedAt(a.x, a.y, a.z) !== null || this.host.getBlock(a.x, a.y, a.z) !== Block.Air || !this.reachable(p, a)) return false;
    if (!bwAttached(this.host.getBlock.bind(this.host), a)) return false;
    // No block inside anyone, the placer included. A client sends its pose
    // just before each placement, so towering is judged where you really are.
    for (const other of this.players.values()) {
      const b = this.host.body(other.id);
      if (other.alive && b && b.x + 0.3 > a.x && b.x - 0.3 < a.x + 1 && b.z + 0.3 > a.z && b.z - 0.3 < a.z + 1 && b.y + 1.8 > a.y && b.y < a.y + 1) return false;
    }
    const block = slot!.id;
    bwConsume(p.slots, a.slot); this.host.setBlock(a.x, a.y, a.z, block);
    this.placed.set(bwKey(a.x, a.y, a.z), { x: a.x, y: a.y, z: a.z, block }); p.placeTokens--; p.shieldUntil = 0; this.syncKit(p);
    return true;
  }
  private breakable(p: BwPlayer, v: BwPos): boolean {
    const bed = this.map.bedAt(v.x, v.y, v.z);
    if (bed !== null) return bed !== p.team && !!this.teams[bed]?.bed;
    return !this.map.isProtected(v.x, v.y, v.z) && this.placed.has(bwKey(v.x, v.y, v.z));
  }
  private mine(p: BwPlayer, a: Extract<BwAction, { kind: 'break' }>): void {
    if (!this.breakable(p, a) || !this.reachable(p, a)) { p.mining = undefined; return; }
    if (p.mining && p.mining.x === a.x && p.mining.y === a.y && p.mining.z === a.z && p.mining.slot === a.slot && this.time - p.mining.heartbeat <= BW.BREAK_HEARTBEAT) { p.mining.heartbeat = this.time; return; }
    const block = this.host.getBlock(a.x, a.y, a.z), bed = this.map.bedAt(a.x, a.y, a.z) !== null;
    const duration = bwBreakSeconds(block, bed, p.slots[a.slot]?.id ?? 0, this.teams[p.team].upgrades.haste);
    p.shieldUntil = 0;
    p.mining = { x: a.x, y: a.y, z: a.z, slot: a.slot, block, began: this.time, heartbeat: this.time, duration };
  }

  // ── Melee ────────────────────────────────────────────────────────────────
  /** Distance along the look ray to a hitbox, or null if it misses. The box is
   *  padded for the attacker's interpolation error. */
  private rayBox(eye: BwPos, dir: BwPos, at: BwPos, reach: number): number | null {
    const min = [at.x - 0.55, at.y - 0.15, at.z - 0.55], max = [at.x + 0.55, at.y + 1.95, at.z + 0.55];
    const o = [eye.x, eye.y, eye.z], d = [dir.x, dir.y, dir.z];
    let enter = 0, exit = reach;
    for (let i = 0; i < 3; i++) {
      if (Math.abs(d[i]) < 1e-9) { if (o[i] < min[i] || o[i] > max[i]) return null; continue; }
      const t1 = (min[i] - o[i]) / d[i], t2 = (max[i] - o[i]) / d[i];
      enter = Math.max(enter, Math.min(t1, t2)); exit = Math.min(exit, Math.max(t1, t2));
      if (enter > exit) return null;
    }
    return enter;
  }
  private melee(p: BwPlayer, target: number): void {
    if (!Number.isSafeInteger(target) || this.time < p.attackAt) return;
    const victim = this.players.get(target), a = this.host.body(p.id);
    if (!victim?.alive || victim.team === p.team || !a || !this.host.body(target) || !finite(a.yaw, a.pitch)) return;
    p.attackAt = this.time + BW.MELEE_GAP;
    const eye = this.eye(p), cp = Math.cos(a.pitch);
    const dir = { x: -Math.sin(a.yaw) * cp, y: Math.sin(a.pitch), z: -Math.cos(a.yaw) * cp };
    const now = this.host.body(target)!;
    // Judge the swing against the target's recent positions, newest first.
    const candidates: BwPos[] = [now, ...[...victim.track].reverse().filter((s) => this.time - s.t <= BW.REWIND)];
    const get = this.host.getBlock.bind(this.host);
    const seen = candidates.find((c) => this.rayBox(eye, dir, c, BW.MELEE_REACH_SERVER) !== null
      && bwLine(get, eye, { x: c.x, y: c.y + 1, z: c.z }));
    if (!seen) return;
    if (this.time - victim.hurtAt < BW.INVULNERABLE) return;
    p.shieldUntil = 0;
    const tier = p.slots[p.selected] ? bwSwordTier(p.slots[p.selected]!.id) : -1;
    // Sprinting and falling are read from the attacker's own recent track.
    const recent = p.track.filter((s) => this.time - s.t <= 0.3);
    const first = recent[0], last = recent[recent.length - 1], span = first && last ? last.t - first.t : 0;
    const speed = span > 0.08 ? Math.hypot(last.x - first.x, last.z - first.z) / span : 0;
    const fall = span > 0.08 ? (last.y - first.y) / span : 0;
    const sprint = speed > 5.1, crit = fall < -2.2 && !bwOnGround(this.host.getBlock.bind(this.host), a);
    const base = (tier < 0 ? 1 : SWORD_DAMAGE[tier]) + this.teams[p.team].upgrades.sharpness;
    const amount = base * (crit ? 1.5 : 1) * (p.trapUntil > this.time ? 0.65 : 1);
    this.damage(victim, amount, p.id, a, sprint ? KNOCK.sprint : KNOCK.walk, false, true, crit, sprint ? KNOCK.sprintLift : KNOCK.lift);
  }
  private damage(p: BwPlayer, amount: number, by: number, from: BwPos, knockback: number, bypassArmor = false, melee = false, crit = false, lift = 4.4): number {
    if (!p.alive || this.time < p.shieldUntil || !this.active()) return 0;
    const armor = bypassArmor ? 0 : Math.min(0.8, ARMOR_REDUCTION[p.armor] + this.teams[p.team].upgrades.protection * 0.04);
    const dealt = Math.min(p.health, Math.max(1, amount * (1 - armor)));
    p.health = Math.max(0, p.health - dealt); p.hurtAt = this.time;
    if (by !== p.id && by >= 0) { p.lastAttacker = by; p.lastHit = this.time; }
    const b = this.host.body(p.id)!; const d = Math.hypot(b.x - from.x, b.z - from.z) || 1;
    this.host.setHealth(p.id, p.health, p.health <= 0);
    const killed = p.health <= 0;
    if (knockback) {
      // Mostly straight away from the attacker, nudged along their facing.
      const attacker = by >= 0 ? this.host.body(by) : undefined;
      let ax = (b.x - from.x) / d, az = (b.z - from.z) / d;
      if (melee && attacker) {
        const lx = -Math.sin(attacker.yaw), lz = -Math.cos(attacker.yaw);
        const nx = ax * 0.75 + lx * 0.25, nz = az * 0.75 + lz * 0.25, nl = Math.hypot(nx, nz) || 1;
        ax = nx / nl; az = nz / nl;
      }
      const kx = ax * knockback, kz = az * knockback, ky = lift;
      this.host.impulse(p.id, kx, ky, kz, by, p.health);
      if (p.bot) this.bots.find((bot) => bot.id === p.id)?.knockback(kx, ky, kz);
    }
    if (by >= 0 && by !== p.id) this.host.send(by, { t: 'hitconfirm', target: p.id, amount: dealt, killed, crit: crit || undefined });
    if (killed) this.kill(p);
    return dealt;
  }
  private kill(p: BwPlayer): void {
    if (!p.alive) return;
    p.alive = false; p.health = 0; p.deaths++; p.mining = undefined; p.healUntil = 0;
    p.eliminated = !this.teams[p.team].bed; p.respawnAt = p.eliminated ? 0 : this.time + BW.RESPAWN;
    const killer = p.lastAttacker !== null && this.time - p.lastHit < 10 ? this.players.get(p.lastAttacker) : undefined;
    const at = this.host.body(p.id);
    const canDrop = at && finite(at.x, at.y, at.z) && at.y >= BW_VOID_Y && this.inBounds(at);
    const carried = BW_RESOURCES.map((r) => ({ item: BW_RESOURCE_ITEM[r], count: bwCount(p.slots, BW_RESOURCE_ITEM[r]) })).filter((v) => v.count > 0);
    const reward = killer && killer.team !== p.team ? killer : undefined;
    if (reward) { reward.kills++; if (p.eliminated) reward.finals++; }
    for (const v of carried) {
      let left = v.count;
      // The killer collects what they earned straight away; whatever does not
      // fit in their hotbar, or has no killer, lands where the body fell.
      if (reward?.alive) left -= bwAdd(reward.slots, v.item, left);
      if (reward) this.syncKit(reward);
      if (left > 0 && canDrop) this.spawnDrop(v.item, left, { x: at.x, y: at.y + 0.9, z: at.z }, { x: 0, y: 3, z: 0 }, -1, 0.5);
    }
    p.slots = Array.from({ length: BW.SLOT_COUNT }, () => null); this.syncKit(p);
    this.host.setHealth(p.id, 0, true);
    // The dead watch from high over their own base instead of the void's fog.
    const base = this.map.bases[p.team];
    this.host.teleport(p.id, base.center.x - base.inward.x * 10, BW_MAX_Y - 10, base.center.z - base.inward.z * 10, base.yaw);
    this.event(`${this.host.name(p.id)} ${killer ? `was defeated by ${this.host.name(killer.id)}` : 'fell into the void'}${p.eliminated ? '. Final kill!' : '.'}`, p.eliminated ? 'danger' : 'info');
    this.checkWinner();
  }
  private destroyBed(team: BwTeam, by?: BwPlayer): void {
    if (!this.teams[team].bed) return;
    this.teams[team].bed = false;
    const base = this.map.bases[team];
    for (const c of [base.bed, base.bedFoot]) this.host.setBlock(c.x, c.y, c.z, Block.Air);
    if (by) { by.beds++; this.event(`${this.host.name(by.id)} destroyed the ${BW_TEAM_NAMES[team]} bed!`, 'danger'); }
    // Teammates already waiting to respawn still get that one last life.
    // Defer winner evaluation until both beds are removed during sudden death.
  }

  // ── Items on the ground ──────────────────────────────────────────────────
  private view(d: Drop): BwDropView { return { id: d.id, item: d.item, count: d.count, x: d.x, y: d.y, z: d.z, vx: d.vx, vy: d.vy, vz: d.vz }; }
  /** A broken block goes straight to the breaker's hotbar, shown to everyone as
   *  the block popping out and flying to them. With no room it stays where it was. */
  private collectBlock(p: BwPlayer, item: number, at: BwPos): void {
    const centre = { x: at.x + 0.5, y: at.y + 0.5, z: at.z + 0.5 };
    if (bwAdd(p.slots, item, 1) > 0) {
      this.syncKit(p);
      const id = this.nextEntity++;
      this.dropAdd.push({ id, item, count: 1, ...centre, vx: 0, vy: 0, vz: 0 });
      this.dropGone.push({ id, by: p.id });
    } else this.spawnDrop(item, 1, centre, { x: 0, y: 3, z: 0 }, -1, 0.4);
  }
  private spawnDrop(item: number, count: number, at: BwPos, vel: BwPos, src: number, lock: number): void {
    if (count <= 0) return;
    if (this.drops.length >= 160) {
      const oldest = this.drops.shift()!;
      this.retire(oldest);
    }
    const d: Drop = { id: this.nextEntity++, item, count, x: at.x, y: at.y, z: at.z, vx: vel.x, vy: vel.y, vz: vel.z, rest: false, src, born: this.time, lock: this.time + lock };
    this.drops.push(d);
    if (src >= 0) this.live.set(src, (this.live.get(src) ?? 0) + count);
    this.dropAdd.push(this.view(d));
  }
  private retire(d: Drop, by?: number, into?: number): void {
    if (d.src >= 0) this.live.set(d.src, Math.max(0, (this.live.get(d.src) ?? 0) - d.count));
    this.dropGone.push({ id: d.id, by, into });
  }
  private tickDrops(): void {
    const get = this.host.getBlock.bind(this.host);
    for (let i = this.drops.length - 1; i >= 0; i--) {
      const d = this.drops[i];
      stepDrop(get, d, STEP);
      if (this.time - d.born >= BW.DROP_LIFETIME || d.y < BW_VOID_Y) { this.drops.splice(i, 1); this.retire(d); }
    }
    // Resting stacks of one kind fold together so a busy generator is one pile.
    if (this.steps % 6 === 0) for (let i = 0; i < this.drops.length; i++) {
      const a = this.drops[i];
      if (!a.rest) continue;
      for (let j = this.drops.length - 1; j > i; j--) {
        const b = this.drops[j];
        if (!b.rest || b.item !== a.item || b.src !== a.src || a.count + b.count > bwMaxStack(a.item)) continue;
        if (Math.hypot(a.x - b.x, a.z - b.z) > 1.05 || Math.abs(a.y - b.y) > 0.8) continue;
        a.count += b.count; this.drops.splice(j, 1);
        this.dropGone.push({ id: b.id, into: a.id });
        this.dropCount.push({ id: a.id, count: a.count });
      }
    }
    for (const p of this.players.values()) {
      const b = this.host.body(p.id);
      if (!p.alive || !p.connected || !b) continue;
      for (let i = this.drops.length - 1; i >= 0; i--) {
        const d = this.drops[i];
        if (this.time < d.lock) continue;
        if (Math.hypot(b.x - d.x, b.z - d.z) > BW.PICKUP_RADIUS || d.y - b.y < -0.5 || d.y - b.y > 2) continue;
        const n = bwAdd(p.slots, d.item, d.count);
        if (!n) continue;
        d.count -= n; if (d.src >= 0) this.live.set(d.src, Math.max(0, (this.live.get(d.src) ?? 0) - n));
        this.syncKit(p);
        // Forge splitting: teammates standing at the same forge get a copy.
        if (d.src >= 0 && this.generators.find((g) => g.id === d.src)?.team === p.team) for (const mate of this.players.values()) {
          const mb = this.host.body(mate.id);
          if (mate === p || mate.team !== p.team || !mate.alive || !mate.connected || !mb || Math.hypot(mb.x - b.x, mb.z - b.z) > 2.5) continue;
          if (bwAdd(mate.slots, d.item, n)) this.syncKit(mate);
        }
        if (d.count <= 0) { this.drops.splice(i, 1); this.dropGone.push({ id: d.id, by: p.id }); }
        else this.dropCount.push({ id: d.id, count: d.count });
      }
    }
  }
  private genSpeed(g: Generator): number {
    return g.team !== undefined ? 1 + this.teams[g.team].upgrades.forge * 0.5
      : 1 + (bwGenTier(g.kind as 'diamond' | 'emerald', this.time) - 1) * 0.45;
  }
  private tickGenerators(): void {
    for (const g of this.generators) {
      g.timer -= STEP * this.genSpeed(g);
      while (g.timer <= 0) {
        g.timer += PERIOD[g.kind];
        if ((this.live.get(g.id) ?? 0) >= PILE[g.kind]) continue;
        // A little pop so the item visibly falls onto the platform.
        this.spawnDrop(BW_RESOURCE_ITEM[g.kind], 1, { x: g.pos.x + (Math.random() - 0.5) * 0.3, y: g.pos.y + 1.1, z: g.pos.z + (Math.random() - 0.5) * 0.3 },
          { x: (Math.random() - 0.5) * 1.4, y: 3.2, z: (Math.random() - 0.5) * 1.4 }, g.id, 0.35);
      }
    }
  }

  private use(p: BwPlayer, a: Extract<BwAction, { kind: 'use' | 'shoot' }>): void {
    const s = p.slots[a.slot], e = s && bwEntryOf(s.id);
    if (!e || this.time < p.useAt) return;
    const len = Math.hypot(a.dx, a.dy, a.dz), direction = { x: a.dx / len, y: a.dy / len, z: a.dz / len };
    let kind: Projectile['kind'], speed: number, damage = 0;
    if (a.kind === 'shoot') {
      if (e.type !== 'bow' || !finite(a.power) || a.power < 0.1 || a.power > 1) return;
      const arrows = p.slots.findIndex((v) => v?.id === Item.BridgeArrow);
      if (arrows < 0) return;
      bwConsume(p.slots, arrows); kind = 'arrow'; speed = 15 + a.power * 25; damage = 3 + a.power * 5;
      p.useAt = this.time + 0.9;
    } else if (e.type === 'heal') {
      if (p.health >= BW.HEALTH || p.healUntil > this.time) return;
      bwConsume(p.slots, a.slot); p.healUntil = this.time + 4; p.useAt = this.time + 1; this.syncKit(p); return;
    } else if (e.type === 'tnt' || e.type === 'pearl') {
      kind = e.type; speed = kind === 'tnt' ? 9 : 24;
      bwConsume(p.slots, a.slot); p.useAt = this.time + (kind === 'pearl' ? 1.5 : 0.8);
    } else return;
    p.shieldUntil = 0;
    const eye = this.eye(p);
    this.projectiles.push({ ...eye, id: this.nextEntity++, kind, owner: p.id, vx: direction.x * speed, vy: direction.y * speed, vz: direction.z * speed, age: 0, damage });
    this.syncKit(p);
  }
  private tickProjectiles(): void {
    for (const shot of [...this.projectiles]) {
      shot.age += STEP;
      if (shot.kind === 'tnt' && shot.age >= 3) { this.explode(shot); this.removeProjectile(shot); continue; }
      if (shot.age > 8 || shot.y < BW_VOID_Y || !this.inBounds(shot)) { this.removeProjectile(shot); continue; }
      const substeps = Math.max(1, Math.ceil(Math.hypot(shot.vx, shot.vy, shot.vz) * STEP / 0.2));
      let remove = false;
      for (let step = 0; step < substeps; step++) {
        const before = { x: shot.x, y: shot.y, z: shot.z };
        shot.vy -= (shot.kind === 'arrow' ? 12 : 18) * STEP / substeps;
        shot.x += shot.vx * STEP / substeps; shot.y += shot.vy * STEP / substeps; shot.z += shot.vz * STEP / substeps;
        const hit = this.projectileHit(before, shot);
        if (hit !== null) {
          // Keep the projectile just outside the actual surface. Sweeping each
          // substep catches thin collision boxes without treating slab air as solid.
          const t = Math.max(0, hit - 0.001 / Math.max(0.001, bwDistance(before, shot)));
          const contact = { x: before.x + (shot.x - before.x) * t, y: before.y + (shot.y - before.y) * t, z: before.z + (shot.z - before.z) * t };
          Object.assign(shot, contact);
          if (shot.kind === 'tnt') { shot.vx *= 0.5; shot.vz *= 0.5; shot.vy = 0; break; }
          if (shot.kind === 'pearl') this.landPearl(shot, contact);
          remove = true; break;
        }
        if (shot.kind === 'arrow') for (const p of this.players.values()) {
          if (!p.alive || p.id === shot.owner || p.team === this.players.get(shot.owner)?.team) continue;
          const b = this.host.body(p.id);
          if (b && Math.abs(shot.x - b.x) < 0.45 && Math.abs(shot.z - b.z) < 0.45 && shot.y >= b.y - 0.1 && shot.y <= b.y + 1.9) {
            this.damage(p, shot.damage, shot.owner, before, 3); remove = true; break;
          }
        }
        if (remove) break;
      }
      if (remove) this.removeProjectile(shot);
    }
  }
  /** Earliest segment intersection with the actual solid sub-boxes of a cell. */
  private projectileHit(from: BwPos, to: BwPos): number | null {
    let first = Infinity;
    for (let x = Math.floor(Math.min(from.x, to.x)); x <= Math.floor(Math.max(from.x, to.x)); x++) {
      for (let y = Math.floor(Math.min(from.y, to.y)); y <= Math.floor(Math.max(from.y, to.y)); y++) {
        for (let z = Math.floor(Math.min(from.z, to.z)); z <= Math.floor(Math.max(from.z, to.z)); z++) {
          for (const [min, max] of collisionBoxes(this.host.getBlock(x, y, z)) ?? []) {
            let enter = 0, exit = 1;
            const start = [from.x - x, from.y - y, from.z - z], delta = [to.x - from.x, to.y - from.y, to.z - from.z];
            for (let axis = 0; axis < 3; axis++) {
              if (Math.abs(delta[axis]) < 1e-10) {
                if (start[axis] < min[axis] || start[axis] >= max[axis]) { exit = -1; break; }
              } else {
                const a = (min[axis] - start[axis]) / delta[axis], b = (max[axis] - start[axis]) / delta[axis];
                enter = Math.max(enter, Math.min(a, b)); exit = Math.min(exit, Math.max(a, b));
              }
            }
            if (enter <= exit && exit > 0 && enter < first) first = enter;
          }
        }
      }
    }
    return first === Infinity ? null : first;
  }
  private removeProjectile(p: Projectile): void { const i = this.projectiles.indexOf(p); if (i >= 0) this.projectiles.splice(i, 1); }
  private landPearl(shot: Projectile, before: BwPos): void {
    const p = this.players.get(shot.owner);
    if (!p?.alive) return;
    const get = this.host.getBlock.bind(this.host);
    const candidates: BwPos[] = [];
    for (let dy = 2; dy >= -3; dy--) for (const [dx, dz] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) candidates.push({ x: Math.floor(before.x) + 0.5 + dx, y: Math.floor(before.y) + dy, z: Math.floor(before.z) + 0.5 + dz });
    candidates.sort((a, b) => bwDistance(a, before) - bwDistance(b, before));
    for (const at of candidates) if (this.inBounds(at) && bwFits(get, at) && isSolid(get(Math.floor(at.x), at.y - 1, Math.floor(at.z))) && bwLine(get, before, { x: at.x, y: at.y + 0.5, z: at.z })) {
      this.host.teleport(p.id, at.x, at.y, at.z, undefined, p.health);
      p.mining = undefined; this.damage(p, 2, p.id, at, 0); return;
    }
  }
  private explode(shot: Projectile): void {
    const blastBlock = (x: number, y: number, z: number): number => {
      const block = this.host.getBlock(x, y, z);
      return block === Block.ManorGlass || !this.placed.has(bwKey(x, y, z)) ? block : Block.Air;
    };
    for (const block of [...this.placed.values()]) {
      const d = bwDistance({ x: block.x + 0.5, y: block.y + 0.5, z: block.z + 0.5 }, shot);
      if (block.block !== Block.ManorGlass && d < (block.block === Block.OakPlanks || block.block === Block.Sandstone ? 2.4 : 3.6) && !this.map.isProtected(block.x, block.y, block.z)
        && bwLine(blastBlock, shot, { x: block.x + 0.5, y: block.y + 0.5, z: block.z + 0.5 }, block)) {
        this.host.setBlock(block.x, block.y, block.z, Block.Air); this.placed.delete(bwKey(block.x, block.y, block.z));
      }
    }
    const owner = this.players.get(shot.owner);
    for (const p of this.players.values()) {
      if (!p.alive || (owner && p.team === owner.team && p.id !== owner.id)) continue;
      const b = this.host.body(p.id);
      if (!b) continue;
      const d = bwDistance(b, shot);
      if (d < 5 && bwLine(this.host.getBlock.bind(this.host), shot, { x: b.x, y: b.y + 1, z: b.z })) this.damage(p, 12 * (1 - d / 6), shot.owner, shot, 9 * (1 - d / 6));
    }
  }
  private checkWinner(): void {
    if (this.isOver() || this.disposed) return;
    const standing = [...new Set([...this.players.values()].filter((p) => !p.eliminated).map((p) => p.team))];
    if (!standing.length) this.finish(null, 'No players remain.');
    else if (standing.length === 1) this.finish(standing[0], `${BW_TEAM_NAMES[standing[0]]} team wins!`);
  }
  private finish(winner: BwTeam | null, reason: string): void {
    if (this.isOver()) return;
    this.phase = 'results'; this.projectiles = [];
    for (const p of this.players.values()) p.mining = undefined;
    this.result = { winner, reason, duration: this.time, players: this.snapshot().players };
    this.host.broadcast({ t: 'bwResult', result: this.result }); this.event(reason, 'good'); this.publish();
  }
  private zoneRadius(): number { return bwZoneRadius(this.time); }
  private syncHeld(p: BwPlayer): void { const body = this.host.body(p.id); if (body) body.held = p.slots[p.selected]?.id ?? 0; }
  private syncKit(p: BwPlayer): void { this.syncHeld(p); p.kitDirty = true; }
  private flushKit(p: BwPlayer): void {
    if (!p.kitDirty) return;
    p.kitDirty = false;
    this.host.send(p.id, { t: 'bwKit', slots: p.slots.map((s) => s ? { ...s } : null), selected: p.selected, placement: p.placement });
  }
  /** Once per step: coalesce everything that changed into a few messages. */
  private flush(): void {
    for (const p of this.players.values()) this.flushKit(p);
    if (this.dropAdd.length || this.dropGone.length || this.dropCount.length) {
      this.host.broadcast({ t: 'bwDrop', add: this.dropAdd.length ? this.dropAdd : undefined, gone: this.dropGone.length ? this.dropGone : undefined, count: this.dropCount.length ? this.dropCount : undefined });
      this.dropAdd = []; this.dropGone = []; this.dropCount = [];
    }
    if (this.projectiles.length || this.sentProjectiles) {
      this.sentProjectiles = this.projectiles.length > 0;
      const list: BwProjectileView[] = this.projectiles.map((p) => ({ id: p.id, kind: p.kind, owner: p.owner, x: p.x, y: p.y, z: p.z, ...(p.kind === 'tnt' ? { fuse: Math.max(0, 3 - p.age) } : {}) }));
      this.host.broadcast({ t: 'bwProj', p: list });
    }
  }
  private event(text: string, tone: 'good' | 'danger' | 'info'): void { this.host.broadcast({ t: 'bwEvent', text, tone }); }
  private publish(): void { this.host.broadcast({ t: 'bwState', s: this.snapshot() }); }
  snapshot(): BwSnapshot {
    const next = BW_SCHEDULE[this.nextEvent];
    return { world: this.setup.world, phase: this.phase, time: this.time, remaining: Math.max(0, BW.END_AT - this.time), countdown: this.phase === 'countdown' ? Math.max(0, this.countdown) : 0,
      bedsIn: Math.max(0, BW.BED_GONE_AT - this.time),
      players: [...this.players.values()].map((p) => ({ id: p.id, name: this.host.name(p.id), team: p.team, bot: p.bot, alive: p.alive, eliminated: p.eliminated, health: p.health,
        respawnIn: p.respawnAt ? Math.max(0, p.respawnAt - this.time) : 0, kills: p.kills, finals: p.finals, deaths: p.deaths, beds: p.beds, armor: p.armor, sword: p.sword, tools: { ...p.tools }, connected: p.connected })),
      teamCount: this.teamCount,
      next: next ? { label: next.label, in: Math.max(0, next.at - this.time) } : null,
      teams: this.teams.map((t, team) => ({ team: team as BwTeam, bed: t.bed, alive: [...this.players.values()].filter((p) => p.team === team && !p.eliminated).length, upgrades: { ...t.upgrades }, chest: { ...t.chest } })),
      safeZone: { active: this.time >= BW.ZONE_AT, x: 0, z: 0, radius: this.zoneRadius(), startsIn: Math.max(0, BW.ZONE_AT - this.time) },
      gens: this.generators.filter((g) => g.team === undefined).map((g) => ({ id: g.id, tier: bwGenTier(g.kind as 'diamond' | 'emerald', this.time), next: Math.max(0, g.timer / this.genSpeed(g)) })),
      breaks: [...this.players.values()].filter((p) => p.mining).map((p) => ({ id: p.id, x: p.mining!.x, y: p.mining!.y, z: p.mining!.z, progress: Math.min(1, (this.time - p.mining!.began) / p.mining!.duration), duration: p.mining!.duration })),
      result: this.result };
  }
  /** Items lying in the world (tests). */
  dropsSnapshot(): BwDropView[] { return this.drops.map((d) => this.view(d)); }
}
