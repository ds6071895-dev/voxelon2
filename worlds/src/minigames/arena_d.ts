// Arena geometry ported from the AutoBox Party Games builders.
import { Deco, E, N, S, W, step, opposite, clockwise } from '../vanilla/deco';
import { house, well, STYLE, noise } from './buildings';
import type { ArenaDef } from './arena';
const mod = (x: number, n: number) => ((x % n) + n) % n;
void [E,N,S,W,step,house,well,STYLE,noise,mod];

export const KINGOFTHEHILL_ARENA: ArenaDef = (() => {
const TOP=10,ZONE=2;
    function build(d: Deco): void {
        let R = 38;
        for (let x = -R; x <= R; x++) {
            for (let z = -R; z <= R; z++) {
                let r = Math.sqrt(x * x + z * z);
                if (r > R + 0.5) {
                    continue;
                }
                d.set(x, -1, z, 'sandstone');
                let top = r < 23 ? ((x + z & 1) == 0 ? 'smooth_sandstone' : 'cut_sandstone') : 'sand';
                if (r < 23 && Math.abs(r - 21) < 0.5) {
                    top = 'chiseled_sandstone';
                }
                d.set(x, 0, z, top);
            }
        }
        d.underside(0, -1, 0, R, 10, 'sandstone', 'sand', 'sandstone');
        // Perimeter wall around the plaza so nobody walks off.
        for (let a = 0; a < 720; a++) {
            let angle = Math.PI * 2 * a / 720;
            let x = Math.round(Math.cos(angle) * 24), z = Math.round(Math.sin(angle) * 24);
            d.set(x, 1, z, 'sandstone');
            d.set(x, 2, z, 'cut_sandstone');
            d.slab(x, 3, z, 'smooth_sandstone_slab', false);
        }
        // The ziggurat: five tiers of two blocks.
        for (let tier = 0; tier < 5; tier++) {
            let half = 10 - tier * 2;
            for (let y = tier * 2 + 1; y <= tier * 2 + 2; y++) {
                for (let x = -half; x <= half; x++) {
                    for (let z = -half; z <= half; z++) {
                        let edge = Math.abs(x) == half || Math.abs(z) == half;
                        let m = edge && y == tier * 2 + 2 ? 'cut_sandstone' : edge ? 'chiseled_sandstone' : 'sandstone';
                        if (edge && Math.abs(x) == half && Math.abs(z) == half) {
                            m = 'smooth_sandstone';
                        }
                        d.set(x, y, z, m);
                    }
                }
            }
        }
        // Staircases up the middle of each face.
        for (let side = 0; side < 4; side++) {
            let facing = [N, E, S, W][side];
            let f = step(facing);
            // Down to along 12, so the bottom stair sits on the plaza: every
            // step is a half block and auto-steps (no jump at the foot).
            for (let along = 3; along <= 12; along++) {
                let height = 13 - along;
                for (let across = -1; across <= 1; across++) {
                    let x = f[0] * along + (f[0] == 0 ? across : 0);
                    let z = f[2] * along + (f[2] == 0 ? across : 0);
                    for (let y = 1; y < height; y++) {
                        d.set(x, y, z, 'sandstone');
                    }
                    d.stairs(x, height, z, 'sandstone_stairs', opposite(facing), false);
                    for (let y = height + 1; y <= 11; y++) {
                        d.air(x, y, z);
                    }
                }
            }
        }
        // The crown zone.
        for (let x = -ZONE; x <= ZONE; x++) {
            for (let z = -ZONE; z <= ZONE; z++) {
                d.set(x, TOP, z, Math.abs(x) == ZONE || Math.abs(z) == ZONE ? 'gold_block' : 'yellow_glazed_terracotta');
            }
        }
        d.set(0, TOP, 0, 'gold_block');
        // Slime launch pads at the diagonals of the plaza.
        for (const p of [[14, 14], [-14, 14], [14, -14], [-14, -14]]) {
            for (let dx = 0; dx <= 1; dx++) {
                for (let dz = 0; dz <= 1; dz++) {
                    d.set(p[0] + dx - (p[0] > 0 ? 0 : 1), 0, p[1] + dz - (p[1] > 0 ? 0 : 1), 'slime_block');
                }
            }
        }
        // Obelisks, palms, pools and stalls around the oasis.
        for (let i = 0; i < 4; i++) {
            let a = Math.PI / 2 * i;
            let x = Math.round(Math.cos(a) * 19), z = Math.round(Math.sin(a) * 19);
            d.column(x, 1, z, 6, 'cut_sandstone');
            d.set(x, 7, z, 'chiseled_sandstone');
            d.set(x, 8, z, 'gold_block');
        }
        for (let i = 0; i < 10; i++) {
            let a = Math.PI * 2 * i / 10 + 0.3;
            let x = Math.round(Math.cos(a) * 30), z = Math.round(Math.sin(a) * 30);
            palm(d, x, z, 6 + i % 3);
        }
        for (const p of [[-30, -8], [30, 10]]) {
            for (let x = -3; x <= 3; x++) {
                for (let z = -4; z <= 4; z++) {
                    if (Math.pow(x / 3.5, 2) + Math.pow(z / 4.5, 2) <= 1) {
                        d.data(p[0] + x, 0, p[1] + z, "water[level=0]");
                    }
                }
            }
            d.data(p[0], 1, p[1] + 1, "lily_pad");
        }
        d.stall(0, 1, 31, N, "orange", "white", 'birch_fence');
        d.stall(0, 1, -31, S, "lime", "white", 'birch_fence');
    }

    /** A palm: a gently leaning trunk with drooping fronds. */
    function palm(d: Deco, x: number, z: number, height: number): void {
        let lean = x > 0 ? -1 : 1;
        let tx = x, tz = z;
        for (let y = 1; y <= height; y++) {
            if (y == height / 2) {
                tx += lean;
            }
            d.log(tx, y, tz, 'jungle_log', "y");
        }
        let top = height + 1;
        d.leaves(tx, top, tz, 'jungle_leaves');
        for (const dir of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            for (let i = 1; i <= 3; i++) {
                d.leaves(tx + dir[0] * i, top - (i == 3 ? 1 : 0), tz + dir[1] * i, 'jungle_leaves');
            }
        }
        for (const dir of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
            d.leaves(tx + dir[0], top, tz + dir[1], 'jungle_leaves');
            d.leaves(tx + dir[0] * 2, top - 1, tz + dir[1] * 2, 'jungle_leaves');
        }
        d.data(tx + 1, top - 1, tz, "cocoa[age=2,facing=west]");
    }


return { id: 'koth', build };
})();

