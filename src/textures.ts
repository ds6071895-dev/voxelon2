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
  for (let i = 0; i < 40; i++) {
    const x = 3 + Math.floor(hash2(seed, i, 0) * 10);
    const y = 7 + Math.floor(hash2(seed, i, 1) * 7);
    const d = Math.abs(x - 8) + Math.abs(y - 11);
    if (d > 6) continue;
    p.set(x, y, shade([220, 30, 20, 255], 0.7 + hash2(seed, x, y) * 0.6));
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
