// Resource-automation machines (Autominer + Oil Derrick) as block-entities,
// in the furnace/chest style. The simulation here is PURE and deterministic:
// yield is computed from Terrain ore/oil richness sampled at the machine's
// column, so it needs no loaded chunk and is unit-testable. The authoritative
// server (server_core.ts) owns the real state; offline single-player runs this
// identical module locally, and the client uses it to predict the fill bar.
//
// Designed to extend: machine state is generic (type/level/storage/filter/
// stored/progress) so a later warfare layer (refineries, turrets, drones) can
// read it and consume stored oil/ore over the same message channel.

import { Block } from './blocks';
import { dropFor, Item } from './items';
import { AUTOMINER_ORES, Terrain } from './terrain';

export const enum MachineType {
  Autominer = 0,
  OilDerrick = 1,
}

export type UpgradeAxis = 'production' | 'storage';

export const MAX_LEVEL = 100;         // production levels (hundreds-deep grind)
export const MAX_STORAGE_LEVEL = 100; // storage capacity levels
const STORAGE_BASE = 96;              // items of capacity per storage level

// Production scales linearly with level; upgrade cost grows GEOMETRICALLY (see
// upgradeCost). The curve was eased (faster base yield, gentler growth, cobalt
// gate pushed later) so the early-to-mid grind isn't punishing — but a maxed rig
// still can't fully bankroll its own upgrades (cobalt/diamond it can't produce).
const BASE_RATE = 0.05;               // extractions/sec per unit richness, per level
const COST_GROWTH = 1.11;             // geometric per-level cost multiplier
const FILTER_MID_LEVEL = 10;          // unlocks gold + redstone
const FILTER_HIGH_LEVEL = 30;         // unlocks diamond + titanium

// Machines are deliberately TANKY: they can't be destroyed by bullets (guns hit
// players only) and shrug off melee sabotage for hundreds of hits — the only
// practical way to take one down is an EXPLOSIVE (a grenade detonates it
// outright, see GameServer.handleGadget). HP scales up with production level.
const MACHINE_BASE_HP = 4000;
const MACHINE_HP_PER_LEVEL = 40;
const MAX_OWNER_LEN = 24;

// Oil below this richness yields nothing — a derrick is dead on dry ground.
export const OIL_THRESHOLD = 0.25;

export interface MachineState {
  type: MachineType;
  /** Production level 1..MAX_LEVEL (rate + unlocked ore-filter tiers). */
  level: number;
  /** Storage level 1..MAX_STORAGE_LEVEL (output capacity). */
  storageLevel: number;
  /** Autominer ore filter: bitmask over AUTOMINER_ORES indices. */
  filter: number;
  /** Output item id -> count currently held. */
  stored: Record<number, number>;
  /** Per-source fractional extraction accumulator (keyed by ore block /
   *  OilBarrel); carries sub-item progress between ticks. */
  progress: Record<number, number>;
  /** Claiming player's username ('' = unclaimed). Territorial flavor + a hook
   *  for a later warfare layer; access itself is open (anyone nearby). */
  owner: string;
  /** Current health; destroyed (raided) at 0. Max grows with level. */
  hp: number;
}

/** Richness sample for one column (only the relevant field is populated). */
export interface YieldContext {
  ore?: Record<number, number>;
  oil?: number;
}

export function machineTypeForBlock(block: number): MachineType | null {
  if (block === Block.Autominer) return MachineType.Autominer;
  if (block === Block.OilDerrick) return MachineType.OilDerrick;
  return null;
}

/** Vertical footprint height (cells) of a machine: an anchor block at the base
 *  plus (height-1) MachinePart cells stacked above it. The derrick is a taller
 *  tower than the autominer rig. */
export function machineHeight(type: MachineType): number {
  return type === MachineType.OilDerrick ? 3 : 2;
}

/** A fresh machine: level 1, basic filter (stone/coal/iron), empty storage. */
export function newMachine(type: MachineType, owner = ''): MachineState {
  const s: MachineState = {
    type,
    level: 1,
    storageLevel: 1,
    filter: type === MachineType.Autominer ? 0b0000111 : 0,
    stored: {},
    progress: {},
    owner: owner.slice(0, MAX_OWNER_LEN),
    hp: 0,
  };
  s.hp = machineMaxHp(s);
  return s;
}

