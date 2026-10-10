import type { DragonView } from '../parkour_dragon';

/** Warm the real flight model so it is already airborne at the cut. */
export function warmCaptureDragon(dragon: DragonView, order: number): void {
  for (let i = 0; i < 90; i++) {
    dragon.sync(order - 8 + i * .055, 1.5, 20000 + i * 33);
    dragon.update(1 / 30, 20000 + i * 33, 0, true);
  }
}
