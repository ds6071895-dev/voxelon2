// The client side of the vanilla modes (Lucky Pillars, Disaster City, Party
// Games): engine payloads in, input out. It owns the HUD, the entity view,
// the inventory screen and server menus; a per-mode presenter adds the
// sidebar, results and any mode visuals.

import * as THREE from 'three';
import type { Input } from '../../input';
import type { Inventory } from '../../inventory';
import type { Player } from '../../player';
import type { World } from '../../world';
import type { Atlas } from '../../textures';
import type { WorldSpec } from '../../multiverse';
import type { EngineMode } from '../../net/protocol';
import { BLOCKS, Block, collisionBoxes } from '../../blocks';
import { mergeInto, placeBlock, stationOf, useBlock, type PlaceCtx } from '../block_states';
import { VMETA } from '../blocks';
import { VITEM, VI } from '../items';
import { breakTicks } from '../tools';
import { attackStats, bowPower, cooldownScale } from '../combat';
import { BOW, CROSSBOW, THROWN, TRIDENT, aimDir, launchPoint } from '../ranged';
import { enchLevel } from '../stack';
import { EntityView3D } from './entity_view';
import { VanillaHud } from './vanilla_hud';
import { InventoryUI } from './inventory_ui';
import { MenuUI } from './menu_ui';
import './icon_tints';
import { segmentHitsBox } from '../entity';
import type { BlockHit, FxEvent, MAction, MPayload, SelfView } from '../messages';
import type { VStack } from '../stack';
import { OFFHAND as OFFHAND_SLOT } from '../inventory_model';
import type { BodyStyle } from '../../remoteplayers';

export interface VanillaDeps {
  scene: THREE.Scene;
  app: HTMLElement;
  player: Player;
  world: World;
  inventory: Inventory;
  atlas: Atlas;
  send(a: MAction): void;
  /** Player id under the crosshair within `reach`, or -1. */
  rayPlayer(eye: THREE.Vector3, look: THREE.Vector3, reach: number): number;
  target(): { x: number; y: number; z: number; nx: number; ny: number; nz: number } | null;
  showCrack(x: number, y: number, z: number, progress: number): void;
  clearCrack(): void;
  swing(): void;
  setBowDraw(f: number): void;
  /** First-person ranged motion (bow release, crossbow load/fire, throws). */
  held?: {
    releaseBow(power: number): void;
    setCrossbow(charge: number, loaded: 'arrow' | 'rocket' | null): void;
    fireCrossbow(): void;
    throwItem(): void;
  };
  sound(name: string, at?: THREE.Vector3, pitch?: number): void;
  burst(kind: string, x: number, y: number, z: number, color?: number, n?: number): void;
  hurtFlash(id: number): void;
  onPanel(): void;
  replay(mode: EngineMode): void;
  leave(): void;
  myId(): number;
  remotePos(id: number): { x: number; y: number; z: number } | null;
  /** A mode's look for other players (glow, hidden, size). */
  setStyle(f: ((id: number) => BodyStyle | null) | null): void;
}

/** Per-mode presentation (sidebar, results, mode visuals). */
export interface ModePresenter {
  onState(s: unknown): void;
  frame?(dt: number): void;
  frozen?(): boolean;
  timeOfDay?(): number;
  /** A presenter-owned panel (results card) wants the pointer. */
  panelOpen?(): boolean;
  dispose(): void;
}
type PresenterFactory = (c: VanillaClient) => ModePresenter;
const PRESENTERS = new Map<EngineMode, PresenterFactory>();
export function registerPresenter(mode: EngineMode, f: PresenterFactory): void { PRESENTERS.set(mode, f); }

const PLACE_REPEAT_MS = 200;
const DIG_HEARTBEAT_MS = 120;

