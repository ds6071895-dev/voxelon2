import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { Duels, DUEL_ROUND_MS, duelArenaBlockAt, type DuelLobbySnapshot } from '../src/duels';
import { GameServer, type Outbound } from '../src/net/server_core';
import { NetClient } from '../src/net/client';
import { Accounts } from '../src/net/accounts';
import { PracticeSkills } from '../src/net/practice_skill';
import { NameRegistry } from '../src/net/names';
import { LoginThrottle } from '../src/net/login_throttle';
import { recordArenaPosition, arenaVelocity } from '../src/net/arena_history';
import { isGeneratedName, type ClientMsg, type ServerMsg, type GameMode } from '../src/net/protocol';
import { worldGenerator, releaseWorldGenerator, WorldBlocks } from '../src/multiverse';
import { Block } from '../src/blocks';
import { Item } from '../src/items';
import { mulberry32 } from '../src/noise';
import { parkourCourse } from '../src/partygames';
import { staticClientPath } from '../server/static_path';
import { writeAccountsAtomically } from '../server/account_persistence';

class Harness {
  readonly game: GameServer;
  readonly out: Outbound[] = [];
  constructor() {
    const rng = mulberry32(1701);
    this.game = new GameServer({ rng, token: () => String(rng()).padEnd(32, 'x') });
  }
  send(id: number, msg: ClientMsg): void { this.out.push(...this.game.handle(id, msg)); }
  join(): number { const id = this.game.connect(); this.send(id, { t: 'hello' }); return id; }
  last<T extends ServerMsg['t']>(id: number, t: T): Extract<ServerMsg, { t: T }> {
    const o = [...this.out].reverse().find((o) => o.to === id && o.msg.t === t);
    assert.ok(o, `missing ${t}`); return o.msg as Extract<ServerMsg, { t: T }>;
  }
  ready(ids: number[]): void {
    for (const id of ids) {
      const world = this.game.worldOf(id)!;
      const revision = this.out.find((o) => o.to === id && o.msg.t === 'pgArena')?.msg;
      this.send(id, { t: 'worldReady', world: world.id,
        revision: revision?.t === 'pgArena' ? revision.revision : undefined });
    }
    this.out.push(...this.game.tick(3.1));
  }
}

function duel(ids = [1, 2, 3]): { d: Duels; snap: DuelLobbySnapshot } {
  const d = new Duels(() => 'x'.repeat(32));
  const made = d.startMatch(ids.map((id) => ({ id, username: `BraveYak${10 + id}`, skin: id })), 0);
  assert.ok(made.ok);
  for (const id of ids) d.markArenaReady(id, 0);
  d.tick(3_000);
  return { d, snap: d.snapshotFor(ids[0], 3_000)! };
}

/** Parent registers this suite; no autonomous global runner or server process. */
export function runServerCleanupTests(): void {
  domainTests();
  entryAndRosterTests();
  reconnectTests();
  identityAndShellTests();
  serverBoundaryTests();
}

