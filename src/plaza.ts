// FLAG PLAZA — the levelled monument ground under every faction's flag.
//
// The flag pole and the treasury ring (flags.ts / treasury.ts) stand at ONE
// fixed spot per faction, and until now they stood on whatever the heightmap
// happened to drop there: a lakeside step for Crimson, a four-block cliff
// through the pedestal ring for Azure, ice spikes growing out of the pad. Half
// the hoard floated, the other half was buried in a hillside.
//
// So the terrain gives the monument a site. Every flag home gets a flat, paved
// disc at ONE pad height with a graded rim back into the natural landscape, and
// nothing natural is generated on it — no trees, no clutter, no spikes, no
// ravine, no structure. The site is part of the HEIGHTMAP, which is what makes
// it work everywhere at once: the surface fill, the tree/decoration passes, the
// server's spawn search and the client's model ground probes all read the same
// `Terrain.height()`, so the pole, the strongbox and all eight pedestals land
// on the same level by construction rather than by luck.
//
// PURE + transport-agnostic (no THREE/DOM/Node): the server generates from it,
// every client generates from it, and they agree — same discipline as
// flags.ts / structures.ts.

import { Block } from './blocks';
import { flagHome } from './flags';
import { hash2 } from './noise';
import { FACTIONS } from './teams';
import { TREASURY_RING_RADIUS } from './treasury';

/** Radius (blocks) of the fully flat, paved court around a flag pole. Covers
 *  the treasury ring (3.4) and its reach (5) several times over, so the whole
 *  site you can walk up to and fight over is one level. */
export const PLAZA_FLAT = 12;
/** Width of the graded rim outside the court: the pad height ramps back to the
 *  natural surface over this many blocks, so a plaza never ends in a cliff. */
export const PLAZA_BLEND = 8;
/** Outer edge of any terrain shaping. */
export const PLAZA_EDGE = PLAZA_FLAT + PLAZA_BLEND;
/** Nothing natural GROWS inside this radius: trees, tall grass, flowers,
 *  cacti, hoodoos, ice spikes. Two blocks past the rim so the clearing does not
 *  stop exactly where the shaping does. */
export const PLAZA_CLEAR = PLAZA_EDGE + 2;

export interface PlazaHit {
  /** Which faction's monument this column belongs to. */
  faction: number;
  /** Distance in blocks from the flag pole. */
  d: number;
}

/** The flag pads, resolved once. Fixed for the life of the process — flagHome
 *  is a pure function of the faction table. */
const CENTRES = FACTIONS.map((f) => ({ faction: f.id, ...flagHome(f.id) }));

/**
 * The plaza this column falls inside (nearest pad within PLAZA_CLEAR), or null
 * for the overwhelming majority of the world. Called for EVERY generated
 * column, so it stays a couple of compares per pad: a square reject first, the
 * square root only for the handful of columns that actually hit.
 */
export function plazaAt(x: number, z: number): PlazaHit | null {
  for (const c of CENTRES) {
    const dx = x - c.x, dz = z - c.z;
    if (dx > PLAZA_CLEAR || dx < -PLAZA_CLEAR || dz > PLAZA_CLEAR || dz < -PLAZA_CLEAR) {
      continue;
    }
    const d2 = dx * dx + dz * dz;
    if (d2 <= PLAZA_CLEAR * PLAZA_CLEAR) {
      return { faction: c.faction, d: Math.sqrt(d2) };
    }
  }
  return null;
}

/** Blocks from (x, z) to the NEAREST flag pad — Infinity is never returned, so
 *  callers can compare against any radius they like (structures keep a wider
 *  berth than the clearing itself). */
export function plazaDistance(x: number, z: number): number {
  let best = Infinity;
  for (const c of CENTRES) {
    const d = Math.hypot(x - c.x, z - c.z);
    if (d < best) best = d;
  }
  return best;
}

/** Is this column inside a monument clearing (no natural growth allowed)? */
export function inPlazaClear(x: number, z: number): boolean {
  return plazaDistance(x, z) <= PLAZA_CLEAR;
}

/** How deep the paving's stone foundation runs under the court. Enough that
 *  digging into the rim shows a built platform, not two blocks of dirt. */
export const PLAZA_FOUNDATION = 5;

/**
 * The paving block for a court column at distance `d` from the pole. Three
 * deliberate bands so the site reads as BUILT from the ground: a stone apron
 * under the monument's footing, a cobble ring exactly where the treasury
 * pedestals stand, and a cobble kerb at the outer edge. Everything between is
 * stone with a seeded scatter of cobble so a 24-block disc doesn't read as one
 * flat grey sheet.
 */
export function plazaSurface(seed: number, x: number, z: number, d: number): number {
  if (d <= 2.0) return Block.Stone;                                   // pole apron
  if (Math.abs(d - TREASURY_RING_RADIUS) <= 0.9) return Block.Cobblestone; // hoard ring
  if (d >= PLAZA_FLAT - 1.5) return Block.Cobblestone;                // outer kerb
  return hash2(seed ^ 0x9143, x, z) < 0.12 ? Block.Cobblestone : Block.Stone;
}
