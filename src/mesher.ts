// Chunk mesher: culled faces, vanilla directional shading, per-vertex
// ambient occlusion (the classic 0-3 corner test), AO-aware quad flipping.

import * as THREE from 'three';
import type { ColumnTints, Tint } from './biomes';
import { Block, BLOCKS, isOpaque, occludesAO, Tile, torchSupport } from './blocks';
import { Chunk, CHUNK_X, CHUNK_Z } from './chunk';
import type { LightField } from './light';
import { renderBoxes } from './shapes';
import type { Atlas } from './textures';

const WHITE: Tint = [1, 1, 1];

// Vanilla face brightness: top 1.0, bottom 0.5, N/S 0.8, E/W 0.6.
interface FaceDef {
  dir: [number, number, number];
  shade: number;
  corners: { pos: [number, number, number]; uv: [number, number] }[];
}

const FACES: FaceDef[] = [
  { // -x (west)
    dir: [-1, 0, 0], shade: 0.6,
    corners: [
      { pos: [0, 1, 0], uv: [0, 1] },
      { pos: [0, 0, 0], uv: [0, 0] },
      { pos: [0, 1, 1], uv: [1, 1] },
      { pos: [0, 0, 1], uv: [1, 0] },
    ],
  },
  { // +x (east)
    dir: [1, 0, 0], shade: 0.6,
    corners: [
      { pos: [1, 1, 1], uv: [0, 1] },
      { pos: [1, 0, 1], uv: [0, 0] },
      { pos: [1, 1, 0], uv: [1, 1] },
      { pos: [1, 0, 0], uv: [1, 0] },
    ],
  },
  { // -y (bottom)
    dir: [0, -1, 0], shade: 0.5,
    corners: [
      { pos: [1, 0, 1], uv: [1, 0] },
      { pos: [0, 0, 1], uv: [0, 0] },
      { pos: [1, 0, 0], uv: [1, 1] },
      { pos: [0, 0, 0], uv: [0, 1] },
    ],
  },
  { // +y (top)
    dir: [0, 1, 0], shade: 1.0,
    corners: [
      { pos: [0, 1, 1], uv: [1, 1] },
      { pos: [1, 1, 1], uv: [0, 1] },
      { pos: [0, 1, 0], uv: [1, 0] },
      { pos: [1, 1, 0], uv: [0, 0] },
    ],
  },
  { // -z (north)
    dir: [0, 0, -1], shade: 0.8,
    corners: [
      { pos: [1, 0, 0], uv: [0, 0] },
      { pos: [0, 0, 0], uv: [1, 0] },
      { pos: [1, 1, 0], uv: [0, 1] },
      { pos: [0, 1, 0], uv: [1, 1] },
    ],
  },
  { // +z (south)
    dir: [0, 0, 1], shade: 0.8,
    corners: [
      { pos: [0, 0, 1], uv: [0, 0] },
      { pos: [1, 0, 1], uv: [1, 0] },
      { pos: [0, 1, 1], uv: [0, 1] },
      { pos: [1, 1, 1], uv: [1, 1] },
    ],
  },
];

const AO_CURVE = [0.45, 0.65, 0.82, 1.0];

/** Tile UV (fraction 0..1) for a corner on face f of a sub-box, so partial-extent
 *  boxes (slabs/stairs) sample the matching window of the tile. Face order
 *  matches FACES: 0=-x 1=+x 2=-y 3=+y 4=-z 5=+z. */
export function subFaceUV(f: number, lx: number, ly: number, lz: number): [number, number] {
  switch (f) {
    case 0: return [lz, ly];          // -x
    case 1: return [1 - lz, ly];      // +x
    case 2: return [lx, 1 - lz];      // -y
    case 3: return [1 - lx, lz];      // +y
    case 4: return [1 - lx, ly];      // -z
    default: return [lx, ly];         // +z
  }
}

export type BlockSampler = (wx: number, wy: number, wz: number) => number;
export type TintSampler = (wx: number, wz: number) => ColumnTints;

