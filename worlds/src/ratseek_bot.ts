// Rat and Seek: the practice seeker (a port of the plugin's RatSeekBot and
// the squad logic around it). It plays by a person's rules: it only knows
// what it has seen in its field of view with a clear line of sight, heard,
// or been told by the same hints and alarms a person seeking gets. It
// notices rats gradually, turns its head at a human pace, loses rats that
// break line of sight, can miss a swing, and runs no faster than a person.
//
// Unlike the plugin's fixed Rookie/Regular/Veteran levels it ADAPTS: one
// hidden level (0.2 .. 1.35, where 1.0 is a strong player) drives sight,
// reaction, head speed, accuracy, patience and cunning, and slides every
// second toward "keep it close" — sharper while the rats run away with the
// game, gentler while it is winning easily. It starts from where it last
// settled against these rats. Nothing on screen ever says any of this.

import { Item } from './items';
import { RS_RELEASE, rsPassageAt, type RsPos } from './ratseek_house';
import { rsSeekerNav, seeThrough, type NavRoom, type NavSpot } from './ratseek_nav';
import { RS } from './ratseek_rules';
import type { RatSeekMatch } from './ratseek';

type Goal = 'wait' | 'idle' | 'search' | 'investigate' | 'chase' | 'ambush' | 'trap' | 'bait' | 'guard' | 'scent' | 'dodge';
interface Lead { at: RsPos3; strength: number; tick: number; rat: number }
interface RsPos3 { x: number; y: number; z: number }
/** A thing the seeker can see: a rat, or a Trickster's decoy. */
interface Seen { id: number; decoy: boolean; x: number; y: number; z: number; height: number }

const EYE = 1.62;
const REACH = 2.9;
/** A sprinting rat with Speed I, blocks per tick; a seeker runs HUMAN_SPEED times this. */
const RAT_SPRINT = 0.28 * 1.2;
export const SKILL_MIN = 0.2, SKILL_MAX = 1.35;

// ── What the seekers remember between matches (in memory, per server) ──────

const memory = {
  roomWeight: new Map<string, number>(),
  hideWeight: new Map<string, number>(),
  playerRoom: new Map<string, Map<string, number>>(),
  decoyWisdom: 0,
  chandelierWisdom: 0,
  exitA: new Map<string, { a: number; n: number }>(),
  sites: new Map<string, number>(),
};
const cell = (p: RsPos3): string => `${Math.floor(p.x)},${Math.floor(p.y)},${Math.floor(p.z)}`;
function bump(m: Map<string, number>, k: string, by: number, cap = 12): void { m.set(k, Math.min(cap, (m.get(k) ?? 0) + by)); }

function yawTo(dx: number, dz: number): number { return Math.atan2(-dx, -dz); }
function wrap(a: number): number { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; }
function turn(from: number, to: number, max: number): number { return wrap(from + Math.max(-max, Math.min(max, wrap(to - from)))); }
const DEG = Math.PI / 180;

export class SeekerBot {
  // Body.
  x = RS_RELEASE.x + 0.5; y = RS_RELEASE.y; z = RS_RELEASE.z + 0.5;
  private headYaw = 0; private headPitch = 0; private bodyYaw = 0;
  private path: [number, number, number][] | null = null;
  private pathIndex = 0;
  private segFrom: [number, number, number] = [0, 0, 0];
  private pathGoal: RsPos | null = null;
  private moving = false;
  private crouched = false;
  private held: number = Item.RatCatcher;
  private swingNow = false;
  // Mind.
  goal: Goal = 'wait';
  private target: Seen | null = null;
  private readonly awareness = new Map<string, number>();
  private readonly seenThisMatch = new Set<number>();
  private readonly seenThrough = new Set<number>();
  private lastSeen: RsPos3 | null = null;
  private lastSeenMotion = { x: 0, z: 0 };
  private lastSeenTick = 0;
  private lead: Lead | null = null;
  private plannedLead: Lead | null = null;
  private lastLeadTick = 0;
  private lookAt: RsPos3 | null = null;
  private lookUntil = 0;
  private nextGlance = 0;
  private glanceYaw = 0;
  private glancing = false;
  private goalUntil = 0;
  private decideAt = 0;
  // Search plan.
  private room: NavRoom | null = null;
  private plan: NavSpot[] = [];
  private inspecting: NavSpot | null = null;
  private inspectUntil = 0;
  private lookAroundUntil = 0;
  // Errands.
  private errandSite: RsPos | null = null;
  private errandReadyAt = -1;
  private lastTrapTick = -10000;
  private lastBaitTick = -10000;
  private scentAt = 0;
  // Status.
  private nextSwing = 0;
  private stunnedUntil = 0;
  private dazedUntil = 0;
  private frenzyUntil = 0;
  private darkUntil = 0;
  private fooledThisMatch = 0;
  catches = 0;
  /** Rooms searched lately, and where rats were seen (the squad's shared notes). */
  private readonly searchedAt = new Map<string, number>();
  private readonly sightings: { at: RsPos3; tick: number }[] = [];
  private lastCatchTick = 0;
  private momentum = 1;

  constructor(private readonly game: RatSeekMatch, readonly id: number, public skill: number, private readonly rng: () => number) {
    this.skill = Math.max(SKILL_MIN, Math.min(SKILL_MAX, skill));
  }

  // ── The hidden level ────────────────────────────────────────────────────

  /** 0 at the bottom of the scale, 1 at a strong player; "flow" runs past 1. */
  private get k(): number { return (this.skill - SKILL_MIN) / (1 - SKILL_MIN); }
  private get k1(): number { return Math.max(0, Math.min(1, this.k)); }
  private get sight(): number { return 6 + 9.5 * this.k; }
  private get reaction(): number { return 0.35 + 0.8 * this.k; }
  private get turnRate(): number { return (7 + 15 * this.k) * DEG; }
  private get accuracy(): number { return Math.min(0.9, 0.26 + 0.46 * this.k); }
  /** Never faster than a person; at the bottom, a touch slower than a running rat. */
  private get speedShare(): number { return Math.min(1, 0.74 + 0.26 * this.k); }
  private get patience(): number { return 14 + 28 * this.k; }
  private get wits(): number { return Math.min(0.85, 0.05 + 0.42 * this.k); }
  private get thoroughness(): number { return Math.min(1, 0.45 + 0.5 * this.k); }
  private get rhythm(): number { return Math.round(20 - 10 * this.k1); }

