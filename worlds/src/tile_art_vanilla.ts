// Painters for the vanilla cells declared in vanilla/tiles.ts. Same house
// style as tile_art.ts: small ramps, shape-built detail, tileable noise,
// final colours (no vibrance pass). Item sprites are drawn procedurally from a
// handful of silhouettes, recoloured per material, then outlined.

import {
  type Paint, type RGBA, CLEAR, COBBLE, Grid, STONE_OPTS, bricks, hex, leaves, logTop, barkSide, mix, pick, planks, rnd, tfbm, tnoise,
} from './tile_art';
import {
  capture, clay, concrete, gemBlock, pebbles, glassPane, granular, knit, metalBlock, obsidian, ore, polished, rock,
} from './tile_materials';
import { enrich, grainPick, h, voronoi } from './tile_kit';

const STONE_PAL = [0x61646c, 0x72757d, 0x81848c, 0x8e9199, 0x9b9ea6, 0xa9acb3];
import { VANILLA_TILE_STYLES, type TileStyle } from './vanilla/tiles';
import { ITEM_TEMPLATES, OVERLAY_TEMPLATES } from './item_sprites';

const N = 16;
const pal = (hs: number[]): RGBA[] => hs.map((h) => hex(h));
const OUTLINE = hex(0x1c1d22);

/** Natural stone used under the ores: the same rock as the Stone tile. */
const OVERWORLD_STONE = rock(pal(STONE_PAL), STONE_OPTS);

