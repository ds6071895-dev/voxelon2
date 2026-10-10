import * as THREE from 'three';
import { applyAvatarSneak, releaseGunHold, poseGunHold, stridePose, type AvatarBody } from './avatar';
import { createGunModel, isGunItem, poseGunModel } from './gunmodels';
import { createGadgetModel, isModeledGadget, poseGadgetModel } from './gadgetmodels';
import { createBowModel, poseBowModel, poseBowDraw } from './bowmodel';
import { itemGeometry } from './item_geometry';
import { ITEMS, Item } from './items';
import type { Atlas } from './textures';

export interface AvatarEquipment {
  root: THREE.Object3D;
  kind: 'gun' | 'bow' | 'gadget' | 'item';
  /** Geometry and model materials are cached; item material is caller-owned.
   *  Remove borrowed glow copies before this detach-only disposal. */
  dispose(): void;
}

export function createAvatarItemMaterial(atlas: Atlas): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    map: atlas.texture, alphaTest: 0.4, vertexColors: true, side: THREE.DoubleSide,
  });
}

/** The common third-person/card equipment dispatch, with avatar-local poses.
 *  First-person viewmodel animation stays in HeldItemView. */
export function createAvatarEquipment(
  atlas: Atlas, id: number, itemMaterial: THREE.Material,
): AvatarEquipment | null {
  const info = ITEMS[id];
  if (id <= 0 || !info) return null;
  let root: THREE.Object3D, kind: AvatarEquipment['kind'];
  if (isGunItem(id)) {
    kind = 'gun'; root = createGunModel(); poseGunModel(root, 'avatar');
  } else if (isModeledGadget(id)) {
    kind = 'gadget'; root = createGadgetModel(); poseGadgetModel(root, 'avatar');
  } else if (id === Item.BridgeBow) {
    kind = 'bow'; root = createBowModel(); poseBowModel(root, 'avatar');
  } else {
    kind = 'item'; root = new THREE.Mesh(itemGeometry(atlas, id), itemMaterial);
    root.position.set(0, -0.68, -0.2);
    root.rotation.set(-0.5, 0, 0);
    root.scale.setScalar(info.kind === 'block' ? 1.5 : 1.1);
  }
  return { root, kind, dispose() { root.removeFromParent(); } };
}

/** Guns ride the body/look line; bow, gadget and atlas items ride the right arm. */
export function attachAvatarEquipment(body: AvatarBody, equipment: AvatarEquipment): void {
  (equipment.kind === 'gun' ? body.group : body.parts[3]).add(equipment.root);
}

export interface AvatarPoseState {
  walkPhase: number;
  speed: number;
  sneak: number;
  pitch: number;
  attackSwing: number;
  aim?: number;
  /** Reload dip, 0..1, rather than elapsed reload time. */
  reload?: number;
  kick?: number;
  bowPower?: number;
}

/** Compose the same base pose and equipment overrides for local/remote bodies. */
export function poseAvatar(
  body: AvatarBody, equipment: AvatarEquipment | null, state: AvatarPoseState,
): void {
  releaseGunHold(body);
  applyAvatarSneak(body, state.sneak);
  body.head.rotation.x = THREE.MathUtils.clamp(state.pitch, -1.15, 1.15) + state.sneak * 0.12;
  const pose = stridePose(state.walkPhase, state.speed, state.sneak, !!equipment, state.attackSwing);
  body.parts[0].rotation.x = pose.legs[0];
  body.parts[1].rotation.x = pose.legs[1];
  body.parts[2].rotation.x = pose.arms[0];
  body.parts[2].rotation.z = 0;
  body.parts[3].rotation.x = pose.arms[1];
  body.parts[3].rotation.z = pose.rightArmRoll;
  if (equipment?.kind === 'gun') {
    poseGunHold(body, equipment.root, {
      pitch: state.pitch, aim: state.aim ?? 0, reload: state.reload ?? 0,
      kick: state.kick ?? state.attackSwing,
    });
  } else if (equipment?.kind === 'gadget') {
    const action = state.kick ?? state.attackSwing;
    body.parts[2].rotation.x = 0.45 + action * 0.18;
    body.parts[3].rotation.x = 0.62 + action * 0.48;
    body.parts[2].rotation.z = -0.18;
    body.parts[3].rotation.z = 0.08;
  } else if (equipment?.kind === 'bow') {
    poseBowDraw(equipment.root, state.bowPower ?? 0);
  }
}
