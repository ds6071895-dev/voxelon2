// THE GOVERNMENT MENU (/president) — the ballot, the campaign trail, and the
// powers of office.
//
// Four views on one screen:
//   · ELECTION      every party standing this week, each with its founder as a
//                   live 3D character who poses when you point at them, its
//                   slogan, its promises, its share of the vote, and your ballot
//   · CANDIDACY     found your own party (name, slogan, up to three promises
//                   picked from a fixed list) or withdraw the one you lead
//   · ADMINISTRATION the tax dial, the broadcast desk and kit funding — live for
//                   the sitting president, read-only for everybody else
//   · TREASURY      what the faction is holding, what it has taken in tax, and
//                   who robbed it last
//
// SELF-CONTAINED: one injected <style> under a `vx-prez-` prefix, nothing added
// to index.html, and a single shared bust board (gov_ui.ts) rather than a
// renderer of its own. Player-authored text is written with textContent only.

import { BUST_POSES, type BustEntry } from './avatar_bust';
import { defaultCosmetics, type Cosmetics } from './character';
import { iconSvg } from './emoji_icons';
import { ITEMS, type ItemStack } from './items';
import {
  MAX_BROADCAST, MAX_PARTY_NAME, MAX_PROMISES, MAX_SLOGAN, MAX_TAX,
  PRESET_PROMISES, type PoliticsState, ballotOf, electionOf, governmentOf,
  isPresident, partyOfFounder, voteCounts,
} from './politics';
import { STARTER_KIT, kitCost } from './treasury';
import { skinSeed } from './net/protocol';
import { factionColor, factionName, isFaction } from './teams';
import { bustStage, hideTip, injectGovStyle, itemChip } from './gov_ui';

