// THE CAPE WARDROBE — everything you own on one board, click one to wear it.
//
// SELF-CONTAINED, the same way the government screens are: one injected <style>
// under a `vx-cape-` prefix and nothing added to index.html.
//
// It is lit like a DAYLIT DRESSING ROOM rather than the black-glass vault the
// rest of the title screen wears. A wardrobe is the one place in the game you
// are judging colour, and cloth colours cannot be judged against near-black:
// every swatch read as "dark version of itself" and two capes a shade apart
// were indistinguishable. On paper white they read as themselves.
//
// Capes are shown as cloth swatches. This gallery needs no player renderer.

import {
  CAPES, NO_CAPE, RARITY_COLORS, type Cape, type Wardrobe,
  ownedCapes,
} from './capes';
import { iconSvg } from './emoji_icons';

const CSS = `
/* THE DAYLIT ROOM. Paper, glass and one warm accent — the opposite of the
   vault the title screen is lit as, on purpose: cloth colour is the whole
   subject of this screen and it can only be read against white. */
.vx-cape-surface {
  position: fixed; inset: 0; z-index: 44; display: none;
  align-items: center; justify-content: center; padding: 20px;
  background:
    radial-gradient(ellipse 60% 50% at 12% 0%, rgba(255, 214, 148, .5), transparent 62%),
    radial-gradient(ellipse 60% 50% at 88% 6%, rgba(168, 205, 255, .45), transparent 64%),
    radial-gradient(ellipse 120% 95% at 50% 45%, rgba(236, 240, 247, .88) 30%, rgba(220, 227, 238, .95) 100%);
  backdrop-filter: blur(7px) saturate(1.05);
  font-family: ui-sans-serif, -apple-system, 'Segoe UI', Roboto, system-ui, sans-serif;
}
.vx-cape-surface[data-open="1"] { display: flex; animation: vx-cape-in .22s ease both; }
.vx-cape-surface * { box-sizing: border-box; text-shadow: none; }
@keyframes vx-cape-in { from { opacity: 0; } }

.vx-cape-shell {
  --ink: #16202e;
  --ink-soft: #435771;
  --ink-mute: #6f8298;
  --line: rgba(22, 42, 70, .14);
  --line-firm: rgba(22, 42, 70, .22);
  --plate: rgba(24, 46, 78, .045);
  --paper: #f7f9fc;
  --card: #ffffff;
  --gold: #b07c14;
  --gold-lit: #e5a72b;
  --gold-deep: #855a06;

  position: relative; display: flex; flex-direction: column;
  width: min(940px, 100%); height: min(680px, 100%);
  border-radius: 24px; overflow: hidden; color: var(--ink);
  background: linear-gradient(180deg, #ffffff, var(--paper));
  box-shadow: 0 40px 90px rgba(24, 40, 66, .26), inset 0 0 0 1px var(--line),
    inset 0 1px 0 rgba(255, 255, 255, .9);
  animation: vx-cape-rise .26s cubic-bezier(.2, .9, .3, 1) both;
}
@keyframes vx-cape-rise { from { transform: translateY(14px) scale(.985); opacity: 0; } }

/* Daylight from over your shoulder, plus the faint grid the rest of the game's
   menus wear — drawn in ink here rather than in light. */
.vx-cape-shell::before {
  content: ''; position: absolute; inset: 0; pointer-events: none;
  background:
    radial-gradient(74% 120% at 14% -26%, rgba(255, 205, 122, .28), transparent 66%),
    radial-gradient(64% 110% at 92% -34%, rgba(150, 190, 245, .26), transparent 70%);
}
.vx-cape-shell::after {
  content: ''; position: absolute; inset: 0; pointer-events: none;
  background:
    linear-gradient(rgba(40, 70, 110, .05) 1px, transparent 1px),
    linear-gradient(90deg, rgba(40, 70, 110, .05) 1px, transparent 1px);
  background-size: 34px 34px;
  -webkit-mask-image: linear-gradient(180deg, transparent 40%, #000 100%);
  mask-image: linear-gradient(180deg, transparent 40%, #000 100%);
}
.vx-cape-shell > * { position: relative; z-index: 1; }

.vx-cape-head {
  display: flex; align-items: center; gap: 16px; padding: 20px 24px 16px;
  border-bottom: 1px solid var(--line);
}
.vx-cape-crest {
  display: grid; place-items: center; width: 46px; height: 46px; flex: none;
  border-radius: 14px; font-size: 23px; color: #2a1c02;
  background: linear-gradient(160deg, #ffd980, var(--gold-lit) 52%, var(--gold));
  box-shadow: 0 8px 20px rgba(176, 124, 20, .28), inset 0 1px 0 rgba(255, 255, 255, .75);
}
.vx-cape-titles { flex: 1; min-width: 0; }
.vx-cape-eyebrow {
  display: flex; align-items: center; gap: 8px;
  font-size: 9px; letter-spacing: 2.6px; text-transform: uppercase; color: var(--gold);
  font-weight: 700;
}
.vx-cape-eyebrow::after {
  content: ''; flex: 1; height: 1px; max-width: 120px;
  background: linear-gradient(90deg, rgba(176, 124, 20, .45), transparent);
}
.vx-cape-titles h1 {
  margin: 3px 0 0; font-size: 25px; font-weight: 700; letter-spacing: 1.6px;
  font-family: 'Lucida Console', Monaco, monospace; color: var(--ink);
}
.vx-cape-tally {
  display: grid; gap: 2px; justify-items: end; text-align: right; flex: none;
  padding: 8px 15px; border-radius: 14px;
  background: var(--card); box-shadow: inset 0 0 0 1px var(--line), 0 2px 6px rgba(24, 40, 66, .06);
}
.vx-cape-tally b {
  font-size: 17px; font-variant-numeric: tabular-nums; color: var(--gold);
  font-family: 'Lucida Console', Monaco, monospace;
}
.vx-cape-tally small {
  font-size: 8.5px; letter-spacing: 1.7px; text-transform: uppercase; color: var(--ink-mute);
  font-weight: 700;
}
.vx-cape-x {
  flex: none; width: 38px; height: 38px; display: grid; place-items: center;
  border: 0; border-radius: 12px; cursor: pointer; font-size: 14px;
  color: var(--ink-soft); background: var(--card);
  box-shadow: inset 0 0 0 1px var(--line), 0 2px 6px rgba(24, 40, 66, .06);
  transition: color .14s ease, background .14s ease, transform .14s ease;
}
.vx-cape-x:hover {
  color: #a3131b; background: rgba(214, 42, 52, .1); transform: rotate(90deg);
  box-shadow: inset 0 0 0 1px rgba(214, 42, 52, .35);
}

/* The board itself. One scroller so a big collection never pushes the footer
   off the card. */
.vx-cape-body { flex: 1; min-height: 0; overflow-y: auto; padding: 18px 24px 20px; }
.vx-cape-body::-webkit-scrollbar { width: 8px; }
.vx-cape-body::-webkit-scrollbar-thumb {
  border-radius: 8px; background: rgba(40, 70, 110, .2);
}

/* An equipped cloth swatch beside its name and description. */
.vx-cape-showcase {
  display: flex; gap: 22px; align-items: center; padding: 22px;
  margin-bottom: 26px; border: 1px solid var(--line); border-radius: 18px;
  background: #f4f7fb;
}
.vx-cape-showcase small { color: var(--gold-deep); font-size: 10px; font-weight: 700; letter-spacing: 1.4px; text-transform: uppercase; }
.vx-cape-showcase h2 { margin: 8px 0; font-size: 24px; letter-spacing: -.6px; color: var(--ink); }
.vx-cape-showcase p { margin: 0; max-width: 48ch; color: var(--ink-soft); font-size: 13px; line-height: 1.6; }
.vx-cape-equipped-swatch {
  position: relative; display: grid; place-items: center; flex: none;
  width: 100px; height: 116px; border: 1px solid var(--line); border-radius: 14px;
  background: #fff; color: #8194ab; font-size: 38px; overflow: hidden;
}
.vx-cape-equipped-swatch .vx-cape-cloth { inset: 14px 18px; }

.vx-cape-collection h2 {
  margin: 0 0 12px; font-size: 11px; font-weight: 700; letter-spacing: 2.2px;
  text-transform: uppercase; color: var(--ink-mute);
}
.vx-cape-grid {
  display: grid; gap: 14px; margin: 0;
  grid-template-columns: repeat(auto-fill, minmax(196px, 1fr));
}

/* A tile IS the equip button — no second click target inside it. */
.vx-cape-tile {
  --chip: #64748b;
  position: relative; display: flex; flex-direction: column; gap: 0; padding: 0;
  overflow: hidden; text-align: left; cursor: pointer; font: inherit; color: var(--ink);
  border: 0; border-radius: 18px; background: var(--card);
  box-shadow: 0 6px 18px rgba(24, 40, 66, .09), inset 0 0 0 1px var(--line);
  transition: transform .16s cubic-bezier(.2, .9, .3, 1), box-shadow .16s ease;
}
.vx-cape-tile:hover:not(:disabled) {
  transform: translateY(-4px);
  box-shadow: 0 16px 32px rgba(24, 40, 66, .16),
    inset 0 0 0 1px color-mix(in srgb, var(--chip) 55%, transparent),
    0 0 24px color-mix(in srgb, var(--chip) 18%, transparent);
}
.vx-cape-tile:focus-visible {
  outline: 2px solid var(--gold); outline-offset: 3px;
}
.vx-cape-tile:disabled { cursor: default; }
.vx-cape-tile[data-kind="locked"] { opacity: .66; }
/* The one you are wearing keeps a gold ring and a warm page. */
.vx-cape-tile[data-worn="1"] {
  background: linear-gradient(180deg, #fffaee, #fff5e0);
  box-shadow: 0 12px 28px rgba(176, 124, 20, .18), inset 0 0 0 2px var(--gold-lit);
}

/* The swatch is the cape itself: cloth cut to a cape silhouette, trim showing
   at the hem, folds raked across it and a slow sheen travelling over the top. */
.vx-cape-swatch {
  position: relative; height: 132px; flex: none; overflow: hidden;
  background:
    radial-gradient(80% 100% at 50% 0%, rgba(255, 255, 255, .9), transparent 70%),
    linear-gradient(180deg, #eef2f8, #dde4ee);
}
.vx-cape-cloth {
  position: absolute; inset: 10px 26px -6px; background: var(--trim, #94a3b8);
  clip-path: polygon(31% 0, 69% 0, 100% 100%, 50% 88%, 0 100%);
  filter: drop-shadow(0 8px 14px rgba(24, 40, 66, .28));
}
.vx-cape-cloth::before {
  content: ''; position: absolute; inset: 5px 6px 9px;
  clip-path: polygon(31% 0, 69% 0, 100% 100%, 50% 88%, 0 100%);
  background:
    repeating-linear-gradient(96deg, rgba(0, 0, 0, .16) 0 2px, transparent 2px 15px),
    linear-gradient(178deg, color-mix(in srgb, var(--cloth) 88%, #fff) 0%,
      var(--cloth) 34%, color-mix(in srgb, var(--cloth) 62%, #000) 100%);
}
/* The clasp across the shoulders. */
.vx-cape-cloth::after {
  content: ''; position: absolute; top: 2px; left: 50%; width: 34%; height: 5px;
  transform: translateX(-50%); border-radius: 4px;
  background: linear-gradient(180deg, color-mix(in srgb, var(--trim) 62%, #fff), var(--trim));
  box-shadow: 0 1px 3px rgba(24, 40, 66, .35);
}
.vx-cape-sheen {
  position: absolute; inset: 0; pointer-events: none;
  background: linear-gradient(74deg, transparent 36%, rgba(255, 255, 255, .55) 50%, transparent 64%);
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
    repeating-linear-gradient(135deg, rgba(40, 70, 110, .05) 0 10px, transparent 10px 20px),
    linear-gradient(180deg, #f1f4f9, #e3e9f2);
}
.vx-cape-swatch[data-kind="none"] .vx-cape-bare {
  font-size: 34px; color: rgba(40, 70, 110, .3);
}
.vx-cape-lock {
  position: absolute; inset: 0; display: grid; place-items: center;
  font-size: 26px; color: rgba(15, 25, 40, .55);
  background: rgba(240, 244, 250, .55);
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
  color: #2a1a02; background: linear-gradient(180deg, #ffd980, var(--gold-lit));
  box-shadow: 0 2px 8px rgba(176, 124, 20, .35);
}
.vx-cape-worn svg { font-size: 11px; }
.vx-cape-rarity {
  justify-self: start; padding: 3px 9px; border-radius: 999px;
  font-size: 8.5px; font-weight: 700; letter-spacing: 1.5px; text-transform: uppercase;
  color: color-mix(in srgb, var(--chip) 72%, #000);
  background: color-mix(in srgb, var(--chip) 16%, #fff);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--chip) 42%, transparent);
}
.vx-cape-blurb { font-size: 11.5px; line-height: 1.45; color: var(--ink-mute); }

/* Shown while the catalog is empty: says why the board is bare, in the same
   voice as the rest of the game rather than as an error. */
/* The class sets display, so it must also beat the UA's [hidden] rule. */
.vx-cape-soon[hidden] { display: none; }
.vx-cape-soon {
  display: flex; align-items: center; gap: 15px; margin: 16px 0 0; padding: 17px 19px;
  border-radius: 18px; color: var(--ink-soft);
  background: linear-gradient(180deg, #fffbf1, #fff6e2);
  box-shadow: inset 0 0 0 1px rgba(176, 124, 20, .26);
}
.vx-cape-soon-icon {
  display: grid; place-items: center; width: 42px; height: 42px; flex: none;
  border-radius: 13px; font-size: 21px; color: var(--gold);
  background: rgba(229, 167, 43, .16); box-shadow: inset 0 0 0 1px rgba(176, 124, 20, .3);
  animation: vx-cape-pulse 2.8s ease-in-out infinite;
}
@keyframes vx-cape-pulse { 50% { box-shadow: inset 0 0 0 1px rgba(176,124,20,.55), 0 0 18px rgba(229,167,43,.4); } }
.vx-cape-soon b { display: block; color: var(--ink); font-size: 13px; margin-bottom: 3px; }
.vx-cape-soon span { font-size: 11.5px; line-height: 1.5; }

.vx-cape-foot {
  display: flex; align-items: center; gap: 12px;
  padding: 14px 24px 20px; border-top: 1px solid var(--line);
  background: linear-gradient(180deg, transparent, rgba(24, 46, 78, .05));
}
.vx-cape-hint {
  flex: 1; font-size: 11px; color: var(--ink-mute); letter-spacing: .3px;
}
.vx-cape-done {
  border: 0; border-radius: 13px; padding: 12px 28px; cursor: pointer;
  font: inherit; font-size: 10px; font-weight: 700; letter-spacing: 1.7px;
  text-transform: uppercase; color: #241703;
  background: linear-gradient(180deg, #ffd980, var(--gold-lit));
  box-shadow: 0 8px 20px rgba(176, 124, 20, .3);
  transition: filter .14s ease, transform .14s ease, box-shadow .14s ease;
}
.vx-cape-done:hover {
  filter: brightness(1.06); transform: translateY(-1px);
  box-shadow: 0 12px 26px rgba(176, 124, 20, .38);
}
.vx-cape-done:active { transform: translateY(1px); }

@media (prefers-reduced-motion: reduce) {
  .vx-cape-surface[data-open="1"], .vx-cape-shell { animation: none; }
  .vx-cape-sheen, .vx-cape-soon-icon { animation: none; }
}
@media (max-width: 620px) {
  .vx-cape-surface { padding: 0; }
  .vx-cape-shell { width: 100%; height: 100%; border-radius: 0; }
  .vx-cape-tally { display: none; }
  .vx-cape-showcase { padding: 16px; gap: 16px; }
  .vx-cape-equipped-swatch { width: 70px; height: 90px; }
}
`;

