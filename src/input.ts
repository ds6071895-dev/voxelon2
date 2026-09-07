// Keyboard / mouse / pointer-lock input.

import { DEFAULT_KEYBINDS } from './hud_settings';
import type { BindAction, Keybinds } from './hud_settings';

/** Modifier keys come in pairs. A bind on one side answers to the other too —
 *  every game does this, and "Sneak = L Shift" refusing the right-hand Shift
 *  reads as a broken keyboard rather than a setting. */
const SIDE_PAIR: Record<string, string> = {
  ShiftLeft: 'ShiftRight', ShiftRight: 'ShiftLeft',
  ControlLeft: 'ControlRight', ControlRight: 'ControlLeft',
  AltLeft: 'AltRight', AltRight: 'AltLeft',
};

/** The movement/look fields the player reads. A frozen instance (all
 *  false/0) lets physics keep running with no control while a menu is open. */
export interface PlayerInput {
  mouseDX: number; mouseDY: number;
  forward: boolean; back: boolean; left: boolean; right: boolean;
  jump: boolean; sneak: boolean; sprintKey: boolean; sprintHeld: boolean;
}

export const FROZEN_INPUT: PlayerInput = {
  mouseDX: 0, mouseDY: 0, forward: false, back: false, left: false,
  right: false, jump: false, sneak: false, sprintKey: false, sprintHeld: false,
};

export class Input {
  private keys = new Set<string>();
  /** Live keybinds, owned by the HUD settings panel (setBinds). Read on every
   *  keydown rather than baked into the listener, so a rebind takes effect the
   *  moment it is made. */
  private binds: Keybinds = { ...DEFAULT_KEYBINDS };
  mouseDX = 0;
  mouseDY = 0;
  /** Look-speed multiplier from the settings panel. Applied where raw pointer
   *  deltas are accumulated, so every consumer of mouseDX/mouseDY (camera,
   *  vehicles, the vault cinematic) inherits it without knowing it exists. Touch
   *  scales by this too, on top of its own px->delta calibration. */
  lookSensitivity = 1;
  leftDown = false;
  leftClicked = false;
  rightDown = false;
  middleClicked = false;
  rightClicked = false;
  wheelDelta = 0;
  hotbarKey = -1; // 0-8 when a number key was pressed this frame
  debugToggled = false;
  operatorModeTogglePressed = false; // secret F4 shortcut; server still verifies OP
  inventoryToggled = false;
  // The world map and Warfare Command have NO key and NO button of their own
  // any more — they are `/map` and `/warfare` in the command box. These two
  // flags survive only so the mobile pause button can close an open map or
  // Warfare panel (they toggle, so setting them is all main.ts needs).
  mapToggled = false;
  // The five edges below fire on their BOUND key (see hud_settings.ts), not a
  // fixed one; the defaults are R / O / T / F / V.
  reloadPressed = false;   // gun reload
  dropPressed = false;     // drop the held item
  chatPressed = false;     // open the command box
  progressPressed = false; // tapped on touch — Warfare Command
  dismountPressed = false; // leave a vehicle seat
  viewPressed = false;     // cycle the camera view
  locked = false;

  // Touch controls (mobile): when true, "pointer lock" is virtual — lock()
  // just flips `locked` (there's no OS pointer to capture) and the on-screen
  // controls (src/touch.ts) write into the t* fields below, which the getters
  // OR together with the keyboard so gameplay code never special-cases touch.
  touchMode = false;
  tForward = false; tBack = false; tLeft = false; tRight = false;
  tJump = false; tSneak = false; tSprint = false;

  private kbSprint = false; // via double-tapping forward; held until it releases
  get sprintHeld(): boolean { return this.kbSprint || this.tSprint; }

  private lastForwardDown = 0;
  private readonly canvas: HTMLCanvasElement;

