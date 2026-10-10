// The Bridge venue geometry, independent of the lobby lifecycle.
import { Block } from './blocks';
import type { PartySubBounds } from './partygames';
import type { PartyVec3 } from './party_math';
import { BRIDGE_SIZE_X, BRIDGE_SIZE_Z, PARTY_FLOOR_Y, PARTY_STAMP_MIN_Y, PARTY_STAMP_MAX_Y } from './venue_dims';

// ── Venue stamps ───────────────────────────────────────────────────────────
// Both venues are authored into a sparse block map keyed by venue-local
// (x, y, z). Sparse rather than a dense column array because both venues are
// mostly open air, and the server walks this map for every collision segment.

class VenueStamp {
  readonly blocks = new Map<number, number>();
  constructor(readonly sizeX: number, readonly sizeZ: number) { }
  key(lx: number, y: number, lz: number): number {
    return ((y - PARTY_STAMP_MIN_Y) * this.sizeZ + lz) * this.sizeX + lx;
  }
  inside(lx: number, y: number, lz: number): boolean {
    return lx >= 0 && lx < this.sizeX && lz >= 0 && lz < this.sizeZ &&
      y >= PARTY_STAMP_MIN_Y && y <= PARTY_STAMP_MAX_Y;
  }
  set(lx: number, y: number, lz: number, block: number): void {
    if (this.inside(lx, y, lz)) this.blocks.set(this.key(lx, y, lz), block);
  }
  clear(lx: number, y: number, lz: number): void {
    if (this.inside(lx, y, lz)) this.blocks.delete(this.key(lx, y, lz));
  }
  get(lx: number, y: number, lz: number): number {
    if (!this.inside(lx, y, lz)) return Block.Air;
    return this.blocks.get(this.key(lx, y, lz)) ?? Block.Air;
  }
  /** Inclusive box fill. */
  fill(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, block: number): void {
    for (let y = y0; y <= y1; y++)
      for (let z = z0; z <= z1; z++)
        for (let x = x0; x <= x1; x++) this.set(x, y, z, block);
  }
  /** Inclusive box erase. */
  carve(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number): void {
    for (let y = y0; y <= y1; y++)
      for (let z = z0; z <= z1; z++)
        for (let x = x0; x <= x1; x++) this.clear(x, y, z);
  }
}

// ── The Bridge ─────────────────────────────────────────────────────────────
// One 24 x 80 island chain, perfectly mirror-symmetric about z = 40. Only the
// crimson half is authored; the cobalt half is that half reflected with the
// team wool swapped, so neither side can ever have a geometric advantage.
//
// The venue is deliberately COMPACT — roughly half the span and half the width
// it used to be — because a duel over one block of walkway is decided by how
// long the crossing takes, not by how far apart the two ends are. What the
// smaller footprint buys is spent back on the base itself: at this size every
// block of it is on screen at once, so it is built out of small pieces —
// courses, slits, machicolations, obelisks, a keep and a drop cage — rather
// than large flat plates.

/** Reflection axis. `BRIDGE_SIZE_Z - 1 - lz` maps crimson to cobalt in BLOCKS;
 *  a continuous z mirrors as `BRIDGE_SIZE_Z - z`, which is the same axis. */
const BRIDGE_MIRROR = BRIDGE_SIZE_Z - 1;
/** Team wool, indexed by team. Placeable, and the only block players may add. */
export const BRIDGE_TEAM_BLOCK = [Block.TeamWoolA, Block.TeamWoolB] as const;
export const BRIDGE_TEAM_NAME = ['CRIMSON', 'COBALT'] as const;
/** The crimson base's footprint, venue-local and inclusive. */
const BASE_X0 = 4, BASE_X1 = 20, BASE_Z0 = 2, BASE_Z1 = 18;
/** Scoring portal footprints, in venue-local blocks. Half-open on max. */
export const BRIDGE_GOALS: readonly { team: number; minX: number; maxX: number; minZ: number; maxZ: number }[] = [
  { team: 0, minX: 11, maxX: 14, minZ: 6, maxZ: 9 },
  { team: 1, minX: 11, maxX: 14, minZ: BRIDGE_MIRROR - 8, maxZ: BRIDGE_MIRROR - 5 },
];
/** No player-placed block may enter this pad around a portal mouth. */
const GOAL_GUARD = 2;
/** The centre line. One span, one block wide, runs the whole length on it. */
export const BRIDGE_LANE_X = 12;
/** Spawn pad centre, crimson side. */
const BRIDGE_SPAWN_Z = 13.5;

