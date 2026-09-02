// THE ALLEGIANCE PLEDGE
//
// Shown on "Play" for a player who has not yet sworn to a faction. Two cards,
// side by side, each one a full dossier on the side you are about to join for
// good:
// - a live 3D bust of that faction's sitting President on a lit plinth
// - their party, slogan, and the gear and runes they actually carry
// - whether recruit starter kits are funded, and what is in one
// - citizen count, treasury holdings and the tax rate you would be paying
//
// The choice is permanent, so the screen says so before you press anything.
//
// Party names and slogans are player-authored: they reach the DOM escaped or
// as text nodes, never as raw markup.

import { AvatarBustBoard, type BustEntry } from './avatar_bust';
import { defaultCosmetics } from './character';
import { escapeHtml, iconSvg } from './emoji_icons';
import { ITEMS, type ItemStack } from './items';
import type { PoliticsState } from './politics';
import { runeOf } from './runes';
import { skinSeed } from './net/protocol';
import { FACTIONS, factionName } from './teams';

export interface FactionPickerParams {
  politicsState: PoliticsState;
  memberCounts: Record<number, number>;
  treasuryCounts: Record<number, number>;
  onSelect: (faction: number) => void;
}

/** Hover pose per faction, so the two plinths never mirror each other. */
const POSES = ['salute', 'point'] as const;
const TONES = ['crimson', 'azure'] as const;

export class FactionPicker {
  private surface: HTMLElement;
  /** The pan of content that gets rebuilt on every render. */
  private shell: HTMLElement;
  /** A separate, never-wiped host for the shared WebGL canvas. Rebuilding the
   *  shell used to tear the canvas out of the DOM, and AvatarBustBoard.mount()
   *  is a no-op for a host it already holds — so the busts never came back on
   *  a second open. */
  private bustHost: HTMLElement;
  private bustBoard: AvatarBustBoard | null = null;
  private isOpen = false;
  private frame = 0;
  private lastTime = 0;
  private onSelectCallback?: (faction: number) => void;

  constructor(rootContainer: HTMLElement) {
    this.surface = document.createElement('div');
    this.surface.className = 'gov-surface pledge-surface';
    this.surface.setAttribute('role', 'dialog');
    this.surface.setAttribute('aria-modal', 'true');
    this.surface.setAttribute('aria-label', 'Choose your faction');

    this.bustHost = document.createElement('div');
    this.bustHost.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:2';

    this.shell = document.createElement('div');
    this.shell.className = 'gov-shell pledge-shell';

    this.surface.append(this.bustHost, this.shell);
    rootContainer.appendChild(this.surface);

    this.animate = this.animate.bind(this);
  }

  get open(): boolean { return this.isOpen; }

  show(params: FactionPickerParams): void {
    this.onSelectCallback = params.onSelect;
    this.isOpen = true;
    this.render(params);
    this.surface.classList.add('open');
    this.surface.tabIndex = -1;
    this.surface.focus({ preventScroll: true });
    // Only spin the render loop while the screen is actually up.
    this.lastTime = 0;
    if (!this.frame) this.frame = requestAnimationFrame(this.animate);
  }

