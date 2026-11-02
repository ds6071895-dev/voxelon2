import { ParkourRace, generatedCourse, COURSE_BOX, drawPad } from './parkour_race';
import { JumpModel } from './parkour';
import { sceneryCrumblingRuins } from './race_geometry';
import { scaleInt } from '../minigames_rules';
import { BASE_Y, type ArenaDef } from './arena';
export const crumbleDelay=(n:number)=>scaleInt(n,14,22);
export const regrow=(n:number)=>scaleInt(n,160,80);
const STONES=['stone_bricks','mossy_stone_bricks','mossy_cobblestone','chiseled_stone_bricks','polished_andesite','mossy_stone_bricks'];
export class CrumblingRuins extends ParkourRace {
  readonly id='crumble';readonly course;readonly arena:ArenaDef;readonly materials:string[]=[];
  readonly crumbling=new Map<number,number>();readonly gone=new Map<number,number>();
  constructor(seed=0){super();this.course=generatedCourse(this.id,seed,131,{stops:6,radius:6,legMin:32,legMax:40,startY:22,dyMin:-3,dyMax:7,minY:14,maxY:66,extent:108,lanes:3,laneSpread:9,maxPads:30},{model:JumpModel.NORMAL,easiest:.36,hardest:.68,maxDrop:3,sizes:[1,2,2,2,3],wander:.35,below:3});
    // Material choices precede scenery in the source's shared course RNG.
    for(const _pad of this.pads)this.materials.push(STONES[this.course.rng.nextInt(STONES.length)]);
    this.arena={id:this.id,bounds:COURSE_BOX,build:d=>{this.pads.forEach((p,i)=>drawPad(d,p,this.materials[i]));sceneryCrumblingRuins(d,this.course);}};
  }
  private paint(i:number,m:string|number){const p=this.pads[i];for(let x=p.x;x<=p.x1();x++)for(let z=p.z;z<=p.z1();z++)this.put(x,p.y,z,m);}
  racerTick(id:number){const b=this.m.host.body(id)!,y=Math.floor(b.y-BASE_Y-.2);for(const dx of [-.3,.3])for(const dz of [-.3,.3]){
    const x=Math.floor(b.x+dx),z=Math.floor(b.z+dz),i=this.pads.findIndex(p=>p.y===y&&p.covers(x,z));
    if(i>=0&&!this.crumbling.has(i)&&!this.gone.has(i)){this.crumbling.set(i,this.t+crumbleDelay(this.participants.size));this.paint(i,'cracked_stone_bricks');}
  }}
  tick(){super.tick();for(const [i,at]of this.crumbling)if(this.t>=at){this.crumbling.delete(i);this.paint(i,0);this.gone.set(i,this.t+regrow(this.participants.size));}
    for(const [i,at]of this.gone)if(this.t>=at){const p=this.pads[i],occupied=this.players().some(id=>{const b=this.m.host.body(id)!;return b.x>=p.x-.3&&b.x<=p.x1()+1.3&&b.z>=p.z-.3&&b.z<=p.z1()+1.3&&b.y>=BASE_Y+p.y-.2&&b.y<BASE_Y+p.y+2;});if(occupied)this.gone.set(i,this.t+10);else{this.gone.delete(i);this.paint(i,this.materials[i]);}}
  }
}
