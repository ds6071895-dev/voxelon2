// Sky: 20-minute day/night cycle driven by a small ATMOSPHERE MODEL.
//
// Everything the world is lit by comes out of one function, `scatter()`, which
// exists twice — once in GLSL for the dome, once in TypeScript for the CPU —
// and the two are kept line-for-line identical. It is single-scattering
// Rayleigh (the blue) plus Mie (the white glare round the sun), attenuated by
// how much air the sunlight crossed on its way in. That one idea produces every
// sky the day needs without a colour table: a deep blue zenith over a pale
// horizon at noon, gold as the sun drops and its light crosses more air, an
// ember-red disc on the skyline, and the "blue hour" after it sets, when the
// high sky is still lit but the ground is not.
//
// Because the CPU runs the same maths, the fog colour, the ambient sky light,
// the direct sunlight and the water's reflection are all MEASURED off the sky
// the player is looking at rather than tuned alongside it — so the horizon the
// terrain fades into is always exactly the horizon the dome paints.
//
// The dome also draws the sun and moon discs, a starfield that turns with the
// sky, a Milky Way band, and the night aurora — all per fragment, so none of it
// is a sprite that can be seen edge-on or clipped by the far plane.

import * as THREE from 'three';
import { mulberry32, wrappedValueNoise } from './noise';

export const DAY_LENGTH = 1200; // seconds: vanilla 20-minute day
export const WATER_FOG_COLOR = new THREE.Color(0x16335f);

const CLOUD_Y = 192;
const CLOUD_TEX = 64;     // texels per repeat
const CLOUD_PLANE = 4096; // world units
const CLOUD_REPEAT = 4;   // -> one cloud cell = 16 blocks, like vanilla
// A second, higher and sparser deck. Two layers drifting at different speeds
// give the sky PARALLAX, which is most of what makes it read as deep.
const HIGH_CLOUD_Y = 244;
const HIGH_CLOUD_REPEAT = 2;

/** Moonlit-night skylight floor. Higher than vanilla so the world stays
 *  PLAYABLE at night (you can still see) while reading clearly as night —
 *  the sky itself, stars and fog still go dark (those track `s`, not this). */
export const NIGHT_FLOOR = 0.36;

/**
 * Sunlight factor for a time of day in [0,1) (0 = sunrise, 0.25 = noon,
 * 0.5 = sunset, 0.75 = midnight). Clamped to NIGHT_FLOOR so moonlit nights
 * keep a comfortable, visible skylight. Pure, for tests.
 */
export function daylight(tod: number): number {
  const sunHeight = Math.sin(tod * Math.PI * 2);
  const t = Math.min(1, Math.max(0, (sunHeight + 0.08) / 0.3));
  const s = t * t * (3 - 2 * t);
  return NIGHT_FLOOR + (1 - NIGHT_FLOOR) * s;
}

// ─── the atmosphere ─────────────────────────────────────────────────────────
//
// Units are "game radiance": 1.0 is roughly a sunlit white block at noon. The
// scattering coefficients are Earth's ratios (blue scatters ~5.5x more than
// red), scaled to a thinner air so the game's compressed day still reads.

/** Rayleigh extinction per unit air mass. */
const BETA_R: [number, number, number] = [0.080, 0.180, 0.420];
/** Mie (haze) extinction per unit air mass — grey, it scatters every colour. */
const BETA_M = 0.020;
/** Sunlight arriving at the top of the air, in game radiance. */
const SUN_E = 3.2;
/** The moon: the same sky model, a few percent as bright and a touch cooler. */
const MOON_E = 0.09;
/** Direct light on the ground, before transmittance. */
const SUN_DIRECT = 0.68;
const MOON_DIRECT = 0.17;
/** Ambient sky irradiance scale — how much of the dome's light fills shade. */
const AMBIENT_SCALE = 0.33;
/** Starlight and airglow: the floor under a moonless night. */
const NIGHT_BASE: [number, number, number] = [0.020, 0.028, 0.056];

/** Air mass looking along a direction of height y (thin at the zenith, ~7x at
 *  the skyline). Offsets differ for the view and for the sun, because a sun
 *  ON the horizon has to go properly red while the skyline itself only has to
 *  go pale. */
function airView(y: number): number { return 1 / (Math.max(y, 0) + 0.35); }
function airSun(y: number): number { return 1 / (Math.max(y, 0) + 0.06); }

/** Sunlight left after crossing the air to reach a point, per channel. */
function transmit(y: number, out: THREE.Color): THREE.Color {
  const m = airSun(y);
  return out.setRGB(
    Math.exp(-(BETA_R[0] + BETA_M) * m),
    Math.exp(-(BETA_R[1] + BETA_M) * m),
    Math.exp(-(BETA_R[2] + BETA_M) * m));
}

