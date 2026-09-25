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
  'Copper', 'Iron', 'Gold', 'Emerald', 'Diamond', 'Obsidian', 'Voxelon',
] as const;
export type DuelRankName = typeof DUEL_RANK_NAMES[number];
export type DuelDivisionName = 'III' | 'II' | 'I';

export const DUEL_FLAIRS = [
  'Scrapper', 'Ironclad', 'Goldbreaker', 'Emerald Blade',
  'Diamond Sentinel', 'Obsidian Warlord', 'Voxelon Mythic',
] as const;
export type DuelFlair = typeof DUEL_FLAIRS[number];

/** Cosmetics from the retired Bronze..Grandmaster ladder map onto the closest
 * seat on the new one so nobody silently loses the title they earned. */
const LEGACY_FLAIR_ALIASES: Record<string, DuelFlair> = {
  'block rookie': 'Scrapper', 'arena smith': 'Ironclad', 'golden gunner': 'Goldbreaker',
  'prism breaker': 'Emerald Blade', 'diamond duelist': 'Diamond Sentinel',
  'arena champion': 'Obsidian Warlord', 'voxel grandmaster': 'Voxelon Mythic',
};

/** Every named tier owns a full look: a core colour, the accent it gradients
 * into, the glow used for auras/particles, an emblem silhouette, and a motto.
 * The client never invents Duels colours — it reads them from here, so the
 * lobby, the ladder, the match HUD and the result reveal always agree. */
export interface DuelTierTheme {
  name: DuelRankName;
  /** Primary rank colour (text, emblem blocks, progress fill). */
  color: string;
  /** Secondary colour; every rank gradient runs color -> accent. */
  accent: string;
  /** Deep shade used behind the tier on dark surfaces. */
  shade: string;
  /** Tier weight 3..9. Drives how hard the emblem's aura burns, so the mark
   * gets louder as you climb even when two sigils have the same block count. */
  facets: number;
  /** Emblem silhouette drawn on the ladder and the reveal. */
  emblem: DuelEmblem;
  /** The sigil itself: a 5x5 voxel mask, rows top to bottom, '#' lit and '.'
   * dark. Every surface that draws a rank — the Arena emblem and the reveal —
   * builds it from THIS string, so a tier can never wear two different marks.
   * See DUEL_SIGILS. */
  sigil: string;
  motto: string;
  flair: DuelFlair;
}

export type DuelEmblem = 'chip' | 'shield' | 'crest' | 'blade' | 'star' | 'spire' | 'crown';

export const DUEL_SIGIL_SIZE = 5;

/** Seven marks on one 5x5 voxel grid. They are silhouettes, not density ramps:
 * an ingot, a shield, a winged crest, a blade, a starburst, a spire, a crown —
 * each readable at 32px, all built from the same square block. */
export const DUEL_SIGILS: Record<DuelEmblem, string> = {
  chip:   '.....' + '.###.' + '.###.' + '.###.' + '.....',
  shield: '.....' + '#####' + '#####' + '.###.' + '..#..',
  crest:  '#...#' + '##.##' + '#####' + '.###.' + '..#..',
  blade:  '..#..' + '.###.' + '.###.' + '#####' + '..#..',
  star:   '#.#.#' + '.###.' + '#####' + '.###.' + '#.#.#',
  spire:  '..#..' + '.###.' + '.###.' + '#####' + '#####',
  crown:  '#.#.#' + '#####' + '#####' + '#####' + '.###.',
};

export const DUEL_TIER_THEMES: readonly DuelTierTheme[] = [
  { name: 'Copper', color: '#e08a4a', accent: '#ffcf9a', shade: '#3a2113',
    facets: 3, emblem: 'chip', sigil: DUEL_SIGILS.chip, motto: 'Everyone starts by swinging first.', flair: 'Scrapper' },
  { name: 'Iron', color: '#a8b6c4', accent: '#e8f1f8', shade: '#1e2733',
    facets: 4, emblem: 'shield', sigil: DUEL_SIGILS.shield, motto: 'You stopped panicking. Now you aim.', flair: 'Ironclad' },
  { name: 'Gold', color: '#f2b62c', accent: '#ffe9a0', shade: '#3a2c07',
    facets: 5, emblem: 'crest', sigil: DUEL_SIGILS.crest, motto: 'Cover, angle, burst. In that order.', flair: 'Goldbreaker' },
  { name: 'Emerald', color: '#2fd08a', accent: '#a8ffd8', shade: '#0c2f21',
    facets: 6, emblem: 'blade', sigil: DUEL_SIGILS.blade, motto: 'You take the high ground before they do.', flair: 'Emerald Blade' },
  { name: 'Diamond', color: '#43c2f5', accent: '#c4efff', shade: '#0b2836',
    facets: 7, emblem: 'star', sigil: DUEL_SIGILS.star, motto: 'Reading the arena, not just the crosshair.', flair: 'Diamond Sentinel' },
  { name: 'Obsidian', color: '#a273f7', accent: '#e2ccff', shade: '#1e1236',
    facets: 8, emblem: 'spire', sigil: DUEL_SIGILS.spire, motto: 'The rest of the lobby plays around you.', flair: 'Obsidian Warlord' },
  { name: 'Voxelon', color: '#ff4f6e', accent: '#ffd0d9', shade: '#3a0b17',
    facets: 9, emblem: 'crown', sigil: DUEL_SIGILS.crown, motto: 'There is no tier above this one.', flair: 'Voxelon Mythic' },
];

