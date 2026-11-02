// The shared survival simulation behind Lucky Pillars and Disaster City (and
// the parts of Party Games that need it). Holds every player's vanilla state
// (inventory, health, hunger, effects, fire, air, freezing, cooldowns), runs
// the world's entities, fluids and explosions, and applies Java Edition
// rules to each action. Engines configure it through SimRules and decide
// what death means (elimination, spectating).

import { BLOCKS, Block, collisionBoxes } from '../blocks';
import type { ModeHost, Edit } from '../net/mode_engine';
import { isSupported } from '../movement_authority';
import { VB, VMETA, isFluid, lavaAt, waterAt, withState } from './blocks';
import { VITEM, VI, maxStackOf, type UseKind } from './items';
import { cloneStack, enchLevel, type VStack } from './stack';
import { EffectSet, POTIONS, instantAmount, isEffectId, type EffectId } from './effects';
import { EXHAUST, Hunger } from './hunger';
import {
  armorOf, arrowDamage, bowPower, explosionDamage, fallDamage, meleeHit, protectionEpf, reduceDamage,
  shieldFaces, SHIELD_DISABLE_TICKS, SHIELD_RAISE_TICKS, TOTEM_EFFECTS, type DamageSource,
} from './combat';
import { breakTicks, dropsOf } from './tools';
import {
  ARMOR0, OFFHAND, addToInventory, click, closeWindow, emptyInventory, newWindow, refreshCrafting,
  type InvState, type Win, type WinKind,
} from './inventory_model';
import { COOK_TICKS, SMOKER_TICKS, fuelTicks, smeltResult } from './crafting';
import { mergeInto, neighbourUpdates, placeBlock, stationOf, useBlock, type PlaceCtx } from './block_states';
import { ARTHROPOD, EntityWorld, KINDS, UNDEAD, exposure, moveBox, rayBlocks, segmentHitsBox, stepPhysics, type Entity, type EntityKind } from './entity';
import { BOAT, NO_CONTROLS, stepBoat, waterSurface } from './boat';
import { tickMob, type MobCtx, type Target } from './mobs';
import { Fluids } from './fluids';
import { explosionCells } from './explosion';
import { DEFAULT_MOVE, ENT_FLAG, type FxEvent, type MAction, type MoveProfile, type SelfView } from './messages';

export interface SimRules {
  pvp: boolean;
  naturalRegen: boolean;
  hunger: boolean;
  fallDamage: boolean;
  blockDrops: boolean;
  /** Disaster City: glass always drops itself. */
  glassSelf?: boolean;
  /** Explosions destroy blocks. */
  explosionsBreak: boolean;
  /** Fluids flow (Lucky Pillars buckets). */
  fluidsFlow: boolean;
  canBreak(id: number, x: number, y: number, z: number, block: number): boolean;
  canPlace(id: number, x: number, y: number, z: number, block: number): boolean;
  /** Items that cannot be used (Disaster City blocks buckets, flint and steel...). */
  blockedUse?(id: number, stack: VStack, player?: number): boolean;
  /** TNT lights itself when placed (Lucky Pillars' Instant TNT): fuse ticks. */
  instantTntFuse?: number;
  /** A lethal hit got through (no totem). Engine eliminates/respawns. */
  onLethal(id: number, src: DamageSource): void;
  /** A player damaged another (vampires, kill credit bookkeeping). */
  onPlayerHurt?(victim: number, src: DamageSource, dealt: number): void;
  /** Extra damage scaling by kind (Disaster City's survival kits). */
  damageScale?(id: number, src: DamageSource): number;
  /** Right-click on a menu item (survival book, ghost tricks...). */
  onMenuItem?(id: number, stack: VStack, slot: number): void;
  /** A mode's own consumables (Disaster City's supplies). True = handled. */
  onUseItem?(id: number, stack: VStack, slot: number): boolean;
  /** Attribute deltas for a player (twists): max health, scale, gravity, knockback, reach, safe fall. */
  attributes?(id: number): Partial<Attributes>;
  /** Mobs' follow range (Disaster City zombies: 64). */
  mobFollowRange?: number;
  mobSpeedMult?(): number;
  mobDamage?: number;
  /** Mob hits players only when this says so (eliminated players excluded). */
  isTargetable?(id: number): boolean;
  /** Called after any block edit so engines can track repairs etc. */
  onEdit?(x: number, y: number, z: number, from: number, to: number): void;
  /** Explosion origin hook for credit ("whoever lit the TNT"). */
  creditTicks?: number;
  onProjectile?(e: Entity, target: { player?: number; ent?: Entity; block?: { x: number; y: number; z: number } }): boolean;
  doubleJumps?(id: number): number;
  /** An arrow stuck in a block (Party Games targets). True removes the arrow. */
  onArrowBlock?(e: Entity, x: number, y: number, z: number): boolean;
  /** A player finished breaking a block (after it became air). */
  onBroken?(id: number, x: number, y: number, z: number, block: number): void;
  /** A player placed blocks from hotbar slot `slot`. */
  onPlaced?(id: number, slot: number, edits: Edit[]): void;
}

export interface Attributes { maxHealth: number; scale: number; gravity: number; knockback: number; reach: number; safeFall: number; attackSpeed?: number }
const BASE_ATTR: Attributes = { maxHealth: 20, scale: 1, gravity: 1, knockback: 0, reach: 0, safeFall: 0 };

export interface VPlayer {
  id: number; bot: boolean;
  inv: InvState; selected: number; win: Win | null; winId: number; winAt?: { x: number; y: number; z: number }; rev: number; invDirty: boolean;
  hp: number; absorption: number; hunger: Hunger; effects: EffectSet;
  fire: number; air: number; freeze: number;
  attackTicks: number; invul: number; lastDamage: number;
  using: { slot: number; kind: UseKind; since: number; offhand: boolean } | null;
  shieldDisabledUntil: number;
  dig: { x: number; y: number; z: number; block: number; began: number; heard: number; ticks: number } | null;
  lastAttacker: number | null; lastAttackerAt: number; lastCause: string;
  fallDist: number; lastY: number; lastX: number; lastZ: number; onGround: boolean; speed: number; sprinting: boolean;
  alive: boolean; spectator: boolean;
  gliding: boolean;
  /** The boat entity this player sits in. */
  riding: number | null;
  cooldowns: Map<number, number>;
  selfKey: string;
  envTimer: number;
  hooked?: number;
  /** Items received (Lucky Pillars results). */
  received: number;
  frozen: boolean;
  /** A mode drives freezing itself (Disaster City's blizzard): no thaw here. */
  customFreeze?: boolean;
  /** Can't be hurt (a match's winner during the celebration). */
  godmode?: boolean;
  /** XP-style progress bar (Lucky Pillars' next item) and its number. */
  xpBar: number; xpLevel: number;
}

const RANGE = 4.5;
let windowSeq = 1;

export class Sim {
  readonly players = new Map<number, VPlayer>();
  readonly ents = new EntityWorld();
  readonly fluids: Fluids;
  tickNo = 0;
  private fx: FxEvent[] = [];
  /** Furnaces/chests by cell key. */
  readonly containers = new Map<string, Win & { burn: number; burnMax: number; cook: number }>();
  /** Who caused an explosion/hazard entity (kill credit). */
  private credit = new Map<number, number>();

  constructor(readonly host: ModeHost, readonly rules: SimRules, readonly rng: () => number) {
    this.fluids = new Fluids(96);
  }

  // ── Players ──────────────────────────────────────────────────────────────

  addPlayer(id: number, bot: boolean): VPlayer {
    const b = this.host.body(id);
    const p: VPlayer = {
      id, bot, inv: emptyInventory(), selected: 0, win: null, winId: 0, rev: 0, invDirty: true,
      hp: 20, absorption: 0, hunger: new Hunger(), effects: new EffectSet(), fire: 0, air: 300, freeze: 0,
      attackTicks: 100, invul: 0, lastDamage: 0, using: null, shieldDisabledUntil: 0, dig: null,
      lastAttacker: null, lastAttackerAt: -1e9, lastCause: '',
      fallDist: 0, lastY: b?.y ?? 0, lastX: b?.x ?? 0, lastZ: b?.z ?? 0, onGround: true, speed: 0, sprinting: false,
      alive: true, spectator: false, gliding: false, riding: null, cooldowns: new Map(), selfKey: '', envTimer: 0, received: 0, frozen: false, xpBar: 0, xpLevel: 0,
    };
    p.hunger.saturation = 5;
    this.players.set(id, p);
    return p;
  }
  attr(id: number): Attributes { return { ...BASE_ATTR, ...this.rules.attributes?.(id) }; }
  maxHp(id: number): number { return this.attr(id).maxHealth; }
  held(p: VPlayer): VStack | null { return p.inv.slots[p.selected] ?? null; }
  armor(p: VPlayer): (VStack | null)[] { return p.inv.slots.slice(ARMOR0, ARMOR0 + 4); }

  /** Give items; anything that does not fit drops at the player's feet. Armour
   *  goes straight onto an empty slot (except the elytra) when `equip`. */
  give(id: number, stacks: VStack[], equip = false): void {
    const p = this.players.get(id), b = this.host.body(id);
    if (!p || !b) return;
    for (const s of stacks) {
      p.received++;
      const a = VITEM[s.id]?.armor;
      if (equip && a && VITEM[s.id]?.key !== 'elytra') {
        const slot = ARMOR0 + ['head', 'chest', 'legs', 'feet'].indexOf(a.slot);
        if (!p.inv.slots[slot]) { p.inv.slots[slot] = cloneStack(s); continue; }
      }
      const left = addToInventory(p.inv, s);
      if (left) this.dropItem(b.x, b.y + .2, b.z, left, 0, 0, 0, 0);
    }
    p.invDirty = true;
  }
  setHp(p: VPlayer, hp: number): void {
    p.hp = Math.max(0, Math.min(this.maxHp(p.id), hp));
    this.host.setHealth(p.id, Math.ceil(p.hp), !p.alive);
  }
  heal(id: number, amount: number): void {
    const p = this.players.get(id);
    if (p?.alive) this.setHp(p, p.hp + amount);
  }

  // ── Effects/fx/output ────────────────────────────────────────────────────

  emit(f: FxEvent): void { this.fx.push(f); }
  sound(s: string, x?: number, y?: number, z?: number, pitch?: number): void { this.fx.push({ f: 'sound', s, x, y, z, pitch }); }
  addEffect(id: number, eff: EffectId, amp: number, ticks: number): void {
    const p = this.players.get(id);
    if (!p || !p.alive) return;
    if (eff === 'instant_health') { this.heal(id, instantAmount(eff, amp)); return; }
    if (eff === 'instant_damage') { this.damage(id, { kind: 'magic', amount: instantAmount(eff, amp), label: 'magic' }); return; }
    if (p.effects.add(eff, amp, ticks) && eff === 'absorption') p.absorption = Math.max(p.absorption, 4 * (amp + 1));
  }

  // ── Damage ───────────────────────────────────────────────────────────────

