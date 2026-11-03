// Procedural pixel textures for the vanilla modes' mobs (entity_view.ts).
//
// Same idea as avatartex.ts: every mob part is a shaded box whose faces carry
// the palette colour in vertex colours, and these 16x16 textures are grayscale
// MULTIPLIERS laid over it. They add the material — rotting flesh, bone,
// creeper mottle, fur, wool curls, feathers, carapace plates — while each mob
// keeps its own palette. Each texture maps 0..1 across one box face, and a
// darkened 1px rim lands on every real edge so parts read as crisp blocks.

import * as THREE from 'three';

export type MobSurface =
  | 'flesh' | 'dry' | 'cloth' | 'denim' | 'bone' | 'creeper' | 'fur' | 'wool'
  | 'feather' | 'shell' | 'hoof' | 'wood';

const SIZE = 16;

/** Deterministic per-texel noise, so every client renders identical mobs. */
function noise(x: number, y: number, salt: number): number {
  const n = Math.sin(x * 127.1 + y * 311.7 + salt * 74.7) * 43758.5453;
  return n - Math.floor(n);
}

class Pattern {
  readonly px = new Uint8Array(SIZE * SIZE);
  constructor(base: number) { this.px.fill(base); }
  set(x: number, y: number, v: number): void {
    if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return;
    this.px[y * SIZE + x] = Math.max(0, Math.min(255, Math.round(v)));
  }
  get(x: number, y: number): number { return this.px[y * SIZE + x]; }
  add(x: number, y: number, d: number): void { if (x >= 0 && y >= 0 && x < SIZE && y < SIZE) this.set(x, y, this.get(x, y) + d); }
  each(f: (x: number, y: number) => number): this { for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) this.set(x, y, f(x, y)); return this; }
  border(edge: number, inner: number): this {
    for (let i = 0; i < SIZE; i++) {
      this.add(i, 1, inner); this.add(i, SIZE - 2, inner); this.add(1, i, inner); this.add(SIZE - 2, i, inner);
    }
    for (let i = 0; i < SIZE; i++) { this.set(i, 0, edge); this.set(i, SIZE - 1, edge); this.set(0, i, edge); this.set(SIZE - 1, i, edge); }
    return this;
  }
}

