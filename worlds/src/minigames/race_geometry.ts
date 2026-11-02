// Generated-course scenery, ported from the source arena methods.
import { Deco, N } from '../vanilla/deco';
import { JavaRandom } from '../vanilla/java_random';
import { noise } from './buildings';
import { Pad } from './parkour';
import type { Course, Stop } from './parkour_course';
const mod=(x:number,n:number)=>((x%n)+n)%n;
void [N,Pad,mod];

export function sceneryCrumblingRuins(d:Deco,course:Course):void{
const {stops,legs,rng:r}=course;void legs;
const STONES=['stone_bricks','mossy_stone_bricks','mossy_cobblestone','chiseled_stone_bricks','polished_andesite','mossy_stone_bricks'];
function clearOfCourse(x:number,z:number,gap:number,y0:number,y1:number){
 for(const s of stops)if(Math.hypot(s.x-x,s.z-z)<s.r+gap+2&&s.y+6>=y0&&s.y-8<=y1)return false;
 for(const p of legs.flat())if(Math.hypot(p.cx()-x,p.cz()-z)<gap+1.5&&p.y+5>=y0&&p.y-3<=y1)return false;
 return true;
}
    function island(d: Deco,r: JavaRandom,index: number): void {
        let stop = stops[index];
        let R = Math.ceil(stop.r);
        for (let x = -R; x <= R; x++) {
            for (let z = -R; z <= R; z++) {
                let dist = Math.sqrt(x * x + z * z);
                if (dist > stop.r + 0.5) {
                    continue;
                }
                let n = noise(stop.x + x, stop.z + z);
                let top = n < 0.4 ? 'stone_bricks' : n < 0.65 ? 'mossy_stone_bricks' : n < 0.8 ? 'cracked_stone_bricks'
                        : n < 0.92 ? 'moss_block' : 'chiseled_stone_bricks';
                if (index == stops.length - 1 && dist < 2.6) {
                    top = 'gold_block';
                }
                d.set(stop.x + x, stop.y, stop.z + z, top);
                let depth = Math.round((stop.r + 0.5 - dist) * 1.3 + noise(stop.x + x * 3, stop.z + z) * 2);
                for (let y = 1; y <= depth; y++) {
                    let m = noise(stop.x + x, stop.y - y + stop.z * 7 + z);
                    d.set(stop.x + x, stop.y - y, stop.z + z, m < 0.5 ? 'stone' : m < 0.75 ? 'andesite' : m < 0.9 ? 'dirt' : 'cobblestone');
                }
                if (depth >= 2 && noise(stop.x * 3 + x, stop.z + z * 5) < 0.06) {
                    d.data(stop.x + x, stop.y - depth - 1, stop.z + z, "hanging_roots[waterlogged=false]");
                }
            }
        }
        // Broken pillars on the edge, never where a lane leaves or arrives.
        for (let i = 0; i < 7; i++) {
            let a = r.nextDouble() * Math.PI * 2;
            if (nearLane(index, a)) {
                continue;
            }
            let px = stop.x + Math.round(Math.cos(a) * (stop.r - 0.6)), pz = stop.z + Math.round(Math.sin(a) * (stop.r - 0.6));
            let h = 2 + r.nextInt(4);
            for (let y = 1; y <= h; y++) {
                d.set(px, stop.y + y, pz, y == h && r.nextBoolean() ? 'chiseled_stone_bricks' : r.nextInt(4) == 0
                        ? 'cracked_stone_bricks' : 'stone_bricks');
            }
        }
        if (index == stops.length - 1) {
            d.set(stop.x, stop.y + 1, stop.z, 'chiseled_stone_bricks');
            d.bell(stop.x, stop.y + 2, stop.z);
        } else {
            for (let i = 0; i < 24; i++) {
                let a = Math.PI * 2 * i / 24;
                if (!nearLane(index, a)) {
                    let fx = stop.x + Math.round(Math.cos(a) * (stop.r - 1.2)), fz = stop.z + Math.round(Math.sin(a) * (stop.r - 1.2));
                    d.flag(fx, stop.y + 1, fz, index == 0 ? 5 : 4, index == 0 ? "white" : "lime", N);
                    break;
                }
            }
        }
    }

    /** Is angle {@code a} (from this island's centre) close to where a leg leaves or arrives? */
    function nearLane(index: number,a: number): boolean {
        let stop = stops[index];
        for (const other of [index - 1, index + 1]) {
            if (other < 0 || other >= stops.length) {
                continue;
            }
            let b = Math.atan2(stops[other].z - stop.z, stops[other].x - stop.x);
            let diff = Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
            if (diff < 1.05) {
                return true;
            }
        }
        return false;
    }

    /** Giant broken columns rising out of the haze, floating rubble and a ruined arch or two. */
    function scenery(d: Deco,r: JavaRandom,used: Set<number>): void {
        let columns = 0;
        for (let attempt = 0; attempt < 200 && columns < 16; attempt++) {
            let x = r.nextInt(220) - 110, z = r.nextInt(220) - 110;
            let top = 5 + r.nextInt(55);
            if (!clearOfCourse(x, z, 5.5, -40, top + 4)) {
                continue;
            }
            columns++;
            let radius = 1.6 + r.nextDouble() * 1.4;
            for (let y = -40; y <= top; y++) {
                let yy = y;
                let broken = y > top - 4 ? (top - y) / 4.0 : 1;
                let R = Math.ceil(radius);
                for (let dx = -R; dx <= R; dx++) {
                    for (let dz = -R; dz <= R; dz++) {
                        let dist = Math.sqrt(dx * dx + dz * dz);
                        if (dist > radius + 0.3 || broken < 1 && noise(x + dx * 7 + yy, z + dz) > broken + 0.15) {
                            continue;
                        }
                        let flute = dist > radius - 0.7 && mod(dx * 3 + dz * 5, 4) == 0;
                        d.set(x + dx, yy, z + dz, flute ? 'smooth_quartz' : noise(x + dx, yy * 13 + z + dz) < 0.2
                                ? 'mossy_stone_bricks' : 'quartz_bricks');
                    }
                }
            }
        }
        let rubble = 0;
        for (let attempt = 0; attempt < 400 && rubble < 60; attempt++) {
            let x = r.nextInt(224) - 112, z = r.nextInt(224) - 112, y = r.nextInt(80) - 10;
            if (!clearOfCourse(x, z, 4, y - 3, y + 3)) {
                continue;
            }
            rubble++;
            let size = 1 + r.nextInt(3);
            for (let i = 0; i < size * 3; i++) {
                let bx = x + r.nextInt(size + 1), by = y + r.nextInt(size), bz = z + r.nextInt(size + 1);
                d.set(bx, by, bz, STONES[r.nextInt(STONES.length)]);
            }
        }
    }


for(let i=0;i<stops.length;i++)island(d,r,i);scenery(d,r,new Set());
}

