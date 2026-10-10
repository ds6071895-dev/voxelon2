// Authoritative round state and compatibility facade for The Bridge and Parkour.
// All gameplay clocks are server milliseconds. Snapshots contain everything
// needed to recover the presentation; clients never choose spawns or winners.
//
// The two modes share one match engine and one isolated session transport
// (the `pg*` message family); they differ only in the venue they stamp and in
// what `evaluate` counts as progress. Every match is its own world (see
// multiverse.ts): a venue is authored at that world's origin, so there are no
// arena slots and no cap on simultaneous matches.
import { partyHash, type PartyVec3 } from './party_math';
export { partyHash, type PartyVec3 } from './party_math';
import { BRIDGE_RESPAWN_DELAY_MS } from './bridge_rules';
import { partyGame, partyModeCapacity, type PartyMode, type PartyGameId } from './party_modes';
export { partyGame, partyModeCapacity, type PartyMode, type PartyGameId } from './party_modes';
import { copyPartyParticipant, copyPartyResult, partyTeamScores } from './party_round';
import { PARKOUR_THEMES } from './parkour_themes';
import { encodeParkourSeed, parkourCourse } from './parkour_course';
import { ParkourHistory } from './parkour_history';
import type { ParkourBlockLookup } from './parkour_footing';
import {
  DRAGON_LAIR_FRONT, DRAGON_LIVES,
} from './parkour_mechanics';
import { parkourStamp, parkourSpawns, releaseParkourStamp } from './parkour_geometry';

import { PARTY_FLOOR_Y, PARTY_STAMP_MAX_Y, PARTY_STAMP_MIN_Y, PARTY_VOID_Y, PARTY_CEILING_Y } from './venue_dims';

export { PARTY_FLOOR_Y, PARTY_STAMP_MAX_Y, PARTY_STAMP_MIN_Y, PARTY_VOID_Y, PARTY_CEILING_Y };
export const PARTY_MAX_HEALTH = 20;
export const PARTY_AMBIENT_LIGHT = 0.8;
const PARTY_MIN_PLAYERS = 2;
export const PARTY_COUNTDOWN_MS = 3000;
const PARTY_ARENA_LOAD_TIMEOUT_MS = 30000;
const PARTY_RESULT_MS = 20000;
export * from './bridge_rules';
type PartyPhase = 'lobby' | 'countdown' | 'running' | 'results';
type PartyFinishReason = 'complete' | 'forfeit' | 'cancelled';
type PartyJoinFailure = 'invalid' | 'full' | 'match_in_progress' | 'already_in_lobby';
type PartyStartFailure = 'not_host' | 'too_few_players' | 'too_many_players' | 'not_everyone_ready' | 'not_in_lobby';

/** A venue's footprint in its own world. Always at the origin. */
export interface PartyArenaBounds {
  seed: number;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  floor: number;
  ceiling: number;
}
export interface PartySubBounds extends PartyArenaBounds {
  game: PartyGameId;
}

/** A mode's venue in its own world, carrying the course seed. */
function partyArenaBounds(game: PartyGameId, seed: number): PartyArenaBounds {
  const def = partyGame(game);
  return {
    seed, minX: 0, maxX: def.sizeX, minZ: 0, maxZ: def.sizeZ,
    floor: PARTY_FLOOR_Y, ceiling: PARTY_CEILING_Y,
  };
}
function partySubBounds(game: PartyGameId, seed: number): PartySubBounds {
  const def = partyGame(game);
  return { ...partyArenaBounds(game, seed), game: def.id };
}
export function clampToPartySub(p: PartyVec3, sub: PartySubBounds): PartyVec3 {
  return {
    x: Math.max(sub.minX + .3, Math.min(sub.maxX - .3, p.x)),
    y: Math.max(PARTY_VOID_Y - 2, Math.min(sub.ceiling - 1.8, p.y)),
    z: Math.max(sub.minZ + .3, Math.min(sub.maxZ - .3, p.z)),
  };
}

