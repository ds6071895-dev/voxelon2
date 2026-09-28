// Procedurally drawn 16x16 pixel-art tiles in the style of classic Minecraft.
// All art is generated here from scratch — no Mojang assets.

import * as THREE from 'three';
import { Tile } from './blocks';
import { mulberry32, hash2 } from './noise';
import { WORLDS_ART } from './tile_art';
import { MANOR_ART } from './tile_art_manor';

export const TILE_PX = 16;
// 20x20 grid. Bumped from 16 when the minigame block/item set needed 15 tiles
// and only 13 cells were free. All tile addressing goes through tileOrigin /
// uvRect, so widening the grid is a pure data change — there is no hand-rolled
// `% 16` arithmetic anywhere in the codebase.
export const ATLAS_TILES = 20;
/** Gutter around every tile's art inside its atlas cell.
 *
 *  The atlas is MIPMAPPED (see createAtlas), and a mipmap averages neighbouring
 *  texels — so without a gutter, tile N's colour leaks into tile N+1 the moment
 *  the sampler drops to a smaller level. Each 16px tile therefore sits in the
 *  middle of a 32px cell whose border repeats the tile's own edge pixels, which
 *  keeps the average honest all the way down to a 4x4 level (2x2 of art). */
const ATLAS_PAD = 8;
/** Full cell footprint: art plus its gutter on both sides. */
export const CELL_PX = TILE_PX + ATLAS_PAD * 2;
const ATLAS_PX = CELL_PX * ATLAS_TILES;

/** Top-left pixel of a tile's ART (not its cell) inside the atlas canvas.
 *  Anything reading the atlas canvas directly — the item icons in icons.ts —
 *  must go through this rather than multiplying by TILE_PX. */
export function tileOrigin(tile: number): { x: number; y: number } {
  return {
    x: (tile % ATLAS_TILES) * CELL_PX + ATLAS_PAD,
    y: Math.floor(tile / ATLAS_TILES) * CELL_PX + ATLAS_PAD,
  };
}

export interface Atlas {
  texture: THREE.CanvasTexture;
  canvas: HTMLCanvasElement;
  /** uv rect [u0, v0, u1, v1] for a tile (v0 = bottom). */
  uvRect(tile: Tile): [number, number, number, number];
}

type RGBA = [number, number, number, number];

class Painter {
  data: Uint8ClampedArray<ArrayBuffer>;
  constructor() {
    this.data = new Uint8ClampedArray(TILE_PX * TILE_PX * 4);
  }
  set(x: number, y: number, c: RGBA): void {
    if (x < 0 || y < 0 || x >= TILE_PX || y >= TILE_PX) return;
    const i = (y * TILE_PX + x) * 4;
    this.data[i] = c[0]; this.data[i + 1] = c[1];
    this.data[i + 2] = c[2]; this.data[i + 3] = c[3];
  }
  fill(fn: (x: number, y: number) => RGBA): void {
    for (let y = 0; y < TILE_PX; y++)
      for (let x = 0; x < TILE_PX; x++) this.set(x, y, fn(x, y));
  }
}

function shade(base: RGBA, f: number): RGBA {
  return [base[0] * f, base[1] * f, base[2] * f, base[3]];
}

/** Wrap a painter so its art is mirrored on the X axis (left<->right). */
function flipX(fn: (p: Painter, seed: number) => void) {
  return (p: Painter, seed: number): void => {
    const tmp = new Painter();
    fn(tmp, seed);
    for (let y = 0; y < TILE_PX; y++) {
      for (let x = 0; x < TILE_PX; x++) {
        const i = (y * TILE_PX + (TILE_PX - 1 - x)) * 4;
        p.set(x, y, [tmp.data[i], tmp.data[i + 1], tmp.data[i + 2], tmp.data[i + 3]]);
      }
    }
  };
}

const GUN_METAL: RGBA = [104, 110, 124, 255];
const GUN_METAL_HI: RGBA = [150, 158, 176, 255];
const GUN_DARK: RGBA = [44, 46, 54, 255];
const GUN_GRIP: RGBA = [78, 54, 36, 255];
const GUN_GRIP_HI: RGBA = [106, 76, 50, 255];
const GUN_EDGE: RGBA = [16, 16, 20, 255];

