// POLITICS (Phase 6) — each faction runs a kid-safe, war-focused government. A
// COMMANDER is elected WEEKLY (self-nominate + one vote each); they (and 1–2
// appointed OFFICERS) command only SHARED faction resources: a RALLY TARGET that
// buffs teammates fighting there, and a TREASURY of oil filled by a Commander-set
// 0–25% tax on oil PRODUCTION (plus donations) that funds shield refills, supply
// crates, or a temporary faction-wide buff. Hard anti-grief rules: a Commander
// can't harm teammates, a supermajority RECALL vote removes them early, and every
// treasury spend is logged. PURE + transport-agnostic, like the other rules
// modules — the server owns the live state; the client mirrors it for the HUD.

import { FACTIONS, NO_FACTION, isFaction } from './teams';

export const ELECTION_PERIOD = 7 * 24 * 3600; // weekly elections (seconds)
export const MAX_OFFICERS = 2;
export const MAX_TAX = 0.25;                   // Commander may tax 0–25% of oil output
export const RECALL_FRACTION = 2 / 3;          // supermajority to recall a Commander
export const RALLY_DAMAGE_MULT = 1.3;          // combat buff in the rally region
export const FACTION_BUFF_DURATION = 120;      // a bought faction-wide buff lasts this long
export const SHIELD_REFILL_OIL = 800;          // oil delivered by a treasury shield refill
export const SUPPLY_CRATE_COST = 300;          // treasury cost of a front-line supply crate
export const FACTION_BUFF_COST = 1000;         // treasury cost of a temporary faction buff
export const SHIELD_REFILL_COST = SHIELD_REFILL_OIL; // 1:1 oil out of the treasury
const LOG_CAP = 12;
const PARTY_MAX = 18;

export interface Candidate { user: string; party: string; }
export interface SpendEntry { time: number; by: string; text: string; }

/** One faction's live political state (serialized to the wire + disk). */
export interface FactionPolitics {
  faction: number;
  commander: string;                 // '' = none yet
  officers: string[];                // <= MAX_OFFICERS
  rally: number;                     // region index, -1 = none
  treasury: number;                  // oil units in the shared war chest
  taxRate: number;                   // 0..MAX_TAX cut of oil production
  candidates: Candidate[];           // self-nominations for the current election
  votes: Record<string, string>;     // voter username -> candidate username
  recalls: string[];                 // members who voted to recall the commander
  buffUntil: number;                 // worldTime the faction-wide buff lasts until
  electionEndsAt: number;            // worldTime the current election tallies
  log: SpendEntry[];                 // recent decisions (capped, newest last)
}

function fresh(faction: number, now: number): FactionPolitics {
  return {
    faction, commander: '', officers: [], rally: -1, treasury: 0, taxRate: 0,
    candidates: [], votes: {}, recalls: [], buffUntil: 0,
    electionEndsAt: now + ELECTION_PERIOD, log: [],
  };
}

const clean = (s: unknown): string => (typeof s === 'string' ? s.slice(0, 24) : '');

export class Politics {
  private readonly byFaction = new Map<number, FactionPolitics>();

  constructor(now = 0) {
    for (const f of FACTIONS) this.byFaction.set(f.id, fresh(f.id, now));
  }

  get(faction: number): FactionPolitics | undefined { return this.byFaction.get(faction); }
  list(): FactionPolitics[] { return [...this.byFaction.values()]; }

  /** Is `user` empowered to command this faction (commander or an officer)? */
  isLeader(faction: number, user: string): boolean {
    const p = this.byFaction.get(faction);
    return !!p && !!user && (p.commander === user || p.officers.includes(user));
  }

  private push(p: FactionPolitics, by: string, text: string, now: number): void {
    p.log.push({ time: now, by, text });
    if (p.log.length > LOG_CAP) p.log.splice(0, p.log.length - LOG_CAP);
  }

  // --- Elections ------------------------------------------------------------

