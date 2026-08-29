// Sky: 20-minute day/night cycle. Sun and moon arc overhead, stars fade in
// at night, sky/fog colors follow a day-night gradient with sunset tinting,
// and the blocky cloud layer drifts at y=192.
//
// The night aurora lives IN the sky dome's own shader. It used to be three
// translucent curtain planes parked to the geographic north, which meant it
// existed on one bearing and simply was not there on the others; evaluating it
// per fragment from the view direction instead gives one continuous display
// that wraps the whole dome and reads the same whichever way you turn.

import * as THREE from 'three';
import { mulberry32, wrappedValueNoise } from './noise';

export const DAY_LENGTH = 1200; // seconds: vanilla 20-minute day
export const WATER_FOG_COLOR = new THREE.Color(0x16335f);

const DAY_HORIZON = new THREE.Color(0xa9d7ff);
const DAY_ZENITH = new THREE.Color(0x397de0);
const NIGHT_HORIZON = new THREE.Color(0x172440);
const NIGHT_ZENITH = new THREE.Color(0x03050d);
const SUNSET = new THREE.Color(0xe8853c);
const AURORA_HORIZON = new THREE.Color(0x164b55);

const CLOUD_Y = 192;
const CLOUD_TEX = 64;     // texels per repeat
const CLOUD_PLANE = 4096; // world units
const CLOUD_REPEAT = 4;   // -> one cloud cell = 16 blocks, like vanilla

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

export class Sky {
  /** Time in days; fractional part is the time of day (0 = sunrise). */
  time = 0.04; // start shortly after sunrise
  /** Current sunlight factor (drives the chunk shader uniform). */
  sunIntensity = 1;
  /** Current sky/fog color, updated each frame. */
  readonly skyColor = new THREE.Color();
  /** Night-only aurora strength. Also drives its subtle light on terrain. */
  auroraIntensity = 0;

  /** Time actually presented by the renderer. It follows the authoritative
   * clock gradually so server corrections and fixed-time arenas never pop the
   * whole atmosphere from one lighting state to another. */
  private visualTime = this.time;

  private readonly sun: THREE.Mesh;
  private readonly moon: THREE.Mesh;
  private readonly dome: THREE.Mesh;
  private readonly domeMat: THREE.ShaderMaterial;
  private readonly stars: THREE.Points;
  private readonly starsMat: THREE.PointsMaterial;
  private readonly clouds: THREE.Mesh;
  private readonly cloudsMat: THREE.MeshBasicMaterial;
  private readonly cloudTexture: THREE.CanvasTexture;
  private readonly auroraPhase: number;
  private auroraTime = 0;

