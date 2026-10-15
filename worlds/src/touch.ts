// Touch controls write the same input fields as keyboard/mouse gameplay.
import { Input } from './input';
import { iconSvg } from './emoji_icons';
import './styles/touch.css';

/** Any touchscreen, including touch laptops and tablets with a trackpad. */
export function isTouchDevice(): boolean {
  return typeof window !== 'undefined' &&
    (window.matchMedia?.('(pointer: coarse)').matches || (navigator.maxTouchPoints ?? 0) > 1);
}

/** Touch is the main way in: a phone or tablet with no mouse or trackpad.
 *  A touch laptop reports a fine pointer as well and starts on the mouse. */
export function prefersTouch(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(pointer: coarse)').matches && !window.matchMedia('(any-pointer: fine)').matches;
}

export interface TouchState {
  shown: boolean;
  playing: boolean;
  gun: boolean;
  /** Contextual primary action: gun, melee, bow, building or item use. */
  action?: 'attack' | 'use' | 'build' | 'interact' | 'none';
  label?: string;
  /** Changing a slot or mode must release actions held for the old item. */
  context?: string;
  /** Dead or eliminated: fly and look around, with no action buttons. */
  spectating?: boolean;
}

const LOOK_SENS = 2.3;
const TAP_SLOP = 14;
/** A thumb resting still on the world this long starts a melee swing or a
 *  block break. Guns and bows never fire this way: they have their own button. */
const HOLD_ATTACK_MS = 380;

export class TouchControls {
  private root = document.createElement('div');
  private pads = document.createElement('div');
  private knob = document.createElement('div');
  private stick!: HTMLElement;
  private primary: HTMLButtonElement;
  private secondary: HTMLButtonElement;
  private aim: HTMLButtonElement;
  private reload: HTMLButtonElement;
  private sneak: HTMLButtonElement;
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
      if (this.holdAttacks()) this.holdTimer = window.setTimeout(() => {
        if (this.lookId === e.pointerId && this.lookDist < TAP_SLOP && this.state.playing && this.holdAttacks())
          this.press('look', false, true);
      }, HOLD_ATTACK_MS);
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
      if (e.type === 'pointerup' && !this.attackSources.has('look') && !this.state.spectating &&
          performance.now() - this.lookStart < 260 && this.lookDist < TAP_SLOP)
        input.rightClicked = true;
      this.lookId = -1;
      clearTimeout(this.holdTimer);
      this.press('look', false, false);
    };
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) look.addEventListener(type, lookEnd as EventListener);

    // The stick rests bottom-left. A touch on it drags it in place; a touch
    // anywhere else in the left zone moves the stick under the thumb first, so
    // nobody has to find a fixed circle without looking.
    const zone = document.createElement('div');
    zone.className = 't-stick-zone';
    this.pads.appendChild(zone);
    const stick = document.createElement('div');
    stick.className = 't-stick';
    stick.setAttribute('aria-label', 'Move; push to the rim to sprint');
    this.knob.className = 't-knob';
    stick.appendChild(this.knob);
    this.pads.appendChild(stick);
    this.stick = stick;
    let cx = 0, cy = 0, radius = 1;
    const move = (e: PointerEvent) => {
      let dx = (e.clientX - cx) / radius, dy = (e.clientY - cy) / radius;
      const mag = Math.hypot(dx, dy), scale = mag > 1 ? 1 / mag : 1;
      this.knob.style.transform = `translate(${dx * scale * radius * .65}px, ${dy * scale * radius * .65}px)`;
      if (mag < .22) { this.clearMove(); return; }
      dx /= mag; dy /= mag;
      // Analog: full speed from 75% deflection, easing down to a slow walk.
      const amount = Math.min(1, .35 + .65 * (Math.min(mag, .75) - .22) / (.75 - .22));
      input.moveX = dx * amount; input.moveY = -dy * amount;
      input.tForward = dy < -.38; input.tBack = dy > .38;
      input.tLeft = dx < -.38; input.tRight = dx > .38;
      input.tSprint = input.tForward && mag >= .9;
    };
    const begin = (e: PointerEvent, el: HTMLElement) => {
      if (!this.state.playing || e.pointerType !== 'touch' || this.stickId >= 0) return;
      const r = stick.getBoundingClientRect();
      radius = r.width / 2;
      cx = r.left + radius; cy = r.top + radius;
      if (Math.hypot(e.clientX - cx, e.clientY - cy) > radius * 1.1) {
        // Float: centre the stick on the thumb, kept fully on screen.
        const zr = zone.getBoundingClientRect();
        cx = Math.max(zr.left + radius, Math.min(zr.right - radius, e.clientX));
        cy = Math.max(zr.top + radius, Math.min(zr.bottom - radius, e.clientY));
        stick.style.left = `${cx - radius}px`; stick.style.top = `${cy - radius}px`;
        stick.style.bottom = 'auto';
        stick.classList.add('t-float');
      }
      this.stickId = e.pointerId; el.setPointerCapture(e.pointerId); move(e); e.preventDefault();
    };
    for (const el of [zone, stick]) {
      el.addEventListener('pointerdown', e => begin(e, el));
      el.addEventListener('pointermove', e => { if (e.pointerId === this.stickId) { move(e); e.preventDefault(); } });
      for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'])
        el.addEventListener(type, e => { if ((e as PointerEvent).pointerId === this.stickId) this.releaseStick(); });
    }

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
    this.primary.hidden = !!s.spectating || (!s.gun && (!s.action || s.action === 'none'));
    this.primary.textContent = s.gun ? 'FIRE' : s.label ?? (s.action === 'build' ? 'PLACE' : s.action === 'use' ? 'USE' : 'HIT');
    this.primary.setAttribute('aria-label', this.primary.textContent);
    this.secondary.hidden = !!s.spectating || (s.action !== 'build' && s.action !== 'interact');
    this.secondary.textContent = s.action === 'interact' ? 'HIT' : 'BREAK';
    this.secondary.setAttribute('aria-label', s.action === 'interact' ? 'Hit or break target' : 'Break block');
    this.aim.hidden = this.reload.hidden = !s.gun || !!s.spectating;
  }

  private holdAttacks(): boolean {
    const { action, gun, spectating } = this.state;
    return !gun && !spectating && (action === 'attack' || action === 'interact' || action === 'build');
  }

  private dragLook(dx: number, dy: number): void {
    this.input.mouseDX += dx * LOOK_SENS * this.input.lookSensitivity;
    this.input.mouseDY += dy * LOOK_SENS * this.input.lookSensitivity * (this.input.invertY ? -1 : 1);
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
    this.input.moveX = this.input.moveY = 0;
  }
  private releaseStick(): void {
    this.stickId = -1; this.clearMove(); this.knob.style.transform = '';
    this.stick.style.left = this.stick.style.top = this.stick.style.bottom = '';
    this.stick.classList.remove('t-float');
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
    this.releaseStick();
    this.lookId = -1;
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
