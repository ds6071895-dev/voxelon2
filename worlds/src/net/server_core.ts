// Worlds authoritative server logic, transport-agnostic and pure (no ws, no
// Node APIs) so it runs headlessly under test and behind the WebSocket shell.
//
// What it owns:
//   · identities — temporary generated names, sign-in, and the guarantee that
//     no two people ever hold the same name (NameRegistry);
//   · parties — codes that never collide, leaders, who is free to play;
//   · matchmaking — one queue per game; a practice opponent quietly takes the
//     other seat after BOT_WAIT_MS alone;
//   · the MULTIVERSE — every match is a world of its own (multiverse.ts) with
//     its own blocks, edits, bodies and messages. Nothing is shared between
//     worlds, so any number of matches can run at once;
//   · the rules of Duels, The Bridge and Parkour, ported from VOXELON's
//     authoritative arena code: movement validation, lag-compensated hits,
//     arrows, build rules, course hazards.

import { Block } from '../blocks';
import { ITEMS, Item, type ItemStack } from '../items';
import { randomCosmetics, sanitizeCosmetics, type Cosmetics } from '../character';
import {
  WorldBlocks, releaseWorldGenerator, worldGenerator, type WorldKind, type WorldSpec,
} from '../multiverse';
import {
  Duels, type DuelArenaBounds, type DuelLobbySnapshot, DUEL_MAX_HEALTH, DUEL_MAX_PILLAR_HEIGHT,
  clampToDuelArena, duelTerrainElevation, hasArenaLineOfSight, safestDuelSpawn, secureDuelToken,
} from '../duels';
import {
  PARTY_CEILING_Y, PARTY_FLOOR_Y, PARTY_MAX_HEALTH, PARTY_VOID_Y,
  BRIDGE_TEAM_BLOCK, PartyGamesEngine, type PartyLobbySnapshot, type PartyMode,
  type PartyParticipant, type PartySubBounds,
  BRIDGE_ARROW_GRAVITY, BRIDGE_ARROW_KB_VERT, BRIDGE_ARROW_LIFE_MS,
  BRIDGE_BOW_COOLDOWN_MS, BRIDGE_MELEE_TIER, bridgeSwing,
  BRIDGE_SWING_JITTER_MS, bridgeArrowShot, bridgeCageHatch, bridgeGoalGuard, clampToPartySub,
  partySpawns, parkourCourse, partyModeCapacity,
} from '../partygames';
import {
  CRUMBLE_BACK_MS, CRUMBLE_CRACKED, CRUMBLE_FALL_MS, blinkSolid, parkourBlinkCells,
  parkourBuildBlocked, parkourCollapseCells, parkourCollapseFront, parkourCrumbleCells,
  parkourCrumbleUnder, parkourPadNear,
} from '../parkour_mechanics';
import type { ParkourCell } from '../parkour_course';
import { PartyBot } from '../party_bot';
import { DuelBot } from '../duel_bot';
import type { World } from '../world';
import {
  MELEE_COMBO_MAX, MELEE_COMBO_WINDOW_MS, MELEE_FACING_DOT, MELEE_RANGE, MELEE_REWIND_S,
} from '../melee';
import { partyCapacityFor } from '../modes';
import { Accounts, type Hasher } from './accounts';
import { NameRegistry } from './names';
import { Parties, type Party } from './parties';
import {
  EDIT_RANGE, PARTY_MAX, isGameMode, isGeneratedName, skinSeed,
  type ClientMsg, type GameMode, type PartyState, type PlayerInfo, type PlayerSnapshot,
  type ServerMsg,
} from './protocol';

/** Alone in a queue this long, and a practice opponent takes the other seat.
 *  Nothing on the client ever mentions it. */
export const BOT_WAIT_MS = 15_000;
/** Seconds a finished match's world stays open for its results screen. */
const RESULTS_LINGER_S = 25;

/** What the server needs from a Bridge/Parkour practice opponent. */
export interface PgBot {
  readonly opponent: number;
  readonly body: PartyBot['body'];
  readonly pitch: number;
  readonly rating: number;
  skill: number;
  fixedSkill: boolean;
  reset(spawn: { x: number; y: number; z: number }): void;
  noteHurt(now: number): void;
  step(...args: Parameters<PartyBot['step']>): ReturnType<PartyBot['step']>;
}

/** One message the transport should deliver to one client. */
export interface Outbound { to: number; msg: ServerMsg }

/** All arguments are finite numbers (rejects NaN/Infinity/non-numbers). */
function fin(...ns: number[]): boolean {
  return ns.every((n) => Number.isFinite(n));
}

interface ArenaTrackSample { at: number; x: number; y: number; z: number }
interface DuelShotTicket { at: number; x: number; y: number; z: number; dx: number; dy: number; dz: number }

/** How far back the arena position history reaches, in seconds. Covers a
 *  Burst Rifle round crossing its full range, the interpolation delay the
 *  shooter's client renders opponents at, and a slow round trip on top. */
const DUEL_TRACK_WINDOW = 1.2;

/** Movement budget while a throw (pad or knockback) is settling. */
const PARTY_LAUNCH_RATE = 17;
const PARTY_LAUNCH_CAP = 6;

interface ServerPlayer {
  id: number;
  username: string;
  skin: number;
  cosmetics?: Cosmetics;
  /** The socket said hello: until then nothing else is accepted. */
  ready: boolean;
  /** Signed in to an account (false = playing under a temporary name). */
  account: boolean;
  /** A practice opponent. Server-side only: never put on the wire. */
  bot: boolean;
  /** A name offered by `rollName`, held for this session until used or replaced. */
  nameOffer?: string;
  /** World this body is in, or null on the menu. */
  worldId: number | null;
  /** Matchmaking: the game being searched for, and since when (ms). */
  queue: GameMode | null;
  queuedAt: number;
  x: number; y: number; z: number; yaw: number; pitch: number;
  ct?: number;
  health: number;
  dead: boolean;
  held: number;
  sneaking: boolean;
  swing: number;
  aiming: boolean;
  reloading: boolean;
  regenTimer: number;
  regenBoostTimer: number;
  regenBoostInterval: number;
  duelSpawnIndex: number;
  duelLastShotAt: number;
  duelNextBurstAt: number;
  duelBurstShots: number;
  duelShotTickets: DuelShotTicket[];
  duelLoaded: number;
  duelReloadUntil: number;
  duelMedkits: number;
  duelRespawning: boolean;
  /** Recent authoritative positions, oldest first, for lag compensation. */
  arenaTrack: ArenaTrackSample[];
}

/** What the party movement gate remembers between packets. */
interface PartyMoveState {
  at: number;
  allowance: number;
  revision: number;
  groundX: number; groundY: number; groundZ: number;
  groundedAt: number;
  stuck: number;
  /** worldTime until which a server-applied impulse (knockback or a pad) is
   *  settling, so the anti-flight rules stand down. */
  launchUntil: number;
}

/** Bridge combat clocks. */
interface PartyCombatState {
  lastSwingAt: number;
  combo: number;
  comboTarget: number;
  lastShotAt: number;
}

interface PartyArrow {
  id: number;
  owner: number;
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  power: number;
  diesAt: number;
}

/** One running match's world. */
interface MatchWorld {
  spec: WorldSpec;
  blocks: WorldBlocks;
  mode: GameMode;
  /** The match engine's id for this match's lobby. */
  lobby: string;
  /** Every body in this world, bots included. */
  members: Set<number>;
  /** Launched by a party rather than from matchmaking. */
  party: boolean;
  /** worldTime (s) at which a finished match's world closes. */
  closeAt: number | null;
  cagesOpen: boolean;
  parkour: {
    blink: [boolean, boolean];
    collapsed: number;
    crumbles: Map<number, { fallAt: number; backAt: number; gone: boolean }>;
  } | null;
  arrows: PartyArrow[];
}

export interface ServerOptions {
  accounts?: Accounts;
  hasher?: Hasher;
  salt?: () => string;
  token?: () => string;
  rng?: () => number;
  wallNow?: () => number;
}

const MODE_TO_KIND: Record<GameMode, WorldKind> = { duels: 'duel', bridge: 'bridge', parkour: 'parkour' };
const MODE_NAMES: Record<GameMode, string> = { duels: 'Duels', bridge: 'The Bridge', parkour: 'Parkour' };

export class GameServer {
  readonly accounts: Accounts;
  private readonly hasher: Hasher;
  private readonly makeSalt: () => string;
  private readonly makeToken: () => string;
  private readonly rng: () => number;
  private readonly wallNow: () => number;
  readonly names: NameRegistry;
  readonly parties: Parties;
  private readonly players = new Map<number, ServerPlayer>();
  private readonly worlds = new Map<number, MatchWorld>();
  private readonly worldByLobby = new Map<string, number>();
  private readonly duels: Duels;
  private readonly pg: PartyGamesEngine;
  private readonly duelBots = new Map<number, DuelBot>();
  private readonly partyBots = new Map<number, PgBot>();
  /** How a Bridge/Parkour practice opponent is made (tests swap in others). */
  pgBotFactory: (opponent: number, spawn: { x: number; y: number; z: number }, rng: () => number,
    skill?: number) => PgBot = (opponent, spawn, rng, skill) => new PartyBot(opponent, spawn, rng, skill);
  /** Hidden skill memory for players without an account, keyed mode:name. */
  private readonly guestSkill = new Map<string, number>();
  private readonly partyMoves = new Map<number, PartyMoveState>();
  private readonly partyCombat = new Map<number, PartyCombatState>();
  private nextPlayerId = 1;
  private nextWorldId = 1;
  private arrowSeq = 1;
  private worldTime = 0;       // seconds since boot
  private botClock = 0;
  private duelClockNextAt = 0;
  private pgClockNextAt = 0;
  private sweepAt = 0;
  /** Persist the account store (set by the shell). */
  onAccountsChanged?: () => void;

  constructor(opts: ServerOptions = {}) {
    this.accounts = opts.accounts ?? new Accounts();
    this.hasher = opts.hasher ?? ((p, s) => `${s}:${p}`);
    this.rng = opts.rng ?? Math.random;
    this.makeSalt = opts.salt ?? (() => Math.floor(this.rng() * 2 ** 48).toString(36));
    this.makeToken = opts.token ?? secureDuelToken;
    this.wallNow = opts.wallNow ?? Date.now;
    this.names = new NameRegistry((name) => this.accounts.has(name));
    // Lobby tokens also seed Parkour courses; tests pass a seeded source.
    this.duels = new Duels(opts.token ?? secureDuelToken);
    this.pg = new PartyGamesEngine(opts.token ?? secureDuelToken);
    this.parties = new Parties(this.rng);
  }

  // ── Introspection (tests, console) ──────────────────────────────────────

  get time(): number { return this.worldTime; }
  worldCount(): number { return this.worlds.size; }
  playerCount(): number { return [...this.players.values()].filter((p) => !p.bot).length; }
  botCount(): number { return this.duelBots.size + this.partyBots.size; }
  usernameOf(id: number): string | undefined { return this.players.get(id)?.username; }
  worldOf(id: number): WorldSpec | null {
    const p = this.players.get(id);
    return p?.worldId != null ? this.worlds.get(p.worldId)?.spec ?? null : null;
  }
  worldMembers(worldId: number): number[] { return [...(this.worlds.get(worldId)?.members ?? [])]; }
  worldEditCount(worldId: number): number { return this.worlds.get(worldId)?.blocks.edits.size ?? -1; }
  queueOf(id: number): GameMode | null { return this.players.get(id)?.queue ?? null; }

