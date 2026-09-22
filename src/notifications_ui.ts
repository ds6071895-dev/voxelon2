// THE DISPATCH INBOX — faction news that should outlast a three-second toast
// (a new citizen swearing allegiance, for one).
//
// SELF-CONTAINED by design. Every style it needs is in the <style> block it
// injects, under a `vx-notif-` prefix that appears nowhere else in the project.
// It adds nothing to index.html, so there is no global stylesheet it can collide
// with and nothing else can change how it looks. The same is true of
// faction_picker.ts.
//
// Text that carries a username is only ever written with `textContent` — it
// never reaches innerHTML, so a name cannot become markup.

import { iconSvg, type IconName } from './emoji_icons';
import type { Notification, NotificationKind } from './net/protocol';

/** Newest entries kept. Older ones fall off — this is a dispatch board, not an
 *  archive, and the server only ever replays the last handful anyway. */
const MAX_ENTRIES = 60;

const KIND_ICON: Record<NotificationKind, IconName> = {
  system: 'flag',
};

/** One hue per dispatch kind, picked to clear text contrast on white — the
 *  panel runs on paper, so the slate-theme pastels these replaced washed out
 *  against it. Used for the rule, the glyph chip, the unread wash and the pip. */
const KIND_TONE: Record<NotificationKind, string> = {
  system: '#5b6b82',
};

