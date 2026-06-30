// REGION GRID — the 50/50 frontline of the Faction War (Phase 1). The fixed-seed
// world is carved into a GRID×GRID board of equal square REGIONS. Every region
// is owned by faction A, faction B, or is NEUTRAL. At season start the board is
// split down the middle (left half = A, right half = B) and each faction holds
// ONE home CAPITAL region on its far edge.
//
// This module is PURE + transport-agnostic (no THREE/DOM/Node), exactly like
// claims.ts / territory.ts: coordinate helpers (regionOf / regionBounds /
// regionCenter / neighbors), a serializable RegionControl store the server owns
// authoritatively, and an init/connectivity model the offline client mirrors.
// Phase 2 layers capture meters + adjacency rules on top of this.

import { WORLD_BORDER, WORLD_HALF } from './net/protocol';
import { FACTIONS, NO_FACTION, isFaction } from './teams';

// --- Capture tuning (Phase 2). All tunable; the smoke tests assert behaviour,
// not magnitudes. ---
/** World-unit radius of a region's central CONTROL POINT (the capture zone). */
export const CONTROL_RADIUS = 16;
/** Seconds a lone capturer needs to flip a normal (non-home) region. */
export const CAPTURE_SECONDS = 8;
/** Home regions are harder: the capital + its neighbours take this much longer
 *  to capture (defender advantage — the front stabilises near home). */
export const CAPITAL_DEFENSE_MULT = 2.5;
/** Most a stack of attackers/defenders can multiply the capture rate. */
const MAX_STACK = 3;
/** A region cut off from its capital drifts NEUTRAL after this many seconds. */
export const DISCONNECT_SECONDS = 30;

/** Board is GRID×GRID regions (6×6 = 36). */
export const GRID = 6;
export const REGION_COUNT = GRID * GRID;
/** Side length of one square region in world units (≈166.67 for a 1000 world). */
export const REGION_SIZE = WORLD_BORDER / GRID;

/** The two faction ids, named for war flavour (A = left/home-west, B = right). */
export const FACTION_A = FACTIONS[0].id; // 0 — Crimson, starts on the LEFT
export const FACTION_B = FACTIONS[1].id; // 1 — Azure, starts on the RIGHT

/** Row a capital sits on (middle-ish, deterministic). */
const CAPITAL_ROW = Math.floor((GRID - 1) / 2); // row 2 on a 6-grid

/** Region grid coordinates: column (x axis) + row (z axis), both 0..GRID-1. */
export interface RegionCoord { col: number; row: number; }

function clampCell(v: number): number {
  return v < 0 ? 0 : v > GRID - 1 ? GRID - 1 : v;
}

/** Column (x axis) for a world x. Clamped into the board. */
export function regionCol(x: number): number {
  return clampCell(Math.floor((x + WORLD_HALF) / REGION_SIZE));
}
/** Row (z axis) for a world z. Clamped into the board. */
export function regionRow(z: number): number {
  return clampCell(Math.floor((z + WORLD_HALF) / REGION_SIZE));
}

/** Region index (0..REGION_COUNT-1) for a column+row. */
export function regionIndex(col: number, row: number): number {
  return clampCell(row) * GRID + clampCell(col);
}

/** Region index containing a world position. */
export function regionOf(x: number, z: number): number {
  return regionIndex(regionCol(x), regionRow(z));
}

/** Grid coordinates of a region index. */
export function regionCoord(i: number): RegionCoord {
  const idx = i < 0 ? 0 : i > REGION_COUNT - 1 ? REGION_COUNT - 1 : Math.floor(i);
  return { col: idx % GRID, row: Math.floor(idx / GRID) };
}

export interface RegionBounds { minX: number; maxX: number; minZ: number; maxZ: number; }

/** World-coordinate bounds of a region index. */
export function regionBounds(i: number): RegionBounds {
  const { col, row } = regionCoord(i);
  const minX = -WORLD_HALF + col * REGION_SIZE;
  const minZ = -WORLD_HALF + row * REGION_SIZE;
  return { minX, maxX: minX + REGION_SIZE, minZ, maxZ: minZ + REGION_SIZE };
}

/** World-coordinate centre of a region (its control point lives here). */
export function regionCenter(i: number): { x: number; z: number } {
  const b = regionBounds(i);
  return { x: (b.minX + b.maxX) / 2, z: (b.minZ + b.maxZ) / 2 };
}

/** The 4-connected neighbours (N/S/E/W) of a region, in-board only. */
export function neighbors4(i: number): number[] {
  const { col, row } = regionCoord(i);
  const out: number[] = [];
  if (col > 0) out.push(regionIndex(col - 1, row));
  if (col < GRID - 1) out.push(regionIndex(col + 1, row));
  if (row > 0) out.push(regionIndex(col, row - 1));
  if (row < GRID - 1) out.push(regionIndex(col, row + 1));
  return out;
}

