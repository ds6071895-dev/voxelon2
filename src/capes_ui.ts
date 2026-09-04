// THE CAPE WARDROBE — everything you own on one board, click one to wear it.
//
// SELF-CONTAINED, the same way the government screens are: one injected <style>
// under a `vx-cape-` prefix, nothing added to index.html, and no WebGL of its
// own (the page's GL contexts are already spoken for by the world, the Duels
// ladder and the two character previews).
//
// The catalog in capes.ts is EMPTY right now, so what this actually renders is
// the honest version of that: the always-there "No Cape" slot, worn, and a
// locked plate saying capes are still to come. Every branch below is written
// for a populated catalog — fill `CAPES` and this screen becomes a collection
// grid with no changes here.

import {
  CAPES, NO_CAPE, RARITY_COLORS, type Cape, type Wardrobe,
  ownedCapes,
} from './capes';
import { iconSvg } from './emoji_icons';

const CSS = `
/* Dark scrim, daylight card — the wardrobe is a thing you read and browse, so
   it is lit like the government menu rather than like the HUD. */
.vx-cape-surface {
  position: fixed; inset: 0; z-index: 44; display: none;
  align-items: center; justify-content: center; padding: 20px;
  background: radial-gradient(120% 120% at 50% 0%, rgba(19, 31, 46, .82), rgba(5, 9, 15, .93));
  backdrop-filter: blur(4px);
  font-family: ui-sans-serif, -apple-system, 'Segoe UI', Roboto, system-ui, sans-serif;
}
.vx-cape-surface[data-open="1"] { display: flex; }
.vx-cape-surface * { box-sizing: border-box; text-shadow: none; }

.vx-cape-shell {
  --paper: #ffffff;
  --ink: #0f1826;
  --muted: #55657d;
  --faint: #8593a7;
  --line: rgba(15, 26, 44, .11);
  --tint: #f2f6fc;
  --gold: #8a5a06;
  --gold-lit: #f0a521;

  position: relative; display: flex; flex-direction: column;
  width: min(900px, 100%); height: min(660px, 100%);
  border-radius: 22px; overflow: hidden; color: var(--ink);
  background: linear-gradient(180deg, #fdfeff 0%, #eef3fa 100%);
  box-shadow: 0 40px 90px rgba(13, 27, 48, .3), 0 0 0 1px rgba(15, 26, 44, .1),
    inset 0 1px 0 rgba(255, 255, 255, .9);
}
/* A gold wash bleeding down from the top edge, behind everything. */
.vx-cape-shell::before {
  content: ''; position: absolute; inset: 0 0 auto; height: 200px; pointer-events: none;
  background: radial-gradient(78% 130% at 12% -34%, rgba(240, 165, 33, .34), transparent 68%),
    radial-gradient(64% 120% at 90% -44%, rgba(101, 139, 200, .26), transparent 70%);
  opacity: .7;
}
.vx-cape-shell > * { position: relative; z-index: 1; }

.vx-cape-head { display: flex; align-items: center; gap: 16px; padding: 18px 22px 14px; }
.vx-cape-crest {
  display: grid; place-items: center; width: 42px; height: 42px; flex: none;
  border-radius: 13px; font-size: 21px; color: var(--gold);
  background: linear-gradient(180deg, #fff8e8, #ffeec8);
  box-shadow: inset 0 0 0 1px rgba(138, 90, 6, .2);
}
.vx-cape-titles { flex: 1; min-width: 0; }
.vx-cape-eyebrow {
  font-size: 9.5px; letter-spacing: 2.8px; text-transform: uppercase; color: var(--gold);
}
.vx-cape-titles h1 {
  margin: 2px 0 0; font-size: 23px; letter-spacing: .4px; font-weight: 700; color: var(--ink);
}
.vx-cape-tally {
  display: grid; gap: 2px; justify-items: end; text-align: right; flex: none;
  padding: 7px 14px; border-radius: 13px; background: var(--paper);
  box-shadow: inset 0 0 0 1px var(--line);
}
.vx-cape-tally b { font-size: 16px; font-variant-numeric: tabular-nums; }
.vx-cape-tally small {
  font-size: 9px; letter-spacing: 1.6px; text-transform: uppercase; color: var(--faint);
}
.vx-cape-x {
  flex: none; width: 36px; height: 36px; display: grid; place-items: center;
  border: 0; border-radius: 11px; cursor: pointer; font-size: 14px;
  color: var(--muted); background: var(--paper); box-shadow: inset 0 0 0 1px var(--line);
}
.vx-cape-x:hover { color: var(--ink); background: var(--tint); }

/* The board itself. One scroller so a big collection never pushes the footer
   off the card. */
.vx-cape-body { flex: 1; min-height: 0; overflow-y: auto; padding: 4px 22px 18px; }
.vx-cape-grid {
  display: grid; gap: 12px; margin: 0;
  grid-template-columns: repeat(auto-fill, minmax(190px, 1fr));
}

/* A tile IS the equip button — no second click target inside it. */
.vx-cape-tile {
  display: flex; flex-direction: column; gap: 0; padding: 0; overflow: hidden;
  text-align: left; cursor: pointer; font: inherit; color: var(--ink);
  border: 0; border-radius: 16px; background: var(--paper);
  box-shadow: 0 8px 20px rgba(13, 27, 48, .09), inset 0 0 0 1px var(--line);
  transition: transform .12s ease, box-shadow .12s ease;
}
.vx-cape-tile:hover:not(:disabled) { transform: translateY(-2px); }
.vx-cape-tile:disabled { cursor: default; opacity: .72; }
.vx-cape-tile[data-worn="1"] {
  box-shadow: 0 12px 26px rgba(240, 165, 33, .26), inset 0 0 0 2px var(--gold-lit);
}
/* The swatch: the cape's own cloth, with its trim down the right edge. */
.vx-cape-swatch {
  position: relative; height: 108px; flex: none;
  background: linear-gradient(180deg, var(--cloth), color-mix(in srgb, var(--cloth) 72%, #000));
}
.vx-cape-swatch::after {
  content: ''; position: absolute; inset: 0 0 0 auto; width: 14px; background: var(--trim);
}
/* The bare slot and the locked plate get a drawn placeholder, not a colour. */
.vx-cape-swatch[data-kind="none"] {
  background: repeating-linear-gradient(135deg, #eef2f7 0 9px, #e4eaf2 9px 18px);
}
.vx-cape-swatch[data-kind="none"]::after { display: none; }
.vx-cape-swatch[data-kind="locked"] {
  display: grid; place-items: center; font-size: 26px; color: #9fb0c4;
  background: repeating-linear-gradient(135deg, #f2f5f9 0 9px, #e8edf4 9px 18px);
}
.vx-cape-swatch[data-kind="locked"]::after { display: none; }

.vx-cape-meta { display: grid; gap: 5px; padding: 11px 13px 13px; }
.vx-cape-name {
  display: flex; align-items: center; gap: 7px;
  font-size: 14px; font-weight: 700; letter-spacing: .2px;
}
.vx-cape-worn {
  margin-left: auto; flex: none; display: inline-flex; align-items: center; gap: 4px;
  padding: 2px 8px; border-radius: 999px; font-size: 8.5px; font-weight: 700;
  letter-spacing: 1.4px; text-transform: uppercase;
  color: #4a3000; background: linear-gradient(180deg, #ffd98a, #f4b53c);
}
.vx-cape-rarity {
  justify-self: start; padding: 2px 8px; border-radius: 999px;
  font-size: 8.5px; font-weight: 700; letter-spacing: 1.5px; text-transform: uppercase;
  color: var(--chip); background: color-mix(in srgb, var(--chip) 14%, #fff);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--chip) 32%, transparent);
}
.vx-cape-blurb { font-size: 11.5px; line-height: 1.45; color: var(--muted); }

/* Shown while the catalog is empty: says why the board is bare, in the same
   voice as the rest of the game rather than as an error. */
/* The class sets display, so it must also beat the UA's [hidden] rule. */
.vx-cape-soon[hidden] { display: none; }
.vx-cape-soon {
  display: flex; align-items: center; gap: 14px; margin: 14px 0 0; padding: 16px 18px;
  border-radius: 16px; color: var(--muted); background: var(--paper);
  box-shadow: inset 0 0 0 1px var(--line);
}
.vx-cape-soon-icon {
  display: grid; place-items: center; width: 38px; height: 38px; flex: none;
  border-radius: 12px; font-size: 19px; color: #6f8098; background: var(--tint);
}
.vx-cape-soon b { display: block; color: var(--ink); font-size: 13px; margin-bottom: 3px; }
.vx-cape-soon span { font-size: 11.5px; line-height: 1.5; }

.vx-cape-foot {
  display: flex; align-items: center; gap: 12px;
  padding: 13px 22px 18px; border-top: 1px solid var(--line);
}
.vx-cape-hint { flex: 1; font-size: 11px; color: var(--faint); }
.vx-cape-done {
  border: 0; border-radius: 12px; padding: 11px 26px; cursor: pointer;
  font: inherit; font-size: 10px; font-weight: 700; letter-spacing: 1.6px;
  text-transform: uppercase; color: #26180a;
  background: linear-gradient(180deg, #ffd06a, #eda01a);
  box-shadow: 0 10px 24px rgba(215, 138, 12, .32);
}
.vx-cape-done:hover { filter: brightness(1.06); }

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
  | { kind: 'locked'; cape: Cape };

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

    if (t.kind === 'none') {
      swatch.dataset.kind = 'none';
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
      el.disabled = true;
      el.dataset.worn = '0';
      el.title = 'Not yours yet';
      return el;
    }

    swatch.style.setProperty('--cloth', hex(cape.colors[0]));
    swatch.style.setProperty('--trim', hex(cape.colors[1]));
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
