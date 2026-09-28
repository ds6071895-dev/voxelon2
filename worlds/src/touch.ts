// Touch controls write the same input fields as keyboard/mouse gameplay.
import { Input } from './input';
import { iconSvg } from './emoji_icons';
import './styles/touch.css';

export function isTouchDevice(): boolean {
  return typeof window !== 'undefined' &&
    (window.matchMedia?.('(pointer: coarse)').matches || (navigator.maxTouchPoints ?? 0) > 1);
}

export interface TouchState {
  shown: boolean;
  playing: boolean;
  gun: boolean;
  /** Contextual primary action: gun, melee, bow, building or item use. */
  action?: 'attack' | 'use' | 'build' | 'interact' | 'none';
  label?: string;
  retry?: boolean;
  /** Changing a slot or mode must release actions held for the old item. */
  context?: string;
}

const LOOK_SENS = 2.3;
const TAP_SLOP = 14;

export class TouchControls {
  private root = document.createElement('div');
  private pads = document.createElement('div');
  private knob = document.createElement('div');
  private primary: HTMLButtonElement;
  private secondary: HTMLButtonElement;
  private aim: HTMLButtonElement;
  private reload: HTMLButtonElement;
  private sneak: HTMLButtonElement;
  private retry: HTMLButtonElement;
  private state: TouchState = { shown: false, playing: false, gun: false };
  private resets: (() => void)[] = [];
  private actionResets: (() => void)[] = [];
  private aimOn = false;
  private stickId = -1;
  private lookId = -1;
  private lookX = 0;
  private lookY = 0;
  private lookDist = 0;
  private lookStart = 0;
  private holdTimer = 0;
  private attackSources = new Set<string>();
  private useSources = new Set<string>();

  constructor(private input: Input, cb: { onPause(): void }) {
    input.touchMode = true;
    document.documentElement.classList.add('touch-ui');
    this.root.id = 'touch';
    this.root.hidden = true;
    document.getElementById('app')!.appendChild(this.root);
    this.pads.className = 't-pads';
    this.root.appendChild(this.pads);
    const look = document.createElement('div');
    look.className = 't-look';
    this.pads.appendChild(look);
    look.addEventListener('pointerdown', e => {
      if (!this.state.playing || e.pointerType !== 'touch' || this.lookId >= 0) return;
      this.lookId = e.pointerId;
      look.setPointerCapture(e.pointerId);
      this.lookX = e.clientX; this.lookY = e.clientY;
      this.lookDist = 0; this.lookStart = performance.now();
      this.holdTimer = window.setTimeout(() => {
        if (this.lookId === e.pointerId && this.lookDist < TAP_SLOP && this.state.playing)
          this.press('look', false, true);
      }, 320);
      e.preventDefault();
    });
    look.addEventListener('pointermove', e => {
      if (e.pointerId !== this.lookId) return;
      this.dragLook(e.clientX - this.lookX, e.clientY - this.lookY);
      this.lookDist += Math.abs(e.clientX - this.lookX) + Math.abs(e.clientY - this.lookY);
      this.lookX = e.clientX; this.lookY = e.clientY;
      e.preventDefault();
    });
    const lookEnd = (e: PointerEvent) => {
      if (e.pointerId !== this.lookId) return;
      if (e.type === 'pointerup' && !this.attackSources.has('look') &&
          performance.now() - this.lookStart < 260 && this.lookDist < TAP_SLOP)
        input.rightClicked = true;
      this.lookId = -1;
      clearTimeout(this.holdTimer);
      this.press('look', false, false);
    };
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) look.addEventListener(type, lookEnd as EventListener);

