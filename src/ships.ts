// Player-built SHIPS as rigid captured-block entities (the warfare layer's
// mobile platform). A ship is NOT a second editable voxel world: you build a
// hull from ordinary blocks floating on water, interact the helm, and the hull
// is flood-filled, lifted out of the world, and recorded as a rigid set of
// local offsets that translate/rotate together. This module is PURE and
// transport-agnostic (no DOM, no Node, no THREE) so the authoritative server
// (server_core.ts) and the offline/predicting client share the exact same
// physics — like machines.ts. Combat/upgrades live here too so they stay in
// lockstep across server + client.

import { Block, BLOCKS } from './blocks';
import { Item } from './items';
import { collisionBoxes } from './shapes';
import { SEA_LEVEL } from './terrain';

export const MAX_SHIP_BLOCKS = 400;   // flood-fill cap (reject oversize hulls)
export const MIN_SHIP_BLOCKS = 2;     // helm + at least one hull block
const MAX_OWNER_LEN = 24;

// Physics (water-only, gentle so passenger-carry stays stable).
const BASE_SPEED = 4.5;               // blocks/s at thrust 1, before upgrades
const SPEED_PER_LEVEL = 0.9;
const TURN_RATE = 0.8;                // rad/s at full turn
const ACCEL = 1.8;                    // velocity approach rate
const TURN_ACCEL = 4;

// Health + upgrades.
const BASE_HP = 200;
const HP_PER_HULL_LEVEL = 120;
export const SHIP_MAX_LEVEL = 20;     // per-axis upgrade cap
const COST_GROWTH = 1.25;

export type ShipAxis = 'speed' | 'hull' | 'cannon';

/** One captured block at an integer offset from the helm (the ship origin). */
export interface ShipBlock {
  dx: number; dy: number; dz: number;
  id: number;
}

/** Server-owned ship state (mirrors MachineState's shape + discipline). */
export interface ShipState {
  id: number;
  owner: string;
  /** Owning faction id (teams.ts); friendly fire is off within it. */
  faction: number;
  /** World position of the ship origin (the helm cell centre at launch). */
  x: number; y: number; z: number;
  yaw: number;
  vx: number; vz: number; vyaw: number;
  hp: number; maxHp: number;
  blocks: ShipBlock[];
  level: { speed: number; hull: number; cannon: number };
  /** Per-ship cannon cooldown accumulator (seconds remaining). */
  fireCooldown: number;
}

/** Driver intent, clamped to [-1,1] each. */
export interface ShipSteer { thrust: number; turn: number; }

function clampLevel(n: number): number {
  if (!Number.isFinite(n)) return 1;
  return Math.max(1, Math.min(SHIP_MAX_LEVEL, Math.floor(n)));
}
function clamp01s(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(-1, Math.min(1, n));
}

export function shipMaxHp(level: { hull: number }): number {
  return BASE_HP + HP_PER_HULL_LEVEL * (clampLevel(level.hull) - 1);
}

export function shipSpeed(level: { speed: number }): number {
  return BASE_SPEED + SPEED_PER_LEVEL * (clampLevel(level.speed) - 1);
}

/** Cannon damage per shot scales with the cannon upgrade axis. */
export function shipCannonDamage(level: { cannon: number }): number {
  return 14 + 4 * (clampLevel(level.cannon) - 1);
}

/** Seconds between cannon shots (faster at higher cannon level). */
export function shipFireInterval(level: { cannon: number }): number {
  return Math.max(0.4, 1.4 - 0.05 * (clampLevel(level.cannon) - 1));
}

/** Is a block id a valid, capturable hull block? Excludes air, water,
 *  non-solids, and other block-entities (machines/turrets are not hull). */
export function isHullBlock(id: number): boolean {
  if (id === Block.Air || id === Block.Water) return false;
  if (id === Block.Autominer || id === Block.OilDerrick ||
      id === Block.MachinePart || id === Block.Turret) return false;
  // Containers hold server-side contents keyed by world position; capturing
  // them would orphan that storage, so they can't be part of a hull.
  if (id === Block.Chest || id === Block.Furnace || id === Block.FurnaceLit) return false;
  return BLOCKS[id]?.solid ?? false;
}

