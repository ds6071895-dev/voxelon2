// Seeded, mode-aware capacity/isolation probe; npm run stress, or
// STRESS_BEDWARS=1 STRESS_WORLDS=600 npm run stress.
// Tick timings include snapshots/delivery. STRESS_BUDGET_MS is the machine's
// average-tick budget (50 by default); peak and p95 are reported separately.
import { GameServer, BOT_WAIT_MS, type Outbound } from '../src/net/server_core';
import { Accounts } from '../src/net/accounts';
import { mulberry32 } from '../src/noise';
import { Block } from '../src/blocks';
import type { WorldBlocks } from '../src/multiverse';
import type { GameMode, ServerMsg } from '../src/net/protocol';

function numberOption(name: string, fallback: number, integer = true): number {
  const raw = process.env[name] ?? String(fallback), value = Number(raw);
  if (!raw.trim() || !Number.isFinite(value) || value <= 0 || (integer && !Number.isSafeInteger(value)))
    throw new Error(`${name} must be a positive ${integer ? 'integer' : 'number'}`);
  return value;
}
const WORLDS = numberOption('STRESS_WORLDS', 300);
const BUDGET = numberOption('STRESS_BUDGET_MS', 50, false);
const HUNT_TICKS = numberOption('STRESS_HUNT_TICKS', 100);
const TICK = .05;
const modes: GameMode[] = process.env.STRESS_BEDWARS === '1' ? ['bedwars'] : ['duels', 'bridge', 'parkour', 'bedwars', 'ratseek'];
if (WORLDS < modes.length) throw new Error(`STRESS_WORLDS must be at least ${modes.length} to include every selected mode`);
if (process.env.STRESS_BEDWARS !== undefined && !['0', '1'].includes(process.env.STRESS_BEDWARS)) throw new Error('STRESS_BEDWARS must be 0 or 1');
const rng = mulberry32(99);
const server = new GameServer({ accounts: new Accounts(), rng,
  token: () => Array.from({ length: 32 }, () => Math.floor(rng() * 16).toString(16)).join('') });
let failures = 0;
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};
// Narrow in-process access to existing production teardown and block overlays.
// No protocol command or alternate teardown implementation is introduced.
type ProbeWorld = { blocks: WorldBlocks; members: Set<number> };
const internals = server as unknown as { worlds: Map<number, ProbeWorld> };
const inbox = new Map<number, ServerMsg[]>();
let snapshots = 0, snapshotLeaks = 0;
const deliver = (out: Outbound[]) => {
  for (const o of out) {
    if (o.msg.t === 'snapshot') {
      snapshots++;
      const world = server.worldOf(o.to);
      const members = new Set(world ? server.worldMembers(world.id) : []);
      if (o.msg.players.some(p => !members.has(p.id))) snapshotLeaks++;
    }
    let box = inbox.get(o.to);
    if (!box) inbox.set(o.to, box = []);
    box.push(o.msg);
    if (box.length > 100) box.splice(0, box.length - 100);
  }
};
const ready = (id: number) => {
  const world = server.worldOf(id);
  const arena = [...(inbox.get(id) ?? [])].reverse().find(m => ['duelArena', 'pgArena', 'bwArena', 'rsArena'].includes(m.t));
  if (world) deliver(server.handle(id, { t: 'worldReady', world: world.id,
    revision: arena && 'revision' in arena ? arena.revision : undefined }));
};
const live = (world: number, mode: GameMode) => server.worldMembers(world).length > 0 && internals.worlds.has(world)
  && (mode === 'ratseek' ? server.ratSeek(world) !== null : server.matchState(world) !== null);
const gone = (world: number) => !internals.worlds.has(world) && !server.worldMembers(world).length
  && server.ratSeek(world) === null && server.matchState(world) === null;
