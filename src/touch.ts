// On-screen touch controls (phones/tablets). Everything funnels into the SAME
// Input fields the keyboard/mouse write, so gameplay code (player, interact,
// guns, glider, boats…) never special-cases touch:
//
//   · left virtual joystick  — move (8-way); push past the rim to sprint
//   · drag anywhere else     — look around
//   · tap                    — use / place / open (right-click)
//   · long-press (and hold)  — mine / attack / fire (left button held)
//   · JUMP button (hold)     — jump, swim up, deploy/stow glider, hop out of boat
//   · SNEAK toggle           — sneak on/off
//   · gun cluster            — FIRE (hold) / AIM toggle (ADS) / R reload,
//                              shown only while a gun is selected
//   · top-right utility row  — inventory / commands / pause
//   · tap a hotbar slot      — select it
//
// The whole overlay only exists on touch devices (isTouchDevice()).

import { Input } from './input';
import { iconSvg } from './emoji_icons';

export function isTouchDevice(): boolean {
  return typeof window !== 'undefined' &&
    (window.matchMedia?.('(pointer: coarse)').matches ||
      (navigator.maxTouchPoints ?? 0) > 1);
}

/** What main.ts tells the overlay each frame. */
export interface TouchState {
  /** In the game world (not the title screen). Shows the utility row. */
  shown: boolean;
  /** Actively controlling (locked, alive, no menu). Shows the pads. */
  playing: boolean;
  /** A gun is selected — show the FIRE/AIM/RELOAD cluster. */
  gun: boolean;
  /** Riding a helicopter: show a dedicated exit button. */
  vehicle: boolean;
  vehicleLabel: string;
  /** Pilot has a rope control available. */
  rope: boolean;
}

export interface TouchCallbacks {
  /** Utility-row buttons — main.ts routes these through its own toggles. */
  onPause(): void;
  onInventory(): void;
  /** Open the command box (touch devices have no T key). The map, Warfare
   *  Command, waypoints and the guide all live behind /map, /warfare, etc. */
  onChat(): void;
}

const LOOK_SENS = 2.3;      // css px -> mouseDX units (≈ mouse movementX feel)
const TAP_MS = 260;         // max press time for a tap (use/place)
const TAP_SLOP = 14;        // max finger travel (px) for a tap / long-press
const HOLD_MS = 320;        // press-and-hold this long to start mining/attacking
const DEAD = 0.28;          // joystick dead zone (fraction of radius)
const SECTOR = 0.38;        // 8-way threshold (≈ sin 22.5°)

export class TouchControls {
  private readonly input: Input;
  private readonly root: HTMLElement;
  private readonly pads: HTMLElement;    // gameplay zones (joystick, look, buttons)
  private readonly utils: HTMLElement;   // inventory / map / pause row
  private readonly gunBox: HTMLElement;  // FIRE / AIM / RELOAD cluster
  private readonly vehicleBtn: HTMLElement;
  private readonly ropeBtn: HTMLElement;
  private readonly knob: HTMLElement;
  private readonly sneakBtn: HTMLElement;
  private readonly aimBtn: HTMLElement;

  private aimOn = false;
  private wasPlaying = false;

  // Look-drag pointer bookkeeping (one finger; the stick tracks its own).
  private lookId = -1;
  private lookLastX = 0; private lookLastY = 0;
  private lookDist = 0;
  private lookStart = 0;
  private holdTimer = 0;
  private holding = false; // long-press engaged -> leftDown until release

  // Joystick pointer bookkeeping.
  private stickId = -1;