export function sceneryNeonBlink(d:Deco,course:Course):void{
const {stops,legs,rng:r}=course;void legs;
const neon=['magenta_concrete','cyan_concrete','lime_concrete','yellow_concrete','pink_concrete','light_blue_concrete'];
function clearOfCourse(x:number,z:number,gap:number,y0:number,y1:number){
 for(const s of stops)if(Math.hypot(s.x-x,s.z-z)<s.r+gap+2&&s.y+6>=y0&&s.y-8<=y1)return false;
 for(const p of legs.flat())if(Math.hypot(p.cx()-x,p.cz()-z)<gap+1.5&&p.y+5>=y0&&p.y-3<=y1)return false;
 return true;
}
    function tower(d: Deco,stop: Stop,trim: string,finish: boolean): void {
        let R = Math.ceil(stop.r);
        for (let x = -R; x <= R; x++) {
            for (let z = -R; z <= R; z++) {
                let dist = Math.sqrt(x * x + z * z);
                if (dist > stop.r + 0.5) {
                    continue;
                }
                let rim = dist > stop.r - 0.5;
                d.set(stop.x + x, stop.y, stop.z + z, finish ? (rim ? 'gold_block' : (x + z & 1) == 0 ? 'white_concrete' : 'black_concrete')
                        : rim ? trim : dist < 1.5 ? 'sea_lantern' : 'polished_blackstone');
                if (rim) {
                    for (let y = -25; y < stop.y; y++) {
                        let band = mod(y - stop.y, 9) == 1;
                        let window = !band && mod(y, 3) != 0 && mod(x * 3 + z * 7, 4) == 0;
                        d.set(stop.x + x, y, stop.z + z, band ? trim : window ? 'light_gray_stained_glass' : 'black_concrete');
                    }
                }
            }
        }
    }

    /** Box towers of dark glass and concrete with lit windows and neon roof trim, all clear of the course. */
    function skyline(d: Deco,r: JavaRandom,neon: string[]): void {
        let built = 0;
        for (let attempt = 0; attempt < 300 && built < 18; attempt++) {
            let w = 6 + r.nextInt(7), l = 6 + r.nextInt(7);
            let x0 = r.nextInt(228 - w) - 114, z0 = r.nextInt(228 - l) - 114;
            let top = 10 + r.nextInt(90);
            let cx = x0 + w / 2.0, cz = z0 + l / 2.0;
            if (!clearOfCourse(cx, cz, Math.max(w, l) / 2.0 + 5, -25, top + 6)) {
                continue;
            }
            built++;
            let trim = neon[r.nextInt(neon.length)];
            let body = r.nextBoolean() ? 'black_concrete' : 'gray_concrete';
            let window = r.nextInt(3) == 0 ? 'yellow_stained_glass' : r.nextBoolean() ? 'light_blue_stained_glass' : 'white_stained_glass';
            for (let y = -25; y <= top; y++) {
                for (let x = x0; x < x0 + w; x++) {
                    for (let z = z0; z < z0 + l; z++) {
                        let edgeX = x == x0 || x == x0 + w - 1, edgeZ = z == z0 || z == z0 + l - 1;
                        if (!edgeX && !edgeZ && y != top) {
                            continue;
                        }
                        let m;
                        if (y == top) {
                            m = edgeX || edgeZ ? trim : body;
                        } else if (edgeX && edgeZ) {
                            m = body;
                        } else {
                            let lit = mod(y, 4) != 0 && mod(edgeX ? z : x, 2) == 0;
                            m = lit ? (noise(x * 5 + y, z) < 0.15 ? 'sea_lantern' : window) : body;
                        }
                        d.set(x, y, z, m);
                    }
                }
            }
            if (r.nextInt(3) == 0) {
                let ax = x0 + Math.trunc(w / 2), az = z0 + Math.trunc(l / 2);
                for (let y = top + 1; y <= top + 4 + r.nextInt(5); y++) {
                    d.set(ax, y, az, 'iron_bars');
                }
                d.set(ax, top + 9, az, 'redstone_lamp');
            }
        }
        // Floating neon signs.
        let signs = 0;
        for (let attempt = 0; attempt < 200 && signs < 10; attempt++) {
            let x = r.nextInt(200) - 100, z = r.nextInt(200) - 100, y = 20 + r.nextInt(70);
            let alongX = r.nextBoolean();
            if (!clearOfCourse(x, z, 9, y - 3, y + 6)) {
                continue;
            }
            signs++;
            let a = neon[r.nextInt(neon.length)], b = neon[r.nextInt(neon.length)];
            for (let i = -4; i <= 4; i++) {
                for (let j = 0; j < 4; j++) {
                    let frame = Math.abs(i) == 4 || j == 0 || j == 3;
                    let m = frame ? a : (i + j & 1) == 0 ? b : 'black_concrete';
                    if (alongX) {
                        d.set(x + i, y + j, z, m);
                    } else {
                        d.set(x, y + j, z + i, m);
                    }
                }
            }
        }
    }


for(let i=0;i<stops.length;i++)tower(d,stops[i],neon[r.nextInt(neon.length)],i===stops.length-1);skyline(d,r,neon);
}