let styled = false;
function injectStyle(): void {
  if (styled) return;
  styled = true;
  const tag = document.createElement('style');
  tag.textContent = CSS;
  document.head.appendChild(tag);
}

function hex(n: number): string { return `#${n.toString(16).padStart(6, '0')}`; }

/** What one tile renders. `none` is the bare-shoulders slot, `locked` is a
 *  catalog cape you have not earned. */
type Tile =
  | { kind: 'none' }
  | { kind: 'owned'; cape: Cape }
  | { kind: 'locked'; cape: Cape };

export class CapesUI {
  private readonly surface: HTMLElement;
  private readonly grid: HTMLElement;
  private readonly showcase: HTMLElement;
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
    this.showcase = document.createElement('div');
    this.showcase.className = 'vx-cape-showcase';
    this.grid = document.createElement('div');
    this.grid.className = 'vx-cape-grid';
    this.soon = document.createElement('div');
    this.soon.className = 'vx-cape-soon';
    const soonIcon = document.createElement('div');
    soonIcon.className = 'vx-cape-soon-icon';
    soonIcon.innerHTML = iconSvg('sparkle');
    const soonText = document.createElement('div');
    const soonTitle = document.createElement('b');
    soonTitle.textContent = 'Your collection starts here';
    const soonBody = document.createElement('span');
    soonBody.textContent =
      'No capes are available yet. When capes arrive, this is where you will find and equip them.';
    soonText.append(soonTitle, soonBody);
    this.soon.append(soonIcon, soonText);
    const collection = document.createElement('div');
    collection.className = 'vx-cape-collection';
    const collectionTitle = document.createElement('h2');
    collectionTitle.textContent = 'Your collection';
    collection.append(collectionTitle, this.grid, this.soon);
    body.append(this.showcase, collection);

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

