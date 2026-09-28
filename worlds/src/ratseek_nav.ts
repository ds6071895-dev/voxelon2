// Rat and Seek navigation over the manor blueprint (a port of the plugin's
// RatSeekNav). A cell is where feet stand: floor below, and room above for
// the body. The seeker grid needs two free blocks (a person), the small grid
// one (Mr. Whiskers). Seekers climb stairs, hop up one block like a player
// and drop off ledges up to three high. Built once per process: the
// blueprint never changes.

import { Block } from './blocks';
import { RS_RELEASE, rsHouse, type RsPos } from './ratseek_house';

export const NAV_MIN_X = -25, NAV_MAX_X = 34, NAV_MIN_Y = 74, NAV_MAX_Y = 100, NAV_MIN_Z = -21, NAV_MAX_Z = 34;
const SX = NAV_MAX_X - NAV_MIN_X + 1, SY = NAV_MAX_Y - NAV_MIN_Y + 1, SZ = NAV_MAX_Z - NAV_MIN_Z + 1;
const CELLS = SX * SY * SZ;
const STEPS: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
const MAX_EXPANSIONS = 9000;
const MAX_DROP = 3;
/** A seeker's attack reach from the eye. */
const TAG_REACH = 3.0;

export interface NavSpot { name: string; hide: RsPos; from: RsPos; low: boolean }
export interface NavRoom { name: string; centre: RsPos; spots: NavSpot[] }

function at(x: number, y: number, z: number): number { return rsHouse().at(x, y, z); }

/** Can a body stand inside a block of this kind? */
export function navPassable(b: number): boolean {
  return b === Block.Air || b === Block.ManorLeverOff || b === Block.ManorLeverOn || b === Block.ManorMousetrap;
}
function isStair(b: number): boolean { return b === Block.ManorStairN || b === Block.ManorStairS; }
function navFloor(b: number): boolean {
  return !navPassable(b) && b !== Block.ManorCageBars && b !== Block.ManorGardenPost && b !== Block.ManorLantern &&
    b !== Block.ManorFlowerPot && b !== Block.ManorGlass && b !== Block.Barrier;
}
/** Rays pass these (bars, lanterns, pots, levers, plates). */
export function seeThrough(b: number): boolean {
  return navPassable(b) || b === Block.ManorCageBars || b === Block.ManorLantern || b === Block.ManorFlowerPot;
}

export function navInside(x: number, y: number, z: number): boolean {
  return x >= NAV_MIN_X && x <= NAV_MAX_X && y >= NAV_MIN_Y && y <= NAV_MAX_Y && z >= NAV_MIN_Z && z <= NAV_MAX_Z;
}
function index(x: number, y: number, z: number): number {
  return ((y - NAV_MIN_Y) * SZ + (z - NAV_MIN_Z)) * SX + (x - NAV_MIN_X);
}
function xOf(i: number): number { return i % SX + NAV_MIN_X; }
function zOf(i: number): number { return Math.floor(i / SX) % SZ + NAV_MIN_Z; }
function yOf(i: number): number { return Math.floor(i / (SX * SZ)) + NAV_MIN_Y; }

export class RsNav {
  private readonly walk = new Uint8Array(CELLS);
  private readonly stairs = new Uint8Array(CELLS);
  private readonly headroom = new Uint8Array(CELLS);
  private readonly wallside = new Uint8Array(CELLS);
  readonly rooms: NavRoom[] = [];
  private readonly perchCache = new Map<number, boolean>();
  // A* scratch, reused through a generation stamp.
  private readonly cost = new Float32Array(CELLS);
  private readonly parent = new Int32Array(CELLS);
  private readonly stamp = new Uint32Array(CELLS);
  private readonly closed = new Uint32Array(CELLS);
  private generation = 0;
  private heapNode = new Int32Array(1024);
  private heapKey = new Float32Array(1024);
  private heapSize = 0;

