// Practice-opponent simulation: runs whole matches between bots on the real
// server core (same physics, same validation, same course hazards) and
// reports how the reworked bots compare with VOXELON's originals, and whether
// the adaptive bot can hold its own against a player far better than the old
// bot ever was.
//
//   npm run bot-sim            (quick: a few matches per row)
//   SIM_MATCHES=12 npm run bot-sim
//
// "Stand-in players" are bots held at a FIXED level: 1.0 is a strong regular,
// 1.2 a very strong player. They are the closest a headless test gets to a
// person who, in the words of the brief, the old bots "literally never" beat.

import { GameServer, type PgBot } from '../src/net/server_core';
import { Accounts } from '../src/net/accounts';
import { PartyBot } from '../src/party_bot';
import { LegacyPartyBot } from './legacy_party_bot';
import { mulberry32 } from '../src/noise';
import type { GameMode } from '../src/net/protocol';

const MATCHES = Number(process.env.SIM_MATCHES ?? 6);
const TICK = 0.05;

type Kind = 'new' | 'legacy';
interface Side { kind: Kind; skill: number; adaptive?: boolean }
interface Outcome { winner: number | null; secs: number; scores: number[]; progress: number[]; finalSkills: number[]; ratings: number[] }

function play(mode: GameMode, sides: Side[], seed: number): Outcome {
  const tokenRng = mulberry32(seed ^ 0x5eed);
  const server = new GameServer({ accounts: new Accounts(), rng: mulberry32(seed),
    token: () => Array.from({ length: 48 }, () => Math.floor(tokenRng() * 16).toString(16)).join('') });
  const world = server.startExhibition(mode, sides.map((s) => ({ skill: s.skill, adaptive: s.adaptive })),
    (index, opponent, spawn, rng, skill): PgBot => sides[index].kind === 'legacy'
      ? new LegacyPartyBot(opponent, spawn, rng, Math.min(1, skill)) as unknown as PgBot
      : new PartyBot(opponent, spawn, rng, skill));
  const ids = server.worldMembers(world);
  let t = 0, finalSkills: number[] = [], ratings: number[] = [];
  for (; t < 540; t += TICK) {
    server.tick(TICK);
    const st = server.matchState(world);
    if (!st) break;
    if (st.phase === 'running') { finalSkills = server.botSkills(world); ratings = server.botRatings(world); }
    if (st.phase === 'results') {
      const order = ids.map((id) => st.participants.find((p) => p.id === id)!);
      const winnerIndex = mode === 'bridge'
        ? (st.winnerTeam === null ? null : order.findIndex((p) => p.team === st.winnerTeam))
        : (st.winner === null ? null : ids.indexOf(st.winner));
      return { winner: winnerIndex, secs: t, scores: order.map((p) => p.score), progress: order.map((p) => p.progress), finalSkills, ratings };
    }
  }
  return { winner: null, secs: t, scores: [], progress: [], finalSkills, ratings };
}

function row(label: string, mode: GameMode, a: Side, b: Side): { winsA: number; winsB: number; draws: number } {
  let winsA = 0, winsB = 0, draws = 0, secs = 0;
  const detail: string[] = [];
  const t0 = performance.now();
  for (let i = 0; i < MATCHES; i++) {
    // Alternate which side is listed first, so start position never decides it.
    const flip = i % 2 === 1;
    const out = play(mode, flip ? [b, a] : [a, b], 1000 + i * 7919);
    const winner = out.winner === null ? null : flip ? 1 - out.winner : out.winner;
    if (winner === 0) winsA++; else if (winner === 1) winsB++; else draws++;
    secs += out.secs;
    const skillA = out.finalSkills[flip ? 1 : 0];
    detail.push(`${winner === 0 ? 'A' : winner === 1 ? 'B' : '='}${mode === 'bridge' ? `${out.scores[flip ? 1 : 0]}-${out.scores[flip ? 0 : 1]}` : ''}${a.adaptive && Number.isFinite(skillA) ? `@${skillA.toFixed(2)}` : ''}`);
  }
  const ms = performance.now() - t0;
  console.log(`${label.padEnd(58)} A ${String(winsA).padStart(2)} · B ${String(winsB).padStart(2)} · = ${draws}   `
    + `avg ${(secs / MATCHES).toFixed(0)}s   [${detail.join(' ')}]   (${(ms / 1000).toFixed(1)}s cpu)`);
  return { winsA, winsB, draws };
}

