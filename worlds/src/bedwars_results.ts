// The end-of-match card: a small light dialog with a compact stats table.
import { BW_TEAM_COLORS, BW_TEAM_NAMES, type BwResult, type BwTeam } from './bedwars_rules';
import { bwButton, bwEl, bwTime } from './bedwars_ui';
import type { PartyState } from './net/protocol';

interface Hooks { onReplay(): void; onEditTeams(): void; onLeave(): void; onOpen(): void }

export class BedwarsResults {
  private readonly scrim: HTMLElement;
  private readonly kicker: HTMLElement;
  private readonly title: HTMLElement;
  private readonly reason: HTMLElement;
  private readonly body: HTMLElement;
  private readonly note: HTMLElement;
  private readonly replay: HTMLButtonElement;
  private readonly edit: HTMLButtonElement;
  private readonly leave: HTMLButtonElement;
  private party: PartyState | null = null;
  private myId = -1;
  private busyUntil = 0;

  constructor(host: HTMLElement, private readonly hooks: Hooks) {
    this.scrim = bwEl('div', 'w-scrim bw-results', host);
    const dialog = bwEl('section', 'w-dialog bw-result-card', this.scrim);
    dialog.setAttribute('role', 'dialog'); dialog.setAttribute('aria-label', 'Match results');
    this.kicker = bwEl('span', 'w-kicker', dialog);
    this.title = bwEl('h2', '', dialog);
    this.reason = bwEl('p', 'w-lede', dialog);
    const wrap = bwEl('div', 'bw-table-wrap', dialog);
    const table = bwEl('table', 'bw-table', wrap);
    const head = bwEl('thead', '', table).appendChild(document.createElement('tr'));
    for (const text of ['Player', 'Kills', 'Finals', 'Beds', 'Deaths']) bwEl('th', '', head, text).scope = 'col';
    this.body = bwEl('tbody', '', table);
    this.note = bwEl('p', 'w-fine', dialog);
    const actions = bwEl('div', 'bw-result-actions', dialog);
    this.replay = bwButton(actions, 'Play again', () => this.act(this.hooks.onReplay), 'w-btn primary');
    this.edit = bwButton(actions, 'Teams', () => this.act(this.hooks.onEditTeams), 'w-btn');
    this.leave = bwButton(actions, 'Leave', () => this.act(this.hooks.onLeave), 'w-btn');
    this.scrim.addEventListener('pointerdown', e => e.stopPropagation());
    this.scrim.addEventListener('keydown', e => e.stopPropagation());
  }

  get open(): boolean { return this.scrim.classList.contains('open'); }

  setParty(party: PartyState | null, myId: number): void { this.party = party; this.myId = myId; this.permissions(); }

  show(result: BwResult, myId: number, myTeam: BwTeam): void {
    const first = !this.open;
    this.myId = myId;
    const won = result.winner === myTeam;
    this.kicker.textContent = result.winner === null ? 'Draw' : won ? 'Victory' : 'Defeat';
    this.kicker.style.color = result.winner === null ? '' : BW_TEAM_COLORS[result.winner];
    this.title.textContent = result.winner === null ? 'Nobody won' : `${BW_TEAM_NAMES[result.winner]} team wins`;
    this.reason.textContent = `${/wins!$/.test(result.reason) ? '' : `${result.reason} `}Match length ${bwTime(result.duration * 1000)}.`;
    this.body.replaceChildren();
    const rows = [...result.players].sort((a, b) => a.team - b.team || b.finals - a.finals || b.kills - a.kills);
    for (const p of rows) {
      const tr = bwEl('tr', '', this.body);
      tr.dataset.self = String(p.id === myId);
      const name = bwEl('td', '', tr);
      const dot = bwEl('i', 'bw-dot', name); dot.style.background = BW_TEAM_COLORS[p.team];
      bwEl('span', '', name, `${p.name}${p.id === myId ? ' (you)' : ''}`);
      for (const v of [p.kills, p.finals, p.beds, p.deaths]) bwEl('td', '', tr, String(v));
    }
    this.busyUntil = 0;
    this.scrim.classList.add('open');
    this.permissions();
    if (first) { this.hooks.onOpen(); (this.replay.disabled ? this.leave : this.replay).focus(); }
  }
  hide(): void { this.scrim.classList.remove('open'); }

  tick(now: number): void { if (this.busyUntil && now >= this.busyUntil) { this.busyUntil = 0; this.permissions(); } }

  private act(action: () => void): void {
    if (!this.open || this.busyUntil) return;
    if ((action === this.hooks.onReplay || action === this.hooks.onEditTeams) && this.party && this.party.leader !== this.myId) return;
    this.busyUntil = performance.now() + 1800;
    this.permissions();
    action();
  }
  private permissions(): void {
    const leader = !this.party || this.party.leader === this.myId, busy = this.busyUntil > 0;
    this.replay.disabled = busy || !leader;
    this.edit.disabled = busy || !leader;
    this.edit.hidden = !this.party;
    this.leave.disabled = busy;
    this.replay.textContent = busy ? 'One moment' : 'Play again';
    this.note.textContent = !leader ? 'Your party leader starts the next match.' : '';
  }
}
