// Painters for the vanilla cells declared in vanilla/tiles.ts. Same house
// style as tile_art.ts: small ramps, shape-built detail, tileable noise,
// final colours (no vibrance pass). Item sprites are drawn procedurally from a
// handful of silhouettes, recoloured per material, then outlined.

import {
  type Paint, type RGBA, CLEAR, Grid, bricks, hex, leaves, logTop, barkSide, mix, pick, planks, rnd, tfbm, tnoise,
} from './tile_art';
import { VANILLA_TILE_STYLES, type TileStyle } from './vanilla/tiles';
import { ITEM_TEMPLATES, OVERLAY_TEMPLATES } from './item_sprites';

const N = 16;
const pal = (hs: number[]): RGBA[] => hs.map((h) => hex(h));
const OUTLINE = hex(0x1c1d22);

function noise(p: number[], grain = 1): Paint {
  const P = pal(p);
  return (c, seed) => c.fill((x, y) => pick(P, tfbm(seed, x, y) * 1.2 * grain - .1 * grain + (1 - grain) * .5, x, y, .6));
}
function smooth(p: number[]): Paint {
  const P = pal(p);
  return (c, seed) => c.fill((x, y) => {
    let t = .55 + (tnoise(seed, x, y, 8) - .5) * .25;
    if (x === 0 || y === 0) t += .15;
    if (x === 15 || y === 15) t -= .15;
    return pick(P, t, x, y, .4);
  });
}
function wool(p: number[]): Paint {
  const P = pal(p);
  return (c, seed) => c.fill((x, y) => {
    // Knitted rows of V stitches.
    const v = (x + (y >> 1)) % 4, u = y % 2;
    let t = .55 + (rnd(seed, x >> 2, y >> 1) - .5) * .2;
    if (v === 0) t -= .25; else if (v === 1 && u === 0) t += .2;
    return pick(P, t, x, y, .5);
  });
}
function glass(frame: number, tint: number, alpha: number): Paint {
  const F = hex(frame), T = hex(tint, alpha), S = hex(0xffffff, Math.min(255, alpha + 60));
  return (c) => c.fill((x, y) => {
    if (x === 0 || y === 0 || x === 15 || y === 15) return F;
    if ((x - y === 3 || x - y === 4) && x > 3 && x < 12) return S;
    return alpha >= 200 ? T : hex(tint, Math.max(40, alpha - 110));
  });
}
function ore(stone: number[], o: number[]): Paint {
  const S = pal(stone), O = pal(o);
  return (c, seed) => c.fill((x, y) => {
    const blob = tnoise(seed ^ 77, x, y, 4);
    if (blob > .68 && rnd(seed, x, y) > .25) return pick(O, (blob - .68) * 3 + (x + y) % 2 * .2, x, y, .4);
    return pick(S, tfbm(seed, x, y) * 1.2 - .1, x, y, .6);
  });
}
function metal(p: number[]): Paint {
  const P = pal(p);
  return (c, seed) => c.fill((x, y) => {
    const u = x % 8, v = y % 8;
    let t = .55 + (tnoise(seed, x, y, 8) - .5) * .15;
    if (u === 0 || v === 0) t += .3;
    if (u === 7 || v === 7) t -= .3;
    if ((u === 2 || u === 5) && (v === 2 || v === 5)) t += .2; // rivet
    return pick(P, t, x, y, .3);
  });
}
function framed(p: number[], frame: number[]): Paint {
  const P = pal(p), F = hex(frame[0]);
  return (c, seed) => c.fill((x, y) => (x <= 1 || y <= 1 || x >= 14 || y >= 14) && !(x === 1 || y === 1 || x === 14 || y === 14)
    ? F : pick(P, .6 + (tnoise(seed, x, y, 8) - .5) * .2, x, y, .3));
}

// ── Special blocks ──────────────────────────────────────────────────────────

