// Pure, shared Duels domain model. This file deliberately has no DOM or Node
// dependencies so the browser, authoritative server, and tests all use the
// same clocks, score ordering, arena geometry, and match rules.
//
// Every Duels match is played in a world of its own (see multiverse.ts), so
// the colosseum is authored once at that world's origin. There are no arena
// slots and no cap on how many matches can run at the same time.

import { duelArenaBounds, type DuelArenaBounds } from './duel_geometry';
export { DUEL_ARENA_SIZE, DUEL_ARENA_FLOOR_Y, duelTerrainElevation, duelArenaBlockAt,
  clampToDuelArena, hasArenaLineOfSight, safestDuelSpawn } from './duel_geometry';
export type { DuelVec3, DuelArenaBounds } from './duel_geometry';

type DuelPhase = 'lobby' | 'countdown' | 'running' | 'sudden_death' | 'results';
type DuelFinishReason = 'time' | 'score' | 'sudden_death' | 'forfeit' | 'cancelled';

/** Announcer beats. The server derives these from the authoritative kill feed
 * so every client shows the same call at the same moment. */
export type DuelEventKind =
  | 'first_blood' | 'double_kill' | 'triple_kill' | 'quad_kill'
  | 'spree' | 'rampage' | 'unstoppable' | 'godlike'
  | 'shutdown' | 'revenge' | 'match_point';

export interface DuelEvent {
  /** Monotonic per-lobby id. Clients play each beat exactly once. */
  seq: number;
  kind: DuelEventKind;
  actor: number;
  actorName: string;
  victim: number;
  victimName: string;
  /** Streak length or multi-kill size, whichever the beat is about. */
  count: number;
}

/** Consecutive kills land as one multi-kill while they stay inside this gap. */
const DUEL_MULTI_KILL_MS = 8_000;
/** Killing spree thresholds, in kills without dying. */
const DUEL_SPREE_STEPS: readonly { at: number; kind: DuelEventKind }[] = [
  { at: 3, kind: 'spree' }, { at: 5, kind: 'rampage' },
  { at: 7, kind: 'unstoppable' }, { at: 10, kind: 'godlike' },
];
/** Reaching this many kills wins the round outright, before the clock. */
export const DUEL_SCORE_LIMIT = 15;
/** How many announcer beats a snapshot carries back. */
const DUEL_FEED_LENGTH = 6;

const DUEL_EVENT_COPY: Record<DuelEventKind, { title: string; sub: (e: DuelEvent) => string }> = {
  first_blood: { title: 'FIRST BLOOD', sub: (e) => `${e.actorName} drew it` },
  double_kill: { title: 'DOUBLE KILL', sub: (e) => `${e.actorName} \u00d72` },
  triple_kill: { title: 'TRIPLE KILL', sub: (e) => `${e.actorName} \u00d73` },
  quad_kill: { title: 'QUAD KILL', sub: (e) => `${e.actorName} \u00d74` },
  spree: { title: 'KILLING SPREE', sub: (e) => `${e.actorName} on ${e.count}` },
  rampage: { title: 'RAMPAGE', sub: (e) => `${e.actorName} on ${e.count}` },
  unstoppable: { title: 'UNSTOPPABLE', sub: (e) => `${e.actorName} on ${e.count}` },
  godlike: { title: 'GODLIKE', sub: (e) => `${e.actorName} on ${e.count}` },
  shutdown: { title: 'SHUTDOWN', sub: (e) => `${e.actorName} ended ${e.victimName}` },
  revenge: { title: 'REVENGE', sub: (e) => `${e.actorName} paid ${e.victimName} back` },
  match_point: { title: 'MATCH POINT', sub: (e) => `${e.actorName} needs one more` },
};

/** Presentation text for an announcer beat. Pure so the banner, the kill feed
 * and the smoke tests never drift apart. */
export function duelEventCopy(event: DuelEvent): { title: string; sub: string } {
  const copy = DUEL_EVENT_COPY[event.kind];
  return { title: copy.title, sub: copy.sub(event) };
}