  /** Self-nominate (or update your party banner) for the running election. */
  nominate(faction: number, user: string, party: string): boolean {
    const p = this.byFaction.get(faction);
    if (!p || !user) return false;
    const existing = p.candidates.find((c) => c.user === user);
    if (existing) existing.party = clean(party).slice(0, PARTY_MAX);
    else p.candidates.push({ user, party: clean(party).slice(0, PARTY_MAX) });
    return true;
  }

  /** Cast (or change) your single vote for a standing candidate. */
  vote(faction: number, voter: string, candidate: string): boolean {
    const p = this.byFaction.get(faction);
    if (!p || !voter || !p.candidates.some((c) => c.user === candidate)) return false;
    p.votes[voter] = candidate;
    return true;
  }

  /** Tally the election: the most-voted candidate becomes Commander (ties +
   *  empty fields break to the standing Commander, else the first candidate).
   *  Resets the ballot + recalls and arms the next week. Returns the winner. */
  tally(faction: number, now: number): string {
    const p = this.byFaction.get(faction);
    if (!p) return '';
    const counts = new Map<string, number>();
    for (const c of p.candidates) counts.set(c.user, 0);
    for (const cand of Object.values(p.votes)) {
      if (counts.has(cand)) counts.set(cand, (counts.get(cand) ?? 0) + 1);
    }
    let winner = '', best = -1;
    for (const [user, n] of counts) if (n > best) { best = n; winner = user; }
    // No candidates at all -> keep the incumbent; otherwise the winner takes over.
    if (winner) p.commander = winner;
    // Officers that are no longer the commander stay, but drop the new commander
    // from the officer list (can't be both).
    p.officers = p.officers.filter((o) => o !== p.commander).slice(0, MAX_OFFICERS);
    p.candidates = [];
    p.votes = {};
    p.recalls = [];
    p.electionEndsAt = now + ELECTION_PERIOD;
    this.push(p, 'election', winner ? `${winner} elected Commander` : 'no Commander elected', now);
    return p.commander;
  }

  /** Advance every faction's election clock; auto-tally any that reached the
   *  deadline. Returns the factions that just elected (for announcements). */
  tick(now: number): { faction: number; commander: string }[] {
    const elected: { faction: number; commander: string }[] = [];
    for (const p of this.byFaction.values()) {
      if (now >= p.electionEndsAt) {
        const c = this.tally(faction0(p), now);
        elected.push({ faction: p.faction, commander: c });
      }
    }
    return elected;
  }

  // --- Commander powers (shared resources only) -----------------------------

  /** Mark the rally region (commander/officer only). -1 clears it. */
  setRally(faction: number, by: string, region: number, now: number): boolean {
    const p = this.byFaction.get(faction);
    if (!p || !this.isLeader(faction, by)) return false;
    p.rally = Number.isInteger(region) ? region : -1;
    this.push(p, by, p.rally >= 0 ? `rally set to region ${p.rally}` : 'rally cleared', now);
    return true;
  }

  /** Appoint an officer (commander only, up to MAX_OFFICERS, never the commander). */
  appointOfficer(faction: number, by: string, user: string, now: number): boolean {
    const p = this.byFaction.get(faction);
    if (!p || p.commander !== by || !user || user === p.commander) return false;
    if (p.officers.includes(user) || p.officers.length >= MAX_OFFICERS) return false;
    p.officers.push(user);
    this.push(p, by, `appointed ${user} as Officer`, now);
    return true;
  }

  /** Dismiss an officer (commander only). */
  dismissOfficer(faction: number, by: string, user: string, now: number): boolean {
    const p = this.byFaction.get(faction);
    if (!p || p.commander !== by) return false;
    const i = p.officers.indexOf(user);
    if (i < 0) return false;
    p.officers.splice(i, 1);
    this.push(p, by, `dismissed Officer ${user}`, now);
    return true;
  }

