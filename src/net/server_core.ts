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
  ShipState, applyShipUpgrade, blockWorldPos, cannonCount, damageShip,
  floodFillHull, newShip, shipFireInterval, tickShip, sanitizeShipState,
} from '../ships';
import {
  TurretState, applyTurretUpgrade, claimTurret, damageTurret, newTurret,
  turretArmed, turretConsumeShot, turretDamage, turretLoad, turretRange,
  sanitizeTurretState,
} from '../turrets';
import { FACTIONS, NO_FACTION, balancedFaction, factionName, isFaction, sameFaction } from '../teams';
import {
  Claims, ClaimState, OIL_CAP, claimProtected, damageShield, feedOil, shieldUp,
} from '../claims';
import { Regions, RegionsSave, regionOf } from '../regions';
import {
  SeasonState, newSeason, sanitizeSeason, seasonTimeLeft, seasonExpired,
  tickSeasonClock, advanceSeason, deadlineWinner,
} from '../season';
import { Politics, FactionPolitics, SHIELD_REFILL_OIL } from '../politics';
import { Terrain } from '../terrain';
import {
  ClientMsg, EDIT_RANGE, CHEST_SLOTS, PICKUP_RANGE,
  ARMOR_POINT_CAP, RANGED_MAX_RANGE, RANGED_MAX_DAMAGE, SHIP_HIT_MAX_DAMAGE,
  mitigate, ItemEntityInfo, PlayerInfo, PlayerSnapshot, ServerMsg, ShipTransform,
  WORLD_SEED, WORLD_HALF, makeUsername, skinSeed, GameMode,
} from './protocol';

const BOARD_RANGE = 6;          // how close a player must be to pilot/dock/upgrade a ship
const SHIP_BLAST_RADIUS = 7;    // ship-destruction explosion radius (player damage)
const REGION_BROADCAST = 1;      // seconds between region-board broadcasts
const SEASON_BROADCAST = 2;      // seconds between season-clock broadcasts
const POLITICS_BROADCAST = 3;    // seconds between government-state broadcasts
const CLAIM_BROADCAST = 1;      // seconds between bulk claim-state refreshes
const CLAIM_HIT_MAX = 200;      // server cap on a single reported shield hit
export const RAID_STEAL_FRAC = 0.5; // fraction of a stored container a raid takes

/** All arguments are finite numbers (rejects NaN/Infinity/non-numbers). */
function fin(...ns: number[]): boolean {
  return ns.every((n) => Number.isFinite(n));
}

const MAX_HEALTH = 20;
const REGEN_INTERVAL = 2;       // +1 HP every 2s out of combat
const REGEN_DELAY = 5;          // seconds after damage before regen resumes

interface ServerPlayer extends PlayerInfo {
  regenCooldown: number;
  regenTimer: number;
  /** Worn-armor defense points the client reports (clamped 0..cap). */
  armorPoints: number;
  /** Last client-pushed persistable blob (inventory/hotbar) for saveState. */
  savedClientData?: Record<string, unknown>;
}

const GAME_MODES: GameMode[] = ['survival', 'creative', 'spectator'];

