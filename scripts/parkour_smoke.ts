// Use the real player physics to prove every generated jump is possible, on
// every mode and every layout.
//
// Jumps are not one fixed spacing, so "can a full-power sprint jump land it"
// is the wrong question: a short hop overshot at full speed is the player's
// choice, not a broken course. What has to hold is that SOME honest approach
// lands it, so each jump is searched over a small grid of take-off offsets,
// running speeds and lines, and has to work for at least one of them. Throw
// pads are flown exactly as the client flies them: `parkourPadImpulse` the
// moment the body touches the pad.
import { Player } from '../src/player';
import { Block } from '../src/blocks';
import {
  PARKOUR_SIZE_X, PARKOUR_SIZE_Z, PARTY_CEILING_Y, parkourCourse, partyArenaBounds,
  partyArenaBlockAt, registerPartyArena, type ParkourPlatform,
} from '../src/partygames';
import {
  PARKOUR_MODES, PARKOUR_MODE_LAYOUTS, encodeParkourSeed, parkourLength, parkourVariant,
  type ParkourCourse,
} from '../src/parkour_course';
import {
  BLINK_PERIOD_MS, blinkSolid, parkourBlinkCells, parkourPadImpulse, parkourPadUnder,
} from '../src/parkour_mechanics';
import type { PlayerInput } from '../src/input';
import type { World } from '../src/world';

const input: PlayerInput = { mouseDX: 0, mouseDY: 0, forward: true, back: false, left: false, right: false, jump: true, sneak: false, sprintKey: true, sprintHeld: true } as PlayerInput;
/** Sprint, walk, and two deliberately shorter run-ups. */
const SPEEDS = [5.612, 4.317, 3.2, 2.3];
/** How far back from the take-off edge the run-up starts. */
const OFFSETS = [0, .5, 1, 1.5];

/** The course's own blocks, in venue-local coordinates. */
function courseWorld(c: ParkourCourse): World {
  const m = new Map<string, number>();
  for (const cell of c.cells) m.set(`${cell.x},${cell.y},${cell.z}`, cell.block);
  return { isLoaded: () => true, getBlock: (x: number, y: number, z: number) => m.get(`${x},${y},${z}`) ?? Block.Air } as unknown as World;
}
function onPlatform(p: Player, b: ParkourPlatform, minX = 0, minZ = 0): boolean {
  const left = Math.floor(b.x - b.width / 2), front = Math.floor(b.z - b.depth / 2);
  return Math.abs(p.pos.y - b.y) < .01 &&
    p.pos.x + .3 > minX + left && p.pos.x - .3 < minX + left + b.width &&
    p.pos.z + .3 > minZ + front && p.pos.z - .3 < minZ + front + b.depth;
}
interface Approach { back: number; speed: number; line: number }
/** Where a jump from `a` to `b` takes off, and the way it faces. `line` 0
 *  takes off level with the nearest part of `b`; 1 from the middle of `a`. */
