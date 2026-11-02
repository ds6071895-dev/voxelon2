// The generic host the vanilla engines (Lucky Pillars, Disaster City, Party
// Games) run against. server_core owns one ModeHost per world and routes
// `mAct` to the engine; engines never touch sockets, the queue or parties.
// Same shape as Rat and Seek's RsHost, plus fills, move
// profiles, bots joining mid-setup and world switches (Party Games rounds).

import type { EngineMode, ServerMsg } from './protocol';
import type { WorldKind } from '../multiverse';
import type { FillSpec } from '../vanilla/fill';
import type { MAction, MPayload, MoveProfile } from '../vanilla/messages';

export interface EngineBody {
  x: number; y: number; z: number; yaw: number; pitch: number;
  health: number; dead: boolean; held?: number; sneaking?: boolean; bot: boolean;
}
export interface Edit { x: number; y: number; z: number; block: number }

export interface ModeHost {
  nowMs(): number;
  body(id: number): EngineBody | undefined;
  name(id: number): string;
  /** Engine payload to one player (bots are skipped). */
  send(id: number, d: MPayload): void;
  broadcast(d: MPayload): void;
  /** Raw protocol message (join/leave/teleport go through the helpers below). */
  sendRaw(id: number, msg: ServerMsg): void;
  getBlock(x: number, y: number, z: number): number;
  setBlock(x: number, y: number, z: number, block: number): void;
  setBlocks(edits: Edit[]): void;
  fill(f: FillSpec): Edit[];
  setHealth(id: number, health: number, dead: boolean): void;
  /** Knock a body: authorises the launch for movement validation. */
  impulse(id: number, kx: number, ky: number, kz: number, by: number, health: number): void;
  /** Set a body's velocity (blocks/s) without a hit: tornado spin, waves, quakes. */
  launch(id: number, vx: number, vy: number, vz: number, add?: boolean): void;
  teleport(id: number, x: number, y: number, z: number, yaw?: number, health?: number): void;
  /** Bots move themselves through this. */
  drive(id: number, pose: { x: number; y: number; z: number; yaw: number; pitch: number; held?: number; swing?: boolean; sneaking?: boolean }): void;
  setMoveProfile(id: number, profile: MoveProfile): void;
  /** Block changes only this player sees (Party Games' private pads). The
   *  shared world is untouched; a world switch drops them. */
  sendBlocks(id: number, edits: Edit[]): void;
  /** Swap this match into a new world (Party Games between minigames). Every
   *  member is re-sent the arena at their engine-chosen spawn. */
  switchWorld(kind: WorldKind, seed: number, spawns: Map<number, { x: number; y: number; z: number; yaw: number }>): void;
}

export interface EngineSetup {
  players: { id: number; bot: boolean; skill?: number }[];
  /** Party leader when launched by a party (Party Games host); null from the queue. */
  leader: number | null;
  seed: number;
  /** Party Games host settings. */
  options?: unknown;
}

export interface ModeEngine {
  readonly mode: EngineMode;
  /** The world the match starts in. */
  readonly world: { kind: WorldKind; seed: number };
  spawnOf(id: number): { x: number; y: number; z: number; yaw: number };
  /** Movement bounds for the server's transform validation. */
  bounds(): { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number };
  ready(id: number): void;
  leave(id: number): void;
  handle(id: number, a: MAction): void;
  tick(dt: number): void;
  canMove(id: number): boolean;
  /** Eliminated/spectating bodies are hidden from everyone else. */
  hidden(id: number): boolean;
  isOver(): boolean;
  lingerSeconds(): number;
  /** Adaptive skill to remember for the humans a bot faced. */
  botRating(botId: number): { rating: number; against: number[] } | null;
  dispose(): void;
}

export interface ModeDef {
  mode: EngineMode;
  title: string;
  /** The world a match with this setup starts in (decided before the engine exists). */
  world(setup: EngineSetup): { kind: WorldKind; seed: number };
  create(host: ModeHost, setup: EngineSetup): ModeEngine;
}

const DEFS = new Map<EngineMode, ModeDef>();
export function registerMode(def: ModeDef): void { DEFS.set(def.mode, def); }
export function modeDef(mode: EngineMode): ModeDef | undefined { return DEFS.get(mode); }