/** Wrap a 1px dark outline around all opaque art — small item sprites read far
 *  better with a silhouette than as loose floating pixels. */
function outlineSprite(p: Painter, edge: RGBA = GUN_EDGE): void {
  const src = p.data.slice();
  const op = (x: number, y: number): boolean =>
    x >= 0 && y >= 0 && x < TILE_PX && y < TILE_PX && src[(y * TILE_PX + x) * 4 + 3] > 0;
  for (let y = 0; y < TILE_PX; y++) {
    for (let x = 0; x < TILE_PX; x++) {
      if (src[(y * TILE_PX + x) * 4 + 3] > 0) continue;
      if (op(x - 1, y) || op(x + 1, y) || op(x, y - 1) || op(x, y + 1)) p.set(x, y, edge);
    }
  }
}

function paintBurstRifle(p: Painter, seed: number): void {
  const j = (c: RGBA, x: number, y: number): RGBA => shade(c, 0.9 + hash2(seed, x, y) * 0.18);
  // Boxy carbine barrel.
  for (let x = 3; x <= 13; x++) { p.set(x, 6, j(GUN_METAL_HI, x, 6)); p.set(x, 7, j(GUN_METAL, x, 7)); }
  p.set(13, 6, [12, 12, 16, 255]); // muzzle
  // Carry handle / sight block on top.
  for (let x = 5; x <= 9; x++) p.set(x, 5, j(GUN_DARK, x, 5));
  for (let x = 3; x <= 11; x++) p.set(x, 8, j(GUN_DARK, x, 8)); // receiver
  // Stock + angled magazine.
  p.set(3, 9, j(GUN_GRIP_HI, 3, 9)); p.set(2, 9, j(GUN_GRIP, 2, 9));
  for (let y = 9; y <= 12; y++) { p.set(7, y, j(GUN_DARK, 7, y)); p.set(8, y, j(GUN_DARK, 8, y)); }
  p.set(9, 11, j(GUN_DARK, 9, 11)); p.set(9, 12, j(GUN_DARK, 9, 12)); // mag curve
  outlineSprite(p);
}

function paintBullet(p: Painter, seed: number): void {
  const brass: RGBA = [214, 176, 72, 255], brassHi: RGBA = [240, 208, 120, 255];
  const tip: RGBA = [156, 126, 64, 255];
  // Tapered tip.
  p.set(7, 4, tip); p.set(8, 4, tip);
  for (let x = 6; x <= 9; x++) p.set(x, 5, tip);
  for (let x = 6; x <= 9; x++) p.set(x, 6, shade(tip, 1.12));
  // Brass casing with a highlight column.
  for (let y = 7; y <= 12; y++)
    for (let x = 6; x <= 9; x++)
      p.set(x, y, shade(x === 6 ? brassHi : brass, 0.9 + hash2(seed, x, y) * 0.16));
  for (let x = 6; x <= 9; x++) p.set(x, 12, [120, 96, 50, 255]); // base rim
  outlineSprite(p);
}

const GADGET_OUTLINE: RGBA = [18, 20, 26, 255];

/** Filled axis-aligned rectangle helper for the sprite painters. */
function rect(p: Painter, x0: number, y0: number, x1: number, y1: number, c: RGBA): void {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) p.set(x, y, c);
}

/** Bounce Pad: a coiled launch spring on a plate with a green up arrow. */
function paintJumpBoost(p: Painter): void {
  const steel: RGBA = [198, 204, 212, 255];
  const steelD: RGBA = [122, 128, 138, 255];
  // Base plate with outline + bolts.
  rect(p, 3, 13, 12, 14, GADGET_OUTLINE);
  rect(p, 4, 13, 11, 13, steelD);
  p.set(4, 13, [230, 234, 240, 255]); p.set(11, 13, [230, 234, 240, 255]);
  // Coil: alternating offset windings so it reads as a spring.
  for (let y = 7; y <= 12; y++) {
    const off = y % 2 ? 0 : 1;
    for (let x = 5 + off; x <= 9 + off; x++) {
      p.set(x, y, x === 5 + off ? steelD : (x === 9 + off ? [232, 238, 246, 255] : steel));
    }
  }
  // Green up arrow launching out of the spring.
  const green: RGBA = [96, 214, 108, 255];
  const greenD: RGBA = [52, 140, 66, 255];
  p.set(7, 1, green); p.set(8, 1, green);
  rect(p, 6, 2, 9, 2, green);
  p.set(5, 3, green); p.set(6, 3, greenD); p.set(9, 3, greenD); p.set(10, 3, green);
  rect(p, 7, 3, 8, 5, greenD);
  // Motion ticks either side.
  p.set(4, 5, [190, 240, 190, 200]); p.set(11, 5, [190, 240, 190, 200]);
}

