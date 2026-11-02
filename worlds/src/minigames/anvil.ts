import { Minigame } from './game';
import { ANVILPANIC_ARENA } from './survival_arenas';
import { mc } from '../vanilla/mc_materials';
import type { Entity } from '../vanilla/entity';
export const homingFrom=(alive:number)=>alive<=3?2:6;
export const homingOdds=(alive:number)=>alive<=3?2:4;
const key=(x:number,z:number)=>`${x},${z}`;
const mod=(x:number,n:number)=>((x%n)+n)%n;
export class AnvilPanic extends Minigame {
  readonly id='anvil';readonly arena=ANVILPANIC_ARENA;
  readonly strikes:{x:number;z:number;at:number;ghost:Entity}[]=[];
  readonly falling:Entity[]=[];
  private painted=new Map<string,{x:number;z:number;block:number;restore:number}>();
  wave=0;nextWave=40;
  spawns(n:number) {return this.ring(n,7,1,this.random()*Math.PI*2);}
  spectate() {return this.at(.5,16,20.5);}
  private int(n:number) {return Math.floor(this.random()*n);}
  tick() {
    if(this.t>=this.nextWave) this.launchWave();
    for(let i=this.strikes.length-1;i>=0;i--) {
      const s=this.strikes[i],left=s.at-this.t;
      if(left<=0) {
        this.m.sim.ents.remove(s.ghost);
        const e=this.m.sim.ents.spawn('display',s.x+.5,this.at(0,9,0).y,s.z+.5,{block:mc('anvil'),data:{variant:'anvil'}});
        this.falling.push(e);this.strikes.splice(i,1);
        this.painted.get(key(s.x,s.z))!.restore=this.t+14;
      } else if(left<=12) this.put(s.x,0,s.z,Math.floor(left/3)%2===0?'orange_concrete':'red_concrete');
    }
    for(let i=this.falling.length-1;i>=0;i--) {
      const e=this.falling[i];e.vy=(e.vy-.04)*.98;e.y+=e.vy;
      for(const id of this.players()) {const p=this.m.host.body(id)!;if(Math.abs(p.x-e.x)<.55&&Math.abs(p.z-e.z)<.55&&e.y<p.y+1.8&&e.y>p.y-.4) this.eliminate(id,'got flattened');}
      if(this.dy(e.y)<.6) {this.m.sim.ents.remove(e);this.falling.splice(i,1);this.m.sound('bass',e);}
    }
    for(const [k,p] of this.painted) if(this.t>=p.restore&&!this.strikes.some(s=>s.x===p.x&&s.z===p.z)) {this.put(p.x,0,p.z,p.block);this.painted.delete(k);}
  }
  launchWave() {
    this.wave++;const progress=Math.min(1,this.t/(this.seconds*20*.85));
    const warn=Math.round(30-10*progress);this.nextWave=this.t+Math.round(65-25*progress);
    const kind=this.wave<3?0:this.int(this.wave>8?7:5),offset=this.int(4),density=.06+.14*progress;
    const targets=new Map<string,{x:number;z:number}>();
    for(let x=-10;x<=10;x++) for(let z=-10;z<=10;z++) {
      let hit=false;
      switch(kind){case 1:hit=mod(x+offset,4)===0;break;case 2:hit=mod(z+offset,4)===0;break;case 3:hit=mod(Math.max(Math.abs(x),Math.abs(z))+offset,4)===0;break;case 4:hit=mod(x+z+offset,2)===0&&this.random()<.5;break;case 5:hit=(Math.abs(x)<=1||Math.abs(z)<=1)&&this.random()<.7;break;default:hit=this.random()<density;}
      if(hit)targets.set(key(x,z),{x,z});
    }
    const ids=this.players();
    for(const id of ids) {
      const b=this.m.host.body(id)!,px=Math.floor(b.x),pz=Math.floor(b.z),reach=Math.max(2,Math.floor((warn+18)/20*4));let safe=false;
      for(let dx=-reach;dx<=reach;dx++) for(let dz=-reach;dz<=reach;dz++) if(Math.abs(px+dx)<=10&&Math.abs(pz+dz)<=10&&!targets.has(key(px+dx,pz+dz))) safe=true;
      if(!safe)targets.delete(key(Math.max(-10,Math.min(10,px+this.int(3)-1)),Math.max(-10,Math.min(10,pz+this.int(3)-1))));
    }
    const list=[...targets.values()];
    for(let i=list.length-1;i>0;i--){const j=this.int(i+1);[list[i],list[j]]=[list[j],list[i]];}
    list.length=Math.min(list.length,60,441-Math.max(ids.length*4,20));
    if(kind===6||this.wave>homingFrom(ids.length)&&this.int(homingOdds(ids.length))===0) {
      const spread=ids.length<=3?1:0;
      for(const id of ids) {const b=this.m.host.body(id)!;for(let dx=-spread;dx<=spread;dx++)for(let dz=-spread;dz<=spread;dz++) {const x=Math.floor(b.x)+dx,z=Math.floor(b.z)+dz;if(Math.abs(x)<=10&&Math.abs(z)<=10&&!list.some(s=>s.x===x&&s.z===z))list.push({x,z});}}
    }
    for(const s of list) {
      const k=key(s.x,s.z);
      if(!this.painted.has(k))this.painted.set(k,{...s,block:this.get(s.x,0,s.z),restore:Infinity});
      this.put(s.x,0,s.z,'red_concrete');
      const ghost=this.m.sim.ents.spawn('display',s.x+.5,this.at(0,9,0).y,s.z+.5,{block:mc('anvil'),data:{variant:'anvil',ghost:true}});
      this.strikes.push({...s,at:this.t+warn+this.int(4),ghost});
    }
    this.m.sound('click');
  }
  cleanup() {for(const s of this.strikes)this.m.sim.ents.remove(s.ghost);for(const e of this.falling)this.m.sim.ents.remove(e);}
}
