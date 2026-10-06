// Browser side of Bedwars. The server owns the match; this class presents it,
// predicts the two things that must feel instant (placing a block and the crack
// on one being mined) and keeps the HUD tiny.
import * as THREE from 'three';
import { bwMap, type BedwarsMap } from './bedwars_map';
import { createBedwarsModels, type BedwarsModels } from './bedwars_models';
import { BedwarsWorld } from './bedwars_world';
import { BedwarsHud } from './bedwars_hud';
import { BedwarsShop, type BedwarsService } from './bedwars_shop';
import { BedwarsResults } from './bedwars_results';
import { bwEntryOf } from './bedwars_catalog';
import {
  BW, BW_TEAM_COLORS, bwBreakSeconds,
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
  /** Send the current pose before a placement so the server judges reach from it. */
  flushPose(held: number): void;
  /** A block the local player just placed (for the sound). */
  onPlaced(x: number, y: number, z: number, block: number): void;
  onPickup(): void;
}

const SERVICE_REACH = 3.8;
const BREAK_INTERVAL = 150;
const PREDICT_TTL = 2500;
const SERVICE_NAMES: Record<BedwarsService, string> = { shop: 'Item Shop', upgrades: 'Team Upgrades', chest: 'Team Chest' };
const key = (x: number, y: number, z: number): string => `${x},${y},${z}`;
/** Reach for placing into open air in front of your footing. */
const REACH_AROUND = 4.5;
type Face = { x: number; y: number; z: number; nx: number; ny: number; nz: number };

