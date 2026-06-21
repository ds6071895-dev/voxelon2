// Player physics tuned to vanilla Minecraft's documented constants:
// walk 4.317 m/s, sprint 5.612 m/s, sneak 1.295 m/s, jump apex 1.25 blocks,
// gravity 32 m/s^2, collision box 0.6 x 1.8, eye height 1.62 (1.27 sneaking).

import * as THREE from 'three';
import { Block, isSolid } from './blocks';
import type { PlayerInput } from './input';
import { mitigate } from './net/protocol';
import type { World } from './world';

export const MAX_AIR = 15; // seconds of breath = vanilla's 10 bubbles

const WALK_SPEED = 4.317;
const SPRINT_SPEED = 5.612;
const SNEAK_SPEED = 1.295;
const GRAVITY = 32;
const JUMP_VELOCITY = Math.sqrt(2 * GRAVITY * 1.25); // exactly 1.25 blocks
const TERMINAL_VELOCITY = 78;
const HALF_WIDTH = 0.3;
const HEIGHT = 1.8;
const EYE_STANDING = 1.62;
const EYE_SNEAKING = 1.27;
const MOUSE_SENSITIVITY = 0.0022;
const EPS = 0.001;

// Energy/stamina (VOXELON): a full bar lasts ~30s of sprinting and refills
// from empty in ~4s; once drained you must recover to 25% before sprinting.
const ENERGY_DRAIN = 1 / 30;
const ENERGY_REFILL = 1 / 4;
const ENERGY_SPRINT_THRESHOLD = 0.25;
const DAMAGE_REGEN_DELAY = 3; // seconds after a hit before health regen resumes

export class Player {
  readonly pos = new THREE.Vector3(); // feet, centre of the box
  readonly vel = new THREE.Vector3();
  yaw = 0;
  pitch = 0;
  onGround = false;
  sprinting = false;
  sneaking = false;
  inWater = false;
  eyeUnderwater = false;
  // Survival stats: 20 HP, plus a 0..1 energy bar that gates sprinting.
  health = 20;
  energy = 1;
  /** True after energy hits 0 until it recovers to the sprint threshold. */
  exhausted = false;
  air = MAX_AIR;
  fallDistance = 0;
  /** Counts down after a hit; health only regenerates once it reaches 0. */
  regenCooldown = 0;
  /** Invulnerability window after a hit. */
  hurtTimer = 0;
  /** Drives the red flash + camera tilt; decays to 0. */
  damageFlash = 0;
  dead = false;
  /** In multiplayer, damage is routed here (to the server) instead of being
   *  applied locally — the server owns health. */
  damageSink?: (amount: number) => void;
  /** Total worn-armor defense points (kept in sync by main each frame); used
   *  for offline mitigation. In MP the server mitigates from its synced copy. */
  armorPoints = 0;
  private eye = EYE_STANDING;

  constructor(spawn: { x: number; y: number; z: number }) {
    this.pos.set(spawn.x, spawn.y, spawn.z);
  }

  damage(amount: number): void {
    if (this.dead || amount <= 0) return;
    // In MP the server owns health AND armor mitigation: send the RAW amount so
    // it isn't reduced twice. Offline, mitigate here with our worn armor.
    if (this.damageSink) { this.damageSink(amount); return; }
    if (this.hurtTimer > 0) return;
    const dealt = mitigate(amount, this.armorPoints);
    this.hurtTimer = 0.5;
    this.damageFlash = 0.45;
    this.regenCooldown = DAMAGE_REGEN_DELAY;
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
    this.health = 20;
    this.energy = 1;
    this.exhausted = false;
    this.air = MAX_AIR;
    this.fallDistance = 0;
    this.regenCooldown = 0;
    this.hurtTimer = 0;
    this.damageFlash = 0;
    this.dead = false;
  }

  get eyePosition(): THREE.Vector3 {
    return new THREE.Vector3(this.pos.x, this.pos.y + this.eye, this.pos.z);
  }

  update(dt: number, input: PlayerInput, world: World): void {
    if (this.dead) return;
    this.hurtTimer = Math.max(0, this.hurtTimer - dt);
    this.damageFlash = Math.max(0, this.damageFlash - dt);
    // regenCooldown is ticked by Survival.update (runs while paused/inventory).

    // Mouse look.
    this.yaw -= input.mouseDX * MOUSE_SENSITIVITY;
    this.pitch -= input.mouseDY * MOUSE_SENSITIVITY;
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

    // Water state (feet column and eye block).
    const feetBlock = world.getBlock(
      Math.floor(this.pos.x), Math.floor(this.pos.y + 0.4), Math.floor(this.pos.z)
    );
    this.inWater = feetBlock === Block.Water;
    const eyeP = this.eyePosition;
    this.eyeUnderwater =
      world.getBlock(Math.floor(eyeP.x), Math.floor(eyeP.y), Math.floor(eyeP.z)) ===
      Block.Water;

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

    let speed = this.sneaking ? SNEAK_SPEED
      : this.sprinting ? SPRINT_SPEED
      : WALK_SPEED;
    if (this.inWater) speed *= 0.45;

    // Approach target velocity; much weaker control while airborne.
    const accel = this.onGround || this.inWater ? 14 : 3;
    const t = Math.min(1, accel * dt);
    this.vel.x += (dirX * speed - this.vel.x) * t;
    this.vel.z += (dirZ * speed - this.vel.z) * t;

    // Vertical.
    if (this.inWater) {
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
        this.vel.y = JUMP_VELOCITY;
        this.onGround = false;
      }
      this.vel.y -= GRAVITY * dt;
      if (this.vel.y < -TERMINAL_VELOCITY) this.vel.y = -TERMINAL_VELOCITY;
    }

