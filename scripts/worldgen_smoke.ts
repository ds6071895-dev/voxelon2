// Run: npx esbuild scripts/worldgen_smoke.ts --bundle --platform=node --format=cjs --outfile=node_modules/.tmp/worldgen-smoke.cjs && node node_modules/.tmp/worldgen-smoke.cjs
import assert from 'node:assert/strict';
import { Terrain } from '../src/terrain';
import { Chunk } from '../src/chunk';
import { Block, BLOCKS } from '../src/blocks';
import { structureStamp, structureChestTier, worldStructures, STRUCTURE_NAMES } from '../src/structures';
import { chestLoot } from '../src/loot';
import { flagHome } from '../src/flags';
import { Caves, CaveLandmark } from '../src/caves';

const t = new Terrain(1337);
const start = performance.now();
const sites = worldStructures(1337, t);
const counts: Record<string, number> = {};
for (const site of sites) counts[site.kind] = (counts[site.kind] ?? 0) + 1;
console.log('World structures:', counts, `map scan ${(performance.now() - start).toFixed(0)}ms`);
assert(sites.length > 450, `Structures should be common: found ${sites.length}`);
for (const kind of Object.keys(STRUCTURE_NAMES)) assert(counts[kind] > 0, `Missing ${kind}`);
assert.deepEqual(sites, worldStructures(1337, new Terrain(1337)));
assert.notDeepEqual(sites.slice(0, 20), worldStructures(2026, new Terrain(2026)).slice(0, 20));

const chunks = new Map<string, Chunk>();
function block(x: number, y: number, z: number): number {
  const cx = Math.floor(x / 16), cz = Math.floor(z / 16), key = `${cx},${cz}`;
  let c = chunks.get(key);
  if (!c) { c = new Chunk(cx, cz); t.fill(c); chunks.set(key, c); }
  return c.get(x - cx * 16, y, z - cz * 16);
}
for (const kind of Object.keys(STRUCTURE_NAMES)) {
  for (const site of sites.filter(s => s.kind === kind).slice(0, 3)) {
    const cx = Math.floor(site.x / 16), cz = Math.floor(site.z / 16);
    const stamp = structureStamp(1337, cx, cz, t)!;
    assert.deepEqual(stamp, structureStamp(1337, cx, cz, new Terrain(1337)));
    assert(stamp.blocks.every(b => b.y > 0 && b.y < 251 && (b.id === Block.Air || BLOCKS[b.id]) &&
      Math.abs(Math.floor(b.x / 16) - cx) <= 1 && Math.abs(Math.floor(b.z / 16) - cz) <= 1), `${kind} footprint`);
    for (const chest of stamp.chests ?? [{ ...stamp.chest, tier: stamp.tier }]) {
      assert.equal(block(chest.x, chest.y, chest.z), Block.Chest, `${kind} chest survived terrain/vault stamping`);
      assert.equal(structureChestTier(1337, chest.x, chest.y, chest.z, t), chest.tier);
      assert(BLOCKS[block(chest.x, chest.y - 1, chest.z)]?.solid, `${kind} supported chest`);
      assert.equal(block(chest.x, chest.y + 1, chest.z), Block.Air, `${kind} accessible chest lid`);
      assert(chestLoot(1337, chest.x, chest.y, chest.z, chest.tier).length >= 4);
    }
  }
}
console.log('PASS: 11 structure families, seed variation, bounds, supported chests, authoritative loot.');

