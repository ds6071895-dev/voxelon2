export interface Spawn { x: number; y: number; z: number }
interface LoadingWorld {
  update(x: number, z: number, budget: number, radius: number): boolean;
  updateVenue(budget: number): boolean;
  isLoaded(x: number, z: number): boolean;
}
interface IntervalClock {
  setInterval(callback: () => void, ms: number): number;
  clearInterval(id: number): void;
}

/** Both the background timer and the frame path share one ready latch. */
export class WorldReadiness {
  pendingTeleport: (Spawn & { started: number }) | null = null;
  private sent = false;
  private watchdog = 0;
  private kind: 'duel' | 'pg' | 'rs' | 'bw' | null = null;

  constructor(private readonly world: LoadingWorld, private readonly sendReady: () => void,
    private readonly hideLoading: () => void, private readonly clock: IntervalClock = window) {}

  enter(kind: NonNullable<WorldReadiness['kind']>, spawn: Spawn, now: number): void {
    this.reset();
    this.kind = kind;
    this.pendingTeleport = { ...spawn, started: now };
    const { x, z } = spawn;
    this.watchdog = this.clock.setInterval(() => {
      if (!this.kind || this.sent) { this.stop(); return; }
      const complete = this.kind === 'bw' ? this.world.updateVenue(30)
        : this.world.update(x, z, 30, this.kind === 'pg' ? 4 : 2);
      if (complete && this.world.isLoaded(x, z)) {
        this.pendingTeleport = null;
        this.ready();
      }
    }, 100);
  }
  teleport(spawn: Spawn, now: number): void {
    const { x, z } = spawn;
    const loaded = [-.3, .3].every(dx => [-.3, .3].every(dz => this.world.isLoaded(x + dx, z + dz)));
    this.pendingTeleport = loaded ? null : { ...spawn, started: now };
  }
  /** Retains the original frame budget/radius and four-second physics fallback. */
  update(now: number): void {
    const tp = this.pendingTeleport;
    if (!tp || !this.kind) return;
    const complete = this.kind === 'bw' ? this.world.updateVenue(20) : this.world.update(tp.x, tp.z, 20, 2);
    if (complete || now - tp.started > 4) {
      this.pendingTeleport = null;
      if (complete) this.ready();
    }
  }
  private ready(): void {
    this.hideLoading();
    if (this.sent || !this.kind) return;
    this.sent = true;
    this.sendReady();
    this.stop();
  }
  private stop(): void { if (this.watchdog) this.clock.clearInterval(this.watchdog); this.watchdog = 0; }
  reset(): void { this.stop(); this.kind = null; this.sent = false; this.pendingTeleport = null; }
}
