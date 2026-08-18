import {
  DUEL_ARENA_FLOOR_Y, DUEL_ARENA_LOAD_TIMEOUT_MS, DUEL_COUNTDOWN_MS, DUEL_MIN_LIGHT, DUEL_REMATCH_MS,
  DUEL_RESPAWN_MS, DUEL_ROUND_MS, Duels, clampToDuelArena, duelArenaBounds,
  duelArenaLightAt, duelArenaSolidAt, hasArenaLineOfSight, orderedDuelScoreboard,
  safestDuelSpawn, duelTokenFromUrl, withDuelToken,
} from '../src/duels';
import { Item } from '../src/items';
import { GameServer } from '../src/net/server_core';

let passed = 0;
function check(name: string, ok: unknown, detail = ''): void {
  if (!ok) throw new Error(`FAIL: ${name}${detail ? ` (${detail})` : ''}`);
  passed++;
}

let tokenN = 0;
const token = () => `${String(++tokenN).padStart(24, 'a')}0123456789abcdef01234567`;
const who = (id: number) => ({ id, username: `Player${id}`, skin: id * 17 });

{
  const linked = withDuelToken('https://play.example/game?lang=en&kit=full#join', 'secret-token');
  const parsed = new URL(linked);
  check('deep link preserves unrelated auth/query state and hash',
    parsed.searchParams.get('lang') === 'en' && parsed.searchParams.get('kit') === 'full' &&
    parsed.hash === '#join' && duelTokenFromUrl(linked) === 'secret-token');
  check('removing invite preserves unrelated query state',
    !withDuelToken(linked, null).includes('duel=') && withDuelToken(linked, null).includes('lang=en'));
}

// Lobby lifecycle, readiness, capacity, host transfer, cleanup.
{
  const d = new Duels(token);
  const made = d.create(who(1), 1000);
  if ('reason' in made) throw new Error('create unexpectedly failed');
  check('creator is host', made.snapshot.host === 1 && made.snapshot.participants[0].host);
  check('invite token is not exposed in public snapshot', !JSON.stringify(made.snapshot).includes(made.token));
  check('invalid invite fails', !d.join('nope', who(2), 1000).ok);
  check('valid invite joins', d.join(made.token, who(2), 1000).ok);
  d.setReady(1, true, 1000); d.setReady(2, true, 1000);
  d.join(made.token, who(3), 1000);
  check('joining resets everyone ready', d.snapshotFor(1, 1000)!.participants.every((p) => !p.ready));
  d.join(made.token, who(4), 1000);
  const full = d.join(made.token, who(5), 1000);
  check('fifth player is refused from full lobby with actionable reason',
    !full.ok && full.reason === 'full');
  d.setReady(2, true, 1000); d.setReady(3, true, 1000); d.setReady(4, true, 1000);
  d.leave(1, 1000);
  check('host transfers by stable join order and leaving resets readiness',
    d.snapshotFor(2, 1000)!.host === 2 &&
    d.snapshotFor(2, 1000)!.participants.every((p) => !p.ready));
  d.leave(2, 1000); d.leave(3, 1000);
  const end = d.leave(4, 1000);
  check('empty lobby expires immediately', end.deleted && !d.join(made.token, who(6), 1000).ok);
}

{
  const d = new Duels(token);
  const made = d.create(who(1), 0); if ('reason' in made) throw new Error('create failed');
  d.join(made.token, who(2), 0); d.setReady(1, true, 0); d.setReady(2, true, 0);
  d.start(1, 0); d.markArenaReady(1, 0);
  const timedOut = d.tick(DUEL_ARENA_LOAD_TIMEOUT_MS);
  check('arena staging timeout safely returns the whole group to lobby',
    timedOut[0]?.phase === 'lobby' && timedOut[0].participants.every((p) => !p.ready));
}