  /**
   * Test and load-test hook: a match between practice opponents only, each
   * held at a fixed hidden level. Returns the world id. Nothing a client can
   * send reaches this.
   */
  startExhibition(mode: GameMode, entries: { skill: number; adaptive?: boolean }[],
    makeBot?: (index: number, opponent: number, spawn: { x: number; y: number; z: number },
      rng: () => number, skill: number) => PgBot): number {
    const bots = entries.map(() => this.makeBot());
    const factory = this.pgBotFactory;
    if (makeBot) {
      let i = 0;
      this.pgBotFactory = (opponent, spawn, rng) => { const k = i++; return makeBot(k, opponent, spawn, rng, entries[k].skill); };
    }
    try { this.deliverNothing(this.launch(mode, bots, entries.length > 2)); }
    finally { this.pgBotFactory = factory; }
    bots.forEach((b, i) => {
      const pb = this.partyBots.get(b.id), db = this.duelBots.get(b.id);
      const e = entries[i];
      if (pb) { pb.skill = e.skill; pb.fixedSkill = !e.adaptive; if ('anchor' in pb) (pb as unknown as { anchor: number }).anchor = e.skill; }
      if (db) { db.skill = e.skill; db.fixedSkill = !e.adaptive; }
    });
    return bots[0].worldId ?? -1;
  }
  /** Current hidden level of every practice opponent in a world (tests). */
  botSkills(worldId: number): number[] {
    const w = this.worlds.get(worldId);
    if (!w) return [];
    return [...w.members].map((id) => this.partyBots.get(id)?.skill ?? this.duelBots.get(id)?.skill ?? NaN);
  }
  /** The level each practice opponent would be remembered at if it left now (tests). */
  botRatings(worldId: number): number[] {
    const w = this.worlds.get(worldId);
    if (!w) return [];
    return [...w.members].map((id) => this.partyBots.get(id)?.rating ?? this.duelBots.get(id)?.rating ?? NaN);
  }
  private deliverNothing(_out: Outbound[]): void { /* bots have no sockets */ }
  /** A snapshot of an exhibition or any match, for tests. */
  matchState(worldId: number): { mode: GameMode; phase: string; participants: { id: number; score: number; progress: number;
    kills: number; falls: number; finishedAt?: number; team: number }[]; winner: number | null; winnerTeam: number | null; teamScores?: number[] } | null {
    const w = this.worlds.get(worldId);
    if (!w) return null;
    const now = this.nowMs();
    if (w.mode === 'duels') {
      const snap = this.duels.snapshots(now).find((s) => s.id === w.lobby);
      if (!snap) return null;
      return { mode: w.mode, phase: snap.phase, winner: snap.result?.winner ?? null, winnerTeam: null,
        participants: snap.participants.map((p) => ({ id: p.id, score: p.kills, progress: 0, kills: p.kills, falls: p.deaths, team: 0 })) };
    }
    const snap = this.pg.snapshots(now).find((s) => s.id === w.lobby);
    if (!snap) return null;
    return { mode: w.mode, phase: snap.phase, winner: snap.result?.winner ?? null, winnerTeam: snap.result?.winnerTeam ?? null,
      teamScores: snap.teamScores,
      participants: snap.participants.map((p) => ({ id: p.id, score: p.score, progress: p.progress, kills: p.kills,
        falls: p.falls, finishedAt: p.finishedAt, team: p.team })) };
  }
  isBot(id: number): boolean { return this.players.get(id)?.bot === true; }
  healthOf(id: number): number | null { return this.players.get(id)?.health ?? null; }
  positionOf(id: number): { x: number; y: number; z: number } | null {
    const p = this.players.get(id);
    return p ? { x: p.x, y: p.y, z: p.z } : null;
  }

  // ── Connections ─────────────────────────────────────────────────────────

  /** A socket opened. Returns the id every later call uses. */
  connect(): number {
    const id = this.nextPlayerId++;
    this.players.set(id, this.blankPlayer(id, '', false));
    return id;
  }

  private blankPlayer(id: number, username: string, bot: boolean): ServerPlayer {
    return {
      id, username, skin: skinSeed(username), ready: bot, account: false, bot,
      worldId: null, queue: null, queuedAt: 0,
      x: 0, y: 0, z: 0, yaw: 0, pitch: 0, health: 20, dead: false,
      held: 0, sneaking: false, swing: 0, aiming: false, reloading: false,
      regenTimer: 0, regenBoostTimer: 0, regenBoostInterval: 0,
      duelSpawnIndex: -1, duelLastShotAt: -Infinity, duelNextBurstAt: 0, duelBurstShots: 0,
      duelShotTickets: [], duelLoaded: 0, duelReloadUntil: 0, duelMedkits: 0, duelRespawning: false,
      arenaTrack: [],
    };
  }

  private holder(id: number): string { return `s:${id}`; }

  /** The socket closed. Everything the player held is released. */
  disconnect(id: number): Outbound[] {
    const p = this.players.get(id);
    if (!p || p.bot) return [];
    const out: Outbound[] = [];
    this.leaveQueue(p);
    if (p.worldId !== null) out.push(...this.exitMatch(p, false));
    out.push(...this.leaveParty(p, false));
    this.names.releaseAll(this.holder(id));
    this.players.delete(id);
    return out;
  }

  // ── Message entry point ──────────────────────────────────────────────────

  handle(id: number, msg: ClientMsg): Outbound[] {
    const p = this.players.get(id);
    if (!p || p.bot || !msg || typeof msg !== 'object') return [];
    if (!p.ready) return msg.t === 'hello' ? this.hello(p, msg) : [];
    switch (msg.t) {
      case 'hello': return [];
      case 'rollName': return this.rollName(p);
      case 'register': return this.register(p, msg.username, msg.password);
      case 'login': return this.login(p, msg.username, msg.password);
      case 'logout': return this.logout(p);
      case 'cosmetics': return this.setCosmetics(p, msg.c);
      case 'partyCreate': return this.partyCreate(p);
      case 'partyJoin': return this.partyJoin(p, msg.code);
      case 'partyLeave': return this.leaveParty(p, true);
      case 'partyKick': return this.partyKick(p, msg.id);
      case 'partyPromote': return this.partyPromote(p, msg.id);
      case 'play': return isGameMode(msg.mode) ? this.play(p, msg.mode) : [];
      case 'cancelQueue': {
        if (!p.queue) return [this.to(p, { t: 'queue', mode: null })];
        this.leaveQueue(p);
        return [this.to(p, { t: 'queue', mode: null }), ...this.partyBroadcast(p.id)];
      }
      case 'leaveMatch': return p.worldId !== null ? this.exitMatch(p, true) : [this.to(p, { t: 'leftWorld' })];
      default: return this.handleInWorld(p, msg);
    }
  }

  private to(p: ServerPlayer | number, msg: ServerMsg): Outbound {
    return { to: typeof p === 'number' ? p : p.id, msg };
  }

  // ── Identity ─────────────────────────────────────────────────────────────

  private hello(p: ServerPlayer, msg: Extract<ClientMsg, { t: 'hello' }>): Outbound[] {
    p.ready = true;
    const holder = this.holder(p.id);
    const out: Outbound[] = [];
    const s = msg.session;
    if (s && typeof s.username === 'string' && typeof s.token === 'string') {
      const res = this.accounts.sessionLogin(s.username, s.token);
      if (res.ok && res.account && this.names.claimAccount(res.account.username, holder)) {
        const a = res.account;
        const token = this.makeToken();
        this.accounts.setToken(a.username, token);
        this.onAccountsChanged?.();
        p.username = a.username; p.skin = skinSeed(a.username); p.account = true;
        p.cosmetics = a.cosmetics;
        out.push(this.to(p, { t: 'welcome', id: p.id, username: p.username, account: true, cosmetics: p.cosmetics }));
        out.push(this.to(p, { t: 'identity', username: p.username, account: true, token, cosmetics: p.cosmetics }));
        return out;
      }
    }
    const want = msg.guest;
    p.username = isGeneratedName(want) && this.names.claim(want, holder) ? want : this.names.roll(holder, this.rng);
    p.skin = skinSeed(p.username);
    p.account = false;
    if (msg.cosmetics !== undefined) p.cosmetics = sanitizeCosmetics(msg.cosmetics, p.skin);
    out.push(this.to(p, { t: 'welcome', id: p.id, username: p.username, account: false, cosmetics: p.cosmetics }));
    return out;
  }

  private rollName(p: ServerPlayer): Outbound[] {
    if (p.account) return [];
    const holder = this.holder(p.id);
    if (p.nameOffer && p.nameOffer !== p.username) this.names.release(p.nameOffer, holder);
    p.nameOffer = this.names.roll(holder, this.rng);
    return [this.to(p, { t: 'nameOffer', name: p.nameOffer })];
  }

  private authErr(p: ServerPlayer, error: string): Outbound[] {
    return [this.to(p, { t: 'authErr', error })];
  }

  /** Swap this session's name, keeping party and queue state. */
  private rename(p: ServerPlayer, name: string): void {
    const holder = this.holder(p.id);
    if (p.username && p.username.toLowerCase() !== name.toLowerCase()) this.names.release(p.username, holder);
    if (p.nameOffer && p.nameOffer.toLowerCase() !== name.toLowerCase()) this.names.release(p.nameOffer, holder);
    p.nameOffer = undefined;
    p.username = name;
    p.skin = skinSeed(name);
  }

  private register(p: ServerPlayer, username: unknown, password: unknown): Outbound[] {
    if (p.account) return this.authErr(p, 'You are already signed in.');
    if (p.worldId !== null) return this.authErr(p, 'Finish your match first.');
    if (typeof username !== 'string' || typeof password !== 'string') return this.authErr(p, 'Pick a name and a passphrase.');
    const name = username === p.username ? p.username : username === p.nameOffer ? p.nameOffer : '';
    if (!name) return this.authErr(p, 'That name isn’t yours to register — roll again.');
    const res = this.accounts.register(name, password, this.hasher, this.makeSalt(), this.wallNow());
    if (!res.ok || !res.account) return this.authErr(p, res.error ?? 'Could not create the account.');
    this.rename(p, res.account.username);
    this.names.claimAccount(res.account.username, this.holder(p.id));
    p.account = true;
    if (p.cosmetics) this.accounts.setCosmetics(p.username, p.cosmetics);
    const token = this.makeToken();
    this.accounts.setToken(p.username, token);
    // Whatever the practice opponents learned about this player so far comes along.
    for (const mode of ['duels', 'bridge', 'parkour'] as GameMode[]) {
      const learned = this.guestSkill.get(`${mode}:${p.username.toLowerCase()}`);
      if (learned !== undefined) this.accounts.setSkill(p.username, mode, learned);
    }
    this.onAccountsChanged?.();
    return [this.to(p, { t: 'identity', username: p.username, account: true, token, cosmetics: p.cosmetics }),
      ...this.partyBroadcast(p.id)];
  }

  private login(p: ServerPlayer, username: unknown, password: unknown): Outbound[] {
    if (p.account) return this.authErr(p, 'You are already signed in.');
    if (p.worldId !== null) return this.authErr(p, 'Finish your match first.');
    if (typeof username !== 'string' || typeof password !== 'string') return this.authErr(p, 'Enter your name and passphrase.');
    const res = this.accounts.login(username.trim(), password, this.hasher);
    if (!res.ok || !res.account) return this.authErr(p, res.error ?? 'Wrong name or passphrase.');
    const a = res.account;
    if (!this.names.claimAccount(a.username, this.holder(p.id))) {
      return this.authErr(p, 'That account is already playing somewhere else.');
    }
    this.rename(p, a.username);
    p.account = true;
    if (a.cosmetics) p.cosmetics = a.cosmetics;
    else if (p.cosmetics) this.accounts.setCosmetics(a.username, p.cosmetics);
    const token = this.makeToken();
    this.accounts.setToken(a.username, token);
    this.onAccountsChanged?.();
    return [this.to(p, { t: 'identity', username: p.username, account: true, token, cosmetics: p.cosmetics }),
      ...this.partyBroadcast(p.id)];
  }

  private logout(p: ServerPlayer): Outbound[] {
    if (!p.account) return [];
    if (p.worldId !== null) return this.authErr(p, 'Finish your match first.');
    const holder = this.holder(p.id);
    this.names.release(p.username, holder);
    this.accounts.setToken(p.username, undefined);
    this.onAccountsChanged?.();
    p.account = false;
    p.username = this.names.roll(holder, this.rng);
    p.skin = skinSeed(p.username);
    p.cosmetics = undefined;
    return [this.to(p, { t: 'identity', username: p.username, account: false }), ...this.partyBroadcast(p.id)];
  }

  private setCosmetics(p: ServerPlayer, raw: unknown): Outbound[] {
    p.cosmetics = sanitizeCosmetics(raw, p.skin);
    if (p.account) { this.accounts.setCosmetics(p.username, p.cosmetics); this.onAccountsChanged?.(); }
    const out: Outbound[] = [];
    const w = p.worldId !== null ? this.worlds.get(p.worldId) : undefined;
    if (w) for (const id of w.members) if (id !== p.id) out.push(this.to(id, { t: 'cosmetics', id: p.id, c: p.cosmetics }));
    out.push(...this.partyBroadcast(p.id));
    return out;
  }

  // ── Parties ──────────────────────────────────────────────────────────────

