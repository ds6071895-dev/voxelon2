// FACTION GOVERNMENT — parties, weekly elections, and the powers of office.
//
// A faction used to be a colour you were assigned. This is the layer that makes
// it a place with a politics: any citizen may found a PARTY, every citizen gets
// ONE vote per weekly cycle, and the party with the most votes seats its founder
// as PRESIDENT. The office is not ceremonial — a sitting president sets the
// faction's TAX RATE (levied on everything its citizens pull out of the ground,
// see treasury.ts), LAYS OUT the recruit kit slot by slot and funds a stock of
// them OUT OF THEIR OWN INVENTORY, and BROADCASTS to every member's inbox.
//
// PURE + transport-agnostic (no THREE/DOM/Node) so the authoritative server, the
// offline client and the smoke tests share one rule set — same discipline as
// teams.ts / flags.ts / war.ts. Every mutator is fail-closed and returns a
// reason on refusal, because the client mirrors these rules to grey out controls
// and the server re-runs them to decide.
//
// TRUST: the client never decides who holds office. It renders what the sync
// says and hides controls it believes are unavailable; the server re-checks the
// presidency on every govern-* message.

import { FACTIONS, isFaction } from './teams';
import { KIT_SLOTS, type KitLoadout, newKit, sanitizeKit } from './treasury';

/** One term. Elections are weekly — short enough that a bad president is a
 *  week-long problem, long enough that governing means something. */
export const TERM_MS = 7 * 24 * 3600 * 1000;
/** Tax ceiling. A president cannot confiscate a faction's whole economy: at 15%
 *  a citizen always keeps the large majority of what they mine. */
export const MAX_TAX = 0.15;
export const DEFAULT_TAX = 0.05;
export const MAX_PARTIES_PER_FACTION = 12;
export const MAX_PROMISES = 3;
export const MAX_PARTY_NAME = 24;
export const MAX_SLOGAN = 80;
export const MAX_BROADCAST = 200;
/** Stored broadcasts per faction. A player who was offline still finds the last
 *  few in their inbox on next login; older ones fall off the ring. */
export const MAX_BROADCASTS = 30;

/**
 * The platform a party may run on. Promises are PICKED, never typed: a fixed
 * list keeps campaign copy readable, keeps it translatable later, and means the
 * only free text in the whole system is a party's name and slogan.
 */
export const PRESET_PROMISES: readonly string[] = [
  'Cut tax to 3% — miners keep what they dig',
  'Hold tax at 5% — steady funding, no surprises',
  'Raise tax to 10% — fortify the flag before the next war',
  'Fund 100 recruit kits — nobody starts this war empty-handed',
  'Treasury first — bank every levy against a siege',
  'Fund vault expeditions and split the boss relics',
  'Subsidise the bomb bays — answer every raid in kind',
  'Air superiority — a helicopter for every squad',
];

export interface Party {
  /** Stable id, unique within the whole state (`p<faction>_<serial>`). */
  id: string;
  faction: number;
  /** Username of the founder — the candidate who takes office if this wins. */
  founder: string;
  name: string;
  slogan: string;
  /** Indices into PRESET_PROMISES, deduplicated, at most MAX_PROMISES. */
  promises: number[];
  /** Wall-clock ms. Also the tie-break: the party that stood first wins a draw. */
  createdAt: number;
}

export interface Election {
  faction: number;
  /** 1-based term counter; bumps on every tally. */
  cycle: number;
  /** Wall-clock ms at which this cycle's votes are counted. */
  endsAt: number;
  /** Parties PERSIST across cycles — you found one once and it keeps standing. */
  parties: Party[];
  /** username -> partyId for THIS cycle only; cleared on every tally. */
  votes: Record<string, string>;
  /** Sitting president, or null while the seat is vacant (nobody has ever won,
   *  or the last tally drew no votes at all). */
  president: string | null;
  presidentPartyId: string | null;
}

export interface Broadcast {
  id: string;
  from: string;
  text: string;
  at: number;
}