export class VanillaClient {
  active = false;
  mode: EngineMode | null = null;
  readonly hud: VanillaHud;
  readonly invUI: InventoryUI;
  readonly menu: MenuUI;
  ents: EntityView3D | null = null;
  self: SelfView | null = null;
  slots: (VStack | null)[] = new Array(46).fill(null);
  state: unknown = null;
  presenter: ModePresenter | null = null;
  private selected = -1;
  private placeAt = 0;
  /** Blocks we placed locally ahead of the server, keyed "x,y,z": what was there before. */
  private predicted = new Map<string, { x: number; y: number; z: number; was: number; until: number }>();
  private digging: { x: number; y: number; z: number; block: number; start: number; ticks: number; heartbeat: number } | null = null;
  private usingSince = -1;
  private attackAt = 0;
  private lastJump = false;
  private lastSneak = false;
  /** Heading of the boat a body at this spot sits in (remote riders' pose). */
  boatYawNear(x: number, y: number, z: number): number | null { return this.ents?.boatYawNear(x, y, z) ?? null; }
  /** The boat entity we sit in, drawn at our own predicted position. */
  private rideEnt: number | null = null;
  private rideSince = 0;
  private clockServer = 0;
  private clockLocal = 0;
  /** Server ms now, run on from the last snapshot's stamp. */
  serverNow(): number { return this.clockServer + performance.now() - this.clockLocal; }
  private boltMeshes: { mesh: THREE.Object3D; until: number }[] = [];
  private cooldownEl: HTMLElement;
  /** Ring around the crosshair: draw/charge while using, item cooldown after. */
  private aimEl: HTMLElement;
  private aimArc: SVGCircleElement;
  private aimLabel: HTMLElement;
  /** Item cooldowns by item id (performance.now ms); server ones merge in from `self`. */
  private cds = new Map<number, { start: number; end: number }>();
  private cdSeen = new Set<string>();
  /** Our own shots' sounds play at once; the server's echo of them is skipped. */
  private localSounds = new Map<string, number>();

  constructor(readonly d: VanillaDeps) {
    this.hud = new VanillaHud(d.app);
    this.invUI = new InventoryUI({
      app: d.app, atlas: d.atlas.canvas,
      send: (win, slot, button, mode, rev, hotbar) => d.send({ k: 'click', win, slot, button, mode, rev, hotbar }),
      close: (win) => d.send({ k: 'closeWin', win }),
      onOpenChange: () => d.onPanel(),
      selected: () => d.inventory.selected,
    });
    this.menu = new MenuUI(d.app, d.atlas.canvas, (menu, id) => d.send({ k: 'menu', menu, id }), () => d.onPanel());
    this.cooldownEl = document.createElement('div');
    this.cooldownEl.className = 'v-cooldown';
    this.cooldownEl.appendChild(document.createElement('i'));
    this.hud.root.appendChild(this.cooldownEl);
    this.aimEl = document.createElement('div');
    this.aimEl.className = 'v-aim';
    this.aimEl.hidden = true;
    this.aimEl.innerHTML = '<svg viewBox="0 0 40 40" aria-hidden="true"><circle class="v-aim-track" cx="20" cy="20" r="15"/><circle class="v-aim-arc" cx="20" cy="20" r="15" pathLength="100"/></svg><b></b>';
    this.aimArc = this.aimEl.querySelector('.v-aim-arc') as SVGCircleElement;
    this.aimLabel = this.aimEl.querySelector('b') as HTMLElement;
    this.hud.root.appendChild(this.aimEl);
  }

  get panelOpen(): boolean { return this.invUI.open || this.menu.open || !!this.presenter?.panelOpen?.(); }
  get spectating(): boolean { return !!this.self?.spectator; }
  get frozen(): boolean { return !!this.self?.move.frozen || !!this.presenter?.frozen?.(); }
  heldStack(): VStack | null { return this.slots[this.d.inventory.selected] ?? null; }
  offhandStack(): VStack | null { return this.slots[OFFHAND_SLOT] ?? null; }
  /** The current right-click use (shield, food, bow…) comes from the offhand. */
  usingOffhand = false;

  enter(mode: EngineMode, _spec: WorldSpec): void {
    if (this.active) this.exit();
    this.active = true; this.mode = mode;
    this.ents = new EntityView3D(this.d.scene, this.d.atlas);
    this.ents.myId = this.d.myId();
    this.ents.solidAt = (x, y, z) => {
      const b = this.d.world.getBlock(Math.floor(x), Math.floor(y), Math.floor(z));
      return b !== Block.Air && !!collisionBoxes(b) && !BLOCKS[b]?.fluid;
    };
    this.cds.clear(); this.cdSeen.clear();
    this.hud.reset(); this.hud.show(true);
    this.self = null; this.state = null;
    this.slots = new Array(46).fill(null);
    this.selected = -1;
    this.d.player.moveKindAt = (x, y, z) => VMETA[this.d.world.getBlock(Math.floor(x), Math.floor(y), Math.floor(z))]?.move;
    this.d.player.damageSink = () => {};
    document.body.classList.add('vanilla-active');
    document.body.dataset.vmode = mode;
    this.presenter = PRESENTERS.get(mode)?.(this) ?? null;
  }
  exit(): void {
    if (!this.active) return;
    this.active = false;
    this.presenter?.dispose(); this.presenter = null;
    this.ents?.dispose(); this.ents = null;
    this.invUI.hide(); this.menu.close();
    this.hud.show(false);
    this.d.clearCrack(); this.d.setBowDraw(0);
    this.aimEl.hidden = true; this.cds.clear();
    for (const el of document.querySelectorAll<HTMLElement>('#hotbar > .slot')) { const band = el.children[2] as HTMLElement | undefined; if (band) band.style.height = '0%'; }
    const p = this.d.player;
    p.moveKindAt = undefined; p.vanilla = null; p.boat = null; this.rideEnt = null; p.speedMult = 1; p.jumpBoost = 0; p.setBodyScale(1); p.gliding = false;
    p.damageSink = undefined;
    for (const b of this.boltMeshes) b.mesh.removeFromParent();
    this.boltMeshes = [];
    document.body.classList.remove('vanilla-active');
    delete document.body.dataset.vmode;
    this.mode = null;
  }

