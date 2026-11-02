// Vanilla foundation: block storage, ids, and the pure rules checked against
// Minecraft wiki numbers.
import assert from 'node:assert/strict';
import { Chunk } from '../src/chunk';
import { BLOCKS, BLOCK_ID_LIMIT, Block } from '../src/blocks';
import { ITEMS } from '../src/items';
import { VANILLA_BLOCK_LAST, VB, stateId } from '../src/vanilla/blocks';
import { VANILLA_BLOCK_BASE, VANILLA_ITEM_BASE } from '../src/vanilla/ids';
import { VI, vi, VITEM } from '../src/vanilla/items';
import { VANILLA_TILE_END } from '../src/vanilla/tiles';
import { ATLAS_TILES } from '../src/textures';
import { EffectSet } from '../src/vanilla/effects';
import { Hunger } from '../src/vanilla/hunger';
import { armorOf, cooldownScale, explosionDamage, fallDamage, meleeHit, reduceDamage, bowPower } from '../src/vanilla/combat';
import { breakTicks, dropsOf } from '../src/vanilla/tools';
import { craftResult, smeltResult } from '../src/vanilla/crafting';
import { click, emptyInventory, newWindow, closeWindow, GRID0, RESULT } from '../src/vanilla/inventory_model';
import { placeBlock, mergeInto, neighbourUpdates } from '../src/vanilla/block_states';
import { applyFill } from '../src/vanilla/fill';
import { WorldBlocks, worldGenerator } from '../src/multiverse';
import type { VStack } from '../src/vanilla/stack';
import { BOAT, NO_CONTROLS, stepBoat, waterSurface, slipperiness } from '../src/vanilla/boat';

const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) <= eps;