import { bridgeStamp, bridgeCageSpawn } from './bridge_geometry';
import { evaluateBridge } from './bridge_round';
import { evaluateParkour, flyDragon, checkParkourEnd } from './parkour_round';
export { BRIDGE_TEAM_BLOCK, BRIDGE_TEAM_NAME, BRIDGE_GOALS, BRIDGE_LANE_X, BRIDGE_CAGE_FLOOR, BRIDGE_CAGE_ROOF, bridgeSpawn, bridgeCageSpawn, bridgeCageHatch, bridgeGoalGuard } from './bridge_geometry';

// ── Parkour ────────────────────────────────────────────────────────────────
// The route — every pad — is generated in parkour_course.ts, the builds round
// it in parkour_setpieces.ts, and the moving parts (the dragon among them) in
// parkour_mechanics.ts. This file stamps the venue and keeps the score.

export {
  parkourCourse, parkourLength,
  type ParkourCourse, type ParkourPlatform, type ParkourJump,
} from './parkour_course';

/** `partyVenueBlockAt` bound to one venue: the stamp is resolved once, so a
 *  world's generator never goes back through the shared course cache. */
export function partyVenueLookup(game: PartyGameId, seed: number): (x: number, y: number, z: number) => number {
  const stamp = game === 'bridge' ? bridgeStamp() : parkourStamp(seed);
  return (x, y, z) => stamp.get(Math.floor(x), Math.floor(y), Math.floor(z));
}
/** Spawn positions, in participant order. */
export function partySpawns(sub: PartySubBounds, members: readonly { team: number }[]): PartyVec3[] {
  if (sub.game === 'parkour') return parkourSpawns(sub, members);
  // The Bridge always opens inside the cages: the first thing either player
  // does is watch the hatch drop out from under them.
  const seats = [0, 0];
  return members.map((m) => bridgeCageSpawn(sub, m.team, seats[m.team]++));
}

// ── Lobby engine ───────────────────────────────────────────────────────────

interface PartyIdentity { id: number; username: string; bot?: boolean }

export interface PartyParticipant extends PartyIdentity {
  ready: boolean;
  connected: boolean;
  joinOrder: number;
  /** 0 or 1 on the Bridge; always 0 in Parkour. */
  team: number;
  /** Goals scored (Bridge) or furthest platform reached (Parkour). */
  score: number;
  /** Bridge PvP. A kill is not a goal — it is what buys you the crossing. */
  kills: number;
  deaths: number;
  /** Who last landed a hit, and when, for void-kill credit. */
  lastHitBy?: number;
  lastHitAt: number;
  checkpoint: number;
  progress: number;
  falls: number;
  /** Parkour: lives left. */
  lives: number;
  /** Parkour: when this runner lost their last life (or left mid-run). */
  outAt?: number;
  finishedAt?: number;
  /** Parkour: 1 for the first runner to make it, 2 for the next… */
  place?: number;
  /** Parkour: how the last life was lost, for the HUD. */
  lastLife?: { at: number; cause: ParkourHurt };
  /** Parkour: a life the server has taken and not yet applied. */
  hurtCause?: ParkourHurt;
  immuneUntil: number;
  /** Server-owned respawn request: a goal reset, or a fall into the void. */
  pendingSpawn: boolean;
  /** Parkour: a life was applied, but a clear live surface is still pending. */
  respawnOrder?: number;
  /** Bridge: dead and spectating until this time. */
  respawnAt?: number;
}

/** How a Parkour runner can lose a life. */
export type ParkourHurt = 'fall' | 'dragon' | 'fire' | 'left';

/** The dragon: which course order it has reached, as of server time `at`. */
export interface PartyDragon { front: number; speed: number; at: number }

/** One runner's line on a Dragon Chase result. */
export interface ParkourRunnerResult {
  id: number;
  username: string;
  made: boolean;
  /** 1st, 2nd… to make it. */
  place?: number;
  /** Start to finish, ms. */
  timeMs?: number;
  livesLeft: number;
  /** 1 = the first to fall out of the run. */
  fellOrder?: number;
  /** Furthest pad reached. */
  reached: number;
  left: boolean;
}

interface PartyRoundState {
  game: PartyGameId;
  startedAt: number;
  endsAt: number;
  revision: number;
}

