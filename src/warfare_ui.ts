// WARFARE COMMAND — the technology-authorization screen.
//
// Visual direction: a LIGHT briefing document. Paper-white cards on a faint
// blueprint grid, hairline rules, one blue accent for "available to you", amber
// for "already authorized", green for "you can afford this now" and red only
// for blocked actions. Every glyph is an inline SVG from the icon set below —
// there is not a single emoji in this file, so the screen renders identically on
// every OS and scales crisply at any zoom.
//
// It also PLAYS THROUGH: the panel is a floating card, not a full-screen wash,
// so the world keeps rendering (and you keep walking) behind it. Nothing here
// runs a per-frame loop except the small hardware preview, and that is paused
// the moment the panel closes.
//
// Desktop gets a pan-and-zoom tree plus a fixed detail rail. Mobile gets the
// same tree with branch filter chips, 48px targets, explicit zoom buttons and a
// bottom sheet for the selected technology.

import * as THREE from 'three';
import {
  WARFARE_BRANCH_META, WARFARE_TREE, WARFARE_TREE_COST, WarfareBranch,
  WarfareNode, WarfareProgress, batteryStats, canBuyWarfareNode, helicopterStats,
  siloStats, tierLabel, warfareAvailable, warfareBlockReason, warfareCompletion,
  warfareOwns, warfareSpent, warfareUnlocked,
} from './warfare';
import { buildBatteryModel, buildMissileModel, buildSiloModel } from './warfare_models';
import { buildHelicopterModel } from './vehiclemodels';

// --- Palette (light) ----------------------------------------------------------

const PAPER = '#f6f8fc';        // the tree surface
const CARD = '#ffffff';         // panels, node cards
const INK = '#152234';          // primary text
const INK_MID = '#48586d';      // secondary text
const INK_DIM = '#8494a8';      // captions, disabled
const HAIR = '#dde4ee';         // hairline rules + card borders
const HAIR_SOFT = '#eef2f8';
const BLUE = '#1f6fd0';         // accent: unlocked / selected
const BLUE_SOFT = '#e9f1fd';
const BLUE_DEEP = '#144a91';
const GOLD = '#9a6c0b';         // owned
const GOLD_SOFT = '#fdf4de';
const GREEN = '#0f7444';        // affordable right now
const GREEN_SOFT = '#e5f5ec';
const RED = '#b02a20';          // blocked
const RED_SOFT = '#fdecea';
const SLATE_SOFT = '#f0f3f8';   // locked

const SANS = "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, " +
  "Helvetica, Arial, sans-serif";
const MONO = "'Lucida Console', Monaco, ui-monospace, monospace";

/** Grid spacing in tree units. */
const COL = 250;
const ROW = 114;
/** Node card footprint (used by the layout AND the elbow traces). */
const CARD_W = 178;
const CARD_H = 64;
/** The tree layer's own offset inside the viewport (its `top`). Centring maths
 *  must subtract it, or every node sits that far below where it was asked to. */
const WORLD_TOP = 70;
/** Both tree layers (SVG traces, DOM cards) are drawn in a positive coordinate
 *  space and then shifted back by this origin, so tree-space (0,0) is the root
 *  node and the pan/zoom maths never has to know about the padding. */
const ORIGIN_X = 800;
const ORIGIN_Y = 90;
/** How much of the card the mobile detail sheet owns. The tree's centring and
 *  the floating zoom stack both derive from it, so they can't disagree. */
const SHEET_PCT = 58;

const BRANCH_X: Record<WarfareBranch, number> = {
  trunk: 0, strike: -1.18, aegis: 0, air: 1.18,
};

/** Does the viewer want reduced motion? Previews stop auto-rotating if so. */
function reducedMotion(): boolean {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; }
  catch { return false; }
}

// --- Icons ---------------------------------------------------------------------
// Every icon is drawn on a 24x24 grid and inherits its colour from the element
// it sits in, so one definition serves the light card, the amber owned state and
// the muted locked state without variants.

const STROKE_ICONS: Record<string, string> = {
  // Branch marks
  branch: 'M12 21v-7M12 14 5.5 9.5M12 14l6.5-4.5M12 14V4M5.5 9.5v-2M18.5 9.5v-2',
  target: 'M12 2v3.5M12 18.5V22M2 12h3.5M18.5 12H22' +
    '|circle:12,12,7|circle:12,12,2.6',
  satellite: 'M4 20h6M7 20v-3.4M7 16.6 3.6 9.9A8.4 8.4 0 0 1 15.6 6L7 16.6Z' +
    'M13.4 13.6 19 20M16.5 4.5 20 8',
  rotor: 'M3 7.5h18M11.4 7.5v3.6M6 16.4a3.4 3.4 0 0 1 3.4-3.4h4.2l4 3.4h1.2' +
    'a2 2 0 0 1 0 4H9.4A3.4 3.4 0 0 1 6 16.4ZM17.6 16.4h3.6',

  // Node marks — trunk
  missile: 'M12 2.2c2.3 2.4 3.5 5.3 3.5 8.6v3.9h-7v-3.9c0-3.3 1.2-6.2 3.5-8.6Z' +
    'M8.5 12.4 5.4 15.6v3.6l3.1-2.4M15.5 12.4l3.1 3.2v3.6l-3.1-2.4' +
    'M10.4 18.3 12 21.8l1.6-3.5',
  vanes: 'M12 2.6v18.8M12 7.6 5.2 11.7v4.1L12 12M12 7.6l6.8 4.1v4.1L12 12',
  silo: 'M4 20.5h16M6.2 20.5v-7.2a5.8 5.8 0 0 1 11.6 0v7.2M9.4 20.5v-5.3h5.2v5.3' +
    'M12 7.3V3.2M9.6 4.6 12 3.2l2.4 1.4',
  dish: 'M4.5 20.5h7M8 20.5v-3.7M8 16.8 4.3 9.6A8.6 8.6 0 0 1 16.6 5.7L8 16.8Z' +
    'M13.6 13.9 18.5 20.5',
  sweep: 'M12 12 19.4 7.3|arc:12,12,9,-90,20|arc:12,12,5.6,-90,20' +
    '|circle:12,12,1.6',
  bolt: 'M13.4 2.4 5.6 13.6h5.2l-1.6 8 8-11.4h-5.2l1.4-7.8Z',
  bomb: 'M15.6 10.6 18 8.2M18 8.2V5M18 8.2h3.2|circle:10.6,14.8,6.2' +
    '|M7.6 12.2a4.2 4.2 0 0 1 2.4-1.6',
  plate: 'M3.8 5.6h16.4v12.8H3.8zM8.6 5.6v12.8M15.4 5.6v12.8' +
    '|circle:6.2,8.4,0.9|circle:6.2,15.6,0.9|circle:17.8,8.4,0.9|circle:17.8,15.6,0.9',

  // Node marks — branches
  crosshair: 'M12 2.4v4.2M12 17.4v4.2M2.4 12h4.2M17.4 12h4.2' +
    '|circle:12,12,6|circle:12,12,1.4',
  warhead: 'M12 2.6 17 12.4H7L12 2.6ZM7.4 12.4h9.2v6.2H7.4zM7.4 15.6h9.2' +
    'M9.6 18.6v2.6M14.4 18.6v2.6',
  burst: 'M12 2.2 14 8l5.6-2.4-2.6 5.4 5.2 1.4-5.2 1.6 1.6 5.6-4.8-3-3.2 4.4' +
    '-1.4-5.2-5.4 1 3.2-4.4L2 10l5.6-.6L7 3.8l4 3Z',
  network: 'M12 6.6v4.4M8 15.2l2.6-2.6M16 15.2l-2.6-2.6' +
    '|circle:12,4.4,2.2|circle:6.2,17.4,2.2|circle:17.8,17.4,2.2',
  twin: 'M6.6 20.8V8.4a2.4 2.4 0 0 1 4.8 0v12.4M12.6 20.8V8.4a2.4 2.4 0 0 1 4.8 0' +
    'v12.4M9 8.4 9 4.4M15 8.4V4.4M7.4 16.4h3.2M13.4 16.4h3.2',
  dome: 'M2.8 19.6h18.4|arc:12,19.6,8.6,180,180|arc:12,19.6,4.6,180,180' +
    '|M12 19.6V6.8M9.6 8.6 12 6.4l2.4 2.2',
  turbine: 'M12 10.6V3.8M13.8 13.2 19.6 16.6M10.2 13.2 4.4 16.6' +
    '|circle:12,12,1.8',
  rack: 'M3.8 4.8h16.4v3.2H3.8zM7.4 8v2.8M12 8v2.8M16.6 8v2.8' +
    '|circle:7.4,13.4,2.6|circle:12,13.4,2.6|circle:16.6,13.4,2.6',
  star: 'M12 2.8l2.7 5.6 6.1.8-4.5 4.3 1.1 6.1-5.4-3-5.4 3 1.1-6.1L3.2 9.2l6.1-.8Z',

  // UI chrome
  close: 'M6.4 6.4 17.6 17.6M17.6 6.4 6.4 17.6',
  recenter: 'M12 2.8v3.6M12 17.6v3.6M2.8 12h3.6M17.6 12h3.6|circle:12,12,4.4',
  plus: 'M12 5.6v12.8M5.6 12h12.8',
  minus: 'M5.6 12h12.8',
  check: 'M5 12.6 9.9 17.5 19 6.9',
  chevron: 'M9.6 5.6 16 12l-6.4 6.4',
  lock: 'M6.2 10.8h11.6v9.4H6.2zM9 10.8V8.2a3 3 0 0 1 6 0v2.6',
  spark: 'M12 3.4v3M12 17.6v3M4.6 12h3M16.4 12h3M6.8 6.8l2.1 2.1' +
    'M15.1 15.1l2.1 2.1M17.2 6.8l-2.1 2.1M8.9 15.1l-2.1 2.1',
  dot: '|circle:12,12,4',
};

