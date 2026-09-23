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
  'Crew Cut', 'Long', 'Mohawk', 'Bun', 'Ponytail', 'Side Part', 'Shaved',
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

/** Uniform colours. In a war the faction colour replaces this on the tunic
 *  (see buildAvatarBody), so these are what you wear off the front line. */
export const SHIRT_COLORS: Swatch[] = [
  { name: 'Olive Drab',   hex: 0x55603a },
  { name: 'Coyote',       hex: 0x8a6f4d },
  { name: 'Khaki',        hex: 0xa99a6b },
  { name: 'Ranger Green', hex: 0x4a5a3f },
  { name: 'Forest',       hex: 0x2f5a36 },
  { name: 'Desert Sand',  hex: 0xc2a878 },
  { name: 'Urban Grey',   hex: 0x6b7178 },
  { name: 'Navy',         hex: 0x2c3a5e },
  { name: 'Charcoal',     hex: 0x3a3e44 },
  { name: 'Crimson',      hex: 0x8e2d2d },
  { name: 'Azure',        hex: 0x2f5f9e },
  { name: 'Snow',         hex: 0xd6dadf },
];

export const PANTS_COLORS: Swatch[] = [
  { name: 'Olive Drab',   hex: 0x4b5334 },
  { name: 'Coyote',       hex: 0x7a6344 },
  { name: 'Khaki',        hex: 0x96895f },
  { name: 'Ranger Green', hex: 0x404e37 },
  { name: 'Slate',        hex: 0x3e4552 },
  { name: 'Black',        hex: 0x1d1f23 },
  { name: 'Desert Sand',  hex: 0xae9667 },
  { name: 'Urban Grey',   hex: 0x5d6269 },
  { name: 'Navy',         hex: 0x252f4a },
  { name: 'Brown',        hex: 0x4a3626 },
  { name: 'Pine',         hex: 0x24483a },
  { name: 'Snow',         hex: 0xc4c8cd },
];

export const HATS: string[] = [
  'None', 'Patrol Cap', 'Watch Cap', 'Beret', 'Boonie Hat', 'Combat Helmet',
  'Bandana', 'Officer Cap', 'Comms Headset', 'Headband', 'Night-Vision Helmet',
];

export const HAT_COLORS: Swatch[] = [
  { name: 'Olive Drab',   hex: 0x55603a },
  { name: 'Coyote',       hex: 0x8a6f4d },
  { name: 'Khaki',        hex: 0xa99a6b },
  { name: 'Ranger Green', hex: 0x4a5a3f },
  { name: 'Black',        hex: 0x24262b },
  { name: 'Urban Grey',   hex: 0x6b7178 },
  { name: 'Navy',         hex: 0x2c3a5e },
  { name: 'Maroon',       hex: 0x6e2430 },
  { name: 'Crimson',      hex: 0x9a3030 },
  { name: 'Azure',        hex: 0x3566a8 },
  { name: 'Snow',         hex: 0xdadde2 },
];

export const FACE_ACCESSORIES: string[] = [
  'None', 'Shooting Glasses', 'Aviators', 'Eyepatch', 'Face Wrap', 'Moustache',
  'Full Beard', 'War Paint', 'Scar',
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
    skin: Math.floor(rng() * SKIN_TONES.length),
    hairStyle: 0,
    hair: Math.floor(rng() * 7),          // natural hair shades only by default
    eyes: Math.floor(rng() * 4),
    shirt: Math.floor(rng() * 5),         // field colours, not dress ones
    pants: Math.floor(rng() * 4),
    // Everyone turns up in SOME kit: a patrol cap, a watch cap, a helmet or a
    // beret, in a field colour.
    hat: [1, 2, 5, 3][Math.floor(rng() * 4)], hatColor: Math.floor(rng() * 5),
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