  /** Refresh after equipping or earning a cape; defer rendering while closed. */
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

    this.grid.replaceChildren(...tiles.map((t) => this.tile(t)));
    this.tallyValue.textContent = String(owned.length);
    this.soon.hidden = CAPES.length > 0;
    const worn = owned.find((c) => c.id === this.wardrobe.equipped) ?? null;

    const swatch = document.createElement('div');
    swatch.className = 'vx-cape-equipped-swatch';
    swatch.setAttribute('aria-hidden', 'true');
    if (worn) {
      swatch.style.setProperty('--cloth', hex(worn.colors[0]));
      swatch.style.setProperty('--trim', hex(worn.colors[1]));
      const cloth = document.createElement('div');
      cloth.className = 'vx-cape-cloth';
      swatch.append(cloth);
    } else {
      swatch.innerHTML = iconSvg('wing');
    }
    const details = document.createElement('div');
    const status = document.createElement('small'); status.textContent = 'Currently equipped';
    const name = document.createElement('h2'); name.textContent = worn?.name ?? 'No cape equipped';
    const description = document.createElement('p');
    description.textContent = worn?.blurb ?? 'Keep it simple, or choose a cape from your collection below.';
    details.append(status, name, description);
    this.showcase.replaceChildren(swatch, details);

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

    swatch.style.setProperty('--cloth', hex(cape.colors[0]));
    swatch.style.setProperty('--trim', hex(cape.colors[1]));
    if (t.kind === 'locked') {
      swatch.dataset.kind = 'locked';
      swatch.innerHTML = `<div class="vx-cape-cloth"></div><span class="vx-cape-lock">${iconSvg('lock')}</span>`;
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
