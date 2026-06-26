// Headless smoke tests for VOXELON: terrain/biomes/mountains, ores, caves,
// lighting, meshing, raycast, player physics + energy, survival regen,
// crafting/tools, furnace, items/inventory, item entities, hostile mobs,
// and the VOXELON-specific changes. Run: npm run smoke

import * as THREE from 'three';
import { materialOf } from '../src/audio';
import { Biome, BIOME_NAMES } from '../src/biomes';
import {
  Block, BLOCKS, isSlab, isTopSlab, isSolid, orientStairsForYaw, slabBottomId,
  slabPlacement, slabTopId, stairsBaseOf,
} from '../src/blocks';
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
import { buildChunkGeometry, TintSampler } from '../src/mesher';
import {
  collisionBoxes, FULL_BOX, SLAB_BOTTOM, SLAB_TOP, stairBoxes,
} from '../src/shapes';
import { Mobs, MOB_DEFS } from '../src/mobs';
import { Particles } from '../src/particles';
import { raycastBlocks } from '../src/interact';
import { Player } from '../src/player';
import { daylight } from '../src/sky';
import { Survival } from '../src/survival';
import { GameServer } from '../src/net/server_core';
import {
  mitigate, RANGED_MAX_RANGE, RANGED_MAX_DAMAGE, WORLD_HALF, WORLD_SEED,
  ARENA_CENTER_X, ARENA_CENTER_Z, ARENA_FLOOR_Y, ARENA_MAX_X, arenaSpawn, inArenaXZ,
} from '../src/net/protocol';
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
  deriveControlNodes, resolveNode, topScores, MAX_NODES,
} from '../src/territory';
import {
  FACTIONS, NO_FACTION, balancedFaction, factionColor, factionName, isFaction,
  sameFaction,
} from '../src/teams';
import { Accounts, validUsername } from '../src/net/accounts';
import {
  Claims, GRACE_PERIOD, MAX_SHIELD_HP, OIL_PER_BARREL, chunkOf, claimChunkKeys,
  claimProtected, damageShield, feedOil, inGrace, newClaim, sanitizeClaim,
  shieldUp, tickClaim,
} from '../src/claims';
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

// --- Ores + caves (layered tunnels + caverns carve real air) -----------------------
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
  check('layered caves carve meaningful air', air / total > 0.02 && air / total < 0.6,
    `${(air / total * 100).toFixed(1)}%`);
}

