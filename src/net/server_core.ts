// Authoritative-lite game server logic, transport-agnostic and pure (no ws,
// no Node APIs) so it can be unit-tested headlessly and reused by the WS
// shell. Owns: the shared edit log, every player's health, username
// assignment, spawns (via the shared deterministic Terrain), PvP hit
// validation, regen, and snapshots.

import { BLOCKS, Block, isVaultMasonry, migrateBlockId } from '../blocks';
import { ITEMS, ItemStack, gunVolley } from '../items';
import {
  MachineState, MachineType, applyUpgrade, claimMachine, collectMachine,
  damageMachine, machineHeight, machineTypeForBlock, newMachine, setFilter,
  tickMachine, sanitizeState as sanitizeMachineState,
} from '../machines';
import { Item } from '../items';
import {
  TurretState, applyTurretUpgrade, claimTurret, damageTurret, newTurret,
  turretArmed, turretConsumeShot, turretDamage, turretLoad, turretRange,
  sanitizeTurretState,
} from '../turrets';
import {
  FACTIONS, NO_FACTION, balancedFaction, factionName, isFaction, sameFaction,
  canSwitchFaction, switchesRemaining,
} from '../teams';
import {
  SeasonState, newSeason, sanitizeSeason, seasonTimeLeft, seasonWireTimeLeft,
  seasonExpired, tickSeasonClock, advanceSeason, deadlineWinner,
} from '../season';
import {
  WarState, newWar, warActive, warSnapshot, scheduleWar, sanitizeWar,
  warBorderAt, warDuration, DEFAULT_WAR_DURATION, clampInsideBorder,
} from '../war';
import {
  FlagsState, newFlags, sanitizeFlags, hitFlag, returnFlag, tryCapture,
  factionHasFlag, carriedBy, flagHome, FLAG_HIT_COOLDOWN,
} from '../flags';
import {
  Broadcast, PoliticsState, castVote, disbandParty, electionOf, foundParty,
  governmentOf, isPresident, newPolitics, partyById, pushBroadcast, rollCycle,
  sanitizePolitics, setKit, setTaxRate, tallyElection, termExpired, voteCounts,
} from '../politics';
import {
  Treasury, deposit, kitItemCount, kitStacks, setTreasuryPage,
  levy, newTreasuries, raid, sanitizeTreasury, treasuryCount, treasuryInReach,
  RAID_COOLDOWN, RAID_STACKS,
} from '../treasury';
import {
  ContributionRecord, WarfareProgress, buyWarfareNode, grantWarfareXp,
  newWarfare, sanitizeWarfare, settleWarfareXp,
  warfareOwns, warfareTier, MAX_HARDWARE_TIER,
  blastAt, blastBlockCandidates,
} from '../warfare';
import {
  HelicopterState, VehicleSim, VehicleEvent, bombBlast, sanitizeHelicopter,
} from '../vehicles';
import { WARFARE_BLUEPRINTS } from '../crafting';
import { GadgetCooldowns, gadgetOf, falloffDamage } from '../gadgets';
import { leverFlips } from '../traps';
import { sanitizeCosmetics } from '../character';
import { Terrain } from '../terrain';
import { structureChestTier, worldStructures } from '../structures';
import { chestLootSlots } from '../loot';
import {
  VAULT_BOSS_NAMES, VaultServerState, VaultStamp, newVaultState,
  refreshVaultState, recordVaultLoot, sanitizeVaultState, vaultChestAt,
  vaultAt, vaultLoot, vaultLootCooldownLeft, vaultLootable, vaultStamp,
  worldVaults,
} from '../vaults';
import {
  ClientMsg, EDIT_RANGE, CHEST_SLOTS, PICKUP_RANGE,
  ARMOR_POINT_CAP, RANGED_MAX_RANGE, RANGED_MAX_DAMAGE,
  mitigate, TOUGHNESS_CAP, DuelLeaderboardEntry, ItemEntityInfo, PlayerInfo, PlayerSnapshot, ServerMsg,
  WORLD_SEED, WORLD_HALF, WORLD_BORDER, CORE_HALF, makeUsername, skinSeed, GameMode,
  MAX_ATTUNED, TOTEM_COOLDOWN, COMBAT_TAG, TPA_EXPIRE, bloodlustMult,
  FACTION_FACES_LIMIT, FACTION_ROSTER_LIMIT, type FactionPublic, type Notification,
} from './protocol';
import {
  COMEBACK_HEARTS, KILL_CREDIT_WINDOW, MAX_HEARTS, canConsume, canWithdraw,
  clampHearts, maxHealthFor, transferHeart,
} from '../hearts';
import {
  ArenaBounds, EncounterParticipant, VaultAttackIntent, VaultEncounter, bossMaxHp,
  participantHpMultiplier, encounterArmorPierce,
} from '../vault_encounter';
import {
  Duels, DuelArenaBounds, DuelLobbySnapshot, DUEL_ARENA_SIZE, DUEL_MAX_HEALTH, DUEL_MAX_PILLAR_HEIGHT,
  clampToDuelArena, duelArenaBlockAt, duelArenaBounds, duelArenaSolidAt, duelTerrainElevation,
  hasArenaLineOfSight, safestDuelSpawn, secureDuelToken,
} from '../duels';
import { ArenaAABB, ArenaKind } from '../arena';
import {
  BEDWARS_ARENA_SIZE, BEDWARS_CEILING_Y, BEDWARS_CLAMP_RADIUS, BEDWARS_FLOOR_Y,
  BEDWARS_MAX_HEALTH, BEDWARS_VOID_Y,
  BW_GEN_GOLD_MS, BW_GEN_IRON_MS, BW_MELEE_FACING_DOT, BW_MELEE_RANGE,
  BW_MELEE_REWIND_S, BW_PICKUP_RADIUS, BW_SWING_FLOOR, BW_COMBO_WINDOW_MS,
  Bedwars, BwArenaBounds, BwLobbySnapshot, bedwarsAxeTier,
  bedwarsBedTeamAt, bedwarsBlockAt, bedwarsDiamondPeriod, bedwarsGenCells,
  bedwarsShopCells, bedwarsShopEntry, bedwarsSolidAt, bedwarsSwing, bedwarsTeamWool,
  clampToBedwarsArena, collapsedBedwarsArena, hasBedwarsLineOfSight,
} from '../bedwars';
import { isMinigameOnly, stripMinigameItems } from '../minigame_items';
import {
  DuelFlair, DuelProgressState, DuelPublicProfile, canEquipDuelFlair,
  duelProfileOf, newDuelProgress, sanitizeDuelProgress, settleDuelProgress,
} from '../duels_progression';

// Cosmetic gunshot rebroadcast budget (see handleShot). Sized well above the
// fastest gun's cadence so it never eats a real shot; it exists to cap a
// hacked client's tracer spam, not to police fire rate (hits are validated
// separately by handleRanged).
const SHOT_RATE = 25;            // sustained rebroadcast shots per second
const SHOT_BURST = 12;           // shots that may be fired back to back
const SEASON_BROADCAST = 2;      // seconds between season-clock broadcasts
const WAR_BROADCAST = 2;         // seconds between war-clock broadcasts
/** Seconds before the closing border may relocate the same player again. */
const BORDER_RELOCATE_COOLDOWN = 6;
// Rocket splash (mirrors the client-side mobs.explode blast so PvP/craters sync).
const ROCKET_BLAST_DAMAGE = 22; // base AoE damage at the burst centre
const ROCKET_BLAST_RADIUS = 6;  // player-damage falloff radius (blocks)
const ROCKET_CRATER_RADIUS = 3; // block-destruction radius (= client EXPLOSION_RADIUS)

/** All arguments are finite numbers (rejects NaN/Infinity/non-numbers). */
function fin(...ns: number[]): boolean {
  return ns.every((n) => Number.isFinite(n));
}

function cloneRecord(data: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!data) return undefined;
  try { return structuredClone(data); } catch { return { ...data }; }
}

const REGEN_INTERVAL = 2;       // +1 HP every 2s out of combat
const REGEN_DELAY = 5;          // seconds after damage before regen resumes

/** Blocks a player must never materialize in or directly on during respawn. */
const UNSAFE_RESPAWN_BLOCKS = new Set<number>([
  Block.Water, Block.Cactus, Block.Lava, Block.SpikeTrap, Block.Landmine,
  Block.BearTrap, Block.Tar, Block.BarbedWire,
]);

interface ServerPlayer extends PlayerInfo {
  /** World-clock seconds of this player's last successful treasury raid, so one
   *  raider cannot empty a strongbox by spamming the key. */
  lastTreasuryRaid?: number;
  regenCooldown: number;
  regenTimer: number;
  /** Healing consumable (Bandage/Medkit): seconds of accelerated regen left +
   *  the boosted +1-HP interval while it's active (0 = no buff). */
  regenBoostTimer: number;
  regenBoostInterval: number;
  /** Lifesteal: the last DIRECT player attacker (gun/explosive) + when — a
   *  death within KILL_CREDIT_WINDOW of the hit credits them the heart. */
  lastHitBy: number;
  lastHitTime: number;
  /** Set the instant hearts hit 0; blocks respawn until the shell disconnects. */
  eliminated: boolean;
  /** worldTime of this player's last accepted flag swing (rate limit). */
  lastFlagHit: number;
  /** worldTime of the last damage taken from ANY source (combat tag: no
   *  totem teleports for COMBAT_TAG seconds after). */
  lastDamageTime: number;
  /** Attuned Waypoint Totem positions (max MAX_ATTUNED; persisted per account). */
  totems: { x: number; y: number; z: number }[];
  /** worldTime before which totem teleports are refused (60s cooldown). */
  totemCooldownUntil: number;
  /** Worn-armor defense points the client reports (clamped 0..cap). */
  armorPoints: number;
  /** Flat post-percentage damage soak from Greater Runes of Iron
   *  (client-reported, clamped 0..TOUGHNESS_CAP). */
  toughness: number;
  /** Cosmetic equip state for other clients' avatars: the held item id (0 =
   *  bare hand) and worn armor item ids [helmet, chest, legs, boots]. */
  held: number;
  armor: number[];
  /** Current crouch state, forwarded to other clients for the avatar pose. */
  sneaking: boolean;
  /** Latest client swing sequence, forwarded for third-person attack animation. */
  swing: number;
  aiming: boolean;
  reloading: boolean;
  /** Bloodlust (anti-stalemate): when the last PvP hit landed on this player,
   *  and when the current continuous fight began. A fight lapses once no PvP
   *  hit lands for COMBAT_TAG seconds. */
  lastPvpTime: number;
  pvpSince: number;
  /** The "damage is ramping" notice was already sent for this fight. */
  bloodlustWarned: boolean;
  /** Secret-switch bookkeeping (Phase 7): defections used this season + which
   *  season they were counted in, and the season a defection forfeited a badge. */
  switchesUsed: number;
  switchSeason: number;
  forfeitSeason: number;
  /** Per-gadget cooldown tracker (Phase 8; server-authoritative anti-spam). */
  gadgetCd: GadgetCooldowns;
  /** Token bucket limiting how many COSMETIC gunshot rebroadcasts this player
   *  may generate, so a hacked client can't flood everyone with fake tracers.
   *  Purely about noise — dropping one only costs a visual. */
  shotTokens: number;
  shotRefillAt: number;
  /** worldTime before which the shrinking war border may not relocate this
   *  player again (stops a tick-rate teleport loop at the ring's edge). */
  borderRelocateAt: number;
  /** Personal respawn point set via a Respawn Beacon (right-click). undefined =
   *  use the default faction spawn. Persisted with the account. */
  spawnX?: number; spawnY?: number; spawnZ?: number;
  /** Last client-pushed persistable blob (inventory/hotbar) for saveState. */
  savedClientData?: Record<string, unknown>;
  /** Newest pending TPA request AT this player (someone wants to port to
   *  them); expires TPA_EXPIRE seconds after `at` (worldTime). */
  tpaFrom?: { id: number; username: string; at: number };
  /** Prevents transport cleanup from settling the same combat logout twice. */
  disconnectSettled: boolean;
  /** Exact open-world state held aside while a temporary MINIGAME body exists.
   *
   *  There is deliberately ONE slot rather than one per mode. Every predicate
   *  that keeps an arena player out of the open world — `snapshotFor`,
   *  `receivesWorldBroadcast`, the welcome roster — reads this single field, so
   *  a new mode cannot leak a player into the world by forgetting a disjunct.
   *  It also makes "in two minigames at once" unrepresentable, because
   *  `preserveOpenWorldState` refuses to overwrite an occupied slot. */
  arenaSaved?: ArenaSavedState;
  /** Which mode owns the temporary body. Set with `arenaSaved`, cleared with it. */
  arenaKind?: ArenaKind;
  duelSpawnIndex: number;
  duelLastShotAt: number;
  duelNextBurstAt: number;
  duelBurstShots: number;
  duelShotTickets: DuelShotTicket[];
  /** Recent authoritative positions, oldest first, for lag compensation. */
  arenaTrack: ArenaTrackSample[];
  duelLoaded: number;
  duelReloadUntil: number;
  duelMedkits: number;
  duelRespawning: boolean;
  // --- Bedwars ---
  /** The purchased axe tier. The melee math reads THIS, never `p.held`, so no
   *  client-supplied number ever enters the damage calculation. */
  bwAxe: number;
  bwLastSwingAt: number;
  /** Consecutive landed hits on `bwComboTarget` inside the combo window. */
  bwCombo: number;
  bwComboTarget: number;
  bwComboUntil: number;
  bwRespawning: boolean;
  /** Milliseconds of generator credit carried between ticks, so a slow tick
   *  cannot silently drop production. */
  bwIronAccum: number;
  bwGoldAccum: number;
}

interface DuelShotTicket {
  at: number;
  x: number; y: number; z: number;
  dx: number; dy: number; dz: number;
}

/** One timestamped feet position, kept so a hit can be judged against where a
 *  target USED to be. See `arenaTrack` / `handleDuelRanged`. */
interface ArenaTrackSample { at: number; x: number; y: number; z: number; }

/** How far back the duel position history reaches, in seconds. Covers the
 *  worst honest case a hit report has to survive: a Burst Rifle round crossing
 *  its full 58-block range (0.5s at speed 115), the 0.1s the shooter's client
 *  renders every opponent behind live, and a slow round trip on top. */
const DUEL_TRACK_WINDOW = 1.2;

interface ArenaSavedState {
  x: number; y: number; z: number; yaw: number; pitch: number;
  health: number; dead: boolean; mode: GameMode;
  held: number; armor: number[]; armorPoints: number; toughness: number;
  savedClientData?: Record<string, unknown>;
}

const GAME_MODES: GameMode[] = ['survival', 'creative', 'spectator'];

/** Client messages a spectator may NOT send (world edits + combat + economy). */
const SPECTATOR_BLOCKED = new Set<ClientMsg['t']>([
  'edit', 'lever', 'rangedAttack', 'shot', 'selfhurt', 'drop', 'pickup', 'chestSet',
  'machineConfig', 'machineUpgrade', 'machineCollect', 'machineHit', 'machineClaim',
  'machineMove', 'setSpawn',
  'turretUpgrade', 'turretClaim', 'turretHit', 'turretLoad',
  'gadgetUse', 'rocketBlast', 'xp',
  // Warfare Command: a spectator may never build, fire, fly or sabotage.
  'warfareBuy',
  'heliSpawn', 'heliDeploy', 'heliMount', 'heliInput', 'heliBomb', 'heliService',
  'heliUpgrade', 'heliModule', 'heliRope', 'heliHit',
  'heartConsume', 'heartWithdraw', 'beaconRevive', 'useHeal',
  'attune', 'totemTeleport',
  'vaultAttack', 'vaultChestOpen',
  // Government: a spectator may watch an election, never take part in one or
  // touch a treasury. Reading (the politics sync) is unaffected.
  'pledgeFaction', 'foundParty', 'disbandParty', 'castVote',
  'govBroadcast', 'govTax', 'govSetKit', 'govFundKits', 'claimKit', 'treasuryRaid',
  'treasuryOpen', 'treasurySet',
]);

/** One message the transport should deliver. `to` is a client id, or a
 *  fan-out target. */
export interface Outbound {
  to: number | 'all' | 'others';
  from?: number; // for 'others', the id to exclude
  msg: ServerMsg;
}

interface ArenaPlacement {
  owner: number;
  block: number;
  restoreBlock: number;
  previousEdit: number | undefined;
}

interface ActiveVaultEncounter {
  stamp: VaultStamp;
  engine: VaultEncounter;
  snapshotAccum: number;
  credited: string;
  /** WARFARE CONTRIBUTION: runtime id -> account name, captured while the
   *  player is present so a leaver/disconnect is still settled correctly. */
  names: Map<number, string>;
  /** Ids that were ever in creative/spectator during the attempt — those never
   *  earn warfare XP, however much "damage" the engine accepted from them. */
  observers: Set<number>;
  /** Authored arena cells let temporary placements restore the exact room. */
  authoredBlocks: Map<string, number>;
  placedBlocks: Map<string, ArenaPlacement>;
}

export class GameServer {
  readonly seed: number;
  private readonly terrain: Terrain;
  private readonly rng: () => number;
  private readonly players = new Map<number, ServerPlayer>();
  private readonly edits = new Map<string, number>();
  private readonly chests = new Map<string, (ItemStack | null)[]>();
  private readonly machines = new Map<string, MachineState>();
  // Warfare layer (M14).
  private readonly turrets = new Map<string, TurretState>();
  // Capture the flag: one flag per faction, disarmed until an admin arms them.
  private flags: FlagsState = newFlags();
  // War windows: the shrinking-border battle (admin-scheduled).
  private war: WarState = newWar();
  private warAccum = 0;
  private warWasActive = false;
  /** Kills per faction id in the CURRENT war (most kills wins the war). */
  private warKills: number[] = new Array(FACTIONS.length).fill(0);
  /** War wins per faction id THIS SEASON (most wins takes the season). */
  private warWins: number[] = new Array(FACTIONS.length).fill(0);
  // Warfare Command (replaces the retired Progress system): per-account
  // technology, plus the server-owned vehicle simulation.
  private readonly warfare = new Map<string, WarfareProgress>();
  /** Set by the shell to persist a player's warfare progression to the account
   *  store (the pure core has no disk). */
  onWarfareChange?: (username: string, progress: WarfareProgress) => void;
  /** Atomically persist every account touched by one completed rated match. */
  onDuelSettlement?: (changes: { username: string; state: DuelProgressState }[]) => {
    leaderboard: DuelLeaderboardEntry[];
    profiles: Record<string, DuelPublicProfile>;
  };
  /** Persist a validated cosmetic-only flair selection. */
  onDuelFlair?: (username: string, flair: DuelFlair) => {
    profile: DuelPublicProfile; leaderboard: DuelLeaderboardEntry[];
  } | null;
  private vehicles!: VehicleSim;
  /** Players known by the transport to be on a rope (for one-shot detach state). */
  private readonly ropePlayers = new Set<number>();
  // Seasons (Phase 5): endless war cycles — nothing ends a season on a clock any
  // more, so this counter moves only when `endSeason` is called deliberately.
  private season = newSeason();
  private seasonAccum = 0;
  /** Set by the shell to persist "Seasons Won" badges to all winning accounts
   *  (the pure server can't reach the on-disk account store itself). */
  onSeasonEnd?: (winnerFaction: number, seasonNumber: number) => void;
  /** Set by the shell to persist a secret faction switch to the account (new
   *  faction + switch counters + the forfeited season). */
  onFactionSwitch?: (username: string, faction: number, switchesUsed: number, switchSeason: number, forfeitSeason: number) => void;
  /** Lifesteal (A2): a player hit 0 hearts. The shell records the wall-clock
   *  elimination on the account and disconnects the socket shortly after (the
   *  pure core has no wall clock). Returns the `eliminatedUntil` ms for the
   *  victim's banner (0/undefined = elimination unsupported, e.g. tests). */
  onEliminate?: (username: string, by: string, permanent: boolean) => number;
  /** Revival Beacon (A3): eliminated faction-mates of `faction` (from the
   *  account store — the pure core doesn't know offline accounts). */
  listEliminated?: (faction: number) => { username: string; remainingMs: number }[];
  /** Revival Beacon (A3): clear `target`'s elimination if they're an eliminated
   *  member of `faction`; returns success. `by` is credited in the target's
   *  next-login notice. */
  onRevive?: (target: string, faction: number, by: string) => boolean;
  // --- FACTION GOVERNMENT ----------------------------------------------------
  /** Elections + governments for every faction (politics.ts). Persisted. */
  private politics: PoliticsState = newPolitics(0);
  /** One strongbox per faction, standing beside its flag pad (treasury.ts). */
  private treasuries = newTreasuries();
  /** Seconds since the election clock was last checked (it only needs to tick
   *  about once a second — a weekly deadline does not need 20Hz). */
  private politicsAccum = 0;
  /** A treasury changed and the clients have not been told yet. Coalesced so a
   *  faction mining flat out costs one sync a second, not one per block. */
  private politicsDirty = false;
  /** Set by the shell to write a pledge onto the ACCOUNT. Returns false when
   *  the store refuses it — which is what makes the choice permanent across a
   *  reconnect, not just for the length of one session. */
  onPledge?: (username: string, faction: number) => boolean;
  /** Set by the shell: the whole registered playerbase per faction, not just
   *  who is online. The allegiance screen shows both. */
  factionRoster?: (faction: number, limit: number) => string[];
  factionCitizens?: (faction: number) => number;
  /** Set by the shell: has this account taken its one recruit kit / take it. */
  kitClaimed?: (username: string) => boolean;
  onClaimKit?: (username: string) => boolean;
  // Vaults (Milestone D): per-vault boss HP + per-player loot ledger, keyed
  // by the anchor chunk "cx,cz". Persisted in the world save.
  private readonly vaults = new Map<string, VaultServerState>();
  /** Active fights are intentionally ephemeral and never serialized. */
  private readonly vaultEncounters = new Map<string, ActiveVaultEncounter>();
  private encounterSerial = 0;
  /** Deterministic vault stamps are pricey to rebuild — cache by anchor chunk. */
  private readonly vaultStamps = new Map<string, VaultStamp | null>();
  private worldTime = 0;        // seconds since boot
  private readonly items = new Map<number, ItemEntityInfo>();
  /** Per-item fall state (server-owned gravity so drops settle to the ground). */
  private readonly itemPhys = new Map<number, { vy: number; resting: boolean }>();
  private nextEid = 1;
  /** Competitive minigame state is intentionally ephemeral: never serialized. */
  private readonly duels: Duels;
  /** FIFO 1v1 matchmaking. IDs only; identities are read fresh when paired. */
  private duelQueue: number[] = [];
  /** Retained through disconnects so forfeits cannot evade progression. */
  private readonly duelProgress = new Map<number, DuelProgressState>();
  /** Placed blocks per active arena, keyed `${kind}:${slot}`, reset on match end. */
  private readonly arenaEdits = new Map<string, Map<string, number>>();
  readonly bedwars = new Bedwars(secureDuelToken);
  private bwQueue: number[] = [];
  /** Next diamond payout per live Bedwars lobby id. */
  private readonly bwDiamondNextAt = new Map<string, number>();
  private readonly settledDuelResults = new Set<string>();
  /** Next whole-server timestamp broadcast for hidden-tab/lag clock recovery. */
  private duelClockNextAt = 0;

  constructor(seed = WORLD_SEED, rng: () => number = Math.random,
    private readonly wallNow: () => number = Date.now) {
    this.seed = seed;
    this.rng = rng;
    this.duels = new Duels(secureDuelToken);
    this.terrain = new Terrain(seed);
    // Elections run on the WALL clock, not the world clock: a term is a week of
    // real time whether or not the server was up for all of it.
    this.politics = newPolitics(this.wallNow());
    this.vehicles = new VehicleSim({
      solid: (x, y, z) => this.solidAt(x, y, z),
      groundY: (x, z) => this.surfaceY(x, z),
      worldHalf: WORLD_HALF,
      vaultArena: (x, y, z) => this.insideAnyVaultArena(x, y, z),
    });
  }

  // --- Warfare Command: shared world queries ---------------------------------

  /** Height of the highest solid cell in a column, edits included. Used as the
   *  ground reference for bomb impacts, helicopter floors and ceilings. */
  private surfaceY(x: number, z: number): number {
    if (!fin(x, z)) return 0;
    const bx = Math.floor(x), bz = Math.floor(z);
    const base = this.terrain.height(bx, bz);
    // A player-built tower counts: scan a modest window of edits above terrain.
    let top = base;
    for (let y = base + 1; y <= base + 48 && y < 256; y++) {
      const e = this.edits.get(`${bx},${y},${bz}`);
      if (e !== undefined && e !== Block.Air && BLOCKS[e]?.solid) top = y;
    }
    return top;
  }

  private solidAt(x: number, y: number, z: number): boolean {
    if (!fin(x, y, z)) return true;
    const bx = Math.floor(x), by = Math.floor(y), bz = Math.floor(z);
    if (by < 0 || by >= 256) return true;
    const duelBlock = duelArenaBlockAt(bx, by, bz);
    if (duelBlock !== null) return duelBlock !== Block.Air && !!BLOCKS[duelBlock]?.solid;
    const e = this.edits.get(`${bx},${by},${bz}`);
    if (e !== undefined) return e !== Block.Air && !!BLOCKS[e]?.solid;
    return by <= this.terrain.height(bx, bz);
  }

  private insideAnyVaultArena(x: number, y: number, z: number): boolean {
    if (!fin(x, y, z)) return false;
    const st = vaultAt(this.seed, x, y, z, this.terrain, (cx, cz) => this.vaultStampAt(cx, cz));
    if (!st) return false;
    const b = st.arena.bounds;
    return x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ &&
      y >= b.minY && y <= b.maxY;
  }


  /** A player's warfare progression (created on demand, keyed by account). */
  warfareOf(username: string): WarfareProgress {
    const key = (username ?? '').toLowerCase();
    let w = this.warfare.get(key);
    if (!w) { w = newWarfare(); this.warfare.set(key, w); }
    return w;
  }

  /** Seed a player's progression from the account store (shell-supplied). */
  setWarfare(username: string, raw: unknown): void {
    this.warfare.set((username ?? '').toLowerCase(), sanitizeWarfare(raw));
  }

  private warfareMsg(p: ServerPlayer): Outbound {
    const w = this.warfareOf(p.username);
    return { to: p.id, msg: { t: 'warfare', xp: w.xp, nodes: w.nodes.slice() } };
  }

  private saveWarfare(p: ServerPlayer): void {
    this.onWarfareChange?.(p.username, this.warfareOf(p.username));
  }

  /** Does this player hold the blueprint needed to build/retrofit `block`? */
  private hasBlueprint(p: ServerPlayer, id: number): boolean {
    const node = WARFARE_BLUEPRINTS[id];
    if (!node) return true;
    return warfareOwns(this.warfareOf(p.username), node);
  }

  get playerCount(): number {
    return this.players.size;
  }

  /** Auto-balance a joining player into the lowest-population faction. */
  private assignFaction(): number {
    const counts: Record<number, number> = {};
    for (const f of FACTIONS) counts[f.id] = 0;
    for (const p of this.players.values()) {
      if (counts[p.faction] !== undefined) counts[p.faction]++;
    }
    return balancedFaction(counts);
  }

  /** Is an account already connected under this username? */
  usernameOnline(username: string): boolean {
    for (const p of this.players.values()) if (p.username === username) return true;
    return false;
  }

  private uniqueUsername(): string {
    const taken = new Set([...this.players.values()].map((p) => p.username));
    for (let i = 0; i < 100; i++) {
      const name = makeUsername(this.rng);
      if (!taken.has(name)) return name;
    }
    return makeUsername(this.rng) + Math.floor(this.rng() * 1000);
  }

  private inFactionHalf(faction: number, x: number, z: number): boolean {
    if (!isFaction(faction) || Math.abs(x) > CORE_HALF || Math.abs(z) > CORE_HALF) return false;
    const band = (CORE_HALF * 2) / FACTIONS.length;
    const index = FACTIONS.findIndex((f) => f.id === faction);
    const minX = -CORE_HALF + band * index;
    return x >= minX && x <= minX + band;
  }

  private spawn(faction: number): { x: number; y: number; z: number } {
    // Not sworn to anyone yet: stand in the neutral middle of the Heartland,
    // between the two pads, rather than inside somebody's base. `inFactionHalf`
    // rejects NO_FACTION for everything, so without this branch the search below
    // finds nothing and drops the player out of the sky over Crimson's flag.
    if (!isFaction(faction)) return this.neutralSpawn();
    const home = flagHome(faction);
    // Respawns cluster around their own flag and never cross the faction-half
    // boundary. Retry because edits may have trapped an otherwise-safe column.
    for (let i = 0; i < 64; i++) {
      const angle = this.rng() * Math.PI * 2;
      const radius = 8 + Math.sqrt(this.rng()) * 48;
      const x = Math.floor(home.x + Math.cos(angle) * radius);
      const z = Math.floor(home.z + Math.sin(angle) * radius);
      if (!this.inFactionHalf(faction, x, z)) continue;
      const s = this.terrain.safeSpawnAt(x, z);
      if (s && this.safeRespawnPoint(s.x, s.y, s.z)) return s;
    }
    // Search outward from the flag deterministically before giving up.
    for (let r = 0; r <= 128; r++) {
      for (let dx = -r; dx <= r; dx++) {
        for (const dz of r === 0 ? [0] : [-r, r]) {
          const x = home.x + dx, z = home.z + dz;
          if (!this.inFactionHalf(faction, x, z)) continue;
          const s = this.terrain.safeSpawnAt(x, z);
          if (s && this.safeRespawnPoint(s.x, s.y, s.z)) return s;
        }
      }
      for (let dz = -r + 1; dz < r; dz++) {
        for (const dx of [-r, r]) {
          const x = home.x + dx, z = home.z + dz;
          if (!this.inFactionHalf(faction, x, z)) continue;
          const s = this.terrain.safeSpawnAt(x, z);
          if (s && this.safeRespawnPoint(s.x, s.y, s.z)) return s;
        }
      }
    }
    // This is only reachable if every checked column has been deliberately
    // trapped. Spawning above them remains collision- and hazard-free.
    return { x: home.x + 0.5, y: 257, z: home.z + 0.5 };
  }

  /** A safe, faction-neutral landing spot near world centre, for a player who
   *  has not sworn allegiance yet. Spirals outward from the origin so a built-up
   *  or trapped centre still resolves. */
  private neutralSpawn(): { x: number; y: number; z: number } {
    for (let r = 0; r <= 96; r++) {
      for (let dx = -r; dx <= r; dx++) {
        for (const dz of r === 0 ? [0] : [-r, r]) {
          const s = this.terrain.safeSpawnAt(dx, dz);
          if (s && this.safeRespawnPoint(s.x, s.y, s.z)) return s;
        }
      }
      for (let dz = -r + 1; dz < r; dz++) {
        for (const dx of [-r, r]) {
          const s = this.terrain.safeSpawnAt(dx, dz);
          if (s && this.safeRespawnPoint(s.x, s.y, s.z)) return s;
        }
      }
    }
    return { x: 0.5, y: 257, z: 0.5 };
  }

  private blockEditAt(x: number, y: number, z: number): number | undefined {
    return this.edits.get(`${Math.floor(x)},${Math.floor(y)},${Math.floor(z)}`);
  }

  /** Requires solid safe support plus clear, non-hazardous feet and head cells. */
  private safeRespawnPoint(x: number, y: number, z: number): boolean {
    const bx = Math.floor(x), by = Math.floor(y), bz = Math.floor(z);
    const natural = this.terrain.blocksAtColumn(bx, bz, [by - 1, by, by + 1]);
    const blocks = natural.map((block, i) =>
      this.blockEditAt(bx, by - 1 + i, bz) ?? block);
    const support = blocks[0];
    if (!(BLOCKS[support]?.solid ?? false) || UNSAFE_RESPAWN_BLOCKS.has(support)) return false;
    for (const block of blocks.slice(1)) {
      if ((BLOCKS[block]?.solid ?? false) || UNSAFE_RESPAWN_BLOCKS.has(block)) return false;
    }
    return true;
  }

  /** Fail-closed sanitizer for a saved attuned-totem list (account data). */
  private static sanitizeTotems(raw: unknown): { x: number; y: number; z: number }[] {
    if (!Array.isArray(raw)) return [];
    const out: { x: number; y: number; z: number }[] = [];
    for (const t of raw) {
      const o = t as { x?: unknown; y?: unknown; z?: unknown };
      if (out.length >= MAX_ATTUNED) break;
      if (fin(o?.x as number, o?.y as number, o?.z as number)) {
        out.push({ x: Math.floor(o.x as number), y: Math.floor(o.y as number), z: Math.floor(o.z as number) });
      }
    }
    return out;
  }

