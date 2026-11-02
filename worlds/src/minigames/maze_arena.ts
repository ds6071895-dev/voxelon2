// Arena geometry ported from the AutoBox Party Games builders.
import { Deco, E, N, S, W, step } from '../vanilla/deco';
import { house, well, STYLE, noise } from './buildings';
import type { ArenaDef } from './arena';
const mod = (x: number, n: number) => ((x % n) + n) % n;
void [E,N,S,W,step,house,well,STYLE,noise,mod];

export const HEDGEMAZE_ARENA: ArenaDef = (() => {
const cellX=(i:number)=>-22+i*4+2; const inCourtyard=(x:number,z:number)=>x> -6&&x<6&&z> -6&&z<6;
const CELLS=11,PITCH=4,HALF=22,CENTRE_LO=4,CENTRE_HI=6; void [CELLS,PITCH,CENTRE_LO,CENTRE_HI];
    function build(d: Deco): void {
        let R = 46;
        for (let x = -R; x <= R; x++) {
            for (let z = -R; z <= R; z++) {
                if (Math.abs(x) > R || Math.abs(z) > R) {
                    continue;
                }
                d.set(x, -1, z, 'dirt');
                let maze = Math.abs(x) <= HALF && Math.abs(z) <= HALF;
                let top = maze ? 'grass_block' : noise(x, z) < 0.03 ? 'coarse_dirt' : 'grass_block';
                let path = !maze && (Math.abs(x) <= 1 && z > HALF || Math.abs(Math.abs(z) - HALF - 4) <= 1 || Math.abs(Math.abs(x) - HALF - 4) <= 1);
                // The rerolling layer owns the maze floor; clearing it must never touch the manor.
                if (!maze || inCourtyard(x, z)) {
                    d.set(x, 0, z, path ? 'gravel' : top);
                }
            }
        }
        d.underside(0, -1, 0, R + 4, 10, 'dirt', 'stone', 'andesite');
        // Courtyard and fountain in the middle of the maze.
        let lo = cellX(CENTRE_LO) - 2, hi = cellX(CENTRE_HI) + 2;
        for (let x = lo + 1; x <= hi - 1; x++) {
            for (let z = lo + 1; z <= hi - 1; z++) {
                d.set(x, 0, z, (x + z & 1) == 0 ? 'polished_andesite' : 'stone_bricks');
            }
        }
        d.fountain(0, 1, 0, 3);
        // Stone border wall around the hedges with lantern pillars, and the gate.
        for (let i = -HALF - 1; i <= HALF + 1; i++) {
            for (const p of [[i, -HALF - 1], [i, HALF + 1], [-HALF - 1, i], [HALF + 1, i]]) {
                let pillar = mod(p[0] + p[1], 6) == 0 || Math.abs(p[0]) == HALF + 1 && Math.abs(p[1]) == HALF + 1;
                d.column(p[0], 1, p[1], pillar ? 4 : 3, pillar ? 'chiseled_stone_bricks' : 'stone_bricks');
                if (pillar) {
                    d.lantern(p[0], 5, p[1], false);
                }
            }
        }
        // Gate: a gap in the south wall with an arch.
        for (let x = -1; x <= 1; x++) {
            for (let y = 1; y <= 3; y++) {
                d.air(x, y, HALF + 1);
            }
        }
        for (let y = 1; y <= 5; y++) {
            d.set(-2, y, HALF + 1, 'stone_bricks');
            d.set(2, y, HALF + 1, 'stone_bricks');
        }
        d.stairs(-1, 4, HALF + 1, 'stone_brick_stairs', W, true);
        d.stairs(1, 4, HALF + 1, 'stone_brick_stairs', E, true);
        d.set(0, 4, HALF + 1, 'chiseled_stone_bricks');
        d.fill(-2, 5, HALF + 1, 2, 5, HALF + 1, 'stone_bricks');
        d.lantern(-2, 6, HALF + 1, false);
        d.lantern(2, 6, HALF + 1, false);
        d.gate(-1, 1, HALF + 2, 'dark_oak_fence_gate', S, true);
        d.gate(1, 1, HALF + 2, 'dark_oak_fence_gate', S, true);
        d.set(-2, 1, HALF + 2, 'stone_bricks');
        d.set(2, 1, HALF + 2, 'stone_bricks');
        // Manor house to the north.
        manor(d, -18, -HALF - 22);
        // Flower beds, topiaries and lamp posts around the garden paths.
        for (let side = -1; side <= 1; side += 2) {
            d.planter(side * (HALF + 7), 1, -12, side * (HALF + 10), 12, 'spruce_trapdoor');
            for (let z = -HALF; z <= HALF; z += 8) {
                topiary(d, side * (HALF + 2) + side * 0, z);
            }
        }
        for (let x = -HALF; x <= HALF; x += 8) {
            d.lampPost(x, 1, HALF + 7, 3, 'dark_oak_fence', false);
        }
        statue(d, -8, HALF + 9);
        statue(d, 8, HALF + 9);
        d.tree(-HALF - 9, 1, HALF + 10, 5, 3.0, 'oak_log', 'oak_leaves');
        d.tree(HALF + 9, 1, HALF + 10, 5, 3.0, 'oak_log', 'oak_leaves');
        d.tree(-HALF - 10, 1, -HALF - 6, 5, 3.0, 'dark_oak_log', 'dark_oak_leaves');
        d.tree(HALF + 10, 1, -HALF - 6, 5, 3.0, 'dark_oak_log', 'dark_oak_leaves');
    }

    function topiary(d: Deco, x: number, z: number): void {
        if (!d.empty(x, 1, z)) {
            return;
        }
        d.set(x, 1, z, 'stone_bricks');
        d.log(x, 2, z, 'stripped_oak_log', "y");
        for (let dx = -1; dx <= 1; dx++) {
            for (let dy = 0; dy <= 2; dy++) {
                for (let dz = -1; dz <= 1; dz++) {
                    if (Math.abs(dx) + Math.abs(dy - 1) + Math.abs(dz) <= 2) {
                        d.leaves(x + dx, 3 + dy, z + dz, 'azalea_leaves');
                    }
                }
            }
        }
    }

    function statue(d: Deco, x: number, z: number): void {
        d.set(x, 1, z, 'chiseled_stone_bricks');
        d.set(x, 2, z, 'stone_brick_wall');
        d.set(x, 3, z, 'chiseled_quartz_block');
        d.set(x, 4, z, 'quartz_pillar');
        d.data(x, 5, z, "carved_pumpkin[facing=south]");
    }

    function manor(d: Deco, x0: number, z0: number): void {
        let x1 = x0 + 36, z1 = z0 + 12;
        d.fill(x0, 0, z0, x1, 0, z1, 'stone_bricks');
        for (let y = 1; y <= 10; y++) {
            for (let x = x0; x <= x1; x++) {
                for (let z = z0; z <= z1; z++) {
                    let edge = x == x0 || x == x1 || z == z0 || z == z1;
                    if (!edge) {
                        continue;
                    }
                    let pier = (x - x0) % 6 == 0 || z != z1 && z != z0 && (z - z0) % 6 == 0;
                    let window = !pier && (y == 2 || y == 3 || y == 7 || y == 8);
                    let m = y == 5 || y == 10 ? 'polished_deepslate' : pier ? 'stone_bricks' : window ? 'glass_pane' : 'bricks';
                    d.set(x, y, z, m);
                }
            }
        }
        d.hipRoof(x0 - 1, z0 - 1, x1 + 1, z1 + 1, 11, 'deepslate_tile_stairs', 'deepslate_tiles');
        let cx = (x0 + x1) / 2;
        d.doubleDoor(cx, 1, z1, 'dark_oak_door', S);
        d.set(cx, 3, z1, 'stone_bricks');
        d.set(cx + 1, 3, z1, 'stone_bricks');
        // Porch steps and columns.
        for (let x = cx - 3; x <= cx + 4; x++) {
            d.stairs(x, 0, z1 + 2, 'stone_brick_stairs', N, false);
            d.set(x, 0, z1 + 1, 'stone_bricks');
        }
        for (const x of [cx - 3, cx + 4]) {
            d.column(x, 1, z1 + 1, 4, 'quartz_pillar');
            d.lantern(x, 5, z1 + 1, false);
        }
        for (let x = cx - 3; x <= cx + 4; x++) {
            d.slab(x, 5, z1 + 1, 'stone_brick_slab', false);
        }
        d.lantern(cx - 3, 5, z1 + 1, false);
    }


return { id: 'maze', build };
})();
