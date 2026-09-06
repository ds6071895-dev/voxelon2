// THE CAPE WARDROBE — everything you own on one board, click one to wear it.
//
// SELF-CONTAINED, the same way the government screens are: one injected <style>
// under a `vx-cape-` prefix, nothing added to index.html, and no WebGL of its
// own (the page's GL contexts are already spoken for by the world, the Duels
// ladder and the two character previews).
//
// The catalog in capes.ts is EMPTY right now, so what this actually renders is
// the honest version of that: the always-there "No Cape" slot, worn, three
// shrouded plates standing in for capes nobody has minted yet, and a note
// saying so. Every branch below is written for a populated catalog — fill
// `CAPES` and this screen becomes a collection grid with no changes here.

import {
  CAPES, NO_CAPE, RARITY_COLORS, type Cape, type Wardrobe,
  ownedCapes,
} from './capes';
import { iconSvg } from './emoji_icons';

const CSS = `
/* THE VAULT LOOK. The wardrobe used to be a white card, which read like a
   settings dialog bolted onto a dark game. It is now lit like the title
   screen it opens from: black glass, a gold spill from above, and the capes
   themselves as the only real colour on the board. */
.vx-cape-surface {
  position: fixed; inset: 0; z-index: 44; display: none;
  align-items: center; justify-content: center; padding: 20px;
  background:
    radial-gradient(ellipse 60% 50% at 12% 0%, rgba(255, 192, 67, .16), transparent 62%),
    radial-gradient(ellipse 60% 50% at 88% 6%, rgba(77, 155, 255, .16), transparent 64%),
    radial-gradient(ellipse 120% 95% at 50% 45%, rgba(3, 5, 9, .72) 30%, rgba(2, 3, 6, .95) 100%);
  backdrop-filter: blur(7px) saturate(1.1);
  font-family: ui-sans-serif, -apple-system, 'Segoe UI', Roboto, system-ui, sans-serif;
}
.vx-cape-surface[data-open="1"] { display: flex; animation: vx-cape-in .22s ease both; }
.vx-cape-surface * { box-sizing: border-box; text-shadow: none; }
@keyframes vx-cape-in { from { opacity: 0; } }

.vx-cape-shell {
  --ink: #eaf1fa;
  --ink-soft: #aec1d8;
  --ink-mute: #8398b2;
  --line: rgba(150, 182, 224, .16);
  --plate: rgba(255, 255, 255, .045);
  --gold: #ffc043;
  --gold-lit: #ffdb87;
  --gold-deep: #b87908;

  position: relative; display: flex; flex-direction: column;
  width: min(940px, 100%); height: min(680px, 100%);
  border-radius: 24px; overflow: hidden; color: var(--ink);
  background: linear-gradient(180deg, rgba(19, 27, 42, .92), rgba(7, 11, 19, .96));
  box-shadow: 0 50px 110px rgba(0, 0, 0, .62), inset 0 0 0 1px var(--line),
    inset 0 1px 0 rgba(255, 255, 255, .07);
  animation: vx-cape-rise .26s cubic-bezier(.2, .9, .3, 1) both;
}
@keyframes vx-cape-rise { from { transform: translateY(14px) scale(.985); opacity: 0; } }

/* Light spilling in from over your shoulder, plus the voxel grid the rest of
   the game's menus wear. Both sit behind the content. */
.vx-cape-shell::before {
  content: ''; position: absolute; inset: 0; pointer-events: none;
  background:
    radial-gradient(74% 120% at 14% -26%, rgba(255, 192, 67, .2), transparent 66%),
    radial-gradient(64% 110% at 92% -34%, rgba(103, 152, 224, .18), transparent 70%);
}
.vx-cape-shell::after {
  content: ''; position: absolute; inset: 0; pointer-events: none;
  background:
    linear-gradient(rgba(150, 190, 240, .07) 1px, transparent 1px),
    linear-gradient(90deg, rgba(150, 190, 240, .07) 1px, transparent 1px);
  background-size: 34px 34px;
  -webkit-mask-image: linear-gradient(180deg, transparent 40%, #000 100%);
  mask-image: linear-gradient(180deg, transparent 40%, #000 100%);
}
.vx-cape-shell > * { position: relative; z-index: 1; }

.vx-cape-head {
  display: flex; align-items: center; gap: 16px; padding: 20px 24px 16px;
}
.vx-cape-crest {
  display: grid; place-items: center; width: 46px; height: 46px; flex: none;
  border-radius: 14px; font-size: 23px; color: #1c1204;
  background: linear-gradient(160deg, var(--gold-lit), var(--gold) 52%, var(--gold-deep));
  box-shadow: 0 10px 26px rgba(255, 192, 67, .26), inset 0 1px 0 rgba(255, 255, 255, .6);
}
.vx-cape-titles { flex: 1; min-width: 0; }
.vx-cape-eyebrow {
  display: flex; align-items: center; gap: 8px;
  font-size: 9px; letter-spacing: 2.6px; text-transform: uppercase; color: var(--gold);
}
.vx-cape-eyebrow::after {
  content: ''; flex: 1; height: 1px; max-width: 120px;
  background: linear-gradient(90deg, rgba(255, 192, 67, .5), transparent);
}
.vx-cape-titles h1 {
  margin: 3px 0 0; font-size: 25px; font-weight: 700; letter-spacing: 1.6px;
  font-family: 'Lucida Console', Monaco, monospace; color: var(--ink);
}
.vx-cape-tally {
  display: grid; gap: 2px; justify-items: end; text-align: right; flex: none;
  padding: 8px 15px; border-radius: 14px;
  background: var(--plate); box-shadow: inset 0 0 0 1px var(--line);
}
.vx-cape-tally b {
  font-size: 17px; font-variant-numeric: tabular-nums; color: var(--gold-lit);
  font-family: 'Lucida Console', Monaco, monospace;
}
.vx-cape-tally small {
  font-size: 8.5px; letter-spacing: 1.7px; text-transform: uppercase; color: var(--ink-mute);
}
.vx-cape-x {
  flex: none; width: 38px; height: 38px; display: grid; place-items: center;
  border: 0; border-radius: 12px; cursor: pointer; font-size: 14px;
  color: var(--ink-soft); background: var(--plate);
  box-shadow: inset 0 0 0 1px var(--line);
  transition: color .14s ease, background .14s ease, transform .14s ease;
}
.vx-cape-x:hover {
  color: #fff; background: rgba(255, 77, 85, .16); transform: rotate(90deg);
  box-shadow: inset 0 0 0 1px rgba(255, 77, 85, .4);
}

/* The board itself. One scroller so a big collection never pushes the footer
   off the card. */
.vx-cape-body { flex: 1; min-height: 0; overflow-y: auto; padding: 4px 24px 20px; }
.vx-cape-body::-webkit-scrollbar { width: 8px; }
.vx-cape-body::-webkit-scrollbar-thumb {
  border-radius: 8px; background: rgba(150, 182, 224, .22);
}
.vx-cape-grid {
  display: grid; gap: 14px; margin: 0;
  grid-template-columns: repeat(auto-fill, minmax(196px, 1fr));
}

/* A tile IS the equip button — no second click target inside it. */
.vx-cape-tile {
  --chip: #8493a6;
  position: relative; display: flex; flex-direction: column; gap: 0; padding: 0;
  overflow: hidden; text-align: left; cursor: pointer; font: inherit; color: var(--ink);
  border: 0; border-radius: 18px;
  background: linear-gradient(180deg, rgba(255, 255, 255, .06), rgba(255, 255, 255, .02));
  box-shadow: 0 14px 30px rgba(0, 0, 0, .42), inset 0 0 0 1px var(--line);
  transition: transform .16s cubic-bezier(.2, .9, .3, 1), box-shadow .16s ease;
}
.vx-cape-tile:hover:not(:disabled) {
  transform: translateY(-4px);
  box-shadow: 0 22px 42px rgba(0, 0, 0, .5),
    inset 0 0 0 1px color-mix(in srgb, var(--chip) 55%, transparent),
    0 0 30px color-mix(in srgb, var(--chip) 22%, transparent);
}
.vx-cape-tile:focus-visible {
  outline: 2px solid var(--gold); outline-offset: 3px;
}
.vx-cape-tile:disabled { cursor: default; }
.vx-cape-tile[data-kind="locked"] { opacity: .62; }
/* The one you are wearing is lit from inside and keeps a gold ring. */
.vx-cape-tile[data-worn="1"] {
  background: linear-gradient(180deg, rgba(255, 192, 67, .14), rgba(255, 192, 67, .03));
  box-shadow: 0 18px 38px rgba(0, 0, 0, .5), inset 0 0 0 2px var(--gold),
    0 0 34px rgba(255, 192, 67, .22);
}

/* The swatch is the cape itself: cloth cut to a cape silhouette, trim showing
   at the hem, folds raked across it and a slow sheen travelling over the top. */
.vx-cape-swatch {
  position: relative; height: 132px; flex: none; overflow: hidden;
  background:
    radial-gradient(80% 100% at 50% 0%, rgba(255, 255, 255, .09), transparent 70%),
    linear-gradient(180deg, rgba(9, 14, 22, .5), rgba(6, 9, 15, .8));
}
.vx-cape-cloth {
  position: absolute; inset: 10px 26px -6px; background: var(--trim, #333);
  clip-path: polygon(31% 0, 69% 0, 100% 100%, 50% 88%, 0 100%);
  filter: drop-shadow(0 10px 16px rgba(0, 0, 0, .55));
}
.vx-cape-cloth::before {
  content: ''; position: absolute; inset: 5px 6px 9px;
  clip-path: polygon(31% 0, 69% 0, 100% 100%, 50% 88%, 0 100%);
  background:
    repeating-linear-gradient(96deg, rgba(0, 0, 0, .22) 0 2px, transparent 2px 15px),
    linear-gradient(178deg, color-mix(in srgb, var(--cloth) 88%, #fff) 0%,
      var(--cloth) 34%, color-mix(in srgb, var(--cloth) 58%, #000) 100%);
}
/* The clasp across the shoulders. */
.vx-cape-cloth::after {
  content: ''; position: absolute; top: 2px; left: 50%; width: 34%; height: 5px;
  transform: translateX(-50%); border-radius: 4px;
  background: linear-gradient(180deg, color-mix(in srgb, var(--trim) 62%, #fff), var(--trim));
  box-shadow: 0 1px 3px rgba(0, 0, 0, .5);
}
.vx-cape-sheen {
  position: absolute; inset: 0; pointer-events: none;
  background: linear-gradient(74deg, transparent 36%, rgba(255, 255, 255, .3) 50%, transparent 64%);
  transform: translateX(-120%);
}
.vx-cape-tile:hover .vx-cape-sheen,
.vx-cape-tile[data-worn="1"] .vx-cape-sheen {
  animation: vx-cape-sheen 1.5s ease-in-out infinite;
}
@keyframes vx-cape-sheen {
  0% { transform: translateX(-120%); }
  60%, 100% { transform: translateX(120%); }
}

/* The bare slot and the locked plate get a drawn placeholder, not a colour. */
.vx-cape-swatch[data-kind="none"] {
  display: grid; place-items: center;
  background:
    repeating-linear-gradient(135deg, rgba(150, 182, 224, .05) 0 10px, transparent 10px 20px),
    linear-gradient(180deg, rgba(12, 18, 28, .7), rgba(6, 9, 15, .85));
}
.vx-cape-swatch[data-kind="none"] .vx-cape-bare {
  font-size: 34px; color: rgba(150, 182, 224, .34);
}
.vx-cape-swatch[data-kind="locked"],
.vx-cape-swatch[data-kind="ghost"] {
  display: grid; place-items: center; font-size: 28px; color: rgba(150, 182, 224, .45);
  background:
    repeating-linear-gradient(135deg, rgba(255, 192, 67, .05) 0 10px, transparent 10px 20px),
    linear-gradient(180deg, rgba(14, 20, 31, .8), rgba(6, 9, 15, .9));
}
.vx-cape-swatch[data-kind="ghost"] {
  font: 700 30px/1 'Lucida Console', Monaco, monospace;
  color: rgba(150, 182, 224, .3); letter-spacing: 4px;
}
.vx-cape-swatch[data-kind="ghost"]::after {
  content: ''; position: absolute; inset: 0;
  background: linear-gradient(74deg, transparent 40%, rgba(150, 190, 240, .14) 50%, transparent 60%);
  animation: vx-cape-sheen 3.4s ease-in-out infinite;
}

.vx-cape-meta { display: grid; gap: 6px; padding: 12px 14px 14px; }
.vx-cape-name {
  display: flex; align-items: center; gap: 7px;
  font-size: 14px; font-weight: 700; letter-spacing: .3px; color: var(--ink);
}
.vx-cape-worn {
  margin-left: auto; flex: none; display: inline-flex; align-items: center; gap: 4px;
  padding: 3px 9px; border-radius: 999px; font-size: 8.5px; font-weight: 700;
  letter-spacing: 1.4px; text-transform: uppercase;
  color: #2a1a02; background: linear-gradient(180deg, var(--gold-lit), var(--gold));
  box-shadow: 0 0 16px rgba(255, 192, 67, .4);
}
.vx-cape-worn svg { font-size: 11px; }
.vx-cape-rarity {
  justify-self: start; padding: 3px 9px; border-radius: 999px;
  font-size: 8.5px; font-weight: 700; letter-spacing: 1.5px; text-transform: uppercase;
  color: color-mix(in srgb, var(--chip) 72%, #fff);
  background: color-mix(in srgb, var(--chip) 18%, transparent);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--chip) 46%, transparent);
}
.vx-cape-blurb { font-size: 11.5px; line-height: 1.45; color: var(--ink-mute); }

/* Shown while the catalog is empty: says why the board is bare, in the same
   voice as the rest of the game rather than as an error. */
/* The class sets display, so it must also beat the UA's [hidden] rule. */
.vx-cape-soon[hidden] { display: none; }
.vx-cape-soon {
  display: flex; align-items: center; gap: 15px; margin: 16px 0 0; padding: 17px 19px;
  border-radius: 18px; color: var(--ink-soft);
  background: linear-gradient(180deg, rgba(255, 192, 67, .07), rgba(255, 255, 255, .02));
  box-shadow: inset 0 0 0 1px rgba(255, 192, 67, .2);
}
.vx-cape-soon-icon {
  display: grid; place-items: center; width: 42px; height: 42px; flex: none;
  border-radius: 13px; font-size: 21px; color: var(--gold);
  background: rgba(255, 192, 67, .12); box-shadow: inset 0 0 0 1px rgba(255, 192, 67, .28);
  animation: vx-cape-pulse 2.8s ease-in-out infinite;
}
@keyframes vx-cape-pulse { 50% { box-shadow: inset 0 0 0 1px rgba(255,192,67,.5), 0 0 22px rgba(255,192,67,.3); } }
.vx-cape-soon b { display: block; color: var(--ink); font-size: 13px; margin-bottom: 3px; }
.vx-cape-soon span { font-size: 11.5px; line-height: 1.5; }

.vx-cape-foot {
  display: flex; align-items: center; gap: 12px;
  padding: 14px 24px 20px; border-top: 1px solid var(--line);
  background: linear-gradient(180deg, transparent, rgba(0, 0, 0, .28));
}
.vx-cape-hint {
  flex: 1; font-size: 11px; color: var(--ink-mute); letter-spacing: .3px;
}
.vx-cape-done {
  border: 0; border-radius: 13px; padding: 12px 28px; cursor: pointer;
  font: inherit; font-size: 10px; font-weight: 700; letter-spacing: 1.7px;
  text-transform: uppercase; color: #241703;
  background: linear-gradient(180deg, var(--gold-lit), var(--gold));
  box-shadow: 0 12px 28px rgba(255, 192, 67, .26);
  transition: filter .14s ease, transform .14s ease, box-shadow .14s ease;
}
.vx-cape-done:hover {
  filter: brightness(1.08); transform: translateY(-1px);
  box-shadow: 0 16px 34px rgba(255, 192, 67, .34);
}
.vx-cape-done:active { transform: translateY(1px); }

@media (prefers-reduced-motion: reduce) {
  .vx-cape-surface[data-open="1"], .vx-cape-shell { animation: none; }
  .vx-cape-sheen, .vx-cape-swatch[data-kind="ghost"]::after, .vx-cape-soon-icon { animation: none; }
}
@media (max-width: 620px) {
  .vx-cape-surface { padding: 0; }
  .vx-cape-shell { width: 100%; height: 100%; border-radius: 0; }
  .vx-cape-tally { display: none; }
}
`;

