// Server-only practice opponent for The Bridge and Parkour.
//
// Bots drive the SAME Player collision, gravity, speed and jump height as a
// human client, and every action they take goes through the same server
// validation (reach, facing, cooldowns, build rules). They never move faster,
// hit harder or reach further than a person can; what changes with skill is
// only how well they play within those rules.
//
// SKILL runs from 0.15 (a first-timer) through 1.0 (a strong regular) up to
// 1.35 ("flow"): chained landings with no pause, perfect take-offs, hits timed
// to the frame. A live controller keeps every match close by pulling the level
// toward whatever the scoreline or race gap calls for, with enough range and
// speed that a player who is running away with it meets a bot that can
// genuinely catch them. The level it settles at is remembered for the next
// match (hidden — nothing ever shows it).

import { Player } from './player';
import { Block, BLOCKS } from './blocks';
import { FROZEN_INPUT, type PlayerInput } from './input';
import type { World } from './world';
import {
  BRIDGE_GOALS, BRIDGE_LANE_X, BRIDGE_MELEE_TIER, BRIDGE_ARROW_SPEED, PARTY_FLOOR_Y, bridgeGoalGuard, parkourCourse,
  type PartyLobbySnapshot, type PartyParticipant, type PartyVec3,
} from './partygames';
import type { ParkourPlatform } from './parkour_course';
import { CRUMBLE_CRACKED, blinkSolid, parkourPadImpulse, parkourPadUnder } from './parkour_mechanics';
import type { WorldGenerator } from './multiverse';

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const isWool = (block: number) => block === Block.TeamWoolA || block === Block.TeamWoolB;
const RUN: PlayerInput = { ...FROZEN_INPUT, forward: true, sprintKey: true, sprintHeld: true };
interface JumpPlan { x: number; z: number; yaw: number; speed: number }

const PARTY_BOT_MIN_SKILL = 0.15;
const PARTY_BOT_MAX_SKILL = 1.35;
/** Where a first-ever bot starts, before it has seen the player play. */
const PARTY_BOT_START_SKILL = 0.55;

interface BotAction {
  melee?: boolean;
  shot?: { dx: number; dy: number; dz: number };
  edit?: PartyVec3 & { block: number };
  /** Show wool in hand (building), rather than the axe. */
  holdWool?: boolean;
}

/** Combat behaviour switches (kept as data so the simulation harness can
 *  measure each one's worth). */
const BRIDGE_TACTICS = { critHops: false, timedCrits: true, wTap: false, lean: true, leanMax: 0.43, engageBonus: 5, strafe: true, bow: true };

/** Where on a crumble pad to aim a landing, relative to its centre: most of
 *  the way to the edge it will be left from. */
function crumbleLead(b: ParkourPlatform): { x: number; z: number } {
  const alongX = b.heading % 2 === 1, sign = b.heading < 2 ? 1 : -1;
  const reach = Math.max(0, (alongX ? b.width : b.depth) / 2 - .75);
  return alongX ? { x: sign * reach, z: 0 } : { x: 0, z: sign * reach };
}

/** 0 at the bottom of the scale, 1 at a strong regular's level. */
/** Ballistics: could a jump from (x, y, z) reach pad `b` at all? A cheap
 *  test run before the full simulation. Jump 1.25 blocks, gravity 32; air
 *  control pulls any run-up toward sprint speed, so only a full sprint's
 *  reach (plus slack) rules a jump out. */
function withinJump(x: number, y: number, z: number, b: ParkourPlatform, minX: number, minZ: number): boolean {
  const rise = b.y - y;
  if (rise > 1.2) return false;
  const vy = Math.sqrt(2 * 32 * 1.25), air = (vy + Math.sqrt(vy * vy - 2 * 32 * Math.max(rise, -40))) / 32;
  const gapX = Math.max(0, Math.abs(minX + b.x - x) - b.width / 2), gapZ = Math.max(0, Math.abs(minZ + b.z - z) - b.depth / 2);
  return 5.612 * air + .75 >= Math.hypot(gapX, gapZ);
}
function competence(s: number): number { return clamp((s - PARTY_BOT_MIN_SKILL) / (1 - PARTY_BOT_MIN_SKILL), 0, 1); }
/** 0 up to 1.0, rising to 1 at the top of the scale. */
function flow(s: number): number { return clamp((s - 1) / (PARTY_BOT_MAX_SKILL - 1), 0, 1); }

export class PartyBot {
  readonly body: Player;
  skill: number;
  /** The level this player has proven across matches. Live adaptation pulls
   *  around it and drags it along, so it follows the player up (or down). */
  anchor: number;
  /** Displayed look pitch (radians). */
  pitch = 0;
  /** Freeze adaptation (tests and the simulation harness). */
  fixedSkill = false;
  private nextThink = 0;
  private nextAttack = 0;
  private nextShot = 0;
  private nextBuild = 0;
  private adaptAt = 0;
  private input = { ...FROZEN_INPUT };
  private aim = 0;
  private pauseUntil = 0;
  private progress = -1;
  private jumping = false;
  private jumpAt = 0;
  private plan?: JumpPlan;
  private plans = new Map<string, JumpPlan | null>();
  private lastPad = -1;
  private nextShortcut = 0;
  private nextReplan = 0;
  private navigation: PartyVec3[] = [];
  private strafe = 1;
  private strafeUntil = 0;
  private nextClutch = 0;
  private hurtAt = -1e9;
  private critJumpAt = -1e9;
  /** When we last hopped a step up (keeps the feet moving through the air). */
  private hopAt = -1e9;
  private nextUndercut = 0;
  private nextWall = 0;
  /** Yaw offset to apply on the tick a swing goes out: aims the knockback
   *  toward the nearer edge without steering the walk off the span. */
  private swingLean = 0;
  private enemyPrev: (PartyVec3 & { at: number }) | null = null;
  private enemyVel = { x: 0, y: 0, z: 0 };
  /** Parkour: fireballs coming down (set by the server each step). */
  threats: readonly { id: number; tx: number; tz: number; landAt: number }[] = [];
  /** Which fireballs this bot noticed in time (decided once per fireball). */
  private noticed = new Map<number, boolean>();
  /** Recent (time, my progress, their progress) samples: the race pace. */
  private paceLog: { t: number; me: number; them: number }[] = [];