  /**
   * Rubber band on the OUTCOME: `standing` is how the rats are doing (-1 losing
   * badly .. +1 running away with it). The level moves toward a close game, a
   * little every second, so a great hider still has to work and a new one
   * still gets away.
   */
  adapt(standing: number): void {
    const step = Math.max(-0.03, Math.min(0.03, standing * 0.035));
    this.skill = Math.max(SKILL_MIN, Math.min(SKILL_MAX, this.skill + step));
  }

  /**
   * The match is over: settle the level for next time. A quick win means the
   * rats were outclassed, so come back gentler; losing to the clock means
   * they were good, so come back sharper.
   */
  settle(seekerWon: boolean, huntFraction: number): void {
    const f = Math.max(0, Math.min(1, huntFraction));
    const delta = seekerWon ? -0.28 * (1 - f) - 0.04 : 0.14;
    this.skill = Math.max(SKILL_MIN, Math.min(SKILL_MAX, this.skill + delta));
  }

  // ── Body ────────────────────────────────────────────────────────────────

  syncFromBody(): void {
    const b = this.game.body(this.id);
    if (b) { this.x = b.x; this.y = b.y; this.z = b.z; this.headYaw = this.bodyYaw = b.yaw; }
  }
  private apply(): void {
    this.game.drive(this.id, {
      x: this.x, y: this.y, z: this.z, yaw: this.headYaw, pitch: this.headPitch, sneaking: this.crouched,
      held: this.game.kit(this.id).lightOn ? Item.Flashlight : this.held, swing: this.swingNow,
    });
    this.swingNow = false;
  }
  private eye(): RsPos3 { return { x: this.x, y: this.y + (this.crouched ? 1.27 : EYE), z: this.z }; }
  private look(): RsPos3 {
    const c = Math.cos(this.headPitch);
    return { x: -Math.sin(this.headYaw) * c, y: Math.sin(this.headPitch), z: -Math.cos(this.headYaw) * c };
  }
  private distanceTo(p: RsPos3): number { return Math.hypot(p.x - this.x, p.y - this.y, p.z - this.z); }

  stun(ticks: number): void { this.stunnedUntil = this.game.ticks + ticks; this.path = null; this.target = null; }
  frenzy(ticks: number): void { this.frenzyUntil = this.game.ticks + ticks; }
  darkness(ticks: number): void { this.darkUntil = this.game.ticks + ticks; }
  private stunned(): boolean { return this.game.ticks < this.stunnedUntil; }
  under(floor: RsPos3): boolean { return Math.hypot(this.x - floor.x, this.z - floor.z) <= 2.3 && Math.abs(this.y - floor.y) <= 2.5; }
  private busy(): boolean { return this.goal === 'chase' || this.goal === 'ambush' || this.goal === 'dodge' || this.stunned(); }

  // ── Phases ──────────────────────────────────────────────────────────────

  /** Waiting in the booth while the rats hide. */
  idle(): void {
    this.headYaw = turn(this.headYaw, Math.sin(this.game.ticks / 40) * 0.6, 0.05);
    this.apply();
  }
  release(): void {
    const r = RS_RELEASE;
    this.x = r.x + 0.5 + (this.rng() - 0.5) * 1.4; this.y = r.y; this.z = r.z + 0.5;
    this.headYaw = this.bodyYaw = 0;
    this.game.drive(this.id, { x: this.x, y: this.y, z: this.z, yaw: 0, pitch: 0, sneaking: false, held: this.held, swing: false });
    // No sniffing or trap-laying the instant the doors open.
    const now = this.game.ticks;
    this.lastLeadTick = now; this.lastTrapTick = now - 250; this.lastBaitTick = now - 300; this.lastCatchTick = now;
    this.target = null; this.lead = null; this.awareness.clear(); this.plan = []; this.inspecting = null;
    this.room = null; this.path = null; this.goal = 'idle'; this.decideAt = now; this.crouched = false;
  }

  tick(): void {
    const now = this.game.ticks;
    if (now % 20 === 0) {
      // A long drought sharpens the seeker a touch (never more than 8%).
      const dry = now - this.lastCatchTick;
      const want = dry > 1800 ? 1.08 : dry > 1200 ? 1.04 : 1;
      this.momentum += Math.max(-0.01, Math.min(0.01, want - this.momentum));
      while (this.sightings.length && now - this.sightings[0].tick > 2400) this.sightings.shift();
    }
    if (this.target && !this.targetValid()) this.target = null;
    if ((now + this.id) % 4 === 0 && !this.stunned()) this.perceive();
    if (now >= this.decideAt) { this.decideAt = now + 10; this.decide(); }
    this.behave();
    this.move(this.pace());
    this.turnHead();
    this.apply();
  }

  private pace(): number {
    let run = RAT_SPRINT * RS.HUMAN_SPEED * this.speedShare;
    const now = this.game.ticks;
    if (now < this.frenzyUntil) run *= 1 + 0.4 / (1.2 * RS.HUMAN_SPEED);
    let pace = this.goal === 'chase' || this.goal === 'dodge' ? run
      : this.goal === 'search' ? (this.inspecting ? 0 : run * 0.8)
      : this.goal === 'investigate' ? (this.lead && this.distanceTo(this.lead.at) < 5 ? run * 0.7 : run)
      : run * 0.9;
    if (this.crouched) pace = Math.min(pace, run * 0.3);
    if (this.target && this.goal === 'chase' && this.distanceTo(this.target) < 1.6) pace *= 0.55;
    if (now < this.stunnedUntil) pace *= 0.4;
    else if (now < this.dazedUntil) pace *= 0.55;
    return pace;
  }

  // ── Movement ────────────────────────────────────────────────────────────

