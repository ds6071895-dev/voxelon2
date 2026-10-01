import * as THREE from 'three';
import type { AvatarBody } from '../remoteplayers';
import { box } from '../ratseek_models';

// Trailer actors use the actual shortened arm mesh, whose palm is 0.54 units
// below the shoulder. Solve against its geometry, not the full leg length.
export const PALM = new THREE.Vector3(0, -.54, 0);
const down = new THREE.Vector3(0, -1, 0);
export function fitHands(body: AvatarBody, gun: THREE.Object3D): void {
  body.group.updateWorldMatrix(true, true);
  const right = gun.localToWorld(new THREE.Vector3(0, -.15, .03));
  const support = gun.getObjectByName('grip2')!;
  const left = support.getWorldPosition(new THREE.Vector3());
  left.add(new THREE.Vector3(0, -.08, 0).applyQuaternion(gun.getWorldQuaternion(new THREE.Quaternion())).multiplyScalar(gun.scale.y));
  for (const [arm, target] of [[body.parts[3], right], [body.parts[2], left]] as const) {
    const v = body.group.worldToLocal(target.clone()).sub(arm.position);
    arm.quaternion.setFromUnitVectors(down, v.clone().normalize());
    arm.scale.y = v.length() / -PALM.y;
  }
}

export function createHeldAxe(): THREE.Group {
  const axe = new THREE.Group();
  // The palm wraps around the middle of the handle. No transparent sprite
  // padding can make the tool appear detached in a side-on cinematic.
  box(axe, .075, .58, .075, 0x77533b, 0, .12, 0);
  box(axe, .085, .12, .085, 0x443c39, 0, -.12, 0);
  box(axe, .20, .22, .09, 0xa7b1b8, .07, .34, 0);
  box(axe, .12, .28, .10, 0xdce5e9, .20, .34, 0);
  box(axe, .035, .29, .105, 0xf0f4f5, .275, .34, 0);
  axe.position.copy(PALM);
  return axe;
}

export function muzzleLine(gun: THREE.Object3D): { origin: THREE.Vector3; direction: THREE.Vector3 } {
  gun.updateWorldMatrix(true, true);
  return {
    origin: gun.getObjectByName('muzzle')!.getWorldPosition(new THREE.Vector3()),
    direction: new THREE.Vector3(0, 0, -1).transformDirection(gun.matrixWorld),
  };
}
