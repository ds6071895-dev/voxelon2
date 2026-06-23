// Headless smoke tests for VOXELON: terrain/biomes/mountains, ores, caves,
// lighting, meshing, raycast, player physics + energy, survival regen,
// crafting/tools, furnace, items/inventory, item entities, hostile mobs,
// and the VOXELON-specific changes. Run: npm run smoke

import * as THREE from 'three';
import { materialOf } from '../src/audio';
import { Biome, BIOME_NAMES } from '../src/biomes';
import { Block, BLOCKS, isSolid, orientStairsForYaw, stairsBaseOf } from '../src/blocks';
import { Chunk } from '../src/chunk';
import { matchGrid, craftResult, consumeCraft } from '../src/crafting';
import { Furnaces, SMELT } from '../src/furnace';
import { Inventory, CRAFT_START, ARMOR_START } from '../src/inventory';
import {
  dropFor, Item, ItemStack, ITEMS, miningStats, armorPointsOf, armorLevel,
  ARMOR_MAX_LEVEL,
} from '../src/items';
import { ItemEntities, itemGeometry } from '../src/itementity';
import { computeLight } from '../src/light';
import { buildChunkGeometry, stairBoxes, TintSampler } from '../src/mesher';
import { Mobs, MOB_DEFS } from '../src/mobs';
import { Particles } from '../src/particles';
import { raycastBlocks } from '../src/interact';
import { Player } from '../src/player';
import { daylight } from '../src/sky';
import { Survival } from '../src/survival';
import { GameServer } from '../src/net/server_core';
import { MELEE_DAMAGE, mitigate, RANGED_MAX_RANGE } from '../src/net/protocol';
import {
  Machines, MachineType, MAX_LEVEL, allowedFilterMask, applyUpgrade,
  autominerRates, claimMachine, collectMachine, currentRate, damageMachine,
  derrickRate, filterTierMax, machineHeight, machineMaxHp, machineTypeForBlock,
  newMachine, productionRate, sanitizeState, setFilter, storageCap, tickMachine,
  totalStored, upgradeCost,
} from '../src/machines';
import {
  Ships, applyShipUpgrade, blockAtWorld, blockWorldPos, cannonCount, damageShip,
  deckHeightAt, floodFillHull, hullRadius, isHullBlock, newShip, sanitizeShipState,
  shipMaxHp, shipSpeed, shipUpgradeCost, tickShip, worldToLocalOffset,
  MAX_SHIP_BLOCKS, SHIP_MAX_LEVEL,
} from '../src/ships';
import {
  applyTurretUpgrade, claimTurret, damageTurret, newTurret, sanitizeTurretState,
  turretArmed, turretDamage, turretLoad, turretRange, turretUpgradeCost,
  TURRET_MAX_LEVEL,
} from '../src/turrets';
import {
  deriveControlNodes, resolveNode, topScores, TERRITORY_TARGET_SCORE, MAX_NODES,
} from '../src/territory';
import { mulberry32 } from '../src/noise';
import { AUTOMINER_ORES, Terrain, SEA_LEVEL } from '../src/terrain';
import { Biome } from '../src/biomes';
import { World } from '../src/world';
import type { Atlas } from '../src/textures';

let failures = 0;
function check(name: string, cond: boolean, detail = ''): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!cond) failures++;
}

const fakeAtlas: Atlas = {
  texture: null as unknown as Atlas['texture'],
  canvas: null as unknown as HTMLCanvasElement,
  uvRect: () => [0, 0, 1, 1],
};
const whiteTints: TintSampler = () => ({ grass: [1, 1, 1], foliage: [1, 1, 1] });
const fullbright = { sky: () => 15, block: () => 0 };

const IDLE_INPUT = {
  mouseDX: 0, mouseDY: 0, forward: false, back: false, left: false,
  right: false, jump: false, sneak: false, sprintKey: false, sprintHeld: false,
};

const terrain = new Terrain(1337);

// --- Light engine ----------------------------------------------------------------
{
  const inRoom = (x: number, y: number, z: number) =>
    x >= 10 && x <= 14 && z >= 10 && z <= 14 && y >= 12 && y <= 14;
  const solidExceptRoom = (x: number, y: number, z: number) =>
    y < 20 && !inRoom(x, y, z) ? Block.Stone : Block.Air;
  const room = computeLight({
    minX: 0, minZ: 0, sizeX: 32, sizeZ: 32, height: 40,
    getBlock: solidExceptRoom, emitters: [],
  });
  check('sealed room gets no skylight', room.sky(12, 13, 12) === 0);
  check('open sky is full 15', room.sky(12, 30, 12) === 15);

  const lit = computeLight({
    minX: 0, minZ: 0, sizeX: 32, sizeZ: 32, height: 40,
    getBlock: solidExceptRoom, emitters: [[12, 13, 12, 14]],
  });
  check('torch lights its cell at 14 and decays 1/block',
    lit.block(12, 13, 12) === 14 && lit.block(14, 13, 12) === 12);
  check('opaque walls stop block light', lit.block(20, 13, 12) === 0);

  const over = computeLight({
    minX: 0, minZ: 0, sizeX: 32, sizeZ: 32, height: 40,
    getBlock: (x, y) => (y === 20 && x <= 15 ? Block.Stone : Block.Air),
    emitters: [],
  });
  check('skylight spreads under an overhang with decay',
    over.sky(15, 19, 12) === 14 && over.sky(10, 19, 12) === 9);
}

// --- Day/night curve --------------------------------------------------------------
check('daylight: noon full, midnight moonlit floor, dawn between',
  daylight(0.25) === 1 && daylight(0.75) === 0.22 &&
  daylight(0) > 0.22 && daylight(0) < 1);

// --- Drop table (VOXELON: no apples/food) -----------------------------------------
{
  check('stone->cobble, grass->dirt',
    dropFor(Block.Stone, 0.5)?.id === Block.Cobblestone &&
    dropFor(Block.Grass, 0.5)?.id === Block.Dirt);
  check('ores drop coal/redstone/diamond',
    dropFor(Block.CoalOre, 0.5)?.id === Item.Coal &&
    dropFor(Block.RedstoneOre, 0.5)!.count >= 4 &&
    dropFor(Block.DiamondOre, 0.5)?.id === Item.Diamond);
  check('unharvested stone drops nothing', dropFor(Block.Stone, 0.5, false) === null);
  let sticks = 0, other = 0;
  for (let i = 0; i < 10000; i++) {
    const d = dropFor(Block.Leaves, i / 10000);
    if (d?.id === Item.Stick) sticks++;
    else if (d) other++;
  }
  check('leaves drop only occasional sticks (no apples)',
    sticks === 250 && other === 0, `sticks=${sticks} other=${other}`);
}

// --- Inventory ops ----------------------------------------------------------------
{
  const inv = new Inventory();
  check('add splits into max stacks',
    inv.add(Block.Dirt, 70) === 0 &&
    inv.slots[0]?.count === 64 && inv.slots[1]?.count === 6);
  inv.leftClick(0);
  check('left click picks up the stack', inv.cursor?.count === 64 && !inv.slots[0]);
  inv.rightClick(2);
  check('right click places one', inv.slots[2]?.count === 1 && inv.cursor?.count === 63);
  inv.leftClick(1);
  check('left click merges same-id', inv.slots[1]?.count === 64 && inv.cursor?.count === 5);
  inv.leftClick(3); inv.shiftClick(3);
  check('shift click moves to main',
    !inv.slots[3] && inv.slots.slice(9, 36).some((s) => s?.id === Block.Dirt));
  const full = new Inventory();
  for (let i = 0; i < 36; i++) full.add(Block.Stone, 64);
  check('full inventory rejects other items',
    !full.canAccept(Block.Dirt) && full.add(Block.Dirt, 1) === 1);
}

// --- Crafting (no swords) ---------------------------------------------------------
{
  const g = (cells: Record<number, number>): (ItemStack | null)[] => {
    const out: (ItemStack | null)[] = new Array(9).fill(null);
    for (const [i, id] of Object.entries(cells)) out[Number(i)] = { id, count: 1 };
    return out;
  };
  check('log -> 4 planks (per-wood)', matchGrid(g({ 4: Block.BirchLog }))?.id === Block.BirchPlanks);
  check('planks -> sticks', matchGrid(g({ 1: Block.OakPlanks, 4: Block.OakPlanks }))?.id === Item.Stick);
  check('2x2 planks -> table',
    matchGrid(g({ 4: Block.OakPlanks, 5: Block.OakPlanks, 7: Block.OakPlanks, 8: Block.OakPlanks }))?.id === Block.CraftingTable);
  check('cobble ring -> furnace',
    matchGrid(g({ 0: Block.Cobblestone, 1: Block.Cobblestone, 2: Block.Cobblestone, 3: Block.Cobblestone, 5: Block.Cobblestone, 6: Block.Cobblestone, 7: Block.Cobblestone, 8: Block.Cobblestone }))?.id === Block.Furnace);
  check('coal/charcoal over stick -> torches',
    matchGrid(g({ 1: Item.Coal, 4: Item.Stick }))?.id === Block.Torch &&
    matchGrid(g({ 1: Item.Charcoal, 4: Item.Stick }))?.id === Block.Torch);
  check('wooden pickaxe pattern',
    matchGrid(g({ 0: Block.OakPlanks, 1: Block.OakPlanks, 2: Block.OakPlanks, 4: Item.Stick, 7: Item.Stick }))?.id === Item.WoodenPickaxe);
  check('axe matches mirrored',
    matchGrid(g({ 0: Block.OakPlanks, 1: Block.OakPlanks, 3: Item.Stick, 4: Block.OakPlanks, 6: Item.Stick }))?.id === Item.WoodenAxe);
  check('iron tools craft from ingots',
    matchGrid(g({ 0: Item.IronIngot, 1: Item.IronIngot, 2: Item.IronIngot, 4: Item.Stick, 7: Item.Stick }))?.id === Item.IronPickaxe);
  // No swords in VOXELON: the classic sword pattern yields nothing.
  check('sword recipe removed',
    matchGrid(g({ 1: Block.OakPlanks, 4: Block.OakPlanks, 7: Item.Stick })) === null);

  const inv = new Inventory();
  inv.slots[CRAFT_START + 4] = { id: Block.OakLog, count: 2 };
  const r = craftResult(inv);
  consumeCraft(inv);
  check('craftResult + consumeCraft on inventory cells',
    r?.id === Block.OakPlanks && inv.slots[CRAFT_START + 4]?.count === 1);
}

// --- Mining + tool durability -----------------------------------------------------
{
  const pick = (id: number): ItemStack => ({ id, count: 1 });
  check('stone by hand: 5x penalty, no harvest', (() => {
    const s = miningStats(BLOCKS[Block.Stone], null);
    return Math.abs(s.time - 7.5) < 1e-9 && !s.harvest;
  })());
  check('wooden pickaxe mines stone fast + harvests', (() => {
    const s = miningStats(BLOCKS[Block.Stone], pick(Item.WoodenPickaxe));
    return Math.abs(s.time - 1.125) < 1e-9 && s.harvest;
  })());
  check('iron ore needs stone tier; diamond needs iron tier',
    !miningStats(BLOCKS[Block.IronOre], pick(Item.WoodenPickaxe)).harvest &&
    !miningStats(BLOCKS[Block.DiamondOre], pick(Item.StonePickaxe)).harvest &&
    miningStats(BLOCKS[Block.DiamondOre], pick(Item.IronPickaxe)).harvest);
  const inv = new Inventory();
  inv.add(Item.WoodenPickaxe, 1);
  inv.slots[0]!.damage = 58;
  inv.damageSelected(1);
  check('tools break at zero durability', inv.slots[0] === null);
}

// --- Energy / stamina (replaces hunger) -------------------------------------------
{
  const player = new Player(terrain.findSpawn());
  const sprint = { ...IDLE_INPUT, forward: true, sprintHeld: true } as never;
  const idle = { ...IDLE_INPUT } as never;
  const world0 = new World(new THREE.Scene(), fakeAtlas, 1337);
  // Hold sprint ~31s. The bar self-balances (drain, exhaust, brief recover,
  // sprint again), so check that it reaches empty and exhausts at some point.
  let everExhausted = false, minEnergy = 1;
  for (let i = 0; i < 31 / (1 / 20); i++) {
    player.update(1 / 20, sprint, world0);
    everExhausted = everExhausted || player.exhausted;
    minEnergy = Math.min(minEnergy, player.energy);
  }
  check('sprinting drains energy to empty (exhausts you)',
    minEnergy === 0 && everExhausted, `min=${minEnergy.toFixed(2)}`);

  // Forced-exhausted: holding sprint must not sprint.
  player.energy = 0; player.exhausted = true;
  player.update(1 / 20, sprint, world0);
  check('cannot sprint while exhausted', !player.sprinting);

  // Refill from empty clears exhaustion and restores the bar.
  player.energy = 0; player.exhausted = true;
  for (let i = 0; i < 5 / (1 / 20); i++) player.update(1 / 20, idle, world0);
  check('energy refills and exhausted clears',
    player.energy > 0.5 && !player.exhausted, `energy=${player.energy.toFixed(2)}`);
}

