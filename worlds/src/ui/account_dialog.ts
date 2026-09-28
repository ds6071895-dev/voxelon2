// The account dialog behind the top-right chip.
//
// Everyone starts under a temporary generated name and can play, party and
// change their look without an account. The dialog offers two ways to keep a
// name: sign in to one you already own, or keep the one you are using now (or
// roll another — names are always generated, never typed).

interface AccountHooks {
  onLogin(username: string, password: string): void;
  onRegister(username: string, password: string): void;
  onRoll(): void;
  onLogout(): void;
  onClose?(): void;
}

const X_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>';
const DICE_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="3.5" width="17" height="17" rx="4" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="8.5" cy="8.5" r="1.4" fill="currentColor"/><circle cx="15.5" cy="15.5" r="1.4" fill="currentColor"/><circle cx="15.5" cy="8.5" r="1.4" fill="currentColor"/><circle cx="8.5" cy="15.5" r="1.4" fill="currentColor"/><circle cx="12" cy="12" r="1.4" fill="currentColor"/></svg>';

export class AccountDialog {
  private readonly scrim = document.createElement('div');
  private readonly body: HTMLElement;
  private mode: 'login' | 'create' = 'login';
  private name = '';
  private account = false;
  /** The name the Create form will register: yours, or a freshly rolled one. */
  private claim = '';
  private busy = false;
  /** What was typed in the Log in name field, kept across re-renders. */
  private typedUser = '';
  private error = '';
  private notice = '';

  constructor(host: HTMLElement, private readonly hooks: AccountHooks) {
    this.scrim.className = 'w-scrim';
    this.scrim.innerHTML = `<div class="w-dialog" role="dialog" aria-modal="true" aria-labelledby="w-acct-title"></div>`;
    this.body = this.scrim.firstElementChild as HTMLElement;
    this.scrim.addEventListener('mousedown', (e) => { if (e.target === this.scrim) this.close(); });
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.open) { e.stopPropagation(); this.close(); }
    });
    host.appendChild(this.scrim);
  }

  get open(): boolean { return this.scrim.classList.contains('open'); }

  show(): void {
    this.error = ''; this.notice = ''; this.busy = false;
    this.claim = this.name;
    this.scrim.classList.add('open');
    this.render();
    requestAnimationFrame(() => this.body.querySelector<HTMLElement>('input:not([readonly]), .w-btn.primary')?.focus());
  }
  close(): void {
    if (!this.open) return;
    this.scrim.classList.remove('open');
    this.hooks.onClose?.();
  }

  setIdentity(name: string, account: boolean): void {
    const changed = name !== this.name || account !== this.account;
    this.name = name;
    this.account = account;
    if (!this.claim || !this.open) this.claim = name;
    if (changed && this.open) {
      this.busy = false;
      this.error = '';
      this.notice = account ? `Signed in as ${name}.` : '';
      this.claim = name;
      this.render();
    }
  }
  setOffer(name: string): void { this.claim = name; this.busy = false; if (this.open) this.render(); }
  setError(message: string): void { this.error = message; this.busy = false; if (this.open) this.render(); }

  private render(): void {
    const esc = (s: string): string => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
    const head = (kicker: string, title: string): string => `
      <div class="w-dialog-head">
        <div><div class="w-kicker">${kicker}</div><h2 id="w-acct-title">${title}</h2></div>
        <button class="w-x" type="button" data-act="close" aria-label="Close">${X_ICON}</button>
      </div>`;
    if (this.account) {
      this.body.innerHTML = `${head('Account', esc(this.name))}
        <p class="w-lede">You're signed in. Your name and your look are kept on this account and follow you to any browser.</p>
        <div class="w-ok">${esc(this.notice)}</div>
        <button class="w-btn danger" type="button" data-act="logout">Log out</button>
        <p class="w-fine">Logging out gives you a new temporary name until you sign in again.</p>`;
    } else {
      const create = this.mode === 'create';
      this.body.innerHTML = `${head('Account', create ? 'Keep your name' : 'Log in')}
        <div class="w-tabs" role="tablist">
          <button class="w-tab" type="button" role="tab" data-tab="login" aria-selected="${!create}">Log in</button>
          <button class="w-tab" type="button" role="tab" data-tab="create" aria-selected="${create}">Create account</button>
        </div>
        ${create ? `
          <p class="w-lede">You're playing as <b>${esc(this.name)}</b>. Keep that name, or roll a new one, and pick a passphrase to come back to it.</p>
          <label class="w-field">Your name
            <span class="w-row"><input class="w-input" id="w-acct-claim" value="${esc(this.claim)}" readonly aria-readonly="true" />
            <button class="w-roll" type="button" data-act="roll" title="Roll another name" aria-label="Roll another name">${DICE_ICON}</button></span>
          </label>
          <label class="w-field">Passphrase
            <input class="w-input" id="w-acct-pass" type="password" autocomplete="new-password" placeholder="At least 4 characters" />
          </label>` : `
          <p class="w-lede">Sign in to the name you kept. Your party stays with you.</p>
          <label class="w-field">Name
            <input class="w-input" id="w-acct-user" autocomplete="username" placeholder="e.g. SwiftFalcon42" maxlength="20" spellcheck="false" value="${esc(this.typedUser)}" />
          </label>
          <label class="w-field">Passphrase
            <input class="w-input" id="w-acct-pass" type="password" autocomplete="current-password" placeholder="Your passphrase" />
          </label>`}
        <div class="w-err" role="alert">${esc(this.error)}</div>
        <button class="w-btn primary" type="button" data-act="${create ? 'create' : 'login'}" ${this.busy ? 'disabled' : ''}>
          ${this.busy ? 'One moment…' : create ? 'Keep this name' : 'Log in'}
        </button>
        <p class="w-fine">No email needed. Your passphrase is never stored in this browser.</p>`;
    }
    this.body.querySelector('[data-act="close"]')?.addEventListener('click', () => this.close());
    this.body.querySelector('[data-act="logout"]')?.addEventListener('click', () => { this.hooks.onLogout(); this.close(); });
    this.body.querySelector('[data-act="roll"]')?.addEventListener('click', () => { this.error = ''; this.hooks.onRoll(); });
    for (const tab of this.body.querySelectorAll<HTMLButtonElement>('[data-tab]')) {
      tab.addEventListener('click', () => { this.mode = tab.dataset.tab as 'login' | 'create'; this.error = ''; this.render(); });
    }
    const submit = (): void => {
      if (this.busy) return;
      const pass = (this.body.querySelector<HTMLInputElement>('#w-acct-pass')?.value ?? '');
      if (this.mode === 'create') {
        if (pass.length < 4) { this.setError('Pick a passphrase of at least 4 characters.'); return; }
        this.busy = true; this.error = ''; this.render();
        this.hooks.onRegister(this.claim, pass);
      } else {
        const user = (this.body.querySelector<HTMLInputElement>('#w-acct-user')?.value ?? '').trim();
        this.typedUser = user;
        if (!user || !pass) { this.setError('Enter your name and passphrase.'); return; }
        this.busy = true; this.error = ''; this.render();
        this.hooks.onLogin(user, pass);
      }
    };
    this.body.querySelector('[data-act="create"], [data-act="login"]')?.addEventListener('click', submit);
    for (const input of this.body.querySelectorAll<HTMLInputElement>('input:not([readonly])')) {
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
    }
  }
}