export interface PartyResult {
  winner: number | null;
  /** Bridge only: which side took it. */
  winnerTeam: number | null;
  teamScores: [number, number];
  scoreboard: PartyParticipant[];
  finishReason: PartyFinishReason;
  /** Parkour: who made it, and who fell (in the order they fell). */
  runners?: ParkourRunnerResult[];
}

export interface PartyLobbySnapshot {
  id: string;
  mode: PartyMode;
  revision: number;
  phase: PartyPhase;
  capacity: number;
  participants: PartyParticipant[];
  host: number;
  serverNow: number;
  countdownEndsAt?: number;
  arenaLoadDeadline?: number;
  /** Bridge only. Index is the team. */
  teamScores: [number, number];
  /** Wall clock until which a goal celebration holds everyone at their base. */
  goalResetAt?: number;
  /** Who scored the goal being celebrated, for the banner. */
  lastGoal?: { id: number; username: string; team: number; at: number };
  /** The most recent kill on the span, for the banner and the feed. */
  lastKill?: {
    id: number; username: string; victim: string; team: number; at: number;
    cause: 'melee' | 'bow' | 'void';
  };
  round?: PartyRoundState;
  arena?: PartyArenaBounds;
  sub?: PartySubBounds;
  result?: PartyResult;
  /** Parkour: the dragon. */
  dragon?: PartyDragon;
}

interface PartyLobby extends Omit<PartyLobbySnapshot, 'participants' | 'serverNow' | 'sub'> {
  token: string;
  participants: Map<number, PartyParticipant>;
  arenaReady: Set<number>;
  resultDeadline?: number;
}

/** Round order: whoever made it, first finisher first, then whoever lasted
 *  longest, then score, then whoever got there with fewer falls. */
function orderPartyRound(ps: Iterable<PartyParticipant>): PartyParticipant[] {
  return [...ps].sort((a, b) =>
    (a.finishedAt ?? Infinity) - (b.finishedAt ?? Infinity) ||
    (b.outAt ?? Infinity) - (a.outAt ?? Infinity) ||
    b.score - a.score || a.falls - b.falls || a.joinOrder - b.joinOrder);
}
/** Scoreboard order for The Bridge: winning side first, top scorer first. */
function orderPartyTeams(ps: Iterable<PartyParticipant>, teamScores: readonly number[]): PartyParticipant[] {
  return [...ps].sort((a, b) =>
    (teamScores[b.team] ?? 0) - (teamScores[a.team] ?? 0) || a.team - b.team ||
    b.score - a.score || a.joinOrder - b.joinOrder);
}

interface PartyCreateResult { token: string; snapshot: PartyLobbySnapshot }
type PartyJoinResult =
  | { ok: true; snapshot: PartyLobbySnapshot }
  | { ok: false; reason: PartyJoinFailure };

export class PartyGamesEngine {
  private readonly lobbies = new Map<string, PartyLobby>();
  private readonly lobbyByPlayer = new Map<number, PartyLobby>();
  private nextId = 1;
  private seedCounter = 0;
  /** What each player ran last, so the next course is somewhere else and
   *  built from other set pieces. */
  private readonly lastParkour = new ParkourHistory();
  private themeBag: number[] = [];
  constructor(private readonly tokenFactory: () => string) { }

  private static blank(identity: PartyIdentity, joinOrder: number): PartyParticipant {
    return {
      ...identity, ready: false, connected: true, joinOrder, team: 0, score: 0,
      kills: 0, deaths: 0, lastHitBy: undefined, lastHitAt: 0,
      checkpoint: 0, progress: 0, falls: 0, lives: 0, immuneUntil: 0, pendingSpawn: false,
    };
  }

  /** Even sides, stable under joins and leaves. Parkour has no teams. */
  private assignTeams(l: PartyLobby): void {
    const ordered = [...l.participants.values()].sort((a, b) => a.joinOrder - b.joinOrder);
    ordered.forEach((p, i) => { p.team = l.mode === 'bridge' ? i % 2 : 0; });
  }

