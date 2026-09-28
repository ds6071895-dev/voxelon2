// Worlds' own art for Rat and Seek: every block of the Crooked Manor and
// every rat and seeker item. Same house style as tile_art.ts — a small
// hand-picked palette per material, detail built from shapes, tileable noise
// — and nothing copied from anywhere else.

import { Tile, MANOR_RUGS } from './blocks';
import {
  CLEAR, Grid, OUTLINE, STEEL, bevel, bondAt, bricks, hex, inBrick, leaves, lantern, mix, pick, planks, ramp, rnd,
  tfbm, tnoise, type Paint, type RGBA,
} from './tile_art';

// ── Shared helpers ──────────────────────────────────────────────────────────

function ring(x: number, y: number): number { return Math.min(x, y, 15 - x, 15 - y); }
function line(g: Grid, x0: number, y0: number, x1: number, y1: number, c: RGBA): void {
  const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
  for (let i = 0; i <= n; i++) g.put(Math.round(x0 + (x1 - x0) * i / n), Math.round(y0 + (y1 - y0) * i / n), c);
}
function rect(g: Grid, x0: number, y0: number, x1: number, y1: number, c: RGBA | ((x: number, y: number) => RGBA)): void {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) g.put(x, y, typeof c === 'function' ? c(x, y) : c);
}
function disc(g: Grid, cx: number, cy: number, r: number, c: RGBA | ((x: number, y: number, d: number) => RGBA)): void {
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const d = Math.hypot(x - cx, y - cy);
    if (d <= r) g.put(x, y, typeof c === 'function' ? c(x, y, d) : c);
  }
}
function sprite(draw: (g: Grid) => void): Paint {
  return (p) => { const g = new Grid(); draw(g); g.outline(OUTLINE); g.to(p); };
}

// ── Structure ───────────────────────────────────────────────────────────────

const SLATE = ramp(0x34496a, 0x40577c, 0x4d668d, 0x5b769e, 0x6c88af, 0x819cc0);
/** Overlapping rectangular slates, each row's lower edge shadowed. */
const paintSlate: Paint = (p, seed) => {
  p.fill((x, y) => {
    const row = y >> 2, v = y & 3;
    const shift = row % 2 ? 3 : 0;
    const u = (x + shift) % 6;
    const id = row * 4 + Math.floor((x + shift) / 6);
    let t = .45 + (rnd(seed, id, 1) - .5) * .35 + (tnoise(seed, x, y, 4) - .5) * .15;
    if (v === 3) t = .02;
    else if (v === 0) t += .22;
    if (u === 5 && v !== 3) t -= .3;
    return pick(SLATE, t, x, y, .45);
  });
};

const SPRUCE_BOARD = ramp(0x6f4c2a, 0x825a33, 0x95693c, 0xa77946, 0xb88950, 0xc7985c);
const WAINSCOT = ramp(0x563620, 0x654026, 0x754b2d, 0x855734, 0x95643c, 0xa57245);
const STONE_WARM = ramp(0x5c5850, 0x6d685f, 0x7d786e, 0x8d887d, 0x9d988c, 0xaea99b);
const RIDGE_STONE = ramp(0x3e4454, 0x4a5162, 0x575f71, 0x656d80, 0x757d90);
const BRICK_RED = ramp(0x843622, 0x9a4229, 0xae5032, 0xc05f3c, 0xd07148);
const PAVING = ramp(0x6b6e72, 0x7a7d81, 0x898c90, 0x979a9e, 0xa6a9ac, 0xb5b8bb);
const PLASTER = ramp(0xb9ae98, 0xc8bea9, 0xd6cdb9, 0xe2dac8, 0xece6d7, 0xf5f1e6);

const paintPlaster: Paint = (p, seed) => {
  // Hand-trowelled limewash: soft sweeps of tone and the odd hairline crack.
  p.fill((x, y) => {
    const sweep = tnoise(seed, x + y * .5, y, 8);
    let t = .6 + (sweep - .5) * .3 + (tnoise(seed ^ 9, x, y, 2) - .5) * .12;
    const crack = Math.abs(tnoise(seed ^ 4, x, y, 4) - .5) < .025 && rnd(seed, x, y) > .4;
    if (crack) t -= .35;
    return pick(PLASTER, t, x, y, .4);
  });
};

const BEAM = ramp(0x4e3119, 0x5d3b1f, 0x6d4626, 0x7d522d, 0x8d5e35);
const paintBeamSide: Paint = (p, seed) => {
  // Adzed timber: long vertical grain, an oak peg top and bottom.
  p.fill((x, y) => {
    if ((x === 7 || x === 8) && (y === 2 || y === 13)) return x === 7 ? hex(0x5b4128) : hex(0x46311d);
    const grain = tnoise(seed, x * 2, y * .35, 4);
    let t = .45 + (grain - .5) * .55;
    if (x === 0 || x === 15) t -= .25;
    if (rnd(seed ^ 1, x, y >> 2) > .9) t -= .2;
    return pick(BEAM, t, x, y, .4);
  });
};
const paintBeamTop: Paint = (p, seed) => {
  p.fill((x, y) => {
    if (ring(x, y) === 0) return pick(BEAM, .15, x, y, .3);
    const r = Math.hypot(x - 7.5, y - 7.5) + (tnoise(seed, x, y, 4) - .5) * 1.2;
    return pick(ramp(0x7a5630, 0x8d6539, 0xa07443, 0xb2844e), (Math.sin(r * 1.7) + 1) * .4 + .1, x, y, .3);
  });
};

const paintWindow: Paint = (p, seed) => {
  // Diamond leaded lights: pale glass, dark came, a gleam in the top panes.
  void seed;
  p.fill((x, y) => {
    if (ring(x, y) === 0) return hex(0x2b2d33);
    const a = (x + y) % 6, b = (x - y + 16) % 6;
    if (a === 0 || b === 0) return hex(0x3a3d45);
    const gleam = x + y < 12 && (x + y) % 6 === 2;
    return gleam ? hex(0xeef8ff, 210) : hex(0x9fc6da, 120 + ((x * 7 + y * 3) % 3) * 10);
  });
};