  /** Apply damage through invulnerability frames, fire resistance, shields,
   *  armour, Resistance, Protection and absorption. Returns HP actually lost. */
  damage(id: number, src: DamageSource): number {
    const p = this.players.get(id), b = this.host.body(id);
    if (!p || !b || !p.alive || p.spectator || p.godmode) return 0;
    if (src.by !== undefined && !src.byEntity && src.by !== id && !this.rules.pvp) return 0;
    if ((src.kind === 'fire' || src.kind === 'lava' || src.kind === 'burning') && p.effects.has('fire_resistance')) return 0;
    let amount = src.amount * (this.rules.damageScale?.(id, src) ?? 1);
    if (amount <= 0) return 0;
    const iframed = p.invul > 10 && src.kind !== 'void' && src.kind !== 'border';
    if (iframed) {
      if (amount <= p.lastDamage) return 0;
      const extra = amount - p.lastDamage;
      p.lastDamage = amount; amount = extra;
    } else { p.invul = 20; p.lastDamage = amount; }
    // Shield.
    if (p.using?.kind === 'shield' && this.tickNo - p.using.since >= SHIELD_RAISE_TICKS && src.from &&
      (src.kind === 'melee' || src.kind === 'projectile' || src.kind === 'explosion') && shieldFaces(b.yaw, src.from, b)) {
      const sh = p.inv.slots[p.using.offhand ? OFFHAND : p.using.slot];
      if (sh && amount >= 3) this.wear(p, p.using.offhand ? OFFHAND : p.using.slot, 1 + Math.floor(amount));
      if (src.axe) { p.shieldDisabledUntil = this.tickNo + SHIELD_DISABLE_TICKS; p.using = null; this.sound('shield_break', b.x, b.y, b.z); }
      else this.sound('shield_block', b.x, b.y, b.z);
      return 0;
    }
    const worn = this.armor(p);
    const a = armorOf(worn);
    let dmg = reduceDamage({ ...src, amount }, { armor: a.armor, toughness: a.toughness, epf: protectionEpf(worn, src.kind), effects: p.effects });
    if (a.armor > 0 && (src.kind === 'melee' || src.kind === 'projectile' || src.kind === 'explosion' || src.kind === 'lightning' || src.kind === 'anvil')) {
      for (let i = 0; i < 4; i++) if (worn[i]) this.wear(p, ARMOR0 + i, Math.max(1, Math.floor(amount / 4)));
    }
    const absorbed = Math.min(p.absorption, dmg);
    p.absorption -= absorbed; dmg -= absorbed;
    if (src.by !== undefined && src.by !== id) { p.lastAttacker = src.by; p.lastAttackerAt = this.tickNo; }
    p.lastCause = src.label ?? src.kind;
    p.hunger.exhaust(EXHAUST.hurt);
    this.emit({ f: 'hurt', id });
    if (p.hp - dmg <= 0) {
      if (this.tryTotem(p)) return dmg;
      p.hp = 0;
      this.rules.onLethal(id, src);
      return dmg;
    }
    this.setHp(p, p.hp - dmg);
    if (src.by !== undefined) this.rules.onPlayerHurt?.(id, src, dmg + absorbed);
    return dmg + absorbed;
  }
  private tryTotem(p: VPlayer): boolean {
    for (const slot of [p.selected, OFFHAND]) {
      const s = p.inv.slots[slot];
      if (s?.id !== VI.totem_of_undying) continue;
      p.inv.slots[slot] = null; p.invDirty = true;
      p.effects.clear(); p.absorption = 0;
      for (const [e, amp, t] of TOTEM_EFFECTS) this.addEffect(p.id, e as EffectId, amp, t);
      this.setHp(p, 1);
      this.emit({ f: 'totem', id: p.id });
      this.sound('totem', this.host.body(p.id)?.x, this.host.body(p.id)?.y, this.host.body(p.id)?.z);
      return true;
    }
    return false;
  }
  /** Knock a player back (vanilla strength 0.4 + 0.5 per knockback level). */
  knock(id: number, fromX: number, fromZ: number, level: number, by: number): void {
    const p = this.players.get(id), b = this.host.body(id);
    if (!p || !b || !p.alive) return;
    const kb = armorOf(this.armor(p)).kb;
    let dx = b.x - fromX, dz = b.z - fromZ;
    const len = Math.hypot(dx, dz) || 1;
    dx /= len; dz /= len;
    const strength = (.4 + .5 * Math.max(0, level)) * (1 - Math.min(1, kb));
    const up = p.onGround ? .4 : .1;
    this.host.impulse(id, dx * strength * 20, up * 20 * (1 - Math.min(1, kb)), dz * strength * 20, by, Math.ceil(p.hp));
  }
  /** Tool/armour durability. Unbreaking skips with chance level/(level+1). */
  wear(p: VPlayer, slot: number, amount: number): void {
    const s = p.inv.slots[slot];
    const max = s ? VITEM[s.id]?.durability : undefined;
    if (!s || !max) return;
    const unb = enchLevel(s, 'unbreaking');
    let used = 0;
    for (let i = 0; i < amount; i++) if (unb === 0 || this.rng() < 1 / (unb + 1)) used++;
    s.dmg = (s.dmg ?? 0) + used;
    if (s.dmg >= max) { p.inv.slots[slot] = null; const b = this.host.body(p.id); this.sound('item_break', b?.x, b?.y, b?.z); }
    p.invDirty = true;
  }

  // ── Actions ──────────────────────────────────────────────────────────────

  handle(id: number, a: MAction): void {
    const p = this.players.get(id);
    if (!p || !a || typeof a !== 'object') return;
    if (a.k === 'click' || a.k === 'closeWin' || a.k === 'openInv' || a.k === 'select' || a.k === 'swapHands') { this.inventoryAction(p, a); return; }
    if (!p.alive || p.spectator || p.frozen) return;
    switch (a.k) {
      case 'attack': if (typeof a.target === 'number') this.attackPlayer(p, a.target); else if (typeof a.ent === 'number') this.attackEntity(p, a.ent); break;
      case 'use': this.use(p, a); break;
      case 'useEnd': this.useEnd(p); break;
      case 'dig': this.dig(p, a.x | 0, a.y | 0, a.z | 0); break;
      case 'digStop': p.dig = null; break;
      case 'glide': this.glide(p, a.on === true); break;
      case 'dismount': this.dismount(p); break;
      default: break;
    }
  }

  private inventoryAction(p: VPlayer, a: MAction): void {
    const b = this.host.body(p.id);
    if (a.k === 'select') { if (Number.isInteger(a.slot) && a.slot >= 0 && a.slot < 9) { if (p.using && p.using.slot !== a.slot) p.using = null; p.selected = a.slot; p.dig = null; p.invDirty = true; } return; }
    if (a.k === 'swapHands') { const s = p.inv.slots[p.selected]; p.inv.slots[p.selected] = p.inv.slots[OFFHAND]; p.inv.slots[OFFHAND] = s; p.invDirty = true; return; }
    if (a.k === 'openInv') { this.openWindow(p, 'inventory'); return; }
    if (a.k === 'closeWin') {
      const spill = closeWindow(p.inv, p.win?.kind === 'crafting' ? p.win : null);
      if (p.win && p.win.kind !== 'crafting' && p.winAt) this.flushContainer(p);
      p.win = null; p.winId = 0; p.winAt = undefined;
      if (b) for (const s of spill) this.dropItem(b.x, b.y + 1.3, b.z, s, b.yaw, .3, p.id, 40);
      p.invDirty = true;
      this.host.send(p.id, { k: 'win', v: null });
      return;
    }
    if (a.k !== 'click' || !p.alive) return;
    if (a.rev !== p.rev && a.win === p.winId) { /* stale: still apply, client resyncs from the reply */ }
    const win = a.win === p.winId && p.win && p.win.kind !== 'inventory' ? p.win : null;
    if (!Number.isInteger(a.slot)) return;
    const spill = click(p.inv, win, a.slot, a.button === 1 ? 1 : 0, a.mode, a.hotbar ?? 0);
    if (b) for (const s of spill) this.dropItem(b.x, b.y + 1.3, b.z, s, b.yaw, .3, p.id, 40);
    p.invDirty = true;
    if (win) this.sendWindow(p);
  }

  private openWindow(p: VPlayer, kind: WinKind, at?: { x: number; y: number; z: number }): void {
    if (kind === 'inventory') { p.win = null; p.winId = 0; refreshCrafting(p.inv, null); p.invDirty = true; this.host.send(p.id, { k: 'win', v: { id: 0, kind: 'inventory', title: 'Inventory', slots: [] } }); return; }
    const key = at ? `${at.x},${at.y},${at.z}` : '';
    let win: Win;
    if (kind === 'crafting') win = newWindow('crafting');
    else {
      let c = this.containers.get(key);
      if (!c) { c = { ...newWindow(kind), burn: 0, burnMax: 0, cook: 0 }; this.containers.set(key, c); }
      win = c;
    }
    p.win = win; p.winId = windowSeq++; p.winAt = at;
    this.sendWindow(p);
  }
  private flushContainer(_p: VPlayer): void { /* containers are shared objects: nothing to copy back */ }
  sendWindow(p: VPlayer): void {
    if (!p.win) return;
    const c = p.win as Win & { burn?: number; burnMax?: number; cook?: number };
    const title = p.win.kind === 'crafting' ? 'Crafting' : p.win.kind === 'furnace' ? 'Furnace' : p.win.kind === 'smoker' ? 'Smoker' : p.win.kind === 'barrel' ? 'Barrel' : 'Chest';
    this.host.send(p.id, { k: 'win', v: {
      id: p.winId, kind: p.win.kind, title, slots: p.win.slots,
      cook: c.cook !== undefined ? c.cook / (p.win.kind === 'smoker' ? SMOKER_TICKS : COOK_TICKS) : undefined,
      burn: c.burnMax ? (c.burn ?? 0) / c.burnMax : undefined,
    } });
  }

  private reachOk(p: VPlayer, x: number, y: number, z: number, extra = 0): boolean {
    const b = this.host.body(p.id);
    if (!b) return false;
    const r = RANGE + this.attr(p.id).reach + extra + 1;
    return Math.hypot(b.x - x, b.y + 1.6 * this.attr(p.id).scale - y, b.z - z) <= r;
  }

  private attackPlayer(p: VPlayer, targetId: number): void {
    const t = this.players.get(targetId), a = this.host.body(p.id), tb = this.host.body(targetId);
    if (!t || !a || !tb || targetId === p.id || !t.alive || t.spectator || !this.rules.pvp) return;
    const reach = 3 + this.attr(p.id).reach + 1.2; // latency tolerance
    if (Math.hypot(a.x - tb.x, a.z - tb.z) > reach + .3 * this.attr(targetId).scale || Math.abs(a.y - tb.y) > 3.5) return;
    const held = this.held(p);
    const hit = meleeHit({
      held, ticksSinceAttack: p.attackTicks, effects: p.effects, falling: p.fallDist > 0 && !p.onGround, onGround: p.onGround,
      inWater: isFluid(this.host.getBlock(Math.floor(a.x), Math.floor(a.y), Math.floor(a.z)), 'water'), climbing: false,
      sprinting: p.sprinting, fallDistance: p.fallDist, targetUndead: false, targetArthropod: false,
    });
    p.attackTicks = 0;
    p.hunger.exhaust(EXHAUST.attack);
    this.emit({ f: 'swing', id: p.id });
    const dealt = this.damage(targetId, { kind: 'melee', amount: hit.damage, by: p.id, from: { x: a.x, z: a.z }, breach: hit.breach, axe: hit.axe, label: 'melee' });
    if (dealt > 0 || t.invul === 20) {
      this.knock(targetId, a.x, a.z, hit.knockback + this.attr(p.id).knockback, p.id);
      if (hit.fireTicks) t.fire = Math.max(t.fire, hit.fireTicks);
      if (hit.crit) this.emit({ f: 'burst', kind: 'crit', x: tb.x, y: tb.y + 1, z: tb.z });
      if (p.sprinting && hit.scale > .9) p.sprinting = false;
    }
    if (held && VITEM[held.id]?.attack) this.wear(p, p.selected, VITEM[held.id]?.tool?.kind === 'sword' || VITEM[held.id]?.key === 'trident' || VITEM[held.id]?.key === 'mace' ? 1 : 2);
    if (hit.smash) {
      p.fallDist = 0;
      const burst = enchLevel(held, 'wind_burst');
      if (burst > 0) this.host.impulse(p.id, 0, (.8 + .35 * (burst - 1)) * 20, 0, p.id, Math.ceil(p.hp));
      this.sound('mace_smash', tb.x, tb.y, tb.z);
    }
    if (hit.sweep) {
      for (const o of this.players.values()) {
        if (o.id === p.id || o.id === targetId || !o.alive) continue;
        const ob = this.host.body(o.id);
        if (ob && Math.hypot(ob.x - tb.x, ob.z - tb.z) < 1.5 && Math.abs(ob.y - tb.y) < .5) {
          this.damage(o.id, { kind: 'melee', amount: 1, by: p.id, from: { x: a.x, z: a.z }, label: 'melee' });
          this.knock(o.id, a.x, a.z, 0, p.id);
        }
      }
    }
  }