// --- Terrain overhaul (M21): rare ravines, caverns, big oceans, new biomes ----
{
  const t = new Terrain(1337);
  // Ravines are now rare: sample a wide grid of columns; the hit rate is low.
  let ravineHits = 0, samples = 0;
  for (let x = -2000; x <= 2000; x += 13) {
    for (let z = -2000; z <= 2000; z += 13) {
      samples++;
      if (t.ravineDepth(x, z) > 0) ravineHits++;
    }
  }
  const ravineRate = ravineHits / samples;
  check('ravines are rare showpieces (low hit rate)', ravineRate < 0.03,
    `${(ravineRate * 100).toFixed(2)}%`);
  check('ravineDepth is deterministic', t.ravineDepth(123, 456) === t.ravineDepth(123, 456));

  // Caverns: a large CONTIGUOUS air pocket appears underground. Flood-fill air in
  // a multi-chunk subsurface volume and assert the biggest room is big.
  {
    const W = 48, H = 48, D = 48, y0 = 6;
    const solid = new Uint8Array(W * H * D);
    for (let cx = 0; cx < 3; cx++) for (let cz = 0; cz < 3; cz++) {
      const c = new Chunk(cx, cz);
      t.fill(c);
      for (let lx = 0; lx < 16; lx++) for (let lz = 0; lz < 16; lz++) {
        for (let y = 0; y < H; y++) {
          const gx = cx * 16 + lx, gz = cz * 16 + lz;
          // 1 = air (carved/open below the surface), 0 = anything else.
          solid[(gx) + W * (y + H * gz)] = c.get(lx, y0 + y, lz) === Block.Air ? 1 : 0;
        }
      }
    }
    const idx = (x: number, y: number, z: number) => x + W * (y + H * z);
    const seen = new Uint8Array(W * H * D);
    let biggest = 0;
    for (let i = 0; i < solid.length; i++) {
      if (!solid[i] || seen[i]) continue;
      let size = 0; const stack = [i];
      seen[i] = 1;
      while (stack.length) {
        const k = stack.pop()!; size++;
        const x = k % W, y = Math.floor(k / W) % H, z = Math.floor(k / (W * H));
        const nb: [number, number, number][] = [
          [x + 1, y, z], [x - 1, y, z], [x, y + 1, z], [x, y - 1, z], [x, y, z + 1], [x, y, z - 1]];
        for (const [nx, ny, nz] of nb) {
          if (nx < 0 || nx >= W || ny < 0 || ny >= H || nz < 0 || nz >= D) continue;
          const ni = idx(nx, ny, nz);
          if (solid[ni] && !seen[ni]) { seen[ni] = 1; stack.push(ni); }
        }
      }
      biggest = Math.max(biggest, size);
    }
    check('caverns exist (a large contiguous air room is carved)', biggest > 250, `max room ${biggest}`);
  }

  // Oceans are bigger: ocean-column fraction over a wide sample is substantial.
  let ocean = 0, cols = 0;
  for (let x = -1600; x <= 1600; x += 23) {
    for (let z = -1600; z <= 1600; z += 23) {
      cols++;
      if (t.biomeWithWater(x, z, t.height(x, z)) === Biome.Ocean) ocean++;
    }
  }
  check('oceans are big (ocean fraction is substantial)', ocean / cols > 0.3,
    `${(ocean / cols * 100).toFixed(1)}%`);
  check('findSpawn still lands on dry land', t.findSpawn().y > SEA_LEVEL);

  // New signature biomes generate their blocks. Find a home chunk for each.
  const findHome = (b: Biome): [number, number] | null => {
    for (let cx = -240; cx <= 240; cx++) for (let cz = -240; cz <= 240; cz++) {
      const x = cx * 16 + 8, z = cz * 16 + 8;
      if (t.biomeWithWater(x, z, t.height(x, z)) === b) return [cx, cz];
    }
    return null;
  };
  const biomeBlocks = (home: [number, number] | null): Map<number, number> => {
    const m = new Map<number, number>();
    if (!home) return m;
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      const c = new Chunk(home[0] + dx, home[1] + dz);
      t.fill(c);
      for (let i = 0; i < c.data.length; i++) if (c.data[i]) m.set(c.data[i], (m.get(c.data[i]) ?? 0) + 1);
    }
    return m;
  };
  const mesa = biomeBlocks(findHome(Biome.Mesa));
  check('mesa generates red sand + terracotta bands',
    (mesa.get(Block.RedSand) ?? 0) > 100 && (mesa.get(Block.Terracotta) ?? 0) > 100);
  const ash = biomeBlocks(findHome(Biome.Ashlands));
  check('ashlands generate basalt + surface lava',
    (ash.get(Block.Basalt) ?? 0) > 100 && (ash.get(Block.Lava) ?? 0) > 0);
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
  // ItemEntities.spawn scatters drops with Math.random; seed it so the merge +
  // magnet assertions below are deterministic (no spurious flakes).
  const origRandom = Math.random;
  Math.random = mulberry32(0xa17e);
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
  Math.random = origRandom;
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
  // Melee PvP is DISABLED — fists/tools never damage players (guns-only PvP).
  const atk = fresh.handle(1, { t: 'attack', target: 2 });
  check('melee PvP is disabled (an attack deals no damage)', atk.length === 0);
  fresh.handle(2, { t: 'xform', x: 0, y: 70, z: 30, yaw: 0, pitch: 0 });

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

  // Arcade guns: distinct roles + craftable, and within the server damage cap.
  const Cb = Item.CobaltIngot, D = Item.Diamond, P = Block.OakPlanks;
  check('shotgun recipe', matchGrid(cellGrid([[I, I, I], [P, R, null]]))?.id === Item.Shotgun);
  check('smg recipe', matchGrid(cellGrid([[I, I, R], [Cb, R, null]]))?.id === Item.SMG);
  check('sniper recipe', matchGrid(cellGrid([[I, I, I], [null, R, D], [Cb, null, null]]))?.id === Item.Sniper);
  check('burst rifle recipe', matchGrid(cellGrid([[I, I, I], [Cb, R, R]]))?.id === Item.BurstRifle);
  check('shotgun sprays multiple pellets', (ITEMS[Item.Shotgun].gun?.pellets ?? 0) >= 5);
  check('smg is full-auto', ITEMS[Item.SMG].gun?.auto === true);
  check('burst rifle fires a 3-round burst', (ITEMS[Item.BurstRifle].gun?.burst ?? 0) === 3);
  check('sniper hits hard but stays under the server damage cap',
    (ITEMS[Item.Sniper].gun?.damage ?? 0) > 18 &&
    (ITEMS[Item.Sniper].gun?.damage ?? 99) <= RANGED_MAX_DAMAGE);
  check('every gun draws from a real ammo reserve',
    [Item.Shotgun, Item.SMG, Item.Sniper, Item.BurstRifle].every(
      (g) => (ITEMS[g].gun?.ammo ?? 0) === Item.Bullet && (ITEMS[g].gun?.mag ?? 0) > 0));

  // Gun aim-down-sights: scoped guns define a zoom (sniper most); the shotgun
  // is a hip-fire brawler with no scope.
  check('scoped guns define an ADS zoom; the sniper zooms most',
    (ITEMS[Item.Sniper].gun?.zoom ?? 1) >= 4 &&
    (ITEMS[Item.Sniper].gun?.zoom ?? 0) > (ITEMS[Item.Rifle].gun?.zoom ?? 0) &&
    (ITEMS[Item.Rifle].gun?.zoom ?? 0) > 1);
  check('the shotgun is a hip-fire brawler (no ADS zoom)',
    ITEMS[Item.Shotgun].gun?.zoom === undefined);

  // Glider: equips into the chestplate slot, grants no defense, early-game craft.
  {
    const gInv = new Inventory();
    gInv.add(Item.Glider, 1);
    const equipped = gInv.tryEquipArmor(0);
    check('glider equips into the chestplate slot',
      equipped && gInv.chestplateStack?.id === Item.Glider);
    check('a worn glider grants no armor defense', gInv.armorPoints() === 0);
    check('glider craft is cheap (sticks + planks)',
      matchGrid(cellGrid([[Item.Stick, Item.Stick, Item.Stick],
        [Block.OakPlanks, null, Block.OakPlanks]]))?.id === Item.Glider);
  }

  // Glide flight: a mid-air jump deploys the worn glider; you then travel fast
  // and sink gently, and a second jump stows it.
  {
    const flat = { ...IDLE_INPUT } as never;
    const jump = { ...IDLE_INPUT, jump: true } as never;
    const gp = new Player({ x: spawn.x, y: spawn.y + 45, z: spawn.z });
    gp.gliderEquipped = true; gp.yaw = 0; gp.pitch = 0;
    gp.update(1 / 60, jump, world); // rising-edge jump in mid-air -> deploy
    const deployed = gp.gliding;
    const y0 = gp.pos.y, z0 = gp.pos.z;
    for (let i = 0; i < 60; i++) gp.update(1 / 60, flat, world);
    const sink = y0 - gp.pos.y, travel = Math.abs(gp.pos.z - z0);
    check('glider: mid-air jump deploys it; fast travel + gentle descent',
      deployed && gp.gliding && travel > 8 && sink < 7,
      `deployed=${deployed} travel=${travel.toFixed(1)} sink=${sink.toFixed(1)}`);
    gp.update(1 / 60, jump, world); // jump again -> stow
    check('glider: a second mid-air jump stops gliding', !gp.gliding);
  }

  // Spawn safety: random spawns are always solid dry ground (never air/water).
  {
    let allDry = true, detail = '';
    for (let sd = 1; sd <= 40; sd++) {
      const terr = new Terrain(0x51b0 + sd * 131);
      const sp = terr.randomDrySpawn(mulberry32(sd * 7 + 3), 500);
      const hx = Math.floor(sp.x), hz = Math.floor(sp.z);
      const h = terr.height(hx, hz);
      if (!(sp.y > SEA_LEVEL && sp.y === h + 1 && terr.ravineDepth(hx, hz) === 0)) {
        allDry = false; detail = `seed ${sd}: y=${sp.y} h=${h}`; break;
      }
    }
    check('random spawns are solid dry ground (never air, never water)', allDry, detail);

    const terr = new Terrain(0xc0ffee);
    const sp = terr.randomDrySpawn(mulberry32(123), 500);
    const ch = new Chunk(Math.floor(sp.x) >> 4, Math.floor(sp.z) >> 4);
    terr.fill(ch);
    const lx = ((Math.floor(sp.x) % 16) + 16) % 16;
    const lz = ((Math.floor(sp.z) % 16) + 16) % 16;
    const below = ch.get(lx, Math.floor(sp.y) - 1, lz);
    const feet = ch.get(lx, Math.floor(sp.y), lz);
    const head = ch.get(lx, Math.floor(sp.y) + 1, lz);
    check('spawn column: solid block underfoot, clear air at feet + head',
      isSolid(below) && feet === Block.Air && head === Block.Air,
      `below=${below} feet=${feet} head=${head}`);
  }

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