  /** Set the oil-production tax (commander only, clamped 0..MAX_TAX). */
  setTax(faction: number, by: string, rate: number, now: number): boolean {
    const p = this.byFaction.get(faction);
    if (!p || p.commander !== by || !Number.isFinite(rate)) return false;
    p.taxRate = Math.max(0, Math.min(MAX_TAX, rate));
    this.push(p, by, `tax set to ${Math.round(p.taxRate * 100)}%`, now);
    return true;
  }

  // --- Treasury -------------------------------------------------------------

  /** Tax a batch of freshly-produced oil: returns the units diverted to the
   *  treasury (the player keeps the rest). Production only — never stockpiles. */
  taxProduction(faction: number, produced: number): number {
    const p = this.byFaction.get(faction);
    if (!p || !Number.isFinite(produced) || produced <= 0 || p.taxRate <= 0) return 0;
    const cut = Math.floor(produced * p.taxRate);
    p.treasury += cut;
    return cut;
  }

  /** Anyone may donate oil to their faction's war chest. */
  donate(faction: number, amount: number, by: string, now: number): number {
    const p = this.byFaction.get(faction);
    if (!p || !Number.isFinite(amount) || amount <= 0) return 0;
    const add = Math.floor(amount);
    p.treasury += add;
    this.push(p, by, `donated ${add} oil`, now);
    return add;
  }

  /** Can a leader currently afford a `cost` spend? */
  canSpend(faction: number, by: string, cost: number): boolean {
    const p = this.byFaction.get(faction);
    return !!p && this.isLeader(faction, by) && p.treasury >= cost && cost > 0;
  }

  /** Deduct + log a spend (the server performs the actual effect). */
  private spend(faction: number, by: string, cost: number, text: string, now: number): boolean {
    const p = this.byFaction.get(faction);
    if (!p || !this.canSpend(faction, by, cost)) return false;
    p.treasury -= cost;
    this.push(p, by, text, now);
    return true;
  }

  spendShieldRefill(faction: number, by: string, now: number): boolean {
    return this.spend(faction, by, SHIELD_REFILL_COST, `funded a base shield refill (${SHIELD_REFILL_COST} oil)`, now);
  }
  spendSupplyCrate(faction: number, by: string, now: number): boolean {
    return this.spend(faction, by, SUPPLY_CRATE_COST, `dropped a supply crate (${SUPPLY_CRATE_COST} oil)`, now);
  }
  spendFactionBuff(faction: number, by: string, now: number): boolean {
    const p = this.byFaction.get(faction);
    if (!p || !this.spend(faction, by, FACTION_BUFF_COST, `bought a faction war buff (${FACTION_BUFF_COST} oil)`, now)) return false;
    p.buffUntil = now + FACTION_BUFF_DURATION;
    return true;
  }

  // --- Recall + buffs -------------------------------------------------------

  /** Cast a recall vote against the sitting commander. When a supermajority of
   *  the faction's `memberCount` agrees, the commander is removed immediately.
   *  Returns true iff the commander was just recalled. */
  recall(faction: number, voter: string, memberCount: number, now: number): boolean {
    const p = this.byFaction.get(faction);
    if (!p || !p.commander || !voter || voter === '' ) return false;
    if (!p.recalls.includes(voter)) p.recalls.push(voter);
    const need = Math.max(2, Math.ceil(Math.max(1, memberCount) * RECALL_FRACTION));
    if (p.recalls.length >= need) {
      this.push(p, 'recall', `${p.commander} recalled by vote`, now);
      p.commander = '';
      p.officers = [];
      p.recalls = [];
      return true;
    }
    return false;
  }

  /** Trigger a faction combat buff for `seconds` (the War Horn gadget — free but
   *  long-cooldown + leader-only; the buff stacks with the rally region). */
  triggerBuff(faction: number, seconds: number, now: number, by: string): boolean {
    const p = this.byFaction.get(faction);
    if (!p || !Number.isFinite(seconds) || seconds <= 0) return false;
    p.buffUntil = Math.max(p.buffUntil, now + seconds);
    this.push(p, by, 'sounded the War Horn — combat buff!', now);
    return true;
  }

