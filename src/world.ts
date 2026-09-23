// World: chunk map, time-budgeted streaming around the player, block edits
// with immediate remeshing of the affected chunks.

import * as THREE from 'three';
import { Block, BLOCKS, isOpaque, torchSupport } from './blocks';
import { Chunk, CHUNK_X, CHUNK_Z } from './chunk';
import { computeLight } from './light';
import { buildChunkGeometry, BlockSampler } from './mesher';
import { SHADOW_CASTER_LAYER } from './shadows';
import type { ShadowUniforms } from './shadows';
import type { Sky } from './sky';
import { Terrain } from './terrain';
import { ATLAS_TILES, CELL_PX } from './textures';
import type { Atlas } from './textures';

/** The atlas edge in texels (see ATLAS_SAMPLE). */
const ATLAS_PX = CELL_PX * ATLAS_TILES;

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
  arenaBounds: { value: THREE.Vector4 };
  /** Ambient light floor inside an arena; 0 disables it. */
  arenaLight: { value: number };
  /** Direct radiance of the casting body (sun by day, moon by night) at the
   *  ground, already reddened by the air it crossed. See sky.ts. */
  sunTint: { value: THREE.Color };
  /** Ambient irradiance from the whole sky dome onto an up-facing surface. */
  skyTint: { value: THREE.Color };
  /** Seconds since the world loaded, for water, foliage and flicker. */
  time: { value: number };
  /** Unit vector toward whichever body is lighting the world. The shadow
   *  pass casts down this same vector, and the water glints along it. */
  lightDir: { value: THREE.Vector3 };
  /** Unit vector toward the SUN specifically (the fog's in-scatter and the
   *  water's reflected sky are about the sun even at dusk). */
  sunDir: { value: THREE.Vector3 };
  /** How night it is, 0..1. */
  night: { value: number };
  /** Horizon colour (the fog colour): what water reflects at a glance. */
  skyColor: { value: THREE.Color };
  /** Zenith colour: what calm water reflects looking straight down. */
  zenith: { value: THREE.Color };
  /** Extra horizon glow toward the sun, added to the fog by view direction. */
  fogSun: { value: THREE.Color };
  /** 1 on the `max` preset (HDR, tone-mapped by PostFX), 0 below it. */
  shaderMode: { value: number };
  shadow: ShadowUniforms;
}

/** The bit of GLSL both materials share: the voxel light model, the sun shadow
 *  lookup, the atmosphere and the atlas sampler. */
