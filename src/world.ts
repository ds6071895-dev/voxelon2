// World: chunk map, time-budgeted streaming around the player, block edits
// with immediate remeshing of the affected chunks.

import * as THREE from 'three';
import { Block, BLOCKS, isOpaque, torchSupport } from './blocks';
import { Chunk, CHUNK_X, CHUNK_Z } from './chunk';
import { computeLight } from './light';
import { buildChunkGeometry, BlockSampler } from './mesher';
import { Terrain } from './terrain';
import type { Atlas } from './textures';

export const RENDER_DISTANCE = 8; // chunks

/**
 * Injects the voxel light model into a built-in material: per-vertex
 * (sky, block) levels combined as max(block, sky * sunlight) and mapped
 * through the vanilla 0.8^(15-level) brightness curve.
 */
function applyLightShader(
  mat: THREE.Material,
  sunUniform: { value: number },
  torchUniform: { value: THREE.Vector4 },
  duelBoundsUniform: { value: THREE.Vector4 }
): void {
  mat.customProgramCacheKey = () => 'voxel-light';
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uSunLight = sunUniform;
    // uTorch: a moving point light carried by the player (xyz = world position,
    // w = intensity 0..1). Lets a held torch light the world without remeshing.
    shader.uniforms.uTorch = torchUniform;
    shader.uniforms.uDuelBounds = duelBoundsUniform;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nattribute vec2 skyblock;\nvarying vec2 vSkyBlock;\nvarying vec3 vWorldPos;'
      )
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvSkyBlock = skyblock;\n' +
        'vWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;'
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nuniform float uSunLight;\nuniform vec4 uTorch;\nuniform vec4 uDuelBounds;\n' +
        'varying vec2 vSkyBlock;\nvarying vec3 vWorldPos;'
      )
      .replace(
        '#include <color_fragment>',
        '#include <color_fragment>\n' +
        '// In Duels, discard every terrain fragment outside the arena perimeter.\n' +
        'if (uDuelBounds.x < uDuelBounds.z && (vWorldPos.x < uDuelBounds.x || vWorldPos.x >= uDuelBounds.z || vWorldPos.z < uDuelBounds.y || vWorldPos.z >= uDuelBounds.w)) discard;\n' +
        'float voxelLight = max(vSkyBlock.y, vSkyBlock.x * uSunLight);\n' +
        '// Duels arenas have a competitive ambient floor of 12/15.\n' +
        '// Fixtures still raise nearby surfaces above it, preserving gradients.\n' +
        'if (vWorldPos.x >= 12288.0) voxelLight = max(voxelLight, 0.8);\n' +
        '// Held-torch point light: bright near field, gentle falloff to ~16 blocks.\n' +
        'float td = distance(vWorldPos, uTorch.xyz);\n' +
        'float fall = clamp(1.0 - td / 16.0, 0.0, 1.0);\n' +
        'float torch = uTorch.w * (0.45 * fall + 0.55 * fall * fall);\n' +
        'voxelLight = min(1.0, max(voxelLight, torch));\n' +
        'diffuseColor.rgb *= pow(0.8, 15.0 * (1.0 - voxelLight));\n' +
        '// Warm the torch-lit pixels (firelight tint).\n' +
        'diffuseColor.rgb *= mix(vec3(1.0), vec3(1.15, 1.05, 0.85), clamp(torch, 0.0, 1.0));'
      );
  };
}

export class World {
  readonly terrain: Terrain;
  private readonly chunks = new Map<string, Chunk>();
  private readonly scene: THREE.Scene;
  private readonly atlas: Atlas;
  private readonly opaqueMat: THREE.Material;
  private readonly waterMat: THREE.Material;
  /** Chunk offsets sorted by distance, out to data radius. */
  private readonly spiral: [number, number][] = [];

  /** Day-night sunlight factor shared with the chunk shaders. */
  readonly sunUniform = { value: 1 };
  /** Held-torch point light shared with the chunk shaders (xyz pos, w intensity). */
  readonly torchUniform = { value: new THREE.Vector4(0, 0, 0, 0) };
  /** x/z render crop for Duels arenas. x>=z disables the crop. */
  readonly duelBoundsUniform = { value: new THREE.Vector4(1, 1, 0, 0) };
  /** Probability a broken block drops items (explosions lower it). */
  dropChance = 1;
  /** When true, setBlock skips the onBlockBroken hook (remote edits). */
  private suppressBreakEvent = false;
  /**
   * Persistent record of every block changed from natural terrain, keyed by
   * chunk -> (local index -> block id). Re-applied whenever a chunk is
   * (re)generated, so edits survive chunk unload/regen — and so a remote edit
   * to a not-yet-loaded chunk is honoured once that chunk streams in.
   */
  private readonly editOverlay = new Map<string, Map<number, number>>();