// ── Crafting table ──────────────────────────────────────────────────────────
// Pixel stamps over plank texture: '.' keeps the planks underneath.
type Canvas = Parameters<Paint>[0];
function stamp(c: Canvas, rows: string[], ink: Record<string, RGBA>): void {
  rows.forEach((row, y) => { for (let x = 0; x < N; x++) { const k = ink[row[x]]; if (k) c.set(x, y, k); } });
}
function craftInk(P: RGBA[]): Record<string, RGBA> {
  return {
    D: darker(P[0], .62), d: P[0], m: P[1], M: P[2], H: P[P.length - 1], h: P[P.length - 2],
    g: darker(P[0], .78), G: mix(P[1], P[0], .5),
    I: hex(0x8d939a), i: hex(0x5d6268), W: hex(0xc9ced3),
    S: hex(0xb9bec4), s: hex(0x7a8087), t: hex(0x4f545a),
    B: hex(0x6a4520), b: hex(0x4a2e14), Y: hex(0xd8b04a), y: hex(0x9c7a26),
  };
}
const CRAFT_TOP = [
  'DDDDDDDDDDDDDDDD',
  'DIIhhhhhhhhhhIID',
  'DIi..........iID',
  'Dh.HHHHHHHHHHd.D',
  'Dh.HggHggHggHd.D',
  'Dh.HgGHgGHgGHd.D',
  'Dh.HHHHHHHHHHd.D',
  'Dh.HggHggHggHd.D',
  'Dh.HgGHgGHgGHd.D',
  'Dh.HHHHHHHHHHd.D',
  'Dh.HggHggHggHd.D',
  'Dh.HgGHgGHgGHd.D',
  'Dh.dddddddddddsD',
  'DIi..........iID',
  'DIIddddddddddIID',
  'DDDDDDDDDDDDDDDD',
];
const CRAFT_FRONT = [
  'HHHHHHHHHHHHHHHH',
  'MMMMMMMMMMMMMMMM',
  'DDDDDDDDDDDDDDDD',
  'Dh............dD',
  'Dh...t......t.dD',
  'Dh..WSSSBb..I.dD',
  'Dh..SSSSBb.IIIdD',
  'Dh..SSSsBb.IiIdD',
  'Dh..SSssBb..B.dD',
  'Dh..Sss.....B.dD',
  'Dh..s.s.....B.dD',
  'Dh..........b.dD',
  'Dh............dD',
  'DhmmmmmmmmmmmmdD',
  'DhdddddddddddddD',
  'DDDDDDDDDDDDDDDD',
];
const CRAFT_SIDE = [
  'HHHHHHHHHHHHHHHH',
  'MMMMMMMMMMMMMMMM',
  'DDDDDDDDDDDDDDDD',
  'Dh............dD',
  'Dh..t.....t...dD',
  'Dh..YYYYYY....dD',
  'Dh..Yyyyy..IIIdD',
  'Dh..Yy....IIiIdD',
  'Dh..Yy.....BB.dD',
  'Dh..Yy.....Bb.dD',
  'Dh..Yy.....Bb.dD',
  'Dh..yy.....Bb.dD',
  'Dh.........bb.dD',
  'DhmmmmmmmmmmmmdD',
  'DhdddddddddddddD',
  'DDDDDDDDDDDDDDDD',
];

