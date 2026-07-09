// GETTING STARTED guide — a short early-game checklist so a fresh spawn always
// knows what to do next (players told us the first hour felt aimless). PURE +
// transport-agnostic like hearts.ts/progress.ts: the step list and state
// helpers live here; detection (inventory scans, vault discovery) and the HUD
// panel live in main.ts. State persists per-account in localStorage.

export interface GuideStep {
  id: string;
  icon: string;
  /** One short line shown in the HUD checklist. */
  text: string;
}

export const GUIDE_STEPS: GuideStep[] = [
  { id: 'wood', icon: '🌲', text: 'Punch a tree — collect a log' },
  { id: 'planks', icon: '🪵', text: 'Craft planks from your log (E)' },
  { id: 'table', icon: '🛠', text: 'Craft a Crafting Table' },
  { id: 'pickaxe', icon: '⛏', text: 'Craft a pickaxe (planks + sticks)' },
  { id: 'stone', icon: '🪨', text: 'Mine some stone' },
  { id: 'gun', icon: '🔫', text: 'Get a gun (iron + redstone → pistol)' },
  { id: 'bullets', icon: '🔸', text: 'Craft bullets (1 iron + 1 redstone = 8)' },
  { id: 'armor', icon: '🛡', text: 'Craft armor (wood or stone to start)' },
  { id: 'vault', icon: '☠', text: 'Find a vault (check the map — M)' },
  { id: 'loot', icon: '💰', text: 'Slay the Vault Brute + loot its chest' },
];

/** Done-flags keyed by step id. Steps are STICKY: once true, always true. */
export type GuideState = Record<string, boolean>;

export function newGuideState(): GuideState {
  const s: GuideState = {};
  for (const step of GUIDE_STEPS) s[step.id] = false;
  return s;
}

/** Mark a step done. Returns true if this call newly completed it. */
export function markGuideStep(s: GuideState, id: string): boolean {
  if (!GUIDE_STEPS.some((st) => st.id === id) || s[id]) return false;
  s[id] = true;
  return true;
}

export function guideProgress(s: GuideState): { done: number; total: number } {
  let done = 0;
  for (const step of GUIDE_STEPS) if (s[step.id]) done++;
  return { done, total: GUIDE_STEPS.length };
}

export function guideComplete(s: GuideState): boolean {
  const p = guideProgress(s);
  return p.done >= p.total;
}

/** The first not-yet-done step (what the panel highlights), or null when done. */
export function nextGuideStep(s: GuideState): GuideStep | null {
  for (const step of GUIDE_STEPS) if (!s[step.id]) return step;
  return null;
}

/** Fail-closed sanitizer for a persisted guide blob: unknown keys are dropped,
 *  known steps default to not-done. */
export function sanitizeGuide(raw: unknown): GuideState {
  const s = newGuideState();
  if (!raw || typeof raw !== 'object') return s;
  const r = raw as Record<string, unknown>;
  for (const step of GUIDE_STEPS) s[step.id] = r[step.id] === true;
  return s;
}

/** 8-way compass glyph for a world-space offset (map/game: north = -z). */
export function compassGlyph(dx: number, dz: number): string {
  if (dx === 0 && dz === 0) return '·';
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  // atan2(x, -z): 0 = north, positive clockwise (east).
  const a = Math.atan2(dx, -dz);
  const idx = ((Math.round(a / (Math.PI / 4)) % 8) + 8) % 8;
  return dirs[idx];
}
