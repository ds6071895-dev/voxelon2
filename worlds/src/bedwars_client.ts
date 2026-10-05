// Browser side of Bedwars. The server owns the match; this class presents it,
// predicts the two things that must feel instant (placing a block and the crack
// on one being mined) and keeps the HUD tiny.
import * as THREE from 'three';
import { BW_BASES } from './bedwars_map';
import { createBedwarsModels, type BedwarsModels } from './bedwars_models';
import { BedwarsWorld } from './bedwars_world';
import { BedwarsHud } from './bedwars_hud';
import { BedwarsShop, type BedwarsService } from './bedwars_shop';
import { BedwarsResults } from './bedwars_results';
import { bwBedAt, bwProtected } from './bedwars_map';
import { bwEntryOf } from './bedwars_catalog';
import {
  BW, bwBreakSeconds,
  type BwAction, type BwDropView, type BwPos, type BwProjectileView, type BwResult, type BwSnapshot, type BwTeam,
} from './bedwars_rules';
import { bwTime } from './bedwars_ui';
import { Block, BLOCKS, isReplaceable } from './blocks';
import { ITEMS, type ItemStack } from './items';
import type { Interaction } from './interact';
import type { NetClient } from './net/client';
import type { PartyState } from './net/protocol';
import type { Player } from './player';
import type { World } from './world';
import type { Inventory } from './inventory';
import type { BodyStyle, RemotePlayers } from './remoteplayers';
import type { Atlas } from './textures';
import './styles/bedwars.css';

interface Deps {
  scene: THREE.Scene;
  app: HTMLElement;
  net: NetClient;
  player: Player;
  world: World;
  inventory: Inventory;
  remotePlayers: RemotePlayers;
  atlas: Atlas;
  cracks: THREE.Texture[];
  interaction: Interaction;
  onPanel(): void;
  onReplay(): void;
  onEditTeams(): void;
  onLeave(): void;
  /** A block the local player just placed (for the sound). */
  onPlaced(x: number, y: number, z: number, block: number): void;
  onPickup(): void;
}

const SERVICE_REACH = 3.8;
const BREAK_INTERVAL = 150;
const PREDICT_TTL = 2500;
const SERVICE_NAMES: Record<BedwarsService, string> = { shop: 'Item Shop', upgrades: 'Team Upgrades', chest: 'Team Chest' };
const key = (x: number, y: number, z: number): string => `${x},${y},${z}`;

export class BedwarsClient {
  private enabled = false;
  private snapshot: BwSnapshot | null = null;
  private team: BwTeam = 0;
  private snapshotAt = 0;
  private elapsed = 0;
  private previousHealth = 20;
  private models: BedwarsModels | null = null;
  private scene3d: BedwarsWorld | null = null;
  private priorStyle: RemotePlayers['styleOf'] = null;
  private readonly style = (id: number): BodyStyle | null => {
    const player = this.snapshot?.players.find(value => value.id === id);
    if (!player) return null;
    return { rat: false, caged: false, glow: false, hidden: !player.alive || player.eliminated,
      tag: player.team === this.team || this.spectating };
  };

  private readonly hud: BedwarsHud;
  private readonly shop: BedwarsShop;
  private readonly results: BedwarsResults;
  private servicePosition: BwPos | null = null;

  /** Blocks anyone has placed this match; the map itself can never be broken. */
  private readonly placed = new Set<string>();
  private readonly predicted = new Map<string, { block: number; slot: number; at: number }>();
  private breakTarget: (BwPos & { slot: number; start: number; duration: number }) | null = null;
  private breakSentAt = 0;
  private breakTimer = 0;
  private breakAimedAt = 0;
  private placeAt = 0;
  private reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  constructor(private readonly d: Deps) {
    this.hud = new BedwarsHud(d.app, () => this.interact());
    this.shop = new BedwarsShop({
      host: d.app, atlasCanvas: d.atlas.canvas,
      send: action => this.send(action),
      count: item => d.inventory.countItem(item),
      onPanel: () => {
        if (this.shop.open) this.stopBreak(); else this.servicePosition = null;
        d.onPanel();
      },
    });
    this.results = new BedwarsResults(d.app, {
      onReplay: () => d.onReplay(), onEditTeams: () => d.onEditTeams(), onLeave: () => d.onLeave(),
      onOpen: () => d.onPanel(),
    });
    window.addEventListener('blur', () => { if (this.enabled) this.stopBreak(); });
    document.addEventListener('visibilitychange', () => { if (document.hidden && this.enabled) this.stopBreak(); });
  }

