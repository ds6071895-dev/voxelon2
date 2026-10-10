import type { GameMode } from '../net/protocol';

/** Menu labels remain distinct from mode-specific in-match titles. */
export const MODE_LABELS: Readonly<Record<GameMode, string>> = {
  duels: 'Duels', bridge: 'The Bridge', parkour: 'Parkour', ratseek: 'Rat and Seek', bedwars: 'Bedwars',
};

export const BRIDGE_COLORS = [0xff5f76, 0x5aa8ff] as const;

export function formatMatchTime(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
