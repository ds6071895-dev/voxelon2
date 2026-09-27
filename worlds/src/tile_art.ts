// Worlds' own art for every block and item a player actually sees in its
// three games and on the title landscape. These painters replace VOXELON's
// originals tile by tile (see createAtlas in textures.ts).
//
// The house style: every material gets a small hand-picked palette (4-6
// shades, dark to light) and its detail is built from shapes — bricks with a
// lit top edge and a shadowed foot, knitted stitches, bark plates, clumped
// leaves — rather than per-pixel noise. Noise is tileable (period 16), so no
// face shows a seam against its neighbour. Colours here are FINAL: these tiles
// skip the atlas-wide saturation pass the old art relied on, which is what
// turned sand neon and dirt orange.

import { Tile } from './blocks';
import { hash2 } from './noise';

export type RGBA = [number, number, number, number];
export interface Canvas16 {
  set(x: number, y: number, c: RGBA): void;
  fill(fn: (x: number, y: number) => RGBA): void;
}
type Paint = (p: Canvas16, seed: number) => void;

const N = 16;
const CLEAR: RGBA = [0, 0, 0, 0];

function hex(h: number, a = 255): RGBA { return [(h >> 16) & 255, (h >> 8) & 255, h & 255, a]; }
function ramp(...hs: number[]): RGBA[] { return hs.map((h) => hex(h)); }
function mix(a: RGBA, b: RGBA, t: number): RGBA {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, a[3] + (b[3] - a[3]) * t];
}
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/** 4x4 Bayer matrix in [-.5, .5): ordered dither between palette steps. */
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => v / 16 - .5);
function dither(x: number, y: number): number { return BAYER[(y & 3) * 4 + (x & 3)]; }

/** A palette entry for a 0..1 value, dithered so gradients read as pixel art. */
function pick(pal: RGBA[], t: number, x: number, y: number, amount = .8): RGBA {
  const v = clamp01(t) * (pal.length - 1) + dither(x, y) * amount;
  return pal[Math.max(0, Math.min(pal.length - 1, Math.round(v)))];
}

/** Tileable value noise over the 16px tile: `cell` must divide 16. */
function tnoise(seed: number, x: number, y: number, cell: number): number {
  const period = N / cell;
  const gx = x / cell, gy = y / cell;
  const x0 = Math.floor(gx), y0 = Math.floor(gy);
  const fx = gx - x0, fy = gy - y0;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const v = (ix: number, iy: number) => hash2(seed, ((ix % period) + period) % period, ((iy % period) + period) % period);
  const a = v(x0, y0) + (v(x0 + 1, y0) - v(x0, y0)) * sx;
  const b = v(x0, y0 + 1) + (v(x0 + 1, y0 + 1) - v(x0, y0 + 1)) * sx;
  return a + (b - a) * sy;
}
/** Three octaves of tileable noise, 0..1. */
function tfbm(seed: number, x: number, y: number): number {
  return tnoise(seed, x, y, 8) * .5 + tnoise(seed ^ 0x55, x, y, 4) * .32 + tnoise(seed ^ 0xaa, x, y, 2) * .18;
}
function rnd(seed: number, x: number, y: number): number { return hash2(seed, x, y); }

/** Paint a per-pixel buffer, then outline its opaque shape (sprites). */
class Grid {
  readonly px: (RGBA | null)[] = new Array(N * N).fill(null);
  get(x: number, y: number): RGBA | null { return x < 0 || y < 0 || x >= N || y >= N ? null : this.px[y * N + x]; }
  put(x: number, y: number, c: RGBA): void { if (x >= 0 && y >= 0 && x < N && y < N) this.px[y * N + x] = c; }
  outline(c: RGBA): void {
    const add: [number, number][] = [];
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      if (this.get(x, y)) continue;
      if (this.get(x - 1, y) || this.get(x + 1, y) || this.get(x, y - 1) || this.get(x, y + 1)) add.push([x, y]);
    }
    for (const [x, y] of add) this.put(x, y, c);
  }
  to(p: Canvas16): void { p.fill((x, y) => this.px[y * N + x] ?? CLEAR); }
}

// ── Masonry helpers ─────────────────────────────────────────────────────────

interface Brick { x0: number; y0: number; w: number; h: number; id: number }
/** Which brick of a running bond a pixel belongs to. Rows `h` tall, bricks
 *  `w` wide, alternate rows offset by half a brick. Wraps at 16. */
function bondAt(x: number, y: number, w: number, h: number, offset = w / 2): Brick {
  const row = Math.floor(y / h);
  const shift = row % 2 ? offset : 0;
  const bx = Math.floor((((x + shift) % N) + N) % N / w);
  return { x0: ((bx * w - shift) % N + N) % N, y0: row * h, w, h, id: row * 8 + bx };
}
/** Position inside a brick: local u,v and whether on its mortar line. */
function inBrick(x: number, y: number, b: Brick): { u: number; v: number; mortar: boolean } {
  const u = ((x - b.x0) % N + N) % N, v = y - b.y0;
  return { u, v, mortar: u === b.w - 1 || v === b.h - 1 };
}

/** Bevel light: +1 on the lit top/left rim of a rect, -1 on its shadowed
 *  bottom/right rim, 0 inside. */
function bevel(u: number, v: number, w: number, h: number): number {
  if (v === 0 || u === 0) return 1;
  if (v === h - 1 || u === w - 1) return -1;
  return 0;
}

// ── Terrain ─────────────────────────────────────────────────────────────────

const STONE = ramp(0x61646c, 0x72757d, 0x81848c, 0x8e9199, 0x9b9ea6, 0xa9acb3);
const paintStone: Paint = (p, seed) => {
  p.fill((x, y) => {
    let t = tfbm(seed, x, y) * 1.25 - .12;
    // Faint strata and the odd hairline crack.
    const crack = rnd(seed ^ 3, x >> 2, y) > .93 && (x + y) % 4 !== 0;
    if (crack) t -= .45;
    return pick(STONE, t, x, y, .9);
  });
};

const DIRT = ramp(0x4f3421, 0x5d3e27, 0x6b4a2f, 0x795536, 0x86613f, 0x936d48);
function dirtAt(seed: number, x: number, y: number): RGBA {
  let t = tfbm(seed, x, y) * 1.2 - .08;
  const r = rnd(seed ^ 9, x, y);
  if (r > .94) t += .45;          // a pebble
  else if (r < .06) t -= .4;       // a dark crumb
  return pick(DIRT, t, x, y, .9);
}
const paintDirt: Paint = (p, seed) => p.fill((x, y) => dirtAt(seed, x, y));

/** Grayscale grass: the mesher multiplies in the valley's grass colour. */
const GRASS_GRAY = ramp(0x8c8c8c, 0xa2a2a2, 0xb6b6b6, 0xc8c8c8, 0xd9d9d9, 0xe8e8e8);
const paintGrassTop: Paint = (p, seed) => {
  p.fill((x, y) => {
    // Short blades: vertical streaks two pixels tall, lit at the tip.
    const blade = rnd(seed, x, y >> 1);
    let t = tfbm(seed ^ 1, x, y) * .9 + blade * .35 - .1;
    if ((y & 1) === 0 && blade > .78) t += .3;
    return pick(GRASS_GRAY, t, x, y, .7);
  });
};

