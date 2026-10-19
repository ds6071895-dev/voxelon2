// The Bedwars practice opponent. It plays through exactly the same action gate
// as a human (buy, place, break, melee, shoot, use) and moves with the same
// Player physics, so it sprints, jumps, takes knockback and falls into the void
// like anyone else.
//
// What makes it a real opponent:
//  - Skill (0..1) sets bridging speed, block clutches and planning; fighting
//    (reaction, aim, clicking, reach, strafing, W-taps, crits, bow) runs on
//    `pvp`, a much lower share of it, so its sword never outclasses a decent
//    player even once fully adapted. It starts from what the
//    bot last learned about this player and keeps adapting during the match:
//    it climbs fast when the human is winning and eases off when it is far
//    ahead, so a strong player meets a strong bot.
//  - A plan (rush, eco, turtle or hybrid) picked per life with some chance, a
//    random approach side, and reactions to what the human does (an early rush
//    makes it defend; a fortress gets TNT and a pickaxe), so no two matches
//    play out the same way.
import { Block, isSolid } from './blocks';
import { Item } from './items';
import { Player } from './player';
import { FROZEN_INPUT, type PlayerInput } from './input';
import type { PhysicsWorld } from './physics_world';
import { BW_Y } from './bedwars_map';
import type { BedwarsMatch, BwPlayer } from './bedwars';
import { BW, BW_RESOURCE_ITEM, bwToolOf, type BwPos, type BwResource, type BwTeam } from './bedwars_rules';
import { bwCatalog, bwPrice } from './bedwars_catalog';
import { bwCount, bwHas } from './bedwars_inventory';
import { bwDistance, bwKey, bwLine, bwPath } from './bedwars_nav';
import { bwAttached } from './bedwars_geometry';
import { bwZoneRadius } from './bedwars_rules';

type Goal = 'forge' | 'shop' | 'defend' | 'diamond' | 'emerald' | 'upgrade' | 'attack' | 'hunt' | 'guard' | 'center';
type Plan = 'rush' | 'eco' | 'turtle' | 'hybrid';

/** Walking height: the islands' top surface. */
const STAND = BW_Y + 1;
const clamp = (v: number, a: number, b: number): number => Math.max(a, Math.min(b, v));
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const angleTo = (from: number, to: number): number => {
  let d = to - from;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
};
const BW_BOT_START_SKILL = 0.5;
const SKILL_MIN = 0.2, SKILL_MAX = 1;

export class BedwarsBot {
  goal: Goal = 'forge';
  plan: Plan = 'hybrid';
  skill: number;
  readonly body: Player;
  private readonly world: PhysicsWorld;
  private readonly baseline: number;
  private request = 1;
  private path: BwPos[] = [];
  private pathKey = '';
  private replanAt = 0;
  private thinkAt = 0;
  private adaptAt = 6;
  /** Cells the bot found it could not stand in, so the planner routes around. */
  private readonly avoid = new Set<number>();
  private wasAlive = false;
  private input: PlayerInput = { ...FROZEN_INPUT };
  private swing = false;
  private held = 0;
  // Aim: where it looks and a slowly drifting error that shrinks with skill.
  private pitch = 0;
  private aimNoiseYaw = 0;
  private aimNoisePitch = 0;
  // Combat rhythm.
  private foeId = -1;
  private foeSeenAt = -1;
  private nextClickAt = 0;
  private strafeDir = 1;
  private strafeUntil = 0;
  private wtapUntil = 0;
  private drawStart = -1;
  private lastFoePos: { x: number; z: number } | null = null;
  // Building.
  private placeAt = 0;
  /** The enemy team being attacked. */
  private target: BwTeam | null = null;
  private defenseUntil = 0;
  private defenseDone = false;
  private approach = 0;
  private tntWaitUntil = 0;
  // Progress tracking (stuck detection) and learned facts about the opponent.
  private progressAt = 0;
  /** When the current goal turned out to have no route (no wool to bridge). */
  private strandedAt = -1;
  private progressPos = { x: 0, z: 0 };
  private rushedAt = -1;
  private diamondTrips = 0;
  private lastDeaths = 0;
  private lastFoeDeaths = 0;

  constructor(readonly match: BedwarsMatch, readonly id: number, learned?: number, private readonly rng: () => number = Math.random) {
    this.baseline = clamp(learned ?? BW_BOT_START_SKILL, SKILL_MIN, SKILL_MAX);
    this.skill = this.baseline;
    const at = match.host.body(id);
    this.body = new Player(at ? { x: at.x, y: at.y, z: at.z } : { x: 0, y: STAND, z: 0 });
    this.body.energyDrainMult = 0;
    this.body.damageSink = () => {}; // the match owns health; no fall damage
    this.world = { getBlock: (x: number, y: number, z: number) => match.host.getBlock(x, y, z), isLoaded: () => true };
    this.choosePlan();
  }

  /** What to remember for this player's next Bedwars bot. */
  get rating(): number { return clamp(this.baseline * 0.35 + this.skill * 0.65, SKILL_MIN, SKILL_MAX); }

  knockback(x: number, y: number, z: number): void {
    this.body.applyKnockback(x, y, z);
    this.path = []; this.replanAt = 0;
  }