/** Max health for a machine (scales with production level). */
export function machineMaxHp(state: MachineState): number {
  return MACHINE_BASE_HP + MACHINE_HP_PER_LEVEL * (clampLevel(state.level, MAX_LEVEL) - 1);
}

/** Apply sabotage/raid damage. Returns true if the machine is now destroyed. */
export function damageMachine(state: MachineState, amount: number): boolean {
  if (Number.isFinite(amount) && amount > 0) {
    state.hp = Math.max(0, Math.min(machineMaxHp(state), state.hp) - amount);
  }
  return state.hp <= 0;
}

/** Claim ownership (territorial; access stays open to anyone nearby). */
export function claimMachine(state: MachineState, owner: string): void {
  state.owner = (owner ?? '').slice(0, MAX_OWNER_LEN);
}

/** Highest AUTOMINER_ORES index a production level may drill. */
export function filterTierMax(level: number): number {
  if (level >= FILTER_HIGH_LEVEL) return 6; // + diamond, titanium
  if (level >= FILTER_MID_LEVEL) return 4;  // + gold, redstone
  return 2;                                 // stone, coal, iron
}

/** Bitmask of ore indices a production level is allowed to enable. */
export function allowedFilterMask(level: number): number {
  let mask = 0;
  for (let i = 0; i <= filterTierMax(level); i++) mask |= 1 << i;
  return mask >>> 0;
}

export function storageCap(state: MachineState): number {
  return STORAGE_BASE * clampLevel(state.storageLevel, MAX_STORAGE_LEVEL);
}

export function productionRate(level: number): number {
  return BASE_RATE * clampLevel(level, MAX_LEVEL);
}

function clampLevel(level: number, max: number): number {
  if (!Number.isFinite(level)) return 1;
  return Math.max(1, Math.min(max, Math.floor(level)));
}

export function totalStored(state: MachineState): number {
  let n = 0;
  for (const k in state.stored) n += state.stored[k];
  return n;
}

// Cache each ore's output item + per-extraction count (deterministic drop).
interface OutputUnit { item: number; perExtract: number; }
const OUTPUT_CACHE = new Map<number, OutputUnit>();
function outputFor(ore: number): OutputUnit {
  let u = OUTPUT_CACHE.get(ore);
  if (!u) {
    const d = dropFor(ore, 0);
    u = d ? { item: d.id, perExtract: d.count } : { item: ore, perExtract: 1 };
    OUTPUT_CACHE.set(ore, u);
  }
  return u;
}

/** Per-ore extraction rate (extractions/sec) for the enabled, level-gated,
 *  non-zero-richness ores. Pure: only depends on state + the richness sample. */
export function autominerRates(
  state: MachineState, oreRichness: Record<number, number>
): Record<number, number> {
  const out: Record<number, number> = {};
  if (state.type !== MachineType.Autominer) return out;
  const base = productionRate(state.level);
  const tierMax = filterTierMax(state.level);
  for (let i = 0; i <= tierMax; i++) {
    if (!(state.filter & (1 << i))) continue;
    const ore = AUTOMINER_ORES[i];
    const r = oreRichness[ore] ?? 0;
    if (r > 0 && Number.isFinite(r)) out[ore] = base * r;
  }
  return out;
}

/** Oil Derrick barrel rate (barrels/sec); zero below the dry-ground threshold. */
export function derrickRate(state: MachineState, oilRichness: number): number {
  if (state.type !== MachineType.OilDerrick) return 0;
  if (!Number.isFinite(oilRichness) || oilRichness < OIL_THRESHOLD) return 0;
  return productionRate(state.level) * oilRichness;
}

/** Total items/sec a machine is currently producing (for the UI rate readout). */
export function currentRate(state: MachineState, ctx: YieldContext): number {
  if (state.type === MachineType.Autominer) {
    const rates = autominerRates(state, ctx.ore ?? {});
    let total = 0;
    for (const k in rates) total += rates[k] * outputFor(Number(k)).perExtract;
    return total;
  }
  return derrickRate(state, ctx.oil ?? 0);
}

/** Advance one machine by dt seconds, banking whole items up to the storage
 *  cap (extra progress is discarded once full, so storage never overflows). */