export interface Government {
  faction: number;
  taxRate: number;
  /** Starter kits the president has paid for out of their own pockets, waiting
   *  for a recruit to claim one. */
  kitStock: number;
  /** The LOADOUT one of those kits hands over — 4 armor slots then 9 hotbar
   *  slots (treasury.ts owns the layout). A president rewrites it; everyone
   *  else reads it, because what your faction issues its recruits is a public
   *  fact about the faction, not a secret of the office. */
  kit: KitLoadout;
  broadcasts: Broadcast[];
}

export interface PoliticsState {
  elections: Record<number, Election>;
  governments: Record<number, Government>;
  /** Monotonic counter behind party and broadcast ids. Serialized so ids stay
   *  unique across a server restart. */
  serial: number;
}

export interface GovResult { ok: boolean; error?: string; }

export function newElection(faction: number, now: number): Election {
  return {
    faction, cycle: 1, endsAt: now + TERM_MS, parties: [], votes: {},
    president: null, presidentPartyId: null,
  };
}

export function newGovernment(faction: number): Government {
  return { faction, taxRate: DEFAULT_TAX, kitStock: 0, kit: newKit(), broadcasts: [] };
}

export function newPolitics(now: number): PoliticsState {
  const elections: Record<number, Election> = {};
  const governments: Record<number, Government> = {};
  for (const f of FACTIONS) {
    elections[f.id] = newElection(f.id, now);
    governments[f.id] = newGovernment(f.id);
  }
  return { elections, governments, serial: 1 };
}

// --- Text handling ----------------------------------------------------------

/**
 * Normalise a player-authored label: collapse whitespace, drop control
 * characters and the handful of glyphs that let a name impersonate markup or
 * the game's own UI chrome, then hard-cap the length.
 *
 * This is NOT a moderation engine and does not pretend to be one — the panels
 * render every label as a TEXT NODE, so the job here is length and legibility,
 * not safety. Returns '' for anything that survives as empty, which every
 * caller treats as a refusal.
 */
export function sanitizeLabel(raw: unknown, maxLen: number): string {
  if (typeof raw !== 'string') return '';
  let out = '';
  for (const ch of raw) {
    const code = ch.codePointAt(0)!;
    // C0/C1 controls, and the bidi/zero-width run that can reorder a name.
    if (code < 0x20 || (code >= 0x7f && code <= 0x9f)) continue;
    if (code >= 0x200b && code <= 0x200f) continue;
    if (code >= 0x202a && code <= 0x202e) continue;
    if (code === 0xfeff) continue;
    if (ch === '<' || ch === '>' || ch === '`') continue;
    out += ch;
  }
  return out.replace(/\s+/g, ' ').trim().slice(0, Math.max(0, maxLen));
}

/** Fail-closed promise list: integers in range, deduplicated, capped. */
export function sanitizePromises(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<number>();
  for (const v of raw) {
    if (!Number.isInteger(v)) continue;
    const i = v as number;
    if (i < 0 || i >= PRESET_PROMISES.length) continue;
    seen.add(i);
    if (seen.size >= MAX_PROMISES) break;
  }
  return [...seen];
}

// --- Reads ------------------------------------------------------------------

export function electionOf(state: PoliticsState, faction: number): Election | undefined {
  return isFaction(faction) ? state.elections[faction] : undefined;
}

export function governmentOf(state: PoliticsState, faction: number): Government | undefined {
  return isFaction(faction) ? state.governments[faction] : undefined;
}

/** Is `username` the sitting president of `faction`? Case-insensitive, because
 *  usernames are case-insensitive identities everywhere else. */
export function isPresident(
  state: PoliticsState, faction: number, username: string
): boolean {
  const e = electionOf(state, faction);
  return !!e?.president && !!username &&
    e.president.toLowerCase() === username.toLowerCase();
}

export function partyById(e: Election, id: string): Party | undefined {
  return e.parties.find((p) => p.id === id);
}