const SPECIAL: Record<string, (P: RGBA[]) => Paint> = {
  // Party Games arenas.
  pumpkin_face: (P) => (c, seed) => c.fill((x, y) => {
    const eye = (y >= 4 && y <= 6) && ((x >= 3 && x <= 5) || (x >= 10 && x <= 12));
    const mouth = (y >= 9 && y <= 11) && x >= 3 && x <= 12 && !(y === 9 && (x === 6 || x === 9)) && !(y === 11 && (x === 4 || x === 11));
    if (eye || mouth) return hex(y >= 9 ? 0xffc23a : 0xffd45a);
    let t = .55 + (tnoise(seed, x, y, 8) - .5) * .2;
    if (x % 4 === 0) t -= .25;
    return pick(P, t, x, y, .4);
  }),
  pot: (P) => (c, seed) => c.fill((x, y) => {
    let t = .5 + (tnoise(seed, x, y, 8) - .5) * .2;
    if (y === 3 || y === 12) t -= .35;
    if (y > 4 && y < 11 && ((x + y) % 6 === 0 || (x - y + 18) % 6 === 0)) t += .35;
    return pick(P, t, x, y, .3);
  }),
  glazed: (P) => (c) => c.fill((x, y) => {
    // A pinwheel of four curls in the house palette.
    const u = x < 8 ? x : 15 - x, v = y < 8 ? y : 15 - y;
    const q = (x < 8) === (y < 8);
    const a = q ? u : v, b = q ? v : u;
    if (a === 0 || b === 0) return P[0];
    if ((a + b) % 5 === 0) return P[3];
    if (a > b) return P[2];
    return P[1];
  }),
  mushroom: (P) => (c, seed) => c.fill((x, y) => {
    const spot = tnoise(seed ^ 31, x, y, 4) > .7;
    return spot ? P[4] : pick(P.slice(0, 4), .5 + (tnoise(seed, x, y, 8) - .5) * .3, x, y, .4);
  }),
  chiseled: (P) => (c, seed) => c.fill((x, y) => {
    const ring = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
    let t = .5 + (rnd(seed, x, y) - .5) * .2;
    if (ring > 6.5) t -= .3; else if (ring > 5.5) t += .25; else if (ring > 2.5 && ring < 3.5) t -= .25;
    return pick(P, t, x, y, .4);
  }),
  mossy_cobble: (P) => (c, seed) => c.fill((x, y) => {
    const m = tnoise(seed ^ 9, x, y, 4);
    if (m > .62) return pick(pal([0x3f5a2a, 0x4f6e33, 0x61833d, 0x74964a]), m, x, y, .6);
    const cell = Math.floor(tnoise(seed, x, y, 4) * 5);
    return pick(P, .35 + cell * .12 + (rnd(seed, x, y) - .5) * .2, x, y, .5);
  }),
  coarse_dirt: (P) => (c, seed) => c.fill((x, y) => rnd(seed, x, y) > .82 ? hex(0x8a8480) : pick(P, tfbm(seed, x, y), x, y, .6)),
  gravel: (P) => (c, seed) => c.fill((x, y) => {
    const pebble = tnoise(seed, x, y, 2);
    return pick(P, pebble * 1.1 + (rnd(seed ^ 4, x, y) - .5) * .3, x, y, .4);
  }),
  magma: (P) => (c, seed) => c.fill((x, y) => {
    const crack = Math.abs(tnoise(seed, x, y, 4) - .5) < .07;
    return crack ? pick(P.slice(3), rnd(seed, x, y), x, y) : pick(P.slice(0, 3), tfbm(seed, x, y), x, y, .5);
  }),
  craft_top: (P) => (c, seed) => { planks(P)(c, seed); stamp(c, CRAFT_TOP, craftInk(P)); },
  craft_side: (P) => (c, seed) => { planks(P)(c, seed); stamp(c, CRAFT_SIDE, craftInk(P)); },
  craft_front: (P) => (c, seed) => { planks(P)(c, seed); stamp(c, CRAFT_FRONT, craftInk(P)); },
  furnace_side: (P) => (c, seed) => c.fill((x, y) => pick(P, .45 + (tnoise(seed, x, y, 4) - .5) * .3 + (y < 2 ? .2 : 0), x, y, .5)),
  furnace_front: (P) => (c, seed) => {
    SPECIAL.furnace_side(P)(c, seed);
    for (let y = 8; y < 14; y++) for (let x = 4; x < 12; x++) c.set(x, y, y === 8 ? P[1] : hex(0x18181c));
  },
  furnace_lit: (P) => (c, seed) => {
    SPECIAL.furnace_side(P)(c, seed);
    for (let y = 8; y < 14; y++) for (let x = 4; x < 12; x++) {
      c.set(x, y, y === 8 ? P[1] : rnd(seed, x, y) > .4 ? hex(y > 11 ? 0xffb030 : 0xe8620c) : hex(0x3a1208));
    }
  },
  chest_side: (P) => (c, seed) => {
    planks(P)(c, seed);
    for (let i = 0; i < 16; i++) { c.set(i, 0, P[0]); c.set(i, 15, P[0]); c.set(0, i, P[0]); c.set(15, i, P[0]); c.set(i, 5, P[0]); }
  },
  chest_front: (P) => (c, seed) => {
    SPECIAL.chest_side(P)(c, seed);
    for (let y = 4; y < 8; y++) for (let x = 7; x < 9; x++) c.set(x, y, hex(y === 4 ? 0xd6dadc : 0x9da3a8));
  },
  chest_top: (P) => (c, seed) => {
    planks(P)(c, seed);
    for (let i = 0; i < 16; i++) { c.set(i, 0, P[0]); c.set(i, 15, P[0]); c.set(0, i, P[0]); c.set(15, i, P[0]); }
  },
  bookshelf: (P) => (c, seed) => c.fill((x, y) => {
    if (y < 1 || y === 7 || y === 8 || y > 14) return P[y === 8 ? 4 : 1];
    const book = x >> 1, row = y < 8 ? 0 : 1;
    const colours = [0xa83228, 0x2f5aa8, 0x3a8a3a, 0xc8a030, 0x7a3aa0, 0x2a8a8a, 0xb05a20, 0x6a6a6a];
    const h = 5 + Math.floor(rnd(seed, book, row) * 2);
    const top = row === 0 ? 7 - h : 15 - h;
    if (y < top || x % 2 === 1 && rnd(seed ^ 2, book, row) > .7) return P[0];
    return mix(hex(colours[Math.floor(rnd(seed ^ 5, book, row) * 8)]), hex(0), x % 2 ? .25 : 0);
  }),
  barrel_side: (P) => (c, seed) => {
    planks(P)(c, seed);
    for (let x = 0; x < 16; x++) { c.set(x, 3, hex(0x4a4e53)); c.set(x, 12, hex(0x4a4e53)); }
  },
  barrel_top: (P) => (c, seed) => c.fill((x, y) => {
    const d = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
    if (d > 6.5) return hex(0x4a4e53);
    return pick(P, .5 + (rnd(seed, x >> 2, y) - .5) * .3 - (x % 4 === 0 ? .3 : 0), x, y, .5);
  }),
  loom: (P) => (c, seed) => {
    planks(P)(c, seed);
    for (let y = 3; y < 13; y++) for (let x = 3; x < 13; x++) c.set(x, y, (x + y) % 2 ? hex(0xe8e2d8) : hex(0xc23030));
  },
  smoker: (P) => (c, seed) => {
    SPECIAL.furnace_side(P)(c, seed);
    for (let y = 8; y < 14; y++) for (let x = 3; x < 13; x++) c.set(x, y, y === 8 ? hex(0x5a3a20) : hex(0x1a1410));
  },
  tnt_side: (P) => (c) => c.fill((x, y) => {
    if (y >= 5 && y <= 10) return y === 5 || y === 10 ? hex(0x2a2a2e) : hex(0xe8e2d8);
    return pick(P, .5 + (x % 4 === 0 ? -.4 : 0), x, y, .3);
  }),
  tnt_top: (P) => (c) => c.fill((x, y) => {
    const d = Math.hypot(x - 7.5, y - 7.5);
    if (d < 2) return hex(0x2a2a2e);
    return pick(P, .55 + ((x % 5 === 0 || y % 5 === 0) ? -.35 : 0), x, y, .3);
  }),
  tnt_bottom: (P) => (c) => c.fill((x, y) => pick(P, .4 + ((x % 5 === 0 || y % 5 === 0) ? -.3 : 0), x, y, .3)),
  ladder: (P) => (c) => c.fill((x, y) => {
    if (x === 2 || x === 3 || x === 12 || x === 13) return P[x % 2 ? 2 : 4];
    if (y % 4 === 1 && x > 3 && x < 12) return P[3];
    if (y % 4 === 2 && x > 3 && x < 12) return P[1];
    return CLEAR;
  }),
  scaffolding: (P) => (c) => c.fill((x, y) => {
    if (x <= 1 || x >= 14 || y <= 1 || y >= 14) return P[(x + y) % 2 ? 2 : 3];
    if (Math.abs(x - y) <= 0 || Math.abs(x + y - 15) <= 0) return P[1];
    return CLEAR;
  }),
  cobweb: (P) => (c) => c.fill((x, y) => {
    const dx = x - 7.5, dy = y - 7.5, d = Math.hypot(dx, dy);
    const spoke = Math.abs(dx) < .6 || Math.abs(dy) < .6 || Math.abs(Math.abs(dx) - Math.abs(dy)) < .6;
    const ring = Math.abs(d % 3 - 1.5) < .45;
    return spoke || ring && d < 8 ? P[1] : CLEAR;
  }),
  slime: (P) => (c) => c.fill((x, y) => {
    const inner = x >= 3 && x <= 12 && y >= 3 && y <= 12;
    if (inner) return hex(0x5aa844, 230);
    return hex(x === 0 || y === 0 || x === 15 || y === 15 ? 0x3f8a2e : 0x86d070, 170);
  }),
  honey: (P) => (c, seed) => c.fill((x, y) => {
    const edge = x <= 1 || y <= 1 || x >= 14 || y >= 14;
    return edge ? P[1] : pick(P, .6 + (tnoise(seed, x, y, 4) - .5) * .4, x, y, .4);
  }),
  hay_side: (P) => (c, seed) => c.fill((x, y) => {
    if (y === 4 || y === 11) return hex(0x8a3020);
    return pick(P, .5 + (rnd(seed, x, 0) - .5) * .5 + (rnd(seed, x, y) - .5) * .2, x, y, .4);
  }),
  hay_top: (P) => (c, seed) => c.fill((x, y) => {
    const d = Math.hypot(x - 7.5, y - 7.5);
    return pick(P, .5 + Math.sin(d * 1.7) * .25 + (rnd(seed, x, y) - .5) * .2, x, y, .4);
  }),
  packed_ice: (P) => (c, seed) => c.fill((x, y) => {
    const crack = Math.abs(tnoise(seed, x, y, 8) - .5) < .05;
    return crack ? P[4] : pick(P, .4 + (tnoise(seed ^ 3, x, y, 4) - .5) * .5, x, y, .4);
  }),
  lava: (P) => (c, seed) => c.fill((x, y) => pick(P, tfbm(seed, x, y) * 1.3 - .1, x, y, .5)),
  fire: (P) => (c, seed) => c.fill((x, y) => {
    const h = 6 + tnoise(seed, x, 0, 4) * 10;
    const v = (15 - y) / h;
    if (v > 1 || rnd(seed, x, y) > .9) return CLEAR;
    return pick(P, 1 - v + (rnd(seed ^ 3, x, y) - .5) * .3, x, y, .5);
  }),
  anvil_top: (P) => (c, seed) => c.fill((x, y) => {
    const d = Math.abs(y - 7.5);
    return pick(P, .55 - d * .03 + (tnoise(seed, x, y, 4) - .5) * .2 + (x === 1 ? .2 : 0), x, y, .4);
  }),
  iron_bars: (P) => (c) => c.fill((x, y) => {
    if (x % 4 === 1) return P[2];
    if (x % 4 === 2) return P[1];
    if (y === 1 || y === 14) return P[1];
    return CLEAR;
  }),
  iron_trapdoor: (P) => (c) => c.fill((x, y) => {
    if (x <= 1 || y <= 1 || x >= 14 || y >= 14) return P[1];
    if ((x === 5 || x === 10) && y > 2 && y < 13) return P[0];
    return (x + y) % 3 === 0 ? P[2] : P[3];
  }),
  oak_trapdoor: (P) => (c, seed) => c.fill((x, y) => {
    if (x <= 1 || y <= 1 || x >= 14 || y >= 14) return P[1];
    if (y >= 5 && y <= 10 && x >= 4 && x <= 11) return CLEAR;
    return pick(P, .55 + (rnd(seed, x >> 2, 0) - .5) * .3, x, y, .4);
  }),
  door_lower: (P) => (c, seed) => c.fill((x, y) => {
    if (x <= 0 || x >= 15 || y >= 15) return P[0];
    if (y === 7 && x === 12) return hex(0x3a3e44);
    return pick(P, .5 + (rnd(seed, x >> 2, 0) - .5) * .3 - (x % 4 === 0 ? .3 : 0), x, y, .4);
  }),
  door_upper: (P) => (c, seed) => c.fill((x, y) => {
    if (x <= 0 || x >= 15 || y <= 0) return P[0];
    if (y >= 3 && y <= 9 && x >= 3 && x <= 12) return (x === 7 || x === 8 || y === 6) ? P[1] : CLEAR;
    return pick(P, .5 + (rnd(seed, x >> 2, 0) - .5) * .3, x, y, .4);
  }),
  lantern: (P) => (c) => c.fill((x, y) => {
    if (x < 4 || x > 11 || y < 2 || y > 15) return CLEAR;
    if (y <= 4 || y >= 14 || x === 4 || x === 11) return P[y <= 4 ? 1 : 0];
    return P[y > 8 ? 2 : 3];
  }),
  torch: (P) => (c) => c.fill((x, y) => {
    if (x < 7 || x > 8) return CLEAR;
    if (y < 6) return y < 4 ? P[3] : P[2];
    return P[x === 7 ? 1 : 0];
  }),
  sea_lantern: (P) => (c, seed) => c.fill((x, y) => {
    const edge = x === 0 || y === 0 || x === 15 || y === 15;
    return edge ? P[0] : pick(P, .6 + (tnoise(seed, x, y, 4) - .5) * .6, x, y, .5);
  }),
  lamp: (P) => (c, seed) => c.fill((x, y) => {
    const frame = x <= 1 || y <= 1 || x >= 14 || y >= 14;
    return frame ? P[1] : pick(P.slice(2), tnoise(seed, x, y, 4), x, y, .5);
  }),
  cake_top: (P) => (c) => c.fill((x, y) => (x * 7 + y * 3) % 23 === 0 ? P[3] : P[(x + y) % 3 === 0 ? 1 : 2]),
  cake_side: (P) => (c) => c.fill((x, y) => y < 4 ? P[3] : y === 4 ? P[2] : P[(y % 3 === 0) ? 1 : 0]),
  target: (P) => (c) => c.fill((x, y) => {
    const d = Math.hypot(x - 7.5, y - 7.5);
    return d < 2 || (d > 4 && d < 6) ? P[0] : P[d > 7 ? 2 : 1];
  }),
  glowstone: (P) => (c, seed) => c.fill((x, y) => pick(P, tnoise(seed, x, y, 4) * .7 + rnd(seed, x, y) * .4, x, y, .5)),
};

