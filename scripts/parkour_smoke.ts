// Use the real player physics to prove every generated jump is possible.
//
// The lane no longer uses one fixed spacing, so "can a full-power sprint jump
// land it" is the wrong question: a short hop overshot at full speed is the
// player's choice, not a broken course. What has to hold is that SOME honest
// approach lands it, so each jump is searched over a small grid of take-off
// offsets and running speeds and has to work for at least one of them.
import { Player } from '../src/player';
import { Block } from '../src/blocks';
import {
  PARKOUR_PLATFORMS, PARKOUR_SIZE_Z, parkourCourse, partyArenaBounds,
  partyArenaBlockAt, partySubBounds, registerPartyArena, type ParkourPlatform,
} from '../src/partygames';
import type { PlayerInput } from '../src/input';
import type { World } from '../src/world';

const input: PlayerInput = { mouseDX: 0, mouseDY: 0, forward: true, back: false, left: false, right: false, jump: true, sneak: false, sprintKey: true, sprintHeld: true };
const world = { isLoaded: () => true, getBlock: (x: number, y: number, z: number) => partyArenaBlockAt(x, y, z) ?? Block.Air } as World;
/** Sprint, walk, and two deliberately shorter run-ups. */
const SPEEDS = [5.612, 4.317, 3.2, 2.3];
/** How far back from the take-off edge the run-up starts. */
const OFFSETS = [0, .5, 1, 1.5];

function centre(p: ParkourPlatform): { x: number; z: number } {
  return { x: Math.floor(p.x - p.width / 2) + p.width / 2, z: Math.floor(p.z - p.depth / 2) + p.depth / 2 };
}
function onPlatform(p: Player, b: ParkourPlatform, minX: number, minZ: number): boolean {
  const left = Math.floor(b.x - b.width / 2), front = Math.floor(b.z - b.depth / 2);
  return Math.abs(p.pos.y - b.y) < .01 &&
    p.pos.x + .3 > minX + left && p.pos.x - .3 < minX + left + b.width &&
    p.pos.z + .3 > minZ + front && p.pos.z - .3 < minZ + front + b.depth;
}
/** Launch one attempt; returns the player if it landed on `b`. */
function attempt(a: ParkourPlatform, b: ParkourPlatform, minX: number, minZ: number, back: number, speed: number): Player | null {
  const span = Math.hypot(b.x - a.x, b.z - a.z);
  const dx = (b.x - a.x) / span, dz = (b.z - a.z) / span;
  const from = centre(a);
  // Stand on the take-off lip, or `back` blocks behind it, still on the pad.
  const lip = Math.max(0, Math.min(a.depth / 2 - .35, a.depth / 2 - .35 - back));
  const lipX = Math.max(0, Math.min(a.width / 2 - .35, (a.width / 2 - .35) * Math.abs(dx)));
  const p = new Player({
    x: minX + from.x + Math.sign(dx) * lipX,
    y: a.y + .001,
    z: minZ + from.z + Math.sign(dz) * lip,
  });
  p.yaw = Math.atan2(-dx, -dz);
  p.onGround = true;
  p.vel.set(dx * speed, 0, dz * speed);
  for (let frame = 0; frame < 140; frame++) {
    p.update(1 / 120, input, world);
    if (frame > 3 && p.onGround) return onPlatform(p, b, minX, minZ) ? p : null;
  }
  return null;
}