    // Energy: sprinting drains it; otherwise it refills. Hitting 0 forces a
    // recovery to ENERGY_SPRINT_THRESHOLD before sprinting is allowed again.
    if (this.sprinting) {
      this.energy = Math.max(0, this.energy - ENERGY_DRAIN * dt);
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

    // Integrate with collisions, one axis at a time (y first).
    const wasOnGround = this.onGround;
    this.onGround = false;
    this.moveAxis(world, 1, this.vel.y * dt);
    this.moveAxisSneakAware(world, 0, this.vel.x * dt, wasOnGround);
    this.moveAxisSneakAware(world, 2, this.vel.z * dt, wasOnGround);

    // Landing: vanilla fall damage = blocks fallen minus 3.
    if (this.onGround && this.fallDistance > 0) {
      const dmg = Math.ceil(this.fallDistance - 3.2);
      if (dmg > 0) this.damage(dmg);
      this.fallDistance = 0;
    }

    // Smooth eye height (sneak transition).
    const targetEye = this.sneaking ? EYE_SNEAKING : EYE_STANDING;
    this.eye += (targetEye - this.eye) * Math.min(1, 14 * dt);
  }

  /** Sneaking on the ground refuses moves that would leave you unsupported. */
  private moveAxisSneakAware(
    world: World, axis: 0 | 2, amount: number, wasOnGround: boolean
  ): void {
    if (this.sneaking && wasOnGround && amount !== 0) {
      const saved = axis === 0 ? this.pos.x : this.pos.z;
      this.moveAxis(world, axis, amount);
      if (!this.hasSupport(world)) {
        if (axis === 0) { this.pos.x = saved; this.vel.x = 0; }
        else { this.pos.z = saved; this.vel.z = 0; }
      }
      return;
    }
    this.moveAxis(world, axis, amount);
  }

  /** A solid block one step ahead at foot level with two *air* (not water)
   *  blocks above it — i.e. a ledge at the water's edge to climb out onto.
   *  Requiring true air keeps the hop from firing on submerged 1-block bumps. */
  private ledgeAhead(world: World, dirX: number, dirZ: number): boolean {
    const px = this.pos.x + dirX * (HALF_WIDTH + 0.2);
    const pz = this.pos.z + dirZ * (HALF_WIDTH + 0.2);
    const bx = Math.floor(px), bz = Math.floor(pz);
    const fy = Math.floor(this.pos.y + 0.1);
    return (
      isSolid(world.getBlock(bx, fy, bz)) &&
      world.getBlock(bx, fy + 1, bz) === Block.Air &&
      world.getBlock(bx, fy + 2, bz) === Block.Air
    );
  }

  private hasSupport(world: World): boolean {
    const y = Math.floor(this.pos.y - 0.05);
    const x0 = Math.floor(this.pos.x - HALF_WIDTH);
    const x1 = Math.floor(this.pos.x + HALF_WIDTH);
    const z0 = Math.floor(this.pos.z - HALF_WIDTH);
    const z1 = Math.floor(this.pos.z + HALF_WIDTH);
    for (let x = x0; x <= x1; x++)
      for (let z = z0; z <= z1; z++)
        if (isSolid(world.getBlock(x, y, z))) return true;
    return false;
  }

  private moveAxis(world: World, axis: 0 | 1 | 2, amount: number): void {
    if (amount === 0) return;
    const p = this.pos;
    if (axis === 0) p.x += amount;
    else if (axis === 1) p.y += amount;
    else p.z += amount;

    const x0 = Math.floor(p.x - HALF_WIDTH);
    const x1 = Math.floor(p.x + HALF_WIDTH);
    const y0 = Math.floor(p.y);
    const y1 = Math.floor(p.y + HEIGHT);
    const z0 = Math.floor(p.z - HALF_WIDTH);
    const z1 = Math.floor(p.z + HALF_WIDTH);

    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) {
        for (let z = z0; z <= z1; z++) {
          if (!isSolid(world.getBlock(x, y, z))) continue;
          if (axis === 0) {
            p.x = amount > 0 ? x - HALF_WIDTH - EPS : x + 1 + HALF_WIDTH + EPS;
            this.vel.x = 0;
          } else if (axis === 1) {
            if (amount > 0) {
              p.y = y - HEIGHT - EPS;
            } else {
              p.y = y + 1 + EPS;
              this.onGround = true;
            }
            this.vel.y = 0;
          } else {
            p.z = amount > 0 ? z - HALF_WIDTH - EPS : z + 1 + HALF_WIDTH + EPS;
            this.vel.z = 0;
          }
          return; // position clamped; no further blocks can overlap this axis
        }
      }
    }
  }

  /** AABB overlap test used to forbid placing a block inside the player. */
  intersectsBlock(bx: number, by: number, bz: number): boolean {
    return (
      bx + 1 > this.pos.x - HALF_WIDTH && bx < this.pos.x + HALF_WIDTH &&
      by + 1 > this.pos.y && by < this.pos.y + HEIGHT &&
      bz + 1 > this.pos.z - HALF_WIDTH && bz < this.pos.z + HALF_WIDTH
    );
  }
}
