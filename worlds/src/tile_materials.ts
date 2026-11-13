// Material painters shared by every tile family (Worlds terrain, the manor,
// the vanilla blocks). Each one treats its material as a small height map lit
// from the top-left (see tile_kit.ts) and quantises the lit value onto a
// hue-shifted ramp, so stone has facets, soil has pebbles that cast shadows,
// wool has stitches and metal has a sheen, rather than flat dithered noise.

import {
  CLEAR, Field, enrich, grainPick, h, hex, mix, tfbm, tnoise, voronoi, type RGBA,
} from './tile_kit';

const N = 16;
interface Canvas16 {
  set(x: number, y: number, c: RGBA): void;
  fill(fn: (x: number, y: number) => RGBA): void;
}
export type Paint = (p: Canvas16, seed: number) => void;
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const ring = (x: number, y: number) => Math.min(x, y, 15 - x, 15 - y);

// ── Natural stone ───────────────────────────────────────────────────────────

export interface RockOpts {
  /** Voronoi sites per side: more = smaller facets. */
  cells?: number;
  /** How deep the cracks between facets are cut (0 = no cracks). */
  crack?: number;
  /** Relief lighting strength. */
  relief?: number;
  /** Per-facet tone variation. */
  facet?: number;
  /** Optional fleck colours (diorite's black specks, granite's pink) and rate. */
  fleck?: RGBA[];
  fleckRate?: number;
  /** Overall brightness bias, -.3..+.3. */
  bias?: number;
  /** Per-pixel dither grain in palette steps. */
  grain?: number;
}
/** Faceted natural rock: soft-edged chips lit from the top-left, hairline
 *  cracks between some of them, and a fine mineral grain. */
export function rock(pal: RGBA[], o: RockOpts = {}): Paint {
  const P = enrich(pal);
  const cells = o.cells ?? 5, crack = o.crack ?? .5, relief = o.relief ?? 1, facet = o.facet ?? .3;
  return (p, seed) => {
    const vor = voronoi(seed ^ 0x51, cells);
    const H = new Field((x, y) => {
      const c = vor(x, y);
      let v = .5 + (h(seed, c.id, 7) - .5) * facet + (tfbm(seed ^ 3, x, y) - .5) * .4;
      // Each chip domes very slightly towards its centre.
      v += (1 - Math.min(1, c.f1 / 5)) * .12;
      if (c.f2 < 1 && h(seed ^ 9, c.id, 3) < .7) v -= (1 - c.f2) * crack;
      return v;
    });
    p.fill((x, y) => {
      if (o.fleck && h(seed ^ 0x77, x, y) > 1 - (o.fleckRate ?? .05)) {
        return o.fleck[Math.floor(h(seed ^ 0x78, x, y) * o.fleck.length)];
      }
      const t = H.lit(x, y, 1.3 * relief) + (o.bias ?? 0);
      return grainPick(P, t, x, y, seed, o.grain ?? .5);
    });
  };
}

// ── Soil, sand, snow ────────────────────────────────────────────────────────

export interface GrainOpts {
  /** Large soft clumps (0..1). */
  clump?: number;
  /** Rate of single-pixel pebbles that catch the light and cast a shadow. */
  pebbles?: number;
  /** Rate of darker crumbs. */
  crumbs?: number;
  /** Fine per-pixel grain in palette steps. */
  grain?: number;
  /** Relief strength. */
  relief?: number;
  /** Optional accent pixels (roots, shells, glints) and their rate. */
  accent?: RGBA[];
  accentRate?: number;
  bias?: number;
  /** Diagonal wind ripples (sand). */
  ripple?: number;
}
export function granular(pal: RGBA[], o: GrainOpts = {}): Paint {
  const P = enrich(pal, .8);
  const clump = o.clump ?? .5, peb = o.pebbles ?? .06, crumbs = o.crumbs ?? .05, relief = o.relief ?? 1;
  return (p, seed) => {
    const H = new Field((x, y) => {
      let v = .5 + (tfbm(seed, x, y) - .5) * clump * 1.4;
      if (o.ripple) v += Math.sin((y * 1.6 + x * .45 + tnoise(seed ^ 6, x, y, 8) * 4) * 1.05) * o.ripple;
      const r = h(seed ^ 0x21, x, y);
      if (r > 1 - peb) v += .32;
      else if (r < crumbs) v -= .26;
      return v;
    });
    p.fill((x, y) => {
      if (o.accent && h(seed ^ 0x99, x, y) > 1 - (o.accentRate ?? .03)) {
        return o.accent[Math.floor(h(seed ^ 0x98, x, y) * o.accent.length)];
      }
      const t = H.lit(x, y, 1.1 * relief) + (o.bias ?? 0);
      return grainPick(P, t, x, y, seed, o.grain ?? .6);
    });
  };
}

