// Musical Carts: exclusive seats, source music/scramble/judge phases and lives.
import { Minigame } from './game';
import { MUSICALMINECARTS_ARENA } from './survival_arenas';
import { scaleInt } from '../minigames_rules';
import type { Entity } from '../vanilla/entity';
import type { MAction } from '../vanilla/messages';
export const startingLives=(n:number)=>n<=2?3:n<=4?2:1;
export const musicBase=(n:number)=>scaleInt(n,11,8);
const TUNE=[1,1.26,1.5,1.26,1,1.12,1.26,.84,.94,1.12,1.33,1.12,1,.84,.75,1];
export class MusicalMinecarts extends Minigame {
  readonly id='minecarts';readonly arena=MUSICALMINECARTS_ARENA;
  stage:'music'|'scramble'|'judge'='music';stageTicks=0;round=0;
  readonly carts:Entity[]=[];readonly seats=new Map<number,number>();readonly lives=new Map<number,number>();
  spawns(n:number) {return this.ring(n,10,1,this.random()*Math.PI*2);}
  spectate() {return this.at(.5,13,21.5);}
  setup(ids:number[]) {for(const id of ids){const n=startingLives(ids.length);this.lives.set(id,n);this.setScore(id,n);}}
  begin(){this.startMusic();}
  canWalk(id:number){return !this.seats.has(id);}
  melee(_attacker:number,victim:number){return !this.seats.has(victim);}
  bar(id:number){return `Lives: ${this.lives.get(id)??0}`;}
  startMusic(){this.round++;this.stage='music';this.stageTicks=20*(Math.max(4,musicBase(this.participants.size)-this.round)+Math.floor(this.random()*5));this.m.title(null,'Music','Keep moving…','#c36ad8');}
  tick(){
    this.stageTicks--;
    if(this.stage==='music'){
      if(this.t%4===0)this.m.sound('pling',undefined,TUNE[Math.floor(this.t/4)%16]);
      if(this.stageTicks<=0)this.scramble();
    }else if(this.stage==='scramble'){
      if(this.stageTicks<=0||this.carts.every(c=>c.data.rider!==undefined)&&this.stageTicks<80)this.judge();
    }else if(this.stageTicks<=0){this.clearCarts();if(!this.over())this.startMusic();}
  }
  scramble(){
    this.stage='scramble';this.stageTicks=120;const count=Math.max(1,this.alive.size-1),minR=Math.min(12,5.5+this.round*.8);
    let attempts=0,gap=9;
    while(this.carts.length<count&&attempts++<600){
      if(attempts===300)gap=4;
      const a=this.random()*Math.PI*2,r=minR+this.random()*(13.5-minR),x=Math.cos(a)*r+.5,z=Math.sin(a)*r+.5;
      if(this.carts.some(c=>(c.x-x)**2+(c.z-z)**2<=gap))continue;
      this.carts.push(this.m.sim.ents.spawn('minecart',x,this.at(0,1,0).y,z,{data:{stationary:true}}));
    }
    this.m.title(null,'Sit!','Right-click a minecart','#d99a00');this.m.sound('bass');
  }
  onAction(id:number,a:MAction){
    if(a.k==='dismount'&&this.seats.has(id))return true;
    if(a.k!=='use'||a.ent===undefined)return false;
    const c=this.carts.find(c=>c.id===a.ent),b=this.m.host.body(id)!;
    if(!c||this.stage!=='scramble'||this.seats.has(id)||c.data.rider!==undefined||Math.hypot(b.x-c.x,b.y-c.y,b.z-c.z)>4.5)return true;
    c.data.rider=id;this.seats.set(id,c.id);
    const p=this.m.sim.players.get(id)!;p.frozen=true;p.selfKey='';
    this.m.host.teleport(id,c.x,c.y+.2,c.z);this.m.sound('pickup',b);return true;
  }
  judge(){
    this.stage='judge';this.stageTicks=40;
    for(const id of this.players())if(!this.seats.has(id)){
      const n=(this.lives.get(id)??1)-1;this.lives.set(id,n);this.setScore(id,Math.max(0,n));
      if(n<=0)this.eliminate(id,'was left standing');else this.m.title(id,'No seat',`${n} ${n===1?'life':'lives'} left`,'#e5484d');
    }
  }
  clearCarts(){
    for(const id of this.seats.keys()){const p=this.m.sim.players.get(id);if(p){p.frozen=false;p.selfKey='';}this.m.host.launch(id,0,6,0);}
    this.seats.clear();for(const c of this.carts)this.m.sim.ents.remove(c);this.carts.length=0;
  }
  onQuit(id:number){const c=this.carts.find(c=>c.id===this.seats.get(id));if(c)delete c.data.rider;this.seats.delete(id);this.lives.delete(id);}
  cleanup(){this.clearCarts();}
  status(){return this.stage==='music'?'Music is playing':this.stage==='scramble'?'Find an empty cart':'Checking seats';}
}
