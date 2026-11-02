// The vanilla modes' HUD, in the same light Worlds look as Bedwars (it reuses
// the bw-hud sidebar, feed, pill and title styles): survival bars (hearts with
// absorption, armour, hunger, air), an XP-style progress bar, effect chips, a
// mode sidebar, the event feed, an action-bar line and big titles.

import { bwEl } from '../../bedwars_ui';
import { EFFECT_COLOR, EFFECT_LABEL, type EffectId } from '../effects';
import type { SelfView } from '../messages';

// 7x7 pixel masks drawn at 2x (Worlds' own icon shapes).
const HEART = ['0110110', '1111111', '1111111', '1111111', '0111110', '0011100', '0001000'];
const SHANK = ['0000110', '0001111', '0011111', '0111110', '1111100', '1101000', '1000000'];
const ARMOR = ['1110111', '1111111', '1111111', '0111110', '0111110', '0111110', '0011100'];
const BUBBLE = ['0011100', '0100010', '1000101', '1000001', '1000001', '0100010', '0011100'];

function icon(ctx: CanvasRenderingContext2D, x: number, y: number, mask: string[], fill: (px: number, py: number) => string | null): void {
  for (let py = 0; py < 7; py++) for (let px = 0; px < 7; px++) {
    if (mask[py][px] !== '1') continue;
    const c = fill(px, py);
    if (!c) continue;
    ctx.fillStyle = c;
    ctx.fillRect(x + px * 2, y + py * 2, 2, 2);
  }
}

export interface SidebarRow { label: string; value: string; tone?: 'good' | 'bad' | 'mute' | 'gold'; you?: boolean }

export class VanillaHud {
  readonly root: HTMLElement;
  private readonly bars: HTMLCanvasElement;
  private readonly xp: HTMLElement;
  private readonly xpFill: HTMLElement;
  private readonly xpLevel: HTMLElement;
  private readonly effects: HTMLElement;
  private readonly side: HTMLElement;
  private readonly sideTitle: HTMLElement;
  private readonly sideClock: HTMLElement;
  private readonly sideNext: HTMLElement;
  private readonly sideRows: HTMLElement;
  private readonly feed: HTMLElement;
  private readonly pill: HTMLElement;
  private readonly title: HTMLElement;
  private readonly titleMain: HTMLElement;
  private readonly titleSub: HTMLElement;
  private readonly events: { node: HTMLElement; until: number }[] = [];
  private titleUntil = 0;
  private pillUntil = 0;
  private barsKey = '';
  private effectsKey = '';
  private rowsKey = '';
  private cache = new Map<HTMLElement, string>();

  constructor(app: HTMLElement) {
    this.root = bwEl('div', 'bw-hud v-hud', app);
    this.root.hidden = true;
    this.bars = bwEl('canvas', 'v-bars', this.root);
    this.bars.width = 444; this.bars.height = 64;
    this.xp = bwEl('div', 'v-xp', this.root);
    this.xpFill = bwEl('div', 'v-xp-fill', this.xp);
    this.xpLevel = bwEl('b', 'v-xp-level', this.xp);
    this.effects = bwEl('div', 'v-effects', this.root);
    this.side = bwEl('aside', 'bw-side v-side', this.root);
    this.side.addEventListener('click', () => { if (document.documentElement.classList.contains('touch-ui')) this.side.classList.toggle('open'); });
    const head = bwEl('div', 'bw-side-head', this.side);
    this.sideTitle = bwEl('b', '', head, '');
    this.sideClock = bwEl('small', '', head, '');
    this.sideNext = bwEl('div', 'bw-side-next', this.side);
    this.sideRows = bwEl('div', 'v-side-rows', this.side);
    this.feed = bwEl('div', 'bw-feed', this.root);
    this.feed.setAttribute('role', 'log');
    this.pill = bwEl('div', 'bw-pill v-pill', this.root);
    this.pill.hidden = true;
    this.title = bwEl('div', 'bw-title', this.root);
    this.titleMain = bwEl('b', '', this.title);
    this.titleSub = bwEl('small', '', this.title);
    this.title.hidden = true;
  }