/** Which announcer beats a single kill produces, most important last (the
 * client banners the last one and files the rest into the feed). */
function duelKillEvents(state: {
  firstKillOfMatch: boolean;
  /** Killer's kills-without-dying AFTER this kill. */
  killerSpree: number;
  /** Victim's kills-without-dying BEFORE they died. */
  victimSpree: number;
  /** Kills the killer has landed inside the multi-kill window, this one included. */
  multi: number;
  /** The victim was the killer's most recent killer. */
  revenge: boolean;
  /** Killer's total kills AFTER this kill. */
  killerScore: number;
}): DuelEventKind[] {
  const beats: DuelEventKind[] = [];
  if (state.firstKillOfMatch) beats.push('first_blood');
  if (state.revenge) beats.push('revenge');
  if (state.victimSpree >= DUEL_SPREE_STEPS[0].at) beats.push('shutdown');
  const spree = [...DUEL_SPREE_STEPS].reverse().find((step) => step.at === state.killerSpree);
  if (spree) beats.push(spree.kind);
  if (state.multi === 2) beats.push('double_kill');
  else if (state.multi === 3) beats.push('triple_kill');
  else if (state.multi >= 4) beats.push('quad_kill');
  if (state.killerScore === DUEL_SCORE_LIMIT - 1) beats.push('match_point');
  return beats;
}

const DUEL_MIN_PLAYERS = 2;
export const DUEL_CAPACITY = 4;
const DUEL_COUNTDOWN_MS = 3_000;
const DUEL_ARENA_LOAD_TIMEOUT_MS = 30_000;
export const DUEL_ROUND_MS = 5 * 60_000;
const DUEL_RESPAWN_MS = 3_000;
const DUEL_SPAWN_SHIELD_MS = 1_250;
// The results screen plays a rank-reveal animation before the vote buttons are
// worth reading. Fifteen seconds meant the window could close while the RP was
// still counting up, so "Run it back" regularly expired unanswered.
const DUEL_REMATCH_MS = 30_000;
export const DUEL_MAX_HEALTH = 40;
export const DUEL_MAX_PILLAR_HEIGHT = 7;

export interface DuelParticipant {
  id: number;
  username: string;
  skin: number;
  ready: boolean;
  connected: boolean;
  kills: number;
  deaths: number;
  alive: boolean;
  spectating: boolean;
  /** Stable lobby order, used as the final scoreboard tie-break. */
  joinOrder: number;
  respawnAt?: number;
  shieldUntil?: number;
  /** Kills since last death; the number the announcer shouts about. */
  spree: number;
  /** Best spree this round, kept on the final scoreboard. */
  bestSpree: number;
  /** Kills inside the live multi-kill window, and when it closes. */
  multi: number;
  multiUntil: number;
  /** Who killed this player last, so a payback reads as Revenge. */
  lastKilledBy: number;
}

export interface DuelResult {
  winner: number | null;
  scoreboard: DuelParticipant[];
  /** Everything the announcer called this round, for the result recap. */
  feed: DuelEvent[];
  finishReason: DuelFinishReason;
  durationMs: number;
  rematchDeadline: number;
}

export interface DuelLobbySnapshot {
  /** Public display id. Invite tokens are never included in snapshots/logs. */
  id: string;
  phase: DuelPhase;
  participants: DuelParticipant[];
  serverNow: number;
  countdownEndsAt?: number;
  startedAt?: number;
  endsAt?: number;
  arena?: DuelArenaBounds;
  /** Announcer beats, oldest first. Clients replay anything above the last
   * `seq` they have seen, so a dropped frame never loses a call. */
  feed: DuelEvent[];
  result?: DuelResult;
}

type DuelJoinFailure = 'invalid' | 'full' | 'match_in_progress' | 'already_in_lobby';
type DuelStartFailure = 'not_host' | 'too_few_players' | 'too_many_players' | 'not_everyone_ready' | 'not_in_lobby';

