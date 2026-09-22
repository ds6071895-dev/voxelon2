// Status effects a trap (or anything else) can put on the local player. Pure
// bookkeeping — main.ts reads the flags each frame to gate movement/actions and
// draw the HUD. Damage-over-time (bleed/burning) is applied by the server in
// multiplayer; offline, main.ts ticks it from `dotDamage`.

import type { EffectKind } from './traps';

export const EFFECT_LABELS: Readonly<Record<EffectKind, string>> = {
  bleed: 'BLEEDING',
  slow: 'POISONED',
  stun: 'STUNNED',
  pinned: 'CAUGHT IN A BEAR TRAP',
  netted: 'NETTED',
  burning: 'ON FIRE',
};

export const EFFECT_COLORS: Readonly<Record<EffectKind, string>> = {
  bleed: '#e0453a', slow: '#7bd35a', stun: '#8fd3ff', pinned: '#ff9a3d', netted: '#e6dcc0', burning: '#ff7a1a',
};

/** Jumps needed to prise a bear trap open (each press shaves time off). */
export const PIN_STRUGGLES = 6;

export class StatusEffects {
  private readonly left = new Map<EffectKind, number>();
  private dotAcc = 0;
  /** Seconds the pin started with (the struggle scales against it). */
  private pinTotal = 0;

  add(kind: EffectKind, seconds: number): void {
    if (!(seconds > 0) || !Number.isFinite(seconds)) return;
    const cur = this.left.get(kind) ?? 0;
    if (seconds > cur) {
      this.left.set(kind, Math.min(30, seconds));
      if (kind === 'pinned') this.pinTotal = seconds;
    }
  }

  has(kind: EffectKind): boolean { return (this.left.get(kind) ?? 0) > 0; }
  remaining(kind: EffectKind): number { return this.left.get(kind) ?? 0; }
  clear(): void { this.left.clear(); this.dotAcc = 0; }
  get active(): EffectKind[] { return [...this.left.keys()].filter(k => this.has(k)); }

  /** One struggle press against a bear trap: returns true once free. */
  struggle(): boolean {
    const cur = this.left.get('pinned') ?? 0;
    if (cur <= 0) return true;
    const next = cur - Math.max(0.6, this.pinTotal / PIN_STRUGGLES);
    if (next <= 0) { this.left.delete('pinned'); return true; }
    this.left.set('pinned', next);
    return false;
  }

  /** Presses still needed to break a pin. */
  strugglesLeft(): number {
    const cur = this.left.get('pinned') ?? 0;
    if (cur <= 0) return 0;
    return Math.ceil(cur / Math.max(0.6, this.pinTotal / PIN_STRUGGLES));
  }

  /** Advance timers. Returns whole points of DoT due this frame (bleed 1/s,
   *  burning 1.5/s) — the caller applies it only when it is authoritative. */
  update(dt: number): number {
    let dps = 0;
    if (this.has('bleed')) dps += 1;
    if (this.has('burning')) dps += 1.5;
    for (const [k, v] of this.left) {
      const n = v - dt;
      if (n <= 0) this.left.delete(k); else this.left.set(k, n);
    }
    if (dps <= 0) { this.dotAcc = 0; return 0; }
    this.dotAcc += dps * dt;
    const whole = Math.floor(this.dotAcc + 1e-9); // 0.1 × 10 must make 1
    this.dotAcc = Math.max(0, this.dotAcc - whole);
    return whole;
  }

  /** No walking at all (pinned / netted / stunned). */
  rooted(): boolean { return this.has('pinned') || this.has('netted') || this.has('stun'); }
  /** Can't shoot, swing, mine or place (netted / stunned). */
  blocksActions(): boolean { return this.has('netted') || this.has('stun'); }
  /** Movement multiplier from lingering effects. */
  speedMult(): number { return this.has('slow') ? 0.45 : 1; }
}
