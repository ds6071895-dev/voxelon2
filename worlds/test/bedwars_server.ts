import assert from 'node:assert/strict';
import { GameServer, BOT_WAIT_MS, type Outbound } from '../src/net/server_core';
import type { ClientMsg, ServerMsg } from '../src/net/protocol';
import { mulberry32 } from '../src/noise';

class Lobby {
  readonly game = new GameServer({ rng: mulberry32(781) });
  readonly boxes = new Map<number, ServerMsg[]>();
  deliver(out: Outbound[]): void {
    for (const { to, msg } of out) {
      const box = this.boxes.get(to) ?? [];
      box.push(msg); this.boxes.set(to, box);
    }
  }
  join(): number { const id = this.game.connect(); this.send(id, { t: 'hello' }); return id; }
  send(id: number, msg: ClientMsg): void { this.deliver(this.game.handle(id, msg)); }
  last<T extends ServerMsg['t']>(id: number, t: T): Extract<ServerMsg, { t: T }> | undefined {
    return [...this.boxes.get(id) ?? []].reverse().find(m => m.t === t) as Extract<ServerMsg, { t: T }> | undefined;
  }
  tick(seconds: number): void { for (let i = 0; i < Math.ceil(seconds * 20); i++) this.deliver(this.game.tick(.05)); }
  party(n: number): number[] {
    const ids = Array.from({ length: n }, () => this.join());
    this.send(ids[0], { t: 'partyCreate' });
    const code = this.last(ids[0], 'party')!.party!.code;
    for (const id of ids.slice(1)) this.send(id, { t: 'partyJoin', code });
    return ids;
  }
  assign(ids: number[], solo: number, fill = false): number {
    const revision = this.last(ids[0], 'party')!.party!.bedwars?.revision ?? 0;
    this.send(ids[0], { t: 'bwSetup', teams: 2, assignments: Object.fromEntries(ids.map(id => [String(id), id === solo ? 1 : 0])), fill, revision });
    return this.last(ids[0], 'party')!.party!.bedwars!.revision;
  }
  start(ids: number[], revision: number): void {
    this.send(ids[0], { t: 'play', mode: 'bedwars', setupRevision: revision });
    for (const id of ids) this.send(id, { t: 'worldReady', world: this.game.worldOf(id)!.id });
    this.tick(5.2);
  }
}

