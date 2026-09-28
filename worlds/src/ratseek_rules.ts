// Rat and Seek: the rules and shapes shared by the server engine
// (ratseek.ts) and the client. Timings are in game ticks (20 per second),
// exactly as the AutoBox plugin counted them; the numbers are the plugin's
// "Normal" preset. There are no host settings in Worlds: every match plays
// these rules.

import { Item } from './items';

export const RS_TPS = 20;
export const RS = {
  INTRO_TICKS: 90,
  HIDE_TICKS: 30 * 20,
  HUNT_TICKS: 4 * 1200,
  TAUNT_COOLDOWN: 300,
  DASH_COOLDOWN: 240,
  SCENT_COOLDOWN: 300,
  RATTLE_COOLDOWN: 300,
  COMBO_WINDOW: 240,
  CHEESE_RESPAWN: 240,
  CHEESE_RAIN_BONUS: 6,
  MAX_CHEESE: 14,
  MAX_BANKED_ESCAPES: 1,
  RESCUE_COST: 3,
  SECRET_PASSAGE_WARNING: 60,
  SECRET_PASSAGE_LIMIT: 120,
  FINAL_FRENZY_TICKS: 1200,
  /** Seekers run this many times as fast as a rat (the plugin's 1.30x). */
  HUMAN_SPEED: 1.3,
  RAT_SCALE: 0.5,
  /** Twist timer: 500 + up to 300 ticks between house twists. */
  TWIST_MIN: 500,
  TWIST_SPREAD: 300,
  /** Seeker kit. */
  TRAP_CHARGES: 3,
  BAIT_CHARGES: 2,
  BATTERY: 200,
  BEAM_RANGE: 14,
  BEAM_COS: 0.93,
  TRAP_RECHARGE: 400,
  BAIT_RECHARGE: 600,
  /** House life. */
  CHANDELIER_WARNING: 20,
  CHANDELIER_REHANG: 900,
  CAT_RANGE: 10,
  /** Human attack reach from the eye, in blocks. */
  REACH: 3,
  SWAT_REACH: 2.7,
} as const;

export type RatClassId = 'scout' | 'thief' | 'trickster' | 'tinkerer';
export const RAT_CLASS_IDS: readonly RatClassId[] = ['scout', 'thief', 'trickster', 'tinkerer'];
export function isRatClass(v: unknown): v is RatClassId {
  return v === 'scout' || v === 'thief' || v === 'trickster' || v === 'tinkerer';
}

export interface RatClassInfo {
  name: string;
  passive: string;
  ability: string;
  abilityDescription: string;
  cooldownTicks: number;
  color: string;
  /** Hotbar item for the ability, and the badge the class picker shows. */
  item: number;
  badge: number;
}

/** Rat specialisations: each adds one passive and one ability to the kit. */
export const RAT_CLASSES: Record<RatClassId, RatClassInfo> = {
  scout: {
    name: 'Scout', passive: 'Scamper recharges in 8s instead of 12s.',
    ability: 'Whisker Sense', abilityDescription: 'Arrows to every seeker for 5 seconds',
    cooldownTicks: 400, color: '#5ed1f0', item: Item.WhiskerSense, badge: Item.ClassScout,
  },
  thief: {
    name: 'Thief', passive: '+1 bonus point per cheese.',
    ability: 'Cheese Magnet', abilityDescription: 'Pull cheese within 6 blocks straight to you',
    cooldownTicks: 500, color: '#f2c14a', item: Item.CheeseMagnet, badge: Item.ClassThief,
  },
  trickster: {
    name: 'Trickster', passive: 'Seekers who swat a decoy are dazed.',
    ability: 'Decoy Rat', abilityDescription: 'Send a squeaking fake rat running ahead',
    cooldownTicks: 600, color: '#d38af0', item: Item.DecoyRat, badge: Item.ClassTrickster,
  },
  tinkerer: {
    name: 'Tinkerer', passive: 'Sees mousetraps and bait sparkle nearby.',
    ability: 'Disarm', abilityDescription: 'Break a mousetrap within 3 blocks for +2 points',
    cooldownTicks: 300, color: '#6fe08a', item: Item.Disarm, badge: Item.ClassTinkerer,
  },
};

