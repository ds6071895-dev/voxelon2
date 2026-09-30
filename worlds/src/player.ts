// Player physics tuned to vanilla Minecraft's documented constants:
// walk 4.317 m/s, sprint 5.612 m/s, sneak 1.295 m/s, jump apex 1.25 blocks,
// gravity 32 m/s^2, collision box 0.6 x 1.8, eye height 1.62 (1.27 sneaking).

import * as THREE from 'three';
import { Block, collisionBoxes, isSolid } from './blocks';
import type { PlayerInput } from './input';
import type { World } from './world';

/** Min/max corner of a collision box in cell-local [0,1] space. Most solid
 *  blocks are full cubes; stairs and props carry their own sub-boxes. */
type Box = [[number, number, number], [number, number, number]];
const FULL: Box[] = [[[0, 0, 0], [1, 1, 1]]];
const NONE: Box[] = [];


const WALK_SPEED = 4.317;
const SPRINT_SPEED = 5.612;
const SNEAK_SPEED = 1.295;
const GRAVITY = 32;
const JUMP_VELOCITY = Math.sqrt(2 * GRAVITY * 1.25); // exactly 1.25 blocks
const TERMINAL_VELOCITY = 78;
const BASE_HALF_WIDTH = 0.3;
const BASE_HEIGHT = 1.8;
// Vanilla-style auto-step: walk straight up obstacles whose top is within this
// height (slabs, single stairs) when there's headroom, without jumping.
const STEP_HEIGHT = 0.6;
const BASE_EYE_STANDING = 1.62;
const BASE_EYE_SNEAKING = 1.27;
const MOUSE_SENSITIVITY = 0.0022;
const EPS = 0.001;

// Energy/stamina (VOXELON): a full bar lasts ~30s of sprinting and refills
// from empty in ~4s; once drained you must recover to 25% before sprinting.
const ENERGY_DRAIN = 1 / 30;
const ENERGY_REFILL = 1 / 4;
const ENERGY_SPRINT_THRESHOLD = 0.25;
// Spectator flight.
const FLY_SPEED_MULT = 2.4;   // horizontal speed multiplier while flying
const FLY_V_SPEED = 9;        // vertical rise/descend speed (blocks/s)
// Launch momentum (Parkour pads, the Bounce Pad): how hard WASD can push a
// launch around mid-air, and how fast the carried speed bleeds off (per-second
// multiplier), so a launch stays fast for a couple of seconds of flight.
const MOMENTUM_STEER = 13;
const MOMENTUM_DRAG = 0.62;
// Un-sticking: how far the body may be shoved to escape geometry it is already
// inside, and how far it will climb when there is no sideways way out.
const UNSTICK_MAX_PUSH = 2.5;
const UNSTICK_MAX_RISE = 8;

