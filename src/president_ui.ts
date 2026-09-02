// THE PRESIDENTIAL CHAMBER
//
// Opened with /president, /party or /politics. Three rooms:
//
// 1. Ballot — the term clock, the sitting president on a plinth with the levers
//    of their office, and every registered party with its 3D candidate bust,
//    promises and live vote share.
// 2. Found a party — a podium preview of your own avatar beside the
//    registration form, moderated as you type.
// 3. Oval office — broadcast, tax rate and recruit-kit funding. President only.
//
// Party names, slogans, promises and usernames are player-authored: everything
// interpolated below is escaped, and free text prefers a text node.

import { AvatarBustBoard, BUST_POSES, type BustEntry } from './avatar_bust';
import { defaultCosmetics } from './character';
import { validateText } from './content_filter';
import { escapeHtml, iconSvg } from './emoji_icons';
import { ITEMS } from './items';
import {
  formatTermRemaining, MAX_PARTIES_PER_FACTION, MAX_PROMISES, MAX_TAX_RATE,
  PRESET_PROMISES,
  type ElectionState, type FactionGovernment, type PoliticsState,
} from './politics';
import { skinSeed } from './net/protocol';
import { factionName, isFaction } from './teams';

export interface PresidentUIActions {
  onCreateParty: (name: string, slogan: string, promises: string[]) => void;
  onVote: (partyId: string) => void;
  onBroadcast: (text: string) => void;
  onSetTaxRate: (rate: number) => void;
  onAllocateKits: (amount: number) => void;
}

type Tab = 'ballot' | 'found' | 'oval';

const NAME_MIN = 3, NAME_MAX = 28;
const SLOGAN_MIN = 3, SLOGAN_MAX = 64;
const BROADCAST_MIN = 3, BROADCAST_MAX = 140;

/** Faction accent as a CSS colour, driving --faction across the chamber.
 *  teams.factionColor() returns a THREE hex NUMBER, which is not valid CSS —
 *  interpolating it straight into a style attribute silently painted nothing. */
const FACTION_CSS = ['#ff4d55', '#4d9bff'];
function factionCss(id: number): string {
  return FACTION_CSS[id] ?? '#ffc043';
}

export class PresidentUI {
  private surface: HTMLElement;
  private shell: HTMLElement;
  private headEl: HTMLElement;
  private tabsEl: HTMLElement;
  private bodyEl: HTMLElement;
  /** Persistent WebGL host, outside the rebuilt body (see FactionPicker). */
  private bustHost: HTMLElement;
  private bustBoard: AvatarBustBoard | null = null;
  private activeTab: Tab = 'ballot';
  private isOpen = false;
  private frame = 0;
  private lastTime = 0;

  private politicsState: PoliticsState | null = null;
  private faction = 0;
  private username = '';
  private actions?: PresidentUIActions;
  /** Draft kept across re-renders so a politics push mid-sentence cannot wipe
   *  what the player is typing. */
  private draft = { name: '', slogan: '', promises: [] as string[], seeded: false };

