// VOXELON multiplayer wire protocol: message shapes + shared constants,
// plus username and skin helpers. Imported by BOTH the browser client and
// the Node server, so it must stay free of DOM and Node APIs.

import type { ItemStack } from '../items';
import type { MachineState, UpgradeAxis } from '../machines';
import type { ShipState, ShipAxis } from '../ships';
import type { TurretState, TurretAxis } from '../turrets';
import type { NodeStatus, ScoreEntry } from '../territory';
import type { ClaimState } from '../claims';

export const SERVER_PORT = 8080;
export const SNAPSHOT_HZ = 15;     // server -> clients transform broadcasts
export const TRANSFORM_HZ = 20;    // client -> server transform sends
export const WORLD_SEED = 1337;    // fixed shared seed (clients + server)
export const MELEE_DAMAGE = 4;     // server-applied fist damage
export const MELEE_RANGE = 4.5;
export const EDIT_RANGE = 7;       // max distance a player may edit a block

/** Public, render-relevant state of one player. */
export interface PlayerSnapshot {
  id: number;
  x: number; y: number; z: number;
  yaw: number; pitch: number;
  health: number;
  dead: boolean;
}

/** Full info about a player (sent on join / welcome). */
export interface PlayerInfo extends PlayerSnapshot {
  username: string;
  skin: number; // seed for deterministic avatar colors
  faction: number; // preset team id (teams.ts); NO_FACTION when neutral/offline
}

/** A dropped item entity owned by the server. */
export interface ItemEntityInfo {
  eid: number; item: number; count: number;
  x: number; y: number; z: number;
}

export const PICKUP_RANGE = 2.0; // server-validated pickup distance
export const CHEST_SLOTS = 27;
export const ARMOR_POINT_CAP = 20;  // 20 points = the max 80% reduction
export const RANGED_MAX_RANGE = 80; // server cap on a validated gun hit distance
export const RANGED_MAX_DAMAGE = 30;
export const SHIP_HIT_MAX_DAMAGE = 60;  // server cap on a reported ship-cannon/gun hit

/** Periodic compact ship transform (folded into a broadcast, like itemsmove). */
export interface ShipTransform {
  id: number; x: number; y: number; z: number; yaw: number; hp: number;
}

/** Vanilla-ish armor: each point blocks 4% of incoming damage, capped at 80%.
 *  Used by BOTH the offline client and the authoritative server so mitigation
 *  is identical. Returns the (rounded) damage that gets through. */
export function mitigate(amount: number, armorPoints: number): number {
  const eff = Math.max(0, Math.min(ARMOR_POINT_CAP, armorPoints));
  return Math.max(0, Math.round(amount * (1 - eff * 0.04)));
}

// --- client -> server -------------------------------------------------------
export type ClientMsg =
  | { t: 'hello' }
  // Mandatory accounts: a socket must authenticate before it spawns a player.
  | { t: 'register'; username: string; password: string }
  | { t: 'login'; username: string; password: string }
  | { t: 'xform'; x: number; y: number; z: number; yaw: number; pitch: number }
  | { t: 'edit'; x: number; y: number; z: number; block: number }
  | { t: 'attack'; target: number }
  | { t: 'selfhurt'; amount: number }   // fall/drown damage, applied by server
  | { t: 'respawn' }
  | { t: 'drop'; items: { id: number; count: number }[]; x: number; y: number; z: number }
  | { t: 'pickup'; eid: number }
  | { t: 'chestOpen'; x: number; y: number; z: number }
  | { t: 'chestSet'; x: number; y: number; z: number; slots: (ItemStack | null)[] }
  | { t: 'armor'; points: number }            // worn-armor defense, server mitigates
  | { t: 'rangedAttack'; target: number; amount: number } // gun/projectile PvP hit
  // Automation machines (block-entities; placement is a normal edit).
  | { t: 'machineOpen'; x: number; y: number; z: number }
  | { t: 'machineConfig'; x: number; y: number; z: number; filter: number }
  | { t: 'machineUpgrade'; x: number; y: number; z: number; axis: UpgradeAxis }
  | { t: 'machineCollect'; x: number; y: number; z: number }
  | { t: 'machineHit'; x: number; y: number; z: number; amount: number } // sabotage/raid
  | { t: 'machineClaim'; x: number; y: number; z: number }
  // Ships (warfare M14): captured-block vehicles.
  | { t: 'shipLaunch'; x: number; y: number; z: number }  // helm world pos
  | { t: 'shipSteer'; id: number; thrust: number; turn: number }
  | { t: 'shipFire'; id: number; dx: number; dy: number; dz: number } // aim dir
  | { t: 'shipDock'; id: number }
  | { t: 'shipUpgrade'; id: number; axis: ShipAxis }
  | { t: 'shipHit'; id: number; amount: number }          // gun/other chips a ship
  // Turrets (warfare M14): block-entities (placement is a normal edit).
  | { t: 'turretOpen'; x: number; y: number; z: number }
  | { t: 'turretUpgrade'; x: number; y: number; z: number; axis: TurretAxis }
  | { t: 'turretClaim'; x: number; y: number; z: number }
  | { t: 'turretHit'; x: number; y: number; z: number; amount: number } // sabotage
  | { t: 'turretLoad'; x: number; y: number; z: number; item: number; count: number }
  // Land claims (M18): Core placement is a normal edit; these manage the claim.
  | { t: 'claimOpen'; x: number; y: number; z: number }
  | { t: 'claimFeed'; x: number; y: number; z: number; count: number } // feed oil barrels
  // Raiding (M19): a weapon hit drains an enemy claim's shield. Once the shield
  // is down, breaking a stored container inside the claim raids it (handled on
  // the normal `edit` path, server-side).
  | { t: 'claimHit'; x: number; y: number; z: number; amount: number }
  // Persistence: the client periodically pushes its owned state (inventory +
  // hotbar + position) for the server to store against the account and restore
  // on next login. Opaque blob — the server treats it as data, not authority.
  | { t: 'saveState'; data: Record<string, unknown> };

