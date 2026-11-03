// The party leader's start sheet for Lucky Pillars and Disaster City: who is
// coming, and whether bots top the party up to four. (Neither game has host
// settings of its own; Party Games has its full host sheet instead.)

import { uiButton, uiEl } from './dom';
import { MODE_LABELS } from './presentation';
import type { EngineMode, PartyState } from '../net/protocol';
import { PARTY_MAX } from '../net/protocol';

export class EngineSetupSheet {
  private scrim: HTMLElement | null = null;
  private fill = true;

  constructor(private readonly app: HTMLElement, private readonly start: (mode: EngineMode, fill: boolean) => void) {}

  get open(): boolean { return !!this.scrim; }

  show(mode: EngineMode, party: PartyState, myId: number): void {
    this.close();
    const scrim = this.scrim = uiEl('div', 'w-scrim open', this.app);
    scrim.addEventListener('mousedown', (e) => { if (e.target === scrim) this.close(); });
    const card = uiEl('div', 'w-dialog', scrim);
    const head = uiEl('div', 'w-dialog-head', card);
    const titles = uiEl('div', '', head);
    uiEl('div', 'w-kicker', titles, 'Party match');
    uiEl('h2', '', titles, MODE_LABELS[mode]);
    uiButton(head, '✕', () => this.close(), 'w-x');
    const lede = uiEl('p', 'w-lede', card, `${party.members.length} of ${PARTY_MAX} players.`);
    const list = uiEl('div', 'v-results-table', card);
    for (const m of party.members) {
      const row = uiEl('div', 'v-results-row', list);
      if (m.id === myId) row.classList.add('you');
      uiEl('b', 'place', row, '·');
      uiEl('span', 'name', row, m.username);
      uiEl('small', '', row, m.id === party.leader ? 'Host' : '');
    }
    const label = uiEl('label', 'w-check', card);
    const box = uiEl('input', '', label);
    box.type = 'checkbox'; box.checked = this.fill;
    uiEl('span', '', label, `Fill empty places with bots (up to ${PARTY_MAX})`);
    box.addEventListener('change', () => { this.fill = box.checked; lede.textContent = this.fill ? `${party.members.length} of ${PARTY_MAX} players · bots take the rest.` : `${party.members.length} players.`; });
    if (this.fill) lede.textContent = `${party.members.length} of ${PARTY_MAX} players · bots take the rest.`;
    const actions = uiEl('div', 'v-results-actions', card);
    uiButton(actions, 'Cancel', () => this.close(), 'w-btn');
    const go = uiButton(actions, 'Start', () => { this.close(); this.start(mode, this.fill); }, 'w-btn primary');
    go.disabled = party.leader !== myId;
    if (party.leader !== myId) uiEl('p', 'w-lede', card, 'Only the party leader can start.');
  }
  close(): void { this.scrim?.remove(); this.scrim = null; }
}
