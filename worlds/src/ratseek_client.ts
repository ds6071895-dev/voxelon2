// Rat and Seek on the client: the HUD (boss bar, scoreboard, titles, action
// bar, match messages, the seeker's compass), the class picker, the party
// leader's seeker picker, the results podium, the intro fly-over, status
// effects on your own body and screen, and every prop the server tracks
// (cheese, decoys, Mr. Whiskers, chandeliers, flashlight beams).
// Everything here only SHOWS the match; the server decides it.

import * as THREE from 'three';
import type { GameAudio } from './audio';
import { Block } from './blocks';
import { renderItemIcon } from './icons';
import { seeThrough } from './ratseek_nav';
import { Item } from './items';
import type { NetClient } from './net/client';
import type { PartyState } from './net/protocol';
import type { Particles } from './particles';
import type { Player } from './player';
import type { BodyStyle, RemotePlayers } from './remoteplayers';
import { RS_BOUNDS, RS_KEEPER } from './ratseek_house';
import {
  createBeam, createCatModel, createChandelierModel, createCheeseModel, createRatModel, labelSprite,
  type CatModel, type RatModel,
} from './ratseek_models';
import {
  RAT_CLASSES, RAT_CLASS_IDS, RS, isRatClass, type RatClassId, type RsEffects, type RsResult, type RsRole,
  type RsSnapshot, type RsSound,
} from './ratseek_rules';
import type { World } from './world';

const CLASS_KEY = 'worlds.ratClass';
/** The manor is lit like a lived-in house: every room at full daylight, as
 *  bright as a lamp-lit Minecraft room. Night vision has nothing to add. */
const MANOR_AMBIENT = 1;
const NIGHT_VISION_AMBIENT = 1;
/** How long a scamper's burst of speed lasts on your screen and legs. */
const DASH_MS = 420;

export function storedRatClass(): RatClassId | undefined {
  try { const v = localStorage.getItem(CLASS_KEY); return isRatClass(v) ? v : undefined; } catch { return undefined; }
}
function storeRatClass(cls: RatClassId): void { try { localStorage.setItem(CLASS_KEY, cls); } catch { /* optional */ } }

