// VOXELON multiplayer wire protocol: message shapes + shared constants,
// plus username and skin helpers. Imported by BOTH the browser client and
// the Node server, so it must stay free of DOM and Node APIs.

import type { ItemStack } from '../items';
import type { MachineState, UpgradeAxis } from '../machines';
import type { TurretState, TurretAxis } from '../turrets';
import type { ClaimState } from '../claims';
import type { GadgetKind } from '../gadgets';

export const SERVER_PORT = 8080;
export const SNAPSHOT_HZ = 15;     // server -> clients transform broadcasts
export const TRANSFORM_HZ = 20;    // client -> server transform sends
export const WORLD_SEED = 1337;    // fixed shared seed (clients + server)
export const WORLD_BORDER = 5000;  // square play area side length (centred on origin)
export const WORLD_HALF = WORLD_BORDER / 2; // movement clamps to [-HALF, +HALF]
// The HEARTLAND core: the inner square where society lives — claims, the war
// region board, oil scoring and spawns are all core-only. Outside it lie the
// WILDS: no claims, no shields, denser mobs — pure risk/reward frontier.
export const CORE_BORDER = 1000;
export const CORE_HALF = CORE_BORDER / 2;
/** Is a world position inside the Heartland core square? */
export function inCore(x: number, z: number): boolean {
  return Math.abs(x) <= CORE_HALF && Math.abs(z) <= CORE_HALF;
}
// Waypoint Totems (B4): fast travel across the 5000-block world.
export const MAX_ATTUNED = 4;        // attuned totems per player
export const TOTEM_COOLDOWN = 60;    // seconds between teleports (server clock)
export const TOTEM_WINDUP = 3;       // client-side cast time before the port
export const COMBAT_TAG = 10;        // seconds after ANY damage that block a port
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
  gliding?: boolean;
}

/** Gamemode, set by a server-console admin command. */
export type GameMode = 'survival' | 'creative' | 'spectator';

/** Full info about a player (sent on join / welcome). */
export interface PlayerInfo extends PlayerSnapshot {
  username: string;
  skin: number; // seed for deterministic avatar colors
  faction: number; // preset team id (teams.ts); NO_FACTION when neutral/offline
  mode: GameMode; // gamemode (survival default; admin-set creative/spectator)
  seasonsWon: number; // permanent "Seasons Won" badge rank (Phase 5)
  /** Lifesteal max-health currency (Milestone A): max HP = hearts * 2. */
  hearts: number;
}

/** A dropped item entity owned by the server. */
export interface ItemEntityInfo {
  eid: number; item: number; count: number;
  x: number; y: number; z: number;
}

/** A war flag on the wire: position, owning faction, the region it claims, and a
 *  live countdown (seconds left before it flips the region). */
export interface FlagInfo {
  faction: number;
  x: number; y: number; z: number;
  region: number;
  secondsLeft: number;
}

export const PICKUP_RANGE = 2.0; // server-validated pickup distance
export const CHEST_SLOTS = 27;
export const ARMOR_POINT_CAP = 20;  // 20 points = the max 80% reduction
export const RANGED_MAX_RANGE = 80; // server cap on a validated gun hit distance
export const RANGED_MAX_DAMAGE = 30;

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
  | { t: 'register'; username: string; password: string; faction?: number } // faction = picked side
  | { t: 'login'; username: string; password: string }
  | { t: 'xform'; x: number; y: number; z: number; yaw: number; pitch: number; gliding?: boolean }
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
  // Relocate a placed machine (you can't break it, only MOVE it): the server
  // clears the old footprint and rebuilds it at the target, preserving level/
  // storage/filter/stored/owner. Both ends must be within reach of the player.
  | { t: 'machineMove'; x: number; y: number; z: number; tx: number; ty: number; tz: number }
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
  // A rocket detonation point: the client fires + simulates the projectile and
  // reports where it burst. The server applies the (capped) splash damage to
  // enemies in range + broadcasts the crater, so rocket splash syncs to everyone
  // (the shooter already ran the blast locally; the server skips re-sending it).
  | { t: 'rocketBlast'; x: number; y: number; z: number }
  // Secret faction switch (Phase 7): defect to the other side. NO public
  // announcement — others keep seeing your old colors (a spy), but the server
  // treats you as your new faction. Max 2/season, locked in the final week.
  | { t: 'switchFaction'; faction: number }
  // Gadgets (Phase 8): server-authoritative gadget effects. `item` is the gadget
  // item id; the server derives the effect kind + params. (frag/oil/smoke use the
  // detonation point; horn/disguise ignore it; other kinds are client-handled.)
  | { t: 'gadgetUse'; item: number; x: number; y: number; z: number }
  // Personal respawn point: right-clicking a Respawn Beacon sets the player's
  // spawn to that block. The server validates the block + range and remembers it.
  | { t: 'setSpawn'; x: number; y: number; z: number }
  // Persistence: the client periodically pushes its owned state (inventory +
  // hotbar + position) for the server to store against the account and restore
  // on next login. Opaque blob — the server treats it as data, not authority.
  | { t: 'saveState'; data: Record<string, unknown> }
  // Lifesteal (Milestone A): consume a Heart item (+1 max heart, item cost is
  // paid client-side like other crafts) / bottle one of YOUR hearts into a
  // Heart item (the server enforces the withdrawal floor; the item itself is
  // minted by the crafting grid client-side).
  | { t: 'heartConsume' }
  | { t: 'heartWithdraw' }
  // Revival Beacon: ask for the eliminated faction-mates you could revive,
  // then revive one by username (beacon item is consumed client-side on the
  // server's `revived ok` confirmation).
  | { t: 'reviveList' }
  | { t: 'beaconRevive'; target: string }
  // Waypoint Totems (B4): attune to a placed totem block (toggle; max 4), and
  // teleport to an attuned one (the client runs the 3s wind-up; the server
  // enforces attunement + block-exists + 60s cooldown + the combat tag).
  | { t: 'attune'; x: number; y: number; z: number }
  | { t: 'totemTeleport'; x: number; y: number; z: number };

