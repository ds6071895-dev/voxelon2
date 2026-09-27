// Seeded value/gradient noise — no external libraries.

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Deterministic hash of integer coords -> [0,1). Used for tree placement etc. */
export function hash2(seed: number, x: number, z: number): number {
  let h = seed ^ Math.imul(x, 374761393) ^ Math.imul(z, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function fade(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

const GRAD2: [number, number][] = [
  [1, 1], [-1, 1], [1, -1], [-1, -1],
  [1, 0], [-1, 0], [0, 1], [0, -1],
];

export class Noise2D {
  private perm: Uint8Array;
  constructor(seed: number) {
    const rng = mulberry32(seed);
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [p[i], p[j]] = [p[j], p[i]];
    }
    this.perm = new Uint8Array(512);
    for (let i = 0; i < 512; i++) this.perm[i] = p[i & 255];
  }

  /** Perlin-style gradient noise in [-1, 1]. */
  noise(x: number, y: number): number {
    const X = Math.floor(x), Y = Math.floor(y);
    const xf = x - X, yf = y - Y;
    const u = fade(xf), v = fade(yf);
    const p = this.perm;
    const g = (gx: number, gy: number, dx: number, dy: number) => {
      const grad = GRAD2[p[(p[gx & 255] + (gy & 255)) & 255] & 7];
      return grad[0] * dx + grad[1] * dy;
    };
    const n00 = g(X, Y, xf, yf);
    const n10 = g(X + 1, Y, xf - 1, yf);
    const n01 = g(X, Y + 1, xf, yf - 1);
    const n11 = g(X + 1, Y + 1, xf - 1, yf - 1);
    return lerp(lerp(n00, n10, u), lerp(n01, n11, u), v) * 1.41;
  }

  /** Fractal Brownian motion in [-1, 1]. */
  fbm(x: number, y: number, octaves: number): number {
    let sum = 0, amp = 1, freq = 1, norm = 0;
    for (let i = 0; i < octaves; i++) {
      sum += this.noise(x * freq, y * freq) * amp;
      norm += amp;
      amp *= 0.5;
      freq *= 2;
    }
    return sum / norm;
  }
}

export class Noise3D {
  private perm: Uint8Array;
  constructor(seed: number) {
    const rng = mulberry32(seed);
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [p[i], p[j]] = [p[j], p[i]];
    }
    this.perm = new Uint8Array(512);
    for (let i = 0; i < 512; i++) this.perm[i] = p[i & 255];
  }

  /** Value noise in [-1, 1] (cheap, good enough for caves). */
  noise(x: number, y: number, z: number): number {
    const X = Math.floor(x), Y = Math.floor(y), Z = Math.floor(z);
    const xf = x - X, yf = y - Y, zf = z - Z;
    const u = fade(xf), v = fade(yf), w = fade(zf);
    const p = this.perm;
    const val = (i: number, j: number, k: number) =>
      p[(p[(p[i & 255] + (j & 255)) & 255] + (k & 255)) & 255] / 127.5 - 1;
    const x00 = lerp(val(X, Y, Z), val(X + 1, Y, Z), u);
    const x10 = lerp(val(X, Y + 1, Z), val(X + 1, Y + 1, Z), u);
    const x01 = lerp(val(X, Y, Z + 1), val(X + 1, Y, Z + 1), u);
    const x11 = lerp(val(X, Y + 1, Z + 1), val(X + 1, Y + 1, Z + 1), u);
    return lerp(lerp(x00, x10, v), lerp(x01, x11, v), w);
  }
}

/** Tileable 2D value noise on a wrapped lattice (for the cloud texture). */
export function wrappedValueNoise(
  seed: number, x: number, y: number, period: number
): number {
  const X = Math.floor(x), Y = Math.floor(y);
  const xf = x - X, yf = y - Y;
  const u = fade(xf), v = fade(yf);
  const val = (i: number, j: number) =>
    hash2(seed, ((i % period) + period) % period, ((j % period) + period) % period);
  return lerp(
    lerp(val(X, Y), val(X + 1, Y), u),
    lerp(val(X, Y + 1), val(X + 1, Y + 1), u),
    v
  );
}
