// Shared mini-block / sprite geometry per item id: the first-person held item
// and the item in a player model's hand.

import * as THREE from 'three';
import { BLOCKS, BlockInfo, Tile } from './blocks';
import { ITEMS } from './items';
import { TILE_PX, tileOrigin, type Atlas } from './textures';

// Geometry embeds UVs and (for slabs) the atlas's pixel silhouette. Copies
// borrow these geometries; a different atlas must never reuse them.
interface GeometryCache {
  items: Map<number, THREE.BufferGeometry>;
  blocks: Map<number, THREE.BufferGeometry>;
  solids: Map<string, THREE.BufferGeometry>;
}
const atlasCaches = new WeakMap<Atlas, GeometryCache>();
function cacheFor(atlas: Atlas): GeometryCache {
  let cache = atlasCaches.get(atlas);
  if (!cache) {
    cache = { items: new Map(), blocks: new Map(), solids: new Map() };
    atlasCaches.set(atlas, cache);
  }
  return cache;
}

const GRASS_TINT: [number, number, number] = [0.57, 0.74, 0.35];

// A 0.25 cube with one upright quad per face: bottom-left, bottom-right,
// top-right, top-left -> uv (0,0),(1,0),(1,1),(0,1). Shade per vanilla
// face brightness; grass tints only the top, foliage tints every face.
function buildCubeGeometry(atlas: Atlas, block: BlockInfo): THREE.BufferGeometry {
  const h = 0.125;
  const faces: {
    tile: Tile; shade: number; tinted: boolean;
    c: [number, number, number][];
  }[] = [
    { tile: block.top, shade: 1.0, tinted: block.tint !== null,
      c: [[-h, h, h], [h, h, h], [h, h, -h], [-h, h, -h]] },          // +y top
    { tile: block.bottom, shade: 0.5, tinted: block.tint === 'foliage',
      c: [[-h, -h, -h], [h, -h, -h], [h, -h, h], [-h, -h, h]] },      // -y bottom
    { tile: block.side, shade: 0.8, tinted: block.tint === 'foliage',
      c: [[-h, -h, h], [h, -h, h], [h, h, h], [-h, h, h]] },          // +z
    { tile: block.side, shade: 0.8, tinted: block.tint === 'foliage',
      c: [[h, -h, -h], [-h, -h, -h], [-h, h, -h], [h, h, -h]] },      // -z
    { tile: block.side, shade: 0.6, tinted: block.tint === 'foliage',
      c: [[h, -h, h], [h, -h, -h], [h, h, -h], [h, h, h]] },          // +x
    { tile: block.side, shade: 0.6, tinted: block.tint === 'foliage',
      c: [[-h, -h, -h], [-h, -h, h], [-h, h, h], [-h, h, -h]] },      // -x
  ];
  const positions: number[] = [];
  const uvs: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const quadUV = [[0, 0], [1, 0], [1, 1], [0, 1]];
  for (const f of faces) {
    const base = positions.length / 3;
    const [u0, v0, u1, v1] = atlas.uvRect(f.tile);
    for (let i = 0; i < 4; i++) {
      positions.push(f.c[i][0], f.c[i][1], f.c[i][2]);
      uvs.push(u0 + (u1 - u0) * quadUV[i][0], v0 + (v1 - v0) * quadUV[i][1]);
      const t = f.tinted ? GRASS_TINT : [1, 1, 1];
      colors.push(f.shade * t[0], f.shade * t[1], f.shade * t[2]);
    }
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.setIndex(indices);
  return geo;
}

/** A 0.25 textured cube of a placed block (no item needed), e.g. scenery. */
export function blockCubeGeometry(atlas: Atlas, blockId: number): THREE.BufferGeometry {
  const blockCache = cacheFor(atlas).blocks;
  let geo = blockCache.get(blockId);
  if (!geo) { geo = buildCubeGeometry(atlas, BLOCKS[blockId]); blockCache.set(blockId, geo); }
  return geo;
}

/** Mini-cube for cube blocks, a solid pixel slab for items, a flat card for
 *  the odd non-cube block (plants, torches). */
export function itemGeometry(atlas: Atlas, id: number): THREE.BufferGeometry {
  const geoCache = cacheFor(atlas).items;
  let geo = geoCache.get(id);
  if (geo) return geo;
  const info = ITEMS[id];
  const block = info?.kind === 'block' ? BLOCKS[info.block!] : null;
  if (!block && info?.sprite !== undefined) return itemGeometrySolid(atlas, id);
  if (block && block.shape === 'cube') {
    // Hand-built cube with explicit, upright per-face UVs and vanilla face
    // shading (top brightest). BoxGeometry's built-in UVs mis-orient the top
    // face; building it ourselves keeps every face textured correctly so the
    // held block reads like its hotbar icon.
    geo = buildCubeGeometry(atlas, block);
  } else {
    const tile: Tile = block ? block.side : info?.sprite ?? Tile.Stone;
    geo = new THREE.PlaneGeometry(0.45, 0.45);
    const uv = geo.getAttribute('uv') as THREE.BufferAttribute;
    const [u0, v0, u1, v1] = atlas.uvRect(tile);
    for (let k = 0; k < uv.count; k++) {
      uv.setXY(k, u0 + (u1 - u0) * uv.getX(k), v0 + (v1 - v0) * uv.getY(k));
    }
    const colors = new Float32Array(uv.count * 3).fill(1);
    if (block?.tint === 'grass') {
      for (let k = 0; k < uv.count; k++) {
        colors[k * 3] = 0.57; colors[k * 3 + 1] = 0.74; colors[k * 3 + 2] = 0.35;
      }
    }
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  }
  geoCache.set(id, geo);
  return geo;
}

/** A sprite item as a thin slab of real pixels (front, back and a visible rim
 *  made of each exposed pixel's own colour). Unlike the single flat plane in
 *  `itemGeometry`, it still reads as an object when it turns edge-on, which is
 *  what a held tool and an item lying on the ground both need. Blocks keep
 *  their mini-cube. */
export function itemGeometrySolid(atlas: Atlas, id: number, size = 0.45, depth = 0.04): THREE.BufferGeometry {
  const info = ITEMS[id];
  if (!info || info.kind === 'block' || info.sprite === undefined) return itemGeometry(atlas, id);
  const solidCache = cacheFor(atlas).solids;
  const key = `${id}:${size}:${depth}`;
  const cached = solidCache.get(key);
  if (cached) return cached;
  const tile = info.sprite, { x: ox, y: oy } = tileOrigin(tile);
  const ctx = atlas.canvas.getContext('2d')!;
  const px = ctx.getImageData(ox, oy, TILE_PX, TILE_PX).data;
  const opaque = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < TILE_PX && y < TILE_PX && px[(y * TILE_PX + x) * 4 + 3] > 40;
  // Exact tile bounds (no anti-bleed inset): the cut-out edge of the face
  // quads must land on the same pixel grid as the rim. The atlas gutter is an
  // extrusion of the edge pixels, so sampling right at the border is safe.
  const span = atlas.canvas.width;
  const u0 = ox / span, u1 = (ox + TILE_PX) / span, v1 = 1 - oy / span, v0 = 1 - (oy + TILE_PX) / span;
  const cell = size / TILE_PX, half = size / 2, d = depth / 2;
  const positions: number[] = [], uvs: number[] = [], colors: number[] = [], indices: number[] = [];
  const quad = (a: number[], b: number[], c: number[], e: number[], tx: number, ty: number, shade: number): void => {
    const base = positions.length / 3;
    positions.push(...a, ...b, ...c, ...e);
    // Every corner samples the pixel's centre so the whole quad is one flat colour.
    const u = u0 + (u1 - u0) * (tx + 0.5) / TILE_PX, v = v1 - (v1 - v0) * (ty + 0.5) / TILE_PX;
    for (let i = 0; i < 4; i++) { uvs.push(u, v); colors.push(shade, shade, shade); }
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };
  // Front and back are each ONE quad over the whole tile, cut out by the
  // material's alphaTest: per-pixel quads never share bit-identical edges, and
  // the hairline cracks between them showed the scene through the item.
  const flat = (z: number, shade: number, flip: boolean): void => {
    const base = positions.length / 3;
    const [l, r] = flip ? [half, -half] : [-half, half];
    positions.push(l, -half, z, r, -half, z, r, half, z, l, half, z);
    const [ul, ur] = flip ? [u1, u0] : [u0, u1];
    uvs.push(ul, v0, ur, v0, ur, v1, ul, v1);
    for (let i = 0; i < 4; i++) colors.push(shade, shade, shade);
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };
  flat(d, 1, false);
  flat(-d, 0.8, true);
  // The rim: one quad on every pixel edge that faces a transparent neighbour.
  const at = (i: number): number => -half + i * cell;
  for (let y = 0; y < TILE_PX; y++) for (let x = 0; x < TILE_PX; x++) {
    if (!opaque(x, y)) continue;
    const lx = at(x), hx = at(x + 1), ty = -at(y), by = -at(y + 1);
    if (!opaque(x - 1, y)) quad([lx, by, -d], [lx, by, d], [lx, ty, d], [lx, ty, -d], x, y, 0.65);
    if (!opaque(x + 1, y)) quad([hx, by, d], [hx, by, -d], [hx, ty, -d], [hx, ty, d], x, y, 0.65);
    if (!opaque(x, y - 1)) quad([lx, ty, d], [hx, ty, d], [hx, ty, -d], [lx, ty, -d], x, y, 0.9);
    if (!opaque(x, y + 1)) quad([lx, by, -d], [hx, by, -d], [hx, by, d], [lx, by, d], x, y, 0.5);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.setIndex(indices);
  solidCache.set(key, geo);
  return geo;
}
