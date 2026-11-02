import { ParkourRace, generatedCourse, COURSE_BOX } from './parkour_race';
import { JumpModel } from './parkour';
import { sceneryLunarLeap } from './race_geometry';
import type { ArenaDef } from './arena';
export class LunarLeap extends ParkourRace {
  readonly id='lunar';readonly course;readonly arena:ArenaDef;
  constructor(seed=0){super();this.course=generatedCourse(this.id,seed,139,{stops:6,radius:5,legMin:40,legMax:50,startY:30,dyMin:-6,dyMax:8,minY:18,maxY:90,extent:106,lanes:2,laneSpread:11,maxPads:22},{model:JumpModel.MOON,easiest:.42,hardest:.74,maxDrop:6,sizes:[2,3,3,4],wander:.45,below:5});this.arena={id:this.id,bounds:COURSE_BOX,build:d=>sceneryLunarLeap(d,this.course)};}
  kit(id:number){this.m.sim.addEffect(id,'jump_boost',1,100000);this.m.sim.addEffect(id,'slow_falling',0,100000);}
  racerTick(id:number){if(this.t%40===0)this.kit(id);}
}
