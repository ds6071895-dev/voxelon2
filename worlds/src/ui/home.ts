// The title screen's game cards and top bar. Pure DOM over the markup in
// index.html; main.ts wires the callbacks to the network.
//
// A card click means "play this": solo it joins the public queue, as a party
// leader it starts a private match for the whole party. The card then says
// what is happening in plain words — searching, waiting for the leader, or why
// this party cannot play this game — and never anything about practice
// opponents or timers behind the scenes.

import { PARTY_MAX, type GameMode, type PartyState } from '../net/protocol';
import { partyCapacityFor } from '../modes';
import type { Cosmetics } from '../character';
import { drawFace } from './face';

interface HomeHooks {
  onPlay(mode: GameMode): void;
  onCancel(): void;
  onControls(): void;
  onSettings(): void;
  onParty(): void;
  onAccount(): void;
  onWardrobe(): void;
  onCapes(): void;
}

const MODE_TITLE: Record<GameMode, string> = { duels: 'Duels', bridge: 'The Bridge', parkour: 'Parkour', ratseek: 'Rat and Seek' };

export class HomeScreen {
  readonly root = document.getElementById('w-home') as HTMLElement;
  private readonly cards = new Map<GameMode, HTMLButtonElement>();
  private readonly accountName = document.getElementById('w-account-name')!;
  private readonly accountKind = document.getElementById('w-account-kind')!;
  private readonly accountCta = document.getElementById('w-account-cta')!;
  private readonly accountBtn = document.getElementById('w-account-btn') as HTMLButtonElement;
  private readonly accountFace = document.getElementById('w-account-face')!;
  private readonly partyLabel = document.getElementById('w-party-label')!;
  private readonly partyCount = document.getElementById('w-party-count')!;
  private readonly connection = document.getElementById('w-connection')!;
  private readonly faceCanvas = document.createElement('canvas');
  private queue: GameMode | null = null;
  private queuedAt = 0;
  private party: PartyState | null = null;
  private myId = -1;
  private connected = false;

  constructor(private readonly hooks: HomeHooks) {
    for (const card of document.querySelectorAll<HTMLButtonElement>('.w-card')) {
      const mode = card.dataset.mode as GameMode;
      this.cards.set(mode, card);
      card.addEventListener('click', () => this.press(mode));
    }
    this.accountFace.appendChild(this.faceCanvas);
    document.getElementById('w-controls-link')!.addEventListener('click', () => hooks.onControls());
    document.getElementById('w-settings-btn')!.addEventListener('click', () => hooks.onSettings());
    document.getElementById('w-party-btn')!.addEventListener('click', () => hooks.onParty());
    this.accountBtn.addEventListener('click', () => hooks.onAccount());
    document.getElementById('w-wardrobe-btn')!.addEventListener('click', () => hooks.onWardrobe());
    document.getElementById('w-capes-btn')!.addEventListener('click', () => hooks.onCapes());
    this.render();
  }

  show(): void { this.root.hidden = false; this.render(); }
  hide(): void { this.root.hidden = true; }

  setConnected(connected: boolean, message = ''): void {
    this.connected = connected;
    this.connection.textContent = connected ? '' : message;
    if (!connected) { this.queue = null; }
    this.render();
  }

  setIdentity(name: string, account: boolean, cosmetics: Cosmetics | undefined, seed: number): void {
    this.accountName.textContent = name;
    this.accountKind.textContent = account ? 'Signed in' : 'Guest';
    this.accountCta.textContent = account ? 'Account' : 'Log in';
    this.accountBtn.dataset.signedIn = account ? '1' : '';
    this.accountBtn.setAttribute('aria-label', account ? `Signed in as ${name}. Account` : `Playing as ${name}. Log in`);
    drawFace(this.faceCanvas, cosmetics, seed);
  }

  setMyId(id: number): void { this.myId = id; this.render(); }

  setQueue(mode: GameMode | null): void {
    if (mode !== this.queue) this.queuedAt = performance.now();
    this.queue = mode;
    this.render();
  }

  setParty(state: PartyState | null): void {
    this.party = state;
    const n = state?.members.length ?? 0;
    this.partyLabel.textContent = state ? `Party · ${state.code}` : 'Party';
    this.partyCount.hidden = !state;
    this.partyCount.textContent = `${n}/${PARTY_MAX}`;
    this.render();
  }

  private press(mode: GameMode): void {
    const card = this.cards.get(mode)!;
    if (card.getAttribute('aria-disabled') === 'true') return;
    if (this.queue === mode) { this.hooks.onCancel(); return; }
    this.hooks.onPlay(mode);
  }

  /** Why this card cannot be pressed right now, or '' if it can. */
  private blocked(mode: GameMode): string {
    if (!this.connected) return 'Connecting…';
    const p = this.party;
    if (!p || p.members.length <= 1) return '';
    if (p.leader !== this.myId) return 'Leader picks';
    if (p.members.some((m) => m.status === 'match')) return 'Party in a match';
    const cap = partyCapacityFor(mode);
    if (mode === 'bridge' && p.members.length !== 2) return '2 players max';
    if (p.members.length > cap) return `${cap} players max`;
    return '';
  }

  render(): void {
    const inParty = !!this.party && this.party.members.length > 1;
    for (const [mode, card] of this.cards) {
      const reason = this.blocked(mode);
      const searching = this.queue === mode && !reason;
      card.dataset.state = searching ? 'searching' : '';
      card.setAttribute('aria-disabled', reason ? 'true' : 'false');
      const label = card.querySelector<HTMLElement>('.w-card-label')!;
      label.textContent = reason || (searching ? 'Cancel' : inParty ? 'Play with party' : 'Play');
      card.setAttribute('aria-label', `${MODE_TITLE[mode]}: ${reason || (searching ? 'searching, press to cancel' : 'play')}`);
    }
    this.tick();
  }

  /** Keep the searching line's clock current (called every frame on the menu). */
  tick(): void {
    if (!this.queue) return;
    const card = this.cards.get(this.queue);
    const text = card?.querySelector<HTMLElement>('.w-card-status-text');
    if (!text) return;
    const s = Math.floor((performance.now() - this.queuedAt) / 1000);
    const clock = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    const next = `Finding players… ${clock}`;
    if (text.textContent !== next) text.textContent = next;
  }
}