let jumps = 0;
const kindsProven = new Set<string>();
for (let seed = 1; seed <= 80; seed++) {
  const arena = partyArenaBounds(0, seed);
  registerPartyArena(arena);
  const sub = partySubBounds(0, 1, seed), course = parkourCourse(seed);
  if (sub.game !== 'parkour') throw Error('sub 1 is not the parkour lane');
  if (course.length !== PARKOUR_PLATFORMS) throw Error('course length');
  for (let i = 1; i < course.length; i++) {
    const a = course[i - 1], b = course[i];
    let landed = false;
    for (const back of OFFSETS)
      for (const speed of SPEEDS)
        if (!landed && attempt(a, b, sub.minX, sub.minZ, back, speed)) landed = true;
    if (!landed)
      throw Error(`Unreachable jump: seed ${seed}, platform ${i}, ${JSON.stringify({ a, b })}`);
    kindsProven.add(b.kind);
    jumps++;
  }
}
console.log(`Parkour physics smoke: ${jumps} generated jumps completed using real player physics`);
console.log(`  jump shapes proven reachable: ${[...kindsProven].sort().join(', ')}`);

// The lane really is a lane: it only ever advances, and it stays narrow enough
// that you can see the finish from the start.
for (let seed = 1; seed <= 400; seed++) {
  const course = parkourCourse(seed);
  for (let i = 1; i < course.length; i++) {
    if (course[i].z <= course[i - 1].z) throw Error(`course doubles back at seed ${seed} #${i}`);
    if (Math.abs(course[i].x - course[i - 1].x) > 3) throw Error(`course swerves at seed ${seed} #${i}`);
  }
  const spread = Math.max(...course.map(p => p.x)) - Math.min(...course.map(p => p.x));
  if (spread > 8) throw Error(`course is not a straight line at seed ${seed} (${spread} wide)`);
  if (course.some(p => p.z + p.depth / 2 > PARKOUR_SIZE_Z - 8 || p.z - p.depth / 2 < 4))
    throw Error(`course leaves the venue at seed ${seed}`);
  // Landing pads must never share a row: two overlapping stamps would erase
  // each other's obstacles and turn a jump into a step.
  for (let i = 1; i < course.length; i++) {
    const a = course[i - 1], b = course[i];
    if (Math.floor(b.z - b.depth / 2) <= Math.floor(a.z - a.depth / 2) + a.depth - 1)
      throw Error(`platforms overlap at seed ${seed} #${i}`);
  }
  if (!course[0].checkpoint || !course[course.length - 1].checkpoint) throw Error('missing end checkpoints');
}
console.log('Parkour shape smoke: 400 seeds are all straight, forward-only, non-overlapping lanes inside the venue');

// Render-state regression: all themes and both venues can be built, updated,
// reused and cleared without needing a WebGL context or leaking old geometry.
import { Box3, Scene } from 'three';
import { PartyVisuals } from '../src/party_visuals';
import { PARTY_RESULT_MS, PartyGamesEngine, partyGame } from '../src/partygames';
import { PARKOUR_THEMES } from '../src/parkour_themes';
const scene = new Scene(), visuals = new PartyVisuals(scene);
let serial = 0;
const engine = new PartyGamesEngine(() => String(++serial).padStart(48, 'd'));
const made = engine.create({ id: 1, username: 'ThemeA', skin: 1 }, 0, 'parkour');
if ('reason' in made)
  throw Error('create');
