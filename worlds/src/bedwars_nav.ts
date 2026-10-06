import { isSolid, pointInSolid } from './blocks';
import type { BwPos } from './bedwars_rules';

type BwBlockReader = (x: number, y: number, z: number) => number;
export function bwDistance(a: BwPos, b: BwPos): number { return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z); }
/** Packed integer key for a cell (x, z within +-128, y 0-511). */
export function bwKey(x: number, y: number, z: number): number { return ((x + 128) * 512 + y) * 512 + (z + 128); }
/** Includes the endpoint unless its cell is explicitly being targeted. */
export function bwLine(get: BwBlockReader, a: BwPos, b: BwPos, ignore?: BwPos): boolean {
  const steps = Math.ceil(bwDistance(a, b) * 12);
  for (let i = 1; i <= steps; i++) {
    const t = i / steps, x = a.x + (b.x - a.x) * t, y = a.y + (b.y - a.y) * t, z = a.z + (b.z - a.z) * t;
    const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
    if (ignore && ix === ignore.x && iy === ignore.y && iz === ignore.z) continue;
    if (pointInSolid(get(ix, iy, iz), x - ix, y - iy, z - iz)) return false;
  }
  return true;
}
/** Feet resting on something solid (a 0.6-wide body at `p`). */
export function bwOnGround(get: BwBlockReader, p: BwPos): boolean {
  for (const dx of [-0.29, 0.29]) for (const dz of [-0.29, 0.29]) {
    const x = p.x + dx, y = p.y - 0.06, z = p.z + dz;
    if (pointInSolid(get(Math.floor(x), Math.floor(y), Math.floor(z)), x - Math.floor(x), y - Math.floor(y), z - Math.floor(z))) return true;
  }
  return false;
}
export function bwFits(get: BwBlockReader, p: BwPos): boolean {
  for (const dx of [-0.29, 0.29]) for (const dz of [-0.29, 0.29]) for (const dy of [0.01, 0.9, 1.79]) {
    const x = p.x + dx, y = p.y + dy, z = p.z + dz;
    if (pointInSolid(get(Math.floor(x), Math.floor(y), Math.floor(z)), x - Math.floor(x), y - Math.floor(y), z - Math.floor(z))) return false;
  }
  return true;
}

/** Four-connected A*: missing floor costs wool (and is impassable without
 * any), walls may only be mined when player-authored. The bot still executes
 * every placement/break via actions. */
export function bwPath(get: BwBlockReader, from: BwPos, to: BwPos, canBreak: (x: number, y: number, z: number) => boolean, avoid?: (x: number, z: number) => boolean, bridge = true): BwPos[] {
  const y = 97, sx = Math.floor(from.x), sz = Math.floor(from.z);
  const key = (x: number, z: number) => `${x},${z}`;
  interface Node { x: number; z: number; g: number; f: number; parent?: Node }
  const h = (x: number, z: number) => Math.abs(x + 0.5 - to.x) + Math.abs(z + 0.5 - to.z);
  const start: Node = { x: sx, z: sz, g: 0, f: h(sx, sz) };
  const open: Node[] = [start], costs = new Map<string, number>([[key(sx, sz), 0]]);
  let best = start;
  for (let visited = 0; open.length && visited < 16000; visited++) {
    // Binary heap pop.
    const n = open[0], tail = open.pop()!;
    if (open.length) {
      open[0] = tail;
      let i = 0;
      while (true) {
        let c = i * 2 + 1;
        if (c >= open.length) break;
        if (c + 1 < open.length && open[c + 1].f < open[c].f) c++;
        if (open[i].f <= open[c].f) break;
        [open[i], open[c]] = [open[c], open[i]]; i = c;
      }
    }
    if (n.g !== costs.get(key(n.x, n.z))) continue;
    if (h(n.x, n.z) < h(best.x, best.z)) best = n;
    if (Math.hypot(n.x + 0.5 - to.x, n.z + 0.5 - to.z) <= 1.2) { best = n; break; }
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const x = n.x + dx, z = n.z + dz;
      if (x < -90 || x >= 90 || z < -63 || z >= 63 || avoid?.(x, z)) continue;
      let wall = 0, blocked = false;
      for (const yy of [y, y + 1]) if (isSolid(get(x, yy, z))) {
        if (!canBreak(x, yy, z)) { blocked = true; break; }
        wall += 5;
      }
      if (blocked) continue;
      const floor = isSolid(get(x, y - 1, z));
      if (!floor && !bridge) continue;
      const g = n.g + 1 + wall + (floor ? 0 : 1.8);
      if (g >= (costs.get(key(x, z)) ?? Infinity)) continue;
      costs.set(key(x, z), g);
      const next: Node = { x, z, g, f: g + h(x, z), parent: n };
      open.push(next);
      let i = open.length - 1;
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (open[p].f <= open[i].f) break;
        [open[p], open[i]] = [open[i], open[p]]; i = p;
      }
    }
  }
  const path: BwPos[] = [];
  while (best.parent) { path.push({ x: best.x + 0.5, y, z: best.z + 0.5 }); best = best.parent; }
  return path.reverse();
}