/** Chebyshev (king-move) distance between two regions on the grid. */
export function gridDistance(a: number, b: number): number {
  const ca = regionCoord(a), cb = regionCoord(b);
  return Math.max(Math.abs(ca.col - cb.col), Math.abs(ca.row - cb.row));
}

/** Home capital region index for a faction (far edge, middle row). */
export function capitalOf(faction: number): number {
  if (faction === FACTION_B) return regionIndex(GRID - 1, CAPITAL_ROW);
  return regionIndex(0, CAPITAL_ROW); // FACTION_A (and any default)
}

/** True if a region index is a faction's home capital. */
export function isCapital(i: number): boolean {
  return i === capitalOf(FACTION_A) || i === capitalOf(FACTION_B);
}

/** The faction whose capital sits on region i, or NO_FACTION if none. */
export function capitalFaction(i: number): number {
  if (i === capitalOf(FACTION_A)) return FACTION_A;
  if (i === capitalOf(FACTION_B)) return FACTION_B;
  return NO_FACTION;
}

/**
 * The 50/50 starting ownership: the left half of the board is faction A, the
 * right half is faction B. With an even GRID this is an exact split and the
 * frontline runs straight down the middle border. Pure — server and offline
 * client derive the identical opening board.
 */
export function initialOwners(): number[] {
  const owners = new Array<number>(REGION_COUNT);
  for (let i = 0; i < REGION_COUNT; i++) {
    const { col } = regionCoord(i);
    owners[i] = col < GRID / 2 ? FACTION_A : FACTION_B;
  }
  return owners;
}

/** Per-faction region counts from an owner array. */
export function regionCounts(owners: number[]): Record<number, number> {
  const counts: Record<number, number> = {};
  for (const f of FACTIONS) counts[f.id] = 0;
  for (const o of owners) if (counts[o] !== undefined) counts[o]++;
  return counts;
}

/**
 * Connectivity: the set of regions a faction owns that are reachable from its
 * CAPITAL through 4-connected owned regions. Owned regions NOT in this set are
 * "cut off" (Phase 2 lets them drift neutral and stops them producing). If the
 * faction has lost its own capital, nothing is connected.
 */
export function connectedRegions(owners: number[], faction: number): Set<number> {
  const cap = capitalOf(faction);
  const seen = new Set<number>();
  if (owners[cap] !== faction) return seen; // capital lost -> supply line severed
  const stack = [cap];
  seen.add(cap);
  while (stack.length) {
    const cur = stack.pop()!;
    for (const n of neighbors4(cur)) {
      if (!seen.has(n) && owners[n] === faction) { seen.add(n); stack.push(n); }
    }
  }
  return seen;
}

/**
 * May `faction` legally CAPTURE region `i` right now? A region is capturable
 * only if it is 4-connected to a region the faction already owns AND that
 * neighbour is itself connected back to the faction's capital (no leapfrogging,
 * no capturing from an isolated pocket). A capital is special — see
 * capitalCapturable. Pure rule shared by server + client.
 */
export function canCapture(owners: number[], faction: number, i: number): boolean {
  if (!isFaction(faction) || owners[i] === faction) return false;
  const connected = connectedRegions(owners, faction);
  return neighbors4(i).some((n) => connected.has(n));
}

/**
 * A faction's CAPITAL is only capturable once EVERY other region that faction
 * owns has been taken (its last stand). Taking it = instant season win.
 * `defender` is the capital's owning faction.
 */
export function capitalCapturable(owners: number[], defender: number): boolean {
  const cap = capitalOf(defender);
  if (owners[cap] !== defender) return false; // already lost
  for (let i = 0; i < REGION_COUNT; i++) {
    if (i !== cap && owners[i] === defender) return false; // still holds other land
  }
  return true;
}

/** A living player's presence for capture resolution (faction + position). */
export interface RegionPresence { faction: number; x: number; z: number; dead: boolean; }

/** A region just flipped owners (drives the "WE CAPTURED X" banner). */
export interface CaptureEvent { region: number; faction: number; from: number; }

/** Outcome of one capture tick. */
export interface RegionTickResult {
  /** Regions that flipped owners this tick. */
  captured: CaptureEvent[];
  /** Regions that drifted NEUTRAL from being cut off from their capital. */
  neutralized: number[];
  /** A faction that just took an enemy CAPITAL = instant season win (else NO_FACTION). */
  winner: number;
}

/** Per-region capture meter for the War HUD. */
export interface CaptureMeters {
  /** Faction currently filling each region's meter (NO_FACTION = none). */
  faction: number[];
  /** Fill fraction 0..1 of each region's meter. */
  progress: number[];
}