let styled = false;
function injectStyle(): void {
  if (styled) return;
  styled = true;
  const el = document.createElement('style');
  el.textContent = CSS;
  document.head.appendChild(el);
}

function hex(n: number): string { return `#${n.toString(16).padStart(6, '0')}`; }

/** What one tile renders. `none` is the bare-shoulders slot, `locked` is a
 *  catalog cape you have not earned. */
type Tile =
  | { kind: 'none' }
  | { kind: 'owned'; cape: Cape }
  | { kind: 'locked'; cape: Cape }
  /** A silhouette standing in for a cape nobody has minted yet, so an empty
   *  catalog still reads as a display case rather than as a broken grid. */
  | { kind: 'ghost' };

export class CapesUI {
  private readonly surface: HTMLElement;
  private readonly grid: HTMLElement;
  private readonly tallyValue: HTMLElement;
  private readonly hint: HTMLElement;
  private readonly soon: HTMLElement;
  private isOpen = false;
  private wardrobe: Wardrobe = { owned: [], equipped: NO_CAPE };

  onOpen?: () => void;
  onClose?: () => void;
  /** Fired with the cape id to wear (NO_CAPE to take it off). The owner applies
   *  it, persists it, and calls `update()` back with the new wardrobe. */
  onEquip?: (id: string) => void;

