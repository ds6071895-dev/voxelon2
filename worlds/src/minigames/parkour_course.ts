// ParkourRace.layCourse: random walk of stops, then proved pad lanes.
import { JavaRandom } from '../vanilla/java_random';
import { Pad, walk, occupyDisc, type ParkourSpec } from './parkour';
export interface Stop{x:number;y:number;z:number;r:number}
export interface Layout{stops:number;radius:number;legMin:number;legMax:number;startY:number;dyMin:number;dyMax:number;minY:number;maxY:number;extent:number;lanes:number;laneSpread:number;maxPads:number}
export interface Course{stops:Stop[];legs:Pad[][];rng:JavaRandom}
export function pointToSegment(px:number,pz:number,ax:number,az:number,bx:number,bz:number){const vx=bx-ax,vz=bz-az,l=vx*vx+vz*vz,f=l===0?0:Math.max(0,Math.min(1,((px-ax)*vx+(pz-az)*vz)/l));return Math.hypot(px-ax-vx*f,pz-az-vz*f);}
function segmentGap(a:Stop,b:Stop,x1:number,z1:number,x2:number,z2:number){let best=Infinity;for(let i=0;i<=10;i++){const f=i/10;best=Math.min(best,pointToSegment(x1+(x2-x1)*f,z1+(z2-z1)*f,a.x,a.z,b.x,b.z),pointToSegment(a.x+(b.x-a.x)*f,a.z+(b.z-a.z)*f,x1,z1,x2,z2));}return best;}
const edge=(s:Stop,toward:number[])=>{const a=Math.atan2(toward[2]-s.z,toward[0]-s.x),r=Math.max(0,s.r-1.5);return new Pad(Math.round(s.x+Math.cos(a)*r)-1,s.y,Math.round(s.z+Math.sin(a)*r)-1,3,3);};
export function layCourse(r:JavaRandom,l:Layout,spec:ParkourSpec):Course|null {
  const stops:Stop[]=[],legs:Pad[][]=[],used=new Set<number>(),a0=r.nextDouble()*Math.PI*2;
  let heading=a0+Math.PI+r.nextGaussian()*.4;const boundary=l.extent-l.radius-6;
  stops.push({x:Math.round(Math.cos(a0)*boundary*.8),y:l.startY,z:Math.round(Math.sin(a0)*boundary*.8),r:l.radius});
  while(stops.length<l.stops){
    const prev=stops[stops.length-1];let next:Stop|null=null;
    for(let attempt=0;attempt<60&&!next;attempt++){
      const h=heading+r.nextGaussian()*(attempt<20?.6:1.3),length=l.legMin+r.nextDouble()*(l.legMax-l.legMin),x=Math.round(prev.x+Math.cos(h)*length),z=Math.round(prev.z+Math.sin(h)*length),y=Math.max(l.minY,Math.min(l.maxY,prev.y+l.dyMin+r.nextInt(l.dyMax-l.dyMin+1)));
      if(Math.abs(x)>boundary||Math.abs(z)>boundary)continue;
      let clear=true;
      for(let i=0;i<stops.length-1&&clear;i++)clear=Math.hypot(stops[i].x-x,stops[i].z-z)>=l.legMin*.9;
      for(let i=0;i+2<stops.length&&clear;i++)clear=segmentGap(stops[i],stops[i+1],prev.x,prev.z,x,z)>=20;
      if(clear){next={x,y,z,r:l.radius};heading=h;}
    }
    if(!next)return null;stops.push(next);
  }
  for(const s of stops)occupyDisc(s.x,s.y,s.z,s.r,4,5,used);
  const bounds={minX:-l.extent,maxX:l.extent,minY:l.minY-12,maxY:l.maxY+12,minZ:-l.extent,maxZ:l.extent};
  for(let i=0;i+1<stops.length;i++){
    const a=stops[i],b=stops[i+1],ux=b.x-a.x,uz=b.z-a.z,len=Math.hypot(ux,uz),leg:Pad[]=[];
    for(let lane=0;lane<l.lanes;lane++){
      const offset=(lane-(l.lanes-1)/2)*l.laneSpread,waypoints:number[][]=[];
      if(l.lanes>1)for(const f of [.35,.65])waypoints.push([a.x+ux*f-uz/len*offset,a.y+(b.y-a.y)*f,a.z+uz*f+ux/len*offset]);
      const from=edge(a,waypoints[0]??[b.x,b.y,b.z]),goal=edge(b,waypoints[waypoints.length-1]??[a.x,a.y,a.z]);
      let pads:Pad[]|null=null;
      for(let attempt=0;attempt<8&&!pads;attempt++){const trial=new Set(used);pads=walk(r,from,waypoints,goal,spec,trial,bounds,l.maxPads);if(pads)for(const k of trial)used.add(k);}
      if(!pads)return null;leg.push(...pads);
    }
    legs.push(leg);
  }
  return {stops,legs,rng:r};
}
