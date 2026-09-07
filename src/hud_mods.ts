// HUD MODULES. The always-on readouts that float over the world while you
// play: FPS, CPS, coordinates, a keystroke display, the clock and so on.
//
// Two things make this different from the rest of the HUD. First, every module
// is DRAGGABLE: the player picks up a readout and drops it anywhere on screen,
// exactly the way Lunar Client's mods work. Second, they are always up. There
// is no key to hold and no debug screen to open; if a module is on, it is on
// screen for the whole session.
//
// A dropped position is stored as an ANCHORED fraction rather than a pixel
// pair: whichever screen corner the module ended up nearest becomes its anchor,
// and the offset from that corner is kept as a fraction of the viewport. That
// is what makes a layout survive a window resize, a fullscreen toggle and a
// phone rotation without every readout sliding into the middle or off the edge,
// and it also means a module that grows (coordinates going from 3 to 5 digits)
// grows AWAY from the screen edge instead of walking off it.
//
// The layout lives in the same localStorage blob as the rest of the HUD
// settings, so it is per device and per browser, like every other HUD choice.

import type { BindAction, Keybinds } from './hud_settings';

// --- Module catalogue -------------------------------------------------------

export type HudModId =
  | 'fps' | 'cps' | 'coords' | 'direction' | 'keystrokes' | 'clock'
  | 'gametime' | 'speed' | 'session' | 'biome' | 'held' | 'players'
  | 'armor' | 'health';

/** Which corner a module hangs off. Chosen automatically when it is dropped. */
type AnchorX = 'l' | 'r';
type AnchorY = 't' | 'b';

export interface HudModConfig {
  /** Drawn while playing. */
  on: boolean;
  ax: AnchorX;
  ay: AnchorY;
  /** Offset from the anchored corner, as a fraction of the viewport. */
  x: number;
  y: number;
  /** Size multiplier, 0.6 .. 2. */
  scale: number;
  /** Draw the themed panel behind the text. */
  bg: boolean;
}

export type HudLayout = Record<HudModId, HudModConfig>;

interface ModuleDef {
  id: HudModId;
  name: string;
  desc: string;
  /** Starting corner and offsets, in the order they stack down that corner. */
  def: Omit<HudModConfig, 'scale' | 'bg'>;
}

/** The catalogue, in the order the settings panel lists them. Every module
 *  starts OFF: a first session should show the world and nothing else, and a
 *  readout the player never asked for is clutter rather than a feature. The
 *  stored corners are where each one lands the moment it IS switched on - the
 *  readouts a Minecraft player already looks for stack down the top-left, and
 *  the keystroke display parks on the left edge, clear of the hotbar and the
 *  heart row. */
export const HUD_MODULES: readonly ModuleDef[] = [
  { id: 'fps', name: 'FPS', desc: 'Frames per second, averaged over one second.',
    def: { on: false, ax: 'l', ay: 't', x: 0.010, y: 0.016 } },
  { id: 'cps', name: 'CPS', desc: 'Left and right clicks over the last second.',
    def: { on: false, ax: 'l', ay: 't', x: 0.010, y: 0.052 } },
  { id: 'coords', name: 'Coordinates', desc: 'Your block position.',
    def: { on: false, ax: 'l', ay: 't', x: 0.010, y: 0.088 } },
  { id: 'direction', name: 'Direction', desc: 'The way you are facing, and the axis it runs along.',
    def: { on: false, ax: 'l', ay: 't', x: 0.010, y: 0.124 } },
  { id: 'keystrokes', name: 'Keystrokes', desc: 'Your movement keys and mouse buttons, lit as you press them.',
    def: { on: false, ax: 'l', ay: 'b', x: 0.014, y: 0.140 } },
  { id: 'clock', name: 'Real time', desc: 'The clock on your own machine.',
    def: { on: false, ax: 'r', ay: 't', x: 0.010, y: 0.016 } },
  { id: 'gametime', name: 'World time', desc: 'The in-game day and clock.',
    def: { on: false, ax: 'r', ay: 't', x: 0.010, y: 0.052 } },
  { id: 'speed', name: 'Speed', desc: 'How fast you are moving across the ground.',
    def: { on: false, ax: 'r', ay: 't', x: 0.010, y: 0.088 } },
  { id: 'session', name: 'Session', desc: 'Time since this session started.',
    def: { on: false, ax: 'r', ay: 't', x: 0.010, y: 0.124 } },
  { id: 'biome', name: 'Biome', desc: 'The biome you are standing in.',
    def: { on: false, ax: 'r', ay: 't', x: 0.010, y: 0.160 } },
  { id: 'held', name: 'Held item', desc: 'What is in your hand right now.',
    def: { on: false, ax: 'r', ay: 't', x: 0.010, y: 0.196 } },
  { id: 'players', name: 'Players online', desc: 'How many people are on the server with you.',
    def: { on: false, ax: 'r', ay: 't', x: 0.010, y: 0.232 } },
  { id: 'armor', name: 'Armor value', desc: 'Your worn defence points as a number.',
    def: { on: false, ax: 'r', ay: 't', x: 0.010, y: 0.268 } },
  { id: 'health', name: 'Health', desc: 'Your HP as a number, next to the hearts.',
    def: { on: false, ax: 'r', ay: 't', x: 0.010, y: 0.304 } },
];


