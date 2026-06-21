// Authoritative-lite game server logic, transport-agnostic and pure (no ws,
// no Node APIs) so it can be unit-tested headlessly and reused by the WS
// shell. Owns: the shared edit log, every player's health, username
// assignment, spawns (via the shared deterministic Terrain), PvP hit
// validation, regen, and snapshots.

import { BLOCKS, Block } from '../blocks';
import { ITEMS, ItemStack } from '../items';
import { Terrain } from '../terrain';
import {
  ClientMsg, MELEE_DAMAGE, MELEE_RANGE, EDIT_RANGE, CHEST_SLOTS, PICKUP_RANGE,
  ARMOR_POINT_CAP, RANGED_MAX_RANGE, RANGED_MAX_DAMAGE, mitigate,
  ItemEntityInfo, PlayerInfo, PlayerSnapshot, ServerMsg, WORLD_SEED,
  makeUsername, skinSeed,
} from './protocol';

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
}

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
  private readonly items = new Map<number, ItemEntityInfo>();
  private nextEid = 1;

  constructor(seed = WORLD_SEED, rng: () => number = Math.random) {
    this.seed = seed;
    this.rng = rng;
    this.terrain = new Terrain(seed);
  }

  get playerCount(): number {
    return this.players.size;
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
    const base = this.terrain.findSpawn();
    // Scatter players a little so they don't stack on the exact spawn column.
    const x = Math.round(base.x + (this.rng() - 0.5) * 16);
    const z = Math.round(base.z + (this.rng() - 0.5) * 16);
    return { x: x + 0.5, y: this.terrain.height(x, z) + 1, z: z + 0.5 };
  }

  /** Register a player; returns the welcome (to them) + join (to others). */
  addPlayer(id: number): Outbound[] {
    const username = this.uniqueUsername();
    const s = this.spawn();
    const player: ServerPlayer = {
      id, username, skin: skinSeed(username),
      x: s.x, y: s.y, z: s.z, yaw: 0, pitch: 0,
      health: MAX_HEALTH, dead: false, regenCooldown: 0, regenTimer: 0,
      armorPoints: 0,
    };
    this.players.set(id, player);
    const welcome: ServerMsg = {
      t: 'welcome', id, seed: this.seed, username,
      players: [...this.players.values()].map(toInfo),
      edits: [...this.edits.entries()],
      items: [...this.items.values()],
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
    switch (msg.t) {
      case 'xform': {
        // Reject non-finite transforms so they can't poison distance/facing
        // math elsewhere (range/hit checks must never fail open).
        if (!p.dead && fin(msg.x, msg.y, msg.z, msg.yaw, msg.pitch)) {
          p.x = msg.x; p.y = msg.y; p.z = msg.z;
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
        const slots = this.chests.get(`${msg.x},${msg.y},${msg.z}`)
          ?? new Array(CHEST_SLOTS).fill(null);
        return [{ to: id, msg: { t: 'chest', x: msg.x, y: msg.y, z: msg.z, slots } }];
      }
      case 'chestSet': {
        if (!Array.isArray(msg.slots)) return [];
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
      default:
        return [];
    }
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
      const eid = this.nextEid++;
      const info: ItemEntityInfo = {
        eid, item: it.id, count: Math.min(64, Math.floor(it.count)),
        x: x + (this.rng() - 0.5), y, z: z + (this.rng() - 0.5),
      };
      this.items.set(eid, info);
      out.push({ to: 'all', msg: { t: 'itemspawn', item: info } });
    }
    return out;
  }

  private handlePickup(p: ServerPlayer, eid: number): Outbound[] {
    const item = this.items.get(eid);
    if (!item || p.dead) return []; // dead players can't pick up
    const dx = item.x - p.x, dy = item.y - p.y, dz = item.z - p.z;
    if (!(dx * dx + dy * dy + dz * dz <= PICKUP_RANGE * PICKUP_RANGE)) return [];
    this.items.delete(eid);
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
    const out: Outbound[] = [];
    // Server-authoritative chest break: if this edit removes a chest, spill its
    // stored contents as item entities everyone sees and clear the storage —
    // independent of whether the breaking client ever opened (cached) it.
    if (this.edits.get(key) === Block.Chest && block !== Block.Chest) {
      out.push(...this.spillChest(key, x, y, z));
    }
    this.edits.set(key, block);
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
      const eid = this.nextEid++;
      const info: ItemEntityInfo = {
        eid, item: s.id, count: Math.min(64, Math.floor(s.count)),
        x: x + 0.5 + (this.rng() - 0.5), y: y + 0.3, z: z + 0.5 + (this.rng() - 0.5),
      };
      this.items.set(eid, info);
      out.push({ to: 'all', msg: { t: 'itemspawn', item: info } });
    }
    return out;
  }

  private handleAttack(attacker: ServerPlayer, targetId: number): Outbound[] {
    const target = this.players.get(targetId);
    if (!target || target.dead || attacker.dead || target.id === attacker.id) {
      return [];
    }
    if (!fin(attacker.x, attacker.y, attacker.z, attacker.yaw,
      target.x, target.y, target.z)) return [];
    const dx = target.x - attacker.x, dy = target.y - attacker.y,
      dz = target.z - attacker.z;
    const dist = Math.hypot(dx, dy, dz);
    if (!(dist <= MELEE_RANGE) || dist < 1e-3) return []; // fail-closed
    // Attacker must roughly face the target — except a directly-stacked
    // target (no horizontal separation) is always considered in front.
    const horiz = Math.hypot(dx, dz);
    if (horiz > 0.2) {
      const fwd = { x: -Math.sin(attacker.yaw), z: -Math.cos(attacker.yaw) };
      if ((fwd.x * dx + fwd.z * dz) / horiz < 0.35) return [];
    }
    const knock = horiz > 1e-3
      ? { x: dx / horiz, y: 0.45, z: dz / horiz }
      : { x: 0, y: 0.6, z: 0 };
    return this.applyDamage(target, MELEE_DAMAGE, attacker.id, knock);
  }

  /** Gun/projectile PvP: the client raycasts the hit and reports it; the server
   *  sanity-checks range + rough facing (like melee) and applies clamped,
   *  armor-mitigated damage. It can't verify line-of-sight, matching the
   *  authoritative-lite trust model (mobs are client-side). */
  private handleRanged(attacker: ServerPlayer, targetId: number, amount: number): Outbound[] {
    const target = this.players.get(targetId);
    if (!target || target.dead || attacker.dead || target.id === attacker.id) return [];
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
    const dmg = Math.max(0, Math.min(RANGED_MAX_DAMAGE, amount));
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

  /** Transform+health for every player (the periodic broadcast). */
  snapshot(): PlayerSnapshot[] {
    return [...this.players.values()].map((p) => ({
      id: p.id, x: p.x, y: p.y, z: p.z, yaw: p.yaw, pitch: p.pitch,
      health: p.health, dead: p.dead,
    }));
  }
}

function toInfo(p: ServerPlayer): PlayerInfo {
  return {
    id: p.id, username: p.username, skin: p.skin,
    x: p.x, y: p.y, z: p.z, yaw: p.yaw, pitch: p.pitch,
    health: p.health, dead: p.dead,
  };
}
