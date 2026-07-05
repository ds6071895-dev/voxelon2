// VAULTS (Milestone D): enterable underground dungeon complexes. PURE +
// transport-agnostic like structures.ts — placement, layout, guard rooms and
// per-player loot rolls all derive ONLY from the world seed + a terrain
// context, so the server and the offline client compute the identical dungeon.
//
// A vault is: a ruined surface entrance (stone arch + torch pair) over a
// walk-down staircase, 4–8 carved VaultBrick rooms off a corridor spine
// (entrance hall → side rooms → boss room), guard spawn anchors per room, a
// Vault Brute boss, and a per-player VaultChest in the boss room. Tier (I–III)
// grows with distance from the origin: the deep Wilds hide the best vaults.

import { Biome } from './biomes';
import { Block } from './blocks';
import { Item, ItemStack } from './items';
import type { LootEntry } from './loot';
import { inCore, CORE_HALF } from './net/protocol';
import { hash2, mulberry32 } from './noise';
import type { StructureCtx } from './structures';

export type VaultTier = 1 | 2 | 3;

/** A vault stamp never reaches past 2 chunks beyond its anchor chunk (all
 *  offsets are ≤ ±35 blocks and the anchor sits ≥4 blocks inside its chunk). */
export const VAULT_REACH = 2;
/** Seconds a cleared room's spawn anchor stays dormant (the guard respawn
 *  cooldown) — also the Brute's own respawn clock. */
export const VAULT_RECHARGE = 1800;
/** Seconds after the Brute dies during which the VaultChest can be opened. */
export const VAULT_LOOT_WINDOW = 600;

// Anchor density: ~12–20 vaults in the 1000² Heartland core, 60+ out in the
// 5000² Wilds (rarer per-chunk out there, but the Wilds are 24× the area).
// (Raw densities run ~2.5–3× the wanted counts: ocean/beach/ravine/extreme
// sites reject roughly two thirds of candidate anchors on the real terrain.)
const DENSITY_CORE = 1 / 95;
const DENSITY_WILDS = 1 / 420;
const MIN_GROUND = 65, MAX_GROUND = 140;

export interface VaultRoom {
  /** World-space centre of the room at interior floor level. */
  x: number; y: number; z: number;
  /** Interior half-width (the room spans centre ± hw, walls at ±(hw)). */
  hw: number;
  kind: 'hall' | 'room' | 'boss';
  /** Guard population cap for this room's spawn anchor (0 for the boss room). */
  cap: number;
}

export interface VaultStamp {
  cx: number; cz: number;
  tier: VaultTier;
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
  /** Account usernames that already looted this vault's chest (once each). */
  openedBy: string[];
}

