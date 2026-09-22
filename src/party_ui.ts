import { parkourTheme } from './parkour_themes';
import {
  BRIDGE_GOAL_LIMIT, BRIDGE_TEAM_NAME, PARKOUR_PLATFORMS, partyGame, parkourCatchUp,
  type PartyLobbySnapshot, type PartyGameId, type PartyParticipant,
} from './partygames';

function el(tag: string, cls: string, text = ''): HTMLElement {
  const n = document.createElement(tag);
  n.className = cls;
  n.textContent = text;
  return n;
}
/** Crimson and cobalt, matching the wool each side builds with. */
const TEAM_CSS = ['#ff5f76', '#5aa8ff'];

export class PartyUI {
  private root = el('div', 'pg-hud');
  private progress = el('div', 'pg-progress');
  private score = el('div', 'pg-score');
  private clock = el('div', 'pg-call');
  private standings = el('div', 'pg-standings');
  private card = el('div', 'pg-card');
  private banner = el('div', 'pg-banner');
  private snapshot: PartyLobbySnapshot | null = null;
  private me = 0;
  private lastPhase = '';
  private lastRound = '';
  private lastGoal = 0;
  private bannerUntil = 0;
  onReplay?: () => void;
  onLeave?: () => void;
  /** Local (performance.now) time the Bridge bow can fire again. */
  bowReadyAt = 0;
  private lastKill = 0;
  constructor(host: HTMLElement) {
    this.root.append(this.progress, this.score, this.clock, this.standings, this.card, this.banner);
    host.append(this.root);
    this.setVisible(false);
  }
  setVisible(v: boolean): void {
    this.root.hidden = !v;
    if (!v) {
      this.lastPhase = '';
      this.lastRound = '';
      this.lastGoal = 0;
      this.lastKill = 0;
    }
  }
  private myTeam(): number {
    return this.snapshot?.participants.find(p => p.id === this.me)?.team ?? 0;
  }
  setSnapshot(s: PartyLobbySnapshot | null, me: number): void {
    this.snapshot = s;
    this.me = me;
    if (!s)
      return;
    const bridge = s.mode === 'bridge';
    this.progress.textContent = bridge
      ? `THE BRIDGE · FIRST TO ${BRIDGE_GOAL_LIMIT}`
      : `${s.arena ? parkourTheme(s.arena.seed).title : 'PARKOUR DUEL'} · INFINITE WOOL`;
    this.renderScore(s, bridge);
    const running = s.phase === 'running';
    this.standings.replaceChildren(...this.order(s).map(p => {
      const row = el('div', `pg-row${p.id === me ? ' me' : ''}${p.connected ? '' : ' out'}`);
      const name = el('span', 'pg-row-name', p.username + (p.connected ? '' : ' · left'));
      if (bridge)
        name.style.borderLeft = `3px solid ${TEAM_CSS[p.team]}`, name.style.paddingLeft = '7px';
      row.append(name, el('span', 'pg-row-points', bridge
        ? `${p.score} goal${p.score === 1 ? '' : 's'} · ${p.kills}/${p.deaths} K/D`
        : `${p.score}/${PARKOUR_PLATFORMS - 1} · ${p.falls} falls`));
      return row;
    }));
    const key = `${s.id}:${s.revision}`;
    if (running && this.lastRound !== key) {
      this.showRound(s.round!.game, performance.now());
      this.lastRound = key;
    }
    // A goal is a beat of its own: it interrupts whatever the banner was
    // showing, and it is keyed off the server timestamp so it plays once.
    if (running && s.lastGoal && s.lastGoal.at !== this.lastGoal) {
      this.lastGoal = s.lastGoal.at;
      const mine = s.lastGoal.id === me;
      this.banner.replaceChildren(
        el('div', 'pg-banner-title', mine ? 'GOAL!' : `${s.lastGoal.username} SCORED`),
        el('div', 'pg-banner-rule', `${BRIDGE_TEAM_NAME[s.lastGoal.team]} ${s.teamScores[s.lastGoal.team]} — ${s.teamScores[1 - s.lastGoal.team]} ${BRIDGE_TEAM_NAME[1 - s.lastGoal.team]}`));
      (this.banner.firstElementChild as HTMLElement).style.color = TEAM_CSS[s.lastGoal.team];
      this.banner.hidden = false;
      this.bannerUntil = performance.now() + 2600;
    }
    // A kill is its own beat — and on a one-block span it is usually the beat
    // that decided the goal that follows it.
    if (running && s.lastKill && s.lastKill.at !== this.lastKill) {
      this.lastKill = s.lastKill.at;
      const mine = s.lastKill.id === me;
      const how = s.lastKill.cause === 'void' ? 'knocked into the void'
        : s.lastKill.cause === 'bow' ? 'shot' : 'cut down';
      this.banner.replaceChildren(
        el('div', 'pg-banner-title', mine ? 'KILL' : 'DOWN'),
        el('div', 'pg-banner-rule', `${s.lastKill.username} ${how} ${s.lastKill.victim}`));
      (this.banner.firstElementChild as HTMLElement).style.color = TEAM_CSS[s.lastKill.team];
      this.banner.hidden = false;
      this.bannerUntil = performance.now() + 1800;
    }
    if (s.phase !== this.lastPhase) {
      this.lastPhase = s.phase;
      this.card.hidden = s.phase !== 'results';
      if (s.phase === 'results' && s.result) {
        const winner = s.participants.find(p => p.id === s.result!.winner);
        const title = s.result.finishReason === 'cancelled' ? 'COULD NOT LOAD THE ARENA'
          : bridge
            ? (s.result.winnerTeam === null ? 'DRAW'
              : `${BRIDGE_TEAM_NAME[s.result.winnerTeam]} ${s.result.winnerTeam === this.myTeam() ? 'WINS — THAT IS YOU' : 'WINS'}`)
            : winner ? (winner.id === me ? 'YOU WIN' : `${winner.username} WINS`) : 'DRAW';
        const cancelled = s.result.finishReason === 'cancelled';
        const won = !cancelled && (bridge
          ? s.result.winnerTeam !== null && s.result.winnerTeam === this.myTeam()
          : winner?.id === me);
        const draw = !cancelled && (bridge ? s.result.winnerTeam === null : !winner);
        const outcome = cancelled || draw ? 'draw' : won ? 'win' : 'lose';
        this.card.className = `pg-card pg-result ${outcome}`;
        const accent = bridge && s.result.winnerTeam !== null ? TEAM_CSS[s.result.winnerTeam]
          : outcome === 'win' ? '#ffd25e' : outcome === 'lose' ? '#ff6d80' : '#9fb4cc';
        this.card.style.setProperty('--pg-accent', accent);
        const kicker = el('div', 'pg-result-kicker',
          cancelled ? 'Match cancelled' : outcome === 'win' ? 'Victory' : outcome === 'lose' ? 'Defeat' : 'Draw');
        const heading = el('div', 'pg-card-title', title);
        const me2 = s.participants.find(p => p.id === me);
        const note = bridge
          ? `${s.result.teamScores[0]} — ${s.result.teamScores[1]} · ${BRIDGE_TEAM_NAME[0]} vs ${BRIDGE_TEAM_NAME[1]} · ${me2?.kills ?? 0} kills, ${me2?.deaths ?? 0} deaths. Cross, fight, dive.`
          : `${me2?.score ?? 0} / ${PARKOUR_PLATFORMS - 1} platforms · Sprint, jump, race again.`;
        const board = el('div', 'pg-result-board');
        this.order(s).forEach((p, i) => {
          const row = el('div', `pg-card-row${p.id === me ? ' me' : ''}`);
          const place = el('span', 'pg-card-place', String(i + 1));
          const name = el('span', 'pg-card-name', p.username);
          if (bridge) name.style.color = TEAM_CSS[p.team];
          row.append(place, name, el('span', 'pg-card-points', bridge
            ? `${p.score} goal${p.score === 1 ? '' : 's'} · ${p.kills}/${p.deaths}`
            : `${p.score}/${PARKOUR_PLATFORMS - 1} · ${p.falls} falls`));
          board.append(row);
        });
        this.card.replaceChildren(kicker, heading, el('p', 'pg-result-note', note), board);
        const actions = el('div', 'pg-result-actions');
        for (const [label, cls, action] of [
          ['Play again', 'pg-result-btn primary', () => this.onReplay?.()],
          ['Back to games', 'pg-result-btn', () => this.onLeave?.()],
        ] as const) {
          const b = el('button', cls, label) as HTMLButtonElement;
          b.type = 'button';
          b.addEventListener('click', action);
          actions.append(b);
        }
        this.card.append(actions);
      }
    }
  }
  private order(s: PartyLobbySnapshot): PartyParticipant[] {
    return [...s.participants].sort((a, b) =>
      s.mode === 'bridge' ? a.team - b.team || b.score - a.score || a.joinOrder - b.joinOrder
        : b.score - a.score || a.falls - b.falls || a.joinOrder - b.joinOrder);
  }
  /** The Bridge scoreline: two team pills either side of the goal count. */
  private renderScore(s: PartyLobbySnapshot, bridge: boolean): void {
    this.score.hidden = !bridge;
    if (!bridge)
      return;
    const mine = this.myTeam();
    this.score.replaceChildren(...[0, 1].flatMap(team => {
      const pill = el('div', `pg-team${team === mine ? ' me' : ''}`);
      pill.style.setProperty('--team', TEAM_CSS[team]);
      pill.append(el('span', 'pg-team-name', BRIDGE_TEAM_NAME[team]), el('b', 'pg-team-goals', String(s.teamScores[team])));
      return team === 0 ? [pill, el('span', 'pg-team-split', `TO ${BRIDGE_GOAL_LIMIT}`)] : [pill];
    }));
  }
  showRound(game: PartyGameId, now: number): void {
    const d = partyGame(game);
    const theme = this.snapshot?.arena ? parkourTheme(this.snapshot.arena.seed) : null;
    const parkour = game === 'parkour' && theme;
    this.banner.replaceChildren(
      el('div', 'pg-banner-title', parkour ? theme.title : d.title),
      el('div', 'pg-banner-rule', parkour ? `${theme.subtitle} · ${d.rule}` : d.rule));
    (this.banner.firstElementChild as HTMLElement).style.color = '';
    this.banner.hidden = false;
    this.bannerUntil = now + 6500;
  }
  hideCard(): void { this.card.hidden = true; }
  hideCall(): void { this.clock.hidden = true; }
  update(localNow: number, serverNow: number): void {
    const s = this.snapshot;
    if (!s)
      return;
    if (localNow >= this.bannerUntil)
      this.banner.hidden = true;
    this.clock.hidden = false;
    let text = '';
    if (s.phase === 'countdown')
      text = s.countdownEndsAt === undefined ? 'LOADING FOR EVERYONE…' : `READY · ${Math.max(1, Math.ceil((s.countdownEndsAt - serverNow) / 1000))}`;
    else if (s.phase === 'running' && s.round) {
      const secs = Math.max(0, Math.ceil((s.round.endsAt - serverNow) / 1000));
      text = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
      const p = s.participants.find(v => v.id === this.me);
      if (s.round.game === 'parkour') {
        text += ` · CHECKPOINT ${p?.checkpoint ?? 0} · NEXT ${(p?.progress ?? 0) + 1}/${PARKOUR_PLATFORMS - 1} · ${p?.falls ?? 0} FALLS · R TO RETRY`;
        if (p && p.connected && parkourCatchUp(p, s.participants)) text += ' · CATCH-UP: EVERY PAD SAVES';
      }
      else if (s.goalResetAt && serverNow < s.goalResetAt)
        text += ` · BACK TO YOUR CAGE · ${Math.max(1, Math.ceil((s.goalResetAt - serverNow) / 1000))}`;
      else
        text += ` · CROSS THE SPAN · DIVE INTO THE ${BRIDGE_TEAM_NAME[1 - (p?.team ?? 0)]} PORTAL`;
      if (s.round.game === 'bridge')
        text += localNow < this.bowReadyAt ? ` · BOW ${Math.ceil((this.bowReadyAt - localNow) / 1000)}s` : ' · BOW READY';
    }
    this.clock.textContent = text;
    this.clock.hidden = !text;
  }
}
export function partyResultCopy(winner: string | null, reason: string): { title: string; sub: string } {
  return {
    title: winner ? `${winner} WINS` : 'DRAW',
    sub: reason === 'forfeit' ? 'Opponent left' : reason === 'cancelled' ? 'Arena loading timed out' : 'Unranked',
  };
}