  private walkTo(tx: number, ty: number, tz: number, radius: number): boolean {
    const nav = rsSeekerNav();
    const to = nav.nearest(tx, ty, tz, radius);
    if (!to) return false;
    if (this.pathGoal && this.path && this.pathGoal.x === to.x && this.pathGoal.y === to.y && this.pathGoal.z === to.z) return true;
    const fresh = nav.path(nav.nearest(this.x, this.y, this.z, 2), to);
    if (!fresh) return false;
    this.pathGoal = to;
    if (fresh.length < 2) { this.path = null; return true; }
    this.path = fresh; this.pathIndex = 1; this.segFrom = [this.x, this.y, this.z];
    return true;
  }
  private arrived(): boolean { return !this.path || this.pathIndex >= this.path.length; }
  private move(pace: number): void {
    this.moving = false;
    if (!this.path || this.pathIndex >= this.path.length || pace <= 0) return;
    let left = pace;
    const sx = this.x, sz = this.z;
    while (left > 1e-4 && this.pathIndex < this.path.length) {
      const next = this.path[this.pathIndex];
      const dx = next[0] - this.x, dz = next[2] - this.z, d = Math.hypot(dx, dz);
      if (d <= left) {
        this.x = next[0]; this.z = next[2]; this.y = next[1];
        left -= d; this.segFrom = next; this.pathIndex++;
        continue;
      }
      this.x += dx / d * left; this.z += dz / d * left;
      const span = Math.hypot(next[0] - this.segFrom[0], next[2] - this.segFrom[2]);
      const progress = span < 1e-6 ? 1 : Math.min(1, Math.max(0, 1 - (d - left) / span));
      this.y = this.segFrom[1] + (next[1] - this.segFrom[1]) * this.heightAlong(next, progress);
      left = 0;
    }
    const mx = this.x - sx, mz = this.z - sz;
    if (mx * mx + mz * mz > 1e-6) { this.moving = true; this.bodyYaw = turn(this.bodyYaw, yawTo(mx, mz), 30 * DEG); }
  }
  /** Stairs are a steady slope; a hop arcs over the edge; a drop falls faster and faster. */
  private heightAlong(next: [number, number, number], progress: number): number {
    const rise = next[1] - this.segFrom[1];
    if (Math.abs(rise) < 0.01) return progress;
    if (rise > 0) {
      if (rsSeekerNav().onStairs(Math.floor(next[0]), Math.round(next[1]), Math.floor(next[2]))) return progress;
      return progress < 0.55 ? 1.25 * Math.sin(progress / 0.55 * Math.PI / 2) : 1 + 0.25 * Math.cos((progress - 0.55) / 0.45 * Math.PI / 2);
    }
    const fall = Math.max(0, (progress - 0.35) / 0.65);
    return fall * fall;
  }

  // ── Looking ─────────────────────────────────────────────────────────────

  private turnHead(): void {
    const now = this.game.ticks;
    const max = this.turnRate * (now < this.dazedUntil ? 0.5 : 1);
    let wantYaw = this.headYaw, wantPitch = 0;
    let focus: RsPos3 | null = null;
    if (this.target && this.goal === 'chase') { const c = this.chaseSpot(); focus = { x: c.x, y: c.y + this.target.height * 0.5, z: c.z }; }
    else if (this.inspecting) focus = { x: this.inspecting.hide.x + 0.5, y: this.inspecting.hide.y + 0.3, z: this.inspecting.hide.z + 0.5 };
    else if (this.lookAt && now < this.lookUntil) focus = this.lookAt;
    if (focus) {
      const dx = focus.x - this.x, dz = focus.z - this.z, dy = focus.y - (this.y + (this.crouched ? 1.27 : EYE));
      wantYaw = yawTo(dx, dz);
      wantPitch = Math.atan2(dy, Math.hypot(dx, dz));
    } else if (now < this.lookAroundUntil) {
      wantYaw = wrap(this.bodyYaw + Math.sin(now / 9) * 75 * DEG);
      wantPitch = -12 * DEG;
    } else if (this.moving) {
      if (now >= this.nextGlance) {
        this.glancing = !this.glancing;
        this.glanceYaw = (this.rng() - 0.5) * 140 * DEG;
        this.nextGlance = now + (this.glancing ? 10 + Math.floor(this.rng() * 10) : 30 + Math.floor(this.rng() * 50));
      }
      wantYaw = wrap(this.bodyYaw + (this.glancing ? this.glanceYaw : 0));
      wantPitch = (this.glancing ? -8 : -4) * DEG;
    }
    if (now < this.dazedUntil) wantYaw += Math.sin(now / 3) * 25 * DEG;
    this.headYaw = turn(this.headYaw, wantYaw, max);
    this.headPitch += Math.max(-max, Math.min(max, wantPitch - this.headPitch));
    this.headPitch = Math.max(-60 * DEG, Math.min(70 * DEG, this.headPitch));
    if (!this.moving) {
      const off = wrap(this.headYaw - this.bodyYaw);
      if (Math.abs(off) > 50 * DEG) this.bodyYaw = turn(this.bodyYaw, this.headYaw, Math.abs(off) - 50 * DEG);
    }
  }
  private glanceAt(at: RsPos3, ticks: number): void { this.lookAt = { ...at }; this.lookUntil = this.game.ticks + ticks; }

  // ── Senses ──────────────────────────────────────────────────────────────

  private candidates(): Seen[] {
    const out: Seen[] = [];
    for (const id of this.game.freeRats()) {
      const b = this.game.body(id);
      if (b) out.push({ id, decoy: false, x: b.x, y: b.y, z: b.z, height: 1.8 * RS.RAT_SCALE });
    }
    for (const d of this.game.decoys) out.push({ id: d.id, decoy: true, x: d.x, y: d.y, z: d.z, height: 1.8 * RS.RAT_SCALE });
    return out;
  }
  private targetValid(): boolean {
    const t = this.target!;
    if (t.decoy) return this.game.decoys.some((d) => d.id === t.id);
    return this.game.isFreeRat(t.id);
  }
  private refresh(t: Seen): Seen {
    if (t.decoy) { const d = this.game.decoys.find((v) => v.id === t.id); return d ? { ...t, x: d.x, y: d.y, z: d.z } : t; }
    const b = this.game.body(t.id);
    return b ? { ...t, x: b.x, y: b.y, z: b.z } : t;
  }
  private motionOf(t: Seen): { x: number; z: number; speed: number } {
    if (t.decoy) { const d = this.game.decoys.find((v) => v.id === t.id); return d ? { x: d.sx, z: d.sz, speed: 0.26 } : { x: 0, z: 0, speed: 0 }; }
    return this.game.ratMotion(t.id);
  }
  private key(t: Seen): string { return `${t.decoy ? 'd' : 'r'}${t.id}`; }