  constructor(scene: THREE.Scene, seed: number) {
    this.auroraPhase = ((seed >>> 0) % 10000) / 10000 * Math.PI * 2;
    // A real horizon-to-zenith gradient gives the landscape depth. The old sky
    // was one flat clear color, which made even varied terrain feel like a
    // diorama against painted cardboard.
    this.domeMat = new THREE.ShaderMaterial({
      uniforms: {
        uHorizon: { value: DAY_HORIZON.clone() },
        uZenith: { value: DAY_ZENITH.clone() },
        uAurora: { value: 0 },
        uAuroraTime: { value: 0 },
        uAuroraPhase: { value: this.auroraPhase },
      },
      vertexShader: `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      // The aurora is part of the SKY, not a prop hung in front of one bearing:
      // it is evaluated per fragment from the view direction, so the curtains
      // wrap the entire dome and read the same whichever way you turn.
      fragmentShader: `
        uniform vec3 uHorizon;
        uniform vec3 uZenith;
        uniform float uAurora;
        uniform float uAuroraTime;
        uniform float uAuroraPhase;
        varying vec3 vDir;

        float hash(vec2 p) {
          return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
        }
        float vnoise(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
                     mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
        }
        /** Sampled on the unit circle of the bearing, so it is seamless the
         *  whole way around the horizon — no join to hunt for. Two octaves:
         *  this runs for every sky pixel on the screen, so the fine detail is
         *  bought from the cheap sine terms below instead of from more taps. */
        float fbm2(vec2 p) {
          return vnoise(p) * 0.65 + vnoise(p * 2.07 + 19.3) * 0.35;
        }

        /** One curtain: a band of light draped around the sky at elevation
         *  centre, its lower hem crisp and its crown feathering out. */
        vec3 curtain(vec2 bearing, float azim, float elev, float centre,
                     float width, float speed, float phase, float rayCount) {
          // Undulate the hem. Two scales: slow wide sweeps plus a finer waver,
          // which is what stops it reading as a ring painted on a ball.
          float drift = uAuroraTime * speed;
          float sweep = fbm2(bearing * 1.6 + vec2(drift, phase)) - 0.5;
          float waver = vnoise(bearing * 5.1 - vec2(drift * 1.7, phase)) - 0.5;
          float hem = centre + sweep * 0.34 + waver * 0.12;

          // Asymmetric falloff: a bright, defined bottom edge and a long soft
          // crown — the shape that makes an aurora read as hanging cloth.
          float above = elev - hem;
          float body = smoothstep(-0.035, 0.045, above) *
            (1.0 - smoothstep(0.0, width, above));
          if (body <= 0.0) return vec3(0.0);

          // Vertical rays. Their phase is the BEARING ANGLE, so they stay
          // parallel to the zenith the way real field lines do instead of
          // smearing along the band. rayCount is a whole number of cycles per
          // turn, which is what makes the +/-PI seam of atan() invisible.
          float ray = vnoise(bearing * 23.0 + vec2(phase, drift * 0.6));
          float rays = 0.5 + 0.5 * sin(rayCount * azim + ray * 21.0 + phase);
          rays = rays * rays; rays = rays * rays;
          float shimmer = 0.72 + 0.28 * sin(uAuroraTime * 0.9 + ray * 12.0 + phase);

          // Only a stretch of sky is lit at a time, and which stretch drifts,
          // so the curtains gather and part instead of ringing the horizon.
          float presence = smoothstep(0.26, 0.74,
            fbm2(bearing * 0.9 + vec2(drift * 0.45, phase * 0.5)));

          float h = clamp(above / width, 0.0, 1.0);
          vec3 green = vec3(0.20, 1.00, 0.55);
          vec3 cyan = vec3(0.20, 0.78, 1.00);
          vec3 violet = vec3(0.62, 0.34, 1.00);
          vec3 tint = mix(green, cyan, smoothstep(0.10, 0.62, h));
          tint = mix(tint, violet, smoothstep(0.55, 1.0, h));

          return tint * body * shimmer * presence * (0.30 + rays * 0.85);
        }

        void main() {
          float blend = smoothstep(-0.12, 0.86, vDir.y);
          blend = pow(blend, 0.72);
          vec3 color = mix(uHorizon, uZenith, blend);

          // Sky only, and only once night has actually taken hold. Everything
          // below the skyline skips the whole thing.
          if (uAurora > 0.004 && vDir.y > -0.05) {
            // atan() of the bearing would seam at +/-PI; the bearing vector
            // itself never does, so every lookup uses it directly.
            vec2 ground = vec2(vDir.x, vDir.z);
            vec2 bearing = ground / max(length(ground), 1e-4);
            float azim = atan(bearing.y, bearing.x);
            float elev = vDir.y;
            float ph = uAuroraPhase;

            vec3 light =
              curtain(bearing, azim, elev, 0.16, 0.62, 0.055, ph, 47.0) +
              curtain(bearing, azim, elev, 0.34, 0.50, 0.041, ph + 2.31, 61.0) * 0.70 +
              curtain(bearing, azim, elev, 0.05, 0.78, 0.070, ph + 4.77, 31.0) * 0.52;

            // Where curtains overlap the sum runs well past 1 and would clip
            // to a flat white core. A soft knee keeps the hue all the way up.
            light = light / (1.0 + light * 0.55);

            // A faint wash under the curtains so the whole dome takes the cast
            // rather than only the ribbons themselves.
            float sky = smoothstep(-0.04, 0.16, elev);
            color += light * uAurora * 1.35 * sky;
            color += vec3(0.04, 0.12, 0.12) * uAurora * sky;
          }

          gl_FragColor = vec4(color, 1.0);
        }
      `,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    });
    this.dome = new THREE.Mesh(
      new THREE.SphereGeometry(980, 32, 18), this.domeMat
    );
    this.dome.frustumCulled = false;
    this.dome.renderOrder = -100;
    scene.add(this.dome);

    this.sun = new THREE.Mesh(
      new THREE.PlaneGeometry(64, 64),
      new THREE.MeshBasicMaterial({ color: 0xfffee8, fog: false })
    );
    scene.add(this.sun);

    this.moon = new THREE.Mesh(
      new THREE.PlaneGeometry(44, 44),
      new THREE.MeshBasicMaterial({ color: 0xdde0ea, fog: false })
    );
    scene.add(this.moon);

    // Stars: random points on a far sphere, fading in at night.
    const rng = mulberry32(seed ^ 0x57a5);
    const starPositions: number[] = [];
    for (let i = 0; i < 450; i++) {
      const u = rng() * 2 - 1;
      const phi = rng() * Math.PI * 2;
      const r = Math.sqrt(1 - u * u);
      starPositions.push(
        Math.cos(phi) * r * 900, Math.abs(u) * 900 + 60, Math.sin(phi) * r * 900
      );
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute(
      'position', new THREE.Float32BufferAttribute(starPositions, 3)
    );
    this.starsMat = new THREE.PointsMaterial({
      color: 0xffffff, size: 2, sizeAttenuation: false,
      transparent: true, opacity: 0, fog: false, depthWrite: false,
    });
    this.stars = new THREE.Points(starGeo, this.starsMat);
    scene.add(this.stars);

    this.cloudTexture = this.makeCloudTexture(seed);
    this.cloudsMat = new THREE.MeshBasicMaterial({
      map: this.cloudTexture,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: false,
    });
    this.clouds = new THREE.Mesh(
      new THREE.PlaneGeometry(CLOUD_PLANE, CLOUD_PLANE), this.cloudsMat
    );
    this.clouds.rotation.x = -Math.PI / 2;
    this.clouds.position.y = CLOUD_Y;
    this.clouds.renderOrder = -1;
    scene.add(this.clouds);
  }

  private makeCloudTexture(seed: number): THREE.CanvasTexture {
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
        img.data[i + 3] = n > 0.62 ? 255 : 0;
      }
    }
    ctx.putImageData(img, 0, 0);
    const tex = new THREE.CanvasTexture(canvas);
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(CLOUD_REPEAT, CLOUD_REPEAT);
    return tex;
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
    this.sunIntensity = daylight(tod);

    // Sky/fog color: night <-> day, blended toward orange near the horizon
    // crossings (sunrise/sunset). `s` normalizes daylight back to 0..1 so the
    // sky/stars still go fully dark at night even though the block-light floor
    // (NIGHT_FLOOR) is raised for playability.
    const s = (this.sunIntensity - NIGHT_FLOOR) / (1 - NIGHT_FLOOR);
    const night = 1 - THREE.MathUtils.smoothstep(s, 0.08, 0.46);
    // A slow activity swell keeps the display alive without making it blink.
    // The floor ensures every properly dark night still gets a visible aurora.
    this.auroraTime += Math.min(Math.max(dt, 0), 0.1);
    const activity = 0.78 + 0.22 *
      Math.sin(this.auroraTime * 0.075 + this.auroraPhase);
    this.auroraIntensity = night * activity;
    const horizon = NIGHT_HORIZON.clone().lerp(DAY_HORIZON, s);
    const zenith = NIGHT_ZENITH.clone().lerp(DAY_ZENITH, s);
    const sunsetAmount =
      Math.max(0, 1 - Math.abs(sunHeight) / 0.22) * (sunHeight > -0.15 ? 1 : 0);
    horizon.lerp(SUNSET, sunsetAmount * 0.62);
    zenith.lerp(SUNSET, sunsetAmount * 0.12);
    horizon.lerp(AURORA_HORIZON, this.auroraIntensity * 0.18);
    this.skyColor.copy(horizon);
    (this.domeMat.uniforms.uHorizon.value as THREE.Color).copy(horizon);
    (this.domeMat.uniforms.uZenith.value as THREE.Color).copy(zenith);
    this.domeMat.uniforms.uAurora.value = this.auroraIntensity;
    this.domeMat.uniforms.uAuroraTime.value = this.auroraTime;
    this.dome.position.copy(camera.position);

    // Sun rises in the +x, sets in the -x; moon is opposite.
    const sunDir = new THREE.Vector3(Math.cos(angle), sunHeight, 0.18).normalize();
    this.sun.position.copy(camera.position).addScaledVector(sunDir, 700);
    this.sun.lookAt(camera.position);
    this.moon.position.copy(camera.position).addScaledVector(sunDir, -700);
    this.moon.lookAt(camera.position);

    this.starsMat.opacity = Math.max(0, 1 - s * 1.6) * 0.9;
    this.stars.position.copy(camera.position);

    // Clouds: follow the camera, texture offset keeps the pattern anchored
    // to the world plus the slow vanilla drift; dim at night.
    const prevX = this.clouds.position.x;
    const prevZ = this.clouds.position.z;
    this.clouds.position.x = camera.position.x;
    this.clouds.position.z = camera.position.z;
    const uPerUnit = CLOUD_REPEAT / CLOUD_PLANE;
    const drift = dt * 0.8;
    this.cloudTexture.offset.x =
      (this.cloudTexture.offset.x +
        (camera.position.x - prevX + drift) * uPerUnit) % 1;
    this.cloudTexture.offset.y =
      (this.cloudTexture.offset.y - (camera.position.z - prevZ) * uPerUnit) % 1;
    this.cloudsMat.color.setScalar(0.35 + 0.65 * s);
  }
}
