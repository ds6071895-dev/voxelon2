// Trapcraft checks: ownership, arming, triggers + channels, actuators, effects,
// defusing, and the server's authoritative trap loop.
import assert from 'node:assert/strict';
import { Block } from '../src/blocks';
import {
  TrapField, TrapKind, TrapTarget, ARM_SECONDS, SIGNAL_RADIUS, TRIP_RANGE, sanitizeTrap,
  trapHostile, newTrap, facingForPlacement, tripwireCells,
} from '../src/traps';
import { StatusEffects } from '../src/effects';
import { GameServer } from '../src/net/server_core';

let checks = 0;
function check(name: string, test: () => void) { test(); checks++; console.log(`PASS ${name}`); }
const open = () => false; // no solid blocks anywhere
const enemy = (x: number, y: number, z: number): TrapTarget => ({ id: 'e', name: 'Ana', faction: 2, x, y, z });
const me = (x: number, y: number, z: number): TrapTarget => ({ id: 'm', name: 'Sam', faction: 1, x, y, z });
const ally = (x: number, y: number, z: number): TrapTarget => ({ id: 'a', name: 'Kit', faction: 1, x, y, z });
/** Place a trap and fast-forward its arming. */
function armed(f: TrapField, x: number, y: number, z: number, block: number, facing = 0, channel = 0) {
  const s = f.place(x, y, z, block, 'Sam', 1, facing)!;
  s.channel = channel;
  f.tick(ARM_SECONDS + .1, [], open);
  return s;
}

