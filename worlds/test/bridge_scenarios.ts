// Bridge bot scenarios: the situations a real player puts a practice opponent
// in, played against a scripted "human" that follows a fixed route and never
// fights back. Each prints whether the bot coped.
//
//   npx esbuild test/bridge_scenarios.ts --bundle --platform=node --format=cjs --outfile=node_modules/.tmp/bs.cjs && node node_modules/.tmp/bs.cjs
//   SKILL=0.55 ONLY=over VERBOSE=1
import { GameServer, type PgBot } from '../src/net/server_core';
import { Accounts } from '../src/net/accounts';
import { mulberry32 } from '../src/noise';
import { PartyBot } from '../src/party_bot';
import { Player } from '../src/player';
import { Block } from '../src/blocks';
import { FROZEN_INPUT, type PlayerInput } from '../src/input';
import { PARTY_FLOOR_Y as F, BRIDGE_LANE_X } from '../src/partygames';
import type { WorldBlocks } from '../src/multiverse';

type Vec = { x: number; y: number; z: number };

/** Walks a route with real physics; does nothing else. */
class Scripted implements PgBot {
  readonly body: Player;
  readonly pitch = 0;
  readonly rating = 0;
  skill = 0;
  fixedSkill = true;
  route: Vec[] = [];
  private leg = 0;
  constructor(readonly opponent: number, spawn: Vec) {
    this.body = new Player(spawn);
    this.body.energyDrainMult = 0;
    this.body.damageSink = () => {};
  }
  reset(spawn: Vec): void { this.body.pos.set(spawn.x, spawn.y, spawn.z); this.body.vel.set(0, 0, 0); this.leg = 0; }
  noteHurt(): void {}
  step(...args: Parameters<PartyBot['step']>): ReturnType<PartyBot['step']> {
    const [dt, , , , , , world] = args;
    const p = this.body;
    // Start the route from wherever the respawn put us.
    while (this.leg < this.route.length && Math.hypot(this.route[this.leg].x - p.pos.x, this.route[this.leg].z - p.pos.z) < .35) this.leg++;
    const t = this.route[this.leg];
    let input: PlayerInput = { ...FROZEN_INPUT };
    if (t) {
      p.yaw = Math.atan2(-(t.x - p.pos.x), -(t.z - p.pos.z));
      input = { ...FROZEN_INPUT, forward: true, sprintKey: true, sprintHeld: true, jump: t.y > p.pos.y + .3 && p.onGround };
    }
    const steps = Math.max(1, Math.ceil(dt * 120));
    for (let i = 0; i < steps; i++) p.update(dt / steps, input, world);
    return {};
  }
}

interface Scenario {
  name: string;
  seconds: number;
  /** Blocks placed before the round starts (venue-local x/z, absolute y). */
  build?: (set: (x: number, y: number, z: number) => void) => void;
  /** Route for the scripted player, venue-local. */
  route?: Vec[];
  /** Pass/fail from what happened. */
  judge: (r: { botZ: number; humanScored: boolean; botScored: boolean; hitsOnHuman: number; humanKilled: number; botMaxZ: number }) => string | null;
}

const lane = BRIDGE_LANE_X;
const wool = (set: (x: number, y: number, z: number) => void, x: number, y0: number, y1: number, z: number) => {
  for (let y = y0; y <= y1; y++) set(x, y, z);
};

const SCENARIOS: Scenario[] = [
  {
    name: 'wall1', seconds: 12,
    build: (set) => wool(set, lane, F + 1, F + 1, 30),
    judge: (r) => r.botMaxZ > 33 ? null : `stuck behind a 1-high block (max z ${r.botMaxZ.toFixed(1)})`,
  },
  {
    name: 'steps', seconds: 14,
    // A little staircase up and a drop back down.
    build: (set) => { wool(set, lane, F + 1, F + 1, 28); wool(set, lane, F + 1, F + 2, 29); wool(set, lane, F + 1, F + 1, 30); },
    judge: (r) => r.botMaxZ > 33 ? null : `stuck on steps (max z ${r.botMaxZ.toFixed(1)})`,
  },
  {
    name: 'wall2', seconds: 14,
    build: (set) => wool(set, lane, F + 1, F + 2, 30),
    judge: (r) => r.botMaxZ > 33 ? null : `stuck behind a 2-high wall (max z ${r.botMaxZ.toFixed(1)})`,
  },
  {
    name: 'wall4', seconds: 16,
    build: (set) => { for (let z = 30; z <= 31; z++) wool(set, lane, F + 1, F + 4, z); },
    judge: (r) => r.botMaxZ > 34 ? null : `stuck behind a thick 4-high wall (max z ${r.botMaxZ.toFixed(1)})`,
  },
  {
    name: 'box', seconds: 14,
    // Wool ceiling right over the span and a wall: dig through.
    build: (set) => { for (let z = 26; z <= 34; z++) set(lane, F + 3, z); wool(set, lane, F + 1, F + 2, 34); },
    judge: (r) => r.botMaxZ > 37 ? null : `stuck in a tunnel (max z ${r.botMaxZ.toFixed(1)})`,
  },
  {
    name: 'flank', seconds: 30,
    // A parallel bridge two blocks off the span, joined to both sally ports.
    build: (set) => {
      for (let z = 19; z <= 60; z++) set(lane - 2, F, z);
      set(lane - 1, F, 19); set(lane - 1, F, 60);
    },
    route: [
      { x: lane + .5, y: F + 1, z: 62 }, { x: lane + .5, y: F + 1, z: 60.5 }, { x: lane - 1.5, y: F + 1, z: 59.5 },
      { x: lane - 1.5, y: F + 1, z: 19.5 }, { x: lane + .5, y: F + 1, z: 19.2 }, { x: lane + .5, y: F + 1, z: 7.5 },
    ],
    judge: (r) => !r.humanScored ? null : `let the player walk past into its portal (${r.hitsOnHuman} hits landed)`,
  },
  {
    name: 'over', seconds: 30,
    // A skybridge four blocks over the span, down a stair into the base.
    build: (set) => {
      for (let z = 20; z <= 60; z++) set(lane, F + 4, z);
      for (let z = 60; z <= 62; z++) set(lane, F + 1, z);
      set(lane, F + 2, 59); set(lane, F + 3, 58); set(lane, F + 4, 57);
      set(lane, F + 3, 19); set(lane, F + 2, 18); set(lane, F + 1, 17);
    },
    route: [
      { x: lane + .5, y: F + 1, z: 62.5 }, { x: lane + .5, y: F + 5, z: 57.5 }, { x: lane + .5, y: F + 5, z: 20.5 },
      { x: lane + .5, y: F + 2, z: 17.5 }, { x: lane + .5, y: F + 1, z: 7.5 },
    ],
    judge: (r) => !r.humanScored ? null : `let the player cross overhead into its portal (${r.hitsOnHuman} hits landed)`,
  },
  {
    name: 'rush', seconds: 25,
    // The player just sprints the span for the bot's portal.
    route: [{ x: lane + .5, y: F + 1, z: 62 }, { x: lane + .5, y: F + 1, z: 7.5 }],
    judge: (r) => !r.humanScored ? null : `let the player run straight past (${r.hitsOnHuman} hits landed)`,
  },
];

