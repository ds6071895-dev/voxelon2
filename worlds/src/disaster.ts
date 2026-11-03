// Disaster City: the match engine, ported from the plugin's DisasterCityGame
// and DisasterSurvival. Everyone spawns round the plaza fountain; a new
// disaster hits every 20 seconds (overlapping up to three at once), the last
// minute is the apocalypse, and whoever is still standing at 5:00 wins. One
// life, no PvP; gather, build, craft and climb to survive.

import { BLOCKS, Block } from './blocks';
import { registerMode, type Edit, type EngineSetup, type ModeEngine, type ModeHost } from './net/mode_engine';
import {
  CITY, DISASTERS, DR, FINALE, citySpawns, disaster, inCity, pickDisaster, waveDuration, waveStart,
  type DisasterKind, type DisasterPhase, type DisasterResult, type DisasterState,
} from './disaster_rules';
import { CITY_BOUNDS } from './disaster_city';
import { createDisaster, type Disaster, type DisasterHost } from './disaster_events';
import { Sim, type SimRules } from './vanilla/sim';
import { VMETA } from './vanilla/blocks';
import { VI, VITEM, vi } from './vanilla/items';
import { ARMOR0, takeOf, type InvState } from './vanilla/inventory_model';
import type { DamageSource } from './vanilla/combat';
import type { MAction, MenuView } from './vanilla/messages';
import type { Entity } from './vanilla/entity';
import type { VStack } from './vanilla/stack';
import { mulberry32 } from './noise';
import { DisasterBot } from './disaster_bot';

const STEP = 0.05;

/** Survival Crafting (DisasterSurvival.Supply): wool, planks, iron ingots, glass. */
export const SUPPLIES = [
  { id: 'BANDAGE', item: 'bandage', label: 'Bandage', help: 'Heal 3 hearts. Right-click to use.', wool: 2, planks: 0, iron: 0, glass: 0 },
  { id: 'FIRE_KIT', item: 'magma_cream', label: 'Fireproof Kit', help: '30s fire resistance; halves acid damage.', wool: 0, planks: 4, iron: 1, glass: 2 },
  { id: 'AIR_TANK', item: 'heart_of_the_sea', label: 'Air Tank', help: '30s water breathing; halves flood damage.', wool: 0, planks: 0, iron: 3, glass: 2 },
  { id: 'PARACHUTE', item: 'feather', label: 'Emergency Parachute', help: '20s slow falling. Use before you land!', wool: 3, planks: 4, iron: 0, glass: 0 },
  { id: 'COAT', item: 'leather_chestplate', label: 'Warm Coat', help: 'Wear it to prevent blizzard freezing.', wool: 4, planks: 2, iron: 0, glass: 0 },
] as const;
const DENY_PLACE = new Set(['tnt', 'bedrock', 'obsidian', 'crying_obsidian', 'fire', 'lava', 'water', 'spawner']);
const isWool = (s: VStack) => /_wool$/.test(VITEM[s.id]?.key ?? '');
const isPlanks = (s: VStack) => /_planks$/.test(VITEM[s.id]?.key ?? '');
const isGlass = (s: VStack) => /(^glass$|_stained_glass$)/.test(VITEM[s.id]?.key ?? '');
const isIron = (s: VStack) => s.id === VI.iron_ingot;
function count(inv: InvState, pred: (s: VStack) => boolean): number {
  let n = 0;
  for (let i = 0; i < 36; i++) { const s = inv.slots[i]; if (s && pred(s)) n += s.count; }
  return n;
}
function deathText(cause: string, kind: DisasterKind | null): string {
  if (kind) {
    switch (kind) {
      case 'meteors': return 'was flattened by a meteor';
      case 'tornado': return 'was swept away by the tornado';
      case 'flood': return 'drowned in the flood';
      case 'tsunami': return 'was swept away by the tsunami';
      case 'acid_rain': return 'dissolved in the acid rain';
      case 'earthquake': return cause === 'void' ? 'fell into a crack' : 'was crushed in the earthquake';
      case 'sinkholes': return 'fell into a sinkhole';
      case 'wildfire': return 'burned in the wildfire';
      case 'zombies': return 'was eaten by zombies';
      case 'lightning': return 'was struck by lightning';
      case 'blizzard': return 'froze in the blizzard';
      case 'gas_leak': return 'was caught in a gas explosion';
    }
  }
  switch (cause) {
    case 'void': return 'fell into the void';
    case 'fall': return 'hit the ground too hard';
    case 'drowning': return 'drowned';
    case 'fire': case 'lava': case 'burning': case 'magma': return 'burned to a crisp';
    case 'explosion': return 'blew up';
    case 'lightning': return 'was struck by lightning';
    case 'freezing': return 'froze solid';
    case 'debris': case 'anvil': return 'was hit by falling debris';
    case 'starvation': return 'starved';
    case 'zombie': case 'husk': return 'was eaten by zombies';
    default: return 'died';
  }
}

