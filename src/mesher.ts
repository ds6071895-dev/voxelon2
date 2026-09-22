// Chunk mesher: culled faces, vanilla directional shading, per-vertex
// ambient occlusion (the classic 0-3 corner test), AO-aware quad flipping,
// and optional smooth lighting (per-vertex light averaged over the four cells
// touching each corner instead of one flat level per face).

import * as THREE from 'three';
import type { ColumnTints, Tint } from './biomes';
import { Block, BLOCKS, isOpaque, occludesAO, Tile, torchSupport } from './blocks';
import { TRAP_MODEL_BLOCKS } from './trapmodels';
import { Chunk, CHUNK_X, CHUNK_Z } from './chunk';
import type { LightField } from './light';
import { renderBoxes } from './shapes';
import type { Atlas } from './textures';

const WHITE: Tint = [1, 1, 1];

/** Halfway between white and a tint. The grass-block side is mostly dirt, so
 *  its top vertices take a softened version of the biome colour — enough for
 *  the fringe to read as savanna gold or jungle emerald, gentle enough that the
 *  soil under it never turns green. */
function halfTint(t: Tint): Tint {
  return [1 - (1 - t[0]) * 0.62, 1 - (1 - t[1]) * 0.62, 1 - (1 - t[2]) * 0.62];
}

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
    topOffset: number, tint: Tint, skyL: number, blockL: number,
    /** Optional tint for the BOTTOM two vertices, producing a vertical
     *  gradient across the face. Used for the grass-block side: the fringe
     *  along its top edge takes the biome colour and fades out into plain
     *  dirt below, instead of every biome sharing one hard-coded green. */
    tintBottom?: Tint,
    /** Smooth lighting: per-corner (sky, block) levels replacing the flat
     *  skyL/blockL. Both arrays are indexed like `face.corners`. */
    cornerSky?: number[], cornerBlock?: number[]
  ): void {
    const base = this.positions.length / 3;
    const [u0, v0, u1, v1] = uvRect;
    for (let i = 0; i < 4; i++) {
      const c = face.corners[i];
      let y = by + c.pos[1];
      if (topOffset && c.pos[1] === 1) y -= topOffset;
      this.positions.push(bx + c.pos[0], y, bz + c.pos[2]);
      const b = face.shade * AO_CURVE[ao[i]];
      const vt = tintBottom && c.pos[1] === 0 ? tintBottom : tint;
      this.colors.push(b * vt[0], b * vt[1], b * vt[2]);
      this.uvs.push(u0 + (u1 - u0) * c.uv[0], v0 + (v1 - v0) * c.uv[1]);
      this.lights.push(
        (cornerSky ? cornerSky[i] : skyL) / 15,
        (cornerBlock ? cornerBlock[i] : blockL) / 15
      );
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

/** Host hooks into meshing (set once by main.ts). */
export const meshHooks: { skipTrap: ((x: number, y: number, z: number) => boolean) | null } = { skipTrap: null };

export function buildChunkGeometry(
  chunk: Chunk, sample: BlockSampler, atlas: Atlas, tints: TintSampler,
  light: LightField, smoothLighting = false
): ChunkGeometry {
  const opaque = new GeoBuffer();
  const water = new GeoBuffer();
  const ox = chunk.cx * CHUNK_X;
  const oz = chunk.cz * CHUNK_Z;
  const maxY = Math.min(chunk.maxY, 256);
  const ao = [0, 0, 0, 0];
  const cornerSky = [0, 0, 0, 0];
  const cornerBlock = [0, 0, 0, 0];

  for (let x = 0; x < CHUNK_X; x++) {
    for (let z = 0; z < CHUNK_Z; z++) {
      const wx = ox + x, wz = oz + z;
      let columnTints: ColumnTints | null = null; // computed lazily per column
      const tintFor = (kind: 'grass' | 'foliage' | 'water'): Tint => {
        columnTints ??= tints(wx, wz);
        return columnTints[kind];
      };

      for (let y = 0; y < maxY; y++) {
        const id = chunk.get(x, y, z);
        if (id === Block.Air || id === Block.Barrier) continue;
        // Automation uses the detailed MachineModels renderer. Keep the solid
        // cells for interaction/collision, but don't bury its mechanism in cubes.
        if (id === Block.Autominer || id === Block.OilDerrick || id === Block.MachinePart) continue;
        // Turrets likewise: TurretModels draws the armoured mount + tracking head.
        if (id === Block.Turret) continue;
        // Concealable traps with a live entity are drawn per viewer by
        // TrapModels (camouflage); generated ones (vault spikes) mesh normally.
        if (TRAP_MODEL_BLOCKS.has(id) && meshHooks.skipTrap?.(wx, y, wz)) continue;
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

        if (id === Block.BwBedA || id === Block.BwBedB) {
          const skyL = light.sky(wx, y + 1, wz), blockL = light.block(wx, y + 1, wz);
          const wool = BLOCKS[id === Block.BwBedA ? Block.TeamWoolA : Block.TeamWoolB].top;
          const wood = atlas.uvRect(BLOCKS[Block.OakPlanks].side);
          opaque.subBox(x, y, z, [0, .16, 0], [1, .3, 1], wood, WHITE, skyL, blockL);
          opaque.subBox(x, y, z, [.03, .3, 0], [.97, .56, 1], atlas.uvRect(wool), WHITE, skyL, blockL);
          for (const dx of [.06, .8]) for (const dz of [.06, .8]) {
            opaque.subBox(x, y, z, [dx, 0, dz], [dx + .14, .2, dz + .14], wood, WHITE, skyL, blockL);
          }
          // The anchor half alone has a pillow. Works across chunk boundaries
          // and along either bed axis without giving each half a head texture.
          if (sample(wx - 1, y, wz) !== id && sample(wx, y, wz - 1) !== id) {
            const alongX = sample(wx + 1, y, wz) === id;
            opaque.subBox(x, y, z, [.09, .56, .09],
              alongX ? [.4, .62, .91] : [.91, .62, .4],
              atlas.uvRect(BLOCKS[Block.PearlTile].top), WHITE, skyL, blockL);
          }
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

          // Biome tint: foliage and water tint every face; grass tints the top
          // face fully and the side face as a top-down gradient over its fringe.
          const grassSide = info.tint === 'grass' && dy === 0;
          const tint: Tint =
            info.tint === 'foliage' ? tintFor('foliage')
            : info.tint === 'water' ? tintFor('water')
            : info.tint === 'grass' && dy > 0 ? tintFor('grass')
            // Side faces: the biome colour at the top edge (where the grass
            // fringe is painted) easing off into untinted dirt at the bottom.
            : grassSide ? halfTint(tintFor('grass'))
            : WHITE;

          // Faces are lit by the cell they are exposed to.
          const ly = Math.max(0, ny);
          const skyL = light.sky(wx + dx, ly, wz + dz);
          const blockL = light.block(wx + dx, ly, wz + dz);
          if (smoothLighting) {
            computeSmoothLight(
              face, wx, y, wz, sample, light, skyL, blockL, cornerSky, cornerBlock);
          }

          (isWater ? water : opaque).quad(
            face, x, y, z, atlas.uvRect(tile), ao, topOffset, tint, skyL, blockL,
            grassSide ? WHITE : undefined,
            smoothLighting ? cornerSky : undefined,
            smoothLighting ? cornerBlock : undefined
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

/**
 * Smooth lighting, the other half of the vanilla look that per-vertex AO only
 * hints at. A flat face takes ONE light level, so a torch on a wall lights the
 * whole block face evenly and the falloff between blocks is a visible staircase.
 * Here each of the four corners instead averages the light of the four cells
 * that touch it on the exposed side of the face, and the rasteriser interpolates
 * between them — the same neighbourhood `computeAO` already walks, so lighting
 * and occlusion agree on where a corner is.
 *
 * Opaque neighbours are skipped rather than counted as darkness: an unlit solid
 * cell holds level 0 and averaging it in would ring every inside corner with a
 * dark halo that vanilla does not have. When every contributing cell is opaque
 * (a fully enclosed corner) the face's own flat level is used, so a vertex can
 * never fall to black on its own.
 */
function computeSmoothLight(
  face: FaceDef, wx: number, wy: number, wz: number,
  sample: BlockSampler, light: LightField,
  flatSky: number, flatBlock: number,
  outSky: number[], outBlock: number[]
): void {
  const [dx, dy, dz] = face.dir;
  // Tangent axes = the two axes perpendicular to the face normal.
  const axis = dx !== 0 ? 0 : dy !== 0 ? 1 : 2;
  const t1 = axis === 0 ? 1 : 0;
  const t2 = axis === 2 ? 1 : 2;
  // The cell the face is exposed to; always sampled, always non-opaque.
  const p = [wx + dx, wy + dy, wz + dz];
  const q = [0, 0, 0];

  for (let i = 0; i < 4; i++) {
    const c = face.corners[i].pos;
    const s1 = c[t1] === 1 ? 1 : -1;
    const s2 = c[t2] === 1 ? 1 : -1;

    let sky = 0, block = 0, n = 0;
    // k as a 2-bit mask over the two tangent offsets: p, p+t1, p+t2, p+t1+t2.
    for (let k = 0; k < 4; k++) {
      q[0] = p[0]; q[1] = p[1]; q[2] = p[2];
      if (k & 1) q[t1] += s1;
      if (k & 2) q[t2] += s2;
      if (q[1] < 0 || q[1] >= 256) continue;
      if (isOpaque(sample(q[0], q[1], q[2]))) continue;
      sky += light.sky(q[0], q[1], q[2]);
      block += light.block(q[0], q[1], q[2]);
      n++;
    }

    if (n === 0) {
      outSky[i] = flatSky;
      outBlock[i] = flatBlock;
    } else {
      outSky[i] = sky / n;
      outBlock[i] = block / n;
    }
  }
}
