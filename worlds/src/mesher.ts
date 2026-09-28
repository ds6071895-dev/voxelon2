// Chunk mesher: culled faces, vanilla directional shading, per-vertex
// ambient occlusion (the classic 0-3 corner test), AO-aware quad flipping,
// and optional smooth lighting (per-vertex light averaged over the four cells
// touching each corner instead of one flat level per face).

import * as THREE from 'three';
import type { ColumnTints, Tint } from './tints';
import { Block, BLOCKS, isOpaque, occludesAO, Tile } from './blocks';
import { Chunk, CHUNK_X, CHUNK_Z } from './chunk';
import type { LightField } from './light';
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

export type BlockSampler = (wx: number, wy: number, wz: number) => number;
type TintSampler = (wx: number, wz: number) => ColumnTints;

/** What the chunk shader needs to know about a surface, per vertex. */
const enum SurfaceKind { Solid = 0, Plant = 1, Leaves = 2, Water = 3 }

class GeoBuffer {
  positions: number[] = [];
  colors: number[] = [];
  uvs: number[] = [];
  lights: number[] = []; // (sky, block) per vertex, normalized 0-1
  /** (kind, emission 0..1, wind sway 0..1) per vertex — see world.ts. */
  info: number[] = [];
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
    cornerSky?: number[], cornerBlock?: number[],
    kind: SurfaceKind = SurfaceKind.Solid, emission = 0
  ): void {
    const base = this.positions.length / 3;
    const sway = kind === SurfaceKind.Leaves ? 0.35 : 0;
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
      this.info.push(kind, emission, sway);
    }
    // Split the quad along the diagonal that interpolates it best. With
    // smooth lighting the corners differ in LIGHT as well as occlusion, and
    // choosing on occlusion alone ran the crease across the light gradient,
    // drawing a dark diagonal through lit faces. Judge on what the corner
    // will actually look like: occlusion times its brightest light.
    let d03 = ao[0] + ao[3], d12 = ao[1] + ao[2];
    if (cornerSky && cornerBlock) {
      const lum = (i: number): number =>
        AO_CURVE[ao[i]] * Math.max(cornerSky[i], cornerBlock[i]);
      d03 = lum(0) + lum(3); d12 = lum(1) + lum(2);
    }
    if (d03 > d12) {
      this.indices.push(base, base + 1, base + 3, base, base + 3, base + 2);
    } else {
      this.indices.push(base, base + 1, base + 2, base + 2, base + 1, base + 3);
    }
  }

  /** Two diagonal quads, double-sided — billboard plants. */
  cross(
    bx: number, by: number, bz: number,
    uvRect: [number, number, number, number], tint: Tint,
    skyL: number, blockL: number, emission = 0
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
        // Rooted: only the two top corners (i = 2, 3) sway in the wind.
        this.info.push(SurfaceKind.Plant, emission, i >= 2 ? 1 : 0);
      }
      this.uvs.push(u0, v0, u1, v0, u0, v1, u1, v1);
      this.indices.push(
        base, base + 1, base + 2, base + 2, base + 1, base + 3, // front
        base + 2, base + 1, base, base + 3, base + 1, base + 2  // back
      );
    }
  }

  /** One face of a sub-box (stairs, lanterns, plates): explicit corner
   *  positions and uvs, flat-lit, no corner occlusion. */
  boxQuad(
    pos: number[], uv: number[], shade: number, skyL: number, blockL: number, emission: number,
  ): void {
    const base = this.positions.length / 3;
    for (let i = 0; i < 4; i++) {
      this.positions.push(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);
      this.colors.push(shade, shade, shade);
      this.uvs.push(uv[i * 2], uv[i * 2 + 1]);
      this.lights.push(skyL / 15, blockL / 15);
      this.info.push(SurfaceKind.Solid, emission, 0);
    }
    this.indices.push(base, base + 1, base + 2, base + 2, base + 1, base + 3);
  }

  build(): THREE.BufferGeometry | null {
    if (this.indices.length === 0) return null;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(this.positions, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(this.colors, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(this.uvs, 2));
    geo.setAttribute('skyblock', new THREE.Float32BufferAttribute(this.lights, 2));
    geo.setAttribute('vxinfo', new THREE.Float32BufferAttribute(this.info, 3));
    geo.setIndex(this.indices);
    geo.computeBoundingSphere();
    return geo;
  }
}

