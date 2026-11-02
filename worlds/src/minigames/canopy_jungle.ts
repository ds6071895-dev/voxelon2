// Source arena generation, including its random choices and scenery.
import { Deco,E,N,S,W,finishShapes } from '../vanilla/deco';
import { JavaRandom } from '../vanilla/java_random';
import { Canvas } from '../vanilla/stamp';
import { BASE_Y } from './arena';
import { noise } from './buildings';
import { pointToSegment } from './parkour_course';
import { mc } from '../vanilla/mc_materials';
void [E,N,S,W,pointToSegment,mc];
export interface Tree{x:number;z:number;height:number;decks:number[];deckR:number}
export interface CoinSpot{x:number;y:number;z:number;value:number}
const treeData=(x:number,z:number,height:number,decks:number[],deckR:number):Tree=>({x,z,height,decks,deckR});
const coinSpot=(x:number,y:number,z:number,value:number):CoinSpot=>({x,y,z,value});
export function canopyJungle(seed:number){
const trees:Tree[]=[],spots:CoinSpot[]=[],starts:{x:number;y:number;z:number;yaw:number}[]=[];
const at=(x:number,y:number,z:number,yaw=0,_pitch=0)=>({x,y:BASE_Y+y,z,yaw});
const yawToward=(x:number,z:number,tx:number,tz:number)=>Math.atan2(-(tx-x),-(tz-z));
    function layer(d:Deco):void {
        const r = new JavaRandom(BigInt(seed)*151n+9n);
        trees.length=0;
        spots.length=0;
        starts.length=0;
        let R = 46;
        // Trees first (so the floor knows where trunks are), clear of the middle where everyone starts.
        for (let attempt = 0; attempt < 400 && trees.length < 12; attempt++) {
            let x = r.nextInt(2 * R - 16) - (R - 8), z = r.nextInt(2 * R - 16) - (R - 8);
            if (Math.hypot(x, z) > R - 9 || Math.hypot(x, z) < 11) {
                continue;
            }
            let spaced = true;
            for (const other of trees) {
                spaced &&= Math.hypot(other.x - x, other.z - z) >= 17;
            }
            if (!spaced) {
                continue;
            }
            let height = 22 + r.nextInt(17);
            let decks:number[] = [];
            for (let y = 6 + r.nextInt(3); y < height - 4; y += 6 + r.nextInt(3)) {
                decks.push(y);
            }
            trees.push(treeData(x, z, height, decks, 3.2 + r.nextDouble() * 1.0));
        }
        floor(d, r, R);
        for (const tree of trees) {
            drawTree(d, r, tree);
        }
        bridges(d, r);
        for (let i = 0; i < 10; i++) {
            let a = Math.PI * 2 * i / 10;
            starts.push(at(Math.cos(a) * 5 + 0.5, 1, Math.sin(a) * 5 + 0.5, yawToward(Math.cos(a) * 5, Math.sin(a) * 5, 0, 0) + Math.PI, 0));
        }
    }

    function floor(d:Deco,r:JavaRandom,R:number):void {
        for (let x = -R; x <= R; x++) {
            for (let z = -R; z <= R; z++) {
                let dist = Math.hypot(x, z);
                if (dist > R + 0.5) {
                    continue;
                }
                let n = noise(x, z);
                let top = n < 0.45 ? 'grass_block' : n < 0.65 ? 'podzol' : n < 0.85 ? 'moss_block' : 'coarse_dirt';
                d.set(x, 0, z, top);
                d.set(x, -1, z, 'dirt');
                let nearTrunk = false;
                for (const tree of trees) {
                    nearTrunk ||= Math.hypot(tree.x + 0.5 - x, tree.z + 0.5 - z) < 3.5;
                }
                if (dist < 9 || nearTrunk) {
                    continue;
                }
                let plant = noise(x * 7, z * 3);
                if (plant < 0.05) {
                    d.data(x, 1, z, "fern");
                } else if (plant < 0.08 && top != 'moss_block') {
                    d.tallPlant(x, 1, z);
                } else if (plant < 0.1) {
                    d.leaves(x, 1, z, 'jungle_leaves');
                } else if (plant < 0.11) {
                    d.data(x, 1, z, "blue_orchid");
                } else if (plant > 0.985 && dist < R - 3) {
                    spots.push(coinSpot(x + 0.5, 1, z + 0.5, 1));
                }
            }
        }
        d.underside(0, -1, 0, R, 12, 'dirt', 'stone', 'mossy_cobblestone', 'stone');
        // A ring of stepping logs round the start clearing, coins on the ground there too.
        for (let i = 0; i < 8; i++) {
            let a = Math.PI * 2 * i / 8 + 0.2;
            spots.push(coinSpot(Math.cos(a) * 8 + 0.5, 1, Math.sin(a) * 8 + 0.5, 1));
        }
    }

    function drawTree(d:Deco,r:JavaRandom,tree:Tree):void {
        let x = tree.x, z = tree.z, top = tree.height;
        let cx = x + 0.5, cz = z + 0.5;
        // Canopy: a wide flattened dome, hollowed out over the crow's nest and up the ladder.
        let rx = 6 + r.nextDouble() * 2.5, ry = 3.2;
        let RX = Math.ceil(rx);
        for (let dx = -RX; dx <= RX + 1; dx++) {
            for (let dz = -RX; dz <= RX + 1; dz++) {
                for (let dy = -4; dy <= 4; dy++) {
                    let ex = (x + dx + 0.5 - cx - 0.5) / rx, ez = (z + dz + 0.5 - cz - 0.5) / rx, ey = dy / ry;
                    let e = ex * ex + ez * ez + ey * ey;
                    let bx = x + dx, bz = z + dz, by = top + 1 + dy;
                    let shaft = bx == x && bz == z - 1;
                    let nest = Math.hypot(bx + 0.5 - (cx + 0.5), bz + 0.5 - (cz + 0.5)) < 2.8 && by >= top + 3;
                    if (e <= 1 && !shaft && !nest && noise(bx * 3 + by, bz) > 0.06) {
                        d.leaves(bx, by, bz, 'jungle_leaves');
                    }
                }
            }
        }
        // Treetop coins on the dome, away from the nest.
        for (let i = 0; i < 4; i++) {
            let a = r.nextDouble() * Math.PI * 2, rr = 3.5 + r.nextDouble() * (rx - 4.5);
            let bx = Math.floor(cx + 0.5 + Math.cos(a) * rr), bz = Math.floor(cz + 0.5 + Math.sin(a) * rr);
            for (let by = top + 5; by >= top - 2; by--) {
                if (d.getId(bx, by, bz) === mc('jungle_leaves')) {
                    spots.push(coinSpot(bx + 0.5, by + 1, bz + 0.5, 3));
                    break;
                }
            }
        }
        // 2x2 trunk with buttress roots.
        for (let y = 1; y <= top + 2; y++) {
            for (const o of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
                d.log(x + o[0], y, z + o[1], 'jungle_log', "y");
            }
        }
        for (const o of [[-1, 0], [2, 1], [1, 2], [0, -1], [-1, 1], [2, 0]]) {
            if (r.nextBoolean() && !(o[0] == 0 && o[1] == -1)) {
                let h = 1 + r.nextInt(3);
                for (let y = 1; y <= h; y++) {
                    d.log(x + o[0], y, z + o[1], 'jungle_log', "y");
                }
            }
        }
        // Decks round the trunk, with a ladder hole on the north side.
        for (const deck of tree.decks) {
            disc(d, cx + 0.5, deck, cz + 0.5, tree.deckR, r.nextBoolean() ? 'jungle_planks' : 'spruce_planks', x, z);
            let a = r.nextDouble() * Math.PI * 2;
            spots.push(coinSpot(cx + 0.5 + Math.cos(a) * (tree.deckR - 0.8), deck + 1, cz + 0.5 + Math.sin(a) * (tree.deckR - 0.8), deck > 18 ? 2 : 1));
            d.lantern(Math.floor(cx + 0.5 + Math.cos(a + Math.PI) * 2), deck + 1, Math.floor(cz + 0.5 + Math.sin(a + Math.PI) * 2), false);
        }
        // Crow's nest on top of the trunk.
        disc(d, cx + 0.5, top + 3, cz + 0.5, 2.3, 'stripped_jungle_wood', x, z);
        for (const o of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
            d.set(x + o[0], top + 3, z + o[1], 'stripped_jungle_wood');
        }
        spots.push(coinSpot(cx + 1.5, top + 4, cz + 1.5, 3));
        // The ladder: north face, from the floor to the nest.
        for (let y = 1; y <= top + 3; y++) {
            d.ladder(x, y, z - 1, N);
        }
    }

    /** A plank disc around (cx, cz), leaving the trunk and the ladder column alone. */
    function disc(d:Deco,cx:number,y:number,cz:number,r:number,plank:string,tx:number,tz:number):void {
        let R = Math.ceil(r) + 1;
        for (let bx = Math.floor(cx) - R; bx <= Math.floor(cx) + R; bx++) {
            for (let bz = Math.floor(cz) - R; bz <= Math.floor(cz) + R; bz++) {
                let trunk = bx >= tx && bx <= tx + 1 && bz >= tz && bz <= tz + 1;
                let ladder = bx == tx && bz == tz - 1;
                if (!trunk && !ladder && Math.hypot(bx + 0.5 - cx, bz + 0.5 - cz) <= r + 0.3) {
                    d.set(bx, y, bz, plank);
                }
            }
        }
    }

    /** Rope bridges (planks and slabs, walkable without jumping) between decks of nearby trees. */
    function bridges(d:Deco,r:JavaRandom):void {
        for (let i = 0; i < trees.length; i++) {
            for (let j = i + 1; j < trees.length; j++) {
                let a = trees[i], b = trees[j];
                let ax = a.x + 1, az = a.z + 1, bx = b.x + 1, bz = b.z + 1;
                let dist = Math.hypot(bx - ax, bz - az);
                if (dist > 26 || a.decks.length===0 || b.decks.length===0) {
                    continue;
                }
                let blocked = false;
                for (const other of trees) {
                    if (other != a && other != b && pointToSegment(other.x + 1, other.z + 1, ax, az, bx, bz) < 9) {
                        blocked = true;
                    }
                }
                if (blocked) {
                    continue;
                }
                let length = dist - a.deckR - b.deckR;
                let bestA = -1, bestB = -1;
                for (const da of a.decks) {
                    for (const db of b.decks) {
                        if (Math.abs(da - db) <= length / 2.2 && (bestA < 0 || Math.abs(da - db) < Math.abs(bestA - bestB) || r.nextInt(3) == 0)) {
                            bestA = da;
                            bestB = db;
                        }
                    }
                }
                if (bestA < 0) {
                    continue;
                }
                let ux = (bx - ax) / dist, uz = (bz - az) / dist;
                let sx = -uz, sz = ux;
                let steps = Math.ceil(length * 2);
                for (let k = 0; k <= steps; k++) {
                    let f = k / steps;
                    let px = ax + ux * (a.deckR - 0.4 + f * (length + 0.8)), pz = az + uz * (a.deckR - 0.4 + f * (length + 0.8));
                    let surface = bestA + 1 + (bestB - bestA) * f;
                    let halves = Math.round(surface * 2);
                    for (const side of [-0.5, 0.5]) {
                        let qx = Math.floor(px + sx * side), qz = Math.floor(pz + sz * side);
                        if (halves % 2 == 0) {
                            d.set(qx, Math.trunc(halves / 2) - 1, qz, 'jungle_planks');
                        } else {
                            d.slab(qx, Math.trunc(halves / 2), qz, 'jungle_slab', false);
                        }
                    }
                    if (k == Math.trunc(steps / 2)) {
                        spots.push(coinSpot(px, halves / 2.0, pz, Math.max(bestA, bestB) > 18 ? 2 : 1));
                    }
                }
            }
        }
    }


const bounds={minX:-52,maxX:52,minY:-16,maxY:52,minZ:-52,maxZ:52};const canvas=new Canvas({...bounds,minY:BASE_Y+bounds.minY,maxY:BASE_Y+bounds.maxY});
layer(new Deco(canvas,0,BASE_Y,0));finishShapes(canvas);return {trees,spots,starts,stamp:canvas.pack(),bounds};
}
