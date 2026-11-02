import { Minigame } from './game';
import { BOWSPLEEF_ARENA } from './survival_arenas';
import { BASE_Y } from './arena';
import { scaleInt } from '../minigames_rules';
import { vi } from '../vanilla/items';
import { mc } from '../vanilla/mc_materials';
import type { Entity } from '../vanilla/entity';
import type { MAction } from '../vanilla/messages';
export const bowCooldown=(n:number)=>scaleInt(n,12,50);
export const burnStart=(n:number)=>scaleInt(n,40,70)*20;
export const burnEvery=(n:number)=>scaleInt(n,30,50);
export class BowSpleef extends Minigame {
  readonly id='bow_spleef'; readonly arena=BOWSPLEEF_ARENA; burnRadius=13;
  private fired=new Map<number,number>();
  spawns(n:number) {return this.ring(n,9,1,this.random()*Math.PI*2);}
  spectate() {return this.at(.5,12,22.5);}
  fallY() {return -6;}
  setup(ids:number[]) {for(const id of ids) {this.setSlot(id,0,{id:vi('bow'),count:1,name:'Flame Bow',ench:[['flame',1],['infinity',1]]});this.setSlot(id,9,{id:vi('arrow'),count:1});}}
  onAction(id:number,a:MAction) {
    if(a.k!=='useEnd') return false;
    if(this.t-(this.fired.get(id)??-1e9)<bowCooldown(this.participants.size)) {this.m.sim.players.get(id)!.using=null;return true;}
    this.fired.set(id,this.t);return false;
  }
  tick() {
    if(this.t>burnStart(this.participants.size)&&this.t%burnEvery(this.participants.size)===0&&this.burnRadius>2) {
      const r=this.burnRadius--;
      for(let x=-r;x<=r;x++) for(let z=-r;z<=r;z++) if(Math.hypot(x,z)>r-.5&&Math.hypot(x,z)<=r+.5&&this.get(x,0,z)===mc('tnt')) this.put(x,0,z,0);
    }
  }
  onArrowBlock(e:Entity,x:number,y:number,z:number) {return this.onProjectile(e,{block:{x,y,z}});}
  onProjectile(e:Entity,hit:{player?:number;block?:{x:number;y:number;z:number}}) {
    if(e.kind!=='arrow') return false;
    const b=hit.player!==undefined?this.m.host.body(hit.player):null;
    const h=hit.block??(b?{x:Math.floor(b.x),y:Math.floor(b.y-.2),z:Math.floor(b.z)}:null);
    if(h&&h.y===BASE_Y) for(let dx=-1;dx<=1;dx++) for(let dz=-1;dz<=1;dz++) if(this.get(h.x+dx,0,h.z+dz)===mc('tnt')) this.put(h.x+dx,0,h.z+dz,0);
    return true;
  }
}