// Start gates, authoritative timing, scores, sudden death, respawn and rematch.
{
  const d = new Duels(token);
  const made = d.create(who(1), 0);
  if ('reason' in made) throw new Error('create unexpectedly failed');
  check('host cannot start alone', !d.start(1, 0).ok);
  d.join(made.token, who(2), 0);
  check('host cannot start unready lobby', !d.start(1, 0).ok);
  d.setReady(1, true, 0); d.setReady(2, true, 0);
  check('non-host cannot start', !d.start(2, 0).ok);
  const started = d.start(1, 10);
  check('ready host stages the arena before countdown', started.ok &&
    started.snapshot.phase === 'countdown' && started.snapshot.countdownEndsAt === undefined);
  const late = d.join(made.token, who(3), 10);
  check('active match rejects late invite visitor', !late.ok && late.reason === 'match_in_progress');
  d.markArenaReady(1, 10);
  const armed = d.markArenaReady(2, 10)!;
  check('all streamed clients arm synchronized countdown',
    armed.countdownEndsAt === 10 + DUEL_COUNTDOWN_MS);
  d.tick(10 + DUEL_COUNTDOWN_MS);
  const live = d.snapshotFor(1, 10 + DUEL_COUNTDOWN_MS)!;
  check('round is exactly five minutes from FIGHT', live.phase === 'running' &&
    live.endsAt === live.startedAt! + DUEL_ROUND_MS);
  d.recordDeath(2, 1, 20_000);
  const dead = d.snapshotFor(2, 20_000)!;
  const victim = dead.participants.find((p) => p.id === 2)!;
  check('death enters three-second spectator flight', !victim.alive && victim.spectating &&
    victim.respawnAt === 20_000 + DUEL_RESPAWN_MS);
  d.tick(20_000 + DUEL_RESPAWN_MS);
  check('respawn restores alive state with shield', d.participantFor(2)!.alive &&
    d.participantFor(2)!.shieldUntil! > 20_000 + DUEL_RESPAWN_MS);
  d.removeSpawnShield(2);
  check('firing removes spawn shield immediately', d.participantFor(2)!.shieldUntil === undefined);
  const resultChanges = d.tick(live.endsAt!);
  check('unique leader wins at time', resultChanges[0].phase === 'results' &&
    resultChanges[0].result?.winner === 1 &&
    resultChanges[0].result.rematchDeadline === live.endsAt! + DUEL_REMATCH_MS);
  d.voteRematch(1, true, live.endsAt! + 1);
  const rematch = d.voteRematch(2, true, live.endsAt! + 2)!;
  check('unanimous rematch starts immediately and resets score', rematch.phase === 'countdown' &&
    rematch.participants.every((p) => p.kills === 0 && p.deaths === 0));
}

// Disconnect/forfeit and rematch cancellation semantics.
{
  const d = new Duels(token);
  const made = d.create(who(1), 0); if ('reason' in made) throw new Error('create failed');
  d.join(made.token, who(2), 0); d.join(made.token, who(3), 0);
  for (const id of [1, 2, 3]) d.setReady(id, true, 0);
  d.start(1, 0); for (const id of [1, 2, 3]) d.markArenaReady(id, 0);
  d.tick(DUEL_COUNTDOWN_MS);
  const continuing = d.leave(3, DUEL_COUNTDOWN_MS + 1).snapshot!;
  check('three-player disconnect removes leaver and round continues with two',
    continuing.phase === 'running' && continuing.participants.length === 2);
  const forfeited = d.leave(2, DUEL_COUNTDOWN_MS + 2).snapshot!;
  check('one remaining player wins by forfeit', forfeited.phase === 'results' &&
    forfeited.result?.winner === 1 && forfeited.result.finishReason === 'forfeit');
  const refused = d.voteRematch(1, false, DUEL_COUNTDOWN_MS + 3)!;
  check('one Return/refusal cancels rematch and resets lobby consent', refused.phase === 'lobby' &&
    refused.participants.every((p) => !p.ready));
}

{
  const d = new Duels(token);
  const made = d.create(who(1), 0); if ('reason' in made) throw new Error('create failed');
  d.join(made.token, who(2), 0); d.setReady(1, true, 0); d.setReady(2, true, 0);
  d.start(1, 0); d.markArenaReady(1, 0); d.markArenaReady(2, 0);
  d.tick(DUEL_COUNTDOWN_MS); d.recordDeath(2, 1, DUEL_COUNTDOWN_MS + 1);
  const result = d.tick(DUEL_COUNTDOWN_MS + DUEL_ROUND_MS)[0];
  d.voteRematch(1, true, result.result!.rematchDeadline - 1);
  const timeout = d.tick(result.result!.rematchDeadline);
  check('partial rematch vote times out to same lobby with readiness reset',
    timeout[0]?.id === made.snapshot.id && timeout[0]?.phase === 'lobby' &&
    timeout[0].participants.every((p) => !p.ready && !p.rematchVote));
}

// Concurrent arenas use the lowest free 512-block slot and release it.
{
  const d = new Duels(token);
  const starts: { token: string; owner: number; slot: number }[] = [];
  for (let pair = 0; pair < 3; pair++) {
    const owner = 10 + pair * 2, guest = owner + 1;
    const made = d.create(who(owner), 0); if ('reason' in made) throw new Error('create failed');
    d.join(made.token, who(guest), 0); d.setReady(owner, true, 0); d.setReady(guest, true, 0);
    const start = d.start(owner, 0); if (!start.ok || !start.snapshot.arena) throw new Error('arena missing');
    starts.push({ token: made.token, owner, slot: start.snapshot.arena.slot });
  }
  check('simultaneous matches receive consecutive isolated slots',
    starts.map((v) => v.slot).join(',') === '0,1,2');
  d.leave(starts[0].owner, 1); d.leave(starts[0].owner + 1, 1);
  const owner = 30, guest = 31;
  const made = d.create(who(owner), 2); if ('reason' in made) throw new Error('create failed');
  d.join(made.token, who(guest), 2); d.setReady(owner, true, 2); d.setReady(guest, true, 2);
  const reused = d.start(owner, 2);
  check('lowest released arena slot is reused', reused.ok && reused.snapshot.arena?.slot === 0);
}

