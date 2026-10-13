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


/** Where the hand closes, in the arm's own frame (shoulder pivot at the origin). */
const PALM_Y = -0.5;
/** Arm raise (rad) while holding: the stance the item is trimmed for. */
const HOLD_RAISE = 0.5;
const _u = new THREE.Vector3(), _v = new THREE.Vector3(), _n = new THREE.Vector3(1, 0, 0);
const _x = new THREE.Vector3(), _y = new THREE.Vector3(), _m = new THREE.Matrix4();

/** Things you hold by the grip with the business end out: blades, picks, lights. */
function heldLikeTool(id: number): boolean {
  const info = ITEMS[id];
  return !!info?.tool || id === Item.Shears || id === Item.RatCatcher || id === Item.Flashlight;
}

/** An item in a hand. The palm closes on it: a tool's grip sits in the fist and
 *  the blade points forward and up, a block sits cradled in front of the fist,
 *  and any other sprite is held out upright. Every flat sprite faces sideways,
 *  so a spectator sees its face instead of a hairline edge. */
function heldItemRoot(atlas: Atlas, id: number, itemMaterial: THREE.Material): THREE.Mesh {
  const info = ITEMS[id], isBlock = info.kind === 'block';
  // The mesh itself is the equipment root (visibility and glow act on it),
  // positioned relative to the palm.
  const mesh = new THREE.Mesh(itemGeometry(atlas, id), itemMaterial);
  if (isBlock) {
    // A fist-sized cube resting on the hand, a corner turned toward the front.
    mesh.scale.setScalar(1.25);
    mesh.rotation.set(0, Math.PI / 4, 0);
    mesh.position.set(0, PALM_Y + 0.04, -0.2);
    return mesh;
  }
  const size = heldLikeTool(id) ? 1.35 : 0.95;
  mesh.scale.setScalar(size);
  if (heldLikeTool(id)) {
    // The sprite's diagonal (grip bottom-left, tip top-right) lies along D in
    // arm space: out in front of the fist and a little up. The face looks out
    // to the side (+x) and the grip pixel sits in the palm.
    const a = 1.72 - HOLD_RAISE * 0.4;
    _u.set(0, -Math.cos(a), -Math.sin(a)).normalize();
    _v.crossVectors(_n, _u);
    _x.copy(_u).sub(_v).multiplyScalar(Math.SQRT1_2);
    _y.copy(_u).add(_v).multiplyScalar(Math.SQRT1_2);
    _m.makeBasis(_x.clone(), _y.clone(), _n.clone());
    mesh.quaternion.setFromRotationMatrix(_m);
    // Sprite centre is 0.28 (of the tile's half-diagonal) along the blade from the grip.
    mesh.position.copy(_u).multiplyScalar(0.45 * size * 0.3).y += PALM_Y;
  } else {
    // Upright, facing sideways, held just in front of the fist.
    mesh.rotation.set(-HOLD_RAISE, Math.PI / 2, 0, 'YXZ');
    mesh.position.set(0, PALM_Y + 0.07, -0.17);
  }
  return mesh;
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
    kind = 'item'; root = heldItemRoot(atlas, id, itemMaterial);
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
