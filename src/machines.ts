// Resource-automation machines (Autominer + Oil Derrick) as block-entities,
// in the furnace/chest style. The simulation here is PURE and deterministic:
// yield is computed from Terrain ore/oil richness sampled at the machine's
// column, so it needs no loaded chunk and is unit-testable. The authoritative
// server (server_core.ts) owns the real state; offline single-player runs this
// identical module locally, and the client uses it to predict the live panel.
//
// v3 ("Deep Bore" / "Wildcat Well") turns both machines into systems you run:
//
//  AUTOMINER — the bore descends over time; deeper bands unlock richer ores
//  (titanium lives at the bottom). The column's vein thins as it is worked, so a
//  rig eventually wants moving. Coal/oil FUEL runs it at full speed (unfuelled
//  it trickles at 25%). OVERDRIVE doubles output but builds HEAT until the rig
//  JAMS. Drill BITS wear out, and set how deep the bore can go.
//
//  OIL DERRICK — drills a well, then STRIKES: some strikes are GUSHERS (a free
//  burst of oil, but the well stays uncapped and flammable until capped; an
//  explosion near an uncapped well sets it ABLAZE). Output follows reservoir
//  PRESSURE, which falls as it pumps and is restored by frac-sand injection.
//  A refinery selector turns crude into Tar or Fuel Tanks on site.

import { Block } from './blocks';
import { dropFor, Item, ITEMS, ItemStack } from './items';
import { sameFaction } from './teams';
import { AUTOMINER_ORES, Terrain } from './terrain';

export const enum MachineType {
  Autominer = 0,
  OilDerrick = 1,
}

export type UpgradeAxis = 'production' | 'storage';

/** Hands-on machine operations (one wire message: `machineAct`). */
export type MachineAct =
  | 'fuel'      // autominer: load n fuel items (item = Coal/Charcoal/OilBarrel)
  | 'bit'       // autominer: install a drill bit (item = DrillBit*)
  | 'overdrive' // autominer: n = 1 on / 0 off
  | 'coolant'   // autominer: 4 Packed Snow → -60 heat, clears a jam
  | 'vent'      // autominer: free jam clear that costs hull
  | 'cap'       // derrick: cap an uncapped gusher (iron)
  | 'smother'   // derrick: put out a well fire (sand)
  | 'inject'    // derrick: frac-sand injection restores pressure
  | 'refine';   // derrick: n = RefineMode

/** Ten substantial upgrades, shared by the simulation, dashboard and models. */
export const MAX_LEVEL = 10;
export const MAX_STORAGE_LEVEL = 10;
export const MACHINE_PROGRESSION_VERSION = 3;
const STORAGE_BASE = 384;
const RATES = [0.24, 0.36, 0.52, 0.72, 0.96, 1.25, 1.65, 2.2, 3.2, 5];
export const MACHINE_RANKS = [
  'Prospector', 'Workhorse', 'Surveyor', 'Excavator', 'Industrial',
  'Deep Core', 'Titan', 'Vanguard', 'Apex', 'Masterwork',
] as const;

export function machineRank(level: number): string {
  return MACHINE_RANKS[clampLevel(level, MAX_LEVEL) - 1];
}

/** Hardware milestones are visible on the model and add free buffer capacity. */
export function machineTier(level: number): number {
  return level >= 10 ? 3 : level >= 6 ? 2 : level >= 3 ? 1 : 0;
}

// Machines are deliberately TANKY: they can't be destroyed by bullets (guns hit
// players only) and shrug off melee sabotage for hundreds of hits — the only
// practical way to take one down is an EXPLOSIVE. HP scales with level.
const MACHINE_BASE_HP = 4000;
const MACHINE_HP_PER_LEVEL = 440;
const MAX_OWNER_LEN = 24;

// Oil below this richness yields nothing — a derrick is dead on dry ground.
export const OIL_THRESHOLD = 0.25;

// --- Autominer: the bore -----------------------------------------------------
/** Deepest a bore can ever reach (metres below the rig). */
export const MAX_DEPTH = 120;
/** Depth (m) at which each ore starts showing up in the spoil. */
export const ORE_DEPTH: Readonly<Record<number, number>> = {
  [Block.Stone]: 0,
  [Block.CoalOre]: 0,
  [Block.IronOre]: 15,
  [Block.RedstoneOre]: 35,
  [Block.GoldOre]: 42,
  [Block.DiamondOre]: 70,
  [Block.TitaniumOre]: 96,
};
/** Metres over which a freshly reached band ramps to full yield. */
const BAND_RAMP = 8;
/** Deepest the rig's rank allows. */
const RANK_DEPTH = [30, 30, 45, 60, 60, 80, 90, 100, 110, 120];
/** Bits: 0 = the stock bit (never wears), then iron / diamond / titanium. */
export const BIT_NAMES = ['Stock', 'Iron', 'Diamond', 'Titanium'] as const;
export const BIT_DEPTH = [45, 75, 105, 120];
export const BIT_SPEED = [1, 1.2, 1.45, 1.8];
export const BIT_DURABILITY = [0, 900, 2400, 6000];
/** Fuel: seconds of full-speed running per item, and the tank size. */
export const FUEL_CAP = 1800;
const FUEL_VALUE: Readonly<Record<number, number>> = {
  [Item.Coal]: 20, [Item.Charcoal]: 20, [Item.OilBarrel]: 60,
};
/** Unfuelled rigs still turn over, slowly — never a dead block. */
export const TRICKLE = 0.25;
/** Heat model. */
export const JAM_HEAT = 100;
export const JAM_SECONDS = 25;
const IDLE_HEAT = 28;
/** Vein size (extractions) before the column is worked out. */
function veinSize(level: number): number { return 2000 + 600 * clampLevel(level, MAX_LEVEL); }
/** Worked-out veins still dribble: the floor on the vein multiplier. */
export const VEIN_FLOOR = 0.25;
/** A same-owner derrick within this radius pipes crude into a rig's tank. */
export const FUEL_LINK_RADIUS = 12;

