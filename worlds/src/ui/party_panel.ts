// The Party panel: create a party, share its code, join one by code, and see
// who is in it. Anyone can party — a temporary name works exactly like an
// account. The leader's game-card click takes the whole party into a match.

import { PARTY_CODE_LENGTH, PARTY_MAX, type PartyState } from '../net/protocol';
import { drawFace } from './face';

export interface PartyHooks {
  onCreate(): void;
  onJoin(code: string): void;
  onLeave(): void;
  onKick(id: number): void;
  onPromote(id: number): void;
  onClose?(): void;
}

const X_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>';

export class PartyPanel {
  private readonly scrim = document.createElement('div');
  private readonly body: HTMLElement;
  private state: PartyState | null = null;
  private myId = -1;
  private error = '';
  private copied = 0;

  constructor(host: HTMLElement, private readonly hooks: PartyHooks) {
    this.scrim.className = 'w-scrim';
    this.scrim.innerHTML = `<div class="w-dialog" role="dialog" aria-modal="true" aria-labelledby="w-party-title"></div>`;
    this.body = this.scrim.firstElementChild as HTMLElement;
    this.scrim.addEventListener('mousedown', (e) => { if (e.target === this.scrim) this.close(); });
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.open) { e.stopPropagation(); this.close(); }
    });
    host.appendChild(this.scrim);
  }

  get open(): boolean { return this.scrim.classList.contains('open'); }
  show(): void { this.error = ''; this.scrim.classList.add('open'); this.render(); }
  close(): void {
    if (!this.open) return;
    this.scrim.classList.remove('open');
    this.hooks.onClose?.();
  }
  update(state: PartyState | null, myId: number): void {
    this.state = state;
    this.myId = myId;
    if (state) this.error = '';
    if (this.open) this.render();
  }
  setError(message: string): void { this.error = message; if (this.open) this.render(); }

  private render(): void {
    const esc = (s: string): string => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
    const s = this.state;
    const head = `
      <div class="w-dialog-head">
        <div><div class="w-kicker">Play together</div><h2 id="w-party-title">Party</h2></div>
        <button class="w-x" type="button" data-act="close" aria-label="Close">${X_ICON}</button>
      </div>`;
    if (!s) {
      this.body.innerHTML = `${head}
        <p class="w-lede">Make a party and share its code, or type a friend's code to join them. Up to ${PARTY_MAX} players.</p>
        <button class="w-btn primary" type="button" data-act="create">Create a party</button>
        <label class="w-field">Join with a code
          <span class="w-row">
            <input class="w-input" id="w-party-code" maxlength="${PARTY_CODE_LENGTH + 2}" placeholder="ABC234" autocomplete="off" spellcheck="false" style="text-transform:uppercase;letter-spacing:4px" />
            <button class="w-btn" type="button" data-act="join">Join</button>
          </span>
        </label>
        <div class="w-err" role="alert">${esc(this.error)}</div>
        <ul class="w-rules">
          <li>The leader picks the game and everyone plays together.</li>
          <li>Duels and Parkour take up to ${PARTY_MAX}; The Bridge is 1v1, so it needs exactly 2.</li>
        </ul>`;
    } else {
      const leader = s.leader === this.myId;
      const rows = s.members.map((m) => {
        const status = m.status === 'match' ? 'In a match' : m.status === 'queue' ? 'Searching' : 'Ready';
        const me = m.id === this.myId;
        const actions = leader && !me
          ? `<span class="w-member-actions"><button class="w-mini" type="button" data-promote="${m.id}">Make leader</button><button class="w-mini danger" type="button" data-kick="${m.id}">Remove</button></span>`
          : '<span></span>';
        return `<li class="w-member"><span class="w-face" data-face="${m.id}"></span>
          <span class="w-member-name"><b>${esc(m.username)}${me ? ' (you)' : ''}${m.id === s.leader ? '<span class="w-crown">LEADER</span>' : ''}</b>
          <small class="${m.status === 'match' ? 'busy' : ''}">${status}</small></span>${actions}</li>`;
      }).join('');
      const empty = Array.from({ length: PARTY_MAX - s.members.length }, () =>
        '<li class="w-member empty"><span></span><span class="w-member-name"><small>Open slot — share the code</small></span></li>').join('');
      this.body.innerHTML = `${head}
        <div class="w-code"><div><small>Party code</small><b>${esc(s.code)}</b></div>
          <button class="w-btn" type="button" data-act="copy">${Date.now() - this.copied < 1600 ? 'Copied' : 'Copy'}</button></div>
        <ul class="w-members">${rows}${empty}</ul>
        <p class="w-lede">${leader
          ? 'You lead: pick a game on the title screen and everyone comes with you.'
          : 'The leader picks the game. Stay on the title screen and you will be brought in.'}</p>
        <div class="w-err" role="alert">${esc(this.error)}</div>
        <button class="w-btn danger" type="button" data-act="leave">Leave party</button>`;
      for (const m of s.members) {
        const slot = this.body.querySelector<HTMLElement>(`[data-face="${m.id}"]`);
        if (!slot) continue;
        const canvas = document.createElement('canvas');
        drawFace(canvas, m.cosmetics, m.skin);
        slot.appendChild(canvas);
      }
    }
    this.body.querySelector('[data-act="close"]')?.addEventListener('click', () => this.close());
    this.body.querySelector('[data-act="create"]')?.addEventListener('click', () => this.hooks.onCreate());
    this.body.querySelector('[data-act="leave"]')?.addEventListener('click', () => this.hooks.onLeave());
    this.body.querySelector('[data-act="copy"]')?.addEventListener('click', () => {
      if (!s) return;
      void navigator.clipboard?.writeText(s.code).catch(() => { /* not allowed: the code is on screen */ });
      this.copied = Date.now();
      this.render();
    });
    const join = (): void => {
      const input = this.body.querySelector<HTMLInputElement>('#w-party-code');
      const code = (input?.value ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (code.length !== PARTY_CODE_LENGTH) { this.setError(`Party codes are ${PARTY_CODE_LENGTH} letters and numbers.`); return; }
      this.error = '';
      this.hooks.onJoin(code);
    };
    this.body.querySelector('[data-act="join"]')?.addEventListener('click', join);
    this.body.querySelector<HTMLInputElement>('#w-party-code')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') join(); });
    for (const b of this.body.querySelectorAll<HTMLButtonElement>('[data-kick]')) {
      b.addEventListener('click', () => this.hooks.onKick(Number(b.dataset.kick)));
    }
    for (const b of this.body.querySelectorAll<HTMLButtonElement>('[data-promote]')) {
      b.addEventListener('click', () => this.hooks.onPromote(Number(b.dataset.promote)));
    }
  }
}