// --- Survival: passive regen + drowning -------------------------------------------
{
  const mk = () => ({
    health: 10, air: 15, eyeUnderwater: false, dead: false, regenCooldown: 0,
    damage(n: number) {
      this.health = Math.max(0, this.health - n);
      this.regenCooldown = 3; // mirror Player.damage: pauses regen after a hit
      if (this.health <= 0) this.dead = true;
    },
  });
  const a = mk();
  const sa = new Survival();
  for (let i = 0; i < 10; i++) sa.update(1, a);
  check('passive health regen heals when out of combat', a.health > 10, `hp=${a.health}`);

  const b = mk();
  b.regenCooldown = 100; // recently hurt -> no regen yet
  const sb = new Survival();
  for (let i = 0; i < 10; i++) sb.update(1, b);
  check('no regen during post-damage cooldown', b.health === 10);

  const d = mk();
  d.eyeUnderwater = true;
  const sd = new Survival();
  for (let i = 0; i < 18; i++) sd.update(1, d);
  check('drowning after air runs out', d.air === 0 && d.health < 10);
  d.eyeUnderwater = false;
  sd.update(1, d);
  check('air refills out of water', d.air > 3);

  const inv = new Inventory();
  inv.add(Block.Dirt, 10); inv.add(Item.Diamond, 3);
  check('death spills the whole inventory',
    new Inventory() && (() => {
      const spilled = inv.spillAll();
      return spilled.length === 2 && inv.slots.every((s) => s === null);
    })());
}

// --- Biomes + mountains -----------------------------------------------------------
const biomeChunk = new Map<Biome, [number, number]>();
for (let cx = -120; cx <= 120; cx++) {
  for (let cz = -120; cz <= 120; cz++) {
    if (biomeChunk.size >= 9) break;
    const x = cx * 16 + 8, z = cz * 16 + 8;
    const b = terrain.biomeWithWater(x, z, terrain.height(x, z));
    if (!biomeChunk.has(b)) biomeChunk.set(b, [cx, cz]);
  }
}
check('biome map produces >= 5 biomes',
  biomeChunk.size >= 5,
  [...biomeChunk.keys()].map((b) => BIOME_NAMES[b]).join(', '));
check('desert and snowy biomes exist',
  biomeChunk.has(Biome.Desert) && biomeChunk.has(Biome.Snowy));
check('mountain biome(s) exist',
  biomeChunk.has(Biome.Mountains) || biomeChunk.has(Biome.SnowyMountains));
check('height function bounded to the new range', (() => {
  for (let i = 0; i < 4000; i++) {
    const h = terrain.height(i * 37 - 60000, i * 91 - 90000);
    if (h < 12 || h > 235) return false;
  }
  return true;
})());
check('mountains actually rise tall (some column > 150)', (() => {
  let max = 0;
  for (let i = 0; i < 60000; i++) {
    max = Math.max(max, terrain.height((i * 53) % 4000 - 2000, (i * 97) % 4000 - 2000));
    if (max > 150) return true;
  }
  return max > 150;
})());

function scanBiome(b: Biome): Map<number, number> | null {
  const home = biomeChunk.get(b);
  if (!home) return null;
  const counts = new Map<number, number>();
  for (let dx = -1; dx <= 1; dx++) {
    for (let dz = -1; dz <= 1; dz++) {
      const c = new Chunk(home[0] + dx, home[1] + dz);
      terrain.fill(c);
      for (let i = 0; i < c.data.length; i++) {
        const id = c.data[i];
        if (id) counts.set(id, (counts.get(id) ?? 0) + 1);
      }
    }
  }
  return counts;
}
const n = (m: Map<number, number> | null, b: number) => m?.get(b) ?? 0;
const desert = scanBiome(Biome.Desert);
check('desert has sand + sandstone + cacti',
  n(desert, Block.Sand) > 500 && n(desert, Block.Sandstone) > 500 &&
  n(desert, Block.Cactus) > 0);
const snowy = scanBiome(Biome.Snowy);
check('snowy biome has snowy grass + spruce',
  n(snowy, Block.SnowyGrass) > 100 && n(snowy, Block.SpruceLog) > 0);
const mtn = scanBiome(Biome.SnowyMountains) ?? scanBiome(Biome.Mountains);
check('mountain biome has stone surface and/or snow caps',
  (n(mtn, Block.Stone) > 5000) && (n(mtn, Block.SnowyGrass) > 0 || n(mtn, Block.Grass) > 0));

// --- Ores + caves (no cheese caverns; spaghetti still carve) -----------------------
{
  const all = new Map<number, number>();
  let air = 0, total = 0, depthViolations = 0;
  const oreMax: [Block, number][] = [
    [Block.IronOre, 72], [Block.GoldOre, 32], [Block.RedstoneOre, 16], [Block.DiamondOre, 16],
  ];
  for (let cx = 0; cx < 4; cx++) {
    for (let cz = 0; cz < 4; cz++) {
      const c = new Chunk(cx, cz);
      terrain.fill(c);
      for (let x = 0; x < 16; x++)
        for (let z = 0; z < 16; z++)
          for (let y = 0; y < 130; y++) {
            const id = c.get(x, y, z);
            if (id) all.set(id, (all.get(id) ?? 0) + 1);
            if (y >= 8 && y <= 45) { total++; if (id === Block.Air) air++; }
            for (const [ore, mx] of oreMax) if (id === ore && y > mx) depthViolations++;
          }
    }
  }
  const a = (b: number) => all.get(b) ?? 0;
  check('all 5 ores generate',
    a(Block.CoalOre) > 0 && a(Block.IronOre) > 0 && a(Block.GoldOre) > 0 &&
    a(Block.RedstoneOre) > 0 && a(Block.DiamondOre) > 0);
  check('ore depth ranges respected', depthViolations === 0);
  check('spaghetti caves still carve air', air / total > 0.01, `${(air / total * 100).toFixed(1)}%`);
}

// determinism
{
  const a = new Chunk(0, 0); terrain.fill(a);
  const b = new Chunk(0, 0); terrain.fill(b);
  check('terrain is deterministic', a.data.every((v, i) => v === b.data[i]));
}

// --- World streaming + meshing + tints --------------------------------------------
const scene = new THREE.Scene();
const world = new World(scene, fakeAtlas, 1337);
const spawn = world.terrain.findSpawn();
check('spawn above sea level', spawn.y > SEA_LEVEL);
let safety = 0;
while (!world.update(spawn.x, spawn.z, 1000) && safety++ < 100) { /* stream */ }
check('world streams to completion', safety < 100);
check('scene has chunk meshes', scene.children.length > 50);
{
  const home = biomeChunk.get(Biome.Plains) ?? [0, 0];
  const chunk = new Chunk(home[0], home[1]);
  terrain.fill(chunk);
  const geo = buildChunkGeometry(chunk,
    (x, y, z) => {
      const lx = x - home[0] * 16, lz = z - home[1] * 16;
      return lx >= 0 && lx < 16 && lz >= 0 && lz < 16 ? chunk.get(lx, y, lz) : 0;
    }, fakeAtlas, whiteTints, fullbright);
  check('mesher emits opaque geometry', !!geo.opaque);
  const colors = geo.opaque!.getAttribute('color');
  let darks = 0, brights = 0;
  for (let i = 0; i < colors.count; i++) (colors.getX(i) >= 0.99 ? brights++ : darks++);
  check('mesh has directional/AO shading variation', darks > 0 && brights > 0);
}
{
  const pcx = Math.floor(spawn.x) >> 4, pcz = Math.floor(spawn.z) >> 4;
  const mesh = world.getChunk(pcx, pcz)!.opaqueMesh!;
  const colors = mesh.geometry.getAttribute('color');
  let tinted = 0;
  for (let i = 0; i < colors.count; i++)
    if (Math.abs(colors.getX(i) - colors.getY(i)) > 0.02) tinted++;
  check('world meshes carry biome-tinted vertex colors', tinted > 0);
  const sb = mesh.geometry.getAttribute('skyblock');
  check('chunk meshes carry the skyblock light attribute',
    !!sb && sb.itemSize === 2);
}

// --- Raycast ----------------------------------------------------------------------
{
  const origin = new THREE.Vector3(spawn.x, spawn.y + 1.62, spawn.z);
  const down = raycastBlocks(world, origin, new THREE.Vector3(0, -1, 0), 4.5);
  check('raycast down hits ground with top-face normal', !!down && down.ny === 1);
}

// --- Physics + edits --------------------------------------------------------------
{
  const player = new Player({ x: spawn.x, y: spawn.y + 5, z: spawn.z });
  const idle = { ...IDLE_INPUT } as never;
  for (let i = 0; i < 600; i++) player.update(1 / 120, idle, world);
  check('player falls and lands', player.onGround &&
    Math.abs(player.pos.y - Math.round(player.pos.y)) < 0.01);

  const jump = { ...IDLE_INPUT, jump: true } as never;
  const startY = player.pos.y;
  let apex = startY;
  for (let i = 0; i < 240; i++) {
    player.update(1 / 120, i === 0 ? jump : idle, world);
    apex = Math.max(apex, player.pos.y);
  }
  check('jump apex ~1.25 blocks', Math.abs(apex - startY - 1.25) < 0.06);

  const bx = Math.floor(player.pos.x), bz = Math.floor(player.pos.z);
  const by = Math.floor(player.pos.y) - 1;
  world.setBlock(bx, by, bz, Block.Air);
  check('setBlock edits world', world.getBlock(bx, by, bz) === Block.Air);
  world.setBlock(bx, by, bz, Block.Cobblestone);
  world.setBlock(bx, by + 1, bz, Block.TallGrass);
  world.setBlock(bx, by, bz, Block.Air);
  check('breaking support pops the plant above', world.getBlock(bx, by + 1, bz) === Block.Air);
  world.setBlock(bx, by, bz, Block.Grass);
}

// --- Held first-person block geometry (top-face fix) ------------------------------
{
  const grass = itemGeometry(fakeAtlas, Block.Grass);
  const pos = grass.getAttribute('position');
  const col = grass.getAttribute('color');
  check('held cube has 6 upright faces (24 verts) with colors',
    pos.count === 24 && !!col && col.count === 24);
  // Face order in buildCubeGeometry: top(0-3, shade 1), bottom(4-7, shade .5).
  check('held cube top face is full-bright and grass-tinted',
    Math.abs(col.getX(0) - 0.57) < 0.02 && Math.abs(col.getY(0) - 0.74) < 0.02,
    `top rgb=${col.getX(0).toFixed(2)},${col.getY(0).toFixed(2)},${col.getZ(0).toFixed(2)}`);
  const stone = itemGeometry(fakeAtlas, Block.Stone);
  const sc = stone.getAttribute('color');
  check('held cube applies vanilla face shading (top 1.0, bottom 0.5)',
    Math.abs(sc.getX(0) - 1.0) < 0.02 && Math.abs(sc.getX(4) - 0.5) < 0.02);
}

// --- materialOf -------------------------------------------------------------------
check('materialOf maps blocks to sound classes',
  materialOf(Block.Stone) === 'stone' && materialOf(Block.OakLog) === 'wood' &&
  materialOf(Block.Sand) === 'sand' && materialOf(Block.Glass) === 'glass' &&
  materialOf(Block.Grass) === 'grass');

// --- Item entities ----------------------------------------------------------------
{
  let px = spawn.x, pz = spawn.z;
  outer: for (let dx = 0; dx < 16; dx++)
    for (let dz = 0; dz < 16; dz++) {
      const x = Math.floor(spawn.x) + dx, z = Math.floor(spawn.z) + dz;
      const h = world.terrain.height(x, z);
      if (h <= SEA_LEVEL + 1) continue;
      let clear = true;
      for (let y = h + 1; y <= h + 8; y++) if (world.getBlock(x, y, z) !== Block.Air) clear = false;
      if (clear) { px = x + 0.5; pz = z + 0.5; break outer; }
    }
  const ground = world.terrain.height(Math.floor(px), Math.floor(pz));
  const inv = new Inventory();
  const ents = new ItemEntities(scene, world, fakeAtlas);
  const far = new Player({ x: px + 30, y: ground + 1, z: pz });
  for (let i = 0; i < 5; i++) ents.spawn(px, ground + 3, pz, Block.Dirt, 1);
  for (let i = 0; i < 160; i++) ents.update(0.05, far, inv, 1);
  check('nearby identical drops merge', ents.count < 5 && ents.count >= 1);
  const near = new Player({ x: px, y: ground + 1, z: pz });
  for (let i = 0; i < 80; i++) ents.update(0.05, near, inv, 1);
  check('drops magnet to player and get picked up',
    ents.count === 0 && inv.slots[0]?.id === Block.Dirt && inv.slots[0]?.count === 5);
}