  /** Register a player; returns the welcome (to them) + join (to others). With
   *  mandatory accounts the shell passes the authenticated account's username +
   *  faction; without them (legacy/tests) it auto-assigns both. */
  addPlayer(id: number, account?: {
    username?: string; faction?: number; seasonsWon?: number;
    duelProgress?: DuelProgressState;
    duelLeaderboard?: DuelLeaderboardEntry[];
    switchesUsed?: number; switchSeason?: number; forfeitSeason?: number;
    data?: Record<string, unknown>;
    /** Warfare Command progression, straight off the account record. */
    warfare?: unknown;
  }): Outbound[] {
    const username = account?.username && !this.usernameOnline(account.username)
      ? account.username : this.uniqueUsername();
    // An account that carries a faction field is AUTHORITATIVE, including when
    // it says NO_FACTION: a player who has not sworn allegiance yet stays
    // factionless until they pledge, and nothing auto-assigns them a side any
    // more. Only a caller with no account at all (legacy transports, tests)
    // still gets one picked for them.
    const faction = account?.faction !== undefined && Number.isFinite(account.faction)
      ? (isFaction(account.faction) ? account.faction : NO_FACTION)
      : this.assignFaction();
    // Restore the saved horizontal column, but always join on its surface. This
    // prevents accounts saved in caves (or mid-air) from spawning there again.
    const saved = account?.data;
    const sx = saved?.x, sy = saved?.y, sz = saved?.z, syaw = saved?.yaw;
    const hasPos = fin(sx as number, sy as number, sz as number) && (sy as number) > 0;
    const savedSurface = hasPos
      ? this.terrain.safeSpawnAt(sx as number, sz as number)
      : undefined;
    const s = savedSurface && this.safeRespawnPoint(savedSurface.x, savedSurface.y, savedSurface.z)
      ? { x: sx as number, y: savedSurface.y, z: sz as number }
      : this.spawn(faction);
    const savedMode = typeof saved?.mode === 'string' && GAME_MODES.includes(saved.mode as GameMode)
      ? saved.mode as GameMode : 'survival';
    // Lifesteal: hearts persist in the account data blob; fresh accounts (or
    // junk values) start at START_HEARTS via clampHearts' fail-safe.
    const hearts = clampHearts(saved?.hearts);
    const progress = sanitizeDuelProgress(account?.duelProgress ?? newDuelProgress(), this.wallNow());
    const player: ServerPlayer = {
      id, username, skin: skinSeed(username), faction, mode: savedMode,
      seasonsWon: Number.isFinite(account?.seasonsWon) ? Math.max(0, Math.floor(account!.seasonsWon!)) : 0,
      duelProfile: duelProfileOf(progress),
      hearts,
      x: s.x, y: s.y, z: s.z, yaw: fin(syaw as number) ? syaw as number : 0, pitch: 0,
      health: maxHealthFor(hearts), dead: false, regenCooldown: 0, regenTimer: 0,
      regenBoostTimer: 0, regenBoostInterval: 0,
      lastHitBy: -1, lastHitTime: -Infinity, eliminated: false, lastFlagHit: -Infinity,
      lastDamageTime: -Infinity,
      totems: GameServer.sanitizeTotems(saved?.totems),
      totemCooldownUntil: 0,
      armorPoints: 0,
      toughness: 0,
      held: 0, armor: [0, 0, 0, 0], sneaking: false, swing: 0,
      aiming: false, reloading: false,
      lastPvpTime: -Infinity, pvpSince: 0, bloodlustWarned: false,
      switchesUsed: Number.isFinite(account?.switchesUsed) ? Math.max(0, Math.floor(account!.switchesUsed!)) : 0,
      switchSeason: Number.isFinite(account?.switchSeason) ? Math.floor(account!.switchSeason!) : 0,
      forfeitSeason: Number.isFinite(account?.forfeitSeason) ? Math.floor(account!.forfeitSeason!) : 0,
      gadgetCd: new GadgetCooldowns(),
      shotTokens: SHOT_BURST, shotRefillAt: 0,
      borderRelocateAt: 0,
      disconnectSettled: false,
      duelSpawnIndex: -1,
      duelLastShotAt: -Infinity,
      duelNextBurstAt: 0,
      duelBurstShots: 0,
      duelShotTickets: [],
      arenaTrack: [],
      bwAxe: 0, bwLastSwingAt: -Infinity, bwCombo: 0, bwComboTarget: 0, bwComboUntil: 0,
      bwRespawning: false, bwIronAccum: 0, bwGoldAccum: 0,
      duelLoaded: 0,
      duelReloadUntil: 0,
      duelMedkits: 0,
      duelRespawning: false,
      // Until the first client autosave arrives, the authenticated account
      // snapshot is still the best authoritative copy of carried inventory.
      savedClientData: saved ? { ...saved } : undefined,
      cosmetics: saved?.cosmetics !== undefined
        ? sanitizeCosmetics(saved.cosmetics, skinSeed(username)) : undefined,
    };
    // Restore a saved personal respawn point if the account carries one.
    if (fin(saved?.spawnX as number, saved?.spawnY as number, saved?.spawnZ as number)) {
      player.spawnX = saved!.spawnX as number;
      player.spawnY = saved!.spawnY as number;
      player.spawnZ = saved!.spawnZ as number;
    }
    this.players.set(id, player);
    this.duelProgress.set(id, progress);
    // Warfare Command progression comes off the ACCOUNT, not the client blob.
    if (account && 'warfare' in account) this.setWarfare(username, account.warfare);
    const warfare = this.warfareOf(username);
    const welcome: ServerMsg = {
      t: 'welcome', id, seed: this.seed, username, worldTime: this.worldTime,
      // A normal-world login must never learn about players inside an active
      // Duels scope. Lobby-only players remain ordinary title/world roster.
      players: [...this.players.values()].filter((v) => !v.arenaSaved).map(toInfo),
      edits: [...this.edits.entries()],
      items: [...this.items.values()],
      turrets: [...this.turrets.entries()].map(([k, state]) => {
        const [x, y, z] = k.split(',').map(Number);
        return { x, y, z, state };
      }),
      season: { number: this.season.number, timeLeft: seasonWireTimeLeft(this.season) },
      war: { ...warSnapshot(this.war, this.worldTime),
        score: this.warKills.slice(), wins: this.warWins.slice() },
      flags: this.flagsPayload(),
      state: saved, // opaque per-account blob (inventory/hotbar) for the client to restore
      warfare: { xp: warfare.xp, nodes: warfare.nodes.slice() },
      duelProfile: player.duelProfile,
      duelLeaderboard: account?.duelLeaderboard ?? [],
      helis: this.vehicles.snapshot(),
      politics: this.politics,
      factions: this.factionPublics(),
      treasury: isFaction(faction) ? this.treasuryOf(faction).slots : undefined,
      inbox: this.inboxFor(faction),
      kitClaimed: this.kitClaimed?.(username) ?? false,
    };
    return [
      { to: id, msg: welcome },
      { to: id, msg: { t: 'attuned', totems: player.totems.slice() } },
      { to: 'others', from: id, msg: { t: 'join', player: toInfo(player) } },
    ];
  }

  removePlayer(id: number): Outbound[] {
    const p = this.players.get(id);
    if (!p) return [];
    const out = this.settleDisconnect(id);
    this.removeFromDuelQueue(id);
    const duelLeave = this.duels.leave(id, this.worldTime * 1000);
    if (duelLeave.snapshot) {
      out.push(...this.duelSnapshotOutbound(duelLeave.snapshot));
      if (duelLeave.snapshot.phase === 'lobby') out.push(...this.restoreDuelLobby(duelLeave.snapshot));
      if (duelLeave.snapshot.phase === 'results' && duelLeave.snapshot.result) {
        for (const member of duelLeave.snapshot.participants) out.push({
          to: member.id, msg: { t: 'duelResult', result: duelLeave.snapshot.result },
        });
      }
    }
    this.removeFromBwQueue(id);
    const bwLeave = this.bedwars.leave(id, this.worldTime * 1000);
    if (bwLeave.snapshot) {
      out.push(...this.bwSnapshotOutbound(bwLeave.snapshot));
      if (bwLeave.snapshot.phase === 'lobby') out.push(...this.restoreBedwarsLobby(bwLeave.snapshot));
      out.push(...this.bwResultOutbound(bwLeave.snapshot));
    } else if (bwLeave.deleted && this.bwDiamondNextAt.size) {
      // The room went away with the last member; drop its generator clock.
      this.bwDiamondNextAt.clear();
    }
    out.push(...this.cleanupPlayerArenaPlacements(id));
    // A disconnect must FREE the seat, or the airframe stays permanently
    // "piloted" and hangs in the sky forever. Once the seat is empty the vehicle
    // sim's own rule takes over: a controlled hover that settles to the ground.
    if (this.vehicles.disconnectPlayer(id)) {
      out.push(...this.heliBroadcast());
    }
    this.ropePlayers.delete(id);
    // Logging out never banks a flag run: it goes straight back to its pad.
    const dropped = returnFlag(this.flags, id);
    this.players.delete(id);
    if (!duelLeave.snapshot || (duelLeave.snapshot.phase !== 'running' &&
        duelLeave.snapshot.phase !== 'sudden_death')) this.duelProgress.delete(id);
    out.push({ to: 'others', from: id, msg: { t: 'leave', id } });
    if (dropped) out.push(...this.flagBroadcast('returned', dropped.flag, p.username));
    return out;
  }

  /**
   * Resolve a transport loss before the account snapshot is persisted. A live
   * player who leaves during the PvP window dies exactly as if their last
   * attacker landed the final hit: killfeed, flag return, heart transfer, war
   * score, and carried-item drops all happen server-side. This is deliberately
   * idempotent because the websocket shell calls it once before saving and
   * removePlayer calls it again as a safety net for tests/other transports.
   */
  settleDisconnect(id: number): Outbound[] {
    const victim = this.players.get(id);
    if (!victim || victim.disconnectSettled) return [];
    victim.disconnectSettled = true;
    // Arena disconnects are resolved only by the owning minigame (forfeit or
    // removal). They can
    // never become open-world combat-log deaths or lifesteal transactions.
    if (victim.arenaSaved) return [];
    if (victim.dead || victim.mode !== 'survival') return [];
    const killer = this.players.get(victim.lastHitBy);
    const tagged = this.worldTime - victim.lastHitTime <= COMBAT_TAG;
    if (!tagged || !killer || killer.id === victim.id ||
        sameFaction(killer.faction, victim.faction)) return [];

    victim.health = 0;
    victim.dead = true;
    const out: Outbound[] = [{
      to: 'all', msg: { t: 'killfeed', killer: killer.username, victim: victim.username },
    }];
    out.push(...this.dropCarriedFlag(victim));
    out.push(...this.spillSavedInventory(victim));
    out.push(...this.settleLifesteal(victim));
    if (isFaction(killer.faction) && killer.faction !== victim.faction && this.isWarActive()) {
      this.warKills[killer.faction]++;
      out.push({ to: 'all', msg: this.warSnapshotMsg() });
    }
    return out;
  }

  /** Spill the last authoritative account snapshot and replace it with empty
   *  carried/armor arrays so the following account save cannot duplicate loot. */
  private spillSavedInventory(p: ServerPlayer): Outbound[] {
    const data = p.savedClientData;
    if (!data || typeof data !== 'object') return [];
    const out: Outbound[] = [];
    let seen = 0;
    for (const key of ['slots', 'armor'] as const) {
      const raw = data[key];
      if (!Array.isArray(raw)) continue;
      for (const value of raw) {
        if (seen++ >= 64 || !value || typeof value !== 'object') continue;
        const stack = value as Partial<ItemStack>;
        if (!Number.isInteger(stack.id) || !ITEMS[stack.id as number] ||
            !Number.isFinite(stack.count) || (stack.count as number) <= 0) continue;
        out.push(...this.spawnItem(stack.id as number, Math.floor(stack.count as number),
          p.x + (this.rng() - 0.5), p.y + 0.35, p.z + (this.rng() - 0.5)));
      }
      data[key] = new Array(raw.length).fill(null);
    }
    return out;
  }

  /** Which mode's in-match whitelist owns this player's messages, or null for
   *  the open world. Lobby members are still open-world citizens — only a live
   *  match (countdown onward) captures the message stream. */
  private arenaRouteFor(id: number): ArenaKind | null {
    const duelPhase = this.duels.phaseFor(id);
    if (duelPhase && duelPhase !== 'lobby') return 'duel';
    const bwPhase = this.bedwars.phaseFor(id);
    if (bwPhase && bwPhase !== 'lobby') return 'bedwars';
    return null;
  }

  /** A Duels body is isolated from every open-world action/economy system.
   *  Movement, rifle combat, axe-only cover breaking, server-counted Medkits,
   *  bounce launches, and arena block placement exist. Nothing else does. */
  private routeDuelInMatch(p: ServerPlayer, msg: ClientMsg): Outbound[] {
    if (msg.t === 'xform') return this.handleDuelTransform(p, msg);
    if (msg.t === 'shot') return this.handleDuelShot(p, msg);
    if (msg.t === 'rangedAttack') return this.handleDuelRanged(p, msg.target, msg.amount);
    if (msg.t === 'useHeal') return this.handleDuelHeal(p, msg.item);
    if (msg.t === 'edit') return this.handleDuelEdit(p, msg.x, msg.y, msg.z, msg.block);
    return [];
  }

  /** Handle one client message; returns messages to deliver. */
  handle(id: number, msg: ClientMsg): Outbound[] {
    const p = this.players.get(id);
    if (!p) return [];
    if (msg.t === 'duelCreate' || msg.t === 'duelQueue' || msg.t === 'duelJoin' || msg.t === 'duelLeave' ||
        msg.t === 'duelReady' || msg.t === 'duelStart' || msg.t === 'duelArenaReady' || msg.t === 'duelRematch' ||
        msg.t === 'duelReturn' || msg.t === 'duelFlair') return this.handleDuel(p, msg);
    if (msg.t === 'bwCreate' || msg.t === 'bwQueue' || msg.t === 'bwJoin' || msg.t === 'bwLeave' ||
        msg.t === 'bwReady' || msg.t === 'bwStart' || msg.t === 'bwArenaReady') {
      return this.handleBedwarsLobby(p, msg);
    }
    // A player inside a live arena is routed to that mode's whitelist and
    // NOTHING else. Every `route*InMatch` ends in `return []`, so any message
    // the mode does not explicitly name is dropped rather than falling through
    // to the open-world switch. That whitelist-and-drop is the entire security
    // model per mode: it is what makes arena-only verbs (and the weapons that
    // use them) unreachable from the open world.
    switch (this.arenaRouteFor(id)) {
      case 'duel': return this.routeDuelInMatch(p, msg);
      case 'bedwars': return this.routeBedwarsInMatch(p, msg);
    }
    // Spectators are non-interacting ghosts: drop any world-mutating / combat
    // message. They may still move (xform), persist (saveState), and respawn.
    if (p.mode === 'spectator' && SPECTATOR_BLOCKED.has(msg.t)) return [];
    switch (msg.t) {
      case 'xform': {
        // Reject non-finite transforms so they can't poison distance/facing
        // math elsewhere (range/hit checks must never fail open).
        if (!p.dead && fin(msg.x, msg.y, msg.z, msg.yaw, msg.pitch)) {
          // A sealed vault arena OUTRANKS the war border. Otherwise a ring
          // closing over a distant vault would rip a raider out of a live boss
          // fight and drop them, at vault depth, into solid rock at the middle
          // of the map. Everyone else is clamped inside the border so no client
          // can roam past it, and during a war the ring drags them inward.
          const ropePos = this.vehicles.ropePosition(p.id);
          if (ropePos) {
            // Rope riders are server-positioned from the aircraft pose. Their
            // transform packets still carry look/equipment, never movement.
            p.x = ropePos.x; p.y = ropePos.y; p.z = ropePos.z;
          } else {
            const b = this.liveArenaFor(p.id);
            if (b) {
              p.x = Math.max(b.minX + 0.15, Math.min(b.maxX - 0.15, msg.x));
              p.z = Math.max(b.minZ + 0.15, Math.min(b.maxZ - 0.15, msg.z));
            } else {
              const clamped = clampInsideBorder(msg.x, msg.z, this.borderHalf());
              p.x = clamped.x;
              p.z = clamped.z;
            }
            p.y = msg.y;
          }
          p.yaw = msg.yaw; p.pitch = msg.pitch;
          p.gliding = msg.gliding === true;
          p.boating = msg.boating === true;
          // Trust the CLIENT's seated flag only when the sim agrees they really
          // are in a seat — the pose must never be forgeable into a free
          // hitbox change.
          p.seated = msg.seated === true && this.vehicles.seatOf(p.id) !== null;
          p.sneaking = msg.sneaking === true && !p.gliding && !p.boating && !p.seated;
          // Cosmetic equip state (fail-closed: junk ids render as bare).
          p.held = typeof msg.held === 'number' && ITEMS[msg.held] ? msg.held : 0;
          p.armor = Array.isArray(msg.armor)
            ? msg.armor.slice(0, 4).map((a) =>
                typeof a === 'number' && ITEMS[a]?.armor ? a : 0)
            : [0, 0, 0, 0];
          if (typeof msg.swing === 'number' && Number.isFinite(msg.swing)) {
            p.swing = Math.floor(msg.swing) & 0xffff;
          }
          p.aiming = msg.aiming === true && !!ITEMS[p.held]?.gun;
          p.reloading = msg.reloading === true && !!ITEMS[p.held]?.gun;
          // Walking a stolen flag onto your own pad scores the capture.
          return this.checkFlagCapture(p);
        }
        return [];
      }
      case 'flagHit': return this.handleFlagHit(p);
      case 'edit':
        return this.handleEdit(p, msg.x, msg.y, msg.z, msg.block);
      case 'lever': {
        // A lever pull: recompute the flips over the edit log (levers + traps
        // only ever exist as player edits) and broadcast them as normal edits.
        // The lever itself must be within reach; the LINKED traps may not be —
        // that's the point of a lever — so this is server-computed, not a
        // client edit batch.
        if (!this.nearMachine(p, msg.x, msg.y, msg.z)) return [];
        const bx = Math.floor(msg.x), by = Math.floor(msg.y), bz = Math.floor(msg.z);
        const flips = leverFlips(
          (x, y, z) => this.edits.get(`${x},${y},${z}`) ?? Block.Air, bx, by, bz);
        const out: Outbound[] = [];
        for (const f of flips) {
          this.edits.set(`${f.x},${f.y},${f.z}`, f.block);
          out.push({ to: 'all', msg: { t: 'edit', x: f.x, y: f.y, z: f.z, block: f.block } });
        }
        return out;
      }
      case 'tpa': {
        if (p.dead || typeof msg.target !== 'string') return [];
        if (this.duels.phaseFor(p.id) || p.arenaSaved) {
          return [{ to: id, msg: { t: 'notice', text: 'TPA is disabled during a minigame.' } }];
        }
        const name = msg.target.slice(0, 32).trim();
        const targetId = this.playerIdByName(name);
        const target = targetId !== undefined ? this.players.get(targetId) : undefined;
        if (!target || this.duels.phaseFor(target.id) || target.arenaSaved) {
          return [{ to: id, msg: { t: 'notice', text: `"${name}" is not online.` } }];
        }
        if (target.id === p.id) {
          return [{ to: id, msg: { t: 'notice', text: "You can't TPA to yourself!" } }];
        }
        target.tpaFrom = { id: p.id, username: p.username, at: this.worldTime };
        return [
          { to: target.id, msg: { t: 'tpaRequest', from: p.username } },
          { to: id, msg: { t: 'notice',
            text: `TPA sent to ${target.username} — if they accept, you teleport to them.` } },
        ];
      }
      case 'tpaAccept': {
        const req = p.tpaFrom;
        p.tpaFrom = undefined; // one shot, granted or not
        if (p.dead) return [];
        if (this.duels.phaseFor(p.id) || p.arenaSaved) {
          return [{ to: id, msg: { t: 'notice', text: 'TPA is disabled during a minigame.' } }];
        }
        if (!req || this.worldTime - req.at > TPA_EXPIRE) {
          return [{ to: id, msg: { t: 'notice', text: 'That TPA request has expired.' } }];
        }
        const requester = this.players.get(req.id);
        // The slot id could have been recycled by a reconnect — verify the name.
        if (!requester || requester.dead || requester.username !== req.username ||
            this.duels.phaseFor(requester.id) || requester.arenaSaved) {
          return [{ to: id, msg: { t: 'notice', text: `${req.username} is no longer available.` } }];
        }
        requester.x = p.x; requester.y = p.y; requester.z = p.z;
        return [
          { to: requester.id, msg: { t: 'teleport', x: p.x, y: p.y, z: p.z } },
          { to: requester.id, msg: { t: 'notice', text: `${p.username} accepted your TPA!` } },
          { to: id, msg: { t: 'notice', text: `${requester.username} teleported to you.` } },
        ];
      }
      case 'selfhurt':
        return this.applyDamage(p, Math.max(0, Math.min(40, msg.amount)), id);
      case 'respawn':
        return this.handleRespawn(p);
      case 'switchFaction':
        return this.handleSwitch(p, msg.faction);
      case 'gadgetUse':
        return this.handleGadget(p, msg.item, msg.x, msg.y, msg.z);
      case 'rocketBlast':
        return this.handleRocketBlast(p, msg.x, msg.y, msg.z);
      case 'xp':
        // RETIRED. Warfare XP comes only from qualifying dungeon-boss victories,
        // settled by the server from its own contribution ledger — never from a
        // client report. Kept as an accepted-and-ignored message so an older
        // client cannot desync by sending it.
        return [];
      case 'cosmetics': {
        // Sanitize + adopt the new look, persist it with the account and tell
        // every client to rebuild this player's avatar.
        p.cosmetics = sanitizeCosmetics(msg.c, p.skin);
        return [{ to: 'all', msg: { t: 'cosmetics', id: p.id, c: p.cosmetics } }];
      }
      case 'saveState':
        // Stash the client-owned blob (inventory/hotbar). Position is added from
        // the authoritative record at capture time. The shell persists to disk.
        if (msg.data && typeof msg.data === 'object') p.savedClientData = msg.data;
        return [];
      case 'drop':
        return this.handleDrop(p, msg.items, msg.x, msg.y, msg.z, msg.reason);
      // --- FACTION GOVERNMENT --------------------------------------------------
      case 'pledgeFaction':
        return this.handlePledge(p, msg.faction);
      case 'foundParty':
        return this.handleFoundParty(p, msg.name, msg.slogan, msg.promises);
      case 'disbandParty':
        return this.handleDisbandParty(p);
      case 'castVote':
        return this.handleVote(p, msg.partyId);
      case 'govBroadcast':
        return this.handleGovBroadcast(p, msg.text);
      case 'govTax':
        return this.handleGovTax(p, msg.rate);
      case 'govSetKit':
        return this.handleSetKit(p, msg.slots);
      case 'govFundKits':
        return this.handleFundKits(p, msg.count, msg.source);
      case 'treasuryOpen':
        return this.handleTreasuryOpen(p, msg.faction);
      case 'treasurySet':
        return this.handleTreasurySet(p, msg.faction, msg.page, msg.slots);
      case 'claimKit':
        return this.handleClaimKit(p);
      case 'treasuryRaid':
        return this.handleTreasuryRaid(p, msg.faction);
      case 'pickup':
        return this.handlePickup(p, msg.eid);
      case 'armor': {
        // Client-trusted armor value, but clamped so it can't exceed the cap.
        p.armorPoints = fin(msg.points) ? Math.max(0, Math.min(ARMOR_POINT_CAP, msg.points)) : 0;
        const tough = msg.toughness ?? 0;
        p.toughness = fin(tough) ? Math.max(0, Math.min(TOUGHNESS_CAP, tough)) : 0;
        return [];
      }
      case 'rangedAttack':
        return this.handleRanged(p, msg.target, msg.amount);
      case 'shot':
        return this.handleShot(p, msg);
      case 'chestOpen': {
        // A pristine STRUCTURE chest generates its seeded loot on first open
        // (identical for every client + the offline world; dup-safe — the roll
        // happens exactly once, then it's an ordinary stored chest).
        const slots = this.chests.get(`${msg.x},${msg.y},${msg.z}`)
          ?? this.ensureStructureChest(msg.x, msg.y, msg.z)
          ?? new Array(CHEST_SLOTS).fill(null);
        return [{ to: id, msg: { t: 'chest', x: msg.x, y: msg.y, z: msg.z, slots } }];
      }
      case 'chestSet': {
        if (!Array.isArray(msg.slots)) return [];
        // Only an actual chest block can hold contents. This fail-closes a
        // stale/late write (e.g. from a client whose chest was just broken by
        // someone else) so it cannot resurrect or fork contents at a now-empty
        // location. A chest position is either recorded in the edit log as
        // Block.Chest (player-placed) or is an UNEDITED structure chest
        // (terrain-generated; once edited away it can't be resurrected).
        const editAt = this.edits.get(`${msg.x},${msg.y},${msg.z}`);
        if (editAt !== Block.Chest &&
            !(editAt === undefined &&
              this.structureChestTierAt(msg.x, msg.y, msg.z) !== null)) return [];
        // A minigame stack cannot be parked in world storage.
        if (msg.slots.some((v) => v && isMinigameOnly((v as ItemStack).id))) return [];
        const slots = msg.slots.slice(0, CHEST_SLOTS);
        while (slots.length < CHEST_SLOTS) slots.push(null);
        this.chests.set(`${msg.x},${msg.y},${msg.z}`, slots);
        // Live viewers (other than the sender) get the update.
        return [{
          to: 'others', from: id,
          msg: { t: 'chest', x: msg.x, y: msg.y, z: msg.z, slots },
        }];
      }
      case 'machineOpen': {
        if (!this.nearMachine(p, msg.x, msg.y, msg.z)) return [];
        const s = this.ensureMachine(msg.x, msg.y, msg.z);
        if (!s) return [];
        return [{ to: id, msg: { t: 'machine', x: msg.x, y: msg.y, z: msg.z, state: s } }];
      }
      case 'machineConfig': {
        if (!this.nearMachine(p, msg.x, msg.y, msg.z)) return [];
        const s = this.ensureMachine(msg.x, msg.y, msg.z);
        if (!s || s.type !== MachineType.Autominer) return [];
        setFilter(s, msg.filter);
        // All viewers refresh (server doesn't track who has it open).
        return [{ to: 'all', msg: { t: 'machine', x: msg.x, y: msg.y, z: msg.z, state: s } }];
      }
      case 'machineUpgrade': {
        // Fail-closed on an unknown axis (rather than defaulting to production).
        if (msg.axis !== 'production' && msg.axis !== 'storage') return [];
        if (!this.nearMachine(p, msg.x, msg.y, msg.z)) return [];
        const s = this.ensureMachine(msg.x, msg.y, msg.z);
        if (!s) return [];
        // Cost is paid client-side (authoritative-lite); the server just bumps
        // and caps the level so it can never exceed the max.
        applyUpgrade(s, msg.axis);
        return [{ to: 'all', msg: { t: 'machine', x: msg.x, y: msg.y, z: msg.z, state: s } }];
      }
      case 'machineCollect': {
        if (!this.nearMachine(p, msg.x, msg.y, msg.z)) return [];
        const s = this.ensureMachine(msg.x, msg.y, msg.z);
        if (!s) return [];
        const taken = collectMachine(s);
        const out: Outbound[] = [];
        // Grant via the same dup-safe path as item pickups (leftover that won't
        // fit is re-dropped by the client), then refresh viewers.
        for (const [idStr, count] of Object.entries(taken)) {
          const itemId = Number(idStr);
          if (!ITEMS[itemId] || !fin(count) || count <= 0) continue;
          // Automated output is faction income too — the server mints it here,
          // so unlike a harvest drop there is nothing a client could mislabel.
          const net = Math.floor(count) - this.levyInto(p.faction, itemId, Math.floor(count));
          if (net > 0) out.push({ to: id, msg: { t: 'gotitem', item: itemId, count: net } });
        }
        this.politicsDirty = true;
        out.push({ to: 'all', msg: { t: 'machine', x: msg.x, y: msg.y, z: msg.z, state: s } });
        return out;
      }
      case 'machineHit': {
        if (!this.nearMachine(p, msg.x, msg.y, msg.z)) return [];
        const s = this.ensureMachine(msg.x, msg.y, msg.z);
        if (!s) return [];
        const dmg = fin(msg.amount) ? Math.max(0, Math.min(1000, msg.amount)) : 0;
        if (damageMachine(s, dmg)) {
          const key = `${Math.floor(msg.x)},${Math.floor(msg.y)},${Math.floor(msg.z)}`;
          return this.destroyMachine(key, Math.floor(msg.x), Math.floor(msg.y), Math.floor(msg.z));
        }
        // Survived: broadcast the new HP so every viewer's bar updates.
        return [{ to: 'all', msg: { t: 'machine', x: msg.x, y: msg.y, z: msg.z, state: s } }];
      }
      case 'machineClaim': {
        if (!this.nearMachine(p, msg.x, msg.y, msg.z)) return [];
        const s = this.ensureMachine(msg.x, msg.y, msg.z);
        if (!s) return [];
        claimMachine(s, p.username);
        return [{ to: 'all', msg: { t: 'machine', x: msg.x, y: msg.y, z: msg.z, state: s } }];
      }
      case 'machineMove': {
        if (!fin(msg.x, msg.y, msg.z, msg.tx, msg.ty, msg.tz)) return [];
        // Must be within reach of BOTH the machine and the destination.
        if (!this.nearMachine(p, msg.x, msg.y, msg.z)) return [];
        if (!this.nearMachine(p, msg.tx, msg.ty, msg.tz)) return [];
        // Enemy-claim protection on either end blocks the move (no shield theft).
        return this.moveMachine(msg.x, msg.y, msg.z, msg.tx, msg.ty, msg.tz);
      }
      case 'setSpawn': {
        if (!fin(msg.x, msg.y, msg.z)) return [];
        if (!this.nearMachine(p, msg.x, msg.y, msg.z)) return []; // in-reach gate
        const bx = Math.floor(msg.x), by = Math.floor(msg.y), bz = Math.floor(msg.z);
        if (this.edits.get(`${bx},${by},${bz}`) !== Block.RespawnBeacon) return [];
        p.spawnX = bx; p.spawnY = by; p.spawnZ = bz;
        return [{ to: p.id, msg: { t: 'notice', text: 'Respawn point set!' } }];
      }
      // --- Turrets ---
      case 'turretOpen': {
        if (!this.nearMachine(p, msg.x, msg.y, msg.z)) return [];
        const s = this.ensureTurret(msg.x, msg.y, msg.z);
        if (!s) return [];
        return [{ to: id, msg: { t: 'turret', x: msg.x, y: msg.y, z: msg.z, state: s } }];
      }
      case 'turretUpgrade': {
        if (msg.axis !== 'range' && msg.axis !== 'damage' && msg.axis !== 'rate') return [];
        if (!this.nearMachine(p, msg.x, msg.y, msg.z)) return [];
        const s = this.ensureTurret(msg.x, msg.y, msg.z);
        if (!s) return [];
        applyTurretUpgrade(s, msg.axis);
        return [{ to: 'all', msg: { t: 'turret', x: msg.x, y: msg.y, z: msg.z, state: s } }];
      }
      case 'turretClaim': {
        if (!this.nearMachine(p, msg.x, msg.y, msg.z)) return [];
        const s = this.ensureTurret(msg.x, msg.y, msg.z);
        if (!s) return [];
        claimTurret(s, p.username, p.faction);
        return [{ to: 'all', msg: { t: 'turret', x: msg.x, y: msg.y, z: msg.z, state: s } }];
      }
      case 'turretLoad': {
        if (!this.nearMachine(p, msg.x, msg.y, msg.z)) return [];
        const s = this.ensureTurret(msg.x, msg.y, msg.z);
        if (!s) return [];
        if (!fin(msg.count) || (msg.item !== Item.Cannonball && msg.item !== Item.OilBarrel)) return [];
        turretLoad(s, msg.item, msg.count); // client only sends what its predicted room allows
        return [{ to: 'all', msg: { t: 'turret', x: msg.x, y: msg.y, z: msg.z, state: s } }];
      }
      case 'turretHit': {
        if (!this.nearMachine(p, msg.x, msg.y, msg.z)) return [];
        const s = this.ensureTurret(msg.x, msg.y, msg.z);
        if (!s) return [];
        const dmg = fin(msg.amount) ? Math.max(0, Math.min(1000, msg.amount)) : 0;
        if (damageTurret(s, dmg)) {
          return this.destroyTurret(Math.floor(msg.x), Math.floor(msg.y), Math.floor(msg.z));
        }
        return [{ to: 'all', msg: { t: 'turret', x: msg.x, y: msg.y, z: msg.z, state: s } }];
      }
      // --- WARFARE COMMAND ---------------------------------------------------
      case 'warfareBuy': {
        if (typeof msg.node !== 'string') return [];
        const w = this.warfareOf(p.username);
        if (!buyWarfareNode(w, msg.node)) {
          return [{ to: id, msg: { t: 'warfareErr',
            reason: 'That technology cannot be authorized yet.' } }];
        }
        this.saveWarfare(p);
        return [this.warfareMsg(p)];
      }
      case 'heliSpawn':
        return this.handleHeliSpawn(p, msg.x, msg.y, msg.z);
      case 'heliDeploy':
        return this.handleHeliDeploy(p, msg.x, msg.y, msg.z);
      case 'heliMount': {
        const seat = msg.seat === 'pilot' || msg.seat === 'passenger' ? msg.seat : undefined;
        const res = this.vehicles.mount(msg.id, p.id, p.faction, { x: p.x, y: p.y, z: p.z }, seat);
        if (!res.ok) return [{ to: id, msg: { t: 'warfareErr', reason: res.reason } }];
        return [
          { to: id, msg: { t: 'heliSeat', id: msg.id, seat: res.seat } },
          ...this.heliBroadcast(),
        ];
      }
      case 'heliDismount': {
        const res = this.vehicles.dismount(p.id);
        if (!res.ok) return [{ to: id, msg: { t: 'warfareErr', reason: res.reason ?? '' } }];
        return [
          { to: id, msg: { t: 'heliSeat', id: 0, seat: null } },
          ...this.heliBroadcast(),
        ];
      }
      case 'heliInput':
        this.vehicles.setInput(p.id, msg);
        return [];
      case 'heliBomb':
        return this.applyVehicleEvents(this.vehicles.dropBomb(p.id));
      case 'heliService': {
        const h = this.vehicles.helicopters.get(msg.id);
        if (!h || !sameFaction(h.faction, p.faction)) return [];
        if (!this.vehicles.canService(h)) {
          return [{ to: id, msg: { t: 'warfareErr',
            reason: 'Set the airframe down and stop before servicing it.' } }];
        }
        this.vehicles.service(h,
          fin(msg.oil) ? msg.oil : 0, fin(msg.bombs) ? msg.bombs : 0,
          fin(msg.repair) ? msg.repair : 0);
        return this.heliBroadcast();
      }
      case 'heliUpgrade': {
        const h = this.vehicles.helicopters.get(msg.id);
        if (!h || !sameFaction(h.faction, p.faction)) return [];
        if (!this.vehicles.canService(h)) {
          return [{ to: id, msg: { t: 'warfareErr',
            reason: 'Set the airframe down and stop before retrofitting it.' } }];
        }
        const cap = warfareTier(this.warfareOf(p.username), 'helicopter');
        if (h.tier >= Math.min(cap, MAX_HARDWARE_TIER)) {
          return [{ to: id, msg: { t: 'warfareErr',
            reason: 'You have not authorized the next airframe retrofit.' } }];
        }
        this.vehicles.retrofit(h, h.tier + 1);
        return this.heliBroadcast();
      }
      case 'heliModule': {
        const h = this.vehicles.helicopters.get(msg.id);
        if (!h || !sameFaction(h.faction, p.faction)) return [];
        const spec = msg.item === Item.AuxiliaryTank
          ? { module: 'auxTank' as const, node: 'air_aux_tanks' }
          : msg.item === Item.LongRangeTank
            ? { module: 'longRangeTank' as const, node: 'air_long_range_tanks' }
            : msg.item === Item.RopeWinch
              ? { module: 'ropeWinch' as const, node: 'air_fast_rope' }
              : null;
        if (!spec || !warfareOwns(this.warfareOf(p.username), spec.node)) {
          return [{ to: id, msg: { t: 'warfareErr', reason: 'That airframe module is not authorized.' } }];
        }
        if (!this.vehicles.canService(h)) {
          return [{ to: id, msg: { t: 'warfareErr',
            reason: 'Set the airframe down and stop before installing modules.' } }];
        }
        if (!this.vehicles.installModule(h, spec.module)) {
          return [{ to: id, msg: { t: 'warfareErr', reason: 'That module cannot be installed here.' } }];
        }
        return [
          { to: id, msg: { t: 'heliModuleInstalled', id: h.id, item: msg.item } },
          ...this.heliBroadcast(),
        ];
      }
      case 'heliRope': {
        if (msg.action === 'toggle') {
          if (!this.vehicles.toggleRope(p.id)) {
            return [{ to: id, msg: { t: 'warfareErr', reason: 'No fast-rope winch is available.' } }];
          }
          return this.heliBroadcast();
        }
        if (msg.action === 'drop') {
          this.vehicles.detachRope(p.id);
          this.ropePlayers.delete(p.id);
          return [{ to: id, msg: { t: 'heliRopeState', id: 0, progress: 0 } }];
        }
        if (msg.action === 'move') {
          this.vehicles.setRopeMotion(p.id, fin(msg.motion as number) ? msg.motion as number : 0);
          return [];
        }
        const seated = this.vehicles.seatOf(p.id);
        let onlyHeliId: number | undefined;
        const from = seated ? seated.heli.position : { x: p.x, y: p.y, z: p.z };
        const out: Outbound[] = [];
        if (seated) {
          if (!seated.heli.ropeDeployed) {
            return [{ to: id, msg: { t: 'warfareErr', reason: 'Deploy the rope before transferring.' } }];
          }
          onlyHeliId = seated.heli.id;
          this.vehicles.dismount(p.id);
          out.push({ to: id, msg: { t: 'heliSeat', id: 0, seat: null } });
        }
        const attached = this.vehicles.attachRope(p.id, p.faction, from, onlyHeliId);
        if (!attached.ok) {
          return [...out, { to: id, msg: { t: 'warfareErr', reason: attached.reason } }];
        }
        this.ropePlayers.add(p.id);
        out.push({ to: id, msg: { t: 'heliRopeState',
          id: attached.rider.heliId, progress: attached.rider.progress } });
        out.push(...this.heliBroadcast());
        return out;
      }
      case 'heliHit': {
        const h = this.vehicles.helicopters.get(msg.id);
        if (!h || sameFaction(h.faction, p.faction)) return [];
        const dmg = fin(msg.amount) ? Math.max(0, Math.min(RANGED_MAX_DAMAGE, msg.amount)) : 0;
        if (dmg <= 0) return [];
        return [...this.applyVehicleEvents(this.vehicles.damage(msg.id, dmg)),
          ...this.heliBroadcast()];
      }
      // --- Lifesteal (Milestone A) ---
      case 'heartConsume': {
        // +1 max heart from a Heart item (the item cost is paid client-side,
        // like other crafting; the server clamps the cap so it can't run away).
        if (p.dead) return [];
        if (!canConsume(p.hearts)) {
          return [{ to: id, msg: { t: 'notice', text: `Your hearts are already full (${MAX_HEARTS})!` } }];
        }
        p.hearts = clampHearts(p.hearts + 1);
        return [{ to: id, msg: { t: 'hearts', hearts: p.hearts, reason: 'consume' } }];
      }
      case 'heartWithdraw': {
        // Bottle one of YOUR hearts (the crafting grid mints the item; this is
        // the server-side heart deduction + floor check).
        if (p.dead) return [];
        if (!canWithdraw(p.hearts)) {
          return [{ to: id, msg: { t: 'notice', text: 'You need at least 3 hearts to bottle one!' } }];
        }
        p.hearts = clampHearts(p.hearts - 1);
        p.health = Math.min(p.health, maxHealthFor(p.hearts)); // shrink into the new max
        return [{ to: id, msg: { t: 'hearts', hearts: p.hearts, reason: 'withdraw' } }];
      }
      case 'useHeal': {
        // Right-click a Bandage/Medkit: the item is consumed client-side; the
        // server applies the accelerated-regen buff so healed HP is authoritative
        // (it reaches the client through the periodic snapshot). Health itself is
        // not set here — tickRegen ramps it up, so it can't overheal past the cap.
        if (p.dead) return [];
        const heal = ITEMS[msg.item]?.heal;
        if (!heal) return []; // fail-closed: only real heal items apply
        p.regenBoostTimer = heal.duration;
        p.regenBoostInterval = heal.interval;
        p.regenCooldown = 0;   // heal even right after a hit
        p.regenTimer = 0;
        return [];
      }
      case 'reviveList': {
        const targets = this.listEliminated?.(p.faction) ?? [];
        return [{ to: id, msg: { t: 'reviveList', targets } }];
      }
      case 'beaconRevive': {
        if (p.dead || typeof msg.target !== 'string') return [];
        const target = msg.target.slice(0, 32);
        const ok = this.onRevive?.(target, p.faction, p.username) === true;
        const out: Outbound[] = [{ to: id, msg: { t: 'revived', target, ok } }];
        out.push({ to: id, msg: { t: 'notice', text: ok
          ? `You revived ${target}!`
          : `Can't revive ${target} (not an eliminated teammate).` } });
        return out;
      }
      // --- Waypoint Totems (B4) ---
      case 'attune': {
        if (!this.nearMachine(p, msg.x, msg.y, msg.z)) return []; // in-reach + alive gate
        const x = Math.floor(msg.x), y = Math.floor(msg.y), z = Math.floor(msg.z);
        if (this.edits.get(`${x},${y},${z}`) !== Block.WaypointTotem) return [];
        const at = p.totems.findIndex((t) => t.x === x && t.y === y && t.z === z);
        const out: Outbound[] = [];
        if (at >= 0) {
          // Toggle: attuning an already-attuned totem releases it.
          p.totems.splice(at, 1);
          out.push({ to: id, msg: { t: 'notice', text: 'Attunement released.' } });
        } else if (p.totems.length >= MAX_ATTUNED) {
          return [{ to: id, msg: { t: 'notice',
            text: `You can attune at most ${MAX_ATTUNED} totems — release one first (right-click it).` } }];
        } else {
          p.totems.push({ x, y, z });
          out.push({ to: id, msg: { t: 'notice',
            text: `Totem attuned (${p.totems.length}/${MAX_ATTUNED}) — open the map (M) to travel!` } });
        }
        out.push({ to: id, msg: { t: 'attuned', totems: p.totems.slice() } });
        return out;
      }
      case 'totemTeleport': {
        if (p.dead || !fin(msg.x, msg.y, msg.z)) return [];
        const x = Math.floor(msg.x), y = Math.floor(msg.y), z = Math.floor(msg.z);
        if (!p.totems.some((t) => t.x === x && t.y === y && t.z === z)) return []; // not attuned
        // The totem must still be standing — a raided/broken totem is pruned.
        if (this.edits.get(`${x},${y},${z}`) !== Block.WaypointTotem) {
          p.totems = p.totems.filter((t) => !(t.x === x && t.y === y && t.z === z));
          return [
            { to: id, msg: { t: 'notice', text: 'That totem was destroyed!' } },
            { to: id, msg: { t: 'attuned', totems: p.totems.slice() } },
          ];
        }
        if (this.worldTime < p.totemCooldownUntil) {
          const left = Math.ceil(p.totemCooldownUntil - this.worldTime);
          return [{ to: id, msg: { t: 'notice', text: `Totem travel recharging — ${left}s left.` } }];
        }
        // Combat tag: any damage in the last COMBAT_TAG seconds blocks the port
        // (this also covers "wind-up interrupted by damage" server-side).
        if (this.worldTime - p.lastDamageTime < COMBAT_TAG) {
          return [{ to: id, msg: { t: 'notice', text: "You can't teleport while in combat!" } }];
        }
        p.totemCooldownUntil = this.worldTime + TOTEM_COOLDOWN;
        p.x = x + 0.5; p.y = y + 1; p.z = z + 0.5; // stand on top of the totem
        return [{ to: id, msg: { t: 'teleport', x: p.x, y: p.y, z: p.z } }];
      }
      // --- Vaults (Milestone D) ---
      case 'vaultEnter': {
        if (!fin(msg.cx, msg.cz)) return [];
        const st = this.vaultStampAt(Math.floor(msg.cx), Math.floor(msg.cz));
        if (!st) return [];
        const v = this.ensureVault(st);
        const out: Outbound[] = [{ to: id, msg: { t: 'vault', cx: st.cx, cz: st.cz, tier: st.tier,
          hp: v.hp, maxHp: bossMaxHp(st.tier, st.bossKind), alive: v.hp > 0,
          opened: vaultLootCooldownLeft(v, p.username, this.worldTime) > 0 } }];
        // Migrate old saves that broke a now-protected anchor or edited the boss
        // floor. Deterministic authored cells are restored when the vault is used.
        const protectedKeys = new Set<string>([
          `${st.chest.x},${st.chest.y},${st.chest.z}`,
          ...st.rooms.filter((room) => room.cap > 0).map((room) =>
            `${Math.floor(room.x)},${Math.floor(room.y)},${Math.floor(room.z)}`),
        ]);
        const restoreArena = this.playerInArena(p, st);
        for (const cell of st.blocks) {
          const cellKey = `${cell.x},${cell.y},${cell.z}`;
          if (!protectedKeys.has(cellKey) && !(restoreArena &&
              this.blockInArena(cell.x, cell.y, cell.z, st))) continue;
          if (!this.edits.delete(cellKey)) continue;
          out.push({ to: 'all', msg: { t: 'edit', x: cell.x, y: cell.y, z: cell.z,
            block: cell.id } });
        }
        if (v.hp > 0 && !p.dead && this.playerInArena(p, st)) {
          const active = this.ensureEncounter(st, p);
          active.engine.start(p.id, this.worldTime);
          active.credited = p.username;
          out.push({ to: id, msg: {
            t: 'encounterStart', cx: st.cx, cz: st.cz,
            encounterId: active.engine.config.encounterId,
            family: st.family, kind: st.bossKind, tier: st.tier,
            startTime: active.engine.startedAt, seed: active.engine.config.seed,
            bounds: { ...st.arena.bounds },
            scaling: participantHpMultiplier(active.engine.peakParticipants),
            cameraAnchors: st.arena.cameraAnchors.map((x) => ({ ...x })),
            snapshot: active.engine.snapshot(),
          } });
        }
        // `opened` = YOUR per-player loot cooldown is running (regrows in 30m).
        return out;
      }
      case 'vaultAttack':
        return this.handleVaultAttack(p, msg.cx, msg.cz, msg.intent);
      case 'vaultChestOpen':
        return this.handleVaultChestOpen(p, msg.x, msg.y, msg.z);
      default:
        return [];
    }
  }