const FILL_ICONS: Record<string, string> = {
  up: 'M12 5.6 18.4 16H5.6z',
  down: 'M12 18.4 5.6 8h12.8z',
};

/** Turn our compact path grammar into real SVG children. `|circle:x,y,r` and
 *  `|arc:cx,cy,r,startDeg,sweepDeg` are shorthands the trunk/dome marks need. */
function iconBody(spec: string): string {
  const parts = spec.split('|');
  let out = '';
  for (const part of parts) {
    if (!part) continue;
    if (part.startsWith('circle:')) {
      const [cx, cy, r] = part.slice(7).split(',').map(Number);
      out += `<circle cx="${cx}" cy="${cy}" r="${r}"/>`;
    } else if (part.startsWith('arc:')) {
      const [cx, cy, r, start, sweep] = part.slice(4).split(',').map(Number);
      const rad = (d: number): number => (d * Math.PI) / 180;
      const x0 = cx + r * Math.cos(rad(start)), y0 = cy + r * Math.sin(rad(start));
      const x1 = cx + r * Math.cos(rad(start + sweep));
      const y1 = cy + r * Math.sin(rad(start + sweep));
      const large = Math.abs(sweep) > 180 ? 1 : 0;
      out += `<path d="M${x0.toFixed(2)} ${y0.toFixed(2)} A${r} ${r} 0 ${large} ` +
        `${sweep >= 0 ? 1 : 0} ${x1.toFixed(2)} ${y1.toFixed(2)}"/>`;
    } else {
      out += `<path d="${part}"/>`;
    }
  }
  return out;
}

/** An inline SVG icon that inherits `currentColor`. */
function icon(name: string, size = 18, weight = 1.6): string {
  const filled = FILL_ICONS[name] !== undefined;
  const spec = filled ? FILL_ICONS[name] : (STROKE_ICONS[name] ?? STROKE_ICONS.dot);
  const paint = filled
    ? 'fill="currentColor" stroke="none"'
    : `fill="none" stroke="currentColor" stroke-width="${weight}" ` +
      'stroke-linecap="round" stroke-linejoin="round"';
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" ${paint} ` +
    `aria-hidden="true" focusable="false" style="display:block;flex:none">` +
    `${iconBody(spec)}</svg>`;
}

/** Which icon each technology wears. Keyed by node id so the pure warfare model
 *  stays free of presentation concerns. */
const NODE_ICON: Record<string, string> = {
  missile_command: 'missile',
  guidance_vanes: 'vanes',
  hardened_silo: 'silo',
  aegis_systems: 'dish',
  radar_sweep: 'sweep',
  fast_intercept: 'bolt',
  flight_certification: 'rotor',
  bomb_rack: 'bomb',
  reinforced_airframe: 'plate',
  strike_guidance: 'crosshair',
  strike_warhead: 'warhead',
  strike_precision: 'burst',
  aegis_network: 'network',
  aegis_twin_rack: 'twin',
  aegis_sky_shield: 'dome',
  air_turbine: 'turbine',
  air_heavy_bay: 'rack',
  air_command: 'star',
};

const BRANCH_ICON: Record<WarfareBranch, string> = {
  trunk: 'branch', strike: 'target', aegis: 'satellite', air: 'rotor',
};

// --- Authorization celebration --------------------------------------------------
// One stylesheet, injected once, for the purchase moment: the node card pops and
// keeps a gold ring, a shockwave expands off it, sparks fly, a shine sweeps
// across the plate and a banner drops from the top of the panel.