function smooth(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

const _t = new THREE.Color();
/** Sky radiance seen along `d` (unit) from a light at `l` (unit) of strength
 *  `e`, ADDED into `out`. The TypeScript twin of GLSL `scatter()`. */
function scatterInto(
  d: THREE.Vector3, l: THREE.Vector3, e: number, out: THREE.Color
): void {
  const mu = d.x * l.x + d.y * l.y + d.z * l.z;
  const am = airView(d.y);
  const pR = 0.75 * (1 + mu * mu);
  const g = 0.76;
  const pM = (1 - g * g) / Math.pow(1 + g * g - 2 * g * mu, 1.5) * 0.12;
  const inM = 1 - Math.exp(-BETA_M * am);
  const vis = smooth(-0.14, 0.03, l.y);
  transmit(l.y, _t);
  const k = e * vis;
  out.r += k * _t.r * ((1 - Math.exp(-BETA_R[0] * am)) * pR + inM * pM);
  out.g += k * _t.g * ((1 - Math.exp(-BETA_R[1] * am)) * pR + inM * pM);
  out.b += k * _t.b * ((1 - Math.exp(-BETA_R[2] * am)) * pR + inM * pM);
  // Multiple scattering + ozone: what keeps the zenith BLUE through twilight
  // instead of letting it fall straight to black the moment the direct path
  // reddens out.
  const ms = e * 0.055 * smooth(-0.18, 0.35, l.y) * (0.35 + 0.65 * Math.min(1, Math.max(0, d.y)));
  out.r += ms * 0.30; out.g += ms * 0.50; out.b += ms * 1.0;
}

/**
 * The display curve used when there is NO post-processing stack to tone-map
 * the frame: identity up to 0.78, then a soft shoulder to 1.0. The dome, the
 * fog colour and the terrain all go through this same curve on those presets,
 * which is what keeps the skyline seamless on every preset. Exported for the
 * GLSL twin's documentation only — the shaders carry their own copy.
 */
export function displayKnee(c: THREE.Color): THREE.Color {
  const k = (x: number): number => {
    const over = Math.max(x - 0.78, 0);
    return x - over + (1 - Math.exp(-over / 0.22)) * 0.22;
  };
  return c.setRGB(k(c.r), k(c.g), k(c.b));
}

/** GLSL twins of the functions above. Shared with the chunk shader (world.ts)
 *  so the water reflects the SAME sky the dome draws. */
export const ATMOSPHERE_GLSL = /* glsl */`
const vec3 VX_BETA_R = vec3(${BETA_R.join(', ')});
const float VX_BETA_M = ${BETA_M.toFixed(4)};
float vxAirView(float y) { return 1.0 / (max(y, 0.0) + 0.35); }
float vxAirSun(float y) { return 1.0 / (max(y, 0.0) + 0.06); }
vec3 vxTransmit(float y) { return exp(-(VX_BETA_R + VX_BETA_M) * vxAirSun(y)); }
vec3 vxScatter(vec3 d, vec3 l, float e) {
  float mu = dot(d, l);
  float am = vxAirView(d.y);
  float pR = 0.75 * (1.0 + mu * mu);
  const float g = 0.76;
  float pM = (1.0 - g * g) / pow(1.0 + g * g - 2.0 * g * mu, 1.5) * 0.12;
  float inM = 1.0 - exp(-VX_BETA_M * am);
  vec3 inR = 1.0 - exp(-VX_BETA_R * am);
  float vis = smoothstep(-0.14, 0.03, l.y);
  vec3 c = e * vis * vxTransmit(l.y) * (inR * pR + inM * pM);
  c += e * 0.055 * vec3(0.30, 0.50, 1.0) * smoothstep(-0.18, 0.35, l.y)
     * (0.35 + 0.65 * clamp(d.y, 0.0, 1.0));
  return c;
}
vec3 vxKnee(vec3 c) {
  vec3 over = max(c - 0.78, 0.0);
  return c - over + (1.0 - exp(-over / 0.22)) * 0.22;
}
`;

// ─── the dome ───────────────────────────────────────────────────────────────

const DOME_VERT = /* glsl */`
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const DOME_FRAG = /* glsl */`
  uniform vec3 uSunDir;
  uniform vec3 uMoonDir;
  uniform float uSunE;
  uniform float uMoonE;
  uniform vec3 uNightBase;
  uniform float uNight;
  uniform float uHDR;
  uniform float uTime;
  uniform mat3 uStarRot;
  uniform float uAurora;
  uniform float uAuroraTime;
  uniform float uAuroraPhase;
  varying vec3 vDir;

  ${ATMOSPHERE_GLSL}

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }
  float hash3(vec3 p) {
    p = fract(p * 0.3183099 + 0.1);
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }
  float vnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
               mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
  }
  float vnoise3(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float n000 = hash3(i), n100 = hash3(i + vec3(1, 0, 0));
    float n010 = hash3(i + vec3(0, 1, 0)), n110 = hash3(i + vec3(1, 1, 0));
    float n001 = hash3(i + vec3(0, 0, 1)), n101 = hash3(i + vec3(1, 0, 1));
    float n011 = hash3(i + vec3(0, 1, 1)), n111 = hash3(i + vec3(1, 1, 1));
    return mix(mix(mix(n000, n100, f.x), mix(n010, n110, f.x), f.y),
               mix(mix(n001, n101, f.x), mix(n011, n111, f.x), f.y), f.z);
  }
  float fbm3(vec3 p) {
    float a = 0.5, s = 0.0;
    for (int i = 0; i < 4; i++) { s += a * vnoise3(p); p = p * 2.03 + 11.7; a *= 0.5; }
    return s;
  }
  float fbm2(vec2 p) {
    return vnoise(p) * 0.65 + vnoise(p * 2.07 + 19.3) * 0.35;
  }

  /** One aurora curtain: a band of light draped around the sky at elevation
   *  centre, its lower hem crisp and its crown feathering out. */
  vec3 curtain(vec2 bearing, float azim, float elev, float centre,
               float width, float speed, float phase, float rayCount) {
    float drift = uAuroraTime * speed;
    float sweep = fbm2(bearing * 1.6 + vec2(drift, phase)) - 0.5;
    float waver = vnoise(bearing * 5.1 - vec2(drift * 1.7, phase)) - 0.5;
    float hem = centre + sweep * 0.34 + waver * 0.12;
    float above = elev - hem;
    float body = smoothstep(-0.035, 0.045, above) *
      (1.0 - smoothstep(0.0, width, above));
    if (body <= 0.0) return vec3(0.0);
    float ray = vnoise(bearing * 23.0 + vec2(phase, drift * 0.6));
    float rays = 0.5 + 0.5 * sin(rayCount * azim + ray * 21.0 + phase);
    rays = rays * rays; rays = rays * rays;
    float shimmer = 0.72 + 0.28 * sin(uAuroraTime * 0.9 + ray * 12.0 + phase);
    float presence = smoothstep(0.26, 0.74,
      fbm2(bearing * 0.9 + vec2(drift * 0.45, phase * 0.5)));
    float h = clamp(above / width, 0.0, 1.0);
    vec3 tint = mix(vec3(0.20, 1.00, 0.55), vec3(0.20, 0.78, 1.00), smoothstep(0.10, 0.62, h));
    tint = mix(tint, vec3(0.62, 0.34, 1.00), smoothstep(0.55, 1.0, h));
    return tint * body * shimmer * presence * (0.30 + rays * 0.85);
  }

  /** Stars on a rotating celestial sphere: a jittered point per cell of a 3D
   *  grid, kept only where the hash says so, each with its own colour
   *  temperature and twinkle. */
  vec3 stars(vec3 d) {
    vec3 p = d * 190.0;
    vec3 ip = floor(p);
    vec3 fp = fract(p);
    float h = hash3(ip);
    if (h < 0.955) return vec3(0.0);
    vec3 at = vec3(hash3(ip + 3.1), hash3(ip + 7.7), hash3(ip + 13.3)) * 0.7 + 0.15;
    float r = length(fp - at);
    float mag = pow((h - 0.955) / 0.045, 3.0);
    float core = smoothstep(0.16 + mag * 0.16, 0.0, r);
    float tw = 0.65 + 0.35 * sin(uTime * (1.3 + h * 4.0) + h * 91.0);
    vec3 temp = mix(vec3(0.68, 0.78, 1.0), vec3(1.0, 0.86, 0.66), hash3(ip + 5.0));
    return temp * core * (0.35 + mag * 2.4) * tw;
  }

  /** The galactic band: a great circle of dim, dusty light. */
  vec3 milkyWay(vec3 d) {
    vec3 n = normalize(vec3(0.32, 0.18, 0.93));
    float b = dot(d, n);
    float band = exp(-b * b * 26.0);
    if (band < 0.01) return vec3(0.0);
    float cloud = fbm3(d * 7.0);
    float dust = smoothstep(0.52, 0.72, fbm3(d * 13.0 + 4.0));
    float core = exp(-b * b * 90.0);
    vec3 c = mix(vec3(0.28, 0.30, 0.52), vec3(0.62, 0.52, 0.55), core);
    return c * band * (0.35 + cloud * 0.9) * (1.0 - dust * 0.75) * 0.11;
  }

  void main() {
    vec3 dir = normalize(vDir);
    vec3 sd = vec3(dir.x, max(dir.y, 0.0), dir.z);
    sd = normalize(sd + vec3(0.0, 0.0001, 0.0));

    vec3 color = vxScatter(sd, uSunDir, uSunE) + vxScatter(sd, uMoonDir, uMoonE) + uNightBase;

    // The night sky proper: stars and the galaxy, fading in as the sky goes
    // dark and out again through the horizon haze.
    if (uNight > 0.01 && dir.y > -0.05) {
      vec3 cd = uStarRot * dir;
      float veil = smoothstep(-0.02, 0.28, dir.y) * uNight;
      color += (stars(cd) * 1.4 + milkyWay(cd)) * veil;
    }

    // Sun disc: limb-darkened, reddened by the same air the sky is.
    float sunCos = dot(dir, uSunDir);
    float sunR = 0.0325;
    float cosR = cos(sunR);
    if (sunCos > cosR - 0.002) {
      float rr = clamp((1.0 - sunCos) / (1.0 - cosR), 0.0, 1.0);
      float limb = 1.0 - 0.55 * (1.0 - sqrt(max(1.0 - rr, 0.0)));
      float disc = smoothstep(cosR - 0.0006, cosR + 0.0003, sunCos);
      color += vxTransmit(uSunDir.y) * disc * limb * (uHDR > 0.5 ? 26.0 : 4.0)
        * smoothstep(-0.06, 0.02, uSunDir.y);
    }
    // A soft corona round it, which the bloom pass then spreads further.
    float corona = pow(max(sunCos, 0.0), 900.0) * 3.0 + pow(max(sunCos, 0.0), 90.0) * 0.35;
    color += vxTransmit(uSunDir.y) * corona * smoothstep(-0.08, 0.02, uSunDir.y);

    // Moon: a cratered disc with its own glow.
    float moonCos = dot(dir, uMoonDir);
    float moonR = 0.026;
    float cosM = cos(moonR);
    if (moonCos > cosM - 0.002) {
      vec3 mz = uMoonDir;
      vec3 mx = normalize(cross(vec3(0.0, 1.0, 0.0), mz));
      vec3 my = cross(mz, mx);
      vec2 uv = vec2(dot(dir, mx), dot(dir, my)) / sin(moonR);
      float maria = smoothstep(0.45, 0.62, fbm3(vec3(uv * 2.2, 3.0)));
      float craters = smoothstep(0.62, 0.8, vnoise(uv * 7.0 + 2.0)) * 0.25;
      float disc = smoothstep(cosM - 0.0005, cosM + 0.0003, moonCos);
      float shade = 1.0 - maria * 0.32 - craters;
      float edge = 0.78 + 0.22 * sqrt(max(1.0 - dot(uv, uv), 0.0));
      color += vec3(0.92, 0.95, 1.0) * disc * shade * edge * (uHDR > 0.5 ? 3.2 : 1.1)
        * smoothstep(-0.06, 0.03, uMoonDir.y);
    }
    color += vec3(0.55, 0.65, 0.9) * pow(max(moonCos, 0.0), 260.0) * 0.5 * uNight;

    if (uAurora > 0.004 && dir.y > -0.05) {
      vec2 ground = vec2(dir.x, dir.z);
      vec2 bearing = ground / max(length(ground), 1e-4);
      float azim = atan(bearing.y, bearing.x);
      float elev = dir.y;
      float ph = uAuroraPhase;
      vec3 light =
        curtain(bearing, azim, elev, 0.16, 0.62, 0.055, ph, 47.0) +
        curtain(bearing, azim, elev, 0.34, 0.50, 0.041, ph + 2.31, 61.0) * 0.70 +
        curtain(bearing, azim, elev, 0.05, 0.78, 0.070, ph + 4.77, 31.0) * 0.52;
      light = light / (1.0 + light * 0.55);
      float sky = smoothstep(-0.04, 0.16, elev);
      color += light * uAurora * 0.38 * sky;
      color += vec3(0.02, 0.06, 0.06) * uAurora * sky;
    }

    // Below the skyline: the far ground, darker than the horizon above it so
    // the world never floats on a band of bright sky.
    color = mix(color, color * 0.62, smoothstep(0.0, -0.18, dir.y));

    if (uHDR < 0.5) color = vxKnee(color);
    gl_FragColor = vec4(color, 1.0);
    #include <colorspace_fragment>
  }