  /** Replace the whole bind set (from the HUD settings panel). On a real
   *  change held keys are dropped: a key that was down under the old binding
   *  would otherwise stay "pressed" for an action nothing releases. The panel
   *  calls this on every tick of every slider, so an unchanged set is a no-op
   *  rather than a keyboard reset. */
  setBinds(binds: Keybinds): void {
    let changed = false;
    for (const action of Object.keys(this.binds) as BindAction[]) {
      if (this.binds[action] === binds[action]) continue;
      this.binds[action] = binds[action];
      changed = true;
    }
    if (!changed) return;
    this.keys.clear();
    this.kbSprint = false;
  }

  /** Does this KeyboardEvent.code drive `action` right now? */
  private isBind(code: string, action: BindAction): boolean {
    const bound = this.binds[action];
    return code === bound || SIDE_PAIR[bound] === code;
  }

  /** Is the key bound to `action` currently held? */
  private heldBind(action: BindAction): boolean {
    const bound = this.binds[action];
    return this.keys.has(bound) || this.keys.has(SIDE_PAIR[bound] ?? '\0');
  }

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;

    document.addEventListener('keydown', (e) => {
      if (e.code === 'F3') {
        e.preventDefault();
        this.debugToggled = true;
        return;
      }
      if (e.code === 'F4') {
        e.preventDefault();
        if (!e.repeat) this.operatorModeTogglePressed = true;
        return;
      }
      if (e.repeat) return;
      this.keys.add(e.code);
      if (this.isBind(e.code, 'inventory')) this.inventoryToggled = true;
      if (this.isBind(e.code, 'reload')) this.reloadPressed = true;
      if (this.isBind(e.code, 'drop')) this.dropPressed = true;
      // The command-box key is the ONE key for everything that used to have its
      // own binding (map/waypoint/warfare/guide/tpa/tpa-accept).
      if (this.isBind(e.code, 'chat')) this.chatPressed = true;
      if (this.isBind(e.code, 'dismount')) this.dismountPressed = true;
      if (this.isBind(e.code, 'view')) this.viewPressed = true;
      if (this.isBind(e.code, 'forward')) {
        const now = performance.now();
        if (now - this.lastForwardDown < 250) this.kbSprint = true;
        this.lastForwardDown = now;
      }
      if (e.code.startsWith('Digit')) {
        const n = Number(e.code.slice(5));
        if (n >= 1 && n <= 9) this.hotbarKey = n - 1;
      }
    });
    document.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
      if (this.isBind(e.code, 'forward')) this.kbSprint = false;
    });

    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.mouseDX += e.movementX * this.lookSensitivity;
      this.mouseDY += e.movementY * this.lookSensitivity;
    });
    document.addEventListener('mousedown', (e) => {
      if (!this.locked) return;
      if (e.button === 0) { this.leftDown = true; this.leftClicked = true; }
      if (e.button === 1) { this.middleClicked = true; e.preventDefault(); }
      if (e.button === 2) { this.rightDown = true; this.rightClicked = true; }
    });
    document.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.leftDown = false;
      if (e.button === 2) this.rightDown = false;
    });
    document.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('wheel', (e) => {
      if (this.locked) this.wheelDelta += Math.sign(e.deltaY);
    });

    document.addEventListener('pointerlockchange', () => {
      if (this.touchMode) return; // virtual lock — the OS pointer is not involved
      this.locked = document.pointerLockElement === this.canvas;
      if (this.locked) this.wantLock = false;
      if (!this.locked) {
        this.keys.clear();
        this.leftDown = this.rightDown = false;
      }
    });
    // A refused request is normal, not exceptional: the browser turns pointer
    // lock down whenever the document is not focused, while a previous exit is
    // still settling, or (WrongDocumentError) when the page is not the active
    // document — an embedded/preview frame, or a tab that lost the foreground
    // between the request and the browser acting on it. Losing the lock must
    // never leave the game unplayable, so a refusal simply keeps `wantLock`
    // armed and the next real user gesture re-asks. Nothing reaches the console.
    document.addEventListener('pointerlockerror', () => { this.pending = false; }, true);
    for (const type of ['mousedown', 'keydown', 'touchend'] as const) {
      document.addEventListener(type, () => this.retryLock(), true);
    }
    // The refusal that actually bites is WrongDocumentError: the browser will
    // not hand the pointer to a document that is not the focused one, and the
    // game asks for it from a NETWORK callback (a Duels rematch drops you into
    // the arena while your attention — or a second test window, or DevTools —
    // is somewhere else). Regaining focus is the moment that request becomes
    // grantable again, so re-ask there instead of waiting for a click.
    window.addEventListener('focus', () => this.retryLock());
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) this.retryLock();
    });
  }

  /** True while the game wants the pointer but the browser has not granted it
   *  — what the "click to take control" hint watches. */
  get lockPending(): boolean { return this.wantLock && !this.locked; }

  /** Set while the game wants the pointer but the browser has not granted it.
   *  Cleared by a successful lock or by an explicit unlock(). */
  private wantLock = false;
  private pending = false;

  lock(): void {
    if (this.touchMode) {
      if (this.locked) return;
      this.locked = true;
      // Fire the same event the real pointer lock would, so the screen state
      // machine in main.ts (enterPlaying/enterPause) works unchanged.
      document.dispatchEvent(new Event('pointerlockchange'));
      return;
    }
    this.wantLock = true;
    this.request();
  }

  private request(): void {
    if (this.locked || this.pending || !this.canvas.isConnected) return;
    this.pending = true;
    let result: unknown;
    try {
      result = this.canvas.requestPointerLock();
    } catch {
      this.pending = false;
      return;
    }
    // Older engines return void here; newer ones return a promise that REJECTS
    // rather than throwing, which is where the unhandled rejection came from.
    if (result && typeof (result as Promise<void>).then === 'function') {
      (result as Promise<void>).then(
        () => { this.pending = false; },
        () => { this.pending = false; },
      );
    } else {
      this.pending = false;
    }
  }

  /** Re-ask for the pointer from inside a user gesture, which is the only
   *  moment a browser reliably grants it. */
  private retryLock(): void {
    if (this.touchMode || !this.wantLock || this.locked) return;
    this.request();
  }

  /** Release the (real or virtual) pointer lock. */
  unlock(): void {
    this.wantLock = false;
    if (this.touchMode) {
      if (!this.locked) return;
      this.locked = false;
      this.keys.clear();
      this.leftDown = this.rightDown = false;
      document.dispatchEvent(new Event('pointerlockchange'));
      return;
    }
    try { document.exitPointerLock(); } catch { /* already released */ }
  }

  down(code: string): boolean {
    return this.keys.has(code);
  }

  get forward(): boolean { return this.heldBind('forward') || this.tForward; }
  get back(): boolean { return this.heldBind('back') || this.tBack; }
  get left(): boolean { return this.heldBind('left') || this.tLeft; }
  get right(): boolean { return this.heldBind('right') || this.tRight; }
  get jump(): boolean { return this.heldBind('jump') || this.tJump; }
  get sneak(): boolean { return this.heldBind('sneak') || this.tSneak; }
  get sprintKey(): boolean { return this.heldBind('sprint'); }
  /** Hold-to-zoom (the spyglass-style smooth zoom). Keyboard only: the
   *  on-screen controls have no key to hold and no wheel to scale it with. */
  get zoomHeld(): boolean { return !this.touchMode && this.heldBind('zoom'); }

  /** Consume per-frame deltas/edges; call once at the end of each frame. */
  endFrame(): void {
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.wheelDelta = 0;
    this.hotbarKey = -1;
    this.leftClicked = false;
    this.middleClicked = false;
    this.rightClicked = false;
    this.debugToggled = false;
    this.operatorModeTogglePressed = false;
    this.inventoryToggled = false;
    this.mapToggled = false;
    this.reloadPressed = false;
    this.dropPressed = false;
    this.chatPressed = false;
    this.progressPressed = false;
    this.dismountPressed = false;
    this.viewPressed = false;
  }
}