  constructor(rootContainer: HTMLElement) {
    this.surface = document.createElement('div');
    this.surface.className = 'gov-surface';
    this.surface.setAttribute('role', 'dialog');
    this.surface.setAttribute('aria-modal', 'true');
    this.surface.setAttribute('aria-label', 'Presidential chamber');

    this.bustHost = document.createElement('div');
    this.bustHost.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:2';

    this.shell = document.createElement('div');
    this.shell.className = 'gov-shell president-shell';

    this.headEl = document.createElement('div');
    this.headEl.className = 'gov-head';
    this.tabsEl = document.createElement('div');
    this.tabsEl.className = 'gov-tabs';
    this.tabsEl.setAttribute('role', 'tablist');
    this.bodyEl = document.createElement('div');
    this.bodyEl.className = 'gov-body';

    this.shell.append(this.headEl, this.tabsEl, this.bodyEl);
    this.surface.append(this.bustHost, this.shell);
    rootContainer.appendChild(this.surface);

    this.surface.addEventListener('click', (e) => {
      if (e.target === this.surface) this.hide();
    });
    this.surface.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.hide(); }
    });
    this.tabsEl.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('.gov-tab');
      if (!btn || btn.disabled) return;
      this.activeTab = (btn.dataset.tab as Tab) ?? 'ballot';
      this.render();
    });

    this.animate = this.animate.bind(this);
  }

  get open(): boolean { return this.isOpen; }

  show(
    politics: PoliticsState,
    faction: number,
    username: string,
    actions: PresidentUIActions,
  ): void {
    this.politicsState = politics;
    this.faction = faction;
    this.username = username;
    this.actions = actions;
    this.isOpen = true;
    this.render();
    this.surface.classList.add('open');
    this.surface.tabIndex = -1;
    this.surface.focus({ preventScroll: true });
    this.lastTime = 0;
    if (!this.frame) this.frame = requestAnimationFrame(this.animate);
  }

  updateState(politics: PoliticsState): void {
    this.politicsState = politics;
    if (!this.isOpen) return;
    this.captureDraft();
    this.render();
  }

  hide(): void {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.captureDraft();
    this.surface.classList.remove('open');
    this.bustBoard?.setHover(null);
    if (this.frame) { cancelAnimationFrame(this.frame); this.frame = 0; }
  }

  private animate(now: number): void {
    if (!this.isOpen) { this.frame = 0; return; }
    this.frame = requestAnimationFrame(this.animate);
    if (!this.bustBoard) return;
    const dt = this.lastTime ? Math.min(0.1, (now - this.lastTime) / 1000) : 0.016;
    this.lastTime = now;
    this.bustBoard.render(dt);
  }

  /** Pull the founding form's current values out of the DOM before it is torn
   *  down, so a re-render restores them. */
  private captureDraft(): void {
    const name = this.bodyEl.querySelector<HTMLInputElement>('.js-party-name');
    const slogan = this.bodyEl.querySelector<HTMLInputElement>('.js-party-slogan');
    if (!name && !slogan) return;
    if (name) this.draft.name = name.value;
    if (slogan) this.draft.slogan = slogan.value;
    this.draft.promises = [...this.bodyEl.querySelectorAll<HTMLInputElement>(
      '.promise-option input:checked')].map((c) => c.value);
    this.draft.seeded = true;
  }

  private render(): void {
    const state = this.politicsState;
    if (!state) return;

    const election = state.elections[this.faction];
    const gov = state.governments[this.faction];
    const isPresident = !!election?.activePresident &&
      election.activePresident.toLowerCase() === this.username.toLowerCase();

    // One property paints the whole chamber in the player's own colours.
    this.surface.style.setProperty('--faction', factionCss(this.faction));

    if (!this.bustBoard) {
      try {
        this.bustBoard = new AvatarBustBoard();
        this.bustBoard.mount(this.bustHost);
      } catch {
        this.bustBoard = null;
      }
    }

    // The Oval Office is not a room you can stand in without the office.
    if (this.activeTab === 'oval' && !isPresident && !election) this.activeTab = 'ballot';

    this.renderHead(election);
    this.renderTabs(isPresident);

    this.bodyEl.replaceChildren();
    const busts: BustEntry[] = [];

    if (!election || !gov) {
      // No government for this faction — most often "you haven't picked a side".
      this.bodyEl.appendChild(emptyState(
        'blocked', 'No faction government',
        isFaction(this.faction)
          ? 'This faction has no election on record yet. Try again in a moment.'
          : 'Swear allegiance to a faction before entering the chamber.'));
    } else if (this.activeTab === 'ballot') {
      this.renderBallot(election, gov, busts);
    } else if (this.activeTab === 'found') {
      this.renderFound(election, busts);
    } else {
      this.renderOval(election, gov, isPresident);
    }

    this.bustBoard?.setRoster(busts);
  }

  private renderHead(election: ElectionState | undefined): void {
    this.headEl.innerHTML = `
      <div class="gov-head-titles">
        <div class="gov-emblem">${iconSvg('crown')}</div>
        <div>
          <div class="gov-kicker">${escapeHtml(factionName(this.faction))} · Governance</div>
          <h2 class="gov-title">Presidential Chamber</h2>
          <div class="gov-sub">
            ${iconSvg('hourglass')}
            <span>Term ends in <b>${escapeHtml(
              election ? formatTermRemaining(election.termEndsAt) : '—')}</b></span>
          </div>
        </div>
      </div>
      <div class="gov-head-actions">
        <button type="button" class="gov-close js-close" aria-label="Close (Esc)" title="Close (Esc)">✕</button>
      </div>
    `;
    this.headEl.querySelector('.js-close')?.addEventListener('click', () => this.hide());
  }

  private renderTabs(isPresident: boolean): void {
    const tabs: { id: Tab; label: string; icon: string; locked?: boolean }[] = [
      { id: 'ballot', label: 'Ballot', icon: 'swords' },
      { id: 'found', label: 'Found a Party', icon: 'flag' },
      { id: 'oval', label: 'Oval Office', icon: 'crown', locked: !isPresident },
    ];
    this.tabsEl.innerHTML = tabs.map((t) => `
      <button type="button" class="gov-tab" role="tab" data-tab="${t.id}"
              aria-selected="${this.activeTab === t.id}">
        ${iconSvg(t.icon as Parameters<typeof iconSvg>[0])}<span>${t.label}</span>
        ${t.locked ? `<span class="gov-tab-lock">${iconSvg('lock')}</span>` : ''}
      </button>
    `).join('');
  }

  // --- Ballot ---------------------------------------------------------------
  private renderBallot(
    election: ElectionState,
    gov: FactionGovernment,
    busts: BustEntry[],
  ): void {
    // Incumbent banner.
    const banner = document.createElement('div');
    banner.className = 'incumbent';

    const podium = document.createElement('div');
    podium.className = 'gov-podium incumbent-podium';
    const slot = document.createElement('div');
    slot.className = 'gov-podium-slot';
    podium.appendChild(slot);

    const presName = election.activePresident;
    const presKey = 'pres_incumbent';
    busts.push({
      key: presKey,
      cosmetics: election.presidentCosmetics ?? defaultCosmetics(skinSeed(presName || 'president')),
      slot,
      pose: 'salute',
    });

    const details = document.createElement('div');
    details.className = 'incumbent-details';
    details.innerHTML = presName
      ? `
        <div class="gov-role-tag">${iconSvg('crown')} Sitting President</div>
        <div class="incumbent-name">${escapeHtml(presName)}</div>
        <div class="gov-leader-party">${escapeHtml(election.presidentPartyName || 'Independent')}</div>
        <div class="gov-leader-slogan">“${escapeHtml(election.presidentSlogan || 'For faction honour')}”</div>
        <div class="incumbent-levers">
          <span class="lever-chip">${iconSvg('coinbag')} Tax <b>${Math.round(gov.taxRate * 100)}%</b></span>
          <span class="lever-chip">${iconSvg('backpack')} Kits <b>${gov.kitStock}</b></span>
        </div>
      `
      : `
        <div class="gov-role-tag vacant">${iconSvg('statue')} Podium vacant</div>
        <div class="incumbent-name">No president in office</div>
        <div class="gov-leader-note">
          The faction has no elected executive. Cast a ballot below, or found a
          party and stand for the office yourself.
        </div>
      `;

    banner.append(podium, details);
    banner.addEventListener('pointerenter', () => this.bustBoard?.setHover(presKey));
    banner.addEventListener('pointerleave', () => this.bustBoard?.setHover(null));
    this.bodyEl.appendChild(banner);

    // Candidates.
    const heading = document.createElement('h3');
    heading.className = 'gov-section-head';
    heading.innerHTML = `
      ${iconSvg('swords')}<span>Candidates</span>
      <span class="gov-count-chip">${election.parties.length} / ${MAX_PARTIES_PER_FACTION}</span>
    `;
    this.bodyEl.appendChild(heading);

    if (election.parties.length === 0) {
      const empty = emptyState('flag', 'The ballot is empty',
        'No party has registered for this cycle yet. Whoever stands first, stands unopposed.');
      const cta = document.createElement('button');
      cta.type = 'button';
      cta.className = 'gov-btn primary';
      cta.innerHTML = `<span>Found the first party</span>${iconSvg('arrowRight')}`;
      cta.addEventListener('click', () => { this.activeTab = 'found'; this.render(); });
      empty.appendChild(cta);
      this.bodyEl.appendChild(empty);
      return;
    }

    const totalVotes = election.parties.reduce((sum, p) => sum + p.votes, 0);
    const topVotes = election.parties.reduce((m, p) => Math.max(m, p.votes), 0);
    const uLower = this.username.toLowerCase();
    const myVote = election.parties.find((p) => p.voters.includes(uLower));

    const grid = document.createElement('div');
    grid.className = 'ballot-grid';

    election.parties.forEach((party, index) => {
      const key = `party_${party.id}`;
      const card = document.createElement('div');
      card.className = 'ballot-card';
      if (myVote?.id === party.id) card.classList.add('mine');
      // Only badge a leader once somebody has actually voted.
      if (topVotes > 0 && party.votes === topVotes) card.classList.add('leading');

      const cPodium = document.createElement('div');
      cPodium.className = 'gov-podium ballot-podium';
      const cSlot = document.createElement('div');
      cSlot.className = 'gov-podium-slot';
      cPodium.appendChild(cSlot);

      busts.push({
        key,
        cosmetics: party.cosmetics,
        slot: cSlot,
        pose: BUST_POSES[index % BUST_POSES.length],
      });

      const share = totalVotes > 0 ? Math.round((party.votes / totalVotes) * 100) : 0;
      const info = document.createElement('div');
      info.innerHTML = `
        <div class="ballot-name">${escapeHtml(party.name)}</div>
        <div class="ballot-leader">Standing: <b>${escapeHtml(party.leader)}</b></div>
        <div class="ballot-slogan">“${escapeHtml(party.slogan)}”</div>
        ${party.promises.length ? `<div class="ballot-promises">${party.promises
          .map((p) => `<span class="promise-chip">${escapeHtml(p)}</span>`).join('')}</div>` : ''}
      `;

      const tally = document.createElement('div');
      tally.className = 'ballot-tally';
      tally.innerHTML = `
        <div class="tally-track">
          <div class="tally-fill" style="width:${share}%"></div>
        </div>
        <div class="tally-label"><span><b>${party.votes}</b> votes</span><span>${share}%</span></div>
      `;

      const voteBtn = document.createElement('button');
      voteBtn.type = 'button';
      if (myVote?.id === party.id) {
        voteBtn.className = 'gov-btn cast';
        voteBtn.innerHTML = `${iconSvg('check')}<span>Your vote</span>`;
        voteBtn.disabled = true;
      } else if (myVote) {
        voteBtn.className = 'gov-btn';
        voteBtn.textContent = 'Ballot already cast';
        voteBtn.disabled = true;
      } else {
        voteBtn.className = 'gov-btn primary';
        voteBtn.textContent = 'Cast your vote';
        voteBtn.addEventListener('click', () => this.actions?.onVote(party.id));
      }

      card.append(cPodium, info, tally, voteBtn);
      card.addEventListener('pointerenter', () => this.bustBoard?.setHover(key));
      card.addEventListener('pointerleave', () => this.bustBoard?.setHover(null));
      grid.appendChild(card);
    });

    this.bodyEl.appendChild(grid);
  }

  // --- Found a party --------------------------------------------------------
  private renderFound(election: ElectionState, busts: BustEntry[]): void {
    const mine = election.parties.find(
      (p) => p.leader.toLowerCase() === this.username.toLowerCase());

    if (mine) {
      const done = emptyState('check', 'Your candidacy is live',
        'Citizens of your faction can find you on the ballot and vote for you.');
      const named = document.createElement('div');
      named.className = 'gov-alert ok';
      named.innerHTML = `${iconSvg('flag')}<span>Standing as <b>${escapeHtml(mine.name)}</b> — “${
        escapeHtml(mine.slogan)}”</span>`;
      done.appendChild(named);
      this.bodyEl.appendChild(done);
      return;
    }

    if (election.parties.length >= MAX_PARTIES_PER_FACTION) {
      this.bodyEl.appendChild(emptyState('blocked', 'The ballot is full',
        `This cycle has reached its ${MAX_PARTIES_PER_FACTION}-party limit. The next term opens a fresh ballot.`));
      return;
    }

    const layout = document.createElement('div');
    layout.className = 'found-layout';

    // Podium preview of the player's own avatar.
    const preview = document.createElement('div');
    preview.className = 'found-preview';
    preview.innerHTML = `
      <div class="gov-podium"><div class="gov-podium-slot"></div></div>
      <div>
        <div class="found-preview-name">${escapeHtml(this.username || 'Citizen')}</div>
        <div class="found-preview-note">Your bust takes the podium on every ballot card.</div>
      </div>
    `;
    const previewKey = 'my_candidate';
    busts.push({
      key: previewKey,
      cosmetics: defaultCosmetics(skinSeed(this.username)),
      slot: preview.querySelector('.gov-podium-slot') as HTMLElement,
      pose: 'flex',
    });
    preview.addEventListener('pointerenter', () => this.bustBoard?.setHover(previewKey));
    preview.addEventListener('pointerleave', () => this.bustBoard?.setHover(null));

    // Registration form.
    const form = document.createElement('div');
    form.className = 'found-form';
    // First visit picks a sensible pair of promises; after that the player's
    // own selection survives every re-render.
    if (!this.draft.seeded) {
      this.draft.promises = PRESET_PROMISES.slice(0, 2).map(String);
      this.draft.seeded = true;
    }
    form.innerHTML = `
      <div class="field">
        <div class="field-head">
          <label class="field-label" for="gov-party-name">Party name</label>
          <span class="field-counter js-name-count">0/${NAME_MAX}</span>
        </div>
        <input id="gov-party-name" type="text" class="gov-input js-party-name"
               maxlength="${NAME_MAX}" autocomplete="off" spellcheck="false"
               placeholder="Iron Vanguard" />
        <div class="field-hint">${NAME_MIN}–${NAME_MAX} characters. Real countries,
          real-world politics and slurs are rejected.</div>
      </div>

      <div class="field">
        <div class="field-head">
          <label class="field-label" for="gov-party-slogan">Campaign slogan</label>
          <span class="field-counter js-slogan-count">0/${SLOGAN_MAX}</span>
        </div>
        <input id="gov-party-slogan" type="text" class="gov-input js-party-slogan"
               maxlength="${SLOGAN_MAX}" autocomplete="off"
               placeholder="Defend every block" />
        <div class="field-hint">The motto voters see beside your bust.</div>
      </div>

      <div class="field">
        <div class="field-head">
          <span class="field-label">Campaign promises</span>
          <span class="field-counter js-promise-count">0/${MAX_PROMISES}</span>
        </div>
        <div class="promise-picker">
          ${PRESET_PROMISES.map((p, i) => `
            <label class="promise-option">
              <input type="checkbox" value="${escapeHtml(p)}" data-idx="${i}" />
              <span>${escapeHtml(p)}</span>
            </label>
          `).join('')}
        </div>
      </div>

      <div class="gov-alert error js-error" hidden></div>
      <button type="button" class="gov-btn primary js-submit">
        <span>Register candidacy</span>${iconSvg('arrowRight')}
      </button>
    `;

    const nameInput = form.querySelector('.js-party-name') as HTMLInputElement;
    const sloganInput = form.querySelector('.js-party-slogan') as HTMLInputElement;
    const nameCount = form.querySelector('.js-name-count') as HTMLElement;
    const sloganCount = form.querySelector('.js-slogan-count') as HTMLElement;
    const promiseCount = form.querySelector('.js-promise-count') as HTMLElement;
    const errEl = form.querySelector('.js-error') as HTMLElement;
    const submit = form.querySelector('.js-submit') as HTMLButtonElement;
    const boxes = [...form.querySelectorAll<HTMLInputElement>('.promise-option input')];

    // Restore the in-flight draft.
    nameInput.value = this.draft.name;
    sloganInput.value = this.draft.slogan;
    for (const b of boxes) b.checked = this.draft.promises.includes(b.value);

    const showError = (msg: string | null): void => {
      if (!msg) { errEl.hidden = true; return; }
      errEl.replaceChildren();
      errEl.insertAdjacentHTML('beforeend', iconSvg('warning'));
      const span = document.createElement('span');
      span.textContent = msg;
      errEl.appendChild(span);
      errEl.hidden = false;
    };

    const syncPromises = (): void => {
      const picked = boxes.filter((b) => b.checked);
      promiseCount.textContent = `${picked.length}/${MAX_PROMISES}`;
      // Enforce the cap in the UI rather than silently truncating on submit.
      for (const b of boxes) b.disabled = !b.checked && picked.length >= MAX_PROMISES;
    };

    const syncCounters = (): void => {
      nameCount.textContent = `${nameInput.value.length}/${NAME_MAX}`;
      sloganCount.textContent = `${sloganInput.value.length}/${SLOGAN_MAX}`;
    };

    /** Live moderation. Only complains about text the player has actually
     *  finished a word of, so it does not shout at every keystroke. */
    const validateLive = (): boolean => {
      syncCounters();
      const name = nameInput.value.trim();
      const slogan = sloganInput.value.trim();
      let bad: { el: HTMLInputElement; reason: string } | null = null;

      if (name) {
        const r = validateText(name, 'Party name');
        if (!r.ok) bad = { el: nameInput, reason: r.reason! };
      }
      if (!bad && slogan) {
        const r = validateText(slogan, 'Campaign slogan');
        if (!r.ok) bad = { el: sloganInput, reason: r.reason! };
      }

      nameInput.classList.toggle('invalid', bad?.el === nameInput);
      sloganInput.classList.toggle('invalid', bad?.el === sloganInput);
      showError(bad ? bad.reason : null);
      return !bad;
    };

    nameInput.addEventListener('input', validateLive);
    sloganInput.addEventListener('input', validateLive);
    for (const b of boxes) b.addEventListener('change', syncPromises);

    submit.addEventListener('click', () => {
      const name = nameInput.value.trim();
      const slogan = sloganInput.value.trim();

      if (name.length < NAME_MIN) {
        showError(`Party name must be at least ${NAME_MIN} characters.`);
        nameInput.focus();
        return;
      }
      if (slogan.length < SLOGAN_MIN) {
        showError(`Campaign slogan must be at least ${SLOGAN_MIN} characters.`);
        sloganInput.focus();
        return;
      }
      if (!validateLive()) return;

      const promises = boxes.filter((b) => b.checked).map((b) => b.value).slice(0, MAX_PROMISES);
      this.captureDraft();
      this.actions?.onCreateParty(name, slogan, promises);
    });

    syncCounters();
    syncPromises();

    layout.append(preview, form);
    this.bodyEl.appendChild(layout);
  }

  // --- Oval office ----------------------------------------------------------
  private renderOval(
    election: ElectionState,
    gov: FactionGovernment,
    isPresident: boolean,
  ): void {
    if (!isPresident) {
      this.bodyEl.appendChild(emptyState('lock', 'The Oval Office is sealed',
        `Only the sitting President of ${factionName(this.faction)} may enter — currently ${
          election.activePresident ?? 'nobody'}. Found a party, win your citizens' votes, and the door opens.`));
      return;
    }

    const grid = document.createElement('div');
    grid.className = 'oval-grid';

    // 1. Broadcast.
    const bc = ovalCard('mail', 'Faction broadcast',
      'An executive dispatch to every citizen online, archived in their inbox.');
    const bcBody = document.createElement('div');
    bcBody.className = 'field';
    bcBody.innerHTML = `
      <div class="field-head">
        <span class="field-label">Message</span>
        <span class="field-counter js-bc-count">0/${BROADCAST_MAX}</span>
      </div>
      <textarea class="gov-input js-bc-text" maxlength="${BROADCAST_MAX}" rows="3"
        placeholder="Citizens — the flag stands secure and the vaults are rich."></textarea>
      <div class="gov-alert error js-bc-error" hidden></div>
    `;
    const bcText = bcBody.querySelector('.js-bc-text') as HTMLTextAreaElement;
    const bcCount = bcBody.querySelector('.js-bc-count') as HTMLElement;
    const bcErr = bcBody.querySelector('.js-bc-error') as HTMLElement;
    const bcBtn = document.createElement('button');
    bcBtn.type = 'button';
    bcBtn.className = 'gov-btn primary';
    bcBtn.innerHTML = `<span>Dispatch</span>${iconSvg('arrowRight')}`;

    const bcError = (msg: string | null): void => {
      if (!msg) { bcErr.hidden = true; bcText.classList.remove('invalid'); return; }
      bcErr.replaceChildren();
      bcErr.insertAdjacentHTML('beforeend', iconSvg('warning'));
      const s = document.createElement('span');
      s.textContent = msg;
      bcErr.appendChild(s);
      bcErr.hidden = false;
      bcText.classList.add('invalid');
    };

    bcText.addEventListener('input', () => {
      bcCount.textContent = `${bcText.value.length}/${BROADCAST_MAX}`;
      const v = bcText.value.trim();
      if (!v) { bcError(null); return; }
      const r = validateText(v, 'Broadcast');
      bcError(r.ok ? null : r.reason!);
    });
    bcBtn.addEventListener('click', () => {
      const msg = bcText.value.trim();
      if (msg.length < BROADCAST_MIN) {
        bcError(`Broadcast must be at least ${BROADCAST_MIN} characters.`);
        return;
      }
      const r = validateText(msg, 'Broadcast');
      if (!r.ok) { bcError(r.reason!); return; }
      bcError(null);
      this.actions?.onBroadcast(msg);
      bcText.value = '';
      bcCount.textContent = `0/${BROADCAST_MAX}`;
    });
    bc.append(bcBody, bcBtn);

    // 2. Tax rate.
    const taxPct = Math.round(gov.taxRate * 100);
    const maxPct = Math.round(MAX_TAX_RATE * 100);
    const tax = ovalCard('coinbag', 'Faction tax rate',
      'The cut taken from mined and looted resources, paid into the treasury beside your flag.');
    const taxBody = document.createElement('div');
    taxBody.innerHTML = `
      <div class="gov-readout">
        <span class="gov-readout-val js-tax-val">${taxPct}</span><span class="gov-readout-unit">%</span>
      </div>
      <input type="range" class="tax-slider js-tax" min="0" max="${maxPct}" step="1" value="${taxPct}"
             aria-label="Faction tax rate percent" />
      <div class="tax-scale"><span>0% · Free market</span><span>${maxPct}% · War economy</span></div>
      <div class="tax-note js-tax-note"></div>
    `;
    const taxSlider = taxBody.querySelector('.js-tax') as HTMLInputElement;
    const taxVal = taxBody.querySelector('.js-tax-val') as HTMLElement;
    const taxNote = taxBody.querySelector('.js-tax-note') as HTMLElement;
    const taxBtn = document.createElement('button');
    taxBtn.type = 'button';
    taxBtn.className = 'gov-btn primary';
    taxBtn.textContent = 'Set tax rate';

    const syncTax = (): void => {
      const v = Number(taxSlider.value);
      taxVal.textContent = String(v);
      taxNote.textContent = v === taxPct
        ? 'Current rate.'
        : v > taxPct ? `Raising the levy by ${v - taxPct} points.`
                     : `Cutting the levy by ${taxPct - v} points.`;
      taxBtn.disabled = v === taxPct;
    };
    taxSlider.addEventListener('input', syncTax);
    taxBtn.addEventListener('click', () => {
      this.actions?.onSetTaxRate(Number(taxSlider.value) / 100);
    });
    syncTax();
    tax.append(taxBody, taxBtn);

    // 3. Recruit kits.
    const kit = ovalCard('backpack', 'Fund recruit kits',
      'Every new citizen who swears to the faction draws one funded kit on arrival.');
    const kitBody = document.createElement('div');
    kitBody.innerHTML = `
      <div class="gov-readout">
        <span class="gov-readout-val">${gov.kitStock}</span>
        <span class="gov-readout-unit">in pool</span>
      </div>
      <div class="oval-card-desc">Contents: ${gov.kit.length
        ? gov.kit.map((k) => escapeHtml(`${k.count}× ${itemLabel(k.id)}`)).join(', ')
        : 'nothing configured'}.</div>
    `;
    const fundRow = document.createElement('div');
    fundRow.className = 'fund-row';
    for (const amount of [10, 50]) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'gov-btn';
      b.textContent = `+${amount} kits`;
      b.addEventListener('click', () => this.actions?.onAllocateKits(amount));
      fundRow.appendChild(b);
    }
    kit.append(kitBody, fundRow);

    grid.append(bc, tax, kit);
    this.bodyEl.appendChild(grid);
  }

  dispose(): void {
    this.hide();
    this.bustBoard?.dispose();
    this.bustBoard = null;
    this.surface.remove();
  }
}

function ovalCard(icon: string, title: string, desc: string): HTMLElement {
  const card = document.createElement('div');
  card.className = 'oval-card';
  card.innerHTML = `
    <div class="oval-card-head">
      <div class="oval-card-icon">${iconSvg(icon as Parameters<typeof iconSvg>[0])}</div>
      <div class="oval-card-title">${escapeHtml(title)}</div>
    </div>
    <div class="oval-card-desc">${escapeHtml(desc)}</div>
  `;
  return card;
}

function emptyState(icon: string, title: string, body: string): HTMLElement {
  const el = document.createElement('div');
  el.className = 'gov-empty';
  el.insertAdjacentHTML('beforeend', iconSvg(icon as Parameters<typeof iconSvg>[0]));
  const b = document.createElement('b');
  b.textContent = title;
  const p = document.createElement('p');
  p.textContent = body;
  el.append(b, p);
  return el;
}

function itemLabel(id: number): string {
  return ITEMS[id]?.name ?? 'Item';
}