// --- server -> client -------------------------------------------------------
export type ServerMsg =
  // Auth: a rejected login/register (success is signalled by the `welcome`).
  | { t: 'authErr'; error: string }
  | {
      t: 'welcome'; id: number; seed: number; username: string;
      players: PlayerInfo[]; edits: [string, number][]; items: ItemEntityInfo[];
      ships: ShipState[]; turrets: { x: number; y: number; z: number; state: TurretState }[];
      claims: ClaimState[];
      /** Saved per-account state to restore (inventory/hotbar); undefined for new accounts. */
      state?: Record<string, unknown>;
    }
  | { t: 'join'; player: PlayerInfo }
  | { t: 'leave'; id: number }
  | { t: 'snapshot'; players: PlayerSnapshot[] }
  | { t: 'edit'; x: number; y: number; z: number; block: number }
  | { t: 'hurt'; health: number; dead: boolean; by: number;
      kx: number; ky: number; kz: number }
  | { t: 'respawned'; x: number; y: number; z: number; health: number }
  | { t: 'killfeed'; killer: string; victim: string }
  | { t: 'itemspawn'; item: ItemEntityInfo }
  | { t: 'itemsmove'; items: { eid: number; x: number; y: number; z: number }[] }
  | { t: 'itemremove'; eid: number }
  | { t: 'gotitem'; item: number; count: number }
  | { t: 'chest'; x: number; y: number; z: number; slots: (ItemStack | null)[] }
  | { t: 'machine'; x: number; y: number; z: number; state: MachineState }
  // Ships.
  | { t: 'shipState'; ship: ShipState }                 // full (launch/upgrade/board)
  | { t: 'shipTransforms'; ships: ShipTransform[] }      // periodic broadcast
  | { t: 'shipRemove'; id: number }
  // Turrets.
  | { t: 'turret'; x: number; y: number; z: number; state: TurretState }
  | { t: 'turretFire'; x: number; y: number; z: number; tx: number; ty: number; tz: number }
  // Territory objective: live scoreboard + node ownership + round state.
  | {
      t: 'territory'; nodes: NodeStatus[]; scores: ScoreEntry[];
      roundTime: number; winner: string;
    }
  // Land claims (M18): one claim's authoritative state, a periodic bulk refresh,
  // and removals (Core broken / overlap).
  | { t: 'claim'; claim: ClaimState }
  | { t: 'claims'; claims: ClaimState[] }
  | { t: 'claimRemove'; id: number }
  // Raid feed (M19): "RED breached BLUE's claim".
  | { t: 'breach'; attacker: string; faction: number; victim: number };

const ADJECTIVES = [
  'Brave', 'Swift', 'Iron', 'Shadow', 'Crimson', 'Frost', 'Rapid', 'Silent',
  'Savage', 'Lucky', 'Grim', 'Toxic', 'Solar', 'Rogue', 'Vivid', 'Steel',
  'Wild', 'Atomic', 'Phantom', 'Turbo',
];
const NOUNS = [
  'Yak', 'Falcon', 'Viper', 'Wolf', 'Comet', 'Raptor', 'Goblin', 'Titan',
  'Badger', 'Hornet', 'Specter', 'Mantis', 'Cobra', 'Bison', 'Drake', 'Ferret',
  'Jackal', 'Otter', 'Lynx', 'Crow',
];

/** Generate a candidate "AdjNounNN" username from a 0..1 rng. */
export function makeUsername(rng: () => number): string {
  const a = ADJECTIVES[Math.floor(rng() * ADJECTIVES.length)];
  const n = NOUNS[Math.floor(rng() * NOUNS.length)];
  const num = 10 + Math.floor(rng() * 90); // 2 digits
  return `${a}${n}${num}`;
}

/** Stable per-username skin seed (so every client renders the same avatar). */
export function skinSeed(username: string): number {
  let h = 2166136261;
  for (let i = 0; i < username.length; i++) {
    h ^= username.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
