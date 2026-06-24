// Account store for login/register (mandatory accounts). PURE + transport-
// agnostic: password HASHING is INJECTED (the ws shell supplies Node's built-in
// scrypt; tests supply a fake), so this is headlessly unit-testable and carries
// no Node/DOM deps. The shell persists/loads records via fs as JSON. Each
// account is permanently bound to a faction (auto-balanced at registration),
// and over later phases carries the player's saved state (position/inventory).

import { FACTIONS, balancedFaction } from '../teams';

export interface Account {
  username: string;
  salt: string;
  hash: string;
  faction: number;
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

  /** Lowest-population faction across ALL registered accounts (so teams stay
   *  balanced over the whole playerbase, not just who's currently online). */
  private nextFaction(): number {
    const counts: Record<number, number> = {};
    for (const f of FACTIONS) counts[f.id] = 0;
    for (const a of this.byName.values()) {
      if (counts[a.faction] !== undefined) counts[a.faction]++;
    }
    return balancedFaction(counts);
  }

  /** Register a new account. `salt` is supplied by the caller (the shell uses a
   *  cryptographic random; tests a fixed value). Fail-closed on bad input/dup. */
  register(name: string, pass: string, hash: Hasher, salt: string): AuthResult {
    if (!validUsername(name)) {
      return { ok: false, error: 'Username must be 3–16 letters, numbers or _' };
    }
    if (typeof pass !== 'string' || pass.length < MIN_PASS || pass.length > MAX_PASS) {
      return { ok: false, error: `Password must be ${MIN_PASS}–${MAX_PASS} characters` };
    }
    if (this.has(name)) return { ok: false, error: 'That username is taken' };
    const account: Account = {
      username: name, salt, hash: hash(pass, salt), faction: this.nextFaction(),
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

  /** Serializable snapshot for the shell to write to disk. */
  toJSON(): Account[] { return this.list(); }
}