function takeoff(a: ParkourPlatform, b: ParkourPlatform, how: Approach): { x: number; z: number; dx: number; dz: number } {
  const h = b.heading, alongX = h % 2 === 1, s = h < 2 ? 1 : -1;
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
  const aAlong = alongX ? a.x : a.z, aLat = alongX ? a.z : a.x;
  const bAlong = alongX ? b.x : b.z, bLat = alongX ? b.z : b.x;
  const eA = alongX ? a.width : a.depth, lA = alongX ? a.depth : a.width, lB = alongX ? b.depth : b.width;
  const lip = Math.max(-(eA / 2 - .35), eA / 2 - .35 - how.back);
  const lat = how.line === 0 ? clamp(bLat, aLat - (lA / 2 - .35), aLat + (lA / 2 - .35)) : aLat;
  const tLat = clamp(lat, bLat - (lB / 2 - .35), bLat + (lB / 2 - .35));
  const x = alongX ? aAlong + s * lip : lat, z = alongX ? lat : aAlong + s * lip;
  const tx = alongX ? bAlong : tLat, tz = alongX ? tLat : bAlong;
  const len = Math.hypot(tx - x, tz - z);
  return { x, z, dx: (tx - x) / len, dz: (tz - z) / len };
}
/** Fly one attempt, calling `sample` every frame; true if it lands on `b`. */
function fly(c: ParkourCourse, world: World, a: ParkourPlatform, b: ParkourPlatform, how: Approach,
  minX = 0, minZ = 0, sample?: (p: Player, frame: number) => void): boolean {
  const t = takeoff(a, b, how);
  const p = new Player({ x: minX + t.x, y: a.y + .001, z: minZ + t.z });
  p.yaw = Math.atan2(-t.dx, -t.dz);
  p.onGround = true;
  p.vel.set(t.dx * how.speed, 0, t.dz * how.speed);
  let thrown = false;
  for (let frame = 0; frame < 240; frame++) {
    // Exactly the client's throw-pad rule (main.ts): touch it, get thrown.
    if (!thrown && p.onGround) {
      const pad = parkourPadUnder(c, p.pos.x - minX, p.pos.y, p.pos.z - minZ);
      if (pad) {
        const kick = parkourPadImpulse(pad);
        p.vel.set(kick.vx, kick.vy, kick.vz);
        p.momentumTime = kick.momentum;
        p.onGround = false;
        thrown = true;
      }
    }
    p.update(1 / 120, input, world);
    sample?.(p, frame);
    if (frame > 3 && p.onGround) {
      if (onPlatform(p, b, minX, minZ)) return true;
      // Still on the throw pad, not yet thrown: keep going.
      if ((a.kind === 'launch' || a.kind === 'boost') && !thrown && onPlatform(p, a, minX, minZ)) continue;
      return false;
    }
  }
  return false;
}
function approach(c: ParkourCourse, world: World, a: ParkourPlatform, b: ParkourPlatform): Approach | null {
  for (const back of OFFSETS)
    for (const speed of SPEEDS)
      for (const line of [0, 1])
        if (fly(c, world, a, b, { back, speed, line })) return { back, speed, line };
  return null;
}
function seedFor(i: number, mode: typeof PARKOUR_MODES[number], layout: string): number {
  return encodeParkourSeed(((i * 2654435761) >>> 0) | 0x100, i & 7, mode, layout as never);
}

// ── Every jump of every mode × layout lands ────────────────────────────────
let jumps = 0;
const kindsProven = new Set<string>();
for (const mode of PARKOUR_MODES)
  for (const layout of PARKOUR_MODE_LAYOUTS[mode])
    for (let i = 0; i < 16; i++) {
      const seed = seedFor(i, mode, layout), c = parkourCourse(seed), world = courseWorld(c);
      if (c.variant.mode !== mode || c.variant.layout !== layout) throw Error(`seed ${seed} decodes to the wrong variant`);
      for (const [ai, bi] of c.edges) {
        const a = c.platforms[ai], b = c.platforms[bi];
        if (!approach(c, world, a, b))
          throw Error(`Unreachable jump: ${mode}/${layout} seed ${seed}, ${a.kind} #${ai} -> ${b.kind} #${bi}`);
        kindsProven.add(b.kind);
        jumps++;
      }
    }
console.log(`Parkour physics smoke: ${jumps} generated jumps completed using real player physics`);
console.log(`  jump shapes proven reachable: ${[...kindsProven].sort().join(', ')}`);
for (const k of ['launch', 'boost', 'blink', 'crumble', 'ladder', 'window', 'ledge', 'fork', 'join', 'wall', 'tunnel'])
  if (!kindsProven.has(k)) throw Error(`no course ever used ${k}`);