/**
 * Flood-fill the connected hull from a helm cell. `capturableAt` returns the
 * (player-placed) block id at a cell, or null/0 if that cell isn't part of a
 * buildable hull there — so the fill is bounded to placed blocks and can never
 * swallow natural terrain. Returns offsets relative to the helm, or null if the
 * helm isn't a helm, the hull is too small, or it exceeds MAX_SHIP_BLOCKS.
 */
export function floodFillHull(
  hx: number, hy: number, hz: number,
  capturableAt: (x: number, y: number, z: number) => number,
): ShipBlock[] | null {
  if (capturableAt(hx, hy, hz) !== Block.ShipHelm) return null;
  const out: ShipBlock[] = [];
  const seen = new Set<string>();
  const queue: [number, number, number][] = [[hx, hy, hz]];
  seen.add(`${hx},${hy},${hz}`);
  const NEIGH = [
    [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1],
  ];
  while (queue.length) {
    const [x, y, z] = queue.shift()!;
    const id = capturableAt(x, y, z);
    if (!isHullBlock(id)) continue;
    out.push({ dx: x - hx, dy: y - hy, dz: z - hz, id });
    if (out.length > MAX_SHIP_BLOCKS) return null; // oversize -> reject
    for (const [ox, oy, oz] of NEIGH) {
      const nx = x + ox, ny = y + oy, nz = z + oz;
      const k = `${nx},${ny},${nz}`;
      if (seen.has(k)) continue;
      seen.add(k);
      if (isHullBlock(capturableAt(nx, ny, nz))) queue.push([nx, ny, nz]);
    }
  }
  if (out.length < MIN_SHIP_BLOCKS) return null;
  return out;
}

/** Max horizontal radius of a hull (for water-clearance sampling). */
export function hullRadius(blocks: ShipBlock[]): number {
  let r = 1;
  for (const b of blocks) r = Math.max(r, Math.abs(b.dx) + 1, Math.abs(b.dz) + 1);
  return r;
}

export function newShip(
  id: number, owner: string, origin: { x: number; y: number; z: number },
  yaw: number, blocks: ShipBlock[], faction = -1,
): ShipState {
  const level = { speed: 1, hull: 1, cannon: 1 };
  const maxHp = shipMaxHp(level);
  return {
    id, owner: owner.slice(0, MAX_OWNER_LEN), faction,
    x: origin.x, y: origin.y, z: origin.z, yaw,
    vx: 0, vz: 0, vyaw: 0,
    hp: maxHp, maxHp, blocks, level, fireCooldown: 0,
  };
}

/** Count the cannon blocks aboard (gates how many barrels can fire). */
export function cannonCount(state: ShipState): number {
  let n = 0;
  for (const b of state.blocks) if (b.id === Block.Cannon) n++;
  return n;
}

/** World-space position of a hull block under the ship's current transform. */
export function blockWorldPos(
  state: ShipState, b: ShipBlock,
): { x: number; y: number; z: number } {
  const c = Math.cos(state.yaw), s = Math.sin(state.yaw);
  // Block centres are spaced 1 apart; the helm (offset 0,0,0) sits at the
  // origin, so the local offset IS the displacement (no +0.5). Rotate about +Y.
  return {
    x: state.x + (b.dx * c - b.dz * s),
    y: state.y + b.dy,
    z: state.z + (b.dx * s + b.dz * c),
  };
}

/** Inverse-rotate a world (x,z) into the ship's local frame (block offsets). */
export function worldToLocalOffset(
  state: ShipState, wx: number, wz: number,
): { lx: number; lz: number } {
  const c = Math.cos(-state.yaw), s = Math.sin(-state.yaw);
  const dx = wx - state.x, dz = wz - state.z;
  return { lx: dx * c - dz * s, lz: dx * s + dz * c };
}

/** Top surface Y of the hull column under a world (x,z), or null if that column
 *  isn't part of the ship. Uses each block's real collision shape, so a slab or
 *  stairs deck stands riders at the actual surface (a bottom slab is half a
 *  block lower than a full block). Block centres sit at integer dy, so a cell's
 *  [0,1]-local box top `mx[1]` maps to a world surface of dy + (mx[1] - 0.5). */
