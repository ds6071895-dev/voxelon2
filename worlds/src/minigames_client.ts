// Party Games on the client: the briefing card before each mini-game, the
// game's own board (Brain Rush's question, Memory Mosaic's stage), the
// sidebar (game n of N, time, status, standings), the results card between
// games, and the podium's awards with Play again. Sky time follows each arena.

import { uiButton, uiEl } from './ui/dom';
import * as THREE from 'three';
import { formatMatchTime } from './ui/presentation';
import { MG, MG_CATEGORIES, mgGame } from './minigames_rules';
import type { MinigamesState } from './minigames_state';
import { PODIUM_TIME } from './minigames/podium';
import { registerPresenter, type ModePresenter, type VanillaClient } from './vanilla/client/vanilla_client';
import type { SidebarRow } from './vanilla/client/vanilla_hud';
import './minigames/arenas';
import './styles/minigames.css';

/** main.ts gives the presenter a way to open the host sheet. */
let openHostSheet: (() => void) | null = null;
export function setMinigamesHostSheet(fn: (() => void) | null): void { openHostSheet = fn; }

const ordinal = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : n % 10 === 1 ? 'st' : n % 10 === 2 ? 'nd' : n % 10 === 3 ? 'rd' : 'th'}`;

class MinigamesPresenter implements ModePresenter {
  private s: MinigamesState | null = null;
  private brief: HTMLElement | null = null;
  private board: HTMLElement | null = null;
  private results: HTMLElement | null = null;
  private final: HTMLElement | null = null;
  private briefKey = '';
  private boardKey = '';
  private resultsKey = '';
  private finalAt = 0;
  private readonly guides = new THREE.Group();

  constructor(private readonly c: VanillaClient) {
    c.d.scene.add(this.guides);
    c.d.setStyle((id) => {
      const s = this.s;
      if (!s || !s.standings.some((p) => p.id === id)) return null;
      return { rat: false, caged: false, glow: s.glowing?.includes(id) ?? false, hidden: s.out.includes(id), tag: true, scale: 1 };
    });
  }

  onState(raw: unknown): void {
    const s = raw as MinigamesState;
    const prev = this.s;
    this.s = s;
    this.clearGuides();
    const ring=s.rings?.[this.c.d.myId()];
    if(ring){
      const mesh=new THREE.Mesh(new THREE.TorusGeometry(4.9,.12,6,48),new THREE.MeshBasicMaterial({color:0xffdb64,depthTest:false,transparent:true,opacity:.75}));
      mesh.position.set(ring.x,ring.y,ring.z);
      mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0,0,1),new THREE.Vector3(ring.nx,ring.ny,ring.nz).normalize());
      this.guides.add(mesh);
    }
    for(const leash of s.leashes??[]){
      const a=new THREE.Vector3(...leash.from),b=new THREE.Vector3(...leash.to),mid=a.clone().lerp(b,.5);mid.y-=.4;
      const points=new THREE.QuadraticBezierCurve3(a,mid,b).getPoints(12);
      this.guides.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(points),new THREE.LineBasicMaterial({color:0x80603b})));
    }
    if (prev && prev.phase !== s.phase && s.phase === 'round') this.c.d.sound('go');
    // The briefing: from the moment a game is announced until the whistle.
    const briefKey = (s.phase === 'brief' || s.phase === 'countdown') && s.game ? `${s.index}:${s.game}` : '';
    if (briefKey !== this.briefKey) { this.briefKey = briefKey; this.showBrief(s); }
    const boardKey = s.board ? JSON.stringify(s.board) : '';
    if (boardKey !== this.boardKey) { this.boardKey = boardKey; this.showBoard(s); }
    const resultsKey = s.phase === 'results' && s.results ? `${s.index}:${s.results.game}` : '';
    if (resultsKey !== this.resultsKey) { this.resultsKey = resultsKey; this.showResults(s); }
    if (s.phase === 'podium' && !this.finalAt) this.finalAt = performance.now() + 9000;
  }
  frozen(): boolean { return this.s?.phase === 'brief' || this.s?.phase === 'countdown'; }
  /** Minecraft ticks (6000 noon) to the sky's hour (.25 noon, .5 sunset). */
  timeOfDay(): number {
    const s = this.s;
    const mcTime = !s ? 6000 : s.phase === 'podium' || !s.game ? PODIUM_TIME : mgGame(s.game)?.time ?? 6000;
    return (mcTime / 24000) % 1;
  }

  frame(): void {
    const s = this.s;
    if (!s) return;
    if (this.finalAt && !this.final && performance.now() >= this.finalAt) this.showFinal(s);
    const now = this.c.serverNow();
    const left = Math.max(0, s.endsAt - now);
    const me = this.c.d.myId();
    const g = s.game ? mgGame(s.game) : null;
    const step = s.total > 1 ? `Game ${s.index + 1} of ${s.total}` : 'Party Games';
    const next = s.phase === 'podium' ? 'Final standings'
      : s.phase === 'results' ? (s.index + 1 < s.total ? 'Next game soon' : 'Podium next')
        : `${step}${s.doubled ? ' · double points' : ''}`;
    const rows: SidebarRow[] = [];
    if (g && s.phase !== 'podium') rows.push({ label: g.name, value: s.phase === 'round' ? '' : s.phase === 'results' ? 'Done' : 'Get ready', tone: 'mute', you: false });
    if (s.status) rows.push({ label: s.status, value: '', tone: 'mute', you: false });
    rows.push({ label: 'Points', value: 'Wins', tone: 'mute', you: false });
    for (const p of s.standings) rows.push({ label: p.name, value: `${p.points} · ${p.wins}`, you: p.id === me });
    this.c.hud.setSidebar('PARTY GAMES', s.phase === 'round' || s.phase === 'brief' || s.phase === 'countdown' ? formatMatchTime(left) : '', next, rows, s.doubled ? 'warn' : 'calm');
  }

  private showBrief(s: MinigamesState): void {
    this.brief?.remove(); this.brief = null;
    const g = s.game ? mgGame(s.game) : null;
    if (!this.briefKey || !g) return;
    const el = this.brief = uiEl('div', 'mg-brief', this.c.d.app);
    const top = uiEl('div', 'mg-brief-top', el);
    const chip = uiEl('span', 'mg-chip', top, MG_CATEGORIES[g.category].label);
    chip.style.background = MG_CATEGORIES[g.category].color;
    if (s.doubled) uiEl('span', 'mg-chip gold', top, 'Double points');
    uiEl('span', 'mg-brief-step', top, `${s.total > 1 ? `Game ${s.index + 1} of ${s.total} · ` : ''}${Math.round(g.seconds)} s`);
    uiEl('h2', '', el, g.name);
    const ul = uiEl('ul', '', el);
    for (const line of g.rules) uiEl('li', '', ul, line);
  }

  private showBoard(s: MinigamesState): void {
    const b = s.board;
    if (!b) { this.board?.remove(); this.board = null; return; }
    const el = this.board ??= uiEl('div', 'mg-board', this.c.d.app);
    el.replaceChildren();
    uiEl('small', '', el, b.sub ?? '');
    uiEl('b', '', el, b.title);
    if (b.options) {
      const opts = uiEl('div', 'mg-board-opts', el);
      for (const o of b.options) {
        const cls = o.right === undefined ? 'mg-opt' : o.right ? 'mg-opt right' : 'mg-opt wrong';
        const row = uiEl('span', cls, opts);
        const tag = uiEl('em', '', row, o.label); tag.style.background = o.color;
        uiEl('span', '', row, o.text);
      }
    }
  }

  private showResults(s: MinigamesState): void {
    this.results?.remove(); this.results = null;
    const r = s.results;
    if (!this.resultsKey || !r) return;
    const g = mgGame(r.game);
    const me = this.c.d.myId();
    const scrim = this.results = uiEl('div', 'w-scrim open mg-results-scrim', this.c.d.app);
    const card = uiEl('div', 'w-dialog mg-results', scrim);
    uiEl('small', 'v-results-kicker', card, `${g?.name ?? 'Results'}${s.doubled ? ' · double points' : ''}`.toUpperCase());
    const winners = r.rows.filter((row) => row.place === 1);
    uiEl('h2', '', card, winners.some((w) => w.id === me) ? (winners.length > 1 ? 'You tied for the win' : 'You won') : `${winners.map((w) => w.name).join(' & ')} won`);
    const table = uiEl('div', 'v-results-table', card);
    for (const row of r.rows) {
      const el = uiEl('div', 'v-results-row', table);
      if (row.id === me) el.classList.add('you');
      uiEl('b', 'place', el, ordinal(row.place));
      uiEl('span', 'name', el, row.name);
      uiEl('small', '', el, row.detail);
      uiEl('span', 'mg-earned', el, `+${row.earned}`);
    }
    if (s.total > 1) {
      const st = uiEl('div', 'mg-standings', card);
      for (const p of s.standings) uiEl('span', '', st, `${p.name} ${p.points}`);
    }
  }

  private showFinal(s: MinigamesState): void {
    const pod = s.podium;
    if (!pod) return;
    const me = this.c.d.myId();
    const scrim = this.final = uiEl('div', 'w-scrim open v-results-scrim', this.c.d.app);
    const card = uiEl('div', 'w-dialog v-results', scrim);
    uiEl('small', 'v-results-kicker', card, 'PARTY GAMES');
    const champ = pod.order[0];
    uiEl('h2', '', card, champ?.id === me ? 'You are the Party Champion' : `${champ?.name ?? '?'} is the Party Champion`);
    const mine = pod.order.findIndex((p) => p.id === me);
    if (mine >= 0) uiEl('p', 'v-results-sub', card, `You finished ${ordinal(mine + 1)} with ${pod.order[mine].points} points and ${pod.order[mine].wins} ${pod.order[mine].wins === 1 ? 'win' : 'wins'}.`);
    const table = uiEl('div', 'v-results-table', card);
    pod.order.forEach((p, i) => {
      const el = uiEl('div', 'v-results-row', table);
      if (p.id === me) el.classList.add('you');
      uiEl('b', 'place', el, `#${i + 1}`);
      uiEl('span', 'name', el, p.name);
      uiEl('small', '', el, `${p.points} pts · ${p.wins} ${p.wins === 1 ? 'win' : 'wins'}`);
    });
    if (pod.awards.length) {
      const aw = uiEl('div', 'mg-awards', card);
      for (const a of pod.awards) {
        const row = uiEl('div', 'mg-award', aw);
        uiEl('b', '', row, a.title);
        uiEl('span', '', row, a.detail ? `${a.name} · ${a.detail}` : a.name);
      }
    }
    const actions = uiEl('div', 'v-results-actions', card);
    uiButton(actions, 'Play again', () => this.c.d.replay('minigames'), 'w-btn primary');
    if (s.host === me && openHostSheet) uiButton(actions, 'Setup', () => openHostSheet?.(), 'w-btn');
    uiButton(actions, 'Leave', () => this.c.d.leave(), 'w-btn');
    this.c.d.onPanel();
  }
  panelOpen(): boolean { return !!this.final; }
  private clearGuides():void {
    for(const child of [...this.guides.children]){
      const mesh=child as THREE.Mesh;mesh.geometry?.dispose();
      if(Array.isArray(mesh.material))mesh.material.forEach(m=>m.dispose());else mesh.material?.dispose();
      this.guides.remove(child);
    }
  }

  dispose(): void {
    this.clearGuides();this.guides.removeFromParent();
    this.c.d.setStyle(null);
    this.brief?.remove(); this.brief = null;
    this.board?.remove(); this.board = null;
    this.results?.remove(); this.results = null;
    this.final?.remove(); this.final = null;
  }
}
void MG;

registerPresenter('minigames', (c) => new MinigamesPresenter(c));
