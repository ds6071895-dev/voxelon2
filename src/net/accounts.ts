// Account store for login/register (mandatory accounts). PURE + transport-
// agnostic: password HASHING is INJECTED (the ws shell supplies Node's built-in
// scrypt; tests supply a fake), so this is headlessly unit-testable and carries
// no Node/DOM deps. The shell persists/loads records via fs as JSON. Each
// account is bound to a faction at registration (the player's pick, unless a
// >20% imbalance forces the weaker side), and carries the player's saved state
// (position/inventory).

import { FACTIONS, resolveJoinFaction } from '../teams';
import {
  WarfareProgress, buyWarfareNode, grantWarfareXp, migrateWarfare, sanitizeWarfare,
} from '../warfare';
import { DUEL_STARTING_ELO, sanitizeDuelElo } from '../duels';

export interface Account {
  username: string;
  salt: string;
  hash: string;
  faction: number;
  /** Permanent "Seasons Won" badge rank, kept across seasons (Phase 5). */
  seasonsWon?: number;
  /** Secret-switch bookkeeping (Phase 7). */
  switchesUsed?: number;
  switchSeason?: number;
  /** The season a defection forfeited the "Won" badge in (0 = none). */
  forfeitSeason?: number;
  /** Lifesteal elimination (Milestone A): wall-clock ms until which login is
   *  refused (0/undefined = not eliminated). Top-level — NOT in `data` — so
   *  routine state saves can never clobber it. */
  eliminatedUntil?: number;
  /** Username of the teammate who beacon-revived this account (shown as a
   *  notice on next login, then cleared). */
  revivedBy?: string;
  /** Session token for password-less resume (rotated on every successful
   *  auth; the client mirrors it in localStorage). */
  token?: string;
  /** SERVER OPERATOR: may run admin commands from the in-game command box.
   *  Top-level (not in `data`) so a client state save can never mint it, and
   *  granted ONLY from the server console (`op`/`deop`). */
  op?: boolean;
  /** Saved player state, restored on login (position/health/armor/inventory). */
  data?: Record<string, unknown>;
  /** WARFARE COMMAND progression. Stored EXPLICITLY on the account rather than
   *  inside the opaque client-owned `data` blob, so a routine state save can
   *  never overwrite (or mint) technology the player did not earn. */
  warfare?: WarfareProgress;
  /** Server-owned competitive Duels progression. */
  duelElo?: number;
  duelWins?: number;
  duelLosses?: number;
}

/** Deterministic password hasher: (password, salt) -> hex digest. */
export type Hasher = (password: string, salt: string) => string;

export interface AuthResult { ok: boolean; error?: string; account?: Account; }

const NAME_RE = /^[A-Za-z0-9_]{3,16}$/;
const MIN_PASS = 4;
const MAX_PASS = 128;

/** Username rules: 3–16 chars, letters/numbers/underscore. */
export function validUsername(name: unknown): name is string {
  return typeof name === 'string' && NAME_RE.test(name);
}

export class Accounts {
  // Keyed by lowercased username (case-insensitive identity, unique).
  private readonly byName = new Map<string, Account>();

  constructor(records: Account[] = []) {
    for (const a of records) {
      if (a && validUsername(a.username) && typeof a.salt === 'string' &&
          typeof a.hash === 'string') {
        this.byName.set(a.username.toLowerCase(), {
          username: a.username, salt: a.salt, hash: a.hash,
          faction: Number.isFinite(a.faction) ? a.faction : 0,
          seasonsWon: Number.isFinite(a.seasonsWon) ? Math.max(0, Math.floor(a.seasonsWon as number)) : 0,
          switchesUsed: Number.isFinite(a.switchesUsed) ? Math.max(0, Math.floor(a.switchesUsed as number)) : 0,
          switchSeason: Number.isFinite(a.switchSeason) ? Math.floor(a.switchSeason as number) : 0,
          forfeitSeason: Number.isFinite(a.forfeitSeason) ? Math.floor(a.forfeitSeason as number) : 0,
          eliminatedUntil: Number.isFinite(a.eliminatedUntil) ? Math.max(0, a.eliminatedUntil as number) : 0,
          revivedBy: typeof a.revivedBy === 'string' ? a.revivedBy : undefined,
          token: typeof a.token === 'string' ? a.token : undefined,
          op: a.op === true,
          data: a.data,
          warfare: sanitizeWarfare(a.warfare),
          duelElo: sanitizeDuelElo(a.duelElo),
          duelWins: Number.isFinite(a.duelWins) ? Math.max(0, Math.floor(a.duelWins as number)) : 0,
          duelLosses: Number.isFinite(a.duelLosses) ? Math.max(0, Math.floor(a.duelLosses as number)) : 0,
        });
      }
    }
  }