function build(surface: MobSurface): Pattern {
  switch (surface) {
    case 'flesh':
      // Blotchy, uneven decay: darker bruises and a few sickly bright pocks.
      return new Pattern(240).each((x, y) => {
        let v = 236 + (noise(x >> 1, y >> 1, 3) - .5) * 30 + (noise(x, y, 4) - .5) * 10;
        if (noise(x >> 2, y >> 2, 9) > .78) v -= 26;
        if (noise(x, y, 12) > .95) v += 18;
        return v;
      }).border(196, -12);
    case 'dry':
      // Husk hide: sun-baked and cracked into small plates.
      return new Pattern(240).each((x, y) => {
        let v = 238 + (noise(x >> 1, y >> 1, 21) - .5) * 20 + (noise(x, y, 22) - .5) * 8;
        if ((x + (y >> 2) * 3) % 5 === 0 && noise(x, y >> 1, 23) > .45) v -= 30;
        if ((y + (x >> 2)) % 6 === 0 && noise(x >> 1, y, 24) > .5) v -= 24;
        return v;
      }).border(192, -12);
    case 'cloth': {
      // Torn shirt: weave, dirt and a few rips showing darker beneath.
      const p = new Pattern(244).each((x, y) => 242 + (((x + y) & 1) ? 5 : -5) + (y % 4 === 0 ? -8 : 0) + (noise(x, y, 5) - .5) * 10
        - (noise(x >> 2, y >> 2, 6) > .7 ? 22 : 0));
      for (let i = 0; i < 4; i++) { const rx = 2 + Math.floor(noise(i, 0, 7) * 11), ry = 3 + Math.floor(noise(i, 1, 7) * 10); p.set(rx, ry, 120); p.set(rx + 1, ry, 140); p.set(rx, ry + 1, 150); }
      for (let x = 1; x < SIZE - 1; x++) if (noise(x, 0, 8) > .55) p.set(x, SIZE - 2, 150); // frayed hem
      return p.border(190, -12);
    }
    case 'denim':
      return new Pattern(242).each((x, y) => 240 + (((x + (y >> 1)) % 3 === 0) ? -14 : 4) + (noise(x, y, 11) - .5) * 9
        - (noise(x >> 2, y >> 2, 13) > .72 ? 18 : 0)).border(188, -12);
    case 'bone': {
      // Weathered bone: chalky grain, hairline cracks, a pale ridge down the middle.
      const p = new Pattern(244).each((x, y) => 240 + (noise(x, y, 31) - .5) * 14 + (x === 7 || x === 8 ? 8 : 0) - (noise(x >> 1, y >> 1, 32) > .82 ? 16 : 0));
      let cx = 4 + Math.floor(noise(0, 0, 33) * 8);
      for (let y = 3; y < 13; y++) { p.add(cx, y, -48); cx += noise(cx, y, 34) > .66 ? 1 : noise(cx, y, 34) < .33 ? -1 : 0; }
      return p.border(176, -14);
    }
    case 'creeper':
      // The signature creeper mottle: hard-edged light and dark pixels on green.
      return new Pattern(230).each((x, y) => {
        const n = noise(x, y, 41);
        return n > .82 ? 255 : n > .62 ? 238 : n < .14 ? 150 : n < .3 ? 188 : 218;
      }).border(150, -10);
    case 'fur': {
      // Short directional strands with lighter tips; darker roots near the base.
      const p = new Pattern(238);
      for (let x = 0; x < SIZE; x++) {
        const lean = noise(x, 0, 51) > .5 ? 1 : 0;
        for (let y = 0; y < SIZE; y++) {
          const strand = noise(x + (y >> 2) * lean, y >> 1, 52);
          p.set(x, y, 236 + (strand > .7 ? 16 : strand < .25 ? -22 : -4) + (y > 11 ? -10 : 0) + (noise(x, y, 53) - .5) * 6);
        }
      }
      return p.border(184, -10);
    }
    case 'wool': {
      // Curls: small bright domes with shaded undersides on a 4px lattice.
      const p = new Pattern(232);
      for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
        const ox = (x + ((y >> 2) & 1) * 2) & 3, oy = y & 3;
        const d = Math.hypot(ox - 1.5, oy - 1.2);
        p.set(x, y, 222 + (d < 1.1 ? 28 : d < 1.8 ? 10 : -16) + (oy === 3 ? -14 : 0) + (noise(x, y, 61) - .5) * 8);
      }
      return p.border(196, -8);
    }
    case 'feather': {
      // Overlapping scalloped rows, each feather lit at its top edge.
      const p = new Pattern(246);
      for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
        const row = y >> 2, ox = (x + (row & 1) * 2) & 3, oy = y & 3;
        p.set(x, y, 244 + (oy === 0 ? 10 : 0) + (oy === 3 && ox !== 1 && ox !== 2 ? -22 : 0) + (ox === 0 ? -6 : 0) + (noise(x, y, 71) - .5) * 6);
      }
      return p.border(204, -8);
    }
    case 'shell': {
      // Silverfish carapace: overlapping plates with a lit front lip.
      const p = new Pattern(232).each((x, y) => 228 + (y % 5 === 0 ? 24 : y % 5 === 4 ? -30 : 0) + (noise(x >> 1, y, 81) - .5) * 18);
      for (let y = 0; y < SIZE; y++) { p.add(7, y, -12); p.add(8, y, 8); }
      return p.border(160, -12);
    }
    case 'hoof':
      return new Pattern(230).each((x, y) => 226 + (noise(x, y, 91) - .5) * 18 + (y > 11 ? -24 : 0)).border(170, -10);
    case 'wood':
      // Bow limbs: long grain lines.
      return new Pattern(238).each((x, y) => 234 + (x % 3 === 0 ? -20 : 4) + (noise(x, y >> 2, 95) - .5) * 14).border(180, -8);
  }
}

const CACHE = new Map<MobSurface, THREE.DataTexture>();

/** The shared multiplier texture for a mob surface (never disposed: tiny and reused). */
export function mobTexture(surface: MobSurface): THREE.DataTexture {
  let t = CACHE.get(surface);
  if (t) return t;
  const p = build(surface);
  const data = new Uint8Array(SIZE * SIZE * 4);
  for (let i = 0; i < SIZE * SIZE; i++) { const v = p.px[i]; data[i * 4] = v; data[i * 4 + 1] = v; data[i * 4 + 2] = v; data[i * 4 + 3] = 255; }
  t = new THREE.DataTexture(data, SIZE, SIZE, THREE.RGBAFormat);
  t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.generateMipmaps = false; t.needsUpdate = true;
  CACHE.set(surface, t);
  return t;
}
