import { Minigame } from './game';
import { REDLIGHT_ARENA } from './red_light_arena';
export class RedLight extends Minigame {
  readonly id='red_light'; readonly arena=REDLIGHT_ARENA;
  red=false; fake=false; switchAt=0; redSince=0;
  readonly checkpoint=new Map<number,number>();readonly caught=new Map<number,number>();
  private frozen=new Map<number,{x:number;y:number;z:number}>();
  spawns(n:number){return this.line(n,-.5,1,31,Math.min(2,20/Math.max(1,n)),180);}
  spectate(){return this.at(.5,16,40.5);}
  setup(ids:number[]){for(const id of ids)this.checkpoint.set(id,0);}
  begin(){this.green();}
  private head(watching:boolean){for(let x=-2;x<=2;x++)for(let y=9;y<=13;y++){
    let m='black_concrete';if(watching){m=y>=12||Math.abs(x)===2&&y>=10?'black_concrete':'white_terracotta';if(y===11&&Math.abs(x)===1||y===9&&x===0)m='red_concrete';}this.put(x,y,-38,m);
  }}
  private green(){this.red=false;this.fake=false;const p=Math.min(1,this.t/(this.seconds*20)),min=Math.trunc(30-12*p),max=Math.trunc(100-40*p);this.switchAt=this.t+min+Math.floor(this.random()*Math.max(1,max-min));this.frozen.clear();this.head(false);this.m.title(null,'Green light','Run!','#37b768');this.m.sound('pling');}
  private stop(){
    if(Math.floor(this.random()*6)===0&&!this.fake){this.fake=true;this.switchAt=this.t+12+Math.floor(this.random()*14);this.m.title(null,'…','','#d99a00');return;}
    this.red=true;this.redSince=this.t;this.switchAt=this.t+40+Math.floor(this.random()*40);this.head(true);this.m.title(null,'Red light','Freeze!','#e5484d');this.m.sound('bass');
  }
  tick(){
    if(this.t>=this.switchAt){if(this.red)this.green();else this.stop();}
    for(const id of this.players()){
      const b=this.m.host.body(id)!;this.progress.set(id,30-b.z);let cp=this.checkpoint.get(id)??0;
      while(cp<2&&b.z<[30,10,-10][cp+1]){cp++;this.checkpoint.set(id,cp);this.m.bar(id,'Checkpoint');}
      if(b.z< -28.5){this.finishRace(id);continue;}
      if(!this.red)continue;
      const still=this.frozen.get(id);
      if(this.t-this.redSince===7||this.t-this.redSince>7&&!still)this.frozen.set(id,{x:b.x,y:b.y,z:b.z});
      else if(this.t-this.redSince>7&&still&&(Math.hypot(b.x-still.x,b.z-still.z)>.3||b.y-still.y>.5)){
        const s=this.at(Math.max(-10,Math.min(10,b.x)),1,[30,10,-10][cp]+1.5,0);this.m.host.teleport(id,s.x,s.y,s.z,s.yaw);this.frozen.set(id,s);this.caught.set(id,(this.caught.get(id)??0)+1);this.m.title(id,'Caught',cp?`Back to checkpoint ${cp}`:'Back to the start','#e5484d');
      }
    }
  }
  bar(id:number){return `${this.red?'Red · freeze':'Green · run'} · ${Math.floor(Math.max(0,(this.m.host.body(id)?.z??30)+28))}m to go`;}
  progressDetail(id:number){return `${Math.round(this.progress.get(id)??0)}m`;}
}