  tick(dt: number): void {
    const m = this.match, p = m.players.get(this.id), hb = m.host.body(this.id);
    if (!p || !hb) return;
    if (!p.alive) { this.wasAlive = false; this.path = []; return; }
    const b = this.body;
    // Spawns, pearls and test setups move the server body: follow them.
    if (!this.wasAlive || Math.hypot(hb.x - b.pos.x, hb.y - b.pos.y, hb.z - b.pos.z) > 0.6) {
      b.pos.set(hb.x, hb.y, hb.z); b.vel.set(0, 0, 0); b.yaw = hb.yaw; b.momentumTime = 0;
      if (!this.wasAlive) this.respawned();
      this.wasAlive = true;
    }
    this.adapt();
    this.input = { ...FROZEN_INPUT };
    this.swing = false;
    this.held = p.slots[p.selected]?.id ?? 0;
    const actions: (() => void)[] = [];
    this.decide(p, actions);
    b.update(dt, this.input, this.world);
    m.host.drive(this.id, { x: b.pos.x, y: b.pos.y, z: b.pos.z, yaw: b.yaw, pitch: this.pitch, held: this.held, swing: this.swing, sneaking: b.sneaking });
    // Actions are judged from the pose just published, like a human's.
    for (const act of actions) act();
  }

  // ── Skill ────────────────────────────────────────────────────────────────
  /** Fighting skill: a fraction of the overall one, so even a fully adapted
   *  bot bridges, buys and plans well but fights like an average player. */
  private get pvp(): number { return this.skill * 0.4; }
  private get reaction(): number { return lerp(0.55, 0.22, this.pvp / 0.4); }
  private get turnRate(): number { return lerp(5, 24, this.skill); }
  /** Turning speed while tracking a foe (building aim keeps turnRate). */
  private get combatTurnRate(): number { return lerp(3.5, 8, this.pvp / 0.4); }
  private get cps(): number { return lerp(2.6, 4.2, this.pvp / 0.4); }
  /** Share of swings that connect: the server's padded hitbox forgives the
   *  aim error, so misses are rolled to keep its damage well under a player's. */
  private get hitChance(): number { return lerp(0.2, 0.35, this.pvp / 0.4); }

  /** Lean toward whoever is behind: quickly up when the human leads, gently
   *  down when the bot is running away with it. */
  private adapt(): void {
    const m = this.match;
    if (m.time < this.adaptAt) return;
    this.adaptAt = m.time + 5;
    const me = m.players.get(this.id)!;
    const foes = [...m.players.values()].filter((v) => v.team !== me.team && !v.bot);
    if (!foes.length) return;
    const theirKills = foes.reduce((n, f) => n + f.kills + f.finals * 2, 0), myKills = me.kills + me.finals * 2;
    let lead = theirKills - myKills;
    if (!m.teams[me.team].bed) lead += 3;
    lead -= 3 * me.beds;
    const gear = foes.reduce((n, f) => Math.max(n, f.armor + f.sword), 0) - (me.armor + me.sword);
    lead += gear * 0.5;
    const step = lead > 0 ? clamp(lead * 0.035, 0, 0.09) : clamp(lead * 0.02, -0.05, 0);
    this.skill = clamp(this.skill + step, SKILL_MIN, SKILL_MAX);
    // Each fight lost teaches it something too.
    if (me.deaths > this.lastDeaths) { this.skill = clamp(this.skill + 0.04 * (me.deaths - this.lastDeaths), SKILL_MIN, SKILL_MAX); this.lastDeaths = me.deaths; }
    const foeDeaths = foes.reduce((n, f) => n + f.deaths, 0);
    if (foeDeaths > this.lastFoeDeaths) { this.skill = clamp(this.skill - 0.015 * (foeDeaths - this.lastFoeDeaths), SKILL_MIN, SKILL_MAX); this.lastFoeDeaths = foeDeaths; }
  }

  private choosePlan(): void {
    const r = this.rng(), s = this.skill, rushed = this.rushedAt >= 0;
    // Rushing is a bold opener; a bot that was rushed turtles more often.
    const weights: [Plan, number][] = [
      ['rush', rushed ? 0.12 : 0.18 + s * 0.22], ['eco', 0.25], ['turtle', rushed ? 0.4 : 0.15], ['hybrid', 0.35],
    ];
    let acc = 0;
    const total = weights.reduce((n, [, w]) => n + w, 0);
    for (const [plan, w] of weights) { acc += w / total; if (r <= acc) { this.plan = plan; break; } }
    this.approach = (this.rng() - 0.5) * 2;
  }

  private respawned(): void {
    this.goal = 'shop'; this.path = []; this.pathKey = ''; this.foeId = -1; this.target = null; this.drawStart = -1; this.lastFoePos = null;
    // Variety: a new life may try a different plan; a turtle re-checks its shell.
    if (this.rng() < 0.35) this.choosePlan();
    if (this.plan === 'turtle') { this.defenseDone = false; this.defenseUntil = 0; }
  }

