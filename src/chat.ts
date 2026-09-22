// The command console ("chat box").
//
// VOXELON has NO free chat — the box is a COMMAND line and nothing else. That
// is enforced structurally rather than by filtering: the leading "/" is a fixed
// label outside the <input> (so it can never be deleted), and pressing Enter on
// anything that isn't a known command prints an error locally instead of
// sending text to anyone.
//
// It also replaces the old one-key-per-panel bindings (M/B/G/H/T/Y): every
// screen those keys opened is now a command, listed live in the suggestion
// strip above the input so the whole surface is discoverable from one key.
//
// The DOM lives inside the class (nothing at module scope), so the pure parts
// below — the registry, the parser, the suggestion matcher — import cleanly
// into the headless smoke tests.

import { setIconText } from './emoji_icons';

export interface CommandSpec {
  /** Bare name, no slash. */
  name: string;
  /** Argument sketch shown in the suggestion strip, e.g. "<player>". */
  args?: string;
  desc: string;
}

/** Commands the CLIENT runs itself — these are the ex-keybinds. */
export const PLAYER_COMMANDS: CommandSpec[] = [
  { name: 'help', desc: 'List every command you can run' },
  { name: 'map', desc: 'Open the world map' },
  { name: 'waypoint', args: '[name]', desc: 'Drop a waypoint where you stand' },
  { name: 'warfare', desc: 'Open the Warfare Command tree' },
  { name: 'guide', desc: 'Show or hide the Getting Started guide' },
  { name: 'tpa', args: '<player>', desc: 'Ask a player to teleport to them' },
  { name: 'tpaccept', desc: 'Accept a teleport request — then stand still' },
  { name: 'tpdeny', desc: 'Refuse the pending teleport request' },
];

/**
 * Operator commands. These are NOT run on the client — it forwards the raw line
 * to the server, which re-checks OP on every one (this list only drives the
 * suggestion strip, so a hacked client gains nothing by faking it).
 *
 * Mirrors the server console's own HELP. `op`/`deop` are deliberately absent:
 * granting operator is console-only, so no in-game account can promote itself.
 */
export const ADMIN_COMMANDS: CommandSpec[] = [
  { name: 'list', desc: 'OP · List online players' },
  { name: 'coords', args: '[player]', desc: 'OP · Show player coordinates' },
  { name: 'give', args: '<player> <item> [n]', desc: 'OP · Give items' },
  { name: 'gamemode', args: '<mode> <player>', desc: 'OP · survival | creative | spectator' },
  { name: 'tp', args: '<player> <x y z|player>', desc: 'OP · Teleport a player' },
  { name: 'tpstruct', args: '<player> [kind]', desc: 'OP · Teleport to tower|bunker|pod|vault' },
  { name: 'sethearts', args: '<player> <n>', desc: 'OP · Set a player\'s hearts (0-20)' },
  { name: 'revive', args: '<player>', desc: 'OP · Clear an elimination lockout' },
  { name: 'war', args: '<start|schedule|cancel|status>', desc: 'OP · Control the war window' },
  { name: 'flags', args: '<on|off|reset|status>', desc: 'OP · Control flag breaking' },
  { name: 'xp', args: '<player|all> <n>', desc: 'OP · Grant warfare XP' },
  { name: 'ops', desc: 'OP · List the server operators' },
  { name: 'save', desc: 'OP · Force-save the world + accounts' },
  { name: 'stop', desc: 'OP · Save and shut the server down' },
];

/** Every command the given player may type (operators see both lists). */
export function commandList(op: boolean): CommandSpec[] {
  return op ? [...PLAYER_COMMANDS, ...ADMIN_COMMANDS] : PLAYER_COMMANDS.slice();
}

/** "/tpa  Alice " -> { name: 'tpa', args: ['Alice'] }. Leading slashes optional
 *  (the box strips them, but a pasted "/tpa Alice" must still work). */
