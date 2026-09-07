// HUD SETTINGS. One panel that owns two things the rest of the game reads but
// never edits: how the in-game HUD LOOKS (font, text colour, background, scale)
// and which keys drive it.
//
// The look is published as CSS custom properties on <html>, so every HUD
// surface - hotbar, item name, ammo, F3 overlay, the command box - picks up a
// change on the same frame and they all stay in step. That is the point of the
// panel: one font and one palette across the whole HUD rather than each widget
// carrying its own hard-coded colour.
//
// The chrome is deliberately modelled on Lunar Client's mod menu: a dark card,
// a category rail down the left, one row per setting with the control pinned
// right, and a live preview of the HUD sitting above the controls.

import { setIconText } from './emoji_icons';
import { HUD_MODULES, defaultHudLayout, sanitizeHudLayout } from './hud_mods';
import type { HudLayout, HudModId } from './hud_mods';

// --- Keybinds ---------------------------------------------------------------

/** Every action the player can rebind. Hotbar digits and F3/F4 stay fixed:
 *  they are positional (1-9) or developer keys, not preferences. */
export type BindAction =
  | 'forward' | 'back' | 'left' | 'right'
  | 'jump' | 'sneak' | 'sprint'
  | 'inventory' | 'drop' | 'reload'
  | 'chat' | 'dismount' | 'view' | 'zoom';

export type Keybinds = Record<BindAction, string>;

export const DEFAULT_KEYBINDS: Keybinds = {
  forward: 'KeyW', back: 'KeyS', left: 'KeyA', right: 'KeyD',
  jump: 'Space', sneak: 'ShiftLeft', sprint: 'KeyQ',
  inventory: 'KeyE', drop: 'KeyO', reload: 'KeyR',
  chat: 'KeyT', dismount: 'KeyF', view: 'KeyV', zoom: 'KeyC',
};

/** Display order and prose for the keybind list, grouped the way the Controls
 *  sheet groups them so the two screens agree. */
const BIND_GROUPS: { title: string; binds: [BindAction, string, string?][] }[] = [
  { title: 'Movement', binds: [
    ['forward', 'Walk forward'], ['back', 'Walk back'],
    ['left', 'Strafe left'], ['right', 'Strafe right'],
    ['jump', 'Jump', 'also deploys the glider in mid-air'],
    ['sneak', 'Sneak'],
    ['sprint', 'Sprint', 'double-tapping forward still works'],
  ] },
  { title: 'Items', binds: [
    ['inventory', 'Open inventory'], ['drop', 'Drop item', 'hold Shift to drop the stack'],
    ['reload', 'Reload gun'],
  ] },
  { title: 'World', binds: [
    ['chat', 'Command box'], ['dismount', 'Leave vehicle seat'],
    ['view', 'Camera view'],
    ['zoom', 'Zoom (hold)', 'scroll while holding to change the magnification'],
  ] },
];

const BIND_ACTIONS = Object.keys(DEFAULT_KEYBINDS) as BindAction[];

export function sanitizeKeybinds(raw: unknown): Keybinds {
  const x = raw && typeof raw === 'object' ? raw as Partial<Keybinds> : {};
  const out = { ...DEFAULT_KEYBINDS };
  for (const action of BIND_ACTIONS) {
    const code = x[action];
    // A stored bind is only ever a KeyboardEvent.code, and a short one: reject
    // anything else rather than letting a hand-edited blob reach the listener.
    if (typeof code === 'string' && code.length > 0 && code.length <= 24
      && /^[A-Za-z0-9]+$/.test(code)) out[action] = code;
  }
  return out;
}

/** "KeyW" -> "W", "ShiftLeft" -> "L Shift" - what the player actually sees on
 *  the key, not the DOM's spelling of it. */
export function keyLabel(code: string): string {
  if (!code) return 'None';
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return `Num ${code.slice(6)}`;
  if (code.startsWith('Arrow')) {
    return { Up: '↑', Down: '↓', Left: '←', Right: '→' }[code.slice(5)] ?? code;
  }
  const named: Record<string, string> = {
    Space: 'Space', Enter: 'Enter', Tab: 'Tab', Backspace: 'Backspace',
    CapsLock: 'Caps', Escape: 'Esc', Backquote: '`', Minus: '-', Equal: '=',
    BracketLeft: '[', BracketRight: ']', Backslash: '\\', Semicolon: ';',
    Quote: "'", Comma: ',', Period: '.', Slash: '/',
    ShiftLeft: 'L Shift', ShiftRight: 'R Shift',
    ControlLeft: 'L Ctrl', ControlRight: 'R Ctrl',
    AltLeft: 'L Alt', AltRight: 'R Alt',
  };
  return named[code] ?? code;
}

// --- Look -------------------------------------------------------------------

/** The font stacks on offer. All of them ship with the OS - the game loads no
 *  webfonts, and a HUD that waits on a network font would flash unstyled over
 *  the world every time it opened. */
