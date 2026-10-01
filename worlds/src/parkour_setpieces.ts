// The builds round a Dragon Chase course — and under it.
//
// parkour_course.ts lays the ROUTE: every pad and every jump, winding through
// each piece. This file makes every pad the top of something real, standing
// on the ground: the flat roof of a house, the crown of a tree, a rock in a
// river, a stretch of castle wall, a lookout on stilts at the end of a rope
// bridge. Then it builds the place round them — the street, the gorge, the
// waterfalls, the keep — and the Dragon's Lair behind the start and the
// Sanctuary (and its podium) at the finish.
//
// NOTHING FLOATS. Terrain goes down first; the scenery next; then every
// pad's own column is driven straight down from under its surface to the
// terrain beneath it, through anything in the way. Decoration round a pad
// (eaves, a crown of leaves, a tower's corbels) only ever fills empty air.
// Chains hang from something above them or are strung sideways between two
// posts, as part of the same structure as their anchors.
//
// SYMMETRY. The route winds, so the venue is not a mirror image any more —
// but everything round it comes in mirrored pairs (`Builder.pair`), and a
// pair is kept or dropped together, so the flanks always match.
//
// One rule keeps the route honest. Every build is checked against the
// route's own boxes (`course.spaces`):
//   · nothing solid within a block of a pad, or in or beside the air a jump
//     flies through (from three below its lower end to five above its upper);
//   · within five blocks sideways of the route, no solid block may leave a
//     top you could stand on between three below the route and its height.
// A pad's own column is part of the pad. A STRUCTURE that breaks the rule
// anywhere is left out whole (with its twin) — never shaved into a stump.
// Only terrain is cut to fit, and a last sweep removes anything left loose.
import { Block, BLOCKS } from './blocks';
import { partyHash } from './partygames';
import { parkourCourse, type PadRole, type ParkourCourse, type ParkourPlatform, type ParkourSection } from './parkour_course';
import {
  PARKOUR_CENTRE_X, PARKOUR_VENUE_X, PARKOUR_VENUE_Z, PARTY_STAMP_MAX_Y, PARTY_STAMP_MIN_Y,
} from './venue_dims';
import { parkourTheme, type ParkourPalette } from './parkour_themes';

const X = PARKOUR_VENUE_X, Z = PARKOUR_VENUE_Z, CX = PARKOUR_CENTRE_X;
const MIN_Y = PARTY_STAMP_MIN_Y, MAX_Y = PARTY_STAMP_MAX_Y, H = MAX_Y - MIN_Y + 1;
/** Columns in the venue. Cells are stored column by column, bottom to top:
 *  stepping a key by one moves one block up, by H one block along x. */
const LAYER = X * Z;
const key = (x: number, y: number, z: number): number => (z * X + x) * H + (y - MIN_Y);
/** Round an x the same way either side of the middle, so a thing built on
 *  the west and its mirror on the east come out block for block alike. */
const roundX = (x: number): number => CX + Math.sign(x - CX) * Math.round(Math.abs(x - CX));
/** Blocks with collision (water counts: it changes how you move). */
const PHYSICAL = new Uint8Array(256), SOLID = new Uint8Array(256);
for (let i = 1; i < 256; i++) {
  SOLID[i] = BLOCKS[i]?.solid ? 1 : 0;
  PHYSICAL[i] = SOLID[i] || i === Block.Water ? 1 : 0;
}
/** Groups of touching blocks smaller than this, touching nothing on the
 *  route, are strays: swept away. */
const STRAY_LIMIT = 40;
/** Paired scenery stands this far either side of the middle: clear of the
 *  widest the route ever winds. */
const FLANK = 31;

// ── The stamp ──────────────────────────────────────────────────────────────

/** A finished venue, packed as runs of one block per column: a mountain or a
 *  tower is a handful of bytes, not thousands of map entries. */
export class ParkourVenue {
  constructor(private readonly colStart: Int32Array, private readonly runs: Uint8Array) { }
  get(x: number, y: number, z: number): number {
    if (x < 0 || x >= X || z < 0 || z >= Z || y < MIN_Y || y > MAX_Y) return Block.Air;
    const c = z * X + x, ry = y - MIN_Y;
    for (let i = this.colStart[c], end = this.colStart[c + 1]; i < end; i += 3) {
      const y0 = this.runs[i];
      if (ry < y0) return Block.Air;
      if (ry < y0 + this.runs[i + 1]) return this.runs[i + 2];
    }
    return Block.Air;
  }
  /** Blocks in the venue (tests). */
  count(): number {
    let n = 0;
    for (let i = 0; i < this.runs.length; i += 3) if (this.runs[i + 2] !== Block.Air) n += this.runs[i + 1];
    return n;
  }
}

function pack(cells: Uint8Array): ParkourVenue {
  const colStart = new Int32Array(LAYER + 1);
  let out = new Uint8Array(1 << 20), n = 0;
  for (let c = 0, base = 0; c < LAYER; c++, base += H) {
    colStart[c] = n;
    for (let y = 0; y < H;) {
      const b = cells[base + y];
      if (!b) { y++; continue; }
      let run = 1;
      while (y + run < H && cells[base + y + run] === b && run < 255) run++;
      if (n + 3 > out.length) { const grown = new Uint8Array(out.length * 2); grown.set(out); out = grown; }
      out[n++] = y; out[n++] = run; out[n++] = b;
      y += run;
    }
  }
  colStart[LAYER] = n;
  return new ParkourVenue(colStart, out.slice(0, n));
}

// ── Building helpers ───────────────────────────────────────────────────────