  constructor(input: Input, cb: TouchCallbacks) {
    this.input = input;
    input.touchMode = true;

    const style = document.createElement('style');
    style.textContent = `
      #touch { position:absolute; inset:0; z-index:9; pointer-events:none; overflow:hidden;
               user-select:none; -webkit-user-select:none; -webkit-touch-callout:none; }
      #touch { --edge-l: max(10px, env(safe-area-inset-left));
               --edge-r: max(10px, env(safe-area-inset-right));
               --edge-t: max(8px, env(safe-area-inset-top));
               --edge-b: max(8px, env(safe-area-inset-bottom));
               --stick-size: clamp(112px, 22vw, 150px); }
      #touch * { touch-action:none; }
      .t-look { position:absolute; inset:0; pointer-events:auto; }
      .t-stick { position:absolute; left:calc(var(--edge-l) + 8px); bottom:calc(var(--edge-b) + 72px);
                  width:var(--stick-size); height:var(--stick-size);
                 border-radius:50%; background:rgba(255,255,255,0.06);
                 border:2px solid rgba(255,255,255,0.22); pointer-events:auto; }
      .t-knob { position:absolute; left:50%; top:50%; width:60px; height:60px;
                margin:-30px 0 0 -30px; border-radius:50%;
                background:rgba(255,255,255,0.28); border:2px solid rgba(255,255,255,0.45); }
      .t-btn { position:absolute; pointer-events:auto; display:flex; align-items:center;
               justify-content:center; border-radius:50%;
               background:rgba(16,20,32,0.42); border:2px solid rgba(255,255,255,0.32);
               color:#fff; font:bold 20px 'Lucida Console',Monaco,monospace;
               text-shadow:0 1px 2px rgba(0,0,0,0.6); }
      .t-btn.t-on { background:rgba(110,190,255,0.5); border-color:#bfe6ff; }
      .t-sq { border-radius:10px; }
      .t-jump { right:calc(var(--edge-r) + 8px) !important; bottom:calc(var(--edge-b) + 82px) !important;
                width:clamp(68px,14vw,88px) !important; height:clamp(68px,14vw,88px) !important; }
      .t-sneak { right:calc(var(--edge-r) + clamp(92px,19vw,118px)) !important;
                 bottom:calc(var(--edge-b) + 22px) !important; }
      .t-fire { right:calc(var(--edge-r) + clamp(96px,20vw,126px)) !important;
                bottom:calc(var(--edge-b) + 110px) !important; }
      .t-aim { right:calc(var(--edge-r) + 20px) !important; bottom:calc(var(--edge-b) + 194px) !important; }
      .t-reload { right:calc(var(--edge-r) + clamp(118px,23vw,150px)) !important;
                  bottom:calc(var(--edge-b) + 205px) !important; }
      .t-utils { top:var(--edge-t) !important; right:var(--edge-r) !important;
                 max-width:min(270px,calc(100vw - var(--edge-l) - var(--edge-r) - 16px));
                 flex-wrap:wrap; justify-content:flex-end; }
      @media (max-width:380px), (max-height:620px) {
        #touch { --stick-size: 108px; }
        .t-btn { transform:scale(.88); transform-origin:center; }
        .t-utils { gap:4px !important; max-width:160px; }
        .t-utils .t-btn { width:40px !important; height:40px !important; font-size:17px !important; }
        .t-jump { bottom:calc(var(--edge-b) + 68px) !important; }
        .t-fire { bottom:calc(var(--edge-b) + 92px) !important; }
        .t-aim { bottom:calc(var(--edge-b) + 162px) !important; }
        .t-reload { bottom:calc(var(--edge-b) + 170px) !important; }
      }
      @media (orientation:landscape) and (max-height:520px) {
        #touch { --stick-size: clamp(96px,24vh,122px); }
        .t-stick { bottom:calc(var(--edge-b) + 40px); }
        .t-jump { bottom:calc(var(--edge-b) + 28px) !important; }
        .t-sneak { right:calc(var(--edge-r) + 98px) !important; bottom:calc(var(--edge-b) + 8px) !important; }
        .t-fire { right:calc(var(--edge-r) + 110px) !important; bottom:calc(var(--edge-b) + 72px) !important; }
        .t-aim { right:calc(var(--edge-r) + 12px) !important; bottom:calc(var(--edge-b) + 118px) !important; }
        .t-reload { right:calc(var(--edge-r) + 184px) !important; bottom:calc(var(--edge-b) + 80px) !important; }
        .t-utils { max-width:280px; flex-wrap:nowrap; }
      }
    `;
    document.head.appendChild(style);

    const app = document.getElementById('app')!;
    this.root = document.createElement('div');
    this.root.id = 'touch';
    this.root.style.display = 'none';
    app.appendChild(this.root);

    // --- look / tap / long-press layer (under the hotbar & HUD buttons) ---
    this.pads = document.createElement('div');
    this.pads.style.cssText = 'position:absolute;inset:0;pointer-events:none;';
    this.root.appendChild(this.pads);

    const look = document.createElement('div');
    look.className = 't-look';
    this.pads.appendChild(look);
    look.addEventListener('pointerdown', (e) => this.lookDown(look, e));
    look.addEventListener('pointermove', (e) => this.lookMove(e));
    look.addEventListener('pointerup', (e) => this.lookUp(e, true));
    look.addEventListener('pointercancel', (e) => this.lookUp(e, false));

    // --- virtual joystick ---
    const stick = document.createElement('div');
    stick.className = 't-stick';
    this.knob = document.createElement('div');
    this.knob.className = 't-knob';
    stick.appendChild(this.knob);
    this.pads.appendChild(stick);
    stick.addEventListener('pointerdown', (e) => {
      if (this.stickId >= 0) return;
      this.stickId = e.pointerId;
      stick.setPointerCapture(e.pointerId);
      this.stickMove(stick, e);
      e.preventDefault(); e.stopPropagation();
    });
    stick.addEventListener('pointermove', (e) => {
      if (e.pointerId === this.stickId) { this.stickMove(stick, e); e.preventDefault(); }
    });
    const stickEnd = (e: PointerEvent): void => {
      if (e.pointerId !== this.stickId) return;
      this.stickId = -1;
      this.resetStick();
    };
    stick.addEventListener('pointerup', stickEnd);
    stick.addEventListener('pointercancel', stickEnd);

    // --- action buttons ---
    // JUMP: hold-to-hold (swimming, glider deploy, boat hop-out all read it).
    const jumpBtn = this.mkBtn(this.pads, iconSvg('chevronUp'), 'right:24px;bottom:104px;width:88px;height:88px;font-size:30px;');
    jumpBtn.classList.add('t-jump');
    this.hold(jumpBtn, (down) => { this.input.tJump = down; });
    // SNEAK: a toggle (holding a toggle AND moving is awkward on glass).
    this.sneakBtn = this.mkBtn(this.pads, iconSvg('chevronDown'), 'right:134px;bottom:40px;width:56px;height:56px;');
    this.sneakBtn.classList.add('t-sneak');
    this.tap(this.sneakBtn, () => {
      this.input.tSneak = !this.input.tSneak;
      this.sneakBtn.classList.toggle('t-on', this.input.tSneak);
    });

    this.vehicleBtn = this.mkBtn(
      this.pads, 'EXIT', 'right:134px;bottom:108px;width:64px;height:48px;font-size:13px;');
    this.vehicleBtn.classList.add('t-sq');
    this.tap(this.vehicleBtn, () => { this.input.dismountPressed = true; });
    this.ropeBtn = this.mkBtn(
      this.pads, 'ROPE', 'right:206px;bottom:108px;width:64px;height:48px;font-size:12px;');
    this.ropeBtn.classList.add('t-sq');
    this.tap(this.ropeBtn, () => { this.input.reloadPressed = true; });

    // Gun cluster (only visible while a gun is selected).
    this.gunBox = document.createElement('div');
    this.gunBox.style.cssText = 'position:absolute;inset:0;pointer-events:none;display:none;';
    this.pads.appendChild(this.gunBox);
    const fireBtn = this.mkBtn(this.gunBox, iconSvg('reticle'), 'right:126px;bottom:128px;width:78px;height:78px;font-size:28px;');
    fireBtn.classList.add('t-fire');
    this.hold(fireBtn, (down) => {
        if (down) { this.input.leftClicked = true; this.input.leftDown = true; }
        else this.input.leftDown = false;
      });
    this.aimBtn = this.mkBtn(this.gunBox, '⊕', 'right:36px;bottom:216px;width:58px;height:58px;font-size:24px;');
    this.aimBtn.classList.add('t-aim');
    this.tap(this.aimBtn, () => this.setAim(!this.aimOn));
    const reloadBtn = this.mkBtn(this.gunBox, 'R', 'right:150px;bottom:230px;width:50px;height:50px;font-size:18px;');
    reloadBtn.classList.add('t-reload');
    this.tap(reloadBtn, () => { this.input.reloadPressed = true; });

    // --- utility row (kept visible while any in-game menu is open, so the
    // same button that opened the inventory/map can close it again) ---
    this.utils = document.createElement('div');
    this.utils.className = 't-utils';
    this.utils.style.cssText = 'position:absolute;top:8px;right:8px;display:flex;gap:8px;pointer-events:none;';
    this.root.appendChild(this.utils);
    const util = (label: string, fn: () => void): void => {
      const b = this.mkBtn(this.utils, label, 'position:relative;width:46px;height:46px;font-size:20px;');
      b.classList.add('t-sq');
      this.tap(b, fn);
    };
    util(iconSvg('backpack'), cb.onInventory);
    util('/', cb.onChat);       // command box (/map, /warfare, /tpa, /guide…)
    util(iconSvg('pause'), cb.onPause);

    // --- hotbar: tap a slot to select it ---
    const hotbar = document.getElementById('hotbar');
    if (hotbar) {
      hotbar.style.pointerEvents = 'auto'; // CSS default is none (mouse play)
      hotbar.addEventListener('pointerdown', (e) => {
        const slot = (e.target as HTMLElement).closest('.slot');
        if (!slot) return;
        const i = Array.from(hotbar.children).indexOf(slot);
        if (i >= 0) this.input.hotbarKey = i;
        e.preventDefault(); e.stopPropagation();
      });
    }
  }

