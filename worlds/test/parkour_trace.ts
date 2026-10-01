// Dragon Chase life tracer: runs the new bot (1.35) and the old one on one
// course and prints every life the new bot loses (a fall, the dragon's jaws or
// its fire) with the pads involved and the last seconds of the bot's path.   SEED=255 npx esbuild test/parkour_trace.ts --bundle
// --platform=node --outfile=node_modules/.tmp/trace.cjs && node node_modules/.tmp/trace.cjs
import { GameServer, type PgBot } from '../src/net/server_core';
import { Accounts } from '../src/net/accounts';
import { mulberry32 } from '../src/noise';
import { PartyBot } from '../src/party_bot';
import { LegacyPartyBot } from './legacy_party_bot';
import { parkourCourse } from '../src/partygames';
const seed = Number(process.env.SEED ?? 55);
const tokenRng = mulberry32(seed ^ 0x5eed);
const server = new GameServer({ accounts: new Accounts(), rng: mulberry32(seed),
  token: () => Array.from({ length: 48 }, () => Math.floor(tokenRng() * 16).toString(16)).join('') });
const w = server.startExhibition('parkour', [{ skill: 1.35 }, { skill: 0.15 }], (k, opp, spawn, rng, s): PgBot =>
  k === 0 ? new PartyBot(opp, spawn, rng, s) : new LegacyPartyBot(opp, spawn, rng, 0.15) as unknown as PgBot);
const ids = server.worldMembers(w);
const course = parkourCourse(server.worldOf(ids[0])!.seed);
console.log('course', course.sections.map((s) => `${s.title} [${s.fromOrder}-${s.toOrder}]`).join(' · '));
let lastFalls = 0, lastProg = 0;
const trail: string[] = [];
for (let t = 0; t < 400; t += 0.05) {
  server.tick(0.05);
  const st = server.matchState(w)!;
  const me = st.participants.find((p) => p.id === ids[0])!;
  const pos = server.positionOf(ids[0])!;
  trail.push(`${t.toFixed(2)} p${me.progress} ${pos.x.toFixed(2)},${pos.y.toFixed(2)},${pos.z.toFixed(2)}`);
  if (trail.length > 60) trail.shift();
  if (me.progress !== lastProg) lastProg = me.progress;
  if (me.falls > lastFalls) {
    lastFalls = me.falls;
    const a = course.steps[me.progress]?.[0];
    console.log(`LIFE LOST #${me.falls} at t=${t.toFixed(1)} progress ${me.progress} · dragon at ${st.dragon?.toFixed(1)}`);
    const prevOrder = trail.map((s) => Number(s.split(' p')[1].split(' ')[0]));
    const from = Math.max(...prevOrder);
    for (const pad of course.steps[from] ?? []) console.log(`  from pad order ${from}: kind=${pad.kind} at ${pad.x},${pad.y},${pad.z} ${pad.width}x${pad.depth} heading ${pad.heading}`);
    for (const pad of course.steps[from + 1] ?? []) console.log(`  to   pad order ${from + 1}: kind=${pad.kind} at ${pad.x},${pad.y},${pad.z} ${pad.width}x${pad.depth} from ${pad.from}`);
    console.log(trail.slice(-45).join('\n'));
    void a;
  }
  if (st.phase === 'results') {
    console.log('result', JSON.stringify(st.runners));
    break;
  }
}
