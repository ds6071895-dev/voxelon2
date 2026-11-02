import { Minigame } from './game';
import { canopyJungle,type CoinSpot } from './canopy_jungle';
import type { ArenaDef } from './arena';
import { BASE_Y } from './arena';
import { scaleInt,fmt } from '../minigames_rules';
import { vi } from '../vanilla/items';
import { ENT_FLAG } from '../vanilla/messages';
import type { Entity } from '../vanilla/entity';
export const coinRespawn=(n:number)=>scaleInt(n,60,30);
export class CoinCanopy extends Minigame{
  readonly id='canopy';readonly arena:ArenaDef;readonly jungle;
  readonly coins:{spot:CoinSpot;value:number;entity:Entity}[]=[];private respawns:number[]=[];private nextBig=500;
  constructor(seed=0){super();this.jungle=canopyJungle(seed);this.arena={id:this.id,bounds:this.jungle.bounds,stamp:this.jungle.stamp,build:()=>{}};}
  spawns(n:number){return Array.from({length:Math.max(1,n)},(_,i)=>this.jungle.starts[Math.floor(i*this.jungle.starts.length/Math.max(1,n))%this.jungle.starts.length]);}
  spectate(){return this.at(.5,52,58.5);}
  begin(){for(let i=0;i<Math.min(this.jungle.spots.length-2,8+this.participants.size*3);i++)this.spawnCoin(false);}
  private spawnCoin(big:boolean){const free=this.jungle.spots.filter(s=>!this.coins.some(c=>c.spot===s)&&(!big||s.value>=3));if(!free.length)return;const spot=free[Math.floor(this.random()*free.length)],value=big?5:spot.value,entity=this.m.sim.ents.spawn('display',spot.x,BASE_Y+spot.y+.6,spot.z,{flags:ENT_FLAG.glowing,item:{id:vi(big?'gold_block':value>=3?'gold_ingot':value===2?'raw_gold':'gold_nugget'),count:1},data:{variant:'coin',color:0xf3c653}});this.coins.push({spot,value,entity});}
  tick(){for(let i=this.coins.length-1;i>=0;i--){const c=this.coins[i];const taker=this.players().find(id=>{const p=this.m.host.body(id)!;return Math.abs(p.x-c.spot.x)<1.1&&Math.abs(p.z-c.spot.z)<1.1&&p.y>BASE_Y+c.spot.y-1.2&&p.y<BASE_Y+c.spot.y+1.4;});if(taker===undefined)continue;this.coins.splice(i,1);this.m.sim.ents.remove(c.entity);this.addScore(taker,c.value);this.m.sound('pickup',this.m.host.body(taker));if(c.value<5)this.respawns.push(this.t+coinRespawn(this.participants.size)+Math.floor(this.random()*coinRespawn(this.participants.size)));}
    for(let i=this.respawns.length-1;i>=0;i--)if(this.t>=this.respawns[i]){this.respawns.splice(i,1);this.spawnCoin(false);}if(this.t>=this.nextBig){this.nextBig=this.t+500;this.spawnCoin(true);}
  }
  onFall(id:number){const s=this.jungle.starts[Math.floor(this.random()*this.jungle.starts.length)];this.m.host.teleport(id,s.x,s.y,s.z,s.yaw);}
  detail(id:number){return `${fmt(this.scoreOf(id))} coins`;}
  cleanup(){for(const c of this.coins)this.m.sim.ents.remove(c.entity);this.coins.length=0;}
}
