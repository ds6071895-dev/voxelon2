// Per-stack icon tints for the vanilla modes: a potion's liquid takes its
// effect colour, and each spawn egg its mob's two colours (masks drawn in
// tile_art_vanilla.ts from the item_sprites templates).

import { setIconOverlays } from '../../icons';
import { VITEM } from '../items';
import { vt } from '../tiles';

const css = (c: number) => `#${c.toString(16).padStart(6, '0')}`;
/** Spawn egg [base, spots] per mob. */
const EGG: Record<string, [number, number]> = {
  zombie: [0x00afaf, 0x799c65], husk: [0x797061, 0xe6cc94], skeleton: [0xc1c1c1, 0x494949],
  creeper: [0x0da70b, 0x1c1c1c], silverfish: [0x8a8a8a, 0x3a3a3a], wolf: [0xd7d3d3, 0xceaf96],
  sheep: [0xe7e7e7, 0xffb5b5], chicken: [0xa1a1a1, 0xff0000],
};

setIconOverlays((id, stack) => {
  const d = VITEM[id];
  if (!d) return null;
  if (d.use === 'drink' || d.use === 'splash' || d.use === 'lingering') {
    const color = stack?.potion?.color;
    return color === undefined ? null : [[vt('potion_overlay'), css(color)]];
  }
  if (d.use === 'spawn_egg' && d.variant && EGG[d.variant]) {
    const [base, spots] = EGG[d.variant];
    return [[vt('egg_base_overlay'), css(base)], [vt('egg_spots_overlay'), css(spots)]];
  }
  return null;
});
