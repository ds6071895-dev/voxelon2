import {
  DUEL_ARENA_FLOOR_Y, DUEL_ARENA_LOAD_TIMEOUT_MS, DUEL_ARENA_SIZE, DUEL_COUNTDOWN_MS,
  DUEL_MAX_ELEVATION, DUEL_MIN_LIGHT, DUEL_MULTI_KILL_MS, DUEL_REMATCH_MS,
  DUEL_RESPAWN_MS, DUEL_ROUND_MS, DUEL_SCORE_LIMIT, DUEL_WALL_ROWS,
  Duels, clampToDuelArena, duelArenaBounds,
  duelArenaBlockAt, duelArenaLightAt, duelArenaSolidAt, duelEventCopy, duelKillEvents,
  duelTerrainElevation, hasArenaLineOfSight, orderedDuelScoreboard,
  safestDuelSpawn, duelTokenFromUrl, withDuelToken,
} from '../src/duels';
import {
  DUEL_DIVISIONS, DUEL_FLAIRS, DUEL_MAX_HISTORY_OPPONENTS, DUEL_PLACEMENT_MATCHES,
  DUEL_RANK_NAMES, DUEL_REVEAL_ASCEND_MS, DUEL_TIER_THEMES,
  canEquipDuelFlair, duelProfileOf, duelRankAt, duelRankProgress, duelRevealState,
  loadDuelProgress, migrateLegacyDuelProgress, newDuelProgress, sanitizeDuelProgress,
  sanitizeDuelRp, settleDuelProgress, unlockedDuelFlairs,
} from '../src/duels_progression';
import { Accounts } from '../src/net/accounts';
import { Block } from '../src/blocks';
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
  check('three-player disconnect keeps the leaver on the rated board and round continues',
    continuing.phase === 'running' && continuing.participants.length === 3 &&
    continuing.participants.find((p) => p.id === 3)?.connected === false);
  const forfeited = d.leave(2, DUEL_COUNTDOWN_MS + 2).snapshot!;
  check('one remaining player wins by forfeit', forfeited.phase === 'results' &&
    forfeited.result?.winner === 1 && forfeited.result.finishReason === 'forfeit' &&
    forfeited.result.scoreboard[0].id === 1 &&
    !forfeited.result.scoreboard[forfeited.result.scoreboard.length - 1]?.connected);
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
  check('arena is open overhead with world-height perimeter barriers',
    duelArenaSolidAt(a.originX, a.floor + 5, a.originZ + 20, a) &&
    duelArenaSolidAt(a.originX, 255, a.originZ + 20, a) &&
    !duelArenaSolidAt(a.originX + 20, a.floor + 20, a.originZ + 20, a));
  const wallMaterials = new Set<number>();
  for (let y = a.floor; y < a.floor + DUEL_WALL_ROWS; y++) {
    for (const z of [10, 12]) wallMaterials.add(duelArenaBlockAt(a.originX, y, a.originZ + z) ?? Block.Air);
  }
  check('colosseum wall stacks ivory pilasters, glowing rune bands and a cornice',
    wallMaterials.has(Block.IvoryColumn) && wallMaterials.has(Block.RuneGlass) &&
    wallMaterials.has(Block.LuminousLimestone) && wallMaterials.has(Block.CarvedVaultBrick));
  check('the wall seals every column above the crenellations',
    duelArenaBlockAt(a.originX, a.floor + DUEL_WALL_ROWS, a.originZ + 10) === Block.Barrier &&
    duelArenaBlockAt(a.originX, a.ceiling - 1, a.originZ + 10) === Block.Barrier);
  // Every wall cell duelArenaSolidAt calls solid must actually be stamped with
  // a block: an Air/null hole in the shell would be a shootable gap.
  let shellHoles = 0;
  for (let x = a.originX; x < a.originX + DUEL_ARENA_SIZE; x++) {
    for (let z = a.originZ; z < a.originZ + DUEL_ARENA_SIZE; z++) {
      for (let y = a.floor - 1; y < a.floor + DUEL_WALL_ROWS + 2; y++) {
        if (!duelArenaSolidAt(x, y, z, a)) continue;
        const block = duelArenaBlockAt(x, y, z);
        if (block === null || block === Block.Air) shellHoles++;
      }
    }
  }
  check('solidity and the block stamp agree on every arena cell', shellHoles === 0, `holes=${shellHoles}`);
  // The four spawn platforms are rotations of one authored corner, so the
  // whole interior must be invariant under a 90-degree turn about its centre.
  let asymmetric = 0;
  for (let lx = 0; lx < 40; lx++) for (let lz = 0; lz < 40; lz++) {
    if (duelTerrainElevation(lx, lz) !== duelTerrainElevation(39 - lz, lx)) asymmetric++;
  }
  check('the arena is exactly four-fold rotationally symmetric', asymmetric === 0, `cells=${asymmetric}`);
  check('spawn corners are colour-coded with four different platform materials',
    new Set(a.spawns.map((spawn) => duelArenaBlockAt(spawn.x, spawn.y - 1, spawn.z))).size === 4);
  check('the altar is the highest natural stand in the arena',
    duelTerrainElevation(19, 19) === 4 && duelTerrainElevation(20, 20) === 4);
  const standY = (x: number, z: number): number | null => {
    let solid = a.floor;
    for (let y = a.floor + 1; y <= a.floor + DUEL_MAX_ELEVATION; y++) {
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
  check('line of sight evaluates terrain bounds correctly',
    !hasArenaLineOfSight({ x: a.minX + 5, y: a.floor - 1, z: a.minZ + 5 }, { x: a.minX + 20, y: a.floor + 5, z: a.minZ + 20 }, a));
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
  const routeTargets = [...a.spawns, { x: a.minX + 20, y: 0, z: a.minZ + 20 }];
  check('route graph connects every spawn platform and the central altar',
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

// Announcer beats: multi-kills, sprees, shutdowns, revenge and the score
// limit are all derived from the authoritative kill feed.
{
  check('first blood is only ever called once, on the opening kill',
    duelKillEvents({ firstKillOfMatch: true, killerSpree: 1, victimSpree: 0, multi: 1,
      revenge: false, killerScore: 1 }).includes('first_blood') &&
    !duelKillEvents({ firstKillOfMatch: false, killerSpree: 1, victimSpree: 0, multi: 1,
      revenge: false, killerScore: 2 }).includes('first_blood'));
  const multi = (n: number) => duelKillEvents({ firstKillOfMatch: false, killerSpree: n,
    victimSpree: 0, multi: n, revenge: false, killerScore: n });
  check('multi-kill names escalate to a quad and then stop escalating',
    multi(2).includes('double_kill') && multi(3).includes('triple_kill') &&
    multi(4).includes('quad_kill') && multi(6).includes('quad_kill'));
  const spree = (n: number) => duelKillEvents({ firstKillOfMatch: false, killerSpree: n,
    victimSpree: 0, multi: 1, revenge: false, killerScore: n });
  check('spree beats fire exactly on 3, 5, 7 and 10 and never in between',
    spree(3).includes('spree') && spree(5).includes('rampage') &&
    spree(7).includes('unstoppable') && spree(10).includes('godlike') &&
    spree(4).length === 0 && spree(11).length === 0);
  check('ending someone else\u2019s spree is a shutdown, and paying back is revenge',
    duelKillEvents({ firstKillOfMatch: false, killerSpree: 1, victimSpree: 4, multi: 1,
      revenge: false, killerScore: 1 }).includes('shutdown') &&
    duelKillEvents({ firstKillOfMatch: false, killerSpree: 1, victimSpree: 0, multi: 1,
      revenge: true, killerScore: 1 }).includes('revenge'));
  check('match point is called one kill before the score limit',
    duelKillEvents({ firstKillOfMatch: false, killerSpree: 1, victimSpree: 0, multi: 1,
      revenge: false, killerScore: DUEL_SCORE_LIMIT - 1 }).includes('match_point') &&
    !duelKillEvents({ firstKillOfMatch: false, killerSpree: 1, victimSpree: 0, multi: 1,
      revenge: false, killerScore: DUEL_SCORE_LIMIT - 2 }).includes('match_point'));
  check('every beat has announcer copy naming who did it',
    duelEventCopy({ seq: 1, kind: 'shutdown', actor: 1, actorName: 'Ana', victim: 2,
      victimName: 'Bo', count: 5, at: 0 }).sub === 'Ana ended Bo');

  const d = new Duels(token);
  const made = d.create(who(1), 0); if ('reason' in made) throw new Error('create failed');
  d.join(made.token, who(2), 0);
  d.setReady(1, true, 0); d.setReady(2, true, 0); d.start(1, 0);
  d.markArenaReady(1, 0); d.markArenaReady(2, 0); d.tick(DUEL_COUNTDOWN_MS);
  const t = DUEL_COUNTDOWN_MS;
  const first = d.recordDeath(2, 1, t)!;
  check('the opening kill lands first blood in the shared feed',
    first.feed.length === 1 && first.feed[0].kind === 'first_blood' && first.feed[0].seq === 1);
  d.tick(t + DUEL_RESPAWN_MS);
  const second = d.recordDeath(2, 1, t + DUEL_RESPAWN_MS + 1)!;
  check('a second kill inside the window is a double kill for the same player',
    second.feed.some((e) => e.kind === 'double_kill' && e.actor === 1 && e.count === 2));
  d.tick(t + DUEL_RESPAWN_MS * 2 + 1);
  const late = d.recordDeath(2, 1, t + DUEL_MULTI_KILL_MS + 5_000)!;
  check('the multi-kill window closes but the spree keeps counting',
    !late.feed.some((e) => e.kind === 'double_kill' && e.seq > second.feed[second.feed.length - 1].seq) &&
    late.participants.find((p) => p.id === 1)!.spree === 3 &&
    late.feed.some((e) => e.kind === 'spree' && e.count === 3));
  check('dying resets the spree but never the best spree on the board',
    (() => {
      d.tick(t + DUEL_MULTI_KILL_MS + 5_000 + DUEL_RESPAWN_MS);
      const snap = d.recordDeath(1, 2, t + DUEL_MULTI_KILL_MS + 6_000)!;
      const killer = snap.participants.find((p) => p.id === 1)!;
      return killer.spree === 0 && killer.bestSpree === 3 &&
        snap.feed.some((e) => e.kind === 'shutdown' && e.actor === 2);
    })());
}

{
  // Reaching the score limit ends the round immediately, ahead of the clock.
  const d = new Duels(token);
  const made = d.create(who(1), 0); if ('reason' in made) throw new Error('create failed');
  d.join(made.token, who(2), 0);
  d.setReady(1, true, 0); d.setReady(2, true, 0); d.start(1, 0);
  d.markArenaReady(1, 0); d.markArenaReady(2, 0); d.tick(DUEL_COUNTDOWN_MS);
  let now = DUEL_COUNTDOWN_MS, last = null as ReturnType<Duels['recordDeath']>;
  for (let kill = 0; kill < DUEL_SCORE_LIMIT; kill++) {
    last = d.recordDeath(2, 1, now);
    now += DUEL_RESPAWN_MS + 1;
    d.tick(now);
  }
  check('the score limit finishes the round early and names the winner',
    last?.phase === 'results' && last.result?.finishReason === 'score' &&
    last.result.winner === 1 && last.result.durationMs < DUEL_ROUND_MS);
  check('the result carries the announcer recap for the summary screen',
    (last!.result!.feed.length > 0) &&
    last!.result!.scoreboard.some((p) => p.bestSpree >= 3));
}

function madeParticipant(id: number, kills: number, deaths: number, joinOrder: number) {
  return { id, username: `P${id}`, skin: id, host: id === 1, ready: true, connected: true,
    profile: duelProfileOf(newDuelProgress()), kills, deaths, alive: true, spectating: false,
    rematchVote: false, joinOrder, spree: 0, bestSpree: 0, multi: 0, multiUntil: 0, lastKilledBy: 0 };
}

{
  check('all 21 rank thresholds resolve exactly', DUEL_DIVISIONS.every((rank, index) =>
    duelRankAt(index * 100).label === rank.label));
  check('division tracks span exactly 100 RP', duelRankProgress(649).progress === .49 &&
    duelRankProgress(650).rank.label === 'Gold III');
  check('RP sanitization rejects junk without capping top-tier progression',
    sanitizeDuelRp(NaN) === 450 && sanitizeDuelRp(-12) === 0 &&
    duelRankAt(75_000).label === 'Voxelon I' && sanitizeDuelRp(75_000) === 75_000);
  check('every named tier owns a distinct theme, emblem and title',
    DUEL_TIER_THEMES.length === DUEL_RANK_NAMES.length &&
    new Set(DUEL_TIER_THEMES.map((t) => t.color)).size === 7 &&
    new Set(DUEL_TIER_THEMES.map((t) => t.emblem)).size === 7 &&
    new Set(DUEL_TIER_THEMES.map((t) => t.flair)).size === 7 &&
    DUEL_TIER_THEMES.every((t, i) => t.facets === i + 3 && t.flair === DUEL_FLAIRS[i]));
  check('a rank carries its whole look, not just a colour',
    DUEL_DIVISIONS.every((rank) => !!rank.accent && !!rank.shade && !!rank.motto &&
      rank.color === DUEL_TIER_THEMES[rank.namedIndex].color));

  const complete = (rp: number) => ({ ...newDuelProgress(), rp, peakRp: rp,
    rank: duelRankAt(rp), placementsRemaining: 0 });
  const equal = settleDuelProgress([
    { id: 1, username: 'EqualOne', state: complete(900) },
    { id: 2, username: 'EqualTwo', state: complete(900) },
  ], 1_000);
  check('equal-rated 1v1 starts at plus/minus 24 RP',
    equal.changes[0].change === 24 && equal.changes[1].change === -24);
  const upset = settleDuelProgress([
    { id: 1, username: 'Underdog', state: complete(500) },
    { id: 2, username: 'Favourite', state: complete(1300) },
  ], 2_000);
  check('underdog upsets are rewarded from authoritative placement', upset.changes[0].change >= 47);
  const expectedWin = settleDuelProgress([
    { id: 1, username: 'Certain', state: complete(10_000) },
    { id: 2, username: 'Longshot', state: complete(0) },
  ], 2_500);
  check('negligible expected results may round to a transparent zero change',
    expectedWin.changes[0].baseSkillDelta === 0 && expectedWin.changes[0].change === 0);
  const placement = settleDuelProgress([
    { id: 1, username: 'PlacingOne', state: newDuelProgress() },
    { id: 2, username: 'PlacingTwo', state: newDuelProgress() },
  ], 3_000);
  check('placements use K=72 while keeping RP visible', placement.changes[0].change === 36 &&
    placement.changes[0].placementsRemaining === DUEL_PLACEMENT_MATCHES - 1);
  const four = settleDuelProgress([1, 2, 3, 4].map((id) => ({
    id, username: `Four${id}`, state: newDuelProgress(),
  })), 4_000);
  check('four-player placement averages every pairwise result',
    four.changes[0].baseSkillDelta === 36 && four.changes[3].baseSkillDelta === -36 &&
    four.changes[1].baseSkillDelta === 12 && four.changes[2].baseSkillDelta === -12);

  let streakState = complete(850); streakState.streak = 2;
  const streak = settleDuelProgress([
    { id: 1, username: 'Streaker', state: streakState },
    { id: 2, username: 'Other', state: complete(850) },
  ], 5_000);
  check('third consecutive first place grants +2 streak RP',
    streak.changes[0].streakBonus === 2 && streak.changes[0].change === 26);
  let repeated = [complete(900), complete(900)];
  const multipliers: number[] = [];
  for (let match = 0; match < 5; match++) {
    const settled = settleDuelProgress([
      { id: 1, username: 'RepeatA', state: repeated[0] },
      { id: 2, username: 'RepeatB', state: repeated[1] },
    ], 10_000 + match);
    multipliers.push(settled.changes[0].repeatMultiplier);
    repeated = settled.states.map((value) => value.state);
  }
  check('same-opponent 24h decay is full, full, half, quarter, tenth',
    multipliers.join(',') === '1,1,0.5,0.25,0.1');

  const shielded = complete(605); shielded.demotionShield = true;
  const shield = settleDuelProgress([
    { id: 1, username: 'ShieldWinner', state: complete(605) },
    { id: 2, username: 'Shielded', state: shielded },
  ], 20_000);
  check('named-rank demotion shield consumes and clamps to rank floor',
    shield.changes[1].shieldUsed && shield.changes[1].afterRp === 600 && !shield.states[1].state.demotionShield);
  const unshielded = complete(605);
  const demoted = settleDuelProgress([
    { id: 1, username: 'DemotionWinner', state: complete(605) },
    { id: 2, username: 'Unshielded', state: unshielded },
  ], 20_500);
  check('ordinary division and named-rank demotions remain possible without a shield',
    demoted.changes[1].demotion && demoted.changes[1].afterRp < 600);
  const promoted = settleDuelProgress([
    { id: 1, username: 'Promoted', state: complete(890) },
    { id: 2, username: 'PromotionLoss', state: complete(890) },
  ], 21_000);
  check('named-rank promotion grants one shield and cosmetic unlock',
    promoted.changes[0].namedRankPromotion && promoted.states[0].state.demotionShield &&
    promoted.changes[0].newlyUnlockedFlair === 'Emerald Blade');

  const legacyCases: [number, number][] = [[0, 0], [899, 299], [900, 300], [2000, 1800], [4000, 2100]];
  check('legacy Elo tier boundaries migrate proportionally', legacyCases.every(([elo, rp]) =>
    migrateLegacyDuelProgress(elo).rp === rp));
  check('migrated records are placement-complete and retain record', (() => {
    const state = loadDuelProgress(undefined, 1100, 12, 7);
    return state.placementsRemaining === 0 && state.peakRp === 600 && state.wins === 12 && state.losses === 7;
  })());
  const revealPlacementState = complete(450); revealPlacementState.placementsRemaining = 1;
  const revealed = settleDuelProgress([
    { id: 1, username: 'RevealWinner', state: revealPlacementState },
    { id: 2, username: 'RevealOther', state: complete(450) },
  ], 22_000);
  check('fifth placement flips the provisional badge and emits a reveal',
    revealed.changes[0].placementReveal && revealed.states[0].state.placementsRemaining === 0);

  const history = newDuelProgress();
  history.opponentHistory = Object.fromEntries(Array.from({ length: 100 }, (_, i) => [`user${i}`, [30_000]]));
  const bounded = sanitizeDuelProgress(history, 30_000);
  check('opponent history survives sanitation while remaining bounded',
    Object.keys(bounded.opponentHistory).length === DUEL_MAX_HISTORY_OPPONENTS);
  const lockedProfile = duelProfileOf(newDuelProgress());
  check('flair authorization rejects locked rank rewards',
    canEquipDuelFlair(lockedProfile, DUEL_FLAIRS[0]) &&
    !canEquipDuelFlair(lockedProfile, DUEL_FLAIRS[1]) && unlockedDuelFlairs(lockedProfile).length === 1);

  const revealChange = equal.changes[0];
  check('deterministic reveal visits impact, hold, count, ascend and settled',
    duelRevealState(revealChange, 0).phase === 'impact' &&
    duelRevealState(revealChange, 600).phase === 'previous' &&
    duelRevealState(revealChange, 1500).phase === 'counting' &&
    duelRevealState(revealChange, 2800).phase === 'ascend' &&
    duelRevealState(revealChange, DUEL_REVEAL_ASCEND_MS).phase === 'settled');
  check('the new rank appears at the ascend beat, before the choreography ends',
    !duelRevealState(revealChange, 1500).revealed &&
    duelRevealState(revealChange, 2800).revealed &&
    !duelRevealState(revealChange, 2800).settled);
  check('the count-up is monotonic and lands exactly on the final RP',
    duelRevealState(revealChange, 1080).displayedRp === revealChange.beforeRp &&
    duelRevealState(revealChange, 2449).displayedRp <= revealChange.afterRp &&
    duelRevealState(revealChange, 2500).displayedRp === revealChange.afterRp);
  check('the division bar tracks the counted number, not the final one',
    Math.abs(duelRevealState(revealChange, 1080).barProgress -
      duelRankProgress(revealChange.beforeRp).progress) < 1e-9);
  check('skip and reduced-motion settle immediately; safe mode removes dense particles',
    duelRevealState(revealChange, 0, { skipped: true }).settled &&
    duelRevealState(revealChange, 0, { reducedMotion: true }).settled &&
    duelRevealState(revealChange, 0, { skipped: true }).revealed &&
    !duelRevealState(revealChange, 1500, { photosensitivitySafe: true }).denseParticles);

  const accounts = new Accounts([{ username: 'LegacyUser', salt: 's', hash: 'h', faction: 0,
    duelElo: 1000, duelWins: 9, duelLosses: 4 }]);
  check('account load performs one-way versioned migration',
    accounts.duelProfile('LegacyUser').rp === 450 && accounts.toJSON()[0].duelProgress?.version === 1 &&
    accounts.toJSON()[0].duelElo === undefined);
}

// Authoritative integration: scope isolation, normalized loadout/state,
// validated same-faction damage, clock fan-out, forfeit and restoration.
{
  const s = new GameServer(740, () => 0.5);
  s.addPlayer(101, { username: 'QueueOne', faction: 0 });
  s.addPlayer(102, { username: 'QueueTwo', faction: 1 });
  const waiting = s.handle(101, { t: 'duelQueue', join: true });
  check('PLAY enters the matchmaking queue without creating a visible lobby',
    waiting.some((out) => out.to === 101 && out.msg.t === 'duelQueue' && out.msg.queued) &&
    !waiting.some((out) => out.msg.t === 'duelLobby'));
  const matched = s.handle(102, { t: 'duelQueue', join: true });
  const matchLobby = matched.find((out) => out.to === 101 && out.msg.t === 'duelLobby')?.msg;
  check('the next queued player creates an automatically-started 1v1',
    !!matchLobby && matchLobby.t === 'duelLobby' && matchLobby.snapshot.phase === 'countdown' &&
    matchLobby.snapshot.participants.length === 2 &&
    matched.filter((out) => out.msg.t === 'duelArena').length === 2);
  check('matchmaking clears queued state for both players and exposes no private invite',
    matched.filter((out) => out.msg.t === 'duelQueue' && !out.msg.queued).length === 2 &&
    matched.filter((out) => out.msg.t === 'duelLobby').every((out) =>
      out.msg.t === 'duelLobby' && !out.msg.inviteToken));

  const spare = new GameServer(739, () => 0.5);
  spare.addPlayer(103, { username: 'QueueCancel', faction: 0 });
  spare.handle(103, { t: 'duelQueue', join: true });
  const cancelled = spare.handle(103, { t: 'duelQueue', join: false });
  check('a waiting player can cancel matchmaking cleanly', cancelled.some((out) =>
    out.to === 103 && out.msg.t === 'duelQueue' && !out.msg.queued));
}

{
  const s = new GameServer(741, () => 0.5);
  let settlementCalls = 0;
  s.onDuelSettlement = (changes) => {
    settlementCalls++;
    const profiles = Object.fromEntries(changes.map((change) =>
      [change.username.toLowerCase(), duelProfileOf(change.state)]));
    return { profiles, leaderboard: changes.map((change) => ({
      username: change.username, ...duelProfileOf(change.state),
    })).sort((a, b) => b.rp - a.rp) };
  };
  s.addPlayer(1, { username: 'RedOne', faction: 0, data: {
    slots: [{ id: Item.Diamond, count: 7 }], armor: [], selected: 0,
  } });
  s.addPlayer(2, { username: 'RedTwo', faction: 0, data: {
    slots: [{ id: Item.GoldIngot, count: 4 }], armor: [], selected: 0,
  } });
  s.addPlayer(3, { username: 'WorldOnly', faction: 1 });
  const lockedFlair = s.handle(1, { t: 'duelFlair', flair: 'Voxelon Mythic' });
  check('server rejects a forged locked-flair selection', lockedFlair.some((out) =>
    out.to === 1 && out.msg.t === 'duelFlairResult' && !out.msg.ok));
  s.handle(1, { t: 'xform', x: 120, y: 70, z: 30, yaw: 0, pitch: 0 });
  s.handle(2, { t: 'xform', x: 125, y: 70, z: 30, yaw: 0, pitch: 0 });
  // Escape/pointer-unlock is client UI state only: a stationary player's
  // authoritative body remains in normal-world snapshots for everybody else.
  check('a stationary paused player remains visible to other players',
    s.snapshotFor(2).some((p) => p.id === 1 && !p.dead));
  const created = s.handle(1, { t: 'duelCreate' });
  const createdMsg = created.find((o) => o.to === 1 && o.msg.t === 'duelLobby')?.msg;
  if (!createdMsg || createdMsg.t !== 'duelLobby' || !createdMsg.inviteToken) {
    throw new Error('server did not return a private invite');
  }
  s.handle(2, { t: 'duelJoin', token: createdMsg.inviteToken });
  check('Duel lobby members remain visible and receive normal-world traffic after closing the lobby UI',
    s.receivesWorldBroadcast(1) && s.receivesWorldBroadcast(2) &&
    s.snapshotFor(3).some((p) => p.id === 1 && !p.dead) &&
    s.snapshotFor(3).some((p) => p.id === 2 && !p.dead));
  s.handle(1, { t: 'duelReady', ready: true });
  s.handle(2, { t: 'duelReady', ready: true });
  const entered = s.handle(1, { t: 'duelStart' });
  const arenaMsg = entered.find((o) => o.to === 1 && o.msg.t === 'duelArena')?.msg;
  if (!arenaMsg || arenaMsg.t !== 'duelArena') throw new Error('arena entry missing');
  const kit = entered.find((o) => o.to === 1 && o.msg.t === 'duelLoadout')?.msg;
  check('server supplies a rifle plus build-only axe, bounce and healing utility', !!kit && kit.t === 'duelLoadout' &&
    kit.slots[0]?.id === Item.BurstRifle && kit.slots[0].count === 1 && kit.slots[0].loaded === 24 &&
    kit.slots[1]?.id === Block.OakPlanks && kit.slots[1].count === 64 &&
    kit.slots[2]?.id === Item.IronAxe && kit.slots[2].count === 1 &&
    kit.slots[3]?.id === Item.JumpBoost && kit.slots[3].count === 5 &&
    kit.slots[4]?.id === Item.Medkit && kit.slots[4].count === 5 &&
    kit.slots.slice(5).every((v) => v === null) && kit.unlimitedReserve);
  check('arena and normal-world visibility scopes are disjoint',
    !s.receivesWorldBroadcast(1) && s.receivesWorldBroadcast(3) &&
    s.snapshotFor(1).every((p) => p.id === 1 || p.id === 2) &&
    s.snapshotFor(3).every((p) => p.id === 3));
  check('arena entry emits immediate synthetic roster leaves in both directions',
    entered.some((o) => o.to === 1 && o.msg.t === 'leave' && o.msg.id === 3) &&
    entered.some((o) => o.to === 3 && o.msg.t === 'leave' && o.msg.id === 1));
  check('a stationary paused arena body remains visible to its opponent',
    s.snapshotFor(2).some((p) => p.id === 1 && !p.dead));
  const persistedInside = s.capturePlayerState(1)!.data;
  check('disconnect/shutdown capture keeps the open-world position and inventory',
    persistedInside.x === 120 &&
    (persistedInside.slots as { id?: number }[])[0]?.id === Item.Diamond);
  s.handle(1, { t: 'saveState', data: { x: arenaMsg.spawn.x, slots: [] } });
  check('match-time saveState is rejected',
    (s.capturePlayerState(1)!.data.slots as { id?: number }[])[0]?.id === Item.Diamond);
  const editsBefore = s.serialize().edits.length;
  check('dropping, pickup and non-running actions are immutable',
    s.handle(1, { t: 'drop', items: [{ id: Item.Diamond, count: 64 }],
      x: arenaMsg.spawn.x, y: arenaMsg.spawn.y, z: arenaMsg.spawn.z }).length === 0 &&
    s.handle(1, { t: 'pickup', eid: 1 }).length === 0 &&
    s.serialize().edits.length === editsBefore);

  s.handle(1, { t: 'duelArenaReady' });
  s.handle(2, { t: 'duelArenaReady' });
  s.tickWar(DUEL_COUNTDOWN_MS / 1000);
  const began = s.tickDuels();
  s.tickWar(1.5); // Clear initial 1.25s spawn shield

  // Test arena edits: 7-block pillar limit and block placement/breaking during match
  const testLx = 15, testLz = 15;
  const testGroundY = arenaMsg.arena.floor + duelTerrainElevation(testLx, testLz);
  const testBx = arenaMsg.arena.minX + testLx, testBz = arenaMsg.arena.minZ + testLz;
  check('cannot break natural ground in duel arena',
    s.handle(1, { t: 'edit', x: testBx, y: testGroundY, z: testBz, block: 0 }).length === 0);
  s.handle(1, { t: 'xform', x: arenaMsg.spawn.x, y: arenaMsg.spawn.y, z: arenaMsg.spawn.z,
    yaw: 0, pitch: 0, held: Block.OakPlanks });
  check('cannot place block higher than 7 blocks above ground (pillar limit)',
    s.handle(1, { t: 'edit', x: testBx, y: testGroundY + 8, z: testBz, block: Block.OakPlanks }).length === 0);
  const placedEdit = s.handle(1, { t: 'edit', x: testBx, y: testGroundY + 1, z: testBz, block: Block.OakPlanks });
  check('can place oak planks within 7 blocks of ground and edit broadcasts to match',
    placedEdit.length === 2 && placedEdit.some((o) => o.to === 2 && o.msg.t === 'edit'));
  const boostedHeight = clampToDuelArena({
    x: testBx + 0.5, y: testGroundY + 7, z: testBz + 0.5,
  }, arenaMsg.arena);
  check('seven-block restriction applies to edits, not player movement',
    boostedHeight.y >= testGroundY + 7);
  s.handle(1, { t: 'xform', x: arenaMsg.spawn.x, y: arenaMsg.spawn.y, z: arenaMsg.spawn.z,
    yaw: 0, pitch: 0, held: Item.BurstRifle });
  check('rifle cannot break player-placed Duel cover',
    s.handle(1, { t: 'edit', x: testBx, y: testGroundY + 1, z: testBz, block: 0 }).length === 0);
  s.handle(1, { t: 'xform', x: arenaMsg.spawn.x, y: arenaMsg.spawn.y, z: arenaMsg.spawn.z,
    yaw: 0, pitch: 0, held: Item.IronAxe });
  const brokenEdit = s.handle(1, { t: 'edit', x: testBx, y: testGroundY + 1, z: testBz, block: 0 });
  check('iron axe can break player-placed oak planks in duel arena',
    brokenEdit.length === 2 && brokenEdit.some((o) => o.to === 2 && o.msg.t === 'edit' && o.msg.block === 0));
  check('iron axe cannot produce Duel PvP damage',
    s.handle(1, { t: 'rangedAttack', target: 2, amount: 5 }).length === 0);
  check('server broadcasts an authoritative active-round clock', began.some((o) =>
    o.to === 1 && o.msg.t === 'duelClock' && o.msg.endsAt - o.msg.serverNow === DUEL_ROUND_MS));
  const arena = arenaMsg.arena;
  const spawn0 = arena.spawns[0];
  const spawn1 = arena.spawns[1];
  const x = spawn0.x, z2 = spawn0.z + 6;

  // Attempting to move through the outer boundary wall is rejected
  s.handle(1, { t: 'xform', x: arena.minX - 2, y: spawn0.y, z: spawn0.z, yaw: 0, pitch: 0, held: Item.BurstRifle });
  check('living transform sweeps cannot pass through arena boundary walls',
    s.snapshotFor(1).find((p) => p.id === 1)!.x >= arena.minX);

  const p1x = spawn0.x, p1z = spawn0.z;
  const p2x = spawn0.x + 3.5, p2z = spawn0.z;
  const blockCoverX = Math.floor(p1x + 2);
  const blockCoverZ = Math.floor(p1z);
  const coverGroundY = arena.floor + duelTerrainElevation(
    blockCoverX - arena.minX, blockCoverZ - arena.minZ);
  const combatY = coverGroundY + 3;
  const blockCoverY = combatY + 1;
  s.handle(1, { t: 'xform', x: p1x, y: combatY, z: p1z, yaw: -Math.PI / 2, pitch: 0, held: Item.BurstRifle });
  s.handle(2, { t: 'xform', x: spawn1.x, y: combatY, z: spawn1.z, yaw: Math.PI / 2, pitch: 0, held: Item.BurstRifle });
  s.handle(2, { t: 'xform', x: p2x, y: combatY, z: p2z, yaw: Math.PI / 2, pitch: 0, held: Item.BurstRifle });

  const fireAtTwo = () => s.handle(1, { t: 'shot' as const, item: Item.BurstRifle,
    x: p1x, y: combatY + 1.6, z: p1z, dx: p2x - p1x, dy: -0.7, dz: p2z - p1z });

  check('server accepts the equipped Duel Burst Rifle', fireAtTwo().length > 0);
  check('forged over-damage is rejected',
    s.handle(1, { t: 'rangedAttack', target: 2, amount: 6 }).length === 0);
  const hit = s.handle(1, { t: 'rangedAttack', target: 2, amount: 5 });
  check('same-faction Duel opponents take normalized five-HP rifle damage', hit.some((o) =>
    o.to === 2 && o.msg.t === 'hurt' && o.msg.health === 35));
  s.tickRegen(30);
  check('Duels disables passive regeneration',
    s.snapshotFor(2).find((p) => p.id === 2)!.health === 35);
  check('a hit without another accepted rifle round is rejected',
    s.handle(1, { t: 'rangedAttack', target: 2, amount: 5 }).length === 0);

  // Test block cover obstruction
  s.handle(1, { t: 'xform', x: p1x, y: combatY, z: p1z,
    yaw: -Math.PI / 2, pitch: 0, held: Block.OakPlanks });
  s.handle(1, { t: 'edit', x: blockCoverX, y: blockCoverY, z: blockCoverZ, block: Block.OakPlanks });
  s.handle(1, { t: 'xform', x: p1x, y: combatY, z: p1z,
    yaw: -Math.PI / 2, pitch: 0, held: Item.BurstRifle });
  s.tickWar(0.51); fireAtTwo();
  check('arena block cover rejects an otherwise valid obstructed hit',
    s.handle(1, { t: 'rangedAttack', target: 2, amount: 5 }).length === 0);
  // Remove the plank with the build-only axe, then re-equip the rifle.
  s.handle(1, { t: 'xform', x: p1x, y: combatY, z: p1z,
    yaw: -Math.PI / 2, pitch: 0, held: Item.IronAxe });
  s.handle(1, { t: 'edit', x: blockCoverX, y: blockCoverY, z: blockCoverZ, block: 0 });
  s.handle(1, { t: 'xform', x: p1x, y: combatY, z: p1z,
    yaw: -Math.PI / 2, pitch: 0, held: Item.BurstRifle });
  check('cross-scope forged damage is rejected both directions',
    s.handle(1, { t: 'rangedAttack', target: 3, amount: 5 }).length === 0 &&
    s.handle(3, { t: 'rangedAttack', target: 1, amount: 5 }).length === 0);
  // Seven more valid rifle hits: 35 -> 0.
  let lethal: ReturnType<typeof s.handle> = [];
  for (let swing = 0; swing < 7; swing++) {
    s.tickWar(0.51); fireAtTwo();
    lethal = s.handle(1, { t: 'rangedAttack', target: 2, amount: 5 });
  }
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
  check('server respawn is exactly timed and replaces a fresh loadout',
    !!fresh && fresh.t === 'duelLoadout' &&
    fresh.slots[0]?.id === Item.BurstRifle && fresh.slots[0].count === 1 && fresh.slots[0].loaded === 24 &&
    fresh.slots[1]?.id === Block.OakPlanks && fresh.slots[1].count === 64 &&
    fresh.slots[2]?.id === Item.IronAxe && fresh.slots[2].count === 1 &&
    fresh.slots[3]?.id === Item.JumpBoost && fresh.slots[3].count === 5 &&
    fresh.slots[4]?.id === Item.Medkit && fresh.slots[4].count === 5 &&
    respawned.some((o) => o.to === 2 && o.msg.t === 'duelRespawn' && !o.msg.spectating));
  check('respawned avatar becomes visible again',
    !s.snapshotFor(1).find((p) => p.id === 2)!.dead);

  const forfeited = s.handle(1, { t: 'duelLeave' });
  check('leaving a two-player round yields a scoped forfeit result', forfeited.some((o) =>
    o.to === 2 && o.msg.t === 'duelResult' && o.msg.result.winner === 2 &&
    o.msg.result.finishReason === 'forfeit' && o.msg.result.progressChanges.length === 2));
  check('server settles and persists a result exactly once before fan-out', settlementCalls === 1);
  s.handle(2, { t: 'duelFlair', flair: 'Scrapper' });
  check('revisiting the result snapshot cannot settle it twice', settlementCalls === 1);
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

// Every match opens on a bare arena. The per-lobby record of what was placed
// is not the thing that gets cleared — the arena's FOOTPRINT is — so a plank
// nobody is tracking any more (a forfeit, a crash, a world reloaded off disk)
// cannot be standing there when the next fight starts.
{
  const seed = 913;
  const s = new GameServer(seed, () => 0.5);
  const a0 = duelArenaBounds(0);
  const lx = 20, lz = 20;
  const bx = a0.minX + lx, bz = a0.minZ + lz;
  const by = a0.floor + duelTerrainElevation(lx, lz) + 2;
  const key = `${bx},${by},${bz}`;
  // A world that comes back from disk with cover still standing in the arena.
  s.restore({ v: 2, seed, edits: [[key, Block.OakPlanks]] });
  check('a stale arena plank survives a world reload',
    s.serialize().edits.some(([k, b]) => k === key && b === Block.OakPlanks));

  s.addPlayer(1, { username: 'Stale', faction: 0 });
  s.addPlayer(2, { username: 'Fresh', faction: 0 });
  const created = s.handle(1, { t: 'duelCreate' });
  const lobby = created.find((o) => o.to === 1 && o.msg.t === 'duelLobby')?.msg;
  if (!lobby || lobby.t !== 'duelLobby' || !lobby.inviteToken) throw new Error('sweep lobby missing');
  s.handle(2, { t: 'duelJoin', token: lobby.inviteToken });
  for (const id of [1, 2]) s.handle(id, { t: 'duelReady', ready: true });
  const entered = s.handle(1, { t: 'duelStart' });
  const arenaMsg = entered.find((o) => o.to === 1 && o.msg.t === 'duelArena')?.msg;
  if (!arenaMsg || arenaMsg.t !== 'duelArena') throw new Error('sweep arena missing');
  check('the swept arena is the one the match was actually given',
    arenaMsg.arena.slot === 0);
  check('starting a match clears untracked oak planks from the arena',
    !s.serialize().edits.some(([k]) => k === key));
  const cleared = (id: number) => entered.some((o) => o.to === id && o.msg.t === 'editBatch' &&
    o.msg.edits.some((e) => e.x === bx && e.y === by && e.z === bz && e.block === Block.Air));
  check('and both clients are told to remove it', cleared(1) && cleared(2));

  // The sweep is scoped to the arena: the open world is never touched.
  const s2 = new GameServer(seed, () => 0.5);
  s2.restore({ v: 2, seed, edits: [['40,80,40', Block.OakPlanks], [key, Block.OakPlanks]] });
  s2.addPlayer(1, { username: 'Stale', faction: 0 });
  s2.addPlayer(2, { username: 'Fresh', faction: 0 });
  const made = s2.handle(1, { t: 'duelCreate' })
    .find((o) => o.to === 1 && o.msg.t === 'duelLobby')?.msg;
  if (!made || made.t !== 'duelLobby' || !made.inviteToken) throw new Error('scope lobby missing');
  s2.handle(2, { t: 'duelJoin', token: made.inviteToken });
  for (const id of [1, 2]) s2.handle(id, { t: 'duelReady', ready: true });
  s2.handle(1, { t: 'duelStart' });
  const after = s2.serialize().edits;
  check('the sweep never reaches outside the arena footprint',
    after.some(([k]) => k === '40,80,40') && !after.some(([k]) => k === key));
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
  s.tickWar(1.5); // Clear spawn shield
  const a = arenaMsg.arena;
  const sp0 = a.spawns[0], sp1 = a.spawns[1];
  const combatY = a.floor + 5;
  s.handle(10, { t: 'xform', x: sp0.x, y: combatY, z: sp0.z, yaw: -Math.PI / 2, pitch: 0, held: Item.BurstRifle });
  s.handle(11, { t: 'xform', x: sp1.x, y: combatY, z: sp1.z, yaw: Math.PI / 2, pitch: 0, held: Item.BurstRifle });
  s.handle(11, { t: 'xform', x: sp0.x + 3.5, y: combatY, z: sp0.z, yaw: Math.PI / 2, pitch: 0, held: Item.BurstRifle });

  const damageOnce = (): void => {
    s.tickWar(0.51);
    s.handle(10, { t: 'shot', item: Item.BurstRifle,
      x: sp0.x, y: combatY + 1.6, z: sp0.z, dx: 3.5, dy: -0.7, dz: 0 });
    const hurt = s.handle(10, { t: 'rangedAttack', target: 11, amount: 5 });
    check('healing scenario accepts a fresh authoritative rifle hit', hurt.some((o) => o.msg.t === 'hurt'));
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
    s.tickWar(1.5);
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
