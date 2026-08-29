// MISSILE CAM — the optional ride-along you get after pressing CONFIRM LAUNCH.
//
// A strategic strike is the most expensive thing a faction does and, until now,
// the entire payoff happened somewhere over the horizon: you pressed a button
// and read a line of text. This turns the launch into something you can watch —
// off the rail, up the arc, and down onto the target — from a camera that
// follows the REAL missile, and that you can dismiss at any moment.
//
// It owns the framing and the overlay. It owns no game state: main.ts hands it a
// live world position each frame (or nothing, when the missile is gone) and it
// hands back a camera pose. Escape, the close button, or a click anywhere on the
// overlay end it; so does the impact, after a beat on the fireball.

import * as THREE from 'three';
import { arcAt } from './strategic';
import { iconSvg } from './emoji_icons';

/** Seconds we linger on the fireball before the cam bows out on its own. */
const HOLD_AFTER_IMPACT = 3.4;
/** Seconds without a live position before we assume the flight is over. */
const LOST_GRACE = 0.6;

export type MissileCamOutcome = 'impact' | 'intercepted' | 'shot' | 'expired';

export interface MissileCamLaunch {
  /** Missile id, or 0 while we are still waiting for the server to name it. */
  id: number;
  /** Launch point (the silo). */
  from: { x: number; y: number; z: number };
  /** Aim point, at ground level. */
  to: { x: number; y: number; z: number };
  /** Planned flight time, seconds. */
  eta: number;
  /** Warhead blast radius, for the framing distance and the readout. */
  radius: number;
  /** Human name of the target (a waypoint or a flag). */
  label: string;
  /** CSS colour of the launching faction, for the overlay accents. */
  accent: string;
}

export interface MissileCamPose {
  eye: THREE.Vector3;
  look: THREE.Vector3;
  fov: number;
}

/** Where the arc puts a missile at progress `p`, and which way it is heading. */
export function arcPose(
  from: { x: number; y: number; z: number }, to: { x: number; y: number; z: number },
  p: number,
): { pos: THREE.Vector3; dir: THREE.Vector3 } {
  const seg = {
    sx: from.x, sy: from.y, sz: from.z,
    tx: to.x, ty: to.y, tz: to.z,
  };
  const a = arcAt(seg, p);
  // Differentiate numerically — the arc is a closed form, but sampling it twice
  // keeps this correct if that form ever changes.
  const b = arcAt(seg, Math.min(1, p + 0.01));
  const dir = new THREE.Vector3(b.x - a.x, b.y - a.y, b.z - a.z);
  if (dir.lengthSq() < 1e-8) dir.set(0, 1, 0);
  return { pos: new THREE.Vector3(a.x, a.y, a.z), dir: dir.normalize() };
}

export class MissileCam {
  private launch: MissileCamLaunch | null = null;
  private elapsed = 0;
  private lost = 0;
  private outcome: MissileCamOutcome | null = null;
  private holding = 0;
  private readonly impactAt = new THREE.Vector3();
  private readonly last = new THREE.Vector3();
  private haveLast = false;

  private readonly root: HTMLDivElement;
  private readonly titleEl: HTMLDivElement;
  private readonly statusEl: HTMLDivElement;
  private readonly readoutEl: HTMLDivElement;
  private readonly barFill: HTMLDivElement;
  private readonly closeBtn: HTMLButtonElement;

  /** Fired when the cam ends, however it ended. */
  onClose?: () => void;

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'mc-font';
    this.root.style.cssText =
      'position:absolute;inset:0;display:none;z-index:36;color:#dce6f5;' +
      'text-shadow:none;font-size:12px;cursor:pointer;';
    parent.appendChild(this.root);

    // Letterbox bands: the cheapest possible signal that you are watching
    // something rather than playing, and they double as the readout backing.
    const band = (top: boolean): HTMLDivElement => {
      const b = document.createElement('div');
      b.style.cssText =
        `position:absolute;left:0;right:0;${top ? 'top' : 'bottom'}:0;height:74px;` +
        `background:linear-gradient(${top ? '180deg' : '0deg'},` +
        `rgba(4,7,13,0.92),rgba(4,7,13,0.0));pointer-events:none;`;
      this.root.appendChild(b);
      return b;
    };
    const top = band(true);
    const bottom = band(false);

