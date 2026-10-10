export interface RayPoint { x: number; y: number; z: number }

/** Forward ray/slab intersection; returns zero when the origin is inside the
 * box, null for a miss. Direction need not be normalized: result is ray t. */
export function rayAabb(origin: RayPoint, dir: RayPoint, min: RayPoint, max: RayPoint): number | null {
  let tmin = 0, tmax = Infinity;
  for (const k of ['x', 'y', 'z'] as const) {
    const d = dir[k];
    if (Math.abs(d) < 1e-9) {
      if (origin[k] < min[k] || origin[k] > max[k]) return null;
      continue;
    }
    let t1 = (min[k] - origin[k]) / d, t2 = (max[k] - origin[k]) / d;
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
    tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
    if (tmin > tmax) return null;
  }
  return tmin;
}
