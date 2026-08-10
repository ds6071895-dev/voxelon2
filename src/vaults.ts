// VAULTS (Milestone D): enterable underground dungeon complexes. PURE +
// transport-agnostic like structures.ts — placement, layout, guard rooms and
// per-player loot rolls all derive ONLY from the world seed + a terrain
// context, so the server and the offline client compute the identical dungeon.
//
// A vault is: a ruined surface entrance (stone arch + torch pair) over a
// walk-down staircase into a MASSIVE carved complex — 8–15 themed wings
// (great pillared halls, sunken spike pits, cramped crypts) linked by an
// L-corridor network, a MOB SPAWNER cage at the heart of every guarded room,
// a Vault Brute boss lair with a dais chest, and per-player treasure that
// REGROWS every 30 minutes. Tier (I–III) grows with distance from the origin:
// the deep Wilds hide the best vaults.

import { Biome } from './biomes';
import { Block } from './blocks';
import { Item, ItemStack } from './items';
import type { LootEntry } from './loot';
import { inCore, CORE_HALF } from './net/protocol';
import { hash2, mulberry32 } from './noise';
import type { StructureCtx } from './structures';

export type VaultTier = 1 | 2 | 3;
export type VaultFamily = 'crypt' | 'mire' | 'ember' | 'crystal' | 'gilded';
export type VaultBossKind =
  | 'bone_warden'
  | 'mire_queen'
  | 'ember_colossus'
  | 'crystal_seer'
  | 'gilded_artificer';

export const VAULT_BOSS_NAMES: Record<VaultBossKind, string> = {
  bone_warden: 'Bone Warden',
  mire_queen: 'Mire Queen',
  ember_colossus: 'Ember Colossus',
  crystal_seer: 'Crystal Seer',
  gilded_artificer: 'Gilded Artificer',
};
export const VAULT_BOSS_FAMILY: Record<VaultBossKind, VaultFamily> = {
  bone_warden: 'crypt',
  mire_queen: 'mire',
  ember_colossus: 'ember',
  crystal_seer: 'crystal',
  gilded_artificer: 'gilded',
};

/** Shared visual/combat bounds. These cover each boss's substantial body while
 * excluding thin decorative tips such as chains, wings and antennae. */
export const VAULT_BOSS_HITBOX: Record<VaultBossKind, {
  halfWidth: number; height: number;
}> = {
  bone_warden: { halfWidth: 1.1, height: 5.8 },
  mire_queen: { halfWidth: 3.3, height: 3.8 },
  ember_colossus: { halfWidth: 2.3, height: 4.7 },
  crystal_seer: { halfWidth: 3.5, height: 4.5 },
  gilded_artificer: { halfWidth: 1.9, height: 5.4 },
};

/** A vault stamp never reaches past 3 chunks beyond its anchor chunk (all
 *  offsets are ≤ ±51 blocks and the anchor sits ≥4 blocks inside its chunk).
 *  Vaults are MASSIVE now — sprawling multi-wing complexes. */
export const VAULT_REACH = 3;
/** Seconds a cleared room's spawner stays dormant (the guard respawn
 *  cooldown) — also the Brute's own respawn clock. */
export const VAULT_RECHARGE = 1800;
/** Seconds after the Brute dies during which the VaultChest can be opened. */
export const VAULT_LOOT_WINDOW = 600;
/** Seconds before the SAME player can loot the same vault chest again — the
 *  treasure regrows every 30 minutes (aligned with the Brute's respawn). */
export const VAULT_LOOT_COOLDOWN = 1800;

// Anchor density: ~12 vaults in the 1000² Heartland core — the packing ceiling
// the ±6-chunk suppression rule allows now that each vault sprawls across a
// 7×7-chunk footprint (they're MASSIVE; every Tier I entrance is marked on the
// map and Vault Compasses point the way). 60+ out in the 5000² Wilds (rarer
// per-chunk, but the Wilds are 24× the area). Ocean/beach/ravine/extreme sites
// reject candidate anchors on the real terrain.
// (Densities were re-tuned upward when the BURIAL GUARANTEE landed — it
// rejects hilly/coastal sites that used to pass, so anchors try more often.)
const DENSITY_CORE = 1 / 6;
const DENSITY_WILDS = 1 / 200;
// MIN_GROUND admits swampy lowlands (the burial rules keep those sealed and
// the mouth still refuses to surface below sea level); Beach/Ocean anchors
// are rejected separately by biome.
const MIN_GROUND = 60, MAX_GROUND = 140;

export interface VaultRoom {
  /** World-space centre of the room at interior floor level. */
  x: number; y: number; z: number;
  /** Interior half-width (the room spans centre ± hw, walls at ±(hw)). */
  hw: number;
  /** Room flavour: hall = entrance, great = pillared hall, pit = sunken
   *  spike-floored trap room, crypt = cramped side chamber, boss = the lair,
   *  flooded = waterlogged bog wing, lava = molten trench crossing, garden =
   *  glowing crystal grove, treasury = a gold-block hoard (mineable jackpot). */
  kind: 'hall' | 'room' | 'great' | 'pit' | 'crypt' | 'boss'
    | 'flooded' | 'lava' | 'garden' | 'treasury';
  /** Guard population cap for this room's MOB SPAWNER (0 = no spawner:
   *  the hall and the boss room). Guards only spawn while the spawner block
   *  at the room centre still stands — break it to silence the room. */
  cap: number;
  /** Furnishing variation. Derived from a separate hash, never layout RNG. */
  variant: 0 | 1 | 2;
}

export interface VaultStamp {
  cx: number; cz: number;
  tier: VaultTier;
  family: VaultFamily;
  /** The lair's boss flavour (visual/AI variant; HP stays tier-based). */
  bossKind: VaultBossKind;
  /** Surface anchor (above the entrance hall). */
  x: number; y: number; z: number;
  /** Interior floor level (rooms stand on VaultBrick at floorY). */
  floorY: number;
  rooms: VaultRoom[];
  /** The per-player VaultChest position (inside the boss room). */
  chest: { x: number; y: number; z: number };
  /** Entrance mouth (where the staircase breaks the surface — the arch). */
  mouth: { x: number; y: number; z: number };
  /** Underground bounding box: "you are inside the vault" test. */
  bounds: { minX: number; minY: number; minZ: number; maxX: number; maxY: number; maxZ: number };
  /** Combat-only sockets. These never become permanent world edits. */
  arena: {
    bounds: { minX: number; minY: number; minZ: number; maxX: number; maxY: number; maxZ: number };
    sockets: { x: number; y: number; z: number }[];
    cameraAnchors: { x: number; y: number; z: number }[];
    safeLanes: { x: number; y: number; z: number }[];
    seal: {
      center: { x: number; y: number; z: number };
      axis: 'x' | 'z'; halfWidth: number; height: number;
      inside: { x: number; y: number; z: number };
      outside: { x: number; y: number; z: number };
    };
  };
  /** Absolute world-coordinate block writes (Block.Air entries CARVE). */
  blocks: { x: number; y: number; z: number; id: number }[];
}

/** Loot-window/respawn state the SERVER owns per vault (persisted in the world
 *  save). Offline the client mirrors the same shape in localStorage. */
export interface VaultServerState {
  tier: VaultTier;
  /** Brute HP left (0 = dead; lazily reset VAULT_RECHARGE after deadAt). */
  hp: number;
  /** worldTime the Brute died (a large negative sentinel = never). */
  deadAt: number;
  /** Per-account loot ledger: username -> { at: worldTime of the last loot,
   *  n: total rolls taken }. The treasure REGROWS per player every
   *  VAULT_LOOT_COOLDOWN seconds, and each re-roll is a fresh (seeded) haul. */
  looters: Record<string, { at: number; n: number }>;
}

/** The Vault Brute's max HP by tier — a group fight, not a one-tap. The Tier I
 *  Brute is deliberately soft: a fresh spawn with a starter kit CAN solo it. */
export function bruteMaxHp(tier: VaultTier): number {
  return tier === 1 ? 320 : tier === 2 ? 720 : 1200;
}