  private attackEntity(p: VPlayer, entId: number): void {
    const e = this.ents.all.get(entId), a = this.host.body(p.id);
    if (!e || !a || Math.hypot(a.x - e.x, a.z - e.z) > 4.5 + e.w / 2) return;
    const held = this.held(p);
    const hit = meleeHit({
      held, ticksSinceAttack: p.attackTicks, effects: p.effects, falling: p.fallDist > 0 && !p.onGround, onGround: p.onGround,
      inWater: false, climbing: false, sprinting: p.sprinting, fallDistance: p.fallDist, targetUndead: UNDEAD.has(e.kind), targetArthropod: ARTHROPOD.has(e.kind),
    });
    p.attackTicks = 0;
    this.emit({ f: 'swing', id: p.id });
    this.hurtEntity(e, hit.damage, p.id, a.x, a.z, hit.knockback);
    if (hit.fireTicks) e.fire = Math.max(e.fire, hit.fireTicks);
    if (held && VITEM[held.id]?.attack) this.wear(p, p.selected, 1);
  }

  hurtEntity(e: Entity, amount: number, by: number | undefined, fromX: number, fromZ: number, kbLevel = 0): void {
    if (e.kind === 'end_crystal') { this.explode(e.x, e.y + 1, e.z, 6, by ?? this.credit.get(e.id), true); this.ents.remove(e); return; }
    if (e.kind === 'item' || e.kind === 'cloud') return;
    if (e.kind === 'boat' || e.kind === 'minecart') {
      // Punched boats pop off as an item (vanilla); the rider is tipped out.
      const rider = typeof e.data.rider === 'number' ? this.players.get(e.data.rider) : undefined;
      if (rider) this.dismount(rider);
      if (e.kind === 'boat') this.dropItem(e.x, e.y + .3, e.z, { id: VI.oak_boat, count: 1 }, 0, 0, 0, 10, true);
      this.ents.remove(e);
      return;
    }
    if (!KINDS[e.kind].mob) return;
    if (e.hurtTime > 0) return;
    e.hurtTime = 10;
    e.hp -= amount;
    e.flags |= ENT_FLAG.hurt;
    this.emit({ f: 'hurt', id: e.id, ent: true });
    let dx = e.x - fromX, dz = e.z - fromZ; const len = Math.hypot(dx, dz) || 1; dx /= len; dz /= len;
    const s = .4 + .5 * kbLevel;
    e.vx = e.vx / 2 + dx * s; e.vz = e.vz / 2 + dz * s; if (e.onGround) e.vy = Math.min(.4, e.vy / 2 + .4);
    if (e.kind === 'wolf' && by !== undefined && by !== e.owner) (e.data.brain as { target?: number } | undefined ?? (e.data.brain = {}) as { target?: number }).target = by;
    // Tamed wolves defend: an owner's attack marks the target for its wolves.
    if (by !== undefined) for (const w of this.ents.all.values()) if (w.kind === 'wolf' && w.owner === by && w !== e) ((w.data.brain ??= {}) as { target?: number }).target = undefined;
    if (e.hp <= 0) { this.emit({ f: 'burst', kind: 'poof', x: e.x, y: e.y + .5, z: e.z }); this.ents.remove(e); }
  }

  /** Right-click. */
  private use(p: VPlayer, a: Extract<MAction, { k: 'use' }>): void {
    const b = this.host.body(p.id);
    if (!b) return;
    const slot = Number.isInteger(a.slot) && a.slot >= 0 && a.slot < 9 ? a.slot : p.selected;
    p.selected = slot;
    // Using a block (doors, tables, furnaces) comes first unless sneaking.
    if (a.block && !b.sneaking && this.reachOk(p, a.block.x + .5, a.block.y + .5, a.block.z + .5)) {
      const id = this.host.getBlock(a.block.x, a.block.y, a.block.z);
      const station = stationOf(id);
      if (station) { this.openWindow(p, station, { x: a.block.x, y: a.block.y, z: a.block.z }); return; }
      const toggled = useBlock((x, y, z) => this.host.getBlock(x, y, z), a.block.x, a.block.y, a.block.z);
      if (toggled) { this.edits(toggled); this.sound('door', a.block.x, a.block.y, a.block.z); return; }
    }
    if (typeof a.ent === 'number' && !b.sneaking) {
      const e = this.ents.all.get(a.ent);
      if (e && e.kind === 'boat' && this.reachOk(p, e.x, e.y + .3, e.z)) { this.mount(p, e); return; }
    }
    let s = p.inv.slots[slot];
    let offhand = false;
    const useOf = (st: VStack | null) => st ? (VITEM[st.id]?.use ?? (VITEM[st.id]?.food ? 'food' : VITEM[st.id]?.armor ? 'armor' : VITEM[st.id]?.block !== undefined || BLOCKS[st.id] ? 'place' : null)) : null;
    if (!useOf(s) || (useOf(s) === 'place' && !a.block)) {
      const off = p.inv.slots[OFFHAND];
      if (useOf(off) && useOf(off) !== 'place') { s = off; offhand = true; }
    }
    if (!s) return;
    if (this.rules.blockedUse?.(s.id, s, p.id)) return;
    const sl = offhand ? OFFHAND : slot;
    if (s.tag && this.rules.onUseItem?.(p.id, s, sl)) return;
    const use = useOf(s);
    const cd = p.cooldowns.get(s.id) ?? 0;
    if (cd > this.tickNo) return;
    const consume = (n = 1) => { const cur = p.inv.slots[sl]; if (!cur) return; cur.count -= n; if (cur.count <= 0) p.inv.slots[sl] = null; p.invDirty = true; };
    const eye = { x: b.x, y: b.y + 1.62 * this.attr(p.id).scale, z: b.z };
    const look = { x: -Math.sin(a.yaw) * Math.cos(a.pitch), y: Math.sin(a.pitch), z: -Math.cos(a.yaw) * Math.cos(a.pitch) };

    switch (use) {
      case 'place': {
        if (!a.block || !this.reachOk(p, a.block.x + .5, a.block.y + .5, a.block.z + .5)) return;
        const block = VITEM[s.id]?.block ?? s.id;
        this.placeFrom(p, sl, block, a);
        return;
      }
      case 'armor': {
        const as = VITEM[s.id]!.armor!.slot, idx = ARMOR0 + ['head', 'chest', 'legs', 'feet'].indexOf(as);
        const worn = p.inv.slots[idx];
        p.inv.slots[idx] = s; p.inv.slots[sl] = worn; p.invDirty = true;
        this.sound('equip', b.x, b.y, b.z);
        return;
      }
      case 'food': {
        const f = VITEM[s.id]!.food!;
        if (!p.hunger.canEat(f.always)) return;
        p.using = { slot: sl, kind: 'food', since: this.tickNo, offhand };
        return;
      }
      case 'drink': p.using = { slot: sl, kind: 'drink', since: this.tickNo, offhand }; return;
      case 'shield': if (this.tickNo >= p.shieldDisabledUntil) p.using = { slot: sl, kind: 'shield', since: this.tickNo, offhand }; return;
      case 'bow': if (this.findAmmo(p, false) || enchLevel(s, 'infinity')) p.using = { slot: sl, kind: 'bow', since: this.tickNo, offhand }; return;
      case 'trident': p.using = { slot: sl, kind: 'trident', since: this.tickNo, offhand }; return;
      case 'crossbow': {
        if (s.charged) {
          const firework = s.charged === VI.firework_rocket;
          const multi = enchLevel(s, 'multishot') > 0;
          for (const off of multi ? [0, -10, 10] : [0]) {
            const yaw = a.yaw + off * Math.PI / 180;
            const dir = { x: -Math.sin(yaw) * Math.cos(a.pitch), y: Math.sin(a.pitch), z: -Math.cos(yaw) * Math.cos(a.pitch) };
            if (firework) this.spawnProjectile('firework', p.id, eye, dir, 1.6, { damage: 7 });
            else this.spawnProjectile('arrow', p.id, eye, dir, 3.15, { crit: true, pickup: off === 0, power: enchLevel(s, 'power') });
          }
          s.charged = undefined; p.invDirty = true;
          this.wear(p, sl, multi ? 3 : 1);
          this.sound('crossbow_shoot', b.x, b.y, b.z);
        } else if (this.findAmmo(p, true)) p.using = { slot: sl, kind: 'crossbow', since: this.tickNo, offhand };
        return;
      }
      case 'throw': {
        const v = VITEM[s.id]!.variant as EntityKind;
        const speed = v === 'ender_pearl' ? 1.5 : v === 'wind_charge' ? 1.5 : 1.5;
        this.spawnProjectile(v, p.id, eye, look, speed);
        consume();
        if (v === 'ender_pearl') p.cooldowns.set(s.id, this.tickNo + 20);
        if (v === 'wind_charge') p.cooldowns.set(s.id, this.tickNo + 10);
        this.sound(v === 'ender_pearl' ? 'pearl_throw' : 'throw', b.x, b.y, b.z);
        return;
      }
      case 'splash': case 'lingering': {
        this.spawnProjectile('potion', p.id, eye, { x: look.x, y: look.y + .1, z: look.z }, .5, { potion: s.potion, lingering: use === 'lingering' });
        consume();
        this.sound('throw', b.x, b.y, b.z);
        return;
      }
      case 'bucket': {
        if (!a.block) return;
        const v = VITEM[s.id]!.variant;
        const hit = this.host.getBlock(a.block.x, a.block.y, a.block.z);
        if (v === 'empty') {
          const f = BLOCKS[hit]?.fluid;
          if (f && f.level === 0) {
            this.setBlock(a.block.x, a.block.y, a.block.z, Block.Air);
            consume();
            this.give(p.id, [{ id: f.kind === 'water' ? VI.water_bucket : VI.lava_bucket, count: 1 }]);
            p.received--;
            this.sound('bucket_fill', a.block.x, a.block.y, a.block.z);
          } else if (VMETA[hit]?.family === 'powder_snow') {
            this.setBlock(a.block.x, a.block.y, a.block.z, Block.Air);
            consume(); this.give(p.id, [{ id: VI.powder_snow_bucket, count: 1 }]); p.received--;
          }
          return;
        }
        const tx = a.block.x + a.block.nx, ty = a.block.y + a.block.ny, tz = a.block.z + a.block.nz;
        const target = BLOCKS[hit]?.replaceable ? { x: a.block.x, y: a.block.y, z: a.block.z } : { x: tx, y: ty, z: tz };
        const cur = this.host.getBlock(target.x, target.y, target.z);
        if (cur !== Block.Air && !BLOCKS[cur]?.replaceable && !BLOCKS[cur]?.fluid) return;
        if (!this.rules.canPlace(p.id, target.x, target.y, target.z, VB.water)) return;
        const block = v === 'water' ? waterAt(0) : v === 'lava' ? lavaAt(0) : VB.powder_snow;
        this.setBlock(target.x, target.y, target.z, block);
        p.inv.slots[sl] = { id: VI.bucket, count: 1 }; p.invDirty = true;
        this.sound(v === 'lava' ? 'bucket_empty_lava' : 'bucket_empty', target.x, target.y, target.z);
        return;
      }
      case 'flint': case 'fire_charge': {
        if (!a.block) return;
        const hit = this.host.getBlock(a.block.x, a.block.y, a.block.z);
        if (VMETA[hit]?.family === 'tnt') {
          this.setBlock(a.block.x, a.block.y, a.block.z, Block.Air);
          this.primeTnt(a.block.x + .5, a.block.y, a.block.z + .5, 80, p.id);
        } else {
          const tx = a.block.x + a.block.nx, ty = a.block.y + a.block.ny, tz = a.block.z + a.block.nz;
          if (this.host.getBlock(tx, ty, tz) !== Block.Air || !this.rules.canPlace(p.id, tx, ty, tz, VB.fire)) return;
          this.setBlock(tx, ty, tz, VB.fire);
        }
        if (use === 'flint') this.wear(p, sl, 1); else consume();
        this.sound(use === 'flint' ? 'flint' : 'fire_charge', a.block.x, a.block.y, a.block.z);
        return;
      }
      case 'spawn_egg': {
        if (!a.block) return;
        const kind = VITEM[s.id]!.variant as EntityKind;
        const x = a.block.x + a.block.nx + .5, y = a.block.y + a.block.ny, z = a.block.z + a.block.nz + .5;
        this.spawnMob(kind, x, y, z, p.id);
        consume();
        return;
      }
      case 'rod': {
        const hooked = [...this.ents.all.values()].find((e) => e.kind === 'bobber' && e.owner === p.id);
        if (hooked) {
          const target = hooked.data.hooked as number | undefined;
          if (target !== undefined) {
            const tb = this.host.body(target);
            if (tb) this.host.impulse(target, (b.x - tb.x) * .1 * 20, ((b.y - tb.y) * .1 + Math.sqrt(Math.hypot(b.x - tb.x, b.y - tb.y, b.z - tb.z)) * .08) * 20, (b.z - tb.z) * .1 * 20, p.id, Math.ceil(this.players.get(target)?.hp ?? 20));
            this.wear(p, sl, 5);
          }
          this.ents.remove(hooked);
        } else {
          this.spawnProjectile('bobber', p.id, eye, look, 1.1);
          this.wear(p, sl, 1);
        }
        this.sound('rod', b.x, b.y, b.z);
        return;
      }
      case 'firework': {
        if (p.gliding) {
          const boost = (s.flight ?? 1);
          this.host.send(p.id, { k: 'impulse', vx: look.x * 1.5 * 20, vy: look.y * 1.5 * 20, vz: look.z * 1.5 * 20, set: true });
          this.host.impulse(p.id, look.x * 30, look.y * 30, look.z * 30, p.id, Math.ceil(p.hp));
          consume();
          this.emit({ f: 'firework', x: b.x, y: b.y, z: b.z, color: 0xffd060 });
          this.sound('firework', b.x, b.y, b.z);
          void boost;
        } else if (a.block) {
          this.emit({ f: 'firework', x: a.block.x + .5, y: a.block.y + 3, z: a.block.z + .5, color: 0xff6060 });
          consume();
        }
        return;
      }
      case 'crystal': {
        if (!a.block) return;
        const base = VMETA[this.host.getBlock(a.block.x, a.block.y, a.block.z)]?.family;
        if (base !== 'bedrock' && base !== 'obsidian') return;
        const x = a.block.x + .5, y = a.block.y + 1, z = a.block.z + .5;
        if (this.host.getBlock(a.block.x, a.block.y + 1, a.block.z) !== Block.Air) return;
        const e = this.ents.spawn('end_crystal', x, y, z);
        this.credit.set(e.id, p.id);
        consume();
        return;
      }
      case 'menu': this.rules.onMenuItem?.(p.id, s, sl); return;
      case 'boat': {
        if (!a.block || !this.reachOk(p, a.block.x + .5, a.block.y + .5, a.block.z + .5)) return;
        const get = (x: number, y: number, z: number) => this.host.getBlock(x, y, z);
        const bx = a.block.x + .5, bz = a.block.z + .5;
        // On the water above what was clicked (the flood), else on top of the block.
        let y = a.block.y + 1;
        const surface = waterSurface(get, bx, y, bz);
        if (surface !== null) y = surface - BOAT.DRAFT;
        else if (a.block.ny !== 1) return;
        const e = this.ents.spawn('boat', bx, y, bz, { yaw: a.yaw });
        e.data.variant = 'oak';
        consume();
        this.sound('place', bx, y, bz);
        return;
      }
      default: return;
    }
  }

