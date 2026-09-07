// World: chunk map, time-budgeted streaming around the player, block edits
// with immediate remeshing of the affected chunks.

import * as THREE from 'three';
import { Block, BLOCKS, isOpaque, torchSupport } from './blocks';
import { Chunk, CHUNK_X, CHUNK_Z } from './chunk';
import { computeLight } from './light';
import { buildChunkGeometry, BlockSampler } from './mesher';
import { SHADOW_CASTER_LAYER } from './shadows';
import type { ShadowUniforms } from './shadows';
import { Terrain } from './terrain';
import type { Atlas } from './textures';

/** MAXIMUM chunks streamed around the player. The graphics-quality preset can
 *  lower the *live* distance (see `World.renderDistance`), but never raise it
 *  past this: the streaming spiral is precomputed once at this radius so that
 *  changing quality mid-game costs nothing. This is the ceiling for the `max`
 *  preset; every preset below it streams less. */
export const RENDER_DISTANCE = 12; // chunks

/** Distance the world starts at before a graphics preset is applied, and what
 *  the decorative panorama world sits at. Kept at the old ceiling so nothing
 *  that never touches the quality setting suddenly meshes 3x the chunks. */
export const DEFAULT_RENDER_DISTANCE = 8; // chunks

/** Everything the injected chunk shader reads that is not already a three.js
 *  built-in. One object so the two materials are wired identically. */
export interface ChunkShaderUniforms {
  sun: { value: number };
  aurora: { value: number };
  torch: { value: THREE.Vector4 };
  duelBounds: { value: THREE.Vector4 };
  sunTint: { value: THREE.Color };
  skyTint: { value: THREE.Color };
  /** Seconds since the world loaded, for the water animation. */
  time: { value: number };
  /** Unit vector toward the sun, in world space. */
  sunDir: { value: THREE.Vector3 };
  /** The sky colour at the horizon, which is what water reflects. */
  skyColor: { value: THREE.Color };
  /** 1 on the `max` preset, 0 below it. Gates the water treatment, which is
   *  the one piece of this shader that every preset would otherwise pay for. */
  shaderMode: { value: number };
  shadow: ShadowUniforms;
}

/** The bit of GLSL both materials share: the voxel light model, the sun shadow
 *  lookup and the colour grade. Written once and injected into two materials. */