  /** `height` is 2 for a person, 1 for the cat. */
  constructor(readonly height: 1 | 2, start: RsPos) {
    const candidate = new Uint8Array(CELLS);
    for (let y = NAV_MIN_Y + 1; y < NAV_MAX_Y; y++) {
      for (let z = NAV_MIN_Z; z <= NAV_MAX_Z; z++) {
        for (let x = NAV_MIN_X; x <= NAV_MAX_X; x++) {
          const below = at(x, y - 1, z);
          const i = index(x, y, z);
          if (y + height <= NAV_MAX_Y && navPassable(at(x, y + height, z))) this.headroom[i] = 1;
          if (navFloor(below) && navPassable(at(x, y, z)) && (height === 1 || navPassable(at(x, y + 1, z)))) {
            candidate[i] = 1;
            if (isStair(below)) this.stairs[i] = 1;
          }
        }
      }
    }
    // Keep only what a body released at `start` can walk to.
    const queue: number[] = [];
    const first = index(start.x, start.y, start.z);
    if (candidate[first]) { this.walk[first] = 1; queue.push(first); }
    for (let head = 0; head < queue.length; head++) {
      const from = queue[head];
      const fx = xOf(from), fy = yOf(from), fz = zOf(from);
      for (const [sx, sz] of STEPS) {
        for (let dy = -MAX_DROP; dy <= 1; dy++) {
          const tx = fx + sx, ty = fy + dy, tz = fz + sz;
          if (!navInside(tx, ty, tz)) continue;
          const ti = index(tx, ty, tz);
          if (!candidate[ti] || this.walk[ti]) continue;
          if (!this.moveAllowed(candidate, fx, fy, fz, tx, ty, tz)) continue;
          this.walk[ti] = 1;
          queue.push(ti);
        }
      }
    }
    for (let i = 0; i < CELLS; i++) {
      if (!this.walk[i]) continue;
      const x = xOf(i), y = yOf(i), z = zOf(i);
      for (const [sx, sz] of STEPS) {
        if (sx !== 0 && sz !== 0) continue;
        if (!this.walkable(x + sx, y, z + sz) && !this.walkable(x + sx, y + 1, z + sz) && !this.walkable(x + sx, y - 1, z + sz)) {
          this.wallside[i] = 1;
        }
      }
    }
    if (height === 2) this.buildRooms();
  }

  private moveAllowed(cells: Uint8Array, fx: number, fy: number, fz: number, tx: number, ty: number, tz: number): boolean {
    const dx = tx - fx, dz = tz - fz, dy = ty - fy;
    if (dx !== 0 && dz !== 0) {
      if (dy !== 0) return false;
      return navInside(fx + dx, fy, fz) && !!cells[index(fx + dx, fy, fz)] &&
        navInside(fx, fy, fz + dz) && !!cells[index(fx, fy, fz + dz)];
    }
    if (dy > 0) return !!this.stairs[index(tx, ty, tz)] || !!this.headroom[index(fx, fy, fz)];
    for (let y = ty + this.height; y <= fy + this.height - 1; y++) if (!navPassable(at(tx, y, tz))) return false;
    return true;
  }

  walkable(x: number, y: number, z: number): boolean {
    return navInside(x, y, z) && this.walk[index(x, y, z)] === 1;
  }
  onStairs(x: number, y: number, z: number): boolean {
    return navInside(x, y, z) && this.stairs[index(x, y, z)] === 1;
  }

  /** The walkable cell nearest a point within `radius` blocks, or null. */
  nearest(x: number, y: number, z: number, radius: number): RsPos | null {
    const bx = Math.floor(x), by = Math.floor(y + 0.01), bz = Math.floor(z);
    let best: RsPos | null = null, bestScore = Infinity;
    for (const dy of [0, 1, -1, 2, -2, -3, -4]) {
      for (let dx = -radius; dx <= radius; dx++) for (let dz = -radius; dz <= radius; dz++) {
        const cx = bx + dx, cy = by + dy, cz = bz + dz;
        if (!this.walkable(cx, cy, cz)) continue;
        const ddx = cx + 0.5 - x, ddz = cz + 0.5 - z;
        const score = ddx * ddx + ddz * ddz + dy * dy * 3;
        if (score < bestScore) { bestScore = score; best = { x: cx, y: cy, z: cz }; }
      }
    }
    return best;
  }

