// Lucky Pillars on the client: the sidebar (twist, phase clock, lava, players
// and kills), the world border's glowing wall, and the results card.

import * as THREE from 'three';
import { bwButton, bwEl } from './bedwars_ui';
import { formatMatchTime } from './ui/presentation';
import { LP, lpTwist, type PillarsState } from './pillars_rules';
import { registerPresenter, type ModePresenter, type VanillaClient } from './vanilla/client/vanilla_client';
import type { SidebarRow } from './vanilla/client/vanilla_hud';

class PillarsPresenter implements ModePresenter {
  private s: PillarsState | null = null;
  private border: THREE.Mesh | null = null;
  private borderSize = 0;
  private results: HTMLElement | null = null;
  private lastPhase = '';

  constructor(private readonly c: VanillaClient) {
    // Glowing, invisible and resized players (deathmatch, potions, Giants/Tiny Town).
    c.d.setStyle((id) => {
      const p = this.s?.players.find((x) => x.id === id);
      if (!p) return null;
      return { rat: false, caged: false, glow: !!p.glow, hidden: !p.alive || (!!p.invis && !p.glow), tag: !p.invis, scale: p.scale };
    });
  }

  onState(raw: unknown): void {
    const s = raw as PillarsState;
    this.s = s;
    if (s.phase !== this.lastPhase) {
      if (s.phase === 'main' && this.lastPhase === 'countdown') this.c.d.sound('go');
      this.lastPhase = s.phase;
    }
    if (s.result && !this.results) this.showResults(s);
  }
  frozen(): boolean { return this.s?.phase === 'countdown'; }

  frame(): void {
    const s = this.s;
    if (!s) return;
    const left = Math.max(0, s.endsAt - this.c.serverNow());
    const me = this.c.d.myId();
    const twist = s.twist ? lpTwist(s.twist) : null;
    const next = s.phase === 'countdown' ? (twist ? `Twist: ${twist.label}` : 'Rolling the twist…')
      : s.phase === 'main' ? `Deathmatch in ${formatMatchTime(left)}`
        : s.phase === 'deathmatch' ? `Deathmatch · ${formatMatchTime(left)}` : 'Match over';
    const rows: SidebarRow[] = [...s.players].sort((a, b) => Number(b.alive) - Number(a.alive) || b.kills - a.kills).map((p) => ({
      label: p.name, value: p.alive ? `${p.kills} ${p.kills === 1 ? 'kill' : 'kills'}` : 'out', tone: p.alive ? undefined : 'mute', you: p.id === me,
    }));
    if (twist && s.phase !== 'countdown') rows.unshift({ label: 'Twist', value: twist.label, tone: 'gold', you: false });
    if (s.lavaY !== null) rows.splice(1, 0, { label: 'Lava', value: `y ${s.lavaY}`, tone: 'bad', you: false });
    rows.push({ label: 'Alive', value: String(s.players.filter((p) => p.alive).length), tone: undefined, you: false });
    this.c.hud.setSidebar('LUCKY PILLARS', formatMatchTime(left), next, rows, s.phase === 'deathmatch' ? 'danger' : left < 30_000 && s.phase === 'main' ? 'warn' : 'calm');
    this.syncBorder(s.border);
  }

  /** The world border: a faint glowing square wall around the arena. */
  private syncBorder(size: number): void {
    if (Math.abs(size - this.borderSize) < .02 && this.border) return;
    this.borderSize = size;
    if (!this.border) {
      const geo = new THREE.BoxGeometry(1, 1, 1);
      const mat = new THREE.MeshBasicMaterial({ color: 0x5aa9ff, transparent: true, opacity: .14, side: THREE.BackSide, depthWrite: false });
      this.border = new THREE.Mesh(geo, mat);
      this.border.position.set(.5, LP.BOTTOM_Y + 20, .5);
      this.c.d.scene.add(this.border);
    }
    this.border.scale.set(size, 100, size);
  }

  private showResults(s: PillarsState): void {
    const r = s.result!;
    const scrim = this.results = bwEl('div', 'w-scrim open v-results-scrim', this.c.d.app);
    const card = bwEl('div', 'w-dialog v-results', scrim);
    const me = this.c.d.myId();
    const mine = r.rows.find((x) => x.id === me);
    bwEl('small', 'v-results-kicker', card, 'LUCKY PILLARS');
    bwEl('h2', '', card, r.winner === me ? 'You win!' : r.winner === null ? 'Nobody won' : `${r.rows.find((x) => x.id === r.winner)?.name ?? '?'} wins`);
    if (mine) bwEl('p', 'v-results-sub', card, `You placed #${mine.place} · ${mine.kills} ${mine.kills === 1 ? 'kill' : 'kills'} · ${mine.items} items${mine.legendaries ? ` · ${mine.legendaries} legendary` : ''}`);
    const table = bwEl('div', 'v-results-table', card);
    for (const row of r.rows) {
      const el = bwEl('div', 'v-results-row', table);
      if (row.id === me) el.classList.add('you');
      bwEl('b', 'place', el, `#${row.place}`);
      bwEl('span', 'name', el, row.name);
      bwEl('small', '', el, `${row.kills} K · ${row.items} items${row.legendaries ? ` · ${row.legendaries}★` : ''}`);
    }
    const actions = bwEl('div', 'v-results-actions', card);
    bwButton(actions, 'Play again', () => this.c.d.replay('pillars'), 'w-btn primary');
    bwButton(actions, 'Leave', () => this.c.d.leave(), 'w-btn');
    this.c.d.onPanel();
  }
  panelOpen(): boolean { return !!this.results; }

  dispose(): void {
    this.c.d.setStyle(null);
    this.results?.remove(); this.results = null;
    if (this.border) { this.border.removeFromParent(); this.border.geometry.dispose(); (this.border.material as THREE.Material).dispose(); this.border = null; }
  }
}

registerPresenter('pillars', (c) => new PillarsPresenter(c));