function defaultConfig(def: ModuleDef): HudModConfig {
  return { ...def.def, scale: 1, bg: true };
}

export function defaultHudLayout(): HudLayout {
  const out = {} as HudLayout;
  for (const def of HUD_MODULES) out[def.id] = defaultConfig(def);
  return out;
}

export function sanitizeHudLayout(raw: unknown): HudLayout {
  const src = raw && typeof raw === 'object' ? raw as Partial<Record<HudModId, unknown>> : {};
  const out = defaultHudLayout();
  for (const def of HUD_MODULES) {
    const v = src[def.id];
    if (!v || typeof v !== 'object') continue;
    const c = v as Partial<HudModConfig>;
    const base = out[def.id];
    // Every field is validated on its own: a blob hand-edited into nonsense
    // should cost that one field, not the whole layout.
    if (typeof c.on === 'boolean') base.on = c.on;
    if (c.ax === 'l' || c.ax === 'r') base.ax = c.ax;
    if (c.ay === 't' || c.ay === 'b') base.ay = c.ay;
    if (typeof c.x === 'number' && Number.isFinite(c.x)) base.x = clamp(c.x, 0, 0.97);
    if (typeof c.y === 'number' && Number.isFinite(c.y)) base.y = clamp(c.y, 0, 0.97);
    if (typeof c.scale === 'number' && Number.isFinite(c.scale)) base.scale = clamp(c.scale, 0.6, 2);
    if (typeof c.bg === 'boolean') base.bg = c.bg;
  }
  return out;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

// --- Live data --------------------------------------------------------------

/** Everything the modules read, pushed once per frame by the game loop. */
export interface HudModData {
  fps: number;
  x: number; y: number; z: number;
  /** "North", "South East" and so on. */
  facing: string;
  /** "+Z", "-X" and so on: the axis that facing runs along. */
  axis: string;
  /** In-game clock, already formatted ("06:14"). */
  time: string;
  /** In-game day number. */
  day: number;
  /** Horizontal speed in blocks per second. */
  speed: number;
  biome: string;
  held: string;
  players: number;
  armor: number;
  health: number;
  maxHealth: number;
}

// --- Panel styling ----------------------------------------------------------

// The modules inherit the HUD theme variables, so a colour picked in HUD
// Settings restyles them along with the hotbar and the chat.
const CSS = `
#hud-mods { position:absolute; inset:0; z-index:11; pointer-events:none;
  overflow:hidden; }
#hud-mods[hidden] { display:none; }
.hm { position:absolute; white-space:nowrap; line-height:1.35;
  font-family:var(--hud-font); font-weight:bold; letter-spacing:.5px;
  color:var(--hud-text); text-shadow:var(--hud-text-shadow);
  font-size:calc(15px * var(--hud-scale)); }
.hm[hidden] { display:none; }
.hm.bg { background:var(--hud-bg); padding:2px 7px; border-radius:3px; }
.hm .hm-k { color:var(--hud-text-dim); font-weight:normal; }

/* Keystrokes: a WASD cluster over the two mouse buttons and a space bar. */
.hm-keys { display:flex; flex-direction:column; align-items:center;
  gap:calc(4px * var(--hud-scale)); }
.hm-keys .row { display:flex; gap:calc(4px * var(--hud-scale)); }
.hm-key { display:flex; flex-direction:column; align-items:center;
  justify-content:center; box-sizing:border-box;
  width:calc(34px * var(--hud-scale)); height:calc(34px * var(--hud-scale));
  border-radius:calc(4px * var(--hud-scale)); background:var(--hud-bg);
  border:1px solid var(--hud-accent-soft);
  font-size:calc(12px * var(--hud-scale)); line-height:1.1;
  transition:background .06s linear, color .06s linear; }
.hm-key.wide { width:calc(110px * var(--hud-scale)); height:calc(20px * var(--hud-scale)); }
.hm-key.mouse { width:calc(53px * var(--hud-scale)); }
.hm-key .cps { font-size:calc(9px * var(--hud-scale)); font-weight:normal;
  color:var(--hud-text-dim); }
.hm-key.down { background:var(--hud-accent); color:#0b0f16; border-color:var(--hud-accent); }
.hm-key.down .cps { color:rgba(11,15,22,.75); }

/* --- Layout editor ------------------------------------------------------- */
#hud-mods.editing { pointer-events:auto; background:rgba(6,9,15,.45);
  backdrop-filter:blur(1.5px); z-index:69; }
#hud-mods.editing .hm { pointer-events:auto; cursor:grab;
  outline:1px dashed rgba(255,255,255,.35); outline-offset:3px; border-radius:3px; }
#hud-mods.editing .hm:hover { outline-color:var(--hud-accent); }
#hud-mods.editing .hm.sel { outline:2px solid var(--hud-accent); outline-offset:3px; }
#hud-mods.editing .hm.dragging { cursor:grabbing; }
/* An off module still shows while editing, dimmed, so it can be found and
   dragged before it is switched on. */
#hud-mods.editing .hm.off { display:block; opacity:.34; }
.hm-tag { position:absolute; left:0; bottom:100%; margin-bottom:5px;
  padding:1px 6px; border-radius:4px; background:var(--hud-accent); color:#08101a;
  font:600 10px/1.6 ui-sans-serif,-apple-system,'Segoe UI',Roboto,system-ui,sans-serif;
  letter-spacing:.4px; text-shadow:none; white-space:nowrap; display:none; }
#hud-mods.editing .hm.sel .hm-tag, #hud-mods.editing .hm:hover .hm-tag { display:block; }

.hm-guide { position:absolute; background:var(--hud-accent); opacity:.85;
  display:none; pointer-events:none; }
.hm-guide.v { top:0; bottom:0; width:1px; }
.hm-guide.h { left:0; right:0; height:1px; }
.hm-guide.on { display:block; }

.hm-bar[hidden] { display:none; }
.hm-bar { position:absolute; left:50%; top:14px; transform:translateX(-50%);
  display:flex; align-items:center; gap:10px; padding:9px 11px;
  border-radius:11px; background:#11141b; border:1px solid #232a37;
  box-shadow:0 18px 44px rgba(0,0,0,.55);
  font:12px/1 ui-sans-serif,-apple-system,'Segoe UI',Roboto,system-ui,sans-serif;
  color:#dde5f2; text-shadow:none; }
.hm-bar b { font-size:12.5px; font-weight:650; }
.hm-bar .sep { width:1px; height:20px; background:#232a37; }
.hm-bar .tip { color:#6d788c; font-size:11px; max-width:290px; }
.hm-btn { height:29px; padding:0 13px; border-radius:7px; border:1px solid #2a3243;
  background:#1a2029; color:#c6d1e2; font:inherit; font-size:12px; font-weight:550;
  cursor:pointer; }
.hm-btn:hover { border-color:#3c4759; color:#eef3fb; }
.hm-btn.primary { border-color:transparent; background:#3b82e8; color:#fff; }
.hm-btn.primary:hover { background:#4f9eff; }

/* Inspector for the selected module. */
.hm-insp { position:absolute; right:16px; top:14px; width:224px; padding:12px 13px;
  border-radius:11px; background:#11141b; border:1px solid #232a37;
  box-shadow:0 18px 44px rgba(0,0,0,.55);
  font:12px/1.45 ui-sans-serif,-apple-system,'Segoe UI',Roboto,system-ui,sans-serif;
  color:#dde5f2; text-shadow:none; display:none; }
.hm-insp.on { display:block; }
.hm-insp h3 { font-size:12.5px; font-weight:650; color:#eef3fb; }
.hm-insp p { margin:3px 0 10px; color:#6d788c; font-size:11px; }
.hm-insp .r { display:flex; align-items:center; justify-content:space-between;
  gap:10px; padding:7px 0; border-top:1px solid #1a202b; }
.hm-insp label { color:#c6d1e2; font-size:11.5px; }
.hm-insp input[type=range] { width:104px; accent-color:#4f9eff; }
.hm-insp .v { min-width:36px; color:#8b95a7; font-size:11px; text-align:right;
  font-variant-numeric:tabular-nums; }
.hm-sw { position:relative; width:38px; height:22px; flex:0 0 auto; border:0; padding:0;
  border-radius:999px; background:#252d3c; cursor:pointer; transition:background .15s; }
.hm-sw::after { content:''; position:absolute; top:3px; left:3px; width:16px; height:16px;
  border-radius:50%; background:#7c8798; transition:transform .15s, background .15s; }
.hm-sw.on { background:rgba(79,158,255,.32); }
.hm-sw.on::after { transform:translateX(16px); background:#4f9eff; }

@media (max-width: 720px) {
  .hm-bar { flex-wrap:wrap; max-width:calc(100vw - 24px); }
  .hm-bar .tip { display:none; }
  .hm-insp { right:12px; top:auto; bottom:14px; width:200px; }
}
`;

// --- The controller ---------------------------------------------------------

export interface HudModsHooks {
  layout: HudLayout;
  /** Live binds, so the keystroke display shows the keys actually bound. */
  binds: Keybinds;
  /** Persist. Called on every drag end and every inspector change. */
  onChange(): void;
  /** The editor closed; the host puts its own menus back. */
  onEditDone(): void;
}

export interface HudMods {
  update(data: HudModData): void;
  /** Show or hide the whole set (the game hides it outside play). */
  setVisible(v: boolean): void;
  /** Enter the drag editor. The caller has already cleared its own overlays. */
  beginEdit(): void;
  endEdit(): void;
  readonly editing: boolean;
  /** Re-read the layout after a change made elsewhere (toggles, Reset all). */
  sync(): void;
  setBinds(binds: Keybinds): void;
}

/** Short face labels for the keystroke display. Long DOM key names would not
 *  fit a 34px cap, so these are deliberately terser than the settings panel's. */
function shortKeyLabel(code: string): string {
  if (!code) return '?';
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code === 'Space') return 'SPACE';
  if (code.startsWith('Shift')) return 'SHIFT';
  if (code.startsWith('Control')) return 'CTRL';
  if (code.startsWith('Alt')) return 'ALT';
  if (code.startsWith('Arrow')) {
    return { Up: '↑', Down: '↓', Left: '←', Right: '→' }[code.slice(5)] ?? code;
  }
  return code.length > 5 ? code.slice(0, 5).toUpperCase() : code.toUpperCase();
}

