// POLITICS & ELECTION CORE
//
// Pure, transport-agnostic module managing:
// - Political parties with slogans, promises, and 3D avatar cosmetics
// - Weekly democratic elections per faction
// - Voting integrity (1 vote per citizen per cycle)
// - Faction Government: President, Tax Rate (0%-15%), Starter Kits, and Broadcasts
//
// Shared by client (for prediction & inspection) and server (for authority).

import type { Cosmetics } from './character';
import { validateText } from './content_filter';
import { Block } from './blocks';
import { Item, type ItemStack } from './items';
import { FACTIONS, isFaction } from './teams';

export const ELECTION_TERM_DURATION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days (weekly)
export const MAX_TAX_RATE = 0.15; // 15% maximum tax
export const MIN_TAX_RATE = 0.0;
export const DEFAULT_TAX_RATE = 0.05; // 5% default
export const MAX_PARTIES_PER_FACTION = 12;
/** Campaign promises a party may run on. The founding form enforces this as a
 *  hard cap on the checkboxes rather than silently truncating on submit. */
export const MAX_PROMISES = 3;

export interface StarterKitItem {
  id: number;
  count: number;
}

export const DEFAULT_STARTER_KIT: readonly StarterKitItem[] = [
  { id: Item.StonePickaxe, count: 1 },
  { id: Item.StoneAxe, count: 1 },
  { id: Block.OakPlanks, count: 32 },
  { id: Block.Torch, count: 8 },
  { id: Item.Pistol, count: 1 },
  { id: Item.Bullet, count: 32 },
];

export const PRESET_PROMISES: readonly string[] = [
  'Low Tax Target (3%) · Boost Private Miners',
  'Balanced Tax (5%) · Steady Infrastructure',
  'Defense Priority (10%) · Maximum War Fortification',
  'Recruit Support · Fund 100+ Free Starter Packs',
  'Fortify Flag Base · Upgrade Perimeter Turrets',
  'Organize Vault Expeditions & Boss Relic Raids',
  'Tactical Silo Expansion · Coordinated Missile Strikes',
  'Air Superiority · Subsidize Attack Helicopters',
];

export interface PoliticalParty {
  id: string;
  name: string;
  faction: number;
  leader: string;
  slogan: string;
  promises: string[];
  cosmetics: Cosmetics;
  armor?: (ItemStack | null)[];
  held?: ItemStack | null;
  votes: number;
  voters: string[];
  createdAt: number;
}

export interface FactionBroadcast {
  id: string;
  sender: string;
  faction: number;
  text: string;
  timestamp: number;
}

export interface ElectionState {
  faction: number;
  termEndsAt: number;
  activePresident: string | null;
  activePartyId: string | null;
  presidentPartyName?: string;
  presidentSlogan?: string;
  presidentPromises?: string[];
  presidentCosmetics?: Cosmetics;
  presidentArmor?: (ItemStack | null)[];
  presidentHeld?: ItemStack | null;
  parties: PoliticalParty[];
}

export interface FactionGovernment {
  faction: number;
  taxRate: number;
  kit: StarterKitItem[];
  kitStock: number;
  broadcasts: FactionBroadcast[];
}

export interface PoliticsState {
  elections: Record<number, ElectionState>;
  governments: Record<number, FactionGovernment>;
}

export function createInitialElection(faction: number, now = Date.now()): ElectionState {
  return {
    faction,
    termEndsAt: now + ELECTION_TERM_DURATION_MS,
    activePresident: null,
    activePartyId: null,
    parties: [],
  };
}

export function createInitialGovernment(faction: number): FactionGovernment {
  return {
    faction,
    taxRate: DEFAULT_TAX_RATE,
    kit: [...DEFAULT_STARTER_KIT],
    kitStock: 25, // initial funded kits for recruits
    broadcasts: [
      {
        id: `bc_init_${faction}`,
        sender: 'Faction High Command',
        faction,
        text: `Welcome to the ${faction === 0 ? 'Crimson Vanguard' : 'Azure Legion'}. Build your civilization, elect your leaders, and defend the treasury!`,
        timestamp: Date.now(),
      },
    ],
  };
}