const paintPanel: Paint = (p, seed) => {
  // A raised wainscot panel: bevelled frame round a field of grain.
  p.fill((x, y) => {
    const r = ring(x, y);
    const grain = tnoise(seed, x * .5, y * 2, 4);
    let t = .45 + (grain - .5) * .35;
    if (r === 0) t = x === 0 || y === 0 ? .7 : .1;
    else if (r === 2) t = x === 2 || y === 2 ? .05 : .8;
    else if (r === 1) t += .1;
    return pick(WAINSCOT, t, x, y, .35);
  });
};

const paintRidge = bricks(RIDGE_STONE, hex(0x2a2e38), { w: 8, h: 4, texture: .2 });
const paintChimney = bricks(BRICK_RED, hex(0x2f201b), {
  w: 6, h: 3,
  deco: (x, y, _u, _v, _b, seed) => tnoise(seed ^ 7, x, y, 8) < .28 ? pick(ramp(0x4a3c34, 0x5a4a40, 0x6a594d), .5, x, y) : null,
});
const paintStoneBrick = bricks(STONE_WARM, hex(0x3f3b35), { w: 8, h: 5, texture: .3 });
const paintPaving: Paint = (p, seed) => {
  // Big, irregular flags in a staggered grid.
  p.fill((x, y) => {
    const b = bondAt(x, y, 8, 8, 5);
    const { u, v, mortar } = inBrick(x, y, b);
    if (mortar) return hex(0x4a4c50);
    let t = .5 + (rnd(seed, b.id, 3) - .5) * .35 + (tfbm(seed, x, y) - .5) * .3;
    const bv = bevel(u, v, 7, 7);
    t += bv > 0 ? .15 : bv < 0 ? -.12 : 0;
    return pick(PAVING, t, x, y, .5);
  });
};
const MOSS = ramp(0x2c4a1c, 0x385d23, 0x46702b, 0x568435, 0x699841);
const paintMossyPaving: Paint = (p, seed) => {
  p.fill((x, y) => {
    const b = bondAt(x, y, 8, 8, 5);
    const { u, v, mortar } = inBrick(x, y, b);
    const moss = tnoise(seed ^ 3, x, y, 4) > .56;
    if (mortar) return moss ? pick(MOSS, .4, x, y) : hex(0x44463f);
    if (moss && (u < 2 || v < 2 || tnoise(seed ^ 5, x, y, 2) > .6)) return pick(MOSS, tnoise(seed, x, y, 2), x, y, .5);
    return pick(PAVING, .45 + (rnd(seed, b.id, 3) - .5) * .3 + (tfbm(seed, x, y) - .5) * .3, x, y, .5);
  });
};
const paintMoss: Paint = (p, seed) => {
  p.fill((x, y) => pick(MOSS, .3 + tfbm(seed, x, y) * .6 + (rnd(seed, x, y) > .9 ? .2 : 0), x, y, .7));
};
const paintVerdigris: Paint = (p, seed) => {
  // Old copper sheet gone green, rivets along the seams, bronze where rubbed.
  const green = ramp(0x2e6a5c, 0x3a7d6c, 0x4a917e, 0x5ea591, 0x78b8a3);
  const bronze = ramp(0x5a3a1f, 0x744b27, 0x8e5d31);
  p.fill((x, y) => {
    const seam = y === 7 || y === 15;
    if (seam) return x % 4 === 1 ? hex(0x9ad0bd) : pick(green, .15, x, y);
    const n = tfbm(seed, x, y);
    if (n < .33) return pick(bronze, n * 2.5, x, y, .5);
    return pick(green, .25 + n * .7, x, y, .6);
  });
};
const paintCageBars: Paint = (p) => {
  p.fill((x, y) => {
    const bar = x % 4 === 1 || x % 4 === 2;
    if (y === 1 || y === 2 || y === 13 || y === 14) return y === 1 || y === 13 ? hex(0x5f5a66) : hex(0x2d2a33);
    if (!bar) return CLEAR;
    return x % 4 === 1 ? hex(0x5a5561) : hex(0x2f2c35);
  });
};
const STAIR_STONE = ramp(0x55585d, 0x64676c, 0x73767b, 0x83868a, 0x929599, 0xa2a5a8);
const paintStair: Paint = (p, seed) => {
  // Honed stone with a lit nosing every half block, so treads read at a glance.
  p.fill((x, y) => {
    const v = y & 7;
    let t = .5 + (tnoise(seed, x, y, 4) - .5) * .3 + (rnd(seed, x, y) - .5) * .1;
    if (v === 0) t = .95;
    else if (v === 1) t += .12;
    else if (v === 7) t = .08;
    return pick(STAIR_STONE, t, x, y, .45);
  });
};

// ── Light ───────────────────────────────────────────────────────────────────

const paintLanternBlock = lantern(ramp(0x3a3d46, 0x4a4d57, 0x5b5f69, 0x6d717c, 0x80848f),
  ramp(0x9a4d10, 0xcf7a1c, 0xf2a640, 0xffd27a, 0xfff3cf));
const paintCeilingLamp: Paint = (p, seed) => {
  // A frosted opal shade in a thin brass collar.
  p.fill((x, y) => {
    const r = ring(x, y);
    if (r === 0) return pick(ramp(0x6d4b1b, 0x94692a, 0xbf8e3d), x === 0 || y === 0 ? .9 : .2, x, y, .3);
    const d = Math.hypot(x - 7.5, y - 7.5) + (tnoise(seed, x, y, 4) - .5);
    return pick(ramp(0xe7cf9c, 0xf2dfb4, 0xfbeecd, 0xfff8e6, 0xffffff), 1 - d / 9, x, y, .5);
  });
};

// ── Floors and fabrics ──────────────────────────────────────────────────────

const paintRunner: Paint = (p, seed) => {
  const red = ramp(0x4c0f14, 0x62141a, 0x7a1a21, 0x902329, 0xa62f31);
  const gold = ramp(0x8a6118, 0xb58426, 0xd9a940);
  p.fill((x, y) => {
    const edge = Math.min(x, 15 - x);
    if (edge === 1) return pick(gold, .6 + (y % 2) * .3, x, y, .3);
    if (edge === 0 || edge === 2) return pick(red, .1, x, y, .3);
    const motif = (x + y) % 4 === 0 && (x - y + 16) % 4 === 0;
    if (motif) return pick(gold, .3, x, y, .3);
    return pick(red, .45 + (tnoise(seed, x, y, 2) - .5) * .35, x, y, .5);
  });
};

