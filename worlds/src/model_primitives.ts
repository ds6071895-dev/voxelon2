// Neutral vertex-coloured model primitives shared by avatars and game props.
import * as THREE from 'three';

const SHADE = [0.62, 0.62, 1.0, 0.5, 0.82, 0.82];
function shaded(w: number, h: number, d: number, color: number): THREE.BufferGeometry {
  const geo = new THREE.BoxGeometry(w, h, d);
  const c = new THREE.Color(color);
  const pos = geo.getAttribute('position');
  const colors = new Float32Array(pos.count * 3);
  for (let f = 0; f < 6; f++) for (let v = 0; v < 4; v++) {
    const k = (f * 4 + v) * 3;
    colors[k] = c.r * SHADE[f]; colors[k + 1] = c.g * SHADE[f]; colors[k + 2] = c.b * SHADE[f];
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  return geo;
}

/** Borrowed by all vertex-coloured boxes and other coloured prop geometry. */
export const BOX_MAT = new THREE.MeshBasicMaterial({ vertexColors: true });
export function box(parent: THREE.Object3D, w: number, h: number, d: number, color: number,
  x: number, y: number, z: number, mat: THREE.Material = BOX_MAT): THREE.Mesh {
  const m = new THREE.Mesh(shaded(w, h, d, color), mat);
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}
export function joint(parent: THREE.Object3D, x: number, y: number, z: number): THREE.Group {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  parent.add(g);
  return g;
}

// Behind walls: drawn after the world but before the body's own meshes.
const GLOW_MAT = new THREE.MeshBasicMaterial({ color: 0xf2c65a, depthFunc: THREE.GreaterDepth, depthWrite: false });
// In the open: an inverted hull rim behind the body.
const GLOW_EDGE_MAT = new THREE.MeshBasicMaterial({
  color: 0xffe28a, side: THREE.BackSide, transparent: true, opacity: 0.9, depthWrite: false,
});

/** Ownership checks do not expose private glow materials to game modules. */
export function isSharedModelMaterial(mat: THREE.Material): boolean {
  return mat === BOX_MAT || mat === GLOW_MAT || mat === GLOW_EDGE_MAT;
}

export interface Glow { set(on: boolean): void; dispose(): void }
/** Each source mesh gains two sibling copies that follow its animated joint. */
export function glowOf(source: THREE.Object3D): Glow {
  const meshes: THREE.Mesh[] = [];
  source.traverse((o) => {
    if (o instanceof THREE.Mesh && o.visible && o.material !== GLOW_MAT && o.material !== GLOW_EDGE_MAT) meshes.push(o);
  });
  const copies: THREE.Mesh[] = [];
  for (const o of meshes) {
    if (!o.parent) continue;
    o.renderOrder = Math.max(o.renderOrder, 2);
    for (const [mat, grow, order] of [[GLOW_EDGE_MAT, 1.16, 899], [GLOW_MAT, 1.08, 1]] as const) {
      const m = new THREE.Mesh(o.geometry, mat);
      m.position.copy(o.position); m.quaternion.copy(o.quaternion);
      m.scale.copy(o.scale).multiplyScalar(grow);
      m.renderOrder = order; m.visible = false;
      o.parent.add(m); copies.push(m);
    }
  }
  return {
    set(on) { for (const m of copies) m.visible = on; },
    // Geometry and materials are borrowed; only detach the copy meshes.
    dispose() { for (const m of copies) m.removeFromParent(); copies.length = 0; },
  };
}
