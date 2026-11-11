// Party Games: the plugin's PartyRulesCheck and PartyScalingCheck (points,
// ties, the selection bag, scaling, the catalog), the batch-A arenas and
// games, and whole bot matches through the real GameServer.
import assert from 'node:assert/strict';
import { GameServer, type Outbound } from '../src/net/server_core';
import { Accounts } from '../src/net/accounts';
import { mulberry32 } from '../src/noise';
import { BLOCKS } from '../src/blocks';
import {
  MG, MG_GAMES, MG_LENGTHS, award, fits, mgPool, nextLength, pick, pointsFor, pointsForPlain, rankByScore, remember, scale,
  type MgCategory, type MgEntry,
} from '../src/minigames_rules';
import type { MinigamesState } from '../src/minigames_state';
import type { ServerMsg } from '../src/net/protocol';
import { arenaStamp, createGame, worldSeed } from '../src/minigames/arenas';
import { mgIndex } from '../src/minigames_rules';
import { BASE_Y } from '../src/minigames/arena';
import { BoatRush, BOAT_LAPS } from '../src/minigames/boat';
import { WhackAMole } from '../src/minigames/whack';
import { TreasureCove, HALF, DEPTH } from '../src/minigames/treasure';
import { generate } from '../src/minigames/brain';
import '../src/net/engine_modes';