// ── Shape: whole, inside the venue, never built into itself ────────────────
{
  const shapes = new Map<string, { orders: number[]; climb: number[] }>();
  for (let seed = 1; seed <= 600; seed++) {
    const c = parkourCourse(seed), { mode, layout } = c.variant;
    const key = `${mode}/${layout}`;
    const st = shapes.get(key) ?? { orders: [], climb: [] };
    shapes.set(key, st);
    st.orders.push(parkourLength(c));
    st.climb.push(c.highY - c.lowY);
    if (!c.start.checkpoint || !c.finish.checkpoint) throw Error(`missing end checkpoints at seed ${seed}`);
    if (c.steps.some((s, i) => !s?.length || s.some(p => p.order !== i))) throw Error(`orders have a gap at seed ${seed}`);
    if (c.steps.some(s => s.length > 2)) throw Error(`more than two pads share an order at seed ${seed}`);
    for (const p of c.platforms) {
      if (p.x - p.width / 2 < 1 || p.x + p.width / 2 > PARKOUR_SIZE_X - 1 || p.z - p.depth / 2 < 4 || p.z + p.depth / 2 > PARKOUR_SIZE_Z - 4)
        throw Error(`course leaves the venue at seed ${seed}`);
      if (p.y + 4 > PARTY_CEILING_Y) throw Error(`course reaches the ceiling at seed ${seed}`);
    }
    // No two landing surfaces share a cell.
    const seen = new Map<string, number>();
    for (const p of c.platforms) {
      const x0 = Math.floor(p.x - p.width / 2), z0 = Math.floor(p.z - p.depth / 2);
      for (let x = x0; x < x0 + p.width; x++)
        for (let z = z0; z < z0 + p.depth; z++) {
          const k = `${x},${p.y},${z}`, other = seen.get(k);
          if (other !== undefined) throw Error(`platforms #${other} and #${p.index} overlap at seed ${seed}`);
          seen.set(k, p.index);
        }
    }
    // Every landing surface is really there, standing clear.
    for (const p of c.platforms) {
      const x = Math.floor(p.x), z = Math.floor(p.z);
      const cell = c.cells.find(v => v.x === x && v.z === z && v.y === p.y - 1);
      if (!cell || cell.block === Block.Air) {
        if (p.kind !== 'pit') throw Error(`platform #${p.index} (${p.kind}) has no floor at seed ${seed}`);
      }
    }
  }
  for (const [key, st] of shapes) {
    const min = Math.min(...st.orders), climb = Math.min(...st.climb);
    if (min < 40) throw Error(`${key} produced a ${min}-jump course`);
    if (key.startsWith('void/') && climb < 30) throw Error(`${key} produced a tower only ${climb} tall`);
  }
  const combos = PARKOUR_MODES.reduce((n, m) => n + PARKOUR_MODE_LAYOUTS[m].length, 0);
  if (shapes.size !== combos) throw Error(`only ${shapes.size}/${combos} mode × layout combinations turned up in 600 seeds`);
  console.log(`Parkour shape smoke: 600 seeds across all ${combos} mode × layout combinations — whole, inside the venue, never overlapping`);
}

// ── Blink stones always leave a moment to cross ────────────────────────────
{
  for (let t = 0; t < BLINK_PERIOD_MS * 3; t += 25)
    if (!blinkSolid(0, t) && !blinkSolid(1, t)) throw Error(`both blink groups are gone at ${t}ms`);
  let overlap = 0;
  for (let t = 0; t < BLINK_PERIOD_MS; t += 25) if (blinkSolid(0, t) && blinkSolid(1, t)) overlap += 25;
  if (overlap < 500) throw Error(`blink groups overlap for only ${overlap}ms a cycle`);
  const blinky = Array.from({ length: 400 }, (_, i) => parkourCourse(i + 1)).find(c => c.platforms.some(p => p.kind === 'blink'))!;
  if (!parkourBlinkCells(blinky, 0).length && !parkourBlinkCells(blinky, 1).length) throw Error('blink pads have no blink stones');
  console.log(`Parkour blink smoke: the two groups are both up for ${overlap}ms of every ${BLINK_PERIOD_MS}ms cycle`);
}