/** The party this player founded in `faction`, or undefined. One per citizen. */
export function partyOfFounder(e: Election, username: string): Party | undefined {
  const key = (username ?? '').toLowerCase();
  return e.parties.find((p) => p.founder.toLowerCase() === key);
}

/** Votes cast for each party this cycle, keyed by party id. */
export function voteCounts(e: Election): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const p of e.parties) counts[p.id] = 0;
  for (const partyId of Object.values(e.votes)) {
    if (counts[partyId] !== undefined) counts[partyId]++;
  }
  return counts;
}

/** The ballot this player has already cast this cycle, or null. */
export function ballotOf(e: Election, username: string): string | null {
  return e.votes[(username ?? '').toLowerCase()] ?? null;
}

// --- Mutators ---------------------------------------------------------------

/**
 * Stand for election. One party per citizen per faction; the founder is the
 * candidate. Refuses (rather than truncating) on empty or over-long copy so the
 * player is told what was wrong instead of silently getting something else.
 */
export function foundParty(
  state: PoliticsState, faction: number, founder: string,
  name: unknown, slogan: unknown, promises: unknown, now: number
): GovResult & { party?: Party } {
  const e = electionOf(state, faction);
  if (!e) return { ok: false, error: 'You have no faction.' };
  if (!founder) return { ok: false, error: 'You have no faction.' };
  if (partyOfFounder(e, founder)) {
    return { ok: false, error: 'You already lead a party — disband it first.' };
  }
  if (e.parties.length >= MAX_PARTIES_PER_FACTION) {
    return { ok: false, error: `The ballot is full (${MAX_PARTIES_PER_FACTION} parties).` };
  }
  const cleanName = sanitizeLabel(name, MAX_PARTY_NAME);
  if (cleanName.length < 3) {
    return { ok: false, error: 'A party name needs at least 3 characters.' };
  }
  if (e.parties.some((p) => p.name.toLowerCase() === cleanName.toLowerCase())) {
    return { ok: false, error: 'A party already stands under that name.' };
  }
  const cleanSlogan = sanitizeLabel(slogan, MAX_SLOGAN);
  if (cleanSlogan.length < 3) {
    return { ok: false, error: 'Give your party a slogan.' };
  }
  const picked = sanitizePromises(promises);
  if (picked.length === 0) {
    return { ok: false, error: 'Pick at least one campaign promise.' };
  }
  const party: Party = {
    id: `p${faction}_${state.serial++}`,
    faction, founder, name: cleanName, slogan: cleanSlogan,
    promises: picked, createdAt: now,
  };
  e.parties.push(party);
  return { ok: true, party };
}

/** Withdraw your own party. Any ballots cast for it are released, so its voters
 *  can back somebody else rather than having their vote quietly evaporate. */
export function disbandParty(
  state: PoliticsState, faction: number, founder: string
): GovResult {
  const e = electionOf(state, faction);
  if (!e) return { ok: false, error: 'You have no faction.' };
  const party = partyOfFounder(e, founder);
  if (!party) return { ok: false, error: 'You do not lead a party.' };
  e.parties = e.parties.filter((p) => p.id !== party.id);
  for (const [voter, partyId] of Object.entries(e.votes)) {
    if (partyId === party.id) delete e.votes[voter];
  }
  // A president whose party is gone still finishes the term they were elected
  // to; only the party link is cleared.
  if (e.presidentPartyId === party.id) e.presidentPartyId = null;
  return { ok: true };
}

/** Cast (or move) this cycle's single vote. Re-voting relocates the ballot
 *  rather than adding one — the count is derived from the map, never incremented. */
export function castVote(
  state: PoliticsState, faction: number, username: string, partyId: string
): GovResult {
  const e = electionOf(state, faction);
  if (!e) return { ok: false, error: 'You have no faction.' };
  if (!username) return { ok: false, error: 'You have no faction.' };
  if (!partyById(e, partyId)) return { ok: false, error: 'That party is no longer standing.' };
  e.votes[username.toLowerCase()] = partyId;
  return { ok: true };
}

