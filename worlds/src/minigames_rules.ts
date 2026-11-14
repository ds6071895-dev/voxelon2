// Party Games: the rules with no world in them (source PartyRules, Category,
// PartyCatalog), shared by the host sheet, the protocol, the engine and the
// tests. Points table, ties, the double-points finale, the selection bag and
// player-count scaling are ported line for line.

/** Match lengths the host can pick (source PartyRules.LENGTHS). */
export const MG_LENGTHS = [3, 5, 8, 12, 20] as const;
export const MG_DEFAULT_LENGTH = 3;
/** Source PartyPlaylists limits. */
export const MG_MAX_PLAYLISTS = 36;
export const MG_PLAYLIST_GAMES = 18;
export const MG_NAME_MAX = 24;

export interface MgPlaylist { name: string; games: string[] }

/** The party leader's saved setup for the next match (source PartySettings). */
export interface MinigamesSetup {
  length: number;
  /** Games switched off for random mixes. */
  banned: string[];
  /** A chosen playlist; null = random mix. */
  playlist: MgPlaylist | null;
  revision: number;
}

export function defaultMinigamesSetup(): MinigamesSetup {
  return { length: MG_DEFAULT_LENGTH, banned: [], playlist: null, revision: 0 };
}

export function sanitizeMgName(v: unknown): string {
  return typeof v === 'string' ? v.replace(/[\u0000-\u001f]/g, '').trim().slice(0, MG_NAME_MAX) : '';
}

// ── Flow ──────────────────────────────────────────────────────────────────

export const MG = {
  MIN_PLAYERS: 2,
  MAX_PLAYERS: 10,
  BRIEF_TICKS: 160,
  COUNTDOWN_TICKS: 60,
  RESULTS_TICKS: 140,
  PODIUM_TICKS: 320,
  /** Points for 1st, 2nd, 3rd...; everyone below the table still gets the last entry. */
  POINTS: [10, 8, 6, 5, 4, 3, 2, 1] as const,
  MAX_SAME_CATEGORY_RUN: 2,
  RECENT_MEMORY: 18,
} as const;

export type MgCategory = 'SURVIVAL' | 'RACE' | 'SCORE' | 'BRAIN';
export const MG_CATEGORIES: Record<MgCategory, { label: string; color: string; award: string }> = {
  SURVIVAL: { label: 'Last One Standing', color: '#e5484d', award: 'Untouchable' },
  RACE: { label: 'Race', color: '#1fa7c9', award: 'Speed Demon' },
  SCORE: { label: 'Score Attack', color: '#d99a00', award: 'Sharpshooter' },
  BRAIN: { label: 'Brains & Skill', color: '#b45ad6', award: 'Big Brain' },
};

export interface MgGameInfo {
  id: string; name: string; category: MgCategory; seconds: number; award: string;
  /** Sky time in Minecraft ticks (6000 noon, 12000 sunset, 18000 midnight). */
  time: number;
  /** A fresh random course every time it's played. */
  rerolls: boolean;
  grace: number;
  rules: [string, string, string];
  /** Delivery batch; only shipped batches are offered. */
  batch: 'A' | 'B' | 'C' | 'D';
}

