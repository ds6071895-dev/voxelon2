// Lucky Pillars: timings, layouts, twists and schedules, ported from the
// AutoBox plugin's PillarRules exactly (ticks are 1/20 s). Shared by the
// engine, the world generator, the client presenter and the tests.

export const LP = {
  TOP_Y: 100,
  PILLAR_DEPTH: 28,
  BOTTOM_Y: 72,
  /** Bouncy Floor: share of the fall height a slime bounce gives back, and the inward push (b/s). */
  SLIME_BOUNCE: .5,
  SLIME_PUSH: 10,
  CROWN_RISE: 3,
  MAX_BUILD_Y: 124,
  SWEEP_RADIUS: 56,
  COUNTDOWN_TICKS: 6 * 20,
  MAIN_TICKS: 5 * 60 * 20,
  DEATHMATCH_TICKS: 2 * 60 * 20,
  OVER_TICKS: 8 * 20,
  LOOT_INTERVAL: 3 * 20,
  FRENZY_INTERVAL: 30,
  DEATHMATCH_INTERVAL: 2 * 20,
  KILL_CREDIT_TICKS: 15 * 20,
  BORDER_MARGIN: 9,
  DEATHMATCH_PLATFORM_RADIUS: 3,
  MID_BORDER: 12,
  FINAL_BORDER: 3,
  MID_BORDER_SECONDS: 80,
  RECENT_TWIST_MEMORY: 4,
  LUCKY_STREAK_BOOST: 4.0,
  METEOR_INTERVAL: 3 * 20,
  LIGHTNING_INTERVAL: 7 * 20,
  SHUFFLE_INTERVAL: 40 * 20,
  SHUFFLE_WARNING: 3 * 20,
  VAMPIRE_LIFESTEAL: 0.4,
  VAMPIRE_KILL_HEAL: 12.0,
  KILL_HEAL: 4.0,
  /** Lucky Pillars uses the vanilla 1.9 attack cooldown (attack speed 4.0). */
  ATTACK_SPEED: 4.0,
  /** Ghost tricks (GhostTricks.java). */
  GHOST_FIRST_TICKS: 8 * 20,
  GHOST_COOLDOWN_TICKS: 25 * 20,
  GHOST_TARGET_SHIELD_TICKS: 20 * 20,
  GHOST_BOO_TICKS: 4 * 20,
  GHOST_CHEER_HP: 1,
} as const;

export type LpLayout = 'ring' | 'staggered' | 'spiral' | 'star';
export const LP_LAYOUTS: LpLayout[] = ['ring', 'staggered', 'spiral', 'star'];
export const LP_LAYOUT_LABEL: Record<LpLayout, string> = { ring: 'Ring', staggered: 'Staggered', spiral: 'Spiral Stairs', star: 'Star' };

export type LpTwist =
  | 'slime_floor' | 'rising_lava' | 'moon_gravity' | 'sugar_rush' | 'tnt_rain' | 'meteor_shower'
  | 'thunderstorm' | 'giants' | 'tiny_town' | 'loot_frenzy' | 'lucky_streak' | 'mirror_loot'
  | 'shuffle' | 'vampires' | 'bouncy_castle' | 'sky_gliders' | 'glass_cannon';