const CSS = `
/* THE DAYLIGHT SKIN. The inbox reads like post rather than a terminal: white
   cards on a soft wash, ink type, and each dispatch kind carrying its own hue
   in exactly two places — the rule down its left edge and the glyph chip.

   Scoped entirely to the vx-notif- prefix, injected from here, nothing in
   index.html. */
.vx-notif-bell {
  position: relative; display: inline-flex; align-items: center; justify-content: center;
  width: 42px; height: 42px; border: 0; border-radius: 13px; cursor: pointer;
  font-size: 17px; color: #24344a; background: rgba(255, 255, 255, .93);
  box-shadow: inset 0 0 0 1px rgba(15, 26, 44, .12), 0 6px 18px rgba(15, 26, 44, .18);
  backdrop-filter: blur(6px);
  transition: background .15s, transform .12s, box-shadow .15s;
}
.vx-notif-bell:hover {
  background: #fff; transform: translateY(-1px);
  box-shadow: inset 0 0 0 1px rgba(15, 26, 44, .18), 0 10px 24px rgba(15, 26, 44, .24);
}
.vx-notif-bell:focus-visible { outline: 2px solid #f0a521; outline-offset: 2px; }
/* Both bells are viewport-fixed. The title screen scrolls on a short window,
   and an absolutely-positioned bell would scroll away with it. */
.vx-notif-bell[data-place="title"] { position: fixed; top: 16px; right: 16px; z-index: 6; }

/* THE HUD BELL IS A GUEST. It sits over live play, where the daylight chip read
   as a bright white card pasted on the world, so here it wears the HUD's own
   dark glass, shrinks, and idles at half opacity — brightening only on hover,
   on focus, or when there is actually something unread. It also keeps clear of
   its neighbours: it stays under the vault boss banner (z 18) and the panels
   (z 20+), and on touch it drops below the top-right utility row instead of
   landing on top of the inventory / command / pause buttons. */
.vx-notif-bell[data-place="hud"] {
  position: fixed; z-index: 5;
  top: max(12px, env(safe-area-inset-top, 0px));
  right: max(12px, env(safe-area-inset-right, 0px));
  width: 36px; height: 36px; border-radius: 11px; font-size: 15px;
  color: #dce6f5; background: rgba(16, 20, 32, .42);
  box-shadow: inset 0 0 0 2px rgba(255, 255, 255, .28);
  backdrop-filter: none; opacity: .5;
  transition: background .15s, transform .12s, box-shadow .15s, opacity .15s;
}
.vx-notif-bell[data-place="hud"]:hover,
.vx-notif-bell[data-place="hud"]:focus-visible,
.vx-notif-bell[data-place="hud"][data-unread="1"] { opacity: 1; }
.vx-notif-bell[data-place="hud"]:hover {
  background: rgba(16, 20, 32, .66);
  box-shadow: inset 0 0 0 2px rgba(255, 255, 255, .46), 0 6px 18px rgba(0, 0, 0, .45);
}
.vx-notif-bell[data-place="hud"] .vx-notif-badge {
  top: -4px; right: -4px; min-width: 16px; height: 16px; border-radius: 8px;
  box-shadow: 0 2px 8px rgba(237, 160, 26, .55), 0 0 0 2px rgba(16, 20, 32, .9);
}
/* touch.ts's .t-utils row: top edge var(--edge-t) = max(8px, safe-top), 46px
   buttons (40px once the small-screen rules kick in). Clear it by a row. */
@media (pointer: coarse) {
  .vx-notif-bell[data-place="hud"] {
    top: calc(max(8px, env(safe-area-inset-top, 0px)) + 54px);
    right: max(8px, env(safe-area-inset-right, 0px));
  }
}
@media (pointer: coarse) and (max-width: 380px) {
  .vx-notif-bell[data-place="hud"] { top: calc(max(8px, env(safe-area-inset-top, 0px)) + 48px); }
}
@media (pointer: coarse) and (max-height: 620px) {
  .vx-notif-bell[data-place="hud"] { top: calc(max(8px, env(safe-area-inset-top, 0px)) + 48px); }
}
.vx-notif-badge {
  position: absolute; top: -5px; right: -5px; min-width: 18px; height: 18px; padding: 0 5px;
  display: none; align-items: center; justify-content: center; border-radius: 9px;
  font: 800 10px/1 ui-sans-serif, system-ui, sans-serif; color: #3b2708;
  background: linear-gradient(180deg, #ffd77a, #f0a521);
  box-shadow: 0 2px 8px rgba(237, 160, 26, .55), 0 0 0 2px rgba(255, 255, 255, .9);
}
.vx-notif-bell[data-unread="1"] .vx-notif-badge { display: flex; }
.vx-notif-bell[data-unread="1"] { animation: vx-notif-ring 1.6s ease-out 2; }
@keyframes vx-notif-ring {
  0%, 100% { transform: rotate(0); } 20% { transform: rotate(-11deg); }
  40% { transform: rotate(9deg); } 60% { transform: rotate(-5deg); } 80% { transform: rotate(3deg); }
}

.vx-notif-surface {
  position: fixed; inset: 0; z-index: 40; display: none;
  align-items: center; justify-content: flex-end; padding: 22px;
  background: linear-gradient(90deg, rgba(15, 26, 44, .28), rgba(15, 26, 44, .46));
  backdrop-filter: blur(4px);
  font-family: ui-sans-serif, -apple-system, 'Segoe UI', Roboto, system-ui, sans-serif;
}
.vx-notif-surface[data-open="1"] { display: flex; }
.vx-notif-surface * { text-shadow: none; box-sizing: border-box; }
.vx-notif-panel {
  display: flex; flex-direction: column; width: min(440px, 100%); max-height: 100%;
  border-radius: 20px; overflow: hidden; color: #0f1826;
  background: linear-gradient(180deg, #ffffff, #eff4fa);
  box-shadow: 0 36px 80px rgba(13, 27, 48, .38), 0 0 0 1px rgba(15, 26, 44, .1),
    inset 0 1px 0 rgba(255, 255, 255, .9);
  animation: vx-notif-slide .22s cubic-bezier(.22, 1, .36, 1);
}
@keyframes vx-notif-slide {
  from { opacity: 0; transform: translateX(22px) scale(.985); }
  to { opacity: 1; transform: none; }
}
.vx-notif-head {
  display: flex; align-items: center; gap: 10px; padding: 15px 16px;
  border-bottom: 1px solid rgba(15, 26, 44, .09);
  background: linear-gradient(180deg, #fff, rgba(255, 255, 255, .4));
}
/* The bell glyph in the header, given the same tinted chip the dispatches use
   so the panel and its contents read as one family. */
.vx-notif-crest {
  display: flex; align-items: center; justify-content: center; flex: none;
  width: 32px; height: 32px; border-radius: 11px; font-size: 16px;
  color: #8a5a06; background: linear-gradient(180deg, #fff6e3, #ffeccb);
  box-shadow: inset 0 0 0 1px rgba(200, 137, 26, .3);
}
.vx-notif-head h2 {
  flex: 1; margin: 0; font-size: 15px; font-weight: 800; letter-spacing: -.2px;
  text-transform: none; color: #0f1826;
}
.vx-notif-head small { color: #8593a7; font-size: 10.5px; letter-spacing: .3px; }
.vx-notif-act {
  border: 0; border-radius: 9px; padding: 8px 11px; cursor: pointer;
  font: 700 9.5px/1 inherit; letter-spacing: 1.1px; text-transform: uppercase;
  color: #2b3a4f; background: #fff;
  box-shadow: inset 0 0 0 1px rgba(15, 26, 44, .13), 0 1px 2px rgba(15, 26, 44, .06);
  transition: box-shadow .15s, transform .12s;
}
.vx-notif-act:hover {
  transform: translateY(-1px);
  box-shadow: inset 0 0 0 1px rgba(15, 26, 44, .22), 0 6px 16px rgba(15, 26, 44, .12);
}
.vx-notif-act:focus-visible { outline: 2px solid #f0a521; outline-offset: 2px; }

.vx-notif-list { flex: 1; min-height: 0; overflow-y: auto; padding: 11px; }
.vx-notif-list::-webkit-scrollbar { width: 9px; }
.vx-notif-list::-webkit-scrollbar-thumb { border-radius: 5px; background: rgba(15, 26, 44, .17); }
.vx-notif-list::-webkit-scrollbar-thumb:hover { background: rgba(15, 26, 44, .3); }

.vx-notif-item {
  position: relative; overflow: hidden;
  display: grid; grid-template-columns: 32px 1fr; gap: 12px; align-items: start;
  padding: 13px 14px 13px 16px; margin-bottom: 9px; border-radius: 14px; background: #fff;
  box-shadow: inset 0 0 0 1px rgba(15, 26, 44, .09), 0 4px 14px rgba(15, 26, 44, .05);
  transition: box-shadow .16s, transform .16s;
}
.vx-notif-item:hover {
  transform: translateY(-1px);
  box-shadow: inset 0 0 0 1px rgba(15, 26, 44, .16), 0 10px 24px rgba(15, 26, 44, .1);
}
/* The kind's colour, carried as a rule down the left edge. */
.vx-notif-item::before {
  content: ''; position: absolute; left: 0; top: 0; bottom: 0; width: 4px;
  background: var(--tone, #8593a7);
}
.vx-notif-item[data-unread="1"] {
  background: linear-gradient(100deg, color-mix(in srgb, var(--tone, #8593a7) 11%, #fff), #fff 62%);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--tone, #8593a7) 34%, transparent),
    0 6px 18px rgba(15, 26, 44, .07);
}
.vx-notif-mark {
  display: flex; align-items: center; justify-content: center; width: 32px; height: 32px;
  border-radius: 11px; font-size: 15px; color: var(--tone, #8593a7);
  background: color-mix(in srgb, var(--tone, #8593a7) 13%, #fff);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--tone, #8593a7) 26%, transparent);
}
.vx-notif-title {
  display: flex; align-items: center; gap: 7px;
  font-size: 12.5px; font-weight: 800; letter-spacing: -.1px; color: #0f1826;
}
.vx-notif-title span { flex: 1; min-width: 0; overflow-wrap: anywhere; }
/* The unread pip. Colour alone would be the only cue otherwise, and a tinted
   card is easy to miss in a long board. */
.vx-notif-title .vx-notif-dot {
  flex: none; width: 7px; height: 7px; border-radius: 50%; background: var(--tone, #8593a7);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--tone, #8593a7) 20%, transparent);
}
.vx-notif-body { margin-top: 5px; font-size: 12.5px; line-height: 1.55; color: #3f4f68; overflow-wrap: anywhere; }
.vx-notif-when {
  margin-top: 6px; font-size: 9.5px; letter-spacing: 1.1px; text-transform: uppercase; color: #97a3b5;
}
.vx-notif-empty {
  padding: 52px 22px; text-align: center; color: #8593a7; font-size: 12.5px; line-height: 1.65;
}
.vx-notif-empty i {
  display: flex; align-items: center; justify-content: center; width: 46px; height: 46px;
  margin: 0 auto 14px; border-radius: 15px; font-size: 21px; font-style: normal; color: #9aa7ba;
  background: #fff; box-shadow: inset 0 0 0 1px rgba(15, 26, 44, .1);
}

@media (max-width: 620px) {
  .vx-notif-surface { padding: 0; align-items: stretch; justify-content: stretch; }
  .vx-notif-panel { width: 100%; max-height: none; border-radius: 0; animation: none; }
}
@media (prefers-reduced-motion: reduce) {
  .vx-notif-panel { animation: none; }
  .vx-notif-bell[data-unread="1"] { animation: none; }
  .vx-notif-item { transition: none; }
}
`;

