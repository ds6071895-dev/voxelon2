// LAND CLAIMS + the oil-powered SHIELD (M18) — the heart of the war economy.
// A faction member places a Core block; it claims a 3×3-chunk footprint for that
// faction and raises a shield whose HP regenerates ONLY while the Core's oil
// buffer is non-empty. Fueled = tanky (regen out-paces a lone attacker);
// unfueled/offline = no regen and a slow bleed, so it eventually cracks open —
// this is the crux that prevents BOTH offline-immunity AND 24/7-invincibility.
//
// PURE + transport-agnostic (no THREE/DOM/Node), exactly like machines.ts /
// ships.ts / turrets.ts: a state shape, a tickClaim(dt), sanitizeClaim for wire
// input (fail-closed), and a Claims manager. The authoritative server owns the
// real state and validates every action; offline single-player runs the same
// sim locally, and the client uses it to predict shield/oil bars + draw domes.

import { CHUNK_X, CHUNK_Z } from './chunk';

/** Claim footprint: the Core's chunk + the 8 adjacent chunks (a 3×3 block). */
export const CLAIM_CHUNK_RADIUS = 1;

// Shield model (the core mechanic). Numbers chosen so a single attacker can't
// out-damage a fueled shield's regen, but sustained multi-source fire (M19) or
// fuel-starvation can. All tunable; the tests assert behavior, not magnitudes.
export const MAX_SHIELD_HP = 1000;
const SHIELD_REGEN = 14;        // hp/sec restored while fueled (gross)
const SHIELD_DECAY = 4;         // hp/sec passive bleed (ALWAYS — dries offline bases)
const OIL_PER_HP = 0.05;        // oil consumed per hp regenerated (the oil sink)
// Regen pauses for a few seconds after ANY hit, so a SUSTAINED assault keeps the
// shield from healing (it cracks), while a lone attacker who can't keep up the
// pressure lets it recover between bursts. This is the anti-24/7 crux.
export const SHIELD_REGEN_DELAY = 4;
export const OIL_CAP = 4000;    // Core oil buffer ceiling
export const OIL_PER_BARREL = 25; // oil added per OilBarrel item fed in
export const GRACE_PERIOD = 120; // seconds a fresh claim is raid-proof regardless of HP

export interface ClaimState {
  id: number;
  faction: number;
  /** Core chunk coordinates (the claim is centred here, 3×3 chunks). */
  cx: number; cz: number;
  /** Core block world position. */
  coreX: number; coreY: number; coreZ: number;
  oil: number;
  shieldHp: number;
  maxShieldHp: number;
  /** Seconds of regen suppression remaining after the last hit (0 = regen ok). */
  regenCooldown: number;
  /** Server time (seconds) the claim was created — drives the grace period. */
  createdAt: number;
}

/** Chunk coordinates containing a world position. */
export function chunkOf(x: number, z: number): { cx: number; cz: number } {
  return { cx: Math.floor(x / CHUNK_X), cz: Math.floor(z / CHUNK_Z) };
}

/** Is chunk (cx,cz) inside the 3×3 footprint centred on (coreCx,coreCz)? */
export function chunkInClaim(cx: number, cz: number, coreCx: number, coreCz: number): boolean {
  return Math.abs(cx - coreCx) <= CLAIM_CHUNK_RADIUS &&
    Math.abs(cz - coreCz) <= CLAIM_CHUNK_RADIUS;
}

/** Every chunk key "cx,cz" in a claim's 3×3 footprint. */
export function claimChunkKeys(coreCx: number, coreCz: number): string[] {
  const out: string[] = [];
  for (let dx = -CLAIM_CHUNK_RADIUS; dx <= CLAIM_CHUNK_RADIUS; dx++) {
    for (let dz = -CLAIM_CHUNK_RADIUS; dz <= CLAIM_CHUNK_RADIUS; dz++) {
      out.push(`${coreCx + dx},${coreCz + dz}`);
    }
  }
  return out;
}

export function newClaim(
  id: number, faction: number, coreX: number, coreY: number, coreZ: number, now: number,
): ClaimState {
  const { cx, cz } = chunkOf(coreX, coreZ);
  return {
    id, faction, cx, cz,
    coreX: Math.floor(coreX), coreY: Math.floor(coreY), coreZ: Math.floor(coreZ),
    oil: 0,
    shieldHp: MAX_SHIELD_HP,
    maxShieldHp: MAX_SHIELD_HP,
    regenCooldown: 0,
    createdAt: Number.isFinite(now) ? now : 0,
  };
}

/** The shield is materially up (blocking) when it has any HP. */
export function shieldUp(claim: ClaimState): boolean {
  return claim.shieldHp > 0;
}

/** Within the fresh-claim grace window (raid-proof regardless of shield HP). */
export function inGrace(claim: ClaimState, now: number): boolean {
  return Number.isFinite(now) && now - claim.createdAt < GRACE_PERIOD;
}

/**
 * Is the claim currently PROTECTED from enemy edits/raids? True while the shield
 * has HP OR the grace period is active. Once the shield is down AND grace has
 * expired, the claim is raidable (M19). Fail-CLOSED on bad input.
 */
export function claimProtected(claim: ClaimState, now: number): boolean {
  return inGrace(claim, now) || shieldUp(claim);
}

/** Feed oil into the Core (barrels -> buffer). Returns barrels actually accepted
 *  (capped), so the client only consumes what fit. */
export function feedOil(claim: ClaimState, barrels: number): number {
  if (!Number.isFinite(barrels) || barrels <= 0) return 0;
  barrels = Math.floor(barrels);
  const room = OIL_CAP - claim.oil;
  const accepted = Math.max(0, Math.min(barrels, Math.floor(room / OIL_PER_BARREL)));
  claim.oil = Math.min(OIL_CAP, claim.oil + accepted * OIL_PER_BARREL);
  return accepted;
}

