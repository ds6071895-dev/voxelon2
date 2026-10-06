// The whole in-match HUD: a Hypixel-style sidebar, a short feed, one status
// pill, one big headline (death, a bed going down) and one contextual prompt. Every write goes through a guard, so a frame where nothing
// changed costs nothing.
import { bwButton, bwEl } from './bedwars_ui';
import { BW_TEAM_COLORS, BW_TEAM_NAMES, type BwTeam } from './bedwars_rules';


/** One row of the sidebar per team. */
interface BwSidebarTeam { team: BwTeam; bed: boolean; alive: number; mine: boolean }
interface BwSidebar { next: string; clock: string; tone: 'calm' | 'warn' | 'danger'; teams: BwSidebarTeam[]; kills: number; finals: number; beds: number }

export class BedwarsHud {
  readonly root: HTMLElement;
  private readonly side: HTMLElement;
  private readonly sideNext: HTMLElement;
  private readonly sideClock: HTMLElement;
  private readonly sideTeams: HTMLElement;
  private readonly teamRows: { root: HTMLElement; state: HTMLElement; you: HTMLElement }[] = [];
  private readonly stats: HTMLElement[] = [];
  private readonly feed: HTMLElement;
  private readonly pill: HTMLElement;
  private readonly prompt: HTMLButtonElement;
  private readonly promptLabel: HTMLElement;
  private readonly promptKey: HTMLElement;
  private readonly events: { node: HTMLElement; until: number }[] = [];
  private readonly title: HTMLElement;
  private readonly titleMain: HTMLElement;
  private readonly titleSub: HTMLElement;
  /** A timed headline (a bed going down) outranks the standing one. */
  private flashUntil = 0;
  private cache = new Map<HTMLElement, string>();

  constructor(app: HTMLElement, onPrompt: () => void) {
    this.root = bwEl('div', 'bw-hud', app);
    this.root.hidden = true;
    // The sidebar, Hypixel style: what happens next, every team, your score.
    this.side = bwEl('aside', 'bw-side', this.root);
    this.side.setAttribute('aria-label', 'Scoreboard');
    const head = bwEl('div', 'bw-side-head', this.side);
    bwEl('b', '', head, 'BED WARS');
    this.sideClock = bwEl('small', '', head, '0:00');
    this.sideNext = bwEl('div', 'bw-side-next', this.side);
    this.sideTeams = bwEl('div', 'bw-side-teams', this.side);
    for (let team = 0; team < 4; team++) {
      const root = bwEl('div', 'bw-side-team', this.sideTeams);
      root.style.setProperty('--team', BW_TEAM_COLORS[team]);
      bwEl('i', '', root, BW_TEAM_NAMES[team][0]);
      bwEl('span', '', root, BW_TEAM_NAMES[team]);
      const state = bwEl('b', '', root);
      const you = bwEl('small', '', root, 'YOU');
      root.hidden = true;
      this.teamRows.push({ root, state, you });
    }
    const stats = bwEl('div', 'bw-side-stats', this.side);
    for (const label of ['Kills', 'Final kills', 'Beds broken']) {
      const row = bwEl('div', '', stats); bwEl('span', '', row, label); this.stats.push(bwEl('b', '', row, '0'));
    }
    this.feed = bwEl('div', 'bw-feed', this.root);
    this.feed.setAttribute('role', 'log'); this.feed.setAttribute('aria-live', 'polite');
    this.pill = bwEl('div', 'bw-pill', this.root);
    this.pill.setAttribute('role', 'status');
    this.prompt = bwButton(this.root, '', onPrompt, 'bw-prompt');
    this.promptKey = bwEl('kbd', '', this.prompt, 'E');
    this.promptLabel = bwEl('span', '', this.prompt);
    this.prompt.hidden = true; this.pill.hidden = true;
    this.title = bwEl('div', 'bw-title', this.root);
    this.title.setAttribute('role', 'status');
    this.titleMain = bwEl('b', '', this.title);
    this.titleSub = bwEl('small', '', this.title);
    this.title.hidden = true;
  }