const CELEBRATION_CSS = `
@keyframes wf-pop {
  0%   { transform: scale(1); }
  22%  { transform: scale(1.16); }
  46%  { transform: scale(0.98); }
  70%  { transform: scale(1.06); }
  100% { transform: scale(1.03); }
}
@keyframes wf-ring {
  0%   { opacity: 0.9; transform: translate(-50%,-50%) scale(0.7); }
  100% { opacity: 0;   transform: translate(-50%,-50%) scale(2.4); }
}
@keyframes wf-spark {
  0%   { opacity: 1; transform: translate(-50%,-50%) scale(1); }
  100% { opacity: 0; transform: translate(calc(-50% + var(--dx)), calc(-50% + var(--dy))) scale(0.3); }
}
@keyframes wf-shine {
  0%   { transform: translateX(-140%) skewX(-18deg); }
  100% { transform: translateX(260%)  skewX(-18deg); }
}
@keyframes wf-banner {
  0%   { opacity: 0; transform: translate(-50%, -16px) scale(0.96); }
  10%  { opacity: 1; transform: translate(-50%, 0) scale(1); }
  80%  { opacity: 1; transform: translate(-50%, 0) scale(1); }
  100% { opacity: 0; transform: translate(-50%, -10px) scale(0.98); }
}
@keyframes wf-glow {
  0%   { opacity: 0; }
  18%  { opacity: 1; }
  100% { opacity: 0; }
}
@keyframes wf-bump {
  0%   { transform: scale(1); }
  40%  { transform: scale(1.28); }
  100% { transform: scale(1); }
}
@media (prefers-reduced-motion: reduce) {
  [data-wf-anim] { animation-duration: 0.01ms !important; }
}
`;

let celebrationStyleInjected = false;
function injectCelebrationCss(): void {
  if (celebrationStyleInjected) return;
  celebrationStyleInjected = true;
  const el = document.createElement('style');
  el.textContent = CELEBRATION_CSS;
  document.head.appendChild(el);
}

/** The icon for a node, falling back to its hardware family. */
export function nodeIconName(node: WarfareNode): string {
  return NODE_ICON[node.id] ??
    (node.hardware === 'silo' ? 'missile' : node.hardware === 'battery' ? 'dish' : 'rotor');
}

/** Every icon name the set actually draws — exported so a test can prove no
 *  node, branch or control points at a mark that doesn't exist. */
export function warfareIconNames(): string[] {
  return [...Object.keys(STROKE_ICONS), ...Object.keys(FILL_ICONS)];
}

/** The branch mark, for callers outside this module (and for tests). */
export function branchIconName(branch: WarfareBranch): string {
  return BRANCH_ICON[branch];
}

// --- The reusable 3D preview ---------------------------------------------------

/**
 * ONE renderer, reused for every node preview and for the mobile bottom sheet.
 * It is explicitly paused whenever the panel is hidden, so a closed tree costs
 * nothing per frame — and an OPEN tree costs only this, because the game itself
 * keeps running behind the panel.
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
      if (!reducedMotion()) this.spin += dt * 0.5;
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

/** One node's visual state — the single source of truth for every colour. */
type NodeState = 'owned' | 'ready' | 'unlocked' | 'locked';

