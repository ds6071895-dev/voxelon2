import * as THREE from 'three';
import type { VaultBossKind } from './vaults';
import { bossTextures } from './boss_textures';

// The voxel world has no scene lights. A studio matcap gives encounter meshes
// curved diffuse shading, a broad key and a cool rim on every graphics preset.
// Shared by all bosses and summons; no image download or per-boss lights.
let studio: THREE.DataTexture | undefined;
export function bossSurface(color: number, polished = false, kind?: VaultBossKind): THREE.MeshMatcapMaterial {
  if (!studio) {
    const size = 128;
    const pixels = new Uint8Array(size * size * 4);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const nx = (x + 0.5) / size * 2 - 1;
      const ny = (y + 0.5) / size * 2 - 1;
      const nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny));
      const key = Math.max(0, -nx * 0.45 + ny * 0.65 + nz * 0.6);
      const spec = Math.pow(Math.max(0, -nx * 0.35 + ny * 0.45 + nz * 0.82), 28);
      const rim = Math.pow(1 - nz, 3) * Math.max(0, nx) * 0.5;
      const value = 0.34 + key * 0.62 + spec * 0.38;
      const i = (y * size + x) * 4;
      pixels[i] = Math.min(255, (value + rim * 0.55) * 255);
      pixels[i + 1] = Math.min(255, (value + rim * 0.8) * 255);
      pixels[i + 2] = Math.min(255, (value + rim) * 255);
      pixels[i + 3] = 255;
    }
    studio = new THREE.DataTexture(pixels, size, size);
    studio.colorSpace = THREE.SRGBColorSpace;
    studio.magFilter = studio.minFilter = THREE.LinearFilter;
    studio.needsUpdate = true;
  }
  const material = new THREE.MeshMatcapMaterial({ color, matcap: studio });
  if (kind) {
    const textures = bossTextures(kind, polished);
    material.map = textures.map;
    material.bumpMap = textures.bumpMap;
    material.bumpScale = kind === 'mire_queen' ? 0.075 : polished ? 0.025 : 0.05;
  }
  material.userData.baseColor = new THREE.Color(color);
  material.userData.polished = polished;
  return material;
}

/** A soft luminous volume: fades at the silhouette instead of drawing an
 * opaque-looking ball. Works with instancing and without the bloom preset. */
export function bossGlow(color: number, opacity = 0.6): THREE.MeshBasicMaterial {
  const material = new THREE.MeshBasicMaterial({color,opacity,transparent:true,
    depthWrite:false,blending:THREE.AdditiveBlending});
  material.onBeforeCompile = shader => {
    const varyings = 'varying vec3 glowNormal; varying vec3 glowEye;\n';
    shader.vertexShader = varyings + shader.vertexShader.replace('#include <project_vertex>', `
      #include <project_vertex>
      vec3 n = normal;
      #ifdef USE_INSTANCING
        n = mat3(instanceMatrix) * n;
      #endif
      glowNormal = normalize(normalMatrix * n);
      glowEye = normalize(-mvPosition.xyz);
    `);
    shader.fragmentShader = varyings + shader.fragmentShader.replace('#include <opaque_fragment>', `
      diffuseColor.a *= pow(max(0.0, dot(normalize(glowNormal), normalize(glowEye))), 2.2);
      #include <opaque_fragment>
    `);
  };
  material.customProgramCacheKey = () => 'boss-soft-volume-v1';
  return material;
}