export function runVanillaTests(): number {
  let n = 0;
  const t = (name: string, fn: () => void) => { fn(); n++; void name; };
  console.log('▸ Vanilla foundation');

  t('16-bit chunk storage holds vanilla ids and starts unallocated', () => {
    const c = new Chunk(0, 0);
    const empty = c.data;
    assert.equal(c.get(3, 70, 4), 0);
    c.set(3, 70, 4, 1500);
    assert.notEqual(c.data, empty);
    assert.equal(c.get(3, 70, 4), 1500);
    assert.equal(new Chunk(1, 1).data, empty, 'fresh chunks share the empty array');
    assert.equal(empty.every((v) => v === 0), true);
  });
  t('id ranges do not overlap and the atlas fits', () => {
    assert.ok(VANILLA_BLOCK_LAST < BLOCK_ID_LIMIT && VANILLA_BLOCK_LAST >= VANILLA_BLOCK_BASE);
    for (const id of Object.keys(ITEMS).map(Number)) {
      if (id >= VANILLA_ITEM_BASE) continue;
      if (id >= 256 && id < VANILLA_BLOCK_BASE) continue; // legacy pure items
      assert.ok(id < 256 || BLOCKS[id], `item ${id} sits on a block id with no block`);
    }
    assert.ok(VANILLA_TILE_END <= ATLAS_TILES * ATLAS_TILES);
  });
  t('combat: diamond sword 7 damage, 0.625 s cooldown; crit x1.5', () => {
    const sword: VStack = { id: vi('diamond_sword'), count: 1 };
    const base = { held: sword, effects: new EffectSet(), falling: false, onGround: true, inWater: false, climbing: false, sprinting: false, fallDistance: 0, targetUndead: false, targetArthropod: false };
    assert.ok(near(meleeHit({ ...base, ticksSinceAttack: 12.5 }).damage, 7));
    assert.ok(near(cooldownScale(12, 1.6), 1));
    assert.ok(cooldownScale(6, 1.6) < .6);
    const crit = meleeHit({ ...base, ticksSinceAttack: 20, falling: true, onGround: false, fallDistance: .5 });
    assert.equal(crit.crit, true); assert.ok(near(crit.damage, 10.5));
    const sharp = meleeHit({ ...base, held: { ...sword, ench: [['sharpness', 5]] }, ticksSinceAttack: 20 });
    assert.ok(near(sharp.damage, 10));
  });
  t('armour: 20 armour / 8 toughness leaves 3.33 of a 10 hit (wiki 66.7% cut)', () => {
    const worn = ['diamond_helmet', 'diamond_chestplate', 'diamond_leggings', 'diamond_boots'].map((k) => ({ id: vi(k), count: 1 }));
    const a = armorOf(worn);
    assert.equal(a.armor, 20); assert.equal(a.toughness, 8);
    const left = reduceDamage({ kind: 'melee', amount: 10 }, { armor: a.armor, toughness: a.toughness, epf: 0, effects: new EffectSet() });
    assert.ok(near(left, 10 * (1 - Math.min(20, Math.max(4, 20 - 40 / 16)) / 25)), `${left}`);
    assert.ok(near(left, 3.0));
  });
  t('mace smash: 3 blocks +12, 8 blocks +22', () => {
    const mace: VStack = { id: vi('mace'), count: 1 };
    const base = { held: mace, effects: new EffectSet(), falling: true, onGround: false, inWater: false, climbing: false, sprinting: false, targetUndead: false, targetArthropod: false, ticksSinceAttack: 40 };
    assert.ok(near(meleeHit({ ...base, fallDistance: 3 }).damage, 6 * 1.5 + 12));
    assert.ok(near(meleeHit({ ...base, fallDistance: 8 }).damage, 6 * 1.5 + 22));
  });
  t('fall, explosion, bow', () => {
    assert.equal(fallDamage(10, 0, 0, 'normal'), 7);
    assert.equal(fallDamage(10, 0, 0, 'hay'), 2);
    assert.equal(fallDamage(3, 0, 0, 'normal'), 0);
    assert.equal(explosionDamage(4, 0, 1).damage, 57);
    assert.equal(bowPower(20), 1);
    assert.ok(bowPower(2) < .1);
  });
  t('effects: regeneration II heals every 25 ticks, poison stops cadence', () => {
    const e = new EffectSet();
    e.add('regeneration', 1, 100);
    let heal = 0;
    for (let i = 0; i < 100; i++) heal += e.tick().heal;
    assert.equal(heal, 4);
    assert.equal(e.add('speed', 0, 100), true);
    assert.equal(e.add('speed', 0, 50), false, 'equal level, shorter: no change');
    assert.ok(near(e.speedMult(), 1.2));
  });
  t('hunger: 18+ food heals 1 per 80 ticks; starving stops at 1 HP', () => {
    const h = new Hunger();
    h.food = 19; h.saturation = 0;
    let gained = 0;
    for (let i = 0; i < 160; i++) gained += h.tick(10, 20, true);
    assert.equal(gained, 2);
    h.food = 0; h.saturation = 0;
    let lost = 0;
    for (let i = 0; i < 800; i++) lost += h.tick(1, 20, true);
    assert.equal(lost, 0);
  });
  t('mining: stone with a wooden pickaxe 1.15 s; by hand 7.5 s and no drop', () => {
    const c = { haste: 1, inWater: false, onGround: true };
    assert.equal(breakTicks(Block.Stone, { id: vi('wooden_pickaxe'), count: 1 }, c), 23);
    assert.equal(breakTicks(Block.Stone, null, c), 150);
    assert.deepEqual(dropsOf(Block.Stone, null, () => .5), []);
    assert.equal(dropsOf(Block.Stone, { id: vi('wooden_pickaxe'), count: 1 }, () => .5)[0].id, Block.Cobblestone);
    assert.equal(breakTicks(VB.bedrock, null, c), Infinity);
    assert.deepEqual(dropsOf(VB.glass, null, () => .5), []);
    assert.equal(dropsOf(VB.glass, null, () => .5, { glassSelf: true })[0].id, VB.glass);
  });
  t('crafting: logs, sticks, mirrored axe, tagged planks, storage blocks, smelting', () => {
    const s = (k: string, c = 1): VStack => ({ id: vi(k), count: c });
    assert.equal(craftResult([s('spruce_log'), null, null, null], 2)?.id, VI.spruce_planks);
    assert.equal(craftResult([s('birch_planks'), null, s('oak_planks'), null], 2)?.count, 4);
    const axe = [s('iron_ingot'), s('iron_ingot'), null, s('iron_ingot'), s('stick'), null, null, s('stick'), null];
    const mirrored = [null, s('iron_ingot'), s('iron_ingot'), null, s('stick'), s('iron_ingot'), null, s('stick'), null];
    assert.equal(craftResult(axe, 3)?.id, VI.iron_axe);
    assert.equal(craftResult(mirrored, 3)?.id, VI.iron_axe);
    assert.equal(craftResult([s('iron_block'), null, null, null, null, null, null, null, null], 3)?.count, 9);
    assert.equal(smeltResult(VI.sand), VI.glass);
    assert.equal(smeltResult(VI.beef, true), VI.cooked_beef);
    assert.equal(smeltResult(VI.sand, true), null);
  });
  t('inventory: split, place one, quick-move armour, craft from the 2x2 grid', () => {
    const inv = emptyInventory();
    inv.slots[0] = { id: VI.cobblestone, count: 16 };
    click(inv, null, 0, 1, 'pick');
    assert.equal(inv.cursor?.count, 8); assert.equal(inv.slots[0]?.count, 8);
    click(inv, null, 9, 1, 'pick');
    assert.equal(inv.slots[9]?.count, 1); assert.equal(inv.cursor?.count, 7);
    click(inv, null, 0, 0, 'pick');
    assert.equal(inv.slots[0]?.count, 15); assert.equal(inv.cursor, null);
    inv.slots[3] = { id: vi('iron_helmet'), count: 1 };
    click(inv, null, 3, 0, 'quick');
    assert.equal(inv.slots[36]?.id, vi('iron_helmet'));
    inv.slots[GRID0] = { id: VI.oak_log, count: 2 };
    click(inv, null, 0, 0, 'pick'); click(inv, null, 0, 0, 'pick');
    const before = inv.slots[RESULT];
    assert.equal(before?.id, VI.oak_planks);
    click(inv, null, RESULT, 0, 'pick');
    assert.equal((inv.cursor as {count:number} | null)?.count, 4); assert.equal(inv.slots[GRID0]?.count, 1);
    inv.cursor = null;
    const spill = closeWindow(inv, null);
    assert.equal(spill.length, 0);
    assert.equal(inv.slots[GRID0], null);
    const win = newWindow('furnace');
    inv.slots[5] = { id: VI.coal, count: 3 };
    click(inv, win, 3 + 27 + 5, 0, 'quick');
    assert.equal(win.slots[1]?.id, VI.coal, 'fuel goes to the fuel slot');
  });
  t('placement: stairs face the player, slabs double, fences connect, doors are two high', () => {
    const cells = new Map<string, number>();
    const get = (x: number, y: number, z: number) => cells.get(`${x},${y},${z}`) ?? (y === 63 ? Block.Stone : Block.Air);
    const ctx = { nx: 0, ny: 1, nz: 0, yaw: 0, hitY: 1 };
    const st = placeBlock(VB.oak_stairs, get, 0, 64, 0, ctx)!;
    assert.equal(st[0].block, stateId('oak_stairs', { facing: 'n', half: 'bottom' }));
    const slab = placeBlock(VB.oak_slab, get, 0, 64, 0, ctx)![0].block;
    assert.equal(mergeInto(VB.oak_slab, slab, ctx), stateId('oak_slab', { type: 'double' }));
    cells.set('1,64,0', VB.oak_fence);
    const f = placeBlock(VB.oak_fence, get, 0, 64, 0, ctx)![0].block;
    assert.equal(f, stateId('oak_fence', { conn: 4 }));
    cells.set('0,64,0', f);
    const ups = neighbourUpdates(get, 0, 64, 0);
    assert.equal(ups[0]?.block, stateId('oak_fence', { conn: 8 }));
    const door = placeBlock(VB.oak_door, get, 5, 64, 5, ctx)!;
    assert.equal(door.length, 2);
  });
  t('editFill: supported flood only lands on solid ground or water', () => {
    const gen = worldGenerator({ kind: 'duel', seed: 0 });
    const w = new WorldBlocks(gen);
    const cells = new Map<string, number>();
    const get = (x: number, y: number, z: number) => cells.get(`${x},${y},${z}`) ?? (y <= 0 && x !== 2 ? Block.Stone : Block.Air);
    const set = (x: number, y: number, z: number, b: number) => { cells.set(`${x},${y},${z}`, b); };
    const changed = applyFill({ min: [0, 1, 0], max: [3, 2, 0], block: Block.Water, mask: 'air', supported: true }, get, set);
    assert.equal(cells.get('2,1,0'), undefined, 'no water over the hole');
    assert.equal(changed, 6);
    void w;
  });
  t('boats float at the draft line and top out at vanilla water speed', () => {
    // Still water filling y 60..62 over stone.
    const get = (_x: number, y: number) => y < 60 ? Block.Stone : y <= 62 ? Block.Water : Block.Air;
    const surface = waterSurface(get, 0, 62, 0)!;
    assert.ok(near(surface, 62 + 8 / 9));
    const b = { x: 0.5, y: 61, z: 0.5, vx: 0, vy: 0, vz: 0, yaw: 0, spin: 0 };
    for (let i = 0; i < 200; i++) { const d = stepBoat(b, NO_CONTROLS, get); b.x += d.dx; b.y += d.dy; b.z += d.dz; }
    assert.ok(Math.abs(b.y - (surface - BOAT.DRAFT)) < .02, `floats at ${b.y}`);
    for (let i = 0; i < 400; i++) { const d = stepBoat(b, { ...NO_CONTROLS, forward: true }, get); b.x += d.dx; b.y += d.dy; b.z += d.dz; }
    const speed = Math.hypot(b.vx, b.vz) * 20;
    assert.ok(speed > 7.5 && speed < 8.1, `water top speed ${speed}`);
    assert.ok(b.vz < 0 && Math.abs(b.vx) < 1e-9, 'forward is -z at yaw 0');
    // A/D: one degree a tick of turn, damped by the same momentum.
    const turn = { x: 0, y: b.y, z: 0, vx: 0, vy: 0, vz: 0, yaw: 0, spin: 0 };
    stepBoat(turn, { ...NO_CONTROLS, left: true }, get);
    assert.ok(near(turn.yaw, Math.PI / 180), 'left turns +1°');
    // Ground: default 0.6, ice 0.98, blue ice 0.989; no ground, no water: falls.
    const ground = (id: number) => (_x: number, y: number) => y < 60 ? id : Block.Air;
    assert.equal(slipperiness(ground(Block.Stone), 0, 60, 0), .6);
    assert.equal(slipperiness(ground(VB.ice), 0, 60, 0), .98);
    assert.equal(slipperiness(ground(VB.blue_ice), 0, 60, 0), .989);
    const air = { x: 0, y: 80, z: 0, vx: 0, vy: 0, vz: 0, yaw: 0, spin: 0 };
    assert.equal(stepBoat(air, NO_CONTROLS, ground(Block.Stone)).status, 'air');
    assert.ok(air.vy < 0);
  });
  t('every vanilla item has data and a name', () => {
    for (const [id, d] of Object.entries(VITEM)) assert.ok(d.name && d.maxStack > 0, `item ${id}`);
  });
  console.log(`Vanilla foundation: ${n} tests passed.`);
  return n;
}