class Builder {
  /** The whole venue, one byte a cell. */
  readonly cells = new Uint8Array(LAYER * H);
  /** Which structure put each cell there (0 = terrain, which may be cut). */
  readonly owner = new Uint16Array(LAYER * H);
  /** A structure's mirrored twin: the two are kept or dropped together. */
  readonly twin = new Map<number, number>();
  private current = 0;
  private nextId = 1;
  constructor(readonly seed: number, readonly pal: ParkourPalette) { }
  /** Build `fn` as one structure: kept whole, or left out whole. Anything
   *  built inside another structure is part of it. */
  whole(fn: () => void): void {
    if (this.current) { fn(); return; }
    this.current = this.nextId < 65535 ? this.nextId++ : 65535;
    try { fn(); } finally { this.current = 0; }
  }
  /** Build `fn` once for each side of the middle (-1 west, 1 east), as two
   *  structures that stand or fall together. `fn` mirrors its own x. */
  pair(fn: (side: -1 | 1) => void): void {
    const ids: number[] = [];
    for (const side of [-1, 1] as const) this.whole(() => { ids.push(this.current); fn(side); });
    if (ids[0] !== ids[1]) { this.twin.set(ids[0], ids[1]); this.twin.set(ids[1], ids[0]); }
  }
  inside(x: number, y: number, z: number): boolean {
    return x >= 0 && x < X && z >= 0 && z < Z && y >= MIN_Y + 1 && y <= MAX_Y;
  }
  put(x: number, y: number, z: number, b: number): void {
    x = roundX(x); y = Math.round(y); z = Math.round(z);
    if (!this.inside(x, y, z)) return;
    const k = key(x, y, z);
    this.cells[k] = b;
    this.owner[k] = this.current;
  }
  /** Only into empty air. */
  add(x: number, y: number, z: number, b: number): void {
    x = roundX(x); y = Math.round(y); z = Math.round(z);
    if (this.inside(x, y, z) && !this.cells[key(x, y, z)]) this.put(x, y, z, b);
  }
  get(x: number, y: number, z: number): number { return this.inside(x, y, z) ? this.cells[key(x, y, z)] : Block.Air; }
  /** Terrain (not part of any structure) at this cell. */
  ground(x: number, y: number, z: number): boolean {
    return this.inside(x, y, z) && !!SOLID[this.cells[key(x, y, z)]] && !this.owner[key(x, y, z)];
  }
  clear(x: number, y: number, z: number): void { if (this.inside(x, y, z)) this.cells[key(x, y, z)] = Block.Air; }
  fill(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, b: number): void {
    for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++)
      for (let z = Math.min(z0, z1); z <= Math.max(z0, z1); z++)
        for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) this.put(x, y, z, b);
  }
  /** Fill from (x, y, z) straight down until it stands on terrain. */
  downTo(x: number, y: number, z: number, block: number | ((y: number) => number)): void {
    for (; y > MIN_Y; y--) {
      this.put(x, y, z, typeof block === 'number' ? block : block(y));
      if (this.ground(x, y - 1, z)) return;
    }
  }
  /** 0..1, stable for its arguments. */
  r(...n: number[]): number {
    let h = this.seed >>> 0;
    for (const v of n) h = partyHash(h, v | 0);
    return h / 4294967296;
  }

  /** A floating island: a soil-topped slab whose underside steps in, tier by
   *  tier, to a point. Clean edges; `top` is its surface height. Squarish
   *  (a superellipse), so its corners reach under the ends of the route. */
  island(cx: number, cz: number, rx: number, rz: number, top: number, depth: number, soil = this.pal.soil): void {
    for (let z = Math.floor(cz - rz); z <= Math.ceil(cz + rz); z++)
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
        const d = (((x - cx) / rx) ** 4 + ((z - cz) / rz) ** 4) ** .25;
        if (d > 1) continue;
        const under = Math.max(1, Math.round(depth * Math.sqrt(1 - d * d)));
        for (let y = top - under; y < top; y++) this.put(x, y, z, (top - y) % 4 === 3 ? this.pal.brick : this.pal.rock);
        this.put(x, top, z, soil);
      }
  }

  /** A tree of the palette's kind, rooted at (x, y, z). A neat round crown. */
  tree(x: number, y: number, z: number, size = 1): void {
    this.whole(() => {
      const leaves = this.pal.leaves, log = logOf(this.pal);
      const species = leaves === Block.CherryLeaves ? 'cherry' : leaves === Block.SpruceLeaves ? 'spruce'
        : leaves === Block.BirchLeaves ? 'birch' : 'oak';
      const top = Math.round((species === 'spruce' ? 7 : species === 'cherry' ? 6 : 5) * size);
      const leafAt = (dx: number, dy: number, dz: number) => this.add(x + dx, y + dy, z + dz, leaves);
      for (let dy = 0; dy < top; dy++) this.put(x, y + dy, z, log);
      if (species === 'spruce') {
        for (let dy = 2; dy <= top + 1; dy++) {
          const fromTop = top + 1 - dy;
          const radius = fromTop === 0 ? 0 : Math.min(3, 1 + Math.floor(fromTop / 2) - (fromTop % 2 === 0 ? 1 : 0));
          for (let dx = -radius; dx <= radius; dx++)
            for (let dz = -radius; dz <= radius; dz++)
              if (Math.abs(dx) + Math.abs(dz) <= radius + (radius > 1 ? 1 : 0)) leafAt(dx, dy, dz);
        }
        leafAt(0, top + 2, 0);
      } else {
        const wide = species === 'cherry' ? 3 * size : 2.4 * size;
        for (let dy = top - 2; dy <= top + 1; dy++) {
          const layer = dy - top;
          const radius = layer === 1 ? wide - 1.3 : layer === -2 ? wide - .7 : wide;
          const rr = Math.ceil(radius);
          for (let dx = -rr; dx <= rr; dx++)
            for (let dz = -rr; dz <= rr; dz++) if (Math.hypot(dx, dz) <= radius + .2) leafAt(dx, dy, dz);
        }
      }
    });
  }

  /** A post with a lamp on it. */
  lampPost(x: number, y: number, z: number, h = 3): void {
    this.whole(() => {
      for (let dy = 0; dy < h; dy++) this.put(x, y + dy, z, this.pal.log);
      this.put(x, y + h, z, this.pal.lamp);
    });
  }

  /** A banner of cloth hanging down from under (x, y + 1, z). */
  banner(x: number, y: number, z: number, len: number, cloth = this.pal.cloth): void {
    for (let dy = 0; dy < len; dy++) this.put(x, y - dy, z, cloth);
  }

  /** A round tower: `r` its radius, walls from y0 to y1, a crenellated top,
   *  slit windows, and (unless `flat`) a cone roof. */
  tower(cx: number, cz: number, r: number, y0: number, y1: number, opts: { flat?: boolean; roof?: number; wall?: number } = {}): void {
    this.whole(() => {
      const wall = opts.wall ?? this.pal.stone, roof = opts.roof ?? this.pal.roof;
      const rr = Math.ceil(r);
      for (let y = y0; y <= y1; y++)
        for (let dz = -rr; dz <= rr; dz++)
          for (let dx = -rr; dx <= rr; dx++) {
            const d = Math.hypot(dx, dz);
            if (d > r + .3) continue;
            const shell = d > r - 1.1;
            if (!shell) { if (y === y1) this.put(cx + dx, y, cz + dz, this.pal.wood); continue; }
            const slit = (y - y0) % 5 === 3 && (dx === 0 || dz === 0);
            const band = (y - y0) % 6 === 0;
            this.put(cx + dx, y, cz + dz, slit ? this.pal.glow : band ? this.pal.brick : wall);
          }
      for (let dz = -rr - 1; dz <= rr + 1; dz++)
        for (let dx = -rr - 1; dx <= rr + 1; dx++) {
          const d = Math.hypot(dx, dz);
          if (d > r + 1.3 || d <= r - .2) continue;
          this.put(cx + dx, y1, cz + dz, this.pal.trim);
          if ((dx + dz) % 2 === 0) this.put(cx + dx, y1 + 1, cz + dz, this.pal.trim);
        }
      if (opts.flat) return;
      for (let k = 0; k <= r + 2; k++) {
        const rad = r + .5 - k * .8;
        if (rad < 0) { this.put(cx, y1 + 2 + k, cz, this.pal.trim); break; }
        const rc = Math.ceil(rad);
        for (let dz = -rc; dz <= rc; dz++)
          for (let dx = -rc; dx <= rc; dx++)
            if (Math.hypot(dx, dz) <= rad + .3) this.put(cx + dx, y1 + 2 + k, cz + dz, roof);
      }
    });
  }

  /** A house: stone plinth, framed walls with windows and a door, and a
   *  stepped gable roof along its longer side. (x0, z0) is a corner. */
  house(x0: number, z0: number, w: number, d: number, y0: number, wallH: number, roof = this.pal.roof, door: 'x0' | 'x1' = 'x1'): void {
    this.whole(() => {
      const x1 = x0 + w - 1, z1 = z0 + d - 1;
      for (let y = y0; y < y0 + wallH; y++)
        for (let z = z0; z <= z1; z++)
          for (let x = x0; x <= x1; x++) {
            const edge = x === x0 || x === x1 || z === z0 || z === z1;
            if (!edge) continue;
            const corner = (x === x0 || x === x1) && (z === z0 || z === z1);
            const low = y - y0 < 2;
            const win = !corner && !low && (y - y0) % 3 === 2 && ((z - z0) % 2 === 1);
            this.put(x, y, z, corner ? this.pal.log : low ? this.pal.stone : win ? this.pal.glass : this.pal.trim);
          }
      // The door faces the street.
      const dx = door === 'x0' ? x0 : x1, dz = z0 + (d >> 1);
      this.put(dx, y0, dz, this.pal.wood); this.put(dx, y0 + 1, dz, this.pal.wood);
      const alongX = w >= d;
      const span = alongX ? d : w;
      const top = y0 + wallH;
      for (let k = 0; k <= (span + 1) >> 1; k++) {
        const y = top + k;
        if (alongX) {
          for (let x = x0 - 1; x <= x1 + 1; x++) { this.put(x, y, z0 - 1 + k, roof); this.put(x, y, z1 + 1 - k, roof); }
          for (const x of [x0, x1]) for (let z = z0 + k; z <= z1 - k; z++) this.put(x, y, z, this.pal.trim);
        } else {
          for (let z = z0 - 1; z <= z1 + 1; z++) { this.put(x0 - 1 + k, y, z, roof); this.put(x1 + 1 - k, y, z, roof); }
          for (const z of [z0, z1]) for (let x = x0 + k; x <= x1 - k; x++) this.put(x, y, z, this.pal.trim);
        }
      }
    });
  }

  /** A straight line of blocks from a to b (inclusive), `thick` wide. */
  line(ax: number, ay: number, az: number, bx: number, by: number, bz: number, block: number, thick = 0): void {
    const n = Math.max(1, Math.ceil(Math.max(Math.abs(bx - ax), Math.abs(by - ay), Math.abs(bz - az)) * 2));
    for (let i = 0; i <= n; i++) {
      const t = i / n, x = roundX(ax + (bx - ax) * t), y = Math.round(ay + (by - ay) * t), z = Math.round(az + (bz - az) * t);
      for (let dx = -thick; dx <= thick; dx++) for (let dz = -thick; dz <= thick; dz++) this.put(x + dx, y, z + dz, block);
    }
  }
  /** A chain hanging `len` blocks down from under (x, y + 1, z), which must
   *  be solid: build it in the same structure as what it hangs from. */
  chain(x: number, y: number, z: number, len: number): void {
    for (let dy = 0; dy < len; dy++) this.add(x, y - dy, z, Block.ParkourChain);
  }
  /** A chain strung sideways between two anchors at (ax, y, az) and
   *  (bx, y, bz) — both solid, in the same structure — lying along its run. */
  rope(ax: number, y: number, az: number, bx: number, bz: number): void {
    if (az === bz) for (let x = Math.min(ax, bx) + 1; x < Math.max(ax, bx); x++) this.add(x, y, az, Block.ParkourChainX);
    else if (ax === bx) for (let z = Math.min(az, bz) + 1; z < Math.max(az, bz); z++) this.add(ax, y, z, Block.ParkourChainZ);
  }
  /** A cliff or rock wall: a straight face at `face` (the side toward the
   *  route), `thick` deep, flat-topped at `top`, in neat strata. */
  wall(faceX: number, dir: -1 | 1, thick: number, z0: number, z1: number, y0: number, top: number): void {
    for (let z = z0; z <= z1; z++)
      for (let y = y0; y <= top; y++)
        for (let k = 0; k < thick; k++) {
          const x = faceX + dir * k;
          this.put(x, y, z, y === top ? this.pal.soil : (top - y) % 5 === 4 ? this.pal.brick : this.pal.rock);
        }
  }
}

/** The log that goes with a palette's leaves. */
function logOf(P: ParkourPalette): number {
  return P.leaves === Block.CherryLeaves ? Block.CherryLog : P.leaves === Block.SpruceLeaves ? Block.SpruceLog
    : P.leaves === Block.BirchLeaves ? Block.BirchLog : Block.OakLog;
}

// ── What each piece is given ───────────────────────────────────────────────

interface Area {
  index: number;
  sec: ParkourSection;
  pads: ParkourPlatform[];
  /** Pad extents, venue-local. */
  x0: number; x1: number; z0: number; z1: number;
  /** Lowest and highest standing heights. */
  lo: number; hi: number;
}
/** One stretch of a piece's path: consecutive pads with the same role. */
interface Stretch { role: PadRole; pads: ParkourPlatform[] }

