// Arena geometry ported from the AutoBox Party Games builders.
import { Deco, E, N, S, W, step } from '../vanilla/deco';
import { house, well, STYLE, noise } from './buildings';
import type { ArenaDef } from './arena';
const mod = (x: number, n: number) => ((x % n) + n) % n;
void [E,N,S,W,step,house,well,STYLE,noise,mod];

export const GLACIERSPLEEF_ARENA: ArenaDef = (() => {
const FLOORS=[0,-8,-16], RADIUS=15;
    function build(d: Deco): void {
        // Cavern wall: a ring of packed ice with blue-ice veins, from below the last floor to the lip.
        for (let x = -27; x <= 27; x++) {
            for (let z = -27; z <= 27; z++) {
                let r = Math.sqrt(x * x + z * z);
                if (r < RADIUS + 0.5 || r > 27.5) {
                    continue;
                }
                let angle = Math.atan2(z, x);
                let top = 9 + Math.round(Math.sin(angle * 5) * 1.5 + Math.cos(angle * 3) * 1.2);
                if (r <= 19.5) {
                    for (let y = -22; y <= top; y++) {
                        let vein = Math.sin(angle * 9 + y * 0.35);
                        let m = vein > 0.82 ? 'blue_ice' : (y + Math.trunc(angle * 10)) % 7 == 0 ? 'snow_block' : 'packed_ice';
                        d.set(x, y, z, m);
                    }
                } else {
                    // Snowy rim outside the wall where the spruces grow.
                    for (let y = top - 2; y <= top; y++) {
                        d.set(x, y, z, y == top ? 'snow_block' : 'packed_ice');
                    }
                }
            }
        }
        d.underside(0, -22, 0, 19.5, 9, 'packed_ice', 'ice', 'blue_ice');
        // An overhanging lip with icicles and hanging soul lanterns.
        for (let x = -20; x <= 20; x++) {
            for (let z = -20; z <= 20; z++) {
                let r = Math.sqrt(x * x + z * z);
                if (r >= 13.5 && r < RADIUS + 0.5) {
                    let angle = Math.atan2(z, x);
                    let top = 9 + Math.round(Math.sin(angle * 5) * 1.5 + Math.cos(angle * 3) * 1.2);
                    d.set(x, top, z, 'snow_block');
                    d.set(x, top - 1, z, 'packed_ice');
                    if (r < 14.5 && mod(x * 7 + z * 13, 5) == 0) {
                        let length = 1 + mod(x * 3 + z, 3);
                        for (let i = 2; i < 2 + length; i++) {
                            d.set(x, top - i, z, i == 1 + length ? 'ice' : 'packed_ice');
                        }
                    }
                }
            }
        }
        for (let i = 0; i < 8; i++) {
            let a = Math.PI * 2 * i / 8 + 0.2;
            let x = Math.round(Math.cos(a) * 14.5), z = Math.round(Math.sin(a) * 14.5);
            let top = 9 + Math.round(Math.sin(Math.atan2(z, x) * 5) * 1.5 + Math.cos(Math.atan2(z, x) * 3) * 1.2);
            // Make sure the lip is there to hang from, then hang a chain and a soul lantern.
            d.set(x, top - 1, z, 'packed_ice');
            d.set(x, top, z, 'snow_block');
            d.hangingLantern(x, top - 2, top - 3, z, true);
        }
        // Glowing alcoves in the wall between the floors.
        for (let floor = 0; floor < FLOORS.length; floor++) {
            for (let i = 0; i < 10; i++) {
                let a = Math.PI * 2 * i / 10 + floor * 0.3;
                let x = Math.round(Math.cos(a) * 16.4), z = Math.round(Math.sin(a) * 16.4);
                d.set(x, FLOORS[floor] + 3, z, 'sea_lantern');
            }
        }
        // A frozen waterfall pouring down one side.
        for (let y = -22; y <= 11; y++) {
            for (let x = -1; x <= 1; x++) {
                d.set(x, y, -17, (y + x) % 3 == 0 ? 'blue_ice' : 'ice');
                d.set(x, y, -16, 'ice');
            }
        }
        d.set(0, 12, -17, 'ice');
        // Spruces on the rim.
        for (let i = 0; i < 14; i++) {
            let a = Math.PI * 2 * i / 14 + 0.11;
            let radius = 22.5 + (i % 3);
            let x = Math.round(Math.cos(a) * radius), z = Math.round(Math.sin(a) * radius);
            let top = 9 + Math.round(Math.sin(Math.atan2(z, x) * 5) * 1.5 + Math.cos(Math.atan2(z, x) * 3) * 1.2);
            d.spruce(x, top + 1, z, 5 + i % 3, 'spruce_log', 'spruce_leaves');
        }
    }


    function layer(d: Deco): void {
        for (const y of FLOORS) {
            d.disc(0, y, 0, RADIUS, 'snow_block');
        }
    }


return { id: 'spleef', build, layer };
})();