function domainTests(): void {
  {
    const { d } = duel();
    d.participantFor(1)!.kills = 8;
    d.participantFor(2)!.kills = 4;
    d.participantFor(3)!.kills = 1;
    d.leave(1, 4_000);
    d.tick(3_000 + DUEL_ROUND_MS);
    const result = d.snapshotFor(2, 4_000)!.result!;
    assert.equal(result.winner, 2, 'departed leader cannot win at time');
    assert.equal(result.scoreboard[result.scoreboard.length - 1].id, 1, 'departed leader places last');
    result.scoreboard[0].kills = 999;
    assert.equal(d.snapshotFor(2, 4_000)!.result!.scoreboard[0].kills, 4, 'results are isolated snapshots');
  }
  {
    const { d, snap } = duel();
    d.recordDeath(1, 2, 5_000);
    d.tick(8_000);
    const end = snap.endsAt!;
    const kill = d.recordDeath(2, 1, end - 1_000)!;
    assert.ok(kill.feed.some((e) => e.kind === 'revenge'), 'payback does not require a reciprocal prior kill');
    d.tick(end);
    assert.equal(d.phaseFor(1), 'sudden_death');
    assert.equal(d.participantFor(2)!.respawnAt, end + 2_000, 'tied dead leader keeps respawn');
    assert.equal(d.participantFor(3)!.respawnAt, undefined, 'nonleader cannot respawn into sudden death');
    d.tick(end + 2_000);
    assert.equal(d.participantFor(2)!.alive, true);
  }
  {
    const { d, snap } = duel();
    const duplicate = d.startMatch([{ id: 7, username: 'BraveYak17', skin: 1 },
      { id: 7, username: 'BraveYak17', skin: 1 }], 4_000);
    assert.equal(duplicate.ok, false);
    assert.equal(d.snapshotFor(7, 4_000), null, 'invalid launch leaves no membership');
    const other = d.startMatch([4, 5].map((id) => ({ id, username: `BraveYak${id + 10}`, skin: id })), 4_000);
    assert.ok(other.ok, 'direct launch is independent of invite entropy');
    snap.participants[0].kills = 999;
    snap.arena!.spawns[0].x = 999;
    assert.equal(d.snapshotById(snap.id, 4_000)!.participants[0].kills, 0);
    assert.notEqual(d.arenaFor(1)!.spawns[0].x, 999);
  }
  let hash = 2166136261;
  for (let z = 0; z < 44; z++) for (let x = 0; x < 44; x++) for (let y = 95; y < 256; y++)
    hash = Math.imul(hash ^ (duelArenaBlockAt(x, y, z) ?? -1), 16777619) >>> 0;
  assert.equal(hash, 1302322174, 'all 311696 authored colosseum cells retain their exact stamp');
  for (const kind of ['duel', 'bridge', 'ratseek'] as const) {
    const a = worldGenerator({ kind, seed: 1 });
    const b = worldGenerator({ kind, seed: 987654 });
    assert.equal(a, b, `${kind} geometry cache ignores irrelevant seeds`);
    const blocksA = new WorldBlocks(a), blocksB = new WorldBlocks(b);
    blocksA.set(1, 1, 1, Block.OakPlanks);
    assert.notEqual(blocksB.getBlock(1, 1, 1), Block.OakPlanks, 'cached geometry does not share edits');
    releaseWorldGenerator({ kind, seed: 1 });
    assert.equal(worldGenerator({ kind, seed: 2 }), a, 'closing one world retains shared fixed geometry');
  }
}