const CHUNK_COMMON = /* glsl */`
uniform float uSunLight;
uniform float uAuroraLight;
uniform vec4 uTorch;
uniform vec4 uDuelBounds;
uniform vec3 uSunTint;
uniform vec3 uSkyTint;
uniform float uTime;
uniform vec3 uSunDir;
uniform vec3 uWaterSky;
uniform float uShaderMode;
uniform sampler2D uShadowMap;
uniform mat4 uShadowMatrix;
uniform vec3 uShadowParams;
varying vec2 vSkyBlock;
varying vec3 vWorldPos;

// Matches three.js's packDepthToRGBA, which is what the shadow pass writes.
//
// The channel ORDER matters and is easy to get backwards. packDepthToRGBA puts
// the FINEST bits in .r (fract(depth * 256^3)) and the coarsest in .a (depth
// itself), so the weights descend the other way: .r is worth 255/2^32 and .a
// 255/256. Swapping .r and .b - the obvious mistake, since the numbers look
// symmetric - gives the fastest-changing byte a weight of 255/65536, which is
// a depth error of roughly a fifth of a percent that flips sign from texel to
// texel. That is far larger than any sane depth bias, so the comparison below
// lands on the wrong side of the surface at random and the world comes back
// covered in thousands of speckled shadow dots.
float voxUnpackDepth(const in vec4 v) {
  return dot(v, vec4(255.0 / 4294967296.0, 255.0 / 16777216.0,
                     255.0 / 65536.0, 255.0 / 256.0));
}

/**
 * How much of the sun reaches this fragment: 1 in the open, 0 in full shade.
 *
 * Two things are folded in. A face turned away from the sun cannot be lit by
 * it however clear the sky is, which is the cheap half. The other half is the
 * shadow map, sampled nine times in a small square so the edge is a soft
 * gradient over a few texels instead of a staircase.
 */
float voxSunVisibility(vec3 worldPos, vec3 n) {
  if (uShadowParams.x < 0.5) return 1.0;
  float ndl = dot(n, uSunDir);
  float facing = smoothstep(0.0, 0.32, ndl);
  if (facing <= 0.0) return 0.0;
  // Normal offset. A voxel face is exactly flat, so its own depth sits right
  // on the comparison and half its texels shadow themselves (the moire of
  // dark speckles every shadow implementation starts out with). Pushing the
  // lookup a third of a block off the surface along its own normal moves the
  // whole face clear of that in one step, and unlike a plain depth bias it
  // does not detach the shadow from the foot of what casts it.
  vec3 p = worldPos + n * 0.30 + uSunDir * 0.05;
  vec4 sc = uShadowMatrix * vec4(p, 1.0);
  vec3 c = sc.xyz;
  // Outside the map is "unshadowed", not "black": the box only covers the
  // player's neighbourhood and the world carries on past it.
  if (c.x <= 0.002 || c.x >= 0.998 || c.y <= 0.002 || c.y >= 0.998
    || c.z >= 0.999) return facing;
  // Tight, because the depth in the map is now exact to a part in 2^24. The
  // old margin was set wide enough to ride over the unpacking error above it
  // and cost the shadow its contact with the foot of whatever cast it.
  float bias = 0.0004 + 0.0016 * (1.0 - ndl);
  float texel = uShadowParams.y;
  float sum = 0.0;
  for (int i = -1; i <= 1; i++) {
    for (int j = -1; j <= 1; j++) {
      vec2 uv = c.xy + vec2(float(i), float(j)) * texel;
      sum += step(c.z - bias, voxUnpackDepth(texture2D(uShadowMap, uv)));
    }
  }
  return facing * (sum / 9.0);
}

/** The face normal, recovered from how world position changes across the
 *  screen. Voxel faces are flat, so this is exact, and it saves carrying a
 *  normal attribute on every vertex of every chunk. */
vec3 voxFaceNormal() {
  vec3 n = normalize(cross(dFdx(vWorldPos), dFdy(vWorldPos)));
  return dot(n, cameraPosition - vWorldPos) < 0.0 ? -n : n;
}
`;

/**
 * Injects the voxel light model into a built-in material: per-vertex
 * (sky, block) levels combined as max(block, sky * sunlight), mapped through
 * the vanilla 0.8^(15-level) brightness curve, then multiplied by the sun's
 * own visibility so the shadow map actually darkens something.
 *
 * `water` swaps in the second half of the treatment: a wave displacement in
 * the vertex stage and a fresnel/reflection/specular pass in the fragment one.
 */
