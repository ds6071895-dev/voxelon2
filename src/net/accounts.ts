// Account store for login/register (mandatory accounts). PURE + transport-
// agnostic: password HASHING is INJECTED (the ws shell supplies Node's built-in
// scrypt; tests supply a fake), so this is headlessly unit-testable and carries
// no Node/DOM deps. The shell persists/loads records via fs as JSON. Each
// account is bound to a faction at registration (the player's pick, unless a
// >20% imbalance forces the weaker side), and carries the player's saved state
// (position/inventory).

import { FACTIONS, resolveJoinFaction } from '../teams';

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
  /** Saved player state, restored on login (position/health/armor/inventory). */
  data?: Record<string, unknown>;
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
          data: a.data,
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

  /** Merge saved player state into an account (for persistence phases). */
  setData(name: string, data: Record<string, unknown>): void {
    const a = this.get(name);
    if (a) a.data = data;
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
