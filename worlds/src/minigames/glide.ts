import { Minigame,yawToward } from './game';
import { glideCourse,type Ring } from './glide_course';
import { BASE_Y,type ArenaDef } from './arena';
import { vi } from '../vanilla/items';
import type { MAction } from '../vanilla/messages';
const side=(r:Ring,p:number[])=>(p[0]-r.x)*r.nx+(p[1]-r.y-.9)*r.ny+(p[2]-r.z)*r.nz;
export class ElytraRally extends Minigame{
  readonly id='glide';readonly arena:ArenaDef;readonly course;
  readonly nextRing=new Map<number,number>();readonly resets=new Map<number,number>();
  private previous=new Map<number,number[]>();private grounded=new Map<number,number>();private lost=new Map<number,number>();
  constructor(seed=0){super();this.course=glideCourse(seed);this.arena={id:this.id,bounds:this.course.bounds,stamp:this.course.stamp,build:()=>{}};}
  spawns(n:number){const [x,y,z]=this.course.deck,d=this.course.startDir;return Array.from({length:Math.max(1,n)},(_,i)=>{const a=Math.PI*2*i/Math.max(1,n),r=n===1?0:Math.min(5,1.2+.35*n);return this.at(x+.5+Math.cos(a)*r,y+1,z+.5+Math.sin(a)*r,yawToward(0,0,d[0],d[2]));});}
  spectate(){const s=this.course.start;return this.at(s[0]+.5,s[1]+12,s[2]+.5);}
  fallY(){return -60;}
  guidance(id:number){const r=this.course.rings[this.nextRing.get(id)??0];return r?{...r,y:BASE_Y+r.y+.9}:null;}
  setup(ids:number[]){for(const id of ids){this.setSlot(id,37,{id:vi('elytra'),count:1,name:'Glider'});this.setSlot(id,0,{id:vi('firework_rocket'),count:16,name:'Boost Rocket'});this.setSlot(id,8,{id:vi('compass'),count:1,name:'Back on course'});this.nextRing.set(id,0);}}
  begin(){const d=this.course.startDir;for(const id of this.players()){this.m.host.launch(id,d[0]*22,11,d[2]*22);this.m.later(5,()=>{if(this.alive.has(id))this.m.sim.players.get(id)!.gliding=true;});}}
  private giveRockets(id:number,n:number){const p=this.m.sim.players.get(id)!;let total=n;for(let i=0;i<p.inv.slots.length;i++){const s=p.inv.slots[i];if(s?.id===vi('firework_rocket')){total+=s.count;p.inv.slots[i]=null;}}this.setSlot(id,0,{id:vi('firework_rocket'),count:Math.min(64,total),name:'Boost Rocket'});}
  onAction(id:number,a:MAction){if(a.k==='use'&&this.m.sim.players.get(id)?.inv.slots[a.slot]?.id===vi('compass')){if((this.nextRing.get(id)??0)>0||this.t>=40)this.relaunch(id,'Back on course');return true;}return false;}
  tick(){for(const id of this.players()){
    const b=this.m.host.body(id)!,p=this.m.sim.players.get(id)!,now=[b.x,this.dy(b.y),b.z],before=this.previous.get(id);this.previous.set(id,now);
    let next=this.nextRing.get(id)??0;const ring=this.course.rings[Math.min(next,this.course.rings.length-1)],distance=Math.hypot(now[0]-ring.x,now[1]-ring.y,now[2]-ring.z);
    this.progress.set(id,next*1000+Math.max(0,999-distance));
    if(before&&next<this.course.rings.length){const p0=[before[0],before[1]+.4,before[2]],p1=[now[0],now[1]+.4,now[2]],d0=side(ring,p0),d1=side(ring,p1);if(d0<0&&d1>=0){const f=d0/(d0-d1),q=p0.map((v,i)=>v+(p1[i]-v)*f),off=Math.hypot(q[0]-ring.x,q[1]-ring.y-.9,q[2]-ring.z);if(off<=(ring.finish?6.1:4.6)+.6){this.nextRing.set(id,++next);if(ring.finish){this.finishRace(id);continue;}this.giveRockets(id,ring.boost?5:2);if(ring.boost)this.m.host.launch(id,ring.nx*34,ring.ny*34,ring.nz*34,true);this.m.sound('pickup',b);}}}
    const onDeck=next===0&&distance<60&&p.onGround&&this.t<400;
    if(!onDeck&&p.onGround&&!p.gliding){const n=(this.grounded.get(id)??0)+1;this.grounded.set(id,n);if(n>8)this.relaunch(id,'Crash');}else this.grounded.set(id,0);
    if(distance>110){const n=(this.lost.get(id)??0)+1;this.lost.set(id,n);if(n>60)this.relaunch(id,'Off course');}else this.lost.set(id,0);
  }}
  relaunch(id:number,why:string){const i=Math.min(this.nextRing.get(id)??0,this.course.rings.length-1),r=this.course.rings[i],s=this.at(r.x-r.nx*16,r.y-r.ny*16+1.5,r.z-r.nz*16,yawToward(0,0,r.nx,r.nz));this.grounded.set(id,0);this.lost.set(id,0);this.resets.set(id,(this.resets.get(id)??0)+1);this.m.host.teleport(id,s.x,s.y,s.z,s.yaw);this.previous.set(id,[s.x,s.y-BASE_Y,s.z]);this.m.host.launch(id,r.nx*18,3,r.nz*18);this.m.later(2,()=>{if(this.alive.has(id))this.m.sim.players.get(id)!.gliding=true;});this.m.title(id,why,`Back to ring ${i+1}`,'#e5484d');}
  onFall(id:number){this.relaunch(id,'Too low');}
  progressDetail(id:number){return `ring ${this.nextRing.get(id)??0}/${this.course.rings.length}`;}
  bar(id:number){const p=this.m.sim.players.get(id)!,rockets=p.inv.slots.reduce((n,s)=>n+(s?.id===vi('firework_rocket')?s.count:0),0);return `Ring ${Math.min(this.course.rings.length,(this.nextRing.get(id)??0)+1)}/${this.course.rings.length} · Rockets: ${rockets}`;}
}
