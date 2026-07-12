// Headless smoke tests for VOXELON: terrain/biomes/mountains, ores, caves,
// lighting, meshing, raycast, player physics + energy, survival regen,
// crafting/tools, furnace, items/inventory, item entities, hostile mobs,
// and the VOXELON-specific changes. Run: npm run smoke

import * as THREE from 'three';
import { materialOf } from '../src/audio';
import { Biome, BIOME_NAMES } from '../src/biomes';
import {
  Block, BLOCKS, isSlab, isTopSlab, isSolid, orientStairsForYaw, slabBottomId,
  slabPlacement, slabTopId, stairsBaseOf, Tile,
} from '../src/blocks';
import {
  COMEBACK_HEARTS, ELIMINATION_MS, MAX_HEARTS, START_HEARTS, WITHDRAW_FLOOR,
  canConsume, canWithdraw, clampHearts, formatRemaining, maxHealthFor,
  transferHeart,
} from '../src/hearts';
import { Chunk } from '../src/chunk';
import { matchGrid, craftResult, consumeCraft, RECIPES } from '../src/crafting';
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
  collisionBoxes, FULL_BOX, PLATE_BOX, SLAB_BOTTOM, SLAB_TOP, stairBoxes,
} from '../src/shapes';
import {
  GUIDE_STEPS, compassGlyph, guideComplete, guideProgress, markGuideStep,
  newGuideState, nextGuideStep, sanitizeGuide,
} from '../src/guide';
import { Mobs, MOB_DEFS } from '../src/mobs';
import { Particles } from '../src/particles';
import { raycastBlocks } from '../src/interact';
import { Player } from '../src/player';
import { daylight } from '../src/sky';
import { Survival } from '../src/survival';
import { GameServer, Outbound } from '../src/net/server_core';
import {
  ClientMsg, mitigate, RANGED_MAX_RANGE, RANGED_MAX_DAMAGE, WORLD_BORDER, WORLD_HALF,
  CORE_BORDER, CORE_HALF, inCore, MAX_ATTUNED, TOTEM_COOLDOWN, COMBAT_TAG,
  TPA_EXPIRE, TPA_HOLD,
} from '../src/net/protocol';
import {
  COSMETIC_KEYS, COSMETIC_RANGES, Cosmetics, defaultCosmetics, randomCosmetics,
  sanitizeCosmetics,
} from '../src/character';
import { LEVER_RADIUS, flippedTrap, isLeverBlock, leverFlips } from '../src/traps';
import {
  Machines, MachineType, MAX_LEVEL, allowedFilterMask, applyUpgrade,
  autominerRates, claimMachine, collectMachine, currentRate, damageMachine,
  derrickRate, filterTierMax, machineHeight, machineMaxHp, machineTypeForBlock,
  newMachine, productionRate, sanitizeState, setFilter, storageCap, tickMachine,
  totalStored, upgradeCost,
} from '../src/machines';
import {
  applyTurretUpgrade, claimTurret, damageTurret, newTurret, sanitizeTurretState,
  turretArmed, turretDamage, turretLoad, turretRange, turretUpgradeCost,
  TURRET_MAX_LEVEL,
} from '../src/turrets';
import {
  FACTIONS, NO_FACTION, balancedFaction, factionColor, factionName, isFaction,
  sameFaction, forcedFaction, resolveJoinFaction,
  MAX_SWITCHES_PER_SEASON, canSwitchFaction, switchesRemaining, otherFaction,
} from '../src/teams';
import {
  SEASON_LENGTH, newSeason, seasonTimeLeft, seasonExpired, tickSeasonClock,
  advanceSeason, deadlineWinner, sanitizeSeason,
} from '../src/season';
import {
  newWar, warActive, warPending, warTimeLeft, warStartsIn, scheduleWar,
  warSnapshot, sanitizeWar, warBorderAt, warDuration,
  WAR_MIN_BORDER, WAR_SHRINK_PORTION,
} from '../src/war';
import {
  XP_MOB, XP_PLAYER_KILL, XP_REPORT_CAP, levelFor, xpForLevel, levelProgress,
  newProgress, totalPointsFor, pointsAvailable, personalBuffs, sanitizeProgress,
  factionLevelFor, factionPerks, sanitizeFactionXp,
  BRANCHES, BRANCH_LENGTH, MAX_LEVEL, SKILL_TREE, branchRank, buyNode,
  canBuyNode, nodeCost, ownsNode, pointsSpent,
} from '../src/progress';
import {
  GADGETS, isGadget, gadgetOf, GadgetCooldowns, falloffDamage,
} from '../src/gadgets';
import { itemDescription } from '../src/itemdesc';
import { RUNES, isRune, runeOf, runeBonuses } from '../src/runes';
import { Inventory as RuneInv } from '../src/inventory';
import { Accounts, validUsername } from '../src/net/accounts';
import {
  structureKindAt, structureStamp, structureChestTier, worldStructures,
} from '../src/structures';
import {
  VAULT_LOOT, VAULT_LOOT_COOLDOWN, VAULT_LOOT_WINDOW, VAULT_RECHARGE,
  VaultStamp, bruteMaxHp, countVaults, newVaultState, recordVaultLoot,
  refreshVaultState, sanitizeVaultState, vaultAt, vaultChestAt, vaultLoot,
  vaultLootCooldownLeft, vaultLootable, vaultStamp, vaultTier, worldVaults,
} from '../src/vaults';
import { LOOT_TABLES, chestLoot, chestLootSlots } from '../src/loot';
import { mulberry32 } from '../src/noise';
import { AUTOMINER_ORES, Terrain, SEA_LEVEL } from '../src/terrain';
import { Biome } from '../src/biomes';
import { World } from '../src/world';
import type { Atlas } from '../src/textures';