  constructor(readonly opponent: number, spawn: PartyVec3, private readonly rng: () => number,
    startSkill = PARTY_BOT_START_SKILL) {
    this.skill = this.anchor = clamp(startSkill, PARTY_BOT_MIN_SKILL, PARTY_BOT_MAX_SKILL);
    this.body = new Player(spawn);
    this.body.energyDrainMult = 0; // both modes give everybody unlimited sprint
    this.body.damageSink = () => {}; // the match engine owns falls and health
  }

  reset(spawn: PartyVec3): void {
    this.body.pos.set(spawn.x, spawn.y, spawn.z);
    this.body.vel.set(0, 0, 0);
    this.body.onGround = false;
    this.body.momentumTime = 0;
    this.progress = -1;
    this.jumping = false;
    this.navigation = [];
    this.lastPad = -1;
    this.input = { ...FROZEN_INPUT };
    this.nextThink = 0;
    this.pauseUntil = 0;
    this.plan = undefined;
  }

  /** The server landed a hit on this bot. */
  noteHurt(now: number): void { this.hurtAt = now; }

  /**
   * Keep the match close. The target level is the proven anchor plus a pull
   * proportional to how far the player is ahead (or behind); a big gap moves
   * the level fast. When the bot is the one running away it eases off, so the
   * player always has a race — and when the player is dominating, the bot
   * climbs into "flow" and can take it back.
   */
  adapt(now: number, snap: PartyLobbySnapshot, me: PartyParticipant, human: PartyParticipant): void {
    if (this.fixedSkill) return;
    const elapsed = now - snap.round!.startedAt;
    if (elapsed < 1500 || now < this.adaptAt) return;
    this.adaptAt = now + 750;
    let pull: number;
    if (snap.mode === 'bridge') {
      pull = (human.score - me.score) * 0.17 + (human.kills - me.kills) * 0.05;
    } else if (human.finishedAt !== undefined || human.outAt !== undefined || !human.connected) {
      // Dragon Chase is not a race: with its player done, the bot simply
      // runs the rest of the course at its own level.
      pull = 0;
    } else {
      // Keep company: a runner who is out in front pulls the bot up to their
      // pace, one who is struggling gets a bot running alongside them.
      const course = parkourCourse(snap.sub!.seed);
      const total = Math.max(1, course.steps.length - 1);
      const gap = clamp(human.progress - me.progress, -14, 14);
      // A gap matters more the closer anybody is to the finish line.
      const urgency = 1 + Math.max(human.progress, me.progress) / total;
      pull = gap * 0.07 * urgency - Math.min(0.1, human.falls * 0.01);
      // Pace, not just position: a player pulling away gets matched within
      // seconds, before a gap has had time to open.
      this.paceLog.push({ t: now, me: me.progress, them: human.progress });
      while (this.paceLog.length > 2 && now - this.paceLog[0].t > 9000) this.paceLog.shift();
      const first = this.paceLog[0], span = (now - first.t) / 1000;
      if (span >= 3) {
        const theirs = (human.progress - first.them) / span, mine = (me.progress - first.me) / span;
        pull += clamp((theirs - mine) / Math.max(0.35, mine), -1, 1) * 0.4;
      }
    }
    const target = clamp(this.anchor + pull, PARTY_BOT_MIN_SKILL, PARTY_BOT_MAX_SKILL);
    const gap = target - this.skill;
    // Climbing is quick (a player running away should meet the real thing
    // fast); easing off is gentler, so a lead is handed back, not thrown.
    this.skill = clamp(this.skill + clamp(gap * 0.7, -0.15, 0.3), PARTY_BOT_MIN_SKILL, PARTY_BOT_MAX_SKILL);
    this.anchor = clamp(this.anchor + (this.skill - this.anchor) * 0.2, PARTY_BOT_MIN_SKILL, PARTY_BOT_MAX_SKILL);
  }

  /** What to remember for this player's next match. */
  get rating(): number { return clamp(this.anchor * 0.5 + this.skill * 0.5, PARTY_BOT_MIN_SKILL, PARTY_BOT_MAX_SKILL); }

  step(dt: number, now: number, snap: PartyLobbySnapshot, me: PartyParticipant,
    human: PartyParticipant, opponent: PartyVec3, world: World, gen?: WorldGenerator): BotAction {
    this.adapt(now, snap, me, human);
    const action: BotAction = {};
    if (snap.mode === 'bridge') this.bridge(now, snap, me, human, opponent, world, action);
    else this.parkour(now, snap, me, world, gen, action);
    // Fixed small steps preserve jumps at low server tick rates.
    const steps = Math.max(1, Math.ceil(dt * 120));
    for (let i = 0; i < steps; i++) {
      if (snap.mode === 'parkour' && this.body.onGround) {
        const sub = snap.sub!, course = parkourCourse(sub.seed);
        const pad = parkourPadUnder(course, this.body.pos.x - sub.minX, this.body.pos.y, this.body.pos.z - sub.minZ);
        if (pad && pad.index !== this.lastPad) {
          const k = parkourPadImpulse(pad);
          this.body.vel.set(k.vx, k.vy, k.vz);
          this.body.momentumTime = k.momentum;
          this.body.onGround = false;
          this.lastPad = pad.index;
          const next = course.steps[pad.order + 1]?.[0];
          if (next) this.body.yaw = Math.atan2(-(next.x + sub.minX - this.body.pos.x), -(next.z + sub.minZ - this.body.pos.z));
          this.input = { ...RUN };
          this.jumping = true;
          this.jumpAt = now;
        } else if (!pad) this.lastPad = -1;
      }
      this.body.update(dt / steps, this.input, world);
    }
    // The swing is judged against the yaw the server reads after this step.
    if (action.melee && this.swingLean) this.body.yaw += this.swingLean;
    return action;
  }

  // ── The Bridge ───────────────────────────────────────────────────────────