// --- Arena: flat platform terrain + free-for-all server rules ----------------
{
  // The arena is a fixed flat platform region (seed-independent).
  const terr = new Terrain(WORLD_SEED);
  const ccx = ARENA_CENTER_X >> 4, ccz = ARENA_CENTER_Z >> 4;
  const ch = new Chunk(ccx, ccz);
  terr.fill(ch);
  const lx = ARENA_CENTER_X - ccx * 16, lz = ARENA_CENTER_Z - ccz * 16;
  check('arena platform: solid floor, open air above, void below',
    isSolid(ch.get(lx, ARENA_FLOOR_Y, lz)) &&
    ch.get(lx, ARENA_FLOOR_Y + 3, lz) === Block.Air &&
    ch.get(lx, ARENA_FLOOR_Y - 4, lz) === Block.Air);

  // A perimeter column (max-X edge) carries the border wall.
  const ex = ARENA_MAX_X - 1, ecx = ex >> 4;
  const ech = new Chunk(ecx, ccz);
  terr.fill(ech);
  check('arena has a perimeter border wall',
    ech.get(ex - ecx * 16, ARENA_FLOOR_Y + 1, lz) === Block.Cobblestone);

  check('arenaSpawn lands inside the footprint, on the floor', (() => {
    for (let i = 0; i < 20; i++) {
      const sp = arenaSpawn(mulberry32(i + 1));
      if (!inArenaXZ(sp.x, sp.z) || sp.y !== ARENA_FLOOR_Y + 1) return false;
    }
    return true;
  })());

  // FFA: same-faction players can't hurt each other in civilisation, but CAN in
  // the arena; and an arena player and a civilian can never trade damage.
  const a = new GameServer(WORLD_SEED, mulberry32(9));
  a.addPlayer(1, { faction: FACTIONS[0].id, username: 'Aa' });
  a.addPlayer(2, { faction: FACTIONS[0].id, username: 'Bb' });
  const ahp = (id: number) => a.snapshot().find((p) => p.id === id)!.health;
  const face = () => {
    a.handle(1, { t: 'xform', x: ARENA_CENTER_X, y: ARENA_FLOOR_Y + 1, z: ARENA_CENTER_Z, yaw: Math.PI, pitch: 0 });
    a.handle(2, { t: 'xform', x: ARENA_CENTER_X, y: ARENA_FLOOR_Y + 1, z: ARENA_CENTER_Z + 8, yaw: 0, pitch: 0 });
  };
  face();
  const civ0 = ahp(2);
  a.handle(1, { t: 'rangedAttack', target: 2, amount: 8 });
  check('same-faction friendly fire is OFF in civilisation', ahp(2) === civ0);

  a.handle(1, { t: 'arena', on: true });
  a.handle(2, { t: 'arena', on: true });
  face();
  const ffa0 = ahp(2);
  a.handle(1, { t: 'rangedAttack', target: 2, amount: 8 });
  check('arena is free-for-all: same-faction arena players CAN kill each other', ahp(2) < ffa0);

  a.handle(2, { t: 'arena', on: false }); // player 2 returns to civilisation
  face();
  const split0 = ahp(2);
  a.handle(1, { t: 'rangedAttack', target: 2, amount: 8 });
  check('an arena player cannot damage a civilian (separate space)', ahp(2) === split0);

  // Entering the arena teleports the player onto the platform.
  const tp = a.handle(1, { t: 'arena', on: false }); // toggle back to known state then in
  void tp;
  const inMsgs = a.handle(1, { t: 'arena', on: true });
  const tpMsg = inMsgs.find((o) => o.msg.t === 'teleport');
  check('entering the arena teleports the player onto the platform',
    !!tpMsg && tpMsg.msg.t === 'teleport' && inArenaXZ(tpMsg.msg.x, tpMsg.msg.z));
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
  check('a single faction present controls a node',
    resolveNode(node, [{ faction: 0, x: 1, z: 1, dead: false }]).faction === 0);
  check('two members of one faction still control (team play)', (() => {
    const r = resolveNode(node, [
      { faction: 1, x: 1, z: 1, dead: false }, { faction: 1, x: -1, z: -1, dead: false }]);
    return r.faction === 1 && !r.contested;
  })());
  check('two factions contest a node (no controller)', (() => {
    const r = resolveNode(node, [
      { faction: 0, x: 1, z: 1, dead: false }, { faction: 1, x: -1, z: -1, dead: false }]);
    return r.faction === -1 && r.controller === '' && r.contested;
  })());
  check('a player outside the radius does not control',
    resolveNode(node, [{ faction: 0, x: 50, z: 50, dead: false }]).faction === -1);

  check('topScores sorts descending', (() => {
    const m = new Map([['A', 5], ['B', 30], ['C', 12]]);
    const top = topScores(m);
    return top[0].name === 'B' && top[1].name === 'C' && top[2].name === 'A';
  })());

  // Standings = current oil-node holdings per faction (no more round/win race).
  const s = new GameServer(1337, mulberry32(33));
  s.addPlayer(1); // faction 0
  const snap0 = s.territorySnapshot() as { t: 'territory'; nodes: { x: number; z: number }[] };
  const target = snap0.nodes[0];
  s.handle(1, { t: 'xform', x: target.x, y: 70, z: target.z, yaw: 0, pitch: 0 });
  s.tickTerritory(1);
  const standings = s.territorySnapshot() as {
    t: 'territory'; scores: { name: string; score: number }[]; winner: string;
  };
  check('controlling a node shows up as faction node-holdings (no win race)',
    standings.winner === '' &&
    (standings.scores.find((e) => e.name === factionName(0))?.score ?? 0) >= 1);
  check('territory snapshot has the expected shape', (() => {
    const snap = s.territorySnapshot() as {
      t: 'territory'; nodes: unknown[]; scores: unknown[]; roundTime: number;
    };
    return snap.t === 'territory' && Array.isArray(snap.nodes) &&
      Array.isArray(snap.scores) && Number.isFinite(snap.roundTime);
  })());

  // --- M20: territory accrues OIL INCOME to the controlling faction's claims ---
  {
    const g = new GameServer(1337, mulberry32(91));
    g.addPlayer(1); // faction 0
    const snap = g.territorySnapshot() as { t: 'territory'; nodes: { x: number; z: number }[] };
    const target = snap.nodes[0];
    // Place a Core (claim) for faction 0 well away from the node.
    g.handle(1, { t: 'xform', x: 0.5, y: 70, z: 0.5, yaw: 0, pitch: 0 });
    const cm = g.handle(1, { t: 'edit', x: 0, y: 70, z: 0, block: Block.Core })
      .find((o) => o.msg.t === 'claim')!.msg as { claim: { id: number; oil: number } };
    check('a fresh claim starts with no oil', cm.claim.oil === 0);
    // Stand on the node so faction 0 controls it; income should fill the claim.
    g.handle(1, { t: 'xform', x: target.x, y: 70, z: target.z, yaw: 0, pitch: 0 });
    for (let i = 0; i < 5; i++) g.tickTerritory(1);
    const fueled = (g.handle(1, { t: 'xform', x: 0.5, y: 70, z: 0.5, yaw: 0, pitch: 0 }),
      g.handle(1, { t: 'claimOpen', x: 0, y: 70, z: 0 })
        .find((o) => o.msg.t === 'claim')!.msg as { claim: { oil: number } }).claim.oil;
    check('controlling a node accrues oil to the faction claim', fueled > 0);
    // Leave the node: income stops (oil no longer climbs from territory).
    g.handle(1, { t: 'xform', x: 9000, y: 70, z: 9000, yaw: 0, pitch: 0 });
    for (let i = 0; i < 3; i++) g.tickTerritory(1);
    const after = (g.handle(1, { t: 'xform', x: 0.5, y: 70, z: 0.5, yaw: 0, pitch: 0 }),
      g.handle(1, { t: 'claimOpen', x: 0, y: 70, z: 0 })
        .find((o) => o.msg.t === 'claim')!.msg as { claim: { oil: number } }).claim.oil;
    check('losing all nodes drops territory oil income to zero',
      Math.abs(after - fueled) < 1e-6);
    // Standings readout = live node holdings, keyed by faction name: it shows the
    // faction while it holds a node, and empties once it controls none.
    g.handle(1, { t: 'xform', x: target.x, y: 70, z: target.z, yaw: 0, pitch: 0 });
    g.tickTerritory(1);
    const onNode = g.territorySnapshot() as { t: 'territory'; scores: { name: string; score: number }[] };
    check('the standings readout tracks node control by faction',
      (onNode.scores.find((e) => e.name === factionName(0))?.score ?? 0) >= 1);
    g.handle(1, { t: 'xform', x: 9000, y: 70, z: 9000, yaw: 0, pitch: 0 });
    g.tickTerritory(1);
    const offNode = g.territorySnapshot() as { t: 'territory'; scores: unknown[] };
    check('standings empty when a faction holds no nodes', offNode.scores.length === 0);
  }
}

