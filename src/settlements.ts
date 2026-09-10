// Composable, seeded surface architecture. All coordinates stay within ±14m
// of the anchor, including roof overhangs, paths and landscaping.
import { Biome } from './biomes';
import { Block, stairsBaseOf } from './blocks';
import type { LootTier } from './loot';
import type { StructureCtx, StructureKind, StructureStamp } from './structures';

type Put = (x: number, y: number, z: number, id: number) => void;
function rotated(put: Put, x: number, z: number, turn: number): Put {
  return (u, y, v, id) => {
    const base = stairsBaseOf(id);
    if (base >= 0) id = base + ((id - base + turn) % 4);
    for (let i = 0; i < turn; i++) [u, v] = [-v, u];
    put(x + u, y, z + v, id);
  };
}

export function buildSettlement(
  kind: StructureKind, ax: number, g: number, az: number, biome: Biome,
  rng: () => number, ctx: StructureCtx,
): StructureStamp {
  const blocks: StructureStamp['blocks'] = [];
  const chests: NonNullable<StructureStamp['chests']> = [];
  const turn = Math.floor(rng() * 4);
  const world = (x: number, z: number): [number, number] => {
    for (let i = 0; i < turn; i++) [x, z] = [-z, x];
    return [ax + x, az + z];
  };
  const put: Put = rotated((x, y, z, id) => blocks.push({ x, y: g + y, z, id }), ax, az, turn);
  const cold = [Biome.Snowy, Biome.SnowyTaiga, Biome.Taiga, Biome.Highlands, Biome.IceSpikes].includes(biome);
  const dry = [Biome.Desert, Biome.Mesa, Biome.Savanna, Biome.Steppe].includes(biome);
  const pink = biome === Biome.CherryGrove || (!cold && !dry && rng() < 0.17);
  const log = cold ? Block.SpruceLog : pink ? Block.CherryLog : dry ? Block.JungleLog : Block.OakLog;
  const wood = cold ? Block.SprucePlanks : pink ? Block.CherryPlanks : dry ? Block.JunglePlanks : Block.OakPlanks;
  const wall = dry ? Block.Sandstone : cold ? Block.BirchPlanks : rng() < 0.5 ? Block.BirchPlanks : Block.Wool;
  const stone = dry ? Block.Sandstone : Block.Cobblestone;
  const leaf = pink ? Block.CherryLeaves : cold ? Block.SpruceLeaves : Block.Leaves;
  const roof = cold || rng() < 0.6 ? Block.SprucePlanks : Block.OakPlanks;
  const stair = roof === Block.SprucePlanks ? Block.SpruceStairsN : Block.OakStairsN;
  const slab = roof === Block.SprucePlanks ? Block.SpruceSlab : Block.OakSlab;
  const ground = (x: number, z: number) => { const [wx, wz] = world(x, z); return ctx.height(wx, wz) - g; };
  const cache = (p: Put, x: number, y: number, z: number, tier: LootTier) => {
    p(x, y, z, Block.Chest);
    const b = blocks[blocks.length - 1];
    chests.push({ x: b.x, y: b.y, z: b.z, tier });
  };
  const box = (p: Put, x1: number, y1: number, z1: number, x2: number, y2: number, z2: number, id: number) => {
    for (let x = x1; x <= x2; x++) for (let z = z1; z <= z2; z++)
      for (let y = y1; y <= y2; y++) p(x, y, z, id);
  };
  const radius = kind === 'village' ? 14 : kind === 'inn' ? 11 : 9;
  // Clear entire trees, including their crowns; retaining clipped canopy over
  // a new roof makes even a carefully built cottage look like a generation bug.
  for (let x = -radius; x <= radius; x++) for (let z = -radius; z <= radius; z++) {
    const h = ground(x, z);
    const edge = Math.max(Math.abs(x), Math.abs(z));
    const level = edge <= radius - 3 ? 0 : Math.round(h * (edge - radius + 3) / 3);
    for (let y = Math.min(h, level) - 3; y <= level; y++) put(x, y, z, y === level ? (dry ? Block.Sand : cold ? Block.SnowyGrass : Block.Grass) : Block.Dirt);
    for (let y = level + 1; y <= Math.max(h + 30, 24); y++) put(x, y, z, Block.Air);
  }
  const lamp = (x: number, z: number) => {
    put(x, 0, z, stone);
    for (let y = 1; y <= 3; y++) put(x, y, z, log);
    put(x, 4, z, Block.SoulLantern);
    put(x, 5, z, slab);
  };
  const flowers = (p: Put, x: number, z: number) => {
    p(x, 0, z, Block.Grass);
    p(x, 1, z, rng() < 0.5 ? Block.Poppy : Block.Dandelion);
  };
  const house = (x: number, z: number, facing: number, w = 3, d = 3, tall = 4, tier: LootTier = 'common') => {
    const p = rotated(put, x, z, facing);
    box(p, -w, -9, -d, w, -1, d, stone);
    box(p, -w, 0, -d, w, 0, d, wood);
    for (let u = -w; u <= w; u++) for (let v = -d; v <= d; v++) {
      const edge = Math.abs(u) === w || Math.abs(v) === d;
      for (let y = 1; y <= tall; y++) {
        const post = Math.abs(u) === w && Math.abs(v) === d;
        const window = y >= 2 && y <= 3 && (Math.abs(u) === w ? Math.abs(v) <= 1 : Math.abs(u) === 1);
        p(u, y, v, !edge ? Block.Air : post || y === tall ? log : window ? Block.Glass : wall);
      }
    }
    box(p, 0, 1, d, 0, 2, d, Block.Air);
    // Stepped pitched roof with deep eaves and timber-filled gables.
    for (let u = -w - 1; u <= w + 1; u++) {
      const y = tall + 1 + w + 1 - Math.abs(u);
      for (let v = -d - 1; v <= d + 1; v++) {
        p(u, y, v, u === 0 ? slab : stair + (u < 0 ? 1 : 3));
        if (Math.abs(v) === d && Math.abs(u) <= w) for (let yy = tall + 1; yy < y; yy++) p(u, yy, v, wood);
      }
    }
    // Chimney, hearth, workbench, table, seats and a sleeping alcove.
    if (rng() < 0.8) {
      box(p, w - 1, 1, -d + 1, w - 1, tall + w + 2, -d + 1, stone);
      p(w - 1, 1, -d + 2, Block.Furnace);
      p(w - 1, tall + w + 3, -d + 1, slab);
    }
    p(-w + 1, 1, -d + 1, Block.CraftingTable);
    cache(p, -w + 1, 1, -d + 2, tier);
    p(w - 1, 1, d - 1, Block.Wool); p(w - 1, 1, d - 2, Block.Wool);
    p(0, 1, -1, Block.OakSlabTop); p(0, 1, -2, stair + 2);
    p(-w + 1, 1, d - 1, Block.Torch);
    p(0, 3, d + 1, Block.SoulLantern);
    for (const u of [-w, w]) { p(u, 1, d + 1, leaf); flowers(p, u, d + 2); }
    p(0, 0, d + 1, stone);
  };
  const well = () => {
    for (let x = -2; x <= 2; x++) for (let z = -2; z <= 2; z++) {
      put(x, -1, z, stone);
      put(x, 0, z, Math.abs(x) === 2 || Math.abs(z) === 2 ? stone : Block.Water);
    }
    for (const x of [-2, 2]) for (let y = 1; y <= 4; y++) put(x, y, 0, log);
    box(put, -3, 4, -2, 3, 4, 2, slab);
    put(0, 3, 0, Block.SoulLantern);
  };

  if (kind === 'village') {
    // A readable village square, with 3–4 independently varied cottages,
    // connected streets, a communal well and a garden or market on the fourth lot.
    for (let i = -14; i <= 14; i++) for (let w = -1; w <= 1; w++) {
      const h = Math.abs(i) > 11 ? Math.round(ground(i, w) * (Math.abs(i) - 11) / 3) : 0;
      put(i, h, w, stone);
      const hz = Math.abs(i) > 11 ? Math.round(ground(w, i) * (Math.abs(i) - 11) / 3) : 0;
      put(w, hz, i, stone);
    }
    const lots = [[-8, -8, 0], [8, -8, 0], [-8, 8, 2], [8, 8, 2]];
    const count = rng() < 0.55 ? 4 : 3;
    for (let i = 0; i < count; i++) {
      const [x, z, facing] = lots[i];
      house(x, z, facing, 2 + Math.floor(rng() * 2), 3, 4 + Math.floor(rng() * 2), i === 0 ? 'rare' : 'common');
      for (let zz = 2; zz <= 4; zz++) put(x, 0, z < 0 ? -zz : zz, stone);
    }
    if (count === 3) {
      for (let x = 5; x <= 11; x++) for (let z = 5; z <= 11; z++) {
        if (x === 8) put(x, 0, z, Block.Water); else flowers(put, x, z);
      }
      box(put, 5, 1, 4, 11, 1, 4, slab);
      cache(put, 5, 1, 5, 'common');
    }
    well();
    for (const [x, z] of [[-3, -3], [3, 3], [-3, 3], [3, -3]]) lamp(x, z);
  } else if (kind === 'cottage' || kind === 'inn') {
    const inn = kind === 'inn';
    house(inn ? -2 : 0, -1, 0, inn ? 4 : 3, inn ? 4 : 3, inn ? 6 : 4 + Math.floor(rng() * 2), inn ? 'rare' : 'common');
    if (inn) {
      // Side terrace beneath an open pergola, with a second travellers' cache.
      box(put, 4, -5, -4, 8, 0, 4, stone);
      for (const z of [-4, 4]) box(put, 8, 1, z, 8, 5, z, log);
      for (let z = -4; z <= 4; z += 2) box(put, 3, 5, z, 9, 5, z, slab);
      put(6, 1, 0, Block.OakSlabTop); put(6, 1, 2, stair);
      cache(put, 7, 1, -3, 'common');
    }
    for (let z = 4; z <= radius; z++) {
      const y = z > radius - 3 ? Math.round(ground(0, z) * (z - radius + 3) / 3) : 0;
      put(0, y, z, stone);
    }
    for (let z = -4; z <= 5; z += 2) { flowers(put, -6, z); flowers(put, 6, z); }
    lamp(-3, 6);
  } else if (kind === 'windmill') {
    house(0, 0, 0, 3, 3, 9, 'common');
    // Four broad cloth sails on timber spokes, with a seeded straight/diagonal rig.
    const diagonal = rng() < 0.5;
    for (let arm = 0; arm < 4; arm++) for (let r = 1; r <= 6; r++) {
      let x = diagonal ? r : 0, y = r;
      for (let a = 0; a < arm; a++) [x, y] = [-y, x];
      put(x, 10 + y, 5, log);
      if (r >= 3) put(x + (arm % 2 ? 0 : 1), 10 + y + (arm % 2 ? 1 : 0), 5, Block.Wool);
    }
    put(0, 10, 5, stone);
    for (let x = -6; x <= 6; x++) for (let z = 6; z <= 7; z++) if (x % 3 !== 0) flowers(put, x, z);
  } else if (kind === 'greenhouse') {
    box(put, -5, -7, -5, 5, 0, 5, stone);
    for (let x = -5; x <= 5; x++) for (let z = -5; z <= 5; z++) {
      const top = 5 + Math.floor((5 - Math.abs(x)) / 2);
      for (let y = 1; y <= top; y++) put(x, y, z,
        y === top || Math.abs(x) === 5 || Math.abs(z) === 5 ? (x % 5 === 0 || z % 5 === 0 ? log : Block.Glass) : Block.Air);
      if (Math.abs(x) > 1 && Math.abs(x) < 5 && Math.abs(z) < 5) flowers(put, x, z);
    }
    box(put, 0, 1, 5, 0, 2, 5, Block.Air);
    cache(put, -1, 1, -4, 'common');
    lamp(3, 7); lamp(-3, 7);
  } else if (kind === 'shrine' || kind === 'ruins') {
    const ruin = kind === 'ruins';
    const masonry = ruin ? Block.MossyVaultBrick : dry ? Block.Sandstone : Block.LuminousLimestone;
    box(put, -6, -7, -6, 6, 0, 6, stone);
    for (let x = -5; x <= 5; x++) for (let z = -5; z <= 5; z++) put(x, 0, z, (x + z) % 3 === 0 ? masonry : stone);
    for (const x of [-5, 5]) for (const z of [-5, 0, 5]) {
      const height = ruin ? 3 + Math.floor(rng() * 6) : 7;
      box(put, x, 1, z, x, height, z, masonry);
      put(x, height + 1, z, ruin ? leaf : slab);
    }
    for (let x = -5; x <= 5; x++) for (const z of [-5, 5]) {
      if (!ruin || rng() < 0.7) put(x, 8 + Math.min(2, 5 - Math.abs(x)), z, masonry);
    }
    if (!ruin) {
      for (let z = -4; z <= 4; z++) for (let x = -5; x <= 5; x++) put(x, 9 + Math.min(2, 5 - Math.abs(x)), z, x === 0 ? Block.RuneGlass : slab);
      put(0, 1, -3, masonry); put(0, 2, -3, Block.CrystalBlock); put(0, 3, -3, Block.SoulLantern);
    } else {
      for (let i = 0; i < 16; i++) {
        const x = Math.floor(rng() * 11) - 5, z = Math.floor(rng() * 9) - 4;
        if (Math.abs(x) > 1) { put(x, 1, z, rng() < 0.5 ? masonry : leaf); }
      }
    }
    cache(put, 0, 1, -1, 'rare');
    lamp(-3, 7); lamp(3, 7);
  } else {
    // Two canvas tents face a shared fire, surrounded by benches and supplies.
    for (const x of [-4, 4]) {
      box(put, x - 2, -4, -4, x + 2, 0, 2, wood);
      for (let u = -2; u <= 2; u++) for (let z = -4; z <= 2; z++) put(x + u, 3 - Math.abs(u), z, Block.Wool);
      box(put, x, 1, -4, x, 3, -4, log);
      cache(put, x, 1, -2, 'common');
    }
    put(0, 0, 4, stone); put(0, 1, 4, Block.EmberBrazier);
    box(put, -2, 1, 6, 2, 1, 6, slab);
    lamp(0, -5);
  }
  const main = chests[0];
  return { kind, x: ax, y: g, z: az, tier: main.tier, blocks, chest: main, chests };
}