const closeExhibition = (world: number) => {
  deliver(server.terminateExhibition(world));
};
const roster = (mode: GameMode) => mode === 'bedwars' || mode === 'ratseek' ? 4 : 2;
const exhibitionBots = (mode: GameMode) => roster(mode) + (mode === 'ratseek' ? 1 : 0);
const startExhibition = (mode: GameMode) => {
  const world = server.startExhibition(mode, Array.from({ length: roster(mode) }, (_, i) => ({ skill: .4 + i * .15, adaptive: true })));
  // Bot messages are intentionally rejected by GameServer.handle. The manor
  // exposes this existing narrow in-process readiness API for its rat bodies.
  const manor = server.ratSeek(world);
  for (const id of server.worldMembers(world)) {
    if (manor) manor.markLoaded(id); else ready(id);
  }
  return world;
};
// Warm each generator/navigation family before the heap comparison. These are
// terminally closed, so baseline memory contains shared caches, no live matches.
const warm = modes.map(mode => startExhibition(mode));
for (let i = 0; i < 720; i++) server.tick(TICK);
for (const world of warm) closeExhibition(world);
inbox.clear();
const gc = (globalThis as { gc?: () => void }).gc;
gc?.();
const heapWarm = process.memoryUsage().heapUsed;
const t0 = performance.now();

type Scenario = { mode: GameMode; ids: number[]; world: number; bots: number };
const groups: Scenario[] = [], exhibitions: Scenario[] = [], humans: number[] = [];
const realCount = Math.floor(WORLDS / 2);
for (let i = 0; i < realCount; i++) {
  const mode = modes[i % modes.length], ids: number[] = [];
  for (let j = 0; j < roster(mode); j++) {
    const id = server.connect();
    deliver(server.handle(id, { t: 'hello' }));
    deliver(server.handle(id, { t: 'play', mode }));
    ids.push(id); humans.push(id);
  }
  const world = server.worldOf(ids[0])?.id ?? -1;
  groups.push({ mode, ids, world, bots: mode === 'ratseek' ? 1 : 0 });
  for (const id of ids) ready(id);
}
for (let i = 0; i < WORLDS - realCount; i++) {
  const mode = modes[(i + realCount) % modes.length], world = startExhibition(mode);
  exhibitions.push({ mode, ids: server.worldMembers(world), world, bots: exhibitionBots(mode) });
}
const loners = modes.map(mode => {
  const id = server.connect();
  deliver(server.handle(id, { t: 'hello' }));
  deliver(server.handle(id, { t: 'play', mode }));
  humans.push(id);
  return { mode, ids: [id], world: -1, bots: mode === 'bedwars' ? 3 : 1 };
});
// Main manor cohort excludes late-filled loners. Each must contribute a minimum
// number of real hunting ticks; results/idle ticks cannot count toward this.
const manors = [...groups, ...exhibitions].filter(s => s.mode === 'ratseek');
const hunts = new Map(manors.map(s => [s.world, 0]));
const initial = [...groups, ...exhibitions];
check('mode-aware groups start in distinct worlds with complete rosters', new Set(initial.map(s => s.world)).size === initial.length
  && initial.every(s => live(s.world, s.mode) && s.ids.every(id => server.worldOf(id)?.id === s.world)
    && server.worldMembers(s.world).length === (exhibitions.includes(s) ? s.bots : s.ids.length + s.bots)));
const naturalResults = new Set<number>();
const timings: number[] = [], huntingTimings: number[] = [];
const seconds = BOT_WAIT_MS / 1000 + 35 + HUNT_TICKS * TICK;
for (let step = 0; step < Math.ceil(seconds / TICK); step++) {
  const hunting = manors.filter(s => server.ratSeek(s.world)?.phase === 'hunting');
  const start = performance.now();
  deliver(server.tick(TICK));
  deliver(server.snapshots());
  const elapsed = performance.now() - start;
  for (const scenario of [...initial, ...loners]) {
    const phase = scenario.mode === 'ratseek' ? server.ratSeek(scenario.world)?.phase : server.matchState(scenario.world)?.phase;
    if (phase === 'results') naturalResults.add(scenario.world);
  }
  for (const scenario of loners) if (scenario.world < 0) {
    const world = server.worldOf(scenario.ids[0]);
    if (world) { scenario.world = world.id; ready(scenario.ids[0]); }
  }
  if (step * TICK > 5) timings.push(elapsed);
  if (hunting.length) {
    huntingTimings.push(elapsed);
    for (const scenario of hunting) hunts.set(scenario.world, (hunts.get(scenario.world) ?? 0) + 1);
  }
}
const all = [...groups, ...exhibitions, ...loners];
console.log(`${humans.length} humans, ${exhibitions.length} exhibitions → ${server.worldCount()} worlds, ${server.botCount()} bots (${((performance.now() - t0) / 1000).toFixed(1)}s wall for ${seconds}s simulated)`);
check('scenarios stay live or reach observed results followed by production teardown', new Set(all.map(s => s.world)).size === all.length
  && all.every(s => live(s.world, s.mode) || (naturalResults.has(s.world) && gone(s.world))), `${naturalResults.size} naturally completed scenarios`);
