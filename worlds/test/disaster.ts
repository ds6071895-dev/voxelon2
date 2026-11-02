// Disaster City: the wave schedule, clash rules and scaling ported from the
// plugin, the fixed city's landmarks, and a whole bot match through the real
// GameServer.
import assert from 'node:assert/strict';
import { GameServer, type Outbound } from '../src/net/server_core';
import { Accounts } from '../src/net/accounts';
import { mulberry32 } from '../src/noise';
import { Block } from '../src/blocks';
import {
  BUILDINGS, CITY, DISASTERS, DR, bcx, bcz, citySpawns, conflicts, crackEvery, fireStarts, gasLeaks, isRoad, lightningEvery,
  manholes, meteorEvery, pickDisaster, sinkholeEvery, waveDuration, waveStart, zombieCount, type DisasterKind, type DisasterState,
} from '../src/disaster_rules';
import { cityStamp } from '../src/disaster_city';
import type { ServerMsg } from '../src/net/protocol';

export function runDisasterTests(): number {
  let n = 0;
  const t = (_name: string, fn: () => void) => { fn(); n++; };
  console.log('▸ Disaster City');

  t('waves: at most 3 at once, exactly 3 from wave 7, all before the apocalypse', () => {
    const active = (tick: number) => {
      let c = 0;
      for (let w = 0; w < DR.WAVES; w++) if (tick >= waveStart(w) && tick < Math.min(DR.FINALE_AT, waveStart(w) + waveDuration(w))) c++;
      return c;
    };
    let most = 0;
    for (let tick = 0; tick < DR.FINALE_AT; tick++) most = Math.max(most, active(tick));
    assert.equal(most, 3);
    for (let w = 7; w < DR.WAVES; w++) assert.equal(active(waveStart(w)), 3, `wave ${w}`);
    assert.equal(active(waveStart(1)), 1, 'the first two never overlap');
    assert.ok(waveStart(DR.WAVES - 1) < DR.FINALE_AT);
    assert.deepEqual([0, 1, 2, 4, 5, 10].map(waveDuration), [320, 320, 720, 720, 1120, 1120]);
  });
  t('picking never runs a clash pair and skips the recent four when it can', () => {
    assert.ok(conflicts('flood', 'tsunami') && conflicts('tsunami', 'flood'));
    assert.ok(conflicts('blizzard', 'wildfire') && conflicts('blizzard', 'acid_rain'));
    assert.ok(!conflicts('flood', 'wildfire'));
    const rng = mulberry32(5);
    for (let i = 0; i < 2000; i++) {
      const pool = DISASTERS.map((d) => d.id);
      const active: DisasterKind[] = [pool[Math.floor(rng() * 12)], pool[Math.floor(rng() * 12)]];
      const recent: DisasterKind[] = [0, 1, 2, 3].map(() => pool[Math.floor(rng() * 12)]);
      const pick = pickDisaster(rng, recent, active);
      for (const a of active) assert.ok(!conflicts(pick, a), `${pick} with ${a}`);
      const freshLeft = pool.some((id) => !recent.includes(id) && !active.some((a) => conflicts(id, a)));
      if (freshLeft) assert.ok(!recent.includes(pick), `${pick} was recent`);
    }
  });
  t('scaling at 4 players matches the source formulas', () => {
    assert.deepEqual([meteorEvery(4, 1), zombieCount(4), sinkholeEvery(4), lightningEvery(4, 1), gasLeaks(4), crackEvery(4, 1), fireStarts(4)],
      [7, 16, 31, 10, 6, 21, 3]);
    assert.equal(meteorEvery(4, DR.FINALE_INTENSITY), 4);
    assert.equal(zombieCount(1), 8);
  });
  t('the city: landmarks, roads, manholes and spawns', () => {
    const s = cityStamp();
    assert.equal(s, cityStamp(), 'built once per process');
    for (const b of BUILDINGS) {
      // Median of a few roof samples: masts, tanks and skylights stick out.
      const tops: number[] = [];
      for (const [ox, oz] of [[0, 0], [2, 1], [-2, -1], [1, -2], [-1, 2]]) {
        const x = bcx(b) + ox, z = bcz(b) + oz;
        for (let y = CITY.BUILD_MAX_Y; y > CITY.GROUND; y--) if (s.get(x, y, z) !== Block.Air) { tops.push(y); break; }
      }
      const top = tops.sort((p, q) => p - q)[2] ?? -1;
      assert.ok(top >= b.roof - 1 && top <= b.roof + 6, `${b.name}: roof at ${top}, expected ${b.roof} (gables up to +6)`);
    }
    for (const [x, z] of manholes()) assert.ok(isRoad(x, z), `manhole ${x},${z} on a road`);
    for (const [x, y, z] of citySpawns()) {
      // Spawns name the floor block; the body stands on top of it.
      assert.notEqual(s.get(x, y, z), Block.Air, `spawn ${x},${z} has ground`);
      assert.equal(s.get(x, y + 1, z), Block.Air, `spawn ${x},${z} is clear`);
      assert.equal(s.get(x, y + 2, z), Block.Air);
    }
    let hash = 0;
    for (let x = CITY.MIN; x <= CITY.MAX; x += 3) for (let z = CITY.MIN; z <= CITY.MAX; z += 3) for (let y = 50; y < 120; y += 2) hash = (hash * 31 + s.get(x, y, z)) >>> 0;
    const again = (() => { let h = 0; for (let x = CITY.MIN; x <= CITY.MAX; x += 3) for (let z = CITY.MIN; z <= CITY.MAX; z += 3) for (let y = 50; y < 120; y += 2) h = (h * 31 + s.get(x, y, z)) >>> 0; return h; })();
    assert.equal(hash, again);
  });
  t('a queued player meets bots after 10 s and the match ends with results', () => {
    const rng = mulberry32(23);
    const server = new GameServer({ accounts: new Accounts(), rng, token: () => Math.floor(rng() * 1e16).toString(36).padEnd(32, 'x') });
    const me = server.connect();
    const inbox: ServerMsg[] = [];
    const take = (out: Outbound[]) => { for (const o of out) if (o.to === me) inbox.push(o.msg); };
    take(server.handle(me, { t: 'hello' }));
    take(server.handle(me, { t: 'play', mode: 'disaster' }));
    let world = -1, result: DisasterState['result'] | undefined, players = 0, launched = 0;
    for (let i = 0; i < 20 * 60 * 7 && !result; i++) {
      take(server.tick(.05));
      if (world < 0) {
        const arena = inbox.find((m) => m.t === 'mArena');
        if (arena && arena.t === 'mArena') {
          world = arena.world.id;
          assert.ok(i * .05 >= 9.9, 'bots wait the usual ten seconds');
          take(server.handle(me, { t: 'worldReady', world }));
        }
      }
      for (const m of inbox) if (m.t === 'm' && m.d.k === 'state') {
        const s = m.d.s as DisasterState;
        players = Math.max(players, s.players.length);
        launched = Math.max(launched, s.wave);
        if (s.result) result = s.result;
      }
      if (inbox.length > 4000) inbox.splice(0, 3000);
    }
    assert.ok(world >= 0, 'the match started');
    assert.equal(players, 4, 'bots fill to four');
    assert.ok(result, 'the match reached its results');
    assert.ok(launched >= 1, 'disasters launched');
    assert.equal(result!.rows.length, 4);
    assert.ok(!JSON.stringify(inbox).includes('"bot"'), 'nothing on the wire says bot');
  });
  console.log(`Disaster City: ${n} tests passed.`);
  return n;
}