    const head = document.createElement('div');
    head.style.cssText =
      'position:absolute;top:14px;left:22px;right:22px;display:flex;align-items:center;gap:14px;';
    top.appendChild(head);
    this.titleEl = document.createElement('div');
    this.titleEl.style.cssText = 'flex:1;font-size:14px;letter-spacing:2.4px;';
    head.appendChild(this.titleEl);
    this.statusEl = document.createElement('div');
    this.statusEl.style.cssText = 'font-size:12px;letter-spacing:1.6px;';
    head.appendChild(this.statusEl);
    this.closeBtn = document.createElement('button');
    this.closeBtn.type = 'button';
    this.closeBtn.className = 'mc-font';
    this.closeBtn.innerHTML = `${iconSvg('close')} CLOSE (ESC)`;
    this.closeBtn.style.cssText =
      'min-height:34px;padding:0 12px;border-radius:7px;font-family:inherit;font-size:11px;' +
      'letter-spacing:1.2px;cursor:pointer;border:2px solid rgba(220,230,245,0.45);' +
      'background:rgba(10,16,26,0.75);color:#dce6f5;pointer-events:auto;';
    head.appendChild(this.closeBtn);
    this.closeBtn.addEventListener('click', (e) => { e.stopPropagation(); this.close(); });

    const foot = document.createElement('div');
    foot.style.cssText =
      'position:absolute;bottom:16px;left:22px;right:22px;display:flex;' +
      'flex-direction:column;gap:7px;';
    bottom.appendChild(foot);
    this.readoutEl = document.createElement('div');
    this.readoutEl.style.cssText =
      'display:flex;gap:20px;font-size:11px;letter-spacing:0.8px;color:#aebbd0;';
    foot.appendChild(this.readoutEl);
    const barWrap = document.createElement('div');
    barWrap.style.cssText =
      'position:relative;height:5px;border-radius:3px;overflow:hidden;' +
      'background:rgba(4,8,14,0.85);border:1px solid rgba(120,150,190,0.3);';
    foot.appendChild(barWrap);
    this.barFill = document.createElement('div');
    this.barFill.style.cssText =
      'position:absolute;inset:0 auto 0 0;width:0%;background:#5ce2ec;';
    barWrap.appendChild(this.barFill);