export class Player {
  readonly pos = new THREE.Vector3(); // feet, centre of the box
  readonly vel = new THREE.Vector3();
  yaw = 0;
  pitch = 0;
  onGround = false;
  sprinting = false;
  sneaking = false;
  inWater = false;
  // Health (the server owns it in a match), plus a 0..1 energy bar that gates
  // sprinting.
  health = 20;
  /** Set per mode by main (Duels and party games each have their own). */
  maxHealth = 20;
  energy = 1;
  /** True after energy hits 0 until it recovers to the sprint threshold. */
  exhausted = false;
  fallDistance = 0;
  /** Invulnerability window after a hit. */
  hurtTimer = 0;
  /** Drives the red flash + camera tilt; decays to 0. */
  damageFlash = 0;
  dead = false;
  /** In multiplayer, damage is routed here (to the server) instead of being
   *  applied locally — the server owns health. */
  damageSink?: (amount: number) => void;
  /** Spectator flight: no gravity, jump/sneak rise/descend. */
  flying = false;
  /** Spectator noclip: move through blocks, ignore collision. */
  noclip = false;
  /** Mouse-look sensitivity multiplier (1 = normal). Lowered while a gun is
   *  scoped (aim-down-sights) so high-zoom aiming is steady. */
  lookScale = 1;
  /** Sprint energy-drain multiplier (bots run with 0: unlimited sprint). */
  energyDrainMult = 1;
  /** Seconds of PRESERVED MOMENTUM left after a launch. Normal air control
   *  drags your horizontal speed back toward walking pace within a fraction of
   *  a second, which would eat a launch at once — while this is positive, WASD
   *  instead ADDS thrust to whatever speed you already carry and only a light
   *  drag bleeds it off. Set by whatever launched you (a pad, the Bounce Pad). */
  momentumTime = 0;
  /** Camera-only vertical offset (<= 0). Auto-stepping moves the body up a stair
   *  in one frame; the eye starts that far below and eases back, so climbing
   *  glides instead of snapping. */
  stepLift = 0;
  /** Movement speed multiplier (status effects, a mode's pace). */
  speedMult = 1;
  /** Jump Boost level: each level adds a tenth of a block-per-tick of launch. */
  jumpBoost = 0;
  /** Body size (Rat and Seek shrinks rats to half scale). */
  private halfWidth = BASE_HALF_WIDTH;
  private height = BASE_HEIGHT;
  private eyeStanding = BASE_EYE_STANDING;
  private eyeSneaking = BASE_EYE_SNEAKING;
  private eye = BASE_EYE_STANDING;
  /** Resize the body: collision box and eye height scale together; walking
   *  speed, jump height and step-up height do not (as in vanilla). */
  setBodyScale(scale: number): void {
    const s = Math.max(0.2, Math.min(1, scale));
    this.halfWidth = BASE_HALF_WIDTH * s;
    this.height = BASE_HEIGHT * s;
    this.eyeStanding = BASE_EYE_STANDING * s;
    this.eyeSneaking = BASE_EYE_SNEAKING * s;
    this.eye = this.eyeStanding;
  }
  get bodyHeight(): number { return this.height; }
  get bodyHalfWidth(): number { return this.halfWidth; }
  /** True while the body's own chunk column has streamed in — only then may
   *  collision treat NEIGHBOURING unloaded columns as rock (see cellBoxes). */
  private streamGuard = false;

  constructor(spawn: { x: number; y: number; z: number }) {
    this.pos.set(spawn.x, spawn.y, spawn.z);
  }

  damage(amount: number): void {
    if (this.dead || amount <= 0) return;
    // The server owns health: in a match every hit arrives from it, and any
    // local damage (none in Worlds' modes) is routed to the sink instead.
    if (this.damageSink) { this.damageSink(amount); return; }
    if (this.hurtTimer > 0) return;
    const dealt = Math.max(0, Math.round(amount));
    this.hurtTimer = 0.5;
    this.damageFlash = 0.45;
    if (dealt <= 0) return; // fully absorbed: i-frames + flash, no health loss
    this.health = Math.max(0, this.health - dealt);
    if (this.health <= 0) this.dead = true;
  }

  /** Authoritative health update from the server (multiplayer). */
  setHealthFromServer(health: number, dead: boolean): void {
    if (health < this.health) { this.damageFlash = 0.45; this.hurtTimer = 0.3; }
    this.health = health;
    this.dead = dead;
  }

  respawn(spawn: { x: number; y: number; z: number }): void {
    this.pos.set(spawn.x, spawn.y, spawn.z);
    this.vel.set(0, 0, 0);
    this.health = this.maxHealth;
    this.energy = 1;
    this.exhausted = false;
    this.fallDistance = 0;
    this.hurtTimer = 0;
    this.damageFlash = 0;
    this.dead = false;
    this.momentumTime = 0;
    this.stepLift = 0;
  }

  get eyePosition(): THREE.Vector3 {
    return new THREE.Vector3(this.pos.x, this.pos.y + this.eye + this.stepLift, this.pos.z);
  }