const FRINGE = ramp(0x5f9f3e, 0x6eb049, 0x7dbf54, 0x8ccc60, 0x9dd86d);
const paintGrassSide: Paint = (p, seed) => {
  p.fill((x, y) => dirtAt(seed, x, y));
  for (let x = 0; x < N; x++) {
    // Blades hang 3-5 pixels, and a few longer drips reach further down.
    let depth = 3 + Math.floor(rnd(seed ^ 31, x, 0) * 3);
    if (rnd(seed ^ 77, x, 1) > .8) depth += 2;
    for (let y = 0; y < depth; y++) {
      const t = .95 - y / (depth + 1) * .7 + (rnd(seed ^ 5, x, y) - .5) * .3;
      p.set(x, y, pick(FRINGE, t, x, y, .6));
    }
    // A soft shadow where the turf overhangs the soil.
    p.set(x, depth, mix(dirtAt(seed, x, depth), hex(0x2e2016), .45));
  }
};

const SAND = ramp(0xcbb481, 0xd6c08c, 0xdfca98, 0xe7d4a4, 0xeedcaf, 0xf4e5bd);
const paintSand: Paint = (p, seed) => {
  p.fill((x, y) => {
    // Wind ripples: gentle diagonal bands, plus scattered grains.
    const ripple = Math.sin((y * 1.7 + x * .35 + tnoise(seed, x, y, 8) * 5) * .95) * .12;
    let t = tfbm(seed, x, y) * .9 + ripple + .08;
    const g = rnd(seed ^ 4, x, y);
    if (g > .95) t += .3; else if (g < .05) t -= .3;
    return pick(SAND, t, x, y, .8);
  });
};

const paintSandstone: Paint = (p, seed) => {
  p.fill((x, y) => {
    // Three strata with a darker parting between them.
    const band = y < 4 ? .75 : y < 10 ? .55 : .42;
    let t = band + (tnoise(seed, x, y, 4) - .5) * .25;
    if (y === 3 || y === 9) t -= .3;
    if (y === 0) t += .2;
    return pick(SAND, t, x, y, .6);
  });
};
const paintSandstoneTop: Paint = (p, seed) => {
  p.fill((x, y) => {
    const edge = x === 0 || y === 0 || x === 15 || y === 15;
    let t = .6 + (tfbm(seed, x, y) - .5) * .35;
    if (edge) t -= .25;
    return pick(SAND, t, x, y, .6);
  });
};

const paintCobblestone: Paint = (p, seed) => {
  // Voronoi stones in a wrapping tile: each pixel belongs to its nearest
  // centre; where two centres tie, there is mortar.
  const pts: [number, number, number][] = [];
  for (let i = 0; i < 9; i++) pts.push([rnd(seed, i, 1) * N, rnd(seed, i, 2) * N, rnd(seed, i, 3)]);
  const near = (x: number, y: number) => {
    let d1 = 1e9, d2 = 1e9, id = 0;
    for (let i = 0; i < pts.length; i++)
      for (const ox of [-N, 0, N]) for (const oy of [-N, 0, N]) {
        const d = Math.hypot(pts[i][0] + ox - x, pts[i][1] + oy - y);
        if (d < d1) { d2 = d1; d1 = d; id = i; } else if (d < d2) d2 = d;
      }
    return { id, edge: d2 - d1 };
  };
  p.fill((x, y) => {
    const c = near(x + .5, y + .5);
    if (c.edge < 1.1) return pick(STONE, .02, x, y, 0);
    const up = near(x + .5, y - .5), left = near(x - .5, y + .5);
    const down = near(x + .5, y + 1.5), right = near(x + 1.5, y + .5);
    let t = .35 + pts[c.id][2] * .35 + (tnoise(seed ^ 7, x, y, 2) - .5) * .2;
    if (up.id !== c.id || left.id !== c.id) t += .3;
    if (down.id !== c.id || right.id !== c.id) t -= .25;
    return pick(STONE, t, x, y, .5);
  });
};

// ── Wood ────────────────────────────────────────────────────────────────────

/** Bark: vertical plates split by dark furrows. */
function barkSide(pal: RGBA[], furrowEvery: number) {
  return (p: Canvas16, seed: number): void => {
    p.fill((x, y) => {
      const plate = Math.floor(x / furrowEvery);
      const u = x % furrowEvery;
      let t = .45 + rnd(seed, plate, Math.floor((y + plate * 5) / 5)) * .35 + (tnoise(seed ^ 3, x, y, 4) - .5) * .25;
      if (u === 0) t -= .45;                   // furrow
      else if (u === 1) t += .18;              // lit plate edge
      if (rnd(seed ^ 8, plate, y) > .9) t -= .3; // a split in the plate
      return pick(pal, t, x, y, .6);
    });
  };
}
/** Birch / cherry bark: smooth skin with horizontal lenticels. */
function bandedBark(pal: RGBA[], mark: RGBA, markRate: number) {
  return (p: Canvas16, seed: number): void => {
    p.fill((x, y) => {
      const t = .55 + (tnoise(seed, x, y, 4) - .5) * .35 + (x === 0 ? -.2 : x === 15 ? -.1 : 0);
      return pick(pal, t, x, y, .6);
    });
    for (let y = 0; y < N; y++) {
      if (rnd(seed ^ 11, 0, y) > markRate) continue;
      const x0 = Math.floor(rnd(seed ^ 12, 1, y) * N), len = 2 + Math.floor(rnd(seed ^ 13, 2, y) * 4);
      for (let i = 0; i < len; i++) p.set((x0 + i) % N, y, mark);
    }
  };
}
/** End grain: a bark rim and growth rings around a pith. */
function logTop(bark: RGBA[], wood: RGBA[]) {
  return (p: Canvas16, seed: number): void => {
    p.fill((x, y) => {
      if (x === 0 || y === 0 || x === 15 || y === 15) return pick(bark, .5 + (rnd(seed, x, y) - .5) * .5, x, y, .5);
      const d = Math.hypot(x - 7.5, y - 7.5) + (tnoise(seed, x, y, 4) - .5) * 1.2;
      const ring = Math.floor(d * .9) % 2 === 0;
      let t = .7 - d / 12 + (ring ? .15 : -.12);
      if (d < 1.2) t = .2; // pith
      if (x === 1 || y === 1) t += .1;
      if (x === 14 || y === 14) t -= .15;
      return pick(wood, t, x, y, .5);
    });
  };
}

