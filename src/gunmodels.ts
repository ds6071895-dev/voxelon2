// Shared low-poly firearm models. Every model is built around the right-hand
// grip at the origin and points down local -Z, matching cameras and avatars.

import * as THREE from 'three';
import { Item, ITEMS } from './items';

const materials = new Map<number, THREE.MeshBasicMaterial>();
const models = new Map<number, THREE.Group>();
function material(color: number): THREE.MeshBasicMaterial {
  let mat = materials.get(color);
  if (!mat) {
    mat = new THREE.MeshBasicMaterial({ color });
    materials.set(color, mat);
  }
  return mat;
}

function box(
  parent: THREE.Object3D, size: [number, number, number],
  pos: [number, number, number], color: number,
  rot: [number, number, number] = [0, 0, 0]
): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material(color));
  mesh.position.set(...pos);
  mesh.rotation.set(...rot);
  parent.add(mesh);
  return mesh;
}

function tube(
  parent: THREE.Object3D, radius: number, length: number,
  pos: [number, number, number], color: number
): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius, length, 6), material(color));
  mesh.position.set(...pos);
  mesh.rotation.x = Math.PI / 2;
  parent.add(mesh);
  return mesh;
}

export function isGunItem(id: number): boolean {
  return !!ITEMS[id]?.gun;
}

/** Fresh transform group with intentionally chunky geometry and a tiny polygon
 * budget. Callers may freely pose/scale the returned root. */
export function createGunModel(id: number): THREE.Group {
  const cached = models.get(id);
  if (cached) return cached.clone(true);
  const root = new THREE.Group();
  root.userData.gunModel = true;
  const dark = 0x252a30, black = 0x111418, steel = 0x59636d;
  const wood = 0x70472b, tan = 0x9a7a4d, cobalt = 0x315a72;

  const grip = (x = 0, z = 0.02, color = dark): void => {
    box(root, [0.13, 0.3, 0.15], [x, -0.15, z], color, [-0.2, 0, 0]);
  };
  const sight = (z: number): void => {
    box(root, [0.045, 0.07, 0.05], [0, 0.16, z], black);
  };
  const scope = (z: number, length = 0.32): void => {
    // Four rails and two hexagonal rings leave a real opening down the sight.
    for (const side of [-1, 1]) {
      box(root, [0.025, 0.025, length], [side * 0.065, 0.2, z], black);
      box(root, [0.025, 0.025, length], [0, 0.2 + side * 0.065, z], black);
    }
    for (const end of [-1, 1]) {
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(0.07, 0.015, 4, 8), material(black));
      ring.position.set(0, 0.2, z + end * length / 2);
      root.add(ring);
    }
    box(root, [0.04, 0.08, 0.04], [0, 0.13, z - length * 0.3], dark);
    box(root, [0.04, 0.08, 0.04], [0, 0.13, z + length * 0.3], dark);
  };

  switch (id) {
    case Item.Pistol:
      box(root, [0.2, 0.2, 0.56], [0, 0.08, -0.23], steel);
      box(root, [0.17, 0.08, 0.48], [0, 0.19, -0.24], black);
      grip(0, 0.02, dark); sight(-0.48);
      break;
    case Item.SMG:
      box(root, [0.26, 0.27, 0.66], [0, 0.08, -0.28], cobalt);
      tube(root, 0.045, 0.38, [0, 0.1, -0.78], black);
      box(root, [0.13, 0.42, 0.14], [0, -0.17, -0.28], dark, [-0.12, 0, 0]);
      box(root, [0.2, 0.08, 0.34], [0, 0.08, 0.22], dark);
      grip(0, 0.05); sight(-0.55);
      break;
    case Item.Shotgun:
      box(root, [0.25, 0.25, 0.52], [0, 0.08, -0.18], wood);
      tube(root, 0.055, 0.82, [-0.065, 0.14, -0.82], steel);
      tube(root, 0.055, 0.82, [0.065, 0.14, -0.82], steel);
      box(root, [0.28, 0.19, 0.42], [0, 0.05, 0.28], wood);
      box(root, [0.3, 0.18, 0.28], [0, 0.08, -0.55], tan);
      grip(); sight(-1.18);
      break;
    case Item.RocketLauncher:
      tube(root, 0.18, 1.35, [0, 0.2, -0.48], 0x53634b);
      tube(root, 0.205, 0.18, [0, 0.2, -1.12], dark);
      tube(root, 0.23, 0.22, [0, 0.2, 0.18], dark);
      box(root, [0.32, 0.08, 0.4], [0, 0.42, -0.48], tan);
      grip(0, -0.22); scope(-0.5, 0.3);
      break;
    case Item.Sniper:
      box(root, [0.24, 0.25, 0.72], [0, 0.08, -0.35], steel);
      tube(root, 0.045, 1.0, [0, 0.11, -1.15], black);
      box(root, [0.28, 0.22, 0.55], [0, 0.05, 0.35], wood);
      box(root, [0.12, 0.42, 0.14], [0, -0.18, -0.18], dark);
      grip(); scope(-0.48, 0.62);
      break;
    case Item.BurstRifle:
      box(root, [0.27, 0.27, 0.74], [0, 0.08, -0.34], cobalt);
      tube(root, 0.045, 0.75, [0, 0.11, -1.08], black);
      box(root, [0.24, 0.22, 0.55], [0, 0.05, 0.34], dark);
      box(root, [0.14, 0.39, 0.17], [0, -0.17, -0.28], steel, [-0.12, 0, 0]);
      grip(); scope(-0.5, 0.38);
      break;
    default: // Rifle
      box(root, [0.27, 0.27, 0.78], [0, 0.08, -0.35], 0x3e474d);
      tube(root, 0.047, 0.72, [0, 0.11, -1.08], black);
      box(root, [0.26, 0.22, 0.56], [0, 0.05, 0.36], wood);
      box(root, [0.14, 0.42, 0.17], [0, -0.19, -0.28], steel, [-0.12, 0, 0]);
      grip(); sight(-0.7); sight(-1.4);
      break;
  }
  models.set(id, root);
  return root.clone(true);
}

/** Consistent transforms for each place a gun is presented. */
export function poseGunModel(
  model: THREE.Object3D, context: 'firstPerson' | 'avatar' | 'drop'
): void {
  if (context === 'firstPerson') {
    model.position.set(-0.03, 0.02, -0.08);
    model.rotation.set(0.02, 0.02, 0);
    model.scale.setScalar(0.48);
  } else if (context === 'avatar') {
    model.position.set(0, -0.66, -0.18);
    model.rotation.set(-0.52, 0, 0);
    model.scale.setScalar(0.42);
  } else {
    model.rotation.set(0.12, 0.45, 0);
    model.scale.setScalar(0.3);
  }
}
