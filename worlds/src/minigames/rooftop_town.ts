// Source arena generation, including its random choices and scenery.
import { Deco,E,N,S,W,finishShapes } from '../vanilla/deco';
import { JavaRandom } from '../vanilla/java_random';
import { Canvas } from '../vanilla/stamp';
import { BASE_Y } from './arena';
import { noise } from './buildings';
import { pointToSegment } from './parkour_course';
import { mc } from '../vanilla/mc_materials';
void [E,N,S,W,pointToSegment,mc];
export class House{constructor(readonly x0:number,readonly z0:number,readonly x1:number,readonly z1:number,readonly h:number){}cx(){return(this.x0+this.x1)/2+.5;}cz(){return(this.z0+this.z1)/2+.5;}}
const STYLES=[{wall:'white_terracotta',corner:'dark_oak_log',roof:'dark_oak_planks',trim:'spruce_slab',door:'dark_oak_door'},{wall:'bricks',corner:'stone_bricks',roof:'smooth_stone',trim:'stone_brick_slab',door:'spruce_door'},{wall:'spruce_planks',corner:'stripped_spruce_log',roof:'spruce_planks',trim:'spruce_slab',door:'spruce_door'},{wall:'yellow_terracotta',corner:'smooth_sandstone',roof:'cut_sandstone',trim:'sandstone_slab',door:'birch_door'},{wall:'light_blue_terracotta',corner:'white_concrete',roof:'polished_andesite',trim:'andesite_slab',door:'oak_door'},{wall:'stone_bricks',corner:'chiseled_stone_bricks',roof:'polished_deepslate',trim:'cobbled_deepslate_slab',door:'dark_oak_door'},{wall:'mud_bricks',corner:'stripped_oak_log',roof:'packed_mud',trim:'mud_brick_slab',door:'oak_door'},{wall:'red_terracotta',corner:'terracotta',roof:'granite',trim:'granite_slab',door:'acacia_door'}];
export function rooftopTown(seed:number){
const LOTS=6,houses:House[]=[];let half=40;
    function layer(d:Deco):void {
        const r = new JavaRandom(BigInt(seed)*149n+5n);
        houses.length=0;
        let widthX = Array<number>(LOTS).fill(0), widthZ = Array<number>(LOTS).fill(0), alleyX = Array<number>(LOTS-1).fill(0), alleyZ = Array<number>(LOTS-1).fill(0);
        for (let i = 0; i < LOTS; i++) {
            widthX[i] = 7 + r.nextInt(4);
            widthZ[i] = 7 + r.nextInt(4);
        }
        for (let i = 0; i < LOTS - 1; i++) {
            alleyX[i] = alley(r);
            alleyZ[i] = alley(r);
        }
        // One wide main street each way.
        alleyX[1 + r.nextInt(3)] = 4;
        alleyZ[1 + r.nextInt(3)] = 4;
        let totalX = sum(widthX) + sum(alleyX), totalZ = sum(widthZ) + sum(alleyZ);
        half = Math.trunc(Math.max(totalX, totalZ) / 2) + 4;
        let h = Array.from({length:LOTS},()=>Array<number>(LOTS).fill(0));
        for (let i = 0; i < LOTS; i++) {
            for (let j = 0; j < LOTS; j++) {
                h[i][j] = 5 + r.nextInt(10);
            }
        }
        // Neighbours differ by at most two, so most roofs are a hop from the next.
        for (let changed = true; changed; ) {
            changed = false;
            for (let i = 0; i < LOTS; i++) {
                for (let j = 0; j < LOTS; j++) {
                    for (const n of [[i + 1, j], [i, j + 1]]) {
                        if (n[0] < LOTS && n[1] < LOTS && Math.abs(h[i][j] - h[n[0]][n[1]]) > 2) {
                            if (h[i][j] > h[n[0]][n[1]]) {
                                h[i][j]--;
                            } else {
                                h[n[0]][n[1]]--;
                            }
                            changed = true;
                        }
                    }
                }
            }
        }
        let plazas = 2 + r.nextInt(2);
        for (let p = 0; p < plazas; p++) {
            h[1 + r.nextInt(LOTS - 2)][1 + r.nextInt(LOTS - 2)] = 0;
        }
        let x = Math.trunc(-totalX / 2);
        let startX = Array<number>(LOTS).fill(0), startZ = Array<number>(LOTS).fill(0);
        for (let i = 0; i < LOTS; i++) {
            startX[i] = x;
            x += widthX[i] + (i < LOTS - 1 ? alleyX[i] : 0);
        }
        let z = Math.trunc(-totalZ / 2);
        for (let j = 0; j < LOTS; j++) {
            startZ[j] = z;
            z += widthZ[j] + (j < LOTS - 1 ? alleyZ[j] : 0);
        }
        for (let i = 0; i < LOTS; i++) {
            for (let j = 0; j < LOTS; j++) {
                houses.push(new House(startX[i], startZ[j], startX[i] + widthX[i] - 1, startZ[j] + widthZ[j] - 1, h[i][j]));
            }
        }
        ground(d, r, Math.trunc(-totalX / 2) - 3, Math.trunc(-totalZ / 2) - 3, totalX - Math.trunc(totalX / 2) + 2, totalZ - Math.trunc(totalZ / 2) + 2);
        for (const house of houses) {
            if (house.h == 0) {
                plaza(d, r, house);
            } else {
                drawHouse(d, r, house);
            }
        }
        bridges(d, r);
    }

    function alley(r:JavaRandom):number {
        let roll = r.nextInt(20);
        return roll < 8 ? 1 : roll < 17 ? 2 : 3;
    }

    function sum(values:number[]):number {
        let total = 0;
        for (const v of values) {
            total += v;
        }
        return total;
    }

    function ground(d:Deco,r:JavaRandom,x0:number,z0:number,x1:number,z1:number):void {
        for (let x = x0; x <= x1; x++) {
            for (let z = z0; z <= z1; z++) {
                let rim = x == x0 || x == x1 || z == z0 || z == z1;
                let n = noise(x, z);
                d.set(x, 0, z, rim ? 'stone_bricks' : n < 0.55 ? 'cobblestone' : n < 0.8 ? 'stone' : n < 0.93
                        ? 'andesite' : 'mossy_cobblestone');
                d.set(x, -1, z, 'stone');
                if (rim) {
                    d.set(x, 1, z, 'cobblestone_wall');
                }
            }
        }
        // A rocky underside.
        let cx = Math.trunc((x0 + x1) / 2), cz = Math.trunc((z0 + z1) / 2);
        let radius = Math.max(x1 - x0, z1 - z0) / 2.0;
        for (let i = 1; i <= 8; i++) {
            let rr = radius * (1 - i / 9.0);
            for (let x = x0; x <= x1; x++) {
                for (let zz = z0; zz <= z1; zz++) {
                    if (Math.max(Math.abs(x - cx), Math.abs(zz - cz)) <= rr - noise(x, zz * 3) * 2) {
                        d.set(x, -1 - i, zz, i > 5 ? 'tuff' : 'stone');
                    }
                }
            }
        }
        // Street lamps on corners.
        for (const house of houses) {
            if (r.nextInt(3) == 0) {
                d.lampPost(house.x0 - 1, 1, house.z0 - 1, 3, 'dark_oak_fence', false);
            }
        }
    }

    function drawHouse(d:Deco,r:JavaRandom,house:House):void {
        let style = STYLES[r.nextInt(STYLES.length)];
        let lx = house.x0 + 1 + r.nextInt(Math.max(1, house.x1 - house.x0 - 2));
        for (let y = 1; y < house.h; y++) {
            for (let x = house.x0; x <= house.x1; x++) {
                for (let z = house.z0; z <= house.z1; z++) {
                    let edgeX = x == house.x0 || x == house.x1, edgeZ = z == house.z0 || z == house.z1;
                    if (!edgeX && !edgeZ) {
                        continue;
                    }
                    if (edgeX && edgeZ) {
                        if (style.corner.endsWith("_log")) {
                            d.log(x, y, z, style.corner, "y");
                        } else {
                            d.set(x, y, z, style.corner);
                        }
                        continue;
                    }
                    let along = edgeX ? z - house.z0 : x - house.x0;
                    let ladderWall = z == house.z0 && x == lx;
                    let window = !ladderWall && y % 3 == 2 && along % 2 == 0 && along > 0 && along < (edgeX ? house.z1 - house.z0 : house.x1 - house.x0);
                    d.set(x, y, z, window ? 'glass_pane' : style.wall);
                }
            }
        }
        // Flat roof with a slab lip only at the corners, so every edge can be jumped from.
        for (let x = house.x0; x <= house.x1; x++) {
            for (let z = house.z0; z <= house.z1; z++) {
                d.set(x, house.h, z, style.roof);
            }
        }
        // Door on the south side, ladder on the north side.
        let dx = Math.trunc((house.x0 + house.x1) / 2);
        d.door(dx, 1, house.z1, style.door, S, false, false);
        for (let y = 1; y <= house.h; y++) {
            d.ladder(lx, y, house.z0 - 1, N);
        }
        // Rooftop clutter in the corners, the middle stays clear.
        let corners = [[house.x0 + 1, house.z0 + 1], [house.x1 - 1, house.z0 + 1], [house.x0 + 1, house.z1 - 1], [house.x1 - 1, house.z1 - 1]];
        let kind = r.nextInt(4);
        let c = corners[r.nextInt(4)];
        if (c[1] == house.z0 + 1 && Math.abs(c[0] - lx) <= 1) {
            c = corners[3];
        }
        switch (kind) {
            case 0: {
                d.set(c[0], house.h + 1, c[1], 'bricks');
                d.set(c[0], house.h + 2, c[1], 'bricks');
                d.campfire(c[0], house.h + 3, c[1]);
            break;}
            case 1: {
                d.barrel(c[0], house.h + 1, c[1], "up");
                d.lantern(c[0], house.h + 2, c[1], false);
            break;}
            case 2: {
                for (const p of corners) {
                    if (noise(p[0], p[1]) < 0.5) {
                        d.pot(p[0], house.h + 1, p[1], "red_tulip");
                    }
                }
            break;}
            default: d.set(c[0], house.h + 1, c[1], 'composter'); break;
        }
    }

    function plaza(d:Deco,r:JavaRandom,lot:House):void {
        let cx = Math.trunc((lot.x0 + lot.x1) / 2), cz = Math.trunc((lot.z0 + lot.z1) / 2);
        for (let x = lot.x0; x <= lot.x1; x++) {
            for (let z = lot.z0; z <= lot.z1; z++) {
                d.set(x, 0, z, (x + z & 1) == 0 ? 'polished_andesite' : 'stone_bricks');
            }
        }
        if (r.nextBoolean()) {
            d.tree(cx, 1, cz, 4, 2.6, 'oak_log', 'oak_leaves');
        } else {
            d.set(cx, 1, cz, 'stone_bricks');
            d.set(cx, 2, cz, 'stone_brick_wall');
            d.lantern(cx, 3, cz, false);
            for (const b of [[-2, 0], [2, 0], [0, -2], [0, 2]]) {
                d.stairs(cx + b[0], 1, cz + b[1], 'spruce_stairs', b[0] < 0 ? W : b[0] > 0 ? E : b[1] < 0 ? N : S, false);
            }
        }
    }

    /** Plank bridges between some neighbouring roofs of the same height across wider alleys. */
    function bridges(d:Deco,r:JavaRandom):void {
        for (const a of houses) {
            for (const b of houses) {
                if (a == b || a.h == 0 || a.h != b.h || r.nextInt(3) != 0) {
                    continue;
                }
                // b directly east of a (sharing a z range), alley 2 or 3 wide.
                if (b.x0 > a.x1 && b.x0 - a.x1 - 1 >= 2 && b.x0 - a.x1 - 1 <= 4 && b.z0 == a.z0) {
                    let z = Math.trunc((Math.max(a.z0, b.z0) + Math.min(a.z1, b.z1)) / 2) + 1;
                    for (let x = a.x1 + 1; x < b.x0; x++) {
                        d.slab(x, a.h, z, 'spruce_slab', true);
                    }
                } else if (b.z0 > a.z1 && b.z0 - a.z1 - 1 >= 2 && b.z0 - a.z1 - 1 <= 4 && b.x0 == a.x0) {
                    let x = Math.trunc((Math.max(a.x0, b.x0) + Math.min(a.x1, b.x1)) / 2) + 1;
                    for (let z = a.z1 + 1; z < b.z0; z++) {
                        d.slab(x, a.h, z, 'spruce_slab', true);
                    }
                }
            }
        }
    }


const bounds={minX:-64,maxX:64,minY:-16,maxY:40,minZ:-64,maxZ:64};const canvas=new Canvas({...bounds,minY:BASE_Y+bounds.minY,maxY:BASE_Y+bounds.maxY});
layer(new Deco(canvas,0,BASE_Y,0));finishShapes(canvas);return {houses,half,stamp:canvas.pack(),bounds};
}