  /** `capacity` defaults to the 1v1 matchmaking size; a party passes the
   *  larger `partyModeCapacity(mode, true)`. */
  create(identity: PartyIdentity, now: number, mode: PartyMode = 'bridge',
    capacity = partyModeCapacity(mode, false)):
    PartyCreateResult | { reason: 'already_in_lobby' } {
    if (this.lobbyByPlayer.has(identity.id)) return { reason: 'already_in_lobby' };
    const token = this.tokenFactory();
    const p = PartyGamesEngine.blank(identity, 0);
    const lobby: PartyLobby = {
      id: `P${this.nextId++}`, token, mode, revision: 0, phase: 'lobby',
      capacity: Math.max(PARTY_MIN_PLAYERS, Math.min(partyModeCapacity(mode, true), capacity)),
      participants: new Map([[p.id, p]]), host: p.id, teamScores: [0, 0],
      arenaReady: new Set(),
    };
    this.lobbies.set(token, lobby);
    this.lobbyByPlayer.set(p.id, lobby);
    this.assignTeams(lobby);
    return { token, snapshot: this.snapshotLobby(lobby, now) };
  }

  join(token: string, identity: PartyIdentity, now: number): PartyJoinResult {
    if (this.lobbyByPlayer.has(identity.id)) return { ok: false, reason: 'already_in_lobby' };
    const l = this.lobbies.get(token);
    if (!l) return { ok: false, reason: 'invalid' };
    if (l.phase !== 'lobby') return { ok: false, reason: 'match_in_progress' };
    if (l.participants.size >= l.capacity) return { ok: false, reason: 'full' };
    const joinOrder = Math.max(...[...l.participants.values()].map((v) => v.joinOrder)) + 1;
    const p = PartyGamesEngine.blank(identity, joinOrder);
    for (const v of l.participants.values()) v.ready = false;
    l.participants.set(p.id, p);
    this.lobbyByPlayer.set(p.id, l);
    this.assignTeams(l);
    return { ok: true, snapshot: this.snapshotLobby(l, now) };
  }

  /** Take a player out of their lobby. Returns the lobby as it now stands, or
   *  undefined when there was none or it emptied and was deleted. */
  leave(id: number, now: number): PartyLobbySnapshot | undefined {
    const l = this.lobbyByPlayer.get(id);
    if (!l) return undefined;
    this.lobbyByPlayer.delete(id);
    const p = l.participants.get(id)!;
    p.connected = false;
    if (p.bot) this.lastParkour.delete(id);
    p.ready = false;
    if (l.phase === 'lobby') l.participants.delete(id);
    const remaining = [...l.participants.values()].filter((v) => v.connected);
    if (!remaining.length) {
      this.release(l);
      this.lobbies.delete(l.token);
      return undefined;
    }
    l.host = remaining[0].id;
    if (l.phase === 'lobby') for (const v of l.participants.values()) v.ready = false;
    if (l.phase === 'lobby') this.assignTeams(l);
    if (l.mode === 'parkour' && (l.phase === 'running' || l.phase === 'countdown')) {
      // Nobody forfeits a Dragon Chase: a runner who walks away mid-run is
      // simply out of it, and one who already made it stays made it.
      if (p.finishedAt === undefined && p.outAt === undefined) {
        p.outAt = now;
        p.lastLife = { at: now, cause: 'left' };
      }
      if (l.phase === 'running') checkParkourEnd(l, now, (at) => this.endMatch(l, at));
      else this.arm(l, now);
    } else if (remaining.length < 2 && l.phase !== 'lobby' && l.phase !== 'results')
      // The side still standing takes it. (The Bridge reads its winner by team.)
      this.finish(l, now, remaining[0].id, 'forfeit', l.mode === 'bridge' ? remaining[0].team : null);
    else if (l.phase === 'countdown') this.arm(l, now);
    return this.snapshotLobby(l, now);
  }

  setReady(id: number, ready: boolean, now: number): PartyLobbySnapshot | null {
    const l = this.lobbyByPlayer.get(id);
    if (!l || l.phase !== 'lobby') return null;
    l.participants.get(id)!.ready = ready;
    return this.snapshotLobby(l, now);
  }

  /** Replays share course history only for the lifetime of a player session. */
  forgetPlayer(id: number): void { this.lastParkour.delete(id); }

