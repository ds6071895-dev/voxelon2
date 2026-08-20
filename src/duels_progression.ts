// Pure, server-authoritative Duels progression. This module intentionally has
// no DOM, transport, or persistence dependencies so account migration, match
// settlement, and the client reveal all share one definition of the ladder.

export const DUEL_PROGRESS_VERSION = 1;
export const DUEL_STARTING_RP = 450;
export const DUEL_PLACEMENT_MATCHES = 5;
export const DUEL_RP_PER_DIVISION = 100;
export const DUEL_REPEAT_WINDOW_MS = 24 * 60 * 60 * 1000;
export const DUEL_MAX_HISTORY_OPPONENTS = 64;
export const DUEL_MAX_HISTORY_TIMESTAMPS = 8;

export const DUEL_RANK_NAMES = [
  'Bronze', 'Silver', 'Gold', 'Platinum', 'Diamond', 'Champion', 'Grandmaster',
] as const;
export type DuelRankName = typeof DUEL_RANK_NAMES[number];
export type DuelDivisionName = 'III' | 'II' | 'I';

export const DUEL_FLAIRS = [
  'Block Rookie', 'Arena Smith', 'Golden Gunner', 'Prism Breaker',
  'Diamond Duelist', 'Arena Champion', 'Voxel Grandmaster',
] as const;
export type DuelFlair = typeof DUEL_FLAIRS[number];

const RANK_COLORS: Record<DuelRankName, string> = {
  Bronze: '#b87542', Silver: '#8c9eac', Gold: '#d99a18', Platinum: '#24a99b',
  Diamond: '#308fd8', Champion: '#8d55d4', Grandmaster: '#d84254',
};

export interface DuelRank {
  index: number;
  namedIndex: number;
  name: DuelRankName;
  division: DuelDivisionName;
  label: string;
  min: number;
  color: string;
  flair: DuelFlair;
}

const DIVISION_NAMES: DuelDivisionName[] = ['III', 'II', 'I'];
export const DUEL_DIVISIONS: readonly DuelRank[] = DUEL_RANK_NAMES.flatMap((name, namedIndex) =>
  DIVISION_NAMES.map((division, divisionIndex) => {
    const index = namedIndex * 3 + divisionIndex;
    return {
      index, namedIndex, name, division, label: `${name} ${division}`,
      min: index * DUEL_RP_PER_DIVISION, color: RANK_COLORS[name],
      flair: DUEL_FLAIRS[namedIndex],
    };
  }));

export interface DuelPublicProfile {
  rp: number;
  rank: DuelRank;
  wins: number;
  losses: number;
  placementsRemaining: number;
  streak: number;
  peakRp: number;
  equippedFlair: DuelFlair;
}

export interface DuelProgressState extends DuelPublicProfile {
  version: typeof DUEL_PROGRESS_VERSION;
  demotionShield: boolean;
  /** Canonical opponent name -> recent rated-match wall-clock timestamps. */
  opponentHistory: Record<string, number[]>;
}

export interface DuelProgressChange {
  id: number;
  username: string;
  beforeRp: number;
  afterRp: number;
  change: number;
  baseSkillDelta: number;
  streakBonus: number;
  repeatMultiplier: number;
  shieldUsed: boolean;
  protectedFloor: number | null;
  oldRank: DuelRank;
  newRank: DuelRank;
  promotion: boolean;
  namedRankPromotion: boolean;
  demotion: boolean;
  placementReveal: boolean;
  placementsRemaining: number;
  streak: number;
  newlyUnlockedFlair: DuelFlair | null;
  profile: DuelPublicProfile;
}

export interface DuelSettlementPlayer {
  id: number;
  username: string;
  state: DuelProgressState;
}

export interface DuelSettlement {
  changes: DuelProgressChange[];
  states: { id: number; username: string; state: DuelProgressState }[];
}

export function sanitizeDuelRp(value: unknown, fallback = DUEL_STARTING_RP): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(0, Math.min(Number.MAX_SAFE_INTEGER, Math.round(value as number)));
}

function count(value: unknown, max = Number.MAX_SAFE_INTEGER): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(max, Math.floor(value as number))) : 0;
}

