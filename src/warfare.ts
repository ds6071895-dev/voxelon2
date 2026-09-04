// WARFARE COMMAND — the boss-powered technology tree that replaces the old
// generic stat-based Progress system.
//
// One trunk, one branch, plus optional operations modules.
//
//                        HELICOPTER AVIATION
//                                 │
//                                AIR
//
// Warfare XP comes from ONE place: beating a dungeon boss you actually helped
// kill. No mob grinding, no PvP farming, no chest-opening trickle — the whole
// economy is "go clear a vault, come back with a blueprint".
//
// PURE + transport-agnostic (no THREE/DOM/Node), like machines.ts/turrets.ts:
// the authoritative server, the online client and offline single-player all run
// these exact numbers, so a helicopter behaves identically everywhere.

import { iconSvg } from './emoji_icons';

// --- The progression blob ----------------------------------------------------

export const WARFARE_VERSION = 1;

export interface WarfareProgress {
  version: 1;
  /** Total warfare XP ever EARNED (never decremented — spend is derived). */
  xp: number;
  /** Purchased node ids. */
  nodes: string[];
}

export function newWarfare(): WarfareProgress {
  return { version: WARFARE_VERSION, xp: 0, nodes: [] };
}

// --- Boss XP -----------------------------------------------------------------

/** Warfare XP for clearing a vault boss, by tier. Awarded to every QUALIFYING
 *  participant independently — never divided by party size. */
export const WARFARE_TIER_XP: Record<number, number> = { 1: 300, 2: 750, 3: 1500 };

export function warfareXpForTier(tier: number): number {
  return WARFARE_TIER_XP[Math.floor(tier)] ?? 0;
}

/** Contribution thresholds. A player either pulled real weight for a real slice
 *  of the fight, or carried an outright chunk of the health bar. */
export const CONTRIB_MIN_DAMAGE_FRAC = 0.02;   // 2% of scaled boss HP …
export const CONTRIB_MIN_TIME_FRAC = 0.25;     // … plus 25% of the attempt
export const CONTRIB_SOLO_DAMAGE_FRAC = 0.10;  // or 10%, duration irrelevant

/** One participant's whole-attempt record. Kept for players who die or leave —
 *  dying two seconds before the kill must never erase the work. */
export interface ContributionRecord {
  /** Runtime player id (0 for offline/local). */
  id: number;
  username: string;
  /** Damage ACCEPTED by the authoritative encounter engine. */
  damage: number;
  /** Seconds spent inside the fight (accumulated across deaths/rejoins). */
  activeSeconds: number;
  /** True if the player was ever a non-survival (creative/spectator) observer
   *  during the attempt — those never earn warfare XP. */
  observer?: boolean;
}

export function newContribution(id: number, username: string): ContributionRecord {
  return { id, username, damage: 0, activeSeconds: 0 };
}

/** Does this record earn the tier's warfare XP? */
export function qualifiesForWarfareXp(
  rec: ContributionRecord, scaledBossHp: number, encounterSeconds: number,
): boolean {
  if (!rec || rec.observer) return false;
  if (!(scaledBossHp > 0) || !Number.isFinite(rec.damage) || rec.damage <= 0) return false;
  const frac = rec.damage / scaledBossHp;
  if (frac >= CONTRIB_SOLO_DAMAGE_FRAC) return true;
  if (frac < CONTRIB_MIN_DAMAGE_FRAC) return false;
  // A fight so short it has no meaningful duration can't gate on duration.
  const need = Math.max(0, encounterSeconds) * CONTRIB_MIN_TIME_FRAC;
  return rec.activeSeconds + 1e-6 >= need;
}

/** The full settlement for one victory: who earned what. Pure so the server,
 *  the offline client and the tests all agree byte for byte. */
export function settleWarfareXp(
  ledger: readonly ContributionRecord[], tier: number,
  scaledBossHp: number, encounterSeconds: number,
): { username: string; id: number; xp: number }[] {
  const xp = warfareXpForTier(tier);
  if (xp <= 0) return [];
  const out: { username: string; id: number; xp: number }[] = [];
  const paid = new Set<string>();
  for (const rec of ledger) {
    if (!qualifiesForWarfareXp(rec, scaledBossHp, encounterSeconds)) continue;
    const key = rec.username.toLowerCase();
    if (paid.has(key)) continue;   // once per account, never per socket
    paid.add(key);
    out.push({ username: rec.username, id: rec.id, xp });
  }
  return out;
}

