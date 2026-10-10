import { Color } from 'three';
import { iconSvg } from '../emoji_icons';
import { DUEL_ROUND_MS, DUEL_SCORE_LIMIT, duelEventCopy,
  type DuelEvent, type DuelEventKind, type DuelLobbySnapshot, type DuelParticipant, type DuelResult } from '../duels';
import type { GameAudio } from '../audio';
import { formatMatchTime } from '../ui/presentation';

interface Clock {
  now(): number;
  later(callback: () => void, ms: number): number;
  cancel(id: number): void;
  frame(callback: () => void): number;
  cancelFrame(id: number): void;
}
interface Identity { id: number; party: boolean; follower: boolean }
const EVENT_COLORS: Record<DuelEventKind, string> = {
  first_blood: '#ff6d80', double_kill: '#7fd3f5', triple_kill: '#5ad0ff', quad_kill: '#a273f7',
  spree: '#ffd45e', rampage: '#ff9a3c', unstoppable: '#ff5f76', godlike: '#ff4f6e',
  shutdown: '#55e8a6', revenge: '#c08cff', match_point: '#ffe6a4',
};
const browserClock: Clock = {
  now: () => performance.now(), later: (fn, ms) => window.setTimeout(fn, ms),
  cancel: id => window.clearTimeout(id), frame: fn => requestAnimationFrame(fn), cancelFrame: id => cancelAnimationFrame(id),
};
function node<K extends keyof HTMLElementTagNameMap>(tag: K, cls = ''): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag); el.className = cls; return el;
}

/** Duels DOM, clock interpolation, cue deduplication and presentation timers. */
export class DuelsPresenter {
  private snapshot: DuelLobbySnapshot | null = null;
  private resultData: DuelResult | null = null;
  private enabled = false;
  private clockServer = 0;
  private clockLocal: number;
  private countdownEndsAt = 0;
  private lastCountdown = -1;
  private leaderKey = '';
  private finalThirty = false;
  private sudden = false;
  private fight = false;
  private fightUntil = 0;
  private scoresHeld = false;
  private feedSeen = 0;
  private announceUntil = 0;
  private cueText = '';
  private pillKey = '';
  private pills = new Map<number, { root: HTMLElement; score: HTMLElement }>();
  private lastKills = new Map<number, number>();
  private timers = new Set<number>();
  private focusFrame = 0;
  private readonly hud = node('div', 'duel-match-hud');
  private readonly clockEl = node('div', 'duel-clock');
  private readonly clockLabel = node('small');
  private readonly time = node('strong');
  private readonly barFill = node('i');
  private readonly pillsEl = node('div', 'duel-score-pills');
  private readonly cue = node('div', 'duel-center-cue');
  private readonly announce = node('div', 'duel-announce');
  private readonly announceTitle = node('b');
  private readonly announceSub = node('small');
  private readonly feed = node('div', 'duel-killfeed');
  private readonly scoreboard = node('div', 'duel-scoreboard');
  private readonly scorePanel = node('div', 'duel-score-panel');
  private readonly touchScores = node('button', 'duel-scores-touch');
  private readonly resultEl = node('div', 'duel-result');
  private readonly resultCard = node('div', 'duel-result-card');

