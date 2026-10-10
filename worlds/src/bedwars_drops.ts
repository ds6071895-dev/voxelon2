// World items. The server spawns, merges and removes them; client and server
// both advance the motion with `stepDrop`, so nothing but those events is sent.
import { pointInSolid, collisionBoxes } from './blocks';

type BwBlockGetter = (x: number, y: number, z: number) => number;
export interface BwDropBody { x: number; y: number; z: number; vx: number; vy: number; vz: number; rest: boolean }

const GRAVITY = 24;
const AIR_DRAG = 0.6;
const BOUNCE = 0.32;

const solidAt = (get: BwBlockGetter, x: number, y: number, z: number): boolean => {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  return pointInSolid(get(ix, iy, iz), x - ix, y - iy, z - iz);
};
/** Height of the highest collision box in a cell (1 for a full block). */
const cellTop = (get: BwBlockGetter, x: number, y: number, z: number): number => {
  let top = 0;
  for (const [, max] of collisionBoxes(get(x, y, z)) ?? []) top = Math.max(top, max[1]);
  return top || 1;
};
const supported = (get: BwBlockGetter, d: BwDropBody): boolean => solidAt(get, d.x, d.y - 0.06, d.z);

/** Advances one drop by `dt`; motion state is stored in the body. */
export function stepDrop(get: BwBlockGetter, d: BwDropBody, dt: number): void {
  if (d.rest) {
    if (supported(get, d)) return;
    d.rest = false; d.vy = 0;
  }
  const steps = Math.max(1, Math.ceil(dt / 0.025)), h = dt / steps;
  for (let i = 0; i < steps; i++) {
    d.vy -= GRAVITY * h;
    const drag = Math.max(0, 1 - AIR_DRAG * h);
    d.vx *= drag; d.vz *= drag;
    const nx = d.x + d.vx * h, nz = d.z + d.vz * h;
    if (!solidAt(get, nx, d.y + 0.1, d.z)) d.x = nx; else d.vx = -d.vx * 0.3;
    if (!solidAt(get, d.x, d.y + 0.1, nz)) d.z = nz; else d.vz = -d.vz * 0.3;
    const ny = d.y + d.vy * h;
    if (d.vy <= 0 && solidAt(get, d.x, ny, d.z)) {
      const cell = Math.floor(ny);
      d.y = cell + cellTop(get, Math.floor(d.x), cell, Math.floor(d.z)) + 0.001;
      if (-d.vy > 3) { d.vy = -d.vy * BOUNCE; d.vx *= 0.7; d.vz *= 0.7; }
      else { d.vy = 0; d.vx = d.vz = 0; d.rest = true; return; }
    } else if (d.vy > 0 && solidAt(get, d.x, ny + 0.2, d.z)) d.vy = 0;
    else d.y = ny;
  }
}