// ── The drop cage ──────────────────────────────────────────────────────────
// Every round, and every restart after a goal, begins with both players shut
// inside a glass pod over their own spawn pad. The pod is ordinary authored
// geometry — it is always there — but its hatch is the one part of either
// venue the server opens and closes at runtime, so the start of play is a real
// three-block fall onto your own deck rather than a teleport.
/** Cage footprint, inclusive. The hatch is the interior of it. */
const CAGE_X0 = BRIDGE_LANE_X - 2, CAGE_X1 = BRIDGE_LANE_X + 2;
const CAGE_Z0 = 11, CAGE_Z1 = 15;
/** Hatch height and standing height, both relative to the deck. Three blocks:
 *  short enough that the drop never costs a single point of fall damage. */
export const BRIDGE_CAGE_FLOOR = 3;
export const BRIDGE_CAGE_ROOF = 7;

function bridgeSwapTeam(block: number): number {
  return block === Block.TeamWoolA ? Block.TeamWoolB : block === Block.TeamWoolB ? Block.TeamWoolA : block;
}
/** `lz` reflected onto the other side of the arena. */
function bridgeMirrorZ(lz: number): number { return BRIDGE_MIRROR - lz; }

let bridgeStampCache: VenueStamp | null = null;
export function bridgeStamp(): VenueStamp {
  if (bridgeStampCache) return bridgeStampCache;
  const s = new VenueStamp(BRIDGE_SIZE_X, BRIDGE_SIZE_Z);
  const F = PARTY_FLOOR_Y, cx = BRIDGE_LANE_X;
  const TEAM = Block.TeamWoolA, STONE = Block.OpalBrick, DECK = Block.SpectralMarble;
  const TRIM = Block.PearlTile, CORE = Block.Basalt, GLOW = Block.RuneGlass;
  const GOLD = Block.GildedVaultBrick, COLUMN = Block.IvoryColumn, PRISM = Block.PrismBrick;
  const CARVED = Block.CarvedVaultBrick, JADE = Block.JadeMosaic, MOSAIC = Block.VaultMosaic;
  const LIME = Block.LuminousLimestone, GRATE = Block.ClockworkGrate, LAMP = Block.GildedLamp;
  const g = BRIDGE_GOALS[0];

  // 1. The island the base stands on. Each course steps in as it falls, so the
  //    base reads as a rock hanging in the void rather than a slab on stilts.
  //    The last course is lit and sits directly under the portal: it IS the
  //    floor a scoring dive lands on.
  const island: readonly [number, number, number, number, number, number][] = [
    [BASE_X0, BASE_X1, F - 1, BASE_Z0, BASE_Z1, CORE],
    [BASE_X0 + 1, BASE_X1 - 1, F - 2, BASE_Z0 + 1, BASE_Z1 - 1, CORE],
    [BASE_X0 + 2, BASE_X1 - 2, F - 3, BASE_Z0 + 2, BASE_Z1 - 2, LIME],
    [BASE_X0 + 3, BASE_X1 - 3, F - 4, BASE_Z0 + 2, BASE_Z1 - 4, STONE],
    [BASE_X0 + 4, BASE_X1 - 4, F - 5, BASE_Z0 + 2, BASE_Z1 - 6, PRISM],
    [BASE_X0 + 5, BASE_X1 - 5, F - 6, BASE_Z0 + 3, BASE_Z1 - 7, PRISM],
    [BASE_X0 + 6, BASE_X1 - 6, F - 7, BASE_Z0 + 3, BASE_Z1 - 8, PRISM],
    [BASE_X0 + 6, BASE_X1 - 6, F - 8, BASE_Z0 + 3, BASE_Z1 - 8, GLOW],
  ];
  for (const [x0, x1, y, z0, z1, block] of island) s.fill(x0, x1, y, y, z0, z1, block);
  // Ribs down the flanks, and a hanging pylon under each corner tipped with a
  // team lamp — the underside is the first thing you see from the far base.
  for (const lz of [4, 8, 12, 16])
    for (const lx of [BASE_X0, BASE_X1]) {
      s.fill(lx, lx, F - 4, F - 2, lz, lz, CARVED);
      s.set(lx, F - 5, lz, GLOW);
    }
  for (const [px, pz] of [[BASE_X0 + 1, BASE_Z0 + 1], [BASE_X1 - 1, BASE_Z0 + 1],
    [BASE_X0 + 1, BASE_Z1 - 1], [BASE_X1 - 1, BASE_Z1 - 1]]) {
    s.fill(px, px, F - 12, F - 3, pz, pz, CORE);
    s.set(px, F - 7, pz, TEAM);
    s.set(px, F - 13, pz, GLOW);
  }

  // 2. The deck. A gilded runway leaves the portal and runs out through the
  //    sally port, so the one route out of the base is drawn on the floor.
  for (let lz = BASE_Z0; lz <= BASE_Z1; lz++)
    for (let lx = BASE_X0; lx <= BASE_X1; lx++) {
      const dx = Math.abs(lx - cx), edge = lx === BASE_X0 || lx === BASE_X1 || lz === BASE_Z0 || lz === BASE_Z1;
      const rim = lx === BASE_X0 + 1 || lx === BASE_X1 - 1 || lz === BASE_Z0 + 1 || lz === BASE_Z1 - 1;
      const runway = dx <= 1 && lz >= g.maxZ;
      s.set(lx, F, lz, edge ? TRIM : rim ? CARVED
        : runway ? (dx === 0 ? GOLD : PRISM)
          : (lz + dx) % 6 < 2 ? TEAM
            : (lx % 4 === 0 || lz % 4 === 0) ? JADE : DECK);
    }

  // 3. The rampart. Four courses, arrow slits every third block, crenellated —
  //    and one sally port, dead centre, lined up with the span and with the
  //    portal at the far end of it: there is exactly one way out.
  for (let y = F + 1; y <= F + 4; y++)
    for (let lz = BASE_Z0; lz <= BASE_Z1; lz++)
      for (let lx = BASE_X0; lx <= BASE_X1; lx++) {
        if (!(lx === BASE_X0 || lx === BASE_X1 || lz === BASE_Z0 || lz === BASE_Z1)) continue;
        if (lz === BASE_Z1 && lx >= g.minX && lx < g.maxX) continue;
        if (y === F + 4 && (lx + lz) % 2 !== 0) continue; // crenellations
        const slit = y === F + 2 && (lx + lz) % 3 === 0;
        s.set(lx, y, lz, slit ? GLOW : y === F + 3 ? TEAM : y === F + 1 ? STONE : CARVED);
      }

  // 4. Corner turrets: a banded shaft, a machicolated ring on grates, a wool
  //    crown and a gilded finial.
  for (const [tx, tz] of [[BASE_X0 + 1, BASE_Z0 + 1], [BASE_X1 - 1, BASE_Z0 + 1],
    [BASE_X0 + 1, BASE_Z1 - 1], [BASE_X1 - 1, BASE_Z1 - 1]]) {
    for (let y = F + 1; y <= F + 9; y++)
      for (let dz = -1; dz <= 1; dz++)
        for (let dx = -1; dx <= 1; dx++) {
          const corner = dx !== 0 && dz !== 0;
          s.set(tx + dx, y, tz + dz, corner ? COLUMN
            : y === F + 4 || y === F + 8 ? TEAM : y % 3 === 0 ? CARVED : STONE);
        }
    for (const [dx, dz] of [[2, 0], [-2, 0], [0, 2], [0, -2]]) {
      s.set(tx + dx, F + 9, tz + dz, GRATE);
      s.set(tx + dx, F + 8, tz + dz, LAMP);
    }
    s.fill(tx - 2, tx + 2, F + 10, F + 10, tz - 2, tz + 2, STONE);
    for (let dz = -2; dz <= 2; dz++)
      for (let dx = -2; dx <= 2; dx++)
        if (Math.abs(dx) === 2 || Math.abs(dz) === 2) s.set(tx + dx, F + 11, tz + dz, TEAM);
    s.fill(tx, tx, F + 11, F + 13, tz, tz, GLOW);
    s.set(tx, F + 14, tz, GOLD);
  }

  // 5. The gate over the sally port: jambs, a carved lintel, a wool banner and
  //    a lamp either side, so the one way out is also the loudest thing on the
  //    wall from the enemy's deck.
  for (const jx of [g.minX - 1, g.maxX]) {
    s.fill(jx, jx, F + 1, F + 3, BASE_Z1, BASE_Z1, COLUMN);
    s.set(jx, F + 6, BASE_Z1, LAMP);
  }
  s.fill(g.minX - 1, g.maxX, F + 4, F + 4, BASE_Z1, BASE_Z1, CARVED);
  s.fill(g.minX, g.maxX - 1, F + 5, F + 5, BASE_Z1, BASE_Z1, TEAM);
  s.fill(g.minX - 1, g.maxX, F + 6, F + 6, BASE_Z1, BASE_Z1, GOLD);
  s.set(cx, F + 7, BASE_Z1, GLOW);

  // 6. The keep, behind the portal: a two-step dais, four lit columns, a
  //    slab roof and a gilded ridge.
  s.fill(BASE_X0 + 2, BASE_X1 - 2, F + 1, F + 1, BASE_Z0 + 1, BASE_Z0 + 3, TRIM);
  s.fill(BASE_X0 + 4, BASE_X1 - 4, F + 2, F + 2, BASE_Z0 + 1, BASE_Z0 + 2, MOSAIC);
  for (const px of [BASE_X0 + 4, BASE_X1 - 4])
    for (const pz of [BASE_Z0 + 1, BASE_Z0 + 3]) {
      s.fill(px, px, F + 2, F + 5, pz, pz, COLUMN);
      s.set(px, F + 6, pz, LAMP);
    }
  s.fill(BASE_X0 + 3, BASE_X1 - 3, F + 7, F + 7, BASE_Z0, BASE_Z0 + 4, STONE);
  s.fill(BASE_X0 + 5, BASE_X1 - 5, F + 8, F + 8, BASE_Z0 + 1, BASE_Z0 + 3, TEAM);
  s.fill(cx - 1, cx + 1, F + 9, F + 9, BASE_Z0 + 1, BASE_Z0 + 3, GOLD);
  s.set(cx, F + 10, BASE_Z0 + 2, GLOW);

  // 7. The portal: a gilded collar on the deck, a prism-lined shaft, four
  //    banded obelisks and a floating cross over the mouth.
  s.fill(g.minX - 1, g.maxX, F, F, g.minZ - 1, g.maxZ, GOLD);
  s.fill(g.minX - 1, g.maxX, F - 7, F - 1, g.minZ - 1, g.maxZ, PRISM);
  for (const ox of [g.minX - 1, g.maxX])
    for (const oz of [g.minZ - 1, g.maxZ]) {
      for (let y = F + 1; y <= F + 4; y++) s.set(ox, y, oz, y % 2 ? CARVED : TEAM);
      s.set(ox, F + 5, oz, GLOW);
      s.set(ox, F + 6, oz, GOLD);
    }
  const gz = (g.minZ + g.maxZ - 1) / 2;
  s.fill(g.minX - 1, g.maxX, F + 7, F + 7, gz, gz, GOLD);
  s.fill(cx, cx, F + 7, F + 7, g.minZ - 1, g.maxZ, GOLD);
  s.set(cx, F + 8, gz, GLOW);

  // 8. The spawn pad, a wool-and-mosaic square you cannot mistake for the
  //    deck, and the drop cage standing over it on four legs.
  for (let lz = CAGE_Z0; lz <= CAGE_Z1; lz++)
    for (let lx = CAGE_X0 - 2; lx <= CAGE_X1 + 2; lx++) {
      const border = lz === CAGE_Z0 || lz === CAGE_Z1 || lx === CAGE_X0 - 2 || lx === CAGE_X1 + 2;
      s.set(lx, F, lz, border ? GOLD : (lx + lz) % 2 ? TEAM : MOSAIC);
    }
  for (let lz = CAGE_Z0; lz <= CAGE_Z1; lz++)
    for (let lx = CAGE_X0; lx <= CAGE_X1; lx++) {
      const rim = lx === CAGE_X0 || lx === CAGE_X1 || lz === CAGE_Z0 || lz === CAGE_Z1;
      const corner = (lx === CAGE_X0 || lx === CAGE_X1) && (lz === CAGE_Z0 || lz === CAGE_Z1);
      // The hatch is the interior; the lip it swings out of stays put.
      s.set(lx, F + BRIDGE_CAGE_FLOOR, lz, rim ? GOLD : PRISM);
      s.set(lx, F + BRIDGE_CAGE_ROOF, lz, corner ? GOLD : rim ? CARVED : GLOW);
      if (corner) {
        s.fill(lx, lx, F + 1, F + BRIDGE_CAGE_FLOOR - 1, lz, lz, COLUMN);
        s.fill(lx, lx, F + BRIDGE_CAGE_FLOOR + 1, F + BRIDGE_CAGE_ROOF - 1, lz, lz, COLUMN);
      } else if (rim) {
        s.fill(lx, lx, F + BRIDGE_CAGE_FLOOR + 1, F + BRIDGE_CAGE_ROOF - 1, lz, lz, GLOW);
      }
    }
  s.set(cx, F + BRIDGE_CAGE_ROOF + 1, (CAGE_Z0 + CAGE_Z1) / 2, LAMP);

  // 9. The span. ONE lane, ONE block wide, straight down the centre line and
  //    unbroken from the sally port to the middle island — and, once the
  //    mirror pass below completes it, from one base to the other. There is no
  //    second route, no rail, and nothing at all to stand on either side of
  //    it: every crossing is a tightrope with somebody at the far end. The
  //    wool is for repairing the span and for climbing back onto it.
  for (let lz = BASE_Z1 + 1; lz <= 35; lz++) {
    s.set(cx, F, lz, lz % 4 === 0 ? TEAM : DECK);
    // Lanterns hang a clear block underneath: they light the span and give the
    // drop a scale, and that gap keeps them off the walking surface until
    // somebody knocks the deck out from over them.
    if (lz % 5 === 1) {
      s.set(cx, F - 2, lz, GLOW);
      s.set(cx, F - 3, lz, CORE);
    }
  }
  // Buttress arms where the span leaves the base, so it reads as built rather
  // than floating. They sit BELOW the walkway and are never a second footing.
  for (const lz of [BASE_Z1 + 1, BASE_Z1 + 2]) {
    s.set(cx - 1, F - 1, lz, CORE);
    s.set(cx + 1, F - 1, lz, CORE);
    s.set(cx, F - 1, lz, STONE);
  }

  // 10. The middle island: a small contested node ON the line rather than a
  //     plaza beside it — eleven blocks across, so the span still reads as one
  //     continuous route from base to base. Only the near half is authored;
  //     the mirror pass completes it rather than duplicating it. The shrine on
  //     it is an arch you RUN under: nothing here is ever a step to clear.
  for (let lz = 36; lz <= 39; lz++)
    for (let lx = cx - 5; lx <= cx + 5; lx++) {
      const edge = lx === cx - 5 || lx === cx + 5 || lz === 36;
      s.set(lx, F, lz, edge ? TRIM : ((lx >> 1) + (lz >> 1)) % 2 ? DECK : JADE);
    }
  s.fill(cx - 4, cx + 4, F - 1, F - 1, 36, 39, CORE);
  s.fill(cx - 3, cx + 3, F - 2, F - 2, 36, 39, CORE);
  s.fill(cx - 2, cx + 2, F - 4, F - 3, 37, 39, STONE);
  s.fill(cx - 1, cx + 1, F - 9, F - 5, 38, 39, PRISM);
  s.fill(cx, cx, F - 10, F - 10, 38, 39, GLOW);
  for (const ox of [cx - 3, cx + 3]) {
    s.fill(ox, ox, F + 1, F + 4, 37, 37, COLUMN);
    s.set(ox, F + 3, 37, TEAM);
    s.set(ox, F + 5, 37, LAMP);
  }
  s.fill(cx - 3, cx + 3, F + 5, F + 5, 39, 39, GOLD);
  for (const ox of [cx - 3, cx + 3]) s.fill(ox, ox, F + 1, F + 4, 39, 39, COLUMN);
  s.fill(cx - 1, cx + 1, F + 6, F + 6, 39, 39, GLOW);

  // 11. Carve the portal shaft before mirroring, so both sides lose the same
  //     columns and the lit keel becomes the landing pad.
  s.carve(g.minX, g.maxX - 1, F - 7, F, g.minZ, g.maxZ - 1);

  // 12. Reflect the crimson half onto the cobalt half.
  for (const [key, block] of [...s.blocks]) {
    const lx = key % BRIDGE_SIZE_X;
    const rest = (key - lx) / BRIDGE_SIZE_X;
    const lz = rest % BRIDGE_SIZE_Z;
    const y = (rest - lz) / BRIDGE_SIZE_Z + PARTY_STAMP_MIN_Y;
    if (lz > BRIDGE_MIRROR / 2) continue;
    s.set(lx, y, bridgeMirrorZ(lz), bridgeSwapTeam(block));
  }
  bridgeStampCache = s;
  return s;
}