/** Loose pebbles (gravel): small stones of mixed tone packed tight, each
 *  lit on its top-left rim and shadowed on its lower-right, dark grit between. */
export function pebbles(pal: RGBA[], cells = 5): Paint {
  const P = enrich(pal, .8);
  return (p, seed) => {
    const vor = voronoi(seed ^ 0x47, cells, .95);
    p.fill((x, y) => {
      const c = vor(x, y);
      if (c.f2 < .55) return P[0];
      const up = vor(x, y - 1).id !== c.id, left = vor(x - 1, y).id !== c.id;
      const down = vor(x, y + 1).id !== c.id, right = vor(x + 1, y).id !== c.id;
      let t = .3 + h(seed, c.id, 5) * .45 + (h(seed ^ 1, x, y) - .5) * .12;
      if (up || left) t += .25;
      if (down || right) t -= .22;
      return grainPick(P, t, x, y, seed, .3);
    });
  };
}

// ── Manufactured surfaces ───────────────────────────────────────────────────

/** Fired clay: a matte, nearly even body with soft kiln mottling and a few
 *  mineral specks. */
export function clay(pal: RGBA[]): Paint {
  const P = enrich(pal, .5);
  return (p, seed) => p.fill((x, y) => {
    let t = .52 + (tfbm(seed ^ 2, x, y) - .5) * .3 + (tnoise(seed ^ 5, x, y, 2) - .5) * .08;
    const r = h(seed ^ 4, x, y);
    if (r > .97) t += .2; else if (r < .03) t -= .2;
    return grainPick(P, t, x, y, seed, .4);
  });
}

/** Concrete: an even powder-cast slab with the faintest mottling. */
export function concrete(pal: RGBA[]): Paint {
  const P = enrich(pal, .5);
  return (p, seed) => p.fill((x, y) => {
    let t = .5 + (tnoise(seed, x, y, 8) - .5) * .14 + (tnoise(seed ^ 1, x, y, 2) - .5) * .1;
    if (h(seed ^ 7, x, y) > .97) t -= .14; // an air pocket
    return grainPick(P, t, x, y, seed, .45);
  });
}

/** Polished slab: a crisp bevelled rim around a cloudy, faintly veined face. */
export function polished(pal: RGBA[]): Paint {
  const P = enrich(pal, .8);
  return (p, seed) => p.fill((x, y) => {
    const r = ring(x, y);
    if (r === 0) return P[x === 0 || y === 0 ? P.length - 1 : 0];
    let t = .52 + (tfbm(seed, x, y) - .5) * .32 - (x + y - 15) * .008;
    if (r === 1) t += x === 1 || y === 1 ? .14 : x === 14 || y === 14 ? -.16 : 0;
    // A soft vein where the cloud noise crosses its midline.
    if (Math.abs(tnoise(seed ^ 0x3c, x, y, 8) - .5) < .03) t -= .14;
    return grainPick(P, t, x, y, seed, .45);
  });
}

/** Knitted wool: rows of V stitches, each strand lit on top, the gaps
 *  between stitches in shadow, with a little felted fuzz. */