export const DISCODASH_ARENA: ArenaDef = (() => {
const TILES=12,TILE=2,HALF=12,COLORS=['red','orange','yellow','lime','light_blue','blue','purple','pink']; void [TILES,TILE];
    function build(d: Deco): void {
        let R = 24;
        // Club shell: black floor, deep walls, a ceiling of lights.
        d.fill(-R, -1, -R, R, -1, R, 'black_concrete');
        for (let x = -R; x <= R; x++) {
            for (let z = -R; z <= R; z++) {
                let danceFloor = Math.abs(x + 0.5) <= HALF + 1 && Math.abs(z + 0.5) <= HALF + 1;
                if (!danceFloor) {
                    d.set(x, 0, z, (x + z & 1) == 0 ? 'polished_blackstone' : 'blackstone');
                }
            }
        }
        // The pit under the dance floor: a well of darkness lit by a few lanterns far below.
        for (let x = -HALF - 1; x <= HALF; x++) {
            for (let z = -HALF - 1; z <= HALF; z++) {
                d.air(x, -1, z);
            }
        }
        d.walls(-HALF - 2, -12, -HALF - 2, HALF + 1, -1, HALF + 1, 'polished_blackstone_bricks');
        d.fill(-HALF - 2, -13, -HALF - 2, HALF + 1, -13, HALF + 1, 'crying_obsidian');
        // Glass barrier around the floor so nobody stands on the rim.
        for (let x = -HALF - 1; x <= HALF; x++) {
            for (let z = -HALF - 1; z <= HALF; z++) {
                let rim = x == -HALF - 1 || x == HALF || z == -HALF - 1 || z == HALF;
                if (rim) {
                    d.set(x, 0, z, 'black_concrete');
                    let post = (x == -HALF - 1 || x == HALF) && (z == -HALF - 1 || z == HALF) || (x + z) % 6 == 0;
                    for (let y = 1; y <= 3; y++) {
                        d.set(x, y, z, post ? 'sea_lantern' : 'tinted_glass');
                    }
                    d.set(x, 4, z, 'polished_blackstone_brick_slab');
                }
            }
        }
        // Outer walls with coloured light panels.
        d.walls(-R, 1, -R, R, 13, R, 'black_concrete');
        for (let i = -R + 3; i <= R - 3; i += 4) {
            let color = COLORS[mod(Math.trunc(i / 4), COLORS.length)];
            for (let y = 3; y <= 9; y++) {
                d.data(i, y, -R, color + "_stained_glass");
                d.data(i, y, R, color + "_stained_glass");
                d.data(-R, y, i, color + "_stained_glass");
                d.data(R, y, i, color + "_stained_glass");
                d.set(i, y, -R - 1, 'glowstone');
                d.set(i, y, R + 1, 'glowstone');
                d.set(-R - 1, y, i, 'glowstone');
                d.set(R + 1, y, i, 'glowstone');
            }
        }
        // Ceiling: black with a grid of lights and end-rod spotlights.
        for (let x = -R; x <= R; x++) {
            for (let z = -R; z <= R; z++) {
                let light = mod(x, 6) == 0 && mod(z, 6) == 0;
                d.set(x, 14, z, light ? 'ochre_froglight' : 'black_concrete');
                if (light && (Math.abs(x) > HALF + 2 || Math.abs(z) > HALF + 2)) {
                    d.data(x, 13, z, "end_rod[facing=down]");
                }
            }
        }
        // The disco ball.
        for (let y = 9; y <= 13; y++) {
            d.data(0, y, 0, "iron_chain[axis=y]");
        }
        for (let x = -1; x <= 1; x++) {
            for (let y = 6; y <= 8; y++) {
                for (let z = -1; z <= 1; z++) {
                    let corner = Math.abs(x) + Math.abs(y - 7) + Math.abs(z) == 3;
                    if (!corner) {
                        d.set(x, y, z, (x + y + z & 1) == 0 ? 'white_stained_glass' : 'light_gray_stained_glass');
                    }
                }
            }
        }
        d.set(0, 7, 0, 'sea_lantern');
        d.set(0, 8, 0, 'sea_lantern');
        // DJ booth on the north side.
        let bz = -HALF - 6;
        d.fill(-6, 1, bz - 2, 6, 1, bz + 2, 'polished_blackstone_bricks');
        d.fill(-6, 2, bz - 2, 6, 2, bz - 2, 'polished_blackstone_bricks');
        for (let x = -5; x <= 5; x++) {
            d.slab(x, 2, bz + 1, 'smooth_quartz_slab', false);
        }
        d.set(-2, 2, bz, 'jukebox');
        d.set(2, 2, bz, 'jukebox');
        d.set(0, 2, bz, 'note_block');
        d.data(-2, 3, bz, "black_carpet");
        d.data(2, 3, bz, "black_carpet");
        for (let side = -1; side <= 1; side += 2) {
            let sx = side * 9;
            for (let y = 1; y <= 5; y++) {
                d.set(sx, y, bz, 'black_wool');
                d.set(sx + side, y, bz, 'black_wool');
                d.data(sx, y, bz + 1, "iron_trapdoor[facing=south,half=bottom,open=true,powered=false,waterlogged=false]");
                d.data(sx + side, y, bz + 1, "iron_trapdoor[facing=south,half=bottom,open=true,powered=false,waterlogged=false]");
            }
            d.set(sx, 6, bz, 'note_block');
            d.set(sx + side, 6, bz, 'note_block');
        }
        for (let x = -6; x <= 6; x += 3) {
            d.wallBanner(x, 4, bz - 1, x == 0 ? "magenta" : "purple", S);
        }
        d.fill(-6, 3, bz - 2, 6, 6, bz - 2, 'black_concrete');
        // Bar on the south side with stools.
        let barZ = HALF + 6;
        for (let x = -8; x <= 8; x++) {
            d.set(x, 1, barZ, 'dark_oak_planks');
            d.slab(x, 2, barZ, 'smooth_quartz_slab', true);
            d.set(x, 1, barZ + 3, 'dark_oak_planks');
            d.set(x, 2, barZ + 3, 'dark_oak_planks');
            d.set(x, 3, barZ + 3, 'dark_oak_planks');
            if (mod(x, 3) == 0) {
                d.set(x, 1, barZ - 2, 'dark_oak_fence');
                d.data(x, 2, barZ - 2, "red_carpet");
                d.candles(x, 4, barZ + 3);
            } else {
                d.pot(x, 4, barZ + 3, null);
            }
        }
        d.data(-4, 3, barZ, "lantern[hanging=false]");
        d.data(4, 3, barZ, "lantern[hanging=false]");
        // Lounge sofas east and west.
        for (let side = -1; side <= 1; side += 2) {
            let sx = side * (HALF + 6);
            for (let z = -6; z <= 6; z++) {
                d.stairs(sx, 1, z, 'crimson_stairs', side < 0 ? W : E, false);
                d.set(sx + side, 1, z, 'crimson_planks');
                d.set(sx + side, 2, z, 'crimson_planks');
            }
            d.stairs(sx, 1, -7, 'crimson_stairs', N, false);
            d.stairs(sx, 1, 7, 'crimson_stairs', S, false);
            for (let z = -4; z <= 4; z += 4) {
                d.set(sx - side * 2, 1, z, 'dark_oak_fence');
                d.slab(sx - side * 2, 2, z, 'dark_oak_slab', true);
                d.candles(sx - side * 2, 3, z);
            }
        }
        // let lights across the room above the floor.
        for (let i = -R + 2; i <= R - 2; i += 8) {
            for (let x = -R + 1; x <= R - 1; x++) {
                if (mod(x, 4) == 0 && Math.abs(i) > 2) {
                    d.hangingLantern(x, 13, 12, i, mod(x, 8) == 0);
                }
            }
        }
        // Floor light strip around the dance floor and planted corners.
        for (let i = -HALF - 3; i <= HALF + 2; i++) {
            if (mod(i, 3) == 0) {
                d.set(i, 0, -HALF - 3, 'sea_lantern');
                d.set(i, 0, HALF + 2, 'sea_lantern');
                d.set(-HALF - 3, 0, i, 'sea_lantern');
                d.set(HALF + 2, 0, i, 'sea_lantern');
            }
        }
        for (const cx of [-R + 3, R - 3]) {
            for (const cz of [-R + 3, R - 3]) {
                d.fill(cx - 1, 1, cz - 1, cx + 1, 1, cz + 1, 'polished_blackstone_bricks');
                d.fill(cx - 1, 2, cz - 1, cx + 1, 2, cz + 1, 'moss_block');
                d.tree(cx, 3, cz, 2, 1.6, 'dark_oak_log', 'azalea_leaves');
                d.lantern(cx + 1, 3, cz + 1, false);
            }
        }
        d.underside(0, -13, 0, 26, 8, 'blackstone', 'basalt', 'blackstone');
    }


    function layer(d: Deco): void {
        for (let tx = 0; tx < TILES; tx++) {
            for (let tz = 0; tz < TILES; tz++) {
                let color = COLORS[mod(tx * 3 + tz * 5, COLORS.length)];
                for (let i = 0; i < TILE; i++) {
                    for (let j = 0; j < TILE; j++) {
                        d.data(-HALF + tx * TILE + i, 0, -HALF + tz * TILE + j, color + "_concrete");
                    }
                }
            }
        }
    }


return { id: 'disco', build, layer };
})();

