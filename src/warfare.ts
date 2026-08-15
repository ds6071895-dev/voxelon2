// WARFARE COMMAND — the boss-powered technology tree that replaces the old
// generic stat-based Progress system.
//
// One trunk, three branches, plus optional operations modules.
//
//        TACTICAL MISSILES  →  MISSILE DEFENSE  →  HELICOPTER AVIATION
//                                      │
//                    ┌─────────────────┼─────────────────┐
//                  STRIKE            AEGIS              AIR
//
// Warfare XP comes from ONE place: beating a dungeon boss you actually helped
// kill. No mob grinding, no PvP farming, no chest-opening trickle — the whole
// economy is "go clear a vault, come back with a blueprint".
//
// PURE + transport-agnostic (no THREE/DOM/Node), like machines.ts/turrets.ts:
// the authoritative server, the online client and offline single-player all run
// these exact numbers, so a silo behaves identically everywhere.

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

export type WarfareBranch = 'trunk' | 'strike' | 'aegis' | 'air';

/** Which hardware family a node advances (drives the 3D preview + stat diff). */
export type WarfareHardware = 'silo' | 'battery' | 'helicopter';

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
 * The trunk guarantees the requested order — missiles, then missile defense,
 * then helicopters — because every node names the one before it as prerequisite.
 * The three branches all hang off the last trunk node, so the endgame opens
 * only once all three systems are online.
 */