export function createInitialPoliticsState(now = Date.now()): PoliticsState {
  const elections: Record<number, ElectionState> = {};
  const governments: Record<number, FactionGovernment> = {};

  for (const f of FACTIONS) {
    elections[f.id] = createInitialElection(f.id, now);
    governments[f.id] = createInitialGovernment(f.id);
  }

  return { elections, governments };
}

/**
 * Register a new political party for an upcoming election.
 * Enforces text moderation, 1 party per player per election, and party caps.
 */
export function createParty(
  state: PoliticsState,
  faction: number,
  leader: string,
  name: string,
  slogan: string,
  promises: string[],
  cosmetics: Cosmetics,
  armor?: (ItemStack | null)[],
  held?: ItemStack | null
): { ok: boolean; error?: string; party?: PoliticalParty } {
  if (!isFaction(faction)) {
    return { ok: false, error: 'Invalid faction.' };
  }

  const cleanName = (name ?? '').trim();
  const cleanSlogan = (slogan ?? '').trim();

  if (cleanName.length < 3 || cleanName.length > 28) {
    return { ok: false, error: 'Party name must be between 3 and 28 characters.' };
  }
  if (cleanSlogan.length < 3 || cleanSlogan.length > 64) {
    return { ok: false, error: 'Campaign slogan must be between 3 and 64 characters.' };
  }

  // Heavy content filter validation
  const nameCheck = validateText(cleanName, 'Party Name');
  if (!nameCheck.ok) return { ok: false, error: nameCheck.reason };

  const sloganCheck = validateText(cleanSlogan, 'Campaign Slogan');
  if (!sloganCheck.ok) return { ok: false, error: sloganCheck.reason };

  if (!Array.isArray(promises)) {
    return { ok: false, error: 'Campaign promises must be a list.' };
  }
  const cleanPromises = promises
    .filter((p): p is string => typeof p === 'string')
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
    .slice(0, MAX_PROMISES);

  for (const p of cleanPromises) {
    const pCheck = validateText(p, 'Promise');
    if (!pCheck.ok) return { ok: false, error: pCheck.reason };
  }

  const election = state.elections[faction];
  if (!election) {
    return { ok: false, error: 'Election state not found.' };
  }

  if (election.parties.length >= MAX_PARTIES_PER_FACTION) {
    return { ok: false, error: `Maximum candidate limit (${MAX_PARTIES_PER_FACTION}) reached for this election cycle.` };
  }

  const existingLeader = election.parties.find(
    (p) => p.leader.toLowerCase() === leader.toLowerCase()
  );
  if (existingLeader) {
    return { ok: false, error: 'You have already registered a political party for this election cycle.' };
  }

  const duplicateName = election.parties.find(
    (p) => p.name.toLowerCase() === cleanName.toLowerCase()
  );
  if (duplicateName) {
    return { ok: false, error: 'A political party with this name is already registered.' };
  }

  const party: PoliticalParty = {
    id: `party_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    name: cleanName,
    faction,
    leader,
    slogan: cleanSlogan,
    promises: cleanPromises,
    cosmetics,
    armor: armor ? [...armor] : undefined,
    held: held ? { ...held } : null,
    votes: 0,
    voters: [],
    createdAt: Date.now(),
  };

  election.parties.push(party);
  return { ok: true, party };
}

/**
 * Cast a vote for a candidate party in the faction election.
 * Enforces 1 vote per citizen per cycle.
 */
export function castVote(
  state: PoliticsState,
  faction: number,
  username: string,
  partyId: string
): { ok: boolean; error?: string } {
  if (!isFaction(faction)) return { ok: false, error: 'Invalid faction.' };
  const election = state.elections[faction];
  if (!election) return { ok: false, error: 'Election not found.' };

  const uLower = username.toLowerCase();

  // Check if citizen has already voted
  for (const p of election.parties) {
    if (p.voters.includes(uLower)) {
      return { ok: false, error: 'You have already cast your vote in this election cycle.' };
    }
  }

  const target = election.parties.find((p) => p.id === partyId);
  if (!target) {
    return { ok: false, error: 'Selected political party not found.' };
  }

  target.votes++;
  target.voters.push(uLower);
  return { ok: true };
}

/**
 * Checks which party a user voted for (or null if not voted).
 */
export function hasVoted(
  election: ElectionState,
  username: string
): string | null {
  const uLower = username.toLowerCase();
  for (const p of election.parties) {
    if (p.voters.includes(uLower)) return p.id;
  }
  return null;
}

/**
 * Conclude the election cycle, inaugurate the winner, and reset for the new term.
 */
export function resolveElection(
  state: PoliticsState,
  faction: number,
  now = Date.now(),
  termDuration = ELECTION_TERM_DURATION_MS
): { winner: PoliticalParty | null; broadcast: FactionBroadcast } {
  const election = state.elections[faction];
  if (!election) {
    return {
      winner: null,
      broadcast: {
        id: `bc_${now}`,
        sender: 'Election Commission',
        faction,
        text: 'Election ended with no candidates.',
        timestamp: now,
      },
    };
  }

  let winner: PoliticalParty | null = null;
  let maxVotes = -1;

  for (const party of election.parties) {
    if (party.votes > maxVotes) {
      maxVotes = party.votes;
      winner = party;
    } else if (party.votes === maxVotes && winner) {
      // Deterministic tie breaker: older party wins
      if (party.createdAt < winner.createdAt) {
        winner = party;
      }
    }
  }

  let broadcastText = '';
  if (winner && winner.votes > 0) {
    election.activePresident = winner.leader;
    election.activePartyId = winner.id;
    election.presidentPartyName = winner.name;
    election.presidentSlogan = winner.slogan;
    election.presidentPromises = [...winner.promises];
    election.presidentCosmetics = { ...winner.cosmetics };
    election.presidentArmor = winner.armor ? [...winner.armor] : undefined;
    election.presidentHeld = winner.held ? { ...winner.held } : null;

    broadcastText = `🏛️ INAUGURATION: ${winner.leader} of "${winner.name}" has been elected President of the ${faction === 0 ? 'Crimson Vanguard' : 'Azure Legion'} with ${winner.votes} votes!`;
  } else if (winner) {
    // Single uncontested candidate with 0 votes
    election.activePresident = winner.leader;
    election.activePartyId = winner.id;
    election.presidentPartyName = winner.name;
    election.presidentSlogan = winner.slogan;
    election.presidentPromises = [...winner.promises];
    election.presidentCosmetics = { ...winner.cosmetics };
    election.presidentArmor = winner.armor ? [...winner.armor] : undefined;
    election.presidentHeld = winner.held ? { ...winner.held } : null;

    broadcastText = `🏛️ INAUGURATION: ${winner.leader} of "${winner.name}" assumes the Presidency of the ${faction === 0 ? 'Crimson Vanguard' : 'Azure Legion'}!`;
  } else {
    // Vacant podium
    election.activePresident = null;
    election.activePartyId = null;
    election.presidentPartyName = undefined;
    election.presidentSlogan = undefined;
    election.presidentPromises = undefined;
    election.presidentCosmetics = undefined;
    election.presidentArmor = undefined;
    election.presidentHeld = null;

    broadcastText = `🏛️ ELECTION CONCLUSION: No candidates ran for office. The presidential podium of the ${faction === 0 ? 'Crimson Vanguard' : 'Azure Legion'} is currently vacant.`;
  }

  // Reset candidates and term timer for new term
  election.parties = [];
  election.termEndsAt = now + termDuration;

  const bc: FactionBroadcast = {
    id: `bc_${now}_${Math.random().toString(36).slice(2, 6)}`,
    sender: 'Election Commission',
    faction,
    text: broadcastText,
    timestamp: now,
  };

  const gov = state.governments[faction];
  if (gov) {
    gov.broadcasts.unshift(bc);
    if (gov.broadcasts.length > 20) gov.broadcasts.length = 20;
  }

  return { winner, broadcast: bc };
}

/**
 * President configures faction tax rate (0% - 15%).
 */
export function setTaxRate(
  state: PoliticsState,
  faction: number,
  requester: string,
  rate: number
): { ok: boolean; error?: string } {
  const election = state.elections[faction];
  const gov = state.governments[faction];
  if (!election || !gov) return { ok: false, error: 'Faction government not found.' };

  if (!election.activePresident || election.activePresident.toLowerCase() !== requester.toLowerCase()) {
    return { ok: false, error: 'Only the currently elected Faction President can set the tax rate.' };
  }

  const clamped = Math.max(MIN_TAX_RATE, Math.min(MAX_TAX_RATE, Number.isFinite(rate) ? rate : DEFAULT_TAX_RATE));
  gov.taxRate = Math.round(clamped * 100) / 100;
  return { ok: true };
}

/**
 * Allocate funded starter kit stock.
 */
export function allocateKitStock(
  state: PoliticsState,
  faction: number,
  requester: string,
  amount: number
): { ok: boolean; error?: string } {
  const election = state.elections[faction];
  const gov = state.governments[faction];
  if (!election || !gov) return { ok: false, error: 'Faction government not found.' };

  if (!election.activePresident || election.activePresident.toLowerCase() !== requester.toLowerCase()) {
    return { ok: false, error: 'Only the Faction President can fund recruit starter kits.' };
  }

  const add = Math.max(1, Math.min(500, Math.floor(amount)));
  gov.kitStock = Math.min(1000, gov.kitStock + add);
  return { ok: true };
}

/**
 * Configure starter kit items.
 */
export function updateStarterKit(
  state: PoliticsState,
  faction: number,
  requester: string,
  kit: StarterKitItem[]
): { ok: boolean; error?: string } {
  const election = state.elections[faction];
  const gov = state.governments[faction];
  if (!election || !gov) return { ok: false, error: 'Faction government not found.' };

  if (!election.activePresident || election.activePresident.toLowerCase() !== requester.toLowerCase()) {
    return { ok: false, error: 'Only the Faction President can configure recruit starter kits.' };
  }

  if (!Array.isArray(kit) || kit.length === 0) {
    return { ok: false, error: 'Starter kit must contain at least one item.' };
  }

  gov.kit = kit.slice(0, 8);
  return { ok: true };
}

/**
 * Claim a starter kit upon joining a faction.
 * Returns kit items if funded, or null if no starter kit is currently funded.
 */
export function claimStarterKit(
  state: PoliticsState,
  faction: number
): { ok: boolean; kit?: StarterKitItem[] } {
  const gov = state.governments[faction];
  if (!gov || gov.kitStock <= 0 || !gov.kit.length) {
    return { ok: false };
  }

  gov.kitStock--;
  return { ok: true, kit: [...gov.kit] };
}

/**
 * Add a presidential announcement broadcast to all citizens of the faction.
 */
export function addBroadcast(
  state: PoliticsState,
  faction: number,
  sender: string,
  text: string
): { ok: boolean; error?: string; broadcast?: FactionBroadcast } {
  const election = state.elections[faction];
  const gov = state.governments[faction];
  if (!election || !gov) return { ok: false, error: 'Faction government not found.' };

  if (!election.activePresident || election.activePresident.toLowerCase() !== sender.toLowerCase()) {
    return { ok: false, error: 'Only the Faction President can issue executive faction broadcasts.' };
  }

  const cleanText = (text ?? '').trim();
  if (cleanText.length < 3 || cleanText.length > 140) {
    return { ok: false, error: 'Broadcast message must be between 3 and 140 characters.' };
  }

  const check = validateText(cleanText, 'Presidential Broadcast');
  if (!check.ok) return { ok: false, error: check.reason };

  const bc: FactionBroadcast = {
    id: `bc_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    sender,
    faction,
    text: cleanText,
    timestamp: Date.now(),
  };

  gov.broadcasts.unshift(bc);
  if (gov.broadcasts.length > 20) gov.broadcasts.length = 20;

  return { ok: true, broadcast: bc };
}

