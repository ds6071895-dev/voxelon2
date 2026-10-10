// Persisted action names and keyboard rules. No DOM or component dependencies.

/** Hotbar digits and F3 remain fixed positional/developer keys. */
export type BindAction =
  | 'forward' | 'back' | 'left' | 'right'
  | 'jump' | 'sneak' | 'sprint'
  | 'reload' | 'view' | 'zoom';

export type Keybinds = Record<BindAction, string>;

export const DEFAULT_KEYBINDS: Keybinds = {
  forward: 'KeyW', back: 'KeyS', left: 'KeyA', right: 'KeyD',
  jump: 'Space', sneak: 'ShiftLeft', sprint: 'KeyQ',
  reload: 'KeyR', view: 'KeyV', zoom: 'KeyC',
};

export const BIND_ACTIONS = Object.keys(DEFAULT_KEYBINDS) as BindAction[];

const SIDE_PAIR: Readonly<Record<string, string>> = {
  ShiftLeft: 'ShiftRight', ShiftRight: 'ShiftLeft',
  ControlLeft: 'ControlRight', ControlRight: 'ControlLeft',
  AltLeft: 'AltRight', AltRight: 'AltLeft',
};

/** A modifier bound on either side answers to both physical keys. */
export function matchesBind(code: string, bound: string): boolean {
  return code === bound || SIDE_PAIR[bound] === code;
}

export function heldBind(keys: ReadonlySet<string>, bound: string): boolean {
  const other = SIDE_PAIR[bound];
  return keys.has(bound) || (other !== undefined && keys.has(other));
}

export function sanitizeKeybinds(raw: unknown): Keybinds {
  const x = raw && typeof raw === 'object' ? raw as Partial<Keybinds> : {};
  const out = { ...DEFAULT_KEYBINDS };
  for (const action of BIND_ACTIONS) {
    const code = x[action];
    // Keep the existing persisted-code acceptance and conflict behavior.
    if (typeof code === 'string' && code.length > 0 && code.length <= 24
      && /^[A-Za-z0-9]+$/.test(code)) out[action] = code;
  }
  return out;
}

/** Settings/Controls labels; the compact telemetry caps intentionally differ. */
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
