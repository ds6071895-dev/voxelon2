// GADGETS (Phase 8) — a reusable "toy" framework on top of the item system: each
// gadget is an inventory item with a cooldown, a craft recipe, and a typed
// effect the client/server route on use. The first batch is nine war toys
// (grenade, C4, grapple, cover, sentry, smoke, war horn, oil bomb, spy disguise).
// PURE + transport-agnostic: the registry, the cooldown tracker, and the AoE
// falloff live here so the offline client and the authoritative server agree.

import { Item } from './items';
import { Tile } from './blocks';

export type GadgetKind =
  | 'frag'      // thrown explosive — server AoE damage on detonation
  | 'c4'        // planted timed charge
  | 'grapple'   // client movement — yanks you toward a targeted block
  | 'cover'     // deploys an instant blast wall (block edits)
  | 'sentry'    // drops an auto-targeting turret (reuses the turret system)
  | 'smoke'     // thrown smoke screen — cosmetic vision cloud
  | 'horn'      // war horn — a Commander/Officer triggers a faction combat buff
  | 'oil'       // oil bomb — a bigger AoE that spends oil
  | 'disguise'  // spy disguise — look like the enemy faction for a while
  | 'jump';     // bounce pad — a single-use, ~20-block vertical launch

/** Throwable gadget kinds get an in-air tossed item + a detonation point. */
export const THROWN_KINDS = new Set<GadgetKind>(['frag', 'oil', 'smoke']);

export interface GadgetDef {
  item: number;
  tile: number;
  name: string;
  /** One-line description shown under the name + in the crafting guide. */
  desc: string;
  kind: GadgetKind;
  /** Seconds between uses (per gadget id). */
  cooldown: number;
  /** Inventory stack ceiling. */
  maxStack: number;
  /** Is the gadget item itself consumed on use? (placeables/throwables yes.) */
  consumed: boolean;
  // Effect params (only the relevant ones are set per gadget).
  radius?: number;   // AoE / deploy radius (blocks)
  damage?: number;   // base AoE damage at the centre
  fuse?: number;     // seconds before detonation
  duration?: number; // smoke / disguise / buff seconds
  oilCost?: number;  // oil barrels consumed (oil bomb)
}

/** The nine launch gadgets. Tuned cosmetic-neutral (no straight power upgrades
 *  over guns) — they trade utility, not raw DPS. */
export const GADGETS: Record<number, GadgetDef> = {
  [Item.Grenade]: {
    item: Item.Grenade, tile: Tile.Grenade, name: 'Frag Grenade', kind: 'frag',
    desc: 'Throw it — explodes for area damage on enemies. Left-click to toss.',
    cooldown: 1.2, maxStack: 16, consumed: true, radius: 5, damage: 22, fuse: 1.4,
  },
  [Item.C4]: {
    item: Item.C4, tile: Tile.C4, name: 'C4 Charge', kind: 'c4',
    desc: 'Plant it on a block, then run before its timed blast.',
    cooldown: 4, maxStack: 8, consumed: true, radius: 5, damage: 34, fuse: 3,
  },
  [Item.GrapplingHook]: {
    item: Item.GrapplingHook, tile: Tile.GrapplingHook, name: 'Grappling Hook', kind: 'grapple',
    // Short cooldown on purpose: the hook is only fun if you can CHAIN it, so
    // the swing you just released can be re-anchored before you lose the speed.
    desc: 'Fire a line and swing. SPACE to let go and launch — you keep the speed.',
    cooldown: 1.1, maxStack: 1, consumed: false, radius: 48,
  },
  [Item.DeployCover]: {
    item: Item.DeployCover, tile: Tile.DeployCover, name: 'Deployable Cover', kind: 'cover',
    desc: 'Drops an instant blast wall in front of you for cover.',
    cooldown: 4, maxStack: 8, consumed: true, radius: 2,
  },
  [Item.SentryKit]: {
    item: Item.SentryKit, tile: Tile.SentryKit, name: 'Sentry Kit', kind: 'sentry',
    desc: 'Deploys an auto-targeting turret. Load it with cannonballs + oil.',
    cooldown: 5, maxStack: 4, consumed: true,
  },
  [Item.SmokeGrenade]: {
    item: Item.SmokeGrenade, tile: Tile.SmokeGrenade, name: 'Smoke Grenade', kind: 'smoke',
    desc: 'Throw it for a vision-blocking smoke screen. No damage — pure cover.',
    cooldown: 2, maxStack: 16, consumed: true, radius: 6, fuse: 0.8, duration: 9,
  },
  [Item.WarHorn]: {
    item: Item.WarHorn, tile: Tile.WarHorn, name: 'War Horn', kind: 'horn',
    desc: 'Commanders/Officers only: rally the faction with a combat buff.',
    cooldown: 60, maxStack: 1, consumed: false, duration: 25,
  },
  [Item.OilBomb]: {
    item: Item.OilBomb, tile: Tile.OilBomb, name: 'Oil Bomb', kind: 'oil',
    desc: 'A big oil-fuelled blast (spends 1 oil barrel). Wider than a grenade.',
    cooldown: 6, maxStack: 8, consumed: true, radius: 7, damage: 30, fuse: 1.6, oilCost: 1,
  },
  [Item.SpyDisguise]: {
    item: Item.SpyDisguise, tile: Tile.SpyDisguise, name: 'Spy Disguise', kind: 'disguise',
    desc: 'Look like the enemy to other players for a while — infiltrate + spy.',
    cooldown: 30, maxStack: 1, consumed: false, duration: 45,
  },
  [Item.JumpBoost]: {
    item: Item.JumpBoost, tile: Tile.JumpBoost, name: 'Bounce Pad', kind: 'jump',
    desc: 'ONE USE: spring ~20 blocks straight up. No fall damage from the landing.',
    cooldown: 0.5, maxStack: 8, consumed: true,
  },
};

export function isGadget(id: number): boolean {
  return GADGETS[id] !== undefined;
}
export function gadgetOf(id: number): GadgetDef | undefined {
  return GADGETS[id];
}

/**
 * AoE damage with linear falloff from the blast centre: full `base` at distance
 * 0, zero at/after `radius`. Shared by frag + oil bomb so the server and the
 * client preview agree. Returns a rounded, non-negative number.
 */
export function falloffDamage(base: number, dist: number, radius: number): number {
  if (!Number.isFinite(base) || !Number.isFinite(dist) || !Number.isFinite(radius) || radius <= 0) return 0;
  if (dist >= radius) return 0;
  return Math.max(0, Math.round(base * (1 - dist / radius)));
}

/**
 * Per-gadget cooldown tracker (pure). The client gates use locally; the server
 * runs its own instance per player so a hacked client can't spam past a gadget's
 * cooldown. `now` is a seconds clock.
 */
export class GadgetCooldowns {
  private readonly next = new Map<number, number>();

  ready(id: number, now: number): boolean {
    return now >= (this.next.get(id) ?? 0);
  }
  /** Seconds until the gadget is usable again (0 = ready now). */
  remaining(id: number, now: number): number {
    return Math.max(0, (this.next.get(id) ?? 0) - now);
  }
  /** Mark a gadget used: starts its cooldown. Returns false if it wasn't ready. */
  use(id: number, now: number): boolean {
    if (!this.ready(id, now)) return false;
    const def = GADGETS[id];
    this.next.set(id, now + (def ? def.cooldown : 0));
    return true;
  }
  clear(): void { this.next.clear(); }
}