export function tickMachine(state: MachineState, ctx: YieldContext, dt: number): void {
  if (!Number.isFinite(dt) || dt <= 0) return;
  const cap = storageCap(state);
  let total = totalStored(state);

  const extract = (source: number, ratePerSec: number, unit: OutputUnit): void => {
    if (!(ratePerSec > 0) || !Number.isFinite(ratePerSec)) return;
    let acc = (state.progress[source] ?? 0) + ratePerSec * dt;
    if (!Number.isFinite(acc)) acc = 0;
    let whole = Math.floor(acc);
    state.progress[source] = acc - whole;
    while (whole > 0 && total < cap) {
      const add = Math.min(unit.perExtract, cap - total);
      state.stored[unit.item] = (state.stored[unit.item] ?? 0) + add;
      total += add;
      whole--;
    }
    if (total >= cap) state.progress[source] = 0; // don't bank while full
  };

  if (state.type === MachineType.Autominer) {
    const rates = autominerRates(state, ctx.ore ?? {});
    for (const k in rates) {
      const ore = Number(k);
      extract(ore, rates[ore], outputFor(ore));
    }
  } else {
    extract(Item.OilBarrel, derrickRate(state, ctx.oil ?? 0),
      { item: Item.OilBarrel, perExtract: 1 });
  }
}

/** Take all stored output (collect). Leaves sub-item progress intact so the
 *  machine keeps running smoothly. */
export function collectMachine(state: MachineState): Record<number, number> {
  const out = state.stored;
  state.stored = {};
  return out;
}

/** Resource cost to advance one upgrade axis (null = already maxed). Costs grow
 *  GEOMETRICALLY with the current level and pull in cobalt (which an autominer
 *  cannot produce) from level 8+, so the machine can't fund its own grind.
 *  Payment is client-side (authoritative-lite); the server only records level. */
export function upgradeCost(
  state: MachineState, axis: UpgradeAxis
): Record<number, number> | null {
  const pow = (n: number, e: number) => Math.ceil(n * Math.pow(COST_GROWTH, Math.max(0, e)));
  if (axis === 'production') {
    if (state.level >= MAX_LEVEL) return null;
    const L = state.level;
    const cost: Record<number, number> = {
      [Item.IronIngot]: pow(6, L - 1),
      [Item.Redstone]: pow(4, L - 1),
    };
    if (L >= 12) cost[Item.CobaltIngot] = pow(2, L - 12);
    if (L >= 30) cost[Item.Diamond] = pow(1, L - 30);
    return cost;
  }
  if (state.storageLevel >= MAX_STORAGE_LEVEL) return null;
  const L = state.storageLevel;
  const cost: Record<number, number> = { [Item.IronIngot]: pow(4, L - 1) };
  if (L >= 15) cost[Item.CobaltIngot] = pow(2, L - 15);
  return cost;
}

/** Bump a level by one (server-authoritative; capped). Returns false if maxed. */
export function applyUpgrade(state: MachineState, axis: UpgradeAxis): boolean {
  if (axis === 'production') {
    if (state.level >= MAX_LEVEL) return false;
    state.level += 1;
    state.hp = machineMaxHp(state); // an upgrade also repairs to the new max
    return true;
  }
  if (state.storageLevel >= MAX_STORAGE_LEVEL) return false;
  state.storageLevel += 1;
  return true;
}

/** Set the autominer ore filter, masking off any ore not unlocked at its level
 *  (so an ungated ore can never be enabled and never produces). */
export function setFilter(state: MachineState, filter: number): void {
  if (state.type !== MachineType.Autominer) return;
  if (!Number.isFinite(filter)) return;
  state.filter = (Math.floor(filter) & allowedFilterMask(state.level)) >>> 0;
}

/** Normalize/validate a machine state arriving over the wire (defensive: a
 *  hacked client must not be able to inject NaN/huge levels or junk fields). */