  private bridge(now: number, snap: PartyLobbySnapshot, me: PartyParticipant, human: PartyParticipant,
    enemy: PartyVec3, world: World, action: BotAction): void {
    const p = this.body, sub = snap.sub!, s = this.skill, q = competence(s), f = flow(s);
    const solid = (xx: number, yy: number, zz: number) => !!BLOCKS[world.getBlock(xx, yy, zz)]?.solid;
    const dx = enemy.x - p.pos.x, dz = enemy.z - p.pos.z, distance = Math.hypot(dx, dz);
    const vertical = enemy.y - p.pos.y;
    if (this.enemyPrev && now > this.enemyPrev.at) {
      const t = (now - this.enemyPrev.at) / 1000;
      const k = 0.5;
      this.enemyVel = {
        x: lerp(this.enemyVel.x, (enemy.x - this.enemyPrev.x) / t, k),
        y: lerp(this.enemyVel.y, (enemy.y - this.enemyPrev.y) / t, k),
        z: lerp(this.enemyVel.z, (enemy.z - this.enemyPrev.z) / t, k),
      };
    }
    this.enemyPrev = { ...enemy, at: now };
    const goal = BRIDGE_GOALS[1 - me.team], home = BRIDGE_GOALS[me.team];
    const goalX = sub.minX + (goal.minX + goal.maxX) / 2;
    const goalZ = sub.minZ + (goal.minZ + goal.maxZ) / 2, homeZ = sub.minZ + (home.minZ + home.maxZ) / 2;
    const enemyAlive = !human.pendingSpawn && enemy.y > PARTY_FLOOR_Y - 3;
    // Just respawned behind a shield: nothing to gain from swinging at them.
    const enemyShielded = now < human.immuneUntil;
    // The server accepts a swing out to 4.2 blocks; a strong bot swings from
    // right at the edge of that, the way a good player does.
    const reach = lerp(2.9, 4.05, q) + f * 0.1;
    const toGoal = Math.hypot(goalX - p.pos.x, goalZ - p.pos.z);

    const laneX = sub.minX + BRIDGE_LANE_X + .5;
    const wool = me.team === 0 ? Block.TeamWoolA : Block.TeamWoolB;
    const enemyWool = me.team === 0 ? Block.TeamWoolB : Block.TeamWoolA;
    // Which way is home along the span, and how the race to each portal stands.
    const homeDir = Math.sign(homeZ - goalZ);
    const myHomeGap = Math.abs(p.pos.z - homeZ), theirHomeGap = Math.abs(enemy.z - homeZ);
    const towardHome = this.enemyVel.z * homeDir;
    // The rival is between us and our portal, or already at its door: that is
    // a threat whatever else is going on — unless we would score first.
    const threat = enemyAlive && (theirHomeGap + 1 < myHomeGap || theirHomeGap < 16) &&
      !(toGoal + 3 < theirHomeGap && q > .3);

    if (now >= this.nextThink) {
      this.nextThink = now + lerp(380, 70, q) * (1 - f * 0.6) + this.rng() * lerp(160, 25, q);
      // Walk the span's centre line; inside the enemy base, go for the portal
      // mouth — around a defender standing in front of it, on whichever side
      // we are already on, then cut in.
      const inBase = Math.abs(p.pos.z - goalZ) < 14;
      let tx = inBase ? goalX : laneX, tz = goalZ;
      if (inBase && enemyAlive && Math.abs(p.pos.z - goalZ) > 3.2 &&
          Math.abs(enemy.z - goalZ) < Math.abs(p.pos.z - goalZ) && Math.abs(enemy.x - goalX) < 2.6) {
        const side = Math.sign(p.pos.x - enemy.x) || (this.rng() < .5 ? -1 : 1);
        tx = goalX + side * 4.2;
        tz = goalZ - Math.sign(goalZ - p.pos.z) * 2.2;
      }
      const onSpan = Math.abs(vertical) < 3;
      // Go for the goal when the rival is gone, shielded, far behind — or when
      // the portal is right there and they are not standing in the way.
      const inTheWay = distance < 2.6 && Math.hypot(goalX - enemy.x, goalZ - enemy.z) < toGoal;
      const rush = !threat && (!enemyAlive || (enemyShielded && q > .3) ||
        (q > .35 && toGoal < 11 && !inTheWay) ||
        (q > 0.4 && Math.abs(enemy.z - goalZ) > Math.abs(p.pos.z - goalZ) + 6));
      // Defending: run the rival down wherever they are — past us on the span,
      // on a bridge of their own off to the side, or walking over our heads.
      const defend = threat && !enemyShielded;
      const engage = defend || (onSpan && enemyAlive && !rush && !enemyShielded &&
        distance < 4 + q * BRIDGE_TACTICS.engageBonus);
      if (engage) {
        // Lead the approach toward where they are going; when they are
        // running for our portal, cut them off rather than follow.
        const lead = defend ? lerp(.15, .45, q) : 0.12 * q;
        tx = enemy.x + this.enemyVel.x * lead;
        tz = enemy.z + this.enemyVel.z * lead;
        // A chase down the span stays on the span: steering at their exact x
        // from a block to the side would walk (and bridge) diagonally.
        if (Math.abs(enemy.x - laneX) < 1 && Math.abs(p.pos.x - laneX) < 2.2 && Math.abs(dz) > 2) tx = laneX;
      }
      this.aim = Math.atan2(-(tx - p.pos.x), -(tz - p.pos.z));
      this.swingLean = 0;
      if (engage && distance < 5) {
        // Knockback follows the look direction by a third. Lean the SWING
        // toward the edge the rival is already closest to, so a hit sends them
        // off it — the feet keep walking straight down the span.
        if (BRIDGE_TACTICS.lean) {
          const side = Math.sign(enemy.x - laneX) || (this.rng() < .5 ? -1 : 1);
          this.swingLean = side * (Math.sign(dz) || 1) * BRIDGE_TACTICS.leanMax * (q * 0.77 + f * 0.23);
        }
        this.aim += (this.rng() - .5) * (1 - q) * .5;
      }
      // Always sprint to defend; otherwise the weaker the bot, the more often
      // it forgets.
      const sprint = defend || this.rng() < .35 + q * .65;
      this.input = { ...RUN, sprintHeld: sprint, sprintKey: sprint };
      if (!defend && this.rng() < (1 - q) * .06) this.pauseUntil = now + 100 + this.rng() * 300;
      if (distance < 1.6 && Math.abs(vertical) < 1.5 && this.rng() < .3 - q * .25) this.input.forward = false;
      // Good bots strafe in a close fight — but only where the footing allows.
      if (engage && distance < 4.5 && Math.abs(vertical) < 1.5 && q > .4 && BRIDGE_TACTICS.strafe) {
        if (now >= this.strafeUntil) {
          this.strafe = this.rng() < .6 ? -this.strafe : this.strafe;
          this.strafeUntil = now + lerp(900, 260, q) + this.rng() * 300;
        }
        const side = Math.floor(p.pos.x + this.strafe * .9);
        if (solid(side, Math.floor(p.pos.y) - 1, Math.floor(p.pos.z))) {
          this.input.left = this.strafe < 0; this.input.right = this.strafe > 0;
        }
      }
      // Standing right under a rival we cannot reach: stop and let the axe
      // (below) take their footing out.
      if (Math.hypot(dx, dz) < 1.2 && vertical > 2) this.input.forward = false;
    }
    // Turn toward the aim at a human wrist's pace; sharper bots snap faster.
    const delta = Math.atan2(Math.sin(this.aim - p.yaw), Math.cos(this.aim - p.yaw));
    const turn = lerp(.14, .32, q) + f * .12;
    p.yaw += clamp(delta, -turn, turn);
    this.pitch = Math.atan2(vertical + .2, Math.max(.5, distance)) * .8;
    this.input.jump = false;

    // ── Footing: step up, dig through, bridge over ──
    const fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw);
    const fy = Math.floor(p.pos.y + .01);
    const hereX = Math.floor(p.pos.x), hereZ = Math.floor(p.pos.z);
    const x = Math.floor(p.pos.x + fx * .85), z = Math.floor(p.pos.z + fz * .85);
    const localZ = z - sub.minZ;
    const ahead = x !== hereX || z !== hereZ;
    const feet = ahead && solid(x, fy, z), head = ahead && solid(x, fy + 1, z);
    // Room to jump: nothing over our own head, nor over the step's top.
    const ceiling = solid(hereX, fy + 2, hereZ) || solid(x, fy + 2, z);
    const dig = (bx: number, by: number, bz: number): boolean => {
      if (!isWool(world.getBlock(bx, by, bz)) || now < this.nextBuild) return false;
      action.edit = { x: bx, y: by, z: bz, block: Block.Air };
      this.nextBuild = now + lerp(420, 150, q);
      return true;
    };
    if (p.onGround && this.input.forward && (feet || head)) {
      if (feet && !head && !ceiling) {
        // A one-block step: hop it, and keep pushing forward through the air.
        this.input.jump = true;
        this.hopAt = now;
      } else if (!(head && dig(x, fy + 1, z)) && !(feet && dig(x, fy, z)) && feet && !head && ceiling) {
        dig(hereX, fy + 2, hereZ) || dig(x, fy + 2, z);
      }
    }
    // Fill a gap ahead at a quick placement cadence. A one-block step down is
    // not a gap. Portals stay open.
    const gap = ahead && !solid(x, fy - 1, z) && !solid(x, fy - 2, z);
    if (p.onGround && gap && localZ > 10 && localZ < 69 && !action.edit) {
      this.input.forward = false;
      if (now >= this.nextBuild) {
        action.edit = { x, y: fy - 1, z, block: wool };
        action.holdWool = true;
        this.nextBuild = now + lerp(700, 180, q);
      }
    } else if (p.onGround && now >= this.nextBuild && !action.edit && distance > 9 && !threat &&
      hereX - sub.minX === BRIDGE_LANE_X &&
      ((localZ >= 20 && localZ <= 34) || (localZ >= 45 && localZ <= 59))) {
      // Widen the tightrope while nobody is close: a side block is somewhere
      // to land after a sideways hit.
      const side = this.rng() < .5 ? -1 : 1;
      const bx = sub.minX + BRIDGE_LANE_X + side;
      if (!solid(bx, PARTY_FLOOR_Y, z) && solid(sub.minX + BRIDGE_LANE_X, PARTY_FLOOR_Y, z)) {
        action.edit = { x: bx, y: PARTY_FLOOR_Y, z, block: wool };
        action.holdWool = true;
        this.nextBuild = now + lerp(1600, 600, q);
      }
    }
    if (now < this.pauseUntil) this.input.forward = false;
    // In the air, only drift forward over something to land on (or through
    // a hop we chose); a knock-up over the void is ridden out, not walked into.
    if (!p.onGround && now - this.hopAt > 650) {
      let landing = false;
      for (let d = 1; d <= 6 && !landing; d++) landing = solid(Math.floor(p.pos.x + fx * .9), fy - d, Math.floor(p.pos.z + fz * .9));
      if (!landing) this.input.forward = false;
    }
    // Clutch: knocked off the span, a sharp bot drops a block under its feet.
    if (!p.onGround && p.vel.y < -1 && !action.edit && now >= this.nextClutch &&
      p.pos.y > PARTY_FLOOR_Y + .4 && p.pos.y < PARTY_FLOOR_Y + 3 && hereZ - sub.minZ > 10 && hereZ - sub.minZ < 69) {
      this.nextClutch = now + lerp(420, 120, q);
      if (!solid(hereX, PARTY_FLOOR_Y, hereZ) && this.rng() < clamp(q * 1.05 + f * .2 - .1, 0, 1)) {
        action.edit = { x: hereX, y: PARTY_FLOOR_Y, z: hereZ, block: wool };
        action.holdWool = true;
      }
      // Steer back toward the span while falling.
      if (Math.abs(p.pos.x - laneX) > .3 && q > .5) {
        const back = Math.atan2(-(laneX - p.pos.x), 0);
        p.yaw += clamp(Math.atan2(Math.sin(back - p.yaw), Math.cos(back - p.yaw)), -.3, .3);
        this.input.forward = true;
      }
    }

