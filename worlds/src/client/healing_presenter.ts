import type { GameAudio } from '../audio';
import type { Particles } from '../particles';

interface HealFrame { active: boolean; progress: number; remaining: number; name: string; x: number; y: number; z: number; time: number }

/** Timed medkit/Bridge refill presentation; healing authority remains in main/net. */
export class HealingPresenter {
  private readonly bar = document.getElementById('use-bar') as HTMLDivElement;
  private readonly fill = this.bar.querySelector('.use-fill') as HTMLDivElement;
  private readonly label = this.bar.querySelector('.use-label') as HTMLDivElement;
  private readonly glowEl = document.getElementById('heal-glow') as HTMLDivElement;
  private readonly hearts = document.getElementById('hearts') as HTMLCanvasElement;
  private readonly tallyEl = document.getElementById('heal-tally') as HTMLDivElement;
  private readonly burst = document.getElementById('heal-burst') as HTMLDivElement;
  private glow = 0;
  private buff = 0;
  private squeeze = 0;
  private beatCount = 0;
  private tally = 0;
  private tallyFade = 0;
  private tickStep = 0;
  private spiralT = 0;
  private pulseT = 0;
  private doneT = 0;

  constructor(private readonly audio: Pick<GameAudio, 'healStart' | 'healCancel' | 'heal' | 'healBeat' | 'healPulse' | 'healTick'>,
    private readonly particles: Particles,
    private readonly comfort: { readonly reducedMotion: boolean; readonly photosensitivitySafe: boolean }) { this.reset(); }
  private renderTally(): void {
    if (this.tally <= 0) { this.tallyEl.dataset.show = ''; return; }
    this.tallyEl.dataset.show = '1'; this.tallyEl.textContent = `+${this.tally}`;
    this.tallyEl.classList.remove('bump'); void this.tallyEl.offsetWidth; this.tallyEl.classList.add('bump');
  }
  begin(): void { this.beatCount = 0; this.doneT = 0; this.audio.healStart(); this.bar.classList.remove('done'); }
  cancel(): void { this.audio.healCancel(); }
  beat(x: number, y: number, z: number): void {
    this.audio.healBeat(this.beatCount++); this.particles.heal(x, y + 1.1, z, 5);
    this.bar.classList.remove('beat'); void this.bar.offsetWidth; this.bar.classList.add('beat');
  }
  private flash(): void {
    if (this.comfort.photosensitivitySafe) return;
    this.burst.classList.remove('go'); void this.burst.offsetWidth; this.burst.classList.add('go');
  }
  finish(duration: number): void {
    this.audio.heal(); this.buff = duration; this.tally = this.tickStep = this.tallyFade = 0;
    this.glow = 1; this.squeeze = .3; this.doneT = .42; this.bar.classList.add('done');
    this.flash(); this.spiralT = 0; this.pulseT = .9;
  }
  refill(gain: number): void {
    this.glow = 1; this.squeeze = .6;
    if (gain > 0) { this.tally = gain; this.tallyFade = 0; this.renderTally(); }
    this.flash();
  }
  restored(amount: number, x: number, y: number, z: number): void {
    if (this.buff <= 0 || amount <= 0) return;
    this.tally += amount; this.renderTally(); this.audio.healTick(this.tickStep++);
    this.glow = Math.min(1, this.glow + .22); this.squeeze = .16; this.particles.heal(x, y + 1, z, 4);
  }
  update(dt: number, f: HealFrame): void {
    this.doneT = Math.max(0, this.doneT - dt);
    if (f.active) {
      this.bar.style.display = 'block'; this.fill.style.width = `${(f.progress * 100).toFixed(1)}%`;
      this.label.textContent = `${f.name.toUpperCase()} · ${Math.max(0, f.remaining).toFixed(1)}s`;
    } else if (this.doneT > 0) {
      this.fill.style.width = '100%'; this.label.textContent = 'STIM IN — REGENERATING';
    } else if (this.bar.style.display !== 'none') { this.bar.style.display = 'none'; this.bar.classList.remove('done'); }
    if (this.buff > 0) {
      this.spiralT -= dt;
      if (this.spiralT <= 0) { this.spiralT = .09; this.particles.healSpiral(f.x, f.y + .15, f.z, f.time * 5.5); }
      this.pulseT -= dt;
      if (this.pulseT <= 0) { this.pulseT = .95 + (1 - this.buff / 8) * .5; this.audio.healPulse(1 - this.buff / 8); }
    }
    if (this.buff <= 0 && this.tally > 0) {
      this.tallyFade += dt; if (this.tallyFade > 1.4) { this.tally = 0; this.tallyEl.dataset.show = ''; }
    }
    if (this.buff > 0) {
      this.buff = Math.max(0, this.buff - dt);
      const breathe = this.comfort.reducedMotion ? .5 : .5 + Math.sin(f.time * 3.2) * .18;
      this.glow = Math.max(this.glow - dt * 1.6, .26 * breathe);
    } else this.glow = Math.max(0, this.glow - dt * 1.8);
    // Idle most of the time: skip style writes that would not change anything.
    const glow = String(Math.min(this.comfort.photosensitivitySafe ? .22 : .5, this.glow * .55));
    if (this.glowEl.style.opacity !== glow) this.glowEl.style.opacity = glow;
    this.squeeze = Math.max(0, this.squeeze - dt);
    const squeeze = this.squeeze > 0 && !this.comfort.reducedMotion ? 'scale(1.14)' : 'scale(1)';
    if (this.hearts.style.transform !== squeeze) this.hearts.style.transform = squeeze;
  }
  reset(): void {
    this.glow = this.buff = this.squeeze = this.beatCount = this.tally = this.tallyFade = this.tickStep = this.spiralT = this.pulseT = this.doneT = 0;
    this.bar.style.display = 'none'; this.bar.classList.remove('beat', 'done'); this.fill.style.width = '0%';
    this.glowEl.style.opacity = '0'; this.hearts.style.transform = 'scale(1)';
    this.tallyEl.dataset.show = ''; this.tallyEl.classList.remove('bump'); this.burst.classList.remove('go');
  }
}
