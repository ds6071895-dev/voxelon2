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
  tickMachine,
} from '../machines';
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
  private readonly machines = new Map<string, MachineState>();
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
    // Server-authoritative chest break: if this edit removes a chest, spill its
    // stored contents as item entities everyone sees and clear the storage —
    // independent of whether the breaking client ever opened (cached) it.
    if (prev === Block.Chest && block !== Block.Chest) {
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
    this.edits.set(key, block);
    // Placing a machine block creates its server entity, which then ticks even
    // with no chunk loaded and no one viewing it.
    const placed = machineTypeForBlock(block);
    if (placed !== null && !this.machines.has(key)) {
      this.machines.set(key, newMachine(placed));
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