  /** Place a block item into the world (with state, merges, special blocks). */
  private placeFrom(p: VPlayer, sl: number, block: number, a: Extract<MAction, { k: 'use' }>): void {
    const hit = a.block!;
    const get = (x: number, y: number, z: number) => this.host.getBlock(x, y, z);
    const ctx: PlaceCtx = { nx: hit.nx, ny: hit.ny, nz: hit.nz, yaw: a.yaw, hitY: Math.max(0, Math.min(1, hit.hitY)) };
    const clicked = get(hit.x, hit.y, hit.z);
    let tx = hit.x + hit.nx, ty = hit.y + hit.ny, tz = hit.z + hit.nz;
    const merged = mergeInto(block, clicked, ctx);
    let edits: Edit[] | null;
    if (merged !== null) { tx = hit.x; ty = hit.y; tz = hit.z; edits = [{ x: tx, y: ty, z: tz, block: merged }]; }
    else {
      if (BLOCKS[clicked]?.replaceable && !BLOCKS[clicked]?.fluid) { tx = hit.x; ty = hit.y; tz = hit.z; }
      const cur = get(tx, ty, tz);
      const mergeHere = mergeInto(block, cur, { ...ctx, ny: 1, hitY: 1 });
      if (mergeHere !== null) edits = [{ x: tx, y: ty, z: tz, block: mergeHere }];
      else {
        if (cur !== Block.Air && !BLOCKS[cur]?.replaceable && !BLOCKS[cur]?.fluid) { this.nack(p, tx, ty, tz); return; }
        edits = placeBlock(block, get, tx, ty, tz, ctx);
      }
    }
    if (!edits) { this.nack(p, tx, ty, tz); return; }
    for (const e of edits) {
      if (!this.rules.canPlace(p.id, e.x, e.y, e.z, e.block) || e.y > 255 || e.y < 0) { this.nack(p, tx, ty, tz); return; }
      // Never place a solid block into a body.
      if (collisionBoxes(e.block) && this.bodyIn(e.x, e.y, e.z)) { this.nack(p, tx, ty, tz); return; }
    }
    const fam = VMETA[block]?.family;
    const cur = p.inv.slots[sl];
    if (!cur) return;
    cur.count--; if (cur.count <= 0) p.inv.slots[sl] = null; p.invDirty = true;
    if (fam === 'tnt' && this.rules.instantTntFuse) { this.primeTnt(tx + .5, ty, tz + .5, this.rules.instantTntFuse, p.id); return; }
    this.edits(edits);
    this.sound('place', tx + .5, ty + .5, tz + .5);
    for (const e of edits) this.afterEdit(e.x, e.y, e.z);
    this.rules.onPlaced?.(p.id, sl, edits);
  }
  private nack(p: VPlayer, x: number, y: number, z: number): void { this.host.send(p.id, { k: 'nack', x, y, z }); }
  bodyIn(x: number, y: number, z: number): boolean {
    for (const q of this.players.values()) {
      if (!q.alive || q.spectator) continue;
      const b = this.host.body(q.id);
      if (!b) continue;
      const hw = .3 * this.attr(q.id).scale, h = 1.8 * this.attr(q.id).scale;
      if (b.x + hw > x && b.x - hw < x + 1 && b.y + h > y && b.y < y + 1 && b.z + hw > z && b.z - hw < z + 1) return true;
    }
    for (const e of this.ents.all.values()) {
      if (!KINDS[e.kind].mob) continue;
      if (e.x + e.w / 2 > x && e.x - e.w / 2 < x + 1 && e.y + e.h > y && e.y < y + 1 && e.z + e.w / 2 > z && e.z - e.w / 2 < z + 1) return true;
    }
    return false;
  }

  private useEnd(p: VPlayer): void {
    const u = p.using, b = this.host.body(p.id);
    p.using = null;
    if (!u || !b) return;
    const s = p.inv.slots[u.slot];
    if (!s) return;
    const held = this.tickNo - u.since;
    const yaw = b.yaw, pitch = b.pitch;
    const look = { x: -Math.sin(yaw) * Math.cos(pitch), y: Math.sin(pitch), z: -Math.cos(yaw) * Math.cos(pitch) };
    const eye = { x: b.x, y: b.y + 1.62 * this.attr(p.id).scale, z: b.z };
    if (u.kind === 'bow') {
      const power = bowPower(held);
      if (power < .1) return;
      const inf = enchLevel(s, 'infinity') > 0;
      const ammo = this.findAmmo(p, false);
      if (!ammo && !inf) return;
      const kind: EntityKind = ammo?.id === VI.spectral_arrow ? 'spectral_arrow' : 'arrow';
      this.spawnProjectile(kind, p.id, eye, look, power * 3, {
        crit: power >= 1, power: enchLevel(s, 'power'), punch: enchLevel(s, 'punch'), flame: enchLevel(s, 'flame') > 0, pickup: !(inf && kind === 'arrow'),
      });
      if (ammo && !(inf && kind === 'arrow')) { ammo.stack.count--; if (ammo.stack.count <= 0) p.inv.slots[ammo.slot] = null; }
      this.wear(p, u.slot, 1);
      p.invDirty = true;
      this.sound('bow', b.x, b.y, b.z);
    } else if (u.kind === 'trident') {
      if (held < 10) return;
      const e = this.spawnProjectile('trident', p.id, eye, look, 2.5, { damage: 8, loyalty: enchLevel(s, 'loyalty'), stack: cloneStack(s), slot: u.slot });
      void e;
      p.inv.slots[u.slot] = null; p.invDirty = true;
      this.sound('trident', b.x, b.y, b.z);
    } else if (u.kind === 'crossbow') {
      const need = 25 - 5 * enchLevel(s, 'quick_charge');
      if (held < need) return;
      const ammo = this.findAmmo(p, true);
      if (!ammo) return;
      s.charged = ammo.id;
      ammo.stack.count--; if (ammo.stack.count <= 0) p.inv.slots[ammo.slot] = null;
      p.invDirty = true;
      this.sound('crossbow_load', b.x, b.y, b.z);
    }
  }

  /** Ammo: offhand, then main hand, then hotbar/inventory order (crossbows also take rockets in the offhand). */
  private findAmmo(p: VPlayer, crossbow: boolean): { slot: number; stack: VStack; id: number } | null {
    const ok = (s: VStack | null) => !!s && (s.id === VI.arrow || s.id === VI.spectral_arrow || (crossbow && s.id === VI.firework_rocket));
    const order = [OFFHAND, p.selected, ...Array.from({ length: 36 }, (_, i) => i)];
    for (const i of order) { const s = p.inv.slots[i]; if (ok(s)) return { slot: i, stack: s!, id: s!.id }; }
    return null;
  }

  private dig(p: VPlayer, x: number, y: number, z: number): void {
    if (!this.reachOk(p, x + .5, y + .5, z + .5)) return;
    const block = this.host.getBlock(x, y, z);
    if (block === Block.Air || BLOCKS[block]?.fluid) { p.dig = null; return; }
    if (p.dig && p.dig.x === x && p.dig.y === y && p.dig.z === z && p.dig.block === block) { p.dig.heard = this.tickNo; return; }
    const b = this.host.body(p.id)!;
    const ticks = breakTicks(block, this.held(p), {
      haste: p.effects.hasteMult(), inWater: isFluid(this.host.getBlock(Math.floor(b.x), Math.floor(b.y + 1.6), Math.floor(b.z)), 'water'), onGround: p.onGround,
    });
    if (ticks === Infinity || !this.rules.canBreak(p.id, x, y, z, block)) { p.dig = null; return; }
    p.dig = { x, y, z, block, began: this.tickNo, heard: this.tickNo, ticks };
    if (ticks === 0) this.finishDig(p);
  }
  private finishDig(p: VPlayer): void {
    const d = p.dig!;
    p.dig = null;
    const block = this.host.getBlock(d.x, d.y, d.z);
    if (block !== d.block || !this.rules.canBreak(p.id, d.x, d.y, d.z, block)) return;
    const held = this.held(p);
    if (this.rules.blockDrops) {
      for (const s of dropsOf(block, held, this.rng, { glassSelf: this.rules.glassSelf })) this.dropItem(d.x + .5, d.y + .3, d.z + .5, s, 0, 0, 0, 10, true);
    }
    // Breaking the lower half of a door takes the upper one too (and vice versa).
    const m = VMETA[block];
    this.setBlock(d.x, d.y, d.z, Block.Air);
    if (m?.family === 'oak_door') {
      const oy = m.state.half === 'lower' ? d.y + 1 : d.y - 1;
      if (VMETA[this.host.getBlock(d.x, oy, d.z)]?.family === 'oak_door') this.setBlock(d.x, oy, d.z, Block.Air);
    }
    this.emit({ f: 'break', x: d.x, y: d.y, z: d.z, block });
    if (held && VITEM[held.id]?.tool && (BLOCKS[block]?.hardness ?? 0) > 0) this.wear(p, p.selected, VITEM[held.id]?.tool?.kind === 'sword' ? 2 : 1);
    p.hunger.exhaust(EXHAUST.mine);
    this.afterEdit(d.x, d.y, d.z);
    this.rules.onBroken?.(p.id, d.x, d.y, d.z, block);
  }

  private glide(p: VPlayer, on: boolean): void {
    const chest = p.inv.slots[ARMOR0 + 1];
    const ok = on && !p.onGround && chest?.id === VI.elytra && (chest.dmg ?? 0) < (VITEM[VI.elytra].durability! - 1);
    p.gliding = !!ok;
  }