export function duelRankAt(rp: number): DuelRank {
  const safe = sanitizeDuelRp(rp);
  const index = Math.min(DUEL_DIVISIONS.length - 1, Math.floor(safe / DUEL_RP_PER_DIVISION));
  return DUEL_DIVISIONS[index];
}

export function duelRankProgress(rp: number): {
  rank: DuelRank; next: DuelRank | null; progress: number; rpIntoDivision: number;
} {
  const safe = sanitizeDuelRp(rp), rank = duelRankAt(safe);
  const next = DUEL_DIVISIONS[rank.index + 1] ?? null;
  const rpIntoDivision = rank.index === DUEL_DIVISIONS.length - 1
    ? (safe - rank.min) % DUEL_RP_PER_DIVISION
    : safe - rank.min;
  return { rank, next, rpIntoDivision, progress: rpIntoDivision / DUEL_RP_PER_DIVISION };
}

export function duelProfileOf(state: DuelProgressState): DuelPublicProfile {
  return {
    rp: state.rp, rank: duelRankAt(state.rp), wins: state.wins, losses: state.losses,
    placementsRemaining: state.placementsRemaining, streak: state.streak,
    peakRp: state.peakRp, equippedFlair: state.equippedFlair,
  };
}

export function unlockedDuelFlairs(profile: Pick<DuelPublicProfile, 'peakRp' | 'placementsRemaining'>): DuelFlair[] {
  if (profile.placementsRemaining > 0) return [DUEL_FLAIRS[0]];
  const peakNamed = duelRankAt(profile.peakRp).namedIndex;
  return DUEL_FLAIRS.slice(0, peakNamed + 1) as DuelFlair[];
}

export function canEquipDuelFlair(profile: DuelPublicProfile, flair: unknown): flair is DuelFlair {
  return typeof flair === 'string' && unlockedDuelFlairs(profile).includes(flair as DuelFlair);
}

function cleanHistory(raw: unknown, now = Date.now()): Record<string, number[]> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const cutoff = now - DUEL_REPEAT_WINDOW_MS;
  const entries: [string, number[]][] = [];
  for (const [rawName, rawTimes] of Object.entries(raw as Record<string, unknown>)) {
    const name = rawName.trim().toLowerCase().slice(0, 16);
    if (!name || !Array.isArray(rawTimes)) continue;
    const times = rawTimes.filter((v): v is number => typeof v === 'number' && Number.isFinite(v) && v >= cutoff && v <= now + 60_000)
      .map(Math.floor).sort((a, b) => a - b).slice(-DUEL_MAX_HISTORY_TIMESTAMPS);
    if (times.length) entries.push([name, times]);
  }
  entries.sort((a, b) => (b[1][b[1].length - 1] ?? 0) - (a[1][a[1].length - 1] ?? 0));
  return Object.fromEntries(entries.slice(0, DUEL_MAX_HISTORY_OPPONENTS));
}

export function newDuelProgress(): DuelProgressState {
  const rp = DUEL_STARTING_RP;
  return {
    version: DUEL_PROGRESS_VERSION, rp, rank: duelRankAt(rp), wins: 0, losses: 0,
    placementsRemaining: DUEL_PLACEMENT_MATCHES, streak: 0, peakRp: rp,
    equippedFlair: DUEL_FLAIRS[0], demotionShield: false, opponentHistory: {},
  };
}

export function sanitizeDuelProgress(raw: unknown, now = Date.now()): DuelProgressState {
  const fresh = newDuelProgress();
  if (!raw || typeof raw !== 'object') return fresh;
  const value = raw as Partial<DuelProgressState>;
  if (value.version !== DUEL_PROGRESS_VERSION) return fresh;
  const rp = sanitizeDuelRp(value.rp), placementsRemaining = count(value.placementsRemaining, DUEL_PLACEMENT_MATCHES);
  const peakRp = Math.max(rp, sanitizeDuelRp(value.peakRp, rp));
  const base: DuelProgressState = {
    version: DUEL_PROGRESS_VERSION, rp, rank: duelRankAt(rp), wins: count(value.wins),
    losses: count(value.losses), placementsRemaining, streak: count(value.streak), peakRp,
    equippedFlair: DUEL_FLAIRS[0], demotionShield: value.demotionShield === true,
    opponentHistory: cleanHistory(value.opponentHistory, now),
  };
  const requested = value.equippedFlair;
  base.equippedFlair = canEquipDuelFlair(duelProfileOf(base), requested) ? requested : DUEL_FLAIRS[0];
  return base;
}