  update(dt: number, input: PlayerInput, world: World): void {
    if (this.dead) return;
    // Only trust "that chunk is empty" once our own chunk is real (see cellBoxes).
    this.streamGuard =
      world.isLoaded?.(Math.floor(this.pos.x), Math.floor(this.pos.z)) ?? false;
    this.hurtTimer = Math.max(0, this.hurtTimer - dt);
    this.damageFlash = Math.max(0, this.damageFlash - dt);

    // Mouse look (lookScale < 1 while scoped for steady aim-down-sights).
    this.yaw -= input.mouseDX * MOUSE_SENSITIVITY * this.lookScale;
    this.pitch -= input.mouseDY * MOUSE_SENSITIVITY * this.lookScale;
    const maxPitch = Math.PI / 2 - 0.001;
    this.pitch = Math.max(-maxPitch, Math.min(maxPitch, this.pitch));

    // Sprint is gated on energy: blocked while sneaking, not moving forward,
    // or exhausted (energy hit 0 and hasn't recovered to the threshold yet).
    this.sneaking = input.sneak;
    if (!input.forward || this.sneaking || this.exhausted) {
      this.sprinting = false;
    } else if (input.sprintKey || input.sprintHeld) {
      this.sprinting = true;
    }

    // Water state (feet column).
    const feetBlock = world.getBlock(
      Math.floor(this.pos.x), Math.floor(this.pos.y + 0.4), Math.floor(this.pos.z)
    );
    this.inWater = feetBlock === Block.Water;

    // Wish direction in the horizontal plane, relative to yaw.
    let fwd = 0, strafe = 0;
    if (input.forward) fwd += 1;
    if (input.back) fwd -= 1;
    if (input.left) strafe -= 1;
    if (input.right) strafe += 1;
    const len = Math.hypot(fwd, strafe);
    if (len > 0) { fwd /= len; strafe /= len; }

    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    const dirX = -sin * fwd + cos * strafe;
    const dirZ = -cos * fwd - sin * strafe;

    let speed = this.sneaking ? SNEAK_SPEED : this.sprinting ? SPRINT_SPEED : WALK_SPEED;
    if (this.inWater) speed *= 0.45;
    speed *= this.speedMult;
    if (this.flying) speed = (this.sprinting ? SPRINT_SPEED : WALK_SPEED) * FLY_SPEED_MULT;

    // Approach target velocity; much weaker control while airborne (but full
    // authority while flying).
    const grounded = this.flying || this.onGround || this.inWater;
    if (this.momentumTime > 0 && !grounded) {
      // Carrying launch momentum: steering ADDS thrust in the direction you
      // ask for, and only a light air drag bleeds the speed off, so a launch
      // stays a launch and can be aimed mid-flight.
      this.vel.x += dirX * MOMENTUM_STEER * dt;
      this.vel.z += dirZ * MOMENTUM_STEER * dt;
      const drag = Math.pow(MOMENTUM_DRAG, dt);
      this.vel.x *= drag;
      this.vel.z *= drag;
    } else {
      const accel = grounded ? 14 : 3;
      const t = Math.min(1, accel * dt);
      this.vel.x += (dirX * speed - this.vel.x) * t;
      this.vel.z += (dirZ * speed - this.vel.z) * t;
    }
    // Landing (or a swim) ends the momentum window; otherwise it decays.
    this.momentumTime = grounded && !this.flying
      ? 0 : Math.max(0, this.momentumTime - dt);

    // Vertical.
    if (this.flying) {
      // Free vertical control: jump rises, sneak descends, no gravity/fall.
      let vy = 0;
      if (input.jump) vy += 1;
      if (input.sneak) vy -= 1;
      this.vel.y = vy * FLY_V_SPEED;
      this.fallDistance = 0;
    } else if (this.inWater) {
      this.vel.y -= GRAVITY * 0.4 * dt;
      this.vel.y *= 1 - 2.5 * dt; // drag
      if (input.jump) this.vel.y += 24 * dt;
      this.vel.y = Math.max(-6, Math.min(4.5, this.vel.y));
      // Climbing out: at the water's edge, holding jump while pushing into a
      // 1-block ledge gives an upward hop that beats the buoyancy clamp, so
      // you mount the block instead of bobbing against it (like vanilla).
      if (input.jump && len > 0 && this.ledgeAhead(world, dirX, dirZ)) {
        this.vel.y = 5.5;
      }
    } else {
      if (input.jump && this.onGround) {
        this.vel.y = JUMP_VELOCITY * (0.42 + 0.1 * this.jumpBoost) / 0.42;
        this.onGround = false;
      }
      this.vel.y -= GRAVITY * dt;
      if (this.vel.y < -TERMINAL_VELOCITY) this.vel.y = -TERMINAL_VELOCITY;
    }

    // Energy: sprinting drains it; otherwise it refills. Hitting 0 forces a
    // recovery to ENERGY_SPRINT_THRESHOLD before sprinting is allowed again.
    if (this.sprinting) {
      this.energy = Math.max(0, this.energy - ENERGY_DRAIN * this.energyDrainMult * dt);
      if (this.energy === 0) {
        this.exhausted = true;
        this.sprinting = false;
      }
    } else {
      this.energy = Math.min(1, this.energy + ENERGY_REFILL * dt);
      if (this.exhausted && this.energy >= ENERGY_SPRINT_THRESHOLD) {
        this.exhausted = false;
      }
    }

    // Fall distance accumulates while dropping (water breaks the fall).
    if (this.inWater) this.fallDistance = 0;
    else if (!this.onGround && this.vel.y < 0) {
      this.fallDistance += -this.vel.y * dt;
    }

    // Integrate. Noclip (spectator) moves straight through the world; otherwise
    // resolve collisions one axis at a time (y first).
    if (this.noclip) {
      this.pos.addScaledVector(this.vel, dt);
      this.onGround = false;
      this.fallDistance = 0;
    } else {
      // The axis resolver assumes the body starts the step OUTSIDE the world.
      // Restore that invariant first if something broke it.
      this.unstick(world);
      const wasOnGround = this.onGround;
      this.onGround = false;
      this.moveAxis(world, 1, this.vel.y * dt);
      const yBeforeSteps = this.pos.y;
      this.moveAxisSneakAware(world, 0, this.vel.x * dt, wasOnGround);
      this.moveAxisSneakAware(world, 2, this.vel.z * dt, wasOnGround);
      // Ease the camera over an auto-step (a jump never lands here: it isn't grounded).
      const rose = this.pos.y - yBeforeSteps;
      if (wasOnGround && this.onGround && rose > 0.02 && rose <= STEP_HEIGHT + 0.02) {
        this.stepLift = Math.max(-STEP_HEIGHT, this.stepLift - rose);
      }

      // Landing: vanilla fall damage = blocks fallen minus 3.
      if (this.onGround && this.fallDistance > 0) {
        const dmg = Math.ceil(Math.max(0, this.fallDistance - 3.2));
        if (dmg > 0) this.damage(dmg);
        this.fallDistance = 0;
      }
    }

    // The step offset eases out fast enough to keep up with a sprint up the stairs.
    if (this.stepLift !== 0) {
      this.stepLift *= Math.exp(-dt * 11);
      if (this.stepLift > -0.002) this.stepLift = 0;
    }

    // Smooth eye height (sneak transition).
    const targetEye = this.sneaking ? this.eyeSneaking : this.eyeStanding;
    this.eye += (targetEye - this.eye) * Math.min(1, 14 * dt);
  }

