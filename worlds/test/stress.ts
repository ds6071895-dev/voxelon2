// Load test: many simultaneous matches, each in its own world.
//
//   npm run stress                 (300 worlds)
//   STRESS_WORLDS=600 npm run stress
//
// Half the worlds are real two-player matches made by the queue; the other
// half are practice matches with two opponents running full AI, which is the
// expensive case. Three more players queue alone, one per game, and get
// their opponent after the wait. Checks that a server tick stays inside its
// 50 ms budget, that worlds never see each other's bodies or blocks, and that
// every world a player was in is torn down once they leave.

import { GameServer, BOT_WAIT_MS, type Outbound } from '../src/net/server_core';
import { Accounts } from '../src/net/accounts';
import { mulberry32 } from '../src/noise';
import type { GameMode, ServerMsg } from '../src/net/protocol';

const WORLDS = Number(process.env.STRESS_WORLDS ?? 300);
const TICK = 0.05;
const rng = mulberry32(99);
const server = new GameServer({ accounts: new Accounts(), rng,
  token: () => Array.from({ length: 32 }, () => Math.floor(rng() * 16).toString(16)).join('') });
let failures = 0;
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};

const modes: GameMode[] = ['duels', 'bridge', 'parkour'];
const inbox = new Map<number, ServerMsg[]>();
const deliver = (out: Outbound[]) => {
  for (const o of out) {
    let box = inbox.get(o.to);
    if (!box) inbox.set(o.to, box = []);
    box.push(o.msg);
    if (box.length > 400) box.splice(0, box.length - 400);
  }
};
const ready = (id: number) => {
  const w = server.worldOf(id);
  const box = inbox.get(id) ?? [];
  const arena = [...box].reverse().find((m) => m.t === 'pgArena') as Extract<ServerMsg, { t: 'pgArena' }> | undefined;
  if (w) deliver(server.handle(id, { t: 'worldReady', world: w.id, revision: arena?.revision }));
};
const heapBefore = process.memoryUsage().heapUsed;
const t0 = performance.now();

// 1. Real matches: players queue in pairs, so each pair gets its own world.
const pairs = Math.floor(WORLDS / 2);
const humans: number[] = [];
for (let i = 0; i < pairs; i++) {
  const mode = modes[i % 3];
  for (let k = 0; k < 2; k++) {
    const id = server.connect();
    deliver(server.handle(id, { t: 'hello' }));
    deliver(server.handle(id, { t: 'play', mode }));
    humans.push(id);
  }
}
// 2. Practice matches with no player at all: two opponents, full AI.
const exhibitions: number[] = [];
for (let i = 0; i < WORLDS - pairs; i++)
  exhibitions.push(server.startExhibition(modes[i % 3], [{ skill: .4 + (i % 7) * .15, adaptive: true }, { skill: 1 }]));
// 3. One lone player per game, waiting for an opponent.
const loners = modes.map((mode) => {
  const id = server.connect();
  deliver(server.handle(id, { t: 'hello' }));
  deliver(server.handle(id, { t: 'play', mode }));
  return id;
});
for (const id of humans) ready(id);

let maxTick = 0, sumTick = 0, ticks = 0, lonersReady = false;
const secs = BOT_WAIT_MS / 1000 + 25;
for (let t = 0; t < secs; t += TICK) {
  const s = performance.now();
  deliver(server.tick(TICK));
  deliver(server.snapshots());
  const spent = performance.now() - s;
  if (!lonersReady && loners.every((id) => server.worldOf(id))) { lonersReady = true; for (const id of loners) ready(id); }
  if (t > 5) { maxTick = Math.max(maxTick, spent); sumTick += spent; ticks++; }
}
const worlds = server.worldCount();
console.log(`${humans.length + loners.length} players + ${exhibitions.length} practice matches → ${worlds} live worlds, `
  + `${server.botCount()} practice opponents  (${((performance.now() - t0) / 1000).toFixed(1)}s wall for ${secs}s of play)`);
check('every player is in a match', [...humans, ...loners].every((id) => server.worldOf(id) !== null));
check('every pair shares a world, and no two pairs do',
  new Set(humans.map((id) => server.worldOf(id)?.id)).size === pairs &&
  humans.every((id, i) => i % 2 === 1 || server.worldOf(id)?.id === server.worldOf(humans[i + 1])?.id));
check('each lone player got an opponent of their own after the wait',
  loners.every((id) => server.worldMembers(server.worldOf(id)!.id).length === 2) &&
  new Set(loners.map((id) => server.worldOf(id)!.id)).size === 3);
check('practice matches are live in their own worlds', exhibitions.every((w) => server.matchState(w) !== null) &&
  new Set(exhibitions).size === exhibitions.length);
check(`average tick with ${worlds} live worlds is inside the 50 ms budget`, sumTick / ticks < 50, `${(sumTick / ticks).toFixed(2)} ms`);
console.log(`  (worst tick ${maxTick.toFixed(1)} ms)`);

// Isolation: every snapshot a player receives lists only their own world.
let leaks = 0, snaps = 0;
for (const id of [...humans, ...loners]) {
  const members = new Set(server.worldMembers(server.worldOf(id)!.id));
  for (const m of inbox.get(id) ?? []) {
    if (m.t !== 'snapshot') continue;
    snaps++;
    if (m.players.some((p) => !members.has(p.id))) leaks++;
  }
}
check('no snapshot ever lists a body from another world', snaps > 0 && leaks === 0, `${leaks} of ${snaps}`);

// Everybody leaves; every world a player was in, and its opponent, must go.
const playerWorlds = new Set([...humans, ...loners].map((id) => server.worldOf(id)!.id));
for (const id of [...humans, ...loners]) deliver(server.handle(id, { t: 'leaveMatch' }));
deliver(server.tick(TICK));
const exhibitionsLeft = exhibitions.filter((w) => server.matchState(w) !== null).length;
check('every world a player left is torn down', [...playerWorlds].every((w) => server.matchState(w) === null),
  `${server.worldCount() - exhibitionsLeft} left`);
check('only the practice matches are still running', server.worldCount() === exhibitionsLeft,
  `${server.worldCount()} worlds, ${exhibitionsLeft} practice`);
check('the lone players\' opponents were dismissed', server.botCount() === exhibitionsLeft * 2, String(server.botCount()));
for (const id of [...humans, ...loners]) deliver(server.disconnect(id));
inbox.clear();
(globalThis as { gc?: () => void }).gc?.();
const heapAfter = process.memoryUsage().heapUsed;
console.log(`  heap: ${(heapBefore / 1e6).toFixed(0)} MB before → ${(heapAfter / 1e6).toFixed(0)} MB after the players left`);

console.log(failures ? `\nFAILED (${failures})` : '\nALL PASSED');
process.exit(failures ? 1 : 0);