export const ANVILPANIC_ARENA: ArenaDef = (() => {
const HALF=10;
    function build(d: Deco): void {
        let R = 38;
        // Cobbled town ground with a darker paved square in the middle.
        for (let x = -R; x <= R; x++) {
            for (let z = -R; z <= R; z++) {
                if (x * x + z * z > (R + 0.5) * (R + 0.5)) {
                    continue;
                }
                d.set(x, -1, z, 'stone');
                let ground;
                if (Math.abs(x) <= HALF && Math.abs(z) <= HALF) {
                    ground = (x + z & 1) == 0 ? 'polished_andesite' : 'stone_bricks';
                    if (Math.abs(x) == HALF || Math.abs(z) == HALF) {
                        ground = 'chiseled_stone_bricks';
                    }
                } else {
                    let h = noise(x, z);
                    ground = h < 0.55 ? 'cobblestone' : h < 0.75 ? 'andesite' : h < 0.9 ? 'gravel' : 'mossy_cobblestone';
                }
                d.set(x, 0, z, ground);
            }
        }
        d.underside(0, -1, 0, R, 10, 'stone', 'andesite', 'tuff');
        // Low wall around the square, with stone posts and gaps closed by fence so nobody walks off.
        for (let i = -HALF - 1; i <= HALF + 1; i++) {
            for (const p of [[i, -HALF - 1], [i, HALF + 1], [-HALF - 1, i], [HALF + 1, i]]) {
                let post = mod(p[0] + p[1], 4) == 0 || Math.abs(p[0]) == HALF + 1 && Math.abs(p[1]) == HALF + 1;
                d.set(p[0], 1, p[1], 'stone_bricks');
                d.set(p[0], 2, p[1], post ? 'chiseled_stone_bricks' : 'stone_bricks');
                d.set(p[0], 3, p[1], post ? 'stone_bricks' : 'stone_brick_wall');
                if (post) {
                    d.lantern(p[0], 4, p[1], false);
                }
            }
        }
        // Houses around the square.
        house(d, -9, 0, -26, 8, 6, 4, S, STYLE.TUDOR);
        house(d, 2, 0, -27, 7, 7, 5, S, STYLE.BRICK);
        house(d, -27, 0, -8, 6, 8, 4, E, STYLE.TUDOR);
        house(d, -27, 0, 3, 6, 7, 4, E, STYLE.BRICK);
        house(d, 21, 0, 2, 7, 8, 4, W, STYLE.TUDOR);
        house(d, -8, 0, 21, 7, 6, 4, N, STYLE.BRICK);
        house(d, 3, 0, 21, 8, 6, 5, N, STYLE.TUDOR);
        forge(d, 18, -16);
        well(d, -19, 0, -19);
        d.stall(19, 1, 16, W, "red", "white", 'spruce_fence');
        d.stall(-17, 1, 18, N, "yellow", "white", 'spruce_fence');
        d.stall(-16, 1, -14, S, "blue", "white", 'spruce_fence');
        for (const p of [[-14, -14], [14, 14], [-14, 14], [14, -14], [0, -16], [0, 16], [-16, 0], [16, 0]]) {
            d.streetLamp(p[0], 1, p[1], 4, 'stone_brick_wall', 'dark_oak_fence',
                    Math.abs(p[0]) > Math.abs(p[1]) ? (p[0] > 0 ? W : E) : (p[1] > 0 ? N : S));
        }
        // Trees in the gaps between houses.
        d.tree(-30, 1, 17, 4, 2.6, 'oak_log', 'oak_leaves');
        d.tree(30, 1, -4, 4, 2.6, 'oak_log', 'oak_leaves');
        d.tree(17, 1, 28, 4, 2.4, 'birch_log', 'birch_leaves');
        d.tree(-21, 1, 28, 4, 2.2, 'oak_log', 'oak_leaves');
        d.crates(-15, 1, 10);
        d.crates(13, 1, -10);
    }

    /** The smithy: an open-fronted workshop with a lava forge behind bars, blast furnaces and anvils. */
    function forge(d: Deco, x0: number, z0: number): void {
        let x1 = x0 + 9, z1 = z0 + 7;
        d.fill(x0, 0, z0, x1, 0, z1, 'polished_deepslate');
        for (let y = 1; y <= 5; y++) {
            for (let x = x0; x <= x1; x++) {
                d.set(x, y, z1, 'deepslate_bricks');
            }
            for (let z = z0; z <= z1; z++) {
                d.set(x0, y, z, 'deepslate_bricks');
                d.set(x1, y, z, 'deepslate_bricks');
            }
        }
        // Open front (north) on posts.
        for (let x = x0; x <= x1; x += 3) {
            d.column(x, 1, z0, 5, 'stripped_dark_oak_log');
        }
        d.column(x1, 1, z0, 5, 'stripped_dark_oak_log');
        for (let x = x0; x <= x1; x++) {
            d.log(x, 5, z0, 'stripped_dark_oak_log', "x");
        }
        d.gableRoof(x0 - 1, z0 - 1, x1 + 1, z1 + 1, 5, 'deepslate_tile_stairs', 'deepslate_tiles', 'deepslate_bricks', true);
        // Forge basin with lava behind iron bars.
        for (let x = x0 + 3; x <= x0 + 6; x++) {
            d.set(x, 1, z1 - 1, 'deepslate_bricks');
            d.data(x, 2, z1 - 1, "lava[level=0]");
            d.set(x, 1, z1 - 2, 'deepslate_bricks');
            d.set(x, 2, z1 - 2, 'iron_bars');
            d.set(x, 3, z1 - 2, 'iron_bars');
            d.set(x, 3, z1 - 1, 'deepslate_bricks');
            d.set(x, 4, z1 - 1, 'deepslate_bricks');
            d.set(x, 4, z1 - 2, 'deepslate_bricks');
        }
        d.set(x0 + 2, 1, z1 - 1, 'deepslate_bricks');
        d.set(x0 + 2, 2, z1 - 1, 'deepslate_bricks');
        d.set(x0 + 7, 1, z1 - 1, 'deepslate_bricks');
        d.set(x0 + 7, 2, z1 - 1, 'deepslate_bricks');
        d.data(x0 + 1, 1, z1 - 1, "blast_furnace[facing=north,lit=true]");
        d.data(x0 + 8, 1, z1 - 1, "blast_furnace[facing=north,lit=true]");
        d.data(x0 + 3, 1, z0 + 3, "anvil[facing=east]");
        d.data(x0 + 6, 1, z0 + 3, "chipped_anvil[facing=west]");
        d.data(x0 + 1, 1, z0 + 2, "grindstone[face=floor,facing=north]");
        d.set(x0 + 8, 1, z0 + 2, 'smithing_table');
        d.barrel(x0 + 8, 1, z0 + 4, "up");
        d.barrel(x0 + 1, 1, z0 + 4, N);
        d.hangingLantern(x0 + 4, 5, 5, z0 + 3, false);
        // Chimney above the forge.
        for (let y = 5; y <= 11; y++) {
            d.set(x0 + 4, y, z1 - 1, 'deepslate_bricks');
            d.set(x0 + 5, y, z1 - 1, 'deepslate_bricks');
        }
        d.campfire(x0 + 4, 12, z1 - 1);
        d.campfire(x0 + 5, 12, z1 - 1);
    }


return { id: 'anvil', build };
})();

