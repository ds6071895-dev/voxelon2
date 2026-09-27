// Bridge fight ledger between two bots: who wins each fight, with how much
// health left, hits, crits and arrows landed.   SKILLS=1.35,1.0 SEED=7 (VERBOSE=1)
import { GameServer, type PgBot } from '../src/net/server_core';
import { Accounts } from '../src/net/accounts';
import { mulberry32 } from '../src/noise';
import { PartyBot } from '../src/party_bot';
const skills = (process.env.SKILLS ?? '1.35,1.0').split(',').map(Number);
const server = new GameServer({ accounts: new Accounts(), rng: mulberry32(Number(process.env.SEED ?? 7)) });
const w = server.startExhibition('bridge', skills.map((skill) => ({ skill })), (_i, opp, spawn, rng, skill): PgBot => new PartyBot(opp, spawn, rng, skill));
const ids = server.worldMembers(w);
const hits = new Map<number, { n: number; crit: number; dmg: number; ranged: number }>();
const proto = Object.getPrototypeOf(server) as { landPartyHit: (...a: unknown[]) => unknown };
const orig = proto.landPartyHit;
const shootOrig = (proto as unknown as { handlePartyShoot: (...a: unknown[]) => unknown[] }).handlePartyShoot;
const fired = new Map<number, number>();
(proto as unknown as { handlePartyShoot: (...a: unknown[]) => unknown[] }).handlePartyShoot = function (this: unknown, ...a: unknown[]) {
  const r = shootOrig.apply(this, a); if (r.length) fired.set((a[0] as { id: number }).id, (fired.get((a[0] as { id: number }).id) ?? 0) + 1); return r;
};
proto.landPartyHit = function (this: unknown, ...a: unknown[]) {
  const attacker = a[1] as { id: number }, hit = a[4] as { damage: number; crit: boolean; ranged: boolean };
  const h = hits.get(attacker.id) ?? { n: 0, crit: 0, dmg: 0, ranged: 0 };
  h.n++; h.dmg += hit.damage; if (hit.crit) h.crit++; if (hit.ranged) h.ranged++;
  hits.set(attacker.id, h);
  return orig.apply(this, a);
};
let last = [0, 0], lastScore = [0, 0];
const kills = [0, 0], voids = [0, 0], hpAtKill: number[][] = [[], []];
for (let t = 0; t < 300; t += 0.05) {
  const before = ids.map((id) => ({ ...server.positionOf(id)!, hp: server.healthOf(id)! }));
  server.tick(0.05);
  const st = server.matchState(w);
  if (!st || st.phase === 'results') break;
  const k = ids.map((id) => st.participants.find((p) => p.id === id)!.kills);
  const sc = ids.map((id) => st.participants.find((p) => p.id === id)!.score);
  for (let i = 0; i < 2; i++) {
    if (k[i] > last[i]) {
      kills[i]++; hpAtKill[i].push(before[i].hp);
      if (before[1 - i].y < 139) voids[i]++;
      if (process.env.VERBOSE) console.log(`t=${t.toFixed(1)} ${'AB'[i]} kills at z=${before[1 - i].z.toFixed(1)} y=${before[1 - i].y.toFixed(1)} hp left ${before[i].hp}`);
    }
    if (sc[i] > lastScore[i]) console.log(`t=${t.toFixed(1)} ${'AB'[i]} SCORES`);
  }
  last = k; lastScore = sc;
}
const avg = (a: number[]) => a.length ? (a.reduce((x, y) => x + y, 0) / a.length).toFixed(1) : '-';
console.log(`skills ${skills.join(' vs ')}: kills A ${kills[0]} (void ${voids[0]}, avg hp left ${avg(hpAtKill[0])}) · B ${kills[1]} (void ${voids[1]}, avg hp left ${avg(hpAtKill[1])})`);
for (const [i, id] of ids.entries()) { const h = hits.get(id); if (h) console.log(`  ${'AB'[i]} hits ${h.n} crit ${h.crit} arrows ${h.ranged}/${fired.get(id) ?? 0} avg dmg ${(h.dmg / h.n).toFixed(2)}`); }