  payload(d: MPayload): void {
    if (!this.active) return;
    switch (d.k) {
      case 'state': {
        const at = (d.s as { serverNow?: number }).serverNow;
        if (typeof at === 'number') { this.clockServer = at; this.clockLocal = performance.now(); }
        this.state = d.s; this.presenter?.onState(d.s);
        break;
      }
      case 'self': this.self = d.v; this.hud.setSelf(d.v); this.mergeCooldowns(d.v.cd); if(d.v.move.gliding!==undefined)this.d.player.gliding=d.v.move.gliding; break;
      case 'inv': {
        this.slots = d.v.slots;
        this.d.inventory.restore(d.v.slots.slice(0, 36), this.d.inventory.selected);
        this.d.inventory.version++;
        this.invUI.setInventory(d.v);
        break;
      }
      case 'win': this.invUI.setWindow(d.v); if (!d.v) this.d.onPanel(); break;
      case 'ent': this.ents?.apply(d); break;
      case 'nack': this.unpredict(`${d.x},${d.y},${d.z}`); break;
      case 'fx': for (const f of d.fx) this.fx(f); break;
      case 'title': this.hud.flash(d.title, d.sub, d.color, d.ms); break;
      case 'bar': this.hud.bar(d.text, d.color); break;
      case 'feed': if (d.tone === 'pickup' && !d.text) break; this.hud.toast(d.text, d.tone); break;
      case 'menu': this.menu.show(d.v); break;
      case 'ride': {
        const p = this.d.player;
        if (this.rideEnt !== null) this.ents?.hold(this.rideEnt, null);
        if (d.ent !== null && d.x !== undefined && d.y !== undefined && d.z !== undefined) {
          this.rideEnt = d.ent; this.rideSince = performance.now();
          p.mountBoat(d.x, d.y, d.z, d.yaw ?? p.yaw);
          this.d.sound('place', p.pos.clone());
        } else {
          this.rideEnt = null;
          p.leaveBoat();
        }
        break;
      }
      case 'impulse': {
        const p = this.d.player;
        if (d.set) p.vel.set(d.vx, d.vy, d.vz); else { p.vel.x += d.vx; p.vel.y += d.vy; p.vel.z += d.vz; }
        break;
      }
      default: break;
    }
  }

  openInventory(): void {
    if (!this.active || this.panelOpen || this.spectating) return;
    this.d.send({ k: 'openInv' });
    this.invUI.show('inventory');
  }