class GeoBuffer {
  positions: number[] = [];
  colors: number[] = [];
  uvs: number[] = [];
  lights: number[] = []; // (sky, block) per vertex, normalized 0-1
  indices: number[] = [];

  quad(
    face: FaceDef, bx: number, by: number, bz: number,
    uvRect: [number, number, number, number], ao: number[],
    topOffset: number, tint: Tint, skyL: number, blockL: number
  ): void {
    const base = this.positions.length / 3;
    const [u0, v0, u1, v1] = uvRect;
    for (let i = 0; i < 4; i++) {
      const c = face.corners[i];
      let y = by + c.pos[1];
      if (topOffset && c.pos[1] === 1) y -= topOffset;
      this.positions.push(bx + c.pos[0], y, bz + c.pos[2]);
      const b = face.shade * AO_CURVE[ao[i]];
      this.colors.push(b * tint[0], b * tint[1], b * tint[2]);
      this.uvs.push(u0 + (u1 - u0) * c.uv[0], v0 + (v1 - v0) * c.uv[1]);
      this.lights.push(skyL / 15, blockL / 15);
    }
    // Flip the quad diagonal when needed so AO interpolates correctly.
    if (ao[0] + ao[3] > ao[1] + ao[2]) {
      this.indices.push(base, base + 1, base + 3, base, base + 3, base + 2);
    } else {
      this.indices.push(base, base + 1, base + 2, base + 2, base + 1, base + 3);
    }
  }

  /** Two diagonal quads, double-sided — billboard plants. */
  cross(
    bx: number, by: number, bz: number,
    uvRect: [number, number, number, number], tint: Tint,
    skyL: number, blockL: number
  ): void {
    const [u0, v0, u1, v1] = uvRect;
    const diags: [number, number, number, number][] = [
      [0.15, 0.15, 0.85, 0.85],
      [0.15, 0.85, 0.85, 0.15],
    ];
    for (const [x1, z1, x2, z2] of diags) {
      const base = this.positions.length / 3;
      this.positions.push(
        bx + x1, by, bz + z1,
        bx + x2, by, bz + z2,
        bx + x1, by + 1, bz + z1,
        bx + x2, by + 1, bz + z2
      );
      for (let i = 0; i < 4; i++) {
        this.colors.push(tint[0], tint[1], tint[2]);
        this.lights.push(skyL / 15, blockL / 15);
      }
      this.uvs.push(u0, v0, u1, v0, u0, v1, u1, v1);
      this.indices.push(
        base, base + 1, base + 2, base + 2, base + 1, base + 3, // front
        base + 2, base + 1, base, base + 3, base + 1, base + 2  // back
      );
    }
  }

  /** A small textured box (torches), using a sub-rect of one tile. */
  box(
    bx: number, by: number, bz: number,
    min: [number, number, number], max: [number, number, number],
    uvRect: [number, number, number, number],
    skyL: number, blockL: number
  ): void {
    const [u0, v0, u1, v1] = uvRect;
    for (const face of FACES) {
      // Sub-rect of the torch sprite per face: sides show the stick column,
      // top shows the tip, bottom the stick base.
      const vertical = face.dir[1] !== 0;
      const su0 = 7 / 16, su1 = 9 / 16;
      const sv0 = vertical ? (face.dir[1] > 0 ? 8 / 16 : 0) : 0;
      const sv1 = vertical ? (face.dir[1] > 0 ? 10 / 16 : 2 / 16) : 10 / 16;
      const base = this.positions.length / 3;
      for (let i = 0; i < 4; i++) {
        const c = face.corners[i];
        this.positions.push(
          bx + min[0] + (max[0] - min[0]) * c.pos[0],
          by + min[1] + (max[1] - min[1]) * c.pos[1],
          bz + min[2] + (max[2] - min[2]) * c.pos[2]
        );
        const b = face.shade;
        this.colors.push(b, b, b);
        const su = su0 + (su1 - su0) * c.uv[0];
        const sv = sv0 + (sv1 - sv0) * c.uv[1];
        this.uvs.push(u0 + (u1 - u0) * su, v0 + (v1 - v0) * sv);
        this.lights.push(skyL / 15, blockL / 15);
      }
      this.indices.push(base, base + 1, base + 2, base + 2, base + 1, base + 3);
    }
  }

