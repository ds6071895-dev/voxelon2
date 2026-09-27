// CAPES: the wardrobe model — which capes exist, which ones you own, and which
// one you are wearing. Pure data and pure functions, no three.js and no DOM, so
// the server can import it the day capes become account-owned rather than
// local-only (the same shape `character.ts` keeps for cosmetics).
//
// THE CATALOG IS DELIBERATELY EMPTY. The old cosmetic cape — a palette index on
// `Cosmetics` that every player could simply cycle to — is gone; capes are
// becoming something you EARN, so nothing is grantable until that system lands.
// Everything below is already written for a populated catalog: add entries to
// `CAPES` and the wardrobe screen, persistence and equip rules all work as-is.

/** How rare a cape is. Drives the tile's accent colour and its sort order. */
export type CapeRarity = 'common' | 'rare' | 'epic' | 'legendary';

/** One cape in the catalog. `colors` is only what the wardrobe TILE paints —
 *  the in-world model arrives with the cape system itself. */
export interface Cape {
  /** Stable key. Persisted and sent over the wire, so never renumber these. */
  id: string;
  name: string;
  /** One line on the tile: where it comes from, or what it means to wear it. */
  blurb: string;
  rarity: CapeRarity;
  /** [cloth, trim] as 0xrrggbb, for the tile's swatch. */
  colors: [number, number];
}

/** Every cape in the game. Empty until the earned-cape system lands. */
export const CAPES: Cape[] = [];

/** The equipped id meaning "bare shoulders". Always available, never owned. */
export const NO_CAPE = '';

/** Rarest last, so a collection reads as a progression left to right. */
export const RARITY_ORDER: CapeRarity[] = ['common', 'rare', 'epic', 'legendary'];

/** Accent colour per rarity, shared by the tile ring and the rarity chip. */
export const RARITY_COLORS: Record<CapeRarity, number> = {
  common: 0x8493a6,
  rare: 0x3f7fd0,
  epic: 0x8a5fd6,
  legendary: 0xe0a423,
};

export function capeById(id: string): Cape | undefined {
  return CAPES.find((c) => c.id === id);
}

/** What a player owns and what they have on. Serialises as plain JSON. */
export interface Wardrobe {
  /** Catalog ids, deduped. Order is presentation-only (rarity sorts the grid). */
  owned: string[];
  /** A cape id from `owned`, or NO_CAPE. */
  equipped: string;
}

export function emptyWardrobe(): Wardrobe {
  return { owned: [], equipped: NO_CAPE };
}

/** Clamp an unknown blob (a stale save, a hand-edited localStorage entry, a
 *  hacked client) into a valid Wardrobe: unknown ids are dropped, and equipping
 *  something you do not own falls back to bare shoulders. */
export function sanitizeWardrobe(raw: unknown): Wardrobe {
  if (!raw || typeof raw !== 'object') return emptyWardrobe();
  const r = raw as { owned?: unknown; equipped?: unknown };
  const owned: string[] = [];
  if (Array.isArray(r.owned)) {
    for (const id of r.owned) {
      if (typeof id === 'string' && capeById(id) && !owned.includes(id)) owned.push(id);
    }
  }
  const equipped = typeof r.equipped === 'string' && owned.includes(r.equipped)
    ? r.equipped : NO_CAPE;
  return { owned, equipped };
}

/** The owned capes as catalog entries, rarest last. */
export function ownedCapes(w: Wardrobe): Cape[] {
  const out = w.owned.map(capeById).filter((c): c is Cape => !!c);
  out.sort((a, b) =>
    RARITY_ORDER.indexOf(a.rarity) - RARITY_ORDER.indexOf(b.rarity) ||
    a.name.localeCompare(b.name));
  return out;
}

/** You can always take a cape OFF; you can only put on one you own. */
export function canEquip(w: Wardrobe, id: string): boolean {
  return id === NO_CAPE || w.owned.includes(id);
}

/** Equip, purely — returns a new Wardrobe, or the same one if it is not yours. */
export function equipCape(w: Wardrobe, id: string): Wardrobe {
  if (!canEquip(w, id)) return w;
  return { owned: [...w.owned], equipped: id };
}

/** Grant a cape (the seam the future drop/reward system writes through). */
export function grantCape(w: Wardrobe, id: string): Wardrobe {
  if (!capeById(id) || w.owned.includes(id)) return w;
  return { owned: [...w.owned, id], equipped: w.equipped };
}