  start(id: number, now: number): { ok: true; snapshot: PartyLobbySnapshot } | { ok: false; reason: PartyStartFailure } {
    const l = this.lobbyByPlayer.get(id);
    if (!l || l.phase !== 'lobby') return { ok: false, reason: 'not_in_lobby' };
    if (l.host !== id) return { ok: false, reason: 'not_host' };
    if (l.participants.size < PARTY_MIN_PLAYERS) return { ok: false, reason: 'too_few_players' };
    if (l.participants.size > l.capacity) return { ok: false, reason: 'too_many_players' };
    if ([...l.participants.values()].some((p) => !p.ready)) return { ok: false, reason: 'not_everyone_ready' };
    // Random secret token + monotonic counter produces a fresh course on every replay.
    let seed = ++this.seedCounter;
    for (const c of this.tokenFactory()) seed = partyHash(seed, c.charCodeAt(0));
    if (l.mode === 'parkour') {
      const last = [...l.participants.keys()].map((v) => this.lastParkour.get(v));
      const recent = new Set(last.flatMap((v) => v?.pieces ?? []));
      /** Shuffle-bag draw: every option comes round before any repeats, and
       *  nothing either racer just played is drawn while anything else is left. */
      const drawFrom = <T>(bag: T[], all: readonly T[], excluded: Set<T | undefined>): T => {
        if (!bag.length) bag.push(...[...all].sort((a, b) =>
          partyHash(seed, all.indexOf(a) + 31) - partyHash(seed, all.indexOf(b) + 31)));
        const next = bag.findIndex((t) => !excluded.has(t));
        return next >= 0 ? bag.splice(next, 1)[0] : all.find((t) => !excluded.has(t)) ?? bag.splice(0, 1)[0];
      };
      const theme = drawFrom(this.themeBag, PARKOUR_THEMES.map((_, i) => i), new Set(last.map((v) => v?.theme)));
      // Of a few candidate courses, the one sharing fewest set pieces with
      // what these runners just ran.
      let best = encodeParkourSeed(seed, theme), overlap = Infinity;
      for (let k = 0; k < 4 && overlap > 0 && recent.size; k++) {
        const candidate = encodeParkourSeed(partyHash(seed, 0x51ce + k), theme);
        const n = parkourCourse(candidate).variant.pieces.filter((v) => recent.has(v)).length;
        if (n < overlap) { overlap = n; best = candidate; }
      }
      seed = best;
      const pieces = parkourCourse(seed).variant.pieces;
      for (const v of l.participants.keys()) this.lastParkour.set(v, { theme, pieces });
    }
    l.arena = partyArenaBounds(l.mode, seed);
    l.result = undefined;
    this.assignTeams(l);
    this.prepare(l, now);
    return { ok: true, snapshot: this.snapshotLobby(l, now) };
  }

  private prepare(l: PartyLobby, now: number): void {
    l.phase = 'countdown';
    l.revision++;
    l.arenaReady.clear();
    l.countdownEndsAt = undefined;
    l.arenaLoadDeadline = now + PARTY_ARENA_LOAD_TIMEOUT_MS;
    l.goalResetAt = undefined;
    l.lastGoal = undefined;
    l.lastKill = undefined;
    l.teamScores = [0, 0];
    const game = partyGame(l.mode);
    l.round = { game: game.id, startedAt: 0, endsAt: 0, revision: l.revision };
    const lives = l.mode === 'parkour' ? DRAGON_LIVES : 0;
    l.dragon = l.mode === 'parkour' ? { front: DRAGON_LAIR_FRONT, speed: 0, at: now } : undefined;
    for (const p of l.participants.values())
      Object.assign(p, {
        score: 0, kills: 0, deaths: 0, lastHitBy: undefined, lastHitAt: 0,
        progress: 0, checkpoint: 0, falls: 0, lives, outAt: undefined,
        finishedAt: undefined, immuneUntil: 0, pendingSpawn: false, respawnAt: undefined,
        place: undefined, lastLife: undefined, hurtCause: undefined, respawnOrder: undefined,
      });
  }