  /** Per-frame input while controlling the player. */
  input(_dt: number, input: Input, look: THREE.Vector3, eye: THREE.Vector3): void {
    if (!this.active) return;
    const inv = this.d.inventory, now = performance.now();
    if (inv.selected !== this.selected) {
      this.selected = inv.selected;
      this.d.send({ k: 'select', slot: inv.selected });
      if (this.usingSince >= 0) { this.usingSince = -1; this.usingOffhand = false; this.d.setBowDraw(0); }
      this.stopDig();
    }
    if (this.spectating || this.frozen) {
      this.stopDig();
      // Ghosts still use their one item (Lucky Pillars' trick menu).
      const s = this.heldStack();
      if (this.spectating && input.rightClicked && s && VITEM[s.id]?.use === 'menu') this.d.send({ k: 'use', slot: inv.selected, yaw: this.d.player.yaw, pitch: this.d.player.pitch });
      return;
    }
    const p = this.d.player;
    const stack = this.heldStack();
    const reach = 3 + (this.self?.move.scale && this.self.move.scale > 1 ? 1 : 0);
    // Elytra: jump in mid-air to start gliding.
    const jump = input.jump;
    if (jump && !this.lastJump && !p.onGround && !p.gliding && this.self?.move.elytra && !p.climbing && !p.inWater) {
      p.gliding = true; this.d.send({ k: 'glide', on: true });
    }
    if (jump && !this.lastJump && !p.onGround && (this.self?.move.doubleJumps ?? 0) > 0) this.d.send({ k: 'jump2' });
    this.lastJump = jump;
    // Sneak gets out of a boat.
    if (input.sneak && !this.lastSneak && p.boat) this.d.send({ k: 'dismount' });
    this.lastSneak = input.sneak;
    // What's under the crosshair: a player, an entity, or a block.
    const target = this.d.target();
    const blockDist = target ? new THREE.Vector3(target.x + .5, target.y + .5, target.z + .5).distanceTo(eye) : Infinity;
    const victim = this.d.rayPlayer(eye, look, reach + .2);
    const victimPos = victim >= 0 ? this.d.remotePos(victim) : null;
    const hitPlayer = victim >= 0 && !!victimPos && Math.hypot(victimPos.x - eye.x, victimPos.y + 1 - eye.y, victimPos.z - eye.z) < blockDist + .4;
    let entHit: { id: number; t: number } | null = null;
    if (!hitPlayer && this.ents) {
      const end = eye.clone().addScaledVector(look, reach + .5);
      for (const e of this.ents.hitTargets()) {
        const t = segmentHitsBox(eye.x, eye.y, eye.z, end.x, end.y, end.z, e.x, e.y, e.z, e.w / 2, e.h, .1);
        if (t !== null && t * (reach + .5) < blockDist && (!entHit || t < entHit.t)) entHit = { id: e.id, t };
      }
    }
    // Left: attack, or mine.
    if (input.leftClicked && (hitPlayer || entHit)) {
      this.d.swing();
      this.attackAt = now;
      this.d.send(hitPlayer ? { k: 'attack', target: victim } : { k: 'attack', ent: entHit!.id });
      if (hitPlayer) this.d.hurtFlash(victim);
    } else if (input.leftClicked && !target) { this.d.swing(); this.attackAt = now; }
    if (input.leftDown && target && !hitPlayer && !entHit) this.dig(target, now);
    else this.stopDig();
    // Right: use / place, release ends a draw.
    // Which hand acts, mirroring Sim.use: the main hand unless it has nothing to
    // do here, then the offhand (a shield, food, a bow, or blocks on a face).
    const useOf = (st: VStack | null) => st ? (VITEM[st.id]?.use ?? (VITEM[st.id]?.food ? 'food' : null)) : null;
    const blockOf = (st: VStack | null) => !!st && (VITEM[st.id]?.block !== undefined || (!!BLOCKS[st.id] && !VITEM[st.id]?.use));
    const mainActs = !!stack && (!!useOf(stack) || !!VITEM[stack.id]?.armor || (blockOf(stack) && !!target));
    const off = this.offhandStack();
    const offActs = !mainActs && !!off && (!!useOf(off) || (blockOf(off) && !!target));
    const hand = offActs ? off : stack;
    const use = useOf(hand);
    const isBlock = blockOf(hand);
    if (input.rightClicked || (input.rightDown && isBlock && now >= this.placeAt)) {
      this.placeAt = now + PLACE_REPEAT_MS;
      const hit = target ? this.blockHit(target, eye, look) : undefined;
      const ride = !p.boat && entHit && this.ents?.hitTargets().find((e) => e.id === entHit!.id)?.kind && ['boat','minecart','sheep'].includes(this.ents!.hitTargets().find((e) => e.id === entHit!.id)!.kind) ? entHit.id : undefined;
      this.d.send({ k: 'use', slot: inv.selected, block: ride === undefined ? hit : undefined, ent: ride, yaw: p.yaw, pitch: p.pitch });
      if (isBlock && hit && ride === undefined && hand) this.predictPlace(hand, hit, now);
      if (isBlock && hit) this.d.swing();
      const ready = !!hand && !this.coolingDown(hand.id, now);
      const loaded = use === 'crossbow' && !!hand?.charged;
      if (input.rightClicked && ready && !loaded && (use === 'bow' || use === 'crossbow' || use === 'trident' || use === 'food' || use === 'drink' || use === 'shield')) { this.usingSince = now; this.usingOffhand = offActs; }
      if (use === 'firework' && p.gliding) p.boostTicks = 22 + Math.floor(Math.random() * 8);
      if (input.rightClicked && ready && hand && loaded) this.fireCrossbow(hand, eye, offActs, now);
      if (input.rightClicked && ready && hand && (use === 'throw' || use === 'splash' || use === 'lingering')) this.throwLocal(hand, eye, offActs, now);
      if (use === 'rod') this.d.swing();
    }
    if (this.usingSince >= 0) {
      const ticks = (now - this.usingSince) / 50;
      if (!this.usingOffhand && use === 'bow') this.d.setBowDraw(bowPower(ticks));
      if (!this.usingOffhand && use === 'trident') this.d.setBowDraw(Math.min(1, ticks / TRIDENT.minTicks));
      if (!input.rightDown) {
        const wasOff = this.usingOffhand;
        this.usingSince = -1; this.usingOffhand = false; this.d.setBowDraw(0);
        this.d.send({ k: 'useEnd', slot: inv.selected, yaw: p.yaw, pitch: p.pitch });
        if (hand && use === 'bow') this.releaseBow(hand, ticks, eye, wasOff, now);
        if (hand && use === 'trident' && ticks >= TRIDENT.minTicks) this.shootLocal('trident', eye, aimDir(p.yaw, p.pitch, TRIDENT.lift), TRIDENT.speed, wasOff, 'trident');
      }
    }
    // The crossbow in hand shows its string and bolt.
    const main = this.heldStack();
    if (main && VITEM[main.id]?.use === 'crossbow') {
      const charging = this.usingSince >= 0 && !this.usingOffhand && use === 'crossbow';
      const need = CROSSBOW.charge(enchLevel(main, 'quick_charge'));
      this.d.held?.setCrossbow(charging ? (now - this.usingSince) / 50 / need : 0,
        main.charged ? (main.charged === VI.firework_rocket ? 'rocket' : 'arrow') : null);
    }
    this.aimFrame(now, use, hand);
  }