  get active(): boolean { return this.enabled; }
  /** True while a mining target is being worked (for the swing animation). */
  get isBreaking(): boolean { return this.breakTarget !== null; }
  get snap(): BwSnapshot | null { return this.snapshot; }
  get panelOpen(): boolean { return this.shop.open || this.results.open; }
  get resultOpen(): boolean { return this.results.open; }
  get spectating(): boolean {
    if (!this.enabled) return false;
    const self = this.self;
    return !!self && (!self.alive || self.eliminated);
  }
  get frozen(): boolean {
    if (!this.enabled) return false;
    const phase = this.snapshot?.phase;
    return !phase || phase === 'loading' || phase === 'countdown' || phase === 'results' || this.resultOpen || this.spectating;
  }
  /** Reach used when aiming a swing at another player. */
  get meleeReach(): number { return BW.MELEE_REACH; }
  private get self() { return this.snapshot?.players.find(player => player.id === this.d.net.myId); }
  private get since(): number { return Math.max(0, (performance.now() - this.snapshotAt) / 1000); }
  private get haste(): number { return this.snapshot?.teams[this.team]?.upgrades.haste ?? 0; }

  /** Main forwards party changes, including leadership changes during results. */
  setParty(party: PartyState | null, myId: number): void {
    this.results.setParty(party, myId);
  }

  enter(team: BwTeam): void {
    if (this.enabled) this.exit();
    this.enabled = true; this.team = team; this.snapshot = null;
    this.elapsed = 0; this.snapshotAt = performance.now();
    this.previousHealth = this.d.player.health;
    this.placed.clear(); this.predicted.clear();
    this.hud.reset(); this.hud.show(true);
    this.results.hide();
    document.body.classList.add('bedwars-active');
    this.models = createBedwarsModels();
    this.d.scene.add(this.models.group);
    this.scene3d = new BedwarsWorld(this.d.scene, this.d.world, this.d.atlas, this.d.cracks);
    this.d.interaction.alwaysHighlight = true;
    this.priorStyle = this.d.remotePlayers.styleOf;
    this.d.remotePlayers.styleOf = this.style;
    this.shop.reset();
    this.render();
  }

  exit(): void {
    this.stopBreak();
    this.enabled = false;
    this.hud.show(false); this.results.hide();
    this.shop.reset(); this.servicePosition = null;
    this.snapshot = null; this.placed.clear(); this.predicted.clear();
    this.models?.dispose(); this.models = null;
    this.scene3d?.dispose(); this.scene3d = null;
    this.d.interaction.alwaysHighlight = false; this.d.interaction.hideCrack();
    if (this.d.remotePlayers.styleOf === this.style) this.d.remotePlayers.styleOf = this.priorStyle;
    this.priorStyle = null;
    document.body.classList.remove('bedwars-active');
  }

  setState(s: BwSnapshot): void {
    if (!this.enabled || (this.d.net.worldId !== null && s.world !== this.d.net.worldId)) return;
    const before = this.self;
    this.snapshot = s; this.snapshotAt = performance.now();
    const self = this.self;
    if (self) this.team = self.team;
    if ((self && before && self.health < before.health) || this.frozen) { this.shop.close(); this.stopBreak(); }
    for (const team of s.teams) if (this.models?.beds[team.team]) this.models.beds[team.team].visible = team.bed;
    this.shop.update(s, this.d.net.myId, this.team);
    this.scene3d?.setZone(s.safeZone, s.phase !== 'results');
    this.scene3d?.setBreaks(s.breaks, this.d.net.myId);
    this.render();
    if (s.result && !this.results.open) this.setResult(s.result);
  }

