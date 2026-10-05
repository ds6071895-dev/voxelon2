// The merchant panels: a narrow card docked to the right edge. There is no
// scrim and no blur, so the match stays visible and cheap to render. Purchases
// are decided by the server; the panel only asks and reports the answer.
import { BW_CATALOG, BW_CATEGORIES, bwPrice, type BwCatalogEntry, type BwCategory } from './bedwars_catalog';
import { BW_RESOURCES, BW_RESOURCE_ITEM, BW_RESOURCE_NAME, bwUpgrades, bwWallet, type BwAction, type BwPlayerView, type BwResource, type BwSnapshot, type BwTeam, type BwWallet } from './bedwars_rules';
import { bwButton, bwEl } from './bedwars_ui';
import { renderItemIcon } from './icons';

export type BedwarsService = 'shop' | 'upgrades' | 'chest';
const TITLES: Record<BedwarsService, string> = { shop: 'Item Shop', upgrades: 'Team Upgrades', chest: 'Team Chest' };
const SHOP_TABS = BW_CATEGORIES.filter(c => c.id !== 'upgrades');

interface ShopDeps {
  host: HTMLElement;
  atlasCanvas: HTMLCanvasElement;
  send(action: BwAction): boolean;
  /** How many of an item the player is carrying. */
  count(item: number): number;
  onPanel(): void;
}
interface Row { entry: BwCatalogEntry; root: HTMLButtonElement; price: HTMLElement; tag: HTMLElement; state: string }

/** A server-confirmed shop: never spends or grants anything locally. */
export class BedwarsShop {
  readonly root: HTMLElement;
  private readonly title: HTMLElement;
  private readonly tabs: HTMLElement;
  private readonly list: HTMLElement;
  private readonly chest: HTMLElement;
  private readonly notice: HTMLElement;
  private readonly rows: Row[] = [];
  private readonly tabButtons = new Map<BwCategory, HTMLButtonElement>();
  private readonly chestRows = new Map<BwResource, { chest: HTMLElement; put: HTMLButtonElement; take: HTMLButtonElement }>();
  private readonly pending = new Map<number, string>();
  private request = 0;
  private self: BwPlayerView | undefined;
  private snap: BwSnapshot | null = null;
  private team: BwTeam = 0;
  private category: BwCategory = 'blocks';
  private noticeTimer = 0;
  service: BedwarsService | null = null;