  /** Per-frame visibility + safety resets; called from the main loop. */
  update(s: TouchState): void {
    this.root.style.display = s.shown ? '' : 'none';
    this.pads.style.display = s.playing ? '' : 'none';
    this.gunBox.style.display = s.playing && s.gun ? '' : 'none';
    this.vehicleBtn.style.display = s.playing && s.vehicle ? '' : 'none';
    this.vehicleBtn.textContent = s.vehicleLabel;
    this.ropeBtn.style.display = s.playing && s.rope ? '' : 'none';
    if (!s.gun && this.aimOn) this.setAim(false);
    if (this.wasPlaying && !s.playing) this.resetTransient();
    this.wasPlaying = s.playing;
  }

  // --- internals -------------------------------------------------------------

  private setAim(on: boolean): void {
    this.aimOn = on;
    this.input.rightDown = on; // main.ts reads rightDown for ADS (with suppressUse)
    this.aimBtn.classList.toggle('t-on', on);
  }

  /** A menu opened / we died / lock dropped: release every held control so
   *  nothing stays "pressed" under the menu. */
  private resetTransient(): void {
    const i = this.input;
    i.tForward = i.tBack = i.tLeft = i.tRight = false;
    i.tJump = i.tSprint = false;
    i.leftDown = false;
    if (this.aimOn) this.setAim(false);
    this.stickId = -1;
    this.lookId = -1;
    this.holding = false;
    clearTimeout(this.holdTimer);
    this.resetStick();
  }

