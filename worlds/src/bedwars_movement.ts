// Elapsed-time movement credit. Packets consume a shared budget; sending more
// packets cannot create distance or a second jump. Positions remain client-
// predicted, with a generous ballistic ceiling for network/frame jitter.
import { collisionBoxes } from './blocks';
import type { BwPos } from './bedwars_rules';

export interface BwMotion {
  at: number; horizontal: number; upward: number; vertical: number;
  airAt: number | null; launchY: number; launchV: number;
  extraSpeed: number; impulseUntil: number; safe: BwPos;
  sampleAt: number; descending: boolean;
}
// Half a second of sprinting in credit, so a bunched packet after a lag spike is
// accepted instead of rubber-banding the player.
const HORIZONTAL_CAP = 3.2, HORIZONTAL_RATE = 8.2;
const GRAVITY = 32, JUMP_V = Math.sqrt(2 * GRAVITY * 1.25), JITTER = .1;
type BlockAt = (x: number, y: number, z: number) => number;
export function bwMotion(at: number, p: BwPos): BwMotion {
  return { at, horizontal: HORIZONTAL_CAP, upward: 1.4, vertical: 4.5,
    airAt: null, launchY: p.y, launchV: 10, extraSpeed: 0, impulseUntil: 0, safe: { ...p }, sampleAt: at, descending: false };
}
export function bwSupported(p: BwPos, blockAt: BlockAt): boolean {
  const r = .29;
  for (let x = Math.floor(p.x - r); x <= Math.floor(p.x + r); x++)
    for (let z = Math.floor(p.z - r); z <= Math.floor(p.z + r); z++)
      for (let y = Math.floor(p.y - .08); y <= Math.floor(p.y); y++)
        for (const [mn, mx] of collisionBoxes(blockAt(x, y, z)) ?? []) {
          if (Math.abs(y + mx[1] - p.y) <= .08 && p.x + r > x + mn[0] && p.x - r < x + mx[0]
            && p.z + r > z + mn[2] && p.z - r < z + mx[2]) return true;
        }
  return false;
}
/** Highest actual collision-box top crossed by a downward feet sweep. */
function landingY(p: BwPos, bottom: number, top: number, blockAt: BlockAt): number | null {
  let highest = -Infinity;
  const r = .29;
  for (let x = Math.floor(p.x - r); x <= Math.floor(p.x + r); x++)
    for (let z = Math.floor(p.z - r); z <= Math.floor(p.z + r); z++)
      for (let y = Math.floor(bottom) - 1; y <= Math.floor(top); y++)
        for (const [mn, mx] of collisionBoxes(blockAt(x, y, z)) ?? []) {
          const surface = y + mx[1];
          if (surface >= bottom - .001 && surface <= top + .001 && surface > highest
            && p.x + r > x + mn[0] && p.x - r < x + mx[0]
            && p.z + r > z + mn[2] && p.z - r < z + mx[2]) highest = surface;
        }
  return highest === -Infinity ? null : highest;
}
function grounded(m: BwMotion, p: BwPos): void {
  m.airAt = null; m.launchY = p.y; m.launchV = 10; m.safe = { x: p.x, y: p.y, z: p.z }; m.descending = false;
}
function ballisticHeight(v: number, time: number): number {
  const terminalAt = (v + 78) / GRAVITY, t = Math.min(time, terminalAt);
  return v * t - GRAVITY / 2 * t * t - Math.max(0, time - terminalAt) * 78;
}
/** Max over the WHOLE jitter interval: its later endpoint on ascent, its
 * earlier endpoint on descent, or the apex when the interval straddles it. */
function ceiling(m: BwMotion, now: number): number {
  const elapsed = Math.max(0, now - m.airAt!), low = Math.max(0, elapsed - JITTER), high = elapsed + JITTER;
  const peakAt = Math.max(low, Math.min(high, m.launchV / GRAVITY));
  return m.launchY + Math.min(m.launchV * m.launchV / (2 * GRAVITY) + .65, ballisticHeight(m.launchV, peakAt) + .8);
}
/** A 30Hz transform stream can miss a landing and the next jump entirely.
 * Only infer that contact after descent, close to real geometry, with a new
 * ascent reachable by a normal jump in the intervening sample/jitter window.
 * This never rearms flight over void or for a stationary hovering sample. */
