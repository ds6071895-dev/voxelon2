// Lever-triggered traps — PURE + transport-agnostic (like machines.ts): the
// lever/trap flip rules live here and are computed identically by the server
// (over its edit log — traps only ever exist as player edits) and the offline
// client (over the loaded world). A pull of a Lever toggles the lever itself
// plus every Fall/Wall Trap within LEVER_RADIUS blocks; other levers in range
// are deliberately NOT chain-flipped.

import { Block } from './blocks';

/** A lever pull toggles every linked trap within this many blocks (a cube). */
export const LEVER_RADIUS = 8;

export function isLeverBlock(id: number): boolean {
  return id === Block.Lever || id === Block.LeverOn;
}

/** The flipped state of a lever/trap block, or -1 if `id` doesn't flip. */
export function flippedTrap(id: number): number {
  switch (id) {
    case Block.Lever: return Block.LeverOn;
    case Block.LeverOn: return Block.Lever;
    case Block.FallTrap: return Block.FallTrapOpen;
    case Block.FallTrapOpen: return Block.FallTrap;
    case Block.WallTrap: return Block.WallTrapUp;
    case Block.WallTrapUp: return Block.WallTrap;
    default: return -1;
  }
}

export interface TrapFlip { x: number; y: number; z: number; block: number }

/** Every block write that pulling the lever at (x, y, z) causes: the lever's
 *  own toggle plus every trap block within LEVER_RADIUS. Empty if there is no
 *  lever at that cell (fail-closed — a forged pull flips nothing). */
export function leverFlips(
  getBlock: (x: number, y: number, z: number) => number,
  x: number, y: number, z: number,
): TrapFlip[] {
  if (!isLeverBlock(getBlock(x, y, z))) return [];
  const out: TrapFlip[] = [];
  for (let dx = -LEVER_RADIUS; dx <= LEVER_RADIUS; dx++) {
    for (let dy = -LEVER_RADIUS; dy <= LEVER_RADIUS; dy++) {
      for (let dz = -LEVER_RADIUS; dz <= LEVER_RADIUS; dz++) {
        const bx = x + dx, by = y + dy, bz = z + dz;
        if (by < 0 || by >= 256) continue;
        const id = getBlock(bx, by, bz);
        const isPulled = bx === x && by === y && bz === z;
        // One pull never chain-flips OTHER levers — only the pulled one.
        if (!isPulled && isLeverBlock(id)) continue;
        const flipped = flippedTrap(id);
        if (flipped >= 0) out.push({ x: bx, y: by, z: bz, block: flipped });
      }
    }
  }
  return out;
}