const CSS = `
.vx-prez-shell {
  position: relative; display: flex; flex-direction: column;
  width: min(1080px, 100%); height: min(760px, 100%);
  border-radius: 18px; overflow: hidden; background: rgba(11, 18, 27, .94);
  box-shadow: inset 0 0 0 1px rgba(232, 238, 252, .13), 0 26px 70px rgba(0, 0, 0, .55);
}
.vx-prez-head {
  display: flex; align-items: center; gap: 14px; padding: 16px 20px;
  border-bottom: 1px solid rgba(232, 238, 252, .1);
  background: linear-gradient(180deg, color-mix(in srgb, var(--side) 22%, transparent), transparent);
}
.vx-prez-crest {
  display: flex; align-items: center; justify-content: center; width: 38px; height: 38px;
  border-radius: 11px; font-size: 18px; color: #0b1119; background: var(--side);
}
.vx-prez-titles { flex: 1; min-width: 0; }
.vx-prez-titles h1 { margin: 3px 0 0; font-size: 20px; letter-spacing: 2.2px; text-transform: uppercase; }
.vx-prez-clock { text-align: right; }
.vx-prez-clock b { display: block; font-size: 17px; color: #ffd98a; }
.vx-prez-clock small { font-size: 9px; letter-spacing: 1.4px; text-transform: uppercase; color: #77879f; }

.vx-prez-tabs { display: flex; gap: 4px; padding: 10px 16px 0; }
.vx-prez-tab {
  border: 0; border-bottom: 2px solid transparent; border-radius: 8px 8px 0 0; cursor: pointer;
  padding: 9px 14px; background: none; color: #8fa0bb;
  font: 700 10px/1 inherit; letter-spacing: 1.5px; text-transform: uppercase;
}
.vx-prez-tab:hover { color: #e8eefc; background: rgba(232, 238, 252, .06); }
.vx-prez-tab[aria-selected="true"] { color: #ffd98a; border-bottom-color: #eda01a; }
.vx-prez-tab:focus-visible { outline: 2px solid #eda01a; outline-offset: -2px; }

.vx-prez-body { padding: 16px 20px 20px; }

.vx-prez-note {
  padding: 11px 13px; border-radius: 10px; margin-bottom: 14px;
  font-size: 11.5px; line-height: 1.55; color: #b7c4d8;
  background: rgba(232, 238, 252, .05); border-left: 3px solid var(--side);
}
.vx-prez-note b { color: #ffd98a; }

/* --- the ballot ----------------------------------------------------------- */
.vx-prez-parties { display: grid; gap: 12px; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); }
.vx-prez-party {
  position: relative; display: grid; grid-template-columns: 108px 1fr;
  border-radius: 13px; overflow: hidden; background: rgba(232, 238, 252, .05);
  box-shadow: inset 0 0 0 1px rgba(232, 238, 252, .1);
  transition: box-shadow .16s, transform .16s;
}
.vx-prez-party:hover { transform: translateY(-2px); box-shadow: inset 0 0 0 1px var(--side); }
.vx-prez-party[data-mine="1"] { box-shadow: inset 0 0 0 1px rgba(237, 160, 26, .6); }
.vx-prez-party[data-incumbent="1"] { background: rgba(237, 160, 26, .09); }
.vx-prez-stage {
  position: relative; height: 148px;
  background: radial-gradient(72% 88% at 50% 10%, color-mix(in srgb, var(--side) 30%, transparent), transparent 74%),
    rgba(0, 0, 0, .25);
}
.vx-prez-slot { position: absolute; inset: 8px 0 18px; }
.vx-prez-sash {
  position: absolute; left: 0; right: 0; bottom: 0; padding: 4px 6px; text-align: center;
  font: 700 8.5px/1.3 inherit; letter-spacing: 1.2px; text-transform: uppercase;
  color: #26180a; background: #eda01a;
}
.vx-prez-info { display: flex; flex-direction: column; gap: 7px; padding: 12px 13px; min-width: 0; }
.vx-prez-pname { font-size: 14px; font-weight: 700; overflow-wrap: anywhere; }
.vx-prez-founder { font-size: 10px; letter-spacing: 1.4px; text-transform: uppercase; color: var(--side); }
.vx-prez-slogan { font-size: 12px; font-style: italic; color: #c3cfe2; overflow-wrap: anywhere; }
.vx-prez-plist { display: flex; flex-direction: column; gap: 3px; margin-top: 1px; }
.vx-prez-pline { display: flex; gap: 6px; font-size: 11px; line-height: 1.4; color: #a9b7cc; }
.vx-prez-pline span { flex: none; color: var(--side); }
.vx-prez-bar { height: 6px; border-radius: 3px; background: rgba(232, 238, 252, .1); overflow: hidden; }
.vx-prez-bar i { display: block; height: 100%; border-radius: 3px; background: var(--side); transition: width .3s; }
.vx-prez-tally { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.vx-prez-votes { font-size: 11px; color: #8fa0bb; }
.vx-prez-actions { display: flex; gap: 6px; }
.vx-prez-empty {
  padding: 44px 22px; text-align: center; color: #77879f; font-size: 12.5px; line-height: 1.6;
  border-radius: 12px; background: rgba(232, 238, 252, .04);
}

/* --- forms ---------------------------------------------------------------- */
.vx-prez-form { display: flex; flex-direction: column; gap: 14px; max-width: 640px; }
.vx-prez-field { display: flex; flex-direction: column; gap: 6px; }
.vx-prez-field > label {
  display: flex; justify-content: space-between; align-items: baseline;
  font-size: 9.5px; letter-spacing: 1.6px; text-transform: uppercase; color: #8fa0bb;
}
.vx-prez-field > label span { color: #5f6f87; letter-spacing: .4px; text-transform: none; font-size: 10px; }
.vx-prez-input, .vx-prez-area {
  width: 100%; padding: 11px 12px; border: 0; border-radius: 10px;
  font: 500 13px/1.5 inherit; color: #e8eefc; background: rgba(232, 238, 252, .07);
  box-shadow: inset 0 0 0 1px rgba(232, 238, 252, .12);
}
.vx-prez-area { resize: vertical; min-height: 76px; }
.vx-prez-input:focus, .vx-prez-area:focus { outline: 2px solid #eda01a; outline-offset: 1px; }
.vx-prez-input:disabled, .vx-prez-area:disabled { opacity: .5; }
.vx-prez-picks { display: grid; gap: 6px; }
.vx-prez-pick {
  display: flex; align-items: flex-start; gap: 9px; padding: 10px 12px; border-radius: 9px;
  cursor: pointer; font-size: 12px; line-height: 1.45; color: #c3cfe2;
  background: rgba(232, 238, 252, .05); box-shadow: inset 0 0 0 1px transparent;
}
.vx-prez-pick:hover { background: rgba(232, 238, 252, .09); }
.vx-prez-pick[data-on="1"] { color: #fff; box-shadow: inset 0 0 0 1px var(--side); background: color-mix(in srgb, var(--side) 15%, transparent); }
.vx-prez-pick[data-full="1"]:not([data-on="1"]) { opacity: .4; cursor: not-allowed; }
.vx-prez-pick input { margin: 2px 0 0; accent-color: #eda01a; }
.vx-prez-row { display: flex; gap: 9px; align-items: center; flex-wrap: wrap; }
.vx-prez-err { font-size: 11.5px; line-height: 1.5; color: #ff9d8a; min-height: 1.5em; }

/* --- administration ------------------------------------------------------- */
.vx-prez-panel {
  padding: 15px 16px; border-radius: 12px; margin-bottom: 13px;
  background: rgba(232, 238, 252, .045); box-shadow: inset 0 0 0 1px rgba(232, 238, 252, .09);
}
.vx-prez-panel h3 {
  margin: 0 0 4px; font-size: 11px; letter-spacing: 1.8px; text-transform: uppercase; color: #ffd98a;
}
.vx-prez-panel p { margin: 0 0 12px; font-size: 11.5px; line-height: 1.55; color: #8fa0bb; }
.vx-prez-taxrow { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
.vx-prez-taxrow input[type="range"] { flex: 1; min-width: 190px; accent-color: #eda01a; }
.vx-prez-taxval { font-size: 26px; font-weight: 700; color: #ffd98a; min-width: 3.2ch; }
.vx-prez-kitgrid { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.vx-prez-bill { display: flex; flex-direction: column; gap: 5px; font-size: 11px; color: #a9b7cc; }
.vx-prez-billline { display: flex; justify-content: space-between; gap: 16px; }
.vx-prez-billline[data-short="1"] { color: #ff9d8a; }

/* --- treasury ------------------------------------------------------------- */
.vx-prez-vault { display: grid; grid-template-columns: repeat(9, 1fr); gap: 5px; max-width: 470px; }
.vx-prez-ledger { display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 9px; margin-bottom: 14px; }
.vx-prez-led { padding: 12px 13px; border-radius: 10px; background: rgba(232, 238, 252, .05); }
.vx-prez-led b { display: block; font-size: 19px; }
.vx-prez-led small { display: block; margin-top: 3px; font-size: 9px; letter-spacing: 1.2px; text-transform: uppercase; color: #77879f; }

@media (max-width: 720px) {
  .vx-prez-shell { height: 100%; border-radius: 0; }
  .vx-prez-party { grid-template-columns: 1fr; }
  .vx-prez-stage { height: 168px; }
  .vx-prez-vault { grid-template-columns: repeat(5, 1fr); }
}
`;

