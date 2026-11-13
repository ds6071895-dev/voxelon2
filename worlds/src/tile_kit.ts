// Numeric building blocks for the tile painters: tileable height fields,
// relief (emboss) lighting, and wrapping Voronoi cells. Everything here works
// on the 16px tile and wraps at its edges, so no face shows a seam.
//
// The house look comes from treating every material as a little HEIGHT MAP
// lit from the top-left: a raised pixel gets a bright rim above-left and a
// shadow below-right. That one trick is what turns flat noise into stone,
// pebbles, bark and knitted wool.

import { hash2 } from './noise';

const N = 16;
const wrap = (v: number) => ((v % N) + N) % N;

/** A 16x16 scalar field, sampled with wrap-around. */
export class Field {
  readonly v = new Float32Array(N * N);
  constructor(fn?: (x: number, y: number) => number) {
    if (fn) for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) this.v[y * N + x] = fn(x, y);
  }
  at(x: number, y: number): number { return this.v[wrap(y) * N + wrap(x)]; }
  /** Emboss light from the top-left: >0 on slopes facing the light. */
  slope(x: number, y: number): number {
    return (this.at(x - 1, y - 1) - this.at(x + 1, y + 1)) * .5 + (this.at(x - 1, y) - this.at(x + 1, y)) * .25 +
      (this.at(x, y - 1) - this.at(x, y + 1)) * .25;
  }
  /** Height plus `k` times its lighting: the shaded value a painter quantises. */
  lit(x: number, y: number, k = 1): number { return this.at(x, y) + this.slope(x, y) * k; }
}

export interface Cell { id: number; f1: number; f2: number; /** nearest site */ sx: number; sy: number }

/** Wrapping Voronoi over a jittered grid of `g x g` sites (g need not divide
 *  16). Returns, per pixel, the owning site and the distance gap to the next
 *  site (small gap = on a crack between cells). */
export function voronoi(seed: number, g: number, jitter = .85): (x: number, y: number) => Cell {
  const step = N / g;
  const sites: [number, number][] = [];
  for (let j = 0; j < g; j++) for (let i = 0; i < g; i++) {
    sites.push([(i + .5 + (hash2(seed, i, j * 7 + 1) - .5) * jitter) * step,
      (j + .5 + (hash2(seed, i * 5 + 3, j) - .5) * jitter) * step]);
  }
  const cache: Cell[] = new Array(N * N);
  return (x: number, y: number): Cell => {
    const key = wrap(Math.floor(y)) * N + wrap(Math.floor(x));
    if (cache[key] && Number.isInteger(x) && Number.isInteger(y)) return cache[key];
    const px = wrap(x) + .5, py = wrap(y) + .5;
    let f1 = 1e9, f2 = 1e9, id = 0, sx = 0, sy = 0;
    for (let i = 0; i < sites.length; i++) {
      for (let ox = -N; ox <= N; ox += N) for (let oy = -N; oy <= N; oy += N) {
        const dx = sites[i][0] + ox - px, dy = sites[i][1] + oy - py;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d < f1) { f2 = f1; f1 = d; id = i; sx = sites[i][0] + ox; sy = sites[i][1] + oy; } else if (d < f2) f2 = d;
      }
    }
    const c = { id, f1, f2: f2 - f1, sx, sy };
    if (Number.isInteger(x) && Number.isInteger(y)) cache[key] = c;
    return c;
  };
}

/** Hash noise in 0..1 that never repeats inside the tile. */
export function h(seed: number, x: number, y: number): number { return hash2(seed, wrap(x), wrap(y)); }

// ── Colour ──────────────────────────────────────────────────────────────────

export type RGBA = [number, number, number, number];
export const CLEAR: RGBA = [0, 0, 0, 0];
export function hex(c: number, a = 255): RGBA { return [(c >> 16) & 255, (c >> 8) & 255, c & 255, a]; }
export function mix(a: RGBA, b: RGBA, t: number): RGBA {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, a[3] + (b[3] - a[3]) * t];
}
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/** Hue-shifted ramp, the pixel-art way: shadows lean cool and a touch more
 *  saturated, highlights lean warm and lighter. Takes any dark-to-light list
 *  and returns the same number of steps, a little wider in contrast. */
export function enrich(pal: RGBA[], strength = 1): RGBA[] {
  const n = pal.length;
  return pal.map((c, i) => {
    const t = n > 1 ? i / (n - 1) - .5 : 0; // -.5 (darkest) .. .5 (lightest)
    const k = strength;
    let r = c[0], g = c[1], b = c[2];
    // Contrast: push the ends of the ramp apart a little.
    const d = t * 20 * k;
    r += d; g += d; b += d;
    if (t < 0) { // cool, deeper shadows
      const s = -t * 2 * k;
      r -= 6 * s; g -= 2 * s; b += 5 * s;
    } else {     // warm highlights
      const s = t * 2 * k;
      r += 5 * s; g += 3 * s; b -= 4 * s;
    }
    return [Math.max(0, Math.min(255, r)), Math.max(0, Math.min(255, g)), Math.max(0, Math.min(255, b)), c[3]];
  });
}

/** Quantise 0..1 onto a palette with a soft hashed dither (organic grain, no
 *  regular crosshatch). `amount` is in palette steps. */
export function grainPick(pal: RGBA[], t: number, x: number, y: number, seed: number, amount = .5): RGBA {
  const v = clamp01(t) * (pal.length - 1) + (h(seed ^ 0x5bd1, x, y) - .5) * amount;
  return pal[Math.max(0, Math.min(pal.length - 1, Math.round(v)))];
}

/** Tileable value noise over the 16px tile: `cell` must divide 16. */
export function tnoise(seed: number, x: number, y: number, cell: number): number {
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
export function tfbm(seed: number, x: number, y: number): number {
  return tnoise(seed, x, y, 8) * .5 + tnoise(seed ^ 0x55, x, y, 4) * .32 + tnoise(seed ^ 0xaa, x, y, 2) * .18;
}