  constructor(app: HTMLElement, private readonly audio: Pick<GameAudio, 'duelCue' | 'duelAnnounce'>,
    private readonly comfort: { readonly reducedMotion: boolean }, private readonly identity: () => Identity,
    private readonly actions: { replay(): void; leave(): void }, private readonly clock: Clock = browserClock) {
    this.clockLocal = clock.now();
    this.clockLabel.textContent = 'Round'; this.time.textContent = '5:00';
    const bar = node('div', 'duel-clock-bar'); bar.append(this.barFill);
    this.clockEl.append(this.clockLabel, this.time, bar); this.hud.append(this.clockEl, this.pillsEl);
    this.announce.setAttribute('role', 'status'); this.announce.setAttribute('aria-live', 'polite');
    this.announce.append(this.announceTitle, this.announceSub);
    this.feed.setAttribute('aria-hidden', 'true'); this.scoreboard.append(this.scorePanel);
    this.touchScores.type = 'button'; this.touchScores.textContent = 'Scores';
    this.resultEl.setAttribute('role', 'dialog'); this.resultEl.setAttribute('aria-modal', 'true');
    this.resultEl.setAttribute('aria-label', 'Duels match result');
    for (const [key, color] of [['--rank', '#e3a12a'], ['--rank-accent', '#ffd272'], ['--rank-shade', '#9e6912']]) this.resultEl.style.setProperty(key, color);
    this.resultEl.append(this.resultCard);
    app.append(this.hud, this.cue, this.announce, this.feed, this.scoreboard, this.touchScores, this.resultEl);
    window.addEventListener('keydown', e => {
      if (e.key !== 'Tab' || !this.enabled || this.resultData) return;
      e.preventDefault(); if (!e.repeat) this.showScores(true);
    });
    window.addEventListener('keyup', e => {
      if (e.key === 'Tab' && this.enabled) { e.preventDefault(); this.showScores(false); }
    });
    window.addEventListener('blur', () => this.showScores(false));
    for (const type of ['pointerdown', 'touchstart'] as const) this.touchScores.addEventListener(type, e => { e.preventDefault(); this.showScores(true); });
    for (const type of ['pointerup', 'pointercancel', 'touchend', 'touchcancel'] as const) this.touchScores.addEventListener(type, e => { e.preventDefault(); this.showScores(false); });
    this.reset();
  }