const CHUNK_COMMON = /* glsl */`
uniform float uSunLight;
uniform float uAuroraLight;
uniform vec4 uTorch;
uniform vec4 uArenaBounds;
uniform float uArenaLight;
uniform vec3 uSunTint;
uniform vec3 uSkyTint;
uniform float uTime;
uniform vec3 uLightDir;
uniform vec3 uSunDir;
uniform float uNight;
uniform vec3 uWaterSky;
uniform vec3 uZenith;
uniform vec3 uFogSun;
uniform float uShaderMode;
uniform sampler2D uShadowMap;
uniform mat4 uShadowMatrix;
uniform vec3 uShadowParams;
uniform vec3 uShadeOrigin;
varying vec2 vSkyBlock;
varying vec3 vWorldPos;
varying vec3 vRelPos;
varying vec3 vInfo;

// Matches three.js's packDepthToRGBA, which is what the shadow pass writes.
// packDepthToRGBA puts the FINEST bits in .r and the coarsest in .a, so the
// weights descend the other way. Swapping .r and .b is the obvious mistake and
// covers the world in speckled shadow dots.
float voxUnpackDepth(const in vec4 v) {
  return dot(v, vec4(255.0 / 4294967296.0, 255.0 / 16777216.0,
                     255.0 / 65536.0, 255.0 / 256.0));
}

/** Interleaved gradient noise: a per-pixel rotation for the shadow taps that
 *  trades the banding of a fixed kernel for a fine, even grain. */
float voxIGN(vec2 p) {
  return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715))));
}

/**
 * How much of the LIGHT reaches this fragment: 1 in the open, 0 in full shade.
 * Sixteen taps on a Poisson disc, rotated per pixel, so a shadow edge is a
 * soft penumbra a couple of texels wide instead of a staircase. relPos is
 * measured from uShadeOrigin, never absolute — see shadows.ts.
 */
float voxSunVisibility(vec3 relPos, vec3 n) {
  if (uShadowParams.x < 0.5) return 1.0;
  float ndl = dot(n, uLightDir);
  if (ndl <= 0.0) return 1.0; // facing away: N.L already zeroes the light
  // Normal offset: a voxel face sits exactly on its own depth, so push the
  // lookup a third of a block off the surface before comparing.
  vec3 p = relPos + n * 0.30 + uLightDir * 0.05;
  vec3 c = (uShadowMatrix * vec4(p, 1.0)).xyz;
  if (c.x <= 0.004 || c.x >= 0.996 || c.y <= 0.004 || c.y >= 0.996
    || c.z >= 0.999) return 1.0;
  float bias = 0.0004 + 0.0016 * (1.0 - ndl);
  float a = voxIGN(gl_FragCoord.xy) * 6.2831853;
  mat2 rot = mat2(cos(a), sin(a), -sin(a), cos(a));
  float r = uShadowParams.y * 1.7;
  vec2 taps[16] = vec2[16](
    vec2(-0.942, -0.399), vec2(0.946, -0.769), vec2(-0.094, -0.929), vec2(0.345, 0.294),
    vec2(-0.916, 0.458), vec2(-0.815, -0.879), vec2(-0.383, 0.277), vec2(0.975, 0.756),
    vec2(0.443, -0.975), vec2(0.537, -0.474), vec2(-0.265, -0.419), vec2(0.792, 0.191),
    vec2(-0.242, 0.997), vec2(-0.814, 0.914), vec2(0.200, 0.786), vec2(0.144, -0.141));
  float sum = 0.0;
  for (int i = 0; i < 16; i++) {
    vec2 uv = c.xy + rot * taps[i] * r;
    sum += step(c.z - bias, voxUnpackDepth(texture2D(uShadowMap, uv)));
  }
  // Fade the map out toward its own edge, so the box it covers never shows.
  vec2 e = min(c.xy, 1.0 - c.xy);
  float edge = smoothstep(0.0, 0.08, min(e.x, e.y));
  return mix(1.0, sum / 16.0, edge * uShadowParams.z);
}

vec3 voxViewDir() {
  return normalize((cameraPosition - uShadeOrigin) - vRelPos);
}

/** The face normal, from the screen-space derivative of the ORIGIN-RELATIVE
 *  position (see shadows.ts: an absolute one is quantised in the arenas). */
vec3 voxFaceNormal() {
  vec3 n = normalize(cross(dFdx(vRelPos), dFdy(vRelPos)));
  return dot(n, (cameraPosition - uShadeOrigin) - vRelPos) < 0.0 ? -n : n;
}

/** The display curve for presets with no tone-mapper after us (sky.ts has
 *  the twin; the fog colour is pre-kneed on the CPU to match). */
vec3 voxKnee(vec3 c) {
  vec3 over = max(c - 0.78, 0.0);
  return c - over + (1.0 - exp(-over / 0.22)) * 0.22;
}

float voxLuma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
`;