/** VOXELON's painters for the tiles WORLDS_ART does not redesign: the item
 *  sprites behind the pixel-art icon fallback (no WebGL for model icons). */
const PAINTERS: Record<number, (p: Painter, seed: number) => void> = {
  [Tile.BurstRifle]: flipX(paintBurstRifle),
  [Tile.Bullet]: paintBullet,
  [Tile.JumpBoost]: paintJumpBoost,
};

// --- Vibrance -------------------------------------------------------------
// VOXELON's classic art was painted muted and brightened by one post-pass in
// atlas space. The PAINTERS above still rely on it; WORLDS_ART tiles are
// painted in their final colours and skip it.
//
// Saturation only AMPLIFIES chroma that is already there — a pure grey
// (r=g=b) has none — so the pass pairs the chroma boost with a midtone GAMMA
// lift, which does brighten greys.
const SAT = 1.78;   // chroma multiplier around luma (hue preserved)
const GAMMA = 0.82; // <1 lifts midtones — the "brighter, fresher" half

/** Saturate + lift a painted tile in place. Transparent pixels are skipped. */
function vibrance(p: Painter): void {
  const d = p.data;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue;
    // Rec.709 luma keeps perceived brightness stable while chroma grows.
    const lum = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
    let r = lum + (d[i] - lum) * SAT;
    let g = lum + (d[i + 1] - lum) * SAT;
    let b = lum + (d[i + 2] - lum) * SAT;
    // Clipping a single channel would SHIFT THE HUE (a bright red turning
    // orange), so when any channel overshoots, pull all three back toward luma
    // by the same factor instead. Colors stay true, just as vivid as they fit.
    const mx = Math.max(r, g, b);
    if (mx > 255) {
      const t = (255 - lum) / (mx - lum);
      r = lum + (r - lum) * t; g = lum + (g - lum) * t; b = lum + (b - lum) * t;
    }
    d[i]     = 255 * Math.pow(Math.max(0, r) / 255, GAMMA);
    d[i + 1] = 255 * Math.pow(Math.max(0, g) / 255, GAMMA);
    d[i + 2] = 255 * Math.pow(Math.max(0, b) / 255, GAMMA);
  }
}

/** Repeat a tile's outermost pixels outward across its gutter, so a mipmap
 *  level averages the tile against ITSELF instead of against its neighbour.
 *  The horizontal pass runs first and the vertical pass then spans the full
 *  padded width, which fills the four corners for free. */
function extrudeCell(
  ctx: CanvasRenderingContext2D, ox: number, oy: number
): void {
  const P = ATLAS_PAD, T = TILE_PX, W = T + P * 2;
  const src = ctx.canvas;
  ctx.drawImage(src, ox, oy, 1, T, ox - P, oy, P, T);               // left
  ctx.drawImage(src, ox + T - 1, oy, 1, T, ox + T, oy, P, T);       // right
  ctx.drawImage(src, ox - P, oy, W, 1, ox - P, oy - P, W, P);       // top + corners
  ctx.drawImage(src, ox - P, oy + T - 1, W, 1, ox - P, oy + T, W, P); // bottom + corners
}

/**
 * Paint every block/item tile into one mipmapped atlas.
 *
 * `maxAnisotropy` comes from the live renderer (`capabilities.getMaxAnisotropy()`).
 * Terrain is mostly viewed at a grazing angle — the ground stretching away to the
 * horizon — and that is the one case an isotropic mip chain over-blurs and then
 * aliases anyway. Anisotropic filtering is what actually settles it; passing 1
 * (the default) simply leaves the texture isotropic.
 */
