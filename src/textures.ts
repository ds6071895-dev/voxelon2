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
    const stick = (x: number, y: number) =>
      p.set(x, y, shade(STICK_COLOR, 0.85 + hash2(seed, x, y) * 0.3));

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
      return;
    }
    // diagonal handle for pickaxe/axe/shovel
    for (let i = 0; i < 8; i++) {
      stick(3 + i, 12 - i);
      if (i < 7) stick(4 + i, 12 - i);
    }
    if (type === 'pickaxe') {
      const arc = [
        [5, 4], [6, 3], [7, 2], [8, 2], [9, 2], [10, 2],
        [11, 3], [12, 4], [13, 5], [13, 6],
      ];
      for (const [x, y] of arc) { mat(x, y); mat(x, y + 1, 0.75); }
    } else if (type === 'axe') {
      for (const [x, y] of [
        [8, 1], [9, 1], [10, 2], [11, 3], [7, 2], [8, 2], [9, 2],
        [8, 3], [9, 3], [10, 3], [9, 4], [10, 4],
      ]) mat(x, y, 0.9 + (x % 2) * 0.1);
    } else { // shovel
      for (const [x, y] of [
        [11, 2], [12, 2], [13, 2], [11, 3], [12, 3], [13, 3],
        [11, 4], [12, 4], [13, 4], [12, 5], [13, 5], [12, 1],
      ]) mat(x, y, 0.9);
    }
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

const GUN_METAL: RGBA = [78, 82, 92, 255];
const GUN_DARK: RGBA = [38, 40, 46, 255];
const GUN_GRIP: RGBA = [66, 48, 36, 255];

function paintPistol(p: Painter, seed: number): void {
  const m = (x: number, y: number, c: RGBA) => p.set(x, y, shade(c, 0.9 + hash2(seed, x, y) * 0.2));
  for (let x = 3; x <= 11; x++) { m(x, 6, GUN_METAL); m(x, 7, GUN_DARK); } // slide + barrel
  m(11, 6, [20, 20, 24, 255]); // muzzle
  for (let y = 8; y <= 12; y++) { m(5, y, GUN_GRIP); m(6, y, GUN_GRIP); }  // grip
  m(7, 8, GUN_METAL); m(4, 8, GUN_METAL);                                  // trigger area
}

function paintRifle(p: Painter, seed: number): void {
  const m = (x: number, y: number, c: RGBA) => p.set(x, y, shade(c, 0.9 + hash2(seed, x, y) * 0.2));
  for (let x = 1; x <= 14; x++) m(x, 6, GUN_METAL);                        // long barrel
  for (let x = 2; x <= 9; x++) m(x, 7, GUN_DARK);                          // receiver
  m(14, 6, [20, 20, 24, 255]);
  for (let y = 7; y <= 11; y++) m(2, y, GUN_GRIP);                          // stock/grip
  m(3, 11, GUN_GRIP); m(4, 11, GUN_GRIP);
  for (let y = 8; y <= 11; y++) m(7, y, GUN_DARK);                          // magazine
  m(6, 9, GUN_DARK); m(8, 9, GUN_DARK);
}

function paintRocketLauncher(p: Painter, seed: number): void {
  const m = (x: number, y: number, c: RGBA) => p.set(x, y, shade(c, 0.9 + hash2(seed, x, y) * 0.2));
  for (let y = 5; y <= 8; y++) for (let x = 1; x <= 14; x++) m(x, y, y < 7 ? GUN_METAL : GUN_DARK); // tube
  for (let y = 5; y <= 8; y++) m(1, y, [20, 20, 24, 255]);                  // back vent
  for (let y = 5; y <= 8; y++) m(14, y, [24, 24, 28, 255]);                 // muzzle
  for (let y = 9; y <= 12; y++) m(6, y, GUN_GRIP);                          // grip
  m(10, 4, GUN_DARK); m(11, 4, GUN_DARK);                                   // sight
}

function paintBullet(p: Painter, seed: number): void {
  const brass: RGBA = [206, 170, 70, 255], tip: RGBA = [150, 120, 60, 255];
  for (let y = 5; y <= 11; y++) {
    for (let x = 6; x <= 9; x++) {
      const c = y <= 6 ? tip : brass;
      p.set(x, y, shade(c, 0.85 + hash2(seed, x, y) * 0.3));
    }
  }
  p.set(7, 4, tip); p.set(8, 4, tip);          // pointed tip
  for (let x = 6; x <= 9; x++) p.set(x, 11, [120, 96, 50, 255]); // rim
}

function paintRocket(p: Painter, seed: number): void {
  const body: RGBA = [180, 60, 50, 255], nose: RGBA = [220, 220, 220, 255];
  for (let y = 6; y <= 12; y++) for (let x = 6; x <= 9; x++)
    p.set(x, y, shade(body, 0.85 + hash2(seed, x, y) * 0.3));
  p.set(7, 4, nose); p.set(8, 4, nose);
  p.set(6, 5, nose); p.set(7, 5, nose); p.set(8, 5, nose); p.set(9, 5, nose);
  for (const [x, y] of [[5, 12], [10, 12], [5, 13], [10, 13]]) p.set(x, y, [90, 90, 96, 255]); // fins
  p.set(7, 14, [255, 200, 90, 255]); p.set(8, 14, [255, 160, 60, 255]);     // exhaust
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
  // hazard stripe band
  for (let x = 1; x <= 14; x++) {
    const c: RGBA = ((x + 1) >> 1) % 2 ? [230, 196, 40, 255] : [40, 40, 44, 255];
    p.set(x, 2, c); p.set(x, 3, c);
  }
  // central drill bit pointing down
  const bit: RGBA = [184, 188, 194, 255];
  for (let y = 6; y <= 11; y++) {
    const w = 11 - y;
    for (let x = 7 - w; x <= 8 + w; x++) p.set(x, y, shade(bit, 0.78 + hash2(seed, x, y) * 0.3));
  }
  p.set(7, 12, [150, 154, 160, 255]); p.set(8, 12, [150, 154, 160, 255]);
}

