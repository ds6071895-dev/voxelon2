// Remote-player motion smoothing for PvP.
//
// The server broadcasts transforms at SNAPSHOT_HZ, so a client only ever learns
// where an enemy is a few times per frame-budget. Rendering those samples with
// an exponential "ease toward the latest value" filter (what this used to do)
// has two problems that ruin gunfights:
//
//   1. The avatar permanently TRAILS its real position by a varying amount, so
//      the lead you need on a moving target changes shot to shot.
//   2. Motion eases in and out between packets instead of running at constant
//      velocity, which reads as floaty and makes strafes impossible to track.
//
// Instead we buffer timestamped samples and render each avatar at a fixed
// INTERP_DELAY behind the local clock, interpolating between the two samples
// that bracket that render time. The delay is paid once, up front, and is the
// same for everyone: motion is exactly the path the target walked, played back
// slightly late, at the right speed. Because the hit test runs against the
// rendered position, what you shoot at is what you hit.
//
// Pure module: no DOM, no THREE, no network types — so the smoke tests can
// drive it directly.

/** Seconds behind the local clock that remote avatars are rendered. Samples
 *  are placed on the SENDER's timeline (see SenderClock), so this has to cover
 *  one client send interval (1/20s) plus the server's relay hold (up to one
 *  1/20s snapshot tick) plus ordinary network jitter. */
export const INTERP_DELAY = 0.13;
/** How far past the newest sample we will extrapolate before freezing. Covers a
 *  dropped packet or two without letting a disconnected player slide away. */
export const EXTRAPOLATE_MAX = 0.15;
/** A gap this large between consecutive samples is a teleport/respawn, not
 *  movement — snap rather than sliding the avatar across the world. */
export const SNAP_DISTANCE = 8;
/** Samples older than this are dropped (they can never be needed again). */
const RETAIN = 1;

export interface TransformSample {
  /** Local receive time, in seconds. */
  t: number;
  x: number; y: number; z: number;
  yaw: number; pitch: number;
}