  markArenaReady(id: number, now: number, revision?: number): PartyLobbySnapshot | null {
    const l = this.lobbyByPlayer.get(id);
    if (!l || l.phase !== 'countdown' || revision !== l.revision || l.countdownEndsAt !== undefined) return null;
    l.arenaReady.add(id);
    this.arm(l, now);
    return this.snapshotLobby(l, now);
  }

  private arm(l: PartyLobby, now: number): void {
    if (l.countdownEndsAt !== undefined) return;
    if ([...l.participants.values()].filter((p) => p.connected).every((p) => l.arenaReady.has(p.id)))
      l.countdownEndsAt = now + PARTY_COUNTDOWN_MS;
  }

  tick(now: number): PartyLobbySnapshot[] {
    const changed: PartyLobbySnapshot[] = [];
    for (const l of this.lobbies.values()) {
      let dirty = false;
      if (l.phase === 'countdown') {
        if (l.countdownEndsAt !== undefined && now >= l.countdownEndsAt) {
          l.phase = 'running';
          l.round!.startedAt = now;
          l.round!.endsAt = now + partyGame(l.round!.game).durationMs;
          dirty = true;
        } else if (l.countdownEndsAt === undefined && now >= l.arenaLoadDeadline!) {
          this.finish(l, now, null, 'cancelled');
          dirty = true;
        }
      } else if (l.phase === 'running' && now >= l.round!.endsAt) {
        this.endMatch(l, now);
        dirty = true;
      } else if (l.phase === 'running' && l.dragon) {
        flyDragon(l, now);
      } else if (l.phase === 'results' && now >= l.resultDeadline!) {
        l.phase = 'lobby';
        this.release(l);
        l.round = undefined;
        l.result = undefined;
        l.resultDeadline = undefined;
        l.dragon = undefined;
        l.countdownEndsAt = undefined;
        l.arenaLoadDeadline = undefined;
        l.goalResetAt = undefined;
        l.lastGoal = undefined;
        l.lastKill = undefined;
        for (const [id, p] of l.participants) {
          if (!p.connected) l.participants.delete(id);
          else p.ready = false;
        }
        this.assignTeams(l);
        dirty = true;
      }
      if (dirty) changed.push(this.snapshotLobby(l, now));
    }
    return changed;
  }

  /** Two live Bridge players on OPPOSITE sides, neither of them shielded.
   *  Every combat validation on the server starts here. */
  canFight(attackerId: number, targetId: number, now: number): boolean {
    const l = this.lobbyByPlayer.get(attackerId);
    if (!l || l !== this.lobbyByPlayer.get(targetId) || l.mode !== 'bridge' || l.phase !== 'running')
      return false;
    if (l.goalResetAt !== undefined && now < l.goalResetAt) return false;
    const a = l.participants.get(attackerId), b = l.participants.get(targetId);
    return !!a && !!b && a.connected && b.connected && a.team !== b.team &&
      !a.pendingSpawn && !b.pendingSpawn && a.respawnAt === undefined && b.respawnAt === undefined &&
      now >= b.immuneUntil;
  }

  /** Record that `attacker` damaged `victim`, so a fall in the next ten
   *  seconds is attributed to them. Returns nothing: damage itself is the
   *  transport layer's business, not the lobby's. */
  recordHit(victimId: number, attackerId: number, now: number): void {
    const victim = this.lobbyByPlayer.get(victimId)?.participants.get(victimId);
    if (victim) { victim.lastHitBy = attackerId; victim.lastHitAt = now; }
  }

  /** A player was killed outright (not a void fall). The victim is sent home
   *  on the next evaluation, exactly like a goal reset. */
  recordDeath(victimId: number, killerId: number | null, now: number,
    cause: 'melee' | 'bow' | 'void' = 'melee'): PartyLobbySnapshot | null {
    const l = this.lobbyByPlayer.get(victimId), victim = l?.participants.get(victimId);
    if (!l || !victim) return null;
    victim.deaths++;
    victim.respawnAt = now + BRIDGE_RESPAWN_DELAY_MS;
    victim.lastHitBy = undefined;
    const killer = killerId === null ? undefined : l.participants.get(killerId);
    if (killer && killer.team !== victim.team) {
      killer.kills++;
      l.lastKill = { id: killer.id, username: killer.username, victim: victim.username, team: killer.team, at: now, cause };
    }
    return this.snapshotLobby(l, now);
  }