// --- Mobs (hostile only): models, physics, AI, combat, explosion ------------------
{
  let mx = Math.floor(spawn.x), mz = Math.floor(spawn.z);
  outerM: for (let dx = 0; dx < 20; dx++)
    for (let dz = 0; dz < 20; dz++) {
      const x = Math.floor(spawn.x) + dx, z = Math.floor(spawn.z) + dz;
      const h = world.terrain.height(x, z);
      if (h <= SEA_LEVEL + 1) continue;
      let clear = true;
      for (let y = h + 1; y <= h + 10; y++) if (world.getBlock(x, y, z) !== Block.Air) clear = false;
      if (clear) { mx = x; mz = z; break outerM; }
    }
  const ground = world.terrain.height(mx, mz);
  const newMobs = () => {
    const m = new Mobs(scene, world, fakeAtlas,
      new ItemEntities(scene, world, fakeAtlas), new Particles(scene));
    m.spawningEnabled = false;
    return m;
  };

  check('only hostile mob types exist',
    Object.keys(MOB_DEFS).sort().join(',') === 'creeper,zombie');

  const modelMobs = newMobs();
  let ok = true;
  for (const t of ['zombie', 'creeper'] as const) {
    const m = modelMobs.spawnAt(t, mx + 0.5, ground + 4, mz + 0.5);
    if (m.model.legs.length < 2 || !m.model.group) ok = false;
  }
  check('zombie + creeper build models with legs', ok && modelMobs.list.length === 2);

  const physMobs = newMobs();
  const z0 = physMobs.spawnAt('zombie', mx + 0.5, ground + 4, mz + 0.5);
  const idlePlayer = new Player({ x: mx + 30, y: ground + 1, z: mz });
  let grounded = false, minY = Infinity;
  for (let i = 0; i < 240; i++) {
    physMobs.update(1 / 60, idlePlayer, 0);
    grounded = grounded || z0.onGround;
    minY = Math.min(minY, z0.pos.y);
  }
  check('mob falls, is stopped by collision, never sinks',
    grounded && minY > ground - 3);

  const chaseMobs = newMobs();
  const zc = chaseMobs.spawnAt('zombie', mx + 6.5, ground + 1, mz + 0.5);
  const target = new Player({ x: mx + 0.5, y: ground + 1, z: mz + 0.5 });
  const d0 = zc.pos.distanceTo(target.pos);
  for (let i = 0; i < 120; i++) chaseMobs.update(1 / 60, target, 0);
  check('zombie chases the player and closes distance',
    zc.pos.distanceTo(target.pos) < d0 - 1 && zc.state === 'chase');

  const combatItems = new ItemEntities(scene, world, fakeAtlas);
  const combat = new Mobs(scene, world, fakeAtlas, combatItems, new Particles(scene));
  combat.spawningEnabled = false;
  const z1 = combat.spawnAt('zombie', mx + 0.5, ground + 1, mz + 2.5);
  const origin = new THREE.Vector3(mx + 0.5, ground + 2.0, mz + 0.5);
  const dir = new THREE.Vector3(0, 0, 1);
  const hp0 = z1.health;
  const hit = combat.attack(origin, dir, 4, new Player({ x: mx + 0.5, y: ground + 1, z: mz + 0.5 }));
  check('melee attack hits mob in crosshair and deals damage',
    hit && z1.health === hp0 - 4);
  z1.pos.set(mx + 0.5, ground + 1, mz + 2.5);
  z1.health = 1;
  combat.attack(origin, dir, 4, idlePlayer);
  check('killing a hostile removes it (drops nothing)',
    !combat.list.includes(z1) && combatItems.count === 0);
}

// --- Creeper explosion (high in the air, away from terrain) -----------------------
{
  const ex = Math.floor(spawn.x) + 2, ez = Math.floor(spawn.z) + 2, ey = 200;
  for (let dx = -2; dx <= 2; dx++)
    for (let dy = -2; dy <= 2; dy++)
      for (let dz = -2; dz <= 2; dz++)
        world.setBlock(ex + dx, ey + dy, ez + dz, Block.Stone);
  const particles = new Particles(scene);
  const mobs = new Mobs(scene, world, fakeAtlas, new ItemEntities(scene, world, fakeAtlas), particles);
  mobs.spawningEnabled = false;
  const victim = new Player({ x: ex + 0.5, y: ey - 0.5, z: ez + 0.5 });
  const hp = victim.health;
  mobs.explode(new THREE.Vector3(ex + 0.5, ey + 0.5, ez + 0.5), victim);
  let cleared = 0;
  for (let dx = -1; dx <= 1; dx++)
    for (let dy = -1; dy <= 1; dy++)
      for (let dz = -1; dz <= 1; dz++)
        if (world.getBlock(ex + dx, ey + dy, ez + dz) === Block.Air) cleared++;
  check('explosion carves a crater', cleared >= 20);
  check('explosion damages a nearby player + spawns particles',
    victim.health < hp && particles.count > 0);
  for (let dx = -2; dx <= 2; dx++)
    for (let dy = -2; dy <= 2; dy++)
      for (let dz = -2; dz <= 2; dz++)
        world.setBlock(ex + dx, ey + dy, ez + dz, Block.Air);
}

// --- Mob regression fixes (geometry dispose, idempotent removal, fuse, cull) ------
{
  const ax = Math.floor(spawn.x), az = Math.floor(spawn.z), ay = 205;
  const newMobs = () => {
    const m = new Mobs(scene, world, fakeAtlas,
      new ItemEntities(scene, world, fakeAtlas), new Particles(scene));
    m.spawningEnabled = false;
    return m;
  };
  {
    const mobs = newMobs();
    const m = mobs.spawnAt('zombie', ax + 0.5, ay, az + 0.5);
    const geos: THREE.BufferGeometry[] = [];
    m.model.group.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.geometry) geos.push(mesh.geometry);
    });
    let disposed = 0;
    for (const gmt of geos) { const orig = gmt.dispose.bind(gmt); gmt.dispose = () => { disposed++; orig(); }; }
    mobs.explode(new THREE.Vector3(ax + 0.5, ay, az + 0.5), new Player({ x: ax + 200, y: ay, z: az }));
    check('removing a mob disposes all its geometries',
      geos.length >= 4 && disposed === geos.length);
  }
  {
    const mobs = newMobs();
    const a = mobs.spawnAt('creeper', ax + 0.5, ay, az + 0.5);
    const b = mobs.spawnAt('zombie', ax + 1.0, ay, az + 0.5);
    mobs.explode(new THREE.Vector3(ax + 0.5, ay, az + 0.5), new Player({ x: ax + 200, y: ay, z: az }));
    check('explosion removes nearby mobs exactly once',
      !mobs.list.includes(a) && !mobs.list.includes(b) && mobs.list.length === 0 &&
      a.removed && b.removed);
  }
  {
    const mobs = newMobs();
    const creeper = mobs.spawnAt('creeper', ax + 2.5, ay, az + 0.5);
    const close = new Player({ x: ax + 0.5, y: ay, z: az + 0.5 });
    for (let i = 0; i < 6; i++) mobs.update(1 / 60, close, 0);
    const primed = creeper.fuse > 0 && creeper.fuseStarted;
    const escaped = new Player({ x: ax + 60, y: ay, z: az });
    for (let i = 0; i < 30; i++) mobs.update(1 / 60, escaped, 0);
    check('creeper fuse winds down once the player escapes',
      primed && creeper.fuse === 0 && !creeper.fuseStarted && mobs.list.includes(creeper));
  }
  {
    const mobs = newMobs();
    const fy = 210;
    for (let dx = -1; dx <= 1; dx++)
      for (let dz = -1; dz <= 1; dz++) world.setBlock(ax + dx, fy, az + dz, Block.Stone);
    const z = mobs.spawnAt('zombie', ax + 0.5, fy + 8, az + 0.5);
    z.vel.y = -80;
    const far = new Player({ x: ax + 20, y: fy, z: az });
    let landed = false;
    for (let i = 0; i < 60 && !landed; i++) { mobs.update(0.05, far, 0); if (z.onGround) landed = true; }
    check('fast-falling mob lands on a thin floor (no tunnel)',
      landed && z.pos.y >= fy + 1 - 0.05);
    for (let dx = -1; dx <= 1; dx++)
      for (let dz = -1; dz <= 1; dz++) world.setBlock(ax + dx, fy, az + dz, Block.Air);
  }
  {
    const mobs = newMobs();
    const z = mobs.spawnAt('zombie', ax + 0.5, ay, az + 0.5);
    z.pos.y = -20;
    mobs.update(1 / 60, new Player({ x: ax + 4, y: 0, z: az }), 1);
    check('mob that falls out of the world is culled',
      !mobs.list.includes(z) && z.removed);
  }
  {
    // Zombie burns in daylight with sky access.
    let cx = Math.floor(spawn.x), cz = Math.floor(spawn.z);
    outerB: for (let dx = 0; dx < 24; dx++)
      for (let dz = 0; dz < 24; dz++) {
        const x = Math.floor(spawn.x) + dx, zz = Math.floor(spawn.z) + dz;
        if (world.hasSkyAccess(x, world.terrain.height(x, zz) + 2, zz)) { cx = x; cz = zz; break outerB; }
      }
    const cg = world.terrain.height(cx, cz);
    const mobs = newMobs();
    const z = mobs.spawnAt('zombie', cx + 0.5, cg + 1, cz + 0.5);
    const farP = new Player({ x: cx + 40, y: cg + 1, z: cz });
    const hp0 = z.health;
    for (let i = 0; i < 240; i++) mobs.update(1 / 60, farP, 1);
    check('zombie burns in direct sunlight', z.health < hp0);
  }
}

// --- Water climb-out fix ----------------------------------------------------------
{
  // Build, well above terrain: a stone floor, a 1-tall water cell, and a
  // 1-block stone ledge beside it with air above. Player swims into the ledge
  // holding jump and should hop up onto it.
  const wx = Math.floor(spawn.x) + 1, wz = Math.floor(spawn.z) + 1, yb = 248;
  for (let dx = -1; dx <= 2; dx++)
    for (let dz = -1; dz <= 1; dz++) world.setBlock(wx + dx, yb, wz + dz, Block.Stone);
  world.setBlock(wx, yb + 1, wz, Block.Water);   // water cell the player floats in
  world.setBlock(wx + 1, yb + 1, wz, Block.Stone); // the ledge to climb onto
  const player = new Player({ x: wx + 0.5, y: yb + 1, z: wz + 0.5 });
  player.yaw = -Math.PI / 2; // face +x toward the ledge
  const swimIn = { ...IDLE_INPUT, forward: true, jump: true } as never;
  let climbed = false;
  for (let i = 0; i < 120 && !climbed; i++) {
    player.update(1 / 60, swimIn, world);
    if (player.pos.y >= yb + 2 - 0.05) climbed = true;
  }
  check('player can climb out of water onto a ledge',
    climbed, `y=${player.pos.y.toFixed(2)} (ledge top=${yb + 2})`);
  for (let dx = -1; dx <= 2; dx++)
    for (let dy = 0; dy <= 1; dy++)
      for (let dz = -1; dz <= 1; dz++) world.setBlock(wx + dx, yb + dy, wz + dz, Block.Air);
}

// --- SMELT sanity (no meat entries) -----------------------------------------------
check('furnace smelts ore/sand/log but not removed foods',
  SMELT[Block.IronOre] === Item.IronIngot && SMELT[Block.Sand] === Block.Glass &&
  SMELT[Block.OakLog] === Item.Charcoal);

