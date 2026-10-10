// Per-game rules shared by the menu and the server.

import { DUEL_CAPACITY, type DuelLobbySnapshot, type DuelParticipant } from './duels';
import { partyModeCapacity, type PartyLobbySnapshot, type PartyParticipant } from './partygames';
import { PARTY_MAX, type GameMode } from './net/protocol';

/** Most players a party may bring into one match of `mode`. Matchmaking is
 *  always 1v1 (two players); parties can bring more where the game allows.
 *  Rat and Seek takes a whole party: one seeker and up to three rats. */
export function partyCapacityFor(mode: GameMode): number {
  if (mode === 'ratseek' || mode === 'bedwars') return PARTY_MAX;
  return mode === 'duels' ? DUEL_CAPACITY : partyModeCapacity(mode, true);
}

/** Shared authoritative/predicted eligibility. Positions, range and held item
 * remain action-specific checks; spectators never get building or combat. */
export function canDuelAct(phase: DuelLobbySnapshot['phase'] | null, p: DuelParticipant | null | undefined): boolean {
  return (phase === 'running' || phase === 'sudden_death') && !!p?.connected && p.alive && !p.spectating;
}

export function canPartyAct(context: Pick<PartyLobbySnapshot, 'phase' | 'goalResetAt'> | null,
  p: PartyParticipant | null | undefined, now: number): boolean {
  return context?.phase === 'running' && !!p?.connected && !p.pendingSpawn && p.respawnAt === undefined &&
    p.outAt === undefined && p.finishedAt === undefined && now >= (context.goalResetAt ?? 0);
}
