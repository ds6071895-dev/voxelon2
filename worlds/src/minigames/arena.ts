// What a Party Games arena is (source Arena): built once from its static
// `build`, with `layer` (the parts a round changes) on top. Every arena is
// its own world here: local (0, 0, 0) sits at world (0, BASE_Y, 0), so the
// source's coordinates port unchanged.

import type { StampBounds, VenueStamp } from '../vanilla/stamp';
import type { Deco } from '../vanilla/deco';

export const BASE_Y = 100;
/** Local box every arena builds inside (the world's bounds). */
export const ARENA_BOX = { minX: -48, maxX: 48, minY: -40, maxY: 40, minZ: -48, maxZ: 48 };

export interface ArenaDef {
  id: string;
  version?: number;
  bounds?: StampBounds;
  stamp?: VenueStamp;
  build(d: Deco): void;
  layer?(d: Deco): void;
}

/** java.lang.String.hashCode. */
export function javaHash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
  return h;
}
/** Arena.seed(): id.hashCode() * 31L + version. */
export function arenaSeed(def: ArenaDef): bigint {
  return BigInt(javaHash(def.id)) * 31n + BigInt(def.version ?? 1);
}