const OAK_BARK = ramp(0x3a2816, 0x48331d, 0x574024, 0x654b2c, 0x735733);
const OAK_WOOD = ramp(0x8a6636, 0x9c7641, 0xae874d, 0xbe965a, 0xcca567);
const BIRCH_BARK = ramp(0xb9b4a8, 0xcac6bb, 0xd9d6cd, 0xe6e4dc, 0xf1efe9);
const BIRCH_WOOD = ramp(0xb89f6c, 0xc8b07c, 0xd6bf8b, 0xe2cc99);
const SPRUCE_BARK = ramp(0x241810, 0x2f2015, 0x3a291b, 0x453121, 0x503a28);
const SPRUCE_WOOD = ramp(0x6a4c2c, 0x7a5834, 0x8a653d, 0x987146);
const CHERRY_BARK = ramp(0x2e1a1d, 0x3b2226, 0x4a2b30, 0x58353a, 0x664044);
const CHERRY_WOOD = ramp(0xb0746f, 0xc3857f, 0xd3968f, 0xe0a79f);

/** Four horizontal boards with grain, a shadowed seam and staggered joints. */
function planks(pal: RGBA[]) {
  return (p: Canvas16, seed: number): void => {
    p.fill((x, y) => {
      const board = y >> 2, v = y & 3;
      const joint = board % 2 ? 11 : 4;
      const grain = tnoise(seed ^ board, x * .5, v * 2 + board * 4, 2);
      let t = .5 + (rnd(seed, board, 0) - .5) * .25 + (grain - .5) * .35;
      if (v === 0) t += .2;              // lit top edge of the board
      if (v === 3) t = .02;              // seam
      if (x === joint && v !== 3) t -= .35;
      if (x === joint + 1 && v !== 3) t += .12;
      if (rnd(seed ^ 3, x, y) > .96 && v === 1) t -= .3; // a knot
      return pick(pal, t, x, y, .5);
    });
  };
}
const PLANK_OAK = ramp(0x6f4f2a, 0x87633a, 0x9c7445, 0xae8551, 0xc0965e, 0xcfa56b);
const PLANK_CHERRY = ramp(0x9a615c, 0xb0746e, 0xc2857e, 0xd1968e, 0xdea7a0, 0xe8b7b0);

// ── Foliage and plants ──────────────────────────────────────────────────────

/** Clumped leaves: rounded clusters, lit up-left, with a few see-through gaps. */
function leaves(pal: RGBA[], extra?: (x: number, y: number, seed: number) => RGBA | null) {
  return (p: Canvas16, seed: number): void => {
    p.fill((x, y) => {
      const e = extra?.(x, y, seed);
      if (e) return e;
      const n = tnoise(seed, x, y, 4), fine = rnd(seed ^ 2, x, y);
      // A few ragged gaps, never a regular lattice of them.
      if (n < .22 && fine > .55) return CLEAR;
      if (fine > .95) return CLEAR;
      const lit = tnoise(seed, x - 1, y - 1, 4) - n;
      const t = .25 + n * .55 - lit * 1.4 + (fine - .5) * .2;
      return pick(pal, t, x, y, .6);
    });
  };
}
const LEAF_GRAY = ramp(0x5c5c5c, 0x767676, 0x8f8f8f, 0xa8a8a8, 0xc2c2c2, 0xd8d8d8);
const LEAF_BIRCH = ramp(0x3f6a2a, 0x4f7e33, 0x61923d, 0x74a548, 0x88b755, 0x9cc662);
const LEAF_SPRUCE = ramp(0x1d3a2a, 0x244633, 0x2c533d, 0x356147, 0x3f6e52, 0x4a7c5d);
const LEAF_CHERRY = ramp(0xc56a92, 0xd47ea3, 0xe093b4, 0xeaa8c4, 0xf2bdd3, 0xf9d3e2);
const blossom = (x: number, y: number, seed: number): RGBA | null =>
  rnd(seed ^ 0x6b, x, y) > .95 ? hex(0xfff4f8) : rnd(seed ^ 0x6c, x, y) > .975 ? hex(0x6f9a4a) : null;

/** Tinted grass tufts for the cross-shaped plant. */
const paintTallGrass: Paint = (p, seed) => {
  const g = new Grid();
  for (let i = 0; i < 7; i++) {
    const x0 = 1 + Math.floor(rnd(seed, i, 0) * 14), h = 6 + Math.floor(rnd(seed, i, 1) * 8);
    const lean = rnd(seed, i, 2) < .5 ? -1 : 1;
    for (let k = 0; k < h; k++) {
      const x = x0 + (k > h * .6 ? lean : 0), y = 15 - k;
      g.put(x, y, pick(GRASS_GRAY, .25 + k / h * .7, x, y, .3));
    }
  }
  g.to(p);
};

function flower(petals: RGBA[], centre: RGBA, shape: 'round' | 'cup') {
  return (p: Canvas16, seed: number): void => {
    const g = new Grid();
    const stem = ramp(0x2f6b25, 0x3f8430, 0x51993b);
    for (let y = 8; y < 16; y++) g.put(7 + (y > 12 ? 1 : 0), y, stem[y % 2]);
    // Two leaves off the stem.
    g.put(6, 12, stem[1]); g.put(5, 11, stem[2]); g.put(9, 13, stem[1]); g.put(10, 12, stem[2]);
    if (shape === 'round') {
      for (let y = 3; y <= 8; y++) for (let x = 5; x <= 10; x++) {
        const d = Math.hypot(x - 7.5, y - 5.5);
        if (d > 2.9) continue;
        g.put(x, y, pick(petals, .9 - d / 3.2 + (y < 5 ? .2 : 0), x, y, .4));
      }
      g.put(7, 5, centre); g.put(8, 5, centre); g.put(7, 6, centre);
    } else {
      // A four-petal cup, lit on top.
      const cells = [[6, 3], [7, 3], [8, 3], [9, 3], [5, 4], [6, 4], [7, 4], [8, 4], [9, 4], [10, 4],
        [5, 5], [6, 5], [9, 5], [10, 5], [5, 6], [6, 6], [7, 6], [8, 6], [9, 6], [10, 6], [6, 7], [7, 7], [8, 7], [9, 7]];
      for (const [x, y] of cells) g.put(x, y, pick(petals, 1 - (y - 3) / 5, x, y, .4));
      g.put(7, 5, centre); g.put(8, 5, centre);
    }
    void seed;
    g.to(p);
  };
}

const paintWater: Paint = (p, seed) => {
  const pal = [hex(0xc4dcee, 190), hex(0xd2e6f4, 195), hex(0xdfeef9, 200), hex(0xecf6fd, 205), hex(0xf8fcff, 210)];
  p.fill((x, y) => {
    const wave = Math.sin((x * .8 + y * 1.6 + tnoise(seed, x, y, 8) * 6)) * .5 + .5;
    const t = .35 + (tnoise(seed ^ 1, x, y, 4) - .5) * .4 + (wave > .86 ? .45 : 0);
    return pick(pal, t, x, y, .5);
  });
};

