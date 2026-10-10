// Dragon Chase decisions: lives, checkpoints, podium, and the dragon clock.
import { parkourCourse, parkourStandSpot } from './parkour_course';
import { DRAGON_GRACE_MS, DRAGON_IMMUNE_MS, DRAGON_LAIR_FRONT, DRAGON_RESPAWN_LEAD, DRAGON_SURGE, DRAGON_SURGE_GAP, dragonBaseSpeed } from './parkour_mechanics';
import { PARTY_VOID_Y } from './venue_dims';
import { parkourLiveRespawn, type ParkourBlockLookup } from './parkour_footing';
import type { PartyRoundContext, EndPartyRound } from './party_round';
import type { PartyParticipant, PartySubBounds, ParkourHurt } from './partygames';
import type { PartyVec3 } from './party_math';

export function evaluateParkour(l: PartyRoundContext, p: PartyParticipant, sub: PartySubBounds, pos: PartyVec3, now: number,
  endMatch: EndPartyRound, blockAt?: ParkourBlockLookup):
  { spawn?: PartyVec3; changed: boolean } {
  const course = parkourCourse(sub.seed), last = course.steps.length - 1;
  const respawn = (order: number): { spawn?: PartyVec3; changed: boolean } => {
    // If all live surfaces are blocked, retain the reset request. A later
    // evaluation retries it without charging another life.
    const destination = blockAt ? parkourLiveRespawn(course, order, blockAt)
      : { order, spot: parkourStandSpot(course, course.steps[order][0]) };
    if (!destination) {
      const changed = !p.pendingSpawn || p.respawnOrder !== order;
      p.pendingSpawn = true;
      p.respawnOrder = order;
      return { changed };
    }
    p.pendingSpawn = false;
    p.respawnOrder = undefined;
    p.progress = p.checkpoint = destination.order;
    p.score = Math.max(p.score, p.progress);
    p.immuneUntil = now + DRAGON_IMMUNE_MS;
    const spot = destination.spot;
    return { spawn: { x: sub.minX + spot.x, y: spot.y + .01, z: sub.minZ + spot.z }, changed: true };
  };
  /** A life gone: out of the run on the last one, otherwise back on the
   *  course — at your checkpoint, or clear ahead of the dragon if it has
   *  already passed that. */
  const lose = (cause: ParkourHurt): { spawn?: PartyVec3; changed: boolean } => {
    p.falls++;
    p.pendingSpawn = false;
    p.hurtCause = undefined;
    p.lastLife = { at: now, cause };
    if (--p.lives <= 0) {
      p.lives = 0;
      p.outAt = now;
      checkParkourEnd(l, now, endMatch);
      return { changed: true };
    }
    let back = p.checkpoint;
    const safe = Math.ceil(l.dragon?.front ?? DRAGON_LAIR_FRONT) + DRAGON_RESPAWN_LEAD;
    if (safe > back) {
      back = safe;
      for (let o = safe; o <= Math.min(last - 1, safe + 4); o++)
        if (course.steps[o]?.[0]?.checkpoint) { back = o; break; }
    }
    back = Math.max(0, Math.min(back, last - 1));
    return respawn(back);
  };
  if (p.respawnOrder !== undefined) {
    // The dragon may have moved while a restored surface was still occupied.
    const safe = Math.ceil(l.dragon?.front ?? DRAGON_LAIR_FRONT) + DRAGON_RESPAWN_LEAD;
    return respawn(Math.min(last - 1, Math.max(p.respawnOrder, safe, 0)));
  }
  if (p.pendingSpawn) return lose(p.hurtCause ?? 'fall');
  const here = course.steps[p.progress]?.[0], ahead = course.steps[p.progress + 1]?.[0];
  // Credit the surface actually reached. A runner can jump past a pad or
  // build around it; requiring every intermediate order would leave later
  // checkpoints inert for the rest of that run.
  const landed = course.platforms.find(pad => pad.order > p.progress &&
    Math.abs(pos.x - sub.minX - pad.x) < pad.width / 2 + .35 &&
    Math.abs(pos.z - sub.minZ - pad.z) < pad.depth / 2 + .35 &&
    Math.abs(pos.y - pad.y) < .35 &&
    (pad.order < last || pad.order === p.progress + 1));
  // Every jump lands on its pad, so anything well below the lower of the
  // pad you left and the pad you are heading for is off the course — the
  // street, the moat, a lap further down the tree.
  const floor = Math.min(here?.y ?? Infinity, ahead?.y ?? Infinity) - 2.5;
  if (pos.y < PARTY_VOID_Y || (pos.y < floor && !landed)) return lose('fall');
  if (landed) {
    p.progress = landed.order;
    p.score = Math.max(p.score, p.progress);
    if (landed.checkpoint) p.checkpoint = p.progress;
    if (p.progress === last) {
      // Made it: up onto the podium, safe from everything.
      p.finishedAt = now;
      p.place = [...l.participants.values()].filter((v) => v.finishedAt !== undefined).length;
      p.immuneUntil = Infinity;
      const spot = course.podium[Math.min(course.podium.length - 1, p.place - 1)];
      checkParkourEnd(l, now, endMatch);
      return { spawn: { x: sub.minX + spot.x, y: spot.y + .01, z: sub.minZ + spot.z }, changed: true };
    }
    return { changed: true };
  }
  return { changed: false };
}

/** The dragon flies on: slowly out of the lair, a little faster every
 *  second, and faster still while everyone is well clear of it. Anybody it
 *  has overtaken on the course is caught. */
export function flyDragon(l: PartyRoundContext, now: number): void {
  const d = l.dragon!, course = parkourCourse(l.arena!.seed), last = course.steps.length - 1;
  const t = now - l.round!.startedAt - DRAGON_GRACE_MS;
  const dt = Math.max(0, Math.min(.5, (now - d.at) / 1000));
  d.at = now;
  if (t < 0) { d.front = DRAGON_LAIR_FRONT; d.speed = 0; return; }
  let rear = Infinity;
  for (const p of l.participants.values())
    if (p.connected && p.outAt === undefined && p.finishedAt === undefined) rear = Math.min(rear, p.progress);
  const base = dragonBaseSpeed(t / 1000);
  d.speed = Number.isFinite(rear) && rear - d.front > DRAGON_SURGE_GAP ? base * DRAGON_SURGE : base;
  // It never follows anybody into the sanctuary.
  d.front = Math.min(last - .6, d.front + d.speed * dt);
  for (const p of l.participants.values()) {
    if (!p.connected || p.outAt !== undefined || p.finishedAt !== undefined || p.pendingSpawn || now < p.immuneUntil) continue;
    if (d.front >= p.progress + .6) { p.pendingSpawn = true; p.hurtCause = 'dragon'; }
  }
}

/** A Dragon Chase ends when nobody is left running. */
export function checkParkourEnd(l: PartyRoundContext, now: number, endMatch: EndPartyRound): void {
  if (l.phase !== 'running') return;
  const running = [...l.participants.values()].some((v) => v.connected && v.outAt === undefined && v.finishedAt === undefined);
  if (!running) endMatch(now);
}