  /** A* between cells: smoothed waypoints (cell centres, feet y), or null. */
  path(from: RsPos | null, to: RsPos | null): [number, number, number][] | null {
    if (!from || !to || !this.walkable(from.x, from.y, from.z) || !this.walkable(to.x, to.y, to.z)) return null;
    const start = index(from.x, from.y, from.z), goal = index(to.x, to.y, to.z);
    this.generation++;
    const gen = this.generation;
    this.heapSize = 0;
    this.stamp[start] = gen; this.cost[start] = 0; this.parent[start] = -1;
    this.push(start, this.heuristic(start, goal));
    let expansions = 0, found = false;
    while (this.heapSize > 0 && expansions < MAX_EXPANSIONS) {
      const current = this.pop();
      if (this.closed[current] === gen) continue;
      if (current === goal) { found = true; break; }
      this.closed[current] = gen;
      expansions++;
      const cx = xOf(current), cy = yOf(current), cz = zOf(current);
      for (const [sx, sz] of STEPS) {
        for (let dy = -MAX_DROP; dy <= 1; dy++) {
          const nx = cx + sx, ny = cy + dy, nz = cz + sz;
          if (!this.walkable(nx, ny, nz)) continue;
          const next = index(nx, ny, nz);
          if (this.closed[next] === gen || !this.moveAllowed(this.walk, cx, cy, cz, nx, ny, nz)) continue;
          const stepCost = (sx !== 0 && sz !== 0 ? 1.414 : 1)
            + (dy === 0 ? 0 : dy > 0 && !this.stairs[next] ? 1.2 : 0.4 * Math.abs(dy))
            + (this.wallside[next] ? 0.35 : 0);
          const total = this.cost[current] + stepCost;
          if (this.stamp[next] === gen && total >= this.cost[next]) continue;
          this.stamp[next] = gen; this.cost[next] = total; this.parent[next] = current;
          this.push(next, total + this.heuristic(next, goal));
        }
      }
    }
    if (!found) return null;
    const cells: RsPos[] = [];
    for (let i = goal; i !== -1; i = this.parent[i]) cells.push({ x: xOf(i), y: yOf(i), z: zOf(i) });
    cells.reverse();
    return this.smooth(cells);
  }

  private push(node: number, key: number): void {
    if (this.heapSize === this.heapNode.length) {
      const n = new Int32Array(this.heapSize * 2); n.set(this.heapNode); this.heapNode = n;
      const k = new Float32Array(this.heapSize * 2); k.set(this.heapKey); this.heapKey = k;
    }
    let i = this.heapSize++;
    while (i > 0) {
      const up = (i - 1) >> 1;
      if (this.heapKey[up] <= key) break;
      this.heapNode[i] = this.heapNode[up]; this.heapKey[i] = this.heapKey[up]; i = up;
    }
    this.heapNode[i] = node; this.heapKey[i] = key;
  }
  private pop(): number {
    const top = this.heapNode[0];
    const lastNode = this.heapNode[--this.heapSize], lastKey = this.heapKey[this.heapSize];
    let i = 0;
    for (;;) {
      let child = i * 2 + 1;
      if (child >= this.heapSize) break;
      if (child + 1 < this.heapSize && this.heapKey[child + 1] < this.heapKey[child]) child++;
      if (this.heapKey[child] >= lastKey) break;
      this.heapNode[i] = this.heapNode[child]; this.heapKey[i] = this.heapKey[child]; i = child;
    }
    this.heapNode[i] = lastNode; this.heapKey[i] = lastKey;
    return top;
  }
  private heuristic(a: number, b: number): number {
    const dx = xOf(a) - xOf(b), dz = zOf(a) - zOf(b), dy = yOf(a) - yOf(b);
    return Math.sqrt(dx * dx + dz * dz) + Math.abs(dy) * 1.2;
  }

