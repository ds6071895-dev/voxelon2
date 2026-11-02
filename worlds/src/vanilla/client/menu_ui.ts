// Server-described menus (Ghost Tricks, Survival Crafting, Party Games host
// pages): a light dialog of choices. Picking one sends `menu` to the engine.

import { uiButton, uiEl } from '../../ui/dom';
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
    const scrim = this.scrim = uiEl('div', 'w-scrim open v-menu-scrim', this.app);
    scrim.addEventListener('mousedown', (e) => { if (e.target === scrim) this.close(); });
    const card = uiEl('div', 'w-dialog v-menu', scrim);
    card.dataset.menu = v.menu;
    const head = uiEl('div', 'v-inv-head', card);
    uiEl('b', '', head, v.title);
    uiButton(head, 'Close', () => this.close(), 'w-btn v-inv-done');
    if (v.sub) uiEl('p', 'v-menu-sub', card, v.sub);
    const list = uiEl('div', 'v-menu-list', card);
    if (!v.items.length) uiEl('p', 'v-menu-empty', list, 'Nothing here right now.');
    for (const it of v.items) {
      const b = uiButton(list, '', () => { if (!it.disabled) this.pick(v.menu, it.id); }, 'v-menu-item');
      b.disabled = !!it.disabled;
      if (it.active) b.classList.add('active');
      if (it.tag) b.dataset.tag = it.tag;
      const cv = document.createElement('canvas'); cv.width = cv.height = 32;
      renderItemIcon(cv, this.atlas, it.icon);
      b.append(cv);
      const text = uiEl('span', 'v-menu-text', b);
      uiEl('b', '', text, it.label);
      if (it.sub) uiEl('small', '', text, it.sub);
      if (it.count !== undefined) uiEl('i', 'v-menu-count', b, String(it.count));
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
