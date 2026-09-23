// THE WARDROBE — one studio for everything you wear.
//
// It replaces two screens that grew up separately: a "dressing room" of
// ‹ value › cyclers you had to click through one option at a time, and a cape
// cabinet that lived behind its own button. Here the soldier stands on a lit
// plinth on the left, full size, and the right-hand side is a set of tabs whose
// options are all laid out at once as tiles you can SEE:
//
//   - colour categories are swatches;
//   - hair, headgear and face options are live 3D head shots, rendered from
//     your current look through the same renderer the plinth uses (no second
//     GL context), so a helmet tile shows the helmet on YOUR face;
//   - capes are a tab like any other, with an honest empty state until capes
//     can be earned.
//
// Painted in daylight, like the title screen it opens from: colour can only be
// judged against paper. Self-contained — one injected `vx-ward-` stylesheet.

import * as THREE from 'three';
import {
  COSMETIC_RANGES, EYE_COLORS, FACE_ACCESSORIES, HAIR_COLORS, HAIR_STYLES, HATS,
  HAT_COLORS, PANTS_COLORS, SHIRT_COLORS, SKIN_TONES, randomCosmetics,
  type Cosmetics, type Swatch,
} from './character';
import { CAPES, NO_CAPE, RARITY_COLORS, ownedCapes, type Wardrobe } from './capes';
import { buildAvatarBody, disposeAvatarBody, type AvatarBody } from './remoteplayers';

type TabId = 'face' | 'hair' | 'uniform' | 'headgear' | 'capes';

interface OptionGroup {
  key: keyof Cosmetics;
  label: string;
  names: string[];
  swatches?: Swatch[];
  /** Render each option as a head shot rather than a text tile. */
  thumbs?: boolean;
}

const TABS: { id: TabId; label: string; icon: string; groups: OptionGroup[] }[] = [
  {
    id: 'face', label: 'Face',
    icon: '<circle cx="12" cy="12" r="8.5"/><path d="M9 10.5h.01M15 10.5h.01M9.5 15h5"/>',
    groups: [
      { key: 'skin', label: 'Skin tone', names: SKIN_TONES.map((s) => s.name), swatches: SKIN_TONES },
      { key: 'eyes', label: 'Eyes', names: EYE_COLORS.map((s) => s.name), swatches: EYE_COLORS },
      { key: 'face', label: 'Features', names: FACE_ACCESSORIES, thumbs: true },
    ],
  },
  {
    id: 'hair', label: 'Hair',
    icon: '<path d="M5 13c0-5 3-8.5 7-8.5s7 3.5 7 8.5M5 13c1.5-1 3-3 3.5-5.5C11 10 15 11 19 13"/>',
    groups: [
      { key: 'hairStyle', label: 'Cut', names: HAIR_STYLES, thumbs: true },
      { key: 'hair', label: 'Colour', names: HAIR_COLORS.map((s) => s.name), swatches: HAIR_COLORS },
    ],
  },
  {
    id: 'uniform', label: 'Uniform',
    icon: '<path d="M8.5 3.5 4 6v4.5h3V20.5h10V10.5h3V6l-4.5-2.5C15 5 13.7 6 12 6S9 5 8.5 3.5z"/>',
    groups: [
      { key: 'shirt', label: 'Tunic', names: SHIRT_COLORS.map((s) => s.name), swatches: SHIRT_COLORS },
      { key: 'pants', label: 'Trousers', names: PANTS_COLORS.map((s) => s.name), swatches: PANTS_COLORS },
    ],
  },
  {
    id: 'headgear', label: 'Headgear',
    icon: '<path d="M4 14a8 8 0 0 1 16 0zM2.5 14h19M12 6V4"/>',
    groups: [
      { key: 'hat', label: 'Headgear', names: HATS, thumbs: true },
      { key: 'hatColor', label: 'Colour', names: HAT_COLORS.map((s) => s.name), swatches: HAT_COLORS },
    ],
  },
  {
    id: 'capes', label: 'Capes',
    icon: '<path d="M7 3.5h10l2.5 16.5-4-1.8L12 20.5l-3.5-2.3-4 1.8z"/>',
    groups: [],
  },
];