export class DisasterMatch implements ModeEngine {
  readonly mode = 'disaster' as const;
  readonly world = { kind: 'disaster' as const, seed: 0 };
  readonly sim: Sim;
  readonly rng: () => number;
  phase: DisasterPhase = 'countdown';
  private phaseTicks: number = DR.COUNTDOWN_TICKS;
  ticks = 0;
  matchTicks = 0;
  wave = 0;
  readonly active: Disaster[] = [];
  private readonly recent: DisasterKind[] = [];
  /** The warned disaster (3 s ahead), visible to everyone. */
  next: DisasterKind | null = null;
  readonly roster = new Map<number, string>();
  readonly alive = new Set<number>();
  private readonly deathOrder: number[] = [];
  private readonly survivedTicks = new Map<number, number>();
  private readonly causes = new Map<number, string>();
  readonly survived = new Map<number, number>();
  private readonly blameKind = new Map<number, DisasterKind>();
  private readonly blameAt = new Map<number, number>();
  private readonly spawns = new Map<number, { x: number; y: number; z: number; yaw: number }>();
  private readonly debrisIds = new Set<number>();
  private winners: number[] = [];
  private result: DisasterResult | undefined;
  private over = false;
  private dusk = false;
  private acc = 0;
  readonly bots: DisasterBot[] = [];
  readonly dh: DisasterHost;

  constructor(readonly host: ModeHost, setup: EngineSetup) {
    this.rng = mulberry32(setup.seed ^ 0xd15a);
    const simHost: ModeHost = Object.assign({}, host, {
      impulse: (id: number, kx: number, ky: number, kz: number, by: number, health: number) => {
        host.impulse(id, kx, ky, kz, by, health);
        this.bots.find((b) => b.id === id)?.knockback(kx, ky, kz);
      },
    });
    this.sim = new Sim(simHost, this.rules(), this.rng);
    this.dh = this.disasterHost();
    const spots = citySpawns();
    for (let i = spots.length - 1; i > 0; i--) { const j = Math.floor(this.rng() * (i + 1)); [spots[i], spots[j]] = [spots[j], spots[i]]; }
    setup.players.forEach((pl, i) => {
      const [sx, sy, sz] = spots[i % spots.length];
      const x = sx + .5, z = sz + .5;
      this.spawns.set(pl.id, { x, y: sy + 1, z, yaw: Math.atan2(-(CITY.PLAZA_X + .5 - x), -(CITY.PLAZA_Z + .5 - z)) });
      this.roster.set(pl.id, host.name(pl.id));
      this.alive.add(pl.id);
      this.survived.set(pl.id, 0);
      const vp = this.sim.addPlayer(pl.id, pl.bot);
      vp.frozen = true;
      vp.hunger.food = 20; vp.hunger.saturation = 5;
      this.kit(vp.inv);
      vp.invDirty = true;
      if (pl.bot) this.bots.push(new DisasterBot(this, pl.id, pl.skill, mulberry32(setup.seed ^ pl.id ^ 0x77)));
    });
  }

  /** DisasterSurvival's starting kit. */
  private kit(inv: InvState): void {
    inv.slots[0] = { id: vi('iron_pickaxe'), count: 1 };
    inv.slots[1] = { id: vi('stone_axe'), count: 1 };
    inv.slots[2] = { id: vi('cobblestone'), count: 16 };
    inv.slots[3] = { id: vi('cooked_beef'), count: 4 };
    inv.slots[8] = { id: VI.survival_book, count: 1, name: 'Survival Crafting', tag: 'survival_book' };
  }

