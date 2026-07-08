// PROGRESSION — personal + faction XP earned by killing mobs and players.
// Kills grant XP to YOU (level up, spend skill points on modest personal
// upgrade tracks) and to YOUR FACTION's shared pool (faction levels grant small
// automatic perks to every member). Deliberately modest: no upgrade beats
// gear/aim — they shave edges, they don't win fights.
//
// PURE + transport-agnostic (no THREE/DOM/Node), like machines.ts/war.ts: the
// same rules run on the authoritative server (faction pool + PvP awards), the
// online client (personal XP is client-owned, persisted via saveState like the
// inventory), and offline single-player.

/** XP per mob kill, by mob kind (client-simulated mobs report these). */
export const XP_MOB: Record<string, number> = {
  zombie: 5,
  skitter: 6,
  spitter: 8,
  brute: 40,
};
/** XP for a PvP kill (server-awarded — never client-reported). */
export const XP_PLAYER_KILL = 25;
/** Server clamp on a single client mob-XP report (anti-grief ceiling). */
export const XP_REPORT_CAP = 50;

// --- Personal levels ---------------------------------------------------------
// Total XP to REACH level L (from level 1): 40·(L−1)². Level 2 ≈ 8 zombies,
// level 5 = 640 XP, level 10 = 3240 XP — steady, not grindy, not instant.
const LEVEL_XP = 40;
export const MAX_LEVEL = 20;

/** Personal level for an XP total (level 1 at 0 XP, capped at MAX_LEVEL). */
export function levelFor(xp: number): number {
  if (!Number.isFinite(xp) || xp <= 0) return 1;
  return Math.min(MAX_LEVEL, Math.floor(Math.sqrt(xp / LEVEL_XP)) + 1);
}
/** Total XP needed to reach a level (inverse of levelFor). */
export function xpForLevel(level: number): number {
  const l = Math.max(1, Math.min(MAX_LEVEL, Math.floor(level)));
  return LEVEL_XP * (l - 1) * (l - 1);
}
/** Progress fraction [0,1] toward the next level (1 when max level). */
export function levelProgress(xp: number): number {
  const l = levelFor(xp);
  if (l >= MAX_LEVEL) return 1;
  const cur = xpForLevel(l), next = xpForLevel(l + 1);
  return Math.max(0, Math.min(1, (xp - cur) / (next - cur)));
}

// --- Personal upgrade tracks --------------------------------------------------
export type TrackId = 'swift' | 'tough' | 'gunner';

export interface TrackDef {
  id: TrackId;
  name: string;
  icon: string;
  /** One line shown in the panel. */
  desc: string;
  /** Max ranks purchasable. */
  max: number;
  /** Human label of one rank's effect (panel display). */
  perRank: string;
}

export const TRACKS: TrackDef[] = [
  { id: 'swift', name: 'Swiftness', icon: '👟', max: 5, perRank: '+2% speed',
    desc: 'Run a little faster. Stacks with your faction perk.' },
  { id: 'tough', name: 'Toughness', icon: '🛡', max: 4, perRank: '+1 armor',
    desc: 'A bonus armor point per rank, on top of worn gear.' },
  { id: 'gunner', name: 'Gunslinger', icon: '🔫', max: 4, perRank: '−8% reload',
    desc: 'Reload your guns faster.' },
];

/** Per-rank effect magnitudes (read by the client applying the buffs). */
export const SWIFT_SPEED_PER_RANK = 0.02;   // +2% move speed
export const TOUGH_ARMOR_PER_RANK = 1;      // +1 armor point
export const GUNNER_RELOAD_PER_RANK = 0.08; // −8% reload time

/** A player's progression state (client-owned, persisted like the inventory). */
export interface ProgressState {
  xp: number;
  spent: Record<TrackId, number>;
}

export function newProgress(): ProgressState {
  return { xp: 0, spent: { swift: 0, tough: 0, gunner: 0 } };
}

