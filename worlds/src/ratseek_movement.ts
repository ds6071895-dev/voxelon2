// Server movement checks use collision shapes, independently of sight and nav support.
import { collisionBoxes } from './blocks';
import type { RsPos } from './ratseek_house';

type Sample = (x: number, y: number, z: number) => number;
const EPS = 1e-5;

/** Continuous feet segment against a voxel box expanded by the body's extents. */
function intersects(a: RsPos, b: RsPos, min: number[], max: number[]): boolean {
  let lo = 0, hi = 1;
  const start = [a.x, a.y, a.z], end = [b.x, b.y, b.z];
  for (let axis = 0; axis < 3; axis++) {
    const d = end[axis] - start[axis];
    if (Math.abs(d) < EPS) {
      if (start[axis] <= min[axis] || start[axis] >= max[axis]) return false;
    } else {
      let enter = (min[axis] - start[axis]) / d, exit = (max[axis] - start[axis]) / d;
      if (enter > exit) [enter, exit] = [exit, enter];
      lo = Math.max(lo, enter); hi = Math.min(hi, exit);
      if (lo >= hi) return false;
    }
  }
  return lo < hi;
}

/** Sweep rather than endpoint samples: even a narrow prop cannot be skipped. */
export function rsSweepClear(a: RsPos, b: RsPos, halfWidth: number, height: number, sample: Sample): boolean {
  const slices = Math.max(1, Math.ceil(Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y), Math.abs(b.z - a.z)) / 0.5));
  // Malformed reports must not turn into unbounded voxel work.
  if (!Number.isFinite(slices) || slices > 1024) return false;
  let from = a;
  for (let s = 1; s <= slices; s++) {
    const t = s / slices, to = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t };
    for (let x = Math.floor(Math.min(from.x, to.x) - halfWidth); x <= Math.floor(Math.max(from.x, to.x) + halfWidth); x++) {
      for (let y = Math.floor(Math.min(from.y, to.y)); y <= Math.floor(Math.max(from.y, to.y) + height); y++) {
        for (let z = Math.floor(Math.min(from.z, to.z) - halfWidth); z <= Math.floor(Math.max(from.z, to.z) + halfWidth); z++) {
          for (const box of collisionBoxes(sample(x, y, z)) ?? []) {
            if (intersects(from, to,
              [x + box[0][0] - halfWidth + EPS, y + box[0][1] - height + EPS, z + box[0][2] - halfWidth + EPS],
              [x + box[1][0] + halfWidth - EPS, y + box[1][1] - EPS, z + box[1][2] + halfWidth - EPS])) return false;
          }
        }
      }
    }
    from = to;
  }
  return true;
}

/** Reported motion may combine a vertical jump/auto-step and horizontal motion.
 * Only the reported elevation is used; a flat dash never invents a hop over a wall. */
export function rsMoveClear(a: RsPos, b: RsPos, scale: number, sample: Sample): boolean {
  const w = 0.3 * scale * 0.85, h = 1.8 * scale * 0.9;
  const clear = (from: RsPos, to: RsPos): boolean => rsSweepClear(from, to, w, h, sample);
  // Player resolves horizontal axes independently. Multiple physics frames in
  // one transform can slide along one wall, then turn its corner; their chord
  // crosses the corner even though every constituent move is collision-free.
  const levelClear = (from: RsPos, to: RsPos): boolean => {
    if (clear(from, to)) return true;
    for (const corner of [{ x: from.x, y: from.y, z: to.z }, { x: to.x, y: from.y, z: from.z }]) {
      if (clear(from, corner) && clear(corner, to)) return true;
    }
    return false;
  };
  if (clear(a, b)) return true;
  if (Math.abs(b.y - a.y) <= EPS) return levelClear(a, b);
  if (b.y > a.y + EPS) {
    const lifted = { x: a.x, y: b.y, z: a.z };
    return clear(a, lifted) && levelClear(lifted, b);
  }
  if (b.y < a.y - EPS) {
    const edge = { x: b.x, y: a.y, z: b.z };
    return levelClear(a, edge) && clear(edge, b);
  }
  return false;
}
