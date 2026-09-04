// CHARACTER cosmetics: a pure, compact model of every avatar customisation
// option (skin tone, hair style/colour, eyes, outfit colours, hats and face
// accessories). Everything is a small palette INDEX so the whole look
// serialises as a handful of ints — trivial to sanitize server-side, persist
// in account data and mirror to localStorage offline. Rendering lives in
// remoteplayers.ts (avatars) and the character screen (preview); this module
// has no three.js so the server can import it too.

import { mulberry32 } from './noise';

/** One full avatar look. Every field indexes the matching catalog below. */
export interface Cosmetics {
  skin: number;      // SKIN_TONES
  hairStyle: number; // HAIR_STYLES
  hair: number;      // HAIR_COLORS
  eyes: number;      // EYE_COLORS
  shirt: number;     // SHIRT_COLORS
  pants: number;     // PANTS_COLORS
  hat: number;       // HATS
  hatColor: number;  // HAT_COLORS
  face: number;      // FACE_ACCESSORIES
}

/** A named colour swatch (hex like 0xrrggbb). */
export interface Swatch { name: string; hex: number }

export const SKIN_TONES: Swatch[] = [
  { name: 'Porcelain', hex: 0xf6d7be },
  { name: 'Peach',     hex: 0xeec39a },
  { name: 'Honey',     hex: 0xd9a066 },
  { name: 'Tan',       hex: 0xc68642 },
  { name: 'Bronze',    hex: 0xa5683a },
  { name: 'Umber',     hex: 0x8d5524 },
  { name: 'Cocoa',     hex: 0x6b4226 },
  { name: 'Ebony',     hex: 0x4a2f1e },
];

export const HAIR_STYLES: string[] = [
  'Classic', 'Long', 'Mohawk', 'Buns', 'Ponytail', 'Bowl', 'Bald',
];

export const HAIR_COLORS: Swatch[] = [
  { name: 'Black',     hex: 0x241f1c },
  { name: 'Espresso',  hex: 0x3b2a20 },
  { name: 'Chestnut',  hex: 0x5c3a21 },
  { name: 'Auburn',    hex: 0x7c3f21 },
  { name: 'Ginger',    hex: 0xb35427 },
  { name: 'Blonde',    hex: 0xd9a94e },
  { name: 'Platinum',  hex: 0xe8dbb5 },
  { name: 'Silver',    hex: 0xb9bec7 },
  { name: 'Blue',      hex: 0x3a5fa8 },
  { name: 'Green',     hex: 0x3f7a37 },
  { name: 'Pink',      hex: 0xd66a9c },
  { name: 'Purple',    hex: 0x7a4fc4 },
];

export const EYE_COLORS: Swatch[] = [
  { name: 'Blue',   hex: 0x3a5fa8 },
  { name: 'Green',  hex: 0x4a7a3e },
  { name: 'Brown',  hex: 0x6b4a2e },
  { name: 'Teal',   hex: 0x40707a },
  { name: 'Amber',  hex: 0xc4842c },
  { name: 'Violet', hex: 0x8a5fd6 },
];

export const SHIRT_COLORS: Swatch[] = [
  { name: 'Crimson',  hex: 0xa83232 },
  { name: 'Rust',     hex: 0xb35427 },
  { name: 'Gold',     hex: 0xc99a18 },
  { name: 'Forest',   hex: 0x3f7a37 },
  { name: 'Mint',     hex: 0x5cb98a },
  { name: 'Teal',     hex: 0x2e7d84 },
  { name: 'Sky',      hex: 0x4a8fd0 },
  { name: 'Navy',     hex: 0x2c3e78 },
  { name: 'Violet',   hex: 0x7a4fc4 },
  { name: 'Magenta',  hex: 0xb0479a },
  { name: 'Charcoal', hex: 0x3a3f46 },
  { name: 'White',    hex: 0xdfe3e8 },
];