check('late queue fill uses each mode\'s opponent count', loners.every(s => s.world >= 0 && server.worldMembers(s.world).length === s.bots + 1));
check('live bot counts match scenario rosters', server.botCount() === all.filter(s => live(s.world, s.mode)).reduce((n, s) => n + s.bots, 0));
const report = (name: string, samples: number[]) => {
  const sorted = [...samples].sort((a, b) => a - b);
  const avg = samples.reduce((a, b) => a + b, 0) / samples.length;
  check(`${name}: average within ${BUDGET} ms machine budget`, samples.length > 0 && avg < BUDGET,
    `${avg.toFixed(2)} ms avg, ${(sorted[Math.floor(sorted.length * .95)] ?? NaN).toFixed(2)} ms p95, ${(sorted.at(-1) ?? NaN).toFixed(2)} ms peak, ${samples.length} ticks`);
};
report('post-setup workload', timings);
if (manors.length) {
  check(`every manor in the ${manors.length}-world cohort supplies ${HUNT_TICKS} hunting ticks`, [...hunts.values()].every(n => n >= HUNT_TICKS), `minimum ${Math.min(...hunts.values())}; loading/intro/hiding/results excluded`);
  report('active manor hunting interval (whole server tick)', huntingTimings);
}
check('delivered snapshots contain only bodies in the recipient\'s world', snapshots > 0 && snapshotLeaks === 0, `${snapshotLeaks} leaks / ${snapshots} snapshots`);
// Exercise actual overlays at a shared local cell, outside the playable venues.
const blocks = [...internals.worlds.values()].map(w => w.blocks);
const authored = blocks.map(b => b.getBlock(1700, 300, 1700));
let isolated = blocks.length > 1;
for (let i = 0; i < blocks.length; i++) {
  const block = authored[i] === Block.Stone ? Block.Air : Block.Stone;
  blocks[i].set(1700, 300, 1700, block);
  isolated &&= blocks[i].getBlock(1700, 300, 1700) === block && blocks.every((b, j) => j === i || b.getBlock(1700, 300, 1700) === authored[j]);
  blocks[i].restore(1700, 300, 1700);
}
check('live edits/block reads stay world-local', isolated);
blocks.length = 0;

const playerWorlds = [...groups, ...loners].map(s => s.world);
for (const id of humans) deliver(server.handle(id, { t: 'leaveMatch' }));
deliver(server.tick(TICK));
check('last-human departure terminally removes each human world', playerWorlds.every(gone));
const retained = exhibitions.filter(s => live(s.world, s.mode));
check('only intentionally retained exhibitions remain', server.worldCount() === retained.length && exhibitions.every(s => live(s.world, s.mode) || naturalResults.has(s.world)));
check('human-world bots are dismissed', server.botCount() === retained.reduce((n, s) => n + s.bots, 0));
for (const id of humans) deliver(server.disconnect(id));
for (const scenario of exhibitions) closeExhibition(scenario.world);
check('production terminal teardown removes all worlds, members and bots', all.every(s => gone(s.world)) && server.worldCount() === 0 && server.botCount() === 0 && server.playerCount() === 0);
inbox.clear();
gc?.();
const heapTerminal = process.memoryUsage().heapUsed;
console.log(`  ${gc ? 'Controlled-GC' : 'Uncollected informational'} heap: warmed caches/no matches ${(heapWarm / 1e6).toFixed(1)} MB → terminal/no matches ${(heapTerminal / 1e6).toFixed(1)} MB (delta ${((heapTerminal - heapWarm) / 1e6).toFixed(1)} MB). Shared generator/navigation caches are retained; heap size alone is not a reclamation gate.`);
console.log(failures ? `\nFAILED (${failures})` : '\nALL PASSED');
process.exitCode = failures ? 1 : 0;