    // ── Undercut: take their wool out from under them ──
    // A rival crossing on blocks of their own — a flanking bridge, a skybridge
    // over our heads, a pillar — is one axe stroke from the void.
    if (!action.edit && enemyAlive && now >= this.nextUndercut && q > .15) {
      const lead = lerp(.05, .3, q);
      const ey = Math.floor(enemy.y + .01) - 1;
      for (const [cx, cz] of [[enemy.x + this.enemyVel.x * lead, enemy.z + this.enemyVel.z * lead], [enemy.x, enemy.z]]) {
        const bx = Math.floor(cx), bz = Math.floor(cz);
        if (world.getBlock(bx, ey, bz) !== enemyWool) continue;
        if (bx === hereX && bz === hereZ && ey === fy - 1) continue; // our own footing
        if (Math.hypot(bx + .5 - p.pos.x, ey + .5 - p.pos.y, bz + .5 - p.pos.z) > 6.5) continue;
        // Only worth it where they would fall: void, or a long drop.
        let caught = false;
        for (let d = 1; d <= 3 && !caught; d++) caught = solid(bx, ey - d, bz);
        if (caught) continue;
        action.edit = { x: bx, y: ey, z: bz, block: Block.Air };
        this.nextUndercut = now + lerp(1300, 200, q) + this.rng() * lerp(600, 60, q);
        break;
      }
    }

