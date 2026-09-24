import { parkourTheme } from './parkour_themes';
import {
  BRIDGE_GOAL_LIMIT, BRIDGE_TEAM_NAME, partyGame, parkourCatchUp, parkourCourse, parkourLength,
  type PartyLobbySnapshot, type PartyGameId, type PartyParticipant,
} from './partygames';
import { PARKOUR_LAYOUT_TITLE, PARKOUR_MODE_INFO } from './parkour_course';
import { COLLAPSE_GRACE_MS, COLLAPSE_LIVES, VOID_GRACE_MS, parkourCollapseFront, parkourVoidY } from './parkour_mechanics';

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
  /** The big centre-screen count: 3 · 2 · 1 · GO, at the whistle and after
   *  every goal. */
  private count = el('div', 'pg-count');
  /** A full-screen wash in the scoring team's colour. */
  private flash = el('div', 'pg-flash');
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
    this.count.setAttribute('aria-live', 'assertive');
    this.root.append(this.flash, this.progress, this.score, this.clock, this.standings, this.card, this.banner, this.count);
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
      this.lastCount = 0;
      this.countKind = '';
      this.lastScores = '';
      this.count.className = 'pg-count';
      this.count.textContent = '';
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
    const course = !bridge && s.arena ? parkourCourse(s.arena.seed) : null;
    const jumps = course ? parkourLength(course) : 0;
    this.progress.textContent = bridge
      ? `THE BRIDGE · FIRST TO ${BRIDGE_GOAL_LIMIT}`
      : course
        ? `${PARKOUR_MODE_INFO[course.variant.mode].title} · ${PARKOUR_LAYOUT_TITLE[course.variant.layout]} · ${course.variant.deck.title}`
        : 'PARKOUR DUEL';
    this.renderScore(s, bridge);
    const running = s.phase === 'running';
    this.standings.replaceChildren(...this.order(s).map(p => {
      const row = el('div', `pg-row${p.id === me ? ' me' : ''}${p.connected ? '' : ' out'}`);
      const name = el('span', 'pg-row-name', p.username + (p.connected ? '' : ' · left'));
      if (bridge)
        name.style.borderLeft = `3px solid ${TEAM_CSS[p.team]}`, name.style.paddingLeft = '7px';
      row.append(name, el('span', 'pg-row-points', bridge
        ? `${p.score} goal${p.score === 1 ? '' : 's'} · ${p.kills}/${p.deaths} K/D`
        : `${p.score}/${jumps} · ${parkourStanding(p, course?.variant.mode)}`));
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
          : `${me2?.score ?? 0} / ${jumps} platforms · ${course ? `${PARKOUR_MODE_INFO[course.variant.mode].title} on ${PARKOUR_LAYOUT_TITLE[course.variant.layout]}` : ''} · Next match is a different course.`;
        const board = el('div', 'pg-result-board');
        this.order(s).forEach((p, i) => {
          const row = el('div', `pg-card-row${p.id === me ? ' me' : ''}`);
          const place = el('span', 'pg-card-place', String(i + 1));
          const name = el('span', 'pg-card-name', p.username);
          if (bridge) name.style.color = TEAM_CSS[p.team];
          row.append(place, name, el('span', 'pg-card-points', bridge
            ? `${p.score} goal${p.score === 1 ? '' : 's'} · ${p.kills}/${p.deaths}`
            : `${p.score}/${jumps} · ${parkourStanding(p, course?.variant.mode)}`));
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
        // A win rains voxel confetti in the accent colour and its neighbours.
        if (outcome === 'win') {
          const confetti = el('div', 'pg-confetti');
          confetti.setAttribute('aria-hidden', 'true');
          for (let i = 0; i < 22; i++) {
            const bit = el('i', '');
            bit.style.cssText = `--x:${(i * 41) % 100}%;--d:${(i % 6) * 0.11}s;--r:${(i % 2 ? 1 : -1) * (180 + (i % 5) * 70)}deg;--h:${(i * 47) % 360}`;
            confetti.append(bit);
          }
          this.card.append(confetti);
        }
      }
    }
  }
  private order(s: PartyLobbySnapshot): PartyParticipant[] {
    return [...s.participants].sort((a, b) =>
      s.mode === 'bridge' ? a.team - b.team || b.score - a.score || a.joinOrder - b.joinOrder
        : (a.finishedAt ?? Infinity) - (b.finishedAt ?? Infinity) ||
          (b.outAt ?? Infinity) - (a.outAt ?? Infinity) ||
          b.score - a.score || a.falls - b.falls || a.joinOrder - b.joinOrder);
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
    const seed = this.snapshot?.arena?.seed;
    const parkour = game === 'parkour' && seed !== undefined;
    if (parkour) {
      // Mode first — it is what changes how you have to play — then the
      // shape of the course, the kind of jumps in it, and where you are.
      const { variant } = parkourCourse(seed), theme = parkourTheme(seed);
      const info = PARKOUR_MODE_INFO[variant.mode];
      this.banner.replaceChildren(
        el('div', 'pg-banner-title', info.title),
        el('div', 'pg-banner-rule', `${PARKOUR_LAYOUT_TITLE[variant.layout]} · ${variant.deck.title} JUMPS · ${theme.title}`),
        el('div', 'pg-banner-rule', info.rule));
    } else {
      this.banner.replaceChildren(
        el('div', 'pg-banner-title', d.title),
        el('div', 'pg-banner-rule', d.rule));
    }
    (this.banner.firstElementChild as HTMLElement).style.color = '';
    this.banner.hidden = false;
    this.bannerUntil = now + 6500;
  }
  hideCard(): void { this.card.hidden = true; }
  hideCall(): void { this.clock.hidden = true; }
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
    if (localNow >= this.bannerUntil)
      this.banner.hidden = true;
    this.clock.hidden = false;
    let text = '';
    if (s.phase === 'countdown')
      text = s.countdownEndsAt === undefined ? 'LOADING FOR EVERYONE…'
        : s.mode === 'bridge' ? 'IN THE CAGE · THE HATCH DROPS ON GO' : 'GET READY';
    else if (s.phase === 'running' && s.round) {
      const secs = Math.max(0, Math.ceil((s.round.endsAt - serverNow) / 1000));
      text = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
      const p = s.participants.find(v => v.id === this.me);
      if (s.round.game === 'parkour' && s.arena) {
        const course = parkourCourse(s.arena.seed), mode = course.variant.mode, t = serverNow - s.round.startedAt;
        text += ` · NEXT ${(p?.progress ?? 0) + 1}/${parkourLength(course)}`;
        if (p?.outAt !== undefined) text += ' · OUT — WATCH THEM FINISH';
        else if (mode === 'collapse') {
          const gap = (p?.progress ?? 0) - parkourCollapseFront(t);
          text += ` · ${'♥'.repeat(Math.max(0, p?.lives ?? 0))}${'♡'.repeat(Math.max(0, COLLAPSE_LIVES - (p?.lives ?? 0)))}`;
          text += t < COLLAPSE_GRACE_MS ? ` · COLLAPSE IN ${Math.ceil((COLLAPSE_GRACE_MS - t) / 1000)}` : ` · COLLAPSE ${Math.max(0, Math.floor(gap))} PADS BEHIND`;
        } else {
          text += ` · CHECKPOINT ${p?.checkpoint ?? 0} · ${p?.falls ?? 0} FALLS · R TO RETRY`;
          if (mode === 'void') {
            const here = course.steps[p?.progress ?? 0]?.[0];
            const below = here ? here.y - parkourVoidY(course, t) : 0;
            text += t < VOID_GRACE_MS ? ` · VOID RISES IN ${Math.ceil((VOID_GRACE_MS - t) / 1000)}` : ` · VOID ${Math.max(0, Math.floor(below))} BELOW`;
          }
        }
        if (p && p.connected && p.outAt === undefined && mode !== 'collapse' && parkourCatchUp(p, s.participants))
          text += ' · CATCH-UP: EVERY PAD SAVES';
      }
      else if (s.goalResetAt && serverNow < s.goalResetAt)
        text += ' · BACK IN YOUR CAGE · THE HATCH DROPS ON GO';
      else
        text += ` · CROSS THE SPAN · DIVE INTO THE ${BRIDGE_TEAM_NAME[1 - (p?.team ?? 0)]} PORTAL`;
      if (s.round.game === 'bridge')
        text += localNow < this.bowReadyAt ? ` · BOW ${Math.ceil((this.bowReadyAt - localNow) / 1000)}s` : ' · BOW READY';
    }
    this.clock.textContent = text;
    this.clock.hidden = !text;
  }
}
/** A racer's standing line: falls in a race, lives left in a Collapse
 *  Chase, and whether they are still in it at all. */
function parkourStanding(p: PartyParticipant, mode?: string): string {
  if (p.finishedAt !== undefined) return 'finished';
  if (p.outAt !== undefined) return 'out';
  if (mode === 'collapse') return `${p.lives} ${p.lives === 1 ? 'life' : 'lives'}`;
  return `${p.falls} falls`;
}
export function partyResultCopy(winner: string | null, reason: string): { title: string; sub: string } {
  return {
    title: winner ? `${winner} WINS` : 'DRAW',
    sub: reason === 'forfeit' ? 'Opponent left' : reason === 'cancelled' ? 'Arena loading timed out' : 'Unranked',
  };
}