const RUG_PALETTES: [number, number, number][] = [
  [0x6e2a26, 0x9a3e32, 0xd98b5f], [0x4b4d52, 0x696c72, 0xa9aaa6], [0x3d5a34, 0x557a45, 0x9dbb7a],
  [0x5a3b25, 0x7a5033, 0xc79a6a], [0x1f4a2c, 0x2e6a3d, 0xd6b25a], [0x9a7a20, 0xc79f2e, 0x7a3c1c],
  [0x6a1320, 0x93202c, 0xe0b35a], [0xa85a1f, 0xd07a2d, 0x5a2e14], [0x1e2d66, 0x2e4491, 0xd9c27a],
  [0x9a4a66, 0xc76d8c, 0xf3d2dc], [0x4a2466, 0x6a3790, 0xd8b85c], [0x4a7892, 0x6b9fb8, 0xeee5cc],
  [0x4a2d1a, 0x6a4127, 0xd6ae6c], [0x1c5a5c, 0x2a7e7f, 0xe9d7a4], [0x4c4e56, 0x6c6f78, 0xc5b27a],
  [0x7a1f5c, 0xa82f7e, 0xf0c7de],
];
function rugPainter(i: number): Paint {
  const [dark, mid, accent] = RUG_PALETTES[i].map((h) => hex(h));
  const pal = [mix(dark, hex(0), .25), dark, mid, mix(mid, accent, .25)];
  if (MANOR_RUGS[i].tiled) {
    // Glazed quarry tiles: a checker of two glazes with a pale diamond inlay.
    return (p, seed) => p.fill((x, y) => {
      const u = x & 7, v = y & 7, cell = ((x >> 3) + (y >> 3)) & 1;
      if (u === 7 || v === 7) return mix(dark, hex(0x1a1410), .55);
      if (Math.abs(u - 3.5) + Math.abs(v - 3.5) < 1.6) return accent;
      const t = (cell ? .7 : .35) + (tnoise(seed, x, y, 4) - .5) * .25 + (u === 0 || v === 0 ? .15 : 0);
      return pick(pal, t, x, y, .4);
    });
  }
  // A woven carpet: border, field, and a medallion at the centre.
  return (p, seed) => p.fill((x, y) => {
    const r = ring(x, y);
    if (r === 0) return pal[0];
    if (r === 1) return (x + y) % 2 ? accent : pal[1];
    const d = Math.abs(x - 7.5) + Math.abs(y - 7.5);
    if (d < 2.2) return accent;
    if (d > 3.2 && d < 4.2) return mix(accent, mid, .45);
    const weave = ((x & 1) ^ (y & 1)) ? .08 : -.05;
    return pick(pal, .55 + weave + (tnoise(seed, x, y, 4) - .5) * .25, x, y, .4);
  });
}

const paintLinen: Paint = (p, seed) => {
  // A quilted counterpane: stitched diamonds on cream cotton.
  const cloth = ramp(0xc9c3b6, 0xd8d3c7, 0xe6e2d8, 0xf1eee7, 0xfbfaf6);
  p.fill((x, y) => {
    const stitch = (x + y) % 8 === 0 || (x - y + 16) % 8 === 0;
    const puff = Math.min((x + y) % 8, 8 - (x + y) % 8) + Math.min((x - y + 16) % 8, 8 - (x - y + 16) % 8);
    return pick(cloth, stitch ? .15 : .45 + puff * .06 + (tnoise(seed, x, y, 4) - .5) * .1, x, y, .4);
  });
};

// ── Furniture ───────────────────────────────────────────────────────────────