export function parseCommand(raw: string): { name: string; args: string[] } {
  const parts = raw.trim().replace(/^\/+/, '').split(/\s+/).filter(Boolean);
  return { name: (parts[0] ?? '').toLowerCase(), args: parts.slice(1) };
}

/** "/tpa <player>" — the label shown in the suggestion strip. */
export function commandLabel(spec: CommandSpec): string {
  return `/${spec.name}${spec.args ? ` ${spec.args}` : ''}`;
}

/**
 * Suggestions for what's typed so far. Empty input lists everything; a partial
 * name prefix-matches (falling back to a substring match so "point" still finds
 * "waypoint"); once a space has been typed the name is settled, so the strip
 * collapses to that one command and becomes argument help.
 */
export function suggestCommands(text: string, op: boolean): CommandSpec[] {
  const all = commandList(op);
  const typed = text.replace(/^\/+/, '');
  const name = (typed.split(/\s+/)[0] ?? '').toLowerCase();
  if (/\s/.test(typed)) {
    const exact = all.find((c) => c.name === name);
    return exact ? [exact] : [];
  }
  if (!name) return all;
  const starts = all.filter((c) => c.name.startsWith(name));
  return starts.length ? starts : all.filter((c) => c.name.includes(name));
}

/** What the host wires up so the box can act on a line. */
export interface ChatBoxHooks {
  /** True when the local player is a server operator (drives suggestions). */
  isOp(): boolean;
  /** Run a PLAYER command locally. Return an error string to print, or null. */
  runLocal(name: string, args: string[], raw: string): string | null;
  /** Forward an operator command to the server. Return false if unavailable. */
  sendAdmin(raw: string): boolean;
  onOpen(): void;
  onClose(): void;
}

const LOG_MAX = 12;        // lines kept on screen
const LOG_TTL_MS = 15000;  // a line fades out this long after it was printed
const HISTORY_MAX = 32;

const CSS = `
#chat-root { position:absolute; left:8px; bottom:76px; z-index:22; width:min(560px, calc(100% - 16px));
  display:flex; flex-direction:column; gap:4px; align-items:stretch; pointer-events:none; }
#chat-log { display:flex; flex-direction:column; gap:2px; align-items:flex-start; }
/* The log rides the HUD theme (Pause -> HUD Settings) so it matches the hotbar
   and the F3 overlay; only the error/ok rules keep a colour of their own,
   because "this went wrong" has to read as red whatever the accent is. */
.chat-line { font-size:calc(12px * var(--hud-scale)); line-height:1.5;
  font-family:var(--hud-font); color:var(--hud-text); text-shadow:var(--hud-text-shadow);
  background:var(--hud-bg); border-left:3px solid var(--hud-accent); padding:2px 8px;
  max-width:100%; word-break:break-word; white-space:pre-wrap; transition:opacity 0.6s; }
.chat-line.err { border-left-color:#c2453f; color:#ffbdb8; }
.chat-line.ok { border-left-color:#4a9d5b; }
.chat-line.faded { opacity:0; }
#chat-root.open .chat-line { opacity:1; }
#chat-suggest { display:none; flex-direction:column; background:var(--hud-bg-solid);
  border:2px solid; border-color:#2a3550 #4a5775 #4a5775 #2a3550; max-height:186px;
  overflow-y:auto; pointer-events:auto; }
#chat-root.open #chat-suggest { display:flex; }
.chat-sugg { display:flex; gap:10px; align-items:baseline; padding:3px 8px; cursor:pointer;
  font-size:12px; color:#9fb2d8; text-shadow:none; }
.chat-sugg b { color:#ffd84a; font-weight:normal; }
.chat-sugg:hover { background:#1b2440; }
.chat-sugg.sel { background:#2b3a68; color:#e8eeff; }
#chat-entry { display:none; align-items:center; gap:0; background:var(--hud-bg-solid);
  border:2px solid; border-color:#2a3550 #4a5775 #4a5775 #2a3550; padding:5px 8px;
  pointer-events:auto; }
#chat-root.open #chat-entry { display:flex; }
#chat-slash { font-size:calc(14px * var(--hud-scale)); color:var(--hud-accent);
  text-shadow:none; padding-right:1px; }
#chat-input { flex:1; min-width:0; background:transparent; border:none; outline:none;
  font-family:var(--hud-font); font-size:calc(14px * var(--hud-scale));
  color:var(--hud-text); text-shadow:none; }
#chat-hint { display:none; font-size:10px; color:var(--hud-text-dim); text-shadow:none;
  padding:2px 2px 0; pointer-events:none; }
#chat-root.open #chat-hint { display:block; }
`;