  private rules(): SimRules {
    const box = (x: number, y: number, z: number) => inCity(x, z) && y >= CITY.BUILD_MIN_Y && y <= CITY.BUILD_MAX_Y;
    return {
      pvp: false, hunger: true, naturalRegen: false, fallDamage: true, blockDrops: true, glassSelf: true,
      explosionsBreak: false, fluidsFlow: false,
      canBreak: (id, x, y, z) => this.live() && (id < 0 || this.alive.has(id)) && box(x, y, z),
      canPlace: (id, x, y, z, block) => this.live() && (id < 0 || this.alive.has(id)) && box(x, y, z) && !DENY_PLACE.has(VMETA[block]?.family ?? ''),
      blockedUse: (id) => id === VI.bucket || id === VI.water_bucket || id === VI.lava_bucket || id === VI.powder_snow_bucket || id === VI.flint_and_steel || id === VI.fire_charge,
      onLethal: (id, src) => {
        // Zombies and husks are the horde's, whether or not it's still running.
        if (src.label === 'zombie' || src.label === 'husk') this.blame(id, 'zombies');
        this.eliminate(id, src.label ?? src.kind);
      },
      onMenuItem: (id, stack) => { if (stack.tag === 'survival_book') this.openSupplies(id); },
      onUseItem: (id, stack, slot) => this.useSupply(id, stack, slot),
      isTargetable: (id) => this.alive.has(id),
      mobFollowRange: 64,
      mobDamage: 5,
      // The source's 0.3 is a Java speed attribute, not blocks/tick. Adults walk
      // 3.6 m/s (players walk 4.3) rising to 4.2 in the finale; babies (x1.5)
      // stay just under a sprint.
      mobSpeedMult: () => (.18 + .03 * Math.min(1, Math.max(0, (this.intensity() - 1) / (DR.FINALE_INTENSITY - 1)))) / .23,
      damageScale: (id, src) => this.damageScale(id, src),
    };
  }
  private live(): boolean { return this.phase === 'waves' || this.phase === 'finale'; }
  intensity(): number { return this.phase === 'finale' ? DR.FINALE_INTENSITY : 1 + DR.WAVE_RAMP * this.wave; }
  aliveCount(): number { return Math.max(1, this.alive.size); }

  /** DisasterSurvival.damage: kits halve or cancel disaster damage. */
  private damageScale(id: number, src: DamageSource): number {
    const p = this.sim.players.get(id);
    const kind = src.label as DisasterKind | undefined;
    if (!p || !kind) return 1;
    if ((kind === 'flood' || kind === 'tsunami') && p.effects.has('water_breathing')) return .5;
    if (kind === 'wildfire' && p.effects.has('fire_resistance')) return 0;
    if (kind === 'acid_rain' && p.effects.has('fire_resistance')) return .5;
    return 1;
  }

  // ── ModeEngine ───────────────────────────────────────────────────────────

  spawnOf(id: number) { return this.spawns.get(id) ?? { x: .5, y: CITY.GROUND + 1, z: 7.5, yaw: 0 }; }
  bounds() { return { minX: CITY_BOUNDS.minX, maxX: CITY_BOUNDS.maxX, minY: 0, maxY: 160, minZ: CITY_BOUNDS.minZ, maxZ: CITY_BOUNDS.maxZ }; }
  ready(id: number): void {
    const p = this.sim.players.get(id);
    if (p) { p.invDirty = true; p.selfKey = ''; }
    this.sim.entitySnapshot(id);
    this.publish();
  }
  leave(id: number): void {
    if (this.alive.has(id)) this.eliminate(id, 'void', true);
    this.roster.delete(id);
    this.sim.players.delete(id);
  }
  handle(id: number, a: MAction): void {
    if (!a || typeof a !== 'object') return;
    if (a.k === 'menu' && a.menu === 'supplies') { this.craftSupply(id, String(a.id)); return; }
    if (!this.alive.has(id) && a.k !== 'select') return;
    this.sim.handle(id, a);
  }
  canMove(id: number): boolean { return this.phase !== 'countdown' || !this.alive.has(id); }
  hidden(id: number): boolean { return this.roster.has(id) && !this.alive.has(id); }
  isOver(): boolean { return this.over; }
  lingerSeconds(): number { return 25; }
  botRating(botId: number) {
    const b = this.bots.find((x) => x.id === botId);
    return b ? { rating: b.rating, against: [...this.roster.keys()].filter((id) => !this.host.body(id)?.bot) } : null;
  }
  dispose(): void { for (const d of this.active) d.cleanup(); this.active.length = 0; this.bots.length = 0; }
  tick(dt: number): void {
    this.acc = Math.min(this.acc + dt, .5);
    while (this.acc >= STEP) { this.acc -= STEP; this.step(); }
  }

