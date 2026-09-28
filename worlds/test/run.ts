// Worlds headless test suite: the server rules that matter most, driven
// through the same pure GameServer the WebSocket shell runs.
//   npm test

import { GameServer, BOT_WAIT_MS, type Outbound } from '../src/net/server_core';
import { Accounts } from '../src/net/accounts';
import { NameRegistry } from '../src/net/names';
import { Parties, PARTY_CODE_COOLDOWN_MS } from '../src/net/parties';
import { isGeneratedName, normalizePartyCode, type ClientMsg, type ServerMsg } from '../src/net/protocol';
import { WorldBlocks, worldGenerator } from '../src/multiverse';
import { Block } from '../src/blocks';
import { mulberry32 } from '../src/noise';
import { Player } from '../src/player';
import { FROZEN_INPUT } from '../src/input';
import type { World } from '../src/world';
import { RatSeekMatch } from '../src/ratseek';
import { SeekerBot } from '../src/ratseek_bot';

let passed = 0, failed = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (ok) passed++;
  else { failed++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
}
function section(name: string): void { console.log(`▸ ${name}`); }

/** A tiny harness: one server, a clock, and every message each client got. */
class Harness {
  readonly server: GameServer;
  readonly inbox = new Map<number, ServerMsg[]>();
  constructor(seed = 1) {
    const rng = mulberry32(seed);
    this.server = new GameServer({ accounts: new Accounts(), rng, token: () => Math.floor(rng() * 1e16).toString(36).padEnd(32, 'x') });
  }
  deliver(out: Outbound[]): void {
    for (const o of out) {
      let box = this.inbox.get(o.to);
      if (!box) this.inbox.set(o.to, box = []);
      box.push(o.msg);
    }
  }
  join(hello: Partial<Extract<ClientMsg, { t: 'hello' }>> = {}): number {
    const id = this.server.connect();
    this.send(id, { t: 'hello', ...hello });
    return id;
  }
  send(id: number, msg: ClientMsg): void { this.deliver(this.server.handle(id, msg)); }
  tick(seconds: number, step = 0.05): void {
    for (let t = 0; t < seconds - 1e-9; t += step) {
      this.deliver(this.server.tick(step));
      this.deliver(this.server.snapshots());
    }
  }
  last<T extends ServerMsg['t']>(id: number, t: T): Extract<ServerMsg, { t: T }> | undefined {
    const box = this.inbox.get(id) ?? [];
    for (let i = box.length - 1; i >= 0; i--) if (box[i].t === t) return box[i] as Extract<ServerMsg, { t: T }>;
    return undefined;
  }
  all(id: number): ServerMsg[] { return this.inbox.get(id) ?? []; }
  name(id: number): string { return this.last(id, 'identity')?.username ?? this.last(id, 'welcome')!.username; }
  /** Report every world's spawn bubble built, so countdowns arm. */
  ready(...ids: number[]): void {
    for (const id of ids) {
      const w = this.server.worldOf(id);
      const rev = this.last(id, 'pgArena')?.revision;
      if (w) this.send(id, { t: 'worldReady', world: w.id, revision: rev });
    }
  }
}