// --- Factions (M17): auto-balance + friendly fire off ------------------------
{
  // Pure team helpers.
  check('three preset factions with distinct colors + names',
    FACTIONS.length === 3 &&
    new Set(FACTIONS.map((f) => f.color)).size === 3 &&
    new Set(FACTIONS.map((f) => f.name)).size === 3);
  check('sameFaction only matches a shared, real faction',
    sameFaction(0, 0) && !sameFaction(0, 1) &&
    !sameFaction(NO_FACTION, NO_FACTION) && !isFaction(NO_FACTION));
  check('balancedFaction picks the lowest-population team',
    balancedFaction({ 0: 3, 1: 1, 2: 2 }) === 1 &&
    balancedFaction({ 0: 0, 1: 0, 2: 0 }) === 0);
  check('factionName/factionColor fall back to neutral',
    factionName(NO_FACTION) === 'Neutral' && factionColor(NO_FACTION) === 0x9a9a9a);

  // Server auto-balances joins evenly across the three factions.
  const factionOf = (out: ReturnType<GameServer['addPlayer']>): number => {
    const w = out.find((o) => o.msg.t === 'welcome')!.msg as { players: { faction: number }[] };
    return w.players[w.players.length - 1].faction;
  };
  const s = new GameServer(1337, mulberry32(7));
  const facs: number[] = [];
  for (let i = 1; i <= 6; i++) facs.push(factionOf(s.addPlayer(i)));
  const counts = [0, 0, 0];
  for (const f of facs) counts[f]++;
  check('auto-balance spreads 6 joins evenly across 3 factions',
    counts[0] === 2 && counts[1] === 2 && counts[2] === 2);
  // Joins 1 & 4 land in the same faction; 1 & 2 are enemies.
  check('the same-faction / cross-faction pairs are as expected',
    facs[0] === facs[3] && facs[0] !== facs[1]);

  // Position three players together: 1 (ally of 4) attacks 4 then 2.
  s.handle(1, { t: 'xform', x: 0, y: 70, z: 0, yaw: -Math.PI / 2, pitch: 0 });
  s.handle(2, { t: 'xform', x: 2, y: 70, z: 0, yaw: 0, pitch: 0 });
  s.handle(4, { t: 'xform', x: 2, y: 70, z: 0, yaw: 0, pitch: 0 });
  check('melee never damages players (disabled for all factions)',
    !s.handle(1, { t: 'attack', target: 4 }).some((o) => o.msg.t === 'hurt') &&
    !s.handle(1, { t: 'attack', target: 2 }).some((o) => o.msg.t === 'hurt'));
  check('same-faction ranged is rejected',
    !s.handle(1, { t: 'rangedAttack', target: 4, amount: 10 }).some((o) => o.msg.t === 'hurt'));
  check('cross-faction ranged applies',
    s.handle(1, { t: 'rangedAttack', target: 2, amount: 10 }).some((o) => o.msg.t === 'hurt'));

  // Ship: launched by player 1 (faction A). Ally 4 can't shell it; enemy 2 can.
  s.handle(1, { t: 'edit', x: 0, y: 70, z: 0, block: Block.ShipHelm });
  s.handle(1, { t: 'edit', x: 1, y: 70, z: 0, block: Block.Cannon });
  const sid = (s.handle(1, { t: 'shipLaunch', x: 0, y: 70, z: 0 })
    .find((o) => o.msg.t === 'shipState')!.msg as { ship: { id: number; faction: number } }).ship;
  check('a launched ship carries its owner faction', sid.faction === facs[0]);
  s.handle(4, { t: 'xform', x: 2, y: 70, z: 0, yaw: 0, pitch: 0 });
  s.handle(2, { t: 'xform', x: 2, y: 70, z: 0, yaw: 0, pitch: 0 });
  check('same-faction ship hit is rejected',
    s.handle(4, { t: 'shipHit', id: sid.id, amount: 20 }).length === 0);
  check('cross-faction ship hit applies',
    s.handle(2, { t: 'shipHit', id: sid.id, amount: 20 }).some((o) => o.msg.t === 'shipTransforms'));

  // Turret claimed by player 1 (faction A): ignores ally 4, fires on enemy 2.
  s.handle(1, { t: 'xform', x: 40, y: 70, z: 40, yaw: 0, pitch: 0 });
  s.handle(1, { t: 'edit', x: 41, y: 70, z: 40, block: Block.Turret });
  s.handle(1, { t: 'turretClaim', x: 41, y: 70, z: 40 });
  s.handle(1, { t: 'turretLoad', x: 41, y: 70, z: 40, item: Item.Cannonball, count: 50 });
  s.handle(1, { t: 'turretLoad', x: 41, y: 70, z: 40, item: Item.OilBarrel, count: 20 });
  s.handle(4, { t: 'xform', x: 44, y: 70, z: 40, yaw: 0, pitch: 0 }); // ally in range
  s.handle(2, { t: 'xform', x: 500, y: 70, z: 500, yaw: 0, pitch: 0 });
  check('a turret never fires on a same-faction player',
    s.tickTurrets(2).every((o) => o.msg.t !== 'turretFire'));
  s.handle(2, { t: 'xform', x: 44, y: 70, z: 40, yaw: 0, pitch: 0 }); // enemy in range
  s.handle(4, { t: 'xform', x: 500, y: 70, z: 500, yaw: 0, pitch: 0 });
  check('a turret fires on a cross-faction player',
    s.tickTurrets(2).some((o) => o.msg.t === 'turretFire'));
}