  /** An axis-aligned sub-box (slabs/stairs) with per-face tile sub-rect UVs +
   *  directional shading (no AO). The box min/max are in [0,1] cell-local space,
   *  so a half-height box samples the matching half of the tile. */
  subBox(
    bx: number, by: number, bz: number,
    min: [number, number, number], max: [number, number, number],
    uvRect: [number, number, number, number], tint: Tint,
    skyL: number, blockL: number
  ): void {
    const [u0, v0, u1, v1] = uvRect;
    for (let f = 0; f < FACES.length; f++) {
      const face = FACES[f];
      const base = this.positions.length / 3;
      for (let i = 0; i < 4; i++) {
        const c = face.corners[i].pos;
        const lx = c[0] ? max[0] : min[0];
        const ly = c[1] ? max[1] : min[1];
        const lz = c[2] ? max[2] : min[2];
        this.positions.push(bx + lx, by + ly, bz + lz);
        const b = face.shade;
        this.colors.push(b * tint[0], b * tint[1], b * tint[2]);
        const [fu, fv] = subFaceUV(f, lx, ly, lz);
        this.uvs.push(u0 + (u1 - u0) * fu, v0 + (v1 - v0) * fv);
        this.lights.push(skyL / 15, blockL / 15);
      }
      this.indices.push(base, base + 1, base + 2, base + 2, base + 1, base + 3);
    }
  }

