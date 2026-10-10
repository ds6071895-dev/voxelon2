import type { Input } from '../input';

export type Screen = 'title' | 'playing' | 'paused' | 'results';
interface Overlay {
  readonly open: boolean;
  hide(): void;
}

/** Owns cursor eligibility and nested pause sheets. Physics continues in the coordinator. */
export class Screens {
  state: Screen = 'title';
  titleSettingsOpen = false;
  transitioning = false;
  private readonly overlays: Overlay[] = [];
  private readonly eyebrow: HTMLElement;
  private readonly title: HTMLElement;
  private readonly hint: HTMLElement;
  private readonly resume: HTMLElement;
  private readonly quit: HTMLElement;

  constructor(private readonly input: Input, private readonly pause: HTMLElement,
    private readonly suspendActions: () => void) {
    this.eyebrow = pause.querySelector<HTMLElement>('.pause-eyebrow')!;
    this.title = pause.querySelector<HTMLElement>('h1')!;
    this.hint = pause.querySelector<HTMLElement>('.pause-hint')!;
    this.resume = document.getElementById('resume-btn')!;
    this.quit = document.getElementById('quit-btn')!;
    this.resume.addEventListener('click', () => {
      if (this.titleSettingsOpen) this.closeTitleSettings(); else this.resumePlay();
    });
    document.addEventListener('pointerlockchange', () => {
      if (this.transitioning) return;
      if (this.state === 'results' || this.state === 'title') { this.restorePause(); return; }
      if (input.locked && !this.panelOpen) this.enterPlaying();
      else if (this.state === 'playing' && !this.panelOpen) this.enterPause();
    });
    document.addEventListener('keydown', e => {
      if (e.code !== 'Escape' || e.defaultPrevented || this.panelOpen) return;
      if (this.titleSettingsOpen) this.closeTitleSettings();
      else if (this.state === 'playing') this.enterPause();
    });
  }

  register(overlay: Overlay): void { this.overlays.push(overlay); }
  get panelOpen(): boolean { return this.overlays.some(panel => panel.open); }
  get shouldHoldPointer(): boolean { return this.state === 'playing' && !this.panelOpen; }

  syncPointerLock(): void {
    if (this.transitioning) return;
    if (this.shouldHoldPointer) {
      if (!this.input.locked && !this.input.lockPending) this.input.lock();
    } else if (this.input.locked || this.input.lockPending) {
      this.suspend();
      this.input.unlock();
    }
  }
  private suspend(): void { this.input.releaseButtons(); this.suspendActions(); }
  private context(title: boolean): void {
    this.titleSettingsOpen = title;
    this.eyebrow.textContent = title ? 'Worlds · settings' : 'Worlds · paused';
    this.title.textContent = title ? 'Settings' : 'Paused';
    this.hint.textContent = title ? 'Changes save on this device straight away.' : 'The match keeps going while you are in here.';
    this.resume.textContent = title ? 'Done' : 'Resume';
    this.quit.style.display = title ? 'none' : '';
  }
  private enterPlaying(): void {
    this.state = 'playing';
    document.body.classList.add('in-game');
    this.pause.style.display = 'none';
  }
  resumePlay(): void { this.enterPlaying(); this.syncPointerLock(); }
  enterPause(): void {
    if (this.state === 'results' || this.state === 'title') return;
    this.context(false);
    this.state = 'paused';
    this.suspend();
    this.input.unlock();
    this.restorePause();
  }
  openTitleSettings(): void {
    if (this.state !== 'title') return;
    this.context(true);
    this.restorePause();
  }
  closeTitleSettings(): void {
    if (!this.titleSettingsOpen) return;
    this.context(false);
    this.pause.style.display = 'none';
  }
  /** Open a child sheet above Pause, then restore its parent on close. */
  showOverlay(show: () => void): void {
    this.pause.style.display = 'none';
    this.suspend();
    show();
    this.syncPointerLock();
  }
  restorePause(): void {
    if (this.transitioning) return;
    this.pause.style.display = (this.state === 'paused' || this.titleSettingsOpen) && !this.panelOpen ? 'flex' : 'none';
    this.syncPointerLock();
  }
  /** Call before closing sheets: editor close callbacks must not reopen their parent. */
  prepareTransition(): void {
    this.transitioning = true;
    this.suspend();
    this.input.unlock();
    for (const overlay of this.overlays) overlay.hide();
    this.context(false);
    this.pause.style.display = 'none';
  }
  enterMatch(): void {
    this.transitioning = false;
    this.resumePlay();
  }
  results(): void {
    this.prepareTransition();
    this.state = 'results';
    this.transitioning = false;
  }
  menu(): void {
    this.prepareTransition();
    this.state = 'title';
    document.body.classList.remove('in-game');
    this.transitioning = false;
  }
}