// --- Multiplayer server core (pure, no sockets) -----------------------------------
{
  const g = new GameServer(1337, mulberry32(123));
  const outA = g.addPlayer(1);
  const wA = outA.find((o) => o.to === 1)!.msg;
  check('addPlayer welcomes with seed + self in roster',
    wA.t === 'welcome' && wA.seed === 1337 && wA.players.length === 1 &&
    wA.id === 1 && typeof wA.username === 'string',
    wA.t === 'welcome' ? `user=${wA.username}` : '');
  check('join is broadcast to others',
    outA.some((o) => o.to === 'others' && o.msg.t === 'join'));

  // Unique usernames across many joins.
  for (let id = 2; id <= 8; id++) g.addPlayer(id);
  const names = g.snapshot().length;
  const usernames = new Set(
    (g.addPlayer(99).find((o) => o.to === 99)!.msg as { players: { username: string }[] })
      .players.map((p) => p.username)
  );
  check('usernames are unique across players',
    usernames.size === 9 && names === 8, `${usernames.size} unique`);

  // Position two players adjacent and test server-validated melee.
  const fresh = new GameServer(1337, mulberry32(7));
  fresh.addPlayer(1); fresh.addPlayer(2);
  fresh.handle(1, { t: 'xform', x: 0, y: 70, z: 0, yaw: Math.PI, pitch: 0 });
  fresh.handle(2, { t: 'xform', x: 0, y: 70, z: 2, yaw: 0, pitch: 0 });
  const atk = fresh.handle(1, { t: 'attack', target: 2 });
  const hurt = atk.find((o) => o.to === 2)?.msg;
  check('valid melee hit applies server damage + knockback',
    !!hurt && hurt.t === 'hurt' && hurt.health === 20 - MELEE_DAMAGE,
    hurt && hurt.t === 'hurt' ? `hp=${hurt.health}` : 'no hurt');

  // Out of range -> rejected.
  fresh.handle(2, { t: 'xform', x: 0, y: 70, z: 30, yaw: 0, pitch: 0 });
  check('out-of-range attack is rejected',
    fresh.handle(1, { t: 'attack', target: 2 }).length === 0);

  // Edit in range broadcasts; far edit rejected.
  fresh.handle(1, { t: 'xform', x: 0, y: 70, z: 0, yaw: 0, pitch: 0 });
  check('in-range edit broadcasts to all',
    fresh.handle(1, { t: 'edit', x: 1, y: 70, z: 0, block: 3 })
      .some((o) => o.to === 'all' && o.msg.t === 'edit'));
  check('far edit is rejected',
    fresh.handle(1, { t: 'edit', x: 99, y: 70, z: 99, block: 3 }).length === 0);

  // selfhurt + regen.
  const r = new GameServer(1337, mulberry32(9));
  r.addPlayer(1);
  r.handle(1, { t: 'selfhurt', amount: 10 });
  check('selfhurt reduces server health',
    r.snapshot()[0].health === 10);
  for (let i = 0; i < 10; i++) r.tickRegen(1); // past cooldown, several heals
  check('server regenerates health over time', r.snapshot()[0].health > 10,
    `hp=${r.snapshot()[0].health}`);

  // Death + respawn.
  const d = new GameServer(1337, mulberry32(11));
  d.addPlayer(1);
  const lethal = d.handle(1, { t: 'selfhurt', amount: 100 });
  check('lethal damage marks dead + broadcasts killfeed',
    d.snapshot()[0].dead === true &&
    lethal.some((o) => o.to === 'all' && o.msg.t === 'killfeed'));
  const resp = d.handle(1, { t: 'respawn' });
  check('respawn restores full health',
    resp.some((o) => o.msg.t === 'respawned') && d.snapshot()[0].health === 20 &&
    !d.snapshot()[0].dead);

  // Leave broadcasts.
  check('removePlayer broadcasts leave',
    d.removePlayer(1).some((o) => o.msg.t === 'leave'));
}

// --- Server input hardening (review fixes) ----------------------------------------
{
  const s = new GameServer(1337, mulberry32(5));
  s.addPlayer(1);
  s.handle(1, { t: 'xform', x: 0, y: 70, z: 0, yaw: 0, pitch: 0 });
  check('edit rejects an invalid block id',
    s.handle(1, { t: 'edit', x: 1, y: 70, z: 0, block: 99999 }).length === 0);
  check('edit rejects non-finite coords',
    s.handle(1, { t: 'edit', x: NaN, y: 70, z: 0, block: 3 }).length === 0);
  check('non-finite xform is ignored (cannot poison range checks)', (() => {
    s.handle(1, { t: 'xform', x: NaN, y: NaN, z: NaN, yaw: 0, pitch: 0 });
    // Position stayed finite at origin, so a far edit is still rejected.
    return s.handle(1, { t: 'edit', x: 5000, y: 70, z: 5000, block: 3 }).length === 0;
  })());
  s.handle(1, { t: 'selfhurt', amount: 100 });
  check('a dead player cannot edit blocks',
    s.handle(1, { t: 'edit', x: 1, y: 70, z: 0, block: 3 }).length === 0);
}

// --- Networked item entities (drop / pickup) --------------------------------------
{
  const s = new GameServer(1337, mulberry32(31));
  s.addPlayer(1);
  s.handle(1, { t: 'xform', x: 0, y: 70, z: 0, yaw: 0, pitch: 0 });
  const dropOut = s.handle(1, { t: 'drop', items: [{ id: Block.Stone, count: 3 }], x: 0, y: 70, z: 0 });
  const spawnMsg = dropOut.find((o) => o.msg.t === 'itemspawn')?.msg as
    Extract<typeof dropOut[number]['msg'], { t: 'itemspawn' }> | undefined;
  check('drop spawns a broadcast item entity',
    !!spawnMsg && spawnMsg.item.item === Block.Stone && spawnMsg.item.count === 3);
  const eid = spawnMsg!.item.eid;
  check('welcome includes existing item entities', (() => {
    s.addPlayer(2);
    const w = s.addPlayer(3).find((o) => o.to === 3)!.msg as { items: unknown[] };
    return w.items.length >= 1;
  })());
  // Out of range: move far, pickup rejected.
  s.handle(1, { t: 'xform', x: 100, y: 70, z: 100, yaw: 0, pitch: 0 });
  check('out-of-range pickup is rejected',
    s.handle(1, { t: 'pickup', eid }).length === 0);
  // In range: pickup grants the item + broadcasts removal.
  s.handle(1, { t: 'xform', x: 0, y: 70, z: 0, yaw: 0, pitch: 0 });
  const pick = s.handle(1, { t: 'pickup', eid });
  check('in-range pickup grants item + broadcasts removal',
    pick.some((o) => o.to === 1 && o.msg.t === 'gotitem') &&
    pick.some((o) => o.msg.t === 'itemremove'));
  check('a picked-up item is gone (no double pickup)',
    s.handle(1, { t: 'pickup', eid }).length === 0);
  // Dead players can't pick up.
  const d2 = new GameServer(1337, mulberry32(32));
  d2.addPlayer(1);
  d2.handle(1, { t: 'xform', x: 0, y: 70, z: 0, yaw: 0, pitch: 0 });
  const e2 = (d2.handle(1, { t: 'drop', items: [{ id: Block.Dirt, count: 1 }], x: 0, y: 70, z: 0 })
    .find((o) => o.msg.t === 'itemspawn')!.msg as { item: { eid: number } }).item.eid;
  d2.handle(1, { t: 'selfhurt', amount: 100 }); // now dead
  check('dead players cannot pick up items',
    d2.handle(1, { t: 'pickup', eid: e2 }).length === 0);
}

// --- Chests (server-stored, synced) ------------------------------------------------
{
  const s = new GameServer(1337, mulberry32(33));
  s.addPlayer(1);
  s.addPlayer(2);
  // A chest only exists once placed (an edit recording Block.Chest); the server
  // only stores contents for a real chest block.
  s.handle(1, { t: 'xform', x: 5.5, y: 64.5, z: 5.5, yaw: 0, pitch: 0 });
  s.handle(1, { t: 'edit', x: 5, y: 64, z: 5, block: Block.Chest });
  const open1 = s.handle(1, { t: 'chestOpen', x: 5, y: 64, z: 5 });
  const chestMsg = open1.find((o) => o.to === 1)?.msg as
    { t: string; slots: unknown[] } | undefined;
  check('opening an empty chest returns 27 empty slots',
    !!chestMsg && chestMsg.t === 'chest' && chestMsg.slots.length === 27 &&
    chestMsg.slots.every((c) => c === null));
  const slots = new Array(27).fill(null);
  slots[0] = { id: Block.Stone, count: 10 };
  const setOut = s.handle(1, { t: 'chestSet', x: 5, y: 64, z: 5, slots });
  check('chestSet broadcasts the contents to other viewers',
    setOut.some((o) => o.to === 'others' && o.msg.t === 'chest'));
  const open2 = s.handle(2, { t: 'chestOpen', x: 5, y: 64, z: 5 });
  const seen = open2.find((o) => o.to === 2)!.msg as { slots: ({ id: number; count: number } | null)[] };
  check('a second player sees the stored chest contents',
    seen.slots[0]?.id === Block.Stone && seen.slots[0]?.count === 10);

  // Player 2 breaks the chest WITHOUT ever editing it: the server spills the
  // real stored contents (not the breaker's empty cache) and clears storage.
  s.handle(2, { t: 'xform', x: 5.5, y: 64.5, z: 5.5, yaw: 0, pitch: 0 });
  const broke = s.handle(2, { t: 'edit', x: 5, y: 64, z: 5, block: Block.Air });
  const spill = broke.find((o) => o.msg.t === 'itemspawn')?.msg as
    Extract<typeof broke[number]['msg'], { t: 'itemspawn' }> | undefined;
  check('breaking a chest spills its stored contents to everyone',
    !!spill && spill.item.item === Block.Stone && spill.item.count === 10);
  const reopen = s.handle(1, { t: 'chestOpen', x: 5, y: 64, z: 5 });
  const after = reopen.find((o) => o.to === 1)!.msg as { slots: unknown[] };
  check('a broken chest is cleared server-side',
    after.slots.length === 27 && after.slots.every((c) => c === null));

  // A chestSet aimed at a non-chest position is rejected (no phantom storage),
  // so a stale write to a broken/empty location can't resurrect contents.
  const ghost = new Array(27).fill(null);
  ghost[0] = { id: Block.Stone, count: 5 };
  check('chestSet to a non-chest position is rejected',
    s.handle(1, { t: 'chestSet', x: 5, y: 64, z: 5, slots: ghost }).length === 0);
  const verify = s.handle(1, { t: 'chestOpen', x: 5, y: 64, z: 5 })
    .find((o) => o.to === 1)!.msg as { slots: unknown[] };
  check('a rejected chestSet stored nothing', verify.slots.every((c) => c === null));
}

// --- Persistent edit overlay (survives unload/regen; MP welcome replay) ------------
{
  const fx = Math.floor(spawn.x) + 2000, fz = Math.floor(spawn.z) + 2000, fy = 150;
  world.applyRemoteEdit(fx, fy, fz, Block.Stone); // chunk not loaded yet
  let guard = 0;
  while (!world.update(fx + 0.5, fz + 0.5, 8000) && guard++ < 200) { /* stream */ }
  check('edit to an unloaded chunk is applied when that chunk generates',
    world.getBlock(fx, fy, fz) === Block.Stone);
  world.update(spawn.x, spawn.z, 8000); // restore streaming around spawn
}

// --- Armor: mitigation, leveling, equip, recipes, titanium ore ---------------------
{
  check('armor mitigation: 0 points = full damage', mitigate(10, 0) === 10);
  check('armor mitigation: 5 points blocks 20%', mitigate(10, 5) === 8);
  check('armor mitigation: 20 points blocks 80%', mitigate(10, 20) === 2);
  check('armor mitigation is capped at 20 points', mitigate(10, 40) === mitigate(10, 20));
  check('armor mitigation never goes negative', mitigate(1, 20) === 0);

  const piece: ItemStack = { id: Item.IronChestplate, count: 1 };
  const base = armorPointsOf(piece);
  check('fresh armor is level 0 with base points', armorLevel(piece) === 0 && base === 6);
  piece.xp = 60;
  check('armor levels up with XP (more defense)',
    armorLevel(piece) === 1 && armorPointsOf(piece) > base);
  piece.xp = 1_000_000;
  check('armor level is capped', armorLevel(piece) === ARMOR_MAX_LEVEL);

  const inv = new Inventory();
  inv.slots[0] = { id: Item.DiamondHelmet, count: 1 };
  check('equip moves armor into its slot',
    inv.tryEquipArmor(0) && inv.slots[ARMOR_START]?.id === Item.DiamondHelmet && inv.slots[0] === null);
  check('worn armor contributes defense points',
    inv.armorPoints() === armorPointsOf({ id: Item.DiamondHelmet, count: 1 }));
  inv.slots[1] = { id: Item.TitaniumBoots, count: 1 };
  inv.tryEquipArmor(1);
  check('boots equip into the boots slot (index 3)',
    inv.slots[ARMOR_START + 3]?.id === Item.TitaniumBoots);
  inv.slots[2] = { id: Block.Stone, count: 1 };
  check('non-armor cannot be equipped', !inv.tryEquipArmor(2) && inv.slots[2]?.id === Block.Stone);
  inv.addArmorXp(60);
  check('taking hits levels worn armor', (inv.slots[ARMOR_START]?.xp ?? 0) >= 60);

  // Recipes (matchGrid takes 9 row-major cells).
  const cellGrid = (rows: (number | null)[][]): (ItemStack | null)[] => {
    const out: (ItemStack | null)[] = [];
    for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) {
      const id = rows[y]?.[x] ?? null;
      out.push(id === null ? null : { id, count: 1 });
    }
    return out;
  };
  const I = Item.IronIngot, D = Item.Diamond, T = Item.TitaniumIngot;
  check('iron helmet recipe',
    matchGrid(cellGrid([[I, I, I], [I, null, I]]))?.id === Item.IronHelmet);
  check('diamond chestplate recipe',
    matchGrid(cellGrid([[D, null, D], [D, D, D], [D, D, D]]))?.id === Item.DiamondChestplate);
  check('titanium leggings recipe',
    matchGrid(cellGrid([[T, T, T], [T, null, T], [T, null, T]]))?.id === Item.TitaniumLeggings);
  check('iron boots recipe',
    matchGrid(cellGrid([[I, null, I], [I, null, I]]))?.id === Item.IronBoots);

  check('titanium ore smelts to a titanium ingot', SMELT[Block.TitaniumOre] === Item.TitaniumIngot);

  // Titanium ore generates only deep under mountains: find the tallest column
  // near origin, then confirm it appears in that mountain's chunk cluster.
  let bestH = 0, bcx = 0, bcz = 0;
  for (let cx = -64; cx <= 64; cx++) {
    for (let cz = -64; cz <= 64; cz++) {
      const h = terrain.height(cx * 16 + 8, cz * 16 + 8);
      if (h > bestH) { bestH = h; bcx = cx; bcz = cz; }
    }
  }
  let titanium = 0;
  for (let dx = -2; dx <= 2; dx++) {
    for (let dz = -2; dz <= 2; dz++) {
      const c = new Chunk(bcx + dx, bcz + dz);
      terrain.fill(c);
      for (let x = 0; x < 16; x++)
        for (let y = 0; y < 30; y++)
          for (let z = 0; z < 16; z++)
            if (c.get(x, y, z) === Block.TitaniumOre) titanium++;
    }
  }
  check('titanium ore generates deep under mountains', titanium > 0,
    `peak height ${bestH}, found ${titanium}`);
}