// ── Names ────────────────────────────────────────────────────────────────────
section('names never overlap');
{
  const h = new Harness(7);
  const ids = Array.from({ length: 400 }, () => h.join());
  const names = ids.map((id) => h.name(id).toLowerCase());
  check('400 guests get 400 distinct names', new Set(names).size === names.length);
  check('every name is a generated name', ids.every((id) => isGeneratedName(h.name(id))));
  // A second socket asking for a name somebody is using does not get it.
  const taken = h.name(ids[0]);
  const dup = h.join({ guest: taken });
  check('a held guest name is not handed to another socket', h.name(dup) !== taken);
  // A disconnected guest's name comes free again.
  h.deliver(h.server.disconnect(ids[1]));
  const freed = h.name(ids[1]);
  const again = h.join({ guest: freed });
  check('a released guest name can be reclaimed', h.name(again) === freed);

  // Registered names are never issued to anybody else.
  const reg = h.join();
  const regName = h.name(reg);
  h.send(reg, { t: 'register', username: regName, password: 'hunter22' });
  check('register keeps the current name', h.last(reg, 'identity')?.account === true && h.name(reg) === regName);
  h.deliver(h.server.disconnect(reg));
  const thief = h.join({ guest: regName });
  check('a registered (offline) name is never given to a guest', h.name(thief).toLowerCase() !== regName.toLowerCase());
  check('custom names cannot be registered', (() => {
    const c = h.join();
    h.send(c, { t: 'register', username: 'CoolCustomName', password: 'hunter22' });
    return !!h.last(c, 'authErr') && h.last(c, 'identity') === undefined;
  })());
  // Sign-in: the owner gets it back; a second session is refused.
  const owner = h.join();
  h.send(owner, { t: 'login', username: regName, password: 'hunter22' });
  check('sign-in restores the account name', h.name(owner) === regName && h.last(owner, 'identity')?.account === true);
  const second = h.join();
  h.send(second, { t: 'login', username: regName, password: 'hunter22' });
  check('one account cannot be signed in twice at once', !!h.last(second, 'authErr') && h.name(second) !== regName);
  h.send(second, { t: 'login', username: regName, password: 'wrong-pass' });
  check('wrong passphrase refused', h.last(second, 'authErr')?.error.includes('Wrong') === true);
  // Rolled offers are reserved while offered.
  const roller = h.join();
  h.send(roller, { t: 'rollName' });
  const offer = h.last(roller, 'nameOffer')!.name;
  const sniper = h.join({ guest: offer });
  check('a name offered to someone is not handed out meanwhile', h.name(sniper) !== offer);
  h.send(roller, { t: 'register', username: offer, password: 'passpass' });
  check('registering an offered name works', h.name(roller) === offer);
  // Session resume.
  const token = h.last(roller, 'identity')!.token!;
  h.deliver(h.server.disconnect(roller));
  const back = h.join({ session: { username: offer, token } });
  check('session token resumes the account', h.name(back) === offer && h.last(back, 'identity')?.account === true);
  h.send(back, { t: 'logout' });
  check('logging out hands out a new temporary name', h.name(back) !== offer && h.last(back, 'identity')?.account === false);

  const reg2 = new NameRegistry(() => false);
  const rng = mulberry32(3);
  const many = new Set<string>();
  for (let i = 0; i < 40000; i++) many.add(reg2.roll(`h${i}`, rng).toLowerCase());
  check('40 000 rolls, all distinct (digit tail grows when crowded)', many.size === 40000, `${many.size}`);
}

// ── Party codes ─────────────────────────────────────────────────────────────
section('party codes never overlap');
{
  const parties = new Parties(mulberry32(11));
  const codes = new Set<string>();
  for (let i = 0; i < 5000; i++) codes.add(parties.create(i, 0).code);
  check('5000 live parties, 5000 distinct codes', codes.size === 5000);
  check('codes use the unambiguous alphabet', [...codes].every((c) => normalizePartyCode(c) === c));
  // A disbanded code is not reissued while cooling down: an rng that rolls
  // the SAME code twice and then a different one must skip to the second.
  const seq = [...Array(6).fill(0), ...Array(6).fill(0), ...Array(6).fill(0.5)];
  let n = 0;
  const q = new Parties(() => seq[Math.min(n++, seq.length - 1)]);
  const a = q.create(1, 0).code;
  q.leave(1, 10);
  const b = q.create(2, 20).code;
  check('a released code is held back during its cool-down', a !== b && b.length === 6);
  const later = new Parties(() => 0);
  const c0 = later.create(1, 0).code;
  later.leave(1, 0);
  check('...and comes back once the cool-down has passed', later.create(2, PARTY_CODE_COOLDOWN_MS + 1).code === c0);
  const c = new Parties(mulberry32(5));
  const party = c.create(1, 0);
  for (const id of [2, 3, 4]) c.join(id, party.code);
  const full = c.join(5, party.code);
  check('parties cap at four', !full.ok && full.error === 'full');
  check('codes are case-insensitive', c.join(2, party.code.toLowerCase()).ok);
  c.leave(1, 0);
  check('leadership passes on when the leader leaves', c.of(2)?.leader === 2);
}