// Equal leaders enter sudden death; next kill finishes it.
{
  const d = new Duels(token);
  const made = d.create(who(1), 0); if ('reason' in made) throw new Error('create failed');
  d.join(made.token, who(2), 0); d.join(made.token, who(3), 0);
  for (const id of [1, 2, 3]) d.setReady(id, true, 0);
  d.start(1, 0);
  for (const id of [1, 2, 3]) d.markArenaReady(id, 0);
  d.tick(DUEL_COUNTDOWN_MS);
  d.recordDeath(3, 1, 10_000); d.tick(10_000 + DUEL_RESPAWN_MS);
  d.recordDeath(3, 2, 20_000); d.tick(20_000 + DUEL_RESPAWN_MS);
  d.tick(DUEL_COUNTDOWN_MS + DUEL_ROUND_MS);
  const sd = d.snapshotFor(1, DUEL_COUNTDOWN_MS + DUEL_ROUND_MS)!;
  check('tied leaders enter sudden death', sd.phase === 'sudden_death');
  check('non-leaders spectate sudden death', sd.participants.find((p) => p.id === 3)!.spectating);
  d.recordDeath(2, 1, DUEL_COUNTDOWN_MS + DUEL_ROUND_MS + 1);
  check('next valid sudden-death kill wins', d.snapshotFor(1, 999999)!.result?.winner === 1);
}

// A tied leader who is dead as regulation expires retains the exact respawn
// timer instead of receiving a free Sudden Death spawn.
{
  const d = new Duels(token);
  const made = d.create(who(1), 0); if ('reason' in made) throw new Error('create failed');
  d.join(made.token, who(2), 0); d.join(made.token, who(3), 0);
  for (const id of [1, 2, 3]) d.setReady(id, true, 0);
  d.start(1, 0);
  for (const id of [1, 2, 3]) d.markArenaReady(id, 0);
  d.tick(DUEL_COUNTDOWN_MS);
  const end = DUEL_COUNTDOWN_MS + DUEL_ROUND_MS;
  d.recordDeath(3, 1, end - 5_000); d.tick(end - 2_000);
  d.recordDeath(1, 2, end - 1_000);
  d.tick(end);
  const leader = d.participantFor(1)!;
  check('dead tied leader keeps normal Sudden Death respawn timing',
    !leader.alive && leader.respawnAt === end + 2_000);
  d.tick(end + 2_000);
  check('dead tied leader respawns on schedule during Sudden Death',
    d.participantFor(1)!.alive && !d.participantFor(1)!.spectating);
}