/** Skill points earned by a level (one per level past 1). */
export function totalPointsFor(level: number): number {
  return Math.max(0, Math.min(MAX_LEVEL, Math.floor(level)) - 1);
}
export function pointsSpent(s: ProgressState): number {
  return TRACKS.reduce((n, t) => n + Math.max(0, s.spent[t.id] ?? 0), 0);
}
export function pointsAvailable(s: ProgressState): number {
  return Math.max(0, totalPointsFor(levelFor(s.xp)) - pointsSpent(s));
}
export function canBuy(s: ProgressState, track: TrackId): boolean {
  const def = TRACKS.find((t) => t.id === track);
  if (!def) return false;
  return (s.spent[track] ?? 0) < def.max && pointsAvailable(s) > 0;
}
/** Spend one point on a track. Returns whether it was applied. */
export function buyRank(s: ProgressState, track: TrackId): boolean {
  if (!canBuy(s, track)) return false;
  s.spent[track] = (s.spent[track] ?? 0) + 1;
  return true;
}

/** The player's personal buffs from spent ranks. */
export function personalBuffs(s: ProgressState): {
  speedMult: number; armorBonus: number; reloadMult: number;
} {
  return {
    speedMult: 1 + (s.spent.swift ?? 0) * SWIFT_SPEED_PER_RANK,
    armorBonus: (s.spent.tough ?? 0) * TOUGH_ARMOR_PER_RANK,
    reloadMult: Math.max(0.5, 1 - (s.spent.gunner ?? 0) * GUNNER_RELOAD_PER_RANK),
  };
}

/** Fail-closed validation of a persisted progression blob. Clamps spent ranks
 *  to their track caps AND to the points the XP actually earned. */
export function sanitizeProgress(raw: unknown): ProgressState {
  const s = newProgress();
  if (!raw || typeof raw !== 'object') return s;
  const r = raw as Record<string, unknown>;
  s.xp = Number.isFinite(r.xp) ? Math.max(0, Math.floor(r.xp as number)) : 0;
  const spent = (r.spent ?? {}) as Record<string, unknown>;
  let budget = totalPointsFor(levelFor(s.xp));
  for (const t of TRACKS) {
    const v = Number.isFinite(spent[t.id]) ? Math.floor(spent[t.id] as number) : 0;
    const take = Math.max(0, Math.min(t.max, v, budget));
    s.spent[t.id] = take;
    budget -= take;
  }
  return s;
}

// --- Faction pool -------------------------------------------------------------
// The shared pool grows from every member's kills; faction levels come slower
// than personal ones and grant small automatic perks to every member.
const FACTION_LEVEL_XP = 600;
export const FACTION_MAX_LEVEL = 10;

export function factionLevelFor(xp: number): number {
  if (!Number.isFinite(xp) || xp <= 0) return 1;
  return Math.min(FACTION_MAX_LEVEL, Math.floor(Math.sqrt(xp / FACTION_LEVEL_XP)) + 1);
}
export function factionXpForLevel(level: number): number {
  const l = Math.max(1, Math.min(FACTION_MAX_LEVEL, Math.floor(level)));
  return FACTION_LEVEL_XP * (l - 1) * (l - 1);
}
export function factionLevelProgress(xp: number): number {
  const l = factionLevelFor(xp);
  if (l >= FACTION_MAX_LEVEL) return 1;
  const cur = factionXpForLevel(l), next = factionXpForLevel(l + 1);
  return Math.max(0, Math.min(1, (xp - cur) / (next - cur)));
}

/** Automatic perks every member of a faction at `level` gets. Small on purpose. */
export function factionPerks(level: number): { armor: number; speedMult: number } {
  const l = Math.max(1, Math.min(FACTION_MAX_LEVEL, Math.floor(level)));
  return {
    armor: Math.min(3, Math.floor(l / 3)),                 // +1 armor at 3/6/9
    speedMult: 1 + Math.min(0.04, (l - 1) * 0.005),        // up to +4% speed
  };
}

/** Fail-closed faction-XP array off the wire/disk (one entry per faction id). */
export function sanitizeFactionXp(raw: unknown, factions: number): number[] {
  const out = new Array<number>(factions).fill(0);
  if (!Array.isArray(raw)) return out;
  for (let i = 0; i < factions; i++) {
    const v = raw[i];
    out[i] = Number.isFinite(v) ? Math.max(0, Math.floor(v as number)) : 0;
  }
  return out;
}