export function runMinigamesTests(): number {
  let n = 0;
  const t = (_name: string, fn: () => void) => { fn(); n++; };
  console.log('▸ Party Games');

  t('Boat Rush finishes on the first lap and shows one-lap progress', () => {
    const game = new BoatRush(0);
    assert.equal(BOAT_LAPS, 1);
    game.alive.add(1);
    game.participants.add(1);
    const [x,z] = game.circuit.line[0];
    game.attach({ host: { body: () => ({ x,z }) }, sim: { players: new Map([[1,{riding:1}]]), dismount: () => {} } } as never);
    let finished = false;
    game.finishRace = (id) => { assert.equal(id,1);finished=true;game.alive.delete(id); };
    game.t = 1;
    game.distance.set(1,game.circuit.length-.5);
    game.lastIndex.set(1,0);
    game.tick();
    assert.equal(finished,false,'the finish requires a complete lap');
    assert.equal(game.bar(1),'Lap 1/1');
    game.distance.set(1,game.circuit.length);
    game.tick();
    assert.equal(finished,true,'one complete lap finishes the race');
    assert.equal(game.progressDetail(1),'100% done');
  });

  t('points table, ties and the stretched table (PartyRulesCheck.points)', () => {
    assert.ok(pointsForPlain(0, false) === 10 && pointsForPlain(1, false) === 8 && pointsForPlain(7, false) === 1 && pointsForPlain(9, false) === 1);
    assert.equal(pointsForPlain(0, true), 20);
    const tie = award([['a', 'b'], ['c'], ['d']], false);
    assert.deepEqual([tie.get('a'), tie.get('b'), tie.get('c'), tie.get('d')], [10, 10, 3, 1]);
    assert.ok([...award([['a', 'b', 'c']], false).values()].every((v) => v === 10));
    const ranked = rankByScore(['a', 'b', 'c', 'd'], (id) => ({ a: 5, b: 5, c: 9 } as Record<string, number>)[id] ?? 1, null);
    assert.ok(ranked.length === 3 && ranked[0][0] === 'c' && ranked[1].length === 2);
    const broken = rankByScore(['a', 'b'], () => 5, (id) => id === 'a' ? 30 : 10);
    assert.ok(broken.length === 2 && broken[0][0] === 'b');
    assert.ok(pointsFor(0, 2, false) === 10 && pointsFor(1, 2, false) === 1);
    assert.ok(pointsFor(0, 3, true) === 20 && pointsFor(2, 3, false) === 1);
    for (let players = MG.MIN_PLAYERS; players <= MG.MAX_PLAYERS; players++) {
      assert.equal(pointsFor(0, players, false), 10);
      for (let place = 1; place < players; place++) {
        const now = pointsFor(place, players, false);
        assert.ok(now <= pointsFor(place - 1, players, false) && now >= 1);
      }
      assert.ok(pointsFor(players - 1, players, false) <= 2);
    }
    assert.ok(pointsFor(1, 10, false) === 8 && pointsFor(7, 10, false) === 1);
    // The plan's table for Worlds' four seats.
    assert.deepEqual([0, 1, 2, 3].map((p) => pointsFor(p, 4, false)), [10, 6, 3, 1]);
    assert.deepEqual([0, 1, 2].map((p) => pointsFor(p, 3, false)), [10, 4, 1]);
  });

  t('the selection bag (PartyRulesCheck.selection)', () => {
    const pool: MgEntry[] = MG_GAMES.map((g) => ({ id: g.id, category: g.category }));
    assert.equal(pool.length, 22);
    const rng = mulberry32(42);
    for (const length of MG_LENGTHS) {
      const recent: string[] = [];
      for (let match = 0; match < 200; match++) {
        const picked = pick(pool, length, recent, new Set(), rng);
        assert.equal(picked.length, Math.min(length, pool.length));
        assert.equal(new Set(picked.map((e) => e.id)).size, picked.length, 'no repeats within a match');
        if (length <= 8) {
          for (let i = 1; i < picked.length; i++) assert.ok(!(picked[i].category === 'SURVIVAL' && picked[i - 1].category === 'SURVIVAL'));
          for (let i = 2; i < picked.length; i++) assert.ok(!(picked[i].category === picked[i - 1].category && picked[i].category === picked[i - 2].category));
        }
        if (length === 3 && match > 0) {
          const last = recent.slice(Math.max(0, recent.length - 3));
          for (const e of picked) assert.ok(!last.includes(e.id), 'replayed a game from the previous match');
        }
        remember(recent, picked);
        assert.ok(recent.length <= MG.RECENT_MEMORY);
      }
    }
    const recent: string[] = [];
    const seen = new Set<string>();
    for (let match = 0; match < 12; match++) { const p = pick(pool, 3, recent, new Set(), rng); p.forEach((e) => seen.add(e.id)); remember(recent, p); }
    assert.ok(seen.size >= 22, `every game within 12 three-game matches (saw ${seen.size})`);
    const banned = new Set(pool.slice(0, 14).map((e) => e.id));
    const limited = pick(pool, 8, [], banned, rng);
    assert.ok(limited.length === 8 && limited.every((e) => !banned.has(e.id)));
    assert.equal(pick(pool, 3, [], new Set(pool.map((e) => e.id)), rng).length, 0, 'a fully banned pool picks nothing');
    assert.ok(!fits([{ id: 'a', category: 'SURVIVAL' }], { id: 'b', category: 'SURVIVAL' }));
  });

  t('scaling, length cycling and the catalog (PartyRulesCheck.scaling/catalog)', () => {
    assert.ok(scale(2, 4, 20) === 4 && scale(10, 4, 20) === 20 && scale(6, 4, 20) === 12);
    assert.ok(scale(1, 4, 20) === 4 && scale(14, 4, 20) === 20);
    assert.ok(nextLength(3, 1) === 5 && nextLength(20, 1) === 3 && nextLength(3, -1) === 20);
    const per: Record<MgCategory, number> = { SURVIVAL: 0, RACE: 0, SCORE: 0, BRAIN: 0 };
    const ids = new Set<string>();
    for (const g of MG_GAMES) {
      assert.ok(!ids.has(g.id)); ids.add(g.id);
      assert.match(g.id, /^[a-z_]+$/);
      assert.ok(g.name.length <= 16, g.name);
      per[g.category]++;
    }
    assert.deepEqual(per, { SURVIVAL: 6, RACE: 8, SCORE: 6, BRAIN: 2 });
    assert.equal(mgPool().length,22);
  });

  t('batch-A scaling (PartyScalingCheck)', () => {
    for (let p = 2; p <= 10; p++) {
      assert.ok(WhackAMole.molesPerPop(p) >= WhackAMole.molesPerPop(p - 1 || 1));
      assert.ok(TreasureCove.findsPerQuarter(p) >= TreasureCove.findsPerQuarter(Math.max(2, p - 1)));
      assert.ok(4 * (TreasureCove.findsPerQuarter(p) + 2) <= HALF * 2 * HALF * 2 * DEPTH / 2);
    }
  });

  t('every shipped arena builds, and every spawn stands on ground with headroom', () => {
    for (const g of mgPool()) {
      const s = arenaStamp(worldSeed(mgIndex(g.id)));
      const game = createGame(g.id)!;
      game.attach({ rng: mulberry32(1) } as never);
      for (const sp of game.spawns(4)) {
        const x = Math.floor(sp.x), y = Math.floor(sp.y), z = Math.floor(sp.z);
        assert.ok(BLOCKS[s.get(x, y - 1, z)]?.solid, `${g.id}: ground under spawn ${x},${y},${z}`);
        assert.ok(!BLOCKS[s.get(x, y, z)]?.solid && !BLOCKS[s.get(x, y + 1, z)]?.solid, `${g.id}: headroom at ${x},${y},${z}`);
      }
    }
  });

  t('Brain Rush questions are sound', () => {
    const rng = mulberry32(9);
    for (let i = 0; i < 2000; i++) {
      const q = generate(rng, i % 4);
      assert.equal(q.options.length, 4);
      assert.equal(new Set(q.options).size, 4, q.prompt);
      assert.ok(q.answer >= 0 && q.answer < 4);
    }
  });

  /** Drive a whole match through the server: an AFK human plus three bots. */
  const play = (seed: number, games: string[] | null) => {
    const rng = mulberry32(seed);
    const server = new GameServer({ accounts: new Accounts(), rng, token: () => Math.floor(rng() * 1e16).toString(36).padEnd(32, 'x') });
    const me = server.connect();
    const inbox: ServerMsg[] = [];
    const take = (out: Outbound[]) => { for (const o of out) if (o.to === me) inbox.push(o.msg); };
    take(server.handle(me, { t: 'hello' }));
    if (games) {
      take(server.handle(me, { t: 'partyCreate' }));
      const code = (inbox.filter((m) => m.t === 'party').pop() as Extract<ServerMsg, { t: 'party' }>).party!.code;
      const friend = server.connect();
      server.handle(friend, { t: 'hello' });
      server.handle(friend, { t: 'partyJoin', code });
      take(server.handle(me, { t: 'mgSetup', setup: { length: 3, banned: [], playlist: { name: 'All', games }, revision: 0 } } as never));
      take(server.handle(me, { t: 'play', mode: 'minigames', fill: true }));
    } else take(server.handle(me, { t: 'play', mode: 'minigames' }));
    let worldId = -1, worldSeedSeen = -1, startedAt = -1;
    const results: NonNullable<MinigamesState['results']>[] = [];
    let last: MinigamesState | null = null, podium: MinigamesState['podium'] = null, closed = false;
    for (let i = 0; i < 20 * 60 * 60 && !closed; i++) {
      take(server.tick(.05));
      for (const m of inbox.splice(0)) {
        if (m.t === 'mArena') {
          if (worldId < 0) startedAt = i;
          worldId = m.world.id;
          if (m.world.seed !== worldSeedSeen) { worldSeedSeen = m.world.seed; take(server.handle(me, { t: 'worldReady', world: worldId })); }
        }
        if (m.t === 'm' && m.d.k === 'state') {
          const s = m.d.s as MinigamesState;
          last = s;
          if (s.results && !results.some((r) => r.game === s.results!.game)) results.push(s.results);
          if (s.podium) podium = s.podium;
        }
        if (m.t === 'leftWorld') closed = true;
        assert.ok(!JSON.stringify(m).includes('"bot"'), 'nothing on the wire says bot');
      }
    }
    return { results, last, podium, closed, startedAt };
  };

  t('every shipped game finishes with bots, scores points, and the match ends on the podium', () => {
    const games = mgPool().map((g) => g.id);
    const matches=[];for(let i=0;i<games.length;i+=18)matches.push(play(31+i,games.slice(i,i+18)));
    const r={...matches[matches.length-1],results:matches.flatMap(m=>m.results)};
    assert.deepEqual(r.results.map((x) => x.game), games, 'every game in the playlist reached its results');
    for (const res of r.results) {
      assert.equal(res.rows.length, 4, `${res.game}: four placed`);
      const botPoints = res.rows.filter((row) => row.place <= 3).length;
      assert.ok(botPoints >= 1, `${res.game}: placements`);
      // The AFK human scores nothing, so the bots must take the top places.
      const top = res.rows[0];
      assert.ok(!/^0 pts|^0\/3/.test(top.detail), `${res.game}: the winner actually scored (${top.detail})`);
      console.log(`    ${res.game}: ${res.rows.map((row) => `${row.place}. ${row.detail}`).join(' | ')}`);
    }
    assert.ok(r.podium && r.podium.order.length === 4, 'podium with all four');
    assert.ok(r.podium!.awards.some((a) => a.title === 'Champion'));
    assert.equal(r.last!.results, null);
    assert.ok(r.closed, 'back to the menu after the podium');
  });

  t('the solo queue meets bots after 10 s and plays a three-game mix', () => {
    const r = play(77, null);
    assert.ok(r.startedAt * .05 >= 9.9, 'bots wait the usual ten seconds');
    assert.equal(r.results.length, 3);
    assert.equal(new Set(r.results.map((x) => x.game)).size, 3);
    assert.ok(r.podium);
  });

  console.log(`Party Games: ${n} tests passed.`);
  return n;
}

if (process.argv[1]?.endsWith('minigames.cjs')) runMinigamesTests();
void BASE_Y;
