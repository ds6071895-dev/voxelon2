// The party's shared Bedwars sheet: a small light dialog. The leader picks a
// format (2, 3 or 4 teams, each on its own island) and who plays where; bots
// can fill every team up to the biggest one. Everyone sees it live.
import type { PartyState } from '../net/protocol';
import { BW_TEAM_COLORS, BW_TEAM_NAMES } from '../bedwars_rules';
import { bwButton, bwEl } from '../bedwars_ui';
import { drawFace } from './face';
import '../styles/bedwars.css';

interface Hooks {
  onChange(teams: number, assignments: Record<string, number>, fill: boolean, revision: number): void;
  onStart(revision: number): void;
  onClose(): void;
}

const CLOSE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>';

export class BedwarsSetup {
  private readonly scrim: HTMLElement;
  private readonly kicker: HTMLElement;
  private readonly note: HTMLElement;
  private readonly formats: HTMLElement;
  private readonly grid: HTMLElement;
  private readonly fillRow: HTMLElement;
  private readonly fillInput: HTMLInputElement;
  private readonly error: HTMLElement;
  private readonly start: HTMLButtonElement;
  private party: PartyState | null = null;
  private myId = 0;
  private teams = 2;
  private assignments: Record<string, number> = {};
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
    bwEl('h2', '', title, 'Bedwars teams');
    const x = bwButton(head, '', () => this.close(), 'w-x'); x.innerHTML = CLOSE; x.setAttribute('aria-label', 'Close');
    this.note = bwEl('p', 'w-lede', dialog);
    this.formats = bwEl('div', 'bw-formats', dialog);
    this.formats.setAttribute('role', 'radiogroup'); this.formats.setAttribute('aria-label', 'Number of teams');
    for (const n of [2, 3, 4]) {
      const b = bwButton(this.formats, `${n} teams`, () => this.setTeams(n), 'bw-format');
      b.dataset.teams = String(n); b.setAttribute('role', 'radio');
    }
    this.grid = bwEl('div', 'bw-teams', dialog);
    this.fillRow = bwEl('label', 'bw-fill', dialog);
    this.fillInput = bwEl('input', '', this.fillRow); this.fillInput.type = 'checkbox';
    bwEl('span', '', this.fillRow, 'Fill empty spots with bots');
    this.fillInput.addEventListener('change', () => this.submit(this.teams, this.assignments, this.fillInput.checked));
    this.error = bwEl('div', 'w-err', dialog); this.error.setAttribute('role', 'alert');
    const foot = bwEl('div', 'bw-setup-foot', dialog);
    bwButton(foot, 'Shuffle', () => {
      const ids = (this.party?.members ?? []).map(m => m.id).sort(() => Math.random() - .5), next: Record<string, number> = {};
      ids.forEach((id, i) => { next[id] = i % this.teams; });
      this.submit(this.teams, next, this.fill);
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
    this.teams = setup?.teams ?? 2;
    this.assignments = {};
    party?.members.forEach(m => {
      const team = setup?.assignments[String(m.id)];
      if (team !== undefined && team >= 0 && team < this.teams) this.assignments[m.id] = team;
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
  private size(team: number): number { return Object.values(this.assignments).filter(v => v === team).length; }
  private assigned(id: number): boolean { const t = this.assignments[id]; return t !== undefined && t >= 0 && t < this.teams; }
  private canStart(): boolean {
    const p = this.party;
    if (!this.leader || this.pending || this.starting || !p || p.members.length < 2) return false;
    if (!p.members.every(m => this.assigned(m.id) && ['menu', 'results'].includes(m.status))) return false;
    const used = new Set(Object.values(this.assignments));
    return this.fill ? used.size >= 1 : used.size === this.teams;
  }

  private setTeams(n: number): void {
    if (n === this.teams) return;
    // Anyone on a team that no longer exists moves to the emptiest one.
    const next: Record<string, number> = {};
    const counts = Array.from({ length: n }, () => 0);
    for (const m of this.party?.members ?? []) {
      let t = this.assignments[m.id];
      if (t === undefined || t >= n) t = counts.indexOf(Math.min(...counts));
      next[m.id] = t; counts[t]++;
    }
    this.submit(n, next, this.fill);
  }
  private assign(id: number, team: number): void {
    if (this.assignments[id] === team) return;
    this.submit(this.teams, { ...this.assignments, [id]: team }, this.fill);
  }
  private submit(teams: number, assignments: Record<string, number>, fill: boolean): void {
    if (!this.leader || this.pending || this.starting) { this.render(); return; }
    this.teams = teams; this.assignments = { ...assignments }; this.fill = fill;
    this.pending = true; this.error.textContent = '';
    this.render();
    this.hooks.onChange(teams, { ...this.assignments }, fill, this.revision);
  }

  private chip(parent: HTMLElement, member: PartyState['members'][number], team: number): void {
    const editable = this.leader && !this.pending && !this.starting;
    const chip = bwEl('div', 'bw-chip', parent);
    const face = bwEl('span', 'w-face', chip);
    const canvas = bwEl('canvas', '', face); drawFace(canvas, member.cosmetics, member.skin);
    const name = bwEl('span', 'bw-chip-name', chip, member.username + (member.id === this.myId ? ' (you)' : ''));
    name.title = member.username;
    if (!['menu', 'results'].includes(member.status)) bwEl('small', '', chip, 'Busy');
    // Coloured dots move a player to another team.
    const moves = bwEl('span', 'bw-moves', chip);
    for (let t = 0; t < this.teams; t++) {
      if (t === team) continue;
      const b = bwButton(moves, '', () => this.assign(member.id, t), 'bw-move');
      b.style.setProperty('--team', BW_TEAM_COLORS[t]); b.disabled = !editable;
      b.setAttribute('aria-label', `Move ${member.username} to ${BW_TEAM_NAMES[t]}`); b.title = `To ${BW_TEAM_NAMES[t]}`;
    }
  }

  private render(): void {
    const members = this.party?.members ?? [];
    this.kicker.textContent = this.party ? `Party ${this.party.code}` : 'Party';
    this.note.textContent = !this.party ? 'Create or join a party first.'
      : !this.leader ? 'The party leader is choosing the teams.'
      : 'Pick how many teams, then tap a coloured dot to move a player.';
    for (const b of this.formats.querySelectorAll<HTMLButtonElement>('.bw-format')) {
      const on = Number(b.dataset.teams) === this.teams;
      b.setAttribute('aria-checked', String(on)); b.disabled = !this.leader || this.pending || this.starting;
    }
    this.grid.replaceChildren();
    const biggest = Math.max(1, ...Array.from({ length: this.teams }, (_, t) => this.size(t)));
    for (let t = 0; t < this.teams; t++) {
      const col = bwEl('div', 'bw-team-col', this.grid);
      col.style.setProperty('--team', BW_TEAM_COLORS[t]);
      const label = bwEl('div', 'bw-team-label', col);
      bwEl('b', '', label, BW_TEAM_NAMES[t]);
      const bots = this.fill ? biggest - this.size(t) : 0;
      bwEl('small', '', label, `${this.size(t)}${bots ? ` + ${bots} bot${bots > 1 ? 's' : ''}` : ''}`);
      const list = bwEl('div', 'bw-team-list', col);
      for (const m of members) if (this.assignments[m.id] === t) this.chip(list, m, t);
      if (!this.size(t) && !this.fill) bwEl('small', 'bw-empty', list, 'Empty');
    }
    this.fillInput.checked = this.fill; this.fillInput.disabled = !this.leader || this.pending || this.starting;
    const sizes = Array.from({ length: this.teams }, (_, t) => this.fill ? biggest : this.size(t));
    this.start.textContent = this.starting ? 'Starting' : !this.leader && this.party ? 'Waiting for leader' : `Start ${sizes.join('v')}`;
    this.start.disabled = !this.canStart();
  }
}