// Arena shell, clamping, lighting, spawn occlusion, score ordering and slots.
{
  const a = duelArenaBounds(0), b = duelArenaBounds(1);
  check('arena slots start beyond world and are 512 blocks apart', a.originX === 12288 &&
    b.originX - a.originX === 512);
  check('arena floor is two solid layers', duelArenaSolidAt(a.minX + 20, DUEL_ARENA_FLOOR_Y, a.minZ + 20, a) &&
    duelArenaSolidAt(a.minX + 20, DUEL_ARENA_FLOOR_Y - 1, a.minZ + 20, a));
  check('arena walls and ceiling are sealed',
    duelArenaSolidAt(a.originX, a.floor + 5, a.originZ + 20, a) &&
    duelArenaSolidAt(a.originX + 20, a.ceiling, a.originZ + 20, a) &&
    duelArenaSolidAt(a.originX + 20, a.ceiling + 1, a.originZ + 20, a));
  const standY = (x: number, z: number): number | null => {
    let solid = a.floor;
    for (let y = a.floor + 1; y <= a.floor + 4; y++) {
      if (duelArenaSolidAt(x, y, z, a)) solid = y;
    }
    const stand = solid + 1;
    return duelArenaSolidAt(x, stand, z, a) || duelArenaSolidAt(x, stand + 1, z, a)
      ? null : stand;
  };
  let minLight = 15;
  for (let x = Math.ceil(a.minX); x < a.maxX; x++) for (let z = Math.ceil(a.minZ); z < a.maxZ; z++) {
    const y = standY(x, z);
    if (y !== null) minLight = Math.min(minLight, duelArenaLightAt(x, y, z, a));
  }
  check('every walkable cell is at least 12/15 light', minLight >= DUEL_MIN_LIGHT, `min=${minLight}`);
  let spawnLos = 0;
  for (let i = 0; i < a.spawns.length; i++) for (let j = i + 1; j < a.spawns.length; j++) {
    if (hasArenaLineOfSight(
      { ...a.spawns[i], y: a.spawns[i].y + 1.3 },
      { ...a.spawns[j], y: a.spawns[j].y + 1.3 }, a)) spawnLos++;
  }
  check('no spawn has direct line of sight to another', spawnLos === 0, `visible pairs=${spawnLos}`);
  const start = { x: Math.floor(a.spawns[0].x), z: Math.floor(a.spawns[0].z) };
  const queue = [start], reached = new Set([`${start.x},${start.z}`]);
  for (let q = 0; q < queue.length; q++) {
    const here = queue[q], h = standY(here.x, here.z);
    if (h === null) continue;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const x = here.x + dx, z = here.z + dz;
      if (x < a.minX || x >= a.maxX || z < a.minZ || z >= a.maxZ) continue;
      const next = standY(x, z), key = `${x},${z}`;
      if (next === null || Math.abs(next - h) > 1 || reached.has(key)) continue;
      reached.add(key); queue.push({ x, z });
    }
  }
  const routeTargets = [...a.spawns, { x: a.minX + 22, y: 0, z: a.minZ + 22 }];
  check('route graph connects every spawn and the raised central platform',
    routeTargets.every((p) => reached.has(`${Math.floor(p.x)},${Math.floor(p.z)}`)),
    `reached=${reached.size}`);
  const clamped = clampToDuelArena({ x: -1e9, y: 1e9, z: 1e9 }, a);
  check('spectator clamp covers X/Y/Z', clamped.x >= a.minX && clamped.y < a.maxY && clamped.z < a.maxZ);
  check('safe spawn selector returns a valid point', safestDuelSpawn(a, [a.spawns[0]], 0) >= 0);
  const board = orderedDuelScoreboard([
    { ...madeParticipant(1, 2, 3, 0) }, { ...madeParticipant(2, 2, 1, 1) },
  ]);
  check('score sorts kills desc then deaths asc', board[0].id === 2);
}

function madeParticipant(id: number, kills: number, deaths: number, joinOrder: number) {
  return { id, username: `P${id}`, skin: id, host: id === 1, ready: true, connected: true,
    kills, deaths, alive: true, spectating: false, rematchVote: false, joinOrder };
}