/**
 * The atlas sampler, replacing three's map_fragment.
 *
 * THE GREY LINES. The atlas is 20x20 cells of 32px, each a 16px tile in an
 * 8px gutter of its own edge pixels — and plenty of the cells are EMPTY, i.e.
 * transparent. Two things let a distant face read outside its cell. Past mip 5
 * one texel spans two cells, so the tile averages with its neighbour; and
 * anisotropic filtering stretches its footprint along the view at a grazing
 * angle, straight across the gutter into the next cell. Either way the edge of
 * a far block picked up transparent texels, alpha-to-coverage dropped samples
 * there, and the fog showed through as a grey line down every block seam — worse
 * on the smooth-lighting preset only because it also draws two more chunks.
 *
 * The fix is to never ASK for a footprint bigger than the gutter. Gradients up
 * to 8 atlas px pass through untouched, so near and mid-distance ground keeps
 * its full anisotropic sharpness. Beyond that the footprint is made isotropic
 * (no stretch) and the LOD is capped at 5, where one texel is exactly one cell
 * — the tile's own average colour, never its neighbour's.
 */
const ATLAS_SAMPLE = /* glsl */`
#ifdef USE_MAP
  vec2 voxGx = dFdx(vMapUv) * ${ATLAS_PX.toFixed(1)};
  vec2 voxGy = dFdy(vMapUv) * ${ATLAS_PX.toFixed(1)};
  float voxMajor = max(length(voxGx), length(voxGy));
  if (voxMajor > 8.0) {
    float voxIso = min(max(min(length(voxGx), length(voxGy)), 8.0), 32.0);
    voxGx = normalize(voxGx + 1e-6) * voxIso;
    voxGy = normalize(voxGy + 1e-6) * voxIso;
  }
  vec4 sampledDiffuseColor = textureGrad(map, vMapUv,
    voxGx / ${ATLAS_PX.toFixed(1)}, voxGy / ${ATLAS_PX.toFixed(1)});
  diffuseColor *= sampledDiffuseColor;
#endif
`;

/**
 * Injects the light model into a built-in material.
 *
 * Every chunk vertex carries its colour (albedo tint x ambient occlusion x the
 * vanilla per-face shade), its (sky, block) light levels, and `vxinfo`
 * (surface kind, emission, sway) from the mesher. The fragment stage divides
 * the baked face shade back OUT and relights the surface properly:
 *
 *   ambient  the sky dome's irradiance, hemispherical (up-faces see all of it,
 *            walls most, undersides a ground bounce), scaled by skylight level
 *   direct   the sun or moon, N.L, times the shadow map, times sky exposure
 *   block    torch/lava light — warm, gently flickering
 *   emissive glowing blocks light themselves
 *
 * then fogs by distance in LINEAR light (before the sRGB encode, unlike
 * three's own fog chunk), leaning the fog toward the sun's colour along its
 * bearing, which is what makes a sunset hang in the air rather than on a
 * backdrop.
 */
