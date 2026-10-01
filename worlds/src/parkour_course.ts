// Parkour course generation — DRAGON CHASE.
//
// There is one mode: a dragon chases the runners down a course built out of
// SET PIECES — castle ramparts, a rooftop village, a rope bridge over a gorge,
// a sky galleon, a great tree, a clock tower, a crystal cavern and more. Each
// course strings six of them together between the Dragon's Lair (the start)
// and the Sanctuary (the finish and its podium), all read out of the arena
// seed, so the client, the server and the tests build the identical course
// from the one number they already share.
//
// This file owns the ROUTE: every pad a runner jumps to, sized from one
// physics budget (`parkourTravel`) and checked against every earlier pad —
// and every earlier jump's flight path — before it is kept. Each piece has
// its own PATH through its place: back and forth across a street's rooftops,
// over a gorge on rope bridges, across a river on stepping stones, along a
// castle's walls and round its corner towers. Every pad keeps the column of
// air under it clear, because every pad is the top of something standing on
// the ground — a house, a tree, a rock, a pier — built by
// parkour_setpieces.ts round the boxes this file records.
import { Block } from './blocks';
import { partyHash, type PartyVec3 } from './partygames';
import { PARKOUR_CENTRE_X, PARKOUR_VENUE_X, PARKOUR_VENUE_Z, PARTY_FLOOR_Y } from './venue_dims';
import { PARKOUR_THEMES, parkourTheme, type ParkourPalette } from './parkour_themes';

// ── Set pieces ─────────────────────────────────────────────────────────────

export type SetPieceId = 'ramparts' | 'rooftops' | 'ropebridge' | 'aqueduct' | 'galleon' | 'greattree'
  | 'clocktower' | 'cavern' | 'waterfall' | 'shrine' | 'mine' | 'foundry';

export type ParkourJump =
  | 'pad' | 'wide' | 'landing' | 'pillar' | 'beam' | 'rail' | 'step' | 'drop' | 'hurdle' | 'gate' | 'stones'
  // Obstacle pads: the jump that REACHES them is an ordinary jump; what makes
  // them hard is getting across the pad itself to the take-off lip.
  | 'wall' | 'slalom' | 'tunnel' | 'pit' | 'teeth'
  // Climbing stones, a window in a wall to jump through, and a one-block
  // ledge hugging a wall.
  | 'ladder' | 'window' | 'ledge'
  // Kept for the pad model's sake; no set piece forks its route.
  | 'fork' | 'join'
  // Mechanics. Each is an ordinary solid block that the client, the server
  // and the tests recognise by POSITION (never by block id alone), so nothing
  // a player places can ever pretend to be one.
  | 'launch' | 'boost' | 'blink' | 'crumble';

type RiseKind = 'mixed' | 'climb' | 'descend';
type SurfaceSlot = keyof ParkourPalette;

/** What part of its piece's path a pad is on. `run` is the way in and out
 *  (and a whole lane); `cross` a leg across the venue (over the street, the
 *  gorge, the river); `link` the short leg between two crossings. */
export type PadRole = 'run' | 'cross' | 'link';

/** How a piece's route winds through it.
 *  · lane: onward, swinging up to `wander` blocks either side of the middle.
 *  · weave: back and forth across the venue, `width` either side of the
 *    middle, `gap` blocks on between crossings; the crossings and the links
 *    between them can draw from decks of their own.
 *  · rampart: up one wall, across the castle and up the other. */
type PiecePath =
  | { shape: 'lane'; wander: number }
  | { shape: 'weave'; width: number; gap: number; cross?: readonly ParkourJump[]; link?: readonly ParkourJump[]; linkRise?: RiseKind }
  | { shape: 'rampart' };

interface SetPieceDef {
  title: string;
  /** The jumps this piece draws from: its own deck. */
  kinds: readonly ParkourJump[];
  path: PiecePath;
  rise: RiseKind;
  /** Heights (above the floor) this piece can start at. */
  minH: number;
  maxH: number;
  /** Palette slots the pads are made of: the landing surface, then what is
   *  under and on it. */
  surface: readonly SurfaceSlot[];
}