/** Every mini-game, in the source's menu order (PartyCatalog.all). */
export const MG_GAMES: readonly MgGameInfo[] = [
  { id: 'spleef', name: 'Glacier Spleef', category: 'SURVIVAL', seconds: 150, award: 'Ice Breaker', time: 6000, rerolls: false, grace: 30, batch: 'B', rules: ['Dig the snow out from under everyone else.', 'Broken snow can drop snowballs: they push and break floor.', "Three floors deep. Fall through the last one and you're out."] },
  { id: 'disco', name: 'Disco Dash', category: 'SURVIVAL', seconds: 150, award: 'Champion', time: 18000, rerolls: false, grace: 30, batch: 'B', rules: ["Stand on the colour that's called before the beat drops.", 'Every other tile vanishes, and the calls get faster.', 'Snowballs every third call. Last dancer standing wins.'] },
  { id: 'anvil', name: 'Anvil Panic', category: 'SURVIVAL', seconds: 120, award: 'Champion', time: 6000, rerolls: false, grace: 30, batch: 'B', rules: ['Red tiles and glowing ghost anvils show where they drop.', 'Keep moving: later waves come faster and aim for you.', "Get flattened and you're out. Last one standing wins."] },
  { id: 'tnt_run', name: 'TNT Run', category: 'SURVIVAL', seconds: 150, award: 'Champion', time: 13500, rerolls: false, grace: 30, batch: 'B', rules: ['The floor crumbles soon after you step on it. The rim falls.', 'Keep running! Jump again in mid-air to double-jump (x2).', "Fall through all three floors and you're out."] },
  { id: 'bow_spleef', name: 'Bow Spleef', category: 'SURVIVAL', seconds: 150, award: 'Sharpshooter', time: 13000, rerolls: false, grace: 30, batch: 'B', rules: ['Shoot the TNT floor: every arrow burns a hole.', "Aim near others' feet. The bow needs a moment to reload.", "Fall into the lava and you're out. Last one standing wins."] },
  { id: 'minecarts', name: 'Musical Carts', category: 'SURVIVAL', seconds: 180, award: 'Champion', time: 12500, rerolls: false, grace: 30, batch: 'B', rules: ['Walk around while the music plays. Shoving allowed!', 'Music stops: carts appear - right-click one to sit.', 'One cart too few. Left standing? Lose a life (duels: 3).'] },
  { id: 'lava_climb', name: 'Lava Climb', category: 'RACE', seconds: 150, award: 'Mountain Goat', time: 13000, rerolls: true, grace: 30, batch: 'C', rules: ["Climb the spire's parkour to ring the bell at the top.", "Lava rises from below and gets faster - don't look down!", "Caught by the lava? You're placed by how high you got."] },
  { id: 'boat_race', name: 'Boat Rush', category: 'RACE', seconds: 390, award: 'Speed Demon', time: 6000, rerolls: true, grace: 30, batch: 'D', rules: ['One lap of a brand-new ice circuit. Blue ice = boost!', 'Steer with W/A/S/D and brake into the tight corners.', 'First across the line wins; the rest get a minute or so.'] },
  { id: 'crumble', name: 'Crumbling Ruins', category: 'RACE', seconds: 210, award: 'Light Feet', time: 12300, rerolls: true, grace: 35, batch: 'C', rules: ['Race across the floating ruins to the shrine.', "Every stone crumbles a second after it's stepped on!", 'Three lanes per gap - fall and restart at your checkpoint.'] },
  { id: 'red_light', name: 'Red Light', category: 'RACE', seconds: 120, award: 'Statue', time: 6000, rerolls: false, grace: 30, batch: 'C', rules: ['Run to the finish while the doll looks away (GREEN).', 'On RED, freeze! Moving sends you back to your checkpoint.', 'Watch out: sometimes she only pretends to turn.'] },
  { id: 'maze', name: 'Hedge Maze', category: 'RACE', seconds: 150, award: 'Pathfinder', time: 6000, rerolls: true, grace: 30, batch: 'C', rules: ['A brand new maze every round. Find all 3 golden keys,', 'then reach the fountain in the middle to finish.', 'Hit mobs with your sword - they slow you down on contact!'] },
  { id: 'whack', name: 'Whack-a-Mole', category: 'SCORE', seconds: 75, award: 'Quick Hands', time: 6000, rerolls: false, grace: 30, batch: 'A', rules: ['Punch the moles that pop out of the holes!', 'Brown = 1 point, gold = 3. Bomb moles cost 3 and slow you.', 'They get quicker as the round goes on.'] },
  { id: 'sheep', name: 'Sheep Herd', category: 'SCORE', seconds: 120, award: 'Shepherd', time: 6000, rerolls: false, grace: 30, batch: 'D', rules: ['Right-click sheep to lead them (2 at a time) to YOUR pen.', 'Sheep in your pen score. Golden sheep are worth 3!', 'Steal from other pens. Punch rivals to make them let go.'] },
  { id: 'koth', name: 'King of the Hill', category: 'SCORE', seconds: 120, award: 'Royalty', time: 6000, rerolls: false, grace: 30, batch: 'D', rules: ['Hold the golden top: +1 point every second.', 'Crowded? The one in the middle scores. Knock them off!', 'Slime pads at the base launch you back up. Leader glows.'] },
  { id: 'treasure', name: 'Treasure Cove', category: 'SCORE', seconds: 120, award: 'Treasure Hunter', time: 6000, rerolls: false, grace: 30, batch: 'A', rules: ['Dig the beach for gems: emerald 1, gold 2, diamond 3.', 'The Hot/Cold reading tells you how close a gem is. Buried TNT costs 1!', 'Every quarter of the beach holds the same loot.'] },
  { id: 'memory', name: 'Memory Mosaic', category: 'BRAIN', seconds: 120, award: 'Photographic', time: 6000, rerolls: false, grace: 30, batch: 'A', rules: ['Memorise the picture on the wall before it vanishes.', 'Click the blocks on your floor pad to cycle colours.', 'Click the green block to submit when you match the image.'] },
  { id: 'brain', name: 'Brain Rush', category: 'BRAIN', seconds: 150, award: 'Big Brain', time: 14000, rerolls: false, grace: 30, batch: 'A', rules: ['Stand on the platform with the right answer.', 'Right = 1 point. First to settle on it: +1 bonus.', 'Wrong platforms drop into the honey pit. 10 questions.'] },
  { id: 'blink', name: 'Neon Blink', category: 'RACE', seconds: 210, award: 'On Beat', time: 18000, rerolls: true, grace: 35, batch: 'C', rules: ['Magenta and cyan platforms swap every 3 seconds.', "Glass means it's about to vanish - jump on the beat!", 'White platforms always stay. Reach the top tower first.'] },
  { id: 'lunar', name: 'Lunar Leap', category: 'RACE', seconds: 210, award: 'Astronaut', time: 18000, rerolls: true, grace: 35, batch: 'C', rules: ['Moon gravity! Every jump floats a long, long way.', 'Leap between asteroids to the moon base. Sprint-jump!', 'Drift off into space and you restart at your station.'] },
  { id: 'rooftop_tag', name: 'Rooftop Tag', category: 'SCORE', seconds: 150, award: 'Untouchable', time: 12000, rerolls: true, grace: 30, batch: 'D', rules: ['Glowing red caps are IT - punch someone to pass it on.', "Every second you're not it scores a point.", 'Leap the alleys, cross the bridges, climb the ladders!'] },
  { id: 'canopy', name: 'Coin Canopy', category: 'SCORE', seconds: 150, award: 'Treasure Monkey', time: 4000, rerolls: true, grace: 30, batch: 'D', rules: ['Grab the glowing coins all over the giant trees.', 'Higher coins are worth more - treetops pay the most!', 'Climb the ladders, cross the rope bridges. Most coins wins.'] },
];

