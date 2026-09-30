// Rat and Seek — the authoritative match engine (server only, but pure: no
// Node APIs, so tests drive it headlessly). A port of the AutoBox plugin's
// RatSeekGame and its helpers (abilities, gadgets, house life), played with
// the plugin's Normal rules and no host settings.
//
// One seeker hunts half-sized rats through the Crooked Manor. Rats score by
// stealing cheese and taunting, trade cheese at the Cheese Exchange to free
// a caged friend or bank an escape, and win if anyone is still free when the
// clock runs out. The seeker is a person from the party, or a practice
// seeker (ratseek_bot.ts) that adapts to how the rats are doing.
//
// Worlds changes from the plugin: the villager is the Cheese Exchange, there
// are no host menus, a rat's class choice is remembered between games, and
// the house twists lean with the game — more Spotlights while the rats run
// away with it, more Ghost Rats while they are losing. Nobody is told that.

import { Block, collisionBoxes, pointInSolid } from './blocks';
import { Item, type ItemStack } from './items';
import type { ServerMsg } from './net/protocol';
import {
  RS_CAGE, RS_KEEPER, RS_PODIUM, RS_PODIUM_CROWD, RS_RELEASE, RS_WAITING, rsHouse, rsPassageAt, rsRoomAt, type RsPassage, type RsPos,
} from './ratseek_house';
import { clearLine, rsSeekerNav, rsSmallNav, seeThrough } from './ratseek_nav';
import {
  RAT_CLASSES, RAT_CLASS_IDS, RS, ratClassCap, type RatClassId, type RsAward, type RsEffects, type RsPhase,
  type RsPlayerView, type RsResult, type RsRole, type RsSnapshot, type RsSound,
} from './ratseek_rules';
import { SeekerBot } from './ratseek_bot';

const TICK_MS = 50;

export interface RsBody { x: number; y: number; z: number; yaw: number; pitch: number; sneaking: boolean }
export interface RsPose extends RsBody { held: number; swing: boolean }

/** What the engine needs from the server that runs it. */
export interface RsHost {
  nowMs(): number;
  body(id: number): RsBody | undefined;
  name(id: number): string;
  /** Deliver to a person (practice seekers have no socket; the host drops those). */
  send(id: number, msg: ServerMsg): void;
  teleport(id: number, x: number, y: number, z: number, yaw?: number): void;
  setBlock(x: number, y: number, z: number, block: number): void;
  getBlock(x: number, y: number, z: number): number;
  /** Move a practice seeker's body. */
  drive(id: number, pose: RsPose): void;
  /** Bring a new AI seeker body into this world; returns its id. */
  addBot(): number;
  /** Take an AI seeker body out of this world. */
  dropBot(id: number): void;
}

export interface RsSetup {
  /** People who hunt (0 or 1 of them in Worlds). */
  humans: number[];
  /** Practice seekers' body ids (0 or 1). */
  bots: number[];
  /** People who hide. */
  rats: number[];
  /** Classes the rats last picked. */
  classes: Map<number, RatClassId>;
  /** The practice seeker's starting level, from how these rats have played before. */
  skill: number;
  /** A party host (party of 2+) who may change the seeker during the prep time. */
  leader?: number;
}

type Effect = 'speed' | 'slow' | 'glow' | 'invis' | 'blind' | 'dark' | 'jump' | 'nausea' | 'night';
interface Kit {
  lightOn: boolean;
  battery: number;
  traps: number;
  baits: number;
  trapRefills: number[];
  baitRefills: number[];
}
interface CheeseItem { id: number; x: number; y: number; z: number; bait: boolean; owner: number; pickupAt: number }
interface Decoy { id: number; owner: number; x: number; y: number; z: number; sx: number; sz: number; ticks: number; yaw: number }
interface Trap { owner: number; x: number; y: number; z: number }
interface Chandelier { hang: RsPos; lever: RsPos; puller: number; warning: number; rehang: number; up: boolean }
interface Cat {
  x: number; y: number; z: number; yaw: number;
  path: [number, number, number][] | null; pathIndex: number;
  nap: number; distraction: RsPos | null; distractionTicks: number; pounceFx: number; target: number;
}

export type RsTwist = 'blackout' | 'rat_rave' | 'cheese_rain' | 'hunter_frenzy' | 'bouncy_house' | 'ghost_rats' | 'spotlight';
const TWISTS: RsTwist[] = ['blackout', 'rat_rave', 'cheese_rain', 'hunter_frenzy', 'bouncy_house', 'ghost_rats', 'spotlight'];
const TWIST_NAMES: Record<RsTwist, string> = {
  blackout: 'Blackout', rat_rave: 'Rat Rave', cheese_rain: 'Cheese Rain', hunter_frenzy: "Hunter's Frenzy",
  bouncy_house: 'Bouncy House', ghost_rats: 'Ghost Rats', spotlight: 'Spotlight',
};

const GOLD = '#f5c542', RED = '#ff6b6b', GREEN = '#6fe08a', AQUA = '#5ed1f0', GRAY = '#aab4c3', YELLOW = '#ffe27a',
  PURPLE = '#d38af0', WHITE = '#f4f6fb';