/** Serializable region board (sent on the wire + saved to disk). */
export interface RegionsSave { owners: number[]; }

/** Sanitize an owner array off the wire/disk (fail-closed to the opening board
 *  if it's the wrong shape). */
export function sanitizeOwners(raw: unknown): number[] {
  if (!Array.isArray(raw) || raw.length !== REGION_COUNT) return initialOwners();
  const out = new Array<number>(REGION_COUNT);
  for (let i = 0; i < REGION_COUNT; i++) {
    const v = raw[i];
    out[i] = (v === FACTION_A || v === FACTION_B || v === NO_FACTION) ? v : NO_FACTION;
  }
  return out;
}

/**
 * The authoritative region board. The server owns the real instance; the
 * offline client + the predictor run an identical copy. Phase 1 tracks
 * OWNERSHIP only; Phase 2 layers capture meters on top (same store).
 */
export class Regions {
  private owners: number[] = initialOwners();
  // Capture meters (Phase 2): which faction is filling each region + how far
  // (in SECONDS toward that region's capture threshold), plus a cut-off timer.
  private capFaction: number[] = new Array(REGION_COUNT).fill(NO_FACTION);
  private capProgress: number[] = new Array(REGION_COUNT).fill(0);
  private disconnect: number[] = new Array(REGION_COUNT).fill(0);

  /** Reset to the 50/50 opening board + clear all meters (boot + season reset). */
  reset(): void {
    this.owners = initialOwners();
    this.capFaction = new Array(REGION_COUNT).fill(NO_FACTION);
    this.capProgress = new Array(REGION_COUNT).fill(0);
    this.disconnect = new Array(REGION_COUNT).fill(0);
  }

  /** Wipe all in-progress capture meters + cut-off timers (owners untouched).
   *  Called when a war ends so half-captured regions don't linger in peacetime. */
  clearMeters(): void {
    this.capFaction = new Array(REGION_COUNT).fill(NO_FACTION);
    this.capProgress = new Array(REGION_COUNT).fill(0);
    this.disconnect = new Array(REGION_COUNT).fill(0);
  }

  /** Owner faction id of a region index (NO_FACTION = neutral). */
  ownerAt(i: number): number {
    return (i >= 0 && i < REGION_COUNT) ? this.owners[i] : NO_FACTION;
  }
  /** Owner faction of the region containing a world position. */
  ownerOf(x: number, z: number): number { return this.ownerAt(regionOf(x, z)); }

  /** A copy of the full owner array (for the wire / HUD). */
  ownerList(): number[] { return this.owners.slice(); }

  /** Set a region's owner (server-authoritative capture/reset). Capitals never
   *  go NEUTRAL implicitly — only an explicit set changes them. Returns true if
   *  the owner actually changed. */
  setOwner(i: number, faction: number): boolean {
    if (i < 0 || i >= REGION_COUNT || this.owners[i] === faction) return false;
    this.owners[i] = faction;
    return true;
  }

  counts(): Record<number, number> { return regionCounts(this.owners); }
  connected(faction: number): Set<number> { return connectedRegions(this.owners, faction); }
  canCapture(faction: number, i: number): boolean { return canCapture(this.owners, faction, i); }
  capitalCapturable(defender: number): boolean { return capitalCapturable(this.owners, defender); }

  /** Seconds needed to flip region i, given its current owner (defender). The
   *  owner's capital + its direct neighbours take CAPITAL_DEFENSE_MULT× longer. */
  captureSeconds(i: number): number {
    const owner = this.owners[i];
    if (owner === NO_FACTION) return CAPTURE_SECONDS; // neutral land flips at base speed
    const cap = capitalOf(owner);
    if (gridDistance(i, cap) <= 1) return CAPTURE_SECONDS * CAPITAL_DEFENSE_MULT;
    return CAPTURE_SECONDS;
  }

  /** May faction f legally capture region i RIGHT NOW (adjacency + the capital
   *  last-stand rule)? An intact home capital only falls once its faction holds
   *  nothing else. */
  private eligible(f: number, i: number): boolean {
    if (!canCapture(this.owners, f, i)) return false;
    const capFac = capitalFaction(i);
    if (capFac !== NO_FACTION && this.owners[i] === capFac) {
      return capitalCapturable(this.owners, capFac); // home capital = last stand only
    }
    return true;
  }

  /** Capture meters for the HUD (fill fraction 0..1 per region). */
  meters(): CaptureMeters {
    const faction = this.capFaction.slice();
    const progress = new Array<number>(REGION_COUNT);
    for (let i = 0; i < REGION_COUNT; i++) {
      progress[i] = Math.max(0, Math.min(1, this.capProgress[i] / this.captureSeconds(i)));
    }
    return { faction, progress };
  }