  private coolingDown(id: number, now: number): boolean { const c = this.cds.get(id); return !!c && now < c.end; }
  private startCooldown(id: number, ticks: number, now: number): void { if (ticks >= 1) this.cds.set(id, { start: now, end: now + ticks * 50 }); }
  /** Server cooldowns (an axe knocking the shield down, throws we didn't predict). */
  private mergeCooldowns(list: [number, number, number][] | undefined): void {
    const now = performance.now(), live = new Set<string>();
    for (const [id, end, total] of list ?? []) {
      const key = `${id}:${end}`;
      live.add(key);
      if (this.cdSeen.has(key)) continue;
      this.cdSeen.add(key);
      const mine = this.cds.get(id);
      if (mine && now - mine.start < 600 && now < mine.end) continue;
      this.startCooldown(id, total, now);
    }
    for (const k of this.cdSeen) if (!live.has(k)) this.cdSeen.delete(k);
  }
  private playLocal(name: string, pitch?: number): void { this.localSounds.set(name, performance.now()); this.d.sound(name, undefined, pitch); }
  /** Draw our own shot at once; the server's copy takes over when it arrives. */
  private shootLocal(kind: Parameters<EntityView3D['predict']>[0], eye: THREE.Vector3, dir: { x: number; y: number; z: number }, speed: number, offhand: boolean, sound: string, color?: number, pitch?: number): void {
    const p = this.d.player;
    const at = launchPoint(eye, dir);
    // Leave from the hand (lower right, or left for the offhand), then join the true path.
    const side = offhand ? -1 : 1;
    const from = new THREE.Vector3(Math.cos(p.yaw) * .32 * side, -.28, -Math.sin(p.yaw) * .32 * side);
    this.ents?.predict(kind, at, { x: dir.x * speed, y: dir.y * speed, z: dir.z * speed }, from, color);
    if (sound) this.playLocal(sound, pitch);
  }
  private hasArrows(bow: VStack): boolean {
    return enchLevel(bow, 'infinity') > 0 || this.slots.some((s, i) => i <= OFFHAND_SLOT && !!s && (s.id === VI.arrow || s.id === VI.spectral_arrow));
  }
  private releaseBow(bow: VStack, ticks: number, eye: THREE.Vector3, offhand: boolean, _now: number): void {
    const power = bowPower(ticks);
    if (power < .1 || !this.hasArrows(bow)) return;
    const p = this.d.player;
    const spectral = !this.slots.some((s, i) => i <= OFFHAND_SLOT && s?.id === VI.arrow) && this.slots.some((s) => s?.id === VI.spectral_arrow);
    this.shootLocal(spectral ? 'spectral_arrow' : 'arrow', eye, aimDir(p.yaw, p.pitch, BOW.lift), power * BOW.speed, offhand, 'bow', undefined, power);
    if (!offhand) this.d.held?.releaseBow(power);
  }
  private fireCrossbow(cb: VStack, eye: THREE.Vector3, offhand: boolean, _now: number): void {
    const p = this.d.player;
    const rocket = cb.charged === VI.firework_rocket;
    const multi = enchLevel(cb, 'multishot') > 0;
    for (const off of multi ? [0, -10, 10] : [0]) {
      const dir = aimDir(p.yaw + off * Math.PI / 180, p.pitch, rocket ? 0 : CROSSBOW.lift);
      this.shootLocal(rocket ? 'firework' : 'arrow', eye, dir, rocket ? CROSSBOW.rocketSpeed : CROSSBOW.speed, offhand, off === 0 ? 'crossbow_shoot' : '');
    }
    if (!offhand) this.d.held?.fireCrossbow();
  }
  private throwLocal(s: VStack, eye: THREE.Vector3, offhand: boolean, now: number): void {
    const t = THROWN[VITEM[s.id]?.key ?? ''];
    if (!t) return;
    const p = this.d.player;
    this.shootLocal(t.kind, eye, aimDir(p.yaw, p.pitch, t.lift), t.speed, offhand, t.kind === 'ender_pearl' ? 'pearl_throw' : 'throw', s.potion?.color);
    this.startCooldown(s.id, t.cooldown, now);
    if (!offhand) this.d.held?.throwItem(); else this.d.swing();
  }
  /** The crosshair ring: bow draw, crossbow load, trident wind-up; else the held item's cooldown. */
  private aimFrame(now: number, use: string | null, hand: VStack | null): void {
    let frac = -1, label = '', tone = '';
    if (this.usingSince >= 0 && (use === 'bow' || use === 'crossbow' || use === 'trident') && hand) {
      const ticks = (now - this.usingSince) / 50;
      frac = use === 'bow' ? bowPower(ticks) : use === 'trident' ? Math.min(1, ticks / TRIDENT.minTicks)
        : Math.min(1, ticks / CROSSBOW.charge(enchLevel(hand, 'quick_charge')));
      tone = frac >= 1 ? 'full' : 'charge';
    } else {
      const sel = this.heldStack();
      const c = sel ? this.cds.get(sel.id) : undefined;
      if (c && now < c.end && c.end - c.start >= 400) {
        frac = (c.end - now) / (c.end - c.start);
        label = ((c.end - now) / 1000).toFixed(1);
        tone = 'cd';
      } else if (sel && VITEM[sel.id]?.use === 'crossbow' && sel.charged) { frac = 1; tone = 'loaded'; }
    }
    this.aimEl.hidden = frac < 0 || this.spectating;
    if (frac >= 0) {
      this.aimArc.style.strokeDashoffset = String(100 - Math.round(frac * 100));
      this.aimEl.dataset.tone = tone;
      if (this.aimLabel.textContent !== label) this.aimLabel.textContent = label;
    }
    // Hotbar: a dark band over each slot whose item is cooling down, shrinking as it ends.
    const bar = document.querySelectorAll<HTMLElement>('#hotbar > .slot');
    for (let i = 0; i < bar.length && i < 9; i++) {
      const st = this.slots[i], c = st ? this.cds.get(st.id) : undefined;
      const band = bar[i].children[2] as HTMLElement | undefined;
      if (!band) continue;
      const h = c && now < c.end ? `${Math.round((c.end - now) / (c.end - c.start) * 100)}%` : '0%';
      if (band.style.height !== h) band.style.height = h;
    }
  }