const cellOf = (p: ParkourPlatform) => ({ x: Math.floor(p.x), z: Math.floor(p.z) });
/** Footprint of a pad, inclusive. */
function foot(p: ParkourPlatform): { x0: number; x1: number; z0: number; z1: number } {
  const { x, z } = cellOf(p);
  const hx = (p.width - 1) / 2, hz = (p.depth - 1) / 2;
  return { x0: x - hx, x1: x + hx, z0: z - hz, z1: z + hz };
}
/** The highest standing height of any pad within `r` blocks of (x, z). */
function highNear(course: ParkourCourse, x: number, z: number, r: number, fallback: number): number {
  let best = -Infinity;
  for (const p of course.platforms) if (Math.abs(p.x - x) <= r && Math.abs(p.z - z) <= r) best = Math.max(best, p.y);
  return Number.isFinite(best) ? best : fallback;
}
/** True when nothing on the route stands within `m` blocks of the box. */
function clearOfRoute(course: ParkourCourse, x0: number, x1: number, z0: number, z1: number, m = 2): boolean {
  return !course.platforms.some(p => {
    const f = foot(p);
    return f.x0 - m <= x1 && x0 <= f.x1 + m && f.z0 - m <= z1 && z0 <= f.z1 + m;
  });
}
/** The piece's path, stretch by stretch. */
function stretches(a: Area): Stretch[] {
  const out: Stretch[] = [];
  for (const p of a.pads) {
    const last = out[out.length - 1];
    if (last && last.role === p.role) last.pads.push(p);
    else out.push({ role: p.role, pads: [p] });
  }
  return out;
}
/** Every jump inside a piece, as [from, to]. */
function jumps(a: Area, course: ParkourCourse): [ParkourPlatform, ParkourPlatform][] {
  return a.pads.filter(p => p.from >= 0).map(p => [course.platforms[p.from], p]);
}
const mean = (v: number[]): number => v.reduce((s, n) => s + n, 0) / v.length;

// ── What every pad stands on ───────────────────────────────────────────────
// Each drives the pad's own column down to the terrain: always there, never
// removed, part of the pad as far as the route rule is concerned.

type Material = number | ((y: number) => number);
/** Solid under the whole footprint, down to the terrain — except under a
 *  pit, whose shaft stays open all the way down. */
function column(b: Builder, p: ParkourPlatform, block: Material): void {
  const f = foot(p), { x: cx, z: cz } = cellOf(p);
  for (let x = f.x0; x <= f.x1; x++) for (let z = f.z0; z <= f.z1; z++) {
    // The pit: a shaft well below anything within reach, through whatever
    // terrain it is cut in.
    if (p.kind === 'pit' && (p.heading % 2 ? x === cx : z === cz)) {
      for (let y = p.y - 2; y >= p.y - 9; y--) b.clear(x, y, z);
      continue;
    }
    b.downTo(x, p.y - 2, z, block);
  }
}
/** Masonry with a band every few courses. */
function banded(main: number, band: number, every = 5): (y: number) => number {
  return (y) => (y % every === 0 ? band : main);
}
/** Posts at the footprint's corners (one under a one-block pad), braced
 *  round the footprint's edge every few blocks. */
function stilts(b: Builder, p: ParkourPlatform, post: number, brace: number): void {
  const f = foot(p);
  const corners = new Set([`${f.x0},${f.z0}`, `${f.x1},${f.z0}`, `${f.x0},${f.z1}`, `${f.x1},${f.z1}`]);
  /** The highest foot of any post. */
  let bottom = MIN_Y;
  for (const c of corners) {
    const [x, z] = c.split(',').map(Number);
    let y = p.y - 2;
    while (y > MIN_Y && !b.ground(x, y - 1, z)) y--;
    bottom = Math.max(bottom, y);
    b.downTo(x, p.y - 2, z, post);
  }
  if (f.x1 === f.x0 && f.z1 === f.z0) return;
  // Braces only where every post has come down that far.
  for (let y = p.y - 5; y > bottom + 1; y -= 4) {
    b.fill(f.x0, f.x1, y, y, f.z0, f.z0, brace); b.fill(f.x0, f.x1, y, y, f.z1, f.z1, brace);
    b.fill(f.x0, f.x0, y, y, f.z0, f.z1, brace); b.fill(f.x1, f.x1, y, y, f.z0, f.z1, brace);
  }
}
/** A house whose flat roof is the pad: walls straight down from the pad's
 *  edges to the street, windows, a door facing the middle, and eaves
 *  stepping out under the roof terrace. Narrow pads get a chimney stack. */
function houseUnder(b: Builder, p: ParkourPlatform, roof: number): void {
  const P = b.pal, f = foot(p), top = p.y - 2;
  if (f.x1 - f.x0 < 2 || f.z1 - f.z0 < 2) {
    column(b, p, banded(P.brick, P.trim, 4));
    return;
  }
  b.fill(f.x0, f.x1, top, top, f.z0, f.z1, P.trim);
  for (let z = f.z0; z <= f.z1; z++)
    for (let x = f.x0; x <= f.x1; x++) {
      const edgeX = x === f.x0 || x === f.x1, edgeZ = z === f.z0 || z === f.z1;
      if (!edgeX && !edgeZ) continue;
      const corner = edgeX && edgeZ;
      let g = top - 1;
      while (g > MIN_Y && !b.ground(x, g - 1, z)) g--;
      b.downTo(x, top - 1, z, (y) => {
        const h = y - g;
        const win = !corner && h > 2 && h % 3 === 0 && (edgeX ? (z - f.z0) % 2 === 1 : (x - f.x0) % 2 === 1);
        return corner ? P.log : h <= 1 ? P.stone : win ? P.glass : (top - y) % 6 === 1 ? P.brick : P.trim;
      });
    }
  // A door toward the middle of the street, where the wall meets the ground.
  const dx = Math.floor(p.x) < CX ? f.x1 : f.x0, dz = Math.floor(p.z);
  let g = top - 1;
  while (g > MIN_Y && !b.ground(dx, g - 1, dz)) g--;
  if (top - g > 4) { b.put(dx, g, dz, P.wood); b.put(dx, g + 1, dz, P.wood); }
  b.whole(() => {
    for (const [d, y] of [[1, top - 2], [2, top - 3]] as const)
      for (let z = f.z0 - d; z <= f.z1 + d; z++)
        for (let x = f.x0 - d; x <= f.x1 + d; x++)
          if (x < f.x0 || x > f.x1 || z < f.z0 || z > f.z1) b.add(x, y, z, roof);
  });
}
/** A tree whose crown is the pad: a trunk down to the ground, a skirt of
 *  leaves well under the top, and roots. */
function treeUnder(b: Builder, p: ParkourPlatform): void {
  const P = b.pal, log = logOf(P), f = foot(p);
  column(b, p, log);
  const cx = (f.x0 + f.x1) / 2, cz = (f.z0 + f.z1) / 2;
  const rx = (f.x1 - f.x0) / 2 + 2.6, rz = (f.z1 - f.z0) / 2 + 2.6;
  b.whole(() => {
    for (const [y, s] of [[p.y - 5, .8], [p.y - 6, 1], [p.y - 7, .7]] as const)
      for (let z = Math.floor(cz - rz); z <= Math.ceil(cz + rz); z++)
        for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++)
          if (Math.hypot((x - cx) / (rx * s), (z - cz) / (rz * s)) <= 1) b.add(x, y, z, P.leaves);
    // Vines trailing from the skirt.
    for (const [x, z] of [[f.x0 - 2, cz], [f.x1 + 2, cz], [cx, f.z0 - 2], [cx, f.z1 + 2]])
      if (b.get(Math.round(x), p.y - 7, Math.round(z)) === P.leaves) for (let k = 1; k <= 2; k++) b.add(x, p.y - 7 - k, z, Block.ParkourVine);
  });
}
/** A rock standing up out of whatever is below: strata, and moss on top. */
function rockUnder(b: Builder, p: ParkourPlatform): void {
  const P = b.pal;
  column(b, p, (y) => (y === p.y - 2 ? P.soil : (p.y - y) % 5 === 0 ? P.brick : P.rock));
}

// ── The set pieces ─────────────────────────────────────────────────────────

/** Builds a piece's terrain and scenery, and hands back what goes under its
 *  pads — run once EVERY piece is built, so a neighbour's river or pond can
 *  never cut through a column. */
type PieceBuilder = (b: Builder, a: Area, course: ParkourCourse) => () => void;