const BOSS_WEIGHTS: Record<VaultTier, readonly number[]> = {
  1: [35, 25, 15, 15, 10],
  2: [20, 20, 22, 20, 18],
  3: [12, 16, 24, 24, 24],
};
const BOSS_ORDER: readonly VaultBossKind[] = [
  'bone_warden', 'mire_queen', 'ember_colossus', 'crystal_seer', 'gilded_artificer',
];

/** Boss selection is independent of the layout RNG stream. */
export function vaultBossFor(
  seed: number, cx: number, cz: number, tier: VaultTier,
): VaultBossKind {
  const roll = hash2(seed ^ 0xb055fa11, cx, cz) * 100;
  const weights = BOSS_WEIGHTS[tier];
  let sum = 0;
  for (let i = 0; i < BOSS_ORDER.length; i++) {
    sum += weights[i];
    if (roll < sum) return BOSS_ORDER[i];
  }
  return BOSS_ORDER[BOSS_ORDER.length - 1];
}

export function vaultFamilyFor(
  seed: number, cx: number, cz: number, tier: VaultTier,
): VaultFamily {
  return VAULT_BOSS_FAMILY[vaultBossFor(seed, cx, cz, tier)];
}

/** Vault tier by distance from the origin: the core is Tier I training wheels,
 *  the mid Wilds Tier II, the deep Wilds Tier III (guaranteed Heart). */
export function vaultTier(x: number, z: number): VaultTier {
  const r = Math.max(Math.abs(x), Math.abs(z));
  if (r <= CORE_HALF) return 1;
  return r <= 1700 ? 2 : 3;
}

/** Raw density hash: does chunk (cx, cz) WANT a vault (before suppression +
 *  terrain suitability)? */
function anchorHash(seed: number, cx: number, cz: number): number {
  return hash2(seed ^ 0xda17, cx, cz);
}
function wantsAnchor(seed: number, cx: number, cz: number): boolean {
  const wx = cx * 16 + 8, wz = cz * 16 + 8;
  const density = inCore(wx, wz) ? DENSITY_CORE : DENSITY_WILDS;
  return anchorHash(seed, cx, cz) <= density;
}

/** The deterministic candidate anchor point inside chunk (cx, cz) — exactly
 *  the first two rng draws of the stamp builder (kept in lockstep with it). */
function anchorPoint(seed: number, cx: number, cz: number): { ax: number; az: number } {
  const rng = mulberry32(
    (seed ^ Math.imul(cx, 0x85ebca77) ^ Math.imul(cz, 0xc2b2ae3d) ^ 0xda17) >>> 0);
  return {
    ax: cx * 16 + 4 + Math.floor(rng() * 8),
    az: cz * 16 + 4 + Math.floor(rng() * 8),
  };
}

/** Cheap anchor-site viability (the checks that need no full stamp): density
 *  hash + ground band + no ravine + a dry biome. Suppression competes ONLY
 *  among viable anchors — a doomed beach candidate never shadows a good site
 *  (without this, dense coasts starved whole regions of vaults). */
function anchorViable(seed: number, cx: number, cz: number, ctx: StructureCtx): boolean {
  if (!wantsAnchor(seed, cx, cz)) return false;
  const { ax, az } = anchorPoint(seed, cx, cz);
  const g = ctx.height(ax, az);
  if (g < MIN_GROUND || g > MAX_GROUND) return false;
  if (ctx.ravineDepth(ax, az) > 0) return false;
  const biome = ctx.biomeWithWater(ax, az, g);
  return biome !== Biome.Ocean && biome !== Biome.Beach;
}

/** Does a vault anchor in chunk (cx, cz)? Viability + a suppression rule
 *  (only the lowest hash among VIABLE anchors within ±2·VAULT_REACH chunks
 *  survives) so two vault footprints can never interleave. */
export function vaultAnchorAt(seed: number, cx: number, cz: number, ctx: StructureCtx): boolean {
  if (!anchorViable(seed, cx, cz, ctx)) return false;
  const mine = anchorHash(seed, cx, cz);
  for (let dx = -2 * VAULT_REACH; dx <= 2 * VAULT_REACH; dx++) {
    for (let dz = -2 * VAULT_REACH; dz <= 2 * VAULT_REACH; dz++) {
      if (dx === 0 && dz === 0) continue;
      if (!anchorViable(seed, cx + dx, cz + dz, ctx)) continue;
      const h = anchorHash(seed, cx + dx, cz + dz);
      if (h < mine || (h === mine && (dx < 0 || (dx === 0 && dz < 0)))) return false;
    }
  }
  return true;
}

// Room lattice in vault-local (u forward, v sideways) coordinates. The hall
// sits at (0,0) with the entrance staircase running back along −u; the boss
// lair anchors the far end; every other slot can host a themed wing. All
// offsets stay ≤ ±43 (+ hw ≤ 8) — inside VAULT_REACH = 3 chunks.
const LAT_U = [0, 15, 30, 43];
const LAT_V = [-30, -15, 0, 15, 30];
const BOSS_HW = 9;
const BOSS_IH = 7;
/** Guard-spawner population cap per room kind (0 = no spawner). */
const ROOM_CAP: Record<VaultRoom['kind'], number> = {
  hall: 0, room: 3, great: 5, pit: 3, crypt: 2, boss: 0,
  flooded: 3, lava: 3, garden: 3, treasury: 4, // the hoard is well guarded
};