/**
 * The view of the politics state that is safe to BROADCAST.
 *
 * `voters` is the list of everyone who backed a party. Shipping it to every
 * client turns a secret ballot into a public register of who voted for whom —
 * so the wire copy carries only the tally, plus the single entry the recipient
 * is entitled to know: their own vote.
 */
export function publicPoliticsState(state: PoliticsState, forUser: string): PoliticsState {
  const uLower = (forUser ?? '').toLowerCase();
  const elections: Record<number, ElectionState> = {};

  for (const [key, election] of Object.entries(state.elections)) {
    elections[Number(key)] = {
      ...election,
      parties: election.parties.map((p) => ({
        ...p,
        // Keep only the recipient's own ballot, so the UI can still show
        // "your vote" and refuse a second one.
        voters: p.voters.includes(uLower) ? [uLower] : [],
      })),
    };
  }

  return { elections, governments: state.governments };
}

/**
 * Rebuild a politics state from an untrusted save blob.
 *
 * A world file may predate this system, or have been truncated mid-write. Every
 * other field in the save is validated before use; this does the same, so a
 * half-written blob can never leave a faction with no election or no
 * government (which every handler here assumes exists).
 */
export function sanitizePoliticsState(raw: unknown, now = Date.now()): PoliticsState {
  const fresh = createInitialPoliticsState(now);
  if (!raw || typeof raw !== 'object') return fresh;

  const src = raw as Partial<PoliticsState>;

  for (const f of FACTIONS) {
    const el = src.elections?.[f.id];
    if (el && typeof el === 'object' && Array.isArray(el.parties)) {
      fresh.elections[f.id] = {
        faction: f.id,
        termEndsAt: Number.isFinite(el.termEndsAt) ? el.termEndsAt : now + ELECTION_TERM_DURATION_MS,
        activePresident: typeof el.activePresident === 'string' ? el.activePresident : null,
        activePartyId: typeof el.activePartyId === 'string' ? el.activePartyId : null,
        presidentPartyName: el.presidentPartyName,
        presidentSlogan: el.presidentSlogan,
        presidentPromises: el.presidentPromises,
        presidentCosmetics: el.presidentCosmetics,
        presidentArmor: el.presidentArmor,
        presidentHeld: el.presidentHeld ?? null,
        parties: el.parties.filter((p): p is PoliticalParty =>
          !!p && typeof p === 'object' &&
          typeof p.id === 'string' && typeof p.name === 'string' &&
          typeof p.leader === 'string' && Number.isFinite(p.votes) &&
          Array.isArray(p.voters)),
      };
    }

    const gov = src.governments?.[f.id];
    if (gov && typeof gov === 'object') {
      fresh.governments[f.id] = {
        faction: f.id,
        taxRate: Number.isFinite(gov.taxRate)
          ? Math.max(MIN_TAX_RATE, Math.min(MAX_TAX_RATE, gov.taxRate)) : DEFAULT_TAX_RATE,
        kit: Array.isArray(gov.kit)
          ? gov.kit.filter((k): k is StarterKitItem =>
              !!k && Number.isFinite(k.id) && Number.isFinite(k.count) && k.count > 0).slice(0, 8)
          : [...DEFAULT_STARTER_KIT],
        kitStock: Number.isFinite(gov.kitStock)
          ? Math.max(0, Math.min(1000, Math.floor(gov.kitStock))) : 0,
        broadcasts: Array.isArray(gov.broadcasts)
          ? gov.broadcasts.filter((b): b is FactionBroadcast =>
              !!b && typeof b.text === 'string' && typeof b.sender === 'string').slice(0, 20)
          : [],
      };
    }
  }

  return fresh;
}

/**
 * Human-readable remaining term countdown (e.g. "4d 12h", "5h 22m", "14m").
 */
export function formatTermRemaining(endsAt: number, now = Date.now()): string {
  const diff = Math.max(0, endsAt - now);
  if (diff <= 0) return 'Concluded';

  const totalMinutes = Math.floor(diff / (60 * 1000));
  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  const minutes = totalMinutes % 60;

  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${Math.max(1, minutes)}m`;
}
