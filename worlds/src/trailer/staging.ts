// Actual release-stage motion: consumed by the renderer AND the geometry audit.
// This module is safe to evaluate without a DOM, WebGL context or live session.
import * as THREE from 'three';
import { TITLE_SEA } from '../title_terrain';
import { parkourStandSpot, type ParkourCourse } from '../parkour_course';
import type { WorldGenerator } from '../multiverse';
import { chooseCaptureCourse } from '../media/course';
import { captureGround } from '../media/offline';
import type { Shot } from './shots';

export type CapturePoint = [number, number, number];
export interface TrailerShotContext { firstOrder: number; anchor: THREE.Vector3 }
export interface TrailerCamera { position: THREE.Vector3; target: THREE.Vector3; fov: number }
export interface TrailerActorPose {
  index: number;
  position: THREE.Vector3;
  yaw: number;
  time: number;
  gun: boolean;
  attack: number;
  speed: number;
}
export interface TrailerRatPose { position: CapturePoint; yaw: number; speed: number; phase: number; caged: boolean }

export const createTrailerCourse = () => chooseCaptureCourse(['rooftops', 'waterfall']);

export function trailerShotContext(s: Shot, course: ParkourCourse): TrailerShotContext {
  const section = course.sections.find(p => p.piece === (s.piece ?? 'rooftops'));
  if (!section) throw new Error(`Missing trailer section ${s.piece ?? 'rooftops'}.`);
  const firstOrder = Math.min(section.toOrder - 5, section.fromOrder + 5);
  const p = s.action === 'finish' ? course.finish : course.steps[firstOrder][0];
  return { firstOrder, anchor: new THREE.Vector3(p.x, p.y, p.z) };
}

export const captureSmooth = (t: number): number => {
  const k = Math.max(0, Math.min(1, t));
  return k * k * (3 - 2 * k);
};

export function trailerCamera(s: Shot, t: number, context: TrailerShotContext, dragonHead?: THREE.Vector3): TrailerCamera {
  const k = t / s.duration;
  const cam = (from: CapturePoint, to: CapturePoint, target: CapturePoint, fov = 58): TrailerCamera => ({
    position: new THREE.Vector3().fromArray(from).lerp(new THREE.Vector3().fromArray(to), captureSmooth(k)),
    target: new THREE.Vector3().fromArray(target), fov,
  });
  if (s.set === 'lake') return cam([25, TITLE_SEA + 13, 25], [-12, TITLE_SEA + 22, 25], [-48, TITLE_SEA + 25, -42], 62);
  if (s.set === 'bridge') return s.action === 'scenery'
    ? cam([-28, 164, 6], [-19, 156, 60], [12, 143, 40], 64)
    : cam([13.8, 143.6, 32], [13.8, 143.1, 34.5], [12.5, 142, 40], 54);
  if (s.set === 'duel') return s.action === 'scenery'
    ? cam([49, 124, 47], [36, 115, 45], [22, 99, 22], 61)
    : cam([16, 102.2, 27], [16.5, 101.2, 18], [23, 99.2, 22], 58);
  if (s.set === 'manor') {
    if (s.action === 'scenery') return cam([44, 111, 46], [32, 104, 41], [0, 91, 0], 60);
    if (s.action === 'rescue') return cam([30.5, 82.2, 7], [29.5, 82, 6], [26.5, 81.5, 0], 62);
    return cam([1.8, 81.75, -4 - t * .65], [1.8, 81.75, -4 - t * .65], [0, 81.6, 1 - t * .3], 64);
  }
  const a = context.anchor;
  if (s.action === 'finish') return cam([a.x + 21, a.y + 10, a.z - 18], [a.x + 13, a.y + 7, a.z - 11], [a.x, a.y + 2, a.z], 62);
  if (s.action === 'dragon') {
    if (!dragonHead) throw new Error('Dragon camera requires the actual flight-model head position.');
    return cam([a.x + 15, a.y + 8, a.z + 22], [a.x + 10, a.y + 6, a.z + 21], [dragonHead.x, dragonHead.y - 1, dragonHead.z + 3], 64);
  }
  if (s.piece === 'waterfall') return cam([a.x + 33, a.y + 24, a.z - 20], [a.x + 25, a.y + 13, a.z + 15], [a.x, a.y + 3, a.z + 12], 66);
  return cam([a.x + 19, a.y + 13, a.z - 12], [a.x + 14, a.y + 6, a.z + 13], [a.x, a.y + 1, a.z + 10], 64);
}