let styleInjected = false;
function injectStyle(): void {
  if (styleInjected) return;
  styleInjected = true;
  const el = document.createElement('style');
  el.id = 'vx-notif-style';
  el.textContent = CSS;
  document.head.appendChild(el);
}

/** "just now" / "14m" / "3h" / "2d". */
function ago(at: number, now: number): string {
  const s = Math.max(0, (now - at) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export class NotificationsUI {
  private readonly surface: HTMLElement;
  private readonly list: HTMLElement;
  private readonly countEl: HTMLElement;
  private readonly bells: HTMLElement[] = [];
  private entries: Notification[] = [];
  /** Ids the player has seen. Per-account, mirrored in localStorage so the
   *  badge does not scream at you again after a reload. */
  private read = new Set<string>();
  private account = '';
  private isOpen = false;

  /** Pointer-lock handshake, wired the same way the command box does it. */
  onOpen?: () => void;
  onClose?: () => void;

  constructor(private readonly host: HTMLElement) {
    injectStyle();
    this.surface = document.createElement('div');
    this.surface.className = 'vx-notif-surface';
    this.surface.setAttribute('role', 'dialog');
    this.surface.setAttribute('aria-modal', 'true');
    this.surface.setAttribute('aria-label', 'Faction dispatches');
    this.surface.tabIndex = -1;
    this.surface.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); this.hide(); }
    });
    // Clicking the darkened world behind the panel closes it.
    this.surface.addEventListener('mousedown', (e) => {
      if (e.target === this.surface) this.hide();
    });

    const panel = document.createElement('div');
    panel.className = 'vx-notif-panel';

    const head = document.createElement('div');
    head.className = 'vx-notif-head';
    const mark = document.createElement('span');
    mark.className = 'vx-notif-crest';
    mark.innerHTML = iconSvg('bell');
    const heading = document.createElement('h2');
    heading.textContent = 'Dispatches';
    this.countEl = document.createElement('small');
    const readAll = document.createElement('button');
    readAll.type = 'button';
    readAll.className = 'vx-notif-act';
    readAll.textContent = 'Mark all read';
    readAll.addEventListener('click', () => { this.markAllRead(); this.render(); });
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'vx-notif-act';
    close.textContent = 'Close';
    close.addEventListener('click', () => this.hide());
    head.append(mark, heading, this.countEl, readAll, close);

    this.list = document.createElement('div');
    this.list.className = 'vx-notif-list';

    panel.append(head, this.list);
    this.surface.appendChild(panel);
    this.host.appendChild(this.surface);
  }

  get open(): boolean { return this.isOpen; }

  /** Add a bell button somewhere. Both bells share one unread count. */
  mountBell(host: HTMLElement, place: 'title' | 'hud'): HTMLElement {
    const bell = document.createElement('button');
    bell.type = 'button';
    bell.className = 'vx-notif-bell';
    bell.dataset.place = place;
    bell.setAttribute('aria-label', 'Faction dispatches');
    bell.innerHTML = iconSvg('bell');
    const badge = document.createElement('span');
    badge.className = 'vx-notif-badge';
    bell.appendChild(badge);
    bell.addEventListener('click', () => this.toggle());
    host.appendChild(bell);
    this.bells.push(bell);
    this.refreshBadges();
    return bell;
  }

  /** Switch to an account: its own read-marks come back from localStorage. */
  setAccount(username: string): void {
    this.account = username || '';
    this.read = new Set(this.loadRead());
    this.refreshBadges();
    if (this.isOpen) this.render();
  }

  /** One new dispatch. Returns true if it was actually new — the caller uses
   *  that to decide whether to play a sound, so a re-sync never re-alarms. */
  push(notif: Notification): boolean {
    if (this.entries.some((n) => n.id === notif.id)) return false;
    this.entries.push(notif);
    if (this.entries.length > MAX_ENTRIES) {
      this.entries.splice(0, this.entries.length - MAX_ENTRIES);
    }
    // Reading the board while it is open counts as reading what lands on it.
    if (this.isOpen) { this.read.add(notif.id); this.saveRead(); this.render(); }
    this.refreshBadges();
    return true;
  }

  get unread(): number {
    return this.entries.reduce((n, e) => n + (this.read.has(e.id) ? 0 : 1), 0);
  }

  show(): void {
    if (this.isOpen) return;
    this.isOpen = true;
    this.surface.dataset.open = '1';
    this.onOpen?.();
    this.render();
    this.surface.focus();
    this.markAllRead();
  }

  hide(): void {
    if (!this.isOpen) return;
    this.isOpen = false;
    delete this.surface.dataset.open;
    this.refreshBadges();
    this.onClose?.();
  }

  toggle(): void { this.isOpen ? this.hide() : this.show(); }

  private markAllRead(): void {
    for (const e of this.entries) this.read.add(e.id);
    this.saveRead();
    this.refreshBadges();
  }

  private refreshBadges(): void {
    const n = this.unread;
    for (const bell of this.bells) {
      bell.dataset.unread = n > 0 ? '1' : '0';
      const badge = bell.querySelector('.vx-notif-badge');
      if (badge) badge.textContent = n > 99 ? '99+' : String(n);
    }
  }

  private render(): void {
    const now = Date.now();
    this.countEl.textContent = this.entries.length
      ? `${this.entries.length} message${this.entries.length === 1 ? '' : 's'}` : '';
    this.list.replaceChildren();
    if (!this.entries.length) {
      const empty = document.createElement('div');
      empty.className = 'vx-notif-empty';
      const glyph = document.createElement('i');
      glyph.innerHTML = iconSvg('mail');
      empty.append(glyph,
        'Nothing yet. Faction news arrives here.');
      this.list.appendChild(empty);
      return;
    }
    // Newest first: the thing you opened this for is almost always the last one.
    for (const entry of [...this.entries].reverse()) {
      const item = document.createElement('div');
      item.className = 'vx-notif-item';
      item.style.setProperty('--tone', KIND_TONE[entry.kind] ?? KIND_TONE.system);
      item.dataset.unread = this.read.has(entry.id) ? '0' : '1';

      const mark = document.createElement('div');
      mark.className = 'vx-notif-mark';
      mark.innerHTML = iconSvg(KIND_ICON[entry.kind] ?? 'flag');

      const body = document.createElement('div');
      const title = document.createElement('div');
      title.className = 'vx-notif-title';
      const titleText = document.createElement('span');
      titleText.textContent = entry.title;      // player-authored: text node only
      title.appendChild(titleText);
      // The unread pip. The tinted card alone is easy to skim past on a long
      // board, and it is the only cue that survives being colour-blind to the
      // kind's hue.
      if (!this.read.has(entry.id)) {
        const dot = document.createElement('span');
        dot.className = 'vx-notif-dot';
        title.appendChild(dot);
      }
      const text = document.createElement('div');
      text.className = 'vx-notif-body';
      text.textContent = entry.body;            // player-authored: text node only
      const when = document.createElement('div');
      when.className = 'vx-notif-when';
      when.textContent = ago(entry.at, now);
      body.append(title, text, when);

      item.append(mark, body);
      this.list.appendChild(item);
    }
  }

  private storageKey(): string {
    return `voxelon.notifs.${this.account.toLowerCase()}`;
  }

  private loadRead(): string[] {
    if (!this.account) return [];
    try {
      const raw = JSON.parse(localStorage.getItem(this.storageKey()) || '[]');
      return Array.isArray(raw) ? raw.filter((v) => typeof v === 'string') : [];
    } catch { return []; }
  }

  private saveRead(): void {
    if (!this.account) return;
    try {
      // Only ids still on the board are worth keeping — the rest can never be
      // shown again, so storing them would grow without bound.
      const live = this.entries.filter((e) => this.read.has(e.id)).map((e) => e.id);
      localStorage.setItem(this.storageKey(), JSON.stringify(live));
    } catch { /* private mode / storage disabled — the badge just resets */ }
  }
}