// --- Derrick: the well ------------------------------------------------------
export const enum WellPhase {
  Drilling = 0,
  Pumping = 1,
}
export const enum RefineMode {
  Crude = 0,
  Tar = 1,
  FuelTank = 2,
}
export const REFINE_NAMES = ['Crude', 'Tar', 'Fuel Tanks'] as const;
/** Metres a well must be sunk before it strikes. */
export const WELL_DEPTH = 60;
/** Well fires burn this long (unless smothered) and eat hull meanwhile. */
export const WELL_FIRE_SECONDS = 45;
const WELL_FIRE_DPS = 70;
/** Operation costs (paid client-side, like upgrades). */
export const CAP_COST = { [Item.IronIngot]: 6 } as const;
export const SMOTHER_COST = { [Block.Sand]: 16 } as const;
export const INJECT_COST = { [Block.Sand]: 12 } as const;
export const COOLANT_COST = { [Block.PackedSnow]: 4 } as const;
export const INJECT_PRESSURE = 0.25;
/** Vent clears a jam for free but scalds the hull. */
export const VENT_HULL_FRACTION = 0.08;

export interface MachineState {
  type: MachineType;
  /** Missing/older on saves from earlier progressions (migrated on load). */
  progressionVersion?: number;
  /** Grandfathered buffer for heavily upgraded legacy rigs. */
  legacyCapacity?: number;
  /** Production level 1..MAX_LEVEL (rate, rank depth cap, cooling). */
  level: number;
  /** Storage level 1..MAX_STORAGE_LEVEL (output capacity). */
  storageLevel: number;
  /** Autominer ore filter: bitmask over AUTOMINER_ORES indices. */
  filter: number;
  /** Output item id -> count currently held. */
  stored: Record<number, number>;
  /** Per-source fractional extraction accumulator. */
  progress: Record<number, number>;
  /** Claiming player's username ('' = unclaimed = open to anyone). */
  owner: string;
  /** Claiming player's faction (-1 = none): allies may operate it too. */
  faction: number;
  /** Current health; destroyed (raided) at 0. Max grows with level. */
  hp: number;
  /** Autominer: bore depth (m). Derrick: well depth drilled (m). */
  depth: number;
  /** Autominer: vein remaining 0..1. Derrick: reservoir pressure 0..1. */
  reserves: number;
  /** Autominer heat 0..JAM_HEAT. */
  heat: number;
  /** Autominer overdrive switch. */
  overdrive: boolean;
  /** Seconds of jam left (0 = running). */
  jam: number;
  /** Autominer fuel, in seconds of full-speed running. */
  fuel: number;
  /** Installed drill bit tier (0 = stock). */
  bit: number;
  /** Remaining bit durability (extractions). */
  bitWear: number;
  /** Derrick well phase. */
  phase: WellPhase;
  /** Derrick: a gusher that nobody has capped yet (flammable, fast, wasteful). */
  uncapped: boolean;
  /** Derrick: seconds of well fire left (0 = not burning). */
  fire: number;
  /** Derrick refinery output. */
  refine: RefineMode;
}

/** Richness sample for one column (only the relevant field is populated). */
export interface YieldContext {
  ore?: Record<number, number>;
  oil?: number;
  /** Deterministic 0..1 roll for this column (gusher chance). */
  roll?: number;
}

export function machineTypeForBlock(block: number): MachineType | null {
  if (block === Block.Autominer) return MachineType.Autominer;
  if (block === Block.OilDerrick) return MachineType.OilDerrick;
  return null;
}

/** Vertical footprint height (cells) of a machine: an anchor block at the base
 *  plus (height-1) MachinePart cells stacked above it. */
export function machineHeight(type: MachineType): number {
  return type === MachineType.OilDerrick ? 3 : 2;
}