export const LP_TWISTS: { id: LpTwist; label: string; description: string; icon: string }[] = [
  { id: 'slime_floor', label: 'Bouncy Floor', description: "A slime floor catches you. Falling is safe; fighting isn't.", icon: 'slime_block' },
  { id: 'rising_lava', label: 'Rising Lava', description: 'Lava climbs toward the pillar tops. Build up or burn.', icon: 'lava_bucket' },
  { id: 'moon_gravity', label: 'Moon Gravity', description: 'Low gravity and soft landings.', icon: 'end_stone' },
  { id: 'sugar_rush', label: 'Sugar Rush', description: 'Everyone has Speed II and Haste II.', icon: 'sugar' },
  { id: 'tnt_rain', label: 'TNT Rain', description: 'Lit TNT keeps dropping out of the sky.', icon: 'tnt' },
  { id: 'meteor_shower', label: 'Meteor Shower', description: 'Fireballs rain down on the arena.', icon: 'fire_charge' },
  { id: 'thunderstorm', label: 'Thunderstorm', description: 'Lightning strikes near random players.', icon: 'lightning_rod' },
  { id: 'giants', label: 'Giants', description: 'Everyone is huge, has 5 extra hearts and longer reach.', icon: 'iron_block' },
  { id: 'tiny_town', label: 'Tiny Town', description: 'Everyone is tiny and hard to hit.', icon: 'feather' },
  { id: 'loot_frenzy', label: 'Loot Frenzy', description: 'Items every 1.5 seconds instead of 3.', icon: 'chest' },
  { id: 'lucky_streak', label: 'Lucky Streak', description: 'Rare, epic and legendary loot is far more common.', icon: 'gold_ingot' },
  { id: 'mirror_loot', label: 'Mirror Loot', description: 'Everyone gets the exact same item at the same time.', icon: 'glass' },
  { id: 'shuffle', label: 'Shuffle', description: 'Every 40 seconds everyone swaps places.', icon: 'ender_pearl' },
  { id: 'vampires', label: 'Vampires', description: 'No natural healing. Melee hits heal you; kills heal a lot.', icon: 'apple' },
  { id: 'bouncy_castle', label: 'Bouncy Castle', description: 'Huge knockback and no fall damage.', icon: 'slime_block' },
  { id: 'sky_gliders', label: 'Sky Gliders', description: 'Everyone starts with an elytra and rockets.', icon: 'elytra' },
  { id: 'glass_cannon', label: 'Glass Cannon', description: 'Everyone has only 5 hearts.', icon: 'glass_pane' },
];
export function lpTwist(id: LpTwist) { return LP_TWISTS.find((t) => t.id === id)!; }

export interface LpPillar { x: number; z: number; topY: number }

/** Java Math.round: half up. */
const jround = (v: number) => Math.floor(v + .5);

/** Pillars sit about twenty blocks apart along the ring: 2 players → 15, 6 → 19, 10 → 32. */
export function ringRadius(players: number): number {
  return Math.max(15, jround(20 * players / (2 * Math.PI)));
}
export function outerRadius(layout: LpLayout, players: number): number {
  return ringRadius(players) + (layout === 'star' && players >= 4 ? 5 : 0);
}
export function borderSize(layout: LpLayout, players: number): number {
  return 2 * (outerRadius(layout, players) + LP.BORDER_MARGIN);
}
export function lpPillars(layout: LpLayout, players: number, angleOffset: number): LpPillar[] {
  const out: LpPillar[] = [];
  const radius = ringRadius(players);
  for (let i = 0; i < players; i++) {
    const angle = angleOffset + Math.PI * 2 * i / players;
    const r = layout === 'star' && players >= 4 && i % 2 === 1 ? radius + 5 : radius;
    const top = layout === 'staggered' ? LP.TOP_Y - (i % 2 === 1 ? 4 : 0)
      : layout === 'spiral' ? LP.TOP_Y - jround(6 * i / Math.max(1, players - 1))
        : LP.TOP_Y;
    out.push({ x: jround(Math.cos(angle) * r), z: jround(Math.sin(angle) * r), topY: top });
  }
  return out;
}

export function pickTwist(rng: () => number, recent: LpTwist[]): LpTwist {
  let options = LP_TWISTS.map((t) => t.id).filter((t) => !recent.includes(t));
  if (!options.length) options = LP_TWISTS.map((t) => t.id);
  return options[Math.floor(rng() * options.length)];
}
export function pickLayout(rng: () => number, players: number, last: LpLayout | null): LpLayout {
  const options = LP_LAYOUTS.filter((l) => l !== last && (l !== 'star' || players >= 4));
  return options[Math.floor(rng() * options.length)];
}