const ramparts: PieceBuilder = (b, a, course) => {
  const P = b.pal, ground = a.lo - 11, zc = (a.z0 + a.z1) / 2;
  b.island(CX, zc, 38, (a.z1 - a.z0) / 2 + 6, ground, 7);
  // The keep, in the courtyard before the curtain wall the route crosses.
  const cross = stretches(a).find(s => s.role === 'cross');
  const wallZ = cross ? Math.round(mean(cross.pads.map(p => p.z))) : Math.round(zc);
  const kz = Math.round((a.z0 + wallZ) / 2) + 2, top = highNear(course, CX, kz, 16, a.hi) + 9;
  if (clearOfRoute(course, CX - 5, CX + 5, kz - 5, kz + 5, 3)) b.whole(() => {
    for (let y = ground + 1; y <= top; y++)
      for (let z = kz - 5; z <= kz + 5; z++)
        for (let x = CX - 5; x <= CX + 5; x++) {
          const edgeX = Math.abs(x - CX) === 5, edgeZ = Math.abs(z - kz) === 5;
          if (!edgeX && !edgeZ) { if (y === top) b.put(x, y, z, P.wood); continue; }
          const corner = edgeX && edgeZ, h = y - ground;
          const win = !corner && h % 5 === 3 && (x === CX || z === kz);
          b.put(x, y, z, corner ? P.trim : win ? P.glow : h % 6 === 0 ? P.brick : P.stone);
        }
    for (let z = kz - 6; z <= kz + 6; z++)
      for (let x = CX - 6; x <= CX + 6; x++) {
        if (Math.max(Math.abs(x - CX), Math.abs(z - kz)) !== 6) continue;
        b.put(x, top, z, P.trim);
        if ((x + z) % 2 === 0) b.put(x, top + 1, z, P.trim);
      }
    for (let k = 0; k <= 4; k++) b.fill(CX - 4 + k, CX + 4 - k, top + 1 + k, top + 1 + k, kz - 4 + k, kz + 4 - k, P.roof);
    b.put(CX, top + 6, kz, P.log); b.put(CX, top + 7, kz, P.log);
    b.put(CX, top + 8, kz, P.lamp);
    for (const x of [CX - 2, CX + 2]) b.banner(x, top - 1, kz - 6, 5, P.cloth2);
  });
  // Towers down both flanks, in pairs, flying banners.
  for (let z = a.z0 + 8, i = 0; z < a.z1 - 4; z += 22, i++) {
    const t = highNear(course, CX, z, 40, a.hi) + 6;
    b.pair((side) => {
      const x = CX + side * FLANK;
      b.tower(x, z, 3, ground + 1, t, { roof: i % 2 ? P.roof : P.roof2 });
      b.banner(x - side * 4, t - 1, z, 5);
      b.put(x, t + 8, z, P.log); b.put(x, t + 9, z, P.log);
      b.put(x + side, t + 9, z, P.cloth); b.put(x + 2 * side, t + 9, z, P.cloth);
    });
  }
  // The curtain wall itself: under every pad, and a lower wall-walk between
  // each pair of them, four below — the drop you are jumping over.
  for (const [f, t] of jumps(a, course)) b.whole(() => {
    const m = Math.min(f.y, t.y), A = cellOf(f), B = cellOf(t);
    const n = Math.max(1, Math.round(Math.hypot(B.x - A.x, B.z - A.z)));
    for (let i = 0; i <= n; i++) {
      const x = Math.round(A.x + (B.x - A.x) * i / n), z = Math.round(A.z + (B.z - A.z) * i / n);
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++)
        for (let y = ground + 1; y <= m - 4; y++) b.add(x + dx, y, z + dz, y === m - 4 ? P.trim : P.stone);
    }
  });
  return () => {
  for (const p of a.pads) column(b, p, banded(P.stone, P.brick));
  // Arrow slits down the walls, and corbels and a banner under each corner
  // tower top.
  for (const p of a.pads) {
    const f = foot(p);
    for (let y = p.y - 6; y > ground + 2; y -= 5)
      for (const [x, z] of [[Math.floor(p.x), f.z0], [Math.floor(p.x), f.z1], [f.x0, Math.floor(p.z)], [f.x1, Math.floor(p.z)]])
        if (b.get(x, y, z) === P.stone) b.put(x, y, z, P.glow);
    if (p.kind !== 'wide') continue;
    b.whole(() => {
      for (let z = f.z0 - 1; z <= f.z1 + 1; z++)
        for (let x = f.x0 - 1; x <= f.x1 + 1; x++)
          if ((x < f.x0 || x > f.x1 || z < f.z0 || z > f.z1) && (x + z) % 2 === 0) b.add(x, p.y - 5, z, P.trim);
      const out = Math.floor(p.x) < CX ? f.x0 - 1 : f.x1 + 1;
      if (b.get(out, p.y - 5, Math.floor(p.z)) === P.trim) b.banner(out, p.y - 6, Math.floor(p.z), 4, P.cloth2);
    });
  }
  };
};

const rooftops: PieceBuilder = (b, a, course) => {
  const P = b.pal, ground = a.lo - 12, zc = (a.z0 + a.z1) / 2;
  b.island(CX, zc, 40, (a.z1 - a.z0) / 2 + 6, ground, 6, Block.ManorPaving);
  // The rest of the village: rows of tall houses down both sides of the
  // street, in mirrored pairs, and a washing line strung across every third.
  for (let z = a.z0 - 2, i = 0; z < a.z1; z += 11, i++) {
    const w = 7 + (i % 2) * 2, d = 7, h = 8 + (i % 3) * 3;
    const roof = i % 2 ? P.roof : P.roof2;
    b.pair((side) => {
      const x0 = side < 0 ? CX - 29 - w : CX + 30;
      b.house(x0, z, w, d, ground + 1, h, roof, side < 0 ? 'x1' : 'x0');
    });
    if (i % 3 === 1) {
      const y = highNear(course, CX, z + 3, 30, a.hi) + 8;
      b.whole(() => {
        for (const x of [CX - 28, CX + 28]) for (let yy = ground + 1; yy <= y + 1; yy++) b.put(x, yy, z + 3, P.log);
        b.rope(CX - 28, y, z + 3, CX + 28, z + 3);
        for (let x = CX - 24; x <= CX + 24; x += 4) b.put(x, y - 1, z + 3, (x - CX) % 8 ? P.cloth : P.cloth2);
      });
    }
  }
  // Street lamps and market stalls, in pairs along the house fronts.
  const clearBoth = (x0: number, x1: number, z0: number, z1: number): boolean =>
    clearOfRoute(course, x0, x1, z0, z1, 1) && clearOfRoute(course, 2 * CX - x1, 2 * CX - x0, z0, z1, 1);
  for (let z = a.z0, i = 0; z < a.z1; z += 7, i++) {
    if (clearBoth(CX - 26, CX - 26, z, z)) b.pair((side) => b.lampPost(CX + side * 26, ground + 1, z, 3));
    if (i % 2 === 0 && clearBoth(CX - 25, CX - 21, z - 1, z + 3)) b.pair((side) => {
      const sx = side < 0 ? CX - 24 : CX + 22;
      for (const [dx, dz] of [[0, 0], [2, 0], [0, 2], [2, 2]]) b.fill(sx + dx, sx + dx, ground + 1, ground + 2, z + dz, z + dz, P.log);
      b.fill(sx - 1, sx + 3, ground + 3, ground + 3, z - 1, z + 3, i % 4 ? P.cloth : P.cloth2);
      b.put(sx + 1, ground + 1, z + 1, Block.ManorCask);
    });
  }
  // The route's own buildings: a house under every roof, a chimney under
  // every stack, a timber trestle under every plank.
  return () => {
    for (const p of a.pads) {
      if (p.kind === 'beam' || p.kind === 'rail') stilts(b, p, P.log, P.wood);
      else houseUnder(b, p, p.index % 2 ? P.roof : P.roof2);
    }
  };
};

const ropebridge: PieceBuilder = (b, a, course) => {
  const P = b.pal, floor = a.lo - 18, top = a.lo - 4;
  // The gorge: two straight, flat-topped cliffs facing each other, a river
  // on its floor, and trees along both rims.
  b.wall(CX - 9, -1, 44, a.z0 - 6, a.z1 + 6, floor - 4, top);
  b.wall(CX + 9, 1, 44, a.z0 - 6, a.z1 + 6, floor - 4, top);
  b.fill(CX - 8, CX + 8, floor - 4, floor - 1, a.z0 - 6, a.z1 + 6, P.rock);
  b.fill(CX - 8, CX + 8, floor, floor, a.z0 - 6, a.z1 + 6, P.liquid);
  for (let z = a.z0; z <= a.z1; z += 12) b.pair((side) => b.tree(CX + side * (FLANK + 2), top + 1, z, 1));
  // Handrails: a chain along each bridge on either side, strung between
  // posts on the rims.
  for (const s of stretches(a)) {
    if (s.role !== 'cross') continue;
    const start = course.platforms[s.pads[0].from] ?? s.pads[0];
    const ends = [start, s.pads[s.pads.length - 1]].map(p => Math.floor(p.x));
    const line = Math.round(mean(s.pads.map(p => p.z))), y = Math.max(...s.pads.map(p => p.y), start.y) + 1;
    for (const dz of [-4, 4]) b.whole(() => {
      for (const x of ends) { b.downTo(x, y + 1, line + dz, P.log); b.put(x, y + 2, line + dz, P.lamp); }
      b.rope(ends[0], y, line + dz, ends[1], line + dz);
    });
  }
  // Every plank and lookout stands on stilts, down to a rim or the river bed.
  return () => { for (const p of a.pads) stilts(b, p, P.log, P.wood); };
};

const aqueduct: PieceBuilder = (b, a, course) => {
  const P = b.pal, ground = a.lo - 15, zc = (a.z0 + a.z1) / 2;
  b.island(CX, zc, 38, (a.z1 - a.z0) / 2 + 6, ground, 6);
  // Colonnades down both flanks, trees between them.
  for (let z = a.z0 + 2, i = 0; z < a.z1; z += 8, i++)
    b.pair((side) => {
      const x = CX + side * FLANK;
      if (i % 2) { b.tree(x + side * 3, ground + 1, z, 1); return; }
      b.fill(x, x, ground + 1, ground + 6, z, z, P.trim);
      b.fill(x - 1, x + 1, ground + 7, ground + 7, z - 1, z + 1, P.trim);
    });
  // Arched spans carrying a water channel between the piers, following the
  // route round its corners.
  for (const [f, t] of jumps(a, course)) b.whole(() => {
    const m = Math.min(f.y, t.y), A = cellOf(f), B = cellOf(t);
    const n = Math.max(1, Math.round(Math.hypot(B.x - A.x, B.z - A.z)));
    const alongX = Math.abs(B.x - A.x) > Math.abs(B.z - A.z);
    for (let k = 0; k <= n; k++) {
      const s = k / n, x = Math.round(A.x + (B.x - A.x) * s), z = Math.round(A.z + (B.z - A.z) * s);
      const depth = Math.round(4 * (1 - Math.sin(Math.PI * s)));
      for (let d = -1; d <= 1; d++) {
        const cx = alongX ? x : x + d, cz = alongX ? z + d : z;
        b.add(cx, m - 6, cz, P.stone);
        for (let y = m - 7; y >= m - 7 - depth; y--) b.add(cx, y, cz, P.brick);
        b.add(cx, m - 5, cz, d === 0 ? P.liquid : P.trim);
      }
    }
  });
  return () => {
    for (const p of a.pads) {
      column(b, p, banded(P.stone, P.brick));
      const f = foot(p);
      b.whole(() => {
        for (let z = f.z0 - 1; z <= f.z1 + 1; z++) for (let x = f.x0 - 1; x <= f.x1 + 1; x++) b.add(x, p.y - 5, z, P.trim);
      });
    }
  };
};

