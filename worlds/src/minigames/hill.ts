import { Minigame } from './game';
import { KINGOFTHEHILL_ARENA } from './arena_d';
import { vi } from '../vanilla/items';
import { mc } from '../vanilla/mc_materials';
export class KingOfTheHill extends Minigame {
  readonly id='koth';readonly arena=KINGOFTHEHILL_ARENA;leader:number|null=null;
  /** Tick each player's slime pad re-arms: the server sees bodies a little late, so
   *  without this one landing re-launched (and froze) a player mid-air every tick. */
  private padReady=new Map<number,number>();
  spawns(n:number){return this.ring(n,18,1,this.random()*Math.PI*2);}
  spectate(){return this.at(.5,22,30.5);}
  setup(ids:number[]){for(const id of ids)this.setSlot(id,0,{id:vi('stick'),count:1,name:'Royal Shove',ench:[['knockback',2]]});}
  melee(){return true;}
  tick(){const kings:number[]=[];for(const id of this.players()){const b=this.m.host.body(id)!;if(Math.abs(b.x-.5)<=2.8&&Math.abs(b.z-.5)<=2.8&&this.dy(b.y)>=10.9)kings.push(id);
    const p=this.m.sim.players.get(id)!;
    if(this.get(Math.floor(b.x),Math.floor(this.dy(b.y)-.2),Math.floor(b.z))===mc('slime_block')&&p.onGround&&this.t>=(this.padReady.get(id)??0)){this.padReady.set(id,this.t+30);const len=Math.hypot(b.x,b.z)||1;this.m.host.launch(id,-b.x/len*19,25,-b.z/len*19);}
  }
    if(this.t%20===0){kings.sort((a,b)=>{const x=this.m.host.body(a)!,y=this.m.host.body(b)!;return (x.x-.5)**2+(x.z-.5)**2-(y.x-.5)**2-(y.z-.5)**2;});if(kings.length)this.addScore(kings[0],1);
      this.leader=[...this.alive].sort((a,b)=>this.scoreOf(b)-this.scoreOf(a))[0]??null;
      for(const id of this.players()){const p=this.m.sim.players.get(id)!;if(id===this.leader&&this.scoreOf(id)>0)p.effects.add('glowing',0,30);else p.effects.remove('glowing');}
    }
  }
}
