import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Block } from '../src/blocks';
import { Item } from '../src/items';
import {
  MachineType, Machines, MAX_LEVEL, MAX_STORAGE_LEVEL, allowedFilterMask,
  applyUpgrade, autominerRates, currentRate, focusMultiplier, machineMaxHp,
  newMachine, productionRate, sanitizeState, setFilter, storageCap, tickMachine,
  totalStored, upgradeCost, maxDepth, ORE_DEPTH, MAX_DEPTH, JAM_HEAT, JAM_SECONDS,
  applyMachineAct, fuelValue, FUEL_CAP, TRICKLE, BIT_DURABILITY, linkFuel, WellPhase,
  WELL_DEPTH, gusherChance, igniteWell, WELL_FIRE_SECONDS, RefineMode, relocateMachine,
  machineFriendly, machineCanClaim, siphonMachine, columnRoll, MACHINE_PROGRESSION_VERSION, depositInto,
} from '../src/machines';
import { createMachineModel, disposeMachineModel, MachineModels } from '../src/machinemodels';
import { Terrain } from '../src/terrain';
import { GameServer } from '../src/net/server_core';
import { Interaction } from '../src/interact';
import { Inventory } from '../src/inventory';
import { Player } from '../src/player';
import type { Input } from '../src/input';
import type { World } from '../src/world';

let checks = 0;
function check(name: string, test: () => void) { test(); checks++; console.log(`PASS ${name}`); }
const rich = { ore: { [Block.Stone]: 1, [Block.CoalOre]: .6, [Block.IronOre]: .5, [Block.GoldOre]: .3,
  [Block.RedstoneOre]: .4, [Block.DiamondOre]: .15, [Block.TitaniumOre]: .3 } };
