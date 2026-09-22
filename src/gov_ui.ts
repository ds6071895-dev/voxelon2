// Shared chrome for the allegiance pledge screen (faction_picker.ts).
//
// It exists for one reason above all: THERE IS ONLY ONE BUST BOARD. A browser
// hands out roughly a dozen WebGL contexts per page, the world owns one and the
// Duels ladder owns another, so a screen that wants live 3D characters cannot
// simply new up its own renderer. `BustStage` owns a single AvatarBustBoard
// and moves it into whichever panel needs it.
//
// The second reason is the failure it is built to avoid. `AvatarBustBoard.mount`
// early-returns for a host it already holds, so if a panel rebuilds the subtree
// its canvas lives in, the canvas is torn out of the DOM and mount() then
// refuses to put it back — the busts silently never return on a second open.
// The fix is structural: the stage owns a `layer` element, panels are handed it
// to park somewhere permanent, and a panel's re-render must never touch it.

import { AvatarBustBoard, type BustEntry } from './avatar_bust';

/** Shared, module-prefixed styles for the pledge screen. */
const CSS = `
.vx-gov-surface {
  position: fixed; inset: 0; z-index: 42; display: none;
  align-items: center; justify-content: center; padding: 20px;
  background: radial-gradient(120% 120% at 50% 0%, rgba(19, 31, 46, .82), rgba(5, 9, 15, .93));
  backdrop-filter: blur(4px);
  font-family: ui-sans-serif, -apple-system, 'Segoe UI', Roboto, system-ui, sans-serif;
  color: #e8eefc;
}
.vx-gov-surface[data-open="1"] { display: flex; }
.vx-gov-surface * { text-shadow: none; box-sizing: border-box; }
.vx-gov-eyebrow {
  font-size: 9.5px; letter-spacing: 2.8px; text-transform: uppercase; color: #b9862d;
}
/* The bust canvas. It is stretched over the SCROLL VIEWPORT of whichever panel
   owns it — never over the whole panel — so a bust scrolled out of that region
   falls outside the framebuffer and is clipped for free, instead of painting
   over the header. It sits above the cards because it is transparent everywhere
   except the scissor rectangles it actually draws into. */
.vx-gov-bustlayer {
  position: absolute; inset: 0; pointer-events: none; z-index: 5; overflow: hidden;
}
/* The viewport a panel hands to the stage: a positioned box the scroller and the
   canvas both fill, so neither can drift from the other. */
.vx-gov-viewport { position: relative; flex: 1; min-height: 0; }
.vx-gov-scroll { position: absolute; inset: 0; overflow-y: auto; }
.vx-gov-scroll::-webkit-scrollbar { width: 9px; }
.vx-gov-scroll::-webkit-scrollbar-thumb { border-radius: 5px; background: rgba(232, 238, 252, .2); }

.vx-gov-btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 7px;
  min-height: 38px; padding: 0 16px; border: 0; border-radius: 10px; cursor: pointer;
  font: 700 10.5px/1 inherit; letter-spacing: 1.4px; text-transform: uppercase;
  color: #cfd9ea; background: rgba(232, 238, 252, .09);
  box-shadow: inset 0 0 0 1px rgba(232, 238, 252, .12);
  transition: background .15s, transform .12s, filter .15s;
}
.vx-gov-btn:hover:not(:disabled) { background: rgba(232, 238, 252, .17); transform: translateY(-1px); }
.vx-gov-btn:focus-visible { outline: 2px solid #eda01a; outline-offset: 2px; }
.vx-gov-btn:disabled { opacity: .42; cursor: not-allowed; }
.vx-gov-btn[data-kind="primary"] {
  color: #26180a; background: linear-gradient(180deg, #ffd06a, #eda01a); box-shadow: none;
}
.vx-gov-btn[data-kind="primary"]:hover:not(:disabled) { filter: brightness(1.06); }
.vx-gov-btn[data-kind="danger"] { color: #ffd9d3; background: rgba(226, 80, 59, .22); }

`;

let styleInjected = false;
export function injectGovStyle(): void {
  if (styleInjected) return;
  styleInjected = true;
  const el = document.createElement('style');
  el.id = 'vx-gov-style';
  el.textContent = CSS;
  document.head.appendChild(el);
}