export class ChatBox {
  open = false;
  private readonly hooks: ChatBoxHooks;
  private readonly root: HTMLDivElement;
  private readonly logEl: HTMLDivElement;
  private readonly suggestEl: HTMLDivElement;
  private readonly inputEl: HTMLInputElement;
  private suggestions: CommandSpec[] = [];
  private selected = 0;
  private readonly history: string[] = [];
  private historyAt = -1;

  constructor(parent: HTMLElement, hooks: ChatBoxHooks) {
    this.hooks = hooks;

    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);

    this.root = document.createElement('div');
    this.root.id = 'chat-root';
    this.root.className = 'mc-font';

    this.logEl = document.createElement('div');
    this.logEl.id = 'chat-log';

    this.suggestEl = document.createElement('div');
    this.suggestEl.id = 'chat-suggest';

    const entry = document.createElement('div');
    entry.id = 'chat-entry';
    const slash = document.createElement('span');
    slash.id = 'chat-slash';
    slash.textContent = '/';
    this.inputEl = document.createElement('input');
    this.inputEl.id = 'chat-input';
    this.inputEl.type = 'text';
    this.inputEl.maxLength = 200;
    this.inputEl.autocomplete = 'off';
    this.inputEl.spellcheck = false;
    this.inputEl.placeholder = 'command…';
    this.inputEl.className = 'mc-font';
    entry.append(slash, this.inputEl);

    const hint = document.createElement('div');
    hint.id = 'chat-hint';
    setIconText(hint,
      'Enter = run · Tab = complete · ↑ ↓ = pick · Esc = close · commands only, no chat');

    this.root.append(this.logEl, this.suggestEl, entry, hint);
    parent.appendChild(this.root);