  private resetStick(): void {
    const i = this.input;
    i.tForward = i.tBack = i.tLeft = i.tRight = i.tSprint = false;
    this.knob.style.transform = '';
  }

  private stickMove(stick: HTMLElement, e: PointerEvent): void {
    const r = stick.getBoundingClientRect();
    const radius = r.width / 2;
    let dx = (e.clientX - (r.left + radius)) / radius;
    let dy = (e.clientY - (r.top + radius)) / radius;
    const mag = Math.hypot(dx, dy);
    // Knob display is clamped to the rim; direction thresholds use raw values.
    const disp = mag > 1 ? 1 / mag : 1;
    this.knob.style.transform =
      `translate(${dx * disp * radius * 0.7}px, ${dy * disp * radius * 0.7}px)`;
    const i = this.input;
    if (mag < DEAD) { i.tForward = i.tBack = i.tLeft = i.tRight = i.tSprint = false; return; }
    dx /= mag; dy /= mag;
    i.tForward = dy < -SECTOR;
    i.tBack = dy > SECTOR;
    i.tLeft = dx < -SECTOR;
    i.tRight = dx > SECTOR;
    i.tSprint = i.tForward && mag > 1.05; // past the rim = sprint
  }

  private lookDown(look: HTMLElement, e: PointerEvent): void {
    if (this.lookId >= 0) return;
    this.lookId = e.pointerId;
    look.setPointerCapture(e.pointerId);
    this.lookLastX = e.clientX; this.lookLastY = e.clientY;
    this.lookDist = 0;
    this.lookStart = performance.now();
    this.holding = false;
    clearTimeout(this.holdTimer);
    this.holdTimer = window.setTimeout(() => {
      // Still down and hasn't wandered: engage mining/attacking/firing.
      if (this.lookId === e.pointerId && this.lookDist < TAP_SLOP) {
        this.holding = true;
        this.input.leftClicked = true;
        this.input.leftDown = true;
      }
    }, HOLD_MS);
    e.preventDefault();
  }

