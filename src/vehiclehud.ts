// VEHICLE HUD — the instrument strip shown across the top of the screen while
// you are strapped into an aircraft.
//
// A helicopter now drinks oil fast enough that running dry drops you out of the
// sky, so "how much fuel is left" is not a detail you should have to land and
// open a panel to discover: it is the single most important number in the game
// while you are airborne, and it lives at the top of the screen in a bar you
// cannot miss. Hull, ordnance, speed and altitude sit alongside it.
//
// Pure presentation over an authoritative snapshot — this reads state, never
// changes it.

import type { HelicopterSnapshot, SeatKind } from './vehicles';
import { iconSvg } from './emoji_icons';

/** Below this fraction of a full tank the gauge goes amber and pulses. */
const FUEL_WARN = 0.28;
/** Below this it goes red and the "BINGO FUEL" caption appears. */
const FUEL_CRITICAL = 0.12;

interface Gauge {
  wrap: HTMLDivElement;
  fill: HTMLDivElement;
  label: HTMLSpanElement;
  value: HTMLSpanElement;
}

/**
 * The seat's controls, in the corner, for as long as you are in that seat.
 *
 * Flying rebinds most of the game: WASD stops being walking, right-click stops
 * placing blocks and starts releasing ordnance, and F — a key that does nothing
 * on foot — is the only way out. None of that is guessable, and a notice that
 * scrolled past when you climbed in is no help ten minutes later, so the seat's
 * own bindings stay on screen the whole time you are strapped in.
 *
 * Each entry is [keys, what it does]; the two seats fly completely differently,
 * so each gets its own list rather than one list with caveats.
 */
const PILOT_CONTROLS: ReadonlyArray<readonly [string, string]> = [
  ['W / S', 'Fly forward / back'],
  ['A / D', 'Slide left / right'],
  ['Mouse', 'Steer / look (full vertical)'],
  ['Space', 'Climb'],
  ['Shift', 'Descend'],
  ['R', 'Deploy / retract rope'],
  ['R-click', 'Drop a bomb'],
  ['V', 'Cockpit ↔ chase cam'],
  ['F', 'Transfer to rope / step down'],
];

const GUNNER_CONTROLS: ReadonlyArray<readonly [string, string]> = [
  ['Mouse', 'Aim / orbit (full vertical)'],
  ['L-click', 'Fire your weapon'],
  ['R', 'Reload'],
  ['1 … 9', 'Switch weapon'],
  ['V', 'Cabin ↔ chase cam'],
  ['F', 'Transfer to rope / step down'],
];
const ROPE_CONTROLS: ReadonlyArray<readonly [string, string]> = [
  ['W / S', 'Climb / slide'],
  ['Space', 'Drop from rope'],
  ['Mouse', 'Look around'],
];

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K, css: string, parent?: HTMLElement,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.style.cssText = css;
  parent?.appendChild(node);
  return node;
}

export class VehicleHUD {
  private readonly root: HTMLDivElement;
  private readonly title: HTMLDivElement;
  private readonly role: HTMLSpanElement;
  private readonly fuel: Gauge;
  private readonly hull: Gauge;
  private readonly bombRow: HTMLDivElement;
  private readonly bombPips: HTMLDivElement[] = [];
  private readonly readout: HTMLDivElement;
  private readonly caption: HTMLDivElement;
  private readonly controls: HTMLDivElement;
  private readonly controlsTitle: HTMLDivElement;
  private readonly controlsBody: HTMLDivElement;
  private seat: SeatKind | 'rope' | null = null;
  private clock = 0;
  private lastBombCount = -1;