const SNOW = ramp(0xd3dfec, 0xe0e9f3, 0xebf1f8, 0xf4f8fc, 0xffffff);
const paintSnow: Paint = (p, seed) => {
  p.fill((x, y) => {
    let t = .55 + (tfbm(seed, x, y) - .5) * .6;
    if (rnd(seed ^ 5, x, y) > .97) t = 1;
    return pick(SNOW, t, x, y, .6);
  });
};
const paintSnowySide: Paint = (p, seed) => {
  p.fill((x, y) => dirtAt(seed, x, y));
  for (let x = 0; x < N; x++) {
    let depth = 3 + Math.floor(rnd(seed ^ 31, x, 0) * 2);
    if (rnd(seed ^ 77, x, 1) > .78) depth += 2;
    for (let y = 0; y < depth; y++) p.set(x, y, pick(SNOW, .9 - y / depth * .55, x, y, .5));
    p.set(x, depth, mix(dirtAt(seed, x, depth), hex(0x2e2016), .4));
  }
};

const paintGlass: Paint = (p, seed) => {
  void seed;
  p.fill((x, y) => {
    const edge = x === 0 || y === 0 || x === 15 || y === 15;
    if (edge) return (x + y) % 5 === 0 ? hex(0xf2fbff) : hex(0xbad8e4);
    if ((x + y === 5 || x + y === 6) && x > 1 && x < 6) return hex(0xffffff, 230);
    if (x + y === 20 && x > 9) return hex(0xe6f6fc, 220);
    return CLEAR;
  });
};

// ── Arena masonry ───────────────────────────────────────────────────────────

/** Running-bond bricks with lit tops, shadowed feet and per-brick tone. */
function bricks(pal: RGBA[], mortar: RGBA, opts: {
  w?: number; h?: number; texture?: number;
  deco?: (x: number, y: number, u: number, v: number, b: Brick, seed: number) => RGBA | null;
  mortarDeco?: (x: number, y: number, seed: number) => RGBA | null;
} = {}) {
  const w = opts.w ?? 8, h = opts.h ?? 4, tex = opts.texture ?? .25;
  return (p: Canvas16, seed: number): void => {
    p.fill((x, y) => {
      const b = bondAt(x, y, w, h);
      const { u, v, mortar: m } = inBrick(x, y, b);
      if (m) return opts.mortarDeco?.(x, y, seed) ?? mortar;
      const deco = opts.deco?.(x, y, u, v, b, seed);
      if (deco) return deco;
      let t = .45 + (rnd(seed, b.id, 0) - .5) * .3 + (tnoise(seed ^ 3, x, y, 4) - .5) * tex;
      const bv = bevel(u, v, w - 1, h - 1);
      t += bv > 0 ? .25 : bv < 0 ? -.2 : 0;
      return pick(pal, t, x, y, .55);
    });
  };
}

const GILDED_STONE = ramp(0xa99d84, 0xbfb398, 0xd1c6ab, 0xe0d6bd, 0xece4ce, 0xf6f0de);
const GOLD = ramp(0x9c6a17, 0xc28a24, 0xe0a932, 0xf3c653, 0xffe08a);
const paintGildedBrick = bricks(GILDED_STONE, hex(0x7f6c4c), {
  // A thread of gold inlaid along the top of every brick.
  deco: (x, y, u, v) => v === 0 && u >= 1 && u <= 5 ? pick(GOLD, .7 - u / 14, x, y, .3) : null,
});

const LAVENDER = ramp(0x645a7a, 0x776c8e, 0x8a80a2, 0x9e95b5, 0xb2aac7, 0xc6bfd8);
const paintCarvedBrick: Paint = (p, seed) => {
  // One chiselled panel: a raised frame, a sunken field and a carved lozenge.
  p.fill((x, y) => {
    const ring = Math.min(x, y, 15 - x, 15 - y);
    const d = Math.abs(x - 7.5) + Math.abs(y - 7.5);
    let t = .5 + (tnoise(seed, x, y, 4) - .5) * .2;
    if (ring === 0) t = x === 0 || y === 0 ? .78 : .2;
    else if (ring === 1) t = x === 1 || y === 1 ? .9 : .32;
    else if (ring === 2) t = x === 2 || y === 2 ? .12 : .8;       // step down into the field
    else if (d < 3.2) t = .88 - (x + y > 15 ? .3 : 0);
    else if (d < 4.2) t = x + y > 15 ? .72 : .15;                   // the lozenge's cut edge
    return pick(LAVENDER, t, x, y, .4);
  });
};

const BLUE_GLAZE = ramp(0x2f4a86, 0x3a5a9c, 0x476cb0, 0x587fc2, 0x6c94d2, 0x86aee0);
const paintPrismBrick = bricks(BLUE_GLAZE, hex(0x1c2745), {
  texture: .12,
  deco: (x, y, u, v, b, seed) => {
    // A glassy highlight streak across each glazed brick.
    if (v === 1 && u >= 1 && u <= 3) return hex(0xbfe3ff);
    if (u === 5 && v === 2 && rnd(seed, b.id, 4) > .5) return hex(0x9fd6ff);
    return null;
  },
});

const PEARL = ramp(0xb9ab93, 0xcfc3ad, 0xe0d6c4, 0xece4d6, 0xf5f0e7, 0xfdfbf6);
const paintPearlTile: Paint = (p, seed) => {
  // Four polished 8x8 tiles with a pearly sheen sweeping across each.
  p.fill((x, y) => {
    const u = x & 7, v = y & 7;
    if (u === 7 || v === 7) return hex(0xa39478);
    let t = .55 + (u + v) * -.025 + (tnoise(seed, x, y, 8) - .5) * .15;
    const bv = bevel(u, v, 7, 7);
    t += bv > 0 ? .3 : bv < 0 ? -.25 : 0;
    const c = pick(PEARL, t, x, y, .5);
    // Iridescence: a faint pink-to-blue drift along the diagonal.
    const s = Math.sin((u - v) * .6);
    return mix(c, s > 0 ? hex(0xf6dde6) : hex(0xdbe8f5), Math.abs(s) * .25);
  });
};

const LIMESTONE = ramp(0x9ea8ad, 0xb1bbbf, 0xc3cccf, 0xd3dadc, 0xe1e7e8, 0xeef2f2);
const paintLimestone: Paint = (p, seed) => {
  // Two long blocks, with a curled fossil and a thread of blue light.
  p.fill((x, y) => {
    const v = y & 7;
    if (v === 7 || (x === ((y >> 3) ? 3 : 11))) return hex(0x7d878d);
    let t = .5 + (tfbm(seed, x, y) - .5) * .5 + (v === 0 ? .2 : v === 6 ? -.15 : 0);
    // Fossil: a small spiral in the upper block.
    const fx = x - 6, fy = y - 3, r = Math.hypot(fx, fy), a = Math.atan2(fy, fx);
    if (r < 2.6 && Math.abs(((r - a * .45) % 1.2 + 1.2) % 1.2 - .6) < .25) t -= .35;
    // Pinpricks of the glow the stone is named for.
    if (rnd(seed ^ 9, x, y) > .975 && v > 0 && v < 6) return hex(0x9ff0ff);
    return pick(LIMESTONE, t, x, y, .5);
  });
};

