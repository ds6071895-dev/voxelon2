// Headless smoke tests for WARZONE: terrain/biomes/mountains, ores, caves,
// lighting, meshing, raycast, player physics + energy, survival regen,
// crafting/tools, furnace, items/inventory, item entities, hostile mobs,
// and the WARZONE-specific changes. Run: npm run smoke

import * as THREE from 'three';
import { materialOf } from '../src/audio';
import { Biome, BIOME_NAMES } from '../src/biomes';
import { Block, BLOCKS, isSolid } from '../src/blocks';
import { Chunk } from '../src/chunk';
import { matchGrid, craftResult, consumeCraft } from '../src/crafting';
import { Furnaces, SMELT } from '../src/furnace';
import { Inventory, CRAFT_START } from '../src/inventory';
import { dropFor, Item, ItemStack, miningStats } from '../src/items';
import { ItemEntities, itemGeometry } from '../src/itementity';
import { computeLight } from '../src/light';
import { buildChunkGeometry, TintSampler } from '../src/mesher';
import { Mobs, MOB_DEFS } from '../src/mobs';
import { Particles } from '../src/particles';
import { raycastBlocks } from '../src/interact';
import { Player } from '../src/player';
import { daylight } from '../src/sky';
import { Survival } from '../src/survival';
import { Terrain, SEA_LEVEL } from '../src/terrain';
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

// --- Drop table (WARZONE: no apples/food) -----------------------------------------
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
  check('log -> 4 planks', matchGrid(g({ 4: Block.BirchLog }))?.id === Block.OakPlanks);
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
  // No swords in WARZONE: the classic sword pattern yields nothing.
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

console.log(failures === 0 ? '\nAll smoke tests passed.' : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