/** Most rats that may share one class, so a lobby can't be all Scouts. */
export function ratClassCap(ratCount: number): number {
  return Math.max(1, Math.floor((ratCount + 1) / 2));
}

export type RsPhase = 'loading' | 'intro' | 'hiding' | 'hunting' | 'results';
export type RsRole = 'rat' | 'human';

/** One body as everyone in the match sees it. */
export interface RsPlayerView {
  id: number;
  name: string;
  role: RsRole;
  caged: boolean;
  /** Outline visible through walls (the plugin's Glowing). */
  glow: boolean;
  /** Ghost Rats: not drawn at all. */
  hidden: boolean;
  points: number;
  /** A golden trail: on a cheese combo of two or more. */
  trail: boolean;
  /** Human seekers with their flashlight on. */
  light: boolean;
}

/** Your own numbers, for the sidebar and the hotbar cooldowns. */
export interface RsSelfView {
  role: RsRole;
  caged: boolean;
  points: number;
  cheese: number;
  escapes: number;
  combo: number;
  cls: RatClassId | null;
  /** Ticks until ready (0 = ready). */
  abilityCd: number;
  tauntCd: number;
  dashCd: number;
  rattleCd: number;
  scentCd: number;
  light: boolean;
  battery: number;
  traps: number;
  baits: number;
  room: string;
  /** Where the seeker's compass points, if it has a heading. */
  compass: { x: number; z: number } | null;
}

export interface RsSnapshot {
  phase: RsPhase;
  serverNow: number;
  /** Server ms at which this phase ends (0 = open-ended). */
  endsAt: number;
  /** Length of the phase, for the progress bar. */
  phaseMs: number;
  players: RsPlayerView[];
  ratCount: number;
  freeRats: number;
  caged: number;
  seekers: number;
  twist: string;
  finalMinute: boolean;
  me: RsSelfView;
  cheese: { id: number; x: number; y: number; z: number }[];
  /** Tinkerers only: traps and bait nearby. */
  sparkles: { x: number; y: number; z: number; bait: boolean }[];
  decoys: { id: number; x: number; y: number; z: number; yaw: number }[];
  cat: { x: number; y: number; z: number; yaw: number; sit: boolean; pounce: boolean } | null;
  chandeliers: { x: number; y: number; z: number; drop: number; shake: boolean }[];
  classCounts: Record<RatClassId, number>;
  classCap: number;
  exchangeLabel: string;
}

export interface RsAward { title: string; winner: string; detail: string; color: string }
export interface RsResult {
  humansWon: boolean;
  reason: string;
  /** Top three of the winning side, best first. */
  podium: { id: number; name: string; score: string }[];
  awards: RsAward[];
  rats: { id: number; name: string; points: number; cheese: number; caged: boolean }[];
  seekers: { id: number; name: string; catches: number }[];
  durationMs: number;
}

/** Status effects the client applies to its own body and screen. */
export interface RsEffects {
  speed: number;
  jump: number;
  blind: boolean;
  dark: boolean;
  nausea: boolean;
  night: boolean;
  /** Rat body scale (1 for seekers). */
  scale: number;
}

export type RsSound = 'squeak' | 'snap' | 'cage' | 'rescue' | 'hunt' | 'tick' | 'bell' | 'sniff' | 'rattle' | 'crash'
  | 'chain' | 'pounce' | 'purr' | 'meow' | 'decoy' | 'poof' | 'cheese' | 'dash' | 'twist' | 'alarm' | 'escape' | 'click'
  | 'win' | 'lose' | 'heartbeat' | 'drum' | 'intro';