  now(): number { return this.clockServer + this.clock.now() - this.clockLocal; }
  syncClock(serverNow: number): void { this.clockServer = serverNow; this.clockLocal = this.clock.now(); }
  get announced(): boolean { return this.announce.classList.contains('visible'); }
  enter(countdownEndsAt: number): void { this.reset(); this.enabled = true; this.countdownEndsAt = countdownEndsAt; }
  setSnapshot(snapshot: DuelLobbySnapshot): void {
    this.snapshot = snapshot; this.syncClock(snapshot.serverNow);
    if (snapshot.phase !== 'lobby') { this.playFeed(snapshot.feed); if (this.scoresHeld) this.renderScoreboard(); }
  }
  reset(): void {
    for (const id of this.timers) this.clock.cancel(id);
    this.timers.clear();
    if (this.focusFrame) this.clock.cancelFrame(this.focusFrame);
    this.focusFrame = 0;
    this.enabled = false; this.snapshot = null; this.resultData = null;
    this.countdownEndsAt = 0; this.lastCountdown = -1; this.leaderKey = '';
    this.finalThirty = false; this.sudden = false; this.fight = false; this.fightUntil = 0;
    this.feedSeen = 0; this.announceUntil = 0; this.scoresHeld = false;
    this.lastKills.clear(); this.pills.clear(); this.pillKey = ''; this.pillsEl.replaceChildren();
    this.feed.replaceChildren(); this.announce.classList.remove('visible', 'out');
    for (const el of [this.hud, this.touchScores, this.scoreboard, this.resultEl]) el.classList.remove('visible');
    this.cueText = ''; this.cue.textContent = ''; this.cue.style.display = 'none';
  }
  private pushFeed(title: string, sub: string, color: string): void {
    const row = node('div'); row.style.setProperty('--feed', color);
    const tag = node('b'); tag.textContent = title; const text = node('span'); text.textContent = sub;
    row.append(tag, text); this.feed.append(row);
    while (this.feed.childElementCount > 3) this.feed.firstElementChild!.remove();
    const id = this.clock.later(() => { row.remove(); this.timers.delete(id); }, 3_800); this.timers.add(id);
  }
  kill(killer: string, victim: string): void { this.pushFeed(killer || 'ELIMINATED', victim, '#9fb6cc'); }
  private playFeed(feed: DuelEvent[]): void {
    if (!this.enabled) { this.feedSeen = Math.max(this.feedSeen, ...feed.map(e => e.seq), 0); return; }
    const fresh = feed.filter(e => e.seq > this.feedSeen).sort((a, b) => a.seq - b.seq);
    if (!fresh.length) return;
    this.feedSeen = fresh[fresh.length - 1].seq;
    const me = this.identity().id;
    for (const event of fresh) {
      if (event.actor === me || event.victim === me) continue;
      const copy = duelEventCopy(event); this.pushFeed(copy.title, copy.sub, EVENT_COLORS[event.kind]);
    }
    const mine = fresh.filter(e => e.actor === me || e.victim === me);
    if (!mine.length) return;
    const headline = mine[mine.length - 1], copy = duelEventCopy(headline);
    this.announce.style.setProperty('--announce', EVENT_COLORS[headline.kind]);
    this.announceTitle.textContent = copy.title; this.announceSub.textContent = copy.sub;
    this.announce.classList.remove('visible', 'out'); void this.announce.offsetWidth;
    this.announce.classList.add('visible'); this.announceUntil = this.now() + 2_200;
    this.audio.duelAnnounce(headline.kind);
  }
  private scoreRows(players: DuelParticipant[]): HTMLElement {
    const rows = node('div'), head = node('div', 'duel-score-row header');
    for (const label of ['#', 'Player', 'Kills', 'Deaths', 'K/D']) { const cell = node('span'); cell.textContent = label; head.append(cell); }
    const statusHead = node('span', 'duel-score-status'); statusHead.textContent = 'Status'; head.append(statusHead); rows.append(head);
    const topKills = players[0]?.kills ?? 0;
    players.forEach((p, i) => {
      const row = node('div', `duel-score-row${p.id === this.identity().id ? ' local' : ''}`);
      const place = node('span'); place.textContent = String(i + 1); const name = node('strong');
      if (p.kills === topKills && topKills > 0) { const mark = node('span', 'duel-leader-mark'); mark.innerHTML = iconSvg('diamond'); name.append(mark); }
      const who = node('span'); who.textContent = p.username; name.append(who);
      if (p.spree >= 3) { const spree = node('span', 'duel-score-spree'); spree.textContent = `${p.spree}×`; name.append(spree); }
      const kills = node('span', 'duel-score-kills'); kills.textContent = String(p.kills);
      const deaths = node('span'); deaths.textContent = String(p.deaths);
      const kd = node('span'); kd.textContent = p.deaths === 0 ? p.kills.toFixed(1) : (p.kills / p.deaths).toFixed(2);
      const status = node('span', `duel-score-status ${p.alive ? 'duel-status-alive' : 'duel-status-out'}`);
      status.textContent = !p.connected ? 'Left' : p.spectating ? (p.respawnAt ? 'Respawning' : 'Watching') : p.alive ? 'Alive' : 'Respawning';
      row.append(place, name, kills, deaths, kd, status); rows.append(row);
    });
    return rows;
  }
  private renderScoreboard(): void {
    const head = node('div', 'duel-score-head'), title = node('div'), kicker = node('small'), heading = node('h2'), hint = node('small');
    kicker.textContent = this.snapshot?.phase === 'sudden_death' ? 'Sudden death' : 'Prism Colosseum'; heading.textContent = 'Scoreboard'; title.append(kicker, heading);
    hint.textContent = this.resultData ? 'Final' : `First to ${DUEL_SCORE_LIMIT}`; head.append(title, hint);
    this.scorePanel.replaceChildren(head, this.scoreRows(this.resultData?.scoreboard ?? this.snapshot?.participants ?? []));
  }
  private showScores(visible: boolean): void {
    this.scoresHeld = visible; this.scoreboard.classList.toggle('visible', visible && this.enabled && !this.resultData);
    if (visible) this.renderScoreboard();
  }
  result(result: DuelResult): void {
    this.resultData = result; this.announce.classList.remove('visible', 'out'); this.feed.replaceChildren();
    const winner = result.scoreboard.find(p => p.id === result.winner), mine = result.winner === this.identity().id;
    this.audio.duelCue(mine ? 'victory' : 'defeat');
    const kicker = node('div', 'duel-result-kicker'); kicker.textContent = mine ? 'Victory' : result.winner === null ? 'Match complete' : 'Defeat';
    const title = node('h2'); title.textContent = winner ? mine ? 'You win' : `${winner.username} wins` : 'No winner';
    const summary = node('p', 'duel-result-summary');
    const reason: Record<DuelResult['finishReason'], string> = { time: 'full time', score: `score limit — ${DUEL_SCORE_LIMIT} kills`, sudden_death: 'sudden death', forfeit: 'opponent left', cancelled: 'the arena could not load for everyone' };
    summary.textContent = `${formatMatchTime(result.durationMs)} · ${reason[result.finishReason]}`;
    const recap = node('div', 'duel-result-recap'), chips: string[] = [];
    const best = [...result.scoreboard].sort((a, b) => b.bestSpree - a.bestSpree)[0];
    if (best && best.bestSpree >= 3) chips.push(`Best spree · ${best.username} ×${best.bestSpree}`);
    const first = result.feed.find(e => e.kind === 'first_blood'); if (first) chips.push(`First blood · ${first.actorName}`);
    chips.push(`${result.scoreboard.reduce((sum, p) => sum + p.kills, 0)} total kills`);
    for (const text of chips) { const chip = node('span'); chip.textContent = text; recap.append(chip); }
    const scores = node('div', 'duel-result-score'); scores.append(this.scoreRows(result.scoreboard));
    const controls = node('div', 'duel-result-controls'), again = node('button', 'primary'), menu = node('button');
    again.type = menu.type = 'button'; menu.textContent = 'Menu';
    const identity = this.identity();
    again.disabled = identity.follower; again.textContent = identity.follower ? 'Waiting for the leader' : identity.party ? 'Play again with party' : 'Play again';
    again.addEventListener('click', () => { again.disabled = menu.disabled = true; this.actions.replay(); });
    menu.addEventListener('click', () => { again.disabled = menu.disabled = true; this.actions.leave(); });
    controls.append(again, menu); this.resultCard.replaceChildren(kicker, title, summary, recap, scores, controls);
    this.resultEl.classList.add('visible'); this.scoreboard.classList.remove('visible');
    if (this.focusFrame) this.clock.cancelFrame(this.focusFrame);
    this.focusFrame = this.clock.frame(() => { this.focusFrame = 0; if (this.resultData === result) controls.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus(); });
  }
  private renderPills(board: DuelParticipant[]): void {
    const key = board.map(p => p.id).join(',');
    if (key !== this.pillKey) {
      this.pillKey = key; this.pills.clear(); this.pillsEl.replaceChildren();
      for (const p of board) {
        const pill = node('div', 'duel-pill'), swatch = node('i'), name = node('span'), score = node('b');
        swatch.style.background = `#${new Color().setHSL((p.skin % 360) / 360, .55, .55).getHexString()}`;
        name.textContent = p.username; pill.append(swatch, name, score); this.pillsEl.append(pill); this.pills.set(p.id, { root: pill, score });
      }
    }
    const top = Math.max(0, ...board.map(p => p.kills));
    for (const p of board) {
      const n = this.pills.get(p.id); if (!n) continue;
      n.score.textContent = String(p.kills); n.root.classList.toggle('me', p.id === this.identity().id);
      n.root.classList.toggle('leader', p.kills === top && top > 0); n.root.classList.toggle('down', !p.alive || !p.connected);
      if ((this.lastKills.get(p.id) ?? p.kills) !== p.kills) { n.root.classList.remove('bump'); void n.root.offsetWidth; if (!this.comfort.reducedMotion) n.root.classList.add('bump'); }
      this.lastKills.set(p.id, p.kills);
    }
  }
  private setCue(text: string, tone: '' | 'go' | 'danger' = ''): void {
    if (text === this.cueText) return;
    this.cueText = text; this.cue.textContent = text; this.cue.style.display = text ? 'block' : 'none'; this.cue.className = 'duel-center-cue';
    if (!text) return;
    if (text.length > 2) this.cue.classList.add('text'); if (tone) this.cue.classList.add(tone);
    if (!this.comfort.reducedMotion) { void this.cue.offsetWidth; this.cue.classList.add('slam'); }
  }
  update(enabled: boolean, spectating: boolean, respawnAt: number): void {
    this.enabled = enabled;
    const s = this.snapshot;
    this.hud.classList.toggle('visible', enabled && !!s); this.touchScores.classList.toggle('visible', enabled && !!s);
    if (!enabled || !s) { this.setCue(''); return; }
    const now = this.now(), board = s.participants; this.renderPills(board);
    if (this.announced && now >= this.announceUntil) {
      if (!this.announce.classList.contains('out')) { this.announce.classList.add('out'); this.announceUntil = now + 400; }
      else this.announce.classList.remove('visible', 'out');
    }
    const top = Math.max(0, ...board.map(p => p.kills)), leaders = board.filter(p => p.kills === top).map(p => p.id).join(',');
    if (s.phase === 'running' && this.leaderKey && top > 0 && leaders && leaders !== this.leaderKey) this.audio.duelCue('lead');
    this.leaderKey = leaders; this.clockEl.classList.remove('warn', 'critical', 'sudden');
    if (s.phase === 'sudden_death') {
      this.clockLabel.textContent = 'Next kill wins'; this.time.textContent = 'SUDDEN DEATH'; this.clockEl.classList.add('sudden'); this.barFill.style.transform = 'scaleX(1)';
    } else {
      const remaining = (s.endsAt ?? (s.startedAt ?? now) + DUEL_ROUND_MS) - now;
      this.clockLabel.textContent = `First to ${DUEL_SCORE_LIMIT}`; this.time.textContent = formatMatchTime(remaining);
      this.barFill.style.transform = `scaleX(${Math.max(0, Math.min(1, remaining / DUEL_ROUND_MS))})`;
      if (remaining <= 30_000) this.clockEl.classList.add('critical'); else if (remaining <= 60_000) this.clockEl.classList.add('warn');
      if (s.phase === 'running' && remaining <= 30_000 && remaining > 0 && !this.finalThirty) { this.finalThirty = true; this.audio.duelCue('final30'); }
    }
    let cue = '', tone: '' | 'go' | 'danger' = '';
    if (s.phase === 'countdown') {
      const at = s.countdownEndsAt ?? this.countdownEndsAt;
      if (!at) cue = 'WAITING FOR PLAYERS';
      else {
        const number = Math.max(0, Math.ceil((at - now) / 1000)); cue = number > 0 ? String(number) : 'FIGHT'; if (!number) tone = 'go';
        if (number !== this.lastCountdown) { this.lastCountdown = number; this.audio.duelCue(number > 0 ? 'countdown' : 'fight'); if (!number) { this.fight = true; this.fightUntil = now + 900; } }
      }
    } else if (spectating && respawnAt > now) cue = `RESPAWN ${Math.ceil((respawnAt - now) / 1000)}`;
    else if (s.phase === 'sudden_death') { cue = 'SUDDEN DEATH'; tone = 'danger'; if (!this.sudden) { this.sudden = true; this.audio.duelCue('sudden'); } }
    else if (s.phase === 'running') { if (!this.fight) { this.fight = true; this.fightUntil = now + 900; this.audio.duelCue('fight'); } if (now < this.fightUntil) { cue = 'FIGHT'; tone = 'go'; } }
    this.setCue(this.announced && cue.length > 2 ? '' : cue, tone); if (this.scoresHeld) this.renderScoreboard();
  }
}
