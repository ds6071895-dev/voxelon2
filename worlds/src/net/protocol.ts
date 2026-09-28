// Worlds wire protocol: message shapes + shared constants, plus the username
// and skin helpers. Imported by BOTH the browser client and the Node server,
// so it must stay free of DOM and Node APIs.
//
// The server speaks to a client on three channels:
//   · identity  — your temporary or signed-in name, and the account dialog
//   · the menu  — your party and your queue
//   · a world   — once a match starts you are moved into that match's own
//                 world (multiverse.ts); every body, block and hit you hear
//                 about belongs to it, and nothing from any other world does.

import type { ItemStack } from '../items';
import type { Cosmetics } from '../character';
import type { DuelArenaBounds, DuelLobbySnapshot, DuelResult } from '../duels';
import type {
  PartyArenaBounds, PartyLobbySnapshot, PartyResult, PartySubBounds,
} from '../partygames';
import type { WorldSpec } from '../multiverse';
import type { RatClassId, RsEffects, RsResult, RsRole, RsSnapshot, RsSound } from '../ratseek_rules';

/** Worlds' own game-server port. VOXELON keeps 8080; the two never collide. */
export const SERVER_PORT = 8090;
export const SNAPSHOT_HZ = 20;     // server -> clients transform broadcasts
export const TRANSFORM_HZ = 20;    // client -> server transform sends
export const EDIT_RANGE = 7;       // max distance a player may edit a block
export const PARTY_MAX = 4;        // most members one party can hold

/** The games on the title screen. */
export type GameMode = 'duels' | 'bridge' | 'parkour' | 'ratseek';
export function isGameMode(v: unknown): v is GameMode {
  return v === 'duels' || v === 'bridge' || v === 'parkour' || v === 'ratseek';
}

/** Public, render-relevant state of one player. */
export interface PlayerSnapshot {
  id: number;
  x: number; y: number; z: number;
  yaw: number; pitch: number;
  /** The owner's clock (ms) when this transform was sampled, relayed from
   *  their last `xform`. Receivers interpolate on this timeline rather than on
   *  packet arrival, so relay/network jitter never becomes speed jitter. */
  ct?: number;
  health: number;
  dead: boolean;
  sneaking?: boolean;
  /** Item id held in hand (0 = empty) — rendered on the avatar's arm. */
  held?: number;
  /** Monotonic 16-bit swing sequence; a change starts the arm-hit animation. */
  swing?: number;
  /** Firearm presentation state used by third-person weapon poses. */
  aiming?: boolean;
  reloading?: boolean;
}

/** Full info about a player in your world (sent when you enter it). */
export interface PlayerInfo extends PlayerSnapshot {
  username: string;
  skin: number; // seed for deterministic avatar colours
  /** Avatar customisation (dressing room). Absent = seed-derived default. */
  cosmetics?: Cosmetics;
}

/** One member as the party panel shows them. */
interface PartyMember {
  id: number;
  username: string;
  skin: number;
  cosmetics?: Cosmetics;
  /** What they are doing right now, for the leader's "is everyone free". */
  status: 'menu' | 'queue' | 'match';
}
export interface PartyState {
  code: string;
  leader: number;
  members: PartyMember[];
}

// --- client -> server -------------------------------------------------------
export type ClientMsg =
  // First message on every socket. `guest` asks for the temporary name this
  // browser had last time (granted only if nobody else holds it); `session`
  // resumes a signed-in account.
  | { t: 'hello'; guest?: string; session?: { username: string; token: string }; cosmetics?: Cosmetics }
  // Accounts. There are no custom usernames: you register the name you are
  // currently playing under, or one the server rolled for you (`rollName`).
  | { t: 'rollName' }
  | { t: 'register'; username: string; password: string }
  | { t: 'login'; username: string; password: string }
  | { t: 'logout' }
  | { t: 'cosmetics'; c: Cosmetics }
  // Parties.
  | { t: 'partyCreate' }
  | { t: 'partyJoin'; code: string }
  | { t: 'partyLeave' }
  | { t: 'partyKick'; id: number }
  | { t: 'partyPromote'; id: number }
  // Play: solo -> public queue; a party leader -> a private match for the party.
  // Rat and Seek: `seeker` is the party member the leader picked to hunt
  // (0 = the AI seeker, the default), and `ratClass` the class this player last chose.
  | { t: 'play'; mode: GameMode; seeker?: number; ratClass?: RatClassId }
  | { t: 'cancelQueue' }
  // Back to the menu (from a results screen, or forfeiting a live match).
  | { t: 'leaveMatch' }
  // The spawn bubble of the world you were sent to is built.
  | { t: 'worldReady'; world: number; revision?: number }
  // In-world.
  | { t: 'xform'; world: number; revision?: number; x: number; y: number; z: number;
      yaw: number; pitch: number; sneaking?: boolean; held?: number; swing?: number;
      aiming?: boolean; reloading?: boolean; ct?: number }
  | { t: 'edit'; x: number; y: number; z: number; block: number }
  // Duels rifle: a cosmetic tracer ticket, then a separately reported hit.
  | { t: 'shot'; x: number; y: number; z: number; dx: number; dy: number; dz: number; item: number }
  | { t: 'rangedAttack'; target: number; amount: number }
  | { t: 'useHeal'; item: number }
  // The Bridge / Parkour.
  | { t: 'pgMelee'; target: number }
  | { t: 'pgShoot'; dx: number; dy: number; dz: number; power: number }
  | { t: 'pgRetry' }
  // Rat and Seek: right-click with a hotbar slot (on a block, if one is under
  // the crosshair), a left-click on a body or a decoy, and a class pick.
  | { t: 'rsUse'; slot: number; block?: { x: number; y: number; z: number; nx: number; ny: number; nz: number } }
  | { t: 'rsHit'; target: number; decoy?: boolean }
  | { t: 'rsClass'; cls: RatClassId }
  // The party host's "Who seeks?" pick during the prep time (0 = the AI seeker).
  | { t: 'rsSeeker'; seeker: number };