const LIGHT_WOOD = ramp(0x7a5a36, 0x8f6b42, 0xa37c4d, 0xb78e5a, 0xc9a06a);
const paintTableLeg: Paint = (p, seed) => {
  // A turned post: bulbs and grooves stacked up the shaft.
  p.fill((x, y) => {
    const profile = 1.4 + Math.abs(Math.sin(y * .78)) * 2.2;
    const dx = Math.abs(x - 7.5);
    const groove = y % 4 === 0;
    let t = .55 - dx / profile * .35 + (tnoise(seed, x, y * .3, 2) - .5) * .2;
    if (groove) t -= .3;
    if (dx < .8) t += .15;
    return pick(LIGHT_WOOD, t, x, y, .4);
  });
};
const CASK = ramp(0x6a4526, 0x7d532e, 0x906137, 0xa27041, 0xb47f4b);
const HOOP = ramp(0x464a54, 0x5a5f6a, 0x717682);
const paintCaskSide: Paint = (p, seed) => {
  p.fill((x, y) => {
    if (y === 2 || y === 3 || y === 12 || y === 13) return pick(HOOP, y % 2 ? .2 : .9, x, y, .3);
    const stave = Math.floor(x / 4), u = x & 3;
    let t = .5 + (rnd(seed, stave, 0) - .5) * .3 + (tnoise(seed, x, y, 4) - .5) * .2;
    if (u === 3) t -= .35;
    if (u === 0) t += .15;
    return pick(CASK, t, x, y, .4);
  });
};
const paintCaskTop: Paint = (p, seed) => {
  p.fill((x, y) => {
    if (ring(x, y) === 0) return pick(HOOP, .5, x, y);
    if (Math.hypot(x - 10.5, y - 10.5) < 1.5) return hex(0x1a1008);
    const board = y >> 2;
    let t = .5 + (rnd(seed, board, 7) - .5) * .3 + (tnoise(seed, x * .5, y, 4) - .5) * .25;
    if ((y & 3) === 3) t -= .3;
    return pick(CASK, t, x, y, .4);
  });
};
const SPINES = [0x7a1f24, 0x2a4a7a, 0x2f6a3a, 0x8a6a1f, 0x5a2a6a, 0x7a4a24, 0x1f5a5a, 0x9a8a6a].map((h) => hex(h));
const paintBookshelf: Paint = (p, seed) => {
  p.fill((x, y) => {
    const shelf = y >> 3, v = y & 7;
    if (v === 0 || v === 7 || x === 0 || x === 15) return pick(SPRUCE_BOARD, v === 0 ? .8 : .3, x, y, .3);
    // Books of varying width and height, leaning a little.
    const book = Math.floor((x + shelf * 3) / 2 + rnd(seed, shelf, x >> 1) * .6);
    const h = 3 + Math.floor(rnd(seed ^ 5, book, shelf) * 4);
    if (7 - v > h) return hex(0x3a2716);
    const c = SPINES[Math.floor(rnd(seed ^ 9, book, shelf) * SPINES.length)];
    const band = v === 3 && rnd(seed, book, 2) > .5;
    return band ? hex(0xd9b85a) : mix(c, hex(0), (x + shelf) % 2 ? .15 : 0);
  });
};
const paintCuriosShelf: Paint = (p, seed) => {
  p.fill((x, y) => {
    const shelf = y >> 3, v = y & 7;
    if (v === 0 || v === 7 || x === 0 || x === 15) return pick(WAINSCOT, v === 0 ? .8 : .3, x, y, .3);
    const slot = Math.floor(x / 5);
    const kind = Math.floor(rnd(seed, slot, shelf) * 3);
    const cx = slot * 5 + 2.5;
    if (kind === 0 && Math.abs(x - cx) < 1.6 && v > 2) return v === 3 ? hex(0x8a6a2a) : hex(0x6fb0c2, 255); // a jar
    if (kind === 1 && Math.hypot(x - cx, v - 4.5) < 2) return hex(0xc9a64a);                             // a globe
    if (kind === 2 && Math.abs(x - cx) < .8 && v > 1) return hex(0xe8e0cf);                              // a candle
    return hex(0x3a2716);
  });
};
const MARBLE = ramp(0xb9b6b0, 0xcbc8c2, 0xdad8d3, 0xe7e5e1, 0xf3f2ef, 0xfdfdfc);
const paintMarble: Paint = (p, seed) => {
  p.fill((x, y) => {
    const vein = Math.abs(Math.sin((x * .35 + y * .8) + tfbm(seed, x, y) * 5));
    const t = .7 + (tnoise(seed, x, y, 4) - .5) * .2 - (vein < .12 ? .45 : 0);
    return pick(MARBLE, t, x, y, .3);
  });
};
const IRON = ramp(0x33363f, 0x3f434c, 0x4c505a, 0x5a5e69, 0x6a6e7a, 0x7d828e);
const paintStoveSide: Paint = (p, seed) => {
  p.fill((x, y) => {
    const door = x >= 3 && x <= 12 && y >= 6 && y <= 13;
    if (door) {
      if (x === 3 || x === 12 || y === 6 || y === 13) return pick(IRON, .75, x, y);
      if (y === 9 && x >= 6 && x <= 9) return hex(0xb58a3a); // brass handle
      return pick(IRON, .3 + (tnoise(seed, x, y, 4) - .5) * .2, x, y);
    }
    if (y <= 3) return y === 3 ? hex(0x24262c) : pick(IRON, .55, x, y);
    return pick(IRON, .4 + (tnoise(seed, x, y, 4) - .5) * .25, x, y, .5);
  });
};
const paintIronTop: Paint = (p, seed) => {
  p.fill((x, y) => {
    const burner = Math.abs(Math.hypot(x - 4.5, y - 4.5) - 2.6) < .6 || Math.abs(Math.hypot(x - 10.5, y - 10.5) - 2.6) < .6;
    return pick(IRON, burner ? .8 : .3 + (tnoise(seed, x, y, 4) - .5) * .25, x, y, .4);
  });
};
const paintFlowerPot: Paint = (p, seed) => {
  const clay = ramp(0x7a3a22, 0x95492b, 0xae5a35, 0xc46c42);
  p.fill((x, y) => {
    if (y < 4) return rnd(seed, x, y) > .5 ? hex(0x3f7a2a) : hex(0x2a5a1c); // a sprig of green
    if (y === 4 || y === 5) return pick(clay, .9, x, y, .3);
    return pick(clay, .45 + (x < 5 ? .2 : x > 11 ? -.2 : 0) + (tnoise(seed, x, y, 4) - .5) * .2, x, y, .4);
  });
};
const paintWashtub: Paint = (p, seed) => {
  const zinc = ramp(0x6a7076, 0x80868c, 0x969ca1, 0xacb1b5, 0xc3c7ca);
  p.fill((x, y) => {
    if (y <= 1) return pick(zinc, .9, x, y, .3);
    const rib = y % 4 === 2;
    return pick(zinc, (rib ? .8 : .4) + (tnoise(seed, x, y, 4) - .5) * .25, x, y, .4);
  });
};
const paintPewter: Paint = (p, seed) => {
  const pew = ramp(0x585c63, 0x6a6e75, 0x7c8087, 0x8e9299, 0xa1a5ab);
  p.fill((x, y) => {
    const r = ring(x, y);
    if (r === 1 && (x === 1 || x === 14) && (y === 1 || y === 14)) return hex(0xd0d4d9);
    const brush = tnoise(seed, x * 3, y * .4, 4);
    return pick(pew, (r === 0 ? .15 : .5) + (brush - .5) * .35, x, y, .4);
  });
};
const COPPER = ramp(0x6e3417, 0x8a441e, 0xa65627, 0xbf6a33, 0xd5824a, 0xe69d68);
const paintCopperTank: Paint = (p, seed) => {
  p.fill((x, y) => {
    if (y % 8 === 0) return x % 3 === 1 ? hex(0xf0c294) : pick(COPPER, .2, x, y);
    if (Math.hypot(x - 11, y - 5) < 2.2) return Math.hypot(x - 11, y - 5) < 1.3 ? hex(0xf4efe4) : hex(0x2a2320); // gauge
    return pick(COPPER, .45 + (tnoise(seed, x, y, 4) - .5) * .35 + (x < 4 ? .15 : 0), x, y, .5);
  });
};
const paintFurnace: Paint = (p, seed) => {
  const fire = ramp(0x6a1c08, 0xa8340c, 0xe0621a, 0xffa23a, 0xffe08a);
  p.fill((x, y) => {
    const box = x >= 3 && x <= 12 && y >= 7 && y <= 13;
    if (box) {
      if (x === 3 || x === 12 || y === 7 || y === 13) return pick(IRON, .7, x, y);
      if (x % 2 === 0) return pick(IRON, .15, x, y);
      return pick(fire, .35 + (13 - y) * .1 + (tnoise(seed, x, y, 2) - .5) * .4, x, y, .6);
    }
    return pick(IRON, .35 + (tnoise(seed, x, y, 4) - .5) * .3, x, y, .5);
  });
};
const STRAW = ramp(0x8a6a1c, 0xa6822a, 0xc09a3a, 0xd6b04c, 0xe8c562);
const paintHaySide: Paint = (p, seed) => {
  p.fill((x, y) => {
    if (y === 4 || y === 11) return hex(0x6a3a1c); // twine
    return pick(STRAW, .5 + (tnoise(seed, x * .3, y * 2, 4) - .5) * .6, x, y, .6);
  });
};
const paintHayTop: Paint = (p, seed) => {
  p.fill((x, y) => {
    if (x === 4 || x === 11) return hex(0x6a3a1c);
    return pick(STRAW, .5 + (tnoise(seed, x, y, 2) - .5) * .7, x, y, .7);
  });
};
const paintPiano: Paint = (p, seed) => {
  p.fill((x, y) => {
    const gloss = Math.abs((x - y * .6) % 9) < 1 ? .4 : 0;
    return pick(ramp(0x1e2028, 0x272a33, 0x31343f, 0x3e424e, 0x555a6a), .2 + gloss + (tnoise(seed, x, y, 8) - .5) * .1, x, y, .3);
  });
};
const paintGramophoneSide: Paint = (p, seed) => {
  p.fill((x, y) => {
    const grille = x >= 3 && x <= 12 && y >= 3 && y <= 12;
    if (grille) return (x + y) % 2 ? hex(0xb58a3a) : hex(0x3a2412);
    return pick(WAINSCOT, .6 + (tnoise(seed, x * .5, y * 2, 4) - .5) * .3, x, y, .4);
  });
};
const paintGramophoneTop: Paint = (p) => {
  p.fill((x, y) => {
    const d = Math.hypot(x - 7.5, y - 7.5);
    if (d < 1.2) return hex(0xc9a64a);
    if (d < 6.5) return Math.floor(d * 2) % 2 ? hex(0x2a2c33) : hex(0x3a3d46);
    if (x === 13 && y >= 3 && y <= 10) return hex(0xb58a3a); // tone arm
    return pick(WAINSCOT, .55, x, y);
  });
};
const paintMusicBox: Paint = (p, seed) => {
  p.fill((x, y) => {
    if (ring(x, y) <= 1) return pick(ramp(0x7a1a2a, 0x962234, 0xb02d3f), ring(x, y) ? .4 : .9, x, y, .3);
    if (y >= 6 && y <= 9) return x % 2 ? hex(0xe2c46a) : hex(0xa8872f); // brass comb
    return pick(ramp(0x4a0f1a, 0x5e1422, 0x74192b), .5 + (tnoise(seed, x, y, 4) - .5) * .3, x, y, .4);
  });
};
const paintHedge = leaves(ramp(0x285222, 0x33652a, 0x3f7832, 0x4c8b3c, 0x5b9e46, 0x6db152));
const paintGardenPost: Paint = (p, seed) => {
  p.fill((x, y) => {
    let t = .5 + (tnoise(seed, x, y, 4) - .5) * .3;
    if (y % 5 === 0) t += .25;
    if (y % 5 === 4) t -= .25;
    return pick(STONE_WARM, t, x, y, .4);
  });
};
const GILT = ramp(0x7a4f0c, 0xa36d14, 0xc98e22, 0xe5ae3a, 0xf6cd62, 0xfde9a4);
const paintGilt: Paint = (p, seed) => {
  // Gilded scrollwork: a laurel of curls on burnished gold.
  p.fill((x, y) => {
    const r = ring(x, y);
    const curl = Math.abs(Math.sin(Math.hypot(x - 7.5, y - 7.5) * 1.3 + Math.atan2(y - 7.5, x - 7.5) * 2));
    let t = .55 + (tnoise(seed, x, y, 4) - .5) * .2;
    if (r === 0) t = x === 0 || y === 0 ? 1 : .15;
    else if (r > 2 && curl < .25) t += .35;
    else if (r > 2 && curl > .9) t -= .25;
    return pick(GILT, t, x, y, .4);
  });
};
const paintBronzeTile: Paint = (p, seed) => {
  p.fill((x, y) => {
    const u = x & 7, v = y & 7;
    const bv = bevel(u, v, 8, 8);
    return pick(COPPER, .45 + bv * .25 + (tnoise(seed, x, y, 4) - .5) * .2, x, y, .4);
  });
};
const paintMousetrap: Paint = (p) => {
  p.fill((x, y) => {
    if (x >= 3 && x <= 12 && (y === 4 || y === 11)) return hex(0xb9c0c8);     // spring bar
    if ((x === 3 || x === 12) && y > 4 && y < 11) return hex(0xb9c0c8);
    if (Math.abs(x - 7.5) < 1.5 && Math.abs(y - 7.5) < 1.5) return hex(0xf2c94a); // the bait pedal
    return pick(LIGHT_WOOD, .4 + (y % 3 === 0 ? .15 : 0), x, y, .3);
  });
};
const paintLever: Paint = (p) => {
  p.fill((x, y) => {
    if (x >= 6 && x <= 9) return pick(LIGHT_WOOD, .5 + (x === 6 ? .3 : 0), x, y, .3);
    return pick(IRON, .4 + (ring(x, y) === 0 ? .2 : 0), x, y, .3);
  });
};