  private partyState(party: Party): PartyState {
    return {
      code: party.code, leader: party.leader,
      members: party.members.map((id) => {
        const m = this.players.get(id)!;
        return {
          id, username: m.username, skin: m.skin, cosmetics: m.cosmetics,
          status: m.worldId !== null ? 'match' : m.queue ? 'queue' : 'menu',
        };
      }),
    };
  }

  /** Re-send the party panel to every member of `id`'s party. */
  private partyBroadcast(id: number): Outbound[] {
    const party = this.parties.of(id);
    if (!party) return [];
    const state = this.partyState(party);
    return party.members.map((m) => this.to(m, { t: 'party', party: state }));
  }

  private partyErr(p: ServerPlayer, message: string): Outbound[] {
    return [this.to(p, { t: 'partyErr', message })];
  }

  private partyCreate(p: ServerPlayer): Outbound[] {
    if (this.parties.of(p.id)) return this.partyBroadcast(p.id);
    this.parties.create(p.id, this.wallNow());
    return this.partyBroadcast(p.id);
  }

  private partyJoin(p: ServerPlayer, code: unknown): Outbound[] {
    const current = this.parties.of(p.id);
    if (current) {
      if (typeof code === 'string' && current.code === code.toUpperCase().trim()) return this.partyBroadcast(p.id);
      return this.partyErr(p, 'Leave your current party first.');
    }
    if (p.worldId !== null) return this.partyErr(p, 'Finish your match first.');
    const res = this.parties.join(p.id, typeof code === 'string' ? code : '');
    if (!res.ok) {
      const copy = { invalid: 'No party has that code.', full: `That party is full (${PARTY_MAX} max).`,
        already: 'Leave your current party first.', busy: 'That party is busy.' };
      return this.partyErr(p, copy[res.error]);
    }
    const out: Outbound[] = [];
    // Searching alone no longer makes sense: you play with the party now.
    for (const id of res.party.members) {
      const m = this.players.get(id);
      if (m?.queue) { this.leaveQueue(m); out.push(this.to(m, { t: 'queue', mode: null })); }
    }
    out.push(...this.partyBroadcast(p.id));
    return out;
  }

  private leaveParty(p: ServerPlayer, notify: boolean): Outbound[] {
    const party = this.parties.of(p.id);
    if (!party) return notify ? [this.to(p, { t: 'party', party: null })] : [];
    const left = this.parties.leave(p.id, this.wallNow());
    const out: Outbound[] = notify ? [this.to(p, { t: 'party', party: null })] : [];
    if (left.party) {
      const state = this.partyState(left.party);
      for (const m of left.party.members) out.push(this.to(m, { t: 'party', party: state }));
    }
    return out;
  }

  private partyKick(p: ServerPlayer, target: unknown): Outbound[] {
    const party = this.parties.of(p.id);
    if (!party || party.leader !== p.id || typeof target !== 'number' || target === p.id ||
        !party.members.includes(target)) return [];
    const victim = this.players.get(target);
    if (!victim) return [];
    const out = this.leaveParty(victim, true);
    out.push(this.to(victim, { t: 'notice', text: 'You were removed from the party.' }));
    return out;
  }

  private partyPromote(p: ServerPlayer, target: unknown): Outbound[] {
    if (typeof target !== 'number' || !this.parties.promote(p.id, target)) return [];
    return this.partyBroadcast(p.id);
  }

  // ── Play / matchmaking ───────────────────────────────────────────────────

  private leaveQueue(p: ServerPlayer): void {
    p.queue = null;
    p.queuedAt = 0;
  }

  /** Is this player's current world a finished match they can walk out of? */
  private inFinishedWorld(p: ServerPlayer): boolean {
    const w = p.worldId !== null ? this.worlds.get(p.worldId) : undefined;
    return !!w && w.closeAt !== null;
  }

  private play(p: ServerPlayer, mode: GameMode): Outbound[] {
    const out: Outbound[] = [];
    if (p.worldId !== null) {
      if (!this.inFinishedWorld(p)) return this.partyErr(p, 'You are already in a match.');
      out.push(...this.exitMatch(p, true));
    }
    const party = this.parties.of(p.id);
    if (party && party.members.length > 1) {
      if (party.leader !== p.id) return [...out, ...this.partyErr(p, 'Only the party leader can start a game.')];
      const size = party.members.length;
      if (size > partyCapacityFor(mode)) {
        return [...out, ...this.partyErr(p, mode === 'bridge'
          ? 'The Bridge is 1v1 — it needs a party of exactly 2.'
          : `${MODE_NAMES[mode]} holds at most ${partyCapacityFor(mode)} players.`)];
      }
      const members = party.members.map((id) => this.players.get(id)).filter((m): m is ServerPlayer => !!m);
      for (const m of members) {
        if (m.worldId !== null && !this.inFinishedWorld(m)) {
          return [...out, ...this.partyErr(p, `Wait for ${m.id === p.id ? 'your' : `${m.username}’s`} match to finish.`)];
        }
      }
      for (const m of members) {
        if (m.worldId !== null) out.push(...this.exitMatch(m, true));
        if (m.queue) { this.leaveQueue(m); out.push(this.to(m, { t: 'queue', mode: null })); }
      }
      out.push(...this.launch(mode, members, true));
      return out;
    }
    // Solo: the public queue.
    if (p.queue === mode) return [...out, this.to(p, { t: 'queue', mode })];
    p.queue = mode;
    p.queuedAt = this.worldTime * 1000;
    out.push(this.to(p, { t: 'queue', mode }), ...this.partyBroadcast(p.id));
    out.push(...this.matchQueue(mode));
    return out;
  }

  /** Pair waiting humans, oldest first. */
  private matchQueue(mode: GameMode): Outbound[] {
    const waiting = [...this.players.values()]
      .filter((v) => !v.bot && v.ready && v.queue === mode && v.worldId === null)
      .sort((a, b) => a.queuedAt - b.queuedAt || a.id - b.id);
    const out: Outbound[] = [];
    while (waiting.length >= 2) {
      const pair = waiting.splice(0, 2);
      for (const m of pair) { this.leaveQueue(m); out.push(this.to(m, { t: 'queue', mode: null })); }
      out.push(...this.launch(mode, pair, false));
    }
    return out;
  }

  /** Anyone who has waited alone long enough gets a practice opponent. */
  private fillWithBots(): Outbound[] {
    const now = this.worldTime * 1000, out: Outbound[] = [];
    for (const p of [...this.players.values()]) {
      if (p.bot || !p.queue || p.worldId !== null || now - p.queuedAt < BOT_WAIT_MS) continue;
      const mode = p.queue;
      this.leaveQueue(p);
      out.push(this.to(p, { t: 'queue', mode: null }));
      out.push(...this.launch(mode, [p, this.makeBot()], false));
    }
    return out;
  }

  private makeBot(): ServerPlayer {
    const id = this.nextPlayerId++;
    const bot = this.blankPlayer(id, '', true);
    bot.username = this.names.roll(`bot:${id}`, this.rng);
    bot.skin = skinSeed(bot.username);
    // Half turn up in a look of their own, half in the default one, the way
    // real players do.
    if (this.rng() < 0.5) bot.cosmetics = randomCosmetics(this.rng);
    this.players.set(id, bot);
    return bot;
  }

  private removeBot(id: number): void {
    const bot = this.players.get(id);
    if (!bot?.bot) return;
    this.names.releaseAll(`bot:${id}`);
    this.duelBots.delete(id);
    this.partyBots.delete(id);
    this.partyMoves.delete(id);
    this.partyCombat.delete(id);
    this.players.delete(id);
  }

  private skillKey(mode: GameMode, name: string): string { return `${mode}:${name.toLowerCase()}`; }
  /** The hidden level practice opponents last settled at against this player. */
  private learnedSkill(p: ServerPlayer, mode: GameMode): number | undefined {
    return p.account ? this.accounts.skillOf(p.username, mode) : this.guestSkill.get(this.skillKey(mode, p.username));
  }
  private rememberSkill(p: ServerPlayer, mode: GameMode, value: number): void {
    if (!Number.isFinite(value)) return;
    if (p.account) { this.accounts.setSkill(p.username, mode, value); this.onAccountsChanged?.(); }
    else this.guestSkill.set(this.skillKey(mode, p.username), value);
  }

  // ── Worlds ───────────────────────────────────────────────────────────────

  private createWorld(mode: GameMode, seed: number, lobby: string, party: boolean): MatchWorld {
    const spec: WorldSpec = { id: this.nextWorldId++, kind: MODE_TO_KIND[mode], seed };
    const w: MatchWorld = {
      spec, blocks: new WorldBlocks(worldGenerator(spec)), mode, lobby, members: new Set(), party,
      closeAt: null, cagesOpen: false,
      parkour: mode === 'parkour' ? { blink: [true, true], collapsed: 0, crumbles: new Map() } : null,
      arrows: [],
    };
    this.worlds.set(spec.id, w);
    this.worldByLobby.set(lobby, spec.id);
    return w;
  }

  private worldOfPlayer(p: ServerPlayer): MatchWorld | undefined {
    return p.worldId !== null ? this.worlds.get(p.worldId) : undefined;
  }

  private info(p: ServerPlayer): PlayerInfo {
    return {
      id: p.id, username: p.username, skin: p.skin, cosmetics: p.cosmetics,
      x: p.x, y: p.y, z: p.z, yaw: p.yaw, pitch: p.pitch, health: p.health, dead: p.dead,
      sneaking: p.sneaking, held: p.held, swing: p.swing, aiming: p.aiming, reloading: p.reloading,
    };
  }

  /** Put a body into a world and introduce it to everybody already there. */
  private enterWorld(p: ServerPlayer, w: MatchWorld): Outbound[] {
    const out: Outbound[] = [];
    p.worldId = w.spec.id;
    for (const id of w.members) {
      const other = this.players.get(id);
      if (!other) continue;
      out.push(this.to(id, { t: 'join', player: this.info(p) }));
      out.push(this.to(p, { t: 'join', player: this.info(other) }));
    }
    w.members.add(p.id);
    return out;
  }

  /** Take one player out of their match and back to the menu. A live match
   *  counts it as a forfeit. */
  private exitMatch(p: ServerPlayer, notify: boolean): Outbound[] {
    const w = this.worldOfPlayer(p);
    const out: Outbound[] = [];
    if (!w) { p.worldId = null; return notify ? [this.to(p, { t: 'leftWorld' })] : []; }
    if (w.mode === 'duels') {
      const res = this.duels.leave(p.id, this.nowMs());
      if (res.snapshot) out.push(...this.duelStateOut(res.snapshot), ...this.duelResultOut(res.snapshot));
    } else {
      const res = this.pg.leave(p.id, this.nowMs());
      if (res.snapshot) out.push(...this.pgStateOut(res.snapshot), ...this.pgResultOut(res.snapshot));
    }
    this.detach(p, w, out);
    if (notify) out.push(this.to(p, { t: 'leftWorld' }));
    out.push(...this.partyBroadcast(p.id));
    // A world with no humans left has nothing to show anybody.
    if (![...w.members].some((id) => !this.players.get(id)?.bot)) out.push(...this.closeWorld(w));
    else this.markFinishedIfDone(w);
    return out;
  }

  /** Remove a body from a world's roster and tell the rest. */
  private detach(p: ServerPlayer, w: MatchWorld, out: Outbound[]): void {
    w.members.delete(p.id);
    p.worldId = null;
    p.arenaTrack = [];
    p.duelShotTickets = [];
    this.partyMoves.delete(p.id);
    this.partyCombat.delete(p.id);
    w.arrows = w.arrows.filter((a) => a.owner !== p.id);
    for (const id of w.members) out.push(this.to(id, { t: 'leave', id: p.id }));
  }

  /** A results screen is up: the world closes after it has been read. */
  private markFinishedIfDone(w: MatchWorld): void {
    if (w.closeAt !== null) return;
    const phase = w.mode === 'duels'
      ? this.duels.snapshots(this.nowMs()).find((s) => s.id === w.lobby)?.phase
      : this.pg.snapshots(this.nowMs()).find((s) => s.id === w.lobby)?.phase;
    if (phase === 'results') w.closeAt = this.worldTime + RESULTS_LINGER_S;
  }

