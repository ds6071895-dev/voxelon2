// Bedwars HUD: the resource strip, the bed-status bar, the combo pips, the
// swing-charge arc, and the Quartermaster shop panel.
//
// The DOM is built here rather than in index.html because every element is
// data-driven off `BEDWARS_SHOP` and the team table — hand-authoring markup for
// eight shop rows that already exist as a typed array would just be a second
// copy of the same list, free to drift.

import {
  BEDWARS_SHOP, BW_COMBO_MAX, type BwLobbySnapshot, type BwResources, type BwShopEntry,
} from './bedwars';
import { iconSvg } from './emoji_icons';

const TEAM_NAME = ['Crimson', 'Cobalt'];
const TEAM_COLOR = ['#e0555f', '#5b8dde'];

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K, cls?: string, text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

function costLabel(cost: Partial<BwResources>): string {
  const parts: string[] = [];
  if (cost.iron) parts.push(`${cost.iron} iron`);
  if (cost.gold) parts.push(`${cost.gold} gold`);
  if (cost.diamond) parts.push(`${cost.diamond} diamond`);
  return parts.join(' + ');
}

function affordable(have: BwResources, cost: Partial<BwResources>): boolean {
  return have.iron >= (cost.iron ?? 0) && have.gold >= (cost.gold ?? 0) &&
    have.diamond >= (cost.diamond ?? 0);
}

/**
 * The whole Bedwars HUD.
 *
 * Nothing here decides anything: the shop asks the server to buy and waits for
 * the resource message to come back, so a row greying out is a REPORT of
 * server state, never a local prediction that could disagree with it.
 */
export class BedwarsUI {
  private readonly root: HTMLDivElement;
  private readonly resourceEl: HTMLDivElement;
  private readonly ironEl: HTMLSpanElement;
  private readonly goldEl: HTMLSpanElement;
  private readonly diamondEl: HTMLSpanElement;
  private readonly bedsEl: HTMLDivElement;
  private readonly comboEl: HTMLDivElement;
  private readonly chargeEl: HTMLDivElement;
  private readonly chargeFill: HTMLDivElement;
  private readonly shopEl: HTMLDivElement;
  private readonly shopRows: { entry: BwShopEntry; row: HTMLButtonElement; cost: HTMLSpanElement }[] = [];
  private readonly stageEl: HTMLDivElement;

  private resources: BwResources = { iron: 0, gold: 0, diamond: 0 };
  private team = 0;
  private comboCount = 0;
  private comboUntil = 0;
  private chargeValue = 0;
  private shopOpen = false;

  /** Set by the owner; called when a row is clicked. */
  onBuy?: (entry: number) => void;

  constructor(host: HTMLElement) {
    this.root = el('div', 'bw-hud');
    this.root.hidden = true;

    this.resourceEl = el('div', 'bw-resources');
    this.ironEl = el('span', 'bw-res iron', '0');
    this.goldEl = el('span', 'bw-res gold', '0');
    this.diamondEl = el('span', 'bw-res diamond', '0');
    for (const [label, node] of [['IRON', this.ironEl], ['GOLD', this.goldEl],
      ['DIAMOND', this.diamondEl]] as const) {
      const cell = el('div', 'bw-res-cell');
      cell.appendChild(el('span', 'bw-res-label', label));
      cell.appendChild(node);
      this.resourceEl.appendChild(cell);
    }

    this.bedsEl = el('div', 'bw-beds');
    this.stageEl = el('div', 'bw-stage');
    this.stageEl.hidden = true;

    this.comboEl = el('div', 'bw-combo');
    this.comboEl.hidden = true;

    this.chargeEl = el('div', 'bw-charge');
    this.chargeFill = el('div', 'bw-charge-fill');
    this.chargeEl.appendChild(this.chargeFill);
    this.chargeEl.hidden = true;

    this.shopEl = el('div', 'bw-shop');
    this.shopEl.hidden = true;
    const title = el('div', 'bw-shop-title', 'QUARTERMASTER');
    this.shopEl.appendChild(title);
    this.shopEl.appendChild(el('div', 'bw-shop-hint',
      'Right-click the Quartermaster to open · Esc or walk away to close'));
    const list = el('div', 'bw-shop-list');
    for (const entry of BEDWARS_SHOP) {
      const row = el('button', 'bw-shop-row');
      row.type = 'button';
      row.appendChild(el('span', 'bw-shop-key', String(entry.entry)));
      row.appendChild(el('span', 'bw-shop-name', entry.label));
      const cost = el('span', 'bw-shop-cost', costLabel(entry.cost));
      row.appendChild(cost);
      row.addEventListener('click', () => this.onBuy?.(entry.entry));
      list.appendChild(row);
      this.shopRows.push({ entry, row, cost });
    }
    this.shopEl.appendChild(list);

    this.root.append(this.resourceEl, this.bedsEl, this.stageEl,
      this.comboEl, this.chargeEl, this.shopEl);
    host.appendChild(this.root);
  }

  setVisible(visible: boolean): void {
    this.root.hidden = !visible;
    if (!visible) this.closeShop();
  }

  setTeam(team: number): void {
    this.team = team;
    this.root.style.setProperty('--bw-team', TEAM_COLOR[team] ?? TEAM_COLOR[0]);
  }

  setResources(iron: number, gold: number, diamond: number): void {
    this.resources = { iron, gold, diamond };
    this.ironEl.textContent = String(iron);
    this.goldEl.textContent = String(gold);
    this.diamondEl.textContent = String(diamond);
    this.refreshShopAffordability();
  }

