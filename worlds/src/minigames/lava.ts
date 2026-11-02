import { Minigame, yawToward } from './game';
import { LAVACLIMB_ARENA } from './lava_arena';
import { lavaRoutes } from './lava_routes';
import { scaleInt } from '../minigames_rules';
import { BASE_Y, type ArenaDef } from './arena';
import { step } from '../vanilla/deco';
export const firstRise=(n:number)=>scaleInt(n,8,12)*20;
export const riseEvery=(n:number)=>scaleInt(n,50,70);
const PALETTES=[['polished_blackstone_bricks','basalt','cracked_polished_blackstone_bricks','magma_block','polished_basalt'],['nether_bricks','red_nether_bricks','magma_block','cracked_nether_bricks','netherrack'],['deepslate_tiles','polished_deepslate','magma_block','cobbled_deepslate','basalt'],['obsidian','crying_obsidian','magma_block','blackstone','gilded_blackstone']];
export class LavaClimb extends Minigame {
  readonly id='lava_climb';readonly arena:ArenaDef;readonly layout;lavaLevel=-1;nextRise=0;
  constructor(seed=0){super();this.layout=lavaRoutes(seed);const materials=PALETTES[seed%4];this.arena={id:this.id,version:3,bounds:{minX:-40,maxX:40,minY:-16,maxY:60,minZ:-40,maxZ:40},build:d=>{
    LAVACLIMB_ARENA.build(d);this.layout.routes.forEach((route,i)=>{for(const p of route)for(let x=p.x;x<p.x+p.w;x++)for(let z=p.z;z<p.z+p.d;z++){const m=materials[((p.y+i)%materials.length+materials.length)%materials.length];if(m==='basalt'||m==='polished_basalt')d.log(x,p.y,z,m,'y');else d.set(x,p.y,z,m);}});
    for(const t of this.layout.towers){const f=step(t.facing);for(let y=t.y0;y<=t.y1;y++){d.set(t.x,y,t.z,y===t.y1?'polished_blackstone_bricks':'blackstone');if(y>t.y0)d.ladder(t.x+f[0],y,t.z+f[2],t.facing);}}
  }};}
  spawns(n:number){return Array.from({length:Math.max(1,n)},(_,i)=>{const route=i%3,slot=Math.floor(i/3),a=route*Math.PI*2/3+.22+.25+slot*.13,r=slot%2===0?12:10.5,x=Math.cos(a)*r,z=Math.sin(a)*r;return this.at(x+.5,0,z+.5,yawToward(x,z,0,0));});}
  spectate(){return this.at(.5,52,24.5);}
  fallY(){return -8;}
  setup(){this.nextRise=firstRise(this.participants.size);}
  tick(){if(this.t>=this.nextRise&&this.lavaLevel<42){this.lavaLevel++;this.nextRise=this.t+(this.t>1200?Math.floor(riseEvery(this.participants.size)*4/5):riseEvery(this.participants.size));for(let x=-13;x<=13;x++)for(let z=-13;z<=13;z++)if(x*x+z*z<=13.5**2&&this.get(x,this.lavaLevel,z)===0)this.put(x,this.lavaLevel,z,'lava');if(this.lavaLevel===0)this.m.title(null,'Lava','It’s rising · climb!','#dc5a24');}
    for(const id of this.players()){const b=this.m.host.body(id)!,h=b.y-BASE_Y;this.progress.set(id,Math.max(this.progress.get(id)??-Infinity,h));if(h<this.lavaLevel+.6&&this.lavaLevel>=0)this.retire(id,`was caught by lava at ${Math.round(this.progress.get(id)!)}m`);else if(h>=44.9&&Math.hypot(b.x,b.z)<=5.8)this.finishRace(id);}}
  bar(id:number){return `Height ${Math.floor(Math.max(0,this.dy(this.m.host.body(id)!.y)))}/45m · Lava ${Math.max(0,this.lavaLevel+1)}m`;}
  progressDetail(id:number){return `reached ${Math.round(this.progress.get(id)??0)}m`;}
  onFall(id:number){this.retire(id,'fell into the lava');}
}