// Authoritative integration: scope isolation, normalized loadout/state,
// validated same-faction damage, clock fan-out, forfeit and restoration.
{
  const s = new GameServer(741, () => 0.5);
  s.addPlayer(1, { username: 'RedOne', faction: 0, data: {
    slots: [{ id: Item.Diamond, count: 7 }], armor: [], selected: 0,
  } });
  s.addPlayer(2, { username: 'RedTwo', faction: 0, data: {
    slots: [{ id: Item.GoldIngot, count: 4 }], armor: [], selected: 0,
  } });
  s.addPlayer(3, { username: 'WorldOnly', faction: 1 });
  s.handle(1, { t: 'xform', x: 120, y: 70, z: 30, yaw: 0, pitch: 0 });
  s.handle(2, { t: 'xform', x: 125, y: 70, z: 30, yaw: 0, pitch: 0 });
  const created = s.handle(1, { t: 'duelCreate' });
  const createdMsg = created.find((o) => o.to === 1 && o.msg.t === 'duelLobby')?.msg;
  if (!createdMsg || createdMsg.t !== 'duelLobby' || !createdMsg.inviteToken) {
    throw new Error('server did not return a private invite');
  }
  s.handle(2, { t: 'duelJoin', token: createdMsg.inviteToken });
  s.handle(1, { t: 'duelReady', ready: true });
  s.handle(2, { t: 'duelReady', ready: true });
  const entered = s.handle(1, { t: 'duelStart' });
  const arenaMsg = entered.find((o) => o.to === 1 && o.msg.t === 'duelArena')?.msg;
  if (!arenaMsg || arenaMsg.t !== 'duelArena') throw new Error('arena entry missing');
  const kit = entered.find((o) => o.to === 1 && o.msg.t === 'duelLoadout')?.msg;
  check('server supplies rifle, five Medkits, five Jump Boosts and infinity reserve', !!kit && kit.t === 'duelLoadout' &&
    kit.slots[0]?.id === Item.BurstRifle && kit.slots[0].loaded === 24 &&
    kit.slots[1]?.id === Item.Medkit && kit.slots[1].count === 5 &&
    kit.slots[2]?.id === Item.JumpBoost && kit.slots[2].count === 5 &&
    kit.slots.slice(3).every((v) => v === null) && kit.unlimitedReserve);
  check('arena and normal-world visibility scopes are disjoint',
    !s.receivesWorldBroadcast(1) && s.receivesWorldBroadcast(3) &&
    s.snapshotFor(1).every((p) => p.id === 1 || p.id === 2) &&
    s.snapshotFor(3).every((p) => p.id === 3));
  check('arena entry emits immediate synthetic roster leaves in both directions',
    entered.some((o) => o.to === 1 && o.msg.t === 'leave' && o.msg.id === 3) &&
    entered.some((o) => o.to === 3 && o.msg.t === 'leave' && o.msg.id === 1));
  const persistedInside = s.capturePlayerState(1)!.data;
  check('disconnect/shutdown capture keeps the open-world position and inventory',
    persistedInside.x === 120 &&
    (persistedInside.slots as { id?: number }[])[0]?.id === Item.Diamond);
  s.handle(1, { t: 'saveState', data: { x: arenaMsg.spawn.x, slots: [] } });
  check('match-time saveState is rejected',
    (s.capturePlayerState(1)!.data.slots as { id?: number }[])[0]?.id === Item.Diamond);
  const editsBefore = s.serialize().edits.length;
  check('arena building, dropping, pickup and unrelated world actions are immutable',
    s.handle(1, { t: 'edit', x: arenaMsg.spawn.x, y: arenaMsg.spawn.y, z: arenaMsg.spawn.z,
      block: 0 }).length === 0 &&
    s.handle(1, { t: 'drop', items: [{ id: Item.Diamond, count: 64 }],
      x: arenaMsg.spawn.x, y: arenaMsg.spawn.y, z: arenaMsg.spawn.z }).length === 0 &&
    s.handle(1, { t: 'pickup', eid: 1 }).length === 0 &&
    s.serialize().edits.length === editsBefore);

  s.handle(1, { t: 'duelArenaReady' });
  s.handle(2, { t: 'duelArenaReady' });
  s.tickWar(DUEL_COUNTDOWN_MS / 1000);
  const began = s.tickDuels();
  check('server broadcasts an authoritative active-round clock', began.some((o) =>
    o.to === 1 && o.msg.t === 'duelClock' && o.msg.endsAt - o.msg.serverNow === DUEL_ROUND_MS));
  const arena = arenaMsg.arena;
  const x = arena.minX + 10.5, z1 = arena.minZ + 10.5, z2 = arena.minZ + 16.5;
  const move = (id: number, mx: number, mz: number, yaw: number) => s.handle(id, {
    t: 'xform' as const, x: arena.minX + mx, y: arena.floor + 1.01,
    z: arena.minZ + mz, yaw, pitch: 0, held: Item.BurstRifle,
  });
  // Follow the clear perimeter corridor around spawn alcoves
  move(1, 3.5, 5.5, Math.PI); move(1, 3.5, 1.5, Math.PI);
  move(1, 10.5, 1.5, Math.PI); move(1, 10.5, 10.5, Math.PI);
  move(2, 40.5, 5.5, 0); move(2, 40.5, 1.5, 0);
  move(2, 10.5, 1.5, 0); move(2, 10.5, 16.5, 0);
  move(1, 7.5, 7.5, Math.PI); // attempt moving through corner screen
  check('living transform sweeps cannot pass through arena cover',
    Math.abs(s.snapshotFor(1).find((p) => p.id === 1)!.z - z1) < 0.01);
  const shot = s.handle(1, { t: 'shot', item: Item.BurstRifle,
    x, y: arena.floor + 2.61, z: z1, dx: 0, dy: 0, dz: 1 });
  check('valid Duel shot effects reach only match opponents',
    shot.length === 1 && shot[0].to === 2 && shot[0].msg.t === 'shot');
  check('forged over-damage is rejected',
    s.handle(1, { t: 'rangedAttack', target: 2, amount: 6 }).length === 0);
  const hit = s.handle(1, { t: 'rangedAttack', target: 2, amount: 5 });
  check('same-faction Duel opponents take normalized five-HP damage', hit.some((o) =>
    o.to === 2 && o.msg.t === 'hurt' && o.msg.health === 35));
  s.tickRegen(30);
  check('Duels disables passive regeneration',
    s.snapshotFor(2).find((p) => p.id === 2)!.health === 35);
  const fire = () => s.handle(1, { t: 'shot' as const, item: Item.BurstRifle,
    x, y: arena.floor + 2.61, z: z1, dx: 0, dy: 0, dz: 1 });
  check('burst cadence rejects an immediate extra round', fire().length === 0);
  s.tickWar(0.5);
  const wrongRay = s.handle(1, { t: 'shot', item: Item.BurstRifle,
    x, y: arena.floor + 2.61, z: z1, dx: 1, dy: 0, dz: 0 });
  check('shot ticket is tied to its fired ray, not merely its timestamp',
    wrongRay.length === 1 && s.handle(1, { t: 'rangedAttack', target: 2, amount: 5 }).length === 0);

  move(2, 10.5, 41.5, 0);
  s.tickWar(0.5);
  const farDx = 60, farDz = 60;
  const farLen = Math.hypot(farDx, farDz);
  s.handle(1, { t: 'shot', item: Item.BurstRifle, x, y: arena.floor + 2.61, z: z1,
    dx: farDx / farLen, dy: 0, dz: farDz / farLen });
  check('over-range Duel hit is rejected despite a fresh ray ticket',
    s.handle(1, { t: 'rangedAttack', target: 2, amount: 5 }).length === 0);

  move(2, 16.5, 13.5, 0);
  move(1, 10.5, 13.5, 0);
  s.tickWar(0.5);
  s.handle(1, { t: 'shot', item: Item.BurstRifle, x: arena.minX + 10.5, y: arena.floor + 2.61, z: arena.minZ + 13.5,
    dx: 1, dy: 0, dz: 0 });
  check('arena cover rejects an otherwise valid obstructed hit',
    s.handle(1, { t: 'rangedAttack', target: 2, amount: 5 }).length === 0);
  move(2, 10.5, 16.5, 0);
  move(1, 10.5, 10.5, Math.PI);

  s.tickWar(0.5); const firstBurst = fire();
  s.tickWar(0.06); const second = fire();
  s.tickWar(0.06); const third = fire();
  s.tickWar(0.06); const fourth = fire();
  check('one trigger window accepts exactly three burst rounds',
    firstBurst.length === 1 && second.length === 1 && third.length === 1 && fourth.length === 0);
  s.handle(1, { t: 'xform', x, y: arena.floor + 1.01, z: z1,
    yaw: Math.PI, pitch: 0, held: Item.BurstRifle, reloading: true });
  check('server blocks fire throughout the reload window', fire().length === 0);
  s.tickWar(1.11);
  s.handle(1, { t: 'xform', x, y: arena.floor + 1.01, z: z1,
    yaw: Math.PI, pitch: 0, held: Item.BurstRifle, reloading: false });
  check('unlimited reserve refills only after normal reload timing', fire().length === 1);
  s.handle(1, { t: 'rangedAttack', target: 2, amount: 5 }); // 35 -> 30
  check('cross-scope forged damage is rejected both directions',
    s.handle(1, { t: 'rangedAttack', target: 3, amount: 5 }).length === 0 &&
    s.handle(3, { t: 'rangedAttack', target: 1, amount: 5 }).length === 0);
  s.tickWar(0.06); fire(); s.handle(1, { t: 'rangedAttack', target: 2, amount: 5 }); // 30 -> 25
  s.tickWar(0.06); fire(); s.handle(1, { t: 'rangedAttack', target: 2, amount: 5 }); // 25 -> 20
  s.tickWar(0.5); fire(); s.handle(1, { t: 'rangedAttack', target: 2, amount: 5 });  // 20 -> 15
  s.tickWar(0.06); fire(); s.handle(1, { t: 'rangedAttack', target: 2, amount: 5 }); // 15 -> 10
  s.tickWar(0.06); fire(); s.handle(1, { t: 'rangedAttack', target: 2, amount: 5 }); // 10 -> 5
  s.tickWar(0.5); fire();
  const lethal = s.handle(1, { t: 'rangedAttack', target: 2, amount: 5 });           // 5 -> 0
  check('lethal Duel hit skips normal death and starts spectator respawn', lethal.some((o) =>
    o.to === 2 && o.msg.t === 'duelRespawn' && o.msg.spectating));
  check('Duel kill creates no drops, hearts, XP, war score or combat tag',
    !lethal.some((o) => ['itemspawn', 'hearts', 'warfareXp', 'war'].includes(o.msg.t)) &&
    lethal.filter((o) => o.msg.t === 'hurt').every((o) => o.msg.t === 'hurt' && o.msg.combat === 0));
  check('Duel kill feed and scoring never leave the active match scope',
    lethal.filter((o) => o.msg.t === 'killfeed' || o.msg.t === 'duelLobby')
      .every((o) => o.to === 1 || o.to === 2));
  check('respawn spectator is invisible to opponents but locally alive',
    s.snapshotFor(1).find((p) => p.id === 2)!.dead &&
    !s.snapshotFor(2).find((p) => p.id === 2)!.dead);
  check('spectating player cannot forge a rifle shot', s.handle(2, {
    t: 'shot', item: Item.BurstRifle, x, y: arena.floor + 2.61, z: z2,
    dx: 0, dy: 0, dz: -1,
  }).length === 0);
  s.tickWar(DUEL_RESPAWN_MS / 1000 - 0.01);
  check('server does not respawn before three seconds',
    !s.tickDuels().some((o) => o.to === 2 && o.msg.t === 'duelLoadout'));
  s.tickWar(0.02);
  const respawned = s.tickDuels();
  const fresh = respawned.find((o) => o.to === 2 && o.msg.t === 'duelLoadout')?.msg;
  check('server respawn is exactly timed and replaces a fresh five-Medkit five-JumpBoost loadout',
    !!fresh && fresh.t === 'duelLoadout' && fresh.slots[0]?.loaded === 24 &&
    fresh.slots[1]?.id === Item.Medkit && fresh.slots[1].count === 5 &&
    fresh.slots[2]?.id === Item.JumpBoost && fresh.slots[2].count === 5 &&
    respawned.some((o) => o.to === 2 && o.msg.t === 'duelRespawn' && !o.msg.spectating));
  check('respawned avatar becomes visible again',
    !s.snapshotFor(1).find((p) => p.id === 2)!.dead);

  const forfeited = s.handle(1, { t: 'duelLeave' });
  check('leaving a two-player round yields a scoped forfeit result', forfeited.some((o) =>
    o.to === 2 && o.msg.t === 'duelResult' && o.msg.result.winner === 2 &&
    o.msg.result.finishReason === 'forfeit'));
  const restoredOne = forfeited.find((o) => o.to === 1 && o.msg.t === 'duelRestored')?.msg;
  check('leaver receives exact open-world restoration', !!restoredOne &&
    restoredOne.t === 'duelRestored' && restoredOne.x === 120 &&
    (restoredOne.state?.slots as { id?: number }[])[0]?.id === Item.Diamond);
  const returned = s.handle(2, { t: 'duelReturn' });
  check('winner returns to the same lobby with exact state', returned.some((o) =>
    o.to === 2 && o.msg.t === 'duelRestored' && o.msg.x === 125 &&
    (o.msg.state?.slots as { id?: number }[])[0]?.id === Item.GoldIngot));
  check('returning to the world emits synthetic roster joins', returned.some((o) =>
    o.to === 3 && o.msg.t === 'join' && o.msg.player.id === 2));
}

