// Player physics tuned to vanilla Minecraft's documented constants:
// walk 4.317 m/s, sprint 5.612 m/s, sneak 1.295 m/s, jump apex 1.25 blocks,
// gravity 32 m/s^2, collision box 0.6 x 1.8, eye height 1.62 (1.27 sneaking).

import * as THREE from 'three';
import { Block, isSolid } from './blocks';
import type { PlayerInput } from './input';
import { mitigate } from './net/protocol';
import { collisionBoxes, FULL_BOX } from './shapes';
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
// Vanilla-style auto-step: walk straight up obstacles whose top is within this
// height (slabs, single stairs) when there's headroom, without jumping.
const STEP_HEIGHT = 0.6;
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
// Admin/gamemode flight (creative + spectator).
const FLY_SPEED_MULT = 2.4;   // horizontal speed multiplier while flying
const FLY_V_SPEED = 9;        // vertical rise/descend speed (blocks/s)
// Glider (chestplate-slot wings): a fast, forgiving directional descent. The
// look direction steers; diving trades altitude for speed, leveling out cruises
// fast with a small constant sink ("fun and easy" transport from high places).
const GLIDE_BASE_SPEED = 13;   // cruise speed looking level (≈3× walking)
const GLIDE_DIVE_GAIN = 16;    // extra speed gained nose-down
const GLIDE_MIN_SPEED = 6;
const GLIDE_MAX_SPEED = 32;
const GLIDE_SINK = 2.2;        // baseline downward drift (blocks/s)
const GLIDE_MIN_CLEARANCE = 3; // air blocks below required to deploy
// Boat: fast, drifty travel over water. W rows toward where you look, S back-
// paddles; buoyancy bobs the hull at the surface (mounted/dismounted by main).
const BOAT_SPEED = 11;         // ~2.5× walking
const BOAT_REVERSE = 0.35;     // back-paddle fraction of full speed
const BOAT_ACCEL = 2.5;        // low accel = a drifty, boaty feel

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
  // Survival stats: hearts-driven max HP (lifesteal: 2 HP per heart, start
  // 10 hearts = 20 HP), plus a 0..1 energy bar that gates sprinting.
  health = 20;
  /** Max HP = hearts * 2; main keeps it in sync with the hearts count. */
  maxHealth = 20;
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
  /** Flat post-percentage damage soak from Greater Runes of Iron (same
   *  sync/authority split as `armorPoints`). */
  toughness = 0;
  /** Admin/gamemode flight: no gravity, jump/sneak rise/descend (creative+spectator). */
  flying = false;
  /** Admin/gamemode noclip: move through blocks, ignore collision (spectator). */
  noclip = false;
  /** Trap grip: a Bear Trap pins you outright, Tar/Barbed Wire drag you down.
   *  main.ts writes these each frame from the block you're standing in. */
  pinned = false;      // Bear Trap: no movement at all until you break free
  trapSlow = 1;        // Tar/Barbed Wire speed multiplier (1 = free)
  trapNoJump = false;  // Tar/Bear Trap: you cannot jump out of it
  /** Mouse-look sensitivity multiplier (1 = normal). Lowered while a gun is
   *  scoped (aim-down-sights) so high-zoom aiming is steady. */
  lookScale = 1;
  /** Progression speed multiplier (skill tree + faction perk). */
  speedMult = 1;
  /** Sprint energy-drain multiplier (<1 = Windrunner capstones). */
  energyDrainMult = 1;
  /** Fall-damage multiplier (<1 = Juggernaut capstones). */
  fallDamageMult = 1;
  /** A glider is worn in the chestplate slot (set by main from the inventory). */
  gliderEquipped = false;
  /** Currently gliding (wings deployed). */
  gliding = false;
  /** Riding a boat (mounted/dismounted by main; drives water-surface physics). */
  boating = false;
  private prevJump = false;
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
    const dealt = mitigate(amount, this.armorPoints, this.toughness);
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
    this.health = this.maxHealth;
    this.energy = 1;
    this.exhausted = false;
    this.air = MAX_AIR;
    this.fallDistance = 0;
    this.regenCooldown = 0;
    this.hurtTimer = 0;
    this.damageFlash = 0;
    this.dead = false;
    this.gliding = false;
    this.boating = false;
    this.prevJump = false;
  }

  get eyePosition(): THREE.Vector3 {
    return new THREE.Vector3(this.pos.x, this.pos.y + this.eye, this.pos.z);
  }

  update(dt: number, input: PlayerInput, world: World): void {
    if (this.dead) return;
    this.hurtTimer = Math.max(0, this.hurtTimer - dt);
    this.damageFlash = Math.max(0, this.damageFlash - dt);
    // regenCooldown is ticked by Survival.update (runs while paused/inventory).

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

    // Water state (feet column and eye block).
    const feetBlock = world.getBlock(
      Math.floor(this.pos.x), Math.floor(this.pos.y + 0.4), Math.floor(this.pos.z)
    );
    this.inWater = feetBlock === Block.Water;
    const eyeP = this.eyePosition;
    this.eyeUnderwater =
      world.getBlock(Math.floor(eyeP.x), Math.floor(eyeP.y), Math.floor(eyeP.z)) ===
      Block.Water;

    // Glider: jump in mid-air (with clearance below) to deploy; jump again, or
    // touch ground/water, to stow. Rising-edge on jump so a held Space doesn't
    // immediately re-toggle.
    const jumpEdge = input.jump && !this.prevJump;
    this.prevJump = input.jump;
    if (this.boating) this.gliding = false;
    if (this.gliding) {
      if (this.onGround || this.inWater || this.flying ||
          !this.gliderEquipped || jumpEdge) {
        this.gliding = false;
      }
    } else if (jumpEdge && this.gliderEquipped && !this.boating && !this.onGround &&
        !this.inWater && !this.flying &&
        this.groundClearance(world) > GLIDE_MIN_CLEARANCE) {
      this.gliding = true;
    }

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

    if (this.boating && !this.flying) {
      // In a boat: W rows toward where you look, buoyancy pins the hull to the
      // water surface (collisions still resolve at integration).
      this.sprinting = false;
      this.applyBoat(dt, input, world);
    } else if (this.gliding) {
      // Wings deployed: the look direction sets the whole velocity (collisions
      // still resolve at integration). WASD is ignored — you fly where you aim.
      this.applyGlide();
    } else {
      let speed = (this.sneaking ? SNEAK_SPEED
        : this.sprinting ? SPRINT_SPEED
        : WALK_SPEED) * this.speedMult * this.trapSlow;
      // Caught in a Bear Trap: the jaws hold you exactly where you stand.
      if (this.pinned) speed = 0;
      if (this.inWater) speed *= 0.45;
      // Swamp mud drags the feet (slight, kid-gentle slowdown).
      if (!this.flying && this.onGround && world.getBlock(
        Math.floor(this.pos.x), Math.floor(this.pos.y - 0.05), Math.floor(this.pos.z)
      ) === Block.Mud) speed *= 0.72;
      if (this.flying) speed = (this.sprinting ? SPRINT_SPEED : WALK_SPEED) * FLY_SPEED_MULT;

      // Approach target velocity; much weaker control while airborne (but full
      // authority while flying).
      const accel = this.flying || this.onGround || this.inWater ? 14 : 3;
      const t = Math.min(1, accel * dt);
      this.vel.x += (dirX * speed - this.vel.x) * t;
      this.vel.z += (dirZ * speed - this.vel.z) * t;

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
        // Tar and bear-trap jaws hold your feet: no jumping out of them.
        if (input.jump && this.onGround && !this.trapNoJump) {
          this.vel.y = JUMP_VELOCITY;
          this.onGround = false;
        }
        this.vel.y -= GRAVITY * dt;
        if (this.vel.y < -TERMINAL_VELOCITY) this.vel.y = -TERMINAL_VELOCITY;
      }
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
      const wasOnGround = this.onGround;
      this.onGround = false;
      this.moveAxis(world, 1, this.vel.y * dt);
      this.moveAxisSneakAware(world, 0, this.vel.x * dt, wasOnGround);
      this.moveAxisSneakAware(world, 2, this.vel.z * dt, wasOnGround);

      // Landing: vanilla fall damage = blocks fallen minus 3 (skill-tree
      // capstones shave a fraction off).
      if (this.onGround && this.fallDistance > 0) {
        const dmg = Math.ceil(Math.max(0, this.fallDistance - 3.2) * this.fallDamageMult);
        if (dmg > 0) this.damage(dmg);
        this.fallDistance = 0;
      }
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

  /** Boat physics: a drifty rowed throttle along the look yaw + buoyancy that
   *  bobs the hull at the water surface (mild gravity when it leaves water, so
   *  waterfalls and beachings feel right). */
  private applyBoat(dt: number, input: PlayerInput, world: World): void {
    let throttle = 0;
    if (input.forward) throttle = 1;
    else if (input.back) throttle = -BOAT_REVERSE;
    const speed = BOAT_SPEED * this.speedMult * throttle;
    const tx = -Math.sin(this.yaw) * speed;
    const tz = -Math.cos(this.yaw) * speed;
    const t = Math.min(1, BOAT_ACCEL * dt);
    this.vel.x += (tx - this.vel.x) * t;
    this.vel.z += (tz - this.vel.z) * t;
    // Buoyancy: push up while the hull sits in water, mild gravity otherwise;
    // heavy damping keeps the bob small — the boat rides right at the surface.
    const hull = world.getBlock(
      Math.floor(this.pos.x), Math.floor(this.pos.y + 0.1), Math.floor(this.pos.z));
    if (hull === Block.Water) this.vel.y += 26 * dt;
    else this.vel.y -= GRAVITY * 0.6 * dt;
    this.vel.y *= 1 - Math.min(1, 7 * dt);
    this.vel.y = Math.max(-8, Math.min(2.6, this.vel.y));
    this.fallDistance = 0; // a boat never takes fall damage
  }

  /** Glider velocity from the look direction: dive to go fast, level out to
   *  cruise with a gentle sink. Sets vel directly (integration still collides). */
  private applyGlide(): void {
    const cosP = Math.cos(this.pitch), sinP = Math.sin(this.pitch);
    const fx = -Math.sin(this.yaw) * cosP;
    const fy = sinP;                       // <0 looking down, >0 looking up
    const fz = -Math.cos(this.yaw) * cosP;
    const dive = -fy;                      // +1 nose straight down
    const speed = Math.max(GLIDE_MIN_SPEED,
      Math.min(GLIDE_MAX_SPEED, GLIDE_BASE_SPEED + dive * GLIDE_DIVE_GAIN));
    this.vel.x = fx * speed;
    this.vel.z = fz * speed;
    this.vel.y = fy * speed * 0.7 - GLIDE_SINK;
    this.fallDistance = 0; // gliding lands softly (no fall damage)
  }

  /** Distance (in blocks) to the first solid block straight below the feet,
   *  capped at 96. Used to require real clearance before deploying the glider. */
  private groundClearance(world: World): number {
    const x = Math.floor(this.pos.x), z = Math.floor(this.pos.z);
    const fy = Math.floor(this.pos.y);
    for (let d = 1; d <= 96; d++) {
      if (isSolid(world.getBlock(x, fy - d, z))) return d;
    }
    return 96;
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

    const minX = p.x - HALF_WIDTH, maxX = p.x + HALF_WIDTH;
    const minY = p.y, maxY = p.y + HEIGHT;
    const minZ = p.z - HALF_WIDTH, maxZ = p.z + HALF_WIDTH;
    const x0 = Math.floor(minX), x1 = Math.floor(maxX);
    const y0 = Math.floor(minY), y1 = Math.floor(maxY);
    const z0 = Math.floor(minZ), z1 = Math.floor(maxZ);

    let best: number | null = null; // resolved coordinate along `axis`
    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) {
        for (let z = z0; z <= z1; z++) {
          const boxes = collisionBoxes(world.getBlock(x, y, z));
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
            if (axis === 0) c = amount > 0 ? bx0 - HALF_WIDTH - EPS : bx1 + HALF_WIDTH + EPS;
            else if (axis === 1) c = amount > 0 ? by0 - HEIGHT - EPS : by1 + EPS;
            else c = amount > 0 ? bz0 - HALF_WIDTH - EPS : bz1 + HALF_WIDTH + EPS;
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

  /** AABB overlap test used to forbid placing a block inside the player. With an
   *  `id` it tests that block's real shape (so a slab clear of the body is OK);
   *  without one it falls back to a full cube (machine footprint / torch checks). */
  intersectsBlock(bx: number, by: number, bz: number, id?: number): boolean {
    const boxes = id === undefined ? [FULL_BOX] : collisionBoxes(id);
    for (let i = 0; i < boxes.length; i++) {
      const [mn, mx] = boxes[i];
      if (
        bx + mx[0] > this.pos.x - HALF_WIDTH && bx + mn[0] < this.pos.x + HALF_WIDTH &&
        by + mx[1] > this.pos.y && by + mn[1] < this.pos.y + HEIGHT &&
        bz + mx[2] > this.pos.z - HALF_WIDTH && bz + mn[2] < this.pos.z + HALF_WIDTH
      ) return true;
    }
    return false;
  }
}