// --- Accounts: login / register foundation -----------------------------------
{
  // A fake deterministic hasher (the real shell uses Node scrypt).
  const hash: (p: string, s: string) => string = (p, s) => `${s}:${p}`;
  check('username validation enforces 3–16 word chars',
    validUsername('Ace_99') && !validUsername('ab') && !validUsername('has space') &&
    !validUsername('waytoolongusername123'));

  const accs = new Accounts();
  const r1 = accs.register('Alice', 'hunter2', hash, 'saltA');
  check('register creates an account with a faction',
    r1.ok && !!r1.account && FACTIONS.some((f) => f.id === r1.account!.faction));
  check('register rejects a short password',
    !accs.register('Bob', 'xy', hash, 's').ok);
  check('register rejects a duplicate (case-insensitive) name',
    !accs.register('alice', 'whatever', hash, 's').ok);

  // Faction auto-balance spreads registrations across the 3 teams.
  for (const n of ['Bob', 'Cara', 'Dan', 'Eve', 'Fin']) accs.register(n, 'password', hash, 's');
  const counts = [0, 0, 0];
  for (const a of accs.list()) counts[a.faction]++;
  check('registrations auto-balance across factions (max-min <= 1)',
    Math.max(...counts) - Math.min(...counts) <= 1);

  // Login verifies the password; wrong password + unknown user are rejected.
  check('login succeeds with the right password',
    accs.login('Alice', 'hunter2', hash).ok);
  check('login fails with a wrong password', !accs.login('Alice', 'nope', hash).ok);
  check('login fails for an unknown user', !accs.login('Ghost', 'x', hash).ok);
  check('the stored hash is never the raw password',
    accs.get('Alice')!.hash !== 'hunter2');

  // Serialize -> reload round-trips (the shell persists this to disk).
  const reloaded = new Accounts(JSON.parse(JSON.stringify(accs.toJSON())));
  check('accounts survive a JSON round-trip + still authenticate',
    reloaded.size === accs.size && reloaded.login('Alice', 'hunter2', hash).ok &&
    reloaded.get('Alice')!.faction === accs.get('Alice')!.faction);
}

// --- World + per-account persistence ----------------------------------------
{
  // World serialize -> restore round-trips player-made changes through disk.
  const a = new GameServer(1337, mulberry32(77));
  a.addPlayer(1);
  a.handle(1, { t: 'xform', x: 0, y: 70, z: 0, yaw: 0, pitch: 0 });
  a.handle(1, { t: 'edit', x: 1, y: 69, z: 1, block: Block.Cobblestone });
  const saveBlob = JSON.parse(JSON.stringify(a.serialize())); // through "disk"
  check('serialize captures the seed + a placed edit',
    saveBlob.seed === 1337 &&
    saveBlob.edits.some((e: [string, number]) => e[0] === '1,69,1' && e[1] === Block.Cobblestone));

  const b = new GameServer(1337, mulberry32(78));
  check('restore loads a saved world', b.restore(saveBlob) === true);
  const wB = b.addPlayer(5).find((o) => o.to === 5)!.msg;
  check('a restored edit shows up in the next welcome',
    wB.t === 'welcome' &&
    wB.edits.some((e) => e[0] === '1,69,1' && e[1] === Block.Cobblestone));
  check('restore refuses a save from a different seed',
    new GameServer(999, mulberry32(1)).restore({ ...saveBlob, seed: 1337 }) === false ||
    new GameServer(1337, mulberry32(1)).restore({ ...saveBlob, seed: 4242 }) === false);
  check('restore fail-closes on garbage', new GameServer(1337, mulberry32(1)).restore(null) === false);

  // Per-account state: position + inventory round-trip through addPlayer/capture.
  const c = new GameServer(1337, mulberry32(79));
  const savedData = { x: 12.5, y: 71, z: -4.5, yaw: 1.5, slots: [{ id: Item.Bullet, count: 30 }] };
  const wc = c.addPlayer(2, { username: 'Saver', faction: 0, data: savedData }).find((o) => o.to === 2)!.msg;
  check('a returning account spawns at its saved position',
    wc.t === 'welcome' && wc.players[0].x === 12.5 && wc.players[0].z === -4.5);
  check('the saved inventory blob rides along in the welcome state',
    wc.t === 'welcome' && !!wc.state &&
    (wc.state.slots as { id: number }[])[0].id === Item.Bullet);
  c.handle(2, { t: 'saveState', data: { slots: [{ id: Item.Rocket, count: 3 }] } });
  c.handle(2, { t: 'xform', x: 50, y: 72, z: 50, yaw: 0, pitch: 0 });
  const cap = c.capturePlayerState(2);
  check('capturePlayerState merges the latest blob with authoritative position',
    !!cap && cap.username === 'Saver' &&
    (cap!.data.slots as { id: number }[])[0].id === Item.Rocket &&
    cap!.data.x === 50 && cap!.data.z === 50);

  // Inventory serialize/restore (the client-owned half of the blob).
  const inv = new Inventory();
  inv.slots[0] = { id: Item.Sniper, count: 1, loaded: 3 };
  inv.slots[5] = { id: Block.Cobblestone, count: 40 };
  inv.slots[ARMOR_START] = { id: Item.IronHelmet, count: 1, xp: 120 };
  inv.selected = 5;
  const blob = JSON.parse(JSON.stringify(inv.serialize()));
  const inv2 = new Inventory();
  inv2.restore(blob);
  check('inventory restore round-trips carried items, magazine, armor + selection',
    inv2.slots[0]?.id === Item.Sniper && inv2.slots[0]?.loaded === 3 &&
    inv2.slots[5]?.count === 40 && inv2.slots[ARMOR_START]?.id === Item.IronHelmet &&
    inv2.slots[ARMOR_START]?.xp === 120 && inv2.selected === 5);
  inv2.restore({ slots: [{ id: 99999, count: 5 }, { id: Item.Bullet, count: -3 }] });
  check('inventory restore fail-closes on impossible items',
    inv2.slots[0] === null && inv2.slots[1] === null);
}

