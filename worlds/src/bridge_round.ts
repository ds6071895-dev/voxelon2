// Bridge decisions mutate round state; world edits and synchronization stay with the server.
import { bridgeCageSpawn, bridgeGoalAt, bridgeSpawn } from './bridge_geometry';
import { BRIDGE_GOAL_LIMIT, BRIDGE_GOAL_RESET_MS, BRIDGE_RESPAWN_SHIELD_MS, BRIDGE_RESPAWN_DELAY_MS, BRIDGE_KILL_CREDIT_MS } from './bridge_rules';
import { PARTY_VOID_Y } from './venue_dims';
import { partyTeamScores, type PartyRoundContext, type EndPartyRound } from './party_round';
import type { PartyParticipant, PartySubBounds } from './partygames';
import type { PartyVec3 } from './party_math';

export function evaluateBridge(l: PartyRoundContext, p: PartyParticipant, sub: PartySubBounds, pos: PartyVec3, now: number, endMatch: EndPartyRound):
  { spawn?: PartyVec3; changed: boolean; killedBy?: number } {
  const seat = [...l.participants.values()].filter((v) => v.team === p.team && v.joinOrder < p.joinOrder).length;
  // A goal puts everybody back in a cage; an ordinary void death just puts
  // you back on your own deck, with no pause in the game for anyone else.
  const home = (): { spawn: PartyVec3; changed: boolean } => {
    const caged = l.goalResetAt !== undefined && now < l.goalResetAt;
    p.pendingSpawn = false;
    p.respawnAt = undefined;
    // A caged player's shield starts when the hatch does, so nobody lands
    // out of one straight into a waiting axe.
    p.immuneUntil = (caged ? l.goalResetAt! : now) + BRIDGE_RESPAWN_SHIELD_MS;
    return {
      spawn: caged ? bridgeCageSpawn(sub, p.team, seat) : bridgeSpawn(sub, p.team, seat),
      changed: true,
    };
  };
  if (p.pendingSpawn) return home();
  // Dead: spectate until the timer runs out. No goals, no void, no fights.
  if (p.respawnAt !== undefined) return now >= p.respawnAt ? home() : { changed: false };
  const lx = Math.floor(pos.x - sub.minX), lz = Math.floor(pos.z - sub.minZ);
  const goal = bridgeGoalAt(lx, pos.y, lz);
  if (goal !== null) {
    // Your own portal is a hole, not a target: you get fished out of it.
    if (goal === p.team) { p.falls++; return home(); }
    p.score++;
    l.teamScores = partyTeamScores(l.participants.values());
    l.goalResetAt = now + BRIDGE_GOAL_RESET_MS;
    l.lastGoal = { id: p.id, username: p.username, team: p.team, at: now };
    for (const v of l.participants.values()) if (v.connected) v.pendingSpawn = true;
    if (l.teamScores[p.team] >= BRIDGE_GOAL_LIMIT) {
      endMatch(now);
      return { changed: true };
    }
    return home();
  }
  if (pos.y < PARTY_VOID_Y) {
    p.falls++;
    p.deaths++;
    // Knocking somebody off the span is the mode's signature kill, so a
    // recent hit still owns the fall that follows it.
    const killer = p.lastHitBy !== undefined && now - p.lastHitAt <= BRIDGE_KILL_CREDIT_MS
      ? l.participants.get(p.lastHitBy) : undefined;
    if (killer && killer.team !== p.team) {
      killer.kills++;
      l.lastKill = { id: killer.id, username: killer.username, victim: p.username, team: killer.team, at: now, cause: 'void' };
    }
    p.lastHitBy = undefined;
    p.respawnAt = now + BRIDGE_RESPAWN_DELAY_MS;
    return { changed: true, killedBy: killer && killer.team !== p.team ? killer.id : undefined };
  }
  return { changed: false };
}
