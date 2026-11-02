// Source Parkour.Pad, JumpModel and clearance-aware course walker.
import { JavaRandom } from '../vanilla/java_random';
export class Pad {
  constructor(readonly x:number,readonly y:number,readonly z:number,readonly w:number,readonly d:number){}
  cx(){return this.x+this.w/2;} cz(){return this.z+this.d/2;}
  x1(){return this.x+this.w-1;} z1(){return this.z+this.d-1;}
  covers(x:number,z:number){return x>=this.x&&x<=this.x1()&&z>=this.z&&z<=this.z1();}
}
export class JumpModel {
  static readonly NORMAL=new JumpModel(.42,.08,.08);
  static readonly MOON=new JumpModel(.62,.08,.01);
  readonly distance:number[]=[];readonly height:number[]=[];private apex=0;
  constructor(impulse:number,gravityUp:number,gravityDown:number){
    let v=.4806,vy=impulse,x=v,y=vy;v*=.546;vy=(vy-(vy>0?gravityUp:gravityDown))*.98;
    this.distance[0]=x;this.height[0]=y;
    for(let t=1;t<160;t++){x+=v+.026;v=(v+.026)*.91;y+=vy;vy=(vy-(vy>0?gravityUp:gravityDown))*.98;this.distance[t]=x;this.height[t]=y;if(y>this.height[this.apex])this.apex=t;}
  }
  apexHeight(){return this.height[this.apex];}
  maxRise(){return Math.floor(this.apexHeight()-.2);}
  maxTravel(dy:number){
    if(this.apexHeight()<dy+.15)return 0;
    for(let t=this.apex+1;t<160;t++)if(this.height[t]<=dy){const f=(this.height[t-1]-dy)/(this.height[t-1]-this.height[t]);return this.distance[t-1]+(this.distance[t]-this.distance[t-1])*f;}
    return this.distance[159];
  }
  difficulty(from:Pad,to:Pad){const gap=(a:number,b:number,c:number,d:number)=>Math.max(0,c-b-1,a-d-1);const gx=Math.max(0,gap(from.x,from.x1(),to.x,to.x1())-.6),gz=Math.max(0,gap(from.z,from.z1(),to.z,to.z1())-.6),max=this.maxTravel(to.y-from.y);return max<=0?9:Math.hypot(gx,gz)/max;}
  possible(from:Pad,to:Pad,limit:number){return !(to.x<=from.x1()&&from.x<=to.x1()&&to.z<=from.z1()&&from.z<=to.z1())&&to.y-from.y<=this.maxRise()&&this.difficulty(from,to)<=limit;}
}
export interface ParkourSpec{model:JumpModel;easiest:number;hardest:number;maxDrop:number;sizes:number[];wander:number;below:number}
export interface ParkourBounds{minX:number;maxX:number;minY:number;maxY:number;minZ:number;maxZ:number}
export const courseKey=(x:number,y:number,z:number)=>((x+512)*1024+z+512)*512+y+128;
export function free(p:Pad,used:Set<number>,below:number,above:number){for(let x=p.x-1;x<=p.x1()+1;x++)for(let z=p.z-1;z<=p.z1()+1;z++)for(let y=p.y-below;y<=p.y+above;y++)if(used.has(courseKey(x,y,z)))return false;return true;}
export function occupy(p:Pad,used:Set<number>,headroom:number){for(let x=p.x;x<=p.x1();x++)for(let z=p.z;z<=p.z1();z++)for(let y=p.y;y<=p.y+headroom;y++)used.add(courseKey(x,y,z));}
export function occupyDisc(cx:number,y:number,cz:number,r:number,depth:number,headroom:number,used:Set<number>){const R=Math.ceil(r);for(let x=-R;x<=R;x++)for(let z=-R;z<=R;z++)if(x*x+z*z<=(r+.5)**2)for(let yy=y-depth;yy<=y+headroom;yy++)used.add(courseKey(cx+x,yy,cz+z));}
export function walk(r:JavaRandom,from:Pad,waypoints:number[][],goal:Pad,spec:ParkourSpec,used:Set<number>,bounds:ParkourBounds,maxPads:number):Pad[]|null {
  const path:Pad[]=[];let current=from,waypoint=0;
  for(;;){
    if(waypoint>=waypoints.length&&path.length>=2&&spec.model.possible(current,goal,spec.hardest))return path;
    if(path.length>=maxPads)return null;
    const aim=waypoints[waypoint]??[goal.cx(),goal.y,goal.cz()],ax=aim[0]-current.cx(),az=aim[2]-current.cz(),flat=Math.hypot(ax,az),heading=Math.atan2(az,ax),wantDy=(aim[1]-current.y)/Math.max(1,flat/3.6);
    let next:Pad|null=null;
    for(let attempt=0;attempt<70&&!next;attempt++){
      const size=spec.sizes[r.nextInt(spec.sizes.length)];let w=size,d=size;
      if(size===2&&r.nextInt(3)===0){if(r.nextBoolean())w=1;else d=1;}
      const dy=Math.max(-spec.maxDrop,Math.min(spec.model.maxRise(),Math.round(wantDy+r.nextGaussian()*.7))),max=spec.model.maxTravel(dy);if(max<=0)continue;
      const travel=(spec.easiest+r.nextDouble()*(spec.hardest-spec.easiest))*max,angle=heading+r.nextGaussian()*spec.wander*(attempt<30?1:1.6),reach=travel+.6+(Math.max(current.w,current.d)+Math.max(w,d))/2;
      const candidate=new Pad(Math.round(current.cx()+Math.cos(angle)*reach-w/2),current.y+dy,Math.round(current.cz()+Math.sin(angle)*reach-d/2),w,d);
      if(candidate.x<bounds.minX||candidate.x1()>bounds.maxX||candidate.z<bounds.minZ||candidate.z1()>bounds.maxZ||candidate.y<bounds.minY||candidate.y>bounds.maxY||!spec.model.possible(current,candidate,spec.hardest)||spec.model.difficulty(current,candidate)<spec.easiest*.6)continue;
      const before=Math.hypot(aim[0]-current.cx(),aim[2]-current.cz()),after=Math.hypot(aim[0]-candidate.cx(),aim[2]-candidate.cz());
      if(after>before-.8&&before>3||!free(candidate,used,spec.below,3))continue;
      next=candidate;
    }
    if(!next)return null;
    occupy(next,used,3);path.push(next);current=next;
    while(waypoint<waypoints.length&&Math.hypot(waypoints[waypoint][0]-current.cx(),waypoints[waypoint][2]-current.cz())<4.5)waypoint++;
  }
}