export function duelTierTheme(namedIndex: number): DuelTierTheme {
  return DUEL_TIER_THEMES[Math.max(0, Math.min(DUEL_TIER_THEMES.length - 1, namedIndex))];
}

export interface DuelRank {
  index: number;
  namedIndex: number;
  name: DuelRankName;
  division: DuelDivisionName;
  label: string;
  min: number;
  color: string;
  accent: string;
  shade: string;
  facets: number;
  emblem: DuelEmblem;
  sigil: string;
  motto: string;
  flair: DuelFlair;
}

const DIVISION_NAMES: DuelDivisionName[] = ['III', 'II', 'I'];
export const DUEL_DIVISIONS: readonly DuelRank[] = DUEL_RANK_NAMES.flatMap((name, namedIndex) =>
  DIVISION_NAMES.map((division, divisionIndex) => {
    const index = namedIndex * 3 + divisionIndex;
    const theme = DUEL_TIER_THEMES[namedIndex];
    return {
      index, namedIndex, name, division, label: `${name} ${division}`,
      min: index * DUEL_RP_PER_DIVISION, color: theme.color, accent: theme.accent,
      shade: theme.shade, facets: theme.facets, emblem: theme.emblem,
      sigil: theme.sigil, motto: theme.motto, flair: theme.flair,
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
  /** A practice bot rated at its human opponent's own RP. It never takes the
   * repeat-opponent discount (it is a fresh, level-matched opponent every
   * time) and never enters anyone's opponent history. */
  bot?: boolean;
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
  const requested = typeof value.equippedFlair === 'string'
    ? LEGACY_FLAIR_ALIASES[value.equippedFlair.trim().toLowerCase()] ?? value.equippedFlair
    : value.equippedFlair;
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
      if (opponent.bot) continue;
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
    for (let j = 0; j < players.length; j++) if (j !== i && !players[j].bot) {
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

export type DuelRevealPhase = 'impact' | 'previous' | 'counting' | 'ascend' | 'settled';

/** Choreography beats, in ms from the moment the result card mounts. */
export const DUEL_REVEAL_IMPACT_MS = 380;
export const DUEL_REVEAL_HOLD_MS = 1_080;
export const DUEL_REVEAL_COUNT_MS = 2_450;
export const DUEL_REVEAL_ASCEND_MS = 3_300;

export interface DuelRevealState {
  phase: DuelRevealPhase;
  displayedRp: number;
  /** 0..1 through the RP count-up ramp. */
  progress: number;
  /** 0..1 fill of the division track at `displayedRp`; wraps on promotion. */
  barProgress: number;
  /** The final rank, colour and emblem are on screen from here on. */
  revealed: boolean;
  /** The whole choreography has finished. */
  settled: boolean;
  particles: 'rise' | 'fall' | 'none';
  denseParticles: boolean;
  /** 0..1 impact shake for the card. */
  shake: number;
}

function revealAt(phase: DuelRevealPhase, rp: number, over: Partial<DuelRevealState> = {}): DuelRevealState {
  return {
    phase, displayedRp: rp, progress: 0, barProgress: duelRankProgress(rp).progress,
    revealed: phase === 'ascend' || phase === 'settled', settled: phase === 'settled',
    particles: 'none', denseParticles: false, shake: 0, ...over,
  };
}

/** Deterministic result choreography shared by the UI and the smoke tests:
 * a landing impact, a beat on the old number, an RP count-up with block
 * particles, then the rank ascension itself. */
export function duelRevealState(change: DuelProgressChange, elapsedMs: number, options: {
  skipped?: boolean; reducedMotion?: boolean; photosensitivitySafe?: boolean;
} = {}): DuelRevealState {
  if (options.skipped || options.reducedMotion || elapsedMs >= DUEL_REVEAL_ASCEND_MS) {
    return revealAt('settled', change.afterRp, { progress: 1 });
  }
  if (elapsedMs < DUEL_REVEAL_IMPACT_MS) {
    return revealAt('impact', change.beforeRp, {
      shake: 1 - elapsedMs / DUEL_REVEAL_IMPACT_MS,
    });
  }
  if (elapsedMs < DUEL_REVEAL_HOLD_MS) return revealAt('previous', change.beforeRp);
  if (elapsedMs < DUEL_REVEAL_COUNT_MS) {
    const span = DUEL_REVEAL_COUNT_MS - DUEL_REVEAL_HOLD_MS;
    const progress = Math.max(0, Math.min(1, (elapsedMs - DUEL_REVEAL_HOLD_MS) / span));
    // Ease out so the last few RP tick over slowly and the number lands.
    const eased = 1 - Math.pow(1 - progress, 2);
    return revealAt('counting', Math.round(change.beforeRp + change.change * eased), {
      progress, particles: change.change >= 0 ? 'rise' : 'fall',
      denseParticles: !options.photosensitivitySafe,
    });
  }
  const into = (elapsedMs - DUEL_REVEAL_COUNT_MS) / (DUEL_REVEAL_ASCEND_MS - DUEL_REVEAL_COUNT_MS);
  return revealAt('ascend', change.afterRp, {
    progress: 1, shake: Math.max(0, 1 - into * 3.2),
  });
}
