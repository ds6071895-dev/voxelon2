// Name registry: the ONE place that decides whether a username is free.
//
// Worlds keeps VOXELON's no-custom-names rule — every name is generated — and
// adds the guarantee that no two people can ever hold the same one at the same
// time. A name is taken if ANY of these holds it:
//   · a registered account (whether or not its owner is online),
//   · a live session, signed in or temporary,
//   · a practice opponent currently in a match,
//   · a pending roll offered to someone in the Create-account dialog.
// Comparison is case-insensitive, matching the account store.

import { makeUsername } from './protocol';

export class NameRegistry {
  /** lowercase name -> holder key (session id, or `bot:<id>`, or `offer:<id>`). */
  private readonly held = new Map<string, string>();

  constructor(private readonly isRegistered: (name: string) => boolean) { }

  /** Free for `holder` to take right now? A holder never collides with itself. */
  available(name: string, holder?: string): boolean {
    const key = name.toLowerCase();
    const owner = this.held.get(key);
    if (owner !== undefined && owner !== holder) return false;
    return !this.isRegistered(name);
  }

  /** Is `name` currently held by anybody (session, bot or offer)? */
  inUse(name: string): boolean { return this.held.has(name.toLowerCase()); }

  /** Claim a specific name. Registered names may only be claimed through
   *  `claimAccount` (a successful sign-in). */
  claim(name: string, holder: string): boolean {
    if (!this.available(name, holder)) return false;
    this.held.set(name.toLowerCase(), holder);
    return true;
  }

  /** A signed-in account takes its own name. Refused while another live
   *  session is using it (one session per account). */
  claimAccount(name: string, holder: string): boolean {
    const owner = this.held.get(name.toLowerCase());
    if (owner !== undefined && owner !== holder) return false;
    this.held.set(name.toLowerCase(), holder);
    return true;
  }

  release(name: string, holder: string): void {
    const key = name.toLowerCase();
    if (this.held.get(key) === holder) this.held.delete(key);
  }

  /** Release every name a holder has (disconnect cleanup). */
  releaseAll(holder: string): void {
    for (const [name, owner] of this.held) if (owner === holder) this.held.delete(name);
  }

  /** Generate and claim a fresh name for `holder`. The digit tail grows only
   *  when the short space is genuinely crowded, so names stay short. */
  roll(holder: string, rng: () => number): string {
    for (let digits = 2; digits <= 5; digits++) {
      const tries = digits === 2 ? 48 : 64;
      for (let i = 0; i < tries; i++) {
        const name = makeUsername(rng, digits);
        if (this.claim(name, holder)) return name;
      }
    }
    // Unreachable in practice (millions of combinations); still never collide.
    let n = 0;
    for (;;) {
      const name = `Player${100000 + n++}`;
      if (this.claim(name, holder)) return name;
    }
  }
}
