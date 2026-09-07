// VOXELON multiplayer wire protocol: message shapes + shared constants,
// plus username and skin helpers. Imported by BOTH the browser client and
// the Node server, so it must stay free of DOM and Node APIs.

import type { ItemStack } from '../items';
import type { MachineState, UpgradeAxis } from '../machines';
import type { TurretState, TurretAxis } from '../turrets';
import type { GadgetKind } from '../gadgets';
import type { Cosmetics } from '../character';
import type {
  ArenaBounds, EncounterEvent, EncounterSnapshot, VaultAttackIntent, Vec3,
} from '../vault_encounter';
import type { VaultBossKind, VaultFamily, VaultTier } from '../vaults';
import type {
  BombSnapshot, HeliLossReason, HelicopterSnapshot, SeatKind,
} from '../vehicles';
import type { DuelArenaBounds, DuelLobbySnapshot, DuelResult } from '../duels';
import type { BwArenaBounds, BwLobbySnapshot, BwResult, BwStage } from '../bedwars';
import type { DuelFlair, DuelPublicProfile } from '../duels_progression';
import type { PoliticsState } from '../politics';

/** One entry in a player's notification inbox (notifications_ui.ts). Kinds drive
 *  the icon and the accent, nothing else. */
export type NotificationKind =
  'broadcast' | 'election' | 'raid' | 'tax' | 'kit' | 'system';

export interface Notification {
  id: string;
  kind: NotificationKind;
  title: string;
  body: string;
  /** Wall-clock ms. */
  at: number;
}

/**
 * Everything the allegiance screen needs to show about a faction you have NOT
 * joined. Deliberately a separate, narrow shape rather than a slice of the
 * server's state: a side you are only inspecting gets its president, its roster
 * and its headline numbers, and nothing that would leak what it is holding.
 */
export interface FactionPublic {
  faction: number;
  /** Roster sample, capped — a long server must not put 5,000 names on the wire. */
  members: string[];
  memberCount: number;
  taxRate: number;
  kitStock: number;
  /** COUNT only. The treasury's contents are for its own members. */
  treasuryCount: number;
  /**
   * Live citizens whose looks the server actually knows (they are online), so a
   * faction with a VACANT SEAT still has real people standing on its card
   * instead of an empty plinth. Capped at FACTION_FACES_LIMIT. Anybody in
   * `members` who is not in here is drawn from `defaultCosmetics(skinSeed(name))`
   * — the same avatar they wear in the world when the client has never seen them.
   */
  faces?: { username: string; cosmetics?: Cosmetics }[];
  /** The sitting president, absent while the seat is vacant. */
  president?: {
    username: string;
    partyName: string;
    slogan: string;
    /** Indices into PRESET_PROMISES (politics.ts). */
    promises: number[];
    cosmetics?: Cosmetics;
    /** What they are actually carrying — rendered as hoverable item chips. */
    held?: ItemStack | null;
    armor?: (ItemStack | null)[];
  };
}

/** Roster names sent per faction on the pledge screen. */
export const FACTION_ROSTER_LIMIT = 40;
/** Citizens drawn as live 3D busts on a faction's card. Three fits the plinth
 *  at every card width and costs three avatars, not forty. */
export const FACTION_FACES_LIMIT = 3;

export const SERVER_PORT = 8080;
export const SNAPSHOT_HZ = 15;     // server -> clients transform broadcasts
export const TRANSFORM_HZ = 20;    // client -> server transform sends
export const WORLD_SEED = 1337;    // fixed shared seed (clients + server)
export const WORLD_BORDER = 5000;  // square play area side length (centred on origin)
export const WORLD_HALF = WORLD_BORDER / 2; // movement clamps to [-HALF, +HALF]
// The HEARTLAND core: the inner square where society lives — spawns land here.
// Outside it lie the WILDS: denser mobs, exclusive biomes — pure risk/reward
// frontier.
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
/** PvP combat window. Every damaging player hit restarts this clock; logging
 *  out during it is settled as a kill for the last attacker. */