// --- Guns: recipes + ammo helpers + server-validated ranged PvP --------------------
{
  const cellGrid = (rows: (number | null)[][]): (ItemStack | null)[] => {
    const out: (ItemStack | null)[] = [];
    for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) {
      const id = rows[y]?.[x] ?? null;
      out.push(id === null ? null : { id, count: 1 });
    }
    return out;
  };
  const I = Item.IronIngot, R = Item.Redstone;
  check('pistol recipe', matchGrid(cellGrid([[I, I, null], [null, R, null]]))?.id === Item.Pistol);
  check('rifle recipe', matchGrid(cellGrid([[I, I, I], [null, R, I]]))?.id === Item.Rifle);
  check('rocket launcher recipe',
    matchGrid(cellGrid([[I, I, I], [I, R, I], [I, I, I]]))?.id === Item.RocketLauncher);
  const bulletR = matchGrid(cellGrid([[I, R, null]]));
  check('bullet recipe yields a stack', bulletR?.id === Item.Bullet && bulletR.count === 8);
  const rocketR = matchGrid(cellGrid([[null, I, null], [I, R, I], [null, Item.Coal, null]]));
  check('rocket recipe yields two', rocketR?.id === Item.Rocket && rocketR.count === 2);
  check('guns carry a magazine size', (ITEMS[Item.Rifle].gun?.mag ?? 0) === 30);

  // Ammo reserve helpers (drive the magazine reload).
  const inv = new Inventory();
  inv.slots[0] = { id: Item.Bullet, count: 30 };
  inv.slots[9] = { id: Item.Bullet, count: 20 };
  check('countItem sums ammo across storage', inv.countItem(Item.Bullet) === 50);
  check('removeItem draws the requested ammo',
    inv.removeItem(Item.Bullet, 40) === 40 && inv.countItem(Item.Bullet) === 10);
  check('removeItem is clamped to what is available',
    inv.removeItem(Item.Bullet, 999) === 10 && inv.countItem(Item.Bullet) === 0);

  // Server-validated ranged PvP (guns route hits through rangedAttack).
  const s = new GameServer(1337, mulberry32(42));
  s.addPlayer(1); s.addPlayer(2);
  const hp = (id: number) => s.snapshot().find((p) => p.id === id)!.health;
  s.handle(1, { t: 'xform', x: 0, y: 70, z: 0, yaw: Math.PI, pitch: 0 }); // faces +z
  s.handle(2, { t: 'xform', x: 0, y: 70, z: 20, yaw: 0, pitch: 0 });
  const hit = s.handle(1, { t: 'rangedAttack', target: 2, amount: 8 });
  check('ranged hit in range + facing applies damage',
    hit.some((o) => o.to === 2 && o.msg.t === 'hurt') && hp(2) === 12);
  check('a ranged self-attack is rejected',
    s.handle(1, { t: 'rangedAttack', target: 1, amount: 8 }).length === 0);
  s.handle(2, { t: 'xform', x: 0, y: 70, z: RANGED_MAX_RANGE + 50, yaw: 0, pitch: 0 });
  check('ranged hit beyond max range is rejected',
    s.handle(1, { t: 'rangedAttack', target: 2, amount: 8 }).length === 0);
  s.handle(2, { t: 'xform', x: 0, y: 70, z: 20, yaw: 0, pitch: 0 });
  s.handle(1, { t: 'xform', x: 0, y: 70, z: 0, yaw: 0, pitch: 0 }); // now faces -z, away
  check('ranged hit while facing away is rejected',
    s.handle(1, { t: 'rangedAttack', target: 2, amount: 8 }).length === 0);
  // Armor mitigates ranged PvP too; damage is clamped and can kill.
  s.handle(2, { t: 'armor', points: 20 });
  s.handle(1, { t: 'xform', x: 0, y: 70, z: 0, yaw: Math.PI, pitch: 0 });
  s.handle(1, { t: 'rangedAttack', target: 2, amount: 10 }); // mitigate(10,20)=2
  check('ranged PvP is armor-mitigated server-side', hp(2) === 10); // 12 - 2
  s.handle(2, { t: 'armor', points: 0 });
  const kill = s.handle(1, { t: 'rangedAttack', target: 2, amount: 9999 }); // clamped, lethal
  check('ranged damage is clamped but can still kill',
    kill.some((o) => o.msg.t === 'killfeed') && hp(2) === 0);
}

// --- Item metadata survives closing the UI (no XP/durability/ammo wipe) ------------
{
  const inv = new Inventory();
  inv.cursor = { id: Item.DiamondHelmet, count: 1, xp: 180 };
  inv.stashOpenSlots();
  const helm = inv.slots.slice(0, 36).find((s) => s?.id === Item.DiamondHelmet);
  check('closing with armor on the cursor keeps its XP/level',
    helm?.xp === 180 && armorLevel(helm!) === 3);

  inv.cursor = { id: Item.IronPickaxe, count: 1, damage: 200 };
  inv.stashOpenSlots();
  check('stashing a worn tool keeps its durability damage (no free repair)',
    inv.slots.slice(0, 36).find((s) => s?.id === Item.IronPickaxe)?.damage === 200);

  inv.cursor = { id: Item.Rifle, count: 1, loaded: 7 };
  inv.stashOpenSlots();
  check('stashing a partly-loaded gun keeps its magazine (no free reload)',
    inv.slots.slice(0, 36).find((s) => s?.id === Item.Rifle)?.loaded === 7);
}

// --- Automation (M13): cobalt ore, oil field, machine sim --------------------
{
  // Cobalt: generates in a deep band, rarer than iron.
  let cobalt = 0, iron = 0, cobaltDepthViolations = 0;
  for (let cx = 0; cx < 4; cx++) {
    for (let cz = 0; cz < 4; cz++) {
      const c = new Chunk(cx, cz);
      terrain.fill(c);
      for (let x = 0; x < 16; x++)
        for (let z = 0; z < 16; z++)
          for (let y = 0; y < 130; y++) {
            const id = c.get(x, y, z);
            if (id === Block.CobaltOre) { cobalt++; if (y > 30) cobaltDepthViolations++; }
            else if (id === Block.IronOre) iron++;
          }
    }
  }
  check('cobalt ore generates', cobalt > 0, `count=${cobalt}`);
  check('cobalt stays in its deep band (y<=30)', cobaltDepthViolations === 0);
  check('cobalt is rarer than iron', cobalt < iron, `cobalt=${cobalt} iron=${iron}`);
  check('cobalt smelts to a cobalt ingot', SMELT[Block.CobaltOre] === Item.CobaltIngot);
  check('cobalt needs an iron pickaxe (tier 2)',
    BLOCKS[Block.CobaltOre].minTier === 2 && BLOCKS[Block.CobaltOre].requiresTool);

  // Oil-field sampling: pure, bounded, and far denser under desert/ocean.
  check('oilRichness is deterministic + bounded', (() => {
    for (let i = 0; i < 2000; i++) {
      const x = i * 53 - 40000, z = i * 91 - 60000;
      const a = terrain.oilRichness(x, z), b = terrain.oilRichness(x, z);
      if (a !== b || a < 0 || a > 1 || !Number.isFinite(a)) return false;
    }
    return true;
  })());
  {
    let wetSum = 0, wetN = 0, drySum = 0, dryN = 0, shale = 0;
    for (let cx = -80; cx <= 80; cx++) {
      for (let cz = -80; cz <= 80; cz++) {
        const x = cx * 16 + 8, z = cz * 16 + 8;
        const h = terrain.height(x, z);
        const b = terrain.biomeWithWater(x, z, h);
        const r = terrain.oilRichness(x, z);
        if (b === Biome.Ocean || b === Biome.Desert) { wetSum += r; wetN++; }
        else if (b === Biome.Plains || b === Biome.Forest) { drySum += r; dryN++; }
      }
    }
    const wet = wetN ? wetSum / wetN : 0, dry = dryN ? drySum / dryN : 0;
    check('oil is far richer under desert/ocean than dry land',
      wetN > 0 && dryN > 0 && wet > dry * 2, `wet=${wet.toFixed(3)} dry=${dry.toFixed(3)}`);
    // Oil shale seeps generate somewhere in a desert/ocean span.
    for (let cx = -40; cx <= 40 && shale < 1; cx++) {
      for (let cz = -40; cz <= 40 && shale < 1; cz++) {
        const c = new Chunk(cx, cz);
        terrain.fill(c);
        for (let i = 0; i < c.data.length; i++) if (c.data[i] === Block.OilShale) { shale++; break; }
      }
    }
    check('oil shale seeps generate in the world', shale > 0);
  }

  // Pure yield function: rate proportional to richness, filter gating, levels.
  {
    const rich = {
      [Block.Stone]: 1, [Block.CoalOre]: 0.5, [Block.IronOre]: 0.4,
      [Block.GoldOre]: 0.9, [Block.RedstoneOre]: 0.9, [Block.DiamondOre]: 0.9,
      [Block.TitaniumOre]: 0.9,
    };
    const m = newMachine(MachineType.Autominer);
    const r1 = autominerRates(m, rich);
    check('autominer rate is proportional to richness',
      Math.abs(r1[Block.Stone] - productionRate(1) * 1) < 1e-9 &&
      Math.abs(r1[Block.CoalOre] - productionRate(1) * 0.5) < 1e-9);
    check('level 1 filter gates out gold/redstone/diamond/titanium',
      r1[Block.GoldOre] === undefined && r1[Block.DiamondOre] === undefined &&
      r1[Block.TitaniumOre] === undefined);
    // Enabling an ungated ore is rejected (masked to the level tier).
    setFilter(m, 0b1111111);
    check('filter cannot enable an ore above the machine level',
      !(m.filter & (1 << AUTOMINER_ORES.indexOf(Block.DiamondOre))) &&
      autominerRates(m, rich)[Block.DiamondOre] === undefined);
    // Production upgrades raise the rate; filter tiers unlock at milestones.
    const base = productionRate(1);
    m.level = 10; setFilter(m, 0b1111111);
    check('mid tier (L10) unlocks gold/redstone but not diamond',
      productionRate(m.level) > base && filterTierMax(m.level) === 4 &&
      autominerRates(m, rich)[Block.GoldOre] > 0 &&
      autominerRates(m, rich)[Block.DiamondOre] === undefined);
    m.level = 30; setFilter(m, 0b1111111);
    check('high tier (L30) unlocks diamond + titanium',
      autominerRates(m, rich)[Block.DiamondOre] > 0 &&
      autominerRates(m, rich)[Block.TitaniumOre] > 0);
    check('upgrade cost grows with level (geometric)',
      (upgradeCost(newMachine(MachineType.Autominer), 'production')![Item.IronIngot]) <
      (upgradeCost({ ...newMachine(MachineType.Autominer), level: 30 }, 'production')![Item.IronIngot]));
    m.level = MAX_LEVEL;
    check('production maxes out at MAX_LEVEL',
      !applyUpgrade(m, 'production') && m.level === MAX_LEVEL && MAX_LEVEL >= 100);
  }

  // Tick + storage cap (never overflows), then collect clears it.
  {
    const m = newMachine(MachineType.Autominer);
    const cap = storageCap(m);
    tickMachine(m, { ore: { [Block.Stone]: 1 } }, 1e9); // absurd dt
    check('storage is capped (no overflow)', totalStored(m) === cap, `${totalStored(m)}/${cap}`);
    check('storage upgrade raises the cap', (() => {
      const before = storageCap(m);
      applyUpgrade(m, 'storage');
      return storageCap(m) > before;
    })());
    const taken = collectMachine(m);
    check('collect returns the stored output and empties the machine',
      (taken[Block.Cobblestone] ?? 0) === cap && totalStored(m) === 0);
  }

  // Oil derrick: dead on dry ground, productive over a field.
  {
    const d = newMachine(MachineType.OilDerrick);
    check('derrick yields nothing below the oil threshold', derrickRate(d, 0.1) === 0);
    check('derrick rate scales with oil richness',
      Math.abs(derrickRate(d, 0.8) - productionRate(1) * 0.8) < 1e-9);
    tickMachine(d, { oil: 0.8 }, 100);
    check('derrick banks oil barrels', (d.stored[Item.OilBarrel] ?? 0) > 0);
    tickMachine(d, { oil: 0.0 }, 100);
    const held = d.stored[Item.OilBarrel] ?? 0;
    tickMachine(d, { oil: 0.0 }, 100);
    check('derrick is idle on dry ground', (d.stored[Item.OilBarrel] ?? 0) === held);
  }

  // NaN/garbage richness never corrupts a machine.
  {
    const m = newMachine(MachineType.Autominer);
    tickMachine(m, { ore: { [Block.Stone]: NaN } }, 1);
    tickMachine(m, { ore: { [Block.Stone]: 1 } }, NaN);
    check('NaN richness / dt never banks bad items',
      totalStored(m) === 0 && Number.isFinite(totalStored(m)));
  }

  check('block->machine-type mapping', machineTypeForBlock(Block.Autominer) === MachineType.Autominer &&
    machineTypeForBlock(Block.OilDerrick) === MachineType.OilDerrick &&
    machineTypeForBlock(Block.Stone) === null);

  // HP / ownership / sabotage (pure).
  {
    const m = newMachine(MachineType.Autominer);
    check('new machine starts at full HP, unclaimed',
      m.hp === machineMaxHp(m) && m.owner === '');
    check('damageMachine reduces HP, not destroyed above 0',
      damageMachine(m, 10) === false && m.hp === machineMaxHp(m) - 10);
    check('damageMachine destroys at 0 HP', damageMachine(m, 9999) === true && m.hp === 0);
    const lvl = newMachine(MachineType.Autominer);
    const hp1 = machineMaxHp(lvl);
    lvl.level = 50;
    check('max HP scales with production level', machineMaxHp(lvl) > hp1);
    const heal = newMachine(MachineType.Autominer);
    heal.hp = 5;
    applyUpgrade(heal, 'production');
    check('a production upgrade repairs to the new max HP', heal.hp === machineMaxHp(heal));
    claimMachine(m, 'BraveYak42');
    check('claimMachine sets the owner', m.owner === 'BraveYak42');
    const carried = sanitizeState({
      type: MachineType.Autominer, level: 5, storageLevel: 1, filter: 0b111,
      stored: {}, owner: 'FrostWolf12', hp: 7,
    })!;
    check('sanitizeState carries owner + clamps hp',
      carried.owner === 'FrostWolf12' && carried.hp === 7 &&
      sanitizeState({ type: MachineType.OilDerrick, hp: 99999 })!.hp <= machineMaxHp(newMachine(MachineType.OilDerrick)));
  }
}