  setKit(slots: (ItemStack | null)[]): void {
    if (!this.enabled) return;
    // The client's own selection wins; the server only mirrors it.
    this.d.inventory.restore(slots, this.d.inventory.selected);
    this.shop.update(this.snapshot, this.d.net.myId, this.team);
  }

  setDrops(msg: { reset?: boolean; add?: BwDropView[]; gone?: { id: number; by?: number; into?: number }[]; count?: { id: number; count: number }[] }): void {
    if (!this.enabled) return;
    if (msg.gone?.some(g => g.by === this.d.net.myId)) this.d.onPickup();
    this.scene3d?.applyDrops(msg, id => {
      if (id === this.d.net.myId) return this.d.player.eyePosition.setY(this.d.player.pos.y + 0.9);
      const r = this.d.net.remotes.get(id);
      return r ? new THREE.Vector3(r.tx, r.ty + 0.9, r.tz) : null;
    });
  }

  setProjectiles(list: BwProjectileView[]): THREE.Vector3[] {
    if (!this.enabled || !this.scene3d) return [];
    const blasts = this.scene3d.takeDetonations(list);
    this.scene3d.setProjectiles(list);
    return blasts;
  }

  event(text: string, tone = 'info'): void { if (this.enabled && text) this.hud.toast(text, tone); }

  buyResult(request: number, ok: boolean, message: string): void {
    if (!this.enabled) return;
    this.shop.buyResult(request, ok, message);
    if (!this.shop.open) this.hud.toast(message, ok ? 'good' : 'danger');
  }

  setResult(result: BwResult): void {
    if (!this.enabled) return;
    this.shop.close(); this.stopBreak();
    this.results.show(result, this.d.net.myId, this.team);
  }

  /** Any block edit that reaches this client: tracks what is breakable and
   *  settles placement predictions. */
  noteEdit(x: number, y: number, z: number, block: number): void {
    if (!this.enabled) return;
    const k = key(x, y, z);
    if (block === Block.Air) this.placed.delete(k); else if (bwBedAt(x, y, z) === null) this.placed.add(k);
    this.predicted.delete(k);
  }

  update(dt: number): void {
    if (!this.enabled) return;
    this.elapsed += Math.max(0, Math.min(dt, .1));
    this.models?.update(this.reducedMotion.matches ? 0 : this.elapsed);
    this.scene3d?.update(Math.min(dt, .1));
    const now = performance.now();
    if (this.shop.open && (this.d.player.health < this.previousHealth || this.frozen
      || !this.servicePosition || this.distance(this.servicePosition) > SERVICE_REACH)) this.shop.close();
    this.previousHealth = this.d.player.health;
    if (this.breakTarget && (this.frozen || this.panelOpen || now - this.breakAimedAt > 700)) this.stopBreak();
    this.drawCrack(now);
    for (const [k, p] of this.predicted) if (now - p.at > PREDICT_TTL) this.predicted.delete(k);
    this.hud.tick(now); this.results.tick(now);
    this.renderPrompt();
    this.render();
  }

  interact(): boolean {
    if (!this.enabled || this.frozen || this.panelOpen) return false;
    const nearest = this.nearestService();
    if (!nearest) return false;
    this.servicePosition = nearest.position;
    this.stopBreak();
    this.previousHealth = this.d.player.health;
    this.shop.update(this.snapshot, this.d.net.myId, this.team);
    this.shop.show(nearest.service, this.team);
    return true;
  }

