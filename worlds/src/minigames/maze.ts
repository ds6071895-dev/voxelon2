// Hedge Maze: the source's DFS spanning tree, courtyard doors and three keys.
import { Minigame } from './game';
import { HEDGEMAZE_ARENA } from './maze_arena';
import { JavaRandom } from '../vanilla/java_random';
import { vi } from '../vanilla/items';
import { scaleInt } from '../minigames_rules';
import { BASE_Y, type ArenaDef } from './arena';
import type { Entity } from '../vanilla/entity';
import type { MAction } from '../vanilla/messages';
const matrix=(v:boolean)=>Array.from({length:11},()=>Array<boolean>(11).fill(v));
export const mazeCell=(i:number)=>-20+i*4;
const centre=(x:number,z:number)=>x>=4&&x<=6&&z>=4&&z<=6;
const courtyard=(x:number,z:number)=>x> -6&&x<6&&z> -6&&z<6;
const DIRS=[[1,0],[-1,0],[0,1],[0,-1]];
export class HedgeMaze extends Minigame {
  readonly id='maze';readonly arena:ArenaDef;
  readonly east=matrix(false);readonly south=matrix(false);readonly keys:number[][]=[];
  readonly found=new Map<number,Set<number>>();readonly lastKey=new Map<number,number>();readonly mobs:Entity[]=[];
  private mobCells:number[][]=[];private nextMob=0;private wanted=0;
  constructor(seed=0){super();this.generate(new JavaRandom(seed));this.placeKeys();this.arena={id:this.id,bounds:{minX:-64,maxX:64,minY:-16,maxY:40,minZ:-64,maxZ:64},build:d=>{HEDGEMAZE_ARENA.build(d);for(let x=-22;x<=22;x++)for(let z=-22;z<=22;z++){
      const wall=this.wall(x,z);for(let y=1;y<=3;y++)if(wall)d.leaves(x,y,z,'oak_leaves');else if(!(Math.abs(x)<=3&&Math.abs(z)<=3))d.air(x,y,z);
      if(!courtyard(x,z))d.set(x,0,z,wall?'grass_block':'dirt_path');
    }for(const k of this.keys)d.set(mazeCell(k[0]),0,mazeCell(k[1]),'gold_block');}};}
  spawns(n:number){return this.line(n,-.5,1,27,Math.min(1.5,14/n),180);}
  spectate(){return this.at(.5,22,36.5);}
  wall(x:number,z:number){const gx=x+22,gz=z+22;if(gx<=0||gz<=0||gx>=44||gz>=44)return !(gz>=44&&Math.abs(x)<=1);const wx=gx%4===0,wz=gz%4===0,cx=Math.min(10,Math.floor(gx/4)),cz=Math.min(10,Math.floor(gz/4));if(courtyard(x,z))return false;if(wx&&wz)return true;if(wx)return !this.east[cx-1][cz];if(wz)return !this.south[cx][cz-1];return false;}
  private open(x:number,z:number,dx:number,dz:number){if(dx===1)this.east[x][z]=true;else if(dx===-1)this.east[x-1][z]=true;else if(dz===1)this.south[x][z]=true;else this.south[x][z-1]=true;}
  private generate(r:JavaRandom){
    const seen=matrix(false);for(let x=4;x<=6;x++)for(let z=4;z<=6;z++)seen[x][z]=true;
    const stack=[[5,10]];seen[5][10]=true;
    while(stack.length){const c=stack[stack.length-1],options=DIRS.filter(([dx,dz])=>c[0]+dx>=0&&c[1]+dz>=0&&c[0]+dx<11&&c[1]+dz<11&&!seen[c[0]+dx][c[1]+dz]);if(!options.length){stack.pop();continue;}const [dx,dz]=options[r.nextInt(options.length)];this.open(c[0],c[1],dx,dz);seen[c[0]+dx][c[1]+dz]=true;stack.push([c[0]+dx,c[1]+dz]);}
    const doors=[[4,5,-1,0],[6,5,1,0],[5,4,0,-1],[5,6,0,1]];for(let i=3;i>0;i--){const j=r.nextInt(i+1);[doors[i],doors[j]]=[doors[j],doors[i]];}for(let i=0;i<2;i++){const [x,z,dx,dz]=doors[i];this.open(x,z,dx,dz);}
    for(let i=0;i<6;i++){const x=r.nextInt(10),z=r.nextInt(11);if(!centre(x,z)&&!centre(x+1,z))this.east[x][z]=true;}
  }
  neighbours(x:number,z:number){return DIRS.map(([dx,dz])=>[x+dx,z+dz,dx,dz]).filter(([nx,nz,dx,dz])=>nx>=0&&nz>=0&&nx<11&&nz<11&&(centre(x,z)&&centre(nx,nz)||(dx===1?this.east[x][z]:dx===-1?this.east[nx][nz]:dz===1?this.south[x][z]:this.south[nx][nz]))).map(([x,z])=>[x,z]);}
  private placeKeys(){const dist=Array.from({length:11},()=>Array<number>(11).fill(-1)),queue=[[5,10]];dist[5][10]=0;for(let i=0;i<queue.length;i++){const [x,z]=queue[i];for(const [nx,nz]of this.neighbours(x,z))if(dist[nx][nz]<0){dist[nx][nz]=dist[x][z]+1;queue.push([nx,nz]);}}
    for(const [x0,x1,z0,z1]of [[0,4,0,10],[0,10,0,3],[6,10,0,10]]){let best:number[]|null=null;for(let x=x0;x<=x1;x++)for(let z=z0;z<=z1;z++)if(!centre(x,z)&&!this.keys.some(k=>k[0]===x&&k[1]===z)&&dist[x][z]>=0&&(!best||dist[x][z]>dist[best[0]][best[1]]))best=[x,z];if(best)this.keys.push(best);}
  }
  setup(ids:number[]){for(const id of ids){this.found.set(id,new Set());this.setSlot(id,0,{id:vi('iron_sword'),count:1,name:'Hedge Sword'});}
    for(let x=0;x<11;x++)for(let z=0;z<11;z++)if(!centre(x,z)&&!(x===5&&z>=9)&&!this.keys.some(k=>k[0]===x&&k[1]===z))this.mobCells.push([x,z]);
    for(let i=this.mobCells.length-1;i>0;i--){const j=Math.floor(this.random()*(i+1));[this.mobCells[i],this.mobCells[j]]=[this.mobCells[j],this.mobCells[i]];}
    this.wanted=Math.min(scaleInt(ids.length,10,20),this.mobCells.length);for(let i=0;i<this.wanted;i++)this.spawnHusk();
    for(const k of this.keys)this.m.sim.ents.spawn('display',mazeCell(k[0])+.5,BASE_Y+1.2,mazeCell(k[1])+.5,{data:{variant:'key'}});
  }
  private spawnHusk(){for(let tries=0;tries<this.mobCells.length;tries++){const [x,z]=this.mobCells[this.nextMob++%this.mobCells.length],at=this.at(mazeCell(x)+.5,1,mazeCell(z)+.5);if(this.t>0&&this.players().some(id=>{const b=this.m.host.body(id)!;return Math.hypot(b.x-at.x,b.z-at.z)<10;}))continue;this.mobs.push(this.m.sim.spawnMob('husk',at.x,at.y,at.z,undefined,{hp:12,maxHp:12}));return;}}
  onAction(id:number,a:MAction){if(a.k==='attack'&&a.ent!==undefined&&this.mobs.some(e=>e.id===a.ent)){this.m.sim.handle(id,a);return true;}return false;}
  tick(){
    if(this.t%10===0){for(let i=this.mobs.length-1;i>=0;i--)if(this.mobs[i].dead)this.mobs.splice(i,1);if(this.mobs.length<this.wanted&&this.t%60===0)this.spawnHusk();for(const id of this.players()){const b=this.m.host.body(id)!;for(const e of this.mobs)if(Math.hypot(e.x-b.x,e.y-b.y,e.z-b.z)<1.5)this.m.sim.addEffect(id,'slowness',1,50);}}
    for(const id of this.players()){const b=this.m.host.body(id)!,mine=this.found.get(id)!;this.keys.forEach((k,i)=>{if(!mine.has(i)&&Math.abs(this.dy(b.y)-1)<1.5&&Math.abs(b.x-mazeCell(k[0])-.5)<1.6&&Math.abs(b.z-mazeCell(k[1])-.5)<1.6){mine.add(i);this.lastKey.set(id,this.t);this.m.title(id,`Key ${mine.size}/3`,mine.size===3?'Now run to the fountain':'Find the others','#d99a00');}});this.progress.set(id,mine.size*100000-(this.lastKey.get(id)??0));if(mine.size===3&&Math.abs(this.dy(b.y)-1)<1.5&&courtyard(Math.floor(b.x),Math.floor(b.z)))this.finishRace(id);}
  }
  bar(id:number){const n=this.found.get(id)?.size??0;return n===3?'All keys · Get to the fountain':`Keys: ${n}/3`;}
  progressDetail(id:number){return `${this.found.get(id)?.size??0}/3 keys`;}
  cleanup(){for(const e of this.mobs)this.m.sim.ents.remove(e);}
}