// --- The tree ----------------------------------------------------------------

export type WarfareBranch = 'trunk' | 'air';

/** Which hardware family a node advances (drives the 3D preview + stat diff). */
export type WarfareHardware = 'helicopter';

export interface WarfareNode {
  id: string;
  branch: WarfareBranch;
  name: string;
  /** Short flavour line shown under the name. */
  tagline: string;
  /** What this purchase concretely unlocks or changes. */
  unlocks: string[];
  cost: number;
  /** Node that must be owned first ('' for the root). */
  prereq: string;
  icon: string;
  /** Hardware family whose tier this node raises (drives previews/stat diffs). */
  hardware: WarfareHardware;
  /** Hardware tier this node grants — owning it lets you BUILD/retrofit to it. */
  tier: number;
  /** Depth from the root, for tree layout. */
  depth: number;
  /** True for the three branch capstones (drawn as big hexes). */
  capstone?: boolean;
}

function node(
  id: string, branch: WarfareBranch, name: string, tagline: string, cost: number,
  prereq: string, icon: string, hardware: WarfareHardware, tier: number,
  depth: number, unlocks: string[], capstone = false,
): WarfareNode {
  return { id, branch, name, tagline, unlocks, cost, prereq, icon, hardware, tier, depth, capstone };
}

/**
 * The trunk is the aviation certification ladder — airframe, ordnance, armour —
 * and the single Aviation branch hangs off its last node, so the endgame opens
 * only once the basic air wing is flying.
 */
export const WARFARE_TREE: WarfareNode[] = [
  // --- Main trunk (600 XP) ---
  node('flight_certification', 'trunk', 'Flight Certification',
    'Two seats, one rotor, no more walking to the fight.', 100, '', iconSvg('heli'), 'helicopter', 1, 0, [
      'Blueprint: Helipad',
      'Blueprint: Helicopter Mk I (pilot + passenger)',
      'Basic gravity bombs',
    ]),
  node('bomb_rack', 'trunk', 'Bomb Rack',
    'More to drop, less time between drops.', 200, 'flight_certification', iconSvg('bomb'), 'helicopter', 2, 1, [
      'Bomb capacity 2 → 3',
      'Bomb cooldown 6s → 5s',
    ]),
  node('reinforced_airframe', 'trunk', 'Reinforced Airframe',
    'Survive the turret you flew over.', 300, 'bomb_rack', iconSvg('nut'), 'helicopter', 3, 2, [
      'Helicopter HP 140 → 170',
      'Fuel capacity 12 → 16 oil',
    ]),

  // --- Aviation branch (3,300 XP) ---
  node('air_turbine', 'air', 'Turbine II',
    'Climb out of small-arms range.', 400, 'reinforced_airframe', iconSvg('vortex'), 'helicopter', 4, 3, [
      'Cruise speed 16 → 20 blocks/s',
      'Higher climb rate',
      'Altitude allowance 64 → 96 blocks',
      'HP 170 → 190 · fuel 16 → 18',
    ]),
  node('air_heavy_bay', 'air', 'Heavy Bomb Bay',
    'Four in the rack, and they bite.', 550, 'air_turbine', iconSvg('dynamite'), 'helicopter', 5, 4, [
      'Bomb capacity 3 → 4',
      'Bomb radius 4 → 5',
      'Bomb hardware damage 80 → 100 · player damage 12',
    ]),
  node('air_command', 'air', 'Air Command III',
    'The gunship the whole server plans around.', 750, 'air_heavy_bay', iconSvg('crown'), 'helicopter', 6, 5, [
      'HP 220 · cruise speed 24 blocks/s',
      'Five bombs · radius 6 · cooldown 4s',
      'Altitude allowance 128 blocks · fuel 24 oil',
    ], true),
  node('air_aux_tanks', 'air', 'Auxiliary Tanks',
    'A second fuel circuit doubles sortie endurance.', 450, 'air_command', iconSvg('fuel'), 'helicopter', 6, 6, [
      'Blueprint: Auxiliary Tank Module',
      'Installed helicopter fuel capacity ×2',
    ]),
  node('air_long_range_tanks', 'air', 'Long-Range Tanks',
    'Triple-range tanks turn a raid into an expedition.', 650, 'air_aux_tanks', iconSvg('drum'), 'helicopter', 6, 7, [
      'Blueprint: Long-Range Tank Module',
      'Installed helicopter fuel capacity ×3',
    ]),
  node('air_fast_rope', 'air', 'Fast-Rope Operations',
    'Hold the hover, throw the line, own the vertical.', 500, 'air_long_range_tanks', iconSvg('link'), 'helicopter', 6, 8, [
      'Blueprint: Fast-Rope Winch',
      'R lowers or retracts a rope while piloting',
      'The helicopter holds position while people climb',
    ]),
];