  /** Where on a block face the crosshair hits (slabs, stairs, trapdoors need the height). */
  private blockHit(t: { x: number; y: number; z: number; nx: number; ny: number; nz: number }, eye: THREE.Vector3, look: THREE.Vector3): BlockHit {
    let hitY = t.ny > 0 ? 1 : t.ny < 0 ? 0 : .5;
    if (t.ny === 0) {
      const plane = t.nx !== 0 ? t.x + (t.nx > 0 ? 1 : 0) : t.z + (t.nz > 0 ? 1 : 0);
      const o = t.nx !== 0 ? eye.x : eye.z, dir = t.nx !== 0 ? look.x : look.z;
      if (Math.abs(dir) > 1e-6) hitY = Math.max(0, Math.min(1, eye.y + look.y * ((plane - o) / dir) - t.y));
    }
    return { x: t.x, y: t.y, z: t.z, nx: t.nx, ny: t.ny, nz: t.nz, hitY };
  }

  /** Show a placed block at once instead of after the server round trip.
   *  Mirrors Sim.use/placeFrom; the server's edit confirms it, and a refusal
   *  (nack, or silence for 700 ms) puts the old block back. */
  private predictPlace(stack: VStack, hit: BlockHit, now: number): void {
    const w = this.d.world, p = this.d.player;
    const get = (x: number, y: number, z: number) => w.getBlock(x, y, z);
    const clicked = get(hit.x, hit.y, hit.z);
    if (!p.sneaking && (stationOf(clicked) || useBlock(get, hit.x, hit.y, hit.z))) return;
    const block = VITEM[stack.id]?.block ?? stack.id;
    if (VMETA[block]?.family === 'tnt') return;
    const ctx: PlaceCtx = { nx: hit.nx, ny: hit.ny, nz: hit.nz, yaw: p.yaw, hitY: Math.max(0, Math.min(1, hit.hitY)) };
    let tx = hit.x + hit.nx, ty = hit.y + hit.ny, tz = hit.z + hit.nz;
    let edits: { x: number; y: number; z: number; block: number }[] | null;
    const merged = mergeInto(block, clicked, ctx);
    if (merged !== null) edits = [{ x: hit.x, y: hit.y, z: hit.z, block: merged }];
    else {
      if (BLOCKS[clicked]?.replaceable && !BLOCKS[clicked]?.fluid) { tx = hit.x; ty = hit.y; tz = hit.z; }
      const cur = get(tx, ty, tz);
      const mergeHere = mergeInto(block, cur, { ...ctx, ny: 1, hitY: 1 });
      if (mergeHere !== null) edits = [{ x: tx, y: ty, z: tz, block: mergeHere }];
      else if (cur !== Block.Air && !BLOCKS[cur]?.replaceable && !BLOCKS[cur]?.fluid) return;
      else edits = placeBlock(block, get, tx, ty, tz, ctx);
    }
    if (!edits) return;
    const hw = p.bodyHalfWidth, h = p.bodyHeight;
    for (const e of edits) {
      if (e.y < 0 || e.y > 255) return;
      if (collisionBoxes(e.block) && p.pos.x + hw > e.x && p.pos.x - hw < e.x + 1 && p.pos.y + h > e.y && p.pos.y < e.y + 1 && p.pos.z + hw > e.z && p.pos.z - hw < e.z + 1) return;
    }
    w.beginBatch();
    for (const e of edits) {
      const key = `${e.x},${e.y},${e.z}`;
      const was = this.predicted.get(key)?.was ?? get(e.x, e.y, e.z);
      this.predicted.set(key, { x: e.x, y: e.y, z: e.z, was, until: now + 700 });
      w.setBlock(e.x, e.y, e.z, e.block);
    }
    w.endBatch();
  }
  private unpredict(key: string): void {
    const g = this.predicted.get(key);
    if (!g) return;
    this.predicted.delete(key);
    this.d.world.setBlock(g.x, g.y, g.z, g.was);
  }

