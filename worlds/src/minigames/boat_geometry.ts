import { house,STYLE } from './buildings';
import { Deco,S } from '../vanilla/deco';
import { JavaRandom } from '../vanilla/java_random';
import { noise } from './buildings';
import { routeDist } from './sky_route';
import type { BoatCircuit } from './boat_circuit';
const mod=(x:number,n:number)=>((x%n)+n)%n;
const bucket=(x:number,z:number)=>`${x},${z}`;
function shuffle<T>(a:T[],r:JavaRandom){for(let i=a.length-1;i>0;i--){const j=r.nextInt(i+1);[a[i],a[j]]=[a[j],a[i]];}}
export function boatScenery(d:Deco,course:BoatCircuit,free:number[][]):void{
const {line,length,theme,rng:r}=course;
const HALF_WIDTH=3.5;
const nearest=(x:number,z:number)=>course.nearest(x,z);
    function wall(x:number,z:number):string {
        let stripe = mod(x + z, 4) < 2;
        return (()=> { switch(theme){case 'SNOW':return stripe ? 'red_concrete' : 'white_concrete';case 'DESERT':return stripe ? 'cut_sandstone' : 'orange_terracotta';case 'CHERRY':return stripe ? 'pink_concrete' : 'white_concrete';case 'NETHER':return stripe ? 'nether_bricks' : 'magma_block';case 'CANDY':return stripe ? 'red_wool' : 'white_wool';case 'NEON':return stripe ? 'magenta_concrete' : 'cyan_concrete';}throw new Error('Unknown track theme');})();
    }

    function groundAt(ground:string,x:number,z:number):string {
        let n = noise(x, z);
        return (()=> { switch(theme){case 'SNOW':return n < 0.06 ? 'packed_ice' : ground;case 'DESERT':return n < 0.12 ? 'sandstone' : n < 0.2 ? 'smooth_sandstone' : ground;case 'CHERRY':return n < 0.15 ? 'moss_block' : n < 0.2 ? 'dirt_path' : ground;case 'NETHER':return n < 0.2 ? 'soul_soil' : n < 0.28 ? 'crimson_nylium' : ground;case 'CANDY':return mod(x / 3 + z / 3, 2) == 0 ? 'pink_concrete' : ground;case 'NEON':return n < 0.04 ? 'sea_lantern' : ground;}throw new Error('Unknown track theme');})();
    }

    /** Blue-ice strips across the track along the straights. */
    function boosts(d:Deco):void {
        let n = line.length;
        let nextAt = 40;
        for (let i = 0; i < n; i++) {
            let s = line[i][2];
            if (s < nextAt || s > length - 30) {
                continue;
            }
            // Straight for 24 blocks either way (heading barely changes).
            let a = line[mod(i - 48, n)], b = line[i], c = line[mod(i + 48, n)];
            let h1 = Math.atan2(b[1] - a[1], b[0] - a[0]), h2 = Math.atan2(c[1] - b[1], c[0] - b[0]);
            if (Math.abs(Math.atan2(Math.sin(h2 - h1), Math.cos(h2 - h1))) > 0.05) {
                continue;
            }
            nextAt = s + 45;
            let ux = (c[0] - b[0]) / routeDist(b, c), uz = (c[1] - b[1]) / routeDist(b, c);
            for (let along = 0; along < 4; along += 0.5) {
                for (let side = -HALF_WIDTH + 0.5; side <= HALF_WIDTH - 0.5; side += 0.5) {
                    let x = Math.floor(b[0] + ux * along - uz * side), z = Math.floor(b[1] + uz * along + ux * side);
                    d.set(x, 0, z, 'blue_ice');
                }
            }
        }
    }

    /** A checkered line across the track at the start, under a gantry with lanterns. */
    function startLine(d:Deco):void {
        let a = line[0], b = line[4];
        let ux = (b[0] - a[0]) / routeDist(a, b), uz = (b[1] - a[1]) / routeDist(a, b);
        for (let side = -HALF_WIDTH; side <= HALF_WIDTH; side += 0.5) {
            for (let row = 0; row < 2; row++) {
                let x = Math.floor(a[0] + ux * row - uz * side), z = Math.floor(a[1] + uz * row + ux * side);
                d.set(x, 0, z, mod(x + z, 2) == 0 ? 'white_concrete' : 'black_concrete');
            }
        }
        let posts:number[][] = [[],[]];
        for (let k = 0; k < 2; k++) {
            let side = (k == 0 ? -1 : 1) * (HALF_WIDTH + 2);
            posts[k] = [Math.floor(a[0] - uz * side), Math.floor(a[1] + ux * side)];
            for (let y = 1; y <= 7; y++) {
                d.set(posts[k][0], y, posts[k][1], 'stripped_spruce_log');
            }
            d.lantern(posts[k][0], 8, posts[k][1], false);
        }
        // The banner beam between the posts.
        let steps = 24;
        for (let i = 0; i <= steps; i++) {
            let f = i / steps;
            let x = Math.round(posts[0][0] + (posts[1][0] - posts[0][0]) * f), z = Math.round(posts[0][1] + (posts[1][1] - posts[0][1]) * f);
            d.set(x, 7, z, i % 2 == 0 ? 'black_wool' : 'white_wool');
        }
    }

    function scenery(d:Deco,r:JavaRandom,free:number[][]):void {
        let placed = 0;
        let taken = new Set<string>();
        for (let attempt = 0; attempt < 900 && placed < 70 && free.length>0; attempt++) {
            let spot = free[r.nextInt(free.length)];
            let x = spot[0], z = spot[1];
            let big = r.nextInt(6) == 0;
            let reach = big ? 6 : 3;
            if (nearest(x + 0.5, z + 0.5)[1] < HALF_WIDTH + 2 + reach || !roomy(taken, x, z, reach)) {
                continue;
            }
            placed++;
            for (let i = -reach; i <= reach; i++) {
                for (let j = -reach; j <= reach; j++) {
                    taken.add(bucket(x + i, z + j));
                }
            }
            switch (theme) {
                case 'SNOW': {
                    if (big) {
                        house(d, x - 3, 0, z - 3, 7, 6, 4, S, STYLE.SPRUCE);
                    } else if (r.nextInt(4) == 0) {
                        d.lampPost(x, 1, z, 3, 'spruce_fence', false);
                    } else {
                        d.spruce(x, 1, z, 6 + r.nextInt(5), 'spruce_log', 'spruce_leaves');
                    }
                break;}
                case 'DESERT': {
                    if (big) {
                        house(d, x - 3, 0, z - 3, 7, 6, 4, S, STYLE.SAND);
                    } else if (r.nextBoolean()) {
                        palm(d, r, x, z);
                    } else {
                        for (let y = 1; y <= 2 + r.nextInt(2); y++) {
                            d.set(x, y, z, 'cactus');
                        }
                    }
                break;}
                case 'CHERRY': {
                    if (big || r.nextInt(3) > 0) {
                        d.tree(x, 1, z, 4 + r.nextInt(2), 2.6 + r.nextDouble(), 'cherry_log', 'cherry_leaves');
                    } else {
                        d.lampPost(x, 1, z, 3, 'cherry_fence', false);
                    }
                break;}
                case 'NETHER': {
                    let h = big ? 10 + r.nextInt(8) : 3 + r.nextInt(5);
                    for (let y = 1; y <= h; y++) {
                        d.log(x, y, z, 'basalt', "y");
                    }
                    d.set(x, h + 1, z, r.nextBoolean() ? 'glowstone' : 'shroomlight');
                break;}
                case 'CANDY': {
                    let h = 3 + r.nextInt(4);
                    for (let y = 1; y <= h; y++) {
                        d.set(x, y, z, 'white_concrete');
                    }
                    let sweet = ['pink_wool', 'lime_wool', 'light_blue_wool', 'yellow_wool'][r.nextInt(4)];
                    for (let i = -1; i <= 1; i++) {
                        for (let j = -1; j <= 1; j++) {
                            d.set(x + i, h + 1 + j + 1, z, (i + j & 1) == 0 ? sweet : 'white_wool');
                        }
                    }
                break;}
                case 'NEON': {
                    let h = big ? 12 + r.nextInt(10) : 4;
                    let glow = ['magenta_concrete', 'cyan_concrete', 'lime_concrete'][r.nextInt(3)];
                    for (let y = 1; y <= h; y++) {
                        d.set(x, y, z, y % 3 == 0 ? glow : 'black_concrete');
                    }
                    d.set(x, h + 1, z, 'sea_lantern');
                break;}
            }
        }
        // Grandstands along the start straight.
        let a = line[0], b = line[4];
        let ux = (b[0] - a[0]) / routeDist(a, b), uz = (b[1] - a[1]) / routeDist(a, b);
        for (let along = -12; along <= 12; along++) {
            for (let row = 0; row < 3; row++) {
                let side = HALF_WIDTH + 3 + row;
                let x = Math.floor(a[0] + ux * along - uz * side), z = Math.floor(a[1] + uz * along + ux * side);
                if (nearest(x + 0.5, z + 0.5)[1] > HALF_WIDTH + 2.5) {
                    for (let y = 1; y <= row + 1; y++) {
                        d.set(x, y, z, theme == 'NETHER' ? 'nether_bricks' : 'spruce_planks');
                    }
                }
            }
        }
    }

    function roomy(taken:Set<string>,x:number,z:number,reach:number):boolean {
        for (let i = -reach; i <= reach; i++) {
            for (let j = -reach; j <= reach; j++) {
                if (taken.has(bucket(x + i, z + j))) {
                    return false;
                }
            }
        }
        return true;
    }

    function palm(d:Deco,r:JavaRandom,x:number,z:number):void {
        let h = 5 + r.nextInt(3);
        let lean = r.nextInt(4);
        let s = [0, 0];
        for (let y = 1; y <= h; y++) {
            if (y == Math.trunc(h / 2) + 1) {
                s = [[1, 0], [-1, 0], [0, 1], [0, -1]][lean];
            }
            d.log(x + s[0], y, z + s[1], 'jungle_log', "y");
        }
        let tx = x + s[0], tz = z + s[1];
        d.leaves(tx, h + 1, tz, 'jungle_leaves');
        for (const f of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            d.leaves(tx + f[0], h, tz + f[1], 'jungle_leaves');
            d.leaves(tx + f[0] * 2, h, tz + f[1] * 2, 'jungle_leaves');
            d.leaves(tx + f[0] * 3, h - 1, tz + f[1] * 3, 'jungle_leaves');
        }
    }


void [wall,groundAt,shuffle];boosts(d);startLine(d);scenery(d,r,free);
}