  /** Pulls the grid path taut wherever a straight, level walk fits. */
  private smooth(cells: RsPos[]): [number, number, number][] {
    const points: [number, number, number][] = [[cells[0].x + 0.5, cells[0].y, cells[0].z + 0.5]];
    let anchor = 0;
    while (anchor < cells.length - 1) {
      let furthest = anchor + 1;
      for (let probe = anchor + 2; probe < cells.length; probe++) {
        if (cells[probe].y !== cells[anchor].y || !this.straightWalk(cells[anchor], cells[probe])) break;
        furthest = probe;
      }
      points.push([cells[furthest].x + 0.5, cells[furthest].y, cells[furthest].z + 0.5]);
      anchor = furthest;
    }
    return points;
  }
  private straightWalk(a: RsPos, b: RsPos): boolean {
    const ax = a.x + 0.5, az = a.z + 0.5, dx = b.x - a.x, dz = b.z - a.z;
    const length = Math.hypot(dx, dz);
    if (length < 0.01) return true;
    const w = this.height === 2 ? 0.3 : 0.2;
    const px = -dz / length * w, pz = dx / length * w;
    for (let t = 0; t <= length; t += 0.25) {
      const sx = ax + dx * t / length, sz = az + dz * t / length;
      for (let side = -1; side <= 1; side++) {
        if (!this.walkable(Math.floor(sx + px * side), a.y, Math.floor(sz + pz * side))) return false;
      }
    }
    return true;
  }

  /** Path length in blocks (large when unreachable). */
  static pathLength(path: [number, number, number][] | null): number {
    if (!path) return 1e6;
    let total = 0;
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1], b = path[i];
      total += Math.hypot(a[0] - b[0], a[2] - b[2]) + Math.abs(a[1] - b[1]);
    }
    return total;
  }

  // ── Perches ────────────────────────────────────────────────────────────

  /**
   * A rat standing here is out of every seeker's reach: on the roof, or on a
   * perch no seeker-reachable cell covers with a swing or a crouched swat.
   */
  unfairPerch(x: number, y: number, z: number): boolean {
    if (y > NAV_MAX_Y) return x >= NAV_MIN_X && x <= NAV_MAX_X && z >= NAV_MIN_Z && z <= NAV_MAX_Z;
    if (!navInside(x, y, z) || this.walkable(x, y, z) || !this.ratFits(x, y, z) || this.inPassage(x, y, z)) return false;
    const key = index(x, y, z);
    let cached = this.perchCache.get(key);
    if (cached === undefined) {
      cached = ![0.5, 0.15, 0.85].every((ox) => [0.5, 0.15, 0.85].every((oz) => this.tagableAt(x + ox, y, z + oz)));
      this.perchCache.set(key, cached);
    }
    return cached;
  }
  private ratFits(x: number, y: number, z: number): boolean {
    const below = at(x, y - 1, z);
    return navPassable(at(x, y, z)) && !navPassable(below) && below !== Block.ManorCageBars && below !== Block.ManorGardenPost;
  }
  private inPassage(x: number, y: number, z: number): boolean {
    for (const p of rsHouse().passages) {
      if (y === p.y && z >= p.z1 && z <= p.z2 && (x === p.x || x === p.x - Math.sign(p.x))) return true;
    }
    return false;
  }
  private tagableAt(rx: number, ry: number, rz: number): boolean {
    const bx = Math.floor(rx), by = Math.floor(ry), bz = Math.floor(rz);
    for (let hy = by - 4; hy <= by + 3; hy++) for (let hx = bx - 4; hx <= bx + 4; hx++) for (let hz = bz - 4; hz <= bz + 4; hz++) {
      if (!this.walkable(hx, hy, hz)) continue;
      const ex = Math.max(hx + 0.3, Math.min(hx + 0.7, rx)), ez = Math.max(hz + 0.3, Math.min(hz + 0.7, rz));
      if (this.hits(ex, hy + 1.62, ez, rx, ry, rz) || this.hits(ex, hy + 1.27, ez, rx, ry, rz)) return true;
      if (Math.abs(hy - ry) <= 1.2 && Math.hypot(ex - rx, ez - rz) < 2.7 && clearLine(ex, hy + 0.38, ez, rx, ry + 0.3, rz)) return true;
    }
    return false;
  }
  private hits(ex: number, ey: number, ez: number, rx: number, ry: number, rz: number): boolean {
    for (const py of [ry + 0.1, ry + 0.45, ry + 0.8]) {
      for (const [ox, oz] of [[0, 0], [-0.14, 0], [0.14, 0], [0, -0.14], [0, 0.14]]) {
        const px = rx + ox, pz = rz + oz;
        const dx = px - ex, dy = py - ey, dz = pz - ez;
        if (dx * dx + dy * dy + dz * dz <= TAG_REACH * TAG_REACH && clearLine(ex, ey, ez, px, py, pz)) return true;
      }
    }
    return false;
  }

  /** The seeker-reachable cell a rat slipping off a perch lands on. */
  landing(x: number, y: number, z: number): RsPos | null {
    for (let down = 0; down <= 12; down++) {
      let best: RsPos | null = null, bestScore = Infinity;
      for (let dx = -4; dx <= 4; dx++) for (let dz = -4; dz <= 4; dz++) {
        const cx = x + dx, cy = Math.min(y, NAV_MAX_Y) - down, cz = z + dz;
        const score = dx * dx + dz * dz;
        if (score < bestScore && this.walkable(cx, cy, cz)) { bestScore = score; best = { x: cx, y: cy, z: cz }; }
      }
      if (best) return best;
    }
    return null;
  }

  // ── Rooms ──────────────────────────────────────────────────────────────

  roomOf(x: number, y: number, z: number): string | null {
    for (const r of rsHouse().rooms) {
      if (x >= r.x1 && x <= r.x2 && y >= r.y1 && y <= r.y2 && z >= r.z1 && z <= r.z2) return r.name;
    }
    return null;
  }
  private buildRooms(): void {
    const h = rsHouse();
    for (const room of h.rooms) {
      if (room.name === 'rescue courtyard') continue;
      const cx = Math.floor((room.x1 + room.x2) / 2), cz = Math.floor((room.z1 + room.z2) / 2);
      const centre = this.nearest(cx + 0.5, room.y1, cz + 0.5, 6);
      if (!centre || this.roomOf(centre.x, centre.y, centre.z) !== room.name) continue;
      const spots: NavSpot[] = [];
      for (const hide of h.hides) {
        const p = hide.pos;
        const from = this.nearest(p.x + 0.5, p.y, p.z + 0.5, 3);
        if (!from || this.roomOf(from.x, from.y, from.z) !== room.name) continue;
        spots.push({ name: hide.name, hide: p, from, low: true });
      }
      for (const p of h.cheese) {
        const from = this.nearest(p.x + 0.5, p.y, p.z + 0.5, 2);
        if (from && this.roomOf(from.x, from.y, from.z) === room.name) spots.push({ name: 'cheese spot', hide: p, from, low: false });
      }
      this.rooms.push({ name: room.name, centre, spots });
    }
  }
  /** Mouseholes, where rats must pass and a trap pays off. */
  chokepoints(): RsPos[] {
    const out: RsPos[] = [];
    for (const hide of rsHouse().hides) {
      if (hide.name !== 'mousehole') continue;
      const p = hide.pos;
      if (navFloor(at(p.x, p.y - 1, p.z)) && navPassable(at(p.x, p.y, p.z)) && this.nearest(p.x + 0.5, p.y, p.z + 0.5, 2)) out.push(p);
    }
    return out;
  }
}