  /** Sight: awareness of each rat (and decoy) in view builds up; a full bar means "spotted". */
  private perceive(): void {
    const eye = this.eye(), look = this.look();
    const now = this.game.ticks;
    const sightScale = now < this.darkUntil ? 0.45 : 1;
    const lightOn = this.game.kit(this.id).lightOn;
    let targetSeen = false;
    for (const c of this.candidates()) {
      const k = this.key(c);
      if (c.decoy && this.seenThrough.has(c.id)) continue;
      const cy = c.y + c.height * 0.5;
      const tx = c.x - eye.x, ty = cy - eye.y, tz = c.z - eye.z;
      const d = Math.hypot(tx, ty, tz);
      let rate = 0;
      const isTarget = !!this.target && this.target.id === c.id && this.target.decoy === c.decoy;
      if (d < 36) {
        const angle = d < 0.01 ? 0 : Math.acos(Math.max(-1, Math.min(1, (tx * look.x + ty * look.y + tz * look.z) / d))) / DEG;
        const glowing = !c.decoy && this.game.hasEffect(c.id, 'glow');
        const invisible = !c.decoy && this.game.hasEffect(c.id, 'invis');
        const motion = this.motionOf(c).speed;
        if (glowing && angle < 65 && d < 30 * Math.max(0.5, sightScale)) rate = 0.5;
        else if (invisible) rate = d < 1.8 && motion > 0.05 ? 0.15 : 0;
        else if (angle < 100) {
          const range = this.sight * 0.85 * sightScale * (lightOn && angle < 25 ? 1.45 : 1) * (isTarget ? 1.4 : 1);
          if (d <= range && this.canSee(eye, c, d)) {
            const proximity = 1 - d / range;
            rate = 0.07 + 0.55 * Math.pow(proximity, 1.3);
            const sneaking = !c.decoy && !!this.game.body(c.id)?.sneaking;
            rate *= motion > 0.2 ? 1.7 : motion > 0.05 ? 1.25 : sneaking ? 0.4 : 0.65;
            // A still rat tucked under furniture is easy to overlook, and a
            // weaker seeker overlooks it more.
            if (motion <= 0.05 && this.covered(c)) rate *= 0.03 + 0.4 * this.k1 + 0.25 * Math.max(0, this.k - 1);
            if (angle > 60) rate *= 0.35;
          }
        }
        rate *= this.reaction * this.momentum;
        if (isTarget && rate > 0) rate = Math.max(rate * 2.5, 0.35);
        // Hearing: a running rat's footsteps carry a few blocks round corners.
        if (rate === 0 && !c.decoy && motion > 0.25 && d < 7 && Math.abs(cy - eye.y) < 2.5 && this.rng() < 0.25) {
          this.hear(c, 0.35, 1.6, c.id);
        }
      }
      let level = this.awareness.get(k) ?? 0;
      level = rate > 0 ? Math.min(1.6, level + rate) : Math.max(0, level - 0.12);
      if (level <= 0) this.awareness.delete(k); else this.awareness.set(k, level);
      if (rate > 0 && level >= 1) {
        if (isTarget) {
          targetSeen = true;
          this.lastSeen = { x: c.x, y: c.y, z: c.z };
          const m = this.motionOf(c);
          this.lastSeenMotion = { x: m.x, z: m.z };
          this.lastSeenTick = now;
        } else if (!this.target || (this.goal !== 'chase' && !c.decoy)
          || (!c.decoy && d < 4 && d + 3 < this.distanceTo(this.target))) {
          this.spotted(c);
          targetSeen = true;
        }
      }
    }
    if (this.target && !targetSeen && this.goal === 'chase' && now - this.lastSeenTick > this.patience) this.lostTarget();
  }

  /** Is there something solid right over this body's head (a table, a shelf)? */
  private covered(c: Seen): boolean {
    const x = Math.floor(c.x), z = Math.floor(c.z), y = Math.floor(c.y + 0.01);
    return [1, 2].some((dy) => {
      const b = this.game.getBlock(x, y + dy, z);
      return b !== 0 && !seeThrough(b);
    });
  }

  private canSee(eye: RsPos3, c: Seen, d: number): boolean {
    for (const part of [0.5, 0.9, 0.15]) if (this.game.lineClear(eye, { x: c.x, y: c.y + c.height * part, z: c.z })) return true;
    if ((this.crouched || d < 3.2) && Math.abs(c.y - this.y) < 1.3) {
      return this.game.lineClear({ x: this.x, y: this.y + 0.38, z: this.z }, { x: c.x, y: c.y + Math.min(0.36, c.height * 0.6), z: c.z });
    }
    return false;
  }

  private spotted(c: Seen): void {
    if (c.decoy) {
      const wits = this.wits + this.fooledThisMatch * 0.25 + memory.decoyWisdom * 0.6;
      if (this.rng() < Math.min(0.9, wits)) { this.seenThrough.add(c.id); return; }
    }
    this.target = c;
    this.goal = 'chase';
    this.inspecting = null;
    this.crouched = false;
    this.game.kit(this.id).lightOn = false;
    this.lastSeen = { x: c.x, y: c.y, z: c.z };
    const m = this.motionOf(c);
    this.lastSeenMotion = { x: m.x, z: m.z };
    this.lastSeenTick = this.game.ticks;
    this.decideAt = this.game.ticks;
    if (!c.decoy) {
      this.sightings.push({ at: { x: c.x, y: c.y, z: c.z }, tick: this.game.ticks });
      if (!this.seenThisMatch.has(c.id)) { this.seenThisMatch.add(c.id); this.learnFound(c.id, c); }
    }
  }

