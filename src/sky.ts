// Sky: 20-minute day/night cycle. Sun and moon arc overhead, stars fade in
// at night, sky/fog colors follow a day-night gradient with sunset tinting,
// and the blocky cloud layer drifts at y=192.

import * as THREE from 'three';
import { mulberry32, wrappedValueNoise } from './noise';

export const DAY_LENGTH = 1200; // seconds: vanilla 20-minute day
export const WATER_FOG_COLOR = new THREE.Color(0x16335f);

const DAY_SKY = new THREE.Color(0x78a7ff);
const NIGHT_SKY = new THREE.Color(0x06080f);
const SUNSET = new THREE.Color(0xe8853c);

const CLOUD_Y = 192;
const CLOUD_TEX = 64;     // texels per repeat
const CLOUD_PLANE = 4096; // world units
const CLOUD_REPEAT = 4;   // -> one cloud cell = 16 blocks, like vanilla

/**
 * Sunlight factor for a time of day in [0,1) (0 = sunrise, 0.25 = noon,
 * 0.5 = sunset, 0.75 = midnight). Clamped to 0.22 so moonlit nights keep
 * vanilla's faint skylight. Pure, for tests.
 */
export function daylight(tod: number): number {
  const sunHeight = Math.sin(tod * Math.PI * 2);
  const t = Math.min(1, Math.max(0, (sunHeight + 0.08) / 0.3));
  const s = t * t * (3 - 2 * t);
  return 0.22 + 0.78 * s;
}

export class Sky {
  /** Time in days; fractional part is the time of day (0 = sunrise). */
  time = 0.04; // start shortly after sunrise
  /** Current sunlight factor (drives the chunk shader uniform). */
  sunIntensity = 1;
  /** Current sky/fog color, updated each frame. */
  readonly skyColor = new THREE.Color();

  private readonly sun: THREE.Mesh;
  private readonly moon: THREE.Mesh;
  private readonly stars: THREE.Points;
  private readonly starsMat: THREE.PointsMaterial;
  private readonly clouds: THREE.Mesh;
  private readonly cloudsMat: THREE.MeshBasicMaterial;
  private readonly cloudTexture: THREE.CanvasTexture;

  constructor(scene: THREE.Scene, seed: number) {
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

  update(dt: number, camera: THREE.Camera): void {
    this.time += dt / DAY_LENGTH;
    const tod = this.time % 1;
    const angle = tod * Math.PI * 2;
    const sunHeight = Math.sin(angle);
    this.sunIntensity = daylight(tod);

    // Sky/fog color: night <-> day, blended toward orange near the horizon
    // crossings (sunrise/sunset).
    const s = (this.sunIntensity - 0.22) / 0.78;
    this.skyColor.copy(NIGHT_SKY).lerp(DAY_SKY, s);
    const sunsetAmount =
      Math.max(0, 1 - Math.abs(sunHeight) / 0.22) * (sunHeight > -0.15 ? 1 : 0);
    this.skyColor.lerp(SUNSET, sunsetAmount * 0.45);

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