let styleInjected = false;
function injectStyle(): void {
  if (styleInjected) return;
  styleInjected = true;
  injectGovStyle();
  const el = document.createElement('style');
  el.id = 'vx-prez-style';
  el.textContent = CSS;
  document.head.appendChild(el);
}

type View = 'election' | 'candidacy' | 'admin' | 'treasury';

export interface GovernActions {
  onFoundParty: (name: string, slogan: string, promises: number[]) => void;
  onDisbandParty: () => void;
  onVote: (partyId: string) => void;
  onBroadcast: (text: string) => void;
  onSetTax: (rate: number) => void;
  onFundKits: (count: number) => void;
  onClaimKit: () => void;
}

export interface GovernData {
  state: PoliticsState;
  faction: number;
  username: string;
  /** Your faction's treasury contents (server-sent; empty while unpledged). */
  treasury: (ItemStack | null)[];
  /** Avatars for the party founders who are currently online. */
  cosmeticsOf: (username: string) => Cosmetics | undefined;
  atlasCanvas: HTMLCanvasElement;
  kitClaimed: boolean;
}

/** "3d 4h" / "6h 12m" / "48m" — a term countdown people can read at a glance. */
function untilText(ms: number): string {
  const s = Math.max(0, ms / 1000);
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${Math.max(1, m)}m`;
}

export class PresidentUI {
  private readonly surface: HTMLElement;
  private readonly shell: HTMLElement;
  private readonly crest: HTMLElement;
  private readonly eyebrow: HTMLElement;
  private readonly title: HTMLElement;
  private readonly clockValue: HTMLElement;
  private readonly clockLabel: HTMLElement;
  private readonly tabs: HTMLElement;
  private readonly body: HTMLElement;
  /** The positioned box the body scrolls in and the bust canvas covers. */
  private readonly viewport: HTMLElement;
  private isOpen = false;
  private view: View = 'election';
  private data: GovernData | null = null;
  private actions: GovernActions | null = null;
  /** Draft candidacy, kept across re-renders so an incoming politics sync never
   *  wipes what somebody is halfway through typing. */
  private draft = { name: '', slogan: '', promises: new Set<number>() };
  private draftBroadcast = '';
  private draftTax: number | null = null;
  private draftKits = 5;
  private error = '';
  private clockTimer = 0;

  onOpen?: () => void;
  onClose?: () => void;

  constructor(host: HTMLElement) {
    injectStyle();
    this.surface = document.createElement('div');
    this.surface.className = 'vx-gov-surface vx-prez-surface';
    this.surface.setAttribute('role', 'dialog');
    this.surface.setAttribute('aria-modal', 'true');
    this.surface.setAttribute('aria-label', 'Faction government');
    this.surface.tabIndex = -1;
    this.surface.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); this.hide(); }
    });
    this.surface.addEventListener('mousedown', (e) => {
      if (e.target === this.surface) this.hide();
    });

    this.shell = document.createElement('div');
    this.shell.className = 'vx-prez-shell';

    const head = document.createElement('div');
    head.className = 'vx-prez-head';
    this.crest = document.createElement('div');
    this.crest.className = 'vx-prez-crest';
    this.crest.innerHTML = iconSvg('crown');
    const titles = document.createElement('div');
    titles.className = 'vx-prez-titles';
    this.eyebrow = document.createElement('div');
    this.eyebrow.className = 'vx-gov-eyebrow';
    this.title = document.createElement('h1');
    titles.append(this.eyebrow, this.title);
    const clock = document.createElement('div');
    clock.className = 'vx-prez-clock';
    this.clockValue = document.createElement('b');
    this.clockLabel = document.createElement('small');
    this.clockLabel.textContent = 'Until the vote';
    clock.append(this.clockValue, this.clockLabel);
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'vx-gov-btn';
    close.textContent = 'Close';
    close.addEventListener('click', () => this.hide());
    head.append(this.crest, titles, clock, close);

    this.tabs = document.createElement('div');
    this.tabs.className = 'vx-prez-tabs';
    this.tabs.setAttribute('role', 'tablist');

    // `body` scrolls inside a positioned viewport, and the shared bust canvas is
    // stretched over that same viewport — so a party card scrolled out of view
    // takes its bust with it instead of painting over the tabs. Only `body`'s
    // CHILDREN are replaced; the viewport and the scroller are permanent, which
    // is what stops a re-render from orphaning the renderer's canvas.
    this.viewport = document.createElement('div');
    this.viewport.className = 'vx-gov-viewport';
    const scroll = document.createElement('div');
    scroll.className = 'vx-gov-scroll';
    this.body = document.createElement('div');
    this.body.className = 'vx-prez-body';
    scroll.appendChild(this.body);
    this.viewport.appendChild(scroll);

    this.shell.append(head, this.tabs, this.viewport);
    this.surface.appendChild(this.shell);
    host.appendChild(this.surface);
  }

  get open(): boolean { return this.isOpen; }

  show(data: GovernData, actions: GovernActions, view: View = 'election'): void {
    this.data = data;
    this.actions = actions;
    this.view = view;
    this.error = '';
    if (!this.isOpen) {
      this.isOpen = true;
      this.surface.dataset.open = '1';
      this.onOpen?.();
      // The term countdown is the only thing on this screen that moves on its
      // own, and it only needs to move once a second.
      this.clockTimer = window.setInterval(() => this.renderClock(), 1000);
    }
    bustStage.attach(this.viewport);
    this.render();
    this.surface.focus();
  }

  /** A politics sync arrived while the screen is up. */
  update(data: GovernData): void {
    this.data = data;
    if (this.isOpen) this.render();
  }

  /** The server refused something — shown in place, not as a world toast. */
  setError(reason: string): void {
    this.error = reason;
    if (this.isOpen) this.render();
  }

  hide(): void {
    if (!this.isOpen) return;
    this.isOpen = false;
    delete this.surface.dataset.open;
    window.clearInterval(this.clockTimer);
    hideTip();
    bustStage.release();
    this.onClose?.();
  }

  private setView(view: View): void {
    this.view = view;
    this.error = '';
    this.render();
  }

  private renderClock(): void {
    const data = this.data;
    const e = data && electionOf(data.state, data.faction);
    if (!e) { this.clockValue.textContent = '—'; return; }
    this.clockValue.textContent = untilText(e.endsAt - Date.now());
  }

  private render(): void {
    const data = this.data;
    if (!data) return;
    const e = electionOf(data.state, data.faction);
    const g = governmentOf(data.state, data.faction);
    const side = `#${factionColor(data.faction).toString(16).padStart(6, '0')}`;
    this.shell.style.setProperty('--side', side);

    this.eyebrow.textContent = isFaction(data.faction)
      ? `${factionName(data.faction)} · Term ${e?.cycle ?? 1}` : 'No faction';
    this.title.textContent = e?.president
      ? `President ${e.president}` : 'The seat is vacant';
    this.renderClock();

    // Tabs.
    this.tabs.replaceChildren();
    const views: [View, string][] = [
      ['election', 'Election'], ['candidacy', 'Stand'],
      ['admin', 'Administration'], ['treasury', 'Treasury'],
    ];
    for (const [id, label] of views) {
      const tab = document.createElement('button');
      tab.type = 'button';
      tab.className = 'vx-prez-tab';
      tab.setAttribute('role', 'tab');
      tab.setAttribute('aria-selected', String(this.view === id));
      tab.textContent = label;
      tab.addEventListener('click', () => this.setView(id));
      this.tabs.appendChild(tab);
    }

    this.body.replaceChildren();
    if (!e || !g || !isFaction(data.faction)) {
      const empty = document.createElement('div');
      empty.className = 'vx-prez-empty';
      empty.textContent = 'Swear allegiance to a faction first — press Play and choose a side.';
      this.body.appendChild(empty);
      bustStage.setRoster([]);
      return;
    }

    if (this.error) {
      const err = document.createElement('div');
      err.className = 'vx-prez-note';
      err.textContent = this.error;
      this.body.appendChild(err);
    }

    switch (this.view) {
      case 'election': this.renderElection(data); break;
      case 'candidacy': this.renderCandidacy(data); break;
      case 'admin': this.renderAdmin(data); break;
      case 'treasury': this.renderTreasury(data); break;
    }
  }

  // --- the ballot ------------------------------------------------------------

  private renderElection(data: GovernData): void {
    const e = electionOf(data.state, data.faction)!;
    const counts = voteCounts(e);
    const total = Object.values(counts).reduce((n, v) => n + v, 0);
    const myBallot = ballotOf(e, data.username);

    const note = document.createElement('div');
    note.className = 'vx-prez-note';
    note.textContent = myBallot
      ? 'Your ballot is cast. You can move it to another party any time before the count.'
      : 'One vote each, counted at the end of the term. The winning party’s founder becomes president.';
    this.body.appendChild(note);

    const wrap = document.createElement('div');
    wrap.className = 'vx-prez-parties';
    const busts: BustEntry[] = [];

    if (!e.parties.length) {
      const empty = document.createElement('div');
      empty.className = 'vx-prez-empty';
      empty.textContent = 'Nobody is standing. Open “Stand” and put your own name on the ballot — '
        + 'an unopposed party wins on a single vote.';
      wrap.appendChild(empty);
    }

    e.parties.forEach((party, index) => {
      const card = document.createElement('div');
      card.className = 'vx-prez-party';
      if (party.founder.toLowerCase() === data.username.toLowerCase()) card.dataset.mine = '1';
      if (party.id === e.presidentPartyId) card.dataset.incumbent = '1';

      const stage = document.createElement('div');
      stage.className = 'vx-prez-stage';
      const slot = document.createElement('div');
      slot.className = 'vx-prez-slot';
      stage.appendChild(slot);
      if (party.id === e.presidentPartyId) {
        const sash = document.createElement('div');
        sash.className = 'vx-prez-sash';
        sash.textContent = 'In office';
        stage.appendChild(sash);
      }
      const key = `prez:${party.id}`;
      busts.push({
        key,
        cosmetics: data.cosmeticsOf(party.founder) ?? defaultCosmetics(skinSeed(party.founder)),
        slot,
        pose: BUST_POSES[index % BUST_POSES.length],
      });
      stage.addEventListener('mouseenter', () => bustStage.setHover(key));
      stage.addEventListener('mouseleave', () => bustStage.setHover(null));

      const info = document.createElement('div');
      info.className = 'vx-prez-info';
      const pname = document.createElement('div');
      pname.className = 'vx-prez-pname';
      pname.textContent = party.name;
      const founder = document.createElement('div');
      founder.className = 'vx-prez-founder';
      founder.textContent = party.founder;
      const slogan = document.createElement('div');
      slogan.className = 'vx-prez-slogan';
      slogan.textContent = `“${party.slogan}”`;
      info.append(pname, founder, slogan);

      if (party.promises.length) {
        const list = document.createElement('div');
        list.className = 'vx-prez-plist';
        for (const i of party.promises) {
          const line = document.createElement('div');
          line.className = 'vx-prez-pline';
          const tick = document.createElement('span');
          tick.innerHTML = iconSvg('check');
          const text = document.createElement('span');
          text.textContent = PRESET_PROMISES[i] ?? '';
          line.append(tick, text);
          list.appendChild(line);
        }
        info.appendChild(list);
      }

      const votes = counts[party.id] ?? 0;
      const bar = document.createElement('div');
      bar.className = 'vx-prez-bar';
      const fill = document.createElement('i');
      fill.style.width = `${total > 0 ? Math.round(votes / total * 100) : 0}%`;
      bar.appendChild(fill);

      const tally = document.createElement('div');
      tally.className = 'vx-prez-tally';
      const label = document.createElement('span');
      label.className = 'vx-prez-votes';
      label.textContent = `${votes} vote${votes === 1 ? '' : 's'}`
        + (total > 0 ? ` · ${Math.round(votes / total * 100)}%` : '');
      const actions = document.createElement('div');
      actions.className = 'vx-prez-actions';
      const vote = document.createElement('button');
      vote.type = 'button';
      vote.className = 'vx-gov-btn';
      const isMine = myBallot === party.id;
      if (!isMine) vote.dataset.kind = 'primary';
      vote.textContent = isMine ? 'Your vote' : myBallot ? 'Switch to this' : 'Vote';
      vote.disabled = isMine;
      vote.addEventListener('click', () => this.actions?.onVote(party.id));
      actions.appendChild(vote);
      tally.append(label, actions);

      info.append(bar, tally);
      card.append(stage, info);
      wrap.appendChild(card);
    });

    this.body.appendChild(wrap);
    // Slots must be in the document before the board measures their boxes.
    bustStage.setRoster(busts);
  }

  // --- standing for office ---------------------------------------------------

  private renderCandidacy(data: GovernData): void {
    bustStage.setRoster([]);
    const e = electionOf(data.state, data.faction)!;
    const mine = partyOfFounder(e, data.username);

    if (mine) {
      const note = document.createElement('div');
      note.className = 'vx-prez-note';
      const strong = document.createElement('b');
      strong.textContent = mine.name;
      note.append('You lead ', strong, `. “${mine.slogan}”. `,
        'One party per citizen — withdraw this one if you want to stand on something else. '
        + 'Any votes cast for it are released, not lost.');
      const row = document.createElement('div');
      row.className = 'vx-prez-row';
      row.style.marginTop = '12px';
      const disband = document.createElement('button');
      disband.type = 'button';
      disband.className = 'vx-gov-btn';
      disband.dataset.kind = 'danger';
      disband.textContent = 'Withdraw my party';
      disband.addEventListener('click', () => this.actions?.onDisbandParty());
      row.appendChild(disband);
      this.body.append(note, row);
      return;
    }

    const form = document.createElement('div');
    form.className = 'vx-prez-form';

    const nameField = document.createElement('div');
    nameField.className = 'vx-prez-field';
    const nameLabel = document.createElement('label');
    const nameLabelText = document.createElement('span');
    nameLabelText.textContent = `Up to ${MAX_PARTY_NAME} characters`;
    nameLabel.append('Party name', nameLabelText);
    const nameInput = document.createElement('input');
    nameInput.className = 'vx-prez-input';
    nameInput.maxLength = MAX_PARTY_NAME;
    nameInput.placeholder = 'The Miners’ Union';
    nameInput.value = this.draft.name;
    nameInput.addEventListener('input', () => { this.draft.name = nameInput.value; });
    nameField.append(nameLabel, nameInput);

    const sloganField = document.createElement('div');
    sloganField.className = 'vx-prez-field';
    const sloganLabel = document.createElement('label');
    const sloganLabelText = document.createElement('span');
    sloganLabelText.textContent = `Up to ${MAX_SLOGAN} characters`;
    sloganLabel.append('Slogan', sloganLabelText);
    const sloganInput = document.createElement('input');
    sloganInput.className = 'vx-prez-input';
    sloganInput.maxLength = MAX_SLOGAN;
    sloganInput.placeholder = 'Low tax, deep tunnels, no surprises.';
    sloganInput.value = this.draft.slogan;
    sloganInput.addEventListener('input', () => { this.draft.slogan = sloganInput.value; });
    sloganField.append(sloganLabel, sloganInput);

    const pickField = document.createElement('div');
    pickField.className = 'vx-prez-field';
    const pickLabel = document.createElement('label');
    const pickCount = document.createElement('span');
    const refreshCount = (): void => {
      pickCount.textContent = `${this.draft.promises.size} of ${MAX_PROMISES} chosen`;
    };
    pickLabel.append('Campaign promises', pickCount);
    const picks = document.createElement('div');
    picks.className = 'vx-prez-picks';
    const refreshPicks = (): void => {
      const full = this.draft.promises.size >= MAX_PROMISES;
      for (const [i, row] of [...picks.children].entries()) {
        const el = row as HTMLElement;
        const on = this.draft.promises.has(i);
        el.dataset.on = on ? '1' : '0';
        el.dataset.full = full ? '1' : '0';
        (el.querySelector('input') as HTMLInputElement).checked = on;
      }
      refreshCount();
    };
    PRESET_PROMISES.forEach((text, i) => {
      const row = document.createElement('label');
      row.className = 'vx-prez-pick';
      const box = document.createElement('input');
      box.type = 'checkbox';
      const copy = document.createElement('span');
      copy.textContent = text;
      row.append(box, copy);
      box.addEventListener('change', () => {
        if (this.draft.promises.has(i)) this.draft.promises.delete(i);
        // The cap is enforced here rather than by silently dropping extras on
        // submit — you always see exactly what you are running on.
        else if (this.draft.promises.size < MAX_PROMISES) this.draft.promises.add(i);
        refreshPicks();
      });
      picks.appendChild(row);
    });
    pickField.append(pickLabel, picks);
    refreshPicks();

    const err = document.createElement('div');
    err.className = 'vx-prez-err';

    const row = document.createElement('div');
    row.className = 'vx-prez-row';
    const submit = document.createElement('button');
    submit.type = 'button';
    submit.className = 'vx-gov-btn';
    submit.dataset.kind = 'primary';
    submit.textContent = 'Put me on the ballot';
    submit.addEventListener('click', () => {
      const name = this.draft.name.trim(), slogan = this.draft.slogan.trim();
      if (name.length < 3) { err.textContent = 'A party name needs at least 3 characters.'; return; }
      if (slogan.length < 3) { err.textContent = 'Give your party a slogan.'; return; }
      if (!this.draft.promises.size) { err.textContent = 'Pick at least one campaign promise.'; return; }
      err.textContent = '';
      this.actions?.onFoundParty(name, slogan, [...this.draft.promises]);
    });
    row.appendChild(submit);

    form.append(nameField, sloganField, pickField, err, row);
    this.body.appendChild(form);
  }

  // --- the powers of office --------------------------------------------------

  private renderAdmin(data: GovernData): void {
    bustStage.setRoster([]);
    const g = governmentOf(data.state, data.faction)!;
    const inOffice = isPresident(data.state, data.faction, data.username);

    const note = document.createElement('div');
    note.className = 'vx-prez-note';
    note.textContent = inOffice
      ? 'You hold the office. Everything here takes effect for the whole faction the moment you set it.'
      : 'Only the sitting president can change these. This is what they have set.';
    this.body.appendChild(note);

    // Tax.
    const taxPanel = document.createElement('div');
    taxPanel.className = 'vx-prez-panel';
    const taxHead = document.createElement('h3');
    taxHead.textContent = 'The levy';
    const taxCopy = document.createElement('p');
    taxCopy.textContent = 'A share of everything your citizens mine, farm from machines and haul '
      + 'out of vaults goes to the treasury. The treasury is the only thing that pays for recruit kits.';
    const taxRow = document.createElement('div');
    taxRow.className = 'vx-prez-taxrow';
    const value = document.createElement('div');
    value.className = 'vx-prez-taxval';
    const shown = this.draftTax ?? g.taxRate;
    value.textContent = `${Math.round(shown * 100)}%`;
    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = '0';
    slider.max = String(Math.round(MAX_TAX * 100));
    slider.step = '1';
    slider.value = String(Math.round(shown * 100));
    slider.disabled = !inOffice;
    slider.addEventListener('input', () => {
      this.draftTax = Number(slider.value) / 100;
      value.textContent = `${slider.value}%`;
      apply.disabled = !inOffice || this.draftTax === g.taxRate;
    });
    const apply = document.createElement('button');
    apply.type = 'button';
    apply.className = 'vx-gov-btn';
    apply.dataset.kind = 'primary';
    apply.textContent = 'Set the rate';
    apply.disabled = !inOffice || (this.draftTax ?? g.taxRate) === g.taxRate;
    apply.addEventListener('click', () => {
      this.actions?.onSetTax(this.draftTax ?? g.taxRate);
      this.draftTax = null;
    });
    taxRow.append(value, slider, apply);
    taxPanel.append(taxHead, taxCopy, taxRow);
    this.body.appendChild(taxPanel);

    // Broadcast.
    const castPanel = document.createElement('div');
    castPanel.className = 'vx-prez-panel';
    const castHead = document.createElement('h3');
    castHead.textContent = 'Address the faction';
    const castCopy = document.createElement('p');
    castCopy.textContent = 'Lands in every citizen’s dispatch inbox, including anyone who is '
      + 'offline right now — they will read it next time they log in.';
    const area = document.createElement('textarea');
    area.className = 'vx-prez-area';
    area.maxLength = MAX_BROADCAST;
    area.placeholder = 'Muster at the flag at sundown. Bring cobalt.';
    area.disabled = !inOffice;
    area.value = this.draftBroadcast;
    area.addEventListener('input', () => {
      this.draftBroadcast = area.value;
      send.disabled = !inOffice || area.value.trim().length < 2;
      remaining.textContent = `${MAX_BROADCAST - area.value.length} left`;
    });
    const castRow = document.createElement('div');
    castRow.className = 'vx-prez-row';
    const send = document.createElement('button');
    send.type = 'button';
    send.className = 'vx-gov-btn';
    send.dataset.kind = 'primary';
    send.textContent = 'Broadcast';
    send.disabled = !inOffice || area.value.trim().length < 2;
    send.addEventListener('click', () => {
      this.actions?.onBroadcast(area.value.trim());
      this.draftBroadcast = '';
      area.value = '';
      send.disabled = true;
    });
    const remaining = document.createElement('span');
    remaining.className = 'vx-prez-votes';
    remaining.textContent = `${MAX_BROADCAST - area.value.length} left`;
    castRow.append(send, remaining);
    castPanel.append(castHead, castCopy, area, castRow);
    this.body.appendChild(castPanel);

    // Kits.
    const kitPanel = document.createElement('div');
    kitPanel.className = 'vx-prez-panel';
    const kitHead = document.createElement('h3');
    kitHead.textContent = 'Recruit kits';
    const kitCopy = document.createElement('p');
    kitCopy.textContent = 'Paid for out of the treasury. Every new citizen can claim exactly one, '
      + 'ever — so a well-funded faction is one that new players actually want to join.';
    const kitRow = document.createElement('div');
    kitRow.className = 'vx-prez-kitgrid';

    const stock = document.createElement('div');
    stock.className = 'vx-prez-led';
    const stockValue = document.createElement('b');
    stockValue.textContent = String(g.kitStock);
    const stockLabel = document.createElement('small');
    stockLabel.textContent = 'Kits waiting';
    stock.append(stockValue, stockLabel);

    const contents = document.createElement('div');
    contents.className = 'vx-gov-chips';
    for (const line of STARTER_KIT) {
      contents.appendChild(itemChip(data.atlasCanvas, { id: line.id, count: line.count }));
    }

    kitRow.append(stock, contents);
    kitPanel.append(kitHead, kitCopy, kitRow);

    if (inOffice) {
      const fundRow = document.createElement('div');
      fundRow.className = 'vx-prez-row';
      fundRow.style.marginTop = '13px';
      const count = document.createElement('input');
      count.type = 'number';
      count.className = 'vx-prez-input';
      count.style.width = '96px';
      count.min = '1';
      count.max = '100';
      count.value = String(this.draftKits);
      const bill = document.createElement('div');
      bill.className = 'vx-prez-bill';
      const fund = document.createElement('button');
      fund.type = 'button';
      fund.className = 'vx-gov-btn';
      fund.dataset.kind = 'primary';
      fund.textContent = 'Fund from the treasury';
      // The bill is recomputed live against what the treasury actually holds,
      // so "cannot afford" is visible BEFORE the server refuses it.
      const held = new Map<number, number>();
      for (const slot of data.treasury) {
        if (slot) held.set(slot.id, (held.get(slot.id) ?? 0) + slot.count);
      }
      const refreshBill = (): void => {
        const n = Math.max(1, Math.min(100, Math.floor(Number(count.value) || 1)));
        this.draftKits = n;
        bill.replaceChildren();
        let affordable = true;
        for (const line of kitCost()) {
          const need = line.count * n, have = held.get(line.id) ?? 0;
          const row = document.createElement('div');
          row.className = 'vx-prez-billline';
          if (have < need) { row.dataset.short = '1'; affordable = false; }
          const label = document.createElement('span');
          label.textContent = ITEMS[line.id]?.name ?? `#${line.id}`;
          const amount = document.createElement('span');
          amount.textContent = `${have} / ${need}`;
          row.append(label, amount);
          bill.appendChild(row);
        }
        fund.disabled = !affordable;
      };
      count.addEventListener('input', refreshBill);
      refreshBill();
      fund.addEventListener('click', () => this.actions?.onFundKits(this.draftKits));
      fundRow.append(count, fund, bill);
      kitPanel.appendChild(fundRow);
    } else if (g.kitStock > 0 && !data.kitClaimed) {
      const claimRow = document.createElement('div');
      claimRow.className = 'vx-prez-row';
      claimRow.style.marginTop = '13px';
      const claim = document.createElement('button');
      claim.type = 'button';
      claim.className = 'vx-gov-btn';
      claim.dataset.kind = 'primary';
      claim.textContent = 'Claim my recruit kit';
      claim.addEventListener('click', () => this.actions?.onClaimKit());
      claimRow.appendChild(claim);
      kitPanel.appendChild(claimRow);
    }
    this.body.appendChild(kitPanel);
  }

  // --- the strongbox ---------------------------------------------------------

  private renderTreasury(data: GovernData): void {
    bustStage.setRoster([]);
    const g = governmentOf(data.state, data.faction)!;
    const held = data.treasury.reduce((n, s) => n + (s?.count ?? 0), 0);

    const note = document.createElement('div');
    note.className = 'vx-prez-note';
    note.textContent = 'The strongbox stands beside your flag. While a war window is open the enemy '
      + 'can force it and haul stacks out, so what is banked here is worth defending.';
    this.body.appendChild(note);

    const ledger = document.createElement('div');
    ledger.className = 'vx-prez-ledger';
    const cells: [string, string][] = [
      [String(held), 'Items held'],
      [`${Math.round(g.taxRate * 100)}%`, 'Current levy'],
      [String(g.kitStock), 'Kits funded'],
    ];
    for (const [value, label] of cells) {
      const led = document.createElement('div');
      led.className = 'vx-prez-led';
      const b = document.createElement('b');
      b.textContent = value;
      const small = document.createElement('small');
      small.textContent = label;
      led.append(b, small);
      ledger.appendChild(led);
    }
    this.body.appendChild(ledger);

    const vault = document.createElement('div');
    vault.className = 'vx-prez-vault';
    for (let i = 0; i < Math.max(27, data.treasury.length); i++) {
      vault.appendChild(itemChip(data.atlasCanvas, data.treasury[i] ?? null, 'Empty'));
    }
    this.body.appendChild(vault);

    if (!held) {
      const empty = document.createElement('div');
      empty.className = 'vx-prez-empty';
      empty.style.marginTop = '14px';
      empty.textContent = g.taxRate > 0
        ? 'Empty for now. It fills as your citizens mine — every levy lands here.'
        : 'Empty, and the levy is at 0%. Nothing will arrive until a president sets a rate.';
      this.body.appendChild(empty);
    }
  }
}

/** Which tab a caller wants opened — exported so main.ts can name it. */
export type PresidentView = View;
