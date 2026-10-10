// Shared Bridge combat budget and outcomes.
import { meleeSwing, type SwingInput, type SwingResult } from './melee';

/** Goals that take a game of The Bridge. */
export const BRIDGE_GOAL_LIMIT = 5;
/** A goal restarts the round: both players are shut back into their own drop
 *  cage and held there for this long, counted down on the HUD, before the
 *  hatches open again. Deliberately the same three seconds as the opening
 *  countdown — a restart should feel like the round starting over. */
export const BRIDGE_GOAL_RESET_MS = 3000;
/** Bridge attacks have fixed strength. Short action intervals bound packet
 * spam; waiting never earns extra damage or knockback. */
export const BRIDGE_RESPAWN_SHIELD_MS = 1800;
/** Dead in The Bridge: this long as a flying spectator before you respawn. */
export const BRIDGE_RESPAWN_DELAY_MS = 3000;
export const BRIDGE_MELEE_TIER = { damage: 5, cooldownMs: 280, kbBonus: 0.02 } as const;
/** How early (ms) a swing may ARRIVE against the cooldown and still count.
 *  The client paces the axe at exactly `cooldownMs`, but packets bunch up on
 *  the way: judged to the millisecond, a held button dropped roughly one hit
 *  in five as "spam", and those were the swings that felt like they went
 *  straight through somebody. Small enough that no client can gain a real
 *  extra swing from it. */
export const BRIDGE_SWING_JITTER_MS = 60;
export const BRIDGE_KILL_CREDIT_MS = 10_000;
/** One arrow every five seconds: the bow is a finisher, not a spray. */
export const BRIDGE_BOW_COOLDOWN_MS = 5000;
export const BRIDGE_ARROW_SPEED = 62;
export const BRIDGE_ARROW_GRAVITY = 19;
export const BRIDGE_ARROW_LIFE_MS = 5000;
const BRIDGE_ARROW_DAMAGE = 7;
const BRIDGE_ARROW_KB = 0.55;
export const BRIDGE_ARROW_KB_VERT = 0.3;

/** Keep movement crits, directional sprint knockback and earned combos, with
 * full-strength contact on every accepted swing, including the first one. */
export function bridgeSwing(input: Omit<SwingInput, 'tier' | 'sinceLastSwingMs' | 'critFallVy'>): SwingResult {
  // About 0.9 m/s downward: past the apex of an ordinary 1.25-block jump.
  return meleeSwing({ ...input, tier: BRIDGE_MELEE_TIER, critFallVy: -.015,
    sinceLastSwingMs: BRIDGE_MELEE_TIER.cooldownMs });
}

/** Instant arrows reward leading a moving target and controlling the arc. */
export function bridgeArrowShot(): {
  speed: number; damage: number; crit: boolean; knockback: number;
} {
  return { speed: BRIDGE_ARROW_SPEED, damage: BRIDGE_ARROW_DAMAGE,
    crit: false, knockback: BRIDGE_ARROW_KB };
}
