// Elytra Rally's seeded route, ring meshes, launch deck and scenery.
import { Deco,E,N,S,W,finishShapes } from '../vanilla/deco';
import { JavaRandom } from '../vanilla/java_random';
import { Canvas } from '../vanilla/stamp';
import { BASE_Y } from './arena';
import { noise } from './buildings';
import { routeLoop,roundRoute,resample,routeDist } from './sky_route';
import { courseKey } from './parkour';
void [E,N,S,W];
export interface Ring{x:number;y:number;z:number;nx:number;ny:number;nz:number;boost:boolean;finish:boolean}
const ringData=(x:number,y:number,z:number,nx:number,ny:number,nz:number,boost:boolean,finish:boolean):Ring=>({x,y,z,nx,ny,nz,boost,finish});
const mod=(x:number,n:number)=>((x%n)+n)%n;
export function glideCourse(seed:number){
 const GRID=7,CELL=30,RING_RADIUS=4.6,path:number[][]=[],rings:Ring[]=[];
 let theme='ISLES',start=[0,100,0],startDir=[1,0,0];
    function layer(d:Deco):void {
        let r = new JavaRandom(BigInt(seed)*157n+3n);
        theme = ['ISLES','BADLANDS','NETHER','FROZEN','END','MUSHROOM','CITY'][r.nextInt(7)];
        route(r);
        platforms(d);
        for (let i = 0; i < rings.length; i++) {
            drawRing(d, rings[i], i);
        }
        scenery(d, r);
    }

    function route(r:JavaRandom):void {
        path.length=0;
        rings.length=0;
        let tiers = 4;
        let tierY = [118, 88, 58, 28];
        let line:number[][] = [];
        let end:number[]|null=null;
        for (let k = 0; k < tiers; k++) {
            const corners = routeLoop(r, GRID, 8 + r.nextInt(3), 0.55);
            let pts:number[][] = [];
            for (const c of corners) {
                pts.push([(c[0] - GRID / 2.0) * CELL, (c[1] - GRID / 2.0) * CELL]);
            }
            // Open the loop where it suits the dive in: the corner nearest the end of the tier above
            // (but not right underneath it), and fly round in whichever direction.
            let first = 0;
            if (end != null) {
                let best = Number.MAX_VALUE;
                for (let i = 0; i < pts.length; i++) {
                    let dist = Math.hypot(pts[i][0] - end[0], pts[i][1] - end[2]);
                    let score = Math.abs(dist - 50);
                    if (score < best) {
                        best = score;
                        first = i;
                    }
                }
            } else {
                first = r.nextInt(pts.length);
            }
            let ordered:number[][] = [];
            let reverse = r.nextBoolean();
            if (end != null) {
                // Fly round in the direction that carries on from the dive, so it never doubles back.
                let here = pts[first], after = pts[(first + 1) % pts.length];
                let alongX = here[0] - end[0], alongZ = here[1] - end[2];
                reverse = (after[0] - here[0]) * alongX + (after[1] - here[1]) * alongZ < 0;
            }
            for (let i = 0; i < pts.length; i++) {
                let index = reverse ? mod(first - i, pts.length) : (first + i) % pts.length;
                ordered.push(pts[index]);
            }
            // Stop well short of closing the loop (the dive then drops away under the start).
            let last = ordered[ordered.length - 1], back = ordered[0];
            ordered.push([last[0] + (back[0] - last[0]) * 0.2, last[1] + (back[1] - last[1]) * 0.2]);
            const flat = roundRoute(ordered, false, 13, 2);
            let phase = r.nextDouble() * Math.PI * 2, wave = 120 + r.nextDouble() * 80;
            let tier:number[][] = [];
            let s = 0;
            for (let i = 0; i < flat.length; i++) {
                if (i > 0) {
                    s += Math.hypot(flat[i][0] - flat[i - 1][0], flat[i][1] - flat[i - 1][1]);
                }
                tier.push([flat[i][0], tierY[k] + 5 * Math.sin(phase + s / wave * Math.PI * 2), flat[i][1]]);
            }
            if (end != null) {
                // A curving dive from the last tier into this one (Hermite curve along both tangents).
                let a = line[line.length - 1], b = tier[0];
                let ta = dir(line[line.length - 2], a), tb = dir(b, tier[1]);
                let length = routeDist(a, b) * 0.6;
                for (let i = 1; i < 30; i++) {
                    let f = i / 30.0;
                    let h00 = 2 * f * f * f - 3 * f * f + 1, h10 = f * f * f - 2 * f * f + f, h01 = -2 * f * f * f + 3 * f * f, h11 = f * f * f - f * f;
                    let p = Array<number>(3).fill(0);
                    for (let c = 0; c < 3; c++) {
                        let tangentA = c == 1 ? -0.9 * length : ta[c] * length, tangentB = c == 1 ? 0 : tb[c] * length;
                        p[c] = h00 * a[c] + h10 * tangentA + h01 * b[c] + h11 * tangentB;
                    }
                    p[0] = Math.max(-110, Math.min(110, p[0]));
                    p[2] = Math.max(-110, Math.min(110, p[2]));
                    line.push(p);
                }
            }
            line.push(...tier);
            end = tier[tier.length - 1];
        }
        path.push(...resample(line, false, 2));
        start = path[0].slice();
        startDir = dir(path[0], path[4]);
        // Rings about every 44 blocks after the run-up; every fifth is a boost ring; the last is the finish.
        let s = 0, nextAt = 34;
        for (let i = 1; i < path.length - 3; i++) {
            s += routeDist(path[i - 1], path[i]);
            if (s >= nextAt && s < pathLength() - 25 && roomFor(i)) {
                addRing(i, (rings.length + 1) % 5 == 0, false);
                nextAt = s + 40 + r.nextDouble() * 8;
            }
        }
        addRing(path.length - 3, false, true);
    }

    /** No other part of the route passes within reach of a ring at path point i. */
    function roomFor(i:number):boolean {
        let c = path[i];
        let n = dir(path[Math.max(0, i - 1)], path[Math.min(path.length - 1, i + 1)]);
        let rim = RING_RADIUS + 0.9;
        for (let j = 0; j < path.length; j++) {
            let p = path[j];
            if (Math.abs(j - i) > 6 && routeDist(c, p) < 12) {
                return false;
            }
            // Distance from the route to the ring's rim itself.
            let wx = p[0] - c[0], wy = p[1] - c[1], wz = p[2] - c[2];
            let h = wx * n[0] + wy * n[1] + wz * n[2];
            let radial = Math.sqrt(Math.max(0, wx * wx + wy * wy + wz * wz - h * h));
            if (Math.sqrt(h * h + (radial - rim) * (radial - rim)) < 3) {
                return false;
            }
        }
        return true;
    }

    function pathLength():number {
        let total = 0;
        for (let i = 1; i < path.length; i++) {
            total += routeDist(path[i - 1], path[i]);
        }
        return total;
    }

    function addRing(i:number,boost:boolean,finish:boolean):void {
        let p = path[i], n = dir(path[Math.max(0, i - 1)], path[Math.min(path.length - 1, i + 1)]);
        rings.push(ringData(p[0], p[1], p[2], n[0], n[1], n[2], boost, finish));
    }

    function dir(a:number[],b:number[]):number[] {
        let dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
        let len = Math.sqrt(dx * dx + dy * dy + dz * dz);
        return len < 1e-9 ? [1, 0, 0] : [dx / len, dy / len, dz / len];
    }

    /** Distance from a point to the nearest point of the flight line (every few samples). */
    function clearance(x:number,y:number,z:number):number {
        let best = Number.MAX_VALUE;
        for (let i = 0; i < path.length; i += 2) {
            let p = path[i];
            let dx = p[0] - x, dy = p[1] - y, dz = p[2] - z;
            best = Math.min(best, dx * dx + dy * dy + dz * dz);
        }
        return Math.sqrt(best);
    }

    /** Horizontal distance to the flight line where it passes between heights y0 and y1. */
    function columnClearance(x:number,z:number,y0:number,y1:number):number {
        let best = Number.MAX_VALUE;
        for (let i = 0; i < path.length; i += 2) {
            let p = path[i];
            if (p[1] >= y0 && p[1] <= y1) {
                best = Math.min(best, Math.hypot(p[0] - x, p[2] - z));
            }
        }
        return best;
    }

    // ------------------------------------------------------------------ building

    function ringColours():string[] {
        return (()=>{switch(theme){case 'ISLES':return ['lime_concrete', 'light_blue_concrete', 'yellow_concrete'];case 'BADLANDS':return ['cyan_concrete', 'white_concrete', 'light_blue_concrete'];case 'NETHER':return ['cyan_concrete', 'lime_concrete', 'light_blue_concrete'];case 'FROZEN':return ['red_concrete', 'magenta_concrete', 'orange_concrete'];case 'END':return ['lime_concrete', 'yellow_concrete', 'cyan_concrete'];case 'MUSHROOM':return ['light_blue_concrete', 'lime_concrete', 'yellow_concrete'];case 'CITY':return ['magenta_concrete', 'lime_concrete', 'orange_concrete'];}throw new Error("Unknown flight theme");})();
    }

    function drawRing(d:Deco,ring:Ring,index:number):void {
        let colour = ring.finish ? 'gold_block' : ring.boost ? 'gold_block' : ringColours()[index % 3];
        let radius = (ring.finish ? RING_RADIUS + 1.5 : RING_RADIUS) + 0.9;
        // Two unit vectors spanning the ring's plane.
        let n = [ring.nx, ring.ny, ring.nz];
        let up = Math.abs(n[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
        let u = cross(n, up), v;
        u = norm(u);
        v = norm(cross(n, u));
        let placed = new Set<number>();
        for (let a = 0; a < 360; a += 3) {
            let ca = Math.cos((a*Math.PI/180)), sa = Math.sin((a*Math.PI/180));
            let x = Math.floor(ring.x + (u[0] * ca + v[0] * sa) * radius);
            let y = Math.floor(ring.y + 0.9 + (u[1] * ca + v[1] * sa) * radius);
            let z = Math.floor(ring.z + (u[2] * ca + v[2] * sa) * radius);
            if (!placed.has(courseKey(x,y,z)) && (placed.add(courseKey(x,y,z)),true)) {
                d.set(x, y, z, a % 45 == 0 ? (ring.boost || ring.finish ? 'glowstone' : 'sea_lantern') : colour);
            }
        }
    }

    function cross(a:number[],b:number[]):number[] {
        return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    }

    function norm(a:number[]):number[] {
        let len = Math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2]);
        return [a[0] / len, a[1] / len, a[2] / len];
    }

    /** The launch deck: a little behind and above the start of the route (dives always pass below it). */
    function launchDeck():number[] {
        return [Math.floor(start[0] - startDir[0] * 8), Math.floor(start[1]) + 4, Math.floor(start[2] - startDir[2] * 8)];
    }

    /** The launch deck and a finish island under the last ring. */
    function platforms(d:Deco):void {
        let deck = launchDeck();
        let sx = deck[0], sy = deck[1], sz = deck[2];
        let plating = (()=>{switch(theme){case 'NETHER':return 'polished_blackstone_bricks';case 'END':return 'purpur_block';case 'BADLANDS':return 'smooth_red_sandstone';case 'FROZEN':return 'packed_ice';default:return 'smooth_quartz';}throw new Error("Unknown flight theme");})();
        for (let x = -6; x <= 6; x++) {
            for (let z = -6; z <= 6; z++) {
                let dist = Math.hypot(x, z);
                if (dist <= 6.5) {
                    d.set(sx + x, sy, sz + z, dist > 5.5 ? 'gold_block' : plating);
                    if (dist < 4.5) {
                        d.set(sx + x, sy - 1, sz + z, 'stone_bricks');
                    }
                }
            }
        }
        let finish = rings[rings.length - 1];
        let fx = Math.floor(finish.x), fz = Math.floor(finish.z), fy = Math.floor(finish.y) - 14;
        for (let x = -7; x <= 7; x++) {
            for (let z = -7; z <= 7; z++) {
                let dist = Math.hypot(x, z);
                if (dist <= 7.5) {
                    d.set(fx + x, fy, fz + z, (x + z & 1) == 0 ? 'white_concrete' : 'black_concrete');
                    d.set(fx + x, fy - 1, fz + z, 'stone');
                }
            }
        }
    }

    function scenery(d:Deco,r:JavaRandom):void {
        switch (theme) {
            case 'ISLES': {
                islands(d, r, 26, 'grass_block', 'dirt', 'stone', true);
                clouds(d, r, 30);
            break;}
            case 'BADLANDS': {
                spires(d, r, 15, true);
                islands(d, r, 10, 'red_sand', 'orange_terracotta', 'terracotta', false);
            break;}
            case 'NETHER': {
                basalt(d, r, 14);
                islands(d, r, 16, 'netherrack', 'netherrack', 'blackstone', false);
            break;}
            case 'FROZEN': {
                iceSpikes(d, r, 13);
                islands(d, r, 14, 'snow_block', 'packed_ice', 'blue_ice', false);
                clouds(d, r, 18);
            break;}
            case 'END': {
                obsidian(d, r, 12);
                islands(d, r, 20, 'end_stone', 'end_stone', 'end_stone_bricks', false);
            break;}
            case 'MUSHROOM': {
                mushrooms(d, r, 22);
                islands(d, r, 12, 'mycelium', 'dirt', 'stone', false);
            break;}
            case 'CITY': towers(d, r, 16); break;
        }
    }

    /** Floating islands: a flat top, a tapering rocky underside, trees or rocks on top. */
    function islands(d:Deco,r:JavaRandom,count:number,top:string,soil:string,rock:string,trees:boolean):void {
        let made = 0;
        for (let attempt = 0; attempt < 300 && made < count; attempt++) {
            let radius = 4 + r.nextDouble() * 8;
            let x = r.nextInt(220) - 110, z = r.nextInt(220) - 110, y = r.nextInt(150) - 30;
            if (Math.abs(x) + radius > 116 || Math.abs(z) + radius > 116 || y + 12 > 145 || clearance(x, y, z) < radius + 14) {
                continue;
            }
            made++;
            let R = Math.ceil(radius);
            for (let dx = -R; dx <= R; dx++) {
                for (let dz = -R; dz <= R; dz++) {
                    let dist = Math.hypot(dx, dz) + noise(x + dx, z + dz) * 1.2;
                    if (dist > radius) {
                        continue;
                    }
                    let depth = Math.round((radius - dist) * 1.1 + 1);
                    d.set(x + dx, y, z + dz, top);
                    for (let k = 1; k <= depth; k++) {
                        d.set(x + dx, y - k, z + dz, k <= 2 ? soil : rock);
                    }
                }
            }
            if (trees && radius > 6) {
                d.tree(x, y + 1, z, 4 + r.nextInt(3), 2.5 + r.nextDouble(), r.nextBoolean() ? 'oak_log' : 'birch_log',
                        r.nextBoolean() ? 'oak_leaves' : 'birch_leaves');
            } else if (theme == 'NETHER' && radius > 5) {
                d.set(x, y + 1, z, 'glowstone');
                d.set(x + 1, y + 1, z, 'shroomlight');
            } else if (theme == 'END' && radius > 6) {
                for (let k = 1; k <= 3; k++) {
                    d.set(x, y + k, z, 'purpur_pillar');
                }
                d.data(x, y + 4, z, "end_rod[facing=up]");
            }
        }
    }

    function clouds(d:Deco,r:JavaRandom,count:number):void {
        let made = 0;
        for (let attempt = 0; attempt < 200 && made < count; attempt++) {
            let x = r.nextInt(220) - 110, z = r.nextInt(220) - 110, y = 40 + r.nextInt(100);
            if (y > 146 || clearance(x, y, z) < 16) {
                continue;
            }
            made++;
            let lx = 4 + r.nextInt(6), lz = 3 + r.nextInt(4);
            for (let dx = -lx; dx <= lx; dx++) {
                for (let dz = -lz; dz <= lz; dz++) {
                    if ((dx * dx) / (lx * lx) + (dz * dz) / (lz * lz) <= 1 && Math.abs(x + dx) < 118 && Math.abs(z + dz) < 118) {
                        d.set(x + dx, y, z + dz, 'white_wool');
                        if (noise(x + dx, z + dz) < 0.4) {
                            d.set(x + dx, y + 1, z + dz, 'white_wool');
                        }
                    }
                }
            }
        }
    }

    /** A vertical column from the haze below up to {@code top}, clear of the route. Returns false when it doesn't fit. */
    function columnFits(x:number,z:number,radius:number,top:number):boolean {
        return Math.abs(x) + radius < 116 && Math.abs(z) + radius < 116 && columnClearance(x, z, -35, top + 8) > radius + 9;
    }

    function spires(d:Deco,r:JavaRandom,count:number,arches:boolean):void {
        const bands = ['terracotta', 'orange_terracotta', 'yellow_terracotta', 'white_terracotta',
                'red_terracotta', 'brown_terracotta', 'light_gray_terracotta', 'red_sandstone'];
        let made = 0;
        for (let attempt = 0; attempt < 400 && made < count; attempt++) {
            let x = r.nextInt(220) - 110, z = r.nextInt(220) - 110, top = r.nextInt(150) - 20;
            let radius = 2.5 + r.nextDouble() * 2.5;
            if (!columnFits(x, z, radius + 2, top)) {
                continue;
            }
            made++;
            for (let y = -30; y <= top; y++) {
                let rr = y > top - 4 ? radius + 1.5 : radius * (0.85 + 0.15 * Math.sin(y * 0.25));
                let m = bands[mod(Math.trunc(y / 3), bands.length)];
                d.disc(x, y, z, rr, m);
            }
        }
    }

    function basalt(d:Deco,r:JavaRandom,count:number):void {
        let made = 0;
        for (let attempt = 0; attempt < 400 && made < count; attempt++) {
            let x = r.nextInt(220) - 110, z = r.nextInt(220) - 110, top = r.nextInt(150) - 20;
            let radius = 2 + r.nextDouble() * 3;
            if (!columnFits(x, z, radius, top)) {
                continue;
            }
            made++;
            for (let y = -30; y <= top; y++) {
                let R = Math.ceil(radius);
                for (let dx = -R; dx <= R; dx++) {
                    for (let dz = -R; dz <= R; dz++) {
                        if (dx * dx + dz * dz <= (radius + 0.5) * (radius + 0.5) && y <= top - Math.trunc(noise(x + dx, z + dz) * 4)) {
                            d.log(x + dx, y, z + dz, noise(x + dx * 3, z + dz) < 0.3 ? 'polished_basalt' : 'basalt', "y");
                        }
                    }
                }
            }
            // A lava fall down one side of the taller ones.
            if (top > 40 && r.nextBoolean()) {
                let fx = x + Math.ceil(radius) + 1;
                for (let y = top - 2; y >= top - 30; y--) {
                    d.data(fx, y, z, "lava[level=0]");
                }
            }
        }
    }

    function iceSpikes(d:Deco,r:JavaRandom,count:number):void {
        let made = 0;
        for (let attempt = 0; attempt < 400 && made < count; attempt++) {
            let x = r.nextInt(220) - 110, z = r.nextInt(220) - 110, top = r.nextInt(140) - 10;
            let base = 3 + r.nextDouble() * 3.5;
            if (!columnFits(x, z, base, top)) {
                continue;
            }
            made++;
            for (let y = -30; y <= top; y++) {
                let f = Math.max(0, (top - y) / (top + 30));
                let rr = base * Math.pow(f, 0.7);
                if (rr < 0.4) {
                    d.set(x, y, z, 'packed_ice');
                    continue;
                }
                d.disc(x, y, z, rr, noise(x, y * 7 + z) < 0.25 ? 'blue_ice' : 'packed_ice');
            }
        }
    }

    function obsidian(d:Deco,r:JavaRandom,count:number):void {
        let made = 0;
        for (let attempt = 0; attempt < 400 && made < count; attempt++) {
            let x = r.nextInt(220) - 110, z = r.nextInt(220) - 110, top = r.nextInt(140) - 10;
            let radius = 2.5 + r.nextDouble() * 2;
            if (!columnFits(x, z, radius, top + 3)) {
                continue;
            }
            made++;
            for (let y = -30; y <= top; y++) {
                d.disc(x, y, z, radius, 'obsidian');
            }
            d.set(x, top + 1, z, 'bedrock');
            d.set(x, top + 2, z, 'crying_obsidian');
            d.data(x, top + 3, z, "end_rod[facing=up]");
        }
    }

    function mushrooms(d:Deco,r:JavaRandom,count:number):void {
        let made = 0;
        for (let attempt = 0; attempt < 400 && made < count; attempt++) {
            let x = r.nextInt(220) - 110, z = r.nextInt(220) - 110, top = r.nextInt(140) - 10;
            let cap = 6 + r.nextDouble() * 6;
            if (!columnFits(x, z, cap, top + 3)) {
                continue;
            }
            made++;
            let red = r.nextBoolean();
            for (let y = -30; y < top; y++) {
                d.disc(x, y, z, 1.6, 'mushroom_stem');
            }
            let R = Math.ceil(cap);
            for (let dx = -R; dx <= R; dx++) {
                for (let dz = -R; dz <= R; dz++) {
                    let dist = Math.hypot(dx, dz);
                    if (dist > cap + 0.4) {
                        continue;
                    }
                    let lift = red ? Math.round(3 * (1 - (dist / cap) * (dist / cap))) : 0;
                    let m = red ? (noise(x + dx, z + dz) < 0.1 ? 'mushroom_stem' : 'red_mushroom_block') : 'brown_mushroom_block';
                    d.set(x + dx, top + lift, z + dz, m);
                    if (red && dist > cap - 1.2) {
                        d.set(x + dx, top + lift - 1, z + dz, 'red_mushroom_block');
                    }
                }
            }
        }
    }

    function towers(d:Deco,r:JavaRandom,count:number):void {
        const glass = ['light_blue_stained_glass', 'cyan_stained_glass', 'white_stained_glass', 'gray_stained_glass'];
        const body = ['white_concrete', 'light_gray_concrete', 'quartz_block', 'gray_concrete'];
        let made = 0;
        for (let attempt = 0; attempt < 400 && made < count; attempt++) {
            let w = 7 + r.nextInt(8), l = 7 + r.nextInt(8);
            let x = r.nextInt(220 - w) - 110, z = r.nextInt(220 - l) - 110, top = r.nextInt(140) - 5;
            if (!columnFits(x + w / 2, z + l / 2, Math.max(w, l) * 0.75, top + 6)) {
                continue;
            }
            made++;
            let g = glass[r.nextInt(glass.length)], b = body[r.nextInt(body.length)];
            for (let y = -30; y <= top; y++) {
                for (let bx = x; bx < x + w; bx++) {
                    for (let bz = z; bz < z + l; bz++) {
                        let edgeX = bx == x || bx == x + w - 1, edgeZ = bz == z || bz == z + l - 1;
                        if (y == top) {
                            d.set(bx, y, bz, edgeX || edgeZ ? b : 'smooth_stone');
                        } else if (edgeX || edgeZ) {
                            d.set(bx, y, bz, edgeX && edgeZ || mod(y, 4) == 0 ? b : g);
                        }
                    }
                }
            }
            d.set(x + w / 2, top + 1, z + l / 2, 'iron_block');
            d.data(x + w / 2, top + 2, z + l / 2, "end_rod[facing=up]");
        }
    }


const bounds={minX:-120,maxX:120,minY:-70,maxY:150,minZ:-120,maxZ:120};
const canvas=new Canvas({...bounds,minY:BASE_Y+bounds.minY,maxY:BASE_Y+bounds.maxY});
layer(new Deco(canvas,0,BASE_Y,0));finishShapes(canvas);
return{path,rings,start,startDir,theme,deck:launchDeck(),stamp:canvas.pack(),bounds};
}
