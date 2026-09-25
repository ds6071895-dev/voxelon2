// Server-only input driver. Bots use the same Player collision/gravity as clients;
// goals, checkpoints, damage and course hazards still belong to PartyGamesEngine.
import { Player } from './player';
import { Block, BLOCKS } from './blocks';
import { FROZEN_INPUT, type PlayerInput } from './input';
import type { World } from './world';
import {
  BRIDGE_GOALS, BRIDGE_LANE_X, PARTY_FLOOR_Y, parkourCourse, partyArenaBlockAt,
  type PartyLobbySnapshot, type PartyParticipant, type PartyVec3,
} from './partygames';
import type { ParkourPlatform } from './parkour_course';
import { blinkSolid, parkourPadImpulse, parkourPadUnder } from './parkour_mechanics';

export const PARTY_BOT_WAIT_MS = 20_000;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const solidAt = (world: World, x: number, y: number, z: number) => !!BLOCKS[world.getBlock(x, y, z)]?.solid;
const isWool = (block: number) => block === Block.TeamWoolA || block === Block.TeamWoolB;
const RUN: PlayerInput = { ...FROZEN_INPUT, forward: true, sprintKey: true, sprintHeld: true };
interface JumpPlan { x: number; z: number; yaw: number; speed: number }
export interface BotAction { melee?: boolean; shot?: { dx: number; dy: number; dz: number }; edit?: PartyVec3 & { block: number } }

export class PartyBot {
  readonly body: Player;
  skill = .5;
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

  constructor(readonly opponent: number, spawn: PartyVec3, private readonly rng: () => number) {
    this.body = new Player(spawn);
    this.body.energyDrainMult = 0; // Party modes give human players unlimited sprint too.
    this.body.damageSink = () => {}; // The match engine owns falls and health.
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
  }

  /** Falling behind sharpens decisions without changing health, reach, or physics. */
  adapt(now: number, snap: PartyLobbySnapshot, me: PartyParticipant, human: PartyParticipant): void {
    const elapsed = now - snap.round!.startedAt;
    if (elapsed < 3000 || now < this.adaptAt) return;
    this.adaptAt = now + 2500;
    const target = snap.mode === 'bridge'
      ? .52 + (human.score - me.score) * .2 + (human.kills - me.kills) * .045
      : .25 + clamp(human.score / Math.max(1, elapsed / 1000), 0, .7) * .7
        + clamp(human.progress - me.progress, -8, 8) * .02 - Math.min(.12, human.falls * .02);
    this.skill = clamp(this.skill + clamp(target - this.skill, -.09, .09), .2, snap.mode === 'bridge' ? .95 : .8);
  }

  step(dt: number, now: number, snap: PartyLobbySnapshot, me: PartyParticipant,
    human: PartyParticipant, opponent: PartyVec3, world: World): BotAction {
    this.adapt(now, snap, me, human);
    const action: BotAction = {};
    if (snap.mode === 'bridge') this.bridge(now, snap, me, opponent, world, action);
    else this.parkour(now, snap, me, world, action);
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
    return action;
  }