/**
 * Count this cycle's ballots. The most-voted party seats its founder; a draw
 * goes to whichever of the tied parties stood FIRST (deterministic, and it
 * rewards the party that has been campaigning longest). No votes at all leaves
 * the seat exactly as it was — an unopposed incumbent is not thrown out by
 * apathy, and a vacant seat stays vacant.
 */
export function tallyElection(e: Election): { president: string | null; party: Party | null } {
  const counts = voteCounts(e);
  let best: Party | null = null, bestN = 0;
  for (const p of e.parties) {
    const n = counts[p.id] ?? 0;
    if (n > bestN || (n === bestN && n > 0 && best && p.createdAt < best.createdAt)) {
      best = p; bestN = n;
    }
  }
  if (!best || bestN <= 0) return { president: e.president, party: null };
  e.president = best.founder;
  e.presidentPartyId = best.id;
  return { president: best.founder, party: best };
}

/** Open the next cycle: ballots cleared, parties kept, clock reset. */
export function rollCycle(e: Election, now: number): void {
  e.cycle = Math.max(1, e.cycle) + 1;
  e.votes = {};
  e.endsAt = now + TERM_MS;
}

/** Has this cycle's clock run out? */
export function termExpired(e: Election, now: number): boolean {
  return now >= e.endsAt;
}

/**
 * Rewrite the recruit loadout. Fail-closed through `sanitizeKit`, which drops
 * anything malformed or in an armor slot it does not belong in — so a refused
 * line becomes a visible gap rather than a silently relocated item.
 *
 * An entirely empty loadout is refused: `kitStock` would then be a counter of
 * nothing, and a recruit would claim their one-and-only kit and get air.
 */
export function setKit(g: Government, slots: unknown): GovResult {
  if (!Array.isArray(slots) || slots.length > KIT_SLOTS) {
    return { ok: false, error: 'That is not a kit layout.' };
  }
  const kit = sanitizeKit(slots);
  if (!kit.some((s) => s)) {
    return { ok: false, error: 'A kit needs at least one item in it.' };
  }
  g.kit = kit;
  return { ok: true };
}

export function setTaxRate(g: Government, rate: unknown): GovResult {
  if (!Number.isFinite(rate)) return { ok: false, error: 'Not a tax rate.' };
  g.taxRate = Math.max(0, Math.min(MAX_TAX, rate as number));
  return { ok: true };
}

export function pushBroadcast(
  g: Government, from: string, text: unknown, now: number, serial: number
): GovResult & { broadcast?: Broadcast } {
  const clean = sanitizeLabel(text, MAX_BROADCAST);
  if (clean.length < 2) return { ok: false, error: 'Say something first.' };
  const broadcast: Broadcast = { id: `b${g.faction}_${serial}`, from, text: clean, at: now };
  g.broadcasts.push(broadcast);
  if (g.broadcasts.length > MAX_BROADCASTS) {
    g.broadcasts.splice(0, g.broadcasts.length - MAX_BROADCASTS);
  }
  return { ok: true, broadcast };
}

// --- Persistence ------------------------------------------------------------

function sanitizeParty(raw: unknown, faction: number): Party | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const id = typeof r.id === 'string' && r.id.length <= 40 ? r.id : '';
  const founder = typeof r.founder === 'string' ? r.founder : '';
  const name = sanitizeLabel(r.name, MAX_PARTY_NAME);
  const slogan = sanitizeLabel(r.slogan, MAX_SLOGAN);
  if (!id || !founder || !name || !slogan) return null;
  return {
    id, faction, founder, name, slogan,
    promises: sanitizePromises(r.promises),
    createdAt: Number.isFinite(r.createdAt) ? (r.createdAt as number) : 0,
  };
}