export function deckHeightAt(
  state: ShipState, wx: number, wz: number,
): number | null {
  const { lx, lz } = worldToLocalOffset(state, wx, wz);
  const bx = Math.round(lx), bz = Math.round(lz);
  let surface: number | null = null;
  for (const b of state.blocks) {
    if (b.dx !== bx || b.dz !== bz) continue;
    const boxes = collisionBoxes(b.id);
    if (boxes.length === 0) continue; // non-solid (shouldn't happen for hull)
    let top = 0;
    for (let i = 0; i < boxes.length; i++) top = Math.max(top, boxes[i][1][1]);
    const s = state.y + b.dy + (top - 0.5);
    if (surface === null || s > surface) surface = s;
  }
  return surface;
}

/** The hull block id occupied by a world point, or 0 if none (cannon/gun hit
 *  test against a ship). */
export function blockAtWorld(
  state: ShipState, wx: number, wy: number, wz: number,
): number {
  const { lx, lz } = worldToLocalOffset(state, wx, wz);
  const bx = Math.round(lx), bz = Math.round(lz), by = Math.round(wy - state.y);
  for (const b of state.blocks) {
    if (b.dx === bx && b.dy === by && b.dz === bz) return b.id;
  }
  return 0;
}

/** Apply combat damage; returns true if the ship is now destroyed. */
export function damageShip(state: ShipState, amount: number): boolean {
  if (Number.isFinite(amount) && amount > 0) {
    state.hp = Math.max(0, Math.min(state.maxHp, state.hp) - amount);
  }
  return state.hp <= 0;
}

/**
 * Advance one ship by dt. Water-only: the destination is rejected (movement
 * zeroed) if any sampled point of the hull footprint would sit over land
 * (terrain at/above the waterline). `terrainHeight` is the pure column height.
 */
export function tickShip(
  state: ShipState, steer: ShipSteer, dt: number,
  terrainHeight: (x: number, z: number) => number,
): void {
  if (!Number.isFinite(dt) || dt <= 0) return;
  const thrust = clamp01s(steer.thrust);
  const turn = clamp01s(steer.turn);

  // Approach target angular + linear velocity.
  const targetVyaw = turn * TURN_RATE;
  state.vyaw += (targetVyaw - state.vyaw) * Math.min(1, TURN_ACCEL * dt);
  const speed = shipSpeed(state.level) * thrust;
  // Heading uses the player facing convention (yaw 0 faces -Z).
  const dirX = -Math.sin(state.yaw), dirZ = -Math.cos(state.yaw);
  const targetVx = dirX * speed, targetVz = dirZ * speed;
  state.vx += (targetVx - state.vx) * Math.min(1, ACCEL * dt);
  state.vz += (targetVz - state.vz) * Math.min(1, ACCEL * dt);

  // Integrate yaw freely (rotating in place is always allowed).
  state.yaw += state.vyaw * dt;
  if (state.yaw > Math.PI) state.yaw -= Math.PI * 2;
  if (state.yaw < -Math.PI) state.yaw += Math.PI * 2;

  // Tentative translation, gated on staying over water.
  const nx = state.x + state.vx * dt;
  const nz = state.z + state.vz * dt;
  if (overWater(nx, nz, hullRadius(state.blocks), terrainHeight)) {
    state.x = nx; state.z = nz;
  } else {
    // Shoreline: stop dead so you can't beach or sail inland.
    state.vx = 0; state.vz = 0;
  }
}

/** True if a ring of points at `radius` around (x,z) are all over water. */
function overWater(
  x: number, z: number, radius: number,
  terrainHeight: (x: number, z: number) => number,
): boolean {
  if (terrainHeight(Math.floor(x), Math.floor(z)) >= SEA_LEVEL) return false;
  const N = 8;
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    const px = Math.floor(x + Math.cos(a) * radius);
    const pz = Math.floor(z + Math.sin(a) * radius);
    if (terrainHeight(px, pz) >= SEA_LEVEL) return false;
  }
  return true;
}

/** Resource cost to advance one upgrade axis (null = maxed). Geometric growth;
 *  paid client-side (authoritative-lite) — the server only records + caps. */
export function shipUpgradeCost(
  state: ShipState, axis: ShipAxis,
): Record<number, number> | null {
  const L = state.level[axis];
  if (L >= SHIP_MAX_LEVEL) return null;
  const pow = (n: number) => Math.ceil(n * Math.pow(COST_GROWTH, L - 1));
  if (axis === 'speed') {
    return { [Item.OilBarrel]: pow(6), [Item.IronIngot]: pow(4) };
  }
  if (axis === 'hull') {
    return { [Item.IronIngot]: pow(8), [Item.CobaltIngot]: pow(2) };
  }
  // cannon
  return { [Item.IronIngot]: pow(6), [Item.Cannonball]: pow(4), [Item.CobaltIngot]: pow(1) };
}