function applyLightShader(
  mat: THREE.Material, u: ChunkShaderUniforms, water: boolean
): void {
  mat.customProgramCacheKey = () => (water ? 'voxel-water-2' : 'voxel-light-2');
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uSunLight = u.sun;
    shader.uniforms.uAuroraLight = u.aurora;
    shader.uniforms.uTorch = u.torch;
    shader.uniforms.uArenaBounds = u.arenaBounds;
    shader.uniforms.uArenaLight = u.arenaLight;
    shader.uniforms.uSunTint = u.sunTint;
    shader.uniforms.uSkyTint = u.skyTint;
    shader.uniforms.uTime = u.time;
    shader.uniforms.uLightDir = u.lightDir;
    shader.uniforms.uSunDir = u.sunDir;
    shader.uniforms.uNight = u.night;
    shader.uniforms.uWaterSky = u.skyColor;
    shader.uniforms.uZenith = u.zenith;
    shader.uniforms.uFogSun = u.fogSun;
    shader.uniforms.uShaderMode = u.shaderMode;
    shader.uniforms.uShadowMap = u.shadow.map;
    shader.uniforms.uShadowMatrix = u.shadow.matrix;
    shader.uniforms.uShadowParams = u.shadow.params;
    shader.uniforms.uShadeOrigin = u.shadow.origin;

    // --- vertex
    const move = water ? /* glsl */`
      // Waves. Only the vertices ON the open water surface move — the mesher
      // drops an exposed top by 1/8 of a block, so exactly that ring sits at
      // .875 — which keeps the mesh sealed.
      float atSurface = step(0.8, fract(worldSeed.y));
      float wv = sin(worldSeed.x * 0.62 + uTime * 1.5) * 0.5
               + sin(worldSeed.z * 0.48 - uTime * 1.15) * 0.42
               + sin((worldSeed.x + worldSeed.z) * 0.31 + uTime * 0.83) * 0.34;
      transformed.y += uShaderMode * atSurface * wv * 0.045;
    ` : /* glsl */`
      // Wind. Plants sway from the root (only their top corners carry a sway
      // weight) and leaves shiver in place. The offset is a function of WORLD
      // position alone, so two leaf blocks sharing a corner move it together
      // and the canopy never cracks open.
      float sway = vxinfo.z * uShaderMode;
      if (sway > 0.0) {
        float gust = 0.6 + 0.4 * sin(uTime * 0.35 + worldSeed.x * 0.02 + worldSeed.z * 0.015);
        float t = uTime * 1.9;
        vec2 w = vec2(
          sin(t + worldSeed.x * 0.73 + worldSeed.z * 0.31) + 0.35 * sin(t * 2.3 + worldSeed.z * 1.7),
          cos(t * 0.83 + worldSeed.z * 0.61 + worldSeed.x * 0.27) + 0.35 * cos(t * 2.1 + worldSeed.x * 1.3));
        transformed.xz += w * 0.055 * sway * gust;
        transformed.y += sin(t * 1.4 + worldSeed.x + worldSeed.z) * 0.012 * sway;
      }
    `;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nattribute vec2 skyblock;\nattribute vec3 vxinfo;\n'
        + 'varying vec2 vSkyBlock;\nvarying vec3 vInfo;\n'
        + 'varying vec3 vWorldPos;\nvarying vec3 vRelPos;\nuniform vec3 uShadeOrigin;\n'
        + 'uniform float uTime;\nuniform float uShaderMode;'
      )
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvSkyBlock = skyblock;\nvInfo = vxinfo;\n'
        + 'vec3 worldSeed = (modelMatrix * vec4(transformed, 1.0)).xyz;\n'
        + move
        + 'vWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\n'
        // Measured from the shading origin from the START (both origins are
        // whole blocks, so their difference is exact) — see shadows.ts.
        + 'vRelPos = mat3(modelMatrix) * transformed'
        + ' + (modelMatrix[3].xyz - uShadeOrigin);'
      );

    // --- fragment
    const lighting = /* glsl */`
      if (uArenaBounds.x < uArenaBounds.z && (vWorldPos.x < uArenaBounds.x
        || vWorldPos.x >= uArenaBounds.z || vWorldPos.z < uArenaBounds.y
        || vWorldPos.z >= uArenaBounds.w)) discard;

      vec3 faceN = voxFaceNormal();
      float kind = floor(vInfo.x + 0.5);           // 0 solid, 1 plant, 2 leaves, 3 water
      bool plant = kind > 0.5 && kind < 1.5;
      // Undo the vanilla face shade the mesher baked into the vertex colour,
      // leaving albedo x tint x AO. Plants were never shaded.
      float baked = plant ? 1.0
        : faceN.y > 0.5 ? 1.0 : faceN.y < -0.5 ? 0.5 : abs(faceN.z) > 0.5 ? 0.8 : 0.6;
      vec3 albedo = diffuseColor.rgb / baked;
      vec3 litN = plant ? vec3(0.0, 1.0, 0.0) : faceN;

      float skyLv = vSkyBlock.x;
      if (uArenaLight > 0.0) skyLv = max(skyLv, uArenaLight);
      float blkLv = vSkyBlock.y;
      // The vanilla perceptual ramp: every level is 80% of the one above.
      float skyK = pow(0.8, 15.0 * (1.0 - skyLv));
      float blkK = pow(0.8, 15.0 * (1.0 - blkLv));

      // Direct light. Only cells open to the sky see the sun at all; the
      // shadow map then decides what is actually in the way.
      float exposure = smoothstep(0.62, 0.97, skyLv);
      float sunVis = voxSunVisibility(vRelPos, faceN);
      float ndl = plant ? 0.35 + 0.65 * max(uLightDir.y, 0.0)
                        : max(dot(litN, uLightDir), 0.0);
      vec3 direct = uSunTint * ndl * sunVis * exposure;

      // Ambient: up-faces see the whole dome, walls about two thirds of it,
      // undersides only what bounces off the ground.
      float up = litN.y * 0.5 + 0.5;
      vec3 ambient = uSkyTint * (0.40 + 0.60 * up)
        + uSunTint * 0.10 * (1.0 - up) * exposure;
      ambient *= skyK;
      // A little of the aurora's colour reaches open ground.
      float aurora = uAuroraLight * smoothstep(0.35, 1.0, skyLv);
      ambient += vec3(0.02, 0.08, 0.07) * aurora * skyK;

      // Block light: firelight, warm, breathing very slightly.
      float flick = 0.95 + 0.05 * sin(uTime * 7.3 + vWorldPos.x * 1.7 + vWorldPos.z * 2.3)
                         * sin(uTime * 3.1 + vWorldPos.y);
      vec3 fire = vec3(1.0, 0.68, 0.38);
      vec3 blockLight = fire * blkK * 1.05 * mix(1.0, flick, uShaderMode);
      // The held torch: a moving point light, no remesh needed.
      float td = distance(vWorldPos, uTorch.xyz);
      float fall = clamp(1.0 - td / 16.0, 0.0, 1.0);
      float torch = uTorch.w * (0.45 * fall + 0.55 * fall * fall);
      blockLight = max(blockLight, fire * torch * 1.05);

      vec3 lit = albedo * (ambient + direct + blockLight);
      // Emitters light themselves, and in HDR they run hot enough to bloom.
      lit += albedo * vInfo.y * (0.55 + 0.9 * uShaderMode);

      // NIGHT: the colour cones give out in the dark (the Purkinje shift) and
      // what little light is left drains to silver-blue — except where fire
      // is actually lighting the surface, which keeps its warmth and becomes
      // the only real colour in the frame.
      float nl = voxLuma(lit);
      float warmth = clamp(voxLuma(blockLight) * 2.2 + vInfo.y, 0.0, 1.0);
      float scot = uNight * (1.0 - smoothstep(0.03, 0.30, nl)) * (1.0 - warmth);
      lit = mix(lit, vec3(nl) * vec3(0.80, 0.90, 1.22), scot * 0.4);

      // A touch of vibrance: the atlas art is painted muted so the biome tints
      // can do the talking.
      float lum = voxLuma(lit);
      lit = max(mix(vec3(lum), lit, 1.24), 0.0);
      diffuseColor.rgb = lit;
    `;

    const waterBody = water ? /* glsl */`
      // WATER: a sky in it. Fresnel reflection of the actual atmosphere (the
      // horizon at a glance, the zenith straight down), a sharp sun glint that
      // the ripples break into sparkles, and depth where you look straight in.
      vec3 viewDir = voxViewDir();
      float surf = smoothstep(0.55, 0.86, abs(faceN.y));
      vec2 wp = vWorldPos.xz;
      float T = uTime;
      vec2 g = vec2(0.0);
      g += vec2(cos(wp.x * 1.55 + T * 2.0), 0.0) * 0.20;
      g += vec2(0.0, cos(wp.y * 1.21 - T * 1.6)) * 0.20;
      g += vec2(0.7, 0.7) * cos((wp.x + wp.y) * 0.87 - T * 1.25) * 0.13;
      g += vec2(-0.6, 0.8) * cos(dot(wp, vec2(-2.3, 3.1)) + T * 2.7) * 0.06;
      g += vec2(0.9, -0.4) * cos(dot(wp, vec2(3.7, -1.9)) - T * 3.3) * 0.045;
      float nUp = faceN.y < 0.0 ? -1.0 : 1.0;
      vec3 rippleN = normalize(vec3(g.x, nUp, g.y));
      vec3 wetN = normalize(mix(faceN, rippleN, surf * mix(0.35, 0.9, uShaderMode)));

      float cosV = max(dot(viewDir, wetN), 0.0);
      float fres = 0.02 + 0.98 * pow(1.0 - cosV, 5.0);
      fres *= surf;
      vec3 refl = reflect(-viewDir, wetN);
      vec3 skyRefl = mix(uWaterSky, uZenith, smoothstep(0.0, 0.7, refl.y))
        + uFogSun * pow(max(dot(normalize(vec3(refl.x, max(refl.y, 0.02), refl.z)), uSunDir), 0.0), 6.0);
      skyRefl *= mix(0.35, 1.0, skyK); // no bright sky reflected in a cave pool
      vec3 deep = albedo * (ambient + direct * 0.5) * 0.55;
      diffuseColor.rgb = mix(mix(diffuseColor.rgb, deep, 0.35 * surf * uShaderMode),
                             skyRefl, fres * 0.82);

      vec3 halfDir = normalize(viewDir + uLightDir);
      float spec = pow(max(dot(wetN, halfDir), 0.0), mix(64.0, 220.0, uShaderMode));
      diffuseColor.rgb += uSunTint * spec * surf * sunVis * exposure
        * mix(1.2, 7.0, uShaderMode);

      diffuseColor.a = clamp(diffuseColor.a * mix(0.92, 1.25, fres), 0.0, 1.0);
    ` : '';

    const fog = /* glsl */`
      // Tone: presets without the HDR stack get the display knee here.
      if (uShaderMode < 0.5) diffuseColor.rgb = voxKnee(diffuseColor.rgb);
      #ifdef USE_FOG
        vec3 eyeRel = (cameraPosition - uShadeOrigin);
        vec3 toFrag = vRelPos - eyeRel;
        float dist = length(toFrag);
        vec3 vdir = toFrag / max(dist, 1e-4);
        float sunward = pow(max(dot(vdir, normalize(vec3(uSunDir.x, 0.0, uSunDir.z) + vec3(0.0, 1e-4, 0.0))), 0.0), 5.0);
        vec3 fogCol = fogColor + uFogSun * sunward;
        // Aerial perspective: a light haze that thickens with distance well
        // before the hard fog wall, which is what gives the land DEPTH.
        float haze = (1.0 - exp(-dist * 0.003)) * 0.18;
        float wall = smoothstep(fogNear, fogFar, vFogDepth);
        diffuseColor.rgb = mix(diffuseColor.rgb, fogCol, max(haze, wall));
      #endif
    `;

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + CHUNK_COMMON)
      .replace('#include <map_fragment>', ATLAS_SAMPLE)
      .replace('#include <color_fragment>', '#include <color_fragment>\n' + lighting + waterBody)
      .replace('#include <opaque_fragment>', fog + '\n#include <opaque_fragment>')
      .replace('#include <fog_fragment>', '');
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
  /** Direct radiance of the sun (or moon) at the ground. */
  readonly sunTintUniform = { value: new THREE.Color(1, 1, 1) };
  /** Ambient sky irradiance that fills shade. */
  readonly skyTintUniform = { value: new THREE.Color(1, 1, 1) };
  /** Held-torch point light shared with the chunk shaders (xyz pos, w intensity). */
  readonly torchUniform = { value: new THREE.Vector4(0, 0, 0, 0) };
  /** x/z render crop for minigame arenas. x>=z disables the crop. */
  readonly arenaBoundsUniform = { value: new THREE.Vector4(1, 1, 0, 0) };
  /** Ambient light floor inside the cropped arena; 0 in the open world. */
  readonly arenaLightUniform = { value: 0 };
  /** Seconds since load, driving water, foliage and flicker. */
  readonly timeUniform = { value: 0 };
  /** Unit vector toward the body that is lighting the world. */
  readonly lightDirUniform = { value: new THREE.Vector3(0, 1, 0) };
  /** Unit vector toward the sun itself (fog in-scatter, reflected sky). */
  readonly sunDirUniform = { value: new THREE.Vector3(0, 1, 0) };
  /** How night it is, 0..1. */
  readonly nightUniform = { value: 0 };
  /** Horizon colour, which is what the water surface reflects at a glance. */
  readonly skyColorUniform = { value: new THREE.Color(0.55, 0.72, 0.95) };
  /** Zenith colour, which calm water reflects looking straight down. */
  readonly zenithUniform = { value: new THREE.Color(0.25, 0.45, 0.85) };
  /** Horizon glow toward the sun, added to the fog along its bearing. */
  readonly fogSunUniform = { value: new THREE.Color(0, 0, 0) };
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
    origin: { value: new THREE.Vector3() },
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
      arenaBounds: this.arenaBoundsUniform, arenaLight: this.arenaLightUniform,
      sunTint: this.sunTintUniform,
      skyTint: this.skyTintUniform, time: this.timeUniform,
      lightDir: this.lightDirUniform, sunDir: this.sunDirUniform,
      night: this.nightUniform, skyColor: this.skyColorUniform,
      zenith: this.zenithUniform, fogSun: this.fogSunUniform,
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

  /** Copy everything the sky measured this frame into the chunk shaders.
   *  `openAir` is false underwater or in a vault, where the horizon's glow
   *  toward the sun has no business being in the fog. */
  applySky(sky: Sky, openAir = true): void {
    this.sunUniform.value = sky.sunIntensity;
    this.auroraUniform.value = sky.auroraIntensity;
    this.sunTintUniform.value.copy(sky.sunTint);
    this.skyTintUniform.value.copy(sky.ambientTint);
    this.lightDirUniform.value.copy(sky.lightDir);
    this.sunDirUniform.value.copy(sky.sunDir);
    this.nightUniform.value = sky.nightAmount;
    this.skyColorUniform.value.copy(sky.skyColor);
    this.zenithUniform.value.copy(sky.zenithColor);
    if (openAir) this.fogSunUniform.value.copy(sky.fogSunColor);
    else this.fogSunUniform.value.setRGB(0, 0, 0);
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

  /** Hide all terrain outside one temporary minigame arena, including geometry
   * sharing a chunk mesh with its walls, and apply that mode's ambient floor.
   * Passing null restores the open world. */
  setArenaRenderBounds(
    bounds: { minX: number; minZ: number; maxX: number; maxZ: number } | null,
    ambientFloor = 0,
  ): void {
    if (bounds) this.arenaBoundsUniform.value.set(bounds.minX, bounds.minZ, bounds.maxX, bounds.maxZ);
    else this.arenaBoundsUniform.value.set(1, 1, 0, 0);
    this.arenaLightUniform.value = bounds ? ambientFloor : 0;
  }


  /** Drop a retired procedural arena, including its placed-block overlay. */
  invalidateArena(bounds: { minX:number; maxX:number; minZ:number; maxZ:number }): void {
    for(let cx=Math.floor(bounds.minX/16);cx<=Math.floor((bounds.maxX-1)/16);cx++)
      for(let cz=Math.floor(bounds.minZ/16);cz<=Math.floor((bounds.maxZ-1)/16);cz++){
        const key=Chunk.key(cx,cz),chunk=this.chunks.get(key);
        if(chunk){this.disposeMeshes(chunk);this.chunks.delete(key);}
        this.editOverlay.delete(key);
      }
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
