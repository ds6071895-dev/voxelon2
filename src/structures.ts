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

export type StructureKind = 'tower' | 'bunker' | 'pod';

/** Terrain queries a stamp needs (the Terrain class satisfies this shape). */
export interface StructureCtx {
  height(x: number, z: number): number;
  ravineDepth(x: number, z: number): number;
  biomeWithWater(x: number, z: number, h: number): Biome;
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
}

// Surface landmarks need to appear during ordinary travel, not only on a long
// map sweep. At these rates a full render bubble usually contains a candidate
// in the Heartland and one or two in the Wilds; terrain suitability still
// rejects water, ravines and extreme peaks. Cargo pods keep their Wilds bias,
// so the extra density is primarily ruins and bunkers rather than free epics.
const DENSITY_CORE = 1 / 420;
const DENSITY_WILDS = 1 / 220;
/** Ground outside this band can't host a structure (water / absurd peaks). */
const MIN_GROUND = 65, MAX_GROUND = 150;

/** Which structure kind (if any) anchors in chunk (cx, cz)? Cheap hash test —
 *  layout/terrain suitability is checked later by structureStamp. */
export function structureKindAt(seed: number, cx: number, cz: number): StructureKind | null {
  const wx = cx * 16 + 8, wz = cz * 16 + 8;
  const core = inCore(wx, wz);
  if (hash2(seed ^ 0x57a1, cx, cz) > (core ? DENSITY_CORE : DENSITY_WILDS)) return null;
  const k = hash2(seed ^ 0x57a2, cx, cz);
  // Crashed pods are Wilds-biased: common out there, a rarity in the core.
  if (!core) return k < 0.4 ? 'pod' : k < 0.75 ? 'tower' : 'bunker';
  return k < 0.6 ? 'tower' : k < 0.95 ? 'bunker' : 'pod';
}

/** The full deterministic stamp for the structure anchored in (cx, cz), or
 *  null (no anchor, or the terrain there can't host one). */
export function structureStamp(
  seed: number, cx: number, cz: number, ctx: StructureCtx
): StructureStamp | null {
  let kind = structureKindAt(seed, cx, cz);
  if (!kind) return null;
  const rng = mulberry32(
    (seed ^ Math.imul(cx, 0x27d4eb2f) ^ Math.imul(cz, 0x165667b1) ^ 0x517) >>> 0);
  const ax = cx * 16 + 3 + Math.floor(rng() * 10);
  const az = cz * 16 + 3 + Math.floor(rng() * 10);
  const g = ctx.height(ax, az);
  if (g < MIN_GROUND || g > MAX_GROUND) return null;   // underwater / extreme peak
  if (ctx.ravineDepth(ax, az) > 0) return null;        // never straddle a canyon
  const biome = ctx.biomeWithWater(ax, az, g);
  if (biome === Biome.Ocean || biome === Biome.Beach) return null;
  // Bunkers dig into open flat country; anywhere else the site gets a tower.
  if (kind === 'bunker' &&
      biome !== Biome.Plains && biome !== Biome.Desert && biome !== Biome.Snowy) {
    kind = 'tower';
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
 *  Cheap: `structureKindAt` is a hash reject, so only the ~1/500 candidate
 *  chunks pay for a full `structureStamp`. Pure — the same on server + client. */
export function worldStructures(
  seed: number, ctx: StructureCtx, half = 2500
): { x: number; z: number; kind: StructureKind; tier: LootTier }[] {
  const out: { x: number; z: number; kind: StructureKind; tier: LootTier }[] = [];
  const cmax = Math.floor(half / 16);
  for (let cx = -cmax; cx <= cmax; cx++) {
    for (let cz = -cmax; cz <= cmax; cz++) {
      if (!structureKindAt(seed, cx, cz)) continue;
      const st = structureStamp(seed, cx, cz, ctx);
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
      if (st && st.chest.x === x && st.chest.y === y && st.chest.z === z) return st.tier;
    }
  }
  return null;
}