  hide(): void {
    if (!this.isOpen) return;
    this.isOpen = false;
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

  private render(params: FactionPickerParams): void {
    this.shell.replaceChildren();

    if (!this.bustBoard) {
      try {
        this.bustBoard = new AvatarBustBoard();
        this.bustBoard.mount(this.bustHost);
      } catch {
        this.bustBoard = null; // no WebGL: the dossier still reads fine flat
      }
    }

    const head = document.createElement('div');
    head.className = 'pledge-head';
    head.innerHTML = `
      <div class="pledge-kicker">Article One · Enlistment</div>
      <h1 class="pledge-title">Choose your allegiance</h1>
      <p class="pledge-lede">
        Inspect both powers — their sitting president, the arms they carry, and
        the provisions waiting for a new recruit — then swear to one.
      </p>
      <div class="pledge-warning">
        ${iconSvg('lock')}
        <span><b>This is permanent.</b> Defection and side-switching are disabled.</span>
      </div>
    `;
    this.shell.appendChild(head);

    const grid = document.createElement('div');
    grid.className = 'pledge-grid';
    const busts: BustEntry[] = [];

    FACTIONS.forEach((f, i) => {
      grid.appendChild(this.buildCard(f.id, i, params, busts));
    });

    this.shell.appendChild(grid);
    this.bustBoard?.setRoster(busts);
  }

  private buildCard(
    factionId: number,
    index: number,
    params: FactionPickerParams,
    busts: BustEntry[],
  ): HTMLElement {
    const election = params.politicsState.elections[factionId];
    const gov = params.politicsState.governments[factionId];
    const name = factionName(factionId);
    const tone = TONES[index] ?? 'crimson';

    const card = document.createElement('div');
    card.className = `pledge-card faction-${tone}`;

    // — Header ————————————————————————————————————————————————
    const head = document.createElement('div');
    head.className = 'pledge-card-head';
    head.innerHTML = `
      <div class="gov-emblem">${iconSvg('flag')}</div>
      <div class="pledge-card-name">${escapeHtml(name)}</div>
      <div class="pledge-card-tag">${index === 0 ? 'West' : 'East'}</div>
    `;

    // — Plinth ————————————————————————————————————————————————
    const podium = document.createElement('div');
    podium.className = 'gov-podium pledge-podium';
    const slot = document.createElement('div');
    slot.className = 'gov-podium-slot';
    podium.appendChild(slot);

    const leaderName = election?.activePresident ?? null;
    const bustKey = `pledge_leader_${factionId}`;
    busts.push({
      key: bustKey,
      cosmetics: election?.presidentCosmetics ?? defaultCosmetics(skinSeed(leaderName || name)),
      slot,
      pose: POSES[index] ?? 'salute',
    });

    // — Leader ————————————————————————————————————————————————
    const leader = document.createElement('div');
    leader.className = 'pledge-leader';
    if (leaderName) {
      leader.innerHTML = `
        <div class="gov-role-tag">${iconSvg('crown')} Elected President</div>
        <div class="gov-leader-name">${escapeHtml(leaderName)}</div>
        <div class="gov-leader-party">${escapeHtml(election?.presidentPartyName || 'Independent')}</div>
        <div class="gov-leader-slogan">“${escapeHtml(election?.presidentSlogan || 'Leading toward victory')}”</div>
      `;
    } else {
      leader.innerHTML = `
        <div class="gov-role-tag vacant">${iconSvg('statue')} Podium vacant</div>
        <div class="gov-leader-name">No sitting president</div>
        <div class="gov-leader-note">The office is open. Join, found a party, and run for it.</div>
      `;
    }

    // — Arms & runes ——————————————————————————————————————————
    const armor = election?.presidentArmor ?? [];
    const gear: { label: string; item: ItemStack | null | undefined }[] = [
      { label: 'Helm', item: armor[0] },
      { label: 'Chest', item: armor[1] },
      { label: 'Legs', item: armor[2] },
      { label: 'Boots', item: armor[3] },
      { label: 'Arm', item: election?.presidentHeld },
    ];

    const gearWell = document.createElement('div');
    gearWell.className = 'gov-well';
    gearWell.innerHTML = `
      <div class="gov-well-title">${iconSvg('shield')} Presidential arms &amp; runes</div>
    `;
    const gearSlots = document.createElement('div');
    gearSlots.className = 'gear-slots';
    for (const g of gear) {
      gearSlots.appendChild(buildGearSlot(g.label, g.item));
    }
    gearWell.appendChild(gearSlots);

    // — Recruit kit ————————————————————————————————————————————
    const funded = !!gov && gov.kitStock > 0 && gov.kit.length > 0;
    const kitWell = document.createElement('div');
    kitWell.className = 'gov-well';
    kitWell.innerHTML = `
      <div class="gov-well-title">
        ${iconSvg('backpack')} Recruit starter kit <span class="spacer"></span>
        <span class="kit-badge ${funded ? 'funded' : 'unfunded'}">${
          funded ? `${gov!.kitStock} funded` : 'Unfunded'
        }</span>
      </div>
      ${funded
        ? `<div class="kit-items">${gov!.kit.map((k) =>
            `<span class="kit-chip">${escapeHtml(ITEMS[k.id]?.name ?? 'Item')} <b>×${k.count}</b></span>`
          ).join('')}</div>`
        : '<div class="kit-none">No starter kit is currently funded.</div>'}
    `;

    // — Standing ———————————————————————————————————————————————
    const stats = document.createElement('div');
    stats.className = 'gov-stats';
    stats.innerHTML = `
      <div class="gov-stat">
        ${iconSvg('hand')}
        <span class="gov-stat-val">${params.memberCounts[factionId] ?? 0}</span>
        <span class="gov-stat-lbl">Citizens</span>
      </div>
      <div class="gov-stat">
        ${iconSvg('coinbag')}
        <span class="gov-stat-val">${params.treasuryCounts[factionId] ?? 0}</span>
        <span class="gov-stat-lbl">Treasury</span>
      </div>
      <div class="gov-stat">
        ${iconSvg('star')}
        <span class="gov-stat-val">${Math.round((gov?.taxRate ?? 0) * 100)}%</span>
        <span class="gov-stat-lbl">Tax rate</span>
      </div>
    `;

    // — Pledge —————————————————————————————————————————————————
    const pledge = document.createElement('button');
    pledge.type = 'button';
    pledge.className = 'pledge-btn';
    pledge.innerHTML = `<span>Swear to ${escapeHtml(name)}</span>${iconSvg('arrowRight')}`;
    pledge.addEventListener('click', () => {
      this.hide();
      this.onSelectCallback?.(factionId);
    });

    card.append(head, podium, leader, gearWell, kitWell, stats, pledge);

    card.addEventListener('pointerenter', () => this.bustBoard?.setHover(bustKey));
    card.addEventListener('pointerleave', () => this.bustBoard?.setHover(null));
    // Keyboard parity: focusing the pledge button lights the same plinth.
    pledge.addEventListener('focus', () => this.bustBoard?.setHover(bustKey));
    pledge.addEventListener('blur', () => this.bustBoard?.setHover(null));

    return card;
  }

  dispose(): void {
    this.hide();
    this.bustBoard?.dispose();
    this.bustBoard = null;
    this.surface.remove();
  }
}

function buildGearSlot(label: string, item: ItemStack | null | undefined): HTMLElement {
  const el = document.createElement('div');
  el.className = 'gear-slot';

  if (!item || !item.id) {
    el.innerHTML = `
      <div class="gear-slot-label">${label}</div>
      <div class="gear-slot-empty">—</div>
    `;
    el.title = `${label}: empty`;
    return el;
  }

  const def = ITEMS[item.id];
  const rune = item.rune ? runeOf(item.rune) : undefined;
  el.classList.add('filled');
  if (rune) el.classList.add('runed');

  const itemName = def?.name ?? 'Item';
  el.innerHTML = `
    <div class="gear-slot-label">${label}</div>
    <div class="gear-slot-name">${escapeHtml(itemName)}</div>
    ${rune ? `<div class="gear-rune">${iconSvg('gem')}${escapeHtml(rune.name)}</div>` : ''}
  `;
  // title takes a plain string, so no escaping needed (and none wanted).
  el.title = rune
    ? `${label}: ${itemName}\nSocketed — ${rune.name}: ${rune.desc}`
    : `${label}: ${itemName}`;
  return el;
}
