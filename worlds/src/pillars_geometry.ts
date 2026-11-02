// Lucky Pillars' world: bedrock pillars on a ring around a bedrock crown
// topped by an unbreakable gold block, in the void. Everything the generator
// needs is packed into the world seed (layout, players, rotation), so client
// and server build the same arena. Imported by both sides.

import { Block } from './blocks';
import { VenueGenerator, registerWorldKind } from './multiverse';
import { LP, lpPillars, lpUnseed, type LpPillar } from './pillars_rules';
import { VB } from './vanilla/blocks';

export const LP_BOUNDS = { minX: -LP.SWEEP_RADIUS, maxX: LP.SWEEP_RADIUS + 1, minZ: -LP.SWEEP_RADIUS, maxZ: LP.SWEEP_RADIUS + 1 };
export const LP_MIN_Y = LP.BOTTOM_Y - 20;
export const LP_MAX_Y = LP.MAX_BUILD_Y + 6;
export const CROWN_Y = LP.TOP_Y + LP.CROWN_RISE;

export function lpArenaPillars(seed: number): LpPillar[] {
  const s = lpUnseed(seed);
  return lpPillars(s.layout, s.players, s.angle);
}

registerWorldKind('pillars', (seed) => {
  const pillars = lpArenaPillars(seed);
  const columns = new Map<number, number>();
  for (const p of pillars) columns.set(p.x * 4096 + p.z, p.topY);
  return new VenueGenerator(seed, LP_BOUNDS, LP_MIN_Y, LP_MAX_Y, (x, y, z) => {
    if (x === 0 && z === 0) {
      if (y >= LP.BOTTOM_Y && y < CROWN_Y) return VB.bedrock;
      if (y === CROWN_Y) return VB.gold_block;
      return Block.Air;
    }
    const top = columns.get(x * 4096 + z);
    return top !== undefined && y >= LP.BOTTOM_Y && y <= top ? VB.bedrock : Block.Air;
  }, { grass: [.55, .74, .42], foliage: [.4, .65, .3], water: [.25, .46, .89] });
});