export const TNTRUN_ARENA: ArenaDef = (() => {
const RADIUS=14,FLOORS=[0,-7,-14],TOPS=['sand','red_sand','gravel'];
    function build(d: Deco): void {
        let outer = 30;
        // Stadium bowl: netherrack and blackstone tiers rising away from the floors, crimson and warped seats.
        for (let x = -outer; x <= outer; x++) {
            for (let z = -outer; z <= outer; z++) {
                let r = Math.sqrt(x * x + z * z);
                if (r <= RADIUS + 1.5 || r > outer + 0.5) {
                    continue;
                }
                let tier = Math.trunc((r - RADIUS - 1.5) / 2.2);
                let top = Math.min(12, tier * 2 + 4);
                // Solid pit wall on the inside, a shell of tiers above, a facade on the outside.
                let pitWall = r <= RADIUS + 3.5;
                let facade = r > outer - 1.5;
                let bottom = pitWall ? -26 : facade ? -8 : top - 2;
                for (let y = bottom; y <= top; y++) {
                    let m = y == top ? (tier % 2 == 0 ? 'polished_blackstone_bricks' : 'nether_bricks')
                            : y > -18 ? 'blackstone' : 'netherrack';
                    d.set(x, y, z, m);
                }
            }
        }
        // Seats (stairs facing outward = audience looking in).
        for (let i = 0; i < 64; i++) {
            let a = Math.PI * 2 * i / 64;
            for (let tier = 1; tier <= 4; tier++) {
                let r = RADIUS + 1.5 + tier * 2.2 + 0.5;
                let x = Math.round(Math.cos(a) * r), z = Math.round(Math.sin(a) * r);
                let top = Math.min(12, tier * 2 + 4);
                let facing = Math.abs(Math.cos(a)) > Math.abs(Math.sin(a)) ? (Math.cos(a) > 0 ? E : W) : (Math.sin(a) > 0 ? S : N);
                if (!d.empty(x, top, z) && d.empty(x, top + 1, z)) {
                    d.stairs(x, top + 1, z, tier % 2 == 0 ? 'warped_stairs' : 'crimson_stairs', facing, false);
                }
            }
        }
        // Lava lake at the bottom and the pit walls.
        for (let x = -RADIUS - 2; x <= RADIUS + 2; x++) {
            for (let z = -RADIUS - 2; z <= RADIUS + 2; z++) {
                let r = Math.sqrt(x * x + z * z);
                if (r <= RADIUS + 1.5) {
                    d.set(x, -27, z, 'netherrack');
                    d.data(x, -26, z, r < RADIUS - 2 && mod(x * 7 + z * 3, 9) == 0 ? "magma_block" : "lava[level=0]");
                }
            }
        }
        d.underside(0, -27, 0, RADIUS + 4, 6, 'netherrack', 'blackstone', 'basalt');
        // Glowstone pillars with banners around the rim, and soul-fire braziers.
        for (let i = 0; i < 12; i++) {
            let a = Math.PI * 2 * i / 12;
            let x = Math.round(Math.cos(a) * (outer - 1)), z = Math.round(Math.sin(a) * (outer - 1));
            for (let y = 13; y <= 18; y++) {
                d.set(x, y, z, y == 18 ? 'glowstone' : 'polished_blackstone');
            }
            d.set(x, 19, z, 'polished_blackstone_bricks');
            d.campfire(x, 20, z);
            let facing = Math.abs(Math.cos(a)) > Math.abs(Math.sin(a)) ? (Math.cos(a) > 0 ? W : E) : (Math.sin(a) > 0 ? N : S);
            let f = step(facing);
            d.wallBanner(x + f[0], 16, z + f[2], i % 2 == 0 ? "red" : "cyan", facing);
        }
        // Glow around each floor's edge under the lip so the layers read clearly.
        for (let f = 0; f < FLOORS.length; f++) {
            for (let i = 0; i < 24; i++) {
                let a = Math.PI * 2 * i / 24 + f * 0.13;
                let x = Math.round(Math.cos(a) * (RADIUS + 2)), z = Math.round(Math.sin(a) * (RADIUS + 2));
                d.set(x, FLOORS[f] + 2, z, 'shroomlight');
            }
        }
    }


    function layer(d: Deco): void {
        for (let f = 0; f < FLOORS.length; f++) {
            d.disc(0, FLOORS[f], 0, RADIUS, TOPS[f]);
            d.disc(0, FLOORS[f] - 1, 0, RADIUS, 'tnt');
        }
    }


return { id: 'tnt_run', build, layer };
})();