const NODE_BY_ID = new Map(WARFARE_TREE.map((n) => [n.id, n]));

export function warfareNode(id: string): WarfareNode | undefined {
  return NODE_BY_ID.get(id);
}
export function warfareBranchNodes(branch: WarfareBranch): WarfareNode[] {
  return WARFARE_TREE.filter((n) => n.branch === branch);
}

/** Total XP to own the entire tree (3,900). */
export const WARFARE_TREE_COST = WARFARE_TREE.reduce((s, n) => s + n.cost, 0);

export const WARFARE_BRANCH_META: Record<WarfareBranch, { name: string; icon: string; blurb: string }> = {
  trunk: { name: 'Command Trunk', icon: iconSvg('command'),
    blurb: 'Certify the airframe, hang ordnance on it, then armour it.' },
  air: { name: 'Aviation', icon: iconSvg('heli'),
    blurb: 'Faster gunships that fly higher, drop more and stay up longer.' },
};

// --- Spending ----------------------------------------------------------------

export function warfareOwns(s: WarfareProgress, id: string): boolean {
  return s.nodes.includes(id);
}

export function warfareSpent(s: WarfareProgress): number {
  let n = 0;
  for (const id of s.nodes) n += NODE_BY_ID.get(id)?.cost ?? 0;
  return n;
}

/** XP still available to spend (earned − purchased). */
export function warfareAvailable(s: WarfareProgress): number {
  return Math.max(0, s.xp - warfareSpent(s));
}

/** Fraction of the tree owned, by XP value (0..1). */
export function warfareCompletion(s: WarfareProgress): number {
  return Math.min(1, warfareSpent(s) / WARFARE_TREE_COST);
}

/** Is the node's prerequisite satisfied (regardless of XP)? */
export function warfareUnlocked(s: WarfareProgress, id: string): boolean {
  const n = NODE_BY_ID.get(id);
  if (!n) return false;
  return n.prereq === '' || warfareOwns(s, n.prereq);
}

export function canBuyWarfareNode(s: WarfareProgress, id: string): boolean {
  const n = NODE_BY_ID.get(id);
  if (!n || warfareOwns(s, id) || !warfareUnlocked(s, id)) return false;
  return warfareAvailable(s) >= n.cost;
}

/** Reason a purchase is blocked, for the UI (null = purchasable). */
export function warfareBlockReason(s: WarfareProgress, id: string): string | null {
  const n = NODE_BY_ID.get(id);
  if (!n) return 'Unknown technology';
  if (warfareOwns(s, id)) return 'Already authorized';
  if (!warfareUnlocked(s, id)) {
    return `Requires ${NODE_BY_ID.get(n.prereq)?.name ?? n.prereq}`;
  }
  const short = n.cost - warfareAvailable(s);
  if (short > 0) return `${short.toLocaleString()} more warfare XP needed`;
  return null;
}

export function buyWarfareNode(s: WarfareProgress, id: string): boolean {
  if (!canBuyWarfareNode(s, id)) return false;
  s.nodes.push(id);
  return true;
}

/** Grant earned XP (the only way `xp` ever grows). */
export function grantWarfareXp(s: WarfareProgress, amount: number): number {
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  const add = Math.floor(amount);
  s.xp += add;
  return add;
}

// --- Hardware capability ------------------------------------------------------
// Hardware climbs a six-rung ladder: rungs 1–3 come off the trunk, 4–6 off the
// Aviation branch. A blueprint node lets you BUILD or
// RETROFIT to that rung; the physical object then records its installed tier and
// works for any teammate, whether or not they own the node.

export const MAX_HARDWARE_TIER = 6;

