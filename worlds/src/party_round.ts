// Shared state contract for mode-owned decisions. Imports of the public
// snapshot model are type-only, so geometry never loads the lobby engine.
import type { PartyLobbySnapshot, PartyParticipant, PartyResult } from './partygames';

export interface PartyRoundContext extends Pick<PartyLobbySnapshot,
  'mode' | 'phase' | 'round' | 'arena' | 'dragon' | 'goalResetAt' | 'lastGoal' | 'lastKill' | 'teamScores'> {
  participants: Map<number, PartyParticipant>;
}
export type EndPartyRound = (now: number) => void;

export function partyTeamScores(participants: Iterable<PartyParticipant>): [number, number] {
  const scores: [number, number] = [0, 0];
  for (const p of participants) scores[p.team] += p.score;
  return scores;
}

export function copyPartyParticipant(p: PartyParticipant): PartyParticipant {
  return { ...p, lastLife: p.lastLife ? { ...p.lastLife } : undefined };
}

export function copyPartyResult(result: PartyResult): PartyResult {
  return {
    ...result, teamScores: [...result.teamScores],
    scoreboard: result.scoreboard.map(copyPartyParticipant),
    runners: result.runners?.map((runner) => ({ ...runner })),
  };
}