export const SET_PIECES: Record<SetPieceId, SetPieceDef> = {
  ramparts: {
    title: 'CASTLE RAMPARTS', kinds: ['teeth', 'hurdle', 'wall', 'gate', 'tunnel', 'pad', 'drop', 'step'],
    path: { shape: 'rampart' }, rise: 'mixed', minH: 2, maxH: 30, surface: ['stone', 'brick'],
  },
  rooftops: {
    title: 'ROOFTOP VILLAGE', kinds: ['pad', 'step', 'drop', 'pillar', 'beam', 'landing', 'wide'],
    path: { shape: 'weave', width: 14, gap: 19 }, rise: 'mixed', minH: 6, maxH: 30, surface: ['roof', 'trim'],
  },
  ropebridge: {
    title: 'THE ROPE BRIDGES', kinds: ['rail', 'beam', 'rail', 'crumble', 'stones'],
    path: { shape: 'weave', width: 14, gap: 20, link: ['wide', 'landing', 'pad'] },
    rise: 'mixed', minH: 4, maxH: 28, surface: ['wood', 'log'],
  },
  aqueduct: {
    title: 'THE AQUEDUCT', kinds: ['beam', 'pillar', 'window', 'pad', 'step', 'stones'],
    path: { shape: 'weave', width: 10, gap: 21 }, rise: 'mixed', minH: 4, maxH: 30, surface: ['stone', 'trim'],
  },
  galleon: {
    title: 'THE SKY GALLEON', kinds: ['beam', 'pillar', 'ladder', 'launch', 'rail', 'pad'],
    path: { shape: 'lane', wander: 4 }, rise: 'climb', minH: 0, maxH: 20, surface: ['wood', 'log'],
  },
  greattree: {
    title: 'THE GREAT TREES', kinds: ['pad', 'step', 'stones', 'pillar', 'ladder', 'drop'],
    path: { shape: 'weave', width: 12, gap: 19 }, rise: 'climb', minH: 0, maxH: 22, surface: ['leaves', 'log'],
  },
  clocktower: {
    title: 'THE CLOCK TOWERS', kinds: ['blink', 'crumble', 'ladder', 'step', 'pad', 'stones'],
    path: { shape: 'weave', width: 11, gap: 20 }, rise: 'climb', minH: 0, maxH: 22, surface: ['metal', 'trim'],
  },
  cavern: {
    title: 'CRYSTAL CAVERN', kinds: ['tunnel', 'pit', 'stones', 'beam', 'window', 'pad'],
    path: { shape: 'lane', wander: 6 }, rise: 'mixed', minH: 0, maxH: 26, surface: ['rock', 'brick'],
  },
  waterfall: {
    title: 'WATERFALL CANYON', kinds: ['stones', 'pillar', 'stones', 'pad'],
    path: { shape: 'weave', width: 13, gap: 20, link: ['ledge', 'drop', 'pad'], linkRise: 'descend' },
    rise: 'mixed', minH: 12, maxH: 34, surface: ['rock', 'brick'],
  },
  shrine: {
    title: 'LANTERN SHRINE', kinds: ['stones', 'stones', 'pad', 'blink', 'pillar'],
    path: { shape: 'weave', width: 12, gap: 19, link: ['gate', 'step', 'pad'] }, rise: 'mixed', minH: 0, maxH: 28, surface: ['trim', 'wood'],
  },
  mine: {
    title: 'THE MINE SCAFFOLD', kinds: ['launch', 'beam', 'step', 'pad', 'crumble', 'ladder'],
    path: { shape: 'weave', width: 11, gap: 20 }, rise: 'climb', minH: 0, maxH: 22, surface: ['wood', 'log'],
  },
  foundry: {
    title: 'THE FOUNDRY', kinds: ['crumble', 'boost', 'blink', 'pad', 'hurdle', 'beam'],
    path: { shape: 'lane', wander: 6 }, rise: 'mixed', minH: 0, maxH: 30, surface: ['metal', 'brick'],
  },
};
const PIECE_IDS = Object.keys(SET_PIECES) as SetPieceId[];
/** Set pieces on one course (besides the lair and the sanctuary). */
const PIECES_PER_COURSE = 6;

export interface ParkourSection {
  piece: SetPieceId;
  title: string;
  /** First and last course order that belongs to this piece. */
  fromOrder: number;
  toOrder: number;
  /** The stretch of venue it was given, venue-local z. */
  z0: number;
  z1: number;
  /** Lowest altitude the dragon may fly at over this piece (a cavern's roof). */
  ceiling?: number;
}

export interface ParkourVariant {
  theme: number;
  pieces: SetPieceId[];
}

// ── Course model ───────────────────────────────────────────────────────────

export interface ParkourPlatform extends PartyVec3 {
  /** Landing footprint in WORLD blocks: `width` spans x, `depth` spans z. */
  width: number;
  depth: number;
  checkpoint: boolean;
  kind: ParkourJump;
  /** Progress index. */
  order: number;
  /** Travel direction across this pad: 0 +z, 1 +x, 2 -z, 3 -x. */
  heading: number;
  /** Always 0: routes no longer fork. */
  branch: number;
  /** Index of this pad in `platforms`. */
  index: number;
  /** The pad this one is jumped to from (-1 for the start). */
  from: number;
  /** Blink stones: which of the two alternating groups this pad belongs to. */
  group: 0 | 1;
  /** The set piece this pad belongs to (-1 = start / finish). */
  section: number;
  /** Which part of the piece's path it is on. */
  role: PadRole;
}
/** One authored block, in venue-local coordinates. */
export interface ParkourCell { x: number; y: number; z: number; block: number; order: number; platform: number }

/** An axis-aligned box of cells, inclusive. */
export interface RouteBox { x0: number; x1: number; y0: number; y1: number; z0: number; z1: number }
/** Something on the route the scenery has to keep clear of: a pad (or its
 *  dressing) or the air a jump flies through. `lo`/`hi` are the standing
 *  heights at either end. */
export interface RouteSpace { box: RouteBox; lo: number; hi: number; pad: boolean; owner: number }

export interface ParkourCourse {
  variant: ParkourVariant;
  platforms: ParkourPlatform[];
  /** `steps[order]` holds every pad at that order. */
  steps: ParkourPlatform[][];
  cells: ParkourCell[];
  start: ParkourPlatform;
  finish: ParkourPlatform;
  sections: ParkourSection[];
  /** Everything the scenery has to stay clear of. */
  spaces: RouteSpace[];
  /** Where finishers stand, best first (venue-local, standing height). */
  podium: PartyVec3[];
  /** The dragon's flight line: one point per course order (venue-local). */
  dragonPath: PartyVec3[];
  /** Where the dragon sleeps until GO. */
  lair: PartyVec3;
  /** Lowest and highest standing heights on the course. */
  lowY: number;
  highY: number;
}

// ── Venue ──────────────────────────────────────────────────────────────────