  build(): THREE.BufferGeometry | null {
    if (this.indices.length === 0) return null;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(this.positions, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(this.colors, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(this.uvs, 2));
    geo.setAttribute('skyblock', new THREE.Float32BufferAttribute(this.lights, 2));
    geo.setIndex(this.indices);
    geo.computeBoundingSphere();
    return geo;
  }
}

export interface ChunkGeometry {
  opaque: THREE.BufferGeometry | null;
  water: THREE.BufferGeometry | null;
}

export function buildChunkGeometry(
  chunk: Chunk, sample: BlockSampler, atlas: Atlas, tints: TintSampler,
  light: LightField
): ChunkGeometry {
  const opaque = new GeoBuffer();
  const water = new GeoBuffer();
  const ox = chunk.cx * CHUNK_X;
  const oz = chunk.cz * CHUNK_Z;
  const maxY = Math.min(chunk.maxY, 256);
  const ao = [0, 0, 0, 0];

  for (let x = 0; x < CHUNK_X; x++) {
    for (let z = 0; z < CHUNK_Z; z++) {
      const wx = ox + x, wz = oz + z;
      let columnTints: ColumnTints | null = null; // computed lazily per column
      const tintFor = (kind: 'grass' | 'foliage'): Tint => {
        columnTints ??= tints(wx, wz);
        return columnTints[kind];
      };

      for (let y = 0; y < maxY; y++) {
        const id = chunk.get(x, y, z);
        if (id === Block.Air || id === Block.Barrier) continue;
        const info = BLOCKS[id];
        // An id with no definition is a block this build no longer knows (a
        // world saved by an older build). Skip it rather than dereferencing
        // undefined and taking the whole chunk mesh down with it.
        if (!info) continue;
        const isWater = id === Block.Water;

        if (info.shape === 'cross') {
          opaque.cross(
            x, y, z, atlas.uvRect(info.side),
            info.tint ? tintFor(info.tint) : WHITE,
            light.sky(wx, y, wz), light.block(wx, y, wz)
          );
          continue;
        }

        if (info.shape === 'torch') {
          // Wall torches shift toward their supporting block and sit higher.
          const sup = torchSupport(id);
          const wall = sup && sup[1] === 0;
          const offX = wall ? sup![0] * 0.3125 : 0;
          const offZ = wall ? sup![2] * 0.3125 : 0;
          const offY = wall ? 0.1875 : 0;
          opaque.box(
            x, y, z,
            [0.4375 + offX, offY, 0.4375 + offZ],
            [0.5625 + offX, 0.625 + offY, 0.5625 + offZ],
            atlas.uvRect(info.side),
            light.sky(wx, y, wz), light.block(wx, y, wz)
          );
          continue;
        }

        if (info.shape === 'slab' || info.shape === 'stairs') {
          const uvRect = atlas.uvRect(info.side);
          const skyL = light.sky(wx, y, wz), blockL = light.block(wx, y, wz);
          const boxes = renderBoxes(id);
          for (const [mn, mx] of boxes) {
            opaque.subBox(x, y, z, mn, mx, uvRect, WHITE, skyL, blockL);
          }
          continue;
        }

        for (const face of FACES) {
          const [dx, dy, dz] = face.dir;
          const ny = y + dy;
          const neighbor = ny < 0
            ? Block.Bedrock // never draw the underside of the world
            : sample(wx + dx, ny, wz + dz);

          if (isWater) {
            if (neighbor === Block.Water || isOpaque(neighbor)) continue;
          } else {
            if (isOpaque(neighbor) || neighbor === id) continue;
          }

          // Per-vertex AO (skip for water: it has no corner shading).
          if (isWater) {
            ao[0] = ao[1] = ao[2] = ao[3] = 3;
          } else {
            computeAO(face, wx, y, wz, sample, ao);
          }

          const tile: Tile = dy > 0 ? info.top : dy < 0 ? info.bottom : info.side;
          // Lower water surface slightly when open to the sky, like vanilla.
          const topOffset =
            isWater && sample(wx, y + 1, wz) !== Block.Water ? 0.125 : 0;

          // Biome tint: foliage tints every face; grass only the top face
          // (the side fringe is baked into the texture).
          const tint: Tint =
            info.tint === 'foliage' ? tintFor('foliage')
            : info.tint === 'grass' && dy > 0 ? tintFor('grass')
            : WHITE;

          // Faces are lit by the cell they are exposed to.
          const ly = Math.max(0, ny);
          const skyL = light.sky(wx + dx, ly, wz + dz);
          const blockL = light.block(wx + dx, ly, wz + dz);

          (isWater ? water : opaque).quad(
            face, x, y, z, atlas.uvRect(tile), ao, topOffset, tint, skyL, blockL
          );
        }
      }
    }
  }

  return { opaque: opaque.build(), water: water.build() };
}

function computeAO(
  face: FaceDef, wx: number, wy: number, wz: number,
  sample: BlockSampler, out: number[]
): void {
  const [dx, dy, dz] = face.dir;
  // Tangent axes = the two axes perpendicular to the face normal.
  const axis = dx !== 0 ? 0 : dy !== 0 ? 1 : 2;
  const t1 = axis === 0 ? 1 : 0;
  const t2 = axis === 2 ? 1 : 2;
  const pos = [wx, wy, wz];

  for (let i = 0; i < 4; i++) {
    const c = face.corners[i].pos;
    const s1 = c[t1] === 1 ? 1 : -1;
    const s2 = c[t2] === 1 ? 1 : -1;

    const p = [pos[0] + dx, pos[1] + dy, pos[2] + dz];
    const q1 = [...p]; q1[t1] += s1;
    const q2 = [...p]; q2[t2] += s2;
    const q3 = [...p]; q3[t1] += s1; q3[t2] += s2;

    const side1 = occludesAO(sample(q1[0], q1[1], q1[2])) ? 1 : 0;
    const side2 = occludesAO(sample(q2[0], q2[1], q2[2])) ? 1 : 0;
    const corner = occludesAO(sample(q3[0], q3[1], q3[2])) ? 1 : 0;

    out[i] = side1 && side2 ? 0 : 3 - (side1 + side2 + corner);
  }
}
