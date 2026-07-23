// Procedurally drawn 16x16 pixel-art tiles in the style of classic Minecraft.
// All art is generated here from scratch — no Mojang assets.

import * as THREE from 'three';
import { Tile } from './blocks';
import { mulberry32, hash2 } from './noise';

export const TILE_PX = 16;
export const ATLAS_TILES = 16; // 16x16 grid of tiles
const ATLAS_PX = TILE_PX * ATLAS_TILES;

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

/** Per-pixel brightness jitter with 2x2 clumping, like vanilla's speckle. */
function speckle(seed: number, x: number, y: number, amount: number): number {
  const coarse = hash2(seed, x >> 1, y >> 1);
  const fine = hash2(seed ^ 0x9e37, x, y);
  return 1 - amount + (coarse * 0.65 + fine * 0.35) * amount * 2;
}

const STONE: RGBA = [125, 125, 125, 255];
const DIRT: RGBA = [134, 96, 67, 255];
const GRASS_GREEN: RGBA = [121, 192, 90, 255];
const SAND: RGBA = [219, 211, 160, 255];
const WOOD_BARK: RGBA = [103, 82, 49, 255];
const WOOD_INNER: RGBA = [174, 142, 86, 255];
const PLANKS: RGBA = [184, 148, 95, 255];
const WATER: RGBA = [53, 97, 217, 200];

function paintStone(p: Painter, seed: number): void {
  p.fill((x, y) => shade(STONE, speckle(seed, x, y, 0.12)));
}

function paintDirt(p: Painter, seed: number): void {
  p.fill((x, y) => {
    let f = speckle(seed, x, y, 0.16);
    if (hash2(seed ^ 7, x, y) > 0.88) f *= 0.78; // dark crumbs
    return shade(DIRT, f);
  });
}

// Grass top and oak leaves are painted grayscale; the mesher multiplies in
// the biome grass/foliage tint via vertex colors (like vanilla colormaps).
const TINT_GRAY: RGBA = [210, 210, 210, 255];

function paintGrassTop(p: Painter, seed: number): void {
  p.fill((x, y) => shade(TINT_GRAY, speckle(seed, x, y, 0.15)));
}

function paintGrassSide(p: Painter, seed: number): void {
  paintDirt(p, seed);
  // Green fringe on top with a ragged 2-4px edge, like vanilla.
  for (let x = 0; x < TILE_PX; x++) {
    const depth = 2 + Math.floor(hash2(seed ^ 31, x, 0) * 3);
    for (let y = 0; y < depth; y++) {
      p.set(x, y, shade(GRASS_GREEN, speckle(seed ^ 5, x, y, 0.15) * 0.92));
    }
  }
}

function paintSand(p: Painter, seed: number): void {
  p.fill((x, y) => shade(SAND, speckle(seed, x, y, 0.09)));
}

function paintCobblestone(p: Painter, seed: number): void {
  // Stones separated by dark mortar lines.
  p.fill((x, y) => {
    const cx = Math.floor(x / 5.3), cy = Math.floor(y / 5.3);
    const jx = x % 5.3, jy = y % 5.3;
    const edge = jx < 1 || jy < 1;
    const stoneShade = 0.85 + hash2(seed, cx, cy) * 0.3;
    let f = stoneShade * speckle(seed ^ 13, x, y, 0.08);
    if (edge) f *= 0.55;
    return shade(STONE, f);
  });
}

function paintLogSide(p: Painter, seed: number): void {
  // Vertical bark streaks.
  p.fill((x, y) => {
    const streak = hash2(seed, x, Math.floor(y / 4));
    let f = 0.85 + streak * 0.35;
    f *= speckle(seed ^ 3, x, y, 0.08);
    return shade(WOOD_BARK, f);
  });
}

function paintLogTop(p: Painter, seed: number): void {
  // Bark border + concentric rings.
  p.fill((x, y) => {
    const border = x < 1 || y < 1 || x > 14 || y > 14;
    if (border) return shade(WOOD_BARK, speckle(seed, x, y, 0.1));
    const d = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
    const ring = Math.floor(d) % 2 === 0 ? 1.0 : 0.82;
    return shade(WOOD_INNER, ring * speckle(seed ^ 9, x, y, 0.06));
  });
}

function paintPlanks(p: Painter, seed: number): void {
  p.fill((x, y) => {
    const row = Math.floor(y / 4);
    let f = 0.95 + hash2(seed, 0, row) * 0.1;
    f *= speckle(seed ^ row, x, y >> 1, 0.08);
    if (y % 4 === 3) f *= 0.6; // horizontal seams
    // staggered vertical seams
    const seamX = (row % 2 === 0) ? 7 : 12;
    if (x === seamX && y % 4 !== 3) f *= 0.65;
    return shade(PLANKS, f);
  });
}

// Birch + spruce planks reuse the oak plank pattern with their own wood tones.
const BIRCH_PLANKS: RGBA = [216, 198, 150, 255];
const SPRUCE_PLANKS: RGBA = [110, 80, 48, 255];
function paintPlanksColored(p: Painter, seed: number, base: RGBA): void {
  p.fill((x, y) => {
    const row = Math.floor(y / 4);
    let f = 0.95 + hash2(seed, 0, row) * 0.1;
    f *= speckle(seed ^ row, x, y >> 1, 0.08);
    if (y % 4 === 3) f *= 0.6;
    const seamX = (row % 2 === 0) ? 7 : 12;
    if (x === seamX && y % 4 !== 3) f *= 0.65;
    return shade(base, f);
  });
}
function paintBirchPlanks(p: Painter, seed: number): void {
  paintPlanksColored(p, seed, BIRCH_PLANKS);
}
function paintSprucePlanks(p: Painter, seed: number): void {
  paintPlanksColored(p, seed, SPRUCE_PLANKS);
}

function paintLeaves(p: Painter, seed: number): void {
  // Grayscale; tinted by the biome foliage color at mesh time.
  p.fill((x, y) => {
    if (hash2(seed, x, y) > 0.8) return [0, 0, 0, 0]; // cutout holes
    const f = 0.65 + hash2(seed ^ 21, x, y) * 0.55;
    return shade(TINT_GRAY, f);
  });
}

function paintColoredLeaves(base: RGBA) {
  return (p: Painter, seed: number): void => {
    p.fill((x, y) => {
      if (hash2(seed, x, y) > 0.8) return [0, 0, 0, 0];
      const f = 0.65 + hash2(seed ^ 21, x, y) * 0.55;
      return shade(base, f);
    });
  };
}

function paintGlass(p: Painter, seed: number): void {
  p.fill((x, y) => {
    const border = x === 0 || y === 0 || x === 15 || y === 15;
    if (border) return [200, 230, 235, 255];
    // a couple of diagonal glints
    if ((x + y === 6 || x + y === 7) && x < 7) return [255, 255, 255, 255];
    if (x - y === 4 && x > 8) return [225, 245, 250, 255];
    void seed;
    return [0, 0, 0, 0];
  });
}

function paintWater(p: Painter, seed: number): void {
  p.fill((x, y) => {
    const f = 0.9 + hash2(seed, x, y >> 1) * 0.2;
    return [WATER[0] * f, WATER[1] * f, WATER[2] * f, WATER[3]];
  });
}

function paintBedrock(p: Painter, seed: number): void {
  p.fill((x, y) => {
    const f = hash2(seed, x >> 1, y >> 1) > 0.5 ? 0.45 : 1.0;
    return shade(STONE, f * speckle(seed ^ 2, x, y, 0.15) * 0.6);
  });
}

// --- M1/M2 tiles -----------------------------------------------------------

const SNOW: RGBA = [240, 244, 250, 255];
const BIRCH_BARK: RGBA = [216, 213, 203, 255];
const SPRUCE_BARK: RGBA = [62, 44, 24, 255];
const CACTUS: RGBA = [62, 124, 40, 255];

function paintSandstone(p: Painter, seed: number): void {
  p.fill((x, y) => {
    let f = speckle(seed, x, y >> 1, 0.07);
    if (y < 2 || y > 13) f *= 0.85; // top/bottom banding
    if (y === 7 || y === 8) f *= 0.92;
    return shade(SAND, f * 0.96);
  });
}

function paintSandstoneTop(p: Painter, seed: number): void {
  p.fill((x, y) => shade(SAND, speckle(seed, x, y, 0.05) * 0.98));
}

function paintSnow(p: Painter, seed: number): void {
  p.fill((x, y) => shade(SNOW, speckle(seed, x, y, 0.04)));
}

function paintSnowySide(p: Painter, seed: number): void {
  paintDirt(p, seed);
  for (let x = 0; x < TILE_PX; x++) {
    const depth = 2 + Math.floor(hash2(seed ^ 77, x, 0) * 3);
    for (let y = 0; y < depth; y++) {
      p.set(x, y, shade(SNOW, speckle(seed ^ 5, x, y, 0.05)));
    }
  }
}

function paintBirchLogSide(p: Painter, seed: number): void {
  p.fill((x, y) => {
    // pale bark with black horizontal dashes
    const dash =
      hash2(seed, x >> 2, y >> 1) > 0.82 && y % 4 < 2 && (x + y) % 3 !== 0;
    if (dash) return [40, 40, 38, 255];
    return shade(BIRCH_BARK, speckle(seed ^ 3, x, y, 0.06));
  });
}

function paintBirchLogTop(p: Painter, seed: number): void {
  p.fill((x, y) => {
    const border = x < 1 || y < 1 || x > 14 || y > 14;
    if (border) return shade(BIRCH_BARK, speckle(seed, x, y, 0.06));
    const d = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
    const ring = Math.floor(d) % 2 === 0 ? 1.0 : 0.84;
    return shade([212, 196, 160, 255], ring * speckle(seed ^ 9, x, y, 0.05));
  });
}

function paintSpruceLogSide(p: Painter, seed: number): void {
  p.fill((x, y) => {
    const streak = hash2(seed, x, Math.floor(y / 5));
    return shade(SPRUCE_BARK, (0.8 + streak * 0.4) * speckle(seed ^ 3, x, y, 0.1));
  });
}

function paintSpruceLogTop(p: Painter, seed: number): void {
  p.fill((x, y) => {
    const border = x < 1 || y < 1 || x > 14 || y > 14;
    if (border) return shade(SPRUCE_BARK, speckle(seed, x, y, 0.08));
    const d = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
    const ring = Math.floor(d) % 2 === 0 ? 1.0 : 0.8;
    return shade([130, 100, 60, 255], ring * speckle(seed ^ 9, x, y, 0.06));
  });
}

function paintCactusSide(p: Painter, seed: number): void {
  p.fill((x, y) => {
    let f = speckle(seed, x, y, 0.08);
    if (x % 4 === 1) f *= 0.78; // vertical ribs
    if (x % 4 === 3 && hash2(seed ^ 4, x, y) > 0.7) return [228, 234, 200, 255]; // spines
    return shade(CACTUS, f);
  });
}

function paintCactusTop(p: Painter, seed: number): void {
  p.fill((x, y) => {
    const border = x < 1 || y < 1 || x > 14 || y > 14;
    const f = speckle(seed, x, y, 0.07) * (border ? 0.8 : 1);
    if (!border && (x === 7 || x === 8) && (y === 7 || y === 8)) {
      return shade([150, 190, 110, 255], f);
    }
    return shade(CACTUS, f * 1.08);
  });
}

/** Grayscale grass blades (tinted at mesh time). */
function paintTallGrass(p: Painter, seed: number): void {
  for (let b = 0; b < 9; b++) {
    let x = 1 + Math.floor(hash2(seed, b, 0) * 14);
    const height = 6 + Math.floor(hash2(seed, b, 1) * 9);
    for (let i = 0; i < height; i++) {
      const y = 15 - i;
      const g = 165 + Math.floor(hash2(seed ^ b, x, y) * 70);
      p.set(x, y, [g, g, g, 255]);
      if (i > 3 && hash2(seed ^ 9, b, i) > 0.6) x += hash2(seed, b, i) > 0.5 ? 1 : -1;
    }
  }
}

function paintDeadBush(p: Painter, seed: number): void {
  const twig = (x: number, y: number, dx: number, len: number) => {
    for (let i = 0; i < len; i++) {
      p.set(x, y, shade([148, 100, 40, 255], 0.75 + hash2(seed, x, y) * 0.4));
      y--;
      if (i > 1 && hash2(seed ^ 7, x, i) > 0.5) x += dx;
    }
  };
  twig(7, 15, 0, 6);
  twig(7, 14, -1, 7);
  twig(8, 15, 1, 7);
  twig(8, 13, 1, 5);
  twig(7, 12, -1, 4);
}

function paintFlower(petal: RGBA, center: RGBA | null) {
  return (p: Painter, seed: number): void => {
    // stem
    for (let y = 8; y <= 15; y++) {
      const x = 7 + (y % 2 === 0 && y > 10 ? 1 : 0);
      p.set(x, y, shade([58, 120, 40, 255], 0.8 + hash2(seed, x, y) * 0.3));
    }
    p.set(5, 11, [58, 120, 40, 255]); // leaf
    p.set(6, 10, [58, 120, 40, 255]);
    // bloom
    for (let y = 3; y <= 7; y++) {
      for (let x = 5; x <= 9; x++) {
        const d = Math.abs(x - 7) + Math.abs(y - 5);
        if (d <= 2) p.set(x, y, shade(petal, 0.85 + hash2(seed, x, y) * 0.3));
      }
    }
    if (center) p.set(7, 5, center);
  };
}

function paintTorch(p: Painter, seed: number): void {
  // 2px wooden stick, glowing tip (pixels 7-8 wide, rows 6-15).
  for (let y = 8; y <= 15; y++) {
    for (const x of [7, 8]) {
      p.set(x, y, shade([110, 84, 48, 255], 0.85 + hash2(seed, x, y) * 0.3));
    }
  }
  p.set(7, 6, [255, 240, 160, 255]);
  p.set(8, 6, [255, 220, 120, 255]);
  p.set(7, 7, [255, 200, 80, 255]);
  p.set(8, 7, [240, 170, 50, 255]);
}

function paintStick(p: Painter, seed: number): void {
  for (let i = 0; i < 11; i++) {
    const x = 3 + i, y = 13 - i;
    p.set(x, y, shade([137, 103, 57, 255], 0.85 + hash2(seed, x, y) * 0.3));
    p.set(x + 1, y, shade([110, 82, 45, 255], 0.85 + hash2(seed, y, x) * 0.3));
  }
}

function paintCoalItem(p: Painter, seed: number): void {
  for (let y = 4; y <= 12; y++) {
    for (let x = 4; x <= 12; x++) {
      const d = Math.abs(x - 8) + Math.abs(y - 8);
      if (d > 6 || hash2(seed, x, y) > 0.92) continue;
      const f = 0.7 + hash2(seed ^ 3, x, y) * 0.7;
      p.set(x, y, [38 * f, 38 * f, 40 * f, 255]);
    }
  }
}

