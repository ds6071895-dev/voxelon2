// Server-only Duels practice opponent. It moves with the same Player physics
// as a client and its rounds obey the same burst/magazine limits; the server
// core owns damage, deaths, respawns and the arena edit log.
//
// Level-matching: the bot's baseline is read from its opponent's RP, so a
// Copper player meets a Copper-grade bot and a Diamond player a Diamond-grade
// one. Inside a match it leans a little toward whoever is losing, but only
// inside a narrow band around that baseline: a strong player can still run it
// over, and that win is what lifts their RP and with it the next bot.
import { Player } from './player';
import { BLOCKS } from './blocks';
import { FROZEN_INPUT, type PlayerInput } from './input';
import type { World } from './world';
import { DUEL_MAX_HEALTH, type DuelArenaBounds, type DuelVec3 } from './duels';

export const DUEL_BOT_WAIT_MS = 20_000;
/** RP where the bot's baseline tops out. Voxelon I starts at 1800. */
const TOP_RP = 2000;
/** How far live adaptation may pull the bot from its RP baseline. */
const ADAPT_BAND = 0.14;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export const DUEL_BOT_NAMES = ['Vex', 'Rook', 'Nova', 'Kestrel', 'Onyx', 'Juno', 'Talon', 'Wisp'];

/** The skill a bot starts on against a player holding `rp`. */
export function duelBotBaseline(rp: number): number {
  return clamp(0.3 + (rp / TOP_RP) * 0.64, 0.3, 0.94);
}

export interface DuelBotShot { from: DuelVec3; dx: number; dy: number; dz: number; hit: boolean }
export interface DuelBotAction {
  shots: DuelBotShot[];
  heal?: boolean;
  /** Plank placements for emergency cover. */
  build: DuelVec3[];
}

/** What the server tells the bot about the world each tick. */
export interface DuelBotView {
  me: { health: number; alive: boolean; kills: number; medkits: number };
  enemy: { x: number; y: number; z: number; alive: boolean; kills: number; shielded: boolean } | null;
  arena: DuelArenaBounds;
  /** Line of sight from a point to another, with player-built cover. */
  sight: (a: DuelVec3, b: DuelVec3) => boolean;
}

export class DuelBot {
  readonly body: Player;
  readonly baseline: number;
  skill: number;
  private input: PlayerInput = { ...FROZEN_INPUT };
  private adaptAt = 0;
  private strafe = 1;
  private strafeUntil = 0;
  private seenAt = -1e9;
  private acquiredAt = 0;
  private lastSeen: DuelVec3 | null = null;
  private burstLeft = 0;
  private nextRound = 0;
  private nextBurst = 0;
  private loaded = 24;
  private reloadUntil = 0;
  private healUntil = 0;
  private nextBuild = 0;
  private unstickUntil = 0;
  private unstickDir = 1;
  private lastPos = { x: 0, z: 0, at: 0 };
  private enemyPrev: (DuelVec3 & { at: number }) | null = null;
  private enemySpeed = 0;
  private goal: DuelVec3 | null = null;
  private wasAlive = false; // false until the first tick syncs the body onto its spawn
  /** Rounds that landed in a row; a bot "settles in" on a target it is tracking. */
  private tracking = 0;

  constructor(readonly opponent: number, opponentRp: number, spawn: DuelVec3, private readonly rng: () => number) {
    this.baseline = duelBotBaseline(opponentRp);
    this.skill = this.baseline;
    this.body = new Player(spawn);
    this.body.energyDrainMult = 0;
    this.body.damageSink = () => {}; // Duels has no fall damage; the server owns health.
  }

  /** Called when the server teleports the bot (spawn or respawn). */
  reset(at: DuelVec3, yaw: number): void {
    this.body.pos.set(at.x, at.y, at.z);
    this.body.vel.set(0, 0, 0);
    this.body.yaw = yaw;
    this.body.onGround = false;
    this.input = { ...FROZEN_INPUT };
    this.burstLeft = 0; this.loaded = 24; this.reloadUntil = 0; this.healUntil = 0;
    this.seenAt = -1e9; this.lastSeen = null; this.goal = null; this.tracking = 0;
  }

  /** Lean toward whoever is behind, within ADAPT_BAND of the RP baseline. */
  private adapt(now: number, view: DuelBotView): void {
    if (now < this.adaptAt || !view.enemy) return;
    this.adaptAt = now + 2500;
    const lead = view.enemy.kills - view.me.kills;
    const target = clamp(this.baseline + lead * 0.035, this.baseline - ADAPT_BAND, this.baseline + ADAPT_BAND);
    this.skill = clamp(this.skill + clamp(target - this.skill, -0.05, 0.05), 0.2, 1);
  }