  // ── Flow ─────────────────────────────────────────────────────────────────

  private step(): void {
    this.ticks++;
    for (const b of this.bots) b.tick(STEP);
    if (this.phase === 'countdown') {
      this.phaseTicks--;
      if (this.phaseTicks % 20 === 0 && this.phaseTicks > 0) {
        this.host.broadcast({ k: 'title', title: 'DISASTER CITY', sub: `Starting in ${this.phaseTicks / 20}…`, color: '#c0182a', ms: 1100 });
        this.sim.sound('pling', undefined, undefined, undefined, .8 + (5 - this.phaseTicks / 20) * .2);
      }
      if (this.phaseTicks <= 0) {
        this.phase = 'waves';
        for (const id of this.alive) this.sim.players.get(id)!.frozen = false;
        this.host.broadcast({ k: 'title', title: 'SURVIVE!', sub: 'The first disaster hits in 8 seconds', color: '#ffaa00', ms: 2000 });
        this.sim.sound('go');
      }
    } else if (this.live()) this.tickLive();
    else if (this.phase === 'over') {
      this.phaseTicks--;
      if (this.phaseTicks % 12 === 0) for (const id of this.winners) {
        const b = this.host.body(id);
        if (b) { const a = this.rng() * Math.PI * 2; this.sim.emit({ f: 'firework', x: b.x + Math.cos(a) * 3, y: b.y + 4, z: b.z + Math.sin(a) * 3, color: [0xffff55, 0xff5555, 0x55ffff, 0x55ff55][Math.floor(this.rng() * 4)] }); }
      }
    }
    this.sim.tick();
    if (this.ticks % 5 === 0) this.publish();
  }