/** Shortest signed angular distance from `a` to `b` (radians, result in ±π). */
export function wrapAngle(delta: number): number {
  let d = delta;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

function lerp(a: number, b: number, k: number): number {
  return a + (b - a) * k;
}

function lerpAngle(a: number, b: number, k: number): number {
  return a + wrapAngle(b - a) * k;
}

/**
 * A short history of one remote player's transforms, sampled by time.
 *
 * `push` in receive order; `sample(renderTime)` for the position to draw. The
 * buffer is deliberately tiny — a second of history at snapshot rate.
 */
export class TransformBuffer {
  private readonly samples: TransformSample[] = [];

  /** Number of buffered samples (tests / diagnostics). */
  get length(): number { return this.samples.length; }

  /** Local time of the newest sample, or -Infinity when empty. */
  get newest(): number {
    return this.samples.length ? this.samples[this.samples.length - 1].t : -Infinity;
  }

  /** Drop all history and restart at this transform (join, respawn, teleport). */
  reset(s: TransformSample): void {
    this.samples.length = 0;
    this.samples.push({ ...s });
  }

  /**
   * Record a snapshot. Non-finite values and out-of-order/duplicate timestamps
   * are ignored (fail-closed: a junk sample must never poison the playback), and
   * a jump longer than SNAP_DISTANCE restarts the buffer so the avatar appears
   * at the new spot instead of gliding there.
   */
  push(s: TransformSample): void {
    if (!Number.isFinite(s.t) ||
        !Number.isFinite(s.x) || !Number.isFinite(s.y) || !Number.isFinite(s.z) ||
        !Number.isFinite(s.yaw) || !Number.isFinite(s.pitch)) return;
    const last = this.samples[this.samples.length - 1];
    if (last) {
      if (s.t <= last.t) return; // stale or duplicate
      const jump = Math.hypot(s.x - last.x, s.y - last.y, s.z - last.z);
      if (jump > SNAP_DISTANCE) { this.reset(s); return; }
    }
    this.samples.push({ ...s });
    // Retire history that can no longer bracket a render time.
    const cutoff = s.t - RETAIN;
    let drop = 0;
    while (drop + 2 < this.samples.length && this.samples[drop + 1].t < cutoff) drop++;
    if (drop > 0) this.samples.splice(0, drop);
  }

  /**
   * The transform to draw at `renderTime` (already delayed by INTERP_DELAY).
   *
   * - Between two samples: linear interpolation (constant velocity).
   * - Past the newest: extrapolated along the last known velocity for at most
   *   EXTRAPOLATE_MAX, then held still.
   * - Before the oldest (a fresh join): the oldest sample.
   * - Empty buffer: null, so the caller can fall back.
   */
  sample(renderTime: number): TransformSample | null {
    const n = this.samples.length;
    if (n === 0) return null;
    const first = this.samples[0];
    const last = this.samples[n - 1];
    if (n === 1 || renderTime <= first.t) return { ...first, t: renderTime };

    if (renderTime >= last.t) {
      const prev = this.samples[n - 2];
      const span = last.t - prev.t;
      const ahead = Math.min(renderTime - last.t, EXTRAPOLATE_MAX);
      if (!(span > 1e-6) || ahead <= 0) return { ...last, t: renderTime };
      const k = ahead / span;
      return {
        t: renderTime,
        x: last.x + (last.x - prev.x) * k,
        y: last.y + (last.y - prev.y) * k,
        z: last.z + (last.z - prev.z) * k,
        // Angles are NOT extrapolated: spinning a head past its last known
        // heading looks far worse than briefly holding it.
        yaw: last.yaw,
        pitch: last.pitch,
      };
    }

    // Newest-first scan: the render time is nearly always in the last span.
    for (let i = n - 2; i >= 0; i--) {
      const a = this.samples[i];
      const b = this.samples[i + 1];
      if (renderTime < a.t) continue;
      const span = b.t - a.t;
      const k = span > 1e-6 ? (renderTime - a.t) / span : 1;
      return {
        t: renderTime,
        x: lerp(a.x, b.x, k),
        y: lerp(a.y, b.y, k),
        z: lerp(a.z, b.z, k),
        yaw: lerpAngle(a.yaw, b.yaw, k),
        pitch: lerp(a.pitch, b.pitch, k),
      };
    }
    return { ...first, t: renderTime };
  }
}

/**
 * Maps one remote player's sample clock onto ours.
 *
 * Stamping samples with their ARRIVAL time turns every bit of delivery
 * unevenness into speed changes: the server's relay tick is not phase-locked
 * to any client's send tick, and the network adds its own jitter on top, so
 * arrival spacing never matches the spacing of the movement it carries. The owner's own clock
 * (relayed as `ct`) is perfectly even, so we play motion back on that timeline.
 *
 * The offset (local − sender) tracks the FASTEST delivery over the last
 * CLOCK_WINDOW seconds: a sliding-window minimum, which stays put under steady
 * jitter (the fast packets keep re-confirming it) yet still lets go of an old
 * minimum once latency lasts longer. The applied offset slews toward it at a
 * bounded rate, so playback never jumps backwards in time. That slew is baked
 * into the spacing of the samples, i.e. it IS a playback-speed change, so it is
 * kept small: at most a few percent, never a visible surge.
 */
export class SenderClock {
  /** Candidate minima as (local time, offset), offsets strictly increasing. */
  private readonly window: { at: number; o: number }[] = [];
  private applied = NaN;
  private lastLocal = 0;
  private lastSender = -Infinity;

  private get target(): number { return this.window.length ? this.window[0].o : NaN; }

  /**
   * Local time for a sample stamped `senderMs` that arrived at `localNow`, or
   * null for a stale/duplicate stamp (the server re-relays the last transform
   * when no new one came in). `restarted` is true when the sender's clock
   * jumped (reload, reconnect) and the caller should reset its history.
   */
  map(senderMs: number, localNow: number): { t: number; restarted: boolean } | null {
    const sender = senderMs / 1000;
    const o = localNow - sender;
    let restarted = false;
    if (!Number.isFinite(this.applied) || Math.abs(o - this.target) > 1 || sender < this.lastSender - 1) {
      restarted = Number.isFinite(this.lastSender);
      this.window.length = 0;
      this.window.push({ at: localNow, o });
      this.applied = o;
    } else {
      if (sender <= this.lastSender) return null;
      // Monotonic deque: anything slower than the newcomer can never be the
      // minimum again; anything older than the window has expired.
      while (this.window.length && this.window[this.window.length - 1].o >= o) this.window.pop();
      this.window.push({ at: localNow, o });
      while (this.window.length > 1 && localNow - this.window[0].at > CLOCK_WINDOW) this.window.shift();
      const elapsed = Math.max(0, localNow - this.lastLocal);
      const gap = this.target - this.applied;
      // Falling behind (latency rose) risks running dry, so it is corrected a
      // little faster than surplus buffer is given back.
      const step = elapsed * (gap > 0 ? CLOCK_SLEW_UP : CLOCK_SLEW_DOWN);
      this.applied += Math.max(-step, Math.min(step, gap));
    }
    this.lastLocal = localNow;
    this.lastSender = sender;
    return { t: sender + this.applied, restarted };
  }
}

/** Seconds of arrivals the SenderClock minimum is taken over. */
const CLOCK_WINDOW = 2;
/** Max playback-rate change while re-syncing the SenderClock (fractions). */
const CLOCK_SLEW_UP = 0.05;
const CLOCK_SLEW_DOWN = 0.02;

/**
 * Discrete state (pose flags, held item, swing counter) on the same timeline as
 * a TransformBuffer. Applying it on ARRIVAL would run it INTERP_DELAY ahead of
 * the body it belongs to: a player would crouch, draw a bow or swing before
 * reaching the spot where they actually did it. `at(renderTime)` returns the
 * state that was current at the instant being drawn.
 */
export class StateTimeline<T> {
  private readonly entries: { t: number; v: T }[] = [];

  /** Drop all history and restart with this state (join, clock restart). */
  reset(t: number, v: T): void {
    this.entries.length = 0;
    this.entries.push({ t, v });
  }

  /** Record the state current from `t` on. A same-time push replaces; an older
   *  one is ignored, so the timeline only ever moves forward. */
  push(t: number, v: T): void {
    if (!Number.isFinite(t)) return;
    const last = this.entries[this.entries.length - 1];
    if (last && t < last.t) return;
    if (last && t === last.t) { last.v = v; return; }
    this.entries.push({ t, v });
    // Bounded even if nobody is sampling (avatar not rendered this session).
    if (this.entries.length > 64) this.entries.splice(0, this.entries.length - 64);
  }

  /** The newest state stamped at or before `renderTime` (the oldest one before
   *  history begins), or undefined when empty. Earlier entries are retired. */
  at(renderTime: number): T | undefined {
    let i = 0;
    while (i + 1 < this.entries.length && this.entries[i + 1].t <= renderTime) i++;
    if (i > 0) this.entries.splice(0, i);
    return this.entries[0]?.v;
  }
}

/** Monotonic seconds for stamping received snapshots. Uses `performance` where
 *  it exists (browser + modern Node) and falls back to Date.now elsewhere. */
export function netNow(): number {
  const perf = (globalThis as { performance?: { now(): number } }).performance;
  return perf ? perf.now() / 1000 : Date.now() / 1000;
}
