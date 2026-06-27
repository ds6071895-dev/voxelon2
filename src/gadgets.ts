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
  | 'c4'        // placed breaching charge — heavy shield damage after a fuse
  | 'grapple'   // client movement — yanks you toward a targeted block
  | 'cover'     // deploys an instant blast wall (block edits)
  | 'sentry'    // drops an auto-targeting turret (reuses the turret system)
  | 'smoke'     // thrown smoke screen — cosmetic vision cloud
  | 'horn'      // war horn — a Commander/Officer triggers a faction combat buff
  | 'oil'       // oil bomb — a bigger AoE that spends oil
  | 'disguise'; // spy disguise — look like the enemy faction for a while

export interface GadgetDef {
  item: number;
  tile: number;
  name: string;
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
    cooldown: 1.2, maxStack: 16, consumed: true, radius: 5, damage: 22, fuse: 1.4,
  },
  [Item.C4]: {
    item: Item.C4, tile: Tile.C4, name: 'C4 Charge', kind: 'c4',
    cooldown: 2, maxStack: 8, consumed: true, radius: 3, damage: 200, fuse: 3,
  },
  [Item.GrapplingHook]: {
    item: Item.GrapplingHook, tile: Tile.GrapplingHook, name: 'Grappling Hook', kind: 'grapple',
    cooldown: 2.5, maxStack: 1, consumed: false, radius: 40,
  },
  [Item.DeployCover]: {
    item: Item.DeployCover, tile: Tile.DeployCover, name: 'Deployable Cover', kind: 'cover',
    cooldown: 4, maxStack: 8, consumed: true, radius: 2,
  },
  [Item.SentryKit]: {
    item: Item.SentryKit, tile: Tile.SentryKit, name: 'Sentry Kit', kind: 'sentry',
    cooldown: 5, maxStack: 4, consumed: true,
  },
  [Item.SmokeGrenade]: {
    item: Item.SmokeGrenade, tile: Tile.SmokeGrenade, name: 'Smoke Grenade', kind: 'smoke',
    cooldown: 2, maxStack: 16, consumed: true, radius: 6, fuse: 0.8, duration: 9,
  },
  [Item.WarHorn]: {
    item: Item.WarHorn, tile: Tile.WarHorn, name: 'War Horn', kind: 'horn',
    cooldown: 60, maxStack: 1, consumed: false, duration: 25,
  },
  [Item.OilBomb]: {
    item: Item.OilBomb, tile: Tile.OilBomb, name: 'Oil Bomb', kind: 'oil',
    cooldown: 6, maxStack: 8, consumed: true, radius: 7, damage: 30, fuse: 1.6, oilCost: 1,
  },
  [Item.SpyDisguise]: {
    item: Item.SpyDisguise, tile: Tile.SpyDisguise, name: 'Spy Disguise', kind: 'disguise',
    cooldown: 30, maxStack: 1, consumed: false, duration: 45,
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