const galleon: PieceBuilder = (b, a, course) => {
  const P = b.pal;
  const zs = a.z0 - 2, ze = a.z1 + 2, zc = (zs + ze) / 2, half = (ze - zs) / 2;
  const deck = a.lo - 5, hull = P.log, stripe = P.cloth2;
  // How wide the deck has to be at z to carry every pad above it.
  const need = (z: number): number => {
    let w = 0;
    for (const p of a.pads) if (Math.abs(p.z - z) <= p.depth / 2 + 1) w = Math.max(w, Math.abs(p.x - CX) + p.width / 2 + 2);
    return w;
  };
  // The hull: widest amidships, drawn in at bow and stern, rounded below.
  for (let z = zs; z <= ze; z++) {
    const u = (z - zc) / half, w = Math.max(1.5, 11 * Math.sqrt(Math.max(0, 1 - u ** 6)), need(z));
    for (let k = 0; k <= 9; k++) {
      const hw = Math.round(w * (1 - (k / 10) ** 1.6));
      if (hw < 0) break;
      for (let dx = -hw; dx <= hw; dx++) {
        const skin = Math.abs(dx) >= hw - 1 || k === 9;
        if (k === 0) b.put(CX + dx, deck, z, Math.abs(dx) === hw ? hull : P.wood);
        else if (skin) b.put(CX + dx, deck - k, z, k === 2 ? stripe : k === 9 ? P.log : hull);
      }
    }
    const hw = Math.round(w);
    b.put(CX - hw, deck + 1, z, P.wood); b.put(CX + hw, deck + 1, z, P.wood);
    if (z % 4 === 0 && hw > 3) { b.put(CX - hw - 1, deck - 1, z, P.metal); b.put(CX + hw + 1, deck - 1, z, P.metal); }
  }
  b.whole(() => { b.line(CX, deck + 1, ze, CX, deck + 5, ze + 7, P.log); b.put(CX, deck + 6, ze + 7, P.glow); });
  // Twin masts either side of the route, with yards and sails high overhead
  // and lanterns hung from the yards.
  for (const mz of [zc - half * .55, zc, zc + half * .55].map(Math.round)) {
    const t = highNear(course, CX, mz, 14, a.hi) + 16;
    b.pair((side) => {
      const mx = CX + side * 9;
      for (let y = deck + 1; y <= t; y++) b.put(mx, y, mz, P.log);
      for (const yy of [t - 7, t - 3]) {
        b.line(mx - 5, yy, mz, mx + 5, yy, mz, P.log);
        for (let x = mx - 4; x <= mx + 4; x++)
          for (let y = yy - 3; y < yy; y++) if (x !== mx) b.put(x, y, mz + 1, stripe);
      }
      b.fill(mx - 1, mx + 1, t + 1, t + 1, mz - 1, mz + 1, P.wood);
      b.put(mx, t + 2, mz, P.lamp);
      b.put(mx, t + 3, mz, P.log); b.put(mx, t + 4, mz, P.log);
      b.banner(mx + side, t + 4, mz, 2, P.cloth);
      b.chain(mx - side * 5, t - 8, mz, 2); b.put(mx - side * 5, t - 10, mz, P.lamp);
    });
  }
  for (let z = zs + 4; z < ze - 3; z += 6) b.pair((side) => b.put(CX + side * 8, deck + 1, z, Block.ManorCask));
  // Crate stacks and masts: what every pad stands on.
  return () => { for (const p of a.pads) column(b, p, p.width === 1 && p.depth === 1 ? P.log : banded(P.wood, P.log, 3)); };
};

const greattree: PieceBuilder = (b, a, course) => {
  const P = b.pal, ground = a.lo - 10, log = logOf(P), zc = (a.z0 + a.z1) / 2;
  b.island(CX, zc, 40, (a.z1 - a.z0) / 2 + 6, ground, 8);
  /** A giant: a thick trunk, roots, and a broad crown well over the route,
   *  with lanterns hung from it. */
  const giant = (x: number, z: number, crown: number, reach: number): void => {
    for (let y = ground - 2; y <= crown + 1; y++) {
      const r = y <= ground + 1 ? 4.2 : y <= ground + 3 ? 3.4 : 2.6;
      for (let dz = -5; dz <= 5; dz++) for (let dx = -5; dx <= 5; dx++)
        if (Math.hypot(dx, dz) <= r) b.put(x + dx, y, z + dz, log);
    }
    for (let i = 0; i < 8; i++) {
      const ang = i / 8 * Math.PI * 2;
      b.line(x, ground + 1, z, x + Math.cos(ang) * 8, ground, z + Math.sin(ang) * 8, log);
    }
    for (let y = crown; y <= crown + 6; y++)
      for (let dz = -reach; dz <= reach; dz++)
        for (let dx = -reach; dx <= reach; dx++)
          if (Math.hypot(dx / reach, (y - crown - 2) / 4, dz / reach) <= 1) b.put(x + dx, y, z + dz, P.leaves);
    for (let i = 0; i < 6; i++) {
      const ang = (i + .5) / 6 * Math.PI * 2;
      const hx = Math.round(x + Math.cos(ang) * (reach - 3)), hz = Math.round(z + Math.sin(ang) * (reach - 3));
      let y = crown;
      while (y < crown + 6 && b.get(hx, y, hz) !== P.leaves) y++;
      if (b.get(hx, y, hz) !== P.leaves) continue;
      b.chain(hx, y - 1, hz, 1);
      b.put(hx, y - 2, hz, P.lamp);
    }
  };
  // Giants in the middle, between the crossings, and in pairs on the flanks.
  const across = stretches(a).filter(s => s.role === 'cross').map(s => Math.round(mean(s.pads.map(p => p.z))));
  for (let i = 0; i + 1 < across.length; i++) {
    const z = Math.round((across[i] + across[i + 1]) / 2);
    const crown = highNear(course, CX, z, 12, a.hi) + 9;
    if (clearOfRoute(course, CX - 4, CX + 4, z - 4, z + 4, 3)) b.whole(() => giant(CX, z, crown, 11));
  }
  for (let z = a.z0 + 10; z < a.z1 - 4; z += 24) {
    const crown = highNear(course, CX, z, 40, a.hi) + 4;
    b.pair((side) => giant(CX + side * (FLANK + 4), z, crown, 7));
  }
  for (let z = a.z0 + 2; z < a.z1; z += 9) b.pair((side) => b.tree(CX + side * (FLANK - 5), ground + 1, z, .8));
  // Every pad is the crown of a tree of its own.
  return () => { for (const p of a.pads) treeUnder(b, p); };
};

const clocktower: PieceBuilder = (b, a, course) => {
  const P = b.pal, ground = a.lo - 10, zc = Math.round((a.z0 + a.z1) / 2);
  b.island(CX, zc, 40, (a.z1 - a.z0) / 2 + 6, ground, 7, Block.ManorPaving);
  // Twin clock towers on the flanks, joined by an arch high over the route.
  const hx = 4, hz = 5, top = a.hi + 12;
  b.whole(() => {
    for (const side of [-1, 1]) {
      const tx = CX + side * (FLANK + 2);
      for (let y = ground + 1; y <= top; y++)
        for (let z = zc - hz; z <= zc + hz; z++)
          for (let x = tx - hx; x <= tx + hx; x++) {
            const edge = x === tx - hx || x === tx + hx || z === zc - hz || z === zc + hz;
            if (!edge) continue;
            const corner = (x === tx - hx || x === tx + hx) && (z === zc - hz || z === zc + hz);
            const win = !corner && (y - ground) % 4 === 2 && (z === zc || x === tx);
            b.put(x, y, z, corner ? P.trim : (y - ground) % 6 === 0 ? P.brick : win ? P.glass : P.stone);
          }
      const fy = top - 4;
      const face = (at: (u: number, v: number) => [number, number, number]) => {
        for (let v = -2; v <= 2; v++) for (let u = -2; u <= 2; u++) {
          if (Math.abs(u) === 2 && Math.abs(v) === 2) continue;
          const [x, y, z] = at(u, v);
          b.put(x, y, z, u === 0 && v === 0 ? P.glow : P.trim);
        }
        const [hx0, hy0, hz0] = at(0, 1), [hx1, hy1, hz1] = at(1, 0);
        b.put(hx0, hy0, hz0, P.metal); b.put(hx1, hy1, hz1, P.metal);
      };
      face((u, v) => [tx + u * side, fy + v, zc - hz - 1]);
      face((u, v) => [tx - u * side, fy + v, zc + hz + 1]);
      face((u, v) => [tx + side * (hx + 1), fy + v, zc + u]);
      face((u, v) => [tx - side * (hx + 1), fy + v, zc - u]);
      for (let k = 0; k <= hx + 1; k++)
        b.fill(tx - (hx + 1 - k), tx + (hx + 1 - k), top + 1 + k, top + 1 + k, zc - (hz + 1 - k), zc + (hz + 1 - k), P.roof2);
      b.fill(tx, tx, top + hx + 3, top + hx + 5, zc, zc, P.trim);
      b.put(tx, top + hx + 6, zc, P.lamp);
    }
    const ax = CX + FLANK + 2 - hx - 1;
    b.fill(CX - ax + CX, ax, top - 1, top, zc - 1, zc + 1, P.brick);
    b.fill(CX - ax + CX, ax, top + 1, top + 1, zc - 1, zc + 1, P.trim);
    for (let x = CX - ax + CX; x <= ax; x += 2) b.put(x, top + 2, zc, P.trim);
    // A great pendulum hanging from the middle of the arch.
    b.chain(CX, top - 2, zc, 2);
    b.fill(CX - 1, CX + 1, top - 4, top - 4, zc, zc, P.metal);
  });
  for (let z = a.z0 + 2; z < a.z1; z += 8) b.pair((side) => b.lampPost(CX + side * (FLANK - 6), ground + 1, z, 3));
  // Every pad is a gear platform on its own column, a toothed wheel under it.
  return () => {
    for (const p of a.pads) {
      column(b, p, banded(P.stone, P.trim, 4));
      const { x, z } = cellOf(p), r = Math.max(p.width, p.depth) / 2 + 1;
      b.whole(() => {
        for (let dz = -Math.ceil(r); dz <= Math.ceil(r); dz++)
          for (let dx = -Math.ceil(r); dx <= Math.ceil(r); dx++) {
            const d = Math.hypot(dx, dz);
            if (d <= r + .3 && (d > r - .8 || dx === 0 || dz === 0)) b.add(x + dx, p.y - 5, z + dz, P.metal);
          }
      });
    }
  };
};