const STATE_COLOR: Record<NodeState, { edge: string; tint: string; ink: string }> = {
  owned: { edge: GOLD, tint: GOLD_SOFT, ink: GOLD },
  ready: { edge: GREEN, tint: GREEN_SOFT, ink: GREEN },
  unlocked: { edge: HAIR, tint: BLUE_SOFT, ink: BLUE },
  locked: { edge: HAIR, tint: SLATE_SOFT, ink: INK_DIM },
};

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

  /** The floating card. Everything lives inside it; the root itself is a
   *  click-through shell so the world behind stays live. */
  private readonly card: HTMLDivElement;
  private readonly viewport: HTMLDivElement;
  private readonly canvasLayer: SVGSVGElement;
  private readonly nodeLayer: HTMLDivElement;
  private readonly world: HTMLDivElement;
  private readonly rail: HTMLDivElement;
  private readonly sheet: HTMLDivElement;
  private readonly header: HTMLDivElement;
  private readonly chips: HTMLDivElement;
  private readonly zoomControls: HTMLDivElement;
  /** Purchase celebration: the drop-down banner and the gold wash behind it. */
  private readonly banner: HTMLDivElement;
  private readonly glow: HTMLDivElement;
  private readonly preview: PreviewRenderer;
  private readonly buttons = new Map<string, HTMLButtonElement>();
  private readonly edges = new Map<string, SVGPathElement>();

  private selected = WARFARE_TREE[0].id;
  private panX = 0;
  private panY = 0;
  private zoom = 1;
  private dragging = false;
  private moved = false;
  private dragStart = { x: 0, y: 0, px: 0, py: 0 };
  private filter: WarfareBranch | 'all' = 'all';
  private mobile = false;

  constructor(private readonly hooks: WarfareUIHooks) {
    injectCelebrationCss();
    // The shell: full-bleed but click-through, so the game keeps receiving the
    // clicks that land outside the card (and keeps being visible under it).
    this.root = document.createElement('div');
    this.root.style.cssText =
      'position:absolute;inset:0;display:none;z-index:36;pointer-events:none;' +
      `font-family:${SANS};color:${INK};text-shadow:none;font-size:13px;` +
      '-webkit-font-smoothing:antialiased;';

    this.card = document.createElement('div');
    this.card.style.cssText =
      'position:absolute;pointer-events:auto;overflow:hidden;box-sizing:border-box;' +
      `background:${PAPER};border:1px solid ${HAIR};border-radius:16px;` +
      'box-shadow:0 24px 64px rgba(10,20,36,0.30), 0 2px 8px rgba(10,20,36,0.12);';
    this.root.appendChild(this.card);

    // --- header ---
    this.header = document.createElement('div');
    this.header.style.cssText =
      'position:absolute;top:0;left:0;right:0;height:60px;display:flex;align-items:center;' +
      `gap:14px;padding:0 12px 0 14px;box-sizing:border-box;background:${CARD};` +
      `border-bottom:1px solid ${HAIR};z-index:3;`;
    this.card.appendChild(this.header);

    // --- viewport (pan + zoom) ---
    this.viewport = document.createElement('div');
    this.viewport.style.cssText =
      'position:absolute;top:60px;left:0;right:0;bottom:0;overflow:hidden;' +
      'touch-action:none;cursor:grab;';
    this.card.appendChild(this.viewport);

    // Faint blueprint grid — light blue on paper, two scales.
    const bg = document.createElement('div');
    bg.style.cssText =
      'position:absolute;inset:0;pointer-events:none;' +
      `background-color:${PAPER};` +
      'background-image:' +
      'linear-gradient(rgba(31,111,208,0.05) 1px, transparent 1px),' +
      'linear-gradient(90deg, rgba(31,111,208,0.05) 1px, transparent 1px),' +
      'linear-gradient(rgba(31,111,208,0.09) 1px, transparent 1px),' +
      'linear-gradient(90deg, rgba(31,111,208,0.09) 1px, transparent 1px);' +
      'background-size:26px 26px,26px 26px,130px 130px,130px 130px;';
    this.viewport.appendChild(bg);
    // A soft vignette keeps the eye on the middle of the tree.
    const vignette = document.createElement('div');
    vignette.style.cssText =
      'position:absolute;inset:0;pointer-events:none;' +
      'background:radial-gradient(120% 90% at 50% 30%, rgba(255,255,255,0) 40%,' +
      'rgba(214,224,238,0.55) 100%);';
    this.viewport.appendChild(vignette);

    this.world = document.createElement('div');
    this.world.style.cssText =
      `position:absolute;left:50%;top:${WORLD_TOP}px;transform-origin:0 0;`;
    this.viewport.appendChild(this.world);

    this.canvasLayer = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.canvasLayer.setAttribute('width', '1600');
    this.canvasLayer.setAttribute('height', '1800');
    this.canvasLayer.style.cssText =
      `position:absolute;left:${-ORIGIN_X}px;top:${-ORIGIN_Y}px;` +
      'overflow:visible;pointer-events:none;';
    this.world.appendChild(this.canvasLayer);

    this.nodeLayer = document.createElement('div');
    // EXACTLY the same offset as the SVG trace layer above: both address nodes
    // as (ORIGIN_X + x, ORIGIN_Y + y), so a card and the trace that runs into it
    // cannot drift apart.
    this.nodeLayer.style.cssText =
      `position:absolute;left:${-ORIGIN_X}px;top:${-ORIGIN_Y}px;`;
    this.world.appendChild(this.nodeLayer);

    // --- desktop detail rail ---
    this.rail = document.createElement('div');
    this.rail.style.cssText =
      'position:absolute;top:60px;right:0;bottom:0;width:380px;box-sizing:border-box;' +
      `background:${CARD};border-left:1px solid ${HAIR};` +
      'overflow-y:auto;padding:16px;z-index:2;';
    this.card.appendChild(this.rail);

    // --- mobile branch chips + bottom sheet ---
    this.chips = document.createElement('div');
    this.chips.style.cssText =
      'position:absolute;top:64px;left:0;right:0;display:none;gap:8px;padding:6px 10px;' +
      'overflow-x:auto;z-index:3;white-space:nowrap;';
    this.card.appendChild(this.chips);

    this.sheet = document.createElement('div');
    this.sheet.style.cssText =
      `position:absolute;left:0;right:0;bottom:0;display:none;max-height:${SHEET_PCT}%;` +
      `overflow-y:auto;background:${CARD};border-top:1px solid ${HAIR};` +
      'border-radius:16px 16px 0 0;padding:14px 14px 16px;' +
      'box-shadow:0 -14px 34px rgba(10,20,36,0.14);z-index:4;';
    this.card.appendChild(this.sheet);

    this.zoomControls = document.createElement('div');
    this.zoomControls.style.cssText =
      'position:absolute;right:12px;bottom:12px;display:none;flex-direction:column;' +
      'gap:8px;z-index:5;';
    this.card.appendChild(this.zoomControls);

    // --- celebration chrome (above everything, never interactive) ---
    this.glow = document.createElement('div');
    this.glow.style.cssText =
      'position:absolute;inset:0;pointer-events:none;opacity:0;z-index:6;' +
      'background:radial-gradient(120% 80% at 50% 0%, rgba(214,164,42,0.28), ' +
      'rgba(214,164,42,0) 62%);';
    this.card.appendChild(this.glow);

    this.banner = document.createElement('div');
    this.banner.style.cssText =
      'position:absolute;top:74px;left:50%;transform:translate(-50%,-16px);opacity:0;' +
      'pointer-events:none;z-index:7;display:flex;align-items:center;gap:11px;' +
      `padding:11px 18px 11px 14px;border-radius:12px;background:${CARD};` +
      `border:1px solid ${GOLD};color:${GOLD};box-shadow:0 12px 30px rgba(120,84,8,0.24);` +
      'white-space:nowrap;';
    this.card.appendChild(this.banner);

    this.preview = new PreviewRenderer(340, 210);
    this.preview.canvas.style.cssText =
      `width:100%;height:auto;display:block;border:1px solid ${HAIR};` +
      'border-radius:10px;background:linear-gradient(170deg,#ffffff,#e7edf6);';

    this.buildTree();
    this.buildHeader();
    this.buildChips();
    this.buildZoomControls();
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
      // An elbowed trace rather than a straight line: down out of the parent,
      // across, then down into the child.
      const half = CARD_H / 2;
      const midY = (a.y + b.y) / 2;
      const d = a.x === b.x
        ? `M ${ORIGIN_X + a.x} ${ORIGIN_Y + a.y + half} ` +
          `L ${ORIGIN_X + b.x} ${ORIGIN_Y + b.y - half}`
        : `M ${ORIGIN_X + a.x} ${ORIGIN_Y + a.y + half} L ${ORIGIN_X + a.x} ${ORIGIN_Y + midY} ` +
          `L ${ORIGIN_X + b.x} ${ORIGIN_Y + midY} L ${ORIGIN_X + b.x} ${ORIGIN_Y + b.y - half}`;
      path.setAttribute('d', d);
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke-width', '2');
      path.setAttribute('stroke-linecap', 'round');
      path.setAttribute('stroke-linejoin', 'round');
      this.canvasLayer.appendChild(path);
      this.edges.set(n.id, path);
    }

    for (const n of WARFARE_TREE) {
      const p = this.nodeXY(n);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.dataset.node = n.id;
      btn.dataset.branch = n.branch;
      const w = n.capstone ? CARD_W + 18 : CARD_W;
      btn.style.cssText =
        `position:absolute;left:${ORIGIN_X + p.x - w / 2}px;` +
        `top:${ORIGIN_Y + p.y - CARD_H / 2}px;` +
        `width:${w}px;height:${CARD_H}px;padding:0 12px;cursor:pointer;box-sizing:border-box;` +
        'display:flex;align-items:center;gap:10px;text-align:left;' +
        `font-family:${SANS};text-shadow:none;background:${CARD};border-radius:11px;` +
        'border:1px solid transparent;' +
        'transition:transform 0.12s ease, box-shadow 0.12s ease;';
      btn.innerHTML =
        `<span data-chip style="width:34px;height:34px;border-radius:9px;flex:none;` +
        `display:flex;align-items:center;justify-content:center">` +
        `${icon(nodeIconName(n), n.capstone ? 21 : 19)}</span>` +
        `<span style="flex:1;min-width:0;display:flex;flex-direction:column;gap:2px">` +
        `<span data-name style="font-size:12px;font-weight:650;line-height:1.15;` +
        `letter-spacing:0.1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">` +
        `${n.name}</span>` +
        `<span data-cost style="font-size:10.5px;font-family:${MONO};letter-spacing:0.2px;` +
        `display:flex;align-items:center;gap:4px"></span></span>`;
      // A real accessible label instead of a browser tooltip.
      btn.setAttribute('aria-label', `${n.name} — ${n.cost} warfare XP`);
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (this.moved) return; // that click was the end of a pan
        this.select(n.id);
      });
      this.nodeLayer.appendChild(btn);
      this.buttons.set(n.id, btn);
    }
  }

  private buildHeader(): void {
    const stat = (key: string, label: string): string =>
      `<div style="display:flex;flex-direction:column;gap:1px;min-width:64px">` +
      `<span data-${key} style="font-family:${MONO};font-size:14px;font-weight:700;` +
      `line-height:1.1"></span>` +
      `<span style="font-size:9px;letter-spacing:1.3px;color:${INK_DIM}">${label}</span></div>`;
    const chrome = (attr: string, name: string, label: string, wide = false): string =>
      `<button data-${attr} type="button" aria-label="${label}" ` +
      `style="height:34px;${wide ? 'padding:0 12px;gap:7px;' : 'width:34px;'}cursor:pointer;` +
      `display:flex;align-items:center;justify-content:center;font-family:${SANS};` +
      `font-size:11.5px;font-weight:600;border:1px solid ${HAIR};border-radius:9px;` +
      `background:${CARD};color:${INK_MID}">${icon(name, 16)}` +
      `${wide ? `<span>${label}</span>` : ''}</button>`;

    this.header.innerHTML =
      `<div style="display:flex;align-items:center;gap:10px;flex:none">` +
      `<span style="width:34px;height:34px;border-radius:10px;display:flex;` +
      `align-items:center;justify-content:center;background:${BLUE_SOFT};color:${BLUE_DEEP}">` +
      `${icon('branch', 20)}</span>` +
      `<div style="display:flex;flex-direction:column;gap:1px">` +
      `<span style="font-size:13.5px;font-weight:700;letter-spacing:1.6px">WARFARE COMMAND</span>` +
      `<span data-sub style="font-size:10px;color:${INK_DIM};letter-spacing:0.4px">` +
      `Authorize technology with boss-earned XP</span></div></div>` +
      `<div data-stats style="display:flex;align-items:center;gap:18px;margin-left:10px">` +
      stat('avail', 'AVAILABLE') + stat('earned', 'EARNED') + stat('spent', 'SPENT') +
      `</div>` +
      `<div style="flex:1"></div>` +
      `<div data-meter style="display:flex;align-items:center;gap:9px">` +
      `<div style="width:150px;height:6px;background:${HAIR_SOFT};border-radius:4px;` +
      `overflow:hidden"><div data-fill style="height:100%;width:0%;border-radius:4px;` +
      `background:linear-gradient(90deg,${BLUE},${GOLD});transition:width 0.25s ease">` +
      `</div></div>` +
      `<span data-pct style="font-family:${MONO};font-size:11px;color:${INK_MID};` +
      `min-width:32px"></span></div>` +
      chrome('recenter', 'recenter', 'Recentre', true) +
      chrome('close', 'close', 'Close');
    this.header.querySelector('[data-close]')!.addEventListener('click', () => this.hide());
    this.header.querySelector('[data-recenter]')!.addEventListener('click', () => {
      this.recenter();
      this.applyTransform();
    });
  }

  private buildChips(): void {
    const mk = (id: WarfareBranch | 'all', name: string, text: string): void => {
      const b = document.createElement('button');
      b.type = 'button';
      b.dataset.chip = id;
      b.innerHTML = `${icon(name, 15)}<span>${text}</span>`;
      b.style.cssText =
        'min-height:34px;padding:0 12px;border-radius:17px;cursor:pointer;display:inline-flex;' +
        `align-items:center;gap:6px;font-family:${SANS};font-size:11.5px;font-weight:600;` +
        `border:1px solid ${HAIR};background:${CARD};color:${INK_MID};flex:none;`;
      b.addEventListener('click', () => { this.filter = id; this.refresh(); });
      this.chips.appendChild(b);
    };
    mk('all', 'spark', 'All');
    for (const key of ['trunk', 'strike', 'aegis', 'air'] as WarfareBranch[]) {
      mk(key, BRANCH_ICON[key], WARFARE_BRANCH_META[key].name.replace('Command ', ''));
    }
  }

  /** Explicit zoom + recentre for touch (no pinch-only affordances). */
  private buildZoomControls(): void {
    for (const [name, label, fn] of [
      ['plus', 'Zoom in', () => this.setZoom(this.zoom * 1.25)],
      ['minus', 'Zoom out', () => this.setZoom(this.zoom / 1.25)],
      ['recenter', 'Recentre', () => { this.recenter(); this.applyTransform(); }],
    ] as [string, string, () => void][]) {
      const b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('aria-label', label);
      b.innerHTML = icon(name, 20);
      b.style.cssText =
        'width:48px;height:48px;border-radius:24px;cursor:pointer;display:flex;' +
        `align-items:center;justify-content:center;border:1px solid ${HAIR};` +
        `background:${CARD};color:${INK_MID};box-shadow:0 2px 8px rgba(10,20,36,0.14);`;
      b.addEventListener('click', fn);
      this.zoomControls.appendChild(b);
    }
  }

  // --- interaction ------------------------------------------------------------

  private bindInput(): void {
    this.viewport.addEventListener('pointerdown', (e) => {
      this.dragging = true;
      this.moved = false;
      this.viewport.style.cursor = 'grabbing';
      this.dragStart = { x: e.clientX, y: e.clientY, px: this.panX, py: this.panY };
      // NOTE: no pointer capture yet. Capturing here would retarget the
      // follow-up click to the viewport, and every node button would stop
      // responding to a plain tap. We only capture once it's really a drag.
    });
    this.viewport.addEventListener('pointermove', (e) => {
      if (!this.dragging) return;
      const dx = e.clientX - this.dragStart.x, dy = e.clientY - this.dragStart.y;
      if (!this.moved && Math.abs(dx) + Math.abs(dy) > 4) {
        this.moved = true;
        try { this.viewport.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      }
      if (!this.moved) return;
      this.panX = this.dragStart.px + dx;
      this.panY = this.dragStart.py + dy;
      this.applyTransform();
    });
    const end = (e: PointerEvent): void => {
      this.dragging = false;
      this.viewport.style.cursor = 'grab';
      try { this.viewport.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
      // Clear the "this was a drag" flag AFTER the click that follows it.
      setTimeout(() => { this.moved = false; }, 0);
    };
    this.viewport.addEventListener('pointerup', end);
    this.viewport.addEventListener('pointercancel', end);
    this.viewport.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.setZoom(this.zoom * (e.deltaY < 0 ? 1.12 : 1 / 1.12));
    }, { passive: false });

    this.card.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); this.hide(); return; }
      if (e.key === 'Home') { e.preventDefault(); this.select(WARFARE_TREE[0].id, true); return; }
      // Enter authorizes — but NOT Space: the panel plays through, and Space is
      // still the player's jump key while the tree is open. We do swallow the
      // DEFAULT for Space so it can't re-trigger a focused node button; the
      // document-level game listener still sees the keydown and jumps.
      if (e.key === ' ' || e.code === 'Space') { e.preventDefault(); return; }
      if (e.key === 'Enter') { e.preventDefault(); this.authorize(); return; }
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

  /**
   * Put a node in the middle of the VISIBLE tree area. The viewport is already
   * inset by the detail rail (desktop) and the bottom sheet (mobile), so its own
   * box is the honest measure of what the player can actually see — the selected
   * technology lands dead centre horizontally and slightly above the midline,
   * which leaves its children on screen too.
   */
  private centerOn(node: WarfareNode): void {
    const p = this.nodeXY(node);
    const h = this.viewport.clientHeight || window.innerHeight;
    // Mobile aims at the middle of the STRIP the sheet leaves behind, not the
    // middle of the viewport — otherwise the selected card hides under it.
    const vFrac = this.mobile ? (100 - SHEET_PCT) / 200 : 0.44;
    // `world` is anchored at left:50%/top:WORLD_TOP of the viewport, so the pan
    // is a PURE OFFSET from that anchor. Adding another half-width here would
    // centre it twice and push the whole tree off the right-hand edge.
    this.panX = -p.x * this.zoom;
    this.panY = h * vFrac - WORLD_TOP - p.y * this.zoom;
  }

  private recenter(): void {
    const n = WARFARE_TREE.find((x) => x.id === this.selected) ?? WARFARE_TREE[0];
    this.zoom = this.mobile ? 0.72 : 0.9;
    this.centerOn(n);
  }

  select(id: string, scroll = false): void {
    this.selected = id;
    if (scroll) {
      const n = WARFARE_TREE.find((x) => x.id === id);
      if (n) { this.centerOn(n); this.applyTransform(); }
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
    this.celebrate(node);
  }

  /**
   * The payoff. A node you just authorized cost a whole boss fight, so it gets
   * the full treatment: the card pops and keeps a gold shockwave, sparks fly off
   * it, a shine sweeps the plate, the header numbers bump, and a banner names
   * what you bought (and what it just opened up).
   */
  private celebrate(node: WarfareNode): void {
    const btn = this.buttons.get(node.id);
    if (!btn) return;
    const p = this.nodeXY(node);
    const cx = ORIGIN_X + p.x, cy = ORIGIN_Y + p.y;

    // 1. The card itself pops. The animation outranks the inline transform that
    //    refresh() writes, then hands back to it cleanly when it ends.
    btn.setAttribute('data-wf-anim', '');
    btn.style.animation = 'wf-pop 0.62s cubic-bezier(0.2,0.9,0.25,1)';
    window.setTimeout(() => { btn.style.animation = ''; }, 640);

    // 2. Shockwave rings + sparks, in tree space so they scale with the zoom.
    const fx = document.createElement('div');
    fx.style.cssText = `position:absolute;left:${cx}px;top:${cy}px;pointer-events:none;`;
    for (const [delay, size] of [[0, 130], [0.12, 96]] as [number, number][]) {
      const ring = document.createElement('div');
      ring.setAttribute('data-wf-anim', '');
      // Centring is the keyframe's translate(-50%,-50%) alone — a negative
      // margin as well would offset the ring by half its size again.
      ring.style.cssText =
        `position:absolute;left:0;top:0;width:${size}px;height:${size}px;` +
        `border-radius:50%;border:2px solid ${GOLD};opacity:0;` +
        `animation:wf-ring 0.72s ease-out ${delay}s forwards;`;
      fx.appendChild(ring);
    }
    for (let i = 0; i < 12; i++) {
      const angle = (i / 12) * Math.PI * 2 + 0.26;
      const dist = 52 + (i % 3) * 16;
      const spark = document.createElement('div');
      spark.setAttribute('data-wf-anim', '');
      spark.style.cssText =
        'position:absolute;left:0;top:0;width:6px;height:6px;border-radius:50%;' +
        `background:${i % 2 ? GOLD : BLUE};` +
        `--dx:${(Math.cos(angle) * dist).toFixed(1)}px;` +
        `--dy:${(Math.sin(angle) * dist).toFixed(1)}px;` +
        `animation:wf-spark 0.62s cubic-bezier(0.15,0.75,0.3,1) ${(i % 4) * 0.03}s forwards;`;
      fx.appendChild(spark);
    }
    this.nodeLayer.appendChild(fx);
    window.setTimeout(() => fx.remove(), 1000);

    // 3. A shine sweeping across the plate, clipped to the card.
    const shine = document.createElement('div');
    shine.setAttribute('data-wf-anim', '');
    shine.style.cssText =
      'position:absolute;inset:-2px;overflow:hidden;border-radius:11px;pointer-events:none;';
    const bar = document.createElement('div');
    bar.style.cssText =
      'position:absolute;top:0;bottom:0;width:38%;' +
      'background:linear-gradient(90deg, rgba(255,255,255,0), rgba(255,236,178,0.95),' +
      'rgba(255,255,255,0));animation:wf-shine 0.66s ease-out forwards;';
    shine.appendChild(bar);
    btn.appendChild(shine);
    window.setTimeout(() => shine.remove(), 720);

    // 4. The gold wash over the whole panel.
    this.glow.setAttribute('data-wf-anim', '');
    this.glow.style.animation = 'wf-glow 1.05s ease-out';
    window.setTimeout(() => { this.glow.style.animation = ''; }, 1100);

    // 5. The header numbers you just changed bump so the spend is legible.
    for (const key of ['avail', 'spent']) {
      const el = this.header.querySelector(`[data-${key}]`) as HTMLElement | null;
      if (!el) continue;
      el.setAttribute('data-wf-anim', '');
      el.style.animation = 'wf-bump 0.5s ease-out';
      window.setTimeout(() => { el.style.animation = ''; }, 520);
    }

    // 6. The banner — what you bought, and the first thing it opened up.
    const opened = WARFARE_TREE.filter((n) => n.prereq === node.id);
    const next = opened.length
      ? `Now available: ${opened.map((n) => n.name).join(' · ')}`
      : node.capstone ? 'Branch complete — this is the top of its tree.'
        : 'Blueprints updated. Build it in the world.';
    this.banner.innerHTML =
      `<span style="width:32px;height:32px;border-radius:9px;flex:none;display:flex;` +
      `align-items:center;justify-content:center;background:${GOLD_SOFT}">` +
      `${icon('check', 19, 2.4)}</span>` +
      `<span style="display:flex;flex-direction:column;gap:2px">` +
      `<span style="font-size:12.5px;font-weight:700;letter-spacing:1.2px">` +
      `${node.name.toUpperCase()} AUTHORIZED</span>` +
      `<span style="font-size:10.5px;font-weight:500;color:${INK_MID}">${next}</span></span>`;
    this.banner.setAttribute('data-wf-anim', '');
    this.banner.style.animation = 'none';
    void this.banner.offsetWidth; // restart the animation on a rapid second buy
    this.banner.style.animation = 'wf-banner 2.6s ease-out forwards';
  }

  /**
   * Where the tree should be looking when it opens: the FRONTIER, not the root.
   * The cheapest thing you can afford right now, else the next thing your
   * purchases have unlocked, else the deepest node you already own — so a player
   * with half a tree never opens onto a screen of finished work.
   */
  private focusNode(state: WarfareProgress): string {
    const rank = (list: WarfareNode[]): WarfareNode | undefined =>
      list.slice().sort((a, b) => a.depth - b.depth || a.cost - b.cost)[0];
    const affordable = rank(WARFARE_TREE.filter((n) => canBuyWarfareNode(state, n.id)));
    if (affordable) return affordable.id;
    const reachable = rank(WARFARE_TREE.filter(
      (n) => warfareUnlocked(state, n.id) && !warfareOwns(state, n.id)));
    if (reachable) return reachable.id;
    const owned = WARFARE_TREE.filter((n) => warfareOwns(state, n.id));
    if (owned.length) return owned[owned.length - 1].id;
    return WARFARE_TREE[0].id;
  }

  // --- rendering ---------------------------------------------------------------

  show(): void {
    if (this.open) return;
    this.open = true;
    this.root.style.display = 'block';
    this.card.tabIndex = -1;
    this.mobile = window.innerWidth < 900;
    this.layoutMode();
    // Open ON the work in front of you — the frontier of the tree — rather than
    // on the root node, which by mid-game is ancient history.
    this.selected = this.focusNode(this.hooks.state());
    this.recenter();
    this.applyTransform();
    this.refresh();
    this.preview.start();
    this.card.focus({ preventScroll: true });
    this.hooks.onOpen?.();
  }

  hide(): void {
    if (!this.open) return;
    this.open = false;
    this.root.style.display = 'none';
    // Previews are explicitly paused while hidden — a closed tree costs nothing.
    this.preview.stop();
    this.hooks.onClose?.();
  }

  toggle(): void { if (this.open) this.hide(); else this.show(); }

  /** Re-run the responsive layout (also safe to call on resize). */
  layoutMode(): void {
    this.mobile = window.innerWidth < 900;
    // The card deliberately does NOT fill the screen: the world (and the whole
    // bottom HUD — hotbar, hearts, energy) stays visible and live behind it.
    // Clear the box properties one by one rather than rewriting cssText: the
    // browser re-serializes shorthands there, and a blunt regex over the result
    // can behead a longhand it never meant to touch.
    for (const prop of ['top', 'left', 'right', 'bottom', 'width', 'transform']) {
      this.card.style.removeProperty(prop);
    }
    if (this.mobile) {
      this.card.style.top = 'calc(8px + env(safe-area-inset-top))';
      this.card.style.left = 'calc(8px + env(safe-area-inset-left))';
      this.card.style.right = 'calc(8px + env(safe-area-inset-right))';
      this.card.style.bottom = 'calc(8px + env(safe-area-inset-bottom))';
    } else {
      this.card.style.top = 'calc(16px + env(safe-area-inset-top))';
      this.card.style.bottom = '104px';   // clear of the hotbar + hearts
      this.card.style.left = '50%';
      this.card.style.width = 'min(1180px, calc(100vw - 56px))';
      this.card.style.transform = 'translateX(-50%)';
    }
    this.rail.style.display = this.mobile ? 'none' : 'block';
    this.sheet.style.display = this.mobile ? 'block' : 'none';
    this.chips.style.display = this.mobile ? 'flex' : 'none';
    this.viewport.style.top = this.mobile ? '110px' : '60px';
    this.viewport.style.right = this.mobile ? '0' : '380px';
    this.zoomControls.style.display = this.mobile ? 'flex' : 'none';
    // Keep the zoom stack clear of the bottom sheet.
    this.zoomControls.style.bottom = this.mobile ? `calc(${SHEET_PCT}% + 12px)` : '12px';
    // The header sheds its stat block and meter before they can crowd the title.
    const narrow = window.innerWidth < 1120;
    (this.header.querySelector('[data-stats]') as HTMLElement).style.display =
      this.mobile ? 'none' : 'flex';
    (this.header.querySelector('[data-meter]') as HTMLElement).style.display =
      narrow ? 'none' : 'flex';
    (this.header.querySelector('[data-sub]') as HTMLElement).style.display =
      narrow ? 'none' : 'block';
    this.preview.resize(this.mobile ? 300 : 344, this.mobile ? 186 : 210);
  }

  /** Repaint everything from the current authoritative progression. */
  refresh(): void {
    if (!this.open) return;
    const state = this.hooks.state();
    const available = warfareAvailable(state);
    const spent = warfareSpent(state);

    // Header numbers.
    const num = (key: string, value: string, color: string): void => {
      const el = this.header.querySelector(`[data-${key}]`) as HTMLElement;
      el.textContent = value;
      el.style.color = color;
    };
    num('avail', available.toLocaleString(), available > 0 ? GREEN : INK_DIM);
    num('earned', state.xp.toLocaleString(), INK);
    num('spent', `${spent.toLocaleString()}/${WARFARE_TREE_COST.toLocaleString()}`, INK_MID);
    const pct = warfareCompletion(state);
    (this.header.querySelector('[data-fill]') as HTMLElement).style.width =
      `${(pct * 100).toFixed(1)}%`;
    (this.header.querySelector('[data-pct]') as HTMLElement).textContent =
      `${Math.round(pct * 100)}%`;

    // Branch chips.
    for (const chip of this.chips.querySelectorAll('[data-chip]')) {
      const el = chip as HTMLElement;
      const on = el.dataset.chip === this.filter;
      el.style.background = on ? BLUE : CARD;
      el.style.color = on ? '#ffffff' : INK_MID;
      el.style.borderColor = on ? BLUE : HAIR;
    }

    // Nodes.
    for (const n of WARFARE_TREE) {
      const btn = this.buttons.get(n.id)!;
      const owned = warfareOwns(state, n.id);
      const unlocked = warfareUnlocked(state, n.id);
      const affordable = canBuyWarfareNode(state, n.id);
      const shown = this.visible(n);
      const selected = n.id === this.selected;
      const st: NodeState = owned ? 'owned' : affordable ? 'ready'
        : unlocked ? 'unlocked' : 'locked';
      const col = STATE_COLOR[st];
      btn.style.display = shown ? 'flex' : 'none';

      btn.style.background = st === 'locked' ? SLATE_SOFT : CARD;
      btn.style.borderColor = selected ? BLUE : col.edge;
      btn.style.borderStyle = st === 'locked' ? 'dashed' : 'solid';
      btn.style.boxShadow = selected
        ? `0 0 0 3px ${BLUE_SOFT}, 0 6px 18px rgba(10,20,36,0.14)`
        : st === 'locked' ? 'none' : '0 1px 3px rgba(10,20,36,0.07)';
      btn.style.transform = selected ? 'scale(1.03)' : 'scale(1)';
      btn.style.opacity = st === 'locked' ? '0.78' : '1';

      const chip = btn.querySelector('[data-chip]') as HTMLElement;
      chip.style.background = col.tint;
      chip.style.color = st === 'unlocked' ? BLUE : col.ink;
      (btn.querySelector('[data-name]') as HTMLElement).style.color =
        st === 'locked' ? INK_DIM : INK;

      const cost = btn.querySelector('[data-cost]') as HTMLElement;
      cost.style.color = st === 'unlocked' ? INK_DIM : col.ink;
      cost.innerHTML = owned
        ? `${icon('check', 12, 2.2)}<span>AUTHORIZED</span>`
        : st === 'locked'
          ? `${icon('lock', 12)}<span>${n.cost.toLocaleString()} XP</span>`
          : `<span>${n.cost.toLocaleString()} XP</span>` +
            (affordable ? `<span style="font-weight:700">· READY</span>` : '');
      btn.setAttribute('aria-pressed', owned ? 'true' : 'false');
      btn.setAttribute('aria-label',
        `${n.name}. ${owned ? 'Authorized.' : `Costs ${n.cost} warfare XP. ` +
          (warfareBlockReason(state, n.id) ?? 'Ready to authorize.')}`);

      // Edge styling: amber once the child is owned, blue once its prerequisite
      // is satisfied, a dashed hairline while it is still out of reach.
      const edgePath = this.edges.get(n.id);
      if (edgePath) {
        edgePath.setAttribute('stroke', owned ? GOLD : unlocked ? BLUE : '#c3cddc');
        edgePath.setAttribute('opacity',
          shown ? (owned ? '0.9' : unlocked ? '0.65' : '0.55') : '0');
        edgePath.setAttribute('stroke-dasharray', owned ? '' : unlocked ? '8 6' : '3 6');
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
      `<div style="display:flex;align-items:center;gap:6px;font-size:9.5px;` +
      `letter-spacing:1.6px;color:${INK_DIM};text-transform:uppercase">` +
      `<span style="color:${BLUE}">${icon(BRANCH_ICON[node.branch], 14)}</span>` +
      `<span>${meta.name} · ${tierLabel(node.tier)}</span></div>` +
      `<div style="display:flex;align-items:center;gap:11px;margin:9px 0 6px">` +
      `<span style="width:40px;height:40px;border-radius:11px;flex:none;display:flex;` +
      `align-items:center;justify-content:center;background:${owned ? GOLD_SOFT : BLUE_SOFT};` +
      `color:${owned ? GOLD : BLUE_DEEP}">${icon(nodeIconName(node), 23)}</span>` +
      `<span style="font-size:18px;font-weight:700;letter-spacing:0.2px;line-height:1.2;` +
      `color:${owned ? GOLD : INK}">${node.name}</span></div>` +
      `<div style="font-size:12px;color:${INK_MID};line-height:1.55">${node.tagline}</div>`;
    host.appendChild(head);

    // 3D preview of exactly the hardware this node produces.
    const previewWrap = document.createElement('div');
    previewWrap.style.cssText = 'margin:12px 0 5px';
    previewWrap.appendChild(this.preview.canvas);
    host.appendChild(previewWrap);
    const tint = new THREE.Color();
    try { tint.set(this.hooks.tint()); } catch { tint.set('#8794a6'); }
    this.preview.show(`${node.id}:${tint.getHex()}`, () => previewFor(node, tint.getHex()));
    if (reducedMotion()) this.preview.renderOnce();

    const caption = document.createElement('div');
    caption.style.cssText =
      `font-size:10px;color:${INK_DIM};text-align:center;margin-bottom:14px;` +
      'letter-spacing:0.7px;text-transform:uppercase';
    caption.textContent = node.hardware === 'silo' ? 'Tactical missile system'
      : node.hardware === 'battery' ? 'Interceptor battery' : 'Rotary-wing gunship';
    host.appendChild(caption);

    const eyebrow = (text: string): string =>
      `<div style="font-size:9.5px;letter-spacing:1.6px;color:${INK_DIM};` +
      `margin-bottom:7px">${text}</div>`;

    const unlocks = document.createElement('div');
    unlocks.innerHTML = eyebrow('UNLOCKS') +
      node.unlocks.map((u) =>
        `<div style="display:flex;gap:8px;align-items:flex-start;font-size:12px;` +
        `line-height:1.5;color:${INK};padding:3px 0">` +
        `<span style="color:${BLUE};margin-top:2px">${icon('chevron', 12, 2.2)}</span>` +
        `<span>${u}</span></div>`).join('');
    host.appendChild(unlocks);

    const rows = statDiff(node);
    if (rows.length) {
      const table = document.createElement('div');
      table.style.cssText = 'margin-top:16px';
      table.innerHTML =
        eyebrow(`INSTALLED STATS · ${tierLabel(Math.max(1, node.tier - 1))} ` +
          `&rarr; ${tierLabel(node.tier)}`) +
        rows.map((r, i) =>
          `<div style="display:flex;align-items:center;gap:8px;font-size:11.5px;` +
          `padding:5px 0;${i ? `border-top:1px solid ${HAIR_SOFT};` : ''}">` +
          `<span style="flex:1;color:${INK_MID}">${r.label}</span>` +
          `<span style="font-family:${MONO};color:${INK_DIM}">${r.from}</span>` +
          `<span style="color:${r.better ? GREEN : RED};display:flex;align-items:center;` +
          `gap:3px;font-family:${MONO};font-weight:700">` +
          `${icon(r.better ? 'up' : 'down', 11)}<span>${r.to}</span></span></div>`).join('');
      host.appendChild(table);
    }

    const foot = document.createElement('div');
    foot.style.cssText = 'margin-top:18px';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.style.cssText =
      'width:100%;min-height:48px;border-radius:10px;cursor:pointer;display:flex;' +
      `align-items:center;justify-content:center;gap:8px;font-family:${SANS};` +
      'font-size:12.5px;font-weight:700;letter-spacing:0.8px;border:1px solid;';
    if (owned) {
      btn.innerHTML = `${icon('check', 16, 2.2)}<span>AUTHORIZED</span>`;
      btn.disabled = true;
      btn.style.borderColor = GOLD;
      btn.style.background = GOLD_SOFT;
      btn.style.color = GOLD;
      btn.style.cursor = 'default';
    } else if (blocked) {
      btn.innerHTML = `${icon('lock', 16)}<span>${blocked.toUpperCase()}</span>`;
      btn.disabled = true;
      btn.style.borderColor = '#f0c4bf';
      btn.style.background = RED_SOFT;
      btn.style.color = RED;
      btn.style.cursor = 'not-allowed';
    } else {
      btn.innerHTML = `${icon('spark', 16)}` +
        `<span>AUTHORIZE — ${node.cost.toLocaleString()} XP</span>`;
      btn.style.borderColor = GREEN;
      btn.style.background = GREEN;
      btn.style.color = '#ffffff';
      btn.style.boxShadow = '0 2px 12px rgba(15,116,68,0.28)';
      btn.addEventListener('click', () => this.authorize());
    }
    foot.appendChild(btn);
    const hint = document.createElement('div');
    hint.style.cssText =
      `font-size:10.5px;color:${INK_DIM};margin-top:10px;line-height:1.6;` +
      `border-top:1px solid ${HAIR_SOFT};padding-top:10px`;
    hint.textContent = this.mobile
      ? 'Warfare XP comes only from dungeon bosses you actually help kill.'
      : 'Arrows move · Enter authorizes · Home returns to the root · Esc closes. ' +
        'You can still walk around with WASD while this is open.';
    foot.appendChild(hint);
    host.appendChild(foot);
  }
}