    // A click anywhere on the overlay dismisses it — "I can close at any time"
    // should not require finding a button.
    this.root.addEventListener('mousedown', () => this.close());
  }

  get active(): boolean { return this.launch !== null; }
  /** The missile we are following (0 = still waiting to be told). */
  get missileId(): number { return this.launch?.id ?? 0; }

  begin(launch: MissileCamLaunch): void {
    this.launch = { ...launch };
    this.elapsed = 0;
    this.lost = 0;
    this.outcome = null;
    this.holding = 0;
    this.haveLast = false;
    this.root.style.display = 'block';
    this.titleEl.innerHTML = `${iconSvg('rocket')} STRIKE CAMERA`;
    this.titleEl.style.color = launch.accent;
    this.barFill.style.background = launch.accent;
    this.closeBtn.style.borderColor = launch.accent;
    this.paint(null);
  }

  /** The server named the missile this cam is following. */
  adopt(id: number, eta: number): void {
    if (!this.launch || this.launch.id) return;
    this.launch.id = id;
    if (Number.isFinite(eta) && eta > 0) this.launch.eta = eta;
  }

  /** The flight ended. We hold on the fireball rather than cutting instantly. */
  finish(outcome: MissileCamOutcome, x: number, y: number, z: number): void {
    if (!this.launch || this.outcome) return;
    this.outcome = outcome;
    this.holding = HOLD_AFTER_IMPACT;
    this.impactAt.set(x, y, z);
  }

  close(): void {
    if (!this.launch) return;
    this.launch = null;
    this.root.style.display = 'none';
    this.onClose?.();
  }

  /**
   * Advance the cam and return the pose to render from, or null when it is done.
   * `live` is the missile's real position if it still exists; without one the
   * cam falls back to the arc it was told about at launch, so the shot survives
   * the gap between pressing the button and the first snapshot arriving.
   */
  update(dt: number, live: THREE.Vector3 | null): MissileCamPose | null {
    const L = this.launch;
    if (!L) return null;
    this.elapsed += dt;

    if (this.outcome) {
      this.holding -= dt;
      this.paint(null);
      if (this.holding <= 0) { this.close(); return null; }
      // Hold wide on the impact so the fireball and the crater both read.
      const eye = new THREE.Vector3(this.impactAt.x, this.impactAt.y, this.impactAt.z)
        .add(new THREE.Vector3(
          Math.cos(this.elapsed * 0.25) * (18 + L.radius * 1.6), 11 + L.radius,
          Math.sin(this.elapsed * 0.25) * (18 + L.radius * 1.6)));
      return { eye, look: this.impactAt.clone(), fov: 62 };
    }

    // Progress along the planned flight. The live position is authoritative for
    // WHERE the missile is; the clock is what drives the framing phases.
    const progress = L.eta > 0 ? Math.max(0, Math.min(1, this.elapsed / L.eta)) : 1;
    let pos: THREE.Vector3;
    let dir: THREE.Vector3;
    if (live) {
      this.lost = 0;
      pos = live.clone();
      // Direction from movement when we have history, from the arc otherwise.
      if (this.haveLast && pos.distanceToSquared(this.last) > 1e-4) {
        dir = pos.clone().sub(this.last).normalize();
      } else {
        dir = arcPose(L.from, L.to, progress).dir;
      }
      this.last.copy(pos);
      this.haveLast = true;
    } else {
      this.lost += dt;
      // A missile that never appears (rejected, intercepted before we saw it, or
      // simply out of our snapshot stream) must not strand the camera.
      if (this.lost > LOST_GRACE && progress >= 1) { this.close(); return null; }
      if (this.lost > 4 && !this.haveLast) { this.close(); return null; }
      const a = arcPose(L.from, L.to, progress);
      pos = a.pos;
      dir = a.dir;
    }

    this.paint(pos);

    const impact = new THREE.Vector3(L.to.x, L.to.y, L.to.z);
    // A lateral axis that is stable under a near-vertical climb.
    const side = new THREE.Vector3(dir.z, 0, -dir.x);
    if (side.lengthSq() < 1e-4) side.set(1, 0, 0);
    side.normalize();

    if (progress < 0.12) {
      // OFF THE RAIL: stand back at the silo and watch it climb out.
      const eye = new THREE.Vector3(L.from.x, L.from.y + 5, L.from.z)
        .addScaledVector(side, 16)
        .addScaledVector(dir, -6);
      return { eye, look: pos, fov: 66 };
    }
    if (progress < 0.74) {
      // CRUISE: over the shoulder, with the horizon and the target ahead.
      const eye = pos.clone()
        .addScaledVector(dir, -24)
        .add(new THREE.Vector3(0, 8, 0))
        .addScaledVector(side, 4);
      return { eye, look: pos.clone().addScaledVector(dir, 30), fov: 70 };
    }
    // TERMINAL: swing alongside so the dive onto the target is the shot.
    const eye = pos.clone()
      .addScaledVector(side, 15 + L.radius)
      .add(new THREE.Vector3(0, 7 + L.radius * 0.5, 0))
      .addScaledVector(dir, -8);
    return { eye, look: impact.clone().lerp(pos, 0.45), fov: 64 };
  }

  /** Repaint the readouts. Cheap enough to run every frame. */
  private paint(pos: THREE.Vector3 | null): void {
    const L = this.launch;
    if (!L) return;
    const remaining = Math.max(0, L.eta - this.elapsed);
    const progress = L.eta > 0 ? Math.max(0, Math.min(1, this.elapsed / L.eta)) : 1;
    this.barFill.style.width = `${(this.outcome ? 1 : progress) * 100}%`;

    if (this.outcome) {
      const text: Record<MissileCamOutcome, string> = {
        impact: `${iconSvg('disc')} IMPACT`,
        intercepted: `${iconSvg('shield')} INTERCEPTED`,
        shot: `${iconSvg('close')} SHOT DOWN`,
        expired: '… LOST',
      };
      this.statusEl.innerHTML = text[this.outcome];
      this.statusEl.style.color = this.outcome === 'impact' ? '#ff8a4a' : '#9ff0ff';
    } else {
      this.statusEl.innerHTML = progress < 0.12 ? `${iconSvg('triangleUp')} BOOST`
        : progress < 0.74 ? `${iconSvg('triangleRight')} CRUISE`
        : `${iconSvg('triangleDown')} TERMINAL`;
      this.statusEl.style.color = L.accent;
    }

    const groundLeft = pos
      ? Math.hypot(L.to.x - pos.x, L.to.z - pos.z)
      : Math.hypot(L.to.x - L.from.x, L.to.z - L.from.z) * (1 - progress);
    const cell = (k: string, v: string): string =>
      `<span><span style="color:#63758f">${k}</span> ${v}</span>`;
    this.readoutEl.innerHTML =
      cell('TARGET', this.escape(L.label)) +
      cell('IMPACT', `${Math.round(L.to.x)}, ${Math.round(L.to.z)}`) +
      cell('RANGE', `${Math.round(groundLeft)} b`) +
      cell('ALT', `${pos ? Math.round(pos.y) : '—'} b`) +
      cell('ETA', this.outcome ? '—' : `${remaining.toFixed(1)}s`) +
      cell('BLAST', `${L.radius} b`);
  }

  private escape(s: string): string {
    return s.replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] ?? c));
  }
}
