// The minigame-only registry: ids that may exist inside a minigame arena and
// NOWHERE else. Pure — no DOM, no THREE, no Node.
//
// Two mechanisms keep these out of the open world, and they are deliberately
// different in kind:
//
//  1. Block-only ids (232-236) are registered in BLOCKS but NOT in ITEMS. That
//     alone is complete unobtainability: `dropFor` returns null, `interact.ts`
//     refuses to place them, the creative palette cannot list them, `/give`
//     cannot name them. This is the Block.Barrier pattern and it costs nothing.
//
//  2. Ids that players actually place or hold (the team wools, the party tiles,
//     the two arena weapons) NEED an item form, so mechanism 1 is unavailable.
//     Those are listed here, and every world-facing enumeration and economy
//     path consults `isMinigameOnly`.
//
// Adding an id to MINIGAME_ONLY is the whole opt-out. `minigame_isolation_smoke`
// asserts the consequences rather than trusting anyone to remember them.

import { Block } from './blocks';
import { MinigameItemId } from './minigame_item_ids';

/** Ids that exist ONLY inside a minigame arena. */
export const MINIGAME_ONLY: ReadonlySet<number> = new Set<number>([
  // Block-only fixtures. Listed even though the absent ITEMS entry already
  // hides them, so the belt-and-braces server checks (handleEdit, spawnItem,
  // chestSet) cover them too and no world cell can ever hold one.
  Block.BwBedA,
  Block.BwBedB,
  Block.BwGenerator,
  Block.BwShop,
  Block.ArenaRim,
  // Placeable arena blocks — these have an item form, so the gate is load-bearing.
  Block.TeamWoolA,
  Block.TeamWoolB,
  Block.PartyTileC,
  Block.PartyTileD,
  // Arena weapons. None may ever reach an open-world inventory: the Void
  // Cleaver and the Bridge Bow because hand-to-hand and arrow PvP exist only
  // inside The Bridge, the Knockback Stick because nothing in the world should
  // launch a player 9 m/s sideways.
  MinigameItemId.VoidCleaver,
  MinigameItemId.KnockbackStick,
  // The Bridge's bow and its arrows. Ranged PvP exists in exactly one venue.
  MinigameItemId.BridgeBow,
  MinigameItemId.BridgeArrow,
]);

export function isMinigameOnly(id: number): boolean {
  return MINIGAME_ONLY.has(id);
}

/** True if a stack-shaped value names a minigame-only id. Tolerant of the
 *  loosely-typed blobs that arrive from persistence and from clients. */
export function isMinigameStack(stack: unknown): boolean {
  if (!stack || typeof stack !== 'object') return false;
  const id = (stack as { id?: unknown }).id;
  return typeof id === 'number' && MINIGAME_ONLY.has(id);
}

/**
 * Remove every minigame-only stack from a persisted client-state blob.
 *
 * Persistence is the one path where an arena item could outlive the arena: a
 * mid-match capture, or a restore whose saved blob predates a crash. Slot
 * arrays keep their LENGTH and their indices — hotbar/armor positions are
 * meaningful — so an offending stack becomes `null` rather than being spliced
 * out and shifting everything after it.
 *
 * Returns a new object; the input is never mutated.
 */
export function stripMinigameItems(
  state: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...state };
  for (const key of Object.keys(out)) {
    const value = out[key];
    if (!Array.isArray(value)) continue;
    if (!value.some(isMinigameStack)) continue;
    out[key] = value.map((entry) => (isMinigameStack(entry) ? null : entry));
  }
  return out;
}
