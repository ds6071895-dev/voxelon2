import * as THREE from 'three';
import { Block, BLOCKS } from '../src/blocks';
import { FROZEN_INPUT } from '../src/input';
import { Player } from '../src/player';
import type { Particles } from '../src/particles';
import { partyHash } from '../src/party_math';
import { PartyGamesEngine, PARTY_COUNTDOWN_MS } from '../src/partygames';
import { encodeParkourSeed, generateParkourCourse, parkourCourse } from '../src/parkour_course';
import { parkourVenue } from '../src/parkour_setpieces';
import { parkourBlinkCells, parkourCrumbleCells } from '../src/parkour_mechanics';
import { parkourLiveStandSpot, parkourLiveRespawn, parkourRestoreOccupied, parkourRestorePlan } from '../src/parkour_footing';
import { ParkourHistory } from '../src/parkour_history';
import { parkourStamp, releaseParkourStamp } from '../src/parkour_geometry';
import { DragonView } from '../src/parkour_dragon';
import { PARKOUR_THEMES } from '../src/parkour_themes';

type Check = (name: string, ok: boolean, detail?: string) => void;

/** Focused cleanup/domain regressions; the global harness imports this export. */
export function partyCleanupTests(check: Check, section: (name: string) => void): void {
  section('party cleanup: generation and live footing');
  const seed = encodeParkourSeed(12345, 1), course = parkourCourse(seed);
  const fresh = generateParkourCourse(seed);
  check('fresh generation is independent and preserves the full course', fresh !== course && JSON.stringify(fresh) === JSON.stringify(course));
  const aliasSeed = encodeParkourSeed(0x80003039, 1), signedSeed = aliasSeed | 0;
  check('seed aliases exercise distinct positive and negative representations', signedSeed < 0 && signedSeed !== aliasSeed);
  check('signed and unsigned course aliases share the immutable cache', parkourCourse(signedSeed) === parkourCourse(aliasSeed));
  const stamp = parkourStamp(aliasSeed);
  check('signed and unsigned venue aliases share geometry', parkourStamp(signedSeed) === stamp);
  releaseParkourStamp(signedSeed);
  check('a signed terminal release evicts the unsigned venue identity', parkourStamp(aliasSeed) !== stamp);
  let linear = true;
  for (let theme = 0; theme < 8; theme++) {
    const c = parkourCourse(encodeParkourSeed(Math.imul(theme + 11, 2654435761) >>> 0, theme));
    linear &&= c.steps.length === c.platforms.length && c.steps.every((step, i) =>
      step.length === 1 && step[0] === c.platforms[i] && step[0].order === i && step[0].index === i && step[0].from === i - 1);
  }
  check('all eight themes have one linear route with useful progress/predecessor metadata', linear);
  check('hash inputs retain unsigned wraparound equivalence', partyHash(-1, 17) === partyHash(0xffffffff, 17) &&
    partyHash(123, 0) !== partyHash(123, 1));

  const venue = parkourVenue(seed), gone = new Set<string>();
  const key = (x: number, y: number, z: number) => `${x},${y},${z}`;
  const blockAt = (x: number, y: number, z: number) => gone.has(key(x, y, z)) ? Block.Air : venue.get(x, y, z);
  const world = { isLoaded: () => true, getBlock: blockAt };
  let hazardCount = 0, unsafeSpawn = false, unsupported = false, footingMismatch = false;
  for (const p of course.platforms) {
    if (p.kind !== 'blink' && p.kind !== 'crumble') continue;
    hazardCount++;
    const before = parkourLiveStandSpot(p, blockAt);
    const supports: [number, number, number, number][] = [];
    const x0 = Math.floor(p.x - p.width / 2), z0 = Math.floor(p.z - p.depth / 2);
    for (let x = x0; x < x0 + p.width; x++) for (let z = z0; z < z0 + p.depth; z++)
      for (let y = 121; y <= p.y - 2; y++) supports.push([x, y, z, blockAt(x, y, z)]);
    const cells = p.kind === 'blink' ? parkourBlinkCells(course, p.group).filter(c => c.platform === p.index)
      : parkourCrumbleCells(course, p.index);
    for (const cell of cells) gone.add(key(cell.x, cell.y, cell.z));
    // The surface disappears; authored ground supports remain exactly as built.
    // Stilts may leave the centre hollow; every support cell must retain its
    // original block, and at least one part of the footprint stays grounded.
    unsupported ||= !before || !supports.some(([, , , block]) => BLOCKS[block]?.solid) ||
      supports.some(([x, y, z, block]) => blockAt(x, y, z) !== block);
    unsafeSpawn ||= parkourLiveStandSpot(p, blockAt) !== null;
    const respawn = parkourLiveRespawn(course, p.order, blockAt);
    unsafeSpawn ||= !respawn || respawn.order <= p.order || respawn.order === course.finish.order;
    if (before) {
      const body = new Player({ ...before, y: before.y + .001 });
      body.damageSink = () => {};
      for (let i = 0; i < 180; i++) body.update(1 / 120, FROZEN_INPUT, world);
      // A disappearance may expose a standable support one block down. This
      // characterizes the existing hazard, rather than carving its foundation.
      const expected = BLOCKS[blockAt(Math.floor(before.x), p.y - 2, Math.floor(before.z))]?.solid;
      footingMismatch ||= !!expected && (!body.onGround || Math.abs(body.pos.y - (p.y - 1)) > .02);
    }
    for (const cell of cells) gone.delete(key(cell.x, cell.y, cell.z));
  }
  check('the probe includes blink and crumble hazards', hazardCount > 1 && course.platforms.some(p => p.kind === 'blink') && course.platforms.some(p => p.kind === 'crumble'));
  check('disappearing surfaces preserve their authored grounded supports', !unsupported);
  check('live respawn lookup rejects vanished surfaces and seeks forward', !unsafeSpawn);
  check('real physics can land on the support exposed by a disappearing surface', !footingMismatch);

  const cells = parkourBlinkCells(course, 0);
  const cell = cells[0];
  check('the restore probe has a blink cell', !!cell);
  if (cell) {
    const body = { x: cell.x + .5, y: cell.y + .2, z: cell.z + .5 };
    const blocked = parkourRestorePlan([cell], c => parkourRestoreOccupied(c, [body]));
    const retried = parkourRestorePlan(blocked.pending, c => parkourRestoreOccupied(c, []));
    check('an occupied restore remains pending and retries after the body leaves', blocked.ready.length === 0 &&
      blocked.pending[0] === cell && retried.ready[0] === cell && retried.pending.length === 0);
    check('a restore may touch the sole without intersecting the body', !parkourRestoreOccupied(cell,
      [{ x: body.x, y: cell.y + 1, z: body.z }]));
  }

  section('party cleanup: snapshots, result lifetime and replay history');
  let token = 0, now = 1000;
  const engine = new PartyGamesEngine(() => `cleanup-${++token}`);
  const created = engine.create({ id: 1, username: 'A' }, now, 'parkour');
  if (!('token' in created)) throw new Error('Expected a lobby');
  engine.join(created.token, { id: 2, username: 'B' }, now);
  for (const id of [1, 2]) engine.setReady(id, true, now);
  engine.start(1, now);
  const revision = engine.snapshotFor(1, now)!.revision;
  for (const id of [1, 2]) engine.markArenaReady(id, now, revision);
  engine.tick(now += PARTY_COUNTDOWN_MS);
  const snap = engine.snapshotFor(1, now)!, c = parkourCourse(snap.sub!.seed), last = c.steps.length - 1;
  engine.participantFor(1)!.lastLife = { at: now - 1, cause: 'fall' };
  const isolated = engine.snapshotFor(1, now)!;
  isolated.participants[0].lastLife!.cause = 'left';
  isolated.arena!.seed = 0;
  isolated.dragon!.front = 100;
  isolated.round!.endsAt = 0;
  check('nested life, arena, dragon and round snapshots cannot mutate the engine', engine.participantFor(1)!.lastLife!.cause === 'fall' &&
    engine.subFor(1)!.seed === snap.sub!.seed && engine.dragonFor(1)!.front < 0 && engine.roundFor(1)!.endsAt > now);
  engine.hurt(2, 'fire', now);
  const waiting = engine.evaluate(2, c.start, now, () => Block.Air);
  const lives = engine.participantFor(2)!.lives;
  const retry = engine.evaluate(2, c.start, now + 100, () => Block.Air);
  check('a life applied while all surfaces are blocked waits without charging it twice', !waiting.spawn && waiting.changed &&
    !retry.spawn && !retry.changed && engine.participantFor(2)!.lives === lives && lives === 2 && engine.participantFor(2)!.respawnOrder !== undefined);
  const liveVenue = parkourVenue(snap.sub!.seed);
  const resumed = engine.evaluate(2, c.start, now + 200, (x, y, z) => liveVenue.get(x, y, z));
  check('pending live respawn completes safely when a surface returns', !!resumed.spawn && resumed.changed &&
    engine.participantFor(2)!.respawnOrder === undefined && !engine.participantFor(2)!.pendingSpawn &&
    engine.participantFor(2)!.lives === lives && engine.participantFor(2)!.immuneUntil > now + 200);
  for (const id of [1, 2]) {
    engine.evaluate(id, c.steps[last - 1][0], now);
    engine.evaluate(id, c.steps[last][0], now);
  }
  const result = engine.snapshotFor(1, now)!.result!;
  result.teamScores[0] = 999;
  result.runners![0].made = false;
  result.scoreboard[0].lastLife!.cause = 'left';
  result.scoreboard[0].score = 999;
  const stable = engine.snapshotFor(1, now)!.result!;
  check('result snapshots defensively copy runners, scoreboard, nested lives and scores', stable.teamScores[0] !== 999 &&
    stable.runners![0].made && stable.scoreboard[0].lastLife!.cause === 'fall' && stable.scoreboard[0].score !== 999);
  engine.participantFor(1)!.lastLife!.cause = 'fire';
  check('the finished scoreboard is independent of the live participants', engine.snapshotFor(1, now)!.result!.scoreboard[0].lastLife!.cause === 'fall');
  engine.tick(now + 19999);
  check('results remain available for their full twenty-second presentation', engine.snapshotFor(1, now + 19999)!.phase === 'results');
  engine.tick(now += 20000);
  const expired = engine.snapshotFor(1, now)!;
  check('expired results clear round, arena, dragon, result and loading clocks', expired.phase === 'lobby' && !expired.result &&
    !expired.round && !expired.arena && !expired.sub && !expired.dragon && expired.countdownEndsAt === undefined && expired.arenaLoadDeadline === undefined);
  check('a saved result survives lobby reset', stable.runners![0].made && stable.scoreboard[0].lastLife!.cause === 'fall');
  const history = new ParkourHistory(2);
  history.set(1, { theme: 0, pieces: ['ramparts'] });
  history.set(2, { theme: 1, pieces: ['rooftops'] });
  history.get(1);
  history.set(3, { theme: 2, pieces: ['galleon'] });
  check('replay history is bounded and keeps recently used runners', !!history.get(1) && !history.get(2) && !!history.get(3));
  history.delete(1);
  check('departed bot history can be forgotten explicitly', !history.get(1));

  section('party cleanup: dragon resource ownership');
  const scene = new THREE.Scene(), dragon = new DragonView(scene, { burst() {} } as unknown as Particles);
  dragon.enter(course, PARKOUR_THEMES[1], 0, 0);
  const internals = dragon as unknown as {
    model: THREE.Group; root: THREE.Group; rigMaterials: THREE.Material[];
    flap: number; breathUntil: number; emitAcc: number; trail: THREE.Vector3[];
  };
  const owned = new Set<THREE.BufferGeometry>(), shared = new Set<THREE.Material>();
  internals.model.traverse(o => {
    if (!(o instanceof THREE.Mesh)) return;
    owned.add(o.geometry);
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const mat of mats) if (!internals.rigMaterials.includes(mat)) shared.add(mat);
  });
  let geometryDisposals = 0, eyeDisposals = 0, sharedDisposals = 0;
  for (const geometry of owned) geometry.addEventListener('dispose', () => geometryDisposals++);
  for (const mat of internals.rigMaterials) mat.addEventListener('dispose', () => eyeDisposals++);
  for (const mat of shared) mat.addEventListener('dispose', () => sharedDisposals++);
  dragon.fireball({ id: 1, tx: 10, ty: 140, tz: 20, launchAt: 9000, landAt: 10000 });
  const flightMaterials: THREE.Material[] = [];
  for (const o of internals.root.children)
    if (o instanceof THREE.Mesh && (o.geometry instanceof THREE.TorusGeometry || o.geometry instanceof THREE.CircleGeometry))
      flightMaterials.push(o.material as THREE.Material);
  let flightDisposals = 0;
  for (const mat of flightMaterials) mat.addEventListener('dispose', () => flightDisposals++);
  dragon.update(.1, 8100, 0, true);
  dragon.clear();
  check('clear disposes every owned rig geometry and its one eye material', owned.size > 0 && geometryDisposals === owned.size && eyeDisposals === 1,
    `${geometryDisposals}/${owned.size} geometries, ${eyeDisposals} eye material`);
  check('clear disposes flight material clones and preserves shared box materials', flightDisposals === 2 && sharedDisposals === 0);
  dragon.clear();
  check('repeated clear does not dispose resources twice', geometryDisposals === owned.size && eyeDisposals === 1);
  dragon.enter(course, PARKOUR_THEMES[2], 0, 0);
  check('enter resets trail, wing/breath/particle clocks and starts at the lair', internals.trail.length === 0 && internals.flap === 0 &&
    internals.breathUntil === 0 && internals.emitAcc === 0 && dragon.headPosition().z === course.lair.z);
  dragon.dispose();
  check('final disposal detaches the dragon from the scene', scene.children.length === 0 && sharedDisposals === 0);
}
