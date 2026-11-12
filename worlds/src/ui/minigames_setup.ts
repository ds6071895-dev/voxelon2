// The Party Games host sheet (source PartyMenu): Setup, Playlists and the
// playlist Editor, as one light Worlds dialog. The party leader changes the
// setup (shared with the party through `mgSetup`); everyone else sees it.
// Playlists are the player's own, kept with their account (guests keep them
// for the session).

import { uiButton, uiEl } from './dom';
import type { PartyState } from '../net/protocol';
import { PARTY_MAX } from '../net/protocol';
import {
  MG_CATEGORIES, MG_LENGTHS, MG_MAX_PLAYLISTS, MG_NAME_MAX, MG_PLAYLIST_GAMES, defaultMinigamesSetup, mgGame, mgPool, mixMinutes,
  playlistMinutes, sanitizeMgName, type MgPlaylist, type MinigamesSetup,
} from '../minigames_rules';
import '../styles/game_hud.css';
import '../styles/minigames.css';

interface Hooks {
  onChange(setup: MinigamesSetup): void;
  onPlaylists(lists: MgPlaylist[]): void;
  onStart(fill: boolean): void;
}

const CLOSE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>';
type Page = 'setup' | 'playlists' | 'editor';

export class MinigamesSetupSheet {
  private scrim: HTMLElement | null = null;
  private page: Page = 'setup';
  private party: PartyState | null = null;
  private myId = 0;
  private lists: MgPlaylist[] = [];
  /** Off by default: a party plays on its own unless the host ticks bots in. */
  private fill = false;
  /** The playlist being edited (index into lists, or -1 for a new one). */
  private draft: { index: number; name: string; games: string[] } | null = null;
  private error = '';
  /** In a match: look, don't start. */
  private readOnly = false;

  constructor(private readonly app: HTMLElement, private readonly hooks: Hooks) {}

  get open(): boolean { return !!this.scrim; }
  private get host(): boolean { return !!this.party && this.party.leader === this.myId && !this.readOnly; }
  private get setup(): MinigamesSetup { return this.party?.minigames ?? defaultMinigamesSetup(); }

  update(party: PartyState | null, myId: number, lists?: MgPlaylist[]): void {
    this.party = party; this.myId = myId;
    if (lists) this.lists = lists;
    if (this.scrim) this.render();
  }
  setPlaylists(lists: MgPlaylist[]): void { this.lists = lists; if (this.scrim) this.render(); }

  show(page: Page = 'setup', readOnly = false): void {
    this.page = page; this.readOnly = readOnly; this.error = '';
    this.fill = this.party?.fill ?? this.fill;
    if (!this.scrim) {
      this.scrim = uiEl('div', 'w-scrim open mg-setup', this.app);
      this.scrim.addEventListener('mousedown', (e) => { if (e.target === this.scrim) this.close(); });
    }
    this.render();
  }
  close(): void { this.scrim?.remove(); this.scrim = null; this.draft = null; }

  private change(patch: Partial<MinigamesSetup>): void {
    if (!this.host) return;
    const next = { ...this.setup, ...patch };
    this.hooks.onChange(next);
    // Show it straight away; the party broadcast confirms it.
    if (this.party) this.party = { ...this.party, minigames: next };
    this.render();
  }

  private render(): void {
    const scrim = this.scrim!;
    scrim.replaceChildren();
    const card = uiEl('section', 'w-dialog mg-card', scrim);
    card.setAttribute('role', 'dialog');
    const head = uiEl('div', 'w-dialog-head', card);
    const titles = uiEl('div', '', head);
    uiEl('span', 'w-kicker', titles, this.page === 'setup' ? 'Party Games' : this.page === 'playlists' ? 'Your playlists' : 'Playlist editor');
    uiEl('h2', '', titles, this.page === 'setup' ? 'Setup' : this.page === 'playlists' ? 'Playlists' : (this.draft?.name || 'New playlist'));
    const x = uiButton(head, '', () => this.close(), 'w-x'); x.innerHTML = CLOSE; x.setAttribute('aria-label', 'Close');
    if (this.page === 'setup') this.renderSetup(card);
    else if (this.page === 'playlists') this.renderPlaylists(card);
    else this.renderEditor(card);
    const err = uiEl('div', 'w-err', card, this.error);
    err.setAttribute('role', 'alert');
  }

  // ── Setup ───────────────────────────────────────────────────────────────

