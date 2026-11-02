// Lucky Pillars: rules ported from the plugin, the loot table's odds, and a
// whole bot match through the real GameServer.
import assert from 'node:assert/strict';
import { GameServer, type Outbound } from '../src/net/server_core';
import { Accounts } from '../src/net/accounts';
import { mulberry32 } from '../src/noise';
import { LOOT, tierChance } from '../src/pillars_loot';
import { LP, borderSize, lavaLevel, lootBoost, lootInterval, lpPillars, lpSeed, lpUnseed, ringRadius, voidY } from '../src/pillars_rules';
import type { ServerMsg } from '../src/net/protocol';

const near = (a: number, b: number, eps: number) => Math.abs(a - b) <= eps;

export function runPillarsTests(): number {
  let n = 0;
  const t = (_name: string, fn: () => void) => { fn(); n++; };
  console.log('▸ Lucky Pillars');

  t('loot table totals and tier odds match the source', () => {
    const total = (r: string) => LOOT.filter((e) => e.rarity === r).reduce((s, e) => s + e.weight, 0);
    assert.deepEqual(['common', 'uncommon', 'rare', 'epic', 'legendary'].map(total), [430, 247, 112, 42, 7]);
    assert.ok(near(tierChance('common', 1), .513, .002));
    assert.ok(near(tierChance('legendary', 1), .0084, .0005));
    assert.ok(near(tierChance('rare', 1.8), .192, .002));
    assert.ok(near(tierChance('epic', 1.8), .072, .002));
    assert.equal(LOOT.filter((e) => e.starter).length, 5);
    for (const e of LOOT) assert.ok(e.make(() => .5).length > 0, e.name);
  });
  t('arena: ring radius, layouts, border, void, lava, loot timing', () => {
    assert.equal(ringRadius(2), 15); assert.equal(ringRadius(4), 15); assert.equal(ringRadius(10), 32);
    assert.equal(borderSize('ring', 4), 48); assert.equal(borderSize('star', 4), 58);
    const spiral = lpPillars('spiral', 4, 0);
    assert.deepEqual(spiral.map((p) => p.topY), [100, 98, 96, 94]);
    assert.equal(voidY('slime_floor'), 60); assert.equal(voidY('tnt_rain'), 66);
    assert.equal(lavaLevel(0, 0), LP.BOTTOM_Y);
    assert.equal(lavaLevel(LP.MAIN_TICKS, 0), LP.TOP_Y - 2);
    assert.equal(lavaLevel(LP.MAIN_TICKS, 30 * 20 * 2), LP.TOP_Y);
    assert.equal(lootInterval('loot_frenzy', false, true), 15);
    assert.equal(lootInterval('tnt_rain', true, false), 40);
    assert.ok(near(lootBoost('lucky_streak', LP.MAIN_TICKS, false), 7.2, 1e-9));
    const s = lpUnseed(lpSeed('star', 4, 300, false));
    assert.equal(s.layout, 'star'); assert.equal(s.players, 4);
  });
  t('a queued player meets bots after 10 s and the match finishes with results', () => {
    const rng = mulberry32(11);
    const server = new GameServer({ accounts: new Accounts(), rng, token: () => Math.floor(rng() * 1e16).toString(36).padEnd(32, 'x') });
    const me = server.connect();
    const inbox: ServerMsg[] = [];
    const take = (out: Outbound[]) => { for (const o of out) if (o.to === me) inbox.push(o.msg); };
    take(server.handle(me, { t: 'hello' }));
    take(server.handle(me, { t: 'play', mode: 'pillars' }));
    let world = -1, result = false;
    for (let i = 0; i < 20 * 60 * 9 && !result; i++) {
      take(server.tick(.05));
      const arena = inbox.find((m) => m.t === 'mArena');
      if (arena && world < 0 && arena.t === 'mArena') {
        world = arena.world.id;
        assert.ok(i * .05 >= 9.9, 'bots wait the usual ten seconds');
        take(server.handle(me, { t: 'worldReady', world }));
      }
      result = inbox.some((m) => m.t === 'm' && m.d.k === 'state' && !!(m.d.s as { result?: unknown }).result);
      if (inbox.length > 4000) inbox.splice(0, 3000);
    }
    assert.ok(world >= 0, 'the match started');
    assert.ok(result, 'the match reached its results');
    assert.ok(!JSON.stringify(inbox).includes('"bot"'), 'nothing on the wire says bot');
  });
  console.log(`Lucky Pillars: ${n} tests passed.`);
  return n;
}