/** The Vault Brute's max HP by tier — a group fight, not a one-tap. */
export function bruteMaxHp(tier: VaultTier): number {
  return 60 + 70 * tier; // 130 / 200 / 270
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

/** Does a vault anchor in chunk (cx, cz)? Density hash + a suppression rule
 *  (only the lowest hash within ±4 chunks survives) so two vault footprints
 *  can never interleave. */
export function vaultAnchorAt(seed: number, cx: number, cz: number): boolean {
  if (!wantsAnchor(seed, cx, cz)) return false;
  const mine = anchorHash(seed, cx, cz);
  for (let dx = -4; dx <= 4; dx++) {
    for (let dz = -4; dz <= 4; dz++) {
      if (dx === 0 && dz === 0) continue;
      if (!wantsAnchor(seed, cx + dx, cz + dz)) continue;
      const h = anchorHash(seed, cx + dx, cz + dz);
      if (h < mine || (h === mine && (dx < 0 || (dx === 0 && dz < 0)))) return false;
    }
  }
  return true;
}

// Room slots in vault-local (u along the spine, v perpendicular) coordinates.
// The spine: hall (0) → mid room (12) → boss room (26). Side rooms hang off
// the hall/mid at v = ±12. All offsets stay ≤ ±31 (+ hw), inside VAULT_REACH.
const SLOT_HALL = { u: 0, v: 0 };
const SLOT_MID = { u: 12, v: 0 };
const SLOT_BOSS = { u: 26, v: 0 };
const SIDE_SLOTS = [
  { u: 0, v: 12 }, { u: 0, v: -12 }, { u: 12, v: 12 }, { u: 12, v: -12 },
];
const ROOM_HW = 4;    // interior half-width of ordinary rooms
const BOSS_HW = 5;    // the boss room is bigger
const ROOM_IH = 4;    // interior height
const BOSS_IH = 6;

/** The full deterministic vault stamp anchored in (cx, cz), or null. */
export function vaultStamp(
  seed: number, cx: number, cz: number, ctx: StructureCtx
): VaultStamp | null {
  if (!vaultAnchorAt(seed, cx, cz)) return null;
  const rng = mulberry32(
    (seed ^ Math.imul(cx, 0x85ebca77) ^ Math.imul(cz, 0xc2b2ae3d) ^ 0xda17) >>> 0);
  // Anchor ≥4 blocks inside the chunk so every offset ≤ ±31±hw fits in ±2 chunks.
  const ax = cx * 16 + 4 + Math.floor(rng() * 8);
  const az = cz * 16 + 4 + Math.floor(rng() * 8);
  const g = ctx.height(ax, az);
  if (g < MIN_GROUND || g > MAX_GROUND) return null;
  if (ctx.ravineDepth(ax, az) > 0) return null;
  const biome = ctx.biomeWithWater(ax, az, g);
  if (biome === Biome.Ocean || biome === Biome.Beach) return null;
  const tier = vaultTier(ax, az);
  const fy = Math.max(20, g - 14); // interior floor level

  // Spine direction: rotate (u, v) onto world axes.
  const dirs: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  const [ux, uz] = dirs[Math.floor(rng() * 4)];
  const vx = -uz, vz = ux;
  const wx = (u: number, v: number) => ax + u * ux + v * vx;
  const wz = (u: number, v: number) => az + u * uz + v * vz;

  // Which side rooms exist: room count by tier (4 / 5–6 / 6–7 total).
  const sideCount = tier === 1 ? 1 : tier === 2 ? 2 + Math.floor(rng() * 2) : 3 + Math.floor(rng() * 2);
  const sideOrder = [...SIDE_SLOTS];
  for (let i = sideOrder.length - 1; i > 0; i--) { // seeded shuffle
    const j = Math.floor(rng() * (i + 1));
    [sideOrder[i], sideOrder[j]] = [sideOrder[j], sideOrder[i]];
  }
  const sides = sideOrder.slice(0, Math.min(4, sideCount));

  // Local block map: later marks win, so carve order is explicit and safe.
  const cells = new Map<string, number>();
  const mark = (x: number, y: number, z: number, id: number): void => {
    cells.set(`${x},${y},${z}`, id);
  };

  interface Box { u: number; v: number; hw: number; ih: number; kind: VaultRoom['kind']; }
  const boxes: Box[] = [
    { ...SLOT_HALL, hw: ROOM_HW, ih: ROOM_IH, kind: 'hall' },
    { ...SLOT_MID, hw: ROOM_HW, ih: ROOM_IH, kind: 'room' },
    ...sides.map((s) => ({ ...s, hw: ROOM_HW, ih: ROOM_IH, kind: 'room' as const })),
    { ...SLOT_BOSS, hw: BOSS_HW, ih: BOSS_IH, kind: 'boss' },
  ];

  // 1) Room shells (walls/floor/ceiling of VaultBrick).
  for (const b of boxes) {
    for (let du = -b.hw; du <= b.hw; du++) {
      for (let dv = -b.hw; dv <= b.hw; dv++) {
        for (let y = fy; y <= fy + b.ih + 1; y++) {
          mark(wx(b.u + du, b.v + dv), y, wz(b.u + du, b.v + dv), Block.VaultBrick);
        }
      }
    }
  }
  // 2) Corridor shells: hall→mid, mid→boss (along u), room→side (along v).
  //    A corridor is a 2-wide, 3-high tunnel with a 1-thick VaultBrick sleeve.
  const corridorShell = (
    fromU: number, toU: number, atV: number, alongU: boolean
  ): void => {
    const lo = Math.min(fromU, toU), hi = Math.max(fromU, toU);
    for (let t = lo; t <= hi; t++) {
      for (let s = -2; s <= 1; s++) {
        for (let y = fy; y <= fy + 4; y++) {
          const u = alongU ? t : atV + s;
          const v = alongU ? atV + s : t;
          const key = `${wx(u, v)},${y},${wz(u, v)}`;
          if (cells.get(key) !== Block.Air) mark(wx(u, v), y, wz(u, v), Block.VaultBrick);
        }
      }
    }
  };
  corridorShell(ROOM_HW, SLOT_MID.u - ROOM_HW, 0, true);
  corridorShell(SLOT_MID.u + ROOM_HW, SLOT_BOSS.u - BOSS_HW, 0, true);
  for (const s of sides) corridorShell(ROOM_HW, 12 - ROOM_HW, s.u, false);

  // 3) Carve room interiors (air overwrites shell).
  for (const b of boxes) {
    for (let du = -(b.hw - 1); du <= b.hw - 1; du++) {
      for (let dv = -(b.hw - 1); dv <= b.hw - 1; dv++) {
        for (let y = fy + 1; y <= fy + b.ih; y++) {
          mark(wx(b.u + du, b.v + dv), y, wz(b.u + du, b.v + dv), Block.Air);
        }
      }
    }
  }
  // 4) Carve corridor tunnels (2 wide, 3 high) through walls + sleeves.
  const corridorAir = (fromU: number, toU: number, atV: number, alongU: boolean): void => {
    const lo = Math.min(fromU, toU), hi = Math.max(fromU, toU);
    for (let t = lo; t <= hi; t++) {
      for (const s of [-1, 0]) {
        for (let y = fy + 1; y <= fy + 3; y++) {
          const u = alongU ? t : atV + s;
          const v = alongU ? atV + s : t;
          mark(wx(u, v), y, wz(u, v), Block.Air);
        }
      }
    }
  };
  corridorAir(ROOM_HW, SLOT_MID.u - ROOM_HW, 0, true);
  corridorAir(SLOT_MID.u + ROOM_HW, SLOT_BOSS.u - BOSS_HW, 0, true);
  for (const s of sides) corridorAir(ROOM_HW, 12 - ROOM_HW, s.u, false);

  // 5) Entrance staircase: a walk-down tunnel from the hall's -u wall, rising
  //    1 block per step until it breaks the surface (deterministic: ctx.height).
  let mouth = { x: ax, y: g, z: az };
  {
    let surfaced = false;
    for (let i = 0; i <= 26 && !surfaced; i++) {
      const u = -(ROOM_HW + i);
      const stepY = fy + 1 + i;
      const colH = ctx.height(wx(u, 0), wz(u, 0));
      for (const s of [-1, 0]) {
        for (let y = stepY; y <= stepY + 2; y++) {
          mark(wx(u, s), y, wz(u, s), Block.Air);
        }
      }
      if (stepY >= colH) {
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
  }

  // 6) Furniture: torches in every room, the VaultChest on the boss floor.
  for (const b of boxes) {
    mark(wx(b.u - (b.hw - 1), b.v - (b.hw - 1)), fy + 1, wz(b.u - (b.hw - 1), b.v - (b.hw - 1)), Block.Torch);
    mark(wx(b.u + (b.hw - 1), b.v + (b.hw - 1)), fy + 1, wz(b.u + (b.hw - 1), b.v + (b.hw - 1)), Block.Torch);
  }
  const chest = { x: wx(SLOT_BOSS.u, 0), y: fy + 1, z: wz(SLOT_BOSS.u, 0) };
  mark(chest.x, chest.y, chest.z, Block.VaultChest);

  // Emit blocks + compute rooms/bounds in world space.
  const blocks: VaultStamp['blocks'] = [];
  for (const [key, id] of cells) {
    const [x, y, z] = key.split(',').map(Number);
    blocks.push({ x, y, z, id });
  }
  const rooms: VaultRoom[] = boxes.map((b) => ({
    x: wx(b.u, b.v), y: fy + 1, z: wz(b.u, b.v), hw: b.hw,
    kind: b.kind,
    cap: b.kind === 'boss' ? 0 : b.kind === 'hall' ? 2 : 3,
  }));
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const r of rooms) {
    minX = Math.min(minX, r.x - r.hw - 2); maxX = Math.max(maxX, r.x + r.hw + 2);
    minZ = Math.min(minZ, r.z - r.hw - 2); maxZ = Math.max(maxZ, r.z + r.hw + 2);
  }
  const bounds = { minX, minZ, maxX, maxZ, minY: fy - 1, maxY: fy + BOSS_IH + 3 };

  return { cx, cz, tier, x: ax, y: g, z: az, floorY: fy, rooms, chest, mouth, bounds, blocks };
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
  // Tier I (Heartland): starter war supplies.
  1: [
    { id: Item.Bullet, min: 8, max: 16, w: 3 },
    { id: Item.IronIngot, min: 2, max: 5, w: 3 },
    { id: Item.Coal, min: 3, max: 6, w: 2 },
    { id: Block.Torch, min: 4, max: 8, w: 2 },
    { id: Item.Grenade, min: 1, max: 2, w: 1.5 },
    { id: Item.JumpBoost, min: 1, max: 2, w: 1 },
    { id: Item.GoldIngot, min: 1, max: 3, w: 1.5 },
    { id: Item.Pistol, min: 1, max: 1, w: 0.7 },
  ],
  // Tier II (mid Wilds): serious kit.
  2: [
    { id: Item.TitaniumIngot, min: 1, max: 3, w: 2.5 },
    { id: Item.Bullet, min: 12, max: 24, w: 3 },
    { id: Item.Diamond, min: 1, max: 3, w: 2 },
    { id: Item.CrystalShard, min: 2, max: 4, w: 2 },
    { id: Item.SMG, min: 1, max: 1, w: 1 },
    { id: Item.Shotgun, min: 1, max: 1, w: 1 },
    { id: Item.Grenade, min: 2, max: 3, w: 1.5 },
    { id: Item.OilBarrel, min: 2, max: 4, w: 1.5 },
    { id: Item.GrapplingHook, min: 1, max: 1, w: 0.7 },
  ],
  // Tier III (deep Wilds): the jackpot pool (+ a guaranteed Heart on top).
  3: [
    { id: Item.TitaniumIngot, min: 3, max: 6, w: 3 },
    { id: Item.Diamond, min: 2, max: 4, w: 2.5 },
    { id: Item.Sniper, min: 1, max: 1, w: 1 },
    { id: Item.BurstRifle, min: 1, max: 1, w: 1 },
    { id: Item.CrystalShard, min: 3, max: 6, w: 2 },
    { id: Item.Cannonball, min: 4, max: 8, w: 1.5 },
    { id: Item.GoldIngot, min: 3, max: 6, w: 2 },
    { id: Item.OilBarrel, min: 3, max: 6, w: 1.5 },
    { id: Item.Heart, min: 1, max: 1, w: 0.5 }, // extra hearts CAN roll too
  ],
};

const VAULT_ROLLS: Record<VaultTier, number> = { 1: 4, 2: 5, 3: 6 };

/** FNV-1a over a string (per-player loot personalisation). */
function strHash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** The per-player vault loot roll: a pure function of (seed, vault, username),
 *  so it is identical wherever it's computed and re-rolls are impossible.
 *  Tier III always includes a Heart. */
export function vaultLoot(
  seed: number, cx: number, cz: number, tier: VaultTier, username: string
): ItemStack[] {
  let h = (seed ^ strHash(username.toLowerCase()) ^ 0x7a017) >>> 0;
  h = Math.imul(h ^ cx, 0x27d4eb2f);
  h = Math.imul(h ^ cz, 0x165667b1);
  const rng = mulberry32(h >>> 0);
  const table = VAULT_LOOT[tier];
  const totalW = table.reduce((a, e) => a + e.w, 0);
  const out: ItemStack[] = [];
  if (tier === 3) out.push({ id: Item.Heart, count: 1 }); // the guaranteed Heart
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
  return { tier, hp: bruteMaxHp(tier), deadAt: DEAD_NEVER, openedBy: [] };
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

/** Fail-closed sanitizer for a persisted VaultServerState. */
export function sanitizeVaultState(raw: unknown): VaultServerState | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Partial<VaultServerState>;
  const tier = o.tier === 1 || o.tier === 2 || o.tier === 3 ? o.tier : null;
  if (!tier) return null;
  const max = bruteMaxHp(tier);
  const hp = Number.isFinite(o.hp) ? Math.max(0, Math.min(max, Math.floor(o.hp as number))) : max;
  const deadAt = Number.isFinite(o.deadAt) ? (o.deadAt as number) : DEAD_NEVER;
  const openedBy = Array.isArray(o.openedBy)
    ? (o.openedBy as unknown[]).filter((u): u is string => typeof u === 'string').slice(0, 10000)
    : [];
  return { tier, hp, deadAt, openedBy };
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