/** Batches that have shipped. The host sheet and the selection bag only see these. */
export const MG_SHIPPED: ReadonlySet<string> = new Set(['A', 'B', 'C', 'D']);
export const mgPlayable = (id: string): boolean => { const g = mgGame(id); return !!g && MG_SHIPPED.has(g.batch); };
export const mgPool = (): MgGameInfo[] => MG_GAMES.filter((g) => MG_SHIPPED.has(g.batch));
export function mgGame(id: string): MgGameInfo | undefined { return MG_GAMES.find((g) => g.id === id); }
/** Index in the catalog (world seeds pack it). The podium is MG_GAMES.length. */
export const mgIndex = (id: string): number => MG_GAMES.findIndex((g) => g.id === id);
export const MG_PODIUM_INDEX = MG_GAMES.length;

// ── Points ────────────────────────────────────────────────────────────────

/** Plain table (8+ players). */
export function pointsForPlain(place: number, doubled: boolean): number {
  const base = MG.POINTS[Math.min(place, MG.POINTS.length - 1)];
  return doubled ? base * 2 : base;
}

/** Points in a match of `players`: the table stretched so last place still earns the bottom score. */
export function pointsFor(place: number, players: number, doubled: boolean): number {
  if (players >= MG.POINTS.length) return pointsForPlain(place, doubled);
  const last = Math.max(1, players - 1);
  // Java Math.round: floor(x + .5).
  const index = Math.floor(Math.min(place, last) * (MG.POINTS.length - 1) / last + .5);
  const base = MG.POINTS[index];
  return doubled ? base * 2 : base;
}

/** Placement groups (best first; a group is a tie) to points. A tie shares the higher place. */
export function award<T>(groups: T[][], doubled: boolean): Map<T, number> {
  const points = new Map<T, number>();
  let players = 0;
  for (const g of groups) players += g.length;
  let place = 0;
  for (const g of groups) {
    if (!g.length) continue;
    for (const m of g) if (!points.has(m)) points.set(m, pointsFor(place, players, doubled));
    place += g.length;
  }
  return points;
}