  constructor(parent: HTMLElement) {
    this.root = el('div', [
      'position:absolute;top:12px;left:50%;transform:translateX(-50%);z-index:12;',
      'display:none;flex-direction:column;gap:6px;align-items:stretch;',
      'min-width:340px;max-width:min(560px,86vw);padding:10px 14px 11px;',
      'border-radius:10px;border:2px solid rgba(92,226,236,0.35);',
      'background:linear-gradient(180deg,rgba(10,16,26,0.90),rgba(8,12,20,0.82));',
      'box-shadow:0 8px 28px rgba(0,0,0,0.5);pointer-events:none;',
      'color:#dce6f5;text-shadow:none;',
    ].join(''), parent);
    this.root.className = 'mc-font';

    const head = el('div', 'display:flex;align-items:baseline;gap:10px;font-size:11px;', this.root);
    this.title = el('div', 'flex:1;color:#5ce2ec;letter-spacing:1.6px;', head);
    this.role = el('span', 'color:#ffd24a;letter-spacing:1.2px;', head);

    this.fuel = this.gauge('OIL', '#4ad9a0');
    this.hull = this.gauge('HULL', '#8fb4ff');

    this.bombRow = el('div',
      'display:flex;align-items:center;gap:6px;font-size:10px;color:#7f93b3;', this.root);
    el('span', 'letter-spacing:1.2px;min-width:44px;', this.bombRow).textContent = 'BOMBS';

    this.readout = el('div',
      'display:flex;gap:14px;font-size:10px;color:#7f93b3;letter-spacing:0.6px;', this.root);
    this.caption = el('div',
      'font-size:11px;letter-spacing:1.2px;min-height:13px;color:#ff5c4d;', this.root);

    // --- Controls card, bottom-right, clear of the hotbar and the status bars ---
    this.controls = el('div', [
      'position:absolute;right:12px;z-index:12;',
      'bottom:calc(var(--hotbar-slot, 44px) + 18px + var(--safe-bottom, 0px));',
      'display:none;flex-direction:column;gap:5px;min-width:186px;',
      'padding:9px 11px 10px;border-radius:9px;',
      'border:2px solid rgba(92,226,236,0.28);',
      'background:linear-gradient(180deg,rgba(10,16,26,0.86),rgba(8,12,20,0.78));',
      'box-shadow:0 6px 22px rgba(0,0,0,0.45);pointer-events:none;',
      'color:#dce6f5;text-shadow:none;',
    ].join(''), parent);
    this.controls.className = 'mc-font';
    this.controlsTitle = el('div',
      'font-size:10px;letter-spacing:1.4px;color:#5ce2ec;', this.controls);
    this.controlsBody = el('div',
      'display:flex;flex-direction:column;gap:3px;', this.controls);
  }

  /** Repaint the corner card for whichever seat is occupied. */
  private buildControls(seat: SeatKind | 'rope'): void {
    this.controlsTitle.innerHTML = seat === 'pilot' ? `${iconSvg('heli')} PILOT CONTROLS`
      : seat === 'passenger' ? `${iconSvg('target')} GUNNER CONTROLS` : 'FAST ROPE';
    this.controlsBody.textContent = '';
    const controls = seat === 'pilot' ? PILOT_CONTROLS
      : seat === 'passenger' ? GUNNER_CONTROLS : ROPE_CONTROLS;
    for (const [keys, what] of controls) {
      const row = el('div',
        'display:flex;align-items:center;gap:8px;font-size:10px;', this.controlsBody);
      const chip = el('span', [
        'flex:0 0 auto;min-width:52px;text-align:center;padding:2px 5px;',
        'border-radius:4px;border:1px solid rgba(120,150,190,0.35);',
        'background:rgba(4,8,14,0.8);color:#ffd24a;letter-spacing:0.6px;',
      ].join(''), row);
      chip.textContent = keys;
      el('span', 'color:#a8b8ce;letter-spacing:0.4px;', row).textContent = what;
    }
  }

  private gauge(label: string, color: string): Gauge {
    const row = el('div', 'display:flex;align-items:center;gap:8px;', this.root);
    const name = el('span',
      `font-size:10px;letter-spacing:1.2px;color:#7f93b3;min-width:44px;`, row);
    name.textContent = label;
    const wrap = el('div', [
      'position:relative;flex:1;height:14px;border-radius:4px;overflow:hidden;',
      'background:rgba(4,8,14,0.85);border:1px solid rgba(120,150,190,0.30);',
    ].join(''), row);
    const fill = el('div', [
      `position:absolute;inset:0 auto 0 0;width:0%;background:${color};`,
      'transition:width 0.12s linear;',
    ].join(''), wrap);
    const value = el('span',
      'font-size:10px;color:#dce6f5;min-width:72px;text-align:right;', row);
    return { wrap, fill, label: name, value };
  }

  /** Enter/leave a seat. Passing null hides the whole strip. */
  setSeat(seat: SeatKind | null): void {
    const changed = seat !== this.seat;
    this.seat = seat;
    this.root.style.display = seat ? 'flex' : 'none';
    this.controls.style.display = seat ? 'flex' : 'none';
    if (seat && changed) this.buildControls(seat);
    if (!seat) this.lastBombCount = -1;
  }

  setRope(active: boolean): void {
    const next = active ? 'rope' as const : null;
    const changed = next !== this.seat;
    this.seat = next;
    this.root.style.display = active ? 'flex' : 'none';
    this.controls.style.display = active ? 'flex' : 'none';
    if (active && changed) this.buildControls('rope');
  }