  private lostTarget(): void {
    const lost = this.target;
    this.target = null;
    if (this.lastSeen && lost && !lost.decoy) {
      const guess = { x: this.lastSeen.x + this.lastSeenMotion.x * 18, y: this.lastSeen.y, z: this.lastSeen.z + this.lastSeenMotion.z * 18 };
      this.lead = { at: guess, strength: 0.7, tick: this.game.ticks, rat: lost.id };
    }
    this.goal = 'investigate';
    this.path = null;
    this.decideAt = this.game.ticks;
  }

  /** A sound or a report. Weaker, older leads give way to stronger, fresher ones. */
  private hear(at: RsPos3, strength: number, fuzz: number, rat: number): void {
    if (this.stunned() || this.goal === 'chase') return;
    if (this.lead && this.effective(this.lead) > strength) return;
    const spread = fuzz + this.distanceTo(at) * 0.08;
    const guess = { x: at.x + (this.rng() - 0.5) * 2 * spread, y: at.y, z: at.z + (this.rng() - 0.5) * 2 * spread };
    this.lead = { at: guess, strength, tick: this.game.ticks, rat };
    this.lastLeadTick = this.game.ticks;
    this.glanceAt({ x: at.x, y: at.y + 0.4, z: at.z }, 20);
    if (this.goal !== 'dodge' && this.goal !== 'scent') {
      this.decideAt = Math.min(this.decideAt, this.game.ticks + 3 + Math.floor(this.rng() * 6));
    }
  }
  private effective(l: Lead): number { return l.strength - (this.game.ticks - l.tick) / 500; }

  /** Noise in the house: in earshot, the seeker turns to it. */
  noise(at: RsPos3, radius: number, strength: number, rat: number): void {
    const range = Math.abs(this.y - at.y) > 4 ? radius * 0.5 : radius;
    const d = this.distanceTo(at);
    if (d <= range) this.hear(at, strength * (1 - 0.5 * d / range), 1, rat);
  }
  /** A compass alarm (a trap, bait, a rescue, a flush...). */
  alert(at: RsPos3): void { if (!this.busy()) this.hear(at, 0.9, 0.8, -1); }
  /** The periodic hint: roughly where one rat is. A sharp seeker reads it
   *  like a map; a weaker one only takes in "somewhere over that side". */
  hint(at: RsPos3): void {
    if (this.busy()) return;
    // A weaker seeker sometimes shrugs a hint off and keeps to its own search.
    if (this.rng() > 0.15 + 0.75 * this.k1) return;
    const sloppy = 1 - this.k1;
    this.hear(at, 0.45 + 0.15 * this.k1, 2.5 + 16 * sloppy, -1);
  }

  // ── Decisions ───────────────────────────────────────────────────────────

  private decide(): void {
    const now = this.game.ticks;
    if (this.stunned()) { this.path = null; this.goal = 'idle'; return; }
    if (this.goal === 'dodge' && now < this.goalUntil && !this.arrived()) return;
    if (this.target && this.targetValid()) { this.chase(); return; }
    if (this.goal === 'chase') this.goal = 'idle';
    if (this.goal === 'ambush' && now < this.goalUntil) return;
    if (this.lead && this.effective(this.lead) > 0.12) { this.investigate(); return; }
    this.lead = null;
    if ((this.goal === 'trap' || this.goal === 'bait' || this.goal === 'scent') && now < this.goalUntil) return;
    if (this.goal === 'search' && this.room && (this.inspecting || this.plan.length || !this.arrived())) return;
    if (this.goal === 'search' && this.room) this.searchedAt.set(this.room.name, now);
    this.chooseNext();
  }

  private chooseNext(): void {
    const now = this.game.ticks;
    this.crouched = false;
    this.game.kit(this.id).lightOn = false;
    this.held = Item.RatCatcher;
    const cunning = 0.3 + 0.9 * this.k1;
    if (this.game.scentReady() && now - this.lastLeadTick > 200 / cunning && this.rng() < 0.55 * cunning) {
      this.goal = 'scent'; this.goalUntil = now + 12; this.scentAt = now + 8; this.path = null; this.held = Item.ScentPulse;
      return;
    }
    const k = this.game.kit(this.id);
    if (k.traps > 0 && now - this.lastTrapTick > 500 / cunning && this.rng() < 0.45 * cunning) {
      const site = this.pickSite('trap');
      if (site && this.walkTo(site.x + 0.5, site.y, site.z + 0.5, 2)) { this.errand('trap', site); return; }
    }
    if (k.baits > 0 && now - this.lastBaitTick > 700 / cunning && this.rng() < 0.35 * cunning) {
      const site = this.pickSite('bait');
      if (site && this.walkTo(site.x + 0.5, site.y, site.z + 0.5, 2)) { this.errand('bait', site); return; }
    }
    this.startSearch();
  }

  private errand(kind: 'trap' | 'bait', site: RsPos): void {
    this.goal = kind; this.errandSite = site; this.errandReadyAt = -1; this.goalUntil = this.game.ticks + 400;
    if (kind === 'trap') this.lastTrapTick = this.game.ticks; else this.lastBaitTick = this.game.ticks;
  }