export function sceneryLunarLeap(d:Deco,course:Course):void{
const {stops,legs,rng:r}=course;void legs;
const ROCK=['end_stone','end_stone_bricks','tuff','smooth_basalt','calcite','deepslate','blackstone'];
function clearOfCourse(x:number,z:number,gap:number,y0:number,y1:number){
 for(const s of stops)if(Math.hypot(s.x-x,s.z-z)<s.r+gap+2&&s.y+6>=y0&&s.y-8<=y1)return false;
 for(const p of legs.flat())if(Math.hypot(p.cx()-x,p.cz()-z)<gap+1.5&&p.y+5>=y0&&p.y-3<=y1)return false;
 return true;
}
    function asteroid(d: Deco,r: JavaRandom,pad: Pad): void {
        let a = ROCK[r.nextInt(ROCK.length)], b = ROCK[r.nextInt(ROCK.length)];
        for (let x = pad.x; x <= pad.x1(); x++) {
            for (let z = pad.z; z <= pad.z1(); z++) {
                d.set(x, pad.y, z, noise(x, z) < 0.7 ? a : b);
                let inner = x > pad.x && x < pad.x1() && z > pad.z && z < pad.z1();
                let depth = (inner ? 2 : 1) + (noise(x * 3, z * 5) < 0.4 ? 1 : 0);
                for (let y = 1; y <= depth && pad.w > 1; y++) {
                    d.set(x, pad.y - y, z, y == depth && noise(x, z * 3) < 0.15 ? 'amethyst_block' : b);
                }
            }
        }
        // A crater dimple on bigger rocks, never in the middle of the landing spot.
        if (pad.w >= 4 && pad.d >= 4 && r.nextBoolean()) {
            d.set(pad.x, pad.y, pad.z, 'crying_obsidian');
        }
    }

    /** A station deck: white plating, a lit rim, an antenna on the side away from the paths. */
    function station(d: Deco,r: JavaRandom,stop: Stop,index: number): void {
        let finish = index == stops.length - 1;
        let R = Math.ceil(stop.r);
        for (let x = -R; x <= R; x++) {
            for (let z = -R; z <= R; z++) {
                let dist = Math.sqrt(x * x + z * z);
                if (dist > stop.r + 0.5) {
                    continue;
                }
                let rim = dist > stop.r - 0.5;
                let top = finish ? (rim ? 'gold_block' : 'end_stone')
                        : rim ? 'purpur_pillar' : (x + z & 1) == 0 ? 'smooth_quartz' : 'white_concrete';
                if (top == 'purpur_pillar') {
                    d.log(stop.x + x, stop.y, stop.z + z, top, "y");
                } else {
                    d.set(stop.x + x, stop.y, stop.z + z, top);
                }
                if (dist < stop.r - 1.5) {
                    d.set(stop.x + x, stop.y - 1, stop.z + z, finish ? 'end_stone' : 'iron_block');
                    if (dist < 1.6) {
                        d.set(stop.x + x, stop.y - 2, stop.z + z, 'sea_lantern');
                    }
                }
            }
        }
        // Antenna or flag on the far side from both legs.
        let away = awayAngle(index);
        let ax = stop.x + Math.round(Math.cos(away) * (stop.r - 1)), az = stop.z + Math.round(Math.sin(away) * (stop.r - 1));
        if (finish) {
            for (let y = 1; y <= 6; y++) {
                d.set(ax, stop.y + y, az, 'iron_bars');
            }
            d.data(ax + 1, stop.y + 6, az, "white_wool");
            d.data(ax + 2, stop.y + 6, az, "red_wool");
            d.data(ax + 1, stop.y + 5, az, "blue_wool");
            d.data(ax + 2, stop.y + 5, az, "white_wool");
        } else {
            for (let y = 1; y <= 4; y++) {
                d.set(ax, stop.y + y, az, 'lightning_rod');
            }
            d.data(ax, stop.y + 5, az, "end_rod[facing=up]");
        }
    }

    /** The angle (from a stop's centre) furthest from the legs that arrive and leave. */
    function awayAngle(index: number): number {
        let stop = stops[index];
        let sx = 0, sz = 0;
        for (const other of [index - 1, index + 1]) {
            if (other >= 0 && other < stops.length) {
                let a = Math.atan2(stops[other].z - stop.z, stops[other].x - stop.x);
                sx += Math.cos(a);
                sz += Math.sin(a);
            }
        }
        return Math.atan2(-sz, -sx);
    }

    /** A planet with a ring, drifting debris and stars. */
    function space(d: Deco,r: JavaRandom): void {
        // The planet sits low in a corner, well away from the course.
        for (let attempt = 0; attempt < 40; attempt++) {
            let radius = 18 + r.nextInt(6);
            let reach = 118 - radius - 12;
            let px = (r.nextBoolean() ? 1 : -1) * (reach - r.nextInt(25)), pz = (r.nextBoolean() ? 1 : -1) * (reach - r.nextInt(25));
            let py = -30 + r.nextInt(30);
            if (!clearOfCourse(px, pz, radius + 14, py - radius, py + radius + 10)) {
                continue;
            }
            planet(d, r, px, py, pz, radius);
            break;
        }
        let rocks = 0;
        for (let attempt = 0; attempt < 300 && rocks < 30; attempt++) {
            let x = r.nextInt(220) - 110, z = r.nextInt(220) - 110, y = r.nextInt(120) - 20;
            if (!clearOfCourse(x, z, 7, y - 4, y + 4)) {
                continue;
            }
            rocks++;
            let size = 1 + r.nextDouble() * 2.5;
            let m = ROCK[r.nextInt(ROCK.length)];
            let R = Math.ceil(size);
            for (let dx = -R; dx <= R; dx++) {
                for (let dy = -R; dy <= R; dy++) {
                    for (let dz = -R; dz <= R; dz++) {
                        if (dx * dx + dy * dy * 1.6 + dz * dz <= size * size) {
                            d.set(x + dx, y + dy, z + dz, m);
                        }
                    }
                }
            }
        }
        // Stars: glowing specks scattered high and far.
        for (let i = 0; i < 220; i++) {
            let x = r.nextInt(236) - 118, z = r.nextInt(236) - 118, y = 100 + r.nextInt(48);
            if (Math.abs(x) < 100 && Math.abs(z) < 100 && y < 120) {
                continue;
            }
            d.set(x, y, z, r.nextInt(5) == 0 ? 'sea_lantern' : 'glowstone');
        }
    }

    function planet(d: Deco,r: JavaRandom,cx: number,cy: number,cz: number,radius: number): void {
        let tilt = r.nextDouble() * 0.6 - 0.3;
        let earth = r.nextBoolean();
        for (let x = -radius; x <= radius; x++) {
            for (let y = -radius; y <= radius; y++) {
                for (let z = -radius; z <= radius; z++) {
                    let dist = Math.sqrt(x * x + y * y + z * z);
                    if (dist > radius + 0.5 || dist < radius - 1.2) {
                        continue;
                    }
                    let n = Math.sin(x * 0.21 + y * 0.13) + Math.cos(z * 0.19 - y * 0.17) + Math.sin((x + z) * 0.09);
                    let m;
                    if (earth) {
                        m = Math.abs(y) > radius * 0.85 ? 'snow_block' : n > 0.9 ? 'grass_block' : n > 0.6 ? 'moss_block'
                                : n < -1.6 ? 'white_concrete' : 'blue_concrete';
                    } else {
                        let band = Math.sin(y * 0.5 + n * 0.6);
                        m = band > 0.6 ? 'orange_terracotta' : band > 0 ? 'yellow_terracotta' : band > -0.6 ? 'white_terracotta'
                                : 'brown_terracotta';
                    }
                    d.set(cx + x, cy + y, cz + z, m);
                }
            }
        }
        // A thin tilted ring.
        let inner = radius + 6, outer = radius + 11;
        let R = Math.ceil(outer);
        for (let x = -R; x <= R; x++) {
            for (let z = -R; z <= R; z++) {
                let dist = Math.sqrt(x * x + z * z);
                if (dist >= inner && dist <= outer && noise(cx + x, cz + z) < 0.8) {
                    let y = Math.round(x * tilt);
                    d.set(cx + x, cy + y, cz + z, dist > outer - 1.5 ? 'light_gray_concrete' : 'quartz_block');
                }
            }
        }
    }

for(const p of legs.flat())asteroid(d,r,p);for(let i=0;i<stops.length;i++)station(d,r,stops[i],i);space(d,r);
}