  private lookMove(e: PointerEvent): void {
    if (e.pointerId !== this.lookId) return;
    const dx = e.clientX - this.lookLastX;
    const dy = e.clientY - this.lookLastY;
    this.lookLastX = e.clientX; this.lookLastY = e.clientY;
    this.lookDist += Math.abs(dx) + Math.abs(dy);
    this.input.mouseDX += dx * LOOK_SENS;
    this.input.mouseDY += dy * LOOK_SENS;
    e.preventDefault();
  }

  private lookUp(e: PointerEvent, allowTap: boolean): void {
    if (e.pointerId !== this.lookId) return;
    this.lookId = -1;
    clearTimeout(this.holdTimer);
    if (this.holding) {
      this.holding = false;
      this.input.leftDown = false;
    } else if (allowTap && performance.now() - this.lookStart < TAP_MS &&
        this.lookDist < TAP_SLOP) {
      this.input.rightClicked = true; // tap = use / place / open
    }
  }

  private mkBtn(parent: HTMLElement, label: string, css: string): HTMLElement {
    const b = document.createElement('div');
    b.className = 't-btn';
    b.style.cssText = css;
    b.innerHTML = label;
    parent.appendChild(b);
    return b;
  }

  /** Press-and-hold button: `fn(true)` on down, `fn(false)` on release. */
  private hold(b: HTMLElement, fn: (down: boolean) => void): void {
    let id = -1;
    b.addEventListener('pointerdown', (e) => {
      if (id >= 0) return;
      id = e.pointerId;
      b.setPointerCapture(e.pointerId);
      b.classList.add('t-on');
      fn(true);
      e.preventDefault(); e.stopPropagation();
    });
    const end = (e: PointerEvent): void => {
      if (e.pointerId !== id) return;
      id = -1;
      b.classList.remove('t-on');
      fn(false);
    };
    b.addEventListener('pointerup', end);
    b.addEventListener('pointercancel', end);
  }

  /** Tap button: fires once on pointerdown (snappy on glass). */
  private tap(b: HTMLElement, fn: () => void): void {
    b.addEventListener('pointerdown', (e) => {
      fn();
      e.preventDefault(); e.stopPropagation();
    });
  }
}
