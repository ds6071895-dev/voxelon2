// Release-stage motion: consumed by the renderer AND the geometry audit. Every
// shot is a pure function of time, so a frame is reproducible. This module is
// safe to evaluate without a DOM, WebGL context or live session.
import * as THREE from 'three';
import { TITLE_SEA } from '../title_terrain';
import { parkourStandSpot, type ParkourCourse } from '../parkour_course';
import type { WorldGenerator } from '../multiverse';
import { chooseCaptureCourse } from '../media/course';
import { captureGround } from '../media/offline';
import { Item } from '../items';
import { Block } from '../blocks';
import type { Shot } from './shots';

export type V3 = [number, number, number];
export interface TrailerShotContext { firstOrder: number; anchor: THREE.Vector3 }
export interface TrailerCamera { position: THREE.Vector3; target: THREE.Vector3; fov: number; roll?: number }

/** One avatar. Slots keep a character's look from shot to shot. */
export interface ActorPose {
  slot: number;
  pos: V3;
  yaw: number;
  item: number;
  walk: number;
  speed: number;
  attack?: number;
  pitch?: number;
  aim?: number;
  kick?: number;
  bow?: number;
  /** Extra body rotation about x and z (a knock-back tumble). */
  tilt?: V3;
  /** 0..1: both arms thrown up. */
  cheer?: number;
  visible?: boolean;
}
export interface RatPose { pos: V3; yaw: number; speed: number; phase: number; caged: boolean; cheese?: boolean }
export interface CatPose { pos: V3; yaw: number; speed: number; sit: boolean }
export interface DropPose { item: number; pos: V3; scale: number }
export interface ProjectilePose { pos: V3; dir: V3; kind: 'arrow' | 'tracer' }
export interface StageFrame {
  camera: TrailerCamera;
  actors: ActorPose[];
  rats: RatPose[];
  cat?: CatPose;
  drops: DropPose[];
  projectiles: ProjectilePose[];
  /** Camera shake amplitude (blocks). */
  shake: number;
  /** Duel muzzle flashes: slot numbers firing this frame. */
  flashes: number[];
}
/** A one-shot particle effect, fired the first time the shot clock passes `at`. */
export interface StageEvent { at: number; kind: 'debris' | 'ring' | 'burst' | 'death' | 'poof' | 'heal'; pos: V3; color: number }
/** Blocks that appear (or, with `block` = Air, vanish) during a shot. */
export type StageEdit = [x: number, y: number, z: number, block: number, at: number];

export const createTrailerCourse = () => chooseCaptureCourse(['rooftops', 'waterfall']);

export function trailerShotContext(s: Shot, course: ParkourCourse): TrailerShotContext {
  const section = course.sections.find(p => p.piece === (s.piece ?? 'rooftops'));
  if (!section) throw new Error(`Missing trailer section ${s.piece ?? 'rooftops'}.`);
  const firstOrder = Math.min(section.toOrder - 5, section.fromOrder + 5);
  const p = s.action === 'pk-finish' ? course.finish : course.steps[firstOrder][0];
  return { firstOrder, anchor: new THREE.Vector3(p.x, p.y, p.z) };
}

export const captureSmooth = (t: number): number => {
  const k = Math.max(0, Math.min(1, t));
  return k * k * (3 - 2 * k);
};
const sm = captureSmooth;
const lerp = (a: number, b: number, k: number): number => a + (b - a) * k;
const mix3 = (a: V3, b: V3, k: number): V3 => [lerp(a[0], b[0], k), lerp(a[1], b[1], k), lerp(a[2], b[2], k)];
/** Heading that faces `to` from `from` (Worlds' forward is -z). */
const face = (from: V3, to: V3): number => Math.atan2(-(to[0] - from[0]), -(to[2] - from[2]));
const vec = (p: V3): THREE.Vector3 => new THREE.Vector3(p[0], p[1], p[2]);
const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));

/** Stand-in for an avatar's stride phase: advances with distance walked. */
const stridePhase = (t: number, speed: number): number => t * (4 + speed * 1.25);

export function trailerEdits(_s: Shot): StageEdit[] { return []; }