  private startSearch(): void {
    this.room = this.pickRoom();
    this.plan = [];
    this.inspecting = null;
    if (!this.room) { this.goal = 'idle'; return; }
    const spots = [...this.room.spots];
    const keep = Math.max(2, Math.ceil(spots.length * this.thoroughness));
    const score = new Map(spots.map((s) => [s, this.spotScore(s)]));
    spots.sort((a, b) => score.get(b)! - score.get(a)!);
    this.plan = spots.slice(0, Math.min(keep, spots.length));
    this.orderPlan();
    this.goal = 'search';
    const c = this.room.centre;
    if (!this.walkTo(c.x + 0.5, c.y, c.z + 0.5, 2)) {
      this.searchedAt.set(this.room.name, this.game.ticks);
      this.room = null; this.goal = 'idle';
    }
  }
  private orderPlan(): void {
    const ordered: NavSpot[] = [];
    let cx = this.x, cz = this.z;
    const left = [...this.plan];
    while (left.length) {
      let best = 0, bestScore = Infinity;
      left.forEach((s, i) => {
        const score = Math.hypot(s.from.x + 0.5 - cx, s.from.z + 0.5 - cz) - (left.length - i) * 0.6;
        if (score < bestScore) { bestScore = score; best = i; }
      });
      const s = left.splice(best, 1)[0];
      ordered.push(s); cx = s.from.x + 0.5; cz = s.from.z + 0.5;
    }
    this.plan = ordered;
  }
  private pickRoom(): NavRoom | null {
    const nav = rsSeekerNav();
    const here = nav.roomOf(Math.floor(this.x), Math.floor(this.y), Math.floor(this.z));
    const names = this.game.freeRats().map((id) => this.game.name(id));
    let best: NavRoom | null = null, bestScore = -1;
    for (const room of nav.rooms) {
      const last = this.searchedAt.get(room.name);
      const stale = last === undefined ? 1 : Math.min(1, (this.game.ticks - last) / 900);
      let prior = 1 + Math.min(2.5, (memory.roomWeight.get(room.name) ?? 0) * 0.15);
      for (const n of names) prior += (memory.playerRoom.get(n)?.get(room.name) ?? 0) * 1.2 * Math.min(1, this.skill);
      for (const s of this.sightings) if (nav.roomOf(Math.floor(s.at.x), Math.floor(s.at.y), Math.floor(s.at.z)) === room.name) prior += 0.25;
      const c = room.centre;
      const distance = Math.hypot(c.x + 0.5 - this.x, c.z + 0.5 - this.z) + Math.abs(c.y - this.y) * 2.5;
      const near = 1 / (1 + distance / 30);
      const hereBonus = room.name === here && stale > 0.5 ? 1.5 : 1;
      const score = prior * (0.05 + stale) * near * hereBonus * (0.75 + this.rng() * 0.5);
      if (score > bestScore) { bestScore = score; best = room; }
    }
    return best;
  }
  private spotScore(s: NavSpot): number {
    return this.rng() * 0.8 + (s.low ? 0.2 : 0) + Math.min(2, (memory.hideWeight.get(cell(s.hide)) ?? 0) * 0.8) * Math.min(1, this.skill);
  }
  private pickSite(kind: 'trap' | 'bait'): RsPos | null {
    const nav = rsSeekerNav();
    const candidates: RsPos[] = kind === 'trap' ? [...nav.chokepoints()] : [];
    for (const room of nav.rooms) for (const s of room.spots) if (s.name === 'cheese spot') candidates.push(s.hide);
    let best: RsPos | null = null, bestScore = -1e9;
    for (const c of candidates) {
      const at = { x: c.x + 0.5, y: c.y, z: c.z + 0.5 };
      const d = this.distanceTo(at);
      if (d > 30 || !this.game.canPlaceAt(c, kind === 'trap') || (kind === 'bait' && this.game.cheeseNear(at, 1.4))) continue;
      let score = (memory.sites.get(`${kind}:${cell(c)}`) ?? 0.5) + this.rng() * 0.4 - d / 35;
      for (const s of this.sightings) if ((s.at.x - at.x) ** 2 + (s.at.z - at.z) ** 2 < 49) score += 0.3;
      if (score > bestScore) { bestScore = score; best = c; }
    }
    return best;
  }

  private investigate(): void {
    if (this.goal !== 'investigate' || !this.path || this.plannedLead !== this.lead) {
      this.goal = 'investigate';
      this.plannedLead = this.lead;
      this.inspecting = null;
      this.crouched = false;
      if (!this.walkTo(this.lead!.at.x, this.lead!.at.y, this.lead!.at.z, 3)) { this.lead = null; this.goal = 'idle'; }
    }
  }

  /** Where the seeker believes its target is: live while seen, else carried on along its last heading. */
  private chaseSpot(): RsPos3 {
    const unseen = this.game.ticks - this.lastSeenTick;
    const t = this.refresh(this.target!);
    if (unseen <= 4 || !this.lastSeen) return t;
    const k = Math.min(unseen, 12);
    return { x: this.lastSeen.x + this.lastSeenMotion.x * k, y: this.lastSeen.y, z: this.lastSeen.z + this.lastSeenMotion.z * k };
  }

  private chase(): void {
    const now = this.game.ticks;
    if (this.goal === 'ambush') {
      const b = this.target && !this.target.decoy ? this.game.body(this.target.id) : undefined;
      if (now < this.goalUntil && b && rsPassageAt(b.x, b.y + 0.05, b.z)) return;
      if (now >= this.goalUntil) { this.target = null; this.goal = 'idle'; return; }
    }
    this.goal = 'chase';
    const at = this.chaseSpot();
    const t = this.target!;
    const tb = !t.decoy ? this.game.body(t.id) : undefined;
    if (tb && rsPassageAt(tb.x, tb.y + 0.05, tb.z) && this.lastSeen && (this.lastSeen.x - tb.x) ** 2 + (this.lastSeen.z - tb.z) ** 2 < 36) {
      // People don't fit in the ducts: cut the rat off at the end it will probably use.
      const exit = this.predictExit(tb);
      if (exit && this.walkTo(exit.x, exit.y, exit.z, 2)) {
        this.goal = 'ambush';
        this.goalUntil = now + 100 + Math.round(40 * this.skill);
        this.glanceAt({ x: exit.x, y: exit.y + 0.3, z: exit.z }, 140);
        return;
      }
    }
    if (!this.walkTo(at.x, at.y, at.z, 3)) { this.lostTarget(); return; }
    const low = this.y + 1.3 - at.y;
    this.crouched = this.distanceTo(at) < 3.5 && low > 0.9 && !this.game.lineClear(this.eye(), { x: at.x, y: at.y + t.height * 0.5, z: at.z });
  }