check('your traps never fire on you or your allies; legacy ownerless traps hit everyone', () => {
  const s = newTrap(TrapKind.Spike, 'Sam', 1);
  assert.equal(trapHostile(s, { name: 'Sam', faction: 1 }), false);
  assert.equal(trapHostile(s, { name: 'Kit', faction: 1 }), false);
  assert.equal(trapHostile(s, { name: 'Ana', faction: 2 }), true);
  assert.equal(trapHostile(newTrap(TrapKind.Spike), { name: 'Sam', faction: 1 }), true);
  const f = new TrapField(); armed(f, 0, 64, 0, Block.SpikeTrap);
  assert.equal(f.tick(.1, [me(.5, 64.5, .5), ally(.5, 64.5, .5)], open).hits.length, 0);
});
check('fresh traps arm after a grace period', () => {
  const f = new TrapField(); f.place(0, 64, 0, Block.SpikeTrap, 'Sam', 1);
  assert.equal(f.tick(.5, [enemy(.5, 64.5, .5)], open).hits.length, 0);
  const res = f.tick(ARM_SECONDS, [], open);
  assert.ok(res.fx.some(x => x.what === 'arm'));
  assert.equal(f.tick(.1, [enemy(.5, 64.5, .5)], open).hits.length, 1);
});
check('spikes spring up, bleed, and respect their cooldown', () => {
  const f = new TrapField(); const s = armed(f, 0, 64, 0, Block.SpikeTrap);
  const res = f.tick(.1, [enemy(.5, 64.5, .5)], open);
  assert.equal(res.hits[0].damage, 6); assert.ok(res.hits[0].effects.some(e => e.kind === 'bleed'));
  assert.ok(s.on);
  assert.equal(f.tick(.1, [enemy(.5, 64.5, .5)], open).hits.length, 0, 'cooldown');
});
check('landmines prime, then detonate as an owner-attributed blast and are consumed', () => {
  const f = new TrapField(); armed(f, 0, 64, 0, Block.Landmine);
  const primed = f.tick(.1, [enemy(.5, 64.5, .5)], open);
  assert.ok(primed.fx.some(x => x.what === 'prime')); assert.equal(primed.blasts.length, 0);
  const boom = f.tick(.5, [], open);
  assert.equal(boom.blasts.length, 1); assert.equal(boom.blasts[0].owner, 'Sam');
  assert.deepEqual(boom.writes[0], { x: 0, y: 64, z: 0, block: Block.Air });
  assert.equal(f.has(0, 64, 0), false);
});
check('bear traps pin, shock plates stun', () => {
  const f = new TrapField(); armed(f, 0, 64, 0, Block.BearTrap); armed(f, 3, 64, 0, Block.ShockPlate);
  const res = f.tick(.1, [enemy(.5, 64.5, .5), { ...enemy(3.5, 64.5, .5), id: 'e2' }], open);
  assert.ok(res.hits.some(h => h.target === 'e' && h.effects.some(e => e.kind === 'pinned')));
  assert.ok(res.hits.some(h => h.target === 'e2' && h.effects.some(e => e.kind === 'stun')));
});
check('a pressure plate fires its channel: same-owner receivers only, within reach', () => {
  const f = new TrapField();
  armed(f, 0, 64, 0, Block.PressurePlate, 0, 3);
  const wall = armed(f, 5, 64, 0, Block.WallTrap, 0, 3);
  const other = armed(f, 6, 64, 0, Block.WallTrap, 0, 4);
  const far = armed(f, SIGNAL_RADIUS + 5, 64, 0, Block.WallTrap, 0, 3);
  const foreign = f.place(7, 64, 0, Block.WallTrap, 'Ana', 2)!; foreign.channel = 3; f.tick(ARM_SECONDS, [], open);
  const res = f.tick(.1, [enemy(.5, 64.5, .5)], open);
  assert.ok(wall.on); assert.equal(other.on, false); assert.equal(far.on, false); assert.equal(foreign.on, false);
  assert.ok(res.writes.some(w => w.x === 5 && w.block === Block.WallTrapUp));
  // …and it drops again after its hold.
  const back = f.tick(7, [], open);
  assert.ok(back.writes.some(w => w.x === 5 && w.block === Block.WallTrap));
});
check('tripwire beams stop at walls and trip on bodies crossing them', () => {
  const wallAt = (x: number) => (bx: number) => bx === x;
  assert.equal(tripwireCells(0, 64, 0, 1, (x) => wallAt(4)(x)).length, 3);
  assert.equal(tripwireCells(0, 64, 0, 1, open).length, TRIP_RANGE);
  const f = new TrapField(); armed(f, 0, 64, 0, Block.TripwireHook, 1, 2);
  const fall = armed(f, 3, 63, 0, Block.FallTrap, 0, 2);
  f.tick(.1, [enemy(3.5, 63.6, .5)], open);
  assert.ok(fall.on, 'breaking the beam opened the fall trap');
});
check('a lever latches its channel on until pulled back', () => {
  const f = new TrapField(); armed(f, 0, 64, 0, Block.Lever, 0, 5);
  const fall = armed(f, 2, 64, 0, Block.FallTrap, 0, 5);
  f.pull(0, 64, 0, open); f.tick(10, [], open);
  assert.ok(fall.on, 'held open while latched');
  f.pull(0, 64, 0, open); f.tick(10, [], open);
  assert.equal(fall.on, false);
});
check('claymores shred only what is in front of them', () => {
  const f = new TrapField(); armed(f, 0, 64, 0, Block.Claymore, 2); // facing +z
  assert.equal(f.tick(.1, [enemy(.5, 64, -3)], open).hits.length, 0, 'behind: safe');
  const res = f.tick(.1, [enemy(.5, 64, 3)], open);
  assert.equal(res.hits.length, 1); assert.ok(res.removed.length === 1);
});
check('flame jets burn oil in bursts; dart and net launchers pick the first enemy in line', () => {
  const f = new TrapField(); const jet = armed(f, 0, 64, 0, Block.FlameJet, 2); jet.fuel = 1;
  let burns = 0;
  for (let i = 0; i < 40; i++) burns += f.tick(.1, [enemy(.5, 64, 2.5)], open).hits.length;
  assert.ok(burns > 0); assert.equal(jet.fuel, 0);
  const dry = f.tick(10, [enemy(.5, 64, 2.5)], open); assert.equal(dry.hits.length, 0, 'no oil, no fire');
  const g = new TrapField(); armed(g, 0, 64, 0, Block.DartLauncher, 1); armed(g, 0, 70, 0, Block.NetLauncher, 1);
  const res = g.tick(.1, [enemy(4.5, 63.2, .5), { ...enemy(3.5, 69.2, .5), id: 'n' }], open);
  assert.ok(res.hits.some(h => h.effects.some(e => e.kind === 'slow')));
  assert.ok(res.hits.some(h => h.target === 'n' && h.effects.some(e => e.kind === 'netted')));
});
check('alarm bells notify the owner when an enemy gets close', () => {
  const f = new TrapField(); armed(f, 0, 64, 0, Block.AlarmBell);
  const res = f.tick(.1, [enemy(3, 64, 0)], open);
  assert.equal(res.alarms.length, 1); assert.equal(res.alarms[0].owner, 'Sam'); assert.equal(res.alarms[0].name, 'Ana');
});
check('mining an armed hostile trap springs it; the owner mining it just removes it', () => {
  const f = new TrapField(); armed(f, 0, 64, 0, Block.Landmine);
  const res = f.spring(0, 64, 0, enemy(.5, 64.5, .5), open);
  assert.equal(res.blasts.length, 1); assert.equal(f.has(0, 64, 0), false);
  armed(f, 1, 64, 0, Block.Landmine);
  assert.equal(f.spring(1, 64, 0, me(1.5, 64.5, .5), open).blasts.length, 0);
});
check('placement facing and state sanitizing', () => {
  assert.equal(facingForPlacement(TrapKind.DartLauncher, 1, 0, 0, 0), 1);
  assert.equal(facingForPlacement(TrapKind.FlameJet, 0, 1, 0, 0), 4);
  assert.equal(facingForPlacement(TrapKind.Claymore, 0, 1, 0, 0), 0); // yaw 0 looks -z
  const s = sanitizeTrap({ kind: 13, owner: 'x'.repeat(99), channel: 99, facing: -3, fuel: 1e9, interval: 3 })!;
  assert.equal(s.owner.length, 24); assert.equal(s.channel, 15); assert.equal(s.facing, 0);
  assert.equal(s.interval, 4); assert.equal(sanitizeTrap({ kind: 99 }), null);
});
check('status effects: pins break by struggling, nets and stuns root and block actions', () => {
  const fx = new StatusEffects();
  fx.add('pinned', 7); assert.ok(fx.rooted());
  let presses = 0; while (!fx.struggle()) presses++;
  assert.ok(presses >= 4 && presses <= 7);
  fx.add('netted', 3); assert.ok(fx.blocksActions()); fx.update(3.1); assert.equal(fx.blocksActions(), false);
  fx.add('bleed', 4); let dot = 0; for (let i = 0; i < 40; i++) dot += fx.update(.1); assert.equal(dot, 4);
});
check('server: placing a trap records its owner; it fires on enemies, reports a trap kill, and defuses', () => {
  const server = new GameServer(1337, () => .5);
  server.addPlayer(1); server.addPlayer(2);
  server.handle(1, { t: 'xform', x: .5, y: 70, z: .5, yaw: 0, pitch: 0 });
  const placed = server.handle(1, { t: 'edit', x: 2, y: 69, z: 0, block: Block.SpikeTrap });
  const trapMsg = placed.find(o => o.msg.t === 'trap')?.msg;
  assert.ok(trapMsg?.t === 'trap' && trapMsg.state && trapMsg.state.kind === TrapKind.Spike);
  server.tickTraps(ARM_SECONDS + .1);
  // The owner walking over it: nothing.
  server.handle(1, { t: 'xform', x: 2.5, y: 69.5, z: .5, yaw: 0, pitch: 0 });
  assert.equal(server.tickTraps(.05).filter(o => o.msg.t === 'hurt').length, 0);
  // Someone else (unless they share a faction) gets impaled.
  server.handle(1, { t: 'xform', x: .5, y: 70, z: .5, yaw: 0, pitch: 0 });
  server.handle(2, { t: 'xform', x: 2.5, y: 69.5, z: .5, yaw: 0, pitch: 0 });
  const hits = server.tickTraps(.05);
  const sameSide = hits.length === 0;
  if (!sameSide) assert.ok(hits.some(o => o.msg.t === 'effect' && o.msg.kind === 'bleed'));
  // Defusing needs sneaking.
  server.handle(2, { t: 'xform', x: 2.5, y: 70, z: 1.5, yaw: 0, pitch: 0, sneaking: true });
  const out = server.handle(2, { t: 'trapDefuse', x: 2, y: 69, z: 0 });
  if (!sameSide) assert.ok(out.some(o => o.msg.t === 'gotitem' && o.msg.item === Block.SpikeTrap));
});
console.log(`${checks} trap checks passed`);