  private tickLive(): void {
    this.matchTicks++;
    if (this.phase === 'waves') {
      if (this.wave < DR.WAVES) {
        const at = waveStart(this.wave);
        if (this.matchTicks === at - DR.WARN_TICKS) {
          this.next = pickDisaster(this.rng, this.recent, this.running());
          const d = disaster(this.next);
          this.host.broadcast({ k: 'title', title: d.label.toUpperCase(), sub: d.tip, color: d.color, ms: 3200 });
          this.host.broadcast({ k: 'feed', text: `${d.label} incoming! ${d.tip}`, tone: 'danger' });
          this.sim.sound('bell');
        }
        if (this.matchTicks === at) {
          this.launch(this.next ?? pickDisaster(this.rng, this.recent, this.running()), waveDuration(this.wave));
          this.next = null;
          this.wave++;
        }
      }
      if (this.matchTicks === DR.FINALE_AT - DR.WARN_TICKS) {
        this.host.broadcast({ k: 'title', title: 'APOCALYPSE', sub: 'Everything at once for the last minute!', color: '#c0182a', ms: 4500 });
        this.sim.sound('wither');
      }
      if (this.matchTicks === DR.FINALE_AT) this.beginFinale();
    }
    for (const d of [...this.active]) {
      if (!this.live()) return;
      try {
        if (!d.stopping) { d.age++; d.tick(); if (d.age >= d.duration) this.end(d); }
        else if (d.finished()) this.active.splice(this.active.indexOf(d), 1);
        else { d.age++; d.wind(); }
      } catch (e) {
        this.active.splice(this.active.indexOf(d), 1);
        try { d.cleanup(); } catch { /* already stopped */ }
        console.warn(`Disaster City: ${d.kind} failed and was stopped`, e);
      }
    }
    if (!this.live()) return;
    for (const id of [...this.alive]) {
      const b = this.host.body(id);
      if (b && b.y < CITY.VOID_Y) { this.eliminate(id, 'void'); if (!this.live()) return; }
    }
    if (this.matchTicks >= DR.MATCH_TICKS) {
      for (const id of this.alive) this.survived.set(id, (this.survived.get(id) ?? 0) + FINALE.length);
      this.finish([...this.alive], this.alive.size ? null : 'Nobody survived - the city won.');
    }
  }
  private running(): DisasterKind[] { return this.active.map((d) => d.kind); }
  private launch(kind: DisasterKind, duration: number): void {
    const d = createDisaster(kind, this.dh, duration);
    this.active.push(d);
    this.recent.push(kind);
    while (this.recent.length > DR.RECENT_MEMORY) this.recent.shift();
    try { d.start(); } catch (e) { console.warn(`Disaster City: ${kind} failed to start`, e); }
    const info = disaster(kind);
    this.host.broadcast({ k: 'bar', text: `${info.label}!`, color: info.color });
    this.sim.sound('thunder');
  }
  /** Duration over: alive players get it counted and 2 hearts back; it winds down. */
  private end(d: Disaster): void {
    d.stopping = true;
    try { d.stop(); } catch (e) { console.warn(`Disaster City: ${d.kind} failed to stop`, e); }
    for (const id of this.alive) {
      this.survived.set(id, (this.survived.get(id) ?? 0) + 1);
      this.sim.heal(id, DR.SURVIVE_HEAL);
      if (this.phase === 'waves') this.host.send(id, { k: 'bar', text: `The ${disaster(d.kind).label.toLowerCase()} is over: +2 hearts. Survived: ${this.survived.get(id)}`, color: '#1f9d5b' });
    }
  }
  private beginFinale(): void {
    this.phase = 'finale';
    for (const d of [...this.active]) if (!d.stopping) this.end(d);
    this.dusk = true;
    const duration = DR.MATCH_TICKS - DR.FINALE_AT;
    for (const kind of FINALE) {
      const d = createDisaster(kind, this.dh, duration + 40);
      this.active.push(d);
      d.start();
    }
    this.host.broadcast({ k: 'feed', text: 'APOCALYPSE! Meteors, lightning, an earthquake and sinkholes - hold on for one more minute!', tone: 'danger' });
  }

  eliminate(id: number, cause: string, left = false): void {
    if (!this.alive.delete(id)) return;
    this.deathOrder.push(id);
    this.survivedTicks.set(id, this.matchTicks);
    const kind = this.ticks - (this.blameAt.get(id) ?? -1e9) <= DR.BLAME_TICKS ? this.blameKind.get(id) ?? null : null;
    const how = deathText(cause, kind);
    this.causes.set(id, how);
    const p = this.sim.players.get(id), b = this.host.body(id);
    if (p) {
      p.inv.slots.fill(null); p.inv.cursor = null; p.invDirty = true;
      p.effects.clear(); p.fire = 0; p.freeze = 0; p.alive = false; p.spectator = true; p.hp = 20; p.win = null;
      this.host.setHealth(id, 20, true);
    }
    if (b) {
      if (b.y >= CITY.VOID_Y) this.host.teleport(id, b.x, b.y + 2, b.z);
      else this.host.teleport(id, CITY.SPECTATE.x, CITY.SPECTATE.y, CITY.SPECTATE.z, CITY.SPECTATE.yaw * Math.PI / 180);
      this.sim.emit({ f: 'lightning', x: b.x, y: b.y, z: b.z });
    }
    const t = Math.ceil(this.matchTicks / 20);
    if (!left) this.host.send(id, { k: 'title', title: "YOU DIDN'T MAKE IT", sub: `You ${how} after ${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`, color: '#ff5555', ms: 3500 });
    this.host.broadcast({ k: 'feed', text: `${this.roster.get(id)} ${how} (${this.alive.size} left)`, tone: 'death' });
    if (!this.live()) return;
    if (this.alive.size === 0) this.finish([], 'Nobody survived - the city won.');
    else if (this.alive.size === 1 && this.roster.size > 1) { const last = [...this.alive][0]; this.finish([last], `${this.roster.get(last)} is the last survivor!`); }
  }
  private finish(survivors: number[], headline: string | null): void {
    if (this.phase === 'over') return;
    this.phase = 'over';
    this.phaseTicks = DR.OVER_TICKS;
    this.winners = survivors;
    for (const d of this.active) d.cleanup();
    this.active.length = 0;
    for (const id of survivors) { const p = this.sim.players.get(id); if (p) { p.godmode = true; p.frozen = true; } }
    const title = survivors.length === 0 ? 'The city won' : survivors.length === 1 ? `${this.roster.get(survivors[0])} survived!` : 'Survivors!';
    this.host.broadcast({ k: 'title', title, sub: headline ?? `${survivors.length} made it to the end`, color: survivors.length ? '#ffaa00' : '#c0182a', ms: 4500 });
    this.sim.sound('toast');
    const ranking = [...survivors];
    for (let i = this.deathOrder.length - 1; i >= 0; i--) if (!ranking.includes(this.deathOrder[i])) ranking.push(this.deathOrder[i]);
    this.result = {
      winners: survivors,
      rows: ranking.filter((id) => this.roster.has(id)).map((id, i) => ({
        id, name: this.roster.get(id)!, place: survivors.includes(id) ? 1 : i + 1, survived: survivors.includes(id),
        seconds: Math.ceil((this.survivedTicks.get(id) ?? this.matchTicks) / 20), cause: survivors.includes(id) ? 'survived' : this.causes.get(id) ?? 'died',
        disasters: this.survived.get(id) ?? 0,
      })),
    };
    this.over = true;
    this.publish();
  }

