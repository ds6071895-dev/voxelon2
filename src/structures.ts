// Surface structures (Milestone C): deterministic, seeded block STAMPS applied
// during chunk terrain fill (the same hook style as trees) — never post-hoc
// edits. PURE + transport-agnostic: placement and layout derive ONLY from the
// world seed + a terrain context, so the server and the offline client compute
// the identical world (loot chests included). A structure's blocks never reach
// past 1 chunk beyond its anchor chunk (3×3-chunk worst-case footprint).

import { Biome } from './biomes';
import { Block } from './blocks';
import type { LootTier } from './loot';
import { inCore } from './net/protocol';
import { hash2, mulberry32 } from './noise';
import { PLAZA_CLEAR, plazaDistance } from './plaza';
import { vaultAnchorAt, VAULT_REACH } from './vaults';
import { buildSettlement } from './settlements';

export type StructureKind = 'tower' | 'bunker' | 'pod' | 'village' | 'cottage'
  | 'inn' | 'windmill' | 'shrine' | 'ruins' | 'camp' | 'greenhouse';

export const STRUCTURE_NAMES: Record<StructureKind, string> = {
  tower: 'Watchtowers', bunker: 'Bunkers', pod: 'Cargo pods', village: 'Villages',
  cottage: 'Cottages', inn: 'Wayside inns', windmill: 'Windmills', shrine: 'Shrines',
  ruins: 'Overgrown ruins', camp: 'Traveller camps', greenhouse: 'Glass gardens',
};

/** Terrain queries a stamp needs (the Terrain class satisfies this shape). */
export interface StructureCtx {
  height(x: number, z: number): number;
  ravineDepth(x: number, z: number): number;
  biomeWithWater(x: number, z: number, h: number): Biome;
  caveEntranceAt?(x: number, z: number): boolean;
}

export interface StructureStamp {
  kind: StructureKind;
  tier: LootTier;
  /** Anchor block position (structure centre at ground level). */
  x: number; y: number; z: number;
  /** Absolute world-coordinate block writes (Block.Air entries CARVE). */
  blocks: { x: number; y: number; z: number; id: number }[];
  /** The loot chest's block position (also present in `blocks`). */
  chest: { x: number; y: number; z: number };
  /** Settlements may have several independently seeded supplies caches. */
  chests?: { x: number; y: number; z: number; tier: LootTier }[];
}

/** Ground outside this band can't host a structure (water / absurd peaks). */
const MIN_GROUND = 65, MAX_GROUND = 185;

/** Which structure kind (if any) anchors in chunk (cx, cz)? Cheap hash test —
 *  layout/terrain suitability is checked later by structureStamp. */
export function structureKindAt(seed: number, cx: number, cz: number): StructureKind | null {
  // One jittered candidate per 80m district; at least 48m between centres.
  // Unlike independent dense hashes, neighbouring villages cannot overlap.
  const gx = Math.floor(cx / 5), gz = Math.floor(cz / 5);
  if (cx !== gx * 5 + 1 + Math.floor(hash2(seed ^ 0x57a0, gx, gz) * 3) ||
      cz !== gz * 5 + 1 + Math.floor(hash2(seed ^ 0x57a1, gx, gz) * 3)) return null;
  const k = hash2(seed ^ 0x57a2, cx, cz);
  if (k < 0.23) return 'village';
  if (k < 0.43) return 'cottage';
  if (k < 0.54) return 'inn';
  if (k < 0.64) return 'windmill';
  if (k < 0.73) return 'shrine';
  if (k < 0.81) return 'ruins';
  if (k < 0.88) return 'camp';
  if (k < 0.94) return 'greenhouse';
  if (k < 0.975) return 'tower';
  if (k < 0.994 || inCore(cx * 16 + 8, cz * 16 + 8)) return 'bunker';
  return 'pod';
}

/** The full deterministic stamp for the structure anchored in (cx, cz), or
 *  null (no anchor, or the terrain there can't host one). */