  private renderSetup(card: HTMLElement): void {
    const s = this.setup, pool = mgPool();
    if (!this.host) uiEl('p', 'w-lede', card, this.readOnly ? 'Changes apply to the next match.' : 'The party leader picks the games.');
    if (s.playlist) {
      const box = uiEl('div', 'mg-playing', card);
      const txt = uiEl('div', '', box);
      uiEl('small', '', txt, 'Playing a playlist');
      uiEl('b', '', txt, s.playlist.name);
      uiEl('span', '', txt, `${s.playlist.games.length} ${s.playlist.games.length === 1 ? 'game' : 'games'} in order · about ${playlistMinutes(s.playlist.games)} min`);
      const back = uiButton(box, 'Random mix', () => this.change({ playlist: null }), 'w-mini');
      back.disabled = !this.host;
    } else {
      uiEl('div', 'mg-label', card, 'Games per match');
      const lengths = uiEl('div', 'game-formats', card);
      lengths.setAttribute('role', 'radiogroup');
      for (const l of MG_LENGTHS) {
        const b = uiButton(lengths, String(l), () => this.change({ length: l }), 'game-format');
        b.setAttribute('role', 'radio'); b.setAttribute('aria-checked', String(s.length === l)); b.disabled = !this.host;
      }
      const on = pool.filter((g) => !s.banned.includes(g.id)).length;
      uiEl('p', 'w-lede', card, `A random mix of ${Math.min(s.length, on)} · about ${mixMinutes(Math.min(s.length, on))} min. The last game counts double.`);
      const row = uiEl('div', 'mg-label-row', card);
      uiEl('div', 'mg-label', row, `Games on: ${on} of ${pool.length}`);
      const all = uiButton(row, 'All on', () => this.change({ banned: [] }), 'w-mini');
      all.disabled = !this.host || !s.banned.length;
      const grid = uiEl('div', 'mg-games', card);
      for (const g of pool) {
        const off = s.banned.includes(g.id);
        const chip = uiButton(grid, '', () => {
          if (!off && on <= 1) { this.error = 'At least one game has to stay on.'; this.render(); return; }
          this.error = '';
          this.change({ banned: off ? s.banned.filter((b) => b !== g.id) : [...s.banned, g.id] });
        }, 'mg-game');
        chip.setAttribute('aria-pressed', String(!off));
        chip.disabled = !this.host;
        const dot = uiEl('i', '', chip); dot.style.background = MG_CATEGORIES[g.category].color;
        uiEl('b', '', chip, g.name);
        uiEl('small', '', chip, MG_CATEGORIES[g.category].label);
      }
    }
    if (!this.readOnly) {
      const label = uiEl('label', 'game-fill', card);
      const box = uiEl('input', '', label); box.type = 'checkbox'; box.checked = this.fill; box.disabled = !this.host;
      uiEl('span', '', label, `Fill empty places with bots (up to ${PARTY_MAX})`);
      box.addEventListener('change', () => { this.fill = box.checked; });
    }
    const foot = uiEl('div', 'game-setup-foot', card);
    uiButton(foot, 'Playlists', () => { this.error = ''; this.page = 'playlists'; this.render(); }, 'w-btn');
    if (!this.readOnly) {
      const go = uiButton(foot, 'Start', () => { this.close(); this.hooks.onStart(this.fill); }, 'w-btn primary');
      go.disabled = !this.host;
    }
  }

  // ── Playlists ───────────────────────────────────────────────────────────

  private renderPlaylists(card: HTMLElement): void {
    const s = this.setup;
    uiEl('p', 'w-lede', card, this.lists.length ? `${this.lists.length} of ${MG_MAX_PLAYLISTS} playlists. A playlist plays its games in order.` : 'No playlists yet. Make one to play your favourite games in your own order.');
    const list = uiEl('div', 'mg-lists', card);
    this.lists.forEach((pl, i) => {
      const row = uiEl('div', 'mg-list', list);
      if (s.playlist?.name === pl.name) row.classList.add('active');
      const txt = uiEl('div', 'mg-list-name', row);
      uiEl('b', '', txt, pl.name);
      uiEl('small', '', txt, `${pl.games.length} ${pl.games.length === 1 ? 'game' : 'games'} · about ${playlistMinutes(pl.games)} min`);
      const acts = uiEl('div', 'mg-list-acts', row);
      const play = uiButton(acts, 'Pick', () => {
        if (!pl.games.length) { this.error = 'That playlist is empty. Edit it to add games.'; this.render(); return; }
        this.change({ playlist: { name: pl.name, games: [...pl.games] } });
        this.page = 'setup'; this.render();
      }, 'w-mini');
      play.disabled = !this.host;
      uiButton(acts, 'Edit', () => { this.draft = { index: i, name: pl.name, games: [...pl.games] }; this.page = 'editor'; this.error = ''; this.render(); }, 'w-mini');
      uiButton(acts, 'Delete', () => {
        this.lists = this.lists.filter((_, j) => j !== i);
        this.hooks.onPlaylists(this.lists);
        this.render();
      }, 'w-mini danger');
    });
    const foot = uiEl('div', 'game-setup-foot', card);
    uiButton(foot, 'Back', () => { this.page = 'setup'; this.error = ''; this.render(); }, 'w-btn');
    if (s.playlist && this.host) uiButton(foot, 'Back to random', () => { this.change({ playlist: null }); this.page = 'setup'; this.render(); }, 'w-btn');
    uiButton(foot, 'New playlist', () => {
      if (this.lists.length >= MG_MAX_PLAYLISTS) { this.error = `You have ${MG_MAX_PLAYLISTS} playlists. Delete one first.`; this.render(); return; }
      this.draft = { index: -1, name: `Playlist ${this.lists.length + 1}`, games: [] };
      this.page = 'editor'; this.error = ''; this.render();
    }, 'w-btn primary');
  }