export { PARKOUR_CENTRE_X, PARKOUR_VENUE_X, PARKOUR_VENUE_Z };
const VENUE_X = PARKOUR_VENUE_X, VENUE_Z = PARKOUR_VENUE_Z, CX = PARKOUR_CENTRE_X;
const START_Z = 20;
/** The last set piece ends by here; the sanctuary takes the rest. */
const FINISH_Z = 474;
const MAX_HEIGHT = 34;
/** How far either side of the middle anything on the route may reach. */
const ROUTE_HALF = 23;

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
  // the obstacle, the obstacle itself, and four rows of run-up behind it.
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
/** Fits a weave leg or a ring: nothing reaches more than a block and a half
 *  either side of the line. */
function tight(kind: ParkourJump): boolean {
  const s = SHAPES[kind];
  return s.w + 2 * s.margin <= 3;
}
const PLAIN = new Set<ParkourJump>(['pad', 'wide', 'landing', 'fork', 'join']);
const MECHANIC = new Set<ParkourJump>(['launch', 'boost', 'blink', 'crumble']);
/** Pads with something to get past on them. Never two in a row. */
const OBSTACLE = new Set<ParkourJump>(['wall', 'slalom', 'tunnel', 'pit', 'teeth']);
/** Pads with nothing standing on them, that a route can turn 90° off. */
const CORNER_SAFE = new Set<ParkourJump>([...PLAIN, 'step', 'drop', 'stones', 'pillar', 'ladder', 'rail', 'beam', 'blink', 'crumble', 'window']);

/** Horizontal distance a sprint jump covers while it is at or above `rise`.
 *  From the shared player physics (jump apex 1.25 blocks, sprint 5.612 m/s,
 *  gravity 32): about 3.1 blocks flat, 2.3 up a block, more on the way down.
 *  Held a shade under the true numbers so no seed is ever a coin flip. */
function parkourTravel(rise: number): number {
  return rise >= 1 ? 2.2 : rise === 0 ? 3.0 : rise === -1 ? 3.6 : 4.0;
}
/** A launch pad throws you up onto a pad this much higher, one block of air
 *  beyond its own far edge. */
const PARKOUR_LAUNCH_RISE = 4;
const LAUNCH_GAP = 1;
/** A boost pad throws you across this much open air — further than any
 *  sprint jump can reach. */
function boostGap(rise: number): number { return rise < 0 ? 5 : 4; }

const DIRS: readonly (readonly [number, number])[] = [[0, 1], [1, 0], [0, -1], [-1, 0]];

function overlaps(a: RouteBox, b: RouteBox, pad = 0): boolean {
  return a.x0 - pad <= b.x1 && b.x0 <= a.x1 + pad && a.z0 - pad <= b.z1 && b.z0 <= a.z1 + pad &&
    a.y0 <= b.y1 && b.y0 <= a.y1;
}

// ── Generation ─────────────────────────────────────────────────────────────

type RisePolicy = { kind: 'mixed' | 'descend' } | { kind: 'climb'; perBlock: number };
interface Leg {
  heading: number;
  /** What part of the path this leg is; its own deck and rise, if any. */
  role?: PadRole;
  kinds?: readonly ParkourJump[];
  rise?: RiseKind;
  /** Where the leg ends, on its own axis. */
  until: number | ((from: ParkourPlatform) => number);
  /** How far the line may wander either side of `centre` (default: where the
   *  leg starts). */
  wander: number;
  centre?: number;
  /** Restrict to kinds that fit between neighbouring legs. */
  narrow?: boolean;
  /** The next leg turns off this one's last pad: make that a corner. */
  turns?: boolean;
}
interface Candidate {
  kind: ParkourJump; rise: number; drift: number;
  /** The shortest honest hop (one block of air) instead of the longest. */
  short?: boolean;
}

const courseCache = new Map<number, ParkourCourse>();
/** Courses kept (a few hundred KB of geometry records at most). */
const COURSE_CACHE_MAX = 256;

/** The course for a seed. Deterministic and shared by client, server and
 *  tests, so nobody disagrees about where the next pad is. */
export function parkourCourse(seed: number): ParkourCourse {
  // Least-recently-used: the server asks for every live match's course on
  // each of its players' transforms.
  const cached = courseCache.get(seed);
  if (cached) {
    courseCache.delete(seed);
    courseCache.set(seed, cached);
    return cached;
  }
  const course = generate(seed >>> 0);
  if (courseCache.size >= COURSE_CACHE_MAX) courseCache.delete(courseCache.keys().next().value!);
  courseCache.set(seed, course);
  return course;
}
/** Which set pieces a seed's course is made of, in order. */
export function parkourVariant(seed: number): ParkourVariant { return parkourCourse(seed).variant; }
/** Write a theme into the low bits of a seed. */
export function encodeParkourSeed(seed: number, theme: number): number {
  return ((seed & ~0x7) | (theme & 7)) >>> 0;
}