  // ── Survival Crafting ────────────────────────────────────────────────────

  openSupplies(id: number): void {
    const p = this.sim.players.get(id);
    if (!p || !this.alive.has(id) || !this.live()) { this.host.send(id, { k: 'feed', text: 'Craft supplies after GO while you are alive in Disaster City.', tone: 'warn' }); return; }
    const items: MenuView['items'] = SUPPLIES.map((s) => {
      const cost = [s.wool && `${s.wool} wool`, s.planks && `${s.planks} planks`, s.iron && `${s.iron} iron ingots`, s.glass && `${s.glass} glass`].filter(Boolean).join(', ');
      const can = count(p.inv, isWool) >= s.wool && count(p.inv, isPlanks) >= s.planks && count(p.inv, isIron) >= s.iron && count(p.inv, isGlass) >= s.glass;
      return { id: s.id, icon: vi(s.item), label: s.label, sub: `${s.help} Cost: ${cost}.`, disabled: !can };
    });
    this.host.send(id, { k: 'menu', v: { menu: 'supplies', title: 'Survival Crafting', sub: 'Any colour of wool, any planks and any glass count. Use your inventory (E) or a crafting table for normal recipes: logs → planks, iron blocks → ingots, tools, armour, shields, ladders and boats; smelt sand in a furnace for glass.', items } });
  }
  private craftSupply(id: number, which: string): void {
    const p = this.sim.players.get(id), s = SUPPLIES.find((x) => x.id === which);
    if (!p || !s || !this.alive.has(id) || !this.live()) return;
    if (count(p.inv, isWool) < s.wool || count(p.inv, isPlanks) < s.planks || count(p.inv, isIron) < s.iron || count(p.inv, isGlass) < s.glass) {
      this.host.send(id, { k: 'feed', text: `You need ${[s.wool && `${s.wool} wool`, s.planks && `${s.planks} planks`, s.iron && `${s.iron} iron ingots`, s.glass && `${s.glass} glass`].filter(Boolean).join(', ')}.`, tone: 'warn' });
      return;
    }
    // Work on a copy: a full bag never consumes anything.
    const copy: InvState = { slots: p.inv.slots.map((x) => x ? { ...x } : null), cursor: null };
    takeOf(copy, isWool, s.wool); takeOf(copy, isPlanks, s.planks); takeOf(copy, isIron, s.iron); takeOf(copy, isGlass, s.glass);
    const stack: VStack = { id: vi(s.item), count: 1, name: s.label, tag: `supply:${s.id}` };
    const free = copy.slots.findIndex((x, i) => i < 36 && !x);
    const merge = copy.slots.findIndex((x, i) => i < 36 && x && x.tag === stack.tag && x.count < 64);
    if (free < 0 && merge < 0) { this.host.send(id, { k: 'feed', text: 'Your inventory is full.', tone: 'warn' }); return; }
    if (merge >= 0) copy.slots[merge]!.count++; else copy.slots[free] = stack;
    p.inv.slots = copy.slots; p.invDirty = true;
    this.host.send(id, { k: 'feed', text: `Crafted ${s.label}. ${s.help}`, tone: 'good' });
    this.openSupplies(id);
  }
  private useSupply(id: number, stack: VStack, slot: number): boolean {
    if (!stack.tag?.startsWith('supply:')) return false;
    const p = this.sim.players.get(id);
    if (!p || !this.alive.has(id) || !this.live()) return true;
    switch (stack.tag.slice(7)) {
      case 'BANDAGE':
        if (p.hp >= this.sim.maxHp(id)) { this.host.send(id, { k: 'feed', text: 'You already have full health.', tone: 'warn' }); return true; }
        this.sim.heal(id, 6); break;
      case 'FIRE_KIT': p.fire = 0; this.sim.addEffect(id, 'fire_resistance', 0, 600); break;
      case 'AIR_TANK': p.air = 300; this.sim.addEffect(id, 'water_breathing', 0, 600); break;
      case 'PARACHUTE': this.sim.addEffect(id, 'slow_falling', 0, 400); break;
      case 'COAT': return false; // worn like armour (right-click equips)
      default: return false;
    }
    const cur = p.inv.slots[slot];
    if (cur) { cur.count--; if (cur.count <= 0) p.inv.slots[slot] = null; }
    p.invDirty = true;
    const b = this.host.body(id);
    this.sim.sound('levelup', b?.x, b?.y, b?.z, 1.5);
    return true;
  }

