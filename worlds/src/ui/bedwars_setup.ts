// The party's shared team sheet: a small light dialog. Only the leader can
// change it; everyone sees it live.
import type { PartyState } from '../net/protocol';
import { BW_TEAM_COLORS, BW_TEAM_NAMES } from '../bedwars_rules';
import { bwButton, bwEl } from '../bedwars_ui';
import { drawFace } from './face';
import '../styles/bedwars.css';

interface Hooks {
  onChange(assignments: Record<string, 0 | 1>, fill: boolean, revision: number): void;
  onStart(revision: number): void;
  onClose(): void;
}

const CLOSE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>';

export class BedwarsSetup {
  private readonly scrim: HTMLElement;
  private readonly kicker: HTMLElement;
  private readonly note: HTMLElement;
  private readonly columns: HTMLElement[] = [];
  private readonly counts: HTMLElement[] = [];
  private readonly pool: HTMLElement;
  private readonly fillRow: HTMLElement;
  private readonly fillInput: HTMLInputElement;
  private readonly error: HTMLElement;
  private readonly start: HTMLButtonElement;
  private party: PartyState | null = null;
  private myId = 0;
  private assignments: Record<string, 0 | 1> = {};
  private fill = false;
  private revision = 0;
  private pending = false;
  private starting = false;
  private returnFocus: HTMLElement | null = null;

  constructor(host: HTMLElement, private readonly hooks: Hooks) {
    this.scrim = bwEl('div', 'w-scrim bw-setup', host);
    const dialog = bwEl('section', 'w-dialog bw-setup-card', this.scrim);
    dialog.setAttribute('role', 'dialog'); dialog.setAttribute('aria-label', 'Choose teams');
    const head = bwEl('div', 'w-dialog-head', dialog);
    const title = bwEl('div', '', head);
    this.kicker = bwEl('span', 'w-kicker', title, 'Party');
    bwEl('h2', '', title, 'Choose teams');
    const x = bwButton(head, '', () => this.close(), 'w-x'); x.innerHTML = CLOSE; x.setAttribute('aria-label', 'Close');
    this.note = bwEl('p', 'w-lede', dialog);
    const grid = bwEl('div', 'bw-teams', dialog);
    for (const team of [0, 1] as const) {
      const col = bwEl('div', 'bw-team-col', grid);
      col.style.setProperty('--team', BW_TEAM_COLORS[team]);
      const label = bwEl('div', 'bw-team-label', col);
      bwEl('b', '', label, BW_TEAM_NAMES[team]);
      this.counts.push(bwEl('small', '', label));
      this.columns.push(bwEl('div', 'bw-team-list', col));
    }
    this.pool = bwEl('div', 'bw-pool', dialog);
    this.fillRow = bwEl('label', 'bw-fill', dialog);
    this.fillInput = bwEl('input', '', this.fillRow); this.fillInput.type = 'checkbox';
    bwEl('span', '', this.fillRow, 'Add an AI teammate to the smaller team');
    this.fillInput.addEventListener('change', () => this.submit(this.assignments, this.fillInput.checked));
    this.error = bwEl('div', 'w-err', dialog); this.error.setAttribute('role', 'alert');
    const foot = bwEl('div', 'bw-setup-foot', dialog);
    bwButton(foot, 'Balance', () => {
      const next: Record<string, 0 | 1> = {};
      this.party?.members.forEach((m, i) => { next[m.id] = (i % 2) as 0 | 1; });
      this.submit(next, this.fill);
    }, 'w-btn');
    this.start = bwButton(foot, 'Start', () => {
      if (!this.canStart()) return;
      this.starting = true; this.render(); this.hooks.onStart(this.revision);
    }, 'w-btn primary');
    this.scrim.addEventListener('pointerdown', e => { e.stopPropagation(); if (e.target === this.scrim) this.close(); });
    this.scrim.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Escape') { e.preventDefault(); this.close(); } });
    this.render();
  }

  get open(): boolean { return this.scrim.classList.contains('open'); }

  show(): void {
    if (this.open) return;
    this.returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.scrim.classList.add('open'); this.starting = false;
    this.render();
    this.start.focus();
  }
  close(): void {
    if (!this.open) return;
    this.scrim.classList.remove('open'); this.starting = false;
    this.returnFocus?.focus();
    this.hooks.onClose();
  }