const LILAC = ramp(0x9a86ba, 0xab98c8, 0xbcaad4, 0xcbbcdf, 0xd9cde9, 0xe6ddf2);
const paintSpectralMarble: Paint = (p, seed) => {
  p.fill((x, y) => {
    const n = tfbm(seed, x, y);
    // Veins where the noise crosses a contour, a darker one and a bright one.
    const warp = n + Math.sin((x + y) * .35) * .12;
    if (Math.abs(warp - .5) < .022) return LILAC[0];
    if (Math.abs(warp - .64) < .016) return LILAC[5];
    return pick(LILAC, .42 + (n - .5) * .45, x, y, .5);
  });
};

const JADE = ramp(0x2f7858, 0x3a8a66, 0x479d75, 0x57ae85, 0x6bbf96, 0x85cfaa);
const paintJadeMosaic: Paint = (p, seed) => {
  // Little 4x4 tesserae, each its own shade of jade, with a gilt dot at the
  // meeting of every four.
  p.fill((x, y) => {
    const u = x & 3, v = y & 3;
    if (u === 3 && v === 3 && ((x >> 2) + (y >> 2)) % 2 === 0) return hex(0xe9c860);
    if (u === 3 || v === 3) return hex(0x21513c);
    const t = .2 + rnd(seed, x >> 2, y >> 2) * .6 + (u === 0 || v === 0 ? .2 : 0) + (u === 2 && v === 2 ? -.15 : 0);
    return pick(JADE, t, x, y, .3);
  });
};

const CERAMIC = ramp(0xd9bfa0, 0xe6ceb0, 0xf0dbc0, 0xf7e7cf, 0xfdf3e2);
const RUST = ramp(0xa04a24, 0xbd5d2c, 0xd57335, 0xe98b44);
const paintFurnaceCeramic: Paint = (p, seed) => {
  // Glazed 8x8 tiles, each painted with a quatrefoil and a coloured rim.
  p.fill((x, y) => {
    const u = x & 7, v = y & 7;
    if (u === 7 || v === 7) return hex(0x9c7a5c);
    const cx = u - 3, cy = v - 3;
    const petal = Math.min(Math.hypot(cx - 1.4, cy), Math.hypot(cx + 1.4, cy), Math.hypot(cx, cy - 1.4), Math.hypot(cx, cy + 1.4));
    if (u === 0 || v === 0 || u === 6 || v === 6) return pick(RUST, u === 0 || v === 0 ? .8 : .3, x, y, .3);
    if (Math.abs(cx) < .6 && Math.abs(cy) < .6) return hex(0xf5c75b);
    if (petal < 1.1) return pick(RUST, .6, x, y, .3);
    return pick(CERAMIC, .6 + (tnoise(seed, x, y, 4) - .5) * .3 - (u + v) * .02, x, y, .5);
  });
};

const OPAL = ramp(0x8fb1c8, 0xa3c2d6, 0xb6d2e3, 0xc7deeb, 0xd7e9f3, 0xe7f3fa);
const paintOpalBrick = bricks(OPAL, hex(0x5f7f96), {
  deco: (x, y, u, v, b, seed) => {
    // Fire in the stone: a few flecks of pink, cyan and gold.
    const r = rnd(seed ^ 0x33, x, y);
    if (u === 0 || v === 0) return null;
    return r > .955 ? hex(0xff9fcf) : r > .91 ? hex(0x7ff0ff) : r > .885 ? hex(0xffe28a) : null;
  },
});

const VAULT_STONE = ramp(0xa29888, 0xb4ab9c, 0xc5bdb0, 0xd4cdc2, 0xe1dbd2);
const SKY_TILE = ramp(0x2f5f93, 0x3d74aa, 0x4f89bf, 0x66a1d2, 0x82b8e2);
const paintVaultMosaic: Paint = (p, seed) => {
  // A lattice of blue diamonds set in pale stone, bordered in dark grout.
  p.fill((x, y) => {
    const d = Math.abs(((x + 4) & 7) - 3.5) + Math.abs(((y + 4) & 7) - 3.5);
    const dd = Math.abs((x & 7) - 3.5) + Math.abs((y & 7) - 3.5);
    if (Math.abs(d - 3.6) < .6) return hex(0x6f6557);
    if (d < 3) return pick(SKY_TILE, .75 - d / 4 + (x & 1 ? 0 : .08), x, y, .4);
    if (dd < 1.2) return hex(0xe7c65e);
    return pick(VAULT_STONE, .55 + (tnoise(seed, x, y, 4) - .5) * .4, x, y, .5);
  });
};

const EMBER_STONE = ramp(0x2f1814, 0x3d201a, 0x4c2920, 0x5b3327, 0x6a3e2f);
const paintEmberBrick = bricks(EMBER_STONE, hex(0x1d0f0c), {
  // Molten light seeping through the joints, brightest where they cross.
  mortarDeco: (x, y, seed) => {
    const r = tnoise(seed, x, y, 4);
    return r > .62 ? hex(0xffc15a) : r > .45 ? hex(0xf07a2a) : r > .32 ? hex(0x9a3a1c) : hex(0x1d0f0c);
  },
});

const MOSS_STONE = ramp(0x5c625c, 0x6c726b, 0x7c827a, 0x8b9189, 0x9aa097, 0xa9aea5);
const MOSS = ramp(0x3f6b2c, 0x4e7f35, 0x5f933f, 0x71a64a, 0x85b757);
const paintMossyBrick = bricks(MOSS_STONE, hex(0x3b3f3a), {
  deco: (x, y, u, v, b, seed) => {
    // Moss spills over the top of the bricks and creeps down.
    const n = tnoise(seed ^ 0x4d, x, y, 4);
    if (n > .58 - (v === 0 ? .15 : 0) - (v === 1 ? .05 : 0)) return pick(MOSS, n + (v === 0 ? .2 : 0), x, y, .5);
    return null;
  },
  mortarDeco: (x, y, seed) => tnoise(seed ^ 0x4d, x, y, 4) > .5 ? pick(MOSS, .2, x, y, 0) : null,
});

const BRONZE = ramp(0x4d3118, 0x6e4721, 0x8f5f2c, 0xad7a3b, 0xc9964f, 0xe2b66d);
const paintClockworkGrate: Paint = (p, seed) => {
  // A bronze frame over a dark well, with a toothed gear in the middle.
  p.fill((x, y) => {
    const ring = Math.min(x, y, 15 - x, 15 - y);
    const r = Math.hypot(x - 7.5, y - 7.5), a = Math.atan2(y - 7.5, x - 7.5);
    const tooth = Math.cos(a * 8) > .3;
    if (ring === 0) return pick(BRONZE, x === 0 || y === 0 ? .9 : .15, x, y, .3);
    if (ring === 1) return pick(BRONZE, .45, x, y, .3);
    if (r < 1.3) return hex(0x2a1b0f);
    if (r < 2.4) return pick(BRONZE, .95, x, y, .3);
    if (r < 4.6 || (r < 5.8 && tooth)) return pick(BRONZE, .75 - (x + y - 15) * .04, x, y, .5);
    if ((x === 4 || x === 11 || y === 4 || y === 11) && r > 5.8) return pick(BRONZE, .35, x, y, .3);
    return rnd(seed, x, y) > .9 ? hex(0x3a2716) : hex(0x1d140c);
  });
};