/** The full deterministic vault stamp anchored in (cx, cz), or null. */
export function vaultStamp(
  seed: number, cx: number, cz: number, ctx: StructureCtx
): VaultStamp | null {
  if (!vaultAnchorAt(seed, cx, cz, ctx)) return null;
  const rng = mulberry32(
    (seed ^ Math.imul(cx, 0x85ebca77) ^ Math.imul(cz, 0xc2b2ae3d) ^ 0xda17) >>> 0);
  // Anchor ≥4 blocks inside the chunk so every offset ≤ ±43±hw fits in ±3
  // chunks. (These two draws mirror anchorPoint — keep them in lockstep.)
  const ax = cx * 16 + 4 + Math.floor(rng() * 8);
  const az = cz * 16 + 4 + Math.floor(rng() * 8);
  const g = ctx.height(ax, az);
  const tier = vaultTier(ax, az);
  // --- BURIAL GUARANTEE: a vault must NEVER poke out of the ground anywhere.
  // The complex sprawls ±51 blocks from the anchor, so sample the whole
  // footprint (an 8-block grid) for the LOWEST effective surface — valleys,
  // ocean dips and RAVINE floors all count. The interior is then sunk below
  // that minimum, and sites the terrain can't hide are rejected outright.
  // The layout direction rolls later, so a room can reach ±51 blocks along
  // EITHER axis — sample the full ±54 square around the anchor.
  let minSurf = g;
  // Heights are smooth — a 4-block grid can't miss a valley.
  for (let du = -54; du <= 54; du += 4) {
    for (let dv = -54; dv <= 54; dv += 4) {
      const px = ax + du, pz = az + dv;
      const h = ctx.height(px, pz);
      if (h < minSurf) minSurf = h;
    }
  }
  // Ravines can be a SINGLE column wide — scan every column. Cheap in
  // practice: ravineDepth mask-gates to one noise call outside the rare
  // "ravine country" regions, and stamps are cached per anchor chunk.
  for (let du = -52; du <= 52; du++) {
    for (let dv = -52; dv <= 52; dv++) {
      const rd = ctx.ravineDepth(ax + du, az + dv);
      if (rd <= 0) continue;
      const eff = Math.max(10, ctx.height(ax + du, az + dv) - rd);
      if (eff < minSurf) minSurf = eff;
    }
  }
  if (g - minSurf > 26) return null;  // extreme relief — the stairs can't climb out
  if (minSurf < 32) return null;      // can't sink deep enough (ravine/abyss floor)
  // Interior floor: ≥14 below the LOWEST surface in the footprint (ocean
  // floors and ravine floors count), so the highest roof block
  // (fy + BOSS_IH + 1) keeps ≥3 blocks of solid cover EVERYWHERE — a vault
  // can sprawl under a seabed, but never breaks any surface.
  const fy = Math.max(20, minSurf - 14);

  // Layout direction: rotate (u, v) onto world axes.
  const dirs: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  const [ux, uz] = dirs[Math.floor(rng() * 4)];
  const vx = -uz, vz = ux;
  const wx = (u: number, v: number) => ax + u * ux + v * vx;
  const wz = (u: number, v: number) => az + u * uz + v * vz;

  // The ENTRANCE LINE (the staircase runs back along −u) must stay dry: a
  // mouth can't climb out through open ocean, so reject sites whose stair
  // corridor crosses ocean columns. (Wings under a seabed are fine — they
  // stay sealed below it — only the walk-in line needs land.)
  for (let i = 0; i <= 44; i += 4) {
    const px = wx(-4 - i, 0), pz = wz(-4 - i, 0);
    const h = ctx.height(px, pz);
    if (ctx.biomeWithWater(px, pz, h) === Biome.Ocean) return null;
  }

  // Keep consuming the two legacy visual/boss draws so every later layout draw
  // remains byte-for-byte aligned with old worlds. The new family/boss comes
  // from a separate coordinate hash and therefore cannot move any room.
  rng();
  rng();
  const bossKind = vaultBossFor(seed, cx, cz, tier);
  const family = VAULT_BOSS_FAMILY[bossKind];
  const familyLight: Record<VaultFamily, Block> = {
    crypt: Block.SoulLantern,
    mire: Block.GlowFungus,
    ember: Block.EmberBrazier,
    crystal: Block.PrismLamp,
    gilded: Block.GildedLamp,
  };
  // Bright architectural grammar: every family now owns its structural shell,
  // flooring, trim and window language instead of hiding its color behind the
  // old near-black VaultBrick shell. Layout coordinates remain unchanged.
  const familyShell: Record<VaultFamily, Block> = {
    crypt: Block.SpectralMarble,
    mire: Block.PearlTile,
    ember: Block.FurnaceCeramic,
    crystal: Block.OpalBrick,
    gilded: Block.LuminousLimestone,
  };
  const familyFloor: Record<VaultFamily, Block> = {
    crypt: Block.VaultMosaic,
    mire: Block.JadeMosaic,
    ember: Block.PearlTile,
    crystal: Block.PearlTile,
    gilded: Block.VaultMosaic,
  };
  const familyTrim: Record<VaultFamily, Block> = {
    crypt: Block.CarvedVaultBrick,
    mire: Block.JadeMosaic,
    ember: Block.EmberBrick,
    crystal: Block.PrismBrick,
    gilded: Block.GildedVaultBrick,
  };
  const shellBlock = familyShell[family];
  const floorBlock = familyFloor[family];
  const trimBlock = familyTrim[family];
  const lightBlock = familyLight[family];

  // --- Pick the wings: hall + boss are fixed; the rest is a seeded spread of
  // themed rooms across the lattice, denser at higher tiers (8–15 total).
  interface RoomBox {
    u: number; v: number; hw: number; ih: number;
    kind: VaultRoom['kind'];
    /** Interior floor level (pits sink below fy). */
    floorY: number;
  }
  const hall: RoomBox = { u: 0, v: 0, hw: 4, ih: 4, kind: 'hall', floorY: fy };
  const bossV = LAT_V[1 + Math.floor(rng() * 3)]; // -15 / 0 / 15
  const boss: RoomBox = { u: 43, v: bossV, hw: BOSS_HW, ih: BOSS_IH, kind: 'boss', floorY: fy };
  const openSlots: { u: number; v: number }[] = [];
  for (const u of LAT_U) {
    for (const v of LAT_V) {
      if (u === 0 && v === 0) continue;               // the hall
      if (u === 43 && v === bossV) continue;          // the boss lair
      if (u === 43 && Math.abs(v - bossV) <= 15) continue; // breathing room
      openSlots.push({ u, v });
    }
  }
  for (let i = openSlots.length - 1; i > 0; i--) { // seeded shuffle
    const j = Math.floor(rng() * (i + 1));
    [openSlots[i], openSlots[j]] = [openSlots[j], openSlots[i]];
  }
  const wingCount = Math.min(openSlots.length,
    tier === 1 ? 6 + Math.floor(rng() * 3)      // 6–8 wings (8–10 rooms)
    : tier === 2 ? 8 + Math.floor(rng() * 3)    // 8–10
    : 10 + Math.floor(rng() * 4));              // 10–13
  const boxes: RoomBox[] = [hall];
  for (const slot of openSlots.slice(0, wingCount)) {
    const roll = rng();
    if (roll < 0.16) {          // great pillared hall
      boxes.push({ ...slot, hw: 6 + Math.floor(rng() * 2), ih: 6 + Math.floor(rng() * 2),
        kind: 'great', floorY: fy });
    } else if (roll < 0.28) {   // sunken spike pit
      boxes.push({ ...slot, hw: 4 + Math.floor(rng() * 2), ih: 4, kind: 'pit', floorY: fy - 4 });
    } else if (roll < 0.42) {   // cramped crypt
      boxes.push({ ...slot, hw: 3, ih: 3, kind: 'crypt', floorY: fy });
    } else if (roll < 0.54) {   // waterlogged bog wing
      boxes.push({ ...slot, hw: 4 + Math.floor(rng() * 2), ih: 4, kind: 'flooded', floorY: fy });
    } else if (roll < 0.64) {   // glowing crystal grove
      boxes.push({ ...slot, hw: 4 + Math.floor(rng() * 2), ih: 5, kind: 'garden', floorY: fy });
    } else if (roll < 0.72 && tier >= 2) { // molten trench (tier II+ only)
      boxes.push({ ...slot, hw: 5, ih: 4, kind: 'lava', floorY: fy });
    } else if (roll < 0.79) {   // the gold hoard — mineable jackpot, elite guards
      boxes.push({ ...slot, hw: 4, ih: 4, kind: 'treasury', floorY: fy });
    } else {                    // standard chamber
      boxes.push({ ...slot, hw: 4 + Math.floor(rng() * 2), ih: 4 + Math.floor(rng() * 2),
        kind: 'room', floorY: fy });
    }
  }
  // Family weighting is a separate decoration decision. It changes flavour,
  // never slot choice/centre/size and never consumes the layout stream.
  const favored: Record<VaultFamily, readonly VaultRoom['kind'][]> = {
    crypt: ['crypt', 'great', 'crypt'],
    mire: ['flooded', 'garden', 'flooded'],
    ember: ['lava', 'great', 'lava'],
    crystal: ['garden', 'great', 'garden'],
    gilded: ['treasury', 'great', 'treasury'],
  };
  for (let i = 1; i < boxes.length; i++) {
    if (boxes[i].kind === 'pit') continue; // sunk geometry needs its stair variant
    const roll = hash2(seed ^ 0xfa617e, cx * 37 + i, cz * 41 - i);
    if (roll >= 0.48) continue;
    const picks = favored[family];
    boxes[i].kind = picks[Math.min(picks.length - 1, Math.floor(roll / 0.16))];
  }
  boxes.push(boss);

  // Local block map: later marks win, so carve order is explicit and safe.
  const cells = new Map<string, number>();
  const mark = (x: number, y: number, z: number, id: number): void => {
    cells.set(`${x},${y},${z}`, id);
  };

  // 1) Room shells (walls/floor/ceiling of VaultBrick; pits dig deeper).
  for (const b of boxes) {
    for (let du = -b.hw; du <= b.hw; du++) {
      for (let dv = -b.hw; dv <= b.hw; dv++) {
        for (let y = b.floorY; y <= fy + b.ih + 1; y++) {
          mark(wx(b.u + du, b.v + dv), y, wz(b.u + du, b.v + dv), shellBlock);
        }
      }
    }
  }

  // 2) Corridor network: connect each wing to the NEAREST earlier room with an
  //    L-shaped tunnel (u-leg then v-leg), 2 wide × 3 high with a brick sleeve.
  type Leg = { fixed: number; from: number; to: number; alongU: boolean };
  const legs: Leg[] = [];
  for (let i = 1; i < boxes.length; i++) {
    let best = 0, bestD = Infinity;
    for (let j = 0; j < i; j++) {
      const d = Math.abs(boxes[i].u - boxes[j].u) + Math.abs(boxes[i].v - boxes[j].v);
      if (d < bestD) { bestD = d; best = j; }
    }
    const a = boxes[i], b = boxes[best];
    legs.push({ fixed: a.v, from: a.u, to: b.u, alongU: true });  // u-leg at a.v
    legs.push({ fixed: b.u, from: a.v, to: b.v, alongU: false }); // v-leg at b.u
  }
  const corridorShell = (leg: Leg): void => {
    const lo = Math.min(leg.from, leg.to), hi = Math.max(leg.from, leg.to);
    for (let t = lo; t <= hi; t++) {
      for (let s = -2; s <= 1; s++) {
        for (let y = fy; y <= fy + 4; y++) {
          const u = leg.alongU ? t : leg.fixed + s;
          const v = leg.alongU ? leg.fixed + s : t;
          const key = `${wx(u, v)},${y},${wz(u, v)}`;
          if (cells.get(key) !== Block.Air) mark(wx(u, v), y, wz(u, v), shellBlock);
        }
      }
    }
  };
  for (const leg of legs) corridorShell(leg);

  // 3) Carve room interiors (air overwrites shell; pillars re-fill after).
  for (const b of boxes) {
    for (let du = -(b.hw - 1); du <= b.hw - 1; du++) {
      for (let dv = -(b.hw - 1); dv <= b.hw - 1; dv++) {
        for (let y = b.floorY + 1; y <= fy + b.ih; y++) {
          mark(wx(b.u + du, b.v + dv), y, wz(b.u + du, b.v + dv), Block.Air);
        }
      }
    }
  }
  // 4) Carve corridor tunnels through walls + sleeves, with occasional spike
  //    traps in the walk lane at higher tiers (dodgeable — one lane of two).
  const spikeChance = tier === 1 ? 0 : tier === 2 ? 0.05 : 0.09;
  for (const leg of legs) {
    const lo = Math.min(leg.from, leg.to), hi = Math.max(leg.from, leg.to);
    for (let t = lo; t <= hi; t++) {
      for (const s of [-1, 0]) {
        for (let y = fy + 1; y <= fy + 3; y++) {
          const u = leg.alongU ? t : leg.fixed + s;
          const v = leg.alongU ? leg.fixed + s : t;
          mark(wx(u, v), y, wz(u, v), Block.Air);
        }
      }
      if (rng() < spikeChance) {
        const s = rng() < 0.5 ? -1 : 0; // one lane only — always a way past
        const u = leg.alongU ? t : leg.fixed + s;
        const v = leg.alongU ? leg.fixed + s : t;
        mark(wx(u, v), fy + 1, wz(u, v), Block.SpikeTrap);
      }
      // A continuous luminous ceiling rhythm makes every connector readable
      // and prevents the sprawling layout from collapsing into dark tunnels.
      if ((t - lo) % 7 === 3) {
        const u = leg.alongU ? t : leg.fixed;
        const v = leg.alongU ? leg.fixed : t;
        mark(wx(u, v), fy + 4, wz(u, v), lightBlock);
        const u2 = leg.alongU ? t : leg.fixed - 1;
        const v2 = leg.alongU ? leg.fixed - 1 : t;
        mark(wx(u2, v2), fy + 4, wz(u2, v2), Block.RuneGlass);
      }
    }
  }

  // 5) Room furnishing: theme lights in the corners, MOB SPAWNERS at the heart
  //    of guarded rooms, pillars in great halls, spikes lining pit floors (with
  //    a corner stair back out), the boss dais + chest.
  for (let boxIndex = 0; boxIndex < boxes.length; boxIndex++) {
    const b = boxes[boxIndex];
    const floor = b.floorY + 1;
    const variant = Math.floor(hash2(seed ^ 0x726f6f6d, cx * 31 + boxIndex,
      cz * 31 + boxIndex) * 3);
    // Three floor-language variants shared by every room kind: border, cross,
    // or checker. They are furnishing-only and cannot obstruct traversal.
    if (b.kind !== 'boss' && b.kind !== 'pit' && b.kind !== 'flooded' && b.kind !== 'lava') {
      for (let du = -(b.hw - 1); du <= b.hw - 1; du++) {
        for (let dv = -(b.hw - 1); dv <= b.hw - 1; dv++) {
          const border = Math.abs(du) === b.hw - 1 || Math.abs(dv) === b.hw - 1;
          const cross = du === 0 || dv === 0;
          const checker = ((du + dv) & 3) === 0;
          if ((variant === 0 && border) || (variant === 1 && cross) ||
              (variant === 2 && checker)) {
            mark(wx(b.u + du, b.v + dv), b.floorY, wz(b.u + du, b.v + dv),
              variant === 1 ? trimBlock : floorBlock);
          }
        }
      }
    }
    // Corner lights (all four corners in big rooms, two in small ones). A
    // gilded vault raises each light on a glowing gold plinth.
    const corners: [number, number][] = b.hw >= 5
      ? [[-1, -1], [-1, 1], [1, -1], [1, 1]] : [[-1, -1], [1, 1]];
    if (b.kind !== 'boss') {
      for (const [su, sv] of corners) {
        const lx = wx(b.u + su * (b.hw - 1), b.v + sv * (b.hw - 1));
        const lz = wz(b.u + su * (b.hw - 1), b.v + sv * (b.hw - 1));
        if (family === 'gilded') {
          mark(lx, floor, lz, Block.GoldBlock);
          mark(lx, floor + 1, lz, lightBlock);
        } else mark(lx, floor, lz, lightBlock);
      }
    }
    // Mid-wall rune windows and ceiling coffers give even standard chambers a
    // composed silhouette. They replace shell cells only and never block lanes.
    if (b.hw >= 4 && b.kind !== 'boss') {
      for (const [du, dv] of [[b.hw, 0], [-b.hw, 0], [0, b.hw], [0, -b.hw]] as [number, number][]) {
        mark(wx(b.u + du, b.v + dv), floor + 2, wz(b.u + du, b.v + dv), Block.RuneGlass);
        if (b.ih >= 5) mark(wx(b.u + du, b.v + dv), floor + 3,
          wz(b.u + du, b.v + dv), Block.RuneGlass);
      }
      for (let du = -(b.hw - 2); du <= b.hw - 2; du += 3) {
        mark(wx(b.u + du, b.v), fy + b.ih + 1, wz(b.u + du, b.v), Block.VaultMosaic);
      }
    }
    if (b.kind === 'great') {
      // Pillars: four brick columns floor→ceiling.
      for (const [su, sv] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) {
        const inset = b.hw - 3;
        const pu = b.u + su * inset, pv = b.v + sv * inset;
        for (let y = floor; y <= fy + b.ih; y++) {
          const capital = y === floor || y === fy + b.ih;
          mark(wx(pu, pv), y, wz(pu, pv), capital ? trimBlock : Block.IvoryColumn);
        }
      }
    }
    if (b.kind === 'great') {
      // Checkered basalt inlay across the floor — the hall reads as a ballroom.
      for (let du = -(b.hw - 1); du <= b.hw - 1; du++) {
        for (let dv = -(b.hw - 1); dv <= b.hw - 1; dv++) {
          if (((du + dv) & 1) === 0) {
            mark(wx(b.u + du, b.v + dv), b.floorY, wz(b.u + du, b.v + dv),
              ((du - dv) & 2) === 0 ? floorBlock : trimBlock);
          }
        }
      }
    }
    if (b.kind === 'flooded') {
      // A shin-deep bog: mud bed + a sheet of water everywhere but the
      // spawner's 3×3 plinth. Spitters love it here.
      for (let du = -(b.hw - 1); du <= b.hw - 1; du++) {
        for (let dv = -(b.hw - 1); dv <= b.hw - 1; dv++) {
          if (Math.abs(du) <= 1 && Math.abs(dv) <= 1) continue;
          mark(wx(b.u + du, b.v + dv), b.floorY, wz(b.u + du, b.v + dv), Block.Mud);
          mark(wx(b.u + du, b.v + dv), floor, wz(b.u + du, b.v + dv), Block.Water);
        }
      }
    }
    if (b.kind === 'lava') {
      // Molten floor with a safe walkway CROSS through the middle — cross the
      // glow or burn. Basalt bed under the lava sells the volcanic look.
      for (let du = -(b.hw - 1); du <= b.hw - 1; du++) {
        for (let dv = -(b.hw - 1); dv <= b.hw - 1; dv++) {
          if (Math.abs(du) <= 1 || Math.abs(dv) <= 1) continue; // the walkway
          mark(wx(b.u + du, b.v + dv), b.floorY, wz(b.u + du, b.v + dv), Block.Basalt);
          mark(wx(b.u + du, b.v + dv), floor, wz(b.u + du, b.v + dv), Block.Lava);
        }
      }
    }
    if (b.kind === 'garden') {
      // A crystal grove: mud beds sprouting tall grass around glowing crystal
      // clusters — the one vault room that feels ALIVE.
      for (const [su, sv] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        const pu = b.u + su * (b.hw - 2), pv = b.v + sv * (b.hw - 2);
        mark(wx(pu, pv), floor, wz(pu, pv), Block.CrystalBlock);
        if (rng() < 0.5) mark(wx(pu, pv), floor + 1, wz(pu, pv), Block.CrystalBlock);
      }
      for (let du = -(b.hw - 1); du <= b.hw - 1; du++) {
        for (let dv = -(b.hw - 1); dv <= b.hw - 1; dv++) {
          if (Math.abs(du) <= 1 && Math.abs(dv) <= 1) continue;
          const r = rng();
          if (r < 0.3) {
            mark(wx(b.u + du, b.v + dv), b.floorY, wz(b.u + du, b.v + dv), Block.Mud);
            if (r < 0.18) mark(wx(b.u + du, b.v + dv), floor, wz(b.u + du, b.v + dv), Block.TallGrass);
          }
        }
      }
    }
    if (b.kind === 'treasury') {
      // The hoard: glowing gold-block piles in all four corners (MINEABLE —
      // this room IS loot), guarded by a beefed-up elite spawner.
      for (const [su, sv] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) {
        const pu = b.u + su * (b.hw - 2), pv = b.v + sv * (b.hw - 2);
        mark(wx(pu, pv), floor, wz(pu, pv), Block.GoldBlock);
        if (rng() < 0.7) mark(wx(pu, pv), floor + 1, wz(pu, pv), Block.GoldBlock);
        if (rng() < 0.5) {
          mark(wx(pu + su, pv), floor, wz(pu + su, pv), Block.GoldBlock);
        }
      }
    }
    if (b.kind === 'crypt') {
      // Cobbled burial floor strips — old stone under old bones.
      for (let du = -(b.hw - 1); du <= b.hw - 1; du++) {
        for (let dv = -(b.hw - 1); dv <= b.hw - 1; dv++) {
          if ((dv & 1) === 0) {
            mark(wx(b.u + du, b.v + dv), b.floorY, wz(b.u + du, b.v + dv), Block.Cobblestone);
          }
        }
      }
    }
    if (b.kind === 'pit') {
      // Spikes across the pit floor except the centre (the spawner's plinth)
      // — and a corner staircase of bricks so you can climb back out.
      for (let du = -(b.hw - 1); du <= b.hw - 1; du++) {
        for (let dv = -(b.hw - 1); dv <= b.hw - 1; dv++) {
          if (Math.abs(du) <= 1 && Math.abs(dv) <= 1) continue;
          mark(wx(b.u + du, b.v + dv), floor, wz(b.u + du, b.v + dv), Block.SpikeTrap);
        }
      }
      for (let k = 0; k < 4; k++) { // 1-wide corner steps up to the doorway
        const su = b.hw - 1 - k;
        for (let y = b.floorY + 1; y <= b.floorY + k; y++) {
          mark(wx(b.u + su, b.v + (b.hw - 1)), y, wz(b.u + su, b.v + (b.hw - 1)), shellBlock);
        }
      }
    }
    if (ROOM_CAP[b.kind] > 0) {
      mark(wx(b.u, b.v), floor, wz(b.u, b.v), Block.MobSpawner);
    }
  }

  // The lair is the one room whose architecture follows the BOSS family rather
  // than the generic room grammar. All raised fixtures stay off the four
  // encounter sockets, the doorway, the chest approach and the four safe lanes.
  const arenaMark = (du: number, y: number, dv: number, id: Block): void => {
    mark(wx(boss.u + du, boss.v + dv), y, wz(boss.u + du, boss.v + dv), id);
  };
  const arenaReserved = (du: number, dv: number): boolean =>
    (Math.abs(du) === 6 && Math.abs(dv) === 6) ||
    (du === 0 && (dv === -4 || dv === 0 || dv === 4)) ||
    (du === -4 && dv === 0) ||
    (du >= 1 && du <= 6 && Math.abs(dv) <= 2) ||
    (du <= -7 && Math.abs(dv) <= 1);

  if (family === 'crypt') {
    // Processional crypt: three uninterrupted floor lanes teach the same read
    // used by the Warden's marching attacks. All columns hug the outer wall.
    for (let du = -7; du <= 7; du++) {
      for (let dv = -7; dv <= 7; dv++) {
        const lane = Math.abs(dv) <= 1 || Math.abs(dv - 4) <= 1 || Math.abs(dv + 4) <= 1;
        if (lane) {
          arenaMark(du, fy, dv, Math.abs(dv) <= 1
            ? Block.SpectralMarble : Block.VaultMosaic);
        }
      }
    }
    for (const du of [-6, 6]) {
      for (const dv of [-7, 7]) {
        for (let y = fy + 1; y <= fy + 5; y++) {
          arenaMark(du, y, dv, y === fy + 1 || y === fy + 5
            ? Block.CarvedVaultBrick : Block.IvoryColumn);
        }
      }
      for (let dv = -6; dv <= 6; dv++) arenaMark(du, fy + 6, dv, Block.CarvedVaultBrick);
    }
    for (const [du, dv] of [[-5, -7], [-5, 7], [0, -7], [0, 7]] as [number, number][]) {
      if (!arenaReserved(du, dv)) arenaMark(du, fy + 1, dv, Block.Cobblestone);
    }
    arenaMark(-5, fy + 4, -7, Block.SoulLantern);
    arenaMark(-5, fy + 4, 7, Block.SoulLantern);
  } else if (family === 'mire') {
    // Tidal court: two dry loops cross through the centre while water remains
    // in recessed edge basins. Every socket and chest route stays dry.
    for (let du = -7; du <= 7; du++) {
      for (let dv = -7; dv <= 7; dv++) {
        const leftLoop = Math.abs(Math.hypot(du + 3, dv) - 3) < 0.8;
        const rightLoop = Math.abs(Math.hypot(du - 3, dv) - 3) < 0.8;
        if (leftLoop || rightLoop || Math.abs(dv) <= 1) {
          arenaMark(du, fy, dv, Block.JadeMosaic);
        }
        const basin = Math.abs(du) >= 5 && Math.abs(dv) >= 3;
        if (basin && !arenaReserved(du, dv)) {
          arenaMark(du, fy, dv, Block.Mud);
          arenaMark(du, fy + 1, dv, Block.Water);
        }
      }
    }
    for (const [du, dv, h] of [[-6, -3, 4], [-6, 3, 5], [1, -7, 4], [1, 7, 4]] as
      [number, number, number][]) {
      for (let y = fy + 1; y <= fy + h; y++) arenaMark(du, y, dv, Block.MossyVaultBrick);
      for (const [ou, ov] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as [number, number][]) {
        arenaMark(du + ou, fy + h, dv + ov, Block.GlowFungus);
      }
    }
  } else if (family === 'ember') {
    // Walking caldera: the center cross and diagonals are broad basalt escape
    // routes. Lava is curbed at the perimeter and never enters a dodge lane.
    for (let du = -7; du <= 7; du++) {
      for (let dv = -7; dv <= 7; dv++) {
        const spoke = du === 0 || dv === 0 || Math.abs(du) === Math.abs(dv);
        if (spoke) arenaMark(du, fy, dv,
          (du + dv) % 3 === 0 ? Block.EmberBrick : Block.Basalt);
        const gutter = Math.max(Math.abs(du), Math.abs(dv)) === 7 &&
          !(du <= -6 && Math.abs(dv) <= 1);
        if (gutter && !arenaReserved(du, dv)) {
          arenaMark(du, fy, dv, Block.Basalt);
          arenaMark(du, fy + 1, dv, Block.Lava);
        }
      }
    }
    for (const [du, dv] of [[-5, -7], [-5, 7], [3, -7], [3, 7]] as [number, number][]) {
      for (let y = fy + 1; y <= fy + 4; y++) {
        arenaMark(du, y, dv, y === fy + 2 ? Block.EmberBrick : Block.FurnaceCeramic);
      }
      arenaMark(du, fy + 5, dv, Block.EmberBrazier);
    }
    for (let du = -5; du <= 3; du++) {
      arenaMark(du, fy + 6, -7, Block.EmberBrick);
      arenaMark(du, fy + 6, 7, Block.EmberBrick);
    }
  } else if (family === 'crystal') {
    // Prism observatory: eight spokes are authoritative beam lanes. Obelisks and
    // hanging crystals remain outside the player's movement and camera volume.
    for (let du = -7; du <= 7; du++) {
      for (let dv = -7; dv <= 7; dv++) {
        const ray = du === dv || du === -dv || du === 0 || dv === 0;
        const ring = Math.round(Math.hypot(du, dv)) === 5;
        if (ray || ring) arenaMark(du, fy, dv,
          ring ? Block.PrismBrick : Block.PearlTile);
      }
    }
    for (const [du, dv, h] of [[-7, -5, 4], [-7, 5, 3], [7, -5, 3], [7, 5, 4]] as
      [number, number, number][]) {
      for (let y = fy + 1; y <= fy + h; y++) {
        arenaMark(du, y, dv, y === fy + h ? Block.PrismLamp : Block.CrystalBlock);
      }
    }
    for (const [du, dv, length] of [[-3, -3, 3], [-3, 3, 2], [3, -3, 2], [3, 3, 3]] as
      [number, number, number][]) {
      for (let k = 0; k < length; k++) arenaMark(du, fy + 6 - k, dv, Block.CrystalBlock);
    }
  } else {
    // Clockwork grid: a crisp 5x5 board makes mine cells and crusher gaps
    // readable. Machinery stays on the walls and overhead gantry.
    for (let du = -7; du <= 7; du++) {
      for (let dv = -7; dv <= 7; dv++) {
        if (Math.abs(du) <= 5 && Math.abs(dv) <= 5) {
          const cell = (Math.floor((du + 5) / 2) + Math.floor((dv + 5) / 2)) & 1;
          arenaMark(du, fy, dv, cell ? Block.ClockworkGrate : Block.GildedVaultBrick);
        } else if (Math.max(Math.abs(du), Math.abs(dv)) === 6) {
          arenaMark(du, fy, dv, Block.VaultMosaic);
        }
      }
    }
    for (const [du, dv] of [[-5, -7], [-5, 7], [1, -7], [1, 7]] as [number, number][]) {
      for (let y = fy + 1; y <= fy + 4; y++) {
        arenaMark(du, y, dv, y === fy + 2 ? Block.GildedVaultBrick : Block.ClockworkGrate);
      }
      arenaMark(du, fy + 5, dv, Block.GildedLamp);
    }
    for (let du = -5; du <= 1; du++) {
      arenaMark(du, fy + 6, -7, Block.ClockworkGrate);
      arenaMark(du, fy + 6, 7, Block.ClockworkGrate);
    }
  }

  // Reward alcove: floor trim replaces the old raised 5x5 obstacle. The chest
  // keeps its legacy coordinate on a single protected pedestal.
  // The arena grew from 15×15 to 19×19, but this legacy +4 offset is fixed:
  // old chest records, map lookups and player edits continue to line up.
  const daisU = boss.u + 4;
  for (let du = -2; du <= 2; du++) {
    for (let dv = -2; dv <= 2; dv++) {
      // Themed edge trim makes the treasure dais gleam from the doorway.
      const edge = Math.abs(du) === 2 || Math.abs(dv) === 2;
      mark(wx(daisU + du, boss.v + dv), fy, wz(daisU + du, boss.v + dv),
        edge ? trimBlock : floorBlock);
    }
  }
  const chest = { x: wx(daisU, boss.v), y: fy + 2, z: wz(daisU, boss.v) };
  mark(chest.x, fy + 1, chest.z, trimBlock);
  mark(chest.x, chest.y, chest.z, Block.VaultChest);
  mark(wx(daisU, boss.v - 1), fy + 1, wz(daisU, boss.v - 1), lightBlock);
  mark(wx(daisU, boss.v + 1), fy + 1, wz(daisU, boss.v + 1), lightBlock);
  const backdropBlock = family === 'mire' ? Block.MossyVaultBrick
    : family === 'ember' ? Block.EmberBrick
    : family === 'gilded' ? Block.ClockworkGrate : Block.RuneGlass;
  for (let dv = -3; dv <= 3; dv++) {
    for (let y = fy + 2; y <= fy + 5; y++) {
      if ((Math.abs(dv) + y) % 2 === 0) {
        mark(wx(boss.u + boss.hw, boss.v + dv), y, wz(boss.u + boss.hw, boss.v + dv),
          backdropBlock);
      }
    }
  }

  // 6) Entrance staircase: a walk-down tunnel from the hall's -u wall, rising
  //    1 block per step until it breaks the surface (deterministic: ctx.height).
  let mouth = { x: ax, y: g, z: az };
  {
    const SEA = 63; // terrain SEA_LEVEL (not imported — would be a module cycle)
    let surfaced = false;
    // Deeper burial means a longer climb: up to 40 steps (u stays ≤ 44 ≈ reach).
    for (let i = 0; i <= 40 && !surfaced; i++) {
      const u = -(hall.hw + i);
      const stepY = fy + 1 + i;
      const colH = ctx.height(wx(u, 0), wz(u, 0));
      for (const s of [-1, 0]) {
        for (let y = stepY; y <= stepY + 2; y++) {
          mark(wx(u, s), y, wz(u, s), Block.Air);
        }
      }
      // Never surface below sea level — keep climbing until the mouth is dry.
      if (stepY >= colH && stepY > SEA) {
        surfaced = true;
        mouth = { x: wx(u, 0), y: Math.max(stepY, colH), z: wz(u, 0) };
        // Ruined arch: two cobble pillars either side of the mouth + a beam +
        // a torch pair, so the entrance reads as man-made from a distance.
        for (const s of [-2, 1]) {
          const px = wx(u, s), pz = wz(u, s);
          for (let k = 0; k < 3; k++) mark(px, mouth.y + k, pz, Block.Cobblestone);
          mark(px, mouth.y + 3, pz, Block.Torch);
        }
        for (const s of [-1, 0]) mark(wx(u, s), mouth.y + 3, wz(u, s), Block.Cobblestone);
      }
    }
    // No dry surfacing point within reach — the site can't host a reachable
    // vault, so reject it outright (every vault MUST have a walk-in mouth).
    if (!surfaced) return null;
  }

  // Emit blocks + compute rooms/bounds in world space.
  const blocks: VaultStamp['blocks'] = [];
  for (const [key, id] of cells) {
    const [x, y, z] = key.split(',').map(Number);
    blocks.push({ x, y, z, id });
  }
  const rooms: VaultRoom[] = boxes.map((b, roomIndex) => ({
    x: wx(b.u, b.v), y: b.floorY + 1, z: wz(b.u, b.v), hw: b.hw,
    kind: b.kind,
    cap: ROOM_CAP[b.kind],
    variant: Math.floor(hash2(seed ^ 0x726f6f6d, cx * 31 + roomIndex,
      cz * 31 + roomIndex) * 3) as 0 | 1 | 2,
  }));
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const r of rooms) {
    minX = Math.min(minX, r.x - r.hw - 2); maxX = Math.max(maxX, r.x + r.hw + 2);
    minZ = Math.min(minZ, r.z - r.hw - 2); maxZ = Math.max(maxZ, r.z + r.hw + 2);
  }
  const bounds = { minX, minZ, maxX, maxZ, minY: fy - 6, maxY: fy + BOSS_IH + 3 };

  const bossCenter = { x: wx(boss.u, boss.v), y: fy + 1, z: wz(boss.u, boss.v) };
  const socketLocal: [number, number][] = [[-6, -6], [-6, 6], [6, -6], [6, 6]];
  const sockets = socketLocal.map(([du, dv]) =>
    ({ x: wx(boss.u + du, boss.v + dv), y: fy + 1, z: wz(boss.u + du, boss.v + dv) }));
  const cameraAnchors = [
    { x: wx(boss.u - 7, boss.v), y: fy + 4, z: wz(boss.u - 7, boss.v) },
    { x: wx(boss.u + 1, boss.v + 7), y: fy + 5, z: wz(boss.u + 1, boss.v + 7) },
  ];
  const safeLanes = [[0, -4], [0, 4], [-4, 0], [0, 0]].map(([du, dv]) =>
    ({ x: wx(boss.u + du, boss.v + dv), y: fy + 1, z: wz(boss.u + du, boss.v + dv) }));
  const sealU = boss.u - boss.hw;
  const seal = {
    center: { x: wx(sealU, boss.v), y: fy + 1, z: wz(sealU, boss.v) },
    axis: (ux !== 0 ? 'x' : 'z') as 'x' | 'z',
    halfWidth: 1.6, height: 4,
    inside: { x: wx(sealU + 2, boss.v), y: fy + 1, z: wz(sealU + 2, boss.v) },
    outside: { x: wx(sealU - 2, boss.v), y: fy + 1, z: wz(sealU - 2, boss.v) },
  };
  const arena = {
    bounds: {
      minX: bossCenter.x - BOSS_HW + 1, minY: fy + 1,
      minZ: bossCenter.z - BOSS_HW + 1, maxX: bossCenter.x + BOSS_HW - 1,
      maxY: fy + BOSS_IH, maxZ: bossCenter.z + BOSS_HW - 1,
    },
    sockets, cameraAnchors, safeLanes, seal,
  };
  return { cx, cz, tier, family, bossKind, x: ax, y: g, z: az, floorY: fy,
    rooms, chest, mouth, bounds, arena, blocks };
}

