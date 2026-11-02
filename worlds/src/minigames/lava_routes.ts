// Lava Climb's route generator: source generateAll/generate and clearance checks.
import { JavaRandom } from '../vanilla/java_random';
import { E,N,S,W,step as stepVec } from '../vanilla/deco';
import { Pad,JumpModel,courseKey } from './parkour';
export class LavaPad extends Pad {constructor(x:number,y:number,z:number,w:number,d:number,readonly ladderFoot:boolean){super(x,y,z,w,d);}}
export interface Tower{x:number;z:number;facing:string;y0:number;y1:number}
const cardinal=(x:number,z:number)=>Math.abs(x)>=Math.abs(z)?(x>0?E:W):(z>0?S:N);
const CORE=4,CRATER=13,SUMMIT=44,ROUTES=3,JUMP_LIMIT=.72;
const inDisc=(x:number,z:number,r:number)=>x*x+z*z<=(r+.5)**2;
const routeAngle=(route:number)=>route*Math.PI*2/3+.22;
const gap=(a0:number,a1:number,b0:number,b1:number)=>Math.max(0,b0-a1-1,a0-b1-1);
const possible=(gx:number,gz:number,dy:number,limit:number)=>Math.hypot(Math.max(0,gx-.6),Math.max(0,gz-.6))/JumpModel.NORMAL.maxTravel(dy)<=limit;
export function lavaRoutes(seed:number){
const towers:Tower[]=[];
const makeTower=(x:number,z:number,facing:string,y0:number,y1:number):Tower=>({x,z,facing,y0,y1});
    function generateAll(seed:number):{routes:LavaPad[][];towers:Tower[]} {
        for (let layout = 0; layout < 20; layout++) {
            let r = new JavaRandom(seed * 31 + layout);
            let used = new Set<number>();
            let all = [];
            towers.length=0;
            for (let route = 0; route < ROUTES; route++) {
                let path:LavaPad[]|null=null;
                for (let attempt = 0; attempt < 300 && path == null; attempt++) {
                    let trial = new Set(used);
                    let towersBefore = towers.length;
                    path = generate(r, route, trial);
                    if (path == null) {
                        towers.length=towersBefore;
                    } else {
                        used = trial;
                    }
                }
                if (path == null) {
                    break;
                }
                all.push(path);
            }
            if (all.length == ROUTES) {
                return {routes:all,towers};
            }
        }
        throw new Error("Lava Climb: no valid route layout");
    }

    /**
     * One route, confined to its own third of the crater so routes never cross: sprint jumps
     * zigzag across the sector (inner band one way, outer band back), and each turn is a ladder
     * tower. Every jump is proved possible with {@link Jumps}; pads keep their head room. Returns
     * null when this attempt paints itself into a corner.
     */
    function generate(r:JavaRandom,route:number,used:Set<number>):LavaPad[]|null {
        let path = [];
        let from = routeAngle(route), to = from + Math.PI * 2 / ROUTES - 0.44;
        let direction = 1;
        let outer = false;
        let angle = from;
        let y = -1;
        // The crater floor (y = -1) is the first "pad": every first jump starts from it.
        let previous:LavaPad = new LavaPad(-CRATER, -1, -CRATER, 2 * CRATER + 1, 2 * CRATER + 1, false);
        while (!reachesSummit(previous)) {
            if (path.length > 120) {
                return null;
            }
            let finale = y >= SUMMIT - 8;
            let next:LavaPad|null=null;
            let tower:Tower|null=null;
            let reversed = false;
            for (let attempt = 0; attempt < 80 && next == null; attempt++) {
                let dy = y >= SUMMIT - 1 ? 0 : r.nextDouble() < 0.72 ? 1 : 0;
                let size = y < 14 ? 2 : r.nextDouble() < 0.4 ? 1 : 2;
                let rad = finale ? 6.3 + r.nextDouble() * (y >= SUMMIT - 3 ? 0.9 : 2.2) : outer ? 9.2 + r.nextDouble() * 1.2 : 6.7 + r.nextDouble() * 0.9;
                let step = 2.4 + r.nextDouble() * 1.3 + (size == 1 ? 0.3 : 0);
                let flip = finale && r.nextDouble() < 0.3;
                let a = angle + (flip ? -direction : direction) * step / rad;
                let turn = !finale && (direction > 0 ? a > to : a < from) && path.length !== 0;
                // The last stretch roams freely round the summit (the clearance map keeps routes apart).
                if (!finale && !turn && (a > to + 0.05 || a < from - 0.05)) {
                    a = Math.max(from, Math.min(to, a));
                }
                let candidate;
                let candidateTower:Tower|null=null;
                if (turn && y > SUMMIT - 9) {
                    // Too high for another tower: switch bands with an ordinary jump and head back.
                    let ta = direction > 0 ? to : from;
                    let tr = outer ? 6.8 + r.nextDouble() * 0.6 : 9.3 + r.nextDouble() * 0.8;
                    candidate = new LavaPad(Math.round(Math.cos(ta) * tr), y + dy, Math.round(Math.sin(ta) * tr), size, size, false);
                    a = ta;
                    rad = tr;
                } else if (turn) {
                    // A ladder tower at the end of the sector, in the other band.
                    let ta = (direction > 0 ? to : from) - direction * r.nextDouble() * 0.18;
                    let tr = outer ? 6.8 + r.nextDouble() * 0.7 : 9.2 + r.nextDouble() * 1.0;
                    let cx = Math.round(Math.cos(ta) * tr), cz = Math.round(Math.sin(ta) * tr);
                    let facing = cardinal(previous.x + previous.w / 2.0 - cx, previous.z + previous.d / 2.0 - cz);
                    let f = stepVec(facing);
                    candidate = new LavaPad(cx + f[0], y + dy, cz + f[2], 1, 1, true);
                    candidateTower = makeTower(cx, cz, facing, y + dy, y + dy + 5);
                    a = ta;
                    rad = tr;
                } else {
                    candidate = new LavaPad(Math.round(Math.cos(a) * rad), y + dy, Math.round(Math.sin(a) * rad), size, size, false);
                }
                let fromFloor = path.length === 0;
                if (fromFloor && dy != 1) {
                    continue;
                }
                let gx = gap(previous.x, previous.x + previous.w - 1, candidate.x, candidate.x + candidate.w - 1);
                let gz = gap(previous.z, previous.z + previous.d - 1, candidate.z, candidate.z + candidate.d - 1);
                let overlapX = candidate.x <= previous.x + previous.w - 1 && previous.x <= candidate.x + candidate.w - 1;
                let overlapZ = candidate.z <= previous.z + previous.d - 1 && previous.z <= candidate.z + candidate.d - 1;
                if (!fromFloor && (overlapX && overlapZ || !possible(gx, gz, dy, JUMP_LIMIT) || gx > 3 || gz > 3)) {
                    continue;
                }
                if (!free(candidate, used) || candidateTower != null && !towerFree(candidateTower, used)) {
                    continue;
                }
                next = candidate;
                tower = candidateTower;
                angle = a;
                reversed = flip;
            }
            if (next == null) {
                return null;
            }
            occupy(next, used);
            if (reversed) {
                direction = -direction;
            }
            path.push(next);
            y = next.y;
            previous = next;
            if (tower == null && next.y > SUMMIT - 9 && (direction > 0 ? angle >= to - 0.01 : angle <= from + 0.01)) {
                direction = -direction;
                outer = !outer;
            }
            if (tower != null) {
                towers.push(tower);
                let f = stepVec(tower.facing);
                for (let ly = tower.y0; ly <= tower.y1 + 4; ly++) {
                    used.add(courseKey(tower.x, ly, tower.z));
                    used.add(courseKey(tower.x + f[0], ly, tower.z + f[2]));
                }
                // The top of the tower is the next take-off pad.
                let top = new LavaPad(tower.x, tower.y1, tower.z, 1, 1, false);
                path.push(top);
                previous = top;
                y = top.y;
                direction = -direction;
                outer = !outer;
            }
        }
        return path;
    }

    function towerFree(tower:Tower,used:Set<number>):boolean {
        let f = stepVec(tower.facing);
        for (let y = tower.y0 - 1; y <= tower.y1 + 4; y++) {
            for(const cell of [[tower.x, tower.z], [tower.x + f[0], tower.z + f[2]]]) {
                if (y > tower.y0 && used.has(courseKey(cell[0], y, cell[1]))) {
                    return false;
                }
            }
        }
        let r = Math.hypot(tower.x, tower.z);
        return r >= CORE + 2.2 && r < CRATER - 1;
    }

    function countAtTop(path:LavaPad[]):number {
        let n = 0;
        for(const pad of path) {
            n += pad.y >= SUMMIT - 1 ? 1 : 0;
        }
        return n;
    }

    /** From this pad, can a player jump onto the summit (treated as its inscribed square)? */
    function reachesSummit(pad:LavaPad):boolean {
        if (pad.y < SUMMIT - 1) {
            return false;
        }
        for (let x = -5; x <= 5; x++) {
            for (let z = -5; z <= 5; z++) {
                if (!inDisc(x, z, 5)) {
                    continue;
                }
                let gx = gap(pad.x, pad.x + pad.w - 1, x, x), gz = gap(pad.z, pad.z + pad.d - 1, z, z);
                if (gx + gz > 0 && possible(gx, gz, SUMMIT - pad.y, JUMP_LIMIT)) {
                    return true;
                }
            }
        }
        return false;
    }

    /** Nothing already placed in or just above this box. */
    function clearOf(pad:LavaPad,used:Set<number>):boolean {
        for (let x = pad.x; x < pad.x + pad.w; x++) {
            for (let z = pad.z; z < pad.z + pad.d; z++) {
                for (let y = pad.y - 2; y <= pad.y + 3; y++) {
                    if (used.has(courseKey(x, y, z))) {
                        return false;
                    }
                }
            }
        }
        return true;
    }

    function free(pad:LavaPad,used:Set<number>):boolean {
        for (let x = pad.x - 1; x <= pad.x + pad.w; x++) {
            for (let z = pad.z - 1; z <= pad.z + pad.d; z++) {
                for (let y = pad.y - 3; y <= pad.y + 3; y++) {
                    if (used.has(courseKey(x, y, z))) {
                        return false;
                    }
                }
            }
        }
        // Clear of the spire (ladder feet stand right next to it) and inside the crater.
        let nearest = Number.MAX_VALUE, farthest = 0;
        for (let x = pad.x; x < pad.x + pad.w; x++) {
            for (let z = pad.z; z < pad.z + pad.d; z++) {
                nearest = Math.min(nearest, Math.hypot(x, z));
                farthest = Math.max(farthest, Math.hypot(x, z));
            }
        }
        return nearest >= (pad.ladderFoot ? CORE + 1.5 : CORE + 2.2) && farthest < CRATER - 1;
    }

    function occupy(pad:LavaPad,used:Set<number>):void {
        for (let x = pad.x; x < pad.x + pad.w; x++) {
            for (let z = pad.z; z < pad.z + pad.d; z++) {
                for (let y = pad.y; y <= pad.y + 3; y++) {
                    used.add(courseKey(x, y, z));
                }
            }
        }
    }


void [countAtTop,clearOf];return generateAll(seed);
}