export const SHEEPHERD_ARENA: ArenaDef = (() => {
const PENS=10,PEN_RING=25,COLORS=['red','blue','lime','yellow','purple','orange','cyan','pink','white','black']; const penCentre=(i:number)=>[Math.round(Math.cos(Math.PI*2*i/PENS)*PEN_RING),Math.round(Math.sin(Math.PI*2*i/PENS)*PEN_RING)]; const towardCentre=(i:number)=>{const c=penCentre(i);return Math.abs(c[0])>=Math.abs(c[1])?(c[0]>0?W:E):(c[1]>0?N:S);};
    function build(d: Deco): void {
        let R = 44;
        for (let x = -R; x <= R; x++) {
            for (let z = -R; z <= R; z++) {
                if (x * x + z * z > (R + 0.5) * (R + 0.5)) {
                    continue;
                }
                d.set(x, -1, z, 'dirt');
                d.set(x, 0, z, noise(x, z) < 0.04 ? 'coarse_dirt' : 'grass_block');
                let r = Math.sqrt(x * x + z * z);
                if (r < 32 && r > 4 && noise(z, x) < 0.05) {
                    let flowers = ["short_grass", "short_grass", "dandelion", "poppy", "cornflower", "oxeye_daisy"];
                    d.data(x, 1, z, flowers[Math.trunc(noise(x * 3, z * 5) * flowers.length)]);
                }
            }
        }
        d.underside(0, -1, 0, R, 10, 'dirt', 'stone');
        // Outer fence around the valley.
        for (let a = 0; a < 720; a++) {
            let angle = Math.PI * 2 * a / 720;
            let x = Math.round(Math.cos(angle) * 32.5), z = Math.round(Math.sin(angle) * 32.5);
            d.set(x, 1, z, 'oak_fence');
            d.air(x, 2, z);
        }
        for (let i = 0; i < 20; i++) {
            let angle = Math.PI * 2 * i / 20;
            let x = Math.round(Math.cos(angle) * 32.5), z = Math.round(Math.sin(angle) * 32.5);
            d.set(x, 1, z, 'stripped_oak_log');
            d.lantern(x, 2, z, false);
        }
        // Pens.
        for (let i = 0; i < PENS; i++) {
            let c = penCentre(i);
            let toward = towardCentre(i);
            let f = step(toward);
            for (let dx = -3; dx <= 3; dx++) {
                for (let dz = -3; dz <= 3; dz++) {
                    let edge = Math.abs(dx) == 3 || Math.abs(dz) == 3;
                    let x = c[0] + dx, z = c[1] + dz;
                    if (!edge) {
                        d.set(x, 0, z, Math.abs(dx) + Math.abs(dz) <= 1 ? 'hay_block' : 'podzol');
                        if (Math.abs(dx) + Math.abs(dz) <= 1) {
                            d.log(x, 0, z, 'hay_block', "y");
                        }
                        d.air(x, 1, z);
                        continue;
                    }
                    let gate = dx == f[0] * 3 && dz == f[2] * 3;
                    let corner = Math.abs(dx) == 3 && Math.abs(dz) == 3;
                    if (gate) {
                        d.gate(x, 1, z, 'oak_fence_gate', toward, true);
                    } else if (corner) {
                        d.set(x, 1, z, 'stripped_oak_log');
                        d.lantern(x, 2, z, false);
                    } else {
                        d.set(x, 1, z, 'oak_fence');
                    }
                    d.set(x, 0, z, 'cobblestone');
                }
            }
            // A coloured flag at the back of the pen.
            let bx = c[0] - f[0] * 4, bz = c[1] - f[2] * 4;
            d.flag(bx, 1, bz, 4, COLORS[i], clockwise(toward));
            d.data(c[0] + f[0] * 2, 0, c[1] + f[2] * 2, COLORS[i] + "_wool");
        }
        // Barns, a windmill-less farmhouse, crops and a pond around the valley.
        house(d, -12, 0, -42, 12, 7, 5, S, STYLE.BARN);
        house(d, 4, 0, 34, 9, 7, 4, N, STYLE.TUDOR);
        for (let x = 34; x <= 41; x++) {
            for (let z = -8; z <= 8; z++) {
                if (Math.hypot(x, z) > 43) {
                    continue;
                }
                let water = z == 0;
                d.data(x, 0, z, water ? "water[level=0]" : "farmland[moisture=7]");
                if (!water) {
                    d.data(x, 1, z, "wheat[age=7]");
                }
            }
        }
        for (let x = -42; x <= -34; x++) {
            for (let z = -6; z <= 6; z++) {
                if (Math.pow((x + 38) / 4.0, 2) + Math.pow(z / 6.0, 2) <= 1) {
                    d.data(x, 0, z, "water[level=0]");
                }
            }
        }
        d.data(-38, 1, 2, "lily_pad");
        d.data(-37, 1, -3, "lily_pad");
        // A water trough and an old oak in the middle of the valley.
        for (let x = -2; x <= 2; x++) {
            d.set(x, 0, -1, 'spruce_planks');
            d.set(x, 0, 1, 'spruce_planks');
            d.data(x, 0, 0, "water[level=0]");
        }
        d.tree(36, 1, 22, 5, 3.2, 'oak_log', 'oak_leaves');
        d.tree(-36, 1, 22, 5, 3, 'oak_log', 'oak_leaves');
        d.tree(-34, 1, -26, 5, 3, 'birch_log', 'birch_leaves');
        d.tree(30, 1, -30, 5, 3.2, 'oak_log', 'oak_leaves');
    }


return { id: 'sheep', build };
})();