const paintRuneGlass: Paint = (p, seed) => {
  // Clear panes in a pale frame, with one glowing rune hanging in the glass.
  const rune = new Set<string>();
  const strokes: [number, number][] = [[7, 3], [8, 3], [7, 4], [8, 4], [7, 5], [8, 5], [7, 6], [8, 6], [7, 7], [8, 7], [7, 8], [8, 8],
    [7, 9], [8, 9], [7, 10], [8, 10], [7, 11], [8, 11], [7, 12], [8, 12], [5, 5], [6, 6], [10, 5], [9, 6], [4, 4], [11, 4],
    [5, 10], [6, 9], [10, 10], [9, 9], [4, 11], [11, 11]];
  for (const [x, y] of strokes) rune.add(`${x},${y}`);
  p.fill((x, y) => {
    if (x === 0 || y === 0 || x === 15 || y === 15) return (x + y) % 4 === 0 ? hex(0xf6ffff) : hex(0xa9d9e8);
    if (rune.has(`${x},${y}`)) return (x + y) % 3 === 0 ? hex(0xeaffff) : hex(0x6fe4ff);
    if ((x + y === 4 || x + y === 5) && x < 5) return hex(0xffffff, 220);
    void seed;
    return CLEAR;
  });
};

const IVORY = ramp(0xb8ae99, 0xcbc2ae, 0xdad2c0, 0xe7e1d2, 0xf2eee3, 0xfbf9f3);
const paintIvoryColumn: Paint = (p, seed) => {
  // Fluted shaft between a moulded capital and base.
  p.fill((x, y) => {
    if (y <= 1 || y >= 14) {
      const t = y === 0 || y === 14 ? .95 : .35;
      return pick(IVORY, t + (tnoise(seed, x, y, 4) - .5) * .15, x, y, .3);
    }
    const u = x % 4;
    const t = u === 0 ? .15 : u === 1 ? .9 : u === 2 ? .7 : .45;
    return pick(IVORY, t + (tnoise(seed, x, y, 4) - .5) * .12, x, y, .3);
  });
};

/** Lanterns: a caged frame round a glowing heart, rivets at the corners. */
function lantern(metal: RGBA[], glow: RGBA[]) {
  return (p: Canvas16, seed: number): void => {
    p.fill((x, y) => {
      const ring = Math.min(x, y, 15 - x, 15 - y);
      const bar = (x === 5 || x === 10) && ring > 1;
      if (ring === 0) return pick(metal, x === 0 || y === 0 ? .8 : .1, x, y, .3);
      if (ring === 1) {
        const rivet = (x === 1 || x === 14) && (y === 1 || y === 14);
        return rivet ? pick(metal, 1, x, y, 0) : pick(metal, .45, x, y, .3);
      }
      if (bar) return pick(metal, .6, x, y, .3);
      const d = Math.hypot(x - 7.5, y - 7.5) + (tnoise(seed, x, y, 4) - .5) * 1.5;
      return pick(glow, 1 - d / 6.5, x, y, .6);
    });
  };
}
const IRON_DARK = ramp(0x1e1b24, 0x2d2934, 0x3d3846, 0x4e4958, 0x625d6c);
const WROUGHT = ramp(0x2a1c12, 0x3a281a, 0x4b3524, 0x5d432e, 0x70523a);
const NAVY_METAL = ramp(0x1c2544, 0x28345a, 0x364470, 0x455688, 0x5a6c9e);
const BRASS = ramp(0x4e3510, 0x6d4b17, 0x8d6420, 0xab7c2b, 0xc99838);

const paintBasalt: Paint = (p, seed) => {
  const pal = ramp(0x2c2c32, 0x36363d, 0x404048, 0x4a4a53, 0x55555e, 0x61616a);
  // Columnar joints: vertical pillars of slightly different tone.
  p.fill((x, y) => {
    const col = Math.floor((x + (y >> 3)) / 4);
    const u = (x + (y >> 3)) % 4;
    let t = .35 + rnd(seed, col, y >> 3) * .35 + (tnoise(seed ^ 2, x, y, 4) - .5) * .2;
    if (u === 0) t -= .3; else if (u === 1) t += .15;
    if ((y & 7) === 7) t -= .25;
    return pick(pal, t, x, y, .6);
  });
};

const CLAY = ramp(0x7e3f26, 0x94502f, 0xa86039, 0xb96f44, 0xc88051);
const paintTerracotta: Paint = (p, seed) => {
  // Fired clay flags, crazed with hairline cracks: also the look of a crumble
  // tile about to go.
  p.fill((x, y) => {
    const u = x & 7, v = y & 7;
    if (u === 7 || v === 7) return hex(0x4f2414);
    const n = tnoise(seed, x, y, 4);
    const crack = Math.abs(n - .5) < .03 && rnd(seed ^ 2, x, y) > .25;
    let t = .5 + (tfbm(seed ^ 3, x, y) - .5) * .4 + (u === 0 || v === 0 ? .22 : u === 6 || v === 6 ? -.18 : 0);
    if (crack) t -= .55;
    return pick(CLAY, t, x, y, .5);
  });
};

/** Knitted wool: columns of V stitches, each lit on its left stroke. */
function wool(pal: RGBA[]) {
  return (p: Canvas16, seed: number): void => {
    p.fill((x, y) => {
      const u = x & 3, v = y & 3, arm = v >> 1;
      const left = u === arm, right = u === 3 - arm;
      let t = .42 + (tnoise(seed, x, y, 4) - .5) * .2;
      if (left) t += .3;
      else if (right) t += .08;
      else t -= .2;                                  // the gap between stitches
      if (rnd(seed ^ 1, x, y) > .96) t += .2;        // a stray fibre
      return pick(pal, t, x, y, .35);
    });
  };
}
const CRIMSON = ramp(0x7c1a22, 0x98232c, 0xb22f37, 0xc93f44, 0xdc5754, 0xea7466);
const COBALT = ramp(0x1c3a80, 0x244a98, 0x2e5bb0, 0x3b6ec4, 0x4f84d4, 0x6a9be0);

