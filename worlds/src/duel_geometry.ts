// Deterministic Prism Colosseum geometry: one authored height/role map for
// terrain stamping, collision, sight, building and spawn planning.
import { Block } from './blocks';

export const DUEL_ARENA_SIZE = 44;
const DUEL_ARENA_INTERIOR = 40;
export const DUEL_ARENA_FLOOR_Y = 96;
const DUEL_WALL_ROWS = 11;
const DUEL_ARENA_HEIGHT = 256 - DUEL_ARENA_FLOOR_Y;

const enum DuelCell {
  Field, Inlay, Step, Dais, Rim, Obelisk,
  PadA, PadB, PadC, PadD,
  BeaconA, BeaconB, BeaconC, BeaconD,
  Bunker, Pylon,
}
interface DuelArenaMap { height: Uint8Array; role: Uint8Array }
let arenaMapCache: DuelArenaMap | null = null;

function buildDuelArenaMap(): DuelArenaMap {
  const n = DUEL_ARENA_INTERIOR;
  const height = new Uint8Array(n * n);
  const role = new Uint8Array(n * n).fill(DuelCell.Field);
  const at = (x: number, z: number) => z * n + x;
  const inside = (x: number, z: number) => x >= 0 && x < n && z >= 0 && z < n;
  // Each corner feature gets all four rotations; palettes rotate with seats.
  const stamp = (x: number, z: number, h: number, cell: DuelCell, rotateRole = true) => {
    let px = x, pz = z;
    for (let turn = 0; turn < 4; turn++) {
      if (inside(px, pz)) {
        const i = at(px, pz);
        height[i] = h;
        role[i] = rotateRole ? cell + turn : cell;
      }
      const nx = n - 1 - pz, nz = px;
      px = nx; pz = nz;
    }
  };
  const centre = (n - 1) / 2;
  for (let z = 0; z < n; z++) for (let x = 0; x < n; x++) {
    const rad = Math.hypot(x - centre, z - centre);
    const i = at(x, z);
    if (rad <= 4.2) { height[i] = 3; role[i] = DuelCell.Dais; }
    else if (rad <= 5.4) { height[i] = 3; role[i] = DuelCell.Rim; }
    else if (rad <= 7.0) { height[i] = 2; role[i] = DuelCell.Step; }
    else if (rad <= 8.6) { height[i] = 1; role[i] = DuelCell.Step; }
    else {
      const ax = Math.abs(x - centre), az = Math.abs(z - centre);
      const onDiagonal = Math.abs(ax - az) <= 1.2;
      const onRing = Math.abs(rad - 13.5) <= 0.7;
      role[i] = onDiagonal || onRing ? DuelCell.Inlay : DuelCell.Field;
    }
  }
  for (const [x, z] of [[19, 19], [20, 19], [19, 20], [20, 20]]) {
    const i = at(x, z); height[i] = 4; role[i] = DuelCell.Obelisk;
  }
  stamp(16, 16, 6, DuelCell.Pylon, false);
  for (let dz = -3; dz <= 3; dz++) for (let dx = -3; dx <= 3; dx++) {
    const reach = Math.max(Math.abs(dx), Math.abs(dz));
    stamp(8 + dx, 8 + dz, reach <= 2 ? 2 : 1, DuelCell.PadA);
  }
  stamp(6, 6, 6, DuelCell.BeaconA);
  for (let x = 14; x <= 25; x++) {
    if (x === 19 || x === 20) continue;
    stamp(x, 6, 3, DuelCell.Bunker, false);
    stamp(x, 5, 1, DuelCell.Bunker, false);
  }
  for (const [dx, dz] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
    stamp(13 + dx, 13 + dz, 4, DuelCell.Pylon, false);
  }
  stamp(19, 11, 3, DuelCell.Pylon, false);
  stamp(20, 11, 3, DuelCell.Pylon, false);
  return { height, role };
}

function duelArenaMap(): DuelArenaMap { return (arenaMapCache ??= buildDuelArenaMap()); }

export function duelTerrainElevation(lx: number, lz: number): number {
  const x = Math.floor(lx), z = Math.floor(lz);
  if (x < 0 || x >= DUEL_ARENA_INTERIOR || z < 0 || z >= DUEL_ARENA_INTERIOR) return 0;
  return duelArenaMap().height[z * DUEL_ARENA_INTERIOR + x];
}