function paintIngot(base: RGBA) {
  return (p: Painter, seed: number): void => {
    // simple ingot silhouette: trapezoid with a highlight
    for (let y = 6; y <= 12; y++) {
      const inset = Math.floor((12 - y) / 3);
      for (let x = 2 + inset; x <= 13 - inset; x++) {
        let f = 0.85 + hash2(seed, x, y) * 0.25;
        if (y === 6 || x === 2 + inset) f *= 1.2; // top/left shine
        if (y === 12) f *= 0.7;
        p.set(x, y, shade(base, Math.min(1.3, f)));
      }
    }
  };
}

function paintApple(p: Painter, seed: number): void {
  for (let y = 5; y <= 13; y++) {
    for (let x = 4; x <= 11; x++) {
      const dx = x - 7.5, dy = y - 9;
      if (dx * dx + dy * dy > 16) continue;
      const f = 0.8 + hash2(seed, x, y) * 0.35;
      p.set(x, y, shade([196, 30, 30, 255], f));
    }
  }
  p.set(7, 4, [90, 60, 30, 255]); // stem
  p.set(8, 3, [90, 60, 30, 255]);
  p.set(9, 4, [80, 140, 40, 255]); // leaf
  p.set(5, 7, [255, 160, 160, 255]); // highlight
}

function paintMeat(raw: boolean, fat: boolean) {
  return (p: Painter, seed: number): void => {
    const meat: RGBA = raw ? [228, 100, 100, 255] : [150, 90, 50, 255];
    const rim: RGBA = raw ? [240, 200, 190, 255] : [100, 60, 35, 255];
    for (let y = 4; y <= 13; y++) {
      for (let x = 3; x <= 12; x++) {
        const dx = x - 7.5, dy = y - 8.5;
        if (dx * dx * 0.8 + dy * dy > 18) continue;
        const edge = dx * dx * 0.8 + dy * dy > 12;
        const f = 0.85 + hash2(seed, x, y) * 0.3;
        p.set(x, y, shade(edge && fat ? rim : meat, f));
      }
    }
  };
}

function paintRedstoneDust(p: Painter, seed: number): void {
  const base: RGBA = [196, 26, 18, 255];
  // A rounded heap of powder: lit toward the top, darker and granular at the
  // base, with a few bright glints — reads as a pile of red dust.
  for (let y = 3; y <= 13; y++) {
    for (let x = 3; x <= 12; x++) {
      const dx = (x - 7.5) / 5.2;
      const dy = (y - 9) / 5.2;
      if (dx * dx + dy * dy > 1) continue;
      const grad = 1.1 - (y - 3) * 0.04;                 // top-lit gradient
      let f = grad * (0.78 + hash2(seed ^ 0x3, x, y) * 0.38);
      if (hash2(seed ^ 0x7, x, y) > 0.85) f *= 0.55;     // dark grains
      p.set(x, y, shade(base, Math.min(1.25, f)));
    }
  }
  for (const [gx, gy] of [[6, 6], [9, 7], [7, 9], [10, 10], [5, 8]]) {
    p.set(gx, gy, [255, 116, 92, 255]);                  // glints
  }
  // a couple of stray specks for a powdery feel
  for (let i = 0; i < 5; i++) {
    const x = 2 + Math.floor(hash2(seed ^ 0x21, i, 0) * 12);
    const y = 11 + Math.floor(hash2(seed ^ 0x22, i, 1) * 3);
    p.set(x, y, shade(base, 0.6 + hash2(seed, x, y) * 0.3));
  }
}

function paintDiamondItem(p: Painter, seed: number): void {
  for (let y = 4; y <= 12; y++) {
    for (let x = 3; x <= 12; x++) {
      const dx = Math.abs(x - 7.5), dy = y - 4;
      const inTop = y <= 7 && dx <= 4 - (7 - y);
      const inBottom = y > 7 && dx <= 4.5 - dy * 0.55;
      if (!inTop && !inBottom) continue;
      let f = 0.8 + hash2(seed, x, y) * 0.35;
      if (y <= 5 || dx < 1) f *= 1.15;
      p.set(x, y, shade([93, 236, 245, 255], Math.min(1.25, f)));
    }
  }
}

function paintCraftingTableTop(p: Painter, seed: number): void {
  paintPlanks(p, seed);
  // dark frame + 2x2 grid lines, like vanilla's top
  for (let i = 0; i < TILE_PX; i++) {
    for (const [x, y] of [[i, 0], [i, 15], [0, i], [15, i], [i, 7], [7, i]]) {
      p.set(x, y, shade([92, 68, 40, 255], 0.9 + hash2(seed, x, y) * 0.2));
    }
  }
}

function paintCraftingTableSide(p: Painter, seed: number): void {
  paintPlanks(p, seed);
  for (let x = 0; x < TILE_PX; x++) p.set(x, 0, [92, 68, 40, 255]);
  // a saw and hammer-ish dark silhouettes
  for (const [x, y] of [
    [3, 5], [4, 5], [5, 5], [4, 6], [4, 7], [4, 8],
    [10, 4], [11, 4], [10, 5], [11, 5], [11, 6], [11, 7], [11, 8],
  ]) p.set(x, y, [70, 50, 30, 255]);
}

function paintFurnaceSide(p: Painter, seed: number): void {
  p.fill((x, y) => {
    const cx = Math.floor(x / 5.3), cy = Math.floor(y / 5.3);
    const edge = x % 5.3 < 1 || y % 5.3 < 1;
    let f = (0.9 + hash2(seed, cx, cy) * 0.2) * speckle(seed ^ 13, x, y, 0.07);
    if (edge) f *= 0.62;
    return shade(STONE, f * 0.92);
  });
}

function paintFurnaceFront(lit: boolean) {
  return (p: Painter, seed: number): void => {
    paintFurnaceSide(p, seed);
    // opening: dark mouth in the lower middle
    for (let y = 8; y <= 14; y++) {
      for (let x = 4; x <= 11; x++) {
        if (!lit) {
          p.set(x, y, [22, 22, 22, 255]);
        } else {
          const flame = 14 - y + Math.floor(hash2(seed, x, y) * 3);
          const c: RGBA = flame > 4 ? [40, 30, 25, 255]
            : flame > 2 ? [232, 120, 30, 255]
            : [255, 215, 90, 255];
          p.set(x, y, c);
        }
      }
    }
  };
}

const STICK_COLOR: RGBA = [137, 103, 57, 255];

function paintToolSprite(
  type: 'pickaxe' | 'axe' | 'shovel' | 'sword', material: RGBA
) {
  return (p: Painter, seed: number): void => {
    const mat = (x: number, y: number, f = 1) =>
      p.set(x, y, shade(material, f * (0.9 + hash2(seed, x, y) * 0.2)));
    const stick = (x: number, y: number, f = 1) =>
      p.set(x, y, shade(STICK_COLOR, f * (0.85 + hash2(seed, x, y) * 0.3)));

    if (type === 'sword') {
      for (let i = 0; i < 9; i++) {
        mat(5 + i, 10 - i);
        mat(6 + i, 10 - i, 0.8);
      }
      mat(14, 1); // tip
      p.set(4, 10, [70, 50, 30, 255]); // guard
      p.set(5, 11, [70, 50, 30, 255]);
      p.set(3, 11, [70, 50, 30, 255]);
      stick(2, 13); stick(3, 12); stick(2, 12);
      outlineSprite(p);
      return;
    }
    // Wooden handle: a 2px diagonal running bottom-left -> upper-right, with a
    // darker lower edge for a bit of round.
    for (let i = 0; i < 9; i++) {
      const x = 3 + i, y = 13 - i;
      stick(x, y);
      stick(x + 1, y, 0.78);
    }
    // `m` paints a metal head pixel with directional shading: upper-left bright
    // (highlight), lower-right dim (shadow), so the head reads as a solid tool.
    const m = (x: number, y: number) => mat(x, y, 1.06 - (x + y) * 0.018);
    if (type === 'pickaxe') {
      // A wide arched head bridging two drooping tips over the handle top.
      for (const x of [8, 9, 10, 11, 12]) m(x, 3);       // crown bar
      m(7, 4); m(13, 4);                                  // shoulders
      m(6, 5); m(14, 5);                                  // tips
      m(10, 4); m(11, 5);                                 // join down to handle
    } else if (type === 'axe') {
      // A bit-blade hanging off the left of the handle top; left column is the
      // bright cutting edge.
      for (const [x, y] of [
        [9, 2], [10, 2],
        [7, 3], [8, 3], [9, 3], [10, 3],
        [6, 4], [7, 4], [8, 4], [9, 4], [10, 4],
        [6, 5], [7, 5], [8, 5], [9, 5], [10, 5],
        [7, 6], [8, 6], [9, 6], [10, 6],
        [9, 7], [10, 7],
      ] as [number, number][]) m(x, y);
      for (const y of [4, 5]) mat(6, y, 1.25); // bright cutting edge
    } else { // shovel
      // A rounded spade scoop centred over the handle top.
      for (const [x, y] of [
        [9, 2], [10, 2],
        [8, 3], [9, 3], [10, 3], [11, 3],
        [8, 4], [9, 4], [10, 4], [11, 4],
        [8, 5], [9, 5], [10, 5], [11, 5],
        [9, 6], [10, 6],
      ] as [number, number][]) m(x, y);
    }
    outlineSprite(p); // crisp dark edge around handle + head
  };
}

const TOOL_WOOD: RGBA = [171, 140, 91, 255];
const TOOL_STONE: RGBA = [150, 150, 150, 255];
const TOOL_IRON: RGBA = [222, 222, 222, 255];

// --- M7: mob drops + skins ---------------------------------------------------

function paintWool(p: Painter, seed: number): void {
  p.fill((x, y) => {
    const f = speckle(seed, x, y, 0.07) * (hash2(seed ^ 2, x >> 1, y >> 1) > 0.85 ? 0.9 : 1);
    return shade([233, 233, 233, 255], f);
  });
}

function paintChickenMeat(raw: boolean) {
  return (p: Painter, seed: number): void => {
    const meat: RGBA = raw ? [236, 178, 170, 255] : [200, 138, 64, 255];
    for (let y = 5; y <= 13; y++) {
      for (let x = 4; x <= 11; x++) {
        const dx = x - 7.5, dy = y - 9;
        if (dx * dx + dy * dy * 0.9 > 14) continue;
        p.set(x, y, shade(meat, 0.85 + hash2(seed, x, y) * 0.3));
      }
    }
    p.set(5, 4, [228, 220, 200, 255]); // drumstick bone
    p.set(6, 4, [228, 220, 200, 255]);
  };
}

function paintFeather(p: Painter, seed: number): void {
  for (let i = 0; i < 10; i++) {
    const x = 4 + i, y = 13 - i;
    p.set(x, y, shade([240, 240, 240, 255], 0.85 + hash2(seed, x, y) * 0.2));
    if (i > 1 && i < 9) {
      p.set(x - 1, y, shade([225, 225, 230, 255], 0.85 + hash2(seed, y, x) * 0.2));
      p.set(x, y + 1, shade([210, 210, 218, 255], 0.9));
    }
  }
}

/** Plain noisy skin tile for a mob body part. */
function paintSkin(base: RGBA, amount = 0.12, patches?: RGBA) {
  return (p: Painter, seed: number): void => {
    p.fill((x, y) => {
      if (patches && hash2(seed ^ 0x9a, x >> 2, y >> 2) > 0.72) {
        return shade(patches, speckle(seed, x, y, amount));
      }
      return shade(base, speckle(seed, x, y, amount));
    });
  };
}

/** Skin + simple pixel face (eyes and an optional snout/beak block). */
function paintFace(
  base: RGBA,
  eyes: RGBA,
  snout: { color: RGBA; x0: number; y0: number; x1: number; y1: number } | null,
  eyeY = 5
) {
  return (p: Painter, seed: number): void => {
    paintSkin(base)(p, seed);
    for (const ex of [3, 4, 10, 11]) p.set(ex, eyeY, eyes);
    for (const ex of [3, 4, 10, 11]) p.set(ex, eyeY + 1, eyes);
    if (snout) {
      for (let y = snout.y0; y <= snout.y1; y++) {
        for (let x = snout.x0; x <= snout.x1; x++) {
          p.set(x, y, shade(snout.color, 0.9 + hash2(seed, x, y) * 0.2));
        }
      }
    }
  };
}

function paintCreeperFace(p: Painter, seed: number): void {
  paintSkin([88, 168, 80, 255], 0.22)(p, seed);
  const dark: RGBA = [20, 30, 20, 255];
  // the iconic face
  for (const [x, y] of [
    [3, 4], [4, 4], [3, 5], [4, 5], [11, 4], [12, 4], [11, 5], [12, 5], // eyes
    [6, 6], [7, 6], [8, 6], [9, 6],
    [5, 7], [6, 7], [7, 7], [8, 7], [9, 7], [10, 7],
    [5, 8], [6, 8], [9, 8], [10, 8],
    [5, 9], [10, 9],
  ]) p.set(x, y, dark);
  for (const [x, y] of [[6, 8], [9, 8]]) p.set(x, y, dark);
}

const CHEST_WOOD: RGBA = [156, 110, 58, 255];
const CHEST_FRAME: RGBA = [96, 64, 32, 255];
const CHEST_LATCH: RGBA = [70, 64, 58, 255];

function paintChestTop(p: Painter, seed: number): void {
  p.fill((x, y) => {
    const border = x === 0 || y === 0 || x === 15 || y === 15;
    const f = speckle(seed, x, y >> 1, 0.08);
    return shade(border ? CHEST_FRAME : CHEST_WOOD, f);
  });
}

function paintChestFace(front: boolean) {
  return (p: Painter, seed: number): void => {
    p.fill((x, y) => {
      const border = x === 0 || y === 0 || x === 15 || y === 15;
      const lidLine = y === 5; // seam between lid and body
      let c = border ? CHEST_FRAME : CHEST_WOOD;
      if (lidLine) c = CHEST_FRAME;
      return shade(c, speckle(seed, x, y >> 1, 0.08));
    });
    if (front) {
      // metal latch in the centre, straddling the lid seam.
      for (let y = 4; y <= 8; y++) {
        for (let x = 7; x <= 9; x++) p.set(x, y, CHEST_LATCH);
      }
      p.set(8, 9, [40, 36, 32, 255]); // keyhole
    }
  };
}

function paintCharcoal(p: Painter, seed: number): void {
  for (let y = 4; y <= 12; y++) {
    for (let x = 4; x <= 12; x++) {
      const d = Math.abs(x - 8) + Math.abs(y - 8);
      if (d > 6 || hash2(seed, x, y) > 0.92) continue;
      const f = 0.7 + hash2(seed ^ 3, x, y) * 0.7;
      p.set(x, y, [52 * f, 38 * f, 28 * f, 255]);
    }
  }
}

function paintOre(spotColor: RGBA, spotColor2: RGBA) {
  return (p: Painter, seed: number): void => {
    paintStone(p, seed);
    for (let c = 0; c < 5; c++) {
      const cx = 2 + Math.floor(hash2(seed ^ 0xa1, c, 0) * 12);
      const cy = 2 + Math.floor(hash2(seed ^ 0xa2, c, 1) * 12);
      for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1], [-1, 0], [0, -1]]) {
        if (hash2(seed ^ c, dx + 2, dy + 2) > 0.72) continue;
        const dark = hash2(seed ^ 0xa3, cx + dx, cy + dy) > 0.5;
        p.set(cx + dx, cy + dy, dark ? spotColor2 : spotColor);
      }
    }
  };
}