  // ── Mining ─────────────────────────────────────────────────────────────
  /** Called every frame with what the crosshair is on while the button is down. */
  aimBreak(hit: BwPos | null, slot: number, active: boolean): void {
    if (!this.enabled || !active || !hit || this.frozen || this.panelOpen || !this.validSlot(slot) || !this.canBreak(hit)) { this.stopBreak(); return; }
    const now = performance.now();
    const t = this.breakTarget;
    const changed = !t || t.x !== hit.x || t.y !== hit.y || t.z !== hit.z || t.slot !== slot;
    if (changed) {
      this.stopBreak();
      const block = this.d.world.getBlock(hit.x, hit.y, hit.z);
      const held = this.d.inventory.slots[slot]?.id ?? 0;
      const duration = bwBreakSeconds(block, bwBedAt(hit.x, hit.y, hit.z) !== null, held, this.haste);
      this.breakTarget = { x: hit.x, y: hit.y, z: hit.z, slot, start: now, duration };
    }
    this.breakAimedAt = now;
    if (changed || now - this.breakSentAt >= BREAK_INTERVAL) {
      this.send({ kind: 'break', x: hit.x, y: hit.y, z: hit.z, slot }); this.breakSentAt = now;
    }
    // The server cancels a break whose heartbeat stops, so a long frame must
    // not look like the player let go: a timer keeps it alive between frames.
    if (!this.breakTimer) this.breakTimer = window.setInterval(() => this.keepBreaking(), 120);
  }
  private keepBreaking(): void {
    const t = this.breakTarget, now = performance.now();
    if (!t || !this.enabled || now - this.breakAimedAt > 700) { if (t) this.stopBreak(); else this.clearBreakTimer(); return; }
    this.send({ kind: 'break', x: t.x, y: t.y, z: t.z, slot: t.slot }); this.breakSentAt = now;
  }
  private clearBreakTimer(): void { if (this.breakTimer) { window.clearInterval(this.breakTimer); this.breakTimer = 0; } }
  private canBreak(v: BwPos): boolean {
    const bed = bwBedAt(v.x, v.y, v.z);
    if (bed !== null) return bed !== this.team && !!this.snapshot?.teams[bed]?.bed;
    return this.placed.has(key(v.x, v.y, v.z)) && !bwProtected(v.x, v.y, v.z);
  }
  private drawCrack(now: number): void {
    const t = this.breakTarget;
    if (!t) { this.d.interaction.hideCrack(); return; }
    this.d.interaction.showCrack(t.x, t.y, t.z, Math.min(1, (now - t.start) / 1000 / t.duration));
  }
  private stopBreak(): void {
    if (this.breakTarget) this.send({ kind: 'stopBreak' });
    this.breakTarget = null; this.breakSentAt = 0; this.clearBreakTimer();
    this.d.interaction.hideCrack();
  }

  // ── Placing ────────────────────────────────────────────────────────────
  /** Shows the block at once and asks the server; a refusal takes it back.
   *  `face` is the block that was aimed at and the side that was hit. */
  place(face: { x: number; y: number; z: number; nx: number; ny: number; nz: number }, slot: number): boolean {
    if (!this.enabled || this.frozen || this.panelOpen || !this.validSlot(slot)) return false;
    const now = performance.now();
    if (now < this.placeAt) return false;
    const stack = this.d.inventory.slots[slot], info = stack && ITEMS[stack.id];
    if (!stack || !info || info.kind !== 'block' || bwEntryOf(stack.id)?.type !== 'block') return false;
    const x = face.x + face.nx, y = face.y + face.ny, z = face.z + face.nz;
    if (y < 0 || y >= 256 || !isReplaceable(this.d.world.getBlock(x, y, z)) || bwProtected(x, y, z) || bwBedAt(x, y, z) !== null) return false;
    if (BLOCKS[info.block!].solid && this.d.player.intersectsBlock(x, y, z)) return false;
    this.placeAt = now + BW.PLACE_REPEAT_MS;
    this.d.world.setBlock(x, y, z, info.block!);
    this.predicted.set(key(x, y, z), { block: info.block!, slot, at: now });
    this.placed.add(key(x, y, z));
    this.d.inventory.consumeSelected(1);
    this.d.onPlaced(x, y, z, info.block!);
    this.send({ kind: 'place', x, y, z, slot });
    return true;
  }
  /** The server refused a placement the client had already drawn. */
  nack(x: number, y: number, z: number): void {
    if (!this.enabled) return;
    const k = key(x, y, z), p = this.predicted.get(k);
    if (!p) return;
    this.predicted.delete(k); this.placed.delete(k);
    if (this.d.world.getBlock(x, y, z) === p.block) this.d.world.setBlock(x, y, z, Block.Air);
    const inv = this.d.inventory, s = inv.slots[p.slot];
    if (s && s.id === p.block) s.count++; else if (!s) inv.slots[p.slot] = { id: p.block, count: 1 };
    inv.version++;
  }

