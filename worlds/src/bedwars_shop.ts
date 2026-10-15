// The merchant panels, Hypixel style: a centred window with a quick-buy tab,
// category tabs and a grid of item tiles; hovering a tile tells you what it
// does. A light scrim, no blur. Purchases are decided by the server; the panel
// only asks and reports the answer.
import { BW_CATALOG, BW_CATEGORIES, bwPrice, type BwCatalogEntry, type BwCategory } from './bedwars_catalog';
import { BW_RESOURCES, BW_RESOURCE_ITEM, BW_RESOURCE_NAME, BW_SERVICE_NAMES as TITLES, bwUpgrades, bwWallet, type BedwarsService, type BwAction, type BwPlayerView, type BwResource, type BwSnapshot, type BwTeam, type BwWallet } from './bedwars_rules';
import { BwPurchaseRequests } from './bedwars_requests';
import { bwButton, bwEl } from './bedwars_ui';
import { renderItemIcon } from './icons';

type Tab = BwCategory | 'quick';
const SHOP_TABS: { id: Tab; label: string }[] = [{ id: 'quick', label: 'Quick Buy' }, ...BW_CATEGORIES.filter(c => c.id !== 'upgrades')];
/** The first tab: what most rounds are bought from. */
const QUICK = new Set(['wool', 'stone_sword', 'iron_sword', 'iron_armor', 'tools', 'shears', 'wood', 'tnt', 'heal', 'bow', 'arrows', 'pearl']);

interface ShopDeps {
  host: HTMLElement;
  atlasCanvas: HTMLCanvasElement;
  send(action: BwAction): boolean;
  /** How many of an item the player is carrying. */
  count(item: number): number;
  onPanel(): void;
}
interface Row { entry: BwCatalogEntry; root: HTMLButtonElement; price: HTMLElement; tag: HTMLElement; detail: string; state: string }

/** A server-confirmed shop: never spends or grants anything locally. */
export class BedwarsShop {
  readonly root: HTMLElement;
  private readonly title: HTMLElement;
  private readonly tabs: HTMLElement;
  private readonly list: HTMLElement;
  private readonly chest: HTMLElement;
  private readonly notice: HTMLElement;
  /** What you are carrying, so prices read at a glance. */
  private readonly purse = new Map<BwResource, HTMLElement>();
  private readonly rows: Row[] = [];
  private readonly tabButtons = new Map<Tab, HTMLButtonElement>();
  private readonly scrim: HTMLElement;
  private readonly details: HTMLElement;
  private readonly chestRows = new Map<BwResource, { chest: HTMLElement; put: HTMLButtonElement; take: HTMLButtonElement }>();
  private readonly pending = new Map<number, string>();
  private readonly requests = new BwPurchaseRequests();
  private self: BwPlayerView | undefined;
  private snap: BwSnapshot | null = null;
  private team: BwTeam = 0;
  private category: Tab = 'quick';
  private noticeTimer = 0;
  service: BedwarsService | null = null;

