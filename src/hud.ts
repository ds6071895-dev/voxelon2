// HUD: vanilla-style hotbar driven by the inventory (icons + stack counts),
// selection name popup, and the F3 debug overlay.

import { renderItemIcon } from './icons';
import type { Inventory } from './inventory';
import { HOTBAR_SIZE } from './inventory';
import { ITEMS } from './items';

// 7x6 pixel masks for the status icons, drawn at 2x scale.
const HEART_MASK = [
  '0110110', '1111111', '1111111', '0111110', '0011100', '0001000',
];
// A filled rounded block used as one energy-bar segment.
const ENERGY_MASK = [
  '0111110', '1111111', '1111111', '1111111', '1111111', '0111110',
];
const BUBBLE_MASK = [
  '0011100', '0111110', '0110110', '0111110', '0011100', '0000000',
];
// A chestplate-ish shield for one armor segment (2 defense points each).
const ARMOR_MASK = [
  '0111110', '1111111', '1111111', '1111111', '0111110', '0011100',
];

function drawIcon(
  ctx: CanvasRenderingContext2D, x: number, mask: string[],
  fill: (px: number, py: number) => string | null
): void {
  for (let py = 0; py < mask.length; py++) {
    for (let px = 0; px < 7; px++) {
      if (mask[py][px] !== '1') continue;
      const c = fill(px, py);
      if (!c) continue;
      ctx.fillStyle = c;
      ctx.fillRect(x + px * 2, 4 + py * 2, 2, 2);
    }
  }
}

export interface StatusInfo {
  health: number;
  /** Stamina, 0..1. */
  energy: number;
  /** True when energy is depleted and sprinting is locked out. */
  exhausted: boolean;
  air: number;
  maxAir: number;
  underwater: boolean;
  /** Effective worn-armor defense points (0..20); the bar hides at 0. */
  armor: number;
}

export interface DebugInfo {
  fps: number;
  x: number; y: number; z: number;
  cx: number; cz: number;
  facing: string;
  target: string;
  time: string;
}

export class HUD {
  private readonly inventory: Inventory;
  private readonly atlasCanvas: HTMLCanvasElement;
  private readonly slots: HTMLDivElement[] = [];
  private readonly icons: HTMLCanvasElement[] = [];
  private readonly counts: HTMLSpanElement[] = [];
  private readonly cooldowns: HTMLDivElement[] = [];
  /** Returns 0..1 of an item's cooldown remaining (1 = just used). */
  cooldownOf?: (itemId: number) => number;
  private readonly debugEl: HTMLElement;
  private readonly nameEl: HTMLDivElement;
  private nameTimer: number | undefined;
  private renderedVersion = -1;
  private lastSelected = -1;
  debugVisible = false;

  constructor(atlasCanvas: HTMLCanvasElement, inventory: Inventory) {
    this.inventory = inventory;
    this.atlasCanvas = atlasCanvas;
    const hotbar = document.getElementById('hotbar')!;
    this.debugEl = document.getElementById('debug')!;

    for (let i = 0; i < HOTBAR_SIZE; i++) {
      const slot = document.createElement('div');
      slot.className = 'slot';
      const icon = document.createElement('canvas');
      icon.width = 32;
      icon.height = 32;
      const count = document.createElement('span');
      count.className = 'count mc-font';
      // Cooldown sweep overlay (ender-pearl style: a dark band that shrinks from
      // full to empty as the cooldown elapses).
      const cd = document.createElement('div');
      cd.style.cssText =
        'position:absolute;left:0;right:0;bottom:0;height:0;pointer-events:none;' +
        'background:rgba(10,14,22,0.6);';
      slot.style.position = 'relative';
      slot.appendChild(icon);
      slot.appendChild(count);
      slot.appendChild(cd);
      hotbar.appendChild(slot);
      this.slots.push(slot);
      this.icons.push(icon);
      this.counts.push(count);
      this.cooldowns.push(cd);
    }

    // Item name popup above the hotbar, like vanilla.
    this.nameEl = document.createElement('div');
    this.nameEl.className = 'mc-font';
    this.nameEl.style.cssText =
      'position:absolute;bottom:70px;left:50%;transform:translateX(-50%);' +
      'font-size:16px;z-index:10;pointer-events:none;transition:opacity 0.5s;' +
      'opacity:0;';
    document.getElementById('app')!.appendChild(this.nameEl);

    this.refresh();
  }

  /** Redraw when the inventory changed; call once per frame. */
  update(): void {
    if (this.inventory.version === this.renderedVersion) return;
    const selectionChanged = this.inventory.selected !== this.lastSelected;
    this.refresh();
    if (selectionChanged) this.showName();
  }

  /** Refresh the per-slot cooldown sweep (call every frame; cheap). */
  updateCooldowns(): void {
    if (!this.cooldownOf) return;
    for (let i = 0; i < HOTBAR_SIZE; i++) {
      const stack = this.inventory.slots[i];
      const frac = stack ? Math.max(0, Math.min(1, this.cooldownOf(stack.id))) : 0;
      this.cooldowns[i].style.height = `${frac * 100}%`;
    }
  }

