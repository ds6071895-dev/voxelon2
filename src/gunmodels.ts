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
  pos: [number, number, number], color: number, sides = 6
): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius, length, sides), material(color));
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
  const lightSteel = 0x89949d, gunmetal = 0x3e474d, brass = 0xb68a3c;
  const wood = 0x70472b, woodLight = 0x9b673b, tan = 0x9a7a4d;
  const cobalt = 0x315a72, cobaltLight = 0x477d96;
  const olive = 0x53634b, oliveLight = 0x748169, glass = 0x2d7896;

  const grip = (x = 0, z = 0.02, color = dark): void => {
    box(root, [0.13, 0.3, 0.15], [x, -0.15, z], color, [-0.2, 0, 0]);
  };
  const gripPanel = (z = 0.02, color = wood): void => {
    for (const side of [-1, 1])
      box(root, [0.008, 0.19, 0.1], [side * 0.069, -0.15, z], color, [-0.2, 0, 0]);
  };
  const sight = (z: number, height = 0.07): void => {
    box(root, [0.045, height, 0.05], [0, 0.16 + (height - 0.07) / 2, z], black);
  };
  const triggerGuard = (z: number): void => {
    box(root, [0.025, 0.12, 0.025], [-0.07, -0.06, z], black);
    box(root, [0.025, 0.12, 0.025], [0.07, -0.06, z], black);
    box(root, [0.16, 0.025, 0.025], [0, -0.12, z], black);
    box(root, [0.025, 0.08, 0.025], [0, -0.06, z - 0.01], brass, [0.25, 0, 0]);
  };
  const muzzle = (z: number, radius: number, color = steel): void => {
    tube(root, radius, 0.055, [0, 0.11, z + 0.0275], color);
    tube(root, radius * 0.68, 0.008, [0, 0.11, z - 0.004], black);
  };
  const scope = (z: number, length = 0.32, radius = 0.06, y = 0.23): void => {
    tube(root, radius, length, [0, y, z], dark, 8);
    for (const end of [-1, 1]) {
      tube(root, radius + 0.014, 0.045, [0, y, z + end * (length / 2 - 0.0225)], black, 8);
    }
    tube(root, radius * 0.78, 0.009, [0, y, z - length / 2 - 0.005], glass, 8);
    box(root, [0.045, y - 0.14, 0.04], [0, (y + 0.14) / 2, z - length * 0.3], black);
    box(root, [0.045, y - 0.14, 0.04], [0, (y + 0.14) / 2, z + length * 0.3], black);
  };

  switch (id) {
    case Item.Pistol:
      // Squared slide over a separate frame, exposed barrel, and inset grip scales.
      box(root, [0.2, 0.14, 0.52], [0, 0.14, -0.25], steel);
      box(root, [0.16, 0.035, 0.43], [0, 0.228, -0.23], lightSteel);
      box(root, [0.18, 0.1, 0.34], [0, 0.035, -0.13], gunmetal);
      tube(root, 0.043, 0.13, [0, 0.14, -0.485], black);
      tube(root, 0.032, 0.008, [0, 0.14, -0.554], black);
      box(root, [0.105, 0.012, 0.105], [0, 0.251, -0.31], black);
      for (let z = -0.035; z >= -0.1; z -= 0.032)
        box(root, [0.204, 0.055, 0.012], [0, 0.155, z], dark);
      grip(0, 0.025, dark); gripPanel(0.025, wood);
      triggerGuard(-0.17); sight(-0.48, 0.055); sight(-0.055, 0.045);
      break;
    case Item.SMG:
      // Compact stamped receiver with a short barrel and a skeletal folding stock.
      box(root, [0.25, 0.25, 0.58], [0, 0.08, -0.28], cobalt);
      box(root, [0.255, 0.055, 0.46], [0, 0.225, -0.29], cobaltLight);
      box(root, [0.27, 0.045, 0.46], [0, -0.02, -0.31], dark);
      tube(root, 0.044, 0.24, [0, 0.1, -0.72], black);
      muzzle(-0.84, 0.061, dark);
      box(root, [0.15, 0.4, 0.13], [0, -0.18, -0.3], dark, [-0.12, 0, 0]);
      box(root, [0.105, 0.27, 0.1], [0, -0.18, -0.3], gunmetal, [-0.12, 0, 0]);
      for (const side of [-1, 1])
        box(root, [0.025, 0.025, 0.38], [side * 0.085, 0.09, 0.18], dark, [0.08, 0, 0]);
      box(root, [0.2, 0.25, 0.055], [0, 0.06, 0.38], black, [0.08, 0, 0]);
      box(root, [0.13, 0.08, 0.16], [0, -0.09, -0.54], black);
      grip(0, 0.06); triggerGuard(-0.05);
      sight(-0.55, 0.055); sight(-0.08, 0.045);
      break;
    case Item.Shotgun:
      // Side-by-side barrels, silver break-action receiver, and layered walnut furniture.
      box(root, [0.25, 0.23, 0.48], [0, 0.08, -0.18], steel);
      box(root, [0.255, 0.045, 0.38], [0, 0.218, -0.17], lightSteel);
      tube(root, 0.055, 0.82, [-0.065, 0.14, -0.82], steel);
      tube(root, 0.055, 0.82, [0.065, 0.14, -0.82], steel);
      tube(root, 0.038, 0.009, [-0.065, 0.14, -1.235], black);
      tube(root, 0.038, 0.009, [0.065, 0.14, -1.235], black);
      box(root, [0.025, 0.035, 0.78], [0, 0.205, -0.82], dark);
      box(root, [0.28, 0.19, 0.42], [0, 0.05, 0.28], wood);
      box(root, [0.24, 0.055, 0.35], [0, 0.16, 0.31], woodLight);
      box(root, [0.29, 0.2, 0.055], [0, 0.04, 0.515], black);
      box(root, [0.3, 0.18, 0.3], [0, 0.04, -0.55], tan);
      box(root, [0.305, 0.04, 0.24], [0, 0.145, -0.56], woodLight);
      box(root, [0.18, 0.025, 0.04], [0, 0.215, 0.02], brass);
      grip(0, 0.03, wood); gripPanel(0.03, woodLight);
      triggerGuard(-0.03); sight(-1.18, 0.055);
      break;
    case Item.RocketLauncher:
      // Faceted launch tube with armored collars, rear venturi, and tan heat shield.
      tube(root, 0.18, 1.35, [0, 0.2, -0.48], olive, 8);
      tube(root, 0.202, 0.15, [0, 0.2, -1.14], dark, 8);
      tube(root, 0.16, 0.012, [0, 0.2, -1.221], black, 8);
      tube(root, 0.23, 0.22, [0, 0.2, 0.18], dark, 8);
      tube(root, 0.19, 0.012, [0, 0.2, 0.296], black, 8);
      for (const z of [-0.84, -0.12]) tube(root, 0.195, 0.075, [0, 0.2, z], black, 8);
      box(root, [0.33, 0.065, 0.42], [0, 0.405, -0.48], tan);
      box(root, [0.25, 0.035, 0.34], [0, 0.455, -0.48], oliveLight);
      for (const z of [-0.61, -0.48, -0.35])
        box(root, [0.34, 0.025, 0.025], [0, 0.44, z], dark);
      grip(0, -0.22); gripPanel(-0.22, tan);
      box(root, [0.13, 0.24, 0.13], [0, -0.06, -0.78], dark, [-0.12, 0, 0]);
      scope(-0.49, 0.3, 0.05, 0.54);
      break;
    case Item.Sniper:
      // Long free-floating barrel, bolt handle, cheek rest, and full-size optic.
      box(root, [0.24, 0.24, 0.68], [0, 0.08, -0.35], steel);
      box(root, [0.245, 0.05, 0.55], [0, 0.225, -0.34], lightSteel);
      tube(root, 0.043, 0.86, [0, 0.11, -1.08], black);
      tube(root, 0.068, 0.16, [0, 0.11, -1.57], gunmetal);
      tube(root, 0.046, 0.009, [0, 0.11, -1.655], black);
      for (const side of [-1, 1])
        box(root, [0.025, 0.08, 0.045], [side * 0.069, 0.11, -1.59], black);
      box(root, [0.28, 0.22, 0.55], [0, 0.05, 0.35], wood);
      box(root, [0.24, 0.06, 0.34], [0, 0.18, 0.37], woodLight);
      box(root, [0.29, 0.24, 0.06], [0, 0.04, 0.655], black);
      box(root, [0.12, 0.38, 0.14], [0, -0.18, -0.18], dark, [-0.08, 0, 0]);
      box(root, [0.18, 0.035, 0.12], [0.13, 0.085, -0.03], black, [0, 0, 0.35]);
      box(root, [0.055, 0.055, 0.055], [0.23, 0.13, -0.03], black);
      grip(0, 0.02, wood); gripPanel(0.02, woodLight);
      triggerGuard(-0.08); scope(-0.48, 0.66, 0.065);
      break;
    case Item.BurstRifle:
      // Cobalt service carbine with vented handguard and an open carry handle.
      box(root, [0.27, 0.27, 0.7], [0, 0.08, -0.34], cobalt);
      box(root, [0.275, 0.055, 0.57], [0, 0.225, -0.35], cobaltLight);
      box(root, [0.29, 0.22, 0.44], [0, 0.08, -0.86], dark);
      for (const z of [-0.72, -0.84, -0.96])
        box(root, [0.295, 0.055, 0.055], [0, 0.19, z], black);
      tube(root, 0.043, 0.4, [0, 0.11, -1.25], black);
      muzzle(-1.45, 0.064, gunmetal);
      box(root, [0.24, 0.2, 0.54], [0, 0.05, 0.34], dark);
      box(root, [0.25, 0.2, 0.055], [0, 0.05, 0.635], black);
      box(root, [0.14, 0.39, 0.17], [0, -0.17, -0.28], steel, [-0.12, 0, 0]);
      box(root, [0.11, 0.3, 0.13], [0, -0.16, -0.3], dark, [-0.12, 0, 0]);
      grip(); triggerGuard(-0.04);
      for (const side of [-1, 1])
        box(root, [0.035, 0.12, 0.38], [side * 0.085, 0.29, -0.39], black, [-0.08, 0, 0]);
      box(root, [0.2, 0.035, 0.34], [0, 0.355, -0.39], black);
      sight(-0.59, 0.04);
      break;
    default: // Rifle
      // Wood-furnished automatic rifle: gas tube, stepped foregrip, and curved magazine.
      box(root, [0.27, 0.27, 0.7], [0, 0.08, -0.34], gunmetal);
      box(root, [0.275, 0.055, 0.55], [0, 0.225, -0.35], steel);
      box(root, [0.24, 0.18, 0.42], [0, 0.08, -0.82], wood);
      box(root, [0.245, 0.045, 0.34], [0, 0.19, -0.82], woodLight);
      tube(root, 0.047, 0.5, [0, 0.11, -1.2], black);
      tube(root, 0.035, 0.47, [0, 0.2, -1.1], gunmetal);
      box(root, [0.13, 0.18, 0.11], [0, 0.15, -1.28], black);
      muzzle(-1.45, 0.065, gunmetal);
      box(root, [0.26, 0.22, 0.56], [0, 0.05, 0.36], wood);
      box(root, [0.24, 0.055, 0.43], [0, 0.17, 0.39], woodLight);
      box(root, [0.27, 0.23, 0.055], [0, 0.04, 0.655], black);
      box(root, [0.14, 0.27, 0.17], [0, -0.12, -0.28], steel, [-0.08, 0, 0]);
      box(root, [0.14, 0.24, 0.17], [0, -0.34, -0.34], dark, [-0.28, 0, 0]);
      grip(0, 0.02, wood); gripPanel(0.02, woodLight);
      triggerGuard(-0.04); sight(-0.7, 0.055); sight(-1.38, 0.075);
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