/** The vault whose underground bounds contain (x, y, z), scanning the ±2-chunk
 *  neighbourhood (a stamp never reaches further). `stampOf` lets callers plug
 *  in a cache; defaults to computing fresh. */
export function vaultAt(
  seed: number, x: number, y: number, z: number, ctx: StructureCtx,
  stampOf: (cx: number, cz: number) => VaultStamp | null =
    (cx, cz) => vaultStamp(seed, cx, cz, ctx),
): VaultStamp | null {
  const cx = Math.floor(x / 16), cz = Math.floor(z / 16);
  for (let dx = -VAULT_REACH; dx <= VAULT_REACH; dx++) {
    for (let dz = -VAULT_REACH; dz <= VAULT_REACH; dz++) {
      const st = stampOf(cx + dx, cz + dz);
      if (!st) continue;
      const b = st.bounds;
      if (x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ &&
          y >= b.minY && y <= b.maxY) return st;
    }
  }
  return null;
}

/** The vault whose VaultChest sits exactly at (x, y, z), or null. */
export function vaultChestAt(
  seed: number, x: number, y: number, z: number, ctx: StructureCtx,
  stampOf: (cx: number, cz: number) => VaultStamp | null =
    (cx, cz) => vaultStamp(seed, cx, cz, ctx),
): VaultStamp | null {
  const cx = Math.floor(x / 16), cz = Math.floor(z / 16);
  for (let dx = -VAULT_REACH; dx <= VAULT_REACH; dx++) {
    for (let dz = -VAULT_REACH; dz <= VAULT_REACH; dz++) {
      const st = stampOf(cx + dx, cz + dz);
      if (st && st.chest.x === x && st.chest.y === y && st.chest.z === z) return st;
    }
  }
  return null;
}