// ── Matchmaking, worlds, bots ────────────────────────────────────────────────
section('matchmaking puts each match in its own world');
{
  const h = new Harness(21);
  const a = h.join(), b = h.join(), c = h.join(), d = h.join();
  h.send(a, { t: 'play', mode: 'duels' });
  check('first player waits', h.last(a, 'queue')?.mode === 'duels' && h.server.worldOf(a) === null);
  h.send(b, { t: 'play', mode: 'duels' });
  const wa = h.server.worldOf(a), wb = h.server.worldOf(b);
  check('second player makes a match', !!wa && !!wb && wa.id === wb.id && wa.kind === 'duel');
  h.send(c, { t: 'play', mode: 'duels' });
  h.send(d, { t: 'play', mode: 'duels' });
  const wc = h.server.worldOf(c);
  check('a second match gets a DIFFERENT world', !!wc && wc.id !== wa!.id);
  check('both worlds are authored at the same origin', !!h.last(a, 'duelArena') && !!h.last(c, 'duelArena') &&
    h.last(a, 'duelArena')!.arena.originX === 0 && h.last(c, 'duelArena')!.arena.originX === 0);
  // Opponents only ever hear about their own world.
  const joinsA = h.all(a).filter((m) => m.t === 'join').map((m) => (m as Extract<ServerMsg, { t: 'join' }>).player.id);
  check('a player is introduced only to their own opponent', joinsA.length === 1 && joinsA[0] === b);
  h.ready(a, b, c, d);
  h.tick(4);
  const snapA = h.last(a, 'snapshot')!;
  check('snapshots list only the bodies in your world', snapA.players.every((s) => s.id === a || s.id === b));
  // Blocks placed in one world never appear in another.
  const pos = h.server.positionOf(a)!;
  h.send(a, { t: 'xform', world: wa!.id, x: pos.x, y: pos.y, z: pos.z, yaw: 0, pitch: 0, held: Block.OakPlanks });
  h.send(a, { t: 'edit', x: Math.floor(pos.x) + 1, y: Math.floor(pos.y), z: Math.floor(pos.z), block: Block.OakPlanks });
  check('a placed plank lands in its own world', h.server.worldEditCount(wa!.id) === 1 && h.server.worldEditCount(wc!.id) === 0);
  check('only that world hears about it', h.all(b).some((m) => m.t === 'edit') && !h.all(c).some((m) => m.t === 'edit'));
  // Leaving: the world closes once no humans are left.
  h.send(a, { t: 'leaveMatch' });
  check('leaving sends you back to the menu', h.last(a, 'leftWorld') !== undefined && h.server.worldOf(a) === null);
  h.send(b, { t: 'leaveMatch' });
  check('an empty world is torn down', h.server.worldCount() === 1);
}

section('practice opponents fill in silently after 15 s');
{
  const h = new Harness(33);
  const a = h.join();
  h.send(a, { t: 'play', mode: 'bridge' });
  h.tick(BOT_WAIT_MS / 1000 - 1);
  check('no opponent before the wait', h.server.worldOf(a) === null);
  h.tick(1.2);
  const w = h.server.worldOf(a);
  check('an opponent joins after the wait', !!w && w.kind === 'bridge');
  const members = h.server.worldMembers(w!.id);
  const bot = members.find((id) => id !== a)!;
  check('the opponent is a generated, human-looking name', isGeneratedName(h.server.usernameOf(bot)));
  const wire = JSON.stringify(h.all(a));
  check('nothing on the wire marks it as a bot', !/"bot"|\[Bot\]|practice/i.test(wire));
  check('its id comes from the same sequence as players', bot > a && bot < 1000);
  h.ready(a);
  h.tick(6);
  const snap = h.last(a, 'pgState')!.snapshot;
  check('the match runs', snap.phase === 'running');
  h.send(a, { t: 'leaveMatch' });
  check('leaving dismisses the opponent and the world', h.server.worldCount() === 0 && h.server.botCount() === 0);
  // Names used by bots are released.
  check('bot names are released afterwards', !h.server.names.inUse(h.server.usernameOf(bot) ?? 'x'));
}

section('queue sizes: 2 from matchmaking');
{
  const h = new Harness(44);
  const ids = [h.join(), h.join(), h.join()];
  for (const id of ids) h.send(id, { t: 'play', mode: 'parkour' });
  const w0 = h.server.worldOf(ids[0]), w2 = h.server.worldOf(ids[2]);
  check('parkour queue matches two racers, not three', !!w0 && h.server.worldMembers(w0.id).length === 2 && w2 === null);
}