  // ── Decisions ────────────────────────────────────────────────────────────
  private decide(p: BwPlayer, actions: (() => void)[]): void {
    const m = this.match, b = this.body, base = m.map.bases[p.team];
    const pos = b.pos;
    // A clutch first: falling off an edge with blocks in hand.
    if (this.clutch(p, actions)) return;
    if (p.health <= 9 && p.healUntil <= m.time) {
      const apple = p.slots.findIndex((s) => s?.id === Item.HealingApple);
      if (apple >= 0) actions.push(() => m.handle(this.id, { kind: 'use', slot: apple, dx: 0, dy: 1, dz: 0 }));
    }
    // Rushers: notice a human near our bed early and remember it.
    const foes = [...m.players.values()].filter((v) => v.alive && v.team !== p.team && m.host.body(v.id));
    for (const f of foes) {
      const fb = m.host.body(f.id)!;
      if (m.teams[p.team].bed && bwDistance(fb, base.bed) < 12 && this.rushedAt < 0 && m.time < 150) this.rushedAt = m.time;
    }
    const foe = this.pickFoe(p, foes);
    if (m.time >= BW.ZONE_AT && Math.hypot(pos.x, pos.z) > Math.max(6, this.zoneRadius() - 4)) this.goal = 'center';
    if (foe && this.fight(p, foe, actions)) return;
    if (this.bow(p, foes, actions)) return;

    if (m.time >= this.thinkAt) { this.thinkAt = m.time + 0.3 + this.rng() * 0.2; this.think(p); }
    switch (this.goal) {
      case 'center': this.moveTo(p, { x: 0.5, y: STAND, z: 0.5 }, actions); break;
      case 'forge': this.moveTo(p, base.forge, actions, 0.6); break;
      case 'shop':
        if (bwDistance(pos, base.shop) > 3) { this.moveTo(p, base.shop, actions); break; }
        this.shop(p); this.goal = this.nextGoal(p); break;
      case 'upgrade':
        if (bwDistance(pos, base.upgrades) > 3) { this.moveTo(p, base.upgrades, actions); break; }
        this.upgrades(p); this.goal = 'shop'; break;
      case 'defend': this.defend(p, actions); break;
      case 'guard': {
        // Stand between the bed and the way in, ready to meet anyone coming.
        const mid = this.bedMid(p.team);
        const at = { x: mid.x + base.inward.x * 3.5 - base.inward.z * this.approach * 2, y: STAND, z: mid.z + base.inward.z * 3.5 + base.inward.x * this.approach * 2 };
        this.moveTo(p, at, actions, 0.8);
        break;
      }
      case 'diamond': {
        const g = m.map.generators.filter((v) => v.kind === 'diamond').sort((a, c) => bwDistance(base.center, a.pos) - bwDistance(base.center, c.pos))[this.diamondTrips % 2];
        if (!g) { this.goal = 'attack'; break; }
        this.moveTo(p, g.pos, actions, 0.5);
        break;
      }
      case 'emerald': {
        const g = m.map.generators.filter((v) => v.kind === 'emerald').sort((a, c) => bwDistance(pos, a.pos) - bwDistance(pos, c.pos))[0];
        if (!g) { this.goal = 'attack'; break; }
        this.moveTo(p, g.pos, actions, 0.5);
        break;
      }
      case 'attack': this.attack(p, actions); break;
      case 'hunt': {
        const target = foes.map((f) => m.host.body(f.id)!).sort((a, c) => bwDistance(pos, a) - bwDistance(pos, c))[0];
        if (target) this.moveTo(p, target, actions);
        else if (this.target !== null) this.moveTo(p, m.map.bases[this.target].center, actions);
        break;
      }
    }
  }

  /** Goal changes that are not reactions to a foe. */
  private think(p: BwPlayer): void {
    const m = this.match;
    // No route to where it was going: restock, or at least head home.
    if (this.strandedAt >= 0 && m.time - this.strandedAt > 2) {
      this.strandedAt = -1;
      this.goal = this.have(p, 'iron') >= 4 ? 'shop' : this.goal === 'forge' ? 'center' : 'forge';
      return;
    }
    const iron = this.have(p, 'iron'), gold = this.have(p, 'gold'), dia = this.have(p, 'diamond'), em = this.have(p, 'emerald');
    const wool = this.wool(p);
    switch (this.goal) {
      case 'forge': {
        const want = this.plan === 'rush' ? 14 : this.plan === 'eco' || this.plan === 'turtle' ? 30 : 22;
        const goldWant = this.plan === 'rush' ? 0 : p.armor < 2 ? 12 : p.sword < 2 ? 7 : 0;
        if (iron >= want && gold >= goldWant) this.goal = 'shop';
        else if (iron >= 48) this.goal = 'shop';
        break;
      }
      case 'diamond':
        if (dia >= (this.plan === 'eco' ? 6 : 4) || (m.time > 300 && dia >= 2)) { this.diamondTrips++; this.goal = 'upgrade'; }
        break;
      case 'emerald':
        if (em >= (p.armor < 3 ? 6 : 4)) this.goal = 'shop';
        break;
      case 'attack': case 'hunt':
        if (wool < 6 && !this.nearEnemyIsland(p)) this.goal = 'forge';
        if (this.goal === 'attack' && this.target !== null && !m.teams[this.target]?.bed) { this.target = this.pickTarget(p); if (this.target === null) this.goal = 'hunt'; }
        break;
      case 'guard':
        // Turtles go out once they have the gear, or when the enemy is down.
        if ((p.armor >= 2 && p.sword >= 2) || m.time > 330 || this.foesDown(p)) this.goal = this.nextGoal(p);
        break;
    }
  }

  private nextGoal(p: BwPlayer): Goal {
    const m = this.match, wool = this.wool(p), anyBed = this.pickTarget(p) !== null;
    if (wool < 8) return 'forge';
    if (this.plan === 'rush' && anyBed && m.time < 180) return 'attack';
    if (m.teams[p.team].bed && !this.defenseDone && !this.bedCovered(p.team)) return 'defend';
    if (this.have(p, 'diamond') >= 2) return 'upgrade';
    if (!anyBed) return 'hunt';
    const rushed = this.rushedAt >= 0;
    if (this.plan === 'rush') return 'attack';
    if ((this.plan === 'turtle' || rushed) && (p.armor < 2 || p.sword < 2) && m.time < 330) {
      return this.have(p, 'iron') < 30 && this.goal !== 'forge' ? 'forge' : 'guard';
    }
    // Opportunism: three minutes in, an enemy who is no better geared than us
    // is not worth farming against. Go now.
    const foeGear = Math.max(0, ...[...m.players.values()].filter((v) => v.team !== p.team).map((v) => v.armor + v.sword));
    if (m.time > 180 && p.armor + p.sword >= foeGear) return 'attack';
    if (this.plan === 'eco' && this.diamondTrips < 2 && m.time < 420) return 'diamond';
    if (this.diamondTrips < 1 && m.time < 360) return 'diamond';
    if (p.armor < 3 && m.time > 240 && this.rng() < 0.4) return 'emerald';
    return 'attack';
  }