  private duelSnapshotOutbound(snapshot: DuelLobbySnapshot, invite?: { id: number; token: string }): Outbound[] {
    const progression = snapshot.phase === 'results' && snapshot.result
      ? this.settleDuelProgression(snapshot) : [];
    const out: Outbound[] = snapshot.participants.map((participant) => ({
      to: participant.id,
      msg: { t: 'duelLobby', snapshot, inviteToken: invite?.id === participant.id ? invite.token : undefined },
    }));
    out.push(...progression);
    return out;
  }

  private settleDuelProgression(snapshot: DuelLobbySnapshot): Outbound[] {
    const result = snapshot.result;
    if (!result) return [];
    const key = `${snapshot.id}:${snapshot.startedAt ?? result.rematchDeadline}`;
    if (this.settledDuelResults.has(key)) return [];
    this.settledDuelResults.add(key);
    if (result.finishReason === 'cancelled') return [];
    const settlement = settleDuelProgress(result.scoreboard.map((participant) => ({
      id: participant.id, username: participant.username,
      state: this.duelProgress.get(participant.id) ?? newDuelProgress(),
    })), this.wallNow());
    // The callback receives the complete account set in one call. It must
    // finish before the result object is exposed to any outbound message.
    const persisted = this.onDuelSettlement?.(settlement.states.map((value) => ({
      username: value.username, state: value.state,
    })));
    for (const value of settlement.states) {
      this.duelProgress.set(value.id, value.state);
      const player = this.players.get(value.id);
      if (player) player.duelProfile = persisted?.profiles[value.username.toLowerCase()] ?? duelProfileOf(value.state);
    }
    result.progressChanges = settlement.changes;
    this.duels.applyProgression(settlement.changes);
    for (const participant of snapshot.participants) {
      const change = settlement.changes.find((value) => value.id === participant.id);
      if (change) participant.profile = { ...change.profile, rank: { ...change.profile.rank } };
    }
    for (const participant of result.scoreboard) {
      const change = settlement.changes.find((value) => value.id === participant.id);
      if (change) participant.profile = { ...change.profile, rank: { ...change.profile.rank } };
    }
    // No shell persistence (tests, standalone): build the board from this
    // match alone — still skipping anyone who is mid-placements, exactly as
    // the account store does.
    const leaderboard = persisted?.leaderboard ?? settlement.changes
      .filter((change) => change.profile.placementsRemaining <= 0)
      .map((change) => ({ username: change.username, ...change.profile }))
      .sort((a, b) => b.rp - a.rp);
    for (const value of settlement.states) if (!this.players.has(value.id)) this.duelProgress.delete(value.id);
    const out: Outbound[] = [{ to: 'all', msg: { t: 'duelLeaderboard', leaderboard } }];
    for (const change of settlement.changes) out.push({
      to: change.id, msg: { t: 'duelProgress',
        profile: persisted?.profiles[change.username.toLowerCase()] ?? change.profile, leaderboard },
    });
    return out;
  }

  /** Everything that must happen the instant a match reaches its result: the
   *  final card to every member, and a wipe of the cover they built. Clearing
   *  the arena HERE rather than at the next match start means the results
   *  screen already looks out over a clean floor, and means a rematch, a fresh
   *  start from the lobby and a forfeit all inherit the same reset arena. */
  private duelResultOutbound(snapshot: DuelLobbySnapshot): Outbound[] {
    if (snapshot.phase !== 'results' || !snapshot.result) return [];
    const ids = snapshot.participants.map((participant) => participant.id);
    const out: Outbound[] = ids.map((id) => ({
      to: id, msg: { t: 'duelResult', result: snapshot.result! },
    }));
    if (snapshot.arena) out.push(...this.resetDuelArenaEdits(snapshot.arena.slot, ids));
    return out;
  }

  private duelLoadout(to: number): Outbound {
    const slots: (ItemStack | null)[] = new Array(36).fill(null);
    slots[0] = { id: Item.BurstRifle, count: 1, loaded: 24 };
    slots[1] = { id: Block.OakPlanks, count: 64 };
    slots[2] = { id: Item.IronAxe, count: 1 };
    slots[3] = { id: Item.JumpBoost, count: 5 };
    slots[4] = { id: Item.Medkit, count: 5 };
    return { to, msg: { t: 'duelLoadout', slots, armor: new Array(4).fill(null),
      selected: 0, unlimitedReserve: true } };
  }

  /** Strip an arena back to its authored geometry.
   *
   *  This sweeps the whole edit log over the arena's footprint rather than
   *  only the planks this slot happens to still be TRACKING. The tracking map
   *  is per-lobby state and every path that loses it — a forfeit, a host
   *  disconnect, a server restart with a persisted world, a slot handed to a
   *  different lobby — used to leave real planks standing in an arena nobody
   *  had a record of. The footprint is authoritative and cannot go stale, so
   *  a match now always opens on the bare colosseum. */
  private resetArenaEdits(
    trackKey: string, bounds: ArenaAABB, memberIds?: number[],
  ): Outbound[] {
    const { minX, maxX, minZ, maxZ, minY, maxY } = bounds;
    const edits: { x: number; y: number; z: number; block: number }[] = [];
    for (const key of [...this.edits.keys()]) {
      const first = key.indexOf(',');
      const x = Number(key.slice(0, first));
      // The overwhelming majority of world edits are nowhere near an arena;
      // reject on x before paying for the rest of the key.
      if (!(x >= minX && x < maxX)) continue;
      const second = key.indexOf(',', first + 1);
      const z = Number(key.slice(second + 1));
      if (!(z >= minZ && z < maxZ)) continue;
      const y = Number(key.slice(first + 1, second));
      if (y < minY || y >= maxY) continue;
      this.edits.delete(key);
      edits.push({ x, y, z, block: Block.Air });
    }
    this.arenaEdits.delete(trackKey);
    if (edits.length === 0 || !memberIds || memberIds.length === 0) return [];
    return memberIds.map((id) => ({
      to: id,
      msg: { t: 'editBatch', edits },
    }));
  }

  private resetDuelArenaEdits(slot: number, memberIds?: number[]): Outbound[] {
    const arena = duelArenaBounds(slot);
    return this.resetArenaEdits(`duel:${slot}`, {
      minX: arena.originX, maxX: arena.originX + DUEL_ARENA_SIZE,
      minZ: arena.originZ, maxZ: arena.originZ + DUEL_ARENA_SIZE,
      minY: arena.floor - 1, maxY: arena.ceiling,
    }, memberIds);
  }

  private preserveOpenWorldState(p: ServerPlayer): void {
    if (p.arenaSaved) return;
    p.arenaSaved = {
      x: p.x, y: p.y, z: p.z, yaw: p.yaw, pitch: p.pitch,
      health: p.health, dead: p.dead, mode: p.mode, held: p.held,
      armor: p.armor.slice(), armorPoints: p.armorPoints, toughness: p.toughness,
      savedClientData: cloneRecord(p.savedClientData),
    };
  }

  /** Move a player into a temporary arena body: their open-world state is held
   *  aside, every world attachment (vehicle, rope) is severed, and the body is
   *  reset to a clean competitive baseline. Mode-specific loadout is the
   *  caller's job. */
  private enterArenaBody(
    p: ServerPlayer, kind: ArenaKind,
    spawn: { x: number; y: number; z: number }, yaw: number, maxHealth: number,
  ): void {
    this.preserveOpenWorldState(p);
    p.arenaKind = kind;
    this.vehicles.disconnectPlayer(p.id);
    this.ropePlayers.delete(p.id);
    p.x = spawn.x; p.y = spawn.y; p.z = spawn.z; p.yaw = yaw; p.pitch = 0;
    p.health = maxHealth; p.dead = false; p.mode = 'survival';
    p.armor = [0, 0, 0, 0]; p.armorPoints = 0; p.toughness = 0;
    p.gliding = false; p.boating = false; p.seated = false; p.sneaking = false;
    p.regenCooldown = 0; p.regenTimer = 0; p.regenBoostTimer = 0; p.regenBoostInterval = 0;
    // A teleport is not motion. Starting the history at the spawn stops a
    // rewind from interpolating the player back across the whole arena.
    p.arenaTrack = [];
    this.recordArenaTrack(p);
  }

  private enterDuelBody(p: ServerPlayer, arena: DuelArenaBounds, spawnIndex: number): Outbound[] {
    const index = ((spawnIndex % arena.spawns.length) + arena.spawns.length) % arena.spawns.length;
    const spawn = arena.spawns[index];
    this.enterArenaBody(p, 'duel', spawn, index < 2 ? Math.PI : 0, DUEL_MAX_HEALTH);
    p.duelSpawnIndex = index;
    p.held = Item.BurstRifle;
    p.duelLastShotAt = -Infinity; p.duelNextBurstAt = 0; p.duelBurstShots = 0;
    p.duelShotTickets = []; p.duelLoaded = 24; p.duelReloadUntil = 0;
    p.duelMedkits = 5; p.duelRespawning = false;
    return [
      this.duelLoadout(p.id),
      { to: p.id, msg: { t: 'duelArena', arena, spawn: { ...spawn },
        countdownEndsAt: this.duels.snapshotFor(p.id, this.worldTime * 1000)?.countdownEndsAt ?? 0 } },
    ];
  }

  private restoreOpenWorldState(p: ServerPlayer): Outbound[] {
    const saved = p.arenaSaved;
    if (!saved) return [];
    p.x = saved.x; p.y = saved.y; p.z = saved.z; p.yaw = saved.yaw; p.pitch = saved.pitch;
    p.health = saved.health; p.dead = saved.dead; p.mode = saved.mode;
    p.held = saved.held; p.armor = saved.armor.slice();
    p.armorPoints = saved.armorPoints; p.toughness = saved.toughness;
    // The saved blob predates the arena, so it should already be clean — but a
    // crash mid-match, or a future mode that writes through, would make this
    // the moment an arena item entered the world for good. Strip it anyway.
    p.savedClientData = stripMinigameItems(cloneRecord(saved.savedClientData) ?? {});
    p.arenaSaved = undefined; p.arenaKind = undefined;
    p.duelShotTickets = []; p.arenaTrack = []; p.duelLoaded = 0;
    p.duelReloadUntil = 0; p.duelMedkits = 0; p.duelRespawning = false;
    return [{ to: p.id, msg: { t: 'arenaRestored', x: p.x, y: p.y, z: p.z, yaw: p.yaw, pitch: p.pitch,
      health: p.health, dead: p.dead, mode: p.mode, state: cloneRecord(p.savedClientData) } }];
  }

  private restoreDuelLobby(snapshot: DuelLobbySnapshot): Outbound[] {
    const out: Outbound[] = [];
    const restored: number[] = [];
    if (snapshot.arena) {
      out.push(...this.resetDuelArenaEdits(snapshot.arena.slot, snapshot.participants.map((v) => v.id)));
    }
    for (const member of snapshot.participants) {
      const p = this.players.get(member.id);
      if (p?.arenaSaved) { out.push(...this.restoreOpenWorldState(p)); restored.push(p.id); }
    }
    out.push(...this.announceWorldScope(restored));
    return out;
  }

  private announceArenaScope(memberIds: number[]): Outbound[] {
    const members = new Set(memberIds), out: Outbound[] = [];
    for (const id of memberIds) {
      for (const other of this.players.values()) {
        if (members.has(other.id)) continue;
        out.push({ to: id, msg: { t: 'leave', id: other.id } });
        out.push({ to: other.id, msg: { t: 'leave', id } });
      }
    }
    return out;
  }

  private announceWorldScope(restoredIds: number[]): Outbound[] {
    const restored = new Set(restoredIds), out: Outbound[] = [];
    for (const id of restoredIds) {
      const p = this.players.get(id);
      if (!p) continue;
      for (const other of this.players.values()) {
        if (other.id === id || other.arenaSaved) continue;
        out.push({ to: id, msg: { t: 'join', player: toInfo(other) } });
        if (!restored.has(other.id)) out.push({ to: other.id, msg: { t: 'join', player: toInfo(p) } });
      }
    }
    return out;
  }

  private duelBodyClear(x: number, y: number, z: number, arena: DuelArenaBounds): boolean {
    for (const ox of [-0.28, 0.28]) for (const oz of [-0.28, 0.28]) {
      for (const oy of [0.05, 0.9, 1.75]) {
        const bx = Math.floor(x + ox), by = Math.floor(y + oy), bz = Math.floor(z + oz);
        if (duelArenaSolidAt(x + ox, y + oy, z + oz, arena) ||
            this.edits.get(`${bx},${by},${bz}`) === Block.OakPlanks) return false;
      }
    }
    return true;
  }

