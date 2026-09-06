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

const DAY_HORIZON = new THREE.Color(0xa8dcff);
const DAY_ZENITH = new THREE.Color(0x1f66e6);
const NIGHT_HORIZON = new THREE.Color(0x182748);
const NIGHT_ZENITH = new THREE.Color(0x03050d);
// Dawn and dusk are not the same colour. Sunrise runs cool-pink into gold;
// sunset runs gold into a deep ember red. Having two makes the day feel like
// it has a direction instead of playing the same twenty seconds backwards.
const DAWN = new THREE.Color(0xff9d7a);
const DUSK = new THREE.Color(0xf2652a);
const DAY_HAZE = new THREE.Color(0xdcefff);   // atmospheric pile-up at the skyline
const SUN_HIGH_GLOW = new THREE.Color(0xfff0cf);  // halo colour once the sun is up
const SUN_DISC = new THREE.Color(0xfffee8);
const SUN_DISC_HIGH = new THREE.Color(0xffe8bd);
const NIGHT_HAZE = new THREE.Color(0x1b2c4e);
const AURORA_HORIZON = new THREE.Color(0x164b55);

// Direct-sun and ambient-sky colours handed to the terrain shader.
const SUN_NOON = new THREE.Color(1.06, 1.03, 0.96);
const SUN_LOW = new THREE.Color(1.32, 0.84, 0.54);
const SUN_NIGHT = new THREE.Color(0.72, 0.82, 1.08);
const AMBIENT_DAY = new THREE.Color(0.84, 0.93, 1.14);
const AMBIENT_LOW = new THREE.Color(1.02, 0.86, 0.86);
const AMBIENT_NIGHT = new THREE.Color(0.66, 0.78, 1.14);

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