/** A fresh machine: level 1, surface filter, empty tank, stock bit. */
export function newMachine(type: MachineType, owner = '', faction = -1): MachineState {
  const s: MachineState = {
    type,
    progressionVersion: MACHINE_PROGRESSION_VERSION,
    level: 1,
    storageLevel: 1,
    filter: type === MachineType.Autominer ? 0b1111111 : 0,
    stored: {},
    progress: {},
    owner: owner.slice(0, MAX_OWNER_LEN),
    faction: Number.isFinite(faction) ? Math.floor(faction) : -1,
    hp: 0,
    depth: 0,
    reserves: 1,
    heat: 0,
    overdrive: false,
    jam: 0,
    fuel: 0,
    bit: 0,
    bitWear: 0,
    phase: WellPhase.Drilling,
    uncapped: false,
    fire: 0,
    refine: RefineMode.Crude,
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

/** Owner or ally (or nobody owns it): may collect, configure and upgrade. */
export function machineFriendly(state: MachineState, name: string, faction = -1): boolean {
  if (!state.owner) return true;
  return state.owner === name || sameFaction(state.faction, faction);
}

/** A hostile rig can be claimed only once it is knocked below a quarter hull. */
export function machineCanClaim(state: MachineState, name: string, faction = -1): boolean {
  return machineFriendly(state, name, faction) || state.hp <= machineMaxHp(state) * 0.25;
}

export function claimMachine(state: MachineState, owner: string, faction = -1): void {
  state.owner = (owner ?? '').slice(0, MAX_OWNER_LEN);
  state.faction = Number.isFinite(faction) ? Math.floor(faction) : -1;
}

// --- Autominer depth ----------------------------------------------------------

/** Deepest the bore can currently go (rank AND bit limits). */
export function maxDepth(state: MachineState): number {
  return Math.min(RANK_DEPTH[clampLevel(state.level, MAX_LEVEL) - 1],
    BIT_DEPTH[clampBit(state.bit)]);
}

/** Rank-only depth cap (the dashboard shows which limit binds). */
export function rankDepth(level: number): number {
  return RANK_DEPTH[clampLevel(level, MAX_LEVEL) - 1];
}

/** Bore descent (m/s) at full power. */
export function descentRate(level: number): number {
  return 0.05 + 0.02 * clampLevel(level, MAX_LEVEL);
}

/** 0..1: how much of an ore's band the bore has reached. */
export function bandFactor(ore: number, depth: number): number {
  const d0 = ORE_DEPTH[ore] ?? 0;
  if (d0 <= 0) return ore === Block.Stone ? Math.max(0.35, 1 - depth / 160) : 1;
  const t = (depth - d0) / BAND_RAMP;
  return t <= 0 ? 0 : t >= 1 ? 1 : t;
}

/** Bitmask of ore indices the bore has reached (the filter chips that unlock). */
export function allowedFilterMask(state: MachineState): number {
  let mask = 0;
  for (let i = 0; i < AUTOMINER_ORES.length; i++) {
    if (state.depth >= (ORE_DEPTH[AUTOMINER_ORES[i]] ?? 0)) mask |= 1 << i;
  }
  return mask >>> 0;
}

export function storageCap(state: MachineState): number {
  return Math.max(state.legacyCapacity ?? 0,
    STORAGE_BASE * clampLevel(state.storageLevel, MAX_STORAGE_LEVEL) + 192 * machineTier(state.level));
}

export function productionRate(level: number): number {
  return RATES[clampLevel(level, MAX_LEVEL) - 1];
}

function clampLevel(level: number, max: number): number {
  if (!Number.isFinite(level)) return 1;
  return Math.max(1, Math.min(max, Math.floor(level)));
}

function clampBit(bit: number): number {
  return Number.isFinite(bit) ? Math.max(0, Math.min(3, Math.floor(bit))) : 0;
}

function clamp(v: unknown, lo: number, hi: number, dflt: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : dflt;
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

/** Focus one resource for +50% yield, or two for +25%. Only ores the bore has
 *  reached count toward the bonus. */
export function focusMultiplier(state: MachineState): number {
  const mask = state.filter & allowedFilterMask(state);
  let count = 0;
  for (let i = 0; i < AUTOMINER_ORES.length; i++) if (mask & (1 << i)) count++;
  return count === 1 ? 1.5 : count === 2 ? 1.25 : 1;
}

/** Vein multiplier: full while fresh, sliding to VEIN_FLOOR once worked out. */
export function veinFactor(state: MachineState): number {
  return VEIN_FLOOR + (1 - VEIN_FLOOR) * clamp(state.reserves, 0, 1, 1);
}

/** Current power multiplier: jammed 0, unfuelled trickle, overdrive ×2. */
export function powerFactor(state: MachineState): number {
  if (state.jam > 0) return 0;
  if (state.fuel <= 0) return TRICKLE;
  return state.overdrive ? 2 : 1;
}

/** Per-ore extraction rate (extractions/sec) at the current depth and power. */
export function autominerRates(
  state: MachineState, oreRichness: Record<number, number>
): Record<number, number> {
  const out: Record<number, number> = {};
  if (state.type !== MachineType.Autominer) return out;
  const base = productionRate(state.level) * focusMultiplier(state) * veinFactor(state)
    * BIT_SPEED[clampBit(state.bit)] * powerFactor(state);
  if (!(base > 0)) return out;
  for (let i = 0; i < AUTOMINER_ORES.length; i++) {
    if (!(state.filter & (1 << i))) continue;
    const ore = AUTOMINER_ORES[i];
    const band = bandFactor(ore, state.depth);
    const r = (oreRichness[ore] ?? 0) * band;
    if (r > 0 && Number.isFinite(r)) out[ore] = base * r;
  }
  return out;
}

// --- Derrick ------------------------------------------------------------------

/** Well drilling speed (m/s). */
export function wellDrillRate(level: number): number {
  return 0.6 + 0.08 * clampLevel(level, MAX_LEVEL);
}

/** Chance a strike here is a gusher (richer fields gush more). */
export function gusherChance(oil: number): number {
  if (!(oil >= OIL_THRESHOLD)) return 0;
  return Math.min(0.85, 0.3 + 0.8 * (oil - OIL_THRESHOLD));
}

/** Barrels a gusher throws into the tanks on the strike. */
export function gusherBurst(oil: number): number {
  return Math.floor(12 + 36 * Math.max(0, Math.min(1, oil)));
}

function reservoirSize(oil: number): number { return 500 + 900 * Math.max(0, Math.min(1, oil)); }

/** Crude barrels/sec the well is lifting (before refining). */
export function derrickRate(state: MachineState, oilRichness: number): number {
  if (state.type !== MachineType.OilDerrick) return 0;
  if (!Number.isFinite(oilRichness) || oilRichness < OIL_THRESHOLD) return 0;
  if (state.phase !== WellPhase.Pumping || state.fire > 0) return 0;
  const pressure = clamp(state.reserves, 0, 1, 1);
  return productionRate(state.level) * oilRichness * (0.3 + 0.7 * pressure) * (state.uncapped ? 1.5 : 1);
}

/** What the refinery makes: output item, units per crude, crude-rate factor. */
export function refineOutput(mode: RefineMode): { item: number; per: number; speed: number } {
  if (mode === RefineMode.Tar) return { item: Block.Tar, per: 4, speed: 0.8 };
  if (mode === RefineMode.FuelTank) return { item: Item.FuelTank, per: 1, speed: 1 / 3 };
  return { item: Item.OilBarrel, per: 1, speed: 1 };
}

/** Total items/sec a machine is currently producing (for the UI rate readout). */
export function currentRate(state: MachineState, ctx: YieldContext): number {
  if (state.type === MachineType.Autominer) {
    const rates = autominerRates(state, ctx.ore ?? {});
    let total = 0;
    for (const k in rates) total += rates[k] * outputFor(Number(k)).perExtract;
    return total;
  }
  const r = refineOutput(state.refine);
  return derrickRate(state, ctx.oil ?? 0) * r.speed * r.per;
}

/** Discrete things that happened during a tick (drive FX + server broadcasts). */
export interface MachineEvents {
  jammed?: boolean;
  struck?: boolean;
  gusher?: boolean;
  bitBroke?: boolean;
  fireOut?: boolean;
}

/** Advance one machine by dt seconds, banking whole items up to the storage
 *  cap (extra progress is discarded once full, so storage never overflows). */
export function tickMachine(state: MachineState, ctx: YieldContext, dt: number): MachineEvents {
  const ev: MachineEvents = {};
  if (!Number.isFinite(dt) || dt <= 0) return ev;
  const cap = storageCap(state);
  let total = totalStored(state);

  /** Accumulate `ratePerSec` extractions of `source`; returns whole extractions
   *  banked this tick. */
  const extract = (source: number, ratePerSec: number, unit: OutputUnit): number => {
    if (!(ratePerSec > 0) || !Number.isFinite(ratePerSec)) return 0;
    let acc = (state.progress[source] ?? 0) + ratePerSec * dt;
    if (!Number.isFinite(acc)) acc = 0;
    const whole = Math.floor(acc);
    state.progress[source] = acc - whole;
    let banked = 0;
    if (whole > 0 && total < cap) {
      const add = Math.min(whole * unit.perExtract, cap - total);
      state.stored[unit.item] = (state.stored[unit.item] ?? 0) + add;
      total += add;
      banked = Math.ceil(add / unit.perExtract);
    }
    if (total >= cap) state.progress[source] = 0; // don't bank while full
    return banked;
  };

  if (state.type === MachineType.Autominer) {
    // Jam: nothing turns; the rig bleeds heat while it sits.
    if (state.jam > 0) {
      state.jam = Math.max(0, state.jam - dt);
      state.heat = Math.max(0, state.heat - 3 * dt);
      if (state.jam <= 0) state.heat = Math.min(state.heat, 40);
      return ev;
    }
    const fuelled = state.fuel > 0;
    const over = state.overdrive && fuelled;
    if (fuelled) state.fuel = Math.max(0, state.fuel - dt * (over ? 2 : 1));
    // Heat: overdrive climbs (better cooling at higher ranks); otherwise the
    // rig settles back toward a gentle idle temperature.
    if (over) {
      state.heat += (3.4 - 0.12 * clampLevel(state.level, MAX_LEVEL)) * dt;
      if (state.heat >= JAM_HEAT) {
        state.heat = JAM_HEAT;
        state.jam = JAM_SECONDS;
        state.overdrive = false;
        ev.jammed = true;
        return ev;
      }
    } else {
      state.heat += (IDLE_HEAT * (fuelled ? 1 : 0.5) - state.heat) * Math.min(1, 0.25 * dt);
    }
    const power = powerFactor(state);
    // The bore keeps descending (even while the buffer is full).
    const cap2 = maxDepth(state);
    if (state.depth < cap2) {
      state.depth = Math.min(cap2, state.depth + descentRate(state.level) * power * dt);
    } else if (state.depth > cap2) {
      state.depth = cap2; // a worn-out bit pulls the string back up
    }
    const rates = autominerRates(state, ctx.ore ?? {});
    let extractions = 0;
    for (const k in rates) {
      const ore = Number(k);
      extractions += extract(ore, rates[ore], outputFor(ore));
    }
    if (extractions > 0) {
      state.reserves = Math.max(0, state.reserves - extractions / veinSize(state.level));
      if (state.bit > 0) {
        state.bitWear -= extractions * (over ? 2 : 1);
        if (state.bitWear <= 0) {
          state.bit = 0; state.bitWear = 0; ev.bitBroke = true;
          if (state.depth > maxDepth(state)) state.depth = maxDepth(state);
        }
      }
    }
    return ev;
  }

  // --- Derrick ---
  const oil = ctx.oil ?? 0;
  if (state.fire > 0) {
    state.fire = Math.max(0, state.fire - dt);
    state.hp = Math.max(0, state.hp - WELL_FIRE_DPS * dt);
    // A fire that burns itself out leaves the well capped (the wellhead fused).
    if (state.fire <= 0) { state.uncapped = false; ev.fireOut = true; }
    return ev;
  }
  if (state.phase === WellPhase.Drilling) {
    if (!(oil >= OIL_THRESHOLD)) return ev; // dry ground: the bit spins in vain
    state.depth = Math.min(WELL_DEPTH, state.depth + wellDrillRate(state.level) * dt);
    if (state.depth >= WELL_DEPTH) {
      state.phase = WellPhase.Pumping;
      state.reserves = 1;
      ev.struck = true;
      const roll = ctx.roll ?? 1;
      if (roll < gusherChance(oil)) {
        state.uncapped = true;
        ev.gusher = true;
        const add = Math.min(gusherBurst(oil), Math.max(0, cap - total));
        if (add > 0) state.stored[Item.OilBarrel] = (state.stored[Item.OilBarrel] ?? 0) + add;
      }
    }
    return ev;
  }
  const crude = derrickRate(state, oil);
  const r = refineOutput(state.refine);
  const units = extract(r.item, crude * r.speed, { item: r.item, perExtract: r.per });
  if (units > 0) {
    const crudeUsed = units / r.speed;
    state.reserves = Math.max(0,
      state.reserves - crudeUsed * (state.uncapped ? 3 : 1) / reservoirSize(oil));
  }
  return ev;
}

/** Take all stored output (collect). */
export function collectMachine(state: MachineState): Record<number, number> {
  const out = state.stored;
  state.stored = {};
  return out;
}

/** A raider's siphon: a quarter of every stack (rounded down). */
export function siphonMachine(state: MachineState): Record<number, number> {
  const out: Record<number, number> = {};
  for (const k in state.stored) {
    const take = Math.floor(state.stored[k] * 0.25);
    if (take <= 0) continue;
    out[k] = take;
    state.stored[k] -= take;
    if (state.stored[k] <= 0) delete state.stored[k];
  }
  return out;
}

/** Predictable, bounded costs. Paid client-side (the server holds no inventory). */
export function upgradeCost(
  state: MachineState, axis: UpgradeAxis
): Record<number, number> | null {
  if (axis === 'production') {
    if (state.level >= MAX_LEVEL) return null;
    const L = clampLevel(state.level, MAX_LEVEL);
    const cost: Record<number, number> = { [Item.IronIngot]: 4 + 3 * (L - 1) };
    if (state.type === MachineType.OilDerrick) cost[Item.OilBarrel] = 4 * L;
    else cost[Item.Coal] = 4 * L;
    if (L >= 3) cost[Item.Redstone] = 3 * (L - 2);
    if (L >= 6) cost[Item.Diamond] = L - 5;
    return cost;
  }
  if (state.storageLevel >= MAX_STORAGE_LEVEL) return null;
  const L = clampLevel(state.storageLevel, MAX_STORAGE_LEVEL);
  return { [Item.IronIngot]: 3 + 2 * (L - 1), [Block.Cobblestone]: 8 * L };
}

/** Bump a level by one (capped). Returns false if maxed. */
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

/** Set the autominer ore filter (locked bands simply produce nothing until the
 *  bore reaches them, so the choice is remembered). */
export function setFilter(state: MachineState, filter: number): void {
  if (state.type !== MachineType.Autominer) return;
  if (!Number.isFinite(filter)) return;
  state.filter = (Math.floor(filter) & ((1 << AUTOMINER_ORES.length) - 1)) >>> 0;
}

/** Fuel value (seconds) of an item, or 0 if it isn't fuel. */
export function fuelValue(item: number): number {
  return FUEL_VALUE[item] ?? 0;
}

/** How many of `item` the tank can take right now. */
export function fuelRoom(state: MachineState, item: number): number {
  const v = fuelValue(item);
  if (!v || state.type !== MachineType.Autominer) return 0;
  return Math.max(0, Math.floor((FUEL_CAP - state.fuel) / v));
}

/** Drill-bit tier of an item (0 if it isn't a bit). */
export function bitTier(item: number): number {
  if (item === Item.DrillBitIron) return 1;
  if (item === Item.DrillBitDiamond) return 2;
  if (item === Item.DrillBitTitanium) return 3;
  return 0;
}

/** Apply a hands-on operation. Costs are paid by the caller; this only checks
 *  the machine is in a state where the act makes sense. Returns true if it
 *  changed anything. */
export function applyMachineAct(
  state: MachineState, act: MachineAct, n: number, item: number,
): boolean {
  const miner = state.type === MachineType.Autominer;
  switch (act) {
    case 'fuel': {
      const room = fuelRoom(state, item);
      const count = Number.isFinite(n) ? Math.max(0, Math.min(room, Math.floor(n))) : 0;
      if (count <= 0) return false;
      state.fuel = Math.min(FUEL_CAP, state.fuel + count * fuelValue(item));
      return true;
    }
    case 'bit': {
      const tier = bitTier(item);
      if (!miner || tier <= 0) return false;
      state.bit = tier;
      state.bitWear = BIT_DURABILITY[tier];
      return true;
    }
    case 'overdrive': {
      if (!miner || state.jam > 0) return false;
      const on = n > 0;
      if (on && state.fuel <= 0) return false;
      state.overdrive = on;
      return true;
    }
    case 'coolant': {
      if (!miner || (state.heat <= 0 && state.jam <= 0)) return false;
      state.heat = Math.max(0, state.heat - 60);
      state.jam = 0;
      return true;
    }
    case 'vent': {
      if (!miner || state.jam <= 0) return false;
      state.jam = 0;
      state.heat = 45;
      state.hp = Math.max(1, state.hp - Math.ceil(machineMaxHp(state) * VENT_HULL_FRACTION));
      return true;
    }
    case 'cap': {
      if (miner || !state.uncapped || state.fire > 0) return false;
      state.uncapped = false;
      return true;
    }
    case 'smother': {
      if (miner || state.fire <= 0) return false;
      state.fire = 0;
      state.uncapped = false;
      return true;
    }
    case 'inject': {
      if (miner || state.phase !== WellPhase.Pumping || state.reserves >= 1) return false;
      state.reserves = Math.min(1, state.reserves + INJECT_PRESSURE);
      return true;
    }
    case 'refine': {
      if (miner) return false;
      const mode = Math.floor(n);
      if (mode !== RefineMode.Crude && mode !== RefineMode.Tar && mode !== RefineMode.FuelTank) return false;
      state.refine = mode;
      return true;
    }
  }
  return false;
}

/** Item cost of a hands-on act (null = free / not costed here). */
export function actCost(act: MachineAct): Record<number, number> | null {
  switch (act) {
    case 'coolant': return { ...COOLANT_COST };
    case 'cap': return { ...CAP_COST };
    case 'smother': return { ...SMOTHER_COST };
    case 'inject': return { ...INJECT_COST };
    default: return null;
  }
}

/** An explosion near an UNCAPPED well sets it ablaze instead of flattening it
 *  outright. Returns true if it ignited (callers then skip the demolition). */
export function igniteWell(state: MachineState): boolean {
  if (state.type !== MachineType.OilDerrick || !state.uncapped || state.fire > 0) return false;
  state.fire = WELL_FIRE_SECONDS;
  return true;
}

/** Deterministic per-column roll in [0,1) (gusher chance) — identical on the
 *  server, offline, and in client prediction. */
export function columnRoll(x: number, z: number): number {
  let h = (Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(z | 0, 0x165667b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Fuel link: every same-owner derrick within FUEL_LINK_RADIUS pipes one crude
 *  barrel into a thirsty rig's tank (at most one barrel per rig per call).
 *  Pure over a list so the server and offline sim share it. Returns the keys of
 *  every state it touched. */
export function linkFuel(
  list: { key: string; x: number; y: number; z: number; state: MachineState }[],
): string[] {
  const touched: string[] = [];
  const r2 = FUEL_LINK_RADIUS * FUEL_LINK_RADIUS;
  for (const m of list) {
    const s = m.state;
    if (s.type !== MachineType.Autominer || !s.owner) continue;
    if (s.fuel > FUEL_CAP - fuelValue(Item.OilBarrel)) continue;
    for (const d of list) {
      const ds = d.state;
      if (ds.type !== MachineType.OilDerrick || ds.owner !== s.owner) continue;
      if (!((ds.stored[Item.OilBarrel] ?? 0) > 0)) continue;
      const dx = d.x - m.x, dy = d.y - m.y, dz = d.z - m.z;
      if (dx * dx + dy * dy + dz * dz > r2) continue;
      ds.stored[Item.OilBarrel] -= 1;
      if (ds.stored[Item.OilBarrel] <= 0) delete ds.stored[Item.OilBarrel];
      s.fuel = Math.min(FUEL_CAP, s.fuel + fuelValue(Item.OilBarrel));
      touched.push(m.key, d.key);
      break;
    }
  }
  return touched;
}

/** Normalize/validate a machine state arriving over the wire or from a save
 *  (defensive: a hacked client must not inject NaN/huge levels or junk). Old
 *  progressions migrate: v1 (100 levels) → v2 → v3 (the bore starts at the
 *  depth its rank would have unlocked, so no rig loses its ores). */
export function sanitizeState(raw: unknown): MachineState | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const type = r.type === MachineType.OilDerrick
    ? MachineType.OilDerrick
    : r.type === MachineType.Autominer ? MachineType.Autominer : null;
  if (type === null) return null;
  const state = newMachine(type);
  const version = typeof r.progressionVersion === 'number' ? r.progressionVersion : 1;
  const v1 = version < 2;
  const oldLevel = clampLevel(r.level as number, 100);
  state.level = v1
    ? Math.max(oldLevel >= 30 ? 6 : oldLevel >= 10 ? 3 : 1,
      RATES.findIndex(rate => rate >= oldLevel * 0.05) + 1)
    : clampLevel(r.level as number, MAX_LEVEL);
  state.storageLevel = v1
    ? clampLevel(Math.ceil(clampLevel(r.storageLevel as number, 100) / 4), MAX_STORAGE_LEVEL)
    : clampLevel(r.storageLevel as number, MAX_STORAGE_LEVEL);
  // Grandfather large legacy buffers instead of deleting earned stock/capacity.
  if (v1 && clampLevel(r.storageLevel as number, 100) * 96 > storageCap(state)) {
    state.legacyCapacity = clampLevel(r.storageLevel as number, 100) * 96;
  } else if (!v1 && Number.isFinite(r.legacyCapacity)) {
    state.legacyCapacity = Math.max(0, Math.min(9600, Math.floor(r.legacyCapacity as number)));
  }
  state.owner = typeof r.owner === 'string' ? r.owner.slice(0, MAX_OWNER_LEN) : '';
  state.faction = typeof r.faction === 'number' && Number.isFinite(r.faction)
    ? Math.max(-1, Math.min(64, Math.floor(r.faction))) : -1;
  state.hp = Number.isFinite(r.hp as number)
    ? Math.max(0, Math.min(machineMaxHp(state), Math.floor(r.hp as number)))
    : machineMaxHp(state);
  if (type === MachineType.Autominer && Number.isFinite(r.filter as number)) {
    state.filter = (Math.floor(r.filter as number) & ((1 << AUTOMINER_ORES.length) - 1)) >>> 0;
  }

  if (version < 3) {
    // Pre-bore rigs start as deep as their old rank's filter unlocks reached,
    // and old derricks were already pumping.
    if (type === MachineType.Autominer) {
      state.depth = Math.min(maxDepth(state), state.level >= 6 ? 75 : state.level >= 3 ? 45 : 16);
      if (!state.filter) state.filter = 0b0000111;
    } else {
      state.depth = WELL_DEPTH;
      state.phase = WellPhase.Pumping;
    }
  } else {
    state.bit = clampBit(r.bit as number);
    state.bitWear = state.bit > 0 ? clamp(r.bitWear, 0, BIT_DURABILITY[state.bit], BIT_DURABILITY[state.bit]) : 0;
    if (type === MachineType.Autominer) {
      state.depth = clamp(r.depth, 0, maxDepth(state), 0);
      state.heat = clamp(r.heat, 0, JAM_HEAT, 0);
      state.jam = clamp(r.jam, 0, JAM_SECONDS, 0);
      state.fuel = clamp(r.fuel, 0, FUEL_CAP, 0);
      state.overdrive = r.overdrive === true && state.fuel > 0 && state.jam <= 0;
    } else {
      state.depth = clamp(r.depth, 0, WELL_DEPTH, 0);
      state.phase = r.phase === WellPhase.Pumping && state.depth >= WELL_DEPTH
        ? WellPhase.Pumping : WellPhase.Drilling;
      state.uncapped = r.uncapped === true && state.phase === WellPhase.Pumping;
      state.fire = clamp(r.fire, 0, WELL_FIRE_SECONDS, 0);
      const mode = Math.floor(clamp(r.refine, 0, 2, 0));
      state.refine = mode === 1 ? RefineMode.Tar : mode === 2 ? RefineMode.FuelTank : RefineMode.Crude;
    }
    state.reserves = clamp(r.reserves, 0, 1, 1);
  }
  state.progressionVersion = MACHINE_PROGRESSION_VERSION;

  const copyCounts = (src: unknown): Record<number, number> => {
    const dst: Record<number, number> = {};
    if (src && typeof src === 'object') {
      for (const [k, v] of Object.entries(src as Record<string, unknown>)) {
        const id = Number(k), n = Number(v);
        if (Number.isFinite(id) && Number.isFinite(n) && n > 0) {
          dst[id] = Math.min(9600, Math.floor(n));
        }
      }
    }
    return dst;
  };
  // Enforce the AGGREGATE storage cap too (deterministic trim).
  let budget = storageCap(state);
  const trimmed: Record<number, number> = {};
  const rawCounts = copyCounts(r.stored);
  for (const id of Object.keys(rawCounts)) {
    const n = Math.min(rawCounts[Number(id)], budget);
    if (n > 0) { trimmed[Number(id)] = n; budget -= n; }
  }
  state.stored = trimmed;
  state.progress = {};
  if (r.progress && typeof r.progress === 'object') {
    for (const [k, value] of Object.entries(r.progress as Record<string, unknown>)) {
      const source = Number(k);
      if (!Number.isFinite(source)) continue;
      const ok = type === MachineType.Autominer
        ? AUTOMINER_ORES.includes(source as Block)
        : source === Item.OilBarrel || source === Block.Tar || source === Item.FuelTank;
      if (ok && typeof value === 'number' && Number.isFinite(value) && value >= 0 && value < 1) {
        state.progress[source] = value;
      }
    }
  }
  return state;
}

/** Output hopper: pour a rig's buffer into an adjacent chest's slots (topping
 *  up matching stacks first, then empty slots). Mutates both; returns true if
 *  anything moved. Shared by the server and the offline sim. */
export function depositInto(slots: (ItemStack | null)[], stored: Record<number, number>): boolean {
  let moved = false;
  for (const key of Object.keys(stored)) {
    const id = Number(key);
    let left = Math.floor(stored[id] ?? 0);
    const max = ITEMS[id]?.maxStack ?? 64;
    if (left <= 0 || !ITEMS[id]) continue;
    for (let i = 0; i < slots.length && left > 0; i++) {
      const st = slots[i];
      if (!st || st.id !== id || st.damage !== undefined || st.count >= max) continue;
      const add = Math.min(max - st.count, left);
      st.count += add; left -= add; moved = true;
    }
    for (let i = 0; i < slots.length && left > 0; i++) {
      if (slots[i]) continue;
      const add = Math.min(max, left);
      slots[i] = { id, count: add }; left -= add; moved = true;
    }
    if (left > 0) stored[id] = left; else delete stored[id];
  }
  return moved;
}

/** Horizontal neighbours a rig's hopper feeds (anchor level). */
export const HOPPER_SIDES: readonly [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];

/** A relocated rig starts over on fresh ground: the bore/well restarts from the
 *  surface with a full vein (upgrades, bit, fuel and stored output travel). */
export function relocateMachine(state: MachineState): void {
  state.depth = 0;
  state.reserves = 1;
  state.progress = {};
  state.phase = WellPhase.Drilling;
  state.uncapped = false;
  state.fire = 0;
}

const SURVEY_WEIGHT: Readonly<Record<number, number>> = {
  [Block.CoalOre]: 1, [Block.IronOre]: 2, [Block.RedstoneOre]: 2,
  [Block.GoldOre]: 3, [Block.DiamondOre]: 4, [Block.TitaniumOre]: 5,
};

/** 9×9 prospecting grid (4-block spacing, row-major, north row first). Oil is
 *  absolute field strength; ore is weighted value relative to the best cell. */
export function surveyGrid(terrain: Terrain, x: number, z: number, type: MachineType): number[] {
  const out: number[] = [];
  for (let gz = -4; gz <= 4; gz++) {
    for (let gx = -4; gx <= 4; gx++) {
      const sx = x + gx * 4, sz = z + gz * 4;
      if (type === MachineType.OilDerrick) { out.push(terrain.oilRichness(sx, sz)); continue; }
      const r = terrain.oreRichness(sx, sz);
      let v = 0;
      for (const k in SURVEY_WEIGHT) v += (r[Number(k)] ?? 0) * SURVEY_WEIGHT[Number(k)];
      out.push(v);
    }
  }
  if (type === MachineType.Autominer) {
    const max = Math.max(...out) || 1;
    for (let i = 0; i < out.length; i++) out[i] = out[i] / max;
  }
  return out;
}

/** Richness + roll sample at a machine's column. */
export function machineContext(terrain: Terrain, x: number, z: number, type: MachineType): YieldContext {
  return type === MachineType.Autominer
    ? { ore: terrain.oreRichness(x, z) }
    : { oil: terrain.oilRichness(x, z), roll: columnRoll(x, z) };
}

/**
 * Offline / client-side manager: one MachineState per block position, ticked
 * against the shared Terrain. Offline this is authoritative; in multiplayer the
 * client uses it to predict the live panel between server updates.
 */
export class Machines {
  private readonly states = new Map<string, MachineState>();
  private readonly terrain: Terrain;
  /** Richness is a pure function of the column: cache it per machine key. */
  private readonly ctxCache = new Map<string, YieldContext>();
  /** Fired for discrete sim events (jam, strike, gusher…) — drives FX. */
  onEvent?: (x: number, y: number, z: number, state: MachineState, ev: MachineEvents) => void;
  private linkTimer = 0;

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
   *  state of a DIFFERENT type lingers at this position, replace it so the
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
    this.ctxCache.delete(k);
    return s ? s.stored : {};
  }

  /** Richness sample at a machine's column (drives rate display + ticking). */
  context(x: number, z: number, type: MachineType): YieldContext {
    return machineContext(this.terrain, x, z, type);
  }

  /** Prospecting grid around a column (for the dashboard survey). */
  survey(x: number, z: number, type: MachineType): number[] {
    return surveyGrid(this.terrain, x, z, type);
  }

  private cachedContext(key: string, x: number, z: number, type: MachineType): YieldContext {
    let c = this.ctxCache.get(key);
    if (!c || (type === MachineType.Autominer) !== !!c.ore) {
      c = this.context(x, z, type);
      this.ctxCache.set(key, c);
    }
    return c;
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

  /** Tick every machine using its column's terrain richness, then run the
   *  derrick → rig fuel link once a second. */
  update(dt: number): void {
    for (const [key, s] of this.states) {
      const p = key.split(',');
      const x = Number(p[0]), y = Number(p[1]), z = Number(p[2]);
      const ev = tickMachine(s, this.cachedContext(key, x, z, s.type), dt);
      if (this.onEvent && (ev.jammed || ev.struck || ev.bitBroke || ev.fireOut)) {
        this.onEvent(x, y, z, s, ev);
      }
    }
    this.linkTimer += dt;
    if (this.linkTimer >= 1) {
      this.linkTimer = 0;
      linkFuel(this.list().map(m => ({ key: this.key(m.x, m.y, m.z), ...m })));
    }
  }
}