  /** Adopt authoritative capture meters (client sync from the server). */
  setMeters(m: CaptureMeters | undefined | null): void {
    if (!m || !Array.isArray(m.faction) || !Array.isArray(m.progress)) return;
    for (let i = 0; i < REGION_COUNT; i++) {
      this.capFaction[i] = Number.isFinite(m.faction[i]) ? m.faction[i] : NO_FACTION;
      const frac = Number.isFinite(m.progress[i]) ? Math.max(0, Math.min(1, m.progress[i])) : 0;
      this.capProgress[i] = frac * this.captureSeconds(i);
    }
  }

  /**
   * Advance every region's capture meter by dt from live player presence, plus
   * the connectivity decay (cut-off regions drift neutral). Pure tug-of-war:
   * a region's central CONTROL POINT is filled by the lone eligible challenger
   * standing on it; defenders (and anyone else present) push back. Filling it
   * flips the region; taking an enemy capital wins the season. Server-auth — the
   * offline client runs the identical sim over just the local player.
   */
  tick(presence: RegionPresence[], dt: number): RegionTickResult {
    const result: RegionTickResult = { captured: [], neutralized: [], winner: NO_FACTION };
    if (!Number.isFinite(dt) || dt <= 0) return result;

    // Connectivity decay first: regions cut off from their capital count down to
    // neutral (so an isolated pocket can't hold forever).
    const connected = new Map<number, Set<number>>();
    for (const f of FACTIONS) connected.set(f.id, connectedRegions(this.owners, f.id));
    for (let i = 0; i < REGION_COUNT; i++) {
      const owner = this.owners[i];
      if (owner === NO_FACTION || connected.get(owner)?.has(i)) { this.disconnect[i] = 0; continue; }
      this.disconnect[i] += dt;
      if (this.disconnect[i] >= DISCONNECT_SECONDS) {
        this.owners[i] = NO_FACTION;
        this.disconnect[i] = 0;
        this.capFaction[i] = NO_FACTION;
        this.capProgress[i] = 0;
        result.neutralized.push(i);
      }
    }

    // Capture meters: per region, tally living players standing on its control
    // point by faction, find the single eligible challenger, and tug the meter.
    const r2 = CONTROL_RADIUS * CONTROL_RADIUS;
    for (let i = 0; i < REGION_COUNT; i++) {
      const c = regionCenter(i);
      let total = 0;
      const counts: Record<number, number> = {};
      for (const f of FACTIONS) counts[f.id] = 0;
      for (const p of presence) {
        if (p.dead || counts[p.faction] === undefined) continue;
        const dx = p.x - c.x, dz = p.z - c.z;
        if (dx * dx + dz * dz <= r2) { counts[p.faction]++; total++; }
      }
      // Challengers = present factions that don't own this region and may take it.
      const challengers = FACTIONS.filter((f) => counts[f.id] > 0 && this.eligible(f.id, i));
      if (challengers.length !== 1) {
        // Nobody (or a contested two-way) is taking it — the meter re-secures.
        this.decay(i, dt);
        continue;
      }
      const f = challengers[0].id;
      if (this.capFaction[i] !== f) { this.capFaction[i] = f; this.capProgress[i] = 0; }
      const attackers = counts[f];
      const defenders = total - attackers; // owner defenders + any ineligible enemy
      const net = attackers - defenders;
      if (net > 0) {
        this.capProgress[i] += dt * Math.min(net, MAX_STACK);
      } else {
        // Equal or defender-majority: defenders win ties (home advantage) and
        // claw the meter back down.
        this.capProgress[i] -= dt * Math.min(MAX_STACK, 1 - net);
        if (this.capProgress[i] <= 0) { this.capProgress[i] = 0; this.capFaction[i] = NO_FACTION; }
      }
      if (this.capProgress[i] >= this.captureSeconds(i)) {
        const from = this.owners[i];
        const wonCapital = capitalFaction(i) === from && from !== NO_FACTION;
        this.owners[i] = f;
        this.capProgress[i] = 0;
        this.capFaction[i] = NO_FACTION;
        this.disconnect[i] = 0;
        result.captured.push({ region: i, faction: f, from });
        if (wonCapital) result.winner = f; // enemy capital taken -> instant win
      }
    }
    return result;
  }

  /** Bleed an un-challenged region's meter back toward zero. */
  private decay(i: number, dt: number): void {
    if (this.capProgress[i] <= 0) { this.capFaction[i] = NO_FACTION; return; }
    this.capProgress[i] = Math.max(0, this.capProgress[i] - dt);
    if (this.capProgress[i] <= 0) this.capFaction[i] = NO_FACTION;
  }

  serialize(): RegionsSave { return { owners: this.ownerList() }; }
  restore(save: RegionsSave | undefined | null): void {
    this.owners = sanitizeOwners(save?.owners);
  }
}