  // ── World edits ──────────────────────────────────────────────────────────

  setBlock(x: number, y: number, z: number, block: number): void {
    const from = this.host.getBlock(x, y, z);
    if (from === block) return;
    this.host.setBlock(x, y, z, block);
    this.rules.onEdit?.(x, y, z, from, block);
    if (this.rules.fluidsFlow) this.fluids.touch((a, b2, c) => this.host.getBlock(a, b2, c), x, y, z, this.tickNo);
  }
  edits(list: Edit[]): void {
    const changed = list.filter((e) => this.host.getBlock(e.x, e.y, e.z) !== e.block);
    if (!changed.length) return;
    const from = changed.map((e) => this.host.getBlock(e.x, e.y, e.z));
    this.host.setBlocks(changed);
    changed.forEach((e, i) => this.rules.onEdit?.(e.x, e.y, e.z, from[i], e.block));
    if (this.rules.fluidsFlow) for (const e of changed) this.fluids.touch((a, b2, c) => this.host.getBlock(a, b2, c), e.x, e.y, e.z, this.tickNo);
  }
  /** Neighbour reactions after an edit: connections, door partners, gravity blocks above. */
  afterEdit(x: number, y: number, z: number): void {
    const get = (a: number, b: number, c: number) => this.host.getBlock(a, b, c);
    this.edits(neighbourUpdates(get, x, y, z));
    // Sand, gravel and anvils fall when unsupported.
    for (let yy = y; yy <= y + 1; yy++) {
      const id = get(x, yy, z);
      if (!VMETA[id]?.gravity) continue;
      const below = get(x, yy - 1, z);
      if (below === Block.Air || BLOCKS[below]?.fluid || BLOCKS[below]?.replaceable) {
        this.setBlock(x, yy, z, Block.Air);
        this.ents.spawn('falling_block', x + .5, yy, z + .5, { block: id });
        this.afterEdit(x, yy, z);
      }
    }
  }

  // ── Entities ─────────────────────────────────────────────────────────────

  dropItem(x: number, y: number, z: number, s: VStack, yaw: number, speed: number, owner: number, delay: number, pop = false): Entity {
    const e = this.ents.spawn('item', x, y, z, { item: cloneStack(s), timer: delay, owner });
    if (pop) { e.vx = (this.rng() - .5) * .2; e.vy = .2; e.vz = (this.rng() - .5) * .2; }
    else if (speed) { e.vx = -Math.sin(yaw) * speed; e.vz = -Math.cos(yaw) * speed; e.vy = .1; }
    e.data.age = 0;
    return e;
  }
  spawnProjectile(kind: EntityKind, owner: number, at: { x: number; y: number; z: number }, dir: { x: number; y: number; z: number }, speed: number, data: Record<string, unknown> = {}): Entity {
    const len = Math.hypot(dir.x, dir.y, dir.z) || 1;
    const spread = kind === 'arrow' || kind === 'spectral_arrow' ? .0075 : .0;
    const dx = dir.x / len + (this.rng() - .5) * spread, dy = dir.y / len + (this.rng() - .5) * spread, dz = dir.z / len + (this.rng() - .5) * spread;
    const e = this.ents.spawn(kind, at.x + dx * .3, at.y + dy * .3 - .1, at.z + dz * .3, { owner, vx: dx * speed, vy: dy * speed, vz: dz * speed, data: { ...data } });
    if (data.flame) e.fire = 100;
    if (data.potion) e.data.color = (data.potion as { color: number }).color;
    e.timer = kind === 'firework' ? 30 : kind === 'wind_charge' ? 200 : 1200;
    return e;
  }
  primeTnt(x: number, y: number, z: number, fuse: number, by: number | undefined): Entity {
    const e = this.ents.spawn('tnt', x, y, z, { timer: fuse, vx: (this.rng() - .5) * .04, vy: .2, vz: (this.rng() - .5) * .04, owner: by });
    e.flags |= ENT_FLAG.fuse;
    if (by !== undefined) this.credit.set(e.id, by);
    this.sound('tnt_fuse', x, y, z);
    return e;
  }
  spawnMob(kind: EntityKind, x: number, y: number, z: number, by?: number, init: Partial<Entity> = {}): Entity {
    const e = this.ents.spawn(kind, x, y, z, init);
    if (kind === 'wolf' && by !== undefined) {
      // Lucky Pillars: hatches tamed to the nearest living player within 6 blocks.
      let owner: number | undefined, best = 6;
      for (const p of this.players.values()) {
        const b = this.host.body(p.id);
        if (!p.alive || !b) continue;
        const d = Math.hypot(b.x - x, b.y - y, b.z - z);
        if (d <= best) { best = d; owner = p.id; }
      }
      if (owner !== undefined) { e.owner = owner; e.flags |= ENT_FLAG.tamed; e.hp = e.maxHp = 20; }
    }
    if (by !== undefined) this.credit.set(e.id, by);
    return e;
  }

  explode(x: number, y: number, z: number, power: number, by: number | undefined, fire = false, breakBlocks = this.rules.explosionsBreak): void {
    this.emit({ f: 'explode', x, y, z, power });
    this.sound('explode', x, y, z);
    const get = (a: number, b: number, c: number) => this.host.getBlock(a, b, c);
    if (breakBlocks) {
      const cells = explosionCells(get, x, y, z, power, this.rng, (bx, by2, bz, id) => !this.rules.canBreak(-1, bx, by2, bz, id));
      const edits: Edit[] = [];
      for (const [bx, by2, bz] of cells) {
        const id = get(bx, by2, bz);
        if (VMETA[id]?.family === 'tnt') { this.primeTnt(bx + .5, by2, bz + .5, 10 + Math.floor(this.rng() * 20), by); }
        edits.push({ x: bx, y: by2, z: bz, block: Block.Air });
      }
      this.edits(edits);
      if (fire) for (const [bx, by2, bz] of cells) if (this.rng() < 1 / 3 && get(bx, by2, bz) === Block.Air && BLOCKS[get(bx, by2 - 1, bz)]?.solid) this.setBlock(bx, by2, bz, VB.fire);
      for (const [bx, by2, bz] of cells) this.afterEdit(bx, by2, bz);
    }
    const radius = power * 2;
    for (const p of this.players.values()) {
      const b = this.host.body(p.id);
      if (!b || !p.alive || p.spectator) continue;
      const sc = this.attr(p.id).scale;
      const d = Math.hypot(b.x - x, b.y + .9 * sc - y, b.z - z);
      if (d >= radius) continue;
      const ex = exposure(get, x, y, z, { x: b.x, y: b.y, z: b.z, w: .6 * sc, h: 1.8 * sc });
      const { damage, impact } = explosionDamage(power, d, ex);
      if (damage > 0) this.damage(p.id, { kind: 'explosion', amount: damage, by, from: { x, z }, label: 'explosion' });
      const blast = this.armor(p).reduce((n, s) => n + enchLevel(s, 'blast_protection'), 0);
      const k = impact * (1 - Math.min(1, .15 * blast));
      const len = Math.max(.01, d);
      this.host.impulse(p.id, (b.x - x) / len * k * 20, ((b.y + .9 - y) / len * k + .1) * 20, (b.z - z) / len * k * 20, by ?? -1, Math.ceil(p.hp));
    }
    for (const e of [...this.ents.all.values()]) {
      const d = Math.hypot(e.x - x, e.y - y, e.z - z);
      if (d >= radius) continue;
      if (e.kind === 'end_crystal') { this.ents.remove(e); this.explode(e.x, e.y + 1, e.z, 6, by ?? this.credit.get(e.id), true); continue; }
      if (e.kind === 'item' && d < radius * .5) { this.ents.remove(e); continue; }
      if (KINDS[e.kind].mob) {
        const { damage, impact } = explosionDamage(power, d, 1);
        this.hurtEntity(e, damage, by, x, z);
        e.vx += (e.x - x) / Math.max(d, .1) * impact; e.vy += impact * .5; e.vz += (e.z - z) / Math.max(d, .1) * impact;
      }
      if (e.kind === 'tnt') { e.vx += (e.x - x) / Math.max(d, .1) * .5; e.vy += .3; e.vz += (e.z - z) / Math.max(d, .1) * .5; }
    }
  }
  strikeLightning(x: number, y: number, z: number, damage = 5): void {
    this.emit({ f: 'lightning', x, y, z });
    this.sound('thunder', x, y, z);
    for (const p of this.players.values()) {
      const b = this.host.body(p.id);
      if (!b || !p.alive || Math.hypot(b.x - x, b.z - z) > 3 || Math.abs(b.y - y) > 4) continue;
      this.damage(p.id, { kind: 'lightning', amount: damage, label: 'lightning' });
      p.fire = Math.max(p.fire, 160);
    }
    const bx = Math.floor(x), by = Math.floor(y), bz = Math.floor(z);
    if (this.host.getBlock(bx, by, bz) === Block.Air && BLOCKS[this.host.getBlock(bx, by - 1, bz)]?.solid) this.setBlock(bx, by, bz, VB.fire);
  }

  /** Splash a potion: intensity 1 − d/4 within 4 blocks (direct hit 1). */
  private splash(e: Entity, directId?: number): void {
    const potion = e.data.potion as { effects: [string, number, number][]; color: number } | undefined;
    this.emit({ f: 'burst', kind: 'splash', x: e.x, y: e.y, z: e.z, color: potion?.color ?? 0x3355ff });
    this.sound('glass', e.x, e.y, e.z);
    if (!potion) return;
    if (e.data.lingering) {
      const c = this.ents.spawn('cloud', e.x, e.y, e.z, { timer: 600, owner: e.owner, data: { potion, radius: 3, color: potion.color } });
      c.data.applied = {};
      return;
    }
    for (const p of this.players.values()) {
      const b = this.host.body(p.id);
      if (!b || !p.alive) continue;
      const d = Math.hypot(b.x - e.x, b.y + .9 - e.y, b.z - e.z);
      if (d > 4) continue;
      const k = p.id === directId ? 1 : 1 - d / 4;
      for (const [id, amp, ticks] of potion.effects) {
        if (!isEffectId(id)) continue;
        if (id === 'instant_damage') this.damage(p.id, { kind: 'magic', amount: Math.floor(k * instantAmount(id, amp) + .5), by: e.owner, label: 'magic' });
        else if (id === 'instant_health') this.heal(p.id, Math.floor(k * instantAmount(id, amp) + .5));
        else { const t = Math.floor(k * ticks + .5); if (t > 20) this.addEffect(p.id, id, amp, t); }
        if (e.owner !== undefined && e.owner !== p.id) { p.lastAttacker = e.owner; p.lastAttackerAt = this.tickNo; }
      }
    }
  }