  /** Evaluate an accepted position, or a stationary player on the server tick.
   *  Returned spawn is an authoritative reset, never a client claim. Optional
   *  blockAt reads the live venue in LOCAL coordinates for safe Parkour resets. */
  evaluate(id: number, pos: PartyVec3, now: number, blockAt?: ParkourBlockLookup):
    { spawn?: PartyVec3; changed: boolean; killedBy?: number } {
    const l = this.lobbyByPlayer.get(id), p = l?.participants.get(id);
    if (l?.mode === 'parkour' && l.arena && p?.finishedAt !== undefined && p.place !== undefined && l.phase === 'running') {
      // Made it, and wandered off the podium: back up onto your step.
      const course = parkourCourse(l.arena.seed), spot = course.podium[Math.min(course.podium.length - 1, p.place - 1)];
      const sub = this.subFor(id)!;
      if (pos.y < course.finish.y - 6) return { spawn: { x: sub.minX + spot.x, y: spot.y + .01, z: sub.minZ + spot.z }, changed: false };
      return { changed: false };
    }
    if (!l || !p || l.phase !== 'running' || !l.round || !l.arena || !p.connected ||
      p.finishedAt !== undefined || p.outAt !== undefined || now >= l.round.endsAt) return { changed: false };
    const sub = this.subFor(id)!;
    return sub.game === 'bridge' ? evaluateBridge(l, p, sub, pos, now, (at) => this.endMatch(l, at))
      : evaluateParkour(l, p, sub, pos, now, (at) => this.endMatch(l, at), blockAt);
  }

  /** Take a life off a Parkour runner (the dragon's jaws or its fire). The
   *  next evaluation applies it. False when they cannot be hurt right now. */
  hurt(id: number, cause: ParkourHurt, now: number): boolean {
    const l = this.lobbyByPlayer.get(id), p = l?.participants.get(id);
    if (!l || !p || l.mode !== 'parkour' || l.phase !== 'running' || !p.connected || p.pendingSpawn ||
      p.finishedAt !== undefined || p.outAt !== undefined || now < p.immuneUntil) return false;
    p.pendingSpawn = true;
    p.hurtCause = cause;
    return true;
  }

  private endMatch(l: PartyLobby, now: number): void {
    if (l.mode === 'bridge') {
      const scores = partyTeamScores(l.participants.values());
      l.teamScores = scores;
      const team = scores[0] === scores[1] ? null : scores[0] > scores[1] ? 0 : 1;
      const best = team === null ? null
        : orderPartyRound([...l.participants.values()].filter((p) => p.team === team))[0]?.id ?? null;
      this.finish(l, now, best, 'complete', team);
      return;
    }
    // Nobody wins a Dragon Chase: you made it, or you did not.
    this.finish(l, now, null, 'complete');
  }

  private finish(l: PartyLobby, now: number, winner: number | null, reason: PartyFinishReason, winnerTeam: number | null = null): void {
    l.phase = 'results';
    l.resultDeadline = now + PARTY_RESULT_MS;
    l.goalResetAt = undefined;
    const teamScores = partyTeamScores(l.participants.values());
    l.teamScores = teamScores;
    const board = l.mode === 'bridge'
      ? orderPartyTeams(l.participants.values(), teamScores)
      : orderPartyRound(l.participants.values());
    l.result = {
      winner, winnerTeam, teamScores,
      scoreboard: board.map(copyPartyParticipant),
      finishReason: reason,
      runners: l.mode === 'parkour' ? this.parkourRunners(l) : undefined,
    };
  }