interface ChunkGeometry {
  opaque: THREE.BufferGeometry | null;
  water: THREE.BufferGeometry | null;
}

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
        const info = BLOCKS[id];
        // An id with no definition is a block this build no longer knows (a
        // world saved by an older build). Skip it rather than dereferencing
        // undefined and taking the whole chunk mesh down with it.
        if (!info) continue;
        const isWater = id === Block.Water;

        if (info.shape === 'box' && info.boxes) {
          emitBoxes(opaque, info, x, y, z, wx, wz, sample, atlas, light);
          continue;
        }

        if (info.shape === 'cross') {
          opaque.cross(
            x, y, z, atlas.uvRect(info.side),
            info.tint ? tintFor(info.tint) : WHITE,
            light.sky(wx, y, wz), light.block(wx, y, wz), info.emission / 15
          );
          continue;
        }

        for (const face of FACES) {
          const [dx, dy, dz] = face.dir;
          const ny = y + dy;
          if (ny < 0) continue; // never draw the underside of the world
          const neighbor = sample(wx + dx, ny, wz + dz);

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
            smoothLighting ? cornerBlock : undefined,
            isWater ? SurfaceKind.Water
              : info.tint === 'foliage' ? SurfaceKind.Leaves : SurfaceKind.Solid,
            info.emission / 15
          );
        }
      }
    }
  }

  return { opaque: opaque.build(), water: water.build() };
}

/** Texture coordinate (0..1 across the tile) of a point on a face, matching
 *  the orientation FACES gives a full cube, so a stair tread reads like the
 *  top of a whole block cut in half. Indexed like FACES. */
const FACE_UV: ((x: number, y: number, z: number) => [number, number])[] = [
  (_x, y, z) => [z, y],          // west
  (_x, y, z) => [1 - z, y],      // east
  (x, _y, z) => [x, 1 - z],      // bottom
  (x, _y, z) => [1 - x, z],      // top
  (x, y) => [1 - x, y],          // north
  (x, y) => [x, y],              // south
];

/** Sub-box blocks: every box face is drawn unless it sits flush against an
 *  opaque neighbour. Lit by the cell a face opens onto. */
function emitBoxes(
  out: GeoBuffer, info: (typeof BLOCKS)[number], x: number, y: number, z: number,
  wx: number, wz: number, sample: BlockSampler, atlas: Atlas, light: LightField,
): void {
  const pos: number[] = new Array(12), uv: number[] = new Array(8);
  const emission = info.emission / 15;
  for (const [mn, mx] of info.boxes!) {
    FACES.forEach((face, f) => {
      const [dx, dy, dz] = face.dir;
      const axis = dx !== 0 ? 0 : dy !== 0 ? 1 : 2;
      const sign = dx + dy + dz;
      const flush = sign > 0 ? mx[axis] >= 1 : mn[axis] <= 0;
      if (flush && isOpaque(sample(wx + dx, y + dy, wz + dz))) return;
      const tile: Tile = dy > 0 ? info.top : dy < 0 ? info.bottom : info.side;
      const [u0, v0, u1, v1] = atlas.uvRect(tile);
      for (let i = 0; i < 4; i++) {
        const c = face.corners[i].pos;
        const px = c[0] ? mx[0] : mn[0], py = c[1] ? mx[1] : mn[1], pz = c[2] ? mx[2] : mn[2];
        pos[i * 3] = x + px; pos[i * 3 + 1] = y + py; pos[i * 3 + 2] = z + pz;
        const [u, v] = FACE_UV[f](px, py, pz);
        uv[i * 2] = u0 + (u1 - u0) * u; uv[i * 2 + 1] = v0 + (v1 - v0) * v;
      }
      const lx = flush ? wx + dx : wx, ly = Math.max(0, flush ? y + dy : y), lz = flush ? wz + dz : wz;
      out.boxQuad(pos, uv, face.shade, light.sky(lx, ly, lz), light.block(lx, ly, lz), emission);
    });
  }
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
    // When BOTH side cells are solid, the diagonal cell touches this corner
    // only through a crack of zero width: light cannot get from there to here.
    // Averaging it in anyway leaked the (often pitch-dark) far side of a wall
    // round the corner as a dark smudge — vanilla excludes it, and so do we.
    let sideSolid = 0;
    // k as a 2-bit mask over the two tangent offsets: p, p+t1, p+t2, p+t1+t2.
    for (let k = 0; k < 4; k++) {
      q[0] = p[0]; q[1] = p[1]; q[2] = p[2];
      if (k & 1) q[t1] += s1;
      if (k & 2) q[t2] += s2;
      if (q[1] < 0 || q[1] >= 256) continue;
      if (k === 3 && sideSolid === 2) continue;
      if (isOpaque(sample(q[0], q[1], q[2]))) {
        if (k === 1 || k === 2) sideSolid++;
        continue;
      }
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