export const HUD_FONTS: { id: string; name: string; stack: string }[] = [
  { id: 'console', name: 'Console (default)', stack: "'Lucida Console', Monaco, monospace" },
  { id: 'system', name: 'System Sans', stack: "ui-sans-serif, -apple-system, 'Segoe UI', Roboto, system-ui, sans-serif" },
  { id: 'mono', name: 'Typewriter', stack: "'Courier New', Courier, monospace" },
  { id: 'trebuchet', name: 'Trebuchet', stack: "'Trebuchet MS', 'Segoe UI', sans-serif" },
  { id: 'verdana', name: 'Verdana', stack: 'Verdana, Geneva, sans-serif' },
  { id: 'tahoma', name: 'Tahoma', stack: "Tahoma, 'DejaVu Sans', sans-serif" },
  { id: 'georgia', name: 'Georgia', stack: "Georgia, 'Times New Roman', serif" },
  { id: 'impact', name: 'Impact', stack: "Impact, 'Arial Black', sans-serif" },
];

export interface HudTheme {
  /** Id from HUD_FONTS. */
  font: string;
  /** Multiplier on HUD text size, 0.8..1.4. */
  scale: number;
  /** #rrggbb. */
  textColor: string;
  /** #rrggbb - the panel/backdrop colour behind HUD text. */
  bgColor: string;
  /** 0..1 alpha applied to bgColor. */
  bgOpacity: number;
  /** #rrggbb - selection outline, chat rule, hotbar edge. */
  accentColor: string;
  /** Drop shadow under HUD text (off reads cleaner on a bright HUD). */
  textShadow: boolean;
}

export const DEFAULT_HUD_THEME: HudTheme = {
  font: 'console',
  scale: 1,
  textColor: '#ffffff',
  bgColor: '#000000',
  bgOpacity: 0.55,
  accentColor: '#4db8ff',
  textShadow: true,
};

/** Ready-made palettes, so a player who wants a different HUD but no fiddling
 *  gets one in a click. */
const PRESETS: { name: string; theme: Partial<HudTheme> }[] = [
  { name: 'Classic', theme: { textColor: '#ffffff', bgColor: '#000000', bgOpacity: 0.55, accentColor: '#4db8ff' } },
  { name: 'Midnight', theme: { textColor: '#e8eeff', bgColor: '#080a10', bgOpacity: 0.78, accentColor: '#7c8cff' } },
  { name: 'Mint', theme: { textColor: '#eafff4', bgColor: '#04150f', bgOpacity: 0.66, accentColor: '#3ddc97' } },
  { name: 'Ember', theme: { textColor: '#fff1e2', bgColor: '#1a0a04', bgOpacity: 0.66, accentColor: '#ff8a3d' } },
  { name: 'Rose', theme: { textColor: '#ffeaf3', bgColor: '#170610', bgOpacity: 0.66, accentColor: '#ff6fa5' } },
  { name: 'Paper', theme: { textColor: '#12171f', bgColor: '#e9eef4', bgOpacity: 0.82, accentColor: '#b87709' } },
];

const HEX = /^#[0-9a-fA-F]{6}$/;

export function sanitizeHudTheme(raw: unknown): HudTheme {
  const x = raw && typeof raw === 'object' ? raw as Partial<HudTheme> : {};
  const hex = (v: unknown, d: string): string =>
    typeof v === 'string' && HEX.test(v) ? v.toLowerCase() : d;
  const num = (v: unknown, lo: number, hi: number, d: number): number =>
    typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d;
  return {
    font: HUD_FONTS.some((f) => f.id === x.font) ? x.font as string : DEFAULT_HUD_THEME.font,
    scale: num(x.scale, 0.8, 1.4, DEFAULT_HUD_THEME.scale),
    textColor: hex(x.textColor, DEFAULT_HUD_THEME.textColor),
    bgColor: hex(x.bgColor, DEFAULT_HUD_THEME.bgColor),
    bgOpacity: num(x.bgOpacity, 0, 1, DEFAULT_HUD_THEME.bgOpacity),
    accentColor: hex(x.accentColor, DEFAULT_HUD_THEME.accentColor),
    textShadow: x.textShadow !== false,
  };
}

export interface HudSettings {
  theme: HudTheme;
  binds: Keybinds;
  /** Where the always-on HUD modules sit, and which of them are on. Owned by
   *  hud_mods.ts; stored here so the whole HUD is one blob in one key. */
  layout: HudLayout;
}

const STORAGE_KEY = 'voxelon.hud';

export function loadHudSettings(): HudSettings {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as
      { theme?: unknown; binds?: unknown; layout?: unknown } | null;
    return {
      theme: sanitizeHudTheme(raw?.theme),
      binds: sanitizeKeybinds(raw?.binds),
      layout: sanitizeHudLayout(raw?.layout),
    };
  } catch {
    return {
      theme: { ...DEFAULT_HUD_THEME },
      binds: { ...DEFAULT_KEYBINDS },
      layout: defaultHudLayout(),
    };
  }
}

export function saveHudSettings(s: HudSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      theme: sanitizeHudTheme(s.theme),
      binds: sanitizeKeybinds(s.binds),
      layout: sanitizeHudLayout(s.layout),
    }));
  } catch { /* storage is optional */ }
}

function rgba(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/** Relative luminance, 0 (black) .. 1 (white). */
function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const lin = (c: number): number => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
}

/** Publish the theme as CSS variables. Everything that draws HUD text reads
 *  these, so one write restyles the whole HUD at once. */