export class BedwarsClient {
  private enabled = false;
  private snapshot: BwSnapshot | null = null;
  /** The map this match is played on (the world seed). */
  map: BedwarsMap = bwMap(0);
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
    // Everyone's name shows in their team's colour, Hypixel style.
    return { rat: false, caged: false, glow: false, hidden: !player.alive || player.eliminated,
      tag: true, tagColor: BW_TEAM_COLORS[player.team] };
  };

  private readonly hud: BedwarsHud;
  private readonly shop: BedwarsShop;
  private readonly results: BedwarsResults;
  private servicePosition: BwPos | null = null;
  private readonly snapshotBeds = [true, true];

  /** Blocks anyone has placed this match; the map itself can never be broken. */
  private readonly placed = new Set<string>();
  private readonly predicted = new Map<string, { block: number; slot: number; at: number }>();
  private breakTarget: (BwPos & { slot: number; start: number; duration: number }) | null = null;
  private breakSentAt = 0;
  private breakTimer = 0;
  private breakAimedAt = 0;
  private placeAt = 0;
  /** Face normal the held place button is building along. */
  private buildLock: [number, number, number] | null = null;
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

  enter(team: BwTeam, mapId: number): void {
    if (this.enabled) this.exit();
    this.enabled = true; this.team = team; this.snapshot = null;
    this.elapsed = 0; this.snapshotAt = performance.now();
    this.previousHealth = this.d.player.health;
    this.placed.clear(); this.predicted.clear(); this.snapshotBeds.fill(true);
    this.hud.reset(); this.hud.show(true);
    this.results.hide();
    document.body.classList.add('bedwars-active');
    this.map = bwMap(mapId);
    this.scene3d = new BedwarsWorld(this.d.scene, this.d.world, this.d.atlas, this.d.cracks, this.map);
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
    // The props need to know which islands are in play: build them on the
    // first snapshot.
    if (!this.models) { this.models = createBedwarsModels(this.map, s.teamCount, this.d.atlas); this.d.scene.add(this.models.group); }
    if ((self && before && self.health < before.health) || this.frozen) { this.shop.close(); this.stopBreak(); }
    for (const team of s.teams) {
      if (this.models?.beds[team.team]) this.models.beds[team.team].visible = team.bed;
      const was = before ? this.snapshotBeds[team.team] : true;
      if (was && !team.bed && before && s.phase !== 'suddenDeath') {
        if (team.team === this.team) this.hud.flash('Bed destroyed!', 'You will no longer respawn', 'danger');
        else this.hud.flash('Enemy bed destroyed!', 'Finish them off', 'good');
      }
      this.snapshotBeds[team.team] = team.bed;
    }
    this.shop.update(s, this.d.net.myId, this.team);
    this.scene3d?.setZone(s.safeZone, s.phase !== 'results');
    this.scene3d?.setBreaks(s.breaks, this.d.net.myId);
    this.scene3d?.setGenerators(s.gens ?? []);
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
    if (block === Block.Air) this.placed.delete(k); else if (this.map.bedAt(x, y, z) === null) this.placed.add(k);
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
      const duration = bwBreakSeconds(block, this.map.bedAt(hit.x, hit.y, hit.z) !== null, held, this.haste);
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
    const bed = this.map.bedAt(v.x, v.y, v.z);
    if (bed !== null) return bed !== this.team && !!this.snapshot?.teams[bed]?.bed;
    return this.placed.has(key(v.x, v.y, v.z)) && !this.map.isProtected(v.x, v.y, v.z);
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

  // ── Placing (Bedrock rules) ──────────────────────────────────────────
  // Holding place puts a block down the moment the aim reaches a NEW spot (no
  // fixed repeat delay), the build direction locks to the first block's face
  // while the button stays down, and aiming at open air just past the block
  // you stand on still places in front of it ("reach-around"), which is what
  // makes walking-forward bridging possible.
  /** Called every frame while place is held with a block selected. Returns true
   *  when a block went down. `fresh` is the frame the button was pressed. */
  build(face: Face | null, eye: THREE.Vector3, look: THREE.Vector3, slot: number, fresh: boolean): boolean {
    if (fresh) this.buildLock = null;
    if (!this.enabled || this.frozen || this.panelOpen || !this.validSlot(slot)) return false;
    const now = performance.now();
    if (now < this.placeAt) return false;
    const locked = (f: Face): boolean => !this.buildLock
      || (f.nx === this.buildLock[0] && f.ny === this.buildLock[1] && f.nz === this.buildLock[2]);
    let pick = face && locked(face) && this.placeable(face) ? face : null;
    if (!face && !pick) { const around = this.reachAround(eye, look); if (around && locked(around)) pick = around; }
    if (!pick || !this.commitPlace(pick, slot, now)) return false;
    this.buildLock = [pick.nx, pick.ny, pick.nz];
    return true;
  }
  /** The cell in front of the block under your feet, if the look ray passes
   *  through it within reach. */
  private reachAround(eye: THREE.Vector3, look: THREE.Vector3): Face | null {
    const p = this.d.player, w = this.d.world;
    if (Math.abs(look.y) > 0.999) return null;
    const y = Math.floor(p.pos.y - 0.01);
    const horizontal = Math.abs(look.x) >= Math.abs(look.z);
    const nx = horizontal ? Math.sign(look.x) : 0, nz = horizontal ? 0 : Math.sign(look.z);
    // The support is whichever cell under the body reaches furthest that way,
    // so a player already leaning past the edge still builds from its rim.
    let support: { x: number; z: number } | null = null, best = -Infinity;
    for (const dx of [-0.29, 0.29]) for (const dz of [-0.29, 0.29]) {
      const x = Math.floor(p.pos.x + dx), z = Math.floor(p.pos.z + dz);
      if (!BLOCKS[w.getBlock(x, y, z)]?.solid) continue;
      const along = x * nx + z * nz;
      if (along > best) { best = along; support = { x, z }; }
    }
    if (!support) return null;
    const cell = { x: support.x + nx, y, z: support.z + nz };
    if (!isReplaceable(w.getBlock(cell.x, cell.y, cell.z))) return null;
    // The look ray has to pass through the space just ahead of your feet: the
    // empty cell and a little over a block above it, so a forward-and-down look
    // at the edge builds, while looking out at the horizon never does.
    let enter = 0, exit = REACH_AROUND;
    const o = [eye.x, eye.y, eye.z], d = [look.x, look.y, look.z], lo = [cell.x, cell.y, cell.z], hi = [cell.x + 1, cell.y + 2.2, cell.z + 1];
    for (let i = 0; i < 3; i++) {
      if (Math.abs(d[i]) < 1e-9) { if (o[i] < lo[i] || o[i] > hi[i]) return null; continue; }
      const t1 = (lo[i] - o[i]) / d[i], t2 = (hi[i] - o[i]) / d[i];
      enter = Math.max(enter, Math.min(t1, t2)); exit = Math.min(exit, Math.max(t1, t2));
      if (enter > exit) return null;
    }
    return { x: support.x, y, z: support.z, nx, ny: 0, nz };
  }
  private placeable(face: Face): boolean {
    const x = face.x + face.nx, y = face.y + face.ny, z = face.z + face.nz;
    return y >= 0 && y < 256 && isReplaceable(this.d.world.getBlock(x, y, z)) && !this.map.isProtected(x, y, z) && this.map.bedAt(x, y, z) === null;
  }
  /** Shows the block at once and asks the server; a refusal takes it back.
   *  `face` is the block that was aimed at and the side that was hit. */
  place(face: Face, slot: number): boolean {
    if (!this.enabled || this.frozen || this.panelOpen || !this.validSlot(slot)) return false;
    const now = performance.now();
    return now >= this.placeAt && this.placeable(face) && this.commitPlace(face, slot, now);
  }
  private commitPlace(face: Face, slot: number, now: number): boolean {
    const stack = this.d.inventory.slots[slot], info = stack && ITEMS[stack.id];
    if (!stack || !info || info.kind !== 'block' || bwEntryOf(stack.id)?.type !== 'block') return false;
    const x = face.x + face.nx, y = face.y + face.ny, z = face.z + face.nz;
    if (!this.placeable(face) || (BLOCKS[info.block!].solid && this.d.player.intersectsBlock(x, y, z))) return false;
    this.placeAt = now + BW.PLACE_REPEAT_MS;
    this.d.flushPose(stack.id);
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

  private send(action: BwAction): boolean {
    if (!this.enabled || !this.d.net.connected || this.d.net.worldId === null) return false;
    this.d.net.sendBwAction(action);
    return true;
  }
  private validSlot(slot: number): boolean { return Number.isInteger(slot) && slot >= 0 && slot < 9; }
  private distance(position: BwPos): number { return Math.hypot(this.d.player.pos.x - position.x, this.d.player.pos.y - position.y, this.d.player.pos.z - position.z); }
  private nearestService(): { service: BedwarsService; position: BwPos } | null {
    const base = this.map.bases[this.team];
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
    const phase = s?.phase ?? 'loading';
    if (!s) { this.hud.setPill('Loading', 'info'); return; }
    const played = s.time + (phase === 'playing' || phase === 'suddenDeath' ? since : 0);
    const zone = s.safeZone;
    const next = s.next ? Math.max(0, s.next.in - (phase === 'playing' || phase === 'suddenDeath' ? since : 0)) : 0;
    const nextLine = phase === 'countdown' ? 'Starting soon' : phase === 'results' ? 'Game over'
      : s.next ? `${s.next.label} in ${bwTime(next * 1000)}` : 'Deathmatch';
    const tone = phase === 'suddenDeath' || (zone.active && phase !== 'results') ? 'danger' : s.next && next < 30 ? 'warn' : 'calm';
    this.hud.setSidebar({
      next: nextLine, clock: bwTime(played * 1000), tone,
      teams: s.teams.map(t => ({ team: t.team, bed: t.bed, alive: t.alive, mine: t.team === this.team })),
      kills: self?.kills ?? 0, finals: self?.finals ?? 0, beds: self?.beds ?? 0,
    });
    let pill: string | null = null, pillTone: 'info' | 'danger' = 'info';
    if (phase === 'loading') pill = 'Loading';
    else if (phase === 'countdown') pill = `Starting in ${Math.max(0, Math.ceil(s.countdown - since))}`;
    else if (zone.active && phase !== 'results' && self?.alive && Math.hypot(this.d.player.pos.x - zone.x, this.d.player.pos.z - zone.z) > zone.radius) { pill = 'Outside the zone. Move to the middle'; pillTone = 'danger'; }
    this.hud.setPill(pill, pillTone);
    if (phase === 'results' || !self) this.hud.setTitle(null);
    else if (self.eliminated) this.hud.setTitle('Eliminated', 'Your team is out. Spectating', 'info');
    else if (!self.alive) this.hud.setTitle('You died!', `Respawning in ${Math.max(1, Math.ceil(self.respawnIn - since))}`);
    else this.hud.setTitle(null);
  }
}