  private set(el: HTMLElement, text: string): void {
    if (this.cache.get(el) === text) return;
    this.cache.set(el, text); el.textContent = text;
  }
  show(on: boolean): void { this.root.hidden = !on; }
  reset(): void {
    this.feed.replaceChildren(); this.events.length = 0; this.cache = new Map();
    this.barsKey = ''; this.effectsKey = ''; this.rowsKey = '';
    this.pill.hidden = true; this.title.hidden = true; this.titleUntil = 0;
  }

  /** Hearts (+absorption), armour above them; hunger, air above it. */
  setSelf(s: SelfView | null): void {
    const show = !!s && !s.spectator;
    this.bars.hidden = !show;
    this.xp.hidden = !s?.bar && !s?.barLevel;
    if (s) {
      this.xpFill.style.width = `${Math.round((s.bar ?? 0) * 1000) / 10}%`;
      this.set(this.xpLevel, s.barLevel ? String(s.barLevel) : '');
    }
    if (!s || !show) return;
    const key = `${s.hp}|${s.maxHp}|${s.absorption}|${s.food}|${s.air}|${s.armor}|${s.freeze > 100 ? 1 : 0}|${s.effects.some((e) => e.id === 'poison') ? 1 : 0}`;
    if (key !== this.barsKey) { this.barsKey = key; this.drawBars(s); }
    const ekey = s.effects.map((e) => `${e.id}${e.amp}${Math.ceil(e.ticks / 20)}`).join();
    if (ekey !== this.effectsKey) {
      this.effectsKey = ekey;
      this.effects.replaceChildren();
      for (const e of s.effects) {
        if (e.ticks > 1e8 && e.id !== 'speed' && e.id !== 'haste') continue;
        const chip = bwEl('div', 'v-effect', this.effects);
        chip.style.setProperty('--c', `#${(EFFECT_COLOR[e.id as EffectId] ?? 0x888888).toString(16).padStart(6, '0')}`);
        bwEl('b', '', chip, `${EFFECT_LABEL[e.id as EffectId] ?? e.id}${e.amp > 0 ? ` ${['', 'II', 'III', 'IV', 'V'][e.amp] ?? e.amp + 1}` : ''}`);
        bwEl('small', '', chip, e.ticks > 1e8 ? '∞' : `${Math.floor(e.ticks / 1200)}:${String(Math.floor(e.ticks / 20) % 60).padStart(2, '0')}`);
      }
    }
  }
  private drawBars(s: SelfView): void {
    const ctx = this.bars.getContext('2d')!;
    ctx.clearRect(0, 0, 444, 64);
    const poison = s.effects.some((e) => e.id === 'poison');
    const frozen = s.freeze >= 140;
    const hearts = Math.ceil(s.maxHp / 2);
    const rowY = (row: number) => 48 - row * 16;
    // Hearts: rows of 10, upward.
    for (let i = 0; i < hearts; i++) {
      const v = s.hp - i * 2;
      const fill = v >= 2 ? (poison ? '#7f9a3a' : frozen ? '#7ec8f0' : '#e02020') : v >= 1 ? 'half' : 'empty';
      icon(ctx, (i % 10) * 18, rowY(Math.floor(i / 10)), HEART, (px) => fill === 'empty' ? '#3b3b3b' : fill === 'half' ? (px < 3 ? (poison ? '#7f9a3a' : '#e02020') : '#3b3b3b') : px % 6 === 1 ? '#ff7a7a' : fill);
    }
    let row = Math.ceil(hearts / 10);
    const gold = Math.ceil(s.absorption / 2);
    for (let i = 0; i < gold; i++) icon(ctx, (i % 10) * 18, rowY(row + Math.floor(i / 10)), HEART, () => '#f2c230');
    if (gold) row += Math.ceil(gold / 10);
    if (s.armor > 0) for (let i = 0; i < 10; i++) {
      const v = s.armor - i * 2;
      icon(ctx, i * 18, rowY(row), ARMOR, (px) => v >= 2 ? '#d6dadc' : v >= 1 && px < 4 ? '#d6dadc' : '#3b3b3b');
    }
    // Hunger, right to left.
    for (let i = 0; i < 10; i++) {
      const v = s.food - i * 2;
      icon(ctx, 444 - 16 - i * 18, rowY(0), SHANK, (px, py) => v >= 2 || (v >= 1 && px >= 3) ? (py < 4 && px > 3 ? '#e8b070' : '#a8632a') : '#3b3b3b');
    }
    if (s.air < s.maxAir) {
      const bubbles = Math.ceil(s.air / s.maxAir * 10);
      for (let i = 0; i < bubbles; i++) icon(ctx, 444 - 16 - i * 18, rowY(1), BUBBLE, () => '#9fd8ff');
    }
  }