  private projectileHit(e: Entity, target: { player?: number; ent?: Entity }): void {
    if (this.rules.onProjectile?.(e, target)) { this.ents.remove(e); return; }
    const owner = e.owner;
    const speed = Math.hypot(e.vx, e.vy, e.vz);
    const from = { x: e.x - e.vx * 3, z: e.z - e.vz * 3 };
    const hitPlayer = (id: number, src: DamageSource, kb: number) => {
      const dealt = this.damage(id, { ...src, from });
      const tp = this.players.get(id);
      if (dealt > 0 || tp?.invul === 20) {
        const b = this.host.body(id);
        if (b) this.knock(id, b.x - e.vx, b.z - e.vz, kb, owner ?? -1);
      }
      return dealt;
    };
    switch (e.kind) {
      case 'arrow': case 'spectral_arrow': case 'trident': {
        const dmg = e.kind === 'trident' ? (e.data.damage as number) : arrowDamage(speed, (e.data.power as number) ?? 0, !!e.data.crit, this.rng);
        if (target.player !== undefined) {
          hitPlayer(target.player, { kind: 'projectile', amount: dmg, by: owner, label: e.kind }, (e.data.punch as number) ?? 0);
          const tp = this.players.get(target.player);
          if (tp && e.fire > 0) tp.fire = Math.max(tp.fire, 100);
          if (tp && e.kind === 'spectral_arrow') this.addEffect(target.player, 'glowing', 0, 200);
        } else if (target.ent) this.hurtEntity(target.ent, dmg, owner, e.x - e.vx, e.z - e.vz, (e.data.punch as number) ?? 0);
        if (e.kind === 'trident') { e.vx *= -.01; e.vy *= -.1; e.vz *= -.01; e.data.returning = true; return; }
        this.ents.remove(e);
        return;
      }
      case 'snowball': case 'egg': {
        if (target.player !== undefined) hitPlayer(target.player, { kind: 'projectile', amount: 0.0001, by: owner, label: e.kind }, 0);
        else if (target.ent) this.hurtEntity(target.ent, 0, owner, e.x - e.vx, e.z - e.vz);
        this.emit({ f: 'burst', kind: e.kind === 'egg' ? 'egg' : 'snow', x: e.x, y: e.y, z: e.z });
        if (e.kind === 'egg' && this.rng() < 1 / 8) {
          const n = this.rng() < 1 / 32 ? 4 : 1;
          for (let i = 0; i < n; i++) this.spawnMob('chicken', e.x, e.y, e.z, undefined, { baby: true });
        }
        this.ents.remove(e);
        return;
      }
      case 'ender_pearl': {
        if (owner !== undefined) {
          const op = this.players.get(owner);
          if (op?.alive) {
            this.host.teleport(owner, e.x - e.vx, e.y, e.z - e.vz);
            this.damage(owner, { kind: 'fall', amount: 5, label: 'ender pearl' });
            op.fallDist = 0;
          }
        }
        if (target.player !== undefined) hitPlayer(target.player, { kind: 'projectile', amount: 0.0001, by: owner, label: 'pearl' }, 0);
        this.emit({ f: 'burst', kind: 'portal', x: e.x, y: e.y, z: e.z });
        this.ents.remove(e);
        return;
      }
      case 'wind_charge': {
        // Wind burst: knocks everything within ~2.5 blocks away; 1 damage on a direct hit.
        if (target.player !== undefined) this.damage(target.player, { kind: 'projectile', amount: 1, by: owner, from, label: 'wind charge' });
        this.emit({ f: 'burst', kind: 'wind', x: e.x, y: e.y, z: e.z });
        this.sound('wind_burst', e.x, e.y, e.z);
        for (const p of this.players.values()) {
          const b = this.host.body(p.id);
          if (!b || !p.alive) continue;
          const d = Math.hypot(b.x - e.x, b.y + .9 - e.y, b.z - e.z);
          if (d > 2.5) continue;
          const k = (1 - d / 2.5) * 1.2;
          const len = Math.max(.3, d);
          this.host.impulse(p.id, (b.x - e.x) / len * k * 20, ((b.y + .9 - e.y) / len * k + .5) * 20, (b.z - e.z) / len * k * 20, owner ?? -1, Math.ceil(p.hp));
          p.fallDist = 0;
          if (owner !== undefined && p.id !== owner) { p.lastAttacker = owner; p.lastAttackerAt = this.tickNo; }
        }
        for (const m of this.ents.near(e.x, e.y, e.z, 2.5, (x) => KINDS[x.kind].mob || x.kind === 'tnt' || x.kind === 'item')) {
          const d = Math.max(.3, Math.hypot(m.x - e.x, m.y - e.y, m.z - e.z));
          m.vx += (m.x - e.x) / d * .6; m.vy += .5; m.vz += (m.z - e.z) / d * .6;
        }
        this.ents.remove(e);
        return;
      }
      case 'potion': this.splash(e, target.player); this.ents.remove(e); return;
      case 'fireball': {
        if (target.player !== undefined) this.damage(target.player, { kind: 'projectile', amount: 6, by: owner, from, label: 'fireball' });
        this.explode(e.x, e.y, e.z, (e.data.power as number) ?? 1, owner, !!e.data.fire);
        this.ents.remove(e);
        return;
      }
      case 'firework': this.fireworkBurst(e); return;
      case 'bobber': {
        if (target.player !== undefined && target.player !== owner) {
          e.data.hooked = target.player;
          this.damage(target.player, { kind: 'projectile', amount: 0.0001, by: owner, from, label: 'fishing rod' });
          const tb = this.host.body(target.player);
          if (tb) this.knock(target.player, e.x - e.vx, e.z - e.vz, 0, owner ?? -1);
        }
        e.vx = e.vy = e.vz = 0; e.stuck = true;
        return;
      }
      default: this.ents.remove(e);
    }
  }
  private fireworkBurst(e: Entity): void {
    this.emit({ f: 'firework', x: e.x, y: e.y, z: e.z, color: 0xff5030 });
    this.sound('firework_blast', e.x, e.y, e.z);
    const dmg = (e.data.damage as number) ?? 7;
    for (const p of this.players.values()) {
      const b = this.host.body(p.id);
      if (!b || !p.alive) continue;
      const d = Math.hypot(b.x - e.x, b.y + .9 - e.y, b.z - e.z);
      if (d > 5.25) continue;
      this.damage(p.id, { kind: 'explosion', amount: dmg * Math.sqrt((5.25 - d) / 5.25), by: e.owner, from: { x: e.x, z: e.z }, label: 'firework' });
    }
    this.ents.remove(e);
  }

