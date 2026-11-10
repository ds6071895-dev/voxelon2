// Shared release-stage types and pure helpers, used by both staging modules,
// the renderer and the geometry audit. No DOM or WebGL here.
import * as THREE from 'three';
import type { CapeTier } from './cape';

export type V3 = [number, number, number];
export interface TrailerShotContext { firstOrder: number; anchor: THREE.Vector3 }
export interface TrailerCamera {
  position: THREE.Vector3; target: THREE.Vector3; fov: number; roll?: number;
  /** First frame of a hard cut inside a shot: the camera jumps, it does not travel. */
  cut?: boolean;
}

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
  /** A cape on the shoulders, and how hard the wind blows it (0..1). */
  cape?: CapeTier;
  wind?: number;
}
export interface RatPose { pos: V3; yaw: number; speed: number; phase: number; caged: boolean; cheese?: boolean }
export interface CatPose { pos: V3; yaw: number; speed: number; sit: boolean }
export interface DropPose { item: number; pos: V3; scale: number }
export interface ProjectilePose { pos: V3; dir: V3; kind: 'arrow' | 'tracer' }
/** A Disaster City zombie. `dying` counts seconds since the killing blow. */
export interface ZombiePose { pos: V3; yaw: number; speed: number; phase: number; dying?: number; swingAgo?: number }
/** A falling meteor: a glowing magma lump with a fire-and-smoke trail. */
export interface MeteorPose { pos: V3; dir: V3; size: number }
/** Floating score text, `k` 0..1 through its life. */
export interface PopupPose { pos: V3; text: string; color: string; k: number }
export interface StageFrame {
  camera: TrailerCamera;
  actors: ActorPose[];
  rats: RatPose[];
  cat?: CatPose;
  drops: DropPose[];
  projectiles: ProjectilePose[];
  zombies: ZombiePose[];
  meteors: MeteorPose[];
  popups: PopupPose[];
  /** Camera shake amplitude (blocks). */
  shake: number;
  /** Duel muzzle flashes: slot numbers firing this frame. */
  flashes: number[];
  /** Full-screen lightning flash, 0..1. */
  flash: number;
}
/** A one-shot particle effect, fired the first time the shot clock passes `at`. */
export interface StageEvent {
  at: number;
  kind: 'debris' | 'ring' | 'burst' | 'death' | 'poof' | 'heal' | 'firework' | 'smoke' | 'blast' | 'sparkle';
  pos: V3;
  color: number;
}
/** Blocks that appear (or, with `block` = Air, vanish) during a shot. */
export type StageEdit = [x: number, y: number, z: number, block: number, at: number];

export const captureSmooth = (t: number): number => {
  const k = Math.max(0, Math.min(1, t));
  return k * k * (3 - 2 * k);
};
export const sm = captureSmooth;
export const lerp = (a: number, b: number, k: number): number => a + (b - a) * k;
export const mix3 = (a: V3, b: V3, k: number): V3 => [lerp(a[0], b[0], k), lerp(a[1], b[1], k), lerp(a[2], b[2], k)];
/** Heading that faces `to` from `from` (Worlds' forward is -z). */
export const face = (from: V3, to: V3): number => Math.atan2(-(to[0] - from[0]), -(to[2] - from[2]));
export const vec = (p: V3): THREE.Vector3 => new THREE.Vector3(p[0], p[1], p[2]);
export const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));
/** Stand-in for an avatar's stride phase: advances with distance walked. */
export const stridePhase = (t: number, speed: number): number => t * (4 + speed * 1.25);
/** A swing curve: 0 at rest, peaking at 1, for each start time in `times`. */
export const swingOf = (t: number, times: readonly number[], length = .3): number =>
  times.reduce((m, c) => Math.max(m, t >= c && t < c + length ? Math.sin((t - c) / length * Math.PI) : 0), 0);

export const camOf = (from: V3, to: V3, target: V3, fov: number, k: number, extra: Partial<TrailerCamera> = {}): TrailerCamera =>
  ({ position: vec(mix3(from, to, sm(k))), target: vec(target), fov, ...extra });

export const emptyFrame = (camera: TrailerCamera): StageFrame =>
  ({ camera, actors: [], rats: [], drops: [], projectiles: [], zombies: [], meteors: [], popups: [], shake: 0, flashes: [], flash: 0 });

/** Cells of a 4-connected grid line from a (exclusive) to b (inclusive): a
 *  bridge you can actually walk along, never touching only at a corner. */
export function gridLine(ax: number, az: number, bx: number, bz: number): [number, number][] {
  const out: [number, number][] = [];
  let x = ax, z = az;
  const dx = bx - ax, dz = bz - az;
  while (x !== bx || z !== bz) {
    const tx = x + Math.sign(bx - x), tz = z + Math.sign(bz - z);
    const errX = Math.abs((tx - ax) * dz - (z - az) * dx), errZ = Math.abs((x - ax) * dz - (tz - az) * dx);
    if (x !== bx && (z === bz || errX <= errZ)) x = tx; else z = tz;
    out.push([x, z]);
  }
  return out;
}