engine.join(made.token, { id: 2, username: 'ThemeB', skin: 2 }, 0);
const seen = new Set<number>();
let previous = -1;
// Each pass has to outlast a whole race plus its results screen, so the clock
// is driven by the mode's own duration rather than by a number typed here.
const RACE_MS = partyGame('parkour').durationMs;
for (let match = 0; match < 16; match++) {
  const now = match * (RACE_MS + PARTY_RESULT_MS + 60000);
  engine.setReady(1, true, now);
  engine.setReady(2, true, now);
  const result = engine.start(1, now);
  if (!result.ok)
    throw Error('start');
  const snap = result.snapshot, theme = snap.arena!.seed % 8;
  if (theme === previous)
    throw Error('consecutive theme repeat');
  previous = theme;
  seen.add(theme);
  if (match === 7 && seen.size !== 8)
    throw Error('theme shuffle bag missed a world');
  visuals.update(snap, 1, now);
  visuals.update(snap, 1, now + 100);
  for (let progress = 0; progress < parkourCourse(snap.sub!.seed).length - 1; progress++) {
    const mine = snap.participants.find(p => p.id === 1)!;
    mine.progress = progress;
    visuals.update(snap, 1, now + 100);
    scene.updateMatrixWorld(true);
    const pad = parkourCourse(snap.sub!.seed)[progress + 1];
    const left = snap.sub!.minX + Math.floor(pad.x - pad.width / 2);
    const front = snap.sub!.minZ + Math.floor(pad.z - pad.depth / 2);
    let found = false;
    scene.traverse(object => {
      const mesh = object as import('three').Mesh;
      if (!mesh.visible || mesh.geometry?.type !== 'TorusGeometry') return;
      const material = mesh.material as import('three').MeshBasicMaterial;
      if (material.color.getHex() !== 0x72ffcb) return;
      found = true;
      const bounds = new Box3().setFromObject(mesh);
      if (bounds.min.x < left + .07 || bounds.max.x > left + pad.width - .07 ||
          bounds.min.z < front + .07 || bounds.max.z > front + pad.depth - .07)
        throw Error(`marker leaves platform ${progress + 1} in theme ${theme}`);
    });
    if (!found) throw Error('missing next-platform ring');
  }
  visuals.clear();
  engine.markArenaReady(1, now, snap.revision);
  engine.markArenaReady(2, now, snap.revision);
  engine.tick(now + 3000);
  engine.tick(now + 3000 + RACE_MS + 1);
  engine.tick(now + 3000 + RACE_MS + PARTY_RESULT_MS + 1);
}
if (seen.size !== PARKOUR_THEMES.length)
  throw Error('theme coverage');
console.log(`Parkour scenery smoke: all ${seen.size} themes rendered, no consecutive repeats across 16 races`);

// Send a real physics trajectory through the server's movement/collision gate.
// This catches false corrections which pure jump tests cannot detect.
import { GameServer } from '../src/net/server_core';
const server = new GameServer(91);
server.addPlayer(1, { username: 'PhysicsA', faction: 0 });
server.addPlayer(2, { username: 'PhysicsB', faction: 0 });
server.handle(1, { t: 'partyQueue', join: true, mode: 'parkour' });
server.handle(2, { t: 'partyQueue', join: true, mode: 'parkour' });
const match = server.party.snapshotFor(1, 0)!;
server.handle(1, { t: 'partyArenaReady', revision: match.revision });
server.handle(2, { t: 'partyArenaReady', revision: match.revision });
server.tickWar(3);
server.tickParty();
const sub = match.sub!, course = parkourCourse(sub.seed), remote = server.players.get(1)!;
let accepted = 0;
for (let i = 1; i < course.length; i++) {
  const a = course[i - 1], b = course[i];
  // Replay whichever honest approach actually lands this jump.
  let chosen: { back: number; speed: number } | null = null;
  for (const back of OFFSETS)
    for (const speed of SPEEDS)
      if (!chosen && attempt(a, b, sub.minX, sub.minZ, back, speed)) chosen = { back, speed };
  if (!chosen) throw Error(`no landing approach for jump ${i}`);
  const span = Math.hypot(b.x - a.x, b.z - a.z);
  const dx = (b.x - a.x) / span, dz = (b.z - a.z) / span, from = centre(a);
  const lip = Math.max(0, Math.min(a.depth / 2 - .35, a.depth / 2 - .35 - chosen.back));
  const lipX = Math.max(0, Math.min(a.width / 2 - .35, (a.width / 2 - .35) * Math.abs(dx)));
  const p = new Player({
    x: sub.minX + from.x + Math.sign(dx) * lipX, y: a.y + .001, z: sub.minZ + from.z + Math.sign(dz) * lip,
  });
  Object.assign(remote, { x: p.pos.x, y: p.pos.y, z: p.pos.z });
  p.yaw = Math.atan2(-dx, -dz);
  p.onGround = true;
  p.vel.set(dx * chosen.speed, 0, dz * chosen.speed);
  for (let frame = 0; frame < 140; frame++) {
    p.update(1 / 120, input, world);
    server.tickWar(1 / 120);
    if ((frame + 1) % 6 !== 0 && !(frame > 3 && p.onGround)) continue;
    const out = server.handle(1, { t: 'xform', x: p.pos.x, y: p.pos.y, z: p.pos.z, yaw: p.yaw, pitch: 0, arenaRevision: match.revision });
    if (out.some(o => o.to === 1 && o.msg.t === 'teleport'))
      throw Error(`Server rejected valid jump ${i}, frame ${frame}`);
    accepted++;
    if (frame > 3 && p.onGround)
      break;
  }
}
console.log(`Parkour network physics smoke: ${accepted} valid movement samples accepted without corrections`);