/** Highest tier of `hardware` this progression may build or retrofit to
 *  (0 = not unlocked at all). */
export function warfareTier(s: WarfareProgress, hardware: WarfareHardware): number {
  let best = 0;
  for (const id of s.nodes) {
    const n = NODE_BY_ID.get(id);
    if (n && n.hardware === hardware && n.tier > best) best = n.tier;
  }
  return best;
}

export function clampTier(t: number): number {
  if (!Number.isFinite(t)) return 1;
  return Math.max(1, Math.min(MAX_HARDWARE_TIER, Math.floor(t)));
}

// --- Helicopter stats ---------------------------------------------------------

export interface HelicopterStats {
  hp: number;
  /** Cruise speed, blocks/s. */
  speed: number;
  /** Climb/descend speed, blocks/s. */
  climb: number;
  /** Fuel capacity, in oil barrels. */
  fuel: number;
  bombs: number;
  bombRadius: number;
  bombPlayerDamage: number;
  bombHardwareDamage: number;
  /** Maximum destructible world blocks removed by one aerial bomb. */
  bombBlocks: number;
  bombCooldown: number;
  /** Blocks above terrain the airframe is allowed to climb. */
  altitude: number;
  /** Marketing mark (Mk I / II / III) for the model + HUD. */
  mark: 1 | 2 | 3;
}

// Fuel is quoted in oil barrels and the turbine drinks it: see HELI_FUEL_IDLE /
// HELI_FUEL_BURN in vehicles.ts. A Mk I tank is roughly two minutes of hovering
// or forty seconds of hard flying, so a sortie is a real logistics decision and
// running dry over hostile ground drops you out of the sky.
const HELI_TABLE: HelicopterStats[] = [
  // Mk I — Flight Certification.
  { hp: 140, speed: 16, climb: 7, fuel: 48, bombs: 2, bombRadius: 7,
    bombPlayerDamage: 30, bombHardwareDamage: 140, bombBlocks: 40, bombCooldown: 6, altitude: 64, mark: 1 },
  // Bomb Rack.
  { hp: 140, speed: 16, climb: 7, fuel: 48, bombs: 3, bombRadius: 7,
    bombPlayerDamage: 30, bombHardwareDamage: 140, bombBlocks: 40, bombCooldown: 5, altitude: 64, mark: 1 },
  // Reinforced Airframe.
  { hp: 170, speed: 16, climb: 7, fuel: 60, bombs: 3, bombRadius: 7,
    bombPlayerDamage: 30, bombHardwareDamage: 140, bombBlocks: 40, bombCooldown: 5, altitude: 64, mark: 1 },
  // Turbine II.
  { hp: 190, speed: 20, climb: 9, fuel: 72, bombs: 3, bombRadius: 7,
    bombPlayerDamage: 30, bombHardwareDamage: 140, bombBlocks: 40, bombCooldown: 5, altitude: 96, mark: 2 },
  // Heavy Bomb Bay — the plan's "Mk II" column.
  { hp: 190, speed: 20, climb: 9, fuel: 72, bombs: 4, bombRadius: 9,
    bombPlayerDamage: 36, bombHardwareDamage: 180, bombBlocks: 80, bombCooldown: 5, altitude: 96, mark: 2 },
  // Air Command III — the plan's "Mk III" column.
  { hp: 220, speed: 24, climb: 11, fuel: 96, bombs: 5, bombRadius: 11,
    bombPlayerDamage: 44, bombHardwareDamage: 240, bombBlocks: 140, bombCooldown: 4, altitude: 128, mark: 3 },
];

export function helicopterStats(tier: number): HelicopterStats {
  return { ...HELI_TABLE[clampTier(tier) - 1] };
}

/** Human label for an installed hardware tier. */
export function tierLabel(tier: number): string {
  return `Mk ${['I', 'II', 'III', 'IV', 'V', 'VI'][clampTier(tier) - 1]}`;
}

// --- Blast rules shared by every layer ----------------------------------------

/** Linear falloff from the centre of a blast, applied once per target. */
export function blastFalloff(distance: number, radius: number): number {
  if (!(radius > 0) || !Number.isFinite(distance)) return 0;
  if (distance >= radius) return 0;
  return Math.max(0, 1 - distance / radius);
}