function orderDuelScore(a: DuelParticipant, b: DuelParticipant): number {
  return b.kills - a.kills || a.deaths - b.deaths || a.joinOrder - b.joinOrder;
}

function orderedDuelScoreboard(players: Iterable<DuelParticipant>): DuelParticipant[] {
  return [...players].map((p) => ({ ...p })).sort(orderDuelScore);
}

interface DuelLobby {
  id: string;
  token: string;
  phase: DuelPhase;
  participants: Map<number, DuelParticipant>;
  host: number;
  nextJoinOrder: number;
  countdownEndsAt?: number;
  arenaLoadDeadline?: number;
  arenaReady?: Set<number>;
  startedAt?: number;
  endsAt?: number;
  arena?: DuelArenaBounds;
  feed: DuelEvent[];
  nextEventSeq: number;
  firstBloodTaken: boolean;
  result?: DuelResult;
}

interface DuelIdentity { id: number; username: string; skin: number }

interface DuelCreateResult { token: string; snapshot: DuelLobbySnapshot }
type DuelJoinResult =
  | { ok: true; snapshot: DuelLobbySnapshot }
  | { ok: false; reason: DuelJoinFailure };

/** 192 bits of browser/Node WebCrypto entropy, encoded without punctuation so
 * invite links remain portable. There is intentionally no Math.random fallback. */