// --- Admin (server-console) operations --------------------------------------
{
  const g = new GameServer(1337, mulberry32(321));
  g.addPlayer(1, { username: 'Admin1', faction: 0 });
  g.addPlayer(2, { username: 'Victim2', faction: 1 });
  // Lookup by name (case-insensitive) + roster.
  check('playerIdByName resolves online players (case-insensitive)',
    g.playerIdByName('admin1') === 1 && g.playerIdByName('nope') === undefined);
  check('playerList reports id/username/faction/mode',
    g.playerList().length === 2 && g.playerList()[0].mode === 'survival');

  // give → a gotitem to that player only.
  const give = g.adminGive(1, Item.Diamond, 5);
  check('adminGive sends the items to just that player',
    give.length === 1 && give[0].to === 1 && give[0].msg.t === 'gotitem' &&
    give[0].msg.item === Item.Diamond && give[0].msg.count === 5);
  check('adminGive rejects an unknown item id', g.adminGive(1, 999999, 5).length === 0);

  // gamemode → broadcast + the player's welcome now carries the new mode.
  const gm = g.adminSetMode(2, 'creative');
  check('adminSetMode broadcasts the gamemode + notices the target',
    gm.some((o) => o.to === 'all' && o.msg.t === 'gamemode' && o.msg.mode === 'creative') &&
    gm.some((o) => o.to === 2 && o.msg.t === 'notice'));
  const wj = g.addPlayer(9).find((o) => o.to === 9)!.msg;
  check('a creative player shows mode=creative in the next welcome roster',
    wj.t === 'welcome' && wj.players.find((p) => p.id === 2)!.mode === 'creative');

  // Creative/spectator are server-side invulnerable.
  g.handle(1, { t: 'xform', x: 0, y: 70, z: 0, yaw: Math.PI, pitch: 0 });
  g.handle(2, { t: 'xform', x: 0, y: 70, z: 1.2, yaw: 0, pitch: 0 });
  check('a creative player takes no melee damage',
    g.handle(1, { t: 'attack', target: 2 }).every((o) => o.msg.t !== 'hurt'));

  // Spectators can't mutate the world (edit dropped) but can still move.
  g.adminSetMode(2, 'spectator');
  const before = (g.addPlayer(10).find((o) => o.to === 10)!.msg as { edits: unknown[] }).edits.length;
  g.handle(2, { t: 'edit', x: 0, y: 69, z: 1, block: Block.Cobblestone });
  const after = (g.addPlayer(11).find((o) => o.to === 11)!.msg as { edits: unknown[] }).edits.length;
  check('a spectator edit is rejected (no new world edit)', before === after);

  // teleport snaps the player + tells them.
  const tp = g.adminTeleport(1, 100, 80, -50);
  check('adminTeleport moves the player + sends a teleport msg',
    tp.length === 1 && tp[0].to === 1 && tp[0].msg.t === 'teleport' && tp[0].msg.x === 100);
  check('teleport updated the authoritative position',
    g.snapshot().find((s) => s.id === 1)!.x === 100);

  // Mode persists through the saved-state blob (capture → re-add).
  const cap = g.capturePlayerState(2);
  check('capturePlayerState carries the gamemode', cap!.data.mode === 'spectator');
  const g2 = new GameServer(1337, mulberry32(322));
  const w2 = g2.addPlayer(1, { username: 'Victim2', faction: 1, data: cap!.data }).find((o) => o.to === 1)!.msg;
  check('a returning player keeps their admin-set gamemode',
    w2.t === 'welcome' && w2.players[0].mode === 'spectator');
}

// --- World border + random dry spawn ----------------------------------------
{
  const g = new GameServer(1337, mulberry32(404));
  // Every random spawn lands on dry land inside the border, never in ocean/air.
  let allDry = true, allInBorder = true;
  for (let i = 0; i < 40; i++) {
    const w = g.addPlayer(100 + i).find((o) => o.to === 100 + i)!.msg;
    if (w.t !== 'welcome') continue;
    const me = w.players.find((p) => p.id === 100 + i)!;
    if (Math.abs(me.x) > WORLD_HALF || Math.abs(me.z) > WORLD_HALF) allInBorder = false;
    // Spawn y should sit just above solid ground (height+1), i.e. above sea.
    if (me.y < 64) allDry = false;
  }
  check('random spawns all land inside the world border', allInBorder);
  check('random spawns are on dry land (above sea level)', allDry);

  // A transform beyond the border is clamped to it (server-authoritative).
  const g2 = new GameServer(1337, mulberry32(405));
  g2.addPlayer(1);
  g2.handle(1, { t: 'xform', x: 99999, y: 70, z: -99999, yaw: 0, pitch: 0 });
  const s = g2.snapshot().find((p) => p.id === 1)!;
  check('out-of-border movement is clamped to ±WORLD_HALF',
    s.x === WORLD_HALF && s.z === -WORLD_HALF);
}