interface Deps {
  scene: THREE.Scene;
  app: HTMLElement;
  net: NetClient;
  audio: GameAudio;
  particles: Particles;
  player: Player;
  world: World;
  remotePlayers: RemotePlayers;
  atlasCanvas: HTMLCanvasElement;
  /** A pointer-holding panel opened or closed. */
  onPanel(): void;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent?: HTMLElement): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  parent?.appendChild(e);
  return e;
}
function fmt(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export class RatSeekClient {
  active = false;
  role: RsRole = 'rat';
  snap: RsSnapshot | null = null;
  private clockServer = 0;
  private clockLocal = 0;
  private fx: RsEffects = { speed: 1, jump: 0, blind: false, dark: false, nausea: false, night: false, scale: 1 };
  private readonly root: HTMLElement;
  private readonly bossTitle: HTMLElement;
  private readonly bossTime: HTMLElement;
  private readonly bossFill: HTMLElement;
  private readonly boss: HTMLElement;
  private readonly pills: HTMLElement;
  private readonly sidebar: HTMLElement;
  private readonly pocket: HTMLElement;
  private readonly titleEl: HTMLElement;
  private readonly titleMain: HTMLElement;
  private readonly titleSub: HTMLElement;
  private titleUntil = 0;
  private readonly barEl: HTMLElement;
  private barUntil = 0;
  private readonly feed: HTMLElement;
  private readonly compassEl: HTMLElement;
  private readonly compassArrow: HTMLElement;
  private readonly compassText: HTMLElement;
  private readonly blindEl: HTMLElement;
  private readonly darkEl: HTMLElement;
  private readonly letterbox: HTMLElement;
  /** Speed lines around the screen edge while scampering. */
  private readonly dashEl: HTMLElement;
  /** Set from the accessibility setting: no speed lines or view stretch. */
  reducedMotion = false;
  private readonly picker: HTMLElement;
  private readonly pickerCards = new Map<RatClassId, HTMLButtonElement>();
  pickerOpen = false;
  private result: RsResult | null = null;
  // Props.
  private readonly group = new THREE.Group();
  private readonly cheese = new Map<number, { mesh: THREE.Group; x: number; y: number; z: number }>();
  private readonly decoys = new Map<number, { model: RatModel; x: number; y: number; z: number; tx: number; tz: number; yaw: number; phase: number }>();
  private cat: {
    model: CatModel; x: number; y: number; z: number; yaw: number; tx: number; ty: number; tz: number; tyaw: number;
    /** Velocity estimated from snapshots, the time the last one landed, and a smoothed ground speed. */
    vx: number; vz: number; at: number; speed: number;
  } | null = null;
  private readonly chandeliers: { mesh: THREE.Group; drop: number; target: number; shake: boolean }[] = [];
  private readonly beams = new Map<number, THREE.Mesh>();
  private exchangeLabel: THREE.Sprite | null = null;
  private selfRat: RatModel | null = null;
  private selfPhase = 0;
  private flairT = 0;
  private lastNight = false;

  constructor(private readonly d: Deps) {
    this.root = el('div', 'rs-hud', d.app);
    this.root.hidden = true;
    // Top centre, laid out like the Duels clock: phase label, big clock,
    // a draining hairline, and a row of status pills underneath.
    const top = el('div', 'rs-top', this.root);
    this.boss = el('div', 'rs-clock', top);
    this.bossTitle = el('small', '', this.boss);
    this.bossTime = el('strong', '', this.boss);
    const bar = el('div', 'rs-clock-bar', this.boss);
    this.bossFill = el('i', '', bar);
    this.pills = el('div', 'rs-pills', top);
    this.compassEl = el('div', 'rs-compass', top);
    this.compassArrow = el('b', '', this.compassEl);
    this.compassArrow.textContent = '▲';
    this.compassText = el('span', '', this.compassEl);
    this.sidebar = el('div', 'rs-sidebar', this.root);
    this.pocket = el('div', 'rs-pocket', this.root);
    this.titleEl = el('div', 'rs-title', this.root);
    this.titleMain = el('b', '', this.titleEl);
    this.titleSub = el('small', '', this.titleEl);
    this.barEl = el('div', 'rs-actionbar', this.root);
    this.feed = el('div', 'rs-feed', this.root);
    this.blindEl = el('div', 'rs-blind', d.app);
    this.darkEl = el('div', 'rs-dark', d.app);
    this.letterbox = el('div', 'rs-letterbox', d.app);
    el('i', '', this.letterbox); el('i', '', this.letterbox);
    this.dashEl = el('div', 'rs-dash', d.app);
    const mask = 'radial-gradient(ellipse at center, transparent 42%, #000 92%)';
    Object.assign(this.dashEl.style, {
      position: 'fixed', inset: '0', pointerEvents: 'none', opacity: '0', zIndex: '4',
      background: 'repeating-conic-gradient(from 0deg, rgba(255,255,255,0) 0deg 3.2deg, rgba(255,255,255,0.34) 3.2deg 4deg)',
      webkitMaskImage: mask, maskImage: mask,
    });

    // The class picker (the plugin's chest menu, as a card sheet).
    this.picker = el('div', 'rs-picker', d.app);
    this.picker.setAttribute('role', 'dialog');
    this.picker.setAttribute('aria-label', 'Choose your rat class');
    const sheet = el('div', 'rs-picker-sheet', this.picker);
    const head = el('div', 'rs-picker-head', sheet);
    el('h2', '', head).textContent = 'Choose your rat';
    el('p', '', head).textContent = 'Your pick is remembered for your next game. No pick? You get the least popular class when the hunt starts.';
    const cards = el('div', 'rs-picker-cards', sheet);
    for (const id of RAT_CLASS_IDS) {
      const info = RAT_CLASSES[id];
      const card = el('button', 'rs-class', cards);
      card.type = 'button';
      card.style.setProperty('--tone', info.color);
      const icon = el('canvas', 'rs-class-icon', card);
      icon.width = 32; icon.height = 32;
      renderItemIcon(icon, d.atlasCanvas, info.badge);
      el('b', '', card).textContent = info.name;
      el('span', 'rs-class-passive', card).textContent = info.passive;
      el('span', 'rs-class-ability', card).textContent = `${info.ability} — ${info.abilityDescription} (${info.cooldownTicks / 20}s)`;
      el('small', 'rs-class-count', card);
      card.addEventListener('click', () => this.pick(id));
      this.pickerCards.set(id, card);
    }
    const done = el('button', 'rs-picker-done', sheet);
    done.type = 'button';
    done.textContent = 'Done';
    done.addEventListener('click', () => this.closePicker());
    this.picker.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); this.closePicker(); } });

    d.scene.add(this.group);
    this.group.visible = false;
  }

  now(): number { return this.clockServer + performance.now() - this.clockLocal; }
  phase(): RsSnapshot['phase'] { return this.snap?.phase ?? 'loading'; }
  selfIsRat(): boolean { return this.active && this.role === 'rat'; }
  /** The host's "Who seeks?" pick is open until the hunt begins. */
  canPickSeeker(): boolean { const ph = this.phase(); return this.active && (ph === 'intro' || ph === 'hiding'); }
  /** Which of `people` is seeking now, or 0 when the AI seeker is. */
  snapshotSeeker(people: readonly number[]): number {
    return this.snap?.players.find((p) => p.role === 'human' && people.includes(p.id))?.id ?? 0;
  }

  // ── Entering and leaving ────────────────────────────────────────────────

  enter(role: RsRole): void {
    this.exitVisuals();
    this.active = true;
    this.role = role;
    this.snap = null;
    this.result = null;
    this.root.hidden = false;
    this.group.visible = true;
    this.feed.replaceChildren();
    this.root.dataset.role = role;
    this.d.world.setArenaRenderBounds(RS_BOUNDS, MANOR_AMBIENT);
    this.lastNight = false;
    this.exchangeLabel = labelSprite(`Cheese Exchange\nRight-click: Free a Rat / Bank Escape · ${RS.RESCUE_COST} Cheese`);
    this.exchangeLabel.position.set(RS_KEEPER.x + 0.5, RS_KEEPER.y + 2.65,RS_KEEPER.z + 0.5);
    this.group.add(this.exchangeLabel);
    for (let i = 0; i < 4; i++) {
      const mesh = createChandelierModel();
      mesh.visible = false;
      this.group.add(mesh);
      this.chandeliers.push({ mesh, drop: 0, target: -1, shake: false });
    }
    this.applyFx({ speed: 1, jump: 0, blind: false, dark: false, nausea: false, night: false, scale: role === 'rat' ? RS.RAT_SCALE : 1 });
    this.d.remotePlayers.styleOf = (id) => this.styleOf(id);
  }

  exit(): void {
    this.active = false;
    this.root.hidden = true;
    this.closePicker();
    this.blindEl.style.opacity = '0';
    this.darkEl.style.opacity = '0';
    this.dashEl.style.opacity = '0';
    this.dash = null;
    this.snap = null;
    // renderCooldowns only runs while a round is live, so the sweeps it left on
    // the hotbar would otherwise survive into the next screen.
    document.querySelectorAll<HTMLElement>('#hotbar .slot').forEach((slot) => {
      const cd = slot.children[2] as HTMLElement | undefined;
      if (cd) cd.style.height = '0';
    });
    this.letterbox.classList.remove('on');
    this.exitVisuals();
    this.group.visible = false;
    this.d.remotePlayers.styleOf = null;
    this.d.player.setBodyScale(1);
    this.d.player.speedMult = 1;
    this.d.player.jumpBoost = 0;
    this.fx = { speed: 1, jump: 0, blind: false, dark: false, nausea: false, night: false, scale: 1 };
  }

  private exitVisuals(): void {
    for (const c of this.cheese.values()) this.group.remove(c.mesh);
    this.cheese.clear();
    for (const dcy of this.decoys.values()) { this.group.remove(dcy.model.group); dcy.model.dispose(); }
    this.decoys.clear();
    if (this.cat) { this.group.remove(this.cat.model.group); this.cat = null; }
    for (const c of this.chandeliers) this.group.remove(c.mesh);
    this.chandeliers.length = 0;
    for (const b of this.beams.values()) this.group.remove(b);
    this.beams.clear();
    if (this.exchangeLabel) { this.group.remove(this.exchangeLabel); this.exchangeLabel = null; }
    if (this.selfRat) { this.group.remove(this.selfRat.group); this.selfRat.dispose(); this.selfRat = null; }
  }

  // ── Server messages ─────────────────────────────────────────────────────

  onState(s: RsSnapshot): void {
    const was = this.snap?.phase;
    this.snap = s;
    this.clockServer = s.serverNow;
    this.clockLocal = performance.now();
    const me = s.players.find((p) => p.id === this.d.net.myId);
    if (me) this.role = me.role;
    this.root.dataset.role = this.role;
    if ((was !== s.phase && s.phase === 'hunting') || this.role !== 'rat') this.closePicker();
    this.syncProps(s);
    this.renderSidebar();
    if (this.pickerOpen) this.renderPicker();
  }

  applyFx(fx: RsEffects): void {
    this.fx = fx;
    const p = this.d.player;
    p.setBodyScale(fx.scale);
    // Vanilla pace times the effect: a rat runs Speed I (1.2x), a seeker 1.56x.
    p.speedMult = fx.speed;
    p.jumpBoost = fx.jump;
    if (fx.night !== this.lastNight) {
      this.lastNight = fx.night;
      this.d.world.setArenaRenderBounds(RS_BOUNDS, fx.night ? NIGHT_VISION_AMBIENT : MANOR_AMBIENT);
    }
  }

  title(title: string, sub: string, color: string, ms: number): void {
    this.titleMain.textContent = title;
    this.titleEl.style.setProperty('--tone', color);
    this.titleSub.textContent = sub;
    this.titleEl.classList.remove('show');
    void this.titleEl.offsetWidth;
    this.titleEl.classList.add('show');
    this.titleUntil = performance.now() + ms;
  }
  bar(text: string, color: string): void {
    this.barEl.textContent = text;
    this.barEl.style.setProperty('--tone', color);
    this.barEl.classList.add('show');
    this.barUntil = performance.now() + 2600;
  }
  message(text: string, color: string): void {
    const row = el('div', 'rs-feed-row', this.feed);
    row.style.setProperty('--tone', color);
    // "TWIST: CHEESE RAIN! …" → a tag chip plus the sentence.
    const tag = /^([A-Z][A-Z' ]+[A-Z])[:!]\s+(.*)$/.exec(text);
    if (tag) { el('b', '', row).textContent = tag[1]; el('span', '', row).textContent = tag[2]; }
    else el('span', '', row).textContent = text;
    while (this.feed.childElementCount > 6) this.feed.firstElementChild!.remove();
    window.setTimeout(() => row.classList.add('fade'), 9000);
    window.setTimeout(() => row.remove(), 10000);
  }
  sound(kind: RsSound, at: { x: number; y: number; z: number } | null): void {
    const pos = at ? new THREE.Vector3(at.x, at.y + 0.3, at.z) : undefined;
    this.d.audio.rsCue(kind, pos);
    if (!at) return;
    const P = this.d.particles;
    const burst = (n: number, color: number, speed: number, life: number, spread = 0.5, scale = 0.5): void =>
      P.burst(at.x, at.y + 0.4, at.z, n, color, speed, life, { gravity: 3, spread, scale });
    switch (kind) {
      case 'poof': case 'decoy': burst(14, 0xe8e8e8, 1.6, 0.6, 0.6); break;
      case 'snap': burst(18, 0xfff2b0, 3, 0.4, 0.3, 0.35); break;
      case 'cage': burst(22, 0xd8d8e0, 2, 0.7, 0.8); break;
      case 'rescue': case 'escape': burst(30, 0x7dffa2, 3.2, 0.9, 1.2, 0.6); burst(14, 0xffd35a, 2.4, 0.8, 1); break;
      case 'squeak': burst(12, 0xf07ab8, 1.8, 0.8, 0.5, 0.45); break;
      case 'cheese': burst(10, 0xffd35a, 1.4, 0.6, 0.4, 0.4); break;
      case 'crash': burst(40, 0xd8a52e, 4, 0.9, 2.2, 0.55); burst(12, 0xffffff, 3, 0.4, 1.5); break;
      case 'sniff': burst(18, 0xbfe8a8, 1.2, 0.9, 1.2, 0.4); break;
      case 'pounce': burst(8, 0xff5555, 1.6, 0.6, 0.4, 0.5); break;
      case 'dash': burst(22, 0xf2f2f2, 2.4, 0.5, 0.5, 0.45); burst(8, 0xffe9a8, 3.2, 0.3, 0.25, 0.3); break;
      case 'rattle': burst(30, 0xfff27a, 3.5, 0.6, 2.4, 0.35); break;
      default:
    }
  }
  impulse(vx: number, vy: number, vz: number, momentum: number): void {
    const p = this.d.player;
    p.vel.set(vx, vy, vz);
    if (vy > 0) p.onGround = false;
    p.momentumTime = momentum;
    const top = Math.hypot(vx, vz);
    // A scamper: hold the burst on the ground too, instead of letting friction eat it.
    this.dash = top > 8 ? { start: performance.now(), dx: vx / top, dz: vz / top, top, puff: 0 } : null;
  }

  // ── Scamper ─────────────────────────────────────────────────────────────

  private dash: { start: number; dx: number; dz: number; top: number; puff: number } | null = null;
  /** How far through the scamper we are: 0 at the launch, 1 when it has run out. */
  private dashProgress(): number { return this.dash ? Math.min(1, (performance.now() - this.dash.start) / DASH_MS) : 1; }
  /** Call just before the player moves each frame: the burst keeps its speed on the
   *  ground, eases off as it ends, and can be steered a little with the mouse. */
  steerDash(dt: number): void {
    const d = this.dash;
    if (!d) return;
    const p = this.d.player, k = this.dashProgress();
    if (k >= 1 || this.phase() !== 'hunting') { this.dash = null; return; }
    const turn = Math.atan2(-Math.sin(p.yaw), -Math.cos(p.yaw)) - Math.atan2(d.dx, d.dz);
    const wrapped = Math.atan2(Math.sin(turn), Math.cos(turn));
    const a = Math.atan2(d.dx, d.dz) + Math.max(-2.4 * dt, Math.min(2.4 * dt, wrapped));
    d.dx = Math.sin(a); d.dz = Math.cos(a);
    const speed = d.top * (1 - 0.55 * k * k);
    p.vel.x = d.dx * speed;
    p.vel.z = d.dz * speed;
    p.momentumTime = Math.max(p.momentumTime, 0.1);
  }
  /** Per-frame flair: speed lines, a widening view and a trail of dust. */
  private dashFlair(dt: number): void {
    const d = this.dash;
    const k = this.dashProgress();
    const power = d && k < 1 ? Math.sin((1 - k) * Math.PI / 2) : 0;
    this.dashEl.style.opacity = this.reducedMotion ? '0' : (power * 0.85).toFixed(2);
    if (!d || k >= 1) return;
    d.puff -= dt;
    if (d.puff <= 0) {
      d.puff = 0.045;
      const p = this.d.player.pos;
      this.d.particles.burst(p.x, p.y + 0.08, p.z, 2, 0xe8e4da, 0.7, 0.4, { gravity: -0.4, spread: 0.3, scale: 0.34 });
    }
  }
  /** Extra field of view (degrees) to add while scampering; 0 when not. */
  dashFov(): number {
    return this.dash ? 11 * Math.sin((1 - this.dashProgress()) * Math.PI / 2) : 0;
  }
  /** The round is over; the podium itself is staged by the server. */
  noteResult(r: RsResult): void {
    this.result = r;
    this.closePicker();
  }

  // ── Bodies ──────────────────────────────────────────────────────────────

  styleOf(id: number): BodyStyle | null {
    const v = this.snap?.players.find((p) => p.id === id);
    if (!v) return null;
    return { rat: v.role === 'rat', caged: v.caged, glow: v.glow && !v.caged, hidden: v.hidden, tag: v.role === 'human' };
  }
  /** Decoys receive the same assistance as rats, so aiming cannot identify them. */
  decoyAimPoints(): THREE.Vector3[] {
    return [...this.decoys.values()].map(d => new THREE.Vector3(d.x, d.y + .3, d.z));
  }

  /** A remote body the crosshair is on that a seeker may swat: a free rat or a decoy. */
  targetUnderCrosshair(eye: THREE.Vector3, dir: THREE.Vector3, reach: number): { id: number; decoy: boolean } | null {
    let best: { id: number; decoy: boolean } | null = null, bestT = reach;
    const id = this.d.remotePlayers.rayHit(eye, dir, reach);
    if (id >= 0) {
      const v = this.snap?.players.find((p) => p.id === id);
      const body = this.d.remotePlayers.renderedPos(id);
      if (v?.role === 'rat' && !v.caged && body) {
        best = { id, decoy: false };
        bestT = eye.distanceTo(body);
      }
    }
    for (const [did, dcy] of this.decoys) {
      const t = rayBox(eye, dir, dcy.x - 0.25, dcy.y, dcy.z - 0.25, dcy.x + 0.25, dcy.y + 0.55, dcy.z + 0.25);
      if (t !== null && t < bestT) { bestT = t; best = { id: did, decoy: true }; }
    }
    return best;
  }

  /** The Cheese Exchange when the crosshair is on or near it and nothing solid is in between,
   *  as the block a right-click should be sent for. A small aim cone, so a click that lands a
   *  little off the machine (or on its price board) still works. */
  exchangeAim(eye: THREE.Vector3, dir: THREE.Vector3, hit: { x: number; y: number; z: number } | null): { x: number; y: number; z: number; nx: number; ny: number; nz: number } | null {
    if (!this.active) return null;
    const c = new THREE.Vector3(RS_KEEPER.x + 0.5, RS_KEEPER.y + 1, RS_KEEPER.z + 0.5);
    const to = c.clone().sub(eye);
    const dist = to.length();
    if (dist > 5.5 || dist < 0.05 || to.divideScalar(dist).dot(dir) < 0.93) return null;
    // A block the ray hits well before the machine is in the way (unless it IS the machine).
    if (hit && !(hit.x === RS_KEEPER.x && hit.z === RS_KEEPER.z)
      && Math.hypot(hit.x + 0.5 - eye.x, hit.y + 0.5 - eye.y, hit.z + 0.5 - eye.z) < dist - 1.2) return null;
    return { x: RS_KEEPER.x, y: RS_KEEPER.y, z: RS_KEEPER.z, nx: 0, ny: 1, nz: 0 };
  }

  // ── Class picker ────────────────────────────────────────────────────────

  canPickClass(): boolean {
    const ph = this.phase();
    return this.active && this.role === 'rat' && (ph === 'loading' || ph === 'intro' || ph === 'hiding');
  }
  openPicker(): void {
    if (!this.canPickClass() || this.pickerOpen) return;
    this.pickerOpen = true;
    this.picker.classList.add('open');
    this.renderPicker();
    this.d.onPanel();
    window.setTimeout(() => this.pickerCards.get(this.snap?.me.cls ?? 'scout')?.focus(), 30);
  }
  closePicker(): void {
    if (!this.pickerOpen) return;
    this.pickerOpen = false;
    this.picker.classList.remove('open');
    this.d.onPanel();
  }
  private pick(cls: RatClassId): void {
    const s = this.snap;
    if (!s) return;
    const count = s.classCounts[cls] ?? 0;
    if (s.me.cls !== cls && count >= s.classCap) { this.d.audio.rsCue('click'); return; }
    storeRatClass(cls);
    this.d.net.sendRsClass(cls);
    this.d.audio.rsCue('squeak');
  }
  private renderPicker(): void {
    const s = this.snap;
    for (const [id, card] of this.pickerCards) {
      const count = s?.classCounts[id] ?? 0, cap = s?.classCap ?? 1;
      const mine = s?.me.cls === id;
      const full = !mine && count >= cap;
      card.classList.toggle('selected', mine);
      card.classList.toggle('full', full);
      card.setAttribute('aria-pressed', mine ? 'true' : 'false');
      card.querySelector('.rs-class-count')!.textContent = mine ? '✔ Your class' : full ? 'Class is full' : `Picked ${count}/${cap}`;
    }
  }

  // ── Per frame ───────────────────────────────────────────────────────────

  /** Movement is frozen while the manor loads and during the intro. */
  frozen(): boolean {
    const ph = this.phase();
    return ph === 'loading' || ph === 'intro' || this.pickerOpen;
  }

  frame(dt: number, playerYaw: number, eye: THREE.Vector3, lookDir: THREE.Vector3, thirdPerson: boolean): void {
    if (!this.active) return;
    const now = performance.now(), t = now / 1000;
    if (this.titleUntil && now > this.titleUntil) { this.titleEl.classList.remove('show'); this.titleUntil = 0; }
    if (this.barUntil && now > this.barUntil) { this.barEl.classList.remove('show'); this.barUntil = 0; }
    this.renderBoss();
    this.renderCompass(playerYaw);
    this.dashFlair(dt);
    this.blindEl.style.opacity = this.fx.blind ? '1' : '0';
    this.darkEl.style.opacity = this.fx.dark ? String(0.78 + Math.sin(t * 2.2) * 0.12) : '0';
    this.letterbox.classList.toggle('on', this.phase() === 'intro');
    // Props: glide toward their networked positions.
    const k = 1 - Math.exp(-dt * 12);
    for (const c of this.cheese.values()) {
      c.mesh.position.x += (c.x - c.mesh.position.x) * k;
      c.mesh.position.z += (c.z - c.mesh.position.z) * k;
      c.mesh.position.y = c.y + 0.12 + Math.sin(t * 2 + c.x) * 0.04;
      c.mesh.rotation.y += dt * 0.9;
    }
    for (const dcy of this.decoys.values()) {
      const dx = dcy.tx - dcy.x, dz = dcy.tz - dcy.z;
      dcy.x += dx * k; dcy.z += dz * k;
      dcy.phase += dt * 9;
      dcy.model.group.position.set(dcy.x, dcy.y + (Math.floor(dcy.phase) % 2 ? 0.04 : 0), dcy.z);
      dcy.model.group.rotation.y = dcy.yaw;
      dcy.model.pose(5, dcy.phase, t);
    }
    if (this.cat) {
      const c = this.cat, prevX = c.x, prevZ = c.z;
      // Dead-reckon along the estimated velocity between 10 Hz snapshots, then
      // glide onto that moving point: a steady walk instead of a hop every 100 ms.
      const ahead = Math.min(0.2, (now - c.at) / 1000);
      const kc = 1 - Math.exp(-dt * 10);
      c.x += (c.tx + c.vx * ahead - c.x) * kc;
      c.z += (c.tz + c.vz * ahead - c.z) * kc;
      c.y += (c.ty - c.y) * kc;
      let dy = c.tyaw - c.yaw;
      while (dy > Math.PI) dy -= Math.PI * 2;
      while (dy < -Math.PI) dy += Math.PI * 2;
      c.yaw += dy * (1 - Math.exp(-dt * 9));
      c.model.group.position.set(c.x, c.y, c.z);
      c.model.group.rotation.y = c.yaw;
      c.speed += (Math.hypot(c.x - prevX, c.z - prevZ) / Math.max(dt, 1e-3) - c.speed) * (1 - Math.exp(-dt * 8));
      c.model.update(!!this.snap?.cat?.sit, this.snap?.cat?.sit ? 0 : c.speed, t, !!this.snap?.cat?.pounce);
    }
    for (const ch of this.chandeliers) {
      if (ch.target < 0) { ch.mesh.visible = false; continue; }
      ch.mesh.visible = true;
      ch.drop += (ch.target - ch.drop) * (ch.target > ch.drop ? 0.5 : 0.08);
      const base = ch.mesh.userData.hangY as number;
      ch.mesh.position.y = base - ch.drop * 3.6;
      ch.mesh.rotation.z = ch.shake ? Math.sin(t * 40) * 0.05 : 0;
    }
    this.updateBeams(eye, lookDir);
    this.flairT -= dt;
    if (this.flairT <= 0 && this.snap) {
      this.flairT = 0.25;
      const P = this.d.particles;
      for (const p of this.snap.players) {
        if (!p.trail || p.id === this.d.net.myId) continue;
        const at = this.d.remotePlayers.renderedPos(p.id);
        if (at) P.burst(at.x, at.y + 0.2, at.z, 2, 0xffc83d, 0.6, 0.5, { gravity: 1, spread: 0.2, scale: 0.3 });
      }
      if (Math.floor(t * 4) % 8 === 0) {
        for (const c of this.cheese.values()) P.burst(c.x, c.y + 0.35, c.z, 1, 0xffe27a, 0.4, 0.6, { gravity: -0.5, spread: 0.3, scale: 0.25 });
        for (const s of this.snap.sparkles) P.burst(s.x, s.y, s.z, 3, s.bait ? 0xff9a1f : 0xff3030, 0.5, 0.6, { gravity: 0, spread: 0.3, scale: 0.35 });
      }
      if (this.snap.cat?.pounce && this.cat) P.burst(this.cat.x, this.cat.y + 0.6, this.cat.z, 3, 0xff4d4d, 1, 0.5, { gravity: 1, spread: 0.4, scale: 0.4 });
    }
    // Your own body in third person.
    const p = this.d.player;
    if (this.role === 'rat' && thirdPerson) {
      if (!this.selfRat) { this.selfRat = createRatModel(false); this.group.add(this.selfRat.group); }
      const me = this.snap?.players.find((v) => v.id === this.d.net.myId);
      this.selfRat.group.visible = true;
      this.selfRat.group.position.copy(p.pos);
      this.selfRat.group.rotation.y = p.yaw;
      this.selfRat.setCaged(!!me?.caged);
      this.selfRat.setGlow(false);
      const speed = Math.hypot(p.vel.x, p.vel.z);
      this.selfPhase += Math.min(speed, 7) * dt * 2.4;
      this.selfRat.pose(speed, this.selfPhase, t);
    } else if (this.selfRat) this.selfRat.group.visible = false;
  }

  /** The camera wobble of the decoy daze. */
  nausea(): number { return this.fx.nausea ? Math.sin(performance.now() / 380) * 0.12 : 0; }
  /** Fog while blindfolded or in a blackout. */
  fog(): { near: number; far: number } | null {
    if (this.fx.blind) return { near: 0.1, far: 3 };
    if (this.fx.dark) return { near: 1, far: 9 };
    return null;
  }

  /** The intro: a slow fly-around of the manor. Returns false when not in it. */
  introCamera(camera: THREE.Camera): boolean {
    if (!this.active || this.phase() !== 'intro' || !this.snap) return false;
    const left = Math.max(0, this.snap.endsAt - this.now());
    const p = 1 - left / Math.max(1, this.snap.phaseMs);
    const a = -0.8 + p * 1.6;
    const r = 46 - p * 12;
    camera.position.set(Math.sin(a) * r + 4, 104 - p * 10, Math.cos(a) * r + 6);
    camera.lookAt(2, 90, 2);
    return true;
  }

  // ── HUD ─────────────────────────────────────────────────────────────────

  private renderBoss(): void {
    const s = this.snap;
    let label = '', time = '', tone = 'hunt', frac = 1;
    if (!s) { label = 'Rat and Seek'; time = 'Entering…'; tone = 'intro'; frac = 0; }
    else {
      const left = s.endsAt ? s.endsAt - this.now() : 0;
      frac = s.phaseMs ? Math.max(0, Math.min(1, left / s.phaseMs)) : 1;
      if (s.phase === 'loading') { label = 'Rat and Seek'; time = 'Waiting…'; tone = 'intro'; }
      else if (s.phase === 'intro') { label = 'Rat and Seek'; time = 'Crooked Manor'; tone = 'intro'; frac = 1 - frac; }
      else if (s.phase === 'hiding') { label = this.role === 'human' ? 'Seeker released in' : 'Hide'; time = fmt(left); tone = 'hide'; }
      else if (s.phase === 'hunting') { label = s.finalMinute ? 'Final minute' : 'Hunt'; time = fmt(left); tone = s.finalMinute ? 'final' : 'hunt'; }
      else { label = 'Match over'; time = this.result ? (this.result.humansWon ? 'Seeker wins' : 'Rats win') : 'Over'; tone = 'final'; }
    }
    if (this.bossTitle.textContent !== label) this.bossTitle.textContent = label;
    if (this.bossTime.textContent !== time) this.bossTime.textContent = time;
    this.boss.dataset.tone = tone;
    this.bossFill.style.transform = `scaleX(${frac})`;
    const pills = !s || s.phase === 'loading' || s.phase === 'intro' ? ''
      : `<span class="rs-pill free"><i></i><b>${s.freeRats}</b>free</span>`
        + `<span class="rs-pill caged"><i></i><b>${s.caged}</b>caged</span>`
        + (s.twist ? `<span class="rs-pill twist"><i></i>${escapeHtml(s.twist)}</span>` : '');
    if (this.pills.innerHTML !== pills) this.pills.innerHTML = pills;
  }

  private renderCompass(yaw: number): void {
    const s = this.snap;
    const c = s?.me.compass;
    const show = !!s && this.role === 'human' && s.phase === 'hunting';
    this.compassEl.classList.toggle('show', show);
    if (!show || !s) return;
    this.compassEl.style.opacity = c ? '' : '0.7';
    this.compassArrow.style.visibility = c ? '' : 'hidden';
    if (!c) {
      const text = s.me.compassCd > 0 ? `Compass ${Math.ceil(s.me.compassCd / 20)}s` : 'Right-click the compass to track a rat';
      if (this.compassText.textContent !== text) this.compassText.textContent = text;
      return;
    }
    const p = this.d.player.pos;
    const target = Math.atan2(-(c.x - p.x), -(c.z - p.z));
    let rel = target - yaw;
    while (rel > Math.PI) rel -= Math.PI * 2;
    while (rel < -Math.PI) rel += Math.PI * 2;
    this.compassArrow.style.transform = `rotate(${-rel}rad)`;
    const dy = c.y - p.y;
    const level = dy > 2.5 ? ' ↑ above' : dy < -2.5 ? ' ↓ below' : '';
    const text = `${Math.round(Math.hypot(c.x - p.x, c.y - p.y, c.z - p.z))}m${level} · ${c.room.replace(/\b\w/g, (m) => m.toUpperCase())}`;
    if (this.compassText.textContent !== text) this.compassText.textContent = text;
  }

  private renderSidebar(): void {
    const s = this.snap;
    if (!s) return;
    const me = s.me;
    this.pocket.textContent = me.role === 'rat'
      ? `${me.caged ? 'CAGED · ' : ''}${me.points} pts · Cheese ${me.cheese}/${RS.RESCUE_COST}`
      : `Scent ${me.scentCd === 0 ? 'ready' : `${Math.ceil(me.scentCd / 20)}s`} · Light ${Math.round(me.battery * 100)}%`;
    const rows: [string, string, string?][] = [];
    const secs = (ticks: number) => `${Math.ceil(ticks / 20)}s`;
    if (me.room) rows.push(['Room', escapeHtml(me.room.replace(/\b\w/g, (c) => c.toUpperCase()))]);
    if (me.role === 'rat') {
      rows.push(['Points', String(me.points), 'gold']);
      rows.push(['Cheese', `${me.cheese}/${RS.RESCUE_COST}`, me.cheese >= RS.RESCUE_COST ? 'good' : 'gold']);
      if (me.escapes) rows.push(['Escapes', `×${me.escapes}`, 'good']);
      if (me.caged) rows.push(['Status', 'Caged · rattle!', 'bad']);
      else rows.push(['Combo', `×${me.combo}`]);
      const cls = me.cls ? RAT_CLASSES[me.cls] : null;
      if (cls) rows.push([cls.ability, s.phase !== 'hunting' ? 'Locked' : me.abilityCd === 0 ? 'Ready' : secs(me.abilityCd),
        s.phase === 'hunting' && me.abilityCd === 0 ? 'good' : 'dim']);
    } else {
      rows.push(['Scent', me.scentCd === 0 ? 'Ready' : secs(me.scentCd), me.scentCd === 0 ? 'good' : 'dim']);
      rows.push(['Light', `${Math.round(me.battery * 100)}%${me.light ? ' · on' : ''}`, me.battery < 0.2 ? 'bad' : '']);
      rows.push(['Traps', String(me.traps)]);
      rows.push(['Bait', String(me.baits)]);
    }
    const role = me.role === 'human' ? 'Seeker' : me.cls ? RAT_CLASSES[me.cls].name : 'Rat';
    const rats = s.players.filter((p) => p.role === 'rat').sort((a, b) => b.points - a.points);
    const html = `<header><span>Rat and Seek</span><em class="${me.role}">${escapeHtml(role)}</em></header>`
      + `<dl>${rows.map(([k, v, c]) => `<div${c ? ` class="${c}"` : ''}><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>`
      + (rats.length ? `<ol class="rs-side-rats">${rats.map((p) => `<li class="${p.caged ? 'caged' : ''}${p.id === this.d.net.myId ? ' me' : ''}"><span>${escapeHtml(p.name)}</span><b>${p.points}</b></li>`).join('')}</ol>` : '');
    if (this.sidebar.innerHTML !== html) this.sidebar.innerHTML = html;
    this.renderCooldowns();
  }

  /** Dark sweeps over hotbar slots that are cooling down. */
  private renderCooldowns(): void {
    const s = this.snap;
    if (!s) return;
    const me = s.me;
    const slots = document.querySelectorAll<HTMLElement>('#hotbar .slot');
    const cds: Record<number, [number, number]> = me.role === 'rat'
      ? { 0: [me.tauntCd, RS.TAUNT_COOLDOWN], 1: [me.dashCd, me.cls === 'scout' ? RS.DASH_COOLDOWN * 2 / 3 : RS.DASH_COOLDOWN],
          2: [me.rattleCd, RS.RATTLE_COOLDOWN], 4: [me.abilityCd, me.cls ? RAT_CLASSES[me.cls].cooldownTicks : 1] }
      : { 1: [me.compassCd, RS.COMPASS_COOLDOWN], 2: [me.scentCd, RS.SCENT_COOLDOWN], 3: [me.light ? 0 : RS.BATTERY - me.battery * RS.BATTERY, RS.BATTERY] };
    slots.forEach((slot, i) => {
      const cd = slot.children[2] as HTMLElement | undefined;
      if (!cd) return;
      const v = cds[i];
      cd.style.height = v && v[0] > 0 ? `${Math.min(100, v[0] / v[1] * 100)}%` : '0';
    });
  }

  // ── Props ───────────────────────────────────────────────────────────────

  private syncProps(s: RsSnapshot): void {
    const seen = new Set<number>();
    for (const c of s.cheese) {
      seen.add(c.id);
      let e = this.cheese.get(c.id);
      if (!e) {
        const mesh = createCheeseModel();
        mesh.position.set(c.x, c.y + 0.12, c.z);
        this.group.add(mesh);
        e = { mesh, x: c.x, y: c.y, z: c.z };
        this.cheese.set(c.id, e);
      }
      e.x = c.x; e.y = c.y; e.z = c.z;
    }
    for (const [id, e] of this.cheese) if (!seen.has(id)) { this.group.remove(e.mesh); this.cheese.delete(id); }
    seen.clear();
    for (const dcy of s.decoys) {
      seen.add(dcy.id);
      let e = this.decoys.get(dcy.id);
      if (!e) {
        const model = createRatModel(false);
        this.group.add(model.group);
        e = { model, x: dcy.x, y: dcy.y, z: dcy.z, tx: dcy.x, tz: dcy.z, yaw: dcy.yaw, phase: 0 };
        this.decoys.set(dcy.id, e);
      }
      e.tx = dcy.x; e.tz = dcy.z; e.y = dcy.y; e.yaw = dcy.yaw;
    }
    for (const [id, e] of this.decoys) if (!seen.has(id)) { this.group.remove(e.model.group); e.model.dispose(); this.decoys.delete(id); }
    if (s.cat && !this.cat) {
      const model = createCatModel();
      this.group.add(model.group);
      this.cat = { model, x: s.cat.x, y: s.cat.y, z: s.cat.z, yaw: s.cat.yaw, tx: s.cat.x, ty: s.cat.y, tz: s.cat.z, tyaw: s.cat.yaw,
        vx: 0, vz: 0, at: performance.now(), speed: 0 };
    }
    if (s.cat && this.cat) {
      const c = this.cat, now = performance.now(), gap = (now - c.at) / 1000;
      if (gap > 0.02 && gap < 0.6) {
        const vx = (s.cat.x - c.tx) / gap, vz = (s.cat.z - c.tz) / gap;
        const jump = Math.hypot(s.cat.x - c.tx, s.cat.z - c.tz) > 3;   // a pounce lunge: don't extrapolate it
        c.vx = jump ? 0 : c.vx + (vx - c.vx) * 0.5;
        c.vz = jump ? 0 : c.vz + (vz - c.vz) * 0.5;
      }
      c.at = now;
      c.tx = s.cat.x; c.ty = s.cat.y; c.tz = s.cat.z; c.tyaw = s.cat.yaw;
    }
    else if (!s.cat && this.cat) { this.group.remove(this.cat.model.group); this.cat = null; }
    s.chandeliers.forEach((c, i) => {
      const ch = this.chandeliers[i];
      if (!ch) return;
      ch.mesh.position.set(c.x, c.y, c.z);
      ch.mesh.userData.hangY = c.y - 0.2;
      ch.target = c.drop;
      ch.shake = c.shake;
    });
  }

  private updateBeams(eye: THREE.Vector3, lookDir: THREE.Vector3): void {
    const s = this.snap;
    const lit = new Set<number>();
    if (s) for (const p of s.players) {
      if (!p.light) continue;
      lit.add(p.id);
      let beam = this.beams.get(p.id);
      if (!beam) { beam = createBeam(); this.group.add(beam); this.beams.set(p.id, beam); }
      let from: THREE.Vector3, dir: THREE.Vector3;
      if (p.id === this.d.net.myId) {
        from = eye.clone().addScaledVector(lookDir, 0.4).add(new THREE.Vector3(0, -0.25, 0));
        dir = lookDir.clone();
      } else {
        const at = this.d.remotePlayers.renderedPos(p.id);
        const r = this.d.net.remotes.get(p.id);
        if (!at || !r) { beam.visible = false; continue; }
        from = new THREE.Vector3(at.x, at.y + 1.45, at.z);
        const c = Math.cos(r.tpitch);
        dir = new THREE.Vector3(-Math.sin(r.tyaw) * c, Math.sin(r.tpitch), -Math.cos(r.tyaw) * c);
      }
      const len = this.beamReach(from, dir);
      beam.visible = true;
      beam.position.copy(from);
      beam.lookAt(from.clone().sub(dir));
      beam.scale.set(len, len, len);
    }
    for (const [id, b] of this.beams) if (!lit.has(id)) b.visible = false;
  }
  private beamReach(from: THREE.Vector3, dir: THREE.Vector3): number {
    for (let d = 0.5; d < RS.BEAM_RANGE; d += 0.35) {
      const x = from.x + dir.x * d, y = from.y + dir.y * d, z = from.z + dir.z * d;
      const b = this.d.world.getBlock(Math.floor(x), Math.floor(y), Math.floor(z));
      if (!seeThrough(b) && b !== Block.ManorWindow && b !== Block.ManorGlass && b !== Block.Barrier) return Math.max(0.6, d);
    }
    return RS.BEAM_RANGE;
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

function rayBox(o: THREE.Vector3, d: THREE.Vector3, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): number | null {
  let tmin = 0, tmax = Infinity;
  const mins = [x0, y0, z0], maxs = [x1, y1, z1], os = [o.x, o.y, o.z], ds = [d.x, d.y, d.z];
  for (let i = 0; i < 3; i++) {
    if (Math.abs(ds[i]) < 1e-9) { if (os[i] < mins[i] || os[i] > maxs[i]) return null; continue; }
    let t1 = (mins[i] - os[i]) / ds[i], t2 = (maxs[i] - os[i]) / ds[i];
    if (t1 > t2) [t1, t2] = [t2, t1];
    tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
    if (tmin > tmax) return null;
  }
  return tmin;
}

/**
 * The party leader's seeker pick: one member hunts, or a practice seeker does
 * and everyone hides. Resolves with a member id, 0 for a practice seeker, or
 * null if the leader backs out.
 */
export function pickSeeker(app: HTMLElement, party: PartyState, myId: number, current: number,
  signal?: AbortSignal): Promise<number | null> {
  return new Promise((resolve) => {
    const wrap = el('div', 'rs-seeker-pick', app);
    wrap.setAttribute('role', 'dialog');
    wrap.setAttribute('aria-label', 'Who seeks?');
    const sheet = el('div', 'rs-seeker-sheet', wrap);
    el('h2', '', sheet).textContent = 'Who seeks?';
    el('p', '', sheet).textContent = 'One player hunts; everyone else is a rat. Or let the AI Seeker hunt the whole party. Locked once the hunt begins.';
    const list = el('div', 'rs-seeker-list', sheet);
    let choice = party.members.some((m) => m.id === current) ? current : 0;
    const buttons: HTMLButtonElement[] = [];
    const option = (id: number, label: string, sub: string): void => {
      const b = el('button', 'rs-seeker-option', list);
      b.type = 'button';
      b.dataset.id = String(id);
      el('b', '', b).textContent = label;
      el('span', '', b).textContent = sub;
      b.addEventListener('click', () => { choice = id; sync(); });
      b.addEventListener('dblclick', () => { choice = id; finish(id); });
      buttons.push(b);
    };
    option(0, 'AI Seeker', 'Everyone in the party hides');
    for (const m of party.members) option(m.id, m.username, m.id === myId ? 'You hunt the party' : 'Hunts the rest of you');
    const sync = (): void => {
      for (const b of buttons) b.setAttribute('aria-pressed', b.dataset.id === String(choice) ? 'true' : 'false');
    };
    const controls = el('div', 'rs-seeker-controls', sheet);
    const go = el('button', 'primary', controls);
    go.type = 'button';
    go.textContent = 'Confirm';
    const cancel = el('button', '', controls);
    cancel.type = 'button';
    cancel.textContent = 'Cancel';
    const finish = (v: number | null): void => {
      wrap.remove(); document.removeEventListener('keydown', onKey, true);
      signal?.removeEventListener('abort', onAbort); resolve(v);
    };
    const onAbort = (): void => finish(null);
    signal?.addEventListener('abort', onAbort);
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(null); } };
    document.addEventListener('keydown', onKey, true);
    go.addEventListener('click', () => finish(choice));
    cancel.addEventListener('click', () => finish(null));
    wrap.addEventListener('click', (e) => { if (e.target === wrap) finish(null); });
    sync();
    window.setTimeout(() => go.focus(), 20);
  });
}

/** Items that open the class picker when used. */
export function isClassBadge(id: number): boolean {
  return id === Item.ClassPicker || id === Item.ClassScout || id === Item.ClassThief || id === Item.ClassTrickster || id === Item.ClassTinkerer;
}