  private bridge(now: number, snap: PartyLobbySnapshot, me: PartyParticipant,
    enemy: PartyVec3, world: World, action: BotAction): void {
    const p = this.body, sub = snap.sub!;
    const dx = enemy.x - p.pos.x, dz = enemy.z - p.pos.z, distance = Math.hypot(dx, dz);
    if (now >= this.nextThink) {
      this.nextThink = now + 130 + (1 - this.skill) * 260 + this.rng() * 120;
      const goal = BRIDGE_GOALS[1 - me.team];
      let tx = sub.minX + BRIDGE_LANE_X + .5, tz = sub.minZ + (goal.minZ + goal.maxZ) / 2;
      if (distance < 4.2 && Math.abs(enemy.y - p.pos.y) < 3 &&
        solidAt(world, Math.floor(enemy.x), Math.floor(p.pos.y) - 1, Math.floor(enemy.z))) {
        tx = enemy.x; tz = enemy.z;
      }
      this.aim = Math.atan2(-(tx - p.pos.x), -(tz - p.pos.z));
      if (distance < 5) this.aim += (this.rng() - .5) * (.7 - this.skill * .45);
      this.input = { ...RUN, sprintHeld: this.rng() < .4 + this.skill * .5, sprintKey: false };
      // Brief hesitations and imperfect swing timing are independent of frame rate.
      if (this.rng() < (1 - this.skill) * .06) this.pauseUntil = now + 100 + this.rng() * 300;
      if (distance < 2 && this.rng() < .3) this.input.forward = false;
    }
    const delta = Math.atan2(Math.sin(this.aim - p.yaw), Math.cos(this.aim - p.yaw));
    p.yaw += clamp(delta, -.18, .18);
    this.input.jump = false;
    const fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw);
    const x = Math.floor(p.pos.x + fx * 1.05), y = Math.floor(p.pos.y + .01), z = Math.floor(p.pos.z + fz * 1.05);
    const solid = (xx: number, yy: number, zz: number) => !!BLOCKS[world.getBlock(xx, yy, zz)]?.solid;
    const obstacle = solid(x, y, z), head = solid(x, y + 1, z);
    if (p.onGround && obstacle) {
      // Start the jump before the collision box reaches the block.
      this.input.jump = !head;
      if (head && now >= this.nextBuild && isWool(world.getBlock(x, y + 1, z))) {
        action.edit = { x, y: y + 1, z, block: Block.Air };
        this.nextBuild = now + 450;
      }
    } else if (p.onGround && head && now >= this.nextBuild && isWool(world.getBlock(x, y + 1, z))) {
      action.edit = { x, y: y + 1, z, block: Block.Air };
      this.nextBuild = now + 450;
    }
    // Repair gaps at a human placement cadence. Portals remain open.
    const localZ = z - sub.minZ;
    if (p.onGround && !solid(x, y - 1, z) && localZ > 10 && localZ < 69) {
      this.input.forward = false;
      if (now >= this.nextBuild) {
        action.edit = { x, y: y - 1, z, block: me.team === 0 ? Block.TeamWoolA : Block.TeamWoolB };
        this.nextBuild = now + 300 + (1 - this.skill) * 450;
      }
    } else if (p.onGround && now >= this.nextBuild && !action.edit &&
      Math.floor(p.pos.x - sub.minX) === BRIDGE_LANE_X &&
      ((localZ >= 20 && localZ <= 34) || (localZ >= 45 && localZ <= 59))) {
      // Widen the exposed tightrope. These attached side blocks give a real
      // landing after sideways knockback and make the bot visibly build.
      const side = this.rng() < .5 ? -1 : 1;
      const bx = sub.minX + BRIDGE_LANE_X + side;
      if (!solid(bx, PARTY_FLOOR_Y, z) && solid(sub.minX + BRIDGE_LANE_X, PARTY_FLOOR_Y, z)) {
        action.edit = { x: bx, y: PARTY_FLOOR_Y, z, block: me.team === 0 ? Block.TeamWoolA : Block.TeamWoolB };
        this.nextBuild = now + 850 + (1 - this.skill) * 1000;
      }
    }
    if ((!p.onGround && p.pos.y > PARTY_FLOOR_Y + 2.5) || now < this.pauseUntil) this.input.forward = false;
    if (distance < 3.2 && now >= this.nextAttack) {
      this.nextAttack = now + 580 + (1 - this.skill) * 450 + this.rng() * 240;
      action.melee = this.rng() < .6 + this.skill * .3;
    }
    if (distance > 6 && distance < 25 && now >= this.nextShot) {
      this.nextShot = now + 2300 + this.rng() * 2000;
      // Aim with angular spread and no perfect leading.
      const error = (.09 - this.skill * .065) * distance;
      action.shot = { dx: dx + (this.rng() - .5) * error * 2,
        dy: enemy.y - p.pos.y + distance * .10 + (this.rng() - .5) * error,
        dz: dz + (this.rng() - .5) * error * 2 };
    }
  }

  private parkour(now: number, snap: PartyLobbySnapshot, me: PartyParticipant, world: World, action: BotAction): void {
    const p = this.body, sub = snap.sub!, course = parkourCourse(sub.seed);
    const a = course.steps[me.progress]?.reduce((best, pad) =>
      Math.hypot(pad.x + sub.minX - p.pos.x, pad.z + sub.minZ - p.pos.z) <
      Math.hypot(best.x + sub.minX - p.pos.x, best.z + sub.minZ - p.pos.z) ? pad : best);
    const b = course.steps[me.progress + 1]?.find(pad => pad.from === a?.index) ?? course.steps[me.progress + 1]?.[0];
    this.input = { ...FROZEN_INPUT };
    if (!a || !b) return;
    if (this.progress !== me.progress) {
      this.progress = me.progress;
      this.jumping = false;
      this.navigation = [];
      this.pauseUntil = now + (a.kind === 'crumble' || a.kind === 'blink' || a.kind === 'launch' || a.kind === 'boost'
        ? 0 : 120 + (1 - this.skill) * 550 + this.rng() * 300);
      const key = `${a.index}:${b.index}`;
      if (!this.plans.has(key)) this.plans.set(key, this.planJump(a, b, {
        isLoaded: () => true,
        getBlock: (x: number, y: number, z: number) => partyArenaBlockAt(x, y, z) ?? Block.Air,
      } as unknown as World, sub.minX, sub.minZ));
      this.plan = this.planJump(a, b, world, sub.minX, sub.minZ) ?? this.plans.get(key) ?? undefined;
      this.nextReplan = now + 1000;
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
    if (now < this.pauseUntil) return;
    // A runner need not walk to a textbook take-off point when the next pad
    // is already reachable. This is especially important on crumble tiles.
    if (p.onGround && now >= this.nextShortcut) {
      this.nextShortcut = now + 180;
      const direct = this.jumpFrom(p.pos.x, p.pos.z, p.pos.y, b, world, sub.minX, sub.minZ);
      if (direct) this.plan = direct;
    }
    if (!this.plan && p.onGround && now >= this.nextReplan) {
      this.nextReplan = now + 1000;
      this.plan = this.planJump(a, b, world, sub.minX, sub.minZ) ?? undefined;
    }
    const plan = this.plan;
    const tx = plan?.x ?? sub.minX + a.x, tz = plan?.z ?? sub.minZ + a.z;
    if (Math.hypot(tx - p.pos.x, tz - p.pos.z) > .075) {
      this.walkTo(tx, a.y, tz, world, a.kind === 'crumble' || a.kind === 'blink', now, action);
      return;
    }
    if (!p.onGround) return;
    if (this.clearWoolAhead(b, sub.minX, sub.minZ, world, now, action)) return;
    const elapsed = now - snap.round!.startedAt;
    if (b.kind === 'blink' && [450, 800, 1150].some(t => !blinkSolid(b.group, elapsed + t))) return;
    // Do the waiting on a stable pad before a crumble -> blink combination.
    const after = course.steps[b.order + 1]?.[0];
    if (b.kind === 'crumble' && after?.kind === 'blink' &&
      [1300, 1650, 2000].some(t => !blinkSolid(after.group, elapsed + t))) return;
    if (!plan) {
      this.input = { ...RUN, jump: true };
      p.yaw = Math.atan2(-(b.x + sub.minX - p.pos.x), -(b.z + sub.minZ - p.pos.z));
      return;
    }
    p.yaw = plan.yaw;
    // Occasional under/over-steering produces real, recoverable misses.
    if (this.rng() < .15 - this.skill * .14) p.yaw += (this.rng() < .5 ? -1 : 1) * .22;
    const dx = -Math.sin(p.yaw), dz = -Math.cos(p.yaw);
    p.vel.x = dx * plan.speed; p.vel.z = dz * plan.speed;
    this.input = { ...RUN, jump: true };
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
        const block = world.getBlock(x, y, z);
        if (block !== Block.TeamWoolA && block !== Block.TeamWoolB) continue;
        if (now >= this.nextBuild) {
          action.edit = { x, y, z, block: Block.Air };
          this.nextBuild = now + 550;
          this.nextReplan = now;
        }
        this.input = { ...FROZEN_INPUT };
        return true;
      }
    }
    return false;
  }

  /** Find a short walk over the current pad, including stairs and obstacle pads.
   * Route around tall obstacles; actual physics still decides jump success. */
  private walkTo(tx: number, ty: number, tz: number, world: World, urgent: boolean, now: number, action: BotAction): void {
    const p = this.body;
    // A previously clear waypoint may now contain a player's wool. Rebuild
    // the local route instead of steering into the same block forever.
    if (this.navigation.length) {
      const next = this.navigation[0], nx = Math.floor(next.x), nz = Math.floor(next.z), ny = Math.round(next.y);
      if (BLOCKS[world.getBlock(nx, ny, nz)]?.solid || BLOCKS[world.getBlock(nx, ny + 1, nz)]?.solid)
        this.navigation = [];
    }
    if (!this.navigation.length && p.onGround) {
      const solid = (x: number, y: number, z: number) => !!BLOCKS[world.getBlock(x, y, z)]?.solid;
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
    while (this.navigation.length && Math.hypot(this.navigation[0].x - p.pos.x, this.navigation[0].z - p.pos.z) < .24)
      this.navigation.shift();
    const target = this.navigation[0] ?? { x: tx, y: ty, z: tz };
    const dx = target.x - p.pos.x, dz = target.z - p.pos.z, distance = Math.hypot(dx, dz);
    p.yaw = Math.atan2(-dx, -dz);
    const aheadX = Math.floor(p.pos.x + dx / (distance || 1) * .5), aheadZ = Math.floor(p.pos.z + dz / (distance || 1) * .5);
    const y = Math.round(p.pos.y);
    const gap = !BLOCKS[world.getBlock(aheadX, y - 1, aheadZ)]?.solid;
    const obstacle = !!BLOCKS[world.getBlock(aheadX, y, aheadZ)]?.solid;
    const head = !!BLOCKS[world.getBlock(aheadX, y + 1, aheadZ)]?.solid;
    // If there is no route around a player placement, clear that placement.
    // The server still validates range and ownership of the arena edit.
    if (!this.navigation.length && now >= this.nextBuild && (obstacle || head)) {
      const by = obstacle ? y : y + 1, block = world.getBlock(aheadX, by, aheadZ);
      if (block === Block.TeamWoolA || block === Block.TeamWoolB) {
        action.edit = { x: aheadX, y: by, z: aheadZ, block: Block.Air };
        this.nextBuild = now + 550;
      }
    }
    this.input = { ...RUN, sprintKey: urgent, sprintHeld: urgent, sneak: this.navigation.length <= 1 && distance < .3 && !gap,
      jump: p.onGround && (gap || obstacle || target.y > p.pos.y + .3) };
  }

  private jumpFrom(x: number, z: number, y: number, b: ParkourPlatform, world: World, minX: number, minZ: number): JumpPlan | null {
    const tx = minX + b.x, tz = minZ + b.z;
    for (const speed of [5.612, 4.317, 3.2, 2.3]) {
      const yaw = Math.atan2(-(tx - x), -(tz - z));
      const trial = new Player({ x, y: y + .001, z });
      trial.damageSink = () => {}; trial.yaw = yaw; trial.onGround = true;
      trial.vel.set(-Math.sin(yaw) * speed, 0, -Math.cos(yaw) * speed);
      for (let frame = 0; frame < 180; frame++) {
        trial.update(1 / 120, { ...RUN, jump: true }, world);
        if (frame > 3 && trial.onGround) {
          if (Math.abs(trial.pos.y - b.y) < .05 && Math.abs(trial.pos.x - tx) < b.width / 2 - .05 &&
            Math.abs(trial.pos.z - tz) < b.depth / 2 - .05) return { x, z, yaw, speed };
          break;
        }
      }
    }
    return null;
  }

  private planJump(a: ParkourPlatform, b: ParkourPlatform, world: World, minX: number, minZ: number): JumpPlan | null {
    const alongX = b.heading % 2 === 1, sign = b.heading < 2 ? 1 : -1;
    const aAlong = alongX ? a.x : a.z, aLat = alongX ? a.z : a.x;
    const bAlong = alongX ? b.x : b.z, bLat = alongX ? b.z : b.x;
    const extent = alongX ? a.width : a.depth, lateral = alongX ? a.depth : a.width, targetLateral = alongX ? b.depth : b.width;
    for (const back of [0, .5, 1, 1.5]) for (const speed of [5.612, 4.317, 3.2, 2.3]) for (const line of [0, 1]) {
      const lip = Math.max(-(extent / 2 - .35), extent / 2 - .35 - back);
      const lat = line === 0 ? clamp(bLat, aLat - lateral / 2 + .35, aLat + lateral / 2 - .35) : aLat;
      const tLat = clamp(lat, bLat - targetLateral / 2 + .35, bLat + targetLateral / 2 - .35);
      const x = minX + (alongX ? aAlong + sign * lip : lat), z = minZ + (alongX ? lat : aAlong + sign * lip);
      const tx = minX + (alongX ? bAlong : tLat), tz = minZ + (alongX ? tLat : bAlong);
      const yaw = Math.atan2(-(tx - x), -(tz - z));
      const trial = new Player({ x, y: a.y + .001, z });
      trial.damageSink = () => {};
      trial.yaw = yaw; trial.onGround = true;
      trial.vel.set(-Math.sin(yaw) * speed, 0, -Math.cos(yaw) * speed);
      if (a.kind === 'launch' || a.kind === 'boost') {
        const kick = parkourPadImpulse(a); trial.vel.set(kick.vx, kick.vy, kick.vz); trial.momentumTime = kick.momentum; trial.onGround = false;
      }
      for (let frame = 0; frame < 240; frame++) {
        trial.update(1 / 120, { ...RUN, jump: true }, world);
        if (frame > 3 && trial.onGround) {
          if (Math.abs(trial.pos.y - b.y) < .05 && Math.abs(trial.pos.x - minX - b.x) < b.width / 2 + .25 &&
            Math.abs(trial.pos.z - minZ - b.z) < b.depth / 2 + .25) return { x, z, yaw, speed };
          break;
        }
      }
    }
    return null;
  }
}