  private recordEdit(wx: number, wy: number, wz: number, id: number): void {
    const ck = Chunk.key(wx >> 4, wz >> 4);
    let m = this.editOverlay.get(ck);
    if (!m) { m = new Map(); this.editOverlay.set(ck, m); }
    m.set(((((wx & 15) << 4) | (wz & 15)) << 8) | (wy & 255), id);
  }
  /** When set, remeshes are collected and deduplicated until endBatch(). */
  private batch: Set<Chunk> | null = null;
  /** Fired when a block becomes air (drop spawning hooks in here).
   *  `harvested` is false when mined without the required tool. */
  onBlockBroken?: (
    wx: number, wy: number, wz: number, oldId: number, harvested: boolean
  ) => void;

  constructor(scene: THREE.Scene, atlas: Atlas, seed: number) {
    this.scene = scene;
    this.atlas = atlas;
    this.terrain = new Terrain(seed);

    this.opaqueMat = new THREE.MeshBasicMaterial({
      map: atlas.texture,
      vertexColors: true,
      alphaTest: 0.5, // cutout for leaves/glass
    });
    this.waterMat = new THREE.MeshBasicMaterial({
      map: atlas.texture,
      vertexColors: true,
      transparent: true,
      opacity: 0.8,
      depthWrite: false,
    });
    applyLightShader(this.opaqueMat, this.sunUniform, this.torchUniform, this.duelBoundsUniform);
    applyLightShader(this.waterMat, this.sunUniform, this.torchUniform, this.duelBoundsUniform);

    const r = RENDER_DISTANCE + 1;
    for (let dx = -r; dx <= r; dx++)
      for (let dz = -r; dz <= r; dz++) this.spiral.push([dx, dz]);
    this.spiral.sort(
      (a, b) => a[0] * a[0] + a[1] * a[1] - (b[0] * b[0] + b[1] * b[1])
    );
  }

  getChunk(cx: number, cz: number): Chunk | undefined {
    return this.chunks.get(Chunk.key(cx, cz));
  }

  /** Drive the held-torch point light (xyz = world position, intensity 0..1).
   *  Intensity 0 turns it off. */
  setHeldLight(x: number, y: number, z: number, intensity: number): void {
    this.torchUniform.value.set(x, y, z, intensity);
  }

  /** Hide all terrain outside one temporary Duels arena, including geometry
   * sharing a chunk mesh with its walls. Passing null restores the open world. */
  setDuelRenderBounds(bounds: { minX: number; minZ: number; maxX: number; maxZ: number } | null): void {
    if (bounds) this.duelBoundsUniform.value.set(bounds.minX, bounds.minZ, bounds.maxX, bounds.maxZ);
    else this.duelBoundsUniform.value.set(1, 1, 0, 0);
  }


  private ensureData(cx: number, cz: number): Chunk {
    const key = Chunk.key(cx, cz);
    let chunk = this.chunks.get(key);
    if (!chunk) {
      chunk = new Chunk(cx, cz);
      this.terrain.fill(chunk);
      // Re-apply any persisted edits for this chunk on top of fresh terrain.
      const ov = this.editOverlay.get(key);
      if (ov) {
        for (const [idx, bid] of ov) {
          chunk.set((idx >> 12) & 15, idx & 255, (idx >> 8) & 15, bid);
        }
      }
      this.chunks.set(key, chunk);
    }
    return chunk;
  }

  /** The player-placed block recorded at a cell (0/undefined = natural terrain
   *  there). Used by ship capture to flood-fill only built blocks. */
  getEditedBlock(wx: number, wy: number, wz: number): number | undefined {
    const m = this.editOverlay.get(Chunk.key(wx >> 4, wz >> 4));
    if (!m) return undefined;
    return m.get(((((wx & 15) << 4) | (wz & 15)) << 8) | (wy & 255));
  }

  /** Has the chunk column holding (wx, wz) got its block data yet? `getBlock`
   *  cannot distinguish "empty" from "not generated" — both read as Air — so
   *  anything that must not move through unstreamed terrain (player collision)
   *  asks here first. Data-only chunks count: collision needs blocks, not a mesh. */
  isLoaded(wx: number, wz: number): boolean {
    return this.chunks.has(Chunk.key(wx >> 4, wz >> 4));
  }

  getBlock(wx: number, wy: number, wz: number): number {
    if (wy < 0 || wy >= 256) return Block.Air;
    const chunk = this.chunks.get(Chunk.key(wx >> 4, wz >> 4));
    if (!chunk) return Block.Air;
    return chunk.get(wx & 15, wy, wz & 15);
  }