/** Soft radial falloff used for the sun and moon halos. */
function radialGlowTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.18, 'rgba(255,255,255,0.62)');
  g.addColorStop(0.45, 'rgba(255,255,255,0.16)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(canvas);
  tex.generateMipmaps = false;
  tex.minFilter = THREE.LinearFilter;
  return tex;
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
  /** Colour of direct sunlight right now — white at noon, deep gold at the
   *  horizon crossings, moon-blue at night. The terrain shader multiplies its
   *  sunlit pixels by this. */
  readonly sunTint = new THREE.Color(1, 1, 1);
  /** Colour of the ambient sky bounce that fills shadow. Cool blue by day,
   *  which is what stops shaded voxel faces reading as flat grey. */
  readonly ambientTint = new THREE.Color(1, 1, 1);

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
  private readonly highClouds: THREE.Mesh;
  private readonly highCloudsMat: THREE.MeshBasicMaterial;
  private readonly highCloudTexture: THREE.CanvasTexture;
  private readonly sunGlow: THREE.Mesh;
  private readonly sunGlowMat: THREE.MeshBasicMaterial;
  private readonly moonGlow: THREE.Mesh;
  private readonly moonGlowMat: THREE.MeshBasicMaterial;
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
        uHaze: { value: DAY_HAZE.clone() },
        uSunDir: { value: new THREE.Vector3(1, 0, 0) },
        uSunGlow: { value: new THREE.Color(0, 0, 0) },
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
        uniform vec3 uHaze;
        uniform vec3 uSunDir;
        uniform vec3 uSunGlow;
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
          vec3 dir = normalize(vDir);
          float blend = smoothstep(-0.12, 0.86, dir.y);
          blend = pow(blend, 0.72);
          vec3 color = mix(uHorizon, uZenith, blend);

          // Horizon haze: the air column is longest along the skyline, so the
          // band just above it washes out pale and bright. Without it the dome
          // reads as a painted gradient rather than an atmosphere.
          float haze = pow(1.0 - clamp(abs(dir.y), 0.0, 1.0), 5.0);
          color = mix(color, uHaze, haze * 0.55);

          // Forward scattering around the sun. A broad halo plus a tight core:
          // this is the single cheapest thing that makes a sunset look like
          // light arriving from a place instead of a colour ramp.
          float sd = max(dot(dir, uSunDir), 0.0);
          color += uSunGlow * (pow(sd, 5.0) * 0.5 + pow(sd, 48.0) * 1.4);

          // Sky only, and only once night has actually taken hold. Everything
          // below the skyline skips the whole thing.
          if (uAurora > 0.004 && dir.y > -0.05) {
            // atan() of the bearing would seam at +/-PI; the bearing vector
            // itself never does, so every lookup uses it directly.
            vec2 ground = vec2(dir.x, dir.z);
            vec2 bearing = ground / max(length(ground), 1e-4);
            float azim = atan(bearing.y, bearing.x);
            float elev = dir.y;
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

    // A soft additive halo behind each body. The sun used to be a flat white
    // square pasted on the sky; a bloom around it is what sells it as the
    // brightest thing in the world.
    const glowTexture = radialGlowTexture();
    this.sunGlowMat = new THREE.MeshBasicMaterial({
      map: glowTexture, color: 0xffd9a0, transparent: true, opacity: 0.75,
      blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
    });
    this.sunGlow = new THREE.Mesh(new THREE.PlaneGeometry(330, 330), this.sunGlowMat);
    this.sunGlow.renderOrder = -90;
    scene.add(this.sunGlow);

    this.sun = new THREE.Mesh(
      new THREE.PlaneGeometry(64, 64),
      new THREE.MeshBasicMaterial({ color: 0xfffee8, fog: false })
    );
    scene.add(this.sun);

    this.moonGlowMat = new THREE.MeshBasicMaterial({
      map: glowTexture, color: 0xaec4ff, transparent: true, opacity: 0.5,
      blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
    });
    this.moonGlow = new THREE.Mesh(new THREE.PlaneGeometry(180, 180), this.moonGlowMat);
    this.moonGlow.renderOrder = -90;
    scene.add(this.moonGlow);

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

    // High deck: sparser, softer, drifting faster on its own heading.
    this.highCloudTexture = this.makeCloudTexture(seed ^ 0x77ab, 0.72);
    this.highCloudTexture.repeat.set(HIGH_CLOUD_REPEAT, HIGH_CLOUD_REPEAT);
    this.highCloudsMat = new THREE.MeshBasicMaterial({
      map: this.highCloudTexture,
      transparent: true, opacity: 0.42, depthWrite: false,
      side: THREE.DoubleSide, fog: false,
    });
    this.highClouds = new THREE.Mesh(
      new THREE.PlaneGeometry(CLOUD_PLANE, CLOUD_PLANE), this.highCloudsMat
    );
    this.highClouds.rotation.x = -Math.PI / 2;
    this.highClouds.position.y = HIGH_CLOUD_Y;
    this.highClouds.renderOrder = -2;
    scene.add(this.highClouds);
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
    const haze = NIGHT_HAZE.clone().lerp(DAY_HAZE, s);
    const sunsetAmount =
      Math.max(0, 1 - Math.abs(sunHeight) / 0.28) * (sunHeight > -0.2 ? 1 : 0);
    // tod < 0.5 is the rising half of the arc, so morning gets DAWN and the
    // evening crossing gets DUSK.
    const twilight = tod < 0.5 ? DAWN : DUSK;
    horizon.lerp(twilight, sunsetAmount * 0.7);
    zenith.lerp(twilight, sunsetAmount * 0.2);
    haze.lerp(twilight, sunsetAmount * 0.62);
    horizon.lerp(AURORA_HORIZON, this.auroraIntensity * 0.18);
    this.skyColor.copy(horizon);
    (this.domeMat.uniforms.uHorizon.value as THREE.Color).copy(horizon);
    (this.domeMat.uniforms.uZenith.value as THREE.Color).copy(zenith);
    (this.domeMat.uniforms.uHaze.value as THREE.Color).copy(haze);
    this.domeMat.uniforms.uAurora.value = this.auroraIntensity;
    this.domeMat.uniforms.uAuroraTime.value = this.auroraTime;
    this.dome.position.copy(camera.position);

    // Sun rises in the +x, sets in the -x; moon is opposite.
    const sunDir = new THREE.Vector3(Math.cos(angle), sunHeight, 0.18).normalize();
    this.sun.position.copy(camera.position).addScaledVector(sunDir, 700);
    this.sun.lookAt(camera.position);
    this.moon.position.copy(camera.position).addScaledVector(sunDir, -700);
    this.moon.lookAt(camera.position);

    // Scattering halo in the dome shader, aimed at whichever body is up.
    const above = Math.max(0, sunHeight);
    (this.domeMat.uniforms.uSunDir.value as THREE.Vector3).copy(sunDir);
    (this.domeMat.uniforms.uSunGlow.value as THREE.Color)
      .copy(twilight)
      .lerp(SUN_HIGH_GLOW, THREE.MathUtils.smoothstep(above, 0.1, 0.7))
      .multiplyScalar(0.16 + 0.5 * sunsetAmount + 0.24 * above);

    // Body halos. The sun's swells and reddens as it touches the horizon.
    this.sunGlow.position.copy(this.sun.position);
    this.sunGlow.quaternion.copy(this.sun.quaternion);
    this.sunGlow.scale.setScalar(0.8 + 0.9 * sunsetAmount);
    this.sunGlowMat.color.copy(twilight).lerp(
      SUN_DISC_HIGH, THREE.MathUtils.smoothstep(above, 0.05, 0.55));
    this.sunGlowMat.opacity = 0.28 + 0.55 * Math.max(sunsetAmount, above);
    this.sunGlow.visible = sunHeight > -0.25;
    this.moonGlow.position.copy(this.moon.position);
    this.moonGlow.quaternion.copy(this.moon.quaternion);
    this.moonGlowMat.opacity = 0.55 * (1 - s);
    this.moonGlow.visible = sunHeight < 0.1;
    // The sun disc itself takes the light's own colour as it sets.
    (this.sun.material as THREE.MeshBasicMaterial).color
      .copy(SUN_DISC).lerp(twilight, sunsetAmount * 0.8);

    // Light colours handed to the terrain shader: warm direct sun, cool sky
    // fill, both swinging through gold at the horizon crossings.
    this.sunTint.copy(SUN_NIGHT).lerp(SUN_NOON, s);
    this.sunTint.lerp(SUN_LOW, sunsetAmount * 0.85);
    this.ambientTint.copy(AMBIENT_NIGHT).lerp(AMBIENT_DAY, s);
    this.ambientTint.lerp(AMBIENT_LOW, sunsetAmount * 0.7);

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
    // Clouds catch the sunset before the ground does — they are up where the
    // light still reaches. Tinting them is most of a good dusk.
    this.cloudsMat.color.setScalar(0.35 + 0.65 * s);
    this.cloudsMat.color.lerp(twilight, sunsetAmount * 0.6);

    // High deck: its own heading and a faster drift, so the two layers slide
    // past each other and the sky gains depth.
    this.highClouds.position.x = camera.position.x;
    this.highClouds.position.z = camera.position.z;
    const hPerUnit = HIGH_CLOUD_REPEAT / CLOUD_PLANE;
    this.highCloudTexture.offset.x =
      (this.highCloudTexture.offset.x +
        (camera.position.x - prevX + dt * 1.9) * hPerUnit) % 1;
    this.highCloudTexture.offset.y =
      (this.highCloudTexture.offset.y -
        (camera.position.z - prevZ - dt * 0.7) * hPerUnit) % 1;
    this.highCloudsMat.color.setScalar(0.4 + 0.6 * s);
    this.highCloudsMat.color.lerp(twilight, sunsetAmount * 0.75);
  }
}
