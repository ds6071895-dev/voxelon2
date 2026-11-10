// The release edit. The picture and the score are cut from one file,
// timeline.json, at 120 BPM (a bar is two seconds): every game gets a title
// card and shots that show how it is played. Every location is a real Worlds build.
import timeline from './timeline.json';

export type Set = 'lake' | 'rpg' | 'bridge' | 'duel' | 'parkour' | 'manor' | 'pillars' | 'disaster' | 'whack' | 'tnt' | 'podium';
export type Action =
  | 'lake'
  | 'lp-arena' | 'lp-bridge' | 'lp-fight'
  | 'dc-city' | 'dc-meteor' | 'dc-zombies'
  | 'pg-whack' | 'pg-tnt' | 'pg-podium'
  | 'br-arena' | 'br-duel' | 'br-goal' | 'du-arena' | 'du-fight'
  | 'pk-run' | 'pk-dragon' | 'pk-finish' | 'rs-manor' | 'rs-chase' | 'rs-rescue'
  | 'br-charge' | 'br-score' | 'du-standoff' | 'pk-leap' | 'pk-escape' | 'rs-sneak' | 'rs-catch'
  | 'cape-reveal' | 'cape-tiers' | 'reel' | 'logo'
  | 'rpg-dark' | 'rpg-dusk' | 'rpg-hero' | 'rpg-rise' | 'rpg';
export interface Shot {
  id: string;
  set: Set;
  start: number;
  duration: number;
  action: Action;
  /** Game name shown with the first shot of each game. */
  title?: string;
  /** One line that explains what is happening. */
  label: string;
  piece?: 'rooftops' | 'waterfall';
  /** Full-frame statements: [from, to, text], seconds from the start of the shot. */
  slates?: readonly (readonly [number, number, string])[];
  /** Sound cues, seconds from the start of the shot. */
  cues: readonly (readonly [number, string])[];
}
export const RELEASE = timeline.release;
export const RPG = timeline.rpg;
export const DURATION = timeline.duration;
export const SHOTS = timeline.shots as unknown as readonly Shot[];
export const shotIndex = (id: string): number => {
  const i = SHOTS.findIndex(s => s.id === id);
  if (i < 0) throw new Error(`Missing trailer shot ${id}`);
  return i;
};

/** Release stills: clean frames (no captions) of the moments that sell each game. */
export const SCREENSHOTS = [
  { shot: shotIndex('01-cold-open'), time: 3.0, name: '01-worlds-lake' },
  { shot: shotIndex('02-pillars-arena'), time: 2.2, name: '02-lucky-pillars-arena' },
  { shot: shotIndex('04-pillars-fight'), time: 2.4, name: '03-lucky-pillars-knockback' },
  { shot: shotIndex('06-disaster-meteor'), time: 2.5, name: '04-disaster-city-meteor' },
  { shot: shotIndex('07-disaster-zombies'), time: 2.0, name: '05-disaster-city-zombies' },
  { shot: shotIndex('08-party-whack'), time: 2.3, name: '06-party-games-whack-a-mole' },
  { shot: shotIndex('09-party-tnt'), time: 2.6, name: '07-party-games-tnt-run' },
  { shot: shotIndex('11-bridge-charge'), time: 2.3, name: '08-the-bridge-charge' },
  { shot: shotIndex('13-duels-standoff'), time: 3.15, name: '09-duels-gunfight' },
  { shot: shotIndex('14-parkour-leap'), time: 3.0, name: '10-parkour-dragon' },
  { shot: shotIndex('16-ratseek-sneak'), time: 2.0, name: '11-rat-and-seek-sneak' },
  { shot: shotIndex('18-cape-reveal'), time: 4.2, name: '12-capes-legendary' },
  { shot: shotIndex('19-cape-tiers'), time: 3.0, name: '13-capes-tiers' },
] as const;

/** Branded hero frames and the end cards. */
export const HERO_FRAMES = {
  worlds: { shot: shotIndex('02-pillars-arena'), time: 2.2 },
  thumbnail: { shot: shotIndex('06-disaster-meteor'), time: 2.5 },
  endCard: { shot: shotIndex('21-release'), time: 4.6 },
  rpgCard: { shot: shotIndex('26-rpg-title'), time: 7.4 },
} as const;
