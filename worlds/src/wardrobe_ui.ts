// THE WARDROBE — one studio for everything you wear.
//
// It replaces two screens that grew up separately: a "dressing room" of
// ‹ value › cyclers you had to click through one option at a time, and a cape
// cabinet that lived behind its own button. Here your character stands on a lit
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
// judged against paper. Component styling lives in styles/wardrobe.css.

import * as THREE from 'three';
import {
  COSMETIC_RANGES, EYE_COLORS, FACE_ACCESSORIES, HAIR_COLORS, HAIR_STYLES, HATS,
  HAT_COLORS, PANTS_COLORS, SHIRT_COLORS, SKIN_TONES, randomCosmetics,
  type Cosmetics, type Swatch,
} from './character';
import { CAPES, NO_CAPE, RARITY_COLORS, ownedCapes, type Wardrobe } from './capes';
import { buildAvatarBody, disposeAvatarBody, type AvatarBody } from './avatar';

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
    id: 'uniform', label: 'Outfit',
    icon: '<path d="M8.5 3.5 4 6v4.5h3V20.5h10V10.5h3V6l-4.5-2.5C15 5 13.7 6 12 6S9 5 8.5 3.5z"/>',
    groups: [
      { key: 'shirt', label: 'Top', names: SHIRT_COLORS.map((s) => s.name), swatches: SHIRT_COLORS },
      { key: 'pants', label: 'Bottoms', names: PANTS_COLORS.map((s) => s.name), swatches: PANTS_COLORS },
    ],
  },
  {
    id: 'headgear', label: 'Hats',
    icon: '<path d="M4 14a8 8 0 0 1 16 0zM2.5 14h19M12 6V4"/>',
    groups: [
      { key: 'hat', label: 'Hat', names: HATS, thumbs: true },
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

interface WardrobeOptions {
  root: HTMLElement;
  /** The look to start editing from. */
  getCosmetics(): Cosmetics;
  getWardrobe(): Wardrobe;
  reducedMotion(): boolean;
  onSave(look: Cosmetics): void;
  onEquipCape(id: string): void;
}

interface WardrobeUI {
  readonly open: boolean;
  show(tab?: TabId): void;
  hide(): void;
  /** Re-read the cape collection (after an equip or a load). */
  update(): void;
  onOpen?: () => void;
  onClose?: () => void;
}

export function createWardrobe(opts: WardrobeOptions): WardrobeUI {
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
          <h2 class="vx-ward-title">Your look</h2>
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

  let isOpen = false;
  let tab: TabId = 'face';
  const editing = { ...opts.getCosmetics() };
  let saved = { ...editing };
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

  function rebuild(): void {
    if (body) { scene.remove(body.group); disposeAvatarBody(body); }
    body = buildAvatarBody({ ...editing });
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
  // One complete set of head-shot options fits in the cache. Changing the
  // base look creates new keys, so retain only the latest set per opening.
  const thumbCacheLimit = FACE_ACCESSORIES.length + HAIR_STYLES.length + HATS.length;

  function headShot(look: Cosmetics): string {
    const key = JSON.stringify(look);
    const hit = thumbCache.get(key);
    if (hit) return hit;
    const r = ensureRenderer();
    if (!thumbTarget) {
      thumbTarget = new THREE.WebGLRenderTarget(THUMB, THUMB, { samples: 4 });
      thumbTarget.texture.colorSpace = THREE.SRGBColorSpace;
    }
    const b = buildAvatarBody(look);
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
    if (thumbCache.size > thumbCacheLimit) thumbCache.delete(thumbCache.keys().next().value!);
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
      if (startTab) tab = startTab;
      el.dataset.open = '1';
      isOpen = true;
      ensureRenderer();
      resize();
      setFrame(frame);
      camPos.copy(camPosT); camLook.copy(camLookT);
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
      thumbCache.clear();
      ui.onClose?.();
    },
    update(): void {
      if (isOpen && tab === 'capes') renderCapes();
    },
  };
  return ui;
}