  /** Sneaking on the ground refuses moves that would leave you unsupported. */
  private moveAxisSneakAware(
    world: World, axis: 0 | 2, amount: number, wasOnGround: boolean
  ): void {
    if (this.sneaking && wasOnGround && amount !== 0) {
      const saved = axis === 0 ? this.pos.x : this.pos.z;
      const savedY = this.pos.y;
      this.moveHorizontal(world, axis, amount, wasOnGround);
      if (!this.hasSupport(world)) {
        if (axis === 0) { this.pos.x = saved; this.vel.x = 0; }
        else { this.pos.z = saved; this.vel.z = 0; }
        this.pos.y = savedY; // also undo any auto-step that ran with the move
      }
      return;
    }
    this.moveHorizontal(world, axis, amount, wasOnGround);
  }

  /** Horizontal move with vanilla auto-step: if a move is blocked by an obstacle
   *  whose top is within STEP_HEIGHT of the feet AND there's headroom for the
   *  full player height above it, climb onto it instead of stopping. */
  private moveHorizontal(
    world: World, axis: 0 | 2, amount: number, wasOnGround: boolean
  ): void {
    const startX = this.pos.x, startY = this.pos.y, startZ = this.pos.z;
    const v0 = axis === 0 ? this.vel.x : this.vel.z;
    this.moveAxis(world, axis, amount);
    const achieved = axis === 0 ? this.pos.x - startX : this.pos.z - startZ;
    // Only step while grounded and only when the move was actually blocked.
    if (!wasOnGround || Math.abs(achieved) >= Math.abs(amount) - EPS) return;

    // Keep the un-stepped (flat) result as the fallback.
    const flatX = this.pos.x, flatY = this.pos.y, flatZ = this.pos.z;

    // Lift up to STEP_HEIGHT (a ceiling can cut this short), redo the move, then
    // settle back down so the feet rest on whatever we stepped onto.
    this.pos.set(startX, startY, startZ);
    this.moveAxis(world, 1, STEP_HEIGHT);
    if (this.pos.y - startY < STEP_HEIGHT - EPS) {
      this.pos.set(flatX, flatY, flatZ); // no headroom to step
      return;
    }
    this.moveAxis(world, axis, amount);
    this.moveAxis(world, 1, -STEP_HEIGHT);

    const stepped = axis === 0 ? this.pos.x - startX : this.pos.z - startZ;
    const flat = axis === 0 ? flatX - startX : flatZ - startZ;
    if (Math.abs(stepped) > Math.abs(flat) + EPS) {
      // Stepped further than the flat move: keep it + restore horizontal speed.
      if (axis === 0) this.vel.x = v0; else this.vel.z = v0;
    } else {
      this.pos.set(flatX, flatY, flatZ);
    }
  }

