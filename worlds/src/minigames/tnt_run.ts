import { Minigame } from './game';
import { TNTRUN_ARENA } from './survival_arenas';
import { BASE_Y } from './arena';
import { scaleInt } from '../minigames_rules';
import { vi } from '../vanilla/items';
import type { MAction } from '../vanilla/messages';
export const TNT_FLOORS = [0,-7,-14];
export const collapseStart = (n:number) => scaleInt(n,50,90)*20;
export const collapseEvery = (n:number) => scaleInt(n,30,50);
export class TntRun extends Minigame {
  readonly id='tnt_run'; readonly arena=TNTRUN_ARENA;
  readonly doomed=new Map<string,{x:number;y:number;z:number;at:number}>();
  readonly jumps=new Map<number,number>(); collapseRadius=14;
  spawns(n:number) { return this.ring(n,9,1,this.random()*Math.PI*2); }
  spectate() { return this.at(.5,14,24.5); }
  fallY() { return -20; }
  setup(ids:number[]) { for(const id of ids) { this.jumps.set(id,2); this.setSlot(id,0,{id:vi('feather'),count:2,name:'Double Jump'}); } }
  doubleJumps(id:number) { return this.jumps.get(id)??0; }
  onAction(id:number,a:MAction) {
    if(a.k!=='jump2') return false;
    const b=this.m.host.body(id)!, left=this.doubleJumps(id);
    // Must be airborne; a held jump cannot spend both charges on one server tick.
    if(left<=0 || this.get(Math.floor(b.x),Math.floor(b.y-.05)-BASE_Y,Math.floor(b.z))!==0) return true;
    this.jumps.set(id,left-1); this.setSlot(id,0,left>1?{id:vi('feather'),count:left-1,name:'Double Jump'}:null);
    this.m.host.launch(id,-Math.sin(b.yaw)*14,15,-Math.cos(b.yaw)*14);
    const p=this.m.sim.players.get(id)!;p.fallDist=0;
    this.m.sound('go',b); return true;
  }
  bar(id:number) { return `Double jumps left: ${this.doubleJumps(id)}`; }
  tick() {
    for(const id of this.players()) {
      const b=this.m.host.body(id)!;
      const y=TNT_FLOORS.find(f=>b.y>=BASE_Y+f+.95&&b.y<=BASE_Y+f+1.35);
      if(y===undefined) continue;
      for(const dx of [-.3,.3]) for(const dz of [-.3,.3]) {
        const x=Math.floor(b.x+dx),z=Math.floor(b.z+dz),key=`${x},${y},${z}`;
        if(this.get(x,y,z)!==0&&!this.doomed.has(key)) this.doomed.set(key,{x,y,z,at:this.t+8});
      }
    }
    for(const [key,d] of this.doomed) if(d.at<=this.t) {this.put(d.x,d.y,d.z,0);this.put(d.x,d.y-1,d.z,0);this.doomed.delete(key);}
    if(this.t>collapseStart(this.participants.size)&&this.t%collapseEvery(this.participants.size)===0&&this.collapseRadius>3) {
      const r=this.collapseRadius--;
      for(let x=-r;x<=r;x++) for(let z=-r;z<=r;z++) if(Math.hypot(x,z)>r-.5&&Math.hypot(x,z)<=r+.5)
        for(const y of TNT_FLOORS) {this.put(x,y,z,0);this.put(x,y-1,z,0);}
    }
  }
}