  has(name: string): boolean {
    return typeof name === 'string' && this.byName.has(name.toLowerCase());
  }
  get(name: string): Account | undefined {
    return typeof name === 'string' ? this.byName.get(name.toLowerCase()) : undefined;
  }
  list(): Account[] { return [...this.byName.values()]; }
  get size(): number { return this.byName.size; }

  /** Member count per faction across ALL registered accounts (so teams stay
   *  balanced over the whole playerbase, not just who's currently online). */
  private factionCounts(): Record<number, number> {
    const counts: Record<number, number> = {};
    for (const f of FACTIONS) counts[f.id] = 0;
    for (const a of this.byName.values()) {
      if (counts[a.faction] !== undefined) counts[a.faction]++;
    }
    return counts;
  }

  /** Register a new account. `salt` is supplied by the caller (the shell uses a
   *  cryptographic random; tests a fixed value). `desired` is the side the
   *  player PICKED; it's honoured only while the teams are balanced — a >20%
   *  imbalance forces the weaker side. Fail-closed on bad input/dup. */
  register(name: string, pass: string, hash: Hasher, salt: string, desired?: number): AuthResult {
    if (!validUsername(name)) {
      return { ok: false, error: 'Username must be 3–16 letters, numbers or _' };
    }
    if (typeof pass !== 'string' || pass.length < MIN_PASS || pass.length > MAX_PASS) {
      return { ok: false, error: `Password must be ${MIN_PASS}–${MAX_PASS} characters` };
    }
    if (this.has(name)) return { ok: false, error: 'That username is taken' };
    const account: Account = {
      username: name, salt, hash: hash(pass, salt),
      faction: resolveJoinFaction(this.factionCounts(), desired),
      seasonsWon: 0,
      duelElo: DUEL_STARTING_ELO, duelWins: 0, duelLosses: 0,
    };
    this.byName.set(name.toLowerCase(), account);
    return { ok: true, account };
  }

  /** Verify credentials. Returns the account on success. */
  login(name: string, pass: string, hash: Hasher): AuthResult {
    const a = this.get(name);
    // Same generic error for unknown-user vs wrong-password (no user enumeration).
    if (!a || typeof pass !== 'string') return { ok: false, error: 'Wrong username or password' };
    if (hash(pass, a.salt) !== a.hash) return { ok: false, error: 'Wrong username or password' };
    return { ok: true, account: a };
  }

  /** Resume via a stored session token (no password). Fail-closed: an account
   *  with no token can never match, and the generic error avoids enumeration. */
  sessionLogin(name: string, token: string): AuthResult {
    const a = this.get(name);
    if (!a || typeof token !== 'string' || token.length < 8 ||
        !a.token || a.token !== token) {
      return { ok: false, error: 'Session expired — please log in again.' };
    }
    return { ok: true, account: a };
  }

  /** Store (rotate) an account's session token. */
  setToken(name: string, token: string): void {
    const a = this.get(name);
    if (a) a.token = token;
  }

  /** Merge saved player state into an account (for persistence phases). */
  setData(name: string, data: Record<string, unknown>): void {
    const a = this.get(name);
    if (a) a.data = data;
  }

  duelProfile(name: string): { elo: number; wins: number; losses: number } {
    const a = this.get(name);
    return { elo: sanitizeDuelElo(a?.duelElo), wins: Math.max(0, a?.duelWins ?? 0), losses: Math.max(0, a?.duelLosses ?? 0) };
  }

  applyDuelRating(name: string, elo: number, won: boolean): void {
    const a = this.get(name);
    if (!a) return;
    a.duelElo = sanitizeDuelElo(elo);
    if (won) a.duelWins = Math.max(0, a.duelWins ?? 0) + 1;
    else a.duelLosses = Math.max(0, a.duelLosses ?? 0) + 1;
  }

  duelLeaderboard(limit = 10): { username: string; elo: number; wins: number; losses: number }[] {
    return this.list().map((a) => ({ username: a.username, ...this.duelProfile(a.username) }))
      .sort((a, b) => b.elo - a.elo || b.wins - a.wins || a.username.localeCompare(b.username))
      .slice(0, Math.max(1, Math.floor(limit)));
  }

  // --- Operators --------------------------------------------------------------

  /** Grant/revoke operator. Returns the account's canonical name, or null if
   *  there is no such account (op works on offline accounts too). */
  setOp(name: string, op: boolean): string | null {
    const a = this.get(name);
    if (!a) return null;
    a.op = op;
    return a.username;
  }

  /** Is this account a server operator? Unknown accounts are never OP. */
  isOp(name: string): boolean {
    return this.get(name)?.op === true;
  }

  /** Every operator's canonical username, alphabetical. */
  operators(): string[] {
    return this.list().filter((a) => a.op).map((a) => a.username)
      .sort((a, b) => a.localeCompare(b));
  }