// ── The Cheese Exchange ─────────────────────────────────────────────────────

const BRASS = ramp(0x5a3a0c, 0x7a5214, 0x9c6c1e, 0xbf8a2c, 0xdcaa44, 0xf2cc6e);
const CHEESE = ramp(0xb07a12, 0xd6a01e, 0xf0c238, 0xffd95a, 0xffeb9a);
const paintExchangeFront: Paint = (p, seed) => {
  // A brass cabinet: a lit card window with a cheese wedge, a coin slot and
  // a push lever.
  p.fill((x, y) => {
    const r = ring(x, y);
    if (r === 0) return pick(BRASS, x === 0 || y === 0 ? .9 : .15, x, y, .3);
    if (x >= 3 && x <= 12 && y >= 2 && y <= 8) {
      if (x === 3 || x === 12 || y === 2 || y === 8) return pick(BRASS, .35, x, y);
      const inWedge = y >= 4 && y <= 7 && x >= 5 && x - 5 <= (y - 3) * 2;
      if (inWedge) return (x + y) % 5 === 0 ? hex(0xc4901a) : pick(CHEESE, .7, x, y, .3);
      return hex(0xfff2c8);
    }
    if (y === 11 && x >= 6 && x <= 9) return hex(0x140e06);                  // coin slot
    if (x === 12 && y >= 10 && y <= 13) return hex(0xd33d2d);                // push lever
    return pick(BRASS, .5 + (tnoise(seed, x, y, 4) - .5) * .25 + (r === 1 ? .15 : 0), x, y, .4);
  });
};
const paintExchangeTop: Paint = (p, seed) => {
  p.fill((x, y) => {
    const r = ring(x, y);
    if ((x === 2 || x === 13) && (y === 2 || y === 13)) return hex(0xfff0b0);
    return pick(BRASS, r === 0 ? .2 : .55 + (tnoise(seed, x, y, 4) - .5) * .2, x, y, .4);
  });
};
const paintExchangeDome: Paint = (p) => {
  // A glass bell jar over a pile of wedges, a brass band at its foot.
  p.fill((x, y) => {
    if (y >= 13) return pick(BRASS, y === 13 ? .9 : .4, x, y, .3);
    const wedge = y >= 8 && x >= 3 && x <= 12 && (x + y) % 7 !== 0;
    if (wedge) return pick(CHEESE, .3 + (12 - y) * .12, x, y, .4);
    if (x === 0 || x === 15 || y === 0) return hex(0xdff4ff, 170);
    if (x + y === 5 || x + y === 6) return hex(0xffffff, 200);
    return hex(0xcfe8f4, 60);
  });
};
const paintExchangeCap: Paint = (p, seed) => {
  p.fill((x, y) => {
    const d = Math.hypot(x - 7.5, y - 7.5);
    if (d < 2) return pick(BRASS, 1, x, y);
    return pick(BRASS, .35 + (tnoise(seed, x, y, 4) - .5) * .2 + (d > 7 ? -.2 : 0), x, y, .4);
  });
};