export const BOWSPLEEF_ARENA: ArenaDef = (() => {
const RADIUS=13;
    function build(d: Deco): void {
        // Lava sea with magma islands and basalt spires.
        let sea = 40;
        for (let x = -sea; x <= sea; x++) {
            for (let z = -sea; z <= sea; z++) {
                let r = Math.sqrt(x * x + z * z);
                if (r > sea + 0.5) {
                    continue;
                }
                d.set(x, -16, z, 'netherrack');
                let island = Math.sin(x * 0.4) * Math.cos(z * 0.37) > 0.82 && r > 18;
                d.data(x, -15, z, island ? "magma_block" : "lava[level=0]");
                if (r > sea - 1.5) {
                    for (let y = -15; y <= -12; y++) {
                        d.set(x, y, z, y == -12 ? 'nether_bricks' : 'blackstone');
                    }
                }
            }
        }
        d.underside(0, -16, 0, sea, 8, 'netherrack', 'blackstone', 'basalt');
        for (let i = 0; i < 9; i++) {
            let a = Math.PI * 2 * i / 9 + 0.4;
            let r = 22 + (i % 3) * 5;
            let x = Math.round(Math.cos(a) * r), z = Math.round(Math.sin(a) * r);
            let h = 6 + (i * 5) % 9;
            for (let y = -15; y <= -15 + h; y++) {
                for (let dx = -1; dx <= 1; dx++) {
                    for (let dz = -1; dz <= 1; dz++) {
                        if (Math.abs(dx) + Math.abs(dz) <= (y < -15 + h - 2 ? 2 : 1)) {
                            d.log(x + dx, y, z + dz, 'basalt', "y");
                        }
                    }
                }
            }
        }
        // Fortress ruins: broken nether-brick arches and walls on the rim.
        for (let i = 0; i < 6; i++) {
            let a = Math.PI * 2 * i / 6;
            let cx = Math.round(Math.cos(a) * 30), cz = Math.round(Math.sin(a) * 30);
            let alongX = Math.abs(Math.sin(a)) > 0.5;
            ruin(d, cx, cz, alongX, i);
        }
        // Four blackstone obelisks stand guard in the lava, well out of jumping range.
        for (let i = 0; i < 4; i++) {
            let a = Math.PI / 4 + Math.PI / 2 * i;
            let x = Math.round(Math.cos(a) * (RADIUS + 5)), z = Math.round(Math.sin(a) * (RADIUS + 5));
            for (let y = -14; y <= 12; y++) {
                d.set(x, y, z, y < -10 || y > 9 ? 'polished_blackstone_bricks' : 'polished_blackstone');
            }
            d.set(x, 13, z, 'chiseled_polished_blackstone');
            d.soulLantern(x, 14, z, false);
        }
    }

    function ruin(d: Deco, cx: number, cz: number, alongX: boolean, seed: number): void {
        for (let i = -4; i <= 4; i++) {
            let x = cx + (alongX ? i : 0), z = cz + (alongX ? 0 : i);
            let height = Math.abs(i) == 4 || Math.abs(i) == 1 ? 7 - (seed + i & 1) * 2 : 0;
            for (let y = -11; y <= -12 + 2; y++) {
                d.set(x, y, z, 'nether_bricks');
            }
            if (height > 0) {
                for (let y = -9; y <= -9 + height; y++) {
                    d.set(x, y, z, 'nether_bricks');
                }
            }
            if (Math.abs(i) <= 4 && Math.abs(i) >= 1) {
                d.set(x, -3, z, Math.abs(i) == 2 || Math.abs(i) == 3 ? 'nether_bricks' : 'chiseled_nether_bricks');
            }
        }
        // Fence railing between the posts and a soul lantern.
        for (let i = -3; i <= 3; i++) {
            let x = cx + (alongX ? i : 0), z = cz + (alongX ? 0 : i);
            if (Math.abs(i) >= 2) {
                d.set(x, -8, z, 'nether_brick_fence');
            }
        }
        d.soulLantern(cx + (alongX ? 4 : 0), -9 + 8 - (seed & 1) * 2, cz + (alongX ? 0 : 4), false);
    }


    function layer(d: Deco): void {
        d.disc(0, 0, 0, RADIUS, 'tnt');
    }


return { id: 'bow_spleef', build, layer };
})();