  private tickEntities(): void {
    const get = (x: number, y: number, z: number) => this.host.getBlock(x, y, z);
    const mobCtx: MobCtx = {
      get, ents: this.ents, tick: this.tickNo, rng: this.rng,
      leashHolder:(id)=>{const b=this.host.body(id),p=this.players.get(id);return b&&p?{id,x:b.x,y:b.y,z:b.z,alive:p.alive&&!p.spectator}:undefined;},
      players: () => {
        const out: Target[] = [];
        for (const p of this.players.values()) {
          const b = this.host.body(p.id);
          if (b && p.alive && !p.spectator && (this.rules.isTargetable?.(p.id) ?? true)) out.push({ id: p.id, x: b.x, y: b.y, z: b.z, alive: true });
        }
        return out;
      },
      hit: (mob, t, dmg, extra) => {
        if (t.ent) return;
        this.damage(t.id, { kind: 'melee', amount: dmg, by: mob.owner ?? mob.id, byEntity: mob.owner === undefined, from: { x: mob.x, z: mob.z }, label: mob.kind });
        this.knock(t.id, mob.x, mob.z, 0, mob.owner ?? mob.id);
        if (extra?.hungerTicks) this.addEffect(t.id, 'hunger', 0, extra.hungerTicks);
      },
      shoot: (mob, tx, ty, tz) => {
        const at = { x: mob.x, y: mob.y + 1.5, z: mob.z };
        const dx = tx - at.x, dz = tz - at.z, dist = Math.hypot(dx, dz);
        const dir = { x: dx, y: ty - at.y + dist * .2, z: dz };
        const e = this.spawnProjectile('arrow', -1, at, dir, 1.6, { pickup: false });
        e.owner = this.credit.get(mob.id) ?? undefined;
        e.data.fromMob = mob.id;
        this.sound('bow', mob.x, mob.y, mob.z);
      },
      explode: (mob, power) => { this.ents.remove(mob); this.explode(mob.x, mob.y + .5, mob.z, power, this.credit.get(mob.id)); },
      followRange: this.rules.mobFollowRange, speedMult: this.rules.mobSpeedMult?.(), damageOverride: this.rules.mobDamage,
    };
    for (const e of [...this.ents.all.values()]) {
      if (e.dead) continue;
      e.age++;
      const k = KINDS[e.kind];
      if (k.mob) {
        tickMob(e, mobCtx);
        if (e.fire > 0) { e.fire--; if (e.fire % 20 === 0) this.hurtEntity(e, 1, undefined, e.x, e.z); }
        if (e.y < -64) this.ents.remove(e);
        continue;
      }
      switch (e.kind) {
        case 'item': {
          if (e.timer > 0) e.timer--;
          stepPhysics(get, e);
          if (e.age > 6000 || e.y < -64) { this.ents.remove(e); break; }
          if (e.timer > 0) break;
          for (const p of this.players.values()) {
            const b = this.host.body(p.id);
            if (!b || !p.alive || p.spectator) continue;
            if (Math.abs(b.x - e.x) < 1.3 && Math.abs(b.z - e.z) < 1.3 && e.y > b.y - .7 && e.y < b.y + 2.2) {
              const before = e.item!.count;
              const left = addToInventory(p.inv, e.item!);
              if (!left) { this.ents.remove(e); this.host.send(p.id, { k: 'feed', text: '', tone: 'pickup' }); this.sound('pickup', b.x, b.y, b.z); }
              else if (left.count < before) e.item = left;
              p.invDirty = true;
              break;
            }
          }
          break;
        }
        case 'tnt': case 'falling_block': {
          const wasY = e.y;
          const res = stepPhysics(get, e);
          if (e.vy < 0) e.fall += Math.max(0, wasY - e.y);
          if (e.kind === 'tnt') {
            if (--e.timer <= 0) { this.ents.remove(e); this.explode(e.x, e.y + .49, e.z, 4, this.credit.get(e.id) ?? e.owner); }
            break;
          }
          if (res.ground || e.y < -64) this.landFallingBlock(e);
          break;
        }
        case 'cloud': {
          const potion = e.data.potion as { effects: [string, number, number][] };
          const radius = Math.max(0, 3 - e.age * (2.5 / 600));
          e.data.size = radius;
          if (--e.timer <= 0 || radius <= .5) { this.ents.remove(e); break; }
          if (e.age % 5 !== 0) break;
          const applied = e.data.applied as Record<number, number>;
          for (const p of this.players.values()) {
            const b = this.host.body(p.id);
            if (!b || !p.alive || Math.hypot(b.x - e.x, b.z - e.z) > radius || Math.abs(b.y - e.y) > 1.5) continue;
            if ((applied[p.id] ?? -100) > this.tickNo - 20) continue;
            applied[p.id] = this.tickNo;
            for (const [id, amp, ticks] of potion.effects) {
              if (!isEffectId(id)) continue;
              if (id === 'instant_damage') this.damage(p.id, { kind: 'magic', amount: instantAmount(id, amp), by: e.owner, label: 'magic' });
              else if (id === 'instant_health') this.heal(p.id, instantAmount(id, amp));
              else this.addEffect(p.id, id, amp, Math.floor(ticks / 4));
              if (e.owner !== undefined && e.owner !== p.id) { p.lastAttacker = e.owner; p.lastAttackerAt = this.tickNo; }
            }
          }
          break;
        }
        case 'boat': this.tickBoat(e, get); break;
        case 'end_crystal': case 'display': break;
        default: if (k.projectile) this.tickProjectile(e);
      }
    }
  }
  /** A ridden boat is where its rider's client put it; an empty one floats. */
  private tickBoat(e: Entity, get: (x: number, y: number, z: number) => number): void {
    const riderId = e.data.rider as number | undefined;
    const rider = riderId !== undefined ? this.players.get(riderId) : undefined;
    const b = rider ? this.host.body(rider.id) : null;
    if (rider && b && rider.riding === e.id && rider.alive && !rider.spectator) {
      const dx = b.x - e.x, dz = b.z - e.z;
      if (dx * dx + dz * dz > 4e-4) e.yaw = Math.atan2(-dx, -dz);
      e.x = b.x; e.y = b.y; e.z = b.z;
      e.vx = dx; e.vz = dz; e.vy = 0;
      return;
    }
    if (riderId !== undefined) delete e.data.rider;
    const body = { x: e.x, y: e.y, z: e.z, vx: e.vx, vy: e.vy, vz: e.vz, yaw: e.yaw, spin: (e.data.spin as number) ?? 0 };
    const d = stepBoat(body, NO_CONTROLS, get);
    const res = moveBox(get, e, d.dx, d.dy, d.dz);
    e.vx = res.hitX ? 0 : body.vx; e.vz = res.hitZ ? 0 : body.vz; e.vy = res.hitY ? 0 : body.vy;
    e.yaw = body.yaw; e.data.spin = body.spin;
    e.onGround = res.ground; e.inWater = d.status === 'water';
    if (e.y < -64) this.ents.remove(e);
  }
  mount(p: VPlayer, e: Entity): void {
    if (p.riding !== null || e.data.rider !== undefined) return;
    p.riding = e.id; e.data.rider = p.id;
    p.gliding = false; p.fallDist = 0;
    this.host.teleport(p.id, e.x, e.y, e.z);
    this.host.send(p.id, { k: 'ride', ent: e.id, x: e.x, y: e.y, z: e.z, yaw: e.yaw });
  }
  dismount(p: VPlayer): void {
    if (p.riding === null) return;
    const e = this.ents.all.get(p.riding);
    if (e && e.data.rider === p.id) { delete e.data.rider; e.vx = e.vy = e.vz = 0; }
    p.riding = null; p.fallDist = 0;
    this.host.send(p.id, { k: 'ride', ent: null });
  }
  private landFallingBlock(e: Entity): void {
    this.ents.remove(e);
    const bx = Math.floor(e.x), by = Math.floor(e.y + .01), bz = Math.floor(e.z);
    const fam = VMETA[e.block ?? 0]?.family;
    if (e.data.debris) {
      // Disaster debris: hurts what it lands on, then bursts into dust.
      const dmg = Math.min(6, 1.5 * Math.max(1, e.fall));
      for (const p of this.players.values()) {
        const b = this.host.body(p.id);
        if (b && p.alive && Math.hypot(b.x - e.x, b.z - e.z) < .9 && b.y <= e.y + .2 && b.y + 1.8 >= e.y - .5) this.damage(p.id, { kind: 'anvil', amount: dmg, label: e.data.label as string ?? 'debris' });
      }
      this.emit({ f: 'burst', kind: 'dust', x: e.x, y: e.y, z: e.z, color: 0x9a948c });
      return;
    }
    if (fam === 'anvil') {
      const dmg = Math.min(40, Math.max(0, 2 * (Math.ceil(e.fall) - 1)));
      for (const p of this.players.values()) {
        const b = this.host.body(p.id);
        if (b && p.alive && Math.abs(b.x - e.x) < .8 && Math.abs(b.z - e.z) < .8 && b.y <= e.y + .5 && b.y + 1.8 >= e.y - .5)
          this.damage(p.id, { kind: 'anvil', amount: dmg, by: this.credit.get(e.id), label: 'anvil' });
      }
      this.sound('anvil_land', e.x, e.y, e.z);
    }
    const cur = this.host.getBlock(bx, by, bz);
    if ((cur === Block.Air || BLOCKS[cur]?.replaceable || BLOCKS[cur]?.fluid) && e.block) { this.setBlock(bx, by, bz, e.block); this.afterEdit(bx, by, bz); }
    else if (e.block && this.rules.blockDrops) this.dropItem(e.x, e.y, e.z, { id: VMETA[e.block]?.family ? VI[VMETA[e.block]!.family] ?? e.block : e.block, count: 1 }, 0, 0, 0, 10, true);
  }
  private tickProjectile(e: Entity): void {
    const get = (x: number, y: number, z: number) => this.host.getBlock(x, y, z);
    if (--e.timer <= 0) { if (e.kind === 'firework') this.fireworkBurst(e); else this.ents.remove(e); return; }
    if (e.kind === 'trident' && e.data.returning) {
      const owner = e.owner !== undefined ? this.host.body(e.owner) : undefined;
      const loyalty = (e.data.loyalty as number) ?? 0;
      if (owner && loyalty > 0) {
        const dx = owner.x - e.x, dy = owner.y + 1.2 - e.y, dz = owner.z - e.z, d = Math.hypot(dx, dy, dz);
        if (d < 1.5) { this.returnTrident(e); return; }
        const s = .05 * loyalty * 3;
        e.vx = e.vx * .95 + dx / d * s; e.vy = e.vy * .95 + dy / d * s; e.vz = e.vz * .95 + dz / d * s;
        e.x += e.vx; e.y += e.vy; e.z += e.vz;
        return;
      }
      if (!e.stuck) { e.vy -= .05; e.x += e.vx; e.y += e.vy; e.z += e.vz; if (rayBlocks(get, e.x, e.y, e.z, e.x, e.y - .1, e.z)) { e.stuck = true; e.vx = e.vy = e.vz = 0; } }
      this.tryPickupStuck(e);
      return;
    }
    if (e.stuck) {
      if (e.kind === 'bobber') {
        const hook = e.data.hooked as number | undefined;
        if (hook !== undefined) { const b = this.host.body(hook); if (b) { e.x = b.x; e.y = b.y + 1; e.z = b.z; } }
        const ob = e.owner !== undefined ? this.host.body(e.owner) : undefined;
        if (!ob || Math.hypot(ob.x - e.x, ob.z - e.z) > 32) this.ents.remove(e);
        return;
      }
      this.tryPickupStuck(e);
      if (e.age > 1200) this.ents.remove(e);
      return;
    }
    const k = KINDS[e.kind];
    const x0 = e.x, y0 = e.y, z0 = e.z;
    const x1 = x0 + e.vx, y1 = y0 + e.vy, z1 = z0 + e.vz;
    // Entities first (players, mobs, crystals), skipping the thrower for 5 ticks.
    let best: { t: number; player?: number; ent?: Entity } | null = null;
    for (const p of this.players.values()) {
      if (!p.alive || p.spectator || (p.id === e.owner && e.age < 6)) continue;
      const b = this.host.body(p.id);
      if (!b) continue;
      const sc = this.attr(p.id).scale;
      const t = segmentHitsBox(x0, y0, z0, x1, y1, z1, b.x, b.y, b.z, .3 * sc, 1.8 * sc, .1);
      if (t !== null && (!best || t < best.t)) best = { t, player: p.id };
    }
    for (const o of this.ents.all.values()) {
      if (o === e || (!KINDS[o.kind].mob && o.kind !== 'end_crystal') || o.id === e.data.fromMob) continue;
      const t = segmentHitsBox(x0, y0, z0, x1, y1, z1, o.x, o.y, o.z, o.w / 2, o.h, .1);
      if (t !== null && (!best || t < best.t)) best = { t, ent: o };
    }
    const blockHit = rayBlocks(get, x0, y0, z0, x1, y1, z1);
    if (blockHit && (!best || blockHit.t < best.t)) {
      e.x = blockHit.x; e.y = blockHit.y; e.z = blockHit.z;
      if (this.rules.onProjectile?.(e, { block: { x: blockHit.bx, y: blockHit.by, z: blockHit.bz } })) { this.ents.remove(e); return; }
      if (e.kind === 'arrow' || e.kind === 'spectral_arrow' || e.kind === 'trident') {
        if (this.rules.onArrowBlock?.(e, blockHit.bx, blockHit.by, blockHit.bz)) { this.ents.remove(e); return; }
        // TNT hit by a burning arrow lights.
        const bid = get(blockHit.bx, blockHit.by, blockHit.bz);
        if (e.fire > 0 && VMETA[bid]?.family === 'tnt') { this.setBlock(blockHit.bx, blockHit.by, blockHit.bz, Block.Air); this.primeTnt(blockHit.bx + .5, blockHit.by, blockHit.bz + .5, 80, e.owner); }
        e.data.blockHit = [blockHit.bx, blockHit.by, blockHit.bz];
        if (e.kind === 'trident') { e.data.returning = true; e.stuck = true; e.vx = e.vy = e.vz = 0; return; }
        e.stuck = true; e.vx = e.vy = e.vz = 0;
        this.sound('arrow_hit', e.x, e.y, e.z);
        return;
      }
      if (e.kind === 'bobber') { e.stuck = true; e.vx = e.vy = e.vz = 0; return; }
      this.projectileHit(e, {});
      return;
    }
    if (best) {
      e.x = x0 + (x1 - x0) * best.t; e.y = y0 + (y1 - y0) * best.t; e.z = z0 + (z1 - z0) * best.t;
      this.projectileHit(e, best);
      return;
    }
    e.x = x1; e.y = y1; e.z = z1;
    const water = isFluid(get(Math.floor(e.x), Math.floor(e.y), Math.floor(e.z)), 'water');
    const drag = water ? .6 : k.drag;
    e.vx *= drag; e.vy *= drag; e.vz *= drag;
    e.vy -= k.gravity;
    if (water && e.fire) e.fire = 0;
    if (e.kind === 'fireball' && e.age % 2 === 0) this.emit({ f: 'burst', kind: 'smoke', x: e.x, y: e.y, z: e.z });
    if (e.y < -64) this.ents.remove(e);
  }
  private tryPickupStuck(e: Entity): void {
    if (e.kind === 'trident') {
      const ob = e.owner !== undefined ? this.host.body(e.owner) : undefined;
      if (ob && Math.hypot(ob.x - e.x, ob.y + 1 - e.y, ob.z - e.z) < 1.8) this.returnTrident(e);
      return;
    }
    if (!e.data.pickup) return;
    for (const p of this.players.values()) {
      const b = this.host.body(p.id);
      if (!b || !p.alive || Math.hypot(b.x - e.x, b.y + 1 - e.y, b.z - e.z) > 1.5) continue;
      if (!addToInventory(p.inv, { id: e.kind === 'spectral_arrow' ? VI.spectral_arrow : VI.arrow, count: 1 })) {
        p.invDirty = true; this.ents.remove(e); this.sound('pickup', b.x, b.y, b.z); return;
      }
    }
  }
  private returnTrident(e: Entity): void {
    const p = e.owner !== undefined ? this.players.get(e.owner) : undefined;
    this.ents.remove(e);
    if (!p) return;
    const s = e.data.stack as VStack;
    const slot = e.data.slot as number;
    if (!p.inv.slots[slot]) p.inv.slots[slot] = s; else { const left = addToInventory(p.inv, s); if (left) { const b = this.host.body(p.id); if (b) this.dropItem(b.x, b.y, b.z, left, 0, 0, 0, 0); } }
    p.invDirty = true;
  }

  // ── Ticking ──────────────────────────────────────────────────────────────

  tick(): void {
    this.tickNo++;
    for (const p of this.players.values()) this.tickPlayer(p);
    this.tickEntities();
    this.tickContainers();
    if (this.rules.fluidsFlow && this.fluids.pending) {
      const edits = this.fluids.tick((x, y, z) => this.host.getBlock(x, y, z), this.tickNo);
      if (edits.length) this.host.setBlocks(edits);
    }
    this.sync();
  }