  constructor(private readonly d: ShopDeps) {
    this.scrim = bwEl('div', 'bw-shop-scrim', d.host);
    this.scrim.hidden = true;
    this.scrim.addEventListener('pointerdown', e => { e.stopPropagation(); if (e.target === this.scrim) this.close(); });
    this.root = bwEl('section', 'bw-shop', this.scrim);
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-label', 'Shop');
    const head = bwEl('header', '', this.root);
    this.title = bwEl('b', '', head, TITLES.shop);
    const close = bwButton(head, '', () => this.close(), 'bw-x');
    close.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>';
    close.setAttribute('aria-label', 'Close');
    const purse = bwEl('div', 'bw-purse', this.root);
    for (const r of BW_RESOURCES) {
      const chip = bwEl('span', '', purse); chip.dataset.resource = r; chip.title = BW_RESOURCE_NAME[r];
      renderItemIcon(bwEl('canvas', '', chip), this.d.atlasCanvas, BW_RESOURCE_ITEM[r]);
      this.purse.set(r, bwEl('b', '', chip, '0'));
    }
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
    const foot = bwEl('footer', 'bw-shop-foot', this.root);
    this.details = bwEl('div', 'bw-details', foot);
    this.notice = bwEl('div', 'bw-notice', foot);
    this.root.addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); this.close(); } });
    this.root.addEventListener('pointerdown', e => e.stopPropagation());
  }

  get open(): boolean { return !this.scrim.hidden; }

  show(service: BedwarsService, team: BwTeam): void {
    this.service = service; this.team = team; this.scrim.hidden = false;
    this.root.dataset.service = service;
    this.title.textContent = TITLES[service];
    this.tabs.hidden = service !== 'shop';
    this.list.hidden = service === 'chest';
    this.chest.hidden = service !== 'chest';
    this.category = service === 'upgrades' ? 'upgrades' : this.category === 'upgrades' ? 'quick' : this.category;
    this.details.textContent = service === 'chest' ? 'Shared with your team. Safe even if you die.' : 'Hover an item to see what it does.';
    this.say('');
    this.layout(); this.refresh();
    this.d.onPanel();
  }
  close(): void {
    if (!this.open) return;
    this.scrim.hidden = true; this.service = null;
    this.d.onPanel();
  }
  reset(): void {
    this.scrim.hidden = true; this.service = null; this.pending.clear(); this.snap = null; this.self = undefined;
    window.clearTimeout(this.noticeTimer); this.say('');
    for (const row of this.rows) { row.state = ''; delete row.root.dataset.busy; }
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

  private choose(cat: Tab): void { this.category = cat; this.layout(); this.refresh(); }
  private say(text: string, tone = ''): void {
    this.notice.textContent = text; this.notice.dataset.tone = tone;
    window.clearTimeout(this.noticeTimer);
    if (text) this.noticeTimer = window.setTimeout(() => { this.notice.textContent = ''; }, 2600);
  }

  private makeRow(entry: BwCatalogEntry): Row {
    const root = bwButton(this.list, '', () => this.buy(entry), 'bw-row');
    const show = (): void => { this.details.textContent = `${entry.name}: ${row.detail}`; };
    root.addEventListener('pointerenter', show); root.addEventListener('focus', show);
    // Touch has no hover: a touch shows the description at once, and holding
    // it (350 ms) reads it without buying. A plain tap still buys straight
    // away, as quickly as a click does.
    let held = false, holdTimer = 0;
    root.addEventListener('pointerdown', e => {
      if (e.pointerType !== 'touch') return;
      show(); held = false;
      window.clearTimeout(holdTimer);
      holdTimer = window.setTimeout(() => { held = true; }, 350);
    });
    for (const type of ['pointerup', 'pointercancel']) root.addEventListener(type, () => window.clearTimeout(holdTimer));
    root.addEventListener('click', e => {
      if (!held) return;
      held = false; e.preventDefault(); e.stopImmediatePropagation();
    }, true);
    const icon = bwEl('canvas', 'bw-icon', root);
    renderItemIcon(icon, this.d.atlasCanvas, entry.item);
    const text = bwEl('span', 'bw-row-text', root);
    bwEl('b', '', text, entry.name);
    const tag = bwEl('small', '', text);
    const price = bwEl('span', 'bw-price', root);
    price.dataset.resource = entry.resource;
    const coin = bwEl('canvas', '', price);
    renderItemIcon(coin, this.d.atlasCanvas, BW_RESOURCE_ITEM[entry.resource]);
    bwEl('i', '', price);
    const row: Row = { entry, root, price, tag, detail: entry.description, state: '' };
    return row;
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
    for (const row of this.rows) row.root.hidden = upgrades ? row.entry.category !== 'upgrades'
      : row.entry.category === 'upgrades' || (this.category === 'quick' ? !QUICK.has(row.entry.sku) : row.entry.category !== this.category);
  }

  private buy(entry: BwCatalogEntry): void {
    const row = this.rows.find(r => r.entry === entry);
    if (!row || row.root.dataset.state === 'owned' || row.root.dataset.state === 'maxed') return;
    const request = this.requests.next();
    this.pending.set(request, entry.sku);
    row.root.dataset.busy = '1';
    if (!this.d.send({ kind: 'buy', sku: entry.sku, request })) { this.pending.delete(request); this.refresh(); }
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
    for (const [r, node] of this.purse) {
      const n = String(this.d.count(BW_RESOURCE_ITEM[r]));
      if (node.textContent !== n) node.textContent = n;
      node.parentElement!.dataset.empty = n === '0' ? '1' : '';
    }
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
      row.detail = e.upgrade ? `${e.description} Level ${level}/${e.max ?? 1}.` : e.description;
      row.tag.textContent = e.upgrade ? `Level ${level}/${e.max ?? 1}` : '';
    }
  }
}