const LEGACY_TIERS = [0, 900, 1100, 1300, 1500, 1750, 2000] as const;

/** One-way migration from the retired 0..4000 Elo ladder. */
export function migrateLegacyDuelProgress(legacyElo: unknown, wins?: unknown, losses?: unknown): DuelProgressState {
  const elo = Number.isFinite(legacyElo) ? Math.max(0, Math.min(4000, legacyElo as number)) : 1000;
  let named = LEGACY_TIERS.length - 1;
  while (named > 0 && elo < LEGACY_TIERS[named]) named--;
  let rp: number;
  if (named === LEGACY_TIERS.length - 1) {
    rp = 1800 + Math.round((elo - 2000) / 2000 * 300);
  } else {
    const low = LEGACY_TIERS[named], high = LEGACY_TIERS[named + 1];
    const offset = Math.min(299, Math.floor((elo - low) / Math.max(1, high - low) * 300));
    rp = named * 300 + offset;
  }
  const safeRp = sanitizeDuelRp(rp);
  return {
    version: DUEL_PROGRESS_VERSION, rp: safeRp, rank: duelRankAt(safeRp), wins: count(wins),
    losses: count(losses), placementsRemaining: 0, streak: 0, peakRp: safeRp,
    equippedFlair: DUEL_FLAIRS[duelRankAt(safeRp).namedIndex], demotionShield: false,
    opponentHistory: {},
  };
}

export function loadDuelProgress(raw: unknown, legacyElo?: unknown, wins?: unknown, losses?: unknown, now = Date.now()): DuelProgressState {
  if (raw && typeof raw === 'object' && (raw as { version?: unknown }).version === DUEL_PROGRESS_VERSION) {
    return sanitizeDuelProgress(raw, now);
  }
  return legacyElo !== undefined
    ? migrateLegacyDuelProgress(legacyElo, wins, losses)
    : newDuelProgress();
}

export function duelRepeatMultiplier(previousEncounters: number): number {
  if (previousEncounters < 2) return 1;
  if (previousEncounters === 2) return 0.5;
  if (previousEncounters === 3) return 0.25;
  return 0.1;
}

function streakBonus(streak: number): number {
  if (streak < 3) return 0;
  return Math.min(8, (streak - 2) * 2);
}

function addEncounter(history: Record<string, number[]>, opponent: string, now: number): void {
  history[opponent] = [...(history[opponent] ?? []), now].slice(-DUEL_MAX_HISTORY_TIMESTAMPS);
}