  private tickPlayer(p: VPlayer): void {
    const b = this.host.body(p.id);
    if (!b) return;
    p.attackTicks++;
    if (p.invul > 0) p.invul--;
    if (!p.alive || p.spectator) { if (p.riding !== null) this.dismount(p); p.lastY = b.y; p.lastX = b.x; p.lastZ = b.z; return; }
    const get = (x: number, y: number, z: number) => this.host.getBlock(x, y, z);
    const attr = this.attr(p.id);
    const maxHp = attr.maxHealth;
    if (p.hp > maxHp) this.setHp(p, maxHp);
    // Motion: speed estimate (sprint), ground, falls.
    const dx = b.x - p.lastX, dz = b.z - p.lastZ, dy = b.y - p.lastY;
    const v = Math.hypot(dx, dz) * 20;
    p.speed = p.speed * .6 + v * .4;
    p.sprinting = p.riding === null && p.speed > 5.0 * this.speedOf(p);
    const feet = get(Math.floor(b.x), Math.floor(b.y + .05), Math.floor(b.z));
    const head = get(Math.floor(b.x), Math.floor(b.y + 1.62 * attr.scale), Math.floor(b.z));
    const inWater = isFluid(feet, 'water') || isFluid(head, 'water');
    const inLava = isFluid(feet, 'lava') || isFluid(get(Math.floor(b.x), Math.floor(b.y + .9), Math.floor(b.z)), 'lava');
    const soft = VMETA[feet]?.move;
    const supported = isSupported(b, get);
    const wasGround = p.onGround;
    p.onGround = supported;
    if (supported && p.gliding) p.gliding = false;
    if (p.sprinting && dx * dx + dz * dz > 0) p.hunger.exhaust(EXHAUST.sprintPerBlock * Math.hypot(dx, dz));
    if (inWater) p.hunger.exhaust(EXHAUST.swimPerBlock * Math.hypot(dx, dy, dz));
    if (wasGround && !supported && dy > .2) p.hunger.exhaust(p.sprinting ? EXHAUST.sprintJump : EXHAUST.jump);
    const resetFall = inWater || inLava || soft === 'ladder' || soft === 'cobweb' || soft === 'scaffold' || soft === 'powderSnow' ||
      p.effects.has('slow_falling') || p.effects.has('levitation') || p.gliding || p.riding !== null || (VMETA[head]?.move === 'ladder');
    if (resetFall) p.fallDist = 0;
    else if (!supported && dy < 0) p.fallDist -= dy;
    if (supported && p.fallDist > 0) {
      const under = get(Math.floor(b.x), Math.floor(b.y - .05), Math.floor(b.z));
      const mv = VMETA[under]?.move;
      const kind = mv === 'hay' ? 'hay' : mv === 'honey' ? 'honey' : mv === 'slime' && !b.sneaking ? 'slime' : 'normal';
      if (this.rules.fallDamage) {
        const dmg = fallDamage(p.fallDist, attr.safeFall, p.effects.level('jump_boost'), kind);
        if (dmg > 0) this.damage(p.id, { kind: 'fall', amount: dmg, label: 'fall' });
      }
      p.fallDist = 0;
    }
    p.lastX = b.x; p.lastY = b.y; p.lastZ = b.z;
    if (!p.alive) return;

    // Effects, hunger, regeneration.
    const ev = p.effects.tick();
    if (ev.heal) this.heal(p.id, ev.heal);
    if (ev.poison && p.hp > 1) this.damage(p.id, { kind: 'poison', amount: Math.min(ev.poison, p.hp - 1), label: 'poison' });
    if (ev.hunger) p.hunger.exhaust(ev.hunger);
    if (!p.effects.has('absorption')) p.absorption = 0;
    if (this.rules.hunger) {
      const d = p.hunger.tick(p.hp, maxHp, this.rules.naturalRegen);
      if (d > 0) this.heal(p.id, d);
      else if (d < 0) this.damage(p.id, { kind: 'starve', amount: -d, label: 'starvation' });
    }
    if (!p.alive) return;

    // Environment: lava, fire, burning, drowning, freezing, magma.
    p.envTimer++;
    if (inLava) {
      if (!p.effects.has('fire_resistance')) p.fire = Math.max(p.fire, 300);
      if (p.envTimer % 10 === 0) this.damage(p.id, { kind: 'lava', amount: 4, label: 'lava' });
    } else if (VMETA[feet]?.family === 'fire' || VMETA[get(Math.floor(b.x), Math.floor(b.y + 1), Math.floor(b.z))]?.family === 'fire') {
      p.fire = Math.max(p.fire, 160);
      if (p.envTimer % 10 === 0) this.damage(p.id, { kind: 'fire', amount: 1, label: 'fire' });
    }
    if (inWater) p.fire = 0;
    if (p.fire > 0) {
      p.fire--;
      if (p.effects.has('fire_resistance')) p.fire = Math.max(0, p.fire - 3);
      else if (p.fire % 20 === 0) this.damage(p.id, { kind: 'burning', amount: 1, label: 'fire' });
    }
    if (isFluid(head, 'water') && !p.effects.has('water_breathing')) {
      const resp = this.armor(p).reduce((n, s) => n + enchLevel(s, 'respiration'), 0);
      if (resp === 0 || this.rng() < 1 / (resp + 1)) p.air--;
      if (p.air <= -20) { p.air = 0; this.damage(p.id, { kind: 'drown', amount: 2, label: 'drowning' }); }
    } else p.air = Math.min(300, p.air + 4);
    if (soft === 'powderSnow' && !this.armor(p).some((s) => s && VITEM[s.id]?.key.startsWith('leather_'))) p.freeze = Math.min(140, p.freeze + 1);
    else if (!p.customFreeze) p.freeze = Math.max(0, p.freeze - 2);
    if (p.freeze >= 140 && p.envTimer % 40 === 0) this.damage(p.id, { kind: 'freeze', amount: 1, label: 'freezing' });
    const under = get(Math.floor(b.x), Math.floor(b.y - .05), Math.floor(b.z));
    if (VMETA[under]?.family === 'magma_block' && !b.sneaking && !p.effects.has('fire_resistance') && p.envTimer % 10 === 0) this.damage(p.id, { kind: 'fire', amount: 1, label: 'magma' });

    // Mining progress (the client must keep reporting the same block).
    if (p.dig) {
      if (this.tickNo - p.dig.heard > 10) p.dig = null;
      else if (this.tickNo - p.dig.began >= p.dig.ticks) this.finishDig(p);
    }
    // Using: eating and drinking complete after 32 ticks.
    if (p.using && (p.using.kind === 'food' || p.using.kind === 'drink') && this.tickNo - p.using.since >= 32) {
      const u = p.using; p.using = null;
      const s = p.inv.slots[u.slot];
      if (s) this.consumeFood(p, u.slot, s);
    }
    if (p.using && !p.inv.slots[p.using.slot]) p.using = null;
    // Elytra wear: 1 durability per second of flight.
    if (p.gliding && this.tickNo % 20 === 0) this.wear(p, ARMOR0 + 1, 1);
  }
  /** Set while a mode drives freezing itself (Disaster City's blizzard). */
  private consumeFood(p: VPlayer, slot: number, s: VStack): void {
    const d = VITEM[s.id];
    const b = this.host.body(p.id)!;
    if (d?.food) {
      p.hunger.eat(d.food.nutrition, d.food.saturation);
      for (const [e, amp, t] of d.food.effects ?? []) this.addEffect(p.id, e as EffectId, amp, t);
      if (d.key === 'chorus_fruit') this.chorusTeleport(p);
      this.sound('eat', b.x, b.y, b.z);
    } else if (d?.variant === 'milk') {
      p.effects.clear(); p.absorption = 0;
      p.inv.slots[slot] = { id: VI.bucket, count: 1 }; p.invDirty = true;
      return;
    } else if (s.potion) {
      for (const [e, amp, t] of s.potion.effects) if (isEffectId(e)) this.addEffect(p.id, e, amp, t);
      this.sound('drink', b.x, b.y, b.z);
    }
    s.count--;
    if (s.count <= 0) p.inv.slots[slot] = null;
    p.invDirty = true;
  }
  /** Chorus fruit: up to 16 tries for a safe spot within 8 blocks. */
  private chorusTeleport(p: VPlayer): void {
    const b = this.host.body(p.id)!;
    const get = (x: number, y: number, z: number) => this.host.getBlock(x, y, z);
    for (let i = 0; i < 16; i++) {
      const x = Math.floor(b.x + (this.rng() - .5) * 16), z = Math.floor(b.z + (this.rng() - .5) * 16);
      for (let y = Math.floor(b.y + 8); y >= Math.floor(b.y - 8); y--) {
        if (BLOCKS[get(x, y - 1, z)]?.solid && !collisionBoxes(get(x, y, z)) && !collisionBoxes(get(x, y + 1, z)) && !BLOCKS[get(x, y, z)]?.fluid) {
          this.host.teleport(p.id, x + .5, y, z + .5);
          p.fallDist = 0;
          this.sound('chorus', x + .5, y, z + .5);
          return;
        }
      }
    }
  }
  private speedOf(p: VPlayer): number { return p.effects.speedMult(); }

  private tickContainers(): void {
    for (const [key, c] of this.containers) {
      if (c.kind !== 'furnace' && c.kind !== 'smoker') continue;
      const total = c.kind === 'smoker' ? SMOKER_TICKS : COOK_TICKS;
      const input = c.slots[0], out = c.slots[2];
      const result = input ? smeltResult(input.id, c.kind === 'smoker') : null;
      const canCook = result !== null && (!out || (out.id === result && out.count < maxStackOf(result)));
      if (c.burn <= 0 && canCook && c.slots[1] && fuelTicks(c.slots[1].id) > 0) {
        c.burnMax = c.burn = fuelTicks(c.slots[1].id) / (c.kind === 'smoker' ? 2 : 1);
        const f = c.slots[1]; f.count--; c.slots[1] = f.count > 0 ? f : (f.id === VI.lava_bucket ? { id: VI.bucket, count: 1 } : null);
      }
      const lit = c.burn > 0;
      if (lit) c.burn--;
      if (lit && canCook) {
        if (++c.cook >= total) {
          c.cook = 0;
          input!.count--; if (input!.count <= 0) c.slots[0] = null;
          c.slots[2] = out ? { ...out, count: out.count + 1 } : { id: result!, count: 1 };
        }
      } else if (c.cook > 0) c.cook = Math.max(0, c.cook - 2);
      // Lit furnace face.
      const [x, y, z] = key.split(',').map(Number);
      const id = this.host.getBlock(x, y, z);
      if (VMETA[id]?.family === c.kind && VMETA[id]!.state.lit !== lit) this.setBlock(x, y, z, withState(id, { lit }));
      if (this.tickNo % 5 === 0) for (const p of this.players.values()) if (p.win === c) this.sendWindow(p);
    }
  }

  // ── Sync ─────────────────────────────────────────────────────────────────

  profileOf(p: VPlayer): MoveProfile {
    const attr = this.attr(p.id);
    return {
      ...DEFAULT_MOVE,
      speed: p.effects.speedMult(),
      jump: p.effects.level('jump_boost'),
      gravity: attr.gravity,
      slowFall: p.effects.has('slow_falling'),
      levitation: p.effects.level('levitation'),
      scale: attr.scale,
      canSprint: !this.rules.hunger || p.hunger.canSprint(),
      safeFall: attr.safeFall,
      frozen: p.frozen,
      gliding: p.gliding,
      elytra: p.inv.slots[ARMOR0 + 1]?.id === VI.elytra,
      boat: p.riding ?? undefined,
      doubleJumps: this.rules.doubleJumps?.(p.id) ?? 0,
    };
  }
  selfView(p: VPlayer): SelfView {
    const a = armorOf(this.armor(p));
    return {
      hp: Math.round(p.hp * 10) / 10, maxHp: this.maxHp(p.id), absorption: Math.ceil(p.absorption),
      food: p.hunger.food, saturation: Math.round(p.hunger.saturation * 10) / 10, air: Math.max(0, p.air), maxAir: 300,
      armor: a.armor, toughness: a.toughness, effects: p.effects.view(), fire: p.fire, freeze: p.freeze,
      move: this.profileOf(p), spectator: p.spectator, bar: p.xpBar || undefined, barLevel: p.xpLevel || undefined,
    };
  }
  private sync(): void {
    // Entities: spawns and removals now, positions every tick for movers.
    const spawn = this.ents.spawned.splice(0).filter((e) => !e.dead).map((e) => this.ents.view(e));
    const gone = this.ents.removed.splice(0);
    const u: number[] = [];
    for (const e of this.ents.all.values()) {
      const key = `${e.x.toFixed(2)},${e.y.toFixed(2)},${e.z.toFixed(2)},${e.yaw.toFixed(2)},${e.flags},${e.hp}`;
      if (e.data._sent === key) continue;
      e.data._sent = key;
      u.push(e.id, Math.round(e.x * 100), Math.round(e.y * 100), Math.round(e.z * 100), Math.round(e.yaw * 100), e.flags, KINDS[e.kind].mob ? Math.ceil(e.hp) : -1);
      e.flags &= ~ENT_FLAG.hurt;
    }
    if (spawn.length || gone.length || u.length) this.host.broadcast({ k: 'ent', st: this.host.nowMs(), spawn: spawn.length ? spawn : undefined, u: u.length ? u : undefined, gone: gone.length ? gone : undefined });
    if (this.fx.length) { this.host.broadcast({ k: 'fx', fx: this.fx }); this.fx = []; }
    for (const p of this.players.values()) {
      if (p.bot) { if (p.invDirty) p.invDirty = false; continue; }
      if (p.invDirty) {
        p.invDirty = false; p.rev++;
        this.host.send(p.id, { k: 'inv', v: { slots: p.inv.slots, selected: p.selected, cursor: p.inv.cursor, rev: p.rev } });
      }
      if (this.tickNo % 2 === 0) {
        const v = this.selfView(p);
        const key = JSON.stringify(v);
        if (key !== p.selfKey) { p.selfKey = key; this.host.send(p.id, { k: 'self', v }); this.host.setMoveProfile(p.id, v.move); }
      }
    }
  }

  /** Full entity list for a (re)joining client. */
  entitySnapshot(id: number): void {
    this.host.send(id, { k: 'ent', st: this.host.nowMs(), reset: true, spawn: [...this.ents.all.values()].map((e) => this.ents.view(e)) });
  }
  creditOf(entId: number): number | undefined { return this.credit.get(entId); }
}

export { POTIONS };
