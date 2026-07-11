// Authoritative-lite game server logic, transport-agnostic and pure (no ws,
// no Node APIs) so it can be unit-tested headlessly and reused by the WS
// shell. Owns: the shared edit log, every player's health, username
// assignment, spawns (via the shared deterministic Terrain), PvP hit
// validation, regen, and snapshots.

import { BLOCKS, Block } from '../blocks';
import { ITEMS, ItemStack } from '../items';
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
  SeasonState, newSeason, sanitizeSeason, seasonTimeLeft, seasonExpired,
  tickSeasonClock, advanceSeason, deadlineWinner,
} from '../season';
import {
  WarState, newWar, warActive, warSnapshot, scheduleWar, sanitizeWar,
  warBorderAt, warDuration, DEFAULT_WAR_DURATION,
} from '../war';
import { XP_PLAYER_KILL, XP_REPORT_CAP, sanitizeFactionXp } from '../progress';
import { GadgetCooldowns, gadgetOf, falloffDamage } from '../gadgets';
import {
  GW_MIN_PLAYERS, GW_SLOTS, GW_SWORD_DAMAGE, GW_VOID_Y, gwBalancedTeam,
  gwBaseBlockAt, gwSlotAt, gwSlotBounds, gwSpawn, gwTeamName, goldPos,
  newGwCode,
} from '../goldwars';
import { leverFlips } from '../traps';
import { Terrain } from '../terrain';
import { structureChestTier, worldStructures } from '../structures';
import { chestLootSlots } from '../loot';
import {
  VAULT_BOSS_NAMES, VaultServerState, VaultStamp, bruteMaxHp, newVaultState,
  refreshVaultState, recordVaultLoot, sanitizeVaultState, vaultChestAt,
  vaultLoot, vaultLootCooldownLeft, vaultLootable, vaultStamp,
  worldVaults,
} from '../vaults';
import {
  ClientMsg, EDIT_RANGE, CHEST_SLOTS, MELEE_RANGE, PICKUP_RANGE,
  ARMOR_POINT_CAP, RANGED_MAX_RANGE, RANGED_MAX_DAMAGE,
  mitigate, ItemEntityInfo, PlayerInfo, PlayerSnapshot, ServerMsg,
  WORLD_SEED, WORLD_HALF, WORLD_BORDER, CORE_HALF, makeUsername, skinSeed, GameMode,
  MAX_ATTUNED, TOTEM_COOLDOWN, COMBAT_TAG, TPA_EXPIRE,
} from './protocol';
import {
  COMEBACK_HEARTS, KILL_CREDIT_WINDOW, MAX_HEARTS, canConsume, canWithdraw,
  clampHearts, maxHealthFor, transferHeart,
} from '../hearts';

const SEASON_BROADCAST = 2;      // seconds between season-clock broadcasts
const WAR_BROADCAST = 2;         // seconds between war-clock broadcasts
// Rocket splash (mirrors the client-side mobs.explode blast so PvP/craters sync).
const ROCKET_BLAST_DAMAGE = 22; // base AoE damage at the burst centre
const ROCKET_BLAST_RADIUS = 6;  // player-damage falloff radius (blocks)
const ROCKET_CRATER_RADIUS = 3; // block-destruction radius (= client EXPLOSION_RADIUS)

/** All arguments are finite numbers (rejects NaN/Infinity/non-numbers). */
function fin(...ns: number[]): boolean {
  return ns.every((n) => Number.isFinite(n));
}

const REGEN_INTERVAL = 2;       // +1 HP every 2s out of combat
const REGEN_DELAY = 5;          // seconds after damage before regen resumes

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
  /** worldTime of the last damage taken from ANY source (combat tag: no
   *  totem teleports for COMBAT_TAG seconds after). */
  lastDamageTime: number;
  /** Attuned Waypoint Totem positions (max MAX_ATTUNED; persisted per account). */
  totems: { x: number; y: number; z: number }[];
  /** worldTime before which totem teleports are refused (60s cooldown). */
  totemCooldownUntil: number;
  /** Worn-armor defense points the client reports (clamped 0..cap). */
  armorPoints: number;
  /** Secret-switch bookkeeping (Phase 7): defections used this season + which
   *  season they were counted in, and the season a defection forfeited a badge. */
  switchesUsed: number;
  switchSeason: number;
  forfeitSeason: number;
  /** Per-gadget cooldown tracker (Phase 8; server-authoritative anti-spam). */
  gadgetCd: GadgetCooldowns;
  /** Personal respawn point set via a Respawn Beacon (right-click). undefined =
   *  use the default faction spawn. Persisted with the account. */
  spawnX?: number; spawnY?: number; spawnZ?: number;
  /** Last client-pushed persistable blob (inventory/hotbar) for saveState. */
  savedClientData?: Record<string, unknown>;
  /** Newest pending TPA request AT this player (someone wants to port to
   *  them); expires TPA_EXPIRE seconds after `at` (worldTime). */
  tpaFrom?: { id: number; username: string; at: number };
  // --- GOLDWARS ---
  /** Lobby code while in a Goldwars lobby/match (undefined = civilization). */
  gw?: string;
  /** Team id within the lobby (0 Crimson / 1 Azure). */
  gwTeam: number;
  /** Knocked out of the running match (gold gone + died). */
  gwOut: boolean;
  /** Pre-match civilization position, restored when the match ends. */
  civPos?: { x: number; y: number; z: number };
}

/** One Goldwars lobby: invite code, membership and (once started) match state. */
interface GwLobby {
  code: string;
  host: number;
  started: boolean;
  /** Arena slot occupied while started (-1 = none). */
  slot: number;
  members: number[];
  /** Each team's gold block still standing? */
  goldAlive: [boolean, boolean];
}

const GAME_MODES: GameMode[] = ['survival', 'creative', 'spectator'];

/** Client messages a spectator may NOT send (world edits + combat + economy). */
const SPECTATOR_BLOCKED = new Set<ClientMsg['t']>([
  'edit', 'lever', 'attack', 'rangedAttack', 'selfhurt', 'drop', 'pickup', 'chestSet',
  'machineConfig', 'machineUpgrade', 'machineCollect', 'machineHit', 'machineClaim',
  'machineMove', 'setSpawn',
  'turretUpgrade', 'turretClaim', 'turretHit', 'turretLoad',
  'gadgetUse', 'rocketBlast', 'xp',
  'heartConsume', 'heartWithdraw', 'beaconRevive', 'useHeal',
  'attune', 'totemTeleport',
  'vaultBossHit', 'vaultChestOpen',
]);