  private dig(t: { x: number; y: number; z: number }, now: number): void {
    const block = this.d.world.getBlock(t.x, t.y, t.z);
    const d = this.digging;
    if (!d || d.x !== t.x || d.y !== t.y || d.z !== t.z || d.block !== block) {
      const p = this.d.player;
      const haste = 1 + .2 * ((this.self?.effects.find((e) => e.id === 'haste')?.amp ?? -1) + 1);
      const ticks = breakTicks(block, this.heldStack(), { haste, inWater: p.inWater, onGround: p.onGround });
      this.digging = { x: t.x, y: t.y, z: t.z, block, start: now, ticks, heartbeat: 0 };
    }
    const g = this.digging!;
    if (now >= g.heartbeat) { g.heartbeat = now + DIG_HEARTBEAT_MS; this.d.send({ k: 'dig', x: g.x, y: g.y, z: g.z }); this.d.swing(); }
    if (g.ticks !== Infinity && g.ticks > 0) this.d.showCrack(g.x, g.y, g.z, Math.min(.99, (now - g.start) / (g.ticks * 50)));
  }
  private stopDig(): void {
    if (!this.digging) return;
    this.digging = null;
    this.d.send({ k: 'digStop' });
    this.d.clearCrack();
  }
  /** A block edit from the server: a broken block clears its crack. */
  noteEdit(x: number, y: number, z: number): void {
    this.predicted.delete(`${x},${y},${z}`);
    const g = this.digging;
    if (g && g.x === x && g.y === y && g.z === z) { this.digging = null; this.d.clearCrack(); }
  }