export function sanitizeState(raw: unknown): MachineState | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const type = r.type === MachineType.OilDerrick
    ? MachineType.OilDerrick
    : r.type === MachineType.Autominer ? MachineType.Autominer : null;
  if (type === null) return null;
  const state = newMachine(type);
  state.level = clampLevel(r.level as number, MAX_LEVEL);
  state.storageLevel = clampLevel(r.storageLevel as number, MAX_STORAGE_LEVEL);
  state.owner = typeof r.owner === 'string' ? r.owner.slice(0, MAX_OWNER_LEN) : '';
  state.hp = Number.isFinite(r.hp as number)
    ? Math.max(0, Math.min(machineMaxHp(state), Math.floor(r.hp as number)))
    : machineMaxHp(state);
  if (type === MachineType.Autominer && Number.isFinite(r.filter as number)) {
    state.filter = (Math.floor(r.filter as number) & allowedFilterMask(state.level)) >>> 0;
  }
  const copyCounts = (src: unknown): Record<number, number> => {
    const dst: Record<number, number> = {};
    if (src && typeof src === 'object') {
      for (const [k, v] of Object.entries(src as Record<string, unknown>)) {
        const id = Number(k), n = Number(v);
        if (Number.isFinite(id) && Number.isFinite(n) && n > 0) {
          dst[id] = Math.min(STORAGE_BASE * MAX_STORAGE_LEVEL, Math.floor(n));
        }
      }
    }
    return dst;
  };
  // Per-item clamp above isn't sufficient: an autominer holds several item
  // types, so enforce the AGGREGATE storage cap too (deterministic trim).
  const cap = storageCap(state);
  let budget = cap;
  const trimmed: Record<number, number> = {};
  const rawCounts = copyCounts(r.stored);
  for (const id of Object.keys(rawCounts)) {
    const n = Math.min(rawCounts[Number(id)], budget);
    if (n > 0) { trimmed[Number(id)] = n; budget -= n; }
  }
  state.stored = trimmed;
  state.progress = {}; // fractional accumulators don't need to survive the wire
  return state;
}

/**
 * Offline / client-side manager: one MachineState per block position, ticked
 * against the shared Terrain. Offline this is authoritative; in multiplayer the
 * client uses it to predict the live fill bar between server updates.
 */
export class Machines {
  private readonly states = new Map<string, MachineState>();
  private readonly terrain: Terrain;

  constructor(terrain: Terrain) {
    this.terrain = terrain;
  }

  private key(x: number, y: number, z: number): string {
    return `${x},${y},${z}`;
  }

  has(x: number, y: number, z: number): boolean {
    return this.states.has(this.key(x, y, z));
  }

  get(x: number, y: number, z: number): MachineState | undefined {
    return this.states.get(this.key(x, y, z));
  }

  /** Create a machine on placement if one isn't already recorded there. If a
   *  state of a DIFFERENT type lingers at this position (a machine block was
   *  replaced by another machine type in a single edit), replace it so the
   *  prediction can't desync from the actual block. */
  place(x: number, y: number, z: number, type: MachineType): MachineState {
    const k = this.key(x, y, z);
    let s = this.states.get(k);
    if (!s || s.type !== type) { s = newMachine(type); this.states.set(k, s); }
    return s;
  }

  /** Adopt an authoritative state for a position (server sync). */
  set(x: number, y: number, z: number, state: MachineState): void {
    this.states.set(this.key(x, y, z), state);
  }

  /** Remove a broken machine's state; returns its stored output for spilling. */
  remove(x: number, y: number, z: number): Record<number, number> {
    const k = this.key(x, y, z);
    const s = this.states.get(k);
    this.states.delete(k);
    return s ? s.stored : {};
  }

  /** Richness sample at a machine's column (drives rate display + ticking). */
  context(x: number, z: number, type: MachineType): YieldContext {
    return type === MachineType.Autominer
      ? { ore: this.terrain.oreRichness(x, z) }
      : { oil: this.terrain.oilRichness(x, z) };
  }

  /** Every tracked machine with its world position (for the renderer). */
  list(): { x: number; y: number; z: number; state: MachineState }[] {
    const out: { x: number; y: number; z: number; state: MachineState }[] = [];
    for (const [key, state] of this.states) {
      const p = key.split(',');
      out.push({ x: Number(p[0]), y: Number(p[1]), z: Number(p[2]), state });
    }
    return out;
  }

  /** Tick every machine using its column's terrain richness. */
  update(dt: number): void {
    for (const [key, s] of this.states) {
      const [x, , z] = key.split(',').map(Number);
      tickMachine(s, this.context(x, z, s.type), dt);
    }
  }
}