export function knit(pal: RGBA[]): Paint {
  const P = enrich(pal, .6);
  return (p, seed) => p.fill((x, y) => {
    const u = x & 3, v = y & 3;
    // A stitch is a "V": two strands that meet at the bottom of the cell.
    const arm = v >> 1;
    let t: number;
    if (u === arm) t = (v & 1) === 0 ? .66 : .58;          // left strand, lit
    else if (u === 3 - arm) t = (v & 1) === 0 ? .54 : .48; // right strand
    else t = .36;                                          // gap
    t += (tnoise(seed, x, y, 4) - .5) * .22 + (h(seed ^ 3, x >> 2, y >> 2) - .5) * .06;
    const f = h(seed ^ 9, x, y);
    if (f > .94) t += .16; else if (f < .04) t -= .12;
    return grainPick(P, t, x, y, seed, .3);
  });
}

/** A glass pane: lit frame, a couple of glints, a gently tinted body. */
export function glassPane(frame: RGBA, tint: RGBA, bodyAlpha: number): Paint {
  const hi = mix(frame, hex(0xffffff), .55), lo = mix(frame, hex(0x000000), .25);
  // Cutout faces discard alpha < .5, so glints must stay above that.
  const glint = hex(0xffffff, Math.min(255, Math.max(225, bodyAlpha + 90)));
  return (p) => p.fill((x, y) => {
    const r = ring(x, y);
    if (r === 0) {
      if ((x === 0 && y < 4) || (y === 0 && x < 4)) return hi;
      return x === 15 || y === 15 ? lo : frame;
    }
    // Two diagonal glints in the upper-left, one short one lower-right.
    const d = x + y;
    if ((d === 6 || d === 7) && x >= 2 && x <= 5) return glint;
    if (d === 9 && x >= 2 && x <= 3) return glint;
    if (d === 21 && x >= 10 && x <= 12) return mix(glint, tint, .4);
    const a = bodyAlpha + (r === 1 ? 25 : 0);
    return [tint[0], tint[1], tint[2], Math.min(255, a)];
  });
}

// ── Ores ────────────────────────────────────────────────────────────────────

/** Blob shapes for ore nuggets (pixel offsets). */
const NUGGETS: [number, number][][] = [
  [[0, 0], [1, 0], [0, 1], [1, 1], [2, 1]],
  [[1, 0], [0, 1], [1, 1], [2, 1], [1, 2]],
  [[0, 0], [1, 0], [1, 1], [2, 1], [2, 2]],
  [[0, 0], [1, 0], [2, 0], [1, 1]],
  [[0, 0], [0, 1], [1, 1], [1, 2]],
  [[0, 0], [1, 0], [0, 1]],
];
/** Ore: the stone it sits in, with crisp nuggets that have a bright facet and
 *  a shadow, so they read as embedded crystals, not smudges. */
export function ore(stone: Paint, orePal: RGBA[], shadow: RGBA): Paint {
  const O = enrich(orePal, .6);
  return (p, seed) => {
    stone(p, seed);
    const taken = new Set<number>();
    for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++) {
      if (h(seed ^ 0x0e, i, j) < .22) continue;
      const shape = NUGGETS[Math.floor(h(seed ^ 0x0f, i, j) * NUGGETS.length)];
      const ox = Math.floor(i * 5.33 + 1 + h(seed ^ 0x10, i, j) * 2.5);
      const oy = Math.floor(j * 5.33 + 1 + h(seed ^ 0x11, i, j) * 2.5);
      const px = shape.map(([dx, dy]) => [(ox + dx) & 15, (oy + dy) & 15] as const);
      for (const [x, y] of px) taken.add(y * N + x);
      // Shadow first, below-right of every nugget pixel.
      for (const [x, y] of px) {
        for (const [sx, sy] of [[x + 1, y], [x, y + 1], [x + 1, y + 1]] as const) {
          const k = (sy & 15) * N + (sx & 15);
          if (!taken.has(k)) p.set(sx & 15, sy & 15, shadow);
        }
      }
      px.forEach(([x, y], n) => {
        const top = !taken.has(((y - 1) & 15) * N + x) || !taken.has(y * N + ((x - 1) & 15));
        const t = n === 0 ? 1 : top ? .7 : .35;
        p.set(x, y, O[Math.round(t * (O.length - 1))]);
      });
    }
  };
}