  /** Bed status for every team, plus the stalemate-ladder banner. */
  setSnapshot(snapshot: BwLobbySnapshot | null): void {
    if (!snapshot) { this.bedsEl.replaceChildren(); return; }
    const rows = snapshot.teams.map((state) => {
      const row = el('div', `bw-bed ${state.bedAlive ? 'alive' : 'gone'}` +
        (state.team === this.team ? ' mine' : ''));
      row.style.setProperty('--bw-bed-color', TEAM_COLOR[state.team] ?? '#888');
      row.appendChild(el('span', 'bw-bed-name', TEAM_NAME[state.team] ?? `Team ${state.team}`));
      row.appendChild(el('span', 'bw-bed-state',
        state.bedAlive ? 'BED' : 'NO RESPAWN'));
      const alive = snapshot.participants.filter((p) => p.team === state.team && p.connected);
      row.appendChild(el('span', 'bw-bed-count', `${alive.filter((p) => p.alive).length}/${alive.length}`));
      return row;
    });
    this.bedsEl.replaceChildren(...rows);

    if (snapshot.stage === 'no_respawn') {
      this.stageEl.hidden = false;
      this.stageEl.textContent = 'THE BEDS CRUMBLE — NO MORE RESPAWNS';
      this.stageEl.className = 'bw-stage warn';
    } else if (snapshot.stage === 'collapse') {
      this.stageEl.hidden = false;
      this.stageEl.textContent = 'THE ARENA CLOSES — FIGHT AT MID';
      this.stageEl.className = 'bw-stage danger';
    } else {
      this.stageEl.hidden = true;
    }
  }

  /** A bed just went down. Returns the announcement text so the caller can
   *  route it through whatever banner it already owns. */
  bedBrokenText(team: number, mine: boolean): string {
    const name = (TEAM_NAME[team] ?? `Team ${team}`).toUpperCase();
    return mine ? `YOUR BED IS GONE — NO MORE RESPAWNS` : `${name} BED DESTROYED`;
  }

  /** Combo pips. Shown from x2 upward; x1 is just "a hit". */
  setCombo(combo: number, now: number): void {
    this.comboCount = combo;
    this.comboUntil = now + 1_600;
    this.renderCombo();
  }

  clearCombo(): void {
    this.comboCount = 0;
    this.comboEl.hidden = true;
  }

  /** Swing charge, 0..1, under the crosshair. */
  setCharge(charge: number): void {
    this.chargeValue = Math.max(0, Math.min(1, charge));
    // Hidden at rest and at full: an arc that is always on becomes furniture.
    this.chargeEl.hidden = this.chargeValue >= 1;
    this.chargeEl.classList.toggle('ready', this.chargeValue >= 1);
    this.chargeFill.style.setProperty('--charge', this.chargeValue.toFixed(3));
  }

  update(now: number): void {
    if (this.comboCount > 0 && now >= this.comboUntil) this.clearCombo();
  }

  openShop(): void {
    this.shopOpen = true;
    this.shopEl.hidden = false;
    this.refreshShopAffordability();
  }
  closeShop(): void {
    this.shopOpen = false;
    this.shopEl.hidden = true;
  }
  toggleShop(): void { this.shopOpen ? this.closeShop() : this.openShop(); }
  get isShopOpen(): boolean { return this.shopOpen; }

  /** Buy by number key while the panel is open. Returns true if handled. */
  buyByKey(key: string): boolean {
    if (!this.shopOpen) return false;
    const n = Number(key);
    if (!Number.isInteger(n)) return false;
    const row = this.shopRows.find((r) => r.entry.entry === n);
    if (!row) return false;
    this.onBuy?.(n);
    return true;
  }

  private renderCombo(): void {
    if (this.comboCount < 1) { this.comboEl.hidden = true; return; }
    this.comboEl.hidden = false;
    const shown = Math.min(this.comboCount, BW_COMBO_MAX);
    this.comboEl.replaceChildren();
    this.comboEl.appendChild(el('span', 'bw-combo-x', `×${shown + 1}`));
    for (let i = 0; i < BW_COMBO_MAX; i++) {
      this.comboEl.appendChild(el('span', `bw-pip${i < shown ? ' lit' : ''}`));
    }
    this.comboEl.classList.toggle('max', shown >= BW_COMBO_MAX);
  }

  private refreshShopAffordability(): void {
    for (const { entry, row, cost } of this.shopRows) {
      const can = affordable(this.resources, entry.cost);
      row.classList.toggle('afford', can);
      row.classList.toggle('locked', !can);
      cost.textContent = costLabel(entry.cost);
    }
  }
}

/** Result-card copy. Bedwars is UNRANKED, so this deliberately has no rank or
 *  RP line — there is nothing to show, and inventing one would be a lie. */
export function bedwarsResultCopy(
  winner: string | null, reason: string,
): { title: string; sub: string } {
  const title = winner ? `${winner} WINS` : 'NO WINNER';
  const sub = reason === 'final_kill' ? 'Final kill — the bed was already gone'
    : reason === 'time' ? 'Time — decided on deaths, then beds'
    : reason === 'forfeit' ? 'Opponent left the arena'
    : 'Match cancelled';
  return { title, sub: `${sub} · unranked` };
}

/** Small helper so the caller does not need to import emoji_icons too. */
export function bedwarsCrownIcon(): string { return iconSvg('crown'); }