// --- Land claims + oil shield (M18) + raiding (M19) --------------------------
{
  // Pure claim helpers.
  check('chunkOf + claimChunkKeys cover a 3×3 footprint',
    chunkOf(20, -5).cx === 1 && chunkOf(20, -5).cz === -1 &&
    claimChunkKeys(0, 0).length === 9);
  const c0 = newClaim(1, 0, 0, 70, 0, 0);
  check('a fresh claim has a full shield + grace',
    c0.shieldHp === MAX_SHIELD_HP && shieldUp(c0) && inGrace(c0, 0) &&
    claimProtected(c0, 0));
  check('grace expires after GRACE_PERIOD', !inGrace(c0, GRACE_PERIOD + 1));

  // Regen only while oil>0 (and drains oil); no oil -> passive decay to 0.
  const fueled = newClaim(2, 0, 0, 70, 0, 0);
  fueled.shieldHp = 500; fueled.oil = 100;
  const oilBefore = fueled.oil;
  tickClaim(fueled, 1);
  check('a fuelled below-max shield regenerates and drains oil',
    fueled.shieldHp > 500 && fueled.oil < oilBefore);
  const dry = newClaim(3, 0, 0, 70, 0, 0);
  dry.shieldHp = 500; dry.oil = 0;
  tickClaim(dry, 1);
  check('an unfuelled shield decays (no regen)', dry.shieldHp < 500);
  // Run it dry: with no oil it eventually drops to 0 (raidable).
  for (let i = 0; i < 400; i++) tickClaim(dry, 1);
  check('an unfuelled shield decays all the way to raidable',
    dry.shieldHp === 0 && !shieldUp(dry));

  check('feedOil tops the buffer in barrel units',
    feedOil(newClaim(4, 0, 0, 70, 0, 0), 3) === 3 &&
    (() => { const c = newClaim(5, 0, 0, 70, 0, 0); feedOil(c, 2); return c.oil === 2 * OIL_PER_BARREL; })());
  check('damageShield drives the shield down + reports it',
    (() => { const c = newClaim(6, 0, 0, 70, 0, 0); return !damageShield(c, 10) && damageShield(c, MAX_SHIELD_HP); })());
  check('sanitizeClaim clamps oil/shield + rejects junk',
    sanitizeClaim(null) === null &&
    (() => { const c = sanitizeClaim({ id: 1, faction: 0, coreX: 0, coreY: 1, coreZ: 0, oil: 1e9, shieldHp: 1e9 })!;
      return c.oil <= 4000 && c.shieldHp <= MAX_SHIELD_HP; })());

  // Claims manager: overlap rejection + chunk lookup.
  const mgr = new Claims();
  check('placing a Core claims a 3×3 footprint + indexes it',
    !!mgr.create(0, 0, 70, 0, 0) && !!mgr.at(20, 0) && !!mgr.at(-10, -10) && !mgr.at(40, 0));
  check('an overlapping claim is rejected, a distant one allowed',
    mgr.create(1, 10, 70, 10, 0) === null && !!mgr.create(1, 200, 70, 200, 0));

  // --- Server: place, protect, breach, raid (the demonstrable loop) ---
  const s = new GameServer(1337, mulberry32(7)); // joins -> 1:fA, 2:fB, ...
  s.addPlayer(1); s.addPlayer(2);
  s.handle(1, { t: 'xform', x: 0.5, y: 70, z: 0.5, yaw: 0, pitch: 0 });
  const placeOut = s.handle(1, { t: 'edit', x: 0, y: 70, z: 0, block: Block.Core });
  const claimMsg = placeOut.find((o) => o.msg.t === 'claim');
  check('placing a Core broadcasts a claim for the placer faction',
    !!claimMsg && (claimMsg!.msg as { claim: { faction: number } }).claim.faction === 0);

  // Enemy (player 2) cannot edit inside the up/graced claim; owner can.
  s.handle(2, { t: 'xform', x: 2.5, y: 70, z: 0.5, yaw: 0, pitch: 0 });
  check('an enemy edit inside an up shield is rejected',
    s.handle(2, { t: 'edit', x: 2, y: 70, z: 0, block: Block.Stone }).length === 0);
  check('a faction member edit inside the claim is allowed',
    s.handle(1, { t: 'edit', x: 2, y: 71, z: 0, block: Block.Stone })
      .some((o) => o.msg.t === 'edit'));
  check('an enemy can never break the Core itself',
    s.handle(2, { t: 'edit', x: 0, y: 70, z: 0, block: Block.Air }).length === 0);

  // Grace alone blocks raids even with the shield knocked to 0.
  for (let i = 0; i < 20; i++) s.handle(2, { t: 'claimHit', x: 0, y: 70, z: 0, amount: 200 });
  check('grace blocks a raid even with the shield at 0',
    s.handle(2, { t: 'edit', x: 2, y: 70, z: 0, block: Block.Air }).length === 0);

  // Past grace + drained shield -> the claim is raidable.
  s.tickClaims(GRACE_PERIOD + 400); // expire grace; with no oil the shield bleeds to 0
  check('after grace + fuel-starvation the claim is breached',
    s.handle(2, { t: 'edit', x: 3, y: 70, z: 0, block: Block.Stone }).some((o) => o.msg.t === 'edit'));

  // Raid a stored chest: a capped fraction goes to the raider, the rest spills.
  s.handle(1, { t: 'edit', x: 1, y: 70, z: 0, block: Block.Chest });
  s.handle(1, { t: 'chestSet', x: 1, y: 70, z: 0, slots: [{ id: Item.IronIngot, count: 10 }] });
  s.handle(2, { t: 'xform', x: 1.6, y: 70, z: 0.5, yaw: 0, pitch: 0 });
  const raid = s.handle(2, { t: 'edit', x: 1, y: 70, z: 0, block: Block.Air });
  const got = raid.find((o) => o.msg.t === 'gotitem' && o.to === 2);
  const spill = raid.find((o) => o.msg.t === 'itemspawn');
  check('raiding a chest gives the raider exactly the capped fraction',
    !!got && (got!.msg as { count: number }).count === 5 &&
    !!spill && (spill!.msg as { item: { count: number } }).item.count === 5);

  // A fuelled shield out-paces a lone attacker (bursts with reload gaps that let
  // regen resume) but falls to sustained multi-source fire (regen never clears).
  const lone = newClaim(10, 0, 0, 70, 0, 0); lone.oil = 2000;
  for (let i = 0; i < 80; i++) { if (i % 6 === 0) damageShield(lone, 30); tickClaim(lone, 1); }
  check('a fuelled shield holds vs a single attacker', lone.shieldHp > 800);
  const swarm = newClaim(11, 0, 0, 70, 0, 0); swarm.oil = 2000;
  for (let i = 0; i < 120; i++) { damageShield(swarm, 12); tickClaim(swarm, 1); }
  check('a fuelled shield falls to sustained multi-hit fire', swarm.shieldHp === 0);

  // The Core survives a raid: the claim still exists + can be re-fuelled.
  s.handle(1, { t: 'xform', x: 0.5, y: 70, z: 0.5, yaw: 0, pitch: 0 });
  const fed = s.handle(1, { t: 'claimFeed', x: 0, y: 70, z: 0, count: 5 });
  check('the Core persists through a raid and can be re-fuelled',
    fed.some((o) => o.msg.t === 'claim' &&
      (o.msg as { claim: { oil: number } }).claim.oil > 0));
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

// --- Partial (shape-aware) collision + auto-step + top slabs (M16) -----------
{
  // collisionBoxes: the single source of truth for both render + physics shapes.
  check('collisionBoxes: full cube -> one full box', (() => {
    const b = collisionBoxes(Block.Stone);
    return b.length === 1 && b[0][0][1] === 0 && b[0][1][1] === 1;
  })());
  check('collisionBoxes: bottom slab -> lower half', (() => {
    const b = collisionBoxes(Block.OakSlab);
    return b.length === 1 && b[0][0][1] === 0 && b[0][1][1] === 0.5;
  })());
  check('collisionBoxes: top slab -> upper half', (() => {
    const b = collisionBoxes(Block.OakSlabTop);
    return b.length === 1 && b[0][0][1] === 0.5 && b[0][1][1] === 1;
  })());
  check('collisionBoxes: stairs -> two boxes (bottom slab + top quarter)',
    collisionBoxes(Block.OakStairsN).length === 2);
  check('collisionBoxes: non-solid (water/plant/torch) -> none',
    collisionBoxes(Block.Water).length === 0 &&
    collisionBoxes(Block.TallGrass).length === 0 &&
    collisionBoxes(Block.Torch).length === 0 &&
    collisionBoxes(Block.Air).length === 0);
  // Render boxes pick the right half + match the shared constants.
  check('SLAB_BOTTOM/SLAB_TOP/FULL_BOX match the slab halves',
    SLAB_BOTTOM[1][1] === 0.5 && SLAB_TOP[0][1] === 0.5 && FULL_BOX[1][1] === 1);

  // Top-slab block + helper wiring.
  check('slab helpers pair bottom <-> top per wood',
    isSlab(Block.OakSlab) && isSlab(Block.OakSlabTop) && !isSlab(Block.Stone) &&
    isTopSlab(Block.OakSlabTop) && !isTopSlab(Block.OakSlab) &&
    slabTopId(Block.BirchSlab) === Block.BirchSlabTop &&
    slabBottomId(Block.BirchSlabTop) === Block.BirchSlab &&
    slabBottomId(Block.SpruceSlab) === Block.SpruceSlab);
  check('top slabs stay <= 255 (Uint8 chunk data)', Block.SpruceSlabTop <= 255);

  // Placement mapping: top face / lower half -> bottom; bottom face / upper -> top.
  check('slabPlacement: top face -> bottom slab',
    slabPlacement(Block.OakSlab, 1, 0.9) === Block.OakSlab);
  check('slabPlacement: bottom face -> top slab',
    slabPlacement(Block.OakSlab, -1, 0.1) === Block.OakSlabTop);
  check('slabPlacement: side face lower half -> bottom, upper half -> top',
    slabPlacement(Block.OakSlab, 0, 0.2) === Block.OakSlab &&
    slabPlacement(Block.OakSlab, 0, 0.8) === Block.OakSlabTop);
  // The item stays the bottom slab: top slabs drop + pick-block to the bottom id.
  check('top slab drops the bottom-slab item',
    dropFor(Block.OakSlabTop, 0.5)?.id === Block.OakSlab &&
    dropFor(Block.SpruceSlabTop, 0.5)?.id === Block.SpruceSlab);

  // raycast now reports the world hit point (needed for top/bottom on side faces).
  {
    const origin = new THREE.Vector3(spawn.x, spawn.y + 1.62, spawn.z);
    const down = raycastBlocks(world, origin, new THREE.Vector3(0, -1, 0), 4.5);
    check('raycast reports a finite hit point on the targeted face',
      !!down && Number.isFinite(down.hx) && Number.isFinite(down.hy) &&
      Math.abs(down.hx - origin.x) < 1e-6 && down.hy <= origin.y + 1e-6);
  }

  // --- Player physics on partial shapes (headless, like the energy tests) ---
  const cx = Math.floor(spawn.x) + 5, cz = Math.floor(spawn.z) + 5, base = 235;
  const idle = { ...IDLE_INPUT } as never;
  const walk = { ...IDLE_INPUT, forward: true } as never;
  const clearRegion = () => {
    for (let dx = -2; dx <= 2; dx++)
      for (let dz = -2; dz <= 2; dz++)
        for (let dy = 0; dy <= 6; dy++)
          world.setBlock(cx + dx, base + dy, cz + dz, Block.Air);
  };
  const restOn = (id: number): Player => {
    clearRegion();
    world.setBlock(cx, base, cz, id);
    const p = new Player({ x: cx + 0.5, y: base + 3, z: cz + 0.5 });
    for (let i = 0; i < 240; i++) p.update(1 / 60, idle, world);
    return p;
  };
  const onBottom = restOn(Block.OakSlab);
  check('player falling onto a bottom slab rests at base+0.5',
    onBottom.onGround && Math.abs(onBottom.pos.y - (base + 0.5)) < 0.02,
    `y=${onBottom.pos.y.toFixed(3)}`);
  const onTop = restOn(Block.OakSlabTop);
  check('player falling onto a top slab rests at base+1',
    onTop.onGround && Math.abs(onTop.pos.y - (base + 1)) < 0.02,
    `y=${onTop.pos.y.toFixed(3)}`);
  const onCube = restOn(Block.Stone);
  check('player falling onto a full block rests at base+1',
    onCube.onGround && Math.abs(onCube.pos.y - (base + 1)) < 0.02,
    `y=${onCube.pos.y.toFixed(3)}`);

  // Auto-step: walk into a slab/stair step on a floor and climb it without
  // jumping. A tall wall just past the step stops the walker from striding off
  // the small test platform after climbing.
  const stepUp = (stepId: number): Player => {
    clearRegion();
    for (let dx = -2; dx <= 2; dx++)
      for (let dz = -2; dz <= 2; dz++) world.setBlock(cx + dx, base, cz + dz, Block.Stone);
    world.setBlock(cx + 1, base + 1, cz, stepId); // 0.5-high step in front (+x)
    world.setBlock(cx + 2, base + 1, cz, Block.Stone); // tall wall to halt the walk
    world.setBlock(cx + 2, base + 2, cz, Block.Stone);
    const p = new Player({ x: cx + 0.5, y: base + 1, z: cz + 0.5 });
    p.yaw = -Math.PI / 2; // face +x
    for (let i = 0; i < 5; i++) p.update(1 / 60, idle, world); // settle
    for (let i = 0; i < 150; i++) p.update(1 / 60, walk, world);
    return p;
  };
  const slabStep = stepUp(Block.OakSlab);
  check('player auto-steps up onto a bottom slab while walking',
    slabStep.onGround && slabStep.pos.y > base + 1.4 && slabStep.pos.x > cx + 1.0,
    `y=${slabStep.pos.y.toFixed(2)} x=${slabStep.pos.x.toFixed(2)}`);
  const stairStep = stepUp(Block.OakStairsE); // tall step on +x: low side faces the player
  check('player auto-steps up onto a stair while walking',
    stairStep.onGround && stairStep.pos.y > base + 1.4 && stairStep.pos.x > cx + 1.0,
    `y=${stairStep.pos.y.toFixed(2)} x=${stairStep.pos.x.toFixed(2)}`);

  // A full 1-block wall (no step room) must still block — no climbing.
  {
    clearRegion();
    for (let dx = -2; dx <= 2; dx++)
      for (let dz = -2; dz <= 2; dz++) world.setBlock(cx + dx, base, cz + dz, Block.Stone);
    world.setBlock(cx + 1, base + 1, cz, Block.Stone); // full-cube wall
    const p = new Player({ x: cx + 0.5, y: base + 1, z: cz + 0.5 });
    p.yaw = -Math.PI / 2;
    for (let i = 0; i < 5; i++) p.update(1 / 60, idle, world);
    for (let i = 0; i < 150; i++) p.update(1 / 60, walk, world);
    check('player cannot auto-step through a full 1-block wall',
      p.pos.x < cx + 0.72 && Math.abs(p.pos.y - (base + 1)) < 0.05,
      `x=${p.pos.x.toFixed(2)} y=${p.pos.y.toFixed(2)}`);
    clearRegion();
  }

  // intersectsBlock is shape-aware: a bottom slab you stand on is clear, but a
  // full cube or a top slab in the same cell overlaps the body.
  {
    const p = new Player({ x: cx + 0.5, y: base + 0.5, z: cz + 0.5 });
    check('intersectsBlock: shape-aware allows a slab at the feet, blocks a cube',
      !p.intersectsBlock(cx, base, cz, Block.OakSlab) &&
      p.intersectsBlock(cx, base, cz, Block.Stone) &&
      p.intersectsBlock(cx, base, cz, Block.OakSlabTop) &&
      p.intersectsBlock(cx, base, cz)); // no id -> full cube fallback
  }

  // Ship deck height: a bottom-slab-topped column stands a rider half a block
  // lower than a full-block deck.
  {
    const helm = { dx: 0, dy: 0, dz: 0, id: Block.ShipHelm };
    const full = newShip(90, 'Cap', { x: 0, y: 64, z: 0 }, 0,
      [helm, { dx: 1, dy: 0, dz: 0, id: Block.OakPlanks }]);
    const slab = newShip(91, 'Cap', { x: 0, y: 64, z: 0 }, 0,
      [helm, { dx: 1, dy: 0, dz: 0, id: Block.OakSlab }]);
    const topf = deckHeightAt(full, 1, 0)!;
    const tops = deckHeightAt(slab, 1, 0)!;
    check('deckHeightAt: bottom-slab deck is half a block below a full-block deck',
      Math.abs(topf - 64.5) < 1e-6 && Math.abs(tops - 64.0) < 1e-6,
      `full=${topf} slab=${tops}`);
  }
}

console.log(failures === 0 ? '\nAll smoke tests passed.' : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