  private refresh(): void {
    this.renderedVersion = this.inventory.version;
    this.lastSelected = this.inventory.selected;
    for (let i = 0; i < HOTBAR_SIZE; i++) {
      const stack = this.inventory.slots[i];
      this.slots[i].classList.toggle('selected', i === this.inventory.selected);
      if (stack) {
        renderItemIcon(this.icons[i], this.atlasCanvas, stack.id);
        this.counts[i].textContent = stack.count > 1 ? String(stack.count) : '';
      } else {
        this.icons[i].getContext('2d')!.clearRect(0, 0, 32, 32);
        this.counts[i].textContent = '';
      }
    }
  }

  private showName(): void {
    const stack = this.inventory.selectedStack;
    if (!stack) return;
    this.nameEl.textContent = ITEMS[stack.id]?.name ?? '';
    this.nameEl.style.opacity = '1';
    window.clearTimeout(this.nameTimer);
    this.nameTimer = window.setTimeout(() => {
      this.nameEl.style.opacity = '0';
    }, 1500);
  }

  private lastStatus = '';

  /** Hearts (left), blue energy bar (right), bubbles when submerged. */
  updateStatus(s: StatusInfo): void {
    const key = `${s.health}|${Math.round(s.energy * 40)}|${s.exhausted}|` +
      `${Math.ceil(s.air)}|${s.underwater}|${Math.round(s.armor * 2)}`;
    if (key === this.lastStatus) return;
    this.lastStatus = key;

    const hearts = (document.getElementById('hearts') as HTMLCanvasElement)
      .getContext('2d')!;
    hearts.clearRect(0, 0, 202, 20);
    for (let i = 0; i < 10; i++) {
      const v = s.health - i * 2; // 2 HP per heart
      drawIcon(hearts, i * 20, HEART_MASK, (px) => {
        if (v >= 2) return px % 6 === 1 ? '#ff6a6a' : '#e02020';
        if (v >= 1) return px < 3 ? '#e02020' : '#3b3b3b';
        return '#3b3b3b';
      });
    }

    // Energy: 10 blue segments filling left→right; dim red while exhausted.
    const energy = (document.getElementById('energybar') as HTMLCanvasElement)
      .getContext('2d')!;
    energy.clearRect(0, 0, 202, 20);
    const lit = s.exhausted ? '#b25555' : '#4db8ff';
    const litEdge = s.exhausted ? '#d98a8a' : '#a6e0ff';
    for (let i = 0; i < 10; i++) {
      const on = s.energy * 10 > i;
      drawIcon(energy, i * 20 + 2, ENERGY_MASK, (px, py) =>
        on ? (px <= 1 || py <= 1 ? litEdge : lit) : '#26303a'
      );
    }

    const bubbles = (document.getElementById('bubbles') as HTMLCanvasElement)
      .getContext('2d')!;
    bubbles.clearRect(0, 0, 202, 20);
    if (s.underwater || s.air < s.maxAir) {
      for (let i = 0; i < 10; i++) {
        const threshold = ((9 - i) + 1) * (s.maxAir / 10);
        drawIcon(bubbles, i * 20 + 2, BUBBLE_MASK, (px, py) =>
          s.air >= threshold - 0.001
            ? (px === 2 && py === 1 ? '#ffffff' : '#4d9be8')
            : null
        );
      }
    }

    // Armor: 10 shields above the hearts, each worth 2 defense points (vanilla).
    const armor = (document.getElementById('armor') as HTMLCanvasElement)
      .getContext('2d')!;
    armor.clearRect(0, 0, 202, 20);
    if (s.armor > 0) {
      for (let i = 0; i < 10; i++) {
        const v = s.armor - i * 2;
        drawIcon(armor, i * 20, ARMOR_MASK, (px) => {
          if (v >= 2) return px % 6 === 1 ? '#e8eef5' : '#a9b6c6';
          if (v >= 1) return px < 3 ? '#a9b6c6' : '#2b2f36';
          return '#2b2f36';
        });
      }
    }
  }

  toggleDebug(): void {
    this.debugVisible = !this.debugVisible;
    this.debugEl.style.display = this.debugVisible ? 'block' : 'none';
  }

  updateDebug(info: DebugInfo): void {
    if (!this.debugVisible) return;
    const lines = [
      `VOXELON (three.js)`,
      `${info.fps} fps`,
      ``,
      `XYZ: ${info.x.toFixed(3)} / ${info.y.toFixed(5)} / ${info.z.toFixed(3)}`,
      `Block: ${Math.floor(info.x)} ${Math.floor(info.y)} ${Math.floor(info.z)}`,
      `Chunk: ${info.cx} ${info.cz}`,
      `Facing: ${info.facing}`,
      `Targeted: ${info.target}`,
      `Time: ${info.time}`,
    ];
    this.debugEl.innerHTML = lines
      .map((l) => (l ? `<span class="line">${l}</span>` : '&nbsp;'))
      .join('<br>');
  }
}