  step(dt: number, now: number, view: DuelBotView, world: World): DuelBotAction {
    const action: DuelBotAction = { shots: [], build: [] };
    const p = this.body, s = this.skill;
    if (!view.me.alive) { this.wasAlive = false; return action; }
    this.wasAlive = true;
    this.adapt(now, view);
    const enemy = view.enemy?.alive ? view.enemy : null;

    // Estimate how fast the target is moving: strafing players are harder to hit.
    if (enemy) {
      if (this.enemyPrev && now > this.enemyPrev.at) {
        const v = Math.hypot(enemy.x - this.enemyPrev.x, enemy.z - this.enemyPrev.z) / ((now - this.enemyPrev.at) / 1000);
        if (v < 30) this.enemySpeed += (v - this.enemySpeed) * 0.3;
      }
      this.enemyPrev = { x: enemy.x, y: enemy.y, z: enemy.z, at: now };
    }

    const eye = { x: p.pos.x, y: p.pos.y + 1.55, z: p.pos.z };
    const chest = enemy ? { x: enemy.x, y: enemy.y + 1.0, z: enemy.z } : null;
    const visible = !!(enemy && chest && Math.hypot(chest.x - eye.x, chest.z - eye.z) < 56 && view.sight(eye, chest));
    if (visible) {
      if (now - this.seenAt > 400) this.acquiredAt = now; // fresh sighting: reaction time starts now
      this.seenAt = now;
      this.lastSeen = { x: enemy!.x, y: enemy!.y, z: enemy!.z };
    }
    const dx = enemy ? enemy.x - p.pos.x : 0, dz = enemy ? enemy.z - p.pos.z : 0;
    const distance = Math.hypot(dx, dz);

    // ── Healing: break line of sight, then pop a medkit ────────────────────
    const hurt = view.me.health <= DUEL_MAX_HEALTH * (0.35 + s * 0.2);
    if (hurt && view.me.medkits > 0 && now >= this.healUntil && (!visible || distance > 16 || this.rng() < 0.02)) {
      action.heal = true;
      this.healUntil = now + 8000;
    }

    // ── Movement ───────────────────────────────────────────────────────────
    const input: PlayerInput = { ...FROZEN_INPUT };
    const centre = { x: (view.arena.minX + view.arena.maxX) / 2, z: (view.arena.minZ + view.arena.maxZ) / 2 };
    if (visible && enemy) {
      p.yaw = Math.atan2(-dx, -dz); // face the target, move relative to it
      const preferred = 8 + (1 - s) * 7;
      const retreating = hurt && view.me.medkits > 0;
      if (retreating || distance < preferred - 3) input.back = true;
      else if (distance > preferred + 4) input.forward = true;
      if (now >= this.strafeUntil) {
        // Better bots juke more often and less predictably.
        this.strafe = this.rng() < 0.5 + s * 0.2 ? -this.strafe : this.strafe;
        this.strafeUntil = now + 350 + (1 - s) * 900 + this.rng() * 500;
        if (s > 0.55 && p.onGround && this.rng() < (s - 0.5) * 0.7) input.jump = true;
      }
      if (this.strafe > 0) input.right = true; else input.left = true;
      input.sprintHeld = input.sprintKey = input.forward && s > 0.4;
      // Throw up cover while patching up in the open.
      if (retreating && s > 0.45 && distance > 4.5 && now >= this.nextBuild && p.onGround) {
        this.nextBuild = now + 900 + (1 - s) * 1500;
        const len = distance || 1;
        const bx = Math.floor(p.pos.x + dx / len * 1.6), bz = Math.floor(p.pos.z + dz / len * 1.6);
        const by = Math.floor(p.pos.y + 0.01);
        action.build.push({ x: bx, y: by, z: bz }, { x: bx, y: by + 1, z: bz });
      }
    } else {
      // Hunt: head for where the target was last seen, or take the high ground.
      if (!this.goal || Math.hypot(this.goal.x - p.pos.x, this.goal.z - p.pos.z) < 1.5) {
        const known = enemy && (now - this.seenAt > 4000 || this.rng() < 0.35 + s * 0.4) ? enemy : this.lastSeen;
        this.goal = known && this.rng() < 0.8
          ? { x: known.x, y: known.y, z: known.z }
          : { x: centre.x + (this.rng() - 0.5) * 3, y: 0, z: centre.z + (this.rng() - 0.5) * 3 };
      }
      if (enemy && now - this.seenAt > 1500) this.goal = { x: enemy.x, y: enemy.y, z: enemy.z };
      p.yaw = Math.atan2(-(this.goal.x - p.pos.x), -(this.goal.z - p.pos.z));
      input.forward = true;
      input.sprintHeld = input.sprintKey = true;
    }
    // Unstick: blocked against cover or a wall means jump, then side-step.
    if (now - this.lastPos.at > 600) {
      const moved = Math.hypot(p.pos.x - this.lastPos.x, p.pos.z - this.lastPos.z);
      const trying = input.forward || input.back || input.left || input.right;
      if (trying && moved < 0.35 && p.onGround) {
        input.jump = true;
        if (this.rng() < 0.5) { this.unstickUntil = now + 700; this.unstickDir = this.rng() < 0.5 ? -1 : 1; this.goal = null; }
      }
      this.lastPos = { x: p.pos.x, z: p.pos.z, at: now };
    }
    if (now < this.unstickUntil) {
      input.left = this.unstickDir < 0; input.right = this.unstickDir > 0;
    }
    if (p.onGround && (input.forward || input.back || input.left || input.right) && this.blockedAhead(world, input)) input.jump = true;
    this.input = input;

    // ── Shooting: three-round bursts at a human cadence ────────────────────
    if (this.reloadUntil && now >= this.reloadUntil) { this.loaded = 24; this.reloadUntil = 0; }
    const reacted = now - this.acquiredAt >= 480 - s * 360;
    if (visible && enemy && chest && reacted && !enemy.shielded && !this.reloadUntil && !action.heal) {
      if (this.burstLeft === 0 && now >= this.nextBurst) {
        this.burstLeft = 3;
        this.nextRound = now;
        this.nextBurst = now + 500 + (1 - s) * 550 + this.rng() * 220;
      }
      if (this.burstLeft > 0 && now >= this.nextRound) {
        this.burstLeft--; this.loaded--;
        this.nextRound = now + 60;
        const range = Math.hypot(chest.x - eye.x, chest.y - eye.y, chest.z - eye.z);
        const moving = Math.abs(p.vel.x) + Math.abs(p.vel.z) > 1;
        let chance = (0.16 + 0.64 * s) * clamp(1.18 - range / 38, 0.4, 1);
        chance *= 1 - clamp(this.enemySpeed / 8, 0, 0.4) * (1 - s * 0.55);
        if (moving) chance *= 0.92;
        if (!p.onGround) chance *= 0.8;
        chance = clamp(chance + Math.min(this.tracking, 4) * 0.02 * s, 0.04, 0.9);
        const hit = this.rng() < chance;
        this.tracking = hit ? this.tracking + 1 : 0;
        // A miss is drawn as a miss: the tracer visibly passes the target.
        const miss = hit ? 0.25 : 1.4 + this.rng() * 1.6;
        const ang = this.rng() * Math.PI * 2;
        const tx = chest.x + Math.cos(ang) * miss, ty = chest.y + Math.sin(ang) * miss * 0.6, tz = chest.z + Math.sin(ang) * miss;
        action.shots.push({ from: eye, dx: tx - eye.x, dy: ty - eye.y, dz: tz - eye.z, hit });
        if (this.loaded <= 0) { this.burstLeft = 0; this.reloadUntil = now + 1100 + (1 - s) * 500; }
      }
    } else {
      this.burstLeft = 0;
      // Top up the magazine between fights, like a player would.
      if (!visible && this.loaded < 12 && !this.reloadUntil) this.reloadUntil = now + 1100;
    }

    const steps = Math.max(1, Math.ceil(dt * 120));
    for (let i = 0; i < steps; i++) this.body.update(dt / steps, this.input, world);
    return action;
  }

  /** True once the bot has respawned and the server should sync its body. */
  get needsRespawnSync(): boolean { return !this.wasAlive; }

  private blockedAhead(world: World, input: PlayerInput): boolean {
    const p = this.body;
    let fx = 0, fz = 0;
    const sin = Math.sin(p.yaw), cos = Math.cos(p.yaw);
    if (input.forward) { fx -= sin; fz -= cos; }
    if (input.back) { fx += sin; fz += cos; }
    if (input.right) { fx += cos; fz -= sin; }
    if (input.left) { fx -= cos; fz += sin; }
    const len = Math.hypot(fx, fz);
    if (len < 1e-3) return false;
    const x = Math.floor(p.pos.x + fx / len * 0.8), z = Math.floor(p.pos.z + fz / len * 0.8), y = Math.floor(p.pos.y + 0.01);
    const solid = (yy: number) => !!BLOCKS[world.getBlock(x, yy, z)]?.solid;
    return solid(y) && !solid(y + 1) && !solid(y + 2);
  }
}
