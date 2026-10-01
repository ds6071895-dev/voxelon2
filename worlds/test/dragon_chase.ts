// Dragon Chase: the courses, the builds round them, and the rules.
//
// Courses: every seed makes a whole course out of several set pieces, inside
// the venue, and every one of its jumps is FLOWN with the real Player class
// against the finished venue — scenery included — from some honest take-off.
// The scenery rule (parkour_setpieces.ts) is checked cell by cell: nothing in
// or beside a jump, and no stray ledge within reach of the route.
//
// Rules: lives, respawning ahead of the dragon, the dragon's jaws, finishing
// onto the podium, the match running on until nobody is left running, the
// result, and a runner who made it leaving without anybody being told.

import { Player } from '../src/player';
import { Block, BLOCKS } from '../src/blocks';
import { FROZEN_INPUT, type PlayerInput } from '../src/input';
import type { World } from '../src/world';
import { PartyGamesEngine, PARTY_COUNTDOWN_MS, partySpawns } from '../src/partygames';
import {
  PARKOUR_VENUE_X, PARKOUR_VENUE_Z, SET_PIECES, encodeParkourSeed, parkourCourse, parkourLength, parkourStandSpot,
  type ParkourCourse, type ParkourPlatform, type SetPieceId,
} from '../src/parkour_course';
import { parkourVenue, type ParkourVenue } from '../src/parkour_setpieces';
import {
  DRAGON_GRACE_MS, DRAGON_LIVES, DRAGON_RESPAWN_LEAD, parkourPadImpulse, parkourPadUnder,
} from '../src/parkour_mechanics';
import { PARKOUR_THEMES } from '../src/parkour_themes';

type Check = (name: string, ok: boolean, detail?: string) => void;

const RUN: PlayerInput = { ...FROZEN_INPUT, forward: true, jump: true, sprintKey: true, sprintHeld: true };
const SPEEDS = [5.612, 4.317, 3.2, 2.3];
const OFFSETS = [0, .5, 1, 1.5];

export function venueWorld(v: ParkourVenue): World {
  return { isLoaded: () => true, getBlock: (x: number, y: number, z: number) => v.get(Math.floor(x), Math.floor(y), Math.floor(z)) } as unknown as World;
}
function onPad(p: Player, b: ParkourPlatform): boolean {
  const left = Math.floor(b.x - b.width / 2), front = Math.floor(b.z - b.depth / 2);
  return Math.abs(p.pos.y - b.y) < .01 && p.pos.x + .3 > left && p.pos.x - .3 < left + b.width &&
    p.pos.z + .3 > front && p.pos.z - .3 < front + b.depth;
}
/** One attempt at the jump a → b; true if it lands on b. */
export function fly(c: ParkourCourse, world: World, a: ParkourPlatform, b: ParkourPlatform, back: number, speed: number, line: number): boolean {
  const h = b.heading, alongX = h % 2 === 1, s = h < 2 ? 1 : -1;
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
  const aAlong = alongX ? a.x : a.z, aLat = alongX ? a.z : a.x, bAlong = alongX ? b.x : b.z, bLat = alongX ? b.z : b.x;
  const eA = alongX ? a.width : a.depth, lA = alongX ? a.depth : a.width, lB = alongX ? b.depth : b.width;
  const lip = Math.max(-(eA / 2 - .35), eA / 2 - .35 - back);
  const lat = line === 0 ? clamp(bLat, aLat - (lA / 2 - .35), aLat + (lA / 2 - .35)) : aLat;
  const tLat = clamp(lat, bLat - (lB / 2 - .35), bLat + (lB / 2 - .35));
  const x = alongX ? aAlong + s * lip : lat, z = alongX ? lat : aAlong + s * lip;
  const tx = alongX ? bAlong : tLat, tz = alongX ? tLat : bAlong;
  const len = Math.hypot(tx - x, tz - z) || 1, dx = (tx - x) / len, dz = (tz - z) / len;
  const p = new Player({ x, y: a.y + .001, z });
  p.energyDrainMult = 0;
  p.damageSink = () => {};
  p.yaw = Math.atan2(-dx, -dz);
  p.onGround = true;
  p.vel.set(dx * speed, 0, dz * speed);
  let thrown = false;
  for (let frame = 0; frame < 300; frame++) {
    if (!thrown && p.onGround) {
      const pad = parkourPadUnder(c, p.pos.x, p.pos.y, p.pos.z);
      if (pad) {
        const k = parkourPadImpulse(pad);
        p.vel.set(k.vx, k.vy, k.vz);
        p.momentumTime = k.momentum;
        p.onGround = false;
        thrown = true;
      }
    }
    p.update(1 / 120, RUN, world);
    if (frame > 3 && p.onGround) {
      if (onPad(p, b)) return true;
      if ((a.kind === 'launch' || a.kind === 'boost') && !thrown && onPad(p, a)) continue;
      return false;
    }
  }
  return false;
}
export function reachable(c: ParkourCourse, world: World, a: ParkourPlatform, b: ParkourPlatform): boolean {
  for (const back of OFFSETS) for (const speed of SPEEDS) for (const line of [0, 1])
    if (fly(c, world, a, b, back, speed, line)) return true;
  return false;
}