export function trailerEvents(s: Shot): StageEvent[] {
  const events: StageEvent[] = [];
  if (s.action === 'br-goal') events.push({ at: 3.0, kind: 'ring', pos: [12.5, 141.2, 7.5], color: 0xffe08a }, { at: 3.0, kind: 'burst', pos: [12.5, 141.6, 7.5], color: 0xfff1b8 });
  if (s.action === 'du-fight') events.push({ at: 5.5, kind: 'death', pos: [24.2, 99.4, 20.6], color: 0x2f6fe0 });
  if (s.action === 'rs-rescue') events.push({ at: 1.0, kind: 'burst', pos: [29.5, 82.3, 0], color: 0xfff1b8 });
  if (s.action === 'br-duel') events.push({ at: 1.5, kind: 'burst', pos: [12.5, 142.5, 52.0], color: 0xffffff }, { at: 3.0, kind: 'burst', pos: [12.5, 142.5, 50.2], color: 0xffffff });
  return events;
}

interface Env {
  generator: WorldGenerator;
  course: ParkourCourse;
  context: TrailerShotContext;
  dragonHead?: THREE.Vector3;
}

const camOf = (from: V3, to: V3, target: V3, fov: number, k: number, extra: Partial<TrailerCamera> = {}): TrailerCamera =>
  ({ position: vec(mix3(from, to, sm(k))), target: vec(target), fov, ...extra });

const emptyFrame = (camera: TrailerCamera): StageFrame =>
  ({ camera, actors: [], rats: [], drops: [], projectiles: [], shake: 0, flashes: [] });

/** The duel arena positions, shared by the camera and the audit. */
const DUEL_A: V3 = [20.0, 0, 23.5], DUEL_B: V3 = [23.9, 0, 20.5];