  use(slot: number, dx: number, dy: number, dz: number): void {
    if (!this.enabled || this.frozen || this.panelOpen || !this.validSlot(slot) || ![dx, dy, dz].every(Number.isFinite)) return;
    const item = this.d.inventory.slots[slot];
    if (!item) return;
    const entry = bwEntryOf(item.id);
    if (entry?.type === 'bow') this.send({ kind: 'shoot', slot, dx, dy, dz, power: 1 });
    else if (entry && ['tnt', 'pearl', 'heal'].includes(entry.type)) this.send({ kind: 'use', slot, dx, dy, dz });
  }
  drop(slot: number, all: boolean): void {
    if (this.enabled && !this.frozen && !this.panelOpen && this.validSlot(slot)) this.send({ kind: 'drop', slot, all });
  }

  private send(action: BwAction): boolean {
    if (!this.enabled || !this.d.net.connected || this.d.net.worldId === null) return false;
    this.d.net.sendBwAction(action);
    return true;
  }
  private validSlot(slot: number): boolean { return Number.isInteger(slot) && slot >= 0 && slot < 9; }
  private distance(position: BwPos): number { return Math.hypot(this.d.player.pos.x - position.x, this.d.player.pos.y - position.y, this.d.player.pos.z - position.z); }
  private nearestService(): { service: BedwarsService; position: BwPos } | null {
    const base = BW_BASES.find(base => base.team === this.team);
    if (!base) return null;
    let nearest: { service: BedwarsService; position: BwPos } | null = null, distance = SERVICE_REACH;
    for (const service of ['shop', 'upgrades', 'chest'] as const) {
      const value = this.distance(base[service]);
      if (value <= distance) { distance = value; nearest = { service, position: base[service] }; }
    }
    return nearest;
  }

  // ── HUD ────────────────────────────────────────────────────────────────
  private renderPrompt(): void {
    if (this.frozen || this.panelOpen) { this.hud.setPrompt(null, 'E'); return; }
    const near = this.nearestService();
    this.hud.setPrompt(near ? SERVICE_NAMES[near.service] : null, document.documentElement.classList.contains('touch-ui') ? 'Tap' : 'E');
  }

  private render(): void {
    const s = this.snapshot, since = this.since, self = this.self;
    for (const team of [0, 1] as const) {
      const state = s?.teams[team];
      this.hud.setTeam(team, state?.bed ?? true, state?.alive ?? 0, team === this.team);
    }
    const phase = s?.phase ?? 'loading';
    if (!s) { this.hud.setClock('0:00', '', 'calm'); this.hud.setPill('Loading', 'info'); return; }
    const played = s.time + (phase === 'playing' || phase === 'suddenDeath' ? since : 0);
    const zone = s.safeZone;
    const sub = phase === 'countdown' ? 'Starting' : phase === 'results' ? 'Finished'
      : phase === 'suddenDeath' ? (zone.active ? 'Zone closing' : 'Sudden death')
      : `Beds break in ${bwTime((s.bedsIn - since) * 1000)}`;
    const tone = phase === 'suddenDeath' || (zone.active && phase !== 'results') ? 'danger' : phase === 'playing' && s.bedsIn - since < 30 ? 'warn' : 'calm';
    this.hud.setClock(bwTime(played * 1000), sub, tone);
    let pill: string | null = null, pillTone: 'info' | 'danger' = 'info';
    if (phase === 'loading') pill = 'Loading';
    else if (phase === 'countdown') pill = `Starting in ${Math.max(0, Math.ceil(s.countdown - since))}`;
    else if (self?.eliminated) pill = 'Eliminated. Spectating';
    else if (self && !self.alive) { pill = `Respawning in ${Math.max(0, Math.ceil(self.respawnIn - since))}`; pillTone = 'danger'; }
    else if (zone.active && phase !== 'results' && Math.hypot(this.d.player.pos.x - zone.x, this.d.player.pos.z - zone.z) > zone.radius) { pill = 'Outside the zone. Move to the middle'; pillTone = 'danger'; }
    this.hud.setPill(pill, pillTone);
  }
}