// --- server -> client -------------------------------------------------------
export type ServerMsg =
  | { t: 'welcome'; id: number; username: string; account: boolean; cosmetics?: Cosmetics }
  /** Your name or sign-in state changed (register, login, logout). */
  | { t: 'identity'; username: string; account: boolean; token?: string; cosmetics?: Cosmetics }
  | { t: 'authErr'; error: string }
  | { t: 'nameOffer'; name: string }
  | { t: 'party'; party: PartyState | null }
  | { t: 'partyErr'; message: string }
  /** Your matchmaking state. `mode` null = not searching. */
  | { t: 'queue'; mode: GameMode | null }
  | { t: 'notice'; text: string }
  // --- Worlds ---
  /** You are now in a Duels world. */
  | { t: 'duelArena'; world: WorldSpec; arena: DuelArenaBounds; spawn: { x: number; y: number; z: number };
      countdownEndsAt: number }
  /** You are now in a Bridge or Parkour world. */
  | { t: 'pgArena'; world: WorldSpec; arena: PartyArenaBounds; sub: PartySubBounds; team: number;
      spawn: { x: number; y: number; z: number }; countdownEndsAt: number; revision: number }
  /** You are back in the menu (the world you were in is gone for you). */
  | { t: 'leftWorld' }
  | { t: 'join'; player: PlayerInfo }
  | { t: 'leave'; id: number }
  | { t: 'snapshot'; players: PlayerSnapshot[] }
  | { t: 'edit'; x: number; y: number; z: number; block: number }
  | { t: 'editBatch'; edits: { x: number; y: number; z: number; block: number }[] }
  | { t: 'hurt'; health: number; dead: boolean; by: number; kx: number; ky: number; kz: number }
  | { t: 'hitconfirm'; target: number; amount: number; killed: boolean }
  | { t: 'shot'; id: number; item: number; x: number; y: number; z: number; dx: number; dy: number; dz: number }
  | { t: 'respawned'; x: number; y: number; z: number; health: number }
  | { t: 'teleport'; x: number; y: number; z: number }
  | { t: 'killfeed'; killer: string; victim: string }
  | { t: 'cosmetics'; id: number; c: Cosmetics }
  // Duels.
  | { t: 'duelState'; snapshot: DuelLobbySnapshot }
  | { t: 'duelLoadout'; slots: (ItemStack | null)[]; selected: number }
  | { t: 'duelClock'; serverNow: number }
  | { t: 'duelRespawn'; respawnAt: number; spectating: boolean }
  | { t: 'duelResult'; result: DuelResult }
  // The Bridge / Parkour.
  | { t: 'pgState'; snapshot: PartyLobbySnapshot }
  | { t: 'pgLoadout'; slots: (ItemStack | null)[]; selected: number }
  /** Attacker-only feedback: `hitconfirm` cannot carry crit/combo. */
  | { t: 'pgHit'; target: number; amount: number; combo: number; charge: number;
      crit: boolean; killed: boolean; ranged: boolean }
  | { t: 'pgArrow'; id: number; by: number; x: number; y: number; z: number;
      dx: number; dy: number; dz: number; speed: number; power: number }
  | { t: 'pgArrowEnd'; id: number; x: number; y: number; z: number; hit: boolean }
  | { t: 'pgResult'; result: PartyResult }
  // Rat and Seek.
  | { t: 'rsArena'; world: WorldSpec; role: RsRole; spawn: { x: number; y: number; z: number }; yaw: number }
  | { t: 'rsState'; s: RsSnapshot }
  | { t: 'rsKit'; slots: (ItemStack | null)[]; selected?: number }
  | { t: 'rsFx'; fx: RsEffects }
  | { t: 'rsTitle'; title: string; sub: string; color: string; ms: number }
  | { t: 'rsBar'; text: string; color: string }
  | { t: 'rsMsg'; text: string; color: string }
  | { t: 'rsSound'; kind: RsSound; x?: number; y?: number; z?: number }
  | { t: 'rsImpulse'; vx: number; vy: number; vz: number; momentum: number }
  | { t: 'rsResult'; result: RsResult };

// --- Names ------------------------------------------------------------------

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

/** Generate a candidate "AdjNounNN" username from a 0..1 rng. `digits` grows
 *  the numeric tail when the two-digit space is getting crowded. */
export function makeUsername(rng: () => number, digits = 2): string {
  const a = ADJECTIVES[Math.floor(rng() * ADJECTIVES.length)];
  const n = NOUNS[Math.floor(rng() * NOUNS.length)];
  const lo = 10 ** (Math.max(2, Math.min(5, digits)) - 1);
  const num = lo + Math.floor(rng() * lo * 9);
  return `${a}${n}${num}`;
}

/** The shape every generated name has. Registration refuses anything else, so
 *  nobody can smuggle in a hand-picked name. */
export function isGeneratedName(name: unknown): name is string {
  return typeof name === 'string' && /^[A-Z][a-z]+[A-Z][a-z]+\d{2,5}$/.test(name) && name.length <= 20;
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

// --- Party codes --------------------------------------------------------------

/** No 0/O, 1/I/L: a code read aloud or off a screenshot is never ambiguous. */
export const PARTY_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const PARTY_CODE_LENGTH = 6;
export function normalizePartyCode(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  const code = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return code.length === PARTY_CODE_LENGTH && [...code].every((c) => PARTY_CODE_ALPHABET.includes(c))
    ? code : '';
}