  /** Per frame: movement profile, entities, HUD, mode visuals. */
  update(dt: number): void {
    if (!this.active) return;
    const p = this.d.player, s = this.self;
    if (s) {
      const m = s.move;
      p.vanilla = { gravity: m.gravity, slowFall: m.slowFall, levitation: m.levitation, frozen: m.frozen, canSprint: m.canSprint };
      p.speedMult = m.speed; p.jumpBoost = m.jump; p.setBodyScale(m.scale);
      p.flying = s.spectator; p.noclip = s.spectator;
      p.maxHealth = s.maxHp;
      if (Math.ceil(s.hp) !== p.health) p.setHealthFromServer(Math.ceil(s.hp), false);
    }
    // Our boat follows our predicted hull; a server-side dismount we missed lets go.
    if (p.boat && s && s.move.boat === undefined && this.rideEnt !== null && performance.now() - this.rideSince > 1500) {
      this.ents?.hold(this.rideEnt, null); this.rideEnt = null; p.leaveBoat();
    }
    if (p.boat && this.rideEnt !== null) this.ents?.hold(this.rideEnt, { x: p.pos.x, y: p.pos.y, z: p.pos.z, yaw: p.boat.yaw });
    this.ents?.update(dt);
    if (this.predicted.size) { const t = performance.now(); for (const [k, g] of this.predicted) if (t > g.until) this.unpredict(k); }
    this.hud.tick(performance.now());
    // Attack cooldown under the crosshair.
    const speed = attackStats(this.heldStack()).speed;
    const charge = cooldownScale((performance.now() - this.attackAt) / 50, speed);
    this.cooldownEl.hidden = charge >= 1 || !!s?.spectator;
    (this.cooldownEl.firstChild as HTMLElement).style.width = `${Math.round(charge * 100)}%`;
    const now = performance.now();
    this.boltMeshes = this.boltMeshes.filter((b) => { if (now < b.until) return true; b.mesh.removeFromParent(); return false; });
    this.presenter?.frame?.(dt);
  }

  private fx(f: FxEvent): void {
    const at = (x?: number, y?: number, z?: number) => x !== undefined && y !== undefined && z !== undefined ? new THREE.Vector3(x, y, z) : undefined;
    switch (f.f) {
      case 'sound': {
        // Our own shot already played this sound when we fired.
        const mine = this.localSounds.get(f.s);
        if (mine !== undefined && performance.now() - mine < 900 && f.x !== undefined && f.z !== undefined
          && Math.hypot(f.x - this.d.player.pos.x, f.z - this.d.player.pos.z) < 2.5) { this.localSounds.delete(f.s); break; }
        this.d.sound(f.s, at(f.x, f.y, f.z), f.pitch);
        break;
      }
      case 'burst': this.d.burst(f.kind, f.x, f.y, f.z, f.color, f.n); break;
      case 'explode': this.d.burst('explode', f.x, f.y, f.z, 0xe6bc77, Math.round(20 + f.power * 8)); break;
      case 'firework': this.d.burst('firework', f.x, f.y, f.z, f.color, 40); this.d.sound('firework_blast', at(f.x, f.y, f.z)); break;
      case 'totem': {
        const pos = f.id === this.d.myId() ? this.d.player.pos : this.d.remotePos(f.id);
        if (pos) this.d.burst('totem', pos.x, pos.y + 1, pos.z, 0xf3c653, 50);
        break;
      }
      case 'hurt': if (!f.ent) { if (f.id !== this.d.myId()) this.d.hurtFlash(f.id); } break;
      case 'break': this.d.burst('break', f.x + .5, f.y + .5, f.z + .5, undefined, f.block); break;
      case 'lightning': this.bolt(f.x, f.y, f.z); break;
      default: break;
    }
  }
  /** A lightning bolt: a jagged white line from the sky, for a moment. */
  private bolt(x: number, y: number, z: number): void {
    const pts: THREE.Vector3[] = [];
    let cx = x, cz = z;
    for (let h = 60; h >= 0; h -= 4) { pts.push(new THREE.Vector3(cx, y + h, cz)); cx += (Math.random() - .5) * 1.6; cz += (Math.random() - .5) * 1.6; }
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0xf2f6ff }));
    this.d.scene.add(line);
    this.boltMeshes.push({ mesh: line, until: performance.now() + 220 });
    this.d.sound('thunder', new THREE.Vector3(x, y, z));
    this.d.burst('spark', x, y + 1, z, 0xdde8ff, 20);
  }
}