// --- The single bust board ---------------------------------------------------

/**
 * One live 3D character renderer, shared by every panel that shows busts.
 *
 * `layer` is the stage's OWN element and the renderer's permanent home. A panel
 * parks it in a positioned container once and must never rebuild it — see the
 * note at the top of this file for what happens when that rule is broken.
 */
export class BustStage {
  readonly layer: HTMLElement;
  private board: AvatarBustBoard | null = null;
  /** A context we could not get. Tried once, then the CSS plinths stand alone. */
  private failed = false;
  private running = false;
  private last = 0;
  /** Nothing here benefits from 60Hz, and the title panorama is still drawing
   *  behind the panel — the same 30Hz budget the Duels ladder runs at. */
  private static readonly FRAME = 1 / 30;

  constructor() {
    injectGovStyle();
    this.layer = document.createElement('div');
    this.layer.className = 'vx-gov-bustlayer';
    this.layer.setAttribute('aria-hidden', 'true');
  }

  /** Park the renderer over a panel's scroll viewport and start drawing.
   *
   *  `container` must be `position: relative`, must be the box the bust slots
   *  scroll INSIDE, and must outlive the panel's content re-renders — see the
   *  note at the top of this file for what happens when that last rule breaks. */
  attach(container: HTMLElement): void {
    if (this.layer.parentElement !== container) container.appendChild(this.layer);
    const board = this.ensure();
    if (!board) return;
    board.mount(this.layer);
    if (!this.running) {
      this.running = true;
      this.last = 0;
      requestAnimationFrame(this.frame);
    }
  }

  /**
   * Can this page actually draw live busts right now?
   *
   * A browser hands out a limited number of WebGL contexts and the world, the
   * icon renderer and the character preview already spend several of them, so
   * "no context to spare" is a REAL state a player can land in — and it used to
   * present as plinths that stayed permanently empty with nothing on screen
   * saying why. Panels ask this and put a static portrait in the slot instead.
   *
   * Answering it forces the board to exist, which is what we want: the caller is
   * about to render slots either way, and a lazy board would report `true` and
   * then fail on the first frame.
   */
  get available(): boolean {
    const board = this.ensure();
    return !!board && board.alive;
  }

  /**
   * Stop drawing and release every avatar. Called when a panel closes, so a
   * closed screen costs nothing per frame.
   *
   * `owner` is the container that panel parked the stage in. A panel that no
   * longer HOLDS the stage must not switch it off: another bust panel opened
   * over this one moves the layer, and this one closing behind it would
   * otherwise kill the render loop under a panel that is still on screen —
   * busts that freeze for no visible reason. Passing the owner makes the
   * release a no-op in exactly that case.
   */
  release(owner?: HTMLElement): void {
    if (owner && this.layer.parentElement !== owner) return;
    this.running = false;
    this.board?.setRoster([]);
  }

  setRoster(entries: BustEntry[]): void { this.ensure()?.setRoster(entries); }
  setHover(key: string | null): void { this.board?.setHover(key); }

  private ensure(): AvatarBustBoard | null {
    if (this.board || this.failed) return this.board;
    try {
      this.board = new AvatarBustBoard();
    } catch {
      // No context to spare. The panels degrade to their CSS plinths, which is
      // a worse screen but never a broken one.
      this.failed = true;
      this.board = null;
    }
    return this.board;
  }

  private readonly frame = (now: number): void => {
    if (!this.running) return;
    requestAnimationFrame(this.frame);
    // The FIRST frame after an attach has no previous timestamp to measure
    // against, and it must still count as a full one: treating it as dt=0 makes
    // it fall under the 30Hz gate, which then never updates `last` — so `last`
    // stayed 0 forever, every following frame measured 0 too, and the board was
    // never asked to draw a single time. That is why the plinths stood
    // empty: the busts existed, nothing ever rendered them.
    const dt = this.last ? (now - this.last) / 1000 : BustStage.FRAME;
    if (dt < BustStage.FRAME) return;
    this.last = now;
    this.board?.render(Math.min(0.1, dt));
  };
}

/** The one stage the whole client shares. */
export const bustStage = new BustStage();