export function applyHudTheme(theme: HudTheme): void {
  const root = document.documentElement.style;
  const stack = HUD_FONTS.find((f) => f.id === theme.font)?.stack ?? HUD_FONTS[0].stack;
  root.setProperty('--hud-font', stack);
  root.setProperty('--hud-scale', String(theme.scale));
  root.setProperty('--hud-text', theme.textColor);
  root.setProperty('--hud-text-dim', rgba(theme.textColor, 0.62));
  root.setProperty('--hud-bg', rgba(theme.bgColor, theme.bgOpacity));
  // The command box and its suggestion list sit ON the backdrop rather than
  // floating over the world, so they take a firmer fill than the loose HUD one.
  root.setProperty('--hud-bg-solid', rgba(theme.bgColor, Math.min(1, theme.bgOpacity * 0.5 + 0.5)));
  root.setProperty('--hud-accent', theme.accentColor);
  root.setProperty('--hud-accent-soft', rgba(theme.accentColor, 0.4));
  // A light HUD text colour needs a dark shadow to sit on the sky and a dark
  // one needs a light halo, or the "legibility" shadow erases the text.
  const halo = luminance(theme.textColor) > 0.55 ? '0, 0, 0' : '255, 255, 255';
  root.setProperty('--hud-text-shadow',
    theme.textShadow ? `0 1px 2px rgba(${halo}, 0.55)` : 'none');
}

// --- The panel --------------------------------------------------------------