  // ── Shopping ─────────────────────────────────────────────────────────────
  private shop(p: BwPlayer): void {
    const m = this.match, target = this.target ?? this.pickTarget(p);
    const fortress = target !== null && this.defenseAround(target) >= 10;
    const buy = (sku: string, n = 1): void => { for (let i = 0; i < n; i++) this.buy(p, sku); };
    if (this.plan === 'rush' && m.time < 120) {
      buy('wool', 3);
      if (!p.sword) buy('stone_sword');
      return;
    }
    if (!p.sword) buy('stone_sword');
    if (p.armor < 2 && this.have(p, 'gold') >= 12) buy('iron_armor');
    if (p.sword < 2 && this.have(p, 'gold') >= 7) buy('iron_sword');
    if (this.have(p, 'emerald') >= 6 && p.armor < 3) buy('diamond_armor');
    else if (this.have(p, 'emerald') >= 4 && p.sword < 3 && p.armor >= 3) buy('diamond_sword');
    // A fortress gets a pickaxe/axe/shears and TNT; otherwise shears for wool.
    if (!p.tools.pickaxe && (fortress || this.plan !== 'rush')) buy('tools');
    if (fortress && p.tools.pickaxe < 2) buy('iron_tools');
    if (!p.tools.shears && this.have(p, 'iron') >= 24) buy('shears');
    if (!p.tools.axe && fortress && this.skill > 0.5) buy('wood_axe');
    if ((fortress || this.skill > 0.6) && !bwHas(p.slots, 'tnt') && this.have(p, 'gold') >= 4) buy('tnt');
    if (!bwHas(p.slots, 'heal') && this.have(p, 'gold') >= 3) buy('heal');
    if (this.skill > 0.45 && !bwHas(p.slots, 'bow') && this.have(p, 'gold') >= 14) { buy('bow'); buy('arrows'); }
    if (p.armor < 1 && this.have(p, 'iron') >= 34) buy('chain_armor');
    for (let i = 0; i < 4 && this.wool(p) < 64 && this.have(p, 'iron') >= 4; i++) buy('wool');
    // Defense blocks for a careful bot.
    if (m.teams[p.team].bed && (this.plan === 'turtle' || this.skill > 0.6) && this.have(p, 'gold') >= 4 && !this.has(p, Block.OakPlanks)) buy('wood');
  }
  private upgrades(p: BwPlayer): void {
    const up = this.match.teams[p.team].upgrades;
    const order: string[] = this.plan === 'eco' ? ['forge', 'sharpness', 'protection', 'heal_pool', 'trap'] : ['sharpness', 'protection', 'trap', 'forge', 'haste'];
    for (const sku of order) {
      const e = bwCatalog(sku)!;
      if (up[e.upgrade!] < (e.max ?? 1)) this.buy(p, sku);
    }
  }
  private buy(p: BwPlayer, sku: string): void {
    const e = bwCatalog(sku);
    if (e && this.have(p, e.resource) >= bwPrice(e, this.match.teams[p.team].upgrades)) this.match.handle(this.id, { kind: 'buy', sku, request: this.request++ });
  }

  // ── Fighting ─────────────────────────────────────────────────────────────
  private pickFoe(p: BwPlayer, foes: BwPlayer[]): BwPlayer | null {
    const m = this.match, pos = this.body.pos, base = m.map.bases[p.team];
    const range = lerp(7, 13, this.skill) + (this.goal === 'guard' || this.goal === 'hunt' ? 10 : 0);
    let best: BwPlayer | null = null, bestScore = Infinity;
    for (const f of foes) {
      const fb = m.host.body(f.id)!;
      const d = bwDistance(pos, fb);
      // An intruder at our bed is always the business.
      const atBed = m.teams[p.team].bed && bwDistance(fb, base.bed) < 10;
      if (d > range && !(atBed && d < 40)) continue;
      if (Math.abs(fb.y - pos.y) > 6) continue;
      const score = d - (atBed ? 20 : 0) + f.health * 0.2;
      if (score < bestScore) { bestScore = score; best = f; }
    }
    if (best && best.id !== this.foeId) { this.foeId = best.id; this.foeSeenAt = m.time; }
    if (!best) this.foeId = -1;
    return best;
  }

