// NOTIFICATIONS CENTRE & THE DISPATCH BELL
//
// The player's inbox for everything the faction government does to them:
// presidential broadcasts, election results, wartime treasury raid alarms,
// tax intake, and recruit starter-kit grants.
//
// Two mounts, one modal: a bell in the corner of the title screen and another
// in the HUD, both showing the same unread count and opening the same centre.
//
// Notification text is server- and player-authored, so every field lands in the
// DOM as a text node — never as markup.

import { iconSvg } from './emoji_icons';
import type { ProtocolNotification, NotificationType } from './net/protocol';

export type GameNotification = ProtocolNotification;
export type { NotificationType };

/** Filter rails. 'war' folds raids and treasury intake into one "what is
 *  happening to our stuff" view, which is how players actually think of it. */
type Filter = 'all' | 'broadcast' | 'war' | 'election';

const TAB_LABELS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'broadcast', label: 'Broadcasts' },
  { id: 'war', label: 'War & Treasury' },
  { id: 'election', label: 'Elections' },
];

const TYPE_META: Record<NotificationType, { tag: string; icon: string }> = {
  broadcast: { tag: 'Broadcast', icon: 'mail' },
  election: { tag: 'Election', icon: 'crown' },
  raid: { tag: 'War Alarm', icon: 'horn' },
  tax: { tag: 'Treasury', icon: 'coinbag' },
  kit: { tag: 'Recruit Kit', icon: 'backpack' },
  system: { tag: 'System', icon: 'star' },
};

const MAX_STORED = 50;

export class NotificationsManager {
  private notifications: GameNotification[] = [];
  private filter: Filter = 'all';
  private surfaceEl: HTMLElement;
  private listEl: HTMLElement;
  private tabsEl: HTMLElement;
  private bells: HTMLElement[] = [];
  private onOpenCallback?: () => void;
  private onCloseCallback?: () => void;
  /** Notifications are per-account: two players sharing a browser must not
   *  read each other's dispatches. Set by main once the player is known. */
  private storageKey = 'voxelon.notifications';

