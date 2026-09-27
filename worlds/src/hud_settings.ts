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
// The chrome follows the front door's daylight look (a dark variant rides on
// Dark mode): a category rail down the left, one row per setting with the control pinned
// right, and a live preview of the HUD sitting above the controls.

import { setIconText, iconSvg } from './emoji_icons';
import type { IconName } from './emoji_icons';
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
    ['jump', 'Jump'],
    ['sneak', 'Sneak'],
    ['sprint', 'Sprint', 'double-tapping forward still works'],
  ] },
  { title: 'Match', binds: [
    ['reload', 'Reload / back to checkpoint', 'reloads in Duels, retries in Parkour'],
  ] },
  { title: 'View', binds: [
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
  // The blocky one. Half of the look is the face and half is the RENDERING:
  // `pixel` is the only font here that also switches text antialiasing off (see
  // applyHudTheme and the [data-hud-pixel] rules in index.html), so strokes
  // land on whole pixels instead of being smeared across two of them. Without
  // that the crispest bitmap face still comes out looking like every other one.
  { id: 'pixel', name: 'Pixel (blocky)', stack: "'Silkscreen', 'Press Start 2P', 'Pixel Operator', 'Perfect DOS VGA 437', 'Small Fonts', Fixedsys, Terminal, Terminus, 'MS Gothic', 'Andale Mono', Monaco, monospace" },
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
  /** Dark chrome for the game's PANELS - inventory, crafting, the Field Guide,
   *  the pause menu, every menu button. Separate from the HUD colours above:
   *  those style text floating over the world, this restyles the opaque
   *  surfaces you open on top of it. */
  darkUi: boolean;
}

export const DEFAULT_HUD_THEME: HudTheme = {
  font: 'console',
  scale: 1,
  textColor: '#ffffff',
  bgColor: '#000000',
  bgOpacity: 0.55,
  accentColor: '#4db8ff',
  textShadow: true,
  darkUi: false,
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
    darkUi: x.darkUi === true,
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
  // Two switches that CSS variables cannot carry, because both change how a
  // rule renders rather than what value it holds. They live on <html> so the
  // stylesheet in index.html can key whole blocks off them.
  const html = document.documentElement;
  html.toggleAttribute('data-hud-pixel', theme.font === 'pixel');
  html.toggleAttribute('data-ui-dark', theme.darkUi);
}

// --- The panel --------------------------------------------------------------

const CSS = `
#hud-settings {
  --hs-ink:#122032; --hs-ink-soft:#3b4f68; --hs-mute:#687d95;
  --hs-line:rgba(18,32,50,.1); --hs-line-soft:rgba(18,32,50,.07); --hs-line-lit:rgba(18,32,50,.22);
  --hs-card:#f4f7fb; --hs-bar:#ffffff; --hs-rail:#eaf0f7; --hs-surface:#ffffff;
  --hs-field:#ffffff; --hs-hover:rgba(18,32,50,.05);
  --hs-accent:#2d6ee0; --hs-accent-soft:rgba(45,110,224,.11); --hs-accent-ink:#1d57bd;
  --hs-track:rgba(18,32,50,.12); --hs-knob:#ffffff;
  --hs-primary:linear-gradient(180deg,#24344c,#122032); --hs-primary-hover:linear-gradient(180deg,#2b3e5b,#16273d);
  --hs-primary-ink:#fff;
  --hs-bad:#c42f3a; --hs-bad-soft:rgba(212,52,63,.08);
  --hs-shadow:0 34px 80px rgba(12,22,36,.34), 0 2px 8px rgba(12,22,36,.08);
  --hs-row-shadow:0 1px 2px rgba(18,32,50,.04);
  --hs-check:#e7edf5;
  position:absolute; inset:0; z-index:70; display:none;
  align-items:center; justify-content:center; padding:24px;
  background:radial-gradient(ellipse 80% 70% at 50% 45%, rgba(236,243,251,.55), rgba(206,220,238,.35) 70%), rgba(160,182,210,.24);
  backdrop-filter:blur(10px) saturate(1.1);
  font-family:ui-sans-serif,-apple-system,'Segoe UI',Roboto,system-ui,sans-serif;
  color:var(--hs-ink); -webkit-font-smoothing:antialiased; }
html[data-ui-dark] #hud-settings {
  --hs-ink:#eaf1fa; --hs-ink-soft:#aec1d8; --hs-mute:#8398b2;
  --hs-line:rgba(150,182,224,.14); --hs-line-soft:rgba(150,182,224,.09); --hs-line-lit:rgba(150,182,224,.32);
  --hs-card:#0f141d; --hs-bar:#141a25; --hs-rail:#0c1017; --hs-surface:#161d2a;
  --hs-field:#10151f; --hs-hover:rgba(150,182,224,.08);
  --hs-accent:#6ea8ff; --hs-accent-soft:rgba(110,168,255,.14); --hs-accent-ink:#a9ccff;
  --hs-track:rgba(150,182,224,.2); --hs-knob:#eaf1fa;
  --hs-primary:linear-gradient(180deg,#ffdb87,#ffc043); --hs-primary-hover:linear-gradient(180deg,#ffe7ab,#ffcb5e);
  --hs-primary-ink:#241703;
  --hs-bad:#ff8f96; --hs-bad-soft:rgba(255,77,85,.1);
  --hs-shadow:0 34px 90px rgba(0,0,0,.66);
  --hs-row-shadow:none;
  --hs-check:#1a2130;
  background:rgba(4,6,11,.74); }
#hud-settings.open { display:flex; }
#hud-settings * { text-shadow:none; box-sizing:border-box; }
.hs-card { display:flex; flex-direction:column; width:min(900px,100%);
  height:min(660px,calc(100vh - 48px)); background:var(--hs-card);
  border:1px solid var(--hs-line); border-radius:24px; overflow:hidden;
  box-shadow:var(--hs-shadow); animation:hs-rise .26s cubic-bezier(.2,.9,.3,1.15) both; }
@keyframes hs-rise { from { transform:translateY(14px) scale(.985); opacity:0; } }
.hs-head { display:flex; align-items:center; gap:13px; flex:0 0 auto;
  padding:0 18px; height:68px; border-bottom:1px solid var(--hs-line); background:var(--hs-bar); }
.hs-mark { width:40px; height:40px; border-radius:13px; flex:0 0 auto;
  background:var(--hs-accent-soft); box-shadow:inset 0 0 0 1px var(--hs-accent-soft);
  display:grid; place-items:center; }
.hs-mark::before { content:''; width:18px; height:14px; border-radius:4px;
  border:2px solid var(--hs-accent);
  background:linear-gradient(var(--hs-accent),var(--hs-accent)) no-repeat 50% calc(100% - 2px)/10px 2px; }
.hs-head h2 { color:var(--hs-ink); font-size:18px; font-weight:850; letter-spacing:-.2px; line-height:1.15; }
.hs-kicker { margin-top:2px; color:var(--hs-mute); font-size:11.5px; font-weight:500; }
.hs-x { margin-left:auto; width:36px; height:36px; border:1px solid var(--hs-line); border-radius:11px;
  background:var(--hs-surface); color:var(--hs-ink-soft); font-size:15px; line-height:1; cursor:pointer;
  transition:background .12s,color .12s,border-color .12s; }
.hs-x:hover { background:var(--hs-hover); color:var(--hs-ink); border-color:var(--hs-line-lit); }
.hs-body { display:flex; flex:1 1 auto; min-height:0; }
.hs-rail { flex:0 0 200px; display:flex; flex-direction:column; gap:3px;
  padding:14px 12px; border-right:1px solid var(--hs-line); background:var(--hs-rail); }
.hs-tab { position:relative; display:flex; align-items:center; gap:10px;
  padding:10px 12px; border:0; border-radius:11px; background:transparent;
  color:var(--hs-ink-soft); font:inherit; font-size:13px; font-weight:650; text-align:left;
  cursor:pointer; transition:background .12s,color .12s,box-shadow .12s; }
.hs-tab:hover { background:var(--hs-hover); color:var(--hs-ink); }
.hs-tab.sel { background:var(--hs-surface); color:var(--hs-ink);
  box-shadow:0 1px 2px rgba(18,32,50,.06), 0 4px 12px rgba(28,52,86,.08), inset 0 0 0 1px var(--hs-line); }
.hs-tab i { display:flex; align-items:center; justify-content:center; flex:0 0 auto;
  width:26px; height:26px; border-radius:8px; font-style:normal; color:var(--hs-mute);
  transition:background .12s,color .12s; }
.hs-tab i svg { width:16px; height:16px; vertical-align:middle; }
.hs-tab.sel i { color:var(--hs-accent); background:var(--hs-accent-soft); }
.hs-rail-note { margin-top:auto; padding:10px 12px; color:var(--hs-mute); font-size:11px;
  line-height:1.5; }
.hs-pane { flex:1 1 auto; min-width:0; overflow-y:auto; padding:20px 22px 24px;
  scrollbar-width:thin; scrollbar-color:var(--hs-track) transparent; }
.hs-pane::-webkit-scrollbar { width:9px; }
.hs-pane::-webkit-scrollbar-thumb { background:var(--hs-track); border-radius:5px; }
.hs-pane[hidden] { display:none; }
.hs-group { color:var(--hs-mute); font-size:10.5px; font-weight:800; letter-spacing:1.3px;
  text-transform:uppercase; margin:22px 4px 8px; }
.hs-group:first-child { margin-top:0; }
/* Rows between two headings read as one white list card. */
.hs-row { display:flex; align-items:center; justify-content:space-between; gap:22px;
  padding:12px 16px; background:var(--hs-surface); border:1px solid var(--hs-line);
  box-shadow:var(--hs-row-shadow); }
.hs-row + .hs-row { margin-top:-1px; border-top-color:var(--hs-line-soft); }
.hs-group + .hs-row, .hs-pane > .hs-row:first-child { border-top-left-radius:14px; border-top-right-radius:14px; }
.hs-row:last-child, .hs-row:has(+ :not(.hs-row)) { border-bottom-left-radius:14px; border-bottom-right-radius:14px; }
.hs-label { min-width:0; }
.hs-label b { display:block; color:var(--hs-ink); font-size:13px; font-weight:700; }
.hs-label span { display:block; margin-top:3px; color:var(--hs-mute); font-size:11.5px; line-height:1.45; }
.hs-ctl { flex:0 0 auto; display:flex; align-items:center; gap:10px; }
.hs-ctl select { min-width:180px; height:36px; padding:0 32px 0 11px; border-radius:10px;
  border:1px solid var(--hs-line-lit); color:var(--hs-ink); font:inherit; font-size:12.5px; font-weight:650;
  -webkit-appearance:none; appearance:none; cursor:pointer;
  background:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12'%3E%3Cpath d='M3 4.5 6 7.5 9 4.5' fill='none' stroke='%23687d95' stroke-width='1.6' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E") no-repeat right 10px center / 12px, var(--hs-field); }
.hs-ctl select option { background:var(--hs-surface); color:var(--hs-ink); }
.hs-ctl select:hover { border-color:var(--hs-accent); }
.hs-ctl select:focus-visible, .hs-key:focus-visible, .hs-x:focus-visible, .hs-hex:focus-visible,
.hs-tab:focus-visible, .hs-btn:focus-visible, .hs-switch:focus-visible, .hs-preset:focus-visible,
.hs-ctl input[type=range]:focus-visible { outline:2.5px solid var(--hs-accent); outline-offset:2px; }
/* Sliders fill up to the thumb (--fill is kept in sync by the panel). */
.hs-ctl input[type=range] { --fill:50%; -webkit-appearance:none; appearance:none;
  width:150px; height:22px; background:transparent; cursor:pointer; }
.hs-ctl input[type=range]::-webkit-slider-runnable-track { height:6px; border-radius:999px;
  background:linear-gradient(90deg,var(--hs-accent) var(--fill),var(--hs-track) var(--fill)); }
.hs-ctl input[type=range]::-moz-range-track { height:6px; border-radius:999px; background:var(--hs-track); }
.hs-ctl input[type=range]::-moz-range-progress { height:6px; border-radius:999px; background:var(--hs-accent); }
.hs-ctl input[type=range]::-webkit-slider-thumb { -webkit-appearance:none; width:18px; height:18px;
  margin-top:-6px; border-radius:50%; background:var(--hs-knob); border:2px solid var(--hs-accent);
  box-shadow:0 2px 6px rgba(18,32,50,.25); }
.hs-ctl input[type=range]::-moz-range-thumb { width:14px; height:14px; border-radius:50%;
  background:var(--hs-knob); border:2px solid var(--hs-accent); box-shadow:0 2px 6px rgba(18,32,50,.25); }
.hs-val { min-width:48px; padding:5px 0; border-radius:8px; background:var(--hs-rail);
  color:var(--hs-ink); font-size:11.5px; font-weight:750; text-align:center;
  font-variant-numeric:tabular-nums; }
.hs-swatch { position:relative; width:44px; height:36px; border-radius:10px;
  border:1px solid var(--hs-line-lit); overflow:hidden; cursor:pointer;
  background-image:linear-gradient(45deg,transparent 25%,var(--hs-check) 0 50%,transparent 0 75%,var(--hs-check) 0);
  background-size:10px 10px; box-shadow:inset 0 0 0 2px var(--hs-surface); }
.hs-swatch input { position:absolute; inset:-6px; width:calc(100% + 12px);
  height:calc(100% + 12px); border:0; padding:0; background:transparent; cursor:pointer; }
.hs-hex { width:92px; height:36px; padding:0 10px; border-radius:10px; border:1px solid var(--hs-line-lit);
  background:var(--hs-field); color:var(--hs-ink); font-family:'Lucida Console',Monaco,monospace;
  font-size:11.5px; text-transform:lowercase; }
.hs-hex.bad { border-color:var(--hs-bad); background:var(--hs-bad-soft); }
.hs-switch { position:relative; width:44px; height:26px; flex:0 0 auto; border:0; padding:0;
  border-radius:999px; background:var(--hs-track); cursor:pointer; transition:background .16s; }
.hs-switch::after { content:''; position:absolute; top:3px; left:3px; width:20px; height:20px;
  border-radius:50%; background:var(--hs-knob); box-shadow:0 1px 3px rgba(18,32,50,.3);
  transition:transform .18s cubic-bezier(.3,1.4,.5,1); }
.hs-switch.on { background:var(--hs-accent); }
.hs-switch.on::after { transform:translateX(18px); }
.hs-key { min-width:118px; height:34px; padding:0 12px; border-radius:10px;
  border:1px solid var(--hs-line-lit); border-bottom-width:2px; background:var(--hs-field); color:var(--hs-ink);
  font-family:'Lucida Console',Monaco,monospace; font-size:11.5px; font-weight:700; cursor:pointer;
  transition:border-color .12s,background .12s,color .12s; }
.hs-key:hover { border-color:var(--hs-accent); }
.hs-key.listening { border-color:var(--hs-accent); background:var(--hs-accent-soft); color:var(--hs-accent-ink);
  animation:hs-listen 1s ease-in-out infinite; }
@keyframes hs-listen { 50% { box-shadow:0 0 0 4px var(--hs-accent-soft); } }
.hs-key.clash { border-color:var(--hs-bad); color:var(--hs-bad); background:var(--hs-bad-soft); }
.hs-clash-note { margin:12px 4px 0; color:var(--hs-bad); font-size:11.5px; font-weight:600; }
.hs-clash-note[hidden] { display:none; }
.hs-presets { display:grid; grid-template-columns:repeat(auto-fill,minmax(118px,1fr)); gap:8px; padding:0 0 4px; }
.hs-preset { display:flex; align-items:center; gap:9px; padding:8px 10px;
  border:1px solid var(--hs-line); border-radius:12px; background:var(--hs-surface); color:var(--hs-ink);
  font:inherit; font-size:12.5px; font-weight:650; cursor:pointer; box-shadow:var(--hs-row-shadow);
  transition:transform .12s,border-color .12s,box-shadow .12s; }
.hs-preset:hover { transform:translateY(-1px); border-color:var(--hs-line-lit);
  box-shadow:0 8px 18px rgba(28,52,86,.1); }
.hs-preset i { width:22px; height:22px; border-radius:7px; flex:0 0 auto;
  box-shadow:inset 0 0 0 1px rgba(255,255,255,.25), 0 1px 3px rgba(18,32,50,.25); }
.hs-foot { flex:0 0 auto; display:flex; align-items:center; gap:10px;
  padding:14px 18px; border-top:1px solid var(--hs-line); background:var(--hs-bar); }
.hs-foot .hs-hint { color:var(--hs-mute); font-size:11.5px; margin-right:auto; }
.hs-btn { height:40px; padding:0 18px; white-space:nowrap; border-radius:12px; border:1px solid var(--hs-line-lit);
  background:var(--hs-surface); color:var(--hs-ink); font:inherit; font-size:13px; font-weight:750; cursor:pointer;
  transition:transform .12s,background .12s,border-color .12s,box-shadow .12s; }
.hs-btn:hover { transform:translateY(-1px); background:var(--hs-hover); box-shadow:0 8px 18px rgba(28,52,86,.1); }
.hs-btn.primary { border-color:transparent; background:var(--hs-primary); color:var(--hs-primary-ink);
  box-shadow:0 10px 24px rgba(18,32,50,.24); }
.hs-btn.primary:hover { background:var(--hs-primary-hover); }

/* HUD Layout: the call to action that hands the screen to the drag editor. */
.hs-dragcard { display:flex; align-items:center; gap:16px; padding:16px 18px;
  margin-bottom:4px; border:1px solid var(--hs-line); border-radius:16px;
  background:linear-gradient(135deg,var(--hs-accent-soft),transparent 70%),var(--hs-surface);
  box-shadow:var(--hs-row-shadow); }
.hs-dragcard > div { min-width:0; }
.hs-dragcard b { display:block; color:var(--hs-ink); font-size:14px; font-weight:800; }
.hs-dragcard span { display:block; margin-top:4px; color:var(--hs-mute); font-size:11.5px;
  line-height:1.5; }
.hs-dragcard .hs-btn { flex:0 0 auto; }
.hs-ctl input[type=range].hs-modsize { width:104px; }

/* Live preview: the real HUD variables, at HUD scale, on a stand-in sky. */
.hs-preview { position:relative; border:1px solid var(--hs-line); border-radius:16px;
  padding:16px; margin-bottom:6px; overflow:hidden;
  box-shadow:inset 0 -30px 40px -30px rgba(0,0,0,.25), var(--hs-row-shadow);
  background:
    radial-gradient(ellipse 60% 50% at 80% 10%, rgba(255,255,255,.45), transparent 70%),
    linear-gradient(180deg,#6f9bd6,#a8c6ec 52%,#6e9a5a 52.5%,#4e7440); }
.hs-preview::after { content:'Preview'; position:absolute; right:10px; top:10px;
  padding:3px 8px; border-radius:999px; background:rgba(255,255,255,.8); color:#3b4f68;
  font:800 9.5px/1.4 ui-sans-serif,system-ui,sans-serif; letter-spacing:1px; text-transform:uppercase; }
.hs-preview .hs-pv-stack { display:flex; flex-direction:column; align-items:flex-start; gap:6px;
  font-family:var(--hud-font); color:var(--hud-text);
  text-shadow:var(--hud-text-shadow); font-weight:bold; letter-spacing:.5px; }
.hs-pv-line { background:var(--hud-bg); border-left:3px solid var(--hud-accent);
  padding:3px 9px; border-radius:0 6px 6px 0; font-size:calc(12px * var(--hud-scale)); }
.hs-pv-debug { background:var(--hud-bg); padding:1px 6px; border-radius:5px;
  font-size:calc(13px * var(--hud-scale)); }
.hs-pv-bar { display:flex; gap:3px; align-self:center; margin-top:4px; padding:3px;
  background:var(--hud-bg); border-radius:10px;
  box-shadow:0 0 0 1px var(--hud-accent-soft), 0 6px 16px rgba(0,0,0,.25); }
.hs-pv-bar span { position:relative; width:30px; height:30px; border-radius:7px;
  background:rgba(255,255,255,.06); box-shadow:inset 0 0 0 1px rgba(255,255,255,.1); }
.hs-pv-bar span.sel { background:rgba(255,255,255,.16);
  box-shadow:inset 0 0 0 2px var(--hud-accent), 0 0 10px var(--hud-accent-soft); z-index:1; }
.hs-pv-name { align-self:center; font-size:calc(13px * var(--hud-scale)); }

@media (max-width: 720px) {
  #hud-settings { padding:10px; }
  .hs-card { height:min(660px,calc(100vh - 20px)); border-radius:20px; }
  .hs-head { height:60px; padding:0 14px; }
  .hs-mark { width:34px; height:34px; border-radius:11px; }
  .hs-kicker { display:none; }
  .hs-body { flex-direction:column; }
  .hs-rail { flex:0 0 auto; flex-direction:row; overflow-x:auto; gap:6px;
    border-right:0; border-bottom:1px solid var(--hs-line); padding:9px 10px; }
  .hs-rail-note { display:none; }
  .hs-tab { white-space:nowrap; padding:8px 11px; }
  .hs-row { flex-direction:column; align-items:stretch; gap:9px; padding:12px 14px; }
  .hs-ctl { justify-content:flex-end; }
  .hs-pane { padding:14px; }
  .hs-dragcard { flex-direction:column; align-items:stretch; }
  .hs-preview::after, .hs-foot .hs-hint { display:none; }
  .hs-foot { justify-content:flex-end; }
}
@media (prefers-reduced-motion: reduce) { .hs-card, .hs-key.listening { animation:none; } }
body.reduced-motion .hs-card, body.reduced-motion .hs-key.listening { animation:none; }
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
  function addTab(icon: IconName, name: string): HTMLDivElement {
    const tab = document.createElement('button');
    tab.className = 'hs-tab';
    tab.type = 'button';
    const ic = document.createElement('i');
    ic.innerHTML = iconSvg(icon);
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
  const lookPane = addTab('palette', 'Appearance');

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

  // Panels, not HUD text. Everything above restyles marks that float over the
  // world; this restyles the opaque sheets that open on top of it, which are
  // the surfaces that are actually painful at night.
  group(lookPane, 'Interface');
  const darkSw = switchControl(
    () => settings.theme.darkUi, (v) => { settings.theme.darkUi = v; changed(); });
  row(lookPane, 'Dark mode',
    'Dark chrome for the inventory, crafting, chests, the Field Guide and the menus.')
    .appendChild(darkSw.el);

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
  const layoutPane = addTab('layout', 'HUD Layout');

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
    paintRanges();
  }

  // -- Pane 3: Keybinds -------------------------------------------------------
  const bindPane = addTab('keyboard', 'Keybinds');
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
    darkSw.sync();
    paintRanges();
  }

  /** Slider tracks fill up to the thumb (the CSS reads --fill). */
  function paintRange(el: HTMLInputElement): void {
    const min = Number(el.min), max = Number(el.max);
    el.style.setProperty('--fill', `${((Number(el.value) - min) / (max - min)) * 100}%`);
  }
  function paintRanges(): void {
    scrim.querySelectorAll<HTMLInputElement>('input[type=range]').forEach(paintRange);
  }
  scrim.addEventListener('input', (e) => {
    const el = e.target as HTMLInputElement;
    if (el.type === 'range') paintRange(el);
  });

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
