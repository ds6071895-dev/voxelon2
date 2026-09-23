// Authoritative-lite game server logic, transport-agnostic and pure (no ws,
// no Node APIs) so it can be unit-tested headlessly and reused by the WS
// shell. Owns: the shared edit log, every player's health, username
// assignment, spawns (via the shared deterministic Terrain), PvP hit
// validation, regen, and snapshots.

import { BLOCKS, Block, isVaultMasonry, migrateBlockId } from '../blocks';
import { ITEMS, ItemStack, gunVolley } from '../items';
import {
  MachineState, MachineType, MachineAct, YieldContext, applyUpgrade, claimMachine, collectMachine,
  damageMachine, machineHeight, machineTypeForBlock, newMachine, setFilter,
  tickMachine, sanitizeState as sanitizeMachineState, machineFriendly, machineCanClaim,
  siphonMachine, applyMachineAct, igniteWell, relocateMachine, linkFuel, machineContext,
  depositInto, HOPPER_SIDES, totalStored,
} from '../machines';
import { Item } from '../items';
import {
  TurretState, applyTurretUpgrade, claimTurret, damageTurret, newTurret,
  turretArmed, turretConsumeShot, turretDamage, turretLoad, turretRange,
  sanitizeTurretState, turretCanClaim, turretFriendly, turretHasLineOfSight, turretMobShotOk,
  TURRET_MAX_HIT, TURRET_MUZZLE_Y,
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
import {
  TrapField, TrapTarget, TrapTickResult, TrapBlast, trapKindForBlock, trapFriendly,
  sanitizeTrap, TRAP_NAMES, TRAP_VERBS, TrapKind, CHANNELS, TIMER_INTERVALS,
  FLAME_FUEL_CAP, FLAME_BURSTS_PER_BARREL, isTrapBlock,
} from '../traps';
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
  ClientMsg, EDIT_RANGE, RELOCATE_RANGE, CHEST_SLOTS, PICKUP_RANGE, SYNCED_MOB_TYPES, type MobWire,
  ARMOR_POINT_CAP, RANGED_MAX_RANGE, RANGED_MAX_DAMAGE,
  mitigate, TOUGHNESS_CAP, DuelLeaderboardEntry, ItemEntityInfo, PlayerInfo, PlayerSnapshot, ServerMsg,
  WORLD_SEED, WORLD_HALF, WORLD_BORDER, CORE_HALF, makeUsername, skinSeed, GameMode,
  MAX_ATTUNED, TOTEM_COOLDOWN, COMBAT_TAG, TPA_EXPIRE, bloodlustMult,
  FACTION_FACES_LIMIT, FACTION_ROSTER_LIMIT, type FactionPublic,
  type PlayerCounts,
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
import { ArenaAABB, ArenaKind, isArenaEditKey } from '../arena';

import {
  PARTY_CEILING_Y, PARTY_FLOOR_Y, PARTY_MAX_HEALTH, PARTY_ARENA_SIZE_Z, PARTY_VOID_Y,
  BRIDGE_TEAM_BLOCK, PartyArenaBounds, PartyGamesEngine, PartyLobbySnapshot,
  PartyMode, PartyParticipant, PartySubBounds,
  BRIDGE_ARROW_GRAVITY, BRIDGE_ARROW_KB_VERT, BRIDGE_ARROW_LIFE_MS,
  BRIDGE_BOW_COOLDOWN_MS, BRIDGE_MELEE_TIER, bridgeSwing,
  bridgeArrowShot, bridgeCageHatch, bridgeGoalGuard, clampToPartySub,
  partyArenaBlockAt, partySpawns, parkourCourse,
} from '../partygames';
import {
  CRUMBLE_BACK_MS, CRUMBLE_CRACKED, CRUMBLE_FALL_MS, blinkSolid, parkourBlinkCells,
  parkourBuildBlocked, parkourCollapseCells, parkourCollapseFront, parkourCrumbleCells,
  parkourCrumbleUnder, parkourPadNear,
} from '../parkour_mechanics';
import type { ParkourCell } from '../parkour_course';
// Shared contact validation and combo limits for directional melee.
import {
  BW_COMBO_MAX, BW_COMBO_WINDOW_MS, BW_MELEE_FACING_DOT, BW_MELEE_RANGE,
  BW_MELEE_REWIND_S,
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
  /** Signed in but sitting on the title screen: hidden from every other
   *  player and untouchable until the next open-world transform. The client
   *  sends `away` on reaching the title, including right after logging in. */
  away: boolean;
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

}

/** How far apart two players can be and still share each other's mobs. */
const MOB_RELAY_RANGE = 112;

/** Movement budget while a throw (pad or knockback) is settling: refill rate
 *  in blocks/s and the cap it banks to. Covers the 12 b/s boost pad plus
 *  sprint air control with headroom for packet jitter. */
const PARTY_LAUNCH_RATE = 17;
const PARTY_LAUNCH_CAP = 6;

/** What the party movement gate remembers between packets.
 *
 *  `groundX/Y/Z` is the last footing this player is KNOWN to have stood on, and
 *  it exists for exactly one reason: a movement correction has to have
 *  somewhere honest to send a player who has got themselves wedged. `stuck`
 *  counts consecutive rejections so that resolution can actually happen —
 *  see `handlePartyTransform`. */
interface PartyMoveState {
  at: number;
  allowance: number;
  revision: number;
  groundX: number;
  groundY: number;
  groundZ: number;
  groundedAt: number;
  stuck: number;
  /** worldTime until which this player is under a server-applied impulse
   *  (knockback), so the anti-flight rules stand down: the server itself is
   *  the thing that threw them into the air. */
  launchUntil: number;
}

/** Bridge combat clocks. Kept off ServerPlayer: nothing outside a live Bridge
 *  match may read or write them. */
interface PartyCombatState {
  /** Server ms of the last LANDED swing (the charge clock). */
  lastSwingAt: number;
  /** Consecutive landed hits on `comboTarget` inside the combo window. */
  combo: number;
  comboTarget: number;
  /** Server ms of the last released arrow (the draw clock). */
  lastShotAt: number;
}

/** One arrow in flight. Simulated on the server; the clients draw the same
 *  arc from the spawn message and stop when the server says it stopped. */
interface PartyArrow {
  id: number;
  owner: number;
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  power: number;
  /** worldTime seconds at which this arrow expires. */
  diesAt: number;
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

/** Relocations are gated by horizontal distance between the old and new site. */
function withinRelocateRange(x: number, z: number, tx: number, tz: number): boolean {
  const dx = Math.floor(tx) - Math.floor(x), dz = Math.floor(tz) - Math.floor(z);
  return dx * dx + dz * dz <= RELOCATE_RANGE * RELOCATE_RANGE;
}

/** Client messages a spectator may NOT send (world edits + combat + economy). */
const SPECTATOR_BLOCKED = new Set<ClientMsg['t']>([
  'edit', 'lever', 'trapConfig', 'trapFuel', 'trapDefuse', 'machineAct', 'rangedAttack', 'shot', 'selfhurt', 'drop', 'pickup', 'chestSet',
  'machineConfig', 'machineUpgrade', 'machineCollect', 'machineHit', 'machineClaim',
  'machineMove', 'setSpawn',
  'turretUpgrade', 'turretClaim', 'turretMove', 'turretHit', 'turretLoad', 'turretMobShot',
  'gadgetUse', 'rocketBlast', 'xp', 'mobSync', 'mobHit',
  // Warfare Command: a spectator may never build, fire, fly or sabotage.
  'warfareBuy',
  'heliSpawn', 'heliDeploy', 'heliMount', 'heliInput', 'heliBomb', 'heliService',
  'heliUpgrade', 'heliModule', 'heliRope', 'heliHit',
  'heartConsume', 'heartWithdraw', 'beaconRevive', 'useHeal',
  'attune', 'totemTeleport',
  'vaultAttack', 'vaultChestOpen',
  // A spectator may read the faction dossiers, never swear allegiance.
  'pledgeFaction',
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
  /** Terrain richness per machine key (pure per column, so cache it). */
  private readonly machineCtx = new Map<string, YieldContext>();
  /** Rig key -> worldTime of the last raider siphon (one per 90 s). */
  private readonly siphonAt = new Map<string, number>();
  private machineLinkTimer = 0;
  private machineHopperTimer = 0;
  /** Trapcraft: every placed trap (owner/channel/facing/cooldowns). */
  private readonly traps = new TrapField();
  /** Damage-over-time from trap effects, per player id. */
  private readonly trapDots = new Map<number, { bleed: number; burn: number; acc: number; by: number }>();
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
  // --- FACTIONS ---------------------------------------------------------------
  /** Set by the shell to write a pledge onto the ACCOUNT. Returns false when
   *  the store refuses it — which is what makes the choice permanent across a
   *  reconnect, not just for the length of one session. */
  onPledge?: (username: string, faction: number) => boolean;
  /** Set by the shell: the whole registered playerbase per faction, not just
   *  who is online. The allegiance screen shows both. */
  factionRoster?: (faction: number, limit: number) => string[];
  factionCitizens?: (faction: number) => number;
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
  readonly party = new PartyGamesEngine(secureDuelToken);
  private partyQueue: number[] = [];
  private readonly partyQueueModes = new Map<number, PartyMode>();
  private partyClockNextAt = 0;
  private readonly partyMoves = new Map<number, PartyMoveState>();
  /** Arena slot -> is that Bridge's pair of cage hatches currently open? An
   *  absent entry means shut, which is what the authored venue already is. */
  private readonly partyCagesOpen = new Map<number, boolean>();
  /** Arena slot -> the moving parts of a running Parkour course: which blink
   *  group is up, how far the collapse has eaten, and every crumble pad that
   *  has been stepped on and when it drops and comes back. */
  private readonly partyParkour = new Map<number, {
    blink: [boolean, boolean];
    collapsed: number;
    crumbles: Map<number, { fallAt: number; backAt: number; gone: boolean }>;
  }>();
  /** Per-player Bridge combat clocks: the swing model needs to know how long
   *  you waited, who you have been hitting, and when you last let an arrow go. */
  private readonly partyCombat = new Map<number, PartyCombatState>();
  private partyArrows: PartyArrow[] = [];
  private partyArrowSeq = 1;
  private partyArrowClock = 0;
  private readonly settledDuelResults = new Set<string>();
  /** Next whole-server timestamp broadcast for hidden-tab/lag clock recovery. */
  private duelClockNextAt = 0;

  constructor(seed = WORLD_SEED, rng: () => number = Math.random,
    private readonly wallNow: () => number = Date.now) {
    this.seed = seed;
    this.rng = rng;
    this.duels = new Duels(secureDuelToken);
    this.terrain = new Terrain(seed);
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

  /** Current connected population by playable mode. Players in matchmaking or
   * a private lobby count toward that mode; an arena body is already assigned
   * to its mode, while everyone else belongs to the open-world Play mode. */
  activePlayerCounts(): PlayerCounts {
    const counts: PlayerCounts = { play: 0, duels: 0, parkour: 0, bridge: 0 };
    const counted = new Set<number>();
    const count = (mode: keyof PlayerCounts, id: number): void => {
      if (!this.players.has(id) || counted.has(id)) return;
      counted.add(id);
      counts[mode]++;
    };

    for (const snapshot of this.duels.snapshots(this.worldTime * 1000)) {
      for (const participant of snapshot.participants) {
        if (participant.connected) count('duels', participant.id);
      }
    }
    for (const snapshot of this.party.snapshots(this.worldTime * 1000)) {
      for (const participant of snapshot.participants) {
        if (!participant.connected) continue;
        count(snapshot.mode === 'parkour' ? 'parkour' : 'bridge', participant.id);
      }
    }
    for (const id of this.duelQueue) count('duels', id);
    for (const id of this.partyQueue) {
      count(this.partyQueueModes.get(id) === 'parkour' ? 'parkour' : 'bridge', id);
    }

    for (const player of this.players.values()) {
      if (counted.has(player.id)) continue;
      if (!player.arenaSaved) {
        if (!player.away) count('play', player.id); // on the title screen, not in the world
      } else if (player.arenaKind === 'duel') {
        count('duels', player.id);
      } else {
        count(this.party.subFor(player.id)?.game === 'parkour' ? 'parkour' : 'bridge', player.id);
      }
    }
    return counts;
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
      lastPvpTime: -Infinity, away: false, pvpSince: 0, bloodlustWarned: false,
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
      players: [...this.players.values()]
        .filter((v) => v.id === id || (!v.arenaSaved && !v.away)).map(toInfo),
      // Arena columns are stripped here, not merely ignored on arrival: a
      // block a competitor placed inside a colosseum is not part of the world
      // and has no business being handed to somebody logging into it. The
      // authored arena geometry is generated identically on both sides, so
      // there is nothing an arena client loses by not being told.
      edits: this.worldEdits(),
      items: [...this.items.values()],
      machines: [...this.machines.entries()].filter(([k]) => !isArenaEditKey(k)).map(([k, state]) => {
        const [x, y, z] = k.split(',').map(Number);
        return { x, y, z, state };
      }),
      turrets: [...this.turrets.entries()].filter(([k]) => !isArenaEditKey(k)).map(([k, state]) => {
        const [x, y, z] = k.split(',').map(Number);
        return { x, y, z, state };
      }),
      traps: this.traps.serialize().filter(([k]) => !isArenaEditKey(k)),
      season: { number: this.season.number, timeLeft: seasonWireTimeLeft(this.season) },
      war: { ...warSnapshot(this.war, this.worldTime),
        score: this.warKills.slice(), wins: this.warWins.slice() },
      flags: this.flagsPayload(),
      state: saved, // opaque per-account blob (inventory/hotbar) for the client to restore
      warfare: { xp: warfare.xp, nodes: warfare.nodes.slice() },
      duelProfile: player.duelProfile,
      duelLeaderboard: account?.duelLeaderboard ?? [],
      helis: this.vehicles.snapshot(),
      factions: this.factionPublics(),
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
        for (const member of duelLeave.snapshot.participants.filter(p => p.connected)) out.push({
          to: member.id, msg: { t: 'duelResult', result: duelLeave.snapshot.result },
        });
      }
    }
    this.removeFromPartyQueue(id);
    const oldPartyArena = this.party.arenaFor(id);
    const partyLeave = this.party.leave(id, this.worldTime * 1000);
    this.partyMoves.delete(id);
    this.partyCombat.delete(id);
    this.partyArrows = this.partyArrows.filter(a => a.owner !== id);
    if (partyLeave.deleted && oldPartyArena) out.push(...this.resetPartyArenaEdits(oldPartyArena));
    if (partyLeave.snapshot) {
      out.push(...this.partySnapshotOutbound(partyLeave.snapshot));
      if (partyLeave.snapshot.phase === 'lobby') {
        out.push(...this.restorePartyLobby(partyLeave.snapshot));
      }
      out.push(...this.partyRoundTransition(partyLeave.snapshot));
      out.push(...this.partyResultOutbound(partyLeave.snapshot));
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
    // 'others' only reaches the open world. Anyone still inside an arena was
    // looking at this player too (a closed tab mid-duel), so tell them directly.
    for (const other of this.players.values()) {
      if (other.arenaSaved) out.push({ to: other.id, msg: { t: 'leave', id } });
    }
    if (dropped) out.push(...this.flagBroadcast('returned', dropped.flag, p.username));
    return out;
  }

  /** Relay a client's mob list to open-world players near it. Every field is
   *  re-built from validated numbers so nothing else rides along. */
  private relayMobs(p: ServerPlayer, raw: unknown, rawGone: unknown): Outbound[] {
    if (p.away || p.arenaSaved || !Array.isArray(raw)) return [];
    const mobs: MobWire[] = [];
    for (const m of raw.slice(0, 40)) {
      if (!m || typeof m !== 'object') continue;
      const w = m as Record<string, unknown>;
      const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : NaN);
      const x = n(w.x), y = n(w.y), z = n(w.z), yaw = n(w.yaw), i = n(w.i), k = n(w.k);
      if (!fin(x, y, z, yaw, i, k) || k < 0 || k >= SYNCED_MOB_TYPES.length) continue;
      if (Math.hypot(x - p.x, z - p.z) > 72) continue; // only mobs around the sender
      mobs.push({ i: Math.floor(i), k: Math.floor(k), x, y, z, yaw,
        hu: n(w.hu) ? 1 : 0, sw: Math.floor(n(w.sw) || 0) & 0xffff,
        sp: Math.floor(n(w.sp) || 0) & 0xffff, tg: Number.isFinite(n(w.tg)) ? Math.floor(n(w.tg)) : -1,
        fu: Math.max(0, Math.min(1, n(w.fu) || 0)) });
    }
    const gone = Array.isArray(rawGone)
      ? rawGone.slice(0, 40).filter((v): v is number => typeof v === 'number' && Number.isFinite(v)).map(Math.floor)
      : [];
    const out: Outbound[] = [];
    for (const other of this.players.values()) {
      if (other.id === p.id || other.arenaSaved || other.away) continue;
      if (Math.hypot(other.x - p.x, other.z - p.z) > MOB_RELAY_RANGE) continue;
      out.push({ to: other.id, msg: { t: 'mobs', owner: p.id, mobs, gone } });
    }
    return out;
  }

  /** Quit to title: the socket stays open for the menus, but the body must
   *  leave the world — otherwise everyone keeps seeing it frozen where it
   *  stood. Refused while combat-tagged so a menu is never a combat log. */
  private goAway(p: ServerPlayer): Outbound[] {
    if (p.away || p.arenaSaved) return [];
    if (this.worldTime - p.lastPvpTime < COMBAT_TAG) return [];
    p.away = true;
    return [{ to: 'others', from: p.id, msg: { t: 'leave', id: p.id } }];
  }

  /** First open-world transform after `away` (Play pressed): re-announce. */
  private comeBack(p: ServerPlayer): Outbound[] {
    if (p.away || p.arenaSaved) return [];
    return [{ to: 'others', from: p.id, msg: { t: 'join', player: toInfo(p) } }];
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
    const partyPhase = this.party.phaseFor(id);
    if (partyPhase && partyPhase !== 'lobby') return 'party';
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
    // Relay the sender's sample clock with whatever position this packet
    // resolves to, on every route (world, duel, party), so other clients can
    // play the motion back at the pace it was actually walked.
    if (msg.t === 'xform' && typeof msg.ct === 'number' && Number.isFinite(msg.ct)) p.ct = Math.floor(msg.ct);
    if (['duelCreate', 'duelJoin', 'duelQueue', 'partyCreate', 'partyJoin', 'partyQueue'].includes(msg.t)) {
      const entering = !('join' in msg) || msg.join === true;
      const wantsDuel = msg.t.startsWith('duel');
      if (entering && (p.arenaSaved || (wantsDuel ? this.party.phaseFor(id) : this.duels.phaseFor(id)))) {
        return wantsDuel ? this.duelError(id, 'already_in_lobby') : this.partyError(id, 'already_in_lobby');
      }
      if (entering) {
        if (wantsDuel && this.removeFromPartyQueue(id)) return [
          { to: id, msg: { t: 'partyQueue', queued: false } }, ...this.handleDuel(p, msg as Extract<ClientMsg, {t: `duel${string}`}>)];
        if (!wantsDuel && this.removeFromDuelQueue(id)) return [
          { to: id, msg: { t: 'duelQueue', queued: false } }, ...this.handlePartyLobby(p, msg as Extract<ClientMsg, {t: `party${string}`}>)];
      }
    }
    if (msg.t === 'duelCreate' || msg.t === 'duelQueue' || msg.t === 'duelJoin' || msg.t === 'duelLeave' ||
        msg.t === 'duelReady' || msg.t === 'duelStart' || msg.t === 'duelArenaReady' || msg.t === 'duelRematch' ||
        msg.t === 'duelReturn' || msg.t === 'duelFlair') return this.handleDuel(p, msg);
    if (msg.t === 'bwCreate' || msg.t === 'bwQueue' || msg.t === 'bwJoin' || msg.t === 'bwLeave' ||
        msg.t === 'bwReady' || msg.t === 'bwStart' || msg.t === 'bwArenaReady') {
      return [{ to: id, msg: { t: 'notice', text: 'Bedwars has been replaced by Parkour. Refresh to play.' } }];
    }
    if (msg.t === 'partyCreate' || msg.t === 'partyQueue' || msg.t === 'partyJoin' ||
        msg.t === 'partyLeave' || msg.t === 'partyReady' || msg.t === 'partyStart' ||
        msg.t === 'partyArenaReady') {
      return this.handlePartyLobby(p, msg);
    }
    // A player inside a live arena is routed to that mode's whitelist and
    // NOTHING else. Every `route*InMatch` ends in `return []`, so any message
    // the mode does not explicitly name is dropped rather than falling through
    // to the open-world switch. That whitelist-and-drop is the entire security
    // model per mode: it is what makes arena-only verbs (and the weapons that
    // use them) unreachable from the open world.
    switch (this.arenaRouteFor(id)) {
      case 'duel': return this.routeDuelInMatch(p, msg);
      case 'party': return this.routePartyInMatch(p, msg);
    }
    // Spectators are non-interacting ghosts: drop any world-mutating / combat
    // message. They may still move (xform), persist (saveState), and respawn.
    if (p.mode === 'spectator' && SPECTATOR_BLOCKED.has(msg.t)) return [];
    switch (msg.t) {
      case 'away': return this.goAway(p);
      case 'mobSync': return this.relayMobs(p, msg.mobs, msg.gone);
      case 'mobHit': {
        // Mobs are client-owned; the server is a switchboard with limits. The
        // owner applies the damage to its own copy, capped there as well.
        const owner = this.players.get(msg.owner);
        if (!owner || owner.id === p.id || owner.arenaSaved || owner.away || p.away ||
            !fin(msg.nid, msg.dmg, msg.kx, msg.kz) || msg.dmg <= 0) return [];
        if (Math.hypot(owner.x - p.x, owner.z - p.z) > MOB_RELAY_RANGE) return [];
        return [{ to: owner.id, msg: { t: 'mobHit', from: p.id, nid: Math.floor(msg.nid),
          dmg: Math.min(40, msg.dmg), kx: Math.max(-10, Math.min(10, msg.kx)),
          kz: Math.max(-10, Math.min(10, msg.kz)) } }];
      }
      case 'xform': {
        // Pressing Play: apply this transform first so the re-announced body
        // appears where the player actually is, not where they quit.
        if (p.away) { p.away = false; return [...this.handle(id, msg), ...this.comeBack(p)]; }
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
        return this.handleEdit(p, msg.x, msg.y, msg.z, msg.block, msg.f);
      case 'lever': {
        // A lever pull latches/unlatches its wiring channel (traps.ts). The
        // lever itself must be within reach; the LINKED receivers may not be —
        // that's the point of a lever — so this is server-computed.
        if (!this.nearMachine(p, msg.x, msg.y, msg.z)) return [];
        const bx = Math.floor(msg.x), by = Math.floor(msg.y), bz = Math.floor(msg.z);
        const lever = this.ensureTrap(bx, by, bz);
        if (!lever || lever.kind !== TrapKind.Lever) return [];
        // A hostile lever can still be yanked — levers are the one trap part
        // anyone may operate (a raider flipping your wall traps is fair play).
        return this.applyTrapResult(this.traps.pull(bx, by, bz, this.trapSolid(), this.trapTargets()));
      }
      case 'trapConfig': {
        if (!this.nearMachine(p, msg.x, msg.y, msg.z)) return [];
        const bx = Math.floor(msg.x), by = Math.floor(msg.y), bz = Math.floor(msg.z);
        const t = this.ensureTrap(bx, by, bz);
        if (!t || !trapFriendly(t, p.username, p.faction)) return [];
        if (fin(msg.channel)) t.channel = Math.max(0, Math.min(CHANNELS - 1, Math.floor(msg.channel)));
        if (t.kind === TrapKind.Timer && (TIMER_INTERVALS as readonly number[]).includes(msg.interval as number)) {
          t.interval = msg.interval as number;
        }
        return [{ to: 'all', msg: { t: 'trap', x: bx, y: by, z: bz, state: t } }];
      }
      case 'trapFuel': {
        if (!this.nearMachine(p, msg.x, msg.y, msg.z) || !fin(msg.count)) return [];
        const bx = Math.floor(msg.x), by = Math.floor(msg.y), bz = Math.floor(msg.z);
        const t = this.ensureTrap(bx, by, bz);
        if (!t || t.kind !== TrapKind.FlameJet || !trapFriendly(t, p.username, p.faction)) return [];
        const barrels = Math.max(0, Math.min(10, Math.floor(msg.count)));
        t.fuel = Math.min(FLAME_FUEL_CAP, t.fuel + barrels * FLAME_BURSTS_PER_BARREL);
        return [{ to: 'all', msg: { t: 'trap', x: bx, y: by, z: bz, state: t } }];
      }
      case 'trapDefuse':
        return this.handleTrapDefuse(p, msg.x, msg.y, msg.z);
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
        return this.handleDrop(msg.items, msg.x, msg.y, msg.z);
      // --- FACTIONS -----------------------------------------------------------
      case 'pledgeFaction':
        return this.handlePledge(p, msg.faction);
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
        if (!machineFriendly(s, p.username, p.faction)) return this.machineRefresh(id, msg.x, msg.y, msg.z, s);
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
        if (!machineFriendly(s, p.username, p.faction)) return this.machineRefresh(id, msg.x, msg.y, msg.z, s);
        // Cost is paid client-side (the server holds no inventories); the
        // server bumps and caps the level so it can never exceed the max.
        applyUpgrade(s, msg.axis);
        return [{ to: 'all', msg: { t: 'machine', x: msg.x, y: msg.y, z: msg.z, state: s } }];
      }
      case 'machineCollect': {
        if (!this.nearMachine(p, msg.x, msg.y, msg.z)) return [];
        const s = this.ensureMachine(msg.x, msg.y, msg.z);
        if (!s) return [];
        const bx = Math.floor(msg.x), by = Math.floor(msg.y), bz = Math.floor(msg.z);
        const friendly = machineFriendly(s, p.username, p.faction);
        const out: Outbound[] = [];
        let taken: Record<number, number>;
        if (friendly) {
          taken = collectMachine(s);
        } else {
          // A raider can SIPHON a quarter of a hostile rig — once per 90 s,
          // and the owner hears about it.
          const key = `${bx},${by},${bz}`;
          const last = this.siphonAt.get(key);
          if (last !== undefined && this.worldTime - last < 90) {
            return [{ to: id, msg: { t: 'notice', text: 'That rig was siphoned recently — its lines are dry.' } }];
          }
          this.siphonAt.set(key, this.worldTime);
          taken = siphonMachine(s);
          out.push({ to: 'all', msg: { t: 'machineFx', x: bx, y: by, z: bz, fx: 'siphon' } });
          const owner = this.playerByName(s.owner);
          if (owner) out.push({ to: owner.id, msg: { t: 'notice', text: `⚠ ${p.username} is siphoning your rig at ${bx}, ${bz}!` } });
        }
        // Grant via the same dup-safe path as item pickups (leftover that won't
        // fit is re-dropped by the client), then refresh viewers.
        for (const [idStr, count] of Object.entries(taken)) {
          const itemId = Number(idStr);
          if (!ITEMS[itemId] || !fin(count) || count <= 0) continue;
          out.push({ to: id, msg: { t: 'gotitem', item: itemId, count: Math.floor(count) } });
        }
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
        if (!machineCanClaim(s, p.username, p.faction)) {
          return [...this.machineRefresh(id, msg.x, msg.y, msg.z, s),
            { to: id, msg: { t: 'notice', text: 'Hostile rig — knock its hull below 25% before hacking it.' } }];
        }
        const hacked = !!s.owner && s.owner !== p.username && !machineFriendly(s, p.username, p.faction);
        claimMachine(s, p.username, p.faction);
        const out: Outbound[] = [{ to: 'all', msg: { t: 'machine', x: msg.x, y: msg.y, z: msg.z, state: s } }];
        if (hacked) out.push({ to: id, msg: { t: 'notice', text: 'Rig hacked — it works for you now.' } });
        return out;
      }
      case 'machineAct': {
        if (!this.nearMachine(p, msg.x, msg.y, msg.z)) return [];
        const s = this.ensureMachine(msg.x, msg.y, msg.z);
        if (!s) return [];
        if (!machineFriendly(s, p.username, p.faction)) return this.machineRefresh(id, msg.x, msg.y, msg.z, s);
        const acts: readonly MachineAct[] = ['fuel', 'bit', 'overdrive', 'coolant', 'vent', 'cap', 'smother', 'inject', 'refine'];
        if (!acts.includes(msg.act)) return [];
        if (!applyMachineAct(s, msg.act, fin(msg.n) ? msg.n : 0, fin(msg.item) ? Math.floor(msg.item) : 0)) {
          return this.machineRefresh(id, msg.x, msg.y, msg.z, s);
        }
        return [{ to: 'all', msg: { t: 'machine', x: msg.x, y: msg.y, z: msg.z, state: s } }];
      }
      case 'machineMove': {
        if (!fin(msg.x, msg.y, msg.z, msg.tx, msg.ty, msg.tz)) return [];
        // You stand at the destination; the rig may be up to RELOCATE_RANGE
        // behind you — but only a rig you're friendly to (no remote theft).
        if (!this.nearMachine(p, msg.tx, msg.ty, msg.tz)) return [];
        if (!withinRelocateRange(msg.x, msg.z, msg.tx, msg.tz)) return [];
        const s = this.machines.get(`${Math.floor(msg.x)},${Math.floor(msg.y)},${Math.floor(msg.z)}`);
        if (!s || !machineFriendly(s, p.username, p.faction)) return [];
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
        if (!turretCanClaim(s, p.username, p.faction)) {
          // Refresh the requester's panel so its optimistic claim rolls back.
          return [{ to: id, msg: { t: 'turret', x: msg.x, y: msg.y, z: msg.z, state: s } },
            { to: id, msg: { t: 'notice', text: 'Enemy turret — knock it offline before hacking it.' } }];
        }
        const hacked = !!s.owner && s.owner !== p.username;
        claimTurret(s, p.username, p.faction);
        const out: Outbound[] = [{ to: 'all', msg: { t: 'turret', x: msg.x, y: msg.y, z: msg.z, state: s } }];
        if (hacked) out.push({ to: id, msg: { t: 'notice', text: 'Turret hacked — it fights for you now.' } });
        return out;
      }
      case 'turretMove': {
        if (!fin(msg.x, msg.y, msg.z, msg.tx, msg.ty, msg.tz)) return [];
        if (!this.nearMachine(p, msg.tx, msg.ty, msg.tz)) return [];
        if (!withinRelocateRange(msg.x, msg.z, msg.tx, msg.tz)) return [];
        const s = this.ensureTurret(msg.x, msg.y, msg.z);
        if (!s || !turretFriendly(s, p.username, p.faction)) return [];
        return this.moveTurret(Math.floor(msg.x), Math.floor(msg.y), Math.floor(msg.z),
          Math.floor(msg.tx), Math.floor(msg.ty), Math.floor(msg.tz));
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
        const dmg = fin(msg.amount) ? Math.max(0, Math.min(TURRET_MAX_HIT, msg.amount)) : 0;
        if (damageTurret(s, dmg)) {
          return this.destroyTurret(Math.floor(msg.x), Math.floor(msg.y), Math.floor(msg.z));
        }
        return [{ to: 'all', msg: { t: 'turret', x: msg.x, y: msg.y, z: msg.z, state: s } }];
      }
      case 'turretMobShot': {
        // Mobs are client-side: a friendly client aims the turret at one of its
        // own hostiles and the server spends (and broadcasts) the shot.
        if (!fin(msg.x, msg.y, msg.z, msg.tx, msg.ty, msg.tz) || p.dead) return [];
        const s = this.ensureTurret(msg.x, msg.y, msg.z);
        if (!s) return [];
        const bx = Math.floor(msg.x), by = Math.floor(msg.y), bz = Math.floor(msg.z);
        // The sender must be near enough to have the mob loaded around them.
        if (Math.hypot(p.x - bx - 0.5, p.z - bz - 0.5) > 96) return [];
        if (!turretMobShotOk(s, bx, by, bz, msg.tx, msg.ty, msg.tz, p.username, p.faction)) return [];
        if (!turretHasLineOfSight(bx, by, bz, msg.tx, msg.ty, msg.tz,
          (x, y, z) => this.solidAt(x, y, z))) return [];
        s.facingYaw = Math.atan2(msg.tx - bx - 0.5, msg.tz - bz - 0.5);
        turretConsumeShot(s);
        return [
          { to: 'all', msg: { t: 'turretFire', x: bx, y: by, z: bz, tx: msg.tx, ty: msg.ty, tz: msg.tz } },
          { to: 'all', msg: { t: 'turret', x: bx, y: by, z: bz, state: s } },
        ];
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
        return [...this.applyVehicleEvents(this.vehicles.damageFromGun(msg.id, dmg)),
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
    const out: Outbound[] = snapshot.participants.filter(p => p.connected).map((participant) => ({
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
    const ids = snapshot.participants.filter(p => p.connected).map((participant) => participant.id);
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
      edits.push({ x, y, z, block: trackKey.startsWith('party:') ? partyArenaBlockAt(x, y, z) ?? Block.Air : Block.Air });
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
    for (const member of snapshot.participants.filter(p => p.connected)) {
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
      p.away = false; // back from a match into the open world, not the menu
      for (const other of this.players.values()) {
        if (other.id === id) continue;
        if (other.arenaSaved) {
          // Still in a match: each side must forget the other, or the arena
          // keeps a frozen body where the leaver last stood (and the leaver
          // carries the arena's bodies back into the world).
          out.push({ to: id, msg: { t: 'leave', id: other.id } });
          out.push({ to: other.id, msg: { t: 'leave', id } });
          continue;
        }
        if (!other.away) out.push({ to: id, msg: { t: 'join', player: toInfo(other) } });
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
      no_arena: 'Every colosseum is in use right now — try again in a moment.',
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
        if(this.duels.phaseFor(p.id)==='lobby')return [...this.handleDuel(p,{t:'duelLeave'}),...this.handleDuel(p,msg)];
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

  // Party and Parkour share one isolated session transport and loading barrier.
  private partyError(to: number, code: Extract<ServerMsg, {
    t: 'partyError';
  }>['code']): Outbound[] {
    const messages = {
      invalid: 'That invite has expired.', full: 'That lobby is full.',
      match_in_progress: 'That match is already playing.', already_in_lobby: 'Leave your current lobby first.',
      not_host: 'Only the host can start.', too_few_players: 'You need two players.',
      too_many_players: 'That lobby is full.', not_everyone_ready: 'Everyone needs to ready up.', not_in_lobby: 'You are not in a lobby.',
      no_arena: 'Every venue is in use right now — try again in a moment.',
    };
    return [{ to, msg: { t: 'partyError', code, message: messages[code] } }];
  }
  private partySnapshotOutbound(snapshot: PartyLobbySnapshot, invite?: {
    id: number;
    token: string;
  }): Outbound[] {
    return snapshot.participants.filter(p => p.connected).map(p => ({ to: p.id, msg: { t: 'partyLobby', snapshot, inviteToken: invite?.id === p.id ? invite.token : undefined } }));
  }
  private resetPartyArenaEdits(arena: PartyArenaBounds, ids?: number[]): Outbound[] {
    // Wiping the slot's edits puts the hatches back to their authored (shut)
    // state, so the remembered state has to go with them.
    this.partyCagesOpen.delete(arena.slot);
    return this.resetArenaEdits(`party:${arena.slot}`, { minX: arena.minX, maxX: arena.maxX, minZ: 0, maxZ: PARTY_ARENA_SIZE_Z, minY: PARTY_VOID_Y - 4, maxY: PARTY_CEILING_Y }, ids);
  }
  /** Both modes hand out one infinite stack of your own team's wool — the only
   *  block either lets you place. The Bridge adds the two weapons the span is
   *  fought with: an iron axe for the moment somebody is next to you on a
   *  one-block walkway, and a bow for the long look down it. Neither is ever
   *  consumed; their PvP handling is confined to this arena. */
  private partyLoadout(p: ServerPlayer, member: PartyParticipant, sub: PartySubBounds): Outbound {
    const slots: (ItemStack | null)[] = new Array(36).fill(null);
    slots[0] = { id: BRIDGE_TEAM_BLOCK[member.team] ?? Block.TeamWoolA, count: 64 };
    if (sub.game === 'bridge') {
      slots[1] = { id: Item.IronAxe, count: 1 };
      slots[2] = { id: Item.BridgeBow, count: 1 };
      slots[3] = { id: Item.BridgeArrow, count: 64 };
    }
    p.held = slots[0]?.id ?? 0;
    return { to: p.id, msg: { t: 'partyLoadout', slots, selected: 0 } };
  }
  private launchParty(snapshot: PartyLobbySnapshot): Outbound[] {
    if (!snapshot.arena || !snapshot.sub || !snapshot.round)
      return [];
    const ids = snapshot.participants.filter(p => p.connected).map(p => p.id);
    const out = this.partySnapshotOutbound(snapshot);
    out.push(...this.resetPartyArenaEdits(snapshot.arena, ids));
    this.partyParkour.delete(snapshot.arena.slot);
    const spawns = partySpawns(snapshot.sub, snapshot.participants);
    snapshot.participants.forEach((member, i) => {
      const p = this.players.get(member.id);
      if (!p || !member.connected)
        return;
      // Face the way the mode wants you pointed: down the lane, or across the
      // chasm at the portal you are attacking.
      const yaw = snapshot.sub!.game === 'bridge' ? (member.team === 0 ? Math.PI : 0) : Math.PI;
      this.enterArenaBody(p, 'party', spawns[i], yaw, PARTY_MAX_HEALTH);
      this.partyMoves.set(p.id, this.freshPartyMove(spawns[i], snapshot.revision));
      this.partyCombat.delete(p.id);
      out.push(this.partyLoadout(p, member, snapshot.sub!));
      out.push({ to: p.id, msg: { t: 'partyArena', arena: snapshot.arena!, sub: snapshot.sub!, team: member.team, spawn: spawns[i], countdownEndsAt: snapshot.countdownEndsAt ?? 0 } });
    });
    out.push(...this.announceArenaScope(ids));
    return out;
  }
  private partyResultOutbound(snapshot: PartyLobbySnapshot): Outbound[] {
    if (snapshot.phase !== 'results' || !snapshot.result)
      return [];
    return snapshot.participants.filter(p => p.connected).map(p => ({ to: p.id, msg: { t: 'partyResult', result: snapshot.result! } }));
  }
  private restorePartyLobby(snapshot: PartyLobbySnapshot): Outbound[] {
    const out: Outbound[] = [], ids: number[] = [];
    for (const member of snapshot.participants) {
      const p = this.players.get(member.id);
      if (!p || !member.connected)
        continue;
      if (p.arenaSaved) {
        out.push(...this.restoreOpenWorldState(p));
        ids.push(p.id);
      }
      this.partyMoves.delete(p.id);
      this.partyCombat.delete(p.id);
      this.partyArrows = this.partyArrows.filter(a => a.owner !== p.id);
    }
    out.push(...this.announceWorldScope(ids));
    return out;
  }
  private routePartyInMatch(p: ServerPlayer, msg: ClientMsg): Outbound[] {
    if (msg.t === 'xform')
      return this.handlePartyTransform(p, msg);
    // Retry is Parkour's. Honouring it on The Bridge would let a client claim
    // a position under the deck — which is exactly where the portals are.
    // Collapse Chase has none: there, a fall is a life.
    const retrySub = this.party.subFor(p.id);
    if (msg.t === 'partyRetry' && retrySub?.game === 'parkour' &&
      parkourCourse(retrySub.seed).variant.mode !== 'collapse' &&
      this.party.phaseFor(p.id) === 'running' && this.worldTime * 1000 >= (this.party.participantFor(p.id)?.immuneUntil ?? Infinity))
      return this.evaluatePartyPlayer(p, true);
    // Combat is The Bridge's. Both handlers re-check the venue themselves, so
    // neither can be reached from a Parkour lane by a forged message.
    if (msg.t === 'partyMelee') return this.handlePartyMelee(p, msg.target);
    if (msg.t === 'partyShoot') return this.handlePartyShoot(p, msg);
    if (msg.t === 'edit')
      return this.handlePartyEdit(p, msg.x, msg.y, msg.z, msg.block);
    return [];
  }
  private freshPartyMove(p: { x: number; y: number; z: number }, revision: number): PartyMoveState {
    return {
      at: this.worldTime, allowance: 1, revision, groundX: p.x, groundY: p.y, groundZ: p.z,
      groundedAt: this.worldTime, stuck: 0, launchUntil: 0,
    };
  }
  private markPartyGround(move: PartyMoveState, x: number, y: number, z: number): void {
    move.groundX = x;
    move.groundY = y;
    move.groundZ = z;
    move.groundedAt = this.worldTime;
  }
  /** Is a body at (x, y, z) resting on something solid?
   *
   *  The tolerance is the whole point. Judging "standing" by an exact block
   *  boundary only ever holds for a player who is standing STILL: a sample
   *  taken a frame after a landing, or one interpolated along a sprint-jump,
   *  sits a few centimetres off it and would read as airborne. So the block
   *  under the feet is the one the feet round to, and any resting height
   *  within a third of a block of its surface counts. */
  private partyGrounded(x: number, y: number, z: number): boolean {
    const by = Math.round(y) - 1;
    if (Math.abs(y - by - 1) > .3) return false;
    // Match the client's 0.6-block body. A narrower probe calls a legitimate
    // edge landing airborne and eventually rejects every movement as flight.
    return [-.2999, .2999].some(ox => [-.2999, .2999].some(oz => {
      const bx = Math.floor(x + ox), bz = Math.floor(z + oz);
      const b = this.edits.get(`${bx},${by},${bz}`) ?? partyArenaBlockAt(bx, by, bz) ?? Block.Air;
      return !!BLOCKS[b]?.solid;
    }));
  }
  private partySolid(x: number, y: number, z: number): boolean {
    const bx = Math.floor(x), by = Math.floor(y), bz = Math.floor(z);
    const b = this.edits.get(`${bx},${by},${bz}`) ?? partyArenaBlockAt(bx, by, bz) ?? Block.Air;
    return !!BLOCKS[b]?.solid;
  }
  private handlePartyTransform(p: ServerPlayer, msg: Extract<ClientMsg, {
    t: 'xform';
  }>): Outbound[] {
    const sub = this.party.subFor(p.id), phase = this.party.phaseFor(p.id), participant = this.party.participantFor(p.id);
    const round = this.party.roundFor(p.id);
    if (!sub || !participant || !round || !fin(msg.x, msg.y, msg.z, msg.yaw, msg.pitch))
      return [];
    if (msg.arenaRevision !== round.revision)
      return [];
    p.yaw = msg.yaw;
    p.pitch = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, msg.pitch));
    if (phase !== 'running')
      return [];
    const wanted = clampToPartySub(msg, sub);
    const move = this.partyMoves.get(p.id) ?? this.freshPartyMove(p, round.revision);
    if (this.partyGrounded(p.x, p.y, p.z))
      this.markPartyGround(move, p.x, p.y, p.z);
    // A Parkour throw pad is the course throwing this player, exactly as
    // knockback is: the pad is found by POSITION on the authored course, so
    // only a real pad can open the window, and only right beside it.
    if (sub.game === 'parkour') {
      const course = parkourCourse(sub.seed);
      if ([p, wanted].some(at => parkourPadNear(course, at.x - sub.minX, at.y, at.z - sub.minZ))) {
        if (this.worldTime >= move.launchUntil) move.allowance = Math.max(move.allowance, PARTY_LAUNCH_CAP);
        move.launchUntil = this.worldTime + 1.6;
        move.groundedAt = this.worldTime;
      }
    }
    // Knockback is the server throwing this player through the air. While an
    // impulse is settling, the flight rules stand down entirely — otherwise
    // the mode's signature (hitting somebody off the span) would be corrected
    // away as cheating the instant it worked.
    const launched = this.worldTime < move.launchUntil;
    // Token budget permits packet jitter, but cannot be refilled by sending
    // more packets. Collision is checked along the whole travelled segment.
    // A throw outruns running pace (a boost pad is 12 b/s flat plus air
    // control), so the budget refills at flight speed while one is settling —
    // at running pace it drained mid-flight and every packet after that was
    // "corrected", rubber-banding the flyer back along the arc.
    const rate = launched ? PARTY_LAUNCH_RATE : 6.5, cap = launched ? PARTY_LAUNCH_CAP : 4;
    move.allowance = Math.min(cap, move.allowance + Math.max(0, this.worldTime - move.at) * rate);
    move.at = this.worldTime;
    const distance = Math.hypot(wanted.x - p.x, wanted.z - p.z);
    let clear = distance <= move.allowance && (launched || wanted.y - move.groundY <= 1.6);
    // Anti-flight: hanging at or above your last footing for seconds on end is
    // not a jump. The window is generous on purpose — a tight one turns a
    // string of sprint-jumps, where a touchdown can fall between two packets,
    // into a false positive, and a false positive here is a frozen player.
    if (!launched && this.worldTime - move.groundedAt > 2.2 && wanted.y >= move.groundY - .15)
      clear = false;
    const steps = Math.max(1, Math.ceil(Math.hypot(wanted.x - p.x, wanted.y - p.y, wanted.z - p.z) * 4));
    for (let i = 1; clear && i <= steps; i++) {
      const t = i / steps, x = p.x + (wanted.x - p.x) * t, y = p.y + (wanted.y - p.y) * t, z = p.z + (wanted.z - p.z) * t;
      for (const ox of [-.26, .26])
        for (const oz of [-.26, .26])
          for (const oy of [.06, .9, 1.7]) {
            const bx = Math.floor(x + ox), by = Math.floor(y + oy), bz = Math.floor(z + oz);
            const b = this.edits.get(`${bx},${by},${bz}`) ?? partyArenaBlockAt(bx, by, bz) ?? Block.Air;
            if (BLOCKS[b]?.solid)
              clear = false;
          }
      // A landing that happens BETWEEN two packets is still a landing. Reading
      // the ground along the travelled segment — not only at its ends — is what
      // keeps a bunny-hopped crossing from ever looking like flight.
      if (clear && this.partyGrounded(x, y, z))
        this.markPartyGround(move, x, y, z);
    }
    this.partyMoves.set(p.id, move);
    if (!clear) {
      // A correction that cannot resolve is worse than the cheat it is aimed
      // at: bouncing a player back to the position the rule objects to leaves
      // them stuck in the air forever, unable to move, with nothing they can
      // do about it. So an argument the client keeps losing gets SETTLED —
      // back onto the last footing this player is known to have stood on.
      if (++move.stuck < 12)
        return [{ to: p.id, msg: { t: 'teleport', x: p.x, y: p.y, z: p.z } }];
      move.stuck = 0;
      move.allowance = 1;
      move.groundedAt = this.worldTime;
      move.launchUntil = 0;
      p.x = move.groundX;
      p.y = move.groundY;
      p.z = move.groundZ;
      p.arenaTrack = [];
      this.recordArenaTrack(p);
      return [{ to: p.id, msg: { t: 'teleport', x: p.x, y: p.y, z: p.z } }];
    }
    move.stuck = 0;
    move.allowance -= distance;
    p.x = wanted.x;
    p.y = wanted.y;
    p.z = wanted.z;
    if (this.partyGrounded(p.x, p.y, p.z))
      this.markPartyGround(move, p.x, p.y, p.z);
    p.gliding = false;
    p.boating = false;
    p.seated = false;
    p.armor = [0, 0, 0, 0];
    p.aiming = false;
    p.reloading = false;
    // Cosmetic hand contents, whitelisted: the mode's own wool and its two
    // weapons and nothing else, so no open-world item can be worn into a venue.
    const wool = BRIDGE_TEAM_BLOCK[participant.team] ?? Block.TeamWoolA;
    const holdable = sub.game === 'bridge'
      ? [wool, Item.IronAxe, Item.BridgeBow, Item.BridgeArrow]
      : [wool];
    p.held = holdable.includes(msg.held as number) ? msg.held as number : 0;
    p.sneaking = msg.sneaking === true;
    if (Number.isFinite(msg.swing))
      p.swing = Number(msg.swing) & 0xffff;
    this.recordArenaTrack(p);
    const crumbled = sub.game === 'parkour' ? this.stepOnCrumble(p, sub) : [];
    return [...crumbled, ...this.evaluatePartyPlayer(p)];
  }
  private evaluatePartyPlayer(p: ServerPlayer, retry = false): Outbound[] {
    const now = this.worldTime * 1000, before = this.party.phaseFor(p.id);
    const evaluated = this.party.evaluate(p.id, retry ? { x: p.x, y: PARTY_FLOOR_Y - 30, z: p.z } : p, now), out: Outbound[] = [];
    if (evaluated.spawn) {
      Object.assign(p, evaluated.spawn);
      p.health = PARTY_MAX_HEALTH;
      const move = this.partyMoves.get(p.id);
      if (move) {
        move.allowance = 1;
        move.at = this.worldTime;
        move.stuck = 0;
        move.launchUntil = 0;
        // The spawn pad is the new footing — all three axes of it. Leaving the
        // old x/z here would aim a later correction at wherever this player
        // last stood, which after a void death is thin air.
        this.markPartyGround(move, p.x, p.y, p.z);
      }
      p.arenaTrack = [];
      this.recordArenaTrack(p);
      out.push({ to: p.id, msg: { t: 'respawned', ...evaluated.spawn, health: PARTY_MAX_HEALTH } });
    }
    if (evaluated.changed) {
      const snap = this.party.snapshotFor(p.id, now)!;
      // A goal is the one thing that shuts the hatches mid-round, and it has
      // to shut them in the same batch that puts everybody back inside — a
      // tick of open hatch under a just-teleported player is a tick of fall.
      out.push(...this.syncPartyCages(snap, now));
      out.push(...this.partySnapshotOutbound(snap));
      if (before !== snap.phase) {
        out.push(...this.partyRoundTransition(snap), ...this.partyResultOutbound(snap));
      }
    }
    return out;
  }
  private partyCombatOf(id: number): PartyCombatState {
    let combat = this.partyCombat.get(id);
    if (!combat) {
      combat = { lastSwingAt: -1e9, combo: 0, comboTarget: 0, lastShotAt: -1e9 };
      this.partyCombat.set(id, combat);
    }
    return combat;
  }
  /** Ground speed and climb rate, read from the position history rather than
   *  asked of the client — a sprint bonus you can claim is not a bonus. */
  private partyMotion(p: ServerPlayer): { speed: number; vy: number } {
    const track = p.arenaTrack;
    if (track.length < 2) return { speed: 0, vy: 0 };
    const a = track[track.length - 2], b = track[track.length - 1];
    const dt = Math.max(1 / 60, b.at - a.at);
    // `vy` is in the swing model's units (blocks per 60Hz tick).
    return { speed: Math.hypot(b.x - a.x, b.z - a.z) / dt, vy: (b.y - a.y) / dt / 60 };
  }
  /**
   * One landed hit: damage, knockback, feedback, and — if it was the last one
   * — the death. Every Bridge weapon ends here, so there is exactly one place
   * that decides what a hit does to a body.
   */
  private landPartyHit(
    attacker: ServerPlayer, target: ServerPlayer, now: number,
    hit: {
      damage: number; kx: number; ky: number; kz: number;
      charge: number; combo: number; crit: boolean; ranged: boolean;
    },
  ): Outbound[] {
    const dealt = Math.min(hit.damage, target.health);
    target.health = Math.max(0, target.health - hit.damage);
    const killed = target.health <= 0;
    this.party.recordHit(target.id, attacker.id, now);
    this.partyCombatOf(target.id).combo = 0; // taking a hit breaks your own combo
    const move = this.partyMoves.get(target.id);
    if (move) {
      // The server just threw this body through the air; it must not then
      // correct it for being through the air. Knocking somebody off the span
      // is the whole mode.
      move.launchUntil = this.worldTime + 1.5;
      move.allowance = 4;
      move.groundedAt = this.worldTime;
      move.stuck = 0;
    }
    const out: Outbound[] = [
      { to: target.id, msg: { t: 'hurt', health: killed ? 1 : target.health, dead: false,
        by: attacker.id, kx: hit.kx, ky: hit.ky, kz: hit.kz, combat: 0 } },
      { to: attacker.id, msg: { t: 'partyHit', target: target.id, amount: dealt,
        combo: hit.combo, charge: hit.charge, crit: hit.crit, killed, ranged: hit.ranged } },
    ];
    if (!killed) return out;
    target.health = PARTY_MAX_HEALTH;
    const snapshot = this.party.recordDeath(target.id, attacker.id, now, hit.ranged ? 'bow' : 'melee');
    if (snapshot) out.push(...this.partySnapshotOutbound(snapshot));
    // `pendingSpawn` is set; evaluating the corpse is what sends it home.
    out.push(...this.evaluatePartyPlayer(target));
    return out;
  }
  /** A Bridge iron axe swing. The client sends a target id and nothing else. */
  private handlePartyMelee(p: ServerPlayer, targetId: number): Outbound[] {
    const now = this.worldTime * 1000, target = this.players.get(targetId);
    const sub = this.party.subFor(p.id);
    if (!target || !sub || sub.game !== 'bridge' || p.held !== Item.IronAxe ||
      !this.party.canFight(p.id, targetId, now)) return [];
    const combat = this.partyCombatOf(p.id), tier = BRIDGE_MELEE_TIER;
    const since = now - combat.lastSwingAt;
    // Fixed cadence only: every accepted contact hits at full strength.
    if (since < tier.cooldownMs) return [];
    // Judge the swing against where the target was when it was thrown. Melee
    // has no travel time, so the window is a quarter-second and no more.
    const lookX = -Math.sin(p.yaw), lookZ = -Math.cos(p.yaw);
    let best: { dx: number; dz: number; dist: number } | null = null;
    for (const c of [{ at: this.worldTime, x: target.x, y: target.y, z: target.z }, ...target.arenaTrack]) {
      if (this.worldTime - c.at > BW_MELEE_REWIND_S) continue;
      const dx = c.x - p.x, dy = c.y - p.y, dz = c.z - p.z;
      const dist = Math.hypot(dx, dy, dz), horiz = Math.hypot(dx, dz) || 1e-3;
      if (dist > BW_MELEE_RANGE) continue;
      if ((dx / horiz) * lookX + (dz / horiz) * lookZ < BW_MELEE_FACING_DOT) continue;
      let blocked = false;
      const steps = Math.max(1, Math.ceil(dist * 4));
      for (let i = 1; i < steps; i++) {
        const t = i / steps;
        if (this.partySolid(p.x + dx * t, p.y + 1.35 + dy * t, p.z + dz * t)) {
          blocked = true;
          break;
        }
      }
      if (blocked) continue;
      if (!best || dist < best.dist) best = { dx: dx / horiz, dz: dz / horiz, dist };
    }
    if (!best) return [];
    const motion = this.partyMotion(p);
    const combo = combat.comboTarget === targetId && since <= BW_COMBO_WINDOW_MS ? combat.combo : 0;
    const swing = bridgeSwing({
      combo,
      onGround: this.partyGrounded(p.x, p.y, p.z), vy: motion.vy, speed: motion.speed,
      toTargetX: best.dx, toTargetZ: best.dz, lookX, lookZ,
    });
    combat.lastSwingAt = now;
    combat.comboTarget = targetId;
    combat.combo = Math.min(BW_COMBO_MAX, combo + 1);
    return this.landPartyHit(p, target, now, {
      damage: swing.damage, kx: swing.kx, ky: swing.ky, kz: swing.kz,
      charge: swing.charge, combo: swing.combo, crit: swing.crit, ranged: false,
    });
  }
  /** Release the bow. The arrow is the server's from here on. */
  private handlePartyShoot(p: ServerPlayer, msg: Extract<ClientMsg, { t: 'partyShoot' }>): Outbound[] {
    const now = this.worldTime * 1000, sub = this.party.subFor(p.id);
    const member = this.party.participantFor(p.id);
    if (!sub || !member || sub.game !== 'bridge' || this.party.phaseFor(p.id) !== 'running' ||
      p.held !== Item.BridgeBow || !fin(msg.dx, msg.dy, msg.dz, msg.power)) return [];
    const len = Math.hypot(msg.dx, msg.dy, msg.dz);
    if (!(len > 1e-3)) return [];
    const combat = this.partyCombatOf(p.id);
    const round = this.party.snapshotFor(p.id, now);
    if (member.pendingSpawn || (round?.goalResetAt !== undefined && now < round.goalResetAt) ||
        now - combat.lastShotAt < BRIDGE_BOW_COOLDOWN_MS) return [];
    // Legacy clients can send power, but strength is always server-owned.
    const power = 1;
    combat.lastShotAt = now;
    const shot = bridgeArrowShot();
    const dx = msg.dx / len, dy = msg.dy / len, dz = msg.dz / len;
    const arrow: PartyArrow = {
      id: this.partyArrowSeq++, owner: p.id,
      x: p.x + dx * .8, y: p.y + 1.55 + dy * .8, z: p.z + dz * .8,
      vx: dx * shot.speed, vy: dy * shot.speed, vz: dz * shot.speed,
      power, diesAt: this.worldTime + BRIDGE_ARROW_LIFE_MS / 1000,
    };
    this.partyArrows.push(arrow);
    return this.party.membersOf(p.id).map(id => ({
      to: id, msg: {
        t: 'partyArrow', id: arrow.id, by: p.id,
        x: arrow.x, y: arrow.y, z: arrow.z, dx, dy, dz, speed: shot.speed, power,
      },
    }));
  }
  /** Fly every live arrow one server tick. Sub-stepped, so a fast arrow cannot
   *  tunnel through a one-block span or through a body standing on it. */
  private tickPartyArrows(dt: number): Outbound[] {
    if (!this.partyArrows.length) return [];
    const out: Outbound[] = [], now = this.worldTime * 1000, alive: PartyArrow[] = [];
    for (const a of this.partyArrows) {
      const owner = this.players.get(a.owner);
      if (!owner || this.party.phaseFor(a.owner) !== 'running') continue; // arena gone
      const members = this.party.membersOf(a.owner);
      let victim: ServerPlayer | null = null, spent = this.worldTime >= a.diesAt;
      const steps = Math.max(1, Math.min(24, Math.ceil(Math.hypot(a.vx, a.vy, a.vz) * dt / .3)));
      const step = dt / steps;
      for (let i = 0; i < steps && !spent && !victim; i++) {
        a.vy -= BRIDGE_ARROW_GRAVITY * step;
        a.x += a.vx * step;
        a.y += a.vy * step;
        a.z += a.vz * step;
        if (a.y < PARTY_VOID_Y || a.y > PARTY_CEILING_Y || this.partySolid(a.x, a.y, a.z)) {
          spent = true;
          break;
        }
        for (const id of members) {
          if (id === a.owner) continue;
          const v = this.players.get(id);
          if (!v || !this.party.canFight(a.owner, id, now)) continue;
          if (Math.abs(a.x - v.x) < .42 && Math.abs(a.z - v.z) < .42 &&
            a.y > v.y - .1 && a.y < v.y + 1.9) {
            victim = v;
            break;
          }
        }
      }
      if (victim) {
        const shot = bridgeArrowShot(), flat = Math.hypot(a.vx, a.vz) || 1;
        out.push(...this.landPartyHit(owner, victim, now, {
          damage: shot.damage, kx: a.vx / flat * shot.knockback, ky: BRIDGE_ARROW_KB_VERT,
          kz: a.vz / flat * shot.knockback, charge: a.power, combo: 0, crit: shot.crit, ranged: true,
        }));
      }
      if (victim || spent) {
        for (const id of members)
          out.push({ to: id, msg: { t: 'partyArrowEnd', id: a.id, x: a.x, y: a.y, z: a.z, hit: !!victim } });
        continue;
      }
      alive.push(a);
    }
    this.partyArrows = alive;
    return out;
  }
  private handlePartyEdit(p: ServerPlayer, x: number, y: number, z: number, block: number): Outbound[] {
    const sub = this.party.subFor(p.id), member = this.party.participantFor(p.id);
    if (!sub || !member || this.party.phaseFor(p.id) !== 'running' || !fin(x, y, z))
      return [];
    const bridge = sub.game === 'bridge';
    const bx = Math.floor(x), by = Math.floor(y), bz = Math.floor(z), key = `${bx},${by},${bz}`;
    const current = this.edits.get(key) ?? partyArenaBlockAt(bx, by, bz) ?? Block.Air;
    const reject = (): Outbound[] => [{ to: p.id, msg: { t: 'edit', x: bx, y: by, z: bz, block: current } }];
    const inRange = Math.hypot(bx + .5 - p.x, by + .5 - p.y, bz + .5 - p.z) <= EDIT_RANGE;
    const inSub = bx >= sub.minX && bx < sub.maxX && bz >= sub.minZ && bz < sub.maxZ;
    // Building out over the void is the whole of The Bridge, so its build box
    // reaches down past the deck; Parkour keeps its tighter one.
    const minY = bridge ? PARTY_VOID_Y : PARTY_FLOOR_Y - 3;
    const maxY = bridge ? PARTY_FLOOR_Y + 16 : PARTY_FLOOR_Y + 12;
    if (!inSub || !inRange || by < minY || by >= maxY)
      return reject();
    // Taking your own wool back is how you get across a second time, so a
    // break is allowed — but only of a block a player put there.
    if (block === Block.Air) {
      if (!bridge || !this.edits.has(key) || !BRIDGE_TEAM_BLOCK.includes(current as typeof BRIDGE_TEAM_BLOCK[number]))
        return reject();
      this.edits.set(key, Block.Air);
      return this.party.membersOf(p.id).map(id => ({ to: id, msg: { t: 'edit', x: bx, y: by, z: bz, block: Block.Air } }));
    }
    if (block !== BRIDGE_TEAM_BLOCK[member.team] || current !== Block.Air)
      return reject();
    // A build must attach to something, and cannot suffocate anybody.
    const attached = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]].some(([dx, dy, dz]) => {
      const b = this.edits.get(`${bx + dx},${by + dy},${bz + dz}`) ?? partyArenaBlockAt(bx + dx, by + dy, bz + dz) ?? Block.Air;
      return !!BLOCKS[b]?.solid;
    });
    // Neither mode lets you wall off the thing everybody is racing for: a
    // Parkour checkpoint or live pad, or the mouth of either Bridge portal.
    const blocked = bridge
      ? bridgeGoalGuard(bx - sub.minX, bz - sub.minZ)
      : parkourBuildBlocked(parkourCourse(sub.seed), bx - sub.minX, by, bz - sub.minZ);
    if (blocked || !attached || this.party.membersOf(p.id).some(id => { const v = this.players.get(id)!; return v.x + .3 > bx && v.x - .3 < bx + 1 && v.z + .3 > bz && v.z - .3 < bz + 1 && v.y + 1.8 > by && v.y < by + 1; }))
      return reject();
    this.edits.set(key, block);
    return this.party.membersOf(p.id).map(id => ({ to: id, msg: { t: 'edit', x: bx, y: by, z: bz, block } }));
  }
  private removeFromPartyQueue(id: number): boolean {
    const before = this.partyQueue.length;
    this.partyQueue = this.partyQueue.filter(v => v !== id);
    this.partyQueueModes.delete(id);
    return before !== this.partyQueue.length;
  }
  private handlePartyLobby(p: ServerPlayer, msg: Extract<ClientMsg, {
    t: `party${string}`;
  }>): Outbound[] {
    const now = this.worldTime * 1000;
    switch (msg.t) {
      case 'partyCreate': {
        this.removeFromPartyQueue(p.id);
        const result = this.party.create({ id: p.id, username: p.username, skin: p.skin }, now, msg.mode === 'parkour' ? 'parkour' : 'bridge');
        if ('reason' in result)
          return this.partyError(p.id, result.reason);
        return [{ to: p.id, msg: { t: 'partyQueue', queued: false } }, ...this.partySnapshotOutbound(result.snapshot, { id: p.id, token: result.token })];
      }
      case 'partyQueue': {
        if (!msg.join) {
          this.removeFromPartyQueue(p.id);
          return [{ to: p.id, msg: { t: 'partyQueue', queued: false } }];
        }
        if (this.party.phaseFor(p.id) === 'lobby')
          return [...this.handlePartyLobby(p, { t: 'partyLeave' }), ...this.handlePartyLobby(p, msg)];
        if (this.party.phaseFor(p.id))
          return this.partyError(p.id, 'already_in_lobby');
        const mode: PartyMode = msg.mode === 'parkour' ? 'parkour' : 'bridge';
        this.removeFromPartyQueue(p.id);
        this.partyQueue = this.partyQueue.filter(id => this.players.has(id) && !this.party.phaseFor(id) && !this.duels.phaseFor(id) && !this.players.get(id)?.arenaSaved);
        const opponentId = this.partyQueue.find(id => this.partyQueueModes.get(id) === mode);
        if (opponentId === undefined) {
          this.partyQueue.push(p.id);
          this.partyQueueModes.set(p.id, mode);
          return [{ to: p.id, msg: { t: 'partyQueue', queued: true } }];
        }
        this.removeFromPartyQueue(opponentId);
        const opponent = this.players.get(opponentId)!;
        const made = this.party.create({ id: opponent.id, username: opponent.username, skin: opponent.skin }, now, mode);
        if ('reason' in made)
          return this.partyError(p.id, made.reason);
        const joined = this.party.join(made.token, { id: p.id, username: p.username, skin: p.skin }, now);
        if (!joined.ok) {
          this.party.leave(opponent.id, now);
          return this.partyError(p.id, joined.reason);
        }
        this.party.setReady(opponent.id, true, now);
        this.party.setReady(p.id, true, now);
        const started = this.party.start(opponent.id, now);
        if (!started.ok)
          return this.partyError(p.id, started.reason);
        return [{ to: opponent.id, msg: { t: 'partyQueue', queued: false } }, { to: p.id, msg: { t: 'partyQueue', queued: false } }, ...this.launchParty(started.snapshot)];
      }
      case 'partyJoin': {
        this.removeFromPartyQueue(p.id);
        const result = this.party.join(typeof msg.token === 'string' ? msg.token.slice(0, 128) : '', { id: p.id, username: p.username, skin: p.skin }, now);
        return result.ok ? this.partySnapshotOutbound(result.snapshot, { id: p.id, token: msg.token }) : this.partyError(p.id, result.reason);
      }
      case 'partyLeave': {
        this.removeFromPartyQueue(p.id);
        this.partyMoves.delete(p.id);
        this.partyCombat.delete(p.id);
        this.partyArrows = this.partyArrows.filter(a => a.owner !== p.id);
        const arena = this.party.arenaFor(p.id), result = this.party.leave(p.id, now);
        const out: Outbound[] = [{ to: p.id, msg: { t: 'partyQueue', queued: false } }];
        if (result.deleted && arena)
          out.push(...this.resetPartyArenaEdits(arena));
        if (p.arenaSaved) {
          out.push(...this.restoreOpenWorldState(p), ...this.announceWorldScope([p.id]));
        }
        if (result.snapshot)
          out.push(...this.partySnapshotOutbound(result.snapshot), ...this.partyResultOutbound(result.snapshot));
        return out;
      }
      case 'partyReady': {
        const snap = this.party.setReady(p.id, msg.ready === true, now);
        return snap ? this.partySnapshotOutbound(snap) : this.partyError(p.id, 'not_in_lobby');
      }
      case 'partyStart': {
        const result = this.party.start(p.id, now);
        return result.ok ? this.launchParty(result.snapshot) : this.partyError(p.id, result.reason);
      }
      case 'partyArenaReady': {
        const snap = this.party.markArenaReady(p.id, now, msg.revision);
        return snap ? this.partySnapshotOutbound(snap) : [];
      }
      default: return [];
    }
  }
  private partyRoundTransition(snap: PartyLobbySnapshot): Outbound[] {
    return snap.phase === 'countdown' ? this.launchParty(snap) : [];
  }
  /** Open or shut both drop cages on a Bridge, to match the round's own clock.
   *
   *  The cages themselves are authored geometry and always there; only the
   *  hatch under each one moves, and it moves as ordinary arena edits — the
   *  same channel a player's wool travels on — so a client that has not
   *  streamed the base yet still records the change and gets it right when the
   *  chunk arrives. Shut during the opening countdown and for the three
   *  seconds after every goal; open for the rest of the round. */
  private syncPartyCages(snap: PartyLobbySnapshot, now: number): Outbound[] {
    const sub = snap.sub, slot = snap.arena?.slot;
    if (slot === undefined || !sub || sub.game !== 'bridge')
      return [];
    const held = snap.goalResetAt !== undefined && now < snap.goalResetAt;
    const open = snap.phase === 'running' && !held;
    if (open === (this.partyCagesOpen.get(slot) ?? false))
      return [];
    this.partyCagesOpen.set(slot, open);
    const edits = bridgeCageHatch().map(cell => {
      const x = sub.minX + cell.lx, y = cell.y, z = sub.minZ + cell.lz;
      const key = `${x},${y},${z}`;
      if (open) this.edits.set(key, Block.Air);
      else this.edits.delete(key);
      return { x, y, z, block: open ? Block.Air : partyArenaBlockAt(x, y, z) ?? Block.Air };
    });
    return snap.participants.filter(p => p.connected)
      .map(p => ({ to: p.id, msg: { t: 'editBatch', edits } as ServerMsg }));
  }
  /** Set (or, with `restore`, un-set back to the authored block) a batch of
   *  course cells, and tell everybody in the match. The same edit channel a
   *  player's wool travels on, so a client that has not streamed that part of
   *  the course yet still gets it right when the chunk arrives. */
  private parkourCellEdits(snap: PartyLobbySnapshot, cells: readonly ParkourCell[], block: number | 'restore'): Outbound[] {
    const sub = snap.sub!, edits: { x: number; y: number; z: number; block: number }[] = [];
    for (const c of cells) {
      const x = sub.minX + c.x, y = c.y, z = sub.minZ + c.z, key = `${x},${y},${z}`;
      if (block === 'restore') {
        // Never grow a block back inside somebody.
        if (snap.participants.some(m => {
          const v = this.players.get(m.id);
          return v && v.x + .3 > x && v.x - .3 < x + 1 && v.z + .3 > z && v.z - .3 < z + 1 && v.y + 1.8 > y && v.y < y + 1;
        })) continue;
        this.edits.delete(key);
        edits.push({ x, y, z, block: partyArenaBlockAt(x, y, z) ?? Block.Air });
      } else {
        this.edits.set(key, block);
        edits.push({ x, y, z, block });
      }
    }
    if (!edits.length) return [];
    return snap.participants.filter(p => p.connected)
      .map(p => ({ to: p.id, msg: { t: 'editBatch', edits } as ServerMsg }));
  }
  private parkourState(slot: number) {
    let st = this.partyParkour.get(slot);
    if (!st) this.partyParkour.set(slot, st = { blink: [true, true], collapsed: 0, crumbles: new Map() });
    return st;
  }
  /** A racer standing on a crumble pad cracks the whole pad. */
  private stepOnCrumble(p: ServerPlayer, sub: PartySubBounds): Outbound[] {
    const snap = this.party.snapshotFor(p.id, this.worldTime * 1000);
    if (!snap || snap.phase !== 'running' || !snap.arena || !this.partyGrounded(p.x, p.y, p.z)) return [];
    const course = parkourCourse(sub.seed);
    const pad = parkourCrumbleUnder(course, p.x - sub.minX, p.y, p.z - sub.minZ);
    if (!pad) return [];
    const st = this.parkourState(snap.arena.slot), now = this.worldTime * 1000;
    if (st.crumbles.has(pad.index)) return [];
    st.crumbles.set(pad.index, { fallAt: now + CRUMBLE_FALL_MS, backAt: now + CRUMBLE_BACK_MS, gone: false });
    return this.parkourCellEdits(snap, parkourCrumbleCells(course, pad.index), CRUMBLE_CRACKED);
  }
  /** Everything on a running Parkour course that moves on the round clock. */
  private tickParkourCourse(snap: PartyLobbySnapshot, now: number): Outbound[] {
    if (snap.sub?.game !== 'parkour' || !snap.arena || !snap.round) return [];
    const course = parkourCourse(snap.sub.seed), st = this.parkourState(snap.arena.slot);
    const t = now - snap.round.startedAt, out: Outbound[] = [];
    // Collapse Chase: eat every cell behind the front, for good.
    if (course.variant.mode === 'collapse') {
      const front = Math.min(course.steps.length, Math.floor(parkourCollapseFront(t)));
      if (front > st.collapsed) {
        out.push(...this.parkourCellEdits(snap, parkourCollapseCells(course, st.collapsed, front), Block.Air));
        st.collapsed = front;
      }
    }
    const alive = (c: ParkourCell): boolean => c.order >= st.collapsed;
    for (const group of [0, 1] as const) {
      const solid = blinkSolid(group, t);
      if (solid === st.blink[group]) continue;
      st.blink[group] = solid;
      const cells = parkourBlinkCells(course, group).filter(alive);
      out.push(...this.parkourCellEdits(snap, cells, solid ? 'restore' : Block.Air));
    }
    for (const [index, c] of st.crumbles) {
      const cells = parkourCrumbleCells(course, index).filter(alive);
      if (!c.gone && now >= c.fallAt) {
        c.gone = true;
        out.push(...this.parkourCellEdits(snap, cells, Block.Air));
      } else if (c.gone && now >= c.backAt) {
        st.crumbles.delete(index);
        out.push(...this.parkourCellEdits(snap, cells, 'restore'));
      }
    }
    return out;
  }
  tickParty(): Outbound[] {
    const now = this.worldTime * 1000, out: Outbound[] = [];
    // Arrows are the only thing in either venue that moves on its own, so this
    // is the only place the party layer needs a real dt.
    const dt = this.partyArrowClock > 0 ? Math.min(.25, Math.max(0, this.worldTime - this.partyArrowClock)) : 0;
    this.partyArrowClock = this.worldTime;
    if (dt > 0) out.push(...this.tickPartyArrows(dt));
    // Resolve all hazards together on the server, even when a tab stops sending movement.
    for (const snap of this.party.snapshots(now)) {
      // The hatches are on the round clock, not on anybody's packets: the
      // three seconds after a goal end for both players at the same instant.
      out.push(...this.syncPartyCages(snap, now));
      if (snap.phase !== 'running')
        continue;
      out.push(...this.tickParkourCourse(snap, now));
      for (const member of snap.participants) {
        const p = this.players.get(member.id);
        if (p && member.connected)
          out.push(...this.evaluatePartyPlayer(p));
      }
    }
    for (const snap of this.party.tick(now)) {
      // The whistle is a phase change, so the hatches drop on the same tick
      // rather than on the next one.
      out.push(...this.syncPartyCages(snap, now));
      out.push(...this.partySnapshotOutbound(snap));
      if (snap.phase === 'lobby')
        out.push(...this.restorePartyLobby(snap));
      if (snap.phase === 'running')
        for (const p of snap.participants) {
          const move = this.partyMoves.get(p.id);
          if (move) {
            move.groundedAt = this.worldTime;
            move.at = this.worldTime;
          }
        }
      out.push(...this.partyRoundTransition(snap), ...this.partyResultOutbound(snap));
    }
    if (this.worldTime >= this.partyClockNextAt) {
      this.partyClockNextAt = this.worldTime + .5;
      for (const snap of this.party.snapshots(now))
        if (snap.phase !== 'lobby')
          out.push(...this.partySnapshotOutbound(snap));
    }
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
        for (const participant of snap.participants.filter(p=>p.connected)) {
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
        for (const p of snap.participants.filter(p=>p.connected)) out.push({ to: p.id, msg: {
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
        case 'heliCrash':
          out.push({ to: 'all', msg: { t: 'heliCrash', id: ev.id, x: ev.x, y: ev.y, z: ev.z } });
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
      out.push({ to: p.id, msg: { t: 'gotitem', item: s.id, count: Math.floor(s.count) } });
    }
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
    // Rebuild at the destination and carry the state over (the bore/well
    // restarts on fresh ground).
    relocateMachine(state);
    this.machineCtx.delete(fromKey);
    this.machineCtx.delete(toKey);
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

  /** Tick every placed machine using its column's terrain richness. Returns
   *  broadcasts for discrete events (jam, strike/gusher, bit wear-out, fire)
   *  and burns down any rig whose well fire ate its hull. Clients predict the
   *  continuous parts (depth, heat, fuel) with the same pure sim. */
  tickMachines(dt: number): Outbound[] {
    if (!fin(dt) || dt <= 0) return [];
    const out: Outbound[] = [];
    for (const [key, s] of [...this.machines]) {
      const parts = key.split(',');
      const x = Number(parts[0]), y = Number(parts[1]), z = Number(parts[2]);
      let ctx = this.machineCtx.get(key);
      if (!ctx || (s.type === MachineType.Autominer) !== !!ctx.ore) {
        ctx = machineContext(this.terrain, x, z, s.type);
        this.machineCtx.set(key, ctx);
      }
      // Keep the rig's faction current (a player who switched sides takes it).
      const owner = s.owner ? this.playerByName(s.owner) : undefined;
      if (owner && owner.faction !== s.faction) s.faction = owner.faction;
      const ev = tickMachine(s, ctx, dt);
      if (s.hp <= 0) { // a well fire burned it down
        out.push(...this.destroyMachine(key, x, y, z));
        continue;
      }
      const fx = ev.jammed ? 'jam' : ev.gusher ? 'gusher' : ev.struck ? 'strike'
        : ev.fireOut ? 'fireOut' : ev.bitBroke ? 'bitBroke' : null;
      if (fx) {
        out.push({ to: 'all', msg: { t: 'machineFx', x, y, z, fx } });
        out.push({ to: 'all', msg: { t: 'machine', x, y, z, state: s } });
      }
    }
    // Output hopper: every few seconds a rig empties into an adjacent chest.
    this.machineHopperTimer += dt;
    if (this.machineHopperTimer >= 4) {
      this.machineHopperTimer = 0;
      for (const [key, s] of this.machines) {
        if (totalStored(s) <= 0) continue;
        const [x, y, z] = key.split(',').map(Number);
        for (const [dx, dz] of HOPPER_SIDES) {
          const ck = `${x + dx},${y},${z + dz}`;
          if (this.edits.get(ck) !== Block.Chest) continue;
          const slots = this.chests.get(ck) ?? new Array<ItemStack | null>(CHEST_SLOTS).fill(null);
          if (!depositInto(slots, s.stored)) continue;
          this.chests.set(ck, slots);
          out.push({ to: 'all', msg: { t: 'chest', x: x + dx, y, z: z + dz, slots } });
          out.push({ to: 'all', msg: { t: 'machine', x, y, z, state: s } });
          if (totalStored(s) <= 0) break;
        }
      }
    }
    this.machineLinkTimer += dt;
    if (this.machineLinkTimer >= 1) {
      this.machineLinkTimer = 0;
      linkFuel([...this.machines].map(([key, state]) => {
        const [x, y, z] = key.split(',').map(Number);
        return { key, x, y, z, state };
      }));
    }
    return out;
  }

  /** Re-send a rig's true state to one client (rolls back a refused prediction). */
  private machineRefresh(to: number, x: number, y: number, z: number, s: MachineState): Outbound[] {
    return [{ to, msg: { t: 'machine', x: Math.floor(x), y: Math.floor(y), z: Math.floor(z), state: s } }];
  }

  // --- TRAPCRAFT -------------------------------------------------------------

  /** Trap state at a cell, created (ownerless) if the edit log holds a trap
   *  block with no entity yet — legacy traps from before Trapcraft. */
  private ensureTrap(x: number, y: number, z: number): ReturnType<TrapField['get']> {
    const block = this.edits.get(`${x},${y},${z}`);
    if (block === undefined || !isTrapBlock(block)) return undefined;
    return this.traps.get(x, y, z) ?? this.traps.place(x, y, z, block) ?? undefined;
  }

  private trapSolid(): (x: number, y: number, z: number) => boolean {
    return (x, y, z) => this.solidAt(x, y, z);
  }

  /** Every player a trap may catch right now. */
  private trapTargets(): TrapTarget[] {
    const out: TrapTarget[] = [];
    for (const p of this.players.values()) {
      if (p.dead || p.arenaSaved || p.mode !== 'survival' || this.duels.phaseFor(p.id)) continue;
      if (!fin(p.x, p.y, p.z)) continue;
      out.push({ id: String(p.id), name: p.username, faction: p.faction, x: p.x, y: p.y, z: p.z });
    }
    return out;
  }

  /** Advance every trap against the live players (20 Hz loop). */
  tickTraps(dt: number): Outbound[] {
    if (!fin(dt) || dt <= 0) return [];
    const out: Outbound[] = [];
    if (this.traps.size) {
      out.push(...this.applyTrapResult(this.traps.tick(dt, this.trapTargets(), this.trapSolid())));
    }
    // Bleed / burning damage over time.
    for (const [pid, dot] of [...this.trapDots]) {
      const p = this.players.get(pid);
      if (!p || p.dead || (dot.bleed <= 0 && dot.burn <= 0)) { this.trapDots.delete(pid); continue; }
      dot.bleed = Math.max(0, dot.bleed - dt);
      dot.burn = Math.max(0, dot.burn - dt);
      dot.acc += dt;
      if (dot.acc >= 1) {
        dot.acc -= 1;
        const dmg = (dot.bleed > 0 ? 1 : 0) + (dot.burn > 0 ? 1.5 : 0);
        if (dmg > 0) out.push(...this.applyDamage(p, dmg, this.players.has(dot.by) ? dot.by : -1));
      }
    }
    return out;
  }

  /** Turn a pure trap result into edits, damage, effects and broadcasts. */
  private applyTrapResult(res: TrapTickResult): Outbound[] {
    const out: Outbound[] = [];
    for (const w of res.writes) {
      const key = `${w.x},${w.y},${w.z}`;
      this.edits.set(key, w.block);
      out.push({ to: 'all', msg: { t: 'edit', x: w.x, y: w.y, z: w.z, block: w.block } });
    }
    for (const f of res.fx) {
      out.push({ to: 'all', msg: { t: 'trapFx', x: f.x, y: f.y, z: f.z, kind: f.kind, what: f.what,
        tx: f.tx, ty: f.ty, tz: f.tz } });
    }
    for (const h of res.hits) {
      const victim = this.players.get(Number(h.target));
      if (!victim) continue;
      const owner = h.owner ? this.playerByName(h.owner) : undefined;
      const by = owner ? owner.id : -1;
      for (const e of h.effects) {
        out.push({ to: victim.id, msg: { t: 'effect', kind: e.kind, seconds: e.seconds } });
        if (e.kind === 'bleed' || e.kind === 'burning') {
          const dot = this.trapDots.get(victim.id) ?? { bleed: 0, burn: 0, acc: 0, by };
          if (e.kind === 'bleed') dot.bleed = Math.max(dot.bleed, e.seconds);
          else dot.burn = Math.max(dot.burn, e.seconds);
          dot.by = by;
          this.trapDots.set(victim.id, dot);
        }
      }
      const knock = h.kx || h.kz ? { x: h.kx, y: h.ky, z: h.kz } : undefined;
      out.push(...this.withTrapCause(this.applyDamage(victim, h.damage, by, knock), h.kind, h.owner));
    }
    for (const b of res.blasts) out.push(...this.trapBlast(b));
    for (const a of res.alarms) {
      for (const p of this.players.values()) {
        if (p.username !== a.owner && !(a.owner && sameFaction(p.faction, a.faction))) continue;
        out.push({ to: p.id, msg: { t: 'alarm', x: a.x, y: a.y, z: a.z, owner: a.owner, intruder: a.name } });
      }
    }
    for (const k of new Set(res.changed)) {
      const [x, y, z] = k.split(',').map(Number);
      const t = this.traps.get(x, y, z);
      if (t) out.push({ to: 'all', msg: { t: 'trap', x, y, z, state: t } });
    }
    for (const k of res.removed) {
      const [x, y, z] = k.split(',').map(Number);
      out.push({ to: 'all', msg: { t: 'trap', x, y, z, state: null } });
    }
    return out;
  }

  /** Stamp a trap cause onto any killfeed line this damage produced. */
  private withTrapCause(out: Outbound[], kind: TrapKind, owner: string): Outbound[] {
    for (const o of out) {
      if (o.msg.t === 'killfeed') {
        const verb = TRAP_VERBS[kind] ?? 'caught';
        o.msg.how = owner ? `${verb} by ${owner}'s ${TRAP_NAMES[kind]}` : `${verb} by a ${TRAP_NAMES[kind]}`;
      }
    }
    return out;
  }

  /** A landmine going off: owner/allies are spared (legacy mines hit all). */
  private trapBlast(b: TrapBlast): Outbound[] {
    const out: Outbound[] = [];
    const owner = b.owner ? this.playerByName(b.owner) : undefined;
    const by = owner ? owner.id : -1;
    out.push({ to: 'all', msg: { t: 'blast', x: b.x, y: b.y, z: b.z } });
    for (const t of this.players.values()) {
      if (t.dead || t.arenaSaved) continue;
      if (b.owner && (t.username === b.owner || sameFaction(t.faction, b.faction))) continue;
      const d = Math.hypot(t.x - b.x, t.y - b.y, t.z - b.z);
      const dmg = falloffDamage(b.damage, d, b.radius);
      if (dmg > 0) {
        out.push(...this.withTrapCause(this.applyDamage(t, dmg, by,
          { x: (t.x - b.x) || 0.01, y: 0.4, z: (t.z - b.z) || 0 }), b.kind, b.owner));
      }
    }
    const ir = Math.ceil(b.crater);
    const r2 = b.crater * b.crater + 1;
    for (let dx = -ir; dx <= ir; dx++) {
      for (let dy = -ir; dy <= ir; dy++) {
        for (let dz = -ir; dz <= ir; dz++) {
          if (dx * dx + dy * dy + dz * dz > r2) continue;
          const bx = Math.floor(b.x) + dx, by2 = Math.floor(b.y) + dy, bz = Math.floor(b.z) + dz;
          const key = `${bx},${by2},${bz}`;
          const existing = this.edits.get(key);
          if (existing === undefined || existing === Block.Air) continue;
          if ((BLOCKS[existing]?.hardness ?? -1) < 0) continue;
          if (isVaultMasonry(existing) || existing === Block.VaultChest) continue;
          if (machineTypeForBlock(existing) !== null || existing === Block.MachinePart) continue;
          this.edits.set(key, Block.Air);
          if (this.traps.remove(bx, by2, bz)) out.push({ to: 'all', msg: { t: 'trap', x: bx, y: by2, z: bz, state: null } });
          out.push({ to: 'all', msg: { t: 'edit', x: bx, y: by2, z: bz, block: Block.Air } });
        }
      }
    }
    out.push(...this.blastMachines(b.x, b.y, b.z, b.crater + 1.5));
    return out;
  }

  /** Explosions flatten rigs — except an UNCAPPED well, which catches fire. */
  private blastMachines(x: number, y: number, z: number, radius: number): Outbound[] {
    const out: Outbound[] = [];
    for (const key of [...this.machines.keys()]) {
      const [mx, my, mz] = key.split(',').map(Number);
      if (Math.hypot(mx + 0.5 - x, my + 0.5 - y, mz + 0.5 - z) > radius) continue;
      const s = this.machines.get(key)!;
      if (igniteWell(s)) {
        out.push({ to: 'all', msg: { t: 'machineFx', x: mx, y: my, z: mz, fx: 'ignite' } });
        out.push({ to: 'all', msg: { t: 'machine', x: mx, y: my, z: mz, state: s } });
        continue;
      }
      if (s.fire > 0) continue; // already burning: the fire finishes it
      out.push(...this.destroyMachine(key, mx, my, mz));
    }
    return out;
  }

  /** Sneak up to a hostile trap and hold USE: it comes up safe, into your bag. */
  private handleTrapDefuse(p: ServerPlayer, x: number, y: number, z: number): Outbound[] {
    if (!fin(x, y, z) || p.dead) return [];
    const bx = Math.floor(x), by = Math.floor(y), bz = Math.floor(z);
    if (Math.hypot(bx + 0.5 - p.x, by + 0.5 - p.y, bz + 0.5 - p.z) > 3.5) return [];
    if (!p.sneaking) return [{ to: p.id, msg: { t: 'notice', text: 'Sneak to defuse — one wrong step and it goes off.' } }];
    const block = this.edits.get(`${bx},${by},${bz}`);
    if (block === undefined || !isTrapBlock(block)) return [];
    const t = this.ensureTrap(bx, by, bz);
    if (!t) return [];
    this.traps.remove(bx, by, bz);
    this.edits.set(`${bx},${by},${bz}`, Block.Air);
    // Item form is always the base variant (LeverOn → Lever, etc.).
    const item = block === Block.LeverOn ? Block.Lever : block === Block.FallTrapOpen ? Block.FallTrap
      : block === Block.WallTrapUp ? Block.WallTrap : block;
    return [
      { to: 'all', msg: { t: 'edit', x: bx, y: by, z: bz, block: Block.Air } },
      { to: 'all', msg: { t: 'trap', x: bx, y: by, z: bz, state: null } },
      { to: p.id, msg: { t: 'gotitem', item, count: 1 } },
      { to: p.id, msg: { t: 'notice', text: `Defused a ${TRAP_NAMES[t.kind]}.` } },
    ];
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
    items: { id: number; count: number }[], x: number, y: number, z: number
  ): Outbound[] {
    // Dead players DO drop (death spill), so no alive-guard here.
    if (!fin(x, y, z) || !Array.isArray(items)) return [];
    const out: Outbound[] = [];
    let n = 0;
    for (const it of items) {
      if (n++ >= 64) break; // sanity cap per request
      if (!it || !ITEMS[it.id] || !fin(it.count) || it.count <= 0) continue;
      if (isMinigameOnly(it.id)) continue; // redundant with spawnItem, deliberately
      const count = Math.floor(it.count);
      out.push(...this.spawnItem(it.id, count, x + (this.rng() - 0.5), y, z + (this.rng() - 0.5)));
    }
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
    p: ServerPlayer, x: number, y: number, z: number, block: number, facing?: number
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
    // Traps: breaking one drops its entity — and MINING a hostile armed trap
    // (instead of sneaking up and defusing it) sets it off on the miner.
    if (prev !== undefined && isTrapBlock(prev) && trapKindForBlock(prev) !== trapKindForBlock(block)) {
      const target = { id: String(p.id), name: p.username, faction: p.faction, x: p.x, y: p.y, z: p.z };
      if (!this.traps.has(x, y, z)) this.traps.place(x, y, z, prev);
      out.push(...this.applyTrapResult(this.traps.spring(x, y, z, target, this.trapSolid())));
    }
    this.edits.set(key, block);
    // Placing a machine block creates its server entity, which then ticks even
    // with no chunk loaded and no one viewing it. The placer owns it.
    const placed = machineTypeForBlock(block);
    if (placed !== null && !this.machines.has(key)) {
      this.machines.set(key, newMachine(placed, p.username, p.faction));
      out.push({ to: 'all', msg: { t: 'machine', x, y, z, state: this.machines.get(key)! } });
    }
    const trapKind = trapKindForBlock(block);
    if (trapKind !== null && trapKindForBlock(prev ?? -1) !== trapKind) {
      const f = typeof facing === 'number' && Number.isFinite(facing) ? Math.max(0, Math.min(4, Math.floor(facing))) : 0;
      const t = this.traps.place(x, y, z, block, p.username, p.faction, f);
      if (t) out.push({ to: 'all', msg: { t: 'trap', x, y, z, state: t } });
    }
    if (block === Block.Turret && !this.turrets.has(key)) {
      // The placer owns it straight away — a fresh turret isn't left inert
      // (or up for grabs) until someone remembers to press Claim.
      this.turrets.set(key, newTurret(p.username, p.faction));
    }
    out.push({ to: 'all', msg: { t: 'edit', x, y, z, block } });
    // Everyone learns the new turret's owner/faction now, not on first open.
    const placedTurret = block === Block.Turret ? this.turrets.get(key) : undefined;
    if (placedTurret) out.push({ to: 'all', msg: { t: 'turret', x, y, z, state: placedTurret } });
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
    if (p.arenaSaved || p.away || p.dead || amount <= 0) return [];
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

  /** Relocate a turret, carrying its whole state (level/ammo/fuel/hp/owner)
   *  to the new cell. The destination must be open air, not another entity. */
  private moveTurret(fx: number, fy: number, fz: number, tx: number, ty: number, tz: number): Outbound[] {
    const fromKey = `${fx},${fy},${fz}`, toKey = `${tx},${ty},${tz}`;
    if (fromKey === toKey || ty < 0 || ty >= 256) return [];
    const s = this.turrets.get(fromKey);
    if (!s || this.turrets.has(toKey)) return [];
    const dest = this.edits.get(toKey);
    if (dest !== undefined && dest !== Block.Air && (machineTypeForBlock(dest) !== null ||
      dest === Block.Chest || isTrapBlock(dest))) return [];
    if (this.solidAt(tx + 0.5, ty + 0.5, tz + 0.5)) return [];
    this.turrets.delete(fromKey);
    this.edits.set(fromKey, Block.Air);
    this.turrets.set(toKey, s);
    this.edits.set(toKey, Block.Turret);
    return [
      { to: 'all', msg: { t: 'edit', x: fx, y: fy, z: fz, block: Block.Air } },
      { to: 'all', msg: { t: 'edit', x: tx, y: ty, z: tz, block: Block.Turret } },
      { to: 'all', msg: { t: 'turret', x: tx, y: ty, z: tz, state: s } },
    ];
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
      // An online owner who switched faction takes the turret with them, so it
      // never keeps guarding (and sparing) the side they left.
      const owner = this.playerByName(s.owner);
      if (owner && owner.faction !== s.faction) s.faction = owner.faction;
      if (!turretArmed(s)) continue; // unclaimed/empty/disabled turrets are inert
      const [tx, ty, tz] = key.split(',').map(Number);
      const cx = tx + 0.5, cy = ty + TURRET_MUZZLE_Y, cz = tz + 0.5;
      const range = turretRange(s.level);
      const solid = (x: number, y: number, z: number) => this.solidAt(x, y, z);
      let best: ServerPlayer | null = null;
      let bestD2 = range * range;
      for (const p of this.players.values()) {
        // Skip the dead, the owner, and anyone in the turret's own faction.
        if (p.dead || p.arenaSaved || p.username === s.owner || sameFaction(p.faction, s.faction)) continue;
        const dx = p.x - cx, dy = p.y + 0.9 - cy, dz = p.z - cz;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 > bestD2) continue;
        // Walls, hills and bunkers are cover: no shooting through terrain.
        if (!turretHasLineOfSight(tx, ty, tz, p.x, p.y + 0.9, p.z, solid) &&
            !turretHasLineOfSight(tx, ty, tz, p.x, p.y + 1.5, p.z, solid)) continue;
        bestD2 = d2; best = p;
      }
      if (!best) continue;
      s.facingYaw = Math.atan2(best.x - cx, best.z - cz); // aim heading toward the target
      turretConsumeShot(s);
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

  // --- FACTIONS: the allegiance pledge and the public dossiers --------------

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
   * side they have not joined gets its roster and its headcount, nothing more.
   */
  private factionPublics(): FactionPublic[] {
    const online = this.onlineFactionCounts();
    return FACTIONS.map((f) => {
      const roster = this.factionRoster?.(f.id, FACTION_ROSTER_LIMIT);
      const members = roster ?? [...this.players.values()]
        .filter((p) => p.faction === f.id).map((p) => p.username)
        .sort((a, b) => a.localeCompare(b)).slice(0, FACTION_ROSTER_LIMIT);
      // Faces for the card's plinth. Only ONLINE members can supply real
      // cosmetics, so the card shows the citizens you would be fighting
      // alongside right now.
      const faces = [...this.players.values()]
        .filter((p) => p.faction === f.id)
        .sort((a, b) => a.username.localeCompare(b.username))
        .slice(0, FACTION_FACES_LIMIT)
        .map((p) => ({ username: p.username, cosmetics: p.cosmetics }));
      return {
        faction: f.id,
        members,
        memberCount: this.factionCitizens?.(f.id) ?? online[f.id] ?? 0,
        faces,
      };
    });
  }

  /** Push the public dossiers to everyone. */
  private broadcastFactions(): Outbound[] {
    return [{ to: 'all', msg: { t: 'factions', factions: this.factionPublics() } }];
  }

  private govErr(to: number, reason: string): Outbound[] {
    return [{ to, msg: { t: 'govErr', reason } }];
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
    out.push(...this.broadcastFactions());
    return out;
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
    // Machines are immune to bullets/melee but DEMOLISHED outright by a blast
    // (an uncapped gusher catches fire instead).
    out.push(...this.blastMachines(x, y, z, blastR + 1.5));
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

  /** The edit log with every minigame column removed.
   *
   *  `this.edits` is one map because the arena reset sweeps it by footprint,
   *  but only the open-world part of it is the WORLD: arena blocks are
   *  ephemeral match state that must never reach the save file or another
   *  player's login. A retired mode used to leave its wool in the world save
   *  permanently, and it would still be there today. */
  private worldEdits(): [string, number][] {
    return [...this.edits.entries()].filter(([key]) => !isArenaEditKey(key));
  }

  serialize(): WorldSave {
    return {
      v: 3,
      seed: this.seed,
      worldTime: this.worldTime,
      edits: this.worldEdits(),
      chests: [...this.chests.entries()],
      machines: [...this.machines.entries()],
      turrets: [...this.turrets.entries()],
      traps: this.traps.serialize(),
      season: this.season,
      war: this.war,
      warWins: this.warWins.slice(),
      flags: this.flags,
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
        // Drop arena columns on the way in as well as on the way out, so a
        // world written by an older build sheds the minigame blocks it should
        // never have kept the first time it is loaded.
        if (typeof k === 'string' && isArenaEditKey(k)) continue;
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
    if (Array.isArray(s.traps)) {
      for (const e of s.traps) {
        if (!Array.isArray(e) || e.length !== 2) continue;
        const [k, raw] = e as [unknown, unknown];
        const st = sanitizeTrap(raw);
        if (validBlockKey(k) && st) {
          const [x, y, z] = (k as string).split(',').map(Number);
          this.traps.set(x, y, z, st);
        }
      }
    }
    // Legacy trap blocks (placed before Trapcraft) become ownerless traps.
    for (const [k, b] of this.edits) {
      if (!isTrapBlock(b)) continue;
      const [x, y, z] = k.split(',').map(Number);
      if (!this.traps.has(x, y, z)) this.traps.place(x, y, z, b);
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
    // Older saves may still carry `politics`/`treasuries` from the removed
    // faction government; they are ignored and dropped on the next save.
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

  /** Everyone in the same live match as `id`, whichever mode that is.
   *
   *  Asking Duels for this unconditionally was a bug with two faces: a Bridge
   *  or Parkour competitor got an EMPTY set and so never saw their opponent at
   *  all, and the rule that keeps one match's bodies out of another match's
   *  snapshot only ever held for Duels. Every mode's roster now comes from
   *  that mode's own lobby, which is also what makes many simultaneous
   *  matches — in either band — safe. */
  private arenaMembersOf(id: number): number[] {
    return this.players.get(id)?.arenaKind === 'party'
      ? this.party.membersOf(id)
      : this.duels.membersOf(id);
  }

  /** Is this arena body a spectator waiting to respawn — invisible to the rest
   *  of its match — in whichever mode owns it?
   *
   *  Only Duels has that state. The Bridge and Parkour put a fallen player
   *  straight back on a pad (`pendingSpawn`), so nobody in the party band is
   *  ever a ghost. */
  private arenaSpectating(id: number): boolean {
    return this.players.get(id)?.arenaKind !== 'party' &&
      this.duels.participantFor(id)?.spectating === true;
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
    const inArena = !!recipient.arenaSaved;
    const visible = inArena ? new Set(this.arenaMembersOf(recipientId)) : null;
    return [...this.players.values()]
      .filter((p) => {
        const pInArena = !!p.arenaSaved;
        if (inArena) return visible!.has(p.id);
        return !pInArena && (!p.away || p.id === recipientId);
      })
      .map((p) => ({
        id: p.id, x: p.x, y: p.y, z: p.z, yaw: p.yaw, pitch: p.pitch, ct: p.ct,
        health: p.health,
        // A respawn spectator is invisible to opponents, while their own
        // client stays technically alive to bypass the normal death screen.
        dead: p.arenaSaved
          ? p.id !== recipientId && this.arenaSpectating(p.id)
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
  traps?: [string, import('../traps').TrapState][];
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