// ── Item silhouettes ────────────────────────────────────────────────────────

type Shape = (g: Grid, P: RGBA[], seed: number) => void;
const handle = pal([0x4a3216, 0x5f411e, 0x765229, 0x8b6334]);
function line(g: Grid, x0: number, y0: number, x1: number, y1: number, c: (i: number) => RGBA): void {
  const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
  for (let i = 0; i <= n; i++) g.put(Math.round(x0 + (x1 - x0) * i / n), Math.round(y0 + (y1 - y0) * i / n), c(i));
}
function disc(g: Grid, cx: number, cy: number, r: number, c: (x: number, y: number, d: number) => RGBA): void {
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const d = Math.hypot(x - cx, y - cy);
    if (d <= r) g.put(x, y, c(x, y, d / r));
  }
}
function rect(g: Grid, x0: number, y0: number, x1: number, y1: number, c: (x: number, y: number) => RGBA): void {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) g.put(x, y, c(x, y));
}
const lit = (P: RGBA[], x: number, y: number, cx: number, cy: number): RGBA =>
  P[Math.max(0, Math.min(P.length - 1, Math.round((P.length - 1) * (.6 - ((x - cx) + (y - cy)) * .08))))];
const tool = (head: (g: Grid, P: RGBA[]) => void): Shape => (g, P) => {
  line(g, 3, 13, 9, 7, (i) => handle[i % 2 ? 1 : 3]);
  head(g, P);
};
const SHAPES: Record<string, Shape> = {
  sword: (g, P) => {
    line(g, 2, 14, 4, 12, () => handle[2]);
    line(g, 2, 10, 6, 14, () => P[0]);
    for (let i = 0; i < 9; i++) { g.put(5 + i, 11 - i, P[3] ?? P[2]); g.put(5 + i, 10 - i, P[1]); g.put(6 + i, 11 - i, P[2]); }
    g.put(14, 1, P[P.length - 1]);
  },
  pickaxe: tool((g, P) => {
    line(g, 4, 3, 8, 2, (i) => P[1 + (i % 2)]); line(g, 8, 2, 12, 3, (i) => P[2 + (i % 2) - 1]);
    line(g, 12, 3, 13, 7, () => P[1]); line(g, 4, 3, 3, 4, () => P[0]);
    line(g, 9, 3, 10, 6, () => P[P.length - 1]);
  }),
  axe: tool((g, P) => {
    rect(g, 9, 2, 12, 6, (x, y) => lit(P, x, y, 10, 4)); g.put(12, 2, CLEAR); g.put(13, 4, P[1]); g.put(8, 5, P[0]);
  }),
  shovel: tool((g, P) => {
    rect(g, 9, 3, 12, 6, (x, y) => lit(P, x, y, 10, 4)); g.put(12, 3, CLEAR); g.put(9, 6, CLEAR); g.put(13, 2, P[1]);
  }),
  hoe: tool((g, P) => { line(g, 8, 3, 12, 3, () => P[2]); line(g, 8, 4, 9, 4, () => P[1]); }),
  helmet: (g, P) => { rect(g, 3, 4, 12, 9, (x, y) => lit(P, x, y, 7, 6)); rect(g, 5, 7, 10, 9, () => CLEAR); },
  chestplate: (g, P) => {
    rect(g, 2, 3, 13, 13, (x, y) => lit(P, x, y, 7, 8));
    rect(g, 6, 3, 9, 5, () => CLEAR); rect(g, 2, 8, 3, 13, () => CLEAR); rect(g, 12, 8, 13, 13, () => CLEAR);
  },
  leggings: (g, P) => { rect(g, 3, 2, 12, 14, (x, y) => lit(P, x, y, 7, 7)); rect(g, 7, 6, 8, 14, () => CLEAR); },
  boots: (g, P) => { rect(g, 2, 8, 6, 13, (x, y) => lit(P, x, y, 4, 10)); rect(g, 9, 8, 13, 13, (x, y) => lit(P, x, y, 11, 10)); },
  stick: (g, P) => line(g, 3, 13, 12, 2, (i) => P[i % 2 ? 1 : 2]),
  ingot: (g, P) => { for (let y = 6; y <= 11; y++) for (let x = 2 + (11 - y); x <= 13 - (y - 6) % 2; x++) g.put(x, y, lit(P, x, y, 7, 8)); },
  gem: (g, P) => {
    for (let y = 3; y <= 13; y++) { const w = y < 7 ? (y - 3) + 2 : 13 - y + 1; for (let x = 8 - w; x <= 7 + w; x++) g.put(x, y, lit(P, x, y, 7, 6)); }
  },
  lump: (g, P, seed) => disc(g, 7.5, 8, 5, (x, y, d) => lit(P, x, y, 6, 6) && (d > .8 && rnd(seed, x, y) > .5 ? P[0] : lit(P, x, y, 6, 6))),
  string: (g, P) => { for (let i = 0; i < 12; i++) g.put(2 + i, 8 + Math.round(Math.sin(i * .9) * 3), P[1 + i % 2]); },
  feather: (g, P) => { line(g, 3, 13, 12, 3, () => P[0]); for (let i = 0; i < 9; i++) { g.put(5 + i, 12 - i, P[2]); g.put(4 + i, 11 - i, P[3]); } },
  hide: (g, P) => rect(g, 3, 3, 12, 12, (x, y) => (x === 3 || x === 12) && (y === 3 || y === 12) ? CLEAR : lit(P, x, y, 7, 7)),
  paper: (g, P) => rect(g, 3, 2, 12, 13, (x, y) => y % 3 === 0 && x > 4 && x < 11 ? P[0] : P[2 + (x + y) % 2]),
  book: (g, P) => { rect(g, 3, 2, 12, 13, (x, y) => x === 3 ? P[0] : P[1 + (y % 4 === 0 ? 1 : 0)]); rect(g, 11, 3, 12, 12, () => P[3]); },
  bow: (g) => {
    for (let i = 0; i < 11; i++) { const a = i / 10 * Math.PI; g.put(Math.round(3 + Math.sin(a) * 5), 2 + i + (i > 5 ? 1 : 0), handle[1 + i % 2]); }
    line(g, 3, 2, 3, 13, () => hex(0xe0e3e6));
  },
  crossbow: (g) => { line(g, 3, 12, 12, 3, (i) => handle[i % 3]); line(g, 2, 6, 9, 13, () => hex(0x6a6e74)); g.put(10, 5, hex(0xe0e3e6)); },
  arrow: (g, P) => { line(g, 3, 12, 11, 4, () => P[1]); rect(g, 11, 2, 13, 4, () => P[2]); g.put(2, 13, P[3]); g.put(3, 13, P[3]); g.put(2, 12, P[3]); },
  shield: (g, P) => {
    for (let y = 2; y <= 14; y++) { const w = y < 10 ? 5 : 5 - (y - 9); for (let x = 7 - w; x <= 8 + w; x++) g.put(x, y, x === 7 - w || x === 8 + w || y === 2 ? P[2] : P[1]); }
    line(g, 7, 3, 7, 12, () => P[3]);
  },
  bucket: (g, P) => { for (let y = 4; y <= 13; y++) { const w = 6 - (y - 4) / 3; for (let x = Math.round(8 - w); x <= Math.round(7 + w); x++) g.put(x, y, lit(P, x, y, 6, 6)); } rect(g, 4, 4, 11, 5, () => hex(0x2a2a2e)); },
  bucket_water: (g, P) => { SHAPES.bucket(g, P, 0); rect(g, 4, 4, 11, 5, () => hex(0x3a70d8)); },
  bucket_lava: (g, P) => { SHAPES.bucket(g, P, 0); rect(g, 4, 4, 11, 5, () => hex(0xe8620c)); },
  bucket_milk: (g, P) => { SHAPES.bucket(g, P, 0); rect(g, 4, 4, 11, 5, () => hex(0xfafafa)); },
  bucket_snow: (g, P) => { SHAPES.bucket(g, P, 0); rect(g, 4, 4, 11, 5, () => hex(0xe6eef8)); },
  flint_steel: (g, P) => { rect(g, 3, 8, 7, 12, () => P[1]); line(g, 8, 3, 12, 7, () => P[3]); line(g, 8, 4, 11, 7, () => P[2]); },
  ball: (g, P) => disc(g, 7.5, 7.5, 5, (x, y) => lit(P, x, y, 6, 6)),
  egg: (g, P) => { for (let y = 2; y <= 13; y++) { const w = Math.sqrt(Math.max(0, 1 - ((y - 8) / 6) ** 2)) * (y < 8 ? 4 : 5); for (let x = Math.round(7.5 - w); x <= Math.round(7.5 + w); x++) g.put(x, y, lit(P, x, y, 6, 6)); } },
  rod: (g, P) => { line(g, 2, 14, 12, 2, (i) => P[i % 2 ? 1 : 2]); line(g, 12, 2, 12, 10, () => hex(0xe0e3e6)); g.put(12, 11, hex(0x9ca1a6)); },
  shears: (g, P) => { line(g, 4, 3, 10, 9, () => P[2]); line(g, 10, 3, 4, 9, () => P[3]); disc(g, 4, 12, 2, () => hex(0xc23030)); disc(g, 11, 12, 2, () => hex(0xc23030)); },
  trident: (g, P) => { line(g, 2, 14, 11, 5, () => P[1]); line(g, 9, 3, 13, 7, () => P[2]); line(g, 11, 5, 13, 1, () => P[3]); line(g, 9, 3, 9, 1, () => P[3]); line(g, 13, 7, 15, 7, () => P[3]); },
  mace: (g, P) => { line(g, 2, 14, 8, 8, (i) => handle[i % 3]); disc(g, 10.5, 5.5, 3.5, (x, y) => lit(P, x, y, 9, 4)); g.put(14, 2, P[3]); g.put(7, 2, P[3]); g.put(14, 9, P[3]); },
  elytra: (g, P) => { for (let y = 2; y <= 14; y++) { const w = Math.round(6 - Math.abs(y - 6) * .5); for (let x = 1; x <= w; x++) { g.put(7 - x, y, lit(P, 7 - x, y, 4, 5)); g.put(8 + x, y, lit(P, 8 + x, y, 11, 5)); } } },
  rocket: (g, P) => { line(g, 4, 12, 10, 6, () => P[2]); line(g, 5, 12, 11, 6, () => P[1]); rect(g, 10, 3, 12, 5, () => P[1]); line(g, 2, 14, 4, 12, () => P[3]); },
  totem: (g, P) => { rect(g, 5, 2, 10, 13, (x, y) => lit(P, x, y, 7, 6)); g.put(6, 5, P[3]); g.put(9, 5, P[3]); rect(g, 3, 7, 12, 8, () => P[1]); },
  crystal: (g, P) => { SHAPES.gem(g, P, 0); rect(g, 6, 6, 9, 9, () => P[3]); },
  fruit: (g, P, seed) => disc(g, 7.5, 8, 5, (x, y) => rnd(seed, x, y) > .8 ? P[3] : lit(P, x, y, 6, 6)),
  steak: (g, P) => { disc(g, 7, 8, 5.5, (x, y, d) => d > .75 ? P[3] : lit(P, x, y, 6, 7)); line(g, 11, 11, 14, 14, () => hex(0xe8e2d8)); },
  bread: (g, P) => { for (let x = 2; x <= 13; x++) for (let y = 6; y <= 11; y++) if (Math.abs(y - 8.5) <= 3 - Math.abs(x - 7.5) * .15) g.put(x, y, lit(P, x, y, 6, 7)); },
  carrot: (g, P) => { for (let i = 0; i < 9; i++) { const w = Math.max(0, 2 - i / 4); for (let k = -w; k <= w; k++) g.put(Math.round(4 + i + k * .7), Math.round(12 - i - k * .7), P[1 + (i % 2)]); } g.put(13, 2, hex(0x4a9a2a)); g.put(12, 1, hex(0x4a9a2a)); },
  apple: (g, P) => { disc(g, 7.5, 9, 5, (x, y) => lit(P, x, y, 6, 7)); line(g, 8, 2, 8, 4, () => handle[1]); g.put(9, 3, hex(0x4a9a2a)); },
  potato: (g, P, seed) => disc(g, 7.5, 8.5, 4.5, (x, y) => rnd(seed, x, y) > .85 ? P[0] : lit(P, x, y, 6, 7)),
  pie: (g, P) => { for (let y = 6; y <= 11; y++) for (let x = 2; x <= 13; x++) g.put(x, y, y < 8 ? P[3] : lit(P, x, y, 7, 9)); },
  potion: (g, P) => { disc(g, 7.5, 10, 4, (x, y) => (x + y) % 5 === 0 ? P[3] : hex(0x5a7ad0)); rect(g, 6, 3, 9, 6, () => P[2]); rect(g, 6, 2, 9, 2, () => handle[2]); },
  splash: (g, P) => { SHAPES.potion(g, P, 0); g.put(10, 3, P[3]); g.put(11, 4, P[3]); },
  lingering: (g, P) => { SHAPES.potion(g, P, 0); rect(g, 5, 5, 10, 5, () => P[1]); },
  compass: (g, P) => { disc(g, 7.5, 7.5, 5.5, (x, y, d) => d > .8 ? P[1] : P[3]); line(g, 7, 7, 10, 4, () => P[2]); line(g, 7, 8, 5, 11, () => P[0]); },
  boat: (g, P) => { for (let y = 7; y <= 12; y++) { const w = 7 - (y - 7) * .6; for (let x = Math.round(7.5 - w); x <= Math.round(7.5 + w); x++) g.put(x, y, lit(P, x, y, 7, 8)); } rect(g, 3, 6, 12, 6, () => P[0]); },
  dye: (g, P) => { disc(g, 7.5, 9, 4.5, (x, y) => lit(P, x, y, 6, 7)); rect(g, 7, 2, 8, 5, () => P[0]); },
  tear: (g, P) => { for (let y = 3; y <= 13; y++) { const w = y < 8 ? (y - 3) * .7 : Math.sqrt(Math.max(0, 1 - ((y - 9.5) / 4) ** 2)) * 4; for (let x = Math.round(7.5 - w); x <= Math.round(7.5 + w); x++) g.put(x, y, lit(P, x, y, 6, 7)); } },
  bowl: (g, P) => { for (let y = 8; y <= 12; y++) { const w = 6 - (y - 8); for (let x = Math.round(7.5 - w); x <= Math.round(7.5 + w); x++) g.put(x, y, lit(P, x, y, 7, 9)); } },
};