const skill = Number(process.env.SKILL ?? 0.55);
let failures = 0;
for (const sc of SCENARIOS) {
  if (process.env.ONLY && !process.env.ONLY.split(',').includes(sc.name)) continue;
  const server = new GameServer({ accounts: new Accounts(), rng: mulberry32(Number(process.env.SEED ?? 3)) });
  let scripted: Scripted | null = null;
  const w = server.startExhibition('bridge', [{ skill }, { skill }], (i, opp, spawn, rng, s): PgBot => {
    if (i === 1) return (scripted = new Scripted(opp, spawn));
    return new PartyBot(opp, spawn, rng, s);
  });
  const ids = server.worldMembers(w);
  const world = (server as unknown as { worlds: Map<number, { blocks: WorldBlocks; spec: unknown }> }).worlds.get(w)!;
  const st0 = server.matchState(w)!;
  const botId = ids[0], humanId = ids[1];
  const botTeam = st0.participants.find((p) => p.id === botId)!.team;
  // Venue-local z runs from the bot's base toward the player's: mirror if the
  // bot is on the far side.
  const flip = botTeam === 1;
  const lz = (z: number) => flip ? 79 - z : z;
  const minX = Math.min(...[botId, humanId].map((id) => Math.floor(server.positionOf(id)!.x))) - lane;
  const minZ = 0;
  sc.build?.((x, y, z) => world.blocks.set(minX + x, y, minZ + lz(z), Block.TeamWoolB));
  scripted!.route = (sc.route ?? []).map((v) => ({ x: minX + v.x, y: v.y, z: minZ + lz(v.z) + (flip ? 1 : 0) }));
  const proto = Object.getPrototypeOf(server) as { landPartyHit: (...a: unknown[]) => unknown };
  const orig = proto.landPartyHit;
  let hitsOnHuman = 0;
  proto.landPartyHit = function (this: unknown, ...a: unknown[]) {
    if ((a[2] as { id: number }).id === humanId) hitsOnHuman++;
    return orig.apply(this, a);
  };
  let botMaxZ = 0, humanScored = false, botScored = false, humanKilled = 0, started = -1;
  for (let t = 0; t < 60; t += 0.05) {
    server.tick(0.05);
    const st = server.matchState(w);
    if (!st || st.phase === 'results') break;
    if (st.phase !== 'running') continue;
    if (started < 0) started = t;
    if (t - started > sc.seconds) break;
    const b = server.positionOf(botId)!;
    botMaxZ = Math.max(botMaxZ, lz(b.z - minZ));
    const me = st.participants.find((p) => p.id === botId)!, them = st.participants.find((p) => p.id === humanId)!;
    if (them.score > 0) humanScored = true;
    if (me.score > 0) botScored = true;
    humanKilled = me.kills;
    if (process.env.VERBOSE && Math.round(t * 20) % 10 === 0) {
      const h = server.positionOf(humanId)!;
      console.log(`  t=${(t - started).toFixed(1)} bot (${(b.x - minX).toFixed(1)}, ${(b.y - F).toFixed(1)}, ${lz(b.z - minZ).toFixed(1)}) human (${(h.x - minX).toFixed(1)}, ${(h.y - F).toFixed(1)}, ${lz(h.z - minZ).toFixed(1)}) hits ${hitsOnHuman}`);
    }
    if (humanScored || botScored) break;
  }
  proto.landPartyHit = orig;
  const r = { botZ: 0, humanScored, botScored, hitsOnHuman, humanKilled, botMaxZ };
  const why = sc.judge(r);
  if (why) failures++;
  console.log(`${why ? '✗' : '✓'} ${sc.name.padEnd(6)} ${why ?? `ok (max z ${botMaxZ.toFixed(1)}, hits ${hitsOnHuman}, kills ${humanKilled}${botScored ? ', scored' : ''})`}`);
}
if (failures) process.exitCode = 1;
