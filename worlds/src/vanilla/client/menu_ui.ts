// Server-described menus (Ghost Tricks, Survival Crafting, Party Games host
// pages): a light dialog of choices. Picking one sends `menu` to the engine.

import { bwButton, bwEl } from '../../bedwars_ui';
import { renderItemIcon } from '../../icons';
import type { MenuView } from '../messages';

export class MenuUI {
  private scrim: HTMLElement | null = null;
  open = false;
  current: string | null = null;

  constructor(private readonly app: HTMLElement, private readonly atlas: HTMLCanvasElement,
    private readonly pick: (menu: string, id: string) => void, private readonly onOpenChange: (open: boolean) => void) {
    window.addEventListener('keydown', (e) => { if (this.open && (e.code === 'Escape' || e.code === 'KeyE')) { e.preventDefault(); this.close(); } });
  }

  show(v: MenuView | null): void {
    if (!v) { this.close(); return; }
    this.scrim?.remove();
    this.open = true; this.current = v.menu;
    this.onOpenChange(true);
    const scrim = this.scrim = bwEl('div', 'w-scrim open v-menu-scrim', this.app);
    scrim.addEventListener('mousedown', (e) => { if (e.target === scrim) this.close(); });
    const card = bwEl('div', 'w-dialog v-menu', scrim);
    card.dataset.menu = v.menu;
    const head = bwEl('div', 'v-inv-head', card);
    bwEl('b', '', head, v.title);
    bwButton(head, 'Close', () => this.close(), 'w-btn v-inv-done');
    if (v.sub) bwEl('p', 'v-menu-sub', card, v.sub);
    const list = bwEl('div', 'v-menu-list', card);
    if (!v.items.length) bwEl('p', 'v-menu-empty', list, 'Nothing here right now.');
    for (const it of v.items) {
      const b = bwButton(list, '', () => { if (!it.disabled) this.pick(v.menu, it.id); }, 'v-menu-item');
      b.disabled = !!it.disabled;
      if (it.active) b.classList.add('active');
      if (it.tag) b.dataset.tag = it.tag;
      const cv = document.createElement('canvas'); cv.width = cv.height = 32;
      renderItemIcon(cv, this.atlas, it.icon);
      b.append(cv);
      const text = bwEl('span', 'v-menu-text', b);
      bwEl('b', '', text, it.label);
      if (it.sub) bwEl('small', '', text, it.sub);
      if (it.count !== undefined) bwEl('i', 'v-menu-count', b, String(it.count));
    }
  }
  close(): void {
    if (!this.open) return;
    this.scrim?.remove(); this.scrim = null;
    this.open = false; this.current = null;
    this.onOpenChange(false);
  }
  dispose(): void { this.close(); }
}