  /** Tear a world down: everybody back to the menu, bots dismissed, blocks
   *  and caches freed. */
  private closeWorld(w: MatchWorld): Outbound[] {
    const out: Outbound[] = [];
    const now = this.nowMs();
    for (const id of [...w.members]) {
      const p = this.players.get(id);
      if (!p) { w.members.delete(id); continue; }
      if (w.mode === 'duels') this.duels.leave(id, now); else this.pg.leave(id, now);
      if (p.bot) {
        this.settleBot(p, w);
        w.members.delete(id);
        this.removeBot(id);
        continue;
      }
      w.members.delete(id);
      p.worldId = null;
      p.arenaTrack = [];
      this.partyMoves.delete(id);
      this.partyCombat.delete(id);
      out.push(this.to(p, { t: 'leftWorld' }), ...this.partyBroadcast(id));
    }
    this.worlds.delete(w.spec.id);
    this.worldByLobby.delete(w.lobby);
    releaseWorldGenerator(w.spec);
    return out;
  }

  /** A practice opponent is leaving: remember the level it ended at. */
  private settleBot(bot: ServerPlayer, w: MatchWorld): void {
    const db = this.duelBots.get(bot.id), pb = this.partyBots.get(bot.id);
    const human = this.players.get(db?.opponent ?? pb?.opponent ?? -1);
    const rating = db?.rating ?? pb?.rating;
    if (human && !human.bot && rating !== undefined) this.rememberSkill(human, w.mode, rating);
  }

  private nowMs(): number { return this.worldTime * 1000; }

  // ── Launching a match ────────────────────────────────────────────────────

  private launch(mode: GameMode, members: ServerPlayer[], party: boolean): Outbound[] {
    return mode === 'duels' ? this.launchDuel(members, party) : this.launchPg(mode, members, party);
  }

  private launchDuel(members: ServerPlayer[], party: boolean): Outbound[] {
    const now = this.nowMs();
    const ident = (m: ServerPlayer) => ({ id: m.id, username: m.username, skin: m.skin, bot: m.bot });
    const made = this.duels.create(ident(members[0]), now);
    if ('reason' in made) return [];
    for (const m of members.slice(1)) this.duels.join(made.token, ident(m), now);
    for (const m of members) this.duels.setReady(m.id, true, now);
    const started = this.duels.start(members[0].id, now);
    if (!started.ok) {
      for (const m of members) this.duels.leave(m.id, now);
      return members.filter((m) => !m.bot).map((m) => this.to(m, { t: 'notice', text: 'Could not start the match — try again.' }));
    }
    const snap = started.snapshot;
    const arena = snap.arena!;
    const w = this.createWorld('duels', 1, snap.id, party);
    const out: Outbound[] = [];
    snap.participants.forEach((part, i) => {
      const p = this.players.get(part.id);
      if (!p) return;
      out.push(...this.enterWorld(p, w));
      out.push(...this.enterDuelBody(p, w, arena, i));
    });
    // Practice opponents are "loaded" the moment they exist.
    for (const m of members) {
      if (!m.bot) continue;
      const opp = members.find((h) => !h.bot) ?? members.find((h) => h !== m)!;
      const bot = new DuelBot(opp.id, opp.bot ? undefined : this.learnedSkill(opp, 'duels'), { x: m.x, y: m.y, z: m.z }, this.rng);
      this.duelBots.set(m.id, bot);
      this.duels.markArenaReady(m.id, now);
    }
    const latest = this.duels.snapshotFor(members[0].id, now);
    if (latest) out.push(...this.duelStateOut(latest));
    for (const m of members) out.push(...this.partyBroadcast(m.id));
    return out;
  }

  private launchPg(mode: GameMode, members: ServerPlayer[], party: boolean): Outbound[] {
    const now = this.nowMs();
    const pgMode: PartyMode = mode === 'bridge' ? 'bridge' : 'parkour';
    const ident = (m: ServerPlayer) => ({ id: m.id, username: m.username, skin: m.skin, bot: m.bot });
    const made = this.pg.create(ident(members[0]), now, pgMode, partyModeCapacity(pgMode, party));
    if ('reason' in made) return [];
    for (const m of members.slice(1)) this.pg.join(made.token, ident(m), now);
    for (const m of members) this.pg.setReady(m.id, true, now);
    const started = this.pg.start(members[0].id, now);
    if (!started.ok) {
      for (const m of members) this.pg.leave(m.id, now);
      return members.filter((m) => !m.bot).map((m) => this.to(m, { t: 'notice', text: 'Could not start the match — try again.' }));
    }
    const snap = started.snapshot;
    const w = this.createWorld(mode, snap.arena!.seed, snap.id, party);
    const out: Outbound[] = [];
    const sub = snap.sub!;
    const spawns = partySpawns(sub, snap.participants);
    snap.participants.forEach((member, i) => {
      const p = this.players.get(member.id);
      if (!p || !member.connected) return;
      const yaw = sub.game === 'bridge' ? (member.team === 0 ? Math.PI : 0) : Math.PI;
      this.resetBody(p, spawns[i], yaw, PARTY_MAX_HEALTH);
      this.partyMoves.set(p.id, this.freshPartyMove(spawns[i], snap.revision));
      this.partyCombat.delete(p.id);
      out.push(...this.enterWorld(p, w));
      out.push(this.pgLoadout(p, member, sub));
      out.push(this.to(p, { t: 'pgArena', world: w.spec, arena: snap.arena!, sub, team: member.team,
        spawn: spawns[i], countdownEndsAt: snap.countdownEndsAt ?? 0, revision: snap.revision }));
    });
    for (const m of members) {
      if (!m.bot) continue;
      const opp = members.find((h) => !h.bot) ?? members.find((h) => h !== m)!;
      const bot = this.pgBotFactory(opp.id, { x: m.x, y: m.y, z: m.z }, this.rng,
        opp.bot ? undefined : this.learnedSkill(opp, mode));
      bot.body.yaw = m.yaw;
      this.partyBots.set(m.id, bot);
      this.pg.markArenaReady(m.id, now, snap.revision);
    }
    const latest = this.pg.snapshotFor(members[0].id, now);
    if (latest) out.push(...this.pgStateOut(latest));
    for (const m of members) out.push(...this.partyBroadcast(m.id));
    return out;
  }

  /** Reset a body onto a spawn, at full health, with fresh combat clocks. */
  private resetBody(p: ServerPlayer, spawn: { x: number; y: number; z: number }, yaw: number, health: number): void {
    p.x = spawn.x; p.y = spawn.y; p.z = spawn.z; p.yaw = yaw; p.pitch = 0;
    p.health = health; p.dead = false; p.sneaking = false; p.aiming = false; p.reloading = false;
    p.regenTimer = 0; p.regenBoostTimer = 0; p.regenBoostInterval = 0;
    p.arenaTrack = [];
    this.recordArenaTrack(p);
  }

  // ── In-world message routing ─────────────────────────────────────────────

  private handleInWorld(p: ServerPlayer, msg: ClientMsg): Outbound[] {
    const w = this.worldOfPlayer(p);
    if (!w) return [];
    if (msg.t === 'worldReady') {
      if (msg.world !== w.spec.id) return [];
      if (w.mode === 'duels') {
        const snap = this.duels.markArenaReady(p.id, this.nowMs());
        return snap ? this.duelStateOut(snap) : [];
      }
      const snap = this.pg.markArenaReady(p.id, this.nowMs(), msg.revision);
      return snap ? this.pgStateOut(snap) : [];
    }
    if (msg.t === 'xform') {
      if (msg.world !== w.spec.id) return [];
      if (typeof msg.ct === 'number' && Number.isFinite(msg.ct)) p.ct = Math.floor(msg.ct);
      return w.mode === 'duels' ? this.handleDuelTransform(p, w, msg) : this.handlePartyTransform(p, w, msg);
    }
    if (w.mode === 'duels') {
      if (msg.t === 'shot') return this.handleDuelShot(p, msg);
      if (msg.t === 'rangedAttack') return this.handleDuelRanged(p, w, msg.target, msg.amount);
      if (msg.t === 'useHeal') return this.handleDuelHeal(p, msg.item);
      if (msg.t === 'edit') return this.handleDuelEdit(p, w, msg.x, msg.y, msg.z, msg.block);
      return [];
    }
    if (msg.t === 'pgRetry') {
      const sub = this.pg.subFor(p.id);
      if (sub?.game === 'parkour' && parkourCourse(sub.seed).variant.mode !== 'collapse' &&
          this.pg.phaseFor(p.id) === 'running' &&
          this.nowMs() >= (this.pg.participantFor(p.id)?.immuneUntil ?? Infinity)) {
        return this.evaluatePartyPlayer(p, w, true);
      }
      return [];
    }
    if (msg.t === 'pgMelee') return this.handlePartyMelee(p, w, msg.target);
    if (msg.t === 'pgShoot') return this.handlePartyShoot(p, w, msg);
    if (msg.t === 'edit') return this.handlePartyEdit(p, w, msg.x, msg.y, msg.z, msg.block);
    return [];
  }

  // ── Duels ────────────────────────────────────────────────────────────────

  /** Strip server-only fields (who is a bot) before a snapshot leaves. */
  private cleanDuel(snapshot: DuelLobbySnapshot): DuelLobbySnapshot {
    const strip = <T extends { bot?: boolean }>(v: T): T => { const c = { ...v }; delete c.bot; return c; };
    return {
      ...snapshot, arenaReady: undefined,
      participants: snapshot.participants.map(strip),
      result: snapshot.result ? { ...snapshot.result, scoreboard: snapshot.result.scoreboard.map(strip) } : undefined,
    };
  }

  private duelStateOut(snapshot: DuelLobbySnapshot): Outbound[] {
    const clean = this.cleanDuel(snapshot);
    return snapshot.participants
      .filter((v) => v.connected && !this.players.get(v.id)?.bot)
      .map((v) => this.to(v.id, { t: 'duelState', snapshot: clean }));
  }

  private duelResultOut(snapshot: DuelLobbySnapshot): Outbound[] {
    if (snapshot.phase !== 'results' || !snapshot.result) return [];
    const w = this.worlds.get(this.worldByLobby.get(snapshot.id) ?? -1);
    if (w && w.closeAt === null) w.closeAt = this.worldTime + RESULTS_LINGER_S;
    const clean = this.cleanDuel(snapshot).result!;
    return snapshot.participants.filter((v) => v.connected && !this.players.get(v.id)?.bot)
      .map((v) => this.to(v.id, { t: 'duelResult', result: clean }));
  }

  private duelLoadout(to: number): Outbound {
    const slots: (ItemStack | null)[] = new Array(36).fill(null);
    slots[0] = { id: Item.BurstRifle, count: 1, loaded: 24 };
    slots[1] = { id: Block.OakPlanks, count: 64 };
    slots[2] = { id: Item.IronAxe, count: 1 };
    slots[3] = { id: Item.JumpBoost, count: 5 };
    slots[4] = { id: Item.Medkit, count: 5 };
    return this.to(to, { t: 'duelLoadout', slots, selected: 0 });
  }

  private enterDuelBody(p: ServerPlayer, w: MatchWorld, arena: DuelArenaBounds, spawnIndex: number): Outbound[] {
    const index = ((spawnIndex % arena.spawns.length) + arena.spawns.length) % arena.spawns.length;
    const spawn = arena.spawns[index];
    this.resetBody(p, spawn, index < 2 ? Math.PI : 0, DUEL_MAX_HEALTH);
    p.duelSpawnIndex = index;
    p.held = Item.BurstRifle;
    p.duelLastShotAt = -Infinity; p.duelNextBurstAt = 0; p.duelBurstShots = 0;
    p.duelShotTickets = []; p.duelLoaded = 24; p.duelReloadUntil = 0;
    p.duelMedkits = 5; p.duelRespawning = false;
    if (p.bot) return [];
    return [
      this.duelLoadout(p.id),
      this.to(p, { t: 'duelArena', world: w.spec, arena, spawn: { ...spawn },
        countdownEndsAt: this.duels.snapshotFor(p.id, this.nowMs())?.countdownEndsAt ?? 0 }),
    ];
  }

  private duelBodyClear(w: MatchWorld, x: number, y: number, z: number): boolean {
    for (const ox of [-0.28, 0.28]) for (const oz of [-0.28, 0.28]) {
      for (const oy of [0.05, 0.9, 1.75]) {
        if (w.blocks.solidAt(x + ox, y + oy, z + oz)) return false;
      }
    }
    return true;
  }