function paintAutominerTop(p: Painter, seed: number): void {
  paintMachineFrame(p, seed, [110, 114, 122, 255]);
  // central bore hole
  for (let a = 0; a < 16; a++) {
    const ang = (a / 16) * Math.PI * 2;
    p.set(Math.round(7.5 + 3 * Math.cos(ang)), Math.round(7.5 + 3 * Math.sin(ang)), MACHINE_DARK);
  }
  for (let y = 6; y <= 9; y++) for (let x = 6; x <= 9; x++) p.set(x, y, [24, 24, 28, 255]);
}

function paintOilDerrickSide(p: Painter, seed: number): void {
  paintMachineFrame(p, seed, [96, 100, 108, 255]);
  const beam: RGBA = [40, 40, 44, 255];
  // A-frame derrick legs that taper toward the top
  for (let y = 2; y <= 13; y++) {
    const inset = Math.floor((13 - y) / 3);
    p.set(3 + inset, y, beam); p.set(12 - inset, y, beam);
  }
  for (const yy of [4, 7, 10]) for (let x = 4; x <= 11; x++) p.set(x, yy, beam); // braces
  for (let x = 5; x <= 10; x++) p.set(x, 13, [24, 22, 20, 255]); // oil pool at base
}

function paintOilDerrickTop(p: Painter, seed: number): void {
  paintMachineFrame(p, seed, [96, 100, 108, 255]);
  // red wellhead valve wheel
  const red: RGBA = [180, 60, 50, 255];
  for (let a = 0; a < 16; a++) {
    const ang = (a / 16) * Math.PI * 2;
    p.set(Math.round(7.5 + 3 * Math.cos(ang)), Math.round(7.5 + 3 * Math.sin(ang)), red);
  }
  for (let y = 7; y <= 8; y++) for (let x = 7; x <= 8; x++) p.set(x, y, MACHINE_FRAME);
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
function paintShipHelmSide(p: Painter, seed: number): void {
  // A wooden ship's wheel mounted on a planks face.
  paintPlanks(p, seed);
  const rim: RGBA = [120, 86, 44, 255];
  const spoke: RGBA = [150, 110, 60, 255];
  for (let a = 0; a < 24; a++) {
    const ang = (a / 24) * Math.PI * 2;
    p.set(Math.round(7.5 + 5 * Math.cos(ang)), Math.round(7.5 + 5 * Math.sin(ang)), rim);
    p.set(Math.round(7.5 + 6 * Math.cos(ang)), Math.round(7.5 + 6 * Math.sin(ang)), shade(rim, 0.7));
  }
  for (let a = 0; a < 8; a++) {
    const ang = (a / 8) * Math.PI * 2;
    for (let r = 0; r <= 6; r++) {
      p.set(Math.round(7.5 + r * Math.cos(ang)), Math.round(7.5 + r * Math.sin(ang)), spoke);
    }
  }
  p.set(7, 7, [60, 44, 24, 255]); p.set(8, 8, [60, 44, 24, 255]); // hub
}

function paintShipHelmTop(p: Painter, seed: number): void {
  paintPlanks(p, seed);
  const brass: RGBA = [196, 150, 64, 255];
  for (let y = 6; y <= 9; y++) for (let x = 6; x <= 9; x++) p.set(x, y, shade(brass, 0.8 + hash2(seed, x, y) * 0.3));
  for (let i = 4; i <= 11; i++) { p.set(i, 7, brass); p.set(i, 8, brass); }
}

function paintCannonSide(p: Painter, seed: number): void {
  paintMachineFrame(p, seed, [70, 72, 80, 255]);
  // A dark barrel running left->right with a muzzle ring at the right.
  const barrel: RGBA = [44, 46, 52, 255];
  for (let y = 6; y <= 9; y++) for (let x = 2; x <= 13; x++) {
    p.set(x, y, shade(barrel, 0.85 + hash2(seed, x, y) * 0.25));
  }
  for (let y = 5; y <= 10; y++) { p.set(12, y, [24, 24, 28, 255]); p.set(13, y, [16, 16, 18, 255]); }
  for (let x = 3; x <= 9; x++) p.set(x, 11, [96, 70, 38, 255]); // wood carriage
}

function paintCannonTop(p: Painter, seed: number): void {
  paintMachineFrame(p, seed, [80, 82, 90, 255]);
  for (let a = 0; a < 16; a++) {
    const ang = (a / 16) * Math.PI * 2;
    p.set(Math.round(7.5 + 3 * Math.cos(ang)), Math.round(7.5 + 3 * Math.sin(ang)), [40, 40, 46, 255]);
  }
  for (let y = 6; y <= 9; y++) for (let x = 6; x <= 9; x++) p.set(x, y, [18, 18, 20, 255]); // bore
}

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
  [Tile.Bullet]: paintBullet,
  [Tile.Rocket]: paintRocket,
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
  [Tile.ShipHelmSide]: paintShipHelmSide,
  [Tile.ShipHelmTop]: paintShipHelmTop,
  [Tile.CannonSide]: flipX(paintCannonSide),
  [Tile.CannonTop]: paintCannonTop,
  [Tile.TurretSide]: flipX(paintTurretSide),
  [Tile.TurretTop]: paintTurretTop,
  [Tile.Cannonball]: paintCannonball,
  [Tile.BirchPlanks]: paintBirchPlanks,
  [Tile.SprucePlanks]: paintSprucePlanks,
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
