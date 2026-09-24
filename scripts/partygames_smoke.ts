import {
  BRIDGE_CAGE_FLOOR, BRIDGE_GOALS, BRIDGE_GOAL_LIMIT, BRIDGE_GOAL_RESET_MS,
  BRIDGE_LANE_X, BRIDGE_SIZE_X, BRIDGE_SIZE_Z, BRIDGE_TEAM_BLOCK,
  BRIDGE_MELEE_TIER, BRIDGE_SWING_JITTER_MS, BRIDGE_BOW_COOLDOWN_MS, bridgeSwing,
  PARTY_ARENA_LOAD_TIMEOUT_MS, PARTY_CAPACITY, PARTY_COUNTDOWN_MS, PARTY_FLOOR_Y,
  PARTY_MAX_HEALTH, PARTY_RESULT_MS, PARTY_STAMP_MAX_Y, PARTY_STAMP_MIN_Y, PARTY_VOID_Y,
  PartyGamesEngine, bridgeCageHatch, bridgeCageSpawn, bridgeGoalGuard, bridgeSpawn,
  parkourCourse, partyArenaBlockAt,
  partySpawns, type PartyLobbySnapshot, type PartyMode,
} from '../src/partygames';
import { GameServer, type Outbound } from '../src/net/server_core';
import { Block, BLOCKS } from '../src/blocks';
import { Item } from '../src/items';
import type { ClientMsg } from '../src/net/protocol';

let passed = 0;
function check(name: string, ok: unknown): asserts ok { if (!ok)
  throw new Error(`FAIL: ${name}`); passed++; }
let serial = 0;
const token = () => `${String(++serial).padStart(24, 'c')}0123456789abcdef01234567`;
const who = (id: number) => ({ id, username: `Racer${id}`, skin: id });
function prepared(mode: PartyMode = 'bridge', count = 2) {
  const e = new PartyGamesEngine(token), made = e.create(who(1), 0, mode);
  if ('reason' in made)
    throw Error('create');
  for (let i = 2; i <= count; i++)
    check('invite joins', e.join(made.token, who(i), 0).ok);
  for (let i = 1; i <= count; i++)
    e.setReady(i, true, 0);
  const start = e.start(1, 0);
  check('host starts', start.ok);
  return { e, snap: start.snapshot, token: made.token };
}
function run(e: PartyGamesEngine, snap: PartyLobbySnapshot, now: number) {
  for (const p of snap.participants.filter(p => p.connected))
    e.markArenaReady(p.id, now, snap.revision);
  const out = e.tick(now + PARTY_COUNTDOWN_MS);
  check('barrier starts the match', out[0]?.phase === 'running');
  return out[0];
}