  /** A solid block one step ahead at foot level with two *air* (not water)
   *  blocks above it — i.e. a ledge at the water's edge to climb out onto.
   *  Requiring true air keeps the hop from firing on submerged 1-block bumps. */
  private ledgeAhead(world: World, dirX: number, dirZ: number): boolean {
    const px = this.pos.x + dirX * (this.halfWidth + 0.2);
    const pz = this.pos.z + dirZ * (this.halfWidth + 0.2);
    const bx = Math.floor(px), bz = Math.floor(pz);
    const fy = Math.floor(this.pos.y + 0.1);
    return (
      isSolid(world.getBlock(bx, fy, bz)) &&
      world.getBlock(bx, fy + 1, bz) === Block.Air &&
      world.getBlock(bx, fy + 2, bz) === Block.Air
    );
  }

  /** Collision boxes of one cell, with UNGENERATED WORLD TREATED AS ROCK.
   *  `world.getBlock` answers Air for a chunk that has not streamed in yet, so
   *  anything moving faster than the chunk loader (a pad launch, a long fall)
   *  would sail straight through terrain that merely hasn't arrived, ending up
   *  inside the ground once it does. Only guard while the body's OWN column is
   *  loaded, so a player can never be frozen by the chunk they are standing in. */
  private cellBoxes(world: World, x: number, y: number, z: number): Box[] {
    if (this.streamGuard && !(world.isLoaded?.(x, z) ?? true)) return FULL;
    return collisionBoxes(world.getBlock(x, y, z)) ?? NONE;
  }

  /** Does the body overlap solid geometry at (x, y, z)? */
  private overlapping(world: World, x: number, y: number, z: number): boolean {
    const minX = x - this.halfWidth, maxX = x + this.halfWidth;
    const minY = y, maxY = y + this.height;
    const minZ = z - this.halfWidth, maxZ = z + this.halfWidth;
    for (let cx = Math.floor(minX); cx <= Math.floor(maxX); cx++)
      for (let cy = Math.floor(minY); cy <= Math.floor(maxY); cy++)
        for (let cz = Math.floor(minZ); cz <= Math.floor(maxZ); cz++) {
          const boxes = this.cellBoxes(world, cx, cy, cz);
          for (let b = 0; b < boxes.length; b++) {
            const [mn, mx] = boxes[b];
            if (maxX <= cx + mn[0] || minX >= cx + mx[0]) continue;
            if (maxY <= cy + mn[1] || minY >= cy + mx[1]) continue;
            if (maxZ <= cz + mn[2] || minZ >= cz + mx[2]) continue;
            return true;
          }
        }
    return false;
  }