/** Ticks between items for one player. Standing on the crown halves it. */
export function lootInterval(twist: LpTwist, deathmatch: boolean, onCrown: boolean): number {
  let interval: number = twist === 'loot_frenzy' ? LP.FRENZY_INTERVAL : LP.LOOT_INTERVAL;
  if (deathmatch) interval = Math.min(interval, LP.DEATHMATCH_INTERVAL);
  return onCrown ? Math.max(15, Math.trunc(interval / 2)) : interval;
}
/** Rarer loot shows up more as the match goes on: 1.0 at the start, 1.8 by the deathmatch. */
export function lootBoost(twist: LpTwist, mainElapsed: number, deathmatch: boolean): number {
  const heat = deathmatch ? 1.8 : 1.0 + 0.8 * Math.min(1, Math.max(0, mainElapsed) / LP.MAIN_TICKS);
  return twist === 'lucky_streak' ? heat * LP.LUCKY_STREAK_BOOST : heat;
}
/** Rising Lava: from the pillar bottoms to two below the tops over the main phase, then to the tops. */
export function lavaLevel(mainElapsed: number, deathmatchElapsed: number): number {
  const climb = LP.TOP_Y - 2 - LP.BOTTOM_Y;
  let level = LP.BOTTOM_Y + Math.trunc(climb * Math.min(Math.max(0, mainElapsed), LP.MAIN_TICKS) / LP.MAIN_TICKS);
  if (deathmatchElapsed > 0) level = Math.min(LP.TOP_Y, LP.TOP_Y - 2 + Math.trunc(deathmatchElapsed / (30 * 20)));
  return level;
}
/** Players below this y are out. */
export function voidY(twist: LpTwist): number {
  return twist === 'slime_floor' ? LP.BOTTOM_Y - 12 : LP.BOTTOM_Y - 6;
}
export function tntRainInterval(alive: number): number { return Math.max(40, Math.trunc(200 / Math.max(1, alive))); }
export function shuffleShift(rng: () => number, alive: number): number { return alive < 2 ? 0 : 1 + Math.floor(rng() * (alive - 1)); }

/** World seed: packs everything the generator needs (layout, count, rotation, twist floor). */
export function lpSeed(layout: LpLayout, players: number, angleStep: number, slimeFloor: boolean): number {
  return (LP_LAYOUTS.indexOf(layout) & 3) | ((players & 15) << 2) | ((angleStep & 1023) << 6) | ((slimeFloor ? 1 : 0) << 16);
}
export function lpUnseed(seed: number): { layout: LpLayout; players: number; angle: number; slimeFloor: boolean } {
  return {
    layout: LP_LAYOUTS[seed & 3], players: Math.max(1, (seed >> 2) & 15),
    angle: ((seed >> 6) & 1023) / 1024 * Math.PI * 2, slimeFloor: ((seed >> 16) & 1) === 1,
  };
}

export type LpPhase = 'countdown' | 'main' | 'deathmatch' | 'over';

/** What every client sees of the match (broadcast a few times a second). */
export interface PillarsState {
  mode: 'pillars';
  /** Server ms when this snapshot was sent (the client's clock anchor). */
  serverNow: number;
  phase: LpPhase;
  /** Server ms when the current phase ends. */
  endsAt: number;
  twist: LpTwist | null;
  /** Slot-machine title shown while the twist is still being "rolled". */
  rolling?: string;
  layout: LpLayout;
  lavaY: number | null;
  border: number;
  /** Thunderstorm twist: dark sky and rain. */
  thunder: boolean;
  players: { id: number; name: string; kills: number; alive: boolean; hp: number; glow?: boolean; invis?: boolean; scale?: number }[];
  result?: PillarsResult;
}
export interface PillarsResult {
  winner: number | null;
  rows: { id: number; name: string; place: number; kills: number; items: number; legendaries: number; survived: boolean }[];
}