const field = (roll: number) => ({ oil: .8, roll });
check('a fuelled starter rig delivers a useful haul quickly; a dry one still trickles', () => {
  const f = newMachine(MachineType.Autominer); f.fuel = 600; tickMachine(f, rich, 12);
  assert.ok(totalStored(f) >= 4);
  const s = newMachine(MachineType.Autominer); tickMachine(s, rich, 60);
  assert.ok(totalStored(s) >= 1, 'an unfuelled rig still trickles');
  assert.ok(currentRate(f, rich) > currentRate(s, rich) * 3);
  assert.ok(storageCap(f) / currentRate(f, rich) > 600);
});
check('the bore descends, and each ore band unlocks only once it is reached (titanium included)', () => {
  const s = newMachine(MachineType.Autominer); s.level = MAX_LEVEL; s.bit = 3; s.bitWear = BIT_DURABILITY[3]; s.fuel = FUEL_CAP;
  assert.equal(maxDepth(s), MAX_DEPTH);
  assert.equal(autominerRates(s, rich.ore)[Block.TitaniumOre], undefined);
  for (let i = 0; i < 2000 && s.depth < MAX_DEPTH; i++) { s.fuel = FUEL_CAP; tickMachine(s, rich, 1); }
  assert.equal(s.depth, MAX_DEPTH);
  assert.equal(allowedFilterMask(s), 0b1111111);
  assert.ok(autominerRates(s, rich.ore)[Block.TitaniumOre]! > 0, 'titanium is finally mineable');
  const shallow = newMachine(MachineType.Autominer);
  assert.equal(maxDepth(shallow), 30, 'rank 1 bores 30 m');
  shallow.depth = 30; assert.ok(!(allowedFilterMask(shallow) & (1 << 5)), 'no diamond at 30 m');
  assert.ok(ORE_DEPTH[Block.TitaniumOre] > ORE_DEPTH[Block.DiamondOre]);
});
check('focus is a real choice among reached ores', () => {
  const s = newMachine(MachineType.Autominer); s.depth = 20; s.fuel = 100;
  setFilter(s, 1); assert.equal(focusMultiplier(s), 1.5);
  setFilter(s, 3); assert.equal(focusMultiplier(s), 1.25);
  setFilter(s, 0b1000001); assert.equal(focusMultiplier(s), 1.5, 'unreached titanium does not count');
  setFilter(s, 0); tickMachine(s, rich, 60); assert.equal(totalStored(s), 0);
});
check('overdrive doubles output, burns double fuel, heats up and jams; coolant and vent clear it', () => {
  const a = newMachine(MachineType.Autominer), b = newMachine(MachineType.Autominer);
  a.fuel = b.fuel = 1000; a.depth = b.depth = 20;
  assert.ok(applyMachineAct(b, 'overdrive', 1, 0));
  tickMachine(a, rich, 5); tickMachine(b, rich, 5);
  assert.ok(totalStored(b) > totalStored(a) * 1.6);
  assert.ok(1000 - b.fuel > (1000 - a.fuel) * 1.9);
  for (let i = 0; i < 200 && b.jam <= 0; i++) { b.fuel = 1000; tickMachine(b, rich, .5); }
  assert.ok(b.jam > 0 && b.jam <= JAM_SECONDS); assert.equal(b.heat, JAM_HEAT); assert.equal(b.overdrive, false);
  const held = totalStored(b); tickMachine(b, rich, 5); assert.equal(totalStored(b), held, 'jammed rigs produce nothing');
  const hp = b.hp; assert.ok(applyMachineAct(b, 'vent', 0, 0)); assert.equal(b.jam, 0); assert.ok(b.hp < hp);
  b.heat = 90; assert.ok(applyMachineAct(b, 'coolant', 0, 0)); assert.ok(b.heat <= 30);
  const dry = newMachine(MachineType.Autominer);
  assert.equal(applyMachineAct(dry, 'overdrive', 1, 0), false, 'overdrive needs fuel');
});
check('fuel loads by item value, respects the tank, and unfuelled rigs trickle', () => {
  const s = newMachine(MachineType.Autominer);
  assert.ok(applyMachineAct(s, 'fuel', 5, Item.Coal)); assert.equal(s.fuel, 5 * fuelValue(Item.Coal));
  assert.equal(applyMachineAct(s, 'fuel', 5, Item.Diamond), false);
  applyMachineAct(s, 'fuel', 9999, Item.OilBarrel); assert.ok(s.fuel <= FUEL_CAP);
  const t = newMachine(MachineType.Autominer), f = newMachine(MachineType.Autominer); f.fuel = 100;
  const r0 = autominerRates(t, rich.ore)[Block.Stone]!, r1 = autominerRates(f, rich.ore)[Block.Stone]!;
  assert.ok(Math.abs(r0 / r1 - TRICKLE) < 1e-9);
});
check('drill bits set depth, wear out, and pull the string back up', () => {
  const s = newMachine(MachineType.Autominer); s.level = MAX_LEVEL;
  assert.equal(maxDepth(s), 45);
  assert.ok(applyMachineAct(s, 'bit', 1, Item.DrillBitDiamond)); assert.equal(maxDepth(s), 105);
  s.depth = 100; s.bitWear = 1; s.fuel = 1000;
  const ev = tickMachine(s, rich, 5);
  assert.ok(ev.bitBroke); assert.equal(s.bit, 0); assert.equal(s.depth, 45);
});
check('veins thin with extraction but never go completely dry; relocation starts fresh', () => {
  const s = newMachine(MachineType.Autominer); s.level = MAX_LEVEL; s.depth = 20;
  for (let i = 0; i < 400; i++) { s.fuel = FUEL_CAP; s.stored = {}; tickMachine(s, rich, 30); }
  assert.ok(s.reserves < .2);
  assert.ok(autominerRates(s, rich.ore)[Block.Stone]! > 0);
  relocateMachine(s); assert.equal(s.depth, 0); assert.equal(s.reserves, 1); assert.equal(s.level, MAX_LEVEL);
});
check('derricks drill, strike (gushers are deterministic per column), and follow pressure', () => {
  const gush = newMachine(MachineType.OilDerrick), plain = newMachine(MachineType.OilDerrick);
  let ev = {};
  for (let i = 0; i < 400 && gush.phase === WellPhase.Drilling; i++) ev = tickMachine(gush, field(0), 1);
  for (let i = 0; i < 400 && plain.phase === WellPhase.Drilling; i++) tickMachine(plain, field(.999), 1);
  assert.equal(gush.phase, WellPhase.Pumping); assert.equal(gush.depth, WELL_DEPTH);
  assert.ok((ev as { gusher?: boolean }).gusher); assert.ok(gush.uncapped); assert.ok(totalStored(gush) > 0);
  assert.equal(plain.uncapped, false); assert.equal(totalStored(plain), 0);
  assert.ok(gusherChance(.8) > gusherChance(.3)); assert.equal(gusherChance(.1), 0);
  assert.equal(columnRoll(12, -7), columnRoll(12, -7));
  const dry = newMachine(MachineType.OilDerrick); tickMachine(dry, { oil: .1, roll: 0 }, 500);
  assert.equal(dry.phase, WellPhase.Drilling); assert.equal(dry.depth, 0);
  const r0 = currentRate(plain, field(1));
  plain.reserves = .1; assert.ok(currentRate(plain, field(1)) < r0);
  assert.ok(applyMachineAct(plain, 'inject', 0, 0)); assert.ok(plain.reserves > .1);
});
check('an uncapped gusher ignites instead of being flattened; fire burns hull until smothered', () => {
  const s = newMachine(MachineType.OilDerrick); s.phase = WellPhase.Pumping; s.uncapped = true;
  assert.ok(igniteWell(s)); assert.equal(s.fire, WELL_FIRE_SECONDS);
  const hp = s.hp; tickMachine(s, field(1), 5); assert.ok(s.hp < hp);
  assert.equal(currentRate(s, field(1)), 0, 'a burning well pumps nothing');
  assert.ok(applyMachineAct(s, 'smother', 0, 0)); assert.equal(s.fire, 0); assert.equal(s.uncapped, false);
  const capped = newMachine(MachineType.OilDerrick); capped.phase = WellPhase.Pumping;
  assert.equal(igniteWell(capped), false);
});
check('the refinery converts crude into Tar or Fuel Tanks', () => {
  const s = newMachine(MachineType.OilDerrick); s.phase = WellPhase.Pumping; s.depth = WELL_DEPTH; s.level = 5;
  assert.ok(applyMachineAct(s, 'refine', RefineMode.Tar, 0));
  tickMachine(s, field(1), 60);
  assert.ok((s.stored[Block.Tar] ?? 0) > 0); assert.equal(s.stored[Item.OilBarrel], undefined);
  s.stored = {}; applyMachineAct(s, 'refine', RefineMode.FuelTank, 0); tickMachine(s, field(1), 60);
  assert.ok((s.stored[Item.FuelTank] ?? 0) > 0);
});
check('a same-owner derrick within range pipes crude into a thirsty rig', () => {
  const rig = newMachine(MachineType.Autominer, 'Sam'), well = newMachine(MachineType.OilDerrick, 'Sam');
  const foe = newMachine(MachineType.OilDerrick, 'Ana');
  well.stored = { [Item.OilBarrel]: 5 }; foe.stored = { [Item.OilBarrel]: 5 };
  linkFuel([
    { key: 'a', x: 0, y: 0, z: 0, state: rig }, { key: 'b', x: 5, y: 0, z: 0, state: well },
    { key: 'c', x: 2, y: 0, z: 0, state: foe },
  ]);
  assert.equal(rig.fuel, fuelValue(Item.OilBarrel)); assert.equal(well.stored[Item.OilBarrel], 4);
  assert.equal(foe.stored[Item.OilBarrel], 5, 'never steals from another owner');
});
check('ownership: allies operate, raiders siphon a quarter and must knock hull down to hack', () => {
  const s = newMachine(MachineType.Autominer, 'Sam', 1);
  assert.ok(machineFriendly(s, 'Sam', 1)); assert.ok(machineFriendly(s, 'Kit', 1));
  assert.equal(machineFriendly(s, 'Ana', 2), false); assert.equal(machineCanClaim(s, 'Ana', 2), false);
  s.hp = machineMaxHp(s) * .2; assert.ok(machineCanClaim(s, 'Ana', 2));
  s.stored = { [Item.Coal]: 100, [Block.IronOre]: 3 };
  assert.deepEqual(siphonMachine(s), { [Item.Coal]: 25 }); assert.equal(s.stored[Item.Coal], 75);
});
check('the output hopper tops up matching stacks, then fills empty slots, and keeps the rest', () => {
  const slots: ({ id: number; count: number } | null)[] = [{ id: Item.Coal, count: 60 }, null, { id: Block.Stone, count: 64 }];
  const stored: Record<number, number> = { [Item.Coal]: 10, [Block.Cobblestone]: 200 };
  assert.ok(depositInto(slots, stored));
  assert.equal(slots[0]!.count, 64); assert.deepEqual(slots[1], { id: Item.Coal, count: 6 });
  assert.equal(stored[Item.Coal], undefined); assert.equal(stored[Block.Cobblestone], 200, 'no room left for cobble');
  assert.equal(depositInto(slots, stored), false);
});
check('each production rank gives output and milestones add hardware capacity', () => {
  const s = newMachine(MachineType.Autominer);
  while (s.level < MAX_LEVEL) {
    const rate = productionRate(s.level), cap = storageCap(s);
    s.hp = 1; assert.ok(applyUpgrade(s, 'production'));
    assert.ok(productionRate(s.level) > rate); assert.equal(s.hp, machineMaxHp(s));
    if ([3, 6, 10].includes(s.level)) assert.equal(storageCap(s), cap + 192);
  }
  assert.equal(applyUpgrade(s, 'production'), false);
  assert.equal(upgradeCost(s, 'production'), null);
});
check('upgrade paths stay bounded, and oil upgrades reinvest production', () => {
  const miner = newMachine(MachineType.Autominer), oil = newMachine(MachineType.OilDerrick);
  let iron = 0;
  for (let level = 1; level < MAX_LEVEL; level++) {
    miner.level = oil.level = level;
    const cost = upgradeCost(miner, 'production')!; iron += cost[Item.IronIngot];
    assert.equal(cost[Item.CobaltIngot], undefined);
    assert.ok(upgradeCost(oil, 'production')![Item.OilBarrel] > 0);
  }
  assert.ok(iron <= 160);
  miner.storageLevel = MAX_STORAGE_LEVEL;
  assert.equal(applyUpgrade(miner, 'storage'), false);
  assert.equal(upgradeCost(miner, 'storage'), null);
});
check('legacy saves (v1 100-level and v2) migrate without losing output or reached ores', () => {
  for (let oldLevel = 1; oldLevel <= 100; oldLevel++) {
    const legacyMask = oldLevel >= 30 ? 127 : oldLevel >= 10 ? 31 : 7;
    const s = sanitizeState({ type: MachineType.Autominer, level: oldLevel, storageLevel: oldLevel,
      filter: legacyMask, stored: { [Item.Coal]: oldLevel * 96 }, owner: 'Builder' })!;
    assert.ok(productionRate(s.level) >= oldLevel * .05);
    assert.equal(s.progressionVersion, MACHINE_PROGRESSION_VERSION);
    assert.ok(storageCap(s) >= oldLevel * 96);
    assert.equal(totalStored(s), oldLevel * 96);
    assert.deepEqual(sanitizeState(JSON.parse(JSON.stringify(s))), s);
  }
  const v2 = sanitizeState({ type: MachineType.Autominer, progressionVersion: 2, level: 6, storageLevel: 2, filter: 0b0100000 })!;
  assert.ok(allowedFilterMask(v2) & (1 << 5), 'a rank-6 v2 rig keeps diamond');
  const oldWell = sanitizeState({ type: MachineType.OilDerrick, progressionVersion: 2, level: 4, storageLevel: 1 })!;
  assert.equal(oldWell.phase, WellPhase.Pumping, 'old derricks keep pumping');
});
check('fractional production survives authoritative sync and invalid fields are rejected', () => {
  const s = newMachine(MachineType.Autominer); s.fuel = 500; tickMachine(s, rich, 1.3);
  const copy = sanitizeState(JSON.parse(JSON.stringify(s)))!;
  tickMachine(s, rich, 12.7); tickMachine(copy, rich, 12.7);
  assert.deepEqual(copy.stored, s.stored); assert.deepEqual(copy.progress, s.progress);
  const bad = sanitizeState({ ...s, progress: { [Block.Stone]: Infinity, [Block.CoalOre]: -1 },
    depth: 1e9, heat: NaN, fuel: -5, bit: 99 })!;
  assert.deepEqual(bad.progress, {}); assert.ok(bad.depth <= maxDepth(bad));
  assert.equal(bad.heat, 0); assert.equal(bad.fuel, 0); assert.ok(bad.bit <= 3);
});
check('large ticks and rank upgrades never overflow a buffer', () => {
  const s = newMachine(MachineType.Autominer); s.level = 10; s.depth = 30; s.fuel = FUEL_CAP;
  tickMachine(s, rich, 1e20); assert.equal(totalStored(s), storageCap(s));
  tickMachine(s, rich, 1000); assert.equal(totalStored(s), storageCap(s));
  const stored = totalStored(s); applyUpgrade(s, 'storage'); assert.equal(totalStored(s), stored);
});
check('textured models have finite geometry, fit their footprint, and share a bounded number of batches', () => {
  for (const type of [MachineType.Autominer, MachineType.OilDerrick]) for (const level of [1, 3, 6, 10]) {
    const model = createMachineModel(type, level);
    const bounds = new THREE.Box3();
    model.group.traverseVisible(o => { if (o instanceof THREE.Mesh) bounds.expandByObject(o); });
    assert.ok(bounds.min.y >= -.51); assert.ok(bounds.max.y <= (type === MachineType.Autominer ? 1.7 : 2.9));
    assert.ok(bounds.min.x >= -.51 && bounds.max.x <= .51);
    assert.ok(bounds.min.z >= -.51 && bounds.max.z <= .51);
    let draws = 0, textured = 0;
    model.group.traverseVisible(o => {
      if (!(o instanceof THREE.Mesh)) return; draws++;
      if ((o.material as THREE.MeshBasicMaterial).map) textured++;
      for (const n of o.geometry.getAttribute('position').array) assert.ok(Number.isFinite(n));
    });
    assert.ok(draws < 40, `${draws} draw calls`); assert.ok(textured >= 4);
    disposeMachineModel(model);
  }
});
check('world models stop when full, rebuild at milestones, and disappear on removal', () => {
  const machines = new Machines(new Terrain(1337)), scene = new THREE.Scene();
  const models = new MachineModels(scene, machines);
  const s = machines.place(0, 70, 0, MachineType.Autominer);
  models.update(.1); const original = scene.children[0];
  s.level = 3; models.update(.1); assert.notEqual(scene.children[0], original);
  s.stored = { [Item.Coal]: storageCap(s) }; models.update(.1);
  const matrix = scene.toJSON(); models.update(.1); assert.deepEqual(scene.toJSON(), matrix);
  machines.remove(0, 70, 0); models.update(.1); assert.equal(scene.children.length, 0);
});
check('joining players receive existing ranks and output before opening a rig', () => {
  const server = new GameServer(1337, () => .5); server.addPlayer(1);
  server.handle(1, { t: 'xform', x: .5, y: 70, z: .5, yaw: 0, pitch: 0 });
  server.handle(1, { t: 'edit', x: 1, y: 70, z: 0, block: Block.Autominer });
  server.handle(1, { t: 'machineUpgrade', x: 1, y: 70, z: 0, axis: 'production' });
  server.handle(1, { t: 'machineAct', x: 1, y: 70, z: 0, act: 'fuel', n: 10, item: Item.Coal });
  server.tickMachines(60);
  const welcome = server.addPlayer(2).find(o => o.msg.t === 'welcome')?.msg;
  assert.ok(welcome?.t === 'welcome');
  assert.equal(welcome.machines?.[0].state.level, 2);
  assert.ok(totalStored(welcome.machines![0].state) > 0);
});
check('relocation retries invalid clicks, owns held clicks, and works with use suppressed', () => {
  let target = Block.Stone, placements = 0, attempts = 0, opens = 0;
  const world = {
    getBlock: (_x: number, _y: number, z: number) => z === -2 ? target : Block.Air,
    setBlock: () => { placements++; },
  } as unknown as World;
  const inventory = new Inventory(); inventory.add(Block.Cobblestone, 10);
  const player = new Player({ x: .5, y: 70, z: .5 });
  const interaction = new Interaction(new THREE.Scene(), world, player, [new THREE.Texture()], inventory);
  const camera = new THREE.PerspectiveCamera();
  const input = { rightClicked: true, rightDown: true } as Input;
  let accepts = false;
  interaction.onOpenContainer = () => { opens++; };
  interaction.armedMove = (x, y, z) => {
    attempts++;
    assert.deepEqual([x, y, z], [0, Math.floor(player.eyePosition.y), -1]);
    return accepts;
  };
  interaction.update(.1, input, camera, true, true);
  assert.equal(attempts, 1); assert.ok(interaction.armedMove);
  input.rightClicked = false;
  interaction.update(1, input, camera);
  assert.equal(attempts, 1); assert.equal(placements, 0);
  target = Block.Air; input.rightClicked = true;
  interaction.update(.1, input, camera);
  assert.equal(attempts, 1); assert.ok(interaction.armedMove);
  target = Block.Chest; accepts = true;
  interaction.update(.1, input, camera, true, true);
  assert.equal(attempts, 2); assert.equal(interaction.armedMove, null); assert.equal(opens, 0);
  input.rightClicked = false;
  interaction.update(1, input, camera);
  assert.equal(placements, 0); assert.equal(inventory.countItem(Block.Cobblestone), 10);
  input.rightDown = false; interaction.update(.1, input, camera);
  input.rightClicked = input.rightDown = true;
  interaction.update(.1, input, camera);
  assert.equal(opens, 1);
});
check('both machine footprints relocate with upgrades, ownership, and output intact', () => {
  for (const block of [Block.Autominer, Block.OilDerrick]) {
    const server = new GameServer(1337, () => .5); server.addPlayer(1);
    server.handle(1, { t: 'xform', x: .5, y: 70, z: .5, yaw: 0, pitch: 0 });
    server.handle(1, { t: 'edit', x: 1, y: 70, z: 0, block });
    const height = block === Block.OilDerrick ? 3 : 2;
    for (let k = 1; k < height; k++) {
      server.handle(1, { t: 'edit', x: 1, y: 70 + k, z: 0, block: Block.MachinePart });
    }
    server.handle(1, { t: 'machineUpgrade', x: 1, y: 70, z: 0, axis: 'production' });
    server.handle(1, { t: 'machineClaim', x: 1, y: 70, z: 0 });
    server.tickMachines(60);
    const before = server.handle(1, { t: 'machineOpen', x: 1, y: 70, z: 0 })
      .find(o => o.msg.t === 'machine')!.msg;
    assert.ok(before.t === 'machine');
    const out = server.handle(1, { t: 'machineMove', x: 1, y: 70, z: 0, tx: 2, ty: 70, tz: 0 });
    const after = out.find(o => o.msg.t === 'machine')!.msg;
    assert.ok(after.t === 'machine');
    assert.equal(after.state.level, before.state.level); assert.equal(after.state.owner, before.state.owner);
    assert.deepEqual(after.state.stored, before.state.stored);
    assert.equal(after.state.depth, 0, 'the bore/well restarts on fresh ground');
    for (let k = 0; k < height; k++) {
      assert.ok(out.some(o => o.msg.t === 'edit' && o.msg.x === 1 && o.msg.y === 70 + k && o.msg.block === Block.Air));
      assert.ok(out.some(o => o.msg.t === 'edit' && o.msg.x === 2 && o.msg.y === 70 + k && o.msg.block === (k ? Block.MachinePart : block)));
    }
  }
});
check('server: hostile players cannot configure or upgrade a claimed rig, and a well fire is announced', () => {
  const server = new GameServer(1337, () => .5); server.addPlayer(1); server.addPlayer(2);
  server.handle(1, { t: 'xform', x: .5, y: 70, z: .5, yaw: 0, pitch: 0 });
  server.handle(2, { t: 'xform', x: 1.5, y: 70, z: .5, yaw: 0, pitch: 0 });
  server.handle(1, { t: 'edit', x: 1, y: 70, z: 0, block: Block.Autominer });
  const open = () => server.handle(1, { t: 'machineOpen', x: 1, y: 70, z: 0 }).find(o => o.msg.t === 'machine')!.msg;
  const first = open(); assert.ok(first.t === 'machine');
  // Player 2 is on no faction and not the owner: upgrades bounce.
  server.handle(2, { t: 'machineUpgrade', x: 1, y: 70, z: 0, axis: 'production' });
  const after = open(); assert.ok(after.t === 'machine'); assert.equal(after.state.level, first.state.level);
});
console.log(`${checks} automation checks passed`);
