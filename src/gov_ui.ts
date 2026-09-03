// Shared chrome for the two government screens (faction_picker.ts, the
// allegiance pledge; president_ui.ts, the government menu).
//
// It exists for one reason above all: THERE IS ONLY ONE BUST BOARD. A browser
// hands out roughly a dozen WebGL contexts per page, the world owns one and the
// Duels ladder owns another, so a screen that wants live 3D characters cannot
// simply new up its own renderer — and two screens certainly cannot new up two.
// `BustStage` owns a single AvatarBustBoard and moves it between panels.
//
// The second reason is the failure it is built to avoid. `AvatarBustBoard.mount`
// early-returns for a host it already holds, so if a panel rebuilds the subtree
// its canvas lives in, the canvas is torn out of the DOM and mount() then
// refuses to put it back — the busts silently never return on a second open.
// The fix is structural: the stage owns a `layer` element, panels are handed it
// to park somewhere permanent, and a panel's re-render must never touch it.

import { AvatarBustBoard, type BustEntry } from './avatar_bust';
import { ITEMS, type ItemStack } from './items';
import { renderItemIcon } from './icons';
import { iconSvg } from './emoji_icons';

/** Shared, module-prefixed styles for both government panels. */
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

.vx-gov-chips { display: flex; flex-wrap: wrap; gap: 6px; }
.vx-gov-chip {
  position: relative; display: flex; align-items: center; justify-content: center;
  width: 40px; height: 40px; border-radius: 9px;
  background: rgba(232, 238, 252, .07); box-shadow: inset 0 0 0 1px rgba(232, 238, 252, .12);
}
.vx-gov-chip canvas { width: 30px; height: 30px; image-rendering: pixelated; }
.vx-gov-chip[data-runed="1"] { box-shadow: inset 0 0 0 1px rgba(199, 155, 255, .75); }
.vx-gov-chip[data-empty="1"] { opacity: .3; }
.vx-gov-chip-rune {
  position: absolute; right: 2px; bottom: 1px; font-size: 9px; color: #c79bff; line-height: 1;
}
.vx-gov-chip-count {
  position: absolute; right: 3px; bottom: 1px;
  font: 700 9.5px/1 inherit; color: #e8eefc;
}

.vx-gov-tip {
  position: fixed; z-index: 60; display: none; max-width: 260px;
  padding: 7px 10px; border-radius: 8px; pointer-events: none;
  font: 600 11.5px/1.45 ui-sans-serif, system-ui, sans-serif; color: #e8eefc;
  background: rgba(9, 15, 23, .96); box-shadow: 0 8px 22px rgba(0, 0, 0, .5),
    inset 0 0 0 1px rgba(232, 238, 252, .14);
}
.vx-gov-tip b { color: #ffd98a; }
.vx-gov-tip i { display: block; margin-top: 3px; font-style: normal; color: #c79bff; }
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

// --- The shared tooltip ------------------------------------------------------

let tipEl: HTMLElement | null = null;
function tooltip(): HTMLElement {
  if (!tipEl) {
    injectGovStyle();
    tipEl = document.createElement('div');
    tipEl.className = 'vx-gov-tip';
    document.body.appendChild(tipEl);
  }
  return tipEl;
}

/** Show the floating tooltip at the pointer. `title` and `sub` are TEXT. */
export function showTip(e: MouseEvent, title: string, sub?: string): void {
  const tip = tooltip();
  tip.replaceChildren();
  const b = document.createElement('b');
  b.textContent = title;
  tip.appendChild(b);
  if (sub) {
    const i = document.createElement('i');
    i.textContent = sub;
    tip.appendChild(i);
  }
  tip.style.display = 'block';
  // Keep it on screen when the pointer is near the right or bottom edge.
  const box = tip.getBoundingClientRect();
  const x = Math.min(e.clientX + 14, window.innerWidth - box.width - 8);
  const y = Math.min(e.clientY + 16, window.innerHeight - box.height - 8);
  tip.style.left = `${Math.max(8, x)}px`;
  tip.style.top = `${Math.max(8, y)}px`;
}

export function hideTip(): void {
  if (tipEl) tipEl.style.display = 'none';
}

// --- Item chips --------------------------------------------------------------

/**
 * One hoverable inventory-style item square. Hovering names the item and, if it
 * carries one, its socketed rune — the same two facts the inventory tooltip
 * shows (inventory_ui.ts), so a president's gear reads exactly the way gear
 * reads everywhere else in the game.
 *
 * `stack` may be null: an empty armor slot still draws, dimmed, so the four
 * slots read as a set rather than collapsing.
 */
export function itemChip(
  atlasCanvas: HTMLCanvasElement, stack: ItemStack | null, emptyLabel = 'Empty slot'
): HTMLElement {
  const chip = document.createElement('div');
  chip.className = 'vx-gov-chip';
  if (!stack || !ITEMS[stack.id]) {
    chip.dataset.empty = '1';
    chip.addEventListener('mousemove', (e) => showTip(e, emptyLabel));
    chip.addEventListener('mouseleave', hideTip);
    return chip;
  }
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 32;
  renderItemIcon(canvas, atlasCanvas, stack.id);
  chip.appendChild(canvas);

  const runeName = stack.rune !== undefined ? ITEMS[stack.rune]?.name : undefined;
  if (runeName) {
    chip.dataset.runed = '1';
    const spark = document.createElement('span');
    spark.className = 'vx-gov-chip-rune';
    spark.innerHTML = iconSvg('sparkle');
    chip.appendChild(spark);
  }
  if (stack.count > 1) {
    const count = document.createElement('span');
    count.className = 'vx-gov-chip-count';
    count.textContent = String(stack.count);
    chip.appendChild(count);
  }
  const name = ITEMS[stack.id].name;
  chip.addEventListener('mousemove', (e) => showTip(e, name, runeName));
  chip.addEventListener('mouseleave', hideTip);
  return chip;
}

// --- The single bust board ---------------------------------------------------

/**
 * One live 3D character renderer, shared by every government panel.
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

  /** Stop drawing and release every avatar. Called when a panel closes, so a
   *  closed screen costs nothing per frame. */
  release(): void {
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
    const dt = this.last ? (now - this.last) / 1000 : 0;
    if (dt < BustStage.FRAME) return;
    this.last = now;
    this.board?.render(Math.min(0.1, dt));
  };
}

/** The one stage the whole client shares. */
export const bustStage = new BustStage();