/** Bump one axis by a level (server-authoritative; capped). Returns success. */
export function applyShipUpgrade(state: ShipState, axis: ShipAxis): boolean {
  if (axis !== 'speed' && axis !== 'hull' && axis !== 'cannon') return false;
  if (state.level[axis] >= SHIP_MAX_LEVEL) return false;
  state.level[axis] += 1;
  if (axis === 'hull') {
    const newMax = shipMaxHp(state.level);
    state.hp += (newMax - state.maxHp); // repair the gained capacity
    state.maxHp = newMax;
  }
  return true;
}

/** Normalize/validate a ship arriving over the wire (defensive, fail-closed). */
export function sanitizeShipState(raw: unknown): ShipState | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (!Number.isFinite(r.id) || !Number.isFinite(r.x) ||
      !Number.isFinite(r.y) || !Number.isFinite(r.z) ||
      !Number.isFinite(r.yaw)) return null;
  if (!Array.isArray(r.blocks)) return null;
  const blocks: ShipBlock[] = [];
  for (const b of r.blocks as unknown[]) {
    if (!b || typeof b !== 'object') continue;
    const bb = b as Record<string, unknown>;
    const dx = Number(bb.dx), dy = Number(bb.dy), dz = Number(bb.dz), id = Number(bb.id);
    if (!Number.isFinite(dx) || !Number.isFinite(dy) || !Number.isFinite(dz)) continue;
    if (!BLOCKS[id]) continue;
    blocks.push({ dx: Math.round(dx), dy: Math.round(dy), dz: Math.round(dz), id });
    if (blocks.length > MAX_SHIP_BLOCKS) break;
  }
  if (blocks.length < MIN_SHIP_BLOCKS) return null;
  const lv = (r.level ?? {}) as Record<string, unknown>;
  const level = {
    speed: clampLevel(Number(lv.speed)),
    hull: clampLevel(Number(lv.hull)),
    cannon: clampLevel(Number(lv.cannon)),
  };
  const maxHp = shipMaxHp(level);
  const hp = Number.isFinite(r.hp)
    ? Math.max(0, Math.min(maxHp, Math.floor(Number(r.hp)))) : maxHp;
  return {
    id: Math.floor(Number(r.id)),
    owner: typeof r.owner === 'string' ? r.owner.slice(0, MAX_OWNER_LEN) : '',
    faction: Number.isFinite(r.faction) ? Math.floor(Number(r.faction)) : -1,
    x: Number(r.x), y: Number(r.y), z: Number(r.z), yaw: Number(r.yaw),
    vx: Number.isFinite(r.vx) ? Number(r.vx) : 0,
    vz: Number.isFinite(r.vz) ? Number(r.vz) : 0,
    vyaw: Number.isFinite(r.vyaw) ? Number(r.vyaw) : 0,
    hp, maxHp, blocks, level, fireCooldown: 0,
  };
}

/**
 * Offline / client-side manager: one ShipState per id. Offline this is the
 * authority; in multiplayer the client uses it to predict the piloted ship and
 * to interpolate other ships toward their last server transform.
 */
export class Ships {
  private readonly states = new Map<number, ShipState>();

  get(id: number): ShipState | undefined { return this.states.get(id); }
  set(state: ShipState): void { this.states.set(state.id, state); }
  remove(id: number): ShipState | undefined {
    const s = this.states.get(id);
    this.states.delete(id);
    return s;
  }
  list(): ShipState[] { return [...this.states.values()]; }
  clear(): void { this.states.clear(); }

  /** The ship whose helm-origin/footprint a world point sits within (for
   *  "am I standing on a ship?" and "which ship's helm am I at?"). */
  shipAtOrigin(x: number, y: number, z: number, tol = 1.5): ShipState | undefined {
    for (const s of this.states.values()) {
      if (Math.abs(s.x - x) <= tol && Math.abs(s.z - z) <= tol &&
          Math.abs(s.y - y) <= 3) return s;
    }
    return undefined;
  }
}