/** One message the transport should deliver. `to` is a client id, or a
 *  fan-out target. */
export interface Outbound {
  to: number | 'all' | 'others';
  from?: number; // for 'others', the id to exclude
  msg: ServerMsg;
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
  // War windows: the shrinking-border battle (admin-scheduled).
  private war: WarState = newWar();
  private warAccum = 0;
  private warWasActive = false;
  /** Kills per faction id in the CURRENT war (most kills wins the war). */
  private warKills: number[] = new Array(FACTIONS.length).fill(0);
  /** War wins per faction id THIS SEASON (most wins takes the season). */
  private warWins: number[] = new Array(FACTIONS.length).fill(0);
  /** Shared faction XP pools (progression perks for every member). */
  private factionXp: number[] = new Array(FACTIONS.length).fill(0);
  // Seasons (Phase 5): month-long war cycles with reset + a "Seasons Won" badge.
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
  onEliminate?: (username: string, by: string) => number;
  /** Revival Beacon (A3): eliminated faction-mates of `faction` (from the
   *  account store — the pure core doesn't know offline accounts). */
  listEliminated?: (faction: number) => { username: string; remainingMs: number }[];
  /** Revival Beacon (A3): clear `target`'s elimination if they're an eliminated
   *  member of `faction`; returns success. `by` is credited in the target's
   *  next-login notice. */
  onRevive?: (target: string, faction: number, by: string) => boolean;
  // GOLDWARS: live lobbies by invite code + which arena slots are in use.
  // Ephemeral by design (a restart clears matches; the arena resets on start).
  private readonly gwLobbies = new Map<string, GwLobby>();
  private readonly gwSlotsBusy = new Set<number>();
  // Vaults (Milestone D): per-vault boss HP + per-player loot ledger, keyed
  // by the anchor chunk "cx,cz". Persisted in the world save.
  private readonly vaults = new Map<string, VaultServerState>();
  /** Deterministic vault stamps are pricey to rebuild — cache by anchor chunk. */
  private readonly vaultStamps = new Map<string, VaultStamp | null>();
  private worldTime = 0;        // seconds since boot
  private readonly items = new Map<number, ItemEntityInfo>();
  /** Per-item fall state (server-owned gravity so drops settle to the ground). */
  private readonly itemPhys = new Map<number, { vy: number; resting: boolean }>();
  private nextEid = 1;