export function runBedwarsServerTests(): void {
  for (let soloIndex = 0; soloIndex < 3; soloIndex++) {
    const h = new Lobby(), ids = h.party(3), revision = h.assign(ids, ids[soloIndex]);
    h.start(ids, revision);
    const world = h.game.worldOf(ids[0])!;
    assert.equal(world.kind, 'bedwars');
    assert.equal(new Set(ids.map(id => h.game.worldOf(id)!.id)).size, 1);
    for (const id of ids) assert.equal(h.last(id, 'bwArena')!.team, id === ids[soloIndex] ? 1 : 0);
    assert.equal(h.game.bedwars(world.id)!.phase, 'playing');
    assert.equal(h.game.botCount(), 0, '2v1 never silently fills');
    h.send(ids[0], { t: 'bwSetup', teams: 2, assignments: {}, fill: false, revision });
    assert.match(h.last(ids[0], 'partyErr')!.message, /Finish/);
    for (const id of ids) h.send(id, { t: 'leaveMatch' });
    assert.equal(h.game.worldCount(), 0);
  }
  {
    const h = new Lobby(), ids = h.party(3), revision = h.assign(ids, ids[2], true);
    h.start(ids, revision);
    const w = h.game.worldOf(ids[0])!;
    assert.equal(h.game.worldMembers(w.id).length, 4);
    assert.equal(h.game.botCount(), 1);
    assert.equal([...h.game.bedwars(w.id)!.players.values()].find(p => p.bot)!.team, 1);
  }
  {
    const h = new Lobby(), ids = h.party(4);
    const assignments: Record<string, number> = { [ids[0]]: 0, [ids[1]]: 1, [ids[2]]: 1, [ids[3]]: 0 };
    h.send(ids[1], { t: 'bwSetup', teams: 2, assignments, fill: false, revision: 0 });
    assert.match(h.last(ids[1], 'partyErr')!.message, /leader/);
    h.send(ids[0], { t: 'bwSetup', teams: 2, assignments, fill: false, revision: 0 });
    const revision = h.last(ids[0], 'party')!.party!.bedwars!.revision;
    h.send(ids[0], { t: 'play', mode: 'bedwars', setupRevision: revision - 1 });
    assert.equal(h.game.worldCount(), 0, 'stale start rejected');
    h.start(ids, revision);
    for (const id of ids) assert.equal(h.last(id, 'bwArena')!.team, assignments[id]);
  }
  {
    const h = new Lobby(), ids = h.party(3), rev = h.assign(ids, ids[2]);
    h.send(ids[0], { t: 'play', mode: 'bedwars', setupRevision: rev });
    assert.equal(h.game.worldCount(), 1);
    h.send(ids[2], { t: 'partyLeave' });
    assert.equal(h.game.worldCount(), 0, 'membership change cancels loading');
    for (const id of ids) assert.equal(h.game.worldOf(id), null);
  }
  {
    const h = new Lobby(), ids = h.party(2), revision = h.assign(ids, ids[1]);
    h.start(ids, revision);
    const original = h.game.worldOf(ids[0])!.id;
    const token = h.last(ids[0], 'welcome')!.resumeToken;
    const bw = h.game.bedwars(original)!;
    h.deliver(h.game.disconnect(ids[0]));
    assert.equal(h.game.worldOf(ids[0])!.id, original, 'grace retains world');
    assert.equal(bw.players.get(ids[0])!.deaths, 1, 'disconnect counts as death');
    const fresh = h.game.connect();
    assert.equal(h.game.resume(fresh, 'invalid'), null);
    const resumed = h.game.resume(fresh, token)!;
    assert.ok(resumed, 'secret token resumes participant');
    assert.equal(resumed.id, ids[0]);
    h.deliver(resumed.out);
    assert.equal(h.last(ids[0], 'bwArena')!.world.id, original);
    assert.equal(h.last(ids[0], 'party')!.party!.members.length, 2);
    assert.notEqual(h.last(ids[0], 'welcome')!.resumeToken, token, 'token rotates');
    h.send(ids[0], { t: 'worldReady', world: original });
    h.tick(6);
    assert.equal(bw.players.get(ids[0])!.alive, true);
    const newcomer = h.game.connect();
    assert.equal(h.game.resume(newcomer, token), null, 'old token cannot seize session');
  }
  {
    const h = new Lobby(), a = h.join();
    h.send(a, { t: 'play', mode: 'bedwars' }); h.tick(BOT_WAIT_MS / 1000 + .1);
    const w = h.game.worldOf(a)!;
    assert.equal(w.kind, 'bedwars'); assert.equal(h.game.botCount(), 3, 'a lone queuer gets three bots: one per island');
    h.send(a, { t: 'worldReady', world: w.id }); h.tick(5.2);
    h.deliver(h.game.disconnect(a)); h.tick(31);
    assert.equal(h.game.worldCount(), 0, 'expired last human releases the world');
    assert.equal(h.game.botCount(), 0);
  }
  {
    const h = new Lobby(), ids = Array.from({ length: 8 }, () => h.join());
    for (const id of ids) h.send(id, { t: 'play', mode: 'bedwars' });
    for (const id of ids) h.send(id, { t: 'worldReady', world: h.game.worldOf(id)!.id });
    h.tick(5.2);
    assert.equal(h.game.botCount(), 0, 'four people fill a match on their own');
    assert.equal(new Set(ids.slice(0, 4).map(id => h.game.worldOf(id)!.id)).size, 1, 'the first four play together');
    const own = h.game.worldOf(ids[0])!.id, other = h.game.worldOf(ids[4])!.id;
    assert.notEqual(own, other);
    h.send(ids[0], { t: 'bwAction', world: other, action: { kind: 'place', x: 0, y: 98, z: 0, slot: 1 } });
    h.send(ids[0], { t: 'edit', x: 0, y: 98, z: 0, block: 7 });
    assert.equal(h.game.worldEditCount(other), 0);
    assert.equal(h.game.worldEditCount(own), 0);
    for (const o of h.game.snapshots()) {
      if (o.msg.t !== 'snapshot') continue;
      const members = h.game.worldMembers(h.game.worldOf(o.to)!.id);
      assert.ok(o.msg.players.every(p => members.includes(p.id)), 'snapshots remain world-local');
    }
  }
  {
    // Two people queue together inside the wait: two people and two bots.
    const h = new Lobby(), a = h.join(), b = h.join();
    h.send(a, { t: 'play', mode: 'bedwars' }); h.tick(3); h.send(b, { t: 'play', mode: 'bedwars' });
    h.tick(BOT_WAIT_MS / 1000 - 2.9);
    const w = h.game.worldOf(a)!;
    assert.equal(h.game.worldOf(b)!.id, w.id, 'both humans in one match');
    assert.equal(h.game.botCount(), 2, 'the other two islands get bots');
    assert.equal(new Set([...h.game.bedwars(w.id)!.players.values()].map(p => p.team)).size, 4, 'four teams, one island each');
  }
  {
    // A party picks its format: 1v1v1v1 with bots on the spare islands.
    const h = new Lobby(), ids = h.party(2);
    h.send(ids[0], { t: 'bwSetup', teams: 4, assignments: { [ids[0]]: 0, [ids[1]]: 2 }, fill: true, revision: 0 });
    h.start(ids, h.last(ids[0], 'party')!.party!.bedwars!.revision);
    const w = h.game.worldOf(ids[0])!;
    const teams = [...h.game.bedwars(w.id)!.players.values()].map(p => p.team).sort();
    assert.deepEqual(teams, [0, 1, 2, 3], 'four teams with bots filling two');
    assert.equal(h.game.bedwars(w.id)!.teamCount, 4);
    // Without fill every team needs a person.
    const h2 = new Lobby(), ids2 = h2.party(2);
    h2.send(ids2[0], { t: 'bwSetup', teams: 3, assignments: { [ids2[0]]: 0, [ids2[1]]: 1 }, fill: false, revision: 0 });
    h2.send(ids2[0], { t: 'play', mode: 'bedwars', setupRevision: h2.last(ids2[0], 'party')!.party!.bedwars!.revision });
    assert.equal(h2.game.worldCount(), 0, 'an empty team without bot fill cannot start');
  }
  console.log('  ✓ Bedwars party formats, lifecycle, resume, the bot-filled queue and isolation');
}