/** Liquid colours for the bucket variants (the template's 'L'). */
const BUCKET_FILL: Record<string, number> = {
  bucket_water: 0x3a70d8, bucket_lava: 0xf07a14, bucket_milk: 0xf6f6f2, bucket_snow: 0xe2ecf8,
};
const darker = (c: RGBA, k: number): RGBA => [c[0] * k, c[1] * k, c[2] * k, c[3]];
/** A hand-drawn template (item_sprites.ts) painted in the material ramp. */
function templated(shape: string, P: RGBA[]): Paint | null {
  const fill = BUCKET_FILL[shape];
  const t = ITEM_TEMPLATES[fill !== undefined ? 'bucket' : shape];
  if (!t) return null;
  const extra: Record<string, RGBA> = {};
  for (const [k, v] of Object.entries(t.x ?? {})) extra[k] = hex(v);
  if (fill !== undefined) extra.L = hex(fill);
  const ramp = (k: number) => P[Math.round((k - 1) / 5 * (P.length - 1))];
  const outline = mix(OUTLINE, darker(P[0], .55), .35);
  return (c) => {
    const g = new Grid();
    t.rows.forEach((row, y) => {
      for (let x = 0; x < N; x++) {
        const ch = row[x];
        if (ch === '.' || ch === undefined) continue;
        const col = ch >= '1' && ch <= '6' ? ramp(+ch) : ch >= 'a' && ch <= 'd' ? handle[ch.charCodeAt(0) - 97]
          : ch === 'o' ? outline : extra[ch];
        if (col) g.put(x, y, col);
      }
    });
    if (!t.noOutline) g.outline(outline);
    g.to(c);
  };
}
/** Greyscale tint mask: grey levels the icon renderer multiplies by a colour. */
function overlay(spec: { from: string; levels: Record<string, number> }): Paint {
  const rows = ITEM_TEMPLATES[spec.from].rows;
  return (c) => c.fill((x, y) => {
    const k = spec.levels[rows[y][x]];
    if (!k) return CLEAR;
    const v = Math.round(255 * (.55 + (k - 1) * .09));
    return [v, v, v, 255];
  });
}