    // ── Block the runner: a wall on the span in front of them ──
    // Two blocks tall, a couple of steps ahead of a rival sprinting for our
    // portal: they have to stop and dig, and we get to them first.
    // (A respawn shield stops damage, not blocks.)
    if (!action.edit && threat && q > .35 && now >= this.nextWall &&
      towardHome > 2 && Math.abs(vertical) < 1.5 && theirHomeGap > 4) {
      const wx = Math.floor(enemy.x), wy = Math.floor(enemy.y + .01);
      // As far ahead of them as the arm reaches: further is more time to close.
      for (const k of [lerp(2.6, 1.8, q), 1.3]) {
        const wz = Math.floor(enemy.z + homeDir * k);
        const lzw = wz - sub.minZ, lxw = wx - sub.minX;
        if (Math.hypot(wx + .5 - p.pos.x, wy + .5 - p.pos.y, wz + .5 - p.pos.z) > 6.8) continue;
        if (bridgeGoalGuard(lxw, lzw) || lzw <= 2 || lzw >= 77 || wz === Math.floor(enemy.z)) continue;
        const low = !solid(wx, wy, wz) && solid(wx, wy - 1, wz);
        const high = solid(wx, wy, wz) && !solid(wx, wy + 1, wz);
        if (low || (high && isWool(world.getBlock(wx, wy, wz)))) {
          action.edit = { x: wx, y: low ? wy : wy + 1, z: wz, block: wool };
          action.holdWool = true;
          this.nextWall = now + (high ? lerp(2600, 1300, q) : lerp(260, 90, q));
        }
        break;
      }
    }

    // ── Melee ──
    const inReach = enemyAlive && !enemyShielded && Math.hypot(dx, dz, vertical) < reach;
    const facing = Math.cos(Math.atan2(Math.sin(Math.atan2(-dx, -dz) - p.yaw), Math.cos(Math.atan2(-dx, -dz) - p.yaw))) > .6;
    // Jump-crits: a strong bot times its swing to the fall of a hop.
    if (BRIDGE_TACTICS.critHops && enemyAlive && !enemyShielded && toGoal > 6 && q > .55 && p.onGround && distance > 2.2 && distance < 5.6 &&
      now - this.critJumpAt > lerp(1400, 700, q) && this.rng() < q * .6 + f * .3) {
      this.input.jump = true;
      this.critJumpAt = now;
    }
    // Timed crits, above the ordinary range only: leave the ground so the fall
    // of the hop (about 0.28 s after takeoff) meets the rival at the edge of
    // reach, where a falling hit lands half again as hard.
    if (BRIDGE_TACTICS.timedCrits && f > 0 && enemyAlive && p.onGround && toGoal > 6 && now - this.critJumpAt > 560 &&
      this.body.vel.y <= 0) {
      const ux = dx / Math.max(distance, 1e-3), uz = dz / Math.max(distance, 1e-3);
      const closing = (p.vel.x - this.enemyVel.x) * ux + (p.vel.z - this.enemyVel.z) * uz;
      const until = (distance - reach) / Math.max(closing, 0.5);
      const shieldGone = !enemyShielded || human.immuneUntil - now < 250;
      // Only with deck to come down on.
      const ahead = solid(Math.floor(p.pos.x), Math.floor(p.pos.y) - 1, Math.floor(p.pos.z + (Math.sign(uz) || 0) * 1.5));
      if (shieldGone && ahead && closing > 1 && until > 0.12 && until < 0.34 && this.rng() < f * 1.6) {
        this.input.jump = true;
        this.critJumpAt = now;
      }
    }
    if (inReach && facing && now >= this.nextAttack) {
      const descending = !p.onGround && p.vel.y < -0.9;
      const hopping = now - this.critJumpAt < 600;
      // Wait for the fall of a crit hop unless the rival is already in our face.
      if (!hopping || descending || distance < 2.2 || this.rng() < (1 - q) * .5) {
        this.nextAttack = now + BRIDGE_MELEE_TIER.cooldownMs + lerp(560, 0, q) + this.rng() * lerp(240, 18, q);
        action.melee = this.rng() < lerp(.55, 1, q);
        // W-tap: a beat off the key so the next hit carries full sprint knockback.
        if (action.melee && q > .5 && BRIDGE_TACTICS.wTap) this.pauseUntil = Math.max(this.pauseUntil, now + 50 + this.rng() * 50);
      }
    }
    // Recently hit and at the edge: back off a step rather than trade into the void.
    if (now - this.hurtAt < 250 && q > .6 && distance < 2) this.input.back = this.rng() < .3;

