// Applying a Bandage/Medkit is a short deliberate ACT, not an instant click:
// the item is worked over a channel that the first-person hand, the HUD bar,
// the audio and the particles all animate against. The timing lives here (pure,
// headless-testable) so main.ts only has to draw what it reports.

import { Item } from './items';

/** Seconds spent applying each healing consumable. A bandage is a quick wrap;
 *  a medkit is a slower, more deliberate patch-up (and heals far harder). */
export const HEAL_USE_TIME: Record<number, number> = {
  [Item.Bandage]: 1.1,
  [Item.Medkit]: 1.9,
};
export const DEFAULT_HEAL_USE_TIME = 1.2;

/** Seconds between "work" beats — one wrap pull / latch press each. The hand
 *  presses in and a soft tick plays on every beat, so the channel has a pulse
 *  instead of being dead air. */
export const HEAL_BEAT = 0.34;

export function healUseTime(id: number): number {
  return HEAL_USE_TIME[id] ?? DEFAULT_HEAL_USE_TIME;
}

/** What happened during one frame of a use. */
export interface HealUseTick {
  /** Work beats that landed this frame (usually 0 or 1). */
  beats: number;
  /** The channel completed this frame — apply the heal exactly once. */
  done: boolean;
  /** The item that finished (0 unless `done`). */
  item: number;
}

const IDLE: HealUseTick = { beats: 0, done: false, item: 0 };

/** The in-progress application of one healing item. */
export class HealUse {
  /** Item being applied (0 when idle). */
  itemId = 0;
  /** Hotbar slot it was started from — a slot change cancels the use. */
  slot = -1;
  private total = 0;
  private t = 0;
  private beats = 0;

  get active(): boolean { return this.total > 0; }
  get elapsed(): number { return this.t; }
  get duration(): number { return this.total; }
  /** 0..1 through the channel (0 while idle). */
  get progress(): number {
    return this.total > 0 ? Math.min(1, this.t / this.total) : 0;
  }

  start(itemId: number, slot: number, duration = healUseTime(itemId)): void {
    this.itemId = itemId;
    this.slot = slot;
    this.total = Math.max(0.05, duration);
    this.t = 0;
    this.beats = 0;
  }

  cancel(): void {
    this.itemId = 0;
    this.slot = -1;
    this.total = 0;
    this.t = 0;
    this.beats = 0;
  }

  tick(dt: number): HealUseTick {
    if (!this.active) return IDLE;
    this.t += Math.max(0, dt);
    // Beats only land while the wrap is still being worked; the final beat is
    // the completion itself, so don't double up at the very end.
    let beats = 0;
    while ((this.beats + 1) * HEAL_BEAT <= Math.min(this.t, this.total - 0.06)) {
      this.beats++;
      beats++;
    }
    if (this.t >= this.total) {
      const item = this.itemId;
      this.cancel();
      return { beats, done: true, item };
    }
    return beats ? { beats, done: false, item: 0 } : IDLE;
  }
}