// Healing is server-counted: no passive regeneration, normal Medkit healing,
// and exactly five consumptions per life even if a client forges extra uses.
{
  const s = new GameServer(742, () => 0.5);
  s.addPlayer(10, { username: 'Healer', faction: 0 });
  s.addPlayer(11, { username: 'Target', faction: 0 });
  const created = s.handle(10, { t: 'duelCreate' });
  const lobby = created.find((o) => o.to === 10 && o.msg.t === 'duelLobby')?.msg;
  if (!lobby || lobby.t !== 'duelLobby' || !lobby.inviteToken) throw new Error('healing lobby missing');
  s.handle(11, { t: 'duelJoin', token: lobby.inviteToken });
  for (const id of [10, 11]) s.handle(id, { t: 'duelReady', ready: true });
  const entered = s.handle(10, { t: 'duelStart' });
  const arenaMsg = entered.find((o) => o.to === 10 && o.msg.t === 'duelArena')?.msg;
  if (!arenaMsg || arenaMsg.t !== 'duelArena') throw new Error('healing arena missing');
  for (const id of [10, 11]) s.handle(id, { t: 'duelArenaReady' });
  s.tickWar(DUEL_COUNTDOWN_MS / 1000); s.tickDuels();
  const a = arenaMsg.arena;
  const move = (id: number, mx: number, mz: number, yaw: number) => s.handle(id, {
    t: 'xform' as const, x: a.minX + mx, y: a.floor + 1.01, z: a.minZ + mz,
    yaw, pitch: 0, held: Item.BurstRifle,
  });
  move(10, 3.5, 5.5, Math.PI); move(10, 3.5, 1.5, Math.PI);
  move(10, 10.5, 1.5, Math.PI); move(10, 10.5, 10.5, Math.PI);
  move(11, 40.5, 5.5, 0); move(11, 40.5, 1.5, 0);
  move(11, 10.5, 1.5, 0); move(11, 10.5, 16.5, 0);
  const damageOnce = (): void => {
    s.tickWar(0.5);
    const fired = s.handle(10, { t: 'shot', item: Item.BurstRifle,
      x: a.minX + 10.5, y: a.floor + 2.61, z: a.minZ + 10.5,
      dx: 0, dy: 0, dz: 1 });
    check('healing scenario creates a fresh authoritative shot ticket', fired.length === 1);
    const hurt = s.handle(10, { t: 'rangedAttack', target: 11, amount: 5 });
    check('healing scenario damage is accepted', hurt.some((o) => o.msg.t === 'hurt'));
  };
  const health = () => s.snapshotFor(11).find((p) => p.id === 11)!.health;
  damageOnce();
  s.tickRegen(30);
  check('damaged Duel player does not regenerate without a Medkit', health() === 35);
  for (let used = 0; used < 5; used++) {
    s.handle(11, { t: 'useHeal', item: Item.Medkit });
    for (let tick = 0; tick < 5; tick++) s.tickRegen(0.31);
    check(`Medkit ${used + 1} heals through the normal server cadence`, health() === 40);
    s.tickRegen(0.01); // full health terminates any unused boost window
    if (used < 4) damageOnce();
  }
  damageOnce();
  s.handle(11, { t: 'useHeal', item: Item.Medkit });
  for (let tick = 0; tick < 30; tick++) s.tickRegen(0.31);
  check('a forged sixth Medkit use is rejected for the current life', health() === 35);
}