// ── Metal and gem blocks ────────────────────────────────────────────────────

/** A storage block of metal: two pressed plates in a dark rim, brushed
 *  horizontally, with a diagonal sheen across both. */
export function metalBlock(pal: RGBA[]): Paint {
  const P = enrich(pal, .7);
  const last = P.length - 1;
  return (p, seed) => p.fill((x, y) => {
    const r = ring(x, y);
    if (r === 0) return P[0];
    const v = y < 8 ? y - 1 : y - 8; // row within the plate (0..6)
    if (y === 7) return P[1];
    if (y === 8) return P[last];
    if (r === 1 || v === 0 || v === 6) {
      const lit = x === 1 || v === 0;
      return P[lit ? last : Math.max(0, 1)];
    }
    let t = .55 + (h(seed, 0, y) - .5) * .14 + (tnoise(seed ^ 2, x * 3, y, 4) - .5) * .08;
    const d = (x + y) % 16;
    if (d === 5 || d === 6) t += .32; else if (d === 7 || d === 13) t += .16;
    return grainPick(P, t, x, y, seed, .3);
  });
}

/** A cut-gem block: a bevelled frame round a four-facet pyramid, with
 *  sparkles on the lit facet. */
export function gemBlock(pal: RGBA[]): Paint {
  const P = enrich(pal, .7);
  const last = P.length - 1;
  return (p, seed) => p.fill((x, y) => {
    const r = ring(x, y);
    if (r === 0) return P[x === 0 || y === 0 ? last - 1 : 0];
    if (r === 1) return P[x === 1 || y === 1 ? last : 1];
    const u = x - 7.5, v = y - 7.5;
    let t: number;
    if (Math.abs(u) > Math.abs(v)) t = u < 0 ? .78 : .3;   // left / right facets
    else t = v < 0 ? .95 : .12;                             // top / bottom facets
    if (Math.abs(Math.abs(u) - Math.abs(v)) < .6) t = .62;  // the facet ridges
    if (Math.abs(u) < 1.6 && Math.abs(v) < 1.6) t = .85;    // table
    if (r === 2) t -= .12;
    const c = grainPick(P, t, x, y, seed, .25);
    if (h(seed, x, y) > .94 && t > .7) return hex(0xffffff);
    return c;
  });
}

/** Volcanic glass: inky body with soft deep-purple clouds, a scatter of
 *  short sharp glassy highlights and a few coloured glints (crying obsidian
 *  passes bright glints, which also gather into small weeping drips). */
export function obsidian(pal: RGBA[], glint: RGBA[]): Paint {
  const P = enrich(pal, .5);
  const hi = mix(P[P.length - 1], hex(0xc8b8ff), .4), mid = mix(P[P.length - 1], hex(0x9080d0), .15);
  return (p, seed) => {
    p.fill((x, y) => grainPick(P, .38 + (tfbm(seed, x, y) - .5) * .9, x, y, seed, .5));
    // Conchoidal glints: little diagonal strokes, bright head, dimmer tail.
    for (let i = 0; i < 10; i++) {
      const x0 = Math.floor(h(seed, i, 1) * N), y0 = Math.floor(h(seed, i, 2) * N);
      const len = 2 + Math.floor(h(seed, i, 3) * 2);
      for (let k = 0; k < len; k++) p.set((x0 + k) & 15, (y0 - k + N) & 15, k === len - 1 ? hi : mid);
    }
    for (let i = 0; i < glint.length * 2; i++) {
      const x = Math.floor(h(seed ^ 0x3d, i, 1) * N), y = Math.floor(h(seed ^ 0x3d, i, 2) * N);
      const g = glint[i % glint.length];
      p.set(x, y, g);
      if (glint.length > 2 && i % 2 === 0) { p.set(x, (y + 1) & 15, mix(g, P[1], .4)); p.set(x, (y + 2) & 15, mix(g, P[1], .7)); }
    }
  };
}