  update(party: PartyState | null, myId: number): void {
    this.party = party; this.myId = myId;
    const setup = party?.bedwars;
    this.revision = setup?.revision ?? 0;
    this.fill = setup?.fill ?? false;
    this.assignments = {};
    party?.members.forEach(m => {
      const team = setup?.assignments[String(m.id)];
      if (team === 0 || team === 1) this.assignments[m.id] = team;
    });
    this.pending = false; this.error.textContent = '';
    this.render();
  }
  setError(message: string): void {
    this.pending = false; this.starting = false;
    if (this.party) this.update(this.party, this.myId);
    this.error.textContent = message;
  }

  private get leader(): boolean { return !!this.party && this.party.leader === this.myId; }
  private size(team: 0 | 1): number { return Object.values(this.assignments).filter(v => v === team).length; }
  private assigned(id: number): boolean { return this.assignments[id] === 0 || this.assignments[id] === 1; }
  private canStart(): boolean {
    const p = this.party;
    return this.leader && !this.pending && !this.starting && !!p && p.members.length >= 2 && p.members.length <= 4
      && this.size(0) > 0 && this.size(1) > 0 && this.size(0) <= 2 && this.size(1) <= 2
      && p.members.every(m => this.assigned(m.id) && ['menu', 'results'].includes(m.status));
  }

  /** Moves one player. A full team swaps, so the leader can never build a 3v1. */
  private assign(id: number, team: 0 | 1): void {
    const from = this.assignments[id];
    if (from === team) return;
    const next = { ...this.assignments };
    if (this.size(team) >= 2 || (this.assigned(id) && this.size(from) === 1)) {
      const other = this.party?.members.find(m => m.id !== id && next[m.id] === team);
      if (other) next[other.id] = this.assigned(id) ? from : team === 0 ? 1 : 0;
    }
    next[id] = team;
    this.submit(next, this.fill);
  }
  private submit(assignments: Record<string, 0 | 1>, fill: boolean): void {
    if (!this.leader || this.pending || this.starting) { this.render(); return; }
    this.assignments = { ...assignments };
    this.fill = fill && this.party?.members.length === 3;
    this.pending = true; this.error.textContent = '';
    this.render();
    this.hooks.onChange({ ...this.assignments }, this.fill, this.revision);
  }

  private chip(parent: HTMLElement, member: PartyState['members'][number], team: 0 | 1 | null): void {
    const editable = this.leader && !this.pending && !this.starting;
    const chip = bwEl('div', 'bw-chip', parent);
    const face = bwEl('span', 'w-face', chip);
    const canvas = bwEl('canvas', '', face); drawFace(canvas, member.cosmetics, member.skin);
    const name = bwEl('span', 'bw-chip-name', chip, member.username + (member.id === this.myId ? ' (you)' : ''));
    name.title = member.username;
    if (!['menu', 'results'].includes(member.status)) bwEl('small', '', chip, 'Busy');
    const targets: (0 | 1)[] = team === null ? [0, 1] : [(1 - team) as 0 | 1];
    for (const t of targets) {
      const b = bwButton(chip, team === null ? BW_TEAM_NAMES[t] : `To ${BW_TEAM_NAMES[t]}`, () => this.assign(member.id, t), 'bw-move');
      b.style.setProperty('--team', BW_TEAM_COLORS[t]); b.disabled = !editable;
    }
  }

  private render(): void {
    const members = this.party?.members ?? [];
    this.kicker.textContent = this.party ? `Party ${this.party.code}` : 'Party';
    const unassigned = members.filter(m => !this.assigned(m.id));
    this.note.textContent = !this.party ? 'Create or join a party first.'
      : !this.leader ? 'The party leader is choosing teams.'
      : unassigned.length ? 'Put everyone on a team, or press Balance.'
      : 'Tap a player to move them to the other team.';
    for (const team of [0, 1] as const) {
      this.columns[team].replaceChildren();
      for (const m of members) if (this.assignments[m.id] === team) this.chip(this.columns[team], m, team);
      const humans = this.size(team), bot = members.length === 3 && this.fill && humans === 1;
      this.counts[team].textContent = `${humans}${bot ? ' + AI' : ''}`;
    }
    this.pool.replaceChildren(); this.pool.hidden = !unassigned.length;
    for (const m of unassigned) this.chip(this.pool, m, null);
    this.fillRow.hidden = members.length !== 3;
    this.fillInput.checked = this.fill; this.fillInput.disabled = !this.leader || this.pending || this.starting;
    let a = this.size(0), b = this.size(1);
    if (members.length === 3 && this.fill && a && b) a = b = 2;
    this.start.textContent = this.starting ? 'Starting' : !this.leader && this.party ? 'Waiting for leader' : a && b ? `Start ${a} v ${b}` : 'Start';
    this.start.disabled = !this.canStart();
  }
}
