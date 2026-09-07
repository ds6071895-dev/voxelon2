// Party Games HUD: the round banner, the live standings, the Color Chaos call,
// and the intermission scoreboard card.
//
// Like `bedwars_ui.ts`, the DOM is built here from the typed tables rather than
// hand-authored markup, so the four microgames cannot drift from PARTY_GAMES.

import {
  COLORS_PALETTE, PARTY_PLAYLIST, partyGame,
  type PartyGameId, type PartyLobbySnapshot,
} from './partygames';

/** Readable names for the four tile colours, for the Color Chaos call. */
const COLOR_NAMES = ['CRIMSON', 'COBALT', 'AMBER', 'VERDANT'];
const COLOR_HEX = ['#e0555f', '#5b8dde', '#e8a830', '#4ab660'];

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K, cls?: string, text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

export class PartyUI {
  private readonly root: HTMLDivElement;
  private readonly bannerEl: HTMLDivElement;
  private readonly bannerTitle: HTMLDivElement;
  private readonly bannerRule: HTMLDivElement;
  private readonly progressEl: HTMLDivElement;
  private readonly standingsEl: HTMLDivElement;
  private readonly callEl: HTMLDivElement;
  private readonly cardEl: HTMLDivElement;

  private bannerUntil = 0;
  private callUntil = 0;

  constructor(host: HTMLElement) {
    this.root = el('div', 'pg-hud');
    this.root.hidden = true;

    this.bannerEl = el('div', 'pg-banner');
    this.bannerTitle = el('div', 'pg-banner-title');
    this.bannerRule = el('div', 'pg-banner-rule');
    this.bannerEl.append(this.bannerTitle, this.bannerRule);
    this.bannerEl.hidden = true;

    // A pip per playlist entry, so "how far through am I" is answerable at a
    // glance rather than by counting scoreboard cards.
    this.progressEl = el('div', 'pg-progress');

    this.standingsEl = el('div', 'pg-standings');
    this.callEl = el('div', 'pg-call');
    this.callEl.hidden = true;
    this.cardEl = el('div', 'pg-card');
    this.cardEl.hidden = true;

    this.root.append(this.progressEl, this.standingsEl, this.bannerEl, this.callEl, this.cardEl);
    host.appendChild(this.root);
  }

  setVisible(visible: boolean): void {
    this.root.hidden = !visible;
    if (!visible) {
      this.bannerEl.hidden = true;
      this.callEl.hidden = true;
      this.cardEl.hidden = true;
    }
  }

  /** The round-open banner: which microgame, and its one-line rule. */
  showRound(game: PartyGameId, now: number): void {
    const def = partyGame(game);
    this.bannerTitle.textContent = def.title;
    this.bannerRule.textContent = def.rule;
    this.bannerEl.hidden = false;
    this.bannerEl.classList.remove('out');
    this.bannerUntil = now + 4_000;
    this.cardEl.hidden = true;
  }

  setProgress(roundIndex: number): void {
    this.progressEl.replaceChildren(
      el('span', 'pg-progress-label',
        `ROUND ${Math.min(roundIndex + 1, PARTY_PLAYLIST.length)} / ${PARTY_PLAYLIST.length}`),
      ...PARTY_PLAYLIST.map((_, i) =>
        el('span', `pg-progress-pip${i < roundIndex ? ' done' : i === roundIndex ? ' live' : ''}`)),
    );
  }

  setSnapshot(snapshot: PartyLobbySnapshot | null, meId: number): void {
    if (!snapshot) { this.standingsEl.replaceChildren(); return; }
    this.setProgress(snapshot.roundIndex);
    const rows = [...snapshot.participants]
      .sort((a, b) => b.points - a.points || a.joinOrder - b.joinOrder)
      .map((p) => {
        const row = el('div', `pg-row${p.id === meId ? ' me' : ''}${p.alive ? '' : ' out'}`);
        row.append(
          el('span', 'pg-row-name', p.username),
          el('span', 'pg-row-points', String(p.points)),
        );
        return row;
      });
    this.standingsEl.replaceChildren(...rows);
  }

  /** Color Chaos: the called colour, and how long until the rest drops. */
  showCall(colour: number, vanishAt: number, serverNow: number, now: number): void {
    const i = Math.max(0, Math.min(COLORS_PALETTE.length - 1, colour));
    this.callEl.replaceChildren(
      el('span', 'pg-call-label', 'STAND ON'),
      el('span', 'pg-call-name', COLOR_NAMES[i] ?? `COLOUR ${i}`),
    );
    this.callEl.style.setProperty('--pg-call', COLOR_HEX[i] ?? '#fff');
    this.callEl.hidden = false;
    this.callUntil = now + Math.max(500, vanishAt - serverNow);
  }

  hideCall(): void { this.callEl.hidden = true; }

  /** The intermission scoreboard, counting down to the next microgame. */
  showIntermission(
    nextGame: PartyGameId | undefined,
    standings: { id: number; username: string; points: number }[],
    meId: number,
  ): void {
    this.bannerEl.hidden = true;
    this.callEl.hidden = true;
    this.cardEl.replaceChildren(
      el('div', 'pg-card-title', nextGame ? `NEXT: ${partyGame(nextGame).title}` : 'FINAL STANDINGS'),
      ...standings.map((s, i) => {
        const row = el('div', `pg-card-row${s.id === meId ? ' me' : ''}`);
        row.append(
          el('span', 'pg-card-place', `${i + 1}`),
          el('span', 'pg-card-name', s.username),
          el('span', 'pg-card-points', `${s.points} pts`),
        );
        return row;
      }),
    );
    this.cardEl.hidden = false;
  }

  hideCard(): void { this.cardEl.hidden = true; }

  update(now: number): void {
    if (!this.bannerEl.hidden && now >= this.bannerUntil) this.bannerEl.hidden = true;
    if (!this.callEl.hidden && now >= this.callUntil) this.callEl.hidden = true;
  }
}

/** Result copy. Party Games is UNRANKED — the Crown is the prize, and there is
 *  deliberately no rank or RP line to show. */
export function partyResultCopy(
  winner: string | null, reason: string,
): { title: string; sub: string } {
  return {
    title: winner ? `${winner} TAKES THE CROWN` : 'NO CROWN',
    sub: reason === 'complete' ? 'Four microgames, most points wins · unranked'
      : reason === 'forfeit' ? 'Everyone else left the party · unranked'
      : 'Party cancelled',
  };
}

/** Why somebody went out, for the elimination feed. */
export function partyEliminationText(
  username: string, reason: 'void' | 'sludge' | 'left',
): string {
  return reason === 'void' ? `${username} fell`
    : reason === 'sludge' ? `${username} went under`
    : `${username} left`;
}