  constructor(seed = WORLD_SEED, rng: () => number = Math.random) {
    this.seed = seed;
    this.rng = rng;
    this.terrain = new Terrain(seed);
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

  private spawn(): { x: number; y: number; z: number } {
    // Spawns stay inside the Heartland core (B2) — nobody wakes up in the Wilds.
    const s = this.terrain.randomDrySpawn(this.rng, CORE_HALF);
    return { x: s.x, y: s.y, z: s.z };
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
    switchesUsed?: number; switchSeason?: number; forfeitSeason?: number;
    data?: Record<string, unknown>;
  }): Outbound[] {
    const username = account?.username && !this.usernameOnline(account.username)
      ? account.username : this.uniqueUsername();
    const faction = account?.faction !== undefined && FACTIONS.some((f) => f.id === account.faction)
      ? account.faction : this.assignFaction();
    // Restore the saved position if the account carries one (and it's finite +
    // above bedrock); otherwise drop in at a fresh scatter spawn.
    const saved = account?.data;
    const sx = saved?.x, sy = saved?.y, sz = saved?.z, syaw = saved?.yaw;
    const hasPos = fin(sx as number, sy as number, sz as number) && (sy as number) > 0;
    const s = hasPos
      ? { x: sx as number, y: sy as number, z: sz as number }
      : this.spawn();
    const savedMode = typeof saved?.mode === 'string' && GAME_MODES.includes(saved.mode as GameMode)
      ? saved.mode as GameMode : 'survival';
    // Lifesteal: hearts persist in the account data blob; fresh accounts (or
    // junk values) start at START_HEARTS via clampHearts' fail-safe.
    const hearts = clampHearts(saved?.hearts);
    const player: ServerPlayer = {
      id, username, skin: skinSeed(username), faction, mode: savedMode,
      seasonsWon: Number.isFinite(account?.seasonsWon) ? Math.max(0, Math.floor(account!.seasonsWon!)) : 0,
      hearts,
      x: s.x, y: s.y, z: s.z, yaw: fin(syaw as number) ? syaw as number : 0, pitch: 0,
      health: maxHealthFor(hearts), dead: false, regenCooldown: 0, regenTimer: 0,
      regenBoostTimer: 0, regenBoostInterval: 0,
      lastHitBy: -1, lastHitTime: -Infinity, eliminated: false,
      lastDamageTime: -Infinity,
      totems: GameServer.sanitizeTotems(saved?.totems),
      totemCooldownUntil: 0,
      armorPoints: 0,
      switchesUsed: Number.isFinite(account?.switchesUsed) ? Math.max(0, Math.floor(account!.switchesUsed!)) : 0,
      switchSeason: Number.isFinite(account?.switchSeason) ? Math.floor(account!.switchSeason!) : 0,
      forfeitSeason: Number.isFinite(account?.forfeitSeason) ? Math.floor(account!.forfeitSeason!) : 0,
      gadgetCd: new GadgetCooldowns(),
      gwTeam: 0, gwOut: false,
    };
    // Restore a saved personal respawn point if the account carries one.
    if (fin(saved?.spawnX as number, saved?.spawnY as number, saved?.spawnZ as number)) {
      player.spawnX = saved!.spawnX as number;
      player.spawnY = saved!.spawnY as number;
      player.spawnZ = saved!.spawnZ as number;
    }
    this.players.set(id, player);
    const welcome: ServerMsg = {
      t: 'welcome', id, seed: this.seed, username,
      players: [...this.players.values()].map(toInfo),
      edits: [...this.edits.entries()],
      items: [...this.items.values()],
      turrets: [...this.turrets.entries()].map(([k, state]) => {
        const [x, y, z] = k.split(',').map(Number);
        return { x, y, z, state };
      }),
      season: { number: this.season.number, timeLeft: seasonTimeLeft(this.season) },
      war: { ...warSnapshot(this.war, this.worldTime),
        score: this.warKills.slice(), wins: this.warWins.slice() },
      factionXp: this.factionXp.slice(),
      state: saved, // opaque per-account blob (inventory/hotbar) for the client to restore
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
    const out: Outbound[] = [];
    // Goldwars cleanup first: leave the lobby / forfeit the match so the
    // remaining players get a proper win instead of a ghost opponent.
    if (p.gw) out.push(...this.gwLeave(p));
    this.players.delete(id);
    out.push({ to: 'others', from: id, msg: { t: 'leave', id } });
    return out;
  }

  /** Handle one client message; returns messages to deliver. */
  handle(id: number, msg: ClientMsg): Outbound[] {
    const p = this.players.get(id);
    if (!p) return [];
    // Spectators are non-interacting ghosts: drop any world-mutating / combat
    // message. They may still move (xform), persist (saveState), and respawn.
    if (p.mode === 'spectator' && SPECTATOR_BLOCKED.has(msg.t)) return [];
    switch (msg.t) {
      case 'xform': {
        // Reject non-finite transforms so they can't poison distance/facing
        // math elsewhere (range/hit checks must never fail open).
        if (!p.dead && fin(msg.x, msg.y, msg.z, msg.yaw, msg.pitch)) {
          // Clamp into the (war-shrinking) world border — a client can't roam
          // past it, and during a war the closing ring drags everyone inward.
          const half = this.borderHalf();
          p.x = Math.max(-half, Math.min(half, msg.x));
          p.z = Math.max(-half, Math.min(half, msg.z));
          p.y = msg.y;
          p.yaw = msg.yaw; p.pitch = msg.pitch;
          p.gliding = msg.gliding === true;
          p.boating = msg.boating === true;
          // A live Goldwars match pens its players into their arena slot.
          const gwL = p.gw ? this.gwLobbies.get(p.gw) : undefined;
          if (gwL?.started) {
            const b = gwSlotBounds(gwL.slot);
            p.x = Math.max(b.minX, Math.min(b.maxX, p.x));
            p.z = Math.max(b.minZ, Math.min(b.maxZ, p.z));
          }
        }
        return [];
      }
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
        if (p.dead || p.gw || typeof msg.target !== 'string') return [];
        const name = msg.target.slice(0, 32).trim();
        const targetId = this.playerIdByName(name);
        const target = targetId !== undefined ? this.players.get(targetId) : undefined;
        if (!target) {
          return [{ to: id, msg: { t: 'notice', text: `"${name}" is not online.` } }];
        }
        if (target.id === p.id) {
          return [{ to: id, msg: { t: 'notice', text: "You can't TPA to yourself!" } }];
        }
        target.tpaFrom = { id: p.id, username: p.username, at: this.worldTime };
        return [
          { to: target.id, msg: { t: 'tpaRequest', from: p.username } },
          { to: id, msg: { t: 'notice',
            text: `📨 TPA sent to ${target.username} — if they accept, you teleport to them.` } },
        ];
      }
      case 'tpaAccept': {
        const req = p.tpaFrom;
        p.tpaFrom = undefined; // one shot, granted or not
        if (p.dead || p.gw) return []; // no TPA into (or out of) a Goldwars arena
        if (!req || this.worldTime - req.at > TPA_EXPIRE) {
          return [{ to: id, msg: { t: 'notice', text: 'That TPA request has expired.' } }];
        }
        const requester = this.players.get(req.id);
        // The slot id could have been recycled by a reconnect — verify the name.
        if (!requester || requester.dead || requester.username !== req.username) {
          return [{ to: id, msg: { t: 'notice', text: `${req.username} is no longer available.` } }];
        }
        requester.x = p.x; requester.y = p.y; requester.z = p.z;
        return [
          { to: requester.id, msg: { t: 'teleport', x: p.x, y: p.y, z: p.z } },
          { to: requester.id, msg: { t: 'notice', text: `🌀 ${p.username} accepted your TPA!` } },
          { to: id, msg: { t: 'notice', text: `🌀 ${requester.username} teleported to you.` } },
        ];
      }
      case 'attack':
        return this.handleAttack(p, msg.target);
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
      case 'xp': {
        // Mob-kill XP report (mobs are client-simulated). Clamped so a hacked
        // client can't flood the faction pool; personal XP is client-owned.
        if (p.dead || !isFaction(p.faction)) return [];
        const amt = fin(msg.amount) ? Math.max(0, Math.min(XP_REPORT_CAP, Math.floor(msg.amount))) : 0;
        if (amt <= 0) return [];
        this.factionXp[p.faction] += amt;
        return [{ to: 'all', msg: { t: 'fxp', xp: this.factionXp.slice() } }];
      }
      case 'saveState':
        // Stash the client-owned blob (inventory/hotbar). Position is added from
        // the authoritative record at capture time. The shell persists to disk.
        // Ignored inside Goldwars — the temporary kit must never overwrite the
        // real civilization loadout.
        if (!p.gw && msg.data && typeof msg.data === 'object') p.savedClientData = msg.data;
        return [];
      case 'drop':
        return this.handleDrop(p, msg.items, msg.x, msg.y, msg.z);
      case 'pickup':
        return this.handlePickup(p, msg.eid);
      case 'armor': {
        // Client-trusted armor value, but clamped so it can't exceed the cap.
        p.armorPoints = fin(msg.points) ? Math.max(0, Math.min(ARMOR_POINT_CAP, msg.points)) : 0;
        return [];
      }
      case 'rangedAttack':
        return this.handleRanged(p, msg.target, msg.amount);
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
          ? `✨ You revived ${target}!`
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
            text: `🗿 Totem attuned (${p.totems.length}/${MAX_ATTUNED}) — open the map (M) to travel!` } });
        }
        out.push({ to: id, msg: { t: 'attuned', totems: p.totems.slice() } });
        return out;
      }
      case 'totemTeleport': {
        if (p.dead || p.gw || !fin(msg.x, msg.y, msg.z)) return []; // no porting out of Goldwars
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
        // `opened` = YOUR per-player loot cooldown is running (regrows in 30m).
        return [{ to: id, msg: { t: 'vault', cx: st.cx, cz: st.cz, tier: st.tier,
          hp: v.hp, maxHp: bruteMaxHp(st.tier), alive: v.hp > 0,
          opened: vaultLootCooldownLeft(v, p.username, this.worldTime) > 0 } }];
      }
      case 'vaultBossHit':
        return this.handleVaultBossHit(p, msg.cx, msg.cz, msg.amount);
      case 'vaultChestOpen':
        return this.handleVaultChestOpen(p, msg.x, msg.y, msg.z);
      // --- GOLDWARS ---
      case 'gwCreate':
        return this.gwCreate(p);
      case 'gwJoin':
        return this.gwJoin(p, msg.code);
      case 'gwLeave':
        return this.gwLeave(p);
      case 'gwTeam':
        return this.gwSetTeam(p, msg.id, msg.team);
      case 'gwStart':
        return this.gwStart(p);
      default:
        return [];
    }
  }

  // --- GOLDWARS ----------------------------------------------------------------
  // A link-invite bedwars: lobbies keyed by a 5-letter code; on start each
  // lobby occupies one arena slot in the fixed sky-island region. Members are
  // teleported in (their civ position stashed), fight with server-validated
  // SWORD melee only, and respawn while their team's GOLD BLOCK stands.

  /** The lobby snapshot, addressed to every member. */
  private gwLobbyMsgs(L: GwLobby): Outbound[] {
    const players = L.members
      .map((id) => this.players.get(id))
      .filter((m): m is ServerPlayer => !!m)
      .map((m) => ({ id: m.id, username: m.username, team: m.gwTeam }));
    const msg: ServerMsg = { t: 'gwLobby', code: L.code, host: L.host, started: L.started, players };
    return L.members.map((id) => ({ to: id, msg }));
  }

  private gwTeamCounts(L: GwLobby): [number, number] {
    const counts: [number, number] = [0, 0];
    for (const id of L.members) {
      const m = this.players.get(id);
      if (m && (m.gwTeam === 0 || m.gwTeam === 1)) counts[m.gwTeam]++;
    }
    return counts;
  }

  private gwCreate(p: ServerPlayer): Outbound[] {
    if (p.dead) return [];
    if (p.gw) { // already in one — just resend the snapshot
      const L = this.gwLobbies.get(p.gw);
      return L ? this.gwLobbyMsgs(L) : [];
    }
    if (p.mode !== 'survival') {
      return [{ to: p.id, msg: { t: 'gwErr', error: 'Switch to survival mode first.' } }];
    }
    let code = newGwCode(this.rng);
    for (let i = 0; i < 50 && this.gwLobbies.has(code); i++) code = newGwCode(this.rng);
    const L: GwLobby = {
      code, host: p.id, started: false, slot: -1,
      members: [p.id], goldAlive: [true, true],
    };
    this.gwLobbies.set(code, L);
    p.gw = code; p.gwTeam = 0; p.gwOut = false;
    return this.gwLobbyMsgs(L);
  }

  private gwJoin(p: ServerPlayer, code: unknown): Outbound[] {
    if (p.dead) return [];
    const c = String(code ?? '').trim().toUpperCase().slice(0, 8);
    const L = this.gwLobbies.get(c);
    if (p.gw && p.gw !== c) return [{ to: p.id, msg: { t: 'gwErr', error: 'You are already in a lobby.' } }];
    if (!L) return [{ to: p.id, msg: { t: 'gwErr', error: `No Goldwars lobby "${c}" — ask for a fresh link!` } }];
    if (L.members.includes(p.id)) return this.gwLobbyMsgs(L);
    if (L.started) return [{ to: p.id, msg: { t: 'gwErr', error: 'That match already started — ask for a rematch link!' } }];
    if (L.members.length >= 8) return [{ to: p.id, msg: { t: 'gwErr', error: 'That lobby is full (8 players).' } }];
    if (p.mode !== 'survival') {
      return [{ to: p.id, msg: { t: 'gwErr', error: 'Switch to survival mode first.' } }];
    }
    L.members.push(p.id);
    p.gw = c;
    p.gwTeam = gwBalancedTeam(this.gwTeamCounts(L)); // auto-balance; host can reassign
    p.gwOut = false;
    return this.gwLobbyMsgs(L);
  }

  /** Host-only pre-match team assignment ("optionally assign people"). */
  private gwSetTeam(p: ServerPlayer, id: number, team: number): Outbound[] {
    const L = p.gw ? this.gwLobbies.get(p.gw) : undefined;
    if (!L || L.host !== p.id || L.started) return [];
    if (team !== 0 && team !== 1) return [];
    const target = this.players.get(id);
    if (!target || !L.members.includes(id)) return [];
    target.gwTeam = team;
    return this.gwLobbyMsgs(L);
  }

  private gwStart(p: ServerPlayer): Outbound[] {
    const L = p.gw ? this.gwLobbies.get(p.gw) : undefined;
    if (!L || L.started) return [];
    if (L.host !== p.id) return [{ to: p.id, msg: { t: 'gwErr', error: 'Only the host can start.' } }];
    if (L.members.length < GW_MIN_PLAYERS) {
      return [{ to: p.id, msg: { t: 'gwErr', error: `Need at least ${GW_MIN_PLAYERS} players — share the link!` } }];
    }
    const counts = this.gwTeamCounts(L);
    if (counts[0] === 0 || counts[1] === 0) {
      return [{ to: p.id, msg: { t: 'gwErr', error: 'Both teams need at least one player.' } }];
    }
    let slot = -1;
    for (let s = 0; s < GW_SLOTS; s++) if (!this.gwSlotsBusy.has(s)) { slot = s; break; }
    if (slot < 0) return [{ to: p.id, msg: { t: 'gwErr', error: 'All arenas are busy — try again in a bit.' } }];

    const out: Outbound[] = [];
    // Reset the arena: any edit inside this slot reverts to the BASE map (a
    // previous match's craters/bridges/broken gold all restore).
    for (const [key] of [...this.edits]) {
      const [ex, ey, ez] = key.split(',').map(Number);
      if (gwSlotAt(ex, ez) !== slot) continue;
      const base = gwBaseBlockAt(ex, ey, ez);
      this.edits.set(key, base);
      out.push({ to: 'all', msg: { t: 'edit', x: ex, y: ey, z: ez, block: base } });
    }
    // Sweep leftover dropped items off the arena floor.
    const b = gwSlotBounds(slot);
    for (const [eid, info] of [...this.items]) {
      if (info.x >= b.minX && info.x <= b.maxX && info.z >= b.minZ && info.z <= b.maxZ) {
        this.items.delete(eid);
        this.itemPhys.delete(eid);
        out.push({ to: 'all', msg: { t: 'itemremove', eid } });
      }
    }

    this.gwSlotsBusy.add(slot);
    L.slot = slot;
    L.started = true;
    L.goldAlive = [true, true];
    for (const id of L.members) {
      const m = this.players.get(id);
      if (!m) continue;
      m.civPos = { x: m.x, y: m.y, z: m.z }; // restored when the match ends
      m.gwOut = false;
      const sp = gwSpawn(slot, m.gwTeam, this.rng);
      m.x = sp.x; m.y = sp.y; m.z = sp.z;
      m.health = maxHealthFor(m.hearts); m.dead = false;
      m.regenCooldown = 0; m.regenTimer = 0;
      out.push({ to: id, msg: { t: 'gwBegin', slot, team: m.gwTeam } });
      out.push({ to: id, msg: { t: 'teleport', x: sp.x, y: sp.y, z: sp.z } });
      // Everyone else renders this player in their TEAM color for the match
      // (team ids intentionally match faction ids — the disguise path tints).
      out.push({ to: 'others', from: id,
        msg: { t: 'disguised', id, faction: m.gwTeam, until: this.worldTime + 86400 } });
    }
    out.push(...this.gwLobbyMsgs(L));
    return out;
  }

  /** Return one player to civilization (position + avatar color restored). */
  private gwExitPlayer(p: ServerPlayer): Outbound[] {
    const s = p.civPos ?? this.spawn();
    p.civPos = undefined;
    p.gw = undefined;
    p.gwOut = false;
    p.x = s.x; p.y = s.y; p.z = s.z;
    if (p.dead) { p.dead = false; p.health = maxHealthFor(p.hearts); }
    return [
      { to: p.id, msg: { t: 'teleport', x: s.x, y: s.y, z: s.z } },
      { to: 'others', from: p.id,
        msg: { t: 'disguised', id: p.id, faction: p.faction, until: this.worldTime + 86400 } },
    ];
  }

  /** Leave the lobby (pre-match) or forfeit out of the match. Also the
   *  disconnect cleanup path (removePlayer calls it before dropping the id). */
  private gwLeave(p: ServerPlayer): Outbound[] {
    const L = p.gw ? this.gwLobbies.get(p.gw) : undefined;
    if (!L) { p.gw = undefined; return []; }
    const out: Outbound[] = [];
    L.members = L.members.filter((id) => id !== p.id);
    if (L.started) {
      out.push(...this.gwExitPlayer(p));
    } else {
      p.gw = undefined;
    }
    if (!L.members.length) {
      // Last one out turns off the lights.
      if (L.started) this.gwSlotsBusy.delete(L.slot);
      this.gwLobbies.delete(L.code);
      return out;
    }
    if (L.host === p.id) L.host = L.members[0]; // host hand-off
    out.push(...this.gwLobbyMsgs(L));
    out.push(...this.gwCheckWin(L));
    return out;
  }

  /** A Goldwars death chose Respawn: back to base while the team's gold
   *  stands; once it's gone the knockout is final — back to civilization. */
  private gwRespawn(p: ServerPlayer): Outbound[] {
    const L = p.gw ? this.gwLobbies.get(p.gw) : undefined;
    if (!L || !L.started) return this.gwExitPlayer(p); // stale state — bail out
    if (L.goldAlive[p.gwTeam]) {
      const sp = gwSpawn(L.slot, p.gwTeam, this.rng);
      p.x = sp.x; p.y = sp.y; p.z = sp.z;
      p.health = maxHealthFor(p.hearts); p.dead = false;
      p.regenCooldown = 0; p.regenTimer = 0;
      return [{ to: p.id, msg: { t: 'respawned', x: sp.x, y: sp.y, z: sp.z, health: p.health } }];
    }
    p.gwOut = true;
    const out: Outbound[] = [{ to: p.id, msg: { t: 'gwOut' } }];
    for (const id of L.members) {
      out.push({ to: id, msg: { t: 'notice', text: `☠ ${p.username} is OUT!` } });
    }
    out.push(...this.gwExitPlayer(p));
    L.members = L.members.filter((id) => id !== p.id);
    out.push(...this.gwCheckWin(L));
    return out;
  }

  /** End the match if a whole team is gone (out / left / disconnected). */
  private gwCheckWin(L: GwLobby): Outbound[] {
    if (!L.started) return [];
    const counts = this.gwTeamCounts(L);
    if (counts[0] > 0 && counts[1] > 0) return [];
    const winner = counts[0] > 0 ? 0 : counts[1] > 0 ? 1 : -1;
    return this.gwEndMatch(L, winner);
  }

  private gwEndMatch(L: GwLobby, winner: number): Outbound[] {
    const out: Outbound[] = [];
    for (const id of L.members) {
      const m = this.players.get(id);
      out.push({ to: id, msg: { t: 'gwOver', winner } });
      if (m) out.push(...this.gwExitPlayer(m));
    }
    if (winner >= 0) {
      out.push({ to: 'all', msg: { t: 'killfeed',
        killer: gwTeamName(winner), victim: '🏆 GOLDWARS' } });
    }
    this.gwSlotsBusy.delete(L.slot);
    this.gwLobbies.delete(L.code);
    return out;
  }

  /** Per-tick arena upkeep: falling into the void is death. */
  tickGoldwars(dt: number): Outbound[] {
    if (!fin(dt) || dt <= 0) return [];
    const out: Outbound[] = [];
    for (const L of [...this.gwLobbies.values()]) {
      if (!L.started) continue;
      for (const id of [...L.members]) {
        const m = this.players.get(id);
        if (m && !m.dead && m.y < GW_VOID_Y) {
          out.push(...this.applyDamage(m, 999, -1));
        }
      }
    }
    return out;
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
    if (!v) { v = newVaultState(st.tier); this.vaults.set(key, v); }
    refreshVaultState(v, this.worldTime);
    return v;
  }

  /** A reported hit on the Vault Brute: shared server-side HP (all present
   *  players' hits count, like machine sabotage). Fail-closed on range/state. */
  private handleVaultBossHit(p: ServerPlayer, cx: number, cz: number, amount: number): Outbound[] {
    if (p.dead || !fin(cx, cz, amount, p.x, p.z)) return [];
    const st = this.vaultStampAt(Math.floor(cx), Math.floor(cz));
    if (!st) return [];
    // The attacker must actually be at the vault (fail-closed on NaN).
    if (!(Math.hypot(p.x - st.x, p.z - st.z) <= 64)) return [];
    const v = this.ensureVault(st);
    if (v.hp <= 0) return []; // already dead — nothing to hit
    const dmg = Math.max(0, Math.min(40, Math.round(amount)));
    if (dmg <= 0) return [];
    v.hp = Math.max(0, v.hp - dmg);
    const out: Outbound[] = [{ to: 'all', msg: { t: 'vault', cx: st.cx, cz: st.cz,
      tier: st.tier, hp: v.hp, maxHp: bruteMaxHp(st.tier), alive: v.hp > 0 } }];
    if (v.hp <= 0) {
      v.deadAt = this.worldTime; // opens the 10-minute loot window
      out.push({ to: 'all', msg: { t: 'vaultCleared', cx: st.cx, cz: st.cz, by: p.username } });
      out.push({ to: 'all', msg: { t: 'killfeed',
        killer: p.username, victim: `Tier ${st.tier} ${VAULT_BOSS_NAMES[st.bossKind]} ☠` } });
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
        ? '☠ The Vault Brute guards this chest — defeat it first!'
        : '🔒 The vault has resealed — the Brute will return to guard it.' } }];
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
    out.push({ to: p.id, msg: { t: 'notice', text: `✨ Tier ${st.tier} vault treasure claimed!` } });
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
      out.push(this.spawnItem(blockId, 1,
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
        out.push(this.spawnItem(item, c,
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
  private spawnItem(item: number, count: number, x: number, y: number, z: number): Outbound {
    const eid = this.nextEid++;
    const info: ItemEntityInfo = { eid, item, count: Math.min(64, Math.floor(count)), x, y, z };
    this.items.set(eid, info);
    this.itemPhys.set(eid, { vy: 0, resting: false });
    return { to: 'all', msg: { t: 'itemspawn', item: info } };
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
    _p: ServerPlayer, items: { id: number; count: number }[],
    x: number, y: number, z: number
  ): Outbound[] {
    // Dead players DO drop (death spill), so no alive-guard here.
    if (!fin(x, y, z) || !Array.isArray(items)) return [];
    const out: Outbound[] = [];
    let n = 0;
    for (const it of items) {
      if (n++ >= 64) break; // sanity cap per request
      if (!it || !ITEMS[it.id] || !fin(it.count) || it.count <= 0) continue;
      out.push(this.spawnItem(it.id, it.count, x + (this.rng() - 0.5), y, z + (this.rng() - 0.5)));
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
    p: ServerPlayer, x: number, y: number, z: number, block: number
  ): Outbound[] {
    if (p.dead) return [];
    if (!fin(x, y, z) || !fin(p.x, p.y, p.z)) return [];
    x = Math.floor(x); y = Math.floor(y); z = Math.floor(z);
    if (y < 0 || y >= 256) return [];
    // Validate the block id so a hacked client can't broadcast an id that
    // crashes every other client's mesher (BLOCKS[bad] === undefined).
    if (block !== 0 && !BLOCKS[block]) return [];
    const dx = x + 0.5 - p.x, dy = y + 0.5 - p.y, dz = z + 0.5 - p.z;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (!(d2 <= EDIT_RANGE * EDIT_RANGE)) return []; // fail-closed (NaN -> reject)
    const key = `${x},${y},${z}`;
    const prev = this.edits.get(key);
    const out: Outbound[] = [];
    // GOLDWARS arena cells: only players in a RUNNING match on that slot may
    // touch them (civ wanderers can't grief a live arena), your own team's
    // gold is sacred, and mining the ENEMY gold flips their respawns off.
    const gwSlot = gwSlotAt(x, z);
    if (gwSlot !== null) {
      const L = p.gw ? this.gwLobbies.get(p.gw) : undefined;
      if (!L || !L.started || L.slot !== gwSlot) return [];
      for (const team of [0, 1] as const) {
        const g = goldPos(gwSlot, team);
        if (g.x !== x || g.y !== y || g.z !== z || block === Block.GoldBlock) continue;
        if (p.gwTeam === team) {
          return [{ to: p.id, msg: { t: 'notice', text: "⚠ That's YOUR team's gold — defend it!" } }];
        }
        if (L.goldAlive[team]) {
          L.goldAlive[team] = false;
          for (const mid of L.members) {
            out.push({ to: mid, msg: { t: 'gwGold', team, by: p.username } });
          }
          out.push({ to: 'all', msg: { t: 'killfeed',
            killer: p.username, victim: `⛏ ${gwTeamName(team)} GOLD` } });
        }
      }
    }
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
        out.push(this.spawnItem(Item.Cannonball, Math.min(64, ts.ammo), x + 0.5, y + 0.3, z + 0.5));
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
    return out;
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
      out.push(this.spawnItem(s.id, s.count,
        x + 0.5 + (this.rng() - 0.5), y + 0.3, z + 0.5 + (this.rng() - 0.5)));
    }
    return out;
  }

  private handleAttack(attacker: ServerPlayer, targetId: number): Outbound[] {
    // Melee PvP exists ONLY inside a running GOLDWARS match (sword duels).
    // Everywhere else it stays disabled — normal-world PvP is guns-only.
    const L = attacker.gw ? this.gwLobbies.get(attacker.gw) : undefined;
    if (!L || !L.started) return [];
    const target = this.players.get(targetId);
    if (!target || target.dead || attacker.dead || target.id === attacker.id) return [];
    if (target.gw !== attacker.gw) return [];         // same match only
    if (target.gwTeam === attacker.gwTeam) return []; // no friendly fire
    if (!fin(attacker.x, attacker.y, attacker.z, attacker.yaw,
      target.x, target.y, target.z)) return [];
    const dx = target.x - attacker.x, dy = target.y - attacker.y, dz = target.z - attacker.z;
    const dist = Math.hypot(dx, dy, dz);
    if (!(dist <= MELEE_RANGE)) return []; // fail-closed (NaN -> reject)
    const horiz = Math.hypot(dx, dz);
    if (horiz > 0.2) {
      const fwd = { x: -Math.sin(attacker.yaw), z: -Math.cos(attacker.yaw) };
      if ((fwd.x * dx + fwd.z * dz) / horiz < 0.2) return []; // not facing target
    }
    const knock = horiz > 1e-3
      ? { x: dx / horiz, y: 0.35, z: dz / horiz }
      : { x: 0, y: 0.45, z: 0 };
    return this.applyDamage(target, GW_SWORD_DAMAGE, attacker.id, knock);
  }

  /** Gun/projectile PvP: the client raycasts the hit and reports it; the server
   *  sanity-checks range + rough facing (like melee) and applies clamped,
   *  armor-mitigated damage. It can't verify line-of-sight, matching the
   *  authoritative-lite trust model (mobs are client-side). */
  private handleRanged(attacker: ServerPlayer, targetId: number, amount: number): Outbound[] {
    const target = this.players.get(targetId);
    if (!target || target.dead || attacker.dead || target.id === attacker.id) return [];
    if (attacker.gw || target.gw) return []; // GOLDWARS is swords-only (no guns in OR into it)
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
    const dmg = Math.round(Math.max(0, Math.min(RANGED_MAX_DAMAGE, amount)));
    const knock = horiz > 1e-3
      ? { x: dx / horiz, y: 0.3, z: dz / horiz }
      : { x: 0, y: 0.4, z: 0 };
    return this.applyDamage(target, dmg, attacker.id, knock, true);
  }

  /** `direct` marks damage a player personally dealt (gun/explosive) — only
   *  direct hits arm the lifesteal kill-credit window, so turret/mob/fall
   *  deaths never move hearts. */
  private applyDamage(
    p: ServerPlayer, amount: number, by: number,
    knock?: { x: number; y: number; z: number }, direct = false
  ): Outbound[] {
    if (p.dead || amount <= 0) return [];
    if (p.mode !== 'survival') return []; // creative/spectator are invulnerable
    amount = mitigate(amount, p.armorPoints); // server-authoritative armor reduction
    if (amount <= 0) return []; // fully absorbed
    p.health = Math.max(0, p.health - amount);
    p.regenCooldown = REGEN_DELAY;
    p.regenTimer = 0;
    p.lastDamageTime = this.worldTime; // combat tag (blocks totem teleports)
    if (direct && by !== p.id && this.players.has(by)) {
      p.lastHitBy = by;
      p.lastHitTime = this.worldTime;
    }
    const out: Outbound[] = [{
      to: p.id,
      msg: {
        t: 'hurt', health: p.health, dead: p.health <= 0, by,
        kx: knock?.x ?? 0, ky: knock?.y ?? 0, kz: knock?.z ?? 0,
      },
    }];
    if (p.health <= 0 && !p.dead) {
      p.dead = true;
      const killer = this.players.get(by);
      out.push({
        to: 'all',
        msg: {
          t: 'killfeed',
          killer: by === p.id || !killer ? '' : killer.username,
          victim: p.username,
        },
      });
      out.push(...this.settleLifesteal(p));
      // A PvP kill scores XP for the killer + their faction pool, and DURING A
      // WAR it counts toward the war score (most kills wins the shrinking-border
      // battle). Server-awarded — never client-reported. GOLDWARS kills are a
      // minigame: no XP, no war score.
      if (killer && killer !== p && !killer.gw && !p.gw &&
          isFaction(killer.faction) && killer.faction !== p.faction) {
        this.factionXp[killer.faction] += XP_PLAYER_KILL;
        out.push({ to: killer.id, msg: { t: 'xpAward', amount: XP_PLAYER_KILL, reason: 'kill' } });
        out.push({ to: 'all', msg: { t: 'fxp', xp: this.factionXp.slice() } });
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
    if (victim.gw) return []; // Goldwars deaths never move hearts
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
        text: `❤ full (${MAX_HEARTS}) — the stolen heart was wasted!` } });
    }
    if (victim.hearts <= 0) {
      victim.eliminated = true; // blocks respawn until the shell disconnects
      // Comeback penalty is applied NOW so the disconnect persists 5 hearts —
      // the account also carries `eliminatedUntil`, which gates login.
      victim.hearts = COMEBACK_HEARTS;
      const until = this.onEliminate?.(victim.username, killer.username) ?? 0;
      out.push({ to: victim.id, msg: { t: 'eliminated', by: killer.username, until } });
      out.push({ to: 'all', msg: { t: 'killfeed',
        killer: killer.username, victim: `☠ ${victim.username} (ELIMINATED)` } });
    }
    return out;
  }

  /** Where a player respawns: their personal Respawn Beacon if it's set AND the
   *  beacon block still exists there; otherwise the default faction spawn. */
  private respawnPoint(p: ServerPlayer): { x: number; y: number; z: number } {
    if (fin(p.spawnX as number, p.spawnY as number, p.spawnZ as number)) {
      const bx = Math.floor(p.spawnX!), by = Math.floor(p.spawnY!), bz = Math.floor(p.spawnZ!);
      if (this.edits.get(`${bx},${by},${bz}`) === Block.RespawnBeacon) {
        return { x: bx + 0.5, y: by + 1, z: bz + 0.5 }; // stand on top of the beacon
      }
      // Beacon gone (broken/raided): forget the stale point and fall back.
      p.spawnX = p.spawnY = p.spawnZ = undefined;
    }
    return this.spawn();
  }

  private handleRespawn(p: ServerPlayer): Outbound[] {
    if (!p.dead || p.eliminated) return []; // eliminated: no respawn, only the boot
    if (p.gw) return this.gwRespawn(p);     // Goldwars: base spawn / knockout
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
      const max = maxHealthFor(p.hearts);
      // A healing consumable (Bandage/Medkit) grants a window of fast regen that
      // ignores the post-damage delay — patch up mid-fight.
      const boosting = p.regenBoostTimer > 0;
      if (boosting) { p.regenBoostTimer = Math.max(0, p.regenBoostTimer - dt); p.regenCooldown = 0; }
      p.regenCooldown = Math.max(0, p.regenCooldown - dt);
      const interval = boosting ? p.regenBoostInterval : REGEN_INTERVAL;
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
      if (s.ammo > 0) out.push(this.spawnItem(Item.Cannonball, Math.min(64, s.ammo),
        x + 0.5, y + 0.3, z + 0.5));
      out.push(this.spawnItem(Block.Turret, 1,
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
        if (p.dead || p.username === s.owner || sameFaction(p.faction, s.faction)) continue;
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

  // --- The WAR: a shrinking-border battle royale ------------------------------

  /** Is a war on right now? */
  isWarActive(): boolean { return warActive(this.war, this.worldTime); }

  /** The CURRENT border side length: full world in peacetime; during a war it
   *  closes in toward the 100×100 final ring (pure warBorderAt). */
  currentBorder(): number {
    if (!this.isWarActive()) return WORLD_BORDER;
    const timeLeft = Math.max(0, this.war.end - this.worldTime);
    return warBorderAt(timeLeft, warDuration(this.war), WORLD_BORDER);
  }
  private borderHalf(): number { return this.currentBorder() / 2; }

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
        p.x = Math.max(-half, Math.min(half, p.x));
        p.z = Math.max(-half, Math.min(half, p.z));
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
      ? '🕊️ The war ends in a DRAW.'
      : `🏆 ${factionName(winner)} wins the war with ${best} kill${best === 1 ? '' : 's'}!` } });
    this.warKills = new Array(FACTIONS.length).fill(0);
    return out;
  }

  /** War wins per faction id (the season scoreboard). */
  private warWinCounts(): Record<number, number> {
    const counts: Record<number, number> = {};
    for (const f of FACTIONS) counts[f.id] = this.warWins[f.id] ?? 0;
    return counts;
  }

  // --- Seasons (Phase 5) -----------------------------------------------------

  /** Live season state for the HUD (number + seconds left). */
  seasonSnapshot(): ServerMsg {
    return { t: 'season', number: this.season.number, timeLeft: seasonTimeLeft(this.season) };
  }

  /** Advance the season clock; at the deadline the faction with the most WAR
   *  WINS takes the season (a tie is a stalemate — fresh season either way).
   *  Periodically broadcasts the clock for the HUD. */
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
    if (!def || p.dead || p.gw) return []; // no gadgets inside Goldwars
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
    if (p.dead || p.gw || !fin(x, y, z)) return []; // no rockets inside Goldwars
    if (Math.hypot(x - p.x, y - p.y, z - p.z) > RANGED_MAX_RANGE) return [];
    return this.detonate(p, x, y, z,
      ROCKET_BLAST_DAMAGE, ROCKET_BLAST_RADIUS, ROCKET_CRATER_RADIUS);
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
        if (t.dead || t.id === by.id || sameFaction(t.faction, by.faction)) continue;
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
          if (existing === Block.VaultBrick || existing === Block.VaultChest) continue;
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
      { to: id, msg: { t: 'notice', text: `An admin set your hearts to ${p.hearts} ❤` } },
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
      ? '⚔️ WAR! The border is closing — fight!'
      : `⚔️ A war is scheduled — get ready!`;
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
      { to: 'all', msg: { t: 'notice', text: '🕊️ The war is over — peacetime.' } },
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
    const data: Record<string, unknown> = { ...(p.savedClientData ?? {}) };
    // Mid-Goldwars captures persist the CIVILIZATION position, never the arena
    // (a crash/reconnect drops the player back into the real world).
    const pos = p.gw && p.civPos ? p.civPos : p;
    data.x = pos.x; data.y = pos.y; data.z = pos.z; data.yaw = p.yaw; data.mode = p.mode;
    data.hearts = p.hearts; // lifesteal max-health currency survives re-login
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
      v: 1,
      seed: this.seed,
      worldTime: this.worldTime,
      edits: [...this.edits.entries()],
      chests: [...this.chests.entries()],
      machines: [...this.machines.entries()],
      turrets: [...this.turrets.entries()],
      season: this.season,
      war: this.war,
      warWins: this.warWins.slice(),
      factionXp: this.factionXp.slice(),
      vaults: [...this.vaults.entries()],
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
          this.edits.set(k as string, b as number);
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
    this.warWins = sanitizeFactionXp(s.warWins, FACTIONS.length);
    this.factionXp = sanitizeFactionXp(s.factionXp, FACTIONS.length);
    return true;
  }

  /** Transform+health for every player (the periodic broadcast). */
  snapshot(): PlayerSnapshot[] {
    return [...this.players.values()].map((p) => ({
      id: p.id, x: p.x, y: p.y, z: p.z, yaw: p.yaw, pitch: p.pitch,
      health: p.health, dead: p.dead,
      gliding: p.gliding, boating: p.boating,
    }));
  }
}

function toInfo(p: ServerPlayer): PlayerInfo {
  return {
    id: p.id, username: p.username, skin: p.skin, faction: p.faction, mode: p.mode,
    seasonsWon: p.seasonsWon, hearts: p.hearts,
    x: p.x, y: p.y, z: p.z, yaw: p.yaw, pitch: p.pitch,
    health: p.health, dead: p.dead,
    gliding: p.gliding, boating: p.boating,
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
  /** Shared faction XP pools (progression perks). */
  factionXp?: number[];
  /** Vault boss HP + per-player openedBy ledgers (Milestone D). */
  vaults?: [string, VaultServerState][];
}

/** A "x,y,z" integer block-coordinate key (the map keys we persist). */
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
