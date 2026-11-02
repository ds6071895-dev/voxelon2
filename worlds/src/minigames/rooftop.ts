import { Minigame } from './game';
import { rooftopTown } from './rooftop_town';
import type { ArenaDef } from './arena';
import { BASE_Y } from './arena';
import { vi } from '../vanilla/items';
import { scaleInt } from '../minigames_rules';
import type { MAction } from '../vanilla/messages';
export const noTagBack=(n:number)=>scaleInt(n,40,60);
export class RooftopTag extends Minigame{
  readonly id='rooftop_tag';readonly arena:ArenaDef;readonly town;
  readonly it=new Set<number>();readonly taggedBy=new Map<number,number>();readonly taggedAt=new Map<number,number>();readonly tags=new Map<number,number>();
  constructor(seed=0){super();this.town=rooftopTown(seed);this.arena={id:this.id,bounds:this.town.bounds,stamp:this.town.stamp,build:()=>{}};}
  spawns(count:number){const roofs=this.town.houses.filter(h=>h.h>0),chosen=[roofs[Math.floor(this.random()*roofs.length)]];while(chosen.length<Math.max(1,count)){let best=roofs[0],bestGap=-1;for(const h of roofs){const gap=chosen.includes(h)?-1:Math.min(...chosen.map(o=>Math.hypot(h.cx()-o.cx(),h.cz()-o.cz())+Math.abs(h.h-o.h)*.1));if(gap>bestGap){bestGap=gap;best=h;}}chosen.push(best);}return chosen.map(h=>this.at(h.cx(),h.h+1,h.cz()));}
  spectate(){return this.at(.5,35,this.town.half+.5);}
  setup(ids:number[]){const chosen=ids.slice();for(let i=chosen.length-1;i>0;i--){const j=Math.floor(this.random()*(i+1));[chosen[i],chosen[j]]=[chosen[j],chosen[i]];}this.makeIt(chosen[0]);}
  private makeIt(id:number){this.it.add(id);this.setSlot(id,36,{id:vi('leather_helmet'),count:1,color:0xe5484d});this.m.sim.addEffect(id,'speed',1,12000);this.m.sim.addEffect(id,'glowing',0,12000);}
  private runner(id:number){this.it.delete(id);this.setSlot(id,36,null);const p=this.m.sim.players.get(id)!;p.effects.remove('speed');p.effects.remove('glowing');}
  onAction(id:number,a:MAction){if(a.k!=='attack'||a.target===undefined)return false;
    const target=a.target,b=this.m.host.body(id),v=this.m.host.body(target),p=this.m.sim.players.get(id)!;
    if(!b||!v||!this.alive.has(target)||!this.it.has(id)||this.it.has(target)||p.attackTicks<10||Math.hypot(b.x-v.x,b.y-v.y,b.z-v.z)>3.8)return true;
    if(this.taggedBy.get(target)===id&&this.t-(this.taggedAt.get(target)??-999)<noTagBack(this.participants.size))return true;
    p.attackTicks=0;this.runner(id);this.makeIt(target);this.taggedBy.set(id,target);this.taggedAt.set(id,this.t);this.tags.set(id,(this.tags.get(id)??0)+1);this.m.sim.addEffect(target,'slowness',2,30);this.m.title(target,'You’re it',`Tagged by ${this.m.name(id)}`,'#e5484d');return true;
  }
  tick(){for(const id of this.players())if(!this.it.has(id))this.addScore(id,.05);}
  onFall(id:number){const roofs=this.town.houses.filter(h=>h.h>0),h=roofs[Math.floor(this.random()*roofs.length)];this.m.host.teleport(id,h.cx(),BASE_Y+h.h+1,h.cz());this.setScore(id,Math.max(0,this.scoreOf(id)-3));}
  onQuit(id:number){const was=this.it.delete(id);if(was&&!this.it.size){const next=this.players()[0];if(next!==undefined)this.makeIt(next);}}
  bar(id:number){return `${this.it.has(id)?'You’re it · tag someone':'Safe'} · Score: ${Math.floor(this.scoreOf(id))}`;}
  detail(id:number){return `${Math.floor(this.scoreOf(id))}s free · ${this.tags.get(id)??0} tags`;}
}
