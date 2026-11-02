// Disaster City on the client: the sidebar (next disaster, what's running,
// who's still standing), the sky (storm dimming, the apocalypse's dusk),
// rain/acid/snow around the camera, and the results card.

import * as THREE from 'three';
import { bwButton, bwEl } from './bedwars_ui';
import { formatMatchTime } from './ui/presentation';
import { DR, disaster, type DisasterState } from './disaster_rules';
import { registerPresenter, type ModePresenter, type VanillaClient } from './vanilla/client/vanilla_client';
import type { SidebarRow } from './vanilla/client/vanilla_hud';

/** Sky hour per weather: noon is 0.25, sunset 0.5. Storms read as late, grey afternoon. */
const HOUR = { clear: .25, storm: .4, acid: .4, thunder: .43, snow: .35 } as const;
const DUSK_HOUR = .475;

const DROPS = 900;
/** "was flattened by a meteor" → "Flattened by a meteor". */
const causeLabel = (c: string) => { const t = c.replace(/^was /, ''); return t.charAt(0).toUpperCase() + t.slice(1); };
const BOX = 22;

class DisasterPresenter implements ModePresenter {
  private s: DisasterState | null = null;
  private results: HTMLElement | null = null;
  private lastPhase = '';
  /** performance.now() the results card opens: after the fireworks, as in the source. */
  private resultsAt = 0;
  private rain: THREE.Points | null = null;
  private rainKind = '';
  private rainVel = new Float32Array(DROPS);

  constructor(private readonly c: VanillaClient) {
    c.d.setStyle((id) => {
      const p = this.s?.players.find((x) => x.id === id);
      if (!p) return null;
      return { rat: false, caged: false, glow: false, hidden: !p.alive, tag: true, scale: 1 };
    });
  }

  onState(raw: unknown): void {
    const s = raw as DisasterState;
    this.s = s;
    if (s.phase !== this.lastPhase) {
      if (s.phase === 'waves' && this.lastPhase === 'countdown') this.c.d.sound('go');
      this.lastPhase = s.phase;
    }
    if (s.result && !this.resultsAt) this.resultsAt = performance.now() + DR.OVER_TICKS * 50;
  }
  frozen(): boolean { return this.s?.phase === 'countdown'; }
  timeOfDay(): number {
    const s = this.s;
    if (!s) return HOUR.clear;
    return s.dusk ? DUSK_HOUR : HOUR[s.weather] ?? HOUR.clear;
  }

  frame(dt: number): void {
    const s = this.s;
    if (!s) return;
    if (this.resultsAt && !this.results && performance.now() >= this.resultsAt) this.showResults(s);
    const now = this.c.serverNow();
    const left = Math.max(0, s.endsAt - now);
    const me = this.c.d.myId();
    const next = s.phase === 'countdown' ? 'Get ready'
      : s.phase === 'finale' ? 'Apocalypse · hold on'
        : s.phase === 'over' ? 'Match over'
          : s.nextAt !== null ? `${s.nextLabel} in ${formatMatchTime(Math.max(0, s.nextAt - now))}` : 'Hold on';
    const rows: SidebarRow[] = [];
    for (const a of s.active) {
      const d = disaster(a.id);
      rows.push({ label: `${d.icon} ${d.label}`, value: formatMatchTime(Math.max(0, a.endsAt - now)), tone: 'bad', you: false });
    }
    // Players: disasters survived so far (a short number, so long names fit).
    rows.push({ label: `${s.players.filter((p) => p.alive).length} alive`, value: 'Survived', tone: 'mute', you: false });
    const players = [...s.players].sort((a, b) => Number(b.alive) - Number(a.alive) || b.disasters - a.disasters);
    for (const p of players) rows.push({
      label: p.name, value: p.alive ? String(p.disasters) : 'out', tone: p.alive ? undefined : 'mute', you: p.id === me,
    });
    const tone = s.phase === 'finale' ? 'danger' : s.active.length ? 'warn' : 'calm';
    this.c.hud.setSidebar('DISASTER CITY', formatMatchTime(left), next, rows, tone);
    this.syncWeather(s.dusk && s.phase === 'finale' ? 'storm' : s.weather, dt);
  }