interface DuelPalette { top: number; body: number }
const DUEL_PALETTES: Record<number, DuelPalette> = {
  [DuelCell.Field]: { top: Block.SpectralMarble, body: Block.CarvedVaultBrick },
  [DuelCell.Inlay]: { top: Block.PearlTile, body: Block.CarvedVaultBrick },
  [DuelCell.Step]: { top: Block.LuminousLimestone, body: Block.LuminousLimestone },
  [DuelCell.Dais]: { top: Block.VaultMosaic, body: Block.LuminousLimestone },
  [DuelCell.Rim]: { top: Block.RuneGlass, body: Block.LuminousLimestone },
  [DuelCell.Obelisk]: { top: Block.RuneGlass, body: Block.IvoryColumn },
  [DuelCell.PadA]: { top: Block.EmberBrick, body: Block.EmberBrick },
  [DuelCell.PadB]: { top: Block.PrismBrick, body: Block.PrismBrick },
  [DuelCell.PadC]: { top: Block.GildedVaultBrick, body: Block.GildedVaultBrick },
  [DuelCell.PadD]: { top: Block.CarvedVaultBrick, body: Block.CarvedVaultBrick },
  [DuelCell.BeaconA]: { top: Block.EmberBrazier, body: Block.EmberBrick },
  [DuelCell.BeaconB]: { top: Block.PrismLamp, body: Block.PrismBrick },
  [DuelCell.BeaconC]: { top: Block.GildedLamp, body: Block.GildedVaultBrick },
  [DuelCell.BeaconD]: { top: Block.SoulLantern, body: Block.CarvedVaultBrick },
  [DuelCell.Bunker]: { top: Block.ClockworkGrate, body: Block.ClockworkGrate },
  [DuelCell.Pylon]: { top: Block.RuneGlass, body: Block.OpalBrick },
};

export interface DuelVec3 { x: number; y: number; z: number }
export interface DuelArenaBounds {
  originX: number; originZ: number;
  minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number;
  floor: number; ceiling: number; spawns: DuelVec3[];
}

/** Fresh bounds let callers own their spawn arrays without mutating the stamp. */
export function duelArenaBounds(): DuelArenaBounds {
  const originX = 0, originZ = 0;
  const minX = originX + 2, minZ = originZ + 2;
  const maxX = minX + DUEL_ARENA_INTERIOR, maxZ = minZ + DUEL_ARENA_INTERIOR;
  const floor = DUEL_ARENA_FLOOR_Y, ceiling = floor + DUEL_ARENA_HEIGHT;
  const insets: [number, number][] = [[8, 8], [DUEL_ARENA_INTERIOR - 9, 8],
    [DUEL_ARENA_INTERIOR - 9, DUEL_ARENA_INTERIOR - 9], [8, DUEL_ARENA_INTERIOR - 9]];
  return {
    originX, originZ, minX, maxX, minY: floor + 1, maxY: ceiling - 1, minZ, maxZ, floor, ceiling,
    spawns: insets.map(([lx, lz]) => ({ x: minX + lx + 0.5,
      y: floor + duelTerrainElevation(lx, lz) + 1.01, z: minZ + lz + 0.5 })),
  };
}
const DUEL_ARENA = duelArenaBounds();

function duelArenaAt(x: number, z: number): DuelArenaBounds | null {
  if (!Number.isFinite(x) || !Number.isFinite(z)) return null;
  return x >= 0 && x < DUEL_ARENA_SIZE && z >= 0 && z < DUEL_ARENA_SIZE ? DUEL_ARENA : null;
}

function duelWallBlock(outerLx: number, by: number, outerLz: number, floor: number): number {
  const relY = by - floor;
  const isCorner = (outerLx <= 1 || outerLx >= DUEL_ARENA_SIZE - 2) &&
    (outerLz <= 1 || outerLz >= DUEL_ARENA_SIZE - 2);
  const edge = outerLx < 2 || outerLx >= DUEL_ARENA_SIZE - 2 ? outerLz : outerLx;
  const isPillar = isCorner || edge % 5 === 0;
  switch (relY) {
    case 0: return Block.CarvedVaultBrick;
    case 1: case 2: return isPillar ? Block.IvoryColumn : Block.SpectralMarble;
    case 3: return isPillar ? Block.IvoryColumn : Block.RuneGlass;
    case 4: return isPillar ? Block.IvoryColumn : Block.PearlTile;
    case 5: return isPillar ? Block.IvoryColumn : Block.LuminousLimestone;
    case 6: return isPillar ? Block.IvoryColumn : Block.PearlTile;
    case 7: return isPillar ? Block.IvoryColumn : Block.RuneGlass;
    case 8: return isPillar ? Block.IvoryColumn : Block.SpectralMarble;
    case 9: return Block.LuminousLimestone;
    case 10:
      if (isCorner) return Block.PrismLamp;
      if (isPillar) return Block.GildedLamp;
      return (edge & 1) === 0 ? Block.VaultMosaic : Block.Barrier;
    default: return Block.Barrier;
  }
}

