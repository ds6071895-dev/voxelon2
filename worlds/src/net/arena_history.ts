export interface ArenaTrackSample { at: number; x: number; y: number; z: number }
/** Seconds retained for rifle travel, rendered interpolation and a slow RTT. */
export const DUEL_TRACK_WINDOW = 1.2;

export function recordArenaPosition(track: ArenaTrackSample[], at: number, p: { x: number; y: number; z: number }): void {
  const sample = { at, x: p.x, y: p.y, z: p.z };
  // Multiple transforms within one simulation tick have no elapsed time.
  if (track[track.length - 1]?.at === at) track[track.length - 1] = sample;
  else track.push(sample);
  let drop = 0;
  while (drop < track.length && at - track[drop].at > DUEL_TRACK_WINDOW) drop++;
  if (drop) track.splice(0, drop);
}

/** World history uses seconds, including the dragon's target lead. */
export function arenaVelocity(track: readonly ArenaTrackSample[]): { x: number; y: number; z: number } {
  const a = track[track.length - 2], b = track[track.length - 1];
  if (!a || !b || b.at <= a.at) return { x: 0, y: 0, z: 0 };
  const dt = b.at - a.at;
  return { x: (b.x - a.x) / dt, y: (b.y - a.y) / dt, z: (b.z - a.z) / dt };
}