// Ground a bunker will dig into: open, flat and treeless. The v0.45 biome grid
// added several more biomes of that kind, and without listing them a bunker
// would have become a rarity purely because Plains lost ground to its new
// neighbours.
const OPEN_GROUND: Biome[] = [
  Biome.Plains, Biome.Desert, Biome.Snowy, Biome.Steppe, Biome.Savanna,
  Biome.Meadow, Biome.SunflowerPlains, Biome.Mesa, Biome.Heath,
];

interface StructureSite {
  kind: StructureKind; x: number; y: number; z: number; biome: Biome; tier: LootTier;
}
const siteCaches = new WeakMap<StructureCtx, Map<string, StructureSite | null>>();

/** Lightweight discovery metadata; map sweeps never construct block arrays. */
export function structureSite(seed: number, cx: number, cz: number, ctx: StructureCtx): StructureSite | null {
  const candidate = structureKindAt(seed, cx, cz);
  if (!candidate) return null;
  let cache = siteCaches.get(ctx);
  if (!cache) { cache = new Map(); siteCaches.set(ctx, cache); }
  const key = `${seed}:${cx},${cz}`;
  if (cache.has(key)) return cache.get(key)!;
  const site = (): StructureSite | null => {
    let kind = candidate;
    const ax = cx * 16 + 8, az = cz * 16 + 8;
    if (plazaDistance(ax, az) <= PLAZA_CLEAR + 23) return null;
    const g = ctx.height(ax, az);
    if (g < MIN_GROUND || g > MAX_GROUND) return null;
    const biome = ctx.biomeWithWater(ax, az, g);
    if (biome === Biome.Ocean || biome === Biome.Beach || biome === Biome.Ashlands) return null;
    const radius = kind === 'village' ? 14 : kind === 'inn' ? 11 : 9;
    for (let dx = -radius; dx <= radius; dx += radius) {
      for (let dz = -radius; dz <= radius; dz += radius) {
        const h = ctx.height(ax + dx, az + dz);
        if (h < MIN_GROUND || Math.abs(h - g) > (kind === 'village' ? 6 : 9) ||
            ctx.ravineDepth(ax + dx, az + dz) > 0 || ctx.caveEntranceAt?.(ax + dx, az + dz)) return null;
      }
    }
    // Vaults own their complete footprint, including their buried wings.
    for (let dx = -VAULT_REACH - 1; dx <= VAULT_REACH + 1; dx++) {
      for (let dz = -VAULT_REACH - 1; dz <= VAULT_REACH + 1; dz++) {
        if (vaultAnchorAt(seed, cx + dx, cz + dz, ctx)) return null;
      }
    }
    if (kind === 'bunker' && !OPEN_GROUND.includes(biome)) kind = 'tower';
    const tier: LootTier = kind === 'pod' ? 'epic'
      : ['bunker', 'inn', 'shrine', 'ruins', 'village'].includes(kind) ? 'rare' : 'common';
    return { kind, x: ax, y: g, z: az, biome, tier };
  };
  const result = site();
  if (cache.size >= 8192) cache.clear();
  cache.set(key, result);
  return result;
}