  private duelBodyPathClear(w: MatchWorld, from: { x: number; y: number; z: number },
    to: { x: number; y: number; z: number }): boolean {
    const distance = Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z);
    const steps = Math.max(1, Math.ceil(distance * 3));
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      if (!this.duelBodyClear(w, from.x + (to.x - from.x) * t,
        from.y + (to.y - from.y) * t, from.z + (to.z - from.z) * t)) return false;
    }
    return true;
  }

  private handleDuelTransform(p: ServerPlayer, w: MatchWorld, msg: Extract<ClientMsg, { t: 'xform' }>): Outbound[] {
    const arena = this.duels.arenaFor(p.id), phase = this.duels.phaseFor(p.id);
    if (!arena || !phase || !fin(msg.x, msg.y, msg.z, msg.yaw, msg.pitch)) return [];
    const participant = this.duels.participantFor(p.id);
    if (!participant) return [];
    const wanted = phase === 'countdown' ? arena.spawns[Math.max(0, p.duelSpawnIndex)]
      : clampToDuelArena({ x: msg.x, y: msg.y, z: msg.z }, arena);
    if (participant.spectating || this.duelBodyPathClear(w, p, wanted)) {
      p.x = wanted.x; p.y = wanted.y; p.z = wanted.z;
    }
    p.yaw = msg.yaw; p.pitch = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, msg.pitch));
    p.sneaking = msg.sneaking === true;
    p.held = participant.alive && (msg.held === Item.BurstRifle || msg.held === Item.IronAxe ||
      msg.held === Block.OakPlanks || msg.held === Item.Medkit || msg.held === Item.JumpBoost) ? msg.held : 0;
    p.aiming = p.held === Item.BurstRifle && msg.aiming === true;
    if (p.held === Item.BurstRifle && msg.reloading === true && p.duelLoaded < 24 && p.duelReloadUntil <= 0) {
      p.duelReloadUntil = this.worldTime + 1.1;
    }
    p.reloading = p.duelReloadUntil > this.worldTime;
    if (typeof msg.swing === 'number' && Number.isFinite(msg.swing)) p.swing = Math.floor(msg.swing) & 0xffff;
    this.recordArenaTrack(p);
    return [];
  }

  private recordArenaTrack(p: ServerPlayer): void {
    const now = this.worldTime;
    p.arenaTrack.push({ at: now, x: p.x, y: p.y, z: p.z });
    let drop = 0;
    while (drop < p.arenaTrack.length && now - p.arenaTrack[drop].at > DUEL_TRACK_WINDOW) drop++;
    if (drop > 0) p.arenaTrack.splice(0, drop);
  }

  private handleDuelShot(p: ServerPlayer, msg: Extract<ClientMsg, { t: 'shot' }>): Outbound[] {
    const phase = this.duels.phaseFor(p.id), participant = this.duels.participantFor(p.id);
    if ((phase !== 'running' && phase !== 'sudden_death') || !participant?.alive ||
        p.held !== Item.BurstRifle || msg.item !== Item.BurstRifle ||
        !fin(msg.x, msg.y, msg.z, msg.dx, msg.dy, msg.dz)) return [];
    if (Math.hypot(msg.x - p.x, msg.y - (p.y + 1.6), msg.z - p.z) > 4) return [];
    const len = Math.hypot(msg.dx, msg.dy, msg.dz);
    if (!(len > 1e-3)) return [];
    const now = this.worldTime;
    if (p.duelReloadUntil > 0 && now >= p.duelReloadUntil) {
      p.duelLoaded = 24; p.duelReloadUntil = 0; p.reloading = false;
    }
    if (p.duelReloadUntil > now || p.duelLoaded <= 0 || now - p.duelLastShotAt < 0.04) return [];
    // A trigger opens one three-round burst and a fixed half-second window.
    if (p.duelBurstShots === 0 || now - p.duelLastShotAt > 0.18) {
      if (now < p.duelNextBurstAt) return [];
      p.duelBurstShots = 1; p.duelNextBurstAt = now + 0.5;
    } else {
      p.duelBurstShots++;
    }
    p.duelLastShotAt = now;
    if (p.duelBurstShots >= 3) p.duelBurstShots = 0;
    p.duelLoaded--;
    p.duelShotTickets.push({ at: now, x: msg.x, y: msg.y, z: msg.z,
      dx: msg.dx / len, dy: msg.dy / len, dz: msg.dz / len });
    p.duelShotTickets = p.duelShotTickets.filter((t) => now - t.at <= DUEL_TRACK_WINDOW).slice(-6);
    this.duels.removeSpawnShield(p.id);
    return this.duels.membersOf(p.id).filter((id) => id !== p.id && !this.players.get(id)?.bot).map((id) => this.to(id, {
      t: 'shot', id: p.id, item: Item.BurstRifle,
      x: msg.x, y: msg.y, z: msg.z, dx: msg.dx / len, dy: msg.dy / len, dz: msg.dz / len,
    }));
  }

  private handleDuelRanged(attacker: ServerPlayer, w: MatchWorld, targetId: number, amount: number): Outbound[] {
    const target = this.players.get(targetId), arena = this.duels.arenaFor(attacker.id);
    const ap = this.duels.participantFor(attacker.id), tp = this.duels.participantFor(targetId);
    const phase = this.duels.phaseFor(attacker.id), nowMs = this.nowMs();
    if (!target || !arena || !this.duels.sameMatch(attacker.id, targetId) ||
        (phase !== 'running' && phase !== 'sudden_death') || !ap?.alive || !tp?.alive ||
        (tp.shieldUntil !== undefined && tp.shieldUntil > nowMs)) return [];
    if (amount !== 5 || !fin(target.x, target.y, target.z)) return [];
    const distance = Math.hypot(target.x - attacker.x, target.y - attacker.y, target.z - attacker.z);
    if (!(distance > 0 && distance <= 60)) return [];
    const now = this.worldTime;
    // Lag compensation: a ticket counts if its ray passed through the target
    // at ANY point in the target's recorded history since it was fired.
    let ticketIndex = -1, hitAt: ArenaTrackSample | null = null;
    const candidates: ArenaTrackSample[] = [{ at: now, x: target.x, y: target.y, z: target.z }, ...target.arenaTrack];
    for (let i = attacker.duelShotTickets.length - 1; i >= 0 && ticketIndex < 0; i--) {
      const shot = attacker.duelShotTickets[i];
      if (now - shot.at > DUEL_TRACK_WINDOW) continue;
      for (const sample of candidates) {
        if (sample.at < shot.at - 0.15) continue;
        const tx = sample.x - shot.x, ty = sample.y + 0.9 - shot.y, tz = sample.z - shot.z;
        const along = tx * shot.dx + ty * shot.dy + tz * shot.dz;
        if (along < 0 || along > 58) continue;
        const missSq = tx * tx + ty * ty + tz * tz - along * along;
        if (missSq > 1.15 * 1.15) continue;
        ticketIndex = i; hitAt = sample; break;
      }
    }
    if (ticketIndex < 0 || !hitAt) return [];
    const shotFrom = attacker.duelShotTickets[ticketIndex];
    const clear = hasArenaLineOfSight({ x: shotFrom.x, y: shotFrom.y, z: shotFrom.z },
      { x: hitAt.x, y: hitAt.y + 1.0, z: hitAt.z }, arena,
      (x, y, z) => w.blocks.editAt(Math.floor(x), Math.floor(y), Math.floor(z)) === Block.OakPlanks);
    attacker.duelShotTickets.splice(ticketIndex, 1);
    if (!clear) return [];
    return this.applyDuelRound(attacker, target);
  }

  /** One Burst Rifle round that has already been judged a hit. */
  private applyDuelRound(attacker: ServerPlayer, target: ServerPlayer): Outbound[] {
    const nowMs = this.nowMs();
    const dx = target.x - attacker.x, dz = target.z - attacker.z, horiz = Math.hypot(dx, dz);
    const dealt = Math.min(5, target.health);
    target.health = Math.max(0, target.health - 5);
    const killed = target.health <= 0;
    const knockX = horiz > 0 ? dx / horiz : 0, knockZ = horiz > 0 ? dz / horiz : 0;
    const bot = this.duelBots.get(target.id);
    if (bot) { bot.body.vel.x += knockX * 2.2; bot.body.vel.z += knockZ * 2.2; bot.noteHurt(nowMs); }
    const out: Outbound[] = [];
    if (!target.bot) out.push(this.to(target, { t: 'hurt', health: killed ? 1 : target.health, dead: false,
      by: attacker.id, kx: knockX, ky: 0.25, kz: knockZ }));
    if (!attacker.bot) out.push(this.to(attacker, { t: 'hitconfirm', target: target.id, amount: dealt, killed }));
    if (!killed) return out;
    target.health = 1; target.held = 0; target.duelRespawning = true;
    const snapshot = this.duels.recordDeath(target.id, attacker.id, nowMs);
    if (!snapshot) return out;
    const dead = snapshot.participants.find((v) => v.id === target.id)!;
    if (!target.bot) out.push(this.to(target, { t: 'duelRespawn', respawnAt: dead.respawnAt ?? nowMs, spectating: true }));
    out.push(...this.duelStateOut(snapshot));
    for (const id of this.duels.membersOf(attacker.id)) {
      if (!this.players.get(id)?.bot) out.push(this.to(id, { t: 'killfeed', killer: attacker.username, victim: target.username }));
    }
    out.push(...this.duelResultOut(snapshot));
    return out;
  }

  private handleDuelHeal(p: ServerPlayer, item: number): Outbound[] {
    const participant = this.duels.participantFor(p.id), phase = this.duels.phaseFor(p.id);
    if (item !== Item.Medkit || !participant?.alive ||
        (phase !== 'running' && phase !== 'sudden_death') || p.duelMedkits <= 0 || p.health >= DUEL_MAX_HEALTH) return [];
    const heal = ITEMS[Item.Medkit].heal;
    if (!heal) return [];
    p.duelMedkits--;
    p.regenBoostTimer = heal.duration; p.regenBoostInterval = heal.interval; p.regenTimer = 0;
    return [];
  }

  private handleDuelEdit(p: ServerPlayer, w: MatchWorld, x: number, y: number, z: number, block: number): Outbound[] {
    const arena = this.duels.arenaFor(p.id), phase = this.duels.phaseFor(p.id);
    const participant = this.duels.participantFor(p.id);
    if (!arena || !participant?.alive || (phase !== 'running' && phase !== 'sudden_death')) return [];
    if (!fin(x, y, z)) return [];
    const bx = Math.floor(x), by = Math.floor(y), bz = Math.floor(z);
    if (bx < arena.minX || bx >= arena.maxX || bz < arena.minZ || bz >= arena.maxZ) return [];
    if (by < arena.floor || by >= arena.ceiling - 1) return [];
    const groundY = arena.floor + duelTerrainElevation(bx - arena.minX, bz - arena.minZ);
    if (by <= groundY) return [];                              // natural ground is unbreakable
    if (by > groundY + DUEL_MAX_PILLAR_HEIGHT) return [];      // max pillar height
    const broadcast = (b: number) => this.duels.membersOf(p.id).filter((id) => !this.players.get(id)?.bot)
      .map((id) => this.to(id, { t: 'edit', x: bx, y: by, z: bz, block: b }));
    if (block === Block.OakPlanks) {
      if (w.blocks.getBlock(bx, by, bz) !== Block.Air) return [];
      w.blocks.set(bx, by, bz, Block.OakPlanks);
      return broadcast(Block.OakPlanks);
    }
    if (block === Block.Air) {
      // The axe only reclaims player-built cover.
      if (p.held !== Item.IronAxe || w.blocks.editAt(bx, by, bz) !== Block.OakPlanks) return [];
      w.blocks.restore(bx, by, bz);
      return broadcast(Block.Air);
    }
    return [];
  }

  // ── The Bridge / Parkour ─────────────────────────────────────────────────

  private cleanPg(snapshot: PartyLobbySnapshot): PartyLobbySnapshot {
    const strip = <T extends { bot?: boolean }>(v: T): T => { const c = { ...v }; delete c.bot; return c; };
    return {
      ...snapshot,
      participants: snapshot.participants.map(strip),
      result: snapshot.result ? { ...snapshot.result, scoreboard: snapshot.result.scoreboard.map(strip) } : undefined,
    };
  }

  private pgStateOut(snapshot: PartyLobbySnapshot): Outbound[] {
    const clean = this.cleanPg(snapshot);
    return snapshot.participants.filter((v) => v.connected && !this.players.get(v.id)?.bot)
      .map((v) => this.to(v.id, { t: 'pgState', snapshot: clean }));
  }

  private pgResultOut(snapshot: PartyLobbySnapshot): Outbound[] {
    if (snapshot.phase !== 'results' || !snapshot.result) return [];
    const w = this.worlds.get(this.worldByLobby.get(snapshot.id) ?? -1);
    if (w && w.closeAt === null) w.closeAt = this.worldTime + RESULTS_LINGER_S;
    const clean = this.cleanPg(snapshot).result!;
    return snapshot.participants.filter((v) => v.connected && !this.players.get(v.id)?.bot)
      .map((v) => this.to(v.id, { t: 'pgResult', result: clean }));
  }

  /** One infinite stack of your team's wool; The Bridge adds an axe and a bow. */
  private pgLoadout(p: ServerPlayer, member: PartyParticipant, sub: PartySubBounds): Outbound {
    const slots: (ItemStack | null)[] = new Array(36).fill(null);
    slots[0] = { id: BRIDGE_TEAM_BLOCK[member.team] ?? Block.TeamWoolA, count: 64 };
    if (sub.game === 'bridge') {
      slots[1] = { id: Item.IronAxe, count: 1 };
      slots[2] = { id: Item.BridgeBow, count: 1 };
      slots[3] = { id: Item.BridgeArrow, count: 64 };
    }
    p.held = slots[0]?.id ?? 0;
    return this.to(p, { t: 'pgLoadout', slots, selected: 0 });
  }

  private pgMembers(p: ServerPlayer): number[] {
    return this.pg.membersOf(p.id).filter((id) => !this.players.get(id)?.bot);
  }

  private freshPartyMove(p: { x: number; y: number; z: number }, revision: number): PartyMoveState {
    return {
      at: this.worldTime, allowance: 1, revision, groundX: p.x, groundY: p.y, groundZ: p.z,
      groundedAt: this.worldTime, stuck: 0, launchUntil: 0,
    };
  }
  private markPartyGround(move: PartyMoveState, x: number, y: number, z: number): void {
    move.groundX = x; move.groundY = y; move.groundZ = z; move.groundedAt = this.worldTime;
  }
  /** Is a body at (x, y, z) resting on something solid? Tolerant of the few
   *  centimetres a sample taken mid-landing sits off the block surface. */
  private partyGrounded(w: MatchWorld, x: number, y: number, z: number): boolean {
    const by = Math.round(y) - 1;
    if (Math.abs(y - by - 1) > .3) return false;
    return [-.2999, .2999].some((ox) => [-.2999, .2999].some((oz) =>
      w.blocks.solidAt(Math.floor(x + ox), by, Math.floor(z + oz))));
  }

  private handlePartyTransform(p: ServerPlayer, w: MatchWorld, msg: Extract<ClientMsg, { t: 'xform' }>): Outbound[] {
    const sub = this.pg.subFor(p.id), phase = this.pg.phaseFor(p.id), participant = this.pg.participantFor(p.id);
    const round = this.pg.roundFor(p.id);
    if (!sub || !participant || !round || !fin(msg.x, msg.y, msg.z, msg.yaw, msg.pitch)) return [];
    if (msg.revision !== round.revision) return [];
    p.yaw = msg.yaw;
    p.pitch = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, msg.pitch));
    if (phase !== 'running') return [];
    const wanted = clampToPartySub(msg, sub);
    const move = this.partyMoves.get(p.id) ?? this.freshPartyMove(p, round.revision);
    if (this.partyGrounded(w, p.x, p.y, p.z)) this.markPartyGround(move, p.x, p.y, p.z);
    if (sub.game === 'parkour') {
      // A throw pad is the course throwing this player, exactly as knockback is.
      const course = parkourCourse(sub.seed);
      if ([p, wanted].some((at) => parkourPadNear(course, at.x - sub.minX, at.y, at.z - sub.minZ))) {
        if (this.worldTime >= move.launchUntil) move.allowance = Math.max(move.allowance, PARTY_LAUNCH_CAP);
        move.launchUntil = this.worldTime + 1.6;
        move.groundedAt = this.worldTime;
      }
    }
    const launched = this.worldTime < move.launchUntil;
    const rate = launched ? PARTY_LAUNCH_RATE : 6.5, cap = launched ? PARTY_LAUNCH_CAP : 4;
    move.allowance = Math.min(cap, move.allowance + Math.max(0, this.worldTime - move.at) * rate);
    move.at = this.worldTime;
    const distance = Math.hypot(wanted.x - p.x, wanted.z - p.z);
    let clear = distance <= move.allowance && (launched || wanted.y - move.groundY <= 1.6);
    // Anti-flight: hanging at or above your last footing for seconds on end.
    if (!launched && this.worldTime - move.groundedAt > 2.2 && wanted.y >= move.groundY - .15) clear = false;
    const steps = Math.max(1, Math.ceil(Math.hypot(wanted.x - p.x, wanted.y - p.y, wanted.z - p.z) * 4));
    for (let i = 1; clear && i <= steps; i++) {
      const t = i / steps, x = p.x + (wanted.x - p.x) * t, y = p.y + (wanted.y - p.y) * t, z = p.z + (wanted.z - p.z) * t;
      for (const ox of [-.26, .26]) for (const oz of [-.26, .26]) for (const oy of [.06, .9, 1.7]) {
        if (w.blocks.solidAt(x + ox, y + oy, z + oz)) clear = false;
      }
      if (clear && this.partyGrounded(w, x, y, z)) this.markPartyGround(move, x, y, z);
    }
    this.partyMoves.set(p.id, move);
    if (!clear) {
      // A correction the client keeps losing gets settled onto the last
      // footing this player is known to have stood on.
      if (++move.stuck < 12) return [this.to(p, { t: 'teleport', x: p.x, y: p.y, z: p.z })];
      move.stuck = 0; move.allowance = 1; move.groundedAt = this.worldTime; move.launchUntil = 0;
      p.x = move.groundX; p.y = move.groundY; p.z = move.groundZ;
      p.arenaTrack = [];
      this.recordArenaTrack(p);
      return [this.to(p, { t: 'teleport', x: p.x, y: p.y, z: p.z })];
    }
    move.stuck = 0;
    move.allowance -= distance;
    p.x = wanted.x; p.y = wanted.y; p.z = wanted.z;
    if (this.partyGrounded(w, p.x, p.y, p.z)) this.markPartyGround(move, p.x, p.y, p.z);
    p.aiming = false; p.reloading = false;
    const wool = BRIDGE_TEAM_BLOCK[participant.team] ?? Block.TeamWoolA;
    const holdable = sub.game === 'bridge' ? [wool, Item.IronAxe, Item.BridgeBow, Item.BridgeArrow] : [wool];
    p.held = holdable.includes(msg.held as number) ? msg.held as number : 0;
    p.sneaking = msg.sneaking === true;
    if (Number.isFinite(msg.swing)) p.swing = Number(msg.swing) & 0xffff;
    this.recordArenaTrack(p);
    const crumbled = sub.game === 'parkour' ? this.stepOnCrumble(p, w, sub) : [];
    return [...crumbled, ...this.evaluatePartyPlayer(p, w)];
  }

  private evaluatePartyPlayer(p: ServerPlayer, w: MatchWorld, retry = false): Outbound[] {
    const now = this.nowMs(), before = this.pg.phaseFor(p.id);
    const evaluated = this.pg.evaluate(p.id, retry ? { x: p.x, y: PARTY_FLOOR_Y - 30, z: p.z } : p, now);
    const out: Outbound[] = [];
    if (evaluated.spawn) {
      p.x = evaluated.spawn.x; p.y = evaluated.spawn.y; p.z = evaluated.spawn.z;
      const bot = this.partyBots.get(p.id);
      if (bot) {
        bot.reset(evaluated.spawn);
        bot.body.yaw = (this.pg.participantFor(p.id)?.team ?? 0) === 0 ? Math.PI : 0;
      }
      p.health = PARTY_MAX_HEALTH;
      const move = this.partyMoves.get(p.id);
      if (move) {
        move.allowance = 1; move.at = this.worldTime; move.stuck = 0; move.launchUntil = 0;
        this.markPartyGround(move, p.x, p.y, p.z);
      }
      p.arenaTrack = [];
      this.recordArenaTrack(p);
      if (!p.bot) out.push(this.to(p, { t: 'respawned', ...evaluated.spawn, health: PARTY_MAX_HEALTH }));
    }
    if (evaluated.changed) {
      const snap = this.pg.snapshotFor(p.id, now)!;
      out.push(...this.syncPartyCages(w, snap, now));
      out.push(...this.pgStateOut(snap));
      if (before !== snap.phase) out.push(...this.pgResultOut(snap));
    }
    return out;
  }

  private partyCombatOf(id: number): PartyCombatState {
    let combat = this.partyCombat.get(id);
    if (!combat) {
      combat = { lastSwingAt: -1e9, combo: 0, comboTarget: 0, lastShotAt: -1e9 };
      this.partyCombat.set(id, combat);
    }
    return combat;
  }

  /** Ground speed and climb rate, read from the position history. */
  private partyMotion(p: ServerPlayer): { speed: number; vy: number } {
    const track = p.arenaTrack;
    if (track.length < 2) return { speed: 0, vy: 0 };
    const a = track[track.length - 2], b = track[track.length - 1];
    const dt = Math.max(1 / 60, b.at - a.at);
    return { speed: Math.hypot(b.x - a.x, b.z - a.z) / dt, vy: (b.y - a.y) / dt / 60 };
  }

  /** One landed Bridge hit: damage, knockback, feedback and maybe a death. */
  private landPartyHit(w: MatchWorld, attacker: ServerPlayer, target: ServerPlayer, now: number, hit: {
    damage: number; kx: number; ky: number; kz: number;
    charge: number; combo: number; crit: boolean; ranged: boolean;
  }): Outbound[] {
    const bot = this.partyBots.get(target.id);
    if (bot) {
      bot.body.vel.x += hit.kx * 6; bot.body.vel.y += hit.ky * 6; bot.body.vel.z += hit.kz * 6;
      bot.body.onGround = false;
      bot.noteHurt(now);
    }
    const dealt = Math.min(hit.damage, target.health);
    target.health = Math.max(0, target.health - hit.damage);
    const killed = target.health <= 0;
    this.pg.recordHit(target.id, attacker.id, now);
    this.partyCombatOf(target.id).combo = 0;
    const move = this.partyMoves.get(target.id);
    if (move) {
      move.launchUntil = this.worldTime + 1.5; move.allowance = 4; move.groundedAt = this.worldTime; move.stuck = 0;
    }
    const out: Outbound[] = [];
    if (!target.bot) out.push(this.to(target, { t: 'hurt', health: killed ? 1 : target.health, dead: false,
      by: attacker.id, kx: hit.kx, ky: hit.ky, kz: hit.kz }));
    if (!attacker.bot) out.push(this.to(attacker, { t: 'pgHit', target: target.id, amount: dealt,
      combo: hit.combo, charge: hit.charge, crit: hit.crit, killed, ranged: hit.ranged }));
    if (!killed) return out;
    target.health = PARTY_MAX_HEALTH;
    const snapshot = this.pg.recordDeath(target.id, attacker.id, now, hit.ranged ? 'bow' : 'melee');
    if (snapshot) out.push(...this.pgStateOut(snapshot));
    out.push(...this.evaluatePartyPlayer(target, w));
    return out;
  }

  private handlePartyMelee(p: ServerPlayer, w: MatchWorld, targetId: number): Outbound[] {
    const now = this.nowMs(), target = this.players.get(targetId);
    const sub = this.pg.subFor(p.id);
    if (!target || !sub || sub.game !== 'bridge' || p.held !== Item.IronAxe ||
        !this.pg.canFight(p.id, targetId, now)) return [];
    const combat = this.partyCombatOf(p.id), tier = BRIDGE_MELEE_TIER;
    const since = now - combat.lastSwingAt;
    if (since < tier.cooldownMs - BRIDGE_SWING_JITTER_MS) return [];
    const lookX = -Math.sin(p.yaw), lookZ = -Math.cos(p.yaw);
    let best: { dx: number; dz: number; dist: number } | null = null;
    for (const c of [{ at: this.worldTime, x: target.x, y: target.y, z: target.z }, ...target.arenaTrack]) {
      if (this.worldTime - c.at > MELEE_REWIND_S) continue;
      const dx = c.x - p.x, dy = c.y - p.y, dz = c.z - p.z;
      const dist = Math.hypot(dx, dy, dz), horiz = Math.hypot(dx, dz) || 1e-3;
      if (dist > MELEE_RANGE) continue;
      if ((dx / horiz) * lookX + (dz / horiz) * lookZ < MELEE_FACING_DOT) continue;
      let blocked = false;
      const steps = Math.max(1, Math.ceil(dist * 4));
      for (let i = 1; i < steps; i++) {
        const t = i / steps;
        if (w.blocks.solidAt(p.x + dx * t, p.y + 1.35 + dy * t, p.z + dz * t)) { blocked = true; break; }
      }
      if (blocked) continue;
      if (!best || dist < best.dist) best = { dx: dx / horiz, dz: dz / horiz, dist };
    }
    if (!best) return [];
    const motion = this.partyMotion(p);
    const combo = combat.comboTarget === targetId && since <= MELEE_COMBO_WINDOW_MS ? combat.combo : 0;
    const swing = bridgeSwing({
      combo, onGround: this.partyGrounded(w, p.x, p.y, p.z), vy: motion.vy, speed: motion.speed,
      toTargetX: best.dx, toTargetZ: best.dz, lookX, lookZ,
    });
    combat.lastSwingAt = now;
    combat.comboTarget = targetId;
    combat.combo = Math.min(MELEE_COMBO_MAX, combo + 1);
    return this.landPartyHit(w, p, target, now, {
      damage: swing.damage, kx: swing.kx, ky: swing.ky, kz: swing.kz,
      charge: swing.charge, combo: swing.combo, crit: swing.crit, ranged: false,
    });
  }

  private handlePartyShoot(p: ServerPlayer, w: MatchWorld, msg: { dx: number; dy: number; dz: number; power: number }): Outbound[] {
    const now = this.nowMs(), sub = this.pg.subFor(p.id);
    const member = this.pg.participantFor(p.id);
    if (!sub || !member || sub.game !== 'bridge' || this.pg.phaseFor(p.id) !== 'running' ||
        p.held !== Item.BridgeBow || !fin(msg.dx, msg.dy, msg.dz)) return [];
    const len = Math.hypot(msg.dx, msg.dy, msg.dz);
    if (!(len > 1e-3)) return [];
    const combat = this.partyCombatOf(p.id);
    const round = this.pg.snapshotFor(p.id, now);
    if (member.pendingSpawn || (round?.goalResetAt !== undefined && now < round.goalResetAt) ||
        now - combat.lastShotAt < BRIDGE_BOW_COOLDOWN_MS) return [];
    combat.lastShotAt = now;
    const shot = bridgeArrowShot();
    const dx = msg.dx / len, dy = msg.dy / len, dz = msg.dz / len;
    const arrow: PartyArrow = {
      id: this.arrowSeq++, owner: p.id,
      x: p.x + dx * .8, y: p.y + 1.55 + dy * .8, z: p.z + dz * .8,
      vx: dx * shot.speed, vy: dy * shot.speed, vz: dz * shot.speed,
      power: 1, diesAt: this.worldTime + BRIDGE_ARROW_LIFE_MS / 1000,
    };
    w.arrows.push(arrow);
    return this.pgMembers(p).map((id) => this.to(id, {
      t: 'pgArrow', id: arrow.id, by: p.id, x: arrow.x, y: arrow.y, z: arrow.z, dx, dy, dz, speed: shot.speed, power: 1,
    }));
  }

  /** Fly every live arrow in one world, sub-stepped so nothing tunnels. */
  private tickArrows(w: MatchWorld, dt: number): Outbound[] {
    if (!w.arrows.length) return [];
    const out: Outbound[] = [], now = this.nowMs(), alive: PartyArrow[] = [];
    for (const a of w.arrows) {
      const owner = this.players.get(a.owner);
      if (!owner || this.pg.phaseFor(a.owner) !== 'running') continue;
      const members = this.pg.membersOf(a.owner);
      let victim: ServerPlayer | null = null, spent = this.worldTime >= a.diesAt;
      const steps = Math.max(1, Math.min(24, Math.ceil(Math.hypot(a.vx, a.vy, a.vz) * dt / .3)));
      const step = dt / steps;
      for (let i = 0; i < steps && !spent && !victim; i++) {
        a.vy -= BRIDGE_ARROW_GRAVITY * step;
        a.x += a.vx * step; a.y += a.vy * step; a.z += a.vz * step;
        if (a.y < PARTY_VOID_Y || a.y > PARTY_CEILING_Y || w.blocks.solidAt(a.x, a.y, a.z)) { spent = true; break; }
        for (const id of members) {
          if (id === a.owner) continue;
          const v = this.players.get(id);
          if (!v || !this.pg.canFight(a.owner, id, now)) continue;
          if (Math.abs(a.x - v.x) < .42 && Math.abs(a.z - v.z) < .42 && a.y > v.y - .1 && a.y < v.y + 1.9) {
            victim = v; break;
          }
        }
      }
      if (victim) {
        const shot = bridgeArrowShot(), flat = Math.hypot(a.vx, a.vz) || 1;
        out.push(...this.landPartyHit(w, owner, victim, now, {
          damage: shot.damage, kx: a.vx / flat * shot.knockback, ky: BRIDGE_ARROW_KB_VERT,
          kz: a.vz / flat * shot.knockback, charge: a.power, combo: 0, crit: shot.crit, ranged: true,
        }));
      }
      if (victim || spent) {
        for (const id of members) if (!this.players.get(id)?.bot) {
          out.push(this.to(id, { t: 'pgArrowEnd', id: a.id, x: a.x, y: a.y, z: a.z, hit: !!victim }));
        }
        continue;
      }
      alive.push(a);
    }
    w.arrows = alive;
    return out;
  }

  private handlePartyEdit(p: ServerPlayer, w: MatchWorld, x: number, y: number, z: number, block: number): Outbound[] {
    const sub = this.pg.subFor(p.id), member = this.pg.participantFor(p.id);
    if (!sub || !member || this.pg.phaseFor(p.id) !== 'running' || !fin(x, y, z)) return [];
    const bridge = sub.game === 'bridge';
    const bx = Math.floor(x), by = Math.floor(y), bz = Math.floor(z);
    const current = w.blocks.getBlock(bx, by, bz);
    const reject = (): Outbound[] => p.bot ? [] : [this.to(p, { t: 'edit', x: bx, y: by, z: bz, block: current })];
    const inRange = Math.hypot(bx + .5 - p.x, by + .5 - p.y, bz + .5 - p.z) <= EDIT_RANGE;
    const inSub = bx >= sub.minX && bx < sub.maxX && bz >= sub.minZ && bz < sub.maxZ;
    const minY = bridge ? PARTY_VOID_Y : PARTY_FLOOR_Y - 3;
    const maxY = bridge ? PARTY_FLOOR_Y + 16 : PARTY_CEILING_Y;
    if (!inSub || !inRange || by < minY || by >= maxY) return reject();
    const broadcast = (b: number) => this.pgMembers(p).map((id) => this.to(id, { t: 'edit', x: bx, y: by, z: bz, block: b }));
    if (block === Block.Air) {
      // Only player-placed wool can be removed.
      if (!w.blocks.isEdited(bx, by, bz) || !BRIDGE_TEAM_BLOCK.includes(current as typeof BRIDGE_TEAM_BLOCK[number])) return reject();
      w.blocks.set(bx, by, bz, Block.Air);
      return broadcast(Block.Air);
    }
    if (block !== BRIDGE_TEAM_BLOCK[member.team] || current !== Block.Air) return reject();
    const attached = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]
      .some(([dx, dy, dz]) => w.blocks.solidAt(bx + dx, by + dy, bz + dz));
    const blocked = bridge
      ? bridgeGoalGuard(bx - sub.minX, bz - sub.minZ)
      : parkourBuildBlocked(parkourCourse(sub.seed), bx - sub.minX, by, bz - sub.minZ);
    if (blocked || !attached || this.pg.membersOf(p.id).some((id) => {
      const v = this.players.get(id)!;
      return v.x + .3 > bx && v.x - .3 < bx + 1 && v.z + .3 > bz && v.z - .3 < bz + 1 && v.y + 1.8 > by && v.y < by + 1;
    })) return reject();
    w.blocks.set(bx, by, bz, block);
    return broadcast(block);
  }

  /** Open or shut both Bridge drop cages to match the round's clock. */
  private syncPartyCages(w: MatchWorld, snap: PartyLobbySnapshot, now: number): Outbound[] {
    const sub = snap.sub;
    if (!sub || sub.game !== 'bridge') return [];
    const held = snap.goalResetAt !== undefined && now < snap.goalResetAt;
    const open = snap.phase === 'running' && !held;
    if (open === w.cagesOpen) return [];
    w.cagesOpen = open;
    const edits = bridgeCageHatch().map((cell) => {
      const x = sub.minX + cell.lx, y = cell.y, z = sub.minZ + cell.lz;
      if (open) w.blocks.set(x, y, z, Block.Air);
      return { x, y, z, block: open ? Block.Air : w.blocks.restore(x, y, z) };
    });
    return snap.participants.filter((v) => v.connected && !this.players.get(v.id)?.bot)
      .map((v) => this.to(v.id, { t: 'editBatch', edits }));
  }

  private parkourCellEdits(w: MatchWorld, snap: PartyLobbySnapshot, cells: readonly ParkourCell[],
    block: number | 'restore'): Outbound[] {
    const sub = snap.sub!, edits: { x: number; y: number; z: number; block: number }[] = [];
    for (const c of cells) {
      const x = sub.minX + c.x, y = c.y, z = sub.minZ + c.z;
      if (block === 'restore') {
        // Never grow a block back inside somebody.
        if (snap.participants.some((m) => {
          const v = this.players.get(m.id);
          return v && v.x + .3 > x && v.x - .3 < x + 1 && v.z + .3 > z && v.z - .3 < z + 1 && v.y + 1.8 > y && v.y < y + 1;
        })) continue;
        edits.push({ x, y, z, block: w.blocks.restore(x, y, z) });
      } else {
        w.blocks.set(x, y, z, block);
        edits.push({ x, y, z, block });
      }
    }
    if (!edits.length) return [];
    return snap.participants.filter((v) => v.connected && !this.players.get(v.id)?.bot)
      .map((v) => this.to(v.id, { t: 'editBatch', edits }));
  }

  /** A racer standing on a crumble pad cracks the whole pad. */
  private stepOnCrumble(p: ServerPlayer, w: MatchWorld, sub: PartySubBounds): Outbound[] {
    const snap = this.pg.snapshotFor(p.id, this.nowMs());
    if (!snap || snap.phase !== 'running' || !w.parkour || !this.partyGrounded(w, p.x, p.y, p.z)) return [];
    const course = parkourCourse(sub.seed);
    const pad = parkourCrumbleUnder(course, p.x - sub.minX, p.y, p.z - sub.minZ);
    if (!pad) return [];
    const now = this.nowMs();
    if (w.parkour.crumbles.has(pad.index)) return [];
    w.parkour.crumbles.set(pad.index, { fallAt: now + CRUMBLE_FALL_MS, backAt: now + CRUMBLE_BACK_MS, gone: false });
    return this.parkourCellEdits(w, snap, parkourCrumbleCells(course, pad.index), CRUMBLE_CRACKED);
  }

  /** Everything on a running Parkour course that moves on the round clock. */
  private tickParkourCourse(w: MatchWorld, snap: PartyLobbySnapshot, now: number): Outbound[] {
    if (snap.sub?.game !== 'parkour' || !snap.round || !w.parkour) return [];
    const course = parkourCourse(snap.sub.seed), st = w.parkour;
    const t = now - snap.round.startedAt, out: Outbound[] = [];
    if (course.variant.mode === 'collapse') {
      const front = Math.min(course.steps.length, Math.floor(parkourCollapseFront(t)));
      if (front > st.collapsed) {
        out.push(...this.parkourCellEdits(w, snap, parkourCollapseCells(course, st.collapsed, front), Block.Air));
        st.collapsed = front;
      }
    }
    const alive = (c: ParkourCell): boolean => c.order >= st.collapsed;
    for (const group of [0, 1] as const) {
      const solid = blinkSolid(group, t);
      if (solid === st.blink[group]) continue;
      st.blink[group] = solid;
      out.push(...this.parkourCellEdits(w, snap, parkourBlinkCells(course, group).filter(alive), solid ? 'restore' : Block.Air));
    }
    for (const [index, c] of st.crumbles) {
      const cells = parkourCrumbleCells(course, index).filter(alive);
      if (!c.gone && now >= c.fallAt) {
        c.gone = true;
        out.push(...this.parkourCellEdits(w, snap, cells, Block.Air));
      } else if (c.gone && now >= c.backAt) {
        st.crumbles.delete(index);
        out.push(...this.parkourCellEdits(w, snap, cells, 'restore'));
      }
    }
    return out;
  }

  // ── Ticking ──────────────────────────────────────────────────────────────

  /** Advance the whole server by `dt` seconds. */
  tick(dt: number): Outbound[] {
    this.worldTime += dt;
    const out: Outbound[] = [];
    out.push(...this.fillWithBots());
    out.push(...this.tickDuels());
    out.push(...this.tickPg());
    this.tickRegen(dt);
    // Close worlds whose results screen has been up long enough.
    for (const w of [...this.worlds.values()]) {
      if (w.closeAt !== null && this.worldTime >= w.closeAt) out.push(...this.closeWorld(w));
    }
    if (this.worldTime >= this.sweepAt) { this.sweepAt = this.worldTime + 60; this.parties.sweep(this.wallNow()); }
    return out;
  }

  private tickDuels(): Outbound[] {
    const out: Outbound[] = [];
    const nowMs = this.nowMs();
    for (const snap of this.duels.tick(nowMs)) {
      const w = this.worlds.get(this.worldByLobby.get(snap.id) ?? -1);
      if (!w) continue;
      // Back to 'lobby' means the arena never loaded or the results expired.
      if (snap.phase === 'lobby') { out.push(...this.closeWorld(w)); continue; }
      out.push(...this.duelStateOut(snap));
      if (snap.phase === 'running' || snap.phase === 'sudden_death') {
        const arena = snap.arena;
        for (const participant of snap.participants.filter((v) => v.connected)) {
          const p = this.players.get(participant.id);
          if (!p || !arena) continue;
          if (snap.phase === 'sudden_death' && participant.spectating) {
            p.health = 1; p.held = 0; p.duelRespawning = false; p.duelShotTickets = [];
            if (!p.bot) out.push(this.to(p, { t: 'duelRespawn', respawnAt: 0, spectating: true }));
            continue;
          }
          if (!p.duelRespawning || !participant.alive) continue;
          const living = snap.participants.filter((v) => v.alive && v.id !== p.id)
            .map((v) => this.players.get(v.id)).filter((v): v is ServerPlayer => !!v)
            .map((v) => ({ x: v.x, y: v.y, z: v.z }));
          p.duelSpawnIndex = safestDuelSpawn(arena, living, p.duelSpawnIndex);
          const spawn = arena.spawns[p.duelSpawnIndex];
          p.x = spawn.x; p.y = spawn.y; p.z = spawn.z; p.health = DUEL_MAX_HEALTH; p.held = Item.BurstRifle;
          p.duelMedkits = 5; p.duelRespawning = false; p.duelShotTickets = [];
          p.duelLoaded = 24; p.duelReloadUntil = 0; p.duelBurstShots = 0;
          p.duelNextBurstAt = 0; p.duelLastShotAt = -Infinity; p.reloading = false;
          p.arenaTrack = []; this.recordArenaTrack(p);
          if (!p.bot) {
            out.push(this.duelLoadout(p.id));
            out.push(this.to(p, { t: 'respawned', x: spawn.x, y: spawn.y, z: spawn.z, health: DUEL_MAX_HEALTH }));
            out.push(this.to(p, { t: 'duelRespawn', respawnAt: 0, spectating: false }));
          }
        }
      }
      out.push(...this.duelResultOut(snap));
    }
    out.push(...this.tickDuelBots());
    if (this.worldTime >= this.duelClockNextAt) {
      this.duelClockNextAt = this.worldTime + 1;
      for (const snap of this.duels.snapshots(nowMs)) {
        if (snap.phase !== 'countdown' && snap.phase !== 'running' && snap.phase !== 'sudden_death') continue;
        for (const v of snap.participants) {
          if (v.connected && !this.players.get(v.id)?.bot) out.push(this.to(v.id, { t: 'duelClock', serverNow: nowMs }));
        }
      }
    }
    return out;
  }

  private tickDuelBots(): Outbound[] {
    const out: Outbound[] = [];
    const dt = this.botClock > 0 ? Math.min(.25, Math.max(0, this.worldTime - this.botClock)) : 0;
    const now = this.nowMs();
    for (const [id, bot] of [...this.duelBots]) {
      const p = this.players.get(id), human = this.players.get(bot.opponent);
      const w = p ? this.worldOfPlayer(p) : undefined;
      const snap = this.duels.snapshotFor(id, now), arena = this.duels.arenaFor(id);
      if (!p || !w || !human || !snap || !arena || dt <= 0) continue;
      if (snap.phase !== 'running' && snap.phase !== 'sudden_death') continue;
      const me = this.duels.participantFor(id), them = this.duels.participantFor(bot.opponent);
      if (!me || !them) continue;
      if (me.alive && bot.needsRespawnSync) bot.reset(p, p.yaw);
      const world = w.blocks.asWorld() as unknown as World;
      const action = bot.step(dt, now, {
        me: { health: p.health, alive: me.alive && !p.duelRespawning, kills: me.kills, deaths: me.deaths, medkits: p.duelMedkits },
        enemy: { x: human.x, y: human.y, z: human.z, alive: them.alive && !them.spectating, kills: them.kills,
          deaths: them.deaths, shielded: them.shieldUntil !== undefined && them.shieldUntil > now },
        arena,
        sight: (a, b) => hasArenaLineOfSight(a, b, arena,
          (x, y, z) => w.blocks.editAt(Math.floor(x), Math.floor(y), Math.floor(z)) === Block.OakPlanks),
      }, world);
      if (!me.alive || p.duelRespawning) continue;
      const pos = clampToDuelArena({ x: bot.body.pos.x, y: bot.body.pos.y, z: bot.body.pos.z }, arena);
      p.x = pos.x; p.y = pos.y; p.z = pos.z; p.yaw = bot.body.yaw; p.pitch = bot.pitch;
      p.sneaking = false; p.ct = Math.floor(now);
      p.held = action.shots.length ? Item.BurstRifle : p.held || Item.BurstRifle;
      p.aiming = action.aiming === true;
      this.recordArenaTrack(p);
      if (action.heal) {
        p.held = Item.Medkit;
        out.push(...this.handleDuelHeal(p, Item.Medkit));
      }
      for (const b of action.build) out.push(...this.handleDuelEdit(p, w, b.x, b.y, b.z, Block.OakPlanks));
      for (const shot of action.shots) {
        p.held = Item.BurstRifle;
        p.swing = (p.swing + 1) & 0xffff;
        this.duels.removeSpawnShield(id);
        const len = Math.hypot(shot.dx, shot.dy, shot.dz) || 1;
        out.push(this.to(human, { t: 'shot', id, item: Item.BurstRifle,
          x: shot.from.x, y: shot.from.y, z: shot.from.z, dx: shot.dx / len, dy: shot.dy / len, dz: shot.dz / len }));
        const live = this.duels.participantFor(bot.opponent);
        if (shot.hit && live?.alive && !human.duelRespawning) out.push(...this.applyDuelRound(p, human));
      }
    }
    return out;
  }

  private tickPg(): Outbound[] {
    const now = this.nowMs(), out: Outbound[] = [];
    const dt = this.botClock > 0 ? Math.min(.25, Math.max(0, this.worldTime - this.botClock)) : 0;
    this.botClock = this.worldTime;
    if (dt > 0) {
      for (const w of this.worlds.values()) if (w.mode !== 'duels') out.push(...this.tickArrows(w, dt));
      out.push(...this.tickPartyBots(dt, now));
    }
    for (const snap of this.pg.snapshots(now)) {
      const w = this.worlds.get(this.worldByLobby.get(snap.id) ?? -1);
      if (!w) continue;
      out.push(...this.syncPartyCages(w, snap, now));
      if (snap.phase !== 'running') continue;
      out.push(...this.tickParkourCourse(w, snap, now));
      for (const member of snap.participants) {
        const p = this.players.get(member.id);
        if (p && member.connected && !p.bot) out.push(...this.evaluatePartyPlayer(p, w));
      }
    }
    for (const snap of this.pg.tick(now)) {
      const w = this.worlds.get(this.worldByLobby.get(snap.id) ?? -1);
      if (!w) continue;
      if (snap.phase === 'lobby') { out.push(...this.closeWorld(w)); continue; }
      out.push(...this.syncPartyCages(w, snap, now));
      out.push(...this.pgStateOut(snap));
      if (snap.phase === 'running') {
        for (const v of snap.participants) {
          const move = this.partyMoves.get(v.id);
          if (move) { move.groundedAt = this.worldTime; move.at = this.worldTime; }
        }
      }
      out.push(...this.pgResultOut(snap));
    }
    if (this.worldTime >= this.pgClockNextAt) {
      this.pgClockNextAt = this.worldTime + .5;
      for (const snap of this.pg.snapshots(now)) if (snap.phase !== 'lobby') out.push(...this.pgStateOut(snap));
    }
    return out;
  }

  private tickPartyBots(dt: number, now: number): Outbound[] {
    const out: Outbound[] = [];
    for (const [id, bot] of [...this.partyBots]) {
      const p = this.players.get(id), human = this.players.get(bot.opponent);
      const w = p ? this.worldOfPlayer(p) : undefined;
      const snap = this.pg.snapshotFor(id, now), me = this.pg.participantFor(id);
      const other = this.pg.participantFor(bot.opponent);
      if (!p || !w || !human || !snap || !me || !other) continue;
      if (snap.phase !== 'running' || me.outAt !== undefined || now < (snap.goalResetAt ?? 0)) continue;
      if (me.pendingSpawn) out.push(...this.evaluatePartyPlayer(p, w));
      const action = bot.step(dt, now, snap, me, other, human, w.blocks.asWorld() as unknown as World,
        w.blocks.gen);
      p.x = bot.body.pos.x; p.y = bot.body.pos.y; p.z = bot.body.pos.z; p.yaw = bot.body.yaw; p.pitch = bot.pitch;
      p.sneaking = bot.body.sneaking;
      p.ct = Math.floor(now);
      this.recordArenaTrack(p);
      if (action.edit) out.push(...this.handlePartyEdit(p, w, action.edit.x, action.edit.y, action.edit.z, action.edit.block));
      p.held = snap.mode === 'bridge' ? (action.shot ? Item.BridgeBow : action.holdWool ? BRIDGE_TEAM_BLOCK[me.team] : Item.IronAxe)
        : BRIDGE_TEAM_BLOCK[me.team];
      if (action.melee) { p.swing = (p.swing + 1) & 0xffff; out.push(...this.handlePartyMelee(p, w, human.id)); }
      if (action.shot) {
        p.held = Item.BridgeBow;
        out.push(...this.handlePartyShoot(p, w, { ...action.shot, power: 1 }));
      }
      if (snap.sub?.game === 'parkour') out.push(...this.stepOnCrumble(p, w, snap.sub));
      out.push(...this.evaluatePartyPlayer(p, w));
    }
    return out;
  }

  /** Duels has no passive regeneration; a medkit runs the healing cadence. */
  private tickRegen(dt: number): void {
    for (const p of this.players.values()) {
      if (p.dead || p.worldId === null) continue;
      const boosting = p.regenBoostTimer > 0;
      if (!boosting) { p.regenTimer = 0; continue; }
      p.regenBoostTimer = Math.max(0, p.regenBoostTimer - dt);
      const max = this.worlds.get(p.worldId)?.mode === 'duels' ? DUEL_MAX_HEALTH : PARTY_MAX_HEALTH;
      if (p.health < max) {
        p.regenTimer += dt;
        if (p.regenTimer >= p.regenBoostInterval) { p.regenTimer = 0; p.health = Math.min(max, p.health + 1); }
      } else {
        p.regenBoostTimer = 0;
      }
    }
  }

  // ── Snapshots ────────────────────────────────────────────────────────────

  /** One transform snapshot per human in every world, listing that world's
   *  bodies and nothing else. */
  snapshots(): Outbound[] {
    const out: Outbound[] = [];
    for (const w of this.worlds.values()) {
      const bodies: PlayerSnapshot[] = [];
      for (const id of w.members) {
        const p = this.players.get(id);
        if (!p) continue;
        bodies.push({
          id: p.id, x: p.x, y: p.y, z: p.z, yaw: p.yaw, pitch: p.pitch, ct: p.ct,
          health: p.health, dead: false, sneaking: p.sneaking, held: p.held, swing: p.swing,
          aiming: p.aiming, reloading: p.reloading,
        });
      }
      for (const id of w.members) {
        const p = this.players.get(id);
        if (!p || p.bot) continue;
        // A Duels respawn spectator is invisible to everyone else.
        const players = bodies.map((b) => b.id !== id && w.mode === 'duels' &&
          this.duels.participantFor(b.id)?.spectating ? { ...b, dead: true } : b);
        out.push(this.to(id, { t: 'snapshot', players }));
      }
    }
    return out;
  }
}