const CSS = `
#hud-settings { position:absolute; inset:0; z-index:70; display:none;
  align-items:center; justify-content:center; padding:24px;
  background:rgba(4,6,11,.74); backdrop-filter:blur(9px);
  font-family:ui-sans-serif,-apple-system,'Segoe UI',Roboto,system-ui,sans-serif;
  -webkit-font-smoothing:antialiased; }
#hud-settings.open { display:flex; }
#hud-settings * { text-shadow:none; box-sizing:border-box; }
.hs-card { display:flex; flex-direction:column; width:min(880px,100%);
  height:min(640px,calc(100vh - 48px)); background:#11141b;
  border:1px solid #232a37; border-radius:12px; overflow:hidden;
  box-shadow:0 34px 90px rgba(0,0,0,.66); }
.hs-head { display:flex; align-items:center; gap:12px; flex:0 0 auto;
  padding:0 16px; height:56px; border-bottom:1px solid #1d2431; background:#141821; }
.hs-mark { width:8px; height:8px; border-radius:2px; background:#4f9eff;
  box-shadow:0 0 12px rgba(79,158,255,.85); }
.hs-head h2 { color:#eef3fb; font-size:15px; font-weight:650; letter-spacing:.3px; }
.hs-kicker { color:#6d788c; font-size:11px; letter-spacing:.4px; }
.hs-x { margin-left:auto; width:30px; height:30px; border:0; border-radius:7px;
  background:transparent; color:#8b95a7; font-size:17px; line-height:1; cursor:pointer; }
.hs-x:hover { background:#1e2635; color:#eef3fb; }
.hs-body { display:flex; flex:1 1 auto; min-height:0; }
.hs-rail { flex:0 0 190px; display:flex; flex-direction:column; gap:2px;
  padding:12px 10px; border-right:1px solid #1d2431; background:#0e1118; }
.hs-tab { position:relative; display:flex; align-items:center; gap:9px;
  padding:9px 11px; border:0; border-radius:7px; background:transparent;
  color:#8b95a7; font:inherit; font-size:12.5px; font-weight:550; text-align:left;
  cursor:pointer; transition:background .12s,color .12s; }
.hs-tab:hover { background:#161c27; color:#cfd8e6; }
.hs-tab.sel { background:rgba(79,158,255,.13); color:#eaf1ff; }
.hs-tab.sel::before { content:''; position:absolute; left:0; top:8px; bottom:8px;
  width:3px; border-radius:2px; background:#4f9eff; }
.hs-tab i { width:15px; font-style:normal; text-align:center; opacity:.85; }
.hs-rail-note { margin-top:auto; padding:9px 11px; color:#5b6579; font-size:10.5px;
  line-height:1.5; }
.hs-pane { flex:1 1 auto; min-width:0; overflow-y:auto; padding:18px 20px 22px; }
.hs-pane::-webkit-scrollbar { width:9px; }
.hs-pane::-webkit-scrollbar-thumb { background:#242c3a; border-radius:5px; }
.hs-pane[hidden] { display:none; }
.hs-group { color:#6d788c; font-size:10px; font-weight:700; letter-spacing:1.7px;
  text-transform:uppercase; margin:22px 0 2px; }
.hs-group:first-child { margin-top:0; }
.hs-row { display:flex; align-items:center; justify-content:space-between; gap:22px;
  padding:12px 2px; border-bottom:1px solid #1a202b; }
.hs-row:last-child { border-bottom:0; }
.hs-label { min-width:0; }
.hs-label b { display:block; color:#dde5f2; font-size:12.5px; font-weight:550; }
.hs-label span { display:block; margin-top:3px; color:#6d788c; font-size:11px; line-height:1.45; }
.hs-ctl { flex:0 0 auto; display:flex; align-items:center; gap:9px; }
.hs-ctl select { min-width:172px; height:30px; padding:0 8px; border-radius:7px;
  border:1px solid #2a3243; background:#181e29; color:#dde5f2; font:inherit; font-size:12px;
  cursor:pointer; }
.hs-ctl select:focus-visible, .hs-key:focus-visible, .hs-x:focus-visible,
.hs-tab:focus-visible, .hs-btn:focus-visible { outline:2px solid #4f9eff; outline-offset:2px; }
.hs-ctl input[type=range] { width:150px; accent-color:#4f9eff; }
.hs-val { min-width:44px; color:#8b95a7; font-size:11.5px; text-align:right;
  font-variant-numeric:tabular-nums; }
.hs-swatch { position:relative; width:44px; height:30px; border-radius:7px;
  border:1px solid #2a3243; overflow:hidden; cursor:pointer;
  background-image:linear-gradient(45deg,#22283400 25%,#1a1f2a 0 50%,#22283400 0 75%,#1a1f2a 0);
  background-size:10px 10px; }
.hs-swatch input { position:absolute; inset:-6px; width:calc(100% + 12px);
  height:calc(100% + 12px); border:0; padding:0; background:transparent; cursor:pointer; }
.hs-hex { width:88px; height:30px; padding:0 8px; border-radius:7px; border:1px solid #2a3243;
  background:#181e29; color:#dde5f2; font-family:'Lucida Console',Monaco,monospace;
  font-size:11.5px; text-transform:lowercase; }
.hs-hex.bad { border-color:#d4574e; }
.hs-switch { position:relative; width:40px; height:23px; flex:0 0 auto; border:0; padding:0;
  border-radius:999px; background:#252d3c; cursor:pointer; transition:background .15s; }
.hs-switch::after { content:''; position:absolute; top:3px; left:3px; width:17px; height:17px;
  border-radius:50%; background:#7c8798; transition:transform .15s,background .15s; }
.hs-switch.on { background:rgba(79,158,255,.32); }
.hs-switch.on::after { transform:translateX(17px); background:#4f9eff; }
.hs-key { min-width:112px; height:30px; padding:0 10px; border-radius:7px;
  border:1px solid #2a3243; background:#181e29; color:#dde5f2;
  font-family:'Lucida Console',Monaco,monospace; font-size:11.5px; cursor:pointer;
  transition:border-color .12s,background .12s,color .12s; }
.hs-key:hover { border-color:#3c4759; background:#1d2431; }
.hs-key.listening { border-color:#4f9eff; background:rgba(79,158,255,.15); color:#9fc9ff; }
.hs-key.clash { border-color:#d4574e; color:#ff9a91; }
.hs-clash-note { margin:12px 0 0; color:#ff9a91; font-size:11px; }
.hs-clash-note[hidden] { display:none; }
.hs-presets { display:flex; flex-wrap:wrap; gap:8px; padding:2px 0 4px; }
.hs-preset { display:flex; align-items:center; gap:7px; padding:6px 11px 6px 7px;
  border:1px solid #2a3243; border-radius:8px; background:#161c27; color:#c6d1e2;
  font:inherit; font-size:11.5px; cursor:pointer; }
.hs-preset:hover { border-color:#3c4759; color:#eef3fb; }
.hs-preset i { width:14px; height:14px; border-radius:4px; border:1px solid rgba(255,255,255,.16); }
.hs-foot { flex:0 0 auto; display:flex; align-items:center; gap:10px;
  padding:12px 16px; border-top:1px solid #1d2431; background:#141821; }
.hs-foot .hs-hint { color:#5b6579; font-size:11px; margin-right:auto; }
.hs-btn { height:33px; padding:0 16px; border-radius:8px; border:1px solid #2a3243;
  background:#1a2029; color:#c6d1e2; font:inherit; font-size:12px; font-weight:550; cursor:pointer; }
.hs-btn:hover { border-color:#3c4759; color:#eef3fb; }
.hs-btn.primary { border-color:transparent; background:#3b82e8; color:#fff; }
.hs-btn.primary:hover { background:#4f9eff; }

/* HUD Layout: the call to action that hands the screen to the drag editor. */
.hs-dragcard { display:flex; align-items:center; gap:16px; padding:14px 15px;
  margin-bottom:4px; border:1px solid #2a3243; border-radius:10px;
  background:linear-gradient(135deg,#161d2a,#131721); }
.hs-dragcard > div { min-width:0; }
.hs-dragcard b { display:block; color:#eef3fb; font-size:12.5px; font-weight:600; }
.hs-dragcard span { display:block; margin-top:4px; color:#8b95a7; font-size:11px;
  line-height:1.5; }
.hs-dragcard .hs-btn { flex:0 0 auto; }
.hs-ctl input[type=range].hs-modsize { width:104px; }

/* Live preview: the real HUD variables, at HUD scale, on a stand-in sky. */
.hs-preview { position:relative; border:1px solid #232a37; border-radius:10px;
  padding:14px; margin-bottom:4px; overflow:hidden;
  background:linear-gradient(180deg,#5b86c4,#87a9d8 46%,#4e6a4a); }
.hs-preview .hs-pv-stack { display:flex; flex-direction:column; align-items:flex-start; gap:6px;
  font-family:var(--hud-font); color:var(--hud-text);
  text-shadow:var(--hud-text-shadow); font-weight:bold; letter-spacing:.5px; }
.hs-pv-line { background:var(--hud-bg); border-left:3px solid var(--hud-accent);
  padding:2px 8px; font-size:calc(12px * var(--hud-scale)); }
.hs-pv-debug { background:var(--hud-bg); padding:0 4px;
  font-size:calc(13px * var(--hud-scale)); }
.hs-pv-bar { display:flex; align-self:center; margin-top:2px; background:var(--hud-bg);
  border:2px solid rgba(0,0,0,.75); outline:2px solid var(--hud-accent-soft); }
.hs-pv-bar span { position:relative; width:30px; height:30px; border:2px solid #8b8b8b;
  border-right-color:#555; border-bottom-color:#555; }
.hs-pv-bar span.sel { outline:3px solid var(--hud-accent); outline-offset:-1px; z-index:1; }
.hs-pv-name { align-self:center; font-size:calc(13px * var(--hud-scale)); }

@media (max-width: 720px) {
  #hud-settings { padding:12px; }
  .hs-card { height:min(640px,calc(100vh - 24px)); }
  .hs-body { flex-direction:column; }
  .hs-rail { flex:0 0 auto; flex-direction:row; overflow-x:auto; gap:6px;
    border-right:0; border-bottom:1px solid #1d2431; padding:9px 10px; }
  .hs-rail-note { display:none; }
  .hs-tab { white-space:nowrap; }
  .hs-tab.sel::before { top:auto; bottom:0; left:8px; right:8px; width:auto; height:2px; }
  .hs-row { flex-direction:column; align-items:stretch; gap:9px; }
  .hs-ctl { justify-content:flex-end; }
  .hs-pane { padding:14px; }
}
`;