  // ── Hooks the disasters use ──────────────────────────────────────────────

  exposed(id: number): boolean {
    const b = this.host.body(id);
    if (!b) return false;
    const eyeY = Math.floor(b.y + 1.62), x = Math.floor(b.x), z = Math.floor(b.z);
    for (let y = CITY.BUILD_MAX_Y; y > eyeY; y--) { const blk = this.host.getBlock(x, y, z); if (BLOCKS[blk]?.solid || BLOCKS[blk]?.fluid) return false; }
    return true;
  }
  blame(id: number, kind: DisasterKind): void { this.blameKind.set(id, kind); this.blameAt.set(id, this.ticks); }
  private disasterHost(): DisasterHost {
    const m = this;
    return {
      get: (x, y, z) => m.host.getBlock(x, y, z),
      set: (x, y, z, b) => m.sim.setBlock(x, y, z, b),
      setMany: (edits) => { if (edits.length) m.sim.edits(edits); },
      fill: (min, max, block, replace, supported) => m.host.fill({ min, max, block, mask: 'replace', replace, supported }) as Edit[],
      rng: () => m.rng(),
      alive: () => [...m.alive].map((id) => {
        const b = m.host.body(id)!, p = m.sim.players.get(id)!;
        return { id, x: b.x, y: b.y, z: b.z, onGround: p.onGround, eyeY: b.y + 1.62 };
      }).filter((p) => !!p),
      aliveCount: () => m.aliveCount(),
      intensity: () => m.intensity(),
      exposed: (id) => m.exposed(id),
      hurt: (id, amount, kind) => {
        if (!m.alive.has(id)) return;
        const p = m.sim.players.get(id);
        if (p && p.invul > 10) return;
        m.blame(id, kind);
        m.sim.damage(id, { kind: 'generic', amount, label: kind });
      },
      blame: (id, kind) => m.blame(id, kind),
      blameNear: (x, y, z, r, kind) => { for (const id of m.alive) { const b = m.host.body(id); if (b && Math.hypot(b.x - x, b.y - y, b.z - z) <= r) m.blame(id, kind); } },
      velocity: (id, vx, vy, vz, add) => {
        m.host.launch(id, vx * 20, vy * 20, vz * 20, add);
        m.bots.find((b) => b.id === id)?.setVelocity(vx * 20, vy * 20, vz * 20, !!add);
      },
      debris: (x, y, z, vx, vy, vz, kind) => {
        for (const id of [...m.debrisIds]) if (!m.sim.ents.all.has(id)) m.debrisIds.delete(id);
        const id = m.host.getBlock(x, y, z);
        if (m.debrisIds.size >= DR.MAX_DEBRIS || !BLOCKS[id]?.solid || VMETA[id]?.family === 'bedrock') return;
        m.sim.setBlock(x, y, z, Block.Air);
        const e = m.sim.ents.spawn('falling_block', x + .5, y, z + .5, { block: id, vx, vy, vz, data: { debris: true, label: kind } });
        m.debrisIds.add(e.id);
      },
      explode: (x, y, z, power, kind) => {
        for (const id of m.alive) { const b = m.host.body(id); if (b && Math.hypot(b.x - x, b.y - y, b.z - z) < power * 2) m.blame(id, kind); }
        m.sim.explode(x, y, z, power, undefined, false, false);
      },
      lightning: (x, y, z) => m.sim.emit({ f: 'lightning', x, y, z }),
      fx: (f) => m.sim.emit(f),
      display: (variant, x, y, z, data) => m.sim.ents.spawn('display', x, y, z, { data: { variant, ...data } }),
      removeDisplay: (e) => m.sim.ents.remove(e),
      spawnMob: (kind, x, y, z, baby) => m.sim.spawnMob(kind, x, y, z, undefined, { baby, flags: baby ? 2 : 0 }),
      removeMob: (e) => m.sim.ents.remove(e),
      giveCrowbars: () => { for (const id of m.alive) { m.sim.give(id, [{ id: vi('stone_sword'), count: 1, name: 'Crowbar', tag: 'crowbar' }]); const p = m.sim.players.get(id); if (p) p.received--; } },
      takeCrowbars: () => { for (const id of m.alive) { const p = m.sim.players.get(id); if (!p) continue; for (let i = 0; i < 41; i++) if (p.inv.slots[i]?.tag === 'crowbar') p.inv.slots[i] = null; p.invDirty = true; } },
      freeze: (id, add, cap) => { const p = m.sim.players.get(id); if (!p) return 0; p.freeze = Math.max(0, Math.min(cap, p.freeze + add)); return p.freeze; },
      warm: (id) => m.sim.players.get(id)?.inv.slots[ARMOR0 + 1]?.id === VI.leather_chestplate,
      inBoat: (id) => (m.sim.players.get(id)?.riding ?? null) !== null,
      bar: (text, color) => m.host.broadcast({ k: 'bar', text, color }),
    };
  }