const FACTION_A = FACTIONS[0].id;
const FACTION_B = FACTIONS[1].id;

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
  daylight(0.25) === 1 && daylight(0.75) === 0.36 &&
  daylight(0) > 0.36 && daylight(0) < 1);

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
    health: 10, maxHealth: 20, air: 15, eyeUnderwater: false, dead: false, regenCooldown: 0,
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
    if (biomeChunk.size >= 15) break; // all biome kinds incl. Milestone C's four
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
    Object.keys(MOB_DEFS).sort().join(',') === 'brute,creeper,skitter,spitter,zombie' &&
    Object.values(MOB_DEFS).every((d) => d.hostile));

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
  // Melee PvP is REMOVED — 'attack' is not even a protocol message any more,
  // so an unknown/forged message falls through the dispatch and does nothing.
  const atk = fresh.handle(1, { t: 'attack', target: 2 } as unknown as ClientMsg);
  check('melee PvP is gone (a forged attack message does nothing)', atk.length === 0);
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
  check('sniper hits hard but never one-shots a full-health player (20 HP)',
    (ITEMS[Item.Sniper].gun?.damage ?? 0) >= 15 &&
    (ITEMS[Item.Sniper].gun?.damage ?? 99) < 20 &&
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

  // Machines are explosive-only: a grenade demolishes it — spilling stored loot +
  // the machine block and clearing the world cell (same destroyMachine plumbing).
  const kill = s.handle(1, { t: 'gadgetUse', item: Item.Grenade, x: 1, y: 70, z: 0 });
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

// --- Machine MOVE: relocate keeps upgrade state + clears the old footprint -----
{
  const s = new GameServer(1337, mulberry32(120));
  s.addPlayer(1);
  s.handle(1, { t: 'xform', x: 0.5, y: 70, z: 0.5, yaw: 0, pitch: 0 });
  s.handle(1, { t: 'edit', x: 1, y: 70, z: 0, block: Block.Autominer });
  s.handle(1, { t: 'edit', x: 1, y: 71, z: 0, block: Block.MachinePart });
  s.handle(1, { t: 'machineUpgrade', x: 1, y: 70, z: 0, axis: 'production' }); // -> level 2
  const moved = s.handle(1, { t: 'machineMove', x: 1, y: 70, z: 0, tx: 2, ty: 70, tz: 0 });
  const ns = moved.find((o) => o.msg.t === 'machine')?.msg as
    Extract<typeof moved[number]['msg'], { t: 'machine' }> | undefined;
  check('moving a machine carries its upgraded level to the new anchor',
    !!ns && ns.x === 2 && ns.state.level === 2);
  check('moving a machine clears the old footprint (anchor + part -> air)',
    moved.some((o) => o.msg.t === 'edit' && o.msg.x === 1 && o.msg.y === 70 &&
      (o.msg as { block: number }).block === Block.Air) &&
    moved.some((o) => o.msg.t === 'edit' && o.msg.x === 1 && o.msg.y === 71 &&
      (o.msg as { block: number }).block === Block.Air));
  check('the moved machine opens at its new anchor, not the old one',
    s.handle(1, { t: 'machineOpen', x: 2, y: 70, z: 0 }).length > 0 &&
    s.handle(1, { t: 'machineOpen', x: 1, y: 70, z: 0 }).length === 0);
  check('moving a machine out of reach is rejected',
    s.handle(1, { t: 'machineMove', x: 2, y: 70, z: 0, tx: 500, ty: 70, tz: 500 }).length === 0);
}

// --- Machines are explosive-only: tanky vs melee/bullets, demolished by a grenade
{
  check('machines are extremely tanky (thousands of HP)',
    machineMaxHp(newMachine(MachineType.Autominer)) >= 1000);
  const s = new GameServer(1337, mulberry32(121));
  s.addPlayer(1, { username: 'Boom', faction: 0 });
  s.handle(1, { t: 'xform', x: 0.5, y: 70, z: 0.5, yaw: 0, pitch: 0 });
  s.handle(1, { t: 'edit', x: 1, y: 70, z: 0, block: Block.Autominer });
  const boom = s.handle(1, { t: 'gadgetUse', item: Item.Grenade, x: 1, y: 70, z: 0 });
  check('a grenade demolishes a machine (drops the block) and clears it',
    boom.some((o) => o.msg.t === 'itemspawn' &&
      (o.msg as { item: { item: number } }).item.item === Block.Autominer) &&
    s.handle(1, { t: 'machineOpen', x: 1, y: 70, z: 0 }).length === 0);
}

// --- Rocket splash: server-authoritative AoE + crater broadcast --------------
{
  const facs = FACTIONS.map((f) => f.id);
  const s = new GameServer(1337, mulberry32(321));
  s.addPlayer(1, { username: 'Gunner', faction: facs[0] }); // shooter
  s.addPlayer(2, { username: 'Foe', faction: facs[1] });    // enemy in range
  s.addPlayer(3, { username: 'Ally', faction: facs[0] });   // friendly in range
  s.handle(1, { t: 'xform', x: 0.5, y: 70, z: 0.5, yaw: 0, pitch: 0 });
  s.handle(2, { t: 'xform', x: 3, y: 70, z: 0, yaw: 0, pitch: 0 });
  s.handle(3, { t: 'xform', x: 3, y: 70, z: 1, yaw: 0, pitch: 0 });
  // A placed block in the crater radius should be cleared + broadcast to others.
  s.handle(1, { t: 'edit', x: 2, y: 70, z: 0, block: Block.OakPlanks });
  const blast = s.handle(1, { t: 'rocketBlast', x: 3, y: 70, z: 0 });
  check('rocket splash hurts an enemy in range',
    blast.some((o) => o.to === 2 && o.msg.t === 'hurt'));
  check('rocket splash spares a friendly in range (no friendly fire)',
    !blast.some((o) => o.to === 3 && o.msg.t === 'hurt'));
  check('rocket crater clears a placed block + broadcasts it to others',
    blast.some((o) => o.msg.t === 'edit' && o.to === 'others' &&
      (o.msg as { x: number; z: number; block: number }).x === 2 &&
      (o.msg as { block: number }).block === Block.Air));
  // A burst beyond ranged range is rejected (fail-closed vs a hacked client).
  check('rocket blast beyond range is rejected',
    s.handle(1, { t: 'rocketBlast', x: 999, y: 70, z: 999 }).length === 0);
}

// --- Respawn Beacon: right-click sets a personal spawn the respawn honors ------
{
  const s = new GameServer(1337, mulberry32(122));
  s.addPlayer(1, { username: 'Homer', faction: 0 });
  s.handle(1, { t: 'xform', x: 10.5, y: 70, z: 10.5, yaw: 0, pitch: 0 });
  s.handle(1, { t: 'edit', x: 10, y: 70, z: 11, block: Block.RespawnBeacon });
  check('setting spawn on a Respawn Beacon returns a notice',
    s.handle(1, { t: 'setSpawn', x: 10, y: 70, z: 11 }).some((o) => o.msg.t === 'notice'));
  s.handle(1, { t: 'selfhurt', amount: 100 });
  const re = s.handle(1, { t: 'respawn' });
  const rs = re.find((o) => o.msg.t === 'respawned')?.msg as
    Extract<typeof re[number]['msg'], { t: 'respawned' }> | undefined;
  check('respawn honors the Respawn Beacon (on top of it)',
    !!rs && Math.floor(rs.x) === 10 && rs.y === 71 && Math.floor(rs.z) === 11);
  // Break the beacon -> respawn falls back (no longer pinned to the old point).
  s.handle(1, { t: 'edit', x: 10, y: 70, z: 11, block: Block.Air });
  s.handle(1, { t: 'selfhurt', amount: 100 });
  const re2 = s.handle(1, { t: 'respawn' });
  const rs2 = re2.find((o) => o.msg.t === 'respawned')?.msg as
    Extract<typeof re2[number]['msg'], { t: 'respawned' }> | undefined;
  check('respawn falls back to faction spawn when the beacon is gone',
    !!rs2 && !(rs2.y === 71 && Math.floor(rs2.x) === 10 && Math.floor(rs2.z) === 11));
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

  const kill = s.handle(1, { t: 'gadgetUse', item: Item.Grenade, x: 1, y: 70, z: 0 });
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


// --- Factions (M17): auto-balance + friendly fire off ------------------------
{
  // Pure team helpers.
  check('exactly two preset factions with distinct colors + names',
    FACTIONS.length === 2 &&
    new Set(FACTIONS.map((f) => f.color)).size === 2 &&
    new Set(FACTIONS.map((f) => f.name)).size === 2);
  check('sameFaction only matches a shared, real faction',
    sameFaction(0, 0) && !sameFaction(0, 1) &&
    !sameFaction(NO_FACTION, NO_FACTION) && !isFaction(NO_FACTION));
  check('balancedFaction picks the lowest-population team',
    balancedFaction({ 0: 3, 1: 1 }) === 1 &&
    balancedFaction({ 0: 0, 1: 0 }) === 0);
  check('factionName/factionColor fall back to neutral',
    factionName(NO_FACTION) === 'Neutral' && factionColor(NO_FACTION) === 0x9a9a9a);

  // Faction PICK gate: balanced -> free pick honoured; >20% imbalance -> forced
  // onto the weaker side; ties / no pick -> balanced default.
  check('forcedFaction is null while teams are within 20%',
    forcedFaction({ 0: 5, 1: 5 }) === null &&
    forcedFaction({ 0: 6, 1: 5 }) === null);   // 6 is NOT > 5*1.2
  check('forcedFaction returns the weaker side past 20%',
    forcedFaction({ 0: 7, 1: 5 }) === 1 &&      // 7 > 5*1.2
    forcedFaction({ 0: 0, 1: 3 }) === 0);
  check('resolveJoinFaction honours a valid pick when balanced',
    resolveJoinFaction({ 0: 5, 1: 5 }, 1) === 1 &&
    resolveJoinFaction({ 0: 5, 1: 5 }, 0) === 0);
  check('resolveJoinFaction overrides the pick when imbalanced',
    resolveJoinFaction({ 0: 7, 1: 5 }, 0) === 1);
  check('resolveJoinFaction falls back to balanced on no/invalid pick',
    resolveJoinFaction({ 0: 3, 1: 1 }) === 1 &&
    resolveJoinFaction({ 0: 1, 1: 1 }, 99) === 0);

  // Server auto-balances joins evenly across the two factions.
  const factionOf = (out: ReturnType<GameServer['addPlayer']>): number => {
    const w = out.find((o) => o.msg.t === 'welcome')!.msg as { players: { faction: number }[] };
    return w.players[w.players.length - 1].faction;
  };
  const s = new GameServer(1337, mulberry32(7));
  const facs: number[] = [];
  for (let i = 1; i <= 6; i++) facs.push(factionOf(s.addPlayer(i)));
  const counts = [0, 0];
  for (const f of facs) counts[f]++;
  check('auto-balance spreads 6 joins evenly across 2 factions',
    counts[0] === 3 && counts[1] === 3);
  // With two sides, odd/even joins alternate: 1 & 3 are allies; 1 & 2 enemies.
  check('the same-faction / cross-faction pairs are as expected',
    facs[0] === facs[2] && facs[0] !== facs[1]);

  // Position three players together: 1 (ally of 3) attacks 3 then 2.
  s.handle(1, { t: 'xform', x: 0, y: 70, z: 0, yaw: -Math.PI / 2, pitch: 0 });
  s.handle(2, { t: 'xform', x: 2, y: 70, z: 0, yaw: 0, pitch: 0 });
  s.handle(3, { t: 'xform', x: 2, y: 70, z: 0, yaw: 0, pitch: 0 });
  check('melee never damages players (attack is not a protocol message)',
    !s.handle(1, { t: 'attack', target: 3 } as unknown as ClientMsg).some((o) => o.msg.t === 'hurt') &&
    !s.handle(1, { t: 'attack', target: 2 } as unknown as ClientMsg).some((o) => o.msg.t === 'hurt'));
  check('same-faction ranged is rejected',
    !s.handle(1, { t: 'rangedAttack', target: 3, amount: 10 }).some((o) => o.msg.t === 'hurt'));
  check('cross-faction ranged applies',
    s.handle(1, { t: 'rangedAttack', target: 2, amount: 10 }).some((o) => o.msg.t === 'hurt'));

  // Turret claimed by player 1 (faction A): ignores ally 3, fires on enemy 2.
  s.handle(1, { t: 'xform', x: 40, y: 70, z: 40, yaw: 0, pitch: 0 });
  s.handle(1, { t: 'edit', x: 41, y: 70, z: 40, block: Block.Turret });
  s.handle(1, { t: 'turretClaim', x: 41, y: 70, z: 40 });
  s.handle(1, { t: 'turretLoad', x: 41, y: 70, z: 40, item: Item.Cannonball, count: 50 });
  s.handle(1, { t: 'turretLoad', x: 41, y: 70, z: 40, item: Item.OilBarrel, count: 20 });
  s.handle(3, { t: 'xform', x: 44, y: 70, z: 40, yaw: 0, pitch: 0 }); // ally in range
  s.handle(2, { t: 'xform', x: 500, y: 70, z: 500, yaw: 0, pitch: 0 });
  check('a turret never fires on a same-faction player',
    s.tickTurrets(2).every((o) => o.msg.t !== 'turretFire'));
  s.handle(2, { t: 'xform', x: 44, y: 70, z: 40, yaw: 0, pitch: 0 }); // enemy in range
  s.handle(3, { t: 'xform', x: 500, y: 70, z: 500, yaw: 0, pitch: 0 });
  check('a turret fires on a cross-faction player',
    s.tickTurrets(2).some((o) => o.msg.t === 'turretFire'));
}

// --- Seasons (Phase 5): clock + deadline from WAR WINS + reset + badge --------
{
  const hash: (p: string, s: string) => string = (p, s) => `${s}:${p}`;

  // Pure season clock.
  const s = newSeason();
  check('a fresh season starts at #1 with the full clock',
    s.number === 1 && seasonTimeLeft(s) === SEASON_LENGTH && !seasonExpired(s));
  tickSeasonClock(s, SEASON_LENGTH + 5);
  check('the season clock expires past the deadline',
    seasonExpired(s) && seasonTimeLeft(s) === 0);
  advanceSeason(s);
  check('advanceSeason bumps the number + resets the clock', s.number === 2 && s.elapsed === 0);
  check('sanitizeSeason fail-closes junk to season #1',
    sanitizeSeason(null).number === 1 && sanitizeSeason({ number: -3, elapsed: -9 }).number === 1);
  check('deadlineWinner is the war-wins leader, stalemate on a tie',
    deadlineWinner({ 0: 3, 1: 1 }) === FACTION_A &&
    deadlineWinner({ 0: 2, 1: 2 }) === NO_FACTION &&
    deadlineWinner({ 0: 0, 1: 0 }) === NO_FACTION);

  // Accounts: the "Seasons Won" badge goes to exactly the winning faction.
  const accs = new Accounts();
  for (const n of ['Acc1', 'Acc2', 'Acc3', 'Acc4']) accs.register(n, 'password', hash, 'sa');
  const f0 = accs.list().filter((a) => a.faction === FACTION_A);
  const f1 = accs.list().filter((a) => a.faction === FACTION_B);
  const awarded = accs.awardSeasonWin(FACTION_A);
  check('awardSeasonWin badges exactly the winning faction',
    awarded.length === f0.length && f0.length > 0 &&
    f0.every((a) => a.seasonsWon === 1) && f1.every((a) => (a.seasonsWon ?? 0) === 0));

  // Welcome carries the season clock + the player's badge.
  const gw = new GameServer(1337, mulberry32(4));
  const wel = gw.addPlayer(1, { username: 'Zed', faction: 0, seasonsWon: 3 })
    .find((o) => o.msg.t === 'welcome')!.msg as
      { season: { number: number; timeLeft: number }; players: { seasonsWon: number }[] };
  check('the welcome carries the season clock + the player badge',
    wel.season.number === 1 && wel.season.timeLeft > 0 && wel.players[0].seasonsWon === 3);

  // Server deadline: the faction with more WAR WINS takes the season.
  const gd = new GameServer(1337, mulberry32(7));
  gd.addPlayer(1, { username: 'A', faction: FACTION_A });
  gd.addPlayer(2, { username: 'B', faction: FACTION_B });
  let dWinner = -2, dNum = 0;
  gd.onSeasonEnd = (w, n) => { dWinner = w; dNum = n; };
  // Faction A wins one war: a kill during the war, then the clock expires.
  gd.adminStartWar(60);
  gd.handle(1, { t: 'xform', x: 0, y: 70, z: 0, yaw: Math.PI, pitch: 0 });
  gd.handle(2, { t: 'xform', x: 0, y: 70, z: 2, yaw: 0, pitch: 0 });
  gd.handle(1, { t: 'rangedAttack', target: 2, amount: 9999 });
  const endOut = gd.tickWar(61); // the war expires -> resolved by kills
  check('a finished war resolves to the most-kills faction (warEnd)',
    endOut.some((o) => o.msg.t === 'warEnd' &&
      (o.msg as { winner: number }).winner === FACTION_A));
  const de = gd.tickSeason(SEASON_LENGTH + 1);
  check('the season ends at the deadline → the war-wins leader takes it',
    de.some((o) => o.msg.t === 'seasonEnd') && dWinner === FACTION_A && dNum === 1);
  const wAfter = gd.addPlayer(3).find((o) => o.msg.t === 'welcome')!.msg as
    { war: { wins: number[] } };
  check('war wins reset with the new season',
    wAfter.war.wins.every((n) => n === 0));

  // A drawn war (no kills) awards no win.
  const gt = new GameServer(1337, mulberry32(8));
  gt.adminStartWar(30);
  const drawOut = gt.tickWar(31);
  check('a kill-less war ends in a draw (no faction win)',
    drawOut.some((o) => o.msg.t === 'warEnd' &&
      (o.msg as { winner: number }).winner === NO_FACTION));

  // A season survives a serialize round-trip.
  const gp = new GameServer(1337, mulberry32(2));
  gp.tickSeason(12345);
  const reloaded = new GameServer(1337, mulberry32(2));
  reloaded.restore(JSON.parse(JSON.stringify(gp.serialize())));
  const rs = reloaded.seasonSnapshot() as { number: number; timeLeft: number };
  check('the season clock survives a serialize round-trip',
    Math.abs(rs.timeLeft - (SEASON_LENGTH - 12345)) < 1);
}

// --- WAR: shrinking-border battle royale ---------------------------------------
{
  // Pure schedule maths: a fresh state is perpetual peace.
  check('newWar is peacetime (not active, not pending)',
    !warActive(newWar(), 0) && !warPending(newWar(), 0));
  const w = scheduleWar(60, 120, 1000); // starts at 1060, ends at 1180
  check('scheduleWar sets the right window', w.start === 1060 && w.end === 1180);
  check('a future war is pending (not yet active)',
    warPending(w, 1000) && !warActive(w, 1000) && warStartsIn(w, 1000) === 60);
  check('a war is active inside its window',
    warActive(w, 1100) && warTimeLeft(w, 1100) === 80 && !warPending(w, 1100));
  check('a war is over after its end', !warActive(w, 1200) && warStartsIn(w, 1200) === 0);
  const snap = warSnapshot(w, 1100);
  check('warSnapshot is clock-relative + carries the duration',
    snap.active && snap.timeLeft === 80 && snap.nextIn === 0 && snap.duration === 120);
  check('sanitizeWar fail-closes junk to peace',
    sanitizeWar(null).start === 0 && sanitizeWar({ start: -1, end: 5 }).start === 0);
  check('warDuration reads the window length', warDuration(w) === 120 && warDuration(newWar()) === 0);

  // The border shrink curve: full at the start, min at/after the shrink portion,
  // strictly between in the middle, and full-size with no war at all.
  const shrinkEnd = 120 * WAR_SHRINK_PORTION;
  check('warBorderAt: full at start, WAR_MIN_BORDER once the shrink completes',
    warBorderAt(120, 120, 5000) === 5000 &&
    warBorderAt(120 - shrinkEnd, 120, 5000) === WAR_MIN_BORDER &&
    warBorderAt(0, 120, 5000) === WAR_MIN_BORDER);
  const mid = warBorderAt(120 - shrinkEnd / 2, 120, 5000);
  check('warBorderAt is between full and min mid-shrink',
    mid < 5000 && mid > WAR_MIN_BORDER);
  check('warBorderAt with no war (0 duration) is the full size',
    warBorderAt(0, 0, 5000) === 5000);

  // Server: the border clamps movement authoritatively during a war.
  const s = new GameServer(1337, mulberry32(200));
  s.addPlayer(1, { username: 'A', faction: FACTION_A });
  s.addPlayer(2, { username: 'B', faction: FACTION_B });
  check('peacetime border is the full world', s.currentBorder() === WORLD_BORDER);
  s.handle(1, { t: 'xform', x: 2000, y: 70, z: -2000, yaw: 0, pitch: 0 });
  check('peacetime movement roams the full world',
    s.playerCoords()[0].x === 2000 && s.playerCoords()[0].z === -2000);
  s.adminStartWar(100);
  check('starting a war leaves the border full at t=0', s.currentBorder() === WORLD_BORDER);
  s.tickWar(90); // deep past the shrink portion (70s) -> final ring
  check('deep into the war the border has closed to the final ring',
    s.currentBorder() === WAR_MIN_BORDER);
  check('tickWar drags a far player inside the ring',
    Math.abs(s.playerCoords()[0].x) <= WAR_MIN_BORDER / 2 &&
    Math.abs(s.playerCoords()[0].z) <= WAR_MIN_BORDER / 2);
  s.handle(1, { t: 'xform', x: 2000, y: 70, z: 2000, yaw: 0, pitch: 0 });
  check('an xform outside the ring is clamped back in',
    Math.abs(s.playerCoords()[0].x) <= WAR_MIN_BORDER / 2);

  // Kills score the war; the snapshot message carries score + wins.
  s.handle(1, { t: 'xform', x: 0, y: 70, z: 0, yaw: Math.PI, pitch: 0 });
  s.handle(2, { t: 'xform', x: 0, y: 70, z: 2, yaw: 0, pitch: 0 });
  const kill = s.handle(1, { t: 'rangedAttack', target: 2, amount: 9999 });
  const warMsg = kill.find((o) => o.msg.t === 'war')?.msg as
    { score: number[]; wins: number[] } | undefined;
  check('a war kill scores for the killer faction (broadcast in the war msg)',
    !!warMsg && warMsg.score[FACTION_A] === 1 && warMsg.score[FACTION_B] === 0);

  // The war expires: A most kills -> warEnd names A, wins bump, kills reset.
  const endOut = s.tickWar(20);
  const endMsg = endOut.find((o) => o.msg.t === 'warEnd')?.msg as
    { winner: number; score: number[] } | undefined;
  check('the war end names the most-kills faction + the final score',
    !!endMsg && endMsg.winner === FACTION_A && endMsg.score[FACTION_A] === 1);
  const after = endOut.find((o) => o.msg.t === 'war')?.msg as
    { score: number[]; wins: number[] } | undefined;
  check('after the war: kills reset, the win is on the board',
    !!after && after.score.every((n) => n === 0) && after.wins[FACTION_A] === 1);
  check('after the war the border is full again', s.currentBorder() === WORLD_BORDER);

  // Peacetime kills do NOT score a war.
  s.handle(2, { t: 'respawn' });
  s.handle(1, { t: 'xform', x: 0, y: 70, z: 0, yaw: Math.PI, pitch: 0 });
  s.handle(2, { t: 'xform', x: 0, y: 70, z: 2, yaw: 0, pitch: 0 });
  s.handle(1, { t: 'rangedAttack', target: 2, amount: 9999 });
  s.adminStartWar(50);
  const w2 = s.warSnapshotMsg() as { t: 'war'; score: number[] };
  check('peacetime kills never reach the war scoreboard',
    w2.score.every((n) => n === 0));
  s.adminCancelWar();
  check('admin can cancel a war (back to peacetime, full border)',
    s.isWarActive() === false && s.currentBorder() === WORLD_BORDER);

  // War state survives a serialize round-trip (wins + faction XP).
  const blob = JSON.parse(JSON.stringify(s.serialize()));
  const s2 = new GameServer(1337, mulberry32(201));
  s2.restore(blob);
  const w3 = s2.addPlayer(9).find((o) => o.msg.t === 'welcome')!.msg as
    { war: { wins: number[] } };
  check('war wins survive a serialize round-trip', w3.war.wins[FACTION_A] === 1);
}

// --- Secret faction switching / betrayals (Phase 7) --------------------------
{
  const hash: (p: string, s: string) => string = (p, s) => `${s}:${p}`;

  // Pure switch rules.
  check('switchesRemaining is a full budget on a new season + decrements within one',
    switchesRemaining({ switchesUsed: 0, switchSeason: 0 }, 5) === MAX_SWITCHES_PER_SEASON &&
    switchesRemaining({ switchesUsed: 1, switchSeason: 5 }, 5) === MAX_SWITCHES_PER_SEASON - 1 &&
    switchesRemaining({ switchesUsed: 2, switchSeason: 5 }, 5) === 0);
  check('canSwitchFaction enforces side/limit/final-week rules',
    canSwitchFaction({ switchesUsed: 0, switchSeason: 1 }, 1, 0, 1, SEASON_LENGTH) &&
    !canSwitchFaction({ switchesUsed: 0, switchSeason: 1 }, 1, 0, 0, SEASON_LENGTH) && // same side
    !canSwitchFaction({ switchesUsed: 2, switchSeason: 1 }, 1, 0, 1, SEASON_LENGTH) && // exhausted
    !canSwitchFaction({ switchesUsed: 0, switchSeason: 1 }, 1, 0, 1, 3600));           // final week
  check('otherFaction flips between the two sides',
    otherFaction(FACTION_A) === FACTION_B && otherFaction(FACTION_B) === FACTION_A);

  // Badge forfeiture: a defector who switched this season earns no "Won" badge.
  const accs = new Accounts();
  accs.register('Loyal', 'password', hash, 's');
  accs.register('Traitor', 'password', hash, 's');
  accs.applySwitch('Loyal', 0, 0, 1, 0);   // on faction 0, never forfeited
  accs.applySwitch('Traitor', 0, 1, 1, 1); // on faction 0, forfeited in season 1
  const won = accs.awardSeasonWin(0, 1);
  check('a defector forfeits this season\'s badge; the loyal member keeps theirs',
    won.includes('Loyal') && !won.includes('Traitor') &&
    accs.get('Loyal')!.seasonsWon === 1 && (accs.get('Traitor')!.seasonsWon ?? 0) === 0);

  // Server: a secret switch is private (no public announcement) + flips combat.
  const g = new GameServer(1337, mulberry32(15));
  g.addPlayer(1, { username: 'Spy', faction: 0 });
  g.addPlayer(2, { username: 'Ally', faction: 0 });
  let cbFaction = -9, cbForfeit = -9;
  g.onFactionSwitch = (_u, f, _used, _ssn, fseason) => { cbFaction = f; cbForfeit = fseason; };
  const sw = g.handle(1, { t: 'switchFaction', faction: 1 });
  check('a secret switch confirms privately with NO public announcement',
    sw.some((o) => o.msg.t === 'factionSwitched' && o.to === 1) &&
    !sw.some((o) => o.msg.t === 'join'));
  check('a switch persists the new faction + forfeit season via the callback',
    cbFaction === 1 && cbForfeit === 1);
  g.handle(1, { t: 'xform', x: 0, y: 70, z: 0, yaw: -Math.PI / 2, pitch: 0 });
  g.handle(2, { t: 'xform', x: 2, y: 70, z: 0, yaw: 0, pitch: 0 });
  check('after defecting, the spy can damage a former teammate (combat flips)',
    g.handle(1, { t: 'rangedAttack', target: 2, amount: 8 }).some((o) => o.msg.t === 'hurt'));
  g.handle(1, { t: 'switchFaction', faction: 0 }); // 2nd switch
  const third = g.handle(1, { t: 'switchFaction', faction: 1 }); // 3rd -> denied
  check('switching is capped at 2 per season',
    third.some((o) => o.msg.t === 'notice') && !third.some((o) => o.msg.t === 'factionSwitched'));

  // Final-week lock.
  const gl = new GameServer(1337, mulberry32(16));
  gl.addPlayer(1, { username: 'Late', faction: 0 });
  gl.tickSeason(SEASON_LENGTH - 3 * 24 * 3600); // 3 days left -> inside the lock
  const lk = gl.handle(1, { t: 'switchFaction', faction: 1 });
  check('switching is locked in the final week',
    lk.some((o) => o.msg.t === 'notice') && !lk.some((o) => o.msg.t === 'factionSwitched'));
}

// --- Gadgets (Phase 8): registry, cooldowns, AoE, server effects -------------
{
  // Registry: ten gadgets, each with sane params + a description.
  const ids = Object.keys(GADGETS).map(Number);
  check('all gadgets are registered with valid params + descriptions',
    ids.length === 10 && ids.every((id) => {
      const d = GADGETS[id];
      return isGadget(id) && gadgetOf(id) === d && d.item === id && d.cooldown > 0 &&
        d.maxStack > 0 && typeof d.desc === 'string' && d.desc.length > 0;
    }));

  // AoE falloff: full at the centre, linear, zero at/after the radius.
  check('falloffDamage is full at the centre, linear, zero past the radius',
    falloffDamage(20, 0, 5) === 20 && falloffDamage(20, 2.5, 5) === 10 &&
    falloffDamage(20, 5, 5) === 0 && falloffDamage(20, 9, 5) === 0);

  // Per-gadget cooldown gating.
  const cd = new GadgetCooldowns();
  const gid = Item.Grenade, secs = GADGETS[gid].cooldown;
  check('GadgetCooldowns gates re-use until the cooldown elapses',
    cd.ready(gid, 0) && cd.use(gid, 0) && !cd.ready(gid, 0.1) && !cd.use(gid, 0.1) &&
    cd.ready(gid, secs + 0.1));

  // Server: a frag damages enemies in the blast, spares allies, plays an fx.
  const g = new GameServer(1337, mulberry32(41));
  g.addPlayer(1, { username: 'Thrower', faction: 0 });
  g.addPlayer(2, { username: 'Victim', faction: 1 });
  g.addPlayer(3, { username: 'Mate', faction: 0 });
  g.handle(1, { t: 'xform', x: 0, y: 70, z: 0, yaw: 0, pitch: 0 });
  g.handle(2, { t: 'xform', x: 2, y: 70, z: 0, yaw: 0, pitch: 0 }); // 1 from detonation
  g.handle(3, { t: 'xform', x: 1, y: 70, z: 0, yaw: 0, pitch: 0 }); // at detonation (ally)
  const blast = g.handle(1, { t: 'gadgetUse', item: Item.Grenade, x: 1, y: 70, z: 0 });
  check('a frag grenade damages enemies in the blast but spares allies + plays fx',
    blast.some((o) => o.msg.t === 'gadgetFx') &&
    blast.some((o) => o.msg.t === 'hurt' && o.to === 2) &&
    !blast.some((o) => o.msg.t === 'hurt' && o.to === 3));
  check('a gadget on cooldown is rejected (server-authoritative)',
    g.handle(1, { t: 'gadgetUse', item: Item.Grenade, x: 1, y: 70, z: 0 }).length === 0);
  check('a gadget detonated out of range is rejected',
    g.handle(1, { t: 'gadgetUse', item: Item.Grenade, x: 9000, y: 70, z: 9000 }).length === 0);

  // Smoke is cosmetic only — an fx, never damage.
  const gs = new GameServer(1337, mulberry32(42));
  gs.addPlayer(1, { username: 'S', faction: 0 });
  gs.addPlayer(2, { username: 'E', faction: 1 });
  gs.handle(1, { t: 'xform', x: 0, y: 70, z: 0, yaw: 0, pitch: 0 });
  gs.handle(2, { t: 'xform', x: 1, y: 70, z: 0, yaw: 0, pitch: 0 });
  const smoke = gs.handle(1, { t: 'gadgetUse', item: Item.SmokeGrenade, x: 0, y: 70, z: 0 });
  check('smoke is cosmetic — fx only, no damage',
    smoke.some((o) => o.msg.t === 'gadgetFx') && !smoke.some((o) => o.msg.t === 'hurt'));

  // War Horn: a cosmetic rallying blast anyone can sound (fx only, no damage).
  const gh = new GameServer(1337, mulberry32(43));
  gh.addPlayer(1, { username: 'Horn', faction: 0 });
  const horn = gh.handle(1, { t: 'gadgetUse', item: Item.WarHorn, x: 0, y: 70, z: 0 });
  check('a War Horn plays a cosmetic fx for anyone, no damage',
    horn.some((o) => o.msg.t === 'gadgetFx') && !horn.some((o) => o.msg.t === 'hurt'));
  check('a War Horn on cooldown is rejected',
    gh.handle(1, { t: 'gadgetUse', item: Item.WarHorn, x: 0, y: 70, z: 0 }).length === 0);

  // Spy disguise: broadcasts to OTHERS as the enemy faction.
  const gd = new GameServer(1337, mulberry32(44));
  gd.addPlayer(1, { username: 'Spy', faction: 0 });
  gd.addPlayer(2, { username: 'Mark', faction: 1 });
  const dis = gd.handle(1, { t: 'gadgetUse', item: Item.SpyDisguise, x: 0, y: 70, z: 0 });
  check('spy disguise broadcasts to OTHERS as the enemy faction',
    dis.some((o) => o.msg.t === 'disguised' && o.to === 'others' &&
      (o.msg as { faction: number }).faction === 1));

  // Item descriptions: gadgets pull from the registry; war items from the map.
  check('itemDescription serves gadget + static blurbs, blank otherwise',
    itemDescription(Item.Grenade) === GADGETS[Item.Grenade].desc &&
    itemDescription(Item.RocketLauncher).length > 0 &&
    itemDescription(Item.Stick) === '');
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

  // With no pick, registrations auto-balance across the 2 teams.
  for (const n of ['Bob', 'Cara', 'Dan', 'Eve', 'Fin']) accs.register(n, 'password', hash, 's');
  const counts = [0, 0];
  for (const a of accs.list()) counts[a.faction]++;
  check('registrations auto-balance across factions (max-min <= 1)',
    Math.max(...counts) - Math.min(...counts) <= 1);

  // A registration PICK is honoured while the teams are balanced. (The >20%
  // imbalance override is unit-tested above on resolveJoinFaction; register
  // self-balances so the store rarely reaches imbalance on its own.) Seed one
  // account per side first so the store is balanced and non-empty, then pick.
  const accs2 = new Accounts();
  accs2.register('Seed0', 'password', hash, 's', 0);
  accs2.register('Seed1', 'password', hash, 's', 1);
  check('a picked faction is honoured at register time when balanced',
    accs2.register('PickB', 'password', hash, 's', 1).account!.faction === 1);

  // Login verifies the password; wrong password + unknown user are rejected.
  check('login succeeds with the right password',
    accs.login('Alice', 'hunter2', hash).ok);
  check('login fails with a wrong password', !accs.login('Alice', 'nope', hash).ok);
  check('login fails for an unknown user', !accs.login('Ghost', 'x', hash).ok);
  check('the stored hash is never the raw password',
    accs.get('Alice')!.hash !== 'hunter2');

  // Session tokens (password-less resume, mirrored in localStorage).
  accs.setToken('Alice', 'tok-alice-12345678');
  check('a stored session token resumes the account',
    accs.sessionLogin('Alice', 'tok-alice-12345678').ok);
  check('a wrong / short / missing token is rejected',
    !accs.sessionLogin('Alice', 'tok-wrong-12345678').ok &&
    !accs.sessionLogin('Alice', 'short').ok &&
    !accs.sessionLogin('Bob', 'tok-alice-12345678').ok &&
    !accs.sessionLogin('Ghost', 'tok-alice-12345678').ok);
  check('rotating the token invalidates the old one',
    (accs.setToken('Alice', 'tok-alice-rotated9'),
      !accs.sessionLogin('Alice', 'tok-alice-12345678').ok &&
      accs.sessionLogin('Alice', 'tok-alice-rotated9').ok));

  // Serialize -> reload round-trips (the shell persists this to disk).
  const reloaded = new Accounts(JSON.parse(JSON.stringify(accs.toJSON())));
  check('accounts survive a JSON round-trip + still authenticate',
    reloaded.size === accs.size && reloaded.login('Alice', 'hunter2', hash).ok &&
    reloaded.get('Alice')!.faction === accs.get('Alice')!.faction);
  check('session tokens survive the JSON round-trip',
    reloaded.sessionLogin('Alice', 'tok-alice-rotated9').ok);
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
  check('a creative player takes no damage (server-side invulnerable)',
    g.handle(2, { t: 'selfhurt', amount: 10 }).every((o) => o.msg.t !== 'hurt'));

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

  // Out-of-bounds teleports clamp to the world border + a survivable height,
  // so an admin typo can't strand someone outside the play area / in the void.
  const far = g.adminTeleport(1, 99999, -50, -99999);
  const fm = far[0].msg as { t: 'teleport'; x: number; y: number; z: number };
  check('adminTeleport clamps to the world border and y>=1',
    fm.x === WORLD_HALF && fm.z === -WORLD_HALF && fm.y === 1);

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
}


// =============================================================================
// LIFESTEAL (Milestone A): hearts, steal, elimination, revival, items
// =============================================================================

// --- hearts.ts pure model -----------------------------------------------------
{
  check('clampHearts clamps + fail-safes junk to the 10-heart start',
    clampHearts(-5) === 0 && clampHearts(99) === MAX_HEARTS &&
    clampHearts(NaN) === START_HEARTS && clampHearts('x') === START_HEARTS &&
    clampHearts(7.9) === 7);
  check('maxHealthFor: 2 HP per heart (10 hearts = today\'s 20 HP)',
    maxHealthFor(10) === 20 && maxHealthFor(1) === 2 && maxHealthFor(20) === 40);
  const t1 = transferHeart(10, 10);
  check('transferHeart moves exactly one heart', t1.killer === 11 && t1.victim === 9);
  const t2 = transferHeart(MAX_HEARTS, 5);
  check('a kill at 20 hearts wastes the steal (victim still loses)',
    t2.killer === MAX_HEARTS && t2.victim === 4);
  check('a victim at 1 heart drops to 0 (elimination trigger)',
    transferHeart(10, 1).victim === 0);
  check('withdraw floor: allowed at 3 hearts, blocked at 2',
    canWithdraw(3) && !canWithdraw(WITHDRAW_FLOOR));
  check('consume cap: allowed at 19 hearts, blocked at 20',
    canConsume(19) && !canConsume(MAX_HEARTS));
  check('formatRemaining is a kid-friendly countdown',
    formatRemaining(17 * 3600_000 + 22 * 60_000) === '17h 22m' &&
    formatRemaining(30_000) === '1m');
}

// --- Server: PvP kills steal a heart; nothing else does ------------------------
{
  const s = new GameServer(1337, mulberry32(77));
  s.addPlayer(1); s.addPlayer(2); // auto-balance -> opposite factions
  const heartsMsg = (out: ReturnType<GameServer['handle']>, to: number) =>
    out.find((o) => o.to === to && o.msg.t === 'hearts')?.msg as
      { hearts: number; reason: string; from?: string } | undefined;
  const aim = () => {
    s.handle(1, { t: 'xform', x: 0, y: 70, z: 0, yaw: Math.PI, pitch: 0 }); // faces +z
    s.handle(2, { t: 'xform', x: 0, y: 70, z: 20, yaw: 0, pitch: 0 });
  };
  aim();
  const kill = s.handle(1, { t: 'rangedAttack', target: 2, amount: 9999 });
  const kh = heartsMsg(kill, 1), vh = heartsMsg(kill, 2);
  check('a PvP kill steals a heart (killer 11 "steal", victim 9 "loss")',
    kh?.hearts === 11 && kh?.reason === 'steal' &&
    vh?.hearts === 9 && vh?.reason === 'loss');
  const re = s.handle(2, { t: 'respawn' }).find((o) => o.msg.t === 'respawned')!
    .msg as { health: number };
  check('the victim respawns at their reduced max health (9 hearts = 18 HP)',
    re.health === 18);
  // A death with NO recent direct player damager moves nothing: let the 10s
  // kill-credit window lapse, then die to "the world" (fall/lava/mob path).
  s.tickWar(11); // advances worldTime past KILL_CREDIT_WINDOW
  const mobDeath = s.handle(2, { t: 'selfhurt', amount: 9999 });
  check('a mob/fall death moves no hearts',
    mobDeath.some((o) => o.msg.t === 'killfeed') &&
    !mobDeath.some((o) => o.msg.t === 'hearts') &&
    !mobDeath.some((o) => o.msg.t === 'eliminated'));
  s.handle(2, { t: 'respawn' });
  // A killer already at the cap wastes the steal but the victim still pays.
  s.adminSetHearts(1, MAX_HEARTS);
  aim();
  const capKill = s.handle(1, { t: 'rangedAttack', target: 2, amount: 9999 });
  check('a kill at 20 hearts keeps the killer at 20 (victim still loses one)',
    heartsMsg(capKill, 1)?.hearts === MAX_HEARTS &&
    heartsMsg(capKill, 2)?.hearts === 8);
}

// --- Server: 0 hearts eliminates (and only PvP can do it) ----------------------
{
  const s = new GameServer(1337, mulberry32(78));
  s.addPlayer(1, { username: 'Hunter', faction: 0 });
  s.addPlayer(2, { username: 'Prey', faction: 1 });
  // A mob death at 1 heart does NOT eliminate (kids never lose hearts to zombies).
  s.adminSetHearts(2, 1);
  const mob = s.handle(2, { t: 'selfhurt', amount: 9999 });
  check('a mob kill at 1 heart does NOT eliminate',
    !mob.some((o) => o.msg.t === 'eliminated') &&
    s.handle(2, { t: 'respawn' }).some((o) => o.msg.t === 'respawned'));
  // A PvP kill at 1 heart DOES: hook fires, banner + killfeed go out, respawn
  // is refused, and the comeback penalty (5 hearts) is what persists.
  let hooked = '';
  s.onEliminate = (u, by) => { hooked = `${u}<${by}`; return 4242; };
  s.handle(1, { t: 'xform', x: 0, y: 70, z: 0, yaw: Math.PI, pitch: 0 });
  s.handle(2, { t: 'xform', x: 0, y: 70, z: 20, yaw: 0, pitch: 0 });
  const fatal = s.handle(1, { t: 'rangedAttack', target: 2, amount: 9999 });
  const banner = fatal.find((o) => o.to === 2 && o.msg.t === 'eliminated')?.msg as
    { by: string; until: number } | undefined;
  check('0 hearts eliminates: shell hook + full-screen banner + killfeed line',
    hooked === 'Prey<Hunter' && banner?.by === 'Hunter' && banner?.until === 4242 &&
    fatal.some((o) => o.msg.t === 'killfeed' &&
      String((o.msg as { victim: string }).victim).includes('ELIMINATED')));
  check('an eliminated player cannot respawn (only the boot)',
    s.handle(2, { t: 'respawn' }).length === 0);
  check('the comeback penalty (5 hearts) is what persists at elimination',
    (s.capturePlayerState(2)!.data.hearts as number) === COMEBACK_HEARTS);
}

// --- Server: an unattended turret kill moves nothing ---------------------------
{
  const s = new GameServer(1337, mulberry32(79));
  s.addPlayer(1, { username: 'Owner', faction: 0 });
  s.addPlayer(2, { username: 'Walker', faction: 1 });
  s.handle(1, { t: 'xform', x: 0.5, y: 70, z: 0.5, yaw: 0, pitch: 0 });
  s.handle(1, { t: 'edit', x: 1, y: 70, z: 0, block: Block.Turret });
  s.handle(1, { t: 'turretClaim', x: 1, y: 70, z: 0 });
  s.handle(1, { t: 'turretLoad', x: 1, y: 70, z: 0, item: Item.Cannonball, count: 64 });
  s.handle(1, { t: 'turretLoad', x: 1, y: 70, z: 0, item: Item.OilBarrel, count: 8 });
  s.adminSetHearts(2, 1);
  s.handle(2, { t: 'xform', x: 3, y: 70, z: 0, yaw: 0, pitch: 0 });
  const out: ReturnType<GameServer['handle']> = [];
  for (let i = 0; i < 60 && !s.snapshot().find((p) => p.id === 2)!.dead; i++) {
    out.push(...s.tickTurrets(1));
  }
  check('a turret kill with no recent player attacker moves NO hearts',
    s.snapshot().find((p) => p.id === 2)!.dead &&
    !out.some((o) => o.msg.t === 'hearts') &&
    !out.some((o) => o.msg.t === 'eliminated'));
}

// --- Server: heart consume/withdraw validation ---------------------------------
{
  const s = new GameServer(1337, mulberry32(80));
  s.addPlayer(1);
  const heartsOf = (out: ReturnType<GameServer['handle']>) =>
    (out.find((o) => o.msg.t === 'hearts')?.msg as { hearts: number } | undefined)?.hearts;
  check('heartConsume grants +1 max heart', heartsOf(s.handle(1, { t: 'heartConsume' })) === 11);
  s.adminSetHearts(1, MAX_HEARTS);
  const full = s.handle(1, { t: 'heartConsume' });
  check('heartConsume at the 20-heart cap is rejected with a notice',
    !full.some((o) => o.msg.t === 'hearts') && full.some((o) => o.msg.t === 'notice'));
  s.adminSetHearts(1, 3);
  const w1 = s.handle(1, { t: 'heartWithdraw' });
  check('heartWithdraw at 3 hearts leaves the 2-heart floor', heartsOf(w1) === 2);
  const w2 = s.handle(1, { t: 'heartWithdraw' });
  check('heartWithdraw below the floor is rejected with a notice',
    !w2.some((o) => o.msg.t === 'hearts') && w2.some((o) => o.msg.t === 'notice'));
  // Spectators can't touch the lifesteal economy.
  s.adminSetMode(1, 'spectator');
  check('a spectator cannot consume/withdraw hearts',
    s.handle(1, { t: 'heartConsume' }).length === 0 &&
    s.handle(1, { t: 'heartWithdraw' }).length === 0);
}

// --- Server: hearts persistence round-trip -------------------------------------
{
  const s = new GameServer(1337, mulberry32(81));
  s.addPlayer(1, { username: 'Keeper', faction: 0 });
  s.adminSetHearts(1, 14);
  const cap = s.capturePlayerState(1)!;
  check('capturePlayerState carries the hearts count', cap.data.hearts === 14);
  const s2 = new GameServer(1337, mulberry32(82));
  const w = s2.addPlayer(5, { username: 'Keeper', faction: 0, data: cap.data })
    .find((o) => o.to === 5)!.msg as
    { players: { id: number; hearts: number; health: number }[] };
  const me = w.players.find((p) => p.id === 5)!;
  check('hearts survive account data -> re-login (max HP follows: 14 = 28 HP)',
    me.hearts === 14 && me.health === 28);
  const s3 = new GameServer(1337, mulberry32(83));
  const w2 = s3.addPlayer(6, { username: 'Junk', faction: 0, data: { hearts: 'lots' } })
    .find((o) => o.to === 6)!.msg as { players: { id: number; hearts: number }[] };
  check('junk saved hearts fail-safe to the 10-heart start',
    w2.players.find((p) => p.id === 6)!.hearts === START_HEARTS);
}

// --- Server: Revival Beacon plumbing (faction-gated via shell hooks) ------------
{
  const s = new GameServer(1337, mulberry32(84));
  s.addPlayer(1, { username: 'Medic', faction: 0 });
  s.listEliminated = (f) => (f === 0 ? [{ username: 'FallenPal', remainingMs: 60_000 }] : []);
  const list = s.handle(1, { t: 'reviveList' }).find((o) => o.msg.t === 'reviveList')!
    .msg as { targets: { username: string }[] };
  check('reviveList returns eliminated faction-mates',
    list.targets.length === 1 && list.targets[0].username === 'FallenPal');
  let revived = '';
  s.onRevive = (target, faction, by) => {
    if (faction !== 0 || target !== 'FallenPal') return false;
    revived = `${by}->${target}`;
    return true;
  };
  const ok = s.handle(1, { t: 'beaconRevive', target: 'FallenPal' });
  check('beaconRevive succeeds for an eliminated teammate (ok=true consumes the beacon)',
    ok.some((o) => o.msg.t === 'revived' && (o.msg as { ok: boolean }).ok) &&
    revived === 'Medic->FallenPal');
  check('beaconRevive on a non-eliminated / unknown target is rejected (ok=false)',
    s.handle(1, { t: 'beaconRevive', target: 'Nobody' })
      .some((o) => o.msg.t === 'revived' && !(o.msg as { ok: boolean }).ok));
}

// --- Accounts: the 24h elimination lockout (login gate) -------------------------
{
  const fakeHash = (pass: string, salt: string): string => `${pass}:${salt}`;
  const acc = new Accounts();
  acc.register('Fallen1', 'pass', fakeHash, 'salt', 0);
  const now = 1_000_000;
  acc.eliminate('Fallen1', now + ELIMINATION_MS, COMEBACK_HEARTS);
  check('elimination records the 24h lockout + writes the comeback hearts',
    acc.eliminationRemaining('Fallen1', now) === ELIMINATION_MS &&
    (acc.get('Fallen1')!.data!.hearts as number) === COMEBACK_HEARTS);
  check('eliminatedOf lists the fallen for their own faction only',
    acc.eliminatedOf(0, now).length === 1 && acc.eliminatedOf(1, now).length === 0);
  check('the lockout expires on its own (timer path)',
    acc.eliminationRemaining('Fallen1', now + ELIMINATION_MS + 1) === 0);
  check('clearElimination (revive) unlocks + stamps the reviver once',
    acc.clearElimination('Fallen1', now, 'Medic') &&
    acc.eliminationRemaining('Fallen1', now) === 0 &&
    acc.popRevivedBy('Fallen1') === 'Medic' &&
    acc.popRevivedBy('Fallen1') === undefined);
  acc.eliminate('Fallen1', now + 5000);
  const acc2 = new Accounts(JSON.parse(JSON.stringify(acc.toJSON())));
  check('an elimination survives the accounts save/load round-trip',
    acc2.eliminationRemaining('Fallen1', now) === 5000);
}

// --- Items + recipes: Heart and Revival Beacon ----------------------------------
{
  check('Heart + Revival Beacon are registered items with their own sprites',
    ITEMS[Item.Heart]?.sprite === Tile.Heart &&
    ITEMS[Item.RevivalBeacon]?.sprite === Tile.RevivalBeacon &&
    ITEMS[Item.RevivalBeacon]?.maxStack === 1);
  const cells: (ItemStack | null)[] = new Array(9).fill(null);
  cells[0] = { id: Item.GoldIngot, count: 1 };
  cells[1] = { id: Item.GoldIngot, count: 1 };
  check('2 gold ingots craft a Heart (the vessel; the heart cost is enforced server-side)',
    matchGrid(cells)?.id === Item.Heart);
  const beacon: (ItemStack | null)[] = [
    { id: Item.TitaniumIngot, count: 1 }, { id: Item.Diamond, count: 1 }, { id: Item.TitaniumIngot, count: 1 },
    { id: Item.TitaniumIngot, count: 1 }, { id: Item.Heart, count: 1 }, { id: Item.TitaniumIngot, count: 1 },
    null, { id: Item.Diamond, count: 1 }, null,
  ];
  check('the Revival Beacon crafts from 4 titanium + 2 diamonds + a Heart',
    matchGrid(beacon)?.id === Item.RevivalBeacon);
  check('lifesteal items carry kid-friendly descriptions',
    itemDescription(Item.Heart).length > 0 && itemDescription(Item.RevivalBeacon).length > 0);
}


// =============================================================================
// MILESTONE B: 5000×5000 world, Heartland core, Waypoint Totems
// =============================================================================

// --- B1/B2: border + core constants, war board confined to the core ------------
{
  check('world grew to 5000×5000 with a 1000×1000 Heartland core',
    WORLD_BORDER === 5000 && WORLD_HALF === 2500 &&
    CORE_BORDER === 1000 && CORE_HALF === 500);
  check('inCore edges: ±(500−ε) inside, ±(500+ε) outside',
    inCore(499, 0) && inCore(-500, 500) && !inCore(501, 0) && !inCore(0, -500.5));
}

// --- B2: spawns never land outside the core ------------------------------------
{
  const s = new GameServer(1337, mulberry32(91));
  let allCore = true;
  for (let id = 1; id <= 24; id++) {
    const w = s.addPlayer(id).find((o) => o.to === id)!.msg as
      { players: { id: number; x: number; z: number }[] };
    const me = w.players.find((p) => p.id === id)!;
    if (!inCore(me.x, me.z)) allCore = false;
  }
  check('24 fresh spawns all land inside the Heartland core', allCore);
}

// --- Runes: loot-only armor socketables ------------------------------------------
{
  const ids = Object.keys(RUNES).map(Number);
  check('four runes registered, real items, with descriptions',
    ids.length === 4 && ids.every((id) =>
      isRune(id) && runeOf(id)?.item === id && !!ITEMS[id] &&
      itemDescription(id).length > 0));
  check('runes are loot-only (no crafting recipe mints one)',
    !RECIPES.some((r) => ids.includes(r.result.id)));

  // Socketing: first worn REAL armor piece with a free slot takes the rune.
  const inv = new RuneInv();
  check('socketing with no armor worn fails', inv.socketRune(Item.RuneOfIron) === null);
  inv.slots[ARMOR_START] = { id: Item.IronHelmet, count: 1 };
  inv.slots[ARMOR_START + 1] = { id: Item.Glider, count: 1 }; // glider is NOT armor
  const took = inv.socketRune(Item.RuneOfIron);
  check('a rune sockets into worn armor (never a glider), one per piece',
    took?.id === Item.IronHelmet && took?.rune === Item.RuneOfIron &&
    inv.socketRune(Item.RuneOfSwiftness) === null);

  // Bonus aggregation is modest and clamped.
  const none = runeBonuses([null, null, null, null]);
  check('no runes = no bonuses',
    none.armor === 0 && none.speedMult === 1 && none.mineMult === 1 && none.spreadMult === 1);
  const some = runeBonuses([
    { id: Item.IronHelmet, count: 1, rune: Item.RuneOfIron },
    { id: Item.IronChestplate, count: 1, rune: Item.RuneOfSwiftness },
    { id: Item.IronLeggings, count: 1, rune: Item.RuneOfFortune },
    { id: Item.IronBoots, count: 1, rune: Item.RuneOfFocus },
  ]);
  check('rune bonuses aggregate across worn pieces (small + bounded)',
    some.armor === 1 && some.speedMult > 1 && some.speedMult <= 1.12 &&
    some.mineMult > 1 && some.spreadMult < 1 && some.spreadMult >= 0.25);
  check('a rune on a NON-armor stack is ignored',
    runeBonuses([{ id: Item.Stick, count: 1, rune: Item.RuneOfIron }]).armor === 0);

  // The socketed rune survives the persistence round-trip.
  const blob = JSON.parse(JSON.stringify(inv.serialize()));
  const inv2 = new RuneInv();
  inv2.restore(blob);
  check('a socketed rune survives inventory serialize/restore',
    inv2.slots[ARMOR_START]?.rune === Item.RuneOfIron);

  // Runes actually appear in the loot pools (exploration reward).
  const inLoot = (id: number): boolean =>
    LOOT_TABLES.rare.some((e) => e.id === id) || LOOT_TABLES.epic.some((e) => e.id === id) ||
    VAULT_LOOT[1].some((e) => e.id === id) || VAULT_LOOT[2].some((e) => e.id === id) ||
    VAULT_LOOT[3].some((e) => e.id === id);
  check('every rune is findable in structure or vault loot', ids.every(inLoot));
}

// --- Progression: XP curve, the 100-node skill tree, faction pool ---------------
{
  // Level curve: 0 XP = level 1; thresholds match xpForLevel; capped at 100.
  check('levelFor curve + xpForLevel inverse',
    levelFor(0) === 1 && levelFor(xpForLevel(2) - 1) === 1 &&
    levelFor(xpForLevel(2)) === 2 && levelFor(xpForLevel(5)) === 5 &&
    levelFor(xpForLevel(50)) === 50 && levelFor(1e9) === MAX_LEVEL);
  check('the road to max level is long but finite (hours of content)',
    xpForLevel(MAX_LEVEL) > 50_000 && xpForLevel(MAX_LEVEL) < 500_000 &&
    xpForLevel(2) <= 60); // the first level comes fast
  check('levelProgress stays in [0,1]',
    levelProgress(0) >= 0 && levelProgress(50) > 0 && levelProgress(50) < 1 &&
    levelProgress(1e9) === 1);

  // The tree: 5 branches × 20 nodes, costs rising 1→4 with depth. The full
  // tree costs MORE points than a maxed character has — specialization.
  check('the skill tree is 100 unique nodes across 5 branches',
    SKILL_TREE.length === 100 && BRANCHES.length === 5 &&
    new Set(SKILL_TREE.map((n) => n.id)).size === 100 &&
    BRANCHES.every((b) => SKILL_TREE.filter((n) => n.branch === b.id).length === BRANCH_LENGTH));
  check('node costs rise with depth (harder the further you go)',
    nodeCost(0) === 1 && nodeCost(4) === 1 && nodeCost(5) === 2 &&
    nodeCost(10) === 3 && nodeCost(19) === 4);
  const fullTreeCost = SKILL_TREE.reduce((a, n) => a + n.cost, 0);
  check('the full tree costs more than a maxed character earns',
    fullTreeCost === 250 && totalPointsFor(MAX_LEVEL) === MAX_LEVEL - 1);
  check('every node grants at least one effect; capstones are named uniquely',
    SKILL_TREE.every((n) => Object.keys(n.effects).length >= 1) &&
    new Set(SKILL_TREE.filter((n) => n.index % 5 === 4).map((n) => n.name)).size === 20);

  // Buying: prerequisites chain within a branch; points gate purchases.
  const st = newProgress();
  st.xp = xpForLevel(4); // level 4 -> 3 points
  check('points: level 4 grants 3; roots buyable, deep nodes locked',
    totalPointsFor(4) === 3 && pointsAvailable(st) === 3 &&
    canBuyNode(st, 'scout0') && !canBuyNode(st, 'scout1') && !canBuyNode(st, 'nope0'));
  check('buying spends points and unlocks the next rank',
    buyNode(st, 'scout0') && pointsAvailable(st) === 2 && !buyNode(st, 'scout0') &&
    canBuyNode(st, 'scout1') && buyNode(st, 'scout1') && branchRank(st, 'scout') === 2);
  st.xp = xpForLevel(MAX_LEVEL); // 99 points
  for (let i = 0; i < BRANCH_LENGTH; i++) buyNode(st, `scout${i}`);
  check('a whole branch can be finished (50 points) and buffs stack',
    branchRank(st, 'scout') === 20 && ownsNode(st, 'scout19') &&
    pointsSpent(st) >= 50 && personalBuffs(st).speedMult > 1.2 &&
    personalBuffs(st).energyMult < 1 &&
    personalBuffs(newProgress()).speedMult === 1);

  // sanitizeProgress: contiguity + budget enforced; old-format saves refund.
  const dirty = sanitizeProgress({ xp: xpForLevel(4), // 3 points earned
    nodes: ['scout0', 'scout1', 'scout5', 'gunner3', 'junk', 'tank0'] });
  check('sanitizeProgress keeps only contiguous, affordable prefixes',
    dirty.nodes.includes('scout0') && dirty.nodes.includes('scout1') &&
    !dirty.nodes.includes('scout5') && !dirty.nodes.includes('gunner3') &&
    !dirty.nodes.includes('junk') && pointsSpent(dirty) <= totalPointsFor(4));
  check('old-format saves (spent tracks) refund into unspent points',
    sanitizeProgress({ xp: xpForLevel(5), spent: { swift: 3 } }).nodes.length === 0 &&
    pointsAvailable(sanitizeProgress({ xp: xpForLevel(5), spent: { swift: 3 } })) === 4);
  check('sanitizeProgress fail-closes garbage',
    sanitizeProgress(null).xp === 0 && sanitizeProgress({ xp: -5 }).xp === 0);

  // Faction pool: levels + bounded perks.
  check('factionPerks are small and bounded',
    factionPerks(1).armor === 0 && factionPerks(10).armor === 3 &&
    factionPerks(10).speedMult <= 1.05 && factionLevelFor(0) === 1);
  check('sanitizeFactionXp shapes the pool array',
    sanitizeFactionXp([5, 'x'], 2)[0] === 5 && sanitizeFactionXp(null, 2).length === 2);
  check('mob XP table covers the roster',
    XP_MOB.zombie > 0 && XP_MOB.brute > XP_MOB.zombie && XP_PLAYER_KILL > 0);

  // Server: a mob-XP report feeds the faction pool (clamped) + broadcasts fxp.
  const g = new GameServer(1337, mulberry32(60));
  g.addPlayer(1, { username: 'Xer', faction: FACTION_A });
  g.addPlayer(2, { username: 'Yer', faction: FACTION_B });
  const r1 = g.handle(1, { t: 'xp', amount: 20 });
  check('an xp report feeds the faction pool + broadcasts fxp',
    r1.some((o) => o.msg.t === 'fxp' && (o.msg as { xp: number[] }).xp[FACTION_A] === 20));
  const r2 = g.handle(1, { t: 'xp', amount: 999999 });
  check('an oversized xp report is clamped to the cap',
    r2.some((o) => o.msg.t === 'fxp' &&
      (o.msg as { xp: number[] }).xp[FACTION_A] === 20 + XP_REPORT_CAP));
  check('junk xp reports are dropped',
    g.handle(1, { t: 'xp', amount: NaN }).length === 0 &&
    g.handle(1, { t: 'xp', amount: -5 }).length === 0);

  // A PvP kill: the KILLER gets a server xpAward + the pool grows.
  g.handle(1, { t: 'xform', x: 0, y: 70, z: 0, yaw: Math.PI, pitch: 0 });
  g.handle(2, { t: 'xform', x: 0, y: 70, z: 2, yaw: 0, pitch: 0 });
  const kill = g.handle(1, { t: 'rangedAttack', target: 2, amount: 9999 });
  check('a PvP kill awards XP to the killer + the faction pool',
    kill.some((o) => o.msg.t === 'xpAward' && o.to === 1 &&
      (o.msg as { amount: number }).amount === XP_PLAYER_KILL) &&
    kill.some((o) => o.msg.t === 'fxp' &&
      (o.msg as { xp: number[] }).xp[FACTION_A] === 20 + XP_REPORT_CAP + XP_PLAYER_KILL));

  // The pools survive a serialize round-trip + ride the welcome.
  const blob = JSON.parse(JSON.stringify(g.serialize()));
  const g2 = new GameServer(1337, mulberry32(61));
  g2.restore(blob);
  const w = g2.addPlayer(5).find((o) => o.msg.t === 'welcome')!.msg as
    { factionXp: number[] };
  check('faction XP survives a serialize round-trip + rides the welcome',
    w.factionXp[FACTION_A] === 20 + XP_REPORT_CAP + XP_PLAYER_KILL);
}

// --- B4: Waypoint Totems — attune cap, toggle, teleport rules --------------------
{
  const s = new GameServer(1337, mulberry32(93));
  s.addPlayer(1, { username: 'Traveler', faction: 0 });
  const attunedOf = (out: ReturnType<GameServer['handle']>) =>
    (out.find((o) => o.msg.t === 'attuned')?.msg as
      { totems: { x: number; y: number; z: number }[] } | undefined)?.totems;
  const noticeOf = (out: ReturnType<GameServer['handle']>) =>
    (out.find((o) => o.msg.t === 'notice')?.msg as { text: string } | undefined)?.text ?? '';
  // Place + attune 4 totems in reach (the cap), then a 5th is refused.
  s.handle(1, { t: 'xform', x: 0.5, y: 70, z: 0.5, yaw: 0, pitch: 0 });
  for (let i = 0; i < 5; i++) s.handle(1, { t: 'edit', x: i, y: 70, z: 2, block: Block.WaypointTotem });
  for (let i = 0; i < 4; i++) s.handle(1, { t: 'attune', x: i, y: 70, z: 2 });
  const fifth = s.handle(1, { t: 'attune', x: 4, y: 70, z: 2 });
  check('attunement caps at 4 totems (5th refused with a notice)',
    !attunedOf(fifth) && /at most 4/.test(noticeOf(fifth)));
  // Toggle: re-attuning an attuned totem releases it, freeing a slot.
  const release = s.handle(1, { t: 'attune', x: 0, y: 70, z: 2 });
  check('re-attuning releases (toggle) and frees a slot',
    attunedOf(release)?.length === 3 &&
    attunedOf(s.handle(1, { t: 'attune', x: 4, y: 70, z: 2 }))?.length === 4);
  // Attuning a non-totem block or out of reach is a no-op.
  check('attuning a non-totem cell / out-of-reach totem is rejected',
    s.handle(1, { t: 'attune', x: 0, y: 70, z: 0 }).length === 0 &&
    s.handle(1, { t: 'attune', x: 400, y: 70, z: 400 }).length === 0);

  // Teleport: succeeds to a standing attuned totem (lands on top)...
  const tp1 = s.handle(1, { t: 'totemTeleport', x: 1, y: 70, z: 2 });
  const tpMsg = tp1.find((o) => o.msg.t === 'teleport')?.msg as
    { x: number; y: number; z: number } | undefined;
  check('totem teleport lands the player on top of the totem',
    tpMsg?.x === 1.5 && tpMsg?.y === 71 && tpMsg?.z === 2.5);
  // ...but a second port inside the 60s cooldown is refused.
  const tp2 = s.handle(1, { t: 'totemTeleport', x: 2, y: 70, z: 2 });
  check('a second teleport inside the 60s cooldown is refused server-side',
    !tp2.some((o) => o.msg.t === 'teleport') && /recharging/.test(noticeOf(tp2)));
  // After the cooldown, a recent hit (combat tag) still blocks the port.
  s.tickWar(TOTEM_COOLDOWN + 1); // advance worldTime past the cooldown
  s.handle(1, { t: 'selfhurt', amount: 2 });
  const tagged = s.handle(1, { t: 'totemTeleport', x: 2, y: 70, z: 2 });
  check('the combat tag (hit in the last 10s) blocks totem travel',
    !tagged.some((o) => o.msg.t === 'teleport') && /combat/.test(noticeOf(tagged)));
  s.tickWar(COMBAT_TAG + 1); // let the tag lapse
  // Teleporting to an attuned totem that was BROKEN prunes it instead.
  s.handle(1, { t: 'edit', x: 2, y: 70, z: 2, block: Block.Air });
  const broken = s.handle(1, { t: 'totemTeleport', x: 2, y: 70, z: 2 });
  check('teleporting to a broken totem is refused and prunes the attunement',
    !broken.some((o) => o.msg.t === 'teleport') &&
    /destroyed/.test(noticeOf(broken)) && attunedOf(broken)?.length === 3);
  // A teleport to a coordinate that was never attuned is a silent no-op.
  check('teleporting to an unattuned totem is rejected',
    s.handle(1, { t: 'totemTeleport', x: 0, y: 70, z: 2 }).length === 0);

  // Persistence: attunements survive capture -> account data -> re-login.
  const cap = s.capturePlayerState(1)!;
  const totems = cap.data.totems as { x: number }[];
  const s2 = new GameServer(1337, mulberry32(94));
  const out2 = s2.addPlayer(7, { username: 'Traveler', faction: 0, data: cap.data });
  const restored = (out2.find((o) => o.to === 7 && o.msg.t === 'attuned')?.msg as
    { totems: unknown[] } | undefined)?.totems;
  check('attuned totems survive the account-data round-trip',
    totems.length === 3 && restored?.length === 3);
  const s3 = new GameServer(1337, mulberry32(95));
  const junk = s3.addPlayer(8, { username: 'Junky', faction: 0, data: { totems: [{ x: 'a' }, 5, { x: 1, y: 2, z: 3 }] } });
  check('junk saved totems are sanitized fail-closed (only valid entries load)',
    (junk.find((o) => o.to === 8 && o.msg.t === 'attuned')?.msg as
      { totems: unknown[] }).totems.length === 1);
}

// --- B4: totem item/recipe/registration -----------------------------------------
{
  check('the Waypoint Totem is a registered, craftable, glowing block',
    ITEMS[Block.WaypointTotem]?.kind === 'block' &&
    BLOCKS[Block.WaypointTotem].emission > 0 &&
    itemDescription(Block.WaypointTotem).length > 0);
  const cells: (ItemStack | null)[] = [
    null, { id: Item.GoldIngot, count: 1 }, null,
    { id: Block.OakPlanks, count: 1 }, { id: Item.GoldIngot, count: 1 }, { id: Block.OakPlanks, count: 1 },
    { id: Block.OakPlanks, count: 1 }, { id: Block.OakPlanks, count: 1 }, { id: Block.OakPlanks, count: 1 },
  ];
  check('Waypoint Totem crafts from 2 gold + 5 planks',
    matchGrid(cells)?.id === Block.WaypointTotem);
}


// =============================================================================
// MILESTONE C: discovery biomes, surface structures + seeded loot, new mobs
// =============================================================================

// --- C1: the four new biomes exist; Crystalfields is Wilds-exclusive -----------
{
  const found = new Set<Biome>();
  let crystalSamples = 0, crystalInCore = 0, swampHighest = -1;
  outer:
  for (let x = -2400; x <= 2400; x += 24) {
    for (let z = -2400; z <= 2400; z += 24) {
      const h = terrain.height(x, z);
      const b = terrain.biomeWithWater(x, z, h);
      if (b === Biome.Crystalfields) {
        crystalSamples++;
        if (inCore(x, z)) crystalInCore++;
      }
      if (b === Biome.Swamp) swampHighest = Math.max(swampHighest, h);
      found.add(b);
      if (found.has(Biome.Jungle) && found.has(Biome.Swamp) &&
          found.has(Biome.CherryGrove) && found.has(Biome.Crystalfields) &&
          crystalSamples >= 20 && swampHighest >= 0 &&
          x > 600) break outer; // enough evidence gathered
    }
  }
  check('Jungle, Swamp, Cherry Grove and Crystalfields all generate for the seed',
    found.has(Biome.Jungle) && found.has(Biome.Swamp) &&
    found.has(Biome.CherryGrove) && found.has(Biome.Crystalfields));
  check('Crystalfields NEVER appears inside the Heartland core',
    crystalSamples > 0 && crystalInCore === 0, `${crystalSamples} samples`);
  // Edge columns (mask ~0.5) flatten only partially — gentle banks are fine,
  // but no swamp may sit meaningfully above the waterline plain.
  check('swamps flatten to near-water lowlands',
    swampHighest >= SEA_LEVEL - 1 && swampHighest <= SEA_LEVEL + 6, `h=${swampHighest}`);
  // A jungle chunk grows jungle trees (logs present) with the new blocks.
  check('new biome blocks are registered craftable items',
    ITEMS[Block.JungleLog] !== undefined && ITEMS[Block.CherryLeaves] !== undefined &&
    ITEMS[Block.Mud] !== undefined && ITEMS[Block.CrystalBlock] !== undefined &&
    BLOCKS[Block.CrystalBlock].emission > 0);
  check('crystal spikes drop Crystal Shards',
    dropFor(Block.CrystalBlock, 0.9)?.id === Item.CrystalShard);
  const jc: (ItemStack | null)[] = new Array(9).fill(null);
  jc[0] = { id: Block.JungleLog, count: 1 };
  const cc: (ItemStack | null)[] = new Array(9).fill(null);
  cc[0] = { id: Block.CherryLog, count: 1 };
  check('jungle + cherry logs craft their own planks (wired like birch/spruce)',
    matchGrid(jc)?.id === Block.JunglePlanks && matchGrid(jc)?.count === 4 &&
    matchGrid(cc)?.id === Block.CherryPlanks);
  const sc: (ItemStack | null)[] = new Array(9).fill(null);
  sc[0] = { id: Block.JunglePlanks, count: 1 }; sc[3] = { id: Block.JunglePlanks, count: 1 };
  check('new planks count as ANY-plank in generic recipes (sticks)',
    matchGrid(sc)?.id === Item.Stick);
}

// --- C2/C3: structure framework — deterministic, bounded, chest-bearing ---------
{
  // Scan for anchors: same seed -> identical placements; a fresh Terrain agrees.
  const terrain2 = new Terrain(1337);
  const sites: { cx: number; cz: number; kind: string }[] = [];
  for (let cx = -150; cx <= 150; cx++) {
    for (let cz = -150; cz <= 150; cz++) {
      const st = structureStamp(1337, cx, cz, terrain);
      if (!st) continue;
      sites.push({ cx, cz, kind: st.kind });
      const st2 = structureStamp(1337, cx, cz, terrain2);
      if (!st2 || st2.kind !== st.kind || st2.chest.x !== st.chest.x ||
          st2.chest.y !== st.chest.y || st2.chest.z !== st.chest.z) {
        sites.push({ cx: NaN, cz: NaN, kind: 'MISMATCH' });
      }
    }
  }
  check('structures generate deterministically from the seed (two Terrains agree)',
    sites.length > 3 && !sites.some((s2) => s2.kind === 'MISMATCH'), `${sites.length} sites`);
  check('a different seed moves the structures',
    (() => {
      const t9 = new Terrain(9999);
      let same = 0, checked = 0;
      for (const site of sites.slice(0, 20)) {
        checked++;
        if (structureKindAt(9999, site.cx, site.cz)) same++;
      }
      return checked > 0 && same < checked;
    })());
  // Footprint bound: every block within 24 of the anchor chunk centre (3×3 chunks).
  check('structure stamps never reach past a 3×3-chunk footprint',
    sites.slice(0, 30).every((site) => {
      const st = structureStamp(1337, site.cx, site.cz, terrain)!;
      const cxc = site.cx * 16 + 8, czc = site.cz * 16 + 8;
      return st.blocks.every((b) =>
        Math.abs(b.x - cxc) <= 24 && Math.abs(b.z - czc) <= 24);
    }));
  // The chest actually lands in a filled chunk as a real Block.Chest.
  const withChest = sites.map((site) => structureStamp(1337, site.cx, site.cz, terrain)!)
    .find((st) => st.chest.y >= 1 && st.chest.y <= 250);
  check('a filled chunk contains the structure loot chest block', (() => {
    if (!withChest) return false;
    const ccx = Math.floor(withChest.chest.x / 16), ccz = Math.floor(withChest.chest.z / 16);
    const chunk = new Chunk(ccx, ccz);
    terrain.fill(chunk);
    return chunk.get(withChest.chest.x - ccx * 16, withChest.chest.y,
      withChest.chest.z - ccz * 16) === Block.Chest;
  })());
  check('structureChestTier resolves the chest (and only the chest)', (() => {
    if (!withChest) return false;
    const c = withChest.chest;
    return structureChestTier(1337, c.x, c.y, c.z, terrain) === withChest.tier &&
      structureChestTier(1337, c.x + 1, c.y + 3, c.z, terrain) === null;
  })());
}

// --- C3: loot tables — seeded, tiered, sane ------------------------------------
{
  check('loot tables are sane (positive weights, valid items, min<=max, tiers differ)',
    (['common', 'rare', 'epic'] as const).every((tier) =>
      LOOT_TABLES[tier].every((e) => e.w > 0 && e.min >= 1 && e.min <= e.max && !!ITEMS[e.id])) &&
    LOOT_TABLES.epic.some((e) => e.id === Item.TitaniumIngot) &&
    !LOOT_TABLES.common.some((e) => e.id === Item.TitaniumIngot) &&
    LOOT_TABLES.epic.some((e) => e.id === Item.Heart));
  const a = chestLoot(1337, 10, 70, -20, 'epic');
  const b = chestLoot(1337, 10, 70, -20, 'epic');
  const c = chestLoot(1337, 11, 70, -20, 'epic');
  check('chest loot is a pure function of (seed, position, tier)',
    JSON.stringify(a) === JSON.stringify(b) && a.length >= 3 &&
    JSON.stringify(a) !== JSON.stringify(c));
  const slots = chestLootSlots(1337, 10, 70, -20, 'epic');
  check('loot slots carry exactly the rolled stacks',
    slots.filter(Boolean).length >= 3 && slots.length === 27);
}

// --- C3: server-side first-open loot (authoritative, dup-safe) ------------------
{
  // Find a real structure chest for the shared seed.
  let chest: { x: number; y: number; z: number } | null = null;
  const t = new Terrain(1337);
  outer:
  for (let cx = -150; cx <= 150; cx++) {
    for (let cz = -150; cz <= 150; cz++) {
      const st = structureStamp(1337, cx, cz, t);
      if (st) { chest = st.chest; break outer; }
    }
  }
  check('found a structure chest to test against', chest !== null);
  if (chest) {
    const s = new GameServer(1337, mulberry32(96));
    s.addPlayer(1, { username: 'Looter', faction: 0 });
    const open1 = s.handle(1, { t: 'chestOpen', x: chest.x, y: chest.y, z: chest.z })
      .find((o) => o.msg.t === 'chest')!.msg as { slots: (ItemStack | null)[] };
    check('first open of a structure chest rolls seeded loot (server-side)',
      open1.slots.filter(Boolean).length >= 3);
    const open2 = s.handle(1, { t: 'chestOpen', x: chest.x, y: chest.y, z: chest.z })
      .find((o) => o.msg.t === 'chest')!.msg as { slots: (ItemStack | null)[] };
    check('a second open returns the SAME contents (no re-roll)',
      JSON.stringify(open1.slots) === JSON.stringify(open2.slots));
    const s2 = new GameServer(1337, mulberry32(97));
    s2.addPlayer(1, { username: 'Other', faction: 1 });
    const openB = s2.handle(1, { t: 'chestOpen', x: chest.x, y: chest.y, z: chest.z })
      .find((o) => o.msg.t === 'chest')!.msg as { slots: (ItemStack | null)[] };
    check('another server on the same seed rolls IDENTICAL loot (online = offline)',
      JSON.stringify(open1.slots) === JSON.stringify(openB.slots));
    // Writes to an (opened) structure chest work like any chest.
    const empty = new Array(27).fill(null);
    s.handle(1, { t: 'chestSet', x: chest.x, y: chest.y, z: chest.z, slots: empty });
    const open3 = s.handle(1, { t: 'chestOpen', x: chest.x, y: chest.y, z: chest.z })
      .find((o) => o.msg.t === 'chest')!.msg as { slots: (ItemStack | null)[] };
    check('an opened structure chest behaves like a normal chest (writes stick)',
      open3.slots.every((sl) => sl === null));
    // Breaking a PRISTINE structure chest still spills its seeded loot.
    const s3 = new GameServer(1337, mulberry32(98));
    s3.addPlayer(1, { username: 'Smasher', faction: 0 });
    s3.handle(1, { t: 'xform', x: chest.x + 0.5, y: chest.y, z: chest.z + 1.5, yaw: 0, pitch: 0 });
    const smash = s3.handle(1, { t: 'edit', x: chest.x, y: chest.y, z: chest.z, block: 0 });
    check('breaking an unopened structure chest spills its seeded loot',
      smash.some((o) => o.msg.t === 'itemspawn'));
    // ...and once broken, the position can never re-roll (stale write refused).
    check('a broken structure chest cannot be resurrected by a stale write',
      s3.handle(1, { t: 'chestSet', x: chest.x, y: chest.y, z: chest.z, slots: [{ id: Item.Diamond, count: 64 }] }).length === 0);
  }
}

// --- C1: mud slows walking (ground-material hook) --------------------------------
{
  const base2 = 200;
  const cx2 = Math.floor(spawn.x) - 20, cz2 = Math.floor(spawn.z) - 20;
  const idle2 = { ...IDLE_INPUT } as never;
  const walk2 = { ...IDLE_INPUT, forward: true } as never;
  const walkDist = (groundBlock: number): number => {
    for (let dx = -1; dx <= 18; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        world.setBlock(cx2 + dx, base2, cz2 + dz, groundBlock);
        for (let dy = 1; dy <= 3; dy++) world.setBlock(cx2 + dx, base2 + dy, cz2 + dz, Block.Air);
      }
    }
    const p = new Player({ x: cx2 + 0.5, y: base2 + 1, z: cz2 + 0.5 });
    p.yaw = -Math.PI / 2; // face +x
    for (let i = 0; i < 10; i++) p.update(1 / 60, idle2, world);
    for (let i = 0; i < 100; i++) p.update(1 / 60, walk2, world);
    return p.pos.x - (cx2 + 0.5);
  };
  const onGrass = walkDist(Block.Grass);
  const onMud = walkDist(Block.Mud);
  check('swamp mud slows walking (gentle ~28% drag)',
    onMud < onGrass * 0.88 && onMud > onGrass * 0.55,
    `grass=${onGrass.toFixed(2)} mud=${onMud.toFixed(2)}`);
}

// --- C4: the new mobs are sane ---------------------------------------------------
{
  check('spitter is fragile ranged support; skitter is fast, low-HP melee',
    MOB_DEFS.spitter.health < MOB_DEFS.zombie.health &&
    MOB_DEFS.skitter.health <= 8 &&
    MOB_DEFS.skitter.speed > MOB_DEFS.zombie.speed * 1.5);
}

// --- D1: vault generation — deterministic, bounded, tiered ----------------------
let firstVault: VaultStamp | null = null;
{
  // Sweep the whole world once: counts + collect sample stamps.
  const cmax = Math.floor(2500 / 16);
  let core = 0, wilds = 0;
  let tier3: VaultStamp | null = null;
  const stamps: VaultStamp[] = [];
  for (let cx = -cmax; cx <= cmax; cx++) {
    for (let cz = -cmax; cz <= cmax; cz++) {
      const st = vaultStamp(1337, cx, cz, terrain);
      if (!st) continue;
      if (inCore(st.x, st.z)) core++; else wilds++;
      if (stamps.length < 12) stamps.push(st);
      if (!tier3 && st.tier === 3) tier3 = st;
      if (!firstVault && st.tier === 1) firstVault = st;
    }
  }
  check('vault counts hit the design band (8–18 core, 60+ Wilds — each MASSIVE)',
    core >= 8 && core <= 18 && wilds >= 60, `core=${core} wilds=${wilds}`);
  check('countVaults matches the sweep', countVaults(1337, terrain) === core + wilds);
  check('a Tier III vault exists in the deep Wilds', tier3 !== null);
  check('vault tier grows with distance from origin',
    vaultTier(0, 0) === 1 && vaultTier(900, 200) === 2 && vaultTier(2400, 0) === 3);
  check('vault stamps are deterministic',
    stamps.length > 0 && stamps.every((st) =>
      JSON.stringify(vaultStamp(1337, st.cx, st.cz, terrain)) === JSON.stringify(st)));
  check('a different seed lays out different vaults', (() => {
    let moved = 0;
    for (const st of stamps) if (!vaultStamp(4242, st.cx, st.cz, terrain)) moved++;
    return moved > 0;
  })());
  check('vault stamps never reach past a 7×7-chunk footprint',
    stamps.every((st) => st.blocks.every((b) =>
      Math.abs(Math.floor(b.x / 16) - st.cx) <= 3 &&
      Math.abs(Math.floor(b.z / 16) - st.cz) <= 3)));
  check('every vault is MASSIVE: 8–16 rooms (hall → wings → boss) + chest + mouth',
    stamps.every((st) =>
      st.rooms.length >= 8 && st.rooms.length <= 16 &&
      st.rooms[0].kind === 'hall' &&
      st.rooms.filter((r) => r.kind === 'boss').length === 1 &&
      st.blocks.some((b) => b.id === Block.VaultChest) &&
      Number.isFinite(st.mouth.x)));
  check('every guarded room hosts a MOB SPAWNER cage at its centre',
    stamps.every((st) => st.rooms.filter((r) => r.cap > 0).length >= 4 &&
      st.rooms.filter((r) => r.cap > 0).every((r) =>
        st.blocks.some((b) => b.x === r.x && b.y === r.y && b.z === r.z &&
          b.id === Block.MobSpawner))));
  check('vaults grew room variety (great halls / pits / crypts exist somewhere)',
    ['great', 'pit', 'crypt'].every((kind) =>
      stamps.some((st) => st.rooms.some((r) => r.kind === kind))));
  check('the staircase mouth breaks the actual surface (walk-in entrance)',
    stamps.every((st) => st.mouth.y >= terrain.height(st.mouth.x, st.mouth.z) - 1));
  check('vault walls are VaultBrick (plenty of them)',
    stamps.every((st) => st.blocks.filter((b) => b.id === Block.VaultBrick).length > 400));
}

// --- D1: vaults land in filled chunks (terrain integration) ---------------------
{
  check('found a core vault to test against', firstVault !== null);
  if (firstVault) {
    const st = firstVault;
    const ccx = Math.floor(st.chest.x / 16), ccz = Math.floor(st.chest.z / 16);
    const chunk = new Chunk(ccx, ccz);
    terrain.fill(chunk);
    const lx = st.chest.x - ccx * 16, lz = st.chest.z - ccz * 16;
    check('a filled chunk contains the VaultChest block',
      chunk.get(lx, st.chest.y, lz) === Block.VaultChest);
    check('the boss room is carved (air above the chest)',
      chunk.get(lx, st.chest.y + 1, lz) === Block.Air);
    check('vaultAt finds the vault from inside the hall (and not from afar)',
      vaultAt(1337, st.rooms[0].x, st.rooms[0].y, st.rooms[0].z, terrain)?.cx === st.cx &&
      vaultAt(1337, st.rooms[0].x + 400, st.rooms[0].y, st.rooms[0].z, terrain) === null);
    check('vaultChestAt resolves the chest (and only the chest)',
      vaultChestAt(1337, st.chest.x, st.chest.y, st.chest.z, terrain)?.cx === st.cx &&
      vaultChestAt(1337, st.chest.x + 1, st.chest.y, st.chest.z, terrain) === null);
    check('VaultBrick is iron-pick-tier hard (fight the door, not the wall)',
      BLOCKS[Block.VaultBrick].hardness >= 10 && BLOCKS[Block.VaultBrick].minTier === 2 &&
      BLOCKS[Block.VaultBrick].requiresTool);
  }
}

// --- D3: per-player vault loot — pure + tiered ----------------------------------
{
  check('vault loot tables are sane (valid items, positive weights, tiers differ)',
    ([1, 2, 3] as const).every((tier) =>
      VAULT_LOOT[tier].every((e) => e.w > 0 && e.min >= 1 && e.min <= e.max && !!ITEMS[e.id])) &&
    VAULT_LOOT[3].some((e) => e.id === Item.TitaniumIngot) &&
    !VAULT_LOOT[1].some((e) => e.id === Item.TitaniumIngot));
  const a = vaultLoot(1337, 9, -16, 2, 'Alice');
  check('vault loot is a pure function of (seed, vault, username)',
    JSON.stringify(a) === JSON.stringify(vaultLoot(1337, 9, -16, 2, 'Alice')) && a.length >= 4);
  check('different players roll different loot from the same vault', (() => {
    const users = ['Bob', 'Cara', 'Dan', 'Eve'];
    return users.some((u) =>
      JSON.stringify(vaultLoot(1337, 9, -16, 2, u)) !== JSON.stringify(a));
  })());
  check('Tier III ALWAYS grants a Heart',
    ['P1', 'P2', 'P3', 'P4', 'P5'].every((u) =>
      vaultLoot(1337, 100, 100, 3, u).some((s) => s.id === Item.Heart)));
  check('brute HP scales by tier (and it is a real boss)',
    bruteMaxHp(1) < bruteMaxHp(2) && bruteMaxHp(2) < bruteMaxHp(3) &&
    MOB_DEFS.brute.health >= 100 && MOB_DEFS.brute.hostile &&
    MOB_DEFS.brute.height > MOB_DEFS.zombie.height * 1.5);
  // State helpers: lazy respawn + the loot window + the sanitizer.
  const vs = newVaultState(2);
  vs.hp = 0; vs.deadAt = 100;
  check('vault is lootable inside the window, resealed after',
    vaultLootable(vs, 100 + VAULT_LOOT_WINDOW) && !vaultLootable(vs, 101 + VAULT_LOOT_WINDOW));
  refreshVaultState(vs, 100 + VAULT_RECHARGE + 1);
  check('the Brute lazily respawns after the recharge', vs.hp === bruteMaxHp(2));
  check('sanitizeVaultState fail-closes junk + migrates legacy openedBy ledgers',
    sanitizeVaultState({ tier: 9, hp: 50 }) === null &&
    sanitizeVaultState('nope') === null &&
    sanitizeVaultState({ tier: 3, hp: 1e9, deadAt: 5, openedBy: ['a', 7, 'b'] })!.hp === bruteMaxHp(3) &&
    Object.keys(sanitizeVaultState({ tier: 3, hp: 10, deadAt: 5, openedBy: ['a', 7, 'b'] })!.looters)
      .join(',') === 'a,b');

  // The loot-regrow ledger: per-player 30-minute cooldown + fresh rolls.
  const lv = newVaultState(1);
  check('a fresh vault has no loot cooldown for anyone',
    vaultLootCooldownLeft(lv, 'Alice', 1000) === 0);
  check('looting starts the cooldown and hands out roll indexes 0,1,2…',
    recordVaultLoot(lv, 'Alice', 1000) === 0 &&
    vaultLootCooldownLeft(lv, 'Alice', 1000) === VAULT_LOOT_COOLDOWN &&
    vaultLootCooldownLeft(lv, 'Bob', 1000) === 0 && // per-player, not global
    vaultLootCooldownLeft(lv, 'Alice', 1000 + VAULT_LOOT_COOLDOWN) === 0 &&
    recordVaultLoot(lv, 'Alice', 1000 + VAULT_LOOT_COOLDOWN) === 1);
  check('each re-loot rolls a DIFFERENT haul (roll index seeds the rng)',
    JSON.stringify(vaultLoot(1337, 9, -16, 2, 'Alice', 0)) !==
    JSON.stringify(vaultLoot(1337, 9, -16, 2, 'Alice', 1)));
  check('sanitized looters round-trip through JSON',
    vaultLootCooldownLeft(sanitizeVaultState(JSON.parse(JSON.stringify(lv)))!,
      'Alice', 1000 + VAULT_LOOT_COOLDOWN + 1) < VAULT_LOOT_COOLDOWN);
}

// --- D2/D3: server-authoritative boss + once-per-player chest -------------------
{
  check('found a vault for the server flow', firstVault !== null);
  if (firstVault) {
    const st = firstVault;
    const chest = st.chest;
    const s = new GameServer(1337, mulberry32(140));
    s.addPlayer(1, { username: 'Raider', faction: 0 });
    s.addPlayer(2, { username: 'Buddy', faction: 0 });
    const near = (id: number) => s.handle(id,
      { t: 'xform', x: chest.x + 0.5, y: chest.y + 0.5, z: chest.z + 1.5, yaw: 0, pitch: 0 });
    near(1); near(2);
    // Enter: the authoritative state reply.
    const enter = s.handle(1, { t: 'vaultEnter', cx: st.cx, cz: st.cz })
      .find((o) => o.msg.t === 'vault')!.msg as { hp: number; maxHp: number; alive: boolean; opened?: boolean };
    check('vaultEnter replies with the boss state (alive, unopened)',
      enter.alive && enter.hp === bruteMaxHp(st.tier) && enter.opened === false);
    check('vaultEnter for a non-vault chunk is refused',
      s.handle(1, { t: 'vaultEnter', cx: st.cx + 1, cz: st.cz }).length === 0);
    // Chest while the Brute lives: refused with a notice, no loot.
    const early = s.handle(1, { t: 'vaultChestOpen', x: chest.x, y: chest.y, z: chest.z });
    check('opening the chest with the Brute alive is refused',
      !early.some((o) => o.msg.t === 'gotitem') && early.some((o) => o.msg.t === 'notice'));
    // Kill the Brute: both players' hits count against the SHARED server HP.
    let cleared: Outbound[] = [];
    for (let i = 0; i < 30 && !cleared.length; i++) {
      const hit = s.handle(i % 2 === 0 ? 1 : 2,
        { t: 'vaultBossHit', cx: st.cx, cz: st.cz, amount: 10 });
      if (hit.some((o) => o.msg.t === 'vaultCleared')) cleared = hit;
    }
    check('shared boss HP falls to both players\' hits → vaultCleared + killfeed',
      cleared.some((o) => o.msg.t === 'vaultCleared') &&
      cleared.some((o) => o.msg.t === 'killfeed' &&
        (o.msg as { victim: string }).victim.includes('Vault Brute')));
    check('hits on a dead Brute do nothing',
      s.handle(1, { t: 'vaultBossHit', cx: st.cx, cz: st.cz, amount: 10 }).length === 0);
    // Per-player loot: player 1 rolls once…
    const open1 = s.handle(1, { t: 'vaultChestOpen', x: chest.x, y: chest.y, z: chest.z });
    const got1 = open1.filter((o) => o.msg.t === 'gotitem');
    check('the winner\'s chest open grants the per-player roll + vaultLooted',
      got1.length >= 4 && open1.some((o) => o.msg.t === 'vaultLooted'));
    check('…and the roll matches the pure vaultLoot function',
      JSON.stringify(got1.map((o) => o.msg as { item: number; count: number })
        .map((m) => ({ id: m.item, count: m.count }))) ===
      JSON.stringify(vaultLoot(1337, st.cx, st.cz, st.tier, 'Raider')));
    const open1b = s.handle(1, { t: 'vaultChestOpen', x: chest.x, y: chest.y, z: chest.z });
    check('an immediate second open by the same player is refused (30m regrow)',
      !open1b.some((o) => o.msg.t === 'gotitem') && open1b.some((o) => o.msg.t === 'notice'));
    // …while player 2 still gets their own roll (no husk dungeons).
    const open2 = s.handle(2, { t: 'vaultChestOpen', x: chest.x, y: chest.y, z: chest.z });
    check('a second player still gets their own loot',
      open2.filter((o) => o.msg.t === 'gotitem').length >= 4);
    // Persistence: the loot ledger survives serialize/restore.
    const save = s.serialize();
    const s2 = new GameServer(1337, mulberry32(141));
    check('the world save restores (with vault ledgers)', s2.restore(save));
    s2.addPlayer(1, { username: 'Raider', faction: 0 });
    s2.handle(1, { t: 'xform', x: chest.x + 0.5, y: chest.y + 0.5, z: chest.z + 1.5, yaw: 0, pitch: 0 });
    const openAgain = s2.handle(1, { t: 'vaultChestOpen', x: chest.x, y: chest.y, z: chest.z });
    check('the per-player loot cooldown survives a server restart',
      !openAgain.some((o) => o.msg.t === 'gotitem'));
    // The loot window closes; later the Brute respawns.
    s2.tickWar(VAULT_LOOT_WINDOW + 5); // advance worldTime past the window
    s2.addPlayer(3, { username: 'Latecomer', faction: 1 });
    s2.handle(3, { t: 'xform', x: chest.x + 0.5, y: chest.y + 0.5, z: chest.z + 1.5, yaw: 0, pitch: 0 });
    const late = s2.handle(3, { t: 'vaultChestOpen', x: chest.x, y: chest.y, z: chest.z });
    check('after the loot window the vault reseals (no loot)',
      !late.some((o) => o.msg.t === 'gotitem') && late.some((o) => o.msg.t === 'notice'));
    s2.tickWar(VAULT_RECHARGE); // …and eventually the Brute is back
    const reEnter = s2.handle(3, { t: 'vaultEnter', cx: st.cx, cz: st.cz })
      .find((o) => o.msg.t === 'vault')!.msg as { alive: boolean };
    check('the Brute respawns after the recharge clock', reEnter.alive);
    // Loot REGROWS: enough worldTime has passed (window + recharge > cooldown),
    // so after re-killing the Brute the ORIGINAL looter rolls a fresh haul.
    for (let i = 0; i < 40; i++) {
      s2.handle(3, { t: 'vaultBossHit', cx: st.cx, cz: st.cz, amount: 10 });
    }
    const regrow = s2.handle(1, { t: 'vaultChestOpen', x: chest.x, y: chest.y, z: chest.z });
    const got2 = regrow.filter((o) => o.msg.t === 'gotitem')
      .map((o) => o.msg as { item: number; count: number })
      .map((m) => ({ id: m.item, count: m.count }));
    check('the treasure regrows after the cooldown — a fresh roll for the same player',
      got2.length >= 4 &&
      JSON.stringify(got2) ===
        JSON.stringify(vaultLoot(1337, st.cx, st.cz, st.tier, 'Raider', 1)));
    // Fail-closed extras: far-away hits + a broken chest cell + spectators.
    const s3 = new GameServer(1337, mulberry32(142));
    s3.addPlayer(1, { username: 'Cheater', faction: 0 });
    s3.handle(1, { t: 'xform', x: chest.x + 500, y: 70, z: chest.z, yaw: 0, pitch: 0 });
    check('boss hits from across the map are refused',
      s3.handle(1, { t: 'vaultBossHit', cx: st.cx, cz: st.cz, amount: 10 }).length === 0);
    s3.handle(1, { t: 'xform', x: chest.x + 0.5, y: chest.y + 0.5, z: chest.z + 1.5, yaw: 0, pitch: 0 });
    s3.handle(1, { t: 'edit', x: chest.x, y: chest.y, z: chest.z, block: 0 }); // smash the chest
    for (let i = 0; i < 30; i++) s3.handle(1, { t: 'vaultBossHit', cx: st.cx, cz: st.cz, amount: 10 });
    check('a broken VaultChest cell never pays out',
      !s3.handle(1, { t: 'vaultChestOpen', x: chest.x, y: chest.y, z: chest.z })
        .some((o) => o.msg.t === 'gotitem'));
    s3.adminSetMode(1, 'spectator');
    check('spectators cannot hit the Brute or loot the chest',
      s3.handle(1, { t: 'vaultBossHit', cx: st.cx, cz: st.cz, amount: 10 }).length === 0 &&
      s3.handle(1, { t: 'vaultChestOpen', x: chest.x, y: chest.y, z: chest.z }).length === 0);
  }
}

// --- Map: every surface structure is enumerable + deterministic ----------------
{
  const list = worldStructures(1337, terrain);
  check('worldStructures enumerates the whole map (sane count + kinds)',
    list.length > 40 && list.length < 400 &&
    list.every((s) => ['tower', 'bunker', 'pod'].includes(s.kind) &&
      Number.isFinite(s.x) && Number.isFinite(s.z)),
    `count=${list.length}`);
  check('worldStructures is a pure function of the seed',
    JSON.stringify(worldStructures(1337, terrain)) === JSON.stringify(list) &&
    JSON.stringify(worldStructures(4242, terrain)) !== JSON.stringify(list));
  check('map structures line up with the real stamped structures',
    list.slice(0, 20).every((s) => {
      const st = structureStamp(1337, Math.floor(s.x / 16), Math.floor(s.z / 16), terrain);
      return st !== null && st.x === s.x && st.z === s.z && st.kind === s.kind;
    }));
}

// --- Vault reveal: worldVaults enumerates entrances for the map ------------------
{
  const vs = worldVaults(1337, terrain);
  check('worldVaults enumerates every vault entrance (count + tiers + determinism)',
    vs.length === countVaults(1337, terrain) && vs.length > 60 &&
    vs.every((v) => Number.isFinite(v.x) && Number.isFinite(v.z) && [1, 2, 3].includes(v.tier)) &&
    JSON.stringify(worldVaults(1337, terrain)) === JSON.stringify(vs));
  check('worldVaults positions are the vault mouths (walk-in entrances)',
    vs.slice(0, 12).every((v) => {
      const st = vaultStamp(1337, v.cx, v.cz, terrain)!;
      return st !== null && st.mouth.x === v.x && st.mouth.z === v.z;
    }));
}

// --- Regen: the server snapshot carries the local player's healed HP ------------
// (The HUD reads this to tick health up between hits; without it MP health froze
// until the next hit then jumped — the "random half regen" bug.)
{
  const s = new GameServer(1337, mulberry32(210));
  s.addPlayer(1, { username: 'Healer', faction: 0 });
  s.handle(1, { t: 'selfhurt', amount: 10 });
  const hurt = s.snapshot().find((p) => p.id === 1)!.health;
  for (let i = 0; i < 20; i++) s.tickRegen(1); // past the delay + several intervals
  const healed = s.snapshot().find((p) => p.id === 1)!.health;
  check('server regen heals gradually and the snapshot reports the local HP',
    hurt < 20 && healed > hurt && healed <= 20, `hurt=${hurt} healed=${healed}`);
}

// --- Healing consumables: craftable + fast-regen buff ---------------------------
{
  const grid = (ids: (number | null)[]): (ItemStack | null)[] =>
    ids.map((id) => (id == null ? null : { id, count: 1 }));
  check('Bandage + Medkit carry heal metadata (Medkit heals faster)',
    !!ITEMS[Item.Bandage].heal && !!ITEMS[Item.Medkit].heal &&
    ITEMS[Item.Medkit].heal!.interval < ITEMS[Item.Bandage].heal!.interval);
  check('Bandage is craftable (redstone-soaked wrappings)',
    matchGrid(grid([Item.Redstone, Item.Redstone, Item.Stick, null, null, null, null, null, null]))?.id === Item.Bandage);
  check('Medkit is craftable (iron case + diamond core)',
    matchGrid(grid([
      null, Item.Redstone, null,
      Item.IronIngot, Item.Diamond, Item.IronIngot,
      null, Item.Redstone, null]))?.id === Item.Medkit);

  // Server: a Medkit heals FAST and ignores the post-damage regen delay.
  const s = new GameServer(1337, mulberry32(211));
  s.addPlayer(1, { username: 'Medic', faction: 0 });
  s.addPlayer(2, { username: 'Control', faction: 0 });
  s.handle(1, { t: 'selfhurt', amount: 16 }); // Medic → 4 HP
  s.handle(2, { t: 'selfhurt', amount: 16 }); // Control → 4 HP
  const before = s.snapshot().find((p) => p.id === 1)!.health;
  s.handle(1, { t: 'useHeal', item: Item.Medkit });
  for (let i = 0; i < 10; i++) { s.tickRegen(0.5); } // 5s
  const medic = s.snapshot().find((p) => p.id === 1)!.health;
  const control = s.snapshot().find((p) => p.id === 2)!.health;
  check('a Medkit heals fast + through the post-hit delay',
    medic - before >= 8 && medic > control, `medic=${medic} control=${control}`);
  check('useHeal fail-closes on a non-heal item',
    s.handle(1, { t: 'useHeal', item: Block.Stone }).length === 0);

  // Offline: Survival.boost mirrors the server buff.
  const surv = new Survival();
  const actor = {
    health: 4, maxHealth: 20, air: 300, eyeUnderwater: false, dead: false,
    regenCooldown: 5, damage(): void {},
  };
  surv.boost(ITEMS[Item.Medkit].heal!.duration, ITEMS[Item.Medkit].heal!.interval);
  for (let i = 0; i < 10; i++) surv.update(0.5, actor); // 5s
  check('offline Survival.boost heals fast despite the damage cooldown',
    actor.health >= 12, `hp=${actor.health}`);
}

// --- Batch: traps + boats + getting-started guide + vault rebalance --------------
{
  // Trap blocks: slab-shaped, partial collision (the landmine is a thin plate).
  check('spike trap is a bottom-slab shape; landmine is a thin plate',
    JSON.stringify(collisionBoxes(Block.SpikeTrap)) === JSON.stringify([SLAB_BOTTOM]) &&
    JSON.stringify(collisionBoxes(Block.Landmine)) === JSON.stringify([PLATE_BOX]) &&
    PLATE_BOX[1][1] < 0.25);
  check('single-variant slabs always place in the lower half (no -1 top id)',
    slabPlacement(Block.SpikeTrap, -1, 0.9) === Block.SpikeTrap &&
    slabPlacement(Block.Landmine, 0, 0.8) === Block.Landmine &&
    slabPlacement(Block.OakSlab, -1, 0.9) === slabTopId(Block.OakSlab));
  check('trap blocks are registered items that drop themselves',
    ITEMS[Block.SpikeTrap]?.block === Block.SpikeTrap &&
    ITEMS[Block.Landmine]?.block === Block.Landmine &&
    dropFor(Block.SpikeTrap, 0.5)?.id === Block.SpikeTrap &&
    dropFor(Block.Landmine, 0.5)?.id === Block.Landmine);
  const cells = (ids: (number | null)[]): (ItemStack | null)[] =>
    ids.map((id) => (id === null ? null : { id, count: 1 }));
  check('trap + boat recipes craft',
    matchGrid(cells([Item.IronIngot, Item.IronIngot, Item.IronIngot,
      Block.Cobblestone, Block.Cobblestone, Block.Cobblestone,
      null, null, null]))?.id === Block.SpikeTrap &&
    matchGrid(cells([Item.Redstone, null, Item.Redstone,
      Item.IronIngot, Item.Coal, Item.IronIngot,
      null, null, null]))?.id === Block.Landmine &&
    matchGrid(cells([Block.OakPlanks, null, Block.OakPlanks,
      Block.OakPlanks, Block.OakPlanks, Block.OakPlanks,
      null, null, null]))?.id === Item.Boat);

  // Boating flag round-trips through the server snapshot (like gliding).
  const s = new GameServer(1337, mulberry32(77));
  s.addPlayer(1, { username: 'Sailor', faction: 0 });
  s.handle(1, { t: 'xform', x: 1, y: 70, z: 1, yaw: 0, pitch: 0, boating: true });
  check('xform boating flag reaches the snapshot',
    s.snapshot().find((p) => p.id === 1)?.boating === true);
  s.handle(1, { t: 'xform', x: 1, y: 70, z: 1, yaw: 0, pitch: 0 });
  check('boating flag clears when omitted',
    s.snapshot().find((p) => p.id === 1)?.boating === false);

  // Getting-started guide: unique steps, sticky marking, fail-closed sanitize.
  const ids = new Set(GUIDE_STEPS.map((st) => st.id));
  check('guide steps have unique ids',
    ids.size === GUIDE_STEPS.length && GUIDE_STEPS.length >= 6);
  const g = newGuideState();
  check('fresh guide: nothing done, first step next',
    guideProgress(g).done === 0 && !guideComplete(g) &&
    nextGuideStep(g)?.id === GUIDE_STEPS[0].id);
  check('marking works once and is sticky',
    markGuideStep(g, 'wood') && !markGuideStep(g, 'wood') && guideProgress(g).done === 1);
  check('marking an unknown step fails closed', !markGuideStep(g, 'nope'));
  for (const st of GUIDE_STEPS) markGuideStep(g, st.id);
  check('all steps marked → complete', guideComplete(g) && nextGuideStep(g) === null);
  check('sanitizeGuide round-trips + drops junk', (() => {
    const round = sanitizeGuide(JSON.parse(JSON.stringify(g)));
    return guideComplete(round) && !guideComplete(sanitizeGuide({ hacker: true })) &&
      guideProgress(sanitizeGuide(null)).done === 0;
  })());
  check('compass glyph points sensibly',
    compassGlyph(0, -10) === 'N' && compassGlyph(10, 0) === 'E' &&
    compassGlyph(0, 10) === 'S' && compassGlyph(-10, 10) === 'SW');

  // Vault compasses: three tiers, craftable, distinct sprites.
  check('vault compasses craft (iron / gold / diamond rings)',
    matchGrid(cells([null, Item.IronIngot, null,
      Item.IronIngot, Item.Redstone, Item.IronIngot,
      null, Item.Stick, null]))?.id === Item.VaultCompass1 &&
    matchGrid(cells([null, Item.GoldIngot, null,
      Item.GoldIngot, Item.Redstone, Item.GoldIngot,
      null, Item.Stick, null]))?.id === Item.VaultCompass2 &&
    matchGrid(cells([null, Item.Diamond, null,
      Item.Diamond, Item.Redstone, Item.Diamond,
      null, Item.Stick, null]))?.id === Item.VaultCompass3);
  check('mob spawner is a tough, no-drop dungeon block',
    BLOCKS[Block.MobSpawner].requiresTool && BLOCKS[Block.MobSpawner].minTier === 2 &&
    dropFor(Block.MobSpawner, 0.5) === null && !ITEMS[Block.MobSpawner]);

  // Vault rebalance: soft Tier-I Brute; richer (never-OP) Tier-I loot.
  check('Tier I Brute is soft; II/III unchanged',
    bruteMaxHp(1) === 80 && bruteMaxHp(2) === 200 && bruteMaxHp(3) === 270);
  check('every Tier I roll includes bandages; pool has pistol+glider, no diamond',
    vaultLoot(1337, 3, 3, 1, 'Newbie').some((st) => st.id === Item.Bandage) &&
    VAULT_LOOT[1].some((e) => e.id === Item.Pistol) &&
    VAULT_LOOT[1].some((e) => e.id === Item.Glider) &&
    !VAULT_LOOT[1].some((e) => e.id === Item.Diamond));
}

// --- Batch: early-game armor + lever traps + TPA -------------------------------
{
  const cells = (ids: (number | null)[]): (ItemStack | null)[] =>
    ids.map((id) => (id === null ? null : { id, count: 1 }));

  // Early-game armor: wood + stone starter sets craft, equip, and mitigate less
  // than iron (but a real full-set edge over nothing).
  check('wood + stone armor craft from planks / cobble',
    matchGrid(cells([Block.OakPlanks, Block.OakPlanks, Block.OakPlanks,
      Block.OakPlanks, null, Block.OakPlanks, null, null, null]))?.id === Item.WoodHelmet &&
    matchGrid(cells([Block.Cobblestone, null, Block.Cobblestone,
      Block.Cobblestone, Block.Cobblestone, Block.Cobblestone,
      Block.Cobblestone, Block.Cobblestone, Block.Cobblestone]))?.id === Item.StoneChestplate);
  check('wood/stone armor pieces are real armor (points > 0, but under iron)',
    (ITEMS[Item.WoodChestplate]?.armor?.points ?? 0) > 0 &&
    (ITEMS[Item.StoneChestplate]?.armor?.points ?? 0) > 0 &&
    (ITEMS[Item.WoodChestplate]!.armor!.points) < (ITEMS[Item.IronChestplate]!.armor!.points) &&
    (ITEMS[Item.StoneChestplate]!.armor!.points) < (ITEMS[Item.IronChestplate]!.armor!.points));
  check('a full stone set gives a modest, non-zero armor total',
    (() => {
      const pts = [Item.StoneHelmet, Item.StoneChestplate, Item.StoneLeggings, Item.StoneBoots]
        .reduce((a, id) => a + (ITEMS[id]!.armor!.points), 0);
      return pts === 8; // 1+3+2+2 = 32% reduction
    })());
  check('wood/stone armor equips into the right slots',
    ITEMS[Item.WoodHelmet]!.armor!.slot === 'helmet' &&
    ITEMS[Item.StoneBoots]!.armor!.slot === 'boots' &&
    !ITEMS[Item.WoodHelmet]!.glider);

  // Lever-triggered traps: registry + flip logic (pure traps.ts).
  check('lever + fall/wall traps craft cheap',
    matchGrid(cells([Item.Stick, null, null, Block.Cobblestone, null, null,
      null, null, null]))?.id === Block.Lever &&
    matchGrid(cells([Block.OakPlanks, Block.OakPlanks, null, null, null, null,
      null, null, null]))?.id === Block.FallTrap &&
    matchGrid(cells([Block.Cobblestone, Block.Cobblestone, null, null, null, null,
      null, null, null]))?.id === Block.WallTrap);
  check('trap items place the base variant and drop the base on break',
    ITEMS[Block.Lever]?.block === Block.Lever &&
    ITEMS[Block.FallTrap]?.block === Block.FallTrap &&
    ITEMS[Block.WallTrap]?.block === Block.WallTrap &&
    dropFor(Block.LeverOn, 0.5)?.id === Block.Lever &&
    dropFor(Block.FallTrapOpen, 0.5)?.id === Block.FallTrap &&
    dropFor(Block.WallTrapUp, 0.5)?.id === Block.WallTrap);
  check('flippedTrap toggles every lever/trap state (and is an involution)',
    flippedTrap(Block.Lever) === Block.LeverOn &&
    flippedTrap(Block.FallTrap) === Block.FallTrapOpen &&
    flippedTrap(Block.WallTrap) === Block.WallTrapUp &&
    flippedTrap(flippedTrap(Block.FallTrap)) === Block.FallTrap &&
    flippedTrap(Block.Stone) === -1 && isLeverBlock(Block.LeverOn));
  check('closed fall trap is solid; open is not; wall trap springs up to solid',
    isSolid(Block.FallTrap) && !isSolid(Block.FallTrapOpen) &&
    !BLOCKS[Block.WallTrap].opaque && isSolid(Block.WallTrapUp) &&
    BLOCKS[Block.WallTrapUp].opaque);
  // A lever pulls itself + nearby traps, but never chains OTHER levers.
  check('leverFlips toggles the lever + in-range traps, ignores other levers', (() => {
    const w = new Map<string, number>([
      ['0,70,0', Block.Lever],           // the pulled lever
      ['2,70,0', Block.FallTrap],        // in range -> flips
      ['0,70,3', Block.WallTrap],        // in range -> flips
      ['1,70,0', Block.Lever],           // another lever -> NOT flipped
      [`${LEVER_RADIUS + 3},70,0`, Block.FallTrap], // out of range -> untouched
    ]);
    const get = (x: number, y: number, z: number) => w.get(`${x},${y},${z}`) ?? Block.Air;
    const flips = leverFlips(get, 0, 70, 0);
    const at = (x: number, y: number, z: number) =>
      flips.find((f) => f.x === x && f.y === y && f.z === z)?.block;
    return at(0, 70, 0) === Block.LeverOn && at(2, 70, 0) === Block.FallTrapOpen &&
      at(0, 70, 3) === Block.WallTrapUp &&
      at(1, 70, 0) === undefined && at(LEVER_RADIUS + 3, 70, 0) === undefined;
  })());
  check('leverFlips fails closed when there is no lever at the cell',
    leverFlips(() => Block.Air, 0, 70, 0).length === 0);

  // Server: a lever pull broadcasts the flips as edits (and needs the lever in
  // reach). Linked traps beyond the puller's own edit range still flip.
  {
    const s = new GameServer(1337, mulberry32(51));
    s.addPlayer(1, { username: 'Trapper', faction: 0 });
    s.handle(1, { t: 'xform', x: 0, y: 65, z: 0, yaw: 0, pitch: 0 });
    const g = (s.snapshot()[0]);
    const px = Math.round(g.x), py = Math.round(g.y), pz = Math.round(g.z);
    s.handle(1, { t: 'edit', x: px + 1, y: py, z: pz, block: Block.Lever });
    s.handle(1, { t: 'edit', x: px + 1, y: py, z: pz + 2, block: Block.FallTrap });
    const out = s.handle(1, { t: 'lever', x: px + 1, y: py, z: pz });
    const edits = out.filter((o) => o.msg.t === 'edit')
      .map((o) => o.msg as { x: number; y: number; z: number; block: number });
    check('server lever pull flips the lever + linked trap and broadcasts edits',
      edits.some((e) => e.x === px + 1 && e.z === pz && e.block === Block.LeverOn) &&
      edits.some((e) => e.z === pz + 2 && e.block === Block.FallTrapOpen) &&
      out.every((o) => o.to === 'all'));
    check('server lever pull out of reach is refused',
      s.handle(1, { t: 'lever', x: px + 100, y: py, z: pz }).length === 0);
  }

  // TPA: request -> target holds accept -> requester teleported.
  {
    const s = new GameServer(1337, mulberry32(52));
    s.addPlayer(1, { username: 'Alice', faction: 0 });
    s.addPlayer(2, { username: 'Bob', faction: 0 });
    s.handle(1, { t: 'xform', x: 10, y: 70, z: 10, yaw: 0, pitch: 0 });
    s.handle(2, { t: 'xform', x: 200, y: 72, z: 200, yaw: 0, pitch: 0 });
    const req = s.handle(1, { t: 'tpa', target: 'Bob' });
    check('tpa request reaches the target as tpaRequest',
      req.some((o) => o.to === 2 && o.msg.t === 'tpaRequest' &&
        (o.msg as { from: string }).from === 'Alice'));
    check('tpa to an offline name notices the sender, no request sent',
      s.handle(1, { t: 'tpa', target: 'Ghost' }).every((o) => o.msg.t === 'notice'));
    const acc = s.handle(2, { t: 'tpaAccept' });
    check('accepting teleports the requester to the target',
      acc.some((o) => o.to === 1 && o.msg.t === 'teleport' &&
        (o.msg as { x: number }).x === 200) &&
      Math.round(s.snapshot().find((p) => p.id === 1)!.x) === 200);
    check('a second accept does nothing (request was one-shot)',
      s.handle(2, { t: 'tpaAccept' }).every((o) => o.msg.t === 'notice'));
    check('TPA constants are sane', TPA_HOLD === 5 && TPA_EXPIRE >= TPA_HOLD);
  }

  // Getting-started guide gained bullets + armor steps.
  check('guide includes bullets + armor steps after the gun step', (() => {
    const ids = GUIDE_STEPS.map((s) => s.id);
    return ids.includes('bullets') && ids.includes('armor') &&
      ids.indexOf('bullets') > ids.indexOf('gun') &&
      ids.indexOf('armor') > ids.indexOf('gun') &&
      ids.indexOf('vault') > ids.indexOf('armor');
  })());
}

// === Beta 1.10: buried vaults + vault variety + Sword/GoldBlock + GOLDWARS ====

// --- Vault BURIAL GUARANTEE + themed-wing variety + boss flavours ---------------
{
  const vs = worldVaults(1337, terrain);
  const stamps = vs.slice(0, 16).map((v) => vaultStamp(1337, v.cx, v.cz, terrain)!);
  check('BURIAL: no vault block breaks any surface (valleys + ravine floors count)',
    stamps.every((st) => st.blocks.every((b) => {
      if (b.id === Block.Air) return true;
      // The ruined arch at the mouth is the ONE intentional surface feature.
      if (Math.abs(b.x - st.mouth.x) <= 3 && Math.abs(b.z - st.mouth.z) <= 3) return true;
      const h = terrain.height(b.x, b.z);
      const rd = terrain.ravineDepth(b.x, b.z);
      const eff = rd > 0 ? Math.max(10, h - rd) : h;
      return b.y <= eff;
    })));
  check('every vault mouth surfaces on dry land (above sea level)',
    stamps.every((st) => st.mouth.y > SEA_LEVEL));
  const kinds = new Set<string>();
  for (const st of stamps) for (const r of st.rooms) kinds.add(r.kind);
  check('new themed wings generate (flooded / garden / treasury / lava)',
    ['flooded', 'garden', 'treasury', 'lava'].every((k) => kinds.has(k)),
    [...kinds].join(','));
  check('boss flavours vary between vaults (brute/ravager/colossus roll)',
    new Set(stamps.map((st) => st.bossKind)).size >= 2 &&
    stamps.every((st) => ['brute', 'ravager', 'colossus'].includes(st.bossKind)));
  check('every boss dais is gold-trimmed; treasuries hoard extra gold blocks',
    stamps.every((st) => st.blocks.filter((b) => b.id === Block.GoldBlock).length >= 4) &&
    stamps.filter((st) => st.rooms.some((r) => r.kind === 'treasury'))
      .every((st) => st.blocks.filter((b) => b.id === Block.GoldBlock).length >= 8));
}

// --- The Sword + Gold Block ------------------------------------------------------
{
  const sword = ITEMS[Item.Sword];
  check('the Sword exists: top melee damage, no mining power',
    !!sword?.tool && sword.tool.type === 'sword' && sword.tool.damage >= 7 &&
    sword.tool.speed <= 1);
  check('the Sword out-damages every other tool',
    Object.values(ITEMS).every((it) =>
      !it.tool || it.tool.type === 'sword' || it.tool.damage < sword.tool!.damage));
  check('Sword + Gold Block recipes exist (and gold banks 4:1 both ways)',
    RECIPES.some((r) => r.result.id === Item.Sword) &&
    RECIPES.some((r) => r.result.id === Block.GoldBlock) &&
    RECIPES.some((r) => r.kind === 'shapeless' && r.result.id === Item.GoldIngot &&
      r.result.count === 4));
  check('Gold Block is a glowing, placeable block item',
    BLOCKS[Block.GoldBlock].emission > 0 && BLOCKS[Block.GoldBlock].solid &&
    ITEMS[Block.GoldBlock]?.kind === 'block');
}


// === CHARACTER cosmetics: model + sanitize + server round-trip ================
{
  // Defaults are deterministic per seed and always in range.
  const d1 = defaultCosmetics(12345), d2 = defaultCosmetics(12345);
  check('defaultCosmetics is deterministic per seed',
    JSON.stringify(d1) === JSON.stringify(d2));
  check('defaults start bare (no hat/cape/accessory, classic hair)',
    d1.hat === 0 && d1.cape === 0 && d1.face === 0 && d1.hairStyle === 0);
  check('every default field is inside its catalog range',
    COSMETIC_KEYS.every((k) => d1[k] >= 0 && d1[k] < COSMETIC_RANGES[k]));

  // Sanitize clamps garbage: out-of-range / negative / non-numeric fall back.
  const dirty = { skin: 999, hair: -3, hat: 'crown', cape: 2.9, face: NaN };
  const clean = sanitizeCosmetics(dirty as unknown, 777);
  const base = defaultCosmetics(777);
  check('sanitizeCosmetics clamps garbage back to the seed default',
    clean.skin === base.skin && clean.hair === base.hair &&
    clean.hat === base.hat && clean.face === base.face);
  check('sanitizeCosmetics floors fractional in-range values', clean.cape === 2);
  check('sanitizeCosmetics survives null / non-objects',
    JSON.stringify(sanitizeCosmetics(null, 5)) === JSON.stringify(defaultCosmetics(5)) &&
    JSON.stringify(sanitizeCosmetics('junk', 5)) === JSON.stringify(defaultCosmetics(5)));
  check('randomCosmetics stays inside every catalog range',
    COSMETIC_KEYS.every((k) => {
      const r = randomCosmetics(mulberry32(k.length));
      return r[k] >= 0 && r[k] < COSMETIC_RANGES[k];
    }));

  // Server round-trip: push a look -> broadcast to all + roster carries it +
  // it persists into the account blob.
  const s = new GameServer(1337, mulberry32(21));
  s.addPlayer(1, { username: 'Styler', faction: 0 });
  s.addPlayer(2, { username: 'Watcher', faction: 0 });
  const look: Cosmetics = { ...defaultCosmetics(1), hat: 3, hatColor: 2, cape: 4,
    capeColor: 1, hairStyle: 2, face: 2 };
  const out = s.handle(1, { t: 'cosmetics', c: look });
  const bc = out.find((o) => o.to === 'all' && o.msg.t === 'cosmetics')?.msg as
    { id: number; c: Cosmetics } | undefined;
  check('a cosmetics push broadcasts the sanitized look to everyone',
    !!bc && bc.id === 1 && bc.c.hat === 3 && bc.c.cape === 4 && bc.c.face === 2);
  const w3 = s.addPlayer(3).find((o) => o.to === 3)!.msg as
    { players: { id: number; cosmetics?: Cosmetics }[] };
  check('the welcome roster carries saved cosmetics to late joiners',
    w3.players.find((p) => p.id === 1)?.cosmetics?.hat === 3);
  const cap = s.capturePlayerState(1);
  check('cosmetics persist into the account blob (survive re-login)',
    (cap?.data.cosmetics as Cosmetics | undefined)?.cape === 4);
  const hacked = s.handle(2, { t: 'cosmetics', c: { hat: 99999 } as unknown as Cosmetics });
  const hbc = hacked.find((o) => o.msg.t === 'cosmetics')?.msg as { c: Cosmetics };
  check('a hacked out-of-range look is clamped server-side',
    hbc.c.hat >= 0 && hbc.c.hat < COSMETIC_RANGES.hat);
}

console.log(failures === 0 ? '\nAll smoke tests passed.' : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