// Render-state regression: every theme, mode and layout can be built, updated,
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
const seen = new Set<number>(), modes = new Set<string>(), layouts = new Set<string>();
let previous: ReturnType<typeof parkourVariant> | null = null;
// Each pass has to outlast a whole race plus its results screen, so the clock
// is driven by the mode's own duration rather than by a number typed here.
const RACE_MS = partyGame('parkour').durationMs;
for (let match = 0; match < 24; match++) {
  const now = match * (RACE_MS + PARTY_RESULT_MS + 60000);
  engine.setReady(1, true, now);
  engine.setReady(2, true, now);
  const result = engine.start(1, now);
  if (!result.ok)
    throw Error('start');
  const snap = result.snapshot, variant = parkourVariant(snap.arena!.seed);
  // Never the same kind of match twice running: not the same world, not the
  // same mode, not the same layout.
  if (previous && variant.theme === previous.theme) throw Error('consecutive theme repeat');
  if (previous && variant.mode === previous.mode) throw Error('consecutive mode repeat');
  if (previous && variant.layout === previous.layout) throw Error('consecutive layout repeat');
  previous = variant;
  seen.add(variant.theme);
  modes.add(variant.mode);
  layouts.add(variant.layout);
  if (match === 7 && seen.size !== 8)
    throw Error('theme shuffle bag missed a world');
  if (match === 2 && modes.size !== 3)
    throw Error('mode shuffle bag missed a mode');
  const course = parkourCourse(snap.sub!.seed);
  visuals.update(snap, 1, now);
  visuals.update(snap, 1, now + 100);
  for (let progress = 0; progress < parkourLength(course); progress++) {
    const mine = snap.participants.find(p => p.id === 1)!;
    mine.progress = progress;
    visuals.update(snap, 1, now + 100);
    scene.updateMatrixWorld(true);
    const pads = course.steps[progress + 1];
    let found = 0;
    scene.traverse(object => {
      const mesh = object as import('three').Mesh;
      if (!mesh.visible || mesh.geometry?.type !== 'TorusGeometry') return;
      const material = mesh.material as import('three').MeshBasicMaterial;
      if (material.color.getHex() !== 0x72ffcb) return;
      found++;
      const bounds = new Box3().setFromObject(mesh);
      // The ring has to sit inside one of the pads it is marking.
      const inside = pads.some(pad => {
        const left = snap.sub!.minX + Math.floor(pad.x - pad.width / 2);
        const front = snap.sub!.minZ + Math.floor(pad.z - pad.depth / 2);
        return bounds.min.x >= left + .07 && bounds.max.x <= left + pad.width - .07 &&
          bounds.min.z >= front + .07 && bounds.max.z <= front + pad.depth - .07;
      });
      if (!inside) throw Error(`marker leaves platform ${progress + 1} on ${variant.mode}/${variant.layout}`);
    });
    if (found !== pads.length) throw Error(`expected ${pads.length} next-platform rings, found ${found}`);
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
if (layouts.size < 6)
  throw Error(`only ${layouts.size} layouts across 24 matches`);
console.log(`Parkour variety smoke: 24 matches, ${seen.size} themes, ${modes.size} modes, ${layouts.size} layouts, never the same mode, layout or world twice running`);

// Send a real physics trajectory through the server's movement/collision gate.
// This catches false corrections which pure jump tests cannot detect — and it
// is what proves the server lets a throw pad's flight stand.
import { GameServer } from '../src/net/server_core';
function serverRace(seed: number) {
  const server = new GameServer(seed);
  server.addPlayer(1, { username: 'PhysicsA', faction: 0 });
  server.addPlayer(2, { username: 'PhysicsB', faction: 0 });
  server.handle(1, { t: 'partyQueue', join: true, mode: 'parkour' });
  server.handle(2, { t: 'partyQueue', join: true, mode: 'parkour' });
  const match = server.party.snapshotFor(1, 0)!;
  server.handle(1, { t: 'partyArenaReady', revision: match.revision });
  server.handle(2, { t: 'partyArenaReady', revision: match.revision });
  server.tickWar(3);
  server.tickParty();
  return { server, match };
}
const worldBlocks = { isLoaded: () => true, getBlock: (x: number, y: number, z: number) => partyArenaBlockAt(x, y, z) ?? Block.Air } as unknown as World;
let accepted = 0, thrownAccepted = 0;
for (const serverSeed of [91, 93, 97, 101]) {
  const { server, match } = serverRace(serverSeed);
  const sub = match.sub!, course = parkourCourse(sub.seed), remote = server.players.get(1)!;
  registerPartyArena(partyArenaBounds(sub.slot, sub.seed));
  const local = courseWorld(course);
  for (const [ai, bi] of course.edges) {
    const a = course.platforms[ai], b = course.platforms[bi];
    // Replay whichever honest approach actually lands this jump.
    const how = approach(course, local, a, b);
    if (!how) throw Error(`no landing approach for jump ${ai} -> ${bi}`);
    const t = takeoff(a, b, how);
    Object.assign(remote, { x: sub.minX + t.x, y: a.y + .001, z: sub.minZ + t.z });
    server.handle(1, { t: 'xform', x: remote.x, y: remote.y, z: remote.z, yaw: 0, pitch: 0, arenaRevision: match.revision });
    const thrown = a.kind === 'launch' || a.kind === 'boost';
    const landed = fly(course, worldBlocks, a, b, how, sub.minX, sub.minZ, (p, frame) => {
      server.tickWar(1 / 120);
      if ((frame + 1) % 6 !== 0 && !(frame > 3 && p.onGround)) return;
      const out = server.handle(1, { t: 'xform', x: p.pos.x, y: p.pos.y, z: p.pos.z, yaw: p.yaw, pitch: 0, arenaRevision: match.revision });
      if (out.some(o => o.to === 1 && o.msg.t === 'teleport'))
        throw Error(`Server rejected valid ${a.kind} -> ${b.kind} jump ${ai} -> ${bi}, frame ${frame}`);
      accepted++;
      if (thrown) thrownAccepted++;
    });
    if (!landed) throw Error(`replayed approach missed ${ai} -> ${bi} in the live venue`);
  }
}
console.log(`Parkour network physics smoke: ${accepted} valid movement samples accepted without corrections (${thrownAccepted} of them mid-throw)`);

// A launch window is only ever opened by a real pad: the same climb, far
// from any pad, is still flight.
{
  const { server, match } = serverRace(103);
  const sub = match.sub!, course = parkourCourse(sub.seed), remote = server.players.get(1)!;
  const pad = course.steps[3][0];
  Object.assign(remote, { x: sub.minX + pad.x, y: pad.y, z: sub.minZ + pad.z });
  server.handle(1, { t: 'xform', x: remote.x, y: remote.y, z: remote.z, yaw: 0, pitch: 0, arenaRevision: match.revision });
  server.tickWar(.05);
  const high = server.handle(1, { t: 'xform', x: remote.x, y: remote.y + 4, z: remote.z, yaw: 0, pitch: 0, arenaRevision: match.revision });
  if (!course.platforms.some(p => (p.kind === 'launch' || p.kind === 'boost') &&
    Math.abs(p.x - pad.x) < 4 && Math.abs(p.z - pad.z) < 4) && !high.some(o => o.to === 1 && o.msg.t === 'teleport'))
    throw Error('a four-block rise away from any throw pad was accepted');
  console.log('Parkour launch gate: a throw-pad-sized rise anywhere else is still corrected');
}

// Live surfaces over the wire: blink stones toggle on the round clock, a
// crumble pad drops out and grows back, and a collapse front only eats.
{
  let found = false;
  for (let seed = 200; seed < 260 && !found; seed++) {
    const { server, match } = serverRace(seed);
    const sub = match.sub!, course = parkourCourse(sub.seed);
    const blink = course.platforms.find(p => p.kind === 'blink');
    const crumble = course.platforms.find(p => p.kind === 'crumble');
    if (!blink || !crumble) continue;
    found = true;
    const edits = (out: ReturnType<GameServer['tickParty']>) =>
      out.filter(o => o.to === 1 && o.msg.t === 'editBatch').flatMap(o => (o.msg as { edits: { block: number }[] }).edits);
    const blinkEdits: number[] = [];
    for (let i = 0; i < 80; i++) {
      server.tickWar(.05);
      blinkEdits.push(...edits(server.tickParty()).map(e => e.block));
    }
    if (!blinkEdits.includes(Block.Air) || !blinkEdits.includes(Block.PartyTileD))
      throw Error('blink stones never toggled over four seconds');
    // Stand on the crumble pad.
    const remote = server.players.get(1)!;
    Object.assign(remote, { x: sub.minX + crumble.x, y: crumble.y, z: sub.minZ + crumble.z });
    const move = (server as unknown as { partyMoves: Map<number, { groundX: number; groundY: number; groundZ: number; allowance: number }> }).partyMoves.get(1)!;
    Object.assign(move, { groundX: remote.x, groundY: remote.y, groundZ: remote.z, allowance: 4 });
    server.tickWar(.05);
    const step = server.handle(1, { t: 'xform', x: remote.x + .05, y: crumble.y, z: remote.z, yaw: 0, pitch: 0, arenaRevision: match.revision });
    const cracked = step.filter(o => o.to === 1 && o.msg.t === 'editBatch');
    if (!cracked.length) throw Error('stepping on a crumble pad did not crack it');
    let gone = false, back = false;
    for (let i = 0; i < 120 && !back; i++) {
      server.tickWar(.05);
      if (i === 20) Object.assign(remote, { y: crumble.y + 30 }); // step off so it can grow back
      for (const b of edits(server.tickParty())) {
        if (b.block === Block.Air) gone = true;
        if (gone && b.block === Block.PartyTileC) back = true;
      }
    }
    if (!gone || !back) throw Error(`crumble pad did not drop out (${gone}) and grow back (${back})`);
  }
  if (!found) throw Error('no server course had both a blink and a crumble pad');
  console.log('Parkour live-surface smoke: blink stones toggle, crumble pads drop and grow back');
}

// Resting on the last few centimetres of a platform is supported by the real
// 0.6-block player body. It must not become an anti-flight violation after idle.
const { server: edgeServer, match: edgeMatch } = serverRace(92);
const edgeSub = edgeMatch.sub!, edgeRemote = edgeServer.players.get(1)!;
const edgeCourse = parkourCourse(edgeSub.seed);
const edgePad = edgeCourse.platforms.find(p => p.order > 0 && p.kind === 'wide' && p.checkpoint && p.heading === 0)
  ?? edgeCourse.start;
for (const axis of ['x', 'z'] as const) {
  const pad = edgePad, c = { x: Math.floor(pad.x - pad.width / 2) + pad.width / 2, z: Math.floor(pad.z - pad.depth / 2) + pad.depth / 2 };
  const edge = new Player({ x: edgeSub.minX + c.x, y: pad.y + .001, z: edgeSub.minZ + c.z });
  // Stay away from the checkpoint's posts on the middle row.
  edge.pos.z -= 1.5;
  edge.pos[axis] = (axis === 'x' ? edgeSub.minX + c.x + pad.width / 2 : edgeSub.minZ + c.z - pad.depth / 2) + (axis === 'x' ? .28 : -.28);
  const still = { ...input, forward: false, jump: false, sprintHeld: false, sprintKey: false };
  edge.update(1 / 120, still, worldBlocks);
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
