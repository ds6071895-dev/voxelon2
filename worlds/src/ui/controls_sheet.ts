// The Controls sheet (the small "Controls" link on the title screen, and the
// pause menu). Rebuilt from the live keybinds every time it opens, so it can
// never disagree with HUD Settings about which key does what.

import { keyLabel, type Keybinds } from '../hud_settings';
import { setIconText } from '../emoji_icons';

type Bind = [string, string[][], string?];
type Group = { title: string; binds: Bind[] };

function groups(k: Keybinds, touch: boolean): Group[] {
  if (touch) {
    return [
      { title: 'Moving', binds: [
        ['Move', [['left joystick']]], ['Sprint', [['left joystick']], 'push to the rim'],
        ['Jump', [['⬆']], 'hold'], ['Sneak', [['⇩']], 'toggle'],
      ] },
      { title: 'Fighting & building', binds: [
        ['Fire / attack / break', [['FIRE'], ['HIT'], ['BREAK']], 'drag to aim'], ['Place block / use', [['PLACE'], ['USE']]],
        ['Shoot the bow', [['SHOOT']], 'The Bridge'],
        ['Look around', [['drag the world']]], ['Quick use', [['tap the world']]],
        ['Aim down sights', [['AIM']], 'Duels'], ['Reload', [['R']], 'Duels'],
      ] },
      { title: 'Items', binds: [['Hotbar slot', [['tap a slot']]]] },
      { title: 'Screens', binds: [['Pause', [['⏸']]]] },
    ];
  }
  const move = [keyLabel(k.forward), keyLabel(k.left), keyLabel(k.back), keyLabel(k.right)];
  return [
    { title: 'Moving', binds: [
      ['Move', [move]],
      ['Sprint', [[keyLabel(k.sprint)], [keyLabel(k.forward), keyLabel(k.forward)]], 'double-tap'],
      ['Jump', [[keyLabel(k.jump)]]], ['Sneak', [[keyLabel(k.sneak)]], "won't walk off edges"],
    ] },
    { title: 'Fighting & building', binds: [
      ['Attack / break block', [['Left click']]], ['Place block / use item', [['Right click']]],
      ['Aim down sights', [['Right click']], 'hold, with the rifle (Duels)'],
      ['Reload', [[keyLabel(k.reload)]], 'Duels'],
      ['Shoot the bow', [['Right click']], 'The Bridge'],
    ] },
    { title: 'Items', binds: [['Hotbar slot', [['1'], ['9'], ['scroll']]]] },
    { title: 'Screens', binds: [
      ['Scoreboard', [['Tab']], 'hold, in Duels'],
      ['Camera view (1st / 3rd)', [[keyLabel(k.view)]]],
      ['Zoom', [[keyLabel(k.zoom)]], 'hold; scroll to change the magnification'],
      ['Debug overlay', [['F3']]], ['Pause', [['Esc']]],
    ] },
  ];
}

export class ControlsSheet {
  private readonly panel = document.createElement('div');
  private readonly body = document.createElement('div');

  constructor(host: HTMLElement, private readonly binds: () => Keybinds, private readonly touch: boolean,
    private readonly onClose?: () => void) {
    this.panel.className = 'sheet-scrim';
    const card = document.createElement('div');
    card.className = 'sheet-card mc-font';
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-modal', 'true');
    card.setAttribute('aria-label', 'Controls');
    const head = document.createElement('div');
    head.className = 'sheet-head';
    const eyebrow = document.createElement('div');
    eyebrow.className = 'sheet-eyebrow';
    eyebrow.textContent = touch ? 'Touch controls' : 'Keyboard & mouse';
    const title = document.createElement('h2');
    title.className = 'sheet-title';
    title.textContent = 'Controls';
    head.append(eyebrow, title);
    this.body.className = 'sheet-body';
    const back = document.createElement('button');
    back.className = 'mc-btn sheet-close';
    back.textContent = 'Back';
    back.addEventListener('click', () => this.hide());
    card.append(head, this.body, back);
    this.panel.appendChild(card);
    this.panel.addEventListener('click', (e) => { if (e.target === this.panel) this.hide(); });
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.open) { e.stopPropagation(); e.preventDefault(); this.hide(); }
    }, true);
    host.appendChild(this.panel);
  }

  get open(): boolean { return this.panel.style.display === 'flex'; }

  show(): void {
    this.render();
    this.panel.style.display = 'flex';
  }
  hide(): void {
    if (!this.open) return;
    this.panel.style.display = 'none';
    this.onClose?.();
  }

  private render(): void {
    this.body.textContent = '';
    for (const group of groups(this.binds(), this.touch)) {
      const section = document.createElement('section');
      section.className = 'keygroup';
      const label = document.createElement('h3');
      label.className = 'keygroup-title';
      label.textContent = group.title;
      section.appendChild(label);
      for (const [action, alternatives, hint] of group.binds) {
        const row = document.createElement('div');
        row.className = 'keyrow';
        const name = document.createElement('span');
        name.className = 'keyrow-action';
        name.textContent = action;
        const chips = document.createElement('span');
        chips.className = 'keyrow-keys';
        alternatives.forEach((combo, i) => {
          if (i > 0) {
            const sep = document.createElement('i');
            sep.className = 'keyrow-sep';
            sep.textContent = 'or';
            chips.appendChild(sep);
          }
          const set = document.createElement('span');
          set.className = 'keyrow-combo';
          for (const key of combo) {
            const chip = document.createElement('kbd');
            setIconText(chip, key);
            set.appendChild(chip);
          }
          chips.appendChild(set);
        });
        if (hint) {
          const note = document.createElement('i');
          note.className = 'keyrow-hint';
          setIconText(note, hint);
          chips.appendChild(note);
        }
        row.append(name, chips);
        section.appendChild(row);
      }
      this.body.appendChild(section);
    }
  }
}