    // Typing must never reach the game hotkeys, and the slash must never be
    // deletable — it is not in the field, but a paste could still add one.
    this.inputEl.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') { e.preventDefault(); this.submit(); }
      else if (e.key === 'Escape') { e.preventDefault(); this.hide(); }
      else if (e.key === 'Tab') { e.preventDefault(); this.complete(); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); this.moveSelection(1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); this.moveSelection(-1); }
      else if (e.key === 'PageUp') { e.preventDefault(); this.recall(1); }
      else if (e.key === 'PageDown') { e.preventDefault(); this.recall(-1); }
    });
    this.inputEl.addEventListener('keyup', (e) => e.stopPropagation());
    this.inputEl.addEventListener('input', () => {
      const stripped = this.inputEl.value.replace(/^\/+/, '');
      if (stripped !== this.inputEl.value) this.inputEl.value = stripped;
      this.selected = 0;
      this.refreshSuggestions();
    });
  }

  /** Open the box (optionally pre-filled, without the slash). */
  show(prefill = ''): void {
    if (this.open) return;
    this.open = true;
    this.root.classList.add('open');
    this.inputEl.value = prefill.replace(/^\/+/, '');
    this.selected = 0;
    this.historyAt = -1;
    this.refreshSuggestions();
    this.hooks.onOpen();
    window.setTimeout(() => this.inputEl.focus(), 0);
  }

  hide(): void {
    if (!this.open) return;
    this.open = false;
    this.root.classList.remove('open');
    this.inputEl.blur();
    this.hooks.onClose();
  }

  /** Print one line of output (kind colours the rule down its left edge). */
  print(text: string, kind: 'info' | 'ok' | 'err' = 'info'): void {
    for (const part of String(text).split('\n')) {
      const line = document.createElement('div');
      line.className = `chat-line${kind === 'info' ? '' : ` ${kind}`}`;
      setIconText(line, part);
      this.logEl.appendChild(line);
      window.setTimeout(() => {
        line.classList.add('faded');
        window.setTimeout(() => line.remove(), 800);
      }, LOG_TTL_MS);
    }
    while (this.logEl.childElementCount > LOG_MAX) this.logEl.firstElementChild?.remove();
  }

  private refreshSuggestions(): void {
    this.suggestions = suggestCommands(this.inputEl.value, this.hooks.isOp());
    if (this.selected >= this.suggestions.length) this.selected = 0;
    this.suggestEl.innerHTML = '';
    this.suggestions.forEach((spec, i) => {
      const row = document.createElement('div');
      row.className = `chat-sugg${i === this.selected ? ' sel' : ''}`;
      const name = document.createElement('b');
      name.textContent = commandLabel(spec);
      const desc = document.createElement('span');
      desc.textContent = spec.desc;
      row.append(name, desc);
      row.addEventListener('mousedown', (e) => {
        e.preventDefault(); // don't steal focus from the input
        this.selected = i;
        this.complete();
      });
      this.suggestEl.appendChild(row);
    });
    const sel = this.suggestEl.children[this.selected] as HTMLElement | undefined;
    sel?.scrollIntoView({ block: 'nearest' });
  }

  private moveSelection(delta: number): void {
    if (!this.suggestions.length) return;
    const n = this.suggestions.length;
    this.selected = (this.selected + delta + n) % n;
    this.refreshSuggestions();
  }

  /** Tab: fill in the highlighted command name, ready for its arguments. */
  private complete(): void {
    const spec = this.suggestions[this.selected];
    if (!spec) return;
    this.inputEl.value = spec.args ? `${spec.name} ` : spec.name;
    this.inputEl.focus();
    this.refreshSuggestions();
  }

  /** PageUp/PageDown walk the command history. */
  private recall(delta: number): void {
    if (!this.history.length) return;
    this.historyAt = Math.max(-1, Math.min(this.history.length - 1, this.historyAt + delta));
    this.inputEl.value = this.historyAt < 0 ? '' : this.history[this.historyAt];
    this.selected = 0;
    this.refreshSuggestions();
  }

  private submit(): void {
    const raw = this.inputEl.value.trim();
    this.inputEl.value = '';
    if (raw) {
      this.history.unshift(raw);
      while (this.history.length > HISTORY_MAX) this.history.pop();
      // Run BEFORE closing: a command that opens a panel (/map, /warfare) needs
      // the cursor, and onClose only hands it back to the game when no panel
      // took it — which it can only see once the command has run.
      this.run(raw);
    }
    this.hide();
  }

  /** Execute a command line (also reachable from buttons/tests). */
  run(raw: string): void {
    const { name, args } = parseCommand(raw);
    if (!name) return;
    this.print(`/${[name, ...args].join(' ')}`);
    if (PLAYER_COMMANDS.some((c) => c.name === name)) {
      const err = this.hooks.runLocal(name, args, raw);
      if (err) this.print(err, 'err');
      return;
    }
    // Anything else is an operator command: forwarded (the server re-checks OP)
    // — never broadcast as chat, because there is no chat to broadcast to.
    if (!this.hooks.isOp()) {
      this.print(`Unknown command "/${name}" — type /help for the list.`, 'err');
      return;
    }
    if (!this.hooks.sendAdmin(raw)) {
      this.print('Operator commands need a server connection.', 'err');
    }
  }

  /** The /help output, built from whichever lists apply to this player. */
  helpLines(): string[] {
    return commandList(this.hooks.isOp()).map((c) => `${commandLabel(c)} — ${c.desc}`);
  }
}