  constructor(host: HTMLElement) {
    injectStyle();
    this.surface = document.createElement('div');
    this.surface.className = 'vx-cape-surface';
    this.surface.setAttribute('role', 'dialog');
    this.surface.setAttribute('aria-modal', 'true');
    this.surface.setAttribute('aria-label', 'Your capes');
    this.surface.tabIndex = -1;
    this.surface.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); this.hide(); }
    });
    this.surface.addEventListener('mousedown', (e) => {
      if (e.target === this.surface) this.hide();
    });

    const shell = document.createElement('div');
    shell.className = 'vx-cape-shell';

    const head = document.createElement('div');
    head.className = 'vx-cape-head';
    const crest = document.createElement('div');
    crest.className = 'vx-cape-crest';
    crest.innerHTML = iconSvg('wing');
    const titles = document.createElement('div');
    titles.className = 'vx-cape-titles';
    const eyebrow = document.createElement('div');
    eyebrow.className = 'vx-cape-eyebrow';
    eyebrow.textContent = 'Wardrobe · what you have earned';
    const title = document.createElement('h1');
    title.textContent = 'Capes';
    titles.append(eyebrow, title);
    const tally = document.createElement('div');
    tally.className = 'vx-cape-tally';
    this.tallyValue = document.createElement('b');
    const tallyLabel = document.createElement('small');
    tallyLabel.textContent = 'Collected';
    tally.append(this.tallyValue, tallyLabel);
    const close = document.createElement('button');
    close.className = 'vx-cape-x';
    close.type = 'button';
    close.setAttribute('aria-label', 'Close');
    close.innerHTML = iconSvg('close');
    close.addEventListener('click', () => this.hide());
    head.append(crest, titles, tally, close);

    const body = document.createElement('div');
    body.className = 'vx-cape-body';
    this.grid = document.createElement('div');
    this.grid.className = 'vx-cape-grid';
    this.soon = document.createElement('div');
    this.soon.className = 'vx-cape-soon';
    const soonIcon = document.createElement('div');
    soonIcon.className = 'vx-cape-soon-icon';
    soonIcon.innerHTML = iconSvg('sparkle');
    const soonText = document.createElement('div');
    const soonTitle = document.createElement('b');
    soonTitle.textContent = 'No capes in the world yet';
    const soonBody = document.createElement('span');
    soonBody.textContent =
      'Capes are becoming something you earn rather than something you pick. ' +
      'None have been minted yet — when the first ones land they show up here, ' +
      'and one click puts them on your shoulders.';
    soonText.append(soonTitle, soonBody);
    this.soon.append(soonIcon, soonText);
    body.append(this.grid, this.soon);

    const foot = document.createElement('div');
    foot.className = 'vx-cape-foot';
    this.hint = document.createElement('div');
    this.hint.className = 'vx-cape-hint';
    const done = document.createElement('button');
    done.className = 'vx-cape-done';
    done.type = 'button';
    done.textContent = 'Done';
    done.addEventListener('click', () => this.hide());
    foot.append(this.hint, done);

    shell.append(head, body, foot);
    this.surface.appendChild(shell);
    host.appendChild(this.surface);
  }

  get open(): boolean { return this.isOpen; }

  show(wardrobe: Wardrobe): void {
    this.wardrobe = wardrobe;
    this.render();
    this.surface.dataset.open = '1';
    this.surface.focus();
    if (!this.isOpen) { this.isOpen = true; this.onOpen?.(); }
  }

  /** Re-render with a new wardrobe (after an equip, or a cape being granted).
   *  A no-op while closed, so the owner can call it freely. */
  update(wardrobe: Wardrobe): void {
    this.wardrobe = wardrobe;
    if (this.isOpen) this.render();
  }

  hide(): void {
    this.surface.dataset.open = '0';
    if (!this.isOpen) return;
    this.isOpen = false;
    this.onClose?.();
  }

  private render(): void {
    const owned = ownedCapes(this.wardrobe);
    const ownedIds = new Set(owned.map((c) => c.id));
    const tiles: Tile[] = [{ kind: 'none' }];
    for (const cape of owned) tiles.push({ kind: 'owned', cape });
    for (const cape of CAPES) {
      if (!ownedIds.has(cape.id)) tiles.push({ kind: 'locked', cape });
    }
    // Nothing minted yet: three shrouded plates so the case looks like it is
    // waiting for capes rather than missing them.
    if (CAPES.length === 0) for (let i = 0; i < 3; i++) tiles.push({ kind: 'ghost' });

    this.grid.replaceChildren(...tiles.map((t) => this.tile(t)));
    this.tallyValue.textContent = `${owned.length} / ${CAPES.length}`;
    this.soon.hidden = CAPES.length > 0;
    const worn = owned.find((c) => c.id === this.wardrobe.equipped);
    this.hint.textContent = worn
      ? `Wearing ${worn.name}.`
      : 'Nothing on your shoulders right now.';
  }

  private tile(t: Tile): HTMLElement {
    const el = document.createElement('button');
    el.className = 'vx-cape-tile';
    el.type = 'button';

    const swatch = document.createElement('div');
    swatch.className = 'vx-cape-swatch';
    const meta = document.createElement('div');
    meta.className = 'vx-cape-meta';
    const name = document.createElement('div');
    name.className = 'vx-cape-name';
    const label = document.createElement('span');
    const blurb = document.createElement('div');
    blurb.className = 'vx-cape-blurb';
    name.appendChild(label);
    meta.append(name, blurb);
    el.append(swatch, meta);

    if (t.kind === 'ghost') {
      el.dataset.kind = 'ghost';
      el.dataset.worn = '0';
      swatch.dataset.kind = 'ghost';
      swatch.textContent = '?';
      label.textContent = 'Unrevealed';
      blurb.textContent = 'A hook with nothing on it yet.';
      el.disabled = true;
      return el;
    }

    if (t.kind === 'none') {
      swatch.dataset.kind = 'none';
      swatch.innerHTML = `<span class="vx-cape-bare">${iconSvg('wing')}</span>`;
      el.dataset.kind = 'none';
      label.textContent = 'No Cape';
      blurb.textContent = 'Bare shoulders. Nothing to catch the wind.';
      const worn = this.wardrobe.equipped === NO_CAPE;
      el.dataset.worn = worn ? '1' : '0';
      el.disabled = worn;
      el.setAttribute('aria-pressed', String(worn));
      if (worn) name.appendChild(this.wornChip());
      else el.addEventListener('click', () => this.onEquip?.(NO_CAPE));
      return el;
    }

    const { cape } = t;
    // The rarity colour drives the whole tile — its hover ring and glow, not
    // just the little chip — so a legendary reads as one from across the grid.
    el.style.setProperty('--chip', hex(RARITY_COLORS[cape.rarity]));
    label.textContent = cape.name;
    blurb.textContent = cape.blurb;
    const rarity = document.createElement('span');
    rarity.className = 'vx-cape-rarity';
    rarity.style.setProperty('--chip', hex(RARITY_COLORS[cape.rarity]));
    rarity.textContent = cape.rarity;
    meta.insertBefore(rarity, blurb);

    if (t.kind === 'locked') {
      swatch.dataset.kind = 'locked';
      swatch.innerHTML = iconSvg('lock');
      el.dataset.kind = 'locked';
      el.disabled = true;
      el.dataset.worn = '0';
      el.title = 'Not yours yet';
      return el;
    }

    // Cloth cut to a cape silhouette, its trim showing at the hem, under a
    // sheen that sweeps while the tile is hovered or worn.
    swatch.dataset.kind = 'owned';
    swatch.style.setProperty('--cloth', hex(cape.colors[0]));
    swatch.style.setProperty('--trim', hex(cape.colors[1]));
    const cloth = document.createElement('div');
    cloth.className = 'vx-cape-cloth';
    const sheen = document.createElement('div');
    sheen.className = 'vx-cape-sheen';
    swatch.append(cloth, sheen);
    el.dataset.kind = 'owned';
    const worn = this.wardrobe.equipped === cape.id;
    el.dataset.worn = worn ? '1' : '0';
    el.disabled = worn;
    el.setAttribute('aria-pressed', String(worn));
    if (worn) name.appendChild(this.wornChip());
    else el.addEventListener('click', () => this.onEquip?.(cape.id));
    return el;
  }

  private wornChip(): HTMLElement {
    const chip = document.createElement('span');
    chip.className = 'vx-cape-worn';
    chip.innerHTML = `${iconSvg('check')}<span>Worn</span>`;
    return chip;
  }
}
