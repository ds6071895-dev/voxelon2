import { ParkourRace, generatedCourse, COURSE_BOX, drawPad } from './parkour_race';
import { JumpModel } from './parkour';
import { sceneryNeonBlink } from './race_geometry';
import type { ArenaDef } from './arena';
export const neonState=(color:number,tick:number)=>{if(color===0)return 0;const into=((tick-(color===1?0:60))%120+120)%120;return into<68?(into>=44?1:0):2;};
const SOLID=['sea_lantern','magenta_concrete','cyan_concrete'];const GLASS=['sea_lantern','magenta_stained_glass','cyan_stained_glass'];
export class NeonBlink extends ParkourRace {
  readonly id='blink';readonly course;readonly arena:ArenaDef;readonly colours:number[]=[];private shown=[-1,-1,-1];
  constructor(seed=0){super();this.course=generatedCourse(this.id,seed,137,{stops:6,radius:5,legMin:27,legMax:35,startY:34,dyMin:-3,dyMax:5,minY:26,maxY:76,extent:108,lanes:2,laneSpread:7,maxPads:26},{model:JumpModel.NORMAL,easiest:.3,hardest:.62,maxDrop:3,sizes:[2,2,2,3],wander:.4,below:3});
    const r=this.course.rng;for(const leg of this.legs){let c=r.nextBoolean()?1:2,run=0,length=2+r.nextInt(2);for(let i=0;i<leg.length;i++){let pick=c;if(run===length){run=0;length=2+r.nextInt(2);c=c===1?2:1;pick=r.nextInt(3)===0&&i>0&&i<leg.length-1?0:c;}if(pick!==0)run++;this.colours.push(pick);}}
    this.arena={id:this.id,version:2,bounds:COURSE_BOX,build:d=>{this.pads.forEach((p,i)=>drawPad(d,p,SOLID[this.colours[i]]));sceneryNeonBlink(d,this.course);}};
  }
  tick(){for(const c of [1,2]){const now=neonState(c,this.t);if(now===this.shown[c])continue;this.shown[c]=now;this.pads.forEach((p,i)=>{if(this.colours[i]===c)for(let x=p.x;x<=p.x1();x++)for(let z=p.z;z<=p.z1();z++)this.put(x,p.y,z,now===2?0:now===1?GLASS[c]:SOLID[c]);});}super.tick();}
}