// ── The Bridge arena ───────────────────────────────────────────────────────
{
  const { e, snap } = prepared('bridge', 2);
  check('a Bridge lobby is 1v1, private or not', snap.capacity === PARTY_CAPACITY && PARTY_CAPACITY === 2);
  check('teams are drawn evenly', snap.participants.filter(p => p.team === 0).length === 1 &&
    snap.participants.filter(p => p.team === 1).length === 1);
  check('teams follow join order', snap.participants.every(p => p.team === (p.joinOrder % 2)));
  const s = run(e, snap, 0), sub = s.sub!;
  check('the Bridge venue is the whole island chain',
    sub.maxX - sub.minX === BRIDGE_SIZE_X && sub.maxZ - sub.minZ === BRIDGE_SIZE_Z);
  const spawns = partySpawns(sub, s.participants);
  for (const [i, p] of spawns.entries()) {
    check('everyone spawns on solid ground', !!BLOCKS[partyArenaBlockAt(p.x, p.y - .1, p.z)!]?.solid);
    check('nobody spawns inside a wall',
      !BLOCKS[partyArenaBlockAt(p.x, p.y, p.z)!]?.solid && !BLOCKS[partyArenaBlockAt(p.x, p.y + 1, p.z)!]?.solid);
    const lz = p.z - sub.minZ;
    check('each side spawns behind its own portal', s.participants[i].team === 0 ? lz < BRIDGE_SIZE_Z / 2 : lz > BRIDGE_SIZE_Z / 2);
    // A round opens inside the drop cage, standing on its hatch, directly over
    // the pad the hatch drops you onto.
    const team = s.participants[i].team;
    check('a round opens inside the cage', p.y === bridgeCageSpawn(sub, team, 0).y);
    const pad = bridgeSpawn(sub, team, 0);
    check('the cage stands over its own pad', p.x === pad.x && p.z === pad.z);
    check('the drop is three blocks — never enough to hurt', p.y - pad.y === BRIDGE_CAGE_FLOOR);
    check('the pad below is real ground', !!BLOCKS[partyArenaBlockAt(pad.x, pad.y - .1, pad.z)!]?.solid);
  }
  check('the two sides spawn apart', Math.abs(spawns[0].z - spawns[1].z) > 40);
  // Every hatch cell is solid before the server opens it, and every one of them
  // has clear air the whole way down to the pad.
  for (const cell of bridgeCageHatch()) {
    const x = sub.minX + cell.lx + .5, z = sub.minZ + cell.lz + .5;
    check('the hatch is shut to begin with', !!BLOCKS[partyArenaBlockAt(x, cell.y, z)!]?.solid);
    for (let y = PARTY_FLOOR_Y + 1; y < cell.y; y++)
      check('the drop shaft is clear', !BLOCKS[partyArenaBlockAt(x, y, z)!]?.solid);
    check('the drop lands on deck', !!BLOCKS[partyArenaBlockAt(x, PARTY_FLOOR_Y, z)!]?.solid);
  }
}
// The map cannot favour a side: it is its own mirror with the wool swapped.
{
  const { e, snap } = prepared('bridge');
  const sub = run(e, snap, 0).sub!;
  const swap = (v: number | null) => v === Block.TeamWoolA ? Block.TeamWoolB : v === Block.TeamWoolB ? Block.TeamWoolA : v;
  let mismatched = 0, stamped = 0;
  for (let lz = 0; lz < BRIDGE_SIZE_Z; lz++)
    for (let lx = 0; lx < BRIDGE_SIZE_X; lx++)
      for (let y = PARTY_STAMP_MIN_Y; y <= PARTY_STAMP_MAX_Y; y++) {
        const a = partyArenaBlockAt(sub.minX + lx, y, sub.minZ + lz);
        if (swap(a) !== partyArenaBlockAt(sub.minX + lx, y, sub.minZ + BRIDGE_SIZE_Z - 1 - lz))
          mismatched++;
        if (a !== null && a !== Block.Air)
          stamped++;
      }
  check('the two bases are exact mirrors', mismatched === 0);
  check('the bases are actually built', stamped > 4000);
  // Every portal is an open shaft with a floor you land on, not a hole to the void.
  for (const g of BRIDGE_GOALS)
    for (let lx = g.minX; lx < g.maxX; lx++)
      for (let lz = g.minZ; lz < g.maxZ; lz++) {
        for (let y = PARTY_FLOOR_Y - 7; y <= PARTY_FLOOR_Y; y++)
          check('portal shaft is open', !BLOCKS[partyArenaBlockAt(sub.minX + lx + .5, y, sub.minZ + lz + .5)!]?.solid);
        check('portal has a landing floor', !!BLOCKS[partyArenaBlockAt(sub.minX + lx + .5, PARTY_FLOOR_Y - 8, sub.minZ + lz + .5)!]?.solid);
      }
  // There has to be something to build across, or the mode has no verb.
  // Sampled OFF the lane: everything either side of the span is a drop.
  let void_ = 0;
  for (let lz = 19; lz < BRIDGE_SIZE_Z - 19; lz++)
    if (!BLOCKS[partyArenaBlockAt(sub.minX + BRIDGE_LANE_X - 4.5, PARTY_FLOOR_Y, sub.minZ + lz + .5)!]?.solid) void_++;
  check('the catwalks stop short of the middle', void_ >= 16);
  // And the lane itself is one unbroken block-wide walkway with nothing beside
  // it and nothing over it, from one portal apron to the other.
  for (let lz = 9; lz <= BRIDGE_SIZE_Z - 10; lz++) {
    const x = sub.minX + BRIDGE_LANE_X + .5, z = sub.minZ + lz + .5;
    check('the span is unbroken', !!BLOCKS[partyArenaBlockAt(x, PARTY_FLOOR_Y, z)!]?.solid);
    check('the span is walkable', !BLOCKS[partyArenaBlockAt(x, PARTY_FLOOR_Y + 1, z)!]?.solid &&
      !BLOCKS[partyArenaBlockAt(x, PARTY_FLOOR_Y + 2, z)!]?.solid);
    // Both base decks and the middle island deliberately widen the route.
    // Only the suspended span between them must stay one block wide.
    if (lz < 19 || lz >= BRIDGE_SIZE_Z - 19 || (lz >= 36 && lz <= 43)) continue;
    for (const dx of [-1, 1])
      check('nothing beside the span is a footing',
        !BLOCKS[partyArenaBlockAt(x + dx, PARTY_FLOOR_Y, z)!]?.solid);
  }
}
// ── Scoring ────────────────────────────────────────────────────────────────
{
  const { e, snap } = prepared('bridge');
  const s = run(e, snap, 0), sub = s.sub!;
  const enemy = BRIDGE_GOALS[1], own = BRIDGE_GOALS[0];
  const into = (g: typeof enemy) => ({
    x: sub.minX + (g.minX + g.maxX) / 2, y: PARTY_FLOOR_Y - 6, z: sub.minZ + (g.minZ + g.maxZ) / 2,
  });
  const me = e.participantFor(1)!;
  check('team one attacks the far portal', me.team === 0);
  check('standing on your own deck is not a goal', !e.evaluate(1, { ...into(own), y: PARTY_FLOOR_Y + 1 }, 4000).changed);
  const own_ = e.evaluate(1, into(own), 4100);
  check('falling in your own portal only costs you a trip', me.score === 0 && me.falls === 1 && !!own_.spawn);
  const scored = e.evaluate(1, into(enemy), 5000);
  check('reaching the far side scores', me.score === 1 && !!scored.spawn);
  check('the scoreline is on the wire', e.snapshotFor(1, 5000)!.teamScores[0] === 1);
  check('a goal is announced', e.snapshotFor(1, 5000)!.lastGoal?.id === 1);
  const middle = { x: sub.minX + BRIDGE_LANE_X + .5, z: sub.minZ + BRIDGE_SIZE_Z / 2 };
  const sent = e.evaluate(2, { ...middle, y: PARTY_FLOOR_Y + 1 }, 5001);
  check('a goal sends the other side home too', !!sent.spawn);
  // A goal is a restart: both sides go back into a cage, and the hatch does not
  // open again for three seconds.
  check('a goal cages the rival too', sent.spawn!.y === bridgeCageSpawn(sub, 1, 0).y);
  check('a goal cages the scorer', scored.spawn!.y === bridgeCageSpawn(sub, 0, 0).y);
  check('the cage is held for three seconds', e.snapshotFor(1, 5000)!.goalResetAt === 5000 + BRIDGE_GOAL_RESET_MS);
  const fell = e.evaluate(1, { ...middle, y: PARTY_VOID_Y - 3 }, 9000);
  check('the void returns you to your own base', fell.spawn!.z === bridgeSpawn(sub, 0, 0).z && me.falls === 2);
  check('an ordinary void death is not a cage', fell.spawn!.y === bridgeSpawn(sub, 0, 0).y);
  for (let goal = 2; goal <= BRIDGE_GOAL_LIMIT; goal++)
    e.evaluate(1, into(enemy), 6000 + goal * 1000);
  const done = e.snapshotFor(1, 20000)!;
  check(`first to ${BRIDGE_GOAL_LIMIT} ends it`, done.phase === 'results' && done.result?.winnerTeam === 0);
  check('the winning side is named, not just a player', done.result?.teamScores[0] === BRIDGE_GOAL_LIMIT && done.result?.winner === 1);
  check('further scoring after the whistle is ignored', !e.evaluate(1, into(enemy), 21000).changed);
}
// Nobody can plug a portal with wool.
{
  for (const g of BRIDGE_GOALS) {
    check('the portal mouth refuses blocks', bridgeGoalGuard((g.minX + g.maxX) / 2, (g.minZ + g.maxZ) / 2));
    check('its rim refuses blocks', bridgeGoalGuard(g.minX - 1, g.minZ - 1));
  }
  check('the open deck still accepts blocks', !bridgeGoalGuard(12, 50));
}
// ── Lobby lifecycle ────────────────────────────────────────────────────────
{
  const { e, snap } = prepared('bridge', 2);
  check('invites cap at two', !e.join(e.tokenFor(1)!, who(3), 0).ok);
  e.markArenaReady(1, 0, snap.revision);
  check('one ready client cannot start the clock', e.tick(5000).length === 0 && e.snapshotFor(1, 5000)?.countdownEndsAt === undefined);
  check('wrong round ready is rejected', e.markArenaReady(2, 5000, snap.revision + 1) === null);
  const running = run(e, snap, 6000);
  check('both share a start and end', running.participants.length === 2 && running.round!.endsAt > running.round!.startedAt);
  check('wire snapshot contains finite numbers', !JSON.stringify(running).includes('null'));
}
{
  const { e, snap } = prepared();
  e.markArenaReady(1, 0, snap.revision);
  const timed = e.tick(PARTY_ARENA_LOAD_TIMEOUT_MS)[0];
  check('slow loading cancels explicitly', timed.phase === 'results' && timed.result?.finishReason === 'cancelled');
  check('cancelled match awards nobody', timed.result?.winner === null && timed.participants.every(p => p.score === 0));
}
{
  // Time runs out with the game level: nobody is handed a win.
  const { e, snap } = prepared('bridge');
  const s = run(e, snap, 0);
  const end = e.tick(s.round!.endsAt)[0];
  check('a level game at full time is a draw', end.phase === 'results' && end.result?.winnerTeam === null);
  const oldSeed = end.arena!.seed;
  e.tick(s.round!.endsAt + PARTY_RESULT_MS);
  e.setReady(1, true, 999999);
  e.setReady(2, true, 999999);
  const replay = e.start(1, 999999);
  check('rematch makes a fresh seed', replay.ok && replay.snapshot.arena?.seed !== oldSeed);
  check('rematch resets the scoreline', replay.ok && replay.snapshot.teamScores.every(v => v === 0));
}
// ── Parkour ────────────────────────────────────────────────────────────────
{
  const { e, snap } = prepared('parkour');
  check('parkour caps at two', snap.capacity === 2 && !e.join(e.tokenFor(1)!, who(3), 0).ok);
  const s = run(e, snap, 0), sub = s.sub!, course = parkourCourse(sub.seed);
  const mode = course.variant.mode, last = course.steps.length - 1;
  for (const p of partySpawns(sub, s.participants))
    check('both racers spawn on solid platforms', !!BLOCKS[partyArenaBlockAt(p.x, p.y - .1, p.z)!]?.solid);
  const at = (i: number) => ({ x: sub.minX + course.steps[i][0].x, y: course.steps[i][0].y + .01, z: sub.minZ + course.steps[i][0].z });
  e.evaluate(1, at(last), 4000);
  check('finish cannot skip the course', e.participantFor(1)!.progress === 0);
  // Far enough in to have banked exactly one checkpoint, and no further: what
  // a fall costs is the whole leg since that checkpoint, not the last jump.
  const banked = course.steps.findIndex((st, i) => i > 0 && st[0].checkpoint);
  check('the course has a checkpoint before the finish', banked > 0 && banked < last);
  for (let i = 1; i <= banked + 2; i++)
    e.evaluate(1, at(i), 4000 + i * 100);
  check('landing pads advances progress', e.participantFor(1)!.progress === banked + 2);
  const fall = e.evaluate(1, { x: sub.minX + 16, y: PARTY_VOID_Y - 1, z: sub.minZ + 40 }, 4000 + (banked + 3) * 100);
  if (mode === 'collapse') {
    check('a collapse fall costs a life', e.participantFor(1)!.lives === 2 && !!fall.spawn);
  } else {
    check('fall restores last saved checkpoint', fall.spawn?.z === at(banked).z &&
      e.participantFor(1)!.progress === banked && e.participantFor(1)!.falls === 1);
  }
  const from = e.participantFor(1)!.progress;
  for (let i = from + 1; i <= last; i++)
    e.evaluate(1, at(i), 4000 + (banked + 4 + i) * 100);
  check('first finisher wins immediately', e.snapshotFor(1, 60000)?.result?.winner === 1);
  const left = e.leave(1, 60000);
  check('leaving detaches player from engine', e.phaseFor(1) === null && left.snapshot?.participants.find(p => p.id === 1)?.connected === false);
  check('last departure deletes the lobby', e.leave(2, 60000).deleted && e.snapshots(60000).length === 0);
}
// Rising Void and Collapse Chase: the modes that knock you out.
{
  let voids = 0, collapses = 0;
  for (let round = 0; round < 12 && (!voids || !collapses); round++) {
    const { e, snap } = prepared('parkour');
    const s = run(e, snap, 0), sub = s.sub!, course = parkourCourse(sub.seed), mode = course.variant.mode;
    const start = s.round!.startedAt;
    if (mode === 'void') {
      voids++;
      // Stand still at the start for five minutes: the void comes for you.
      const pad = course.steps[0][0];
      const out = e.evaluate(1, { x: sub.minX + pad.x, y: pad.y + .01, z: sub.minZ + pad.z }, start + 300_000);
      check('the void reaches a racer who never climbs', out.changed && e.participantFor(1)!.outAt !== undefined);
      check('last one above the void wins', e.snapshotFor(2, start + 300_000)?.result?.winner === 2);
    } else if (mode === 'collapse') {
      collapses++;
      check('a Collapse Chase starts everyone on three lives', s.participants.every(p => p.lives === 3));
      for (let i = 0; i < 3; i++)
        e.evaluate(1, { x: sub.minX + 16, y: PARTY_VOID_Y - 1, z: sub.minZ + 40 }, start + 1000 + i * 2000);
      check('three falls and you are out', e.participantFor(1)!.lives === 0 && e.participantFor(1)!.outAt !== undefined);
      check('last one with lives wins', e.snapshotFor(2, start + 9000)?.result?.winner === 2);
    }
  }
  check('rising void and collapse chase both came up in twelve matches', voids > 0 && collapses > 0);
}
// ── Server integration ─────────────────────────────────────────────────────
function serverMatch(mode: PartyMode = 'parkour') {
  const s = new GameServer(42);
  for (let id = 1; id <= 3; id++)
    s.addPlayer(id, { username: `Tester${id}`, faction: 0 });
  s.handle(1, { t: 'saveState', data: { slots: [{ id: Item.Diamond, count: 5 }] } });
  s.handle(1, { t: 'partyQueue', join: true, mode });
  const launch = s.handle(2, { t: 'partyQueue', join: true, mode });
  const snap = s.party.snapshotFor(1, s.worldTime * 1000)!;
  check('public matchmaking launches automatically', snap.phase === 'countdown' && snap.capacity === 2);
  const sends = (id: number, msg: ClientMsg) => JSON.parse(JSON.stringify(s.handle(id, JSON.parse(JSON.stringify(msg))))) as Outbound[];
  return { s, snap, launch, sends };
}
{
  const { s, snap, sends } = serverMatch();
  const spawn = { ...s.players.get(1)! };
  sends(1, { t: 'xform', x: spawn.x + 10, y: spawn.y, z: spawn.z, yaw: 0, pitch: 0, arenaRevision: snap.revision });
  check('countdown movement stays pinned', s.players.get(1)!.x === spawn.x);
  sends(1, { t: 'partyArenaReady', revision: snap.revision });
  s.tickWar(4);
  s.tickParty();
  check('server waits for opponent arena', s.party.phaseFor(1) === 'countdown');
  sends(2, { t: 'partyArenaReady', revision: snap.revision });
  s.tickWar(3);
  s.tickParty();
  check('both ready start together', s.party.phaseFor(1) === 'running');
  const sub = s.party.subFor(1)!, player = s.players.get(1)!;
  const before = player.x;
  sends(1, { t: 'xform', x: before + 20, y: player.y, z: player.z, yaw: 0, pitch: 0, arenaRevision: snap.revision });
  check('teleport cheating rejected', player.x === before);
  sends(1, { t: 'xform', x: before + .1, y: player.y, z: player.z, yaw: 0, pitch: 0, arenaRevision: snap.revision - 1 });
  check('stale round movement rejected', player.x === before);
  const cross = sends(1, { t: 'duelQueue', join: true });
  check('arena player cannot enter another mode', cross.some(o => o.msg.t === 'duelError'));
  const point = { x: Math.floor(player.x), y: Math.floor(player.y) - 1, z: Math.floor(player.z) };
  sends(1, { t: 'edit', ...point, block: Block.Air });
  check('authored parkour cannot be broken', !s.serialize().edits.some(([key, b]) => key === `${point.x},${point.y},${point.z}` && b === Block.Air));
  // Find a legal adjacent bridge cell close enough to the actual spawn.
  let wool: { x: number; y: number; z: number } | undefined;
  for (let dx = -3; dx <= 3 && !wool; dx++)
    for (let dz = -3; dz <= 3 && !wool; dz++) {
      const v = { x: point.x + dx, y: point.y, z: point.z + dz };
      if (partyArenaBlockAt(v.x, v.y, v.z) !== Block.Air)
        continue;
      const out = sends(1, { t: 'edit', ...v, block: Block.TeamWoolA });
      if (out.some(o => o.to === 2 && o.msg.t === 'edit' && o.msg.block === Block.TeamWoolA))
        wool = v;
    }
  check('infinite wool can bridge and broadcasts to rival', !!wool);
  const removed = sends(1, { t: 'edit', ...wool!, block: Block.Air });
  check('parkour wool cannot be taken back', removed.some(o => o.msg.t === 'edit' && o.msg.block === Block.TeamWoolA));
  check('arena items cannot be dropped into world', sends(1, { t: 'drop', items: [{ id: Block.TeamWoolA, count: 64 }], x: player.x, y: player.y, z: player.z }).length === 0);
  const leave = sends(1, { t: 'partyLeave' });
  check('departed socket gets no old party lobby or result', !leave.some(o => o.to === 1 && (o.msg.t === 'partyLobby' || o.msg.t === 'partyResult')));
  check('world inventory restores intact', leave.some(o => o.to === 1 && o.msg.t === 'arenaRestored' && (o.msg.state?.slots as any[])?.[0]?.id === Item.Diamond));
  check('opponent receives a forfeit', leave.some(o => o.to === 2 && o.msg.t === 'partyResult' && o.msg.result.winner === 2));
  sends(2, { t: 'partyLeave' });
  check('placed wool clears when match closes', !s.serialize().edits.some(([k]) => k === `${wool!.x},${wool!.y},${wool!.z}`));
  check('replay can queue immediately', sends(1, { t: 'partyQueue', join: true, mode: 'parkour' }).some(o => o.msg.t === 'partyQueue' && o.msg.queued));
  const next = sends(2, { t: 'partyQueue', join: true, mode: 'parkour' });
  check('replay loads a completely fresh course', next.some(o => o.msg.t === 'partyArena' && o.msg.arena.seed !== sub.seed));
}
// The Bridge, over the wire: team wool, building out over the void, taking it
// back again, and never being handed the other side's colour.
{
  const { s, snap, launch, sends } = serverMatch('bridge');
  const teams = new Map(snap.participants.map(p => [p.id, p.team]));
  for (const id of [1, 2]) {
    const loadout = launch.concat(s.handle(id, { t: 'partyArenaReady', revision: snap.revision }))
      .find(o => o.to === id && o.msg.t === 'partyLoadout');
    check('each side gets its own wool', loadout && (loadout.msg as { slots: { id: number }[] }).slots[0].id === BRIDGE_TEAM_BLOCK[teams.get(id)!]);
    const slots = (loadout!.msg as { slots: ({ id: number } | null)[] }).slots;
    check('each Bridge loadout equips iron instead of the cleaver',
      slots[1]?.id === Item.IronAxe && !slots.some(slot => slot?.id === Item.VoidCleaver));
    const arena = launch.find(o => o.to === id && o.msg.t === 'partyArena');
    check('the client is told which side it is on', arena && (arena.msg as { team: number }).team === teams.get(id));
  }
  s.tickWar(4);
  s.tickParty();
  check('the Bridge starts once both are loaded', s.party.phaseFor(1) === 'running');
  const sub = s.party.subFor(1)!, player = s.players.get(1)!;
  const mine = BRIDGE_TEAM_BLOCK[teams.get(1)!], theirs = BRIDGE_TEAM_BLOCK[teams.get(2)!];
  let wool: { x: number; y: number; z: number } | undefined;
  for (let dx = -3; dx <= 3 && !wool; dx++)
    for (let dz = -3; dz <= 3 && !wool; dz++) {
      const v = { x: Math.floor(player.x) + dx, y: Math.floor(player.y), z: Math.floor(player.z) + dz };
      if (partyArenaBlockAt(v.x, v.y, v.z) !== Block.Air)
        continue;
      if (sends(1, { t: 'edit', ...v, block: mine }).some(o => o.to === 2 && o.msg.t === 'edit' && o.msg.block === mine))
        wool = v;
    }
  check('you can build out from your own base', !!wool);
  check('you cannot build in the other side\'s colour',
    sends(1, { t: 'edit', x: wool!.x, y: wool!.y + 1, z: wool!.z, block: theirs })
      .every(o => !(o.to === 2 && o.msg.t === 'edit')));
  const back = sends(1, { t: 'edit', ...wool!, block: Block.Air });
  check('you can take your own wool back', back.some(o => o.to === 2 && o.msg.t === 'edit' && o.msg.block === Block.Air));
  const deck = { x: Math.floor(player.x), y: Math.floor(player.y) - 1, z: Math.floor(player.z) };
  sends(1, { t: 'edit', ...deck, block: Block.Air });
  check('the base itself cannot be dismantled', !s.serialize().edits.some(([k, b]) => k === `${deck.x},${deck.y},${deck.z}` && b === Block.Air));
  const g = BRIDGE_GOALS.find(v => v.team !== teams.get(1)!)!;
  const plug = { x: sub.minX + g.minX, y: PARTY_FLOOR_Y, z: sub.minZ + g.minZ };
  Object.assign(player, { x: plug.x + .5, y: PARTY_FLOOR_Y + 1, z: plug.z + .5 });
  check('the enemy portal cannot be plugged',
    sends(1, { t: 'edit', ...plug, block: mine }).every(o => !(o.to === 2 && o.msg.t === 'edit')));
}
// Movement and aim determine melee outcomes, independently of a charge clock.
{
  const input = { combo: 0, onGround: true, vy: 0, speed: 0,
    toTargetX: 1, toTargetZ: 0, lookX: 1, lookZ: 0 };
  const base = bridgeSwing(input);
  const crit = bridgeSwing({ ...input, onGround: false, vy: -3 / 60 });
  const sprint = bridgeSwing({ ...input, speed: 7 });
  const combo = bridgeSwing({ ...input, combo: 3 });
  check('normal falling jump attacks earn crit damage', crit.crit && crit.damage > base.damage);
  check('rising and grounded attacks do not earn jump crits',
    !bridgeSwing({ ...input, onGround: false, vy: 3 / 60 }).crit && !base.crit);
  check('sprinting earns stronger directional knockback', sprint.kx > base.kx);
  check('consecutive contact rewards combos', combo.damage > base.damage);
  check('aim steers the knockback line', bridgeSwing({ ...input, lookX: 0, lookZ: 1 }).kz > 0);
}
// Real server traffic with two Bridges, Parkour and gun Duels all live.
// Ending/reusing one arena must preserve everybody else's bodies and edits.
{
  const s = new GameServer(43);
  for (let id = 10; id <= 21; id++) s.addPlayer(id, { username: `Concurrent${id}`, faction: 0 });
  const startParty = (host: number, guest: number, mode: PartyMode) => {
    s.handle(host, { t: 'partyQueue', join: true, mode });
    s.handle(guest, { t: 'partyQueue', join: true, mode });
    const snap = s.party.snapshotFor(host, s.worldTime * 1000)!;
    check('concurrent queue creates the intended pair', snap.participants.map(p => p.id).sort().join(',') === `${host},${guest}`);
    for (const id of [host, guest]) s.handle(id, { t: 'partyArenaReady', revision: snap.revision });
    return snap;
  };
  const first = startParty(10, 11, 'bridge');
  const second = startParty(12, 13, 'bridge');
  const parkour = startParty(14, 15, 'parkour');
  s.handle(16, { t: 'duelQueue', join: true });
  s.handle(17, { t: 'duelQueue', join: true });
  for (const id of [16, 17]) s.handle(id, { t: 'duelArenaReady' });
  s.tickWar(7); s.tickParty(); s.tickDuels();
  check('three party venues occupy distinct slots', new Set([first.arena!.slot, second.arena!.slot, parkour.arena!.slot]).size === 3);
  for (const host of [10, 12, 14, 16]) {
    check('each active match sees exactly its own pair',
      s.snapshotFor(host).map(p => p.id).sort().join(',') === `${host},${host + 1}`);
    check('each active match stays out of world snapshots', !s.snapshotFor(18).some(p => p.id === host));
  }
  const stageFight = (host: number, snap: PartyLobbySnapshot) => {
    const a = s.players.get(host)!, b = s.players.get(host + 1)!;
    Object.assign(a, { x: snap.sub!.minX + BRIDGE_LANE_X + .5, y: PARTY_FLOOR_Y + 1,
      z: snap.sub!.minZ + BRIDGE_SIZE_Z / 2, yaw: Math.PI, held: Item.BridgeBow });
    Object.assign(b, { x: a.x, y: a.y, z: a.z + 3 });
    s.party.participantFor(host + 1)!.immuneUntil = 0;
  };
  stageFight(10, first); stageFight(12, second);
  s.players.get(10)!.held = Item.IronAxe;
  check('Bridge cannot melee a different Bridge or a gun duel',
    s.handle(10, { t: 'partyMelee', target: 12 }).length === 0 &&
    s.handle(10, { t: 'partyMelee', target: 16 }).length === 0);
  s.players.get(10)!.held = Item.BridgeBow;
  for (const host of [10, 12]) {
    const out = s.handle(host, { t: 'partyShoot', dx: 0, dy: 0, dz: 1, power: 1 });
    check('arrows are sent only to the firing match', out.length === 2 && out.every(o => o.to === host || o.to === host + 1));
  }
  const key = (snap: PartyLobbySnapshot) => `${snap.sub!.minX + 5},${PARTY_FLOOR_Y + 3},${snap.sub!.minZ + 5}`;
  s.edits.set(key(first), Block.TeamWoolA);
  s.edits.set(key(second), Block.TeamWoolB);
  s.handle(10, { t: 'partyLeave' });
  s.handle(11, { t: 'partyLeave' });
  check('ending one Bridge clears only its edits', !s.edits.has(key(first)) && s.edits.has(key(second)));
  check('other modes and matches keep running', s.party.phaseFor(12) === 'running' &&
    s.party.phaseFor(14) === 'running' && s.duels.phaseFor(16) === 'running');
  s.tickWar(.06);
  const tick = s.tickParty();
  check('the other Bridge arrow still lands after the first match leaves',
    tick.some(o => o.to === 12 && o.msg.t === 'partyHit' && o.msg.ranged));
  check('departed arrows never leak hits into other matches',
    tick.filter(o => o.msg.t === 'partyHit').every(o => o.to === 12));
  const reused = startParty(20, 21, 'bridge');
  check('a new pair safely reuses the vacant arena', reused.arena!.slot === first.arena!.slot && !s.edits.has(key(first)));
  check('slot reuse preserves active opponents and cover',
    s.snapshotFor(12).map(p => p.id).sort().join(',') === '12,13' && s.edits.has(key(second)));
  // Countdown packets cannot preload arrows into a new round.
  s.players.get(20)!.held = Item.BridgeBow;
  check('no arrows may fire while the next pair is staged',
    s.handle(20, { t: 'partyShoot', dx: 0, dy: 0, dz: 1, power: 1 }).length === 0);
}
// Fighting for the span: the iron axe, the bow, and the movement gate that has
// to let a fight happen without ever freezing anybody in mid-air.
{
  const { s, snap, sends } = serverMatch('bridge');
  s.handle(1, { t: 'partyArenaReady', revision: snap.revision });
  s.handle(2, { t: 'partyArenaReady', revision: snap.revision });
  s.tickWar(4);
  s.tickParty();
  check('the Bridge arms both sides', s.party.phaseFor(1) === 'running');
  const a = s.players.get(1)!, b = s.players.get(2)!;
  // Fight on the central island after leaving the now-open spawn cage.
  const spawn = { x: snap.sub!.minX + BRIDGE_LANE_X + .5, y: PARTY_FLOOR_Y + 1, z: snap.sub!.minZ + BRIDGE_SIZE_Z / 2 };
  // Past the spawn shield, and within arm's reach of each other.
  s.tickWar(3);
  s.tickParty();
  Object.assign(a, spawn);
  Object.assign(b, { x: a.x + 1.4, y: a.y, z: a.z });
  a.yaw = Math.atan2(-(b.x - a.x), -(b.z - a.z));
  a.held = Item.VoidCleaver;
  check('the old cleaver cannot attack in the Bridge', sends(1, { t: 'partyMelee', target: 2 }).length === 0);
  sends(1, { t: 'xform', ...spawn, yaw: a.yaw, pitch: 0,
    arenaRevision: snap.revision, held: Item.IronAxe });
  check('the Bridge accepts equipping the iron axe over the wire', a.held === Item.IronAxe);
  const swing = sends(1, { t: 'partyMelee', target: 2 });
  const landed = swing.find(o => o.to === 1 && o.msg.t === 'partyHit')?.msg as { amount: number } | undefined;
  check('an iron axe swing hurts the rival', swing.some(o => o.to === 2 && o.msg.t === 'hurt'));
  check('the swing reports back to the attacker', !!landed && landed.amount > 0);
  check('the Bridge axe hits immediately for its fixed damage', landed?.amount === BRIDGE_MELEE_TIER.damage);
  check('the damage is server-side, not claimed', b.health === PARTY_MAX_HEALTH - landed!.amount);
  check('spam is dropped rather than scaled', sends(1, { t: 'partyMelee', target: 2 }).length === 0);
  s.tickWar(BRIDGE_MELEE_TIER.cooldownMs / 1000 + .001);
  const followup = sends(1, { t: 'partyMelee', target: 2 })
    .find(o => o.to === 1 && o.msg.t === 'partyHit')?.msg;
  check('a fast follow-up has full damage and an earned combo',
    !!followup && followup.t === 'partyHit' && followup.amount >= landed!.amount && followup.combo === 1);
  s.tickWar((BRIDGE_MELEE_TIER.cooldownMs - BRIDGE_SWING_JITTER_MS / 2) / 1000);
  check('a swing arriving a hair early (packet jitter) still lands',
    sends(1, { t: 'partyMelee', target: 2 }).some(o => o.to === 1 && o.msg.t === 'partyHit'));
  s.tickWar(1);
  const coverKey = `${Math.floor(a.x + .7)},${Math.floor(a.y + 1.35)},${Math.floor(a.z)}`;
  s.edits.set(coverKey, Block.TeamWoolB);
  check('wool cover blocks axe contact', sends(1, { t: 'partyMelee', target: 2 }).length === 0);
  s.edits.delete(coverKey);
  a.yaw += Math.PI;
  check('a swing with your back turned misses', sends(1, { t: 'partyMelee', target: 2 }).length === 0);
  a.yaw -= Math.PI;
  a.held = 0;
  check('an empty hand cannot swing', sends(1, { t: 'partyMelee', target: 2 }).length === 0);
  a.held = Item.IronAxe;
  let killed = false;
  for (let i = 0; i < 40 && !killed; i++) {
    s.tickWar(1);
    const out = sends(1, { t: 'partyMelee', target: 2 });
    Object.assign(b, { x: a.x + 1.4, y: a.y, z: a.z });
    killed = out.some(o => o.to === 1 && o.msg.t === 'partyHit' && (o.msg as { killed: boolean }).killed);
    if (killed)
      check('a kill sends the body home at full health',
        out.some(o => o.to === 2 && o.msg.t === 'respawned') && b.health === PARTY_MAX_HEALTH);
  }
  check('the iron axe can finish a fight', killed);
  check('kills and deaths are on the scoreboard',
    s.party.participantFor(1)!.kills === 1 && s.party.participantFor(2)!.deaths === 1);
  // The bow fires instantly with consistent strength at its action interval.
  a.held = Item.BridgeBow;
  s.tickWar(BRIDGE_BOW_COOLDOWN_MS / 1000 + .001);
  const shot = sends(1, { t: 'partyShoot', dx: 0, dy: 0, dz: 1, power: 1 });
  check('a released arrow reaches BOTH clients', shot.filter(o => o.msg.t === 'partyArrow').length === 2);
  check('a second shot in the same instant is refused', sends(1, { t: 'partyShoot', dx: 0, dy: 0, dz: 1, power: 1 }).length === 0);
  s.tickWar(BRIDGE_BOW_COOLDOWN_MS / 1000 + .001);
  const full = sends(1, { t: 'partyShoot', dx: 0, dy: 0, dz: 1, power: 1 })
    .find(o => o.msg.t === 'partyArrow')!.msg as { power: number };
  check('the next arrow needs no additional draw time', full.power === 1);
  s.tickWar(BRIDGE_BOW_COOLDOWN_MS / 1000 + .001);
  const cheated = sends(1, { t: 'partyShoot', dx: 0, dy: 0, dz: 1, power: 9 })
    .find(o => o.msg.t === 'partyArrow')!.msg as { power: number };
  check('a forged power cannot increase arrow strength', cheated.power === 1);
  // Point blank into the rival: the arrow is the server's, and it lands.
  s.party.participantFor(2)!.immuneUntil = 0;
  Object.assign(b, { x: a.x, y: a.y, z: a.z + 3, health: PARTY_MAX_HEALTH });
  s.tickWar(2);
  sends(1, { t: 'partyShoot', dx: 0, dy: 0, dz: 1, power: 1 });
  let arrow: { amount: number; crit: boolean; ranged: boolean } | null = null;
  for (let i = 0; i < 30 && !arrow; i++) {
    s.tickWar(1 / 20);
    const hit = s.tickParty().find(o => o.to === 1 && o.msg.t === 'partyHit');
    if (hit) arrow = hit.msg as unknown as { amount: number; crit: boolean; ranged: boolean };
  }
  check('an arrow that reaches a body damages it', !!arrow && arrow.amount > 0);
  check('instant arrows deal fixed damage without automatic charge crits', arrow!.ranged && !arrow!.crit && arrow!.amount === 7);
  // ── The movement gate ────────────────────────────────────────────────────
  // Standing still, and then four seconds of sprint-jumping whose touchdowns
  // fall BETWEEN packets. Neither may ever produce a correction: a false
  // correction here is the mid-air freeze this gate exists to avoid.
  const rev = s.party.roundFor(1)!.revision;
  Object.assign(a, spawn);
  const xf = (x: number, y: number, z: number) =>
    sends(1, { t: 'xform', x, y, z, yaw: 0, pitch: 0, arenaRevision: rev });
  let corrections = 0;
  for (let i = 0; i < 40; i++) {
    s.tickWar(1 / 20);
    if (xf(spawn.x, spawn.y, spawn.z).some(o => o.msg.t === 'teleport')) corrections++;
  }
  check('standing still is never corrected', corrections === 0);
  for (let i = 0, t = 0; i < 80; i++) {
    s.tickWar(1 / 20);
    t += 1 / 20;
    const y = spawn.y + Math.sin(((t % .6) / .6) * Math.PI) * 1.2;
    if (xf(spawn.x, y, spawn.z).some(o => o.msg.t === 'teleport')) corrections++;
  }
  check('a long string of sprint-jumps is never corrected', corrections === 0);
  // A real hover IS refused — and the refusal resolves onto solid ground
  // instead of arguing with the client forever.
  for (let i = 0; i < 30; i++) {
    s.tickWar(1 / 20);
    xf(spawn.x, spawn.y + 4, spawn.z);
  }
  check('hovering is refused', a.y < spawn.y + 3);
  check('a refused player is settled onto solid ground, never frozen in the air',
    !!BLOCKS[partyArenaBlockAt(a.x, a.y - .5, a.z) ?? Block.Air]?.solid);
  s.tickWar(1 / 20);
  check('and can move again the moment they are settled',
    !xf(a.x + .3, a.y, a.z).some(o => o.msg.t === 'teleport') && a.x !== spawn.x);
}
{
  const s = new GameServer(123);
  for (let id = 1; id <= 4; id++)
    s.addPlayer(id, { username: `Mixed${id}`, faction: 0 });
  s.handle(1, { t: 'partyQueue', join: true, mode: 'parkour' });
  s.handle(2, { t: 'partyQueue', join: true, mode: 'bridge' });
  check('parkour and Bridge queues never match each other', s.party.phaseFor(1) === null && s.party.phaseFor(2) === null);
  s.removePlayer(1);
  s.handle(3, { t: 'partyQueue', join: true, mode: 'parkour' });
  check('stale queued disconnect does not swallow next player', s.party.phaseFor(3) === null);
  s.handle(4, { t: 'partyQueue', join: true, mode: 'parkour' });
  check('replacement opponent matches', s.party.phaseFor(3) === 'countdown');
  check('retired Bedwars cannot launch', s.handle(2, { t: 'bwCreate' }).every(o => o.msg.t !== 'bwLobby'));
}
// Duels regression: a forfeit result must never reattach the departed socket.
{
  const s = new GameServer(99);
  for (let id = 1; id <= 3; id++)
    s.addPlayer(id, { username: `Duel${id}`, faction: 0 });
  s.handle(1, { t: 'duelQueue', join: true });
  s.handle(2, { t: 'duelQueue', join: true });
  s.handle(1, { t: 'duelArenaReady' });
  s.handle(2, { t: 'duelArenaReady' });
  s.tickWar(3);
  s.tickDuels();
  const left = s.handle(1, { t: 'duelLeave' });
  check('duels exit does not receive stale lobby/results', !left.some(o => o.to === 1 && (o.msg.t === 'duelLobby' || o.msg.t === 'duelResult')));
  check('duels Play queues again', s.handle(1, { t: 'duelQueue', join: true }).some(o => o.msg.t === 'duelQueue' && o.msg.queued));
  check('duels replay finds a new opponent', s.handle(3, { t: 'duelQueue', join: true }).some(o => o.to === 1 && o.msg.t === 'duelArena'));
}
console.log(`Bridge / Parkour / replay smoke: ${passed} checks passed`);