const cavern: PieceBuilder = (b, a, course) => {
  const P = b.pal, ground = a.lo - 10, top = (a.sec.ceiling ?? a.hi + 16) - 5;
  // A whole mountain in smooth terraces, on a rock base that reaches past
  // both ends of the piece; the route's boxes cut its passage.
  const zc = (a.z0 + a.z1) / 2, rz = (a.z1 - a.z0) / 2 + 2;
  b.island(CX, zc, 38, rz + 6, ground, 6, P.rock);
  for (let z = a.z0 + 3; z <= a.z1 - 1; z++)
    for (let x = CX - 26; x <= CX + 26; x++) {
      const d = Math.hypot((x - CX) / 26, (z - zc) / rz);
      if (d > 1) continue;
      const h = ground + Math.round((top - ground) * Math.min(1, (1 - d * d) * 1.6) / 2) * 2;
      for (let y = ground - Math.round(4 * (1 - d)); y <= h; y++)
        b.put(x, y, z, y === h ? P.soil : (h - y) % 5 === 4 ? P.brick : P.rock);
    }
  // Crystal spires in pairs along the ridge.
  for (let z = a.z0 + 10; z < a.z1 - 6; z += 12)
    b.pair((side) => {
      const x = CX + side * 17;
      let y = top;
      while (y > ground && !SOLID[b.get(x, y, z)]) y--;
      for (let k = 1; k <= 5; k++) b.put(x, y + k, z, Block.ParkourCrystalBlock);
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { b.put(x + dx, y + 1, z + dz, Block.ParkourCrystalBlock); b.put(x + dx, y + 2, z + dz, Block.ParkourCrystalBlock); }
    });
  void course;
  return () => { for (const p of a.pads) rockUnder(b, p); };
};

const waterfall: PieceBuilder = (b, a, course) => {
  const P = b.pal, ground = a.lo - 13, W = 27;
  const zc = (a.z0 + a.z1) / 2;
  b.island(CX, zc, W + 8, (a.z1 - a.z0) / 2 + 6, ground, 6, P.rock);
  // Canyon walls on both flanks.
  b.wall(CX - W, -1, 20, a.z0 - 6, a.z1 + 6, ground, a.hi + 8);
  b.wall(CX + W, 1, 20, a.z0 - 6, a.z1 + 6, ground, a.hi + 8);
  // A river under every crossing, each on its own terrace of the canyon:
  // the stepping stones stand in it, falls pour into it from both walls,
  // and where the next terrace is lower it spills over the lip in a curtain.
  const rivers = stretches(a).filter(s => s.role === 'cross').map(s => {
    const from = course.platforms[s.pads[0].from] ?? s.pads[0];
    return { line: Math.round(mean(s.pads.map(p => p.z))), wy: Math.min(...s.pads.map(p => p.y), from.y) - 4 };
  });
  let z0 = a.z0 - 6;
  rivers.forEach((rv, i) => {
    const z1 = i === rivers.length - 1 ? a.z1 + 6 : rv.line + 4;
    for (let z = z0; z <= z1; z++)
      for (let x = CX - W + 1; x <= CX + W - 1; x++) {
        const channel = Math.abs(z - rv.line) <= 3;
        for (let y = ground + 1; y < rv.wy; y++) b.put(x, y, z, (rv.wy - y) % 5 === 0 ? P.brick : P.rock);
        b.put(x, rv.wy, z, channel ? P.liquid : P.soil);
      }
    // The falls off both canyon walls, into the ends of the river.
    for (const x of [CX - W + 1, CX + W - 1])
      for (let z = rv.line - 2; z <= rv.line + 2; z++) for (let y = rv.wy + 1; y <= a.hi + 8; y++) b.put(x, y, z, P.liquid);
    const next = rivers[i + 1];
    if (next && next.wy < rv.wy - 1)
      for (let x = CX - W + 2; x <= CX + W - 2; x++) for (let y = next.wy + 1; y <= rv.wy; y++) b.put(x, y, z1 + 1, P.liquid);
    z0 = z1 + 1;
  });
  if (!rivers.length) b.fill(CX - W + 1, CX + W - 1, ground + 1, ground + 1, a.z0 - 6, a.z1 + 6, P.liquid);
  // Trees along both rims.
  for (let z = a.z0; z <= a.z1; z += 10) b.pair((side) => b.tree(CX + side * (W + 6), a.hi + 9, z, 1));
  // Every stone is a rock standing in the river; every ledge a rock too.
  return () => { for (const p of a.pads) rockUnder(b, p); };
};

const shrine: PieceBuilder = (b, a, course) => {
  const P = b.pal, ground = a.lo - 5;
  const zc = (a.z0 + a.z1) / 2, rz = (a.z1 - a.z0) / 2 + 6;
  b.island(CX, zc, 40, rz, ground, 8);
  // A pond the stepping stones stand in.
  for (let z = a.z0 - 3; z <= a.z1 + 3; z++)
    for (let x = CX - 25; x <= CX + 25; x++) {
      if (Math.hypot((x - CX) / 25, (z - zc) / (rz - 2)) > 1) continue;
      b.put(x, ground, z, P.liquid);
      b.put(x, ground - 1, z, P.rock);
    }
  // Stone lanterns round the pond, pagodas on each bank, cherry trees.
  for (let z = a.z0; z <= a.z1; z += 6)
    b.pair((side) => {
      const x = CX + side * 28;
      b.put(x, ground + 1, z, P.trim); b.put(x, ground + 2, z, P.trim);
      b.put(x, ground + 3, z, P.lamp);
      b.fill(x - 1, x + 1, ground + 4, ground + 4, z - 1, z + 1, P.roof2);
    });
  const pz = Math.round(zc);
  b.pair((side) => {
    const px = CX + side * (FLANK + 4);
    let y = ground + 1;
    for (let tier = 0; tier < 4; tier++) {
      const r = 4 - tier;
      for (let k = 0; k < 4; k++, y++)
        for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
          if (Math.abs(dx) !== r && Math.abs(dz) !== r) continue;
          const corner = Math.abs(dx) === r && Math.abs(dz) === r;
          b.put(px + dx, y, pz + dz, corner ? P.cloth : k === 2 && (dx === 0 || dz === 0) ? P.glass : P.wood);
        }
      b.fill(px - r - 2, px + r + 2, y, y, pz - r - 2, pz + r + 2, P.roof2);
      for (const [dx, dz] of [[-r - 2, -r - 2], [r + 2, -r - 2], [-r - 2, r + 2], [r + 2, r + 2]]) b.put(px + dx, y + 1, pz + dz, P.roof2);
      y++;
    }
    b.fill(px, px, y, y + 3, pz, pz, P.trim);
    b.put(px, y + 4, pz, P.lamp);
  });
  for (let z = a.z0 + 3; z < a.z1; z += 14) b.pair((side) => b.tree(CX + side * (FLANK + 5), ground + 1, z + 7, 1));
  // Stones out of the pond; on the banks, plinths of dressed stone.
  void course;
  return () => {
    for (const p of a.pads) {
      if (p.kind === 'stones' || p.kind === 'pillar' || p.kind === 'blink') rockUnder(b, p);
      else column(b, p, banded(P.trim, P.stone, 3));
    }
  };
};