/** Settle a rated final placement. Input order is authoritative placement. */
export function settleDuelProgress(players: readonly DuelSettlementPlayer[], now: number): DuelSettlement {
  if (players.length < 2) return { changes: [], states: [] };
  const before = players.map((p) => sanitizeDuelProgress(p.state, now));
  const cutoff = now - DUEL_REPEAT_WINDOW_MS;
  const states = before.map((state) => sanitizeDuelProgress(state, now));
  const changes: DuelProgressChange[] = [];

  for (let i = 0; i < players.length; i++) {
    const player = players[i], old = before[i], next = states[i];
    let performance = 0;
    const repeatFactors: number[] = [];
    for (let j = 0; j < players.length; j++) {
      if (i === j) continue;
      const opponent = players[j];
      const actual = i < j ? 1 : i > j ? 0 : 0.5;
      const expected = 1 / (1 + Math.pow(10, (before[j].rp - old.rp) / 400));
      performance += actual - expected;
      const key = opponent.username.toLowerCase();
      const prior = (old.opponentHistory[key] ?? []).filter((stamp) => stamp >= cutoff).length;
      repeatFactors.push(duelRepeatMultiplier(prior));
    }
    const k = old.placementsRemaining > 0 ? 72 : 48;
    const baseSkillDelta = Math.round(k * performance / Math.max(1, players.length - 1));
    const won = i === 0;
    const nextStreak = won ? old.streak + 1 : 0;
    const bonus = won ? streakBonus(nextStreak) : 0;
    const repeatMultiplier = repeatFactors.length ? Math.min(...repeatFactors) : 1;
    let afterRp = sanitizeDuelRp(old.rp + Math.round((baseSkillDelta + bonus) * repeatMultiplier), old.rp);
    const oldRank = duelRankAt(old.rp);
    let shieldUsed = false, protectedFloor: number | null = null;
    if (afterRp < oldRank.namedIndex * 300 && old.demotionShield) {
      protectedFloor = oldRank.namedIndex * 300;
      afterRp = protectedFloor;
      shieldUsed = true;
    }
    const newRank = duelRankAt(afterRp);
    const promotion = newRank.index > oldRank.index;
    const namedRankPromotion = newRank.namedIndex > oldRank.namedIndex;
    const placementReveal = old.placementsRemaining === 1;
    next.rp = afterRp;
    next.rank = newRank;
    next.wins = old.wins + (won ? 1 : 0);
    next.losses = old.losses + (won ? 0 : 1);
    next.placementsRemaining = Math.max(0, old.placementsRemaining - 1);
    next.streak = nextStreak;
    next.peakRp = Math.max(old.peakRp, afterRp);
    next.demotionShield = namedRankPromotion ? true : shieldUsed ? false : old.demotionShield;
    next.opponentHistory = cleanHistory(old.opponentHistory, now);
    for (let j = 0; j < players.length; j++) if (j !== i) {
      addEncounter(next.opponentHistory, players[j].username.toLowerCase(), now);
    }
    next.opponentHistory = cleanHistory(next.opponentHistory, now);
    const unlockedBefore = unlockedDuelFlairs(duelProfileOf(old));
    const unlockedAfter = unlockedDuelFlairs(duelProfileOf(next));
    const newlyUnlockedFlair = [...unlockedAfter].reverse().find((flair) => !unlockedBefore.includes(flair)) ?? null;
    if (!canEquipDuelFlair(duelProfileOf(next), next.equippedFlair)) next.equippedFlair = DUEL_FLAIRS[0];
    const profile = duelProfileOf(next);
    changes.push({
      id: player.id, username: player.username, beforeRp: old.rp, afterRp,
      change: afterRp - old.rp, baseSkillDelta, streakBonus: bonus, repeatMultiplier,
      shieldUsed, protectedFloor, oldRank, newRank, promotion, namedRankPromotion,
      demotion: newRank.index < oldRank.index, placementReveal,
      placementsRemaining: next.placementsRemaining, streak: nextStreak,
      newlyUnlockedFlair, profile,
    });
  }
  return { changes, states: players.map((p, i) => ({ id: p.id, username: p.username, state: states[i] })) };
}

export type DuelRevealPhase = 'impact' | 'previous' | 'counting' | 'settled';
export interface DuelRevealState {
  phase: DuelRevealPhase;
  displayedRp: number;
  progress: number;
  settled: boolean;
  particles: 'rise' | 'fall' | 'none';
  denseParticles: boolean;
}

/** Deterministic 0..3000ms result choreography used by UI and smoke tests. */
export function duelRevealState(change: DuelProgressChange, elapsedMs: number, options: {
  skipped?: boolean; reducedMotion?: boolean; photosensitivitySafe?: boolean;
} = {}): DuelRevealState {
  if (options.skipped || options.reducedMotion || elapsedMs >= 3000) {
    return { phase: 'settled', displayedRp: change.afterRp, progress: 1, settled: true,
      particles: 'none', denseParticles: false };
  }
  if (elapsedMs < 350) return { phase: 'impact', displayedRp: change.beforeRp,
    progress: 0, settled: false, particles: 'none', denseParticles: false };
  if (elapsedMs < 1050) return { phase: 'previous', displayedRp: change.beforeRp,
    progress: 0, settled: false, particles: 'none', denseParticles: false };
  if (elapsedMs < 2200) {
    const progress = Math.max(0, Math.min(1, (elapsedMs - 1050) / 1150));
    return { phase: 'counting', displayedRp: Math.round(change.beforeRp + change.change * progress),
      progress, settled: false, particles: change.change >= 0 ? 'rise' : 'fall',
      denseParticles: !options.photosensitivitySafe };
  }
  return { phase: 'settled', displayedRp: change.afterRp, progress: 1, settled: true,
    particles: 'none', denseParticles: false };
}
