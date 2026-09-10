import * as THREE from 'three';
import type { VaultBossKind } from './vaults';

const cache = new Map<string, { map: THREE.DataTexture; bumpMap: THREE.DataTexture }>();
const fract = (x: number): number => x-Math.floor(x);
const hash = (x: number,y: number): number => fract(Math.sin(x*127.1+y*311.7)*43758.5453);
function noise(x: number,y: number): number {
  const ix=Math.floor(x), iy=Math.floor(y);
  let u=fract(x),v=fract(y); u=u*u*(3-2*u); v=v*v*(3-2*v);
  return THREE.MathUtils.lerp(THREE.MathUtils.lerp(hash(ix,iy),hash(ix+1,iy),u),
    THREE.MathUtils.lerp(hash(ix,iy+1),hash(ix+1,iy+1),u),v);
}

/** Authored material recipes: large forms, mid-scale wear and fine grain are
 * separate frequencies. Matching height maps put the detail into the normals.
 * Generated once per material and mipmapped, rather than random noise per frame. */
export function bossTextures(kind: VaultBossKind, trim: boolean): {
  map: THREE.DataTexture; bumpMap: THREE.DataTexture;
} {
  const key=kind+':'+trim;
  const cached=cache.get(key); if (cached) return cached;
  const size=256, colors=new Uint8Array(size*size*4), heights=new Uint8Array(size*size*4);
  for (let y=0;y<size;y++) for (let x=0;x<size;x++) {
    const u=x/size,v=y/size;
    const broad=noise(u*6,v*6), fine=noise(u*90,v*90), grain=hash(x,y);
    let value=0.8,height=0.5;
    let r=1,g=1,b=1;
    if (kind==='mire_queen') {
      const row=Math.floor(v*12), sx=fract(u*10+(row%2)*0.5)-0.5, sy=fract(v*12);
      const scale=Math.sqrt(sx*sx*3.1+(sy-0.22)*(sy-0.22));
      const edge=1-THREE.MathUtils.smoothstep(scale,0.56,0.67);
      height=edge*(0.35+Math.max(0,1-scale)*0.6)+fine*0.08;
      value=0.3+edge*0.48+broad*0.12+fine*0.1;
      r=0.83+sy*0.17; b=0.86;
    } else if (kind==='ember_colossus' || kind==='bone_warden') {
      const px=u*9+noise(u*4,v*4)*0.6,py=v*9+noise(u*4+20,v*4)*0.6;
      let first=10,second=10;
      for (let iy=-1;iy<=1;iy++) for (let ix=-1;ix<=1;ix++) {
        const cx=Math.floor(px)+ix,cy=Math.floor(py)+iy;
        const d=Math.hypot(px-cx-hash(cx,cy)*0.8,py-cy-hash(cx+41,cy+19)*0.8);
        if (d<first) {second=first;first=d;} else if (d<second) second=d;
      }
      const fissure=1-THREE.MathUtils.smoothstep(second-first,0.018,trim ? 0.05 : 0.09);
      if (kind==='ember_colossus') {
        value=0.47+broad*0.25+fine*0.16-fissure*0.27;
        height=0.35+broad*0.25-fissure*0.3+fine*0.1;
        r=1+fissure*0.65; g=1-fissure*0.45; b=1-fissure*0.7;
      } else {
        const streak=noise(u*65,v*5);
        value=0.62+broad*0.15+streak*0.16+fine*0.05-fissure*0.16;
        height=0.48+streak*0.12-fissure*0.14;
        b=trim ? 0.85 : 1; r=trim ? 1 : 0.94;
      }
    } else if (kind==='crystal_seer') {
      const vein=Math.pow(Math.abs(Math.sin((u*16+v*7+noise(u*5,v*5)*0.55)*Math.PI)),22);
      const striation=Math.sin((u+v*0.35)*190+noise(u*8,v*8)*3)*0.055;
      value=0.58+broad*0.23+vein*0.2+striation;
      height=0.48+vein*0.14+striation*0.4;
      r=0.8+vein*0.2; b=1.08;
    } else {
      const cellX=fract(u*6)-0.5,cellY=fract(v*6)-0.5;
      const circle=Math.abs(Math.hypot(cellX,cellY)-0.33);
      const engraving=1-THREE.MathUtils.smoothstep(circle,0.012,0.035);
      const border=1-THREE.MathUtils.smoothstep(Math.min(Math.abs(cellX),Math.abs(cellY)),0.013,0.027);
      const scratch=Math.pow(noise(u*180,v*9),10);
      value=0.71+broad*0.15+fine*0.07-engraving*0.3-border*0.09+scratch*0.15;
      height=0.56-engraving*0.18-border*0.05+scratch*0.1;
      const patina=Math.max(0,broad-0.58)*1.2;
      r=1-patina; g=1; b=0.83+patina*0.4;
    }
    value+=(grain-0.5)*0.045;
    const i=(y*size+x)*4;
    colors[i]=Math.min(255,Math.max(0,value*r*255));
    colors[i+1]=Math.min(255,Math.max(0,value*g*255));
    colors[i+2]=Math.min(255,Math.max(0,value*b*255)); colors[i+3]=255;
    heights[i]=heights[i+1]=heights[i+2]=THREE.MathUtils.clamp(height,0,1)*255;
    heights[i+3]=255;
  }
  const texture=(data: Uint8Array<ArrayBuffer>, color: boolean): THREE.DataTexture => {
    const t=new THREE.DataTexture(data,size,size);
    t.colorSpace=color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.wrapS=t.wrapT=THREE.RepeatWrapping;
    t.magFilter=THREE.LinearFilter; t.minFilter=THREE.LinearMipmapLinearFilter;
    t.generateMipmaps=true; t.anisotropy=4; t.needsUpdate=true; return t;
  };
  const result={map:texture(colors,true),bumpMap:texture(heights,false)};
  cache.set(key,result); return result;
}
