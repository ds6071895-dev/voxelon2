import { Minigame, yawToward } from './game';
import { SHEEPHERD_ARENA } from './arena_d';
import { step,E,N,S,W } from '../vanilla/deco';
import { vi } from '../vanilla/items';
import { ENT_FLAG,type MAction } from '../vanilla/messages';
import type { Entity } from '../vanilla/entity';
export const SHEEP_COLORS=['red','blue','lime','yellow','purple','orange','cyan','pink','white','black'];
export const penCentre=(i:number)=>[Math.round(Math.cos(Math.PI*2*i/10)*25),Math.round(Math.sin(Math.PI*2*i/10)*25)];
export const penFor=(i:number,n:number)=>Math.trunc(i*10/Math.max(1,Math.min(n,10)))%10;
export const towardCentre=(i:number)=>{const c=penCentre(i);return Math.abs(c[0])>=Math.abs(c[1])?(c[0]>0?W:E):(c[1]>0?N:S);};
export class SheepHerd extends Minigame{
  readonly id='sheep';readonly arena=SHEEPHERD_ARENA;
  readonly penOf=new Map<number,number>();readonly flock:Entity[]=[];readonly parked=new Map<number,number>();
  spawns(n:number){return Array.from({length:Math.max(1,n)},(_,i)=>{const c=penCentre(penFor(i,n)),f=step(towardCentre(penFor(i,n)));return this.at(c[0]+f[0]*5+.5,1,c[1]+f[2]*5+.5,yawToward(c[0],c[1],0,0));});}
  spectate(){return this.at(.5,22,34.5);}
  setup(ids:number[]){
    const used=new Set<number>();ids.forEach((id,i)=>{const pen=penFor(i,ids.length);this.penOf.set(id,pen);used.add(pen);this.setSlot(id,0,{id:vi('lead'),count:1,name:`Lead · ${SHEEP_COLORS[pen]} pen`});});
    for(let i=0;i<10;i++){const c=penCentre(i),f=step(towardCentre(i));this.put(c[0]+f[0]*3,1,c[1]+f[2]*3,used.has(i)?0:'oak_fence');}
    for(let i=0;i<ids.length*3+6;i++){const a=this.random()*Math.PI*2,r=3+this.random()*10,gold=i<Math.max(1,Math.floor(ids.length/3)),at=this.at(Math.cos(a)*r+.5,1,Math.sin(a)*r+.5);this.flock.push(this.m.sim.spawnMob('sheep',at.x,at.y,at.z,undefined,{data:{color:gold?0xf3c653:0xf2f2f0},flags:gold?ENT_FLAG.glowing:0}));}
  }
  leading(id:number){return this.flock.filter(e=>e.data.leash===id&&!e.dead);}
  melee(_attacker:number,victim:number){for(const e of this.leading(victim))delete e.data.leash;return true;}
  onAction(id:number,a:MAction){
    const ent=(a.k==='use'||a.k==='attack')&&a.ent!==undefined?this.flock.find(e=>e.id===a.ent):null;
    if(!ent)return false;
    const b=this.m.host.body(id)!;if(Math.hypot(b.x-ent.x,b.y-ent.y,b.z-ent.z)>4.5)return true;
    if(a.k==='attack'){if(this.m.sim.players.get(id)!.attackTicks<10)return true;this.m.sim.players.get(id)!.attackTicks=0;const len=Math.hypot(ent.x-b.x,ent.z-b.z)||1;ent.vx+=(ent.x-b.x)/len*.4;ent.vz+=(ent.z-b.z)/len*.4;ent.vy+=.2;return true;}
    if(ent.data.leash!==undefined||this.leading(id).length>=2)return true;
    if(this.parked.get(ent.id)===this.penOf.get(id))return true;
    this.parked.delete(ent.id);ent.data.noAI=false;ent.data.leash=id;this.m.sound('pickup',b);return true;
  }
  tick(){if(this.t%5!==0)return;
    for(const id of this.players())for(const e of this.leading(id)){const c=penCentre(this.penOf.get(id)!);if(Math.abs(e.x-c[0]-.5)<2.6&&Math.abs(e.z-c[1]-.5)<2.6){delete e.data.leash;e.data.noAI=true;this.parked.set(e.id,this.penOf.get(id)!);this.m.sound('pickup',e);}}
    for(const id of this.participants){let score=0;for(const e of this.flock)if(!e.dead&&this.parked.get(e.id)===this.penOf.get(id))score+=e.data.color===0xf3c653?3:1;this.setScore(id,score);}
  }
  bar(id:number){return `${SHEEP_COLORS[this.penOf.get(id)??0]} pen: ${this.scoreOf(id)} · Leading ${this.leading(id).length}/2`;}
  onQuit(id:number){for(const e of this.leading(id))delete e.data.leash;}
  cleanup(){for(const e of this.flock)this.m.sim.ents.remove(e);}
}