/** Client messages a spectator may NOT send (world edits + combat + economy). */
const SPECTATOR_BLOCKED = new Set<ClientMsg['t']>([
  'edit', 'attack', 'rangedAttack', 'selfhurt', 'drop', 'pickup', 'chestSet',
  'machineConfig', 'machineUpgrade', 'machineCollect', 'machineHit', 'machineClaim',
  'shipLaunch', 'shipSteer', 'shipFire', 'shipDock', 'shipUpgrade', 'shipHit',
  'turretUpgrade', 'turretClaim', 'turretHit', 'turretLoad',
  'claimFeed', 'claimHit',
  'nominate', 'vote', 'setRally', 'appointOfficer', 'dismissOfficer',
  'setTax', 'donate', 'commanderSpend', 'recall',
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
  private readonly ships = new Map<number, ShipState>();
  private readonly shipInput = new Map<number, { thrust: number; turn: number; age: number }>();
  private nextShipId = 1;
  private readonly turrets = new Map<string, TurretState>();
  // Land claims (M18).
  private readonly claims = new Claims();
  // Region board — the 50/50 war frontline (Phase 1).
  private readonly regions = new Regions();
  private regionAccum = 0;
  // Seasons (Phase 5): month-long war cycles with reset + a "Seasons Won" badge.
  private season = newSeason();
  private seasonAccum = 0;
  // Politics (Phase 6): per-faction government (commander/treasury/rally/tax).
  private readonly politics = new Politics();
  private politicsAccum = 0;
  /** Set by the shell to persist "Seasons Won" badges to all winning accounts
   *  (the pure server can't reach the on-disk account store itself). */
  onSeasonEnd?: (winnerFaction: number, seasonNumber: number) => void;
  private worldTime = 0;        // seconds since boot (grace-period clock)
  private claimAccum = 0;
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
    // A random dry-land spot somewhere in the world border (not ocean/air).
    const s = this.terrain.randomDrySpawn(this.rng, WORLD_HALF);
    return { x: s.x, y: s.y, z: s.z };
  }

  /** Register a player; returns the welcome (to them) + join (to others). With
   *  mandatory accounts the shell passes the authenticated account's username +
   *  faction; without them (legacy/tests) it auto-assigns both. */
  addPlayer(id: number, account?: { username?: string; faction?: number; seasonsWon?: number; data?: Record<string, unknown> }): Outbound[] {
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
    const player: ServerPlayer = {
      id, username, skin: skinSeed(username), faction, mode: savedMode,
      seasonsWon: Number.isFinite(account?.seasonsWon) ? Math.max(0, Math.floor(account!.seasonsWon!)) : 0,
      x: s.x, y: s.y, z: s.z, yaw: fin(syaw as number) ? syaw as number : 0, pitch: 0,
      health: MAX_HEALTH, dead: false, regenCooldown: 0, regenTimer: 0,
      armorPoints: 0,
    };
    this.players.set(id, player);
    const welcome: ServerMsg = {
      t: 'welcome', id, seed: this.seed, username,
      players: [...this.players.values()].map(toInfo),
      edits: [...this.edits.entries()],
      items: [...this.items.values()],
      ships: [...this.ships.values()],
      turrets: [...this.turrets.entries()].map(([k, state]) => {
        const [x, y, z] = k.split(',').map(Number);
        return { x, y, z, state };
      }),
      claims: this.claims.list(),
      regions: this.regions.ownerList(),
      season: { number: this.season.number, timeLeft: seasonTimeLeft(this.season) },
      politics: this.politics.serialize(),
      state: saved, // opaque per-account blob (inventory/hotbar) for the client to restore
    };
    return [
      { to: id, msg: welcome },
      { to: 'others', from: id, msg: { t: 'join', player: toInfo(player) } },
    ];
  }

  removePlayer(id: number): Outbound[] {
    if (!this.players.delete(id)) return [];
    return [{ to: 'others', from: id, msg: { t: 'leave', id } }];
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
          // Clamp into the world border (authoritative: a client can't roam past it).
          p.x = Math.max(-WORLD_HALF, Math.min(WORLD_HALF, msg.x));
          p.z = Math.max(-WORLD_HALF, Math.min(WORLD_HALF, msg.z));
          p.y = msg.y;
          p.yaw = msg.yaw; p.pitch = msg.pitch;
        }
        return [];
      }
      case 'edit':
        return this.handleEdit(p, msg.x, msg.y, msg.z, msg.block);
      case 'attack':
        return this.handleAttack(p, msg.target);
      case 'selfhurt':
        return this.applyDamage(p, Math.max(0, Math.min(40, msg.amount)), id);
      case 'respawn':
        return this.handleRespawn(p);
      case 'nominate': case 'vote': case 'setRally':
      case 'appointOfficer': case 'dismissOfficer': case 'setTax':
      case 'donate': case 'commanderSpend': case 'recall':
        return this.handlePolitics(p, msg);
      case 'saveState':
        // Stash the client-owned blob (inventory/hotbar). Position is added from
        // the authoritative record at capture time. The shell persists to disk.
        if (msg.data && typeof msg.data === 'object') p.savedClientData = msg.data;
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
        if (this.enemyShielded(p, msg.x, msg.z)) return []; // can't peek a shielded chest
        const slots = this.chests.get(`${msg.x},${msg.y},${msg.z}`)
          ?? new Array(CHEST_SLOTS).fill(null);
        return [{ to: id, msg: { t: 'chest', x: msg.x, y: msg.y, z: msg.z, slots } }];
      }
      case 'chestSet': {
        if (!Array.isArray(msg.slots)) return [];
        if (this.enemyShielded(p, msg.x, msg.z)) return []; // can't write a shielded chest
        // Only an actual chest block can hold contents. This fail-closes a
        // stale/late write (e.g. from a client whose chest was just broken by
        // someone else) so it cannot resurrect or fork contents at a now-empty
        // location. All chests are player-placed, so a chest position is always
        // recorded in the edit log as Block.Chest.
        if (this.edits.get(`${msg.x},${msg.y},${msg.z}`) !== Block.Chest) return [];
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
        if (this.enemyShielded(p, msg.x, msg.z)) return []; // enemy-claim protection
        const s = this.ensureMachine(msg.x, msg.y, msg.z);
        if (!s) return [];
        return [{ to: id, msg: { t: 'machine', x: msg.x, y: msg.y, z: msg.z, state: s } }];
      }
      case 'machineConfig': {
        if (!this.nearMachine(p, msg.x, msg.y, msg.z)) return [];
        if (this.enemyShielded(p, msg.x, msg.z)) return []; // enemy-claim protection
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
        if (this.enemyShielded(p, msg.x, msg.z)) return []; // enemy-claim protection
        const s = this.ensureMachine(msg.x, msg.y, msg.z);
        if (!s) return [];
        // Cost is paid client-side (authoritative-lite); the server just bumps
        // and caps the level so it can never exceed the max.
        applyUpgrade(s, msg.axis);
        return [{ to: 'all', msg: { t: 'machine', x: msg.x, y: msg.y, z: msg.z, state: s } }];
      }
      case 'machineCollect': {
        if (!this.nearMachine(p, msg.x, msg.y, msg.z)) return [];
        if (this.enemyShielded(p, msg.x, msg.z)) return []; // enemy-claim protection
        const s = this.ensureMachine(msg.x, msg.y, msg.z);
        if (!s) return [];
        const taken = collectMachine(s);
        const out: Outbound[] = [];
        // Faction TAX (Phase 6): the Commander's 0–25% cut of oil PRODUCTION is
        // diverted to the war chest as the player collects it (never stockpiles).
        const oil = taken[Item.OilBarrel];
        if (isFaction(p.faction) && fin(oil) && oil > 0) {
          const cut = this.politics.taxProduction(p.faction, oil);
          if (cut > 0) {
            taken[Item.OilBarrel] = oil - cut;
            out.push({ to: 'all', msg: this.politicsSnapshot() });
          }
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
        if (this.enemyShielded(p, msg.x, msg.z)) return []; // enemy-claim protection
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
        if (this.enemyShielded(p, msg.x, msg.z)) return []; // enemy-claim protection
        const s = this.ensureMachine(msg.x, msg.y, msg.z);
        if (!s) return [];
        claimMachine(s, p.username);
        return [{ to: 'all', msg: { t: 'machine', x: msg.x, y: msg.y, z: msg.z, state: s } }];
      }
      // --- Ships ---
      case 'shipLaunch':
        return this.handleShipLaunch(p, msg.x, msg.y, msg.z);
      case 'shipSteer': {
        const ship = this.ships.get(msg.id);
        if (!ship || !this.nearShip(p, ship)) return [];
        if (!fin(msg.thrust, msg.turn)) return [];
        this.shipInput.set(ship.id, { thrust: msg.thrust, turn: msg.turn, age: 0 });
        return [];
      }
      case 'shipFire': {
        // Anti-spam gate only: the cannonball projectile + its hit are
        // client-simulated and validated via shipHit/rangedAttack (trust model).
        const ship = this.ships.get(msg.id);
        if (!ship || !this.nearShip(p, ship) || cannonCount(ship) < 1) return [];
        if (ship.fireCooldown > 0) return [];
        ship.fireCooldown = shipFireInterval(ship.level);
        return [];
      }
      case 'shipHit': {
        const ship = this.ships.get(msg.id);
        if (!ship || p.dead || !fin(ship.x, ship.y, ship.z, p.x, p.y, p.z, msg.amount)) return [];
        if (sameFaction(p.faction, ship.faction)) return []; // can't shell your own faction's ship
        const dist = Math.hypot(ship.x - p.x, ship.y - p.y, ship.z - p.z);
        if (!(dist <= RANGED_MAX_RANGE)) return []; // fail-closed (NaN -> reject)
        const dmg = Math.max(0, Math.min(SHIP_HIT_MAX_DAMAGE, msg.amount));
        if (dmg <= 0) return [];
        if (damageShip(ship, dmg)) return this.destroyShip(ship);
        return [{ to: 'all', msg: { t: 'shipTransforms', ships: [shipTransform(ship)] } }];
      }
      case 'shipDock': {
        const ship = this.ships.get(msg.id);
        if (!ship || !this.nearShip(p, ship)) return [];
        return this.dockShip(ship);
      }
      case 'shipUpgrade': {
        const ship = this.ships.get(msg.id);
        if (!ship || !this.nearShip(p, ship)) return [];
        if (msg.axis !== 'speed' && msg.axis !== 'hull' && msg.axis !== 'cannon') return [];
        applyShipUpgrade(ship, msg.axis); // cost paid client-side; server caps
        return [{ to: 'all', msg: { t: 'shipState', ship } }];
      }
      // --- Turrets ---
      case 'turretOpen': {
        if (!this.nearMachine(p, msg.x, msg.y, msg.z)) return [];
        if (this.enemyShielded(p, msg.x, msg.z)) return []; // enemy-claim protection
        const s = this.ensureTurret(msg.x, msg.y, msg.z);
        if (!s) return [];
        return [{ to: id, msg: { t: 'turret', x: msg.x, y: msg.y, z: msg.z, state: s } }];
      }
      case 'turretUpgrade': {
        if (msg.axis !== 'range' && msg.axis !== 'damage' && msg.axis !== 'rate') return [];
        if (!this.nearMachine(p, msg.x, msg.y, msg.z)) return [];
        if (this.enemyShielded(p, msg.x, msg.z)) return []; // enemy-claim protection
        const s = this.ensureTurret(msg.x, msg.y, msg.z);
        if (!s) return [];
        applyTurretUpgrade(s, msg.axis);
        return [{ to: 'all', msg: { t: 'turret', x: msg.x, y: msg.y, z: msg.z, state: s } }];
      }
      case 'turretClaim': {
        if (!this.nearMachine(p, msg.x, msg.y, msg.z)) return [];
        if (this.enemyShielded(p, msg.x, msg.z)) return []; // enemy-claim protection
        const s = this.ensureTurret(msg.x, msg.y, msg.z);
        if (!s) return [];
        claimTurret(s, p.username, p.faction);
        return [{ to: 'all', msg: { t: 'turret', x: msg.x, y: msg.y, z: msg.z, state: s } }];
      }
      case 'turretLoad': {
        if (!this.nearMachine(p, msg.x, msg.y, msg.z)) return [];
        if (this.enemyShielded(p, msg.x, msg.z)) return []; // enemy-claim protection
        const s = this.ensureTurret(msg.x, msg.y, msg.z);
        if (!s) return [];
        if (!fin(msg.count) || (msg.item !== Item.Cannonball && msg.item !== Item.OilBarrel)) return [];
        turretLoad(s, msg.item, msg.count); // client only sends what its predicted room allows
        return [{ to: 'all', msg: { t: 'turret', x: msg.x, y: msg.y, z: msg.z, state: s } }];
      }
      case 'turretHit': {
        if (!this.nearMachine(p, msg.x, msg.y, msg.z)) return [];
        if (this.enemyShielded(p, msg.x, msg.z)) return []; // enemy-claim protection
        const s = this.ensureTurret(msg.x, msg.y, msg.z);
        if (!s) return [];
        const dmg = fin(msg.amount) ? Math.max(0, Math.min(1000, msg.amount)) : 0;
        if (damageTurret(s, dmg)) {
          return this.destroyTurret(Math.floor(msg.x), Math.floor(msg.y), Math.floor(msg.z));
        }
        return [{ to: 'all', msg: { t: 'turret', x: msg.x, y: msg.y, z: msg.z, state: s } }];
      }
      // --- Land claims (M18 / M19) ---
      case 'claimOpen': {
        if (!this.nearMachine(p, msg.x, msg.y, msg.z)) return [];
        if (this.enemyShielded(p, msg.x, msg.z)) return []; // enemy-claim protection
        const c = this.claims.coreAt(msg.x, msg.y, msg.z);
        if (!c) return [];
        return [{ to: p.id, msg: { t: 'claim', claim: c } }];
      }
      case 'claimFeed': {
        if (!this.nearMachine(p, msg.x, msg.y, msg.z)) return [];
        if (this.enemyShielded(p, msg.x, msg.z)) return []; // enemy-claim protection
        const c = this.claims.coreAt(msg.x, msg.y, msg.z);
        // Only the owning faction may fuel their Core.
        if (!c || !sameFaction(p.faction, c.faction)) return [];
        if (!fin(msg.count) || msg.count <= 0) return [];
        feedOil(c, Math.floor(msg.count)); // client only sends what its room allowed
        return [{ to: 'all', msg: { t: 'claim', claim: c } }];
      }
      case 'claimHit':
        return this.handleClaimHit(p, msg.x, msg.y, msg.z, msg.amount);
      default:
        return [];
    }
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
    // --- Bases (Phase 3) = land claims (M18) + raiding (M19) ---
    const claim = this.claims.at(x, z);
    const enemyClaim = claim !== undefined && !sameFaction(p.faction, claim.faction);
    // A base is also raidable by whoever OWNS the region it sits in (Phase 3) —
    // not only by breaching the shield. Holding the territory opens the base.
    const ownsRegion = sameFaction(this.regions.ownerOf(x, z), p.faction);
    if (enemyClaim) {
      // Enemies can NEVER break the Core — claims persist through raids.
      if (prev === Block.Core) return [];
      // While the shield holds (or during grace), enemies can't touch the claim —
      // UNLESS they own the region the base is in, which opens it to a raid.
      if (claimProtected(claim!, this.worldTime) && !ownsRegion) return [];
    }
    // A breached (or region-captured) claim: an enemy's break of a stored
    // container raids it.
    const raiding = enemyClaim && claim !== undefined &&
      (!claimProtected(claim, this.worldTime) || ownsRegion);

    // Placing a Core founds a BASE (Phase 3): only inside a region your faction
    // owns, and rejected (no-op) if it would overlap an existing claim.
    if (block === Block.Core && prev !== Block.Core) {
      if (!ownsRegion) {
        return [{ to: p.id, msg: { t: 'notice', text: 'You can only build a base in territory your faction controls!' } }];
      }
      const created = this.claims.create(p.faction, x, y, z, this.worldTime);
      if (!created) return [];
      out.push({ to: 'all', msg: { t: 'claim', claim: created } });
    }
    // The owning faction breaking its own Core dissolves the claim.
    if (prev === Block.Core && block !== Block.Core) {
      const c = this.claims.coreAt(x, y, z);
      if (c) { this.claims.remove(c.id); out.push({ to: 'all', msg: { t: 'claimRemove', id: c.id } }); }
    }
    // Server-authoritative chest break: if this edit removes a chest, spill its
    // stored contents as item entities everyone sees and clear the storage —
    // independent of whether the breaking client ever opened (cached) it. Inside
    // a breached enemy claim the break is a RAID: a capped share goes to the
    // raider, the rest spills to the world (dup-safe — contents leave once).
    if (prev === Block.Chest && block !== Block.Chest) {
      out.push(...(raiding ? this.raidChest(key, x, y, z, p) : this.spillChest(key, x, y, z)));
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

  /** Raid a chest in a breached claim: a capped fraction of EACH stack goes
   *  straight to the raider (dup-safe gotitem path), the remainder spills to the
   *  world. Storage is cleared exactly once, so nothing is duplicated or lost. */
  private raidChest(key: string, x: number, y: number, z: number, raider: ServerPlayer): Outbound[] {
    const contents = this.chests.get(key);
    this.chests.delete(key);
    if (!contents) return [];
    const out: Outbound[] = [];
    for (const s of contents) {
      if (!s || !ITEMS[s.id] || !fin(s.count) || s.count <= 0) continue;
      const stolen = Math.floor(s.count * RAID_STEAL_FRAC);
      if (stolen > 0) out.push({ to: raider.id, msg: { t: 'gotitem', item: s.id, count: stolen } });
      const rest = s.count - stolen;
      if (rest > 0) out.push(this.spawnItem(s.id, rest,
        x + 0.5 + (this.rng() - 0.5), y + 0.3, z + 0.5 + (this.rng() - 0.5)));
    }
    return out;
  }

  private handleAttack(attacker: ServerPlayer, targetId: number): Outbound[] {
    // Melee PvP is disabled — players can only be damaged by guns/explosions,
    // not by fists or ordinary tools. Fail-closed against hacked clients.
    void attacker; void targetId;
    return [];
  }

  /** Gun/projectile PvP: the client raycasts the hit and reports it; the server
   *  sanity-checks range + rough facing (like melee) and applies clamped,
   *  armor-mitigated damage. It can't verify line-of-sight, matching the
   *  authoritative-lite trust model (mobs are client-side). */
  private handleRanged(attacker: ServerPlayer, targetId: number, amount: number): Outbound[] {
    const target = this.players.get(targetId);
    if (!target || target.dead || attacker.dead || target.id === attacker.id) return [];
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
    // Rally/faction-buff (Phase 6): a member fighting in their rally region (or
    // under a bought war buff) hits harder. The multiplier is server-decided
    // (politics state), so it may exceed the anti-cheat base cap.
    const mult = this.politics.combatMultiplier(attacker.faction, regionOf(attacker.x, attacker.z), this.worldTime);
    const dmg = Math.round(Math.max(0, Math.min(RANGED_MAX_DAMAGE, amount)) * mult);
    const knock = horiz > 1e-3
      ? { x: dx / horiz, y: 0.3, z: dz / horiz }
      : { x: 0, y: 0.4, z: 0 };
    return this.applyDamage(target, dmg, attacker.id, knock);
  }

  private applyDamage(
    p: ServerPlayer, amount: number, by: number,
    knock?: { x: number; y: number; z: number }
  ): Outbound[] {
    if (p.dead || amount <= 0) return [];
    if (p.mode !== 'survival') return []; // creative/spectator are invulnerable
    amount = mitigate(amount, p.armorPoints); // server-authoritative armor reduction
    if (amount <= 0) return []; // fully absorbed
    p.health = Math.max(0, p.health - amount);
    p.regenCooldown = REGEN_DELAY;
    p.regenTimer = 0;
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
    }
    return out;
  }

  private handleRespawn(p: ServerPlayer): Outbound[] {
    if (!p.dead) return [];
    const s = this.spawn();
    p.x = s.x; p.y = s.y; p.z = s.z;
    p.health = MAX_HEALTH; p.dead = false;
    p.regenCooldown = 0; p.regenTimer = 0;
    return [{
      to: p.id, msg: { t: 'respawned', x: s.x, y: s.y, z: s.z, health: MAX_HEALTH },
    }];
  }

  /** Advance regen; call ~ once per second worth of accumulated dt. */
  tickRegen(dt: number): void {
    for (const p of this.players.values()) {
      if (p.dead) continue;
      p.regenCooldown = Math.max(0, p.regenCooldown - dt);
      if (p.regenCooldown <= 0 && p.health < MAX_HEALTH) {
        p.regenTimer += dt;
        if (p.regenTimer >= REGEN_INTERVAL) {
          p.regenTimer = 0;
          p.health = Math.min(MAX_HEALTH, p.health + 1);
        }
      }
    }
  }

  // --- Ships -----------------------------------------------------------------

  private playerByName(name: string): ServerPlayer | undefined {
    if (!name) return undefined;
    for (const p of this.players.values()) if (p.username === name) return p;
    return undefined;
  }

  /** Alive + within boarding range of a ship's origin (steer/dock/upgrade gate). */
  private nearShip(p: ServerPlayer, ship: ShipState): boolean {
    if (p.dead || !fin(p.x, p.z, ship.x, ship.z)) return false;
    const dx = ship.x - p.x, dz = ship.z - p.z;
    return dx * dx + dz * dz <= BOARD_RANGE * BOARD_RANGE;
  }

  /** Flood-fill the hull from a helm, lift it out of the world, and create the
   *  ship. Rejected (no-op) if the helm isn't placed/near, or the hull is too
   *  small/large (floodFillHull is size-capped, so this can't be abused). */
  private handleShipLaunch(p: ServerPlayer, x: number, y: number, z: number): Outbound[] {
    if (!this.nearMachine(p, x, y, z)) return []; // alive + in range (reuses the gate)
    x = Math.floor(x); y = Math.floor(y); z = Math.floor(z);
    const capturableAt = (cx: number, cy: number, cz: number) =>
      this.edits.get(`${cx},${cy},${cz}`) ?? 0; // only player-placed cells; 0 = natural/air
    const blocks = floodFillHull(x, y, z, capturableAt);
    if (!blocks) return [];
    const ship = newShip(this.nextShipId++, p.username,
      { x: x + 0.5, y: y + 0.5, z: z + 0.5 }, 0, blocks, p.faction);
    this.ships.set(ship.id, ship);
    const out: Outbound[] = [];
    // Remove the captured blocks from the world (everyone sees them lift off).
    for (const b of blocks) {
      const cx = x + b.dx, cy = y + b.dy, cz = z + b.dz;
      this.edits.set(`${cx},${cy},${cz}`, Block.Air);
      out.push({ to: 'all', msg: { t: 'edit', x: cx, y: cy, z: cz, block: Block.Air } });
    }
    out.push({ to: 'all', msg: { t: 'shipState', ship } });
    return out;
  }

  /** Ship HP hit 0: explode (damage nearby players), spill the hull + cargo as
   *  loot entities, and remove the ship for everyone. */
  private destroyShip(ship: ShipState): Outbound[] {
    this.ships.delete(ship.id);
    this.shipInput.delete(ship.id);
    const out: Outbound[] = [];
    // Server-authoritative blast damage to nearby players (linear falloff).
    // Friendly fire is off: the ship's own faction is unharmed by its wreck.
    for (const target of this.players.values()) {
      if (target.dead || sameFaction(target.faction, ship.faction)) continue;
      const d = Math.hypot(target.x - ship.x, target.y - ship.y, target.z - ship.z);
      const f = 1 - d / SHIP_BLAST_RADIUS;
      if (f <= 0) continue;
      const horiz = Math.hypot(target.x - ship.x, target.z - ship.z) || 1;
      out.push(...this.applyDamage(target, Math.round(28 * f), -1, {
        x: (target.x - ship.x) / horiz, y: 0.6, z: (target.z - ship.z) / horiz,
      }));
    }
    // Spill the hull blocks as loot (capped), at the ship's position.
    let entities = 0;
    for (const b of ship.blocks) {
      if (entities >= 80) break;
      if (!ITEMS[b.id]) continue;
      entities++;
      out.push(this.spawnItem(b.id, 1,
        ship.x + (this.rng() - 0.5) * 2, ship.y + 0.5, ship.z + (this.rng() - 0.5) * 2));
    }
    out.push({ to: 'all', msg: { t: 'shipRemove', id: ship.id } });
    return out;
  }

  /** Re-place the captured hull into the world at the ship's current transform
   *  and delete the ship (dock / break down). */
  private dockShip(ship: ShipState): Outbound[] {
    const out: Outbound[] = [];
    for (const b of ship.blocks) {
      const w = blockWorldPos(ship, b);
      const cx = Math.round(w.x - 0.5), cy = Math.round(w.y - 0.5), cz = Math.round(w.z - 0.5);
      if (cy < 0 || cy >= 256) continue;
      this.edits.set(`${cx},${cy},${cz}`, b.id);
      out.push({ to: 'all', msg: { t: 'edit', x: cx, y: cy, z: cz, block: b.id } });
    }
    this.ships.delete(ship.id);
    this.shipInput.delete(ship.id);
    out.push({ to: 'all', msg: { t: 'shipRemove', id: ship.id } });
    return out;
  }

  /** Advance every ship; returns the transforms to broadcast (like tickItems). */
  tickShips(dt: number): ShipTransform[] {
    if (!fin(dt) || dt <= 0) return [];
    const out: ShipTransform[] = [];
    const height = (x: number, z: number) => this.terrain.height(x, z);
    for (const ship of this.ships.values()) {
      const inp = this.shipInput.get(ship.id);
      let steer = { thrust: 0, turn: 0 };
      if (inp) {
        inp.age += dt;
        if (inp.age <= 0.6) steer = inp; // input expires if the driver goes quiet
      }
      tickShip(ship, steer, dt, height);
      ship.fireCooldown = Math.max(0, ship.fireCooldown - dt);
      out.push(shipTransform(ship));
    }
    return out;
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

  // --- Region board + capture (Phase 1/2) ------------------------------------

  /** Live presence (faction + position) for region capture resolution. */
  private regionPresence(): { faction: number; x: number; z: number; dead: boolean }[] {
    return [...this.players.values()].map((p) => ({
      faction: p.faction, x: p.x, z: p.z, dead: p.dead,
    }));
  }

  /** Force a region's owner (admin / season setup / tests) and broadcast the
   *  updated board. World coords pick the region. */
  setRegionOwner(x: number, z: number, faction: number): Outbound[] {
    if (!this.regions.setOwner(regionOf(x, z), faction)) return [];
    return [{ to: 'all', msg: this.regionsSnapshot() }];
  }

  /** Full region board + capture meters (the war map). */
  regionsSnapshot(): ServerMsg {
    const m = this.regions.meters();
    return { t: 'regions', owners: this.regions.ownerList(), capFaction: m.faction, capProgress: m.progress };
  }

  /** Advance capture meters from live player presence, emit capture/win banners,
   *  and periodically re-broadcast the board so clients stay in sync. */
  tickRegions(dt: number): Outbound[] {
    if (!fin(dt) || dt <= 0) return [];
    const out: Outbound[] = [];
    const res = this.regions.tick(this.regionPresence(), dt);
    for (const ev of res.captured) {
      out.push({ to: 'all', msg: { t: 'regionCapture', region: ev.region, faction: ev.faction, from: ev.from } });
    }
    if (res.winner !== NO_FACTION) {
      out.push({ to: 'all', msg: { t: 'regionWin', faction: res.winner } });
      // Capturing the enemy capital wins the SEASON instantly (Phase 5).
      out.push(...this.endSeason(res.winner));
    }
    // Any capture/neutralize changed ownership -> push an immediate refresh so
    // the HUD/banner and board never disagree; otherwise refresh on the timer.
    this.regionAccum += dt;
    if (res.captured.length || res.neutralized.length || res.winner !== NO_FACTION ||
        this.regionAccum >= REGION_BROADCAST) {
      this.regionAccum = 0;
      out.push({ to: 'all', msg: this.regionsSnapshot() });
    }
    return out;
  }

  // --- Seasons (Phase 5) -----------------------------------------------------

  /** Live season state for the HUD (number + seconds left). */
  seasonSnapshot(): ServerMsg {
    return { t: 'season', number: this.season.number, timeLeft: seasonTimeLeft(this.season) };
  }

  /** Advance the season clock; at the deadline the faction holding the most
   *  regions wins (a tie is a stalemate — no winner, fresh season either way).
   *  Periodically broadcasts the clock for the HUD. */
  tickSeason(dt: number): Outbound[] {
    if (!fin(dt) || dt <= 0) return [];
    tickSeasonClock(this.season, dt);
    const out: Outbound[] = [];
    if (seasonExpired(this.season)) {
      out.push(...this.endSeason(deadlineWinner(this.regions.counts())));
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
   * stalemate), award the "Seasons Won" badge via the shell callback, then RESET
   * the war — the board back to 50/50 and every base (claim) cleared. Player
   * inventories/accounts are untouched (kept across seasons).
   */
  endSeason(winner: number): Outbound[] {
    const out: Outbound[] = [];
    const ended = this.season.number;
    this.onSeasonEnd?.(winner, ended); // shell persists badges to winning accounts
    // Clear every base; tell clients to drop each claim (domes + indexes).
    for (const c of this.claims.list()) out.push({ to: 'all', msg: { t: 'claimRemove', id: c.id } });
    this.claims.clear();
    // Reset the board + start the next season.
    this.regions.reset();
    advanceSeason(this.season);
    this.seasonAccum = 0;
    this.regionAccum = 0;
    // A new season also dissolves every faction government (Phase 6).
    this.politics.reset(this.worldTime);
    out.push({ to: 'all', msg: { t: 'seasonEnd', winner, number: ended } });
    out.push({ to: 'all', msg: this.regionsSnapshot() });
    out.push({ to: 'all', msg: this.seasonSnapshot() });
    out.push({ to: 'all', msg: this.politicsSnapshot() });
    return out;
  }

  // --- Politics (Phase 6) ----------------------------------------------------

  politicsSnapshot(): ServerMsg {
    return { t: 'politics', factions: this.politics.serialize() };
  }

  /** Count online members of a faction (drives the recall supermajority). */
  private onlineFactionCount(faction: number): number {
    let n = 0;
    for (const pl of this.players.values()) if (pl.faction === faction) n++;
    return n;
  }

  /** All faction-government actions. Validates real faction membership; the
   *  Politics module enforces leadership/affordability. Most actions just
   *  re-broadcast the government; spends also apply a world effect. */
  private handlePolitics(p: ServerPlayer, msg: ClientMsg): Outbound[] {
    if (!isFaction(p.faction)) return [];
    const f = p.faction, now = this.worldTime;
    const broadcast = (): Outbound[] => [{ to: 'all', msg: this.politicsSnapshot() }];
    switch (msg.t) {
      case 'nominate':
        return this.politics.nominate(f, p.username, msg.party) ? broadcast() : [];
      case 'vote':
        return this.politics.vote(f, p.username, msg.candidate) ? broadcast() : [];
      case 'setRally':
        return this.politics.setRally(f, p.username, msg.region, now) ? broadcast() : [];
      case 'appointOfficer': {
        // Only a real, online same-faction member can be made an officer.
        const target = [...this.players.values()].find((q) => q.username === msg.user && q.faction === f);
        if (!target) return [];
        return this.politics.appointOfficer(f, p.username, msg.user, now) ? broadcast() : [];
      }
      case 'dismissOfficer':
        return this.politics.dismissOfficer(f, p.username, msg.user, now) ? broadcast() : [];
      case 'setTax':
        return this.politics.setTax(f, p.username, msg.rate, now) ? broadcast() : [];
      case 'donate': {
        const amt = Math.max(0, Math.min(2000, Math.floor(msg.amount)));
        return this.politics.donate(f, amt, p.username, now) > 0 ? broadcast() : [];
      }
      case 'recall':
        this.politics.recall(f, p.username, this.onlineFactionCount(f), now);
        return broadcast();
      case 'commanderSpend':
        return this.handleCommanderSpend(p, msg);
      default:
        return [];
    }
  }

  /** A Commander/Officer treasury spend: refill a base shield, drop a supply
   *  crate, or buy a temporary faction-wide combat buff. */
  private handleCommanderSpend(p: ServerPlayer, msg: ClientMsg & { t: 'commanderSpend' }): Outbound[] {
    const f = p.faction, now = this.worldTime;
    const out: Outbound[] = [];
    if (msg.kind === 'shield') {
      // Refill the targeted base's oil — must be your faction's claim.
      const claim = fin(msg.x, msg.y, msg.z) ? this.claims.at(msg.x, msg.z) : undefined;
      if (!claim || !sameFaction(claim.faction, f)) return [];
      if (!this.politics.spendShieldRefill(f, p.username, now)) return [];
      claim.oil = Math.min(OIL_CAP, claim.oil + SHIELD_REFILL_OIL);
      out.push({ to: 'all', msg: { t: 'claim', claim } });
    } else if (msg.kind === 'crate') {
      if (!this.politics.spendSupplyCrate(f, p.username, now)) return [];
      // Drop a front-line resupply at the spender's feet.
      const x = p.x, y = p.y + 0.5, z = p.z;
      out.push(this.spawnItem(Item.Cannonball, 24, x, y, z));
      out.push(this.spawnItem(Item.OilBarrel, 10, x + 0.3, y, z));
    } else if (msg.kind === 'buff') {
      if (!this.politics.spendFactionBuff(f, p.username, now)) return [];
    } else {
      return [];
    }
    out.push({ to: 'all', msg: this.politicsSnapshot() });
    return out;
  }

  /** Advance election clocks; announce any auto-elected Commanders + periodic
   *  government broadcast (treasury/clock/buff changes). */
  tickPolitics(dt: number): Outbound[] {
    if (!fin(dt) || dt <= 0) return [];
    const out: Outbound[] = [];
    for (const e of this.politics.tick(this.worldTime)) {
      if (e.commander) out.push({ to: 'all', msg: { t: 'commanderElected', faction: e.faction, commander: e.commander } });
    }
    this.politicsAccum += dt;
    if (this.politicsAccum >= POLITICS_BROADCAST) {
      this.politicsAccum = 0;
      out.push({ to: 'all', msg: this.politicsSnapshot() });
    }
    return out;
  }

  // --- Land claims (M18 / M19) -----------------------------------------------

  /** True if an enemy of the claim covering (x,z) is currently blocked by its
   *  shield/grace (used to gate machine/turret/chest ops + edits). Own-faction
   *  members are never blocked; a breached (down + ungraced) claim is open. */
  private enemyShielded(p: ServerPlayer, x: number, z: number): boolean {
    const c = this.claims.at(x, z);
    // Owning the region the base sits in opens it (Phase 3), so a region-holder
    // is never "shielded out" of an enemy base there.
    return c !== undefined && !sameFaction(p.faction, c.faction) &&
      claimProtected(c, this.worldTime) && !sameFaction(this.regions.ownerOf(x, z), p.faction);
  }

  /** A weapon hit drains an enemy claim's shield (M19 breaching). The client
   *  reports the hit (like shipHit); the server caps it, requires the attacker
   *  be near + enemy, and emits a breach event when the shield first drops. */
  private handleClaimHit(p: ServerPlayer, x: number, y: number, z: number, amount: number): Outbound[] {
    const c = this.claims.coreAt(x, y, z);
    if (!c || p.dead || !fin(p.x, p.y, p.z, amount)) return [];
    if (sameFaction(p.faction, c.faction)) return []; // can't shell your own shield
    const dx = c.coreX + 0.5 - p.x, dy = c.coreY + 0.5 - p.y, dz = c.coreZ + 0.5 - p.z;
    if (!(dx * dx + dy * dy + dz * dz <= RANGED_MAX_RANGE * RANGED_MAX_RANGE)) return [];
    const wasUp = shieldUp(c);
    const dmg = Math.max(0, Math.min(CLAIM_HIT_MAX, amount));
    if (dmg <= 0) return [];
    const downed = damageShield(c, dmg);
    const out: Outbound[] = [{ to: 'all', msg: { t: 'claim', claim: c } }];
    if (downed && wasUp) {
      // The shield just cracked: announce the breach to everyone.
      out.push({ to: 'all', msg: { t: 'breach', attacker: p.username, faction: p.faction, victim: c.faction } });
      out.push({ to: 'all', msg: {
        t: 'killfeed', killer: factionName(p.faction), victim: `${factionName(c.faction)}'s claim` } });
    }
    return out;
  }

  /** Advance every claim (regen vs oil drain + bleed) and broadcast a periodic
   *  bulk refresh. The worldTime clock here also drives the grace period. */
  tickClaims(dt: number): Outbound[] {
    if (!fin(dt) || dt <= 0) return [];
    this.worldTime += dt;
    this.claims.tick(dt);
    this.claimAccum += dt;
    if (this.claimAccum < CLAIM_BROADCAST) return [];
    this.claimAccum = 0;
    const claims = this.claims.list();
    if (!claims.length) return [];
    return [{ to: 'all', msg: { t: 'claims', claims } }];
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
    if (mode !== 'survival') { p.health = MAX_HEALTH; p.dead = false; }
    return [
      { to: 'all', msg: { t: 'gamemode', id, mode } },
      { to: id, msg: { t: 'notice', text: `Gamemode set to ${mode}` } },
    ];
  }

  /** Teleport a player to an absolute position (console `tp`). */
  adminTeleport(id: number, x: number, y: number, z: number): Outbound[] {
    const p = this.players.get(id);
    if (!p || !fin(x, y, z)) return [];
    p.x = x; p.y = y; p.z = z;
    return [{ to: id, msg: { t: 'teleport', x, y, z } }];
  }

  /** Build the persistable per-account blob for a player: their last client-
   *  pushed inventory/hotbar plus the server-authoritative position. Returns
   *  null if the player isn't online. */
  capturePlayerState(id: number): { username: string; data: Record<string, unknown> } | null {
    const p = this.players.get(id);
    if (!p) return null;
    const data: Record<string, unknown> = { ...(p.savedClientData ?? {}) };
    data.x = p.x; data.y = p.y; data.z = p.z; data.yaw = p.yaw; data.mode = p.mode;
    return { username: p.username, data };
  }

  // --- Persistence ----------------------------------------------------------
  // The whole authoritative world (player-made changes) serialized to a plain
  // JSON-able object the shell writes to disk and reloads on boot. Territory
  // node control is intentionally NOT saved — it re-resolves from live player
  // presence each tick — and dropped item entities are ephemeral.

  serialize(): WorldSave {
    return {
      v: 1,
      seed: this.seed,
      worldTime: this.worldTime,
      nextShipId: this.nextShipId,
      edits: [...this.edits.entries()],
      chests: [...this.chests.entries()],
      machines: [...this.machines.entries()],
      ships: [...this.ships.values()],
      turrets: [...this.turrets.entries()],
      claims: this.claims.list(),
      regions: this.regions.serialize(),
      season: this.season,
      politics: this.politics.serialize(),
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
    if (Array.isArray(s.ships)) {
      let maxId = this.nextShipId - 1;
      for (const raw of s.ships) {
        const st = sanitizeShipState(raw);
        if (st) { this.ships.set(st.id, st); if (st.id > maxId) maxId = st.id; }
      }
      this.nextShipId = Math.max(this.nextShipId,
        Number.isInteger(s.nextShipId) ? (s.nextShipId as number) : 0, maxId + 1);
    }
    if (Array.isArray(s.turrets)) {
      for (const e of s.turrets) {
        if (!Array.isArray(e) || e.length !== 2) continue;
        const [k, raw] = e as [unknown, unknown];
        const st = sanitizeTurretState(raw);
        if (validBlockKey(k) && st) this.turrets.set(k as string, st);
      }
    }
    if (Array.isArray(s.claims)) this.claims.load(s.claims as ClaimState[]);
    this.regions.restore(s.regions);
    this.season = sanitizeSeason(s.season);
    this.politics.restore(s.politics, this.worldTime);
    return true;
  }

  /** Transform+health for every player (the periodic broadcast). */
  snapshot(): PlayerSnapshot[] {
    return [...this.players.values()].map((p) => ({
      id: p.id, x: p.x, y: p.y, z: p.z, yaw: p.yaw, pitch: p.pitch,
      health: p.health, dead: p.dead,
    }));
  }
}

function shipTransform(ship: ShipState): ShipTransform {
  return { id: ship.id, x: ship.x, y: ship.y, z: ship.z, yaw: ship.yaw, hp: ship.hp };
}

function toInfo(p: ServerPlayer): PlayerInfo {
  return {
    id: p.id, username: p.username, skin: p.skin, faction: p.faction, mode: p.mode,
    seasonsWon: p.seasonsWon,
    x: p.x, y: p.y, z: p.z, yaw: p.yaw, pitch: p.pitch,
    health: p.health, dead: p.dead,
  };
}

/** On-disk world snapshot (see GameServer.serialize/restore). */
export interface WorldSave {
  v: number;
  seed: number;
  worldTime: number;
  nextShipId: number;
  edits: [string, number][];
  chests: [string, (ItemStack | null)[]][];
  machines: [string, MachineState][];
  ships: ShipState[];
  turrets: [string, TurretState][];
  claims: ClaimState[];
  regions?: RegionsSave;
  season?: SeasonState;
  politics?: FactionPolitics[];
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
      out.push(stack);
    } else {
      out.push(null);
    }
  }
  while (out.length < CHEST_SLOTS) out.push(null);
  return out;
}