export const COMBAT_TAG = 30;
export const MELEE_DAMAGE = 4;     // server-applied fist damage
// Bloodlust (anti-stalemate): the longer a PvP fight drags on, the harder every
// hit lands, so no fight can last forever. A fight "starts" on the first PvP
// hit and stays live while hits keep landing within COMBAT_TAG of each other;
// after BLOODLUST_START seconds of continuous fighting, incoming PvP damage
// grows +BLOODLUST_PER_STEP per BLOODLUST_STEP seconds, capped at
// BLOODLUST_CAP×. While combat-tagged, natural regen is fully blocked and
// heal-item regen runs at half speed.
export const BLOODLUST_START = 30; // seconds of fighting before damage ramps
export const BLOODLUST_STEP = 15;  // seconds per additional escalation step
export const BLOODLUST_PER_STEP = 0.25; // +25% incoming damage per step
export const BLOODLUST_CAP = 2;    // never more than double damage

/** Incoming-damage multiplier after `fightSeconds` of continuous PvP combat. */
export function bloodlustMult(fightSeconds: number): number {
  if (!(fightSeconds > BLOODLUST_START)) return 1;
  const steps = 1 + Math.floor((fightSeconds - BLOODLUST_START) / BLOODLUST_STEP);
  return Math.min(BLOODLUST_CAP, 1 + steps * BLOODLUST_PER_STEP);
}
export const EDIT_RANGE = 7;       // max distance a player may edit a block
// TPA (teleport requests, DonutSMP-style): the target must HOLD the accept key
// for TPA_HOLD seconds (client-side — moving or taking damage resets the hold);
// a pending request expires server-side after TPA_EXPIRE seconds.
export const TPA_HOLD = 5;
export const TPA_EXPIRE = 60;

/** Public, render-relevant state of one player. */
export interface PlayerSnapshot {
  id: number;
  x: number; y: number; z: number;
  yaw: number; pitch: number;
  health: number;
  dead: boolean;
  gliding?: boolean;
  boating?: boolean;
  /** True while strapped into a vehicle seat — the avatar sits (and sits LOW,
   *  so a rider's head is inside the cabin rather than through its roof). */
  seated?: boolean;
  /** True while the player is holding sneak/crouch. */
  sneaking?: boolean;
  /** Item id held in hand (0 = empty) — rendered on the avatar's arm. */
  held?: number;
  /** Worn armor item ids [helmet, chest, legs, boots] (0 = bare slot) —
   *  rendered as overlay plating on the avatar. */
  armor?: number[];
  /** Monotonic 16-bit swing sequence; a change starts the arm-hit animation. */
  swing?: number;
  /** Firearm presentation state used by third-person weapon poses. */
  aiming?: boolean;
  reloading?: boolean;
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
  /** Server-owned competitive Duels progression and cosmetic flair. */
  duelProfile: DuelPublicProfile;
  /** Avatar customisation (Character screen). Absent = seed-derived default. */
  cosmetics?: Cosmetics;
}