function sprite(shape: string, p: number[]): Paint {
  if (OVERLAY_TEMPLATES[shape]) return overlay(OVERLAY_TEMPLATES[shape]);
  const P = pal(p);
  const hand = templated(shape, P);
  if (hand) return hand;
  const draw = SHAPES[shape] ?? SHAPES.lump;
  return (c, seed) => {
    const g = new Grid();
    draw(g, P, seed);
    g.outline(OUTLINE);
    g.to(c);
  };
}

function painter(style: TileStyle): Paint {
  switch (style.s) {
    case 'noise': return noise(style.pal, style.grain ?? 1);
    case 'smooth': return smooth(style.pal);
    case 'planks': return planks(pal(style.pal));
    case 'bricks': return bricks(pal(style.pal), hex(style.mortar), { w: style.w, h: style.h });
    case 'tiles': return bricks(pal(style.pal), hex(style.mortar), { w: style.size, h: style.size, texture: .15 });
    case 'wool': return wool(style.pal);
    case 'glass': return glass(style.frame, style.tint, style.alpha);
    case 'bark': return barkSide(pal(style.pal), 4);
    case 'banded': return barkSide(pal(style.pal), 5);
    case 'logtop': return logTop(pal(style.bark), pal(style.wood));
    case 'leaves': return leaves(pal(style.pal));
    case 'ore': return ore(style.pal, style.ore);
    case 'metal': return metal(style.pal);
    case 'gem': return metal(style.pal);
    case 'framed': return framed(style.pal, style.frame);
    case 'special': return (SPECIAL[style.name] ?? ((P: RGBA[]) => smooth(P.map((c) => (c[0] << 16) | (c[1] << 8) | c[2]))))(pal(style.pal));
    case 'sprite': return sprite(style.shape, style.pal);
  }
}

/** Every vanilla cell's painter, keyed by atlas cell. */
export const VANILLA_ART: Record<number, Paint> = {};
for (const [id, style] of Object.entries(VANILLA_TILE_STYLES)) VANILLA_ART[Number(id)] = painter(style);