  private set(el: HTMLElement, text: string): void {
    if (this.cache.get(el) === text) return;
    this.cache.set(el, text); el.textContent = text;
  }
  private flag(el: HTMLElement, name: string, value: string): void {
    if (el.dataset[name] !== value) el.dataset[name] = value;
  }

  show(visible: boolean): void { this.root.hidden = !visible; }
  reset(): void {
    this.feed.replaceChildren(); this.events.length = 0; this.cache = new Map();
    this.pill.hidden = true; this.prompt.hidden = true; this.title.hidden = true; this.flashUntil = 0;
  }

  setSidebar(s: BwSidebar): void {
    this.set(this.sideNext, s.next); this.set(this.sideClock, s.clock); this.flag(this.side, 'tone', s.tone);
    this.teamRows.forEach((row, team) => {
      const t = s.teams.find((v) => v.team === team);
      if (row.root.hidden !== !t) row.root.hidden = !t;
      if (!t) return;
      // ✓ while the bed stands; then how many are left; ✗ once they are out.
      this.set(row.state, t.bed ? '✓' : t.alive > 0 ? String(t.alive) : '✗');
      this.flag(row.root, 'state', t.bed ? 'bed' : t.alive > 0 ? 'alive' : 'out');
      row.you.hidden = !t.mine;
    });
    [s.kills, s.finals, s.beds].forEach((v, i) => this.set(this.stats[i], String(v)));
  }
  /** One small pill in the middle of the screen, or null to hide it. */
  setPill(text: string | null, tone: 'info' | 'danger' = 'info'): void {
    if (text === null) { if (!this.pill.hidden) this.pill.hidden = true; return; }
    if (this.pill.hidden) this.pill.hidden = false;
    this.set(this.pill, text); this.flag(this.pill, 'tone', tone);
  }
  /** The big centred headline that stays while it is true (dead, eliminated). */
  setTitle(text: string | null, sub = '', tone: 'info' | 'danger' | 'good' = 'danger'): void {
    if (performance.now() < this.flashUntil) return;
    if (text === null) { if (!this.title.hidden) this.title.hidden = true; return; }
    this.showTitle(text, sub, tone);
  }
  /** A headline for a few seconds (a bed destroyed). */
  flash(text: string, sub: string, tone: 'info' | 'danger' | 'good', ms = 2800): void {
    this.flashUntil = 0; this.showTitle(text, sub, tone);
    this.title.classList.remove('pop'); void this.title.offsetWidth; this.title.classList.add('pop');
    this.flashUntil = performance.now() + ms;
  }
  private showTitle(text: string, sub: string, tone: string): void {
    if (this.title.hidden) this.title.hidden = false;
    this.set(this.titleMain, text); this.set(this.titleSub, sub); this.flag(this.title, 'tone', tone);
  }
  setPrompt(label: string | null, key: string): void {
    if (label === null) { if (!this.prompt.hidden) this.prompt.hidden = true; return; }
    if (this.prompt.hidden) this.prompt.hidden = false;
    this.set(this.promptLabel, label); this.set(this.promptKey, key);
  }
  toast(text: string, tone: string): void {
    const node = bwEl('div', 'bw-toast', this.feed, text);
    node.dataset.tone = tone === 'good' ? 'good' : tone === 'danger' ? 'danger' : 'info';
    this.events.push({ node, until: performance.now() + (tone === 'danger' ? 6500 : 4500) });
    while (this.events.length > 4) this.events.shift()!.node.remove();
  }
  tick(now: number): void {
    while (this.events[0] && this.events[0].until <= now) this.events.shift()!.node.remove();
    if (this.flashUntil && now >= this.flashUntil) { this.flashUntil = 0; this.title.hidden = true; }
  }
}