export function trailerActorPoses(s: Shot, t: number, context: TrailerShotContext, course: ParkourCourse, generator: WorldGenerator): TrailerActorPose[] {
  const poses: TrailerActorPose[] = [];
  const add = (index: number, position: THREE.Vector3, yaw: number, time: number, gun = false, attack = 0, speed = 4) => {
    poses.push({ index, position, yaw, time, gun, attack, speed });
  };
  if (s.action === 'bridge') {
    const approach = Math.min(1, t / 2.5);
    const dist = 7 * (1 - approach) + .9;
    const swing = t > 2 ? Math.max(.1, Math.sin(t * 8)) : .15;
    add(0, new THREE.Vector3(12.5, 141.01, 40 - dist), Math.PI, t, false, swing);
    add(1, new THREE.Vector3(12.5, 141.01, 40 + dist), 0, t + .6, false, swing);
  } else if (s.action === 'duel') {
    for (let i = 0; i < 2; i++) {
      const orbitX = 21 + Math.sin(t * 1.1 + i * Math.PI) * 3;
      // Blue skirts the arena-facing side of the authored [18,19] pillar.
      // Keep the original orbit elsewhere; 0.30 body radius + 0.01 clearance
      // avoids the old shoulder penetration and climb onto the pillar top.
      const x = i === 1 ? Math.max(19.31, orbitX) : orbitX;
      const z = 21 + (i ? -3 : 3) + Math.cos(t * .9) * .7;
      add(i, new THREE.Vector3(x, captureGround(generator, x, z, 110, 96, .01, 97.01), z), i ? Math.PI : 0, t + i, true);
    }
  } else if (s.action === 'run' || s.action === 'dragon') {
    for (let i = 0; i < 3; i++) {
      const progress = Math.max(0, t * 1.35 - i * .7);
      const order = context.firstOrder + Math.floor(progress);
      const a = course.steps[Math.min(order, course.steps.length - 2)][0];
      const b = course.steps[Math.min(order + 1, course.steps.length - 1)][0];
      const k = progress % 1;
      const at = parkourStandSpot(course, a), bt = parkourStandSpot(course, b);
      const from = new THREE.Vector3(at.x, at.y, at.z), to = new THREE.Vector3(bt.x, bt.y, bt.z);
      const p = from.clone().lerp(to, k);
      p.y += 4 * 1.25 * k * (1 - k);
      add(i, p, Math.atan2(-(to.x - from.x), -(to.z - from.z)), t + i, false, 0, 5.6);
    }
  } else if (s.action === 'finish') {
    course.podium.forEach((p, i) => add(i, new THREE.Vector3(p.x, p.y, p.z), 0, t + i, false, .5 + Math.sin(t * 3) * .3, 0));
  } else if (s.action === 'rats') {
    add(0, new THREE.Vector3(-.2, 81, 5.5 - t * .8), 0, t, false, 0, 4);
  }
  return poses;
}

export function trailerRatPoses(s: Shot, t: number, freed = t > .85): TrailerRatPose[] {
  if (s.action === 'rats') return [0, 1].map(i => ({ position: [i ? -.8 : .4, 81, 1.5 - t * .8 + i * 1.8], yaw: 0, speed: 5, phase: t * 7 + i, caged: false }));
  if (s.action === 'rescue') return [0, 1, 2].map(i => ({
    // The captive stays inside the cage until teleporting out. Its freed lane
    // is 0.30 left of the old lane, outside the cage wall's x=27 column.
    position: [i === 2 && !freed ? 29.5 : 25.5 + i * .8 - (i === 2 ? .3 : 0), 81, i === 2 && !freed ? 0 : 2 - t],
    yaw: .5, speed: freed ? 4 : 0, phase: t * 8 + i, caged: i === 2 && !freed,
  }));
  return [];
}

export function trailerDragonCue(t: number, firstOrder: number): { front: number; speed: number; now: number } {
  return { front: firstOrder - 3 + t * 1.2, speed: 1.2, now: 23000 + t * 1000 };
}