const hex = (n: number): string => `#${n.toString(16).padStart(6, '0')}`;
const svg = (body: string): string =>
  `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

const CSS = `
.vx-ward {
  --ink: #122032; --ink-soft: #3b4f68; --ink-mute: #687d95;
  --line: rgba(18,32,50,.10); --line-firm: rgba(18,32,50,.18);
  --accent: #2d6ee0; --gold: #e3a12a;
  position: absolute; inset: 0; z-index: 24; display: none;
  align-items: center; justify-content: center; padding: 20px;
  color: var(--ink);
  font-family: ui-sans-serif, -apple-system, 'Segoe UI', Roboto, system-ui, sans-serif;
  background:
    radial-gradient(ellipse 60% 50% at 10% 0%, rgba(255,222,170,.55), transparent 62%),
    radial-gradient(ellipse 60% 50% at 95% 10%, rgba(170,205,255,.5), transparent 64%),
    linear-gradient(180deg, #f4f7fb, #e6ecf3);
  animation: vx-ward-in .2s ease both;
}
.vx-ward[data-open="1"] { display: flex; }
.vx-ward * { box-sizing: border-box; text-shadow: none; font-family: inherit; }
@keyframes vx-ward-in { from { opacity: 0; } }
.vx-ward-shell {
  position: relative; display: grid; grid-template-columns: minmax(300px, 0.9fr) minmax(0, 1.25fr);
  grid-template-rows: auto minmax(0, 1fr) auto;
  width: min(1180px, 100%); height: min(760px, 100%);
  border-radius: 26px; overflow: hidden;
  background: #fff; box-shadow: 0 40px 90px rgba(24,40,66,.22), inset 0 0 0 1px var(--line);
  animation: vx-ward-rise .28s cubic-bezier(.2,.9,.3,1) both;
}
@keyframes vx-ward-rise { from { transform: translateY(14px) scale(.985); opacity: 0; } }
.vx-ward-head {
  grid-column: 1 / -1; display: flex; align-items: center; justify-content: space-between; gap: 16px;
  padding: 18px 24px; border-bottom: 1px solid var(--line);
}
.vx-ward-kicker { font-size: 10px; font-weight: 800; letter-spacing: 2px; text-transform: uppercase; color: #a8740f; }
.vx-ward-title { margin: 2px 0 0; font-size: 24px; font-weight: 850; letter-spacing: -.3px; }
.vx-ward-dirty {
  display: none; align-items: center; gap: 7px; padding: 6px 11px; border-radius: 999px;
  font-size: 11px; font-weight: 750; color: #8a5a07; background: #fff4dc;
}
.vx-ward-dirty::before { content: ''; width: 7px; height: 7px; border-radius: 50%; background: var(--gold); }
.vx-ward[data-dirty="1"] .vx-ward-dirty { display: inline-flex; }
.vx-ward-x {
  width: 40px; height: 40px; display: grid; place-items: center; border: 0; border-radius: 12px;
  background: rgba(18,32,50,.05); color: var(--ink-soft); cursor: pointer;
}
.vx-ward-x:hover { background: rgba(18,32,50,.1); color: var(--ink); }
.vx-ward-x svg { width: 20px; height: 20px; }

/* LEFT: the plinth. */
.vx-ward-stage {
  position: relative; min-height: 0; overflow: hidden; border-right: 1px solid var(--line);
  background:
    radial-gradient(ellipse 50% 10% at 50% 86%, rgba(18,32,50,.22), transparent 70%),
    radial-gradient(ellipse 70% 55% at 50% 20%, rgba(255,255,255,.95), transparent 70%),
    linear-gradient(180deg, #d5e6f8 0%, #edf3f9 62%, #e0e7ef 62.2%, #eef2f6 100%);
  cursor: grab; touch-action: none;
}
.vx-ward-stage:active { cursor: grabbing; }
.vx-ward-stage canvas { position: absolute; inset: 0; width: 100% !important; height: 100% !important; }
.vx-ward-stagebar {
  position: absolute; left: 14px; right: 14px; bottom: 14px; z-index: 2;
  display: flex; align-items: center; justify-content: space-between; gap: 8px; pointer-events: none;
}
.vx-ward-seg {
  pointer-events: auto; display: inline-flex; gap: 3px; padding: 3px; border-radius: 12px;
  background: rgba(255,255,255,.85); box-shadow: 0 6px 18px rgba(24,40,66,.14); backdrop-filter: blur(8px);
}
.vx-ward-seg button {
  border: 0; border-radius: 9px; padding: 7px 11px; cursor: pointer; background: transparent;
  font-size: 11px; font-weight: 750; color: var(--ink-mute);
}
.vx-ward-seg button[aria-pressed="true"] { background: var(--ink); color: #fff; }
.vx-ward-seg .sw { display: inline-block; width: 10px; height: 10px; border-radius: 3px; vertical-align: -1px; margin-right: 5px; }
.vx-ward-hint {
  position: absolute; top: 14px; left: 50%; transform: translateX(-50%); z-index: 2; pointer-events: none;
  font-size: 10px; font-weight: 800; letter-spacing: 1.6px; text-transform: uppercase; color: var(--ink-mute);
  background: rgba(255,255,255,.7); padding: 5px 10px; border-radius: 999px;
}

/* RIGHT: tabs + tiles. */
.vx-ward-panel { display: flex; flex-direction: column; min-height: 0; }
.vx-ward-tabs { display: flex; gap: 4px; padding: 14px 20px 0; border-bottom: 1px solid var(--line); overflow-x: auto; }
.vx-ward-tab {
  display: inline-flex; align-items: center; gap: 7px; padding: 10px 14px 12px; border: 0; cursor: pointer;
  background: transparent; font-size: 13px; font-weight: 750; color: var(--ink-mute);
  border-bottom: 2.5px solid transparent; margin-bottom: -1px; white-space: nowrap;
}
.vx-ward-tab svg { width: 18px; height: 18px; }
.vx-ward-tab:hover { color: var(--ink); }
.vx-ward-tab[aria-selected="true"] { color: var(--ink); border-bottom-color: var(--ink); }
.vx-ward-body { flex: 1; min-height: 0; overflow-y: auto; padding: 18px 20px 22px; }
.vx-ward-group + .vx-ward-group { margin-top: 22px; }
.vx-ward-glabel {
  display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 10px;
  font-size: 11px; font-weight: 800; letter-spacing: 1.2px; text-transform: uppercase; color: var(--ink-mute);
}
.vx-ward-glabel b { font-size: 13px; font-weight: 750; letter-spacing: 0; text-transform: none; color: var(--ink); }
.vx-ward-grid { display: grid; gap: 8px; grid-template-columns: repeat(auto-fill, minmax(92px, 1fr)); }
.vx-ward-grid.swatches { grid-template-columns: repeat(auto-fill, minmax(46px, 1fr)); }
.vx-ward-tile {
  position: relative; display: flex; flex-direction: column; align-items: center; gap: 6px;
  padding: 8px 6px 9px; border-radius: 14px; cursor: pointer;
  border: 1.5px solid var(--line); background: #f7f9fc;
  font-size: 11.5px; font-weight: 700; color: var(--ink-soft); text-align: center; line-height: 1.2;
  transition: border-color .12s, transform .12s, box-shadow .12s, background .12s;
}
.vx-ward-tile:hover { transform: translateY(-2px); border-color: var(--line-firm); background: #fff; box-shadow: 0 8px 18px rgba(24,40,66,.1); }
.vx-ward-tile:focus-visible { outline: 2.5px solid var(--accent); outline-offset: 2px; }
.vx-ward-tile[aria-checked="true"] {
  border-color: var(--ink); background: #fff; color: var(--ink);
  box-shadow: 0 0 0 3px rgba(18,32,50,.1), 0 8px 18px rgba(24,40,66,.12);
}
.vx-ward-tile[aria-checked="true"]::after {
  content: ''; position: absolute; top: 6px; right: 6px; width: 16px; height: 16px; border-radius: 50%;
  background: var(--ink) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M6 12.5l4 4 8-9' fill='none' stroke='white' stroke-width='3' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E") center/12px no-repeat;
}
.vx-ward-thumb {
  width: 100%; aspect-ratio: 1; border-radius: 10px; display: block;
  background: linear-gradient(180deg, #dbe8f6, #eef3f8);
}
.vx-ward-thumb.pending { animation: vx-ward-pulse 1s ease-in-out infinite alternate; }
@keyframes vx-ward-pulse { to { opacity: .55; } }
.vx-ward-sw {
  aspect-ratio: 1; border-radius: 12px; cursor: pointer; position: relative;
  border: 2px solid rgba(255,255,255,.9); box-shadow: 0 0 0 1px var(--line-firm), inset 0 -6px 10px rgba(0,0,0,.12);
  transition: transform .12s, box-shadow .12s;
}
.vx-ward-sw:hover { transform: translateY(-2px) scale(1.04); }
.vx-ward-sw:focus-visible { outline: 2.5px solid var(--accent); outline-offset: 2px; }
.vx-ward-sw[aria-checked="true"] { box-shadow: 0 0 0 2.5px var(--ink), 0 8px 16px rgba(24,40,66,.2); }
.vx-ward-sw[aria-checked="true"]::after {
  content: ''; position: absolute; inset: 30%; border-radius: 50%; background: #fff;
  box-shadow: 0 1px 4px rgba(0,0,0,.35);
}

.vx-ward-empty {
  display: grid; justify-items: center; gap: 10px; padding: 34px 20px; text-align: center;
  border: 1.5px dashed var(--line-firm); border-radius: 18px; color: var(--ink-soft); background: #f8fafc;
}
.vx-ward-empty svg { width: 46px; height: 46px; color: #b6c3d2; }
.vx-ward-empty h4 { margin: 0; font-size: 16px; color: var(--ink); }
.vx-ward-empty p { margin: 0; max-width: 42ch; font-size: 13px; line-height: 1.55; }
.vx-ward-cape .vx-ward-swatch { width: 100%; aspect-ratio: 3 / 4; border-radius: 10px; }

.vx-ward-foot {
  grid-column: 1 / -1; display: flex; align-items: center; gap: 10px;
  padding: 14px 20px; border-top: 1px solid var(--line); background: #fbfcfe;
}
.vx-ward-btn {
  display: inline-flex; align-items: center; gap: 8px; min-height: 44px; padding: 10px 18px;
  border: 1px solid var(--line-firm); border-radius: 13px; cursor: pointer; background: #fff;
  font-size: 13px; font-weight: 750; color: var(--ink);
  transition: transform .12s, box-shadow .12s, background .12s;
}
.vx-ward-btn svg { width: 18px; height: 18px; }
.vx-ward-btn:hover { transform: translateY(-1px); box-shadow: 0 8px 18px rgba(24,40,66,.12); }
.vx-ward-btn.primary {
  margin-left: auto; padding: 10px 26px; border-color: transparent; color: #fff;
  background: linear-gradient(180deg, #24344c, #122032); box-shadow: 0 10px 24px rgba(18,32,50,.28);
}
.vx-ward-btn.primary[disabled] { opacity: .5; cursor: default; transform: none; box-shadow: none; }

@media (max-width: 860px) {
  .vx-ward { padding: 0; }
  .vx-ward-shell { grid-template-columns: minmax(0, 1fr); grid-template-rows: auto 38vh minmax(0, 1fr) auto; width: 100%; height: 100%; border-radius: 0; }
  .vx-ward-panel { min-width: 0; }
  .vx-ward-stage { border-right: 0; border-bottom: 1px solid var(--line); }
  .vx-ward-head { padding: 12px 16px; }
  .vx-ward-title { font-size: 20px; }
  .vx-ward-dirty { display: none !important; }
  .vx-ward-stagebar { flex-direction: column; align-items: stretch; gap: 6px; }
  .vx-ward-seg { justify-content: center; }
  .vx-ward-seg button { flex: 1; padding: 7px 6px; }
  .vx-ward-tabs { padding: 8px 12px 0; }
  .vx-ward-tab { padding: 9px 10px 11px; font-size: 12px; }
  .vx-ward-body { padding: 14px; }
  .vx-ward-grid { grid-template-columns: repeat(auto-fill, minmax(76px, 1fr)); }
  .vx-ward-foot { display: grid; grid-template-columns: auto auto 1fr; padding: 10px 12px; gap: 8px; }
  .vx-ward-btn { padding: 10px 12px; font-size: 12px; }
  .vx-ward-btn:not(.primary) span { display: none; }
  .vx-ward-btn.primary { margin-left: 0; justify-content: center; }
}
@media (prefers-reduced-motion: reduce) {
  .vx-ward, .vx-ward-shell, .vx-ward-thumb.pending { animation: none; }
}
`;

export interface WardrobeOptions {
  root: HTMLElement;
  /** The look to start editing from. */
  getCosmetics(): Cosmetics;
  getWardrobe(): Wardrobe;
  /** The two faction colours, for the "see it in the war" toggle. */
  factions: { name: string; color: number }[];
  /** Your side, if you have one — the preview defaults to it. */
  getFaction(): number;
  reducedMotion(): boolean;
  onSave(look: Cosmetics): void;
  onEquipCape(id: string): void;
}

export interface WardrobeUI {
  readonly open: boolean;
  show(tab?: TabId): void;
  hide(): void;
  /** Re-read the cape collection (after an equip or a load). */
  update(): void;
  onOpen?: () => void;
  onClose?: () => void;
}

export function createWardrobe(opts: WardrobeOptions): WardrobeUI {
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);

  const el = document.createElement('div');
  el.className = 'vx-ward';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-label', 'Wardrobe');
  el.innerHTML = `
    <div class="vx-ward-shell">
      <header class="vx-ward-head">
        <div>
          <div class="vx-ward-kicker">Wardrobe</div>
          <h2 class="vx-ward-title">Kit out your soldier</h2>
        </div>
        <span class="vx-ward-dirty">Unsaved changes</span>
        <button class="vx-ward-x" type="button" aria-label="Close wardrobe">${svg('<path d="M6 6l12 12M18 6 6 18"/>')}</button>
      </header>
      <div class="vx-ward-stage">
        <div class="vx-ward-hint">Drag to turn</div>
        <div class="vx-ward-stagebar">
          <div class="vx-ward-seg" data-role="frame">
            <button type="button" data-frame="full" aria-pressed="true">Full body</button>
            <button type="button" data-frame="head" aria-pressed="false">Close-up</button>
          </div>
          <div class="vx-ward-seg" data-role="side"></div>
        </div>
      </div>
      <section class="vx-ward-panel">
        <div class="vx-ward-tabs" role="tablist"></div>
        <div class="vx-ward-body"></div>
      </section>
      <footer class="vx-ward-foot">
        <button class="vx-ward-btn" type="button" data-act="random">${svg('<rect x="3.5" y="3.5" width="17" height="17" rx="4"/><path d="M8.5 8.5h.01M15.5 15.5h.01M15.5 8.5h.01M8.5 15.5h.01M12 12h.01"/>')}<span>Randomise</span></button>
        <button class="vx-ward-btn" type="button" data-act="reset">${svg('<path d="M4 12a8 8 0 1 0 2.5-5.8M4 4v4.5h4.5"/>')}<span>Undo changes</span></button>
        <button class="vx-ward-btn primary" type="button" data-act="save">${svg('<path d="M5 12.5l4.5 4.5L19 7.5"/>')}Save look</button>
      </footer>
    </div>`;
  opts.root.appendChild(el);

  const stage = el.querySelector<HTMLElement>('.vx-ward-stage')!;
  const tabsEl = el.querySelector<HTMLElement>('.vx-ward-tabs')!;
  const bodyEl = el.querySelector<HTMLElement>('.vx-ward-body')!;
  const saveBtn = el.querySelector<HTMLButtonElement>('[data-act="save"]')!;
  const sideSeg = el.querySelector<HTMLElement>('[data-role="side"]')!;

  let isOpen = false;
  let tab: TabId = 'face';
  const editing = { ...opts.getCosmetics() };
  let saved = { ...editing };
  /** -1: your own uniform colour; otherwise a faction index to preview in. */
  let side = -1;
  let frame: 'full' | 'head' = 'full';

  // ── renderer (lazy; one context for the plinth AND every thumbnail) ────
  let renderer: THREE.WebGLRenderer | null = null;
  const scene = new THREE.Scene();
  const cam = new THREE.PerspectiveCamera(32, 1, 0.1, 30);
  let body: AvatarBody | null = null;
  let spin = Math.PI + 0.35;
  let spinVel = 0;
  let raf = 0;
  const camPos = new THREE.Vector3(0, 1.15, 5.2);
  const camLook = new THREE.Vector3(0, 0.98, 0);
  const camPosT = camPos.clone();
  const camLookT = camLook.clone();

  function ensureRenderer(): THREE.WebGLRenderer {
    if (renderer) return renderer;
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setClearColor(0x000000, 0);
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    stage.prepend(renderer.domElement);
    new ResizeObserver(resize).observe(stage);
    resize();
    return renderer;
  }
  function resize(): void {
    if (!renderer) return;
    const w = Math.max(1, stage.clientWidth), h = Math.max(1, stage.clientHeight);
    renderer.setSize(w, h, false);
    cam.aspect = w / h;
    cam.updateProjectionMatrix();
  }

  function shirtOverride(): THREE.Color | undefined {
    return side >= 0 ? new THREE.Color(opts.factions[side].color) : undefined;
  }
  function rebuild(): void {
    if (body) { scene.remove(body.group); disposeAvatarBody(body); }
    body = buildAvatarBody({ ...editing }, shirtOverride());
    body.group.rotation.y = spin;
    scene.add(body.group);
  }

  // Drag to turn, with a little momentum.
  let dragId: number | null = null;
  let lastX = 0;
  stage.addEventListener('pointerdown', (e) => {
    if ((e.target as HTMLElement).closest('button')) return;
    dragId = e.pointerId; lastX = e.clientX; spinVel = 0;
    stage.setPointerCapture(e.pointerId);
  });
  stage.addEventListener('pointermove', (e) => {
    if (dragId !== e.pointerId) return;
    const d = (e.clientX - lastX) * 0.012;
    spin += d; spinVel = d; lastX = e.clientX;
  });
  const endDrag = (e: PointerEvent): void => { if (dragId === e.pointerId) dragId = null; };
  stage.addEventListener('pointerup', endDrag);
  stage.addEventListener('pointercancel', endDrag);

  function loop(): void {
    raf = requestAnimationFrame(loop);
    if (!renderer || !body) return;
    const t = performance.now() / 1000;
    if (dragId === null) {
      spin += spinVel;
      spinVel *= 0.92;
      if (Math.abs(spinVel) < 0.0005 && !opts.reducedMotion()) spin += 0.0025;
    }
    body.group.rotation.y = spin;
    const breath = Math.sin(t * 1.6) * 0.012;
    body.parts[2].rotation.set(-0.05 + breath, 0, -0.05);
    body.parts[3].rotation.set(0.05 - breath, 0, 0.05);
    camPos.lerp(camPosT, 0.12);
    camLook.lerp(camLookT, 0.12);
    cam.position.copy(camPos);
    cam.lookAt(camLook);
    renderer.render(scene, cam);
  }

  function setFrame(f: 'full' | 'head'): void {
    frame = f;
    if (f === 'full') { camPosT.set(0, 1.15, 5.2); camLookT.set(0, 0.98, 0); }
    else { camPosT.set(0, 1.78, 1.9); camLookT.set(0, 1.72, 0); }
    for (const b of el.querySelectorAll<HTMLButtonElement>('[data-frame]')) {
      b.setAttribute('aria-pressed', String(b.dataset.frame === f));
    }
  }
  el.querySelector('[data-role="frame"]')!.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-frame]');
    if (b) setFrame(b.dataset.frame as 'full' | 'head');
  });

  function renderSideSeg(): void {
    const btn = (id: number, label: string, color?: number): string =>
      `<button type="button" data-side="${id}" aria-pressed="${side === id}">${
        color !== undefined ? `<span class="sw" style="background:${hex(color)}"></span>` : ''}${label}</button>`;
    sideSeg.innerHTML = btn(-1, 'My colours')
      + opts.factions.map((f, i) => btn(i, f.name, f.color)).join('');
  }
  sideSeg.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-side]');
    if (!b) return;
    side = Number(b.dataset.side);
    renderSideSeg();
    rebuild();
  });

  // ── thumbnails: head shots rendered off-screen through the same context ──
  const THUMB = 128;
  let thumbTarget: THREE.WebGLRenderTarget | null = null;
  const thumbScene = new THREE.Scene();
  const thumbCam = new THREE.PerspectiveCamera(30, 1, 0.1, 10);
  thumbCam.position.set(0.55, 1.86, 1.55);
  thumbCam.lookAt(0, 1.74, 0);
  const pixels = new Uint8Array(THUMB * THUMB * 4);
  const thumbCanvas = document.createElement('canvas');
  thumbCanvas.width = thumbCanvas.height = THUMB;
  const thumbCtx = thumbCanvas.getContext('2d')!;
  const thumbCache = new Map<string, string>();

  function headShot(look: Cosmetics): string {
    const key = JSON.stringify(look) + side;
    const hit = thumbCache.get(key);
    if (hit) return hit;
    const r = ensureRenderer();
    if (!thumbTarget) {
      thumbTarget = new THREE.WebGLRenderTarget(THUMB, THUMB, { samples: 4 });
      thumbTarget.texture.colorSpace = THREE.SRGBColorSpace;
    }
    const b = buildAvatarBody(look, shirtOverride());
    b.group.rotation.y = Math.PI;
    thumbScene.add(b.group);
    const prev = r.getRenderTarget();
    r.setRenderTarget(thumbTarget);
    r.setClearColor(0x000000, 0);
    r.clear();
    r.render(thumbScene, thumbCam);
    r.readRenderTargetPixels(thumbTarget, 0, 0, THUMB, THUMB, pixels);
    r.setRenderTarget(prev);
    thumbScene.remove(b.group);
    disposeAvatarBody(b);
    // GL rows run bottom-up; the canvas wants them top-down.
    const img = thumbCtx.createImageData(THUMB, THUMB);
    for (let y = 0; y < THUMB; y++) {
      img.data.set(pixels.subarray((THUMB - 1 - y) * THUMB * 4, (THUMB - y) * THUMB * 4), y * THUMB * 4);
    }
    thumbCtx.putImageData(img, 0, 0);
    const url = thumbCanvas.toDataURL();
    thumbCache.set(key, url);
    return url;
  }

  /** Fill pending thumbnails a few per frame so the tab paints instantly. */
  let thumbJob = 0;
  function pumpThumbs(): void {
    cancelAnimationFrame(thumbJob);
    const step = (): void => {
      const pending = [...bodyEl.querySelectorAll<HTMLImageElement>('img.vx-ward-thumb.pending')];
      for (const img of pending.slice(0, 3)) {
        const key = img.dataset.key as keyof Cosmetics;
        const look = { ...editing, [key]: Number(img.dataset.value) };
        img.src = headShot(look);
        img.classList.remove('pending');
      }
      if (pending.length > 3) thumbJob = requestAnimationFrame(step);
    };
    thumbJob = requestAnimationFrame(step);
  }

  // ── tabs and tiles ─────────────────────────────────────────────────────
  function renderTabs(): void {
    tabsEl.innerHTML = TABS.map((t) =>
      `<button class="vx-ward-tab" type="button" role="tab" data-tab="${t.id}" aria-selected="${t.id === tab}">${svg(t.icon)}${t.label}</button>`,
    ).join('');
  }
  tabsEl.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-tab]');
    if (!b) return;
    tab = b.dataset.tab as TabId;
    renderTabs();
    renderBody();
  });

  function renderBody(): void {
    const def = TABS.find((t) => t.id === tab)!;
    if (tab === 'capes') { renderCapes(); return; }
    bodyEl.innerHTML = def.groups.map((g) => {
      const cur = editing[g.key];
      const head = `<div class="vx-ward-glabel">${g.label}<b>${g.names[cur] ?? ''}</b></div>`;
      if (g.swatches) {
        return `<div class="vx-ward-group">${head}<div class="vx-ward-grid swatches" role="radiogroup" aria-label="${g.label}">${
          g.swatches.map((s, i) => `<button type="button" class="vx-ward-sw" role="radio" data-key="${g.key}" data-value="${i}" aria-checked="${i === cur}" title="${s.name}" aria-label="${s.name}" style="background:${hex(s.hex)}"></button>`).join('')
        }</div></div>`;
      }
      return `<div class="vx-ward-group">${head}<div class="vx-ward-grid" role="radiogroup" aria-label="${g.label}">${
        g.names.map((n, i) => `<button type="button" class="vx-ward-tile" role="radio" data-key="${g.key}" data-value="${i}" aria-checked="${i === cur}">${
          g.thumbs ? `<img class="vx-ward-thumb pending" alt="" data-key="${g.key}" data-value="${i}">` : ''}<span>${n}</span></button>`).join('')
      }</div></div>`;
    }).join('');
    pumpThumbs();
  }

  function renderCapes(): void {
    const w = opts.getWardrobe();
    const owned = ownedCapes(w);
    if (!CAPES.length || !owned.length) {
      bodyEl.innerHTML = `<div class="vx-ward-empty">
        ${svg('<path d="M7 3.5h10l2.5 16.5-4-1.8L12 20.5l-3.5-2.3-4 1.8z"/>')}
        <h4>No capes yet</h4>
        <p>Capes are earned, not bought or picked. When you win one it hangs here, and you can put it on with a click.</p>
      </div>`;
      return;
    }
    const tile = (id: string, name: string, colors: [number, number] | null, blurb: string, rarity?: string): string =>
      `<button type="button" class="vx-ward-tile vx-ward-cape" role="radio" data-cape="${id}" aria-checked="${w.equipped === id}" title="${blurb}">
        <span class="vx-ward-swatch" style="background:${colors
          ? `linear-gradient(180deg, ${hex(colors[0])} 0 78%, ${hex(colors[1])} 78% 100%)`
          : 'repeating-linear-gradient(45deg,#eef2f6 0 6px,#e2e8ef 6px 12px)'};${rarity ? `box-shadow:0 0 0 2px ${rarity}` : ''}"></span>
        <span>${name}</span></button>`;
    bodyEl.innerHTML = `<div class="vx-ward-group"><div class="vx-ward-glabel">Your capes<b>${owned.length}</b></div>
      <div class="vx-ward-grid" role="radiogroup" aria-label="Capes">${
        tile(NO_CAPE, 'No cape', null, 'Bare shoulders')
        + owned.map((c) => tile(c.id, c.name, c.colors, c.blurb, hex(RARITY_COLORS[c.rarity]))).join('')
      }</div></div>`;
  }

  bodyEl.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const cape = t.closest<HTMLElement>('[data-cape]');
    if (cape) { opts.onEquipCape(cape.dataset.cape ?? NO_CAPE); renderCapes(); return; }
    const b = t.closest<HTMLElement>('[data-key][role="radio"]');
    if (!b) return;
    const key = b.dataset.key as keyof Cosmetics;
    const v = Number(b.dataset.value);
    if (!(v >= 0 && v < COSMETIC_RANGES[key])) return;
    editing[key] = v;
    changed(key);
  });
  // Arrow keys walk a radiogroup, like any radio set.
  bodyEl.addEventListener('keydown', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[role="radio"]');
    if (!b || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
    const group = [...b.parentElement!.querySelectorAll<HTMLElement>('[role="radio"]')];
    const i = group.indexOf(b) + (e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 1);
    const next = group[(i + group.length) % group.length];
    e.preventDefault();
    next.focus();
    next.click();
  });

  function markDirty(): void {
    const dirty = (Object.keys(editing) as (keyof Cosmetics)[]).some((k) => editing[k] !== saved[k]);
    el.dataset.dirty = dirty ? '1' : '0';
    saveBtn.disabled = !dirty;
  }
  function changed(key?: keyof Cosmetics): void {
    rebuild();
    // A colour or skin change alters every head shot; a style pick only
    // moves the checkmark — keep the thumbnails and just re-render.
    const focusKey = document.activeElement instanceof HTMLElement ? document.activeElement.dataset : null;
    renderBody();
    if (focusKey?.key === key) {
      bodyEl.querySelector<HTMLElement>(`[data-key="${key}"][data-value="${editing[key!]}"]`)?.focus();
    }
    markDirty();
  }

  el.querySelector('[data-act="random"]')!.addEventListener('click', () => {
    Object.assign(editing, randomCosmetics());
    changed();
  });
  el.querySelector('[data-act="reset"]')!.addEventListener('click', () => {
    Object.assign(editing, saved);
    changed();
  });
  saveBtn.addEventListener('click', () => {
    opts.onSave({ ...editing });
    saved = { ...editing };
    markDirty();
    ui.hide();
  });
  el.querySelector('.vx-ward-x')!.addEventListener('click', () => ui.hide());
  window.addEventListener('keydown', (e) => {
    if (isOpen && e.key === 'Escape') { e.stopPropagation(); ui.hide(); }
  });

  const ui: WardrobeUI = {
    get open() { return isOpen; },
    show(startTab?: TabId): void {
      Object.assign(editing, opts.getCosmetics());
      saved = { ...editing };
      const f = opts.getFaction();
      side = f >= 0 && f < opts.factions.length ? f : -1;
      if (startTab) tab = startTab;
      el.dataset.open = '1';
      isOpen = true;
      ensureRenderer();
      resize();
      setFrame(frame);
      camPos.copy(camPosT); camLook.copy(camLookT);
      renderSideSeg();
      renderTabs();
      rebuild();
      renderBody();
      markDirty();
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(loop);
      ui.onOpen?.();
    },
    hide(): void {
      if (!isOpen) return;
      isOpen = false;
      el.dataset.open = '0';
      cancelAnimationFrame(raf);
      cancelAnimationFrame(thumbJob);
      ui.onClose?.();
    },
    update(): void {
      if (isOpen && tab === 'capes') renderCapes();
    },
  };
  return ui;
}
