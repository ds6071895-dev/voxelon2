/**
 * Pure item ids used by minigame isolation.
 *
 * Keep this module dependency-free: both the main item registry and the
 * minigame-only registry need these values during module initialization.
 */
export const enum MinigameItemId {
  VoidCleaver = 247,
  KnockbackStick = 248,
  BridgeBow = 249,
  BridgeArrow = 250,
}
