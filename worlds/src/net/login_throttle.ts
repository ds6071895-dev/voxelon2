interface Throttle { fails: number; first: number; lockedUntil: number }

/** Per-name failures and per-socket attempts share expiry/lockout rules. */
export class LoginThrottle {
  private readonly buckets = new Map<string, Throttle>();
  constructor(private readonly max: number, private readonly windowMs = 5 * 60_000,
    private readonly lockoutMs = 60_000) {}
  get size(): number { return this.buckets.size; }
  private expired(t: Throttle, now: number): boolean {
    return now >= t.lockedUntil && now - t.first >= this.windowMs;
  }
  remaining(key: string, now: number): number {
    const t = this.buckets.get(key);
    if (!t) return 0;
    if (this.expired(t, now)) { this.buckets.delete(key); return 0; }
    return Math.max(0, t.lockedUntil - now);
  }
  record(key: string, now: number): void {
    let t = this.buckets.get(key);
    if (!t || this.expired(t, now)) {
      t = { fails: 0, first: now, lockedUntil: 0 }; this.buckets.set(key, t);
    }
    if (++t.fails >= this.max) t.lockedUntil = now + this.lockoutMs;
  }
  delete(key: string): void { this.buckets.delete(key); }
  sweep(now: number): void {
    for (const [key, t] of this.buckets) if (this.expired(t, now)) this.buckets.delete(key);
  }
}