export function trailerFrame(s: Shot, t: number, env: Env): StageFrame {
  const k = t / s.duration;
  const a = env.context.anchor;
  switch (s.action) {
    case 'lake': {
      const f = emptyFrame(camOf([12, TITLE_SEA + 13, 27], [-8, TITLE_SEA + 18, 25], [-48, TITLE_SEA + 25, -42], 62, k));
      return f;
    }
    case 'logo': {
      return emptyFrame(camOf([8, TITLE_SEA + 14, 22], [-4, TITLE_SEA + 17, 22], [-48, TITLE_SEA + 24, -42], 60, k));
    }
    case 'reel': {
      return emptyFrame(camOf([-6, TITLE_SEA + 18, 25], [-14, TITLE_SEA + 21, 26], [-48, TITLE_SEA + 25, -42], 62, k));
    }

    // ── The Bridge ───────────────────────────────────────────────────────
    case 'br-arena': {
      const f = emptyFrame(camOf([-26, 160, 8], [-17, 153, 58], [12, 143, 38], 64, k));
      const r1 = 20.3 + 4.6 * t, r2 = 60.2 - 4.6 * t;
      f.actors.push({ slot: 0, pos: [12.5, 141.01, r1], yaw: Math.PI, item: Item.IronSword, walk: stridePhase(t, 5), speed: 5 });
      f.actors.push({ slot: 1, pos: [12.5, 141.01, r2], yaw: 0, item: Block.TeamWoolB, walk: stridePhase(t, 5) + 1, speed: 5 });
      return f;
    }
    case 'br-duel': {
      // The open span between the middle island and the cobalt base: nothing but void on both sides.
      const zc = 51.4;
      const f = emptyFrame(camOf([17.6, 142.8, zc - 5.2], [16.6, 143.0, zc - 2.6], [12.5, 142.4, zc + .2], 50, k));
      const swingOf = (times: number[]): number => times.reduce((m, c) => Math.max(m, t >= c && t < c + .3 ? Math.sin((t - c) / .3 * Math.PI) : 0), 0);
      const hitK = (c: number): number => t >= c ? Math.exp(-(t - c) * 7) : 0;
      const approach = sm(t / .6);
      const red: V3 = [12.5, 141.01, lerp(zc - 4.6, zc - 1.3, approach) - hitK(1.5) * .35];
      const blueZ = t < 2.0 ? lerp(zc + 4.6, zc + 1.2, approach) + hitK(.8) * .35 + hitK(1.5) * .5 : zc + 1.2 + sm((t - 2.0) / .5) * 2.8;
      f.actors.push({ slot: 0, pos: red, yaw: Math.PI, item: Item.IronSword, walk: stridePhase(t, 2), speed: t < .6 ? 3 : 1.5, attack: swingOf([.6, 1.3]) });
      const drawing = t >= 2.0 && t < 2.7;
      f.actors.push({ slot: 1, pos: [12.5, 141.01, blueZ], yaw: 0, item: t < 1.95 ? Item.StoneSword : Item.BridgeBow, walk: stridePhase(t, 2), speed: t < .6 ? 3 : 0,
        attack: t < 1.95 ? swingOf([.8, 1.5]) : 0, bow: drawing ? clamp01((t - 2.0) / .7) : t >= 2.7 && t < 2.85 ? 1 - (t - 2.7) / .15 : 0, aim: 1 });
      if (t >= 2.7 && t < 3.05) {
        const u = (t - 2.7) / .35;
        f.projectiles.push({ pos: [12.5, 142.5, lerp(zc + 4.2, zc - 1.0, u)], dir: [0, 0, -1], kind: 'arrow' });
      }
      if (t >= 3.0) {
        const u = t - 3.0;
        f.actors[0] = { ...f.actors[0], pos: [12.5 + .6 * u, 141.01 + 3.5 * u - 14 * u * u, red[2] - 2.2 * u], tilt: [u * 3, 0, u * 2], speed: 0 };
      }
      return f;
    }
    case 'br-goal': {
      const z = Math.max(8, 26 - 6.2 * t);
      const pos: V3 = [12.5, 141.01, z];
      const zr = Math.max(z, 8);
      const f = emptyFrame({ position: vec([12.5, 142.75, zr + lerp(5.8, 4.4, sm(k))]), target: vec([12.5, 141.9 + (t > 3 ? -.7 : 0), Math.max(zr - 3.6, 4.8)]), fov: 58 });
      if (t < 3.0) {
        f.actors.push({ slot: 1, pos, yaw: 0, item: Block.TeamWoolB, walk: stridePhase(t, 6.2) * 1.2, speed: 6.2 });
      } else {
        const u = t - 3.0, y = 141.01 + (u < .2 ? 2.2 * u : 0) - Math.max(0, u - .2) * 6;
        f.actors.push({ slot: 1, pos: [12.5, y, 8 - Math.min(u, .4) * 3], yaw: 0, item: Block.TeamWoolB, walk: stridePhase(t, 6.2), speed: 0, tilt: [-u * 1.2, 0, 0] });
      }
      return f;
    }

    // ── Duels ────────────────────────────────────────────────────────────
    case 'du-arena': {
      const f = emptyFrame(camOf([46, 121, 46], [34, 113, 45], [22, 99, 22], 60, k));
      for (let i = 0; i < 2; i++) {
        const x = 21 + Math.sin(t * 1.1 + i * Math.PI) * 3, zz = 21 + (i ? -3 : 3) + Math.cos(t * .9) * .7, xx = i === 1 ? Math.max(19.31, x) : x;
        const y = captureGround(env.generator, xx, zz, 110, 96, .01, 97.01);
        f.actors.push({ slot: i, pos: [xx, y, zz], yaw: i ? Math.PI : 0, item: Item.BurstRifle, walk: stridePhase(t + i, 2.5), speed: 2.5, aim: .5, pitch: 0 });
      }
      return f;
    }
    case 'du-fight': {
      const ay = captureGround(env.generator, DUEL_A[0], DUEL_A[2], 110, 96, .01, 97.01), by = captureGround(env.generator, DUEL_B[0], DUEL_B[2], 110, 96, .01, 97.01);
      const sway = (p: V3, i: number): V3 => [p[0] + Math.sin(t * 1.3 + i * 2) * .4, i ? by : ay, p[2] + Math.cos(t * 1.1 + i) * .35];
      const aP = sway(DUEL_A, 0);
      let bP = sway(DUEL_B, 1);
      const ang = lerp(.5, .05, sm(k));
      const mid: V3 = [22.1, ay + 1.15, 22];
      const f = emptyFrame({ position: vec([mid[0] + Math.sin(ang) * 5.1, mid[1] + .7 + Math.sin(k * 3) * .1, mid[2] + Math.cos(ang) * 5.1]), target: vec(mid), fov: 52 });
      const bursts = (times: number[]): number => times.reduce((m, c) => Math.max(m, t >= c && t < c + .06 ? 1 : 0), 0);
      const redShots = [.9, 1.1, 1.3, 3.6, 3.8, 4.0, 4.9, 5.1, 5.3], blueShots = [2.2, 2.4, 2.6];
      const kickOf = (times: number[]): number => times.reduce((m, c) => Math.max(m, t >= c ? Math.exp(-(t - c) * 14) : 0), 0);
      let bTilt: V3 | undefined;
      if (t >= 5.5) {
        const u = t - 5.5;
        bP = [bP[0] + 1.6 * u, bP[1] - u * 1.2 + (u < .25 ? u * 1.5 : 0), bP[2] - 1.4 * u];
        bTilt = [-1.4 * u * 2, 0, .8 * u * 2];
      }
      f.actors.push({ slot: 0, pos: aP, yaw: face(aP, bP), item: Item.BurstRifle, walk: stridePhase(t, 2.5), speed: 2.5, aim: .6, kick: kickOf(redShots) * .4 });
      f.actors.push({ slot: 1, pos: bP, yaw: face(bP, aP), item: Item.BurstRifle, walk: stridePhase(t, 2.5) + 2, speed: t >= 5.5 ? 0 : 2.5, aim: .6, kick: kickOf(blueShots) * .4, tilt: bTilt });
      if (bursts(redShots)) f.flashes.push(0);
      if (bursts(blueShots)) f.flashes.push(1);
      for (const [shots, from, to] of [[redShots, aP, bP], [blueShots, bP, aP]] as const) {
        const hit = shots.find(c => t >= c && t < c + .08);
        if (hit !== undefined) f.projectiles.push({ pos: [from[0], from[1] + 1.25, from[2]], dir: [to[0] - from[0], 0, to[2] - from[2]], kind: 'tracer' });
      }
      return f;
    }

    // ── Parkour (Dragon Chase) ───────────────────────────────────────────
    case 'pk-run':
    case 'pk-dragon': {
      const runners = parkourRunners(t, env);
      const lead = runners[0], dir = lead.dir;
      const f = emptyFrame(runCamera(s, t, k, runners, env));
      void dir;
      f.actors = runners.map(r => r.pose);
      return f;
    }
    case 'pk-finish': {
      const f = emptyFrame(camOf([a.x + 1.8, a.y + 2.1, a.z - 5.0], [a.x + .6, a.y + 1.9, a.z - 3.8], [a.x, a.y + 1.7, a.z], 56, k));
      env.course.podium.forEach((p, i) => {
        const arrive = clamp01((t - i * .3) / .9), cheer = sm((t - 1.3 - i * .25) / .5);
        const start: V3 = [p.x, p.y - 1.0, p.z - 3.0];
        const pos = mix3(start, [p.x, p.y, p.z], sm(arrive));
        pos[1] += Math.sin(Math.PI * arrive) * 1.1;
        const bounce = cheer > .9 ? Math.abs(Math.sin((t - 1.9 - i * .25) * 6.5)) * .14 : 0;
        f.actors.push({ slot: [0, 1, 2][i] ?? i, pos: [pos[0], pos[1] + bounce, pos[2]], yaw: arrive < 1 ? face(start, [p.x, p.y, p.z]) : 0, item: 0, walk: stridePhase(t, 5.2) * 1.2 + i, speed: arrive < 1 ? 5.2 : 0, cheer });
      });
      return f;
    }

    // ── Rat and Seek ─────────────────────────────────────────────────────
    case 'rs-manor': {
      const f = emptyFrame(camOf([9.6, 83.6, 33.2], [3.4, 82.0, 27.2], [1.2, 81.5, 20.8], 54, k));
      const run = Math.max(0, t - .6);
      [[-.4, 23.4], [1.3, 24.4], [2.5, 22.8]].forEach(([x, z], i) => {
        const zz = z - 3.1 * run - (i === 1 ? .6 * run : 0), moving = zz > 14.2;
        f.rats.push({ pos: [x - (i - 1) * .12 * run, 81, Math.max(zz, 14.2)], yaw: Math.PI + (i - 1) * .12, speed: moving ? 5 : 0, phase: t * 8 + i * 2.1, caged: false, cheese: i === 0 });
      });
      f.cat = { pos: [-2.6, 81, 19.5], yaw: 2.6, speed: 0, sit: true };
      const seeker: V3 = [1.5, 81, 14.5];
      f.actors.push({ slot: 5, pos: seeker, yaw: face(seeker, [1, 81, 24]) + Math.sin(t * .9) * .25, item: Item.RatCatcher, walk: 0, speed: 0 });
      return f;
    }
    case 'rs-chase': {
      // The camera waits low in the hall; the rats stream past it with the seeker close behind.
      const f = emptyFrame({ position: vec([1.5 + Math.sin(t * .5) * .15, 81.65, -1.4]), target: vec([-.1, 81.45, 3.6 - t * .55]), fov: 66 });
      [0, 1].forEach(i => f.rats.push({ pos: [i ? -1.0 : .7, 81, 7.2 - 4.4 * t + i * 1.5], yaw: 0, speed: 5.5, phase: t * 9 + i, caged: false, cheese: i === 0 }));
      f.rats.push({ pos: [-.1 + Math.sin(t * 2) * .25, 81, 9.4 - 4.4 * t], yaw: 0, speed: 5.5, phase: t * 9 + 3, caged: false });
      const seeker: V3 = [-.55, 81, 13.2 - 4.0 * t];
      f.actors.push({ slot: 5, pos: seeker, yaw: 0, item: Item.RatCatcher, walk: stridePhase(t, 5.5) * 1.3, speed: 5.5, attack: t > 1.4 ? Math.max(0, Math.sin((t - 1.4) * 6)) * .6 : 0 });
      f.cat = { pos: [-1.7, 81, 15.4 - 4.2 * t], yaw: Math.PI, speed: 5, sit: false };
      return f;
    }
    case 'rs-rescue': {
      // Seen from outside the cage: friends reach it, it opens, and the captive bolts out.
      const f = emptyFrame(camOf([23.7, 82.55, 7.6], [24.1, 82.45, 6.8], [26.9, 81.5, .8], 60, k));
      const freed = t > 1.0;
      for (let i = 0; i < 3; i++) {
        if (freed && (i !== 2 || t > 1.2)) {
          // Free at last: all three dart in happy circles outside the cage.
          const w = 2.5, ang = (t - 1.0) * w + i * 2.1, r = .8;
          const vx = -Math.sin(ang) * r * w, vz = Math.cos(ang) * r * w;
          f.rats.push({ pos: [25.9 + Math.cos(ang) * r, 81, 1.9 + Math.sin(ang) * r], yaw: Math.atan2(-vx, -vz), speed: 5, phase: t * 9 + i, caged: false });
        } else if (i === 2) f.rats.push({ pos: [29.5, 81, 0], yaw: .6, speed: 0, phase: t * 9 + i, caged: !freed });
        else {
          const arrive = clamp01(t / 1.0);
          f.rats.push({ pos: [lerp(24.4, 25.5, arrive) + i * .6, 81, lerp(4.2, 1.7, arrive) - i * .5], yaw: -2.5, speed: arrive < 1 ? 4.5 : 0, phase: t * 9 + i, caged: false });
        }
      }
      return f;
    }
  }
}