// Resting on the last few centimetres of a platform is supported by the real
// 0.6-block player body. It must not become an anti-flight violation after idle.
const edgeServer = new GameServer(92);
edgeServer.addPlayer(1, { username: 'EdgeA', faction: 0 });
edgeServer.addPlayer(2, { username: 'EdgeB', faction: 0 });
edgeServer.handle(1, { t: 'partyQueue', join: true, mode: 'parkour' });
edgeServer.handle(2, { t: 'partyQueue', join: true, mode: 'parkour' });
const edgeMatch = edgeServer.party.snapshotFor(1, 0)!;
edgeServer.handle(1, { t: 'partyArenaReady', revision: edgeMatch.revision });
edgeServer.handle(2, { t: 'partyArenaReady', revision: edgeMatch.revision });
edgeServer.tickWar(3);
edgeServer.tickParty();
const edgeSub = edgeMatch.sub!, edgeRemote = edgeServer.players.get(1)!;
for (const axis of ['x', 'z'] as const) {
  const pad = parkourCourse(edgeSub.seed)[14], c = centre(pad);
  const edge = new Player({ x: edgeSub.minX + c.x, y: pad.y + .001, z: edgeSub.minZ + c.z });
  // Stay away from the checkpoint's posts on the middle row.
  edge.pos.z -= 1.5;
  edge.pos[axis] = (axis === 'x' ? edgeSub.minX + c.x + pad.width / 2 : edgeSub.minZ + c.z - pad.depth / 2) + (axis === 'x' ? .28 : -.28);
  const still = { ...input, forward: false, jump: false, sprintHeld: false, sprintKey: false };
  edge.update(1 / 120, still, world);
  if (!edge.onGround) throw Error(`edge fixture is not standing on ${axis} edge`);
  // Establish a real, recent footing at this pad's height first.
  Object.assign(edgeRemote, { x: edgeSub.minX + c.x, y: pad.y, z: edgeSub.minZ + c.z - 1.5 });
  edgeServer.handle(1, { t: 'xform', x: edgeRemote.x, y: edgeRemote.y, z: edgeRemote.z, yaw: 0, pitch: 0, arenaRevision: edgeMatch.revision });
  Object.assign(edgeRemote, { x: edge.pos.x, y: edge.pos.y, z: edge.pos.z });
  edgeServer.tickWar(3);
  for (let frame = 0; frame < 20; frame++) {
    edgeServer.tickWar(.05);
    edge.pos[axis === 'x' ? 'z' : 'x'] += .01;
    const out = edgeServer.handle(1, { t: 'xform', x: edge.pos.x, y: edge.pos.y, z: edge.pos.z, yaw: 0, pitch: 0, arenaRevision: edgeMatch.revision });
    if (out.some(o => o.to === 1 && o.msg.t === 'teleport')) throw Error(`grounded ${axis}-edge movement was frozen`);
    if (edgeRemote.x !== edge.pos.x || edgeRemote.z !== edge.pos.z) throw Error('edge movement was not accepted');
  }
}
console.log('Parkour edge regression: supported edge landings stay movable after idle');