// ── Items ───────────────────────────────────────────────────────────────────

const WOOD = ramp(0x4a2f17, 0x62401f, 0x7a5129, 0x926334, 0xa87641);
const paintRatCatcher = sprite((g) => {
  // A long-handled catching net: hoop and mesh top-right, grip bottom-left.
  for (let i = 0; i <= 8; i++) { g.put(2 + i, 13 - i, WOOD[2]); g.put(3 + i, 13 - i, WOOD[1]); }
  for (const [x, y] of [[2, 13], [3, 13], [2, 12]]) g.put(x, y, hex(0x2a1c10));
  disc(g, 10.5, 5, 4.2, (x, y, d) => d > 3.2 ? pick(STEEL, .8, x, y, 0) : (x + y) % 2 ? hex(0xe8e2d2) : hex(0xa8a092));
});
const paintSeekerCompass = sprite((g) => {
  disc(g, 7.5, 7.5, 6.2, (x, y, d) => d > 5.2 ? pick(BRASS, .7 - (x + y) * .02, x, y, .2) : hex(0xf2ead6));
  line(g, 7, 7, 10, 3, hex(0xd6322a)); line(g, 8, 8, 5, 12, hex(0x39404a));
  g.put(7, 7, hex(0x1a1a1a)); g.put(8, 8, hex(0x1a1a1a));
  for (const [x, y] of [[7, 2], [7, 13], [2, 7], [13, 7]]) g.put(x, y, hex(0x6a4a14));
});
const paintScentPulse = sprite((g) => {
  // A perfume atomiser: violet bulb, glass bottle, a puff of scent.
  disc(g, 4.5, 11, 2.6, (x, y) => pick(ramp(0x4a1a6a, 0x6a2a94, 0x8e46bf), .8 - y * .03, x, y, 0));
  rect(g, 7, 8, 12, 14, (x, y) => (x === 7 || y === 14) ? hex(0x7fb6c9) : hex(0xb8e2ee));
  rect(g, 8, 11, 11, 13, hex(0xd18ad6));
  rect(g, 9, 6, 10, 7, pick(BRASS, .8, 9, 6, 0));
  for (const [x, y] of [[12, 3], [13, 5], [11, 2], [14, 3]]) g.put(x, y, hex(0xe7c9f2));
});
const paintFlashlight = sprite((g) => {
  for (let i = 0; i <= 8; i++) {
    g.put(3 + i, 12 - i, pick(STEEL, .45, 0, 0, 0)); g.put(4 + i, 12 - i, pick(STEEL, .75, 0, 0, 0));
    g.put(3 + i, 11 - i, pick(STEEL, .9, 0, 0, 0));
  }
  disc(g, 12, 3.5, 2.2, (x, y, d) => d < 1.3 ? hex(0xfffbd8) : hex(0xb5babf));
  g.put(6, 9, hex(0xd33d2d));
});
const paintMousetrapItem = sprite((g) => {
  rect(g, 2, 7, 13, 12, (x, y) => pick(LIGHT_WOOD, .35 + (y === 7 ? .4 : 0) + (x % 4 === 0 ? -.1 : 0), x, y, 0));
  line(g, 3, 6, 12, 6, hex(0xc9ced4)); line(g, 3, 6, 3, 9, hex(0xc9ced4)); line(g, 12, 6, 12, 9, hex(0xc9ced4));
  rect(g, 7, 9, 8, 10, hex(0xf2c94a));
});
function wedge(g: Grid, drip: boolean): void {
  for (let y = 5; y <= 12; y++) for (let x = 2; x <= 13; x++) {
    if (x - 2 > (y - 4) * 1.6) continue;
    const hole = (Math.hypot(x - 5, y - 9) < 1.1) || (Math.hypot(x - 8, y - 11) < .9) || (Math.hypot(x - 4, y - 6.5) < .7);
    g.put(x, y, hole ? hex(0xb07a12) : pick(CHEESE, y === 5 || x === 2 ? .95 : .55 - (y - 5) * .04, x, y, .3));
  }
  if (drip) for (const [x, y] of [[9, 12], [9, 13], [10, 13], [9, 14]]) g.put(x, y, hex(0xe08a1a));
}
const paintCheeseBait = sprite((g) => wedge(g, true));
const paintCheese = sprite((g) => wedge(g, false));
const paintSqueakTaunt = sprite((g) => {
  // A tin whistle and the squeak it makes.
  for (let i = 0; i <= 8; i++) { g.put(2 + i, 12 - i, pick(STEEL, .6, 0, 0, 0)); g.put(3 + i, 12 - i, pick(STEEL, .9, 0, 0, 0)); }
  g.put(5, 10, hex(0x2a2a2a)); g.put(7, 8, hex(0x2a2a2a));
  for (const [x, y] of [[12, 2], [12, 3], [12, 4], [11, 5], [13, 2], [14, 3]]) g.put(x, y, hex(0xf07ab8));
});
const paintScamper = sprite((g) => {
  // A rat's paw print with speed streaks.
  disc(g, 9.5, 10, 2.6, hex(0xe6a0a8));
  for (const [x, y] of [[7, 6], [9, 5], [11, 5], [13, 7]]) disc(g, x, y, 1, hex(0xe6a0a8));
  for (const y of [8, 11, 13]) line(g, 1, y, 4, y, hex(0x8ad6f0));
});
const paintCageRattle = sprite((g) => {
  for (const x of [4, 7, 10]) line(g, x, 3, x, 13, pick(STEEL, .5, 0, 0, 0));
  line(g, 3, 3, 11, 3, hex(0x5a5561)); line(g, 3, 13, 11, 13, hex(0x5a5561));
  for (const [x, y] of [[13, 5], [14, 7], [13, 9], [1, 6], [1, 9]]) g.put(x, y, hex(0xffd84a));
});
const paintEscapeCard = sprite((g) => {
  rect(g, 2, 3, 13, 12, (x, y) => (x === 2 || y === 3) ? hex(0xf8f0d8) : hex(0xe6d8b2));
  // A little key.
  disc(g, 5.5, 7.5, 1.6, hex(0x3fa052)); line(g, 7, 7, 11, 7, hex(0x3fa052)); g.put(10, 8, hex(0x3fa052)); g.put(11, 8, hex(0x3fa052));
  line(g, 4, 10, 11, 10, hex(0xb8a680));
});
const paintClassPicker = sprite((g) => {
  // A rosette badge.
  disc(g, 7.5, 6, 4.5, (x, y, d) => d > 3.4 ? hex(0xd33d5a) : d > 2.2 ? hex(0xf2cc6e) : hex(0xfff3c8));
  rect(g, 5, 10, 6, 14, hex(0xd33d5a)); rect(g, 9, 10, 10, 14, hex(0x3a6ad3));
});
const paintSeekerPicker = sprite((g) => {
  // A seeker's red tag on a gold ring: the party host's pick of who hunts.
  disc(g, 7.5, 7.5, 6, (x, y, d) => d > 4.8 ? hex(0xf2cc6e) : d > 3.6 ? hex(0xb8862a) : hex(0xd33d5a));
  line(g, 6, 5, 9, 5, hex(0xfff3c8)); line(g, 7.5, 5, 7.5, 10, hex(0xfff3c8));
});
const paintWhiskerSense = sprite((g) => {
  disc(g, 7.5, 9, 2.2, hex(0xe6a0a8));
  for (const [x1, y1] of [[1, 5], [1, 9], [2, 13], [14, 5], [14, 9], [13, 13]]) line(g, 7.5 + (x1 < 7 ? -2 : 2), 9, x1, y1, hex(0xf4f4f4));
});
const paintCheeseMagnet = sprite((g) => {
  // A horseshoe magnet, red with silver tips, pulling crumbs.
  for (let a = 0; a <= 20; a++) {
    const t = Math.PI * a / 20, x = 7.5 + Math.cos(t) * 4.5, y = 7 - Math.sin(t) * 4.5;
    disc(g, x, y, 1.1, hex(0xc8322a));
  }
  rect(g, 2, 7, 4, 11, hex(0xc8322a)); rect(g, 11, 7, 13, 11, hex(0xc8322a));
  rect(g, 2, 11, 4, 13, pick(STEEL, .9, 0, 0, 0)); rect(g, 11, 11, 13, 13, pick(STEEL, .9, 0, 0, 0));
  for (const [x, y] of [[7, 13], [8, 14], [6, 15]]) g.put(x, y, hex(0xffd95a));
});
function ratSide(g: Grid, body: RGBA): void {
  disc(g, 7, 9.5, 3.6, body);
  disc(g, 11.2, 8.4, 2.2, body);
  g.put(13, 8, hex(0xe6a0a8)); g.put(12, 7, hex(0x111111)); disc(g, 10, 5.8, 1, hex(0xe6a0a8));
  line(g, 3, 10, 1, 13, hex(0xe6a0a8)); line(g, 1, 13, 2, 14, hex(0xe6a0a8));
  g.put(6, 13, hex(0xe6a0a8)); g.put(9, 13, hex(0xe6a0a8));
}
const paintDecoyRat = sprite((g) => {
  ratSide(g, hex(0x9a9aa4));
  line(g, 7, 5, 7, 3, hex(0xc9a64a)); line(g, 5, 2, 9, 2, hex(0xc9a64a)); // wind-up key
});
const paintDisarm = sprite((g) => {
  // Wire cutters.
  line(g, 3, 13, 8, 8, hex(0xd33d2d)); line(g, 4, 13, 9, 8, hex(0xa82a22));
  line(g, 13, 13, 8, 8, hex(0x3a6ad3)); line(g, 12, 13, 7, 8, hex(0x2a4ea0));
  line(g, 8, 8, 6, 3, pick(STEEL, .8, 0, 0, 0)); line(g, 8, 8, 10, 3, pick(STEEL, .6, 0, 0, 0));
  g.put(8, 8, hex(0x2a2a2a));
});
const paintClassScout = sprite((g) => {
  // A feather.
  line(g, 3, 13, 12, 2, hex(0xe8e8f0));
  for (let i = 0; i < 9; i++) {
    const x = 4 + i, y = 12 - i;
    g.put(x - 1, y - 1, hex(0x5ec8e6)); g.put(x + 1, y + 1, hex(0x3aa0c8));
    if (i > 1 && i < 8) { g.put(x - 2, y - 2, hex(0x8ad6f0)); g.put(x + 2, y + 2, hex(0x2a86ac)); }
  }
});
const paintClassThief = sprite((g) => {
  // A coin purse spilling gold.
  disc(g, 7, 9.5, 4.3, (x, y) => pick(ramp(0x5a3a1c, 0x7a5028, 0x946636), .7 - y * .03, x, y, 0));
  rect(g, 5, 4, 9, 5, hex(0x5a3a1c)); line(g, 5, 5, 9, 5, hex(0xd9b85a));
  disc(g, 12.5, 12, 1.8, hex(0xf2cc4a)); disc(g, 11, 14, 1.2, hex(0xd9a930));
});
const paintClassTrickster = sprite((g) => {
  // A two-tone masquerade mask.
  rect(g, 2, 5, 13, 10, (x) => x < 8 ? hex(0xbf4ad9) : hex(0xf2cc4a));
  disc(g, 5, 7.5, 1.2, hex(0x1a1a1a)); disc(g, 10.5, 7.5, 1.2, hex(0x1a1a1a));
  g.put(2, 4, hex(0xbf4ad9)); g.put(13, 4, hex(0xf2cc4a)); line(g, 7, 11, 8, 12, hex(0x9a3ab0));
});
const paintClassTinkerer = sprite((g) => {
  // A spanner.
  for (let i = 0; i <= 9; i++) { g.put(3 + i, 12 - i, pick(STEEL, .5, 0, 0, 0)); g.put(4 + i, 12 - i, pick(STEEL, .85, 0, 0, 0)); }
  disc(g, 12, 3.5, 2.6, pick(STEEL, .7, 0, 0, 0)); rect(g, 12, 2, 14, 4, CLEAR as RGBA);
  g.put(12, 3, hex(0)); disc(g, 3, 12.5, 1.8, pick(STEEL, .6, 0, 0, 0));
});

