// Parkour course generation.
//
// A course is MODE × LAYOUT × DECK × THEME, every one of them read out of the
// arena seed, so the client, the server and the smoke tests all build the
// identical course from the one number they already share:
//
//   mode    what winning means — a race to the arch, a climb ahead of a rising
//           void, or a run ahead of a course that deletes itself behind you.
//   layout  the shape the route takes through the venue: a lane, switchbacks,
//           a spiral tower, twin towers, forks, wandering islands, a descent.
//   deck    the five jump types this course draws from, so two courses on the
//           same layout still ask for completely different skills.
//   theme   materials and sky only (parkour_themes.ts).
//
// Every jump is sized from one physics budget (`parkourTravel`) and every
// platform is checked against every earlier one — and against every earlier
// jump's flight path — before it is kept. scripts/parkour_smoke.ts then flies
// each jump with the real Player class.
import { Block } from './blocks';
import { PARTY_FLOOR_Y, partyHash, type PartyVec3 } from './partygames';
import { parkourTheme } from './parkour_themes';

// ── Variant ────────────────────────────────────────────────────────────────

export type ParkourMode = 'race' | 'void' | 'collapse';
export type ParkourLayout = 'lane' | 'switchback' | 'spiral' | 'twin' | 'forked' | 'islands' | 'descent';
export const PARKOUR_MODES: readonly ParkourMode[] = ['race', 'void', 'collapse'];
export const PARKOUR_LAYOUTS: readonly ParkourLayout[] = ['lane', 'switchback', 'spiral', 'twin', 'forked', 'islands', 'descent'];
/** A tower is only worth climbing when something is chasing you up it, and a
 *  course that deletes itself needs somewhere flat to run. */
export const PARKOUR_MODE_LAYOUTS: Record<ParkourMode, readonly ParkourLayout[]> = {
  race: ['lane', 'switchback', 'forked', 'islands', 'descent'],
  void: ['switchback', 'spiral', 'twin'],
  collapse: ['lane', 'switchback', 'forked', 'islands', 'descent'],
};
export const PARKOUR_MODE_INFO: Record<ParkourMode, { title: string; rule: string }> = {
  race: { title: 'SPRINT RACE', rule: 'First to the finish arch wins. Gold pads save your run — R takes you back to the last one.' },
  void: { title: 'RISING VOID', rule: 'The void is climbing. Reach the summit first, or be the last one still above it.' },
  collapse: { title: 'COLLAPSE CHASE', rule: 'The course falls apart behind you. Three lives — outrun the collapse to the arch.' },
};
export const PARKOUR_LAYOUT_TITLE: Record<ParkourLayout, string> = {
  lane: 'STRAIGHT LANE', switchback: 'SWITCHBACKS', spiral: 'SPIRAL TOWER', twin: 'TWIN TOWERS',
  forked: 'FORKED ROUTES', islands: 'SKY ISLANDS', descent: 'THE DESCENT',
};

export type ParkourJump =
  | 'pad' | 'wide' | 'landing' | 'pillar' | 'beam' | 'rail' | 'step' | 'drop' | 'hurdle' | 'gate' | 'stones'
  // Obstacle pads: the jump that REACHES them is an ordinary jump; what makes
  // them hard is getting across the pad itself to the take-off lip.
  | 'wall' | 'slalom' | 'tunnel' | 'pit' | 'teeth'
  // Shape-only newcomers: climbing stones, a window in a wall to jump through,
  // and a one-block ledge hugging a wall.
  | 'ladder' | 'window' | 'ledge'
  // Route furniture for Forked Routes.
  | 'fork' | 'join'
  // Mechanics. Each is an ordinary solid block that the client, the server
  // and the smoke recognise by POSITION (never by block id alone), so nothing
  // a player places can ever pretend to be one.
  | 'launch' | 'boost' | 'blink' | 'crumble';

export interface ParkourDeck { id: string; title: string; kinds: readonly ParkourJump[] }
export const PARKOUR_DECKS: readonly ParkourDeck[] = [
  { id: 'technical', title: 'TECHNICAL', kinds: ['stones', 'beam', 'rail', 'pillar', 'window'] },
  { id: 'speed', title: 'SPEED', kinds: ['boost', 'pad', 'hurdle', 'gate', 'drop'] },
  { id: 'obstacle', title: 'OBSTACLE RUN', kinds: ['wall', 'slalom', 'tunnel', 'teeth', 'pit'] },
  { id: 'chaos', title: 'CHAOS', kinds: ['blink', 'crumble', 'launch', 'stones', 'boost'] },
  { id: 'precision', title: 'PRECISION', kinds: ['pillar', 'stones', 'ladder', 'rail', 'ledge'] },
  { id: 'hazard', title: 'HAZARD', kinds: ['crumble', 'blink', 'pit', 'beam', 'teeth'] },
  { id: 'ascent', title: 'ASCENT', kinds: ['ladder', 'launch', 'step', 'pillar', 'ledge'] },
  { id: 'flow', title: 'FLOW', kinds: ['pad', 'step', 'gate', 'window', 'boost'] },
];

export interface ParkourVariant {
  theme: number;
  mode: ParkourMode;
  layout: ParkourLayout;
  deck: ParkourDeck;
}

/** Seed bits: 0-2 theme, 3-4 mode, 5-7 layout, the rest is the course itself.
 *  An out-of-range pick folds onto a legal one, so ANY seed is a real course. */
export function parkourVariant(seed: number): ParkourVariant {
  const s = seed >>> 0;
  const mode = PARKOUR_MODES[((s >>> 3) & 3) % PARKOUR_MODES.length];
  const allowed = PARKOUR_MODE_LAYOUTS[mode];
  const wanted = PARKOUR_LAYOUTS[((s >>> 5) & 7) % PARKOUR_LAYOUTS.length];
  const layout = allowed.includes(wanted) ? wanted : allowed[((s >>> 5) & 7) % allowed.length];
  return { theme: s & 7, mode, layout, deck: PARKOUR_DECKS[partyHash(s, 0xdec) % PARKOUR_DECKS.length] };
}
/** Write a mode, layout and theme into the low byte of a seed. */
export function encodeParkourSeed(seed: number, theme: number, mode: ParkourMode, layout: ParkourLayout): number {
  return ((seed & ~0xff) | (PARKOUR_LAYOUTS.indexOf(layout) << 5) | (PARKOUR_MODES.indexOf(mode) << 3) | (theme & 7)) >>> 0;
}

