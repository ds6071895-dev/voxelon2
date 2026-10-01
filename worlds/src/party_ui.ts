import { isTouchDevice } from './touch';
import {
  BRIDGE_GOAL_LIMIT, BRIDGE_TEAM_NAME, partyGame, parkourCourse, parkourLength,
  type ParkourHurt, type ParkourRunnerResult, type PartyLobbySnapshot, type PartyGameId, type PartyParticipant,
} from './partygames';
import { parkourSectionAt } from './parkour_course';
import { DRAGON_GRACE_MS, DRAGON_LIVES } from './parkour_mechanics';

function el(tag: string, cls: string, text = ''): HTMLElement {
  const n = document.createElement(tag);
  n.className = cls;
  n.textContent = text;
  return n;
}
/** Crimson and cobalt, matching the wool each side builds with. */
const TEAM_CSS = ['#ff5f76', '#5aa8ff'];
const ORDINAL = ['1st', '2nd', '3rd', '4th', '5th', '6th'];
const ordinal = (n: number): string => ORDINAL[n - 1] ?? `${n}th`;
const hearts = (n: number): string => '♥'.repeat(Math.max(0, n)) + '♡'.repeat(Math.max(0, DRAGON_LIVES - n));
const clockOf = (ms: number): string => {
  const secs = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
};
const HURT_LINE: Record<ParkourHurt, string> = {
  fall: 'YOU FELL', dragon: 'THE DRAGON GOT YOU', fire: 'BURNED', left: 'LEFT THE RUN',
};