  /** Combat multiplier for a member of `faction` fighting at `region`: the rally
   *  buff (in the rally region) and/or an active faction-wide buff stack to a
   *  single bonus. 1.0 = no buff. */
  combatMultiplier(faction: number, region: number, now: number): number {
    const p = this.byFaction.get(faction);
    if (!p) return 1;
    const rally = p.rally >= 0 && p.rally === region;
    const buff = now < p.buffUntil;
    return rally || buff ? RALLY_DAMAGE_MULT : 1;
  }

  // --- Persistence ----------------------------------------------------------

  serialize(): FactionPolitics[] { return this.list(); }

  restore(raw: unknown, now: number): void {
    if (!Array.isArray(raw)) return;
    for (const r of raw) {
      if (!r || typeof r !== 'object') continue;
      const o = r as Partial<FactionPolitics>;
      if (!isFaction(o.faction as number)) continue;
      const p = this.byFaction.get(o.faction as number);
      if (!p) continue;
      p.commander = clean(o.commander);
      p.officers = Array.isArray(o.officers) ? o.officers.map(clean).filter(Boolean).slice(0, MAX_OFFICERS) : [];
      p.rally = Number.isInteger(o.rally) ? (o.rally as number) : -1;
      p.treasury = Number.isFinite(o.treasury) ? Math.max(0, o.treasury as number) : 0;
      p.taxRate = Number.isFinite(o.taxRate) ? Math.max(0, Math.min(MAX_TAX, o.taxRate as number)) : 0;
      p.candidates = Array.isArray(o.candidates)
        ? o.candidates.filter((c) => c && typeof c === 'object').map((c) => ({
            user: clean((c as Candidate).user), party: clean((c as Candidate).party).slice(0, PARTY_MAX),
          })).filter((c) => c.user)
        : [];
      p.votes = (o.votes && typeof o.votes === 'object') ? { ...o.votes as Record<string, string> } : {};
      p.recalls = Array.isArray(o.recalls) ? o.recalls.map(clean).filter(Boolean) : [];
      p.buffUntil = Number.isFinite(o.buffUntil) ? (o.buffUntil as number) : 0;
      p.electionEndsAt = Number.isFinite(o.electionEndsAt) ? (o.electionEndsAt as number) : now + ELECTION_PERIOD;
      p.log = Array.isArray(o.log)
        ? o.log.filter((e) => e && typeof e === 'object').slice(-LOG_CAP).map((e) => ({
            time: Number.isFinite((e as SpendEntry).time) ? (e as SpendEntry).time : 0,
            by: clean((e as SpendEntry).by), text: clean((e as SpendEntry).text).slice(0, 48),
          }))
        : [];
    }
  }

  /** Strip a departing member from a faction's government (Phase 7 defection):
   *  drops their command/officer role, candidacy, vote, and recall vote so a
   *  defector can't keep powers over a faction they've left. */
  removeMember(faction: number, user: string, now: number): void {
    const p = this.byFaction.get(faction);
    if (!p || !user) return;
    if (p.commander === user) { p.commander = ''; this.push(p, 'system', `${user} left — Commander seat vacated`, now); }
    p.officers = p.officers.filter((o) => o !== user);
    p.candidates = p.candidates.filter((c) => c.user !== user);
    delete p.votes[user];
    for (const k of Object.keys(p.votes)) if (p.votes[k] === user) delete p.votes[k];
    p.recalls = p.recalls.filter((r) => r !== user);
  }

  /** Clear all politics for a new season (Phase 5 reset hands off to this). */
  reset(now: number): void {
    for (const f of FACTIONS) this.byFaction.set(f.id, fresh(f.id, now));
  }
}

/** Tiny helper so tick() reads cleanly (the faction id of a state record). */
function faction0(p: FactionPolitics): number {
  return isFaction(p.faction) ? p.faction : NO_FACTION;
}
