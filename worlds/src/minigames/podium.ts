// The finale (source PodiumStage): a quartz amphitheatre at dusk. Gold,
// silver and copper steps in front of an arched backdrop with stained-glass
// windows; a red carpet, bleachers, lamp posts and planters round a plaza.

import { Deco, E, N, S, W } from '../vanilla/deco';
import { BASE_Y, type ArenaDef } from './arena';

/** Top surfaces (stand-on heights) of the three steps, local. */
export const STEPS = [[0, 4, -6], [-4, 3, -6], [4, 2, -6]] as const;
export const PODIUM_TIME = 12800;

export function podiumStep(place: number): { x: number; y: number; z: number; yaw: number } {
  const s = STEPS[place];
  // Source yaw 0 faces south (+z): toward the crowd.
  return { x: s[0] + .5, y: BASE_Y + s[1], z: s[2] + .5, yaw: Math.PI };
}
export function podiumCrowd(index: number, total: number): { x: number; y: number; z: number; yaw: number } {
  const perRow = 7, row = Math.floor(index / perRow);
  const inRow = Math.min(perRow, total - row * perRow);
  const x = (index % perRow - (inRow - 1) / 2) * 1.6;
  return { x: x + .5, y: BASE_Y + 1, z: 3.5 + row * 1.8, yaw: 0 };
}
export const PODIUM_VIEW = { x: .5, y: BASE_Y + 7, z: 16.5, yaw: 0 };

function step(d: Deco, cx: number, height: number, top: string, banner: string): void {
  for (let x = cx - 1; x <= cx + 1; x++) {
    for (let z = -7; z <= -5; z++) {
      for (let y = 1; y < height; y++) d.set(x, y, z, 'smooth_quartz');
      d.set(x, height - 1, z, top);
    }
    d.stairs(x, 1, -4, 'quartz_stairs', N, false);
  }
  d.column(cx - 1, 1, -7, height - 1, 'quartz_pillar');
  d.column(cx + 1, 1, -7, height - 1, 'quartz_pillar');
  d.wallBanner(cx, Math.max(1, height - 2), -8, banner, N);
  if (height > 3) d.wallBanner(cx, height - 2, -4, banner, S);
}
function window(d: Deco, cx: number, pane: string): void {
  for (let x = cx - 2; x <= cx + 2; x++) {
    for (let y = 4; y <= 10; y++) if (!(y === 10 && Math.abs(x - cx) === 2)) d.set(x, y, -11, pane);
    d.set(x, 3, -10, 'quartz_slab');
  }
  d.stairs(cx - 2, 10, -10, 'quartz_stairs', E, true);
  d.stairs(cx + 2, 10, -10, 'quartz_stairs', W, true);
  d.set(cx, 11, -10, 'chiseled_quartz_block');
  d.lantern(cx, 10, -10, true);
}

export const PODIUM: ArenaDef = {
  id: 'podium',
  version: 3,
  build(d) {
    for (let x = -24; x <= 24; x++) for (let z = -24; z <= 24; z++) {
      const r = Math.sqrt(x * x + z * z);
      if (r > 24.5) continue;
      d.fill(x, -3, z, x, -1, z, 'stone_bricks');
      let top: string;
      if (r > 23.5) top = 'chiseled_stone_bricks';
      else if (Math.abs(r - 18) < .5 || Math.abs(r - 11) < .5) top = 'quartz_bricks';
      else if (Math.abs(r - 18) < 1.5 || Math.abs(r - 11) < 1.5) top = 'smooth_quartz';
      else top = ((x + z) & 1) === 0 ? 'polished_andesite' : 'polished_diorite';
      d.set(x, 0, z, top);
    }
    for (let layer = 1; layer <= 6; layer++) d.disc(0, -3 - layer, 0, 24 - layer * 3.2, layer % 2 === 0 ? 'stone' : 'andesite');
    for (let z = -3; z <= 12; z++) { d.data(0, 1, z, 'red_carpet'); d.data(-1, 1, z, 'red_carpet'); d.data(1, 1, z, 'red_carpet'); }
    d.set(-2, 0, 0, 'gold_block');
    d.set(2, 0, 0, 'gold_block');
    step(d, 0, 4, 'gold_block', 'yellow');
    step(d, -4, 3, 'iron_block', 'light_gray');
    step(d, 4, 2, 'waxed_copper_block', 'orange');
    for (let x = -12; x <= 12; x++) {
      for (let y = 1; y <= 13; y++) { d.set(x, y, -11, 'quartz_bricks'); d.set(x, y, -12, 'smooth_quartz'); }
      d.stairs(x, 14, -11, 'quartz_stairs', N, false);
      d.set(x, 14, -12, 'chiseled_quartz_block');
      d.stairs(x, 15, -12, 'quartz_stairs', N, false);
    }
    for (const x of [-12, -6, 6, 12]) {
      d.column(x, 1, -10, 13, 'quartz_pillar');
      d.set(x, 14, -10, 'chiseled_quartz_block');
      d.lantern(x, 15, -10, false);
    }
    window(d, -9, 'yellow_stained_glass_pane');
    window(d, 0, 'orange_stained_glass_pane');
    window(d, 9, 'magenta_stained_glass_pane');
    d.wallBanner(-6, 11, -9, 'purple', S);
    d.wallBanner(6, 11, -9, 'purple', S);
    d.wallBanner(-12, 11, -9, 'yellow', S);
    d.wallBanner(12, 11, -9, 'yellow', S);
    for (const side of [-1, 1]) for (let i = 0; i < 4; i++) {
      const x = side * (15 + i), z = -8 + i * 4;
      d.column(x, 1, z, 6, 'quartz_pillar');
      d.set(x, 7, z, 'chiseled_quartz_block');
      d.lantern(x, 8, z, false);
    }
    d.bleachers(N, 13, -9, 9, 1, 4, 'spruce_stairs', 'spruce_planks');
    for (const x of [-10, 10]) {
      for (let y = 1; y <= 4; y++) for (let z = 13; z <= 16; z++) if (y <= z - 12) d.set(x, y, z, 'stripped_spruce_log');
      d.lampPost(x, 5, 16, 2, 'spruce_fence', false);
    }
    d.planter(-9, 1, 2, -6, 5, 'spruce_trapdoor');
    d.planter(6, 1, 2, 9, 5, 'spruce_trapdoor');
    for (const [x, z] of [[-14, 6], [14, 6], [-20, -2], [20, -2], [-8, 18], [8, 18]]) d.lampPost(x, 1, z, 3, 'dark_oak_fence', false);
    d.tree(-19, 1, -12, 4, 2.6, 'cherry_log', 'cherry_leaves');
    d.tree(19, 1, -12, 4, 2.6, 'cherry_log', 'cherry_leaves');
    d.tree(-21, 1, 10, 4, 2.4, 'cherry_log', 'cherry_leaves');
    d.tree(21, 1, 10, 4, 2.4, 'cherry_log', 'cherry_leaves');
  },
};