function entryAndRosterTests(): void {
  const wire = new NetClient();
  const receive = (wire as unknown as { handle(msg: ServerMsg): void }).handle.bind(wire);
  let placement: number | undefined, prediction: number | undefined;
  wire.onBwKit = (_slots, _selected, value) => { placement = value; };
  wire.onBwNack = (_x, _y, _z, value) => { prediction = value; };
  receive({ t: 'bwKit', slots: [], placement: 17 });
  receive({ t: 'bwNack', x: 1, y: 2, z: 3, prediction: 16 });
  assert.equal(placement, 17, 'kit placement watermark reaches client prediction');
  assert.equal(prediction, 16, 'placement rejection retains its prediction identity');
  for (const mode of ['duels', 'bridge', 'parkour', 'ratseek', 'bedwars'] as GameMode[]) {
    const h = new Harness(), ids = Array.from({ length: mode === 'bedwars' ? 4 : 2 }, () => h.join());
    h.out.length = 0;
    for (const id of ids) h.send(id, { t: 'play', mode });
    if (mode === 'ratseek') h.out.push(...h.game.tick(10.1));
    h.ready(ids);
    for (const id of ids) {
      const messages = h.out.filter((o) => o.to === id).map((o) => o.msg);
      const arena = messages.findIndex((m) => ['duelArena', 'pgArena', 'rsArena', 'bwArena'].includes(m.t));
      assert.ok(arena >= 0, `${mode} sent arena`);
      const worldMessages = new Set(['join', 'duelLoadout', 'pgLoadout', 'rsKit', 'bwKit', 'edit', 'editBatch',
        'duelState', 'pgState', 'rsState', 'bwState']);
      assert.ok(messages.every((m, i) => !worldMessages.has(m.t) || i > arena), `${mode}: arena before roster/kit/state`);
      const rosterIndices = messages.flatMap((m, i) => m.t === 'join' ? [i] : []);
      const kitOrState = messages.findIndex(m => ['duelLoadout', 'pgLoadout', 'rsKit', 'bwKit', 'duelState', 'pgState', 'rsState', 'bwState'].includes(m.t));
      assert.ok(rosterIndices.every(i => i < kitOrState), `${mode}: complete roster precedes kit/state for each recipient`);
      const net = new NetClient();
      const receive = (net as unknown as { handle(msg: ServerMsg): void }).handle.bind(net);
      receive({ t: 'welcome', id, username: 'BraveYak11', account: false });
      for (const msg of messages) receive(msg);
      assert.equal(net.remotes.size, h.game.worldMembers(h.game.worldOf(id)!.id).length - 1,
        `${mode} initial roster survives arena switch`);
      const asks: ClientMsg[] = [];
      net.send = (msg) => { asks.push(msg); return true; };
      const remote = [...net.remotes.keys()][0];
      net.remotes.delete(remote);
      for (const o of h.game.snapshots()) if (o.to === id) receive(o.msg);
      const ask = asks.find((msg) => msg.t === 'roster');
      assert.ok(ask, `${mode} recovers a missing remote identity`);
      for (const o of h.game.handle(id, ask)) if (o.to === id) receive(o.msg);
      assert.ok(net.remotes.has(remote), `${mode} roster response restores rendering`);
      assert.deepEqual(h.game.handle(id, { t: 'roster', world: -1 }), [], 'roster cannot inspect another world');
      const arenaMessage = messages[arena];
      if (arenaMessage.t === 'duelArena') {
        receive({ ...arenaMessage, world: { ...arenaMessage.world, id: -22 } });
        assert.equal(net.remotes.size, 0, 'new world clears even a freshly seen old roster');
      }
    }
  }
  {
    const h = new Harness(), ids = Array.from({ length: 4 }, () => h.join());
    const token = h.last(ids[0], 'welcome').resumeToken!;
    for (const id of ids) h.send(id, { t: 'play', mode: 'bedwars' });
    h.ready(ids);
    for (let i = 0; i < 110; i++) h.out.push(...h.game.tick(.05));
    assert.equal(h.last(ids[0], 'bwState').s.phase, 'playing');
    h.out.push(...h.game.disconnect(ids[0]));
    const resumed = h.game.resume(h.game.connect(), token)!;
    assert.ok(resumed, 'active Bedwars session resumes');
    const messages = resumed.out.filter(o => o.to === ids[0]).map(o => o.msg);
    assert.equal(messages[0].t, 'welcome', 'resume installs identity before world messages');
    const arena = messages.findIndex(m => m.t === 'bwArena');
    const joins = messages.flatMap((m, i) => m.t === 'join' ? [i] : []);
    const move = messages.findIndex(m => m.t === 'teleport');
    const kit = messages.findIndex(m => m.t === 'bwKit');
    assert.ok(arena > 0 && joins.length === 3 && joins.every(i => i > arena && i < move), 'resume installs world and full roster before movement');
    assert.ok(move < kit, 'resume correction precedes authoritative kit');
    const net = new NetClient();
    const receive = (net as unknown as { handle(msg: ServerMsg): void }).handle.bind(net);
    for (const msg of messages) receive(msg);
    assert.equal(net.myId, ids[0]); assert.equal(net.remotes.size, 3, 'resume roster survives identity/world setup');
  }
}