  /** Falling rain, acid or snow in a box that follows the camera. */
  private syncWeather(kind: DisasterState['weather'] | 'storm', dt: number): void {
    const want = kind === 'clear' ? '' : kind;
    if (want !== this.rainKind) {
      this.rainKind = want;
      this.disposeRain();
      if (want) this.buildRain(want);
    }
    const r = this.rain;
    if (!r) return;
    const at = this.c.d.player.pos;
    r.position.set(Math.floor(at.x), 0, Math.floor(at.z));
    const pos = r.geometry.getAttribute('position') as THREE.BufferAttribute;
    const arr = pos.array as Float32Array;
    const snow = want === 'snow';
    const t = performance.now() / 1000;
    for (let i = 0; i < DROPS; i++) {
      const j = i * 3;
      arr[j + 1] -= this.rainVel[i] * dt;
      if (snow) arr[j] += Math.sin(t * 1.3 + i) * dt * .6;
      if (arr[j + 1] < at.y - 10) {
        arr[j] = (Math.random() - .5) * BOX * 2;
        arr[j + 1] = at.y + 14 + Math.random() * 4;
        arr[j + 2] = (Math.random() - .5) * BOX * 2;
      }
    }
    pos.needsUpdate = true;
  }
  private buildRain(kind: string): void {
    const at = this.c.d.player.pos;
    const arr = new Float32Array(DROPS * 3);
    const snow = kind === 'snow';
    for (let i = 0; i < DROPS; i++) {
      arr[i * 3] = (Math.random() - .5) * BOX * 2;
      arr[i * 3 + 1] = at.y - 10 + Math.random() * 28;
      arr[i * 3 + 2] = (Math.random() - .5) * BOX * 2;
      this.rainVel[i] = snow ? 1.6 + Math.random() * 1.2 : 16 + Math.random() * 6;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(arr, 3));
    const color = kind === 'acid' ? 0x8cf06a : snow ? 0xffffff : 0x9fb8d8;
    const mat = new THREE.PointsMaterial({ color, size: snow ? .16 : .09, transparent: true, opacity: snow ? .9 : .55, depthWrite: false });
    this.rain = new THREE.Points(geo, mat);
    this.rain.frustumCulled = false;
    this.c.d.scene.add(this.rain);
  }
  private disposeRain(): void {
    if (!this.rain) return;
    this.rain.removeFromParent();
    this.rain.geometry.dispose();
    (this.rain.material as THREE.Material).dispose();
    this.rain = null;
  }

  private showResults(s: DisasterState): void {
    const r = s.result!;
    const scrim = this.results = bwEl('div', 'w-scrim open v-results-scrim', this.c.d.app);
    const card = bwEl('div', 'w-dialog v-results', scrim);
    const me = this.c.d.myId();
    const mine = r.rows.find((x) => x.id === me);
    const name = (id: number) => r.rows.find((x) => x.id === id)?.name ?? '?';
    bwEl('small', 'v-results-kicker', card, 'DISASTER CITY');
    const head = r.winners.includes(me) ? (r.winners.length === 1 ? 'You survived' : 'You made it')
      : r.winners.length === 0 ? 'The city won'
        : r.winners.length === 1 ? `${name(r.winners[0])} survived` : `${r.winners.length} survivors`;
    bwEl('h2', '', card, head);
    if (mine) {
      const time = formatMatchTime(mine.seconds * 1000);
      bwEl('p', 'v-results-sub', card, mine.survived
        ? `You lasted the full ${time} · ${mine.disasters} ${mine.disasters === 1 ? 'disaster' : 'disasters'} survived`
        : `You ${mine.cause.replace(/^was /, 'were ')} after ${time} · ${mine.disasters} ${mine.disasters === 1 ? 'disaster' : 'disasters'} survived`);
    }
    const table = bwEl('div', 'v-results-table', card);
    for (const row of r.rows) {
      const el = bwEl('div', 'v-results-row', table);
      if (row.id === me) el.classList.add('you');
      bwEl('b', 'place', el, `#${row.place}`);
      bwEl('span', 'name', el, row.name);
      bwEl('small', '', el, `${row.survived ? 'Survived' : causeLabel(row.cause)} · ${formatMatchTime(row.seconds * 1000)} · ${row.disasters} survived`);
    }
    const actions = bwEl('div', 'v-results-actions', card);
    bwButton(actions, 'Play again', () => this.c.d.replay('disaster'), 'w-btn primary');
    bwButton(actions, 'Leave', () => this.c.d.leave(), 'w-btn');
    this.c.d.onPanel();
  }
  panelOpen(): boolean { return !!this.results; }

  dispose(): void {
    this.c.d.setStyle(null);
    this.results?.remove(); this.results = null;
    this.disposeRain();
  }
}

registerPresenter('disaster', (c) => new DisasterPresenter(c));
