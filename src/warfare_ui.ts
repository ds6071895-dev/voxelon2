// WARFARE COMMAND — the technology-tree screen (replaces the old inline
// Progress panel that lived in main.ts).
//
// Visual direction: a dark navy command table. A blueprint grid and a slow
// radar sweep sit behind an SVG connection layer; DOM buttons (real, focusable,
// keyboard-navigable) sit on top of it. Cyan circuitry links what you could
// buy, gold marks what you own, green marks what you can afford right now, and
// red is reserved for blocked actions and incoming threats. Nothing relies on
// hover, and no browser `title` tooltips are used anywhere.
//
// Desktop gets a pan-and-zoom viewport with a fixed detail + 3D-preview rail.
// Mobile gets a full-screen, safe-area-aware tree with 48px targets, branch
// filter chips, explicit zoom/recenter buttons, and a bottom sheet for the
// selected technology.

import * as THREE from 'three';
import {
  WARFARE_BRANCH_META, WARFARE_TREE, WARFARE_TREE_COST, WarfareBranch,
  WarfareNode, WarfareProgress, batteryStats, canBuyWarfareNode, helicopterStats,
  siloStats, tierLabel, warfareAvailable, warfareBlockReason, warfareCompletion,
  warfareOwns, warfareSpent, warfareUnlocked,
} from './warfare';
import { buildBatteryModel, buildMissileModel, buildSiloModel } from './warfare_models';
import { buildHelicopterModel } from './vehiclemodels';

const NAVY_0 = '#080c16';
const NAVY_1 = '#0d1524';
const NAVY_2 = '#131d31';
const LINE = '#26374f';
const CYAN = '#5ce2ec';
const CYAN_DIM = '#2b6b7a';
const GOLD = '#ffd24a';
const GOLD_DIM = '#7a5c14';
const GREEN = '#5ff09a';
const RED = '#ff5c4d';
const TEXT = '#dce6f5';
const TEXT_DIM = '#7f93b3';

/** Grid spacing in tree units. */
const COL = 224;
const ROW = 132;

const BRANCH_X: Record<WarfareBranch, number> = {
  trunk: 0, strike: -1.18, aegis: 0, air: 1.18,
};

/** Does the viewer want reduced motion? Previews stop auto-rotating if so. */
function reducedMotion(): boolean {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; }
  catch { return false; }
}

// --- The reusable 3D preview ---------------------------------------------------

/**
 * ONE renderer, reused for every node preview and for the mobile bottom sheet.
 * It is explicitly paused whenever the panel is hidden, so a closed tree costs
 * nothing per frame.
 */
class PreviewRenderer {
  readonly canvas: HTMLCanvasElement;
  /** Created on FIRST USE, not at page load: the game already owns a WebGL
   *  context (plus the title panorama's), and a tree nobody has opened should
   *  not cost a third one. */
  private renderer: THREE.WebGLRenderer | null = null;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly pivot = new THREE.Group();
  private current: THREE.Object3D | null = null;
  private running = false;
  private raf = 0;
  private last = 0;
  private spin = 0;
  private key = '';
  private width: number;
  private height: number;

  constructor(width = 320, height = 240) {
    this.canvas = document.createElement('canvas');
    this.width = width;
    this.height = height;
    this.camera = new THREE.PerspectiveCamera(38, width / height, 0.1, 100);
    this.scene.add(this.pivot);
  }

  /** The renderer, created on demand. Null if WebGL is unavailable — the panel
   *  then simply shows an empty preview frame instead of failing to open. */
  private gl(): THREE.WebGLRenderer | null {
    if (this.renderer) return this.renderer;
    try {
      this.renderer = new THREE.WebGLRenderer({
        canvas: this.canvas, antialias: true, alpha: true,
      });
      this.renderer.setClearColor(0x000000, 0);
      this.resize(this.width, this.height);
    } catch {
      this.renderer = null;
    }
    return this.renderer;
  }

  resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix();
    if (!this.renderer) return;
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.setSize(width, height, false);
  }

  /** Swap the previewed hardware. `key` dedupes rebuilds of the same model. */
  show(key: string, build: () => { object: THREE.Object3D; distance: number; lift: number }): void {
    if (key === this.key) return;
    this.key = key;
    if (this.current) {
      this.pivot.remove(this.current);
      this.current.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.geometry) m.geometry.dispose();
      });
    }
    const { object, distance, lift } = build();
    object.position.y -= lift;
    this.current = object;
    this.pivot.add(object);
    this.camera.position.set(0, distance * 0.34, distance);
    this.camera.lookAt(0, 0, 0);
    this.spin = 0.7;
  }

  start(): void {
    if (this.running) return;
    const gl = this.gl();
    if (!gl) return;
    this.running = true;
    this.last = performance.now();
    const loop = (): void => {
      if (!this.running) return;
      const now = performance.now();
      const dt = Math.min(0.05, (now - this.last) / 1000);
      this.last = now;
      if (!reducedMotion()) this.spin += dt * 0.55;
      this.pivot.rotation.y = this.spin;
      gl.render(this.scene, this.camera);
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop(): void {
    this.running = false;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  /** One-shot render, for reduced-motion viewers who never get an animation. */
  renderOnce(): void {
    const gl = this.gl();
    if (!gl) return;
    this.pivot.rotation.y = this.spin;
    gl.render(this.scene, this.camera);
  }
}

/** Build the right hardware model for a node, at the tier that node grants. */
function previewFor(node: WarfareNode, tint: number): {
  object: THREE.Object3D; distance: number; lift: number;
} {
  if (node.hardware === 'silo') {
    // A silo node previews the pad — except the very first, where the point of
    // the unlock is the missile itself.
    if (node.id === 'missile_command' || node.id === 'strike_warhead') {
      const m = buildMissileModel(tint);
      m.flame.visible = false; m.flameCore.visible = false;
      return { object: m.group, distance: 5.2, lift: 0 };
    }
    return { object: buildSiloModel(node.tier, tint).group, distance: 6.4, lift: 1.1 };
  }
  if (node.hardware === 'battery') {
    return { object: buildBatteryModel(node.tier, tint).group, distance: 3.6, lift: 0.55 };
  }
  return { object: buildHelicopterModel(node.tier, tint).group, distance: 7.6, lift: 0 };
}

// --- Stat rows ------------------------------------------------------------------

interface StatRow { label: string; from: string; to: string; better: boolean }

/** The concrete before/after this purchase produces, for the detail panel. */
function statDiff(node: WarfareNode): StatRow[] {
  const rows: StatRow[] = [];
  const push = (
    label: string, a: number, b: number, unit = '', lowerIsBetter = false,
  ): void => {
    if (a === b) return;
    rows.push({
      label,
      from: `${round(a)}${unit}`, to: `${round(b)}${unit}`,
      better: lowerIsBetter ? b < a : b > a,
    });
  };
  const round = (n: number): string =>
    Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');

  if (node.hardware === 'silo') {
    const a = siloStats(Math.max(1, node.tier - 1)), b = siloStats(node.tier);
    if (node.tier === 1) {
      rows.push({ label: 'Tactical Silo', from: 'locked', to: 'unlocked', better: true });
    }
    push('Target range', a.range, b.range, ' blocks');
    push('Cruise speed', a.speed, b.speed, ' b/s');
    push('Silo HP', a.hp, b.hp);
    push('Magazine', a.magazine, b.magazine);
    push('Silo cooldown', a.cooldown, b.cooldown, 's', true);
    push('Blast radius', a.blastRadius, b.blastRadius, ' blocks');
    push('Centre player damage', a.playerDamage, b.playerDamage);
    push('Centre hardware damage', a.hardwareDamage, b.hardwareDamage);
    push('Player-built blocks removed', a.blocks, b.blocks);
  } else if (node.hardware === 'battery') {
    const a = batteryStats(Math.max(1, node.tier - 1)), b = batteryStats(node.tier);
    if (node.tier === 1) {
      rows.push({ label: 'Interceptor Turret', from: 'locked', to: 'unlocked', better: true });
    }
    push('Battery HP', a.hp, b.hp);
    push('Defense radius', a.radius, b.radius, ' blocks');
    push('Acquisition', a.acquire, b.acquire, 's', true);
    push('Reload', a.reload, b.reload, 's', true);
    push('Capacity', a.capacity, b.capacity);
    if (a.networked !== b.networked) {
      rows.push({ label: 'Shared tracks', from: 'no', to: 'yes', better: true });
    }
  } else {
    const a = helicopterStats(Math.max(1, node.tier - 1)), b = helicopterStats(node.tier);
    if (node.tier === 1) {
      rows.push({ label: 'Helicopter', from: 'locked', to: 'unlocked', better: true });
    }
    push('Airframe HP', a.hp, b.hp);
    push('Cruise speed', a.speed, b.speed, ' b/s');
    push('Climb rate', a.climb, b.climb, ' b/s');
    push('Fuel capacity', a.fuel, b.fuel, ' oil');
    push('Bombs', a.bombs, b.bombs);
    push('Bomb radius', a.bombRadius, b.bombRadius, ' blocks');
    push('Bomb player damage', a.bombPlayerDamage, b.bombPlayerDamage);
    push('Bomb hardware damage', a.bombHardwareDamage, b.bombHardwareDamage);
    push('Bomb cooldown', a.bombCooldown, b.bombCooldown, 's', true);
    push('Altitude allowance', a.altitude, b.altitude, ' blocks');
  }
  return rows;
}

// --- The screen -------------------------------------------------------------------

export interface WarfareUIHooks {
  /** Ask the authority to buy a node (server online / local offline). */
  buy: (id: string) => void;
  /** Current progression to render. */
  state: () => WarfareProgress;
  /** Faction colour for markings on the previews. */
  tint: () => string;
  /** Called when the panel opens/closes so the game can lock/unlock input. */
  onOpen?: () => void;
  onClose?: () => void;
  /** Optional confirmation sound on a successful purchase. */
  onPurchase?: (node: WarfareNode) => void;
}

export class WarfareUI {
  readonly root: HTMLDivElement;
  open = false;

  private readonly viewport: HTMLDivElement;
  private readonly canvasLayer: SVGSVGElement;
  private readonly nodeLayer: HTMLDivElement;
  private readonly world: HTMLDivElement;
  private readonly rail: HTMLDivElement;
  private readonly sheet: HTMLDivElement;
  private readonly header: HTMLDivElement;
  private readonly chips: HTMLDivElement;
  private readonly preview: PreviewRenderer;
  private readonly buttons = new Map<string, HTMLButtonElement>();
  private readonly edges = new Map<string, SVGPathElement>();
  private readonly sweep: SVGGElement;

  private selected = WARFARE_TREE[0].id;
  private panX = 0;
  private panY = 0;
  private zoom = 1;
  private dragging = false;
  private dragStart = { x: 0, y: 0, px: 0, py: 0 };
  private filter: WarfareBranch | 'all' = 'all';
  private mobile = false;
  private raf = 0;
  private clock = 0;

  constructor(private readonly hooks: WarfareUIHooks) {
    this.root = document.createElement('div');
    this.root.className = 'mc-font';
    this.root.style.cssText =
      'position:absolute;inset:0;display:none;z-index:36;color:' + TEXT + ';' +
      'text-shadow:none;font-size:13px;background:' + NAVY_0 + ';' +
      'padding:env(safe-area-inset-top) env(safe-area-inset-right) ' +
      'env(safe-area-inset-bottom) env(safe-area-inset-left);box-sizing:border-box;';

    // --- header ---
    this.header = document.createElement('div');
    this.header.style.cssText =
      'position:absolute;top:0;left:0;right:0;height:52px;display:flex;align-items:center;' +
      'gap:14px;padding:0 14px;box-sizing:border-box;background:' + NAVY_1 + ';' +
      'border-bottom:1px solid ' + LINE + ';z-index:3;';
    this.root.appendChild(this.header);

    // --- viewport (pan + zoom) ---
    this.viewport = document.createElement('div');
    this.viewport.style.cssText =
      'position:absolute;top:52px;left:0;right:0;bottom:0;overflow:hidden;' +
      'touch-action:none;cursor:grab;';
    this.root.appendChild(this.viewport);

    // Blueprint grid + radar sweep behind everything.
    const bg = document.createElement('div');
    bg.style.cssText =
      'position:absolute;inset:0;pointer-events:none;' +
      'background-color:' + NAVY_0 + ';' +
      'background-image:' +
      'linear-gradient(rgba(92,226,236,0.055) 1px, transparent 1px),' +
      'linear-gradient(90deg, rgba(92,226,236,0.055) 1px, transparent 1px),' +
      'linear-gradient(rgba(92,226,236,0.11) 1px, transparent 1px),' +
      'linear-gradient(90deg, rgba(92,226,236,0.11) 1px, transparent 1px);' +
      'background-size:28px 28px,28px 28px,140px 140px,140px 140px;';
    this.viewport.appendChild(bg);

    this.world = document.createElement('div');
    this.world.style.cssText = 'position:absolute;left:50%;top:70px;transform-origin:0 0;';
    this.viewport.appendChild(this.world);

    this.canvasLayer = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.canvasLayer.setAttribute('width', '1600');
    this.canvasLayer.setAttribute('height', '1800');
    this.canvasLayer.style.cssText =
      'position:absolute;left:-800px;top:-90px;overflow:visible;pointer-events:none;';
    this.world.appendChild(this.canvasLayer);

    // Slow radar sweep — a rotating translucent wedge behind the circuitry.
    this.sweep = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    const wedge = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    wedge.setAttribute('d', 'M0,0 L900,-330 A960,960 0 0,1 900,330 Z');
    wedge.setAttribute('fill', 'rgba(92,226,236,0.05)');
    this.sweep.appendChild(wedge);
    this.sweep.setAttribute('transform', 'translate(800 700)');
    this.canvasLayer.appendChild(this.sweep);

    this.nodeLayer = document.createElement('div');
    this.nodeLayer.style.cssText = 'position:absolute;left:0;top:0;';
    this.world.appendChild(this.nodeLayer);

    // --- desktop detail rail ---
    this.rail = document.createElement('div');
    this.rail.style.cssText =
      'position:absolute;top:52px;right:0;bottom:0;width:372px;box-sizing:border-box;' +
      'background:' + NAVY_1 + ';border-left:1px solid ' + LINE + ';' +
      'overflow-y:auto;padding:14px;z-index:2;';
    this.root.appendChild(this.rail);

    // --- mobile bottom sheet + branch chips ---
    this.chips = document.createElement('div');
    this.chips.style.cssText =
      'position:absolute;top:56px;left:0;right:0;display:none;gap:8px;padding:6px 10px;' +
      'overflow-x:auto;z-index:3;white-space:nowrap;';
    this.root.appendChild(this.chips);

    this.sheet = document.createElement('div');
    this.sheet.style.cssText =
      'position:absolute;left:0;right:0;bottom:0;display:none;max-height:62%;' +
      'overflow-y:auto;background:' + NAVY_1 + ';border-top:2px solid ' + LINE + ';' +
      'border-radius:14px 14px 0 0;padding:12px 14px calc(14px + env(safe-area-inset-bottom));' +
      'box-shadow:0 -12px 40px rgba(0,0,0,0.6);z-index:4;';
    this.root.appendChild(this.sheet);

    this.preview = new PreviewRenderer(340, 220);
    this.preview.canvas.style.cssText =
      'width:100%;height:auto;display:block;border:1px solid ' + LINE + ';' +
      'border-radius:8px;background:radial-gradient(circle at 50% 40%,#16233a,#0a1120);';

    this.buildTree();
    this.buildHeader();
    this.buildChips();
    this.bindInput();
    this.recenter();
  }

  // --- construction ----------------------------------------------------------

  private nodeXY(n: WarfareNode): { x: number; y: number } {
    return { x: BRANCH_X[n.branch] * COL, y: n.depth * ROW };
  }

  private buildTree(): void {
    // Connection layer first, so the DOM buttons sit above it.
    for (const n of WARFARE_TREE) {
      if (!n.prereq) continue;
      const from = WARFARE_TREE.find((p) => p.id === n.prereq)!;
      const a = this.nodeXY(from), b = this.nodeXY(n);
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      // An elbowed circuit-board trace rather than a straight line: down out of
      // the parent, across, then down into the child.
      const midY = (a.y + b.y) / 2;
      const d = a.x === b.x
        ? `M ${800 + a.x} ${90 + a.y + 44} L ${800 + b.x} ${90 + b.y - 44}`
        : `M ${800 + a.x} ${90 + a.y + 44} L ${800 + a.x} ${90 + midY} ` +
          `L ${800 + b.x} ${90 + midY} L ${800 + b.x} ${90 + b.y - 44}`;
      path.setAttribute('d', d);
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke-width', '3');
      path.setAttribute('stroke-linecap', 'round');
      path.setAttribute('stroke-linejoin', 'round');
      this.canvasLayer.appendChild(path);
      this.edges.set(n.id, path);
    }

    for (const n of WARFARE_TREE) {
      const p = this.nodeXY(n);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'mc-font';
      btn.dataset.node = n.id;
      btn.dataset.branch = n.branch;
      // Hexagons. Capstones are noticeably larger, as are the three system
      // UNLOCK nodes (the ones that hand you a whole new machine).
      const unlock = n.tier === 1;
      const size = n.capstone ? 112 : unlock ? 100 : 84;
      btn.style.cssText =
        `position:absolute;left:${800 + p.x - size / 2}px;top:${90 + p.y - size / 2}px;` +
        `width:${size}px;height:${size}px;padding:0;cursor:pointer;` +
        'display:flex;flex-direction:column;align-items:center;justify-content:center;' +
        'gap:2px;font-family:inherit;text-shadow:none;' +
        'clip-path:polygon(50% 0%,93% 25%,93% 75%,50% 100%,7% 75%,7% 25%);' +
        'transition:transform 0.12s ease;';
      btn.innerHTML =
        `<span style="font-size:${n.capstone ? 26 : 21}px;line-height:1">${n.icon}</span>` +
        `<span data-cost style="font-size:10px;letter-spacing:0.5px"></span>`;
      // Real accessible labels instead of a browser tooltip.
      btn.setAttribute('aria-label', `${n.name} — ${n.cost} warfare XP`);
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.select(n.id);
      });
      this.nodeLayer.appendChild(btn);
      this.buttons.set(n.id, btn);

      // The name plate sits OUTSIDE the clipped hexagon so it stays readable.
      const label = document.createElement('div');
      label.textContent = n.name;
      label.dataset.label = n.id;
      label.style.cssText =
        `position:absolute;left:${800 + p.x - 110}px;top:${90 + p.y + size / 2 + 3}px;` +
        'width:220px;text-align:center;font-size:11px;color:' + TEXT_DIM + ';' +
        'pointer-events:none;line-height:1.25;';
      this.nodeLayer.appendChild(label);
    }
  }

  private buildHeader(): void {
    this.header.innerHTML =
      `<div style="font-size:15px;letter-spacing:2px;color:${CYAN}">⌘ WARFARE COMMAND</div>` +
      `<div data-xp style="color:${TEXT_DIM};font-size:11px"></div>` +
      `<div style="flex:1"></div>` +
      `<div data-bar style="width:180px;height:8px;background:#0a1120;border:1px solid ${LINE};` +
      `border-radius:5px;overflow:hidden"><div data-fill style="height:100%;width:0%;` +
      `background:linear-gradient(90deg,${CYAN},${GOLD})"></div></div>` +
      `<div data-pct style="font-size:11px;color:${TEXT_DIM};min-width:34px"></div>` +
      `<button data-recenter class="mc-font" style="height:32px;padding:0 10px;cursor:pointer;` +
      `border:1px solid ${LINE};border-radius:6px;background:${NAVY_2};color:${TEXT};` +
      `font-family:inherit;font-size:11px">Recentre</button>` +
      `<button data-close class="mc-font" style="width:32px;height:32px;cursor:pointer;` +
      `border:1px solid ${LINE};border-radius:6px;background:${NAVY_2};color:${TEXT};` +
      `font-family:inherit;font-size:14px">✕</button>`;
    this.header.querySelector('[data-close]')!.addEventListener('click', () => this.hide());
    this.header.querySelector('[data-recenter]')!.addEventListener('click', () => {
      this.recenter();
      this.applyTransform();
    });
  }

  private buildChips(): void {
    const mk = (id: WarfareBranch | 'all', text: string): HTMLButtonElement => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'mc-font';
      b.textContent = text;
      b.dataset.chip = id;
      b.style.cssText =
        'min-height:34px;padding:0 12px;border-radius:17px;cursor:pointer;font-family:inherit;' +
        `font-size:11px;border:1px solid ${LINE};background:${NAVY_2};color:${TEXT_DIM};`;
      b.addEventListener('click', () => { this.filter = id; this.refresh(); });
      this.chips.appendChild(b);
      return b;
    };
    mk('all', 'All');
    for (const key of ['trunk', 'strike', 'aegis', 'air'] as WarfareBranch[]) {
      mk(key, `${WARFARE_BRANCH_META[key].icon} ${WARFARE_BRANCH_META[key].name}`);
    }
    // Explicit zoom + recentre for touch (no pinch-only affordances).
    const zoomWrap = document.createElement('div');
    zoomWrap.style.cssText =
      'position:absolute;right:10px;bottom:calc(12px + env(safe-area-inset-bottom));' +
      'display:none;flex-direction:column;gap:8px;z-index:5;';
    for (const [text, fn] of [
      ['+', () => this.setZoom(this.zoom * 1.25)],
      ['−', () => this.setZoom(this.zoom / 1.25)],
      ['⌖', () => { this.recenter(); this.applyTransform(); }],
    ] as [string, () => void][]) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'mc-font';
      b.textContent = text;
      b.style.cssText =
        `width:48px;height:48px;border-radius:24px;cursor:pointer;font-family:inherit;` +
        `font-size:18px;border:1px solid ${LINE};background:${NAVY_2};color:${TEXT};`;
      b.addEventListener('click', fn);
      zoomWrap.appendChild(b);
    }
    zoomWrap.dataset.zoomControls = '1';
    this.root.appendChild(zoomWrap);
  }

  // --- interaction ------------------------------------------------------------

  private bindInput(): void {
    this.viewport.addEventListener('pointerdown', (e) => {
      this.dragging = true;
      this.viewport.style.cursor = 'grabbing';
      this.dragStart = { x: e.clientX, y: e.clientY, px: this.panX, py: this.panY };
      this.viewport.setPointerCapture(e.pointerId);
    });
    this.viewport.addEventListener('pointermove', (e) => {
      if (!this.dragging) return;
      this.panX = this.dragStart.px + (e.clientX - this.dragStart.x);
      this.panY = this.dragStart.py + (e.clientY - this.dragStart.y);
      this.applyTransform();
    });
    const end = (e: PointerEvent): void => {
      this.dragging = false;
      this.viewport.style.cursor = 'grab';
      try { this.viewport.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    };
    this.viewport.addEventListener('pointerup', end);
    this.viewport.addEventListener('pointercancel', end);
    this.viewport.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.setZoom(this.zoom * (e.deltaY < 0 ? 1.12 : 1 / 1.12));
    }, { passive: false });

    this.root.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); this.hide(); return; }
      if (e.key === 'Home') { e.preventDefault(); this.select(WARFARE_TREE[0].id, true); return; }
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        this.authorize();
        return;
      }
      const dir = e.key === 'ArrowUp' ? 'up' : e.key === 'ArrowDown' ? 'down'
        : e.key === 'ArrowLeft' ? 'left' : e.key === 'ArrowRight' ? 'right' : null;
      if (!dir) return;
      e.preventDefault();
      this.navigate(dir);
    });
  }

  /** Arrow-key navigation: nearest node in that direction, tree-space. */
  private navigate(dir: 'up' | 'down' | 'left' | 'right'): void {
    const cur = WARFARE_TREE.find((n) => n.id === this.selected);
    if (!cur) return;
    const here = this.nodeXY(cur);
    let best: WarfareNode | null = null;
    let bestScore = Infinity;
    for (const n of WARFARE_TREE) {
      if (n.id === cur.id || !this.visible(n)) continue;
      const p = this.nodeXY(n);
      const dx = p.x - here.x, dy = p.y - here.y;
      const along = dir === 'up' ? -dy : dir === 'down' ? dy : dir === 'left' ? -dx : dx;
      const across = dir === 'up' || dir === 'down' ? Math.abs(dx) : Math.abs(dy);
      if (along <= 1) continue;
      const score = along + across * 2.2;
      if (score < bestScore) { bestScore = score; best = n; }
    }
    if (best) this.select(best.id, true);
  }

  private visible(n: WarfareNode): boolean {
    if (this.filter === 'all') return true;
    if (this.filter === 'trunk') return n.branch === 'trunk';
    return n.branch === this.filter || n.branch === 'trunk';
  }

  private setZoom(z: number): void {
    this.zoom = Math.max(0.42, Math.min(1.8, z));
    this.applyTransform();
  }

  private applyTransform(): void {
    this.world.style.transform =
      `translate(${this.panX}px, ${this.panY}px) scale(${this.zoom})`;
  }

  private recenter(): void {
    const n = WARFARE_TREE.find((x) => x.id === this.selected) ?? WARFARE_TREE[0];
    const p = this.nodeXY(n);
    const w = this.viewport.clientWidth || window.innerWidth;
    const h = this.viewport.clientHeight || window.innerHeight;
    const railW = this.mobile ? 0 : 372;
    this.zoom = this.mobile ? 0.72 : 0.9;
    this.panX = (w - railW) / 2 - p.x * this.zoom;
    this.panY = h * 0.34 - (90 + p.y) * this.zoom;
  }

  select(id: string, scroll = false): void {
    this.selected = id;
    if (scroll) {
      const n = WARFARE_TREE.find((x) => x.id === id);
      if (n) {
        const p = this.nodeXY(n);
        const w = this.viewport.clientWidth || window.innerWidth;
        const h = this.viewport.clientHeight || window.innerHeight;
        const railW = this.mobile ? 0 : 372;
        this.panX = (w - railW) / 2 - p.x * this.zoom;
        this.panY = h * 0.36 - (90 + p.y) * this.zoom;
        this.applyTransform();
      }
    }
    this.refresh();
  }

  /** The explicit purchase step — clicking a node never buys it. */
  private authorize(): void {
    const node = WARFARE_TREE.find((n) => n.id === this.selected);
    if (!node) return;
    const state = this.hooks.state();
    if (!canBuyWarfareNode(state, node.id)) return;
    this.hooks.buy(node.id);
    this.hooks.onPurchase?.(node);
    this.refresh();
  }

  // --- rendering ---------------------------------------------------------------

  show(): void {
    if (this.open) return;
    this.open = true;
    this.root.style.display = 'block';
    this.root.tabIndex = -1;
    this.mobile = window.innerWidth < 900;
    this.layoutMode();
    this.recenter();
    this.applyTransform();
    this.refresh();
    this.preview.start();
    this.root.focus();
    this.hooks.onOpen?.();
    const loop = (): void => {
      if (!this.open) return;
      this.clock += 1 / 60;
      if (!reducedMotion()) {
        this.sweep.setAttribute('transform',
          `translate(800 700) rotate(${(this.clock * 14) % 360})`);
      }
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  hide(): void {
    if (!this.open) return;
    this.open = false;
    this.root.style.display = 'none';
    // Previews are explicitly paused while hidden — a closed tree costs nothing.
    this.preview.stop();
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.hooks.onClose?.();
  }

  toggle(): void { if (this.open) this.hide(); else this.show(); }

  /** Re-run the responsive layout (also safe to call on resize). */
  layoutMode(): void {
    this.mobile = window.innerWidth < 900;
    this.rail.style.display = this.mobile ? 'none' : 'block';
    this.sheet.style.display = this.mobile ? 'block' : 'none';
    this.chips.style.display = this.mobile ? 'flex' : 'none';
    this.viewport.style.top = this.mobile ? '96px' : '52px';
    this.viewport.style.right = this.mobile ? '0' : '372px';
    const zc = this.root.querySelector('[data-zoom-controls]') as HTMLElement | null;
    if (zc) zc.style.display = this.mobile ? 'flex' : 'none';
    this.preview.resize(this.mobile ? 300 : 340, this.mobile ? 190 : 220);
  }

  /** Repaint everything from the current authoritative progression. */
  refresh(): void {
    if (!this.open) return;
    const state = this.hooks.state();
    const available = warfareAvailable(state);
    const spent = warfareSpent(state);

    // Header numbers.
    const xpEl = this.header.querySelector('[data-xp]') as HTMLElement;
    xpEl.innerHTML =
      `<span style="color:${GOLD}">${state.xp.toLocaleString()}</span> earned · ` +
      `<span style="color:${available > 0 ? GREEN : TEXT_DIM}">${available.toLocaleString()}</span> available · ` +
      `${spent.toLocaleString()} / ${WARFARE_TREE_COST.toLocaleString()} spent`;
    const pct = warfareCompletion(state);
    (this.header.querySelector('[data-fill]') as HTMLElement).style.width = `${(pct * 100).toFixed(1)}%`;
    (this.header.querySelector('[data-pct]') as HTMLElement).textContent = `${Math.round(pct * 100)}%`;

    // Chips.
    for (const chip of this.chips.querySelectorAll('[data-chip]')) {
      const el = chip as HTMLElement;
      const on = el.dataset.chip === this.filter;
      el.style.background = on ? CYAN_DIM : NAVY_2;
      el.style.color = on ? '#eafcff' : TEXT_DIM;
      el.style.borderColor = on ? CYAN : LINE;
    }

    // Nodes.
    for (const n of WARFARE_TREE) {
      const btn = this.buttons.get(n.id)!;
      const owned = warfareOwns(state, n.id);
      const unlocked = warfareUnlocked(state, n.id);
      const affordable = canBuyWarfareNode(state, n.id);
      const shown = this.visible(n);
      btn.style.display = shown ? 'flex' : 'none';
      const label = this.nodeLayer.querySelector(`[data-label="${n.id}"]`) as HTMLElement;
      label.style.display = shown ? 'block' : 'none';

      const bg = owned ? 'linear-gradient(160deg,#6d5312,#3a2b06)'
        : affordable ? 'linear-gradient(160deg,#12482f,#0a2a1c)'
          : unlocked ? 'linear-gradient(160deg,#14304a,#0b1c2e)'
            : 'linear-gradient(160deg,#141a26,#0b0f18)';
      const edge = owned ? GOLD : affordable ? GREEN : unlocked ? CYAN : '#2a3346';
      btn.style.background = bg;
      btn.style.color = owned ? '#ffeeb4' : affordable ? '#c9ffdd' : unlocked ? TEXT : '#4d5a72';
      // The hexagon border is faked with an outline ring behind the clip path.
      btn.style.boxShadow =
        `0 0 0 3px ${edge} inset` +
        (n.id === this.selected ? `, 0 0 0 6px rgba(92,226,236,0.35) inset, 0 0 26px ${edge}` : '');
      btn.style.transform = n.id === this.selected ? 'scale(1.06)' : 'scale(1)';
      const cost = btn.querySelector('[data-cost]') as HTMLElement;
      cost.textContent = owned ? 'OWNED' : `${n.cost} XP`;
      cost.style.color = owned ? GOLD : affordable ? GREEN : TEXT_DIM;
      label.style.color = owned ? GOLD : affordable ? GREEN : unlocked ? TEXT : TEXT_DIM;
      btn.setAttribute('aria-pressed', owned ? 'true' : 'false');
      btn.setAttribute('aria-label',
        `${n.name}. ${owned ? 'Authorized.' : `Costs ${n.cost} warfare XP. ` +
          (warfareBlockReason(state, n.id) ?? 'Ready to authorize.')}`);

      // Edge styling: gold once the child is owned, cyan circuitry once its
      // prerequisite is satisfied, dim otherwise.
      const edgePath = this.edges.get(n.id);
      if (edgePath) {
        const stroke = owned ? GOLD : unlocked ? CYAN : '#1d2942';
        edgePath.setAttribute('stroke', stroke);
        edgePath.setAttribute('opacity', shown ? (owned ? '0.95' : unlocked ? '0.7' : '0.4') : '0');
        edgePath.setAttribute('stroke-dasharray', owned ? '' : unlocked ? '9 7' : '4 8');
      }
    }

    this.renderDetail(state);
  }

  private renderDetail(state: WarfareProgress): void {
    const node = WARFARE_TREE.find((n) => n.id === this.selected);
    const host = this.mobile ? this.sheet : this.rail;
    const other = this.mobile ? this.rail : this.sheet;
    other.innerHTML = '';
    host.innerHTML = '';
    if (!node) return;

    const owned = warfareOwns(state, node.id);
    const blocked = warfareBlockReason(state, node.id);
    const meta = WARFARE_BRANCH_META[node.branch];

    const head = document.createElement('div');
    head.innerHTML =
      `<div style="font-size:10px;letter-spacing:2px;color:${CYAN_DIM}">` +
      `${meta.icon} ${meta.name.toUpperCase()} · ${tierLabel(node.tier)}</div>` +
      `<div style="font-size:19px;color:${owned ? GOLD : TEXT};margin:4px 0 2px">` +
      `${node.icon} ${node.name}</div>` +
      `<div style="font-size:11px;color:${TEXT_DIM};line-height:1.5">${node.tagline}</div>`;
    host.appendChild(head);

    // 3D preview of exactly the hardware this node produces.
    const previewWrap = document.createElement('div');
    previewWrap.style.cssText = 'margin:10px 0 4px';
    previewWrap.appendChild(this.preview.canvas);
    host.appendChild(previewWrap);
    const tint = new THREE.Color();
    try { tint.set(this.hooks.tint()); } catch { tint.set('#a8b2c0'); }
    this.preview.show(`${node.id}:${tint.getHex()}`, () => previewFor(node, tint.getHex()));
    if (reducedMotion()) this.preview.renderOnce();

    const caption = document.createElement('div');
    caption.style.cssText = `font-size:10px;color:${TEXT_DIM};text-align:center;margin-bottom:10px`;
    caption.textContent = node.hardware === 'silo' ? 'Tactical missile system'
      : node.hardware === 'battery' ? 'Interceptor battery' : 'Rotary-wing gunship';
    host.appendChild(caption);

    const unlocks = document.createElement('div');
    unlocks.innerHTML =
      `<div style="font-size:10px;letter-spacing:2px;color:${TEXT_DIM};margin-bottom:5px">UNLOCKS</div>` +
      node.unlocks.map((u) =>
        `<div style="display:flex;gap:7px;font-size:12px;line-height:1.6;color:${TEXT}">` +
        `<span style="color:${CYAN}">▸</span><span>${u}</span></div>`).join('');
    host.appendChild(unlocks);

    const rows = statDiff(node);
    if (rows.length) {
      const table = document.createElement('div');
      table.style.cssText = 'margin-top:12px';
      table.innerHTML =
        `<div style="font-size:10px;letter-spacing:2px;color:${TEXT_DIM};margin-bottom:5px">` +
        `INSTALLED STATS · ${tierLabel(Math.max(1, node.tier - 1))} → ${tierLabel(node.tier)}</div>` +
        rows.map((r) =>
          `<div style="display:flex;align-items:baseline;gap:8px;font-size:11px;` +
          `padding:3px 0;border-bottom:1px solid #17223400">` +
          `<span style="flex:1;color:${TEXT_DIM}">${r.label}</span>` +
          `<span style="color:#6e7d97">${r.from}</span>` +
          `<span style="color:${TEXT_DIM}">→</span>` +
          `<span style="color:${r.better ? GREEN : RED}">${r.to}</span></div>`).join('');
      host.appendChild(table);
    }

    const foot = document.createElement('div');
    foot.style.cssText = 'margin-top:14px';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'mc-font';
    btn.style.cssText =
      'width:100%;min-height:48px;border-radius:8px;font-family:inherit;font-size:13px;' +
      'letter-spacing:1px;cursor:pointer;border:2px solid;';
    if (owned) {
      btn.textContent = '✔ AUTHORIZED';
      btn.disabled = true;
      btn.style.borderColor = GOLD_DIM;
      btn.style.background = '#241d08';
      btn.style.color = GOLD;
      btn.style.cursor = 'default';
    } else if (blocked) {
      btn.textContent = blocked.toUpperCase();
      btn.disabled = true;
      btn.style.borderColor = '#5a2320';
      btn.style.background = '#22100f';
      btn.style.color = RED;
      btn.style.cursor = 'not-allowed';
    } else {
      btn.textContent = `AUTHORIZE UPGRADE — ${node.cost.toLocaleString()} XP`;
      btn.style.borderColor = GREEN;
      btn.style.background = '#0e3524';
      btn.style.color = '#d3ffe6';
      btn.addEventListener('click', () => this.authorize());
    }
    foot.appendChild(btn);
    const hint = document.createElement('div');
    hint.style.cssText = `font-size:10px;color:${TEXT_DIM};margin-top:8px;line-height:1.6`;
    hint.textContent = this.mobile
      ? 'Warfare XP comes only from dungeon bosses you actually help kill.'
      : 'Arrows move · Enter authorizes · Home returns to the root · Esc closes. ' +
        'Warfare XP comes only from dungeon bosses you actually help kill.';
    foot.appendChild(hint);
    host.appendChild(foot);
  }
}