  private predictExit(rat: RsPos3): RsPos3 | null {
    const p = rsPassageAt(rat.x, rat.y + 0.05, rat.z);
    if (!p) return null;
    const a = { x: p.exitA.x + 0.5, y: p.exitA.y, z: p.exitA.z + 0.5 }, b = { x: p.exitB.x + 0.5, y: p.exitB.y, z: p.exitB.z + 0.5 };
    const m = this.lastSeenMotion;
    const towardsA = m.z < -0.05 ? 0.9 : m.z > 0.05 ? 0.1
      : (rat.z - a.z) ** 2 < (rat.z - b.z) ** 2 ? 0.65 : 0.35;
    const learned = memory.exitA.get(p.name);
    const chanceA = learned && learned.n > 0 ? 0.55 * towardsA + 0.45 * (learned.a / learned.n) : towardsA;
    const pickA = this.skill < 0.6 ? this.rng() < chanceA : chanceA >= 0.5;
    return pickA ? a : b;
  }

  // ── Per-tick behaviour ──────────────────────────────────────────────────

  private behave(): void {
    const now = this.game.ticks;
    switch (this.goal) {
      case 'chase':
        if ((now + this.id) % 4 === 0 && this.target) {
          const at = this.chaseSpot();
          const g = this.pathGoal;
          if (!g || Math.hypot(g.x + 0.5 - at.x, g.z + 0.5 - at.z) > 1.2 || Math.abs(g.y - at.y) > 1.5) this.walkTo(at.x, at.y, at.z, 3);
        }
        this.tryCatch();
        break;
      case 'search': this.tickSearch(); break;
      case 'investigate':
        if (this.arrived() && this.lead) {
          if (this.lookAroundUntil < now) {
            this.lookAroundUntil = now + 30 + Math.floor(this.rng() * 20);
            const k = this.game.kit(this.id);
            if (k.battery > 0.4 * RS.BATTERY && this.rng() < 0.4 * this.skill) k.lightOn = true;
          }
          this.lead = null;
          this.decideAt = this.lookAroundUntil;
        }
        break;
      case 'ambush':
        this.crouched = false;
        if (now >= this.goalUntil) { this.goal = 'idle'; this.decideAt = now; }
        break;
      case 'trap': case 'bait': this.tickErrand(); break;
      case 'scent':
        if (now === this.scentAt) {
          const found = this.game.botScentPulse(this.id);
          this.held = Item.RatCatcher;
          if (found >= 0) { const b = this.game.body(found); if (b) this.hear(b, 0.85, 1, found); }
          this.goalUntil = now;
        }
        break;
      case 'dodge':
        if (this.arrived()) { this.goal = 'idle'; this.decideAt = now; }
        break;
      default:
    }
    if (this.goal !== 'chase' && (!this.target || this.targetValid())) this.tryCatch();
  }

  private tickSearch(): void {
    const now = this.game.ticks;
    if (this.inspecting) {
      if (now >= this.inspectUntil) { this.inspecting = null; this.crouched = false; this.game.kit(this.id).lightOn = false; }
      return;
    }
    if (!this.arrived()) return;
    if (!this.plan.length) { if (this.lookAroundUntil < now - 60) this.lookAroundUntil = now + 25; return; }
    const next = this.plan[0];
    const f = next.from;
    if (Math.hypot(f.x + 0.5 - this.x, f.z + 0.5 - this.z) > 1.2 || Math.abs(f.y - this.y) > 0.6) {
      if (!this.walkTo(f.x + 0.5, f.y, f.z + 0.5, 1)) this.plan.shift();
      return;
    }
    this.plan.shift();
    this.inspecting = next;
    this.inspectUntil = now + 12 + Math.floor(this.rng() * 12);
    this.crouched = next.low;
    const k = this.game.kit(this.id);
    if (k.battery > 0.35 * RS.BATTERY && this.rng() < 0.3 * this.skill) k.lightOn = true;
  }

  private tickErrand(): void {
    const now = this.game.ticks;
    if (!this.errandSite || now >= this.goalUntil) { this.goal = 'idle'; this.decideAt = now; return; }
    if (!this.arrived()) return;
    const site = { x: this.errandSite.x + 0.5, y: this.errandSite.y, z: this.errandSite.z + 0.5 };
    if (this.errandReadyAt < 0) {
      this.errandReadyAt = now + 10;
      this.crouched = true;
      this.held = this.goal === 'trap' ? Item.Mousetrap : Item.CheeseBait;
      this.glanceAt(site, 12);
      return;
    }
    this.glanceAt(site, 5);
    if (now < this.errandReadyAt) return;
    this.swingNow = true;
    const placed = this.goal === 'trap' ? this.game.placeTrap(this.id, this.errandSite) : this.game.placeBait(this.id, this.errandSite);
    if (placed) bump(memory.sites, `${this.goal}:${cell(this.errandSite)}`, 0.05, 3);
    this.crouched = false;
    this.held = Item.RatCatcher;
    this.errandSite = null;
    this.goal = 'idle';
    this.decideAt = now + 4;
  }

  // ── Catching ────────────────────────────────────────────────────────────

