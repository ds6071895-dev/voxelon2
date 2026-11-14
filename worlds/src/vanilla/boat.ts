// Boats: vanilla's per-tick boat controls, momentum and buoyancy, shared by
// the rider's client (which predicts its own boat) and the server (which
// floats boats nobody is in). One step = one Minecraft tick.
//
// Controls (Boat.controlBoat): left/right add ∓1°/tick of turn, forward adds
// 0.04 thrust, back 0.005 reverse, turning in place 0.005. Momentum per tick:
// 0.9 on water and in air; on land, the block's slipperiness (default 0.6,
// ice and packed ice 0.98, blue ice 0.989).

import { BLOCKS } from '../blocks';
import { VMETA } from './blocks';

type BlockAt = (x: number, y: number, z: number) => number;

export const BOAT = {
  W: 1.375, H: .5625,
  THRUST: .04, REVERSE: .005, TURN_THRUST: .005, TURN: 1 * Math.PI / 180,
  WATER_MOMENTUM: .9, AIR_MOMENTUM: .9, GRAVITY: .04,
  /** How deep the hull sits below the surface when floating. */
  DRAFT: .2,
} as const;

/** How far a rider's body sits below standing height, hips on the bench. */
export const SEAT_DROP = 0.42;

/** Top surface of a water column at (x, z) around height y, or null when the
 *  hull isn't touching water. */
export function waterSurface(get: BlockAt, x: number, y: number, z: number): number | null {
  const bx = Math.floor(x), bz = Math.floor(z);
  let by = Math.floor(y + .3);
  let f = BLOCKS[get(bx, by, bz)]?.fluid;
  if (f?.kind !== 'water') { by = Math.floor(y - .05); f = BLOCKS[get(bx, by, bz)]?.fluid; if (f?.kind !== 'water') return null; }
  for (let i = 0; i < 16; i++) {
    const up = BLOCKS[get(bx, by + 1, bz)]?.fluid;
    if (up?.kind !== 'water') break;
    by++; f = up;
  }
  const level = f!.level & 7;
  return by + (level === 0 ? 8 / 9 : (8 - level) / 9);
}

/** Vanilla block slipperiness under a hull. */
export function slipperiness(get: BlockAt, x: number, y: number, z: number): number {
  let best = 0, any = false;
  for (const [ox, oz] of [[-.6, -.6], [.6, -.6], [-.6, .6], [.6, .6], [0, 0]]) {
    const id = get(Math.floor(x + ox), Math.floor(y - .05), Math.floor(z + oz));
    if (!BLOCKS[id]?.solid) continue;
    any = true;
    const m = VMETA[id]?.move;
    best = Math.max(best, m === 'blueIce' ? .989 : m === 'ice' || m === 'packedIce' ? .98 : .6);
  }
  return any ? best : 0;
}

export interface BoatBody { x: number; y: number; z: number; vx: number; vy: number; vz: number; yaw: number; spin: number }
export interface BoatControls { forward: boolean; back: boolean; left: boolean; right: boolean }
export const NO_CONTROLS: BoatControls = { forward: false, back: false, left: false, right: false };

/**
 * One tick of boat physics. Velocities are blocks/tick; `yaw` is Worlds'
 * (forward is −z, positive turns left). Returns the displacement to apply
 * with the caller's collision routine.
 */
export function stepBoat(b: BoatBody, c: BoatControls, get: BlockAt): { dx: number; dy: number; dz: number; status: 'water' | 'land' | 'air' } {
  const surface = waterSurface(get, b.x, b.y, b.z);
  const slip = surface === null ? slipperiness(get, b.x, b.y, b.z) : 0;
  const status = surface !== null ? 'water' : slip > 0 ? 'land' : 'air';
  const momentum = status === 'water' ? BOAT.WATER_MOMENTUM : status === 'land' ? slip : BOAT.AIR_MOMENTUM;

  // Momentum first (Boat.floatBoat), then the paddles (controlBoat).
  b.vx *= momentum; b.vz *= momentum; b.spin *= momentum;
  if (surface !== null) {
    // Float: rise toward the surface minus the draft, damped.
    const want = surface - BOAT.DRAFT;
    const depth = want - b.y;
    b.vy = b.vy * .65 + Math.max(-.08, Math.min(.12, depth * .35));
    if (Math.abs(depth) < .01 && Math.abs(b.vy) < .01) b.vy = 0;
  } else {
    b.vy = (b.vy - BOAT.GRAVITY) * .98;
  }
  let thrust = 0;
  if (c.left) b.spin += BOAT.TURN;
  if (c.right) b.spin -= BOAT.TURN;
  if (c.right !== c.left && !c.forward && !c.back) thrust += BOAT.TURN_THRUST;
  if (c.forward) thrust += BOAT.THRUST;
  if (c.back) thrust -= BOAT.REVERSE;
  b.yaw += b.spin;
  b.vx += -Math.sin(b.yaw) * thrust;
  b.vz += -Math.cos(b.yaw) * thrust;
  return { dx: b.vx, dy: b.vy, dz: b.vz, status };
}

/** Top speed in blocks/second the server tolerates for a rider on this ground. */
export function boatSpeedCap(get: BlockAt, x: number, y: number, z: number): number {
  const slip = slipperiness(get, x, y, z);
  // Terminal speed = thrust / (1 − momentum), in blocks/tick, ×20, plus slack.
  const m = slip >= .989 ? .989 : slip >= .98 ? .98 : BOAT.WATER_MOMENTUM;
  return (BOAT.THRUST / (1 - m)) * 20 * 1.25 + 2;
}