section('parties');
{
  const h = new Harness(55);
  const lead = h.join(), m1 = h.join(), m2 = h.join(), m3 = h.join(), m4 = h.join();
  h.send(lead, { t: 'partyCreate' });
  const code = h.last(lead, 'party')!.party!.code;
  for (const id of [m1, m2, m3]) h.send(id, { t: 'partyJoin', code });
  h.send(m4, { t: 'partyJoin', code });
  check('a fifth member is refused', h.last(m4, 'partyErr')?.message.includes('full') === true);
  check('everyone sees four members', h.last(m3, 'party')!.party!.members.length === 4);
  h.send(m1, { t: 'play', mode: 'duels' });
  check('only the leader can start', h.last(m1, 'partyErr')?.message.includes('leader') === true);
  h.send(lead, { t: 'play', mode: 'bridge' });
  check('The Bridge refuses a party of four', h.last(lead, 'partyErr')?.message.includes('exactly 2') === true && h.server.worldOf(lead) === null);
  h.send(lead, { t: 'play', mode: 'parkour' });
  const w = h.server.worldOf(lead);
  check('Parkour takes a party of four into ONE world', !!w && h.server.worldMembers(w.id).length === 4 &&
    [m1, m2, m3].every((id) => h.server.worldOf(id)?.id === w.id));
  check('no practice opponent joins a party match', h.server.botCount() === 0);
  check('four racers get four distinct spawns', (() => {
    const spots = [lead, m1, m2, m3].map((id) => h.last(id, 'pgArena')!.spawn).map((s) => `${s.x.toFixed(2)},${s.z.toFixed(2)}`);
    return new Set(spots).size === 4;
  })());
  h.send(lead, { t: 'leaveMatch' });
  h.send(lead, { t: 'play', mode: 'duels' });
  check('the leader cannot start while members are mid-match', h.last(lead, 'partyErr')?.message.includes('finish') === true);
  for (const id of [m1, m2, m3]) h.send(id, { t: 'leaveMatch' });
  h.send(lead, { t: 'play', mode: 'duels' });
  const wd = h.server.worldOf(lead);
  check('a party of four plays Duels together', !!wd && h.server.worldMembers(wd.id).length === 4);
  for (const id of [lead, m1, m2, m3]) h.send(id, { t: 'leaveMatch' });
  h.send(m2, { t: 'partyLeave' }); h.send(m3, { t: 'partyLeave' });
  h.send(lead, { t: 'play', mode: 'bridge' });
  const wbr = h.server.worldOf(lead);
  check('a party of two plays The Bridge against each other', !!wbr && wbr.kind === 'bridge' && h.server.worldOf(m1)?.id === wbr.id);
  const teams = [lead, m1].map((id) => h.last(id, 'pgArena')!.team).sort();
  check('...on opposite sides', teams[0] === 0 && teams[1] === 1);
  // Temporary names can party.
  check('temporary players can make and join parties', h.last(m1, 'party')?.party?.members.some((m) => m.id === lead) === true);
}

section('many worlds at once');
{
  const h = new Harness(66);
  const players = Array.from({ length: 600 }, () => h.join());
  const modes = ['duels', 'bridge', 'parkour'] as const;
  players.forEach((id, i) => h.send(id, { t: 'play', mode: modes[i % 3] }));
  check('600 players make 300 simultaneous worlds', h.server.worldCount() === 300, `${h.server.worldCount()}`);
  const ids = new Set(players.map((id) => h.server.worldOf(id)!.id));
  check('every match has its own world id', ids.size === 300);
  for (const id of players) h.ready(id);
  const t0 = performance.now();
  h.tick(3);
  const ms = (performance.now() - t0) / 60;
  check(`300 worlds tick fast enough (${ms.toFixed(2)} ms/tick)`, ms < 25);
  for (const id of players) h.deliver(h.server.disconnect(id));
  check('all worlds freed after everyone leaves', h.server.worldCount() === 0);
}