const landmarks: CaveLandmark[] = [];
for (let x = -7; x <= 7; x++) for (let z = -7; z <= 7; z++) {
  const l = t.caveLandscape.landmark(x, z);
  if (l?.entrance) landmarks.push(l);
}
assert(landmarks.length >= 15, `Frequent dry cave entrances: ${landmarks.length}`);
assert(new Set(landmarks.map(l => l.style)).size === 3);
let largest = 0, mouths = 0, glow = 0, water = 0;
for (const l of landmarks.slice(0, 12)) {
  largest = Math.max(largest, l.ceiling - l.floor);
  const h = t.height(l.mouthX, l.mouthZ);
  if (t.caveEntranceAt(l.mouthX, l.mouthZ)) {
    assert.equal(block(l.mouthX, h, l.mouthZ), Block.Air, 'Cave mouth breaks the surface');
    assert.equal(t.safeSpawnAt(l.mouthX, l.mouthZ), undefined, 'Never spawn above a cave hole');
    mouths++;
  }
  // Trace the centre of the approach all the way into its chamber. A clear,
  // supported ramp must survive the room/entrance union, even at chunk seams.
  const length = Math.hypot(l.x - l.mouthX, l.z - l.mouthZ);
  let previous: number | undefined;
  for (let step = 0; step <= length; step++) {
    const x = Math.round(l.mouthX + (l.x - l.mouthX) * step / length);
    const z = Math.round(l.mouthZ + (l.z - l.mouthZ) * step / length);
    const s = t.caveLandscape.column(x, z).find(s => s.entrance);
    if (!s) continue;
    const floor = s.rampFloor ?? s.floor;
    assert(BLOCKS[block(x, floor, z)]?.solid, `Cave ramp support ${x},${floor},${z}; id=${block(x, floor, z)} landmark=${JSON.stringify(l)} slices=${JSON.stringify(t.caveLandscape.column(x, z))}`);
    const clear = (y: number) => !BLOCKS[block(x, y, z)]?.solid || block(x, y, z) === Block.GlowFungus;
    assert(clear(floor + 1) && clear(floor + 2), 'Two blocks of cave walking clearance');
    if (previous !== undefined) assert(Math.abs(floor - previous) <= 2, `Cave ramp cliff at ${x},${z}: ${previous} -> ${floor}; landmark ${l.x},${l.z}`);
    previous = floor;
  }
}
assert(mouths >= 8); assert(largest >= 40, `Huge vertical chambers: ${largest}`);
for (const c of chunks.values()) for (const id of c.data) {
  if (id === Block.GlowFungus || id === Block.CrystalBlock) glow++;
  if (id === Block.Water) water++;
}
assert(glow > 50, 'Natural cave lighting'); assert(water > 0, 'Underground pools');
// Full generated data is independent of surrounding chunk generation order.
const independent = new Terrain(1337);
for (const c of [...chunks.values()].slice(-8).reverse()) {
  const other = new Chunk(c.cx, c.cz); independent.fill(other);
  assert.deepEqual(c.data, other.data, 'Chunk order independence');
  for (let x = 0; x < 16; x++) for (let z = 0; z < 16; z++) assert.equal(c.get(x, 0, z), Block.Bedrock);
}
const flag = flagHome(0);
assert.deepEqual(t.caveLandscape.column(flag.x, flag.z), [], 'Faction plazas protected');
// Flat highland isolates the cave geometry from unrelated terrain/vaults.
const flat = new Caves(1337, { height: () => 85 });
assert.deepEqual(flat.column(-128, -128), new Caves(1337, { height: () => 85 }).column(-128, -128));
console.log(`PASS: ${landmarks.length} entrances, three cave styles, ${largest}m chamber height, ramps, glow, pools, bedrock, chunk seams.`);
// Measure exposed deposits throughout real generated caves, in spatial regions
// rather than just a world-wide total that could hide large barren areas.
const ores = new Set<number>([Block.CoalOre, Block.IronOre, Block.GoldOre, Block.RedstoneOre, Block.DiamondOre]);
const depthCaps = new Map<number, number>([[Block.IronOre, 72], [Block.GoldOre, 32],
  [Block.RedstoneOre, 16], [Block.DiamondOre, 16]]);
const faces = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
let regions = 0, covered = 0;
const exposedCounts = new Map<number, number>();
for (const c of chunks.values()) {
  const eligible = new Set<string>(), deposits = new Set<string>();
  for (let x = 0; x < 16; x++) for (let z = 0; z < 16; z++) {
    const top = Math.min(240, t.height(c.cx * 16 + x, c.cz * 16 + z) - 5);
    for (let y = 4; y < top; y++) {
      const id = c.get(x, y, z);
      if (depthCaps.has(id)) assert(y <= depthCaps.get(id)!, 'Precious ores retain their depth limits');
      if (!ores.has(id) && id !== Block.Stone && id !== Block.Sandstone) continue;
      if (!faces.some(([dx, dy, dz]) => x + dx >= 0 && x + dx < 16 && z + dz >= 0 && z + dz < 16 &&
        c.get(x + dx, y + dy, z + dz) === Block.Air)) continue;
      const region = `${Math.floor(x / 8)},${Math.floor((y - 4) / 16)},${Math.floor(z / 8)}`;
      eligible.add(region);
      if (ores.has(id)) {
        deposits.add(region);
        exposedCounts.set(id, (exposedCounts.get(id) ?? 0) + 1);
      }
    }
  }
  regions += eligible.size; covered += deposits.size;
}
assert(regions > 100, 'Sample many distinct cave regions');
assert(covered / regions > 0.85, `Even cave coverage: ${covered}/${regions} regions contain exposed ore`);
for (const id of ores) assert((exposedCounts.get(id) ?? 0) > 0, `${BLOCKS[id].name} is discoverable on cave faces`);
assert(exposedCounts.get(Block.CoalOre)! > exposedCounts.get(Block.DiamondOre)!, 'Diamond remains rarer than coal');
console.log(`PASS: exposed ore in ${covered}/${regions} cave regions (${(covered / regions * 100).toFixed(1)}%), all five ores, depth limits.`);
console.log(`World generation smoke passed in ${((performance.now() - start) / 1000).toFixed(1)}s.`);