/** Apply raid damage directly to the shield (M19) and pause regen. Returns true
 *  if the shield is now down. */
export function damageShield(claim: ClaimState, amount: number): boolean {
  if (Number.isFinite(amount) && amount > 0) {
    claim.shieldHp = Math.max(0, Math.min(claim.maxShieldHp, claim.shieldHp) - amount);
    claim.regenCooldown = SHIELD_REGEN_DELAY; // sustained fire keeps this from clearing
  }
  return claim.shieldHp <= 0;
}

/**
 * Advance one claim by dt: a passive bleed always, then oil-fuelled regen toward
 * max (consuming oil). With oil the net change is positive (the shield holds /
 * recovers); with no oil only the bleed applies, so the shield dries to raidable.
 */
export function tickClaim(claim: ClaimState, dt: number): void {
  if (!Number.isFinite(dt) || dt <= 0) return;
  claim.shieldHp = Math.max(0, claim.shieldHp - SHIELD_DECAY * dt);
  claim.regenCooldown = Math.max(0, claim.regenCooldown - dt);
  if (claim.regenCooldown <= 0 && claim.oil > 0 && claim.shieldHp < claim.maxShieldHp) {
    let heal = Math.min(SHIELD_REGEN * dt, claim.maxShieldHp - claim.shieldHp);
    const cost = heal * OIL_PER_HP;
    if (cost > claim.oil) { heal = claim.oil / OIL_PER_HP; }
    claim.shieldHp = Math.min(claim.maxShieldHp, claim.shieldHp + heal);
    claim.oil = Math.max(0, claim.oil - heal * OIL_PER_HP);
  }
}

/** Normalize/validate a claim arriving over the wire (defensive, fail-closed). */
export function sanitizeClaim(raw: unknown): ClaimState | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const num = (v: unknown, d = 0): number => (Number.isFinite(v) ? Number(v) : d);
  if (!Number.isFinite(r.id) || !Number.isFinite(r.faction) ||
      !Number.isFinite(r.coreX) || !Number.isFinite(r.coreY) || !Number.isFinite(r.coreZ)) {
    return null;
  }
  const claim = newClaim(
    Math.floor(num(r.id)), Math.floor(num(r.faction)),
    num(r.coreX), num(r.coreY), num(r.coreZ), num(r.createdAt));
  claim.oil = Math.max(0, Math.min(OIL_CAP, num(r.oil)));
  claim.maxShieldHp = MAX_SHIELD_HP;
  claim.shieldHp = Math.max(0, Math.min(MAX_SHIELD_HP, num(r.shieldHp, MAX_SHIELD_HP)));
  claim.regenCooldown = Math.max(0, num(r.regenCooldown));
  return claim;
}

/**
 * Manager: claims keyed by id, with a chunk-key -> claimId index for O(1)
 * "who owns this chunk" lookups. Server-authoritative; offline SP + the client
 * predictor run the identical instance.
 */
export class Claims {
  private readonly byId = new Map<number, ClaimState>();
  private readonly byChunk = new Map<string, number>();
  private nextId = 1;

  /** A claim at a world position (the claim owning that column's chunk), or null. */
  at(x: number, z: number): ClaimState | undefined {
    const { cx, cz } = chunkOf(x, z);
    const id = this.byChunk.get(`${cx},${cz}`);
    return id === undefined ? undefined : this.byId.get(id);
  }

  get(id: number): ClaimState | undefined { return this.byId.get(id); }
  list(): ClaimState[] { return [...this.byId.values()]; }

  /** Would a Core at (coreX,coreZ) overlap an existing claim's footprint? */
  overlaps(coreX: number, coreZ: number): boolean {
    const { cx, cz } = chunkOf(coreX, coreZ);
    return claimChunkKeys(cx, cz).some((k) => this.byChunk.has(k));
  }

  /** Create + index a claim for a Core at a position. Returns null if it would
   *  overlap any existing claim (one Core per claim; no contested chunks). */
  create(faction: number, coreX: number, coreY: number, coreZ: number, now: number): ClaimState | null {
    if (this.overlaps(coreX, coreZ)) return null;
    const claim = newClaim(this.nextId++, faction, coreX, coreY, coreZ, now);
    this.byId.set(claim.id, claim);
    for (const k of claimChunkKeys(claim.cx, claim.cz)) this.byChunk.set(k, claim.id);
    return claim;
  }

  /** Adopt an authoritative claim (server sync); re-indexes its chunks. */
  set(claim: ClaimState): void {
    this.byId.set(claim.id, claim);
    for (const k of claimChunkKeys(claim.cx, claim.cz)) this.byChunk.set(k, claim.id);
  }

  /** Remove a claim (Core broken by its faction) + free its chunks. */
  remove(id: number): void {
    const claim = this.byId.get(id);
    if (!claim) return;
    this.byId.delete(id);
    for (const k of claimChunkKeys(claim.cx, claim.cz)) {
      if (this.byChunk.get(k) === id) this.byChunk.delete(k);
    }
  }

  /** The claim whose Core block sits exactly at a world position, or null. */
  coreAt(x: number, y: number, z: number): ClaimState | undefined {
    const c = this.at(x, z);
    return c && c.coreX === Math.floor(x) && c.coreY === Math.floor(y) &&
      c.coreZ === Math.floor(z) ? c : undefined;
  }

  tick(dt: number): void {
    for (const c of this.byId.values()) tickClaim(c, dt);
  }

  /** Drop all claims (e.g. leaving a server, whose claims we no longer mirror). */
  clear(): void {
    this.byId.clear();
    this.byChunk.clear();
  }
}