/** Is the straight line between two points free of view-blocking blocks? */
export function clearLine(ax: number, ay: number, az: number, bx: number, by: number, bz: number,
  sample: (x: number, y: number, z: number) => number = at): boolean {
  const length = Math.hypot(bx - ax, by - ay, bz - az);
  const steps = Math.max(1, Math.ceil(length / 0.1));
  for (let s = 1; s < steps; s++) {
    const t = s / steps;
    const b = sample(Math.floor(ax + (bx - ax) * t), Math.floor(ay + (by - ay) * t), Math.floor(az + (bz - az) * t));
    if (!seeThrough(b)) {
      // A stair or slab only blocks the part of the cell it fills.
      if (b === Block.ManorStairN || b === Block.ManorStairS || b === Block.ManorMarbleSlab) {
        const fy = (ay + (by - ay) * t) % 1;
        if (fy >= 0.5 && b === Block.ManorMarbleSlab) continue;
      }
      return false;
    }
  }
  return true;
}

let seekerNav: RsNav | null = null, smallNav: RsNav | null = null;
/** The seeker grid (people): built on first use, then shared. */
export function rsSeekerNav(): RsNav {
  return seekerNav ??= new RsNav(2, RS_RELEASE);
}
/** The small grid (the cat), from the hall where Mr. Whiskers wakes up. */
export function rsSmallNav(): RsNav {
  return smallNav ??= new RsNav(1, { x: 0, y: 81, z: 6 });
}
