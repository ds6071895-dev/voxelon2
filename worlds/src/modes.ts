// Per-game rules shared by the menu and the server.

import { DUEL_CAPACITY } from './duels';
import { partyModeCapacity } from './partygames';
import { PARTY_MAX, type GameMode } from './net/protocol';

/** Most players a party may bring into one match of `mode`. Matchmaking is
 *  always 1v1 (two players); parties can bring more where the game allows.
 *  Rat and Seek takes a whole party: one seeker and up to three rats. */
export function partyCapacityFor(mode: GameMode): number {
  if (mode === 'ratseek') return PARTY_MAX;
  return mode === 'duels' ? DUEL_CAPACITY : partyModeCapacity(mode, true);
}
