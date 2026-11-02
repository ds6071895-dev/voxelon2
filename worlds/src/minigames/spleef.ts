// Glacier Spleef: three floors, instant shovel, snowballs and the thawing rim.
import { Minigame } from './game';
import { GLACIERSPLEEF_ARENA } from './survival_arenas';
import { BASE_Y } from './arena';
import { scaleInt } from '../minigames_rules';
import { vi } from '../vanilla/items';
import { mc } from '../vanilla/mc_materials';
import type { Entity } from '../vanilla/entity';
export const SPLEEF_FLOORS = [0, -8, -16];
export const thawStart = (n: number) => scaleInt(n, 35, 60) * 20;
export const thawEvery = (n: number) => scaleInt(n, 40, 60);
export class GlacierSpleef extends Minigame {
  readonly id = 'spleef'; readonly arena = GLACIERSPLEEF_ARENA;
  thawRadius = 15;
  spawns(n: number) { return this.ring(n, 10, 1, this.random() * Math.PI * 2); }
  spectate() { return this.at(.5, 18, .5); }
  fallY() { return -17; }
  setup(ids: number[]) { for (const id of ids) this.setSlot(id, 0, { id: vi('diamond_shovel'), count: 1, ench: [['efficiency', 5]], name: 'Ice Pick Shovel' }); }
  isFloor(x: number, y: number, z: number) { return SPLEEF_FLOORS.includes(y) && x*x+z*z <= 15.5**2 && this.get(x,y,z) === mc('snow_block'); }
  onLeftClick(id: number, x: number, wy: number, z: number) {
    const y = wy - BASE_Y;
    if (this.isFloor(x,y,z)) {
      this.put(x,y,z,0);
      const p = this.m.sim.players.get(id)!;
      const snow = p.inv.slots.reduce((n,s) => n + (s?.id === vi('snowball') ? s.count : 0),0);
      if (this.random() < .25 && snow < 8) this.m.sim.give(id,[{id:vi('snowball'),count:1}]);
      this.m.sound('gravel',this.at(x,y,z));
    }
    return true;
  }
  melee() { return true; }
  tick() {
    for (const id of this.players()) if (this.dy(this.m.host.body(id)!.y) < -16.5) this.eliminate(id,'fell through the ice');
    if (this.t >= thawStart(this.participants.size) && (this.t-thawStart(this.participants.size)) % thawEvery(this.participants.size) === 0 && this.thawRadius > 2) {
      for (const y of SPLEEF_FLOORS) for (let x=-15;x<=15;x++) for (let z=-15;z<=15;z++) {
        const r=Math.hypot(x,z), block=this.get(x,y,z);
        if (r>this.thawRadius-.5 && r<=this.thawRadius+.5 && block===mc('ice')) this.put(x,y,z,0);
        if (r>this.thawRadius-1.5 && r<=this.thawRadius-.5 && block===mc('snow_block')) this.put(x,y,z,'ice');
      }
      if (this.thawRadius===15) this.m.title(null,'Thaw','The floors melt from the edge','#6acbe8');
      this.thawRadius--;
    }
  }
  onProjectile(e: Entity, hit: {player?:number; block?:{x:number;y:number;z:number}}) {
    if (e.kind!=='snowball') return false;
    if (hit.player!==undefined && this.alive.has(hit.player)) {
      const len=Math.hypot(e.vx,e.vz)||1;
      this.m.host.launch(hit.player,e.vx/len*11,6.4,e.vz/len*11);
    }
    if (hit.block && this.isFloor(hit.block.x,hit.block.y-BASE_Y,hit.block.z)) this.put(hit.block.x,hit.block.y-BASE_Y,hit.block.z,0);
    return true;
  }
}
