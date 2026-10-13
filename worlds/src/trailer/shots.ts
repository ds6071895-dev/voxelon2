// The release edit. The picture and the score are cut from one file,
// timeline.json, at 120 BPM (a bar is two seconds): every game gets a title
// card and shots that show how it is played. Every location is a real Worlds build.
import timeline from './timeline.json';

export type Set = 'lake' | 'bedwars' | 'bridge' | 'duel' | 'parkour' | 'manor';
export type Action =
  | 'lake' | 'bw-island' | 'bw-forge' | 'bw-bridge' | 'bw-bed' | 'bw-fight'
  | 'br-arena' | 'br-duel' | 'br-goal' | 'du-arena' | 'du-fight'
  | 'pk-run' | 'pk-dragon' | 'pk-finish' | 'rs-manor' | 'rs-chase' | 'rs-rescue' | 'reel' | 'logo';
export interface Shot {
  id: string;
  set: Set;
  start: number;
  duration: number;
  action: Action;
  /** Game name chip shown with the first shot of each game. */
  title?: string;
  /** One line that explains what is happening. */
  label: string;
  piece?: 'rooftops' | 'waterfall';
  /** Sound cues, seconds from the start of the shot. */
  cues: readonly (readonly [number, string])[];
}
export const RELEASE = timeline.release;
export const DURATION = timeline.duration;
export const SHOTS = timeline.shots as unknown as readonly Shot[];

/** Release stills: clean frames (no captions) of the moments that sell each game. */
export const SCREENSHOTS = [
  { shot: 0, time: 2.5, name: '01-worlds-lake' },
  { shot: 1, time: 3.4, name: '02-bedwars-protect-your-bed' },
  { shot: 2, time: 2.6, name: '03-bedwars-forge-and-shop' },
  { shot: 3, time: 2.2, name: '04-bedwars-bridging' },
  { shot: 4, time: 2.3, name: '05-bedwars-breaking-the-bed' },
  { shot: 5, time: 2.3, name: '06-bedwars-knockback' },
  { shot: 7, time: 1.6, name: '07-the-bridge-duel' },
  { shot: 8, time: 2.9, name: '08-the-bridge-portal' },
  { shot: 10, time: 2.4, name: '09-duels-gunfight' },
  { shot: 11, time: 2.0, name: '10-parkour-run' },
  { shot: 12, time: 2.4, name: '11-parkour-dragon' },
  { shot: 13, time: 2.6, name: '12-parkour-sanctuary' },
  { shot: 15, time: 2.2, name: '13-rat-and-seek-chase' },
  { shot: 16, time: 1.8, name: '14-rat-and-seek-rescue' },
] as const;