// --- Per-player loot ---------------------------------------------------------

/** Tiered vault loot pools. Tier III also GUARANTEES a Heart on every roll. */
export const VAULT_LOOT: Record<VaultTier, LootEntry[]> = {
  // Tier I (Heartland): a GREAT start — guns, travel toys and supplies roll
  // often (never way-OP: no diamond/titanium/sniper here). Every Tier I haul
  // also guarantees bandages + a fat stack of bullets (see vaultLoot).
  1: [
    { id: Item.Bullet, min: 16, max: 32, w: 3 },
    { id: Item.IronIngot, min: 4, max: 8, w: 3 },
    { id: Item.Coal, min: 6, max: 12, w: 2 },
    { id: Block.Torch, min: 8, max: 14, w: 2 },
    { id: Item.Grenade, min: 2, max: 4, w: 1.5 },
    { id: Item.JumpBoost, min: 1, max: 2, w: 1.5 },
    { id: Item.GoldIngot, min: 2, max: 5, w: 2 },
    { id: Item.Pistol, min: 1, max: 1, w: 1.5 },
    { id: Item.Shotgun, min: 1, max: 1, w: 0.8 },
    { id: Item.SMG, min: 1, max: 1, w: 0.5 },
    { id: Item.Glider, min: 1, max: 1, w: 1.2 },
    { id: Item.Boat, min: 1, max: 1, w: 0.7 },
    { id: Item.Bandage, min: 2, max: 4, w: 1.5 },
    { id: Item.Medkit, min: 1, max: 1, w: 0.9 },
    { id: Item.RuneOfIron, min: 1, max: 1, w: 0.5 },
    // The Tier-I jackpot. Weighted so a boss fight beats a FREE Crashed Cargo
    // Pod (~12%/open) rather than losing to it, which is what 0.35 did.
    { id: Item.Heart, min: 1, max: 1, w: 0.9 },
  ],
  // Tier II (mid Wilds): serious kit + a guaranteed Medkit/titanium base.
  2: [
    { id: Item.TitaniumIngot, min: 2, max: 5, w: 2.5 },
    { id: Item.Bullet, min: 20, max: 40, w: 3 },
    { id: Item.Diamond, min: 1, max: 3, w: 2 },
    { id: Item.CrystalShard, min: 2, max: 5, w: 2 },
    { id: Item.SMG, min: 1, max: 1, w: 1.2 },
    { id: Item.Shotgun, min: 1, max: 1, w: 1 },
    { id: Item.Rifle, min: 1, max: 1, w: 1 },
    { id: Item.Grenade, min: 2, max: 4, w: 1.5 },
    { id: Item.GoldIngot, min: 3, max: 6, w: 1.5 },
    { id: Item.OilBarrel, min: 3, max: 6, w: 1.5 },
    { id: Item.Medkit, min: 1, max: 2, w: 1.2 },
    { id: Item.GrapplingHook, min: 1, max: 1, w: 0.8 },
    { id: Item.Heart, min: 1, max: 1, w: 1.3 },
    { id: Item.RuneOfSwiftness, min: 1, max: 1, w: 0.7 },
    { id: Item.RuneOfFortune, min: 1, max: 1, w: 0.6 },
  ],
  // Tier III (deep Wilds): the jackpot pool (+ a guaranteed Heart AND a
  // guaranteed rune on top — see vaultLoot).
  3: [
    { id: Item.TitaniumIngot, min: 4, max: 8, w: 3 },
    { id: Item.Diamond, min: 3, max: 6, w: 2.5 },
    { id: Item.Sniper, min: 1, max: 1, w: 1.1 },
    { id: Item.BurstRifle, min: 1, max: 1, w: 1.1 },
    { id: Item.RocketLauncher, min: 1, max: 1, w: 0.5 },
    { id: Item.Rocket, min: 2, max: 4, w: 1 },
    { id: Item.Bullet, min: 30, max: 60, w: 2 },
    { id: Item.CrystalShard, min: 4, max: 8, w: 2 },
    { id: Item.Cannonball, min: 6, max: 12, w: 1.5 },
    { id: Item.GoldIngot, min: 4, max: 8, w: 2 },
    { id: Item.OilBarrel, min: 4, max: 8, w: 1.5 },
    { id: Item.Medkit, min: 1, max: 2, w: 1.5 },
    { id: Item.Heart, min: 1, max: 1, w: 1.8 }, // extra hearts CAN roll too
    { id: Item.RuneOfFocus, min: 1, max: 1, w: 0.9 },
    { id: Item.RuneOfSwiftness, min: 1, max: 1, w: 0.7 },
    { id: Item.RuneOfIron, min: 1, max: 1, w: 0.7 },
  ],
};