/** Where seat `seat` of `team` stands, in venue-local blocks. Seat 0 is dead
 *  centre on the lane; a 1v1 never uses another. */
function bridgeLane(seat: number): number {
  return BRIDGE_LANE_X + (seat === 0 ? 0 : (seat % 2 ? 2 : -2) * Math.ceil(seat / 2));
}
/** Spawn pad for one seat on one team, in world coordinates. */
export function bridgeSpawn(sub: PartySubBounds, team: number, seat: number): PartyVec3 {
  const lz = team === 0 ? BRIDGE_SPAWN_Z : BRIDGE_SIZE_Z - BRIDGE_SPAWN_Z;
  return { x: sub.minX + bridgeLane(seat) + .5, y: PARTY_FLOOR_Y + 1.01, z: sub.minZ + lz };
}
/** Inside the drop cage over that same pad: where a round, and every restart
 *  after a goal, actually begins. */
export function bridgeCageSpawn(sub: PartySubBounds, team: number, seat: number): PartyVec3 {
  const spawn = bridgeSpawn(sub, team, seat);
  return { ...spawn, y: PARTY_FLOOR_Y + BRIDGE_CAGE_FLOOR + 1.01 };
}
/** Every block of hatch under both cages, in venue-local coordinates. The
 *  server is the only caller: it deletes these to drop both players onto their
 *  decks together, and puts them back the moment a goal restarts the round. */