    const stick = document.createElement('div');
    stick.className = 't-stick';
    stick.setAttribute('aria-label', 'Move; push to the rim to sprint');
    this.knob.className = 't-knob';
    stick.appendChild(this.knob);
    this.pads.appendChild(stick);
    const move = (e: PointerEvent) => {
      const r = stick.getBoundingClientRect(), radius = r.width / 2;
      let dx = (e.clientX - r.left - radius) / radius, dy = (e.clientY - r.top - radius) / radius;
      const mag = Math.hypot(dx, dy), scale = mag > 1 ? 1 / mag : 1;
      this.knob.style.transform = `translate(${dx * scale * radius * .65}px, ${dy * scale * radius * .65}px)`;
      if (mag < .22) { this.clearMove(); return; }
      dx /= mag; dy /= mag;
      input.tForward = dy < -.38; input.tBack = dy > .38;
      input.tLeft = dx < -.38; input.tRight = dx > .38;
      input.tSprint = input.tForward && mag >= .9;
    };
    stick.addEventListener('pointerdown', e => {
      if (!this.state.playing || e.pointerType !== 'touch' || this.stickId >= 0) return;
      this.stickId = e.pointerId; stick.setPointerCapture(e.pointerId); move(e); e.preventDefault();
    });
    stick.addEventListener('pointermove', e => { if (e.pointerId === this.stickId) { move(e); e.preventDefault(); } });
    const stickEnd = (e: PointerEvent) => {
      if (e.pointerId !== this.stickId) return;
      this.stickId = -1; this.clearMove(); this.knob.style.transform = '';
    };
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) stick.addEventListener(type, stickEnd as EventListener);

    const jump = this.button('t-jump', iconSvg('chevronUp'), 'Jump / swim up');
    this.hold(jump, down => { input.tJump = down; });
    this.sneak = this.button('t-sneak', iconSvg('chevronDown'), 'Sneak');
    this.tap(this.sneak, () => {
      input.tSneak = !input.tSneak;
      this.sneak.classList.toggle('t-on', input.tSneak);
      this.sneak.setAttribute('aria-pressed', String(input.tSneak));
    });
    this.primary = this.button('t-primary', 'FIRE', 'Fire');
    this.hold(this.primary, down => this.press('primary', this.state.action === 'use' || this.state.action === 'build' || this.state.action === 'interact', down), true);
    this.secondary = this.button('t-secondary', 'BREAK', 'Break block');
    this.hold(this.secondary, down => this.press('secondary', false, down), true);
    this.aim = this.button('t-aim', 'AIM', 'Aim down sights');
    this.tap(this.aim, () => this.setAim(!this.aimOn));
    this.reload = this.button('t-reload', 'R', 'Reload');
    this.tap(this.reload, () => { input.reloadPressed = true; });
    this.retry = this.button('t-retry', 'RETRY', 'Return to checkpoint');
    this.tap(this.retry, () => { input.reloadPressed = true; });
    const pause = this.button('t-pause', iconSvg('pause'), 'Pause', this.root);
    this.tap(pause, cb.onPause, false);

    const hotbar = document.getElementById('hotbar')!;
    let hotbarTouch: { id: number; slot: number; x: number; y: number } | null = null;
    hotbar.addEventListener('pointerdown', e => {
      if (!this.state.playing || e.pointerType !== 'touch') return;
      const slot = (e.target as HTMLElement).closest<HTMLElement>('.slot');
      if (slot) hotbarTouch = { id: e.pointerId, slot: Number(slot.dataset.slot), x: e.clientX, y: e.clientY };
      e.stopPropagation();
    });
    hotbar.addEventListener('pointerup', e => {
      if (hotbarTouch?.id !== e.pointerId) return;
      if (this.state.playing && Math.hypot(e.clientX - hotbarTouch.x, e.clientY - hotbarTouch.y) < 12)
        input.hotbarKey = hotbarTouch.slot;
      hotbarTouch = null;
    });
    hotbar.addEventListener('pointercancel', () => { hotbarTouch = null; });
    window.addEventListener('blur', () => { this.reset(); if (input.locked) input.unlock(); });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) { this.reset(); if (input.locked) input.unlock(); }
    });
  }

  update(s: TouchState): void {
    if (this.state.playing && !s.playing) this.reset();
    else if (this.state.context !== s.context || this.state.action !== s.action || this.state.gun !== s.gun) this.resetActions();
    this.state = s;
    this.root.hidden = !s.shown;
    this.pads.hidden = !s.playing;
    this.primary.hidden = !s.gun && (!s.action || s.action === 'none');
    this.primary.textContent = s.gun ? 'FIRE' : s.label ?? (s.action === 'build' ? 'PLACE' : s.action === 'use' ? 'USE' : 'HIT');
    this.primary.setAttribute('aria-label', this.primary.textContent);
    this.secondary.hidden = s.action !== 'build' && s.action !== 'interact';
    this.secondary.textContent = s.action === 'interact' ? 'HIT' : 'BREAK';
    this.secondary.setAttribute('aria-label', s.action === 'interact' ? 'Catch rat' : 'Break block');
    this.aim.hidden = this.reload.hidden = !s.gun;
    this.retry.hidden = !s.retry;
  }

  private dragLook(dx: number, dy: number): void {
    this.input.mouseDX += dx * LOOK_SENS * this.input.lookSensitivity;
    this.input.mouseDY += dy * LOOK_SENS * this.input.lookSensitivity;
  }
  private press(source: string, use: boolean, down: boolean): void {
    const sources = use ? this.useSources : this.attackSources;
    if (down) {
      sources.add(source);
      if (use) this.input.rightClicked = true; else this.input.leftClicked = true;
    } else sources.delete(source);
    this.input.leftDown = this.attackSources.size > 0;
    this.input.rightDown = this.aimOn || this.useSources.size > 0;
  }
  private setAim(on: boolean): void {
    this.aimOn = on;
    this.input.rightDown = on || this.useSources.size > 0;
    this.aim.classList.toggle('t-on', on);
    this.aim.setAttribute('aria-pressed', String(on));
  }
  private clearMove(): void {
    this.input.tForward = this.input.tBack = this.input.tLeft = this.input.tRight = this.input.tSprint = false;
  }
  private resetActions(): void {
    this.actionResets.forEach(fn => fn());
    this.attackSources.clear(); this.useSources.clear();
    this.input.leftDown = this.input.leftClicked = this.input.rightClicked = false;
    this.setAim(false);
    clearTimeout(this.holdTimer);
  }
  private reset(): void {
    this.resets.forEach(fn => fn());
    this.resetActions();
    this.attackSources.clear(); this.useSources.clear();
    this.clearMove(); this.input.tJump = this.input.tSneak = false;
    this.input.leftDown = this.input.leftClicked = this.input.rightClicked = false;
    this.input.mouseDX = this.input.mouseDY = 0;
    this.setAim(false);
    this.sneak.classList.remove('t-on'); this.sneak.setAttribute('aria-pressed', 'false');
    this.stickId = this.lookId = -1;
    this.knob.style.transform = '';
    clearTimeout(this.holdTimer);
  }
  private button(cls: string, text: string, label: string, parent = this.pads): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button'; b.className = `t-btn ${cls}`; b.innerHTML = text;
    b.setAttribute('aria-label', label); parent.appendChild(b); return b;
  }
  private tap(b: HTMLElement, fn: () => void, playing = true): void {
    b.addEventListener('pointerdown', e => {
      if (playing && !this.state.playing) return;
      fn(); e.preventDefault(); e.stopPropagation();
    });
  }
  private hold(b: HTMLElement, fn: (down: boolean) => void, look = false): void {
    let id = -1, x = 0, y = 0;
    const release = () => { id = -1; b.classList.remove('t-on'); fn(false); };
    (look ? this.actionResets : this.resets).push(release);
    b.addEventListener('pointerdown', e => {
      if (!this.state.playing || e.pointerType !== 'touch' || id >= 0) return;
      id = e.pointerId; x = e.clientX; y = e.clientY;
      b.setPointerCapture(id); b.classList.add('t-on'); fn(true);
      e.preventDefault(); e.stopPropagation();
    });
    b.addEventListener('pointermove', e => {
      if (e.pointerId !== id || !look) return;
      this.dragLook(e.clientX - x, e.clientY - y); x = e.clientX; y = e.clientY;
      e.preventDefault();
    });
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) b.addEventListener(type, e => {
      if ((e as PointerEvent).pointerId === id) release();
    });
  }
}