/** Weighted picks per haul, on top of the guarantees in `vaultLoot`. Scaled to
 *  the MEASURED cost of the fight: a Tier I Brute dies in ~30s, a Tier III boss
 *  takes 74s (rifle) to 292s (sniper) against a 360s enrage, plus the ammo,
 *  consumables and death risk spent getting there. */
const VAULT_ROLLS: Record<VaultTier, number> = { 1: 8, 2: 10, 3: 12 };
/** The four socketable runes (Tier III guarantees one per haul). */
const RUNE_POOL = [
  Item.RuneOfIron, Item.RuneOfSwiftness, Item.RuneOfFortune, Item.RuneOfFocus,
];
const BOSS_RELIC: Record<VaultBossKind, Item> = {
  bone_warden: Item.WardenSigil,
  mire_queen: Item.MireBloom,
  ember_colossus: Item.EmberCore,
  crystal_seer: Item.SeerPrism,
  gilded_artificer: Item.ArtificerGear,
};

/** FNV-1a over a string (per-player loot personalisation). */
function strHash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** The per-player vault loot HAUL: a pure function of (seed, vault, username,
 *  roll index), so it is identical wherever it's computed — and every 30-minute
 *  re-loot (`roll` increments) is a fresh, different haul.
 *
 *  Every haul opens with the boss's RELIC (the only source — two of them craft
 *  a Greater Rune, see crafting.ts), then a tier guarantee, then VAULT_ROLLS
 *  weighted picks. The guaranteed ammo matters as much as the jackpots: a boss
 *  fight that does not at least refund the ammunition it consumed is a net
 *  loss no matter how good the rare table looks. */
