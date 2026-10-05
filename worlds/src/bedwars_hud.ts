// The whole in-match HUD: a team bar, a short feed, one status pill and one
// contextual prompt. Every write goes through a guard, so a frame where nothing
// changed costs nothing.
import { bwButton, bwEl } from './bedwars_ui';
import { BW_TEAM_COLORS, BW_TEAM_NAMES, type BwTeam } from './bedwars_rules';

const BED = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 18V7M3 14h18v4M21 14v-2.5A2.5 2.5 0 0 0 18.5 9H11v5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><circle cx="7" cy="11" r="1.7" fill="currentColor"/></svg>';

export class BedwarsHud {
  readonly root: HTMLElement;
  private readonly teams: { root: HTMLElement; count: HTMLElement }[] = [];
  private time!: HTMLElement;
  private sub!: HTMLElement;
  private readonly feed: HTMLElement;
  private readonly pill: HTMLElement;
  private readonly prompt: HTMLButtonElement;
  private readonly promptLabel: HTMLElement;
  private readonly promptKey: HTMLElement;
  private readonly events: { node: HTMLElement; until: number }[] = [];
  private cache = new Map<HTMLElement, string>();

  constructor(app: HTMLElement, onPrompt: () => void) {
    this.root = bwEl('div', 'bw-hud', app);
    this.root.hidden = true;
    const bar = bwEl('div', 'bw-bar', this.root);
    for (const team of [0, 1] as const) {
      const root = bwEl('div', 'bw-team', bar);
      root.style.setProperty('--team', BW_TEAM_COLORS[team]);
      const icon = bwEl('span', 'bw-bed', root); icon.innerHTML = BED;
      const count = bwEl('b', '', root, '0');
      root.setAttribute('aria-label', BW_TEAM_NAMES[team]);
      this.teams.push({ root, count });
      if (team === 0) {
        const clock = bwEl('div', 'bw-clock', bar);
        this.time = bwEl('b', '', clock, '0:00');
        this.sub = bwEl('small', '', clock);
      }
    }
    this.feed = bwEl('div', 'bw-feed', this.root);
    this.feed.setAttribute('role', 'log'); this.feed.setAttribute('aria-live', 'polite');
    this.pill = bwEl('div', 'bw-pill', this.root);
    this.pill.setAttribute('role', 'status');
    this.prompt = bwButton(this.root, '', onPrompt, 'bw-prompt');
    this.promptKey = bwEl('kbd', '', this.prompt, 'E');
    this.promptLabel = bwEl('span', '', this.prompt);
    this.prompt.hidden = true; this.pill.hidden = true;
  }

  private set(el: HTMLElement, text: string): void {
    if (this.cache.get(el) === text) return;
    this.cache.set(el, text); el.textContent = text;
  }
  private flag(el: HTMLElement, name: string, value: string): void {
    const key = `${name}`;
    if (el.dataset[key] !== value) el.dataset[key] = value;
  }

  show(visible: boolean): void { this.root.hidden = !visible; }
  reset(): void {
    this.feed.replaceChildren(); this.events.length = 0; this.cache = new Map();
    this.pill.hidden = true; this.prompt.hidden = true;
  }

  /** `bed` true = intact, `alive` = players still in it. */
  setTeam(team: BwTeam, bed: boolean, alive: number, mine: boolean): void {
    const t = this.teams[team];
    this.set(t.count, String(alive));
    this.flag(t.root, 'bed', bed ? '1' : '0');
    this.flag(t.root, 'mine', mine ? '1' : '0');
  }
  setClock(time: string, sub: string, tone: 'calm' | 'warn' | 'danger'): void {
    this.set(this.time, time); this.set(this.sub, sub); this.flag(this.root, 'tone', tone);
  }
  /** One small pill in the middle of the screen, or null to hide it. */
  setPill(text: string | null, tone: 'info' | 'danger' = 'info'): void {
    if (text === null) { if (!this.pill.hidden) this.pill.hidden = true; return; }
    if (this.pill.hidden) this.pill.hidden = false;
    this.set(this.pill, text); this.flag(this.pill, 'tone', tone);
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
    while (this.events.length > 3) this.events.shift()!.node.remove();
  }
  tick(now: number): void {
    while (this.events[0] && this.events[0].until <= now) this.events.shift()!.node.remove();
  }
}
