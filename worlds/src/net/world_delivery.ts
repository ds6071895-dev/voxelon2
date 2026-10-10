import type { ServerMsg } from './protocol';

/** Install identity, world, peers and corrections before their kit/state.
 * Ordering within each stage remains stable, including kit/state sequencing. */
export function orderWorldEntry<T extends { msg: ServerMsg }>(out: T[]): T[] {
  const stage = (msg: ServerMsg): number => {
    switch (msg.t) {
      case 'welcome': case 'identity': return 0;
      case 'duelArena': case 'pgArena': case 'rsArena': case 'bwArena': return 1;
      case 'join': return 2;
      case 'teleport': case 'respawned': case 'edit': case 'editBatch': return 3;
      default: return 4;
    }
  };
  return [...out].sort((a, b) => stage(a.msg) - stage(b.msg));
}