/** Scenery that breaks the route rule: [what, x, y, z]. */
export function sceneryFaults(c: ParkourCourse, v: ParkourVenue): string[] {
  const route = new Map<string, number>();
  for (const cell of c.cells) route.set(`${cell.x},${cell.y},${cell.z}`, cell.block);
  const solid = (b: number) => !!BLOCKS[b]?.solid;
  const scenery = (x: number, y: number, z: number): number => route.has(`${x},${y},${z}`) ? Block.Air : v.get(x, y, z);
  const faults: string[] = [];
  // A pad's support column (solid straight down from under its surface) is
  // part of the pad.
  const support = new Set<string>();
  for (const p of c.platforms) {
    const fx0 = Math.floor(p.x - p.width / 2), fz0 = Math.floor(p.z - p.depth / 2);
    for (let x = fx0; x < fx0 + p.width; x++) for (let z = fz0; z < fz0 + p.depth; z++)
      for (let y = p.y - 2; y > 120 && solid(v.get(x, y, z)); y--) support.add(`${x},${y},${z}`);
  }
  const nearFinish = (x: number, z: number) => Math.abs(x - c.finish.x) < 16 && z >= Math.floor(c.finish.z) - 2;
  for (const s of c.spaces) {
    const B = s.box;
    const y0 = s.pad ? s.lo - 3 : s.lo - 3, y1 = s.pad ? B.y1 + 2 : s.hi + 5;
    for (let x = B.x0 - 1; x <= B.x1 + 1; x++)
      for (let z = B.z0 - 1; z <= B.z1 + 1; z++) {
        if (nearFinish(x, z) || z < 13) continue;
        const inFoot = x >= B.x0 && x <= B.x1 && z >= B.z0 && z <= B.z1;
        for (let y = s.pad && inFoot ? B.y0 : y0; y <= y1; y++) {
          const b = scenery(x, y, z);
          if (support.has(`${x},${y},${z}`)) continue;
          if (solid(b) || b === Block.Water) { faults.push(`solid by the route at ${x},${y},${z}`); break; }
        }
      }
    for (let x = B.x0 - 5; x <= B.x1 + 5; x++)
      for (let z = B.z0 - 5; z <= B.z1 + 5; z++) {
        if (nearFinish(x, z) || z < 13) continue;
        for (let y = s.lo - 3; y <= s.hi; y++) {
          if (!solid(scenery(x, y, z)) || support.has(`${x},${y},${z}`)) continue;
          const above = v.get(x, y + 1, z);
          if (!solid(above)) { faults.push(`a ledge in reach at ${x},${y},${z}`); break; }
        }
      }
    if (faults.length > 4) break;
  }
  return faults;
}