export function vaultLoot(
  seed: number, cx: number, cz: number, tier: VaultTier, username: string, roll = 0
): ItemStack[] {
  let h = (seed ^ strHash(username.toLowerCase()) ^ 0x7a017) >>> 0;
  h = Math.imul(h ^ cx, 0x27d4eb2f);
  h = Math.imul(h ^ cz, 0x165667b1);
  h = Math.imul(h ^ (roll >>> 0), 0x9e3779b1); // each re-loot rolls fresh
  const rng = mulberry32(h >>> 0);
  const table = VAULT_LOOT[tier];
  const totalW = table.reduce((a, e) => a + e.w, 0);
  const out: ItemStack[] = [];
  out.push({ id: BOSS_RELIC[vaultBossFor(seed, cx, cz, tier)], count: 1 });
  if (tier === 1) {
    out.push({ id: Item.Bandage, count: 3 });
    out.push({ id: Item.Bullet, count: 32 });
  } else if (tier === 2) {
    out.push({ id: Item.Medkit, count: 2 });
    out.push({ id: Item.TitaniumIngot, count: 3 });
    out.push({ id: Item.Bullet, count: 48 });
    // Tier II now guarantees a rune too — without it a Tier II haul could come
    // out flatly worse than a free Crashed Cargo Pod, which rolls runes at a
    // combined weight of 1.6.
    out.push({ id: RUNE_POOL[Math.floor(rng() * RUNE_POOL.length)], count: 1 });
  } else {
    out.push({ id: Item.Heart, count: 1 });
    out.push({ id: Item.Diamond, count: 4 });
    out.push({ id: Item.TitaniumIngot, count: 4 });
    out.push({ id: Item.Bullet, count: 64 });
    out.push({ id: Item.Medkit, count: 2 });
    out.push({ id: RUNE_POOL[Math.floor(rng() * RUNE_POOL.length)], count: 1 });
  }
  for (let i = 0; i < VAULT_ROLLS[tier]; i++) {
    let pick = rng() * totalW;
    let entry = table[table.length - 1];
    for (const e of table) { pick -= e.w; if (pick <= 0) { entry = e; break; } }
    out.push({ id: entry.id, count: entry.min + Math.floor(rng() * (entry.max - entry.min + 1)) });
  }
  return out;
}

