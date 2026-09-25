import { strict as assert } from 'node:assert';
import { GameServer } from '../src/net/server_core';
import { PARTY_COUNTDOWN_MS, PARTY_RESULT_MS, parkourCourse, type PartyMode } from '../src/partygames';
import { Item } from '../src/items';
import { Block } from '../src/blocks';
import { PartyBot } from '../src/party_bot';
let randomState = 17;
const random = () => ((randomState = Math.imul(randomState, 1664525) + 1013904223 >>> 0) / 4294967296);
const make = () => { const s = new GameServer(42, random); (s.party as any).tokenFactory = () => 'fixed-course'; s.addPlayer(1, { username: 'Human', faction: 0 }); return s; };
function advance(s: GameServer, seconds: number) { s.tickWar(seconds); return s.tickParty(); }
function queued(mode: PartyMode) { const s = make(); s.handle(1, { t: 'partyQueue', join: true, mode }); return s; }
function launch(mode: PartyMode) {
  const s = queued(mode);
  advance(s, 19.999);
  assert.equal(s.party.phaseFor(1), null, 'no early bot');
  const out = advance(s, .00101);
  const snap = s.party.snapshotFor(1, 20_000)!;
  assert.equal(snap.phase, 'countdown');
  assert.equal(snap.participants.length, 2);
  const bot = snap.participants.find(p => p.bot)!;
  assert.ok(bot?.username.includes('[Bot]'));
  assert.ok(out.some(o => o.to === 1 && o.msg.t === 'join' && o.msg.player.id === bot.id), 'bot avatar announced');
  assert.equal(s.playerCount, 1);
  assert.equal(s.activePlayerCounts()[mode], 1, 'bots excluded from population');
  s.handle(1, { t: 'partyArenaReady', revision: snap.revision });
  advance(s, PARTY_COUNTDOWN_MS / 1000 + .01);
  assert.equal(s.party.phaseFor(1), 'running', 'bot passes loading barrier');
  return { s, botId: bot.id };
}
for (const mode of ['bridge', 'parkour'] as const) {
  const { s, botId } = launch(mode);
  const initial = s.snapshot().find(p => p.id === botId)!;
  for (let i = 0; i < 200; i++) advance(s, .05);
  const moved = s.snapshot().find(p => p.id === botId)!;
  assert.ok(Math.hypot(moved.x - initial.x, moved.y - initial.y, moved.z - initial.z) > 1, `${mode} moves`);
  if (mode === 'parkour') {
    for (let i = 0; i < 400; i++) advance(s, .05);
    const bot = s.party.participantFor(botId)!;
    assert.ok(parkourCourse(s.party.subFor(1)!.seed).platforms.some(p => p.kind === 'blink'), 'fixture exercises moving platforms');
    assert.ok(bot.score >= 3, 'bot makes meaningful parkour progress');
  }
  s.handle(1, { t: 'partyLeave' });
  assert.equal(s.party.phaseFor(botId), null, 'bot leaves engine');
  assert.ok(!s.snapshot().some(p => p.id === botId), 'bot body removed');
  assert.equal(s.party.snapshots(100_000).length, 0, 'no leaked lobby');
}
{
  const s = queued('bridge'); advance(s, 19);
  s.addPlayer(2, { username: 'RealOpponent', faction: 0 });
  s.handle(2, { t: 'partyQueue', join: true, mode: 'bridge' }); advance(s, 5);
  assert.ok(s.party.snapshotFor(1, 24_000)!.participants.every(p => !p.bot), 'human wins queue race');
}
for (const action of ['cancel', 'invite', 'disconnect', 'duels'] as const) {
  const s = queued('bridge'); advance(s, 10);
  if (action === 'cancel') s.handle(1, { t: 'partyQueue', join: false });
  if (action === 'invite') s.handle(1, { t: 'partyCreate', mode: 'bridge' });
  if (action === 'disconnect') s.removePlayer(1);
  if (action === 'duels') s.handle(1, { t: 'duelQueue', join: true });
  advance(s, 40);
  assert.ok(s.party.snapshots(50_000).every(s => s.participants.every(p => !p.bot)), `${action} cancels fallback`);
}
for (const mode of ['bridge', 'parkour'] as const) {
  const s = make(); s.handle(1, { t: 'partyCreate', mode }); advance(s, 60);
  assert.equal(s.party.snapshotFor(1, 60_000)!.participants.length, 1, 'invite never gets a bot');
}
{
  const s = queued('parkour'); advance(s, 10);
  s.handle(1, { t: 'partyQueue', join: true, mode: 'parkour' }); advance(s, 10.001);
  assert.equal(s.party.phaseFor(1), 'countdown', 'duplicate join does not restart timer');
  const id = s.party.snapshotFor(1, 20_001)!.participants.find(p => p.bot)!.id;
  s.removePlayer(1); assert.ok(!s.snapshot().some(p => p.id === id), 'disconnect removes bot');
}
{
  const { s, botId } = launch('bridge');
  // Let the match clock expire, then close its result screen.
  advance(s, 1000); advance(s, PARTY_RESULT_MS / 1000 + 1);
  assert.ok(!s.snapshot().some(p => p.id === botId), 'results remove bot before world restoration');
  assert.equal(s.party.snapshotFor(1, 2e6)!.participants.length, 1);
}
{
  const { s, botId } = launch('parkour');
  const snap = s.party.snapshotFor(1, 30_000)!;
  const me = snap.participants.find(p => p.id === botId)!, human = snap.participants.find(p => p.id === 1)!;
  const slow = new PartyBot(1, { x: 0, y: 0, z: 0 }, random), fast = new PartyBot(1, { x: 0, y: 0, z: 0 }, random);
  for (let t = 12_000; t < 120_000; t += 6000) {
    slow.adapt(snap.round!.startedAt + t, snap, me, { ...human, score: 1, falls: 8 });
    fast.adapt(snap.round!.startedAt + t, snap, me, { ...human, score: t / 1000, progress: 30 });
  }
  assert.ok(slow.skill >= .2 && fast.skill <= .8 && fast.skill > slow.skill + .2, 'bounded skill adaptation');
}
{
  const { s, botId } = launch('bridge');
  const internal = s as any, bot = internal.players.get(botId), driver = internal.partyBots.get(botId) as PartyBot;
  const sub = s.party.subFor(botId)!;
  const x = sub.minX + 12, z = sub.minZ + 54;
  // A real one-block wool obstruction on the narrow span must be jumped.
  internal.edits.set(`${x},141,${z - 2}`, Block.TeamWoolA);
  driver.reset({ x: x + .5, y: 141.01, z: z + .5 });
  driver.body.onGround = true;
  driver.body.yaw = 0;
  Object.assign(bot, { x: x + .5, y: 141.01, z: z + .5, yaw: 0 });
  let jumped = false, built = false;
  for (let i = 0; i < 60; i++) {
    const out = advance(s, .05);
    jumped ||= bot.y > 142.05;
    built ||= out.some(o => o.to === 1 && o.msg.t === 'edit' &&
      (o.msg.block === Block.TeamWoolA || o.msg.block === Block.TeamWoolB) && o.msg.x !== x);
  }
  assert.ok(jumped && bot.z < z - 1, 'Bridge bot jumps over a one-block obstruction');
  assert.ok(built, 'Bridge bot places useful wool beside the narrow span');
  s.handle(1, { t: 'partyLeave' });
}
{
  const { s, botId } = launch('bridge');
  const internal = s as any, bot = internal.players.get(botId), driver = internal.partyBots.get(botId) as PartyBot;
  const sub = s.party.subFor(botId)!;
  const x = sub.minX + 12, z = sub.minZ + 52;
  internal.edits.set(`${x},140,${z}`, Block.Air);
  driver.reset({ x: x + .5, y: 141.01, z: z + 2.5 });
  driver.body.onGround = true;
  driver.body.yaw = 0;
  Object.assign(bot, { x: x + .5, y: 141.01, z: z + 2.5, yaw: 0 });
  let repaired = false;
  for (let i = 0; i < 40; i++) {
    const out = advance(s, .05);
    repaired ||= out.some(o => o.to === 1 && o.msg.t === 'edit' && o.msg.x === x && o.msg.y === 140 &&
      o.msg.z === z && o.msg.block === Block.TeamWoolB);
  }
  assert.ok(repaired, 'Bridge bot repairs a hole with a server-approved placement');
  s.handle(1, { t: 'partyLeave' });
}
{
  const { s, botId } = launch('bridge');
  const snap = s.party.snapshotFor(botId, 30_000)!;
  const me = snap.participants.find(p => p.id === botId)!, human = snap.participants.find(p => p.id === 1)!;
  const driver = (s as any).partyBots.get(botId) as PartyBot;
  for (let t = 3000; t <= 15_500; t += 2500)
    driver.adapt(snap.round!.startedAt + t, snap, me, { ...human, score: me.score + 2 });
  assert.ok(driver.skill > .8, 'Bridge bot gets noticeably stronger when two goals behind');
  s.handle(1, { t: 'partyLeave' });
}
{
  const { s, botId } = launch('bridge');
  s.addPlayer(2, { username: 'WorldPlayer', faction: 0 });
  assert.ok(!s.snapshotFor(2).some(p => p.id === botId), 'bot stays out of main world');
  assert.ok(s.snapshotFor(1).some(p => p.id === botId), 'opponent sees bot');
  const before = s.snapshotFor(1).find(p => p.id === botId)!.ct;
  advance(s, .05);
  assert.notEqual(s.snapshotFor(1).find(p => p.id === botId)!.ct, before, 'bot animation clock advances');
  for (let i = 0; i < 3600 && s.party.phaseFor(1) === 'running'; i++) advance(s, .05);
  const result = s.party.snapshotFor(1, 200_000)!.result;
  assert.equal(result?.winner, botId, 'Bridge bot can complete a game by scoring goals');
  assert.equal(result?.teamScores[1], 5);
  s.handle(1, { t: 'partyLeave' });
}
{
  const { s, botId } = launch('bridge');
  advance(s, 2);
  // Position a normal player within legal reach, looking directly at the bot.
  const internal = s as any, human = internal.players.get(1), bot = internal.players.get(botId);
  const sub = s.party.subFor(1)!;
  Object.assign(bot, { x: sub.minX + 12.5, y: 141, z: sub.minZ + 40.5 });
  internal.partyBots.get(botId).reset(bot);
  Object.assign(human, { x: bot.x, y: bot.y, z: bot.z + 2, yaw: 0, held: Item.IronAxe });
  const oldHealth = bot.health;
  const out = s.handle(1, { t: 'partyMelee', target: botId });
  assert.ok(out.some(o => o.msg.t === 'partyHit'), 'human can land a validated hit on bot');
  assert.ok(bot.health < oldHealth, 'bot takes normal damage');
  assert.ok(internal.partyBots.get(botId).body.vel.length() > 0, 'bot receives physical knockback');
  s.handle(1, { t: 'partyLeave' });
}
{
  const s = queued('bridge'); advance(s, 19);
  s.handle(1, { t: 'partyQueue', join: true, mode: 'parkour' }); advance(s, 1);
  assert.equal(s.party.phaseFor(1), null, 'changing mode starts a fresh wait');
  advance(s, 19.001);
  assert.equal(s.party.snapshotFor(1, 40_000)!.mode, 'parkour');
  s.handle(1, { t: 'partyLeave' });
}
{
  const { s, botId } = launch('parkour');
  for (let i = 0; i < 6000 && s.party.phaseFor(1) === 'running'; i++) advance(s, .05);
  const result = s.party.snapshotFor(1, 400_000)!.result;
  assert.equal(result?.winner, botId, 'Parkour bot can finish the generated course');
  assert.ok(result?.scoreboard.find(p => p.id === botId)?.finishedAt, 'wins by reaching finish, not timeout');
  s.handle(1, { t: 'partyLeave' });
}
{
  // A wool block across a narrow platform has no walking route around it.
  // The bot must request its removal instead of running into it forever.
  const bot = new PartyBot(1, { x: .5, y: 1, z: .5 }, random);
  bot.body.onGround = true;
  const world = { isLoaded: () => true, getBlock: (x: number, y: number, z: number) =>
    z === 0 && x >= 0 && x <= 4 && y === 0 ? Block.Stone :
      x === 1 && z === 0 && (y === 1 || y === 2) ? Block.TeamWoolA : Block.Air };
  const action: { edit?: { x: number; y: number; z: number; block: number } } = {};
  (bot as any).walkTo(3.5, 1, .5, world, false, 1000, action);
  assert.deepEqual(action.edit, { x: 1, y: 1, z: 0, block: Block.Air }, 'blocked bot clears placed wool');
}
console.log('Party bot smoke passed');