`;

/**
 * The `max` preset's cloud material.
 *
 * The geometry is still one flat plane, but the fragment shader marches a few
 * samples along the view ray through the cloud texture before it decides how
 * opaque a pixel is. That is enough to buy the two things a flat cutout plane
 * can never have: the deck THICKENS as you look along it toward the horizon
 * instead of thinning to a line, and the edges of a cloud go soft because the
 * samples disagree there. A sample taken toward the sun shades the far side of
 * each cloud, and the rim facing the sun keeps the silver lining.
 */
const CLOUD_SHADER = {
  vertexShader: /* glsl */`
    varying vec2 vUv;
    varying vec3 vWorld;
    void main() {
      vUv = uv;
      vec4 wp = modelMatrix * vec4(position, 1.0);
      vWorld = wp.xyz;
      gl_Position = projectionMatrix * viewMatrix * wp;
    }
  `,
  fragmentShader: /* glsl */`
    uniform sampler2D uMap;
    uniform vec2 uOffset;
    uniform float uRepeat;
    uniform float uPlane;
    uniform float uOpacity;
    uniform float uThickness;
    uniform vec3 uLit;
    uniform vec3 uShade;
    uniform vec3 uHaze;
    uniform vec3 uSunDir;
    uniform vec3 uSunColor;
    uniform float uHDR;
    varying vec2 vUv;
    varying vec3 vWorld;

    vec3 vxKneeC(vec3 c) {
      vec3 over = max(c - 0.78, 0.0);
      return c - over + (1.0 - exp(-over / 0.22)) * 0.22;
    }

    void main() {
      vec3 viewDir = normalize(vWorld - cameraPosition);
      vec2 base = vUv * uRepeat + uOffset;
      float uvPerUnit = uRepeat / uPlane;
      vec2 duv = (viewDir.xz / max(abs(viewDir.y), 0.12))
        * uvPerUnit * (uThickness / 6.0);
      float acc = 0.0;
      vec2 uv = base;
      for (int i = 0; i < 6; i++) {
        acc += texture2D(uMap, uv).a;
        uv += duv;
      }
      acc /= 6.0;
      if (acc <= 0.004) discard;

      vec2 sunStep = (uSunDir.xz / max(abs(uSunDir.y), 0.28))
        * uvPerUnit * uThickness * 0.85;
      float occl = texture2D(uMap, base + sunStep).a;
      float lit = 1.0 - 0.62 * occl;

      float toSun = max(dot(viewDir, uSunDir), 0.0);
      float rim = pow(toSun, 8.0) * (1.0 - acc) * 1.6;
      float forward = pow(toSun, 3.0) * 0.35;

      float alpha = smoothstep(0.02, 0.45, acc) * uOpacity;
      float dist = length(vWorld.xz - cameraPosition.xz);
      alpha *= 1.0 - smoothstep(uPlane * 0.22, uPlane * 0.46, dist);
      if (alpha <= 0.002) discard;

      vec3 col = mix(uShade, uLit, lit) + uSunColor * (rim + forward);
      // Distant cloud sinks into the skyline haze, like the terrain does.
      col = mix(col, uHaze, smoothstep(uPlane * 0.08, uPlane * 0.4, dist) * 0.7);
      if (uHDR < 0.5) col = vxKneeC(col);
      gl_FragColor = vec4(col, alpha);
      #include <colorspace_fragment>
    }
  `,
};

/** Cheap cloud material for the presets below `max`: one flat textured deck,
 *  coloured by the same lit/shade pair so dusk still reaches it. */
const FLAT_CLOUD_FRAG = /* glsl */`
  uniform sampler2D uMap;
  uniform vec2 uOffset;
  uniform float uRepeat;
  uniform float uPlane;
  uniform float uOpacity;
  uniform vec3 uLit;
  uniform vec3 uHaze;
  uniform float uHDR;
  varying vec2 vUv;
  varying vec3 vWorld;
  vec3 vxKneeC(vec3 c) {
    vec3 over = max(c - 0.78, 0.0);
    return c - over + (1.0 - exp(-over / 0.22)) * 0.22;
  }
  void main() {
    float a = texture2D(uMap, vUv * uRepeat + uOffset).a;
    if (a < 0.5) discard;
    float dist = length(vWorld.xz - cameraPosition.xz);
    float alpha = uOpacity * (1.0 - smoothstep(uPlane * 0.22, uPlane * 0.46, dist));
    if (alpha <= 0.002) discard;
    vec3 col = mix(uLit, uHaze, smoothstep(uPlane * 0.08, uPlane * 0.4, dist) * 0.7);
    if (uHDR < 0.5) col = vxKneeC(col);
    gl_FragColor = vec4(col, alpha);
    #include <colorspace_fragment>
  }