  constructor(private readonly d: ShopDeps) {
    this.root = bwEl('aside', 'bw-shop', d.host);
    this.root.hidden = true;
    this.root.setAttribute('aria-label', 'Shop');
    const head = bwEl('header', '', this.root);
    this.title = bwEl('b', '', head, TITLES.shop);
    const close = bwButton(head, '', () => this.close(), 'bw-x');
    close.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>';
    close.setAttribute('aria-label', 'Close');
    this.tabs = bwEl('nav', 'bw-tabs', this.root);
    this.tabs.setAttribute('role', 'tablist');
    for (const cat of SHOP_TABS) {
      const button = bwButton(this.tabs, cat.label, () => this.choose(cat.id), 'bw-tab');
      button.setAttribute('role', 'tab');
      this.tabButtons.set(cat.id, button);
    }
    this.list = bwEl('div', 'bw-list', this.root);
    for (const entry of BW_CATALOG) this.rows.push(this.makeRow(entry));
    this.chest = bwEl('div', 'bw-list bw-chest', this.root);
    for (const r of BW_RESOURCES) this.makeChestRow(r);
    this.notice = bwEl('footer', 'bw-notice', this.root);
    this.root.addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); this.close(); } });
    this.root.addEventListener('pointerdown', e => e.stopPropagation());
  }

  get open(): boolean { return !this.root.hidden; }

  show(service: BedwarsService, team: BwTeam): void {
    this.service = service; this.team = team; this.root.hidden = false;
    this.root.dataset.service = service;
    this.title.textContent = TITLES[service];
    this.tabs.hidden = service !== 'shop';
    this.list.hidden = service === 'chest';
    this.chest.hidden = service !== 'chest';
    this.category = service === 'upgrades' ? 'upgrades' : this.category === 'upgrades' ? 'blocks' : this.category;
    this.say('');
    this.layout(); this.refresh();
    this.d.onPanel();
  }
  close(): void {
    if (!this.open) return;
    this.root.hidden = true; this.service = null;
    this.d.onPanel();
  }
  reset(): void {
    this.root.hidden = true; this.service = null; this.pending.clear(); this.request = 0; this.snap = null; this.self = undefined;
  }

  /** New snapshot or inventory: re-evaluate what can be bought. */
  update(snap: BwSnapshot | null, myId: number, team: BwTeam): void {
    this.snap = snap; this.team = team; this.self = snap?.players.find(p => p.id === myId);
    if (this.open) this.refresh();
  }
  buyResult(request: number, ok: boolean, message: string): void {
    this.pending.delete(request);
    this.say(message, ok ? 'good' : 'bad');
    this.refresh();
  }

  private choose(cat: BwCategory): void { this.category = cat; this.layout(); this.refresh(); }
  private say(text: string, tone = ''): void {
    this.notice.textContent = text; this.notice.dataset.tone = tone;
    window.clearTimeout(this.noticeTimer);
    if (text) this.noticeTimer = window.setTimeout(() => { this.notice.textContent = ''; }, 2600);
  }

  private makeRow(entry: BwCatalogEntry): Row {
    const root = bwButton(this.list, '', () => this.buy(entry), 'bw-row');
    const icon = bwEl('canvas', 'bw-icon', root);
    renderItemIcon(icon, this.d.atlasCanvas, entry.item);
    const text = bwEl('span', 'bw-row-text', root);
    bwEl('b', '', text, entry.name);
    const tag = bwEl('small', '', text, entry.description);
    const price = bwEl('span', 'bw-price', root);
    price.dataset.resource = entry.resource;
    const coin = bwEl('canvas', '', price);
    renderItemIcon(coin, this.d.atlasCanvas, BW_RESOURCE_ITEM[entry.resource]);
    bwEl('i', '', price);
    return { entry, root, price, tag, state: '' };
  }
  private makeChestRow(resource: BwResource): void {
    const root = bwEl('div', 'bw-row bw-chest-row', this.chest);
    const icon = bwEl('canvas', 'bw-icon', root);
    renderItemIcon(icon, this.d.atlasCanvas, BW_RESOURCE_ITEM[resource]);
    const text = bwEl('span', 'bw-row-text', root);
    bwEl('b', '', text, BW_RESOURCE_NAME[resource]);
    const chest = bwEl('small', '', text);
    const actions = bwEl('span', 'bw-chest-actions', root);
    const put = bwButton(actions, 'Put', () => this.d.send({ kind: 'bank', resource, amount: Math.max(1, this.d.count(BW_RESOURCE_ITEM[resource])), direction: 'deposit' }), 'bw-mini');
    const take = bwButton(actions, 'Take', () => this.d.send({ kind: 'bank', resource, amount: 16, direction: 'withdraw' }), 'bw-mini');
    this.chestRows.set(resource, { chest, put, take });
  }

  private layout(): void {
    for (const [cat, button] of this.tabButtons) button.setAttribute('aria-selected', String(cat === this.category));
    const upgrades = this.service === 'upgrades';
    for (const row of this.rows) row.root.hidden = row.entry.category !== this.category || (row.entry.category === 'upgrades') !== upgrades;
  }

  private buy(entry: BwCatalogEntry): void {
    const row = this.rows.find(r => r.entry === entry);
    if (!row || row.root.dataset.state === 'owned' || row.root.dataset.state === 'maxed') return;
    const request = ++this.request;
    this.pending.set(request, entry.sku);
    row.root.dataset.busy = '1';
    if (!this.d.send({ kind: 'buy', sku: entry.sku, request })) this.pending.delete(request);
    window.setTimeout(() => { if (this.pending.delete(request)) this.refresh(); }, 4000);
  }

  private owned(entry: BwCatalogEntry): boolean {
    const me = this.self;
    if (!me || !entry.tier) return false;
    if (entry.type === 'armor') return me.armor >= entry.tier;
    if (entry.type === 'sword') return me.sword >= entry.tier;
    if (entry.type === 'tool') return me.tools[entry.toolKind!] >= entry.tier;
    return false;
  }
  private refresh(): void {
    if (this.service === 'chest') {
      const chest: BwWallet = this.snap?.teams[this.team].chest ?? bwWallet();
      for (const [r, row] of this.chestRows) {
        const text = `In chest: ${chest[r]}`;
        if (row.chest.textContent !== text) row.chest.textContent = text;
        row.put.disabled = this.d.count(BW_RESOURCE_ITEM[r]) <= 0;
        row.take.disabled = chest[r] <= 0;
      }
      return;
    }
    const upgrades = this.snap?.teams[this.team].upgrades ?? bwUpgrades();
    const busy = new Set(this.pending.values());
    for (const row of this.rows) {
      if (row.root.hidden) continue;
      const e = row.entry;
      const level = e.upgrade ? upgrades[e.upgrade] : 0;
      const maxed = !!e.upgrade && level >= (e.max ?? 1);
      const owned = this.owned(e);
      const cost = bwPrice(e, upgrades);
      const afford = this.d.count(BW_RESOURCE_ITEM[e.resource]) >= cost;
      const state = maxed ? 'maxed' : owned ? 'owned' : afford ? 'ok' : 'poor';
      const key = `${state}/${cost}/${level}/${busy.has(e.sku)}`;
      if (row.state === key) continue;
      row.state = key;
      row.root.dataset.state = state;
      if (busy.has(e.sku)) row.root.dataset.busy = '1'; else delete row.root.dataset.busy;
      const label = row.price.querySelector('i')!;
      label.textContent = maxed ? 'Max' : owned ? 'Owned' : String(cost);
      row.price.dataset.hidden = maxed || owned ? '1' : '';
      row.tag.textContent = e.upgrade ? `${e.description}  Level ${level}/${e.max ?? 1}` : e.description;
    }
  }
}
