// Procedural pixel textures for the humanoid avatar (remoteplayers.ts) and the
// first-person hand (held.ts).
//
// Every avatar part is a shaded box whose faces already carry the cosmetic
// colour in vertex colours. These textures are pure grayscale MULTIPLIERS laid
// over that colour, so they add material — cloth weave, denim twill, hair
// strands, brushed metal — without touching a single palette value or
// cosmetic choice.
//
// Each texture is 16x16 and maps 0..1 across every box face (BoxGeometry's
// default UVs), exactly like one face of a Minecraft skin. That means the 1px
// darkened border baked into each pattern always lands on the real edge of the
// part, which is what gives the model its crisp blocky definition.

import * as THREE from 'three';

export type AvatarSurface =
  | 'skin' | 'cloth' | 'camo' | 'webbing' | 'denim' | 'hair' | 'leather' | 'metal'
  | 'wood' | 'none';

const SIZE = 16;

/** Deterministic per-texel noise — no Math.random, so every client and the
 *  character preview render byte-identical materials. */
function noise(x: number, y: number, salt: number): number {
  const n = Math.sin((x * 127.1 + y * 311.7 + salt * 74.7)) * 43758.5453;
  return n - Math.floor(n);
}

/** Grayscale painter working in 0..255 multiplier space (255 = untouched). */
class Pattern {
  readonly px = new Uint8Array(SIZE * SIZE);

  constructor(base: number) { this.px.fill(base); }

  set(x: number, y: number, value: number): void {
    if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return;
    this.px[y * SIZE + x] = Math.max(0, Math.min(255, Math.round(value)));
  }

  get(x: number, y: number): number { return this.px[y * SIZE + x]; }

  add(x: number, y: number, delta: number): void {
    if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return;
    this.set(x, y, this.get(x, y) + delta);
  }

  /** Darken the outermost ring so each face reads as a distinct blocky panel. */
  border(edge: number, inner: number): void {
    for (let i = 0; i < SIZE; i++) {
      this.set(i, 0, edge); this.set(i, SIZE - 1, edge);
      this.set(0, i, edge); this.set(SIZE - 1, i, edge);
      this.add(i, 1, inner); this.add(i, SIZE - 2, inner);
      this.add(1, i, inner); this.add(SIZE - 2, i, inner);
    }
  }
}