// ── Parkour helpers ─────────────────────────────────────────────────────────
interface Runner { pose: ActorPose; dir: V3; pos: V3 }

function parkourRunners(t: number, env: Env): Runner[] {
  const { course, context } = env;
  const out: Runner[] = [];
  for (let i = 0; i < 3; i++) {
    const progress = Math.max(0, t * 1.35 - i * .7);
    const order = context.firstOrder + Math.floor(progress);
    const a = course.steps[Math.min(order, course.steps.length - 2)][0];
    const b = course.steps[Math.min(order + 1, course.steps.length - 1)][0];
    const k = progress % 1;
    const at = parkourStandSpot(course, a), bt = parkourStandSpot(course, b);
    const from: V3 = [at.x, at.y, at.z], to: V3 = [bt.x, bt.y, bt.z];
    const p = mix3(from, to, k);
    p[1] += 4 * 1.25 * k * (1 - k);
    const dir: V3 = [to[0] - from[0], 0, to[2] - from[2]];
    out.push({ pose: { slot: i, pos: p, yaw: face(from, to), item: 0, walk: stridePhase(t + i, 5.6) * 1.1, speed: 5.6 }, dir, pos: p });
  }
  return out;
}

function runCamera(s: Shot, t: number, k: number, runners: Runner[], env: Env): TrailerCamera {
  const lead = runners[0], mid = vec(runners[1].pos);
  // The runners come toward the camera with the dragon behind them: the camera
  // sits ahead of the pack and a little to the side, on the course line.
  const norm = new THREE.Vector3(lead.dir[0], 0, lead.dir[2]).normalize();
  const ahead = vec(lead.pos).addScaledVector(norm, s.action === 'pk-dragon' ? 6.8 : 6.4);
  const side = new THREE.Vector3(-norm.z, 0, norm.x).multiplyScalar(s.action === 'pk-dragon' ? 2.2 : 2.7);
  const position = ahead.add(side).add(new THREE.Vector3(0, s.action === 'pk-dragon' ? 3.2 : 2.4, 0));
  const target = s.action === 'pk-dragon' && env.dragonHead
    ? mid.clone().lerp(env.dragonHead, .4).add(new THREE.Vector3(0, 1.4, 0))
    : mid.clone().addScaledVector(norm, -1.5).add(new THREE.Vector3(0, 1.4, 0));
  void t; void k;
  return { position, target, fov: s.action === 'pk-dragon' ? 62 : 58 };
}

/** Dragon schedule for the parkour shots (shared with the audit). */
export function trailerDragonCue(t: number, firstOrder: number): { front: number; speed: number; now: number } {
  return { front: firstOrder - 3 + t * 1.2, speed: 1.2, now: 23000 + t * 1000 };
}
