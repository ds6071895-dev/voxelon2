import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Block } from '../src/blocks';
import { chooseCaptureCourse } from '../src/media/course';
import { captureSightHit, captureVolumeHit } from '../src/media/geometry';
import { configureCaptureQuality, sizeCapture } from '../src/media/offline';
import { fitHands, muzzleLine, PALM } from '../src/media/grips';
import { createGunModel, poseGunModel } from '../src/gunmodels';
import type { AvatarBody } from '../src/avatar';
import type { PostFX } from '../src/postfx';
import type { SunShadow } from '../src/shadows';
import { createTrailerCourse, trailerShotContext, trailerCamera, trailerActorPoses, trailerRatPoses } from '../src/trailer/staging';
import { worldGenerator } from '../src/multiverse';
import { DURATION, SHOTS } from '../src/trailer/shots';

/** Focused headless runner for the parent suite; no capture, network or WebGL. */
export function runMediaCleanupTests(): void {
  const oneCell = (block: number) => ({ blockAt: (x: number, y: number, z: number) => x === 0 && y === 0 && z === 0 ? block : Block.Air });
  const slab = oneCell(Block.ManorMarbleSlab);
  assert.equal(captureVolumeHit(slab, [.1, .5, .1], [.9, .8, .9]), null, 'touching a slab is not penetration');
  assert.ok(captureVolumeHit(slab, [.1, .49, .1], [.9, .8, .9]), 'volume catches a sub-box, not just its centre');
  assert.equal(captureSightHit(slab, [-1, .75, .5], [2, .75, .5]), null, 'ray passes above the actual slab');
  assert.ok(captureSightHit(slab, [-1, .25, .5], [2, .25, .5]), 'partial non-opaque voxel still blocks a ray through its geometry');
  assert.ok(captureSightHit(slab, [2, .25, .5], [-1, .25, .5]), 'negative ray traversal is symmetric');
  const post = oneCell(Block.ManorGardenPost);
  assert.equal(captureSightHit(post, [-10, .5, .1], [10, .5, .1]), null, 'ray misses a narrow post sub-box');
  assert.ok(captureSightHit(post, [-10, .5, .5], [10, .5, .5]), 'DDA catches a narrow post without distance-dependent sampling');
  assert.equal(captureSightHit(oneCell(Block.ManorGlass), [-1, .5, .5], [2, .5, .5]), null, 'transparent panes do not hide subjects');
  assert.equal(captureVolumeHit(oneCell(Block.Barrier), [.1, .1, .1], [.9, .9, .9]), null, 'invisible match barriers do not bury a cinematic camera');
  assert.equal(captureSightHit(oneCell(Block.Stone), [.1, .1, .1], [.1, .1, .1])?.block, Block.Stone, 'zero-length segment inside solid is blocked');

  // Canvas dimensions deliberately differ from any browser-window dimensions.
  let dimensions = new THREE.Vector2(1920, 1080);
  let fxSize = new THREE.Vector2();
  const renderer = {
    getSize(out: THREE.Vector2) { return out.copy(dimensions); },
    setSize(w: number, h: number, style: boolean) { assert.equal(style, false); dimensions.set(w, h); },
  } as unknown as THREE.WebGLRenderer;
  const postfx = { setTier() {}, setEnabled() {}, setSize(w: number, h: number) { fxSize.set(w, h); } } as unknown as PostFX;
  const shadows = { setTier() {}, setEnabled() {} } as unknown as SunShadow;
  configureCaptureQuality(renderer, postfx, shadows, true, true, 1, 1);
  assert.deepEqual(fxSize.toArray(), [1920, 1080], 'quality configuration reasserts the actual capture viewport');
  const camera = new THREE.PerspectiveCamera(50);
  sizeCapture(renderer, postfx, camera, 1200, 1000, 100);
  assert.equal(camera.aspect, 1200 / 900);
  assert.equal(camera.view?.fullHeight, 900);
  assert.equal(camera.view?.height, 1000, 'extra ground extends the view without reframing the original subject');
  sizeCapture(renderer, postfx, camera, 1600, 900);
  assert.equal(camera.view?.enabled, false, 'next take clears the extended view');
  assert.deepEqual(fxSize.toArray(), [1600, 900]);
  assert.throws(() => sizeCapture(renderer, postfx, camera, 1200, 900, 900));

  // Trigger/support palms must remain attached even under a rotated stage rig.
  const group = new THREE.Group();
  const parts = Array.from({ length: 4 }, () => new THREE.Group());
  parts.forEach(p => group.add(p));
  parts[2].position.set(-.3, 1.4, 0); parts[3].position.set(.3, 1.4, 0);
  const body = { group, parts } as AvatarBody;
  const gun = createGunModel(); poseGunModel(gun, 'avatar'); group.add(gun);
  group.position.set(12, 99, 4); group.rotation.y = 1.7;
  fitHands(body, gun); group.updateWorldMatrix(true, true);
  assert.ok(parts[3].localToWorld(PALM.clone()).distanceTo(gun.localToWorld(new THREE.Vector3(0, -.15, .03))) < 1e-9);
  const support = gun.getObjectByName('grip2')!.getWorldPosition(new THREE.Vector3());
  support.add(new THREE.Vector3(0, -.08, 0).applyQuaternion(gun.getWorldQuaternion(new THREE.Quaternion())).multiplyScalar(gun.scale.y));
  assert.ok(parts[2].localToWorld(PALM.clone()).distanceTo(support) < 1e-9);
  const ray = muzzleLine(gun);
  assert.ok(ray.origin.distanceTo(gun.getObjectByName('muzzle')!.getWorldPosition(new THREE.Vector3())) < 1e-9);
  assert.ok(ray.direction.dot(new THREE.Vector3(0, 0, -1).transformDirection(gun.matrixWorld)) > .999999);

  const { seed, course } = createTrailerCourse();
  assert.equal(seed, 2026);
  assert.equal(chooseCaptureCourse(['rooftops']).seed, 2026, 'card stage keeps its own required-piece policy');
  assert.throws(() => chooseCaptureCourse(['rooftops'], 2026, 2026), /No capture course/);
  assert.throws(() => chooseCaptureCourse(['rooftops'], 2026, 3026, 0), /Invalid/);
  assert.equal(SHOTS.length, 17); assert.equal(DURATION, 94);
  assert.equal(SHOTS.reduce((duration, s) => duration + s.duration, 0), DURATION);
  const shot = SHOTS.find(s => s.action === 'dragon')!;
  const context = trailerShotContext(shot, course);
  assert.throws(() => trailerCamera(shot, 1, context), /actual flight-model/);
  const head = new THREE.Vector3(30, 170, 250);
  const shotCam = trailerCamera(shot, 1, context, head);
  assert.deepEqual(shotCam.target.toArray(), [30, 169, 253], 'dragon framing follows the live flight model');
  head.x += 10;
  assert.equal(trailerCamera(shot, 1, context, head).target.x, 40, 'camera path is evaluable, not copied samples');

  // Regression for proven pillar/cage penetrations: audit full body volumes at
  // every simulation frame, including the rescue teleport's exact boundary.
  for (const duel of SHOTS.filter(s => s.action === 'duel')) {
    const gen = worldGenerator({ kind: 'duel', seed });
    const context = trailerShotContext(duel, course);
    for (let frame = 0; frame <= duel.duration * 60; frame++) {
      for (const pose of trailerActorPoses(duel, frame / 60, context, course, gen)) {
        const p = pose.position;
        assert.equal(captureVolumeHit(gen, [p.x - .3, p.y + .03, p.z - .3], [p.x + .3, p.y + 1.8, p.z + .3]), null,
          `${duel.id} actor ${pose.index} clears arena geometry at frame ${frame}`);
      }
    }
  }
  const rescue = SHOTS.find(s => s.action === 'rescue')!;
  const manor = worldGenerator({ kind: 'ratseek', seed });
  assert.equal(trailerRatPoses(rescue, .85)[2].caged, true, 'captive pose remains intentional until the teleport');
  for (let frame = 0; frame <= rescue.duration * 60; frame++) {
    for (const pose of trailerRatPoses(rescue, frame / 60)) {
      if (pose.caged) continue;
      const [x, y, z] = pose.position;
      assert.equal(captureVolumeHit(manor, [x - .15, y + .03, z - .15], [x + .15, y + .9, z + .15]), null,
        `freed rescue rat clears cage bars at frame ${frame}`);
    }
  }
}