  // --- Warfare Command --------------------------------------------------------

  /** The account's warfare progression, running the one-time `warfare-v1`
   *  migration on first touch: the retired Progress XP, skill nodes and faction
   *  XP levels are dropped from `data` and never written again. Everything else
   *  in `data` (inventory, hearts, vault records, …) is preserved verbatim. */
  warfareOf(name: string): WarfareProgress {
    const a = this.get(name);
    if (!a) return sanitizeWarfare(null);
    if (!a.warfare) {
      // First touch: adopt anything the old client blob happened to carry, then
      // scrub the retired keys out of `data` for good.
      const seed = migrateWarfare({ ...(a.data ?? {}), warfare: a.data?.warfare });
      a.warfare = seed.warfare;
      a.data = seed.data;
      delete (a.data as Record<string, unknown>).warfare; // it lives on the account now
    }
    return a.warfare;
  }

  /** Award earned warfare XP. Returns the new total (0 if unknown account). */
  awardWarfareXp(name: string, amount: number): number {
    const a = this.get(name);
    if (!a) return 0;
    const w = this.warfareOf(name);
    grantWarfareXp(w, amount);
    a.warfare = w;
    return w.xp;
  }

  /** Spend XP on a node. Returns whether the purchase was applied. */
  buyWarfare(name: string, node: string): boolean {
    const a = this.get(name);
    if (!a) return false;
    const w = this.warfareOf(name);
    if (!buyWarfareNode(w, node)) return false;
    a.warfare = w;
    return true;
  }

  // --- Lifesteal elimination (Milestone A) -----------------------------------

  /** Record an elimination lockout (wall-clock ms) + optionally reset the
   *  saved hearts to the comeback value. */
  eliminate(name: string, until: number, comebackHearts?: number): void {
    const a = this.get(name);
    if (!a || !Number.isFinite(until)) return;
    a.eliminatedUntil = Math.max(0, until);
    if (comebackHearts !== undefined) {
      a.data = { ...(a.data ?? {}), hearts: comebackHearts };
    }
  }

  /** Remaining elimination lockout in ms at `now` (0 = free to play). */
  eliminationRemaining(name: string, now: number): number {
    const until = this.get(name)?.eliminatedUntil;
    return Number.isFinite(until) ? Math.max(0, (until as number) - now) : 0;
  }

  /** Clear an elimination (timer expired or beacon revival). `revivedBy`
   *  stamps the reviver for a next-login notice. Returns false if the account
   *  doesn't exist or wasn't eliminated. */
  clearElimination(name: string, now: number, revivedBy?: string): boolean {
    const a = this.get(name);
    if (!a || this.eliminationRemaining(name, now) <= 0) {
      // Timer-expiry cleanup still zeroes a stale field on a known account.
      if (a) a.eliminatedUntil = 0;
      return false;
    }
    a.eliminatedUntil = 0;
    if (revivedBy) a.revivedBy = revivedBy;
    return true;
  }

  /** Eliminated members of `faction` at `now` (for the Revival Beacon picker). */
  eliminatedOf(faction: number, now: number): { username: string; remainingMs: number }[] {
    const out: { username: string; remainingMs: number }[] = [];
    for (const a of this.byName.values()) {
      if (a.faction !== faction) continue;
      const remainingMs = this.eliminationRemaining(a.username, now);
      if (remainingMs > 0) out.push({ username: a.username, remainingMs });
    }
    return out;
  }

  /** Pop (read + clear) the "revived by" stamp for a next-login notice. */
  popRevivedBy(name: string): string | undefined {
    const a = this.get(name);
    if (!a || !a.revivedBy) return undefined;
    const by = a.revivedBy;
    a.revivedBy = undefined;
    return by;
  }

  /** Award a "Seasons Won" badge to every account on a faction (Phase 5 reset),
   *  EXCEPT defectors who switched during `season` (Phase 7 — loyalty matters).
   *  Returns the usernames awarded (so the shell can notify online players). */
  awardSeasonWin(faction: number, season = 0): string[] {
    const won: string[] = [];
    for (const a of this.byName.values()) {
      if (a.faction === faction && a.forfeitSeason !== season) {
        a.seasonsWon = (a.seasonsWon ?? 0) + 1;
        won.push(a.username);
      }
    }
    return won;
  }

  /** Persist a secret faction switch to the account (Phase 7). */
  applySwitch(name: string, faction: number, switchesUsed: number, switchSeason: number, forfeitSeason: number): void {
    const a = this.get(name);
    if (!a) return;
    a.faction = faction;
    a.switchesUsed = switchesUsed;
    a.switchSeason = switchSeason;
    a.forfeitSeason = forfeitSeason;
  }

  /** Serializable snapshot for the shell to write to disk. */
  toJSON(): Account[] { return this.list(); }
}