  private duelBodyPathClear(
    from: { x: number; y: number; z: number }, to: { x: number; y: number; z: number },
    arena: DuelArenaBounds,
  ): boolean {
    const distance = Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z);
    const steps = Math.max(1, Math.ceil(distance * 3));
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      if (!this.duelBodyClear(from.x + (to.x - from.x) * t,
        from.y + (to.y - from.y) * t, from.z + (to.z - from.z) * t, arena)) return false;
    }
    return true;
  }

  private handleDuelTransform(p: ServerPlayer, msg: Extract<ClientMsg, { t: 'xform' }>): Outbound[] {
    const arena = this.duels.arenaFor(p.id), phase = this.duels.phaseFor(p.id);
    if (!arena || !phase || !fin(msg.x, msg.y, msg.z, msg.yaw, msg.pitch)) return [];
    const participant = this.duels.participantFor(p.id);
    if (!participant) return [];
    const wanted = phase === 'countdown' ? arena.spawns[Math.max(0, p.duelSpawnIndex)]
      : clampToDuelArena({ x: msg.x, y: msg.y, z: msg.z }, arena);
    if (participant.spectating || this.duelBodyPathClear(p, wanted, arena)) {
      p.x = wanted.x; p.y = wanted.y; p.z = wanted.z;
    }
    p.yaw = msg.yaw; p.pitch = msg.pitch;
    p.gliding = false; p.boating = false; p.seated = false; p.sneaking = msg.sneaking === true;
    p.held = participant.alive && (msg.held === Item.BurstRifle || msg.held === Item.IronAxe ||
      msg.held === Block.OakPlanks || msg.held === Item.Medkit || msg.held === Item.JumpBoost) ? msg.held : 0;
    p.armor = [0, 0, 0, 0]; p.aiming = p.held === Item.BurstRifle && msg.aiming === true;
    if (p.held === Item.BurstRifle && msg.reloading === true &&
        p.duelLoaded < 24 && p.duelReloadUntil <= 0) {
      p.duelReloadUntil = this.worldTime + 1.1;
    }
    p.reloading = p.duelReloadUntil > this.worldTime;
    if (typeof msg.swing === 'number' && Number.isFinite(msg.swing)) p.swing = Math.floor(msg.swing) & 0xffff;
    this.recordArenaTrack(p);
    return [];
  }

  /** Append this player's accepted position to their rewind history. */
  private recordArenaTrack(p: ServerPlayer): void {
    const now = this.worldTime;
    p.arenaTrack.push({ at: now, x: p.x, y: p.y, z: p.z });
    let drop = 0;
    while (drop < p.arenaTrack.length && now - p.arenaTrack[drop].at > DUEL_TRACK_WINDOW) drop++;
    if (drop > 0) p.arenaTrack.splice(0, drop);
  }

  private handleDuelShot(p: ServerPlayer, msg: Extract<ClientMsg, { t: 'shot' }>): Outbound[] {
    const phase = this.duels.phaseFor(p.id), participant = this.duels.participantFor(p.id);
    if ((phase !== 'running' && phase !== 'sudden_death') || !participant?.alive ||
        p.held !== Item.BurstRifle || msg.item !== Item.BurstRifle ||
        !fin(msg.x, msg.y, msg.z, msg.dx, msg.dy, msg.dz)) return [];
    if (Math.hypot(msg.x - p.x, msg.y - (p.y + 1.6), msg.z - p.z) > 4) return [];
    const len = Math.hypot(msg.dx, msg.dy, msg.dz);
    if (!(len > 1e-3)) return [];
    const now = this.worldTime;
    if (p.duelReloadUntil > 0 && now >= p.duelReloadUntil) {
      p.duelLoaded = 24; p.duelReloadUntil = 0; p.reloading = false;
    }
    if (p.duelReloadUntil > now || p.duelLoaded <= 0 || now - p.duelLastShotAt < 0.04) return [];
    // A trigger opens one three-round burst and a fixed half-second trigger
    // window. Pausing part-way through cannot be used to reset the limiter.
    if (p.duelBurstShots === 0 || now - p.duelLastShotAt > 0.18) {
      if (now < p.duelNextBurstAt) return [];
      p.duelBurstShots = 1; p.duelNextBurstAt = now + 0.5;
    } else {
      p.duelBurstShots++;
    }
    p.duelLastShotAt = now;
    if (p.duelBurstShots >= 3) p.duelBurstShots = 0;
    p.duelLoaded--;
    p.duelShotTickets.push({ at: now, x: msg.x, y: msg.y, z: msg.z,
      dx: msg.dx / len, dy: msg.dy / len, dz: msg.dz / len });
    // Rounds are projectiles, not hitscan: a shot fired at the far wall is
    // still in the air most of a second later, and the hit report for it comes
    // back after the NEXT burst has already been fired. Retiring tickets after
    // 0.4s (barely one burst) is what threw those hits away. Hold a full flight
    // time, and enough tickets for two overlapping bursts.
    p.duelShotTickets = p.duelShotTickets
      .filter((t) => now - t.at <= DUEL_TRACK_WINDOW).slice(-6);
    this.duels.removeSpawnShield(p.id);
    return this.duels.membersOf(p.id).filter((id) => id !== p.id).map((id) => ({
      to: id, msg: { t: 'shot', id: p.id, item: Item.BurstRifle,
        x: msg.x, y: msg.y, z: msg.z, dx: msg.dx / len, dy: msg.dy / len, dz: msg.dz / len },
    }));
  }

  private handleDuelRanged(attacker: ServerPlayer, targetId: number, amount: number): Outbound[] {
    const target = this.players.get(targetId), arena = this.duels.arenaFor(attacker.id);
    const ap = this.duels.participantFor(attacker.id), tp = this.duels.participantFor(targetId);
    const phase = this.duels.phaseFor(attacker.id), nowMs = this.worldTime * 1000;
    if (!target || !arena || !this.duels.sameMatch(attacker.id, targetId) ||
        (phase !== 'running' && phase !== 'sudden_death') || !ap?.alive || !tp?.alive ||
        (tp.shieldUntil !== undefined && tp.shieldUntil > nowMs)) return [];
    // Match the hit intent to a recent, server-accepted Burst Rifle round. A
    // forged `rangedAttack` cannot deal damage without a valid round aimed
    // through the target's body.
    if (amount !== 5 || !fin(target.x, target.y, target.z)) return [];
    const dx = target.x - attacker.x, dy = target.y - attacker.y, dz = target.z - attacker.z;
    const distance = Math.hypot(dx, dy, dz), horiz = Math.hypot(dx, dz);
    if (!(distance > 0 && distance <= 60)) return [];
    const now = this.worldTime;
    // Lag compensation. The shooter aimed at the opponent as their own client
    // drew them — one interpolation delay behind live — and the round then
    // spent up to half a second in the air before the hit was reported. Judging
    // that report against where the target is RIGHT NOW rejected almost every
    // honest shot at a strafing opponent, which is what "fighting doesn't feel
    // good" was: the shots landed on screen and the server threw them away.
    // So rewind: a ticket counts if its ray passed through the target at ANY
    // point in the target's recorded history from the moment it was fired.
    let ticketIndex = -1, hitAt: ArenaTrackSample | null = null;
    // The live position is ALWAYS a candidate — this check is a strict superset
    // of the old "where are they now" test, never a narrower one — and the
    // recorded history is what a hit on a target who has since moved needs.
    const candidates: ArenaTrackSample[] = [{ at: now, x: target.x, y: target.y, z: target.z }];
    for (const sample of target.arenaTrack) candidates.push(sample);
    for (let i = attacker.duelShotTickets.length - 1; i >= 0 && ticketIndex < 0; i--) {
      const shot = attacker.duelShotTickets[i];
      if (now - shot.at > DUEL_TRACK_WINDOW) continue;
      for (const sample of candidates) {
        // Only where the target was from the trigger pull onwards; a position
        // they had left before the round existed can never have been hit.
        if (sample.at < shot.at - 0.15) continue;
        const tx = sample.x - shot.x, ty = sample.y + 0.9 - shot.y, tz = sample.z - shot.z;
        const along = tx * shot.dx + ty * shot.dy + tz * shot.dz;
        if (along < 0 || along > 58) continue;
        const missSq = tx * tx + ty * ty + tz * tz - along * along;
        if (missSq > 1.15 * 1.15) continue;
        ticketIndex = i; hitAt = sample; break;
      }
    }
    if (ticketIndex < 0 || !hitAt) return [];
    // Cover is judged at the same rewound instant, from the muzzle the round
    // actually left — otherwise a target who ran behind a wall after being hit
    // would erase the hit, and one who ran OUT from behind cover would grant a
    // shot that never had a line.
    const shotFrom = attacker.duelShotTickets[ticketIndex];
    const clear = hasArenaLineOfSight({ x: shotFrom.x, y: shotFrom.y, z: shotFrom.z },
      { x: hitAt.x, y: hitAt.y + 1.0, z: hitAt.z }, arena,
      (x, y, z) => this.edits.get(`${Math.floor(x)},${Math.floor(y)},${Math.floor(z)}`) === Block.OakPlanks);
    // The round is spent either way. It was aimed through the target's body, so
    // if cover stopped it, it stopped THERE — leaving the ticket alive would
    // let a blocked round be re-reported the moment the target steps out.
    attacker.duelShotTickets.splice(ticketIndex, 1);
    if (!clear) return [];
    const dealt = Math.min(5, target.health);
    target.health = Math.max(0, target.health - 5);
    const killed = target.health <= 0;
    const knockX = horiz > 0 ? dx / horiz : 0, knockZ = horiz > 0 ? dz / horiz : 0;
    const out: Outbound[] = [
      { to: target.id, msg: { t: 'hurt', health: killed ? 1 : target.health, dead: false,
        by: attacker.id, kx: knockX, ky: 0.25, kz: knockZ, combat: 0 } },
      { to: attacker.id, msg: { t: 'hitconfirm', target: target.id, amount: dealt, killed } },
    ];
    if (!killed) return out;
    target.health = 1; target.held = 0; target.duelRespawning = true;
    const snapshot = this.duels.recordDeath(target.id, attacker.id, nowMs);
    if (!snapshot) return out;
    const dead = snapshot.participants.find((v) => v.id === target.id)!;
    out.push({ to: target.id, msg: { t: 'duelRespawn', respawnAt: dead.respawnAt ?? nowMs,
      spectating: true } });
    out.push(...this.duelSnapshotOutbound(snapshot));
    for (const id of this.duels.membersOf(attacker.id)) {
      out.push({ to: id, msg: { t: 'killfeed', killer: attacker.username, victim: target.username } });
    }
    out.push(...this.duelResultOutbound(snapshot));
    return out;
  }

  private handleDuelHeal(p: ServerPlayer, item: number): Outbound[] {
    const participant = this.duels.participantFor(p.id), phase = this.duels.phaseFor(p.id);
    if (item !== Item.Medkit || !participant?.alive ||
        (phase !== 'running' && phase !== 'sudden_death') || p.duelMedkits <= 0 || p.health >= DUEL_MAX_HEALTH) return [];
    const heal = ITEMS[Item.Medkit].heal;
    if (!heal) return [];
    p.duelMedkits--;
    p.regenBoostTimer = heal.duration; p.regenBoostInterval = heal.interval; p.regenTimer = 0;
    return [];
  }

  private handleDuelEdit(p: ServerPlayer, x: number, y: number, z: number, block: number): Outbound[] {
    const arena = this.duels.arenaFor(p.id), phase = this.duels.phaseFor(p.id);
    const participant = this.duels.participantFor(p.id);
    if (!arena || !participant?.alive || (phase !== 'running' && phase !== 'sudden_death')) return [];
    if (!fin(x, y, z)) return [];
    const bx = Math.floor(x), by = Math.floor(y), bz = Math.floor(z);
    if (bx < arena.minX || bx >= arena.maxX || bz < arena.minZ || bz >= arena.maxZ) return [];
    if (by < arena.floor || by >= arena.ceiling - 1) return [];

    const lx = bx - arena.minX, lz = bz - arena.minZ;
    const groundY = arena.floor + duelTerrainElevation(lx, lz);

    // Natural arena terrain and walls are unbreakable and cannot be replaced
    if (by <= groundY) return [];

    // Max 7-block pillar height above natural ground
    if (by > groundY + DUEL_MAX_PILLAR_HEIGHT) return [];

    let slotEdits = this.arenaEdits.get(`duel:${arena.slot}`);
    if (!slotEdits) {
      slotEdits = new Map<string, number>();
      this.arenaEdits.set(`duel:${arena.slot}`, slotEdits);
    }
    const key = `${bx},${by},${bz}`;

    // The selected-item transform and the edit travel as separate packets. Do
    // not reject a legitimate placement merely because the edit arrived first;
    // the isolated Duel handler already permits only this one build material.
    if (block === Block.OakPlanks) {
      slotEdits.set(key, Block.OakPlanks);
      this.edits.set(key, Block.OakPlanks);
      return this.duels.membersOf(p.id).map((id) => ({
        to: id,
        msg: { t: 'edit', x: bx, y: by, z: bz, block: Block.OakPlanks },
      }));
    } else if (block === Block.Air || block === 0) {
      // The axe is utility-only: it authorizes reclaiming player-built cover,
      // but is never accepted by either Duel damage path.
      if (p.held !== Item.IronAxe || !slotEdits.has(key)) return [];
      slotEdits.delete(key);
      this.edits.delete(key);
      return this.duels.membersOf(p.id).map((id) => ({
        to: id,
        msg: { t: 'edit', x: bx, y: by, z: bz, block: Block.Air },
      }));
    }

    return [];
  }

  private duelError(to: number, code: Extract<ServerMsg, { t: 'duelError' }>['code']): Outbound[] {
    const messages: Record<Extract<ServerMsg, { t: 'duelError' }>['code'], string> = {
      invalid: 'That Duels invite is invalid or has expired.',
      full: 'That Duels lobby is full.',
      match_in_progress: 'Match in progress — wait for this lobby to reopen.',
      already_in_lobby: 'Leave your current Duels lobby before joining another.',
      not_host: 'Only the lobby host can start the match.',
      too_few_players: 'At least two players are required.',
      too_many_players: 'Duels supports no more than four players.',
      not_everyone_ready: 'Every connected player must ready up first.',
      not_in_lobby: 'You are not in a Duels lobby.',
    };
    return [{ to, msg: { t: 'duelError', code, message: messages[code] } }];
  }

  private removeFromDuelQueue(id: number): boolean {
    const before = this.duelQueue.length;
    this.duelQueue = this.duelQueue.filter((queuedId) => queuedId !== id);
    return this.duelQueue.length !== before;
  }

  /** Shared launch path for host-started and matchmade Duels. */
  private launchDuel(snapshot: DuelLobbySnapshot): Outbound[] {
    const out = this.duelSnapshotOutbound(snapshot);
    if (!snapshot.arena) return out;
    const ids = snapshot.participants.map((participant) => participant.id);
    out.push(...this.resetDuelArenaEdits(snapshot.arena.slot, ids));
    for (let i = 0; i < snapshot.participants.length; i++) {
      const player = this.players.get(snapshot.participants[i].id);
      if (player) out.push(...this.enterDuelBody(player, snapshot.arena, i));
    }
    out.push(...this.announceArenaScope(ids));
    return out;
  }

  private handleDuel(p: ServerPlayer, msg: Extract<ClientMsg, { t: `duel${string}` }>): Outbound[] {
    const now = this.worldTime * 1000;
    switch (msg.t) {
      case 'duelCreate': {
        this.removeFromDuelQueue(p.id);
        const result = this.duels.create({ id: p.id, username: p.username, skin: p.skin, profile: p.duelProfile }, now);
        if ('reason' in result) return this.duelError(p.id, result.reason);
        return [
          { to: p.id, msg: { t: 'duelQueue', queued: false } },
          ...this.duelSnapshotOutbound(result.snapshot, { id: p.id, token: result.token }),
        ];
      }
      case 'duelQueue': {
        if (!msg.join) {
          this.removeFromDuelQueue(p.id);
          return [{ to: p.id, msg: { t: 'duelQueue', queued: false } }];
        }
        if (this.duels.phaseFor(p.id)) return this.duelError(p.id, 'already_in_lobby');
        if (this.duelQueue.includes(p.id)) {
          return [{ to: p.id, msg: { t: 'duelQueue', queued: true } }];
        }
        // Drop stale/disconnected/busy entries before selecting the oldest
        // compatible challenger.
        this.duelQueue = this.duelQueue.filter((id) =>
          this.players.has(id) && !this.duels.phaseFor(id) && id !== p.id);
        const opponentId = this.duelQueue.shift();
        if (opponentId === undefined) {
          this.duelQueue.push(p.id);
          return [{ to: p.id, msg: { t: 'duelQueue', queued: true } }];
        }
        const opponent = this.players.get(opponentId);
        if (!opponent) {
          this.duelQueue.push(p.id);
          return [{ to: p.id, msg: { t: 'duelQueue', queued: true } }];
        }
        const made = this.duels.create({
          id: opponent.id, username: opponent.username, skin: opponent.skin, profile: opponent.duelProfile,
        }, now);
        if ('reason' in made) {
          this.duelQueue.push(p.id);
          return [{ to: p.id, msg: { t: 'duelQueue', queued: true } }];
        }
        const joined = this.duels.join(made.token, {
          id: p.id, username: p.username, skin: p.skin, profile: p.duelProfile,
        }, now);
        if (!joined.ok) {
          this.duels.leave(opponent.id, now);
          this.duelQueue.push(p.id);
          return [{ to: p.id, msg: { t: 'duelQueue', queued: true } }];
        }
        this.duels.setReady(opponent.id, true, now);
        this.duels.setReady(p.id, true, now);
        const started = this.duels.start(opponent.id, now);
        if (!started.ok) return this.duelError(p.id, started.reason);
        return [
          { to: opponent.id, msg: { t: 'duelQueue', queued: false } },
          { to: p.id, msg: { t: 'duelQueue', queued: false } },
          ...this.launchDuel(started.snapshot),
        ];
      }
      case 'duelJoin': {
        this.removeFromDuelQueue(p.id);
        // Tokens never enter logs/notices; sanitize only for bounded lookup cost.
        const token = typeof msg.token === 'string' ? msg.token.slice(0, 128) : '';
        const result = this.duels.join(token, { id: p.id, username: p.username, skin: p.skin, profile: p.duelProfile }, now);
        if (!result.ok) return this.duelError(p.id, result.reason);
        return this.duelSnapshotOutbound(result.snapshot, { id: p.id, token });
      }
      case 'duelLeave': {
        if (this.removeFromDuelQueue(p.id) && !this.duels.phaseFor(p.id)) {
          return [{ to: p.id, msg: { t: 'duelQueue', queued: false } }];
        }
        const oldPhase = this.duels.phaseFor(p.id);
        const oldArena = this.duels.arenaFor(p.id);
        const result = this.duels.leave(p.id, now);
        const out = result.snapshot ? this.duelSnapshotOutbound(result.snapshot) : [];
        if (result.deleted && oldArena) {
          out.push(...this.resetDuelArenaEdits(oldArena.slot));
        }
        if (oldPhase && oldPhase !== 'lobby') {
          out.push(...this.restoreOpenWorldState(p));
          out.push(...this.announceWorldScope([p.id]));
        }
        if (result.snapshot?.phase === 'lobby') out.push(...this.restoreDuelLobby(result.snapshot));
        if (result.snapshot) out.push(...this.duelResultOutbound(result.snapshot));
        return out;
      }
      case 'duelReady': {
        const snap = this.duels.setReady(p.id, msg.ready === true, now);
        return snap ? this.duelSnapshotOutbound(snap) : this.duelError(p.id, 'not_in_lobby');
      }
      case 'duelStart': {
        const result = this.duels.start(p.id, now);
        if (!result.ok) return this.duelError(p.id, result.reason);
        return this.launchDuel(result.snapshot);
      }
      case 'duelArenaReady': {
        const snap = this.duels.markArenaReady(p.id, now);
        return snap ? this.duelSnapshotOutbound(snap) : [];
      }
      case 'duelRematch': {
        const snap = this.duels.voteRematch(p.id, msg.vote === true, now);
        if (!snap) return this.duelError(p.id, 'not_in_lobby');
        const out = this.duelSnapshotOutbound(snap);
        if (snap.phase === 'lobby') out.push(...this.restoreDuelLobby(snap));
        else if (snap.phase === 'countdown' && snap.arena) {
          out.push(...this.resetDuelArenaEdits(snap.arena.slot, snap.participants.map((v) => v.id)));
          for (let i = 0; i < snap.participants.length; i++) {
            const player = this.players.get(snap.participants[i].id);
            if (player) out.push(...this.enterDuelBody(player, snap.arena, i));
          }
        }
        return out;
      }
      case 'duelReturn': {
        const snap = this.duels.requestLobby(p.id, now);
        if (!snap) return this.duelError(p.id, 'not_in_lobby');
        return [...this.duelSnapshotOutbound(snap), ...this.restoreDuelLobby(snap)];
      }
      case 'duelFlair': {
        const state = this.duelProgress.get(p.id) ?? newDuelProgress();
        const profile = duelProfileOf(state);
        const requested = msg.flair;
        if (!canEquipDuelFlair(profile, requested)) {
          return [{ to: p.id, msg: { t: 'duelFlairResult', ok: false, profile,
            leaderboard: [] } }];
        }
        const persisted = this.onDuelFlair?.(p.username, requested);
        if (this.onDuelFlair && !persisted) {
          return [{ to: p.id, msg: { t: 'duelFlairResult', ok: false, profile,
            leaderboard: [] } }];
        }
        state.equippedFlair = requested;
        p.duelProfile = persisted?.profile ?? duelProfileOf(state);
        this.duelProgress.set(p.id, state);
        this.duels.updateProfile(p.id, p.duelProfile);
        const leaderboard = persisted?.leaderboard ?? [];
        const out: Outbound[] = [
          { to: p.id, msg: { t: 'duelFlairResult', ok: true, profile: p.duelProfile, leaderboard } },
          { to: 'all', msg: { t: 'duelProfileUpdate', id: p.id, profile: p.duelProfile } },
          { to: 'all', msg: { t: 'duelLeaderboard', leaderboard } },
        ];
        const snapshot = this.duels.snapshotFor(p.id, now);
        if (snapshot) out.push(...this.duelSnapshotOutbound(snapshot));
        return out;
      }
    }
    return [];
  }

  /** Advance authoritative Duels timestamps; called from the transport tick. */

  // ── Bedwars ───────────────────────────────────────────────────────────────

  private bwError(to: number, code: Extract<ServerMsg, { t: 'bwError' }>['code']): Outbound[] {
    const messages: Record<Extract<ServerMsg, { t: 'bwError' }>['code'], string> = {
      invalid: 'That Bedwars invite is invalid or has expired.',
      full: 'That Bedwars lobby is full.',
      match_in_progress: 'Match in progress — wait for this lobby to reopen.',
      already_in_lobby: 'Leave your current minigame lobby before joining another.',
      not_host: 'Only the lobby host can start the match.',
      too_few_players: 'At least two players are required.',
      too_many_players: 'This map has no room for another player.',
      not_everyone_ready: 'Every connected player must ready up first.',
      not_in_lobby: 'You are not in a Bedwars lobby.',
      cannot_afford: "You can't afford that yet.",
      too_far: 'Stand at your own Quartermaster to buy.',
    };
    return [{ to, msg: { t: 'bwError', code, message: messages[code] } }];
  }

  private bwSnapshotOutbound(
    snapshot: BwLobbySnapshot, invite?: { id: number; token: string },
  ): Outbound[] {
    // No progression settlement, deliberately: Bedwars is UNRANKED. Compare
    // `duelSnapshotOutbound`, which settles RP here.
    return snapshot.participants.map((participant) => ({
      to: participant.id,
      msg: { t: 'bwLobby', snapshot, inviteToken: invite?.id === participant.id ? invite.token : undefined },
    }));
  }

  private bwArenaBoundsAABB(arena: BwArenaBounds): ArenaAABB {
    return {
      minX: arena.originX, maxX: arena.originX + BEDWARS_ARENA_SIZE,
      minZ: arena.originZ, maxZ: arena.originZ + BEDWARS_ARENA_SIZE,
      // The sweep must reach the ceiling: a tower of wool is the thing being
      // reset, and it can legally stand well above the island surface.
      minY: BEDWARS_FLOOR_Y - 8, maxY: BEDWARS_CEILING_Y,
    };
  }

  private resetBedwarsArenaEdits(arena: BwArenaBounds, memberIds?: number[]): Outbound[] {
    return this.resetArenaEdits(`bedwars:${arena.slot}`, this.bwArenaBoundsAABB(arena), memberIds);
  }

  /** Player-placed cover inside a Bedwars arena. Consulted by the melee
   *  line-of-sight test, so you cannot swing through a wool wall. */
  private bwPlacedSolid(x: number, y: number, z: number): boolean {
    const block = this.edits.get(`${Math.floor(x)},${Math.floor(y)},${Math.floor(z)}`);
    return block !== undefined && block !== Block.Air && (BLOCKS[block]?.solid ?? false);
  }

  private bwLoadout(p: ServerPlayer, team: number): Outbound {
    const slots: (ItemStack | null)[] = new Array(36).fill(null);
    slots[0] = { id: p.bwAxe, count: 1 };
    slots[1] = { id: bedwarsTeamWool(team), count: 16 };
    return { to: p.id, msg: { t: 'bwLoadout', slots, selected: 0, axe: p.bwAxe } };
  }

  private bwResourcesOutbound(id: number): Outbound[] {
    const p = this.bedwars.participantFor(id);
    if (!p) return [];
    return [{ to: id, msg: { t: 'bwResources', ...p.resources } }];
  }

  private enterBedwarsBody(p: ServerPlayer, arena: BwArenaBounds, team: number): Outbound[] {
    const spawn = arena.spawns.find((s) => s.team === team) ?? arena.spawns[0];
    this.enterArenaBody(p, 'bedwars', spawn, spawn.yaw, BEDWARS_MAX_HEALTH);
    p.bwAxe = this.bedwars.participantFor(p.id)?.axe ?? Item.WoodenAxe;
    p.held = p.bwAxe;
    p.bwLastSwingAt = -Infinity; p.bwCombo = 0; p.bwComboTarget = 0; p.bwComboUntil = 0;
    p.bwRespawning = false; p.bwIronAccum = 0; p.bwGoldAccum = 0;
    return [
      this.bwLoadout(p, team),
      ...this.bwResourcesOutbound(p.id),
      { to: p.id, msg: { t: 'bwArena', arena, spawn: { x: spawn.x, y: spawn.y, z: spawn.z },
        team, countdownEndsAt: this.bedwars.snapshotFor(p.id, this.worldTime * 1000)?.countdownEndsAt ?? 0 } },
    ];
  }

  private launchBedwars(snapshot: BwLobbySnapshot): Outbound[] {
    const out = this.bwSnapshotOutbound(snapshot);
    if (!snapshot.arena) return out;
    const ids = snapshot.participants.map((v) => v.id);
    out.push(...this.resetBedwarsArenaEdits(snapshot.arena, ids));
    for (const participant of snapshot.participants) {
      const player = this.players.get(participant.id);
      if (player) out.push(...this.enterBedwarsBody(player, snapshot.arena, participant.team));
    }
    out.push(...this.announceArenaScope(ids));
    return out;
  }

  private bwResultOutbound(snapshot: BwLobbySnapshot): Outbound[] {
    if (snapshot.phase !== 'results' || !snapshot.result) return [];
    const ids = snapshot.participants.map((v) => v.id);
    const out: Outbound[] = ids.map((id) => ({
      to: id, msg: { t: 'bwResult', result: snapshot.result! },
    }));
    if (snapshot.arena) out.push(...this.resetBedwarsArenaEdits(snapshot.arena, ids));
    return out;
  }

  private restoreBedwarsLobby(snapshot: BwLobbySnapshot): Outbound[] {
    const out: Outbound[] = [];
    const restored: number[] = [];
    if (snapshot.arena) {
      out.push(...this.resetBedwarsArenaEdits(snapshot.arena, snapshot.participants.map((v) => v.id)));
    }
    for (const member of snapshot.participants) {
      const p = this.players.get(member.id);
      if (p?.arenaSaved) { out.push(...this.restoreOpenWorldState(p)); restored.push(p.id); }
    }
    out.push(...this.announceWorldScope(restored));
    return out;
  }

  /**
   * The in-match whitelist.
   *
   * Every branch is explicit and the function ends in `return []`, so anything
   * a Bedwars body sends that is not named here is dropped rather than falling
   * through to the open-world switch.
   */
  private routeBedwarsInMatch(p: ServerPlayer, msg: ClientMsg): Outbound[] {
    if (msg.t === 'xform') return this.handleBedwarsTransform(p, msg);
    if (msg.t === 'bwMelee') return this.handleBedwarsMelee(p, msg.target);
    if (msg.t === 'bwBed') return this.handleBedwarsBed(p, msg.x, msg.y, msg.z);
    if (msg.t === 'bwShopBuy') return this.handleBedwarsShopBuy(p, msg.entry);
    if (msg.t === 'useHeal') return this.handleBedwarsHeal(p, msg.item);
    if (msg.t === 'edit') return this.handleBedwarsEdit(p, msg.x, msg.y, msg.z, msg.block);
    return [];
  }

  private handleBedwarsTransform(p: ServerPlayer, msg: Extract<ClientMsg, { t: 'xform' }>): Outbound[] {
    const arena = this.bedwars.arenaFor(p.id), phase = this.bedwars.phaseFor(p.id);
    if (!arena || !phase || !fin(msg.x, msg.y, msg.z, msg.yaw, msg.pitch)) return [];
    const participant = this.bedwars.participantFor(p.id);
    if (!participant) return [];
    const spawn = arena.spawns.find((s) => s.team === participant.team) ?? arena.spawns[0];
    if (phase === 'countdown') {
      p.x = spawn.x; p.y = spawn.y; p.z = spawn.z;
    } else {
      // The stalemate ladder's third rung drags stragglers toward mid by
      // shrinking the containment box rather than by teleporting anyone.
      const box = this.bedwars.stageFor(p.id) === 'collapse'
        ? collapsedBedwarsArena(arena, BEDWARS_CLAMP_RADIUS) : arena;
      const bounded = clampToBedwarsArena({ x: msg.x, y: msg.y, z: msg.z }, box);
      p.x = bounded.x; p.y = bounded.y; p.z = bounded.z;
    }
    p.yaw = msg.yaw; p.pitch = msg.pitch;
    p.gliding = false; p.boating = false; p.seated = false; p.sneaking = msg.sneaking === true;
    // The held item is cosmetic here: the damage math reads `p.bwAxe`.
    p.held = participant.alive && (msg.held === p.bwAxe ||
      msg.held === bedwarsTeamWool(participant.team) || msg.held === Block.OakPlanks ||
      msg.held === Block.Glass || msg.held === Item.Bandage ||
      msg.held === Item.JumpBoost) ? msg.held : 0;
    p.armor = [0, 0, 0, 0]; p.aiming = false; p.reloading = false;
    if (typeof msg.swing === 'number' && Number.isFinite(msg.swing)) p.swing = Math.floor(msg.swing) & 0xffff;
    this.recordArenaTrack(p);

    // The void. Detected HERE rather than in the tick loop so the death lands
    // on the frame the player actually passes the plane.
    if (participant.alive && p.y < BEDWARS_VOID_Y) return this.bedwarsVoidDeath(p);
    return [];
  }

  /**
   * A player crossed the kill plane.
   *
   * Attribution is the whole reason the mode's signature kill scores: the pure
   * module resolves the last-hit window, so the rule lives in exactly one
   * place and is testable without a server.
   */
  private bedwarsVoidDeath(p: ServerPlayer): Outbound[] {
    const nowMs = this.worldTime * 1000;
    const recorded = this.bedwars.recordDeath(p.id, 0, nowMs, 'void');
    if (!recorded) return [];
    p.health = 1; p.held = 0; p.bwRespawning = true;
    p.bwCombo = 0; p.bwComboTarget = 0;
    const out: Outbound[] = [];
    const victim = recorded.snapshot.participants.find((v) => v.id === p.id)!;
    out.push({ to: p.id, msg: { t: 'bwRespawn',
      respawnAt: victim.respawnAt ?? nowMs, spectating: true } });
    const killerName = recorded.killer !== null
      ? this.players.get(recorded.killer)?.username : undefined;
    for (const id of this.bedwars.membersOf(p.id)) {
      out.push({ to: id, msg: { t: 'killfeed',
        killer: killerName ?? '', victim: p.username } });
    }
    out.push(...this.bwSnapshotOutbound(recorded.snapshot));
    out.push(...this.bwResultOutbound(recorded.snapshot));
    return out;
  }

  /**
   * Axe melee. Every branch returns [] — the handler is fail-closed at each
   * step, in the order a cheap check should come before an expensive one.
   *
   * Nothing the client sends beyond the target id is consulted. Damage comes
   * from `p.bwAxe` (the server's own record of the purchased tier) and from
   * the server's own velocity/ground state derived from `arenaTrack`.
   */
  private handleBedwarsMelee(p: ServerPlayer, targetId: number): Outbound[] {
    const nowMs = this.worldTime * 1000;
    // 1. One live match, both parties in it.
    if (!Number.isInteger(targetId) || !this.bedwars.sameMatch(p.id, targetId)) return [];
    const target = this.players.get(targetId), arena = this.bedwars.arenaFor(p.id);
    const ap = this.bedwars.participantFor(p.id), tp = this.bedwars.participantFor(targetId);
    if (!target || !arena || !ap || !tp) return [];
    // 2. No friendly fire. (Matters the moment a 2v2 map is added.)
    if (ap.team === tp.team) return [];
    // 3. Both alive, and the target's spawn shield has expired.
    if (!ap.alive || !tp.alive || (tp.shieldUntil !== undefined && tp.shieldUntil > nowMs)) return [];
    // 4. Cadence. Under the floor the swing is DROPPED, not scaled down — a
    //    macro that spams at 10x speed accomplishes nothing at all.
    const tier = bedwarsAxeTier(p.bwAxe);
    const sinceLast = nowMs - p.bwLastSwingAt;
    if (sinceLast < tier.cooldownMs * BW_SWING_FLOOR) return [];

    // 5. Range and facing, lag-compensated against the target's own history.
    const eye = { x: p.x, y: p.y + 1.6, z: p.z };
    const lookLen = Math.hypot(-Math.sin(p.yaw), -Math.cos(p.yaw)) || 1;
    const lookX = -Math.sin(p.yaw) / lookLen, lookZ = -Math.cos(p.yaw) / lookLen;
    const now = this.worldTime;
    const candidates: ArenaTrackSample[] = [{ at: now, x: target.x, y: target.y, z: target.z }];
    for (const sample of target.arenaTrack) {
      if (now - sample.at <= BW_MELEE_REWIND_S) candidates.push(sample);
    }
    let hitAt: ArenaTrackSample | null = null;
    for (const sample of candidates) {
      const cx = sample.x, cy = sample.y + 0.9, cz = sample.z;
      if (Math.hypot(cx - eye.x, cy - eye.y, cz - eye.z) > BW_MELEE_RANGE) continue;
      const hx = cx - eye.x, hz = cz - eye.z;
      const hlen = Math.hypot(hx, hz);
      if (hlen < 1e-6) { hitAt = sample; break; }
      if ((hx / hlen) * lookX + (hz / hlen) * lookZ < BW_MELEE_FACING_DOT) continue;
      hitAt = sample; break;
    }
    if (!hitAt) return [];

    // 6. Cover. You cannot swing through a wool wall.
    if (!hasBedwarsLineOfSight(eye, { x: hitAt.x, y: hitAt.y + 0.9, z: hitAt.z }, arena,
      (x, y, z) => this.bwPlacedSolid(x, y, z))) return [];

    // 7. Damage — server numbers only.
    const motion = this.bwMotionOf(p);
    const dxh = hitAt.x - p.x, dzh = hitAt.z - p.z;
    const dlen = Math.hypot(dxh, dzh) || 1;
    const combo = (p.bwComboTarget === targetId && nowMs < p.bwComboUntil) ? p.bwCombo : 0;
    const swing = bedwarsSwing({
      tier, sinceLastSwingMs: sinceLast, combo,
      onGround: motion.onGround, vy: motion.vy, speed: motion.speed,
      toTargetX: dxh / dlen, toTargetZ: dzh / dlen, lookX, lookZ,
    });

    p.bwLastSwingAt = nowMs;
    p.bwCombo = Math.min(combo + 1, 99);
    p.bwComboTarget = targetId;
    p.bwComboUntil = nowMs + BW_COMBO_WINDOW_MS;
    // Being hit breaks YOUR combo, which is what makes trading a real cost.
    target.bwCombo = 0; target.bwComboTarget = 0; target.bwComboUntil = 0;

    const dealt = Math.min(swing.damage, target.health);
    target.health = Math.max(0, target.health - swing.damage);
    const killed = target.health <= 0;
    this.bedwars.recordHit(targetId, p.id, nowMs);

    const out: Outbound[] = [
      { to: target.id, msg: { t: 'hurt', health: killed ? 1 : target.health, dead: false,
        by: p.id, kx: swing.kx, ky: swing.ky, kz: swing.kz, combat: 0 } },
      { to: p.id, msg: { t: 'bwHit', target: target.id, amount: dealt, combo: swing.combo,
        charge: swing.charge, crit: swing.crit, killed } },
    ];
    if (!killed) return out;

    target.health = 1; target.held = 0; target.bwRespawning = true;
    target.bwCombo = 0; target.bwComboTarget = 0;
    const recorded = this.bedwars.recordDeath(target.id, p.id, nowMs, 'melee');
    if (!recorded) return out;
    const dead = recorded.snapshot.participants.find((v) => v.id === target.id)!;
    out.push({ to: target.id, msg: { t: 'bwRespawn',
      respawnAt: dead.respawnAt ?? nowMs, spectating: true } });
    for (const id of this.bedwars.membersOf(p.id)) {
      out.push({ to: id, msg: { t: 'killfeed', killer: p.username, victim: target.username } });
    }
    out.push(...this.bwSnapshotOutbound(recorded.snapshot));
    out.push(...this.bwResultOutbound(recorded.snapshot));
    return out;
  }

  /** Server-derived motion, from the position history the server itself
   *  accepted. Never from anything the client asserts. */
  private bwMotionOf(p: ServerPlayer): { vy: number; speed: number; onGround: boolean } {
    const track = p.arenaTrack;
    const last = track[track.length - 1], prev = track[track.length - 2];
    let vy = 0, speed = 0;
    if (last && prev) {
      const dt = Math.max(1e-3, last.at - prev.at);
      vy = (last.y - prev.y) / Math.max(1, dt * 20); // per-tick, matching the client
      speed = Math.hypot(last.x - prev.x, last.z - prev.z) / dt;
    }
    const arena = this.bedwars.arenaFor(p.id);
    const onGround = !arena ? true
      : bedwarsSolidAt(p.x, p.y - 0.1, p.z, arena) || this.bwPlacedSolid(p.x, p.y - 0.1, p.z);
    return { vy, speed, onGround };
  }

  /**
   * Break an enemy bed.
   *
   * Beds are `hardness: -1`, so the ordinary mining path can never touch one.
   * This branch is the only thing in the codebase that may destroy a bed, and
   * it refuses your own team's.
   */
  private handleBedwarsBed(p: ServerPlayer, x: number, y: number, z: number): Outbound[] {
    const arena = this.bedwars.arenaFor(p.id), ap = this.bedwars.participantFor(p.id);
    const nowMs = this.worldTime * 1000;
    if (!arena || !ap?.alive || this.bedwars.phaseFor(p.id) !== 'running') return [];
    if (!fin(x, y, z)) return [];
    const team = bedwarsBedTeamAt(x, y, z, arena);
    if (team < 0 || team === ap.team) return [];
    const eye = { x: p.x, y: p.y + 1.6, z: p.z };
    const cell = { x: Math.floor(x) + 0.5, y: Math.floor(y) + 0.5, z: Math.floor(z) + 0.5 };
    if (Math.hypot(cell.x - eye.x, cell.y - eye.y, cell.z - eye.z) > BW_MELEE_RANGE) return [];
    const lookX = -Math.sin(p.yaw), lookZ = -Math.cos(p.yaw);
    const hx = cell.x - eye.x, hz = cell.z - eye.z, hlen = Math.hypot(hx, hz);
    if (hlen > 1e-6 && (hx / hlen) * lookX + (hz / hlen) * lookZ < BW_MELEE_FACING_DOT) return [];
    if (!hasBedwarsLineOfSight(eye, cell, arena, (bx, by, bz) => {
      // The bed's own cells must not count as cover against breaking it.
      if (bedwarsBedTeamAt(bx, by, bz, arena) === team) return false;
      return this.bwPlacedSolid(bx, by, bz);
    })) return [];

    const broke = this.bedwars.breakBed(p.id, team, nowMs);
    if (!broke) return [];
    const out: Outbound[] = [];
    for (const id of this.bedwars.membersOf(p.id)) {
      out.push({ to: id, msg: { t: 'bwBedBroken', team, by: p.id } });
    }
    out.push(...this.bwSnapshotOutbound(broke.snapshot));
    out.push(...this.bwResultOutbound(broke.snapshot));
    return out;
  }

  /** Right-click the Quartermaster. Validated: alive, running, and standing at
   *  a shop cell belonging to YOUR OWN team. */
  private handleBedwarsShopBuy(p: ServerPlayer, entry: number): Outbound[] {
    const arena = this.bedwars.arenaFor(p.id), ap = this.bedwars.participantFor(p.id);
    if (!arena || !ap?.alive || this.bedwars.phaseFor(p.id) !== 'running') return [];
    const shopEntry = bedwarsShopEntry(entry);
    if (!shopEntry) return [];
    const near = bedwarsShopCells(arena, ap.team).some((c) =>
      Math.hypot(c.x + 0.5 - p.x, c.y - p.y, c.z + 0.5 - p.z) <= 4.5);
    if (!near) return this.bwError(p.id, 'too_far');
    if (!this.bedwars.spendResources(p.id, shopEntry.cost)) {
      return this.bwError(p.id, 'cannot_afford');
    }
    const out: Outbound[] = [];
    if (shopEntry.axe !== undefined) {
      this.bedwars.setAxe(p.id, shopEntry.axe);
      p.bwAxe = this.bedwars.participantFor(p.id)?.axe ?? p.bwAxe;
      out.push(this.bwLoadout(p, ap.team));
    } else {
      const stacks: ItemStack[] = shopEntry.teamBlock !== undefined
        ? [{ id: bedwarsTeamWool(ap.team), count: shopEntry.teamBlock }]
        : (shopEntry.grants ?? []).map((g) => ({ id: g.id, count: g.count }));
      out.push({ to: p.id, msg: { t: 'bwGrant', items: stacks } });
    }
    out.push(...this.bwResourcesOutbound(p.id));
    out.push(...this.bwSnapshotOutbound(this.bedwars.snapshotFor(p.id, this.worldTime * 1000)!));
    return out;
  }

  private handleBedwarsHeal(p: ServerPlayer, item: number): Outbound[] {
    const participant = this.bedwars.participantFor(p.id);
    if (item !== Item.Bandage || !participant?.alive ||
        this.bedwars.phaseFor(p.id) !== 'running' || p.health >= BEDWARS_MAX_HEALTH) return [];
    const heal = ITEMS[Item.Bandage].heal;
    if (!heal) return [];
    p.regenBoostTimer = heal.duration; p.regenBoostInterval = heal.interval; p.regenTimer = 0;
    return [];
  }

  /**
   * Arena building. Only the mode's own materials, only above the island
   * surface, only below the ceiling — and breaking is limited to blocks a
   * PLAYER placed, so no authored geometry (and no bed) can be mined away.
   */
  private handleBedwarsEdit(
    p: ServerPlayer, x: number, y: number, z: number, block: number,
  ): Outbound[] {
    const arena = this.bedwars.arenaFor(p.id), ap = this.bedwars.participantFor(p.id);
    if (!arena || !ap?.alive || this.bedwars.phaseFor(p.id) !== 'running') return [];
    if (!fin(x, y, z) || !fin(p.x, p.y, p.z)) return [];
    const bx = Math.floor(x), by = Math.floor(y), bz = Math.floor(z);
    if (bx < arena.minX || bx >= arena.maxX || bz < arena.minZ || bz >= arena.maxZ) return [];
    if (by <= BEDWARS_VOID_Y || by >= BEDWARS_CEILING_Y) return [];
    if (Math.hypot(bx + 0.5 - p.x, by + 0.5 - p.y, bz + 0.5 - p.z) > EDIT_RANGE) return [];

    const key = `${bx},${by},${bz}`;
    const placeable = new Set<number>([
      bedwarsTeamWool(ap.team), Block.OakPlanks, Block.Glass,
    ]);
    let slotEdits = this.arenaEdits.get(`bedwars:${arena.slot}`);
    if (!slotEdits) {
      slotEdits = new Map<string, number>();
      this.arenaEdits.set(`bedwars:${arena.slot}`, slotEdits);
    }

    if (block === Block.Air) {
      // Breaking: only ever a block someone placed this match. Authored island,
      // fixtures and beds are all untouchable here by construction.
      if (!slotEdits.has(key)) return [];
      slotEdits.delete(key);
      this.edits.set(key, Block.Air);
      return this.bedwars.membersOf(p.id).map((id) => ({
        to: id, msg: { t: 'edit', x: bx, y: by, z: bz, block: Block.Air },
      }));
    }
    if (!placeable.has(block)) return [];
    // Never overwrite authored geometry, and never stack into an occupied cell.
    if (bedwarsBlockAt(bx, by, bz) !== null) return [];
    const existing = this.edits.get(key);
    if (existing !== undefined && existing !== Block.Air) return [];
    slotEdits.set(key, block);
    this.edits.set(key, block);
    return this.bedwars.membersOf(p.id).map((id) => ({
      to: id, msg: { t: 'edit', x: bx, y: by, z: bz, block },
    }));
  }

  private removeFromBwQueue(id: number): boolean {
    const before = this.bwQueue.length;
    this.bwQueue = this.bwQueue.filter((queuedId) => queuedId !== id);
    return this.bwQueue.length !== before;
  }

  private handleBedwarsLobby(p: ServerPlayer, msg: Extract<ClientMsg, { t: `bw${string}` }>): Outbound[] {
    const now = this.worldTime * 1000;
    switch (msg.t) {
      case 'bwCreate': {
        this.removeFromBwQueue(p.id);
        const result = this.bedwars.create({ id: p.id, username: p.username, skin: p.skin }, now);
        if ('reason' in result) return this.bwError(p.id, result.reason);
        return [
          { to: p.id, msg: { t: 'bwQueue', queued: false } },
          ...this.bwSnapshotOutbound(result.snapshot, { id: p.id, token: result.token }),
        ];
      }
      case 'bwQueue': {
        if (!msg.join) {
          this.removeFromBwQueue(p.id);
          return [{ to: p.id, msg: { t: 'bwQueue', queued: false } }];
        }
        if (this.bedwars.phaseFor(p.id)) return this.bwError(p.id, 'already_in_lobby');
        if (!this.bwQueue.includes(p.id)) this.bwQueue.push(p.id);
        const out: Outbound[] = [{ to: p.id, msg: { t: 'bwQueue', queued: true } }];
        // Pair the two longest-waiting players into a fresh private lobby.
        while (this.bwQueue.length >= 2) {
          const [aId, bId] = this.bwQueue.splice(0, 2);
          const a = this.players.get(aId), b = this.players.get(bId);
          if (!a || !b) continue;
          const made = this.bedwars.create({ id: a.id, username: a.username, skin: a.skin }, now);
          if ('reason' in made) continue;
          const joined = this.bedwars.join(made.token,
            { id: b.id, username: b.username, skin: b.skin }, now);
          if (!joined.ok) continue;
          this.bedwars.setReady(a.id, true, now);
          const ready = this.bedwars.setReady(b.id, true, now);
          out.push({ to: a.id, msg: { t: 'bwQueue', queued: false } });
          out.push({ to: b.id, msg: { t: 'bwQueue', queued: false } });
          if (ready) out.push(...this.bwSnapshotOutbound(ready));
        }
        return out;
      }
      case 'bwJoin': {
        if (typeof msg.token !== 'string') return this.bwError(p.id, 'invalid');
        this.removeFromBwQueue(p.id);
        const result = this.bedwars.join(msg.token,
          { id: p.id, username: p.username, skin: p.skin }, now);
        if (!result.ok) return this.bwError(p.id, result.reason);
        return this.bwSnapshotOutbound(result.snapshot);
      }
      case 'bwLeave': {
        if (this.removeFromBwQueue(p.id) && !this.bedwars.phaseFor(p.id)) {
          return [{ to: p.id, msg: { t: 'bwQueue', queued: false } }];
        }
        const oldPhase = this.bedwars.phaseFor(p.id);
        const oldArena = this.bedwars.arenaFor(p.id);
        const result = this.bedwars.leave(p.id, now);
        const out = result.snapshot ? this.bwSnapshotOutbound(result.snapshot) : [];
        if (result.deleted && oldArena) out.push(...this.resetBedwarsArenaEdits(oldArena));
        if (oldPhase && oldPhase !== 'lobby') {
          out.push(...this.restoreOpenWorldState(p));
          out.push(...this.announceWorldScope([p.id]));
        }
        if (result.snapshot?.phase === 'lobby') out.push(...this.restoreBedwarsLobby(result.snapshot));
        if (result.snapshot) out.push(...this.bwResultOutbound(result.snapshot));
        return out;
      }
      case 'bwReady': {
        const snap = this.bedwars.setReady(p.id, msg.ready === true, now);
        return snap ? this.bwSnapshotOutbound(snap) : this.bwError(p.id, 'not_in_lobby');
      }
      case 'bwStart': {
        const result = this.bedwars.start(p.id, now);
        if (!result.ok) return this.bwError(p.id, result.reason);
        return this.launchBedwars(result.snapshot);
      }
      case 'bwArenaReady': {
        const snap = this.bedwars.markArenaReady(p.id, now);
        return snap ? this.bwSnapshotOutbound(snap) : [];
      }
      default:
        return [];
    }
  }

  /**
   * One Bedwars server tick: phase transitions, respawns, and the resource
   * generators.
   *
   * Generators are pure counters. `itemspawn`/`itemsmove` are world-broadcast
   * and gated only by `receivesWorldBroadcast`, so real item entities would be
   * visible to the open world; counters sidestep that entirely and make the
   * shop trivially server-authoritative.
   */
  tickBedwars(dt: number): Outbound[] {
    const out: Outbound[] = [];
    const nowMs = this.worldTime * 1000;

    for (const snap of this.bedwars.tick(nowMs)) {
      out.push(...this.bwSnapshotOutbound(snap));
      if (snap.phase === 'lobby') out.push(...this.restoreBedwarsLobby(snap));
      if (snap.phase === 'results') this.bwDiamondNextAt.delete(snap.id);
      if (snap.phase === 'running' && snap.arena) {
        for (const participant of snap.participants) {
          const p = this.players.get(participant.id);
          if (!p) continue;
          if (!p.bwRespawning || !participant.alive) continue;
          const spawn = snap.arena.spawns.find((s) => s.team === participant.team) ?? snap.arena.spawns[0];
          p.x = spawn.x; p.y = spawn.y; p.z = spawn.z; p.yaw = spawn.yaw;
          p.health = BEDWARS_MAX_HEALTH;
          // The purchased tier survives death — that is what makes a Void
          // Cleaver worth four diamonds.
          p.bwAxe = participant.axe; p.held = participant.axe;
          p.bwRespawning = false; p.bwCombo = 0; p.bwComboTarget = 0;
          p.bwLastSwingAt = -Infinity;
          p.arenaTrack = []; this.recordArenaTrack(p);
          out.push(this.bwLoadout(p, participant.team));
          out.push({ to: p.id, msg: { t: 'respawned',
            x: spawn.x, y: spawn.y, z: spawn.z, health: BEDWARS_MAX_HEALTH } });
          out.push({ to: p.id, msg: { t: 'bwRespawn', respawnAt: 0, spectating: false } });
        }
      }
      out.push(...this.bwResultOutbound(snap));
    }

    for (const snap of this.bedwars.snapshots(nowMs)) {
      if (snap.phase !== 'running' || !snap.arena) continue;
      out.push(...this.tickBedwarsGenerators(snap, nowMs, Math.max(0, dt) * 1000));
      if (this.worldTime >= this.duelClockNextAt) {
        for (const participant of snap.participants) {
          out.push({ to: participant.id, msg: { t: 'bwClock',
            serverNow: nowMs, endsAt: snap.endsAt ?? nowMs, stage: snap.stage } });
        }
      }
    }
    return out;
  }

  private tickBedwarsGenerators(snap: BwLobbySnapshot, nowMs: number, dtMs: number): Outbound[] {
    const arena = snap.arena;
    if (!arena) return [];
    const out: Outbound[] = [];

    const gens = bedwarsGenCells(arena);
    const changed = new Set<number>();

    // Team generators credit their own team, whether or not anybody is
    // standing there — a base keeps earning while its owner fights at mid.
    for (const participant of snap.participants) {
      if (!participant.connected) continue;
      const p = this.players.get(participant.id);
      if (!p) continue;
      if (!gens.some((g) => !g.diamond && g.team === participant.team)) continue;
      p.bwIronAccum += dtMs;
      p.bwGoldAccum += dtMs;
      let iron = 0, gold = 0;
      while (p.bwIronAccum >= BW_GEN_IRON_MS) { p.bwIronAccum -= BW_GEN_IRON_MS; iron++; }
      while (p.bwGoldAccum >= BW_GEN_GOLD_MS) { p.bwGoldAccum -= BW_GEN_GOLD_MS; gold++; }
      if (iron || gold) {
        this.bedwars.grantResources(participant.id, { iron, gold });
        changed.add(participant.id);
      }
    }

    // The diamond generator credits EVERY player standing near it at the tick,
    // so contesting mid is the point rather than a race to a pickup.
    const elapsed = nowMs - (snap.startedAt ?? nowMs);
    const period = bedwarsDiamondPeriod(elapsed);
    const next = this.bwDiamondNextAt.get(snap.id) ?? (nowMs + period);
    if (nowMs >= next) {
      this.bwDiamondNextAt.set(snap.id, nowMs + period);
      for (const gen of gens.filter((g) => g.diamond)) {
        for (const participant of snap.participants) {
          if (!participant.alive) continue;
          const p = this.players.get(participant.id);
          if (!p) continue;
          if (Math.hypot(p.x - gen.x, p.z - gen.z) > BW_PICKUP_RADIUS) continue;
          if (Math.abs(p.y - gen.y) > BW_PICKUP_RADIUS) continue;
          this.bedwars.grantResources(participant.id, { diamond: 1 });
          changed.add(participant.id);
        }
      }
    } else {
      this.bwDiamondNextAt.set(snap.id, next);
    }

    for (const id of changed) out.push(...this.bwResourcesOutbound(id));
    return out;
  }

  tickDuels(): Outbound[] {
    const out: Outbound[] = [];
    const nowMs = this.worldTime * 1000;
    for (const snap of this.duels.tick(nowMs)) {
      out.push(...this.duelSnapshotOutbound(snap));
      if (snap.phase === 'lobby') out.push(...this.restoreDuelLobby(snap));
      if (snap.phase === 'running' || snap.phase === 'sudden_death') {
        const arena = snap.arena;
        for (const participant of snap.participants) {
          const p = this.players.get(participant.id);
          if (!p || !arena) continue;
          if (snap.phase === 'sudden_death' && participant.spectating) {
            p.health = 1; p.held = 0; p.duelRespawning = false; p.duelShotTickets = [];
            out.push({ to: p.id, msg: { t: 'duelRespawn', respawnAt: 0, spectating: true } });
            continue;
          }
          if (!p.duelRespawning || !participant.alive) continue;
          const living = snap.participants.filter((v) => v.alive && v.id !== p.id)
            .map((v) => this.players.get(v.id)).filter((v): v is ServerPlayer => !!v)
            .map((v) => ({ x: v.x, y: v.y, z: v.z }));
          p.duelSpawnIndex = safestDuelSpawn(arena, living, p.duelSpawnIndex);
          const spawn = arena.spawns[p.duelSpawnIndex];
          p.x = spawn.x; p.y = spawn.y; p.z = spawn.z; p.health = DUEL_MAX_HEALTH; p.held = Item.BurstRifle;
          p.duelMedkits = 5; p.duelRespawning = false; p.duelShotTickets = [];
          p.duelLoaded = 24; p.duelReloadUntil = 0; p.duelBurstShots = 0;
          p.duelNextBurstAt = 0; p.duelLastShotAt = -Infinity; p.reloading = false;
          p.arenaTrack = []; this.recordArenaTrack(p);
          out.push(this.duelLoadout(p.id));
          out.push({ to: p.id, msg: { t: 'respawned', x: spawn.x, y: spawn.y, z: spawn.z, health: DUEL_MAX_HEALTH } });
          out.push({ to: p.id, msg: { t: 'duelRespawn', respawnAt: 0, spectating: false } });
        }
      }
      out.push(...this.duelResultOutbound(snap));
    }
    if (this.worldTime >= this.duelClockNextAt) {
      this.duelClockNextAt = this.worldTime + 1;
      for (const snap of this.duels.snapshots(nowMs)) {
        if (snap.phase !== 'countdown' && snap.phase !== 'running' && snap.phase !== 'sudden_death') continue;
        const endsAt = snap.phase === 'countdown'
          ? (snap.countdownEndsAt ?? nowMs)
          : (snap.endsAt ?? nowMs);
        for (const p of snap.participants) out.push({ to: p.id, msg: {
          t: 'duelClock', serverNow: nowMs, endsAt, suddenDeath: snap.phase === 'sudden_death',
        } });
      }
    }
    return out;
  }

  duelInviteInfo(token: string): { host: string; lobbyId: string } | null {
    return typeof token === 'string' && token.length <= 128 ? this.duels.inviteInfo(token) : null;
  }

  // --- Vaults (Milestone D) ----------------------------------------------------

  /** Cached deterministic vault stamp for an anchor chunk (or null). */
  private vaultStampAt(cx: number, cz: number): VaultStamp | null {
    const key = `${cx},${cz}`;
    let st = this.vaultStamps.get(key);
    if (st === undefined) {
      st = vaultStamp(this.seed, cx, cz, this.terrain);
      this.vaultStamps.set(key, st);
    }
    return st;
  }

  /** The vault's server state (created lazily; Brute lazily respawns after
   *  VAULT_RECHARGE — the server never ticks vaults, mobs are client-side). */
  private ensureVault(st: VaultStamp): VaultServerState {
    const key = `${st.cx},${st.cz}`;
    let v = this.vaults.get(key);
    if (!v) {
      v = newVaultState(st.tier);
      v.hp = bossMaxHp(st.tier, st.bossKind);
      this.vaults.set(key, v);
    }
    refreshVaultState(v, this.worldTime);
    // Partial fights are never persistent. Outside a live attempt, any living
    // record represents an idle full-health boss (including migrated saves).
    if (v.hp > 0 && !this.vaultEncounters.has(key)) {
      v.hp = bossMaxHp(st.tier, st.bossKind);
    }
    return v;
  }

  private playerInArena(p: ServerPlayer, st: VaultStamp): boolean {
    const b = st.arena.bounds;
    return p.x >= b.minX && p.x <= b.maxX && p.y >= b.minY && p.y <= b.maxY &&
      p.z >= b.minZ && p.z <= b.maxZ;
  }

  private blockInArena(x: number, y: number, z: number, st: VaultStamp): boolean {
    const b = st.arena.bounds;
    return x + 0.5 >= b.minX && x + 0.5 <= b.maxX &&
      y + 0.5 >= b.minY && y + 0.5 <= b.maxY &&
      z + 0.5 >= b.minZ && z + 0.5 <= b.maxZ;
  }

  private liveEncounterForPlacement(
    p: ServerPlayer, x: number, y: number, z: number,
  ): ActiveVaultEncounter | null {
    for (const active of this.vaultEncounters.values()) {
      if (active.engine.participants.has(p.id) && this.blockInArena(x, y, z, active.stamp)) {
        return active;
      }
    }
    return null;
  }

  /** Restore only cells still containing the block registered to this owner. */
  private cleanupArenaPlacements(active: ActiveVaultEncounter, owner?: number): Outbound[] {
    const out: Outbound[] = [];
    for (const [key, placed] of [...active.placedBlocks]) {
      if (owner !== undefined && placed.owner !== owner) continue;
      active.placedBlocks.delete(key);
      if (this.edits.get(key) !== placed.block) continue;
      if (placed.previousEdit === undefined) this.edits.delete(key);
      else this.edits.set(key, placed.previousEdit);
      this.chests.delete(key);
      this.machines.delete(key);
      this.turrets.delete(key);
      const [x, y, z] = key.split(',').map(Number);
      out.push({ to: 'all', msg: { t: 'edit', x, y, z, block: placed.restoreBlock } });
    }
    return out;
  }

  private cleanupPlayerArenaPlacements(owner: number): Outbound[] {
    const out: Outbound[] = [];
    for (const active of this.vaultEncounters.values()) {
      out.push(...this.cleanupArenaPlacements(active, owner));
    }
    return out;
  }

  private ensureEncounter(st: VaultStamp, starter: ServerPlayer): ActiveVaultEncounter {
    const key = `${st.cx},${st.cz}`;
    const current = this.vaultEncounters.get(key);
    if (current && current.engine.status !== 'victory' && current.engine.status !== 'cooldown') {
      current.engine.join(starter.id);
      return current;
    }
    const bossRoom = st.rooms.find((r) => r.kind === 'boss')!;
    const passable = (p: { x: number; y: number; z: number }): boolean => {
      const edit = this.edits.get(`${Math.floor(p.x)},${Math.floor(p.y)},${Math.floor(p.z)}`);
      return edit === undefined || !BLOCKS[edit]?.solid;
    };
    const sockets = st.arena.sockets.filter(passable);
    for (const fallback of st.arena.safeLanes) {
      if (sockets.length >= 4) break;
      if (passable(fallback)) sockets.push(fallback);
    }
    if (!sockets.length) sockets.push({ x: bossRoom.x, y: bossRoom.y, z: bossRoom.z });
    const attempt = `${st.cx}:${st.cz}:${Math.floor(this.worldTime * 20)}:${++this.encounterSerial}`;
    const engine = new VaultEncounter({
      encounterId: attempt,
      seed: (this.seed ^ Math.imul(st.cx, 0x85ebca77) ^
        Math.imul(st.cz, 0xc2b2ae3d) ^ this.encounterSerial) >>> 0,
      tier: st.tier, kind: st.bossKind, family: st.family,
      // Block CENTRE, matching the offline adapter: a boss standing on the
      // corner of its middle block is half a block off in every hazard origin.
      center: { x: bossRoom.x + 0.5, y: bossRoom.y, z: bossRoom.z + 0.5 },
      bounds: { ...st.arena.bounds }, sockets,
      cameraAnchors: st.arena.cameraAnchors, seal: st.arena.seal,
      startTime: this.worldTime,
    });
    const authoredBlocks = new Map<string, number>();
    for (const b of st.blocks) {
      if (this.blockInArena(b.x, b.y, b.z, st)) {
        authoredBlocks.set(`${b.x},${b.y},${b.z}`, b.id);
      }
    }
    const active: ActiveVaultEncounter = {
      stamp: st, engine, snapshotAccum: 0, credited: starter.username,
      names: new Map([[starter.id, starter.username]]),
      observers: new Set(starter.mode === 'survival' ? [] : [starter.id]),
      authoredBlocks, placedBlocks: new Map(),
    };
    this.vaultEncounters.set(key, active);
    return active;
  }

  /** Validated attack intent. Numeric client damage is never trusted directly. */
  private handleVaultAttack(
    p: ServerPlayer, cx: number, cz: number, intent: VaultAttackIntent,
  ): Outbound[] {
    if (p.dead || !fin(cx, cz, p.x, p.y, p.z) || !intent || typeof intent !== 'object') return [];
    const st = this.vaultStampAt(Math.floor(cx), Math.floor(cz));
    if (!st) return [];
    const active = this.vaultEncounters.get(`${st.cx},${st.cz}`);
    if (!active || active.engine.config.encounterId !== intent.encounterId) return [];
    const held = ITEMS[p.held];
    let source: VaultAttackIntent['source'] | null = null;
    let maxDamage = 0, range = 0, cadence = 0;
    if (held?.gun) {
      source = held.gun.rocket ? 'rocket' : 'bullet';
      const volley = gunVolley(held.gun);
      maxDamage = volley.perHit;   // one projectile, not the whole volley
      range = Math.min(RANGED_MAX_RANGE, held.gun.range);
      cadence = volley.cadence;    // the cooldown, budgeted across the volley
    } else if (p.held === Item.Sword || p.held === 0) {
      source = 'melee'; maxDamage = p.held === Item.Sword ? 7 : 4; range = 4; cadence = 0.32;
    } else if (gadgetOf(p.held)) {
      source = 'gadget'; maxDamage = Math.min(30, gadgetOf(p.held)?.damage ?? 8);
      range = 24; cadence = 0.8;
    }
    const attacker: EncounterParticipant = {
      id: p.id, position: { x: p.x, y: p.y, z: p.z },
      alive: !p.dead, inside: this.playerInArena(p, st),
    };
    const result = active.engine.attack(intent, attacker, {
      heldSource: source, maxDamage, range, cadence, now: this.worldTime,
    });
    if (!result.accepted) return [];
    active.credited = p.username;
    this.noteEncounterPresence(active, p);
    const v = this.ensureVault(st);
    v.hp = active.engine.hp;
    const out: Outbound[] = [{ to: 'all', msg: {
      t: 'encounterSnapshot', cx: st.cx, cz: st.cz, snapshot: active.engine.snapshot(),
    } }];
    if (result.killed && active.engine.status === 'victory') {
      out.push(...this.finishVaultEncounter(active, p.username));
    }
    return out;
  }

  // --- WARFARE COMMAND: vehicle authority ------------------------------------

  private handleHeliSpawn(p: ServerPlayer, x: number, y: number, z: number): Outbound[] {
    if (!this.nearMachine(p, x, y, z)) return [];
    const bx = Math.floor(x), by = Math.floor(y), bz = Math.floor(z);
    if (this.edits.get(`${bx},${by},${bz}`) !== Block.Helipad) return [];
    if (!this.hasBlueprint(p, Item.HelicopterKit)) {
      return [{ to: p.id, msg: { t: 'warfareErr',
        reason: 'Flight Certification is not authorized.' } }];
    }
    const tier = Math.max(1, warfareTier(this.warfareOf(p.username), 'helicopter'));
    this.vehicles.spawn(p.username, p.faction, { x: bx, y: by, z: bz }, tier);
    return this.heliBroadcast();
  }

  /**
   * Field-assemble an airframe from a carried kit, no helipad required.
   *
   * A helipad used to be the ONLY way to get airborne, which meant carrying and
   * placing a second structure every single time you wanted to fly. The kit is
   * still the expensive part; all a pad buys you now is a tidy place to park.
   * The landing spot must be real ground with room overhead, so this cannot be
   * used to conjure an aircraft inside a wall or on top of someone's roof line.
   */
  private handleHeliDeploy(p: ServerPlayer, x: number, y: number, z: number): Outbound[] {
    if (!fin(x, y, z)) return [];
    const bx = Math.floor(x), by = Math.floor(y), bz = Math.floor(z);
    if (Math.hypot(p.x - (bx + 0.5), p.y - by, p.z - (bz + 0.5)) > EDIT_RANGE + 2) return [];
    if (!this.hasBlueprint(p, Item.HelicopterKit)) {
      return [{ to: p.id, msg: { t: 'warfareErr',
        reason: 'Flight Certification is not authorized.' } }];
    }
    // Solid footing directly under the deploy cell, and a clear column above it.
    if (!this.solidAt(bx + 0.5, by - 0.5, bz + 0.5)) {
      return [{ to: p.id, msg: { t: 'warfareErr',
        reason: 'Assemble the airframe on solid, level ground.' } }];
    }
    for (let dy = 0; dy <= 3; dy++) {
      for (const [dx, dz] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
        if (this.solidAt(bx + 0.5 + dx, by + 0.5 + dy, bz + 0.5 + dz)) {
          return [{ to: p.id, msg: { t: 'warfareErr',
            reason: 'Not enough clearance for the rotor here.' } }];
        }
      }
    }
    if (this.insideAnyVaultArena(bx + 0.5, by + 1, bz + 0.5)) {
      return [{ to: p.id, msg: { t: 'warfareErr', reason: 'No flying inside a vault.' } }];
    }
    const tier = Math.max(1, warfareTier(this.warfareOf(p.username), 'helicopter'));
    this.vehicles.spawn(p.username, p.faction, { x: bx, y: by, z: bz }, tier);
    return this.heliBroadcast();
  }

  private heliBroadcast(): Outbound[] {
    return [{ to: 'all', msg: {
      t: 'helis', list: this.vehicles.snapshot(), bombs: this.vehicles.bombSnapshots(),
    } }];
  }

  private applyVehicleEvents(events: readonly VehicleEvent[]): Outbound[] {
    const out: Outbound[] = [];
    for (const ev of events) {
      switch (ev.kind) {
        case 'bombRelease':
          out.push(...this.heliBroadcast());
          break;
        case 'bombImpact':
          out.push(...this.applyBlast(ev.faction, { x: ev.x, y: ev.y, z: ev.z },
            ev.radius, ev.playerDamage, ev.hardwareDamage, ev.blockCap, true));
          out.push({ to: 'all', msg: { t: 'gadgetFx', kind: 'frag', x: ev.x, y: ev.y, z: ev.z } });
          break;
        case 'heliDown':
          out.push({ to: 'all', msg: { t: 'heliDown', id: ev.id,
            x: ev.x, y: ev.y, z: ev.z, faction: ev.faction, reason: ev.reason } });
          break;
        case 'eject': {
          const victim = this.players.get(ev.playerId);
          out.push({ to: ev.playerId, msg: { t: 'heliSeat', id: 0, seat: null } });
          // `ejected` rather than `teleport`: the crew is THROWN clear along the
          // airframe's momentum, so a crash launches you instead of politely
          // setting you down where the wreck used to be.
          out.push({ to: ev.playerId, msg: { t: 'ejected',
            x: ev.x, y: ev.y, z: ev.z, vx: ev.vx, vy: ev.vy, vz: ev.vz, reason: ev.reason } });
          if (victim) {
            victim.x = ev.x; victim.y = ev.y; victim.z = ev.z;
            out.push(...this.applyDamage(victim, ev.damage, -1));
          }
          break;
        }
        case 'heliRemoved':
          out.push({ to: 'all', msg: { t: 'heliGone', id: ev.id } });
          break;
      }
    }
    return out;
  }

  /**
   * The shared explosion profile for every piece of ordnance.
   *
   * Enemies and enemy hardware take LINEAR-falloff damage, applied exactly once
   * per target. Friendly players and friendly hardware are immune. Only a
   * bounded number of player-PLACED, destructible blocks are removed — natural
   * terrain is never permanently excavated, so a war can't erase the map.
   * No lifesteal credit is taken from an explosion.
   */
  private applyBlast(
    faction: number, at: { x: number; y: number; z: number },
    radius: number, playerDamage: number, hardwareDamage: number, blockCap: number,
    breakNatural = false,
  ): Outbound[] {
    const out: Outbound[] = [];
    for (const victim of this.players.values()) {
      if (victim.dead || victim.mode !== 'survival' || victim.arenaSaved) continue;
      if (sameFaction(victim.faction, faction)) continue;   // friendly fire is off
      const dmg = blastAt(at, { x: victim.x, y: victim.y, z: victim.z }, radius, playerDamage);
      // Pass the RAW blast figure: applyDamage runs armor mitigation itself, so
      // mitigating here as well would halve every payload twice over.
      // `-1` attacker: an explosion is never a lifesteal kill credit.
      if (dmg > 0) out.push(...this.applyDamage(victim, dmg, -1));
    }
    for (const h of [...this.vehicles.helicopters.values()]) {
      if (sameFaction(h.faction, faction) || h.dying > 0) continue;
      const dmg = bombBlast(at, h.position, radius, hardwareDamage);
      if (dmg > 0) out.push(...this.applyVehicleEvents(this.vehicles.damage(h.id, dmg)));
    }
    out.push(...this.blastBlocks(at, radius, blockCap, breakNatural));
    return out;
  }

  /** Remove up to `cap` destructible blocks around an impact. */
  private blastBlocks(
    at: { x: number; y: number; z: number }, radius: number, cap: number,
    breakNatural = false,
  ): Outbound[] {
    const out: Outbound[] = [];
    const edits: { x: number; y: number; z: number; block: number }[] = [];
    let removed = 0;
    const candidates = blastBlockCandidates(at.x, at.y, at.z, radius);
    const natural = breakNatural ? this.terrain.blocksAtCells(candidates) : [];
    for (let i = 0; i < candidates.length; i++) {
      const c = candidates[i];
      if (removed >= cap) break;
      const key = `${c.x},${c.y},${c.z}`;
      const edited = this.edits.get(key);
      const block = edited ?? (breakNatural ? natural[i] : undefined);
      // Helicopter bombs may crater natural terrain, but air, indestructible
      // masonry and block-entity anchors are still protected here.
      if (block === undefined || block === Block.Air) continue;
      const info = BLOCKS[block];
      if (!info || info.hardness < 0) continue;
      if (isVaultMasonry(block) || block === Block.Core) continue;
      this.edits.set(key, Block.Air);
      edits.push({ x: c.x, y: c.y, z: c.z, block: Block.Air });
      removed++;
    }
    if (edits.length) out.push({ to: 'all', msg: { t: 'editBatch', edits } });
    return out;
  }

  /** Fixed-step vehicle tick. The WS shell calls this at 20 Hz. */
  tickWarfare(dt: number): Outbound[] {
    if (!fin(dt) || dt <= 0) return [];
    const out = this.applyVehicleEvents(this.vehicles.tick(dt));
    for (const p of this.players.values()) {
      if (p.arenaSaved) continue;
      const rider = this.vehicles.ropeRider(p.id);
      const at = rider ? this.vehicles.ropePosition(p.id) : null;
      if (rider && at) {
        p.x = at.x; p.y = at.y; p.z = at.z;
        p.seated = false; p.gliding = false; p.boating = false;
        this.ropePlayers.add(p.id);
        out.push({ to: p.id, msg: { t: 'heliRopeState', id: rider.heliId,
          progress: rider.progress } });
      } else if (this.ropePlayers.delete(p.id)) {
        out.push({ to: p.id, msg: { t: 'heliRopeState', id: 0, progress: 0 } });
      }
    }
    // Aircraft go out on EVERY tick (20 Hz). A helicopter carries the camera of
    // whoever is flying it, so its update rate is a framerate as far as that
    // player is concerned — at 10 Hz the client had to invent a tenth of a
    // second of motion between packets and the ride felt like a slideshow. The
    // payload is a handful of small poses and only exists while something is
    // airborne.
    if (this.vehicles.helicopters.size || this.vehicles.bombs.size) {
      out.push(...this.heliBroadcast());
    }
    return out;
  }

  /** Remember who this runtime id belongs to, and whether they were ever a
   *  non-survival observer during the attempt. */
  private noteEncounterPresence(active: ActiveVaultEncounter, p: ServerPlayer): void {
    active.names.set(p.id, p.username);
    if (p.mode !== 'survival') active.observers.add(p.id);
  }

  /**
   * WARFARE XP SETTLEMENT — the only source of warfare XP in the whole game.
   *
   * Every qualifying participant is paid the tier's full award independently;
   * it is never divided by party size. Qualification runs off the encounter
   * engine's own ledger (damage it ACCEPTED, time spent in an active fight), so
   * a player who died just before the kill still gets paid and a player who
   * walked in at the end gets nothing. Payment is recorded against the vault's
   * current recharge cycle, so one kill can only ever pay an account once.
   */
  private settleWarfare(
    active: ActiveVaultEncounter, v: VaultServerState, elapsed: number,
  ): Outbound[] {
    const st = active.stamp;
    const ledger: ContributionRecord[] = [];
    for (const [id, row] of active.engine.ledger) {
      const username = active.names.get(id);
      if (!username) continue; // never seen as a real player — ignore
      ledger.push({
        id, username, damage: row.damage, activeSeconds: row.activeSeconds,
        observer: active.observers.has(id),
      });
    }
    const awards = settleWarfareXp(ledger, st.tier, active.engine.maxHp, elapsed);
    if (!awards.length) return [];
    const paid = v.warfarePaid ?? (v.warfarePaid = {});
    const out: Outbound[] = [];
    const bossName = VAULT_BOSS_NAMES[st.bossKind];
    for (const award of awards) {
      const key = award.username.toLowerCase();
      if (paid[key] === v.deadAt) continue; // already settled this cycle
      paid[key] = v.deadAt;
      const w = this.warfareOf(award.username);
      grantWarfareXp(w, award.xp);
      const online = this.players.get(award.id);
      if (online && online.username === award.username) {
        out.push({ to: online.id, msg: {
          t: 'warfareXp', amount: award.xp, tier: st.tier, total: w.xp, boss: bossName,
        } });
        out.push(this.warfareMsg(online));
        this.saveWarfare(online);
      } else {
        this.onWarfareChange?.(award.username, w);
      }
    }
    return out;
  }

  private finishVaultEncounter(
    active: ActiveVaultEncounter,
    credited: string,
  ): Outbound[] {
    const st = active.stamp;
    const v = this.ensureVault(st);
    if (v.deadAt === this.worldTime && v.hp === 0) return [];
    v.hp = 0;
    v.deadAt = this.worldTime;
    const elapsed = Math.max(0, active.engine.now - active.engine.startedAt);
    for (const id of active.engine.participants) {
      const participant = this.players.get(id);
      if (!participant) continue;
      const data = participant.savedClientData ?? {};
      const raw = data.vaultRecords;
      const records = raw && typeof raw === 'object'
        ? { ...(raw as Record<string, unknown>) } : {};
      const recordKey = `${st.cx},${st.cz}`;
      const previous = records[recordKey] && typeof records[recordKey] === 'object'
        ? records[recordKey] as { best?: unknown } : {};
      const priorBest = typeof previous.best === 'number' && Number.isFinite(previous.best)
        ? previous.best : Infinity;
      records[recordKey] = {
        boss: st.bossKind, family: st.family,
        best: Math.min(priorBest, elapsed), clears:
          typeof (previous as { clears?: unknown }).clears === 'number'
            ? Math.max(1, Math.floor((previous as { clears: number }).clears) + 1) : 1,
      };
      data.vaultRecords = records;
      participant.savedClientData = data;
    }
    const out = this.cleanupArenaPlacements(active);
    out.push(...this.settleWarfare(active, v, elapsed));
    for (const event of active.engine.tick(0, [])) {
      out.push({ to: 'all', msg: { t: 'encounterEvent', cx: st.cx, cz: st.cz, event } });
    }
    out.push({ to: 'all', msg: {
      t: 'encounterEnd', cx: st.cx, cz: st.cz, outcome: 'victory', credited,
    } });
    out.push({ to: 'all', msg: { t: 'vault', cx: st.cx, cz: st.cz, tier: st.tier,
      hp: 0, maxHp: active.engine.maxHp, alive: false } });
    out.push({ to: 'all', msg: { t: 'vaultCleared', cx: st.cx, cz: st.cz, by: credited } });
    out.push({ to: 'all', msg: { t: 'killfeed',
      killer: credited, victim: `Tier ${st.tier} ${VAULT_BOSS_NAMES[st.bossKind]} [DEFEATED]` } });
    this.vaultEncounters.delete(`${st.cx},${st.cz}`);
    return out;
  }

  /** Fixed-step authoritative encounter tick. The WS shell calls this at 20 Hz. */
  tickVaultEncounters(dt: number): Outbound[] {
    if (!fin(dt) || dt <= 0) return [];
    const out: Outbound[] = [];
    for (const [key, active] of this.vaultEncounters) {
      const st = active.stamp;
      const before = new Set(active.engine.participants);
      const inputs: EncounterParticipant[] = [...this.players.values()].map((p) => ({
        id: p.id, position: { x: p.x, y: p.y, z: p.z },
        alive: !p.dead, inside: this.playerInArena(p, st),
      }));
      // Capture identities BEFORE the tick can prune anyone: the contribution
      // ledger has to survive a player dying, leaving, or dropping their socket.
      for (const p of this.players.values()) {
        if (active.engine.participants.has(p.id)) this.noteEncounterPresence(active, p);
      }
      const events = active.engine.tick(dt, inputs);
      for (const event of events) {
        out.push({ to: 'all', msg: { t: 'encounterEvent', cx: st.cx, cz: st.cz, event } });
      }
      for (const id of before) {
        if (!active.engine.participants.has(id)) {
          out.push(...this.cleanupArenaPlacements(active, id));
        }
      }
      // Late arrivals get the current complete state, never the four-second
      // introduction or a replay of old event IDs.
      for (const id of active.engine.participants) {
        if (before.has(id)) continue;
        out.push({ to: id, msg: {
          t: 'encounterStart', cx: st.cx, cz: st.cz,
          encounterId: active.engine.config.encounterId,
          family: st.family, kind: st.bossKind, tier: st.tier,
          startTime: active.engine.startedAt, seed: active.engine.config.seed,
          bounds: { ...st.arena.bounds },
          scaling: participantHpMultiplier(active.engine.peakParticipants),
          cameraAnchors: st.arena.cameraAnchors.map((x) => ({ ...x })),
          snapshot: active.engine.snapshot(),
        } });
      }
      // Damage is decided only from authoritative transforms at execution time.
      // Lair hazards pierce armor (see `mitigate`) — a boss is the one thing in
      // the world that a maxed set makes survivable rather than irrelevant.
      const pierce = encounterArmorPierce(st.tier);
      for (const hazard of active.engine.hazards) {
        for (const input of inputs) {
          const damage = active.engine.hitByHazard(hazard.id, input);
          if (damage <= 0) continue;
          const player = this.players.get(input.id);
          if (!player) continue;
          out.push(...this.applyDamage(player, damage, -1,
            { x: player.x - hazard.origin.x, y: 0.25, z: player.z - hazard.origin.z },
            false, pierce));
        }
      }
      const v = this.ensureVault(st);
      if (active.engine.status === 'idle') {
        out.push(...this.cleanupArenaPlacements(active));
        v.hp = bossMaxHp(st.tier, st.bossKind);
        v.deadAt = -1e15;
        out.push({ to: 'all', msg: {
          t: 'encounterEnd', cx: st.cx, cz: st.cz, outcome: 'reset',
        } });
        this.vaultEncounters.delete(key);
        continue;
      }
      v.hp = active.engine.hp;
      active.snapshotAccum += dt;
      if (active.snapshotAccum >= 0.1) {
        active.snapshotAccum %= 0.1;
        out.push({ to: 'all', msg: {
          t: 'encounterSnapshot', cx: st.cx, cz: st.cz,
          snapshot: active.engine.snapshot(),
        } });
      }
    }
    return out;
  }

  /** Open the per-player VaultChest: requires the Brute dead within the loot
   *  window, in-reach, a pristine (unedited) chest cell, and the per-player
   *  30-minute regrow cooldown elapsed (the ledger persists in the world save). */
  private handleVaultChestOpen(p: ServerPlayer, x: number, y: number, z: number): Outbound[] {
    if (!fin(x, y, z)) return [];
    const bx = Math.floor(x), by = Math.floor(y), bz = Math.floor(z);
    if (!this.nearMachine(p, bx, by, bz)) return []; // alive + in-reach gate
    const st = vaultChestAt(this.seed, bx, by, bz, this.terrain,
      (cx, cz) => this.vaultStampAt(cx, cz));
    if (!st) return [];
    // A broken/replaced chest cell can never pay out (fail-closed vs edits).
    if (this.edits.has(`${bx},${by},${bz}`)) return [];
    const v = this.ensureVault(st);
    if (!vaultLootable(v, this.worldTime)) {
      return [{ to: p.id, msg: { t: 'notice', text: v.hp > 0
        ? `The ${VAULT_BOSS_NAMES[st.bossKind]} guards this chest — defeat it first!`
        : 'The vault has resealed — the Brute will return to guard it.' } }];
    }
    const cd = vaultLootCooldownLeft(v, p.username, this.worldTime);
    if (cd > 0) {
      return [{ to: p.id, msg: { t: 'notice',
        text: `⏳ You've looted this vault — the treasure regrows in ${Math.ceil(cd / 60)}m.` } }];
    }
    const roll = recordVaultLoot(v, p.username, this.worldTime);
    const out: Outbound[] = [];
    for (const s of vaultLoot(this.seed, st.cx, st.cz, st.tier, p.username, roll)) {
      if (!ITEMS[s.id] || !fin(s.count) || s.count <= 0) continue;
      // Vault haul is taxed like any other take from the world.
      const net = Math.floor(s.count) - this.levyInto(p.faction, s.id, Math.floor(s.count));
      if (net > 0) out.push({ to: p.id, msg: { t: 'gotitem', item: s.id, count: net } });
    }
    this.politicsDirty = true;
    out.push({ to: p.id, msg: { t: 'vaultLooted', cx: st.cx, cz: st.cz } });
    out.push({ to: p.id, msg: { t: 'notice', text: `[VAULT] Tier ${st.tier} vault treasure claimed!` } });
    return out;
  }

  /** Raid-destroy a machine: spill its stored output AND drop the machine block
   *  itself as loot, delete the entity, and clear its whole footprint (anchor +
   *  part cells) for everyone. */
  private destroyMachine(key: string, x: number, y: number, z: number): Outbound[] {
    const s = this.machines.get(key);
    const out = this.spillMachine(key, x, y, z); // spills stored + deletes entity
    const type = s ? s.type : MachineType.Autominer;
    if (s) {
      const blockId = type === MachineType.OilDerrick ? Block.OilDerrick : Block.Autominer;
      out.push(...this.spawnItem(blockId, 1,
        x + 0.5 + (this.rng() - 0.5), y + 0.3, z + 0.5 + (this.rng() - 0.5)));
    }
    out.push(...this.clearFootprint(x, y, z, type, true));
    return out;
  }

  /** Relocate a machine: clear its old footprint, rebuild it at the target, and
   *  carry over the full MachineState (level/storage/filter/stored/owner/hp). You
   *  can't break a machine — only move it — so nothing is dropped or destroyed. */
  private moveMachine(
    fx: number, fy: number, fz: number, tx: number, ty: number, tz: number
  ): Outbound[] {
    fx = Math.floor(fx); fy = Math.floor(fy); fz = Math.floor(fz);
    tx = Math.floor(tx); ty = Math.floor(ty); tz = Math.floor(tz);
    const fromKey = `${fx},${fy},${fz}`, toKey = `${tx},${ty},${tz}`;
    if (fromKey === toKey) return [];
    const type = machineTypeForBlock(this.edits.get(fromKey) ?? -1);
    if (type === null) return [];
    const state = this.machines.get(fromKey);
    if (!state) return [];
    // Refuse to clobber another machine at the destination anchor.
    if (machineTypeForBlock(this.edits.get(toKey) ?? -1) !== null) return [];
    const h = machineHeight(type);
    if (ty < 0 || ty + h > 256) return [];
    const blockId = type === MachineType.OilDerrick ? Block.OilDerrick : Block.Autominer;

    const out: Outbound[] = [];
    // Vacate the old footprint (anchor + parts) for everyone.
    this.machines.delete(fromKey);
    out.push(...this.clearFootprint(fx, fy, fz, type, true));
    // Rebuild at the destination and carry the state over.
    this.machines.set(toKey, state);
    this.edits.set(toKey, blockId);
    out.push({ to: 'all', msg: { t: 'edit', x: tx, y: ty, z: tz, block: blockId } });
    for (let k = 1; k < h; k++) {
      this.edits.set(`${tx},${ty + k},${tz}`, Block.MachinePart);
      out.push({ to: 'all', msg: { t: 'edit', x: tx, y: ty + k, z: tz, block: Block.MachinePart } });
    }
    out.push({ to: 'all', msg: { t: 'machine', x: tx, y: ty, z: tz, state } });
    return out;
  }

  /** Set the machine's footprint cells (anchor + parts above) to air and
   *  broadcast the edits. `includeAnchor=false` leaves the anchor for the caller
   *  to broadcast (used when an edit already removes the anchor cell). */
  private clearFootprint(
    x: number, y: number, z: number, type: MachineType, includeAnchor: boolean
  ): Outbound[] {
    const out: Outbound[] = [];
    const h = machineHeight(type);
    for (let k = includeAnchor ? 0 : 1; k < h; k++) {
      const cy = y + k;
      const ck = `${x},${cy},${z}`;
      const cur = this.edits.get(ck);
      // Only clear the anchor (k=0) or genuine part cells, never unrelated blocks.
      if (k === 0 || cur === Block.MachinePart) {
        this.edits.set(ck, Block.Air);
        out.push({ to: 'all', msg: { t: 'edit', x, y: cy, z, block: Block.Air } });
      }
    }
    return out;
  }

  /** Gate machine interaction: the player must be alive and within edit range
   *  of the machine (fail-closed on NaN). Mirrors handleEdit/handlePickup so a
   *  client can't drain or reconfigure a machine it isn't standing next to —
   *  machines mint resources, so remote draining would be real theft. */
  private nearMachine(p: ServerPlayer, x: number, y: number, z: number): boolean {
    if (p.dead || !fin(p.x, p.y, p.z, x, y, z)) return false;
    const dx = Math.floor(x) + 0.5 - p.x;
    const dy = Math.floor(y) + 0.5 - p.y;
    const dz = Math.floor(z) + 0.5 - p.z;
    return dx * dx + dy * dy + dz * dz <= EDIT_RANGE * EDIT_RANGE;
  }

  /** The machine at a position, but only if the edit log still records a
   *  machine block there (fail-closed against stale/forged ops). Creates the
   *  entity lazily if the block exists but no state was tracked yet. */
  private ensureMachine(x: number, y: number, z: number): MachineState | undefined {
    if (!fin(x, y, z)) return undefined;
    const key = `${Math.floor(x)},${Math.floor(y)},${Math.floor(z)}`;
    const type = machineTypeForBlock(this.edits.get(key) ?? -1);
    if (type === null) return undefined;
    let s = this.machines.get(key);
    if (!s) { s = newMachine(type); this.machines.set(key, s); }
    return s;
  }

  /** Spill a broken machine's stored output as item entities, then drop it. */
  private spillMachine(key: string, x: number, y: number, z: number): Outbound[] {
    const s = this.machines.get(key);
    this.machines.delete(key);
    if (!s) return [];
    const out: Outbound[] = [];
    let entities = 0;
    for (const [idStr, count] of Object.entries(s.stored)) {
      const item = Number(idStr);
      if (!ITEMS[item] || !fin(count) || count <= 0) continue;
      let remaining = Math.floor(count);
      while (remaining > 0 && entities < 64) { // cap entities per break
        const c = Math.min(64, remaining);
        remaining -= c;
        entities++;
        out.push(...this.spawnItem(item, c,
          x + 0.5 + (this.rng() - 0.5), y + 0.3, z + 0.5 + (this.rng() - 0.5)));
      }
    }
    return out;
  }

  /** Tick every placed machine using its column's terrain richness. Call from
   *  the per-second server loop alongside tickRegen. */
  tickMachines(dt: number): void {
    if (!fin(dt) || dt <= 0) return;
    for (const [key, s] of this.machines) {
      const parts = key.split(',');
      const x = Number(parts[0]), z = Number(parts[2]);
      const ctx = s.type === MachineType.Autominer
        ? { ore: this.terrain.oreRichness(x, z) }
        : { oil: this.terrain.oilRichness(x, z) };
      tickMachine(s, ctx, dt);
    }
  }

  /** Create a server-owned item entity (registered for gravity) and return the
   *  itemspawn broadcast for it. */
  private spawnItem(item: number, count: number, x: number, y: number, z: number): Outbound[] {
    // A minigame item must never become a world entity. Guarding the FACTORY
    // rather than its callers covers the manual drop, the death spill, the
    // chest spill, the block break and the turret teardown in one line.
    if (isMinigameOnly(item)) return [];
    const eid = this.nextEid++;
    const info: ItemEntityInfo = { eid, item, count: Math.min(64, Math.floor(count)), x, y, z };
    this.items.set(eid, info);
    this.itemPhys.set(eid, { vy: 0, resting: false });
    return [{ to: 'all', msg: { t: 'itemspawn', item: info } }];
  }

  /** Is the cell solid from the server's view (player edits win; otherwise the
   *  natural terrain surface). Ignores caves on purpose — that makes items rest
   *  where they land rather than sink through unknown cavities. */
  private serverSolid(x: number, y: number, z: number): boolean {
    if (y < 0) return true;
    const e = this.edits.get(`${x},${y},${z}`);
    if (e !== undefined) return e !== Block.Air && (BLOCKS[e]?.solid ?? false);
    return y <= this.terrain.height(x, z);
  }

  /** Advance dropped-item gravity; returns the items whose position changed
   *  (for a periodic broadcast). Items settle onto the ground and then idle. */
  tickItems(dt: number): { eid: number; x: number; y: number; z: number }[] {
    if (!fin(dt) || dt <= 0) return [];
    const moved: { eid: number; x: number; y: number; z: number }[] = [];
    for (const info of this.items.values()) {
      const st = this.itemPhys.get(info.eid);
      if (!st || st.resting) continue;
      st.vy = Math.min(40, st.vy + 18 * dt); // gravity, terminal-velocity capped
      const fx = Math.floor(info.x), fz = Math.floor(info.z);
      // Sub-step the descent so a fast fall can't tunnel a thin floor.
      let y = info.y;
      const fall = st.vy * dt;
      const steps = Math.max(1, Math.ceil(fall / 0.5));
      const stepY = fall / steps;
      for (let s = 0; s < steps; s++) {
        const ny = y - stepY;
        if (this.serverSolid(fx, Math.floor(ny), fz)) {
          y = Math.floor(ny) + 1;
          st.vy = 0; st.resting = true;
          break;
        }
        y = ny;
      }
      if (y !== info.y || st.resting) {
        info.y = y;
        moved.push({ eid: info.eid, x: info.x, y: info.y, z: info.z });
      }
    }
    return moved;
  }

  private handleDrop(
    p: ServerPlayer, items: { id: number; count: number }[],
    x: number, y: number, z: number, reason?: 'harvest' | 'manual'
  ): Outbound[] {
    // Dead players DO drop (death spill), so no alive-guard here.
    if (!fin(x, y, z) || !Array.isArray(items)) return [];
    const out: Outbound[] = [];
    let n = 0;
    // The faction TAX is levied here, on the way OUT of the world, rather than
    // on pickup: a harvest passes through this path exactly once, whereas a
    // player who drops and re-collects their own stack passes through pickup
    // every time and would be taxed again on each pass.
    const taxable = reason === 'harvest';
    let levied = 0;
    for (const it of items) {
      if (n++ >= 64) break; // sanity cap per request
      if (!it || !ITEMS[it.id] || !fin(it.count) || it.count <= 0) continue;
      if (isMinigameOnly(it.id)) continue; // redundant with spawnItem, deliberately
      // levy() never takes a whole stack, so `count` stays >= 1 here.
      const count = taxable
        ? Math.floor(it.count) - this.levyInto(p.faction, it.id, Math.floor(it.count))
        : Math.floor(it.count);
      if (count !== Math.floor(it.count)) levied++;
      out.push(...this.spawnItem(it.id, count, x + (this.rng() - 0.5), y, z + (this.rng() - 0.5)));
    }
    // Mining is the highest-frequency message on the server, so a levy must NOT
    // fan a politics message out to everybody per broken block. Mark it dirty
    // and let the once-a-second election tick flush it.
    if (levied > 0) this.politicsDirty = true;
    return out;
  }

  private handlePickup(p: ServerPlayer, eid: number): Outbound[] {
    const item = this.items.get(eid);
    if (!item || p.dead) return []; // dead players can't pick up
    const dx = item.x - p.x, dy = item.y - p.y, dz = item.z - p.z;
    if (!(dx * dx + dy * dy + dz * dz <= PICKUP_RANGE * PICKUP_RANGE)) return [];
    this.items.delete(eid);
    this.itemPhys.delete(eid);
    return [
      { to: p.id, msg: { t: 'gotitem', item: item.item, count: item.count } },
      { to: 'all', msg: { t: 'itemremove', eid } },
    ];
  }

  private handleEdit(
    p: ServerPlayer, x: number, y: number, z: number, block: number
  ): Outbound[] {
    if (p.dead) return [];
    if (!fin(x, y, z) || !fin(p.x, p.y, p.z)) return [];
    x = Math.floor(x); y = Math.floor(y); z = Math.floor(z);
    if (y < 0 || y >= 256) return [];
    // Validate the block id so a hacked client can't broadcast an id that
    // crashes every other client's mesher (BLOCKS[bad] === undefined).
    if (block !== 0 && !BLOCKS[block]) return [];
    // Minigame blocks are arena-only. Arena edits never reach this handler —
    // each mode has its own — so refusing here means no OPEN-WORLD cell can
    // ever hold one, whatever a client claims to be placing.
    if (isMinigameOnly(block)) return [];
    const dx = x + 0.5 - p.x, dy = y + 0.5 - p.y, dz = z + 0.5 - p.z;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (!(d2 <= EDIT_RANGE * EDIT_RANGE)) return []; // fail-closed (NaN -> reject)
    const key = `${x},${y},${z}`;
    const prev = this.edits.get(key);
    const out: Outbound[] = [];
    const arena = this.liveEncounterForPlacement(p, x, y, z);
    if (arena) return [{ to: p.id, msg: { t: 'notice',
      text: 'The sealed arena rejects block changes during the fight.' } }];
    const vault = vaultAt(this.seed, x + 0.5, y + 0.5, z + 0.5, this.terrain,
      (cx, cz) => this.vaultStampAt(cx, cz));
    const protectedCell = vault && (
      (vault.chest.x === x && vault.chest.y === y && vault.chest.z === z) ||
      vault.rooms.some((room) => room.cap > 0 && Math.floor(room.x) === x &&
        Math.floor(room.y) === y && Math.floor(room.z) === z)
    );
    if (protectedCell) return [{ to: p.id, msg: { t: 'notice',
      text: 'That vault anchor is protected. Clear its guardians instead.' } }];
    // Server-authoritative chest break: if this edit removes a chest, spill its
    // stored contents as item entities everyone sees and clear the storage —
    // independent of whether the breaking client ever opened (cached) it.
    if (prev === Block.Chest && block !== Block.Chest) {
      out.push(...this.spillChest(key, x, y, z));
    }
    // Breaking a pristine STRUCTURE chest (terrain block, never edited): its
    // seeded loot still spills — generate-on-break if nobody opened it yet
    // (single roll either way, so nothing dupes or vanishes).
    if (prev === undefined && block !== Block.Chest &&
        this.structureChestTierAt(x, y, z) !== null) {
      this.ensureStructureChest(x, y, z);
      out.push(...this.spillChest(key, x, y, z));
    }
    // Same for machines: removing/replacing the anchor spills its stored output
    // and clears the rest of the footprint (the breaker bypasses no validation —
    // this is the same authoritative break path as chests). Normal play never
    // hits this (machines are sabotaged, not edited); it covers explosions and
    // hacked direct edits so no orphan part cells are left behind.
    const prevType = machineTypeForBlock(prev ?? -1);
    if (prevType !== null && block !== prev) {
      out.push(...this.spillMachine(key, x, y, z));
      out.push(...this.clearFootprint(x, y, z, prevType, false));
    }
    // Turrets are single-block entities: removing/replacing one spills its
    // loaded ammo and deletes the entity (the block drop comes from the normal
    // break path, like machines).
    if (prev === Block.Turret && block !== Block.Turret) {
      const ts = this.turrets.get(key);
      this.turrets.delete(key);
      if (ts && ts.ammo > 0) {
        out.push(...this.spawnItem(Item.Cannonball, Math.min(64, ts.ammo), x + 0.5, y + 0.3, z + 0.5));
      }
    }
    this.edits.set(key, block);
    // Placing a machine block creates its server entity, which then ticks even
    // with no chunk loaded and no one viewing it.
    const placed = machineTypeForBlock(block);
    if (placed !== null && !this.machines.has(key)) {
      this.machines.set(key, newMachine(placed));
    }
    if (block === Block.Turret && !this.turrets.has(key)) {
      this.turrets.set(key, newTurret());
    }
    out.push({ to: 'all', msg: { t: 'edit', x, y, z, block } });
    // Placing warfare hardware is revalidated here, because the client that
    // sent the edit cannot be trusted about its own blueprints.
    if (block === Block.Helipad && !this.hasBlueprint(p, Block.Helipad)) {
      out.push(...this.revokePlacement(p, x, y, z,
        'Flight Certification is not authorized.'));
    }
    return out;
  }

  /** Undo a placement the player was not entitled to make. */
  private revokePlacement(
    p: ServerPlayer, x: number, y: number, z: number, reason: string,
  ): Outbound[] {
    this.edits.set(`${x},${y},${z}`, Block.Air);
    return [
      { to: 'all', msg: { t: 'edit', x, y, z, block: Block.Air } },
      { to: p.id, msg: { t: 'warfareErr', reason } },
    ];
  }

  /** The loot tier if (x,y,z) is a structure chest position (fail-closed on
   *  junk coords; pure — derives from the seed + terrain only). */
  private structureChestTierAt(x: number, y: number, z: number) {
    if (!fin(x, y, z)) return null;
    return structureChestTier(this.seed, Math.floor(x), Math.floor(y), Math.floor(z), this.terrain);
  }

  /** Generate + store a pristine structure chest's seeded first-open loot.
   *  Null if it isn't a structure chest or the cell was edited away (a broken
   *  chest can never re-roll). */
  private ensureStructureChest(x: number, y: number, z: number): (ItemStack | null)[] | null {
    if (!fin(x, y, z)) return null;
    const bx = Math.floor(x), by = Math.floor(y), bz = Math.floor(z);
    const key = `${bx},${by},${bz}`;
    if (this.edits.has(key)) return null; // edited cell -> no longer pristine
    const tier = this.structureChestTierAt(bx, by, bz);
    if (!tier) return null;
    const slots = chestLootSlots(this.seed, bx, by, bz, tier);
    this.chests.set(key, slots);
    return slots;
  }

  /** Drop a chest's stored items into the world as entities, then clear it. */
  private spillChest(key: string, x: number, y: number, z: number): Outbound[] {
    const contents = this.chests.get(key);
    this.chests.delete(key);
    if (!contents) return [];
    const out: Outbound[] = [];
    for (const s of contents) {
      if (!s || !ITEMS[s.id] || !fin(s.count) || s.count <= 0) continue;
      out.push(...this.spawnItem(s.id, s.count,
        x + 0.5 + (this.rng() - 0.5), y + 0.3, z + 0.5 + (this.rng() - 0.5)));
    }
    return out;
  }

  /** Gun/projectile PvP: the client raycasts the hit and reports it; the server
   *  sanity-checks range + rough facing (like melee) and applies clamped,
   *  armor-mitigated damage. It can't verify line-of-sight, matching the
   *  authoritative-lite trust model (mobs are client-side). */
  private handleRanged(attacker: ServerPlayer, targetId: number, amount: number): Outbound[] {
    const target = this.players.get(targetId);
    if (!target || target.arenaSaved || target.dead || attacker.dead || target.id === attacker.id) return [];
    if (sameFaction(attacker.faction, target.faction)) return []; // no friendly fire
    if (!fin(attacker.x, attacker.y, attacker.z, attacker.yaw,
      target.x, target.y, target.z, amount)) return [];
    const dx = target.x - attacker.x, dy = target.y - attacker.y, dz = target.z - attacker.z;
    const dist = Math.hypot(dx, dy, dz);
    if (!(dist <= RANGED_MAX_RANGE) || dist < 1e-3) return []; // fail-closed (NaN -> reject)
    const horiz = Math.hypot(dx, dz);
    if (horiz > 0.2) {
      const fwd = { x: -Math.sin(attacker.yaw), z: -Math.cos(attacker.yaw) };
      if ((fwd.x * dx + fwd.z * dz) / horiz < 0.2) return []; // not facing target
    }
    // A door gunner may only shoot inside the airframe's forward arc: strapped
    // into a seat you cannot swing a rifle through the bulkhead behind you.
    // (A pilot flying the thing is not shooting at all.)
    if (!this.vehicles.passengerCanFire(attacker.id, attacker.yaw)) return [];
    const dmg = Math.round(Math.max(0, Math.min(RANGED_MAX_DAMAGE, amount)));
    const knock = horiz > 1e-3
      ? { x: dx / horiz, y: 0.3, z: dz / horiz }
      : { x: 0, y: 0.4, z: 0 };
    return this.applyDamage(target, dmg, attacker.id, knock, true);
  }

  /**
   * Rebroadcast a gunshot so everyone else can SEE and HEAR it. Cosmetic only —
   * it carries no damage, and the hit itself still arrives (and is validated) as
   * a separate `rangedAttack`. The checks here exist purely so a hacked client
   * can't spam fake tracers or draw gunfire from somewhere it isn't standing:
   * the item must really be a gun, the muzzle must be next to the shooter, the
   * direction must be a usable vector, and the rate is bucketed.
   */
  private handleShot(p: ServerPlayer, msg: Extract<ClientMsg, { t: 'shot' }>): Outbound[] {
    if (p.dead || !fin(msg.x, msg.y, msg.z, msg.dx, msg.dy, msg.dz)) return [];
    const gun = ITEMS[msg.item]?.gun;
    if (!gun) return [];
    // The muzzle sits at the shooter's eye; allow a couple of blocks of slack
    // for the snapshot being a fraction of a second out of date.
    if (Math.hypot(msg.x - p.x, msg.y - (p.y + 1.6), msg.z - p.z) > 4) return [];
    const len = Math.hypot(msg.dx, msg.dy, msg.dz);
    if (!(len > 1e-3)) return [];
    // Token bucket: SHOT_RATE sustained shots/second with a SHOT_BURST burst,
    // which comfortably clears the fastest gun (the SMG's 12.5/s).
    p.shotTokens = Math.min(
      SHOT_BURST, p.shotTokens + Math.max(0, this.worldTime - p.shotRefillAt) * SHOT_RATE);
    p.shotRefillAt = this.worldTime;
    if (p.shotTokens < 1) return [];
    p.shotTokens -= 1;
    return [{
      to: 'others', from: p.id,
      msg: {
        t: 'shot', id: p.id, item: msg.item,
        x: msg.x, y: msg.y, z: msg.z,
        dx: msg.dx / len, dy: msg.dy / len, dz: msg.dz / len,
      },
    }];
  }

  /** `direct` marks damage a player personally dealt (gun/explosive) — only
   *  direct hits arm the lifesteal kill-credit window, so turret/mob/fall
   *  deaths never move hearts. `pierce` ignores a fraction of worn armor and is
   *  only ever non-zero for vault-boss hazards. */
  private applyDamage(
    p: ServerPlayer, amount: number, by: number,
    knock?: { x: number; y: number; z: number }, direct = false, pierce = 0
  ): Outbound[] {
    // Duels has a separate normalized damage path. This fail-closed guard keeps
    // every world hazard/projectile from crossing the visibility boundary even
    // if a new subsystem forgets to filter its target list.
    if (p.arenaSaved || p.dead || amount <= 0) return [];
    if (p.mode !== 'survival') return []; // creative/spectator are invulnerable
    // server-authoritative armor reduction
    amount = mitigate(amount, p.armorPoints, p.toughness, pierce);
    // Bloodlust (anti-stalemate): another player's hit in an ongoing fight
    // lands harder the longer the fight has raged — and once it's ramping, a
    // hit can never be fully absorbed, so no armor stack stalls forever.
    const pvp = by !== p.id && this.players.has(by);
    const out: Outbound[] = [];
    if (pvp) {
      if (this.worldTime - p.lastPvpTime >= COMBAT_TAG) {
        p.pvpSince = this.worldTime; // previous fight lapsed — fresh clock
        p.bloodlustWarned = false;
      }
      p.lastPvpTime = this.worldTime;
      const mult = bloodlustMult(this.worldTime - p.pvpSince);
      if (mult > 1) {
        amount = Math.max(1, Math.round(amount * mult));
        if (!p.bloodlustWarned) {
          p.bloodlustWarned = true;
          out.push({ to: p.id, msg: { t: 'notice',
            text: 'Bloodlust — this fight has raged too long, damage is ramping up!' } });
        }
      }
    }
    if (amount <= 0) {
      // Fully absorbed. The shooter still connected, so they still get a
      // hitmarker — a "your round landed and their armor ate it" marker is the
      // feedback that tells them to change weapon rather than keep firing.
      if (pvp && direct) {
        out.push({ to: by, msg: { t: 'hitconfirm', target: p.id, amount: 0, killed: false } });
      }
      return out;
    }
    p.health = Math.max(0, p.health - amount);
    // PvP hits block natural regen for the whole combat tag (out-healing an
    // active fight is what made fights drag forever); environment damage keeps
    // the short delay.
    p.regenCooldown = pvp ? COMBAT_TAG : REGEN_DELAY;
    p.regenTimer = 0;
    p.lastDamageTime = this.worldTime; // combat tag (blocks totem teleports)
    if (direct && pvp) {
      p.lastHitBy = by;
      p.lastHitTime = this.worldTime;
    }
    out.push({
      to: p.id,
      msg: {
        t: 'hurt', health: p.health, dead: p.health <= 0, by,
        kx: knock?.x ?? 0, ky: knock?.y ?? 0, kz: knock?.z ?? 0,
        combat: pvp ? COMBAT_TAG : 0,
      },
    });
    // Hitmarker for the attacker. Server-sent (never predicted) so it only ever
    // appears for damage that actually landed, and it reports the post-armor
    // number so the shooter can feel how much the target's kit is soaking.
    if (pvp && direct) {
      out.push({ to: by, msg: {
        t: 'hitconfirm', target: p.id, amount, killed: p.health <= 0 && !p.dead,
      } });
    }
    if (p.health <= 0 && !p.dead) {
      p.dead = true;
      // Death never leaves a corpse occupying a helicopter seat. Wreck ejection
      // already clears its seats before applying damage, so this is harmless on
      // crashes and essential for every other kill while aboard.
      if (this.vehicles.dismount(p.id, true).ok) {
        out.push({ to: p.id, msg: { t: 'heliSeat', id: 0, seat: null } });
        out.push(...this.heliBroadcast());
      }
      if (this.vehicles.detachRope(p.id)) {
        this.ropePlayers.delete(p.id);
        out.push({ to: p.id, msg: { t: 'heliRopeState', id: 0, progress: 0 } });
      }
      const killer = this.players.get(by);
      out.push({
        to: 'all',
        msg: {
          t: 'killfeed',
          killer: by === p.id || !killer ? '' : killer.username,
          victim: p.username,
        },
      });
      out.push(...this.dropCarriedFlag(p)); // a dead carrier drops it home
      out.push(...this.settleLifesteal(p));
      // A PvP kill scores XP for the killer + their faction pool, and DURING A
      // WAR it counts toward the war score (most kills wins the shrinking-border
      // battle). Server-awarded — never client-reported.
      if (killer && killer !== p &&
          isFaction(killer.faction) && killer.faction !== p.faction) {
        if (this.isWarActive()) {
          this.warKills[killer.faction]++;
          out.push({ to: 'all', msg: this.warSnapshotMsg() });
        }
      }
    }
    return out;
  }

  /** Lifesteal settlement on a death: a heart moves ONLY when a live enemy
   *  player directly damaged the victim within the credit window (kids never
   *  lose hearts to zombies/falls/lava/unattended turrets). Hitting 0 hearts
   *  ELIMINATES the victim: banner + killfeed + the shell records the 24h
   *  lockout and disconnects; they come back (timer/revive) at 5 hearts. */
  private settleLifesteal(victim: ServerPlayer): Outbound[] {
    const recent = this.worldTime - victim.lastHitTime <= KILL_CREDIT_WINDOW;
    const killer = recent ? this.players.get(victim.lastHitBy) : undefined;
    if (!killer || killer.id === victim.id || sameFaction(killer.faction, victim.faction)) {
      return []; // no PvP credit — hearts don't move
    }
    const moved = transferHeart(killer.hearts, victim.hearts);
    const wasted = moved.killer === killer.hearts; // killer already at the cap
    killer.hearts = moved.killer;
    victim.hearts = moved.victim;
    const out: Outbound[] = [
      { to: killer.id, msg: { t: 'hearts', hearts: killer.hearts,
        reason: 'steal', from: victim.username } },
      { to: victim.id, msg: { t: 'hearts', hearts: victim.hearts,
        reason: 'loss', from: killer.username } },
    ];
    if (wasted) {
      out.push({ to: killer.id, msg: { t: 'notice',
        text: `Hearts full (${MAX_HEARTS}) — the stolen heart was wasted!` } });
    }
    if (victim.hearts <= 0) {
      victim.eliminated = true; // blocks respawn until the shell disconnects
      // THE FLAG IS THE SAFETY NET. A faction that still holds a flag gets its
      // players back after the 24h lockout at COMEBACK_HEARTS; a faction whose
      // flag has been captured has none — its players are gone for good. This
      // is what makes defending the flag matter more than any single fight.
      const permanent = !this.factionHasFlag(victim.faction);
      // Comeback hearts are applied NOW so the disconnect persists them — the
      // account also carries `eliminatedUntil`, which gates login.
      victim.hearts = COMEBACK_HEARTS;
      const until = this.onEliminate?.(victim.username, killer.username, permanent) ?? 0;
      out.push({ to: victim.id, msg: { t: 'eliminated', by: killer.username, until } });
      out.push({ to: 'all', msg: { t: 'killfeed',
        killer: killer.username,
        victim: `${victim.username} (${permanent ? 'ELIMINATED FOREVER' : 'ELIMINATED'})` } });
      if (permanent) {
        out.push({ to: 'all', msg: { t: 'notice',
          text: `${victim.username} is gone FOREVER — ${factionName(victim.faction)} has no flag to bring them back.` } });
      }
    }
    return out;
  }

  /** Where a player respawns: their personal Respawn Beacon if it's set AND the
   *  beacon block still exists at the surface with open sky above it; otherwise
   *  the default surface spawn. */
  private respawnPoint(p: ServerPlayer): { x: number; y: number; z: number } {
    if (fin(p.spawnX as number, p.spawnY as number, p.spawnZ as number)) {
      const bx = Math.floor(p.spawnX!), by = Math.floor(p.spawnY!), bz = Math.floor(p.spawnZ!);
      let openToSky = by > this.terrain.height(bx, bz);
      for (let y = by + 1; openToSky && y < 256; y++) {
        const block = this.edits.get(`${bx},${y},${bz}`);
        if (block !== undefined && block !== Block.Air && (BLOCKS[block]?.solid ?? false)) {
          openToSky = false;
        }
      }
      const beaconSpawn = { x: bx + 0.5, y: by + 1, z: bz + 0.5 };
      if (this.inFactionHalf(p.faction, beaconSpawn.x, beaconSpawn.z) && openToSky &&
          this.edits.get(`${bx},${by},${bz}`) === Block.RespawnBeacon &&
          this.safeRespawnPoint(beaconSpawn.x, beaconSpawn.y, beaconSpawn.z)) {
        return beaconSpawn; // stand on top of the beacon
      }
      // Beacon gone, buried, or underground: forget it and fall back to the surface.
      p.spawnX = p.spawnY = p.spawnZ = undefined;
    }
    return this.spawn(p.faction);
  }

  private handleRespawn(p: ServerPlayer): Outbound[] {
    if (!p.dead || p.eliminated) return []; // eliminated: no respawn, only the boot
    const s = this.respawnPoint(p);
    p.x = s.x; p.y = s.y; p.z = s.z;
    p.health = maxHealthFor(p.hearts); p.dead = false;
    p.regenCooldown = 0; p.regenTimer = 0;
    return [{
      to: p.id, msg: { t: 'respawned', x: s.x, y: s.y, z: s.z, health: p.health },
    }];
  }

  /** Advance regen; call ~ once per second worth of accumulated dt. */
  tickRegen(dt: number): void {
    for (const p of this.players.values()) {
      if (p.dead) continue;
      const inDuel = !!p.arenaSaved;
      const max = inDuel ? DUEL_MAX_HEALTH : maxHealthFor(p.hearts);
      // A healing consumable (Bandage/Medkit) grants a window of fast regen that
      // ignores the post-damage delay — patch up mid-fight.
      const boosting = p.regenBoostTimer > 0;
      if (boosting) { p.regenBoostTimer = Math.max(0, p.regenBoostTimer - dt); p.regenCooldown = 0; }
      // Duels has no passive regeneration. A server-counted Medkit still runs
      // the normal healing cadence, with progression/bloodlust excluded.
      if (inDuel && !boosting) { p.regenTimer = 0; continue; }
      p.regenCooldown = Math.max(0, p.regenCooldown - dt);
      // Mid-fight healing is halved (anti-stalemate): while PvP combat-tagged a
      // Bandage/Medkit still works, but can't out-pace incoming fire forever.
      const inPvp = !inDuel && this.worldTime - p.lastPvpTime < COMBAT_TAG;
      const interval = boosting
        ? p.regenBoostInterval * (inPvp ? 2 : 1) : REGEN_INTERVAL;
      if (p.regenCooldown <= 0 && p.health < max) {
        p.regenTimer += dt;
        if (p.regenTimer >= interval) {
          p.regenTimer = 0;
          p.health = Math.min(max, p.health + 1);
        }
      } else if (p.health >= max) {
        p.regenBoostTimer = 0; // fully healed — end the buff early
      }
    }
  }

  private playerByName(name: string): ServerPlayer | undefined {
    if (!name) return undefined;
    for (const p of this.players.values()) if (p.username === name) return p;
    return undefined;
  }

  // --- Turrets ---------------------------------------------------------------

  private ensureTurret(x: number, y: number, z: number): TurretState | undefined {
    if (!fin(x, y, z)) return undefined;
    const key = `${Math.floor(x)},${Math.floor(y)},${Math.floor(z)}`;
    if (this.edits.get(key) !== Block.Turret) return undefined;
    let s = this.turrets.get(key);
    if (!s) { s = newTurret(); this.turrets.set(key, s); }
    return s;
  }

  /** Raid-destroy a turret: spill loaded ammo + drop the block, clear the cell. */
  private destroyTurret(x: number, y: number, z: number): Outbound[] {
    const key = `${x},${y},${z}`;
    const s = this.turrets.get(key);
    this.turrets.delete(key);
    const out: Outbound[] = [];
    if (s) {
      if (s.ammo > 0) out.push(...this.spawnItem(Item.Cannonball, Math.min(64, s.ammo),
        x + 0.5, y + 0.3, z + 0.5));
      out.push(...this.spawnItem(Block.Turret, 1,
        x + 0.5 + (this.rng() - 0.5), y + 0.3, z + 0.5 + (this.rng() - 0.5)));
    }
    this.edits.set(key, Block.Air);
    out.push({ to: 'all', msg: { t: 'edit', x, y, z, block: Block.Air } });
    return out;
  }

  /** Tick every turret: cooldown, acquire the nearest enemy (non-owner) player
   *  in range, consume a shot, and apply a server-validated hit. Returns the
   *  fire visuals + damage + state updates to broadcast. */
  tickTurrets(dt: number): Outbound[] {
    if (!fin(dt) || dt <= 0) return [];
    const out: Outbound[] = [];
    for (const [key, s] of this.turrets) {
      s.cooldown = Math.max(0, s.cooldown - dt);
      if (!s.owner || !turretArmed(s)) continue; // unclaimed/empty turrets are inert
      const [tx, ty, tz] = key.split(',').map(Number);
      const cx = tx + 0.5, cy = ty + 0.5, cz = tz + 0.5;
      const range = turretRange(s.level);
      let best: ServerPlayer | null = null;
      let bestD2 = range * range;
      for (const p of this.players.values()) {
        // Skip the dead, the owner, and anyone in the turret's own faction.
        if (p.dead || p.arenaSaved || p.username === s.owner || sameFaction(p.faction, s.faction)) continue;
        const dx = p.x - cx, dy = p.y - cy, dz = p.z - cz;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 <= bestD2) { bestD2 = d2; best = p; }
      }
      if (!best) continue;
      s.facingYaw = Math.atan2(best.x - cx, best.z - cz); // aim heading toward the target
      turretConsumeShot(s);
      const owner = this.playerByName(s.owner);
      const horiz = Math.hypot(best.x - cx, best.z - cz) || 1;
      out.push(...this.applyDamage(best, Math.round(turretDamage(s.level)),
        owner ? owner.id : -1, { x: (best.x - cx) / horiz, y: 0.3, z: (best.z - cz) / horiz }));
      out.push({ to: 'all', msg: { t: 'turretFire', x: tx, y: ty, z: tz,
        tx: best.x, ty: best.y + 0.9, tz: best.z } });
      // Refresh viewers' ammo/facing display.
      out.push({ to: 'all', msg: { t: 'turret', x: tx, y: ty, z: tz, state: s } });
    }
    return out;
  }

  // --- FLAGS: capture the flag ------------------------------------------------

  /** Wire form of the flag state (welcome + every broadcast). */
  private flagsPayload(): { breakable: boolean;
    flags: { faction: number; holder: number; hp: number; carrier: number }[] } {
    return {
      breakable: this.flags.breakable,
      flags: this.flags.flags.map((f) => ({ ...f })),
    };
  }

  /** The full-state broadcast plus the human-readable event that caused it. */
  private flagBroadcast(
    kind: 'taken' | 'returned' | 'captured', flag: { faction: number; holder: number },
    by: string
  ): Outbound[] {
    return [
      { to: 'all', msg: { t: 'flags', ...this.flagsPayload() } },
      { to: 'all', msg: { t: 'flagEvent', kind, faction: flag.faction, by,
        holder: flag.holder } },
    ];
  }

  /** Push the flag state to everyone (no event line). */
  flagsSnapshotMsg(): ServerMsg { return { t: 'flags', ...this.flagsPayload() }; }

  /** Does this faction still hold a flag? (Drives permanent elimination.) */
  factionHasFlag(faction: number): boolean {
    return factionHasFlag(this.flags, faction);
  }

  /** One swing at the flag the player is standing next to. Rate-limited and
   *  fully server-decided: the client only says "I swung", never at what. */
  private handleFlagHit(p: ServerPlayer): Outbound[] {
    if (p.dead || p.mode !== 'survival') return [];
    if (this.worldTime - p.lastFlagHit < FLAG_HIT_COOLDOWN) return [];
    const ev = hitFlag(this.flags, p.id, p.faction, p.x, p.z);
    // Only a swing that actually LANDS starts the cooldown — swinging at thin
    // air (or at a locked flag) must not lock you out of the real thing.
    if (!ev) return [];
    p.lastFlagHit = this.worldTime;
    if (ev.kind === 'taken') {
      return [
        ...this.flagBroadcast('taken', ev.flag, p.username),
        { to: 'all', msg: { t: 'notice',
          text: `${p.username} has taken the ${factionName(ev.flag.faction)} flag!` } },
      ];
    }
    // Progress ticks are cheap and frequent — send the state only to the raider
    // so a long siege doesn't spam the whole server.
    return [{ to: p.id, msg: this.flagsSnapshotMsg() }];
  }

  /** Called after every accepted move: standing on your own pad with a stolen
   *  flag scores the capture. */
  private checkFlagCapture(p: ServerPlayer): Outbound[] {
    if (p.dead || !carriedBy(this.flags, p.id)) return [];
    const ev = tryCapture(this.flags, p.id, p.faction, p.x, p.z);
    if (!ev || ev.kind !== 'captured') return [];
    return [
      ...this.flagBroadcast('captured', ev.flag, p.username),
      { to: 'all', msg: { t: 'notice',
        text: `${factionName(ev.faction)} CAPTURED the ${factionName(ev.flag.faction)} flag! ` +
          `${factionName(ev.flag.faction)} now fights with no flag — their deaths are FOREVER.` } },
    ];
  }

  /** Death/disconnect: a carried flag snaps home. */
  private dropCarriedFlag(p: ServerPlayer): Outbound[] {
    const ev = returnFlag(this.flags, p.id);
    if (!ev) return [];
    return [
      ...this.flagBroadcast('returned', ev.flag, p.username),
      { to: 'all', msg: { t: 'notice',
        text: `The ${factionName(ev.flag.faction)} flag returned home.` } },
    ];
  }

  /** Admin: arm/disarm flag breaking (console `flags on|off`). */
  adminSetFlagsBreakable(on: boolean): Outbound[] {
    this.flags.breakable = on;
    return [
      { to: 'all', msg: this.flagsSnapshotMsg() },
      { to: 'all', msg: { t: 'notice', text: on
        ? 'FLAGS ARE ARMED — enemy flags can now be prised loose. Defend yours!'
        : 'Flags are locked again — nobody can take a flag.' } },
    ];
  }

  /** Admin: send every flag home to its own faction (a clean slate). */
  adminResetFlags(): Outbound[] {
    const breakable = this.flags.breakable;
    this.flags = newFlags();
    this.flags.breakable = breakable;
    return [
      { to: 'all', msg: this.flagsSnapshotMsg() },
      { to: 'all', msg: { t: 'notice', text: '[FLAGS] All flags reset to their home pads.' } },
    ];
  }

  /** Console-friendly flag report. */
  flagsStatusText(): string {
    const lines = [`flags are ${this.flags.breakable ? 'ARMED (breakable)' : 'LOCKED (unbreakable)'}`];
    for (const f of this.flags.flags) {
      const who = f.carrier >= 0
        ? `carried by ${this.players.get(f.carrier)?.username ?? '?'}`
        : `planted at ${factionName(f.holder)}'s base`;
      lines.push(`  ${factionName(f.faction)} flag: ${who} (hp ${f.hp})`);
    }
    for (const id of FACTIONS.map((f) => f.id)) {
      if (!factionHasFlag(this.flags, id)) {
        lines.push(`  ${factionName(id)} holds NO flag — their deaths are permanent`);
      }
    }
    return lines.join('\n');
  }

  // --- The WAR: a shrinking-border battle royale ------------------------------

  /** Is a war on right now? */
  isWarActive(): boolean { return warActive(this.war, this.worldTime); }

  /** Read-only authoritative clock for transport snapshots and sky sync. */
  clockTime(): number { return this.worldTime; }

  /** The CURRENT border side length: full world in peacetime; during a war it
   *  closes in toward the 100×100 final ring (pure warBorderAt). */
  currentBorder(): number {
    if (!this.isWarActive()) return WORLD_BORDER;
    const timeLeft = Math.max(0, this.war.end - this.worldTime);
    return warBorderAt(timeLeft, warDuration(this.war), WORLD_BORDER);
  }
  private borderHalf(): number { return this.currentBorder() / 2; }

  /** The arena bounds of the live vault encounter `id` is fighting in, or null.
   *  A fight counts as live through its intro, the fight itself and the empty-
   *  arena grace window — the whole span where yanking a raider out would
   *  destroy the run. */
  private liveArenaFor(id: number): ArenaBounds | null {
    for (const active of this.vaultEncounters.values()) {
      if (!active.engine.participants.has(id)) continue;
      const status = active.engine.status;
      if (status !== 'intro' && status !== 'active' && status !== 'reset_grace') continue;
      return active.stamp.arena.bounds;
    }
    return null;
  }

  /**
   * The ring closed over someone who was underground — a mine, a cave, a vault
   * they had already left. Clamping x/z alone buries them alive inside solid
   * rock, so put them down on real dry ground inside the ring and tell them why
   * they moved. Rate-limited so a player pinned against a shrinking edge can't
   * be teleported every tick.
   */
  private relocateInsideBorder(p: ServerPlayer, half: number): Outbound[] {
    if (this.worldTime < p.borderRelocateAt) return [];
    p.borderRelocateAt = this.worldTime + BORDER_RELOCATE_COOLDOWN;
    const edge = Math.max(8, half - 8);
    const inside = (v: number): number => Math.max(-edge, Math.min(edge, v));
    // Search near where the ring pushed them first; drySpawnInBounds widens to
    // a grid scan and finally the world spawn if that pocket is all water.
    const s = this.terrain.drySpawnInBounds(this.rng,
      inside(p.x - 40), inside(p.x + 40), inside(p.z - 40), inside(p.z + 40));
    p.x = s.x; p.y = s.y; p.z = s.z;
    return [
      { to: p.id, msg: { t: 'teleport', x: s.x, y: s.y, z: s.z } },
      { to: p.id, msg: { t: 'notice',
        text: 'The war border closed over you — moved to safe ground inside the ring.' } },
    ];
  }

  /** Clock-relative war state for the HUD/wire (clock + score + season wins). */
  warSnapshotMsg(): ServerMsg {
    const w = warSnapshot(this.war, this.worldTime);
    return { t: 'war', active: w.active, timeLeft: w.timeLeft, nextIn: w.nextIn,
      duration: w.duration, score: this.warKills.slice(), wins: this.warWins.slice() };
  }

  /** Advance the war clock: move worldTime, pull everyone inside the shrinking
   *  border, broadcast the clock periodically + on every peace<->war transition,
   *  and RESOLVE the war when it ends (most kills wins). */
  tickWar(dt: number): Outbound[] {
    if (!fin(dt) || dt <= 0) return [];
    this.worldTime += dt;
    const out: Outbound[] = [];
    const active = this.isWarActive();
    // The closing ring drags everyone inward (authoritative — matches the xform
    // clamp, so nobody can sit outside the border).
    if (active) {
      const half = this.borderHalf();
      for (const p of this.players.values()) {
        // A live boss fight is exempt — the sealed arena outranks the ring.
        if (p.dead || p.arenaSaved || this.liveArenaFor(p.id)) continue;
        const clamped = clampInsideBorder(p.x, p.z, half);
        if (clamped.moved <= 0) continue;
        p.x = clamped.x;
        p.z = clamped.z;
        // Dragged in from far away: their old Y is somewhere else entirely, so
        // land them on real ground rather than sealing them into bedrock.
        if (clamped.relocated) out.push(...this.relocateInsideBorder(p, half));
      }
    }
    this.warAccum += dt;
    if (active !== this.warWasActive) {
      this.warWasActive = active;
      this.warAccum = 0;
      if (!active) out.push(...this.endWar());
      out.push({ to: 'all', msg: this.warSnapshotMsg() });
    } else if (this.warAccum >= WAR_BROADCAST) {
      this.warAccum = 0;
      if (active) out.push({ to: 'all', msg: this.warSnapshotMsg() });
    }
    return out;
  }

  /** Resolve a finished war: the faction with the most kills wins it (tie = a
   *  draw), earning a war win toward the season. Kills reset for the next war. */
  private endWar(): Outbound[] {
    const out: Outbound[] = [];
    let winner = NO_FACTION, best = -1, tie = false;
    for (const f of FACTIONS) {
      const k = this.warKills[f.id] ?? 0;
      if (k > best) { best = k; winner = f.id; tie = false; }
      else if (k === best) tie = true;
    }
    if (tie || best <= 0) winner = NO_FACTION;
    if (winner !== NO_FACTION) this.warWins[winner]++;
    out.push({ to: 'all', msg: { t: 'warEnd', winner, score: this.warKills.slice() } });
    out.push({ to: 'all', msg: { t: 'notice', text: winner === NO_FACTION
      ? 'The war ends in a DRAW.'
      : `${factionName(winner)} wins the war with ${best} kill${best === 1 ? '' : 's'}!` } });
    this.warKills = new Array(FACTIONS.length).fill(0);
    return out;
  }

  /** War wins per faction id (the season scoreboard). */
  private warWinCounts(): Record<number, number> {
    const counts: Record<number, number> = {};
    for (const f of FACTIONS) counts[f.id] = this.warWins[f.id] ?? 0;
    return counts;
  }

  // --- FACTION GOVERNMENT: elections, the treasury, and the powers of office --
  //
  // Rules live in politics.ts / treasury.ts (pure, shared with the offline
  // client and the smoke tests). Everything below is AUTHORITY: who is allowed
  // to ask for what, and who gets told about it.

  private notifySerial = 1;

  private treasuryOf(faction: number): Treasury {
    let t = this.treasuries.get(faction);
    if (!t) { t = newTreasuries().get(faction)!; this.treasuries.set(faction, t); }
    return t;
  }

  /** Live (online) player count per faction — folded into the citizen count so
   *  a transport with no account store still shows something real. */
  private onlineFactionCounts(): Record<number, number> {
    const counts: Record<number, number> = {};
    for (const f of FACTIONS) counts[f.id] = 0;
    for (const p of this.players.values()) {
      if (counts[p.faction] !== undefined) counts[p.faction]++;
    }
    return counts;
  }

  /**
   * The per-faction dossiers the allegiance screen reads. Deliberately built
   * from scratch rather than sliced off internal state: a player inspecting a
   * side they have not joined gets its president, its roster and its headline
   * numbers, and NOT what its treasury is holding.
   */
  private factionPublics(): FactionPublic[] {
    const online = this.onlineFactionCounts();
    return FACTIONS.map((f) => {
      const e = this.politics.elections[f.id];
      const g = this.politics.governments[f.id];
      const roster = this.factionRoster?.(f.id, FACTION_ROSTER_LIMIT);
      const members = roster ?? [...this.players.values()]
        .filter((p) => p.faction === f.id).map((p) => p.username)
        .sort((a, b) => a.localeCompare(b)).slice(0, FACTION_ROSTER_LIMIT);
      // Faces for the card's plinth. Only ONLINE members can supply real
      // cosmetics, and the president has their own portrait, so they are left
      // out of the crowd. A faction whose seat is vacant is what these are for:
      // its card shows the citizens you would be fighting alongside rather than
      // an empty stage.
      const faces = [...this.players.values()]
        .filter((p) => p.faction === f.id &&
          p.username.toLowerCase() !== (e.president ?? '').toLowerCase())
        .sort((a, b) => a.username.localeCompare(b.username))
        .slice(0, FACTION_FACES_LIMIT)
        .map((p) => ({ username: p.username, cosmetics: p.cosmetics }));
      const out: FactionPublic = {
        faction: f.id,
        members,
        memberCount: this.factionCitizens?.(f.id) ?? online[f.id] ?? 0,
        taxRate: g.taxRate,
        kitStock: g.kitStock,
        treasuryCount: treasuryCount(this.treasuryOf(f.id)),
        faces,
      };
      if (e.president) {
        const party = e.presidentPartyId ? partyById(e, e.presidentPartyId) : undefined;
        // Their gear is only knowable while they are online; an absent president
        // still shows their party and their face.
        const live = [...this.players.values()]
          .find((p) => p.username.toLowerCase() === e.president!.toLowerCase());
        out.president = {
          username: e.president,
          partyName: party?.name ?? 'Independent',
          slogan: party?.slogan ?? '',
          promises: party?.promises ?? [],
          cosmetics: live?.cosmetics,
          held: live?.held ? { id: live.held, count: 1 } : null,
          armor: (live?.armor ?? []).map((id) => (id ? { id, count: 1 } : null)),
        };
      }
      return out;
    });
  }

  /** The politics message for ONE recipient: shared state plus, if they have a
   *  faction, that faction's treasury contents. */
  private politicsMsgFor(p: ServerPlayer | undefined): ServerMsg {
    const msg: Extract<ServerMsg, { t: 'politics' }> = {
      t: 'politics', state: this.politics, factions: this.factionPublics(),
    };
    if (p && isFaction(p.faction)) msg.treasury = this.treasuryOf(p.faction).slots;
    return msg;
  }

  /** Push the whole politics state to everyone. One message per player, because
   *  the treasury half of it is faction-private. */
  private broadcastPolitics(): Outbound[] {
    const out: Outbound[] = [];
    for (const p of this.players.values()) {
      out.push({ to: p.id, msg: this.politicsMsgFor(p) });
    }
    return out;
  }

  private makeNotification(
    kind: Notification['kind'], title: string, body: string
  ): Notification {
    return {
      id: `n${this.notifySerial++}`, kind, title, body, at: this.wallNow(),
    };
  }

  /** Deliver one notification to every online member of a faction. */
  private notifyFaction(
    faction: number, kind: Notification['kind'], title: string, body: string,
    except?: number
  ): Outbound[] {
    if (!isFaction(faction)) return [];
    const notif = this.makeNotification(kind, title, body);
    const out: Outbound[] = [];
    for (const p of this.players.values()) {
      if (p.faction !== faction || p.id === except) continue;
      out.push({ to: p.id, msg: { t: 'notify', notif } });
    }
    return out;
  }

  private govErr(to: number, reason: string): Outbound[] {
    return [{ to, msg: { t: 'govErr', reason } }];
  }

  /** The inbox a player is handed on login: their faction's stored broadcasts,
   *  oldest first, so somebody who was away still hears what was said. */
  private inboxFor(faction: number): Notification[] {
    const g = governmentOf(this.politics, faction);
    if (!g) return [];
    return g.broadcasts.map((b: Broadcast) => ({
      id: `b${b.id}`, kind: 'broadcast' as const,
      title: `${factionName(faction)} broadcast · ${b.from}`,
      body: b.text, at: b.at,
    }));
  }

  /**
   * Levy the faction tax on items a citizen just pulled out of the world, and
   * bank it. Returns how many were taken (0 when there is no tax, no faction, or
   * the treasury is full — a full treasury must never eat somebody's ore, so
   * anything that does not fit is left with the player).
   */
  private levyInto(faction: number, id: number, count: number): number {
    if (!isFaction(faction)) return 0;
    const g = governmentOf(this.politics, faction);
    if (!g || g.taxRate <= 0) return 0;
    const want = levy(count, g.taxRate, this.rng());
    if (want <= 0) return 0;
    const t = this.treasuryOf(faction);
    const leftOver = deposit(t, id, want);
    const banked = want - leftOver;
    t.taken += banked;
    return banked;
  }

  /** Swear allegiance. One-shot: the account store owns "permanent", and this
   *  refuses anything it refuses. */
  private handlePledge(p: ServerPlayer, faction: number): Outbound[] {
    if (isFaction(p.faction)) {
      return this.govErr(p.id, 'You have already sworn allegiance — that choice is permanent.');
    }
    if (!isFaction(faction)) return this.govErr(p.id, 'That is not a faction.');
    // The account store is the authority; without one (tests/offline transports)
    // the in-memory player is.
    if (this.onPledge && !this.onPledge(p.username, faction)) {
      return this.govErr(p.id, 'You have already sworn allegiance — that choice is permanent.');
    }
    p.faction = faction;
    const s = this.spawn(faction);
    p.x = s.x; p.y = s.y; p.z = s.z;
    p.dead = false;
    p.health = maxHealthFor(p.hearts);
    const out: Outbound[] = [
      { to: p.id, msg: { t: 'pledged', faction } },
      { to: p.id, msg: { t: 'teleport', x: s.x, y: s.y, z: s.z } },
      // Everyone re-reads the newcomer: their nameplate and shirt just changed.
      { to: 'all', msg: { t: 'join', player: toInfo(p) } },
    ];
    out.push(...this.notifyFaction(faction, 'system', 'A new citizen',
      `${p.username} has sworn allegiance to ${factionName(faction)}.`, p.id));
    const g = governmentOf(this.politics, faction);
    if (g && g.kitStock > 0 && !this.kitClaimed?.(p.username)) {
      out.push({ to: p.id, msg: { t: 'notify', notif: this.makeNotification(
        'kit', 'A recruit kit is waiting',
        `${factionName(faction)} has funded ${g.kitStock} starter kit${g.kitStock === 1 ? '' : 's'}. ` +
        'Open /president to claim yours.') } });
    }
    out.push(...this.broadcastPolitics());
    return out;
  }

  private handleFoundParty(
    p: ServerPlayer, name: unknown, slogan: unknown, promises: unknown
  ): Outbound[] {
    const res = foundParty(this.politics, p.faction, p.username,
      name, slogan, promises, this.wallNow());
    if (!res.ok) return this.govErr(p.id, res.error ?? 'That party cannot stand.');
    return [
      ...this.notifyFaction(p.faction, 'election', 'A new party stands',
        `${res.party!.name} — "${res.party!.slogan}" — led by ${p.username}.`),
      ...this.broadcastPolitics(),
    ];
  }

  private handleDisbandParty(p: ServerPlayer): Outbound[] {
    const res = disbandParty(this.politics, p.faction, p.username);
    if (!res.ok) return this.govErr(p.id, res.error ?? 'You do not lead a party.');
    return this.broadcastPolitics();
  }

  private handleVote(p: ServerPlayer, partyId: unknown): Outbound[] {
    if (typeof partyId !== 'string') return this.govErr(p.id, 'No such party.');
    const res = castVote(this.politics, p.faction, p.username, partyId);
    if (!res.ok) return this.govErr(p.id, res.error ?? 'That vote cannot be cast.');
    return this.broadcastPolitics();
  }

  /** Guard shared by every power of office. */
  private requirePresident(p: ServerPlayer): string | null {
    if (!isFaction(p.faction)) return 'You have no faction.';
    if (!isPresident(this.politics, p.faction, p.username)) {
      return 'Only your faction\'s president can do that.';
    }
    return null;
  }

  private handleGovBroadcast(p: ServerPlayer, text: unknown): Outbound[] {
    const denied = this.requirePresident(p);
    if (denied) return this.govErr(p.id, denied);
    const g = governmentOf(this.politics, p.faction)!;
    const res = pushBroadcast(g, p.username, text, this.wallNow(), this.politics.serial++);
    if (!res.ok) return this.govErr(p.id, res.error ?? 'Say something first.');
    const notif = this.makeNotification('broadcast',
      `${factionName(p.faction)} broadcast · ${p.username}`, res.broadcast!.text);
    const out: Outbound[] = [];
    for (const other of this.players.values()) {
      if (other.faction !== p.faction) continue;
      out.push({ to: other.id, msg: { t: 'notify', notif } });
    }
    out.push(...this.broadcastPolitics());
    return out;
  }

  private handleGovTax(p: ServerPlayer, rate: unknown): Outbound[] {
    const denied = this.requirePresident(p);
    if (denied) return this.govErr(p.id, denied);
    const g = governmentOf(this.politics, p.faction)!;
    const before = g.taxRate;
    const res = setTaxRate(g, rate);
    if (!res.ok) return this.govErr(p.id, res.error ?? 'Not a tax rate.');
    if (g.taxRate === before) return this.broadcastPolitics();
    return [
      ...this.notifyFaction(p.faction, 'tax', 'The tax rate changed',
        `${p.username} set the levy to ${Math.round(g.taxRate * 100)}% ` +
        `(was ${Math.round(before * 100)}%).`),
      ...this.broadcastPolitics(),
    ];
  }

  /** Rewrite the recruit loadout. President-only, and re-validated slot by slot
   *  in politics.ts — a helmet in the boots slot is dropped here, not worn. */
  private handleSetKit(p: ServerPlayer, slots: unknown): Outbound[] {
    const denied = this.requirePresident(p);
    if (denied) return this.govErr(p.id, denied);
    const g = governmentOf(this.politics, p.faction)!;
    const res = setKit(g, slots);
    if (!res.ok) return this.govErr(p.id, res.error ?? 'That is not a kit layout.');
    return [
      ...this.notifyFaction(p.faction, 'kit', 'The recruit kit changed',
        `${p.username} re-issued the standard loadout — ` +
        `${kitItemCount(g.kit)} items per recruit.`),
      ...this.broadcastPolitics(),
    ];
  }

  /**
   * Fund `n` recruit kits at whatever the loadout currently costs.
   *
   * ONE purse: the president's own pockets. The treasury no longer buys kits —
   * arming your faction's newcomers is something a president does out of what
   * they personally dug up, so the stock waiting for recruits is a bill somebody
   * actually paid rather than a number spent out of a hoard the levy filled.
   *
   * The CLIENT has already removed the bill from its inventory by the time this
   * arrives, so the stock still comes from items that existed and the server
   * only has to record it. That is the same trust model `drop` runs on — the
   * client declaring what it just had.
   *
   * The bill deliberately does NOT pass through the treasury on its way. It used
   * to, so that one code path minted every kit; but nothing spends the hoard any
   * more, so a treasury that has filled up would start refusing to route kits it
   * was never paying for — a president unable to arm recruits out of their own
   * backpack because the levy box is full.
   *
   * `source` only ever arrives as 'inventory'. A build that still asks for the
   * retired treasury purse took nothing out of its own pockets, so honouring it
   * would mint free kits — it is refused.
   */
  private handleFundKits(
    p: ServerPlayer, count: unknown, source?: 'inventory'
  ): Outbound[] {
    const denied = this.requirePresident(p);
    if (denied) return this.govErr(p.id, denied);
    if (source !== undefined && source !== 'inventory') {
      return this.govErr(p.id, 'Recruit kits are funded from your own inventory now.');
    }
    const n = Number.isFinite(count) ? Math.floor(count as number) : 0;
    if (n <= 0 || n > 100) return this.govErr(p.id, 'Fund between 1 and 100 kits.');
    const g = governmentOf(this.politics, p.faction)!;
    const kit = kitStacks(g.kit);
    if (!kit.length) return this.govErr(p.id, 'The recruit kit is empty — build one first.');
    g.kitStock += n;
    return [
      ...this.notifyFaction(p.faction, 'kit', 'Recruit kits funded',
        `${p.username} funded ${n} starter kit${n === 1 ? '' : 's'} out of their own ` +
        `pockets — ${g.kitStock} now waiting.`),
      ...this.broadcastPolitics(),
    ];
  }

  /** Take the one recruit kit this account is entitled to, ever. */
  private handleClaimKit(p: ServerPlayer): Outbound[] {
    if (!isFaction(p.faction)) return this.govErr(p.id, 'You have no faction.');
    const g = governmentOf(this.politics, p.faction)!;
    if (g.kitStock <= 0) {
      return this.govErr(p.id, 'Your faction has no kits funded right now.');
    }
    if (this.kitClaimed?.(p.username)) {
      return this.govErr(p.id, 'You have already taken your recruit kit.');
    }
    // Claim on the ACCOUNT first: if that refuses, no stock is spent and no
    // items are minted.
    if (this.onClaimKit && !this.onClaimKit(p.username)) {
      return this.govErr(p.id, 'You have already taken your recruit kit.');
    }
    g.kitStock--;
    const out: Outbound[] = [];
    // Whatever THIS faction's president laid out, not the stock starter kit.
    for (const line of kitStacks(g.kit)) {
      out.push({ to: p.id, msg: { t: 'gotitem', item: line.id, count: line.count } });
    }
    out.push({ to: p.id, msg: { t: 'notice', text: '[KIT] Your faction funded this. Go build something.' } });
    out.push(...this.broadcastPolitics());
    return out;
  }

  /**
   * The gate on your own hoard: the sitting PRESIDENT, standing AT THE FLAG.
   *
   * Both halves matter. Office alone would make the treasury a menu a president
   * empties from the other side of the map; proximity alone would make the levy
   * a self-service counter for whoever wandered past. Together they put the
   * faction's savings somewhere a rival has to physically go — and somewhere the
   * enemy already knows to look for them during a war.
   *
   * Returns a refusal string, or null when the hoard may be opened.
   */
  private treasuryDenial(p: ServerPlayer, faction: unknown): string | null {
    // A spectator is already refused upstream (SPECTATOR_BLOCKED); creative is
    // deliberately allowed, because banking the levy is not a combat action and
    // an operator testing a government should not have to respawn to do it.
    if (p.dead) return 'Not right now.';
    if (!isFaction(p.faction)) return 'You have no faction.';
    if (faction !== p.faction) return 'That is not your hoard.';
    if (!isPresident(this.politics, p.faction, p.username)) {
      return 'Only your faction\'s president can open the hoard.';
    }
    if (treasuryInReach(p.x, p.z) !== p.faction) {
      return 'Walk to your flag — the hoard is only open where it stands.';
    }
    return null;
  }

  /** Open your own hoard: hands the president its live contents to fill the
   *  chest panel with. Read-only in itself; `treasurySet` does the writing. */
  private handleTreasuryOpen(p: ServerPlayer, faction: unknown): Outbound[] {
    const denied = this.treasuryDenial(p, faction);
    if (denied) return this.govErr(p.id, denied);
    const t = this.treasuryOf(p.faction);
    return [{ to: p.id, msg: {
      t: 'treasury', faction: p.faction, slots: t.slots.map((s) => (s ? { ...s } : null)),
    } }];
  }

  /**
   * Write one page of the hoard back after the president rearranged it.
   *
   * The client declares the page's contents, exactly as `chestSet` does — the
   * president can already carry the whole hoard away by hand, so trusting the
   * arrangement they hand back costs nothing that the take does not already
   * cost. Every slot is still re-validated (`setTreasuryPage`), and the write is
   * scoped to ONE page so a raid landing on another page during the edit is not
   * undone by it.
   */
  private handleTreasurySet(
    p: ServerPlayer, faction: unknown, page: unknown, slots: unknown
  ): Outbound[] {
    const denied = this.treasuryDenial(p, faction);
    if (denied) return this.govErr(p.id, denied);
    const t = this.treasuryOf(p.faction);
    if (!setTreasuryPage(t.slots, page as number, slots)) {
      return this.govErr(p.id, 'That is not a page of the hoard.');
    }
    return this.broadcastPolitics();
  }

  /**
   * Haul stacks out of the ENEMY treasury. Only during a war window, only from
   * inside reach of their pad, and never from your own — so this is a reason to
   * defend the flag site during a war, not a permanent grief button.
   */
  private handleTreasuryRaid(p: ServerPlayer, faction: unknown): Outbound[] {
    if (p.dead || p.mode !== 'survival') return [];
    if (!isFaction(p.faction)) return this.govErr(p.id, 'You have no faction.');
    if (!isFaction(faction as number) || faction === p.faction) {
      return this.govErr(p.id, 'That is not an enemy treasury.');
    }
    if (!this.isWarActive()) {
      return this.govErr(p.id, 'The strongbox is sealed. It can only be forced during a war.');
    }
    if (treasuryInReach(p.x, p.z) !== faction) {
      return this.govErr(p.id, 'Stand at their treasury first.');
    }
    if (this.worldTime - (p.lastTreasuryRaid ?? -Infinity) < RAID_COOLDOWN) {
      return this.govErr(p.id, 'You are still hauling the last load — wait a moment.');
    }
    const t = this.treasuryOf(faction as number);
    const loot = raid(t, p.username, this.wallNow(), RAID_STACKS);
    if (!loot.length) return this.govErr(p.id, 'The strongbox is empty.');
    p.lastTreasuryRaid = this.worldTime;
    const out: Outbound[] = [];
    for (const stack of loot) {
      out.push({ to: p.id, msg: { t: 'gotitem', item: stack.id, count: stack.count } });
    }
    out.push({ to: 'all', msg: {
      t: 'treasuryRaided', faction: faction as number, by: p.username, stacks: loot.length } });
    out.push(...this.notifyFaction(faction as number, 'raid', 'THE TREASURY IS BEING ROBBED',
      `${p.username} hauled ${loot.length} stack${loot.length === 1 ? '' : 's'} out of the ` +
      `${factionName(faction as number)} strongbox. Get to the flag.`));
    out.push(...this.broadcastPolitics());
    return out;
  }

  /**
   * Advance the election clock. Weekly terms on the WALL clock, checked about
   * once a second — a seven-day deadline does not need the tick rate.
   */
  tickPolitics(dt: number): Outbound[] {
    if (!fin(dt) || dt <= 0) return [];
    this.politicsAccum += dt;
    if (this.politicsAccum < 1) return [];
    this.politicsAccum = 0;
    const now = this.wallNow();
    const out: Outbound[] = [];
    let changed = this.politicsDirty;
    this.politicsDirty = false;
    for (const f of FACTIONS) {
      const e = this.politics.elections[f.id];
      if (!termExpired(e, now)) continue;
      const before = e.president;
      const { president, party } = tallyElection(e);
      const counts = voteCounts(e);
      rollCycle(e, now);
      changed = true;
      if (party) {
        out.push(...this.notifyFaction(f.id, 'election',
          `${party.name} wins the election`,
          `${president} takes office for term ${e.cycle} with ${counts[party.id]} vote` +
          `${counts[party.id] === 1 ? '' : 's'}${before && before !== president
            ? `, unseating ${before}` : ''}.`));
      } else {
        out.push(...this.notifyFaction(f.id, 'election', 'Nobody voted',
          before
            ? `${before} stays in office by default. Term ${e.cycle} is open — stand a party.`
            : `The presidency is still vacant. Term ${e.cycle} is open — stand a party.`));
      }
    }
    if (changed) out.push(...this.broadcastPolitics());
    return out;
  }

  /** Console/report: one line per faction. */
  politicsStatusText(): string {
    const now = this.wallNow();
    const lines: string[] = [];
    for (const f of FACTIONS) {
      const e = this.politics.elections[f.id];
      const g = this.politics.governments[f.id];
      const days = Math.max(0, (e.endsAt - now) / 86400000);
      lines.push(`${factionName(f.id)}: president ${e.president ?? '(vacant)'} · ` +
        `term ${e.cycle}, ${days.toFixed(1)}d left · ${e.parties.length} part` +
        `${e.parties.length === 1 ? 'y' : 'ies'} · tax ${Math.round(g.taxRate * 100)}% · ` +
        `treasury ${treasuryCount(this.treasuryOf(f.id))} items · ${g.kitStock} kits`);
    }
    return lines.join('\n');
  }

  /** Admin: force this faction's term to end now (console `election tally`). */
  adminTallyElection(faction: number): Outbound[] {
    const e = electionOf(this.politics, faction);
    if (!e) return [];
    e.endsAt = this.wallNow() - 1;
    this.politicsAccum = 1;
    return this.tickPolitics(1);
  }

  /** Admin: put items straight into a faction treasury (console `treasury give`). */
  adminDepositTreasury(faction: number, item: number, count: number): boolean {
    if (!isFaction(faction) || !ITEMS[item] || !fin(count) || count <= 0) return false;
    const t = this.treasuryOf(faction);
    const left = deposit(t, item, Math.floor(count));
    t.taken += Math.floor(count) - left;
    return left < Math.floor(count);
  }

  // --- Seasons (Phase 5) -----------------------------------------------------

  /** Live season state for the HUD (number + seconds left, or -1 for a season
   *  with no deadline — which is every season now). */
  seasonSnapshot(): ServerMsg {
    return {
      t: 'season', number: this.season.number, timeLeft: seasonWireTimeLeft(this.season),
    };
  }

  /** Advance the season clock. Seasons are ENDLESS (season.ts), so the deadline
   *  branch below never fires and the clock is now only a record of how long the
   *  season has run. It is kept exact so a finite SEASON_LENGTH brings timed
   *  seasons straight back, where the faction with the most WAR WINS takes it
   *  (a tie is a stalemate). Periodically broadcasts the clock for the HUD. */
  tickSeason(dt: number): Outbound[] {
    if (!fin(dt) || dt <= 0) return [];
    tickSeasonClock(this.season, dt);
    const out: Outbound[] = [];
    if (seasonExpired(this.season)) {
      out.push(...this.endSeason(deadlineWinner(this.warWinCounts())));
      return out;
    }
    this.seasonAccum += dt;
    if (this.seasonAccum >= SEASON_BROADCAST) {
      this.seasonAccum = 0;
      out.push({ to: 'all', msg: this.seasonSnapshot() });
    }
    return out;
  }

  /**
   * End the current season and start the next: announce the winner (NO_FACTION =
   * stalemate), award the "Seasons Won" badge via the shell callback, then reset
   * the war scoreboard. Player inventories/accounts are untouched.
   */
  endSeason(winner: number): Outbound[] {
    const out: Outbound[] = [];
    const ended = this.season.number;
    this.onSeasonEnd?.(winner, ended); // shell persists badges to winning accounts
    // Fresh season: war wins + kills reset; accounts/inventories are untouched.
    this.warKills = new Array(FACTIONS.length).fill(0);
    this.warWins = new Array(FACTIONS.length).fill(0);
    advanceSeason(this.season);
    this.seasonAccum = 0;
    out.push({ to: 'all', msg: { t: 'seasonEnd', winner, number: ended } });
    out.push({ to: 'all', msg: this.seasonSnapshot() });
    out.push({ to: 'all', msg: this.warSnapshotMsg() });
    return out;
  }

  // --- Secret faction switching (Phase 7) ------------------------------------

  /**
   * Defect to the other faction. SECRET: there is NO broadcast — other clients
   * keep seeing the old colors (the defector is effectively a spy), while the
   * server immediately treats them as the new faction for combat/ownership. The
   * defector forfeits this season's "Seasons Won" badge. Max 2 switches/season,
   * locked the final week.
   */
  private handleSwitch(p: ServerPlayer, target: number): Outbound[] {
    const cur = p.faction, season = this.season.number;
    const st = { switchesUsed: p.switchesUsed, switchSeason: p.switchSeason };
    if (!canSwitchFaction(st, season, cur, target, seasonTimeLeft(this.season))) {
      return [{ to: p.id, msg: { t: 'notice', text: 'You can\'t switch sides right now (limit reached or final week).' } }];
    }
    if (p.switchSeason !== season) { p.switchesUsed = 0; p.switchSeason = season; }
    p.switchesUsed++;
    p.faction = target;
    p.forfeitSeason = season; // no badge this season — loyalty stays meaningful
    this.onFactionSwitch?.(p.username, target, p.switchesUsed, p.switchSeason, p.forfeitSeason);
    // Private confirmation ONLY (no public announcement).
    const remaining = switchesRemaining({ switchesUsed: p.switchesUsed, switchSeason: p.switchSeason }, season);
    return [
      { to: p.id, msg: { t: 'factionSwitched', faction: target, remaining } },
    ];
  }

  // --- Gadgets (Phase 8): server-authoritative effects -----------------------

  /**
   * Apply a gadget's authoritative effect: AoE damage (frag/oil bomb/C4), a
   * cosmetic broadcast (smoke / war horn), or a spy disguise. Cooldown + range
   * are server-validated so a hacked client can't spam or blast from across the
   * map. Other gadgets (grapple/cover/sentry) route through existing paths
   * (edits) and never reach here.
   */
  private handleGadget(p: ServerPlayer, item: number, x: number, y: number, z: number): Outbound[] {
    const def = gadgetOf(item);
    if (!def || p.dead) return [];
    const now = this.worldTime;
    switch (def.kind) {
      case 'frag': case 'oil': case 'smoke': case 'c4': {
        if (!fin(x, y, z)) return [];
        // The detonation must be within throw range of the thrower.
        if (Math.hypot(x - p.x, y - p.y, z - p.z) > RANGED_MAX_RANGE) return [];
        if (!p.gadgetCd.use(item, now)) return []; // cooldown
        const out: Outbound[] = [{ to: 'all', msg: { t: 'gadgetFx', kind: def.kind, x, y, z } }];
        if (def.kind !== 'smoke') { // frag/oil/c4 all detonate
          out.push(...this.detonate(p, x, y, z,
            def.damage ?? 0, def.radius ?? 0, def.radius ?? 4));
        }
        return out;
      }
      case 'horn': {
        // War Horn: a cosmetic rallying blast anyone can sound.
        if (!p.gadgetCd.use(item, now)) return [];
        return [{ to: 'all', msg: { t: 'gadgetFx', kind: 'horn', x: p.x, y: p.y, z: p.z } }];
      }
      case 'disguise': {
        if (!p.gadgetCd.use(item, now)) return [];
        const until = now + (def.duration ?? 30);
        // Disguise as the OTHER faction; broadcast to everyone else only.
        const faction = this.otherFactionId(p.faction);
        return [{ to: 'others', from: p.id, msg: { t: 'disguised', id: p.id, faction, until } }];
      }
      default:
        return []; // client-handled gadget kind
    }
  }

  /** A rocket detonation reported by the shooter's client: validate the burst is
   *  within range, then apply the server-authoritative splash. The shooter
   *  already ran the local blast, so the crater goes to everyone else. Damage +
   *  radii are fixed server-side (the client supplies only the burst point). */
  private handleRocketBlast(p: ServerPlayer, x: number, y: number, z: number): Outbound[] {
    if (p.dead || !fin(x, y, z)) return [];
    if (Math.hypot(x - p.x, y - p.y, z - p.z) > RANGED_MAX_RANGE) return [];
    // FX first: the shooter already ran the blast locally, but for everyone
    // else the crater would otherwise be blocks silently vanishing. (Thrown
    // gadgets don't need this — they broadcast their own `gadgetFx`.)
    return [
      { to: 'others', from: p.id, msg: { t: 'blast', x, y, z } },
      ...this.detonate(p, x, y, z,
        ROCKET_BLAST_DAMAGE, ROCKET_BLAST_RADIUS, ROCKET_CRATER_RADIUS),
    ];
  }

  /** Shared explosive blast: server-authoritative AoE damage to enemies (linear
   *  falloff over dmgRadius), a broadcast crater of player-placed blocks (radius
   *  blastR), and machine demolition. The instigator already ran the local
   *  blast, so crater edits go to 'others' and the instigator is never
   *  self-damaged here. Friendly fire stays off. */
  private detonate(
    by: ServerPlayer, x: number, y: number, z: number,
    damage: number, dmgRadius: number, blastR: number,
  ): Outbound[] {
    const out: Outbound[] = [];
    if (damage > 0 && dmgRadius > 0) {
      // AoE damage to living enemies in radius (friendly fire stays off).
      for (const t of this.players.values()) {
        if (t.dead || t.arenaSaved || t.id === by.id || sameFaction(t.faction, by.faction)) continue;
        const d = Math.hypot(t.x - x, t.y - y, t.z - z);
        const dmg = falloffDamage(damage, d, dmgRadius);
        if (dmg > 0) out.push(...this.applyDamage(t, dmg, by.id,
          { x: (t.x - x) || 0.01, y: 0.4, z: (t.z - z) || 0 }, true));
      }
    }
    // Break player-placed blocks in a sphere and broadcast each removal so every
    // other client sees the crater. Natural terrain isn't networked, so it's
    // skipped; bedrock/indestructible (hardness < 0) survives.
    const ir = Math.ceil(blastR);
    const r2 = blastR * blastR + 1;
    for (let dx = -ir; dx <= ir; dx++) {
      for (let dy = -ir; dy <= ir; dy++) {
        for (let dz = -ir; dz <= ir; dz++) {
          if (dx * dx + dy * dy + dz * dz > r2) continue;
          const bx = Math.floor(x) + dx;
          const by2 = Math.floor(y) + dy;
          const bz = Math.floor(z) + dz;
          const key = `${bx},${by2},${bz}`;
          const existing = this.edits.get(key);
          if (existing === undefined || existing === Block.Air) continue;
          if ((BLOCKS[existing]?.hardness ?? -1) < 0) continue;
          // Vault blocks are blast-proof (dungeons can't be cracked open).
          if (isVaultMasonry(existing) || existing === Block.VaultChest) continue;
          this.edits.set(key, Block.Air);
          out.push({ to: 'others', from: by.id, msg: { t: 'edit', x: bx, y: by2, z: bz, block: Block.Air } });
        }
      }
    }
    // Machines are immune to bullets/melee but DEMOLISHED outright by a blast.
    const machineR = blastR + 1.5;
    for (const key of [...this.machines.keys()]) {
      const [mx, my, mz] = key.split(',').map(Number);
      if (Math.hypot(mx + 0.5 - x, my + 0.5 - y, mz + 0.5 - z) <= machineR) {
        out.push(...this.destroyMachine(key, mx, my, mz));
      }
    }
    return out;
  }

  /** The opposing faction id (two-faction war). */
  private otherFactionId(faction: number): number {
    return faction === FACTIONS[0].id ? FACTIONS[1].id : FACTIONS[0].id;
  }

  // --- Admin (server-console) operations ------------------------------------
  // Issued from the trusted server console (no in-game auth). The shell parses
  // a typed command line and calls these; each returns Outbound[] to dispatch.

  /** Online player id by (case-insensitive) username, or undefined. */
  playerIdByName(name: string): number | undefined {
    const lc = String(name).toLowerCase();
    for (const p of this.players.values()) if (p.username.toLowerCase() === lc) return p.id;
    return undefined;
  }

  /** Roster for console display. */
  playerList(): { id: number; username: string; faction: number; mode: GameMode }[] {
    return [...this.players.values()].map((p) =>
      ({ id: p.id, username: p.username, faction: p.faction, mode: p.mode }));
  }

  /** Live coordinates of every online player (console `coords`). */
  playerCoords(): { id: number; username: string; x: number; y: number; z: number }[] {
    return [...this.players.values()].map((p) =>
      ({ id: p.id, username: p.username, x: p.x, y: p.y, z: p.z }));
  }

  /** Grant items to an online player (console `give`); same dup-safe gotitem
   *  path as a pickup, so it stacks into their inventory client-side. */
  adminGive(id: number, item: number, count: number): Outbound[] {
    const p = this.players.get(id);
    if (!p || !ITEMS[item] || !Number.isFinite(count) || count <= 0) return [];
    return [{ to: id, msg: { t: 'gotitem', item, count: Math.floor(count) } }];
  }

  /** Set a player's gamemode (console `gamemode`). Broadcast so every client
   *  updates rendering (spectators render hidden) and the target applies its
   *  own fly/noclip locally. */
  adminSetMode(id: number, mode: GameMode): Outbound[] {
    const p = this.players.get(id);
    if (!p) return [];
    p.mode = mode;
    // Don't strand an admin "dead" in creative/spectator — heal + revive.
    if (mode !== 'survival') { p.health = maxHealthFor(p.hearts); p.dead = false; }
    return [
      { to: 'all', msg: { t: 'gamemode', id, mode } },
      { to: id, msg: { t: 'notice', text: `Gamemode set to ${mode}` } },
    ];
  }

  /** Set a player's hearts (console `sethearts`). Clamps to the lifesteal
   *  range and shrinks health into the new max. */
  adminSetHearts(id: number, hearts: number): Outbound[] {
    const p = this.players.get(id);
    if (!p || !fin(hearts)) return [];
    p.hearts = clampHearts(hearts);
    p.health = Math.min(p.health, maxHealthFor(p.hearts));
    return [
      { to: id, msg: { t: 'hearts', hearts: p.hearts, reason: 'admin' } },
      { to: id, msg: { t: 'notice', text: `An admin set your hearts to ${p.hearts} hearts` } },
    ];
  }

  /** All map landmarks (surface structures + vault entrances), computed once
   *  from the seed — for the admin `tpstruct` command. */
  private landmarkCache?: { x: number; z: number; kind: string }[];
  private landmarks(): { x: number; z: number; kind: string }[] {
    if (!this.landmarkCache) {
      this.landmarkCache = [
        ...worldStructures(this.seed, this.terrain).map((s) => ({ x: s.x, z: s.z, kind: s.kind })),
        ...worldVaults(this.seed, this.terrain).map((v) => ({ x: v.x, z: v.z, kind: 'vault' })),
      ];
    }
    return this.landmarkCache;
  }

  /** The nearest landmark to a player (optionally filtered by kind), with a
   *  standable Y on the surface. Null if none match (console `tpstruct`). */
  nearestStructure(
    id: number, kind?: string
  ): { kind: string; x: number; y: number; z: number } | null {
    const p = this.players.get(id);
    if (!p) return null;
    let best: { x: number; z: number; kind: string } | null = null;
    let bestD = Infinity;
    for (const s of this.landmarks()) {
      if (kind && s.kind !== kind) continue;
      const d = (s.x - p.x) ** 2 + (s.z - p.z) ** 2;
      if (d < bestD) { bestD = d; best = s; }
    }
    if (!best) return null;
    return { kind: best.kind, x: best.x, y: this.terrain.height(best.x, best.z) + 1, z: best.z };
  }

  /** Teleport a player to an absolute position (console `tp`). */
  adminTeleport(id: number, x: number, y: number, z: number): Outbound[] {
    const p = this.players.get(id);
    if (!p || !fin(x, y, z)) return [];
    // Clamp inside the world border and to a survivable height.
    x = Math.max(-WORLD_HALF, Math.min(WORLD_HALF, x));
    z = Math.max(-WORLD_HALF, Math.min(WORLD_HALF, z));
    y = Math.max(1, Math.min(255, y));
    p.x = x; p.y = y; p.z = z;
    return [{ to: id, msg: { t: 'teleport', x, y, z } }];
  }

  // --- War scheduling (admin console) ---------------------------------------
  // These set the war window in worldTime seconds and broadcast the new clock.

  /** Schedule a war to begin `delaySec` from now, lasting `durationSec`. */
  adminScheduleWar(delaySec: number, durationSec: number): Outbound[] {
    const dur = fin(durationSec) && durationSec > 0 ? durationSec : DEFAULT_WAR_DURATION;
    this.war = scheduleWar(fin(delaySec) ? delaySec : 0, dur, this.worldTime);
    this.warWasActive = this.isWarActive();
    this.warAccum = 0;
    this.warKills = new Array(FACTIONS.length).fill(0); // fresh scoreboard
    const out: Outbound[] = [{ to: 'all', msg: this.warSnapshotMsg() }];
    const banner = delaySec <= 0
      ? 'WAR! The border is closing — fight!'
      : `A war is scheduled — get ready!`;
    out.push({ to: 'all', msg: { t: 'notice', text: banner } });
    return out;
  }

  /** Start a war right now for `durationSec` (console `war start`). */
  adminStartWar(durationSec: number): Outbound[] { return this.adminScheduleWar(0, durationSec); }

  /** Cancel the current/scheduled war back to peacetime. */
  adminCancelWar(): Outbound[] {
    this.war = newWar();
    this.warWasActive = false;
    this.warAccum = 0;
    this.warKills = new Array(FACTIONS.length).fill(0);
    return [
      { to: 'all', msg: this.warSnapshotMsg() },
      { to: 'all', msg: { t: 'notice', text: 'The war is over — peacetime.' } },
    ];
  }

  /** One-line war status for the console. */
  warStatusText(): string {
    const w = warSnapshot(this.war, this.worldTime);
    const mmss = (s: number) => `${Math.floor(s / 60)}m ${Math.floor(s % 60)}s`;
    if (w.active) return `WAR ACTIVE — ${mmss(w.timeLeft)} left`;
    if (w.nextIn > 0) return `peacetime — next war in ${mmss(w.nextIn)}`;
    return 'peacetime — no war scheduled';
  }

  /** Build the persistable per-account blob for a player: their last client-
   *  pushed inventory/hotbar plus the server-authoritative position. Returns
   *  null if the player isn't online. */
  capturePlayerState(id: number): { username: string; data: Record<string, unknown> } | null {
    const p = this.players.get(id);
    if (!p) return null;
    const saved = p.arenaSaved;
    const data: Record<string, unknown> =
      stripMinigameItems({ ...(saved?.savedClientData ?? p.savedClientData ?? {}) });
    data.x = saved?.x ?? p.x; data.y = saved?.y ?? p.y; data.z = saved?.z ?? p.z;
    data.yaw = saved?.yaw ?? p.yaw; data.mode = saved?.mode ?? p.mode;
    data.hearts = p.hearts; // lifesteal max-health currency survives re-login
    if (p.cosmetics) data.cosmetics = p.cosmetics; // avatar look survives re-login
    data.totems = p.totems.slice(); // attuned Waypoint Totems survive re-login
    // Persist the personal respawn point so it survives a reconnect.
    if (fin(p.spawnX as number, p.spawnY as number, p.spawnZ as number)) {
      data.spawnX = p.spawnX; data.spawnY = p.spawnY; data.spawnZ = p.spawnZ;
    }
    return { username: p.username, data };
  }

  // --- Persistence ----------------------------------------------------------
  // The whole authoritative world (player-made changes) serialized to a plain
  // JSON-able object the shell writes to disk and reloads on boot. Dropped item
  // entities are ephemeral (not saved).

  serialize(): WorldSave {
    return {
      v: 3,
      seed: this.seed,
      worldTime: this.worldTime,
      edits: [...this.edits.entries()],
      chests: [...this.chests.entries()],
      machines: [...this.machines.entries()],
      turrets: [...this.turrets.entries()],
      season: this.season,
      war: this.war,
      warWins: this.warWins.slice(),
      flags: this.flags,
      politics: this.politics,
      treasuries: [...this.treasuries.entries()],
      vaults: [...this.vaults.entries()],
      helis: [...this.vehicles.helicopters.values()].filter((h) => h.dying <= 0),
      // peekNextId, NOT allocId: a serializer must be read-only, or every
      // autosave would permanently burn an entity id.
      strategicNextId: this.vehicles.peekNextId(),
    };
  }

  /** Restore a saved world (server boot). Fail-closed per record: a malformed
   *  entry is skipped, never crashes the load. Returns true if anything loaded. */
  restore(save: unknown): boolean {
    if (!save || typeof save !== 'object') return false;
    const s = save as Partial<WorldSave>;
    if (s.seed !== undefined && s.seed !== this.seed) {
      // A save from a different seed describes a different world — refuse it so
      // we don't smear edits across mismatched terrain.
      return false;
    }
    if (Number.isFinite(s.worldTime)) this.worldTime = s.worldTime as number;

    if (Array.isArray(s.edits)) {
      for (const e of s.edits) {
        if (!Array.isArray(e) || e.length !== 2) continue;
        const [k, b] = e as [unknown, unknown];
        if (validBlockKey(k) && Number.isInteger(b) && (b as number) >= 0 && (b as number) <= 255) {
          // Retired hardware ids become Air, so a world saved with a silo in it
          // still loads (and renders) after that hardware was removed.
          this.edits.set(k as string, migrateBlockId(b as number));
        }
      }
    }
    if (Array.isArray(s.chests)) {
      for (const e of s.chests) {
        if (!Array.isArray(e) || e.length !== 2) continue;
        const [k, slots] = e as [unknown, unknown];
        if (validBlockKey(k) && Array.isArray(slots)) {
          this.chests.set(k as string, sanitizeSlots(slots));
        }
      }
    }
    if (Array.isArray(s.machines)) {
      for (const e of s.machines) {
        if (!Array.isArray(e) || e.length !== 2) continue;
        const [k, raw] = e as [unknown, unknown];
        const st = sanitizeMachineState(raw);
        if (validBlockKey(k) && st) this.machines.set(k as string, st);
      }
    }
    if (Array.isArray(s.turrets)) {
      for (const e of s.turrets) {
        if (!Array.isArray(e) || e.length !== 2) continue;
        const [k, raw] = e as [unknown, unknown];
        const st = sanitizeTurretState(raw);
        if (validBlockKey(k) && st) this.turrets.set(k as string, st);
      }
    }
    if (Array.isArray(s.vaults)) {
      for (const e of s.vaults) {
        if (!Array.isArray(e) || e.length !== 2) continue;
        const [k, raw] = e as [unknown, unknown];
        const st = sanitizeVaultState(raw);
        if (typeof k === 'string' && /^-?\d+,-?\d+$/.test(k) && st) {
          this.vaults.set(k, st);
        }
      }
    }
    this.season = sanitizeSeason(s.season);
    this.war = sanitizeWar(s.war);
    this.warWasActive = this.isWarActive();
    this.warWins = sanitizeCounterArray(s.warWins, FACTIONS.length);
    // Warfare Command hardware. Bombs in the air are deliberately NOT restored —
    // a restart cancels anything mid-fall rather than resuming a stale arc.
    let highestId = 0;
    for (const raw of Array.isArray(s.helis) ? s.helis : []) {
      const h = sanitizeHelicopter(raw);
      if (!h) continue;
      this.vehicles.helicopters.set(h.id, h);
      highestId = Math.max(highestId, h.id);
    }
    if (Number.isFinite(s.strategicNextId)) {
      highestId = Math.max(highestId, Math.floor(s.strategicNextId as number) - 1);
    }
    this.vehicles.seedIds(highestId);
    this.vehicles.clearOccupants();   // occupants never survive a restart
    this.flags = sanitizeFlags(s.flags); // carriers never survive a reboot
    // Government. A v2 save carries neither key and simply comes back with a
    // fresh election clock and empty strongboxes — fail-closed, like every other
    // record here, rather than refusing the whole world.
    this.politics = sanitizePolitics(s.politics, this.wallNow());
    this.treasuries = newTreasuries();
    for (const entry of Array.isArray(s.treasuries) ? s.treasuries : []) {
      if (!Array.isArray(entry) || entry.length !== 2) continue;
      const [faction, raw] = entry as [unknown, unknown];
      if (!isFaction(faction as number)) continue;
      this.treasuries.set(faction as number, sanitizeTreasury(raw, faction as number));
    }
    return true;
  }

  /** Transform+health for every player (the periodic broadcast). */
  snapshot(): PlayerSnapshot[] {
    return [...this.players.values()].map((p) => ({
      id: p.id, x: p.x, y: p.y, z: p.z, yaw: p.yaw, pitch: p.pitch,
      health: p.health, dead: p.dead,
      gliding: p.gliding, boating: p.boating, seated: p.seated, sneaking: p.sneaking,
      held: p.held, armor: p.armor, swing: p.swing,
      aiming: p.aiming, reloading: p.reloading,
    }));
  }

  /** Per-recipient visibility snapshot. Normal-world players never receive an
   * arena transform; an arena player receives only their own match. */
  snapshotFor(recipientId: number): PlayerSnapshot[] {
    const recipient = this.players.get(recipientId);
    if (!recipient) return [];
    // Lobby members still occupy the normal world. `arenaSaved` becomes set
    // only when an arena body is created, and remains set through results.
    // Using phaseFor here also scoped ordinary lobby members out of snapshots
    // after they dismissed the lobby with Escape.
    const inDuel = !!recipient.arenaSaved;
    const visible = inDuel ? new Set(this.duels.membersOf(recipientId)) : null;
    return [...this.players.values()]
      .filter((p) => {
        const pInDuel = !!p.arenaSaved;
        if (inDuel) return visible!.has(p.id);
        return !pInDuel;
      })
      .map((p) => ({
        id: p.id, x: p.x, y: p.y, z: p.z, yaw: p.yaw, pitch: p.pitch,
        health: p.health,
        // A respawn spectator is invisible to opponents, while their own
        // client stays technically alive to bypass the normal death screen.
        dead: p.arenaSaved
          ? p.id !== recipientId && this.duels.participantFor(p.id)?.spectating === true
          : p.dead,
        gliding: p.arenaSaved ? false : p.gliding,
        boating: p.arenaSaved ? false : p.boating,
        seated: p.arenaSaved ? false : p.seated, sneaking: p.sneaking,
        held: p.held, armor: p.armor, swing: p.swing,
        aiming: p.aiming, reloading: p.reloading,
      }));
  }

  /** Broadcasts are open-world by default. Duels traffic is always addressed
   * directly to match members, so this single gate prevents world event leaks. */
  receivesWorldBroadcast(id: number): boolean {
    const p = this.players.get(id);
    if (!p) return false;
    return !p.arenaSaved;
  }
}