  setBlock(
    wx: number, wy: number, wz: number, id: number, harvested = true
  ): void {
    if (wy < 0 || wy >= 256) return;
    // Persist the edit first, so it is honoured even if the chunk is not
    // loaded yet (remote edits) and survives a later unload/regen.
    this.recordEdit(wx, wy, wz, id);
    const cx = wx >> 4, cz = wz >> 4;
    const chunk = this.chunks.get(Chunk.key(cx, cz));
    if (!chunk) return;
    const lx = wx & 15, lz = wz & 15;
    const oldId = chunk.get(lx, wy, lz);
    chunk.set(lx, wy, lz, id);
    if (!this.suppressBreakEvent && id === Block.Air &&
      oldId !== Block.Air && oldId !== Block.Water) {
      this.onBlockBroken?.(wx, wy, wz, oldId, harvested);
    }

    if (id === Block.Air) {
      // Breaking the support under a plant, cactus or floor torch pops it.
      const above = chunk.get(lx, wy + 1, lz);
      if (
        BLOCKS[above]?.shape === 'cross' || above === Block.Cactus ||
        above === Block.Torch
      ) {
        this.setBlock(wx, wy + 1, wz, Block.Air);
      }
      // Wall torches attached to this block pop too.
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const sup = torchSupport(this.getBlock(wx + dx, wy, wz + dz));
        if (sup && sup[0] === -dx && sup[2] === -dz) {
          this.setBlock(wx + dx, wy, wz + dz, Block.Air);
        }
      }
    }