  /**
   * Push the body out of any geometry it is ALREADY inside, along the shallowest
   * axis that frees it.
   *
   * Nothing in normal movement can end a step overlapping a block — but plenty
   * outside it can: a teleport, a block placed where you stand, a chunk
   * streaming in around you. The axis resolver's answer to a pre-existing overlap is to snap
   * the body to the far face of the offending box, which is a BLOCK-SIZED JUMP
   * WITH NO SWEEP: repeated over a few frames it walks a stuck player clean
   * through a wall and out into the rock beyond, where they can then swim around
   * underground. Restoring the invariant here is what makes that impossible.
   */
  private unstick(world: World): void {
    const p = this.pos;
    if (!this.overlapping(world, p.x, p.y, p.z)) return;

    const minX = p.x - this.halfWidth, maxX = p.x + this.halfWidth;
    const minY = p.y, maxY = p.y + this.height;
    const minZ = p.z - this.halfWidth, maxZ = p.z + this.halfWidth;
    // Distance to travel along each of the six directions to clear EVERY box
    // the body currently intersects.
    let up = 0, down = 0, east = 0, west = 0, south = 0, north = 0;
    for (let x = Math.floor(minX); x <= Math.floor(maxX); x++) {
      for (let y = Math.floor(minY); y <= Math.floor(maxY); y++) {
        for (let z = Math.floor(minZ); z <= Math.floor(maxZ); z++) {
          const boxes = this.cellBoxes(world, x, y, z);
          for (let b = 0; b < boxes.length; b++) {
            const [mn, mx] = boxes[b];
            const bx0 = x + mn[0], bx1 = x + mx[0];
            const by0 = y + mn[1], by1 = y + mx[1];
            const bz0 = z + mn[2], bz1 = z + mx[2];
            if (maxX <= bx0 || minX >= bx1) continue;
            if (maxY <= by0 || minY >= by1) continue;
            if (maxZ <= bz0 || minZ >= bz1) continue;
            up = Math.max(up, by1 - minY + EPS);
            down = Math.max(down, maxY - by0 + EPS);
            east = Math.max(east, bx1 - minX + EPS);
            west = Math.max(west, maxX - bx0 + EPS);
            south = Math.max(south, bz1 - minZ + EPS);
            north = Math.max(north, maxZ - bz0 + EPS);
          }
        }
      }
    }

    // Shallowest first; ties go to rising, which is the one direction that is
    // always an escape from a floor that appeared underfoot.
    const tries: Array<[number, number, number, number]> = [
      [up, 0, up, 0], [east, east, 0, 0], [west, -west, 0, 0],
      [south, 0, 0, south], [north, 0, 0, -north], [down, 0, -down, 0],
    ];
    tries.sort((a, b) => a[0] - b[0]);
    for (const [cost, dx, dy, dz] of tries) {
      if (cost <= 0 || cost > UNSTICK_MAX_PUSH) continue;
      if (this.overlapping(world, p.x + dx, p.y + dy, p.z + dz)) continue;
      p.set(p.x + dx, p.y + dy, p.z + dz);
      if (dx !== 0) this.vel.x = 0;
      if (dy !== 0) this.vel.y = 0;
      if (dz !== 0) this.vel.z = 0;
      this.fallDistance = 0; // being shoved out is not a fall
      return;
    }

    // Entombed: climb out. Rising always terminates (there is sky above every
    // column), and beats the alternative of phasing sideways through the rock.
    for (let rise = 0.5; rise <= UNSTICK_MAX_RISE; rise += 0.5) {
      if (this.overlapping(world, p.x, p.y + rise, p.z)) continue;
      p.y += rise;
      this.vel.set(0, 0, 0);
      this.fallDistance = 0;
      return;
    }
    // Buried deeper than we are willing to teleport: hold still rather than
    // tunnel. The chunk/teleport that caused it will settle within a frame.
    this.vel.set(0, 0, 0);
    this.fallDistance = 0;
  }