  setSidebar(title: string, clock: string, next: string, rows: SidebarRow[], tone: 'calm' | 'warn' | 'danger' = 'calm'): void {
    this.set(this.sideTitle, title); this.set(this.sideClock, clock); this.set(this.sideNext, next);
    if (this.side.dataset.tone !== tone) this.side.dataset.tone = tone;
    const key = rows.map((r) => `${r.label}|${r.value}|${r.tone}|${r.you}`).join(';');
    if (key === this.rowsKey) return;
    this.rowsKey = key;
    this.sideRows.replaceChildren();
    for (const r of rows) {
      const el = bwEl('div', 'v-side-row', this.sideRows);
      if (r.tone) el.dataset.tone = r.tone;
      bwEl('span', '', el, r.label);
      bwEl('b', '', el, r.value);
      if (r.you) el.classList.add('you');
    }
  }
  /** One line in the middle (the action bar), fades after `ms`. */
  bar(text: string, color?: string, ms = 2200): void {
    this.pill.hidden = !text;
    this.set(this.pill, text);
    this.pill.style.color = color && color !== '#ffffff' ? darken(color) : '';
    this.pillUntil = performance.now() + ms;
  }
  flash(title: string, sub: string, color: string, ms: number): void {
    this.title.hidden = false;
    this.set(this.titleMain, title); this.set(this.titleSub, sub);
    this.titleMain.style.color = darken(color);
    this.title.dataset.size = 'big';
    this.title.classList.remove('pop'); void this.title.offsetWidth; this.title.classList.add('pop');
    this.titleUntil = performance.now() + Math.max(400, ms);
  }
  toast(text: string, tone = 'info'): void {
    if (!text) return;
    const node = bwEl('div', 'bw-toast', this.feed, text);
    node.dataset.tone = tone === 'death' || tone === 'danger' ? 'danger' : tone === 'legendary' || tone === 'gold' || tone === 'cheer' ? 'good' : 'info';
    this.events.push({ node, until: performance.now() + (tone === 'danger' || tone === 'death' ? 6500 : 4800) });
    while (this.events.length > 5) this.events.shift()!.node.remove();
  }
  tick(now: number): void {
    while (this.events[0] && this.events[0].until <= now) this.events.shift()!.node.remove();
    if (!this.title.hidden && now >= this.titleUntil) this.title.hidden = true;
    if (!this.pill.hidden && now >= this.pillUntil) this.pill.hidden = true;
  }
  dispose(): void { this.root.remove(); }
}

/** Light HUD panels need dark text: deepen bright Minecraft-ish colours. */
function darken(hex: string): string {
  const n = parseInt(hex.replace('#', ''), 16);
  if (!Number.isFinite(n)) return '';
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const k = (r * .3 + g * .59 + b * .11) > 150 ? .62 : 1;
  return `rgb(${Math.round(r * k)},${Math.round(g * k)},${Math.round(b * k)})`;
}