export function dragonChaseTests(check: Check, section: (name: string) => void): void {
  section('dragon chase: courses');
  {
    const pieces = new Set<SetPieceId>(), lengths: number[] = [];
    let jumps = 0, unreachable = '', inside = true, podiumOk = true, faults = '';
    const N = 24;
    for (let i = 0; i < N; i++) {
      const seed = encodeParkourSeed(Math.imul(i + 11, 2654435761) >>> 0, i % PARKOUR_THEMES.length);
      const c = parkourCourse(seed), v = parkourVenue(seed), world = venueWorld(v);
      lengths.push(parkourLength(c));
      for (const s of c.sections) pieces.add(s.piece);
      if (c.sections.length < 5 || new Set(c.sections.map(s => s.piece)).size !== c.sections.length) inside = false;
      for (const p of c.platforms) {
        const x0 = p.x - p.width / 2, z0 = p.z - p.depth / 2;
        if (x0 < 1 || x0 + p.width > PARKOUR_VENUE_X - 1 || z0 < 1 || z0 + p.depth > PARKOUR_VENUE_Z - 1 || p.y < 122 || p.y > 186) inside = false;
      }
      for (const b of c.platforms) {
        if (b.from < 0) continue;
        const a = c.platforms[b.from];
        jumps++;
        if (!unreachable && !reachable(c, world, a, b)) unreachable = `seed ${seed}: ${a.kind} #${a.index} -> ${b.kind} #${b.index} (${SET_PIECES[c.sections[b.section]?.piece ?? 'ramparts'].title})`;
      }
      for (const spot of c.podium)
        if (!BLOCKS[v.get(Math.floor(spot.x), spot.y - 1, Math.floor(spot.z))]?.solid ||
          BLOCKS[v.get(Math.floor(spot.x), spot.y, Math.floor(spot.z))]?.solid) podiumOk = false;
      if (!faults) faults = sceneryFaults(c, v).slice(0, 3).join('; ');
    }
    check('every course runs through five or six different set pieces, inside the venue', inside);
    check(`courses are a real run (${Math.min(...lengths)}–${Math.max(...lengths)} jumps)`, Math.min(...lengths) >= 60 && Math.max(...lengths) <= 200);
    check(`the pieces all turn up (${pieces.size}/12)`, pieces.size >= 11);
    check(`every one of ${jumps} jumps lands with real player physics, scenery and all`, !unreachable, unreachable);
    check('the builds never crowd a jump or leave a ledge within reach of the route', !faults, faults);
    check('the podium steps are solid, with room to stand on them', podiumOk);
    // Nobody ever spawns or respawns inside anything.
    let spotsOk = true, spawnsOk = true, strays = '';
    for (let i = 0; i < 6 && spotsOk; i++) {
      const seed = encodeParkourSeed(Math.imul(i + 11, 2654435761) >>> 0, i % PARKOUR_THEMES.length);
      const c = parkourCourse(seed), v = parkourVenue(seed);
      const solidAt = (x: number, y: number, z: number) => !!BLOCKS[v.get(Math.floor(x), Math.floor(y), Math.floor(z))]?.solid;
      const bodyFree = (x: number, y: number, z: number) =>
        [-.29, .29].every(dx => [-.29, .29].every(dz => !solidAt(x + dx, y + .05, z + dz) && !solidAt(x + dx, y + 1.75, z + dz)));
      for (const p of c.platforms) {
        const s = parkourStandSpot(c, p);
        if (!solidAt(s.x, s.y - .5, s.z) || !bodyFree(s.x, s.y, s.z)) { spotsOk = false; break; }
      }
      const sub = { seed, minX: 0, maxX: PARKOUR_VENUE_X, minZ: 0, maxZ: PARKOUR_VENUE_Z, floor: 140, ceiling: 190, game: 'parkour' as const };
      for (const n of [2, 4]) for (const s of partySpawns(sub, Array.from({ length: n }, () => ({ team: 0 }))))
        if (!bodyFree(s.x, s.y, s.z)) spawnsOk = false;
      // No little group of blocks left floating on its own.
      if (i < 2 && !strays) {
        const seen = new Set<number>(), k = (x: number, y: number, z: number) => (y * PARKOUR_VENUE_Z + z) * PARKOUR_VENUE_X + x;
        const route = new Set(c.cells.map(cell => k(cell.x, cell.y, cell.z)));
        for (let y = 121; y <= 190 && !strays; y++)
          for (let z = 0; z < PARKOUR_VENUE_Z && !strays; z++)
            for (let x = 0; x < PARKOUR_VENUE_X && !strays; x++) {
              if (seen.has(k(x, y, z)) || !v.get(x, y, z) || route.has(k(x, y, z))) continue;
              const stack = [[x, y, z]]; seen.add(k(x, y, z));
              let size = 0, anchored = false;
              while (stack.length) {
                const [a, b2, d] = stack.pop()!;
                size++;
                for (const [nx, ny, nz] of [[a + 1, b2, d], [a - 1, b2, d], [a, b2 + 1, d], [a, b2 - 1, d], [a, b2, d + 1], [a, b2, d - 1]]) {
                  if (nx < 0 || nz < 0 || nx >= PARKOUR_VENUE_X || nz >= PARKOUR_VENUE_Z || ny < 121 || ny > 190) continue;
                  const nk = k(nx, ny, nz);
                  if (seen.has(nk) || !v.get(nx, ny, nz)) continue;
                  if (route.has(nk)) { anchored = true; continue; }
                  seen.add(nk); stack.push([nx, ny, nz]);
                }
              }
              if (!anchored && size < 40) strays = `seed ${seed}: ${size} loose blocks at ${x},${y},${z}`;
            }
      }
    }
    // The route winds, but the scenery either side of it is built in mirrored
    // pairs: both flanks match block for block.
    let mirrored = '', grounded = '', chains = '', winding = true;
    for (let i = 0; i < 4; i++) {
      const seed = encodeParkourSeed(Math.imul(i + 31, 2654435761) >>> 0, i * 2);
      const c = parkourCourse(seed), v = parkourVenue(seed), cx = PARKOUR_VENUE_X / 2;
      for (let y = 121; y <= 190 && !mirrored; y++)
        for (let z = 0; z < PARKOUR_VENUE_Z && !mirrored; z++)
          for (let x = 1; x <= 18; x++)
            if (v.get(x, y, z) !== v.get(2 * cx - x, y, z)) { mirrored = `seed ${seed}: ${x},${y},${z}`; break; }
      // Every pad stands on something that reaches the ground: from under
      // its surface, the solid it stands on joins a mass far bigger than any
      // column of its own.
      const k = (x: number, y: number, z: number) => (y * PARKOUR_VENUE_Z + z) * PARKOUR_VENUE_X + x;
      for (const p of c.platforms) {
        if (grounded) break;
        const x0 = Math.floor(p.x), z0 = Math.floor(p.z);
        const seen = new Set<number>([k(x0, p.y - 1, z0)]), stack = [[x0, p.y - 1, z0]];
        while (stack.length && seen.size < 1500) {
          const [a, b2, d] = stack.pop()!;
          for (const [nx, ny, nz] of [[a + 1, b2, d], [a - 1, b2, d], [a, b2 + 1, d], [a, b2 - 1, d], [a, b2, d + 1], [a, b2, d - 1]]) {
            if (ny < 121 || ny > 190 || seen.has(k(nx, ny, nz))) continue;
            // Down and sideways only below the surface: never up through
            // the air to some other pad.
            if (ny >= p.y && !(ny === p.y - 1)) continue;
            if (!BLOCKS[v.get(nx, ny, nz)]?.solid) continue;
            seen.add(k(nx, ny, nz)); stack.push([nx, ny, nz]);
          }
        }
        if (seen.size < 1500) grounded = `seed ${seed}: ${p.kind} #${p.index} at ${p.x},${p.y},${p.z} stands on ${seen.size} blocks`;
      }
      // Every chain hangs from something, or is strung between two anchors
      // along its own run.
      for (let y = 121; y <= 190 && !chains; y++)
        for (let z = 0; z < PARKOUR_VENUE_Z && !chains; z++)
          for (let x = 0; x < PARKOUR_VENUE_X && !chains; x++) {
            const id = v.get(x, y, z);
            if (id !== Block.ParkourChain && id !== Block.ParkourChainX && id !== Block.ParkourChainZ) continue;
            const [dx, dy, dz] = id === Block.ParkourChainX ? [1, 0, 0] : id === Block.ParkourChainZ ? [0, 0, 1] : [0, 1, 0];
            const ends = id === Block.ParkourChain ? [1] : [1, -1];
            for (const s2 of ends) {
              let n = 1;
              while (v.get(x + dx * n * s2, y + dy * n * s2, z + dz * n * s2) === id) n++;
              if (!BLOCKS[v.get(x + dx * n * s2, y + dy * n * s2, z + dz * n * s2)]?.solid) chains = `seed ${seed}: chain at ${x},${y},${z} hangs loose`;
            }
          }
      // The route really winds: every piece swings across the venue, most of
      // them right across it.
      const spans = c.sections.map((_, n) => {
        const xs = c.platforms.filter(p => p.section === n).map(p => p.x);
        return Math.max(...xs) - Math.min(...xs);
      });
      if (spans.some(w => w < 6) || spans.filter(w => w >= 16).length < c.sections.length / 2) winding = false;
    }
    check('the scenery either side of the route is a mirror image', !mirrored, mirrored);
    check('every pad stands on something that reaches the ground', !grounded, grounded);
    check('every chain hangs from something or is strung between two anchors', !chains, chains);
    check('the route winds across the venue, not down one line', winding);
    check('every pad has somewhere clear to (re)spawn on, builds and all', spotsOk);
    check('two or four runners all spawn on open floor', spawnsOk);
    check('no little groups of blocks float loose', !strays, strays);
    const seed = encodeParkourSeed(12345, 3);
    check('a course is the same course on every machine', JSON.stringify(parkourCourse(seed).platforms.map(p => [p.x, p.y, p.z, p.kind])) ===
      JSON.stringify(parkourCourse(seed).platforms.map(p => [p.x, p.y, p.z, p.kind])));
    const t0 = performance.now();
    for (let i = 0; i < 5; i++) parkourVenue(encodeParkourSeed(777 + i * 104729, i));
    const ms = (performance.now() - t0) / 5;
    check(`a whole venue builds quickly (${ms.toFixed(0)} ms)`, ms < 250);
  }

  section('dragon chase: lives, the dragon and the finish');
  {
    let token = 0;
    const engine = new PartyGamesEngine(() => `token-${++token}`.padEnd(32, 'x'));
    let now = 1000;
    const made = engine.create({ id: 1, username: 'A' }, now, 'parkour', 4);
    const tk = 'token' in made ? made.token : '';
    engine.join(tk, { id: 2, username: 'B' }, now);
    engine.join(tk, { id: 3, username: 'C' }, now);
    for (const id of [1, 2, 3]) engine.setReady(id, true, now);
    const started = engine.start(1, now);
    check('a party starts a Dragon Chase', started.ok);
    for (const id of [1, 2, 3]) engine.markArenaReady(id, now, engine.snapshotFor(1, now)!.revision);
    now += PARTY_COUNTDOWN_MS + 10;
    engine.tick(now);
    const snap = engine.snapshotFor(1, now)!;
    const sub = snap.sub!, c = parkourCourse(sub.seed), last = c.steps.length - 1;
    check('the run is live, everybody on three lives', snap.phase === 'running' && snap.participants.every(p => p.lives === DRAGON_LIVES));
    check('the dragon waits in its lair', snap.dragon !== undefined && snap.dragon.front < 0);
    const padPos = (o: number) => { const p = c.steps[o][0]; return { x: sub.minX + p.x, y: p.y, z: sub.minZ + p.z }; };
    const part = (id: number) => engine.participantFor(id)!;
    // A fall costs a life and puts you back on your checkpoint.
    engine.evaluate(2, padPos(3), now);
    const fell = engine.evaluate(2, { ...padPos(3), y: padPos(3).y - 6 }, now);
    check('a fall costs one life', part(2).lives === DRAGON_LIVES - 1 && part(2).lastLife?.cause === 'fall');
    check('...and puts you back on the course', !!fell.spawn && Math.abs(fell.spawn.y - c.steps[part(2).progress][0].y) < .1);
    // Reaching the end: onto the podium, and the run goes on.
    engine.evaluate(1, padPos(last - 1), now);
    engine.evaluate(1, padPos(last), now);
    check('reaching the end puts you on the podium, first', part(1).finishedAt !== undefined && part(1).place === 1);
    check('the first one home does not end the run', engine.phaseFor(2) === 'running');
    check('nobody hurts a runner who made it', !engine.hurt(1, 'fire', now));
    // Leaving after making it is not a forfeit.
    engine.leave(1, now);
    check('a runner who made it can leave without ending anything', engine.phaseFor(2) === 'running' &&
      engine.snapshotFor(2, now)!.participants.find(p => p.id === 1)?.finishedAt !== undefined);
    // The dragon sets off after its grace period.
    now += DRAGON_GRACE_MS + 1000;
    for (let t = 0; t < 120; t++) engine.tick(now += 100);
    const front = engine.snapshotFor(2, now)!.dragon!.front;
    check(`the dragon leaves its lair and flies the course (at ${front.toFixed(1)})`, front > 0);
    // Anybody it overtakes is caught; they come back ahead of it.
    const lobby = (engine as unknown as { lobbyByPlayer: Map<number, { dragon: { front: number } }> }).lobbyByPlayer.get(2)!;
    lobby.dragon.front = 30;
    engine.tick(now += 50);
    const caught = engine.evaluate(3, padPos(0), now);
    check('the dragon catches whoever it reaches', part(3).lastLife?.cause === 'dragon' && part(3).lives === DRAGON_LIVES - 1);
    check('...who respawns clear ahead of it', !!caught.spawn && part(3).progress >= 30 + DRAGON_RESPAWN_LEAD - 1);
    check('...and is safe for a moment', !engine.hurt(3, 'fire', now));
    engine.evaluate(2, padPos(0), now);
    // Burn through B's lives: out, and the run still goes on for C.
    for (let k = 0; k < 4; k++) { now += 3100; engine.hurt(2, 'fire', now); engine.evaluate(2, padPos(part(2).progress), now); }
    check('three lives gone and you are out', part(2).outAt !== undefined && part(2).lives === 0);
    check('the run goes on while anybody is still running', engine.phaseFor(3) === 'running');
    for (let k = 0; k < 4; k++) { now += 3100; engine.hurt(3, 'dragon', now); engine.evaluate(3, padPos(part(3).progress), now); }
    const result = engine.snapshotFor(3, now)!;
    check('the run ends when nobody is left running', result.phase === 'results');
    const runners = result.result?.runners ?? [];
    check('the result says who made it', runners.find(r => r.id === 1)?.made === true && runners.find(r => r.id === 1)?.place === 1);
    check('...and who died first', runners.find(r => r.id === 2)?.fellOrder === 1 && runners.find(r => r.id === 3)?.fellOrder === 2);
    check('nobody "wins" a Dragon Chase', result.result?.winner === null);
  }
}