function ribbed(p: number[], mark: number): Paint { return ribbedPal(pal(p), hex(mark)); }
function framed(p: number[], frame: number[]): Paint {
  // A bevelled slab inside a recessed frame (pillar ends, pumpkin crowns).
  const P = enrich(pal(p)), F = hex(frame[0]);
  const lo = mix(F, hex(0), .3);
  return (c, seed) => c.fill((x, y) => {
    const r = Math.min(x, y, 15 - x, 15 - y);
    if (r === 0) return x === 15 || y === 15 ? lo : F;
    let t = .55 + (tfbm(seed, x, y) - .5) * .25;
    if (r === 1) t += x === 1 || y === 1 ? .3 : -.3;
    if (r === 2) t += x === 2 || y === 2 ? -.12 : .1;
    return grainPick(P, t, x, y, seed, .35);
  });
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


// ── Utility-block helpers ───────────────────────────────────────────────────

const darker = (c: RGBA, k: number): RGBA => [c[0] * k, c[1] * k, c[2] * k, c[3]];
/** Stamp a full tile from rows of inks (every letter must have an ink). */
function stampOnly(c: Canvas, rows: string[], ink: Record<string, RGBA>): void {
  c.fill((x, y) => ink[rows[y][x]] ?? CLEAR);
}
/** Stone body for furnaces: the overworld rock inside a bevelled frame. */
function furnaceBody(P: RGBA[]): Paint {
  const E = enrich(P);
  return (c, seed) => {
    const rockPx = capture(OVERWORLD_STONE, seed);
    c.fill((x, y) => {
      const r = Math.min(x, y, 15 - x, 15 - y);
      if (r === 0) return E[x === 0 || y === 0 ? 4 : 0];
      if (y === 1) return E[5];
      return rockPx[y * N + x];
    });
  };
}
function furnaceFront(P: RGBA[], lit: boolean): Paint {
  const E = enrich(P), body = furnaceBody(P);
  const fire = [hex(0x5a1206), hex(0xa82a08), hex(0xe8620c), hex(0xffa020), hex(0xffe070)];
  const ink: Record<string, RGBA> = {
    k: E[0], H: E[5], v: hex(0x1a1a1e), s: darker(E[1], .8), o: darker(E[0], .55),
    D: hex(0x141418), g: hex(0x8a9096),
  };
  return (c, seed) => {
    body(c, seed);
    FURNACE_FRONT.forEach((row, y) => {
      for (let x = 0; x < N; x++) {
        const k = row[x];
        if (k === '.') continue;
        if (k === 'D' && lit) {
          // Flames rising off the coals: hottest at the bottom.
          const t = (y - 6) / 7 + (rnd(seed ^ 0x33, x, y) - .5) * .5;
          c.set(x, y, fire[Math.max(0, Math.min(4, Math.round(t * 4)))]);
        } else if (k === 'g' && lit) c.set(x, y, hex(0xffc860));
        else c.set(x, y, ink[k]);
      }
    });
    if (lit) for (let x = 1; x < 15; x++) c.set(x, 14, hex(0xffb050)); // glow on the hearth lip
  };
}
function chestFace(P: RGBA[], rows: string[]): Paint {
  const E = enrich(P);
  const ink: Record<string, RGBA> = {
    D: darker(E[0], .55), d: E[0], h: E[E.length - 2], H: E[E.length - 1],
    I: hex(0x9aa0a8), W: hex(0x5a5f66), S: hex(0xe8ecf0), l: hex(0x2a2c30),
  };
  return (c, seed) => { planks(P)(c, seed); stamp(c, rows, ink); };
}
function tntInk(P: RGBA[]): Record<string, RGBA> {
  const E = enrich(P);
  return {
    k: hex(0x2a1210), H: mix(E[2], hex(0xffffff), .25), M: E[2], m: E[1], d: E[0], c: hex(0x1a0c0a),
    W: hex(0xf0e8d8), w: hex(0xc8bca8), b: hex(0x222226), S: hex(0x6a5a48), F: hex(0xd8c8a0),
  };
}
/** Ends of the stick bundle: four paper-wrapped stick ends with wick holes,
 *  and (on top) a braided fuse gathering them in the middle. */
function tntEnds(P: RGBA[], fuse: boolean): Paint {
  const ink = tntInk(P);
  return (c) => c.fill((x, y) => {
    if (fuse) {
      const d = Math.hypot(x - 7.5, y - 7.5);
      if (d < 1.3) return ink.F;
      if (d < 2.1) return ink.S;
    }
    const cx = x < 8 ? 3.5 : 11.5, cy = y < 8 ? 3.5 : 11.5;
    const d = Math.hypot(x - cx, y - cy);
    if (d > 3.6) return ink.k;
    if (d < 1) return ink.c;
    if (d > 2.9) return x - cx + y - cy < 0 ? ink.m : ink.d;
    return x - cx + y - cy < -1 ? ink.H : ink.M;
  });
}
function doorFace(P: RGBA[], rows: string[]): Paint {
  const E = enrich(P);
  const ink: Record<string, RGBA> = {
    D: darker(E[0], .6), d: E[0], h: E[1], H: E[E.length - 1],
    k: hex(0x3a3e44), K: hex(0xc8ccd2), G: CLEAR, g: hex(0xe8f8ff, 235),
  };
  return (c, seed) => { planks(P)(c, seed); stamp(c, rows, ink); };
}
function ribbedPal(P: RGBA[], mark: RGBA): Paint {
  // Vertical ribs (pumpkin, cactus, quartz pillar, mushroom stem): each rib
  // domed, lit on its left, with a groove of `mark` between ribs.
  const E = enrich(P);
  return (c, seed) => c.fill((x, y) => {
    const u = x & 3;
    if (u === 0) return mix(mark, E[0], (tnoise(seed, x, y, 4) - .5) * .5 + .25);
    let t = u === 1 ? .82 : u === 2 ? .58 : .3;
    t += (tnoise(seed ^ 2, x, y, 4) - .5) * .22 + (rnd(seed, x >> 2, y >> 3) - .5) * .12;
    return grainPick(E, t, x, y, seed, .35);
  });
}

// ── Utility-block stamps ────────────────────────────────────────────────────
// '.' keeps the material painted underneath; other letters are inks.

const FURNACE_FRONT = [
  '................',
  '.kkkkkkkkkkkkkk.',
  '.kHHHHHHHHHHHHk.',
  '.kHvvHvvHvvHvvk.',
  '.kssssssssssssk.',
  '................',
  '....oooooooo....',
  '...oDDDDDDDDo...',
  '..oDDDDDDDDDDo..',
  '..oDDDDDDDDDDo..',
  '..oDDDDDDDDDDo..',
  '..oggggggggggo..',
  '..oDgDgDgDgDDo..',
  '..oooooooooooo..',
  '.HHHHHHHHHHHHHH.',
  '................',
];
const CHEST_FRONT = [
  'DDDDDDDDDDDDDDDD',
  'DIHHHHHHHHHHHHID',
  'Dh............dD',
  'Dh............dD',
  'Dh............dD',
  'DddddddWWddddddD',
  'DDDDDDWSSWDDDDDD',
  'DHHHHHWllWHHHHHD',
  'Dh....WWWW....dD',
  'Dh............dD',
  'Dh............dD',
  'Dh............dD',
  'Dh............dD',
  'Dh............dD',
  'DIddddddddddddID',
  'DDDDDDDDDDDDDDDD',
];
const CHEST_SIDE = [
  'DDDDDDDDDDDDDDDD',
  'DIHHHHHHHHHHHHID',
  'Dh............dD',
  'Dh............dD',
  'Dh............dD',
  'DddddddddddddddD',
  'DDDDDDDDDDDDDDDD',
  'DHHHHHHHHHHHHHHD',
  'Dh............dD',
  'Dh............dD',
  'Dh............dD',
  'Dh............dD',
  'Dh............dD',
  'Dh............dD',
  'DIddddddddddddID',
  'DDDDDDDDDDDDDDDD',
];
const CHEST_TOP = [
  'DDDDDDDDDDDDDDDD',
  'DIHHHHHHHHHHHHID',
  'Dh............dD',
  'Dh............dD',
  'Dh............dD',
  'Dh............dD',
  'Dh............dD',
  'Dh............dD',
  'Dh............dD',
  'Dh............dD',
  'Dh............dD',
  'Dh............dD',
  'Dh............dD',
  'DhWWWW....WWWWdD',
  'DIddddddddddddID',
  'DDDDDDDDDDDDDDDD',
];
/** Explosive crate side: a bundle of paper-wrapped sticks under a hazard band. */
const TNT_SIDE = [
  'kkkkkkkkkkkkkkkk',
  'HMmdHMmdHMmdHMmd',
  'HMmdHMmdHMmdHMmd',
  'HMmdHMmdHMmdHMmd',
  'HMmdHMmdHMmdHMmd',
  'kkkkkkkkkkkkkkkk',
  'WWWWWWWWWWWWWWWW',
  'WbbWWbbWWbbWWbbW',
  'bbWWbbWWbbWWbbWW',
  'wwwwwwwwwwwwwwww',
  'kkkkkkkkkkkkkkkk',
  'HMmdHMmdHMmdHMmd',
  'HMmdHMmdHMmdHMmd',
  'HMmdHMmdHMmdHMmd',
  'HMmdHMmdHMmdHMmd',
  'kkkkkkkkkkkkkkkk',
];
const DOOR_LOWER = [
  'D..............D',
  'D.dddddddddddd.D',
  'D.dHHHHHHHHHHd.D',
  'D.dH........hd.D',
  'D.dH........hd.D',
  'D.dH........hd.D',
  'D.dhhhhhhhhhhd.D',
  'D.dddddddddddd.D',
  'D..........kK..D',
  'D..........kk..D',
  'D.dddddddddddd.D',
  'D.dHHHHHHHHHHd.D',
  'D.dH........hd.D',
  'D.dhhhhhhhhhhd.D',
  'D.dddddddddddd.D',
  'DDDDDDDDDDDDDDDD',
];
const DOOR_UPPER = [
  'DDDDDDDDDDDDDDDD',
  'D.dddddddddddd.D',
  'D.dGGGGdGGGGGd.D',
  'D.dGggGdGggGGd.D',
  'D.dGgGGdGgGGGd.D',
  'D.dGGGGdGGGGGd.D',
  'D.dddddddddddd.D',
  'D.dGGGGdGGGGGd.D',
  'D.dGgGGdGgGGGd.D',
  'D.dGGGGdGGGGGd.D',
  'D.dddddddddddd.D',
  'D..............D',
  'D.dddddddddddd.D',
  'D.dHHHHHHHHHHd.D',
  'D.dhhhhhhhhhhd.D',
  'D..............D',
];

const SPECIAL: Record<string, (P: RGBA[]) => Paint> = {
  // Party Games arenas.
  pumpkin_face: (P) => {
    const body = ribbedPal(P, darker(P[0], .7));
    const glow = [hex(0x8a3008), hex(0xd8701a), hex(0xffb030), hex(0xffe27a)];
    const face = [
      '................',
      '................',
      '................',
      '..oooo....oooo..',
      '..o23o....o32o..',
      '..o33o....o33o..',
      '...oo......oo...',
      '.......oo.......',
      '.......oo.......',
      '..o..........o..',
      '..o3oooooooo3o..',
      '..o23323323332o.',
      '...o32oo3oo23o..',
      '....oo..o..oo...',
      '................',
      '................',
    ];
    const ink: Record<string, RGBA> = { o: hex(0x4a1a06), '1': glow[1], '2': glow[2], '3': glow[3] };
    return (c, seed) => {
      body(c, seed);
      face.forEach((row, y) => { for (let x = 0; x < N; x++) if (ink[row[x]]) c.set(x, y, ink[row[x]]); });
    };
  },
  pot: (P) => {
    const E = enrich(P);
    return (c, seed) => c.fill((x, y) => {
      let t = .55 + (tnoise(seed, x, y, 8) - .5) * .2 - Math.abs(x - 7.5) * .02;
      if (y === 2 || y === 13) return E[0];
      if (y === 3 || y === 12) t += .25;
      // A painted meander band round the belly.
      if (y >= 6 && y <= 9) {
        const u = x & 7, v = y - 6;
        const key = (v === 0 || v === 3) ? true : (u === 0 || (v === 1 && u < 5) || (v === 2 && u === 4));
        return key ? E[0] : E[E.length - 1];
      }
      return grainPick(E, t, x, y, seed, .3);
    });
  },
  glazed: (P) => (c) => c.fill((x, y) => {
    // Pinwheel tile: four curls, a glazed rim and a bright centre boss.
    const u = x < 8 ? x : 15 - x, v = y < 8 ? y : 15 - y;
    const q = (x < 8) === (y < 8);
    const a = q ? u : v, b = q ? v : u;
    if (a === 0 || b === 0) return P[0];
    if (a === 1 || b === 1) return P[1];
    if (a >= 6 && b >= 6) return P[3];
    if ((a + b) % 5 === 0) return P[3];
    if (a > b) return P[2];
    return mix(P[1], P[2], .5);
  }),
  mushroom: (P) => {
    const E = enrich(P.slice(0, 4));
    return (c, seed) => {
      c.fill((x, y) => grainPick(E, .5 + (tnoise(seed, x, y, 8) - .5) * .35, x, y, seed, .4));
      // Round pale spots with a shaded underside.
      const spots: [number, number, number][] = [[3, 3, 1.6], [11, 5, 2.1], [6, 11, 1.8], [13, 13, 1.3], [1, 9, 1.1]];
      for (const [sx, sy, r] of spots) for (let y = -3; y <= 3; y++) for (let x = -3; x <= 3; x++) {
        const d = Math.hypot(x, y);
        if (d > r) continue;
        c.set((sx + x) & 15, (sy + y) & 15, y > r * .45 ? mix(P[4], P[2], .45) : P[4]);
      }
    };
  },
  chiseled: (P) => {
    const E = enrich(P);
    return (c, seed) => c.fill((x, y) => {
      // A carved medallion: raised frame, sunken field, raised ring and boss.
      const r = Math.min(x, y, 15 - x, 15 - y);
      const d = Math.hypot(x - 7.5, y - 7.5);
      let t = .5 + (h(seed, x, y) - .5) * .1;
      const lit = x + y < 15;
      if (r === 0) t = lit ? .75 : .1;
      else if (r === 1) t = lit ? .9 : .3;
      else if (r === 2) t = lit ? .15 : .7;
      else if (Math.abs(d - 4.2) < .7) t = lit ? .88 : .25;
      else if (d < 1.8) t = lit ? .95 : .55;
      else t = .42;
      return grainPick(E, t, x, y, seed, .25);
    });
  },
  mossy_cobble: (P) => {
    const MOSS = enrich(pal([0x34501f, 0x426428, 0x527a31, 0x64903c, 0x78a448]));
    return (c, seed) => {
      COBBLE(c, seed);
      const stone = capture(COBBLE, seed);
      c.fill((x, y) => {
        // Moss sits on the tops of stones and fills the joints under them.
        const m = tnoise(seed ^ 9, x, y, 4) + (y < 8 ? .08 : 0);
        if (m > .58) return grainPick(MOSS, (m - .58) * 2.6 + (h(seed ^ 4, x, y) - .5) * .4, x, y, seed, .4);
        return stone[y * N + x];
      });
      void P;
    };
  },
  gravel: (P) => pebbles(P, 5),
  coarse_dirt: (P) => granular(P, { clump: .6, pebbles: .14, crumbs: .1, accent: [hex(0x8a8480), hex(0x9e9894), hex(0x6e6864)], accentRate: .07 }),
  magma: (P) => {
    // Dark crust plates split by glowing seams; the seams brighten where they meet.
    const crust = enrich(P.slice(0, 3)), hot = P.slice(2);
    return (c, seed) => {
      const vor = voronoi(seed ^ 0x6d, 3, .9);
      c.fill((x, y) => {
        const v = vor(x, y);
        if (v.f2 < .55) return hot[v.f2 < .25 ? 2 : 1];
        if (v.f2 < 1.05) return mix(crust[1], hot[0], .55); // crust glowing at the seam
        return grainPick(crust, .25 + (tfbm(seed, x, y) - .5) * .6, x, y, seed, .5);
      });
    };
  },
  craft_top: (P) => (c, seed) => { planks(P)(c, seed); stamp(c, CRAFT_TOP, craftInk(P)); },
  craft_side: (P) => (c, seed) => { planks(P)(c, seed); stamp(c, CRAFT_SIDE, craftInk(P)); },
  craft_front: (P) => (c, seed) => { planks(P)(c, seed); stamp(c, CRAFT_FRONT, craftInk(P)); },
  furnace_side: (P) => furnaceBody(P),
  furnace_front: (P) => furnaceFront(P, false),
  furnace_lit: (P) => furnaceFront(P, true),
  smoker: (P) => {
    const front = furnaceFront(P, false);
    const band = enrich(pal([0x3a2414, 0x4e3220, 0x64422a, 0x7a5434]));
    return (c, seed) => {
      front(c, seed);
      // Charred timber bands across the top and foot.
      for (let x = 0; x < N; x++) for (const y of [0, 15]) c.set(x, y, grainPick(band, .5 + (h(seed, x, y) - .5), x, y, seed, .4));
    };
  },
  chest_side: (P) => chestFace(P, CHEST_SIDE),
  chest_front: (P) => chestFace(P, CHEST_FRONT),
  chest_top: (P) => chestFace(P, CHEST_TOP),
  bookshelf: (P) => {
    const E = enrich(P);
    const colours = [0x9c2f26, 0x2f56a0, 0x3a8238, 0xc49a2e, 0x713a98, 0x2a8686, 0xaa5820, 0x5f6066, 0x8a2e5a, 0xd8cfb8];
    return (c, seed) => c.fill((x, y) => {
      // Two shelves; each is a lit board above a row of books in the shadow.
      if (y === 0 || y === 8) return E[E.length - 1];
      if (y === 7 || y === 15) return E[0];
      if (x === 0) return E[2];
      if (x === 15) return E[1];
      const row = y < 8 ? 0 : 1, base = row ? 14 : 6;
      // Books are 1-2px wide with varied heights, some leaning gaps.
      const slot = Math.floor((x - 1) / 2), u = (x - 1) & 1;
      const hgt = 4 + Math.floor(rnd(seed, slot, row) * 3);
      if (rnd(seed ^ 7, slot, row) > .86) return y > base - 1 ? E[1] : darker(E[0], .7);
      if (base - y >= hgt) return darker(E[0], .7);
      const col = hex(colours[Math.floor(rnd(seed ^ 5, slot, row) * colours.length)]);
      if (base - y === hgt - 1) return mix(col, hex(0xffffff), .25); // top edge
      if (y === base - 1 || y === base - 3) return mix(col, hex(0xe8c860), .55); // gilt bands
      return u === 0 ? col : darker(col, .78);
    });
  },
  barrel_side: (P) => {
    const E = enrich(P), I = enrich(pal([0x2e3136, 0x45494f, 0x60656c, 0x80868d]));
    return (c, seed) => c.fill((x, y) => {
      if (y === 2 || y === 12) return I[3];
      if (y === 3 || y === 13) return I[1];
      if (y === 4 || y === 14) return I[0];
      const u = x & 3;
      let t = .55 + (rnd(seed, x >> 2, 0) - .5) * .3 + (tnoise(seed, x * 3, y, 4) - .5) * .2;
      t += u === 0 ? -.4 : u === 1 ? .15 : 0;
      t -= Math.abs(y - 7.5) * .02; // staves swell in the middle
      return grainPick(E, t, x, y, seed, .3);
    });
  },
  barrel_top: (P) => {
    const E = enrich(P), I = enrich(pal([0x2e3136, 0x45494f, 0x60656c, 0x80868d]));
    return (c, seed) => c.fill((x, y) => {
      const r = Math.min(x, y, 15 - x, 15 - y);
      if (r === 0) return I[x === 0 || y === 0 ? 2 : 0];
      if (r === 1) return grainPick(E, .3 + (h(seed, x, y) - .5) * .4, x, y, seed, .4);
      if (r === 2) return I[x === 2 || y === 2 ? 1 : 3];
      // Lid boards with a bung hole.
      if ((x === 10 || x === 11) && (y === 10 || y === 11)) return x === 10 && y === 10 ? E[0] : darker(E[0], .6);
      let t = .55 + (rnd(seed, y >> 2, 3) - .5) * .25 + (tnoise(seed, x, y * 3, 4) - .5) * .2;
      if ((y & 3) === 3) t = .1;
      return grainPick(E, t, x, y, seed, .3);
    });
  },
  loom: (P) => {
    const W = [hex(0xd8d0c0), hex(0xf0ebe2)], R = [hex(0x9a2828), hex(0xc23838)];
    return (c, seed) => {
      planks(P)(c, seed);
      // A stretched weaving on its frame: warp threads and a red chevron weft.
      for (let y = 3; y <= 12; y++) for (let x = 3; x <= 12; x++) {
        const chev = (Math.abs(x - 7.5) + y) % 4 < 2;
        c.set(x, y, chev ? R[x & 1] : W[x & 1]);
      }
      const F = darker(P[0], .7);
      for (let i = 2; i <= 13; i++) { c.set(i, 2, F); c.set(i, 13, F); c.set(2, i, F); c.set(13, i, F); }
    };
  },
  tnt_side: (P) => (c) => stampOnly(c, TNT_SIDE, tntInk(P)),
  tnt_top: (P) => tntEnds(P, true),
  tnt_bottom: (P) => tntEnds(P, false),
  ladder: (P) => {
    const E = enrich(P);
    return (c, seed) => c.fill((x, y) => {
      // Two rails with rungs every four rows, each rung lit on top.
      if (x === 2 || x === 13) return E[3];
      if (x === 3 || x === 14) return E[1];
      if (x > 3 && x < 13) {
        const v = y & 3;
        if (v === 1) return grainPick(E, .85, x, y, seed, .4);
        if (v === 2) return E[1];
      }
      return CLEAR;
    });
  },
  scaffolding: (P) => {
    const E = enrich(P);
    return (c) => c.fill((x, y) => {
      const r = Math.min(x, y, 15 - x, 15 - y);
      if (r === 0) return E[x === 0 || y === 0 ? 3 : 1];
      if (r === 1) return E[2];
      if (Math.abs(x - y) <= .5) return E[2];
      if (Math.abs(x - y) === 1 && x > y) return E[0];
      return CLEAR;
    });
  },
  cobweb: (P) => (c) => c.fill((x, y) => {
    const dx = x - 7.5, dy = y - 7.5, d = Math.hypot(dx, dy);
    const spoke = Math.abs(dx) < .6 || Math.abs(dy) < .6 || Math.abs(Math.abs(dx) - Math.abs(dy)) < .6;
    // Sagging rings between the spokes.
    const sag = d + Math.abs(Math.sin(Math.atan2(dy, dx) * 4)) * .8;
    const ringOn = Math.abs(sag % 3.2 - 1.6) < .45;
    if (spoke && d < 8) return P[d < 3 ? 1 : 0];
    return ringOn && d < 7.6 ? P[1] : CLEAR;
  }),
  slime: () => {
    const outer = enrich(pal([0x3f8a2e, 0x5aa844, 0x76c45c, 0x9ade80]));
    return (c) => c.fill((x, y) => {
      const r = Math.min(x, y, 15 - x, 15 - y);
      const lit = x + y < 15;
      if (r === 0) return outer[lit ? 2 : 0];
      // The inner cube floating in the jelly.
      if (r >= 3 && r <= 3.5) return hex(lit ? 0x8ad06e : 0x3a7a2a, 240);
      if (r > 3) return hex(0x5aa844, 235);
      if ((x === 2 && y < 6) || (y === 2 && x < 6)) return hex(0xd8ffc8, 230);
      return [...outer[1].slice(0, 3), 175] as RGBA;
    });
  },
  honey: (P) => {
    const E = enrich(P);
    return (c, seed) => c.fill((x, y) => {
      const r = Math.min(x, y, 15 - x, 15 - y);
      if (r === 0) return E[x === 0 || y === 0 ? 3 : 0];
      if (r === 1) return E[1];
      // Glossy body with a bright smear and darker drips.
      const n = tnoise(seed, x, y, 4);
      if ((x + y === 7 || x + y === 8) && x > 2 && x < 7) return hex(0xffe9a0);
      return grainPick(E, .45 + (n - .5) * .5 + (y - 7.5) * -.015, x, y, seed, .35);
    });
  },
  hay_side: (P) => {
    const E = enrich(P), TW = [hex(0x6a2a18), hex(0x8e3c22), hex(0xa85030)];
    return (c, seed) => c.fill((x, y) => {
      if (y === 3 || y === 12) return TW[(x & 1) + 1];
      if (y === 4 || y === 13) return TW[0];
      // Straw: long vertical strands of varied tone, a few broken ends.
      const strand = rnd(seed, x, (y + (x * 7)) >> 3);
      let t = .25 + strand * .6;
      if ((x & 1) === 1) t -= .12;
      if (rnd(seed ^ 3, x, y) > .93) t += .25;
      return grainPick(E, t, x, y, seed, .3);
    });
  },
  hay_top: (P) => {
    const E = enrich(P);
    return (c, seed) => c.fill((x, y) => {
      // Cut ends of the bale: a dense field of straw tips with dark gaps.
      const r = Math.min(x, y, 15 - x, 15 - y);
      if (r === 0) return E[1];
      const tip = rnd(seed, x, y);
      if (tip > .82) return E[E.length - 1];
      if (tip < .14) return darker(E[0], .8);
      return grainPick(E, .3 + tnoise(seed, x, y, 4) * .5, x, y, seed, .5);
    });
  },
  packed_ice: (P) => {
    const E = enrich(P);
    return (c, seed) => {
      const vor = voronoi(seed ^ 0x1c, 3, .9);
      c.fill((x, y) => {
        const v = vor(x, y);
        if (v.f2 < .6) return E[E.length - 1];
        const up = vor(x - 1, y - 1).id !== v.id;
        let t = .3 + h(seed, v.id, 2) * .35 + (tnoise(seed, x, y, 4) - .5) * .2;
        if (up) t += .3;
        if ((x + y + v.id) % 7 === 0 && v.f2 > 2) t += .2; // internal sheen
        return grainPick(E, t, x, y, seed, .4);
      });
    };
  },
  lava: (P) => {
    const E = P;
    return (c, seed) => {
      const vor = voronoi(seed ^ 0x1a, 4, .9);
      c.fill((x, y) => {
        // Molten body with darker cooling skins and white-hot seams.
        const v = vor(x, y);
        if (v.f2 < .8) return E[4];
        let t = .45 + (tfbm(seed, x, y) - .5) * .9;
        if (h(seed, v.id, 4) > .65) t -= .3 * Math.min(1, v.f2 / 2.5);
        if (v.f2 < 1.6) t += .2;
        return grainPick(E, t, x, y, seed, .5);
      });
    };
  },
  fire: (P) => (c, seed) => c.fill((x, y) => {
    // Tongues of flame: each column has its own height, tapering to licks.
    const h0 = 7 + tnoise(seed, x, 0, 4) * 8 + (rnd(seed, x, 1) - .5) * 2;
    const v = (15 - y) / h0;
    if (v > 1 || (v > .75 && rnd(seed, x, y) > .55)) return CLEAR;
    return pick(P, 1 - v * 1.05 + (rnd(seed ^ 3, x, y) - .5) * .25, x, y, .5);
  }),
  anvil_top: (P) => {
    const E = enrich(P);
    return (c, seed) => c.fill((x, y) => {
      // The worn face: polished in the middle, darker toward the edges.
      const d = Math.abs(y - 7.5);
      if (y <= 1 || y >= 14) return E[y <= 1 ? 3 : 0];
      let t = .75 - d * .05 + (tnoise(seed, x * 2, y, 4) - .5) * .25;
      if (rnd(seed, x, y) > .95) t -= .3; // dents
      return grainPick(E, t, x, y, seed, .35);
    });
  },
  iron_bars: (P) => {
    const E = enrich(P);
    return (c) => c.fill((x, y) => {
      const u = x & 3;
      if (y === 1 || y === 14) return u === 0 ? E[0] : E[1];
      if (y === 2 || y === 15) return CLEAR;
      if (u === 1) return E[2];
      if (u === 2) return E[1];
      return CLEAR;
    });
  },
  iron_trapdoor: (P) => {
    const E = enrich(P);
    return (c, seed) => c.fill((x, y) => {
      const r = Math.min(x, y, 15 - x, 15 - y);
      if (r === 0) return E[0];
      if (r === 1) return E[x === 1 || y === 1 ? E.length - 1 : 1];
      // Riveted plate.
      if ((x === 3 || x === 12) && (y === 3 || y === 12)) return E[E.length - 1];
      // A pressed cross-brace between the rivets.
      if ((y === 7 || y === 8) && x > 2 && x < 13) return y === 7 ? E[E.length - 1] : E[1];
      return grainPick(E, .55 + (h(seed, 0, y) - .5) * .15, x, y, seed, .3);
    });
  },
  oak_trapdoor: (P) => {
    const E = enrich(P);
    return (c, seed) => c.fill((x, y) => {
      const r = Math.min(x, y, 15 - x, 15 - y);
      if (r === 0) return E[0];
      if (r === 1) return E[x === 1 || y === 1 ? E.length - 1 : 1];
      // Two hatches either side of a cross-brace.
      if (y === 7 || y === 8) return E[y === 7 ? 4 : 1];
      if ((x === 4 || x === 11) && (y >= 3 && y <= 12)) return E[0];
      if (x >= 5 && x <= 10 && ((y >= 3 && y <= 5) || (y >= 10 && y <= 12))) return CLEAR;
      return grainPick(E, .55 + (rnd(seed, x >> 2, 0) - .5) * .3 + (tnoise(seed, x, y * 3, 4) - .5) * .2, x, y, seed, .35);
    });
  },
  door_lower: (P) => doorFace(P, DOOR_LOWER),
  door_upper: (P) => doorFace(P, DOOR_UPPER),
  lantern: (P) => (c) => c.fill((x, y) => {
    // Cage, glowing core, top cap with handle loop.
    if (y <= 1) return (x === 7 || x === 8) ? P[1] : CLEAR;
    if (x < 4 || x > 11 || y > 15) return CLEAR;
    if (y <= 3) return x === 4 || x === 11 ? CLEAR : P[y === 2 ? 1 : 0];
    if (y >= 14) return P[y === 14 ? 1 : 0];
    if (x === 4 || x === 11) return P[x === 4 ? 1 : 0];
    if (x === 7 && y > 4 && y < 13) return P[0];
    const d = Math.hypot(x - 7.5, y - 9);
    return d < 2.2 ? P[3] : P[2];
  }),
  torch: (P) => (c) => c.fill((x, y) => {
    if (x < 6 || x > 9) return CLEAR;
    // A wrapped head with a flame, on a two-tone stick.
    if (y <= 1) return x === 7 || x === 8 ? P[3] : CLEAR;
    if (y <= 3) return x === 6 || x === 9 ? (y === 3 ? P[2] : CLEAR) : P[y === 2 ? 3 : 2];
    if (y <= 5) return x === 6 || x === 9 ? CLEAR : hex(y === 4 ? 0x5a3a20 : 0x3a2414);
    if (x < 7 || x > 8) return CLEAR;
    return P[x === 7 ? 1 : 0];
  }),
  sea_lantern: (P) => {
    const E = enrich(P);
    return (c, seed) => c.fill((x, y) => {
      const r = Math.min(x, y, 15 - x, 15 - y);
      if (r === 0) return E[0];
      // Four glowing panes split by a pale cross, brightest at the centre.
      if (x === 7 || x === 8 || y === 7 || y === 8) return E[1];
      const d = Math.hypot(x - 7.5, y - 7.5);
      return grainPick(E, 1.05 - d / 9 + (tnoise(seed, x, y, 4) - .5) * .2, x, y, seed, .4);
    });
  },
  lamp: (P) => {
    return (c, seed) => c.fill((x, y) => {
      const r = Math.min(x, y, 15 - x, 15 - y);
      if (r === 0) return P[0];
      if (r === 1) return P[1];
      // Leaded glass: four panes of warm light around a dark cross.
      if (x === 7 || x === 8 || y === 7 || y === 8) return P[1];
      const d = Math.hypot(x - 7.5, y - 7.5);
      return pick(P.slice(2), 1.1 - d / 8 + (tnoise(seed, x, y, 4) - .5) * .3, x, y, .5);
    });
  },
  cake_top: (P) => (c, seed) => c.fill((x, y) => {
    // Frosting with sprinkles and a cherry dot pattern.
    const r = Math.min(x, y, 15 - x, 15 - y);
    if (r === 0) return P[0];
    const s = rnd(seed, x, y);
    if (s > .93) return [hex(0xe84a8a), hex(0x4ac0e8), hex(0xf0d040), P[3]][Math.floor(rnd(seed ^ 1, x, y) * 4)];
    return P[(x + y) % 5 === 0 ? 1 : 2];
  }),
  cake_side: (P) => (c, seed) => c.fill((x, y) => {
    if (y <= 2) return P[3];
    if (y === 3) return (x * 3 + 1) % 5 < 2 ? P[3] : P[2];   // drips of frosting
    if (y === 4) return (x * 3 + 1) % 5 === 0 ? P[3] : P[1];
    if (y === 9) return hex(0xc23048);                      // jam layer
    return rnd(seed, x, y) > .9 ? P[1] : P[y % 3 === 0 ? 1 : 0];
  }),
  target: (P) => (c) => c.fill((x, y) => {
    const d = Math.hypot(x - 7.5, y - 7.5);
    if (d < 1.6) return P[0];
    if (d > 3 && d < 4.7) return P[0];
    if (d > 6.2) return mix(P[2], hex(0x6a8a3a), .25);
    return P[1];
  }),
  glowstone: (P) => {
    const E = P;
    return (c, seed) => {
      const vor = voronoi(seed ^ 0x9e, 4, .9);
      c.fill((x, y) => {
        // Crystalline lumps glowing from within, dark seams between them.
        const v = vor(x, y);
        if (v.f2 < .7) return darker(E[0], .75);
        const t = 1 - v.f1 / 4 + (h(seed, v.id, 1) - .5) * .4 + (h(seed, x, y) - .5) * .25;
        return pick(E, t, x, y, .4);
      });
    };
  },
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
    case 'noise': return granular(pal(style.pal), { clump: .5 * (style.grain ?? 1) });
    case 'smooth': return polished(pal(style.pal));
    case 'planks': return planks(pal(style.pal));
    case 'bricks': return bricks(pal(style.pal), hex(style.mortar), { w: style.w, h: style.h });
    case 'tiles': return bricks(pal(style.pal), hex(style.mortar), { w: style.size, h: style.size, texture: .15 });
    case 'wool': return knit(pal(style.pal));
    case 'glass': return glassPane(hex(style.frame), hex(style.tint), style.alpha);
    case 'bark': return barkSide(pal(style.pal), 4);
    case 'banded': return ribbed(style.pal, style.mark);
    case 'ribbed': return ribbed(style.pal, style.mark);
    case 'logtop': return logTop(pal(style.bark), pal(style.wood));
    case 'leaves': return leaves(enrich(pal(style.pal), .6));
    case 'ore': return ore(OVERWORLD_STONE, pal(style.ore), enrich(pal(STONE_PAL))[0]);
    case 'metal': return metalBlock(pal(style.pal));
    case 'gem': return gemBlock(pal(style.pal));
    case 'framed': return framed(style.pal, style.frame);
    case 'rock': return rock(pal(style.pal), {
      cells: style.cells, crack: style.crack, relief: style.relief, facet: style.facet,
      fleck: style.fleck ? enrich(pal(style.fleck), .4) : undefined, fleckRate: style.fleckRate,
    });
    case 'soil': return granular(pal(style.pal), {
      clump: style.clump, pebbles: style.pebbles, crumbs: style.crumbs, ripple: style.ripple,
      accent: style.accent ? pal(style.accent) : undefined, accentRate: style.accentRate,
    });
    case 'clay': return clay(pal(style.pal));
    case 'concrete': return concrete(pal(style.pal));
    case 'obsidian': return obsidian(pal(style.pal), pal(style.glint));
    case 'special': return (SPECIAL[style.name] ?? polished)(pal(style.pal));
    case 'sprite': return sprite(style.shape, style.pal);
  }
}

/** Every vanilla cell's painter, keyed by atlas cell. */
export const VANILLA_ART: Record<number, Paint> = {};
for (const [id, style] of Object.entries(VANILLA_TILE_STYLES)) VANILLA_ART[Number(id)] = painter(style);