// --- Server sabotage: hit -> HP drops -> destroy spills loot + machine block --
{
  const s = new GameServer(1337, mulberry32(99));
  s.addPlayer(1);
  s.handle(1, { t: 'xform', x: 0.5, y: 70, z: 0.5, yaw: 0, pitch: 0 });
  s.handle(1, { t: 'edit', x: 1, y: 70, z: 0, block: Block.Autominer });
  for (let i = 0; i < 300; i++) s.tickMachines(1); // build up some loot to raid

  // A non-lethal hit lowers HP and broadcasts the new state.
  const hit = s.handle(1, { t: 'machineHit', x: 1, y: 70, z: 0, amount: 10 });
  const hm = hit.find((o) => o.msg.t === 'machine')?.msg as
    Extract<typeof hit[number]['msg'], { t: 'machine' }> | undefined;
  check('a machine hit lowers HP and broadcasts state',
    !!hm && hm.state.hp === machineMaxHp(hm.state) - 10);

  // Claim records the attacker's username.
  const claimed = s.handle(1, { t: 'machineClaim', x: 1, y: 70, z: 0 });
  const cm = claimed.find((o) => o.msg.t === 'machine')!.msg as
    Extract<typeof claimed[number]['msg'], { t: 'machine' }>;
  check('a machine can be claimed (owner recorded)', cm.state.owner.length > 0);

  // A lethal hit destroys it: spills stored loot + the machine block, clears it.
  const kill = s.handle(1, { t: 'machineHit', x: 1, y: 70, z: 0, amount: 9999 });
  const spills = kill.filter((o) => o.msg.t === 'itemspawn');
  const droppedMachine = spills.some((o) =>
    (o.msg as { item: { item: number } }).item.item === Block.Autominer);
  check('destroying a machine spills loot AND drops the machine block',
    spills.length >= 1 && droppedMachine);
  check('destroying a machine clears the world block (edit air)',
    kill.some((o) => o.msg.t === 'edit' && (o.msg as { block: number }).block === Block.Air));
  check('a destroyed machine is gone server-side',
    s.handle(1, { t: 'machineOpen', x: 1, y: 70, z: 0 }).length === 0);

  // Out-of-range / dead players can't sabotage.
  s.handle(1, { t: 'edit', x: 1, y: 70, z: 0, block: Block.OilDerrick });
  s.handle(1, { t: 'xform', x: 600, y: 70, z: 600, yaw: 0, pitch: 0 });
  check('out-of-range sabotage is rejected',
    s.handle(1, { t: 'machineHit', x: 1, y: 70, z: 0, amount: 9999 }).length === 0);
  s.handle(1, { t: 'xform', x: 0.5, y: 70, z: 0.5, yaw: 0, pitch: 0 });
  s.handle(1, { t: 'selfhurt', amount: 100 });
  check('a dead player cannot sabotage a machine',
    s.handle(1, { t: 'machineHit', x: 1, y: 70, z: 0, amount: 9999 }).length === 0);
}

// --- Multi-block footprint: placement column + footprint clears on destroy ----
{
  check('footprint heights (anchor + parts)',
    machineHeight(MachineType.Autominer) === 2 && machineHeight(MachineType.OilDerrick) === 3);

  const s = new GameServer(1337, mulberry32(102));
  s.addPlayer(1);
  s.handle(1, { t: 'xform', x: 0.5, y: 70, z: 0.5, yaw: 0, pitch: 0 });
  // Client places the footprint as anchor + part cell(s); the anchor edit
  // creates the entity, the part edit just records the structural block.
  s.handle(1, { t: 'edit', x: 1, y: 70, z: 0, block: Block.Autominer });
  s.handle(1, { t: 'edit', x: 1, y: 71, z: 0, block: Block.MachinePart });
  for (let i = 0; i < 50; i++) s.tickMachines(1);

  const kill = s.handle(1, { t: 'machineHit', x: 1, y: 70, z: 0, amount: 9999 });
  const airAt = new Set(kill.filter((o) => o.msg.t === 'edit' &&
    (o.msg as { block: number }).block === Block.Air)
    .map((o) => { const m = o.msg as { x: number; y: number; z: number }; return `${m.x},${m.y},${m.z}`; }));
  check('destroying a machine clears its whole footprint (anchor + part)',
    airAt.has('1,70,0') && airAt.has('1,71,0'));

  // A direct edit removing the anchor also tidies the part cell (no orphans).
  s.handle(1, { t: 'edit', x: 2, y: 70, z: 0, block: Block.OilDerrick });
  s.handle(1, { t: 'edit', x: 2, y: 71, z: 0, block: Block.MachinePart });
  s.handle(1, { t: 'edit', x: 2, y: 72, z: 0, block: Block.MachinePart });
  const broke = s.handle(1, { t: 'edit', x: 2, y: 70, z: 0, block: Block.Air });
  const airAt2 = new Set(broke.filter((o) => o.msg.t === 'edit' &&
    (o.msg as { block: number }).block === Block.Air)
    .map((o) => { const m = o.msg as { x: number; y: number; z: number }; return `${m.x},${m.y},${m.z}`; }));
  check('removing a machine anchor clears its part cells',
    airAt2.has('2,71,0') && airAt2.has('2,72,0'));
}

// --- Server-owned dropped items fall under gravity and settle on the ground ---
{
  // Find a dry land column so the item rests on a real surface.
  let cx = 8, cz = 8;
  for (let i = 0; i < 4000; i++) {
    if (terrain.height(8 + i, 8) >= SEA_LEVEL + 2) { cx = 8 + i; cz = 8; break; }
  }
  const surface = terrain.height(cx, cz);
  const s = new GameServer(1337, mulberry32(61));
  s.addPlayer(1);
  s.handle(1, { t: 'xform', x: cx + 0.5, y: surface + 40, z: cz + 0.5, yaw: 0, pitch: 0 });
  const drop = s.handle(1, { t: 'drop', items: [{ id: Block.Stone, count: 1 }], x: cx + 0.5, y: surface + 40, z: cz + 0.5 });
  // The itemspawn carries the live info object (server mutates it as it falls).
  const info = (drop.find((o) => o.msg.t === 'itemspawn')!.msg as { item: { x: number; y: number; z: number } }).item;
  const startY = info.y;
  let everMoved = false;
  for (let i = 0; i < 400; i++) if (s.tickItems(1 / 15).length) everMoved = true;
  const col = `${Math.floor(info.x)},${Math.floor(info.z)}`;
  check('server drops fall under gravity', everMoved && info.y < startY - 1);
  check('a falling drop settles on the ground surface',
    Math.abs(info.y - (terrain.height(Math.floor(info.x), Math.floor(info.z)) + 1)) < 1e-9,
    `y=${info.y} surface=${terrain.height(Math.floor(info.x), Math.floor(info.z))} col=${col}`);
  // Once resting, it no longer reports movement (no needless broadcasts).
  check('a rested drop stops moving', s.tickItems(1 / 15).length === 0);
}

// --- Server machine lifecycle (place -> tick -> upgrade -> collect -> break) --
{
  const s = new GameServer(1337, mulberry32(77));
  s.addPlayer(1);
  s.handle(1, { t: 'xform', x: 0.5, y: 70, z: 0.5, yaw: 0, pitch: 0 });
  const px = 1, py = 70, pz = 0;
  const place = s.handle(1, { t: 'edit', x: px, y: py, z: pz, block: Block.Autominer });
  check('placing an autominer is a normal broadcast edit',
    place.some((o) => o.to === 'all' && o.msg.t === 'edit'));

  const open = (id = 1) => {
    const out = s.handle(id, { t: 'machineOpen', x: px, y: py, z: pz });
    return out.find((o) => o.msg.t === 'machine')?.msg as
      Extract<typeof out[number]['msg'], { t: 'machine' }> | undefined;
  };
  check('opening a placed machine returns its state',
    open()?.state.type === MachineType.Autominer);

  for (let i = 0; i < 200; i++) s.tickMachines(1);
  const ticked = open();
  check('server machine accumulates output while ticking',
    !!ticked && totalStored(ticked.state) > 0);

  // Upgrade changes rate + cap (server bumps + caps the level).
  const beforeCap = storageCap(ticked!.state);
  s.handle(1, { t: 'machineUpgrade', x: px, y: py, z: pz, axis: 'production' });
  const up = s.handle(1, { t: 'machineUpgrade', x: px, y: py, z: pz, axis: 'storage' });
  const upState = up.find((o) => o.msg.t === 'machine')!.msg as
    Extract<typeof up[number]['msg'], { t: 'machine' }>;
  check('upgrade raises production level + storage cap',
    upState.state.level === 2 && storageCap(upState.state) > beforeCap);

  // Filter set to "everything" is masked to the level tier (rejects ungated).
  s.handle(1, { t: 'machineConfig', x: px, y: py, z: pz, filter: 0b1111111 });
  const cfg = open()!.state;
  check('server masks ungated ores out of the filter',
    !(cfg.filter & (1 << AUTOMINER_ORES.indexOf(Block.DiamondOre))));

  // Collect grants the stored output (dup-safe gotitem path) + empties it.
  const before = totalStored(open()!.state);
  const collect = s.handle(1, { t: 'machineCollect', x: px, y: py, z: pz });
  const granted = collect.filter((o) => o.msg.t === 'gotitem')
    .reduce((n, o) => n + (o.msg as { count: number }).count, 0);
  check('collect grants the whole stored output to the collector',
    before > 0 && granted === before);
  check('collected machine is emptied', totalStored(open()!.state) === 0);

  // Break spills the (refilled) stored output as item entities, server-side.
  for (let i = 0; i < 200; i++) s.tickMachines(1);
  const broke = s.handle(1, { t: 'edit', x: px, y: py, z: pz, block: Block.Air });
  check('breaking a machine spills its stored output',
    broke.some((o) => o.msg.t === 'itemspawn'));
  check('a broken machine no longer exists server-side',
    s.handle(1, { t: 'machineOpen', x: px, y: py, z: pz }).length === 0);

  // A machine op on a non-machine position is fail-closed.
  check('machine ops on a non-machine block are rejected',
    s.handle(1, { t: 'machineCollect', x: 40, y: 70, z: 40 }).length === 0);

  // sanitizeState defends against forged/garbage state.
  check('sanitizeState rejects junk + clamps levels',
    sanitizeState(null) === null &&
    sanitizeState({ type: MachineType.Autominer, level: 999, storageLevel: -5, filter: NaN })!.level === MAX_LEVEL &&
    sanitizeState({ type: MachineType.Autominer, level: 999, storageLevel: -5, filter: NaN })!.storageLevel === 1);
}