function buildPattern(surface: AvatarSurface): Pattern {
  switch (surface) {
    case 'skin': {
      // Soft, uneven tone with a faint warm sheen down the middle — enough to
      // stop large flat limbs looking like painted plastic.
      const p = new Pattern(250);
      for (let y = 0; y < SIZE; y++) {
        for (let x = 0; x < SIZE; x++) {
          const mottle = (noise(x, y, 3) - 0.5) * 9;
          const sheen = Math.cos(((x + 0.5) / SIZE - 0.5) * Math.PI) * 5;
          p.set(x, y, 246 + mottle + sheen);
          if (noise(x, y, 17) > 0.965) p.add(x, y, -16); // freckle / pore
        }
      }
      p.border(214, -12);
      return p;
    }
    case 'cloth': {
      // Plain weave: alternating warp and weft threads plus occasional slubs,
      // with a stitched seam one pixel inside the panel edge.
      const p = new Pattern(248);
      for (let y = 0; y < SIZE; y++) {
        for (let x = 0; x < SIZE; x++) {
          const weave = ((x + y) & 1) ? 6 : -6;
          const weft = y % 4 === 0 ? -9 : 0;
          const warp = x % 4 === 2 ? -5 : 0;
          p.set(x, y, 246 + weave + weft + warp + (noise(x, y, 5) - 0.5) * 7);
          if (noise(x, y, 23) > 0.972) p.add(x, y, -20); // slub in the yarn
        }
      }
      for (let i = 2; i < SIZE - 2; i += 2) { // running stitch down both seams
        p.set(2, i, 206); p.set(SIZE - 3, i, 206);
      }
      p.border(200, -14);
      return p;
    }
    case 'camo': {
      // Tonal disruptive pattern: three shades of whatever colour the uniform
      // is, in chunky blotches. Because it is a multiplier it works on every
      // faction colour — a crimson side wears crimson camo — and it is what
      // makes a plain shirt read as a battle-dress uniform.
      const p = new Pattern(250);
      for (let y = 0; y < SIZE; y++) {
        for (let x = 0; x < SIZE; x++) {
          const big = noise(x >> 2, y >> 2, 71);
          const mid = noise((x + 1) >> 1, (y + 2) >> 1, 73);
          const blot = big * 0.62 + mid * 0.38;
          const tone = blot > 0.66 ? 196 : blot > 0.44 ? 224 : 250;
          p.set(x, y, tone + ((x + y) & 1 ? 3 : -3) + (noise(x, y, 79) - 0.5) * 6);
        }
      }
      for (let i = 2; i < SIZE - 2; i += 2) { p.add(2, i, -18); p.add(SIZE - 3, i, -18); }
      p.border(196, -12);
      return p;
    }
    case 'webbing': {
      // Load-bearing webbing: horizontal rows of stitched nylon loops (MOLLE),
      // the texture that makes a slab of colour read as a plate carrier.
      const p = new Pattern(238);
      for (let y = 0; y < SIZE; y++) {
        const loop = (y % 4 === 1) ? -26 : (y % 4 === 2) ? 8 : 0;
        for (let x = 0; x < SIZE; x++) {
          const tack = (y % 4 === 1 && x % 4 === 0) ? -14 : 0;
          p.set(x, y, 236 + loop + tack + (noise(x, y, 83) - 0.5) * 8);
        }
      }
      p.border(176, -14);
      return p;
    }
    case 'denim': {
      // Twill: staggered horizontal dashes read as diagonal ribbing without
      // skewing when the face is taller than it is wide, plus a worn hem.
      const p = new Pattern(244);
      for (let y = 0; y < SIZE; y++) {
        for (let x = 0; x < SIZE; x++) {
          const rib = ((x + (y >> 1)) % 3 === 0) ? -13 : 4;
          p.set(x, y, 243 + rib + (noise(x, y, 11) - 0.5) * 8);
          if (noise(x, y, 29) > 0.955) p.add(x, y, 9); // faded thread
        }
      }
      for (let x = 1; x < SIZE - 1; x++) { // hem stitching top and bottom
        p.set(x, 2, x & 1 ? 255 : 226);
        p.set(x, SIZE - 3, x & 1 ? 255 : 226);
      }
      p.border(196, -12);
      return p;
    }
    case 'hair': {
      // Vertical strands with a highlight band near the crown. Stretching this
      // over a tall face just makes the strands longer, which is correct.
      const p = new Pattern(240);
      for (let x = 0; x < SIZE; x++) {
        const strand = noise(x, 0, 7);
        const depth = strand > 0.72 ? 18 : strand < 0.26 ? -24 : -6;
        for (let y = 0; y < SIZE; y++) {
          const shine = y < 5 ? (5 - y) * 3 : 0; // sheen catches the top
          const split = noise(x, y >> 2, 13) > 0.86 ? -14 : 0;
          p.set(x, y, 238 + depth + shine + split + (noise(x, y, 19) - 0.5) * 6);
        }
      }
      p.border(190, -10);
      return p;
    }
    case 'leather': {
      // Coarse grain blotches with a dark rolled edge — belts, shoes, straps.
      const p = new Pattern(236);
      for (let y = 0; y < SIZE; y++) {
        for (let x = 0; x < SIZE; x++) {
          const grain = (noise(x >> 1, y >> 1, 2) - 0.5) * 22;
          p.set(x, y, 234 + grain + (noise(x, y, 31) - 0.5) * 10);
        }
      }
      for (let i = 3; i < SIZE - 3; i += 3) { // saddle stitching
        p.set(3, i, 255); p.set(SIZE - 4, i, 255);
      }
      p.border(178, -16);
      return p;
    }
    case 'metal': {
      // Brushed plate: horizontal tool marks, a lit top bevel, a shadowed
      // bottom bevel, and a rivet in each corner.
      const p = new Pattern(240);
      for (let y = 0; y < SIZE; y++) {
        const streak = (noise(0, y, 41) - 0.5) * 16;
        for (let x = 0; x < SIZE; x++) {
          p.set(x, y, 241 + streak + (noise(x, y, 43) - 0.5) * 9);
          if (noise(x, y, 47) > 0.978) p.add(x, y, -26); // scuff
        }
      }
      for (let x = 1; x < SIZE - 1; x++) {
        p.set(x, 1, 255); p.set(x, 2, 252);          // catch light along the top
        p.set(x, SIZE - 2, 198); p.set(x, SIZE - 3, 214); // shadow under the lip
      }
      for (const [rx, ry] of [[3, 3], [SIZE - 4, 3], [3, SIZE - 4], [SIZE - 4, SIZE - 4]]) {
        p.set(rx, ry, 255); p.set(rx + 1, ry, 206);
        p.set(rx, ry + 1, 214); p.set(rx + 1, ry + 1, 190);
      }
      p.border(172, -18);
      return p;
    }
    case 'wood': {
      // Vertical grain with a couple of knots — the boat hull and props.
      const p = new Pattern(238);
      for (let x = 0; x < SIZE; x++) {
        const plank = noise(x, 0, 53) > 0.8 ? -30 : 0;
        for (let y = 0; y < SIZE; y++) {
          const grain = Math.sin(x * 1.7 + noise(0, y >> 2, 59) * 3) * 9;
          p.set(x, y, 236 + plank + grain + (noise(x, y, 61) - 0.5) * 8);
        }
      }
      p.border(186, -14);
      return p;
    }
    default:
      return new Pattern(255);
  }
}

const CACHE = new Map<AvatarSurface, THREE.DataTexture | null>();

/** The shared multiplier texture for a surface (null for 'none' — crisp,
 *  untextured pixels for tiny face features and accessories). */
export function avatarTexture(surface: AvatarSurface): THREE.DataTexture | null {
  if (CACHE.has(surface)) return CACHE.get(surface)!;
  if (surface === 'none') { CACHE.set(surface, null); return null; }

  const pattern = buildPattern(surface);
  const data = new Uint8Array(SIZE * SIZE * 4);
  for (let i = 0; i < SIZE * SIZE; i++) {
    const v = pattern.px[i];
    data[i * 4] = v; data[i * 4 + 1] = v; data[i * 4 + 2] = v; data[i * 4 + 3] = 255;
  }
  const texture = new THREE.DataTexture(data, SIZE, SIZE, THREE.RGBAFormat);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  CACHE.set(surface, texture);
  return texture;
}