  /** Closes in, aims and swings. Returns false while still "reacting". */
  private fight(p: BwPlayer, foe: BwPlayer, actions: (() => void)[]): boolean {
    const m = this.match, b = this.body, fb = m.host.body(foe.id)!;
    if (m.time - this.foeSeenAt < this.reaction) return false;
    const d = Math.hypot(fb.x - b.pos.x, fb.z - b.pos.z);
    const sword = p.slots.findIndex((s) => s && [Item.WoodSword, Item.StoneSword, Item.IronSword, Item.DiamondSword].includes(s.id));
    const slot = sword >= 0 ? sword : 0;
    this.held = p.slots[slot]?.id ?? 0;
    // Aim at the chest with a little lead on their movement.
    const lead = this.reaction * 0.6;
    const tx = fb.x + (this.lastFoePos ? (fb.x - this.lastFoePos.x) / 0.05 * lead : 0);
    const tz = fb.z + (this.lastFoePos ? (fb.z - this.lastFoePos.z) / 0.05 * lead : 0);
    this.lastFoePos = { x: fb.x, z: fb.z };
    this.aimAt({ x: tx, y: fb.y + 1.25, z: tz }, 0.14, this.combatTurnRate);
    // Shorter than a player's 3.2 reach, so trades at range go to the human.
    const reach = 2.6;
    if (d > 2.6) {
      // Close the gap; across void, walk the path (it bridges).
      if (!this.floorBetween(b.pos, fb)) { this.moveTo(p, fb, actions); this.aimAt({ x: tx, y: fb.y + 1.25, z: tz }, 0.14, this.combatTurnRate); }
      else { this.input.forward = true; this.input.sprintKey = true; }
    } else {
      // In range: keep pressure without walking into them.
      this.input.forward = d > 1.7 && m.time >= this.wtapUntil;
      this.input.sprintKey = this.input.forward;
      if (d < 1.2) this.input.back = true;
    }
    // Strafing and jump-crits, kept off the edges.
    if (this.pvp > 0.2 && d < 5) {
      if (m.time >= this.strafeUntil) { this.strafeDir = this.rng() < 0.5 ? -1 : 1; this.strafeUntil = m.time + lerp(1.6, 0.9, this.pvp / 0.4) + this.rng() * 0.5; }
      const side = this.strafeDir;
      const rx = Math.cos(b.yaw) * side, rz = -Math.sin(b.yaw) * side;
      if (this.floorAt(b.pos.x + rx * 1.1, b.pos.z + rz * 1.1)) { if (side > 0) this.input.right = true; else this.input.left = true; }
      else this.strafeDir = -side;
    }
    if (this.pvp > 0.3 && d > 2.4 && d < 3.6 && b.onGround && this.rng() < this.pvp * 0.05) this.input.jump = true;
    // Never step forward off an edge chasing someone.
    const fx = -Math.sin(b.yaw), fz = -Math.cos(b.yaw);
    if (this.input.forward && !this.floorAt(b.pos.x + fx * 0.9, b.pos.z + fz * 0.9) && this.floorBetween(b.pos, fb) === false) {
      this.input.forward = false; this.input.sneak = true;
    }
    if (d <= reach + 0.3 && m.time >= this.nextClickAt) {
      this.nextClickAt = m.time + (1 / this.cps) * (0.8 + this.rng() * 0.4);
      this.swing = true;
      const before = foe.health;
      if (this.rng() >= this.hitChance) return true;
      actions.push(() => {
        m.handle(this.id, { kind: 'melee', target: foe.id, slot });
        // W-tap: let go of forward a moment after a landed hit to re-sprint.
        if (foe.health < before && this.pvp > 0.35 && this.rng() < 0.5) this.wtapUntil = m.time + 0.12;
      });
    }
    return true;
  }

  /** Shoot at a foe out of sword range, standing still on solid ground. */
  private bow(p: BwPlayer, foes: BwPlayer[], actions: (() => void)[]): boolean {
    const m = this.match, b = this.body;
    if (this.pvp < 0.3) return false;
    const bow = p.slots.findIndex((s) => s?.id === Item.BridgeBow);
    if (bow < 0 || bwCount(p.slots, Item.BridgeArrow) <= 0) { this.drawStart = -1; return false; }
    const eye = { x: b.pos.x, y: b.pos.y + 1.62, z: b.pos.z };
    const target = foes.map((f) => m.host.body(f.id)!).find((fb) => {
      const d = bwDistance(b.pos, fb);
      return d > 9 && d < 34 && bwLine((x, y, z) => m.host.getBlock(x, y, z), eye, { x: fb.x, y: fb.y + 1.2, z: fb.z });
    });
    if (!target) { this.drawStart = -1; return false; }
    if (this.goal === 'forge' || this.goal === 'shop' || this.goal === 'upgrade') return false;
    this.held = Item.BridgeBow;
    const d = Math.hypot(target.x - eye.x, target.z - eye.z), dy = target.y + 1.1 - eye.y;
    const speed = 24 + 38, g = BW.ARROW_GRAVITY;
    // Low-arc ballistic pitch for this range.
    const v2 = speed * speed, disc = v2 * v2 - g * (g * d * d + 2 * dy * v2);
    if (disc < 0) return false;
    const pitch = Math.atan((v2 - Math.sqrt(disc)) / (g * d));
    const yaw = Math.atan2(-(target.x - eye.x), -(target.z - eye.z));
    this.turnTo(yaw, pitch, 0.09);
    if (this.drawStart < 0) this.drawStart = m.time;
    if (m.time - this.drawStart >= 0.95) {
      this.drawStart = -1;
      const cp = Math.cos(this.pitch);
      const dir = { x: -Math.sin(b.yaw) * cp, y: Math.sin(this.pitch), z: -Math.cos(b.yaw) * cp };
      actions.push(() => m.handle(this.id, { kind: 'shoot', slot: bow, dx: dir.x, dy: dir.y, dz: dir.z, power: 1 }));
    }
    return true;
  }