export const PANTS_COLORS: Swatch[] = [
  { name: 'Denim',    hex: 0x33415e },
  { name: 'Navy',     hex: 0x232c4a },
  { name: 'Charcoal', hex: 0x2e3238 },
  { name: 'Black',    hex: 0x1a1c20 },
  { name: 'Olive',    hex: 0x4a4a2e },
  { name: 'Brown',    hex: 0x4a3626 },
  { name: 'Sand',     hex: 0x9a8a62 },
  { name: 'Grey',     hex: 0x6a6f76 },
  { name: 'Maroon',   hex: 0x5e2430 },
  { name: 'Plum',     hex: 0x4a2a5e },
  { name: 'Pine',     hex: 0x24483a },
  { name: 'White',    hex: 0xcfd3d8 },
];

export const HATS: string[] = [
  'None', 'Cap', 'Beanie', 'Top Hat', 'Crown', 'Halo', 'Horns',
  'Cowboy', 'Wizard', 'Headband',
];

export const HAT_COLORS: Swatch[] = [
  { name: 'Red',      hex: 0xa83232 },
  { name: 'Orange',   hex: 0xc07030 },
  { name: 'Gold',     hex: 0xd8b32a },
  { name: 'Green',    hex: 0x3f7a37 },
  { name: 'Teal',     hex: 0x2e7d84 },
  { name: 'Blue',     hex: 0x3a5fa8 },
  { name: 'Purple',   hex: 0x7a4fc4 },
  { name: 'Pink',     hex: 0xd66a9c },
  { name: 'Black',    hex: 0x22242a },
  { name: 'White',    hex: 0xe8e8ec },
  { name: 'Brown',    hex: 0x6a4a2e },
];

export const FACE_ACCESSORIES: string[] = [
  'None', 'Glasses', 'Sunglasses', 'Eyepatch', 'Mask', 'Moustache', 'Monocle',
];

/** Category sizes, used by sanitize + the editor's cyclers. */
export const COSMETIC_RANGES: Record<keyof Cosmetics, number> = {
  skin: SKIN_TONES.length,
  hairStyle: HAIR_STYLES.length,
  hair: HAIR_COLORS.length,
  eyes: EYE_COLORS.length,
  shirt: SHIRT_COLORS.length,
  pants: PANTS_COLORS.length,
  hat: HATS.length,
  hatColor: HAT_COLORS.length,
  face: FACE_ACCESSORIES.length,
};

export const COSMETIC_KEYS = Object.keys(COSMETIC_RANGES) as (keyof Cosmetics)[];

/** The look every player starts with when they never customised: derived
 *  deterministically from their skin seed, so a player renders the same on
 *  every client — no hat or accessory until they pick one. */
export function defaultCosmetics(seed: number): Cosmetics {
  const rng = mulberry32(seed);
  return {
    skin: Math.floor(rng() * 4),          // lighter half keeps the classic look
    hairStyle: 0,
    hair: Math.floor(rng() * 7),          // natural hair shades only by default
    eyes: Math.floor(rng() * 4),
    shirt: Math.floor(rng() * SHIRT_COLORS.length),
    pants: Math.floor(rng() * 4),
    hat: 0, hatColor: Math.floor(rng() * HAT_COLORS.length),
    face: 0,
  };
}

/** Clamp an unknown blob into a valid Cosmetics (hacked clients / stale saves).
 *  Anything missing or out of range falls back to the seed-derived default. */
export function sanitizeCosmetics(raw: unknown, seed = 0): Cosmetics {
  const base = defaultCosmetics(seed);
  if (!raw || typeof raw !== 'object') return base;
  const r = raw as Record<string, unknown>;
  const out = { ...base };
  for (const k of COSMETIC_KEYS) {
    const v = r[k];
    if (typeof v === 'number' && Number.isFinite(v)) {
      const n = Math.floor(v);
      if (n >= 0 && n < COSMETIC_RANGES[k]) out[k] = n;
    }
  }
  return out;
}

/** A tiny random-look roller for the editor's 🎲 button. */
export function randomCosmetics(rng: () => number = Math.random): Cosmetics {
  const pick = (n: number): number => Math.floor(rng() * n);
  const c = {} as Cosmetics;
  for (const k of COSMETIC_KEYS) c[k] = pick(COSMETIC_RANGES[k]);
  return c;
}