/** Sort by score (highest first) into tie groups; `tieBreak` orders equal scores (lower first) or null to tie. */
export function rankByScore<T>(members: Iterable<T>, score: (m: T) => number, tieBreak: ((m: T) => number) | null): T[][] {
  const sorted = [...members];
  sorted.sort((a, b) => {
    const s = score(b) - score(a);
    if (s !== 0 || !tieBreak) return Math.sign(s);
    return Math.sign(tieBreak(a) - tieBreak(b));
  });
  const groups: T[][] = [];
  let prev: T | undefined;
  let first = true;
  for (const m of sorted) {
    const tied = !first && score(prev as T) === score(m) && (!tieBreak || tieBreak(prev as T) === tieBreak(m));
    if (!tied) groups.push([]);
    groups[groups.length - 1].push(m);
    prev = m; first = false;
  }
  return groups;
}

// ── Selection bag ─────────────────────────────────────────────────────────

export interface MgEntry { id: string; category: MgCategory }

export function fits(picked: MgEntry[], next: MgEntry): boolean {
  if (!picked.length) return true;
  const last = picked[picked.length - 1];
  if (last.category === 'SURVIVAL' && next.category === 'SURVIVAL') return false;
  let run = 0;
  for (let i = picked.length - 1; i >= 0 && picked[i].category === next.category; i--) run++;
  return run < MG.MAX_SAME_CATEGORY_RUN;
}

/**
 * Picks `count` distinct games (fewer only if the pool is smaller). Recently
 * played games go last (oldest first); no more than 2 of a category in a row,
 * and two Survival games never follow each other, whenever the pool allows.
 */
export function pick(pool: MgEntry[], count: number, recent: string[], banned: ReadonlySet<string>, rng: () => number): MgEntry[] {
  const fresh: MgEntry[] = [], stale: MgEntry[] = [];
  for (const e of pool) {
    if (banned.has(e.id)) continue;
    (recent.includes(e.id) ? stale : fresh).push(e);
  }
  for (let i = fresh.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [fresh[i], fresh[j]] = [fresh[j], fresh[i]]; }
  stale.sort((a, b) => recent.indexOf(a.id) - recent.indexOf(b.id));
  const candidates = [...fresh, ...stale];
  const target = Math.min(count, candidates.length);
  const picked: MgEntry[] = [];
  while (picked.length < target) {
    const choice = candidates.find((c) => fits(picked, c)) ?? candidates[0];
    candidates.splice(candidates.indexOf(choice), 1);
    picked.push(choice);
  }
  return picked;
}

/** Remembers what a match played, newest last, trimmed to RECENT_MEMORY. */
export function remember(recent: string[], played: MgEntry[]): void {
  for (const e of played) {
    const i = recent.indexOf(e.id);
    if (i >= 0) recent.splice(i, 1);
    recent.push(e.id);
  }
  while (recent.length > MG.RECENT_MEMORY) recent.shift();
}

// ── Scaling ───────────────────────────────────────────────────────────────

/** Linear tuning between the 2-player and the 10-player value. */
export function scale(players: number, at2: number, at10: number): number {
  const c = Math.max(MG.MIN_PLAYERS, Math.min(MG.MAX_PLAYERS, players));
  return at2 + (at10 - at2) * (c - MG.MIN_PLAYERS) / (MG.MAX_PLAYERS - MG.MIN_PLAYERS);
}
export function scaleInt(players: number, at2: number, at10: number): number {
  return Math.floor(scale(players, at2, at10) + .5);
}

export function nextLength(current: number, step: number): number {
  let index = 0;
  MG_LENGTHS.forEach((l, i) => { if (l === current) index = i; });
  const n = MG_LENGTHS.length;
  return MG_LENGTHS[((index + step) % n + n) % n];
}

/** "about N min" for a random mix of `length` games (source PartyMenu). */
export const mixMinutes = (length: number): number => Math.round(length * 5 / 2);
/** Playlist estimate: Σ(seconds·¾ + 20), in minutes. */
export function playlistMinutes(games: string[]): number {
  let s = 0;
  for (const id of games) { const g = mgGame(id); if (g) s += g.seconds * .75 + 20; }
  return Math.max(1, Math.round(s / 60));
}

// ── Formatting (source Minigame.fmt/clock/ordinal) ────────────────────────

export function fmt(v: number): string { return v === Math.round(v) ? String(v) : v.toFixed(1); }
export function clock(ticks: number): string {
  const tenths = Math.floor(ticks / 2), seconds = Math.floor(tenths / 10);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}.${tenths % 10}`;
}
export function ordinal(n: number): string {
  const m = n % 100;
  const suffix = m >= 11 && m <= 13 ? 'th' : n % 10 === 1 ? 'st' : n % 10 === 2 ? 'nd' : n % 10 === 3 ? 'rd' : 'th';
  return `${n}${suffix}`;
}