  // ── Editor ──────────────────────────────────────────────────────────────

  private renderEditor(card: HTMLElement): void {
    const d = this.draft;
    if (!d) { this.page = 'playlists'; this.renderPlaylists(card); return; }
    const field = uiEl('label', 'w-field', card, 'Name');
    const input = uiEl('input', 'w-input mg-name', field);
    input.maxLength = MG_NAME_MAX; input.value = d.name;
    input.addEventListener('input', () => { d.name = input.value; });
    const est = d.games.length ? `${d.games.length} of ${MG_PLAYLIST_GAMES} games · about ${playlistMinutes(d.games)} min` : `Up to ${MG_PLAYLIST_GAMES} games.`;
    uiEl('p', 'w-lede', card, est);
    const order = uiEl('ol', 'mg-order', card);
    d.games.forEach((id, i) => {
      const g = mgGame(id);
      const li = uiEl('li', '', order);
      const dot = uiEl('i', '', li); dot.style.background = g ? MG_CATEGORIES[g.category].color : '#999';
      const name = uiEl('span', '', li, g?.name ?? id);
      if (i === d.games.length - 1 && d.games.length > 1) uiEl('small', 'mg-final', name, 'Final game · double points');
      const up = uiButton(li, '↑', () => { [d.games[i - 1], d.games[i]] = [d.games[i], d.games[i - 1]]; this.render(); }, 'w-mini');
      up.disabled = i === 0; up.setAttribute('aria-label', 'Move earlier');
      const rm = uiButton(li, '✕', () => { d.games.splice(i, 1); this.render(); }, 'w-mini');
      rm.setAttribute('aria-label', 'Remove');
    });
    uiEl('div', 'mg-label', card, 'Add a game');
    const grid = uiEl('div', 'mg-games small', card);
    for (const g of mgPool()) {
      const chip = uiButton(grid, '', () => {
        if (d.games.length >= MG_PLAYLIST_GAMES) { this.error = `A playlist holds up to ${MG_PLAYLIST_GAMES} games.`; this.render(); return; }
        d.games.push(g.id); this.error = ''; this.render();
      }, 'mg-game');
      const dot = uiEl('i', '', chip); dot.style.background = MG_CATEGORIES[g.category].color;
      uiEl('b', '', chip, g.name);
    }
    const tools = uiEl('div', 'mg-tools', card);
    uiButton(tools, 'Add 3 random', () => {
      const pool = mgPool().map((g) => g.id);
      for (let k = 0; k < 3 && d.games.length < MG_PLAYLIST_GAMES; k++) d.games.push(pool[Math.floor(Math.random() * pool.length)]);
      this.render();
    }, 'w-mini');
    uiButton(tools, 'Shuffle', () => {
      for (let i = d.games.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [d.games[i], d.games[j]] = [d.games[j], d.games[i]]; }
      this.render();
    }, 'w-mini');
    uiButton(tools, 'Clear', () => { d.games = []; this.render(); }, 'w-mini');
    const foot = uiEl('div', 'game-setup-foot', card);
    uiButton(foot, 'Cancel', () => { this.draft = null; this.page = 'playlists'; this.error = ''; this.render(); }, 'w-btn');
    const save = (play: boolean) => {
      if (!d.games.length) { this.error = 'Add at least one game first.'; this.render(); return; }
      const name = sanitizeMgName(d.name) || 'Playlist';
      const list: MgPlaylist = { name, games: [...d.games] };
      if (d.index >= 0) this.lists = this.lists.map((p, j) => (j === d.index ? list : p));
      else {
        if (this.lists.length >= MG_MAX_PLAYLISTS) { this.error = `You have ${MG_MAX_PLAYLISTS} playlists. Delete one first.`; this.render(); return; }
        this.lists = [...this.lists, list];
      }
      this.hooks.onPlaylists(this.lists);
      this.draft = null; this.error = '';
      this.page = 'playlists';
      if (play && this.host) {
        this.page = 'setup';
        this.change({ playlist: list });
        this.close();
        this.hooks.onStart(this.fill);
        return;
      }
      this.render();
    };
    uiButton(foot, 'Save', () => save(false), 'w-btn');
    const sp = uiButton(foot, 'Save & play', () => save(true), 'w-btn primary');
    sp.disabled = !this.host;
  }
}
