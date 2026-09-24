import * as THREE from 'three';

export interface VaultBeaconSite {
  cx: number;
  cz: number;
  x: number;
  z: number;
}

/** The vault beam rises from bedrock (y = 0) to well above the tallest peaks. */
const TOP = 300;
const RANGE = 520;
const FADE_START = 420;
const VAULT_COLOR = 0xb996ff;
const VAULT_STRENGTH = 0.32;

const BEAM_VERTEX = `
  varying float vEdge;
  varying float vH;
  varying vec3 vWorld;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vec3 n = normalize(mat3(modelMatrix) * normal);
    vec3 toEye = normalize(cameraPosition - world.xyz);
    // 1 where the side faces the eye (beam centre), 0 at the silhouette.
    // (No normalize(): toEye.xz is zero when looking straight down the beam.)
    vec2 a = n.xz, b = toEye.xz;
    vEdge = abs(dot(a, b)) * inversesqrt(max(dot(a, a) * dot(b, b), 1e-12));
    vH = uv.y;
    vWorld = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const BEAM_FRAGMENT = `
  uniform vec3 uColor;
  uniform float uStrength;
  uniform float uTime;
  uniform float uFloor;
  varying float vEdge;
  varying float vH;
  varying vec3 vWorld;
  void main() {
    // Soft round falloff: a thin bright core inside a faint halo.
    float core = pow(vEdge, 18.0);
    float halo = pow(vEdge, 3.0) * 0.35;
    // Fade out into the sky, and fade in just above the floor.
    float top = 1.0 - smoothstep(0.35, 1.0, vH);
    float bottom = smoothstep(uFloor, uFloor + 6.0, vWorld.y);
    // Slow drifting shimmer so the beam reads as light, not a solid pole.
    float shimmer = 0.82 + 0.18 * sin(vWorld.y * 0.18 - uTime * 2.2);
    float a = (core + halo) * top * bottom * shimmer * uStrength;
    vec3 col = mix(uColor, vec3(1.0), core * 0.45);
    gl_FragColor = vec4(col * a, a);
  }
`;

/** A slim additive light beam. Shared by vault beacons and waypoint markers so
 *  every in-world marker reads the same way. `height` is in blocks, starting at
 *  the mesh's origin. */
export function createBeam(color: number, height: number, radius: number, strength: number,
  floor = -1000): { mesh: THREE.Mesh; material: THREE.ShaderMaterial } {
  const geometry = new THREE.CylinderGeometry(radius, radius, height, 16, 1, true);
  geometry.translate(0, height / 2, 0);
  const material = new THREE.ShaderMaterial({
    vertexShader: BEAM_VERTEX,
    fragmentShader: BEAM_FRAGMENT,
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uStrength: { value: strength },
      uTime: { value: 0 },
      uFloor: { value: floor },
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.FrontSide,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 5;
  return { mesh, material };
}

interface Beacon {
  mesh: THREE.Mesh;
  material: THREE.ShaderMaterial;
}

/** World-space vault lights. They do not use terrain fog, so they remain visible
 * beyond the chunks that are currently streamed or drawn. */
export class VaultBeacons {
  readonly group = new THREE.Group();
  private readonly beacons = new Map<string, Beacon>();

  constructor(scene: THREE.Scene) {
    this.group.name = 'vault-beacons';
    scene.add(this.group);
  }

  setSites(sites: readonly VaultBeaconSite[], _groundY?: (x: number, z: number) => number): void {
    const wanted = new Set(sites.map((site) => `${site.cx},${site.cz}`));
    for (const [key, beacon] of this.beacons) {
      if (wanted.has(key)) continue;
      this.group.remove(beacon.mesh);
      beacon.mesh.geometry.dispose();
      beacon.material.dispose();
      this.beacons.delete(key);
    }
    for (const site of sites) {
      const key = `${site.cx},${site.cz}`;
      if (this.beacons.has(key)) continue;
      const { mesh, material } = createBeam(VAULT_COLOR, TOP, 0.55, VAULT_STRENGTH);
      mesh.position.set(site.x + 0.5, 0, site.z + 0.5);
      this.group.add(mesh);
      this.beacons.set(key, { mesh, material });
    }
  }

  update(x: number, z: number, time: number, visible: boolean): void {
    this.group.visible = visible;
    if (!visible) return;
    for (const beacon of this.beacons.values()) {
      const dx = beacon.mesh.position.x - x;
      const dz = beacon.mesh.position.z - z;
      const distance = Math.hypot(dx, dz);
      const fade = THREE.MathUtils.clamp((RANGE - distance) / (RANGE - FADE_START), 0, 1);
      beacon.mesh.visible = fade > 0;
      // Widen with distance so the beam keeps a hairline on screen instead of
      // shimmering away to sub-pixel width; up close it stays slim.
      const widen = Math.max(1, distance / 90);
      beacon.mesh.scale.set(widen, 1, widen);
      beacon.material.uniforms.uStrength.value = VAULT_STRENGTH * fade;
      beacon.material.uniforms.uTime.value = time;
    }
  }
}