    // ── Bow ──
    // Out of axe reach (past us, overhead, off on a flank) the bow is the answer.
    const unreachable = threat || vertical > 2;
    if (BRIDGE_TACTICS.bow && enemyAlive && !enemyShielded && distance > (unreachable ? 3 : 6) && distance < 34 &&
      now >= this.nextShot && !action.melee && !action.edit) {
      // A rival bridging out, standing still or coming down the span is the
      // shot worth taking.
      const worth = q > .3 && (unreachable || Math.abs(this.enemyVel.x) + Math.abs(this.enemyVel.z) < 7 || distance > 10);
      if (worth) {
        this.nextShot = now + 5000 + lerp(3000, 60, q) + this.rng() * lerp(900, 80, q);
        const flight = distance / BRIDGE_ARROW_SPEED, lead = lerp(.4, 1, q);
        const ax = dx + this.enemyVel.x * flight * lead, az = dz + this.enemyVel.z * flight * lead;
        const error = lerp(.13, .012, q) * (1 - f * .6) * distance;
        // Gravity drop over the flight, compensated by aiming up.
        const drop = .5 * 19 * flight * flight;
        action.shot = {
          dx: ax + (this.rng() - .5) * error * 2,
          // The arrow leaves from the eye (1.55 up); aim at the chest (0.9 up).
          dy: vertical + .9 - 1.55 + drop + (this.rng() - .5) * error,
          dz: az + (this.rng() - .5) * error * 2,
        };
      }
    }
  }

  // ── Parkour ──────────────────────────────────────────────────────────────

  private parkour(now: number, snap: PartyLobbySnapshot, me: PartyParticipant, world: World,
    gen: WorldGenerator | undefined, action: BotAction): void {
    const p = this.body, sub = snap.sub!, course = parkourCourse(sub.seed);
    const s = this.skill, q = competence(s), f = flow(s);
    const a = course.steps[me.progress]?.reduce((best, pad) =>
      Math.hypot(pad.x + sub.minX - p.pos.x, pad.z + sub.minZ - p.pos.z) <
      Math.hypot(best.x + sub.minX - p.pos.x, best.z + sub.minZ - p.pos.z) ? pad : best);
    const b = course.steps[me.progress + 1]?.find((pad) => pad.from === a?.index) ?? course.steps[me.progress + 1]?.[0];
    this.input = { ...FROZEN_INPUT };
    this.pitch = -.35;
    if (!a || !b) return;
    if (this.progress !== me.progress) {
      this.progress = me.progress;
      this.jumping = false;
      this.navigation = [];
      // The "think" before the next jump. A first-timer stops and looks; a
      // strong runner barely breaks stride; in flow there is no pause at all.
      const timed = a.kind === 'crumble' || a.kind === 'blink' || a.kind === 'launch' || a.kind === 'boost';
      // With the dragon at its heels nobody stops to think.
      const hunted = snap.dragon !== undefined && me.progress - snap.dragon.front < 3;
      const think = timed ? 0 : (lerp(620, 35, q) + this.rng() * lerp(360, 30, q)) * (1 - f) * (hunted ? .25 : 1);
      this.pauseUntil = now + think;
      const key = `${a.index}:${b.index}`;
      const pristine = gen ? { isLoaded: () => true, getBlock: (x: number, y: number, z: number) => gen.blockAt(x, y, z) } as unknown as World : world;
      if (!this.plans.has(key)) this.plans.set(key, this.planJump(a, b, pristine, sub.minX, sub.minZ));
      // The course as authored almost always still holds: confirm that plan
      // with one trial in the live world before searching again.
      const authored = this.plans.get(key);
      this.plan = (authored && this.planLands(authored, a, b, world, sub.minX, sub.minZ) ? authored : null) ??
        this.planJump(a, b, world, sub.minX, sub.minZ) ?? authored ?? undefined;
      this.nextReplan = now + 1000;
      this.nextShortcut = now; // try a chained take-off straight away
    }
    if ((a.kind === 'launch' || a.kind === 'boost') && !p.onGround && this.lastPad === a.index) {
      this.input = { ...RUN };
      return;
    }
    if (this.jumping) {
      if (p.onGround && now - this.jumpAt > 180) {
        this.jumping = false;
        this.navigation = [];
      } else {
        this.input = { ...RUN, jump: false };
        return;
      }
    }
    // Chain: from wherever the landing put us, if the next pad is already
    // within a jump, go now. Strong runners look for this every moment; weaker
    // ones only once they have finished thinking.
    // On ground that is about to go (a crumble, a blink stone), look for a
    // way off every tick, whatever the skill.
    const unstable = a.kind === 'crumble' || a.kind === 'blink';
    const chains = q > .75 || unstable || now >= this.pauseUntil;
    if (chains && p.onGround && (now >= this.nextShortcut || unstable)) {
      this.nextShortcut = now + lerp(220, 50, q);
      const direct = this.jumpFrom(p.pos.x, p.pos.z, p.pos.y, b, world, sub.minX, sub.minZ, q);
      if (direct) { this.plan = direct; this.pauseUntil = 0; }
    }
    // Fire coming down. On us: get moving. On the pad ahead: let it land first.
    for (const f of this.threats) {
      if (f.landAt < now || f.landAt - now > 1600) continue;
      if (!this.noticed.has(f.id)) this.noticed.set(f.id, this.rng() < .35 + .6 * q);
      if (!this.noticed.get(f.id)) continue;
      const onMe = Math.hypot(f.tx - p.pos.x, f.tz - p.pos.z) < 2.6;
      const onNext = Math.hypot(f.tx - (sub.minX + b.x), f.tz - (sub.minZ + b.z)) < 2.6;
      if (onMe && !onNext) this.pauseUntil = 0;
      else if (onNext && !onMe && p.onGround) { this.pauseUntil = Math.max(this.pauseUntil, f.landAt + 120); this.plan ??= undefined; }
    }
    if (this.noticed.size > 64) this.noticed.clear();
    if (now < this.pauseUntil) return;
    if (!this.plan && p.onGround && now >= this.nextReplan) {
      this.nextReplan = now + 700;
      this.plan = this.planJump(a, b, world, sub.minX, sub.minZ) ?? undefined;
    }
    const plan = this.plan;
    const tx = plan?.x ?? sub.minX + a.x, tz = plan?.z ?? sub.minZ + a.z;
    const tolerance = lerp(.08, .22, q);
    if (Math.hypot(tx - p.pos.x, tz - p.pos.z) > tolerance) {
      this.walkTo(tx, a.y, tz, world, a.kind === 'crumble' || a.kind === 'blink' || q > .35, now, action);
      return;
    }
    if (!p.onGround) return;
    if (this.clearWoolAhead(b, sub.minX, sub.minZ, world, now, action)) return;
    const elapsed = now - snap.round!.startedAt;
    // Never loiter on a crumble tile: it drops 0.7 s after it is touched.
    // The waiting for a blink stone happens on the stable pad BEFORE it.
    // A blink stone must stay up long enough to land, cross it and leave.
    if (b.kind === 'blink' && a.kind !== 'crumble' && a.kind !== 'blink' &&
      [300, 650, 1000, 1350, 1700].some((t) => !blinkSolid(b.group, elapsed + t))) return;
    // A crumble somebody else already cracked (or that is gone) is about to
    // drop: wait for it to grow back rather than jump onto it.
    // Waiting is only safe on ground that will still be there: on a blink
    // stone about to go, take the jump whatever lies ahead.
    const canWait = a.kind !== 'crumble' && (a.kind !== 'blink' || [150, 300, 450].every((t) => blinkSolid(a.group, elapsed + t)));
    if (b.kind === 'crumble' && canWait) {
      const under = world.getBlock(Math.floor(sub.minX + b.x), b.y - 1, Math.floor(sub.minZ + b.z));
      if (under === CRUMBLE_CRACKED || !BLOCKS[under]?.solid) return;
    }
    // Stepping onto a crumble that leads to a blink: the blink has to be up
    // for the whole crossing — land on the crumble, straight off, land again.
    const after = course.steps[b.order + 1]?.[0];
    if (b.kind === 'crumble' && after?.kind === 'blink' && canWait &&
      [650, 900, 1150, 1400, 1700].some((t) => !blinkSolid(after.group, elapsed + t))) return;
    // The plan was simulated from one exact spot. Standing a little off it,
    // make sure the jump still works from HERE before committing to it.
    if (plan && Math.hypot(plan.x - p.pos.x, plan.z - p.pos.z) > .04) {
      const here = this.jumpFrom(p.pos.x, p.pos.z, p.pos.y, b, world, sub.minX, sub.minZ, q);
      if (here) this.takeOff(here, b, sub.minX, sub.minZ, now, q);
      else this.walkTo(plan.x, a.y, plan.z, world, true, now, action, .03);
      return;
    }
    this.takeOff(plan, b, sub.minX, sub.minZ, now, q);
  }

  private takeOff(plan: JumpPlan | undefined, b: ParkourPlatform, minX: number, minZ: number, now: number, q: number): void {
    const p = this.body;
    if (!plan) {
      this.input = { ...RUN, jump: true };
      p.yaw = Math.atan2(-(b.x + minX - p.pos.x), -(b.z + minZ - p.pos.z));
      return;
    }
    p.yaw = plan.yaw;
    // Under/over-steering produces real, recoverable misses — never in flow.
    if (this.rng() < (1 - q) * .16) p.yaw += (this.rng() < .5 ? -1 : 1) * lerp(.24, .1, q);
    const dx = -Math.sin(p.yaw), dz = -Math.cos(p.yaw);
    // Exactly the run-up speed the plan was simulated with: some jumps need
    // a gentle hop to clear an obstacle or not overshoot the landing.
    p.vel.x = dx * plan.speed; p.vel.z = dz * plan.speed;
    this.input = { ...RUN, jump: true };
    this.plan = undefined;
    this.jumping = true;
    this.jumpAt = now;
  }

  private clearWoolAhead(b: ParkourPlatform, minX: number, minZ: number, world: World,
    now: number, action: BotAction): boolean {
    const p = this.body, dx = b.x + minX - p.pos.x, dz = b.z + minZ - p.pos.z;
    const distance = Math.hypot(dx, dz) || 1;
    for (let along = .5; along <= Math.min(4.5, distance); along += .5) {
      const x = Math.floor(p.pos.x + dx / distance * along), z = Math.floor(p.pos.z + dz / distance * along);
      for (const y of [Math.floor(p.pos.y), Math.floor(p.pos.y) + 1, Math.floor(p.pos.y) + 2]) {
        if (!isWool(world.getBlock(x, y, z))) continue;
        if (now >= this.nextBuild) {
          action.edit = { x, y, z, block: Block.Air };
          this.nextBuild = now + 450;
          this.nextReplan = now;
        }
        this.input = { ...FROZEN_INPUT };
        return true;
      }
    }
    return false;
  }

  /** Short walk over the current pad (stairs, obstacle pads, around wool). */
  private walkTo(tx: number, ty: number, tz: number, world: World, urgent: boolean, now: number, action: BotAction,
    arrive = .3): void {
    const p = this.body;
    const solid = (x: number, y: number, z: number) => !!BLOCKS[world.getBlock(x, y, z)]?.solid;
    if (this.navigation.length) {
      const next = this.navigation[0], nx = Math.floor(next.x), nz = Math.floor(next.z), ny = Math.round(next.y);
      if (solid(nx, ny, nz) || solid(nx, ny + 1, nz)) this.navigation = [];
    }
    if (!this.navigation.length && p.onGround) {
      const start = { x: Math.floor(p.pos.x), y: Math.round(p.pos.y), z: Math.floor(p.pos.z), parent: -1 };
      const nodes = [start], seen = new Set<string>([`${start.x},${start.y},${start.z}`]);
      let end = -1;
      for (let i = 0; i < nodes.length && i < 400; i++) {
        const n = nodes[i];
        if (n.x === Math.floor(tx) && n.z === Math.floor(tz) && Math.abs(n.y - ty) < 1) { end = i; break; }
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]])
          for (const dy of [0, 1, -1]) {
            const x = n.x + dx, y = n.y + dy, z = n.z + dz, key = `${x},${y},${z}`;
            if (seen.has(key) || Math.hypot(x - start.x, z - start.z) > 14 || Math.abs(y - ty) > 3 ||
              !solid(x, y - 1, z) || solid(x, y, z) || solid(x, y + 1, z) ||
              (dy > 0 && solid(n.x, n.y + 2, n.z))) continue;
            seen.add(key); nodes.push({ x, y, z, parent: i });
          }
      }
      if (end >= 0) {
        while (nodes[end].parent >= 0) { const n = nodes[end]; this.navigation.unshift({ x: n.x + .5, y: n.y, z: n.z + .5 }); end = n.parent; }
        this.navigation.push({ x: tx, y: ty, z: tz });
      }
    }
    while (this.navigation.length && Math.hypot(this.navigation[0].x - p.pos.x, this.navigation[0].z - p.pos.z) < .3)
      this.navigation.shift();
    const target = this.navigation[0] ?? { x: tx, y: ty, z: tz };
    const dx = target.x - p.pos.x, dz = target.z - p.pos.z, distance = Math.hypot(dx, dz);
    p.yaw = Math.atan2(-dx, -dz);
    const aheadX = Math.floor(p.pos.x + dx / (distance || 1) * .5), aheadZ = Math.floor(p.pos.z + dz / (distance || 1) * .5);
    const y = Math.round(p.pos.y);
    // A one-block step down (off a hurdle, down a stair) is not a gap.
    const gap = !solid(aheadX, y - 1, aheadZ) && !solid(aheadX, y - 2, aheadZ);
    const obstacle = solid(aheadX, y, aheadZ);
    const head = solid(aheadX, y + 1, aheadZ);
    if (!this.navigation.length && now >= this.nextBuild && (obstacle || head)) {
      const by = obstacle ? y : y + 1, block = world.getBlock(aheadX, by, aheadZ);
      if (isWool(block)) {
        action.edit = { x: aheadX, y: by, z: aheadZ, block: Block.Air };
        this.nextBuild = now + 450;
      }
    }
    // Brake into the take-off point instead of sneaking up on it: the last
    // stretch is walked, not crept, unless there is a drop right ahead.
    const last = this.navigation.length <= 1;
    const brake = last && distance < Math.max(.45, arrive * 2);
    // The final approach is to a take-off point on THIS pad, usually right at
    // its edge: ease off the sprint, and let sneak's edge-guard stop us at the
    // lip rather than hopping a gap we were never meant to cross on foot.
    const approach = last && distance < 1.3;
    this.input = {
      ...RUN, sprintKey: urgent && !brake && !approach, sprintHeld: urgent && !brake && !approach,
      sneak: (brake || approach) && gap,
      jump: p.onGround && ((gap && !approach) || obstacle || target.y > p.pos.y + .3) && !brake,
    };
  }

  /** Can we make the next pad from exactly here? Simulated with real physics. */
  private jumpFrom(x: number, z: number, y: number, b: ParkourPlatform, world: World,
    minX: number, minZ: number, q: number): JumpPlan | null {
    // Onto a crumble, land toward its far side: it drops 0.7 s after touch.
    const fwd = b.kind === 'crumble' ? crumbleLead(b) : { x: 0, z: 0 };
    const tx = minX + b.x + fwd.x, tz = minZ + b.z + fwd.z;
    // A cautious runner wants a comfortable landing; a sharp one takes the edge.
    const margin = lerp(.25, .05, q);
    // Ballistics first: a run-up whose airtime cannot carry it to the pad's
    // nearest edge is not worth simulating. (Jump 1.25 blocks, gravity 32.)
    if (!withinJump(x, y, z, b, minX, minZ)) return null;
    const yaw = Math.atan2(-(tx - x), -(tz - z));
    const ux = -Math.sin(yaw), uz = -Math.cos(yaw);
    // Travel along the line that still counts as short of the pad's near edge.
    const shortOf = Math.hypot(tx - x, tz - z) - Math.max(b.width, b.depth) / 2;
    for (const speed of [5.612, 4.317, 3.2, 2.3]) {
      const trial = new Player({ x, y: y + .001, z });
      trial.damageSink = () => {}; trial.energyDrainMult = 0; trial.yaw = yaw; trial.onGround = true;
      trial.vel.set(ux * speed, 0, uz * speed);
      for (let frame = 0; frame < 180; frame++) {
        trial.update(1 / 120, { ...RUN, jump: true }, world);
        // Fallen past the pad's top: it can no longer land there.
        if (trial.vel.y < 0 && trial.pos.y < b.y - .3) break;
        if (frame > 3 && trial.onGround) {
          if (Math.abs(trial.pos.y - b.y) < .05 && Math.abs(trial.pos.x - minX - b.x) < b.width / 2 - margin &&
            Math.abs(trial.pos.z - minZ - b.z) < b.depth / 2 - margin) return { x, z, yaw, speed };
          break;
        }
      }
      // Speeds are tried fastest first: once one comes up short, so will the rest.
      if ((trial.pos.x - x) * ux + (trial.pos.z - z) * uz < shortOf) break;
    }
    return null;
  }

  /** A take-off point on pad `a` from which `b` is reachable, preferring the
   *  lip nearest the next pad and the fastest run-up. */
  private planJump(a: ParkourPlatform, b: ParkourPlatform, world: World, minX: number, minZ: number): JumpPlan | null {
    const alongX = b.heading % 2 === 1, sign = b.heading < 2 ? 1 : -1;
    const aAlong = alongX ? a.x : a.z, aLat = alongX ? a.z : a.x;
    const lead = b.kind === 'crumble' ? crumbleLead(b) : { x: 0, z: 0 };
    const bAlong = alongX ? b.x + lead.x : b.z + lead.z, bLat = alongX ? b.z : b.x;
    const extent = alongX ? a.width : a.depth, lateral = alongX ? a.depth : a.width, targetLateral = alongX ? b.depth : b.width;
    for (const back of [0, .5, 1, 1.5]) for (const speed of [5.612, 4.317, 3.2, 2.3]) for (const line of [0, 1]) {
      const lip = Math.max(-(extent / 2 - .35), extent / 2 - .35 - back);
      const lat = line === 0 ? clamp(bLat, aLat - lateral / 2 + .35, aLat + lateral / 2 - .35) : aLat;
      const tLat = clamp(lat, bLat - targetLateral / 2 + .35, bLat + targetLateral / 2 - .35);
      const x = minX + (alongX ? aAlong + sign * lip : lat), z = minZ + (alongX ? lat : aAlong + sign * lip);
      const tx = minX + (alongX ? bAlong : tLat), tz = minZ + (alongX ? tLat : bAlong);
      const kicked = a.kind === 'launch' || a.kind === 'boost';
      if (!kicked && !withinJump(x, a.y, z, b, minX, minZ)) continue;
      const plan = { x, z, yaw: Math.atan2(-(tx - x), -(tz - z)), speed };
      if (this.planLands(plan, a, b, world, minX, minZ)) return plan;
    }
    return null;
  }

  /** Does `plan`, taken off pad `a` in this world, come down on pad `b`? */
  private planLands(plan: JumpPlan, a: ParkourPlatform, b: ParkourPlatform, world: World, minX: number, minZ: number): boolean {
    const trial = new Player({ x: plan.x, y: a.y + .001, z: plan.z });
    trial.damageSink = () => {}; trial.energyDrainMult = 0;
    trial.yaw = plan.yaw; trial.onGround = true;
    trial.vel.set(-Math.sin(plan.yaw) * plan.speed, 0, -Math.cos(plan.yaw) * plan.speed);
    if (a.kind === 'launch' || a.kind === 'boost') {
      const kick = parkourPadImpulse(a); trial.vel.set(kick.vx, kick.vy, kick.vz); trial.momentumTime = kick.momentum; trial.onGround = false;
    }
    for (let frame = 0; frame < 240; frame++) {
      trial.update(1 / 120, { ...RUN, jump: true }, world);
      if (trial.vel.y < 0 && trial.pos.y < b.y - .3) return false;
      if (frame > 3 && trial.onGround)
        return Math.abs(trial.pos.y - b.y) < .05 && Math.abs(trial.pos.x - minX - b.x) < b.width / 2 + .25 &&
          Math.abs(trial.pos.z - minZ - b.z) < b.depth / 2 + .25;
    }
    return false;
  }
}