const mine: PieceBuilder = (b, a, course) => {
  const P = b.pal, ground = a.lo - 10, top = a.hi + 9;
  const mz = Math.round((a.z0 + a.z1) / 2);
  b.island(CX, (a.z0 + a.z1) / 2, 40, (a.z1 - a.z0) / 2 + 5, ground, 6, P.rock);
  // Mountain walls either side, each with a timbered mine mouth.
  b.wall(CX - 25, -1, 20, a.z0 - 4, a.z1 + 4, ground - 3, top);
  b.wall(CX + 25, 1, 20, a.z0 - 4, a.z1 + 4, ground - 3, top);
  for (let z = mz - 2; z <= mz + 2; z++) for (let k = 0; k < 7; k++) for (let y = ground + 1; y <= ground + 5; y++) {
    b.clear(CX - 25 - k, y, z); b.clear(CX + 25 + k, y, z);
  }
  b.pair((side) => {
    const x = CX + side * 25;
    for (const dz of [-3, 3]) b.fill(x, x, ground + 1, ground + 6, mz + dz, mz + dz, P.log);
    b.fill(x, x, ground + 6, ground + 6, mz - 3, mz + 3, P.log);
    b.put(x - side, ground + 5, mz, P.lamp);
  });
  // Rails from each mine mouth along the valley floor, with carts.
  b.pair((side) => {
    for (let z = a.z0; z <= a.z1; z++) { b.put(CX + side * 20, ground + 1, z, P.metal); b.put(CX + side * 22, ground + 1, z, P.metal); }
    for (let z = a.z0 + 5; z < a.z1; z += 17) {
      b.fill(CX + side * 20, CX + side * 22, ground + 2, ground + 3, z, z + 2, P.wood);
      b.fill(CX + side * 21, CX + side * 21, ground + 3, ground + 3, z, z + 2, P.glow);
    }
  });
  for (let z = a.z0 + 2; z < a.z1; z += 8) b.pair((side) => b.lampPost(CX + side * 18, ground + 1, z, 3));
  // Timber scaffolding under every pad: corner posts and cross-braces.
  void course;
  return () => { for (const p of a.pads) stilts(b, p, P.log, P.wood); };
};

const foundry: PieceBuilder = (b, a, course) => {
  const P = b.pal, ground = a.lo - 9;
  const molten = P.liquid === Block.Water ? Block.FurnaceCeramic : P.liquid;
  b.island(CX, (a.z0 + a.z1) / 2, 40, (a.z1 - a.z0) / 2 + 5, ground, 6, P.rock);
  // A molten channel down the middle of the floor.
  for (let z = a.z0 - 4; z <= a.z1 + 4; z++) {
    b.fill(CX - 3, CX + 3, ground, ground, z, z, molten);
    b.put(CX - 4, ground + 1, z, P.metal); b.put(CX + 4, ground + 1, z, P.metal);
  }
  // Furnaces either side, their chimneys, and a gantry between the chimneys
  // high over the route.
  for (let z = a.z0 + 6; z < a.z1 - 2; z += 26) {
    const hi = highNear(course, CX, z, 24, a.hi);
    b.whole(() => {
      for (const side of [-1, 1]) {
        const x = CX + side * 24;
        for (let y = ground + 1; y <= hi + 6; y++)
          for (let dz = -3; dz <= 3; dz++) for (let dx = -3; dx <= 3; dx++) {
            if (Math.abs(dx) !== 3 && Math.abs(dz) !== 3) continue;
            const win = (y - ground) % 5 === 3 && (dx === 0 || dz === 0);
            b.put(x + dx, y, z + dz, win ? P.glow : (y - ground) % 5 === 0 ? P.trim : P.brick);
          }
        b.fill(x - 3, x + 3, hi + 7, hi + 7, z - 3, z + 3, P.trim);
        for (let y = hi + 8; y <= hi + 20; y++) b.fill(x - 1, x + 1, y, y, z - 1, z + 1, y % 4 === 0 ? P.trim : P.stone);
      }
      b.fill(CX - 23, CX + 23, hi + 12, hi + 12, z, z, P.metal);
      b.fill(CX - 23, CX + 23, hi + 13, hi + 13, z, z, P.trim);
      for (let x = CX - 20; x <= CX + 20; x += 8) { b.chain(x, hi + 11, z, 3); b.put(x, hi + 8, z, P.lamp); }
    });
  }
  for (let z = a.z0; z < a.z1; z += 8) b.pair((side) => b.fill(CX + side * 30, CX + side * 31, ground + 1, ground + 2, z, z + 1, P.metal));
  return () => { for (const p of a.pads) column(b, p, banded(P.metal, P.trim, 4)); };
};

const BUILDERS: Record<ParkourSection['piece'], PieceBuilder> = {
  ramparts, rooftops, ropebridge, aqueduct, galleon, greattree, clocktower, cavern, waterfall, shrine, mine, foundry,
};

// ── The route's clearance ──────────────────────────────────────────────────

/** Column → flat [y0, y1, y0, y1, …] intervals. */
type Intervals = Map<number, number[]>;
function mark(map: Intervals, x0: number, x1: number, z0: number, z1: number, y0: number, y1: number): void {
  y0 = Math.max(MIN_Y, y0); y1 = Math.min(MAX_Y, y1);
  if (y1 < y0) return;
  for (let z = Math.max(0, z0); z <= Math.min(Z - 1, z1); z++)
    for (let x = Math.max(0, x0); x <= Math.min(X - 1, x1); x++) {
      const c = z * X + x;
      let list = map.get(c);
      if (!list) map.set(c, list = []);
      list.push(y0, y1);
    }
}
function within(list: number[], y: number): boolean {
  for (let i = 0; i < list.length; i += 2) if (y >= list[i] && y <= list[i + 1]) return true;
  return false;
}

/** Apply the route rule (see the file header). A structure that breaks it
 *  anywhere is removed whole, with its twin; terrain is cut. `route` marks
 *  the route's own solid cells. */
function clearRoute(b: Builder, course: ParkourCourse, route: Uint8Array): void {
  const hard: Intervals = new Map(), inner: Intervals = new Map(), band: Intervals = new Map();
  for (const s of course.spaces) {
    const B = s.box;
    mark(inner, B.x0, B.x1, B.z0, B.z1, B.y0 - 1, B.y1);
    if (s.pad) {
      mark(hard, B.x0, B.x1, B.z0, B.z1, B.y0, B.y1 + 2);
      mark(hard, B.x0 - 1, B.x1 + 1, B.z0 - 1, B.z1 + 1, s.lo - 3, B.y1 + 2);
    } else {
      mark(hard, B.x0 - 1, B.x1 + 1, B.z0 - 1, B.z1 + 1, s.lo - 3, s.hi + 5);
    }
    mark(band, B.x0 - 5, B.x1 + 5, B.z0 - 5, B.z1 + 5, s.lo - 3, s.hi);
  }
  const { cells, owner } = b;
  // A pad's own support — the solid column straight down from under its
  // surface — is part of the pad, not something beside the jump.
  const support = new Uint8Array(cells.length);
  for (const p of course.platforms) {
    const fx0 = Math.floor(p.x - p.width / 2), fz0 = Math.floor(p.z - p.depth / 2);
    for (let x = fx0; x < fx0 + p.width; x++)
      for (let z = fz0; z < fz0 + p.depth; z++)
        for (let y = p.y - 2; y > MIN_Y; y--) {
          const k = key(x, y, z);
          if (!SOLID[cells[k]] && !route[k]) break;
          support[k] = 1;
        }
  }
  const doomed = new Set<number>();
  /** A cell that breaks the rule: terrain is cut, a structure condemned. */
  const breaks = (k: number): void => {
    if (owner[k]) {
      doomed.add(owner[k]);
      const twin = b.twin.get(owner[k]);
      if (twin) doomed.add(twin);
    } else cells[k] = Block.Air;
  };
  // Removing a structure can bare a top underneath it, so judge again after.
  for (let pass = 0; pass < 4; pass++) {
    doomed.clear();
    for (const [c, list] of inner)
      for (let i = 0; i < list.length; i += 2)
        for (let y = list[i]; y <= list[i + 1]; y++) {
          const k = c * H + (y - MIN_Y);
          if (cells[k] && !PHYSICAL[cells[k]] && !support[k]) breaks(k);
        }
    for (const [c, list] of hard)
      for (let i = 0; i < list.length; i += 2)
        for (let y = list[i]; y <= list[i + 1]; y++) {
          const k = c * H + (y - MIN_Y);
          if (PHYSICAL[cells[k]] && !support[k]) breaks(k);
        }
    // Standable tops inside the band, judged top down so the block under a
    // removed one is judged as the new top.
    for (const [c, list] of band) {
      let lo = MAX_Y, hi = MIN_Y;
      for (let i = 0; i < list.length; i += 2) { lo = Math.min(lo, list[i]); hi = Math.max(hi, list[i + 1]); }
      for (let y = hi; y >= lo; y--) {
        const k = c * H + (y - MIN_Y);
        if (!SOLID[cells[k]] || support[k] || !within(list, y)) continue;
        const above = k + 1;
        const covered = y < MAX_Y && (route[above] || SOLID[cells[above]]);
        if (!covered) breaks(k);
      }
    }
    if (!doomed.size) break;
    for (let k = 0; k < cells.length; k++) {
      if (!cells[k] || !doomed.has(owner[k])) continue;
      // A pad's support column is never taken out with the structure round it.
      if (support[k]) owner[k] = 0;
      else { cells[k] = Block.Air; owner[k] = 0; }
    }
  }
}

/** Sweep away anything left floating on its own: groups of touching blocks
 *  that are small and touch nothing on the route. */