// --- Armor + guns (parked features) ----------------------------------------

const ARMOR_WOOD: RGBA = [158, 118, 66, 255];
const ARMOR_STONE: RGBA = [130, 132, 138, 255];
const ARMOR_IRON: RGBA = [200, 200, 205, 255];
const ARMOR_DIAMOND: RGBA = [120, 222, 224, 255];
const ARMOR_TITAN: RGBA = [180, 196, 220, 255];

function paintArmorPiece(slot: 'helmet' | 'chestplate' | 'leggings' | 'boots', base: RGBA) {
  return (p: Painter, seed: number): void => {
    const put = (x: number, y: number, f = 1) =>
      p.set(x, y, shade(base, f * (0.84 + hash2(seed, x, y) * 0.24)));
    const region = (rows: [number, number, number][]) => {
      for (const [y, x0, x1] of rows) for (let x = x0; x <= x1; x++) put(x, y);
    };
    const clear = (rows: [number, number, number][]) => {
      for (const [y, x0, x1] of rows) for (let x = x0; x <= x1; x++) p.set(x, y, [0, 0, 0, 0]);
    };
    if (slot === 'helmet') {
      region([[3, 5, 10], [4, 4, 11], [5, 3, 12], [6, 3, 12], [7, 3, 12], [8, 3, 12], [9, 4, 11]]);
      clear([[6, 5, 10], [7, 5, 10], [8, 6, 9]]); // visor opening
    } else if (slot === 'chestplate') {
      region([
        [3, 4, 5], [3, 10, 11],
        [4, 3, 12], [5, 3, 12], [6, 3, 12], [7, 3, 12],
        [8, 4, 11], [9, 4, 11], [10, 5, 10], [11, 5, 10], [12, 5, 10],
      ]);
    } else if (slot === 'leggings') {
      region([
        [3, 4, 11], [4, 4, 11], [5, 4, 11],
        [6, 4, 6], [6, 9, 11], [7, 4, 6], [7, 9, 11], [8, 4, 6], [8, 9, 11],
        [9, 4, 6], [9, 9, 11], [10, 4, 6], [10, 9, 11], [11, 5, 6], [11, 9, 10],
      ]);
    } else {
      region([
        [9, 3, 6], [9, 9, 12], [10, 3, 6], [10, 9, 12],
        [11, 2, 7], [11, 9, 13], [12, 2, 7], [12, 9, 13],
      ]);
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

function paintPistol(p: Painter, seed: number): void {
  const j = (c: RGBA, x: number, y: number): RGBA => shade(c, 0.9 + hash2(seed, x, y) * 0.18);
  // Slide + barrel: 3px tall with a bright top edge for a metallic read.
  for (let x = 4; x <= 12; x++) {
    p.set(x, 5, j(GUN_METAL_HI, x, 5));
    p.set(x, 6, j(GUN_METAL, x, 6));
    p.set(x, 7, j(GUN_METAL, x, 7));
  }
  p.set(12, 6, [12, 12, 16, 255]); // muzzle bore
  // Frame + trigger guard.
  p.set(6, 8, j(GUN_METAL, 6, 8)); p.set(7, 8, j(GUN_METAL, 7, 8)); p.set(8, 8, j(GUN_DARK, 8, 8));
  p.set(8, 9, j(GUN_DARK, 8, 9)); // trigger
  // Grip.
  for (let y = 8; y <= 12; y++) { p.set(5, y, j(GUN_GRIP_HI, 5, y)); p.set(6, y, j(GUN_GRIP, 6, y)); }
  outlineSprite(p);
}

function paintRifle(p: Painter, seed: number): void {
  const j = (c: RGBA, x: number, y: number): RGBA => shade(c, 0.9 + hash2(seed, x, y) * 0.18);
  // Long barrel.
  for (let x = 2; x <= 14; x++) { p.set(x, 6, j(GUN_METAL_HI, x, 6)); p.set(x, 7, j(GUN_METAL, x, 7)); }
  p.set(14, 6, [12, 12, 16, 255]); // muzzle
  // Receiver.
  for (let x = 4; x <= 10; x++) p.set(x, 8, j(GUN_DARK, x, 8));
  // Stock (rear).
  p.set(2, 8, j(GUN_GRIP_HI, 2, 8)); p.set(3, 8, j(GUN_GRIP, 3, 8)); p.set(2, 9, j(GUN_GRIP, 2, 9));
  // Pistol grip + curved magazine.
  p.set(6, 9, j(GUN_GRIP, 6, 9)); p.set(6, 10, j(GUN_GRIP, 6, 10));
  for (let y = 9; y <= 12; y++) { p.set(8, y, j(GUN_DARK, 8, y)); p.set(9, y, j(GUN_DARK, 9, y)); }
  outlineSprite(p);
}

function paintRocketLauncher(p: Painter, seed: number): void {
  const j = (c: RGBA, x: number, y: number): RGBA => shade(c, 0.9 + hash2(seed, x, y) * 0.18);
  // Thick launch tube.
  for (let y = 5; y <= 8; y++)
    for (let x = 2; x <= 14; x++)
      p.set(x, y, j(y === 5 ? GUN_METAL_HI : y < 8 ? GUN_METAL : GUN_DARK, x, y));
  for (let y = 5; y <= 8; y++) { p.set(2, y, [12, 12, 16, 255]); p.set(14, y, GUN_DARK); } // vent/muzzle
  p.set(9, 4, GUN_DARK); p.set(10, 4, GUN_DARK);                          // sight
  for (let y = 9; y <= 12; y++) { p.set(6, y, j(GUN_GRIP_HI, 6, y)); p.set(7, y, j(GUN_GRIP, 7, y)); } // grip
  outlineSprite(p);
}

function paintShotgun(p: Painter, seed: number): void {
  const j = (c: RGBA, x: number, y: number): RGBA => shade(c, 0.9 + hash2(seed, x, y) * 0.18);
  const wood: RGBA = [120, 78, 40, 255], woodHi: RGBA = [150, 102, 56, 255];
  // Double stacked barrels (the shotgun's tell).
  for (let x = 3; x <= 13; x++) { p.set(x, 5, j(GUN_METAL_HI, x, 5)); p.set(x, 6, j(GUN_METAL, x, 6)); }
  for (let x = 3; x <= 13; x++) { p.set(x, 7, j(GUN_METAL, x, 7)); p.set(x, 8, j(GUN_DARK, x, 8)); }
  p.set(13, 5, [12, 12, 16, 255]); p.set(13, 7, [12, 12, 16, 255]); // twin bores
  // Wooden fore-grip + stock.
  for (let y = 9; y <= 11; y++) { p.set(5, y, j(woodHi, 5, y)); p.set(6, y, j(wood, 6, y)); }
  p.set(3, 9, j(woodHi, 3, 9)); p.set(2, 9, j(wood, 2, 9)); p.set(3, 10, j(wood, 3, 10));
  p.set(8, 9, j(GUN_DARK, 8, 9)); // trigger
  outlineSprite(p);
}

function paintSMG(p: Painter, seed: number): void {
  const j = (c: RGBA, x: number, y: number): RGBA => shade(c, 0.9 + hash2(seed, x, y) * 0.18);
  // Short stubby barrel + boxy receiver.
  for (let x = 7; x <= 13; x++) { p.set(x, 6, j(GUN_METAL_HI, x, 6)); p.set(x, 7, j(GUN_METAL, x, 7)); }
  p.set(13, 6, [12, 12, 16, 255]); // muzzle
  for (let y = 6; y <= 9; y++) for (let x = 4; x <= 7; x++) p.set(x, y, j(GUN_DARK, x, y));
  p.set(9, 5, j(GUN_DARK, 9, 5)); p.set(10, 5, j(GUN_DARK, 10, 5)); // top rail
  // Long straight magazine + grip.
  for (let y = 9; y <= 13; y++) { p.set(6, y, j(GUN_GRIP, 6, y)); p.set(7, y, j(GUN_GRIP_HI, 7, y)); }
  outlineSprite(p);
}

function paintSniper(p: Painter, seed: number): void {
  const j = (c: RGBA, x: number, y: number): RGBA => shade(c, 0.9 + hash2(seed, x, y) * 0.18);
  // Very long thin barrel.
  for (let x = 1; x <= 14; x++) { p.set(x, 7, j(GUN_METAL_HI, x, 7)); p.set(x, 8, j(GUN_METAL, x, 8)); }
  p.set(14, 7, [12, 12, 16, 255]); // muzzle
  // Scope (the sniper's tell): a barrel + lens up top.
  for (let x = 6; x <= 10; x++) p.set(x, 5, j(GUN_DARK, x, 5));
  p.set(6, 5, [40, 120, 180, 255]); p.set(10, 5, [12, 12, 16, 255]); // lens / objective
  p.set(7, 6, j(GUN_DARK, 7, 6)); p.set(9, 6, j(GUN_DARK, 9, 6)); // scope mounts
  // Stock + grip.
  p.set(1, 8, j(GUN_GRIP_HI, 1, 8)); p.set(2, 8, j(GUN_GRIP, 2, 8)); p.set(1, 9, j(GUN_GRIP, 1, 9));
  for (let y = 9; y <= 12; y++) { p.set(7, y, j(GUN_GRIP, 7, y)); p.set(8, y, j(GUN_DARK, 8, y)); }
  outlineSprite(p);
}

function paintBurstRifle(p: Painter, seed: number): void {
  const j = (c: RGBA, x: number, y: number): RGBA => shade(c, 0.9 + hash2(seed, x, y) * 0.18);
  // Boxy carbine barrel.
  for (let x = 3; x <= 13; x++) { p.set(x, 6, j(GUN_METAL_HI, x, 6)); p.set(x, 7, j(GUN_METAL, x, 7)); }
  p.set(13, 6, [12, 12, 16, 255]); // muzzle
  // Carry handle / sight block on top (visual cue distinct from the auto rifle).
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

function paintRocket(p: Painter, seed: number): void {
  const body: RGBA = [196, 66, 54, 255], bodyHi: RGBA = [228, 104, 92, 255];
  const nose: RGBA = [230, 230, 234, 255], fin: RGBA = [96, 96, 104, 255];
  // Nose cone.
  p.set(7, 4, nose); p.set(8, 4, nose);
  for (let x = 6; x <= 9; x++) p.set(x, 5, nose);
  // Body with a highlight column + a white band.
  for (let y = 6; y <= 12; y++)
    for (let x = 6; x <= 9; x++)
      p.set(x, y, shade(x === 6 ? bodyHi : body, 0.9 + hash2(seed, x, y) * 0.16));
  for (let x = 6; x <= 9; x++) p.set(x, 9, shade(nose, 0.95)); // band
  // Fins + exhaust flame.
  p.set(5, 11, fin); p.set(10, 11, fin); p.set(5, 12, fin); p.set(10, 12, fin);
  p.set(7, 13, [255, 200, 90, 255]); p.set(8, 13, [255, 160, 60, 255]);
  p.set(7, 14, [255, 150, 40, 255]); p.set(8, 14, [255, 120, 30, 255]);
  outlineSprite(p);
}

function paintGlider(p: Painter, seed: number): void {
  const mem: RGBA = [152, 172, 150, 255];
  const memHi: RGBA = [196, 212, 192, 255];
  const strut: RGBA = [84, 100, 88, 255];
  const spine: RGBA = [70, 80, 72, 255];
  // Right-wing horizontal span per row (mirrored to the left wing). A swept,
  // elytra-like pair of wings flaring out from a central harness.
  const span: Record<number, [number, number]> = {
    3: [9, 10], 4: [9, 11], 5: [9, 12], 6: [9, 13], 7: [8, 14],
    8: [8, 14], 9: [9, 14], 10: [10, 13], 11: [11, 13], 12: [12, 13],
  };
  for (const yStr of Object.keys(span)) {
    const y = Number(yStr);
    const [a, b] = span[y];
    for (let x = a; x <= b; x++) {
      const base = x === a ? memHi : x === b ? strut : mem; // bright leading edge
      const jit = 0.92 + hash2(seed, x, y) * 0.12;
      p.set(x, y, shade(base, jit));          // right wing
      p.set(15 - x, y, shade(base, jit));     // mirrored left wing
    }
  }
  // Central harness/spine.
  for (let y = 3; y <= 12; y++) { p.set(7, y, spine); p.set(8, y, spine); }
  p.set(7, 4, shade(strut, 1.1)); p.set(8, 4, shade(strut, 1.1));
  outlineSprite(p);
}

// --- Automation (M13): cobalt, oil, machine blocks ------------------------

const COBALT_SPOT: RGBA = [86, 112, 196, 255];
const COBALT_SPOT2: RGBA = [54, 74, 140, 255];
const MACHINE_METAL: RGBA = [120, 124, 132, 255];
const MACHINE_FRAME: RGBA = [66, 68, 76, 255];
const MACHINE_DARK: RGBA = [40, 40, 46, 255];

function paintOilShale(p: Painter, seed: number): void {
  p.fill((x, y) => shade([54, 52, 58, 255], speckle(seed, x, y, 0.14)));
  // black tar streaks
  for (let i = 0; i < 26; i++) {
    const x = Math.floor(hash2(seed ^ 0x5, i, 0) * 16);
    const y = Math.floor(hash2(seed ^ 0x6, i, 1) * 16);
    p.set(x, y, [20, 18, 24, 255]);
    if (hash2(seed ^ 7, i, 2) > 0.6) p.set(x, (y + 1) & 15, [14, 12, 16, 255]);
  }
  p.set(4, 4, [92, 98, 122, 255]); // faint oily sheen
  p.set(5, 4, [80, 86, 110, 255]);
}

function paintOilBarrel(p: Painter, seed: number): void {
  const body: RGBA = [60, 70, 82, 255];
  const band: RGBA = [40, 48, 58, 255];
  const lid: RGBA = [92, 102, 114, 255];
  for (let y = 2; y <= 14; y++) {
    for (let x = 4; x <= 11; x++) {
      let c = body;
      if (y === 2 || y === 14) c = lid;
      else if (y === 6 || y === 10) c = band; // ribs
      const edge = x === 4 || x === 11;
      p.set(x, y, shade(c, (edge ? 0.7 : 1) * (0.85 + hash2(seed, x, y) * 0.2)));
    }
  }
  p.set(7, 8, [28, 26, 22, 255]); // oil label smudge
  p.set(8, 8, [28, 26, 22, 255]);
  p.set(8, 9, [22, 20, 16, 255]);
  p.set(5, 2, [156, 166, 176, 255]); // top highlight
}

function paintMachineFrame(p: Painter, seed: number, base: RGBA): void {
  p.fill((x, y) =>
    shade(base, (0.82 + hash2(seed, x >> 2, y >> 2) * 0.22) * speckle(seed ^ 11, x, y, 0.06)));
  for (let i = 0; i < 16; i++) {
    p.set(i, 0, MACHINE_FRAME); p.set(i, 15, MACHINE_FRAME);
    p.set(0, i, MACHINE_FRAME); p.set(15, i, MACHINE_FRAME);
  }
  for (const [x, y] of [[2, 2], [13, 2], [2, 13], [13, 13]]) p.set(x, y, MACHINE_DARK);
}

function paintAutominerSide(p: Painter, seed: number): void {
  paintMachineFrame(p, seed, MACHINE_METAL);
  // Diagonal hazard chevrons across the crown.
  for (let x = 1; x <= 14; x++) {
    for (let y = 1; y <= 2; y++) {
      p.set(x, y, ((x + y) >> 1) % 2 ? [232, 196, 44, 255] : [42, 42, 46, 255]);
    }
  }
  // Recessed dark drill bay with orange heat vents on either side.
  for (let y = 4; y <= 13; y++) {
    for (let x = 4; x <= 11; x++) p.set(x, y, shade([34, 35, 41, 255], 0.9 + hash2(seed ^ 5, x, y) * 0.2));
  }
  for (const yy of [6, 8, 10]) {
    p.set(2, yy, [246, 138, 42, 255]); p.set(13, yy, [246, 138, 42, 255]); // glowing vents
    p.set(2, yy + 1, [150, 74, 24, 255]); p.set(13, yy + 1, [150, 74, 24, 255]);
  }
  // Big chevron drill bit with alternating carbide teeth.
  const bit: RGBA = [190, 194, 202, 255];
  const bitD: RGBA = [126, 130, 140, 255];
  for (let y = 4; y <= 12; y++) {
    const w = Math.max(0, Math.floor((12 - y) / 2.4));
    for (let x = 7 - w; x <= 8 + w; x++) {
      p.set(x, y, shade((x + y) % 2 ? bit : bitD, 0.85 + hash2(seed, x, y) * 0.2));
    }
  }
  p.set(7, 13, [255, 214, 120, 255]); p.set(8, 13, [255, 190, 90, 255]); // sparks at the tip
  // Riveted side pillars.
  for (const x of [1, 14]) for (const y of [5, 8, 11]) p.set(x, y, [168, 172, 180, 255]);
  // Cobalt power cell window bottom-left.
  p.set(2, 13, [96, 140, 235, 255]); p.set(3, 13, [60, 92, 180, 255]);
}

function paintAutominerTop(p: Painter, seed: number): void {
  paintMachineFrame(p, seed, [110, 114, 122, 255]);
  // Cross-brace plating seams.
  for (let i = 1; i <= 14; i++) {
    p.set(i, 7, shade([88, 92, 100, 255], 0.95)); p.set(i, 8, shade([88, 92, 100, 255], 0.95));
    p.set(7, i, shade([88, 92, 100, 255], 0.95)); p.set(8, i, shade([88, 92, 100, 255], 0.95));
  }
  // Bolted gear ring around the bore.
  for (let a = 0; a < 24; a++) {
    const ang = (a / 24) * Math.PI * 2;
    const x = Math.round(7.5 + 4 * Math.cos(ang)), y = Math.round(7.5 + 4 * Math.sin(ang));
    p.set(x, y, a % 3 ? [58, 60, 66, 255] : [178, 182, 190, 255]); // teeth glint
  }
  // Dark bore with a hint of the spinning bit.
  for (let y = 5; y <= 10; y++) {
    for (let x = 5; x <= 10; x++) {
      const d = Math.hypot(x - 7.5, y - 7.5);
      if (d > 2.8) continue;
      p.set(x, y, d < 1.2 ? [140, 144, 152, 255] : [18, 18, 22, 255]);
    }
  }
  // Corner service bolts.
  for (const [x, y] of [[2, 2], [13, 2], [2, 13], [13, 13]]) p.set(x, y, [178, 182, 190, 255]);
}

function paintOilDerrickSide(p: Painter, seed: number): void {
  // Weathered panel behind a rust-red lattice tower (classic pumpjack paint).
  paintMachineFrame(p, seed, [88, 90, 96, 255]);
  const beam: RGBA = [148, 66, 44, 255];
  const beamD: RGBA = [96, 42, 30, 255];
  // Tapered truss legs with riveted X-bracing between them.
  for (let y = 1; y <= 13; y++) {
    const inset = Math.floor((13 - y) / 4);
    p.set(2 + inset, y, beam); p.set(3 + inset, y, beamD);
    p.set(13 - inset, y, beam); p.set(12 - inset, y, beamD);
  }
  for (const [y0, y1] of [[2, 5], [6, 9], [10, 13]] as const) {
    for (let y = y0; y <= y1; y++) {
      const t = (y - y0) / (y1 - y0);
      const inset = Math.floor((13 - (y0 + y1) / 2) / 4);
      const xl = 3 + inset, xr = 12 - inset;
      p.set(Math.round(xl + (xr - xl) * t), y, beamD); // "/" brace
      p.set(Math.round(xr - (xr - xl) * t), y, beam);  // "\" brace
    }
  }
  // Crown block platform at the top.
  for (let x = 4; x <= 11; x++) p.set(x, 1, [52, 50, 54, 255]);
  // Warning beacon.
  p.set(7, 0, [246, 90, 60, 255]); p.set(8, 0, [180, 50, 34, 255]);
  // Oil splatter pooling at the base + a green pressure gauge.
  for (let x = 3; x <= 12; x++) {
    if (hash2(seed ^ 9, x, 0) > 0.35) p.set(x, 14, [22, 20, 18, 255]);
    p.set(x, 15 - (x % 2), [16, 14, 12, 255]);
  }
  p.set(13, 12, [110, 220, 130, 255]);
}

function paintOilDerrickTop(p: Painter, seed: number): void {
  paintMachineFrame(p, seed, [88, 90, 96, 255]);
  // Bolted wellhead flange.
  for (let a = 0; a < 20; a++) {
    const ang = (a / 20) * Math.PI * 2;
    const x = Math.round(7.5 + 4.6 * Math.cos(ang)), y = Math.round(7.5 + 4.6 * Math.sin(ang));
    p.set(x, y, a % 2 ? [54, 56, 60, 255] : [172, 176, 184, 255]);
  }
  // Oil pooling inside the flange with an iridescent sheen.
  for (let y = 4; y <= 11; y++) {
    for (let x = 4; x <= 11; x++) {
      const d = Math.hypot(x - 7.5, y - 7.5);
      if (d > 3.6) continue;
      p.set(x, y, shade([20, 18, 22, 255], 0.9 + hash2(seed ^ 3, x, y) * 0.3));
    }
  }
  p.set(6, 5, [70, 88, 110, 255]); p.set(9, 9, [88, 74, 34, 255]); // sheen glints
  // Red valve wheel: rim + 4 spokes + hub.
  const red: RGBA = [206, 66, 52, 255];
  for (let a = 0; a < 16; a++) {
    const ang = (a / 16) * Math.PI * 2;
    p.set(Math.round(7.5 + 2.6 * Math.cos(ang)), Math.round(7.5 + 2.6 * Math.sin(ang)), red);
  }
  for (let k = -2; k <= 2; k++) { p.set(Math.round(7.5 + k), 7, red); p.set(8, Math.round(7.5 + k), red); }
  p.set(7, 7, [244, 120, 100, 255]); p.set(8, 8, [140, 40, 32, 255]); // hub shading
}

function paintMachinePart(p: Painter, seed: number): void {
  // Industrial girder lattice with cutout gaps so it reads as an open frame.
  p.fill(() => [0, 0, 0, 0]);
  const beam: RGBA = [88, 92, 102, 255];
  for (let i = 0; i < 16; i++) {
    p.set(2, i, shade(beam, 0.9 + hash2(seed, 2, i) * 0.2));
    p.set(13, i, shade(beam, 0.9 + hash2(seed, 13, i) * 0.2));
    p.set(i, 2, shade(beam, 0.9 + hash2(seed, i, 2) * 0.2));
    p.set(i, 13, shade(beam, 0.9 + hash2(seed, i, 13) * 0.2));
  }
  for (let i = 0; i < 16; i++) { p.set(i, i, shade(beam, 0.75)); p.set(15 - i, i, shade(beam, 0.75)); }
  for (const [x, y] of [[2, 2], [13, 2], [2, 13], [13, 13]]) p.set(x, y, [40, 42, 48, 255]);
}

// --- Warfare (M14) -----------------------------------------------------------
function paintTurretSide(p: Painter, seed: number): void {
  paintMachineFrame(p, seed, [92, 96, 104, 255]);
  // hazard band + a forward gun port
  for (let x = 1; x <= 14; x++) {
    const c: RGBA = ((x + 1) >> 1) % 2 ? [210, 60, 50, 255] : [40, 40, 44, 255];
    p.set(x, 2, c); p.set(x, 3, c);
  }
  const barrel: RGBA = [48, 50, 56, 255];
  for (let y = 7; y <= 9; y++) for (let x = 6; x <= 13; x++) p.set(x, y, shade(barrel, 0.85 + hash2(seed, x, y) * 0.25));
  for (let y = 6; y <= 10; y++) p.set(13, y, [20, 20, 22, 255]); // muzzle
}

function paintTurretTop(p: Painter, seed: number): void {
  paintMachineFrame(p, seed, [104, 108, 116, 255]);
  // a rotating cap with a barrel slot pointing one way
  for (let a = 0; a < 16; a++) {
    const ang = (a / 16) * Math.PI * 2;
    p.set(Math.round(7.5 + 4 * Math.cos(ang)), Math.round(7.5 + 4 * Math.sin(ang)), [56, 58, 64, 255]);
  }
  for (let x = 7; x <= 14; x++) { p.set(x, 7, [30, 30, 34, 255]); p.set(x, 8, [30, 30, 34, 255]); }
  p.set(7, 7, [200, 64, 52, 255]); p.set(8, 8, [200, 64, 52, 255]); // targeting dot
}

function paintCannonball(p: Painter, seed: number): void {
  const iron: RGBA = [70, 74, 82, 255];
  for (let y = 3; y <= 13; y++) {
    for (let x = 3; x <= 13; x++) {
      const dx = x - 8, dy = y - 8;
      const d = Math.hypot(dx, dy);
      if (d > 5.2) continue;
      let f = 1 - d * 0.06;
      if (dx < -1 && dy < -1 && d < 4) f += 0.35; // highlight
      p.set(x, y, shade(iron, f * (0.9 + hash2(seed, x, y) * 0.1)));
    }
  }
  p.set(5, 5, [150, 156, 166, 255]); p.set(6, 5, [130, 136, 146, 255]); // glint
}

function paintRedSand(p: Painter, seed: number): void {
  p.fill((x, y) => shade([196, 98, 54, 255], speckle(seed, x, y, 0.1)));
}

function paintTerracotta(p: Painter, seed: number): void {
  // Horizontal mineral bands (badlands strata).
  const bands: RGBA[] = [
    [176, 96, 60, 255], [150, 78, 52, 255], [200, 132, 70, 255],
    [120, 70, 56, 255], [188, 110, 64, 255], [158, 88, 58, 255],
  ];
  p.fill((x, y) => {
    const band = bands[(y >> 1) % bands.length];
    return shade(band, 0.92 + speckle(seed, x, y, 0.06) * 0.08);
  });
}

function paintBasalt(p: Painter, seed: number): void {
  // Dark volcanic rock with faint vertical columnar cracks.
  p.fill((x, y) => {
    const col = x % 5 === 0 ? 0.7 : 1;
    return shade([54, 52, 58, 255], col * (0.85 + speckle(seed, x, y, 0.12) * 0.25));
  });
}

function paintLava(p: Painter, seed: number): void {
  // Glowing molten rock with a darker crust crackle.
  p.fill((x, y) => {
    const n = hash2(seed, x >> 1, y >> 1);
    const crust = hash2(seed ^ 7, Math.floor(x / 3), Math.floor(y / 3)) < 0.25;
    const base: RGBA = crust ? [120, 36, 12, 255] : [240, 130, 30, 255];
    return shade(base, 0.85 + n * 0.3);
  });
  for (let i = 0; i < 10; i++) {
    const x = Math.floor(hash2(seed ^ 0x9, i, 1) * 16);
    const y = Math.floor(hash2(seed ^ 0x9, i, 2) * 16);
    p.set(x, y, [255, 224, 120, 255]); // bright flecks
  }
}

function paintCoreSide(p: Painter, seed: number): void {
  paintMachineFrame(p, seed, [58, 62, 78, 255]);
  // a glowing energy core ring with a bright cyan center
  const glow: RGBA = [86, 220, 240, 255];
  for (let a = 0; a < 24; a++) {
    const ang = (a / 24) * Math.PI * 2;
    p.set(Math.round(7.5 + 4.2 * Math.cos(ang)), Math.round(7.5 + 4.2 * Math.sin(ang)), glow);
  }
  for (let y = 6; y <= 9; y++) {
    for (let x = 6; x <= 9; x++) {
      const d = Math.hypot(x - 7.5, y - 7.5);
      p.set(x, y, shade([150, 240, 255, 255], 1 - d * 0.12));
    }
  }
}

function paintCoreTop(p: Painter, seed: number): void {
  paintMachineFrame(p, seed, [66, 70, 88, 255]);
  const glow: RGBA = [110, 232, 248, 255];
  for (let y = 4; y <= 11; y++) {
    for (let x = 4; x <= 11; x++) {
      const d = Math.hypot(x - 7.5, y - 7.5);
      if (d > 3.6) continue;
      p.set(x, y, shade(glow, 1 - d * 0.16 + hash2(seed, x, y) * 0.08));
    }
  }
}

// Respawn Beacon: a stone plinth with a glowing green spawn rune (green so it
// reads clearly apart from the cyan faction Core).
function paintRespawnBeaconSide(p: Painter, seed: number): void {
  paintMachineFrame(p, seed, [60, 70, 60, 255]);
  const glow: RGBA = [120, 255, 150, 255];
  // an upward arrow rune = "you respawn here"
  for (let y = 4; y <= 11; y++) p.set(7, y, glow), p.set(8, y, glow);
  for (let k = 0; k < 4; k++) {
    p.set(5 + k, 7 - k, glow); p.set(10 - k, 7 - k, glow);
  }
}

function paintRespawnBeaconTop(p: Painter, seed: number): void {
  paintMachineFrame(p, seed, [70, 82, 70, 255]);
  const glow: RGBA = [140, 255, 165, 255];
  for (let y = 4; y <= 11; y++) {
    for (let x = 4; x <= 11; x++) {
      const d = Math.hypot(x - 7.5, y - 7.5);
      if (d > 3.6) continue;
      p.set(x, y, shade(glow, 1 - d * 0.16 + hash2(seed, x, y) * 0.08));
    }
  }
}

// Waypoint Totem (B4): a dark plinth with glowing GOLD travel runes (distinct
// from the green Respawn Beacon and the cyan Core).
function paintWaypointTotemSide(p: Painter, seed: number): void {
  paintMachineFrame(p, seed, [58, 52, 44, 255]);
  const gold: RGBA = [255, 214, 92, 255];
  const goldD: RGBA = [206, 156, 44, 255];
  // A diamond travel rune with a piercing vertical beam.
  for (let y = 3; y <= 12; y++) { p.set(7, y, y % 2 ? gold : goldD); p.set(8, y, y % 2 ? goldD : gold); }
  for (let k = 0; k < 3; k++) {
    p.set(5 + k, 8 - k, gold); p.set(10 - k, 8 - k, gold);
    p.set(5 + k, 8 + k, goldD); p.set(10 - k, 8 + k, goldD);
  }
}

function paintWaypointTotemTop(p: Painter, seed: number): void {
  paintMachineFrame(p, seed, [66, 60, 50, 255]);
  const gold: RGBA = [255, 224, 120, 255];
  // A glowing ring (the "portal pad") seen from above.
  for (let y = 3; y <= 12; y++) {
    for (let x = 3; x <= 12; x++) {
      const d = Math.hypot(x - 7.5, y - 7.5);
      if (d > 4.4 || d < 2.4) continue;
      p.set(x, y, shade(gold, 0.85 + hash2(seed, x, y) * 0.25));
    }
  }
  p.set(7, 7, [255, 244, 190, 255]); p.set(8, 8, [255, 244, 190, 255]);
}

// --- Discovery biomes (Milestone C) -------------------------------------------

const JUNGLE_BARK: RGBA = [86, 66, 38, 255];
function paintJungleLogSide(p: Painter, seed: number): void {
  p.fill((x, y) => {
    // Deep-brown bark with mossy green flecks.
    if (hash2(seed ^ 0x1c, x >> 1, y >> 1) > 0.88) return [88, 118, 52, 255];
    const streak = hash2(seed, x, Math.floor(y / 4));
    return shade(JUNGLE_BARK, (0.82 + streak * 0.36) * speckle(seed ^ 3, x, y, 0.08));
  });
}
function paintJungleLogTop(p: Painter, seed: number): void {
  p.fill((x, y) => {
    const border = x < 1 || y < 1 || x > 14 || y > 14;
    if (border) return shade(JUNGLE_BARK, speckle(seed, x, y, 0.08));
    const d = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
    const ring = Math.floor(d) % 2 === 0 ? 1.0 : 0.82;
    return shade([172, 138, 92, 255], ring * speckle(seed ^ 9, x, y, 0.05));
  });
}

const CHERRY_BARK: RGBA = [214, 196, 190, 255];
function paintCherryLogSide(p: Painter, seed: number): void {
  p.fill((x, y) => {
    // White-pink bark with thin dark horizontal lenticels (birch-like but warm).
    const dash = hash2(seed, x >> 2, y) > 0.86 && y % 3 === 1;
    if (dash) return [92, 62, 66, 255];
    return shade(CHERRY_BARK, speckle(seed ^ 5, x, y, 0.05));
  });
}
function paintCherryLogTop(p: Painter, seed: number): void {
  p.fill((x, y) => {
    const border = x < 1 || y < 1 || x > 14 || y > 14;
    if (border) return shade(CHERRY_BARK, speckle(seed, x, y, 0.05));
    const d = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
    const ring = Math.floor(d) % 2 === 0 ? 1.0 : 0.86;
    return shade([222, 168, 160, 255], ring * speckle(seed ^ 9, x, y, 0.05));
  });
}

function paintMud(p: Painter, seed: number): void {
  p.fill((x, y) => {
    // Wet, dark dirt with glossy puddled patches.
    const wet = hash2(seed ^ 0x30d, x >> 2, y >> 2) > 0.7;
    const base: RGBA = wet ? [58, 48, 40, 255] : [82, 66, 50, 255];
    return shade(base, speckle(seed, x, y, 0.1));
  });
}

function paintCrystalBlock(p: Painter, seed: number): void {
  p.fill((x, y) => {
    // Pale violet-cyan crystal with bright facet streaks (emissive in-world).
    const facet = (x + y * 2 + (hash2(seed, x >> 2, y >> 2) > 0.5 ? 1 : 0)) % 5;
    const base: RGBA = facet === 0 ? [222, 246, 255, 255]
      : facet < 3 ? [168, 208, 246, 255] : [190, 172, 244, 255];
    return shade(base, 0.9 + hash2(seed ^ 7, x, y) * 0.18);
  });
}

/** Crystal Shard item: a slim glowing spike with a bright core. */
function paintCrystalShard(p: Painter, seed: number): void {
  const body: RGBA = [176, 206, 248, 255];
  const core: RGBA = [236, 250, 255, 255];
  const dark: RGBA = [120, 138, 210, 255];
  // A tapered shard leaning right, plus a small companion sliver.
  const rows: Record<number, [number, number]> = {
    2: [8, 8], 3: [7, 9], 4: [7, 9], 5: [6, 10], 6: [6, 10],
    7: [6, 10], 8: [5, 10], 9: [5, 9], 10: [6, 9], 11: [6, 8], 12: [7, 8],
  };
  for (const yStr of Object.keys(rows)) {
    const y = Number(yStr);
    const [a, b] = rows[y];
    for (let x = a; x <= b; x++) {
      const c = x === a ? dark : x === Math.floor((a + b) / 2) ? core : body;
      p.set(x, y, shade(c, 0.92 + hash2(seed, x, y) * 0.16));
    }
  }
  p.set(3, 9, body); p.set(3, 10, dark); p.set(4, 11, dark); // sliver
  p.set(12, 4, [255, 255, 255, 220]); // sparkle
  outlineSprite(p);
}

// --- Gadget sprites (Phase 8): each gadget gets its own hand-drawn silhouette ---
const GADGET_OUTLINE: RGBA = [18, 20, 26, 255];

/** Filled axis-aligned rectangle helper for the sprite painters. */
function rect(p: Painter, x0: number, y0: number, x1: number, y1: number, c: RGBA): void {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) p.set(x, y, c);
}

/** Classic pineapple frag: olive segmented oval, steel cap, spoon lever + pin. */
function paintGrenade(p: Painter, seed: number): void {
  const base: RGBA = [88, 112, 68, 255];
  const dark: RGBA = [52, 70, 42, 255];
  const lite: RGBA = [124, 150, 96, 255];
  // Oval body with outline (rows y5..12; narrower at the ends).
  for (let y = 5; y <= 12; y++) {
    const slim = y === 5 || y === 12;
    const x0 = slim ? 6 : 5, x1 = slim ? 9 : 10;
    for (let x = x0; x <= x1; x++) {
      const edge = x === x0 || x === x1 || ((y === 5 || y === 12) && true);
      p.set(x, y, edge ? GADGET_OUTLINE : shade(base, 0.9 + hash2(seed, x, y) * 0.2));
    }
  }
  // Frag segmentation grooves (cast-iron grid) + upper-left sheen.
  for (let x = 6; x <= 9; x++) p.set(x, 8, dark);
  for (const y of [6, 7, 9, 10, 11]) { p.set(7, y, dark); }
  p.set(6, 6, lite); p.set(6, 7, lite);
  // Steel cap, spoon lever curling down the right side, gold pin ring left.
  const steel: RGBA = [176, 182, 190, 255];
  const steelD: RGBA = [110, 116, 126, 255];
  rect(p, 6, 3, 9, 3, steel); rect(p, 6, 4, 9, 4, steelD);
  p.set(10, 3, steelD); p.set(11, 4, steelD); p.set(11, 5, steelD); p.set(11, 6, steelD);
  const gold: RGBA = [212, 188, 84, 255];
  p.set(4, 2, gold); p.set(3, 3, gold); p.set(4, 4, gold); p.set(5, 3, gold);
}

/** C4: tan demolition brick, black straps, red LED timer, arming wires. */
function paintC4(p: Painter, seed: number): void {
  const clay: RGBA = [202, 182, 126, 255];
  const clayD: RGBA = [162, 142, 92, 255];
  // Brick with outline; bottom/right rows shaded darker for volume.
  for (let y = 5; y <= 13; y++) {
    for (let x = 3; x <= 12; x++) {
      const edge = x === 3 || x === 12 || y === 5 || y === 13;
      const c = edge ? GADGET_OUTLINE : (y >= 11 || x >= 11 ? clayD : clay);
      p.set(x, y, edge ? c : shade(c, 0.92 + hash2(seed, x, y) * 0.16));
    }
  }
  // Two black webbing straps.
  const strap: RGBA = [44, 46, 50, 255];
  for (let y = 6; y <= 12; y++) { p.set(5, y, strap); p.set(10, y, strap); }
  // LED timer panel with red digits.
  rect(p, 6, 7, 9, 9, [26, 28, 32, 255]);
  p.set(7, 8, [240, 70, 50, 255]); p.set(9, 8, [240, 70, 50, 255]);
  p.set(8, 8, [130, 30, 24, 255]);
  // Detonator nub + wires sprouting off the top.
  p.set(7, 4, [120, 124, 132, 255]); p.set(8, 4, [120, 124, 132, 255]);
  p.set(6, 3, [200, 60, 54, 255]); p.set(5, 2, [200, 60, 54, 255]);   // red wire
  p.set(9, 3, [70, 110, 210, 255]); p.set(10, 2, [70, 110, 210, 255]); // blue wire
  // Blinking arm light.
  p.set(11, 11, [245, 90, 70, 255]);
}

/** Grappling hook: steel grapnel with curled flukes + a coiled rope. */
function paintGrapplingHook(p: Painter, seed: number): void {
  const steel: RGBA = [186, 194, 204, 255];
  const steelD: RGBA = [116, 124, 136, 255];
  // Eye + shaft.
  p.set(8, 1, steelD); p.set(7, 2, steelD); p.set(9, 2, steelD); p.set(8, 3, steel);
  for (let y = 3; y <= 8; y++) p.set(8, y, y % 2 ? steel : shade(steel, 0.9));
  // Three flukes sweeping up from the crown at (8,9).
  p.set(8, 9, steelD);
  p.set(6, 9, steel); p.set(5, 8, steel); p.set(4, 7, steelD); p.set(4, 6, steel); // left barb
  p.set(10, 9, steel); p.set(11, 8, steel); p.set(12, 7, steelD); p.set(12, 6, steel); // right barb
  p.set(8, 10, steel); p.set(8, 11, steelD); // center spike
  // Barb tips glint.
  p.set(4, 5, [232, 238, 246, 255]); p.set(12, 5, [232, 238, 246, 255]);
  // Rope: a line running off the eye into a coil at the bottom-left.
  const rope: RGBA = [156, 116, 62, 255];
  const ropeD: RGBA = [114, 82, 44, 255];
  p.set(7, 1, rope); p.set(6, 2, rope); p.set(5, 3, ropeD); p.set(4, 4, rope);
  p.set(3, 5, ropeD); p.set(2, 6, rope); p.set(2, 7, ropeD); p.set(2, 8, rope);
  // Coil (a fat donut of rope).
  for (let y = 10; y <= 14; y++) {
    for (let x = 1; x <= 5; x++) {
      const d = Math.hypot(x - 3, y - 12);
      if (d > 2.4) continue;
      p.set(x, y, d < 0.8 ? ropeD : shade(rope, 0.82 + ((x + y) % 2) * 0.28));
    }
  }
}

/** Deployable cover: riveted blast barricade with a hazard chevron top. */
function paintDeployCover(p: Painter, seed: number): void {
  const plate: RGBA = [118, 124, 134, 255];
  const plateD: RGBA = [82, 88, 98, 255];
  // Trapezoid: narrow at the top, wide feet — reads "barricade" at a glance.
  for (let y = 4; y <= 13; y++) {
    const spread = Math.min(3, (y - 4) >> 1);
    const x0 = 5 - spread, x1 = 10 + spread;
    for (let x = x0; x <= x1; x++) {
      const edge = x === x0 || x === x1 || y === 4 || y === 13;
      p.set(x, y, edge ? GADGET_OUTLINE : shade(y > 10 ? plateD : plate, 0.9 + hash2(seed, x, y) * 0.18));
    }
  }
  // Diagonal yellow/black hazard chevrons across the crown.
  for (let x = 6; x <= 9; x++) {
    for (let y = 5; y <= 6; y++) {
      p.set(x, y, ((x + y) >> 1) % 2 ? [226, 190, 48, 255] : [40, 40, 44, 255]);
    }
  }
  // Vision slit + corner rivets + fold-out feet.
  rect(p, 6, 9, 9, 9, [30, 32, 38, 255]);
  p.set(4, 8, [200, 206, 214, 255]); p.set(11, 8, [200, 206, 214, 255]);
  p.set(3, 12, [200, 206, 214, 255]); p.set(12, 12, [200, 206, 214, 255]);
  rect(p, 2, 14, 4, 14, GADGET_OUTLINE); rect(p, 11, 14, 13, 14, GADGET_OUTLINE);
}

/** Sentry kit: a folded mini-turret on a tripod, barrel out, red eye lit. */
function paintSentryKit(p: Painter, seed: number): void {
  const body: RGBA = [96, 104, 116, 255];
  const dark: RGBA = [48, 52, 60, 255];
  // Tripod legs.
  p.set(4, 14, dark); p.set(5, 13, dark); p.set(6, 12, dark);
  p.set(8, 12, dark); p.set(8, 13, dark); p.set(8, 14, dark);
  p.set(10, 12, dark); p.set(11, 13, dark); p.set(12, 14, dark);
  // Turret head (outlined box).
  for (let y = 6; y <= 11; y++) {
    for (let x = 4; x <= 10; x++) {
      const edge = x === 4 || x === 10 || y === 6 || y === 11;
      p.set(x, y, edge ? GADGET_OUTLINE : shade(body, 0.9 + hash2(seed, x, y) * 0.2));
    }
  }
  // Twin barrels poking right with dark muzzles.
  rect(p, 11, 7, 14, 7, dark); p.set(14, 7, [16, 16, 18, 255]);
  rect(p, 11, 9, 13, 9, dark); p.set(13, 9, [16, 16, 18, 255]);
  // Targeting eye + status stripe + sensor mast.
  p.set(6, 8, [244, 84, 60, 255]); p.set(7, 8, [150, 40, 30, 255]);
  rect(p, 5, 10, 9, 10, [64, 70, 80, 255]);
  p.set(4, 4, dark); p.set(4, 5, dark); p.set(4, 3, [120, 220, 130, 255]);
}

/** Smoke grenade: gray canister, pull-ring, soft puffs drifting off the top. */
function paintSmokeGrenade(p: Painter, seed: number): void {
  const can: RGBA = [158, 166, 176, 255];
  const canD: RGBA = [104, 112, 124, 255];
  // Cylinder body with outlined sides.
  for (let y = 5; y <= 13; y++) {
    for (let x = 5; x <= 10; x++) {
      const edge = x === 5 || x === 10 || y === 13;
      const band = y === 8 || y === 9; // ID band
      const c: RGBA = band ? [86, 130, 150, 255] : (x >= 9 ? canD : can);
      p.set(x, y, edge ? GADGET_OUTLINE : shade(c, 0.9 + hash2(seed, x, y) * 0.16));
    }
  }
  p.set(6, 6, [214, 220, 228, 255]); // sheen
  // Vent holes at the base.
  p.set(6, 12, [40, 42, 48, 255]); p.set(8, 12, [40, 42, 48, 255]);
  // Cap + spoon + pull ring.
  rect(p, 5, 4, 10, 4, [70, 76, 86, 255]);
  p.set(11, 4, canD); p.set(12, 5, canD);
  p.set(12, 3, [212, 188, 84, 255]); p.set(13, 2, [212, 188, 84, 255]); p.set(13, 3, [212, 188, 84, 255]);
  // Smoke puffs rising to the upper-left.
  const puff: RGBA = [228, 232, 238, 230];
  const puffD: RGBA = [196, 202, 210, 200];
  p.set(4, 3, puff); p.set(3, 2, puffD); p.set(4, 2, puff); p.set(2, 1, puffD);
  p.set(3, 0, puff); p.set(5, 1, puffD); p.set(1, 3, puffD);
}

/** War horn: a curved brass horn with a flared bell and banding. */
function paintWarHorn(p: Painter, seed: number): void {
  const brass: RGBA = [204, 160, 66, 255];
  const brassD: RGBA = [144, 108, 42, 255];
  const brassL: RGBA = [240, 206, 110, 255];
  // Crescent body: mouthpiece bottom-left sweeping up to the bell top-right.
  const path: [number, number][] = [
    [3, 12], [4, 12], [5, 12], [6, 11], [7, 10], [8, 9], [9, 8], [9, 7], [10, 6], [10, 5],
  ];
  for (const [x, y] of path) {
    p.set(x, y, brass);
    p.set(x, y + 1, brassD);
    p.set(x + 1, y, shade(brass, 0.95 + hash2(seed, x, y) * 0.1));
  }
  // Highlight along the top curve.
  p.set(4, 11, brassL); p.set(5, 11, brassL); p.set(7, 9, brassL); p.set(9, 6, brassL);
  // Flared bell.
  for (let y = 2; y <= 7; y++) {
    const w = y <= 4 ? 2 : 1;
    for (let x = 11; x <= 11 + w; x++) p.set(x, y, x === 11 + w ? brassL : brass);
  }
  p.set(12, 1, brassL); p.set(13, 1, brassL); p.set(14, 2, brassL); p.set(14, 3, brassL);
  // Dark bore of the bell + mouthpiece tip + decorative band.
  p.set(13, 2, [60, 44, 20, 255]); p.set(13, 3, [60, 44, 20, 255]);
  p.set(2, 12, [60, 44, 20, 255]);
  p.set(8, 9, [120, 80, 40, 255]); p.set(8, 10, [120, 80, 40, 255]);
}

/** Oil bomb: glossy black sphere, lit fuse, amber oil sheen dripping. */
function paintOilBomb(p: Painter, seed: number): void {
  const shell: RGBA = [40, 38, 46, 255];
  // Sphere with radial shading.
  for (let y = 4; y <= 14; y++) {
    for (let x = 3; x <= 13; x++) {
      const d = Math.hypot(x - 8, y - 9);
      if (d > 4.9) continue;
      let f = 1.15 - d * 0.1;
      if (x < 7 && y < 8 && d < 4) f += 0.5; // gloss
      p.set(x, y, shade(shell, f * (0.9 + hash2(seed, x, y) * 0.14)));
    }
  }
  p.set(6, 6, [130, 134, 156, 255]); p.set(5, 7, [104, 108, 128, 255]); // hard glint
  // Amber oil sheen swirl low on the shell.
  p.set(9, 11, [128, 108, 40, 255]); p.set(10, 10, [96, 82, 32, 255]); p.set(8, 12, [96, 82, 32, 255]);
  // Cap + rope fuse + spark.
  rect(p, 7, 3, 9, 4, [96, 100, 110, 255]);
  p.set(10, 2, [140, 104, 56, 255]); p.set(11, 1, [140, 104, 56, 255]);
  p.set(12, 0, [255, 200, 80, 255]); p.set(13, 1, [244, 120, 40, 255]); p.set(12, 2, [244, 160, 60, 255]);
}

/** Spy disguise: fedora + dark shades + moustache — the classic incognito kit. */
function paintSpyDisguise(p: Painter, seed: number): void {
  const felt: RGBA = [56, 58, 72, 255];
  const feltD: RGBA = [38, 40, 52, 255];
  // Hat crown + band + wide brim.
  for (let y = 2; y <= 5; y++) {
    for (let x = 5; x <= 10; x++) p.set(x, y, shade(felt, 0.92 + hash2(seed, x, y) * 0.16));
  }
  rect(p, 5, 5, 10, 5, [140, 44, 48, 255]); // hat band (dark red)
  rect(p, 3, 6, 12, 6, feltD);
  p.set(2, 6, feltD); p.set(13, 6, feltD);
  // Sunglasses: two lenses joined by a bridge, arms out to the sides.
  const lens: RGBA = [22, 24, 30, 255];
  rect(p, 4, 8, 6, 9, lens); rect(p, 9, 8, 11, 9, lens);
  p.set(7, 8, [90, 94, 106, 255]); p.set(8, 8, [90, 94, 106, 255]); // bridge
  p.set(3, 8, [90, 94, 106, 255]); p.set(12, 8, [90, 94, 106, 255]); // arms
  p.set(4, 8, [130, 150, 170, 255]); p.set(9, 8, [130, 150, 170, 255]); // lens glint
  // Moustache: a two-lobe curl under the glasses.
  const tache: RGBA = [58, 42, 30, 255];
  rect(p, 5, 12, 7, 12, tache); rect(p, 8, 12, 10, 12, tache);
  p.set(4, 11, tache); p.set(11, 11, tache);
  p.set(6, 13, tache); p.set(9, 13, tache);
}

/** Jump boost: a coiled launch spring on a plate with a green up arrow. */
function paintJumpBoost(p: Painter, seed: number): void {
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

// --- Runes: glowing stone tablets (exploration-only armor socketables) --------

/** A carved stone tablet with a glowing glyph. Each rune gets its own glow
 *  color + glyph so they're readable apart at hotbar size. */
function paintRuneTablet(
  p: Painter, seed: number, glow: RGBA, glowHi: RGBA,
  glyph: (set: (x: number, y: number, c: RGBA) => void) => void,
): void {
  const stone: RGBA = [96, 100, 112, 255];
  const stoneD: RGBA = [66, 70, 82, 255];
  const stoneHi: RGBA = [128, 133, 148, 255];
  // Rounded tablet body with jittered stone shading.
  for (let y = 2; y <= 13; y++) {
    for (let x = 4; x <= 11; x++) {
      const corner = (x === 4 || x === 11) && (y === 2 || y === 13);
      if (corner) continue;
      const edge = x === 4 || x === 11 || y === 2 || y === 13;
      const jit = 0.9 + hash2(seed, x, y) * 0.2;
      p.set(x, y, shade(edge ? stoneD : stone, jit));
    }
  }
  p.set(5, 3, stoneHi); p.set(6, 3, stoneHi); p.set(5, 4, stoneHi);
  // The glyph, in glow color with a bright core pixel jitter.
  glyph((x, y, c) => p.set(x, y, c));
  void glowHi; void glow;
  outlineSprite(p);
}

function paintRuneIron(p: Painter, seed: number): void {
  const glow: RGBA = [255, 196, 92, 255];
  const hi: RGBA = [255, 236, 170, 255];
  paintRuneTablet(p, seed, glow, hi, (set) => {
    // A shield glyph.
    for (let y = 5; y <= 9; y++) { set(6, y, glow); set(9, y, glow); }
    for (let x = 6; x <= 9; x++) set(x, 5, glow);
    set(7, 10, glow); set(8, 10, glow);
    set(7, 11, hi); set(8, 11, hi);
    set(7, 7, hi); set(8, 7, hi);
  });
}
function paintRuneSwift(p: Painter, seed: number): void {
  const glow: RGBA = [110, 220, 255, 255];
  const hi: RGBA = [200, 245, 255, 255];
  paintRuneTablet(p, seed, glow, hi, (set) => {
    // A lightning zag.
    set(9, 4, glow); set(8, 5, glow); set(7, 6, glow);
    set(6, 7, glow); set(7, 7, hi); set(8, 7, glow); set(9, 7, glow);
    set(8, 8, glow); set(7, 9, glow); set(6, 10, glow); set(5, 11, hi);
  });
}
function paintRuneFortune(p: Painter, seed: number): void {
  const glow: RGBA = [130, 240, 140, 255];
  const hi: RGBA = [210, 255, 210, 255];
  paintRuneTablet(p, seed, glow, hi, (set) => {
    // A pick glyph: haft + head arc.
    for (let i = 0; i < 5; i++) set(6 + i, 10 - i, glow);
    set(5, 5, glow); set(6, 4, glow); set(7, 4, hi); set(8, 4, glow);
    set(9, 4, glow); set(10, 5, glow);
  });
}
function paintRuneFocus(p: Painter, seed: number): void {
  const glow: RGBA = [235, 120, 235, 255];
  const hi: RGBA = [255, 200, 255, 255];
  paintRuneTablet(p, seed, glow, hi, (set) => {
    // A crosshair ring + dot.
    for (const [x, y] of [[7, 4], [8, 4], [6, 5], [9, 5], [5, 6], [10, 6],
      [5, 7], [10, 7], [6, 8], [9, 8], [7, 9], [8, 9]] as [number, number][]) set(x, y, glow);
    set(7, 6, hi); set(8, 6, hi); set(7, 7, hi); set(8, 7, hi);
    set(7, 11, glow); set(8, 11, glow);
  });
}

// --- Lifesteal (Milestone A): Heart + Revival Beacon sprites ------------------

/** A chunky rounded pixel heart with a glossy highlight (the lifesteal
 *  currency — big, warm and readable at hotbar size). */
function paintHeart(p: Painter, seed: number): void {
  const red: RGBA = [224, 46, 60, 255];
  const dark: RGBA = [156, 22, 38, 255];
  const hi: RGBA = [255, 150, 158, 255];
  // Right-half horizontal span per row, mirrored (a fat symmetric heart).
  const span: Record<number, [number, number]> = {
    3: [9, 11], 4: [8, 12], 5: [8, 12], 6: [8, 12],
    7: [8, 13], 8: [8, 12], 9: [8, 12], 10: [8, 11],
    11: [8, 10], 12: [8, 9], 13: [8, 8],
  };
  for (const yStr of Object.keys(span)) {
    const y = Number(yStr);
    const [a, b] = span[y];
    for (let x = a; x <= b; x++) {
      const edge = x === b || y >= 12;
      const c = edge ? dark : red;
      const jit = 0.94 + hash2(seed, x, y) * 0.1;
      p.set(x, y, shade(c, jit));
      p.set(15 - x, y, shade(c, jit)); // mirrored left lobe
    }
  }
  // Centre dip between the lobes + a glossy top-left highlight.
  p.set(7, 3, dark); p.set(8, 3, dark);
  p.set(4, 4, hi); p.set(5, 4, hi); p.set(4, 5, hi);
  p.set(5, 5, shade(hi, 0.92));
  outlineSprite(p);
}

/** The Revival Beacon: a gold totem cradling an emerald "life" gem — reads as
 *  precious + magical (it clears a teammate's 24h elimination). */
function paintRevivalBeacon(p: Painter, seed: number): void {
  const gold: RGBA = [232, 186, 62, 255];
  const goldD: RGBA = [168, 126, 34, 255];
  const goldHi: RGBA = [255, 232, 140, 255];
  const gem: RGBA = [66, 214, 118, 255];
  const gemHi: RGBA = [170, 255, 200, 255];
  // Pedestal base.
  rect(p, 4, 13, 11, 14, goldD);
  rect(p, 5, 12, 10, 12, gold);
  p.set(4, 13, goldHi); p.set(11, 13, goldHi);
  // Twin uprights (a cradle) with highlight/shadow columns.
  for (let y = 4; y <= 11; y++) {
    p.set(4, y, y % 3 ? gold : goldD); p.set(5, y, goldHi);
    p.set(11, y, y % 3 ? gold : goldD); p.set(10, y, goldD);
  }
  // Crown tips.
  p.set(4, 3, goldHi); p.set(11, 3, goldHi);
  // Floating emerald life-gem in the cradle.
  for (let y = 5; y <= 9; y++) {
    for (let x = 6; x <= 9; x++) {
      const d = Math.abs(x - 7.5) + Math.abs(y - 7);
      if (d > 2.6) continue;
      p.set(x, y, shade(d < 1 ? gemHi : gem, 0.92 + hash2(seed, x, y) * 0.12));
    }
  }
  // Sparkles.
  p.set(7, 2, gemHi); p.set(13, 6, [255, 255, 220, 220]); p.set(2, 8, [255, 255, 220, 220]);
  outlineSprite(p);
}

// --- Dungeons (Milestone D) ---------------------------------------------------

/** Vault Brick: dark ancient masonry — big slate bricks, deep mortar seams,
 *  the occasional faint teal rune-glint so vault walls read as "special". */
function paintVaultBrick(p: Painter, seed: number): void {
  const brick: RGBA = [74, 76, 94, 255];
  const mortar: RGBA = [40, 42, 54, 255];
  p.fill((x, y) => {
    const row = y >> 2;                        // 4px course height
    const shift = (row % 2) * 4;               // running bond
    const mx = ((x + shift) & 7) === 0;        // vertical seams every 8px
    const my = (y & 3) === 0;                  // horizontal seams
    if (mx || my) return shade(mortar, 0.9 + hash2(seed, x, y) * 0.15);
    return shade(brick, speckle(seed ^ row, x, y, 0.1));
  });
  // Rare rune-glints in the brick faces.
  if (hash2(seed, 3, 3) < 0.6) p.set(5, 6, [96, 210, 200, 255]);
  if (hash2(seed, 9, 12) < 0.5) p.set(11, 10, [96, 210, 200, 255]);
}

const VAULT_CHEST_BODY: RGBA = [56, 46, 66, 255];
const VAULT_CHEST_TRIM: RGBA = [232, 196, 88, 255];

/** Vault Chest side: dark relic chest with gold trim + a glowing cyan gem. */
function paintVaultChestSide(p: Painter, seed: number): void {
  p.fill((x, y) => {
    const border = x === 0 || y === 0 || x === 15 || y === 15;
    const lidLine = y === 5;
    const c = border || lidLine ? VAULT_CHEST_TRIM : VAULT_CHEST_BODY;
    return shade(c, speckle(seed, x, y >> 1, 0.08));
  });
  // Glowing gem latch.
  for (const [x, y] of [[7, 7], [8, 7], [7, 8], [8, 8]]) p.set(x, y, [110, 235, 230, 255]);
  p.set(7, 7, [190, 255, 250, 255]);
}

function paintVaultChestTop(p: Painter, seed: number): void {
  p.fill((x, y) => {
    const border = x === 0 || y === 0 || x === 15 || y === 15;
    return shade(border ? VAULT_CHEST_TRIM : VAULT_CHEST_BODY,
      speckle(seed, x, y >> 1, 0.08));
  });
  // Inlaid gold cross-band.
  for (let x = 1; x < 15; x++) p.set(x, 7, shade(VAULT_CHEST_TRIM, 0.85));
}

/** Bandage: a rolled white gauze wrap with a red cross + a trailing strip. */
function paintBandage(p: Painter, seed: number): void {
  const gauze: RGBA = [238, 236, 228, 255];
  const shadow: RGBA = [206, 202, 190, 255];
  for (let y = 4; y <= 11; y++) {
    for (let x = 3; x <= 12; x++) {
      const edge = x === 3 || x === 12 || y === 4 || y === 11;
      p.set(x, y, shade(edge ? shadow : gauze, 0.94 + hash2(seed, x, y) * 0.1));
    }
  }
  // Wrap seams.
  for (let y = 5; y <= 10; y++) { p.set(6, y, shadow); p.set(9, y, shadow); }
  // Red cross.
  const red: RGBA = [220, 48, 48, 255];
  for (let x = 6; x <= 9; x++) p.set(x, 7, red), p.set(x, 8, red);
  for (let y = 6; y <= 9; y++) p.set(7, y, red), p.set(8, y, red);
  outlineSprite(p, [60, 58, 52, 255]);
}

/** Medkit: a boxy first-aid case, dark trim, bold red cross, latch. */
function paintMedkit(p: Painter, seed: number): void {
  const body: RGBA = [232, 234, 236, 255];
  const trim: RGBA = [70, 78, 92, 255];
  for (let y = 3; y <= 12; y++) {
    for (let x = 2; x <= 13; x++) {
      const edge = x === 2 || x === 13 || y === 3 || y === 12;
      p.set(x, y, shade(edge ? trim : body, 0.95 + hash2(seed, x, y) * 0.08));
    }
  }
  // Handle + latch.
  for (let x = 6; x <= 9; x++) p.set(x, 3, trim);
  p.set(7, 8, trim); p.set(8, 8, trim);
  // Red cross.
  const red: RGBA = [214, 44, 44, 255];
  for (let x = 6; x <= 9; x++) { p.set(x, 6, red); p.set(x, 7, red); }
  for (let y = 5; y <= 10; y++) { p.set(7, y, red); p.set(8, y, red); }
  outlineSprite(p, [40, 44, 52, 255]);
}

// --- Traps + boat ---------------------------------------------------------------

/** Spike Trap top: a dark iron plate studded with a 3×3 grid of gleaming spikes. */
function paintSpikeTrapTop(p: Painter, seed: number): void {
  const plate: RGBA = [88, 90, 96, 255];
  p.fill((x, y) => shade(plate, speckle(seed, x, y, 0.1)));
  for (const cx of [3, 8, 13]) {
    for (const cy of [3, 8, 13]) {
      p.set(cx, cy, [234, 238, 244, 255]);      // gleaming tip
      p.set(cx - 1, cy, [152, 156, 164, 255]);  // lit flank
      p.set(cx + 1, cy, [56, 58, 64, 255]);     // shadowed flank
      p.set(cx, cy + 1, [56, 58, 64, 255]);
    }
  }
}

/** Spike Trap side: a riveted iron base with spike silhouettes above it. */
function paintSpikeTrapSide(p: Painter, seed: number): void {
  const base: RGBA = [70, 72, 78, 255];
  p.fill((x, y) => shade(base, speckle(seed, x, y, 0.12)));
  for (const x of [2, 7, 12]) p.set(x, 12, [142, 146, 154, 255]); // rivets
  for (const x of [2, 6, 10, 14]) { // spike tips (read from any crop)
    p.set(x, 2, [226, 230, 236, 255]);
    p.set(x, 3, [162, 166, 174, 255]);
    p.set(x, 4, [110, 112, 120, 255]);
  }
}

/** Landmine top: olive-drab camo plate with a red arming button dead centre. */
function paintLandmineTop(p: Painter, seed: number): void {
  const camo: RGBA = [96, 104, 74, 255];
  const camo2: RGBA = [76, 84, 60, 255];
  p.fill((x, y) => shade(hash2(seed, x >> 2, y >> 2) > 0.5 ? camo : camo2,
    speckle(seed ^ 3, x, y, 0.08)));
  // Plate ridge highlights.
  for (let i = 2; i <= 13; i++) { p.set(i, 2, shade(camo, 1.18)); p.set(2, i, shade(camo, 1.12)); }
  // The red trigger button.
  for (const [x, y] of [[7, 7], [8, 7], [7, 8], [8, 8]]) p.set(x, y, [214, 48, 44, 255]);
  p.set(7, 7, [255, 112, 102, 255]);
}

/** Landmine side: the thin dark metal rim of the plate. */
function paintLandmineSide(p: Painter, seed: number): void {
  p.fill((x, y) => shade([52, 56, 46, 255], speckle(seed, x, y, 0.1)));
  for (let x = 0; x < 16; x++) p.set(x, 14, [30, 32, 26, 255]);
}

/** Lever: a cobble base plinth with a wooden pull-handle — tilted left when
 *  off, right (with a lit red tip) when on. Drawn as a cross billboard. */
function paintLever(on: boolean) {
  return (p: Painter, seed: number): void => {
    const cobble: RGBA = [118, 118, 118, 255];
    for (let y = 12; y <= 14; y++) {
      for (let x = 5; x <= 10; x++) {
        p.set(x, y, shade(cobble, 0.85 + hash2(seed, x, y) * 0.3));
      }
    }
    const stick: RGBA = [148, 110, 62, 255];
    for (let i = 0; i < 8; i++) { // the handle leans off its pivot at (8, 12)
      const x = on ? 8 + (i >> 1) : 8 - (i >> 1);
      const y = 11 - i;
      p.set(x, y, shade(stick, 0.9 + hash2(seed, x, y) * 0.2));
    }
    const tipX = on ? 8 + 3 : 8 - 3;
    p.set(tipX, 4, on ? [236, 60, 48, 255] : [96, 74, 46, 255]); // tip knob
    p.set(tipX, 3, on ? [255, 130, 110, 255] : [120, 92, 56, 255]);
  };
}

/** Fall Trap (closed): a plank hatch — border frame, dark X seam, hinge studs.
 *  Solid + walkable until a linked lever swings it open. */
function paintFallTrap(p: Painter, seed: number): void {
  const plank: RGBA = [166, 130, 78, 255];
  const dark: RGBA = [96, 72, 42, 255];
  p.fill((x, y) => shade(plank, 0.88 + hash2(seed, x, (y >> 2) * 7) * 0.2));
  for (let i = 0; i < 16; i++) { // frame
    p.set(i, 0, dark); p.set(i, 15, dark); p.set(0, i, dark); p.set(15, i, dark);
  }
  for (let i = 2; i <= 13; i++) { // the X seam (reads "hatch", not "planks")
    p.set(i, i, shade(dark, 1.1));
    p.set(15 - i, i, shade(dark, 1.1));
  }
  for (const [x, y] of [[2, 2], [13, 2], [2, 13], [13, 13]]) { // hinge studs
    p.set(x, y, [210, 214, 222, 255]);
  }
}

/** Fall Trap (open): mostly transparent — just the broken frame and a couple
 *  of snapped slats (rendered as a cross billboard you fall straight through). */
function paintFallTrapOpen(p: Painter, seed: number): void {
  const dark: RGBA = [96, 72, 42, 255];
  p.fill(() => [0, 0, 0, 0]);
  for (let i = 0; i < 16; i++) { // the frame stays
    p.set(i, 0, dark); p.set(i, 15, shade(dark, 0.8));
    p.set(0, i, dark); p.set(15, i, dark);
  }
  for (let i = 1; i < 7; i++) { // two snapped slats dangling inward
    p.set(3, i, shade([150, 116, 68, 255], 0.9 + hash2(seed, 3, i) * 0.2));
    p.set(11, i + 2, shade([150, 116, 68, 255], 0.85 + hash2(seed, 11, i) * 0.2));
  }
}

/** Wall Trap top: a steel spring-plate with a bright "pops UP" chevron. */
function paintWallTrapTop(p: Painter, seed: number): void {
  const steel: RGBA = [96, 100, 110, 255];
  p.fill((x, y) => shade(steel, speckle(seed, x, y, 0.1)));
  for (let i = 0; i < 16; i++) { p.set(i, 0, shade(steel, 1.25)); p.set(0, i, shade(steel, 1.15)); }
  const hi: RGBA = [232, 206, 84, 255]; // warning-yellow chevron pointing up
  for (let i = 0; i <= 4; i++) {
    p.set(8 - i, 5 + i, hi); p.set(7 + i, 5 + i, hi);
  }
  p.set(7, 11, hi); p.set(8, 11, hi); // chevron stem
}

/** Wall Trap side: dark steel with a yellow/black hazard band across the top. */
function paintWallTrapSide(p: Painter, seed: number): void {
  const steel: RGBA = [78, 82, 92, 255];
  p.fill((x, y) => shade(steel, speckle(seed, x, y, 0.12)));
  for (let x = 0; x < 16; x++) { // hazard band
    const yellow = ((x >> 1) & 1) === 0;
    p.set(x, 1, yellow ? [222, 186, 60, 255] : [34, 34, 38, 255]);
    p.set(x, 2, yellow ? [198, 162, 48, 255] : [28, 28, 32, 255]);
  }
  for (const x of [3, 8, 13]) p.set(x, 12, [150, 154, 164, 255]); // rivets
}

/** Boat sprite: a little plank hull from the side — curved bow, dark cockpit,
 *  a paddle poking up. */
function paintBoat(p: Painter, seed: number): void {
  const hull: RGBA = [150, 116, 68, 255];
  const hullHi: RGBA = [186, 150, 96, 255];
  const hullLo: RGBA = [108, 82, 48, 255];
  const rows: Record<number, [number, number]> = {
    6: [1, 14], 7: [1, 14], 8: [2, 13], 9: [3, 12], 10: [5, 10],
  };
  for (const yStr of Object.keys(rows)) {
    const y = Number(yStr);
    const [a, b] = rows[y];
    for (let x = a; x <= b; x++) {
      const c = y === 6 ? hullHi : y >= 9 ? hullLo : hull;
      p.set(x, y, shade(c, 0.92 + hash2(seed, x, y) * 0.14));
    }
  }
  // Raised bow/stern tips + a dark cockpit + the paddle.
  p.set(0, 5, hullHi); p.set(1, 5, hullHi); p.set(14, 5, hullHi); p.set(15, 5, hullHi);
  for (let x = 6; x <= 9; x++) p.set(x, 5, [70, 54, 34, 255]);
  p.set(11, 3, [122, 94, 58, 255]); p.set(10, 4, [122, 94, 58, 255]);
  outlineSprite(p);
}

/** Mob Spawner: a dark iron cage — thick lattice bars over a glowing ember
 *  heart, so guarded vault rooms read as "kill the cage". */
function paintMobSpawner(p: Painter, seed: number): void {
  const bar: RGBA = [44, 46, 54, 255];
  const barHi: RGBA = [74, 78, 90, 255];
  p.fill((x, y) => {
    const onBar = x % 5 === 0 || y % 5 === 0;
    if (!onBar) return [16, 12, 20, 200]; // dark interior, slightly see-through
    const edge = x === 0 || y === 0 || x === 15 || y === 15;
    return shade(edge ? barHi : bar, 0.9 + hash2(seed, x, y) * 0.18);
  });
  // The ember heart, peeking through the middle gap.
  for (const [x, y] of [[7, 7], [8, 7], [7, 8], [8, 8]]) p.set(x, y, [255, 120, 40, 255]);
  p.set(7, 7, [255, 190, 90, 255]);
  p.set(12, 3, [220, 90, 30, 220]); p.set(3, 12, [220, 90, 30, 220]); // stray sparks
}

/** Vault compass: a metal ring with a redstone needle; the ring metal marks the
 *  tier (iron / gold / diamond-blue). */
function paintVaultCompass(ring: RGBA, ringHi: RGBA) {
  return (p: Painter, seed: number): void => {
    // Ring: a circle of radius ~6 centred on (7.5, 7.5).
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        const d = Math.hypot(x - 7.5, y - 7.5);
        if (d >= 5.1 && d <= 6.9) {
          p.set(x, y, shade(d < 6 ? ringHi : ring, 0.9 + hash2(seed, x, y) * 0.16));
        } else if (d < 5.1) {
          p.set(x, y, [26, 28, 38, 255]); // dark face
        }
      }
    }
    // Redstone needle pointing NE + a pivot pin + the skull tick at north.
    const needle: RGBA = [226, 60, 48, 255];
    p.set(8, 7, needle); p.set(9, 6, needle); p.set(10, 5, needle);
    p.set(7, 8, [140, 42, 34, 255]); p.set(6, 9, [140, 42, 34, 255]); // tail
    p.set(7, 7, [240, 240, 244, 255]); // pivot
    p.set(7, 3, [200, 190, 230, 255]); // the vault mark
    outlineSprite(p);
  };
}

const PAINTERS: Record<number, (p: Painter, seed: number) => void> = {
  [Tile.GrassTop]: paintGrassTop,
  [Tile.GrassSide]: paintGrassSide,
  [Tile.Dirt]: paintDirt,
  [Tile.Stone]: paintStone,
  [Tile.Cobblestone]: paintCobblestone,
  [Tile.Sand]: paintSand,
  [Tile.LogSide]: paintLogSide,
  [Tile.LogTop]: paintLogTop,
  [Tile.Planks]: paintPlanks,
  [Tile.Leaves]: paintLeaves,
  [Tile.Glass]: paintGlass,
  [Tile.Water]: paintWater,
  [Tile.Bedrock]: paintBedrock,
  [Tile.Sandstone]: paintSandstone,
  [Tile.SandstoneTop]: paintSandstoneTop,
  [Tile.Snow]: paintSnow,
  [Tile.SnowySide]: paintSnowySide,
  [Tile.BirchLogSide]: paintBirchLogSide,
  [Tile.BirchLogTop]: paintBirchLogTop,
  [Tile.SpruceLogSide]: paintSpruceLogSide,
  [Tile.SpruceLogTop]: paintSpruceLogTop,
  [Tile.BirchLeaves]: paintColoredLeaves([128, 167, 85, 255]),
  [Tile.SpruceLeaves]: paintColoredLeaves([97, 153, 97, 255]),
  [Tile.CactusSide]: paintCactusSide,
  [Tile.CactusTop]: paintCactusTop,
  [Tile.TallGrass]: paintTallGrass,
  [Tile.DeadBush]: paintDeadBush,
  [Tile.Dandelion]: paintFlower([255, 216, 61, 255], null),
  [Tile.Poppy]: paintFlower([212, 41, 41, 255], [30, 30, 30, 255]),
  [Tile.CoalOre]: paintOre([47, 47, 47, 255], [25, 25, 25, 255]),
  [Tile.IronOre]: paintOre([216, 175, 147, 255], [175, 130, 100, 255]),
  [Tile.GoldOre]: paintOre([252, 238, 75, 255], [210, 180, 40, 255]),
  [Tile.RedstoneOre]: paintOre([235, 35, 35, 255], [160, 10, 10, 255]),
  [Tile.DiamondOre]: paintOre([93, 236, 245, 255], [40, 180, 200, 255]),
  [Tile.Torch]: paintTorch,
  [Tile.Stick]: paintStick,
  [Tile.CoalItem]: paintCoalItem,
  [Tile.IronIngot]: paintIngot([216, 216, 216, 255]),
  [Tile.Apple]: paintApple,
  [Tile.PorkchopRaw]: paintMeat(true, true),
  [Tile.PorkchopCooked]: paintMeat(false, true),
  [Tile.BeefRaw]: paintMeat(true, false),
  [Tile.BeefCooked]: paintMeat(false, false),
  [Tile.RedstoneDust]: paintRedstoneDust,
  [Tile.Diamond]: paintDiamondItem,
  [Tile.CraftingTableTop]: paintCraftingTableTop,
  [Tile.CraftingTableSide]: paintCraftingTableSide,
  [Tile.FurnaceFront]: paintFurnaceFront(false),
  [Tile.FurnaceFrontLit]: paintFurnaceFront(true),
  [Tile.FurnaceSide]: paintFurnaceSide,
  [Tile.WoodPickaxe]: paintToolSprite('pickaxe', TOOL_WOOD),
  [Tile.WoodAxe]: paintToolSprite('axe', TOOL_WOOD),
  [Tile.WoodShovel]: paintToolSprite('shovel', TOOL_WOOD),
  [Tile.WoodSword]: paintToolSprite('sword', TOOL_WOOD),
  [Tile.StonePickaxe]: paintToolSprite('pickaxe', TOOL_STONE),
  [Tile.StoneAxe]: paintToolSprite('axe', TOOL_STONE),
  [Tile.StoneShovel]: paintToolSprite('shovel', TOOL_STONE),
  [Tile.StoneSword]: paintToolSprite('sword', TOOL_STONE),
  [Tile.IronPickaxe]: paintToolSprite('pickaxe', TOOL_IRON),
  [Tile.IronAxe]: paintToolSprite('axe', TOOL_IRON),
  [Tile.IronShovel]: paintToolSprite('shovel', TOOL_IRON),
  [Tile.IronSword]: paintToolSprite('sword', TOOL_IRON),
  [Tile.Charcoal]: paintCharcoal,
  [Tile.GoldIngot]: paintIngot([250, 222, 80, 255]),
  [Tile.Wool]: paintWool,
  [Tile.ChickenRaw]: paintChickenMeat(true),
  [Tile.ChickenCooked]: paintChickenMeat(false),
  [Tile.Feather]: paintFeather,
  [Tile.PigSkin]: paintSkin([238, 158, 158, 255]),
  [Tile.PigFace]: paintFace(
    [238, 158, 158, 255], [40, 40, 60, 255],
    { color: [225, 120, 130, 255], x0: 5, y0: 8, x1: 10, y1: 11 }
  ),
  [Tile.CowSkin]: paintSkin([92, 62, 40, 255], 0.14, [225, 220, 210, 255]),
  [Tile.CowFace]: paintFace(
    [92, 62, 40, 255], [35, 25, 20, 255],
    { color: [222, 214, 200, 255], x0: 4, y0: 10, x1: 11, y1: 15 }
  ),
  [Tile.SheepSkin]: paintWool,
  [Tile.SheepFace]: paintFace(
    [226, 222, 214, 255], [30, 30, 45, 255], null, 6
  ),
  [Tile.ChickenSkin]: paintSkin([235, 235, 235, 255], 0.09),
  [Tile.ChickenFace]: paintFace(
    [235, 235, 235, 255], [25, 25, 35, 255],
    { color: [230, 160, 40, 255], x0: 6, y0: 8, x1: 9, y1: 10 }
  ),
  [Tile.ZombieSkin]: paintSkin([90, 150, 70, 255]),
  [Tile.ZombieFace]: paintFace([90, 150, 70, 255], [20, 20, 28, 255], null),
  [Tile.ZombieShirt]: paintSkin([60, 120, 140, 255]),
  [Tile.ZombiePants]: paintSkin([55, 65, 130, 255]),
  [Tile.CreeperSkin]: paintSkin([88, 168, 80, 255], 0.22, [120, 200, 100, 255]),
  [Tile.CreeperFace]: paintCreeperFace,
  [Tile.ChestTop]: paintChestTop,
  [Tile.ChestSide]: paintChestFace(false),
  [Tile.ChestFront]: paintChestFace(true),
  [Tile.TitaniumOre]: paintOre([198, 210, 228, 255], [150, 166, 192, 255]),
  [Tile.TitaniumIngot]: paintIngot([196, 210, 230, 255]),
  [Tile.ArmorHelmetIron]: paintArmorPiece('helmet', ARMOR_IRON),
  [Tile.ArmorChestIron]: paintArmorPiece('chestplate', ARMOR_IRON),
  [Tile.ArmorLegsIron]: paintArmorPiece('leggings', ARMOR_IRON),
  [Tile.ArmorBootsIron]: paintArmorPiece('boots', ARMOR_IRON),
  [Tile.ArmorHelmetDiamond]: paintArmorPiece('helmet', ARMOR_DIAMOND),
  [Tile.ArmorChestDiamond]: paintArmorPiece('chestplate', ARMOR_DIAMOND),
  [Tile.ArmorLegsDiamond]: paintArmorPiece('leggings', ARMOR_DIAMOND),
  [Tile.ArmorBootsDiamond]: paintArmorPiece('boots', ARMOR_DIAMOND),
  [Tile.ArmorHelmetTitanium]: paintArmorPiece('helmet', ARMOR_TITAN),
  [Tile.ArmorChestTitanium]: paintArmorPiece('chestplate', ARMOR_TITAN),
  [Tile.ArmorLegsTitanium]: paintArmorPiece('leggings', ARMOR_TITAN),
  [Tile.ArmorBootsTitanium]: paintArmorPiece('boots', ARMOR_TITAN),
  [Tile.Pistol]: flipX(paintPistol),
  [Tile.Rifle]: flipX(paintRifle),
  [Tile.RocketLauncher]: flipX(paintRocketLauncher),
  [Tile.Shotgun]: flipX(paintShotgun),
  [Tile.SMG]: flipX(paintSMG),
  [Tile.Sniper]: flipX(paintSniper),
  [Tile.BurstRifle]: flipX(paintBurstRifle),
  [Tile.Bullet]: paintBullet,
  [Tile.Rocket]: paintRocket,
  [Tile.Glider]: paintGlider,
  // Automation (M13)
  [Tile.CobaltOre]: paintOre(COBALT_SPOT, COBALT_SPOT2),
  [Tile.CobaltIngot]: paintIngot([130, 150, 210, 255]),
  [Tile.OilBarrel]: paintOilBarrel,
  [Tile.OilShale]: paintOilShale,
  [Tile.AutominerSide]: paintAutominerSide,
  [Tile.AutominerTop]: paintAutominerTop,
  [Tile.OilDerrickSide]: paintOilDerrickSide,
  [Tile.OilDerrickTop]: paintOilDerrickTop,
  [Tile.MachinePart]: paintMachinePart,
  [Tile.TurretSide]: flipX(paintTurretSide),
  [Tile.TurretTop]: paintTurretTop,
  [Tile.Cannonball]: paintCannonball,
  [Tile.BirchPlanks]: paintBirchPlanks,
  [Tile.SprucePlanks]: paintSprucePlanks,
  [Tile.CoreSide]: paintCoreSide,
  [Tile.CoreTop]: paintCoreTop,
  [Tile.RespawnBeaconSide]: paintRespawnBeaconSide,
  [Tile.RespawnBeaconTop]: paintRespawnBeaconTop,
  [Tile.WaypointTotemSide]: paintWaypointTotemSide,
  [Tile.WaypointTotemTop]: paintWaypointTotemTop,
  // Discovery biomes (Milestone C)
  [Tile.JungleLogSide]: paintJungleLogSide,
  [Tile.JungleLogTop]: paintJungleLogTop,
  [Tile.JungleLeaves]: paintLeaves, // biome-foliage tinted, like oak
  [Tile.JunglePlanks]: (p, seed) => paintPlanksColored(p, seed, [150, 112, 66, 255]),
  [Tile.CherryLogSide]: paintCherryLogSide,
  [Tile.CherryLogTop]: paintCherryLogTop,
  [Tile.CherryLeaves]: paintColoredLeaves([236, 160, 190, 255]), // fixed pink (untinted)
  [Tile.CherryPlanks]: (p, seed) => paintPlanksColored(p, seed, [226, 188, 184, 255]),
  [Tile.Mud]: paintMud,
  [Tile.CrystalBlock]: paintCrystalBlock,
  [Tile.CrystalShard]: paintCrystalShard,
  // New mobs (Milestone C): spitter = sickly bog green, skitter = dark chitin.
  [Tile.SpitterSkin]: paintSkin([128, 148, 84, 255], 0.16, [96, 116, 60, 255]),
  [Tile.SpitterFace]: paintFace([128, 148, 84, 255], [230, 210, 60, 255],
    { color: [58, 78, 40, 255], x0: 5, y0: 9, x1: 10, y1: 12 }), // wide dark maw
  [Tile.SkitterSkin]: paintSkin([56, 50, 66, 255], 0.2, [84, 74, 96, 255]),
  [Tile.SkitterFace]: paintFace([56, 50, 66, 255], [255, 90, 70, 255], null, 4),
  // Dungeons (Milestone D): vault masonry, the relic chest, the Brute.
  [Tile.VaultBrick]: paintVaultBrick,
  [Tile.VaultChestSide]: paintVaultChestSide,
  [Tile.VaultChestTop]: paintVaultChestTop,
  // Vault Brute: a hulking mossy-stone zombie — pale glowing eyes, heavy jaw.
  [Tile.BruteSkin]: paintSkin([98, 112, 86, 255], 0.18, [72, 84, 62, 255]),
  [Tile.BruteFace]: paintFace([98, 112, 86, 255], [235, 245, 170, 255],
    { color: [50, 58, 44, 255], x0: 4, y0: 9, x1: 11, y1: 13 }), // heavy dark jaw
  [Tile.RedSand]: paintRedSand,
  [Tile.Terracotta]: paintTerracotta,
  [Tile.Basalt]: paintBasalt,
  [Tile.Lava]: paintLava,
  // Gadgets (Phase 8)
  [Tile.Grenade]: paintGrenade,
  [Tile.C4]: paintC4,
  [Tile.GrapplingHook]: paintGrapplingHook,
  [Tile.DeployCover]: paintDeployCover,
  [Tile.SentryKit]: paintSentryKit,
  [Tile.SmokeGrenade]: paintSmokeGrenade,
  [Tile.WarHorn]: paintWarHorn,
  [Tile.OilBomb]: paintOilBomb,
  [Tile.SpyDisguise]: paintSpyDisguise,
  [Tile.JumpBoost]: paintJumpBoost,
  // Lifesteal (Milestone A)
  [Tile.Heart]: paintHeart,
  [Tile.RevivalBeacon]: paintRevivalBeacon,
  // Healing consumables
  [Tile.BandageSprite]: paintBandage,
  [Tile.MedkitSprite]: paintMedkit,
  // Runes
  [Tile.RuneIron]: paintRuneIron,
  [Tile.RuneSwift]: paintRuneSwift,
  [Tile.RuneFortune]: paintRuneFortune,
  [Tile.RuneFocus]: paintRuneFocus,
  [Tile.SpikeTrapTop]: paintSpikeTrapTop,
  [Tile.SpikeTrapSide]: paintSpikeTrapSide,
  [Tile.LandmineTop]: paintLandmineTop,
  [Tile.LandmineSide]: paintLandmineSide,
  [Tile.Boat]: paintBoat,
  [Tile.MobSpawner]: paintMobSpawner,
  [Tile.VaultCompass1]: paintVaultCompass([150, 152, 160, 255], [204, 208, 216, 255]),
  [Tile.VaultCompass2]: paintVaultCompass([214, 176, 72, 255], [246, 216, 120, 255]),
  [Tile.VaultCompass3]: paintVaultCompass([84, 190, 210, 255], [150, 236, 244, 255]),
  // Early-game armor (wood + stone starter sets).
  [Tile.ArmorHelmetWood]: paintArmorPiece('helmet', ARMOR_WOOD),
  [Tile.ArmorChestWood]: paintArmorPiece('chestplate', ARMOR_WOOD),
  [Tile.ArmorLegsWood]: paintArmorPiece('leggings', ARMOR_WOOD),
  [Tile.ArmorBootsWood]: paintArmorPiece('boots', ARMOR_WOOD),
  [Tile.ArmorHelmetStone]: paintArmorPiece('helmet', ARMOR_STONE),
  [Tile.ArmorChestStone]: paintArmorPiece('chestplate', ARMOR_STONE),
  [Tile.ArmorLegsStone]: paintArmorPiece('leggings', ARMOR_STONE),
  [Tile.ArmorBootsStone]: paintArmorPiece('boots', ARMOR_STONE),
  // Lever-triggered traps.
  [Tile.Lever]: paintLever(false),
  [Tile.LeverOn]: paintLever(true),
  [Tile.FallTrap]: paintFallTrap,
  [Tile.FallTrapOpen]: paintFallTrapOpen,
  [Tile.WallTrapTop]: paintWallTrapTop,
  [Tile.WallTrapSide]: paintWallTrapSide,
  // Solid gold block: bright bullion face with a raised rim + rivet corners.
  [Tile.GoldBlock]: (p, seed) => {
    const base: RGBA = [244, 208, 64, 255];
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        let f = 0.86 + hash2(seed, x, y) * 0.22;
        const edge = x === 0 || y === 0 || x === 15 || y === 15;
        const rim = !edge && (x === 1 || y === 1 || x === 14 || y === 14);
        if (edge) f *= 0.62;          // dark frame
        else if (rim) f *= 1.22;      // bright bevel
        else if ((x + y) % 7 === 0) f *= 1.12; // glinting streaks
        p.set(x, y, shade(base, Math.min(1.35, f)));
      }
    }
    // Rivets in the four inner corners.
    for (const [rx, ry] of [[3, 3], [12, 3], [3, 12], [12, 12]]) {
      p.set(rx, ry, shade(base, 1.32));
      p.set(rx + 1, ry + 1, shade(base, 0.6));
    }
  },
};

export function createAtlas(seed = 1337): Atlas {
  const canvas = document.createElement('canvas');
  canvas.width = ATLAS_PX;
  canvas.height = ATLAS_PX;
  const ctx = canvas.getContext('2d')!;

  for (const [tileStr, paint] of Object.entries(PAINTERS)) {
    const tile = Number(tileStr);
    const p = new Painter();
    paint(p, seed ^ (tile * 7919));
    const img = new ImageData(p.data, TILE_PX, TILE_PX);
    const col = tile % ATLAS_TILES;
    const row = Math.floor(tile / ATLAS_TILES);
    ctx.putImageData(img, col * TILE_PX, row * TILE_PX);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.colorSpace = THREE.SRGBColorSpace;

  const inset = 0.25 / ATLAS_PX; // quarter-texel inset against bleeding
  return {
    texture,
    canvas,
    uvRect(tile: Tile) {
      const col = tile % ATLAS_TILES;
      const row = Math.floor(tile / ATLAS_TILES);
      const u0 = col / ATLAS_TILES + inset;
      const u1 = (col + 1) / ATLAS_TILES - inset;
      const v1 = 1 - row / ATLAS_TILES - inset;
      const v0 = 1 - (row + 1) / ATLAS_TILES + inset;
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