// ── Course model ───────────────────────────────────────────────────────────

export interface ParkourPlatform extends PartyVec3 {
  /** Landing footprint in WORLD blocks: `width` spans x, `depth` spans z. */
  width: number;
  depth: number;
  checkpoint: boolean;
  kind: ParkourJump;
  /** Progress index. The two branches of a fork share their orders, so a
   *  racer on either branch is exactly as far along as one on the other. */
  order: number;
  /** Travel direction across this pad: 0 +z, 1 +x, 2 -z, 3 -x. */
  heading: number;
  /** 0 on the main route; 1 or 2 on the branches of a fork. */
  branch: number;
  /** Index of this pad in `platforms`. */
  index: number;
  /** The pad this one is jumped to from (-1 for the start). */
  from: number;
  /** Blink stones: which of the two alternating groups this pad belongs to. */
  group: 0 | 1;
}
/** One authored block, in venue-local coordinates. */
export interface ParkourCell { x: number; y: number; z: number; block: number; order: number; platform: number }

export interface ParkourCourse {
  seed: number;
  variant: ParkourVariant;
  platforms: ParkourPlatform[];
  /** `steps[order]` holds every pad at that order (two at a fork). */
  steps: ParkourPlatform[][];
  /** Every physical jump, as [from, to] platform indices. */
  edges: [number, number][];
  cells: ParkourCell[];
  start: ParkourPlatform;
  finish: ParkourPlatform;
  /** Lowest and highest standing heights on the course. */
  lowY: number;
  highY: number;
}

// ── Shapes and the jump budget ─────────────────────────────────────────────

/** Local shape: `w` across the direction of travel, `d` along it. `below` and
 *  `above` bound the blocks a pad owns relative to the standing height, and
 *  `margin` is how far its dressing reaches out past the landing surface. */
interface Shape { w: number; d: number; below: number; above: number; margin: number }
const SHAPES: Record<ParkourJump, Shape> = {
  wide: { w: 5, d: 5, below: 1, above: 0, margin: 0 },
  landing: { w: 3, d: 5, below: 1, above: 0, margin: 0 },
  pad: { w: 3, d: 3, below: 1, above: 0, margin: 0 },
  step: { w: 3, d: 3, below: 1, above: 0, margin: 0 },
  drop: { w: 3, d: 3, below: 1, above: 0, margin: 0 },
  gate: { w: 3, d: 3, below: 1, above: 4, margin: 1 },
  hurdle: { w: 3, d: 5, below: 1, above: 1, margin: 0 },
  rail: { w: 3, d: 1, below: 1, above: 0, margin: 0 },
  beam: { w: 1, d: 5, below: 2, above: 0, margin: 0 },
  pillar: { w: 1, d: 1, below: 4, above: 0, margin: 0 },
  stones: { w: 1, d: 1, below: 3, above: 0, margin: 0 },
  ladder: { w: 1, d: 1, below: 3, above: 0, margin: 0 },
  // Obstacle pads are seven deep on purpose: two rows to land on in front of
  // the obstacle, the obstacle itself, and four rows of run-up behind it. The
  // depth is what pays for the obstacle — it never shortens the take-off lip.
  wall: { w: 5, d: 7, below: 1, above: 3, margin: 0 },
  slalom: { w: 5, d: 7, below: 1, above: 2, margin: 0 },
  tunnel: { w: 3, d: 7, below: 1, above: 3, margin: 1 },
  pit: { w: 3, d: 7, below: 4, above: 0, margin: 0 },
  teeth: { w: 5, d: 7, below: 1, above: 1, margin: 0 },
  ledge: { w: 1, d: 5, below: 1, above: 3, margin: 1 },
  window: { w: 3, d: 3, below: 1, above: 0, margin: 0 },
  fork: { w: 11, d: 5, below: 1, above: 0, margin: 0 },
  join: { w: 11, d: 5, below: 1, above: 0, margin: 0 },
  launch: { w: 3, d: 3, below: 1, above: 0, margin: 0 },
  boost: { w: 3, d: 3, below: 1, above: 0, margin: 0 },
  blink: { w: 3, d: 3, below: 1, above: 0, margin: 0 },
  crumble: { w: 3, d: 3, below: 1, above: 0, margin: 0 },
};
/** Fits a switchback leg or a tower ring: nothing reaches more than a block
 *  and a half either side of the line. */
function tight(kind: ParkourJump): boolean {
  const s = SHAPES[kind];
  return s.w + 2 * s.margin <= 3;
}
const PLAIN = new Set<ParkourJump>(['pad', 'wide', 'landing', 'fork', 'join']);
const MECHANIC = new Set<ParkourJump>(['launch', 'boost', 'blink', 'crumble']);
/** Pads with nothing standing on them, that a route can turn 90° off. */
const CORNER_SAFE = new Set<ParkourJump>([...PLAIN, 'step', 'drop', 'stones', 'pillar', 'ladder', 'rail', 'beam', 'blink', 'crumble', 'window']);
export function parkourIsMechanic(kind: ParkourJump): boolean { return MECHANIC.has(kind); }

/** Horizontal distance a sprint jump covers while it is at or above `rise`.
 *  From the shared player physics (jump apex 1.25 blocks, sprint 5.612 m/s,
 *  gravity 32): about 3.1 blocks flat, 2.3 up a block, more on the way down.
 *  Held a shade under the true numbers so no seed is ever a coin flip. */
function parkourTravel(rise: number): number {
  return rise >= 1 ? 2.2 : rise === 0 ? 3.0 : rise === -1 ? 3.6 : 4.0;
}
/** A launch pad throws you up onto a pad this much higher, one block of air
 *  beyond its own far edge. */
export const PARKOUR_LAUNCH_RISE = 4;
const LAUNCH_GAP = 1;
/** A boost pad throws you across this much open air — further than any
 *  sprint jump can reach. */