// --- Server-state helpers ----------------------------------------------------

const DEAD_NEVER = -1e9; // finite "never died" sentinel (JSON-safe)

export function newVaultState(tier: VaultTier): VaultServerState {
  return { tier, hp: bruteMaxHp(tier), deadAt: DEAD_NEVER, looters: {} };
}

/** Lazy Brute respawn: VAULT_RECHARGE after death, HP refills. */
export function refreshVaultState(s: VaultServerState, now: number): void {
  if (s.hp <= 0 && now - s.deadAt > VAULT_RECHARGE) {
    s.hp = bruteMaxHp(s.tier);
    s.deadAt = DEAD_NEVER;
  }
}

/** Is the chest open-able right now (Brute dead within the loot window)? */
export function vaultLootable(s: VaultServerState, now: number): boolean {
  return s.hp <= 0 && now - s.deadAt <= VAULT_LOOT_WINDOW;
}

/** Seconds until `username` may loot this vault again (0 = ready now — the
 *  per-player 30-minute regrow ledger; the boss-window gate is separate). */
export function vaultLootCooldownLeft(
  s: VaultServerState, username: string, now: number
): number {
  const rec = s.looters[username.toLowerCase()];
  if (!rec) return 0;
  return Math.max(0, VAULT_LOOT_COOLDOWN - (now - rec.at));
}

/** Record a loot claim; returns the roll index to feed vaultLoot (so every
 *  30-minute re-loot rolls a fresh haul). */
export function recordVaultLoot(
  s: VaultServerState, username: string, now: number
): number {
  const key = username.toLowerCase();
  const rec = s.looters[key];
  const n = rec ? rec.n : 0;
  s.looters[key] = { at: now, n: n + 1 };
  return n;
}

/** Fail-closed sanitizer for a persisted VaultServerState. Older saves used a
 *  once-only `openedBy: string[]` ledger — those migrate to the cooldown map
 *  (looted "long ago", so everyone is ready to loot again). */
export function sanitizeVaultState(raw: unknown): VaultServerState | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Partial<VaultServerState> & { openedBy?: unknown };
  const tier = o.tier === 1 || o.tier === 2 || o.tier === 3 ? o.tier : null;
  if (!tier) return null;
  const max = bruteMaxHp(tier);
  const hp = Number.isFinite(o.hp) ? Math.max(0, Math.min(max, Math.floor(o.hp as number))) : max;
  const deadAt = Number.isFinite(o.deadAt) ? (o.deadAt as number) : DEAD_NEVER;
  const looters: VaultServerState['looters'] = {};
  if (o.looters && typeof o.looters === 'object') {
    for (const [u, rec] of Object.entries(o.looters as Record<string, unknown>)) {
      if (typeof u !== 'string' || !rec || typeof rec !== 'object') continue;
      const r = rec as { at?: unknown; n?: unknown };
      if (!Number.isFinite(r.at) || !Number.isFinite(r.n)) continue;
      looters[u.toLowerCase()] = {
        at: r.at as number,
        n: Math.max(0, Math.floor(r.n as number)),
      };
      if (Object.keys(looters).length >= 10000) break;
    }
  } else if (Array.isArray(o.openedBy)) {
    for (const u of o.openedBy as unknown[]) {
      if (typeof u !== 'string') continue;
      looters[u.toLowerCase()] = { at: -1e9, n: 1 }; // long ago — ready again
      if (Object.keys(looters).length >= 10000) break;
    }
  }
  return { tier, hp, deadAt, looters };
}

/** Map reveal radius: a vault's entrance appears on the map/minimap once the
 *  player is within this many blocks (faint until actually entered). */
export const VAULT_REVEAL = 500;

/** Every vault in the world, as its surface ENTRANCE (mouth) position + tier —
 *  a one-time full sweep for the map. Cheap: `wantsAnchor` is a hash reject, so
 *  stamps are built only for the ~100 surviving anchors. Pure (seed-only). */
export function worldVaults(
  seed: number, ctx: StructureCtx, half = 2500
): { cx: number; cz: number; x: number; z: number; tier: VaultTier }[] {
  const out: { cx: number; cz: number; x: number; z: number; tier: VaultTier }[] = [];
  const cmax = Math.floor(half / 16);
  for (let cx = -cmax; cx <= cmax; cx++) {
    for (let cz = -cmax; cz <= cmax; cz++) {
      if (!wantsAnchor(seed, cx, cz)) continue;
      const st = vaultStamp(seed, cx, cz, ctx);
      if (st) out.push({ cx: st.cx, cz: st.cz, x: st.mouth.x, z: st.mouth.z, tier: st.tier });
    }
  }
  return out;
}

/** Total vault count for the whole world (map "found X / Y" pressure). */
export function countVaults(seed: number, ctx: StructureCtx): number {
  return worldVaults(seed, ctx).length;
}
