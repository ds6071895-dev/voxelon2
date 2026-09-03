// THE DISPATCH INBOX — where the government talks to you.
//
// Presidential broadcasts, election results, tax changes, funded kits and the
// alarm when somebody is inside your treasury all land here. It exists because
// VOXELON has no chat: a president with something to say has no other way to
// reach the faction, and a raid alarm that only shows as a three-second toast is
// a raid alarm you miss while you are underground.
//
// SELF-CONTAINED by design. Every rule this file needs is in politics.ts; every
// style it needs is in the <style> block it injects, under a `vx-notif-` prefix
// that appears nowhere else in the project. It adds nothing to index.html, so
// there is no global stylesheet it can collide with and nothing else can change
// how it looks. The same is true of president_ui.ts and faction_picker.ts.
//
// Player-authored text (a broadcast) is only ever written with `textContent` —
// it never reaches innerHTML, so a party slogan cannot become markup.

import { iconSvg, type IconName } from './emoji_icons';
import type { Notification, NotificationKind } from './net/protocol';

/** Newest entries kept. Older ones fall off — this is a dispatch board, not an
 *  archive, and the server only ever replays the last handful anyway. */
const MAX_ENTRIES = 60;

const KIND_ICON: Record<NotificationKind, IconName> = {
  broadcast: 'horn',
  election: 'ballot',
  raid: 'warning',
  tax: 'scales',
  kit: 'backpack',
  system: 'flag',
};

const KIND_TONE: Record<NotificationKind, string> = {
  broadcast: '#eda01a',
  election: '#6fa8ff',
  raid: '#e2503b',
  tax: '#7fd0a3',
  kit: '#c79bff',
  system: '#9fb0cc',
};

const CSS = `
.vx-notif-bell {
  position: relative; display: inline-flex; align-items: center; justify-content: center;
  width: 42px; height: 42px; border: 0; border-radius: 12px; cursor: pointer;
  font-size: 17px; color: #e8eefc; background: rgba(16, 26, 38, .72);
  box-shadow: inset 0 0 0 1px rgba(232, 238, 252, .16); transition: background .15s, transform .12s;
}
.vx-notif-bell:hover { background: rgba(28, 42, 60, .86); transform: translateY(-1px); }
.vx-notif-bell:focus-visible { outline: 2px solid #eda01a; outline-offset: 2px; }
/* Both bells are viewport-fixed. The title screen scrolls on a short window,
   and an absolutely-positioned bell would scroll away with it. */
.vx-notif-bell[data-place="title"] { position: fixed; top: 16px; right: 16px; z-index: 6; }
.vx-notif-bell[data-place="hud"] { position: fixed; top: 12px; right: 12px; z-index: 5; }
.vx-notif-badge {
  position: absolute; top: -5px; right: -5px; min-width: 18px; height: 18px; padding: 0 5px;
  display: none; align-items: center; justify-content: center; border-radius: 9px;
  font: 700 10px/1 ui-sans-serif, system-ui, sans-serif; color: #26180a; background: #eda01a;
}
.vx-notif-bell[data-unread="1"] .vx-notif-badge { display: flex; }
.vx-notif-bell[data-unread="1"] { animation: vx-notif-ring 1.6s ease-out 2; }
@keyframes vx-notif-ring {
  0%, 100% { transform: rotate(0); } 20% { transform: rotate(-11deg); }
  40% { transform: rotate(9deg); } 60% { transform: rotate(-5deg); } 80% { transform: rotate(3deg); }
}

.vx-notif-surface {
  position: fixed; inset: 0; z-index: 40; display: none;
  align-items: center; justify-content: flex-end;
  padding: 22px; background: rgba(6, 11, 18, .55); backdrop-filter: blur(3px);
  font-family: ui-sans-serif, -apple-system, 'Segoe UI', Roboto, system-ui, sans-serif;
}
.vx-notif-surface[data-open="1"] { display: flex; }
.vx-notif-panel {
  display: flex; flex-direction: column; width: min(430px, 100%); max-height: 100%;
  border-radius: 16px; overflow: hidden; color: #e8eefc; background: #101a26;
  box-shadow: 0 26px 70px rgba(0, 0, 0, .55), inset 0 0 0 1px rgba(232, 238, 252, .12);
}
.vx-notif-head {
  display: flex; align-items: center; gap: 10px; padding: 16px 18px;
  border-bottom: 1px solid rgba(232, 238, 252, .1); background: rgba(232, 238, 252, .04);
}
.vx-notif-head h2 { flex: 1; margin: 0; font-size: 14px; letter-spacing: 1.6px; text-transform: uppercase; }
.vx-notif-head small { color: #8fa0bb; font-size: 11px; letter-spacing: .4px; }
.vx-notif-act {
  border: 0; border-radius: 8px; padding: 7px 11px; cursor: pointer;
  font: 600 10px/1 inherit; letter-spacing: 1.1px; text-transform: uppercase;
  color: #cfd9ea; background: rgba(232, 238, 252, .09);
}
.vx-notif-act:hover { background: rgba(232, 238, 252, .17); }
.vx-notif-act:focus-visible { outline: 2px solid #eda01a; outline-offset: 2px; }
.vx-notif-list { flex: 1; min-height: 0; overflow-y: auto; padding: 10px; }
.vx-notif-list::-webkit-scrollbar { width: 8px; }
.vx-notif-list::-webkit-scrollbar-thumb { border-radius: 4px; background: rgba(232, 238, 252, .18); }
.vx-notif-item {
  display: grid; grid-template-columns: 30px 1fr; gap: 11px; align-items: start;
  padding: 12px 13px; margin-bottom: 8px; border-radius: 11px;
  background: rgba(232, 238, 252, .045); border-left: 3px solid var(--tone, #9fb0cc);
}
.vx-notif-item[data-unread="1"] { background: rgba(232, 238, 252, .1); }
.vx-notif-mark {
  display: flex; align-items: center; justify-content: center; width: 30px; height: 30px;
  border-radius: 9px; font-size: 15px; color: var(--tone, #9fb0cc);
  background: color-mix(in srgb, var(--tone, #9fb0cc) 16%, transparent);
}
.vx-notif-title { font-size: 12px; font-weight: 700; letter-spacing: .3px; }
.vx-notif-body { margin-top: 4px; font-size: 12.5px; line-height: 1.5; color: #c3cfe2; overflow-wrap: anywhere; }
.vx-notif-when { margin-top: 5px; font-size: 10px; letter-spacing: .8px; text-transform: uppercase; color: #77879f; }
.vx-notif-empty { padding: 46px 20px; text-align: center; color: #77879f; font-size: 12.5px; line-height: 1.6; }
@media (max-width: 620px) {
  .vx-notif-surface { padding: 0; align-items: stretch; justify-content: stretch; }
  .vx-notif-panel { width: 100%; max-height: none; border-radius: 0; }
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

  /** Replace the whole board (login / reconnect). */
  seed(notifs: Notification[]): void {
    this.entries = [...notifs].sort((a, b) => a.at - b.at).slice(-MAX_ENTRIES);
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
      empty.textContent =
        'Nothing yet. Your president’s broadcasts, election results and treasury '
        + 'alarms all arrive here.';
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
      title.textContent = entry.title;          // player-authored: text node only
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