export function blastDamage(centre: number, distance: number, radius: number): number {
  return Math.round(centre * blastFalloff(distance, radius));
}

/** Damage one target from a blast centre — linear falloff, applied ONCE. */
export function blastAt(
  centre: { x: number; y: number; z: number },
  target: { x: number; y: number; z: number },
  radius: number, centreDamage: number,
): number {
  const d = Math.hypot(centre.x - target.x, centre.y - target.y, centre.z - target.z);
  return blastDamage(centreDamage, d, radius);
}

/** Blocks a blast may consider, nearest first. The caller keeps only the ones
 *  that are player-PLACED and destructible, then stops at the ordnance's cap —
 *  so natural terrain is never permanently excavated. */
export function blastBlockCandidates(
  cx: number, cy: number, cz: number, radius: number,
): { x: number; y: number; z: number; d: number }[] {
  const r = Math.max(0, Math.ceil(radius));
  const out: { x: number; y: number; z: number; d: number }[] = [];
  const ox = Math.floor(cx), oy = Math.floor(cy), oz = Math.floor(cz);
  for (let dx = -r; dx <= r; dx++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dz = -r; dz <= r; dz++) {
        const d = Math.hypot(dx, dy, dz);
        if (d > radius) continue;
        out.push({ x: ox + dx, y: oy + dy, z: oz + dz, d });
      }
    }
  }
  out.sort((a, b) => a.d - b.d);
  return out;
}

// --- Sanitization + migration -------------------------------------------------

/** Fail-closed validation of a persisted warfare blob. Keeps earned XP, keeps
 *  only real node ids, drops any node whose prerequisite chain is broken, and
 *  then drops the most expensive purchases until they fit the XP actually
 *  earned. A hand-edited save can therefore never mint a free capstone. */
export function sanitizeWarfare(raw: unknown): WarfareProgress {
  const s = newWarfare();
  if (!raw || typeof raw !== 'object') return s;
  const r = raw as Record<string, unknown>;
  s.xp = Number.isFinite(r.xp) ? Math.max(0, Math.floor(r.xp as number)) : 0;
  const owned = new Set(
    (Array.isArray(r.nodes) ? (r.nodes as unknown[]) : [])
      .filter((n): n is string => typeof n === 'string' && NODE_BY_ID.has(n)),
  );
  // Walk the tree root-first so a node is only kept when its prereq survived.
  let budget = s.xp;
  const kept = new Set<string>();
  let changed = true;
  while (changed) {
    changed = false;
    for (const n of WARFARE_TREE) {
      if (kept.has(n.id) || !owned.has(n.id)) continue;
      if (n.prereq !== '' && !kept.has(n.prereq)) continue;
      if (n.cost > budget) continue;
      budget -= n.cost;
      kept.add(n.id);
      changed = true;
    }
  }
  for (const n of WARFARE_TREE) if (kept.has(n.id)) s.nodes.push(n.id);
  return s;
}

/**
 * The one-time `warfare-v1` migration. Old personal Progress XP, purchased
 * skill nodes, faction XP levels and every generic personal buff are RETIRED —
 * they are simply not carried across. Everything else a player owns (inventory,
 * hearts, faction, machines, ordinary turrets, vault loot history, records, war
 * score, world edits) lives in other fields and is untouched by this function.
 *
 * Returns the fresh warfare blob plus the cleaned data object with the dead
 * keys removed, so subsequent saves never write them again.
 */
export const WARFARE_MIGRATION_KEY = 'warfare-v1';

/** Keys the retired progression system used to write into account/local data. */
export const RETIRED_PROGRESS_KEYS = ['progress', 'xp', 'skills', 'factionXp'] as const;

export function migrateWarfare(
  data: Record<string, unknown> | undefined | null,
): { warfare: WarfareProgress; data: Record<string, unknown>; migrated: boolean } {
  const src = data && typeof data === 'object' ? { ...data } : {};
  const already = src[WARFARE_MIGRATION_KEY] === true;
  const warfare = sanitizeWarfare(src.warfare);
  let migrated = false;
  for (const key of RETIRED_PROGRESS_KEYS) {
    if (key in src) { delete src[key]; migrated = true; }
  }
  if (!already) { src[WARFARE_MIGRATION_KEY] = true; migrated = true; }
  src.warfare = warfare;
  return { warfare, data: src, migrated };
}