// --- Offline / server parity: identical pure module, identical result --------
{
  const terr = new Terrain(1337);
  const local = new Machines(terr);
  local.place(1, 70, 0, MachineType.Autominer);
  for (let i = 0; i < 60; i++) local.update(1);
  const sLocal = local.get(1, 70, 0)!;

  const srv = new GameServer(1337, mulberry32(3));
  srv.addPlayer(1);
  srv.handle(1, { t: 'xform', x: 0.5, y: 70, z: 0.5, yaw: 0, pitch: 0 });
  srv.handle(1, { t: 'edit', x: 1, y: 70, z: 0, block: Block.Autominer });
  for (let i = 0; i < 60; i++) srv.tickMachines(1);
  const sSrv = (srv.handle(1, { t: 'machineOpen', x: 1, y: 70, z: 0 })
    .find((o) => o.msg.t === 'machine')!.msg as { state: { stored: Record<number, number> } }).state;

  const keys = new Set([...Object.keys(sLocal.stored), ...Object.keys(sSrv.stored)]);
  let parity = totalStored(sLocal) > 0;
  for (const k of keys) if ((sLocal.stored[Number(k)] ?? 0) !== (sSrv.stored[Number(k)] ?? 0)) parity = false;
  check('offline Machines and server produce identical output (parity)',
    parity, `local=${totalStored(sLocal)} srv=${totalStored(sSrv)}`);

  // currentRate readout is finite + positive over rich ground.
  check('currentRate readout is finite and positive',
    Number.isFinite(currentRate(sLocal, local.context(1, 0, MachineType.Autominer))) &&
    currentRate(sLocal, local.context(1, 0, MachineType.Autominer)) > 0);

  // place() is type-aware: a different machine type replaces a stale state.
  local.place(1, 70, 0, MachineType.OilDerrick);
  check('Machines.place replaces a stale state of a different type',
    local.get(1, 70, 0)!.type === MachineType.OilDerrick &&
    totalStored(local.get(1, 70, 0)!) === 0);
}

// --- Machine hardening: proximity, dead, axis, aggregate cap -----------------
{
  const s = new GameServer(1337, mulberry32(88));
  s.addPlayer(1);
  s.handle(1, { t: 'xform', x: 0.5, y: 70, z: 0.5, yaw: 0, pitch: 0 });
  s.handle(1, { t: 'edit', x: 1, y: 70, z: 0, block: Block.Autominer });
  for (let i = 0; i < 100; i++) s.tickMachines(1);

  // Far away -> all machine ops fail-closed.
  s.handle(1, { t: 'xform', x: 500, y: 70, z: 500, yaw: 0, pitch: 0 });
  check('machine collect from out of range is rejected',
    s.handle(1, { t: 'machineCollect', x: 1, y: 70, z: 0 }).length === 0);
  check('machine open from out of range is rejected',
    s.handle(1, { t: 'machineOpen', x: 1, y: 70, z: 0 }).length === 0);

  // Back in range: an unknown upgrade axis is rejected (not defaulted).
  s.handle(1, { t: 'xform', x: 0.5, y: 70, z: 0.5, yaw: 0, pitch: 0 });
  check('unknown machineUpgrade axis is rejected', (() => {
    const before = (s.handle(1, { t: 'machineOpen', x: 1, y: 70, z: 0 })
      .find((o) => o.msg.t === 'machine')!.msg as { state: { level: number } }).state.level;
    const out = s.handle(1, { t: 'machineUpgrade', x: 1, y: 70, z: 0, axis: 'junk' as never });
    const after = (s.handle(1, { t: 'machineOpen', x: 1, y: 70, z: 0 })
      .find((o) => o.msg.t === 'machine')!.msg as { state: { level: number } }).state.level;
    return out.length === 0 && before === after;
  })());

  // Dead players can't loot/operate a machine.
  s.handle(1, { t: 'selfhurt', amount: 100 });
  check('a dead player cannot collect a machine',
    s.handle(1, { t: 'machineCollect', x: 1, y: 70, z: 0 }).length === 0);

  // sanitizeState enforces the AGGREGATE cap, not just per-item.
  const bloated = sanitizeState({
    type: MachineType.Autominer, level: 1, storageLevel: 1, filter: 0b111,
    stored: { [Block.Cobblestone]: 700, [Item.Coal]: 700, [Block.IronOre]: 700 },
  })!;
  check('sanitizeState trims stored to the aggregate storage cap',
    totalStored(bloated) === storageCap(bloated), `${totalStored(bloated)}/${storageCap(bloated)}`);
}

// --- Ships: capture, physics, combat, upgrades, validation ------------------
{
  // Flood-fill a small connected hull: helm + a 3-block deck.
  const grid: Record<string, number> = {
    '0,70,0': Block.ShipHelm,
    '1,70,0': Block.OakPlanks,
    '2,70,0': Block.OakPlanks,
    '1,70,1': Block.Cannon,
  };
  const cap = (x: number, y: number, z: number) => grid[`${x},${y},${z}`] ?? 0;
  const hull = floodFillHull(0, 70, 0, cap);
  check('floodFillHull captures the connected hull from the helm',
    !!hull && hull.length === 4);
  check('floodFillHull rejects a non-helm start',
    floodFillHull(1, 70, 0, cap) === null);
  check('isHullBlock excludes water/air/entities + containers',
    isHullBlock(Block.OakPlanks) && !isHullBlock(Block.Water) &&
    !isHullBlock(Block.Turret) && !isHullBlock(Block.Chest));

  // Oversize hull -> rejected (cap enforced).
  const big: Record<string, number> = { '0,70,0': Block.ShipHelm };
  for (let i = 1; i <= MAX_SHIP_BLOCKS + 5; i++) big[`${i},70,0`] = Block.OakPlanks;
  check('floodFillHull rejects an oversize hull',
    floodFillHull(0, 70, 0, (x, y, z) => big[`${x},${y},${z}`] ?? 0) === null);

  const ship = newShip(1, 'Cap', { x: 0.5, y: 70.5, z: 0.5 }, 0, hull!);
  check('cannonCount counts cannon blocks', cannonCount(ship) === 1);
  check('hullRadius is positive', hullRadius(hull!) >= 2);

  // blockWorldPos: the helm sits at the origin; a +x deck block is +x at yaw 0.
  const helmW = blockWorldPos(ship, hull!.find((b) => b.dx === 0 && b.dz === 0)!);
  check('helm block sits at the ship origin',
    Math.abs(helmW.x - 0.5) < 1e-6 && Math.abs(helmW.z - 0.5) < 1e-6);
  const deckW = blockWorldPos(ship, { dx: 2, dy: 0, dz: 0, id: Block.OakPlanks });
  check('deck offset rotates with yaw (yaw 0 keeps +x)',
    Math.abs(deckW.x - 2.5) < 1e-6 && Math.abs(deckW.z - 0.5) < 1e-6);

  // Physics: sails forward over open water, stops at a shoreline.
  const water = () => 0;                 // everywhere below sea level
  const sail = newShip(2, 'Cap', { x: 100.5, y: 64, z: 100.5 }, 0, hull!);
  for (let i = 0; i < 30; i++) tickShip(sail, { thrust: 1, turn: 0 }, 0.1, water);
  check('ship sails forward over water', sail.z < 100.5 - 1); // yaw 0 faces -Z

  const land = (x: number, z: number) => (z < 95 ? 100 : 0); // wall of land north
  const blocked = newShip(3, 'Cap', { x: 100.5, y: 64, z: 100.5 }, 0, hull!);
  for (let i = 0; i < 80; i++) tickShip(blocked, { thrust: 1, turn: 0 }, 0.1, land);
  // It sailed north a bit but halted at the shore — never crossing into land.
  check('ship stops at a shoreline (water-only)',
    blocked.z > 95 && blocked.z < 100.5);

  // Combat: damage + destruction threshold.
  check('shipMaxHp grows with the hull axis',
    shipMaxHp({ hull: 5 }) > shipMaxHp({ hull: 1 }));
  const dmgShip = newShip(4, 'Cap', { x: 0, y: 64, z: 0 }, 0, hull!);
  check('damageShip returns true only at 0 hp',
    !damageShip(dmgShip, dmgShip.maxHp - 1) && damageShip(dmgShip, 5));

  // Upgrades cap at SHIP_MAX_LEVEL; speed scales.
  const up = newShip(5, 'Cap', { x: 0, y: 64, z: 0 }, 0, hull!);
  for (let i = 0; i < SHIP_MAX_LEVEL + 4; i++) applyShipUpgrade(up, 'speed');
  check('ship speed upgrade caps at SHIP_MAX_LEVEL', up.level.speed === SHIP_MAX_LEVEL);
  check('shipSpeed increases with level', shipSpeed({ speed: 10 }) > shipSpeed({ speed: 1 }));
  check('shipUpgradeCost is null at max', shipUpgradeCost(up, 'speed') === null);

  // Rider/collision helpers: deck height + world-point hit test, incl. rotated.
  const helmShip = newShip(7, 'Cap', { x: 10.5, y: 64, z: 20.5 }, 0, hull!);
  check('deckHeightAt finds the deck over a hull column + null off it',
    deckHeightAt(helmShip, 10.5, 20.5) !== null &&
    deckHeightAt(helmShip, 50, 50) === null);
  check('blockAtWorld detects a hull block at its world position', (() => {
    const w = blockWorldPos(helmShip, { dx: 1, dy: 0, dz: 0, id: Block.OakPlanks });
    return blockAtWorld(helmShip, w.x, w.y, w.z) === Block.OakPlanks &&
      blockAtWorld(helmShip, w.x + 5, w.y, w.z) === 0;
  })());
  // Rotate 90° and confirm the collision model rotates with it.
  helmShip.yaw = Math.PI / 2;
  check('blockAtWorld tracks the hull under rotation', (() => {
    const w = blockWorldPos(helmShip, { dx: 2, dy: 0, dz: 0, id: Block.OakPlanks });
    const loc = worldToLocalOffset(helmShip, w.x, w.z);
    return Math.abs(Math.round(loc.lx) - 2) < 1e-6 && Math.abs(Math.round(loc.lz)) < 1e-6 &&
      blockAtWorld(helmShip, w.x, w.y, w.z) === Block.OakPlanks;
  })());

  // sanitize rejects junk + clamps.
  check('sanitizeShipState rejects non-objects', sanitizeShipState(null) === null &&
    sanitizeShipState({ id: NaN }) === null);
  const san = sanitizeShipState({
    id: 9, owner: 'x'.repeat(100), x: 1, y: 2, z: 3, yaw: 0,
    hp: 999999, level: { speed: 999, hull: -5, cannon: 2 },
    blocks: [{ dx: 0, dy: 0, dz: 0, id: Block.ShipHelm }, { dx: 1, dy: 0, dz: 0, id: Block.OakPlanks }],
  })!;
  check('sanitizeShipState clamps level + hp + owner',
    san.level.speed === SHIP_MAX_LEVEL && san.level.hull === 1 &&
    san.hp <= san.maxHp && san.owner.length <= 24);
}

