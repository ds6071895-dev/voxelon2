// VOXELON multiplayer wire protocol: message shapes + shared constants,
// plus username and skin helpers. Imported by BOTH the browser client and
// the Node server, so it must stay free of DOM and Node APIs.

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
}

// --- client -> server -------------------------------------------------------
export type ClientMsg =
  | { t: 'hello' }
  | { t: 'xform'; x: number; y: number; z: number; yaw: number; pitch: number }
  | { t: 'edit'; x: number; y: number; z: number; block: number }
  | { t: 'attack'; target: number }
  | { t: 'selfhurt'; amount: number }   // fall/drown damage, applied by server
  | { t: 'respawn' };

// --- server -> client -------------------------------------------------------
export type ServerMsg =
  | {
      t: 'welcome'; id: number; seed: number; username: string;
      players: PlayerInfo[]; edits: [string, number][];
    }
  | { t: 'join'; player: PlayerInfo }
  | { t: 'leave'; id: number }
  | { t: 'snapshot'; players: PlayerSnapshot[] }
  | { t: 'edit'; x: number; y: number; z: number; block: number }
  | { t: 'hurt'; health: number; dead: boolean; by: number;
      kx: number; ky: number; kz: number }
  | { t: 'respawned'; x: number; y: number; z: number; health: number }
  | { t: 'killfeed'; killer: string; victim: string };

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