  private publish(): void {
    const now = this.host.nowMs();
    const left = this.phase === 'countdown' ? this.phaseTicks : DR.MATCH_TICKS - this.matchTicks;
    let nextAt: number | null = null, nextLabel = '';
    if (this.phase === 'waves') {
      if (this.wave < DR.WAVES && waveStart(this.wave) < DR.FINALE_AT) { nextAt = now + (waveStart(this.wave) - this.matchTicks) * 50; nextLabel = this.next ? disaster(this.next).label : 'Next disaster'; }
      else { nextAt = now + (DR.FINALE_AT - this.matchTicks) * 50; nextLabel = 'Apocalypse'; }
    }
    const kinds = this.active.filter((d) => !d.stopping).map((d) => d.kind);
    const weather = kinds.includes('lightning') ? 'thunder' : kinds.includes('acid_rain') ? 'acid' : kinds.includes('blizzard') ? 'snow' : 'clear';
    const s: DisasterState = {
      mode: 'disaster', serverNow: now, phase: this.phase, endsAt: now + Math.max(0, left) * 50, nextAt, nextLabel, wave: this.wave,
      active: this.active.filter((d) => !d.stopping).map((d) => ({ id: d.kind, endsAt: now + (d.duration - d.age) * 50 })),
      weather, dusk: this.dusk,
      players: [...this.roster].map(([id, name]) => ({ id, name, alive: this.alive.has(id), disasters: this.survived.get(id) ?? 0 })),
      result: this.result,
    };
    this.host.broadcast({ k: 'state', s });
  }
}
void DISASTERS;
void ({} as Entity);

registerMode({
  mode: 'disaster',
  title: 'Disaster City',
  world: () => ({ kind: 'disaster', seed: 0 }),
  create: (host, setup) => new DisasterMatch(host, setup),
});