  /** Horizontal distance to something swingable right now, or -1. */
  private swingRange(v: Seen, maxFacing: number): number {
    const dx = v.x - this.x, dz = v.z - this.z, horizontal = Math.hypot(dx, dz);
    const reach = this.crouched ? RS.SWAT_REACH : REACH;
    const rise = v.y + Math.min(0.2, v.height * 0.3) - (this.y + EYE);
    if (horizontal > reach + 0.3 || v.y - this.y < -2.2 || Math.hypot(horizontal, Math.max(0, rise)) > 3.1) return -1;
    if (horizontal > 0.6 && Math.abs(wrap(yawTo(dx, dz) - this.headYaw)) > maxFacing * DEG) return -1;
    const eye = this.eye();
    const sight = this.game.lineClear(eye, { x: v.x, y: v.y + v.height * 0.5, z: v.z })
      || this.game.lineClear(eye, { x: v.x, y: v.y + v.height * 0.9, z: v.z })
      || (Math.abs(v.y - this.y) < 1.2 && this.game.lineClear({ x: this.x, y: this.y + 0.38, z: this.z },
        { x: v.x, y: v.y + Math.min(0.36, v.height * 0.6), z: v.z }));
    return sight ? horizontal : -1;
  }
  /** A rat right in front of the seeker that it isn't chasing: it swings at what it runs into. */
  private bystander(): Seen | null {
    let best: Seen | null = null, bestRange = Infinity;
    for (const c of this.candidates()) {
      if (c.decoy || (this.target && !this.target.decoy && this.target.id === c.id) || this.game.hasEffect(c.id, 'invis')) continue;
      if ((this.awareness.get(this.key(c)) ?? 0) < 0.3 && this.game.ratMotion(c.id).speed < 0.05) continue;
      const r = this.swingRange(c, 60);
      if (r >= 0 && r < bestRange) { best = c; bestRange = r; }
    }
    return best;
  }
  private tryCatch(): void {
    const now = this.game.ticks;
    if (now < this.nextSwing || this.stunned()) return;
    let target = this.target ? this.refresh(this.target) : null;
    let horizontal = target ? this.swingRange(target, 40) : -1;
    if (horizontal < 0) {
      const other = this.bystander();
      if (!other) return;
      this.target = other; target = other;
      this.goal = 'chase';
      this.lastSeen = { x: other.x, y: other.y, z: other.z };
      const m = this.motionOf(other);
      this.lastSeenMotion = { x: m.x, z: m.z };
      this.lastSeenTick = now;
      horizontal = this.swingRange(other, 60);
    }
    const reach = this.crouched ? RS.SWAT_REACH : REACH;
    this.nextSwing = now + this.rhythm + Math.floor(this.rng() * 6);
    this.swingNow = true;
    this.game.sound('click', { x: this.x, y: this.y + 1, z: this.z });
    if (target!.decoy) {
      const d = this.game.decoys.find((v) => v.id === target!.id);
      if (d && this.game.hitDecoy(d, this.id, false)) {
        this.fooledThisMatch++;
        memory.decoyWisdom = Math.min(1, memory.decoyWisdom + 0.08);
        this.dazedUntil = now + 40;
        this.target = null;
        this.goal = 'idle';
      }
      return;
    }
    let chance = this.accuracy * this.momentum;
    const speed = this.game.ratMotion(target!.id).speed;
    if (speed > 0.22) chance *= 0.55 + 0.25 * Math.min(1, this.skill); // a dodging rat is hard to tag
    if (horizontal > reach - 0.4) chance *= 0.8;
    if (now < this.dazedUntil) chance *= 0.5;
    if (this.rng() < chance) {
      this.catches++;
      const rat = target!.id;
      this.target = null;
      this.goal = 'idle';
      this.crouched = false;
      this.decideAt = now + 20;
      this.lastCatchTick = now;
      this.momentum = Math.max(0.94, this.momentum - 0.02);
      this.game.botCatch(this.id, rat);
    }
  }

  // ── House events ────────────────────────────────────────────────────────

  /** A chandelier overhead is about to drop: a sharp (or experienced) seeker jumps clear. */
  chandelierWarning(floor: RsPos3, ticksLeft: number): void {
    const dx = this.x - floor.x, dz = this.z - floor.z;
    if (dx * dx + dz * dz > 3.2 * 3.2 || Math.abs(this.y - floor.y) > 2.5 || this.stunned()) return;
    const chance = 0.25 + (this.reaction - 0.6) * 0.35 + memory.chandelierWisdom * 0.5;
    if (this.rng() >= Math.min(0.9, chance)) { this.glanceAt({ x: floor.x, y: floor.y + 4, z: floor.z }, 15); return; }
    const len = Math.hypot(dx, dz);
    const ux = len < 0.1 ? 1 : dx / len, uz = len < 0.1 ? 0 : dz / len;
    if (this.walkTo(floor.x + ux * 3.8, floor.y, floor.z + uz * 3.8, 2)) {
      this.goal = 'dodge'; this.goalUntil = this.game.ticks + ticksLeft + 10; this.target = null;
    }
  }

  // ── Learning ────────────────────────────────────────────────────────────

  private learnFound(rat: number, at: RsPos3): void {
    const nav = rsSeekerNav();
    const room = nav.roomOf(Math.floor(at.x), Math.floor(at.y), Math.floor(at.z));
    if (room) {
      bump(memory.roomWeight, room, 1);
      const name = this.game.name(rat);
      let m = memory.playerRoom.get(name);
      if (!m) { m = new Map(); memory.playerRoom.set(name, m); if (memory.playerRoom.size > 400) memory.playerRoom.delete(memory.playerRoom.keys().next().value!); }
      bump(m, room, 0.5, 3);
    }
    const hide = this.hideNear(at);
    if (hide) bump(memory.hideWeight, cell(hide.hide), 0.5, 3);
  }
  private hideNear(at: RsPos3): NavSpot | null {
    let best: NavSpot | null = null, bestD = 1.8 * 1.8;
    for (const room of rsSeekerNav().rooms) for (const s of room.spots) {
      const d = (s.hide.x + 0.5 - at.x) ** 2 + (s.hide.y - at.y) ** 2 * 2 + (s.hide.z + 0.5 - at.z) ** 2;
      if (d < bestD) { bestD = d; best = s; }
    }
    return best;
  }
  /** Any catch (a person's too) teaches where rats like to hide. */
  caught(rat: number, at?: RsPos3): void {
    if (!at) return;
    this.learnFound(rat, at);
    this.sightings.push({ at: { ...at }, tick: this.game.ticks });
    this.lastCatchTick = this.game.ticks;
  }
  trapSnapped(owner: number, at: RsPos3, _rat: number): void {
    this.sightings.push({ at, tick: this.game.ticks });
    if (owner === this.id) bump(memory.sites, `trap:${cell(at)}`, 0.4, 3);
  }
  baitBitten(owner: number, at: RsPos3, _rat: number): void {
    this.sightings.push({ at, tick: this.game.ticks });
    if (owner === this.id) bump(memory.sites, `bait:${cell(at)}`, 0.4, 3);
  }
  tunnelExit(passage: string, exitA: boolean, _rat: number): void {
    const e = memory.exitA.get(passage) ?? { a: 0, n: 0 };
    e.n = Math.min(40, e.n + 1); e.a = Math.min(e.n, e.a + (exitA ? 1 : 0));
    memory.exitA.set(passage, e);
  }
}