function toInfo(p: ServerPlayer): PlayerInfo {
  return {
    id: p.id, username: p.username, skin: p.skin, faction: p.faction, mode: p.mode,
    seasonsWon: p.seasonsWon, hearts: p.hearts, duelProfile: p.duelProfile, cosmetics: p.cosmetics,
    x: p.x, y: p.y, z: p.z, yaw: p.yaw, pitch: p.pitch,
    health: p.health, dead: p.dead,
    gliding: p.gliding, boating: p.boating, seated: p.seated, sneaking: p.sneaking,
    held: p.held, armor: p.armor, swing: p.swing,
    aiming: p.aiming, reloading: p.reloading,
  };
}

/** On-disk world snapshot (see GameServer.serialize/restore). */
export interface WorldSave {
  v: number;
  seed: number;
  worldTime: number;
  edits: [string, number][];
  chests: [string, (ItemStack | null)[]][];
  machines: [string, MachineState][];
  turrets: [string, TurretState][];
  season?: SeasonState;
  war?: WarState;
  /** War wins per faction id this season (the season scoreboard). */
  warWins?: number[];
  /** Warfare Command aviation hardware. Bombs in the air are deliberately NOT
   *  saved — a restart cancels anything falling rather than restoring it. */
  helis?: HelicopterState[];
  /** Entity-id floor (legacy key name, kept so old saves still seed it). */
  strategicNextId?: number;
  /** Capture-the-flag state: who holds which flag + the armed switch. */
  flags?: FlagsState;
  /** Elections, parties and governments (politics.ts). Absent in a v2 save. */
  politics?: PoliticsState;
  /** One strongbox per faction (treasury.ts). Absent in a v2 save. */
  treasuries?: [number, Treasury][];
  /** Vault boss HP + per-player openedBy ledgers (Milestone D). */
  vaults?: [string, VaultServerState][];
}