function centre(p: RsPos): RsPos { return { x: p.x + 0.5, y: p.y, z: p.z + 0.5 }; }
function dist2(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): number {
  return (a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2;
}
function cellKey(x: number, y: number, z: number): number { return ((y + 64) * 4096 + (z + 2048)) * 4096 + (x + 2048); }

export class RatSeekMatch {
  phase: RsPhase = 'loading';
  private phaseTicks = 0;
  ticks = 0;
  private acc = 0;
  private readonly startedAt: number;
  private huntStartTick = 0;
  /** People in the match (rats and human seekers), never practice seekers. */
  readonly people = new Set<number>();
  private readonly loaded = new Set<number>();
  readonly humans = new Set<number>();
  readonly botIds = new Set<number>();
  readonly rats = new Map<number, 'free' | 'caged'>();
  private readonly points = new Map<number, number>();
  private readonly carried = new Map<number, number>();
  private readonly tauntReady = new Map<number, number>();
  private readonly dashReady = new Map<number, number>();
  private readonly rattleReady = new Map<number, number>();
  private readonly combos = new Map<number, number>();
  private readonly comboUntil = new Map<number, number>();
  private readonly escapes = new Map<number, number>();
  private readonly passageTicks = new Map<number, number>();
  private readonly passageOf = new Map<number, RsPassage>();
  private readonly perchTicks = new Map<number, number>();
  private readonly cageOrder: number[] = [];
  private readonly catchesBy = new Map<number, number>();
  private readonly tauntsBy = new Map<number, number>();
  private readonly escapesBy = new Map<number, number>();
  private readonly cheeseGrabbed = new Map<number, number>();
  private fastest: { catcher: number; victim: string; ticks: number } | null = null;
  private readonly effects = new Map<number, Map<Effect, { until: number; amp: number }>>();
  private readonly fxSent = new Map<number, string>();
  private readonly kitSent = new Map<number, string>();
  private readonly compass = new Map<number, { x: number; y: number; z: number }>();
  /** Which rat a seeker's compass is following, and until when (live, not a stale spot). */
  private readonly compassRat = new Map<number, number>();
  private readonly compassUntil = new Map<number, number>();
  private readonly compassReady = new Map<number, number>();
  // Cheese.
  private cheese: CheeseItem[] = [];
  private cheeseRespawns: number[] = [];
  private nextEntity = 1;
  // Seeker kit.
  private readonly kits = new Map<number, Kit>();
  private readonly traps = new Map<number, Trap>();
  private readonly spotted = new Map<number, number>();
  // Rat classes.
  readonly classes = new Map<number, RatClassId>();
  private readonly abilityReady = new Map<number, number>();
  private readonly whiskersUntil = new Map<number, number>();
  decoys: Decoy[] = [];
  // House life.
  private readonly chandeliers: Chandelier[] = [];
  cat: Cat | null = null;
  // Timers.
  private hintTicks = 400;
  private scentReadyAt = 0;
  private twistTicks = 0;
  private lastTwist: RsTwist | null = null;
  private twistBanner = '';
  private twistBannerUntil = 0;
  private lastRatRush = false;
  /** How much pressure the seekers are putting on the rats right now (decays). */
  private heat = 0;
  readonly seekerBots: SeekerBot[] = [];
  result: RsResult | null = null;
  /** The party host holding the "Who seeks?" pick, if any. */
  readonly leader: number | null;
  private readonly botSkillStart: number;
  private readonly motion = new Map<number, { x: number; z: number; px: number; pz: number; speed: number }>();

  constructor(private readonly host: RsHost, private readonly rng: () => number, setup: RsSetup) {
    this.startedAt = host.nowMs();
    this.leader = setup.leader ?? null;
    this.botSkillStart = setup.skill;
    for (const id of setup.humans) { this.humans.add(id); this.people.add(id); }
    for (const id of setup.rats) {
      this.people.add(id);
      this.rats.set(id, 'free');
      this.points.set(id, 0);
      this.carried.set(id, 0);
    }
    for (const id of setup.bots) {
      this.botIds.add(id);
      this.seekerBots.push(new SeekerBot(this, id, setup.skill, rng));
    }
    // Remembered class picks, within the cap.
    const cap = ratClassCap(this.rats.size);
    for (const id of setup.rats) {
      const want = setup.classes.get(id);
      if (want && this.classCount(want) < cap) this.classes.set(id, want);
    }
    const h = rsHouse();
    for (let i = 0; i < h.chandeliers.length; i++) {
      this.chandeliers.push({ hang: h.chandeliers[i], lever: h.chandelierLevers[i], puller: -1, warning: 0, rehang: 0, up: false });
    }
    this.placeEveryone();
    for (let i = 0; i < RS.MAX_CHEESE; i++) this.spawnCheese();
    rsSeekerNav(); rsSmallNav();
  }

  // ── Public surface for the server ─────────────────────────────────────────

  roleOf(id: number): RsRole | null {
    return this.rats.has(id) ? 'rat' : this.humans.has(id) || this.botIds.has(id) ? 'human' : null;
  }
  /** Where a body starts, for the arena message. */
  spawnOf(id: number): { x: number; y: number; z: number; yaw: number } {
    const b = this.host.body(id);
    return { x: b?.x ?? 0.5, y: b?.y ?? 81, z: b?.z ?? 19.5, yaw: b?.yaw ?? 0 };
  }
  isOver(): boolean { return this.phase === 'results'; }
  /** The practice seeker's level now, to remember for next time. */
  botSkill(): number | null { return this.seekerBots[0]?.skill ?? null; }

  markLoaded(id: number): void {
    this.loaded.add(id);
    if (this.phase === 'loading') this.tryStart();
  }

  /** Accept or refuse a client's reported position. */
  acceptMove(id: number, from: RsBody, to: { x: number; y: number; z: number }, dt: number): boolean {
    if (this.phase === 'loading' || this.phase === 'intro') return Math.hypot(to.x - from.x, to.z - from.z) < 0.05 && Math.abs(to.y - from.y) < 0.6;
    if (this.phase === 'results') return true;
    const rat = this.rats.has(id);
    const scale = rat ? RS.RAT_SCALE : 1;
    const speed = this.speedOf(id) * 5.7;
    const boosted = (this.impulseUntil.get(id) ?? 0) > this.ticks;
    const allowance = speed * Math.max(dt, 0.05) * 1.6 + 1.2 + (boosted ? 3 : 0);
    if (Math.hypot(to.x - from.x, to.z - from.z) > allowance) return false;
    if (to.y - from.y > 1.3 + this.effectAmp(id, 'jump') * 0.9 + (boosted ? 1 : 0)) return false;
    // The body must not end up inside a wall.
    const hw = 0.3 * scale * 0.85, h = 1.8 * scale * 0.9;
    for (const ox of [-hw, hw]) for (const oz of [-hw, hw]) for (const oy of [0.06, h / 2, h]) {
      const px = to.x + ox, py = to.y + oy, pz = to.z + oz;
      const bx = Math.floor(px), by = Math.floor(py), bz = Math.floor(pz);
      if (pointInSolid(this.host.getBlock(bx, by, bz), px - bx, py - by, pz - bz)) return false;
    }
    return true;
  }
  private readonly impulseUntil = new Map<number, number>();

  leave(id: number): void {
    const wasHuman = this.humans.delete(id);
    const wasRat = this.rats.delete(id);
    this.people.delete(id);
    this.loaded.delete(id);
    this.kits.delete(id);
    this.classes.delete(id);
    this.escapes.delete(id);
    const cage = this.cageOrder.indexOf(id);
    if (cage >= 0) this.cageOrder.splice(cage, 1);
    if (this.phase === 'results') return;
    const name = this.host.name(id);
    if (this.phase === 'loading') { this.tryStart(); return; }
    if (wasHuman && this.humans.size === 0 && this.botIds.size === 0) {
      this.finish(false, 'The seeker fled. The rats win!');
    } else if (wasRat || wasHuman) {
      if (this.rats.size === 0 || this.freeRatCount() === 0) this.finish(true, 'Every remaining rat is caged. The seeker wins!');
      else this.announce(`${name} ${wasHuman ? 'left the hunt' : 'scurried away from the match'}.`, GRAY);
    }
  }

  // ── Actions from clients ──────────────────────────────────────────────────

  /** The host may change who seeks until the hunt begins; then it is locked. */
  seekerPickOpen(): boolean { return this.phase === 'intro' || this.phase === 'hiding'; }

  /** The party host's "Who seeks?" pick: a person in the match, or 0 for the AI seeker. */
  chooseSeeker(by: number, seeker: number): void {
    if (by !== this.leader) return;
    if (!this.seekerPickOpen()) { this.bar(by, 'The seeker is locked once the hunt begins.', RED); return; }
    if (seeker !== 0 && !this.people.has(seeker)) return;
    if (seeker === 0 ? this.botIds.size > 0 : this.humans.has(seeker)) return;
    // Whoever was seeking goes back to being a rat.
    const spawns = rsHouse().spawns;
    for (const id of [...this.humans]) {
      this.humans.delete(id);
      this.kits.delete(id);
      this.rats.set(id, 'free');
      this.points.set(id, 0);
      this.carried.set(id, 0);
      this.clearEffects(id);
      const p = centre(spawns[Math.floor(this.rng() * spawns.length)]);
      this.host.teleport(id, p.x, p.y, p.z, this.rng() * Math.PI * 2);
      this.title(id, 'YOU ARE A RAT', 'Find a hiding spot!', GOLD, 2600);
    }
    for (const id of [...this.botIds]) { this.kits.delete(id); this.host.dropBot(id); }
    this.botIds.clear();
    this.seekerBots.length = 0;
    const w = centre(RS_WAITING);
    if (seeker === 0) {
      const id = this.host.addBot();
      this.botIds.add(id);
      const bot = new SeekerBot(this, id, this.botSkillStart, this.rng);
      this.seekerBots.push(bot);
      this.host.teleport(id, w.x, w.y, w.z, 0);
      bot.syncFromBody();
      this.announce('The AI Seeker will hunt.', GOLD);
    } else {
      this.rats.delete(seeker);
      this.points.delete(seeker);
      this.carried.delete(seeker);
      this.classes.delete(seeker);
      this.escapes.delete(seeker);
      this.clearEffects(seeker);
      this.humans.add(seeker);
      this.host.teleport(seeker, w.x, w.y, w.z, 0);
      if (this.phase === 'hiding') this.addEffect(seeker, 'blind', 1e9, 0);
      this.title(seeker, 'YOU ARE THE SEEKER', 'Blindfolded while the rats hide...', RED, 2600);
      this.announce(`${this.host.name(seeker)} will seek.`, GOLD);
    }
    for (const id of this.people) { this.syncFx(id); this.syncKit(id); }
  }

  handleClass(id: number, cls: RatClassId): void {
    if (this.phase !== 'hiding' && this.phase !== 'intro' && this.phase !== 'loading') return;
    if (!this.rats.has(id) || this.classes.get(id) === cls) return;
    const cap = ratClassCap(this.rats.size);
    if (this.classCount(cls) >= cap) {
      this.bar(id, `Too many ${RAT_CLASSES[cls].name}s already (max ${cap}).`, RED);
      this.sound('click', undefined, id);
      return;
    }
    this.classes.set(id, cls);
    this.bar(id, `You are a ${RAT_CLASSES[cls].name}! ${RAT_CLASSES[cls].ability} unlocks when the hunt starts.`, RAT_CLASSES[cls].color);
    this.sound('squeak', undefined, id);
    this.syncKit(id);
  }

  handleUse(id: number, slot: number, block?: { x: number; y: number; z: number; nx: number; ny: number; nz: number }): void {
    if (this.phase === 'results' || this.phase === 'loading') return;
    const body = this.host.body(id);
    if (!body) return;
    if (block && [block.x, block.y, block.z, block.nx, block.ny, block.nz].every(Number.isFinite)) {
      const eye = this.eye(id);
      const far = dist2(eye, { x: block.x + 0.5, y: block.y + 0.5, z: block.z + 0.5 }) > 6.5 * 6.5;
      const b = this.host.getBlock(block.x, block.y, block.z);
      if (!far && (b === Block.ManorLeverOff || b === Block.ManorLeverOn) && this.useLever(id, block)) return;
      if (!far && (b === Block.ManorExchangeBase || b === Block.ManorExchangeTop)) { this.useExchange(id); return; }
    } else block = undefined;
    const item = this.kitOf(id)[slot]?.id;
    if (!item) return;
    switch (item) {
      case Item.RatCatcher: this.swat(id); return;
      case Item.Flashlight: case Item.Mousetrap: case Item.CheeseBait: this.useGadget(id, item, block); return;
      case Item.WhiskerSense: case Item.CheeseMagnet: case Item.DecoyRat: case Item.Disarm:
        if (this.phase === 'hunting' && this.rats.get(id) === 'free') this.useAbility(id);
        else this.bar(id, "Abilities work while you're free during the hunt.", RED);
        return;
      case Item.SqueakTaunt: this.taunt(id); return;
      case Item.Scamper: this.dash(id); return;
      case Item.ScentPulse: this.scentPulse(id); return;
      case Item.SeekerCompass: this.useCompass(id); return;
      case Item.EscapeCard:
        this.bar(id, this.cageOrder.length
          ? `Banked escape ready — it saves you if caught. Or right-click the Cheese Exchange (${RS.RESCUE_COST} cheese) to free a rat.`
          : 'Banked escape ready — it saves you automatically the next time you are caught.', GREEN);
        this.sound('click', undefined, id);
        return;
      case Item.CageRattle: this.rattleCage(id); return;
      default:
    }
  }

  /** A human seeker's left-click on a body (or a decoy). */
  handleHit(id: number, target: number, decoy: boolean): void {
    if (this.phase !== 'hunting' || !this.humans.has(id)) return;
    const eye = this.eye(id);
    if (decoy) {
      const d = this.decoys.find((v) => v.id === target);
      if (!d || dist2(eye, { x: d.x, y: d.y + 0.25, z: d.z }) > (RS.REACH + 0.8) ** 2) return;
      this.hitDecoy(d, id, true);
      return;
    }
    if (this.rats.get(target) !== 'free') return;
    const rat = this.host.body(target);
    if (!rat) return;
    const mid = { x: rat.x, y: rat.y + 0.45, z: rat.z };
    if (dist2(eye, mid) > (RS.REACH + 0.75) ** 2) return;
    if (!this.lineClear(eye, mid) && !this.lineClear(eye, { x: rat.x, y: rat.y + 0.8, z: rat.z }) && !this.lowLineOfSight(id, target)) return;
    this.cageRat(target, id);
  }

  // ── Ticking ───────────────────────────────────────────────────────────────

  tick(dt: number): void {
    this.acc += dt * 1000;
    let steps = 0;
    while (this.acc >= TICK_MS && steps++ < 10) {
      this.acc -= TICK_MS;
      this.step();
    }
    if (this.acc > TICK_MS * 10) this.acc = 0;
  }

  private tryStart(): void {
    if (this.phase !== 'loading') return;
    const waiting = [...this.people].filter((id) => !this.loaded.has(id));
    const timedOut = this.host.nowMs() - this.startedAt > 30_000;
    if (waiting.length && !timedOut) return;
    this.phase = 'intro';
    this.phaseTicks = RS.INTRO_TICKS;
    const matchup = `${this.humans.size + this.botIds.size} SEEKER vs ${this.rats.size} ${this.rats.size === 1 ? 'RAT' : 'RATS'}`;
    for (const id of this.people) {
      this.title(id, 'THE CROOKED MANOR', 'Rat and Seek', GOLD, 2600);
      this.sound('intro', undefined, id);
    }
    this.introMatchup = matchup;
  }
  private introMatchup = '';

  private step(): void {
    this.ticks++;
    if (this.phase === 'loading') {
      if (this.ticks % 20 === 0) this.tryStart();
      if (this.ticks % 2 === 0) this.broadcastState();
      return;
    }
    if (this.phase === 'results') {
      if (this.ticks % 10 === 0) this.broadcastState();
      return;
    }
    this.phaseTicks--;
    this.trackMotion();
    this.heat = Math.max(0, this.heat * 0.997 - 0.0004);
    this.tickEffects();
    this.tickGadgets();
    this.tickAbilities();
    this.tickCompasses();
    if (this.phase === 'hunting') {
      this.tickChandeliers();
      this.moveCat(this.cat && this.cat.target >= 0 ? 0.3 : 0.2);
      if (this.ticks % 10 === 0) this.tickCat();
      for (const bot of this.seekerBots) {
        if (this.isOver()) return;
        bot.tick();
      }
      if (this.ticks % 20 === 0) this.adapt();
    } else if (this.phase === 'hiding') {
      for (const bot of this.seekerBots) bot.idle();
    }
    if (this.isOver()) return;
    this.tickCheese();
    if (this.phase === 'intro') {
      if (this.phaseTicks === RS.INTRO_TICKS - 55) {
        for (const id of this.people) this.title(id, this.introMatchup, 'Rats hide. Seekers hunt. Cheese is everything.', RED, 2000);
      }
      if (this.phaseTicks <= 0) this.beginHiding();
    } else {
      this.tickSafety();
      this.tickSecretPassages();
      this.tickPerches();
      if (this.phase === 'hiding') this.tickHiding();
      else this.tickHunt();
    }
    if (this.isOver()) return;
    if (this.phase === 'hunting' && this.ticks % 20 === 0) this.tickDanger();
    for (const id of this.people) { this.syncFx(id); this.syncKit(id); }
    if (this.ticks % 2 === 0) this.broadcastState();
  }

  private trackMotion(): void {
    if (this.ticks % 2) return;
    for (const id of this.rats.keys()) {
      const b = this.host.body(id);
      if (!b) continue;
      const m = this.motion.get(id);
      if (!m) { this.motion.set(id, { x: 0, z: 0, px: b.x, pz: b.z, speed: 0 }); continue; }
      let vx = (b.x - m.px) / 2, vz = (b.z - m.pz) / 2;
      if (vx * vx + vz * vz > 1) { vx = 0; vz = 0; }
      m.x = vx; m.z = vz; m.px = b.x; m.pz = b.z; m.speed = Math.hypot(vx, vz);
    }
  }
  /** Horizontal speed in blocks per tick, and heading. */
  ratMotion(id: number): { x: number; z: number; speed: number } {
    return this.motion.get(id) ?? { x: 0, z: 0, speed: 0 };
  }

  // ── Phases ────────────────────────────────────────────────────────────────

  private placeEveryone(): void {
    const spawns = [...rsHouse().spawns];
    for (let i = spawns.length - 1; i > 0; i--) { const j = Math.floor(this.rng() * (i + 1)); [spawns[i], spawns[j]] = [spawns[j], spawns[i]]; }
    let s = 0;
    for (const id of this.rats.keys()) {
      const p = centre(spawns[s++ % spawns.length]);
      this.host.teleport(id, p.x, p.y, p.z, this.rng() * Math.PI * 2);
    }
    let k = 0;
    for (const id of [...this.humans, ...this.botIds]) {
      const w = centre(RS_WAITING);
      this.host.teleport(id, w.x + (k++ ? (this.rng() - 0.5) * 1.6 : 0), w.y, w.z + (this.rng() - 0.5) * 1.6, 0);
    }
    for (const bot of this.seekerBots) bot.syncFromBody();
  }

  private beginHiding(): void {
    this.phase = 'hiding';
    this.phaseTicks = RS.HIDE_TICKS;
    this.announce('Welcome to the manor! 30 seconds to hide: 4 floors, 16 furnished rooms, a greenhouse and 4 noisy tunnels!', GOLD);
    this.announce(`Trade ${RS.RESCUE_COST} cheese at the Cheese Exchange to rescue a friend, or bank 1 escape when the cage is empty!`, GOLD);
    for (const id of this.humans) {
      this.title(id, 'YOU ARE THE SEEKER', 'Blindfolded while the rats hide...', RED, 3500);
      this.addEffect(id, 'blind', 1e9, 0);
    }
    for (const id of this.rats.keys()) {
      this.title(id, 'YOU ARE A RAT', '100+ hiding spots • 4 tunnels • rescues', GOLD, 3500);
      if (!this.classes.has(id)) this.bar(id, 'Pick a class with the rosette in slot 7 — your pick is remembered next game.', YELLOW);
    }
  }

  private tickHiding(): void {
    const seconds = Math.max(0, Math.floor(this.phaseTicks / 20));
    if (this.phaseTicks % 20 === 0 && (seconds === 20 || seconds === 10 || seconds <= 5)) {
      for (const id of this.people) {
        this.title(id, String(seconds), this.humans.has(id) ? 'The hunt begins soon' : 'Find a hiding spot!', YELLOW, 1100);
        this.sound('tick', undefined, id);
      }
    }
    if (this.phaseTicks > 0 && this.phaseTicks % (seconds <= 10 ? 10 : 20) === 0) {
      for (const id of this.humans) this.sound('heartbeat', undefined, id);
    }
    if (this.phaseTicks > 0) return;
    this.phase = 'hunting';
    this.phaseTicks = RS.HUNT_TICKS;
    this.huntStartTick = this.ticks;
    this.hintTicks = 280;
    this.twistTicks = this.nextTwistDelay();
    for (const id of this.humans) {
      const r = centre(RS_RELEASE);
      this.host.teleport(id, r.x + (this.rng() - 0.5) * 2, r.y, r.z + (this.rng() - 0.5) * 2, 0);
      this.clearEffect(id, 'blind');
      this.title(id, 'HUNT!', 'Catch every rat in 4 minutes', RED, 2400);
    }
    for (const bot of this.seekerBots) bot.release();
    this.announce('The seeker is loose! The seeker compass updates with every hint.', RED);
    for (const id of this.people) this.sound('hunt', undefined, id);
    this.startHouseLife();
    this.assignMissingClasses();
    for (const id of this.rats.keys()) {
      const cls = this.classes.get(id);
      if (!cls) continue;
      const info = RAT_CLASSES[cls];
      this.msgTo(id, `You are a ${info.name} — ${info.passive} Slot 5: ${info.ability}.`, info.color);
    }
    this.announce('The seeker carries: flashlight, mousetraps, cheese bait. Rats — watch the floors and check your cheese!', GOLD);
    this.giveHint();
  }

  private tickHunt(): void {
    this.twistTicks--;
    if (this.twistTicks <= 0) { this.triggerTwist(); this.twistTicks = this.nextTwistDelay(); }
    this.hintTicks--;
    if (this.hintTicks <= 0) {
      this.giveHint();
      this.hintTicks = Math.max(60, this.phaseTicks > 1200 ? 440 : this.phaseTicks > 600 ? 320 : 220);
    }
    if (this.phaseTicks === 1200 || this.phaseTicks === 600 || this.phaseTicks === 200) {
      this.announce(`${this.phaseTicks / 20} seconds left! Hints are getting more frequent.`, YELLOW);
      this.sound('bell', centre(RS_RELEASE));
    }
    if (this.phaseTicks <= 0) {
      for (const [id, state] of this.rats) if (state === 'free') this.addPoints(id, 3);
      const free = this.freeRatCount();
      this.finish(false, `${free} rat${free === 1 ? ' survives' : 's survive'} the clock. The rats win!`);
    }
  }

  private finish(humansWon: boolean, reason: string): void {
    if (this.phase === 'results') return;
    this.phase = 'results';
    this.phaseTicks = 0;
    this.announce(reason, humansWon ? GOLD : GREEN);
    for (const id of this.people) {
      const winner = humansWon ? this.humans.has(id) : this.rats.has(id);
      this.title(id, winner ? 'YOU WIN!' : 'GAME OVER', humansWon ? 'The seeker caught every rat' : 'The rats beat the clock',
        winner ? GOLD : RED, 3500);
      this.sound(winner ? 'win' : 'lose', undefined, id);
    }
    const huntFraction = this.huntStartTick ? (this.ticks - this.huntStartTick) / RS.HUNT_TICKS : 0;
    for (const bot of this.seekerBots) bot.settle(humansWon, huntFraction);
    const ratIds = [...this.rats.keys()];
    const seekerIds = [...this.humans, ...this.botIds];
    const winners = humansWon ? seekerIds : ratIds;
    const score = (id: number): number => humansWon ? this.catchesBy.get(id) ?? 0 : this.points.get(id) ?? 0;
    winners.sort((a, b) => score(b) - score(a));
    this.result = {
      humansWon, reason,
      podium: winners.slice(0, 3).map((id) => ({ id, name: this.host.name(id),
        score: humansWon ? `${score(id)} ${score(id) === 1 ? 'catch' : 'catches'}` : `${score(id)} pts` })),
      awards: this.awards(),
      rats: ratIds.map((id) => ({ id, name: this.host.name(id), points: this.points.get(id) ?? 0,
        cheese: this.cheeseGrabbed.get(id) ?? 0, caged: this.rats.get(id) === 'caged' }))
        .sort((a, b) => b.points - a.points),
      seekers: seekerIds.map((id) => ({ id, name: this.host.name(id), catches: this.catchesBy.get(id) ?? 0 })),
      durationMs: (this.ticks - this.huntStartTick) * TICK_MS,
    };
    this.stagePodium(this.result.podium.map((p) => p.id));
    for (const id of this.people) this.host.send(id, { t: 'rsResult', result: this.result });
    for (const id of this.people) { this.effects.delete(id); this.syncFx(id); }
    this.broadcastState();
  }

  /** The round ends in the backyard: the top three on the podium facing the
   *  crowd, and everybody else in a row facing them. */
  private stagePodium(top: number[]): void {
    top.forEach((id, i) => {
      const spot = RS_PODIUM[i];
      if (spot) this.host.teleport(id, spot.x, spot.y, spot.z, 0);
    });
    const crowd = [...this.people, ...this.botIds].filter((id) => !top.includes(id));
    crowd.forEach((id, i) => this.host.teleport(id,
      RS_PODIUM_CROWD.x + (i - (crowd.length - 1) / 2) * 1.5, RS_PODIUM_CROWD.y, RS_PODIUM_CROWD.z, Math.PI));
  }

  private awards(): RsAward[] {
    const out: RsAward[] = [];
    const top = (m: Map<number, number>, among: Iterable<number>): number | null => {
      let best: number | null = null, count = 0;
      for (const id of among) { const c = m.get(id) ?? 0; if (c > count) { best = id; count = c; } }
      return best;
    };
    const cheese = top(this.points, this.rats.keys());
    if (cheese !== null) out.push({ title: 'Big Cheese', winner: this.host.name(cheese), detail: `${this.points.get(cheese)} pts`, color: GOLD });
    const ext = top(this.catchesBy, [...this.humans, ...this.botIds]);
    if (ext !== null) {
      const n = this.catchesBy.get(ext)!;
      out.push({ title: 'Exterminator', winner: this.host.name(ext), detail: `${n} ${n === 1 ? 'catch' : 'catches'}`, color: RED });
    }
    if (this.fastest) {
      const s = Math.floor(this.fastest.ticks / 20);
      out.push({ title: 'Speed Trap', winner: this.host.name(this.fastest.catcher),
        detail: `caught ${this.fastest.victim} at ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`, color: AQUA });
    }
    const loud = top(this.tauntsBy, this.tauntsBy.keys());
    if (loud !== null) out.push({ title: 'Loudmouth', winner: this.host.name(loud), detail: `${this.tauntsBy.get(loud)} squeaks`, color: PURPLE });
    const houdini = top(this.escapesBy, this.escapesBy.keys());
    if (houdini !== null) {
      out.push({ title: 'Houdini', winner: this.host.name(houdini), detail: `${this.escapesBy.get(houdini)} escapes & rescues`, color: GREEN });
    }
    return out;
  }

  // ── Rats ──────────────────────────────────────────────────────────────────

  freeRats(): number[] { return [...this.rats].filter(([, s]) => s === 'free').map(([id]) => id); }
  freeRatCount(): number { return this.freeRats().length; }
  isFreeRat(id: number): boolean { return this.rats.get(id) === 'free'; }
  hasEscapeCard(id: number): boolean { return (this.escapes.get(id) ?? 0) > 0; }
  cagedCount(): number { return this.cageOrder.length; }
  addPoints(id: number, n: number): void { if (this.rats.has(id)) this.points.set(id, (this.points.get(id) ?? 0) + n); }
  classCount(cls: RatClassId): number { let n = 0; for (const c of this.classes.values()) if (c === cls) n++; return n; }
  private isClass(id: number, cls: RatClassId): boolean { return this.classes.get(id) === cls; }

  private assignMissingClasses(): void {
    for (const id of this.rats.keys()) {
      if (this.classes.has(id)) continue;
      let fewest = Infinity, options: RatClassId[] = [];
      for (const cls of RAT_CLASS_IDS) {
        const n = this.classCount(cls);
        if (n < fewest) { fewest = n; options = []; }
        if (n === fewest) options.push(cls);
      }
      this.classes.set(id, options[Math.floor(this.rng() * options.length)]);
    }
  }

  /** Cage a free rat (or burn its escape card). `catcher` -1 = no credit. */
  cageRat(id: number, catcher: number): boolean {
    if (this.phase !== 'hunting' || this.rats.get(id) !== 'free') return false;
    if ((this.escapes.get(id) ?? 0) > 0) { this.useBankedEscape(id); return false; }
    this.rats.set(id, 'caged');
    this.cageOrder.push(id);
    const at = this.host.body(id);
    this.heat += 0.5;
    for (const bot of this.seekerBots) bot.caught(id, at);
    if (at) this.sound('snap', at);
    if (catcher >= 0) {
      this.catchesBy.set(catcher, (this.catchesBy.get(catcher) ?? 0) + 1);
      const t = this.ticks - this.huntStartTick;
      if (!this.fastest || t < this.fastest.ticks) this.fastest = { catcher, victim: this.host.name(id), ticks: t };
      this.bar(catcher, `SNAP! ${this.host.name(id)} is going to the cage.`, GOLD);
    }
    const cage = centre(RS_CAGE);
    this.host.teleport(id, cage.x + this.rng() - 0.5, cage.y, cage.z + this.rng() - 0.5);
    this.sound('cage', cage);
    this.clearEffects(id);
    this.title(id, catcher >= 0 ? 'SNAP! CAGED!' : 'CAGED!', `A free rat can trade ${RS.RESCUE_COST} cheese to free you`, RED, 2800);
    this.announce(`A rat was caught! ${this.freeRatCount()} rat(s) remain free.`, RED);
    if (this.freeRatCount() === 0) this.finish(true, 'Every rat is in the cage. The seeker wins!');
    else if (this.freeRatCount() === 1 && !this.lastRatRush) this.startLastRatRush();
    return true;
  }

  private useBankedEscape(id: number): void {
    const left = Math.max(0, (this.escapes.get(id) ?? 0) - 1);
    if (left) this.escapes.set(id, left); else this.escapes.delete(id);
    const at = this.host.body(id);
    this.escapesBy.set(id, (this.escapesBy.get(id) ?? 0) + 1);
    this.heat += 0.4;
    const r = this.ratRespawn();
    this.host.teleport(id, r.x, r.y, r.z);
    this.addEffect(id, 'speed', 100, 2);
    this.title(id, 'JAIL FREE!', 'Your banked escape saved you', GREEN, 2200);
    if (at) this.sound('escape', at);
    this.announce(`${this.host.name(id)} used a banked escape!`, GREEN);
  }

  private useExchange(id: number): void {
    if (this.phase !== 'hiding' && this.phase !== 'hunting') return;
    if (this.rats.get(id) !== 'free') { this.bar(id, 'Only a free rat can trade cheese while hiding or during the hunt.', RED); return; }
    if (!this.cageOrder.length && (this.escapes.get(id) ?? 0) >= RS.MAX_BANKED_ESCAPES) {
      this.bar(id, 'Your escape bank is full (maximum 1).', YELLOW);
      return;
    }
    const cheese = this.carried.get(id) ?? 0;
    if (cheese < RS.RESCUE_COST) {
      this.bar(id, `The Exchange needs ${RS.RESCUE_COST} cheese (you have ${cheese}).`, RED);
      this.sound('click', undefined, id);
      return;
    }
    this.carried.set(id, cheese - RS.RESCUE_COST);
    if (!this.cageOrder.length) {
      this.escapes.set(id, 1);
      this.title(id, 'ESCAPE BANKED!', 'Your next capture is cancelled', GREEN, 2000);
      this.bar(id, `Escapes banked: 1/${RS.MAX_BANKED_ESCAPES}`, GREEN);
      this.sound('escape', undefined, id);
    } else {
      this.rescueRat(id);
    }
  }

  private rescueRat(rescuer: number): void {
    const freed = this.cageOrder.shift();
    if (freed === undefined) return;
    this.rats.set(freed, 'free');
    this.lastRatRush = false;
    this.addPoints(rescuer, 2);
    this.escapesBy.set(rescuer, (this.escapesBy.get(rescuer) ?? 0) + 1);
    const r = this.ratRespawn();
    this.host.teleport(freed, r.x, r.y, r.z);
    this.addEffect(freed, 'speed', 100, 2);
    this.title(freed, 'FREED!', 'A teammate traded cheese for you', GREEN, 2200);
    const cage = centre(RS_CAGE);
    this.sound('rescue', cage);
    this.announce('CAGE ALARM! A rat traded cheese and freed a teammate!', GREEN);
    const at = this.host.body(rescuer);
    if (at) this.pointCompasses(at);
    for (const id of this.humans) this.title(id, 'CAGE ALARM', 'Your compass points toward the trader', RED, 1800);
  }

  private taunt(id: number): void {
    if (this.phase !== 'hunting' || this.rats.get(id) !== 'free') { this.bar(id, 'You can only taunt while free during the hunt.', RED); return; }
    const ready = this.tauntReady.get(id) ?? 0;
    if (ready > this.ticks) { this.bar(id, `Taunt ready in ${((ready - this.ticks) / 20).toFixed(1)}s`, RED); return; }
    this.tauntReady.set(id, this.ticks + RS.TAUNT_COOLDOWN);
    this.tauntsBy.set(id, (this.tauntsBy.get(id) ?? 0) + 1);
    this.addPoints(id, 1);
    const at = this.host.body(id)!;
    this.sound('squeak', at);
    this.bar(id, `Taunt score: ${this.points.get(id)} · Run!`, GOLD);
    this.pointCompasses(at);
    this.noise(at, 40, 0.95, id);
    this.distractCat(at);
  }

  private dash(id: number): void {
    if (this.phase !== 'hunting' || this.rats.get(id) !== 'free') { this.bar(id, 'Only a free rat can scamper.', RED); return; }
    const ready = this.dashReady.get(id) ?? 0;
    if (ready > this.ticks) { this.bar(id, `Scamper ready in ${((ready - this.ticks) / 20).toFixed(1)}s`, RED); return; }
    this.dashReady.set(id, this.ticks + (this.isClass(id, 'scout') ? RS.DASH_COOLDOWN * 2 / 3 : RS.DASH_COOLDOWN));
    const b = this.host.body(id)!;
    const fx = -Math.sin(b.yaw), fz = -Math.cos(b.yaw);
    this.host.send(id, { t: 'rsImpulse', vx: fx * 16, vy: 3.4, vz: fz * 16, momentum: 0.45 });
    this.impulseUntil.set(id, this.ticks + 30);
    this.addEffect(id, 'speed', 45, 2);
    this.sound('dash', b);
    this.noise(b, 16, 0.45, id);
  }

  private rattleCage(id: number): void {
    if (this.phase !== 'hunting' || this.rats.get(id) !== 'caged') { this.bar(id, 'You need to be caged to rattle the bars.', RED); return; }
    const ready = this.rattleReady.get(id) ?? 0;
    if (ready > this.ticks) { this.bar(id, `Rattle ready in ${((ready - this.ticks) / 20).toFixed(1)}s`, RED); return; }
    this.rattleReady.set(id, this.ticks + RS.RATTLE_COOLDOWN);
    this.addPoints(id, 1);
    this.sound('rattle', centre(RS_CAGE));
    for (const free of this.freeRats()) {
      this.addEffect(free, 'speed', 60, 1);
      this.bar(free, 'CAGE RATTLE — scamper boost!', GREEN);
    }
    for (const s of this.humans) {
      this.addEffect(s, 'glow', 80, 0);
      this.bar(s, 'The prisoners rattled the cage — you are exposed!', RED);
    }
    for (const bot of this.seekerBots) this.addEffect(bot.id, 'glow', 80, 0);
    this.announce('The cage erupts in a deafening rattle!', PURPLE);
  }

  private startLastRatRush(): void {
    this.lastRatRush = true;
    const id = this.freeRats()[0];
    if (id === undefined) return;
    this.dashReady.set(id, 0);
    this.abilityReady.set(id, 0);
    this.addEffect(id, 'speed', 140, 2);
    this.title(id, 'LAST RAT!', 'Dash reset • seven-second speed rush', GOLD, 2200);
    for (const p of this.people) this.sound('twist', undefined, p);
    this.announce(`${this.host.name(id)} is the LAST RAT STANDING!`, GOLD);
  }

  // ── Seekers ───────────────────────────────────────────────────────────────

  private swat(id: number): void {
    if (this.phase !== 'hunting' || !this.humans.has(id)) return;
    const readyAt = this.swatReady.get(id) ?? 0;
    if (readyAt > this.ticks) return;
    this.swatReady.set(id, this.ticks + 12);
    const b = this.host.body(id)!;
    const eye = this.eye(id);
    const fx = -Math.sin(b.yaw) * Math.cos(b.pitch), fy = Math.sin(b.pitch), fz = -Math.cos(b.yaw) * Math.cos(b.pitch);
    let best = -1, bestD = RS.SWAT_REACH * RS.SWAT_REACH;
    for (const rid of this.freeRats()) {
      const r = this.host.body(rid);
      if (!r) continue;
      const tx = r.x - eye.x, ty = r.y + 0.35 - eye.y, tz = r.z - eye.z;
      const len = Math.hypot(tx, ty, tz);
      const d = dist2(b, r);
      if (d >= bestD || len < 0.1 || (tx * fx + ty * fy + tz * fz) / len < 0.82 || !this.lowLineOfSight(id, rid)) continue;
      best = rid; bestD = d;
    }
    if (best >= 0) this.cageRat(best, id);
  }
  private readonly swatReady = new Map<number, number>();

  private lowLineOfSight(seeker: number, rat: number): boolean {
    const a = this.host.body(seeker), r = this.host.body(rat);
    if (!a || !r || Math.abs(a.y - r.y) > 1.2) return false;
    return this.lineClear({ x: a.x, y: a.y + 0.38, z: a.z }, { x: r.x, y: r.y + 0.36, z: r.z });
  }

  /** Scent Pulse, shared cooldown between every seeker. */
  scentReady(): boolean { return this.phase === 'hunting' && this.ticks >= this.scentReadyAt; }
  private scentPulse(id: number): void {
    if (!this.humans.has(id) || this.phase !== 'hunting') return;
    if (!this.scentReady()) { this.bar(id, `Scent pulse ready in ${((this.scentReadyAt - this.ticks) / 20).toFixed(1)}s`, RED); return; }
    const b = this.host.body(id)!;
    const nearest = this.nearestFreeRat(b);
    if (nearest < 0) return;
    this.scentReadyAt = this.ticks + RS.SCENT_COOLDOWN;
    const r = this.host.body(nearest)!;
    this.addEffect(nearest, 'glow', 50, 0);
    this.trackWithCompass(id, nearest, 100);
    this.title(id, 'SNIFF!', `${Math.round(Math.sqrt(dist2(b, r)))} blocks • ${rsRoomAt(r.x, r.y, r.z)}`, YELLOW, 1500);
    this.sound('sniff', b);
    this.heat += 0.15;
  }
  /** A practice seeker's sniff: same cooldown, same glow. Returns the rat, or -1. */
  botScentPulse(botId: number): number {
    if (!this.scentReady()) return -1;
    const b = this.host.body(botId);
    if (!b) return -1;
    const nearest = this.nearestFreeRat(b);
    if (nearest < 0) return -1;
    this.scentReadyAt = this.ticks + RS.SCENT_COOLDOWN;
    this.addEffect(nearest, 'glow', 50, 0);
    this.sound('sniff', b);
    this.heat += 0.15;
    return nearest;
  }
  /** A practice seeker's catch. True if the rat went to the cage. */
  botCatch(botId: number, rat: number): boolean {
    const escaping = this.hasEscapeCard(rat);
    if (!escaping) this.announce(`${this.host.name(botId)} caught ${this.host.name(rat)}!`, RED);
    this.cageRat(rat, botId);
    return !escaping;
  }

  private nearestFreeRat(at: { x: number; y: number; z: number }): number {
    let best = -1, bestD = Infinity;
    for (const id of this.freeRats()) {
      const b = this.host.body(id);
      if (!b) continue;
      const d = dist2(b, at);
      if (d < bestD) { bestD = d; best = id; }
    }
    return best;
  }

  /** Point a seeker's compass at a rat and keep it pointing there as the rat moves. */
  private trackWithCompass(seeker: number, rat: number, ticks: number): boolean {
    const b = this.host.body(rat);
    if (!b) return false;
    this.compass.set(seeker, { x: b.x, y: b.y, z: b.z });
    this.compassRat.set(seeker, rat);
    this.compassUntil.set(seeker, this.ticks + ticks);
    return true;
  }
  private clearCompass(seeker: number): void {
    this.compass.delete(seeker);
    this.compassRat.delete(seeker);
    this.compassUntil.delete(seeker);
  }
  /** Keep every followed rat's position fresh; drop the lock when it ends or the rat is caged. */
  private tickCompasses(): void {
    for (const seeker of [...this.compass.keys()]) {
      if ((this.compassUntil.get(seeker) ?? 0) <= this.ticks) { this.clearCompass(seeker); continue; }
      const rat = this.compassRat.get(seeker);
      if (rat === undefined) continue;
      const b = this.rats.get(rat) === 'free' ? this.host.body(rat) : undefined;
      if (b) this.compass.set(seeker, { x: b.x, y: b.y, z: b.z });
      else {
        // Caught (or gone): jump to the nearest rat still free, if any.
        this.clearCompass(seeker);
        const sb = this.host.body(seeker);
        const next = sb ? this.nearestFreeRat(sb) : -1;
        if (next >= 0) this.trackWithCompass(seeker, next, RS.COMPASS_TRACK / 2);
      }
    }
  }
  /** Right-click the compass: lock on to the nearest free rat. */
  private useCompass(id: number): void {
    if (!this.humans.has(id)) return;
    if (this.phase !== 'hunting') { this.bar(id, 'The compass wakes up when the hunt begins.', RED); return; }
    const ready = this.compassReady.get(id) ?? 0;
    if (ready > this.ticks) { this.bar(id, `Compass recharging — ${((ready - this.ticks) / 20).toFixed(1)}s`, RED); return; }
    const b = this.host.body(id)!;
    const nearest = this.nearestFreeRat(b);
    if (nearest < 0 || !this.trackWithCompass(id, nearest, RS.COMPASS_TRACK)) { this.bar(id, 'No free rats to track.', GRAY); return; }
    this.compassReady.set(id, this.ticks + RS.COMPASS_COOLDOWN);
    const r = this.host.body(nearest)!;
    this.sound('bell', undefined, id);
    this.title(id, 'COMPASS LOCKED', `${Math.round(Math.sqrt(dist2(b, r)))} blocks • ${rsRoomAt(r.x, r.y, r.z)}`, YELLOW, 1400);
  }

  private pointCompasses(at: { x: number; z: number }): void {
    for (const id of this.humans) this.compass.set(id, { x: at.x, y: (at as RsPos).y ?? 81, z: at.z });
    for (const id of this.humans) { this.compassRat.delete(id); this.compassUntil.set(id, this.ticks + 200); }
    if (this.phase === 'hunting') for (const bot of this.seekerBots) bot.alert({ x: at.x, y: (at as RsPos).y ?? 81, z: at.z });
  }
  private notifyHumans(text: string, color: string): void { for (const id of this.humans) this.bar(id, text, color); }

  private giveHint(): void {
    const free = this.freeRats();
    if (!free.length) return;
    const target = free[Math.floor(this.rng() * free.length)];
    const at = this.host.body(target);
    if (!at) return;
    const room = rsRoomAt(at.x, at.y, at.z);
    for (const id of this.humans) {
      this.trackWithCompass(id, target, 160);
      this.bar(id, `Compass tracking a rat near the ${room}`, YELLOW);
      this.sound('bell', undefined, id);
    }
    for (const bot of this.seekerBots) bot.hint(at);
    if (this.phaseTicks <= 600) this.addEffect(target, 'glow', 30, 0);
  }

  /** A sound in the house: seekers in earshot turn to it. */
  noise(at: { x: number; y: number; z: number }, radius: number, strength: number, rat: number): void {
    for (const bot of this.seekerBots) bot.noise(at, radius, strength, rat);
  }

  private tickDanger(): void {
    const seekers = this.seekerPositions();
    if (!seekers.length) return;
    for (const id of this.freeRats()) {
      if ((this.whiskersUntil.get(id) ?? 0) > this.ticks) continue;
      const b = this.host.body(id);
      if (!b) continue;
      const d = Math.min(...seekers.map((s) => Math.sqrt(dist2(s, b))));
      if (d <= 5) { this.bar(id, 'Seeker very close!', RED); this.sound('drum', undefined, id); }
      else if (d <= 10) {
        this.bar(id, `Footsteps nearby · ${Math.round(d)}m`, YELLOW);
        if (this.ticks % 40 === 0) this.sound('drum', undefined, id);
      }
    }
  }
  private seekerPositions(): RsBody[] {
    const out: RsBody[] = [];
    for (const id of [...this.humans, ...this.botIds]) { const b = this.host.body(id); if (b) out.push(b); }
    return out;
  }

  // ── Cheese ────────────────────────────────────────────────────────────────

  private spawnCheese(): void {
    const spots = rsHouse().cheese.filter((s) => !this.cheese.some((c) => (c.x - s.x - 0.5) ** 2 + (c.z - s.z - 0.5) ** 2 + (c.y - s.y) ** 2 < 2.25));
    if (!spots.length) return;
    const s = spots[Math.floor(this.rng() * spots.length)];
    this.cheese.push({ id: this.nextEntity++, x: s.x + 0.5, y: s.y, z: s.z + 0.5, bait: false, owner: -1, pickupAt: this.ticks + 10 });
  }
  cheeseNear(at: { x: number; y: number; z: number }, radius: number): boolean {
    return this.cheese.some((c) => !c.bait && dist2(c, at) < radius * radius);
  }
  private tickCheese(): void {
    for (let i = this.cheeseRespawns.length - 1; i >= 0; i--) {
      if (--this.cheeseRespawns[i] <= 0) {
        this.cheeseRespawns.splice(i, 1);
        if (this.cheese.filter((c) => !c.bait).length < RS.MAX_CHEESE) this.spawnCheese();
      }
    }
    if (this.ticks % 20 === 0) {
      for (let i = this.cheese.filter((c) => !c.bait).length + this.cheeseRespawns.length; i < RS.MAX_CHEESE; i++) {
        this.cheeseRespawns.push(RS.CHEESE_RESPAWN);
      }
    }
    if (this.phase !== 'hiding' && this.phase !== 'hunting') return;
    // Pickups: a rat's reach is its body plus a block, as for any item.
    for (const id of this.freeRats()) {
      const b = this.host.body(id);
      if (!b) continue;
      for (const c of [...this.cheese]) {
        if (c.pickupAt > this.ticks || Math.hypot(c.x - b.x, c.z - b.z) > 1.1 || c.y - b.y > 1.2 || b.y - c.y > 0.8) continue;
        if (c.bait) { if (this.phase === 'hunting') this.biteBait(id, c); continue; }
        this.grabCheese(id, c);
      }
    }
  }
  private grabCheese(id: number, c: CheeseItem): void {
    this.cheese.splice(this.cheese.indexOf(c), 1);
    this.cheeseRespawns.push(RS.CHEESE_RESPAWN);
    const combo = (this.comboUntil.get(id) ?? 0) > this.ticks ? Math.min(3, (this.combos.get(id) ?? 0) + 1) : 1;
    this.combos.set(id, combo);
    this.comboUntil.set(id, this.ticks + RS.COMBO_WINDOW);
    const reward = combo + (this.isClass(id, 'thief') ? 1 : 0);
    this.addPoints(id, reward);
    this.cheeseGrabbed.set(id, (this.cheeseGrabbed.get(id) ?? 0) + 1);
    const carried = (this.carried.get(id) ?? 0) + 1;
    this.carried.set(id, carried);
    this.bar(id, `Cheese ${carried}/${RS.RESCUE_COST} · ×${combo} combo · +${reward}`, GOLD);
    const b = this.host.body(id)!;
    this.sound('cheese', b);
    this.noise(b, 14, 0.5, id);
  }

  // ── Seeker gadgets ────────────────────────────────────────────────────────

  kit(id: number): Kit {
    let k = this.kits.get(id);
    if (!k) { k = { lightOn: false, battery: RS.BATTERY, traps: RS.TRAP_CHARGES, baits: RS.BAIT_CHARGES, trapRefills: [], baitRefills: [] }; this.kits.set(id, k); }
    return k;
  }

  private useGadget(id: number, item: number, block?: { x: number; y: number; z: number; nx: number; ny: number; nz: number }): void {
    if (!this.humans.has(id)) return;
    if (this.phase !== 'hunting') { this.bar(id, 'Gadgets unlock when the hunt begins.', RED); return; }
    const k = this.kit(id);
    if (item === Item.Flashlight) {
      if (!k.lightOn && k.battery < 20) { this.bar(id, 'Battery flat — let it recharge.', RED); return; }
      k.lightOn = !k.lightOn;
      this.sound('click', undefined, id);
      return;
    }
    const trap = item === Item.Mousetrap;
    if ((trap ? k.traps : k.baits) <= 0) {
      this.bar(id, trap ? 'No mousetraps left — they come back after they snap.' : 'No bait left — it comes back after a rat bites.', RED);
      return;
    }
    if (!block || block.ny !== 1 || !collisionBoxes(this.host.getBlock(block.x, block.y, block.z))) {
      this.bar(id, 'Aim at the top of a floor block.', RED);
      return;
    }
    const cell = { x: block.x, y: block.y + 1, z: block.z };
    if (this.host.getBlock(cell.x, cell.y, cell.z) !== Block.Air) { this.bar(id, 'Something is already there.', RED); return; }
    if (!this.canPlaceAt(cell, trap)) { this.bar(id, trap ? 'Too close to another trap — or you can\'t set it here.' : "You can't set that here.", RED); return; }
    if (trap) this.placeTrap(id, cell); else this.placeBait(id, cell);
    this.bar(id, `${trap ? 'Mousetrap set' : 'Bait laid'} in the ${rsRoomAt(cell.x, cell.y, cell.z)}.`, GOLD);
  }

  canPlaceAt(cell: RsPos, trap: boolean): boolean {
    if (this.host.getBlock(cell.x, cell.y, cell.z) !== Block.Air || !collisionBoxes(this.host.getBlock(cell.x, cell.y - 1, cell.z))) return false;
    if (rsPassageAt(cell.x, cell.y, cell.z) || this.nearCage(cell)) return false;
    if (trap) for (const t of this.traps.values()) if (dist2(t, cell) < 9) return false;
    return true;
  }
  private nearCage(p: RsPos): boolean {
    const room = rsRoomAt(p.x, p.y, p.z);
    return room === 'rescue courtyard' || room === 'cage yard' || dist2(p, centre(RS_CAGE)) < 36 || dist2(p, centre(RS_KEEPER)) < 9;
  }
  placeTrap(owner: number, cell: RsPos): boolean {
    const k = this.kit(owner);
    if (k.traps <= 0 || !this.canPlaceAt(cell, true)) return false;
    k.traps--;
    this.traps.set(cellKey(cell.x, cell.y, cell.z), { owner, ...cell });
    this.host.setBlock(cell.x, cell.y, cell.z, Block.ManorMousetrap);
    this.sound('click', centre(cell));
    return true;
  }
  placeBait(owner: number, cell: RsPos): boolean {
    const k = this.kit(owner);
    if (k.baits <= 0 || !this.canPlaceAt(cell, false)) return false;
    k.baits--;
    // Identical to real cheese at a glance.
    this.cheese.push({ id: this.nextEntity++, x: cell.x + 0.5, y: cell.y, z: cell.z + 0.5, bait: true, owner, pickupAt: this.ticks + 20 });
    return true;
  }
  private biteBait(id: number, c: CheeseItem): void {
    this.cheese.splice(this.cheese.indexOf(c), 1);
    this.comboUntil.set(id, 0);
    this.addEffect(id, 'slow', 80, 2);
    this.addEffect(id, 'glow', 80, 0);
    this.title(id, "IT'S A TRAP!", "Sticky bait — you're slowed and glowing", GOLD, 1800);
    const b = this.host.body(id)!;
    this.sound('snap', b);
    this.pointCompasses(b);
    this.notifyHumans(`Bait taken in the ${rsRoomAt(b.x, b.y, b.z)}!`, GOLD);
    this.heat += 0.3;
    for (const bot of this.seekerBots) bot.baitBitten(c.owner, b, id);
    this.kits.get(c.owner)?.baitRefills.push(RS.BAIT_RECHARGE);
  }
  private tickGadgets(): void {
    for (const [id, k] of this.kits) {
      const refill = (list: number[], add: () => void): void => {
        for (let i = list.length - 1; i >= 0; i--) if (--list[i] <= 0) { list.splice(i, 1); add(); }
      };
      refill(k.trapRefills, () => { k.traps = Math.min(RS.TRAP_CHARGES, k.traps + 1); });
      refill(k.baitRefills, () => { k.baits = Math.min(RS.BAIT_CHARGES, k.baits + 1); });
      if (k.lightOn && this.phase !== 'hunting') k.lightOn = false;
      if (k.lightOn) {
        if (--k.battery <= 0) {
          k.battery = 0; k.lightOn = false;
          if (this.humans.has(id)) this.bar(id, 'Flashlight battery died!', RED);
        } else if (this.ticks % 4 === 0) this.beam(id);
      } else if (k.battery < RS.BATTERY && this.ticks % 2 === 0) k.battery++;
    }
    for (const [id, left] of this.spotted) this.spotted.set(id, Math.max(0, left - 1));
    if (this.phase === 'hunting' && this.ticks % 2 === 0 && this.traps.size) {
      for (const id of this.freeRats()) {
        const b = this.host.body(id);
        if (!b) continue;
        const t = this.traps.get(cellKey(Math.floor(b.x), Math.floor(b.y + 0.05), Math.floor(b.z)));
        if (t) this.snap(id, t);
      }
    }
  }
  /** A seeker's flashlight: rats caught in the cone glow. */
  private beam(id: number): void {
    const b = this.host.body(id);
    if (!b) return;
    const eye = this.eye(id);
    const fx = -Math.sin(b.yaw) * Math.cos(b.pitch), fy = Math.sin(b.pitch), fz = -Math.cos(b.yaw) * Math.cos(b.pitch);
    for (const rid of this.freeRats()) {
      const r = this.host.body(rid);
      if (!r) continue;
      const tx = r.x - eye.x, ty = r.y + 0.45 - eye.y, tz = r.z - eye.z;
      const d = Math.hypot(tx, ty, tz);
      if (d > RS.BEAM_RANGE || d < 0.01 || (tx * fx + ty * fy + tz * fz) / d < RS.BEAM_COS) continue;
      if (!this.lineClear(eye, { x: r.x, y: r.y + 0.45, z: r.z })) continue;
      this.addEffect(rid, 'glow', 25, 0);
      if ((this.spotted.get(rid) ?? 0) === 0) {
        this.spotted.set(rid, 10);
        this.bar(rid, 'SPOTTED by a flashlight!', RED);
        this.sound('drum', undefined, rid);
        if (this.humans.has(id)) this.bar(id, `Beam on ${this.host.name(rid)}!`, YELLOW);
        this.heat += 0.1;
      }
    }
  }
  private snap(id: number, t: Trap): void {
    this.traps.delete(cellKey(t.x, t.y, t.z));
    this.host.setBlock(t.x, t.y, t.z, Block.Air);
    const at = { x: t.x + 0.5, y: t.y + 0.1, z: t.z + 0.5 };
    this.addEffect(id, 'slow', 50, 6);
    this.addEffect(id, 'glow', 60, 0);
    this.host.send(id, { t: 'rsImpulse', vx: 0, vy: 0, vz: 0, momentum: 0 });
    this.title(id, 'SNAP!', 'A mousetrap has you pinned', RED, 1500);
    this.sound('snap', at);
    this.pointCompasses(at);
    this.notifyHumans(`SNAP in the ${rsRoomAt(at.x, at.y, at.z)}! ${this.host.name(id)} is pinned!`, RED);
    this.heat += 0.35;
    for (const bot of this.seekerBots) bot.trapSnapped(t.owner, at, id);
    this.kits.get(t.owner)?.trapRefills.push(RS.TRAP_RECHARGE);
  }
  trapCells(): RsPos[] { return [...this.traps.values()]; }

  // ── Rat classes ───────────────────────────────────────────────────────────

  private useAbility(id: number): void {
    const cls = this.classes.get(id);
    if (!cls) return;
    const ready = this.abilityReady.get(id) ?? 0;
    if (ready > this.ticks) { this.bar(id, `${RAT_CLASSES[cls].ability} ready in ${((ready - this.ticks) / 20).toFixed(1)}s`, RED); return; }
    const b = this.host.body(id)!;
    let used = true;
    if (cls === 'scout') {
      this.whiskersUntil.set(id, this.ticks + 100);
      this.sound('squeak', b);
    } else if (cls === 'thief') {
      const near = this.cheese.filter((c) => dist2(c, { x: b.x, y: b.y + 0.2, z: b.z }) <= 36);
      if (!near.length) { this.bar(id, 'No cheese within 6 blocks.', YELLOW); used = false; }
      else {
        for (const c of near) { c.x = b.x; c.y = b.y; c.z = b.z; c.pickupAt = this.ticks; }
        this.sound('twist', b);
        this.bar(id, `Cheese Magnet pulled ${near.length}!`, GOLD);
      }
    } else if (cls === 'trickster') {
      let sx = -Math.sin(b.yaw), sz = -Math.cos(b.yaw);
      const len = Math.hypot(sx, sz) || 1;
      sx = sx / len * 0.26; sz = sz / len * 0.26;
      let x = b.x + sx * 2, z = b.z + sz * 2;
      if (!this.decoyClear(x, b.y, z)) { x = b.x; z = b.z; }
      this.decoys.push({ id: this.nextEntity++, owner: id, x, y: Math.floor(b.y + 0.01), z, sx, sz, ticks: 0, yaw: b.yaw });
      this.sound('decoy', b);
      this.bar(id, 'Decoy away!', PURPLE);
    } else {
      const trap = [...this.traps.values()].find((t) => dist2({ x: t.x + 0.5, y: t.y, z: t.z + 0.5 }, b) <= 9);
      if (!trap) { this.bar(id, 'No mousetrap within 3 blocks.', YELLOW); used = false; }
      else {
        this.traps.delete(cellKey(trap.x, trap.y, trap.z));
        this.host.setBlock(trap.x, trap.y, trap.z, Block.Air);
        this.kits.get(trap.owner)?.trapRefills.push(RS.TRAP_RECHARGE);
        this.addPoints(id, 2);
        this.sound('click', { x: trap.x + 0.5, y: trap.y, z: trap.z + 0.5 });
        this.bar(id, 'Trap disarmed! +2 points', GREEN);
        this.notifyHumans(`A mousetrap in the ${rsRoomAt(trap.x, trap.y, trap.z)} was sabotaged!`, YELLOW);
      }
    }
    if (used) this.abilityReady.set(id, this.ticks + RAT_CLASSES[cls].cooldownTicks);
  }
  private decoyClear(x: number, y: number, z: number): boolean {
    const bx = Math.floor(x), by = Math.floor(y + 0.01), bz = Math.floor(z);
    return !collisionBoxes(this.host.getBlock(bx, by, bz)) && !!collisionBoxes(this.host.getBlock(bx, by - 1, bz));
  }
  private tickAbilities(): void {
    for (const [id, until] of this.whiskersUntil) {
      if (until <= this.ticks || !this.rats.has(id)) { this.whiskersUntil.delete(id); continue; }
      if (this.ticks % 5) continue;
      const b = this.host.body(id);
      if (!b) continue;
      const parts: string[] = [];
      for (const sid of [...this.humans, ...this.botIds]) {
        const s = this.host.body(sid);
        if (!s) continue;
        parts.push(`${arrow(b.yaw, s.x - b.x, s.z - b.z)} ${this.host.name(sid)} ${Math.round(Math.hypot(s.x - b.x, s.z - b.z))}m`);
      }
      this.bar(id, parts.length ? parts.join('   ') : 'No seekers nearby', AQUA);
    }
    for (const d of [...this.decoys]) {
      d.ticks++;
      const nx = d.x + d.sx, nz = d.z + d.sz;
      if (d.ticks >= 80 || !this.decoyClear(nx, d.y, nz)) {
        this.decoys.splice(this.decoys.indexOf(d), 1);
        this.sound('poof', d);
        continue;
      }
      d.x = nx; d.z = nz;
      if (d.ticks % 8 === 0) this.noise(d, 10, 0.3, -1);
    }
  }
  /** A seeker swatted a decoy: a poof, a daze for the seeker, a point for the rat. */
  hitDecoy(d: Decoy, seeker: number, person: boolean): boolean {
    const i = this.decoys.indexOf(d);
    if (i < 0) return false;
    this.decoys.splice(i, 1);
    this.sound('poof', d);
    this.addPoints(d.owner, 1);
    this.bar(d.owner, `${this.host.name(seeker)} fell for your decoy! +1`, PURPLE);
    if (person) {
      this.addEffect(seeker, 'slow', 40, 2);
      this.addEffect(seeker, 'nausea', 60, 0);
      this.title(seeker, 'DECOY!', "That wasn't a real rat", PURPLE, 1500);
    }
    return true;
  }

  // ── House life: chandeliers and Mr. Whiskers ──────────────────────────────

  private startHouseLife(): void {
    for (const c of this.chandeliers) c.up = true;
    const spawn = { x: 0.5, y: 81, z: 6.5 };
    this.cat = { ...spawn, yaw: 0, path: null, pathIndex: 0, nap: 60, distraction: null, distractionTicks: 0, pounceFx: 0, target: -1 };
  }

  private useLever(id: number, block: { x: number; y: number; z: number }): boolean {
    const c = this.chandeliers.find((v) => v.lever.x === block.x && v.lever.y === block.y && v.lever.z === block.z);
    if (!c) return false;
    if (this.phase !== 'hunting' || !c.up) this.bar(id, 'The chandelier rope is tied off.', GRAY);
    else if (this.rats.get(id) !== 'free') this.bar(id, 'Only a rat can chew through the rope.', GRAY);
    else if (c.warning > 0 || c.rehang > 0) this.bar(id, 'That chandelier is already down.', GRAY);
    else {
      c.puller = id;
      c.warning = RS.CHANDELIER_WARNING;
      this.host.setBlock(c.lever.x, c.lever.y, c.lever.z, Block.ManorLeverOn);
      const floor = { x: c.hang.x + 0.5, y: c.hang.y - 4, z: c.hang.z + 0.5 };
      const b = this.host.body(id)!;
      this.noise(b, 20, 0.55, -1);
      for (const bot of this.seekerBots) bot.chandelierWarning(floor, RS.CHANDELIER_WARNING);
      this.sound('chain', centre(c.hang));
      this.bar(id, 'The rope snaps...', GOLD);
    }
    return true;
  }
  private tickChandeliers(): void {
    for (const c of this.chandeliers) {
      if (c.warning > 0) {
        if (--c.warning === 0) this.crash(c);
      } else if (c.rehang > 0 && --c.rehang === 0) {
        this.host.setBlock(c.lever.x, c.lever.y, c.lever.z, Block.ManorLeverOff);
        this.sound('chain', centre(c.hang));
      }
    }
  }
  private crash(c: Chandelier): void {
    c.rehang = RS.CHANDELIER_REHANG;
    const floor = { x: c.hang.x + 0.5, y: c.hang.y - 4, z: c.hang.z + 0.5 };
    this.sound('crash', floor);
    let hits = 0;
    for (const id of this.humans) {
      const b = this.host.body(id);
      if (!b || Math.abs(b.y - floor.y) > 2.5 || Math.hypot(b.x - floor.x, b.z - floor.z) > 2.3) continue;
      hits++;
      this.addEffect(id, 'slow', 50, 3);
      this.addEffect(id, 'blind', 50, 0);
      this.title(id, 'CLANG!', 'A chandelier landed on you', GOLD, 1600);
    }
    for (const bot of this.seekerBots) if (bot.under(floor)) { hits++; bot.stun(50); }
    if (this.rats.has(c.puller) && hits > 0) {
      this.addPoints(c.puller, 3 * hits);
      this.announce(`${this.host.name(c.puller)} dropped a chandelier on ${hits === 1 ? 'a seeker' : `${hits} seekers`}!`, GOLD);
    } else if (this.rats.has(c.puller)) this.bar(c.puller, 'Missed! The chandelier hit nothing.', GRAY);
  }

  private distractCat(at: { x: number; y: number; z: number }): void {
    const cat = this.cat;
    if (!cat || cat.nap > 0 || dist2(cat, at) > 400) return;
    cat.distraction = { x: at.x, y: at.y, z: at.z };
    cat.distractionTicks = 60;
    cat.path = null;
  }
  private catWalk(to: { x: number; y: number; z: number }): void {
    const cat = this.cat!, nav = rsSmallNav();
    cat.path = nav.path(nav.nearest(cat.x, cat.y, cat.z, 2), nav.nearest(to.x, to.y, to.z, 2));
    cat.pathIndex = 1;
  }
  /** Mr. Whiskers moves every tick along his path (so clients see a steady walk);
   *  he decides twice a second. */
  private moveCat(pace: number): void {
    const cat = this.cat;
    if (!cat || !cat.path) return;
    let left = pace;
    while (left > 1e-4 && cat.pathIndex < cat.path.length) {
      const [tx, ty, tz] = cat.path[cat.pathIndex];
      const dx = tx - cat.x, dz = tz - cat.z, d = Math.hypot(dx, dz);
      if (d > 1e-3) {
        // Turn toward the way he is walking instead of snapping at corners.
        let turn = Math.atan2(-dx, -dz) - cat.yaw;
        while (turn > Math.PI) turn -= Math.PI * 2;
        while (turn < -Math.PI) turn += Math.PI * 2;
        cat.yaw += Math.max(-0.5, Math.min(0.5, turn));
      }
      if (d <= left) { cat.x = tx; cat.z = tz; cat.y = ty; left -= d; cat.pathIndex++; continue; }
      cat.x += dx / d * left; cat.z += dz / d * left;
      cat.y += (ty - cat.y) * Math.min(1, left / Math.max(d, 1e-3));
      left = 0;
    }
    if (cat.pathIndex >= cat.path.length) cat.path = null;
  }
  private tickCat(): void {
    const cat = this.cat;
    if (!cat) return;
    if (cat.pounceFx > 0) cat.pounceFx -= 10;
    if (cat.nap > 0) {
      cat.nap -= 10;
      cat.path = null;
      if (cat.nap % 40 === 0) this.sound('purr', cat);
      return;
    }
    if (cat.distractionTicks > 0 && cat.distraction) {
      cat.distractionTicks -= 10;
      if (!cat.path) this.catWalk(cat.distraction);
      if (cat.distractionTicks <= 0 || dist2(cat, cat.distraction) < 2) { cat.distractionTicks = 0; this.sound('meow', cat); }
      return;
    }
    let target = -1, best = RS.CAT_RANGE * RS.CAT_RANGE;
    for (const id of this.freeRats()) {
      const b = this.host.body(id);
      if (!b || rsPassageAt(b.x, b.y, b.z) || Math.abs(b.y - cat.y) > 2.5) continue;
      const d = dist2(b, cat);
      if (d < best) { best = d; target = id; }
    }
    cat.target = target;
    if (target < 0) {
      if (!cat.path) {
        const spawns = rsHouse().spawns;
        this.catWalk(centre(spawns[Math.floor(this.rng() * spawns.length)]));
      }
      return;
    }
    const prey = this.host.body(target)!;
    if (best <= 1.7) { this.pounce(target, prey); return; }
    this.catWalk(prey);
    if (this.rng() < 0.125) this.sound('meow', cat);
  }
  private pounce(id: number, at: RsBody): void {
    const cat = this.cat!;
    cat.x += (at.x - cat.x) * 0.6; cat.z += (at.z - cat.z) * 0.6;
    cat.pounceFx = 20;
    cat.path = null;
    this.addEffect(id, 'slow', 40, 6);
    this.addEffect(id, 'glow', 60, 0);
    this.title(id, 'POUNCE!', 'Mr. Whiskers has you pinned', GRAY, 1500);
    this.sound('pounce', at);
    this.pointCompasses(at);
    this.notifyHumans(`Mr. Whiskers pounced on a rat in the ${rsRoomAt(at.x, at.y, at.z)}!`, GRAY);
    this.heat += 0.25;
    cat.nap = 400;
  }

  // ── Twists ────────────────────────────────────────────────────────────────

  private nextTwistDelay(): number { return RS.TWIST_MIN + Math.floor(this.rng() * (RS.TWIST_SPREAD + 1)); }

  /**
   * How the rats stand, -1 (losing badly) .. +1 (running away with it): the
   * share still free against where an even game would be by now, less the
   * pressure the seekers have been putting on them lately.
   */
  ratStanding(): number {
    if (this.phase !== 'hunting' || !this.rats.size) return 0;
    const elapsed = Math.min(1, (this.ticks - this.huntStartTick) / RS.HUNT_TICKS);
    const free = this.freeRatCount() / this.rats.size;
    return Math.max(-1, Math.min(1, (free - (1 - elapsed)) * 1.2 - this.heat * 0.6));
  }

  private triggerTwist(): void {
    const s = this.ratStanding();
    const weights = TWISTS.map((t) => t === this.lastTwist ? 0
      : t === 'spotlight' ? 1 + 9 * Math.max(0, s)
      : t === 'ghost_rats' ? 1 + 9 * Math.max(0, -s) : 1);
    let roll = this.rng() * weights.reduce((a, b) => a + b, 0), twist: RsTwist = TWISTS[0];
    for (let i = 0; i < TWISTS.length; i++) { roll -= weights[i]; if (roll <= 0) { twist = TWISTS[i]; break; } }
    this.lastTwist = twist;
    this.twistBanner = TWIST_NAMES[twist].toUpperCase();
    this.twistBannerUntil = this.ticks + 200;
    for (const id of this.people) this.sound('twist', undefined, id);
    switch (twist) {
      case 'cheese_rain':
        this.announce('TWIST: CHEESE RAIN! Bonus cheese just appeared around the manor.', GOLD);
        for (let i = 0; i < RS.CHEESE_RAIN_BONUS; i++) this.spawnCheese();
        break;
      case 'hunter_frenzy':
        this.announce("TWIST: HUNTER'S FRENZY! The seeker surges forward — scatter!", RED);
        this.scentReadyAt = 0;
        for (const bot of this.seekerBots) bot.frenzy(100);
        for (const id of this.humans) this.addEffect(id, 'speed', 100, 3);
        break;
      case 'bouncy_house':
        this.announce('TWIST: BOUNCY HOUSE! Everyone gets super jumps for 10 seconds.', GREEN);
        for (const id of this.people) if (this.rats.get(id) !== 'caged') this.addEffect(id, 'jump', 200, 2);
        break;
      case 'ghost_rats':
        this.announce('TWIST: GHOST RATS! Free rats fade from sight for 5 seconds.', WHITE);
        for (const id of this.freeRats()) this.addEffect(id, 'invis', 100, 0);
        break;
      case 'spotlight':
        this.announce('TWIST: SPOTLIGHT! Every free rat glows for 3 seconds.', YELLOW);
        for (const id of this.freeRats()) this.addEffect(id, 'glow', 60, 0);
        break;
      case 'blackout':
        this.announce('TWIST: BLACKOUT! Rats get night vision and a head start.', PURPLE);
        for (const id of this.humans) this.addEffect(id, 'dark', 120, 0);
        for (const bot of this.seekerBots) bot.darkness(120);
        for (const id of this.freeRats()) { this.addEffect(id, 'night', 180, 0); this.addEffect(id, 'speed', 60, 1); }
        break;
      case 'rat_rave':
        this.announce("TWIST: RAT RAVE! Every rat's taunt and scamper are instantly recharged.", PURPLE);
        for (const id of this.freeRats()) {
          this.tauntReady.set(id, 0); this.dashReady.set(id, 0); this.abilityReady.set(id, 0);
          this.sound('squeak', this.host.body(id));
        }
        break;
    }
  }

  /** The practice seeker tunes itself to keep the game close. */
  private adapt(): void {
    const s = this.ratStanding();
    for (const bot of this.seekerBots) bot.adapt(s);
  }

  // ── Safety nets: falls, tunnels, perches ──────────────────────────────────

  private tickSafety(): void {
    if (this.ticks % 10) return;
    for (const id of this.people) {
      const b = this.host.body(id);
      if (!b || b.y >= 66) continue;
      if (this.humans.has(id)) {
        const r = centre(RS_RELEASE);
        this.host.teleport(id, r.x, r.y, r.z);
      } else if (this.rats.get(id) === 'caged') {
        const c = centre(RS_CAGE);
        this.host.teleport(id, c.x, c.y, c.z);
      } else {
        const r = this.ratRespawn();
        this.host.teleport(id, r.x, r.y, r.z);
        this.addEffect(id, 'glow', 160, 0);
        this.bar(id, 'Drainpipe escape! Glowing 8s!', YELLOW);
        this.sound('poof', r);
        this.pointCompasses(r);
        this.notifyHumans(`${this.host.name(id)} slipped through a drainpipe! Compass updated!`, RED);
      }
    }
  }

  private tickSecretPassages(): void {
    if (this.phase !== 'hunting') { this.passageTicks.clear(); this.passageOf.clear(); return; }
    for (const [id, state] of this.rats) {
      const b = this.host.body(id);
      const passage = !b || state !== 'free' ? null : rsPassageAt(b.x, b.y + 0.05, b.z);
      if (!passage) {
        const left = this.passageOf.get(id);
        this.passageOf.delete(id);
        if (left && b && state === 'free') {
          const a = centre(left.exitA), e = centre(left.exitB);
          if (Math.min(dist2(b, a), dist2(b, e)) < 9) for (const bot of this.seekerBots) bot.tunnelExit(left.name, dist2(b, a) < dist2(b, e), id);
        }
        this.passageTicks.delete(id);
        continue;
      }
      const first = !this.passageOf.has(id);
      this.passageOf.set(id, passage);
      if (first) {
        this.bar(id, 'Secret passage — keep moving; the seeker can hear you!', YELLOW);
        this.sound('chain', b!);
        this.noise(b!, 18, 0.5, id);
      }
      const inside = (this.passageTicks.get(id) ?? 0) + 1;
      this.passageTicks.set(id, inside);
      if (inside === RS.SECRET_PASSAGE_WARNING) {
        const exit = this.nearestExit(passage, b!);
        this.addEffect(id, 'glow', 50, 0);
        this.bar(id, 'The tunnel is rattling — get out!', RED);
        this.sound('chain', exit);
        this.pointCompasses(exit);
        this.notifyHumans(`Scratching near the ${passage.name}!`, YELLOW);
      } else if (inside >= RS.SECRET_PASSAGE_LIMIT) {
        const exit = this.nearestExit(passage, b!);
        this.host.teleport(id, exit.x, exit.y, exit.z);
        this.addEffect(id, 'glow', 100, 0);
        this.title(id, 'FLUSHED OUT!', 'Secret passages cannot be camped', RED, 1700);
        this.sound('poof', exit);
        this.pointCompasses(exit);
        this.notifyHumans(`${this.host.name(id)} was flushed from the ${passage.name}!`, RED);
        this.passageTicks.delete(id);
      }
    }
  }
  private nearestExit(p: RsPassage, at: { x: number; y: number; z: number }): RsPos {
    const a = centre(p.exitA), b = centre(p.exitB);
    return dist2(a, at) <= dist2(b, at) ? a : b;
  }

  private tickPerches(): void {
    if (this.ticks % 10) return;
    if (this.phase !== 'hunting') { this.perchTicks.clear(); return; }
    const nav = rsSeekerNav();
    for (const [id, state] of this.rats) {
      const b = this.host.body(id);
      if (!b || state !== 'free') { this.perchTicks.delete(id); continue; }
      const x = Math.floor(b.x), y = Math.floor(b.y + 0.01), z = Math.floor(b.z);
      if (!nav.unfairPerch(x, y, z)) {
        if (this.onGround(b)) this.perchTicks.delete(id);
        continue;
      }
      const held = (this.perchTicks.get(id) ?? 0) + 10;
      this.perchTicks.set(id, held);
      if (held === 40) {
        this.bar(id, "The seeker can't reach you up here — you're slipping! Move!", YELLOW);
        this.sound('chain', b);
      } else if (held >= 100) {
        this.perchTicks.delete(id);
        const cell = nav.landing(x, y, z);
        const land = cell ? centre(cell) : this.ratRespawn();
        this.host.teleport(id, land.x, land.y, land.z);
        this.addEffect(id, 'glow', 60, 0);
        this.bar(id, 'You slipped off! Glowing 3s.', RED);
        this.sound('poof', land);
        this.noise(land, 20, 0.7, id);
      }
    }
  }
  private onGround(b: RsBody): boolean {
    const y = Math.floor(b.y - 0.05);
    return !!collisionBoxes(this.host.getBlock(Math.floor(b.x), y, Math.floor(b.z)));
  }

  /** Every respawn goes as far from the seekers as the house allows. */
  private ratRespawn(): RsPos {
    const spawns = rsHouse().spawns.map(centre);
    const seekers = this.seekerPositions();
    if (!seekers.length) return spawns[Math.floor(this.rng() * spawns.length)];
    let best = spawns[0], bestD = -1;
    for (const s of spawns) {
      const d = Math.min(...seekers.map((k) => dist2(k, s)));
      if (d > bestD) { bestD = d; best = s; }
    }
    return best;
  }

  // ── Effects ───────────────────────────────────────────────────────────────

  addEffect(id: number, kind: Effect, ticks: number, amp: number): void {
    let m = this.effects.get(id);
    if (!m) { m = new Map(); this.effects.set(id, m); }
    const cur = m.get(kind);
    const until = this.ticks + ticks;
    if (!cur || cur.amp < amp || (cur.amp === amp && cur.until < until)) m.set(kind, { until, amp });
  }
  private clearEffect(id: number, kind: Effect): void { this.effects.get(id)?.delete(kind); }
  private clearEffects(id: number): void { this.effects.delete(id); }
  hasEffect(id: number, kind: Effect): boolean { return (this.effects.get(id)?.get(kind)?.until ?? 0) > this.ticks; }
  private effectAmp(id: number, kind: Effect): number {
    const e = this.effects.get(id)?.get(kind);
    return e && e.until > this.ticks ? e.amp + 1 : 0;
  }
  private tickEffects(): void {
    if (this.ticks % 20) return;
    for (const m of this.effects.values()) for (const [k, e] of m) if (e.until <= this.ticks) m.delete(k);
  }
  /** Movement multiplier: rats run Speed I, seekers Speed II and a bit, like the plugin. */
  speedOf(id: number): number {
    const human = !this.rats.has(id);
    const speedLevel = Math.max(human ? 2 : 1, this.effectAmp(id, 'speed'));
    const slow = this.effectAmp(id, 'slow');
    const base = 1 + 0.2 * speedLevel + (human ? 1.2 * RS.HUMAN_SPEED - 1.4 : 0);
    return base * Math.max(0, 1 - 0.15 * slow);
  }
  private syncFx(id: number): void {
    const fx: RsEffects = {
      speed: this.phase === 'results' ? 1 : +this.speedOf(id).toFixed(3),
      jump: this.effectAmp(id, 'jump'),
      blind: this.hasEffect(id, 'blind'), dark: this.hasEffect(id, 'dark'),
      nausea: this.hasEffect(id, 'nausea'), night: this.hasEffect(id, 'night'),
      scale: this.rats.has(id) ? RS.RAT_SCALE : 1,
    };
    const key = JSON.stringify(fx);
    if (this.fxSent.get(id) === key) return;
    this.fxSent.set(id, key);
    this.host.send(id, { t: 'rsFx', fx });
  }

  // ── Kits ──────────────────────────────────────────────────────────────────

  kitOf(id: number): (ItemStack | null)[] {
    const slots: (ItemStack | null)[] = new Array(36).fill(null);
    const one = (item: number, count = 1): ItemStack => ({ id: item, count });
    if (this.rats.has(id)) {
      const caged = this.rats.get(id) === 'caged';
      slots[0] = one(Item.SqueakTaunt);
      slots[1] = one(Item.Scamper);
      if (caged) slots[2] = one(Item.CageRattle);
      const esc = this.escapes.get(id) ?? 0;
      if (esc > 0) slots[3] = one(Item.EscapeCard, esc);
      const cls = this.classes.get(id);
      if (cls && !caged && this.phase === 'hunting') slots[4] = one(RAT_CLASSES[cls].item);
      if (this.phase === 'hiding' || this.phase === 'intro' || this.phase === 'loading') {
        slots[6] = one(cls ? RAT_CLASSES[cls].badge : Item.ClassPicker);
      }
    } else if (this.humans.has(id) || this.botIds.has(id)) {
      const k = this.kit(id);
      slots[0] = one(Item.RatCatcher);
      slots[1] = one(Item.SeekerCompass);
      slots[2] = one(Item.ScentPulse);
      slots[3] = one(Item.Flashlight);
      if (k.traps > 0) slots[4] = one(Item.Mousetrap, k.traps);
      if (k.baits > 0) slots[5] = one(Item.CheeseBait, k.baits);
    }
    if (id === this.leader && this.seekerPickOpen()) slots[8] = one(Item.SeekerPicker);
    return slots;
  }
  private syncKit(id: number): void {
    const slots = this.kitOf(id);
    const key = slots.map((s) => s ? `${s.id}x${s.count}` : '').join(',');
    if (this.kitSent.get(id) === key) return;
    const first = !this.kitSent.has(id);
    this.kitSent.set(id, key);
    this.host.send(id, { t: 'rsKit', slots, selected: first ? 0 : undefined });
  }

  // ── Messages ──────────────────────────────────────────────────────────────

  private announce(text: string, color: string): void { for (const id of this.people) this.host.send(id, { t: 'rsMsg', text, color }); }
  private msgTo(id: number, text: string, color: string): void { this.host.send(id, { t: 'rsMsg', text, color }); }
  bar(id: number, text: string, color: string): void { if (this.people.has(id)) this.host.send(id, { t: 'rsBar', text, color }); }
  private title(id: number, title: string, sub: string, color: string, ms: number): void {
    this.host.send(id, { t: 'rsTitle', title, sub, color, ms });
  }
  /** A sound (and its sparkle) at a place for everyone, or for one person. */
  sound(kind: RsSound, at?: { x: number; y: number; z: number }, to?: number): void {
    const msg: ServerMsg = at ? { t: 'rsSound', kind, x: +at.x.toFixed(2), y: +at.y.toFixed(2), z: +at.z.toFixed(2) } : { t: 'rsSound', kind };
    if (to !== undefined) { this.host.send(to, msg); return; }
    for (const id of this.people) this.host.send(id, msg);
  }

  // ── Sight lines and bodies ────────────────────────────────────────────────

  eye(id: number): { x: number; y: number; z: number } {
    const b = this.host.body(id)!;
    const scale = this.rats.has(id) ? RS.RAT_SCALE : 1;
    return { x: b.x, y: b.y + (b.sneaking ? 1.27 : 1.62) * scale, z: b.z };
  }
  lineClear(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): boolean {
    return clearLine(a.x, a.y, a.z, b.x, b.y, b.z, (x, y, z) => {
      const block = this.host.getBlock(x, y, z);
      return seeThrough(block) ? Block.Air : block;
    });
  }
  body(id: number): RsBody | undefined { return this.host.body(id); }
  drive(id: number, pose: RsPose): void { this.host.drive(id, pose); }
  name(id: number): string { return this.host.name(id); }
  getBlock(x: number, y: number, z: number): number { return this.host.getBlock(x, y, z); }

  // ── Snapshots ─────────────────────────────────────────────────────────────

  private broadcastState(): void {
    const now = this.host.nowMs();
    const phaseMs = this.phase === 'intro' ? RS.INTRO_TICKS * TICK_MS : this.phase === 'hiding' ? RS.HIDE_TICKS * TICK_MS
      : this.phase === 'hunting' ? RS.HUNT_TICKS * TICK_MS : 0;
    const endsAt = phaseMs ? now + this.phaseTicks * TICK_MS : 0;
    const players: RsPlayerView[] = [];
    for (const id of [...this.people, ...this.botIds]) {
      const role = this.roleOf(id);
      if (!role) continue;
      const k = this.kits.get(id);
      players.push({
        id, name: this.host.name(id), role, caged: this.rats.get(id) === 'caged',
        glow: this.hasEffect(id, 'glow'),
        hidden: this.hasEffect(id, 'invis'), points: this.points.get(id) ?? 0,
        trail: (this.comboUntil.get(id) ?? 0) > this.ticks && (this.combos.get(id) ?? 1) >= 2,
        light: !!k?.lightOn,
      });
    }
    const counts = { scout: 0, thief: 0, trickster: 0, tinkerer: 0 } as Record<RatClassId, number>;
    for (const c of this.classes.values()) counts[c]++;
    const r2 = (n: number): number => Math.round(n * 100) / 100;
    const cheese = this.cheese.map((c) => ({ id: c.id, x: r2(c.x), y: r2(c.y), z: r2(c.z) }));
    const decoys = this.decoys.map((d) => ({ id: d.id, x: r2(d.x), y: d.y, z: r2(d.z), yaw: r2(d.yaw) }));
    const cat = this.cat ? { x: r2(this.cat.x), y: r2(this.cat.y), z: r2(this.cat.z), yaw: r2(this.cat.yaw),
      sit: this.cat.nap > 0, pounce: this.cat.pounceFx > 0 } : null;
    const chandeliers = this.chandeliers.map((c) => ({
      x: c.hang.x + 0.5, y: c.hang.y, z: c.hang.z + 0.5,
      drop: !c.up ? -1 : c.warning > 0 ? (c.warning <= 6 ? 1 - c.warning / 6 : 0)
        : c.rehang > 20 ? 1 : c.rehang > 0 ? c.rehang / 20 : 0,
      shake: c.warning > 6,
    }));
    const base = {
      phase: this.phase, serverNow: now, endsAt, phaseMs, players,
      ratCount: this.rats.size, freeRats: this.freeRatCount(), caged: this.cageOrder.length,
      seekers: this.humans.size + this.botIds.size,
      twist: this.twistBannerUntil > this.ticks ? this.twistBanner : '',
      finalMinute: this.phase === 'hunting' && this.phaseTicks <= RS.FINAL_FRENZY_TICKS,
      cheese, decoys, cat, chandeliers, classCounts: counts, classCap: ratClassCap(this.rats.size),
      exchangeLabel: `Rescue / Bank Escape — ${RS.RESCUE_COST} Cheese`,
    };
    for (const id of this.people) {
      const rat = this.rats.has(id);
      const b = this.host.body(id);
      const k = this.kits.get(id);
      const cls = this.classes.get(id) ?? null;
      const cd = (m: Map<number, number>): number => Math.max(0, (m.get(id) ?? 0) - this.ticks);
      const me = {
        role: (rat ? 'rat' : 'human') as RsRole, caged: this.rats.get(id) === 'caged',
        points: this.points.get(id) ?? 0, cheese: this.carried.get(id) ?? 0, escapes: this.escapes.get(id) ?? 0,
        combo: (this.comboUntil.get(id) ?? 0) > this.ticks ? this.combos.get(id) ?? 1 : 1,
        cls, abilityCd: cd(this.abilityReady), tauntCd: cd(this.tauntReady), dashCd: cd(this.dashReady),
        rattleCd: cd(this.rattleReady), scentCd: Math.max(0, this.scentReadyAt - this.ticks),
        light: !!k?.lightOn, battery: k ? k.battery / RS.BATTERY : 1, traps: k?.traps ?? RS.TRAP_CHARGES,
        baits: k?.baits ?? RS.BAIT_CHARGES, room: b ? rsRoomAt(b.x, b.y, b.z) : '',
        compass: (() => {
          const c = this.compass.get(id);
          return c && this.humans.has(id) ? { x: r2(c.x), y: r2(c.y), z: r2(c.z), room: rsRoomAt(c.x, c.y, c.z) } : null;
        })(),
        compassCd: Math.max(0, (this.compassReady.get(id) ?? 0) - this.ticks),
      };
      const sparkles = rat && cls === 'tinkerer' && this.isFreeRat(id) && b ? [
        ...this.trapCells().filter((t) => dist2(t, b) <= 144).map((t) => ({ x: t.x + 0.5, y: t.y + 0.3, z: t.z + 0.5, bait: false })),
        ...this.cheese.filter((c) => c.bait && dist2(c, b) <= 144).map((c) => ({ x: c.x, y: c.y + 0.4, z: c.z, bait: true })),
      ] : [];
      const s: RsSnapshot = { ...base, me, sparkles };
      this.host.send(id, { t: 'rsState', s });
    }
  }
}

/** One of eight arrows pointing from a Worlds yaw toward (dx, dz). */
function arrow(yaw: number, dx: number, dz: number): string {
  const target = Math.atan2(-dx, -dz);
  let rel = target - yaw;
  while (rel > Math.PI) rel -= Math.PI * 2;
  while (rel < -Math.PI) rel += Math.PI * 2;
  // Positive rel turns left (counter-clockwise seen from above).
  const arrows = ['⬆', '⬉', '⬅', '⬋', '⬇', '⬊', '➡', '⬈'];
  return arrows[((Math.round(rel / (Math.PI / 4)) % 8) + 8) % 8];
}