export function structureStamp(
  seed: number, cx: number, cz: number, ctx: StructureCtx
): StructureStamp | null {
  const site = structureSite(seed, cx, cz, ctx);
  if (!site) return null;
  const { kind, x: ax, y: g, z: az, biome } = site;
  const rng = mulberry32(
    (seed ^ Math.imul(cx, 0x27d4eb2f) ^ Math.imul(cz, 0x165667b1) ^ 0x517) >>> 0);
  if (kind !== 'tower' && kind !== 'bunker' && kind !== 'pod') {
    return buildSettlement(kind, ax, g, az, biome, rng, ctx);
  }
  const blocks: StructureStamp['blocks'][number][] = [];
  const put = (x: number, y: number, z: number, id: number): void => {
    blocks.push({ x, y, z, id });
  };
  let chest: { x: number; y: number; z: number };
  let tier: LootTier;

  if (kind === 'tower') {
    // Ruined Watchtower: a hollow 5×5 cobble tower, more collapsed the higher
    // it goes, plank platform + chest at the top, doorway at the south face.
    tier = 'common';
    const h = 8 + Math.floor(rng() * 5);
    for (let dx = -2; dx <= 2; dx++) {
      for (let dz = -2; dz <= 2; dz++) {
        put(ax + dx, g, az + dz, Block.Cobblestone); // level foundation
        const wall = Math.abs(dx) === 2 || Math.abs(dz) === 2;
        for (let y = 1; y <= h; y++) {
          if (!wall) { put(ax + dx, g + y, az + dz, Block.Air); continue; } // hollow interior
          if (dx === 0 && dz === -2 && y <= 2) { put(ax + dx, g + y, az + dz, Block.Air); continue; } // doorway
          // Ruin: the top half sheds more and more blocks.
          const ruin = (y / h) * 0.55 * rng() * 2;
          if (y > 2 && ruin > 0.42) continue;
          put(ax + dx, g + y, az + dz, Block.Cobblestone);
        }
      }
    }
    for (let dx = -2; dx <= 2; dx++) {
      for (let dz = -2; dz <= 2; dz++) {
        put(ax + dx, g + h, az + dz, Block.OakPlanks); // top platform
      }
    }
    for (const [dx, dz] of [[-2, -2], [2, -2], [-2, 2], [2, 2]]) {
      put(ax + dx, g + h + 1, az + dz, Block.Cobblestone); // corner crenels
    }
    // An open spiral stair gives the lookout a real route to its treasure.
    const steps = [[-1, -1], [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0]];
    for (let y = 0; y < h; y++) {
      const [dx, dz] = steps[y % steps.length];
      put(ax + dx, g + y, az + dz, Block.OakPlanks);
      for (let head = 1; head <= 3; head++) put(ax + dx, g + y + head, az + dz, Block.Air);
    }
    put(ax, g + h, az, Block.OakPlanks);
    put(ax, g + h + 1, az, Block.Chest);
    chest = { x: ax, y: g + h + 1, z: az };
  } else if (kind === 'bunker') {
    // Bunker: a cobble hatch pad on the surface, a shaft straight down into a
    // carved basalt-walled room — chest inside, sometimes a dormant sentry.
    tier = 'rare';
    const floorY = g - 9;
    // Basalt shell around a 7×3×5 room, air inside, lit by a torch.
    for (let dx = -4; dx <= 4; dx++) {
      for (let dz = -3; dz <= 3; dz++) {
        for (let y = floorY; y <= floorY + 4; y++) {
          const shell = Math.abs(dx) === 4 || Math.abs(dz) === 3 ||
            y === floorY || y === floorY + 4;
          put(ax + dx, y, az + dz, shell ? Block.Basalt : Block.Air);
        }
      }
    }
    // Entry shaft (1×1) from the surface into the room.
    for (let y = floorY + 4; y <= g + 1; y++) put(ax, y, az, Block.Air);
    // Surface hatch: a cobble rim with a torch so the hole reads as man-made.
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        if (dx === 0 && dz === 0) continue;
        put(ax + dx, g, az + dz, Block.Cobblestone);
      }
    }
    put(ax + 1, g + 1, az + 1, Block.Torch);
    put(ax, floorY + 1, az, Block.Air); // landing stays clear
    put(ax - 3, floorY + 1, az - 2, Block.Chest);
    put(ax - 3, floorY + 1, az + 2, Block.Torch);
    // A roofed walk-down stair replaces the old inescapable nine-block drop.
    for (let step = 0; step <= 9; step++) {
      const z = az - 11 + step, y = g - step;
      for (let dx = -1; dx <= 1; dx++) {
        put(ax + dx, y, z, Block.Cobblestone);
        for (let head = 1; head <= 3; head++) put(ax + dx, y + head, z, Block.Air);
      }
      if (step % 3 === 0) put(ax + 2, y + 1, z, Block.Torch);
    }
    put(ax, g, az, Block.Glass); // sealed skylight above the old hatch
    if (rng() < 0.5) put(ax + 3, floorY + 1, az + 2, Block.Turret); // dormant sentry
    chest = { x: ax - 3, y: floorY + 1, z: az - 2 };
  } else {
    // Crashed Cargo Pod: a scorched crater with a broken basalt shell around
    // the cargo chest — the best surface loot, mostly found in the Wilds.
    tier = 'epic';
    for (let dx = -4; dx <= 4; dx++) {
      for (let dz = -4; dz <= 4; dz++) {
        const d = Math.hypot(dx, dz);
        if (d > 4.2) continue;
        if (d > 2.8) {
          put(ax + dx, g, az + dz, Block.Basalt); // scorched rim
        } else {
          put(ax + dx, g, az + dz, Block.Air);      // crater bowl
          put(ax + dx, g - 1, az + dz, Block.Basalt);
        }
        for (let y = 1; y <= 3; y++) put(ax + dx, g + y, az + dz, Block.Air); // clear above
      }
    }
    // Broken shell: a partial ring of basalt (with gaps) around the cargo.
    for (const [dx, dz] of [[-2, 0], [2, 0], [0, -2], [0, 2], [-1, -2], [2, 1], [-2, -1]]) {
      if (rng() < 0.75) {
        put(ax + dx, g, az + dz, Block.Basalt);
        if (rng() < 0.5) put(ax + dx, g + 1, az + dz, Block.Basalt);
      }
    }
    if (rng() < 0.7) put(ax + 1, g, az - 1, Block.Glass); // heat-fused sand
    put(ax, g - 1, az, Block.Basalt);
    put(ax, g, az, Block.Chest);
    chest = { x: ax, y: g, z: az };
  }

  return { kind, tier, x: ax, y: g, z: az, blocks, chest };
}