// --- Ships via the authoritative server -------------------------------------
{
  const s = new GameServer(1337, mulberry32(11));
  s.addPlayer(1);
  s.handle(1, { t: 'xform', x: 0.5, y: 70, z: 0.5, yaw: 0, pitch: 0 });
  // Build a tiny hull next to the player via edits (server records them).
  s.handle(1, { t: 'edit', x: 0, y: 70, z: 0, block: Block.ShipHelm });
  s.handle(1, { t: 'edit', x: 1, y: 70, z: 0, block: Block.Cannon });
  const launch = s.handle(1, { t: 'shipLaunch', x: 0, y: 70, z: 0 });
  const stateMsg = launch.find((o) => o.msg.t === 'shipState');
  check('shipLaunch creates a ship + lifts its blocks out of the world',
    !!stateMsg && launch.filter((o) => o.msg.t === 'edit'
      && (o.msg as { block: number }).block === Block.Air).length === 2);
  const shipId = (stateMsg!.msg as { ship: { id: number } }).ship.id;

  // A second player far away can't steer/dock it (fail-closed).
  s.addPlayer(2);
  s.handle(2, { t: 'xform', x: 500, y: 70, z: 500, yaw: 0, pitch: 0 });
  check('a far player cannot steer a ship',
    s.handle(2, { t: 'shipSteer', id: shipId, thrust: 1, turn: 0 }).length === 0);

  // A gun hit from out of range is rejected; in range it chips HP.
  check('ship hit beyond ranged range is rejected',
    s.handle(2, { t: 'shipHit', id: shipId, amount: 20 }).length === 0);
  s.handle(2, { t: 'xform', x: 2, y: 70, z: 0, yaw: 0, pitch: 0 });
  const chip = s.handle(2, { t: 'shipHit', id: shipId, amount: 20 });
  check('an in-range ship hit broadcasts a transform (hp update)',
    chip.some((o) => o.msg.t === 'shipTransforms'));

  // Dock restores the hull to the world + removes the ship (no item dup/loss).
  {
    const d = new GameServer(1337, mulberry32(44));
    d.addPlayer(1);
    d.handle(1, { t: 'xform', x: 0.5, y: 70, z: 0.5, yaw: 0, pitch: 0 });
    d.handle(1, { t: 'edit', x: 0, y: 70, z: 0, block: Block.ShipHelm });
    d.handle(1, { t: 'edit', x: 1, y: 70, z: 0, block: Block.Cannon });
    const lid = (d.handle(1, { t: 'shipLaunch', x: 0, y: 70, z: 0 })
      .find((o) => o.msg.t === 'shipState')!.msg as { ship: { id: number } }).ship.id;
    const dock = d.handle(1, { t: 'shipDock', id: lid });
    const placed = dock.filter((o) => o.msg.t === 'edit' &&
      (o.msg as { block: number }).block !== Block.Air);
    check('docking restores the hull blocks + removes the ship',
      dock.some((o) => o.msg.t === 'shipRemove') && placed.length === 2);
  }

  // Destroy it: a single hit is damage-capped (no one-shot), so it takes a few.
  let destroyOut: ReturnType<typeof s.handle> = [];
  for (let i = 0; i < 12; i++) {
    const o = s.handle(2, { t: 'shipHit', id: shipId, amount: 60 });
    if (o.some((m) => m.msg.t === 'shipRemove')) { destroyOut = o; break; }
  }
  check('destroying a ship spills loot + removes it',
    destroyOut.some((o) => o.msg.t === 'shipRemove') &&
    destroyOut.some((o) => o.msg.t === 'itemspawn'));
  check('a destroyed ship no longer exists',
    s.handle(2, { t: 'shipHit', id: shipId, amount: 10 }).length === 0);
}

// --- Turrets ----------------------------------------------------------------
{
  check('turretRange + turretDamage scale with level',
    turretRange({ range: 5 }) > turretRange({ range: 1 }) &&
    turretDamage({ damage: 5 }) > turretDamage({ damage: 1 }));

  const s = new GameServer(1337, mulberry32(22));
  s.addPlayer(1); // owner
  s.handle(1, { t: 'xform', x: 0.5, y: 70, z: 0.5, yaw: 0, pitch: 0 });
  s.handle(1, { t: 'edit', x: 1, y: 70, z: 0, block: Block.Turret });
  check('turretOpen in range returns state',
    s.handle(1, { t: 'turretOpen', x: 1, y: 70, z: 0 }).some((o) => o.msg.t === 'turret'));
  s.handle(1, { t: 'turretClaim', x: 1, y: 70, z: 0 });
  s.handle(1, { t: 'turretLoad', x: 1, y: 70, z: 0, item: Item.Cannonball, count: 50 });
  s.handle(1, { t: 'turretLoad', x: 1, y: 70, z: 0, item: Item.OilBarrel, count: 20 });

  // No enemy yet -> inert.
  check('a turret with no enemy in range does not fire',
    s.tickTurrets(2).every((o) => o.msg.t !== 'turretFire'));

  // Enemy walks into range -> turret fires + damages them.
  s.addPlayer(2);
  s.handle(2, { t: 'xform', x: 4, y: 70, z: 0, yaw: 0, pitch: 0 });
  const fired = s.tickTurrets(2);
  check('a claimed, loaded turret fires at a non-owner in range',
    fired.some((o) => o.msg.t === 'turretFire') &&
    fired.some((o) => o.msg.t === 'hurt'));

  // It never targets its owner.
  s.handle(2, { t: 'xform', x: 500, y: 70, z: 500, yaw: 0, pitch: 0 }); // enemy leaves
  check('a turret never fires on its owner',
    s.tickTurrets(2).every((o) => o.msg.t !== 'turretFire'));

  // Sabotage to destruction: clears the block + drops loot.
  s.handle(1, { t: 'xform', x: 1.5, y: 70, z: 0.5, yaw: 0, pitch: 0 });
  const dead = s.handle(1, { t: 'turretHit', x: 1, y: 70, z: 0, amount: 100000 });
  check('sabotaging a turret to 0 hp clears it + drops loot',
    dead.some((o) => o.msg.t === 'edit' && (o.msg as { block: number }).block === Block.Air) &&
    dead.some((o) => o.msg.t === 'itemspawn'));

  // Upgrades cap; sanitize clamps.
  const t = newTurret('me');
  for (let i = 0; i < TURRET_MAX_LEVEL + 4; i++) applyTurretUpgrade(t, 'damage');
  check('turret upgrade caps at TURRET_MAX_LEVEL', t.level.damage === TURRET_MAX_LEVEL);
  check('turretUpgradeCost is null at max', turretUpgradeCost(t, 'damage') === null);
  const loadT = newTurret();
  check('turretLoad caps + reports accepted',
    turretLoad(loadT, Item.Cannonball, 99999) > 0 && loadT.ammo <= 256);
  const sanT = sanitizeTurretState({ owner: 'y'.repeat(100), hp: 1e9,
    level: { range: 999, damage: -3, rate: 2 }, ammo: 1e9, fuel: 1e9 })!;
  check('sanitizeTurretState clamps level/ammo/fuel/owner',
    sanT.level.range === TURRET_MAX_LEVEL && sanT.level.damage === 1 &&
    sanT.ammo <= 256 && sanT.fuel <= 64 && sanT.owner.length <= 24);
  check('unclaimed turret is not armed for firing',
    !turretArmed(newTurret()));
}

// --- Territory objective ----------------------------------------------------
{
  const terrain = new Terrain(1337);
  const nodes = deriveControlNodes((x, z) => terrain.oilRichness(x, z));
  check('control nodes are derived deterministically + bounded',
    nodes.length > 0 && nodes.length <= MAX_NODES &&
    nodes.every((n) => n.radius > 0 && Number.isFinite(n.x) && Number.isFinite(n.z)));
  const nodes2 = deriveControlNodes((x, z) => terrain.oilRichness(x, z));
  check('node derivation is stable across calls',
    JSON.stringify(nodes) === JSON.stringify(nodes2));

  const node = { id: 0, x: 0, z: 0, radius: 10, richness: 1 };
  check('a lone player controls a node',
    resolveNode(node, [{ name: 'A', x: 1, z: 1, dead: false }]).controller === 'A');
  check('two players contest a node (no controller)', (() => {
    const r = resolveNode(node, [
      { name: 'A', x: 1, z: 1, dead: false }, { name: 'B', x: -1, z: -1, dead: false }]);
    return r.controller === '' && r.contested;
  })());
  check('a player outside the radius does not control',
    resolveNode(node, [{ name: 'A', x: 50, z: 50, dead: false }]).controller === '');

  check('topScores sorts descending', (() => {
    const m = new Map([['A', 5], ['B', 30], ['C', 12]]);
    const top = topScores(m);
    return top[0].name === 'B' && top[1].name === 'C' && top[2].name === 'A';
  })());

  // Server accrues score for a controlled node and declares a winner.
  const s = new GameServer(1337, mulberry32(33));
  s.addPlayer(1);
  const snap0 = s.territorySnapshot() as { t: 'territory'; nodes: { x: number; z: number }[] };
  const target = snap0.nodes[0];
  s.handle(1, { t: 'xform', x: target.x, y: 70, z: target.z, yaw: 0, pitch: 0 });
  let won = '';
  for (let i = 0; i < TERRITORY_TARGET_SCORE + 20 && !won; i++) {
    s.tickTerritory(1);
    const snap = s.territorySnapshot() as { t: 'territory'; winner: string };
    won = snap.winner;
  }
  check('controlling a node accrues score to a round win', won !== '');
  check('territory snapshot has the expected shape', (() => {
    const snap = s.territorySnapshot() as {
      t: 'territory'; nodes: unknown[]; scores: unknown[]; roundTime: number;
    };
    return snap.t === 'territory' && Array.isArray(snap.nodes) &&
      Array.isArray(snap.scores) && Number.isFinite(snap.roundTime);
  })());
}

// --- Building set (M15): per-wood planks + slabs + stairs --------------------
{
  const g = (cells: Record<number, number>): (ItemStack | null)[] => {
    const out: (ItemStack | null)[] = new Array(9).fill(null);
    for (const [i, id] of Object.entries(cells)) out[Number(i)] = { id, count: 1 };
    return out;
  };
  // Each log makes its own planks now.
  check('oak/birch/spruce logs make their own planks',
    matchGrid(g({ 4: Block.OakLog }))?.id === Block.OakPlanks &&
    matchGrid(g({ 4: Block.BirchLog }))?.id === Block.BirchPlanks &&
    matchGrid(g({ 4: Block.SpruceLog }))?.id === Block.SprucePlanks);
  // A plank row crafts 6 slabs; the stair shape crafts 4 stairs (N variant).
  check('3 planks in a row -> 6 slabs', (() => {
    const r = matchGrid(g({ 0: Block.OakPlanks, 1: Block.OakPlanks, 2: Block.OakPlanks }));
    return r?.id === Block.OakSlab && r?.count === 6;
  })());
  check('stair pattern -> 4 stairs (N variant item)', (() => {
    const r = matchGrid(g({
      0: Block.SprucePlanks, 3: Block.SprucePlanks, 4: Block.SprucePlanks,
      6: Block.SprucePlanks, 7: Block.SprucePlanks, 8: Block.SprucePlanks,
    }));
    return r?.id === Block.SpruceStairsN && r?.count === 4;
  })());
  // Generic recipes still accept any plank (sticks from birch planks).
  check('sticks craft from any plank type',
    matchGrid(g({ 1: Block.BirchPlanks, 4: Block.BirchPlanks }))?.id === Item.Stick);

  // Stair orientation + drop mapping.
  check('orientStairsForYaw picks a facing in the wood block range', (() => {
    const id = orientStairsForYaw(Block.OakStairsN, 0); // facing -Z (north)
    return id >= Block.OakStairsN && id <= Block.OakStairsW &&
      stairsBaseOf(id) === Block.OakStairsN;
  })());
  check('every stairs facing drops the N stairs item',
    dropFor(Block.BirchStairsE, 0.5)?.id === Block.BirchStairsN &&
    dropFor(Block.BirchStairsW, 0.5)?.id === Block.BirchStairsN);
  check('slabs + planks drop themselves',
    dropFor(Block.OakSlab, 0.5)?.id === Block.OakSlab &&
    dropFor(Block.SprucePlanks, 0.5)?.id === Block.SprucePlanks);

  // Slab/stairs blocks are solid + non-opaque + axe-mineable.
  check('slabs/stairs are solid, non-opaque, axe-tool', (() => {
    const slab = BLOCKS[Block.OakSlab], st = BLOCKS[Block.BirchStairsS];
    return slab.solid && !slab.opaque && slab.tool === 'axe' &&
      st.solid && !st.opaque && st.shape === 'stairs' && st.facing === 2;
  })());

  // stairBoxes returns a bottom slab + a top quarter on the facing side.
  check('stairBoxes geometry is a bottom slab + top quarter', (() => {
    const boxes = stairBoxes(0); // N (-z): top at z 0..0.5
    return boxes.length === 2 &&
      boxes[0][1][1] === 0.5 &&            // bottom box is half-height
      boxes[1][0][1] === 0.5 && boxes[1][1][2] === 0.5; // top quarter, back half
  })());
}

console.log(failures === 0 ? '\nAll smoke tests passed.' : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