function reconnectTests(): void {
  const originals = new Map(['WebSocket', 'window', 'location'].map((key) =>
    [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const sockets: FakeSocket[] = [], delays: number[] = [], timers: (() => void)[] = [];
  class FakeSocket {
    static OPEN = 1; static CONNECTING = 0;
    readyState = 0; bufferedAmount = 0;
    onopen?: () => void; onclose?: () => void;
    onmessage?: (event: { data: string }) => void;
    constructor(_url: string) { sockets.push(this); }
    send(_data: string): void {}
  }
  try {
    Object.defineProperty(globalThis, 'WebSocket', { configurable: true, value: FakeSocket });
    Object.defineProperty(globalThis, 'location', { configurable: true,
      value: { protocol: 'http:', port: '8090', host: 'fixture:8090' } });
    Object.defineProperty(globalThis, 'window', { configurable: true, value: {
      setTimeout: (fn: () => void, delay: number) => { timers.push(fn); delays.push(delay); return timers.length; },
    } });
    const net = new NetClient(); net.connect();
    sockets[0].readyState = 1; sockets[0].onopen?.(); sockets[0].onclose?.();
    timers[0]();
    sockets[1].readyState = 1; sockets[1].onopen?.(); sockets[1].onclose?.();
    assert.deepEqual(delays, [600, 1200], 'transport opens without welcome do not reset retry backoff');
    timers[1]();
    sockets[2].readyState = 1; sockets[2].onopen?.();
    sockets[2].onmessage?.({ data: JSON.stringify({ t: 'welcome', id: 9, username: 'BraveYak19', account: false }) });
    sockets[0].onclose?.();
    assert.equal(net.connected, true, 'late close from an obsolete socket cannot reset a healthy connection');
    sockets[2].onclose?.();
    assert.equal(delays[2], 600, 'successful welcome resets retry backoff');
  } finally {
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
}

function identityAndShellTests(): void {
  const accounts = new Accounts();
  const memory = new PracticeSkills(accounts, () => {});
  memory.remember({ username: 'BraveYak11', account: false }, 'bedwars', .9);
  memory.remember({ username: 'BraveYak11', account: false }, 'duels', .7);
  assert.ok(accounts.register('SwiftWolf12', 'fixture-pass', () => 'fake-hash', 'fake-salt').ok);
  memory.register('BraveYak11', 'SwiftWolf12');
  assert.equal(accounts.skillOf('SwiftWolf12', 'bedwars'), .9, 'offered-name registration migrates Bedwars skill');
  assert.equal(accounts.skillOf('SwiftWolf12', 'duels'), .7, 'guest learning follows the identity change');
  const registry = new NameRegistry(() => false);
  const rolled = Array.from({ length: 8 }, (_, i) => registry.roll(`fixture:${i}`, () => 0));
  assert.equal(new Set(rolled).size, rolled.length);
  assert.ok(rolled.every(isGeneratedName), 'deterministic-rng fallback stays registrable');
  const throttle = new LoginThrottle(1, 30, 60);
  throttle.record('fixture', 0);
  throttle.sweep(45);
  assert.equal(throttle.remaining('fixture', 45), 15, 'window expiry cannot clear active lockout');
  throttle.sweep(61);
  assert.equal(throttle.size, 0, 'untouched expired buckets are reclaimed');
  const track: { at: number; x: number; y: number; z: number }[] = [];
  recordArenaPosition(track, 10, { x: 0, y: 0, z: 0 });
  recordArenaPosition(track, 10.1, { x: 1, y: 0, z: 2 });
  recordArenaPosition(track, 10.1, { x: 2, y: 0, z: 2 });
  assert.equal(track.length, 2, 'same-tick transforms do not grow history without elapsed time');
  assert.ok(Math.abs(arenaVelocity(track).x - 20) < 1e-8, 'dragon lead reads seconds, not milliseconds');
  assert.deepEqual(staticClientPath('/fixture/dist', '/bad%ZZ'), { ok: false, status: 400 });
  assert.deepEqual(staticClientPath('/fixture/dist', '/%2e%2e/dist-other/file'), { ok: false, status: 403 });
  assert.deepEqual(staticClientPath('/fixture/dist', '/%00'), { ok: false, status: 400 });
  const directory = fs.mkdtempSync('/tmp/opencode/server-cleanup-');
  const file = `${directory}/fixture.json`;
  try {
    fs.writeFileSync(file, 'last-good-store');
    assert.throws(() => writeAccountsAtomically(file, 'replacement', {
      ...fs, renameSync: () => { throw new Error('fixture rename failure'); },
    }));
    assert.equal(fs.readFileSync(file, 'utf8'), 'last-good-store', 'failed replacement preserves existing bytes');
    writeAccountsAtomically(file, 'successful-retry');
    assert.equal(fs.readFileSync(file, 'utf8'), 'successful-retry', 'failed persistence can retry');
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
}

function serverBoundaryTests(): void {
  {
    const h = new Harness(), ids = [h.join(), h.join(), h.join()];
    h.send(ids[0], { t: 'partyCreate' });
    const code = h.last(ids[0], 'party').party!.code;
    for (const id of ids.slice(1)) h.send(id, { t: 'partyJoin', code });
    h.send(ids[0], { t: 'play', mode: 'parkour' }); h.ready(ids);
    const spec = h.game.worldOf(ids[0])!, sub = h.last(ids[0], 'pgArena').sub;
    const course = parkourCourse(sub.seed), cell = course.cells.find((c) => c.block === Block.PartyTileC)!;
    assert.ok(cell, 'fixture course contains a crumble surface');
    const fixture = h.game as unknown as {
      players: Map<number, { x: number; y: number; z: number }>;
      worlds: Map<number, { blocks: WorldBlocks; parkour: {
        crumbles: Map<number, { fallAt: number; backAt: number; gone: boolean }>;
        pendingRestore: Map<number, { x: number; y: number; z: number }>;
      } }>;
    };
    const w = fixture.worlds.get(spec.id)!;
    const at = { x: sub.minX + cell.x, y: cell.y, z: sub.minZ + cell.z };
    w.blocks.set(at.x, at.y, at.z, Block.Air);
    w.parkour.crumbles.set(cell.platform, { fallAt: 0, backAt: 0, gone: true });
    Object.assign(fixture.players.get(ids[0])!, { x: at.x + .5, y: at.y, z: at.z + .5 });
    h.game.tick(.05);
    assert.equal(w.blocks.getBlock(at.x, at.y, at.z), Block.Air, 'occupied restore never grows into a living body');
    assert.ok(w.parkour.pendingRestore.size > 0, 'blocked restore is retained for retry');
    h.send(ids[0], { t: 'leaveMatch' });
    h.send(ids[0], { t: 'play', mode: 'duels' });
    const opponent = h.join(); h.send(opponent, { t: 'play', mode: 'duels' });
    Object.assign(fixture.players.get(ids[0])!, { x: at.x + .5, y: at.y, z: at.z + .5 });
    h.game.tick(.05);
    assert.equal(w.blocks.getBlock(at.x, at.y, at.z), cell.block, 'same coordinates in another world cannot obstruct a pending restore');
  }
  {
    const h = new Harness(), ids = [h.join(), h.join(), h.join()];
    h.send(ids[0], { t: 'partyCreate' });
    const code = h.last(ids[0], 'party').party!.code;
    for (const id of ids.slice(1)) h.send(id, { t: 'partyJoin', code });
    h.send(ids[0], { t: 'play', mode: 'duels' }); h.ready(ids);
    const fixture = h.game as unknown as {
      duels: Duels; players: Map<number, { duelRespawning: boolean; health: number }>;
    };
    const d = fixture.duels, end = d.snapshotFor(ids[0], 3_100)!.endsAt!;
    d.participantFor(ids[1])!.kills = 1;
    d.recordDeath(ids[1], ids[0], end - 1_000);
    const victim = fixture.players.get(ids[1])!;
    victim.duelRespawning = true; victim.health = 1;
    h.out.push(...h.game.tick(end / 1000 - 3.1));
    assert.equal(victim.duelRespawning, true, 'sudden death preserves pending core respawn state');
    h.out.push(...h.game.tick(2.01));
    assert.equal(h.game.healthOf(ids[1]), 40, 'tied dead leader receives actual healthy core respawn');
    assert.equal(h.last(ids[1], 'duelRespawn').spectating, false);
    d.recordDeath(ids[0], ids[1], end + 2_010);
    h.game.tick(26);
    assert.ok(h.game.worldOf(ids[1]), 'Duels results retain their domain 30-second window');
    h.game.tick(4.1);
    assert.equal(h.game.worldCount(), 0, 'domain expiry closes world through production teardown');
  }
  for (const departure of ['leave', 'disconnect'] as const) {
    const h = new Harness(), ids = [h.join(), h.join()];
    for (const id of ids) h.send(id, { t: 'play', mode: 'duels' }); h.ready(ids);
    const d = (h.game as unknown as { duels: Duels }).duels;
    d.participantFor(ids[0])!.kills = 1;
    h.out.push(...h.game.tick(DUEL_ROUND_MS / 1000 + .1));
    assert.equal(h.last(ids[1], 'duelState').snapshot.phase, 'results');
    if (departure === 'leave') h.send(ids[0], { t: 'leaveMatch' });
    else h.out.push(...h.game.disconnect(ids[0]));
    h.out.push(...h.game.tick(60));
    assert.equal(h.game.worldCount(), 0, `${departure} during results closes the returned-to-lobby world`);
    assert.equal(h.game.worldOf(ids[1]), null, 'the surviving player is returned to the menu');
    h.last(ids[1], 'leftWorld');
    h.send(ids[1], { t: 'play', mode: 'bridge' });
    assert.equal(h.last(ids[1], 'queue').mode, 'bridge', 'the survivor can queue for another mode');
  }
  {
    const h = new Harness(), ids = [h.join(), h.join()];
    for (const id of ids) h.send(id, { t: 'play', mode: 'duels' }); h.ready(ids);
    const p = h.game.positionOf(ids[0])!;
    const world = h.game.worldOf(ids[0])!;
    h.send(ids[0], { t: 'xform', world: world.id, ...p, yaw: 0, pitch: 0, held: Block.OakPlanks });
    const original = h.game.worldEditCount(world.id);
    h.send(ids[0], { t: 'edit', x: 35, y: 100, z: 35, block: Block.OakPlanks });
    assert.equal(h.game.worldEditCount(world.id), original, 'Duels cannot remotely build across arena');
    const x = Math.floor(p.x) + 2, y = Math.floor(p.y), z = Math.floor(p.z);
    h.send(ids[0], { t: 'edit', x, y, z, block: Block.OakPlanks });
    assert.equal(h.last(ids[0], 'edit').block, Block.OakPlanks, 'ordinary nearby attached cover remains unlimited');
    h.send(ids[0], { t: 'useHeal', item: Item.Medkit });
    assert.equal(h.game.healthOf(ids[0]), 40);
    h.game.terminateExhibition(world.id);
    assert.equal(h.game.worldCount(), 1, 'test teardown hook cannot terminate a human match');
  }
  {
    const h = new Harness();
    const world = h.game.startExhibition('duels', [{ skill: .4 }, { skill: .6 }]);
    assert.equal(h.game.botCount(), 2);
    h.game.terminateExhibition(world);
    assert.equal(h.game.botCount(), 0, 'exhibition teardown dismisses bots');
    assert.equal(h.game.worldCount(), 0);
    assert.equal(h.game.worldEditCount(world), -1, 'world block state is released');
  }
}