function boostGap(rise: number): number { return rise < 0 ? 5 : 4; }

const DIRS: readonly (readonly [number, number])[] = [[0, 1], [1, 0], [0, -1], [-1, 0]];

interface Box { x0: number; x1: number; y0: number; y1: number; z0: number; z1: number }
function overlaps(a: Box, b: Box, pad = 0): boolean {
  return a.x0 - pad <= b.x1 && b.x0 <= a.x1 + pad && a.z0 - pad <= b.z1 && b.z0 <= a.z1 + pad &&
    a.y0 <= b.y1 && b.y0 <= a.y1;
}

// ── Generation ─────────────────────────────────────────────────────────────

const VENUE_X = 32, VENUE_Z = 448;
/** `climb` rises by DISTANCE travelled, not by pad count: a tower lap is the
 *  same length however its pads fall, so every lap clears the one below it
 *  by the same margin. */
type RisePolicy = { kind: 'mixed' | 'flat' | 'descend' } | { kind: 'climb'; perBlock: number };
interface Leg {
  heading: number;
  /** Where the leg ends, on its own axis. A function of the pad the leg starts
   *  from, so a turn can be "one pad over" wherever the last leg finished. */
  until: number | ((from: ParkourPlatform) => number);
  /** How far the line may wander either side of `centre` (default: where the
   *  leg starts). */
  wander: number;
  centre?: number;
  /** Restrict to kinds that fit between neighbouring legs. */
  narrow?: boolean;
  /** The last pad of this leg: plain, or a wide island. */
  last?: 'pad' | 'wide';
}
interface Candidate {
  kind: ParkourJump; rise: number; drift: number;
  /** The shortest honest hop (one block of air) instead of the longest. */
  short?: boolean;
}

const courseCache = new Map<number, ParkourCourse>();

/** The course for a seed. Deterministic and shared by client, server and
 *  smoke tests, so nobody disagrees about where the next pad is. */
export function parkourCourse(seed: number): ParkourCourse {
  const cached = courseCache.get(seed);
  if (cached) return cached;
  const course = generate(seed >>> 0);
  if (courseCache.size > 64) courseCache.delete(courseCache.keys().next().value!);
  courseCache.set(seed, course);
  return course;
}