function generate(seed: number): ParkourCourse {
  const themeIndex = PARKOUR_THEMES.indexOf(parkourTheme(seed));
  const palette = parkourTheme(seed).palette;
  const platforms: ParkourPlatform[] = [];
  const spaces: RouteSpace[] = [];
  let salt = 0;
  const rand = (): number => partyHash(seed, 0x5000 + salt++);

  let height = 6;
  let maxHeight = MAX_HEIGHT;
  let policy: RisePolicy = { kind: 'mixed' };
  let kinds: readonly ParkourJump[] = ['pad'];
  let section = -1;
  let role: PadRole = 'run';
  let order = 0, lastCheckpoint = 0, travelled = 0;
  /** The next pad placed is a checkpoint (a set piece's entrance). */
  let forceCheckpoint = false;
  const checkpointEvery = 11;

  // ── Geometry helpers ──
  const footprint = (kind: ParkourJump, heading: number): [number, number] => {
    const s = SHAPES[kind];
    return heading % 2 ? [s.d, s.w] : [s.w, s.d];
  };
  const along = (p: ParkourPlatform, h: number): number => h % 2 ? p.width : p.depth;
  const across = (p: ParkourPlatform, h: number): number => h % 2 ? p.depth : p.width;
  const cellX = (p: ParkourPlatform): number => Math.floor(p.x);
  const cellZ = (p: ParkourPlatform): number => Math.floor(p.z);
  const volume = (p: ParkourPlatform): RouteBox => {
    const s = SHAPES[p.kind], m = s.margin;
    const hx = (p.width - 1) / 2 + m, hz = (p.depth - 1) / 2 + m;
    return {
      x0: cellX(p) - hx, x1: cellX(p) + hx, z0: cellZ(p) - hz, z1: cellZ(p) + hz,
      y0: p.y - s.below, y1: p.y + Math.max(s.above, 3),
    };
  };
  /** The air a jump flies through: centre to centre along it, a block
   *  either side across it, and the full height of a body at the top of it. */
  const corridor = (a: ParkourPlatform, b: ParkourPlatform): RouteBox => {
    const lx = b.heading % 2 ? 0 : 1, lz = b.heading % 2 ? 1 : 0;
    return {
      x0: Math.min(cellX(a), cellX(b)) - lx, x1: Math.max(cellX(a), cellX(b)) + lx,
      z0: Math.min(cellZ(a), cellZ(b)) - lz, z1: Math.max(cellZ(a), cellZ(b)) + lz,
      y0: Math.min(a.y, b.y), y1: Math.max(a.y, b.y) + 3,
    };
  };
  /** The frame a 'window' pad hangs in the gap in front of it. */
  const windowFrame = (a: ParkourPlatform, b: ParkourPlatform): RouteBox => {
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
  /** The column under a pad, down to the bottom of the venue: whatever the
   *  pad stands on (a house, a trunk, a rock) is built in it, so nothing on
   *  the route may pass through it and it may pass through nothing. */
  const column = (p: ParkourPlatform): RouteBox => {
    const hx = (p.width - 1) / 2, hz = (p.depth - 1) / 2;
    return { x0: cellX(p) - hx, x1: cellX(p) + hx, z0: cellZ(p) - hz, z1: cellZ(p) + hz, y0: 121, y1: p.y - 1 - SHAPES[p.kind].below };
  };
  const supports: RouteBox[] = [];
  // The route keeps to the middle of the venue: the flanks either side are
  // the mirrored scenery's, and nothing the route rule carves reaches them.
  const inVenue = (b: RouteBox): boolean => b.x0 >= CX - ROUTE_HALF && b.x1 <= CX + ROUTE_HALF && b.z0 >= 4 && b.z1 <= VENUE_Z - 5 &&
    b.y0 >= 121 && b.y1 <= 186;

  /** Build a candidate pad `c` jumped to from `prev` in heading `h`, with its
   *  lateral centre held inside [lo, hi]. Null when it cannot be made to fit
   *  the jump budget or the venue. */
  const make = (prev: ParkourPlatform, h: number, c: Candidate, lo: number, hi: number,
    meta: { order: number; checkpoint: boolean }): ParkourPlatform | null => {
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
      // when either end of the jump is a single block wide. Wide pads absorb
      // their own extra width before any of it counts.
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
      kind: c.kind, order: meta.order, heading: h, branch: 0, index: platforms.length, from: prev.index,
      group: c.kind === 'blink' ? (prev.kind === 'blink' ? (1 - prev.group) as 0 | 1 : (rand() & 1) as 0 | 1) : 0,
      section, role,
    };
    if (!inVenue(volume(p))) return null;
    if (p.kind === 'window' && !inVenue(windowFrame(prev, p))) return null;
    return p;
  };
  /** True when `p` (reached from `from`) clears everything already built: no
   *  solid within a block of it, no flight path through it, and none of its
   *  own flight path through anything else. */
  const clear = (p: ParkourPlatform, from: ParkourPlatform): boolean => {
    const mine = [volume(p)];
    if (p.kind === 'window') mine.push(windowFrame(from, p));
    for (const v of spaces) {
      if (!v.pad || v.owner === from.index) continue;
      if (mine.some(m => overlaps(m, v.box, 1))) return false;
    }
    for (const c of spaces) {
      // The flight INTO the pad we take off from ends on that pad; a new pad
      // beside its last few blocks is beside a landing, not in a flight.
      if (c.pad || c.owner === from.index) continue;
      if (mine.some(m => overlaps(m, c.box))) return false;
    }
    const air = corridor(from, p);
    for (const v of spaces)
      if (v.pad && v.owner !== from.index && overlaps(air, v.box)) return false;
    // Nothing through anybody's column, and nothing in this pad's own.
    for (const col of supports)
      if (overlaps(air, col) || mine.some(m => overlaps(m, col))) return false;
    const own = column(p);
    for (const v of spaces) if (v.owner !== p.index && overlaps(own, v.box)) return false;
    return true;
  };
  const commit = (p: ParkourPlatform, from: ParkourPlatform | null): void => {
    p.index = platforms.length;
    platforms.push(p);
    supports.push(column(p));
    spaces.push({ box: volume(p), lo: p.y, hi: p.y, pad: true, owner: p.index });
    if (!from) return;
    spaces.push({ box: corridor(from, p), lo: Math.min(from.y, p.y), hi: Math.max(from.y, p.y), pad: false, owner: p.index });
    if (p.kind === 'window') spaces.push({ box: windowFrame(from, p), lo: p.y, hi: p.y, pad: true, owner: p.index });
  };

  // ── Choosing what comes next ──
  let bag: ParkourJump[] = [];
  const draw = (ok: (k: ParkourJump) => boolean): ParkourJump => {
    for (let tries = 0; tries < 16; tries++) {
      if (!bag.length) {
        bag = [...kinds, ...kinds];
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
    if (policy.kind === 'mixed') r = h % 5 === 0 ? -1 : h % 4 === 1 ? 1 : 0;
    else if (policy.kind === 'climb') r = height < Math.floor(policy.perBlock * (travelled + 4)) ? 1 : 0;
    else r = h % 4 === 0 ? 0 : -1;
    if (kind === 'window' && r > 0) r = 0;
    if (height + r < 0) r = 0;
    if (height + r > maxHeight) r = 0;
    return r;
  };
  /** What a leg may draw. Anything that forces a rise has to have the
   *  headroom for it; anything that throws you has to have the room. */
  const allowed = (k: ParkourJump, narrow: boolean, room: number): boolean => {
    if (k === 'fork' || k === 'join') return false;
    // A long pad needs the room to land beyond it before the leg ends.
    if (SHAPES[k].d >= 5 && room < SHAPES[k].d + 9) return false;
    if (narrow && !tight(k)) return false;
    if ((k === 'step' || k === 'ladder') && (height + 1 > maxHeight || policy.kind === 'descend')) return false;
    if (k === 'drop' && (height < 3 || policy.kind === 'climb' && policy.perBlock > .06)) return false;
    if (k === 'launch' && (height + PARKOUR_LAUNCH_RISE > maxHeight || room < 12 || policy.kind === 'descend')) return false;
    if (k === 'boost' && room < 16) return false;
    if (k === 'window' && policy.kind === 'climb') return false;
    return true;
  };
  const drifts = [0, 0, 1, -1, 2, -2, 3, -3];
  /** The last pad placed on the route. */
  let cur: ParkourPlatform = null!;

  /** Place the next pad of a leg, trying progressively plainer versions of it
   *  until one clears everything already built. */
  const advance = (prev: ParkourPlatform, h: number, lo: number, hi: number, narrow: boolean,
    room: number, force?: ParkourJump | 'corner'): ParkourPlatform | null => {
    const nextOrder = order + 1;
    const checkpoint = forceCheckpoint || nextOrder - lastCheckpoint >= checkpointEvery;
    const thrown = prev.kind === 'launch' || prev.kind === 'boost';
    const corner = prev.heading !== h;
    // A turn takes off sideways across the pad: nothing may stand on it, and
    // a throw pad only ever throws straight on.
    if (corner && !CORNER_SAFE.has(prev.kind)) return null;
    let kind: ParkourJump;
    if (checkpoint || thrown) kind = narrow ? 'landing' : checkpoint ? 'wide' : 'landing';
    // A corner is a broad landing — a tower top, a lookout, a big roof — so
    // the next leg can turn off it well clear of the pad before.
    else if (force === 'corner') kind = narrow ? 'landing' : 'wide';
    else if (force) kind = force;
    else kind = draw(k => allowed(k, narrow, room) && !(OBSTACLE.has(k) && OBSTACLE.has(prev.kind)));
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
    const meta = { order: nextOrder, checkpoint };
    let fallback: ParkourPlatform | null = null;
    for (const t of tries) {
      const p = make(prev, h, t, lo, hi, meta);
      if (p && clear(p, prev)) { fallback = p; break; }
    }
    // Nothing fits here. The caller turns onto its next leg instead — this
    // never builds one pad into another.
    if (!fallback) return null;
    const p = fallback;
    commit(p, prev);
    order = nextOrder;
    if (checkpoint) { lastCheckpoint = nextOrder; forceCheckpoint = false; }
    height = p.y - PARTY_FLOOR_Y - 1;
    travelled += Math.hypot(p.x - prev.x, p.z - prev.z);
    return p;
  };

  /** Walk one leg: pads in `leg.heading` until its `until` is passed. The
   *  final pad is plain whenever there is room for it, so the next leg can
   *  turn off it. Returns how many pads it placed. */
  const walk = (leg: Leg, stop: () => boolean): number => {
    // Turning off something you cannot turn on: a plain pad straight on first.
    if (leg.heading !== cur.heading && !CORNER_SAFE.has(cur.kind)) {
      const side = cur.heading % 2 ? cellZ(cur) : cellX(cur);
      const step = advance(cur, cur.heading, side - 1, side + 1, false, 0, 'pad');
      if (step) cur = step;
    }
    const from = cur;
    const deck = leg.kinds ?? pieceKinds;
    if (deck !== kinds) { kinds = deck; bag = []; }
    role = leg.role ?? 'run';
    const was = policy;
    if (leg.rise) {
      policy = leg.rise === 'climb' ? { kind: 'climb', perBlock: .05 } : { kind: leg.rise };
      if (policy.kind === 'climb') travelled = height / .05 - 4;
    }
    try {
      // A leg held to a line that cannot even start there gets some room.
      const placed = walkLeg(leg, stop, from);
      if (placed || cur !== from || leg.wander >= 3) return placed;
      return walkLeg({ ...leg, wander: 3, centre: undefined }, stop, from);
    } finally { policy = was; }
  };
  const walkLeg = (leg: Leg, stop: () => boolean, from: ParkourPlatform): number => {
    const h = leg.heading, s = h < 2 ? 1 : -1;
    const until = typeof leg.until === 'function' ? leg.until(from) : leg.until;
    const startLat = h % 2 ? cellZ(from) : cellX(from);
    const centre = leg.centre ?? startLat;
    const lo = centre - leg.wander, hi = centre + leg.wander;
    let placed = 0;
    while (!stop()) {
      const at = h % 2 ? cellX(cur) : cellZ(cur);
      const room = s * (until - at);
      if (room <= 0) break;
      // Close enough to the end that the next jump could carry past it: the
      // leg's last pad, something the next leg can turn off.
      const last = room < 7;
      const next = advance(cur, h, lo, hi, !!leg.narrow, room, last && leg.turns ? 'corner' : undefined);
      if (!next) break;
      cur = next;
      placed++;
      if (last) break;
    }
    // However the leg ended — past its end on an obstacle, or cut short —
    // it hands the next one something to go on from: a corner if the route
    // turns here, at least a pad nothing stands on if it runs straight on.
    const ready = leg.turns ? cur.kind === 'wide' || cur.kind === 'landing' : CORNER_SAFE.has(cur.kind);
    if (placed > 0 && !ready) {
      const next = advance(cur, h, lo, hi, !!leg.narrow, 0, leg.turns ? 'corner' : 'pad');
      if (next) { cur = next; placed++; }
    }
    return placed;
  };

  // ── The start ──
  const start: ParkourPlatform = {
    x: CX + .5, y: PARTY_FLOOR_Y + height + 1, z: START_Z + .5, width: 5, depth: 5, checkpoint: true,
    kind: 'wide', order: 0, heading: 0, branch: 0, index: 0, from: -1, group: 0, section: -1, role: 'run',
  };
  commit(start, null);
  cur = start;

  // ── The set pieces ──
  // A shuffled pool; each slot takes the first piece that suits the height
  // the course has reached.
  const pool = [...PIECE_IDS];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = partyHash(seed, 0x9e1 + i) % (i + 1);
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const sections: ParkourSection[] = [];
  const bayLength = Math.floor((FINISH_Z - START_Z - 6) / PIECES_PER_COURSE);
  /** The deck the current piece draws from when a leg names none. */
  let pieceKinds: readonly ParkourJump[] = kinds;
  for (let n = 0; n < PIECES_PER_COURSE; n++) {
    const fits = (id: SetPieceId): boolean => height >= SET_PIECES[id].minH && height <= SET_PIECES[id].maxH;
    const at = pool.findIndex(fits);
    const id = pool.splice(Math.max(0, at), 1)[0];
    const def = SET_PIECES[id];
    const z0 = Math.max(cellZ(cur) + 2, START_Z + 6 + n * bayLength);
    const z1 = n === PIECES_PER_COURSE - 1 ? FINISH_Z : START_Z + 6 + (n + 1) * bayLength;
    section = sections.length;
    const sec: ParkourSection = { piece: id, title: def.title, fromOrder: order + 1, toOrder: order, z0, z1 };
    sections.push(sec);
    pieceKinds = kinds = def.kinds;
    bag = [];
    maxHeight = MAX_HEIGHT;
    forceCheckpoint = true;
    policy = def.rise === 'climb' ? { kind: 'climb', perBlock: .05 }
      : def.rise === 'descend' ? { kind: 'descend' }
        : height > 24 ? { kind: 'descend' } : { kind: 'mixed' };
    // Climbs measure their rise from here.
    travelled = policy.kind === 'climb' ? height / policy.perBlock - 4 : travelled;
    const path = def.path;
    const x = (): number => cellX(cur), z = (): number => cellZ(cur);
    // The last piece leaves room to run in towards the middle, so the
    // sanctuary round the finish always fits the venue.
    const lastPiece = n === PIECES_PER_COURSE - 1;
    const end = lastPiece ? z1 - 26 : z1;
    if (path.shape === 'lane') {
      // A long S: swing out to one side, then the other.
      const side = partyHash(seed, 0x51de + n) & 1 ? 1 : -1;
      const third = (end - z0) / 3;
      walk({ heading: 0, until: Math.round(z0 + third), wander: 2, centre: CX + side * path.wander }, () => false);
      walk({ heading: 0, until: Math.round(z0 + 2 * third), wander: 2, centre: CX - side * path.wander }, () => false);
      walk({ heading: 0, until: end, wander: 2, centre: CX, turns: lastPiece }, () => false);
    } else if (path.shape === 'rampart') {
      // Up the west wall, across the castle on the curtain wall between the
      // corner towers, and up the east wall — or the mirror of that, from
      // whichever side the course came in on.
      const near = x() <= CX ? CX - 13 : CX + 13, far = 2 * CX - near;
      const turn = Math.round(z0 + (end - z0) * .45);
      const sidestep = Math.abs(x() - near) > 3;
      walk({ heading: 0, until: z0 + 6, wander: 3, turns: sidestep }, () => false);
      if (sidestep) walk({ heading: x() < near ? 1 : 3, until: near, wander: 0, role: 'link', turns: true }, () => false);
      walk({ heading: 0, until: turn, wander: 1, centre: near, turns: true }, () => false);
      walk({ heading: far > near ? 1 : 3, until: far, wander: 1, role: 'cross', turns: true }, () => false);
      walk({ heading: 0, until: end, wander: 1, centre: far, turns: lastPiece }, () => false);
    } else {
      // Back and forth: across, a short way on, across the other way.
      walk({ heading: 0, until: z0 + 7, wander: 2, turns: true }, () => false);
      let dir = x() <= CX ? 1 : 3;
      let k = 0;
      while (z() < end - path.gap - 6) {
        // Each crossing reaches a little further or less far than the last.
        const reach = path.width - 2 + partyHash(seed, 0x7a11 + n * 16 + k) % 5;
        const placed = walk({
          heading: dir, until: dir === 1 ? CX + reach : CX - reach, wander: 1, role: 'cross', kinds: path.cross, turns: true,
        }, () => false);
        walk({
          heading: 0, until: (p) => cellZ(p) + (placed ? path.gap : 6), wander: 1, role: 'link', kinds: path.link, rise: path.linkRise,
          turns: true,
        }, () => false);
        // A crossing that could not start is tried again a little further on.
        if (placed) dir = dir === 1 ? 3 : 1;
        if (++k > 8) break;
      }
      walk({ heading: 0, until: end, wander: 3, centre: x(), turns: lastPiece }, () => false);
    }
    // The run-in to the finish: across to the middle if the route has ended
    // off to one side, then straight on, on broad pads.
    if (lastPiece) {
      const broad: ParkourJump[] = ['pad', 'wide', 'landing', 'pad'];
      if (Math.abs(x() - CX) > 5) walk({ heading: x() < CX ? 1 : 3, until: CX, wander: 1, kinds: broad, turns: true, role: 'link' }, () => false);
      walk({ heading: 0, until: z1, wander: 3, centre: CX, kinds: broad }, () => false);
    }
    sec.toOrder = order;
    if (id === 'cavern') {
      // The dragon flies over the mountain the cavern is cut through.
      const top = Math.max(...platforms.filter(p => p.section === section).map(p => p.y));
      sec.ceiling = top + 16;
    }
    // An empty piece (nothing fitted) is simply dropped from the record.
    if (sec.toOrder < sec.fromOrder) sections.pop();
    if (cellZ(cur) >= FINISH_Z - 4) break;
  }
  role = 'run';

  // ── The finish: always a wide gold pad, one more jump on ──
  section = -1;
  lastCheckpoint = -Infinity;
  {
    const h = cur.heading;
    // Arriving sideways, or off something you cannot turn on: one broad
    // landing straight on first, then the finish straight up the venue.
    if (h !== 0 || !CORNER_SAFE.has(cur.kind)) {
      const side = h % 2 ? cellZ(cur) : cellX(cur);
      const turn = advance(cur, h, side - 1, side + 1, false, 99, 'wide');
      if (turn) cur = turn;
    }
    const lat = cellX(cur);
    const fin = advance(cur, 0, lat - 1, lat + 1, false, 99, 'wide') ?? advance(cur, 0, lat - 1, lat + 1, true, 99, 'wide');
    if (fin) cur = fin;
    else if (MECHANIC.has(cur.kind)) cur.kind = 'pad';
  }
  const finish = cur;
  finish.checkpoint = true;
  finish.section = -1;

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
  const pieceSurface = (p: ParkourPlatform): readonly number[] => {
    const sec = sections[p.section];
    if (!sec) return [palette.trim, palette.stone];
    return SET_PIECES[sec.piece].surface.map(k => palette[k]);
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
    const mats = pieceSurface(p);
    const pick = (n: number): number => mats[n % mats.length];
    const surface = p.checkpoint ? Block.GildedVaultBrick
      : p.kind === 'launch' ? Block.ParkourLaunchPad
        : p.kind === 'boost' ? Block.ParkourBoostPad
          : p.kind === 'blink' ? Block.PartyTileD
            : p.kind === 'crumble' ? Block.PartyTileC
              : pick(0);
    for (let u = 0; u < d; u++) for (let v = 0; v < w; v++) at(u, v, 0, surface);
    if (p.checkpoint) {
      // A lit rim you can pick out from six jumps back.
      for (let u = 0; u < d; u++) for (let v = 0; v < w; v++)
        if (u === 0 || v === 0 || u === d - 1 || v === w - 1) at(u, v, 0, Block.RuneGlass);
      const turns = platforms.some(q => q.from === p.index && q.heading !== h);
      // Never on the start pad: runners spawn in a row right across it.
      if (w >= 5 && !turns && p !== finish && p !== start) for (const v of [0, w - 1]) {
        at(d >> 1, v, 1, pick(0)); at(d >> 1, v, 2, pick(0)); at(d >> 1, v, 3, Block.RuneGlass);
      }
    }
    // Under every pad, a course of the piece's own material so it reads as
    // part of the build even before the scenery is stamped round it.
    for (let u = 0; u < d; u++) for (let v = 0; v < w; v++)
      for (let dy = -1; dy >= -(s.below - 1); dy--) at(u, v, dy, pick(1));
    switch (p.kind) {
      case 'hurdle':
        for (let v = 0; v < w; v++) at(2, v, 1, pick(1));
        break;
      case 'gate':
        // The arch straddles the far edge, so you run through it rather than
        // meeting it in the air.
        for (const v of [-1, w]) { at(d - 1, v, 1, pick(1)); at(d - 1, v, 2, pick(1)); at(d - 1, v, 3, palette.lamp); }
        for (let v = -1; v <= w; v++) at(d - 1, v, 4, palette.trim);
        break;
      case 'stones':
      case 'ladder':
        // A single block is hard to read against the sky: hang a lamp under it.
        at(0, 0, -2, Block.RuneGlass);
        at(0, 0, -1, pick(1));
        break;
      case 'pillar':
        for (let dy = -3; dy <= -1; dy++) at(0, 0, dy, pick(1));
        break;
      case 'beam':
        for (let u = 0; u < d; u++) at(u, 0, -1, pick(1));
        break;
      case 'wall': {
        // A wall across the pad with ONE doorway, two blocks tall so it cannot
        // be jumped. Land in front of it at speed, then find the gap.
        const door = w >> 1;
        for (let v = 0; v < w; v++) if (v !== door) { at(2, v, 1, pick(1)); at(2, v, 2, pick(1)); }
        at(2, door, 3, palette.trim);
        break;
      }
      case 'slalom':
        for (let v = 0; v <= w - 3; v++) { at(2, v, 1, pick(v)); at(2, v, 2, pick(v)); }
        for (let v = 2; v <= w - 1; v++) { at(4, v, 1, pick(v)); at(4, v, 2, pick(v)); }
        break;
      case 'tunnel':
        // A covered corridor with two blocks of headroom: RUN it, don't jump it.
        for (let u = 2; u <= 4; u++) {
          for (const v of [-1, w]) { at(u, v, 1, pick(1)); at(u, v, 2, pick(1)); at(u, v, 3, pick(1)); }
          for (let v = -1; v <= w; v++) at(u, v, 3, u === 3 ? Block.RuneGlass : palette.trim);
        }
        break;
      case 'pit':
        for (let v = 0; v < w; v++) hole(3, v, 0);
        for (let v = 0; v < w; v++) for (let dy = -1; dy >= -3; dy--) hole(3, v, dy);
        at(3, w >> 1, -3, Block.RuneGlass);
        break;
      case 'teeth':
        for (let v = 0; v < w; v += 2) at(2, v, 1, pick(1));
        for (let v = 1; v < w; v += 2) at(4, v, 1, pick(1));
        break;
      case 'ledge': {
        for (const side of [-1, w])
          for (let u = 0; u < d; u++) { at(u, side, 1, pick(1)); at(u, side, 2, pick(1)); at(u, side, 3, u === d >> 1 ? Block.RuneGlass : pick(1)); }
        break;
      }
      case 'launch':
      case 'boost':
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
  // Start terrace behind the first pad.
  for (let dz = 1; dz <= 5; dz++)
    for (let dx = -3; dx <= 3; dx++)
      put(cellX(start) + dx, start.y - 1, cellZ(start) - 2 - dz, dz === 5 || Math.abs(dx) === 3 ? palette.trim : palette.stone, start);

  const steps: ParkourPlatform[][] = [];
  for (const p of platforms) (steps[p.order] ??= []).push(p);
  const ys = platforms.map(p => p.y);

  // ── The podium, just inside the sanctuary ──
  const podZ = cellZ(finish) + 11;
  // Symmetric: the winner in the middle, matching steps either side.
  const podium: PartyVec3[] = [[0, 3], [-3, 2], [3, 2], [-6, 1]].map(([dx, dy]) => ({
    x: cellX(finish) + dx + .5, y: finish.y + dy, z: podZ + .5,
  }));

  // ── The dragon's flight line ──
  const raw = steps.map((st) => {
    const p = st[0];
    const sec = sections[p.section];
    const x = p.x, z = p.z;
    let y = p.y + 6;
    if (sec?.ceiling !== undefined) y = Math.max(y, sec.ceiling);
    return { x, y, z };
  });
  const dragonPath = raw.map((pt, i) => {
    const a = raw[Math.max(0, i - 1)], b = raw[Math.min(raw.length - 1, i + 1)];
    return { x: (a.x + pt.x * 2 + b.x) / 4, y: (a.y + pt.y * 2 + b.y) / 4, z: (a.z + pt.z * 2 + b.z) / 4 };
  });
  const lair = { x: start.x, y: start.y + 1, z: 6 };

  return {
    variant: { theme: themeIndex, pieces: sections.map(s => s.piece) },
    platforms, steps, cells, start, finish, sections, spaces, podium, dragonPath, lair,
    lowY: Math.min(...ys), highY: Math.max(...ys),
  };
}

/** The pads a racer at `progress` is aiming for next. */
export function parkourNext(course: ParkourCourse, progress: number): readonly ParkourPlatform[] {
  return course.steps[progress + 1] ?? [];
}
/** Number of jumps from the start pad to the finish. */
export function parkourLength(course: ParkourCourse): number {
  return course.steps.length - 1;
}
const solidCells = new WeakMap<ParkourCourse, Set<number>>();
/** Somewhere on pad `p` a body can stand: solid underfoot and two clear
 *  blocks above (so never inside a hurdle bar, a wall or a lit post, and never
 *  over a pit). The free cell nearest `near` (venue-local), else the centre. */
export function parkourStandSpot(course: ParkourCourse, p: ParkourPlatform, near?: { x: number; z: number }):
  { x: number; y: number; z: number } {
  let solid = solidCells.get(course);
  if (!solid) {
    solid = new Set();
    for (const c of course.cells) if (c.block !== Block.Air) solid.add((c.y * VENUE_Z + c.z) * VENUE_X + c.x);
    for (const c of course.cells) if (c.block === Block.Air) solid.delete((c.y * VENUE_Z + c.z) * VENUE_X + c.x);
    solidCells.set(course, solid);
  }
  const has = (x: number, y: number, z: number) => solid!.has((y * VENUE_Z + z) * VENUE_X + x);
  const x0 = Math.floor(p.x - p.width / 2), z0 = Math.floor(p.z - p.depth / 2);
  const want = near ?? { x: p.x, z: p.z };
  let best: { x: number; y: number; z: number } | null = null, bestD = Infinity;
  for (let x = x0; x < x0 + p.width; x++)
    for (let z = z0; z < z0 + p.depth; z++) {
      if (!has(x, p.y - 1, z) || has(x, p.y, z) || has(x, p.y + 1, z)) continue;
      const d = Math.hypot(x + .5 - want.x, z + .5 - want.z);
      if (d < bestD) { bestD = d; best = { x: x + .5, y: p.y, z: z + .5 }; }
    }
  return best ?? { x: p.x, y: p.y, z: p.z };
}

/** The set piece a course order belongs to, if any. */
export function parkourSectionAt(course: ParkourCourse, order: number): ParkourSection | null {
  return course.sections.find(s => order >= s.fromOrder && order <= s.toOrder) ?? null;
}
