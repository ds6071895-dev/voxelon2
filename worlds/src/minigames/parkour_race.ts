import { scaleInt } from '../minigames_rules';
import { Minigame, yawToward } from './game';
import { type Course, type Stop, type Layout, layCourse } from './parkour_course';
import { type ParkourSpec, type Pad } from './parkour';
import { JavaRandom } from '../vanilla/java_random';
import { BASE_Y, type ArenaDef } from './arena';
import type { Deco } from '../vanilla/deco';
export const COURSE_BOX={minX:-120,maxX:120,minY:-70,maxY:150,minZ:-120,maxZ:120};
const cache=new Map<string,Course>();
export function generatedCourse(id:string,seed:number,mult:number,layout:Layout,spec:ParkourSpec):Course{
  const key=`${id}:${seed}`,known=cache.get(key);if(known)return {...known,rng:known.rng.clone()};
  for(let attempt=0;attempt<80;attempt++){const c=layCourse(new JavaRandom(BigInt(seed)*BigInt(mult)+BigInt(attempt)),layout,spec);if(c){if(cache.size>24)cache.delete(cache.keys().next().value!);cache.set(key,{...c,rng:c.rng.clone()});return c;}}
  throw new Error(`${id}: no course for seed ${seed}`);
}
export abstract class ParkourRace extends Minigame {
  graceSeconds(){return scaleInt(this.participants.size,35,60);}
  abstract readonly course:Course;
  abstract readonly arena:ArenaDef;
  readonly reached=new Map<number,number>();readonly falls=new Map<number,number>();
  get stops(){return this.course.stops;} get legs(){return this.course.legs;} get pads(){return this.legs.flat();}
  spawns(count:number){const start=this.stops[0],next=this.stops[1],yaw=yawToward(start.x,start.z,next.x,next.z);return Array.from({length:Math.max(1,count)},(_,i)=>{const a=Math.PI*2*i/Math.max(1,count),r=count===1?0:Math.min(Math.max(0,start.r-2.5),1.2+count*.25);return this.at(start.x+.5+Math.cos(a)*r,start.y+1,start.z+.5+Math.sin(a)*r,yaw);});}
  spectate(){const ss=this.stops,top=Math.max(0,...ss.map(s=>s.y));return this.at(Math.max(-105,Math.min(105,ss.reduce((a,s)=>a+s.x,0)/ss.length))+.5,Math.min(140,top+28),Math.max(-105,Math.min(105,ss.reduce((a,s)=>a+s.z,0)/ss.length+40))+.5);}
  fallY(){return Math.min(...this.stops.map(s=>s.y),...this.pads.map(p=>p.y))-12;}
  setup(ids:number[]){for(const id of ids){this.reached.set(id,0);this.kit(id);}}
  kit(_id:number){}
  tick(){for(const id of this.players()){
    const b=this.m.host.body(id)!;let stop=this.reached.get(id)??0;
    const low=Math.min(this.stops[stop].y,this.stops[Math.min(stop+1,this.stops.length-1)].y,...(this.legs[stop]??[]).map(p=>p.y));
    if(this.dy(b.y)<low-5){this.onFall(id);continue;}
    for(let i=stop+1;i<this.stops.length;i++){const s=this.stops[i];if(Math.hypot(b.x-s.x-.5,b.z-s.z-.5)<=s.r+.6&&this.dy(b.y)>=s.y+.9&&this.dy(b.y)<s.y+4){this.reached.set(id,i);stop=i;if(i===this.stops.length-1)this.finishRace(id);else {this.m.title(id,'Checkpoint',`${i}/${this.stops.length-2}`,'#37b768');this.m.sound('bell',b);}break;}}
    if(!this.alive.has(id))continue;
    const next=this.stops[stop+1];if(next)this.progress.set(id,stop*1000+Math.max(0,999-Math.hypot(b.x-next.x,b.z-next.z)));
    this.racerTick(id,stop);
  }}
  racerTick(_id:number,_stop:number){}
  onFall(id:number){this.falls.set(id,(this.falls.get(id)??0)+1);this.respawn(id);}
  respawn(id:number){const i=this.reached.get(id)??0,s=this.stops[i],next=this.stops[Math.min(i+1,this.stops.length-1)],a=this.random()*Math.PI*2,r=this.random()*Math.max(0,s.r-2.5);this.m.host.teleport(id,s.x+.5+Math.cos(a)*r,BASE_Y+s.y+1,s.z+.5+Math.sin(a)*r,yawToward(s.x,s.z,next.x,next.z));const p=this.m.sim.players.get(id)!;p.fire=0;p.fallDist=0;this.kit(id);}
  bar(id:number){const stop=this.reached.get(id)??0;return `${stop>=this.stops.length-2?'Final stretch':`Checkpoint ${stop}/${this.stops.length-2}`} · Falls: ${this.falls.get(id)??0}`;}
  progressDetail(id:number){const stop=this.reached.get(id)??0;return stop===0?'no checkpoints':`checkpoint ${stop}`;}
}
export function drawPad(d:Deco,p:Pad,material:string){d.fill(p.x,p.y,p.z,p.x1(),p.y,p.z1(),material);}
export function onStop(s:Stop,x:number,y:number,z:number){return Math.hypot(x-s.x-.5,z-s.z-.5)<=s.r+.6&&y>=s.y+.9&&y<s.y+4;}