console.log(`Practice-opponent simulation — ${MATCHES} matches per row\n`);
/** Dragon Chase is not a race: how often do runners of a level make it? */
function chase(label: string, skill: number): { made: number; runs: number } {
  let made = 0, runs = 0, secs = 0;
  const detail: string[] = [];
  const t0 = performance.now();
  for (let i = 0; i < MATCHES; i++) {
    const seed = 1000 + i * 7919, tokenRng = mulberry32(seed ^ 0x5eed);
    const server = new GameServer({ accounts: new Accounts(), rng: mulberry32(seed),
      token: () => Array.from({ length: 48 }, () => Math.floor(tokenRng() * 16).toString(16)).join('') });
    const world = server.startExhibition('parkour', [{ skill }, { skill }]);
    for (let t = 0; t < 900; t += TICK) {
      server.tick(TICK);
      const st = server.matchState(world);
      if (!st) break;
      if (st.phase !== 'results') continue;
      for (const r of st.runners ?? []) { runs++; if (r.made) made++; }
      detail.push((st.runners ?? []).map((r) => r.made ? `✓${Math.round((r.timeMs ?? 0) / 1000)}s` : `✕${r.reached}`).join('/'));
      secs += t;
      break;
    }
  }
  console.log(`${label.padEnd(58)} made it ${String(made).padStart(2)}/${runs}   avg ${(secs / MATCHES).toFixed(0)}s   [${detail.join(' ')}]   (${((performance.now() - t0) / 1000).toFixed(1)}s cpu)`);
  return { made, runs };
}

console.log('DRAGON CHASE (everyone who reaches the end makes it)');
const pkCasual = chase('casual runners (0.45)', .45);
chase('improving runners (0.65)', .65);
const pkRegular = chase('regular runners (0.8)', .8);
const pkStrong = chase('strong runners (1.0)', 1);
chase('very strong runners (1.2)', 1.2);
console.log('\nTHE BRIDGE (first to 5 goals)');
const brTop = row('new bot at the top of its range  vs  old bot at its best', 'bridge', { kind: 'new', skill: 1.35 }, { kind: 'legacy', skill: 1 });
row('new bot at 1.0  vs  old bot at its best', 'bridge', { kind: 'new', skill: 1 }, { kind: 'legacy', skill: 1 });
const brAdaptStrong = row('ADAPTIVE new bot  vs  very strong player (fixed 1.2)', 'bridge', { kind: 'new', skill: .55, adaptive: true }, { kind: 'new', skill: 1.2 });
const brAdaptWeak = row('ADAPTIVE new bot  vs  casual player (fixed 0.45)', 'bridge', { kind: 'new', skill: .55, adaptive: true }, { kind: 'new', skill: .45 });
row('old bot (its own adaptation)  vs  very strong player (fixed 1.2)', 'bridge', { kind: 'legacy', skill: .5, adaptive: true }, { kind: 'new', skill: 1.2 });

/** One player's run of matches against the SAME practice opponent: the server
 *  remembers the level each match ended at and starts the next one there. */
function series(label: string, mode: GameMode, player: number): { winsA: number; winsB: number; draws: number } {
  let winsA = 0, winsB = 0, draws = 0, level = .55;
  const detail: string[] = [];
  for (let i = 0; i < MATCHES; i++) {
    const flip = i % 2 === 1;
    const a: Side = { kind: 'new', skill: level, adaptive: true }, b: Side = { kind: 'new', skill: player };
    const out = play(mode, flip ? [b, a] : [a, b], 5000 + i * 104729);
    const winner = out.winner === null ? null : flip ? 1 - out.winner : out.winner;
    if (winner === 0) winsA++; else if (winner === 1) winsB++; else draws++;
    const next = out.ratings[flip ? 1 : 0];
    detail.push(`${winner === 0 ? 'A' : winner === 1 ? 'B' : '='}${mode === 'bridge' ? `${out.scores[flip ? 1 : 0]}-${out.scores[flip ? 0 : 1]}` : ''}@${level.toFixed(2)}`);
    if (Number.isFinite(next)) level = next;
  }
  console.log(`${label.padEnd(58)} A ${String(winsA).padStart(2)} · B ${String(winsB).padStart(2)} · = ${draws}   [${detail.join(' ')}]  (@ = level the match started at)`);
  return { winsA, winsB, draws };
}

console.log('\nRETURNING PLAYER (the learned level carries into the next match)');
const brSeries = series('bridge:  adaptive bot  vs  very strong player (fixed 1.2)', 'bridge', 1.2);

const share = (r: { winsA: number; winsB: number; draws: number }) => r.winsA / Math.max(1, r.winsA + r.winsB + r.draws);
console.log('\nSummary');
const rate = (r: { made: number; runs: number }) => `${(r.made / Math.max(1, r.runs) * 100).toFixed(0)}%`;
console.log(`  dragon chase made it: casual ${rate(pkCasual)}, regular ${rate(pkRegular)}, strong ${rate(pkStrong)}`);
console.log(`  top new bot beats the old bot's best: bridge ${(share(brTop) * 100).toFixed(0)}%`);
console.log(`  adaptive bot wins vs a very strong player: bridge ${(share(brAdaptStrong) * 100).toFixed(0)}%`);
console.log(`  returning very strong player, bot wins:    bridge ${(share(brSeries) * 100).toFixed(0)}%`);
console.log(`  adaptive bot wins vs a casual player:      bridge ${(share(brAdaptWeak) * 100).toFixed(0)}%`);
