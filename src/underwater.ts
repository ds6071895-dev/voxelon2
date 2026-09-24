import * as THREE from 'three';
import { Block } from './blocks';
import type { World } from './world';

/** Sparse, depth-tested suspended motes; one draw call on every preset. */
export class UnderwaterMotes {
  private readonly positions = new Float32Array(96 * 3);
  private readonly geometry = new THREE.BufferGeometry();
  private readonly material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: { uLight: { value: 1 } },
    vertexShader: `
      varying float vFade;
      void main() {
        vec4 p = modelViewMatrix * vec4(position, 1.0);
        float d = length(p.xyz);
        vFade = smoothstep(0.8, 2.5, d) * (1.0 - smoothstep(9.0, 15.0, d));
        gl_PointSize = clamp(22.0 / max(1.0, -p.z), 1.0, 3.0);
        gl_Position = projectionMatrix * p;
      }
    `,
    fragmentShader: `
      uniform float uLight;
      varying float vFade;
      void main() {
        float r = length(gl_PointCoord - 0.5) * 2.0;
        float alpha = (1.0 - smoothstep(0.15, 1.0, r)) * vFade * 0.28;
        gl_FragColor = vec4(vec3(0.63, 0.87, 0.79) * uLight, alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
  private readonly points = new THREE.Points(this.geometry, this.material);
  private time = 0;

  constructor(scene: THREE.Scene) {
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.points.frustumCulled = false;
    this.points.visible = false;
    scene.add(this.points);
  }

  update(eye: THREE.Vector3, world: World, submerged: boolean, dt: number, sunlight: number): void {
    this.points.visible = submerged;
    if (!submerged) return;
    this.time += Math.min(dt, 0.1);
    this.material.uniforms.uLight.value = 0.45 + sunlight * 0.55;
    const wrap = (v: number, centre: number) => centre + ((v - centre + 15) % 30 + 30) % 30 - 15;
    for (let i = 0; i < 96; i++) {
      const x = wrap(Math.sin(i * 127.1) * 437.5 + Math.sin(this.time * 0.18 + i) * 0.4, eye.x);
      const y = wrap(Math.sin(i * 311.7) * 289.3 + this.time * (0.045 + (i % 5) * 0.012), eye.y);
      const z = wrap(Math.sin(i * 74.7) * 183.2 + Math.cos(this.time * 0.15 + i) * 0.4, eye.z);
      const wet = world.getBlock(Math.floor(x), Math.floor(y), Math.floor(z)) === Block.Water;
      this.positions.set([x, wet ? y : eye.y - 100, z], i * 3);
    }
    this.geometry.attributes.position.needsUpdate = true;
  }
}
