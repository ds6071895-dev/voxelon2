import { Minigame } from './game';
import { DISCODASH_ARENA } from './survival_arenas';
import { scale } from '../minigames_rules';
import { vi } from '../vanilla/items';
import type { Entity } from '../vanilla/entity';
export const DISCO_COLORS=['red','orange','yellow','lime','light_blue','blue','purple','pink'];
export const discoShowTicks=(n:number,call:number)=>Math.max(24,Math.round(80-call*scale(n,8,4.5)));
export const discoSafeTiles=(n:number)=>Math.max(6,Math.ceil(n*1.5));
export const discoReach=(n:number,ticks:number)=>Math.max(2.5,ticks/20*3.6)/2*scale(n,.75,1);
const mod=(x:number,n:number)=>((x%n)+n)%n;
export class DiscoDash extends Minigame {
  readonly id='disco';readonly arena=DISCODASH_ARENA;
  readonly grid=Array.from({length:12},()=>Array<number>(12).fill(0));
  readonly safe=new Set<number>(); call=0;stage=2;stageTicks=20;showTicks=0;
  spawns(n:number) {return this.ring(n,7,1,this.random()*Math.PI*2);}
  spectate() {return this.at(.5,9,17.5);}
  fallY() {return -6;}
  private int(n:number) {return Math.floor(this.random()*n);}
  tick() {
    this.stageTicks--;
    if(this.stage===0) {
      for(const id of this.players()) {const p=this.m.sim.players.get(id)!;p.xpBar=Math.min(.999,Math.max(0,this.stageTicks)/this.showTicks);p.xpLevel=Math.floor((this.stageTicks+19)/20);}
      if(this.stageTicks<=0) this.drop();
    } else if(this.stage===1) {if(this.stageTicks<=0) {this.stage=2;this.stageTicks=8;}}
    else if(this.stageTicks<=0) this.nextCall();
  }
  private near(x:number,z:number,reach:number) {
    const r=Math.ceil(reach);
    for(let dx=-r;dx<=r;dx++) for(let dz=-r;dz<=r;dz++) if(x+dx>=0&&z+dz>=0&&x+dx<12&&z+dz<12&&Math.hypot(dx,dz)<=reach&&this.safe.has(this.grid[x+dx][z+dz])) return true;
    return false;
  }
  nextCall() {
    this.call++;this.showTicks=this.t>2400?20:discoShowTicks(this.participants.size,this.call);this.safe.clear();
    const first=this.int(8);this.safe.add(first);
    if(this.call>=8&&this.int(3)===0) this.safe.add((first+1+this.int(7))%8);
    const kind=this.call<3?0:this.int(6),offset=this.int(8),along=this.random()<.5,width=1+this.int(2);
    for(let x=0;x<12;x++) for(let z=0;z<12;z++) {
      let value:number;
      switch(kind) {
        case 1:value=Math.floor((along?x:z)/width)+offset;break;
        case 2:value=Math.floor(Math.max(Math.abs(2*x-11),Math.abs(2*z-11))/2)+offset;break;
        case 3:value=(Math.floor(x/2)+Math.floor(z/2))%2===0?offset:offset+1+(x+z)%3;break;
        case 4:value=Math.round(Math.atan2(z-5.5,x-5.5)*4/Math.PI+Math.hypot(x-5.5,z-5.5)/2)+offset;break;
        case 5:value=(x<6?0:1)+(z<6?0:2)+offset+(x+z)%2*4;break;
        default:value=this.int(8);
      }
      this.grid[x][z]=mod(value,8);
    }
    const options=[...this.safe],color=()=>options[this.int(options.length)];
    let count=this.grid.flat().filter(c=>this.safe.has(c)).length;
    while(count<discoSafeTiles(this.alive.size)) {const x=this.int(12),z=this.int(12);if(!this.safe.has(this.grid[x][z])) {this.grid[x][z]=color();count++;}}
    const reach=discoReach(this.participants.size,this.showTicks),r=Math.floor(reach);
    for(let x=0;x<12;x++) for(let z=0;z<12;z++) if(!this.near(x,z,reach)) {
      let nx=Math.max(0,Math.min(11,x+this.int(2*r+1)-r)),nz=Math.max(0,Math.min(11,z+this.int(2*r+1)-r));
      if(Math.hypot(nx-x,nz-z)>reach) {nx=x;nz=z;}this.grid[nx][nz]=color();
    }
    this.paint(false);
    const label=[...this.safe].map(c=>DISCO_COLORS[c].replace('_',' ')).join(' or ');
    this.m.title(null,label,'Get on it!','#ec83ce',Math.max(1000,this.showTicks*50));
    for(const id of this.players()) {
      for(let slot=0;slot<9;slot++) this.setSlot(id,slot,{id:vi(`${DISCO_COLORS[options[slot%options.length]]}_wool`),count:1,name:label});
      if(this.call%3===0) this.setSlot(id,4,{id:vi('snowball'),count:1});
    }
    this.stage=0;this.stageTicks=this.showTicks;this.m.sound('bell');
  }
  private paint(drop:boolean) {
    for(let x=0;x<12;x++) for(let z=0;z<12;z++) for(let dx=0;dx<2;dx++) for(let dz=0;dz<2;dz++)
      this.put(-12+x*2+dx,0,-12+z*2+dz,drop&&!this.safe.has(this.grid[x][z])?0:`${DISCO_COLORS[this.grid[x][z]]}_concrete`);
  }
  private drop() {this.paint(true);this.stage=1;this.stageTicks=34;this.m.sound('bass');for(const id of this.players()){const p=this.m.sim.players.get(id)!;p.xpBar=0;p.xpLevel=0;}}
  onProjectile(e:Entity,target:{player?:number}) {
    if(e.kind!=='snowball') return false;
    if(target.player!==undefined&&this.alive.has(target.player)) {const len=Math.hypot(e.vx,e.vz)||1;this.m.host.launch(target.player,e.vx/len*14,6,e.vz/len*14);}
    return true;
  }
  status() {return `Call ${this.call} · ${[...this.safe].map(c=>DISCO_COLORS[c].replace('_',' ')).join(' or ')}`;}
}