`;

function makeCloudMaterial(
  map: THREE.Texture, repeat: number, opacity: number, thickness: number, volumetric: boolean
): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uMap: { value: map },
      uOffset: { value: new THREE.Vector2() },
      uRepeat: { value: repeat },
      uPlane: { value: CLOUD_PLANE },
      uOpacity: { value: opacity },
      uThickness: { value: thickness },
      uLit: { value: new THREE.Color(1, 1, 1) },
      uShade: { value: new THREE.Color(0.6, 0.65, 0.75) },
      uHaze: { value: new THREE.Color(0.8, 0.85, 0.9) },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uSunColor: { value: new THREE.Color(1, 1, 1) },
      uHDR: { value: 0 },
    },
    vertexShader: CLOUD_SHADER.vertexShader,
    fragmentShader: volumetric ? CLOUD_SHADER.fragmentShader : FLAT_CLOUD_FRAG,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: false,
  });
}

// Scratch for the per-frame CPU atmosphere work (no allocation in update()).
const _d = new THREE.Vector3();
const _c = new THREE.Color();
const _c2 = new THREE.Color();
const _moonDir = new THREE.Vector3();

export class Sky {
  /** Time in days; fractional part is the time of day (0 = sunrise). */
  time = 0.04; // start shortly after sunrise
  /** Current sunlight factor (drives mobs, audio and legacy consumers). */
  sunIntensity = 1;
  /** Unit vector from the world toward the sun. */
  readonly sunDir = new THREE.Vector3(0, 1, 0);
  /** Height of the sun on its arc, -1..1. */
  sunHeight = 1;
  /** Horizon/fog colour, measured off the atmosphere each frame. Linear. */
  readonly skyColor = new THREE.Color();
  /** The extra glow the horizon picks up TOWARD the sun (fog in-scatter). */
  readonly fogSunColor = new THREE.Color();
  /** Zenith colour — what an upward-facing mirror (calm water) sees. */
  readonly zenithColor = new THREE.Color();
  /** Night-only aurora strength. Also drives its subtle light on terrain. */
  auroraIntensity = 0;
  /** How night it is, 0..1. */
  nightAmount = 0;
  /** Unit vector toward the body actually lighting the ground: the sun while
   *  it is up, the MOON once it is not. The shadow pass casts down it. */
  readonly lightDir = new THREE.Vector3(0, 1, 0);
  /** Height of whichever body `lightDir` points at, 0..1. */
  lightHeight = 1;
  /** True while `lightDir` is the moon rather than the sun. */
  moonlit = false;
  /** Direct radiance of the casting body at the ground (sun or moon), after
   *  the air it crossed. The terrain multiplies lit faces by this. */
  readonly sunTint = new THREE.Color(1, 1, 1);
  /** Ambient irradiance from the whole dome onto an upward-facing surface. */
  readonly ambientTint = new THREE.Color(1, 1, 1);

  private visualTime = this.time;
  private hdr = false;

  private readonly dome: THREE.Mesh;
  private readonly domeMat: THREE.ShaderMaterial;
  private readonly clouds: THREE.Mesh;
  private readonly cloudTexture: THREE.CanvasTexture;
  private readonly highClouds: THREE.Mesh;
  private readonly highCloudTexture: THREE.CanvasTexture;
  private readonly cloudFlatMat: THREE.ShaderMaterial;
  private readonly highCloudFlatMat: THREE.ShaderMaterial;
  private readonly cloudShaderMat: THREE.ShaderMaterial;
  private readonly highCloudShaderMat: THREE.ShaderMaterial;
  private readonly auroraPhase: number;
  private auroraTime = 0;
  private starTime = 0;
  private readonly starAxis = new THREE.Vector3(0.18, 0, -1).normalize();
  private readonly _m4 = new THREE.Matrix4();
  private readonly cloudSun = new THREE.Color();

  constructor(scene: THREE.Scene, seed: number) {
    this.auroraPhase = ((seed >>> 0) % 10000) / 10000 * Math.PI * 2;
    this.domeMat = new THREE.ShaderMaterial({
      uniforms: {
        uSunDir: { value: new THREE.Vector3(1, 0, 0) },
        uMoonDir: { value: new THREE.Vector3(-1, 0, 0) },
        uSunE: { value: SUN_E },
        uMoonE: { value: MOON_E },
        uNightBase: { value: new THREE.Vector3(...NIGHT_BASE) },
        uNight: { value: 0 },
        uHDR: { value: 0 },
        uTime: { value: 0 },
        uStarRot: { value: new THREE.Matrix3() },
        uAurora: { value: 0 },
        uAuroraTime: { value: 0 },
        uAuroraPhase: { value: this.auroraPhase },
      },
      vertexShader: DOME_VERT,
      fragmentShader: DOME_FRAG,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    });
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(980, 48, 28), this.domeMat);
    this.dome.frustumCulled = false;
    this.dome.renderOrder = -100;
    scene.add(this.dome);

    this.cloudTexture = this.makeCloudTexture(seed);
    this.highCloudTexture = this.makeCloudTexture(seed ^ 0x77ab, 0.72);
    this.cloudFlatMat = makeCloudMaterial(this.cloudTexture, CLOUD_REPEAT, 0.86, 0, false);
    this.highCloudFlatMat = makeCloudMaterial(this.highCloudTexture, HIGH_CLOUD_REPEAT, 0.42, 0, false);
    this.cloudShaderMat = makeCloudMaterial(this.cloudTexture, CLOUD_REPEAT, 0.92, 44, true);
    this.highCloudShaderMat = makeCloudMaterial(this.highCloudTexture, HIGH_CLOUD_REPEAT, 0.5, 30, true);

    this.clouds = new THREE.Mesh(new THREE.PlaneGeometry(CLOUD_PLANE, CLOUD_PLANE), this.cloudFlatMat);
    this.clouds.rotation.x = -Math.PI / 2;
    this.clouds.position.y = CLOUD_Y;
    this.clouds.renderOrder = -1;
    this.clouds.frustumCulled = false;
    scene.add(this.clouds);

    this.highClouds = new THREE.Mesh(
      new THREE.PlaneGeometry(CLOUD_PLANE, CLOUD_PLANE), this.highCloudFlatMat);
    this.highClouds.rotation.x = -Math.PI / 2;
    this.highClouds.position.y = HIGH_CLOUD_Y;
    this.highClouds.renderOrder = -2;
    this.highClouds.frustumCulled = false;
    scene.add(this.highClouds);

    // A fixed random tilt for the celestial pole, per world seed.
    const rng = mulberry32(seed ^ 0x57a5);
    this.starTime = rng() * 100;
  }

  /** Switch between the HDR shader stack (`max`: volumetric clouds, full-range
   *  sun, tone-mapped later by PostFX) and the plain presets (display-knee'd
   *  here, because nothing downstream will tone-map). */
  setShaders(on: boolean): void {
    this.hdr = on;
    this.clouds.material = on ? this.cloudShaderMat : this.cloudFlatMat;
    this.highClouds.material = on ? this.highCloudShaderMat : this.highCloudFlatMat;
    this.domeMat.uniforms.uHDR.value = on ? 1 : 0;
    for (const m of [this.cloudFlatMat, this.highCloudFlatMat,
      this.cloudShaderMat, this.highCloudShaderMat]) m.uniforms.uHDR.value = on ? 1 : 0;
  }

  private makeCloudTexture(seed: number, cover = 0.62): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = CLOUD_TEX;
    canvas.height = CLOUD_TEX;
    const ctx = canvas.getContext('2d')!;
    const img = ctx.createImageData(CLOUD_TEX, CLOUD_TEX);
    const period = 16;
    for (let y = 0; y < CLOUD_TEX; y++) {
      for (let x = 0; x < CLOUD_TEX; x++) {
        const n =
          wrappedValueNoise(seed, x * 0.25, y * 0.25, period) * 0.7 +
          wrappedValueNoise(seed ^ 99, x * 0.5, y * 0.5, period * 2) * 0.3;
        const i = (y * CLOUD_TEX + x) * 4;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
        img.data[i + 3] = n > cover ? 255 : 0;
      }
    }
    ctx.putImageData(img, 0, 0);
    const tex = new THREE.CanvasTexture(canvas);
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    return tex;
  }

  /** Sky radiance along a direction, from both bodies plus the night floor. */
  private radiance(d: THREE.Vector3, out: THREE.Color): THREE.Color {
    out.setRGB(NIGHT_BASE[0], NIGHT_BASE[1], NIGHT_BASE[2]);
    scatterInto(d, this.sunDir, SUN_E, out);
    scatterInto(d, _moonDir, MOON_E, out);
    return out;
  }

  update(
    dt: number,
    camera: THREE.Camera,
    forcedTimeOfDay?: number,
    advanceClock = true,
  ): void {
    if (advanceClock) this.time += dt / DAY_LENGTH;
    const target = forcedTimeOfDay === undefined ? this.time : forcedTimeOfDay;
    // Follow the shortest route around the circular clock. Capping the visual
    // delta prevents a long background-tab frame from defeating the fade.
    const wrappedTarget = ((target % 1) + 1) % 1;
    const wrappedVisual = ((this.visualTime % 1) + 1) % 1;
    const difference = ((wrappedTarget - wrappedVisual + 1.5) % 1) - 0.5;
    const blend = 1 - Math.exp(-Math.min(Math.max(dt, 0), 0.1) / 2);
    this.visualTime = wrappedVisual + difference * blend;
    const tod = ((this.visualTime % 1) + 1) % 1;
    const angle = tod * Math.PI * 2;
    const sunHeight = Math.sin(angle);
    this.sunHeight = sunHeight;
    this.sunIntensity = daylight(tod);

    const s = (this.sunIntensity - NIGHT_FLOOR) / (1 - NIGHT_FLOOR);
    const night = 1 - THREE.MathUtils.smoothstep(s, 0.08, 0.46);
    const step = Math.min(Math.max(dt, 0), 0.1);
    this.auroraTime += step;
    this.starTime += step;
    const activity = 0.78 + 0.22 * Math.sin(this.auroraTime * 0.075 + this.auroraPhase);
    this.auroraIntensity = night * activity;
    this.nightAmount = night;

    // Sun rises in +x and sets in -x; the moon rides the opposite end.
    this.sunDir.set(Math.cos(angle), sunHeight, 0.18).normalize();
    _moonDir.copy(this.sunDir).negate();

    // The casting body. The handover happens at the horizon, where both are
    // at height 0 and every consumer of lightHeight has already faded out.
    this.moonlit = sunHeight < 0;
    this.lightDir.copy(this.moonlit ? _moonDir : this.sunDir);
    this.lightHeight = Math.abs(sunHeight);

    // ── Measure the sky ───────────────────────────────────────────────────
    // Direct light at the ground: the body's own transmittance.
    const sunUp = smooth(-0.04, 0.06, this.sunDir.y);
    const moonUp = smooth(-0.04, 0.06, _moonDir.y);
    transmit(this.sunDir.y, _c).multiplyScalar(SUN_DIRECT * sunUp);
    transmit(_moonDir.y, _c2).multiplyScalar(MOON_DIRECT * moonUp);
    _c2.r *= 0.78; _c2.g *= 0.9; _c2.b *= 1.12;
    this.sunTint.copy(this.moonlit ? _c2 : _c);

    // Ambient: the dome's irradiance onto an up-facing surface, approximated
    // by a cosine-weighted handful of directions.
    const amb = this.ambientTint.setRGB(0, 0, 0);
    let wsum = 0;
    const addDir = (x: number, y: number, z: number, w: number): void => {
      _d.set(x, y, z).normalize();
      this.radiance(_d, _c);
      amb.r += _c.r * w; amb.g += _c.g * w; amb.b += _c.b * w;
      wsum += w;
    };
    addDir(0, 1, 0, 1.0);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      addDir(Math.cos(a), 0.9, Math.sin(a), 0.8);
      addDir(Math.cos(a + 0.5), 0.2, Math.sin(a + 0.5), 0.35);
    }
    amb.multiplyScalar(AMBIENT_SCALE / wsum);
    // Sky light bounces off everything on its way down, and the ground sends
    // some back up: the fill that actually reaches a surface is noticeably
    // less blue than the dome itself. Without this, shade reads as cyan.
    const ambLum = amb.r * 0.2126 + amb.g * 0.7152 + amb.b * 0.0722;
    amb.lerp(_c.setRGB(ambLum, ambLum, ambLum), 0.4);

    // Horizon (fog) colour: averaged round the skyline, plus the extra glow
    // looking TOWARD the sun, which the terrain fog adds back by direction.
    const hz = this.skyColor.setRGB(0, 0, 0);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      _d.set(Math.cos(a), 0.035, Math.sin(a)).normalize();
      this.radiance(_d, _c);
      hz.r += _c.r / 8; hz.g += _c.g / 8; hz.b += _c.b / 8;
    }
    _d.set(this.sunDir.x, 0.035, this.sunDir.z).normalize();
    this.radiance(_d, _c);
    this.fogSunColor.setRGB(
      Math.max(0, _c.r - hz.r), Math.max(0, _c.g - hz.g), Math.max(0, _c.b - hz.b));
    _d.set(0, 1, 0);
    this.radiance(_d, this.zenithColor);
    if (!this.hdr) {
      // No tone mapper downstream: the fog has to land on the same displayed
      // colour the dome's knee gives the skyline.
      displayKnee(this.skyColor);
      displayKnee(this.zenithColor);
      this.fogSunColor.multiplyScalar(0.6);
    }

    // ── Feed the dome ─────────────────────────────────────────────────────
    const u = this.domeMat.uniforms;
    (u.uSunDir.value as THREE.Vector3).copy(this.sunDir);
    (u.uMoonDir.value as THREE.Vector3).copy(_moonDir);
    u.uNight.value = night;
    u.uTime.value = this.starTime;
    u.uAurora.value = this.auroraIntensity;
    u.uAuroraTime.value = this.auroraTime;
    // The stars turn with the sun, about the same tilted axis.
    this._m4.makeRotationAxis(this.starAxis, angle);
    (u.uStarRot.value as THREE.Matrix3).setFromMatrix4(this._m4);
    this.dome.position.copy(camera.position);

    // ── Clouds ────────────────────────────────────────────────────────────
    // Lit side: the direct light plus a share of the sky; shade side: sky only.
    // By night a cloud is a dark shape against the stars, faintly silvered
    // on its moonward side — never a white sheet.
    const cloudLit = _c.copy(this.sunTint).multiplyScalar(this.moonlit ? 0.5 : 1.15)
      .add(_c2.copy(this.ambientTint).multiplyScalar(this.moonlit ? 0.45 : 1.35));
    const cloudShade = _c2.copy(this.ambientTint).multiplyScalar(this.moonlit ? 0.3 : 1.1);
    const sunColor = transmit(this.sunDir.y, this.cloudSun).multiplyScalar(0.9 * sunUp);
    for (const m of [this.cloudFlatMat, this.highCloudFlatMat,
      this.cloudShaderMat, this.highCloudShaderMat]) {
      (m.uniforms.uLit.value as THREE.Color).copy(cloudLit);
      (m.uniforms.uShade.value as THREE.Color).copy(cloudShade);
      (m.uniforms.uHaze.value as THREE.Color).copy(this.skyColor);
      (m.uniforms.uSunDir.value as THREE.Vector3).copy(this.lightDir);
      (m.uniforms.uSunColor.value as THREE.Color).copy(sunColor);
    }

    // Clouds follow the camera; the texture offset keeps the pattern anchored
    // to the world plus the slow vanilla drift.
    const prevX = this.clouds.position.x;
    const prevZ = this.clouds.position.z;
    this.clouds.position.x = camera.position.x;
    this.clouds.position.z = camera.position.z;
    const uPerUnit = CLOUD_REPEAT / CLOUD_PLANE;
    const drift = dt * 0.8;
    const o = this.cloudTexture.offset;
    o.x = (o.x + (camera.position.x - prevX + drift) * uPerUnit) % 1;
    o.y = (o.y - (camera.position.z - prevZ) * uPerUnit) % 1;
    this.highClouds.position.x = camera.position.x;
    this.highClouds.position.z = camera.position.z;
    const hPerUnit = HIGH_CLOUD_REPEAT / CLOUD_PLANE;
    const ho = this.highCloudTexture.offset;
    ho.x = (ho.x + (camera.position.x - prevX + dt * 1.9) * hPerUnit) % 1;
    ho.y = (ho.y - (camera.position.z - prevZ - dt * 0.7) * hPerUnit) % 1;
    (this.cloudFlatMat.uniforms.uOffset.value as THREE.Vector2).copy(o);
    (this.cloudShaderMat.uniforms.uOffset.value as THREE.Vector2).copy(o);
    (this.highCloudFlatMat.uniforms.uOffset.value as THREE.Vector2).copy(ho);
    (this.highCloudShaderMat.uniforms.uOffset.value as THREE.Vector2).copy(ho);
  }
}