/** A "x,y,z" integer block-coordinate key (the map keys we persist). */
/** Fail-closed non-negative integer array of a fixed length (war scoreboards). */
function sanitizeCounterArray(raw: unknown, n: number): number[] {
  const out = new Array<number>(n).fill(0);
  if (!Array.isArray(raw)) return out;
  for (let i = 0; i < n; i++) {
    const v = raw[i];
    out[i] = Number.isFinite(v) ? Math.max(0, Math.floor(v as number)) : 0;
  }
  return out;
}

function validBlockKey(k: unknown): k is string {
  return typeof k === 'string' && /^-?\d+,-?\d+,-?\d+$/.test(k);
}

/** Fail-closed validation of a chest's slot array loaded from disk. */
function sanitizeSlots(raw: unknown[]): (ItemStack | null)[] {
  const out: (ItemStack | null)[] = [];
  for (let i = 0; i < Math.min(raw.length, CHEST_SLOTS); i++) {
    const s = raw[i] as Partial<ItemStack> | null;
    if (s && Number.isInteger(s.id) && Number.isFinite(s.count) && (s.count as number) > 0 && ITEMS[s.id as number]) {
      const stack: ItemStack = { id: s.id as number, count: Math.floor(s.count as number) };
      if (Number.isFinite(s.loaded)) stack.loaded = Math.max(0, Math.floor(s.loaded as number));
      if (Number.isFinite(s.damage)) stack.damage = Math.max(0, s.damage as number);
      if (Number.isFinite(s.xp)) stack.xp = Math.max(0, s.xp as number);
      if (Number.isInteger(s.rune) && ITEMS[s.rune as number]) stack.rune = s.rune as number;
      out.push(stack);
    } else {
      out.push(null);
    }
  }
  while (out.length < CHEST_SLOTS) out.push(null);
  return out;
}
