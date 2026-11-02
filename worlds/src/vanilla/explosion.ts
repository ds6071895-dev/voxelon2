// Vanilla explosion block destruction: 16×16×16 surface rays from the
// centre, each starting with power × (0.7..1.3) and losing
// (blast resistance + 0.3) × 0.3 plus 0.225 per 0.3-block step. Cells a ray
// clears are destroyed. Entity damage uses combat.explosionDamage + exposure.

import { BLOCKS, Block } from '../blocks';
import { VMETA } from './blocks';

type Get = (x: number, y: number, z: number) => number;

export function explosionCells(get: Get, cx: number, cy: number, cz: number, power: number, rng: () => number,
  protect: (x: number, y: number, z: number, id: number) => boolean = () => false): [number, number, number][] {
  const out = new Map<string, [number, number, number]>();
  for (let i = 0; i < 16; i++) for (let j = 0; j < 16; j++) for (let k = 0; k < 16; k++) {
    if (i !== 0 && i !== 15 && j !== 0 && j !== 15 && k !== 0 && k !== 15) continue;
    let dx = i / 15 * 2 - 1, dy = j / 15 * 2 - 1, dz = k / 15 * 2 - 1;
    const len = Math.hypot(dx, dy, dz);
    dx /= len; dy /= len; dz /= len;
    let strength = power * (.7 + rng() * .6);
    let x = cx, y = cy, z = cz;
    while (strength > 0) {
      const bx = Math.floor(x), by = Math.floor(y), bz = Math.floor(z);
      const id = get(bx, by, bz);
      if (id !== Block.Air) {
        const fluid = BLOCKS[id]?.fluid;
        const res = fluid ? 100 : VMETA[id]?.blast ?? (BLOCKS[id]?.hardness ?? 0) * 3;
        strength -= (res + .3) * .3;
        if (strength > 0 && !fluid && (BLOCKS[id]?.hardness ?? 0) >= 0 && !protect(bx, by, bz, id)) out.set(`${bx},${by},${bz}`, [bx, by, bz]);
      }
      x += dx * .3; y += dy * .3; z += dz * .3;
      strength -= .225;
    }
  }
  return [...out.values()];
}