  constructor(appContainer: HTMLElement) {
    this.surfaceEl = document.createElement('div');
    this.surfaceEl.className = 'gov-surface';
    this.surfaceEl.setAttribute('role', 'dialog');
    this.surfaceEl.setAttribute('aria-modal', 'true');
    this.surfaceEl.setAttribute('aria-label', 'Notifications and faction dispatches');

    const shell = document.createElement('div');
    shell.className = 'gov-shell notif-shell';

    const head = document.createElement('div');
    head.className = 'gov-head';
    head.innerHTML = `
      <div class="gov-head-titles">
        <div class="gov-emblem">${iconSvg('bell')}</div>
        <div>
          <div class="gov-kicker">Faction Dispatches</div>
          <h2 class="gov-title">Notifications</h2>
        </div>
      </div>
      <div class="gov-head-actions">
        <button type="button" class="gov-ghost-btn js-mark-read">Mark all read</button>
        <button type="button" class="gov-close js-close" aria-label="Close (Esc)" title="Close (Esc)">✕</button>
      </div>
    `;

    this.tabsEl = document.createElement('div');
    this.tabsEl.className = 'gov-tabs';
    this.tabsEl.setAttribute('role', 'tablist');
    this.tabsEl.innerHTML = TAB_LABELS.map((t) => `
      <button type="button" class="gov-tab" role="tab" data-filter="${t.id}"
              aria-selected="${t.id === 'all'}">${t.label}</button>
    `).join('');

    this.listEl = document.createElement('div');
    this.listEl.className = 'gov-body notif-list';

    shell.append(head, this.tabsEl, this.listEl);
    this.surfaceEl.appendChild(shell);
    appContainer.appendChild(this.surfaceEl);

    head.querySelector('.js-close')?.addEventListener('click', () => this.hide());
    head.querySelector('.js-mark-read')?.addEventListener('click', () => this.markAllAsRead());

    this.tabsEl.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('.gov-tab');
      if (!btn) return;
      this.filter = (btn.dataset.filter as Filter) ?? 'all';
      this.syncTabs();
      this.renderList();
    });

    // Click the scrim (never the shell) to dismiss.
    this.surfaceEl.addEventListener('click', (e) => {
      if (e.target === this.surfaceEl) this.hide();
    });
    // Esc closes, and only while we are the thing on screen.
    this.surfaceEl.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.hide(); }
    });

    this.load();
  }

  setCallbacks(onOpen?: () => void, onClose?: () => void): void {
    this.onOpenCallback = onOpen;
    this.onCloseCallback = onClose;
  }

  /** Bind the inbox to an account. Called on login/logout so dispatches never
   *  bleed between players sharing one browser. */
  setAccount(username: string | null): void {
    this.storageKey = username
      ? `voxelon.notifications.${username.toLowerCase()}`
      : 'voxelon.notifications';
    this.load();
    this.updateBadges();
    if (this.isOpen) this.renderList();
  }

  get isOpen(): boolean { return this.surfaceEl.classList.contains('open'); }

  get unreadCount(): number {
    let n = 0;
    for (const item of this.notifications) if (!item.read) n++;
    return n;
  }

  /** Mount a bell. `variant` only picks the corner and size — both bells share
   *  one badge state and open the same centre. */
  mountBell(container: HTMLElement, variant: 'title' | 'hud'): HTMLElement {
    const bell = document.createElement('button');
    bell.type = 'button';
    bell.id = variant === 'title' ? 'title-notif-bell' : 'hud-notif-bell';
    bell.className = `gov-bell gov-bell-${variant}`;
    bell.title = 'Notifications & faction dispatches';
    bell.setAttribute('aria-label', 'Open notifications');
    bell.innerHTML = `${iconSvg('bell')}<span class="gov-bell-badge">0</span>`;

    bell.addEventListener('click', (e) => { e.stopPropagation(); this.toggle(); });

    container.appendChild(bell);
    this.bells.push(bell);
    this.updateBadges();
    return bell;
  }

  pushNotification(notif: Omit<GameNotification, 'id' | 'timestamp' | 'read'> &
                   Partial<Pick<GameNotification, 'id' | 'timestamp' | 'read'>>): GameNotification {
    const full: GameNotification = {
      ...notif,
      id: notif.id ?? `notif_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      timestamp: notif.timestamp ?? Date.now(),
      read: false,
    };
    // The server re-sends on reconnect; an id we already hold is not news.
    if (this.notifications.some((n) => n.id === full.id)) return full;

    this.notifications.unshift(full);
    if (this.notifications.length > MAX_STORED) this.notifications.length = MAX_STORED;
    this.save();
    this.updateBadges();
    if (this.isOpen) this.renderList();
    return full;
  }

  toggle(): void { if (this.isOpen) this.hide(); else this.show(); }

  show(): void {
    this.syncTabs();
    this.renderList();
    this.surfaceEl.classList.add('open');
    this.surfaceEl.tabIndex = -1;
    this.surfaceEl.focus({ preventScroll: true });
    this.onOpenCallback?.();
  }

  hide(): void {
    if (!this.isOpen) return;
    this.surfaceEl.classList.remove('open');
    this.onCloseCallback?.();
  }

  markAllAsRead(): void {
    let changed = false;
    for (const n of this.notifications) if (!n.read) { n.read = true; changed = true; }
    if (!changed) return;
    this.save();
    this.updateBadges();
    this.renderList();
  }

  private syncTabs(): void {
    this.tabsEl.querySelectorAll<HTMLElement>('.gov-tab').forEach((t) => {
      t.setAttribute('aria-selected', String(t.dataset.filter === this.filter));
    });
  }

  private updateBadges(): void {
    const count = this.unreadCount;
    const text = count > 99 ? '99+' : String(count);
    for (const bell of this.bells) {
      const badge = bell.querySelector<HTMLElement>('.gov-bell-badge');
      if (badge) {
        badge.textContent = text;
        badge.classList.toggle('show', count > 0);
      }
      bell.classList.toggle('has-unread', count > 0);
      bell.setAttribute('aria-label',
        count > 0 ? `Open notifications (${count} unread)` : 'Open notifications');
    }
  }

  private matchesFilter(n: GameNotification): boolean {
    switch (this.filter) {
      case 'all': return true;
      case 'war': return n.type === 'raid' || n.type === 'tax';
      case 'election': return n.type === 'election' || n.type === 'kit';
      case 'broadcast': return n.type === 'broadcast' || n.type === 'system';
    }
  }

  private renderList(): void {
    this.listEl.replaceChildren();
    const filtered = this.notifications.filter((n) => this.matchesFilter(n));

    if (filtered.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'notif-empty';
      empty.innerHTML = `
        ${iconSvg('bell')}
        <b>Nothing here yet</b>
        <span>Presidential broadcasts, election results and treasury alarms
              will arrive in this inbox.</span>
      `;
      this.listEl.appendChild(empty);
      return;
    }

    for (const item of filtered) {
      const meta = TYPE_META[item.type] ?? TYPE_META.system;

      const row = document.createElement('button');
      row.type = 'button';
      row.className = `notif-item type-${item.type} ${item.read ? 'read' : 'unread'}`;

      const icon = document.createElement('div');
      icon.className = 'notif-item-icon';
      icon.innerHTML = iconSvg(meta.icon as Parameters<typeof iconSvg>[0]);

      const body = document.createElement('div');
      body.className = 'notif-item-body';

      const metaRow = document.createElement('div');
      metaRow.className = 'notif-item-meta';
      const tag = document.createElement('span');
      tag.className = 'notif-item-tag';
      tag.textContent = meta.tag;
      const time = document.createElement('span');
      time.className = 'notif-item-time';
      time.textContent = formatRelativeTime(item.timestamp);
      metaRow.append(tag, time);

      // Server- and player-authored strings: text nodes only.
      const title = document.createElement('div');
      title.className = 'notif-item-title';
      title.textContent = item.title;

      const desc = document.createElement('div');
      desc.className = 'notif-item-desc';
      desc.textContent = item.message;

      body.append(metaRow, title, desc);
      row.append(icon, body);

      row.addEventListener('click', () => {
        if (item.read) return;
        item.read = true;
        this.save();
        this.updateBadges();
        row.classList.replace('unread', 'read');
      });

      this.listEl.appendChild(row);
    }
  }

  private load(): void {
    this.notifications = [];
    try {
      const raw = localStorage.getItem(this.storageKey);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return;
      // Trust nothing from storage: a hand-edited blob must not reach the DOM
      // as a half-built object.
      this.notifications = parsed
        .filter((n): n is GameNotification =>
          !!n && typeof n === 'object' &&
          typeof n.id === 'string' && typeof n.title === 'string' &&
          typeof n.message === 'string' && typeof n.type === 'string' &&
          Number.isFinite(n.timestamp))
        .slice(0, MAX_STORED);
    } catch { /* ignore */ }
  }

  private save(): void {
    try {
      localStorage.setItem(this.storageKey, JSON.stringify(this.notifications));
    } catch { /* ignore */ }
  }
}

function formatRelativeTime(ts: number): string {
  const diff = Math.max(0, Date.now() - ts);
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