export function createAtlas(seed = 1337, maxAnisotropy = 1): Atlas {
  const canvas = document.createElement('canvas');
  canvas.width = ATLAS_PX;
  canvas.height = ATLAS_PX;
  const ctx = canvas.getContext('2d')!;
  // The gutter is built by scaling 1px slices; smoothing would blend them.
  ctx.imageSmoothingEnabled = false;

  const painted: number[] = [];
  for (const tile of new Set([...Object.keys(PAINTERS), ...Object.keys(WORLDS_ART), ...Object.keys(MANOR_ART)].map(Number))) {
    const p = new Painter();
    // Worlds' redesigned tiles are painted in their final colours; only the
    // inherited VOXELON art still goes through the vibrance pass.
    const redesigned = WORLDS_ART[tile as Tile] ?? MANOR_ART[tile as Tile];
    if (redesigned) redesigned(p, seed ^ (tile * 7919));
    else { PAINTERS[tile](p, seed ^ (tile * 7919)); vibrance(p); }
    const img = new ImageData(p.data, TILE_PX, TILE_PX);
    const { x, y } = tileOrigin(tile);
    ctx.putImageData(img, x, y);
    painted.push(tile);
  }
  // Extrusion has to happen after EVERY tile is down: putImageData overwrites
  // the destination rectangle wholesale, so a gutter written first would be
  // punched back out by the neighbouring tile's art.
  for (const tile of painted) {
    const { x, y } = tileOrigin(tile);
    extrudeCell(ctx, x, y);
  }

  const texture = new THREE.CanvasTexture(canvas);
  // Crunchy up close, filtered at distance. NearestFilter magnification keeps
  // the pixel art pixel-art; the mip chain is what stops far-off terrain from
  // swimming with moire as one screen pixel starts covering many texels.
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = Math.max(1, Math.floor(maxAnisotropy));
  texture.colorSpace = THREE.SRGBColorSpace;

  const inset = 0.25; // quarter-texel inset against bleeding, in atlas pixels
  return {
    texture,
    canvas,
    uvRect(tile: Tile) {
      const { x, y } = tileOrigin(tile);
      const u0 = (x + inset) / ATLAS_PX;
      const u1 = (x + TILE_PX - inset) / ATLAS_PX;
      const v1 = 1 - (y + inset) / ATLAS_PX;
      const v0 = 1 - (y + TILE_PX - inset) / ATLAS_PX;
      return [u0, v0, u1, v1];
    },
  };
}

/** 10 progressive crack-stage textures for block breaking. */
export function createCrackTextures(seed = 555): THREE.CanvasTexture[] {
  const out: THREE.CanvasTexture[] = [];
  for (let stage = 0; stage < 10; stage++) {
    const p = new Painter();
    const rng = mulberry32(seed); // same seed: cracks grow, don't jump around
    const branches = 4;
    for (let b = 0; b < branches; b++) {
      let x = 8, y = 8;
      let dx = rng() < 0.5 ? 1 : -1;
      let dy = rng() < 0.5 ? 1 : -1;
      const steps = 2 + Math.floor((stage + 1) * 1.1);
      for (let s = 0; s < steps; s++) {
        const a = Math.floor(40 + stage * 14 + rng() * 40);
        p.set(x, y, [0, 0, 0, Math.min(a, 200)]);
        if (stage > 4 && rng() < 0.5) p.set(x + 1, y, [0, 0, 0, a >> 1]);
        if (rng() < 0.6) x += dx; else y += dy;
        if (rng() < 0.15) dx = -dx;
        if (rng() < 0.15) dy = -dy;
      }
    }
    const canvas = document.createElement('canvas');
    canvas.width = TILE_PX; canvas.height = TILE_PX;
    canvas.getContext('2d')!.putImageData(new ImageData(p.data, TILE_PX, TILE_PX), 0, 0);
    const tex = new THREE.CanvasTexture(canvas);
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    out.push(tex);
  }
  return out;
}