export function secureDuelToken(): string {
  const bytes = new Uint8Array(24);
  const cryptoApi = globalThis.crypto;
  if (!cryptoApi?.getRandomValues) throw new Error('Secure random source unavailable');
  cryptoApi.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export class Duels {
  private readonly lobbies = new Map<string, DuelLobby>();
  private readonly lobbyById = new Map<string, DuelLobby>();
  private readonly lobbyByPlayer = new Map<number, DuelLobby>();
  private nextLobbyId = 1;

  constructor(private readonly tokenFactory: () => string) {}

  /** Atomic server launch. Invalid rosters never claim a player or leave a lobby. */
  startMatch(identities: readonly DuelIdentity[], now: number):
    { ok: true; snapshot: DuelLobbySnapshot } | { ok: false; reason: 'invalid_roster' | 'already_in_lobby' } {
    if (identities.length < DUEL_MIN_PLAYERS || identities.length > DUEL_CAPACITY ||
        new Set(identities.map((p) => p.id)).size !== identities.length) return { ok: false, reason: 'invalid_roster' };
    if (identities.some((p) => this.lobbyByPlayer.has(p.id))) return { ok: false, reason: 'already_in_lobby' };
    const id = `D${this.nextLobbyId++}`;
    const participants = new Map(identities.map((identity, order) => {
      const p = this.newParticipant(identity, order); p.ready = true;
      return [p.id, p] as const;
    }));
    const lobby: DuelLobby = {
      id, token: `match:${id}`, phase: 'lobby', participants, host: identities[0].id,
      nextJoinOrder: identities.length, feed: [], nextEventSeq: 1, firstBloodTaken: false,
    };
    this.beginCountdown(lobby, now);
    this.lobbies.set(lobby.token, lobby);
    this.lobbyById.set(id, lobby);
    for (const identity of identities) this.lobbyByPlayer.set(identity.id, lobby);
    return { ok: true, snapshot: this.snapshotLobby(lobby, now) };
  }

  create(identity: DuelIdentity, now: number): DuelCreateResult | { reason: 'already_in_lobby' } {
    if (this.lobbyByPlayer.has(identity.id)) return { reason: 'already_in_lobby' };
    let token = '';
    do token = this.tokenFactory(); while (!token || token.length < 24 || this.lobbies.has(token));
    const p = this.newParticipant(identity, 0);
    const lobby: DuelLobby = {
      id: `D${this.nextLobbyId++}`, token, phase: 'lobby', participants: new Map([[p.id, p]]),
      host: p.id, nextJoinOrder: 1, feed: [], nextEventSeq: 1, firstBloodTaken: false,
    };
    this.lobbies.set(token, lobby);
    this.lobbyById.set(lobby.id, lobby);
    this.lobbyByPlayer.set(p.id, lobby);
    return { token, snapshot: this.snapshotLobby(lobby, now) };
  }

  join(token: string, identity: DuelIdentity, now: number): DuelJoinResult {
    if (this.lobbyByPlayer.has(identity.id)) return { ok: false, reason: 'already_in_lobby' };
    const lobby = this.lobbies.get(token);
    if (!lobby) return { ok: false, reason: 'invalid' };
    if (lobby.phase !== 'lobby') return { ok: false, reason: 'match_in_progress' };
    if (lobby.participants.size >= DUEL_CAPACITY) return { ok: false, reason: 'full' };
    this.resetReady(lobby);
    const p = this.newParticipant(identity, lobby.nextJoinOrder++);
    lobby.participants.set(p.id, p);
    this.lobbyByPlayer.set(p.id, lobby);
    return { ok: true, snapshot: this.snapshotLobby(lobby, now) };
  }

  /** Take a player out of their lobby. Returns the lobby as it now stands, or
   *  undefined when there was none or it emptied and was deleted. */
  leave(playerId: number, now: number): DuelLobbySnapshot | undefined {
    const lobby = this.lobbyByPlayer.get(playerId);
    if (!lobby) return undefined;
    const live = lobby.phase === 'running' || lobby.phase === 'sudden_death';
    const leaving = lobby.participants.get(playerId);
    this.lobbyByPlayer.delete(playerId);
    if (live && leaving) {
      // Keep a disconnected combatant on the final board, so the scoreboard
      // still shows who left. They are removed when the room returns to lobby.
      leaving.connected = false; leaving.alive = false; leaving.spectating = true;
      leaving.respawnAt = undefined;
    } else {
      lobby.participants.delete(playerId);
    }
    lobby.arenaReady?.delete(playerId);
    if (![...lobby.participants.values()].some(p => p.connected)) {
      this.releaseArena(lobby);
      this.lobbies.delete(lobby.token);
      this.lobbyById.delete(lobby.id);
      return undefined;
    }
    if (lobby.host === playerId) {
      const next = [...lobby.participants.values()].filter((p) => p.connected)
        .sort((a, b) => a.joinOrder - b.joinOrder)[0];
      if (!next) return this.snapshotLobby(lobby, now);
      lobby.host = next.id;
    }
    if (lobby.phase === 'lobby') this.resetReady(lobby);
    else if (lobby.phase === 'running' || lobby.phase === 'sudden_death' || lobby.phase === 'countdown') {
      const connected = [...lobby.participants.values()].filter((p) => p.connected);
      if (connected.length === 1) this.finish(lobby, now, connected[0].id, 'forfeit');
      else this.tryArmCountdown(lobby, now);
    } else if (lobby.phase === 'results') {
      this.returnToLobby(lobby);
    }
    return this.snapshotLobby(lobby, now);
  }

  setReady(playerId: number, ready: boolean, now: number): DuelLobbySnapshot | null {
    const lobby = this.lobbyByPlayer.get(playerId);
    const p = lobby?.participants.get(playerId);
    if (!lobby || !p || lobby.phase !== 'lobby') return null;
    p.ready = ready;
    return this.snapshotLobby(lobby, now);
  }

  start(playerId: number, now: number): { ok: true; snapshot: DuelLobbySnapshot } | { ok: false; reason: DuelStartFailure } {
    const lobby = this.lobbyByPlayer.get(playerId);
    if (!lobby || lobby.phase !== 'lobby') return { ok: false, reason: 'not_in_lobby' };
    if (lobby.host !== playerId) return { ok: false, reason: 'not_host' };
    if (lobby.participants.size < DUEL_MIN_PLAYERS) return { ok: false, reason: 'too_few_players' };
    if (lobby.participants.size > DUEL_CAPACITY) return { ok: false, reason: 'too_many_players' };
    if ([...lobby.participants.values()].some((p) => !p.connected || !p.ready)) {
      return { ok: false, reason: 'not_everyone_ready' };
    }
    this.beginCountdown(lobby, now);
    return { ok: true, snapshot: this.snapshotLobby(lobby, now) };
  }

  /** Mark one client's deterministic arena stream complete. The visible
   * three-second countdown is armed only after every current member is ready. */
  markArenaReady(playerId: number, now: number): DuelLobbySnapshot | null {
    const lobby = this.lobbyByPlayer.get(playerId);
    if (!lobby || lobby.phase !== 'countdown' || lobby.countdownEndsAt !== undefined) return null;
    lobby.arenaReady?.add(playerId);
    this.tryArmCountdown(lobby, now);
    return this.snapshotLobby(lobby, now);
  }

  recordDeath(victimId: number, killerId: number, now: number): DuelLobbySnapshot | null {
    const lobby = this.lobbyByPlayer.get(victimId);
    if (!lobby || (lobby.phase !== 'running' && lobby.phase !== 'sudden_death')) return null;
    const victim = lobby.participants.get(victimId), killer = lobby.participants.get(killerId);
    if (!victim || !killer || victim.id === killer.id || !victim.alive || !killer.alive) return null;
    victim.deaths++;
    killer.kills++;
    victim.alive = false;
    victim.spectating = true;
    victim.respawnAt = now + DUEL_RESPAWN_MS;
    victim.shieldUntil = undefined;

    // Announcer bookkeeping. All of it lives on the authoritative participant
    // records, so a reconnecting client inherits the same streak state.
    killer.multi = now < killer.multiUntil ? killer.multi + 1 : 1;
    killer.multiUntil = now + DUEL_MULTI_KILL_MS;
    killer.spree++;
    killer.bestSpree = Math.max(killer.bestSpree, killer.spree);
    const victimSpree = victim.spree;
    victim.spree = 0; victim.multi = 0; victim.multiUntil = 0;
    const revenge = killer.lastKilledBy === victim.id;
    victim.lastKilledBy = killer.id;
    const firstKillOfMatch = !lobby.firstBloodTaken;
    lobby.firstBloodTaken = true;
    for (const kind of duelKillEvents({
      firstKillOfMatch, killerSpree: killer.spree, victimSpree,
      multi: killer.multi, revenge, killerScore: killer.kills,
    })) {
      lobby.feed.push({ seq: lobby.nextEventSeq++, kind, actor: killer.id,
        actorName: killer.username, victim: victim.id, victimName: victim.username,
        count: kind === 'double_kill' || kind === 'triple_kill' || kind === 'quad_kill'
          ? killer.multi : killer.spree });
    }
    if (lobby.feed.length > DUEL_FEED_LENGTH) lobby.feed.splice(0, lobby.feed.length - DUEL_FEED_LENGTH);

    if (lobby.phase === 'sudden_death') this.finish(lobby, now, killer.id, 'sudden_death');
    else if (killer.kills >= DUEL_SCORE_LIMIT) this.finish(lobby, now, killer.id, 'score');
    return this.snapshotLobby(lobby, now);
  }

  removeSpawnShield(playerId: number): void {
    const p = this.lobbyByPlayer.get(playerId)?.participants.get(playerId);
    if (p) p.shieldUntil = undefined;
  }

  tick(now: number): DuelLobbySnapshot[] {
    const changed: DuelLobbySnapshot[] = [];
    for (const lobby of this.lobbies.values()) {
      let dirty = false;
      if (lobby.phase === 'countdown' && lobby.countdownEndsAt === undefined &&
          now >= (lobby.arenaLoadDeadline ?? Infinity)) {
        this.returnToLobby(lobby); dirty = true;
      }
      if (lobby.phase === 'countdown' && now >= (lobby.countdownEndsAt ?? Infinity)) {
        lobby.phase = 'running';
        lobby.startedAt = lobby.countdownEndsAt;
        lobby.endsAt = (lobby.startedAt ?? now) + DUEL_ROUND_MS;
        dirty = true;
      }
      if (lobby.phase === 'running' && now >= (lobby.endsAt ?? Infinity)) {
        const board = orderedDuelScoreboard([...lobby.participants.values()].filter((p) => p.connected));
        const leaders = board.filter((p) => p.kills === board[0]?.kills);
        if (leaders.length === 1) this.finish(lobby, now, leaders[0].id, 'time');
        else {
          lobby.phase = 'sudden_death';
          const ids = new Set(leaders.map((p) => p.id));
          for (const p of lobby.participants.values()) {
            if (!ids.has(p.id)) {
              p.spectating = true; p.alive = false; p.respawnAt = undefined;
            }
            // A tied leader already waiting to respawn keeps that timer. Live
            // leaders remain live; neither gets a free state change at 0:00.
          }
        }
        dirty = true;
      }
      if (lobby.phase === 'running' || lobby.phase === 'sudden_death') {
        for (const p of lobby.participants.values()) {
          if (p.connected && !p.alive && p.respawnAt !== undefined && now >= p.respawnAt) {
            p.alive = true; p.spectating = false; p.respawnAt = undefined;
            p.shieldUntil = now + DUEL_SPAWN_SHIELD_MS; dirty = true;
          }
        }
      }
      if (lobby.phase === 'results' && now >= (lobby.result?.rematchDeadline ?? Infinity)) {
        this.returnToLobby(lobby); dirty = true;
      }
      if (dirty) changed.push(this.snapshotLobby(lobby, now));
    }
    return changed;
  }

  snapshotFor(playerId: number, now: number): DuelLobbySnapshot | null {
    const lobby = this.lobbyByPlayer.get(playerId);
    return lobby ? this.snapshotLobby(lobby, now) : null;
  }

  snapshotById(id: string, now: number): DuelLobbySnapshot | null {
    const lobby = this.lobbyById.get(id);
    return lobby ? this.snapshotLobby(lobby, now) : null;
  }
  phaseById(id: string): DuelPhase | null { return this.lobbyById.get(id)?.phase ?? null; }

  /** Safe snapshots for server fan-out. Tokens remain private and are never
   * present in this representation. */
  snapshots(now: number): DuelLobbySnapshot[] {
    return [...this.lobbies.values()].map((lobby) => this.snapshotLobby(lobby, now));
  }
  arenaFor(playerId: number): DuelArenaBounds | null { return this.lobbyByPlayer.get(playerId)?.arena ?? null; }
  phaseFor(playerId: number): DuelPhase | null { return this.lobbyByPlayer.get(playerId)?.phase ?? null; }
  participantFor(playerId: number): DuelParticipant | null {
    return this.lobbyByPlayer.get(playerId)?.participants.get(playerId) ?? null;
  }
  membersOf(playerId: number): number[] {
    return [...(this.lobbyByPlayer.get(playerId)?.participants.values() ?? [])].filter(p=>p.connected).map(p=>p.id);
  }
  sameMatch(a: number, b: number): boolean {
    const lobby = this.lobbyByPlayer.get(a);
    return !!lobby && lobby === this.lobbyByPlayer.get(b) &&
      (lobby.phase === 'running' || lobby.phase === 'sudden_death');
  }

  private newParticipant(identity: DuelIdentity, joinOrder: number): DuelParticipant {
    return { ...identity, ready: false, connected: true, kills: 0, deaths: 0,
      alive: true, spectating: false, joinOrder,
      spree: 0, bestSpree: 0, multi: 0, multiUntil: 0, lastKilledBy: 0 };
  }

  private resetReady(lobby: DuelLobby): void {
    for (const p of lobby.participants.values()) p.ready = false;
  }

  private releaseArena(lobby: DuelLobby): void {
    lobby.arena = undefined;
  }

  /** Every match gets a world of its own, so there is always an arena. */
  private beginCountdown(lobby: DuelLobby, now: number): void {
    if (!lobby.arena) lobby.arena = duelArenaBounds();
    lobby.phase = 'countdown'; lobby.countdownEndsAt = undefined;
    lobby.arenaReady = new Set();
    lobby.arenaLoadDeadline = now + DUEL_ARENA_LOAD_TIMEOUT_MS;
    lobby.startedAt = undefined; lobby.endsAt = undefined; lobby.result = undefined;
    lobby.feed = []; lobby.firstBloodTaken = false;
    for (const p of lobby.participants.values()) {
      p.kills = 0; p.deaths = 0; p.alive = true; p.spectating = false;
      p.respawnAt = undefined; p.shieldUntil = undefined;
      p.spree = 0; p.bestSpree = 0; p.multi = 0; p.multiUntil = 0; p.lastKilledBy = 0;
    }
  }

  private tryArmCountdown(lobby: DuelLobby, now: number): void {
    if (lobby.phase !== 'countdown' || lobby.countdownEndsAt !== undefined ||
        !lobby.arenaReady || lobby.participants.size < DUEL_MIN_PLAYERS) return;
    if ([...lobby.participants.keys()].some((id) => !lobby.arenaReady!.has(id))) return;
    lobby.countdownEndsAt = now + DUEL_COUNTDOWN_MS;
    lobby.arenaLoadDeadline = undefined;
    for (const p of lobby.participants.values()) p.shieldUntil = lobby.countdownEndsAt;
  }

  private finish(lobby: DuelLobby, now: number, winner: number | null, reason: DuelFinishReason): void {
    lobby.phase = 'results';
    for (const p of lobby.participants.values()) {
      p.alive = false; p.spectating = true; p.respawnAt = undefined; p.shieldUntil = undefined;
    }
    const scoreboard = orderedDuelScoreboard(lobby.participants.values());
    // Every disconnect is a forfeit placement even if the remaining players
    // continue to regulation time. The combatant stays visible on the board,
    // but can never preserve a high-kill finish by leaving early.
    scoreboard.sort((a, b) => Number(b.connected) - Number(a.connected) || orderDuelScore(a, b));
    if (winner !== null) {
      const winnerIndex = scoreboard.findIndex((p) => p.id === winner);
      if (winnerIndex > 0) scoreboard.unshift(scoreboard.splice(winnerIndex, 1)[0]);
    }
    lobby.result = { winner, scoreboard, feed: lobby.feed.map((event) => ({ ...event })),
      finishReason: reason, durationMs: Math.max(0, now - (lobby.startedAt ?? now)),
      rematchDeadline: now + DUEL_REMATCH_MS };
  }

  private returnToLobby(lobby: DuelLobby): void {
    lobby.phase = 'lobby'; lobby.countdownEndsAt = undefined; lobby.startedAt = undefined;
    lobby.endsAt = undefined; lobby.arenaReady = undefined; lobby.arenaLoadDeadline = undefined;
    lobby.result = undefined; this.releaseArena(lobby);
    for (const [id, participant] of lobby.participants) {
      if (!participant.connected) lobby.participants.delete(id);
    }
    lobby.feed = []; lobby.firstBloodTaken = false;
    for (const p of lobby.participants.values()) {
      p.ready = false; p.kills = 0; p.deaths = 0; p.alive = true; p.spectating = false;
      p.respawnAt = undefined; p.shieldUntil = undefined;
      p.spree = 0; p.bestSpree = 0; p.multi = 0; p.multiUntil = 0; p.lastKilledBy = 0;
    }
  }

  private snapshotLobby(lobby: DuelLobby, now: number): DuelLobbySnapshot {
    return { id: lobby.id, phase: lobby.phase,
      participants: orderedDuelScoreboard(lobby.participants.values()),
      serverNow: now, feed: lobby.feed.map((event) => ({ ...event })),
      countdownEndsAt: lobby.countdownEndsAt, startedAt: lobby.startedAt,
      endsAt: lobby.endsAt, arena: lobby.arena ? { ...lobby.arena, spawns: lobby.arena.spawns.map((s) => ({ ...s })) } : undefined,
      result: lobby.result ? { ...lobby.result,
        feed: lobby.result.feed.map((event) => ({ ...event })),
        scoreboard: lobby.result.scoreboard.map((p) => ({ ...p })) } : undefined };
  }
}