export const MUSICALMINECARTS_ARENA: ArenaDef = (() => {
const PLAZA=15;
    function build(d: Deco): void {
        let R = 40;
        for (let x = -R; x <= R; x++) {
            for (let z = -R; z <= R; z++) {
                let r = Math.sqrt(x * x + z * z);
                if (r > R + 0.5) {
                    continue;
                }
                d.set(x, -1, z, 'dirt');
                let top;
                if (r <= PLAZA + 0.5) {
                    let a = Math.atan2(z, x);
                    let sector = Math.floor((a + Math.PI) / (Math.PI / 8));
                    top = r < 5.5 ? 'smooth_quartz' : (sector % 2 == 0) ? 'smooth_stone' : 'polished_diorite';
                    if (Math.abs(r - 10) < 0.5) {
                        top = 'polished_granite';
                    }
                } else if (r <= PLAZA + 2.5) {
                    top = 'stone_bricks';
                } else {
                    top = noise(x, z) < 0.05 ? 'coarse_dirt' : 'grass_block';
                }
                d.set(x, 0, z, top);
            }
        }
        d.underside(0, -1, 0, R, 10, 'dirt', 'stone', 'andesite');
        // Fence around the plaza with lamp posts and balloons.
        d.ring(0, 1, 0, PLAZA + 1.5, PLAZA + 1.5, 'white_concrete');
        for (let x = -PLAZA - 3; x <= PLAZA + 3; x++) {
            for (let z = -PLAZA - 3; z <= PLAZA + 3; z++) {
                let r = Math.sqrt(x * x + z * z);
                if (r > PLAZA + 1 && r <= PLAZA + 2) {
                    d.set(x, 1, z, 'stone_bricks');
                    d.set(x, 2, z, 'white_concrete');
                }
            }
        }
        let balloons = ["red", "yellow", "light_blue", "lime", "pink", "orange", "purple", "cyan"];
        for (let i = 0; i < 16; i++) {
            let a = Math.PI * 2 * i / 16;
            let x = Math.round(Math.cos(a) * (PLAZA + 1.6)), z = Math.round(Math.sin(a) * (PLAZA + 1.6));
            if (i % 2 == 0) {
                d.lampPost(x, 3, z, 2, 'dark_oak_fence', false);
            } else {
                d.column(x, 3, z, 3, 'white_stained_glass_pane');
                d.data(x, 6, z, balloons[Math.trunc(i / 2) % balloons.length] + "_wool");
            }
        }
        carousel(d);
        // Stalls and a Ferris wheel around the fair.
        for (let i = 0; i < 6; i++) {
            let a = Math.PI * 2 * i / 6 + Math.PI / 6;
            let x = Math.round(Math.cos(a) * 24), z = Math.round(Math.sin(a) * 24);
            let front = Math.abs(Math.cos(a)) > Math.abs(Math.sin(a)) ? (Math.cos(a) > 0 ? W : E) : (Math.sin(a) > 0 ? N : S);
            d.stall(x, 1, z, front, balloons[i], "white", 'spruce_fence');
        }
        ferrisWheel(d, 0, -30);
        d.tree(28, 1, 18, 4, 2.5, 'oak_log', 'oak_leaves');
        d.tree(-28, 1, 18, 4, 2.5, 'oak_log', 'oak_leaves');
        d.tree(31, 1, -12, 4, 2.3, 'birch_log', 'birch_leaves');
        d.tree(-31, 1, -12, 4, 2.3, 'birch_log', 'birch_leaves');
        d.planter(-6, 1, 30, 6, 33, 'spruce_trapdoor');
    }

    /** The carousel in the middle: a quartz drum, gold-capped posts, a striped canopy. */
    function carousel(d: Deco): void {
        d.disc(0, 1, 0, 4, 'quartz_block');
        d.ring(0, 1, 0, 4, 4, 'chiseled_quartz_block');
        d.column(0, 2, 0, 6, 'gold_block');
        for (let i = 0; i < 8; i++) {
            let a = Math.PI * 2 * i / 8;
            let x = Math.round(Math.cos(a) * 3), z = Math.round(Math.sin(a) * 3);
            d.column(x, 2, z, 4, i % 2 == 0 ? 'birch_fence' : 'dark_oak_fence');
        }
        for (let layer = 0; layer < 4; layer++) {
            let r = 5 - layer * 1.3;
            let R = Math.ceil(r);
            for (let x = -R; x <= R; x++) {
                for (let z = -R; z <= R; z++) {
                    if (x * x + z * z <= (r + 0.5) * (r + 0.5)) {
                        let sector = Math.floor((Math.atan2(z, x) + Math.PI) / (Math.PI / 4));
                        d.data(x, 6 + layer, z, sector % 2 == 0 ? "red_wool" : "white_wool");
                    }
                }
            }
        }
        d.set(0, 10, 0, 'gold_block');
        d.data(0, 11, 0, "yellow_banner[rotation=0]");
        for (let i = 0; i < 8; i++) {
            let a = Math.PI * 2 * i / 8 + Math.PI / 8;
            let x = Math.round(Math.cos(a) * 4.6), z = Math.round(Math.sin(a) * 4.6);
            d.lantern(x, 5, z, true);
        }
    }

    function ferrisWheel(d: Deco, cx: number, cz: number): void {
        let hub = 16, r = 12;
        // A-frame legs.
        for (let y = 1; y <= hub; y++) {
            let spread = Math.trunc((hub - y) / 3);
            for (let side = -1; side <= 1; side += 2) {
                d.set(cx + side * spread, y, cz - 2, 'white_concrete');
                d.set(cx + side * spread, y, cz + 2, 'white_concrete');
            }
        }
        for (let z = -2; z <= 2; z++) {
            d.set(cx, hub, cz + z, 'quartz_block');
        }
        d.set(cx, hub, cz, 'sea_lantern');
        // Rim and spokes in the x-y plane.
        for (let step = 0; step < 360; step += 2) {
            let a = (step * Math.PI / 180);
            let x = Math.round(Math.cos(a) * r), y = Math.round(Math.sin(a) * r);
            d.set(cx + x, hub + y, cz, step % 30 == 0 ? 'sea_lantern' : 'white_concrete');
        }
        for (let spoke = 0; spoke < 8; spoke++) {
            let a = Math.PI * 2 * spoke / 8;
            for (let t = 1; t < r; t += 0.5) {
                d.set(cx + Math.round(Math.cos(a) * t), hub + Math.round(Math.sin(a) * t), cz, 'iron_block');
            }
            // A gondola hanging under each spoke end.
            let gx = cx + Math.round(Math.cos(a) * r), gy = hub + Math.round(Math.sin(a) * r);
            let colors = ["red", "yellow", "light_blue", "lime", "pink", "orange", "purple", "cyan"];
            d.data(gx, gy - 1, cz, "iron_chain[axis=y]");
            for (let dz = -1; dz <= 1; dz++) {
                d.data(gx, gy - 2, cz + dz, colors[spoke] + "_concrete");
                d.data(gx, gy - 3, cz + dz, dz == 0 ? "glass" : colors[spoke] + "_concrete");
            }
        }
    }


return { id: 'minecarts', build };
})();