/** Every surface structure in the world (a one-time full sweep for the map).
 *  Cheap: only district candidates pay for site checks, and no block stamps
 *  are built. Pure — the same on server + client. */
export function worldStructures(
  seed: number, ctx: StructureCtx, half = 2500
): { x: number; z: number; kind: StructureKind; tier: LootTier }[] {
  const out: { x: number; z: number; kind: StructureKind; tier: LootTier }[] = [];
  const cmax = Math.floor(half / 16);
  for (let cx = -cmax; cx <= cmax; cx++) {
    for (let cz = -cmax; cz <= cmax; cz++) {
      if (!structureKindAt(seed, cx, cz)) continue;
      const st = structureSite(seed, cx, cz, ctx);
      if (st) out.push({ x: st.x, z: st.z, kind: st.kind, tier: st.tier });
    }
  }
  return out;
}

/** Is (x,y,z) the pristine loot chest of some structure? Checks the anchors of
 *  the surrounding 3×3 chunks (a stamp never reaches further). Returns its loot
 *  tier, or null. Shared by the server (authoritative first-open) + offline. */
export function structureChestTier(
  seed: number, x: number, y: number, z: number, ctx: StructureCtx
): LootTier | null {
  const cx = Math.floor(x / 16), cz = Math.floor(z / 16);
  for (let dx = -1; dx <= 1; dx++) {
    for (let dz = -1; dz <= 1; dz++) {
      const st = structureStamp(seed, cx + dx, cz + dz, ctx);
      const extra = st?.chests?.find(c => c.x === x && c.y === y && c.z === z);
      if (extra) return extra.tier;
      if (st && st.chest.x === x && st.chest.y === y && st.chest.z === z) return st.tier;
    }
  }
  return null;
}