    // Remesh this chunk now, plus any neighbours sharing the edited border.
    this.remesh(chunk);
    const dirs: [number, number][] = [];
    if (lx === 0) dirs.push([-1, 0]);
    if (lx === 15) dirs.push([1, 0]);
    if (lz === 0) dirs.push([0, -1]);
    if (lz === 15) dirs.push([0, 1]);
    if (lx === 0 && lz === 0) dirs.push([-1, -1]);
    if (lx === 0 && lz === 15) dirs.push([-1, 1]);
    if (lx === 15 && lz === 0) dirs.push([1, -1]);
    if (lx === 15 && lz === 15) dirs.push([1, 1]);
    for (const [dx, dz] of dirs) {
      const n = this.getChunk(cx + dx, cz + dz);
      if (n && n.opaqueMesh !== null) this.remesh(n);
    }
  }

  private makeSampler(center: Chunk): BlockSampler {
    const cache: (Chunk | undefined)[] = [];
    for (let dz = -1; dz <= 1; dz++)
      for (let dx = -1; dx <= 1; dx++)
        cache.push(this.getChunk(center.cx + dx, center.cz + dz));
    return (wx, wy, wz) => {
      if (wy < 0 || wy >= 256) return Block.Air;
      const dcx = (wx >> 4) - center.cx + 1;
      const dcz = (wz >> 4) - center.cz + 1;
      if (dcx < 0 || dcx > 2 || dcz < 0 || dcz > 2) {
        return this.getBlock(wx, wy, wz);
      }
      const chunk = cache[dcz * 3 + dcx];
      return chunk ? chunk.get(wx & 15, wy, wz & 15) : Block.Air;
    };
  }

  /** Apply another player's block edit: updates + remeshes, but does NOT
   *  fire onBlockBroken (no drops, no re-broadcast). */
  applyRemoteEdit(wx: number, wy: number, wz: number, id: number): void {
    this.suppressBreakEvent = true;
    this.setBlock(wx, wy, wz, id);
    this.suppressBreakEvent = false;
  }

  /** Collect remeshes for a bulk edit (e.g. an explosion). */
  beginBatch(): void {
    this.batch = new Set();
  }

  endBatch(): void {
    const set = this.batch;
    this.batch = null;
    if (set) for (const chunk of set) this.remesh(chunk);
  }

  /**
   * Block light estimate at a position from nearby emitters, ignoring
   * occlusion (an over-estimate — safe for spawn suppression near torches).
   */
  approxBlockLight(wx: number, wy: number, wz: number): number {
    const cx = wx >> 4, cz = wz >> 4;
    let best = 0;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const chunk = this.getChunk(cx + dx, cz + dz);
        if (!chunk || chunk.lights.size === 0) continue;
        for (const [idx, level] of chunk.lights) {
          const ex = chunk.cx * CHUNK_X + ((idx >> 12) & 15);
          const ey = idx & 255;
          const ez = chunk.cz * CHUNK_Z + ((idx >> 8) & 15);
          const d = Math.abs(ex - wx) + Math.abs(ey - wy) + Math.abs(ez - wz);
          best = Math.max(best, level - d);
        }
      }
    }
    return best;
  }

  /** True when no opaque block sits anywhere above this cell. */
  hasSkyAccess(wx: number, wy: number, wz: number): boolean {
    const chunk = this.getChunk(wx >> 4, wz >> 4);
    if (!chunk) return true;
    for (let y = wy; y < chunk.maxY; y++) {
      if (isOpaque(chunk.get(wx & 15, y, wz & 15))) return false;
    }
    return true;
  }

  private remesh(chunk: Chunk): void {
    if (this.batch) {
      this.batch.add(chunk);
      return;
    }
    this.disposeMeshes(chunk);
    const sampler = this.makeSampler(chunk);

    // Light is exact when computed over the 3x3 window (max travel = 15).
    let height = chunk.maxY;
    const emitters: [number, number, number, number][] = [];
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const n = this.getChunk(chunk.cx + dx, chunk.cz + dz);
        if (!n) continue;
        height = Math.max(height, n.maxY);
        for (const [idx, level] of n.lights) {
          emitters.push([
            n.cx * CHUNK_X + ((idx >> 12) & 15),
            idx & 255,
            n.cz * CHUNK_Z + ((idx >> 8) & 15),
            level,
          ]);
        }
      }
    }
    const light = computeLight({
      minX: (chunk.cx - 1) * CHUNK_X,
      minZ: (chunk.cz - 1) * CHUNK_Z,
      sizeX: CHUNK_X * 3,
      sizeZ: CHUNK_Z * 3,
      height: Math.min(256, height + 4),
      getBlock: sampler,
      emitters,
    });

    const geo = buildChunkGeometry(
      chunk, sampler, this.atlas,
      (wx, wz) => this.terrain.tints(wx, wz), light
    );
    const px = chunk.cx * CHUNK_X, pz = chunk.cz * CHUNK_Z;
    if (geo.opaque) {
      const mesh = new THREE.Mesh(geo.opaque, this.opaqueMat);
      mesh.position.set(px, 0, pz);
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      this.scene.add(mesh);
      chunk.opaqueMesh = mesh;
    } else {
      // Keep a marker so "has been meshed" is distinguishable from "pending".
      chunk.opaqueMesh = new THREE.Mesh();
    }
    if (geo.water) {
      const mesh = new THREE.Mesh(geo.water, this.waterMat);
      mesh.position.set(px, 0, pz);
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      this.scene.add(mesh);
      chunk.waterMesh = mesh;
    }
    chunk.dirty = false;
  }

  private disposeMeshes(chunk: Chunk): void {
    for (const mesh of [chunk.opaqueMesh, chunk.waterMesh]) {
      if (mesh) {
        this.scene.remove(mesh);
        mesh.geometry.dispose();
      }
    }
    chunk.opaqueMesh = null;
    chunk.waterMesh = null;
  }

  /** Fraction of chunks within render distance that are meshed (loading UI). */
  progress(px: number, pz: number): number {
    const pcx = Math.floor(px) >> 4;
    const pcz = Math.floor(pz) >> 4;
    let meshed = 0, total = 0;
    for (const [dx, dz] of this.spiral) {
      if (Math.max(Math.abs(dx), Math.abs(dz)) > RENDER_DISTANCE) continue;
      total++;
      const chunk = this.getChunk(pcx + dx, pcz + dz);
      if (chunk && chunk.opaqueMesh) meshed++;
    }
    return total === 0 ? 1 : meshed / total;
  }

  /**
   * Stream chunks around the player, doing at most `budgetMs` of work.
   * Returns true if every chunk in render distance is meshed (used by the
   * loading screen).
   */
  update(px: number, pz: number, budgetMs: number, maxDist = RENDER_DISTANCE): boolean {
    const start = performance.now();
    const pcx = Math.floor(px) >> 4;
    const pcz = Math.floor(pz) >> 4;
    let done = true;

    for (const [dx, dz] of this.spiral) {
      const dist = Math.max(Math.abs(dx), Math.abs(dz));
      if (dist > maxDist) continue;
      const cx = pcx + dx, cz = pcz + dz;
      const chunk = this.getChunk(cx, cz);
      if (chunk && chunk.opaqueMesh && !chunk.dirty) continue;

      done = false;
      if (performance.now() - start > budgetMs) return false;

      // Terrain data for the chunk and its 8 neighbours must exist before
      // meshing, so border faces and AO are correct from the start.
      for (let nx = -1; nx <= 1; nx++)
        for (let nz = -1; nz <= 1; nz++) this.ensureData(cx + nx, cz + nz);
      this.remesh(this.ensureData(cx, cz));
    }

    // Unload far chunks.
    for (const chunk of this.chunks.values()) {
      if (
        Math.max(Math.abs(chunk.cx - pcx), Math.abs(chunk.cz - pcz)) >
        maxDist + 2
      ) {
        this.disposeMeshes(chunk);
        this.chunks.delete(Chunk.key(chunk.cx, chunk.cz));
      }
    }
    return done;
  }
}
