// How every ranged item leaves the hand, shared by the server sim (which spawns
// the real projectile), the client (which shows its own shot at once, before
// the server's copy arrives) and the bots (which aim with it).
//
// Each item gets a launch speed (blocks/tick), a small upward lift above the
// crosshair so the arc lands near where you aimed at typical fighting range,
// and an optional use cooldown (ticks).

import type { EntityKind } from './entity';

export interface Launch { kind: EntityKind; speed: number; lift: number; cooldown: number }

const DEG = Math.PI / 180;

/** Thrown items, by item key. */
export const THROWN: Record<string, Launch> = {
  snowball: { kind: 'snowball', speed: 1.75, lift: 3 * DEG, cooldown: 4 },
  egg: { kind: 'egg', speed: 1.75, lift: 3 * DEG, cooldown: 4 },
  ender_pearl: { kind: 'ender_pearl', speed: 1.7, lift: 4 * DEG, cooldown: 20 },
  wind_charge: { kind: 'wind_charge', speed: 1.5, lift: 0, cooldown: 10 },
  splash_potion: { kind: 'potion', speed: .8, lift: 14 * DEG, cooldown: 6 },
  lingering_potion: { kind: 'potion', speed: .8, lift: 14 * DEG, cooldown: 6 },
};
/** Bow arrows: speed scales with draw power. */
export const BOW = { speed: 3, lift: 1.5 * DEG };
export const CROSSBOW = { speed: 3.15, lift: 1 * DEG, rocketSpeed: 1.6, charge: (quick: number) => 25 - 5 * quick };
export const TRIDENT = { speed: 2.5, lift: 2 * DEG, minTicks: 10 };
/** Shown after a shot so the next draw has a visible beat. */
export const BOW_RECOVER_TICKS = 4;

/** Unit direction for a yaw/pitch, raised by `lift` radians (pitch is + up). */
export function aimDir(yaw: number, pitch: number, lift = 0): { x: number; y: number; z: number } {
  const p = Math.min(Math.PI / 2 - .01, pitch + lift * Math.cos(pitch));
  return { x: -Math.sin(yaw) * Math.cos(p), y: Math.sin(p), z: -Math.cos(yaw) * Math.cos(p) };
}
/** Where a projectile appears for an eye position and unit direction. */
export function launchPoint(eye: { x: number; y: number; z: number }, dir: { x: number; y: number; z: number }): { x: number; y: number; z: number } {
  return { x: eye.x + dir.x * .3, y: eye.y + dir.y * .3 - .1, z: eye.z + dir.z * .3 };
}
