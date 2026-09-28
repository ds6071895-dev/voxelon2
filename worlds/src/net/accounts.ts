// Account store. PURE and transport-agnostic: password HASHING is injected
// (the ws shell supplies Node's scrypt; tests supply a fake), so this runs
// headlessly with no Node/DOM dependency. The shell persists `toJSON()`.
//
// Worlds is anonymous-first: everyone plays under a temporary generated name,
// and an account only exists once somebody chooses to keep one. An account
// carries its name, its dressing-room look and a hidden per-mode skill
// estimate used to pitch practice opponents. There is no rank, rating or
// leaderboard anywhere.

import { sanitizeCosmetics, type Cosmetics } from '../character';
import { isGeneratedName, isGameMode, skinSeed, type GameMode } from './protocol';

interface Account {
  username: string;
  salt: string;
  hash: string;
  /** Session token for password-less resume (rotated on every sign-in). */
  token?: string;
  cosmetics?: Cosmetics;
  /** Hidden: how well this player has been doing against practice opponents,
   *  per mode, 0..1.35. Never shown to anyone. */
  skill?: Partial<Record<GameMode, number>>;
  createdAt?: number;
}

/** Deterministic password hasher: (password, salt) -> hex digest. */
export type Hasher = (password: string, salt: string) => string;

interface AuthResult { ok: boolean; error?: string; account?: Account }

const MIN_PASS = 4;
const MAX_PASS = 128;

function sanitizeSkill(raw: unknown): Partial<Record<GameMode, number>> {
  const out: Partial<Record<GameMode, number>> = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (isGameMode(k) && typeof v === 'number' && Number.isFinite(v)) out[k] = Math.max(0.1, Math.min(1.35, v));
  }
  return out;
}

export class Accounts {
  // Keyed by lowercased username: identity is case-insensitive and unique.
  private readonly byName = new Map<string, Account>();

  constructor(records: unknown[] = []) {
    for (const raw of records) {
      if (!raw || typeof raw !== 'object') continue;
      const a = raw as Partial<Account>;
      if (!isGeneratedName(a.username) || typeof a.salt !== 'string' || typeof a.hash !== 'string') continue;
      this.byName.set(a.username.toLowerCase(), {
        username: a.username, salt: a.salt, hash: a.hash,
        token: typeof a.token === 'string' ? a.token : undefined,
        cosmetics: a.cosmetics !== undefined ? sanitizeCosmetics(a.cosmetics, skinSeed(a.username)) : undefined,
        skill: sanitizeSkill(a.skill),
        createdAt: typeof a.createdAt === 'number' ? a.createdAt : undefined,
      });
    }
  }

  has(name: string): boolean { return typeof name === 'string' && this.byName.has(name.toLowerCase()); }
  get(name: string): Account | undefined {
    return typeof name === 'string' ? this.byName.get(name.toLowerCase()) : undefined;
  }
  get size(): number { return this.byName.size; }

  /** Keep a generated name. The caller has already checked that nobody else
   *  is using it right now; this refuses one that belongs to an account. */
  register(name: string, pass: string, hash: Hasher, salt: string, now = 0): AuthResult {
    if (!isGeneratedName(name)) return { ok: false, error: 'That name can’t be registered.' };
    if (typeof pass !== 'string' || pass.length < MIN_PASS || pass.length > MAX_PASS) {
      return { ok: false, error: `Passphrase must be ${MIN_PASS}–${MAX_PASS} characters.` };
    }
    if (this.has(name)) return { ok: false, error: 'That name is already taken.' };
    const account: Account = { username: name, salt, hash: hash(pass, salt), skill: {}, createdAt: now };
    this.byName.set(name.toLowerCase(), account);
    return { ok: true, account };
  }

  /** Verify credentials. Same error for unknown user and wrong passphrase. */
  login(name: string, pass: string, hash: Hasher): AuthResult {
    const a = this.get(name);
    if (!a || typeof pass !== 'string') return { ok: false, error: 'Wrong name or passphrase.' };
    if (hash(pass, a.salt) !== a.hash) return { ok: false, error: 'Wrong name or passphrase.' };
    return { ok: true, account: a };
  }

  /** Resume via a stored session token. Fail-closed. */
  sessionLogin(name: string, token: string): AuthResult {
    const a = this.get(name);
    if (!a || typeof token !== 'string' || token.length < 16 || !a.token || a.token !== token) {
      return { ok: false, error: 'Session expired — please sign in again.' };
    }
    return { ok: true, account: a };
  }

  setToken(name: string, token: string | undefined): void {
    const a = this.get(name);
    if (a) a.token = token;
  }
  setCosmetics(name: string, c: Cosmetics): void {
    const a = this.get(name);
    if (a) a.cosmetics = sanitizeCosmetics(c, skinSeed(a.username));
  }
  skillOf(name: string, mode: GameMode): number | undefined { return this.get(name)?.skill?.[mode]; }
  setSkill(name: string, mode: GameMode, value: number): void {
    const a = this.get(name);
    if (!a || !Number.isFinite(value)) return;
    (a.skill ??= {})[mode] = Math.max(0.1, Math.min(1.35, value));
  }

  toJSON(): Account[] { return [...this.byName.values()]; }
}