function sweepStrays(cells: Uint8Array, route: Uint8Array): void {
  const seen = new Uint8Array(cells.length);
  let stack = new Int32Array(1 << 16);
  const group: number[] = [];
  for (let start = 0; start < cells.length; start++) {
    if (!cells[start] || seen[start] || route[start]) continue;
    let top = 0;
    group.length = 0;
    stack[top++] = start; seen[start] = 1;
    let anchored = false;
    while (top) {
      const k = stack[--top];
      // At the limit it is no stray: keep marking it seen, stop recording.
      if (group.length < STRAY_LIMIT) group.push(k);
      if (group.length >= STRAY_LIMIT) anchored = true;
      const y = k % H, c = (k - y) / H, x = c % X, z = (c - x) / X;
      for (let d = 0; d < 6; d++) {
        let n: number;
        switch (d) {
          case 0: if (x === 0) continue; n = k - H; break;
          case 1: if (x === X - 1) continue; n = k + H; break;
          case 2: if (z === 0) continue; n = k - X * H; break;
          case 3: if (z === Z - 1) continue; n = k + X * H; break;
          case 4: if (y === 0) continue; n = k - 1; break;
          default: if (y === H - 1) continue; n = k + 1;
        }
        if (seen[n] || !cells[n]) continue;
        if (route[n]) { anchored = true; continue; }
        seen[n] = 1;
        if (top === stack.length) { const grown = new Int32Array(stack.length * 2); grown.set(stack); stack = grown; }
        stack[top++] = n;
      }
    }
    if (!anchored) for (const k of group) cells[k] = Block.Air;
  }
}

// ── Lair and sanctuary ─────────────────────────────────────────────────────

/** The mountain behind the start, with the dragon's cave in it, and the
 *  rock the start terrace stands on. */
function lair(b: Builder, course: ParkourCourse): void {
  const P = b.pal, s = course.start, sy = s.y, cz = 11;
  const ground = sy - 14;
  for (let z = 0; z <= cz; z++)
    for (let x = CX - 30; x <= CX + 30; x++) {
      const v = (x - CX) / 30, u = (cz - z) / 14;
      const h = Math.round(sy + 14 - v * v * 16 + u * 4);
      if (h < ground) continue;
      for (let y = ground - Math.round((1 - Math.abs(v)) * 6); y <= h; y++)
        b.put(x, y, z, y === h ? P.soil : (h - y) % 5 === 4 ? P.brick : P.rock);
    }
  // The start pad and its terrace sit on a spur of the mountain.
  const sz = Math.floor(s.z), sx = Math.floor(s.x);
  for (let z = cz + 1; z <= sz + 2; z++)
    for (let x = sx - 3; x <= sx + 3; x++) {
      // Under the terrace (which stops a block short of the pad), and under
      // the pad's own footprint — never beside it.
      if (z === sz - 3 || (z >= sz - 2 && Math.abs(x - sx) > 2)) continue;
      const under = 12 - Math.round((z - cz) / 3);
      for (let y = sy - 1 - under; y < sy - 1; y++) b.put(x, y, z, (sy - y) % 4 === 0 ? P.brick : P.rock);
    }
  for (const x of [CX - 16, CX + 16]) b.tree(x, sy + 14 - Math.round(((x - CX) / 30) ** 2 * 16) + 3, 6, 1);
  // The cave: a great arched mouth and the dragon's hoard.
  for (let z = 0; z <= cz; z++)
    for (let x = CX - 8; x <= CX + 8; x++)
      for (let y = sy - 1; y <= sy + 10; y++) {
        const dx = x - CX, arch = sy + 6 + Math.sqrt(Math.max(0, 64 - dx * dx)) * .5;
        if (y > arch) continue;
        if (y === sy - 1) b.put(x, y, z, (x + z) % 3 === 0 ? P.trim : P.rock);
        else b.clear(x, y, z);
      }
  for (let z = 1; z <= 5; z++) for (let x = CX - 6; x <= CX + 6; x++) {
    const h = Math.max(0, 2 - Math.floor(Math.hypot((x - CX) / 3, (z - 3) / 1.5)));
    for (let y = sy; y < sy + h; y++) b.put(x, y, z, (x + y) % 2 ? Block.ManorGilt : Block.GildedVaultBrick);
  }
  for (const x of [CX - 9, CX + 9]) { b.put(x, sy, cz, P.lamp); b.put(x, sy + 5, cz + 1, P.lamp); }
}

/** A walled courtyard round the finish, with its podium. */
function sanctuary(b: Builder, course: ParkourCourse): void {
  const P = b.pal, f = course.finish, fx = Math.floor(f.x), fz = Math.floor(f.z), fy = f.y;
  const z0 = fz - 2, z1 = Math.min(Z - 3, fz + 24), hx = 12;
  // Its rock starts at the finish pad's front edge: nothing here reaches back
  // under the last jump.
  for (let z = z0; z <= z1 + 1; z++)
    for (let x = fx - hx - 2; x <= fx + hx + 2; x++) {
      const d = Math.max(Math.abs(x - fx) / (hx + 2), Math.abs(z - (z0 + z1) / 2) / ((z1 - z0) / 2 + 1));
      const under = Math.round(10 * Math.sqrt(Math.max(0, 1 - d * d))) + 1;
      for (let y = fy - 1 - under; y < fy - 1; y++) b.put(x, y, z, P.rock);
    }
  for (let z = z0; z <= z1; z++)
    for (let x = fx - hx; x <= fx + hx; x++)
      b.put(x, fy - 1, z, (Math.abs(x - fx) + (z - fz)) % 4 === 0 ? P.trim : P.brick);
  for (let y = fy; y <= fy + 4; y++) {
    for (let z = z0 + 2; z <= z1; z++) { b.put(fx - hx, y, z, P.stone); b.put(fx + hx, y, z, P.stone); }
    for (let x = fx - hx; x <= fx + hx; x++) b.put(x, y, z1, P.stone);
  }
  for (let z = z0 + 2; z <= z1; z += 2) { b.put(fx - hx, fy + 5, z, P.trim); b.put(fx + hx, fy + 5, z, P.trim); }
  for (const [x, z] of [[fx - hx, z1], [fx + hx, z1], [fx - hx, z0 + 2], [fx + hx, z0 + 2]])
    b.tower(x, z, 2.2, fy, fy + 9, { roof: P.roof });
  // The gate the finishers run through.
  for (const x of [fx - 5, fx + 5]) { b.fill(x, x, fy - 4, fy + 7, z0 - 1, z0 - 1, P.trim); b.put(x, fy + 8, z0 - 1, P.lamp); }
  b.fill(fx - 5, fx + 5, fy + 7, fy + 7, z0 - 1, z0 - 1, Block.GildedVaultBrick);
  b.fill(fx - 3, fx + 3, fy + 8, fy + 8, z0 - 1, z0 - 1, Block.GildedVaultBrick);
  b.put(fx, fy + 9, z0 - 1, Block.RuneGlass);
  for (const x of [fx - 5, fx + 5]) b.put(x, fy + 8, z0 - 2, P.lamp);
  // The podium: gold in the middle, silver either side, bronze either side
  // of those — the same on both sides.
  const mats = [Block.ManorGilt, Block.ManorPewter, Block.ManorPewter, Block.ManorBronzeTile];
  course.podium.forEach((spot, i) => {
    const x = Math.floor(spot.x), z = Math.floor(spot.z);
    for (const sx of [x, 2 * fx - x]) b.fill(sx - 1, sx + 1, fy, spot.y - 1, z - 1, z + 1, mats[i]);
  });
  // A fountain behind the podium, and lamps along the walls.
  const bz = Math.min(z1 - 5, Math.floor(course.podium[0].z) + 7);
  b.fill(fx - 3, fx + 3, fy, fy, bz - 2, bz + 2, P.trim);
  b.fill(fx - 2, fx + 2, fy, fy, bz - 1, bz + 1, P.liquid);
  b.fill(fx, fx, fy, fy + 3, bz, bz, P.trim);
  b.put(fx, fy + 4, bz, P.glow);
  for (let z = z0 + 4; z < z1; z += 5) { b.lampPost(fx - hx + 2, fy, z, 2); b.lampPost(fx + hx - 2, fy, z, 2); }
}

// ── The venue ──────────────────────────────────────────────────────────────

/** Scenery and route for a seed, stamped and packed. */
export function parkourVenue(seed: number): ParkourVenue {
  const course = parkourCourse(seed);
  const b = new Builder(seed ^ 0x5ce4e, parkourTheme(seed).palette);
  const dress: (() => void)[] = [];
  course.sections.forEach((sec, index) => {
    const pads = course.platforms.filter(p => p.section === index);
    if (!pads.length) return;
    // Heights reach a little past the piece's own pads: its ground sits
    // under its neighbours' ends too, so the route rule never has to carve
    // away what a pad stands on.
    const near = course.platforms.filter(p => p.section === index ||
      (p.z >= sec.z0 - 14 && p.z <= sec.z1 + 14 && p !== course.finish));
    const ys = near.map(p => p.y);
    const area: Area = {
      index, sec, pads,
      x0: Math.min(...pads.map(p => foot(p).x0)), x1: Math.max(...pads.map(p => foot(p).x1)),
      z0: Math.min(sec.z0, ...pads.map(p => foot(p).z0)), z1: Math.max(sec.z1, ...pads.map(p => foot(p).z1)),
      lo: Math.min(...ys), hi: Math.max(...ys),
    };
    dress.push(BUILDERS[sec.piece](b, area, course));
  });
  for (const d of dress) d();
  // The run-in to the finish stands on plain piers.
  for (const p of course.platforms)
    if (p.section < 0 && p !== course.start && p !== course.finish) column(b, p, banded(b.pal.stone, b.pal.brick));
  const route = new Uint8Array(LAYER * H);
  for (const c of course.cells) if (c.block !== Block.Air && b.inside(c.x, c.y, c.z)) route[key(c.x, c.y, c.z)] = 1;
  clearRoute(b, course, route);
  // The lair and the sanctuary are built round the start and the finish
  // themselves, after the route rule: they are where you stand, not jumps.
  lair(b, course);
  sanctuary(b, course);
  for (const c of course.cells) if (b.inside(c.x, c.y, c.z)) b.cells[key(c.x, c.y, c.z)] = c.block;
  sweepStrays(b.cells, route);
  return pack(b.cells);
}