export interface HudSettingsPanel {
  readonly open: boolean;
  show(): void;
  hide(): void;
}

export interface HudSettingsHooks {
  /** Live settings object; the panel mutates it in place. */
  settings: HudSettings;
  /** Called after any change, so the host can persist and re-push the binds. */
  onChange(): void;
  /** Called when the panel closes (the host goes back to the pause menu). */
  onClose(): void;
  /** The player asked to rearrange the on-screen modules by hand. The host
   *  clears this panel and the pause menu off the screen and hands control to
   *  the drag editor, which lives with the modules themselves. */
  onEditLayout(): void;
  /** Touch devices have no keys to bind; the tab is replaced with a note. */
  touch?: boolean;
}

export function createHudSettingsPanel(
  parent: HTMLElement, hooks: HudSettingsHooks
): HudSettingsPanel {
  const { settings } = hooks;

  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);

  const scrim = document.createElement('div');
  scrim.id = 'hud-settings';
  scrim.setAttribute('role', 'dialog');
  scrim.setAttribute('aria-modal', 'true');
  scrim.setAttribute('aria-label', 'HUD settings');

  const card = document.createElement('div');
  card.className = 'hs-card';

  // --- header
  const head = document.createElement('div');
  head.className = 'hs-head';
  const mark = document.createElement('span');
  mark.className = 'hs-mark';
  const heading = document.createElement('div');
  const h2 = document.createElement('h2');
  h2.textContent = 'HUD Settings';
  const kicker = document.createElement('div');
  kicker.className = 'hs-kicker';
  kicker.textContent = 'Fonts, colours and keybinds · saved on this device';
  heading.append(h2, kicker);
  const closeX = document.createElement('button');
  closeX.className = 'hs-x';
  closeX.type = 'button';
  closeX.setAttribute('aria-label', 'Close HUD settings');
  setIconText(closeX, '✕');
  head.append(mark, heading, closeX);

  const body = document.createElement('div');
  body.className = 'hs-body';
  const rail = document.createElement('div');
  rail.className = 'hs-rail';
  body.appendChild(rail);

  // --- panes, built by the helpers below
  const panes: HTMLDivElement[] = [];
  const tabs: HTMLButtonElement[] = [];
  function addTab(icon: string, name: string): HTMLDivElement {
    const tab = document.createElement('button');
    tab.className = 'hs-tab';
    tab.type = 'button';
    const ic = document.createElement('i');
    setIconText(ic, icon);
    const lbl = document.createElement('span');
    lbl.textContent = name;
    tab.append(ic, lbl);
    const pane = document.createElement('div');
    pane.className = 'hs-pane';
    pane.hidden = true;
    const index = panes.length;
    tab.addEventListener('click', () => select(index));
    rail.appendChild(tab);
    body.appendChild(pane);
    tabs.push(tab);
    panes.push(pane);
    return pane;
  }
  function select(index: number): void {
    stopListening();
    panes.forEach((p, i) => { p.hidden = i !== index; });
    tabs.forEach((t, i) => t.classList.toggle('sel', i === index));
  }

  function group(pane: HTMLElement, title: string): void {
    const g = document.createElement('div');
    g.className = 'hs-group';
    g.textContent = title;
    pane.appendChild(g);
  }
  function row(pane: HTMLElement, name: string, desc?: string): HTMLDivElement {
    const r = document.createElement('div');
    r.className = 'hs-row';
    const label = document.createElement('div');
    label.className = 'hs-label';
    const b = document.createElement('b');
    b.textContent = name;
    label.appendChild(b);
    if (desc) {
      const s = document.createElement('span');
      setIconText(s, desc);
      label.appendChild(s);
    }
    const ctl = document.createElement('div');
    ctl.className = 'hs-ctl';
    r.append(label, ctl);
    pane.appendChild(r);
    return ctl;
  }

  /** Everything routes through here: repaint the HUD, save, tell the host. */
  function changed(): void {
    applyHudTheme(settings.theme);
    hooks.onChange();
  }

  // ── Pane 1: Appearance ────────────────────────────────────────────────────
  const lookPane = addTab('✦', 'Appearance');

  // Live preview, pinned above the controls so a colour change is legible
  // against something world-like rather than against the dark panel.
  const preview = document.createElement('div');
  preview.className = 'hs-preview';
  const pvStack = document.createElement('div');
  pvStack.className = 'hs-pv-stack';
  const pvDebug = document.createElement('div');
  pvDebug.className = 'hs-pv-debug';
  pvDebug.textContent = 'XYZ: 128.500 / 71.00000 / -64.250';
  const pvChat = document.createElement('div');
  pvChat.className = 'hs-pv-line';
  pvChat.textContent = 'Waypoint set at your position.';
  const pvName = document.createElement('div');
  pvName.className = 'hs-pv-name';
  pvName.textContent = 'Diamond Pickaxe';
  const pvBar = document.createElement('div');
  pvBar.className = 'hs-pv-bar';
  for (let i = 0; i < 9; i++) {
    const slot = document.createElement('span');
    if (i === 3) slot.className = 'sel';
    pvBar.appendChild(slot);
  }
  pvStack.append(pvDebug, pvChat, pvName, pvBar);
  preview.appendChild(pvStack);
  lookPane.appendChild(preview);

  group(lookPane, 'Presets');
  const presetRow = document.createElement('div');
  presetRow.className = 'hs-presets';
  lookPane.appendChild(presetRow);

  group(lookPane, 'Text');
  const fontSel = document.createElement('select');
  for (const f of HUD_FONTS) {
    const opt = document.createElement('option');
    opt.value = f.id;
    opt.textContent = f.name;
    opt.style.fontFamily = f.stack;
    fontSel.appendChild(opt);
  }
  fontSel.addEventListener('change', () => {
    settings.theme.font = fontSel.value;
    changed();
  });
  row(lookPane, 'Font', 'Used by every HUD surface at once.').appendChild(fontSel);

  const scaleIn = document.createElement('input');
  scaleIn.type = 'range';
  scaleIn.min = '0.8'; scaleIn.max = '1.4'; scaleIn.step = '0.05';
  const scaleVal = document.createElement('span');
  scaleVal.className = 'hs-val';
  scaleIn.addEventListener('input', () => {
    settings.theme.scale = Number(scaleIn.value);
    scaleVal.textContent = `${Math.round(settings.theme.scale * 100)}%`;
    changed();
  });
  row(lookPane, 'Text size', 'Scales HUD text only; the hotbar keeps its size.')
    .append(scaleIn, scaleVal);

  const textSwatch = colorControl(
    () => settings.theme.textColor, (v) => { settings.theme.textColor = v; changed(); });
  row(lookPane, 'Text colour').append(...textSwatch.nodes);

  const shadowSw = switchControl(
    () => settings.theme.textShadow, (v) => { settings.theme.textShadow = v; changed(); });
  row(lookPane, 'Text shadow', 'A soft halo so HUD text survives a bright sky.')
    .appendChild(shadowSw.el);

  group(lookPane, 'Background');
  const bgSwatch = colorControl(
    () => settings.theme.bgColor, (v) => { settings.theme.bgColor = v; changed(); });
  row(lookPane, 'Background colour', 'Behind the hotbar, chat lines and the F3 overlay.')
    .append(...bgSwatch.nodes);

  const opacityIn = document.createElement('input');
  opacityIn.type = 'range';
  opacityIn.min = '0'; opacityIn.max = '1'; opacityIn.step = '0.05';
  const opacityVal = document.createElement('span');
  opacityVal.className = 'hs-val';
  opacityIn.addEventListener('input', () => {
    settings.theme.bgOpacity = Number(opacityIn.value);
    opacityVal.textContent = `${Math.round(settings.theme.bgOpacity * 100)}%`;
    changed();
  });
  row(lookPane, 'Background opacity', '0% hides the backing entirely.')
    .append(opacityIn, opacityVal);

  const accentSwatch = colorControl(
    () => settings.theme.accentColor, (v) => { settings.theme.accentColor = v; changed(); });
  row(lookPane, 'Accent colour', 'Selected hotbar slot, hotbar edge, chat rule.')
    .append(...accentSwatch.nodes);

  for (const preset of PRESETS) {
    const btn = document.createElement('button');
    btn.className = 'hs-preset';
    btn.type = 'button';
    const chip = document.createElement('i');
    chip.style.background =
      `linear-gradient(135deg, ${preset.theme.accentColor}, ${preset.theme.bgColor})`;
    const name = document.createElement('span');
    name.textContent = preset.name;
    btn.append(chip, name);
    btn.addEventListener('click', () => {
      Object.assign(settings.theme, preset.theme);
      changed();
      syncLook();
    });
    presetRow.appendChild(btn);
  }

  // -- Pane 2: HUD Layout ----------------------------------------------------
  // The modules that stay on screen for the whole session. This pane owns which
  // ones are on and how big they are; WHERE each one sits is set by dragging it
  // around the real game, which is the one thing a settings list cannot do well.
  const layoutPane = addTab('\u25a6', 'HUD Layout');

  const dragCard = document.createElement('div');
  dragCard.className = 'hs-dragcard';
  const dragCopy = document.createElement('div');
  const dragTitle = document.createElement('b');
  dragTitle.textContent = 'Arrange them on screen';
  const dragText = document.createElement('span');
  dragText.textContent = 'Drop straight into the world and drag any readout '
    + 'where you want it. They snap to the edges and the middle, and they stay '
    + 'put while you play.';
  dragCopy.append(dragTitle, dragText);
  const dragBtn = document.createElement('button');
  dragBtn.className = 'hs-btn primary';
  dragBtn.type = 'button';
  dragBtn.textContent = 'Move HUD elements';
  dragBtn.addEventListener('click', () => {
    scrim.classList.remove('open');
    stopListening();
    hooks.onEditLayout();
  });
  dragCard.append(dragCopy, dragBtn);
  layoutPane.appendChild(dragCard);

  group(layoutPane, 'Modules');
  const modSwitches = new Map<HudModId, { sync(): void }>();
  for (const mod of HUD_MODULES) {
    const ctl = row(layoutPane, mod.name, mod.desc);
    const size = document.createElement('input');
    size.type = 'range';
    size.min = '0.6'; size.max = '2'; size.step = '0.05';
    size.className = 'hs-modsize';
    const sizeVal = document.createElement('span');
    sizeVal.className = 'hs-val';
    size.addEventListener('input', () => {
      settings.layout[mod.id].scale = Number(size.value);
      sizeVal.textContent = `${Math.round(settings.layout[mod.id].scale * 100)}%`;
      hooks.onChange();
    });
    const sw = switchControl(
      () => settings.layout[mod.id].on,
      (v) => { settings.layout[mod.id].on = v; hooks.onChange(); });
    ctl.append(size, sizeVal, sw.el);
    modSwitches.set(mod.id, {
      sync(): void {
        sw.sync();
        size.value = String(settings.layout[mod.id].scale);
        sizeVal.textContent = `${Math.round(settings.layout[mod.id].scale * 100)}%`;
      },
    });
  }

  /** Pull the module rows back from the live layout (after a reset, or after
   *  the drag editor switched something on from its own inspector). */
  function syncLayout(): void {
    for (const entry of modSwitches.values()) entry.sync();
  }

  // -- Pane 3: Keybinds -------------------------------------------------------
  const bindPane = addTab('⌘', 'Keybinds');
  const keyButtons = new Map<BindAction, HTMLButtonElement>();
  let listening: BindAction | null = null;
  // Assigned only on pointer devices; touch has no bind rows to refresh.
  let syncBinds: (() => void) | null = null;

  if (hooks.touch) {
    const note = document.createElement('p');
    note.className = 'hs-rail-note';
    note.style.padding = '0';
    setIconText(note,
      'This device plays with the on-screen controls, so there are no keys to '
      + 'rebind. Plug in a keyboard and reload to edit binds.');
    bindPane.appendChild(note);
  } else {
    for (const g of BIND_GROUPS) {
      group(bindPane, g.title);
      for (const [action, name, desc] of g.binds) {
        const btn = document.createElement('button');
        btn.className = 'hs-key';
        btn.type = 'button';
        btn.addEventListener('click', () => startListening(action));
        keyButtons.set(action, btn);
        row(bindPane, name, desc).appendChild(btn);
      }
    }
    const clash = document.createElement('p');
    clash.className = 'hs-clash-note';
    clash.hidden = true;
    bindPane.appendChild(clash);

    // Refreshes every key button plus the shared conflict warning.
    syncBinds = (): void => {
      const used = new Map<string, number>();
      for (const a of BIND_ACTIONS) used.set(settings.binds[a], (used.get(settings.binds[a]) ?? 0) + 1);
      let conflicts = 0;
      for (const [action, btn] of keyButtons) {
        const code = settings.binds[action];
        const dup = (used.get(code) ?? 0) > 1;
        if (dup) conflicts++;
        btn.classList.toggle('clash', dup && listening !== action);
        if (listening !== action) btn.textContent = keyLabel(code);
      }
      clash.hidden = conflicts === 0;
      clash.textContent = 'Two actions share a key. The game will fire both, so '
        + 'pick a different key for one of them.';
    };
  }

  function startListening(action: BindAction): void {
    stopListening();
    listening = action;
    const btn = keyButtons.get(action);
    if (!btn) return;
    btn.classList.add('listening');
    btn.classList.remove('clash');
    btn.textContent = 'Press a key…';
    btn.focus();
  }
  function stopListening(): void {
    if (listening === null) return;
    const btn = keyButtons.get(listening);
    listening = null;
    if (btn) btn.classList.remove('listening');
    syncBinds?.();
  }

  // Capture phase, on the window. Two jobs, both of which have to happen before
  // anything else sees the key: swallow EVERY keydown while the panel is open
  // (the game is paused but still listening, so typing a hex code would
  // otherwise flip the inventory open behind the panel), and grab the next one
  // as a bind when a row is armed. Propagation only - the browser still does
  // its own job, so typing and Tab still work inside the card.
  window.addEventListener('keydown', (e) => {
    if (!scrim.classList.contains('open')) return;
    e.stopPropagation();
    if (listening === null) {
      if (e.key === 'Escape') { e.preventDefault(); close(); }
      return;
    }
    e.preventDefault();
    if (e.key === 'Escape') { stopListening(); return; }
    // Delete/Backspace restores this action's default rather than unbinding it:
    // an unbound "walk forward" is a soft-lock the player cannot see coming.
    if (e.code === 'Delete' || e.code === 'Backspace') {
      settings.binds[listening] = DEFAULT_KEYBINDS[listening];
      stopListening();
      hooks.onChange();
      return;
    }
    if (e.code === 'F3' || e.code === 'F4') { stopListening(); return; }
    // Dead keys and some IME states report an empty or exotic `code`; a bind
    // that no keydown can ever match again is worse than no rebind at all.
    if (!/^[A-Za-z0-9]+$/.test(e.code)) { stopListening(); return; }
    settings.binds[listening] = e.code;
    stopListening();
    hooks.onChange();
  }, true);

  const railNote = document.createElement('div');
  railNote.className = 'hs-rail-note';
  setIconText(railNote,
    'These are yours alone. They live in this browser and change nothing '
    + 'other players see.');
  rail.appendChild(railNote);

  // ── footer
  const foot = document.createElement('div');
  foot.className = 'hs-foot';
  const hint = document.createElement('div');
  hint.className = 'hs-hint';
  setIconText(hint, hooks.touch
    ? 'Changes apply straight away.'
    : 'Click a key to rebind it · Delete restores that one · Esc closes');
  const resetBtn = document.createElement('button');
  resetBtn.className = 'hs-btn';
  resetBtn.type = 'button';
  resetBtn.textContent = 'Reset all';
  resetBtn.addEventListener('click', () => {
    Object.assign(settings.theme, DEFAULT_HUD_THEME);
    Object.assign(settings.binds, DEFAULT_KEYBINDS);
    Object.assign(settings.layout, defaultHudLayout());
    changed();
    syncLook();
    syncLayout();
    syncBinds?.();
  });
  const doneBtn = document.createElement('button');
  doneBtn.className = 'hs-btn primary';
  doneBtn.type = 'button';
  doneBtn.textContent = 'Done';
  doneBtn.addEventListener('click', () => close());
  foot.append(hint, resetBtn, doneBtn);

  card.append(head, body, foot);
  scrim.appendChild(card);
  scrim.addEventListener('click', (e) => { if (e.target === scrim) close(); });
  closeX.addEventListener('click', () => close());
  parent.appendChild(scrim);

  /** A colour swatch plus its hex field, kept in sync with each other. */
  function colorControl(get: () => string, set: (v: string) => void):
  { nodes: HTMLElement[]; sync(): void } {
    const swatch = document.createElement('span');
    swatch.className = 'hs-swatch';
    const picker = document.createElement('input');
    picker.type = 'color';
    swatch.appendChild(picker);
    const hex = document.createElement('input');
    hex.className = 'hs-hex';
    hex.type = 'text';
    hex.maxLength = 7;
    hex.spellcheck = false;
    hex.autocomplete = 'off';
    picker.addEventListener('input', () => {
      hex.value = picker.value;
      hex.classList.remove('bad');
      set(picker.value);
    });
    hex.addEventListener('input', () => {
      const v = hex.value.trim().toLowerCase();
      const ok = HEX.test(v);
      hex.classList.toggle('bad', !ok);
      if (ok) { picker.value = v; set(v); }
    });
    // A half-typed hex is not a value: put the live one back on blur.
    hex.addEventListener('blur', () => {
      hex.value = get();
      hex.classList.remove('bad');
    });
    const sync = (): void => {
      picker.value = get();
      hex.value = get();
      hex.classList.remove('bad');
    };
    return { nodes: [swatch, hex], sync };
  }

  function switchControl(get: () => boolean, set: (v: boolean) => void):
  { el: HTMLButtonElement; sync(): void } {
    const el = document.createElement('button');
    el.className = 'hs-switch';
    el.type = 'button';
    el.setAttribute('role', 'switch');
    const sync = (): void => {
      el.classList.toggle('on', get());
      el.setAttribute('aria-checked', String(get()));
    };
    el.addEventListener('click', () => { set(!get()); sync(); });
    return { el, sync };
  }

  /** Pull every appearance control back from the live theme (after a preset or
   *  a reset, where the model moved without the widgets). */
  function syncLook(): void {
    fontSel.value = settings.theme.font;
    scaleIn.value = String(settings.theme.scale);
    scaleVal.textContent = `${Math.round(settings.theme.scale * 100)}%`;
    opacityIn.value = String(settings.theme.bgOpacity);
    opacityVal.textContent = `${Math.round(settings.theme.bgOpacity * 100)}%`;
    textSwatch.sync();
    bgSwatch.sync();
    accentSwatch.sync();
    shadowSw.sync();
  }

  function close(): void {
    stopListening();
    scrim.classList.remove('open');
    hooks.onClose();
  }

  select(0);
  syncLook();
  syncLayout();
  syncBinds?.();

  return {
    get open(): boolean { return scrim.classList.contains('open'); },
    show(): void {
      syncLook();
      syncLayout();
      syncBinds?.();
      select(0);
      scrim.classList.add('open');
    },
    hide(): void { close(); },
  };
}