const AMBER = ramp(0x9b6519, 0xb77a22, 0xcf8f2e, 0xe0a33e, 0xecb755, 0xf5cb72);
const paintCrumbleTile: Paint = (p, seed) => {
  // Sun-baked amber flagstones, just starting to craze at the corners.
  p.fill((x, y) => {
    const u = x & 7, v = y & 7;
    if (u === 7 || v === 7) return hex(0x6e4413);
    let t = .5 + (tnoise(seed, x, y, 4) - .5) * .35;
    const bv = bevel(u, v, 7, 7);
    t += bv > 0 ? .28 : bv < 0 ? -.22 : 0;
    const craze = Math.abs(tnoise(seed ^ 5, x, y, 4) - .5) < .035 && (u + v < 5 || u + v > 9);
    if (craze) t -= .5;
    return pick(AMBER, t, x, y, .5);
  });
};

const GREEN_STONE = ramp(0x1f5a3a, 0x2a6d47, 0x378156, 0x459566, 0x57a877, 0x6cba89);
const paintBlinkStone: Paint = (p, seed) => {
  // Smooth green stone with a glowing ring rune: it flickers in and out.
  p.fill((x, y) => {
    const r = Math.hypot(x - 7.5, y - 7.5);
    const ring = Math.min(x, y, 15 - x, 15 - y);
    if (Math.abs(r - 4.8) < .7) return (x + y) % 3 === 0 ? hex(0xeafff2) : hex(0x8dffc2);
    if (r < 1.6) return hex(0xbfffe0);
    let t = .45 + (tnoise(seed, x, y, 8) - .5) * .35;
    if (ring === 0) t += x === 0 || y === 0 ? .3 : -.3;
    return pick(GREEN_STONE, t, x, y, .5);
  });
};

/** Jump pads: a dark plate in a lit frame, with rings (launch, straight up)
 *  or chevrons (boost, forward). */
function pad(lit: RGBA[], forward: boolean) {
  return (p: Canvas16, seed: number): void => {
    const plate = ramp(0x1e2230, 0x262b3b, 0x2f3547, 0x394054);
    p.fill((x, y) => {
      const ring = Math.min(x, y, 15 - x, 15 - y);
      if (ring === 0) return pick(lit, x === 0 || y === 0 ? .9 : .4, x, y, .3);
      if (ring === 1) return pick(plate, .1, x, y, 0);
      let on: boolean;
      if (forward) {
        const k = (y + Math.abs(x - 7.5) * 1.1) % 6;
        on = k < 2.2 && Math.abs(x - 7.5) < 5.5;
      } else {
        const r = Math.hypot(x - 7.5, y - 7.5);
        on = Math.abs(r - 5) < .75 || Math.abs(r - 2.4) < .7 || r < .8;
      }
      if (on) return pick(lit, .75 + (rnd(seed, x, y) - .5) * .3, x, y, .4);
      return pick(plate, .45 + (tnoise(seed, x, y, 4) - .5) * .4, x, y, .6);
    });
  };
}
const CYAN_LIGHT = ramp(0x2aa5c4, 0x46c3dd, 0x6ddcee, 0x9bedf8, 0xd2fbff);
const GOLD_LIGHT = ramp(0xb46f12, 0xd58d1d, 0xefaa32, 0xffc758, 0xffe39a);

const paintArenaRim: Paint = (p, seed) => {
  const obsidian = ramp(0x120d1d, 0x1a1329, 0x231a36, 0x2d2244, 0x392c54);
  p.fill((x, y) => {
    // Violet hazard chevrons running along a dark rim.
    const k = (x + Math.abs(y - 7.5)) % 8;
    if (y >= 5 && y <= 10 && k < 2.5) return (x + y) % 2 ? hex(0xc79bff) : hex(0xa56cf5);
    return pick(obsidian, .4 + (tnoise(seed, x, y, 4) - .5) * .6 + (y === 0 ? .4 : 0), x, y, .6);
  });
};

// ── Items ───────────────────────────────────────────────────────────────────

const OUTLINE = hex(0x17161c);
const STEEL = ramp(0x5f6674, 0x7d8594, 0x9aa2b0, 0xb8bfcb, 0xd7dce4, 0xf4f7fb);
const HANDLE = ramp(0x4a2f17, 0x62401f, 0x7a5129, 0x926334);

const paintIronAxe: Paint = (p) => {
  const g = new Grid();
  // Haft: a two-pixel diagonal from bottom-left to top-right, lit on one side.
  for (let i = 0; i <= 11; i++) {
    const x = 2 + i, y = 14 - i;
    g.put(x, y, HANDLE[2]);
    g.put(x + 1, y, HANDLE[i < 3 ? 0 : 1]);
  }
  // Leather grip at the butt.
  for (const [x, y] of [[3, 13], [4, 12], [4, 13], [5, 12]]) g.put(x, y, hex(0x2f2219));
  // Head: a flared bit on the left of the haft's top, a short poll behind.
  const rows: [number, number, number][] = [[1, 6, 9], [2, 5, 10], [3, 4, 10], [4, 4, 11], [5, 4, 10], [6, 5, 9], [7, 6, 8]];
  for (const [y, x0, x1] of rows)
    for (let x = x0; x <= x1; x++) {
      const edge = x === x0, near = x === x0 + 1;
      const t = edge ? 1 : near ? .8 : .55 - (x - x0) * .06 - (y - 1) * .04;
      g.put(x, y, pick(STEEL, t, x, y, .3));
    }
  for (const [x, y] of [[12, 3], [12, 4], [13, 4]]) g.put(x, y, STEEL[1]);
  g.put(11, 3, STEEL[2]);
  g.outline(OUTLINE);
  g.to(p);
};

const paintBridgeBow: Paint = (p) => {
  const g = new Grid();
  const wood = ramp(0x5a3a1c, 0x754c24, 0x8f5f2e, 0xa9743b);
  // Limb: a bulging arc from top-left to bottom-right; the string is the chord.
  for (let s = 0; s <= 60; s++) {
    const t = s / 60;
    const bx = 2 + t * 11, by = 2 + t * 11;
    const bulge = Math.sin(Math.PI * t) * 4.6;
    const x = Math.round(bx + bulge * .707), y = Math.round(by - bulge * .707);
    const grip = Math.abs(t - .5) < .1;
    g.put(x, y, grip ? hex(0x3a2a20) : wood[t < .12 || t > .88 ? 0 : 2]);
    if (!grip) g.put(x + 1, y, wood[1]);
  }
  for (let i = 3; i <= 12; i++) if (!g.get(i, i)) g.put(i, i, hex(0xe8e4da));
  g.put(2, 2, hex(0xd9c07a)); g.put(13, 13, hex(0xd9c07a)); // horn nocks
  g.outline(OUTLINE);
  g.to(p);
};

const paintBridgeArrow: Paint = (p) => {
  const g = new Grid();
  // Shaft on the diagonal, flint head top-right, fletching bottom-left.
  for (let i = 4; i <= 11; i++) g.put(i, 15 - i, i % 3 ? hex(0xb58a52) : hex(0x94703f));
  for (const [x, y, t] of [[12, 3, .45], [13, 2, .85], [12, 2, .7], [13, 3, .3], [11, 2, .55], [13, 1, 1], [14, 1, .9], [12, 1, .6], [14, 2, .5]] as [number, number, number][])
    g.put(x, y, pick(STEEL, t, x, y, 0));
  const feather = [hex(0xf2f2f0), hex(0xd9d6d0), hex(0xc9403e)];
  for (const [x, y, c] of [[2, 12, 0], [3, 12, 1], [2, 11, 0], [1, 11, 2], [3, 13, 0], [4, 13, 1], [3, 14, 0], [2, 13, 2], [1, 12, 2], [4, 12, 1]] as [number, number, number][])
    g.put(x, y, feather[c]);
  g.outline(OUTLINE);
  g.to(p);
};