function applyLightShader(
  mat: THREE.Material, u: ChunkShaderUniforms, water: boolean
): void {
  // The two materials compile to genuinely different programs, so they must
  // not share a cache key: three would otherwise hand the second one the
  // first one's compiled program.
  mat.customProgramCacheKey = () => (water ? 'voxel-water' : 'voxel-light');
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uSunLight = u.sun;
    shader.uniforms.uAuroraLight = u.aurora;
    // uTorch: a moving point light carried by the player (xyz = world position,
    // w = intensity 0..1). Lets a held torch light the world without remeshing.
    shader.uniforms.uTorch = u.torch;
    shader.uniforms.uDuelBounds = u.duelBounds;
    // Colour of direct sun and of the ambient sky, both driven by the clock.
    shader.uniforms.uSunTint = u.sunTint;
    shader.uniforms.uSkyTint = u.skyTint;
    shader.uniforms.uTime = u.time;
    shader.uniforms.uSunDir = u.sunDir;
    shader.uniforms.uWaterSky = u.skyColor;
    shader.uniforms.uShaderMode = u.shaderMode;
    shader.uniforms.uShadowMap = u.shadow.map;
    shader.uniforms.uShadowMatrix = u.shadow.matrix;
    shader.uniforms.uShadowParams = u.shadow.params;

    // --- vertex
    const wave = water ? /* glsl */`
      // Waves. Only the vertices ON the water surface move, and they are found
      // by their height: the mesher drops an open water top by 1/8 of a block,
      // so every vertex of the exposed surface (the top face AND the upper edge
      // of the side faces around it) sits at .875 and nothing else does. Moving
      // exactly that ring keeps the mesh sealed, which a normal-direction
      // displacement would not.
      float atSurface = step(0.8, fract(worldSeed.y));
      float wv = sin(worldSeed.x * 0.62 + uTime * 1.5) * 0.5
               + sin(worldSeed.z * 0.48 - uTime * 1.15) * 0.42
               + sin((worldSeed.x + worldSeed.z) * 0.31 + uTime * 0.83) * 0.34;
      transformed.y += uShaderMode * atSurface * wv * 0.045;
    ` : '';
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nattribute vec2 skyblock;\nvarying vec2 vSkyBlock;\n'
        + 'varying vec3 vWorldPos;\nuniform float uTime;\nuniform float uShaderMode;'
      )
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvSkyBlock = skyblock;\n'
        + 'vec3 worldSeed = (modelMatrix * vec4(transformed, 1.0)).xyz;\n'
        + wave
        + 'vWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;'
      );

    // --- fragment
    const waterBody = water ? /* glsl */`
      // WATER. Everything above shaded it as though it were another solid
      // block; this turns that flat pane into a surface with a sky in it.
      vec3 viewDir = normalize(cameraPosition - vWorldPos);
      // Only the (near) horizontal top gets the treatment. The vertical sides
      // of a waterfall keep the plain look, which is also what stops the
      // reflection appearing on a wall of falling water. Below the shader
      // preset this is zero, and every line under it folds away to nothing.
      float surf = smoothstep(0.55, 0.86, abs(faceN.y)) * uShaderMode;
      vec2 wp = vWorldPos.xz;
      // Two ripple trains crossing at an angle. One would read as corrugated
      // iron; two interfere and read as water.
      float r1 = sin(wp.x * 1.55 + uTime * 2.0) * cos(wp.y * 1.21 - uTime * 1.6);
      float r2 = sin((wp.x + wp.y) * 0.87 - uTime * 1.25);
      float r3 = cos(wp.y * 1.44 + uTime * 1.75);
      // The ripple normal has to face the same way the surface does, or
      // looking up at the underside of a lake mixes two opposed normals into
      // something that points along the water rather than out of it.
      float nUp = faceN.y < 0.0 ? -1.0 : 1.0;
      vec3 rippleN = normalize(vec3(
        r1 * 0.20 + r2 * 0.13, nUp, r3 * 0.20 - r2 * 0.11));
      vec3 wetN = normalize(mix(faceN, rippleN, surf * 0.85));

      // Fresnel. Water underfoot is nearly clear and water across the bay is
      // nearly a mirror, and that one curve is most of what makes it read as
      // water rather than as blue glass.
      float fres = pow(clamp(1.0 - max(dot(viewDir, wetN), 0.0), 0.0, 1.0), 5.0);
      fres = mix(0.02, 1.0, fres) * surf;

      vec3 reflected = uWaterSky * (0.72 + 0.55 * uSunLight);
      diffuseColor.rgb = mix(diffuseColor.rgb, reflected, fres * 0.74);

      // Sun glitter: a tight specular lobe that the ripples break into moving
      // sparkles, and which the shadow map can put out under a cliff.
      vec3 halfDir = normalize(viewDir + uSunDir);
      float spec = pow(max(dot(wetN, halfDir), 0.0), 96.0)
        * surf * uSunLight * sunVis;
      diffuseColor.rgb += uSunTint * spec * 1.7;

      // Looking straight down you see the bottom; at a glancing angle the
      // reflection takes over and hides it.
      diffuseColor.a *= mix(1.0, 1.16, fres);
      diffuseColor.a = clamp(diffuseColor.a, 0.0, 1.0);
    ` : '';

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + CHUNK_COMMON)
      .replace(
        '#include <color_fragment>',
        '#include <color_fragment>\n' + /* glsl */`
        // In Duels, discard every terrain fragment outside the arena perimeter.
        if (uDuelBounds.x < uDuelBounds.z && (vWorldPos.x < uDuelBounds.x
          || vWorldPos.x >= uDuelBounds.z || vWorldPos.z < uDuelBounds.y
          || vWorldPos.z >= uDuelBounds.w)) discard;

        vec3 faceN = voxFaceNormal();
        float sunVis = voxSunVisibility(vWorldPos, faceN);

        // Direct sunlight, minus whatever the shadow map says is in the way.
        float direct = vSkyBlock.x * uSunLight
          * mix(1.0 - uShadowParams.z, 1.0, sunVis);
        float voxelLight = max(vSkyBlock.y, direct);
        // Aurora adds a cool night skylight only where the sky field reaches.
        float aurora = uAuroraLight * smoothstep(0.35, 1.0, vSkyBlock.x);
        voxelLight = min(1.0, voxelLight + aurora * 0.11);
        // Duels arenas have a competitive ambient floor of 12/15.
        // Fixtures still raise nearby surfaces above it, preserving gradients.
        if (vWorldPos.x >= 12288.0) voxelLight = max(voxelLight, 0.8);
        // Held-torch point light: bright near field, gentle falloff to ~16 blocks.
        float td = distance(vWorldPos, uTorch.xyz);
        float fall = clamp(1.0 - td / 16.0, 0.0, 1.0);
        float torch = uTorch.w * (0.45 * fall + 0.55 * fall * fall);
        voxelLight = min(1.0, max(voxelLight, torch));
        diffuseColor.rgb *= pow(0.8, 15.0 * (1.0 - voxelLight));

        // Ambient colour grading. Faces the sun can reach take its warm hue;
        // faces that only see the sky take the cool blue bounce off it. This is
        // what gives a voxel world SHADOW COLOUR instead of plain grey
        // darkening, and because \`direct\` already has the shadow map in it, the
        // inside of a tree's shadow goes blue exactly like the north face of a
        // wall does.
        float sunlit = clamp(direct, 0.0, 1.0);
        vec3 grade = mix(uSkyTint, uSunTint, sunlit * sunlit);
        diffuseColor.rgb *= mix(vec3(1.0), grade, 0.4);
        // Vibrance: push colour away from its own luminance. The atlas art is
        // deliberately low-saturation so that the biome tints do the talking,
        // which leaves the lit result flat unless it is opened up here.
        float lum = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
        diffuseColor.rgb = clamp(mix(vec3(lum), diffuseColor.rgb, 1.28), 0.0, 1.0);
        // A restrained cyan-green cast makes the curtains visibly shine on land.
        diffuseColor.rgb *= mix(vec3(1.0), vec3(0.86, 1.08, 1.10), aurora * 0.34);
        // Warm the torch-lit pixels (firelight tint).
        diffuseColor.rgb *= mix(vec3(1.0), vec3(1.15, 1.05, 0.85), clamp(torch, 0.0, 1.0));
        ` + waterBody
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
  /** Live streaming radius, driven by the graphics-quality setting. Clamped to
   *  [2, RENDER_DISTANCE] — the spiral holds nothing beyond RENDER_DISTANCE+1. */
  renderDistance = DEFAULT_RENDER_DISTANCE;

  /** Smooth (per-vertex interpolated) lighting instead of one flat level per
   *  face. Set through `setSmoothLighting`, which schedules the remesh. */
  private smoothLighting = false;

  /** Day-night sunlight factor shared with the chunk shaders. */
  readonly sunUniform = { value: 1 };
  /** Cool skylight cast by the night aurora. */
  readonly auroraUniform = { value: 0 };
  /** Colour of direct sunlight right now (gold at dawn/dusk, white at noon). */
  readonly sunTintUniform = { value: new THREE.Color(1, 1, 1) };
  /** Colour of the ambient sky bounce that fills shadow. */
  readonly skyTintUniform = { value: new THREE.Color(1, 1, 1) };
  /** Held-torch point light shared with the chunk shaders (xyz pos, w intensity). */
  readonly torchUniform = { value: new THREE.Vector4(0, 0, 0, 0) };
  /** x/z render crop for Duels arenas. x>=z disables the crop. */
  readonly duelBoundsUniform = { value: new THREE.Vector4(1, 1, 0, 0) };
  /** Seconds since load, driving the water animation. */
  readonly timeUniform = { value: 0 };
  /** Unit vector toward the sun, shared with the shadow pass. */
  readonly sunDirUniform = { value: new THREE.Vector3(0, 1, 0) };
  /** Horizon colour, which is what the water surface reflects. */
  readonly skyColorUniform = { value: new THREE.Color(0.55, 0.72, 0.95) };
  /** 1 while the `max` preset is on; see ChunkShaderUniforms.shaderMode. */
  readonly shaderModeUniform = { value: 0 };
  /** Written by SunShadow every frame; read by both chunk materials. The
   *  objects are created HERE because a uniform is bound into a program when
   *  the material first compiles, and swapping the holder afterwards would
   *  leave the shader pointing at the old one. */
  readonly shadowUniforms: ShadowUniforms = {
    map: { value: null },
    matrix: { value: new THREE.Matrix4() },
    params: { value: new THREE.Vector3(0, 1 / 2048, 0) },
  };
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
      // The atlas is mipmapped, and a mip level averages a cutout's alpha along
      // with its colour — so a distant leaf block's alpha slides under the 0.5
      // test and the canopy dissolves. Alpha-to-coverage resolves the cutout
      // against the MSAA samples instead of a hard threshold, which keeps the
      // foliage whole. It needs a multisampled target: on the `low` preset
      // (antialias: false) it is inert and alphaTest alone behaves as before.
      alphaToCoverage: true,
    });
    this.waterMat = new THREE.MeshBasicMaterial({
      map: atlas.texture,
      vertexColors: true,
      transparent: true,
      opacity: 0.8,
      depthWrite: false,
    });
    const shaderUniforms: ChunkShaderUniforms = {
      sun: this.sunUniform, aurora: this.auroraUniform, torch: this.torchUniform,
      duelBounds: this.duelBoundsUniform, sunTint: this.sunTintUniform,
      skyTint: this.skyTintUniform, time: this.timeUniform,
      sunDir: this.sunDirUniform, skyColor: this.skyColorUniform,
      shaderMode: this.shaderModeUniform, shadow: this.shadowUniforms,
    };
    applyLightShader(this.opaqueMat, shaderUniforms, false);
    applyLightShader(this.waterMat, shaderUniforms, true);

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

  /** Turn smooth lighting on or off. The light levels live in the chunk
   *  geometry, so this can only take effect by rebuilding it: every loaded
   *  chunk is marked dirty and the ordinary streamer remeshes them inside its
   *  per-frame budget, a few at a time, rather than stalling on all of them. */
  setSmoothLighting(on: boolean): void {
    if (this.smoothLighting === on) return;
    this.smoothLighting = on;
    for (const chunk of this.chunks.values()) chunk.dirty = true;
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
      (wx, wz) => this.terrain.tints(wx, wz), light, this.smoothLighting
    );
    const px = chunk.cx * CHUNK_X, pz = chunk.cz * CHUNK_Z;
    if (geo.opaque) {
      const mesh = new THREE.Mesh(geo.opaque, this.opaqueMat);
      // The shadow camera renders this layer and nothing else, so terrain casts
      // and the sky, the clouds and the water do not.
      mesh.layers.enable(SHADOW_CASTER_LAYER);
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
      if (Math.max(Math.abs(dx), Math.abs(dz)) > this.renderDistance) continue;
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
  update(px: number, pz: number, budgetMs: number, maxDist = this.renderDistance): boolean {
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
