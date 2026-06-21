// Keyboard / mouse / pointer-lock input.

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
  mouseDX = 0;
  mouseDY = 0;
  leftDown = false;
  leftClicked = false;
  rightDown = false;
  middleClicked = false;
  rightClicked = false;
  wheelDelta = 0;
  hotbarKey = -1; // 0-8 when a number key was pressed this frame
  debugToggled = false;
  inventoryToggled = false;
  reloadPressed = false; // R pressed this frame (gun reload)
  locked = false;
  sprintHeld = false; // via double-tap W, persists until W released

  private lastWDown = 0;
  private readonly canvas: HTMLCanvasElement;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;

    document.addEventListener('keydown', (e) => {
      if (e.code === 'F3') {
        e.preventDefault();
        this.debugToggled = true;
        return;
      }
      if (e.repeat) return;
      this.keys.add(e.code);
      if (e.code === 'KeyE') this.inventoryToggled = true;
      if (e.code === 'KeyR') this.reloadPressed = true;
      if (e.code === 'KeyW') {
        const now = performance.now();
        if (now - this.lastWDown < 250) this.sprintHeld = true;
        this.lastWDown = now;
      }
      if (e.code.startsWith('Digit')) {
        const n = Number(e.code.slice(5));
        if (n >= 1 && n <= 9) this.hotbarKey = n - 1;
      }
    });
    document.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
      if (e.code === 'KeyW') this.sprintHeld = false;
    });

    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.mouseDX += e.movementX;
      this.mouseDY += e.movementY;
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
      this.locked = document.pointerLockElement === this.canvas;
      if (!this.locked) {
        this.keys.clear();
        this.leftDown = this.rightDown = false;
      }
    });
  }

  lock(): void {
    this.canvas.requestPointerLock();
  }

  down(code: string): boolean {
    return this.keys.has(code);
  }

  get forward(): boolean { return this.down('KeyW'); }
  get back(): boolean { return this.down('KeyS'); }
  get left(): boolean { return this.down('KeyA'); }
  get right(): boolean { return this.down('KeyD'); }
  get jump(): boolean { return this.down('Space'); }
  get sneak(): boolean { return this.down('ShiftLeft') || this.down('ShiftRight'); }
  get sprintKey(): boolean { return this.down('ControlLeft') || this.down('ControlRight'); }

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
    this.inventoryToggled = false;
    this.reloadPressed = false;
  }
}