function sanitizeElection(raw: unknown, faction: number, now: number): Election {
  const fresh = newElection(faction, now);
  if (!raw || typeof raw !== 'object') return fresh;
  const r = raw as Record<string, unknown>;
  const parties: Party[] = [];
  if (Array.isArray(r.parties)) {
    for (const p of r.parties) {
      const party = sanitizeParty(p, faction);
      if (party && !parties.some((q) => q.id === party.id)) parties.push(party);
      if (parties.length >= MAX_PARTIES_PER_FACTION) break;
    }
  }
  const votes: Record<string, string> = {};
  if (r.votes && typeof r.votes === 'object') {
    for (const [voter, partyId] of Object.entries(r.votes as Record<string, unknown>)) {
      if (typeof voter !== 'string' || typeof partyId !== 'string') continue;
      if (parties.some((p) => p.id === partyId)) votes[voter.toLowerCase()] = partyId;
    }
  }
  const president = typeof r.president === 'string' && r.president ? r.president : null;
  const presidentPartyId = typeof r.presidentPartyId === 'string' &&
    parties.some((p) => p.id === r.presidentPartyId) ? r.presidentPartyId : null;
  return {
    faction,
    cycle: Number.isFinite(r.cycle) ? Math.max(1, Math.floor(r.cycle as number)) : 1,
    // A saved deadline in the past is fine: the next tick tallies it. A deadline
    // absurdly far in the future is not, so it is clamped to one full term.
    endsAt: Number.isFinite(r.endsAt)
      ? Math.min(r.endsAt as number, now + TERM_MS) : now + TERM_MS,
    parties, votes, president, presidentPartyId,
  };
}

function sanitizeGovernment(raw: unknown, faction: number): Government {
  const fresh = newGovernment(faction);
  if (!raw || typeof raw !== 'object') return fresh;
  const r = raw as Record<string, unknown>;
  const broadcasts: Broadcast[] = [];
  if (Array.isArray(r.broadcasts)) {
    for (const b of r.broadcasts.slice(-MAX_BROADCASTS)) {
      if (!b || typeof b !== 'object') continue;
      const rb = b as Record<string, unknown>;
      const text = sanitizeLabel(rb.text, MAX_BROADCAST);
      const from = typeof rb.from === 'string' ? rb.from : '';
      if (!text || !from || typeof rb.id !== 'string') continue;
      broadcasts.push({
        id: rb.id, from, text,
        at: Number.isFinite(rb.at) ? (rb.at as number) : 0,
      });
    }
  }
  return {
    faction,
    taxRate: Number.isFinite(r.taxRate)
      ? Math.max(0, Math.min(MAX_TAX, r.taxRate as number)) : DEFAULT_TAX,
    kitStock: Number.isFinite(r.kitStock)
      ? Math.max(0, Math.floor(r.kitStock as number)) : 0,
    // A save from before kits were editable has no `kit` at all: those factions
    // come back issuing the classic STARTER_KIT rather than issuing nothing.
    kit: r.kit === undefined ? newKit() : sanitizeKit(r.kit),
    broadcasts,
  };
}

/** Fail-closed load of a persisted/wire politics blob. Every faction always
 *  comes back present, so no caller has to handle a missing government. */
export function sanitizePolitics(raw: unknown, now: number): PoliticsState {
  const state = newPolitics(now);
  if (!raw || typeof raw !== 'object') return state;
  const r = raw as Record<string, unknown>;
  const elections = (r.elections ?? {}) as Record<string, unknown>;
  const governments = (r.governments ?? {}) as Record<string, unknown>;
  let serial = Number.isFinite(r.serial) ? Math.max(1, Math.floor(r.serial as number)) : 1;
  for (const f of FACTIONS) {
    state.elections[f.id] = sanitizeElection(elections[f.id], f.id, now);
    state.governments[f.id] = sanitizeGovernment(governments[f.id], f.id);
    // Never hand out an id a restored party already owns.
    for (const p of state.elections[f.id].parties) {
      const n = Number(p.id.split('_')[1]);
      if (Number.isFinite(n)) serial = Math.max(serial, n + 1);
    }
  }
  state.serial = serial;
  return state;
}