export interface DuelLeaderboardEntry extends DuelPublicProfile {
  username: string;
  /** The account's saved avatar, so the ladder can render the player's actual
   *  character rather than a generic silhouette. Absent = never customised;
   *  the client falls back to `defaultCosmetics(skinSeed(username))`, which is
   *  exactly the avatar that account is already wearing in the world. */
  cosmetics?: Cosmetics;
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
/** Flat damage soaked AFTER percentage mitigation (Greater Rune of Iron).
 *  A full set of four is the ceiling, mirroring how the rune multiplier caps
 *  are sized. Percentage armor alone already saturates at full titanium
 *  (20 points), so this is the only defensive stat an endgame set can still
 *  grow — which is exactly why it is boss-locked. */
export const TOUGHNESS_CAP = 4;

/** Vanilla-ish armor: each point blocks 4% of incoming damage, capped at 80%.
 *  `toughness` then soaks a flat amount on top, but a hit that connects always
 *  costs at least 1 HP — no stack of runes can make a player literally
 *  unkillable (the same rule bloodlust uses so fights always end).
 *  Used by BOTH the offline client and the authoritative server so mitigation
 *  is identical. Returns the (rounded) damage that gets through.
 *  With `toughness` 0 this is exactly the percentage-only function it has
 *  always been, so a player with no runes is bit-for-bit unaffected.
 *
 *  `pierce` (0..1) ignores that fraction of the target's armor points. It
 *  exists because armor is MULTIPLICATIVE and the endgame saturates it: a full
 *  titanium set blocks 80% flat, so a raw number tuned to threaten a geared
 *  player deletes an ungeared one, and a number tuned to be fair to the
 *  ungeared player is a tickle to the geared one. Nothing in the open world
 *  uses it (default 0 = the old function, bit for bit); vault-boss hazards do,
 *  which is what lets one authored damage ladder stay honest across the whole
 *  gear curve. A pierced hit also caps the flat toughness soak at half the
 *  hit, so four Greater Runes of Iron stay a strong upgrade instead of
 *  flattening every attack in a lair to the 1 HP minimum. */
export function mitigate(
  amount: number, armorPoints: number, toughness = 0, pierce = 0,
): number {
  const bite = Math.max(0, Math.min(1, pierce)) || 0;
  const eff = Math.max(0, Math.min(ARMOR_POINT_CAP, armorPoints)) * (1 - bite);
  const base = Math.max(0, Math.round(amount * (1 - eff * 0.04)));
  if (!(toughness > 0) || base <= 0) return base;
  const soak = Math.min(TOUGHNESS_CAP, toughness,
    bite > 0 ? Math.floor(base / 2) : Infinity);
  return Math.max(1, base - soak);
}

// --- client -> server -------------------------------------------------------
export type ClientMsg =
  | { t: 'hello' }
  | { t: 'duelInviteInfo'; token: string }
  // Mandatory accounts: a socket must authenticate before it spawns a player.
  // A fresh account has NO side: allegiance is sworn later, once, on the
  // pledge screen (see `pledgeFaction`).
  | { t: 'register'; username: string; password: string }
  | { t: 'login'; username: string; password: string }
  // Resume a saved session (token issued by the server on each successful
  // auth) — lets a returning browser skip the password.
  | { t: 'session'; username: string; token: string }
  // Duels matchmaking plus private, invite-only parties.
  | { t: 'duelCreate' }
  | { t: 'duelQueue'; join: boolean }
  | { t: 'duelJoin'; token: string }
  | { t: 'duelLeave' }
  | { t: 'duelReady'; ready: boolean }
  | { t: 'duelStart' }
  | { t: 'duelArenaReady' }
  | { t: 'duelRematch'; vote: boolean }
  | { t: 'duelReturn' }
  | { t: 'duelFlair'; flair: DuelFlair }
  // Bedwars. Lobby verbs mirror Duels; the in-match verbs are reachable ONLY
  // through `routeBedwarsInMatch`, so `bwMelee` is inert everywhere else.
  | { t: 'bwCreate' }
  | { t: 'bwQueue'; join: boolean }
  | { t: 'bwJoin'; token: string }
  | { t: 'bwLeave' }
  | { t: 'bwReady'; ready: boolean }
  | { t: 'bwStart' }
  | { t: 'bwArenaReady' }
  /** The attacker sends a target id and NOTHING else. Damage, charge, crit,
   *  combo and knockback are all computed server-side from `p.bwAxe` and the
   *  server's own position history. */
  | { t: 'bwMelee'; target: number }
  | { t: 'bwBed'; x: number; y: number; z: number }
  | { t: 'bwShopBuy'; entry: number }
  | { t: 'xform'; x: number; y: number; z: number; yaw: number; pitch: number;
      gliding?: boolean; boating?: boolean; seated?: boolean;
      sneaking?: boolean; held?: number; armor?: number[]; swing?: number;
      aiming?: boolean; reloading?: boolean }
  | { t: 'edit'; x: number; y: number; z: number; block: number }
  // Pull a Lever: the server recomputes the flips (lever + linked traps within
  // LEVER_RADIUS, traps.ts) over its edit log and broadcasts them as edits —
  // linked traps can sit beyond the puller's own EDIT_RANGE, so this can't be
  // expressed as plain client edits.
  | { t: 'lever'; x: number; y: number; z: number }
  // FLAGS (capture the flag): one swing at the flag pad you're standing next
  // to. The server decides WHICH flag from your position + faction, so a
  // forged hit can never reach across the map or touch your own flag.
  | { t: 'flagHit' }
  // TPA: ask to teleport to `target` (by username); the target accepts their
  // newest pending request after the client-side 5s hold completes.
  | { t: 'tpa'; target: string }
  | { t: 'tpaAccept' }
  // An operator command typed into the in-game command box. The transport shell
  // (server/server.ts) handles this one — NOT the pure GameServer — because it
  // reaches accounts/persistence/shutdown. OP is re-checked there on every
  // line, so this is safe to send from any client.
  | { t: 'command'; text: string }
  | { t: 'selfhurt'; amount: number }   // fall/drown damage, applied by server
  | { t: 'respawn' }
  // `reason` separates a HARVEST (a block you just broke, a machine spilling)
  // from a player emptying their own inventory. Only a harvest is taxed, so
  // dropping and re-collecting your own stack can never be levied twice. Same
  // trust model as the client-reported armor points: a client could mislabel
  // one, and the cost of that is a dodged tax, not a duped item.
  | { t: 'drop'; items: { id: number; count: number }[]; x: number; y: number; z: number;
      reason?: 'harvest' | 'manual' }
  | { t: 'pickup'; eid: number }
  | { t: 'chestOpen'; x: number; y: number; z: number }
  | { t: 'chestSet'; x: number; y: number; z: number; slots: (ItemStack | null)[] }
  // Worn-armor defense, server mitigates. `toughness` is the flat soak from
  // Greater Runes of Iron; like `points` it is client-reported and
  // server-clamped (same trust model).
  | { t: 'armor'; points: number; toughness?: number }
  | { t: 'rangedAttack'; target: number; amount: number } // gun/projectile PvP hit
  // PURELY COSMETIC gunfire report: "I pulled the trigger of `item`, from here,
  // pointing there". Carries NO damage — hits are still reported separately by
  // `rangedAttack`, which the server validates. The server rebroadcasts this to
  // everyone else so incoming fire can be seen and heard; without it an enemy's
  // gun is silent and invisible and you just take damage out of nowhere.
  | { t: 'shot'; x: number; y: number; z: number;
      dx: number; dy: number; dz: number; item: number }
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
  // A rocket detonation point: the client fires + simulates the projectile and
  // reports where it burst. The server applies the (capped) splash damage to
  // enemies in range + broadcasts the crater, so rocket splash syncs to everyone
  // (the shooter already ran the blast locally; the server skips re-sending it).
  | { t: 'rocketBlast'; x: number; y: number; z: number }
  // Secret faction switch (Phase 7): defect to the other side. NO public
  // announcement — others keep seeing your old colors (a spy), but the server
  // treats you as your new faction. Max 2/season, locked in the final week.
  | { t: 'switchFaction'; faction: number }
  // --- FACTION GOVERNMENT (politics.ts / treasury.ts) ------------------------
  // Swear allegiance. PERMANENT: the server refuses a second pledge, so this is
  // the one and only time a player chooses a side.
  | { t: 'pledgeFaction'; faction: number }
  // Stand for election / withdraw / vote. One party and one vote per citizen
  // per cycle; the server owns both rules.
  | { t: 'foundParty'; name: string; slogan: string; promises: number[] }
  | { t: 'disbandParty' }
  | { t: 'castVote'; partyId: string }
  // Powers of office. Every one is re-checked against the sitting presidency
  // server-side — the client only hides the controls.
  | { t: 'govBroadcast'; text: string }
  | { t: 'govTax'; rate: number }
  // Rewrite the recruit loadout: 4 armor slots then 9 hotbar slots, nulls for
  // the gaps (treasury.ts owns the layout and re-validates every slot).
  | { t: 'govSetKit'; slots: (ItemStack | null)[] }
  // Fund kits. The president pays out of their OWN POCKETS, always: the CLIENT
  // has already removed the bill from its inventory and the server banks it
  // before spending it, so the treasury nets out unchanged and the stock still
  // comes from something real. Same trust model as `drop`, which is also the
  // client declaring what it just had. `source` is carried so a build that
  // still knows about the old treasury purse is REFUSED rather than handed free
  // kits it never paid for.
  | { t: 'govFundKits'; count: number; source?: 'inventory' }
  // Claim the recruit kit your faction funded (once per account, ever).
  | { t: 'claimKit' }
  // Haul stacks out of the ENEMY treasury. Refused outside a war window.
  | { t: 'treasuryRaid'; faction: number }
  // Open YOUR OWN hoard as a chest. President-only, and only while standing at
  // the flag — the server answers with a `treasury` message or refuses.
  | { t: 'treasuryOpen'; faction: number }
  // Write one PAGE of that hoard back (the chest panel holds one page at a
  // time). Same president + in-reach check, and every slot is re-validated.
  | { t: 'treasurySet'; faction: number; page: number; slots: (ItemStack | null)[] }
  // RETIRED (Warfare Command): the old mob-kill XP report. Kept in the union so
  // an older client's message is accepted and ignored rather than desyncing.
  | { t: 'xp'; amount: number }
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
  // Healing consumable (Bandage/Medkit): the item is consumed client-side (like
  // other crafts); the server applies the accelerated-regen buff so health is
  // authoritative and flows back via the snapshot. `item` picks the heal tier.
  | { t: 'useHeal'; item: number }
  // Revival Beacon: ask for the eliminated faction-mates you could revive,
  // then revive one by username (beacon item is consumed client-side on the
  // server's `revived ok` confirmation).
  | { t: 'reviveList' }
  | { t: 'beaconRevive'; target: string }
  // Waypoint Totems (B4): attune to a placed totem block (toggle; max 4), and
  // teleport to an attuned one (the client runs the 3s wind-up; the server
  // enforces attunement + block-exists + 60s cooldown + the combat tag).
  | { t: 'attune'; x: number; y: number; z: number }
  | { t: 'totemTeleport'; x: number; y: number; z: number }
  // Character screen: push the local player's new look (server sanitizes,
  // persists it on the account and broadcasts it to everyone).
  | { t: 'cosmetics'; c: Cosmetics }
  // Vaults (Milestone D): announce entry (server replies with the vault's
  // authoritative state incl. whether YOU already looted it), report a hit on
  // the server-HP Vault Brute, and open the per-player VaultChest.
  | { t: 'vaultEnter'; cx: number; cz: number }
  | { t: 'vaultAttack'; cx: number; cz: number; intent: VaultAttackIntent }
  | { t: 'vaultChestOpen'; x: number; y: number; z: number }
  // --- WARFARE COMMAND -------------------------------------------------------
  // Progression. XP itself is NEVER client-reported: the server settles it from
  // its own boss-contribution ledger. The client may only ask to SPEND.
  | { t: 'warfareBuy'; node: string }
  // Helicopters. The client sends INPUT, never positions.
  | { t: 'heliSpawn'; x: number; y: number; z: number }
  // Field-assemble an airframe from a carried Helicopter Airframe kit. A
  // helipad is a convenience, not a prerequisite — needing to build one every
  // time you wanted to fly made the whole aircraft feel bolted to the ground.
  | { t: 'heliDeploy'; x: number; y: number; z: number }
  | { t: 'heliMount'; id: number; seat?: SeatKind }
  | { t: 'heliDismount' }
  | { t: 'heliInput'; forward: number; strafe: number; lift: number; yaw: number; seq: number }
  | { t: 'heliBomb' }
  | { t: 'heliService'; id: number; oil: number; bombs: number; repair: number }
  | { t: 'heliUpgrade'; id: number }
  | { t: 'heliModule'; id: number; item: number }
  | { t: 'heliRope'; action: 'toggle' | 'attach' | 'drop' | 'move'; motion?: number }
  | { t: 'heliHit'; id: number; amount: number };

// --- server -> client -------------------------------------------------------
export type ServerMsg =
  // Auth: a rejected login/register (success is signalled by the `welcome`).
  // `lockMs` (when present) is a live elimination lockout in ms — the title
  // screen turns it into a ticking countdown. `permanent` means never.
  | { t: 'authErr'; error: string; lockMs?: number; permanent?: boolean }
  // A fresh session token (sent right after every successful auth); the client
  // stores it in localStorage so the next visit can skip the login form.
  | { t: 'session'; token: string }
  | { t: 'duelInviteInfo'; valid: boolean; host?: string; lobbyId?: string }
  | { t: 'duelQueue'; queued: boolean }
  | { t: 'duelLobby'; snapshot: DuelLobbySnapshot; inviteToken?: string }
  | { t: 'duelError'; code: 'invalid' | 'full' | 'match_in_progress' |
      'already_in_lobby' | 'not_host' | 'too_few_players' | 'too_many_players' |
      'not_everyone_ready' | 'not_in_lobby'; message: string }
  | { t: 'duelArena'; arena: DuelArenaBounds; spawn: { x: number; y: number; z: number };
      countdownEndsAt: number }
  | { t: 'duelLoadout'; slots: (ItemStack | null)[]; armor: (ItemStack | null)[];
      selected: number; unlimitedReserve: boolean }
  | { t: 'duelClock'; serverNow: number; endsAt: number; suddenDeath: boolean }
  | { t: 'duelRespawn'; respawnAt: number; spectating: boolean }
  | { t: 'duelResult'; result: DuelResult }
  | { t: 'duelProgress'; profile: DuelPublicProfile; leaderboard: DuelLeaderboardEntry[] }
  | { t: 'duelFlairResult'; ok: boolean; profile: DuelPublicProfile; leaderboard: DuelLeaderboardEntry[] }
  | { t: 'duelLeaderboard'; leaderboard: DuelLeaderboardEntry[] }
  | { t: 'duelProfileUpdate'; id: number; profile: DuelPublicProfile }
  | { t: 'bwQueue'; queued: boolean }
  | { t: 'bwLobby'; snapshot: BwLobbySnapshot; inviteToken?: string }
  | { t: 'bwError'; code: 'invalid' | 'full' | 'match_in_progress' |
      'already_in_lobby' | 'not_host' | 'too_few_players' | 'too_many_players' |
      'not_everyone_ready' | 'not_in_lobby' | 'cannot_afford' | 'too_far'; message: string }
  | { t: 'bwArena'; arena: BwArenaBounds; spawn: { x: number; y: number; z: number };
      team: number; countdownEndsAt: number }
  | { t: 'bwLoadout'; slots: (ItemStack | null)[]; selected: number; axe: number }
  | { t: 'bwResources'; iron: number; gold: number; diamond: number }
  /** Attacker-only feedback. `hitconfirm` cannot carry crit/combo/charge, and
   *  those three are what the swing UI is made of. */
  | { t: 'bwHit'; target: number; amount: number; combo: number; charge: number;
      crit: boolean; killed: boolean }
  | { t: 'bwBedBroken'; team: number; by: number }
  | { t: 'bwClock'; serverNow: number; endsAt: number; stage: BwStage }
  | { t: 'bwRespawn'; respawnAt: number; spectating: boolean }
  | { t: 'bwResult'; result: BwResult }
  /** Shop purchase payout. The SCARCE half of a purchase — the resource debit
   *  and the axe tier — is server-authoritative; these consumable stacks are
   *  handed to the client's own inventory, which is safe because every id
   *  involved is MINIGAME_ONLY and cannot leave the arena. */
  | { t: 'bwGrant'; items: ItemStack[] }
  | { t: 'arenaRestored'; x: number; y: number; z: number; yaw: number; pitch: number;
      health: number; dead: boolean; mode: GameMode; state?: Record<string, unknown> }
  | {
      t: 'welcome'; id: number; seed: number; username: string;
      /** Authoritative seconds on the persistent server world clock. */
      worldTime: number;
      players: PlayerInfo[]; edits: [string, number][]; items: ItemEntityInfo[];
      turrets: { x: number; y: number; z: number; state: TurretState }[];
      /** Current season number + seconds left before the deadline (Phase 5), or
       *  SEASON_ENDLESS (-1) for a season that has no deadline — which is every
       *  season now: one ends when a capital falls, not on a clock. */
      season: { number: number; timeLeft: number };
      /** War window: the shrinking-border battle. While `active` the border is
       *  closing (derive it from timeLeft+duration via warBorderAt); else a
       *  countdown to the next scheduled war (`nextIn`), or all-zero peacetime.
       *  `score` is each faction's kills in the current war; `wins` is each
       *  faction's war wins this season (the season winner). */
      war: { active: boolean; timeLeft: number; nextIn: number; duration: number;
        score: number[]; wins: number[] };
      /** Capture-the-flag state (see flags.ts). */
      flags: { breakable: boolean;
        flags: { faction: number; holder: number; hp: number; carrier: number }[] };
      /** Saved per-account state to restore (inventory/hotbar); undefined for new accounts. */
      state?: Record<string, unknown>;
      /** WARFARE COMMAND: your personal progression, stored on the ACCOUNT
       *  (explicitly — never inside the opaque client `state` blob). */
      warfare: { xp: number; nodes: string[] };
      duelProfile: DuelPublicProfile;
      duelLeaderboard: DuelLeaderboardEntry[];
      /** Aviation hardware standing in the world. */
      helis: HelicopterSnapshot[];
      /** FACTION GOVERNMENT: elections + governments for every faction. Present
       *  even for an unpledged player — the allegiance screen reads it. */
      politics: PoliticsState;
      /** Per-faction public dossiers for the allegiance screen. */
      factions: FactionPublic[];
      /** YOUR faction's treasury contents (omitted while unpledged). */
      treasury?: (ItemStack | null)[];
      /** Stored broadcasts waiting in your inbox, oldest first. */
      inbox: Notification[];
      /** Have you already claimed your recruit kit? */
      kitClaimed: boolean;
    }
  | { t: 'join'; player: PlayerInfo }
  | { t: 'leave'; id: number }
  | { t: 'snapshot'; players: PlayerSnapshot[]; worldTime: number }
  | { t: 'edit'; x: number; y: number; z: number; block: number }
  | { t: 'editBatch'; edits: { x: number; y: number; z: number; block: number }[] }
  | { t: 'hurt'; health: number; dead: boolean; by: number;
      kx: number; ky: number; kz: number;
      /** Remaining PvP combat seconds (0 for environment/self damage). */
      combat: number }
  // Told to the ATTACKER when one of their direct hits lands: the hitmarker.
  // Sent from the server rather than predicted client-side so it can never lie
  // about a shot the server rejected. `amount` is the health actually removed
  // AFTER armor — 0 means the target soaked it, which is worth showing too.
  | { t: 'hitconfirm'; target: number; amount: number; killed: boolean }
  // Cosmetic explosion FX for everyone but the instigator (who already ran it
  // locally). Craters arrive as ordinary `edit` messages, so without this a
  // remote blast is a silent, invisible hole appearing in the world.
  | { t: 'blast'; x: number; y: number; z: number }
  // A rebroadcast gunshot (see the client-side `shot`), tagged with the shooter.
  | { t: 'shot'; id: number; x: number; y: number; z: number;
      dx: number; dy: number; dz: number; item: number }
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
  // Season clock (Phase 5): number + seconds left (periodic HUD broadcast).
  // `timeLeft` is seconds to the deadline, or -1 (SEASON_ENDLESS) when the
  // season has no deadline at all.
  | { t: 'season'; number: number; timeLeft: number }
  // War clock: the shrinking-border battle. `score` = kills per faction in the
  // current war; `wins` = war wins per faction this season. Broadcast
  // periodically + on every peace<->war transition. Admin-scheduled.
  | { t: 'war'; active: boolean; timeLeft: number; nextIn: number; duration: number;
      score: number[]; wins: number[] }
  // A war just ended: the most-kills faction wins it (NO_FACTION = draw).
  | { t: 'warEnd'; winner: number; score: number[] }
  // FLAGS: the whole capture-the-flag state (small — one entry per faction).
  // Broadcast on every change; also carried in `welcome`.
  | { t: 'flags'; breakable: boolean;
      flags: { faction: number; holder: number; hp: number; carrier: number }[] }
  // A flag changed hands — drives the banners/notices ('' name = nobody).
  | { t: 'flagEvent'; kind: 'taken' | 'returned' | 'captured';
      faction: number; by: string; holder: number }
  // Private confirmation of a secret faction switch (only to the defector).
  | { t: 'factionSwitched'; faction: number; remaining: number }
  // --- FACTION GOVERNMENT ----------------------------------------------------
  // The whole politics state plus the public dossiers, rebroadcast on every
  // change (it is small: two elections, at most 12 parties each). `treasury` is
  // per-recipient — you only ever see your OWN faction's contents.
  | { t: 'politics'; state: PoliticsState; factions: FactionPublic[];
      treasury?: (ItemStack | null)[] }
  // Your pledge landed: you are a citizen of `faction` from now on.
  | { t: 'pledged'; faction: number }
  // A governance action was refused, with the reason to show.
  | { t: 'govErr'; reason: string }
  // One entry for the notifications inbox.
  | { t: 'notify'; notif: Notification }
  // Somebody is in the vault. Drives the alarm horn for the defenders.
  | { t: 'treasuryRaided'; faction: number; by: string; stacks: number }
  // The hoard, in full, in answer to `treasuryOpen` — the president's live copy
  // to open the chest panel on.
  | { t: 'treasury'; faction: number; slots: (ItemStack | null)[] }
  // Gadget visual effect to play everywhere (frag/oil blast, smoke cloud).
  | { t: 'gadgetFx'; kind: GadgetKind; x: number; y: number; z: number }
  // Spy disguise (Phase 8): render player `id` as `faction` until `until`
  // (server worldTime). Broadcast to OTHERS; the spy sees themselves normally.
  | { t: 'disguised'; id: number; faction: number; until: number }
  // A season ended — winner faction (NO_FACTION = stalemate) + the season that
  // just finished. Clients flash a banner; war scores reset.
  | { t: 'seasonEnd'; winner: number; number: number }
  // Admin (server console): a player's gamemode changed; teleport snaps a player.
  | { t: 'gamemode'; id: number; mode: GameMode }
  | { t: 'teleport'; x: number; y: number; z: number }
  // Thrown clear of a bursting airframe: a teleport that also hands the body an
  // impulse, so a crash physically launches the crew instead of dropping them.
  | { t: 'ejected'; x: number; y: number; z: number;
      vx: number; vy: number; vz: number; reason: HeliLossReason }
  // Admin notice shown to a player (e.g. "You are now in creative mode").
  | { t: 'notice'; text: string }
  // TPA: `from` wants to teleport to YOU — run /tpaccept to allow it.
  | { t: 'tpaRequest'; from: string }
  // Operator status for THIS socket: sent right after auth and again whenever
  // the console ops/deops the account. Drives the command box's suggestions
  // (the server still re-checks it on every command it receives).
  | { t: 'op'; op: boolean }
  // Output of an operator command, echoed back into the sender's command box.
  | { t: 'cmdOut'; lines: string[]; ok?: boolean }
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
  | { t: 'attuned'; totems: { x: number; y: number; z: number }[] }
  // Vaults (Milestone D): one vault's authoritative boss state. `opened` is
  // per-recipient (whether YOU already looted) and only present on a direct
  // vaultEnter reply — broadcasts omit it so clients keep their own flag.
  | { t: 'vault'; cx: number; cz: number; tier: number; hp: number;
      maxHp: number; alive: boolean; opened?: boolean }
  // The Brute fell — banner + fame ("<name> cleared a Tier N vault").
  | { t: 'vaultCleared'; cx: number; cz: number; by: string }
  // YOUR per-player loot roll was granted (items arrive via gotitem).
  | { t: 'vaultLooted'; cx: number; cz: number }
  | {
      t: 'encounterStart'; cx: number; cz: number; encounterId: string;
      family: VaultFamily; kind: VaultBossKind; tier: VaultTier;
      startTime: number; seed: number; bounds: ArenaBounds;
      scaling: number; cameraAnchors: Vec3[]; snapshot: EncounterSnapshot;
    }
  | { t: 'encounterSnapshot'; cx: number; cz: number; snapshot: EncounterSnapshot }
  | { t: 'encounterEvent'; cx: number; cz: number; event: EncounterEvent }
  | {
      t: 'encounterEnd'; cx: number; cz: number;
      outcome: 'victory' | 'reset' | 'abandonment'; credited?: string;
    }
  // A player changed their avatar cosmetics — rebuild their model.
  | { t: 'cosmetics'; id: number; c: Cosmetics }
  // --- WARFARE COMMAND -------------------------------------------------------
  // YOUR authoritative progression (sent on welcome + after every change).
  | { t: 'warfare'; xp: number; nodes: string[] }
  // A boss you helped kill paid out. `total` is your new earned total.
  | { t: 'warfareXp'; amount: number; tier: number; total: number; boss: string }
  // A purchase or a hardware action was refused, with the reason to show.
  | { t: 'warfareErr'; reason: string }
  // Helicopters + their bombs.
  | { t: 'helis'; list: HelicopterSnapshot[]; bombs: BombSnapshot[] }
  | { t: 'heliSeat'; id: number; seat: SeatKind | null }
  | { t: 'heliRopeState'; id: number; progress: number }
  | { t: 'heliModuleInstalled'; id: number; item: number }
  | { t: 'heliDown'; id: number; x: number; y: number; z: number; faction: number;
      reason: HeliLossReason }
  | { t: 'heliGone'; id: number };

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