  private hasSupport(world: World): boolean {
    const y = Math.floor(this.pos.y - 0.05);
    const x0 = Math.floor(this.pos.x - this.halfWidth);
    const x1 = Math.floor(this.pos.x + this.halfWidth);
    const z0 = Math.floor(this.pos.z - this.halfWidth);
    const z1 = Math.floor(this.pos.z + this.halfWidth);
    for (let x = x0; x <= x1; x++)
      for (let z = z0; z <= z1; z++)
        if (isSolid(world.getBlock(x, y, z))) return true;
    return false;
  }

  private moveAxis(world: World, axis: 0 | 1 | 2, amount: number): void {
    if (amount === 0) return;
    // Sub-step so a fast move (terminal-velocity fall, knockback) can't tunnel
    // through a thin floor/wall between samples.
    const steps = Math.ceil(Math.abs(amount) / 0.5);
    const slice = amount / steps;
    for (let i = 0; i < steps; i++) {
      if (this.resolveAxis(world, axis, slice)) break; // clamped: no more travel
    }
  }

  /** Move the player `amount` along one axis, then resolve against the partial
   *  collision boxes (shapes.ts) of every overlapping cell — clamping to the
   *  strongest correction across all boxes. Returns true if a box clamped it. */
  private resolveAxis(world: World, axis: 0 | 1 | 2, amount: number): boolean {
    const p = this.pos;
    if (axis === 0) p.x += amount;
    else if (axis === 1) p.y += amount;
    else p.z += amount;

    const minX = p.x - this.halfWidth, maxX = p.x + this.halfWidth;
    const minY = p.y, maxY = p.y + this.height;
    const minZ = p.z - this.halfWidth, maxZ = p.z + this.halfWidth;
    const x0 = Math.floor(minX), x1 = Math.floor(maxX);
    const y0 = Math.floor(minY), y1 = Math.floor(maxY);
    const z0 = Math.floor(minZ), z1 = Math.floor(maxZ);

    let best: number | null = null; // resolved coordinate along `axis`
    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) {
        for (let z = z0; z <= z1; z++) {
          const boxes = this.cellBoxes(world, x, y, z);
          for (let b = 0; b < boxes.length; b++) {
            const [mn, mx] = boxes[b];
            const bx0 = x + mn[0], bx1 = x + mx[0];
            const by0 = y + mn[1], by1 = y + mx[1];
            const bz0 = z + mn[2], bz1 = z + mx[2];
            // Genuine overlap (penetration) on all three axes?
            if (maxX <= bx0 || minX >= bx1) continue;
            if (maxY <= by0 || minY >= by1) continue;
            if (maxZ <= bz0 || minZ >= bz1) continue;
            let c: number;
            if (axis === 0) c = amount > 0 ? bx0 - this.halfWidth - EPS : bx1 + this.halfWidth + EPS;
            else if (axis === 1) c = amount > 0 ? by0 - this.height - EPS : by1 + EPS;
            else c = amount > 0 ? bz0 - this.halfWidth - EPS : bz1 + this.halfWidth + EPS;
            if (best === null || (amount > 0 ? c < best : c > best)) best = c;
          }
        }
      }
    }

    if (best === null) return false;
    if (axis === 0) { p.x = best; this.vel.x = 0; }
    else if (axis === 1) {
      p.y = best; this.vel.y = 0;
      if (amount < 0) this.onGround = true; // a box top supported the feet
    } else { p.z = best; this.vel.z = 0; }
    return true;
  }

  /** AABB overlap test used to forbid placing a (full-cube) block inside the
   *  player. */
  intersectsBlock(bx: number, by: number, bz: number): boolean {
    return bx + 1 > this.pos.x - this.halfWidth && bx < this.pos.x + this.halfWidth &&
      by + 1 > this.pos.y && by < this.pos.y + this.height &&
      bz + 1 > this.pos.z - this.halfWidth && bz < this.pos.z + this.halfWidth;
  }
}