function generate(seed: number, attempt = 0): ParkourCourse {
  const variant = parkourVariant(seed);
  const { mode, layout, deck } = variant;
  const theme = parkourTheme(seed);
  const platforms: ParkourPlatform[] = [];
  const edges: [number, number][] = [];
  /** Solid volumes (pads and their dressing), tagged with the owning pad. */
  const volumes: { box: Box; owner: number }[] = [];
  /** The air every jump flies through, tagged with its two ends. */
  const corridors: { box: Box; a: number; b: number }[] = [];
  // A spiral can occasionally box its next lap in with an obstacle. Retry
  // its layout with a different deterministic draw before accepting a short
  // tower; the public seed, mode and theme remain the same on every client.
  let salt = attempt * 0x10000;
  const rand = (): number => partyHash(seed, 0x5000 + salt++);

  const vertical = layout === 'spiral' || layout === 'twin' || (layout === 'switchback' && mode === 'void');
  const maxHeight = vertical ? 38 : layout === 'descent' ? 30 : layout === 'switchback' ? 14 : 10;
  const checkpointEvery = mode === 'void' ? 8 : mode === 'collapse' ? 14 : 12;
  const targetOrders = layout === 'switchback' ? 60 : 56;
  // Towers climb about eight blocks per 70-block lap — three more than a lap
  // needs to clear the one below it.
  const policy: RisePolicy = vertical ? { kind: 'climb', perBlock: .12 }
    : layout === 'descent' ? { kind: 'descend' }
      : layout === 'switchback' ? { kind: 'climb', perBlock: .032 } : { kind: 'mixed' };

  let height = layout === 'descent' ? 30 : 0;
  let order = 0, lastCheckpoint = 0, travelled = 0;
  let done = false;

  // ── Geometry helpers ──
  const footprint = (kind: ParkourJump, heading: number): [number, number] => {
    const s = SHAPES[kind];
    return heading % 2 ? [s.d, s.w] : [s.w, s.d];
  };
  const along = (p: ParkourPlatform, h: number): number => h % 2 ? p.width : p.depth;
  const across = (p: ParkourPlatform, h: number): number => h % 2 ? p.depth : p.width;
  const cellX = (p: ParkourPlatform): number => Math.floor(p.x);
  const cellZ = (p: ParkourPlatform): number => Math.floor(p.z);
  const volume = (p: ParkourPlatform): Box => {
    const s = SHAPES[p.kind], m = s.margin;
    const hx = (p.width - 1) / 2 + m, hz = (p.depth - 1) / 2 + m;
    return {
      x0: cellX(p) - hx, x1: cellX(p) + hx, z0: cellZ(p) - hz, z1: cellZ(p) + hz,
      y0: p.y - s.below, y1: p.y + Math.max(s.above, 3),
    };
  };
  /** The air a jump flies through: centre to centre along it, a block
   *  either side across it, and the full height of a body at the top of it. */
  const corridor = (a: ParkourPlatform, b: ParkourPlatform): Box => {
    const lx = b.heading % 2 ? 0 : 1, lz = b.heading % 2 ? 1 : 0;
    return {
      x0: Math.min(cellX(a), cellX(b)) - lx, x1: Math.max(cellX(a), cellX(b)) + lx,
      z0: Math.min(cellZ(a), cellZ(b)) - lz, z1: Math.max(cellZ(a), cellZ(b)) + lz,
      y0: Math.min(a.y, b.y), y1: Math.max(a.y, b.y) + 3,
    };
  };
  /** The frame a 'window' pad hangs in the gap in front of it. */
  const windowFrame = (a: ParkourPlatform, b: ParkourPlatform): Box => {
    const h = b.heading, [dx, dz] = DIRS[h];
    const aEdge = (h % 2 ? cellX(a) : cellZ(a)) + (h < 2 ? 1 : -1) * (along(a, h) - 1) / 2;
    const bEdge = (h % 2 ? cellX(b) : cellZ(b)) - (h < 2 ? 1 : -1) * (along(b, h) - 1) / 2;
    const at = Math.round((aEdge + bEdge) / 2);
    const lat = Math.round(((h % 2 ? cellZ(a) + cellZ(b) : cellX(a) + cellX(b))) / 2);
    const y0 = Math.min(a.y, b.y) - 1, y1 = Math.max(a.y, b.y) + 4;
    return dx !== 0 || dz === 0
      ? { x0: at, x1: at, z0: lat - 2, z1: lat + 2, y0, y1 }
      : { x0: lat - 2, x1: lat + 2, z0: at, z1: at, y0, y1 };
  };
  const inVenue = (b: Box): boolean => b.x0 >= 1 && b.x1 <= VENUE_X - 2 && b.z0 >= 4 && b.z1 <= VENUE_Z - 5 &&
    b.y0 >= 121 && b.y1 <= 186;

  /** Build a candidate pad `c` jumped to from `prev` in heading `h`, with its
   *  lateral centre held inside [lo, hi]. Null when it cannot be made to fit
   *  the jump budget or the venue. */
  const make = (prev: ParkourPlatform, h: number, c: Candidate, lo: number, hi: number,
    meta: { order: number; branch: number; checkpoint: boolean }): ParkourPlatform | null => {
    const [wx, dz] = footprint(c.kind, h);
    const eA = along(prev, h), eB = h % 2 ? wx : dz;
    const lA = across(prev, h), lB = h % 2 ? dz : wx;
    const prevAlong = h % 2 ? cellX(prev) : cellZ(prev), prevLat = h % 2 ? cellZ(prev) : cellX(prev);
    const wideA = Math.max(0, (lA - 3) / 2), wideB = Math.max(0, (lB - 3) / 2);
    let lat = Math.max(lo, Math.min(hi, prevLat + c.drift));
    let dist: number;
    if (prev.kind === 'launch') {
      lat = prevLat;
      dist = (eA + eB) / 2 + LAUNCH_GAP;
    } else if (prev.kind === 'boost') {
      lat = prevLat;
      dist = (eA + eB) / 2 + boostGap(c.rise);
    } else {
      const span = parkourTravel(c.rise) + eA / 2 + eB / 2 - .6;
      // Drift keeps the line readable: at most three blocks sideways, and one
      // when either end of the jump is a single block wide. Wide pads (forks,
      // islands) absorb their own extra width before any of it counts.
      const limit = Math.min(lA, lB) >= 3 ? 3 : 1;
      const eff = (l: number): number => Math.max(0, Math.abs(l - prevLat) - wideA - wideB);
      while (eff(lat) > limit) lat += lat > prevLat ? -1 : 1;
      if (c.kind === 'window') while (Math.abs(lat - prevLat) > 1) lat += lat > prevLat ? -1 : 1;
      // A ledge has a wall at its shoulder: it is entered and left straight.
      if (c.kind === 'ledge' || prev.kind === 'ledge') lat = prevLat;
      dist = Math.floor(Math.sqrt(Math.max(0, span * span - eff(lat) * eff(lat))));
      if (c.short) dist = Math.min(dist, (eA + eB) / 2 + 1);
    }
    if (dist < (eA + eB) / 2 + 1) return null;
    const s = h < 2 ? 1 : -1, a = prevAlong + s * dist;
    const cx = h % 2 ? a : lat, cz = h % 2 ? lat : a;
    const p: ParkourPlatform = {
      x: cx + .5, y: prev.y + c.rise, z: cz + .5, width: wx, depth: dz, checkpoint: meta.checkpoint,
      kind: c.kind, order: meta.order, heading: h, branch: meta.branch, index: platforms.length, from: prev.index,
      group: c.kind === 'blink' ? (prev.kind === 'blink' ? (1 - prev.group) as 0 | 1 : (rand() & 1) as 0 | 1) : 0,
    };
    if (!inVenue(volume(p))) return null;
    if (p.kind === 'window' && !inVenue(windowFrame(prev, p))) return null;
    return p;
  };
  /** True when `p` (reached from each of `froms`) clears everything already
   *  built: no solid within a block of it, no flight path through it, and
   *  none of its own flight paths through anything else. */
  const clear = (p: ParkourPlatform, froms: ParkourPlatform[], siblings: Set<number>): boolean => {
    const mine = [volume(p)];
    for (const f of froms) if (p.kind === 'window') mine.push(windowFrame(f, p));
    for (const v of volumes) {
      if (froms.some(f => f.index === v.owner) || siblings.has(v.owner)) continue;
      if (mine.some(m => overlaps(m, v.box, 1))) return false;
    }
    for (const c of corridors) {
      // The flight INTO the pad we take off from ends on that pad; a new pad
      // beside its last few blocks is beside a landing, not in a flight.
      if (siblings.has(c.a) || siblings.has(c.b) || froms.some(f => f.index === c.b)) continue;
      if (mine.some(m => overlaps(m, c.box))) return false;
    }
    for (const f of froms) {
      const air = corridor(f, p);
      for (const v of volumes)
        if (v.owner !== f.index && !siblings.has(v.owner) && overlaps(air, v.box)) return false;
    }
    return true;
  };
  const commit = (p: ParkourPlatform, froms: ParkourPlatform[]): void => {
    p.index = platforms.length;
    platforms.push(p);
    volumes.push({ box: volume(p), owner: p.index });
    for (const f of froms) {
      edges.push([f.index, p.index]);
      corridors.push({ box: corridor(f, p), a: f.index, b: p.index });
      if (p.kind === 'window') volumes.push({ box: windowFrame(f, p), owner: p.index });
    }
  };

  // ── Choosing what comes next ──
  let bag: ParkourJump[] = [];
  const draw = (ok: (k: ParkourJump) => boolean): ParkourJump => {
    for (let tries = 0; tries < 16; tries++) {
      if (!bag.length) {
        bag = [...deck.kinds, ...deck.kinds, 'pad', 'pad'];
        for (let i = bag.length - 1; i > 0; i--) {
          const j = rand() % (i + 1);
          [bag[i], bag[j]] = [bag[j], bag[i]];
        }
      }
      const k = bag.pop()!;
      if (ok(k)) return k;
    }
    return 'pad';
  };
  const riseFor = (kind: ParkourJump, prev: ParkourPlatform): number => {
    if (prev.kind === 'launch') return PARKOUR_LAUNCH_RISE;
    if (prev.kind === 'boost') return height >= 1 ? -1 : 0;
    if (kind === 'step' || kind === 'ladder') return 1;
    if (kind === 'drop') return -2;
    const h = rand();
    let r = 0;
    if (policy.kind === 'mixed') r = h % 5 === 0 ? -1 : h % 7 === 1 ? 1 : 0;
    else if (policy.kind === 'climb') r = height < Math.floor(policy.perBlock * (travelled + 4)) ? 1 : 0;
    else if (policy.kind === 'descend') r = h % 4 === 0 ? 0 : -1;
    if (kind === 'window' && r > 0) r = 0;
    if (height + r < 0) r = 0;
    if (height + r > maxHeight) r = 0;
    return r;
  };
  /** What a leg may draw. Anything that forces a rise has to have the
   *  headroom for it; anything that throws you has to have the room. */
  const allowed = (k: ParkourJump, narrow: boolean, room: number): boolean => {
    if (PLAIN.has(k) && k !== 'pad') return false;
    if (narrow && !tight(k)) return false;
    if ((k === 'step' || k === 'ladder') && (height + 1 > maxHeight || policy.kind === 'descend')) return false;
    if (k === 'drop' && (height < 2 || policy.kind === 'climb' && policy.perBlock > .06)) return false;
    if (k === 'launch' && (height + PARKOUR_LAUNCH_RISE > maxHeight || room < 12 || policy.kind === 'descend')) return false;
    if (k === 'boost' && room < 16) return false;
    if (k === 'window' && policy.kind === 'climb') return false;
    return true;
  };
  const drifts = [0, 0, 1, -1, 2, -2, 3, -3];
  /** The last pad placed on the main route. */
  let cur: ParkourPlatform = null!;

  /** Place the next pad of a leg, trying progressively plainer versions of it
   *  until one clears everything already built. */
  const advance = (prev: ParkourPlatform, h: number, lo: number, hi: number, narrow: boolean,
    room: number, force?: ParkourJump): ParkourPlatform | null => {
    const nextOrder = order + 1;
    const checkpoint = nextOrder - lastCheckpoint >= checkpointEvery;
    const thrown = prev.kind === 'launch' || prev.kind === 'boost';
    const corner = prev.heading !== h;
    // A turn takes off sideways across the pad: nothing may stand on it, and
    // a throw pad only ever throws straight on.
    if (corner && !CORNER_SAFE.has(prev.kind)) return null;
    let kind: ParkourJump;
    if (checkpoint || thrown) kind = narrow ? 'landing' : checkpoint ? 'wide' : 'landing';
    else if (force) kind = force;
    else kind = draw(k => allowed(k, narrow, room));
    const rise = riseFor(kind, prev);
    const drift = corner || thrown ? 0 : drifts[rand() % drifts.length];
    const plain: ParkourJump = checkpoint || thrown ? kind : 'pad';
    const tries: Candidate[] = [
      { kind, rise, drift }, { kind, rise, drift: 0 },
      { kind: plain, rise: thrown ? rise : riseFor(plain, prev), drift: 0 },
    ];
    if (!thrown && height + 1 <= maxHeight) {
      tries.push({ kind: plain, rise: 1, drift: 0 }, { kind: plain, rise: 1, drift: drift });
    }
    // Last resort: a short hop, which fits where a full jump would carry out
    // of the venue.
    if (!thrown) tries.push({ kind: plain, rise: 0, drift: 0, short: true });
    const meta = { order: nextOrder, branch: 0, checkpoint };
    let fallback: ParkourPlatform | null = null;
    for (const t of tries) {
      const p = make(prev, h, t, lo, hi, meta);
      if (p && clear(p, [prev], new Set())) { fallback = p; break; }
    }
    // Nothing fits here. The caller turns onto its next leg instead — this
    // never builds one pad into another.
    if (!fallback) return null;
    const p = fallback;
    commit(p, [prev]);
    order = nextOrder;
    if (checkpoint) lastCheckpoint = nextOrder;
    height = p.y - PARTY_FLOOR_Y - 1;
    travelled += Math.hypot(p.x - prev.x, p.z - prev.z);
    return p;
  };

  /** Walk one leg: pads in `leg.heading` until its `until` is passed. The
   *  final pad is plain whenever there is room for it, so the next leg can
   *  turn off it. Returns how many pads it placed. */
  const walk = (from: ParkourPlatform, leg: Leg, stop: () => boolean): number => {
    const h = leg.heading, s = h < 2 ? 1 : -1;
    const until = typeof leg.until === 'function' ? leg.until(from) : leg.until;
    const startLat = h % 2 ? cellZ(from) : cellX(from);
    const centre = leg.centre ?? startLat;
    const lo = centre - leg.wander, hi = centre + leg.wander;
    let placed = 0;
    while (!stop()) {
      const at = h % 2 ? cellX(cur) : cellZ(cur);
      const room = s * (until - at);
      if (room <= 0 && placed > 0) {
        // Overshot the end on an obstacle: one plain pad to turn off.
        if (!PLAIN.has(cur.kind)) {
          const next = advance(cur, h, lo, hi, !!leg.narrow, 0, leg.last ?? 'pad');
          if (next) { cur = next; placed++; }
        }
        break;
      }
      // Close enough to the end that the next jump could carry past it:
      // make it a plain pad, the leg's last. No drawn jump carries more than
      // eleven blocks (throw pads need more room than that to be drawn).
      const last = room < 12;
      const next = advance(cur, h, lo, hi, !!leg.narrow, room, last ? (leg.last ?? 'pad') : undefined);
      if (!next) break;
      cur = next;
      placed++;
      if (last) break;
    }
    return placed;
  };
  /** Walk a cycle of legs until `stop`, giving up once two legs in a row
   *  cannot place anything at all. */
  const cycle = (legs: Leg[], stop: () => boolean, max: number): void => {
    let idle = 0;
    for (let i = 0; !stop() && i < max && idle < 2; i++) idle = walk(cur, legs[i % legs.length], stop) ? 0 : idle + 1;
  };

  // ── The start ──
  const startZ = 12, startX = layout === 'switchback' ? 6 : layout === 'spiral' || layout === 'twin' ? 9 : 16;
  const start: ParkourPlatform = {
    x: startX + .5, y: PARTY_FLOOR_Y + height + 1, z: startZ + .5, width: 5, depth: 5, checkpoint: true,
    kind: 'wide', order: 0, heading: 0, branch: 0, index: 0, from: -1, group: 0,
  };
  commit(start, []);
  cur = start;
  const racing = (): boolean => done || order >= targetOrders - 1;
  const climbing = (): boolean => done || height >= maxHeight - 2;

  // ── Layouts ──
  if (layout === 'lane' || layout === 'descent') {
    walk(cur, { heading: 0, until: VENUE_Z - 14, wander: layout === 'lane' ? 4 : 5, centre: 16 }, racing);
  } else if (layout === 'islands') {
    // Wander down the venue from island to island, with short sideways
    // detours between them so the route never just points at the finish.
    for (let idle = 0; !racing() && idle < 2;) {
      const run = walk(cur, { heading: 0, until: (p) => cellZ(p) + 26 + rand() % 12, wander: 8, centre: 16, last: 'wide' }, racing);
      if (racing()) break;
      const east = cellX(cur) < 16;
      const detour = walk(cur, {
        heading: east ? 1 : 3, wander: 1, narrow: true,
        until: (p) => east ? Math.min(cellX(p) + 9, 24) : Math.max(cellX(p) - 9, 8),
      }, racing);
      idle = run + detour ? 0 : idle + 1;
    }
  } else if (layout === 'switchback') {
    const stop = mode === 'void' ? climbing : racing;
    // Across, up two pads, and back — the turn is two pads, never one, so
    // the next leg runs well clear of this one even when the turn climbs.
    const legs: Leg[] = [
      { heading: 1, until: 24, wander: 1, narrow: true },
      { heading: 0, until: (p) => cellZ(p) + 12, wander: 0, narrow: true },
      { heading: 3, until: 7, wander: 1, narrow: true },
      { heading: 0, until: (p) => cellZ(p) + 12, wander: 0, narrow: true },
    ];
    cycle(legs, () => stop() || cellZ(cur) > VENUE_Z - 24, 400);
  } else if (layout === 'spiral') {
    // A ring big enough that a lap climbs well clear of the one below it —
    // including the approach, which runs up the ring's west side. Each leg
    // turns up to one jump before its mark, so the ring as BUILT is about
    // 15 x 26: a 70-block lap.
    const n = 58, sth = 20, w = 4, e = 27;
    const ring: Leg[] = [
      { heading: 0, until: n, wander: 1, narrow: true },
      { heading: 1, until: e, wander: 1, narrow: true },
      { heading: 2, until: sth, wander: 1, narrow: true },
      { heading: 3, until: w, wander: 1, narrow: true },
    ];
    cycle(ring, climbing, 96);
  } else if (layout === 'twin') {
    const A = { n: 58, s: 20 }, B = { n: 138, s: 100 }, w = 4, e = 27;
    const legs: Leg[] = [
      { heading: 0, until: A.n, wander: 1, narrow: true },
      { heading: 1, until: e, wander: 1, narrow: true },
      { heading: 2, until: A.s, wander: 1, narrow: true },
      { heading: 3, until: w, wander: 1, narrow: true },
      // Sky bridge over to tower B, along the west side…
      { heading: 0, until: B.n, wander: 1, narrow: true },
      { heading: 1, until: e, wander: 1, narrow: true },
      { heading: 2, until: B.s, wander: 1, narrow: true },
      { heading: 3, until: w, wander: 1, narrow: true },
      { heading: 0, until: B.n, wander: 1, narrow: true },
      { heading: 1, until: e, wander: 1, narrow: true },
      // …and back to tower A along the east side.
      { heading: 2, until: A.s, wander: 1, narrow: true },
      { heading: 3, until: w, wander: 1, narrow: true },
    ];
    cycle(legs, climbing, 120);
  } else {
    // Forked Routes: a lane that splits three times. Both branches have the
    // same number of pads and share their progress numbers; one is a string
    // of tiny precise stones, the other is live mechanics.
    const precision: ParkourJump[] = ['stones', 'pillar', 'rail', 'beam', 'pad'];
    const live: ParkourJump[] = ['blink', 'crumble', 'pad', 'hurdle', 'blink'];
    for (let fork = 0; fork < 3 && !done; fork++) {
      walk(cur, { heading: 0, until: (p) => cellZ(p) + 34 + rand() % 12, wander: 3, centre: 16 }, racing);
      if (racing()) break;
      // The fork itself: one long pad the width of both branches.
      const f = make(cur, 0, { kind: 'fork', rise: 0, drift: 16 - cellX(cur) }, 16, 16, { order: order + 1, branch: 0, checkpoint: false });
      if (!f || !clear(f, [cur], new Set())) break;
      commit(f, [cur]);
      order++;
      cur = f;
      let ends: ParkourPlatform[] = [f, f];
      const sides = [11, 21];
      /** One pad on each branch at `order`, as level with each other as their
       *  two jump budgets allow — so the join that closes them is in reach of
       *  both. Pulling a pad back only ever SHORTENS its jump. */
      const pair = (kinds: ParkourJump[], meta: { order: number; branch: number }): ParkourPlatform[] | null => {
        const made = [0, 1].map(b => make(ends[b], 0, { kind: kinds[b], rise: 0, drift: meta.branch ? sides[b] - cellX(ends[b]) : 16 - cellX(ends[b]) },
          meta.branch ? sides[b] - 1 : 16, meta.branch ? sides[b] + 1 : 16, { order: meta.order, branch: meta.branch ? b + 1 : 0, checkpoint: false }));
        if (!made[0] || !made[1]) return null;
        const lo = made.map((m, b) => cellZ(ends[b]) + (along(ends[b], 0) + m!.depth) / 2 + 1);
        const hi = made.map(m => cellZ(m!));
        const z = Math.min(hi[0], hi[1]);
        if (z < Math.max(lo[0], lo[1])) return null;
        for (const m of made) m!.z = z + .5;
        return made as ParkourPlatform[];
      };
      const count = 4 + rand() % 2;
      for (let k = 0; k < count + 3; k++) {
        if (k >= count) {
          // Close the branches with the join, once it is in reach of both.
          const [j] = pair(['join', 'join'], { order: order + 1, branch: 0 }) ?? [];
          if (j && clear(j, ends, new Set())) {
            commit(j, ends);
            order++;
            cur = j;
            break;
          }
        }
        const meta = { order: order + 1, branch: 1 };
        // Past the planned count, only plain pairs: level, equal-depth pads
        // are what bring two branches back in reach of one join.
        // Branch pads never differ in depth by more than two, or the two
        // branches drift apart faster than one join can gather them back.
        const a = precision[rand() % precision.length];
        const bs = live.filter(k2 => Math.abs(SHAPES[k2].d - SHAPES[a].d) <= 2);
        const options = k >= count ? [['pad', 'pad']] : [[a, bs[rand() % bs.length]], ['pad', 'pad']];
        const made = options
          .map(kinds => pair(kinds as ParkourJump[], meta))
          .find(m => m && clear(m[0], [ends[0]], new Set()) && clear(m[1], [ends[1]], new Set()));
        if (!made) { done = true; break; }
        made.forEach((m, b) => commit(m, [ends[b]]));
        ends = made;
        order++;
      }
      if (cur !== ends[0] && cur.kind !== 'join') done = true;
    }
    if (!done) walk(cur, { heading: 0, until: VENUE_Z - 14, wander: 3, centre: 16 }, racing);
  }

  // ── The finish: always a wide gold pad, one more jump on ──
  if (!cur.checkpoint || cur === start || !PLAIN.has(cur.kind)) {
    lastCheckpoint = -Infinity;
    const h = cur.heading;
    const lat = h % 2 ? cellZ(cur) : cellX(cur);
    const fin = advance(cur, h, lat - 1, lat + 1, false, 99, 'wide') ?? advance(cur, h, lat - 1, lat + 1, true, 99, 'wide');
    // No room for one more jump: the pad we are on becomes the finish, and
    // a finish is never a thing that moves, blinks or falls.
    if (fin) cur = fin;
    else if (MECHANIC.has(cur.kind)) cur.kind = 'pad';
  }
  const finish = cur;
  finish.checkpoint = true;

  if (layout === 'spiral' && (finish.order < 40 || finish.y - start.y < 30) && attempt < 32)
    return generate(seed, attempt + 1);

  // ── Stamp every pad into blocks ──
  const cells: ParkourCell[] = [];
  const seen = new Map<number, number>();
  const key = (x: number, y: number, z: number): number => ((y - 120) * VENUE_Z + z) * VENUE_X + x;
  const put = (x: number, y: number, z: number, block: number, p: ParkourPlatform): void => {
    if (x < 0 || x >= VENUE_X || z < 0 || z >= VENUE_Z || y < 120 || y > 190) return;
    const k = key(x, y, z), at = seen.get(k);
    const cell = { x, y, z, block, order: p.order, platform: p.index };
    if (at === undefined) { seen.set(k, cells.length); cells.push(cell); } else cells[at] = cell;
  };
  const erase = (x: number, y: number, z: number): void => {
    const at = seen.get(key(x, y, z));
    if (at !== undefined) cells[at] = { ...cells[at], block: Block.Air };
  };
  for (const p of platforms) {
    const s = SHAPES[p.kind], h = p.heading;
    const x0 = cellX(p) - (p.width - 1) / 2, z0 = cellZ(p) - (p.depth - 1) / 2;
    const { w, d } = s;
    // Local (u along travel, v across) to world. v may run one past either
    // side for dressing that stands just outside the landing surface.
    const wx = (u: number, v: number): number => h === 0 ? x0 + v : h === 1 ? x0 + u : h === 2 ? x0 + (w - 1 - v) : x0 + (d - 1 - u);
    const wz = (u: number, v: number): number => h === 0 ? z0 + u : h === 1 ? z0 + (w - 1 - v) : h === 2 ? z0 + (d - 1 - u) : z0 + v;
    const at = (u: number, v: number, dy: number, block: number): void => put(wx(u, v), p.y - 1 + dy, wz(u, v), block, p);
    const hole = (u: number, v: number, dy: number): void => erase(wx(u, v), p.y - 1 + dy, wz(u, v));
    const pick = (n: number): number => theme.platforms[n % theme.platforms.length];
    const surface = p.checkpoint ? Block.GildedVaultBrick
      : p.kind === 'launch' ? Block.ParkourLaunchPad
        : p.kind === 'boost' ? Block.ParkourBoostPad
          : p.kind === 'blink' ? Block.PartyTileD
            : p.kind === 'crumble' ? Block.PartyTileC
              : pick(partyHash(seed, p.index));
    for (let u = 0; u < d; u++) for (let v = 0; v < w; v++) at(u, v, 0, surface);
    if (p.checkpoint) {
      // A lit rim you can pick out from six jumps back.
      for (let u = 0; u < d; u++) for (let v = 0; v < w; v++)
        if (u === 0 || v === 0 || u === d - 1 || v === w - 1) at(u, v, 0, Block.RuneGlass);
      // The two lit posts sit halfway down the SIDES, and only on a pad wide
      // enough to leave three clear columns between them.
      const turns = edges.some(([a, b]) => a === p.index && platforms[b].heading !== h);
      if (w >= 5 && !turns) for (const v of [0, w - 1]) {
        at(d >> 1, v, 1, pick(0)); at(d >> 1, v, 2, pick(0)); at(d >> 1, v, 3, Block.RuneGlass);
      }
    }
    switch (p.kind) {
      case 'hurdle':
        // A bar across the middle of a long pad: land in front of it, hop it
        // standing, take off from the far half.
        for (let v = 0; v < w; v++) at(2, v, 1, Block.PrismBrick);
        break;
      case 'gate':
        // The arch straddles the far edge, so you run through it rather than
        // meeting it in the air.
        for (const v of [-1, w]) { at(d - 1, v, 1, pick(1)); at(d - 1, v, 2, pick(1)); at(d - 1, v, 3, Block.RuneGlass); }
        for (let v = -1; v <= w; v++) at(d - 1, v, 4, Block.OpalBrick);
        break;
      case 'stones':
      case 'ladder':
        // A single block is hard to read against the sky: hang a lamp under it.
        at(0, 0, -2, Block.RuneGlass);
        at(0, 0, -1, pick(2));
        break;
      case 'pillar':
        for (let dy = -3; dy <= -1; dy++) at(0, 0, dy, pick(2));
        break;
      case 'beam':
        for (let u = 0; u < d; u++) at(u, 0, -1, pick(1));
        break;
      case 'wall': {
        // A wall across the pad with ONE doorway, two blocks tall so it cannot
        // be jumped. Land in front of it at speed, then find the gap.
        const door = 1 + partyHash(seed, p.index + 0x117) % (w - 2);
        for (let v = 0; v < w; v++) if (v !== door) { at(2, v, 1, pick(1)); at(2, v, 2, pick(1)); }
        at(2, door, 3, Block.RuneGlass);
        break;
      }
      case 'slalom':
        // Two staggered half-walls: the pad has to be crossed diagonally, twice.
        for (let v = 0; v <= w - 3; v++) { at(2, v, 1, pick(v)); at(2, v, 2, pick(v)); }
        for (let v = 2; v <= w - 1; v++) { at(4, v, 1, pick(v)); at(4, v, 2, pick(v)); }
        break;
      case 'tunnel':
        // A covered corridor with two blocks of headroom: RUN it, don't jump it.
        for (let u = 2; u <= 4; u++) {
          for (const v of [-1, w]) { at(u, v, 1, pick(1)); at(u, v, 2, pick(1)); at(u, v, 3, pick(1)); }
          for (let v = -1; v <= w; v++) at(u, v, 3, u === 3 ? Block.RuneGlass : Block.OpalBrick);
        }
        break;
      case 'pit':
        // A hole straight through the middle: overshoot the landing and you
        // go through it.
        for (let v = 0; v < w; v++) hole(3, v, 0);
        at(3, w >> 1, -3, Block.RuneGlass);
        break;
      case 'teeth':
        // Two staggered rows of single blocks — hop them or weave them.
        for (let v = 0; v < w; v += 2) at(2, v, 1, pick(2));
        for (let v = 1; v < w; v += 2) at(4, v, 1, pick(2));
        break;
      case 'ledge': {
        // A one-block ledge with a wall along one side of it: nothing to
        // bail out onto, and the wall is always at your shoulder.
        const side = partyHash(seed, p.index + 0x3d) & 1 ? w : -1;
        for (let u = 0; u < d; u++) { at(u, side, 1, pick(1)); at(u, side, 2, pick(1)); at(u, side, 3, u === d >> 1 ? Block.RuneGlass : pick(1)); }
        break;
      }
      case 'launch':
      case 'boost':
        // A lit rim under the pad so a throw pad reads from a long way off.
        for (let u = 0; u < d; u++) for (let v = 0; v < w; v++)
          if (u === 0 || v === 0 || u === d - 1 || v === w - 1) at(u, v, -1, Block.RuneGlass);
        break;
      case 'window': {
        const f = platforms[p.from];
        if (!f) break;
        const frame = windowFrame(f, p);
        const alongX = h % 2 === 1;
        for (let y = frame.y0; y <= frame.y1; y++)
          for (let l = -2; l <= 2; l++) {
            const edge = Math.abs(l) === 2 || y === frame.y1;
            if (!edge) continue;
            const lat = alongX ? (frame.z0 + frame.z1) / 2 + l : (frame.x0 + frame.x1) / 2 + l;
            const x = alongX ? frame.x0 : lat, z = alongX ? lat : frame.z0;
            put(x, y, z, y === frame.y1 && l === 0 ? Block.RuneGlass : pick(1), p);
          }
        break;
      }
    }
  }
  // Start terrace behind the first pad, and a finish arch you can see from it.
  for (let dz = 1; dz <= 5; dz++)
    for (let dx = -3; dx <= 3; dx++)
      put(cellX(start) + dx, start.y - 1, cellZ(start) - 2 - dz, theme.platforms[0], start);
  {
    const h = finish.heading, alongX = h % 2 === 1;
    const lat = (l: number): [number, number] => alongX ? [cellX(finish), cellZ(finish) + l] : [cellX(finish) + l, cellZ(finish)];
    const half = (alongX ? finish.depth : finish.width) >> 1;
    for (const l of [-half - 1, half + 1]) {
      const [x, z] = lat(l);
      for (let y = finish.y; y <= finish.y + 4; y++) put(x, y, z, Block.GildedVaultBrick, finish);
    }
    for (let l = -half - 1; l <= half + 1; l++) {
      const [x, z] = lat(l);
      put(x, finish.y + 5, z, Block.GildedVaultBrick, finish);
      if (Math.abs(l) <= 1) put(x, finish.y + 4, z, Block.RuneGlass, finish);
    }
  }

  const steps: ParkourPlatform[][] = [];
  for (const p of platforms) (steps[p.order] ??= []).push(p);
  const ys = platforms.map(p => p.y);
  return {
    seed, variant, platforms, steps, edges, cells, start, finish,
    lowY: Math.min(...ys), highY: Math.max(...ys),
  };
}

/** The pads a racer at `progress` is aiming for next (two at a fork). */
export function parkourNext(course: ParkourCourse, progress: number): readonly ParkourPlatform[] {
  return course.steps[progress + 1] ?? [];
}
/** Number of jumps from the start pad to the finish. */
export function parkourLength(course: ParkourCourse): number {
  return course.steps.length - 1;
}
