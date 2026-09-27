// Directional melee: the swing model shared by The Bridge's axe. Pure (no
// DOM/THREE/Node) so the server that judges a hit and anything that predicts
// one agree to the last decimal. Extracted from VOXELON's Bedwars module,
// which Worlds does not ship.

import { INTERP_DELAY } from './interp';

/** One weapon's stats: base damage, cadence and extra knockback. */
export interface SwingTier {
  readonly item: number;
  readonly damage: number;
  readonly cooldownMs: number;
  readonly kbBonus: number;
}
export const MELEE_COMBO_WINDOW_MS = 1_600;
export const MELEE_COMBO_STEP = 0.10;
export const MELEE_COMBO_MAX = 3;
export const MELEE_CRIT_MULT = 1.5;
/** Falling at least this fast counts as a jump-crit / fall-crit. */
export const MELEE_CRIT_FALL_VY = -0.15;
export const MELEE_SPRINT_SPEED = 5.2;
export const MELEE_SPRINT_KB_MULT = 1.85;
export const MELEE_KB_BASE = 0.62;
export const MELEE_KB_VERT = 0.42;
/** How much of the knockback direction comes from where the attacker is LOOKING
 *  rather than from the line between the bodies. This is the most important
 *  number in the mode: it is what turns "line him up with the edge, then swing"
 *  into a learnable skill instead of an accident of where you happened to stand. */
export const MELEE_LOOK_BLEND = 0.30;
export const MELEE_RANGE = 4.2;
export const MELEE_FACING_DOT = 0.55;
/** Lag-compensation window: the attacker sees the target INTERP_DELAY (plus
 *  one-way latency) in the past, so the swing reaches the server roughly
 *  INTERP_DELAY + the attacker's RTT after the position it was aimed at. Kept
 *  tied to INTERP_DELAY with ~150ms of RTT headroom — far short of the 1.2s
 *  DUEL_TRACK_WINDOW: melee has no travel time, so a wider window would let a
 *  laggy client hit someone who has already sprinted four metres clear. */
export const MELEE_REWIND_S = INTERP_DELAY + 0.15;

export interface SwingInput {
  tier: SwingTier;
  /** Milliseconds since this attacker's last LANDED swing. */
  sinceLastSwingMs: number;
  /** Consecutive prior hits on this same target inside the combo window. */
  combo: number;
  onGround: boolean;
  /** Attacker's vertical velocity, blocks/tick. */
  vy: number;
  /** Mode-specific descent threshold, in blocks per tick. */
  critFallVy?: number;
  /** Attacker's horizontal speed, blocks/second. */
  speed: number;
  /** Unit vector from attacker to target, horizontal. */
  toTargetX: number;
  toTargetZ: number;
  /** Attacker's horizontal look direction, unit. */
  lookX: number;
  lookZ: number;
}

export interface SwingResult {
  damage: number;
  /** 0..1 charge actually achieved. */
  charge: number;
  crit: boolean;
  sprint: boolean;
  /** Combo multiplier step applied (0..MELEE_COMBO_MAX). */
  combo: number;
  /** Knockback impulse, in the same units the `hurt` arm already delivers. */
  kx: number;
  ky: number;
  kz: number;
}

/**
 * The whole feel of the mode, in one pure function.
 *
 * Charge is QUADRATIC, and that exponent is the design. Linear charge gives 62%
 * damage at half cooldown, which makes spamming roughly break-even;
 * `0.25 + 0.75c^2` gives 44%, which makes it a strict loss. You wait, then you
 * land. The combo counter then adds pressure on top of patience — three
 * consecutive full-charge hits on one target inside 1.6s, broken by a miss, a
 * target switch, or by being hit yourself.
 */
export function meleeSwing(input: SwingInput): SwingResult {
  const cooldown = Math.max(1, input.tier.cooldownMs);
  const c = Math.max(0, Math.min(1, input.sinceLastSwingMs / cooldown));
  const charged = 0.25 + 0.75 * c * c;
  const comboSteps = Math.max(0, Math.min(MELEE_COMBO_MAX, Math.floor(input.combo)));
  const comboMult = 1 + MELEE_COMBO_STEP * comboSteps;
  const crit = !input.onGround && input.vy < (input.critFallVy ?? MELEE_CRIT_FALL_VY);
  const sprint = input.speed >= MELEE_SPRINT_SPEED;
  const damage = Math.round(
    input.tier.damage * charged * comboMult * (crit ? MELEE_CRIT_MULT : 1),
  );

  // Direction: mostly the line between the bodies, blended toward the
  // attacker's aim. Horizontal only — vertical lift is a separate constant.
  let dx = (1 - MELEE_LOOK_BLEND) * input.toTargetX + MELEE_LOOK_BLEND * input.lookX;
  let dz = (1 - MELEE_LOOK_BLEND) * input.toTargetZ + MELEE_LOOK_BLEND * input.lookZ;
  const len = Math.hypot(dx, dz);
  if (len > 1e-6) { dx /= len; dz /= len; } else { dx = input.toTargetX; dz = input.toTargetZ; }

  const kh = (MELEE_KB_BASE + input.tier.kbBonus) * (0.55 + 0.45 * c) *
    (sprint ? MELEE_SPRINT_KB_MULT : 1) * (crit ? 1.15 : 1);
  const ky = MELEE_KB_VERT + (crit ? 0.10 : 0);

  return {
    damage: Math.max(1, damage),
    charge: c, crit, sprint, combo: comboSteps,
    kx: dx * kh, ky, kz: dz * kh,
  };
}