const paintMedkit: Paint = (p) => {
  const g = new Grid();
  const shell = ramp(0xb9bec7, 0xd2d6dd, 0xe6e9ee, 0xf6f7f9);
  const red = ramp(0x9e1f24, 0xc42a2f, 0xe0413f);
  // Handle.
  for (let x = 6; x <= 9; x++) g.put(x, 2, hex(0x3b3f48));
  g.put(5, 3, hex(0x3b3f48)); g.put(10, 3, hex(0x3b3f48));
  // Case: lit top rows, shaded foot, with a seam across it.
  for (let y = 4; y <= 13; y++) for (let x = 1; x <= 14; x++) {
    const t = y === 4 ? 1 : y >= 12 ? .1 : x === 1 ? .8 : x === 14 ? .25 : .6;
    g.put(x, y, pick(shell, t, x, y, .3));
  }
  for (let x = 1; x <= 14; x++) g.put(x, 6, shell[0]);
  g.put(7, 5, hex(0x6d717b)); g.put(8, 5, hex(0x6d717b)); // latch
  // Cross.
  for (let y = 7; y <= 12; y++) for (let x = 6; x <= 9; x++) g.put(x, y, red[x === 6 || y === 7 ? 2 : 1]);
  for (let y = 8; y <= 11; y++) for (let x = 4; x <= 11; x++) if (x < 6 || x > 9) g.put(x, y, red[y === 8 ? 2 : x === 11 || y === 11 ? 0 : 1]);
  g.outline(OUTLINE);
  g.to(p);
};

// ── Registry ────────────────────────────────────────────────────────────────

export const WORLDS_ART: Partial<Record<Tile, Paint>> = {
  [Tile.GrassTop]: paintGrassTop,
  [Tile.GrassSide]: paintGrassSide,
  [Tile.Dirt]: paintDirt,
  [Tile.Stone]: paintStone,
  [Tile.Cobblestone]: paintCobblestone,
  [Tile.Sand]: paintSand,
  [Tile.Sandstone]: paintSandstone,
  [Tile.SandstoneTop]: paintSandstoneTop,
  [Tile.Snow]: paintSnow,
  [Tile.SnowySide]: paintSnowySide,
  [Tile.Glass]: paintGlass,
  [Tile.Water]: paintWater,
  [Tile.LogSide]: barkSide(OAK_BARK, 4),
  [Tile.LogTop]: logTop(OAK_BARK, OAK_WOOD),
  [Tile.BirchLogSide]: bandedBark(BIRCH_BARK, hex(0x2d2a28), .45),
  [Tile.BirchLogTop]: logTop(BIRCH_BARK, BIRCH_WOOD),
  [Tile.SpruceLogSide]: barkSide(SPRUCE_BARK, 3),
  [Tile.SpruceLogTop]: logTop(SPRUCE_BARK, SPRUCE_WOOD),
  [Tile.CherryLogSide]: bandedBark(CHERRY_BARK, hex(0x1b0f11), .35),
  [Tile.CherryLogTop]: logTop(CHERRY_BARK, CHERRY_WOOD),
  [Tile.Planks]: planks(PLANK_OAK),
  [Tile.CherryPlanks]: planks(PLANK_CHERRY),
  [Tile.Leaves]: leaves(LEAF_GRAY),
  [Tile.BirchLeaves]: leaves(LEAF_BIRCH),
  [Tile.SpruceLeaves]: leaves(LEAF_SPRUCE),
  [Tile.CherryLeaves]: leaves(LEAF_CHERRY, blossom),
  [Tile.TallGrass]: paintTallGrass,
  [Tile.Dandelion]: flower(ramp(0xd99a12, 0xf0bf22, 0xffdc3d, 0xffee8a), hex(0xd9771b), 'round'),
  [Tile.Poppy]: flower(ramp(0x8f1418, 0xb81f24, 0xdc3232, 0xf05a4f), hex(0x1f1a1a), 'cup'),

  [Tile.GildedVaultBrick]: paintGildedBrick,
  [Tile.CarvedVaultBrick]: paintCarvedBrick,
  [Tile.PrismBrick]: paintPrismBrick,
  [Tile.PearlTile]: paintPearlTile,
  [Tile.LuminousLimestone]: paintLimestone,
  [Tile.SpectralMarble]: paintSpectralMarble,
  [Tile.JadeMosaic]: paintJadeMosaic,
  [Tile.FurnaceCeramic]: paintFurnaceCeramic,
  [Tile.OpalBrick]: paintOpalBrick,
  [Tile.VaultMosaic]: paintVaultMosaic,
  [Tile.EmberBrick]: paintEmberBrick,
  [Tile.MossyVaultBrick]: paintMossyBrick,
  [Tile.ClockworkGrate]: paintClockworkGrate,
  [Tile.RuneGlass]: paintRuneGlass,
  [Tile.IvoryColumn]: paintIvoryColumn,
  [Tile.SoulLantern]: lantern(IRON_DARK, ramp(0x4a1f7a, 0x7433b8, 0xa35ae8, 0xcf9dff, 0xf4e6ff)),
  [Tile.EmberBrazier]: lantern(WROUGHT, ramp(0x8a2a0c, 0xc84812, 0xf07a22, 0xffb24a, 0xfff0b0)),
  [Tile.PrismLamp]: lantern(NAVY_METAL, ramp(0x1f6c9a, 0x2f9ccc, 0x55c9ec, 0x9be9fb, 0xe8feff)),
  [Tile.GildedLamp]: lantern(BRASS, ramp(0xa4620e, 0xd48a1c, 0xf5b53a, 0xffdc7a, 0xfff6d2)),
  [Tile.Basalt]: paintBasalt,
  [Tile.Terracotta]: paintTerracotta,
  [Tile.ArenaRim]: paintArenaRim,
  [Tile.TeamWoolA]: wool(CRIMSON),
  [Tile.TeamWoolB]: wool(COBALT),
  [Tile.PartyTileC]: paintCrumbleTile,
  [Tile.PartyTileD]: paintBlinkStone,
  [Tile.ParkourLaunchPad]: pad(CYAN_LIGHT, false),
  [Tile.ParkourBoostPad]: pad(GOLD_LIGHT, true),

  [Tile.IronAxe]: paintIronAxe,
  [Tile.BridgeBow]: paintBridgeBow,
  [Tile.BridgeArrow]: paintBridgeArrow,
  [Tile.MedkitSprite]: paintMedkit,
};