export function createHudMods(parent: HTMLElement, hooks: HudModsHooks): HudMods {
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);

  let binds = hooks.binds;
  const root = document.createElement('div');
  root.id = 'hud-mods';
  root.hidden = true;
  parent.appendChild(root);

  // --- input tracking, for CPS and the keystroke display --------------------
  // These listen on the window rather than on the canvas so a click that starts
  // on the HUD still counts, and they are capture-phase so nothing that stops
  // propagation mid-game can silently freeze a lit key.
  const down = new Set<string>();
  const leftClicks: number[] = [];
  const rightClicks: number[] = [];
  let leftDown = false;
  let rightDown = false;

  window.addEventListener('keydown', (e) => { down.add(e.code); }, true);
  window.addEventListener('keyup', (e) => { down.delete(e.code); }, true);
  // A tab switch mid-key leaves the key stuck lit, because the keyup lands on
  // another window entirely.
  window.addEventListener('blur', () => {
    down.clear();
    leftDown = rightDown = false;
  });
  window.addEventListener('mousedown', (e) => {
    // Only count clicks aimed at the world. Clicking through a menu is not
    // "clicks per second" in any sense the player means by it.
    if (!document.pointerLockElement) return;
    const now = performance.now();
    if (e.button === 0) { leftDown = true; leftClicks.push(now); }
    if (e.button === 2) { rightDown = true; rightClicks.push(now); }
  }, true);
  window.addEventListener('mouseup', (e) => {
    if (e.button === 0) leftDown = false;
    if (e.button === 2) rightDown = false;
  }, true);

  function cps(times: number[]): number {
    const cut = performance.now() - 1000;
    while (times.length && times[0] < cut) times.shift();
    return times.length;
  }

  /** Is the key bound to `action` held right now? Both sides of a modifier
   *  count, matching how Input resolves a bind. */
  function held(action: BindAction): boolean {
    const code = binds[action];
    if (down.has(code)) return true;
    const pair: Record<string, string> = {
      ShiftLeft: 'ShiftRight', ShiftRight: 'ShiftLeft',
      ControlLeft: 'ControlRight', ControlRight: 'ControlLeft',
      AltLeft: 'AltRight', AltRight: 'AltLeft',
    };
    const other = pair[code];
    return other !== undefined && down.has(other);
  }

  // --- module elements ------------------------------------------------------

  interface Live {
    def: ModuleDef;
    el: HTMLDivElement;
    /** Fills the element for this frame. Text modules return a string; the
     *  keystroke module paints its own children and returns null. */
    draw(d: HudModData): string | null;
  }

  const live = new Map<HudModId, Live>();

  function makeEl(def: ModuleDef): HTMLDivElement {
    const el = document.createElement('div');
    el.className = 'hm';
    el.dataset.mod = def.id;
    const tag = document.createElement('span');
    tag.className = 'hm-tag';
    tag.textContent = def.name;
    el.appendChild(tag);
    root.appendChild(el);
    return el;
  }

  /** A text module writes into this span, leaving the drag tag alone. */
  function textSpan(el: HTMLDivElement): HTMLSpanElement {
    const s = document.createElement('span');
    el.appendChild(s);
    return s;
  }

  for (const def of HUD_MODULES) {
    const el = makeEl(def);
    if (def.id === 'keystrokes') {
      live.set(def.id, { def, el, ...keystrokeModule(el) });
    } else {
      const span = textSpan(el);
      const draw = textModule(def.id);
      live.set(def.id, {
        def, el,
        draw(d) { span.textContent = draw(d); return span.textContent; },
      });
    }
  }

  /** The formatter for each text module. Kept as one lookup so adding a module
   *  is a catalogue entry plus a line here. */
  function textModule(id: HudModId): (d: HudModData) => string {
    switch (id) {
      case 'fps': return (d) => `${d.fps} FPS`;
      case 'cps': return () => `${cps(leftClicks)} | ${cps(rightClicks)} CPS`;
      case 'coords': return (d) =>
        `XYZ ${Math.floor(d.x)} ${Math.floor(d.y)} ${Math.floor(d.z)}`;
      case 'direction': return (d) => `${d.facing} (${d.axis})`;
      case 'clock': return () => {
        const now = new Date();
        return `${String(now.getHours()).padStart(2, '0')}:`
          + `${String(now.getMinutes()).padStart(2, '0')}`;
      };
      case 'gametime': return (d) => `Day ${d.day}  ${d.time}`;
      case 'speed': return (d) => `${d.speed.toFixed(2)} b/s`;
      case 'session': return () => {
        const t = Math.floor((performance.now() - sessionStart) / 1000);
        const h = Math.floor(t / 3600), m = Math.floor(t / 60) % 60, s = t % 60;
        return h > 0
          ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
          : `${m}:${String(s).padStart(2, '0')}`;
      };
      case 'biome': return (d) => d.biome;
      case 'held': return (d) => d.held || 'Empty hand';
      case 'players': return (d) => `${d.players} online`;
      case 'armor': return (d) => `Armor ${Math.round(d.armor)}`;
      case 'health': return (d) => `${Math.ceil(d.health)} / ${Math.round(d.maxHealth)} HP`;
      default: return () => '';
    }
  }

  const sessionStart = performance.now();

  /** The keystroke display: its own little keyboard, repainted per frame. */
  function keystrokeModule(el: HTMLDivElement): { draw(d: HudModData): null } {
    const wrap = document.createElement('div');
    wrap.className = 'hm-keys';
    el.appendChild(wrap);

    interface Key {
      el: HTMLDivElement; face: HTMLSpanElement; cpsEl?: HTMLSpanElement;
      isDown(): boolean; label(): string; cpsOf?: () => number;
      wasDown: boolean; lastLabel: string;
    }
    const keys: Key[] = [];

    function key(
      row: HTMLDivElement, cls: string,
      label: () => string, isDown: () => boolean, withCps?: () => number
    ): void {
      const k = document.createElement('div');
      k.className = `hm-key${cls ? ` ${cls}` : ''}`;
      const face = document.createElement('span');
      k.appendChild(face);
      let cpsEl: HTMLSpanElement | undefined;
      if (withCps) {
        cpsEl = document.createElement('span');
        cpsEl.className = 'cps';
        k.appendChild(cpsEl);
      }
      row.appendChild(k);
      keys.push({
        el: k, face, cpsEl, isDown, label, cpsOf: withCps,
        wasDown: false, lastLabel: '',
      });
    }

    function row(): HTMLDivElement {
      const r = document.createElement('div');
      r.className = 'row';
      wrap.appendChild(r);
      return r;
    }

    const r1 = row();
    key(r1, '', () => shortKeyLabel(binds.forward), () => held('forward'));
    const r2 = row();
    key(r2, '', () => shortKeyLabel(binds.left), () => held('left'));
    key(r2, '', () => shortKeyLabel(binds.back), () => held('back'));
    key(r2, '', () => shortKeyLabel(binds.right), () => held('right'));
    const r3 = row();
    key(r3, 'mouse', () => 'LMB', () => leftDown, () => cps(leftClicks));
    key(r3, 'mouse', () => 'RMB', () => rightDown, () => cps(rightClicks));
    const r4 = row();
    key(r4, 'wide', () => shortKeyLabel(binds.jump), () => held('jump'));

    return {
      draw(): null {
        for (const k of keys) {
          const isDown = k.isDown();
          if (isDown !== k.wasDown) {
            k.wasDown = isDown;
            k.el.classList.toggle('down', isDown);
          }
          const label = k.label();
          if (label !== k.lastLabel) {
            k.lastLabel = label;
            k.face.textContent = label;
          }
          if (k.cpsEl && k.cpsOf) {
            const v = String(k.cpsOf());
            if (k.cpsEl.textContent !== v) k.cpsEl.textContent = v;
          }
        }
        return null;
      },
    };
  }

  // --- placement ------------------------------------------------------------

  /** Push one module's stored config onto its element. Anchoring to a corner
   *  is what keeps a layout stable across resizes, so both offsets are written
   *  as percentages and the transform origin is pinned to the same corner: a
   *  scaled module then grows into the screen, never off it. */
  function place(id: HudModId): void {
    const m = live.get(id)!;
    const c = hooks.layout[id];
    const s = m.el.style;
    if (c.ax === 'l') { s.left = `${c.x * 100}%`; s.right = 'auto'; }
    else { s.right = `${c.x * 100}%`; s.left = 'auto'; }
    if (c.ay === 't') { s.top = `${c.y * 100}%`; s.bottom = 'auto'; }
    else { s.bottom = `${c.y * 100}%`; s.top = 'auto'; }
    s.transformOrigin = `${c.ax === 'l' ? 'left' : 'right'} ${c.ay === 't' ? 'top' : 'bottom'}`;
    s.transform = c.scale === 1 ? '' : `scale(${c.scale})`;
    m.el.classList.toggle('bg', c.bg && id !== 'keystrokes');
    m.el.classList.toggle('off', !c.on);
    m.el.hidden = !c.on && !editing;
  }

  function sync(): void {
    for (const def of HUD_MODULES) place(def.id);
  }

  // --- the drag editor ------------------------------------------------------

  let editing = false;
  let selected: HudModId | null = null;

  const guideV = document.createElement('div');
  guideV.className = 'hm-guide v';
  const guideH = document.createElement('div');
  guideH.className = 'hm-guide h';
  root.append(guideV, guideH);

  const bar = document.createElement('div');
  bar.className = 'hm-bar';
  bar.hidden = true;
  const barTitle = document.createElement('b');
  barTitle.textContent = 'Editing HUD layout';
  const barTip = document.createElement('span');
  barTip.className = 'tip';
  barTip.textContent = 'Drag anything to move it. Arrow keys nudge the selection. '
    + 'Modules snap to the edges and the middle.';
  const sep = document.createElement('span');
  sep.className = 'sep';
  const resetBtn = document.createElement('button');
  resetBtn.className = 'hm-btn';
  resetBtn.type = 'button';
  resetBtn.textContent = 'Reset positions';
  const doneBtn = document.createElement('button');
  doneBtn.className = 'hm-btn primary';
  doneBtn.type = 'button';
  doneBtn.textContent = 'Done';
  bar.append(barTitle, sep, barTip, resetBtn, doneBtn);
  root.appendChild(bar);

  resetBtn.addEventListener('click', () => {
    for (const def of HUD_MODULES) {
      const c = hooks.layout[def.id];
      // Positions and size only: a module the player switched off stays off.
      const d = defaultConfig(def);
      c.ax = d.ax; c.ay = d.ay; c.x = d.x; c.y = d.y; c.scale = 1;
    }
    sync();
    hooks.onChange();
  });
  doneBtn.addEventListener('click', () => endEdit());

  // Inspector
  const insp = document.createElement('div');
  insp.className = 'hm-insp';
  const inspName = document.createElement('h3');
  const inspDesc = document.createElement('p');
  insp.append(inspName, inspDesc);

  function inspRow(label: string): HTMLDivElement {
    const r = document.createElement('div');
    r.className = 'r';
    const l = document.createElement('label');
    l.textContent = label;
    r.appendChild(l);
    insp.appendChild(r);
    return r;
  }

  const onRow = inspRow('Shown while playing');
  const onSw = document.createElement('button');
  onSw.className = 'hm-sw';
  onSw.type = 'button';
  onSw.setAttribute('role', 'switch');
  onRow.appendChild(onSw);

  const bgRow = inspRow('Background');
  const bgSw = document.createElement('button');
  bgSw.className = 'hm-sw';
  bgSw.type = 'button';
  bgSw.setAttribute('role', 'switch');
  bgRow.appendChild(bgSw);

  const scaleRow = inspRow('Size');
  const scaleIn = document.createElement('input');
  scaleIn.type = 'range';
  scaleIn.min = '0.6'; scaleIn.max = '2'; scaleIn.step = '0.05';
  const scaleVal = document.createElement('span');
  scaleVal.className = 'v';
  scaleRow.append(scaleIn, scaleVal);
  root.appendChild(insp);

  onSw.addEventListener('click', () => {
    if (!selected) return;
    hooks.layout[selected].on = !hooks.layout[selected].on;
    place(selected);
    syncInspector();
    hooks.onChange();
  });
  bgSw.addEventListener('click', () => {
    if (!selected) return;
    hooks.layout[selected].bg = !hooks.layout[selected].bg;
    place(selected);
    syncInspector();
    hooks.onChange();
  });
  scaleIn.addEventListener('input', () => {
    if (!selected) return;
    hooks.layout[selected].scale = Number(scaleIn.value);
    place(selected);
    scaleVal.textContent = `${Math.round(hooks.layout[selected].scale * 100)}%`;
    hooks.onChange();
  });

  function syncInspector(): void {
    insp.classList.toggle('on', editing && selected !== null);
    if (!selected) return;
    const def = HUD_MODULES.find((m) => m.id === selected)!;
    const c = hooks.layout[selected];
    inspName.textContent = def.name;
    inspDesc.textContent = def.desc;
    onSw.classList.toggle('on', c.on);
    onSw.setAttribute('aria-checked', String(c.on));
    bgSw.classList.toggle('on', c.bg);
    bgSw.setAttribute('aria-checked', String(c.bg));
    // The keystroke display carries its own key backgrounds, so the shared
    // panel switch would do nothing on it.
    bgRow.style.display = selected === 'keystrokes' ? 'none' : '';
    scaleIn.value = String(c.scale);
    scaleVal.textContent = `${Math.round(c.scale * 100)}%`;
  }

  function selectMod(id: HudModId | null): void {
    selected = id;
    for (const [mid, m] of live) m.el.classList.toggle('sel', mid === id);
    syncInspector();
  }

  const SNAP = 7; // px

  /** Convert a pixel box back into an anchored config. The nearer half of the
   *  screen on each axis wins the anchor, so a module dropped bottom-right
   *  stays welded to the bottom-right corner. */
  function commit(id: HudModId, left: number, top: number, w: number, h: number): void {
    const vw = Math.max(1, root.clientWidth);
    const vh = Math.max(1, root.clientHeight);
    const c = hooks.layout[id];
    const cx = left + w / 2;
    const cy = top + h / 2;
    if (cx < vw / 2) { c.ax = 'l'; c.x = left / vw; }
    else { c.ax = 'r'; c.x = (vw - (left + w)) / vw; }
    if (cy < vh / 2) { c.ay = 't'; c.y = top / vh; }
    else { c.ay = 'b'; c.y = (vh - (top + h)) / vh; }
    c.x = clamp(c.x, 0, 0.97);
    c.y = clamp(c.y, 0, 0.97);
  }

  let drag: {
    id: HudModId; dx: number; dy: number; w: number; h: number; pointer: number;
  } | null = null;

  root.addEventListener('pointerdown', (e) => {
    if (!editing) return;
    const target = (e.target as HTMLElement).closest('.hm') as HTMLElement | null;
    if (!target) {
      // A click on empty space clears the selection, the way a canvas editor does.
      if (!(e.target as HTMLElement).closest('.hm-bar, .hm-insp')) selectMod(null);
      return;
    }
    const id = target.dataset.mod as HudModId;
    const box = target.getBoundingClientRect();
    const rootBox = root.getBoundingClientRect();
    drag = {
      id,
      dx: e.clientX - box.left,
      dy: e.clientY - box.top,
      w: box.width,
      h: box.height,
      pointer: e.pointerId,
    };
    // Pin to absolute pixels for the duration of the drag: mixing a right/bottom
    // anchor with a live pointer position makes the maths fight itself.
    const s = target.style;
    s.left = `${box.left - rootBox.left}px`;
    s.top = `${box.top - rootBox.top}px`;
    s.right = 'auto';
    s.bottom = 'auto';
    s.transformOrigin = 'left top';
    target.classList.add('dragging');
    target.setPointerCapture(e.pointerId);
    selectMod(id);
    e.preventDefault();
  });

  root.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const m = live.get(drag.id)!;
    const rootBox = root.getBoundingClientRect();
    const vw = root.clientWidth, vh = root.clientHeight;
    let left = e.clientX - rootBox.left - drag.dx;
    let top = e.clientY - rootBox.top - drag.dy;
    left = clamp(left, 0, Math.max(0, vw - drag.w));
    top = clamp(top, 0, Math.max(0, vh - drag.h));

    // Snapping: the two screen centres and an 8px margin off each edge. Held
    // Alt drops the snapping for the one drag where it is in the way.
    let snapV = -1, snapH = -1;
    if (!e.altKey) {
      const centreX = (vw - drag.w) / 2;
      const centreY = (vh - drag.h) / 2;
      const xs: [number, number][] = [[8, 8], [vw - drag.w - 8, vw - 8], [centreX, vw / 2]];
      for (const [target, line] of xs) {
        if (Math.abs(left - target) <= SNAP) { left = target; snapV = line; break; }
      }
      const ys: [number, number][] = [[8, 8], [vh - drag.h - 8, vh - 8], [centreY, vh / 2]];
      for (const [target, line] of ys) {
        if (Math.abs(top - target) <= SNAP) { top = target; snapH = line; break; }
      }
    }
    guideV.classList.toggle('on', snapV >= 0);
    if (snapV >= 0) guideV.style.left = `${snapV}px`;
    guideH.classList.toggle('on', snapH >= 0);
    if (snapH >= 0) guideH.style.top = `${snapH}px`;

    m.el.style.left = `${left}px`;
    m.el.style.top = `${top}px`;
  });

  function endDrag(): void {
    if (!drag) return;
    const m = live.get(drag.id)!;
    const box = m.el.getBoundingClientRect();
    const rootBox = root.getBoundingClientRect();
    commit(drag.id, box.left - rootBox.left, box.top - rootBox.top, box.width, box.height);
    m.el.classList.remove('dragging');
    guideV.classList.remove('on');
    guideH.classList.remove('on');
    place(drag.id);
    drag = null;
    hooks.onChange();
  }
  root.addEventListener('pointerup', endDrag);
  root.addEventListener('pointercancel', endDrag);

  // Arrow keys nudge the selected module one pixel at a time, ten with Shift.
  // Captured, because the game is still listening for movement keys behind the
  // editor and W/A/S/D would otherwise walk the player around while editing.
  window.addEventListener('keydown', (e) => {
    if (!editing) return;
    e.stopPropagation();
    if (e.key === 'Escape') { e.preventDefault(); endEdit(); return; }
    if (!selected) return;
    const step = e.shiftKey ? 10 : 1;
    let dx = 0, dy = 0;
    if (e.key === 'ArrowLeft') dx = -step;
    else if (e.key === 'ArrowRight') dx = step;
    else if (e.key === 'ArrowUp') dy = -step;
    else if (e.key === 'ArrowDown') dy = step;
    else return;
    e.preventDefault();
    const m = live.get(selected)!;
    const box = m.el.getBoundingClientRect();
    const rootBox = root.getBoundingClientRect();
    commit(selected,
      box.left - rootBox.left + dx, box.top - rootBox.top + dy, box.width, box.height);
    place(selected);
    hooks.onChange();
  }, true);

  function beginEdit(): void {
    editing = true;
    root.hidden = false;
    root.classList.add('editing');
    bar.hidden = false;
    sync();
    selectMod(null);
  }

  function endEdit(): void {
    if (!editing) return;
    editing = false;
    root.classList.remove('editing');
    bar.hidden = true;
    selectMod(null);
    sync();
    hooks.onChange();
    hooks.onEditDone();
  }

  window.addEventListener('resize', () => sync());

  sync();

  return {
    update(data: HudModData): void {
      if (root.hidden) return;
      for (const def of HUD_MODULES) {
        const c = hooks.layout[def.id];
        if (!c.on && !editing) continue;
        live.get(def.id)!.draw(data);
      }
    },
    setVisible(v: boolean): void {
      // The editor owns visibility while it is open: pausing to open it must
      // not hide the very thing being arranged.
      if (editing) return;
      root.hidden = !v;
    },
    beginEdit,
    endEdit,
    get editing(): boolean { return editing; },
    sync,
    setBinds(b: Keybinds): void { binds = b; },
  };
}
