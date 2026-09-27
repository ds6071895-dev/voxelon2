// Per-game rules shared by the menu and the server.

import { DUEL_CAPACITY } from './duels';
import { partyModeCapacity } from './partygames';
import type { GameMode } from './net/protocol';

/** Most players a party may bring into one match of `mode`. Matchmaking is
 *  always 1v1 (two players); parties can bring more where the game allows. */
export function partyCapacityFor(mode: GameMode): number {
  return mode === 'duels' ? DUEL_CAPACITY : partyModeCapacity(mode, true);
}
