import { scaleInt } from '../minigames_rules';
import { Minigame, yawToward } from './game';
import { BoatCircuit } from './boat_circuit';
import { boatScenery } from './boat_geometry';
import { routeDist } from './sky_route';
import { noise } from './buildings';
import type { ArenaDef } from './arena';
import type { Entity } from '../vanilla/entity';
import type { MAction } from '../vanilla/messages';
export const BOAT_LAPS = 1;
const mod=(x:number,n:number)=>((x%n)+n)%n;
export class BoatRush extends Minigame {
  graceSeconds(){return scaleInt(this.participants.size,40,60);}
  readonly id='boat_race';readonly arena:ArenaDef;readonly circuit:BoatCircuit;
  readonly distance=new Map<number,number>();readonly lastIndex=new Map<number,number>();readonly boats=new Map<number,Entity>();
  constructor(seed=0){super();this.circuit=new BoatCircuit(seed);this.arena={id:this.id,version:2,bounds:{minX:-120,maxX:120,minY:-16,maxY:40,minZ:-120,maxZ:120},build:d=>{
    const theme=this.circuit.theme,ground:Record<string,string>={SNOW:'snow_block',DESERT:'sand',CHERRY:'grass_block',NETHER:'netherrack',CANDY:'white_concrete',NEON:'black_concrete'},under:Record<string,string>={DESERT:'sandstone',NETHER:'blackstone',CANDY:'pink_terracotta',NEON:'gray_concrete'},walls:Record<string,string[]>={SNOW:['red_concrete','white_concrete'],DESERT:['cut_sandstone','orange_terracotta'],CHERRY:['pink_concrete','white_concrete'],NETHER:['nether_bricks','magma_block'],CANDY:['red_wool','white_wool'],NEON:['magenta_concrete','cyan_concrete']},free:number[][]=[];
    for(let x=-112;x<=112;x++)for(let z=-112;z<=112;z++){
      const off=this.circuit.nearest(x+.5,z+.5)[1];if(off>12.5&&!this.circuit.inside(x+.5,z+.5))continue;
      d.set(x,-1,z,under[theme]??'dirt');
      if(off<=3.5){d.set(x,0,z,'packed_ice');d.set(x,-2,z,under[theme]??'dirt');}
      else if(off<=4.5){d.set(x,0,z,'packed_ice');d.set(x,1,z,walls[theme][mod(x+z,4)<2?0:1]);}
      else{const n=noise(x,z);let m=ground[theme];switch(theme){case'SNOW':if(n<.06)m='packed_ice';break;case'DESERT':if(n<.12)m='sandstone';else if(n<.2)m='smooth_sandstone';break;case'CHERRY':if(n<.15)m='moss_block';else if(n<.2)m='dirt_path';break;case'NETHER':if(n<.2)m='soul_soil';else if(n<.28)m='crimson_nylium';break;case'CANDY':if(mod(Math.trunc(x/3)+Math.trunc(z/3),2)===0)m='pink_concrete';break;case'NEON':if(n<.04)m='sea_lantern';}d.set(x,0,z,m);if(off>7)free.push([x,z]);}
    }boatScenery(d,this.circuit,free);
  }};}
  spawns(count:number){const line=this.circuit.line,n=line.length;return Array.from({length:Math.max(1,count)},(_,i)=>{const at=mod(-Math.round((3+Math.floor(i/2)*3.5)*2),n),a=line[at],b=line[(at+2)%n],len=routeDist(a.slice(0,2),b.slice(0,2)),ux=(b[0]-a[0])/len,uz=(b[1]-a[1])/len,side=i%2===0?-1.6:1.6;return this.at(a[0]-uz*side,1,a[1]+ux*side,yawToward(0,0,ux,uz));});}
  spectate(){const a=this.circuit.line[0];return this.at(a[0]+.5,30,a[1]+20.5);}
  begin(){for(const id of this.players()){const b=this.m.host.body(id)!,boat=this.m.sim.ents.spawn('boat',b.x,b.y,b.z,{yaw:b.yaw});this.boats.set(id,boat);this.m.sim.mount(this.m.sim.players.get(id)!,boat);const index=Math.max(0,this.circuit.nearest(b.x,b.z)[0]),s=this.circuit.line[index][2];this.lastIndex.set(id,index);this.distance.set(id,s>this.circuit.length/2?s-this.circuit.length:s);}}
  onAction(_id:number,a:MAction){return a.k==='dismount';}
  tick(){for(const id of this.players()){const b=this.m.host.body(id)!,index=this.circuit.nearest(b.x,b.z)[0];if(index>=0){const line=this.circuit.line,length=this.circuit.length,s=line[index][2],before=line[this.lastIndex.get(id)??index][2];let delta=s-before;if(delta< -length/2)delta+=length;else if(delta>length/2)delta-=length;if(Math.abs(delta)<15)this.distance.set(id,(this.distance.get(id)??0)+delta);this.lastIndex.set(id,index);}
    const total=this.distance.get(id)??0;this.progress.set(id,total);if(total>=this.circuit.length*BOAT_LAPS){this.finishRace(id);this.removeBoat(id);}else if(this.t%10===0&&this.m.sim.players.get(id)!.riding===null){const boat=this.boats.get(id);if(boat)this.m.sim.mount(this.m.sim.players.get(id)!,boat);}
  }}
  private removeBoat(id:number){const p=this.m.sim.players.get(id);if(p)this.m.sim.dismount(p);const b=this.boats.get(id);if(b)this.m.sim.ents.remove(b);this.boats.delete(id);}
  onFall(id:number){const i=this.lastIndex.get(id)??0,p=this.circuit.line[i],q=this.circuit.line[(i+4)%this.circuit.line.length],s=this.at(p[0],1,p[1],yawToward(p[0],p[1],q[0],q[1])),boat=this.boats.get(id),vp=this.m.sim.players.get(id)!;this.m.sim.dismount(vp);this.m.host.teleport(id,s.x,s.y,s.z,s.yaw);if(boat){boat.x=s.x;boat.y=s.y;boat.z=s.z;boat.yaw=s.yaw;this.m.sim.mount(vp,boat);}}
  onQuit(id:number){this.removeBoat(id);}
  bar(id:number){return `Lap ${Math.min(BOAT_LAPS,Math.floor(Math.max(0,this.distance.get(id)??0)/this.circuit.length)+1)}/${BOAT_LAPS}`;}
  progressDetail(id:number){return `${Math.round(100*Math.max(0,this.distance.get(id)??0)/(BOAT_LAPS*this.circuit.length))}% done`;}
  cleanup(){for(const id of [...this.boats.keys()])this.removeBoat(id);}
}
