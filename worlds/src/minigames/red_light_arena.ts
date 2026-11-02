// Arena geometry ported from the AutoBox Party Games builders.
import { Deco, E, N, S, W, step } from '../vanilla/deco';
import { house, well, STYLE, noise } from './buildings';
import type { ArenaDef } from './arena';
const mod = (x: number, n: number) => ((x % n) + n) % n;
void [E,N,S,W,step,house,well,STYLE,noise,mod];

export const REDLIGHT_ARENA: ArenaDef = (() => {
const START_Z=30,FINISH_Z=-28,HALF=11,HEAD_Z=-38; const CHECKPOINTS=[START_Z,10,-10]; void [START_Z,FINISH_Z,faceToward];
    function build(d: Deco): void {
        let R = 52;
        for (let x = -R; x <= R; x++) {
            for (let z = -R; z <= R; z++) {
                if (x * x + z * z > (R + 0.5) * (R + 0.5)) {
                    continue;
                }
                d.set(x, -1, z, 'dirt');
                let top;
                let field = Math.abs(x) <= HALF && z <= START_Z + 3 && z >= FINISH_Z - 4;
                if (field) {
                    top = (Math.trunc(x / 4) + 100) % 2 == 0 ? 'grass_block' : 'moss_block';
                    if (z == START_Z || z == CHECKPOINTS[1] || z == CHECKPOINTS[2]) {
                        top = z == START_Z ? 'white_concrete' : 'yellow_concrete';
                    }
                    if (z == FINISH_Z || z == FINISH_Z - 1) {
                        top = mod(x + z, 2) == 0 ? 'white_concrete' : 'black_concrete';
                    }
                } else {
                    top = noise(x, z) < 0.04 ? 'coarse_dirt' : 'grass_block';
                }
                d.set(x, 0, z, top);
            }
        }
        d.underside(0, -1, 0, R, 10, 'dirt', 'stone', 'andesite');
        // A hedge and white fence around the field.
        for (let z = FINISH_Z - 5; z <= START_Z + 4; z++) {
            for (let side = -1; side <= 1; side += 2) {
                let x = side * (HALF + 1);
                d.set(x, 1, z, 'white_concrete');
                d.leaves(x, 2, z, 'oak_leaves');
                d.leaves(x, 3, z, 'oak_leaves');
            }
        }
        for (let x = -HALF - 1; x <= HALF + 1; x++) {
            d.set(x, 1, START_Z + 4, 'white_concrete');
            d.leaves(x, 2, START_Z + 4, 'oak_leaves');
            d.leaves(x, 3, START_Z + 4, 'oak_leaves');
            d.set(x, 1, FINISH_Z - 5, 'white_concrete');
            d.leaves(x, 2, FINISH_Z - 5, 'oak_leaves');
            d.leaves(x, 3, FINISH_Z - 5, 'oak_leaves');
        }
        for (let z = FINISH_Z - 5; z <= START_Z + 4; z += 6) {
            d.lampPost(-HALF - 1, 4, z, 1, 'birch_fence', false);
            d.lampPost(HALF + 1, 4, z, 1, 'birch_fence', false);
        }
        doll(d);
        // The school behind the doll.
        school(d, -16, -50);
        // Playground: swings on the east, a slide on the west, a sandbox and trees.
        swings(d, 18, 6);
        slide(d, -20, 4);
        for (let x = 16; x <= 21; x++) {
            for (let z = -14; z <= -9; z++) {
                let edge = x == 16 || x == 21 || z == -14 || z == -9;
                if (edge) {
                    d.slab(x, 1, z, 'spruce_slab', false);
                } else {
                    d.set(x, 0, z, 'sand');
                }
            }
        }
        d.tree(-26, 1, -20, 5, 3.2, 'oak_log', 'oak_leaves');
        d.tree(27, 1, 24, 5, 3.0, 'oak_log', 'oak_leaves');
        d.tree(-28, 1, 26, 4, 2.6, 'birch_log', 'birch_leaves');
        d.tree(30, 1, -24, 5, 3.0, 'oak_log', 'oak_leaves');
        d.bleachers(W, 16, 18, 30, 1, 3, 'birch_stairs', 'birch_planks');
        d.planter(-24, 1, 12, -18, 15, 'birch_trapdoor');
    }

    function doll(d: Deco): void {
        let z0 = HEAD_Z - 2;
        // Legs and shoes.
        for (const x of [-2, 1]) {
            for (let y = 1; y <= 2; y++) {
                d.set(x, y, z0, 'white_concrete');
                d.set(x + 1, y, z0, 'white_concrete');
            }
            d.set(x, 1, z0 + 1, 'black_concrete');
            d.set(x + 1, 1, z0 + 1, 'black_concrete');
        }
        // Dress: a flared orange skirt and bodice.
        for (let y = 3; y <= 8; y++) {
            let w = y <= 5 ? 4 : 3 - (y - 6) / 2;
            for (let x = -w; x <= w - 1 + 1; x++) {
                for (let z = z0 - 1; z <= z0 + 1; z++) {
                    d.set(x, y, z, y == 6 ? 'yellow_concrete' : 'orange_concrete');
                }
            }
        }
        // Arms.
        for (let y = 5; y <= 8; y++) {
            d.set(-4, y, z0, 'white_terracotta');
            d.set(4, y, z0, 'white_terracotta');
        }
        d.set(-4, 8, z0, 'yellow_concrete');
        d.set(4, 8, z0, 'yellow_concrete');
        // Head (the face side is swapped at runtime).
        for (let x = -2; x <= 2; x++) {
            for (let y = 9; y <= 13; y++) {
                for (let z = HEAD_Z - 4; z <= HEAD_Z; z++) {
                    let hair = y >= 12 || z <= HEAD_Z - 3 || Math.abs(x) == 2 && y >= 10;
                    d.set(x, y, z, hair ? 'black_concrete' : 'white_terracotta');
                }
            }
        }
        // Pigtails.
        for (let side = -1; side <= 1; side += 2) {
            for (let y = 9; y <= 12; y++) {
                d.set(side * 3, y, HEAD_Z - 3, 'black_concrete');
            }
            d.set(side * 3, 12, HEAD_Z - 2, 'orange_wool');
        }
        faceAway(d);
    }

    /** The face (south side of the head): watching shows eyes, away shows the back of her hair. */
    function faceToward(d: Deco): void {
        for (let x = -2; x <= 2; x++) {
            for (let y = 9; y <= 13; y++) {
                let m = y >= 12 || Math.abs(x) == 2 && y >= 10 ? 'black_concrete' : 'white_terracotta';
                if (y == 11 && (x == -1 || x == 1)) {
                    m = 'black_concrete';
                }
                if (y == 9 && x == 0) {
                    m = 'red_concrete';
                }
                if (y == 10 && Math.abs(x) == 1) {
                    m = 'pink_concrete';
                }
                d.set(x, y, HEAD_Z, m);
            }
        }
    }

    function faceAway(d: Deco): void {
        for (let x = -2; x <= 2; x++) {
            for (let y = 9; y <= 13; y++) {
                d.set(x, y, HEAD_Z, 'black_concrete');
            }
        }
    }

    function school(d: Deco, x0: number, z0: number): void {
        let x1 = x0 + 32, z1 = z0 + 8;
        d.fill(x0, 0, z0, x1, 0, z1, 'stone_bricks');
        for (let y = 1; y <= 8; y++) {
            for (let x = x0; x <= x1; x++) {
                for (let z = z0; z <= z1; z++) {
                    let edge = x == x0 || x == x1 || z == z0 || z == z1;
                    if (!edge) {
                        continue;
                    }
                    let corner = (x == x0 || x == x1) && (z == z0 || z == z1);
                    let window = z == z1 && (y == 2 || y == 3 || y == 6 || y == 7) && (x - x0) % 4 != 0;
                    d.set(x, y, z, corner || (x - x0) % 8 == 0 ? 'stone_bricks' : window ? 'glass_pane' : 'bricks');
                }
            }
        }
        for (let x = x0; x <= x1; x++) {
            d.set(x, 5, z1, 'stone_bricks');
        }
        d.gableRoof(x0 - 1, z0 - 1, x1 + 1, z1 + 1, 8, 'deepslate_tile_stairs', 'deepslate_tiles', 'bricks', true);
        let cx = (x0 + x1) / 2;
        d.doubleDoor(cx, 1, z1, 'dark_oak_door', S);
        d.set(cx, 3, z1, 'stone_bricks');
        d.set(cx + 1, 3, z1, 'stone_bricks');
        // Clock tower over the door.
        for (let y = 9; y <= 16; y++) {
            for (let x = cx - 1; x <= cx + 2; x++) {
                for (let z = z1 - 3; z <= z1; z++) {
                    let edge = x == cx - 1 || x == cx + 2 || z == z1 - 3 || z == z1;
                    if (edge) {
                        d.set(x, y, z, y == 14 && z == z1 && (x == cx || x == cx + 1) ? 'quartz_block' : 'bricks');
                    }
                }
            }
        }
        d.hipRoof(cx - 2, z1 - 4, cx + 3, z1 + 1, 17, 'deepslate_tile_stairs', 'deepslate_tiles');
        d.bell(cx, 15, z1 - 1);
        d.set(cx, 16, z1 - 1, 'bricks');
        d.flag(x0 + 3, 1, z1 + 3, 8, "red", E);
    }

    function swings(d: Deco, x0: number, z0: number): void {
        for (let z = z0; z <= z0 + 8; z += 8) {
            d.column(x0, 1, z, 5, 'dark_oak_fence');
            d.column(x0 + 3, 1, z, 5, 'dark_oak_fence');
        }
        for (let z = z0; z <= z0 + 8; z++) {
            d.log(x0 + 1, 6, z, 'stripped_dark_oak_log', "z");
            d.log(x0 + 2, 6, z, 'stripped_dark_oak_log', "z");
        }
        d.set(x0, 6, z0, 'stripped_dark_oak_log');
        d.set(x0 + 3, 6, z0, 'stripped_dark_oak_log');
        d.set(x0, 6, z0 + 8, 'stripped_dark_oak_log');
        d.set(x0 + 3, 6, z0 + 8, 'stripped_dark_oak_log');
        for (const z of [z0 + 2, z0 + 6]) {
            for (let y = 3; y <= 5; y++) {
                d.data(x0 + 1, y, z, "iron_chain[axis=y]");
                d.data(x0 + 2, y, z, "iron_chain[axis=y]");
            }
            d.data(x0 + 1, 2, z, "red_wool");
            d.data(x0 + 2, 2, z, "red_wool");
        }
    }

    function slide(d: Deco, x0: number, z0: number): void {
        // Ladder tower, platform, slide down to the south.
        d.column(x0, 1, z0, 4, 'spruce_fence');
        d.column(x0 + 2, 1, z0, 4, 'spruce_fence');
        d.column(x0, 1, z0 + 2, 4, 'spruce_fence');
        d.column(x0 + 2, 1, z0 + 2, 4, 'spruce_fence');
        d.fill(x0, 5, z0, x0 + 2, 5, z0 + 2, 'spruce_planks');
        for (let y = 1; y <= 5; y++) {
            d.set(x0 + 1, y, z0 - 1, y == 5 ? 'spruce_planks' : 'spruce_planks');
            if (y < 5) {
                d.ladder(x0 + 1, y, z0 - 2, N);
            }
        }
        for (let i = 0; i < 5; i++) {
            d.stairs(x0 + 1, 4 - i, z0 + 3 + i, 'smooth_quartz_stairs', N, false);
            d.set(x0, 4 - i, z0 + 3 + i, 'yellow_concrete');
            d.set(x0 + 2, 4 - i, z0 + 3 + i, 'yellow_concrete');
            for (let y = 1; y < 4 - i; y++) {
                d.set(x0, y, z0 + 3 + i, 'yellow_concrete');
                d.set(x0 + 2, y, z0 + 3 + i, 'yellow_concrete');
            }
        }
    }


return { id: 'red_light', bounds:{minX:-56,maxX:56,minY:-16,maxY:40,minZ:-56,maxZ:56}, build };
})();
