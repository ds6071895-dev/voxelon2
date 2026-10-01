// The release edit: seconds at 120 BPM. Every location is a real Worlds build.
export type Set = 'lake' | 'bridge' | 'duel' | 'parkour' | 'manor';
export interface Shot {
  id: string;
  set: Set;
  start: number;
  duration: number;
  label: string;
  action: 'scenery' | 'bridge' | 'duel' | 'run' | 'dragon' | 'rats' | 'rescue' | 'finish' | 'logo';
  piece?: 'rooftops' | 'waterfall';
}
export const RELEASE = 'NOVEMBER 2026';
export const DURATION = 94;
export const SHOTS: readonly Shot[] = [
  { id: '01-worlds-awaken', set: 'lake', start: 0, duration: 8, label: 'Every world…', action: 'scenery' },
  { id: '02-bridge-reveal', set: 'bridge', start: 8, duration: 6, label: '…is a new challenge.', action: 'scenery' },
  { id: '03-bridge-showdown', set: 'bridge', start: 14, duration: 6, label: 'THE BRIDGE', action: 'bridge' },
  { id: '04-duels-reveal', set: 'duel', start: 20, duration: 4, label: 'DUELS', action: 'scenery' },
  { id: '05-duels-action', set: 'duel', start: 24, duration: 8, label: 'Make your move.', action: 'duel' },
  { id: '06-rooftop-runners', set: 'parkour', start: 32, duration: 6, label: 'PARKOUR', action: 'run', piece: 'rooftops' },
  { id: '07-waterfall-canyon', set: 'parkour', start: 38, duration: 6, label: 'Keep moving.', action: 'run', piece: 'waterfall' },
  { id: '08-dragon-pursuit', set: 'parkour', start: 44, duration: 6, label: 'Don’t look back.', action: 'dragon', piece: 'rooftops' },
  { id: '09-crooked-manor', set: 'manor', start: 50, duration: 4, label: 'RAT AND SEEK', action: 'scenery' },
  { id: '10-rat-pursuit', set: 'manor', start: 54, duration: 6, label: 'Small heroes. Big trouble.', action: 'rats' },
  { id: '11-rat-rescue', set: 'manor', start: 60, duration: 2, label: '', action: 'rescue' },
  { id: '12-bridge-finale', set: 'bridge', start: 62, duration: 3, label: 'Bring your friends.', action: 'bridge' },
  { id: '13-duels-finale', set: 'duel', start: 65, duration: 3, label: '', action: 'duel' },
  { id: '14-dragon-finale', set: 'parkour', start: 68, duration: 3, label: '', action: 'dragon', piece: 'waterfall' },
  { id: '15-sanctuary', set: 'parkour', start: 71, duration: 3, label: 'Find your next world.', action: 'finish' },
  { id: '16-release', set: 'lake', start: 74, duration: 8, label: RELEASE, action: 'logo' },
  { id: '17-early-access', set: 'lake', start: 82, duration: 12, label: '', action: 'logo' },
];
export const SCREENSHOTS = [
  { shot: 0, time: 4, name: '01-worlds-lake' },
  { shot: 1, time: 3, name: '02-the-bridge' },
  { shot: 2, time: 4, name: '03-bridge-showdown' },
  { shot: 4, time: 4, name: '04-duels' },
  { shot: 7, time: 3, name: '05-parkour' },
  { shot: 6, time: 3, name: '06-waterfall-canyon' },
  { shot: 9, time: 3, name: '07-rat-and-seek' },
  { shot: 10, time: 1, name: '08-rat-rescue' },
] as const;
