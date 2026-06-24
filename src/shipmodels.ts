// Renders captured SHIPS as rigid block meshes. Each ship is meshed ONCE from
// its (immutable) hull blocks into a single BufferGeometry — culled faces with
// vanilla directional shading + the shared atlas, like the chunk mesher but on
// a tiny in-memory grid that can hold negative/oversize offsets. The mesh is
// then just translated/rotated by the ship transform each frame, so the block
// design moves as one piece without re-meshing the world. Follows the
// machinemodels.ts manager lifecycle (build/sync/dispose against a state list).

import * as THREE from 'three';
import { BLOCKS, isOpaque, Tile } from './blocks';
import { subFaceUV } from './mesher';
import { renderBoxes } from './shapes';
import type { ShipState } from './ships';
import type { Atlas } from './textures';

// dir, directional shade (top 1, bottom .5, N/S .8, E/W .6), and the 4 corner
// positions (unit cube spanning [0,1]) + uv per face — matching the mesher.
interface Face {
  dir: [number, number, number];
  shade: number;
  corners: { pos: [number, number, number]; uv: [number, number] }[];
}
const FACES: Face[] = [
  { dir: [-1, 0, 0], shade: 0.6, corners: [
    { pos: [0, 1, 0], uv: [0, 1] }, { pos: [0, 0, 0], uv: [0, 0] },
    { pos: [0, 1, 1], uv: [1, 1] }, { pos: [0, 0, 1], uv: [1, 0] }] },
  { dir: [1, 0, 0], shade: 0.6, corners: [
    { pos: [1, 1, 1], uv: [0, 1] }, { pos: [1, 0, 1], uv: [0, 0] },
    { pos: [1, 1, 0], uv: [1, 1] }, { pos: [1, 0, 0], uv: [1, 0] }] },
  { dir: [0, -1, 0], shade: 0.5, corners: [
    { pos: [1, 0, 1], uv: [1, 0] }, { pos: [0, 0, 1], uv: [0, 0] },
    { pos: [1, 0, 0], uv: [1, 1] }, { pos: [0, 0, 0], uv: [0, 1] }] },
  { dir: [0, 1, 0], shade: 1.0, corners: [
    { pos: [0, 1, 1], uv: [1, 1] }, { pos: [1, 1, 1], uv: [0, 1] },
    { pos: [0, 1, 0], uv: [1, 0] }, { pos: [1, 1, 0], uv: [0, 0] }] },
  { dir: [0, 0, -1], shade: 0.8, corners: [
    { pos: [1, 0, 0], uv: [0, 0] }, { pos: [0, 0, 0], uv: [1, 0] },
    { pos: [1, 1, 0], uv: [0, 1] }, { pos: [0, 1, 0], uv: [1, 1] }] },
  { dir: [0, 0, 1], shade: 0.8, corners: [
    { pos: [0, 0, 1], uv: [0, 0] }, { pos: [1, 0, 1], uv: [1, 0] },
    { pos: [0, 1, 1], uv: [0, 1] }, { pos: [1, 1, 1], uv: [1, 1] }] },
];

function buildShipGeometry(ship: ShipState, atlas: Atlas): THREE.BufferGeometry {
  const at = new Map<string, number>();
  for (const b of ship.blocks) at.set(`${b.dx},${b.dy},${b.dz}`, b.id);
  const positions: number[] = [];
  const colors: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  for (const b of ship.blocks) {
    const info = BLOCKS[b.id];
    if (!info) continue;

    // Slabs/stairs render as partial sub-boxes (same shapes as the world mesher).
    if (info.shape === 'slab' || info.shape === 'stairs') {
      const [u0, v0, u1, v1] = atlas.uvRect(info.side);
      const boxes = renderBoxes(b.id);
      for (const [mn, mx] of boxes) {
        for (let f = 0; f < FACES.length; f++) {
          const face = FACES[f];
          const base = positions.length / 3;
          for (let i = 0; i < 4; i++) {
            const c = face.corners[i].pos;
            const lx = c[0] ? mx[0] : mn[0];
            const ly = c[1] ? mx[1] : mn[1];
            const lz = c[2] ? mx[2] : mn[2];
            positions.push(b.dx - 0.5 + lx, b.dy - 0.5 + ly, b.dz - 0.5 + lz);
            colors.push(face.shade, face.shade, face.shade);
            const [fu, fv] = subFaceUV(f, lx, ly, lz);
            uvs.push(u0 + (u1 - u0) * fu, v0 + (v1 - v0) * fv);
          }
          indices.push(base, base + 1, base + 2, base + 2, base + 1, base + 3);
        }
      }
      continue;
    }

    for (const face of FACES) {
      const [dx, dy, dz] = face.dir;
      // Cull only against an opaque cube neighbour (so glass/leaves still draw).
      const nid = at.get(`${b.dx + dx},${b.dy + dy},${b.dz + dz}`);
      if (nid !== undefined && isOpaque(nid)) continue;
      const tile: Tile = dy > 0 ? info.top : dy < 0 ? info.bottom : info.side;
      const [u0, v0, u1, v1] = atlas.uvRect(tile);
      const base = positions.length / 3;
      for (let i = 0; i < 4; i++) {
        const c = face.corners[i];
        // Block centres are at integer offsets; the unit cube spans [-0.5,0.5].
        positions.push(b.dx - 0.5 + c.pos[0], b.dy - 0.5 + c.pos[1], b.dz - 0.5 + c.pos[2]);
        colors.push(face.shade, face.shade, face.shade);
        uvs.push(u0 + (u1 - u0) * c.uv[0], v0 + (v1 - v0) * c.uv[1]);
      }
      indices.push(base, base + 1, base + 2, base + 2, base + 1, base + 3);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeBoundingSphere();
  return geo;
}

interface Entry { mesh: THREE.Mesh; }

export class ShipModels {
  private readonly scene: THREE.Scene;
  private readonly atlas: Atlas;
  private readonly material: THREE.MeshBasicMaterial;
  private readonly models = new Map<number, Entry>();

  constructor(scene: THREE.Scene, atlas: Atlas) {
    this.scene = scene;
    this.atlas = atlas;
    this.material = new THREE.MeshBasicMaterial({
      map: atlas.texture, vertexColors: true, alphaTest: 0.5,
    });
  }

  /** Sync meshes to the live ship list and place them at their transforms. */
  update(ships: ShipState[]): void {
    const seen = new Set<number>();
    for (const ship of ships) {
      seen.add(ship.id);
      let e = this.models.get(ship.id);
      if (!e) {
        const mesh = new THREE.Mesh(buildShipGeometry(ship, this.atlas), this.material);
        this.scene.add(mesh);
        e = { mesh };
        this.models.set(ship.id, e);
      }
      e.mesh.position.set(ship.x, ship.y, ship.z);
      // blockWorldPos uses a +yaw math rotation; THREE's rotation.y is the
      // opposite sign, so negate to keep the mesh aligned with the collision
      // model (deck heights, cannon/gun hit tests).
      e.mesh.rotation.y = -ship.yaw;
    }
    for (const [id, e] of this.models) {
      if (!seen.has(id)) { this.disposeEntry(e); this.models.delete(id); }
    }
  }

  private disposeEntry(e: Entry): void {
    this.scene.remove(e.mesh);
    e.mesh.geometry.dispose();
  }

  dispose(): void {
    for (const e of this.models.values()) this.disposeEntry(e);
    this.models.clear();
    this.material.dispose();
  }
}