section('world blocks');
{
  const gen = worldGenerator({ kind: 'bridge', seed: 1 });
  const blocks = new WorldBlocks(gen);
  const before = blocks.getBlock(12, 140, 40);
  blocks.set(12, 150, 40, Block.TeamWoolA);
  check('edits overlay the generator', blocks.getBlock(12, 150, 40) === Block.TeamWoolA && blocks.edits.size === 1);
  blocks.set(12, 150, 40, Block.Air);
  check('setting a cell back to authored forgets the edit', blocks.edits.size === 0);
  check('the span exists in every bridge world', before !== Block.Air);
  check('outside the venue is void', gen.blockAt(-50, 140, 40) === Block.Air && gen.blockAt(500, 140, 40) === Block.Air);
}

section('rat and seek');
{
  const h = new Harness(11);
  // Solo: you are the rat, a practice seeker hunts you, after a short "finding players".
  const a = h.join();
  h.send(a, { t: 'play', mode: 'ratseek', ratClass: 'thief' });
  check('solo rat and seek queues first', h.last(a, 'queue')?.mode === 'ratseek' && !h.server.worldOf(a));
  h.tick(BOT_WAIT_MS / 1000 - 1);
  check('and waits the usual 15 s for others', !h.server.worldOf(a));
  h.tick(1.5);
  const arena = h.last(a, 'rsArena');
  check('a lone player becomes the rat', arena?.role === 'rat', JSON.stringify(arena?.role));
  const w = h.server.worldOf(a)!;
  const members = h.server.worldMembers(w.id);
  check('a practice seeker joins them', members.length === 2);
  const rs = h.server.ratSeek(w.id)!;
  check('the seeker is the practice one', rs.botIds.size === 1 && rs.humans.size === 0 && rs.rats.has(a));
  check('the remembered class is applied', rs.classes.get(a) === 'thief');
  const text = JSON.stringify(h.all(a));
  check('nothing on the wire says bot', !/"bot"|\[Bot\]|\[AI\]/.test(text));
  h.send(a, { t: 'worldReady', world: w.id });
  h.tick(6);
  check('the intro and hiding start once everyone is in', ['hiding', 'intro'].includes(h.last(a, 'rsState')!.s.phase));
  const kit = h.last(a, 'rsKit')!.slots;
  check('the rat kit: taunt, scamper and the class rosette', kit[0]?.id === 306 && kit[1]?.id === 307 && kit[6]?.id === 317);
  h.send(a, { t: 'rsClass', cls: 'scout' });
  check('a class can be changed while hiding', rs.classes.get(a) === 'scout');

  // Solo players who queue together hide together.
  const h3 = new Harness(13);
  const q = [h3.join(), h3.join(), h3.join()];
  for (const id of q) h3.send(id, { t: 'play', mode: 'ratseek' });
  h3.tick(BOT_WAIT_MS / 1000 + 0.5);
  const qw = h3.server.worldOf(q[0]);
  check('queued players share one match as rats', !!qw && q.every((id) => h3.server.worldOf(id)?.id === qw.id &&
    h3.last(id, 'rsArena')?.role === 'rat'));
  const four = [h3.join(), h3.join(), h3.join(), h3.join()];
  for (const id of four) h3.send(id, { t: 'play', mode: 'ratseek' });
  check('four in the queue start at once', four.every((id) => !!h3.server.worldOf(id)));

  // Party: the leader picks who seeks.
  const h2 = new Harness(12);
  const [l, m1, m2] = [h2.join(), h2.join(), h2.join()];
  h2.send(l, { t: 'partyCreate' });
  const code = h2.last(l, 'party')!.party!.code;
  h2.send(m1, { t: 'partyJoin', code }); h2.send(m2, { t: 'partyJoin', code });
  h2.send(l, { t: 'play', mode: 'ratseek', seeker: m1 });
  const pw = h2.server.worldOf(l)!;
  const prs = h2.server.ratSeek(pw.id)!;
  check('the picked member seeks, the rest hide, no practice seeker', prs.humans.has(m1) && prs.rats.has(l) && prs.rats.has(m2) && prs.botIds.size === 0);
  check('the seeker is told', h2.last(m1, 'rsArena')?.role === 'human');
  h2.send(l, { t: 'leaveMatch' }); h2.send(m1, { t: 'leaveMatch' }); h2.send(m2, { t: 'leaveMatch' });
  h2.send(l, { t: 'play', mode: 'ratseek', seeker: 0 });
  const pw2 = h2.server.worldOf(l)!;
  const prs2 = h2.server.ratSeek(pw2.id)!;
  check('or a practice seeker hunts the whole party', prs2.botIds.size === 1 && prs2.rats.size === 3 && prs2.humans.size === 0);
}
{
  // Stairs and mouseholes, with the real player physics in the real manor.
  const wb = new WorldBlocks(worldGenerator({ kind: 'ratseek', seed: 1 })).asWorld() as unknown as World;
  const climb = (scale: number): number => {
    const p = new Player({ x: -1, y: 81, z: -15.2 });
    p.setBodyScale(scale);
    p.yaw = Math.PI;
    for (let i = 0; i < 100; i++) p.update(0.05, { ...FROZEN_INPUT, forward: true }, wb);
    return p.pos.y;
  };
  check('a seeker walks up a flight of stairs without jumping', Math.abs(climb(1) - 87) < 0.05);
  check('so does a rat', Math.abs(climb(0.5) - 87) < 0.05);
  const crawl = (scale: number): number => {
    const p = new Player({ x: -2.5, y: 81, z: -8.5 });
    p.setBodyScale(scale);
    p.yaw = Math.PI / 2;
    for (let i = 0; i < 60; i++) p.update(0.05, { ...FROZEN_INPUT, forward: true }, wb);
    return p.pos.x;
  };
  check('a rat fits through a mousehole', crawl(0.5) < -4.4);
  check('a seeker does not', crawl(1) > -3.8);
}
{
  // The twists lean with the game, silently: Spotlight while the rats run away
  // with it, Ghost Rats while they are losing.
  const rng = mulberry32(5);
  const bodies = new Map<number, { x: number; y: number; z: number; yaw: number; pitch: number; sneaking: boolean }>();
  const host = {
    nowMs: () => 0, body: (id: number) => bodies.get(id), name: (id: number) => `P${id}`, send: () => {},
    teleport: (id: number, x: number, y: number, z: number) => { bodies.set(id, { x, y, z, yaw: 0, pitch: 0, sneaking: false }); },
    setBlock: () => {}, getBlock: () => Block.Air, drive: () => {},
  };
  const count = (standing: 'winning' | 'losing'): Record<string, number> => {
    const m = new RatSeekMatch(host, rng, { humans: [9], bots: [], rats: [1, 2, 3, 4], classes: new Map(), skill: 0.7 });
    const internals = m as unknown as { phase: string; huntStartTick: number; ticks: number; heat: number;
      triggerTwist(): void; lastTwist: string | null; rats: Map<number, string> };
    internals.phase = 'hunting';
    const tally: Record<string, number> = {};
    for (let i = 0; i < 2000; i++) {
      internals.ticks = standing === 'winning' ? 4000 : 400; internals.huntStartTick = 0;
      internals.heat = standing === 'winning' ? 0 : 1.2;
      internals.lastTwist = null;
      internals.triggerTwist();
      tally[internals.lastTwist!] = (tally[internals.lastTwist!] ?? 0) + 1;
    }
    return tally;
  };
  const up = count('winning'), down = count('losing');
  check('rats winning: Spotlight much more often', (up.spotlight ?? 0) > 3 * (up.ghost_rats ?? 0) && (up.spotlight ?? 0) > 700, JSON.stringify(up));
  check('rats losing: Ghost Rats much more often', (down.ghost_rats ?? 0) > 3 * (down.spotlight ?? 0) && (down.ghost_rats ?? 0) > 700, JSON.stringify(down));
}
{
  // The practice seeker adapts to the outcome: sharper while the rats run away
  // with it, gentler while it is cruising.
  const bot = new SeekerBot({} as never, 1, 0.7, mulberry32(3));
  for (let i = 0; i < 30; i++) bot.adapt(0.8);
  check('the seeker sharpens up against strong rats', bot.skill > 1.2, bot.skill.toFixed(2));
  for (let i = 0; i < 60; i++) bot.adapt(-0.9);
  check('and eases off when it is winning easily', bot.skill < 0.3, bot.skill.toFixed(2));
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