export const WARFARE_TREE: WarfareNode[] = [
  // --- Main trunk (2,750 XP) ---
  node('missile_command', 'trunk', 'Missile Command',
    'The first warhead your faction is allowed to own.', 100, '', '🚀', 'silo', 1, 0, [
      'Blueprint: Tactical Silo (2×2 launch pad)',
      'Blueprint: Tactical Missile',
      'Map targeting mode with range circle and reticle',
    ]),
  node('guidance_vanes', 'trunk', 'Guidance Vanes',
    'Steerable fins turn a lob into a strike.', 150, 'missile_command', '🪽', 'silo', 2, 1, [
      'Target range 900 → 1,200',
      'Improved cruise speed and flatter trajectory',
    ]),
  node('hardened_silo', 'trunk', 'Hardened Silo',
    'Armour plate and a second tube.', 250, 'guidance_vanes', '🛡', 'silo', 3, 2, [
      'Silo HP 500 → 600',
      'Magazine 1 → 2 missiles',
    ]),
  node('aegis_systems', 'trunk', 'Aegis Systems',
    'Everything you just built, someone can now shoot down.', 250, 'hardened_silo', '📡', 'battery', 1, 3, [
      'Blueprint: Interceptor Turret',
      'Blueprint: Interceptor Missile',
      'Inbound-missile warnings and tracks',
    ]),
  node('radar_sweep', 'trunk', 'Radar Sweep',
    'A wider bowl sees them coming sooner.', 300, 'aegis_systems', '🛰', 'battery', 2, 4, [
      'Defense radius 110 → 140',
    ]),
  node('fast_intercept', 'trunk', 'Fast Intercept',
    'Lock, launch, reload — all of it faster.', 350, 'radar_sweep', '⚡', 'battery', 3, 5, [
      'Acquisition 0.70s → 0.45s',
      'Reload 12s → 10s',
    ]),
  node('flight_certification', 'trunk', 'Flight Certification',
    'Two seats, one rotor, no more walking to the fight.', 400, 'fast_intercept', '🚁', 'helicopter', 1, 6, [
      'Blueprint: Helipad',
      'Blueprint: Helicopter Mk I (pilot + passenger)',
      'Basic gravity bombs',
    ]),
  node('bomb_rack', 'trunk', 'Bomb Rack',
    'More to drop, less time between drops.', 450, 'flight_certification', '💣', 'helicopter', 2, 7, [
      'Bomb capacity 2 → 3',
      'Bomb cooldown 6s → 5s',
    ]),
  node('reinforced_airframe', 'trunk', 'Reinforced Airframe',
    'Survive the turret you flew over.', 500, 'bomb_rack', '🔩', 'helicopter', 3, 8, [
      'Helicopter HP 140 → 170',
      'Fuel capacity 12 → 16 oil',
    ]),

  // --- Strike branch (1,700 XP) ---
  node('strike_guidance', 'strike', 'Guidance II',
    'Reach across the map.', 450, 'reinforced_airframe', '🎯', 'silo', 4, 9, [
      'Missile range 1,200 → 1,700',
      'Faster cruise — shorter warning for the target',
    ]),
  node('strike_warhead', 'strike', 'Warhead II',
    'A bigger hole in whatever they built.', 550, 'strike_guidance', '☢', 'silo', 5, 10, [
      'Blast radius 7 → 8',
      'Centre player damage 14 → 16',
      'Centre hardware damage 180 → 240',
      'Player-built blocks removed 8 → 12',
    ]),
  node('strike_precision', 'strike', 'Precision Strike III',
    'Anywhere, sooner, harder.', 700, 'strike_warhead', '💥', 'silo', 6, 11, [
      'Missile range 1,700 → 2,300',
      'Blast radius 9 · player damage 18 · hardware damage 300',
      'Player-built blocks removed 16',
      'Silo cooldown 105s → 90s · magazine 3',
    ], true),
  // --- Aegis branch (1,700 XP) ---
  node('aegis_network', 'aegis', 'Network Radar',
    'Batteries stop working alone.', 450, 'reinforced_airframe', '🌐', 'battery', 4, 9, [
      'Defense radius 140 → 170',
      'Nearby friendly batteries share tracks',
      'Battery HP 200 → 240 · acquisition 0.35s',
    ]),
  node('aegis_twin_rack', 'aegis', 'Twin Rack',
    'Two tubes beat one saturation wave.', 550, 'aegis_network', '🎇', 'battery', 5, 10, [
      'Interceptor capacity 4 → 7',
      'Intercept reload 10s → 8s',
    ]),
  node('aegis_sky_shield', 'aegis', 'Sky Shield',
    'Nothing crosses this airspace uninvited.', 700, 'aegis_twin_rack', '🕸', 'battery', 6, 11, [
      'Defense radius 200 · capacity 8',
      'Acquisition 0.25s · reload 6s',
      'Battery HP 300',
    ], true),

  // --- Aviation branch (2,050 XP) ---
  node('air_turbine', 'air', 'Turbine II',
    'Climb out of small-arms range.', 500, 'reinforced_airframe', '🌀', 'helicopter', 4, 9, [
      'Cruise speed 16 → 20 blocks/s',
      'Higher climb rate',
      'Altitude allowance 64 → 96 blocks',
      'HP 170 → 190 · fuel 16 → 18',
    ]),
  node('air_heavy_bay', 'air', 'Heavy Bomb Bay',
    'Four in the rack, and they bite.', 650, 'air_turbine', '🧨', 'helicopter', 5, 10, [
      'Bomb capacity 3 → 4',
      'Bomb radius 4 → 5',
      'Bomb hardware damage 80 → 100 · player damage 12',
    ]),
  node('air_command', 'air', 'Air Command III',
    'The gunship the whole server plans around.', 900, 'air_heavy_bay', '👑', 'helicopter', 6, 11, [
      'HP 220 · cruise speed 24 blocks/s',
      'Five bombs · radius 6 · cooldown 4s',
      'Altitude allowance 128 blocks · fuel 24 oil',
    ], true),
  node('air_aux_tanks', 'air', 'Auxiliary Tanks',
    'A second fuel circuit doubles sortie endurance.', 450, 'air_command', '⛽', 'helicopter', 6, 12, [
      'Blueprint: Auxiliary Tank Module',
      'Installed helicopter fuel capacity ×2',
    ]),
  node('air_long_range_tanks', 'air', 'Long-Range Tanks',
    'Triple-range tanks turn a raid into an expedition.', 650, 'air_aux_tanks', '🛢', 'helicopter', 6, 13, [
      'Blueprint: Long-Range Tank Module',
      'Installed helicopter fuel capacity ×3',
    ]),
  node('air_fast_rope', 'air', 'Fast-Rope Operations',
    'Hold the hover, throw the line, own the vertical.', 500, 'air_long_range_tanks', '🪢', 'helicopter', 6, 14, [
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

/** Total XP to own the entire tree (9,800). */
export const WARFARE_TREE_COST = WARFARE_TREE.reduce((s, n) => s + n.cost, 0);

export const WARFARE_BRANCH_META: Record<WarfareBranch, { name: string; icon: string; blurb: string }> = {
  trunk: { name: 'Command Trunk', icon: '⌘',
    blurb: 'Missiles, then the defense that answers them, then the air wing.' },
  strike: { name: 'Strike', icon: '🎯',
    blurb: 'Longer reach, heavier warheads, shorter silo cooldowns.' },
  aegis: { name: 'Aegis', icon: '🛰',
    blurb: 'Wider radar, deeper magazines, an airspace nothing crosses.' },
  air: { name: 'Aviation', icon: '🚁',
    blurb: 'Faster gunships that fly higher and drop more.' },
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
// Every hardware family climbs the SAME six-rung ladder: rungs 1–3 come off the
// trunk, 4–6 off that family's branch. A blueprint node lets you BUILD or
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

// --- Silo + tactical missile stats -------------------------------------------

export interface SiloStats {
  /** Max target distance from the silo, in blocks. */
  range: number;
  /** Cruise speed, blocks/s. */
  speed: number;
  hp: number;
  magazine: number;
  /** Seconds the silo is locked after a launch. */
  cooldown: number;
  /** Blast radius in blocks. */
  blastRadius: number;
  /** Damage at the exact centre to a player (linear falloff to 0 at the rim). */
  playerDamage: number;
  /** Damage at the centre to hardware (silos/batteries/helicopters/machines). */
  hardwareDamage: number;
  /** Maximum player-PLACED blocks removed by one impact. */
  blocks: number;
}

const SILO_TABLE: SiloStats[] = [
  // Mk I — "Initial" column.
  { range: 900, speed: 55, hp: 500, magazine: 1, cooldown: 120,
    blastRadius: 7, playerDamage: 14, hardwareDamage: 180, blocks: 8 },
  // Mk II — Guidance Vanes.
  { range: 1200, speed: 70, hp: 500, magazine: 1, cooldown: 120,
    blastRadius: 7, playerDamage: 14, hardwareDamage: 180, blocks: 8 },
  // Mk III — Hardened Silo.
  { range: 1200, speed: 70, hp: 600, magazine: 2, cooldown: 120,
    blastRadius: 7, playerDamage: 14, hardwareDamage: 180, blocks: 8 },
  // Mk IV — Guidance II.
  { range: 1700, speed: 88, hp: 700, magazine: 2, cooldown: 105,
    blastRadius: 7, playerDamage: 14, hardwareDamage: 180, blocks: 8 },
  // Mk V — Warhead II ("Mid" column).
  { range: 1700, speed: 88, hp: 700, magazine: 2, cooldown: 105,
    blastRadius: 8, playerDamage: 16, hardwareDamage: 240, blocks: 12 },
  // Mk VI — Precision Strike III ("Maximum" column).
  { range: 2300, speed: 104, hp: 800, magazine: 3, cooldown: 90,
    blastRadius: 9, playerDamage: 18, hardwareDamage: 300, blocks: 16 },
];

export function siloStats(tier: number): SiloStats {
  return { ...SILO_TABLE[clampTier(tier) - 1] };
}

// --- Interceptor battery stats ------------------------------------------------

export interface BatteryStats {
  hp: number;
  /** Radius (blocks) inside which inbound missiles are engaged. */
  radius: number;
  /** Seconds of lock-on before the interceptor leaves the rail. */
  acquire: number;
  /** Seconds between interceptor launches. */
  reload: number;
  /** Loaded interceptor capacity. */
  capacity: number;
  /** Batteries at this tier share tracks with nearby friendly batteries. */
  networked: boolean;
}

const BATTERY_TABLE: BatteryStats[] = [
  { hp: 180, radius: 110, acquire: 0.70, reload: 12, capacity: 4, networked: false },
  { hp: 180, radius: 140, acquire: 0.70, reload: 12, capacity: 4, networked: false },
  { hp: 200, radius: 140, acquire: 0.45, reload: 10, capacity: 4, networked: false },
  { hp: 240, radius: 170, acquire: 0.35, reload: 10, capacity: 4, networked: true },
  { hp: 240, radius: 170, acquire: 0.35, reload: 8, capacity: 7, networked: true },
  { hp: 300, radius: 200, acquire: 0.25, reload: 6, capacity: 8, networked: true },
];

export function batteryStats(tier: number): BatteryStats {
  return { ...BATTERY_TABLE[clampTier(tier) - 1] };
}

/** Interceptor flight speed (blocks/s) — deliberately much faster than any
 *  offensive missile, so reaching the track is a geometry problem, not a race. */
export const INTERCEPTOR_SPEED = 170;

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

// --- Strategic rules shared by every layer ------------------------------------

/** Faction-wide hardware caps and spacing (blocks). */
export const MAX_SILOS_PER_FACTION = 2;
export const MIN_SILO_SPACING = 48;
export const MAX_BATTERIES_PER_FACTION = 4;
export const MIN_BATTERY_SPACING = 24;
/** Offensive missiles in flight per faction. */
export const MAX_MISSILES_IN_FLIGHT = 2;
/** Seconds between launches ACROSS a whole faction. */
export const FACTION_LAUNCH_SPACING = 30;
/** Every strike gives the target at least this long to react. */
export const MIN_MISSILE_FLIGHT = 8;
/** The missile hull itself can be shot down by accurate gunfire. */
export const MISSILE_HULL_HP = 24;
/** Radius (blocks) around a protected point that a strike may not target. */
export const PROTECTED_RADIUS = 40;

/** Flight time for a strike: distance/speed, but never under the warning floor. */
export function missileFlightTime(distance: number, speed: number): number {
  if (!Number.isFinite(distance) || !Number.isFinite(speed) || speed <= 0) return MIN_MISSILE_FLIGHT;
  return Math.max(MIN_MISSILE_FLIGHT, distance / speed);
}

/** Linear falloff from the centre of a blast, applied once per target. */
export function blastFalloff(distance: number, radius: number): number {
  if (!(radius > 0) || !Number.isFinite(distance)) return 0;
  if (distance >= radius) return 0;
  return Math.max(0, 1 - distance / radius);
}

export function blastDamage(centre: number, distance: number, radius: number): number {
  return Math.round(centre * blastFalloff(distance, radius));
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
