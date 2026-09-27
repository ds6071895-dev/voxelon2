// Parties: small friend groups (up to PARTY_MAX) that play together.
//
// A party is identified by a short code anybody can read aloud. Codes are
// unique among live parties, and a code a disbanded party gave up is held back
// for a cool-down before it can be issued again, so a stale code shared in a
// chat can never drop somebody into a stranger's party. Pure: no sockets, no
// clocks of its own (every call takes `now`).

import { PARTY_CODE_ALPHABET, PARTY_CODE_LENGTH, PARTY_MAX, normalizePartyCode } from './protocol';

export interface Party {
  code: string;
  leader: number;
  /** Join order; the first entry is not necessarily the leader. */
  members: number[];
}

export type PartyJoinError = 'invalid' | 'full' | 'already' | 'busy';

/** How long a released code stays out of circulation. */
export const PARTY_CODE_COOLDOWN_MS = 10 * 60_000;

export class Parties {
  private readonly byCode = new Map<string, Party>();
  private readonly byMember = new Map<number, Party>();
  /** Recently released codes -> when they may be reissued. */
  private readonly cooling = new Map<string, number>();

  constructor(private readonly rng: () => number) { }

  of(id: number): Party | undefined { return this.byMember.get(id); }
  byCodeOf(code: string): Party | undefined { return this.byCode.get(normalizePartyCode(code)); }
  get size(): number { return this.byCode.size; }
  codes(): IterableIterator<string> { return this.byCode.keys(); }

  /** Is this code live or cooling down? */
  codeTaken(code: string, now: number): boolean {
    if (this.byCode.has(code)) return true;
    const until = this.cooling.get(code);
    if (until === undefined) return false;
    if (now >= until) { this.cooling.delete(code); return false; }
    return true;
  }

  private newCode(now: number): string {
    // ~887M codes; a collision is vanishingly rare, but it is checked, never
    // assumed, and the loop cannot hand back a code that is live or cooling.
    for (;;) {
      let code = '';
      for (let i = 0; i < PARTY_CODE_LENGTH; i++) {
        code += PARTY_CODE_ALPHABET[Math.floor(this.rng() * PARTY_CODE_ALPHABET.length)];
      }
      if (!this.codeTaken(code, now)) return code;
    }
  }

  create(leader: number, now: number): Party {
    const existing = this.byMember.get(leader);
    if (existing) return existing;
    const party: Party = { code: this.newCode(now), leader, members: [leader] };
    this.byCode.set(party.code, party);
    this.byMember.set(leader, party);
    return party;
  }

  join(id: number, rawCode: string): { ok: true; party: Party } | { ok: false; error: PartyJoinError } {
    const code = normalizePartyCode(rawCode);
    const party = code ? this.byCode.get(code) : undefined;
    if (!party) return { ok: false, error: 'invalid' };
    if (party.members.includes(id)) return { ok: true, party };
    if (this.byMember.has(id)) return { ok: false, error: 'already' };
    if (party.members.length >= PARTY_MAX) return { ok: false, error: 'full' };
    party.members.push(id);
    this.byMember.set(id, party);
    return { ok: true, party };
  }

  /** Remove a member. The party disbands when its last member goes, and the
   *  leadership passes to the longest-standing member when the leader goes.
   *  Returns the party as it now stands (null if it disbanded). */
  leave(id: number, now: number): { party: Party | null; disbanded: string | null } {
    const party = this.byMember.get(id);
    if (!party) return { party: null, disbanded: null };
    this.byMember.delete(id);
    party.members = party.members.filter((m) => m !== id);
    if (party.members.length === 0) {
      this.byCode.delete(party.code);
      this.cooling.set(party.code, now + PARTY_CODE_COOLDOWN_MS);
      return { party: null, disbanded: party.code };
    }
    if (party.leader === id) party.leader = party.members[0];
    return { party, disbanded: null };
  }

  promote(leader: number, target: number): Party | null {
    const party = this.byMember.get(leader);
    if (!party || party.leader !== leader || !party.members.includes(target)) return null;
    party.leader = target;
    return party;
  }

  /** Drop expired cool-downs (called occasionally from the server tick). */
  sweep(now: number): void {
    for (const [code, until] of this.cooling) if (now >= until) this.cooling.delete(code);
  }
}
