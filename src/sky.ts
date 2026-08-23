// Sky: 20-minute day/night cycle. Sun and moon arc overhead, stars fade in
// at night, sky/fog colors follow a day-night gradient with sunset tinting,
// and the blocky cloud layer drifts at y=192.

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
const AURORA_LAYERS = 3;

interface AuroraLayer {
  mesh: THREE.Mesh;
  material: THREE.ShaderMaterial;
}

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
  private readonly aurora: AuroraLayer[] = [];
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
      },
      vertexShader: `
        varying float vHeight;
        void main() {
          vHeight = normalize(position).y;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 uHorizon;
        uniform vec3 uZenith;
        varying float vHeight;
        void main() {
          float blend = smoothstep(-0.12, 0.86, vHeight);
          blend = pow(blend, 0.72);
          gl_FragColor = vec4(mix(uHorizon, uZenith, blend), 1.0);
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

    // Three translucent curtains sit in the geographic north. Their shape is
    // generated entirely in the shader: broad moving folds establish the
    // silhouette, while narrow vertical rays make the light feel luminous
    // rather than like a coloured cloud texture.
    const auroraGeo = new THREE.PlaneGeometry(1500, 430, 96, 20);
    for (let i = 0; i < AURORA_LAYERS; i++) {
      const material = this.makeAuroraMaterial(i);
      const mesh = new THREE.Mesh(auroraGeo, material);
      mesh.frustumCulled = false;
      mesh.renderOrder = -80 + i;
      scene.add(mesh);
      this.aurora.push({ mesh, material });
    }

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

  private makeAuroraMaterial(layer: number): THREE.ShaderMaterial {
    return new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uOpacity: { value: 0 },
        uPhase: { value: layer * 1.91 },
        uLayer: { value: layer },
      },
      vertexShader: `
        uniform float uTime;
        uniform float uPhase;
        uniform float uLayer;
        varying vec2 vUv;
        varying float vFold;
        void main() {
          vUv = uv;
          vec3 p = position;
          float broad = sin(p.x * 0.010 + uTime * 0.13 + uPhase);
          float fine = sin(p.x * 0.026 - uTime * 0.19 + uPhase * 1.7);
          vFold = broad * 0.65 + fine * 0.35;
          p.z += broad * (34.0 + uLayer * 7.0) + fine * 12.0;
          p.y += sin(p.x * 0.006 + uTime * 0.09 + uPhase) * 24.0;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
        }
      `,
      fragmentShader: `
        uniform float uTime;
        uniform float uOpacity;
        uniform float uPhase;
        uniform float uLayer;
        varying vec2 vUv;
        varying float vFold;

        float hash(vec2 p) {
          return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
        }
        float noise(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
                     mix(hash(i + vec2(0.0, 1.0)), hash(i + 1.0), f.x), f.y);
        }
        void main() {
          float t = uTime * (0.045 + uLayer * 0.006);
          // One smooth value-noise sample per curtain keeps the effect cheap
          // enough for mobile while the sine layers supply the fine detail.
          float drift = noise(vec2(vUv.x * 5.0 + uPhase, t));
          float lowerEdge = 0.10 + 0.14 * (0.5 + 0.5 *
            sin(vUv.x * 18.0 + drift * 5.0 + uPhase));
          float vertical = smoothstep(lowerEdge, lowerEdge + 0.13, vUv.y) *
            (1.0 - smoothstep(0.76, 1.0, vUv.y));
          float sideFade = smoothstep(0.0, 0.12, vUv.x) *
            (1.0 - smoothstep(0.88, 1.0, vUv.x));

          float folds = 0.5 + 0.5 * sin(vUv.x * 31.0 + drift * 8.0 +
            vUv.y * (4.0 + vFold) + uPhase);
          folds = smoothstep(0.18, 0.92, folds);
          float rays = 0.5 + 0.5 * sin(vUv.x * 210.0 + drift * 13.0 + uPhase);
          rays = pow(rays, 5.0);
          float shimmer = 0.76 + 0.24 * sin(uTime * 0.7 +
            vUv.x * 24.0 + uPhase);

          vec3 green = vec3(0.18, 1.0, 0.62);
          vec3 cyan = vec3(0.16, 0.72, 1.0);
          vec3 violet = vec3(0.58, 0.30, 1.0);
          vec3 color = mix(green, cyan, smoothstep(0.2, 0.82, vUv.y));
          color = mix(color, violet, max(0.0, vUv.y - 0.70) *
            (0.18 + 0.18 * float(uLayer)));
          color *= 1.05 + rays * 0.55;

          float alpha = uOpacity * vertical * sideFade * shimmer *
            (0.12 + folds * 0.46 + rays * 0.50);
          if (alpha < 0.004) discard;
          gl_FragColor = vec4(color, alpha);
        }
      `,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: false,
    });
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
    this.dome.position.copy(camera.position);

    // Sun rises in the +x, sets in the -x; moon is opposite.
    const sunDir = new THREE.Vector3(Math.cos(angle), sunHeight, 0.18).normalize();
    this.sun.position.copy(camera.position).addScaledVector(sunDir, 700);
    this.sun.lookAt(camera.position);
    this.moon.position.copy(camera.position).addScaledVector(sunDir, -700);
    this.moon.lookAt(camera.position);

    this.starsMat.opacity = Math.max(0, 1 - s * 1.6) * 0.9;
    this.stars.position.copy(camera.position);

    // Keep the curtains celestial (camera-relative) but geographically north.
    // Layer separation and a slight yaw fan create parallax between the folds.
    for (let i = 0; i < this.aurora.length; i++) {
      const layer = this.aurora[i];
      layer.mesh.position.set(
        camera.position.x + (i - 1) * 32,
        camera.position.y + 235 + i * 18,
        camera.position.z - 500 - i * 75,
      );
      layer.mesh.rotation.y = (i - 1) * 0.045;
      layer.material.uniforms.uTime.value = this.auroraTime;
      layer.material.uniforms.uOpacity.value =
        this.auroraIntensity * (0.46 - i * 0.075);
      layer.mesh.visible = this.auroraIntensity > 0.005;
    }

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