// ── Registry ────────────────────────────────────────────────────────────────

export const MANOR_ART: Partial<Record<Tile, Paint>> = {
  [Tile.ManorSlate]: paintSlate,
  [Tile.ManorBoards]: planks(SPRUCE_BOARD),
  [Tile.ManorStoneBrick]: paintStoneBrick,
  [Tile.ManorPlaster]: paintPlaster,
  [Tile.ManorBeamSide]: paintBeamSide,
  [Tile.ManorBeamTop]: paintBeamTop,
  [Tile.ManorWindow]: paintWindow,
  [Tile.ManorPanel]: paintPanel,
  [Tile.ManorRidge]: paintRidge,
  [Tile.ManorChimney]: paintChimney,
  [Tile.ManorPaving]: paintPaving,
  [Tile.ManorLantern]: paintLanternBlock,
  [Tile.ManorCeilingLamp]: paintCeilingLamp,
  [Tile.ManorRunner]: paintRunner,
  [Tile.ManorTableLeg]: paintTableLeg,
  [Tile.ManorCaskSide]: paintCaskSide,
  [Tile.ManorCaskTop]: paintCaskTop,
  [Tile.ManorBookshelf]: paintBookshelf,
  [Tile.ManorCuriosShelf]: paintCuriosShelf,
  [Tile.ManorMarble]: paintMarble,
  [Tile.ManorStoveSide]: paintStoveSide,
  [Tile.ManorIronTop]: paintIronTop,
  [Tile.ManorFlowerPot]: paintFlowerPot,
  [Tile.ManorLinen]: paintLinen,
  [Tile.ManorWashtub]: paintWashtub,
  [Tile.ManorPewter]: paintPewter,
  [Tile.ManorCopperTank]: paintCopperTank,
  [Tile.ManorFurnace]: paintFurnace,
  [Tile.ManorHaySide]: paintHaySide,
  [Tile.ManorHayTop]: paintHayTop,
  [Tile.ManorPiano]: paintPiano,
  [Tile.ManorGramophoneSide]: paintGramophoneSide,
  [Tile.ManorGramophoneTop]: paintGramophoneTop,
  [Tile.ManorMusicBox]: paintMusicBox,
  [Tile.ManorVerdigris]: paintVerdigris,
  [Tile.ManorHedge]: paintHedge,
  [Tile.ManorMossyPaving]: paintMossyPaving,
  [Tile.ManorMoss]: paintMoss,
  [Tile.ManorGardenPost]: paintGardenPost,
  [Tile.ManorGilt]: paintGilt,
  [Tile.ManorBronzeTile]: paintBronzeTile,
  [Tile.ManorCageBars]: paintCageBars,
  [Tile.ManorStair]: paintStair,
  [Tile.ManorMousetrap]: paintMousetrap,
  [Tile.ManorLever]: paintLever,
  [Tile.ManorExchangeFront]: paintExchangeFront,
  [Tile.ManorExchangeTop]: paintExchangeTop,
  [Tile.ManorExchangeDome]: paintExchangeDome,
  [Tile.ManorExchangeCap]: paintExchangeCap,

  [Tile.RatCatcher]: paintRatCatcher,
  [Tile.SeekerCompass]: paintSeekerCompass,
  [Tile.ScentPulse]: paintScentPulse,
  [Tile.Flashlight]: paintFlashlight,
  [Tile.MousetrapItem]: paintMousetrapItem,
  [Tile.CheeseBait]: paintCheeseBait,
  [Tile.SqueakTaunt]: paintSqueakTaunt,
  [Tile.Scamper]: paintScamper,
  [Tile.CageRattle]: paintCageRattle,
  [Tile.EscapeCard]: paintEscapeCard,
  [Tile.ClassPicker]: paintClassPicker,
  [Tile.WhiskerSense]: paintWhiskerSense,
  [Tile.CheeseMagnet]: paintCheeseMagnet,
  [Tile.DecoyRat]: paintDecoyRat,
  [Tile.Disarm]: paintDisarm,
  [Tile.Cheese]: paintCheese,
  [Tile.ClassScout]: paintClassScout,
  [Tile.ClassThief]: paintClassThief,
  [Tile.ClassTrickster]: paintClassTrickster,
  [Tile.ClassTinkerer]: paintClassTinkerer,
  [Tile.SeekerPicker]: paintSeekerPicker,
};
MANOR_RUGS.forEach((_, i) => { MANOR_ART[(Tile.ManorRug0 + i) as Tile] = rugPainter(i); });