  /** Knocked off with blocks in hand: look down and save yourself. */
  private clutch(p: BwPlayer, actions: (() => void)[]): boolean {
    const b = this.body;
    if (this.skill < 0.6 || b.onGround || b.vel.y > 0 || b.pos.y < STAND + 0.02 || b.pos.y > STAND + 0.6) return false;
    const slot = this.woolSlot(p);
    if (slot < 0) return false;
    const x = Math.floor(b.pos.x), z = Math.floor(b.pos.z);
    if (this.floorAt(b.pos.x, b.pos.z)) return false;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      if (!isSolid(this.match.host.getBlock(x + dx, BW_Y, z + dz))) continue;
      this.held = p.slots[slot]!.id;
      this.turnTo(b.yaw, -1.35, 0);
      this.placeCell({ x, y: BW_Y, z }, slot, actions, true);
      return true;
    }
    return false;
  }

  // ── Bed defense and attack ───────────────────────────────────────────────
  /** Centre of a team's two bed cells, at bed height. */
  private bedMid(team: BwTeam): BwPos {
    const base = this.match.map.bases[team];
    return { x: (base.bed.x + base.bedFoot.x) / 2 + 0.5, y: base.bed.y + 0.5, z: (base.bed.z + base.bedFoot.z) / 2 + 0.5 };
  }
  /** Shell layer `n` around a bed: cells whose distance from the bed's two
   *  cells (across, along, up) is exactly n. Works for any bed orientation. */
  private defenseCells(team: BwTeam, layers: number): BwPos[] {
    const base = this.match.map.bases[team], cells = [base.bed, base.bedFoot], out: BwPos[] = [];
    const minX = Math.min(base.bed.x, base.bedFoot.x), maxX = Math.max(base.bed.x, base.bedFoot.x);
    const minZ = Math.min(base.bed.z, base.bedFoot.z), maxZ = Math.max(base.bed.z, base.bedFoot.z);
    for (let x = minX - layers; x <= maxX + layers; x++)
      for (let z = minZ - layers; z <= maxZ + layers; z++)
        for (let y = STAND; y <= STAND + layers; y++) {
          const layer = Math.min(...cells.map((c) => Math.abs(x - c.x) + Math.abs(z - c.z))) + (y - STAND);
          if (layer < 1 || layer > layers) continue;
          if (this.match.map.bedAt(x, y, z) !== null || this.match.map.isProtected(x, y, z)) continue;
          out.push({ x, y, z });
        }
    return out.sort((a, c) => this.layerOf(team, a) - this.layerOf(team, c));
  }
  private layerOf(team: BwTeam, c: BwPos): number {
    const base = this.match.map.bases[team];
    return Math.min(...[base.bed, base.bedFoot].map((v) => Math.abs(c.x - v.x) + Math.abs(c.z - v.z))) + (c.y - STAND);
  }
  private bedCovered(team: BwTeam): boolean {
    return this.defenseCells(team, 1).every((c) => isSolid(this.match.host.getBlock(c.x, c.y, c.z)));
  }
  private defenseAround(team: BwTeam): number {
    let n = 0;
    for (const c of this.defenseCells(team, 3)) if (this.match.placed.has(bwKey(c.x, c.y, c.z))) n++;
    return n;
  }
  private defend(p: BwPlayer, actions: (() => void)[]): void {
    const m = this.match, mid = this.bedMid(p.team);
    if (this.defenseUntil === 0) this.defenseUntil = m.time + lerp(20, 40, this.skill);
    const layers = this.plan === 'turtle' || this.skill > 0.7 ? 3 : this.skill > 0.4 ? 2 : 1;
    const cells = this.defenseCells(p.team, layers);
    const missing = cells.find((c) => !isSolid(m.host.getBlock(c.x, c.y, c.z)) && this.supported(c));
    if (!missing || m.time > this.defenseUntil || this.wool(p) + bwCount(p.slots, Block.OakPlanks) < 4) { this.defenseDone = true; this.goal = this.nextGoal(p); return; }
    // Outer layers in the strongest blocks it carries.
    const layer = this.layerOf(p.team, missing);
    let slot = layer >= 2 ? p.slots.findIndex((s) => s?.id === Block.OakPlanks || s?.id === Block.Sandstone) : -1;
    if (slot < 0) slot = this.woolSlot(p);
    if (slot < 0) { this.goal = 'forge'; return; }
    // Stand just outside the shell on the side of the missing block, so the
    // finished inner layer never hides it.
    const ox = missing.x + 0.5 - mid.x, oz = missing.z + 0.5 - mid.z, ol = Math.hypot(ox, oz) || 1;
    const out = layers + 1.6 - Math.min(layers, layer);
    const stand = { x: missing.x + 0.5 + ox / ol * out, y: STAND, z: missing.z + 0.5 + oz / ol * out };
    const eye = { x: this.body.pos.x, y: this.body.pos.y + 1.62, z: this.body.pos.z }, cell = { x: missing.x + 0.5, y: missing.y + 0.5, z: missing.z + 0.5 };
    const canReach = bwDistance(eye, cell) < 4.6 && bwLine((x, y, z) => m.host.getBlock(x, y, z), eye, cell, missing);
    if (!canReach) { this.moveTo(p, stand, actions, 0.45); return; }
    this.aimAt(cell, 0);
    this.held = p.slots[slot]!.id;
    this.placeCell(missing, slot, actions, false);
  }
  /** The enemy team this bot is going after: a rusher takes the nearest bed,
   *  others the weakest team still standing. */
  private pickTarget(p: BwPlayer): BwTeam | null {
    const m = this.match, home = m.map.bases[p.team].center;
    const options: { team: BwTeam; score: number }[] = [];
    for (let t = 0; t < m.teamCount; t++) {
      if (t === p.team || !m.teams[t].bed) continue;
      const members = [...m.players.values()].filter((v) => v.team === t && !v.eliminated);
      if (!members.length) continue;
      const gear = members.reduce((n, v) => n + v.armor + v.sword + (v.alive ? 0 : -1), 0) / members.length;
      const dist = bwDistance(home, m.map.bases[t].center);
      const score = this.plan === 'rush' ? dist : dist * 0.3 + gear * 12 + members.length * 8 + this.rng() * 10;
      options.push({ team: t, score });
    }
    options.sort((a, c) => a.score - c.score);
    return options[0]?.team ?? null;
  }
  private attack(p: BwPlayer, actions: (() => void)[]): void {
    const m = this.match, b = this.body;
    if (this.target === null || !m.teams[this.target]?.bed) this.target = this.pickTarget(p);
    const enemy = this.target;
    if (enemy === null) { this.goal = 'hunt'; return; }
    const base = m.map.bases[enemy], target = this.bedMid(enemy);
    const lateral = { x: -base.inward.z, z: base.inward.x };
    if (m.time < this.tntWaitUntil) {
      // Wait out our own TNT a few blocks back toward the middle.
      this.moveTo(p, { x: target.x + base.inward.x * 6, y: STAND, z: target.z + base.inward.z * 6 }, actions, 0.6); return;
    }
    const d = bwDistance(b.pos, target);
    if (d < 4.4) {
      const eye = { x: b.pos.x, y: b.pos.y + 1.62, z: b.pos.z };
      // TNT against a fortress.
      const tnt = p.slots.findIndex((s) => s?.id === Item.BedwarsTNT);
      if (tnt >= 0 && this.defenseAround(enemy) >= 8 && d > 2.5) {
        this.aimAt(target, 0);
        const cp = Math.cos(this.pitch);
        actions.push(() => m.handle(this.id, { kind: 'use', slot: tnt, dx: -Math.sin(b.yaw) * cp, dy: Math.sin(this.pitch), dz: -Math.cos(b.yaw) * cp }));
        this.tntWaitUntil = m.time + 3.4; return;
      }
      // Mine the first defense on the line to the bed, then the bed.
      let hit: BwPos = { ...base.bed };
      const steps = Math.ceil(bwDistance(eye, target) * 15);
      for (let i = 1; i <= steps; i++) {
        const v = { x: Math.floor(eye.x + (target.x - eye.x) * i / steps), y: Math.floor(eye.y + (target.y - eye.y) * i / steps), z: Math.floor(eye.z + (target.z - eye.z) * i / steps) };
        if (isSolid(m.host.getBlock(v.x, v.y, v.z)) || m.map.bedAt(v.x, v.y, v.z) !== null) { hit = v; break; }
      }
      const block = m.host.getBlock(hit.x, hit.y, hit.z);
      if (m.placed.has(bwKey(hit.x, hit.y, hit.z)) || m.map.bedAt(hit.x, hit.y, hit.z) === enemy) {
        const slot = this.miningSlot(p, block);
        this.held = p.slots[slot]?.id ?? 0;
        this.aimAt({ x: hit.x + 0.5, y: hit.y + 0.5, z: hit.z + 0.5 }, 0);
        this.swing = true;
        actions.push(() => m.handle(this.id, { kind: 'break', ...hit, slot }));
        return;
      }
    }
    // Come in from the middle's side, offset to the side the plan chose.
    const side = Math.round(this.approach * 2);
    const at = d < 7 ? target : { x: target.x + base.inward.x * 2.5 + lateral.x * side, y: STAND, z: target.z + base.inward.z * 2.5 + lateral.z * side };
    this.moveTo(p, at, actions, 0.6);
  }

  // ── Movement, bridging and mining through walls ──────────────────────────
  /** Follows a planned path, bridging over gaps and mining placed walls. */
  private moveTo(p: BwPlayer, target: BwPos, actions: (() => void)[], arrive = 1.0): void {
    const m = this.match, b = this.body, pos = b.pos, get = (x: number, y: number, z: number) => m.host.getBlock(x, y, z);
    if (Math.hypot(target.x - pos.x, target.z - pos.z) < arrive) { this.path = []; return; }
    const key = `${Math.floor(target.x)},${Math.floor(target.z)}`;
    if (key !== this.pathKey || m.time >= this.replanAt || !this.path.length) {
      this.path = bwPath(get, pos, target, (x, y, z) => m.placed.has(bwKey(x, y, z)), (x, z) => this.avoid.has(bwKey(x, 0, z)), this.wool(p) >= 3);
      this.pathKey = key; this.replanAt = m.time + 2.5;
      this.progressAt = m.time; this.progressPos = { x: pos.x, z: pos.z };
    }
    while (this.path.length && Math.hypot(this.path[0].x - pos.x, this.path[0].z - pos.z) < 0.3) this.path.shift();
    const next = this.path[0];
    if (!next) {
      // The planner got as close as it can. Right next to the goal (a
      // generator's own cell is solid) that is arriving; far off it is stranded.
      if (Math.hypot(target.x - pos.x, target.z - pos.z) > 2.5 && this.strandedAt < 0) this.strandedAt = m.time;
      return;
    }
    this.strandedAt = -1;
    const cell = { x: Math.floor(next.x), z: Math.floor(next.z) };
    // A placed wall in the way: mine it with the right tool.
    for (const y of [STAND, STAND + 1]) if (isSolid(get(cell.x, y, cell.z))) {
      if (!m.placed.has(bwKey(cell.x, y, cell.z))) { this.replanAt = 0; return; }
      const slot = this.miningSlot(p, get(cell.x, y, cell.z));
      this.held = p.slots[slot]?.id ?? 0;
      this.aimAt({ x: cell.x + 0.5, y: y + 0.5, z: cell.z + 0.5 }, 0);
      this.swing = true; this.progressAt = m.time;
      actions.push(() => m.handle(this.id, { kind: 'break', x: cell.x, y, z: cell.z, slot }));
      return;
    }
    // Bridging: fill the floor ahead, a few cells out for a skilled bot.
    const gap = this.path.slice(0, this.skill > 0.75 ? 3 : this.skill > 0.45 ? 2 : 1)
      .map((c) => ({ x: Math.floor(c.x), y: BW_Y, z: Math.floor(c.z) }))
      .find((c) => !isSolid(get(c.x, c.y, c.z)));
    // Never cut a corner over the void: if the straight line to the next cell
    // leaves the floor, line up on the centre of the current cell first.
    const here = { x: Math.floor(pos.x) + 0.5, z: Math.floor(pos.z) + 0.5 };
    const aim = !gap && !this.floorBetween(pos, next) && Math.hypot(here.x - pos.x, here.z - pos.z) > 0.15 ? { ...next, ...here } : next;
    const yaw = Math.atan2(-(aim.x - pos.x), -(aim.z - pos.z));
    if (gap) {
      const slot = this.woolSlot(p);
      if (slot < 0) { this.goal = 'forge'; this.path = []; return; }
      this.held = p.slots[slot]!.id;
      const nextMissing = !isSolid(get(cell.x, BW_Y, cell.z));
      // Edge safety: sneak while the very next step is still air (a careful
      // bot always does; a skilled one only when it falls behind).
      this.input.sneak = nextMissing && (this.skill < 0.6 || bwDistance(pos, { x: cell.x + 0.5, y: pos.y, z: cell.z + 0.5 }) < 1.15);
      this.input.forward = !nextMissing || this.input.sneak;
      this.turnTo(yaw, -0.9, 0);
      this.placeCell(gap, slot, actions, false);
      this.progressAt = m.time;
      return;
    }
    // Stuck while walking: avoid that cell, hop, and replan.
    if (Math.hypot(pos.x - this.progressPos.x, pos.z - this.progressPos.z) > 0.6) { this.progressAt = m.time; this.progressPos = { x: pos.x, z: pos.z }; }
    else if (m.time - this.progressAt > 1.4) {
      this.avoid.add(bwKey(Math.floor(next.x), 0, Math.floor(next.z)));
      if (b.onGround) this.input.jump = true;
      this.replanAt = 0; this.progressAt = m.time;
    }
    this.turnTo(yaw, 0, 0.02);
    // Face first, then walk: no striding off sideways while still turning.
    this.input.forward = Math.abs(angleTo(b.yaw, yaw)) < 0.9;
    // Sprint only down a straight run of floor.
    const run = this.path.slice(0, 3);
    this.input.sprintKey = aim === next && run.length === 3 && run.every((c) => Math.abs(c.x - next.x) < 0.1 || Math.abs(c.z - next.z) < 0.1)
      && run.every((c) => this.floorAt(c.x, c.z));
    // Hop up a one-block step the physics cannot walk.
    const fx = pos.x - Math.sin(b.yaw) * 0.55, fz = pos.z - Math.cos(b.yaw) * 0.55;
    if (b.onGround && isSolid(get(Math.floor(fx), Math.floor(pos.y + 0.1), Math.floor(fz))) && !isSolid(get(Math.floor(fx), Math.floor(pos.y + 1.1), Math.floor(fz)))) this.input.jump = true;
  }

  private placeCell(cell: BwPos, slot: number, actions: (() => void)[], urgent: boolean): void {
    const m = this.match;
    if (m.time < this.placeAt) return;
    const interval = urgent ? 0.05 : lerp(0.4, 0.09, this.skill) * (0.85 + this.rng() * 0.3);
    this.placeAt = m.time + interval;
    this.swing = true;
    actions.push(() => m.handle(this.id, { kind: 'place', x: cell.x, y: cell.y, z: cell.z, slot }));
  }

  // ── Aim ──────────────────────────────────────────────────────────────────
  private aimAt(t: BwPos, noise: number, rate = this.turnRate): void {
    const b = this.body, eye = { x: b.pos.x, y: b.pos.y + 1.62, z: b.pos.z };
    const yaw = Math.atan2(-(t.x - eye.x), -(t.z - eye.z));
    const pitch = Math.atan2(t.y - eye.y, Math.hypot(t.x - eye.x, t.z - eye.z));
    this.turnTo(yaw, pitch, noise, rate);
  }
  /** Turns toward a look direction at a skill-limited rate, with a drifting
   *  error so aim is never pixel-perfect on a weaker bot. */
  private turnTo(yaw: number, pitch: number, noise: number, rate = this.turnRate): void {
    const err = noise * lerp(4.2, 0.35, this.skill);
    this.aimNoiseYaw += ((this.rng() - 0.5) * 2 * err - this.aimNoiseYaw) * 0.15;
    this.aimNoisePitch += ((this.rng() - 0.5) * err - this.aimNoisePitch) * 0.15;
    const step = rate * 0.05;
    const dy = angleTo(this.body.yaw, yaw + this.aimNoiseYaw);
    this.body.yaw += clamp(dy, -step, step);
    this.pitch += clamp(pitch + this.aimNoisePitch - this.pitch, -step, step);
    this.pitch = clamp(this.pitch, -1.5, 1.5);
  }

  // ── Small queries ───────────────────────────────────────────────────────
  private floorAt(x: number, z: number): boolean { return isSolid(this.match.host.getBlock(Math.floor(x), BW_Y, Math.floor(z))); }
  /** True when there is floor all the way along the straight line between two points. */
  private floorBetween(a: BwPos, c: BwPos): boolean {
    const n = Math.ceil(Math.hypot(c.x - a.x, c.z - a.z) * 2);
    for (let i = 1; i <= n; i++) if (!this.floorAt(a.x + (c.x - a.x) * i / n, a.z + (c.z - a.z) * i / n)) return false;
    return true;
  }
  private supported(c: BwPos): boolean {
    const get = (x: number, y: number, z: number) => this.match.host.getBlock(x, y, z);
    return bwAttached(get, c);
  }
  private nearEnemyIsland(p: BwPlayer): boolean {
    return this.match.map.bases.some((b) => b.team !== p.team && b.team < this.match.teamCount && bwDistance(this.body.pos, b.center) < 22);
  }
  private foesDown(p: BwPlayer): boolean { return [...this.match.players.values()].every((v) => v.team === p.team || !v.alive); }
  private zoneRadius(): number { return bwZoneRadius(this.match.time); }
  private have(p: BwPlayer, r: BwResource): number { return bwCount(p.slots, BW_RESOURCE_ITEM[r]); }
  private has(p: BwPlayer, item: number): boolean { return bwCount(p.slots, item) > 0; }
  private wool(p: BwPlayer): number { return bwCount(p.slots, Block.TeamWoolA) + bwCount(p.slots, Block.TeamWoolB); }
  private woolSlot(p: BwPlayer): number { return p.slots.findIndex((s) => s?.id === Block.TeamWoolA || s?.id === Block.TeamWoolB); }
  private miningSlot(p: BwPlayer, block: number): number {
    const kind = block === Block.OakPlanks ? 'axe' : block === Block.Sandstone ? 'pickaxe' : 'shears';
    const slot = p.slots.findIndex((s) => s && bwToolOf(s.id)?.kind === kind);
    if (slot >= 0) return slot;
    // Any tool beats a sword on glass or a bed; the pickaxe is a fine fallback.
    const any = p.slots.findIndex((s) => s && bwToolOf(s.id));
    return any >= 0 ? any : 0;
  }
}