  private parkourRunners(l: PartyLobby): ParkourRunnerResult[] {
    const ps = [...l.participants.values()];
    const fell = ps.filter((p) => p.finishedAt === undefined).sort((a, b) =>
      (a.outAt ?? Infinity) - (b.outAt ?? Infinity) || a.score - b.score || a.joinOrder - b.joinOrder);
    const made = ps.filter((p) => p.finishedAt !== undefined).sort((a, b) => a.finishedAt! - b.finishedAt!);
    const started = l.round?.startedAt ?? 0;
    return [
      ...made.map((p, i): ParkourRunnerResult => ({
        id: p.id, username: p.username, made: true, place: i + 1, timeMs: p.finishedAt! - started,
        livesLeft: p.lives, reached: p.score, left: !p.connected,
      })),
      ...fell.map((p, i): ParkourRunnerResult => ({
        id: p.id, username: p.username, made: false, fellOrder: i + 1, livesLeft: 0,
        reached: p.score, left: p.lastLife?.cause === 'left',
      })),
    ];
  }

  private release(l: PartyLobby): void {
    if (l.arena && l.mode === 'parkour') releaseParkourStamp(l.arena.seed);
    l.arena = undefined;
  }

  private snapshotLobby(l: PartyLobby, now: number): PartyLobbySnapshot {
    const view = this.viewLobby(l, now);
    return {
      ...view,
      participants: view.participants.map(copyPartyParticipant),
      teamScores: [...view.teamScores],
      lastGoal: view.lastGoal ? { ...view.lastGoal } : undefined,
      lastKill: view.lastKill ? { ...view.lastKill } : undefined,
      round: view.round ? { ...view.round } : undefined,
      arena: view.arena ? { ...view.arena } : undefined,
      result: view.result ? copyPartyResult(view.result) : undefined,
      dragon: view.dragon ? { ...view.dragon } : undefined,
    };
  }

  /** snapshotLobby minus the defensive copies: the participants, round and
   *  scores are the live objects. Only for the server's per-tick paths that
   *  READ a match (never mutate it, keep it, or put it on the wire) — copying
   *  every match once per tick, and again per bot, was a quarter of the tick. */
  private viewLobby(l: PartyLobby, now: number): PartyLobbySnapshot {
    return {
      id: l.id, mode: l.mode, revision: l.revision, phase: l.phase, capacity: l.capacity,
      participants: [...l.participants.values()], host: l.host, serverNow: now,
      countdownEndsAt: l.countdownEndsAt, arenaLoadDeadline: l.arenaLoadDeadline,
      teamScores: l.teamScores, goalResetAt: l.goalResetAt,
      lastGoal: l.lastGoal, lastKill: l.lastKill,
      round: l.round, arena: l.arena,
      sub: l.arena && l.round ? partySubBounds(l.mode, l.arena.seed) : undefined,
      result: l.result, dragon: l.dragon,
    };
  }

  snapshotFor(id: number, now: number): PartyLobbySnapshot | null {
    const l = this.lobbyByPlayer.get(id);
    return l ? this.snapshotLobby(l, now) : null;
  }
  snapshots(now: number): PartyLobbySnapshot[] { return [...this.lobbies.values()].map((l) => this.snapshotLobby(l, now)); }
  /** Read-only live views (see viewLobby). */
  viewFor(id: number, now: number): Readonly<PartyLobbySnapshot> | null {
    const l = this.lobbyByPlayer.get(id);
    return l ? this.viewLobby(l, now) : null;
  }
  views(now: number): Readonly<PartyLobbySnapshot>[] { return [...this.lobbies.values()].map((l) => this.viewLobby(l, now)); }
  phaseFor(id: number): PartyPhase | null { return this.lobbyByPlayer.get(id)?.phase ?? null; }
  subFor(id: number): PartySubBounds | null {
    const l = this.lobbyByPlayer.get(id);
    return l?.arena && l.round ? partySubBounds(l.mode, l.arena.seed) : null;
  }
  roundFor(id: number): PartyRoundState | null { return this.lobbyByPlayer.get(id)?.round ?? null; }
  dragonFor(id: number): Readonly<PartyDragon> | null { return this.lobbyByPlayer.get(id)?.dragon ?? null; }
  participantFor(id: number): PartyParticipant | null { return this.lobbyByPlayer.get(id)?.participants.get(id) ?? null; }
  membersOf(id: number): number[] {
    return [...(this.lobbyByPlayer.get(id)?.participants.values() ?? [])].filter((p) => p.connected).map((p) => p.id);
  }
}
