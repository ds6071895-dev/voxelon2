import * as THREE from 'three';

const LIGHT = new THREE.Vector3(0.34, 0.86, 0.38).normalize();

/** Transform and shade an untextured primitive for merging into a model part.
 *  Coefficients retain each model's existing presentation. */
export function bakeModelGeometry(
  geometry: THREE.BufferGeometry, matrix: THREE.Matrix4, color: number,
  ambient: number, direct: number, shadow: number,
): THREE.BufferGeometry {
  geometry.applyMatrix4(matrix);
  geometry.deleteAttribute('uv');
  const base = new THREE.Color(color);
  const normal = geometry.attributes.normal;
  const colors = new Float32Array(normal.count * 3);
  for (let i = 0; i < normal.count; i++) {
    const dot = normal.getX(i) * LIGHT.x + normal.getY(i) * LIGHT.y + normal.getZ(i) * LIGHT.z;
    const shade = ambient + direct * Math.max(0, dot) - shadow * Math.max(0, -dot);
    colors[i * 3] = base.r * shade;
    colors[i * 3 + 1] = base.g * shade;
    colors[i * 3 + 2] = base.b * shade;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geometry;
}

/** Give a borrowed model copy its own tintable materials. Geometry and maps
 *  stay borrowed; the returned unique clones are the caller's disposal list. */
export function cloneModelMaterials(
  model: THREE.Object3D, skipGlow = false,
): THREE.MeshBasicMaterial[] {
  const copies = new Map<THREE.MeshBasicMaterial, THREE.MeshBasicMaterial>();
  const copy = (original: THREE.MeshBasicMaterial): THREE.MeshBasicMaterial => {
    let material = copies.get(original);
    if (!material) {
      material = original.clone();
      copies.set(original, material);
    }
    return material;
  };
  model.traverse(o => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || (skipGlow && mesh.userData.glow)) return;
    mesh.material = Array.isArray(mesh.material)
      ? mesh.material.map(m => copy(m as THREE.MeshBasicMaterial))
      : copy(mesh.material as THREE.MeshBasicMaterial);
  });
  return [...copies.values()];
}