// ── Wood ────────────────────────────────────────────────────────────────────

/** Four boards with long grain lines, a lit top edge, a shadowed seam,
 *  staggered butt joints and the odd knot. */
export function boards(pal: RGBA[]): Paint {
  const P = enrich(pal, .7);
  return (p, seed) => p.fill((x, y) => {
    const board = y >> 2, v = y & 3;
    const joint = [3, 11, 7, 14][board];
    if (v === 3) return P[0];
    if (x === joint) return P[1];
    const segment = (x > joint ? 1 : 0) + board * 2;
    let t = .5 + (h(seed, segment, 1) - .5) * .28;
    if (v === 0) t += .2;
    if (x === joint + 1) t += .12;
    // Grain: thin darker streaks that run a few pixels along the board.
    const streak = h(seed ^ 0x6a, (x + Math.floor(h(seed, board, v) * 16)) >> 2, y);
    if (v > 0 && streak > .72) t -= .2;
    if (v > 0 && streak < .1) t += .1;
    // A knot: a dark eye with a pale ring.
    const kx = Math.floor(h(seed ^ 0x6b, board, 0) * 14) + 1;
    if (h(seed ^ 0x6c, board, 0) > .6 && v === 1 && Math.abs(x - kx) <= 1 && x !== joint) t = x === kx ? .05 : .2;
    return grainPick(P, t, x, y, seed, .35);
  });
}

/** Bark: vertical plates split by deep furrows, each plate lit along its left
 *  edge and broken by short horizontal cracks. */
export function bark(pal: RGBA[], plate = 4): Paint {
  const P = enrich(pal, .8);
  return (p, seed) => {
    const H = new Field((x, y) => {
      // Furrows wander a pixel left and right as they climb.
      const wob = Math.round((tnoise(seed ^ 4, x, y, 8) - .5) * 2);
      const xx = x + wob;
      const id = Math.floor(((xx % N) + N) % N / plate);
      const u = ((xx % plate) + plate) % plate;
      let v = .55 + (h(seed, id, (y + id * 5) >> 2) - .5) * .3 + (tnoise(seed ^ 3, x, y, 4) - .5) * .2;
      if (u === 0) v -= .55;
      if (h(seed ^ 8, id, y) > .88) v -= .3;
      return v;
    });
    p.fill((x, y) => grainPick(P, H.lit(x, y, 1.6), x, y, seed, .55));
  };
}

/** End grain: a bark rim, then growth rings (slightly wobbly) round a pith. */
export function endGrain(barkPal: RGBA[], wood: RGBA[]): Paint {
  const B = enrich(barkPal, .8), W = enrich(wood, .7);
  return (p, seed) => p.fill((x, y) => {
    const r = ring(x, y);
    if (r === 0) return grainPick(B, .4 + (h(seed, x, y) - .5) * .7, x, y, seed, .5);
    const d = Math.hypot(x - 7.5, y - 7.5) + (tnoise(seed, x, y, 4) - .5) * .9;
    let t = .8 - d / 16;
    if (Math.floor(d * .7) % 2 === 1) t -= .2;
    if (d < 1.3) t = .25;
    if (r === 1) t -= x === 1 || y === 1 ? .05 : .2;
    return grainPick(W, t, x, y, seed, .35);
  });
}

export { clamp01 };

/** Run a painter into a buffer, so another painter can read it back. */
export function capture(paint: Paint, seed: number): RGBA[] {
  const px: RGBA[] = new Array(N * N).fill(CLEAR);
  paint({
    set(x, y, c) { if (x >= 0 && y >= 0 && x < N && y < N) px[y * N + x] = c; },
    fill(fn) { for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) px[y * N + x] = fn(x, y); },
  }, seed);
  return px;
}
