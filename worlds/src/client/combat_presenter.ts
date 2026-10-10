import type { Camera } from 'three';
import type { GameAudio } from '../audio';
import { DamageNumbers, KillBanner } from '../pvp_feedback';

interface CombatFrame {
  health: number; maxHealth: number; spectating: boolean; heartbeat: boolean;
  x: number; z: number; yaw: number; time: number;
}
interface Arc { el: HTMLDivElement; x: number; z: number; t: number }
const HITMARKER_TIME = .4, ARC_TIME = 1.6;

/** Combat DOM/timers. Authoritative hit decisions, particles and camera shake stay with the client. */
export class CombatPresenter {
  readonly numbers: DamageNumbers;
  readonly banner: KillBanner;
  private readonly marker = document.createElement('div');
  private readonly ticks: HTMLDivElement[] = [];
  private readonly chip = document.createElement('div');
  private readonly arcsEl = document.createElement('div');
  private readonly arcs: Arc[] = [];
  private readonly vignette = document.getElementById('hurt-vignette') as HTMLDivElement;
  private markerT = 0;
  private markerKill = false;
  private chipT = 0;
  private pulse = 0;
  private heartbeatT = 0;

  constructor(app: HTMLElement, private readonly audio: Pick<GameAudio, 'hitmarker' | 'heartbeat'>,
    private readonly comfort: { readonly reducedMotion: boolean; readonly photosensitivitySafe: boolean }) {
    this.marker.style.cssText = 'position:absolute;left:50%;top:50%;width:34px;height:34px;margin:-17px 0 0 -17px;z-index:11;pointer-events:none;opacity:0;';
    for (const [x, y, rot] of [['left:1px', 'top:1px', 45], ['right:1px', 'top:1px', -45],
      ['left:1px', 'bottom:1px', -45], ['right:1px', 'bottom:1px', 45]] as [string, string, number][]) {
      const tick = document.createElement('div');
      tick.style.cssText = `position:absolute;${x};${y};width:11px;height:2px;background:#fff;transform:rotate(${rot}deg);box-shadow:0 0 2px rgba(0,0,0,0.9);`;
      this.marker.append(tick); this.ticks.push(tick);
    }
    const slam = document.createElement('div'); slam.className = 'pvp-slam'; slam.setAttribute('role', 'status');
    this.chip.className = 'pvp-killchip';
    this.arcsEl.style.cssText = 'position:absolute;left:50%;top:50%;width:300px;height:300px;margin:-150px 0 0 -150px;z-index:11;pointer-events:none;';
    app.append(this.marker, slam, this.chip, this.arcsEl);
    this.numbers = new DamageNumbers(app); this.banner = new KillBanner(slam);
    this.reset();
  }
  hit(amount: number, killed: boolean, silent = false): void {
    this.markerT = HITMARKER_TIME; this.markerKill = killed;
    const color = killed ? '#ff5555' : amount > 0 ? '#ffffff' : '#9fb4c7';
    for (const tick of this.ticks) {
      tick.style.background = color; tick.style.width = killed ? '16px' : '11px';
      tick.style.boxShadow = killed ? '0 0 6px rgba(255,60,80,.9), 0 0 2px rgba(0,0,0,.9)' : '0 0 2px rgba(0,0,0,0.9)';
    }
    if (!silent) this.audio.hitmarker(killed, amount <= 0);
  }
  eliminated(victim: string): void {
    this.chip.textContent = `✖ ELIMINATED ${victim}`; this.chip.classList.remove('visible');
    void this.chip.offsetWidth; this.chip.style.opacity = '1'; this.chip.classList.add('visible'); this.chipT = 2.2;
  }
  hurt(bite: number): void { this.pulse = Math.min(1, Math.max(this.pulse, .34 + bite / 13)); }
  fullPulse(): void { this.pulse = 1; }
  clearHurt(): void { this.pulse = 0; this.vignette.style.opacity = '0'; }
  damageFrom(x: number, z: number): void {
    for (const arc of this.arcs) if (Math.hypot(arc.x - x, arc.z - z) < 4) { arc.x = x; arc.z = z; arc.t = ARC_TIME; return; }
    if (this.arcs.length >= 4) this.arcs.shift()?.el.remove();
    const el = document.createElement('div'); el.style.cssText = 'position:absolute;inset:0;';
    const wedge = document.createElement('div');
    wedge.style.cssText = 'position:absolute;left:50%;top:6px;width:74px;height:26px;margin-left:-37px;background:linear-gradient(to bottom,rgba(255,52,52,0.95),rgba(255,52,52,0));clip-path:polygon(50% 0,100% 100%,0 100%);';
    el.append(wedge); this.arcsEl.append(el); this.arcs.push({ el, x, z, t: ARC_TIME });
  }
  setVisible(visible: boolean): void { this.marker.style.display = this.arcsEl.style.display = visible ? '' : 'none'; }
  update(dt: number, f: CombatFrame): void {
    this.markerT = Math.max(0, this.markerT - dt);
    if (this.markerT > 0) {
      const k = this.markerT / HITMARKER_TIME;
      this.marker.style.opacity = String(Math.min(1, k * 2.2));
      const scale = (this.markerKill ? 1.75 : 1.35) - .35 * Math.min(1, k * 1.6), spin = this.markerKill ? k * 26 : 0;
      this.marker.style.transform = `rotate(${spin.toFixed(1)}deg) scale(${scale.toFixed(3)})`;
    } else this.marker.style.opacity = '0';
    if (this.chipT > 0) {
      this.chipT = Math.max(0, this.chipT - dt);
      if (!this.chipT) this.chip.classList.remove('visible'); else this.chip.style.opacity = String(Math.min(1, this.chipT / .45));
    }
    this.banner.update(dt); this.pulse = Math.max(0, this.pulse - dt * 2.4);
    const frac = f.maxHealth > 0 ? f.health / f.maxHealth : 1;
    const critical = !f.spectating && frac < .32 ? (1 - frac / .32) * (this.comfort.reducedMotion ? .3 : .24 + Math.sin(f.time * 5.4) * .07) : 0;
    this.vignette.style.opacity = String(Math.min(this.comfort.photosensitivitySafe ? .24 : .62, this.pulse * .62 + critical));
    if (critical > 0 && f.heartbeat) {
      const urgency = Math.min(1, 1 - frac / .32); this.heartbeatT -= dt;
      if (this.heartbeatT <= 0) { this.audio.heartbeat(urgency); this.heartbeatT = 1.15 - urgency * .45; }
    } else this.heartbeatT = 0;
    const fx = -Math.sin(f.yaw), fz = -Math.cos(f.yaw), rx = Math.cos(f.yaw), rz = -Math.sin(f.yaw);
    for (let i = this.arcs.length - 1; i >= 0; i--) {
      const arc = this.arcs[i]; arc.t -= dt;
      if (arc.t <= 0) { arc.el.remove(); this.arcs.splice(i, 1); continue; }
      const dx = arc.x - f.x, dz = arc.z - f.z;
      arc.el.style.transform = `rotate(${Math.atan2(dx * rx + dz * rz, dx * fx + dz * fz)}rad)`;
      arc.el.style.opacity = String(Math.min(1, arc.t / (ARC_TIME * .6)));
    }
  }
  updateNumbers(dt: number, camera: Camera): void { this.numbers.update(dt, camera); }
  reset(): void {
    this.markerT = this.chipT = this.heartbeatT = 0; this.markerKill = false;
    this.marker.style.opacity = '0'; this.marker.style.transform = ''; this.chip.classList.remove('visible');
    for (const arc of this.arcs) arc.el.remove(); this.arcs.length = 0;
    this.numbers.clear(); this.banner.clear(); this.clearHurt(); this.setVisible(false);
  }
}