  get active(): boolean { return this.seat !== null; }

  /**
   * Repaint from the authoritative snapshot. `speed`/`altitude` are derived by
   * the caller from the same snapshot stream, so nothing here can disagree with
   * what the aircraft is actually doing.
   */
  update(
    dt: number, snap: HelicopterSnapshot | null, speed: number, altitude: number,
    markLabel: string,
  ): void {
    if (!this.seat) return;
    if (!snap) {
      this.root.style.display = 'none';
      this.controls.style.display = 'none';
      return;
    }
    this.root.style.display = 'flex';
    this.controls.style.display = 'flex';
    this.clock += dt;

    this.title.innerHTML = `${iconSvg('heli')} ${markLabel} AIRFRAME`;
    this.role.textContent = this.seat === 'pilot' ? 'PILOT'
      : this.seat === 'passenger' ? 'GUNNER' : 'ROPE RIDER';

    // --- Oil ---
    const fuelFrac = snap.maxFuel > 0 ? Math.max(0, Math.min(1, snap.fuel / snap.maxFuel)) : 0;
    const critical = fuelFrac <= FUEL_CRITICAL;
    const warn = fuelFrac <= FUEL_WARN;
    // A pulsing bar is doing a job here: peripheral vision picks up motion long
    // before it picks up a colour change, and the pilot is looking outside.
    const pulse = critical ? 0.45 + 0.55 * Math.abs(Math.sin(this.clock * 6))
      : warn ? 0.72 + 0.28 * Math.abs(Math.sin(this.clock * 3)) : 1;
    this.fuel.fill.style.width = `${fuelFrac * 100}%`;
    this.fuel.fill.style.background = critical ? '#ff5c4d' : warn ? '#ffd24a' : '#4ad9a0';
    this.fuel.fill.style.opacity = String(pulse);
    this.fuel.value.textContent = `${snap.fuel.toFixed(1)} / ${snap.maxFuel}`;
    this.fuel.value.style.color = critical ? '#ff8a80' : warn ? '#ffd24a' : '#dce6f5';

    // --- Hull ---
    const hullFrac = snap.maxHp > 0 ? Math.max(0, Math.min(1, snap.hp / snap.maxHp)) : 0;
    this.hull.fill.style.width = `${hullFrac * 100}%`;
    this.hull.fill.style.background =
      hullFrac > 0.5 ? '#8fb4ff' : hullFrac > 0.25 ? '#ffd24a' : '#ff5c4d';
    this.hull.value.textContent = `${snap.hp} / ${snap.maxHp}`;

    // --- Bomb rack ---
    if (snap.maxBombs !== this.bombPips.length) {
      for (const pip of this.bombPips) pip.remove();
      this.bombPips.length = 0;
      for (let i = 0; i < snap.maxBombs; i++) {
        this.bombPips.push(el('div', [
          'width:11px;height:20px;border-radius:3px;',
          'border:1px solid rgba(120,150,190,0.4);',
        ].join(''), this.bombRow));
      }
    }
    if (snap.bombs !== this.lastBombCount) {
      this.lastBombCount = snap.bombs;
      this.bombPips.forEach((pip, i) => {
        pip.style.background = i < snap.bombs ? '#e6a83a' : 'rgba(10,16,26,0.7)';
      });
    }
    this.bombRow.style.display = snap.maxBombs > 0 ? 'flex' : 'none';

    // --- Flight readout ---
    this.readout.textContent =
      `SPD ${speed.toFixed(0)} b/s     ALT ${Math.max(0, altitude).toFixed(0)} b     ` +
      `CREW ${snap.pilot ? 'pilot' : '—'} · ${snap.passenger ? 'gunner' : '—'}`;

    // --- Caption: one line, the most urgent thing true right now ---
    // Nothing but the urgent thing: the bindings live on the corner card now,
    // so this line is free to stay silent until something is actually wrong.
    this.caption.innerHTML = critical
      ? `${iconSvg('fuel')} BINGO FUEL — LAND NOW`
      : warn ? `${iconSvg('fuel')} Low oil — head for the ground`
      : hullFrac <= 0.3 ? `${iconSvg('warning')} Hull critical`
      : '';
    this.caption.style.color = critical || hullFrac <= 0.3 ? '#ff5c4d'
      : warn ? '#ffd24a' : '#54637d';
  }

  dispose(): void { this.root.remove(); this.controls.remove(); }
}