// Separate simultaneous lobbies are mutually invisible and cannot damage each
// other even when a malicious client submits a real player id.
{
  const s = new GameServer(743, () => 0.5);
  for (const id of [20, 21, 22, 23]) s.addPlayer(id, {
    username: `Isolated${id}`, faction: 0,
  });
  const startPair = (host: number, guest: number): DuelArenaBounds => {
    const created = s.handle(host, { t: 'duelCreate' });
    const lobby = created.find((o) => o.to === host && o.msg.t === 'duelLobby')?.msg;
    if (!lobby || lobby.t !== 'duelLobby' || !lobby.inviteToken) throw new Error('isolated lobby missing');
    s.handle(guest, { t: 'duelJoin', token: lobby.inviteToken });
    s.handle(host, { t: 'duelReady', ready: true });
    s.handle(guest, { t: 'duelReady', ready: true });
    const entered = s.handle(host, { t: 'duelStart' });
    const arena = entered.find((o) => o.to === host && o.msg.t === 'duelArena')?.msg;
    if (!arena || arena.t !== 'duelArena') throw new Error('isolated arena missing');
    s.handle(host, { t: 'duelArenaReady' }); s.handle(guest, { t: 'duelArenaReady' });
    s.tickWar(DUEL_COUNTDOWN_MS / 1000); s.tickDuels();
    return arena.arena;
  };
  const first = startPair(20, 21), second = startPair(22, 23);
  check('simultaneous server matches use distinct arena slots', first.slot !== second.slot);
  check('per-recipient snapshots cannot reveal another Duel lobby',
    s.snapshotFor(20).map((p) => p.id).sort().join(',') === '20,21' &&
    s.snapshotFor(22).map((p) => p.id).sort().join(',') === '22,23');
  check('forged other-lobby damage is rejected',
    s.handle(20, { t: 'rangedAttack', target: 22, amount: 5 }).length === 0);
}