export function bridgeCageHatch(): readonly { lx: number; y: number; lz: number }[] {
  const cells: { lx: number; y: number; lz: number }[] = [];
  for (let lz = CAGE_Z0 + 1; lz < CAGE_Z1; lz++)
    for (let lx = CAGE_X0 + 1; lx < CAGE_X1; lx++) {
      cells.push({ lx, y: PARTY_FLOOR_Y + BRIDGE_CAGE_FLOOR, lz });
      cells.push({ lx, y: PARTY_FLOOR_Y + BRIDGE_CAGE_FLOOR, lz: bridgeMirrorZ(lz) });
    }
  return cells;
}

/** Which portal, if any, contains this venue-local point below the deck lip. */
export function bridgeGoalAt(lx: number, y: number, lz: number): number | null {
  if (y >= PARTY_FLOOR_Y - .5) return null;
  for (const g of BRIDGE_GOALS)
    if (lx >= g.minX && lx < g.maxX && lz >= g.minZ && lz < g.maxZ) return g.team;
  return null;
}

/** True where no player-placed block is allowed: the mouth of either portal. */
export function bridgeGoalGuard(lx: number, lz: number): boolean {
  return BRIDGE_GOALS.some((g) =>
    lx >= g.minX - GOAL_GUARD && lx < g.maxX + GOAL_GUARD &&
    lz >= g.minZ - GOAL_GUARD && lz < g.maxZ + GOAL_GUARD);
}