// --- server -> client -------------------------------------------------------
export type ServerMsg =
  // Auth: a rejected login/register (success is signalled by the `welcome`).
  | { t: 'authErr'; error: string }
  | {
      t: 'welcome'; id: number; seed: number; username: string;
      players: PlayerInfo[]; edits: [string, number][]; items: ItemEntityInfo[];
      turrets: { x: number; y: number; z: number; state: TurretState }[];
      claims: ClaimState[];
      /** Region board: owner faction id per region index (teams/regions modules). */
      regions: number[];
      /** Current season number + seconds left before the deadline (Phase 5). */
      season: { number: number; timeLeft: number };
      /** War window: capture is only open while `active`; else a countdown to the
       *  next scheduled war (`nextIn`), or all-zero for peacetime. */
      war: { active: boolean; timeLeft: number; nextIn: number };
      /** Active war flags (land-claim markers) with live countdowns. */
      flags: FlagInfo[];
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
  // Turrets.
  | { t: 'turret'; x: number; y: number; z: number; state: TurretState }
  | { t: 'turretFire'; x: number; y: number; z: number; tx: number; ty: number; tz: number }
  // Region board (Phase 1/2): owner faction id per region + capture meters
  // (which faction is filling each region's control point + fill fraction 0..1).
  | { t: 'regions'; owners: number[]; capFaction: number[]; capProgress: number[] }
  // A region flipped owners (Phase 2) — drives the "WE CAPTURED X!" banner.
  | { t: 'regionCapture'; region: number; faction: number; from: number }
  // A faction took an enemy CAPITAL = instant win (Phase 2; Phase 5 = full season).
  | { t: 'regionWin'; faction: number }
  // Season clock (Phase 5): number + seconds left (periodic HUD broadcast).
  | { t: 'season'; number: number; timeLeft: number }
  // War window: whether capture is open now + seconds left (active) / seconds
  // until the next scheduled war (pending). Admin-scheduled from the console.
  | { t: 'war'; active: boolean; timeLeft: number; nextIn: number }
  // War flags (the land-claim mechanic): every active flag with its live
  // countdown. Shown to EVERYONE as a waypoint; if it survives, its region flips.
  | { t: 'flags'; flags: FlagInfo[] }
  // Private confirmation of a secret faction switch (only to the defector).
  | { t: 'factionSwitched'; faction: number; remaining: number }
  // Gadget visual effect to play everywhere (frag/oil blast, smoke cloud).
  | { t: 'gadgetFx'; kind: GadgetKind; x: number; y: number; z: number }
  // Spy disguise (Phase 8): render player `id` as `faction` until `until`
  // (server worldTime). Broadcast to OTHERS; the spy sees themselves normally.
  | { t: 'disguised'; id: number; faction: number; until: number }
  // A season ended — winner faction (NO_FACTION = stalemate) + the season that
  // just finished. Clients clear bases + flash a banner; the board is reset.
  | { t: 'seasonEnd'; winner: number; number: number }
  // Land claims (M18): one claim's authoritative state, a periodic bulk refresh,
  // and removals (Core broken / overlap).
  | { t: 'claim'; claim: ClaimState }
  | { t: 'claims'; claims: ClaimState[] }
  | { t: 'claimRemove'; id: number }
  // Raid feed (M19): "RED breached BLUE's claim".
  | { t: 'breach'; attacker: string; faction: number; victim: number }
  // Admin (server console): a player's gamemode changed; teleport snaps a player.
  | { t: 'gamemode'; id: number; mode: GameMode }
  | { t: 'teleport'; x: number; y: number; z: number }
  // Admin notice shown to a player (e.g. "You are now in creative mode").
  | { t: 'notice'; text: string }
  // Lifesteal (Milestone A): the local player's authoritative hearts count.
  // `reason` drives the client toast + sound; `from` names the other player on
  // a steal/loss.
  | { t: 'hearts'; hearts: number;
      reason: 'init' | 'steal' | 'loss' | 'consume' | 'withdraw' | 'admin';
      from?: string }
  // You hit 0 hearts: full-screen banner (the server disconnects shortly
  // after; `until` is the wall-clock ms your elimination ends).
  | { t: 'eliminated'; by: string; until: number }
  // Revival Beacon support: the eliminated faction-mates you could revive,
  // and the result of a revive attempt (ok=true consumes the beacon).
  | { t: 'reviveList'; targets: { username: string; remainingMs: number }[] }
  | { t: 'revived'; target: string; ok: boolean }
  // Waypoint Totems (B4): the player's authoritative attuned-totem list (sent
  // on welcome + after every attune/unattune/prune).
  | { t: 'attuned'; totems: { x: number; y: number; z: number }[] };

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