/** Material stamp corresponds exactly to authored collision; edits stay separate. */
export function duelArenaBlockAt(x: number, y: number, z: number): number | null {
  const arena = duelArenaAt(x, z);
  if (!arena) return null;
  const bx = Math.floor(x), by = Math.floor(y), bz = Math.floor(z);
  const inShellY = by >= arena.floor - 1 && by < arena.ceiling;
  if (!inShellY) return null;
  const lx = bx - arena.minX, lz = bz - arena.minZ;
  const outerLx = bx - arena.originX, outerLz = bz - arena.originZ;
  const boundary = outerLx < 2 || outerLx >= DUEL_ARENA_SIZE - 2 || outerLz < 2 || outerLz >= DUEL_ARENA_SIZE - 2;
  if (by === arena.floor - 1) return Block.CarvedVaultBrick;
  if (boundary) {
    if (by < arena.floor + DUEL_WALL_ROWS) return duelWallBlock(outerLx, by, outerLz, arena.floor);
    return Block.Barrier;
  }
  if (lx >= 0 && lx < DUEL_ARENA_INTERIOR && lz >= 0 && lz < DUEL_ARENA_INTERIOR) {
    const map = duelArenaMap();
    const cell = lz * DUEL_ARENA_INTERIOR + lx;
    const groundY = arena.floor + map.height[cell];
    if (by > groundY) return Block.Air;
    const palette = DUEL_PALETTES[map.role[cell]] ?? DUEL_PALETTES[DuelCell.Field];
    return by === groundY ? palette.top : palette.body;
  }
  return null;
}

export function clampToDuelArena(p: DuelVec3, arena: DuelArenaBounds): DuelVec3 {
  return {
    x: Math.max(arena.minX + 0.15, Math.min(arena.maxX - 0.15, p.x)),
    y: Math.max(arena.minY, Math.min(arena.maxY - 0.85, p.y)),
    z: Math.max(arena.minZ + 0.15, Math.min(arena.maxZ - 0.15, p.z)),
  };
}

function duelArenaSolidAt(x: number, y: number, z: number, arena: DuelArenaBounds): boolean {
  const bx = Math.floor(x), by = Math.floor(y), bz = Math.floor(z);
  const outerMinX = arena.originX, outerMaxX = arena.originX + DUEL_ARENA_SIZE - 1;
  const outerMinZ = arena.originZ, outerMaxZ = arena.originZ + DUEL_ARENA_SIZE - 1;
  if (bx < outerMinX || bx > outerMaxX || bz < outerMinZ || bz > outerMaxZ) return false;
  if (by < arena.floor - 1 || by >= arena.ceiling) return false;
  if (by === arena.floor - 1) return true;
  if (bx < arena.minX || bx >= arena.maxX || bz < arena.minZ || bz >= arena.maxZ) return true;
  const lx = bx - arena.minX, lz = bz - arena.minZ;
  return by <= arena.floor + duelTerrainElevation(lx, lz);
}

export function hasArenaLineOfSight(a: DuelVec3, b: DuelVec3, arena: DuelArenaBounds,
  isSolidExtra?: (x: number, y: number, z: number) => boolean): boolean {
  const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
  const distance = Math.hypot(dx, dy, dz);
  const steps = Math.max(1, Math.ceil(distance * 4));
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const px = a.x + dx * t, py = a.y + dy * t, pz = a.z + dz * t;
    if (duelArenaSolidAt(px, py, pz, arena) || isSolidExtra?.(px, py, pz)) return false;
  }
  return true;
}

export function safestDuelSpawn(arena: DuelArenaBounds, opponents: DuelVec3[], previousIndex = -1): number {
  let best = 0, bestVisible = Infinity, bestDistance = -Infinity;
  for (let i = 0; i < arena.spawns.length; i++) {
    const spawn = arena.spawns[i];
    const visible = opponents.filter((p) => hasArenaLineOfSight(
      { x: spawn.x, y: spawn.y + 1.3, z: spawn.z }, { x: p.x, y: p.y + 1.3, z: p.z }, arena,
    )).length;
    const nearest = opponents.length
      ? Math.min(...opponents.map((p) => Math.hypot(p.x - spawn.x, p.z - spawn.z))) : Infinity;
    const repeatPenalty = i === previousIndex ? 8 : 0;
    if (visible < bestVisible || (visible === bestVisible && nearest - repeatPenalty > bestDistance)) {
      best = i; bestVisible = visible; bestDistance = nearest - repeatPenalty;
    }
  }
  return best;
}