function interveningLanding(m: BwMotion, now: number, from: BwPos, to: BwPos, blockAt: BlockAt): { at: number; y: number } | null {
  if (!m.descending || m.airAt === null || now - m.airAt < .25 || to.y <= from.y + .005 || now <= m.sampleAt) return null;
  const gap = Math.min(.2, now - m.sampleAt);
  for (const ratio of [0, .5, 1]) {
    const contact = { x: from.x + (to.x - from.x) * ratio, y: from.y, z: from.z + (to.z - from.z) * ratio };
    const y = landingY(contact, Math.min(from.y, to.y) - .55, Math.min(from.y, to.y) + .01, blockAt);
    if (y === null) continue;
    const rise = to.y - y;
    if (rise < 0 || rise > 1.25) continue;
    const ascent = (JUMP_V - Math.sqrt(Math.max(0, JUMP_V * JUMP_V - 2 * GRAVITY * rise))) / GRAVITY;
    const at = now - ascent;
    if (at < m.sampleAt - JITTER || ascent > gap + JITTER) continue;
    return { at, y };
  }
  return null;
}
export function bwAuthorizeImpulse(m: BwMotion, now: number, p: BwPos, x: number, y: number, z: number): void {
  m.extraSpeed = Math.min(24, m.extraSpeed + Math.hypot(x, z)); m.impulseUntil = now + 1.1;
  m.airAt = now; m.launchY = p.y; m.launchV = Math.min(25, Math.max(10, m.launchV + Math.max(0, y)));
  m.descending = false;
}
/** Credit accrues with server time, and accepted displacement spends it.
 * `airViolation` rejects the pose; bwTickMotion enforces a downward fall at the
 * current location. It must never teleport the player back to safe ground. */
export function bwAcceptMotion(m: BwMotion, now: number, from: BwPos, to: BwPos,
  spectator: boolean, blockAt: (x: number, y: number, z: number) => number): { ok: boolean; airViolation: boolean } {
  const dt = Math.max(0, Math.min(.5, now - m.at));
  m.at = now;
  const boosted = now < m.impulseUntil;
  if (!boosted) m.extraSpeed = 0;
  m.horizontal = Math.min(HORIZONTAL_CAP + (boosted ? .8 : 0), m.horizontal + dt * (spectator ? 16 : HORIZONTAL_RATE + m.extraSpeed));
  m.upward = Math.min(1.4, m.upward + dt * (spectator ? 12 : boosted ? m.launchV + 2 : 11));
  m.vertical = Math.min(4.5, m.vertical + dt * 82);
  const horizontal = Math.hypot(to.x - from.x, to.z - from.z), dy = to.y - from.y;
  if (horizontal > m.horizontal + 1e-6 || Math.max(0, dy) > m.upward + 1e-6 || Math.abs(dy) > m.vertical + 1e-6)
    return { ok: false, airViolation: false };
  const supported = !spectator && bwSupported(to, blockAt);
  let airAt = m.airAt, launchY = m.launchY, launchV = m.launchV;
  if (!spectator && !supported) {
    if (airAt === null) { airAt = now - Math.min(dt, .05); launchY = from.y; }
    const landing = interveningLanding(m, now, from, to, blockAt);
    if (landing) { airAt = landing.at; launchY = landing.y; launchV = 10; }
    if (to.y > ceiling({ ...m, airAt, launchY, launchV }, now)) return { ok: false, airViolation: true };
    if (landing) m.descending = false;
  }
  m.horizontal -= horizontal; m.upward -= Math.max(0, dy); m.vertical -= Math.abs(dy);
  if (supported) grounded(m, to);
  else {
    m.airAt = airAt; m.launchY = launchY; m.launchV = launchV;
    if (!spectator && dy < -.005) m.descending = true;
  }
  m.sampleAt = now;
  return { ok: true, airViolation: false };
}

/** Run on server ticks, including when no transform arrives. This only lowers
 * an unsupported body exceeding its allowed trajectory, sweeping for real
 * landing surfaces. Credits/launch time are not reset by a correction. */
export function bwTickMotion(m: BwMotion, now: number, p: BwPos, blockAt: BlockAt): BwPos | null {
  if (bwSupported(p, blockAt)) { grounded(m, p); return null; }
  if (m.airAt === null) { m.airAt = now; m.launchY = p.y; }
  const y = ceiling(m, now);
  if (p.y <= y + .001) return null;
  const landed = landingY(p, y, p.y, blockAt);
  const to = { x: p.x, y: landed ?? y, z: p.z };
  m.descending = true;
  if (landed !== null) grounded(m, to);
  m.sampleAt = now;
  return to;
}
