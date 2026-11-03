// Wire contract of the vanilla engines (Lucky Pillars, Disaster City, Party
// Games). Clients send `mAct { a: MAction }`; engines answer with
// `m { d: MPayload }`. Engine-specific snapshots ride in `state`.

import type { VStack } from './stack';
import type { PillarsState } from '../pillars_rules';
import type { DisasterState } from '../disaster_rules';
import type { MinigamesState } from '../minigames_state';

export interface BlockHit { x: number; y: number; z: number; nx: number; ny: number; nz: number; hitY: number }
export type ClickMode = 'pick' | 'quick' | 'swap' | 'drag' | 'collect' | 'drop' | 'offhand';

export type MAction =
  | { k: 'select'; slot: number }
  /** Left-click a player (`target`) or an entity (`ent`). */
  | { k: 'attack'; target?: number; ent?: number }
  /** Right-click pressed: place, use an item, start eating/drawing, use a block or entity. */
  | { k: 'use'; slot: number; block?: BlockHit; ent?: number; yaw: number; pitch: number; offhand?: boolean }
  /** Right-click released (bows, crossbows, tridents, shields, eating). */
  | { k: 'useEnd'; slot: number; yaw: number; pitch: number }
  /** Mining: start/continue on a block; the server owns the elapsed time. */
  | { k: 'dig'; x: number; y: number; z: number }
  | { k: 'digStop' }
  /** Inventory window clicks (see inventory_model.ts). */
  | { k: 'click'; win: number; slot: number; button: 0 | 1; mode: ClickMode; rev: number; hotbar?: number }
  | { k: 'openInv' }
  | { k: 'closeWin'; win: number }
  | { k: 'swapHands' }
  /** A choice in a server-described menu. */
  | { k: 'menu'; menu: string; id: string; value?: string | number }
  /** Movement abilities the server must authorise (elytra start, double jump). */
  | { k: 'glide'; on: boolean }
  | { k: 'jump2' }
  | { k: 'dismount' };

/** One active status effect as shown on the HUD. */
export interface EffectView { id: string; amp: number; ticks: number }

/** The player's own vitals and inventory-adjacent HUD state. */
export interface SelfView {
  hp: number; maxHp: number; absorption: number;
  food: number; saturation: number; air: number; maxAir: number;
  armor: number; toughness: number;
  effects: EffectView[];
  /** 0..1 progress bar (Lucky Pillars: next item; disasters: next wave). */
  bar?: number; barLevel?: number;
  /** Fire ticks remaining, freeze ticks (0..140+). */
  fire: number; freeze: number;
  /** Movement modifiers the client applies to its Player. */
  move: MoveProfile;
  /** True while in spectator mode (eliminated). */
  spectator: boolean;
}

/** Client movement tuning derived from effects, attributes and equipment. */
export interface MoveProfile {
  speed: number;        // multiplier on walk/sprint speed
  jump: number;         // jump boost level (0 = none)
  gravity: number;      // multiplier (moon gravity 0.375)
  slowFall: boolean;
  levitation: number;   // 0 = none, else amplifier + 1
  scale: number;        // body scale (Giants 1.5, Tiny Town 0.5)
  canSprint: boolean;
  safeFall: number;     // extra safe fall distance
  frozen: boolean;      // countdown freeze
  elytra: boolean;      // wearing a usable elytra
  noJump?: boolean;
  doubleJumps?: number;
  gliding?: boolean;
  /** Riding this boat entity: the client steers it (vanilla/boat.ts). */
  boat?: number;
}
export const DEFAULT_MOVE: MoveProfile = {
  speed: 1, jump: 0, gravity: 1, slowFall: false, levitation: 0, scale: 1, canSprint: true, safeFall: 0, frozen: false, elytra: false,
};

export interface WindowView {
  id: number;
  kind: 'inventory' | 'crafting' | 'furnace' | 'smoker' | 'chest' | 'barrel';
  title: string;
  /** Container slots (crafting grid + result, furnace in/fuel/out, chest 27). */
  slots: (VStack | null)[];
  /** Furnace progress 0..1 and fuel left 0..1. */
  cook?: number; burn?: number;
}

export interface InvView {
  /** 0-8 hotbar, 9-35 main, 36-39 armor (head..feet), 40 offhand, 41-44 2x2 grid, 45 result. */
  slots: (VStack | null)[];
  selected: number;
  cursor: VStack | null;
  rev: number;
}

/** A server-described menu (ghost tricks, survival crafting, party host...). */
export interface MenuView {
  menu: string;
  title: string;
  sub?: string;
  items: { id: string; icon: number; label: string; sub?: string; disabled?: boolean; active?: boolean; count?: number; tag?: string }[];
}

/** One-shot effects: sounds, particles, lightning, explosions, item breaks. */
export type FxEvent =
  | { f: 'sound'; s: string; x?: number; y?: number; z?: number; pitch?: number; vol?: number }
  | { f: 'burst'; kind: string; x: number; y: number; z: number; color?: number; n?: number }
  | { f: 'lightning'; x: number; y: number; z: number }
  | { f: 'explode'; x: number; y: number; z: number; power: number }
  | { f: 'firework'; x: number; y: number; z: number; color: number }
  | { f: 'totem'; id: number }
  | { f: 'swing'; id: number }
  | { f: 'hurt'; id: number; ent?: boolean }
  | { f: 'break'; x: number; y: number; z: number; block: number };

/** Server-simulated entities (mobs, items, projectiles, vehicles, falling
 *  blocks). `spawn` carries full views; `u` a flat update array of
 *  [id, x*100, y*100, z*100, yaw*100, flags] per moving entity. */
export interface EntityView {
  id: number; kind: string; x: number; y: number; z: number; yaw: number; pitch?: number;
  vx?: number; vy?: number; vz?: number;
  flags: number;
  /** Item stack (dropped items), block id (falling blocks), variant, owner. */
  item?: VStack; block?: number; variant?: string; owner?: number; name?: string; color?: number; size?: number;
  hp?: number; rider?: number;
}
export const ENT_FLAG = { burning: 1, baby: 2, glowing: 4, invisible: 8, charged: 16, tamed: 32, sitting: 64, angry: 128, swing: 256, hurt: 512, fuse: 1024 } as const;

export type MPayload =
  | { k: 'state'; s: PillarsState | DisasterState | MinigamesState }
  | { k: 'self'; v: SelfView }
  | { k: 'inv'; v: InvView }
  | { k: 'win'; v: WindowView | null }
  | { k: 'ent'; st: number; spawn?: EntityView[]; u?: number[]; gone?: number[]; dead?: number[]; reset?: boolean }
  | { k: 'fx'; fx: FxEvent[] }
  | { k: 'title'; title: string; sub: string; color: string; ms: number }
  | { k: 'bar'; text: string; color?: string }
  | { k: 'feed'; text: string; tone?: string }
  | { k: 'menu'; v: MenuView | null }
  | { k: 'nack'; x: number; y: number; z: number }
  | { k: 'impulse'; vx: number; vy: number; vz: number; set?: boolean }
  /** Got into (`ent`) or out of (null) a boat. */
  | { k: 'ride'; ent: number | null; x?: number; y?: number; z?: number; yaw?: number }
  | { k: 'dig'; x: number; y: number; z: number; progress: number }
  | { k: 'mount'; ent: number | null };
