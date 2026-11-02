import { JavaRandom } from '../vanilla/java_random';
import { routeLoop,roundRoute,routeDist } from './sky_route';
export class BoatCircuit {
  line:number[][]=[];corners:number[][]=[];length=1;
  readonly rng:JavaRandom;readonly theme:string;
  private buckets=new Map<string,number[]>();
  constructor(seed:number){this.rng=new JavaRandom(BigInt(seed)*163n+7n);this.theme=['SNOW','DESERT','CHERRY','NETHER','CANDY','NEON'][this.rng.nextInt(6)];this.circuit();this.line.forEach((p,i)=>{const key=`${Math.floor(p[0])>>3},${Math.floor(p[1])>>3}`,bucket=this.buckets.get(key)??[];bucket.push(i);this.buckets.set(key,bucket);});}
  private circuit(){const r=this.rng;for(let attempt=0;attempt<60;attempt++){
    const outline=routeLoop(r,9,22+r.nextInt(7),.62),pts=outline.map(c=>[(c[0]-4.5)*24,(c[1]-4.5)*24]);let best=0,longest=0;
    for(let i=0;i<pts.length;i++){const l=routeDist(pts[i],pts[(i+1)%pts.length]);if(l>longest){longest=l;best=i;}}
    const a=pts[best],b=pts[(best+1)%pts.length],ordered=[[(a[0]+b[0])/2,(a[1]+b[1])/2]];for(let i=1;i<=pts.length;i++)ordered.push(pts[(best+i)%pts.length]);
    const smooth=roundRoute(ordered,true,11,.5);let total=0;for(let i=0;i<smooth.length;i++)total+=routeDist(smooth[i],smooth[(i+1)%smooth.length]);
    if(total<1050||total>1650&&attempt<50)continue;
    let s=0;this.line=smooth.map((p,i)=>{if(i>0)s+=routeDist(smooth[i-1],p);return[p[0],p[1],s];});this.length=total;this.corners=pts;return;
  }throw new Error('Boat Rush: no circuit');}
  nearest(x:number,z:number):[number,number]{const bx=Math.floor(x)>>3,bz=Math.floor(z)>>3;let best=Infinity,at=-1;for(let i=-2;i<=2;i++)for(let j=-2;j<=2;j++)for(const k of this.buckets.get(`${bx+i},${bz+j}`)??[]){const p=this.line[k],d=(p[0]-x)**2+(p[1]-z)**2;if(d<best){best=d;at=k;}}return[at,Math.sqrt(best)];}
  inside(x:number,z:number){let inside=false;for(let i=0,j=this.corners.length-1;i<this.corners.length;j=i++){const a=this.corners[i],b=this.corners[j];if((a[1]>z)!==(b[1]>z)&&x<(b[0]-a[0])*(z-a[1])/(b[1]-a[1])+a[0])inside=!inside;}return inside;}
}