export class PartyUI {
  private root = el('div', 'pg-hud');
  private progress = el('div', 'pg-progress');
  private score = el('div', 'pg-score');
  private clock = el('div', 'pg-call');
  private standings = el('div', 'pg-standings');
  private card = el('div', 'pg-card');
  private banner = el('div', 'pg-banner');
  /** The big centre-screen count: 3 · 2 · 1 · GO, at the whistle and after
   *  every goal. */
  private count = el('div', 'pg-count');
  /** A full-screen wash in the scoring team's colour. */
  private flash = el('div', 'pg-flash');
  /** Dragon Chase: the course as a bar, every runner and the dragon on it. */
  private track = el('div', 'pg-track');
  /** Dragon Chase: made it / out of lives, with the way back to the lobby. */
  private done = el('div', 'pg-done');
  private lastCount = 0;
  private countKind: 'start' | 'reset' | '' = '';
  private lastScores = '';
  /** A number of the countdown just appeared (3, 2, 1). */
  onCountTick?: (n: number, kind: 'start' | 'reset') => void;
  /** The hatch dropped: the round (or the restart after a goal) is live. */
  onGo?: (kind: 'start' | 'reset') => void;
  /** A goal went in. `mine` = my team scored. */
  onGoal?: (mine: boolean, team: number, matchPoint: boolean) => void;
  private snapshot: PartyLobbySnapshot | null = null;
  private me = 0;
  private readonly touch = isTouchDevice();
  private lastPhase = '';
  private lastRound = '';
  private lastGoal = 0;
  private bannerUntil = 0;
  onReplay?: () => void;
  onLeave?: () => void;
  /** Dragon Chase: "Keep watching" on the made-it / out card. */
  onWatch?: () => void;
  /** Dragon Chase: you lost a life (`out` = it was your last). */
  onLifeLost?: (cause: ParkourHurt, out: boolean) => void;
  /** Dragon Chase: you reached the end. */
  onMadeIt?: (place: number) => void;
  /** Dragon Chase: the course order the dragon is drawn at (set per frame). */
  dragonFront = -4;
  private lastLife = 0;
  private doneShown = '';
  /** Label for the replay button; '' means somebody else (a party leader)
   *  decides, so the button waits for them instead. */
  replayLabel = 'Play again';
  /** Local (performance.now) time the Bridge bow can fire again. */
  bowReadyAt = 0;
  private lastKill = 0;
  constructor(host: HTMLElement) {
    this.count.setAttribute('aria-live', 'assertive');
    this.root.append(this.flash, this.progress, this.score, this.clock, this.track, this.standings, this.card, this.banner, this.count, this.done);
    host.append(this.root);
    this.done.hidden = true;
    this.track.hidden = true;
    this.setVisible(false);
  }
  setVisible(v: boolean): void {
    this.root.hidden = !v;
    if (!v) {
      this.lastPhase = '';
      this.lastRound = '';
      this.lastGoal = 0;
      this.lastKill = 0;
      this.lastCount = 0;
      this.countKind = '';
      this.lastScores = '';
      this.count.className = 'pg-count';
      this.count.textContent = '';
      this.lastLife = 0;
      this.doneShown = '';
      this.done.hidden = true;
      this.track.hidden = true;
    }
  }
  /** Put the made-it / out card away (Keep watching). */
  hideDone(): void { this.done.hidden = true; }
  private myTeam(): number {
    return this.snapshot?.participants.find(p => p.id === this.me)?.team ?? 0;
  }
  setSnapshot(s: PartyLobbySnapshot | null, me: number): void {
    this.snapshot = s;
    this.me = me;
    if (!s)
      return;
    const bridge = s.mode === 'bridge';
    const course = !bridge && s.arena ? parkourCourse(s.arena.seed) : null;
    const jumps = course ? parkourLength(course) : 0;
    const mine = s.participants.find(p => p.id === me);
    const section = course ? parkourSectionAt(course, Math.max(1, (mine?.progress ?? 0) + 1)) : null;
    this.progress.textContent = bridge
      ? `THE BRIDGE · FIRST TO ${BRIDGE_GOAL_LIMIT}`
      : `DRAGON CHASE${section && !this.touch ? ` · ${section.title}` : ''}`;
    this.root.dataset.mode = s.mode;
    if (this.touch && bridge) this.progress.textContent = 'THE BRIDGE';
    this.renderScore(s, bridge);
    const running = s.phase === 'running';
    this.standings.replaceChildren(...this.order(s).map(p => {
      // A runner who made it and went back to the menu is still "made it":
      // nobody else is told they left.
      const gone = !p.connected && (bridge || p.finishedAt === undefined);
      const fell = !bridge && p.outAt !== undefined && p.finishedAt === undefined;
      const row = el('div', `pg-row${p.id === me ? ' me' : ''}${gone || fell ? ' out' : ''}${!bridge && p.finishedAt !== undefined ? ' made' : ''}`);
      const name = el('span', 'pg-row-name', p.username + (gone ? ' · left' : ''));
      if (bridge)
        name.style.borderLeft = `3px solid ${TEAM_CSS[p.team]}`, name.style.paddingLeft = '7px';
      row.append(name, el('span', 'pg-row-points', bridge
        ? `${p.score} goal${p.score === 1 ? '' : 's'} · ${p.kills}/${p.deaths} K/D`
        : parkourStanding(p, jumps)));
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
      const ours = s.lastGoal.team === this.myTeam();
      const matchPoint = s.teamScores[s.lastGoal.team] === BRIDGE_GOAL_LIMIT - 1;
      const title = el('div', 'pg-banner-title pg-goal-title', mine ? 'GOAL!' : ours ? 'TEAM GOAL!' : `${s.lastGoal.username} SCORED`);
      title.style.color = TEAM_CSS[s.lastGoal.team];
      const line = el('div', 'pg-goal-line');
      line.append(
        el('b', '', String(s.teamScores[0])),
        el('span', '', '—'),
        el('b', '', String(s.teamScores[1])));
      (line.children[0] as HTMLElement).style.color = TEAM_CSS[0];
      (line.children[2] as HTMLElement).style.color = TEAM_CSS[1];
      const parts: HTMLElement[] = [title, line];
      if (matchPoint && s.teamScores[s.lastGoal.team] < BRIDGE_GOAL_LIMIT)
        parts.push(el('div', 'pg-banner-rule pg-match-point', `MATCH POINT · ${BRIDGE_TEAM_NAME[s.lastGoal.team]}`));
      this.banner.replaceChildren(...parts);
      this.banner.className = 'pg-banner pg-banner-goal';
      this.banner.hidden = false;
      this.bannerUntil = performance.now() + 2600;
      this.flash.style.setProperty('--flash', TEAM_CSS[s.lastGoal.team]);
      this.flash.classList.remove('go');
      void this.flash.offsetWidth;
      this.flash.classList.add('go');
      this.onGoal?.(ours, s.lastGoal.team, matchPoint);
    }
    // A kill is its own beat — and on a one-block span it is usually the beat
    // that decided the goal that follows it.
    if (running && s.lastKill && s.lastKill.at !== this.lastKill) {
      this.lastKill = s.lastKill.at;
      const mine = s.lastKill.id === me;
      const how = s.lastKill.cause === 'void' ? 'knocked into the void'
        : s.lastKill.cause === 'bow' ? 'shot' : 'cut down';
      this.banner.className = 'pg-banner';
      this.banner.replaceChildren(
        el('div', 'pg-banner-title', mine ? 'KILL' : 'DOWN'),
        el('div', 'pg-banner-rule', `${s.lastKill.username} ${how} ${s.lastKill.victim}`));
      (this.banner.firstElementChild as HTMLElement).style.color = TEAM_CSS[s.lastKill.team];
      this.banner.hidden = false;
      this.bannerUntil = performance.now() + 1800;
    }
    if (!bridge && mine && s.phase === 'running') this.watchMyRun(s, mine, course);
    if (s.phase !== this.lastPhase) {
      this.lastPhase = s.phase;
      this.card.hidden = s.phase !== 'results';
      if (s.phase === 'results') this.done.hidden = true;
      if (s.phase === 'results' && s.result && !bridge && s.result.runners) {
        this.renderParkourResult(s, s.result.runners, jumps);
      } else if (s.phase === 'results' && s.result) {
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
          : `${me2?.score ?? 0} / ${jumps} platforms.`;
        const board = el('div', 'pg-result-board');
        this.order(s).forEach((p, i) => {
          const row = el('div', `pg-card-row${p.id === me ? ' me' : ''}`);
          const place = el('span', 'pg-card-place', String(i + 1));
          const name = el('span', 'pg-card-name', p.username);
          if (bridge) name.style.color = TEAM_CSS[p.team];
          row.append(place, name, el('span', 'pg-card-points', bridge
            ? `${p.score} goal${p.score === 1 ? '' : 's'} · ${p.kills}/${p.deaths}`
            : parkourStanding(p, jumps)));
          board.append(row);
        });
        const forfeit = s.result.finishReason === 'forfeit' ? 'The other side left the match. ' : '';
        this.card.replaceChildren(kicker, heading, el('p', 'pg-result-note', forfeit + note), board);
        this.card.append(this.resultActions());
        if (outcome === 'win') this.card.append(this.confetti());
      }
    }
  }
  /** Replay and Menu, under any result. */
  private resultActions(): HTMLElement {
    const actions = el('div', 'pg-result-actions');
    const buttons: HTMLButtonElement[] = [];
    for (const [label, cls, action] of [
      [this.replayLabel || 'Waiting for the leader', 'pg-result-btn primary', () => this.onReplay?.()],
      ['Menu', 'pg-result-btn', () => this.onLeave?.()],
    ] as const) {
      const b = el('button', cls, label) as HTMLButtonElement;
      b.type = 'button';
      b.addEventListener('click', () => { for (const x of buttons) x.disabled = true; action(); });
      buttons.push(b);
      actions.append(b);
    }
    if (!this.replayLabel) buttons[0].disabled = true;
    return actions;
  }
  /** A win rains voxel confetti in the accent colour and its neighbours. */
  private confetti(): HTMLElement {
    const confetti = el('div', 'pg-confetti');
    confetti.setAttribute('aria-hidden', 'true');
    for (let i = 0; i < 22; i++) {
      const bit = el('i', '');
      bit.style.cssText = `--x:${(i * 41) % 100}%;--d:${(i % 6) * 0.11}s;--r:${(i % 2 ? 1 : -1) * (180 + (i % 5) * 70)}deg;--h:${(i * 47) % 360}`;
      confetti.append(bit);
    }
    return confetti;
  }

  /** The Dragon Chase result: who made it, and who fell in what order. */
  private renderParkourResult(s: PartyLobbySnapshot, runners: ParkourRunnerResult[], jumps: number): void {
    const cancelled = s.result!.finishReason === 'cancelled';
    const made = runners.filter(r => r.made), fell = runners.filter(r => !r.made);
    const mine = runners.find(r => r.id === this.me);
    const everyone = made.length === runners.length;
    const outcome = cancelled ? 'draw' : mine?.made ? 'win' : 'lose';
    const title = cancelled ? 'COULD NOT LOAD THE COURSE'
      : everyone ? (runners.length > 1 ? 'EVERYONE MADE IT!' : 'YOU MADE IT!')
        : !made.length ? 'THE DRAGON WINS'
          : mine?.made ? 'YOU MADE IT!' : 'THE DRAGON GOT YOU';
    this.card.className = `pg-card pg-result pk-result ${outcome}`;
    this.card.style.setProperty('--pg-accent', outcome === 'win' ? '#ffd25e' : outcome === 'lose' ? '#ff6d80' : '#9fb4cc');
    const kicker = el('div', 'pg-result-kicker', cancelled ? 'Match cancelled' : mine?.made ? `Made it · ${ordinal(mine.place ?? 1)}` : 'Out of lives');
    const note = mine?.made
      ? `${clockOf(mine.timeMs ?? 0)} · ${hearts(mine.livesLeft)} left · ${made.length} of ${runners.length} made it.`
      : `${mine?.reached ?? 0} / ${jumps} platforms · ${made.length} of ${runners.length} made it.`;
    const parts: HTMLElement[] = [kicker, el('div', 'pg-card-title', title), el('p', 'pg-result-note', note)];
    const board = el('div', 'pg-result-board');
    if (made.length) {
      board.append(el('div', 'pk-board-head', 'MADE IT'));
      for (const r of made) {
        const row = el('div', `pg-card-row${r.id === this.me ? ' me' : ''}`);
        row.append(el('span', 'pg-card-place pk-medal', String(r.place ?? '')), el('span', 'pg-card-name', r.username),
          el('span', 'pg-card-points', `${clockOf(r.timeMs ?? 0)} · ${hearts(r.livesLeft)}`));
        board.append(row);
      }
    }
    if (fell.length) {
      board.append(el('div', 'pk-board-head fell', 'FELL'));
      for (const r of fell) {
        const row = el('div', `pg-card-row pk-fell${r.id === this.me ? ' me' : ''}`);
        row.append(el('span', 'pg-card-place', '✕'), el('span', 'pg-card-name', r.username),
          el('span', 'pg-card-points', `${r.left ? 'left' : `died ${ordinal(r.fellOrder ?? 1)}`} · ${r.reached}/${jumps}`));
        board.append(row);
      }
    }
    parts.push(board);
    this.card.replaceChildren(...parts, this.resultActions());
    if (outcome === 'win') this.card.append(this.confetti());
  }

  /** Your own run: a life lost, a new set piece, the finish. */
  private watchMyRun(s: PartyLobbySnapshot, me: PartyParticipant, course: ReturnType<typeof parkourCourse> | null): void {
    if (me.lastLife && me.lastLife.at !== this.lastLife) {
      this.lastLife = me.lastLife.at;
      const out = me.outAt !== undefined;
      if (me.lastLife.cause !== 'left') {
        this.banner.className = 'pg-banner pk-hurt';
        this.banner.replaceChildren(
          el('div', 'pg-banner-title', out ? 'OUT OF LIVES' : HURT_LINE[me.lastLife.cause]),
          el('div', 'pg-banner-rule pk-hearts', out ? 'Watch the others finish' : `${hearts(me.lives)} · back ahead of the dragon`));
        (this.banner.firstElementChild as HTMLElement).style.color = '#ff6d80';
        this.banner.hidden = false;
        this.bannerUntil = performance.now() + 2200;
        this.onLifeLost?.(me.lastLife.cause, out);
      }
    }
    const state = me.finishedAt !== undefined ? `made:${me.place}` : me.outAt !== undefined ? 'out' : '';
    if (state && state !== this.doneShown) {
      this.doneShown = state;
      const made = me.finishedAt !== undefined;
      if (made) this.onMadeIt?.(me.place ?? 1);
      this.done.className = `pg-done ${made ? 'made' : 'out'}`;
      const b = (label: string, cls: string, action: () => void): HTMLButtonElement => {
        const btn = el('button', cls, label) as HTMLButtonElement;
        btn.type = 'button';
        btn.addEventListener('click', action);
        return btn;
      };
      const time = made && s.round ? clockOf(me.finishedAt! - s.round.startedAt) : '';
      const actions = el('div', 'pg-done-actions');
      actions.append(
        b('Back to lobby', 'pg-result-btn primary', () => this.onLeave?.()),
        b(made ? 'Stay on the podium' : 'Keep watching', 'pg-result-btn', () => { this.done.hidden = true; this.onWatch?.(); }));
      this.done.replaceChildren(
        el('div', 'pg-result-kicker', made ? `Made it · ${ordinal(me.place ?? 1)}` : 'Out of lives'),
        el('div', 'pg-done-title', made ? 'YOU MADE IT!' : 'THE DRAGON GOT YOU'),
        el('p', 'pg-done-note', made
          ? `${time} · ${hearts(me.lives)} left. You can head back now — the others still see you on the podium.`
          : `You reached ${me.score} of ${course ? parkourLength(course) : 0}. Stay and watch the others, or head back.`),
        actions);
      this.done.hidden = false;
    }
  }
  private order(s: PartyLobbySnapshot): PartyParticipant[] {
    return [...s.participants].sort((a, b) =>
      s.mode === 'bridge' ? a.team - b.team || b.score - a.score || a.joinOrder - b.joinOrder
        : (a.finishedAt ?? Infinity) - (b.finishedAt ?? Infinity) ||
          (b.outAt ?? Infinity) - (a.outAt ?? Infinity) ||
          b.progress - a.progress || b.lives - a.lives || a.joinOrder - b.joinOrder);
  }
  /** The Bridge scoreboard: each team's name over a row of goal pips, the
   *  big scoreline between them, and a MATCH POINT tag on whoever is one away.
   *  A changed score bumps the side that scored. */
  private renderScore(s: PartyLobbySnapshot, bridge: boolean): void {
    this.score.hidden = !bridge;
    if (!bridge)
      return;
    const mine = this.myTeam();
    const key = `${s.teamScores[0]}:${s.teamScores[1]}`;
    const changed = this.lastScores !== '' && this.lastScores !== key;
    const prev = this.lastScores.split(':').map(Number);
    this.lastScores = key;
    const side = (team: number): HTMLElement => {
      const goals = s.teamScores[team];
      const pill = el('div', `pg-team${team === mine ? ' me' : ''}${team ? ' right' : ''}`);
      pill.style.setProperty('--team', TEAM_CSS[team]);
      const head = el('div', 'pg-team-head');
      head.append(el('span', 'pg-team-name', BRIDGE_TEAM_NAME[team]));
      if (team === mine) head.append(el('span', 'pg-team-you', 'YOU'));
      const pips = el('div', 'pg-pips');
      for (let i = 0; i < BRIDGE_GOAL_LIMIT; i++) {
        const pip = el('i', i < goals ? 'on' : '');
        if (changed && i === goals - 1 && goals > (prev[team] ?? 0)) pip.classList.add('new');
        pips.append(pip);
      }
      pill.append(head, pips);
      if (goals === BRIDGE_GOAL_LIMIT - 1 && s.phase === 'running')
        pill.append(el('span', 'pg-team-mp', 'MATCH POINT'));
      return pill;
    };
    const line = el('div', 'pg-scoreline');
    const a = el('b', '', String(s.teamScores[0])), b = el('b', '', String(s.teamScores[1]));
    a.style.color = TEAM_CSS[0];
    b.style.color = TEAM_CSS[1];
    if (changed) {
      if (s.teamScores[0] > (prev[0] ?? 0)) a.classList.add('bump');
      if (s.teamScores[1] > (prev[1] ?? 0)) b.classList.add('bump');
    }
    line.append(a, el('span', 'pg-scoreline-dash', '—'), b);
    const mid = el('div', 'pg-score-mid');
    mid.append(line, el('span', 'pg-team-split', `FIRST TO ${BRIDGE_GOAL_LIMIT}`));
    this.score.replaceChildren(side(0), mid, side(1));
  }
  showRound(game: PartyGameId, now: number): void {
    this.banner.className = 'pg-banner';
    const d = partyGame(game);
    this.banner.replaceChildren(
      el('div', 'pg-banner-title', d.title),
      el('div', 'pg-banner-rule', d.rule));
    (this.banner.firstElementChild as HTMLElement).style.color = '';
    this.banner.hidden = false;
    this.bannerUntil = now + 6500;
  }
  /** The big centre count. Driven off the server clock, so both players see
   *  the same number at the same moment, and the GO lands on the hatch drop. */
  private updateCount(s: PartyLobbySnapshot, serverNow: number): void {
    let n = 0, kind: 'start' | 'reset' | '' = '';
    if (s.phase === 'countdown' && s.countdownEndsAt !== undefined) {
      n = Math.max(1, Math.ceil((s.countdownEndsAt - serverNow) / 1000));
      kind = 'start';
    } else if (s.phase === 'running' && s.mode === 'bridge' && s.goalResetAt && serverNow < s.goalResetAt) {
      n = Math.max(1, Math.ceil((s.goalResetAt - serverNow) / 1000));
      kind = 'reset';
    }
    if (n > 0 && n !== this.lastCount) {
      this.lastCount = n;
      this.countKind = kind;
      this.count.textContent = String(n);
      this.count.className = 'pg-count';
      void this.count.offsetWidth;
      this.count.className = `pg-count show n${n}`;
      this.onCountTick?.(n, kind as 'start' | 'reset');
    } else if (n === 0 && this.lastCount > 0) {
      const was = this.countKind || 'start';
      this.lastCount = 0;
      this.countKind = '';
      if (s.phase === 'running') {
        this.count.textContent = s.mode === 'bridge' ? (was === 'reset' ? 'DROP!' : 'FIGHT!') : 'GO!';
        this.count.className = 'pg-count';
        void this.count.offsetWidth;
        this.count.className = 'pg-count show go';
        this.onGo?.(was);
      } else {
        this.count.className = 'pg-count';
      }
    }
  }
  update(localNow: number, serverNow: number): void {
    const s = this.snapshot;
    if (!s)
      return;
    this.updateCount(s, serverNow);
    const mine = s.participants.find(v => v.id === this.me);
    if (s.phase === 'running' && s.mode !== 'bridge' && mine?.respawnAt !== undefined && mine.respawnAt > serverNow) {
      // Dead: the countdown owns the banner until you are back. Bridge has its
      // own death title (#bridge-fx) that already carries the countdown.
      this.banner.className = 'pg-banner';
      this.banner.replaceChildren(
        el('div', 'pg-banner-title', `RESPAWN ${Math.ceil((mine.respawnAt - serverNow) / 1000)}`),
        el('div', 'pg-banner-rule', 'Fly around while you wait'));
      (this.banner.firstElementChild as HTMLElement).style.color = '';
      this.banner.hidden = false;
      this.bannerUntil = localNow + 300;
    } else if (localNow >= this.bannerUntil)
      this.banner.hidden = true;
    this.clock.hidden = false;
    let text = '';
    if (s.phase === 'countdown')
      text = s.countdownEndsAt === undefined ? 'LOADING FOR EVERYONE…'
        : s.mode === 'bridge' ? 'IN THE CAGE · THE HATCH DROPS ON GO' : 'GET READY';
    else if (s.phase === 'running' && s.round && s.round.game === 'parkour' && s.arena) {
      const p = s.participants.find(v => v.id === this.me);
      const course = parkourCourse(s.arena.seed), len = parkourLength(course), t = serverNow - s.round.startedAt;
      text = clockOf(t);
      let danger = false;
      if (p?.finishedAt !== undefined) text += ` · MADE IT · ${ordinal(p.place ?? 1)}`;
      else if (p?.outAt !== undefined) text += ' · OUT OF LIVES — WATCH THE OTHERS';
      else {
        text += ` · ${hearts(p?.lives ?? 0)}`;
        if (t < DRAGON_GRACE_MS) text += ` · THE DRAGON WAKES IN ${Math.ceil((DRAGON_GRACE_MS - t) / 1000)}`;
        else {
          const gap = Math.max(0, Math.floor((p?.progress ?? 0) - this.dragonFront));
          danger = gap <= 3;
          text += ` · DRAGON ${gap} PAD${gap === 1 ? '' : 'S'} BEHIND`;
        }
        if (!this.touch) text += ` · ${(p?.progress ?? 0)}/${len}`;
      }
      this.clock.classList.toggle('pk-danger', danger);
      this.renderTrack(s, len);
    }
    else if (s.phase === 'running' && s.round) {
      const secs = Math.max(0, Math.ceil((s.round.endsAt - serverNow) / 1000));
      text = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
      const p = s.participants.find(v => v.id === this.me);
      if (s.goalResetAt && serverNow < s.goalResetAt)
        text += ' · BACK IN YOUR CAGE · THE HATCH DROPS ON GO';
      else if (!this.touch)
        text += ` · CROSS THE SPAN · DIVE INTO THE ${BRIDGE_TEAM_NAME[1 - (p?.team ?? 0)]} PORTAL`;
      if (s.round.game === 'bridge')
        text += localNow < this.bowReadyAt ? ` · BOW ${Math.ceil((this.bowReadyAt - localNow) / 1000)}s` : ' · BOW READY';
    }
    this.clock.textContent = text;
    this.clock.hidden = !text;
    if (s.mode === 'bridge' || s.phase !== 'running') this.track.hidden = true;
  }
  /** The course as one bar: every runner a pip, the dragon a flame. */
  private renderTrack(s: PartyLobbySnapshot, len: number): void {
    this.track.hidden = false;
    const pips: HTMLElement[] = [];
    const at = (v: number): string => `${Math.max(0, Math.min(100, v / Math.max(1, len) * 100)).toFixed(1)}%`;
    for (const p of s.participants) {
      if (!p.connected && p.finishedAt === undefined) continue;
      const pip = el('i', `pk-pip${p.id === this.me ? ' me' : ''}${p.outAt !== undefined && p.finishedAt === undefined ? ' out' : ''}`);
      pip.style.left = at(p.finishedAt !== undefined ? len : p.progress);
      pip.title = p.username;
      pips.push(pip);
    }
    const dragon = el('b', 'pk-dragon');
    dragon.style.left = at(Math.max(0, this.dragonFront));
    dragon.title = 'The dragon';
    const burn = el('span', 'pk-burn');
    burn.style.width = at(Math.max(0, this.dragonFront));
    this.track.replaceChildren(burn, ...pips, dragon, el('span', 'pk-flag'));
  }
}
/** A runner's standing line: made it, fell, or lives left and how far. */
function parkourStanding(p: PartyParticipant, jumps: number): string {
  if (p.finishedAt !== undefined) return `MADE IT · ${ordinal(p.place ?? 1)}`;
  if (p.outAt !== undefined) return `FELL · ${p.score}/${jumps}`;
  return `${hearts(p.lives)} · ${p.progress}/${jumps}`;
}