// A result-decision timeout restores the remaining player without needing a
// client request, while a disconnected arena body still captures world state.
{
  const s = new GameServer(744, () => 0.5);
  s.addPlayer(30, { username: 'TimeoutHost', faction: 0, data: {
    x: 301, y: 72, z: -48, slots: [{ id: Item.GoldIngot, count: 3 }],
  } });
  s.addPlayer(31, { username: 'TimeoutGuest', faction: 1, data: {
    x: 302, y: 73, z: -49, slots: [{ id: Item.Diamond, count: 2 }],
  } });
  const created = s.handle(30, { t: 'duelCreate' });
  const lobby = created.find((o) => o.to === 30 && o.msg.t === 'duelLobby')?.msg;
  if (!lobby || lobby.t !== 'duelLobby' || !lobby.inviteToken) throw new Error('timeout lobby missing');
  s.handle(31, { t: 'duelJoin', token: lobby.inviteToken });
  for (const id of [30, 31]) s.handle(id, { t: 'duelReady', ready: true });
  s.handle(30, { t: 'duelStart' });
  for (const id of [30, 31]) s.handle(id, { t: 'duelArenaReady' });
  s.tickWar(DUEL_COUNTDOWN_MS / 1000); s.tickDuels();
  const captured = s.capturePlayerState(30)!.data;
  check('combat-disconnect capture cannot persist temporary arena state',
    captured.x === 301 && (captured.slots as { id?: number }[])[0]?.id === Item.GoldIngot);
  s.removePlayer(30);
  s.tickWar(DUEL_REMATCH_MS / 1000);
  const timedOut = s.tickDuels();
  check('result timeout restores the survivor and original account state', timedOut.some((o) =>
    o.to === 31 && o.msg.t === 'duelRestored' && o.msg.x === 302 &&
    (o.msg.state?.slots as { id?: number }[])[0]?.id === Item.Diamond));
}

console.log(`Duels smoke: ${passed} checks passed`);
